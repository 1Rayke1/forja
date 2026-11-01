#!/usr/bin/env node
/*
  FORJA — transferência de movimento de mocap para o rig de 16 ossos.

  Este é o substituto Node do antigo `tools/blender/retarget-mocap.py`: em vez de
  depender do Blender, lê o FBX (ou GLB) de origem, avalia a animação com o
  próprio three.js, calcula a rotação de mundo relativa ao repouso de cada osso e
  grava um GLB de clipe com a mesma estrutura dos 40 já publicados.

  Por que a matemática é esta:

    delta(b) = R_mundo_pose(b) · R_mundo_repouso(b)⁻¹        (o que a animação faz)

    R_destino(b) = G · delta(b) · G⁻¹ · R_repouso_destino(b)

  com G sendo a guinada que alinha a frente do rig de origem com a frente do rig
  do FORJA (calculada das linhas de ombro dos dois rigs em repouso). Transferir
  a rotação de mundo inteira — e não só a direção do osso — é o que preserva
  torção e hierarquia. Foi a troca da "direção do osso" pela "rotação de mundo
  relativa ao repouso" que tirou o personagem de cabeça para baixo.

  Uso:
    node tools/retransferir-mocap.mjs --origem tools/fontes-3d/06_Jumping_Jacks.fbx \
      --clipe polichinelo-mocap --saida /tmp/polichinelo-mocap.glb \
      [--inicio 0] [--duracao 4] [--fps 24] [--personagem masculino] [--validar]

  O clipe gerado NÃO é publicado por este script: ele só grava o arquivo e
  imprime as medidas. Publicar é decisão da validação (medida + imagem).
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

globalThis.self = globalThis;
globalThis.createImageBitmap = globalThis.createImageBitmap || (async () => ({ width: 2, height: 2, close() {} }));
if (typeof globalThis.URL.createObjectURL !== "function") {
  globalThis.URL.createObjectURL = () => "blob:retransferir";
  globalThis.URL.revokeObjectURL = () => {};
}

const THREE = await import(path.join(raiz, "assets/vendor/three/three.module.min.js"));
const { GLTFLoader } = await import(path.join(raiz, "assets/vendor/three/addons/loaders/GLTFLoader.js"));

/* ------------------------------------------------------------------ */
/* Argumentos                                                          */
/* ------------------------------------------------------------------ */

const argumentos = lista => {
  const saida = {};
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i];
    if (!item.startsWith("--")) continue;
    const chave = item.slice(2);
    const proximo = lista[i + 1];
    if (proximo && !proximo.startsWith("--")) {
      saida[chave] = proximo;
      i += 1;
    } else {
      saida[chave] = true;
    }
  }
  return saida;
};

const opcoes = argumentos(process.argv.slice(2));
if (!opcoes.origem || !opcoes.saida) {
  console.error("uso: --origem <fbx|glb> --saida <arquivo.glb> [--clipe id] [--inicio s] [--duracao s] [--fps 24] [--personagem masculino] [--validar]");
  process.exit(2);
}
const FPS = Number(opcoes.fps || 24);
const DURACAO = Number(opcoes.duracao || 4);
const INICIO = Number(opcoes.inicio || 0);
const PERSONAGEM = opcoes.personagem || "masculino";
const CLIPE = opcoes.clipe || path.basename(opcoes.saida, ".glb");
const MODO = opcoes.modo || "direcao";

/* ------------------------------------------------------------------ */
/* Mapa de ossos — origem → destino                                    */
/* ------------------------------------------------------------------ */

/*
  O mapa vive em `tools/lib/mapeamento-ossos.mjs` para ser testado isolado
  (tests/mapeamento3d.test.mjs) e casar os três vocabulários de rig em uso:
  Rokoko, Mixamo (com e sem dois-pontos) e iClone/UE5.
*/
const { HIERARQUIA_FORJA: HIERARQUIA, mapearOssos } =
  await import(path.join(raiz, "tools/lib/mapeamento-ossos.mjs"));

/* ------------------------------------------------------------------ */
/* Carregamento                                                        */
/* ------------------------------------------------------------------ */

const lerBytes = arquivo => {
  const buffer = fs.readFileSync(path.isAbsolute(arquivo) ? arquivo : path.join(raiz, arquivo));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

async function carregarPersonagem(slug) {
  const catalogo = JSON.parse(fs.readFileSync(path.join(raiz, "assets/3d/catalogo.json"), "utf8"));
  const bytes = lerBytes(catalogo.personagens[slug].arquivo);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(bytes, "", res, rej));
  const ossos = new Map();
  gltf.scene.traverse(objeto => { if (objeto.isBone) ossos.set(objeto.name, objeto); });
  return { cena: gltf.scene, ossos };
}

async function carregarOrigem(arquivo) {
  const caminho = path.isAbsolute(arquivo) ? arquivo : path.join(raiz, arquivo);
  const ext = path.extname(caminho).toLowerCase();
  if (ext === ".fbx") {
    const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
    const objeto = new FBXLoader().parse(lerBytes(caminho), path.dirname(caminho) + "/");
    return { cena: objeto, clipes: objeto.animations || [], tipo: "fbx" };
  }
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(lerBytes(caminho), "", res, rej));
  return { cena: gltf.scene, clipes: gltf.animations || [], tipo: "glb" };
}

/* ------------------------------------------------------------------ */
/* Gu finda: alinha a frente dos dois rigs em repouso                  */
/* ------------------------------------------------------------------ */

/*
  A linha dos ombros dá o eixo lateral. Com o eixo "para cima" do rig
  (hips→neck), a frente é o produto vetorial. A guinada G é a rotação em torno
  do eixo vertical que leva a lateral da origem na lateral do destino — assim o
  personagem não anda de lado nem de costas.
*/
function guinada(ossosOrigem, mapa, restOrigem, restDestino) {
  const lateralOrigem = new THREE.Vector3().subVectors(
    restOrigem.armL.getWorldPosition(new THREE.Vector3()),
    restOrigem.armR.getWorldPosition(new THREE.Vector3())
  ).setY(0);
  const lateralDestino = new THREE.Vector3().subVectors(
    restDestino.armL, restDestino.armR
  ).setY(0);
  if (lateralOrigem.lengthSq() < 1e-8 || lateralDestino.lengthSq() < 1e-8) return new THREE.Quaternion();
  lateralOrigem.normalize();
  lateralDestino.normalize();
  /* eixo vertical do destino = hips → neck */
  const cima = new THREE.Vector3().subVectors(restDestino.neck, restDestino.hips).normalize();
  const angulo = lateralOrigem.angleTo(lateralDestino);
  const sinal = new THREE.Vector3().crossVectors(lateralOrigem, lateralDestino).dot(cima) >= 0 ? 1 : -1;
  return new THREE.Quaternion().setFromAxisAngle(cima, angulo * sinal);
}

/* ------------------------------------------------------------------ */
/* Transferência                                                       */
/* ------------------------------------------------------------------ */

async function transferir() {
  const origem = await carregarOrigem(opcoes.origem);
  if (!origem.clipes.length) throw new Error("origem sem animação");
  const clipeOrigem = origem.clipes.reduce((a, b) => (a.duration >= b.duration ? a : b));

  const alvo = await carregarPersonagem(PERSONAGEM);
  alvo.cena.updateMatrixWorld(true);

  /* ossos da origem por nome, e o primeiro candidato que existe */
  const ossosOrigem = new Map();
  origem.cena.traverse(objeto => { if (objeto.isBone) ossosOrigem.set(objeto.name, objeto); });
  const { mapa, faltando, passadas } = mapearOssos(ossosOrigem.keys());
  if (faltando.length) {
    throw new Error("mapeamento incompleto, faltam: " + faltando.join(", ") +
      " (a origem tem " + ossosOrigem.size + " ossos; veja tools/lib/mapeamento-ossos.mjs)");
  }

  /*
    Repouso de mundo das duas pontas. Importante: isto é lido ANTES de o mixer
    tocar a animação. Ler "repouso" depois de aplicar o quadro 0 dá a pose do
    primeiro quadro, não o repouso do rig — e o delta inteiro sai errado.
  */
  const restOrigem = {};
  const restDestino = {};
  const restQuatOrigem = {};
  const restQuatDestino = {};
  origem.cena.updateMatrixWorld(true);
  alvo.cena.updateMatrixWorld(true);
  for (const [nome, nomeOrigem] of Object.entries(mapa)) {
    const ossoOrigem = ossosOrigem.get(nomeOrigem);
    const ossoDestino = alvo.ossos.get(nome);
    restOrigem[nome] = ossoOrigem;
    restQuatOrigem[nome] = ossoOrigem.getWorldQuaternion(new THREE.Quaternion());
    restDestino[nome] = ossoDestino.getWorldPosition(new THREE.Vector3());
    restQuatDestino[nome] = ossoDestino.getWorldQuaternion(new THREE.Quaternion());
  }
  const restDestinoMundo = {};
  for (const [nome, osso] of alvo.ossos) restDestinoMundo[nome] = osso.getWorldPosition(new THREE.Vector3());

  const mixerOrigem = new THREE.AnimationMixer(origem.cena);
  const acao = mixerOrigem.clipAction(clipeOrigem);
  acao.play();

  /* pais mapeados nas duas pontas: a transferência por direção é relativa ao pai */
  const paiDestino = new Map(HIERARQUIA);
  const paiOrigem = {};
  for (const [nome] of HIERARQUIA) {
    const pai = paiDestino.get(nome);
    paiOrigem[nome] = pai ? mapa[pai] : null;
  }
  const restQuatOrigemPorNome = {};
  for (const [nome, nomeOrigem] of Object.entries(mapa)) {
    restQuatOrigemPorNome[nome] = ossosOrigem.get(nomeOrigem).getWorldQuaternion(new THREE.Quaternion());
  }

  /*
    Correção de repouso por osso, calculada UMA vez: leva o eixo do osso de
    repouso do destino para o eixo do osso de repouso da origem (nas molduras
    dos respectivos pais). Com ela constante, o balanço por quadro é sempre
    pequeno — era o `setFromUnitVectors` do repouso do destino direto na pose da
    origem que estourava (eixo indefinido perto de 180°) e produzia o salto de
    0,8 m entre dois quadros.
  */
  const Y = new THREE.Vector3(0, 1, 0);
  const correcaoRepouso = {};
  const restLocalSrc = {};
  for (const [nome, pai] of HIERARQUIA) {
    const localSrcRest = pai
      ? restQuatOrigemPorNome[pai].clone().invert().multiply(restQuatOrigemPorNome[nome])
      : restQuatOrigemPorNome[nome].clone();
    restLocalSrc[nome] = localSrcRest;
    if (!pai) {
      correcaoRepouso[nome] = new THREE.Quaternion();
      continue;
    }
    const localTgtRest = restQuatDestino[pai].clone().invert().multiply(restQuatDestino[nome]);
    const dRestSrc = Y.clone().applyQuaternion(localSrcRest).normalize();
    const dRestTgt = Y.clone().applyQuaternion(localTgtRest).normalize();
    correcaoRepouso[nome] = new THREE.Quaternion().setFromUnitVectors(dRestTgt, dRestSrc);
  }

  const G = guinada(ossosOrigem, mapa, restOrigem, restDestino);
  const Ginv = G.clone().invert();

  /* amostragem */
  const duracao = Math.min(DURACAO, Math.max(0.2, clipeOrigem.duration - INICIO));
  const total = Math.max(2, Math.round(duracao * FPS) + 1);
  const tempos = [];
  const amostras = [];

  const alturaDestino = restDestinoMundo.hips.y;
  const alturaOrigem = restOrigem.hips.getWorldPosition(new THREE.Vector3()).y;
  const escala = alturaOrigem > 0.01 ? alturaDestino / alturaOrigem : 1;

  for (let i = 0; i < total; i += 1) {
    const t = INICIO + (i / FPS);
    mixerOrigem.setTime(t);
    origem.cena.updateMatrixWorld(true);

    const quats = {};
    const Y = new THREE.Vector3(0, 1, 0);

    if (MODO === "delta") {
      for (const [nome, nomeOrigem] of Object.entries(mapa)) {
        const osso = ossosOrigem.get(nomeOrigem);
        const qPose = osso.getWorldQuaternion(new THREE.Quaternion());
        const delta = qPose.clone().multiply(restQuatOrigem[nome].clone().invert());
        quats[nome] = G.clone().multiply(delta).multiply(Ginv).multiply(restQuatDestino[nome]);
      }
    } else {
      /*
        Transferência por DIREÇÃO relativa ao pai: a direção do osso no quadro da
        animação é levada para o quadro do pai do destino. É o que faz o braço
        chegar acima da cabeça mesmo quando o repouso da origem (T) e o do
        destino (A) são diferentes: o que se copia é a pose, não o delta.
      */
      for (const [nome, pai] of HIERARQUIA) {
        const nomeOrigem = mapa[nome];
        const osso = ossosOrigem.get(nomeOrigem);
        const qPose = osso.getWorldQuaternion(new THREE.Quaternion());

        if (!pai) {
          quats[nome] = qPose.clone().multiply(restQuatOrigemPorNome[nome].clone().invert())
            .premultiply(G).multiply(Ginv).multiply(restQuatDestino[nome]);
          continue;
        }

        const qPaiSrcPose = ossosOrigem.get(mapa[pai]).getWorldQuaternion(new THREE.Quaternion());
        const localSrcPose = qPaiSrcPose.clone().invert().multiply(qPose);
        const localTgtRest = restQuatDestino[pai].clone().invert().multiply(restQuatDestino[nome]);

        const dRestSrc = Y.clone().applyQuaternion(restLocalSrc[nome]).normalize();
        const dSrcPose = Y.clone().applyQuaternion(localSrcPose).normalize();

        /* balanço relativo ao repouso da origem: pequeno e contínuo */
        const balanco = new THREE.Quaternion().setFromUnitVectors(dRestSrc, dSrcPose);

        /* torção em torno do próprio eixo, extraída do delta de origem */
        const deltaSrc = localSrcPose.clone().multiply(restLocalSrc[nome].clone().invert());
        const torcaoResidual = balanco.clone().invert().multiply(deltaSrc);
        const anguloTorcao = 2 * Math.acos(Math.min(1, Math.abs(torcaoResidual.w)));
        const sinalTorcao = torcaoResidual.w >= 0 ? 1 : -1;
        const qTorcao = new THREE.Quaternion().setFromAxisAngle(dSrcPose, anguloTorcao * sinalTorcao);

        const localTgtPose = qTorcao.clone()
          .multiply(balanco)
          .multiply(correcaoRepouso[nome])
          .multiply(localTgtRest);

        quats[nome] = quats[pai].clone().multiply(localTgtPose);
      }
    }

    /* quadril: translação de mundo relativa ao repouso, escalada e guinada */
    const hipsOrigem = ossosOrigem.get(mapa.hips);
    const deslocamento = hipsOrigem.getWorldPosition(new THREE.Vector3())
      .sub(restOrigem.hips.getWorldPosition(new THREE.Vector3()))
      .multiplyScalar(escala)
      .applyQuaternion(G);
    const hipsMundo = restDestinoMundo.hips.clone().add(deslocamento);

    amostras.push({ t: i / FPS, quats, hipsMundo });
    tempos.push(i / FPS);
  }

  /* conversão para rotação local do destino, pai antes de filho */
  const pais = new Map(HIERARQUIA);
  const trilhas = [];
  const valoresRot = {};
  const valoresPos = {};
  for (const [nome] of HIERARQUIA) {
    valoresRot[nome] = [];
    if (nome === "hips") valoresPos[nome] = [];
  }
  let anterior = {};
  for (const amostra of amostras) {
    const mundo = {};
    for (const [nome, pai] of HIERARQUIA) {
      mundo[nome] = amostra.quats[nome].clone();
      const qPai = pai ? mundo[pai] : new THREE.Quaternion();
      const local = qPai.clone().invert().multiply(mundo[nome]);
      /* continuidade de sinal: quaternion e o seu negativo são a mesma rotação,
         mas a interpolação não sabe disso — sem isso o membro gira pelo caminho
         longo entre dois quadros. */
      const ant = anterior[nome];
      if (ant && local.dot(ant) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      anterior[nome] = local;
      valoresRot[nome].push(local.x, local.y, local.z, local.w);

      if (nome === "hips") {
        const paiMundo = new THREE.Vector3(0, 0, 0); /* raiz do clipe */
        const localPos = amostra.hipsMundo.clone().sub(paiMundo);
        valoresPos[nome].push(localPos.x, localPos.y, localPos.z);
      }
      mundo[nome] = mundo[nome].clone();
    }
  }

  for (const [nome, pai] of HIERARQUIA) {
    trilhas.push({ osso: nome, caminho: "rotation", valores: valoresRot[nome], componentes: 4 });
    if (nome === "hips") {
      trilhas.push({ osso: nome, caminho: "translation", valores: valoresPos[nome], componentes: 3 });
    }
    if (pai === null && nome !== "hips") continue;
  }

  return {
    clipe: CLIPE,
    origem: path.basename(opcoes.origem),
    personagem: PERSONAGEM,
    guinada: { eixo: [+G.x.toFixed(5), +G.y.toFixed(5), +G.z.toFixed(5), +G.w.toFixed(5)],
      anguloGraus: +(2 * Math.acos(Math.min(1, Math.abs(G.w))) * 180 / Math.PI).toFixed(2) },
    escalaAltura: +escala.toFixed(4),
    duracao: +duracao.toFixed(3),
    fps: FPS,
    totalAmostras: total,
    mapeados: Object.keys(mapa).length,
    passadasDoMapa: passadas,
    tempos,
    trilhas,
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
/* Escritor GLB (só hierarquia de ossos + animação)                    */
/* ------------------------------------------------------------------ */

import { escreverClipeGLB } from "./lib/clipe-3d.mjs";
/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

const dados = await transferir();
const bytes = escreverClipeGLB(dados, opcoes.saida);
console.log("[retransferir]", JSON.stringify({
  clipe: dados.clipe,
  origem: dados.origem,
  clipeOrigemDuracoes: undefined,
  guinadaGraus: dados.guinada.anguloGraus,
  escalaAltura: dados.escalaAltura,
  duracao: dados.duracao,
  fps: dados.fps,
  amostras: dados.totalAmostras,
  mapeados: dados.mapeados,
  bytes,
  arquivo: opcoes.saida
}, null, 0));
