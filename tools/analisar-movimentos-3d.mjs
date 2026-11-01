#!/usr/bin/env node
/*
  FORJA — análise objetiva dos movimentos 3D publicados.

  Mede o que o clipe FAZ no esqueleto, não o que o nome dele promete. Passa por
  todos os clipes do catálogo, aplica cada um no personagem com o mesmo
  AnimationMixer do app e mede, quadro a quadro:

    altura do quadril, flexão de joelho e cotovelo, flexão de quadril,
    abdução de ombro, altura dos punhos, contato e arrasto dos pés,
    deriva no plano do chão, salto de pose entre quadros, laço contínuo,
    escala de osso animada e NaN.

  Depois compara com a assinatura esperada do exercício (tabela
  `ASSINATURAS`), porque "flexão de braço" sem cotovelo dobrando não é flexão
  de braço, mesmo que o clipe esteja tecnicamente válido.

  Uso:
    node tools/analisar-movimentos-3d.mjs [--saida docs/assets-3d/diagnostico-movimentos.json]
                                          [--clipe id] [--json]

  Uso em teste: o mesmo módulo exporta `analisarClipes()`, usado por
  tests/personagens3d.test.mjs.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* três carrega textura por API de navegador; para medir pose isso não importa. */
globalThis.self = globalThis;
globalThis.createImageBitmap = globalThis.createImageBitmap || (async () => ({ width: 2, height: 2, close() {} }));
if (typeof globalThis.URL.createObjectURL !== "function") {
  globalThis.URL.createObjectURL = () => "blob:analise";
  globalThis.URL.revokeObjectURL = () => {};
}

const THREE = await import(path.join(raiz, "assets/vendor/three/three.module.min.js"));
const { GLTFLoader } = await import(path.join(raiz, "assets/vendor/three/addons/loaders/GLTFLoader.js"));

export function carregarGLB(arquivo) {
  const caminho = path.isAbsolute(arquivo) ? arquivo : path.join(raiz, arquivo);
  return new Promise((resolve, reject) => {
    const buffer = fs.readFileSync(caminho);
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    new GLTFLoader().parse(bytes, "", resolve, reject);
  });
}

const graus = (a, b, c) => {
  const v1 = new THREE.Vector3().subVectors(a, b);
  const v2 = new THREE.Vector3().subVectors(c, b);
  const d = (v1.angleTo(v2) * 180) / Math.PI;
  return Number.isFinite(d) ? d : null;
};

/*
  Assinaturas esperadas. Cada regra é uma função dos extremos medidos; o texto
  aparece no relatório para explicar por que o clipe passou ou falhou.

    joelho      flexão média dos dois joelhos em graus (180 = perna esticada)
    cotovelo    idem para o cotovelo
    quadrilFlex ângulo tronco↔coxa (180 = em pé, < 100 = tronco deitado/dobrado)
    punhoY      altura do punho mais alto
    quadrilY    altura do quadril
    peMin       altura do pé mais baixo
*/
const ASSINATURAS = {
  agachamento: [
    ["joelho", joelho => joelho.min <= 110, "joelho precisa dobrar até ≤ 110°"],
    ["quadrilY", q => q.amp >= 0.15, "quadril precisa descer ≥ 15 cm"]
  ],
  "agachamento-halteres": [
    ["joelho", joelho => joelho.min <= 115, "joelho precisa dobrar até ≤ 115°"],
    ["quadrilY", q => q.amp >= 0.10, "quadril precisa descer ≥ 10 cm"]
  ],
  afundo: [
    ["joelho", joelho => joelho.min <= 115, "joelho precisa dobrar até ≤ 115°"],
    ["quadrilY", q => q.amp >= 0.08, "quadril precisa descer ≥ 8 cm"]
  ],
  /*
    Flexão, supino e prancha são distinguidos pela ALTURA do corpo, não pelo
    ângulo tronco↔coxa: em prancha/flexão o tronco e a coxa ficam alinhados
    (≈180°), o que é o mesmo ângulo de quem está em pé. Quem diz se o corpo está
    no chão é o quadril.
  */
  flexao: [
    ["cotovelo", cotovelo => cotovelo.min <= 110, "cotovelo precisa dobrar até ≤ 110°"],
    ["quadrilY", q => q.max <= 0.65, "o corpo precisa estar baixo, no chão"],
    ["punhoY", p => p.max <= 0.45, "mãos precisam ficar perto do chão"]
  ],
  supino: [
    ["cotovelo", cotovelo => cotovelo.min <= 110, "cotovelo precisa dobrar até ≤ 110°"],
    ["quadrilY", q => q.max <= 0.65, "o corpo precisa estar deitado, no banco/chão"]
  ],
  prancha: [
    ["quadrilY", q => q.max <= 0.45, "o corpo precisa ficar baixo, alinhado com o chão"],
    ["quadrilY", q => q.amp <= 0.08, "prancha é isométrica: quadril não pode subir e descer"]
  ],
  remada: [
    ["cotovelo", cotovelo => cotovelo.min <= 100, "cotovelo precisa dobrar até ≤ 100°"]
  ],
  "remada-invertida": [
    ["cotovelo", cotovelo => cotovelo.min <= 100, "cotovelo precisa dobrar até ≤ 100°"]
  ],
  "remada-sentada": [
    ["cotovelo", cotovelo => cotovelo.min <= 100, "cotovelo precisa dobrar até ≤ 100°"]
  ],
  puxada: [
    ["cotovelo", cotovelo => cotovelo.min <= 100, "cotovelo precisa dobrar até ≤ 100°"]
  ],
  "remada-alta": [
    ["cotovelo", cotovelo => cotovelo.min <= 120, "cotovelo precisa dobrar até ≤ 120°"],
    ["punhoY", p => p.max >= 1.35, "mãos precisam subir até a linha do ombro"]
  ],
  "rosca-direta": [
    ["cotovelo", cotovelo => cotovelo.min <= 80, "cotovelo precisa dobrar até ≤ 80°"]
  ],
  "rosca-rotacao": [
    ["cotovelo", cotovelo => cotovelo.min <= 80, "cotovelo precisa dobrar até ≤ 80°"]
  ],
  desenvolvimento: [
    ["punhoY", p => p.max >= 1.7, "mãos precisam terminar acima da cabeça"],
    ["quadrilY", q => q.min >= 0.8, "o desenvolvimento é em pé, não sentado"]
  ],
  "elevacao-lateral": [
    ["ombroAbd", o => o.max >= 75, "braços precisam abrir até a linha do ombro"]
  ],
  triceps: [
    ["cotovelo", cotovelo => cotovelo.min <= 100, "cotovelo precisa dobrar até ≤ 100°"]
  ],
  polichinelo: [
    ["punhoY", p => p.max >= 1.65, "mãos precisam subir acima da cabeça"],
    ["aberturaPes", a => a.amp >= 0.25, "as pernas precisam abrir e fechar de lado"]
  ],
  "corrida-estacionaria": [
    ["joelho", joelho => joelho.min <= 120, "joelho precisa subir (flexão ≤ 120°)"],
    ["derivaXZ", d => d <= 0.25, "corrida estacionária não pode sair do lugar"]
  ],
  "mountain-climber": [
    /*
      Medido na perna que dobra, não na média: o mountain climber alterna as
      pernas de propósito, então a média fica em ~113° mesmo quando uma perna
      está com o joelho no peito (48°) e a outra esticada (180°).
    */
    ["joelhoDobrado", joelho => joelho.min <= 100, "joelho precisa vir em direção ao peito"],
    ["quadrilFlex", q => q.min <= 120, "corpo precisa ficar baixo, apoiado"]
  ],
  pedalar: [
    ["joelho", joelho => joelho.min <= 110, "joelho precisa dobrar até ≤ 110°"]
  ],
  panturrilha: [
    ["peMin", p => p.max >= 0.03, "calcanhar precisa sair do chão"]
  ],
  "ponte-gluteo": [
    ["quadrilFlex", q => q.min <= 120, "corpo precisa ficar apoiado/deitado"]
  ],
  "peck-deck": [
    ["ombroAbd", o => o.amp >= 35, "braços precisam abrir e fechar na frente do peito"]
  ],
  salto: [
    ["quadrilY", q => q.amp >= 0.10, "precisa haver impulso vertical do quadril"]
  ]
};


/*
  Mede um clipe já carregado. Fica separado porque a mesma medição serve para
  clipe publicado (com assinatura do exercício) e para candidato em disco
  (`analisarArquivo`), que ainda não tem id no catálogo.
*/
export function medir(clipe, cena, ossos, amostras = 48) {
  const mixer = new THREE.AnimationMixer(cena);
  mixer.clipAction(clipe).play();
  const quadros = [];
  for (let i = 0; i < amostras; i += 1) {
    const t = (clipe.duration * i) / Math.max(1, amostras - 1);
    mixer.setTime(Math.min(t, clipe.duration * 0.999));
    cena.updateMatrixWorld(true);
    const pos = nome => ossos.get(nome).getWorldPosition(new THREE.Vector3());
    const P = {};
    for (const nome of ossos.keys()) P[nome] = pos(nome);
    const joelhoL = graus(P.hips, P.kneeL, P.footL);
    const joelhoR = graus(P.hips, P.kneeR, P.footR);
    quadros.push({
      t,
      P,
      joelhoL,
      joelhoR,
      assimetriaJoelho: Math.abs(joelhoL - joelhoR),
      joelho: (joelhoL + joelhoR) / 2,
      /* a perna que mais dobrou: em exercício alternado (mountain climber) a
         média das duas pernas esconde justamente o joelho que sobe */
      joelhoDobrado: Math.min(joelhoL, joelhoR),
      cotovelo: (graus(P.armL, P.elbowL, P.handL) + graus(P.armR, P.elbowR, P.handR)) / 2,
      quadrilFlex: (graus(P.spine, P.legL, P.kneeL) + graus(P.spine, P.legR, P.kneeR)) / 2,
      ombroAbd: (graus(P.spine, P.armL, P.elbowL) + graus(P.spine, P.armR, P.elbowR)) / 2,
      punhoY: Math.max(P.handL.y, P.handR.y),
      quadrilY: P.hips.y,
      peMin: Math.min(P.footL.y, P.footR.y),
      aberturaPes: Math.abs(P.footL.z - P.footR.z),
      ombroY: Math.min(P.armL.y, P.armR.y),
      maos: [P.handL, P.handR],
      pes: [P.footL, P.footR]
    });
  }

  const eixo = chave => quadros.map(q => q[chave]).filter(Number.isFinite);
  const faixa = chave => {
    const v = eixo(chave);
    if (!v.length) return { min: null, max: null, amp: null };
    return {
      min: +Math.min(...v).toFixed(3),
      max: +Math.max(...v).toFixed(3),
      amp: +(Math.max(...v) - Math.min(...v)).toFixed(3)
    };
  };

  /* Deriva no chão: quanto o quadril andou em XZ (personagem "andando" sem querer). */
  let deriva = 0;
  for (let i = 1; i < quadros.length; i += 1) {
    const a = quadros[i - 1].P.hips;
    const b = quadros[i].P.hips;
    deriva = Math.max(deriva, Math.hypot(b.x - a.x, b.z - a.z) * (quadros.length - 1));
  }

  /*
    Salto de pose: maior deslocamento de punho/pé entre amostras vizinhas — e,
    ao lado dele, a razão contra a mediana do próprio clipe. Movimento rápido e
    contínuo (polichinelo, corrida) dá razão baixa; um quadro solto dá razão
    alta. Sem a razão, todo exercício rápido era acusado de "salto".
  */
  const saltosPorQuadro = [];
  let salto = 0;
  for (let i = 1; i < quadros.length; i += 1) {
    let maiorDoQuadro = 0;
    for (const chave of ["maos", "pes"]) {
      for (let lado = 0; lado < 2; lado += 1) {
        const d = quadros[i][chave][lado].distanceTo(quadros[i - 1][chave][lado]);
        maiorDoQuadro = Math.max(maiorDoQuadro, d);
      }
    }
    saltosPorQuadro.push(maiorDoQuadro);
    salto = Math.max(salto, maiorDoQuadro);
  }
  /* pico contra mediana: descontinuidade de verdade dá razão alta */
  const saltosOrdenados = [...saltosPorQuadro].sort((a, b) => a - b);
  const medianaSalto = saltosOrdenados.length
    ? saltosOrdenados[Math.floor(saltosOrdenados.length / 2)]
    : 0;
  const razaoSalto = medianaSalto > 1e-4 ? salto / medianaSalto : 0;

  /* Laço: distância entre a primeira e a última pose, comparada à amplitude toda. */
  const primeira = quadros[0];
  const ultima = quadros[quadros.length - 1];
  let descontinuidade = 0;
  for (const nome of ossos.keys()) {
    descontinuidade = Math.max(descontinuidade, primeira.P[nome].distanceTo(ultima.P[nome]));
  }

  /*
    Escala animada deformaria o corpo. O osso `prop` fica de fora: ele existe
    para segurar acessório e é escondido com escala 0 de propósito. Aqui a
    medida é a VARIAÇÃO dentro da trilha, não a distância de 1.
  */
  const escala = (() => {
    let pior = 0;
    for (const trilha of clipe.tracks) {
      if (!trilha.name.endsWith(".scale")) continue;
      if (trilha.name.startsWith("prop.")) continue;
      const v = trilha.values;
      const base = v[0];
      for (const x of v) pior = Math.max(pior, Math.abs(x - base));
    }
    return +pior.toFixed(4);
  })();

  const medido = {
    quadrilY: faixa("quadrilY"),
    joelho: faixa("joelho"),
    joelhoDobrado: faixa("joelhoDobrado"),
    cotovelo: faixa("cotovelo"),
    quadrilFlex: faixa("quadrilFlex"),
    ombroAbd: faixa("ombroAbd"),
    punhoY: faixa("punhoY"),
    peMin: faixa("peMin"),
    aberturaPes: faixa("aberturaPes"),
    assimetriaJoelho: faixa("assimetriaJoelho"),
    movimentoGraus: +(faixa("joelho").amp + faixa("cotovelo").amp + faixa("ombroAbd").amp).toFixed(1),
    ombroY: faixa("ombroY"),
    derivaXZ: +deriva.toFixed(3),
    /* deslocamento real no chão (extensão do quadril em XZ), diferente de
       derivaXZ, que extrapola a velocidade de um quadro para o clipe inteiro */
    deslocamentoXZ: +Math.hypot(
      Math.max(...quadros.map(q => q.P.hips.x)) - Math.min(...quadros.map(q => q.P.hips.x)),
      Math.max(...quadros.map(q => q.P.hips.z)) - Math.min(...quadros.map(q => q.P.hips.z))
    ).toFixed(3),
    saltoMax: +salto.toFixed(3),
    saltoMediana: +medianaSalto.toFixed(3),
    saltoRazao: +razaoSalto.toFixed(1),
    saltoDescontinuo: Boolean(salto > 0.12 && razaoSalto >= 4),
    descontinuidadeLaco: +descontinuidade.toFixed(3),
    escalaMax: escala,
    quadrosNaN: quadros.filter(q => !Number.isFinite(q.joelho + q.cotovelo + q.quadrilFlex)).length
  };


  mixer.stopAllAction();
  return medido;
}

export async function analisarClipes(opcoes = {}) {
  const catalogo = JSON.parse(fs.readFileSync(path.join(raiz, "assets/3d/catalogo.json"), "utf8"));
  const personagem = opcoes.personagem || "masculino";
  const amostras = opcoes.amostras || 48;
  const gltfPersonagem = await carregarGLB(catalogo.personagens[personagem].arquivo);
  const alvo = opcoes.clipes
    ? catalogo.clipes.filter(clipe => opcoes.clipes.includes(clipe.id))
    : catalogo.clipes;

  const resultados = [];
  for (const info of alvo) {
    const cena = gltfPersonagem.scene;
    const ossos = new Map();
    cena.traverse(objeto => { if (objeto.isBone) ossos.set(objeto.name, objeto); });
    const gltfClipe = await carregarGLB(info.arquivo);
    const clipe = gltfClipe.animations && gltfClipe.animations[0];
    if (!clipe) {
      resultados.push({ id: info.id, erro: "GLB sem animação" });
      continue;
    }
    const medido = medir(clipe, cena, ossos, amostras);
    const assinatura = ASSINATURAS[info.id] || [];
    const falhas = assinatura
      .filter(([chave, teste]) => medido[chave] && medido[chave].min !== null && !teste(medido[chave]))
      .map(([chave, , texto]) => ({ chave, texto }));

    const higiene = [];
    if (medido.quadrosNaN > 0) higiene.push("pose inválida (NaN) em " + medido.quadrosNaN + " amostras");
    if (medido.peMin.min !== null && medido.peMin.min < -0.02) higiene.push("pé abaixo do chão (" + medido.peMin.min + " m)");
    if (medido.saltoDescontinuo) higiene.push("salto de pose entre quadros (" + medido.saltoMax + " m, " + medido.saltoRazao + "× a mediana)");
    if (info.loop && medido.descontinuidadeLaco > 0.12) higiene.push("laço descontínuo (" + medido.descontinuidadeLaco + " m)");
    if (medido.escalaMax > 0.01) higiene.push("escala de osso animada (" + medido.escalaMax + ")");

    resultados.push({
      id: info.id,
      nome: info.nome,
      status: info.status,
      grupo: info.grupo,
      arquivo: info.arquivo,
      duracao: +clipe.duration.toFixed(2),
      loop: Boolean(info.loop),
      exercicios: info.exercicios || [],
      referencia: info.referencia ? info.referencia.nomeEn : null,
      medido,
      assinatura: assinatura.map(([chave, , texto]) => ({ chave, texto })),
      falhasAssinatura: falhas,
      problemaHigiene: higiene,
      veredito: falhas.length || higiene.length ? (falhas.length ? "divergente" : "higiene") : "ok"
    });
  }

  return {
    geradoEm: new Date().toISOString(),
    personagem,
    amostras,
    total: resultados.length,
    divergentes: resultados.filter(r => r.veredito === "divergente").map(r => r.id),
    problemasDeHigiene: resultados.filter(r => r.veredito === "higiene").map(r => r.id),
    clipes: resultados
  };
}

/*
  Mede um clipe que ainda NÃO está no catálogo (candidato em disco). É o portão
  da fase 2: nenhum clipe novo entra no catálogo sem passar por aqui e pela
  folha de imagens.
*/
export async function analisarArquivo(arquivo, opcoes = {}) {
  const personagem = opcoes.personagem || "masculino";
  const amostras = opcoes.amostras || 48;
  const catalogo = JSON.parse(fs.readFileSync(path.join(raiz, "assets/3d/catalogo.json"), "utf8"));
  const gltfPersonagem = await carregarGLB(catalogo.personagens[personagem].arquivo);
  const cena = gltfPersonagem.scene;
  const ossos = new Map();
  cena.traverse(objeto => { if (objeto.isBone) ossos.set(objeto.name, objeto); });
  const gltfClipe = await carregarGLB(arquivo);
  const clipe = gltfClipe.animations && gltfClipe.animations[0];
  if (!clipe) throw new Error("arquivo sem animação: " + arquivo);
  const medido = medir(clipe, cena, ossos, amostras);
  const higiene = [];
  if (medido.quadrosNaN > 0) higiene.push("pose inválida (NaN)");
  if (medido.peMin.min !== null && medido.peMin.min < -0.02) higiene.push("pé abaixo do chão (" + medido.peMin.min + " m)");
  if (medido.saltoDescontinuo) higiene.push("salto de pose entre quadros (" + medido.saltoMax + " m, " + medido.saltoRazao + "× a mediana)");
  if (medido.escalaMax > 0.01) higiene.push("escala de osso animada (" + medido.escalaMax + ")");

  /*
    `--exercicio` aplica no candidato a MESMA assinatura que o catálogo exige do
    clipe publicado. Sem isso um candidato só poderia ser julgado "higiene ok",
    que diz que a pose é válida — não que o movimento é o exercício pedido.
  */
  const assinatura = opcoes.exercicio ? (ASSINATURAS[opcoes.exercicio] || []) : [];
  const falhasAssinatura = assinatura
    .filter(([chave, teste]) => medido[chave] && medido[chave].min !== null && !teste(medido[chave]))
    .map(([chave, , texto]) => ({ chave, texto }));

  return {
    arquivo: path.isAbsolute(arquivo) ? arquivo : path.join(raiz, arquivo),
    duracao: +clipe.duration.toFixed(2),
    exercicio: opcoes.exercicio || null,
    medido,
    higiene,
    falhasAssinatura,
    veredito: falhasAssinatura.length ? "divergente" : (higiene.length ? "higiene" : "ok")
  };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
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

const ehPrincipal = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (ehPrincipal) {
  const opcoes = argumentos(process.argv.slice(2));
  if (opcoes.arquivo) {
    const r = await analisarArquivo(opcoes.arquivo, {
      amostras: opcoes.amostras ? Number(opcoes.amostras) : 48,
      personagem: opcoes.personagem || "masculino",
      exercicio: opcoes.exercicio
    });
    if (opcoes.json) {
      console.log(JSON.stringify(r, null, 1));
    } else {
      const m = r.medido;
      console.log(`CANDIDATO — ${path.basename(r.arquivo)} (${r.duracao} s)`);
      console.log(`  quadril Y ${m.quadrilY.min}–${m.quadrilY.max} m · pé ${m.peMin.min}–${m.peMin.max} m`);
      console.log(`  joelho ${m.joelho.min}–${m.joelho.max}° · cotovelo ${m.cotovelo.min}–${m.cotovelo.max}° · ombro ${m.ombroAbd.min}–${m.ombroAbd.max}°`);
      console.log(`  punho máx ${m.punhoY.max} m · abertura dos pés ${m.aberturaPes.amp} m · deriva ${m.derivaXZ} m`);
      console.log(`  higiene: ${r.higiene.length ? r.higiene.join("; ") : "ok"}`);
      if (r.exercicio) {
        console.log(`  assinatura de "${r.exercicio}": ${r.falhasAssinatura.length
          ? r.falhasAssinatura.map(f => f.texto).join("; ")
          : "ok"} (veredito: ${r.veredito})`);
      }
    }
    process.exit(0);
  }
  const relatorio = await analisarClipes({
    clipes: opcoes.clipe ? [opcoes.clipe] : null,
    amostras: opcoes.amostras ? Number(opcoes.amostras) : 48
  });
  const destino = opcoes.saida || path.join(raiz, "docs/assets-3d/diagnostico-movimentos.json");
  if (!opcoes.json) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, JSON.stringify(relatorio, null, 1) + "\n");
  }
  if (opcoes.json) {
    console.log(JSON.stringify(relatorio, null, 1));
  } else {
    console.log(`MOVIMENTOS — ${relatorio.total} clipes analisados`);
    for (const clipe of relatorio.clipes) {
      const marcas = [];
      if (clipe.falhasAssinatura.length) marcas.push("DIVERGE: " + clipe.falhasAssinatura.map(f => f.texto).join("; "));
      if (clipe.problemaHigiene.length) marcas.push("HIGIENE: " + clipe.problemaHigiene.join("; "));
      console.log(`  ${clipe.veredito.padEnd(10)} ${clipe.id.padEnd(24)} ${clipe.status.padEnd(6)} ${marcas.join(" | ")}`);
    }
    console.log(`\n  divergentes (${relatorio.divergentes.length}): ${relatorio.divergentes.join(", ") || "nenhum"}`);
    console.log(`  higiene (${relatorio.problemasDeHigiene.length}): ${relatorio.problemasDeHigiene.join(", ") || "nenhum"}`);
    console.log(`  relatório: ${path.relative(raiz, destino)}`);
  }
}
