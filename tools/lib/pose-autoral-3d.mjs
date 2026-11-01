#!/usr/bin/env node
/*
  FORJA — animações autorais (por keyframe/geometria) para os exercícios que
  mocap não cobre: flexão de braço, prancha e mountain climber.

  Por que geometria e não "um número mágico por osso": nestes três exercícios o
  que decide se está certo não é a pose bonita, é o CONTATO e o ALINHAMENTO —
  mão no chão, pé no chão, tronco e quadril na mesma linha. Então a pose é
  resolvida como corpo rígido apoiado entre dois pontos:

    · o corpo (pé → joelho → quadril → coluna → ombro) é rígido, inclinado β;
    · os pés ficam plantados na origem do apoio;
    · as mãos ficam plantadas num ponto fixo do chão;
    · a flexão do cotovelo é CONSEQUÊNCIA da distância ombro↔punho — quem desce
      é o corpo, o braço resolve sozinho por IK de dois ossos;
    · pernas que saem do apoio (mountain climber) usam IK de dois ossos com o
      joelho apontando para frente.

  Assim "mão no chão", "pé no chão" e "ombro sobre a mão" são verdade por
  construção; os testes só conferem que continuam verdadeiros no GLB gravado.

  Nada aqui grava no catálogo: quem escreve é `tools/autorar-exercicios-3d.mjs`,
  em `docs/validacao-3d/fase4/candidatos/`.
*/
import { THREE, HIERARQUIA } from "./clipe-3d.mjs";

/* ------------------------------------------------------------------ */
/* Medidas do rig                                                      */
/* ------------------------------------------------------------------ */

const normalizar = v => v.clone().normalize();
const GRAU = Math.PI / 180;

/* filhos usados para tirar a direção de repouso de cada osso */
const FILHO = {
  hips: "spine", spine: "neck", neck: null,
  armL: "elbowL", elbowL: "handL", handL: null,
  armR: "elbowR", elbowR: "handR", handR: null,
  legL: "kneeL", kneeL: "footL", footL: null,
  legR: "kneeR", kneeR: "footR", footR: null
};

export function medirRig(alvo) {
  alvo.cena.updateMatrixWorld(true);
  const pos = {};
  const quat = {};
  for (const [nome] of HIERARQUIA) {
    const osso = alvo.ossos.get(nome);
    pos[nome] = osso.getWorldPosition(new THREE.Vector3());
    quat[nome] = osso.getWorldQuaternion(new THREE.Quaternion());
  }
  const pai = new Map(HIERARQUIA);
  const distancia = (a, b) => pos[a].distanceTo(pos[b]);

  /*
    Rig Y-para-cima olhando para +Z (conferido na malha: tórax/nariz em +Z) e
    esquerda do personagem em +X (armL em X positivo). Repouso: braços ao lado
    do corpo, pernas retas, pés para frente.
  */
  const cima = new THREE.Vector3(0, 1, 0);
  const frente = new THREE.Vector3(0, 0, 1);
  const lateral = new THREE.Vector3(1, 0, 0);

  const tornozelo = (pos.footL.y + pos.footR.y) / 2;
  const ombro = (pos.armL.y + pos.armR.y) / 2;

  /* pegada do pé: o osso do pé é folha, então o vetor útil é o da sola
     (tornozelo → ponta do pé), medido na malha em repouso. */
  const pontaPe = 2.18 * tornozelo;
  const solaRepouso = new THREE.Vector3(0, -tornozelo, pontaPe);
  /* no repouso os braços ficam ao lado do corpo: os dedos apontam para BAIXO */
  const maoRepouso = normalizar(pos.handL.clone().sub(pos.elbowL));

  const direcaoRepouso = {};
  for (const [nome] of HIERARQUIA) {
    const filho = FILHO[nome];
    if (filho) direcaoRepouso[nome] = normalizar(pos[filho].clone().sub(pos[nome]));
    else if (nome.startsWith("foot")) direcaoRepouso[nome] = normalizar(solaRepouso.clone());
    else if (nome.startsWith("hand")) direcaoRepouso[nome] = maoRepouso.clone();
    else direcaoRepouso[nome] = cima.clone();
  }

  return {
    alvo, pos, quat, pai, cima, frente, lateral,
    direcaoRepouso,
    pe: { tornozelo, ponta: pontaPe, solaRepouso: normalizar(solaRepouso.clone()) },
    comprimento: {
      coxa: distancia("legL", "kneeL"),
      canela: distancia("kneeL", "footL"),
      braco: distancia("armL", "elbowL"),
      antebraco: distancia("elbowL", "handL"),
      coluna: distancia("hips", "spine"),
      pescoco: distancia("spine", "neck")
    },
    /* distância ombro↔tornozelo projetada no plano sagital: é ela que dá a
       inclinação do corpo quando o pé está plantado */
    corpo: Math.hypot(pos.armL.y - pos.footL.y, pos.armL.z - pos.footL.z)
  };
}

/* ------------------------------------------------------------------ */
/* Ferramentas                                                         */
/* ------------------------------------------------------------------ */

/* rotação mínima que leva a direção de repouso na direção desejada */
export function balanco(origem, destino) {
  return new THREE.Quaternion().setFromUnitVectors(normalizar(origem), normalizar(destino));
}

/* IK de dois ossos: raiz A, alvo B, comprimentos l1/l2, joelho/cotovelo no
   sentido do vetor `polo`. */
export function ikDoisOssos(A, B, l1, l2, polo) {
  const delta = new THREE.Vector3().subVectors(B, A);
  const bruto = delta.length();
  const minimo = Math.abs(l1 - l2) + 1e-4;
  const maximo = l1 + l2 - 1e-4;
  const d = Math.min(Math.max(bruto, minimo), maximo);
  const direcao = bruto > 1e-6 ? delta.clone().divideScalar(bruto) : new THREE.Vector3(0, -1, 0);
  const aoLongo = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const altura = Math.sqrt(Math.max(0, l1 * l1 - aoLongo * aoLongo));
  let perpendicular = polo.clone().sub(direcao.clone().multiplyScalar(polo.dot(direcao)));
  if (perpendicular.lengthSq() < 1e-8) perpendicular = new THREE.Vector3(0, 0, 1);
  const meio = A.clone()
    .add(direcao.clone().multiplyScalar(aoLongo))
    .add(normalizar(perpendicular).multiplyScalar(altura));
  return { meio, alcancavel: bruto <= maximo && bruto >= minimo, distancia: bruto };
}

/* ------------------------------------------------------------------ */
/* Corpo rígido apoiado: inclinação β com os pés plantados             */
/* ------------------------------------------------------------------ */

/*
  β = ângulo do corpo acima da horizontal (0 = deitado, π/2 = em pé).
  O quadril sai do tornozelo: corpo rígido, basta girar a perna de repouso.
*/
export function corpoInclinado(rig, { beta, tornozelo }) {
  const rotacao = balanco(rig.cima, new THREE.Vector3(0, Math.sin(beta), Math.cos(beta)));
  const quadril = tornozelo.clone()
    .sub(rig.pos.footL.clone().sub(rig.pos.hips).applyQuaternion(rotacao));
  const ombro = quadril.clone()
    .add(rig.pos.armL.clone().sub(rig.pos.hips).applyQuaternion(rotacao));
  return { rotacao, quadril, ombro };
}

/* β que coloca o ombro na altura pedida (pé plantado em `tornozelo`) */
export function inclinacaoParaOmbro(rig, { alturaOmbro, tornozelo }) {
  const sen = (alturaOmbro - tornozelo.y) / rig.corpo;
  return Math.asin(Math.max(-1, Math.min(1, sen)));
}

/* altura do tornozelo para o pé ficar apoiado na ponta, com o pé inclinado */
export function alturaTornozeloEmPe(rig, inclinacaoGrau) {
  const a = rig.pe.tornozelo;
  const b = rig.pe.ponta;
  const t = inclinacaoGrau * GRAU;
  return a * Math.cos(t) + b * Math.sin(t);
}

/* direção da sola (tornozelo → ponta) com o pé inclinado `grau` na ponta */
export function direcaoSola(rig, inclinacaoGrau) {
  const a = rig.pe.tornozelo;
  const b = rig.pe.ponta;
  const t = inclinacaoGrau * GRAU;
  return new THREE.Vector3(0, -(a * Math.cos(t) + b * Math.sin(t)), -a * Math.sin(t) + b * Math.cos(t));
}

/* ------------------------------------------------------------------ */
/* Direções do corpo rígido                                            */
/* ------------------------------------------------------------------ */

function direcoesCorpoRigido(rig, rotacao, inclinacaoPe) {
  const eixo = new THREE.Vector3(0, 1, 0).applyQuaternion(rotacao);
  /* ossos de perna apontam do quadril para o pé: é −eixo, não +eixo */
  const perna = eixo.clone().negate();
  const sola = direcaoSola(rig, inclinacaoPe);
  return {
    hips: eixo.clone(), spine: eixo.clone(), neck: eixo.clone(),
    legL: perna.clone(), legR: perna.clone(), kneeL: perna.clone(), kneeR: perna.clone(),
    footL: sola.clone(), footR: sola.clone()
  };
}

/* ------------------------------------------------------------------ */
/* Montagem: direções → quaternions → FK (posições reais)              */
/* ------------------------------------------------------------------ */

export function montarPose(rig, { direcoes, quadril, giroExtra = {} }) {
  const quatsMundo = {};
  for (const [nome, pai] of HIERARQUIA) {
    const alvo = direcoes[nome];
    if (alvo) {
      quatsMundo[nome] = (giroExtra[nome] || new THREE.Quaternion())
        .multiply(balanco(rig.direcaoRepouso[nome], alvo))
        .multiply(rig.quat[nome]);
    } else if (pai && quatsMundo[pai]) {
      quatsMundo[nome] = quatsMundo[pai].clone();
    } else {
      quatsMundo[nome] = rig.quat[nome].clone();
    }
  }

  const posicoes = { hips: quadril.clone() };
  for (const [nome, pai] of HIERARQUIA) {
    if (!pai) continue;
    posicoes[nome] = posicoes[pai].clone().add(
      rig.pos[nome].clone().sub(rig.pos[pai]).applyQuaternion(quatsMundo[pai])
    );
  }

  const locais = {};
  for (const [nome, pai] of HIERARQUIA) {
    const qPai = pai ? quatsMundo[pai] : new THREE.Quaternion();
    locais[nome] = qPai.clone().invert().multiply(quatsMundo[nome]);
  }
  return { quatsMundo, locais, posicoes, quadril };
}

/* posição real de um osso filho do quadril no corpo já inclinado */
function raizDe(rig, quadril, rotacao, nome) {
  return quadril.clone().add(rig.pos[nome].clone().sub(rig.pos.hips).applyQuaternion(rotacao));
}

/* braço por IK: direção do braço e do antebraço a partir do ombro real */
function direcoesBraco(rig, { ombro, punho, lado, polo }) {
  const lado1 = lado === "L" ? "armL" : "armR";
  const lado2 = lado === "L" ? "elbowL" : "elbowR";
  const lado3 = lado === "L" ? "handL" : "handR";
  const { meio, alcancavel, distancia } = ikDoisOssos(
    ombro, punho, rig.comprimento.braco, rig.comprimento.antebraco, polo
  );
  const direcoes = {};
  direcoes[lado1] = normalizar(meio.clone().sub(ombro));
  direcoes[lado2] = normalizar(punho.clone().sub(meio));
  direcoes[lado3] = normalizar(rig.frente.clone().add(new THREE.Vector3(0, -0.15, 0)));
  return { direcoes, cotovelo: meio, alcancavel, distancia };
}

function direcoesPerna(rig, { quadril, tornozelo, lado, polo, pontaPe }) {
  const lado1 = lado === "L" ? "legL" : "legR";
  const lado2 = lado === "L" ? "kneeL" : "kneeR";
  const lado3 = lado === "L" ? "footL" : "footR";
  const { meio, alcancavel, distancia } = ikDoisOssos(
    quadril, tornozelo, rig.comprimento.coxa, rig.comprimento.canela, polo
  );
  const direcoes = {};
  direcoes[lado1] = normalizar(meio.clone().sub(quadril));
  direcoes[lado2] = normalizar(tornozelo.clone().sub(meio));
  direcoes[lado3] = pontaPe;
  return { direcoes, joelho: meio, alcancavel, distancia };
}

/* ------------------------------------------------------------------ */
/* Exercícios                                                          */
/* ------------------------------------------------------------------ */

const alisar = u => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

/* interpolação suave por pontos de controle [[u, valor], ...] */
function curvaSuave(u, pontos) {
  if (u <= pontos[0][0]) return pontos[0][1];
  for (let i = 1; i < pontos.length; i += 1) {
    const [u1, v1] = pontos[i];
    const [u0, v0] = pontos[i - 1];
    if (u <= u1) return v0 + (v1 - v0) * alisar((u - u0) / (u1 - u0));
  }
  return pontos[pontos.length - 1][1];
}

/* ---------------- flexão de braço ---------------- */
function flexao(rig, t, cfg) {
  const ciclo = t / cfg.periodo;
  const fase = ciclo % 1;
  /* 0..0.45 desce, segura, 0.55..1 sobe */
  let queda;
  if (fase < 0.44) queda = alisar(fase / 0.44);
  else if (fase < 0.56) queda = 1;
  else queda = 1 - alisar((fase - 0.56) / 0.44);

  const alturaOmbro = cfg.ombroAlto + (cfg.ombroBaixo - cfg.ombroAlto) * queda;
  const beta = inclinacaoParaOmbro(rig, { alturaOmbro, tornozelo: cfg.tornozelo });
  const { rotacao, quadril, ombro } = corpoInclinado(rig, { beta, tornozelo: cfg.tornozelo });
  const direcoes = direcoesCorpoRigido(rig, rotacao, cfg.inclinacaoPe);

  const detalhe = {};
  for (const lado of ["L", "R"]) {
    const alvo = cfg.punho[lado].clone();
    /* a mão fica plantada; o ombro é que viaja */
    const braco = direcoesBraco(rig, {
      ombro: raizDe(rig, quadril, rotacao, `arm${lado}`),
      punho: alvo,
      lado,
      polo: cfg.poloBraco[lado]
    });
    Object.assign(direcoes, braco.direcoes);
    detalhe[lado] = { cotovelo: braco.cotovelo, alcancavel: braco.alcancavel, punho: alvo };
  }
  const ombroMedio = raizDe(rig, quadril, rotacao, "armL").add(raizDe(rig, quadril, rotacao, "armR")).multiplyScalar(0.5);
  return { direcoes, quadril, detalhe, ombro: ombroMedio, parametros: { beta, alturaOmbro, queda } };
}

/* ---------------- prancha (antebraço) ---------------- */
function prancha(rig, t, cfg) {
  const { rotacao, quadril, ombro } = corpoInclinado(rig, { beta: cfg.beta, tornozelo: cfg.tornozelo });
  const direcoes = direcoesCorpoRigido(rig, rotacao, cfg.inclinacaoPe);

  const detalhe = {};
  for (const lado of ["L", "R"]) {
    const ombroLado = raizDe(rig, quadril, rotacao, `arm${lado}`);
    /* braço na vertical, antebraço deitado no chão apontando para frente */
    const cotovelo = ombroLado.clone().add(new THREE.Vector3(0, -rig.comprimento.braco, 0));
    const punho = cotovelo.clone().add(new THREE.Vector3(0, 0, rig.comprimento.antebraco));
    direcoes[`arm${lado}`] = new THREE.Vector3(0, -1, 0);
    direcoes[`elbow${lado}`] = new THREE.Vector3(0, 0, 1);
    direcoes[`hand${lado}`] = new THREE.Vector3(0, -0.15, 1);
    detalhe[lado] = { cotovelo, punho };
  }

  /* respiração só no pescoço: mexe no tronco alto e não move mão nem pé */
  const respiracao = Math.sin((2 * Math.PI * t) / cfg.periodoRespiracao);
  const giroExtra = { neck: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.2 * GRAU * respiracao) };

  return { direcoes, quadril, detalhe, giroExtra, parametros: { beta: cfg.beta, respiracao } };
}

/* ---------------- mountain climber ---------------- */

/* direção de um segmento de perna: ângulo no plano sagital + abdução lateral */
function dirPerna(anguloGrau, abducaoGrau, lado) {
  const a = anguloGrau * GRAU;
  const l = abducaoGrau * GRAU;
  const x = lado === "L" ? 1 : -1;
  return new THREE.Vector3(
    Math.sin(l) * x,
    Math.cos(l) * Math.sin(a),
    Math.cos(l) * Math.cos(a)
  ).normalize();
}

function mountainClimber(rig, t, cfg) {
  const { rotacao, quadril } = corpoInclinado(rig, { beta: cfg.beta, tornozelo: cfg.tornozelo });
  const direcoes = direcoesCorpoRigido(rig, rotacao, cfg.inclinacaoPe);

  const detalhe = {};
  for (const lado of ["L", "R"]) {
    const braco = direcoesBraco(rig, {
      ombro: raizDe(rig, quadril, rotacao, `arm${lado}`),
      punho: cfg.punho[lado].clone(),
      lado,
      polo: cfg.poloBraco[lado]
    });
    Object.assign(direcoes, braco.direcoes);

    /*
      A perna que dirige não é posicionada por alvo de pé: com o quadril baixo
      da prancha (0,43 m) e coxa de 0,44 m, um alvo de pé "na frente" obriga o
      joelho a atravessar o chão ou a dobrar a 15°. Então a perna é dirigida por
      ÂNGULO: a coxa varre de "estendida atrás" até "joelho no peito", com
      flexão de joelho e uma leve abdução no meio do arco (é o que o joelho faz
      na vida real para não raspar o chão).
    */
    /*
      Metade do ciclo apoiada, metade no ar — e as duas pernas defasadas em meio
      ciclo. Um triângulo simples (sobe e desce) deixaria as DUAS pernas no ar na
      mesma hora, ou seja, o personagem sem apoio; o teste de contato pegava isso.
    */
    const fase = ((t / cfg.periodo) + (lado === "L" ? 0 : 0.5)) % 1;
    const dentro = fase < 0.5 ? null : (fase - 0.5) / 0.5;
    const avanco = dentro === null
      ? 0
      : alisar(Math.min(1, dentro * 2)) * alisar(Math.min(1, (1 - dentro) * 2));

    const raiz = raizDe(rig, quadril, rotacao, `leg${lado}`);
    const repouso = rig.pos[`knee${lado}`].clone().sub(rig.pos[`leg${lado}`])
      .applyQuaternion(rotacao);
    /* normaliza para [0,360) senão a interpolação dá uma volta inteira */
    const anguloPlantado = (((Math.atan2(repouso.y, repouso.z) * 180) / Math.PI) + 360) % 360;

    const angulo = anguloPlantado + (cfg.anguloJoelhoFrente - anguloPlantado) * avanco;
    /*
      A flexão do joelho NÃO cresce junto com o quadril: ela tem de ser máxima no
      meio do arco, quando o joelho passa baixo e o calcanhar sobe (senão a
      canela fura o chão). Depois alivia para o pé chegar embaixo do peito.
    */
    const flexao = curvaSuave(avanco, cfg.curvaFlexao);
    const abducao = cfg.abducao * Math.sin(Math.PI * avanco);

    direcoes[`leg${lado}`] = dirPerna(angulo, abducao, lado);
    direcoes[`knee${lado}`] = dirPerna(angulo - flexao, abducao * 0.4, lado);
    /*
      Pé que viaja não fica em ponta como o pé apoiado: ele vai neutro/dorsiflex
      (dedos à frente). Além de ser o que o pé faz no exercício, é o que impede
      a ponta de furar o chão quando a canela passa na vertical.
    */
    const sola = direcaoSola(rig, cfg.inclinacaoPe).normalize()
      .lerp(cfg.solaNeutra, alisar(avanco)).normalize();
    direcoes[`foot${lado}`] = sola;

    const joelho = raiz.clone().add(direcoes[`leg${lado}`].clone().multiplyScalar(rig.comprimento.coxa));
    const tornozelo = joelho.clone().add(direcoes[`knee${lado}`].clone().multiplyScalar(rig.comprimento.canela));
    detalhe[lado] = { joelho, tornozelo, avanco };
  }

  const ombroMedio = raizDe(rig, quadril, rotacao, "armL")
    .add(raizDe(rig, quadril, rotacao, "armR")).multiplyScalar(0.5);
  return { direcoes, quadril, detalhe, ombro: ombroMedio, parametros: { beta: cfg.beta } };
}

/* ------------------------------------------------------------------ */
/* Configuração por exercício/personagem                               */
/* ------------------------------------------------------------------ */

const INCLINACAO_PE = 40;      /* pé na ponta, heel levantado */
const ALTURA_MAO = 0.030;      /* punho acima do chão (espessura da mão) */

export function configurar(rig, exercicio, ajustes = {}) {
  const tornozeloY = alturaTornozeloEmPe(rig, INCLINACAO_PE);
  const tornozelo = new THREE.Vector3(rig.pos.footL.x, tornozeloY, rig.pos.footL.z);
  const tornozeloR = new THREE.Vector3(rig.pos.footR.x, tornozeloY, rig.pos.footR.z);

  const braco = rig.comprimento.braco;
  const antebraco = rig.comprimento.antebraco;
  const ombroAlto = braco + antebraco + ALTURA_MAO;
  const betaAlto = inclinacaoParaOmbro(rig, { alturaOmbro: ombroAlto, tornozelo });
  const ombroDesejado = ombroAlto;

  /* posição do punho na prancha alta: debaixo do ombro */
  const corpoAlto = corpoInclinado(rig, { beta: betaAlto, tornozelo });
  const punhoAlto = {
    L: new THREE.Vector3(rig.pos.armL.x, ALTURA_MAO, corpoAlto.ombro.z),
    R: new THREE.Vector3(rig.pos.armR.x, ALTURA_MAO, corpoAlto.ombro.z)
  };

  const poloBraco = {
    L: new THREE.Vector3(0.55, -0.35, -1),
    R: new THREE.Vector3(-0.55, -0.35, -1)
  };

  if (exercicio === "flexao") {
    const ombroBaixo = ombroAlto - (ajustes.profundidade || 0.28);
    return {
      nome: exercicio,
      /* duração = múltiplo exato do período e de 1/24 s: o clipe fecha no
         primeiro quadro (laço sem salto quando o app repete a animação) */
      periodo: ajustes.periodo || 3,
      duracao: ajustes.duracao || 6,
      fps: ajustes.fps || 24,
      ombroAlto, ombroBaixo, tornozelo, punho: punhoAlto, poloBraco,
      inclinacaoPe: INCLINACAO_PE,
      alturaOmbroReferencia: ombroDesejado,
      construir: (t, cfg) => flexao(rig, t, cfg)
    };
  }

  if (exercicio === "prancha") {
    /* antebraço deitado no chão: ombro = braço + espessura do antebraço */
    const alturaOmbro = braco + 0.045;
    const beta = inclinacaoParaOmbro(rig, { alturaOmbro, tornozelo });
    return {
      nome: exercicio,
      periodoRespiracao: ajustes.periodoRespiracao || 3,
      duracao: ajustes.duracao || 6,
      fps: ajustes.fps || 24,
      beta, alturaOmbro, tornozelo, inclinacaoPe: INCLINACAO_PE,
      construir: (t, cfg) => prancha(rig, t, cfg)
    };
  }

  if (exercicio === "mountain-climber") {
    return {
      nome: exercicio,
      periodo: ajustes.periodo || 1.5,
      duracao: ajustes.duracao || 4.5,
      fps: ajustes.fps || 24,
      beta: betaAlto, tornozelo,
      punho: punhoAlto, poloBraco,
      inclinacaoPe: INCLINACAO_PE,
      anguloJoelhoFrente: ajustes.anguloJoelhoFrente || 383,
      curvaFlexao: ajustes.curvaFlexao
        || [[0, 0], [0.08, 40], [0.2, 88], [0.35, 132], [0.5, 150], [0.7, 148], [1, 125]],
      solaNeutra: new THREE.Vector3(0, 0.25, 0.97).normalize(),
      abducao: ajustes.abducao ?? 36,
      construir: (t, cfg) => mountainClimber(rig, t, cfg)
    };
  }

  throw new Error(`exercício desconhecido: ${exercicio}`);
}

/* ------------------------------------------------------------------ */
/* Amostragem: pose → trilhas no formato do escritor de GLB            */
/* ------------------------------------------------------------------ */

export function autorarExercicio(rig, exercicio, ajustes = {}) {
  const cfg = configurar(rig, exercicio, ajustes);
  const total = Math.round(cfg.duracao * cfg.fps);
  const valoresRot = {};
  const valoresPos = {};
  for (const [nome] of HIERARQUIA) {
    valoresRot[nome] = [];
    if (nome === "hips") valoresPos[nome] = [];
  }
  const tempos = [];
  const amostras = [];
  const anterior = {};

  /*
    `i <= total`: o último quadro é amostrado em t = duração, que coincide com o
    primeiro. Sem ele o laço não fecha — o app repete a animação e o salto
    aparece na emenda (o analisador reprovava o mountain climber por isso).
  */
  for (let i = 0; i <= total; i += 1) {
    const t = i / cfg.fps;
    const pose = cfg.construir(t, cfg);
    const montada = montarPose(rig, pose);
    tempos.push(i / cfg.fps);
    amostras.push({ t, pose, montada });
    for (const [nome] of HIERARQUIA) {
      const q = montada.locais[nome].clone();
      const ant = anterior[nome];
      if (ant && q.dot(ant) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      anterior[nome] = q;
      valoresRot[nome].push(q.x, q.y, q.z, q.w);
      if (nome === "hips") {
        const p = montada.quadril;
        valoresPos[nome].push(p.x, p.y, p.z);
      }
    }
  }

  return { nome: exercicio, cfg, tempos, valoresRot, valoresPos, amostras };
}
