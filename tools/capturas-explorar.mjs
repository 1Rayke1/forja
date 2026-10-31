/*
  FORJA — capturas e medições da tela Explorar.

  Sobe o repositório sob /forja/ (como no GitHub Pages), semeia um estado de
  exemplo no localStorage e tira capturas de tela em navegador real para as
  larguras exigidas pela auditoria visual: 320, 360, 390, 430, 768 e 1440 px.

  Saída (pasta indicada em --saida):
    <largura>-dobra.png        primeiro quadro da tela (o que o usuário vê)
    <largura>-completa.png     página inteira
    <largura>-secao-<id>.png   cada seção recortada
    <largura>-vazio-dobra.png  estado sem rotinas (usuário novo)
    relatorio.json             medidas de layout, uso de fotografias e erros

  Uso:
    npm install
    node tools/capturas-explorar.mjs --saida docs/capturas/explorar-fotos/antes
    node tools/capturas-explorar.mjs --saida /tmp/depois --semear 0
*/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { brotliDecompressSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = nome => args.indexOf(nome) !== -1;
const valor = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i !== -1 && args[i + 1] ? args[i + 1] : padrao;
};

const SAIDA = path.resolve(ROOT, valor("--saida", "docs/capturas/explorar-fotos/antes"));
const LARGURAS = (valor("--larguras", "320,360,390,430,768,1440"))
  .split(",")
  .map(n => Number(n.trim()))
  .filter(Boolean);
const SEMEAR = valor("--semear", "1") !== "0";
const PAUSA = ms => new Promise(r => setTimeout(r, ms));
const ALTURA_MOVEL = 844;
const ALTURA_TABLET = 1024;
const ALTURA_DESKTOP = 900;

const alturaPara = largura => (largura <= 430 ? ALTURA_MOVEL : largura <= 768 ? ALTURA_TABLET : ALTURA_DESKTOP);

fs.mkdirSync(SAIDA, { recursive: true });

/* ---------------------------------------------------------------- */
/* Chromium: binário empacotado + bibliotecas do tar.br do pacote.   */
/* ---------------------------------------------------------------- */

const puppeteer = (await import("puppeteer-core")).default;
const chromium = (await import("@sparticuz/chromium")).default;

function prepararBibliotecasLinux(executablePath) {
  if (process.platform !== "linux" || !executablePath.includes(os.tmpdir())) return;
  try {
    const modulo = fileURLToPath(import.meta.resolve("@sparticuz/chromium"));
    const pacote = path.resolve(path.dirname(modulo), "../..");
    const arquivo = path.join(pacote, "bin", "al2023.tar.br");
    const destino = path.join(os.tmpdir(), "forja-capturas-al2023");
    if (!fs.existsSync(path.join(destino, "lib", "libnspr4.so"))) {
      fs.mkdirSync(destino, { recursive: true });
      const tar = path.join(os.tmpdir(), "forja-capturas-al2023.tar");
      fs.writeFileSync(tar, brotliDecompressSync(fs.readFileSync(arquivo)));
      execFileSync("tar", ["-xf", tar, "-C", destino]);
      fs.unlinkSync(tar);
    }
    process.env.LD_LIBRARY_PATH = path.join(destino, "lib");
  } catch (erro) {
    console.warn("Bibliotecas do Chromium não puderam ser extraídas: " + erro.message);
  }
}

const executablePath = await chromium.executablePath();
prepararBibliotecasLinux(executablePath);

/* ---------------------------------------------------------------- */
/* Servidor estático do repositório sob /forja/                      */
/* ---------------------------------------------------------------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};
const BLOQUEADOS = new Set(["node_modules", ".git", "tests", "tools", "artifacts", ".github"]);

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (!url.pathname.startsWith("/forja/")) {
    res.writeHead(404).end("not found");
    return;
  }
  let relativo = decodeURIComponent(url.pathname.slice("/forja/".length));
  if (!relativo || relativo.endsWith("/")) relativo += "index.html";
  const arquivo = path.resolve(ROOT, relativo);
  const primeiro = path.relative(ROOT, arquivo).split(path.sep)[0];
  if (!arquivo.startsWith(ROOT + path.sep) || BLOQUEADOS.has(primeiro) || primeiro.startsWith(".")) {
    res.writeHead(404).end("not found");
    return;
  }
  fs.readFile(arquivo, (erro, dados) => {
    if (erro) {
      res.writeHead(404).end("not found");
      return;
    }
    res.setHeader("Content-Type", MIME[path.extname(arquivo)] || "application/octet-stream");
    res.end(dados);
  });
});
await new Promise(r => servidor.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + servidor.address().port + "/forja/";

/* ---------------------------------------------------------------- */
/* Estado semeado: rotinas reais do formato do app                   */
/* ---------------------------------------------------------------- */

const agora = new Date(process.env.FORJA_CAPTURE_NOW || Date.now());
const iso = dias => new Date(agora.getTime() - (dias || 0) * 86400000).toISOString();
const rotina = (id, nome, exercicios, modalidade) => ({
  id,
  name: nome,
  modality: modalidade || "weights",
  createdAt: iso(30),
  updatedAt: iso(1),
  sections: {
    warmup: [],
    main: exercicios.map((e, i) => ({
      id: e.id,
      name: e.name,
      section: "main",
      sets: 3,
      reps: "8–10",
      rest: 90,
      type: "reps",
      measure: "reps",
      load: "",
      notes: "",
      order: i
    })),
    abs: [],
    finisher: []
  }
});

const perfil = {
  version: 2, objetivo: "forca", nivel: "intermediario", equipamento: "academia",
  sexo: "", modalidadePreferida: "weights", diasPorSemana: 3, duracaoMinutos: 45,
  updatedAt: iso(0), onboardingConcluidoEm: iso(10)
};

/* Perfil configurado e nenhuma rotina: o que vê quem acabou de sair do onboarding. */
const seedBase = {
  "forja-treino-rotinas-v1": { calisthenics: [], weights: [] },
  "forja-treino-historico-v1": [],
  "forja-treino-metas-v1": { version: 1, updatedAt: iso(), modality: "weights", weeklySessions: 3, weeklySets: 12, weeklyMinutes: 120 },
  "forja-perfil-v1": perfil,
  "forja-preferencias-v1": { soundOnRest: false, vibrateOnRest: false }
};

/* Perfil configurado com planos reais, para medir o cartão de destaque. */
const seed = {
  ...seedBase,
  "forja-treino-rotinas-v1": {
    calisthenics: [rotina("cap-cal-a", "Calistenia A — corpo todo", [
      { id: "flexao", name: "Flexão de braços" },
      { id: "barra-fixa", name: "Barra fixa" }
    ], "calisthenics")],
    weights: [
      rotina("cap-forca-a", "Força A — peito e ombro", [
        { id: "supino-reto", name: "Supino reto" },
        { id: "desenvolvimento", name: "Desenvolvimento" }
      ]),
      rotina("cap-forca-b", "Força B — costas e bíceps", [
        { id: "remada-curvada", name: "Remada curvada" },
        { id: "rosca-direta", name: "Rosca direta" }
      ])
    ]
  }
};

const SECOES = [
  "planos-destaque",
  "foco-treino",
  "planos-sete-dias",
  "recursos",
  "treinos-populares",
  "treinos-rapidos",
  "treino-direcionado"
];

/* ---------------------------------------------------------------- */
/* Medições dentro da página                                         */
/* ---------------------------------------------------------------- */

function medir(SECOES) {
  const caixa = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top + window.scrollY),
      left: Math.round(r.left),
      largura: Math.round(r.width),
      altura: Math.round(r.height)
    };
  };

  const vh = window.innerHeight;

  const cartoes = Array.from(document.querySelectorAll(
    ".plano-card, .popular-card, .rapido-card, .foco-card, .recurso-card, .direcionado-card"
  )).map(el => {
    const img = el.querySelector("img");
    const estilo = getComputedStyle(el);
    return {
      classe: el.className,
      titulo: (el.querySelector("h3") || {}).textContent || "",
      caixa: caixa(el),
      proporcaoAlturaTela: +(el.getBoundingClientRect().height / vh).toFixed(3),
      foto: img ? img.currentSrc.replace(/^.*\/assets\/fotografias\//, "") : null,
      fotoVisivel: img ? {
        larguraExibida: Math.round(img.getBoundingClientRect().width),
        alturaExibida: Math.round(img.getBoundingClientRect().height),
        larguraNatural: img.naturalWidth,
        alturaNatural: img.naturalHeight,
        fit: getComputedStyle(img).objectFit,
        posicao: getComputedStyle(img).objectPosition,
        ampliacao: +(img.getBoundingClientRect().width / (img.naturalWidth || 1)).toFixed(2)
      } : null,
      semFoto: estilo.backgroundImage.indexOf("gradient") !== -1 && !img ? true : false
    };
  });

  const info = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      tag: el.tagName,
      classe: el.className,
      retangulo: [r.left, r.top, r.width, r.height].map(Math.round),
      posicao: s.position,
      overflow: s.overflow
    };
  };
  const primeiro = document.querySelector(".plano-card");
  const diagnostico = primeiro ? {
    cartao: info(primeiro),
    picture: info(primeiro.querySelector("picture")),
    imagem: info(primeiro.querySelector("img")),
    corrente: (() => {
      const lista = [];
      let el = primeiro;
      for (let i = 0; i < 5 && el; i++) { lista.push(el.tagName + "." + el.className); el = el.parentElement; }
      return lista;
    })()
  } : null;

  const fotos = cartoes.map(c => c.foto).filter(Boolean);
  const repetidas = fotos.filter((f, i) => fotos.indexOf(f) !== i);

  return {
    viewport: { largura: innerWidth, altura: vh },
    documento: {
      largura: document.documentElement.clientWidth,
      larguraRolagem: document.documentElement.scrollWidth,
      altura: document.documentElement.scrollHeight
    },
    transbordoHorizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    secoes: Object.fromEntries(SECOES.map(id => {
      const el = document.getElementById(id);
      return [id, el ? caixa(el) : null];
    })),
    cartoes,
    totalCartoes: cartoes.length,
    cartoesComFoto: cartoes.filter(c => c.foto).length,
    cartoesSemFoto: cartoes.filter(c => !c.foto).length,
    fotosUsadas: Array.from(new Set(fotos)).sort(),
    fotosRepetidas: Array.from(new Set(repetidas)).sort(),
    diagnostico,
    maiorCartao: cartoes.reduce((a, b) => (!a || (b.caixa && b.caixa.altura > a.caixa.altura) ? b : a), null)
  };
}

/* ---------------------------------------------------------------- */
/* Captura                                                           */
/* ---------------------------------------------------------------- */

const navegador = await puppeteer.launch({
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
  executablePath,
  headless: true
});

const relatorio = {
  geradoEm: new Date().toISOString(),
  fixture: "explorar-fotografias-v1",
  larguras: LARGURAS,
  semear: SEMEAR,
  tela: {}
};

const errosGlobais = [];

try {
  for (const largura of LARGURAS) {
    const altura = alturaPara(largura);
    const pagina = await navegador.newPage();
    await pagina.setViewport({ width: largura, height: altura, deviceScaleFactor: 2 });
    const erros = [];
    pagina.on("pageerror", e => erros.push("pageerror: " + e.message + "\n" + (e.stack || "")));
    pagina.on("console", m => {
      if (m.type() === "error") erros.push("console: " + m.text());
    });
    pagina.on("requestfailed", r => erros.push("requestfailed: " + r.url()));

    const estado = SEMEAR ? seed : seedBase;
    await pagina.evaluateOnNewDocument(dados => {
      for (let i = localStorage.length - 1; i >= 0; i--) localStorage.removeItem(localStorage.key(i));
      Object.entries(dados).forEach(([chave, valor]) => localStorage.setItem(chave, JSON.stringify(valor)));
    }, estado);
    await pagina.goto(BASE + "explorar/", { waitUntil: "networkidle0" });

    await pagina.evaluate(() => document.fonts.ready);
    /* Garante que as imagens lazy abaixo da dobra também entrem no relatório. */
    await pagina.evaluate(async () => {
      document.querySelectorAll("img[loading='lazy']").forEach(img => { img.loading = "eager"; });
      await Promise.all(Array.from(document.images).filter(i => !i.complete).map(i =>
        new Promise(r => { i.addEventListener("load", r); i.addEventListener("error", r); })
      ));
    });
    await PAUSA(250);

    const nome = String(largura);
    await pagina.screenshot({ path: path.join(SAIDA, `${nome}-dobra.png`), fullPage: false });
    await pagina.screenshot({ path: path.join(SAIDA, `${nome}-completa.png`), fullPage: true });

    for (const id of SECOES) {
      const alvo = await pagina.$("#" + id);
      if (!alvo) continue;
      await alvo.screenshot({ path: path.join(SAIDA, `${nome}-secao-${id}.png`) }).catch(() => {});
    }

    const naTelaExplorar = await pagina.evaluate(() => Boolean(document.getElementById("carousel-planos")));
    if (!naTelaExplorar) throw new Error("A página não é a Explorar (largura " + largura + "): " + pagina.url());
    const medidas = await pagina.evaluate(medir, SECOES);
    relatorio.tela[largura] = { ...medidas, erros };
    if (erros.length) errosGlobais.push({ largura, erros });

    await pagina.close();
  }

  /* Estado de usuário novo (sem rotinas) no celular. */
  for (const largura of [360, 390]) {
    const pagina = await navegador.newPage();
    await pagina.setViewport({ width: largura, height: alturaPara(largura), deviceScaleFactor: 2 });
    await pagina.evaluateOnNewDocument(dados => {
      for (let i = localStorage.length - 1; i >= 0; i--) localStorage.removeItem(localStorage.key(i));
      Object.entries(dados).forEach(([chave, valor]) => localStorage.setItem(chave, JSON.stringify(valor)));
    }, seedBase);
    await pagina.goto(BASE + "explorar/", { waitUntil: "networkidle0" });
    await pagina.evaluate(() => document.fonts.ready);
    await PAUSA(250);
    await pagina.screenshot({ path: path.join(SAIDA, `${largura}-vazio-dobra.png`), fullPage: false });
    if (!relatorio.vazio) relatorio.vazio = {};
    relatorio.vazio[largura] = await pagina.evaluate(medir, SECOES);
    await pagina.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

fs.writeFileSync(path.join(SAIDA, "relatorio.json"), JSON.stringify(relatorio, null, 2) + "\n");

const resumo = {
  saida: path.relative(ROOT, SAIDA),
  larguras: LARGURAS,
  porLargura: Object.fromEntries(Object.entries(relatorio.tela).map(([largura, dados]) => [largura, {
    cartoes: dados.totalCartoes,
    comFoto: dados.cartoesComFoto,
    semFoto: dados.cartoesSemFoto,
    fotosDistintas: dados.fotosUsadas.length,
    fotosRepetidas: dados.fotosRepetidas,
    maiorCartao: dados.maiorCartao && {
      titulo: dados.maiorCartao.titulo,
      altura: dados.maiorCartao.caixa.altura,
      fracaoDaTela: dados.maiorCartao.proporcaoAlturaTela
    },
    transbordoHorizontal: dados.transbordoHorizontal,
    alturaDocumento: dados.documento.altura,
    erros: dados.erros.length
  }]))
};
console.log(JSON.stringify(resumo, null, 2));
if (errosGlobais.length) console.error("Erros de página:", JSON.stringify(errosGlobais, null, 2));
