#!/usr/bin/env node
/*
  FORJA — transferência de movimento entre rigs de repouso diferente.

  Por que este arquivo existe: o transferidor antigo (`tools/retransferir-mocap.mjs`)
  calculava a correção de repouso com um eixo fixo — assumia que o osso aponta
  para o +Y local — e aplicava essa correção à direita da pose. Isso funcionava
  no pacote Rokoko (cujo repouso tem essa convenção) e quebrava nos outros:

    - no iClone/Mixamo, cujo osso de perna aponta para o −Y local, o
      `setFromUnitVectors` caía perto de 180° e escolhia um eixo arbitrário →
      pernas invertidas (pé a 1,80 m com o quadril a 0,99 m);
    - o resultado ainda vinha com salto de 0,75 m entre quadros.

  A conta correta não precisa de eixo fixo nenhum. Ela usa a rotação de MUNDO
  relativa ao repouso, que é a mesma coisa que "o delta no referencial do
  próprio osso, levado de volta para o mundo":

      Δw(b) = R_mundo_pose(b) · R_mundo_repouso(b)⁻¹
      R_destino(b) = G · Δw(b) · G⁻¹ · R_repouso_destino(b)

  com G sendo a guinada (rotação em torno do "para cima" do destino) que leva a
  frente do rig de origem para a frente do rig do FORJA. Essa forma é
  invariante a:
    - eixo do osso (Y, −Y, Z, o que for) — o delta é relativo, não absoluto;
    - roll do osso (torção de repouso) — idem;
    - escala e enquadramento do rig (cm vs m) — só a translação é escalada;
    - pose de repouso diferente (T vs A) — cada rig fica no seu repouso e o que
      se copia é o movimento a partir dele.

  Modos disponíveis:

    mundo   (padrão, e o recomendado) — a conta acima;
    local   — mesma ideia, mas compondo delta local por osso com a correção
              constante entre os referenciais dos pais. Útil para comparar;
    legado  — a conta antiga com eixo fixo. Mantida só para documentar o
              "antes"; não use para gerar clipe.

  Tudo devolve `{ tempos, trilhas, diagnostico }`, no mesmo formato que o
  `escreverClipeGLB` espera. Nada aqui grava arquivo nem publica nada.
*/
import fs from "node:fs";
import path from "node:path";

import { THREE, HIERARQUIA, lerBytes, raiz } from "./clipe-3d.mjs";
import { mapearOssos, NOMES_FORJA } from "./mapeamento-ossos.mjs";

export const MODOS = ["direcao", "mundo", "local", "legado"];

/* ------------------------------------------------------------------ */
/* Carregamento da origem                                              */
/* ------------------------------------------------------------------ */

export async function carregarOrigem(arquivo) {
  const caminho = path.isAbsolute(arquivo) ? arquivo : path.join(raiz, arquivo);
  const ext = path.extname(caminho).toLowerCase();
  let cena;
  let clipes = [];
  let tipo;
  if (ext === ".fbx") {
    const { FBXLoader } = await import(path.join(raiz, "node_modules/three/examples/jsm/loaders/FBXLoader.js"));
    const objeto = new FBXLoader().parse(lerBytes(caminho), path.dirname(caminho) + "/");
    cena = objeto;
    clipes = objeto.animations || [];
    tipo = "fbx";
  } else {
    const { GLTFLoader } = await import(path.join(raiz, "assets/vendor/three/addons/loaders/GLTFLoader.js"));
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(lerBytes(caminho), "", res, rej));
    cena = gltf.scene;
    clipes = gltf.animations || [];
    tipo = "glb";
  }
  const ossos = new Map();
  cena.traverse(objeto => { if (objeto.isBone) ossos.set(objeto.name, objeto); });
  return { cena, clipes, tipo, ossos };
}

/* ------------------------------------------------------------------ */
/* Guinada: alinha a frente do rig de origem com a do FORJA            */
/* ------------------------------------------------------------------ */

/*
  A linha dos ombros dá o eixo lateral em cada rig. Com o "para cima" do rig
  (quadril → pescoço), o produto vetorial dá a frente, e a guinada é a rotação
  em torno do "para cima" que leva a lateral da origem na lateral do destino.
  Sem isso, um rig exportado de frente para +Z chega de costas para o FORJA.
*/
export function calcularGuinada(lateralOrigem, lateralDestino, cimaDestino) {
  const a = lateralOrigem.clone().setY(0);
  const b = lateralDestino.clone().setY(0);
  if (a.lengthSq() < 1e-10 || b.lengthSq() < 1e-10) return new THREE.Quaternion();
  a.normalize();
  b.normalize();
  const cima = cimaDestino.clone().normalize();
  const angulo = a.angleTo(b);
  const sinal = new THREE.Vector3().crossVectors(a, b).dot(cima) >= 0 ? 1 : -1;
  return new THREE.Quaternion().setFromAxisAngle(cima, angulo * sinal);
}

/* ------------------------------------------------------------------ */
/* Contexto de transferência (lido UMA vez, antes do mixer tocar nada) */
/* ------------------------------------------------------------------ */

export function prepararContexto({ cenaOrigem, ossosOrigem, alvo, modo = "mundo", repousoDestino = null }) {
  if (!MODOS.includes(modo)) throw new Error("modo desconhecido: " + modo + " (use " + MODOS.join(", ") + ")");

  const { mapa, faltando, passadas } = mapearOssos(ossosOrigem.keys());
  if (faltando.length) {
    throw new Error("mapeamento incompleto, faltam: " + faltando.join(", ") +
      " (a origem tem " + ossosOrigem.size + " ossos; veja tools/lib/mapeamento-ossos.mjs)");
  }

  /*
    Repouso das duas pontas, lido ANTES de existir mixer. Ler "repouso" depois
    de aplicar o quadro 0 dá a pose do primeiro quadro, não o repouso do rig.
  */
  cenaOrigem.updateMatrixWorld(true);
  alvo.cena.updateMatrixWorld(true);

  /*
    `repousoDestino` permite informar o repouso já medido (nome → {quat, posicao}
    de mundo). Sem isso o repouso é lido do estado atual do personagem — que é
    correto para carregar e transferir na sequência, mas errado se alguém já
    tocou uma animação na cena antes (o "repouso" viraria a última pose).
  */
  const rest = {};
  for (const [nome] of HIERARQUIA) {
    const ossoOrigem = ossosOrigem.get(mapa[nome]);
    const ossoDestino = alvo.ossos.get(nome);
    if (!ossoDestino) throw new Error("personagem sem o osso " + nome);
    const informado = repousoDestino && repousoDestino[nome];
    rest[nome] = {
      quatOrigem: ossoOrigem.getWorldQuaternion(new THREE.Quaternion()),
      posOrigem: ossoOrigem.getWorldPosition(new THREE.Vector3()),
      quatDestino: informado
        ? informado.quat.clone()
        : ossoDestino.getWorldQuaternion(new THREE.Quaternion()),
      posDestino: informado
        ? informado.posicao.clone()
        : ossoDestino.getWorldPosition(new THREE.Vector3())
    };
  }

  const pais = new Map(HIERARQUIA);

  /* guinada e escala de altura */
  const lateralOrigem = new THREE.Vector3().subVectors(rest.armL.posOrigem, rest.armR.posOrigem);
  const lateralDestino = new THREE.Vector3().subVectors(rest.armL.posDestino, rest.armR.posDestino);
  const cimaDestino = new THREE.Vector3().subVectors(rest.neck.posDestino, rest.hips.posDestino);
  const guinada = calcularGuinada(lateralOrigem, lateralDestino, cimaDestino);
  const guinadaInversa = guinada.clone().invert();

  const alturaOrigem = rest.hips.posOrigem.y;
  const alturaDestino = rest.hips.posDestino.y;
  const escala = Math.abs(alturaOrigem) > 1e-3 ? alturaDestino / alturaOrigem : 1;

  /*
    Correção constante por osso, usada só no modo "local": leva o referencial
    do pai de origem para o referencial do pai de destino. É constante porque
    depende apenas dos repousos — nunca da pose.
  */
  const correcaoPai = {};
  const localRestOrigem = {};
  const localRestDestino = {};
  for (const [nome, pai] of HIERARQUIA) {
    const qPaiOrigem = pai ? rest[pai].quatOrigem : new THREE.Quaternion();
    const qPaiDestino = pai ? rest[pai].quatDestino : new THREE.Quaternion();
    localRestOrigem[nome] = qPaiOrigem.clone().invert().multiply(rest[nome].quatOrigem);
    localRestDestino[nome] = qPaiDestino.clone().invert().multiply(rest[nome].quatDestino);
    correcaoPai[nome] = pai
      ? qPaiDestino.clone().invert().multiply(qPaiOrigem)
      : new THREE.Quaternion();
  }

  /* deslocamento de repouso de cada osso em relação ao pai (para FK própria) */
  const deslocamentoRepouso = {};
  for (const [nome, pai] of HIERARQUIA) {
    deslocamentoRepouso[nome] = pai
      ? rest[nome].posDestino.clone().sub(rest[pai].posDestino)
      : rest[nome].posDestino.clone();
  }

  /*
    Direções reais de osso (não eixo fixo): para cada osso do FORJA que tem
    filho, a direção é a do filho menos o pai, nos dois rigs. É isso que o modo
    "direcao" copia — a pose que se vê, não a moldura interna do rig. O eixo
    fixo +Y do modo legado era justamente o que quebrava iClone e Mixamo.
  */
  /*
    Qual filho define a direção do osso. Tem de ser o que CONTINUA a cadeia
    (quadril→coluna, coluna→pescoço, braço→antebraço…), não "o primeiro filho
    que aparecer": usar o ombro como direção da coluna faz a torção do tronco
    virar rotação de ombro e desloca o braço ~4 cm.
  */
  const FILHO_DA_CADEIA = {
    hips: "spine", spine: "neck",
    armL: "elbowL", elbowL: "handL",
    armR: "elbowR", elbowR: "handR",
    legL: "kneeL", kneeL: "footL",
    legR: "kneeR", kneeR: "footR"
  };
  const filhoPrincipal = {};
  for (const [nome] of HIERARQUIA) {
    if (FILHO_DA_CADEIA[nome]) filhoPrincipal[nome] = FILHO_DA_CADEIA[nome];
  }
  const direcoes = {};
  for (const [nome] of HIERARQUIA) {
    const filho = filhoPrincipal[nome];
    if (!filho) { direcoes[nome] = null; continue; }
    const origem = rest[nome].posOrigem;
    const destino = rest[nome].posDestino;
    const dirOrigem = rest[filho].posOrigem.clone().sub(origem);
    const dirDestino = rest[filho].posDestino.clone().sub(destino);
    if (dirOrigem.lengthSq() < 1e-10 || dirDestino.lengthSq() < 1e-10) { direcoes[nome] = null; continue; }
    direcoes[nome] = {
      filho,
      restOrigem: dirOrigem.normalize(),
      restDestino: dirDestino.normalize()
    };
  }

  return {
    modo, mapa, passadas, rest, pais, guinada, guinadaInversa, escala,
    correcaoPai, localRestOrigem, localRestDestino, deslocamentoRepouso,
    alturaOrigem, alturaDestino, direcoes, filhoPrincipal
  };
}

/* ------------------------------------------------------------------ */
/* FK própria: posição de mundo de cada osso a partir dos quaternions  */
/* ------------------------------------------------------------------ */

export function calcularPosicoes(contexto, quats, hipsMundo) {
  const posicoes = { hips: hipsMundo.clone() };
  for (const [nome, pai] of HIERARQUIA) {
    if (!pai) continue;
    const deslocamento = contexto.deslocamentoRepouso[nome].clone()
      .applyQuaternion(quats[pai]);
    posicoes[nome] = posicoes[pai].clone().add(deslocamento);
  }
  return posicoes;
}

/* ------------------------------------------------------------------ */
/* Transferência                                                       */
/* ------------------------------------------------------------------ */

/*
  `clipeOrigem` pode ser o AnimationClip da origem. Devolve trilhas prontas para
  o `escreverClipeGLB`, mais um `diagnostico` medido em metros do destino:
  pés, quadril, punhos, joelhos, cotovelos, continuidade e inversão.
*/
export function transferirMovimento({
  cenaOrigem, ossosOrigem, alvo, mapa,
  contexto = null,
  repousoDestino = null,
  clipeOrigem,
  modo = "mundo",
  inicio = 0,
  duracao = 4,
  fps = 24,
  apoiar = true
}) {
  const ctx = contexto || prepararContexto({ cenaOrigem, ossosOrigem, alvo, modo, repousoDestino });
  const { rest, pais, guinada, guinadaInversa, escala, mapa: mapaOssos } = ctx;
  const mapaFinal = mapa || mapaOssos;

  const mixer = new THREE.AnimationMixer(cenaOrigem);
  const acao = mixer.clipAction(clipeOrigem);
  acao.play();

  const dur = Math.min(duracao, Math.max(0.2, clipeOrigem.duration - inicio));
  const total = Math.max(2, Math.round(dur * fps) + 1);

  const quatsPorQuadro = [];
  const hipsPorQuadro = [];
  const tempos = [];

  for (let i = 0; i < total; i += 1) {
    mixer.setTime(Math.min(inicio + i / fps, clipeOrigem.duration));
    cenaOrigem.updateMatrixWorld(true);

    const quats = {};
    for (const [nome, pai] of HIERARQUIA) {
      const osso = ossosOrigem.get(mapaFinal[nome]);
      const qPose = osso.getWorldQuaternion(new THREE.Quaternion());
      const r = rest[nome];

      if (modo === "direcao") {
        /*
          Copia a DIREÇÃO real do osso (filho − osso), nos dois rigs, e depois
          reaplica a torção relativa da origem em torno do eixo já transferido.
          Sem eixo fixo: a direção sai da própria geometria do rig, então serve
          para Rokoko, Mixamo, iClone e UE5, e não depende do roll do osso.
        */
        const d = ctx.direcoes[nome];
        if (!d) {
          /* osso folha (mão, pé, pescoço): sem filho, segue o delta local */
          const qPaiPose = ossosOrigem.get(mapaFinal[pai]).getWorldQuaternion(new THREE.Quaternion());
          const localPose = qPaiPose.clone().invert().multiply(qPose);
          const delta = localPose.multiply(ctx.localRestOrigem[nome].clone().invert());
          const f = ctx.correcaoPai[nome];
          const deltaNoPai = f.clone().multiply(delta).multiply(f.clone().invert());
          quats[nome] = quats[pai].clone().multiply(ctx.localRestDestino[nome]).multiply(deltaNoPai);
          continue;
        }

        const posOsso = osso.getWorldPosition(new THREE.Vector3());
        const posFilho = ossosOrigem.get(mapaFinal[d.filho]).getWorldPosition(new THREE.Vector3());
        const dirPoseOrigem = posFilho.sub(posOsso);
        if (dirPoseOrigem.lengthSq() < 1e-12) {
          quats[nome] = r.quatDestino.clone();
          continue;
        }
        dirPoseOrigem.normalize();
        const alvo = dirPoseOrigem.clone().applyQuaternion(guinada);

        /* balanço mínimo: repouso do destino → pose (guinada) da origem */
        const balanco = new THREE.Quaternion().setFromUnitVectors(d.restDestino, alvo);

        /* torção: quanto a origem girou em torno do próprio eixo, além do balanço */
        const deltaMundo = qPose.clone().multiply(r.quatOrigem.clone().invert());
        const balancoOrigem = new THREE.Quaternion().setFromUnitVectors(d.restOrigem, dirPoseOrigem);
        const torcaoOrigem = balancoOrigem.clone().invert().multiply(deltaMundo);
        const eixo = dirPoseOrigem;
        const anguloTorcao = 2 * Math.atan2(
          torcaoOrigem.x * eixo.x + torcaoOrigem.y * eixo.y + torcaoOrigem.z * eixo.z,
          torcaoOrigem.w
        );
        const torcao = new THREE.Quaternion().setFromAxisAngle(alvo, anguloTorcao);

        quats[nome] = torcao.multiply(balanco).multiply(r.quatDestino);
        continue;
      }

      if (modo === "mundo" || !pai) {
        /* Δw em mundo, guinada, e aplicado ao repouso do destino */
        const delta = qPose.clone().multiply(r.quatOrigem.clone().invert());
        quats[nome] = guinada.clone().multiply(delta).multiply(guinadaInversa).multiply(r.quatDestino);
        continue;
      }

      if (modo === "legado") {
        /* conta antiga: eixo fixo +Y. Fica aqui só para o "antes". */
        const Y = new THREE.Vector3(0, 1, 0);
        const qPaiPose = ossosOrigem.get(mapaFinal[pai]).getWorldQuaternion(new THREE.Quaternion());
        const localPose = qPaiPose.clone().invert().multiply(qPose);
        const dRest = Y.clone().applyQuaternion(ctx.localRestOrigem[nome]).normalize();
        const dPose = Y.clone().applyQuaternion(localPose).normalize();
        const balanco = new THREE.Quaternion().setFromUnitVectors(dRest, dPose);
        const localTgt = balanco.multiply(ctx.localRestDestino[nome]);
        quats[nome] = quats[pai].clone().multiply(localTgt);
        continue;
      }

      /* modo local: delta local conjugado para o referencial do pai do destino */
      const qPaiPose = ossosOrigem.get(mapaFinal[pai]).getWorldQuaternion(new THREE.Quaternion());
      const localPose = qPaiPose.clone().invert().multiply(qPose);
      const delta = localPose.multiply(ctx.localRestOrigem[nome].clone().invert());
      const f = ctx.correcaoPai[nome];
      const deltaNoPai = f.clone().multiply(delta).multiply(f.clone().invert());
      quats[nome] = quats[pai].clone().multiply(ctx.localRestDestino[nome]).multiply(deltaNoPai);
    }

    /* quadril: deslocamento de mundo escalado e guinado, relativo ao repouso */
    const ossoHips = ossosOrigem.get(mapaFinal.hips);
    const deslocamento = ossoHips.getWorldPosition(new THREE.Vector3())
      .sub(rest.hips.posOrigem)
      .multiplyScalar(escala)
      .applyQuaternion(guinada);
    const hipsMundo = rest.hips.posDestino.clone().add(deslocamento);

    quatsPorQuadro.push(quats);
    hipsPorQuadro.push(hipsMundo);
    tempos.push(i / fps);
  }

  /*
    Apoio no chão: um único deslocamento CONSTANTE em Y, para o pé mais baixo do
    clipe encostar no chão. Constante (não por quadro) para não destruir o
    movimento — o que se corrige é a altura do rig, não a animação. Com isso
    nenhum pé fica abaixo do chão, que é critério de aceitação.
  */
  const posicoesPorQuadro = quatsPorQuadro.map((quats, i) => calcularPosicoes(ctx, quats, hipsPorQuadro[i]));
  const peMaisBaixo = Math.min(...posicoesPorQuadro.map((posicoes) =>
    Math.min(posicoes.footL.y, posicoes.footR.y)));
  const ajusteChao = apoiar ? -peMaisBaixo : 0;
  const deslocamentoChao = new THREE.Vector3(0, ajusteChao, 0);
  if (apoiar) {
    for (let i = 0; i < hipsPorQuadro.length; i += 1) {
      hipsPorQuadro[i] = hipsPorQuadro[i].clone().add(deslocamentoChao);
      posicoesPorQuadro[i] = calcularPosicoes(ctx, quatsPorQuadro[i], hipsPorQuadro[i]);
    }
  }

  /* trilhas, com continuidade de sinal nos quaternions */
  const valoresRot = {};
  const valoresPos = {};
  for (const [nome] of HIERARQUIA) {
    valoresRot[nome] = [];
    if (nome === "hips") valoresPos[nome] = [];
  }
  const anterior = {};
  for (let i = 0; i < quatsPorQuadro.length; i += 1) {
    const quats = quatsPorQuadro[i];
    for (const [nome, pai] of HIERARQUIA) {
      const qPai = pai ? quats[pai] : new THREE.Quaternion();
      const local = qPai.clone().invert().multiply(quats[nome]);
      const ant = anterior[nome];
      if (ant && local.dot(ant) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      anterior[nome] = local.clone();
      valoresRot[nome].push(local.x, local.y, local.z, local.w);
      if (nome === "hips") valoresPos[nome].push(hipsPorQuadro[i].x, hipsPorQuadro[i].y, hipsPorQuadro[i].z);
    }
  }

  const trilhas = [];
  for (const [nome] of HIERARQUIA) {
    trilhas.push({ osso: nome, caminho: "rotation", valores: valoresRot[nome], componentes: 4 });
    if (nome === "hips") trilhas.push({ osso: nome, caminho: "translation", valores: valoresPos[nome], componentes: 3 });
  }

  const diagnostico = diagnosticar({ posicoesPorQuadro, tempos, fps, ajusteChao, guinada, escala });

  return {
    tempos,
    trilhas,
    duracao: dur,
    fps,
    modo,
    diagnostico,
    ossosDestino: Object.fromEntries(
      Array.from(alvo.ossos.entries()).map(([nome, osso]) => [nome, {
        pai: osso.parent && osso.parent.isBone ? osso.parent.name : null,
        posicao: osso.position.toArray().map(v => +v.toFixed(6)),
        rotacao: osso.quaternion.toArray().map(v => +v.toFixed(6)),
        escala: osso.scale.toArray().map(v => +v.toFixed(6))
      }])
    )
  };
}

/* ------------------------------------------------------------------ */
/* Diagnóstico                                                         */
/* ------------------------------------------------------------------ */

const graus = rad => (rad * 180) / Math.PI;

/* ângulo entre dois segmentos (membro) */
function anguloSegmentos(origem, meio, fim) {
  const a = new THREE.Vector3().subVectors(origem, meio);
  const b = new THREE.Vector3().subVectors(fim, meio);
  if (a.lengthSq() < 1e-12 || b.lengthSq() < 1e-12) return 0;
  return graus(a.angleTo(b));
}

export function diagnosticar({ posicoesPorQuadro, tempos, fps, ajusteChao = 0, guinada = null, escala = 1 }) {
  const serie = nome => posicoesPorQuadro.map(posicoes => +posicoes[nome].y.toFixed(4));
  const faixa = valores => ({
    min: +Math.min(...valores).toFixed(3),
    max: +Math.max(...valores).toFixed(3)
  });

  const quadril = serie("hips");
  const pes = [...serie("footL"), ...serie("footR")];
  const punhos = [...serie("handL"), ...serie("handR")];

  const joelhos = posicoesPorQuadro.map(posicoes => Math.min(
    anguloSegmentos(posicoes.legL, posicoes.kneeL, posicoes.footL),
    anguloSegmentos(posicoes.legR, posicoes.kneeR, posicoes.footR)
  ));
  const cotovelos = posicoesPorQuadro.map(posicoes => Math.min(
    anguloSegmentos(posicoes.armL, posicoes.elbowL, posicoes.handL),
    anguloSegmentos(posicoes.armR, posicoes.elbowR, posicoes.handR)
  ));

  /* continuidade: maior salto de qualquer osso entre dois quadros */
  let maiorSalto = 0;
  for (let i = 1; i < posicoesPorQuadro.length; i += 1) {
    for (const [nome] of HIERARQUIA) {
      const d = posicoesPorQuadro[i][nome].distanceTo(posicoesPorQuadro[i - 1][nome]);
      if (d > maiorSalto) maiorSalto = d;
    }
  }

  /*
    Inversão: em pé ou deitado, o quadril fica acima da média dos pés (no
    máximo à mesma altura, nunca muito abaixo). Se ficar abaixo, o rig virou.
  */
  const inversoes = posicoesPorQuadro.filter((posicoes) => {
    const mediaPes = (posicoes.footL.y + posicoes.footR.y) / 2;
    return mediaPes - posicoes.hips.y > 0.25;
  }).length;

  /* quadril e pés abaixo do chão */
  const abaixoDoChao = posicoesPorQuadro.filter((posicoes) =>
    Math.min(posicoes.footL.y, posicoes.footR.y) < -0.01).length;

  return {
    quadros: posicoesPorQuadro.length,
    duracao: +(posicoesPorQuadro.length / fps).toFixed(3),
    quadril: faixa(quadril),
    pes: faixa(pes),
    punhos: faixa(punhos),
    joelhoGraus: faixa(joelhos),
    cotoveloGraus: faixa(cotovelos),
    quadrilAcimaDoPe: faixa(posicoesPorQuadro.map(p => +((p.hips.y - (p.footL.y + p.footR.y) / 2)).toFixed(3))),
    maiorSaltoQuadro: +maiorSalto.toFixed(4),
    ajusteChao: +ajusteChao.toFixed(4),
    inversoes,
    quadrosAbaixoDoChao: abaixoDoChao,
    guinadaGraus: guinada ? +graus(2 * Math.acos(Math.min(1, Math.abs(guinada.w)))).toFixed(2) : 0,
    escalaAltura: +escala.toFixed(4)
  };
}

/* ------------------------------------------------------------------ */
/* Descontinuidade: pico contra a mediana, não limite fixo             */
/* ------------------------------------------------------------------ */

/*
  Movimento rápido não é defeito: um polichinelo move a mão ~0,2 m entre dois
  quadros a 24 fps, e isso é o exercício, não um salto. Defeito é
  DESCONTINUIDADE: um quadro que anda muito mais que os vizinhos do mesmo osso.

  Por isso a medida é o pico contra a mediana do próprio osso:
    pico = maior deslocamento entre quadros consecutivos;
    mediana = deslocamento típico daquele osso no clipe;
    razao = pico / mediana.
  Um salto de verdade dá razão dezenas de vezes; movimento rápido e contínuo
  fica perto de 2–4.
*/
export function medirDescontinuidade({ posicoesPorQuadro, escala = 1, janela = 5 }) {
  const porOsso = {};
  for (const [nome] of HIERARQUIA) {
    const deltas = [];
    for (let i = 1; i < posicoesPorQuadro.length; i += 1) {
      deltas.push(posicoesPorQuadro[i][nome].distanceTo(posicoesPorQuadro[i - 1][nome]) * escala);
    }
    if (deltas.length < 3) continue;

    /* razão de cada quadro contra a mediana dos VIZINHOS, não contra a do clipe:
       um trecho rápido inteiro (polichinelo) tem mediana alta e razão baixa;
       um quadro solto que anda muito mais que os vizinhos é descontinuidade. */
    let piorRazao = 0;
    let picoLocal = 0;
    let indicePior = 0;
    let medianaGlobal = 0;
    const ordenados = [...deltas].sort((a, b) => a - b);
    medianaGlobal = ordenados[Math.floor(ordenados.length / 2)];
    for (let i = 0; i < deltas.length; i += 1) {
      const vizinhos = [];
      for (let j = Math.max(0, i - janela); j <= Math.min(deltas.length - 1, i + janela); j += 1) {
        if (j !== i) vizinhos.push(deltas[j]);
      }
      if (vizinhos.length < 2) continue;
      vizinhos.sort((a, b) => a - b);
      const medianaVizinhos = vizinhos[Math.floor(vizinhos.length / 2)];
      const razao = deltas[i] / Math.max(medianaVizinhos, 1e-4);
      if (razao > piorRazao) {
        piorRazao = razao;
        picoLocal = deltas[i];
        indicePior = i;
      }
    }
    porOsso[nome] = {
      pico: +Math.max(...deltas).toFixed(4),
      mediana: +medianaGlobal.toFixed(4),
      razao: +piorRazao.toFixed(1),
      picoLocal: +picoLocal.toFixed(4),
      emSegundos: +((indicePior + 1) / 24).toFixed(3)
    };
  }
  const pior = Object.entries(porOsso).sort((a, b) => (b[1].razao || 0) - (a[1].razao || 0))[0];
  const picoGlobal = Object.values(porOsso).reduce((a, b) => Math.max(a, b.pico), 0);
  return {
    porOsso,
    piorOsso: pior ? pior[0] : null,
    piorRazao: pior ? pior[1].razao : null,
    piorPico: pior ? pior[1].picoLocal : null,
    piorSegundo: pior ? pior[1].emSegundos : null,
    picoGlobal: +picoGlobal.toFixed(4),
    /* razão ≥ 4 com pico ≥ 5 cm: um quadro que anda 4× mais que os vizinhos */
    descontinuo: Boolean(pior && pior[1].razao >= 4 && pior[1].picoLocal >= 0.05)
  };
}

/*
  Mede a própria origem, para separar defeito do arquivo de defeito da
  transferência: salto entre amostras e amplitude de movimento, em metros do
  destino (usa a mesma escala quadril→altura). Fonte que já pula não vira clipe
  bom — é fonte para rejeitar, não para "consertar".
*/
export function medirFonte({ cenaOrigem, ossosOrigem, clipeOrigem, mapa, escala = 1, fps = 24, inicio = 0, duracao = 4 }) {
  const mixer = new THREE.AnimationMixer(cenaOrigem);
  mixer.clipAction(clipeOrigem).play();
  const dur = Math.min(duracao, Math.max(0.2, clipeOrigem.duration - inicio));
  const total = Math.max(2, Math.round(dur * fps) + 1);
  const amostras = [];
  for (let i = 0; i < total; i += 1) {
    mixer.setTime(Math.min(inicio + i / fps, clipeOrigem.duration));
    cenaOrigem.updateMatrixWorld(true);
    const posicoes = {};
    for (const [nome] of HIERARQUIA) {
      posicoes[nome] = ossosOrigem.get(mapa[nome]).getWorldPosition(new THREE.Vector3());
    }
    amostras.push(posicoes);
  }
  let maiorSalto = 0;
  let somaSalto = 0;
  for (let i = 1; i < amostras.length; i += 1) {
    let salto = 0;
    for (const [nome] of HIERARQUIA) {
      salto = Math.max(salto, amostras[i][nome].distanceTo(amostras[i - 1][nome]));
    }
    maiorSalto = Math.max(maiorSalto, salto);
    somaSalto += salto;
  }
  const joelhos = amostras.map(a => Math.min(
    anguloSegmentos(a.legL, a.kneeL, a.footL),
    anguloSegmentos(a.legR, a.kneeR, a.footR)
  ));
  const cotovelos = amostras.map(a => Math.min(
    anguloSegmentos(a.armL, a.elbowL, a.handL),
    anguloSegmentos(a.armR, a.elbowR, a.handR)
  ));
  const faixa = valores => ({
    min: +Math.min(...valores).toFixed(2),
    max: +Math.max(...valores).toFixed(2)
  });
  const descontinuidade = medirDescontinuidade({ posicoesPorQuadro: amostras, escala });
  return {
    quadros: amostras.length,
    maiorSaltoQuadro: +(maiorSalto * escala).toFixed(4),
    descontinuidade,
    saltoMedioQuadro: +((somaSalto / Math.max(1, amostras.length - 1)) * escala).toFixed(4),
    joelhoGraus: faixa(joelhos),
    cotoveloGraus: faixa(cotovelos),
    punhoY: faixa(amostras.flatMap(a => [a.handL.y * escala, a.handR.y * escala])),
    peY: faixa(amostras.flatMap(a => [a.footL.y * escala, a.footR.y * escala]))
  };
}
