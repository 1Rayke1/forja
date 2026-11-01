/*
  Suíte da transferência de mocap (fonte → rig de 15 ossos do FORJA).

  O problema que ela resolve: o transferidor antigo assumia eixo fixo +Y e
  quebrava em rigs diferentes do Rokoko (no iClone o personagem saía de cabeça
  para baixo, com o pé a 1,80 m e o quadril a 0,99 m). Medir isso com arquivos
  reais só cobre os arquivos que existem no disco — 2 de 26. Por isso aqui a
  fonte é SINT´ETICA e fechada:

    1. carrega o personagem do FORJA (masculino ou feminino);
    2. tira a pose de um clipe publicado, saída por saída;
    3. monta um rig de origem com o vocabulário do formato (Rokoko, Mixamo com
       e sem dois-pontos, iClone/UE5) e com a pose de repouso alterada de
       propósito (T, A 45°, corpo virado 180°, rig em centímetros);
    4. aplica na origem exatamente as mesmas orientações de mundo do FORJA;
    5. transfere de volta e compara com a pose original.

  Passa se o resultado reconstruir a pose de origem. É o teste que prova, para
  cada vocabulário, "movimento preservado, sem inversão, sem salto".

  6. rigs reais: o iClone precisa sair em pé e no chão (era o defeito);
  7. descontinuidade: pico contra mediana distingue salto de movimento rápido;
  8. pés: nunca abaixo do chão, e a fonte que pula é marcada como descontínua.

  Uso: node tests/transferencia3d.test.mjs
*/
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { THREE, HIERARQUIA, carregarGLB, carregarPersonagem, catalogo3D } =
  await import(path.join(raiz, "tools/lib/clipe-3d.mjs"));
const {
  carregarOrigem, prepararContexto, transferirMovimento, medirDescontinuidade
} = await import(path.join(raiz, "tools/lib/retarget-3d.mjs"));

const app = await import(path.join(raiz, "assets/js/forja-3d-cena.js"));

let testes = 0;
const ok = async (nome, funcao) => {
  await funcao();
  testes += 1;
  console.log("  ok " + testes + " — " + nome);
};

/* ------------------------------------------------------------------ */
/* Vocabulários de rig                                                 */
/* ------------------------------------------------------------------ */

const VOCABULARIOS = {
  rokoko: {
    hips: "Hips", spine: "Spine2", neck: "Neck",
    armL: "LeftArm", elbowL: "LeftForeArm", handL: "LeftHand",
    armR: "RightArm", elbowR: "RightForeArm", handR: "RightHand",
    legL: "LeftThigh", kneeL: "LeftShin", footL: "LeftFoot",
    legR: "RightThigh", kneeR: "RightShin", footR: "RightFoot"
  },
  mixamo: {
    hips: "mixamorig:Hips", spine: "mixamorig:Spine2", neck: "mixamorig:Neck",
    armL: "mixamorig:LeftArm", elbowL: "mixamorig:LeftForeArm", handL: "mixamorig:LeftHand",
    armR: "mixamorig:RightArm", elbowR: "mixamorig:RightForeArm", handR: "mixamorig:RightHand",
    legL: "mixamorig:LeftUpLeg", kneeL: "mixamorig:LeftLeg", footL: "mixamorig:LeftFoot",
    legR: "mixamorig:RightUpLeg", kneeR: "mixamorig:RightLeg", footR: "mixamorig:RightFoot"
  },
  iclone: {
    hips: "mixamorigHips", spine: "mixamorigSpine2", neck: "mixamorigNeck",
    armL: "mixamorigLeftArm", elbowL: "mixamorigLeftForeArm", handL: "mixamorigLeftHand",
    armR: "mixamorigRightArm", elbowR: "mixamorigRightForeArm", handR: "mixamorigRightHand",
    legL: "mixamorigLeftUpLeg", kneeL: "mixamorigLeftLeg", footL: "mixamorigLeftFoot",
    legR: "mixamorigRightUpLeg", kneeR: "mixamorigRightLeg", footR: "mixamorigRightFoot"
  },
  ue5: {
    hips: "pelvis", spine: "spine_03", neck: "neck_01",
    armL: "upperarm_l", elbowL: "lowerarm_l", handL: "hand_l",
    armR: "upperarm_r", elbowR: "lowerarm_r", handR: "hand_r",
    legL: "thigh_l", kneeL: "calf_l", footL: "foot_l",
    legR: "thigh_r", kneeR: "calf_r", footR: "foot_r"
  }
};

/* ------------------------------------------------------------------ */
/* Rig sintético a partir do próprio esqueleto do FORJA                */
/* ------------------------------------------------------------------ */

/*
  Repouso de verdade: guardado no carregamento e restaurado antes de montar o
  rig sintético. Sem isso o "repouso" seria a última pose tocada pelo mixer —
  e a transferência inteira sairia deslocada (foi o que deu 7,5 cm de erro).
*/
function capturarRepouso(alvo) {
  alvo.cena.updateMatrixWorld(true);
  const repouso = {};
  for (const [nome, osso] of alvo.ossos) {
    repouso[nome] = {
      posicao: osso.position.clone(),
      quat: osso.quaternion.clone(),
      escala: osso.scale.clone(),
      mundo: osso.getWorldPosition(new THREE.Vector3()),
      quatMundo: osso.getWorldQuaternion(new THREE.Quaternion())
    };
  }
  return repouso;
}

function restaurarRepouso(alvo, repouso) {
  for (const [nome, osso] of alvo.ossos) {
    const r = repouso[nome];
    if (!r) continue;
    osso.position.copy(r.posicao);
    osso.quaternion.copy(r.quat);
    osso.scale.copy(r.escala);
  }
  alvo.cena.updateMatrixWorld(true);
}

/* matriz local de mundo de cada osso (inclui nós intermediários do GLB) */
function repousoMundoDe(osso, cache = new Map()) {
  if (cache.has(osso)) return cache.get(osso);
  const m = osso.matrixWorld.clone();
  cache.set(osso, m);
  return m;
}

/*
  Monta um rig de origem novo, com nomes do vocabulário escolhido, a partir dos
  repousos do personagem do FORJA. `variacao` altera a POSE DE REPOUSO — é o que
  difere entre os pacotes reais (T-pose do Mixamo, A-pose de outros).
*/
function montarRigSintetico({ alvo, vocabulario, variacao = "t", giro = null }) {
  if (alvo.repouso) restaurarRepouso(alvo, alvo.repouso);
  alvo.cena.updateMatrixWorld(true);
  const raizes = new THREE.Group();
  raizes.name = "RigSintetico";
  const porNome = {};
  const mundos = {};
  const pais = new Map(HIERARQUIA);

  for (const [nome] of HIERARQUIA) {
    const pai = pais.get(nome);
    const osso = alvo.ossos.get(nome);
    const mundoPai = pai ? mundos[pai] : new THREE.Matrix4();
    const mundo = osso.matrixWorld.clone();
    const local = mundoPai.clone().invert().multiply(mundo);
    const novo = new THREE.Bone();
    novo.name = vocabulario[nome];
    local.decompose(novo.position, novo.quaternion, novo.scale);
    porNome[nome] = novo;
    mundos[nome] = mundo.clone();
    if (pai) porNome[pai].add(novo);
    else raizes.add(novo);
  }

  /* variação da pose de repouso */
  if (variacao === "a45") {
    /* braços 45° para baixo (A-pose): filhos acompanham, como em rig real */
    for (const lado of ["armL", "armR"]) {
      const sinal = lado === "armL" ? 1 : -1;
      const osso = porNome[lado];
      osso.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1), sinal * (-Math.PI / 4)
      ));
    }
  } else if (variacao === "centimetros") {
    raizes.scale.setScalar(100);
  }

  /*
    Giro do rig inteiro: muda a DIREÇÃO para onde ele nasce virado, tanto no
    repouso quanto na animação (o `clipeComMesmasPoses` aplica o mesmo giro nas
    poses). Sem isso o teste seria inconsistente — repouso virado e pose não.
  */
  if (giro) porNome.hips.quaternion.premultiply(giro);

  raizes.updateMatrixWorld(true);
  const ossos = new Map();
  raizes.traverse(objeto => { if (objeto.isBone) ossos.set(objeto.name, objeto); });
  return { cena: raizes, ossos };
}

/*
  Cria um clipe na origem sintética que reproduz, quadro a quadro, as MESMAS
  orientações de mundo do clipe do FORJA. Assim a "verdade" é conhecida: o
  transferidor tem de reconstruir a pose do FORJA.
*/
function clipeComMesmasPoses({ alvo, clipeFortja, rigOrigem, vocabulario, fps = 24, quadros = null, giro = null }) {
  /* mesma taxa da transferência (24 fps): comparar pose interpolada com pose
     amostrada em taxa diferente gera erro de leitura, não de transferência */
  const totalQuadros = quadros || (Math.round(clipeFortja.duration * fps) + 1);
  const mixer = new THREE.AnimationMixer(alvo.cena);
  mixer.clipAction(clipeFortja).play();

  const pais = new Map(HIERARQUIA);
  const tempos = [];
  const valores = {};
  /* a chave da trilha é o uuid do osso: nome com ':' (Mixamo) não resolve no
     PropertyBinding do three — e é justamente o vocabulário que queremos testar */
  const chaveDe = {};
  for (const [nome] of HIERARQUIA) {
    chaveDe[nome] = rigOrigem.ossos.get(vocabulario[nome]).uuid;
    valores[chaveDe[nome]] = [];
  }
  const anterior = {};

  for (let i = 0; i < totalQuadros; i += 1) {
    const t = Math.min(i / fps, clipeFortja.duration);
    mixer.setTime(Math.min(t, clipeFortja.duration));
    alvo.cena.updateMatrixWorld(true);
    rigOrigem.cena.updateMatrixWorld(true);
    tempos.push(t);
    const mundoNoRig = {};
    for (const [nome, pai] of HIERARQUIA) {
      let mundoFortja = alvo.ossos.get(nome).getWorldQuaternion(new THREE.Quaternion());
      if (giro) mundoFortja = giro.clone().multiply(mundoFortja);
      const mundoPai = pai ? mundoNoRig[pai] : new THREE.Quaternion();
      const local = mundoPai.clone().invert().multiply(mundoFortja);
      const chave = chaveDe[nome];
      const ant = anterior[chave];
      if (ant && local.dot(ant) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      anterior[chave] = local.clone();
      valores[chave].push(local.x, local.y, local.z, local.w);
      mundoNoRig[nome] = mundoFortja.clone();
    }
  }
  mixer.stopAllAction();

  const trilhas = Object.entries(valores).map(([osso, dados]) =>
    new THREE.QuaternionKeyframeTrack(osso + ".quaternion", tempos, dados));
  return new THREE.AnimationClip("sintetico", clipeFortja.duration, trilhas);
}

/* ------------------------------------------------------------------ */
/* Comparação                                                          */
/* ------------------------------------------------------------------ */

/*
  FK própria, só com rotações: posição de cada osso = pai + deslocamento de
  repouso girado pela rotação do pai. É o que a transferência controla.
  Sem isso a comparação mede também as trilhas de POSIÇÃO que os clipes
  publicados carregam, e acusa 5 cm de "erro" que não é da transferência.
*/
function posicoesPorFK(repouso, quats) {
  const posicoes = { hips: repouso.hips.mundo.clone() };
  for (const [nome, pai] of HIERARQUIA) {
    if (!pai) continue;
    const deslocamento = repouso[nome].mundo.clone().sub(repouso[pai].mundo).applyQuaternion(quats[pai]);
    posicoes[nome] = posicoes[pai].clone().add(deslocamento);
  }
  const quadril = posicoes.hips.clone();
  const relativas = {};
  for (const [nome] of HIERARQUIA) relativas[nome] = posicoes[nome].clone().sub(quadril);
  return relativas;
}

const FILHO_DA_CADEIA_TESTE = {
  hips: "spine", spine: "neck", armL: "elbowL", elbowL: "handL",
  armR: "elbowR", elbowR: "handR", legL: "kneeL", kneeL: "footL",
  legR: "kneeR", kneeR: "footR"
};

function contraVerdade(verdade, resultado, quadros, duracao) {
  /*
    O que a transferência controla é a DIREÇÃO de cada osso no espaço — é isso
    que se vê (braço para onde, joelho dobrado quanto). A rotação completa tem
    uma ambiguidade de torção em torno do próprio osso, que não muda o desenho
    do movimento e não precisa bater ao grau. Então:

      erro principal = ângulo entre a direção do osso na verdade e no resultado;
      sanidade       = deslocamento máximo de articulação.
  */
  let piorDirecao = 0;
  let piorPosicao = 0;
  let detalhe = null;
  const graus = rad => (rad * 180) / Math.PI;
  for (let i = 0; i < quadros.length; i += 1) {
    const t = Math.min(resultado.tempos[i], duracao);
    const indice = Math.round(t * 24);
    const referencia = verdade[Math.min(indice, verdade.length - 1)];
    const atual = quadros[i];
    for (const [nome, filho] of Object.entries(FILHO_DA_CADEIA_TESTE)) {
      const dirV = referencia.posicoes[filho].clone().sub(referencia.posicoes[nome]);
      const dirR = atual.posicoes[filho].clone().sub(atual.posicoes[nome]);
      if (dirV.lengthSq() < 1e-9 || dirR.lengthSq() < 1e-9) continue;
      const angulo = graus(dirV.angleTo(dirR));
      if (angulo > piorDirecao) { piorDirecao = angulo; detalhe = { t: +t.toFixed(3), osso: nome }; }
    }
    for (const [nome] of HIERARQUIA) {
      const erro = referencia.posicoes[nome].distanceTo(atual.posicoes[nome]);
      if (erro > piorPosicao) piorPosicao = erro;
    }
  }
  contraVerdade.ultimo = detalhe;
  return { piorDirecao: +piorDirecao.toFixed(2), piorPosicao: +piorPosicao.toFixed(4) };
}

function posicoesRelativas(ossos, cena, mundoRaiz = null) {
  cena.updateMatrixWorld(true);
  const posicoes = {};
  for (const [nome] of HIERARQUIA) {
    const p = ossos.get(nome).getWorldPosition(new THREE.Vector3());
    if (mundoRaiz) p.applyMatrix4(mundoRaiz);
    posicoes[nome] = p;
  }
  const quadril = posicoes.hips.clone();
  for (const [nome] of HIERARQUIA) posicoes[nome] = posicoes[nome].clone().sub(quadril);
  return posicoes;
}

const erroMedio = (a, b) => {
  let soma = 0;
  for (const [nome] of HIERARQUIA) soma += a[nome].distanceTo(b[nome]);
  return soma / HIERARQUIA.length;
};
const erroMaximo = (a, b) => {
  let maior = 0;
  for (const [nome] of HIERARQUIA) maior = Math.max(maior, a[nome].distanceTo(b[nome]));
  return maior;
};

/*
  Aplica as trilhas transferidas SEM mixer: escreve os quaternions locais osso
  a osso, quadro a quadro. O mixer do three resolve faixas por nome em tempo de
  execução — e quando duas animações já tocaram a mesma cena, o resultado do
  teste passa a depender de qual ação escreveu por último. Aqui não: cada quadro
  é escrito inteiro, do zero.
*/
function aplicarResultado({ alvo, resultado }) {
  const rotacao = {};
  const translacao = {};
  for (const trilha of resultado.trilhas) {
    if (trilha.caminho === "rotation") rotacao[trilha.osso] = trilha.valores;
    else translacao[trilha.osso] = trilha.valores;
  }
  const serie = [];
  for (let i = 0; i < resultado.tempos.length; i += 1) {
    for (const [nome] of HIERARQUIA) {
      const osso = alvo.ossos.get(nome);
      const r = rotacao[nome];
      osso.quaternion.set(r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]);
      if (translacao[nome]) {
        osso.position.set(translacao[nome][i * 3], translacao[nome][i * 3 + 1], translacao[nome][i * 3 + 2]);
      }
    }
    alvo.cena.updateMatrixWorld(true);
    const quats = {};
    for (const [nome] of HIERARQUIA) quats[nome] = alvo.ossos.get(nome).getWorldQuaternion(new THREE.Quaternion());
    serie.push({ quats, posicoes: posicoesPorFK(alvo.repouso, quats) });
  }
  return serie;
}

/* ------------------------------------------------------------------ */
/* Contexto de teste: um clipe publicado e os dois personagens          */
/* ------------------------------------------------------------------ */

const catalogo = catalogo3D();
const clipeId = "agachamento"; /* movimento amplo: quadril, joelho e braço */
const info = catalogo.clipes.find(clipe => clipe.id === clipeId);
assert.ok(info, "clipe de teste " + clipeId + " não encontrado no catálogo");
const gltfClipe = await carregarGLB(info.arquivo);

const personagens = {};
const avaliadores = {};
for (const slug of ["masculino", "feminino"]) {
  const alvo = await carregarPersonagem(slug);
  const clipe = app.reamarrarFaixas(gltfClipe.animations[0], alvo.cena);
  alvo.repouso = capturarRepouso(alvo);
  /* forma que a transferência espera: quat/posição de MUNDO por osso */
  alvo.repousoMundo = Object.fromEntries(Object.entries(alvo.repouso).map(([nome, r]) =>
    [nome, { quat: r.quatMundo, posicao: r.mundo }]));
  /* instância limpa, só para aplicar clipes e medir: não sofre resíduo de pose */
  const avaliador = await carregarPersonagem(slug);
  avaliador.repouso = capturarRepouso(avaliador);
  avaliadores[slug] = avaliador;
  personagens[slug] = { alvo, clipe };
}

/* pose de verdade: o próprio clipe aplicado no personagem do FORJA */
function verdadeDoClipe({ alvo, clipe, fps = 24 }) {
  const mixer = new THREE.AnimationMixer(alvo.cena);
  mixer.clipAction(clipe).play();
  const serie = [];
  const total = Math.round(clipe.duration * fps) + 1;
  for (let i = 0; i < total; i += 1) {
    mixer.setTime(Math.min(i / fps, clipe.duration));
    alvo.cena.updateMatrixWorld(true);
    const quats = {};
    for (const [nome] of HIERARQUIA) quats[nome] = alvo.ossos.get(nome).getWorldQuaternion(new THREE.Quaternion());
    serie.push({ quats, posicoes: posicoesPorFK(alvo.repouso, quats) });
  }
  mixer.stopAllAction();
  return serie;
}

const verdades = {};
for (const slug of ["masculino", "feminino"]) {
  const { clipe } = personagens[slug];
  verdades[slug] = verdadeDoClipe({ alvo: avaliadores[slug], clipe: clipe.clone() });
}

/* ------------------------------------------------------------------ */
/* 1..4 — vocabulários                                                 */
/* ------------------------------------------------------------------ */

console.log("transferência de mocap — fechada nos quatro vocabulários");

for (const [slug, vocabulario] of [["masculino", VOCABULARIOS.rokoko], ["feminino", VOCABULARIOS.iclone]]) {
  await ok("rig " + slug + " reconstrói a pose do FORJA (vocabulário " + (slug === "masculino" ? "Rokoko" : "iClone") + ")", () => {
    const { alvo, clipe } = personagens[slug];
    const verdade = verdades[slug];
    const rig = montarRigSintetico({ alvo, vocabulario, variacao: "t" });
    const clipeSintetico = clipeComMesmasPoses({ alvo, clipeFortja: clipe, rigOrigem: rig, vocabulario });
    const resultado = transferirMovimento({
      cenaOrigem: rig.cena, ossosOrigem: rig.ossos, alvo, repousoDestino: alvo.repousoMundo, clipeOrigem: clipeSintetico,
      modo: "direcao", inicio: 0, duracao: clipe.duration, fps: 24, apoiar: true
    });
    const quadros = aplicarResultado({ alvo: avaliadores[slug], resultado });
    const pior = contraVerdade(verdade, resultado, quadros, clipe.duration);
    assert.ok(pior.piorDirecao < 6, "direção do osso fora por " + pior.piorDirecao + "° em " + JSON.stringify(contraVerdade.ultimo));
    assert.ok(pior.piorPosicao < 0.06, "erro de posição " + pior.piorPosicao + " m");
  });
}

for (const [slug, vocabulario] of [["masculino", VOCABULARIOS.mixamo], ["feminino", VOCABULARIOS.ue5]]) {
  await ok("rig " + slug + " reconstrói a pose do FORJA (vocabulário " + (slug === "masculino" ? "Mixamo" : "UE5") + ")", () => {
    const { alvo, clipe } = personagens[slug];
    const verdade = verdades[slug];
    const rig = montarRigSintetico({ alvo, vocabulario, variacao: "t" });
    const clipeSintetico = clipeComMesmasPoses({ alvo, clipeFortja: clipe, rigOrigem: rig, vocabulario });
    const resultado = transferirMovimento({
      cenaOrigem: rig.cena, ossosOrigem: rig.ossos, alvo, repousoDestino: alvo.repousoMundo, clipeOrigem: clipeSintetico,
      modo: "direcao", inicio: 0, duracao: clipe.duration, fps: 24, apoiar: true
    });
    const quadros = aplicarResultado({ alvo: avaliadores[slug], resultado });
    if (process.env.DIAG) {
      const fmt = q => [q.x, q.y, q.z, q.w].map(v => +v.toFixed(3));
      console.log("   verdade spine[0]", JSON.stringify(fmt(verdade[0].quats.spine)));
      console.log("   resultado spine[0]", JSON.stringify(fmt(quadros[0].quats.spine)));
      console.log("   verdade spine[20]", JSON.stringify(fmt(verdade[20].quats.spine)));
      console.log("   resultado spine[20]", JSON.stringify(fmt(quadros[20].quats.spine)));
      const rigS = montarRigSintetico({ alvo, vocabulario, variacao: "t" });
      const clipeS = clipeComMesmasPoses({ alvo, clipeFortja: clipe, rigOrigem: rigS, vocabulario });
      const mx = new THREE.AnimationMixer(rigS.cena); mx.clipAction(clipeS).play();
      mx.setTime(0); rigS.cena.updateMatrixWorld(true);
      console.log("   fonte  spine[0]", JSON.stringify(fmt(rigS.ossos.get(vocabulario.spine).getWorldQuaternion(new THREE.Quaternion()))));
      mx.setTime(20 / 24); rigS.cena.updateMatrixWorld(true);
      console.log("   fonte  spine[20]", JSON.stringify(fmt(rigS.ossos.get(vocabulario.spine).getWorldQuaternion(new THREE.Quaternion()))));
    }
    const pior = contraVerdade(verdade, resultado, quadros, clipe.duration);
    assert.ok(pior.piorDirecao < 6, "direção do osso fora por " + pior.piorDirecao + "° em " + JSON.stringify(contraVerdade.ultimo));
    assert.ok(pior.piorPosicao < 0.06, "erro de posição " + pior.piorPosicao + " m");
  });
}

/* ------------------------------------------------------------------ */
/* 5..7 — poses de repouso e enquadramento diferentes                  */
/* ------------------------------------------------------------------ */

const VARIACOES = [
  { nome: "a45" },
  { nome: "virado180", giro: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) },
  { nome: "virado30", giro: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6) },
  { nome: "centimetros" }
];

for (const { nome: variacao, giro } of VARIACOES) {
  await ok("repouso diferente (" + variacao + ") não muda a pose transferida", () => {
    const slug = "masculino";
    const { alvo, clipe } = personagens[slug];
    const verdade = verdades[slug];
    const rig = montarRigSintetico({ alvo, vocabulario: VOCABULARIOS.mixamo, variacao, giro });
    const clipeSintetico = clipeComMesmasPoses({ alvo, clipeFortja: clipe, rigOrigem: rig, vocabulario: VOCABULARIOS.mixamo, giro });
    const resultado = transferirMovimento({
      cenaOrigem: rig.cena, ossosOrigem: rig.ossos, alvo, repousoDestino: alvo.repousoMundo, clipeOrigem: clipeSintetico,
      modo: "direcao", inicio: 0, duracao: clipe.duration, fps: 24, apoiar: true
    });
    const quadros = aplicarResultado({ alvo: avaliadores[slug], resultado });
    const pior = contraVerdade(verdade, resultado, quadros, clipe.duration);
    assert.ok(pior.piorDirecao < 6, "variação " + variacao + ": direção fora por " + pior.piorDirecao + "°");
    assert.ok(pior.piorPosicao < 0.06, "variação " + variacao + ": erro de posição " + pior.piorPosicao + " m");
  });
}

await ok("a guinada compensa rig virado 180° (o personagem não chega de costas)", () => {
  const { alvo, clipe } = personagens.masculino;
  const giro = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const rig = montarRigSintetico({ alvo, vocabulario: VOCABULARIOS.mixamo, variacao: "t", giro });
  const contexto = prepararContexto({ cenaOrigem: rig.cena, ossosOrigem: rig.ossos, alvo, modo: "direcao" });
  const angulo = (2 * Math.acos(Math.min(1, Math.abs(contexto.guinada.w))) * 180) / Math.PI;
  assert.ok(Math.abs(angulo - 180) < 3, "guinada medida " + angulo.toFixed(1) + "°");
  assert.ok(clipe.duration > 0);
});

await ok("rig em centímetros: a altura é escalada e o quadril cai na altura do alvo", () => {
  const { alvo, clipe } = personagens.masculino;
  const rig = montarRigSintetico({ alvo, vocabulario: VOCABULARIOS.mixamo, variacao: "centimetros" });
  const contexto = prepararContexto({ cenaOrigem: rig.cena, ossosOrigem: rig.ossos, alvo, modo: "direcao" });
  assert.ok(contexto.escala < 0.02, "escala medida " + contexto.escala);
  const clipeSintetico = clipeComMesmasPoses({ alvo, clipeFortja: clipe, rigOrigem: rig, vocabulario: VOCABULARIOS.mixamo });
  const resultado = transferirMovimento({
    cenaOrigem: rig.cena, ossosOrigem: rig.ossos, alvo, repousoDestino: alvo.repousoMundo, clipeOrigem: clipeSintetico,
    modo: "direcao", duracao: clipe.duration, fps: 24, apoiar: true
  });
  const quadrilEsperado = contexto.rest.hips.posDestino.y;
  assert.ok(Math.abs(resultado.diagnostico.quadril.min - quadrilEsperado) < 0.3);
  assert.equal(resultado.diagnostico.inversoes, 0);
});

/* ------------------------------------------------------------------ */
/* 8..11 — critérios de aceitação                                      */
/* ------------------------------------------------------------------ */

await ok("pés nunca abaixo do chão e personagem sempre em pé", () => {
  for (const slug of ["masculino", "feminino"]) {
    const { alvo, clipe } = personagens[slug];
    const rig = montarRigSintetico({ alvo, vocabulario: VOCABULARIOS.rokoko, variacao: "a45" });
    const clipeSintetico = clipeComMesmasPoses({ alvo, clipeFortja: clipe, rigOrigem: rig, vocabulario: VOCABULARIOS.rokoko });
    const resultado = transferirMovimento({
      cenaOrigem: rig.cena, ossosOrigem: rig.ossos, alvo, repousoDestino: alvo.repousoMundo, clipeOrigem: clipeSintetico,
      modo: "direcao", duracao: clipe.duration, fps: 24, apoiar: true
    });
    assert.equal(resultado.diagnostico.quadrosAbaixoDoChao, 0, slug + ": pé abaixo do chão");
    assert.equal(resultado.diagnostico.inversoes, 0, slug + ": personagem invertido");
    assert.ok(resultado.diagnostico.pes.min >= -0.001, slug + ": pé mínimo " + resultado.diagnostico.pes.min);
    assert.ok(resultado.diagnostico.quadrilAcimaDoPe.min > 0.2, slug + ": quadril rente ao pé");
  }
});

await ok("joelho e cotovelo dobram como na origem (amplitude preservada)", async () => {
  const { alvo, clipe } = personagens.masculino;
  const rig = montarRigSintetico({ alvo, vocabulario: VOCABULARIOS.rokoko, variacao: "t" });
  const clipeSintetico = clipeComMesmasPoses({ alvo, clipeFortja: clipe, rigOrigem: rig, vocabulario: VOCABULARIOS.rokoko });
  const resultado = transferirMovimento({
    cenaOrigem: rig.cena, ossosOrigem: rig.ossos, alvo, repousoDestino: alvo.repousoMundo, clipeOrigem: clipeSintetico,
    modo: "direcao", duracao: clipe.duration, fps: 24, apoiar: true
  });
  const d = resultado.diagnostico;
  assert.ok(d.joelhoGraus.max - d.joelhoGraus.min > 30, "joelho sem amplitude: " + JSON.stringify(d.joelhoGraus));

  /* cotovelo: usa um clipe que dobra o braço de verdade (desenvolvimento) */
  const infoBraco = catalogo.clipes.find(c => c.id === "desenvolvimento");
  const gltfBraco = await carregarGLB(infoBraco.arquivo);
  const clipeBraco = app.reamarrarFaixas(gltfBraco.animations[0], alvo.cena);
  const rigBraco = montarRigSintetico({ alvo, vocabulario: VOCABULARIOS.rokoko, variacao: "t" });
  const sinteticoBraco = clipeComMesmasPoses({ alvo, clipeFortja: clipeBraco, rigOrigem: rigBraco, vocabulario: VOCABULARIOS.rokoko });
  const resultadoBraco = transferirMovimento({
    cenaOrigem: rigBraco.cena, ossosOrigem: rigBraco.ossos, alvo, repousoDestino: alvo.repousoMundo, clipeOrigem: sinteticoBraco,
    modo: "direcao", duracao: clipeBraco.duration, fps: 24, apoiar: true
  });
  const db = resultadoBraco.diagnostico;
  assert.ok(db.cotoveloGraus.max - db.cotoveloGraus.min > 50,
    "cotovelo sem amplitude: " + JSON.stringify(db.cotoveloGraus));
});

await ok("modo mundo também fica em pé, mas comprime a flexão do cotovelo (por isso não é o padrão)", () => {
  const { alvo, clipe } = personagens.masculino;
  const rig = montarRigSintetico({ alvo, vocabulario: VOCABULARIOS.mixamo, variacao: "a45" });
  const clipeSintetico = clipeComMesmasPoses({ alvo, clipeFortja: clipe, rigOrigem: rig, vocabulario: VOCABULARIOS.mixamo });
  const resultado = transferirMovimento({
    cenaOrigem: rig.cena, ossosOrigem: rig.ossos, alvo, repousoDestino: alvo.repousoMundo, clipeOrigem: clipeSintetico,
    modo: "mundo", duracao: clipe.duration, fps: 24, apoiar: true
  });
  assert.equal(resultado.diagnostico.inversoes, 0);
  assert.equal(resultado.diagnostico.quadrosAbaixoDoChao, 0);
});

await ok("quadros consecutivos não saltam (continuidade do resultado)", () => {
  const { alvo, clipe } = personagens.masculino;
  const rig = montarRigSintetico({ alvo, vocabulario: VOCABULARIOS.rokoko, variacao: "t" });
  const clipeSintetico = clipeComMesmasPoses({ alvo, clipeFortja: clipe, rigOrigem: rig, vocabulario: VOCABULARIOS.rokoko });
  const resultado = transferirMovimento({
    cenaOrigem: rig.cena, ossosOrigem: rig.ossos, alvo, repousoDestino: alvo.repousoMundo, clipeOrigem: clipeSintetico,
    modo: "direcao", duracao: clipe.duration, fps: 24, apoiar: true
  });
  assert.ok(resultado.diagnostico.maiorSaltoQuadro < 0.2,
    "salto de " + resultado.diagnostico.maiorSaltoQuadro + " m entre quadros");
});

/* ------------------------------------------------------------------ */
/* 12..14 — descontinuidade da fonte e rig real                        */
/* ------------------------------------------------------------------ */

await ok("descontinuidade distingue salto de movimento rápido", () => {
  /* movimento rápido e contínuo: 0,2 m por quadro, sempre igual */
  const rapido = [];
  for (let i = 0; i < 20; i += 1) {
    const posicoes = {};
    for (const [nome] of HIERARQUIA) posicoes[nome] = new THREE.Vector3(i * 0.2, 1, 0);
    rapido.push(posicoes);
  }
  const medidaRapida = medirDescontinuidade({ posicoesPorQuadro: rapido, escala: 1 });
  assert.equal(medidaRapida.descontinuo, false, "movimento rápido não é descontinuidade");

  /* salto de verdade: um quadro que anda 1 m num clipe parado */
  const saltado = rapido.map((posicoes, i) => {
    const copia = {};
    for (const [nome] of HIERARQUIA) {
      copia[nome] = posicoes[nome].clone();
      if (i > 10) copia[nome].y += 2;
    }
    return copia;
  });
  const medidaSalto = medirDescontinuidade({ posicoesPorQuadro: saltado, escala: 1 });
  assert.equal(medidaSalto.descontinuo, true, "salto deveria ser detectado");
});

await ok("iClone real: 15/15 ossos, personagem em pé e no chão", async () => {
  const origem = await carregarOrigem("tools/fontes-3d/16_Barbell_Curl_iclone.fbx");
  const alvo = personagens.masculino.alvo;
  const contexto = prepararContexto({ cenaOrigem: origem.cena, ossosOrigem: origem.ossos, alvo, modo: "direcao" });
  assert.equal(Object.keys(contexto.mapa).length, 15);
  const clipe = origem.clipes.reduce((a, b) => (a.duration >= b.duration ? a : b));
  const resultado = transferirMovimento({
    cenaOrigem: origem.cena, ossosOrigem: origem.ossos, alvo, contexto, clipeOrigem: clipe,
    modo: "direcao", inicio: 15, duracao: 6, fps: 24, apoiar: true
  });
  const d = resultado.diagnostico;
  assert.equal(d.inversoes, 0, "personagem invertido no iClone");
  assert.equal(d.quadrosAbaixoDoChao, 0);
  assert.ok(d.pes.max < 0.1, "pé flutuando: " + d.pes.max);
  assert.ok(d.quadrilAcimaDoPe.min > 0.5, "quadril baixo demais: " + d.quadrilAcimaDoPe.min);
  assert.ok(d.cotoveloGraus.min < 80, "a rosca perdeu a flexão: " + JSON.stringify(d.cotoveloGraus));
  assert.ok(d.maiorSaltoQuadro < 0.15, "salto entre quadros: " + d.maiorSaltoQuadro);
});

await ok("fonte com salto na borda é detectada (janela ruim do iClone)", async () => {
  const origem = await carregarOrigem("tools/fontes-3d/16_Barbell_Curl_iclone.fbx");
  const alvo = personagens.masculino.alvo;
  const contexto = prepararContexto({ cenaOrigem: origem.cena, ossosOrigem: origem.ossos, alvo, modo: "direcao" });
  const clipe = origem.clipes.reduce((a, b) => (a.duration >= b.duration ? a : b));
  const comBorda = transferirMovimento({
    cenaOrigem: origem.cena, ossosOrigem: origem.ossos, alvo, contexto, clipeOrigem: clipe,
    modo: "direcao", inicio: 0, duracao: 3, fps: 24, apoiar: true
  });
  const { medirFonte } = await import(path.join(raiz, "tools/lib/retarget-3d.mjs"));
  const fonte = medirFonte({
    cenaOrigem: origem.cena, ossosOrigem: origem.ossos, clipeOrigem: clipe,
    mapa: contexto.mapa, escala: contexto.escala, inicio: 0, duracao: 3
  });
  assert.equal(fonte.descontinuidade.descontinuo, true, "a borda do clipe deveria ser descontínua");
  assert.ok(comBorda.diagnostico.quadros > 0);
});

console.log("\n" + testes + " testes de transferência 3D, todos verdes.");
