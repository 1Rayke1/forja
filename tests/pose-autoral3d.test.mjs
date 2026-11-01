/*
  Suíte das animações AUTORAIS (fase 4): flexão de braço, prancha e mountain
  climber, geradas por geometria em `tools/lib/pose-autoral-3d.mjs`.

  O que estes três exercícios têm de específico: não basta o personagem se
  mexer. O que define se está certo é CONTATO (mão e pé no chão, sem atravessar),
  ALINHAMENTO (ombro–quadril–tornozelo na mesma linha) e a posição articular
  certa em cada fase (cotovelo fundo na descida, joelho subindo no mountain
  climber). Por isso o teste não olha nome de arquivo nem "tem animação": ele
  monta o clipe, grava o GLB, carrega de volta pelo caminho do app
  (`reamarrarFaixas` + `AnimationMixer`) e mede a pose quadro a quadro — inclusive
  os VÉRTICES da malha, que é o único jeito de saber que o pé não furou o chão.

  Cobre os dois personagens (masculino e feminino), porque a geometria é
  diferente (altura, quadril, comprimento de braço).

  Uso: node tests/pose-autoral3d.test.mjs
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { THREE, HIERARQUIA, carregarGLB, carregarPersonagem, escreverClipeGLB } =
  await import(path.join(raiz, "tools/lib/clipe-3d.mjs"));
const { medirRig, autorarExercicio, ikDoisOssos, alturaTornozeloEmPe, direcaoSola } =
  await import(path.join(raiz, "tools/lib/pose-autoral-3d.mjs"));
const app = await import(path.join(raiz, "assets/js/forja-3d-cena.js"));

const temporario = fs.mkdtempSync(path.join(os.tmpdir(), "forja-autoral-"));

let testes = 0;
const ok = async (nome, funcao) => {
  await funcao();
  testes += 1;
  console.log("  ok " + testes + " — " + nome);
};

const graus = rad => (rad * 180) / Math.PI;
const faixa = valores => ({ min: Math.min(...valores), max: Math.max(...valores) });
const angulo = (a, b, c) => {
  const u = a.clone().sub(b).normalize();
  const v = c.clone().sub(b).normalize();
  return graus(Math.acos(Math.max(-1, Math.min(1, u.dot(v)))));
};

/* ------------------------------------------------------------------ */
/* Geração + leitura de volta pelo caminho do app                      */
/* ------------------------------------------------------------------ */

const PERSONAGENS = {};
for (const id of ["masculino", "feminino"]) {
  const alvo = await carregarPersonagem(id);
  PERSONAGENS[id] = { alvo, rig: medirRig(alvo) };
}

/* escreve o clipe autoral em disco e devolve os bytes escritos */
function gravar(rig, alvo, exercicio, ajustes) {
  const autoral = autorarExercicio(rig, exercicio, ajustes);
  const trilhas = [];
  for (const nome of Object.keys(autoral.valoresRot)) {
    trilhas.push({ osso: nome, caminho: "rotation", valores: autoral.valoresRot[nome], componentes: 4 });
  }
  trilhas.push({ osso: "hips", caminho: "translation", valores: autoral.valoresPos.hips, componentes: 3 });
  const ossosDestino = Object.fromEntries(
    Array.from(alvo.ossos.entries()).map(([nome, osso]) => [nome, {
      pai: osso.parent && osso.parent.isBone ? osso.parent.name : null,
      posicao: osso.position.toArray().map(v => +v.toFixed(6)),
      rotacao: osso.quaternion.toArray().map(v => +v.toFixed(6)),
      escala: osso.scale.toArray().map(v => +v.toFixed(6))
    }])
  );
  const arquivo = path.join(temporario, `${exercicio}-${Math.random().toString(36).slice(2)}.glb`);
  escreverClipeGLB({
    tempos: autoral.tempos, trilhas, duracao: autoral.cfg.duracao,
    fps: autoral.cfg.fps, clipe: exercicio, ossosDestino
  }, arquivo);
  return { autoral, arquivo, bytes: fs.readFileSync(arquivo) };
}

/*
  Amostra o clipe pelo mesmo caminho do app e devolve, por quadro, tudo que os
  testes precisam: posições de osso, ângulos articulares, altura do quadril e o
  vértice mais baixo da malha (contato real com o chão).
*/
async function amostrar(personagem, arquivo, { malha = true, passo = 1 } = {}) {
  const alvo = await carregarPersonagem(personagem);
  const gltf = await carregarGLB(arquivo);
  const clipe = app.reamarrarFaixas(gltf.animations[0], alvo.cena);
  const mixer = new THREE.AnimationMixer(alvo.cena);
  mixer.clipAction(clipe).play();
  const malhas = [];
  alvo.cena.traverse(o => { if (o.isSkinnedMesh) malhas.push(o); });
  const v = new THREE.Vector3();
  const quadros = [];
  const total = Math.round(clipe.duration * 24);
  for (let i = 0; i < total; i += passo) {
    mixer.setTime(i / 24);
    alvo.cena.updateMatrixWorld(true);
    const P = {};
    for (const [nome] of HIERARQUIA) P[nome] = alvo.ossos.get(nome).getWorldPosition(new THREE.Vector3());
    /* rotação LOCAL do pescoço: no mundo ele já está girado pelo corpo (a
       prancha inclina o tronco), então a comparação tem de ser com o pai */
    const qLocal = alvo.ossos.get("neck").quaternion;
    const giroPescoco = 2 * Math.acos(Math.min(1, Math.abs(qLocal.w))) * 180 / Math.PI;
    let menorY = Infinity;
    if (malha) {
      for (const m of malhas) {
        const pos = m.geometry.attributes.position;
        for (let k = 0; k < pos.count; k += 1) {
          v.fromBufferAttribute(pos, k);
          m.applyBoneTransform(k, v);
          v.applyMatrix4(m.matrixWorld);
          if (v.y < menorY) menorY = v.y;
        }
      }
    }
    quadros.push({
      t: i / 24,
      P,
      quadrilY: P.hips.y,
      pe: (P.footL.y + P.footR.y) / 2,
      peMin: Math.min(P.footL.y, P.footR.y),
      peMax: Math.max(P.footL.y, P.footR.y),
      mao: (P.handL.y + P.handR.y) / 2,
      joelho: (angulo(P.legL, P.kneeL, P.footL) + angulo(P.legR, P.kneeR, P.footR)) / 2,
      joelhoMin: Math.min(angulo(P.legL, P.kneeL, P.footL), angulo(P.legR, P.kneeR, P.footR)),
      joelhoMax: Math.max(angulo(P.legL, P.kneeL, P.footL), angulo(P.legR, P.kneeR, P.footR)),
      cotovelo: (angulo(P.armL, P.elbowL, P.handL) + angulo(P.armR, P.elbowR, P.handR)) / 2,
      /*
        Alinhamento ombro–quadril–tornozelo: 180° = linha reta.
        `tronco` usa o meio dos tornozelos (é o certo para flexão e prancha, onde
        as duas pernas fazem a mesma coisa). `troncoPerna` usa a perna mais reta,
        que é a que sustenta o corpo no mountain climber — lá as pernas divergem
        de propósito, e medir pelo meio acusaria "tronco torto" sem defeito.
      */
      tronco: (() => {
        const ombro = P.armL.clone().add(P.armR).multiplyScalar(0.5);
        const meio = P.footL.clone().add(P.footR).multiplyScalar(0.5);
        return angulo(ombro, P.hips, meio);
      })(),
      troncoPerna: (() => {
        const ombro = P.armL.clone().add(P.armR).multiplyScalar(0.5);
        return Math.max(...["footL", "footR"].map(lado => angulo(ombro, P.hips, P[lado])));
      })(),
      menorVerticeY: menorY,
      giroPescoco
    });
  }
  return { quadros, clipe };
}

const CLIPES = {};
for (const personagem of ["masculino", "feminino"]) {
  for (const exercicio of ["flexao", "prancha", "mountain-climber"]) {
    const { alvo, rig } = PERSONAGENS[personagem];
    const { autoral, arquivo } = gravar(rig, alvo, exercicio);
    CLIPES[`${exercicio}-${personagem}`] = {
      autoral, arquivo,
      ...(await amostrar(personagem, arquivo))
    };
  }
}

/* ------------------------------------------------------------------ */
/* Geometria do rig (base de tudo)                                     */
/* ------------------------------------------------------------------ */

await ok("rig: as medidas usadas na autoração batem com os ossos", async () => {
  for (const [id, { rig }] of Object.entries(PERSONAGENS)) {
    const C = rig.comprimento;
    assert.ok(C.coxa > 0.3 && C.coxa < 0.6, `${id}: coxa ${C.coxa}`);
    assert.ok(C.canela > 0.3 && C.canela < 0.6, `${id}: canela ${C.canela}`);
    assert.ok(C.braco > 0.2 && C.braco < 0.4, `${id}: braço ${C.braco}`);
    assert.ok(C.antebraco > 0.15 && C.antebraco < 0.35, `${id}: antebraço ${C.antebraco}`);
    /* a distância ombro↔tornozelo projetada é a que define a inclinação */
    const esperado = Math.hypot(rig.pos.armL.y - rig.pos.footL.y, rig.pos.armL.z - rig.pos.footL.z);
    assert.ok(Math.abs(rig.corpo - esperado) < 1e-9, `${id}: corpo ${rig.corpo} ≠ ${esperado}`);
    assert.ok(rig.corpo > 1.2 && rig.corpo < 1.6, `${id}: corpo ${rig.corpo}`);
    /* o osso do pé é folha: a direção útil é a da sola, não a do osso */
    const sola = direcaoSola(rig, 40);
    assert.ok(sola.y < 0 && sola.z > 0, `${id}: sola deveria apontar para baixo e para frente`);
  }
});

await ok("IK de dois ossos: alcance e cotovelo no lado do polo", async () => {
  const A = new THREE.Vector3(0, 1, 0);
  const B = new THREE.Vector3(0.3, 0.4, 0.2);
  const { meio, alcancavel, distancia } = ikDoisOssos(A, B, 0.5, 0.4, new THREE.Vector3(0, 0, -1));
  assert.equal(alcancavel, true);
  assert.ok(Math.abs(meio.distanceTo(A) - 0.5) < 1e-3, "o osso do meio não está à distância do primeiro");
  assert.ok(Math.abs(meio.distanceTo(B) - 0.4) < 1e-3, "o osso do meio não está à distância do alvo");
  const longe = ikDoisOssos(A, new THREE.Vector3(0, 3, 0), 0.5, 0.4, new THREE.Vector3(0, 0, -1));
  assert.equal(longe.alcancavel, false, "alvo fora do alcance deveria ser marcado");
  assert.ok(Math.abs(longe.meio.distanceTo(A) - 0.5) < 1e-3);
  assert.ok(distancia > 0);
});

await ok("altura da ponta do pé: quem está na ponta tem tornozelo mais alto", async () => {
  for (const [id, { rig }] of Object.entries(PERSONAGENS)) {
    const reto = alturaTornozeloEmPe(rig, 0);
    const ponta = alturaTornozeloEmPe(rig, 40);
    assert.ok(Math.abs(reto - rig.pe.tornozelo) < 1e-9, `${id}: em pé o tornozelo é o do repouso`);
    assert.ok(ponta > reto + 0.05, `${id}: na ponta o tornozelo deveria subir (${reto} → ${ponta})`);
  }
});

/* ------------------------------------------------------------------ */
/* Contato com o chão                                                  */
/* ------------------------------------------------------------------ */

await ok("flexão e prancha: a mão não sai do lugar e fica a 3–5 cm do chão", async () => {
  for (const id of ["masculino", "feminino"]) {
    for (const exercicio of ["flexao", "prancha"]) {
      const { quadros } = CLIPES[`${exercicio}-${id}`];
      for (const lado of ["handL", "handR"]) {
        const xs = quadros.map(q => q.P[lado].x);
        const zs = quadros.map(q => q.P[lado].z);
        assert.ok(faixa(xs).max - faixa(xs).min < 0.002, `${exercicio}-${id}: ${lado} andou em X`);
        assert.ok(faixa(zs).max - faixa(zs).min < 0.002, `${exercicio}-${id}: ${lado} andou em Z`);
      }
      const alturas = quadros.map(q => q.mao);
      assert.ok(faixa(alturas).min > 0.02, `${exercicio}-${id}: mão abaixo de 2 cm`);
      assert.ok(faixa(alturas).max < 0.06, `${exercicio}-${id}: mão flutuando (${faixa(alturas).max})`);
    }
  }
});

await ok("flexão e prancha: o pé não sai do lugar", async () => {
  for (const id of ["masculino", "feminino"]) {
    for (const exercicio of ["flexao", "prancha"]) {
      const { quadros } = CLIPES[`${exercicio}-${id}`];
      for (const lado of ["footL", "footR"]) {
        const xs = quadros.map(q => q.P[lado].x);
        const zs = quadros.map(q => q.P[lado].z);
        const ys = quadros.map(q => q.P[lado].y);
        assert.ok(faixa(xs).max - faixa(xs).min < 0.002, `${exercicio}-${id}: ${lado} andou em X`);
        assert.ok(faixa(zs).max - faixa(zs).min < 0.002, `${exercicio}-${id}: ${lado} andou em Z`);
        assert.ok(faixa(ys).max - faixa(ys).min < 0.002, `${exercicio}-${id}: ${lado} andou em Y`);
      }
    }
  }
});

await ok("mountain climber: um pé fica apoiado, o outro viaja", async () => {
  for (const id of ["masculino", "feminino"]) {
    const { quadros } = CLIPES[`mountain-climber-${id}`];
    const rig = PERSONAGENS[id].rig;
    const apoio = alturaTornozeloEmPe(rig, 40); /* tornozelo de quem está na ponta */
    const alturas = quadros.map(q => q.peMin);
    /* em todo quadro o pé de baixo tem de estar na altura de apoio */
    const piorApoio = Math.max(...alturas);
    assert.ok(Math.abs(piorApoio - apoio) < 0.05,
      `${id}: nenhum pé no apoio em algum quadro (${piorApoio.toFixed(3)} vs ${apoio.toFixed(3)})`);
    assert.ok(faixa(quadros.map(q => q.peMax)).max > 0.28, `${id}: a perna que dirige não levanta`);
    /*
      O ponto de apoio é sempre o mesmo: cada pé volta ao MESMO lugar no chão.
      Se a autoração derivasse, o pé de apoio mudaria de z a cada ciclo.
    */
    for (const lado of ["footL", "footR"]) {
      const proximo = quadros.reduce((a, b) =>
        Math.abs(b.P[lado].z) < Math.abs(a.P[lado].z) ? b : a);
      assert.ok(Math.abs(proximo.P[lado].z) < 0.02, `${id}: ${lado} não volta ao apoio (z ${proximo.P[lado].z.toFixed(3)})`);
      assert.ok(Math.abs(proximo.P[lado].y - rig.pe.tornozelo * 2.17) < 0.02 || proximo.P[lado].y < 0.2,
        `${id}: ${lado} no apoio com altura estranha (${proximo.P[lado].y.toFixed(3)})`);
      /* só contam os quadros em que o pé está de fato no apoio (z≈0 e altura≈apoio) */
      const xs = quadros
        .filter(q => Math.abs(q.P[lado].z) < 0.005 && Math.abs(q.P[lado].y - proximo.P[lado].y) < 0.005)
        .map(q => q.P[lado].x);
      assert.ok(xs.length > 4, `${id}: ${lado} quase nunca está no apoio`);
      assert.ok(faixa(xs).max - faixa(xs).min < 0.02, `${id}: ${lado} escorregou de lado`);
    }
  }
});

await ok("nenhum clipe fura o chão (vértice mais baixo ≥ −1 cm)", async () => {
  for (const chave of Object.keys(CLIPES)) {
    const { quadros } = CLIPES[chave];
    const menor = Math.min(...quadros.map(q => q.menorVerticeY));
    assert.ok(menor > -0.01, `${chave}: malha ${menor.toFixed(3)} m abaixo do chão`);
  }
});

await ok("nenhum clipe flutua (vértice mais baixo encosta em ≤ 1 cm)", async () => {
  for (const chave of Object.keys(CLIPES)) {
    const { quadros } = CLIPES[chave];
    const menor = Math.min(...quadros.map(q => q.menorVerticeY));
    assert.ok(menor < 0.01, `${chave}: personagem flutuando (${menor.toFixed(3)} m)`);
  }
});

/* ------------------------------------------------------------------ */
/* Posição articular e alinhamento                                     */
/* ------------------------------------------------------------------ */

await ok("flexão: cotovelo dobra até ≤ 70° e estica até ≥ 170°", async () => {
  for (const id of ["masculino", "feminino"]) {
    const { quadros } = CLIPES[`flexao-${id}`];
    const f = faixa(quadros.map(q => q.cotovelo));
    assert.ok(f.min <= 70, `${id}: flexão rasa, cotovelo mínimo ${f.min.toFixed(1)}°`);
    assert.ok(f.max >= 170, `${id}: o braço não estica no alto (${f.max.toFixed(1)}°)`);
    assert.ok(f.max - f.min > 90, `${id}: amplitude pequena (${(f.max - f.min).toFixed(1)}°)`);
  }
});

await ok("flexão: o corpo desce e sobe (quadril varia ≥ 10 cm)", async () => {
  for (const id of ["masculino", "feminino"]) {
    const { quadros } = CLIPES[`flexao-${id}`];
    const f = faixa(quadros.map(q => q.quadrilY));
    assert.ok(f.max - f.min > 0.1, `${id}: quadril quase parado (${(f.max - f.min).toFixed(3)} m)`);
    assert.ok(f.min > 0.15, `${id}: quadril afundou no chão (${f.min.toFixed(3)} m)`);
  }
});

await ok("flexão e prancha: ombro–quadril–tornozelo na mesma linha (≥ 175°)", async () => {
  for (const id of ["masculino", "feminino"]) {
    for (const exercicio of ["flexao", "prancha"]) {
      const { quadros } = CLIPES[`${exercicio}-${id}`];
      const pior = Math.min(...quadros.map(q => q.tronco));
      assert.ok(pior >= 175, `${exercicio}-${id}: tronco torto (${pior.toFixed(1)}°)`);
    }
  }
});

await ok("prancha: cotovelo a 90° e antebraço deitado no chão", async () => {
  for (const id of ["masculino", "feminino"]) {
    const { quadros } = CLIPES[`prancha-${id}`];
    const cotovelos = faixa(quadros.map(q => q.cotovelo));
    assert.ok(Math.abs(cotovelos.min - 90) < 2 && Math.abs(cotovelos.max - 90) < 2,
      `${id}: cotovelo ${cotovelos.min.toFixed(1)}–${cotovelos.max.toFixed(1)}°`);
    const alturaCotovelo = faixa(quadros.map(q => q.P.elbowL.y));
    assert.ok(alturaCotovelo.max < 0.07, `${id}: cotovelo fora do chão (${alturaCotovelo.max.toFixed(3)} m)`);
    const punho = faixa(quadros.map(q => q.mao));
    assert.ok(punho.max - punho.min < 0.002, `${id}: punho se mexeu na prancha`);
    /* postura mantida: quadril parado */
    const quadril = faixa(quadros.map(q => q.quadrilY));
    assert.ok(quadril.max - quadril.min < 0.005, `${id}: quadril oscilou ${(quadril.max - quadril.min).toFixed(4)} m`);
  }
});

await ok("prancha: postura parada, só o pescoço respira", async () => {
  for (const id of ["masculino", "feminino"]) {
    const { quadros } = CLIPES[`prancha-${id}`];
    const giro = faixa(quadros.map(q => q.giroPescoco));
    assert.ok(giro.max > 0.5, `${id}: prancha morta (pescoço parado)`);
    assert.ok(giro.max < 4, `${id}: respiração exagerada (${giro.max.toFixed(1)}°)`);
    /* nenhum osso do corpo anda, nem gira, além do pescoço */
    const quadril = faixa(quadros.map(q => q.quadrilY));
    assert.ok(quadril.max - quadril.min < 0.001, `${id}: quadril se moveu na prancha`);
    const ombro = faixa(quadros.map(q => q.P.armL.y));
    assert.ok(ombro.max - ombro.min < 0.001, `${id}: ombro se moveu na prancha`);
  }
});

await ok("mountain climber: o joelho sobe em direção ao peito (≤ 110°)", async () => {
  for (const id of ["masculino", "feminino"]) {
    const { quadros } = CLIPES[`mountain-climber-${id}`];
    /* uma perna dobra (a que dirige) enquanto a outra estica (a que apoia) */
    const dobrado = faixa(quadros.map(q => q.joelhoMin));
    const esticado = faixa(quadros.map(q => q.joelhoMax));
    assert.ok(dobrado.min <= 110, `${id}: joelho não sobe (mínimo ${dobrado.min.toFixed(1)}°)`);
    assert.ok(esticado.max >= 165, `${id}: a perna não estica atrás (máximo ${esticado.max.toFixed(1)}°)`);
  }
});

await ok("mountain climber: o joelho avança à frente do quadril", async () => {
  for (const id of ["masculino", "feminino"]) {
    const { quadros } = CLIPES[`mountain-climber-${id}`];
    const avanco = Math.max(...quadros.map(q =>
      Math.max(q.P.kneeL.z, q.P.kneeR.z) - q.P.hips.z
    ));
    assert.ok(avanco > 0.3, `${id}: joelho só avançou ${avanco.toFixed(2)} m`);
  }
});

await ok("mountain climber: a prancha alta é mantida (tronco ≥ 150° e mão fixa)", async () => {
  for (const id of ["masculino", "feminino"]) {
    const { quadros } = CLIPES[`mountain-climber-${id}`];
    const pior = Math.min(...quadros.map(q => q.troncoPerna));
    assert.ok(pior >= 150, `${id}: tronco desalinhou (${pior.toFixed(1)}°)`);
    const quadril = faixa(quadros.map(q => q.quadrilY));
    assert.ok(quadril.max - quadril.min < 0.005, `${id}: quadril oscilou`);
    for (const lado of ["handL", "handR"]) {
      const zs = quadros.map(q => q.P[lado].z);
      assert.ok(faixa(zs).max - faixa(zs).min < 0.002, `${id}: ${lado} andou`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Continuidade, laço e compatibilidade com o app                      */
/* ------------------------------------------------------------------ */

await ok("continuidade: nenhum teletransporte de osso entre quadros", async () => {
  /*
    Um membro rápido anda 20–30 cm por quadro a 24 fps (5–7 m/s) — é o caso do
    pé no mountain climber. O que não pode existir é um quadro solto que anda
    muito mais que os vizinhos (teletransporte). Por isso a medida é a razão do
    maior passo contra a mediana dos passos que de fato andam: trecho rápido
    inteiro tem mediana alta, e um salto isolado estoura a razão.
  */
  for (const chave of Object.keys(CLIPES)) {
    const { quadros } = CLIPES[chave];
    let maiorPasso = 0;
    let algumMovimento = 0;
    for (const [nome] of HIERARQUIA) {
      if (nome === "prop") continue;
      const passos = [];
      for (let i = 1; i < quadros.length; i += 1) {
        passos.push(quadros[i].P[nome].distanceTo(quadros[i - 1].P[nome]));
      }
      algumMovimento = Math.max(algumMovimento, Math.max(...passos));
      const ativos = passos.filter(d => d > 0.02).sort((a, b) => a - b);
      if (ativos.length < 8) continue; /* movimento lento: não há pico a comparar */
      const mediana = ativos[Math.floor(ativos.length / 2)];
      const pico = ativos[ativos.length - 1];
      maiorPasso = Math.max(maiorPasso, pico);
      assert.ok(pico < 0.35, `${chave}: ${nome} anda ${pico.toFixed(3)} m num quadro só`);
      assert.ok(pico / mediana < 5, `${chave}: ${nome} tem pico ${(pico / mediana).toFixed(1)}× a mediana`);
    }
    /* a prancha é uma sustentação estática de propósito: nela quem se move é o
       pescoço (respiração), e isso é conferido no teste da prancha. */
    if (!chave.startsWith("prancha")) {
      assert.ok(algumMovimento > 0.002, `${chave}: nada se moveu`);
    }
  }
});

await ok("laço: o último quadro fecha com o primeiro", async () => {
  for (const chave of Object.keys(CLIPES)) {
    const { quadros, autoral } = CLIPES[chave];
    if (autoral.nome === "prancha") continue; /* prancha é estática, o laço é trivial */
    const primeiro = quadros[0];
    const ultimo = quadros[quadros.length - 1];
    const passo = primeiro.P.hips.distanceTo(ultimo.P.hips);
    assert.ok(passo < 0.12, `${chave}: emenda com salto de ${passo.toFixed(3)} m`);
  }
});

await ok("compatibilidade: toda trilha do GLB acha um osso do rig", async () => {
  for (const chave of Object.keys(CLIPES)) {
    const { arquivo } = CLIPES[chave];
    const gltf = await carregarGLB(arquivo);
    const nomes = new Set(Array.from(PERSONAGENS.masculino.alvo.ossos.keys()));
    const alvo = await carregarPersonagem("masculino");
    const clipe = app.reamarrarFaixas(gltf.animations[0], alvo.cena);
    assert.ok(clipe.tracks.length >= 16, `${chave}: menos trilhas que ossos (${clipe.tracks.length})`);
    for (const trilha of clipe.tracks) {
      const osso = trilha.name.split(".")[0];
      assert.ok(nomes.has(osso), `${chave}: trilha para osso inexistente: ${trilha.name}`);
    }
    assert.ok(clipe.duration > 3, `${chave}: duração curta demais (${clipe.duration})`);
  }
});

await ok("cada clipe passa a assinatura do SEU exercício no analisador do repo", async () => {
  /*
    A assinatura é o que o `analisar-movimentos-3d.mjs` exige de um clipe
    publicado com aquele id (cotovelo dobrando na flexão, quadril baixo e parado
    na prancha, joelho indo ao peito no mountain climber). Passar aqui é o que
    separa "pose válida" de "movimento do exercício certo".
  */
  const { analisarArquivo } = await import(path.join(raiz, "tools/analisar-movimentos-3d.mjs"));
  for (const chave of Object.keys(CLIPES)) {
    const { arquivo } = CLIPES[chave];
    const [exercicio, personagem] = chave.split("-").length === 3
      ? ["mountain-climber", chave.split("-")[2]]
      : chave.split("-");
    const r = await analisarArquivo(arquivo, { personagem, exercicio });
    assert.equal(r.veredito, "ok",
      `${chave}: ${[...r.falhasAssinatura.map(f => f.texto), ...r.higiene].join("; ")}`);
    assert.equal(r.falhasAssinatura.length, 0, `${chave}: assinatura de ${exercicio}`);
  }
});

await ok("determinismo: gerar duas vezes dá o mesmo GLB", async () => {
  for (const id of ["masculino", "feminino"]) {
    const { alvo, rig } = PERSONAGENS[id];
    for (const exercicio of ["flexao", "prancha", "mountain-climber"]) {
      const a = gravar(rig, alvo, exercicio);
      const b = gravar(rig, alvo, exercicio);
      assert.equal(a.bytes.length, b.bytes.length, `${exercicio}-${id}: tamanho diferente`);
      assert.ok(a.bytes.equals(b.bytes), `${exercicio}-${id}: bytes diferentes entre duas gerações`);
    }
  }
});

await ok("os candidatos da fase 4 são exatamente o que o gerador produz hoje", async () => {
  const pasta = path.join(raiz, "docs/validacao-3d/fase4/candidatos");
  for (const id of ["masculino", "feminino"]) {
    const { alvo, rig } = PERSONAGENS[id];
    for (const exercicio of ["flexao", "prancha", "mountain-climber"]) {
      const arquivo = path.join(pasta, `${exercicio}-${id}.glb`);
      assert.ok(fs.existsSync(arquivo), `falta o candidato ${exercicio}-${id}.glb`);
      const { bytes } = gravar(rig, alvo, exercicio);
      assert.ok(bytes.equals(fs.readFileSync(arquivo)),
        `${exercicio}-${id}.glb está desatualizado em relação ao gerador`);
    }
  }
  assert.ok(!fs.existsSync(path.join(raiz, "assets/3d/animacoes/flexao-masculino.glb")),
    "candidato não pode ter vazado para o catálogo");
});

fs.rmSync(temporario, { recursive: true, force: true });
console.log("\n" + testes + " testes de animação autoral 3D, todos verdes.");
