/*
  Contrato da tela de apresentação do exercício (sem personagens 3D).

  Não testa WebGL nem renderização: testa o que a tela promete ao usuário.
    1. A página tem só título + palco 16:9; o vídeo nasce mudo, inline, em
       loop e sem controles, e não existe palco de personagem 3D.
    2. O manifesto de vídeos declara a especificação e a lista aprovada.
    3. Com MP4 aprovado, o vídeo é o único conteúdo do palco.
    4. Sem MP4, a tela informa a pendência — sem prévia 3D e sem movimento
       emprestado de outro exercício.
    5. Vídeo fora da especificação (duração acima de 60 s) não é exibido.
    6. Exercício ausente, exercício desconhecido e manifesto indisponível
       degradam para um estado explícito, sem tela em branco.
    7. Nenhum resquício do sistema de personagens 3D sobrou no repositório e
       nenhum vídeo renderizado em 3D pode existir: o manifesto é a única fonte
       da verdade, e a biblioteca de exercícios continua intacta.
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const existe = rel => fs.existsSync(path.join(repoRoot, rel));
const manifesto = JSON.parse(read("assets/videos/exercicios/manifest.json"));

const results = [];

async function runTest(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("✅ " + name);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log("❌ " + name);
    console.log("   " + String(error && error.stack ? error.stack : error)
      .split("\n").slice(0, 12).join("\n   "));
  }
}

const ESQUELETO = `<!doctype html><html><body>
  <div id="exercicio-stage" data-e3-stage></div>
  <video id="exercicio-video" hidden></video>
  <div id="exercicio-loading"></div>
  <p id="exercicio-error" hidden></p>
  <h1 id="exercicio-title"></h1>
  <a id="exercicio-voltar"></a>
</body></html>`;

/*
  Manifesto usado pelo controlador nos testes. Quando o teste pede um exercício
  específico, o manifesto começa vazio e recebe só ele — assim o cenário não
  depende do estado real de `assets/videos/exercicios/manifest.json`.
*/
function manifestoDeTeste(opcoes) {
  const dados = JSON.parse(JSON.stringify(manifesto));
  if (opcoes.exercicio) {
    dados.exercicios = [opcoes.exercicio];
  }
  return dados;
}

async function abrirControlador(exercicioId, opcoes = {}) {
  const virtualConsole = new VirtualConsole();
  const errosJsdom = [];
  virtualConsole.on("jsdomError", erro => errosJsdom.push(erro));

  const consulta = exercicioId === null
    ? ""
    : "?exercicio=" + encodeURIComponent(exercicioId);

  const dom = new JSDOM(ESQUELETO, {
    url: "https://forja.test/forja/exercicio/index.html" + consulta,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole
  });
  const w = dom.window;

  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};

  const dados = manifestoDeTeste(opcoes);

  w.fetch = async () => {
    if (opcoes.semManifesto) throw new Error("sem rede");
    return { ok: true, json: async () => dados };
  };

  w.Forja = {
    pages: {},
    state: { profile: { version: 3, objetivo: "hipertrofia", sexo: "masculino" }, library: {} },
    ROUTES: { biblioteca: "treino/biblioteca.html" },
    EXERCISE_LIBRARY: {
      calisthenics: [
        { id: "cal-flexao", name: "Flexão de braço" },
        { id: "cal-barra-fixa", name: "Barra fixa (pegada pronada)" }
      ],
      weights: []
    }
  };

  w.eval(read("assets/js/forja-exercicio.js"));
  await w.Forja.pages.exercicio();

  return { dom, w, errosJsdom };
}

await runTest("1. manifesto de vídeos declara 16:9 / 1280×720 / 30 FPS / até 60 s", () => {
  assert.equal(manifesto.formato, "forja-videos-exercicios");
  assert.equal(manifesto.versao, 1);
  assert.deepEqual(manifesto.especificacao, {
    proporcao: "16:9",
    largura: 1280,
    altura: 720,
    fps: 30,
    duracaoMaximaS: 60,
    fundo: "#121010",
    audio: false,
    loop: "infinito"
  });
  assert.ok(Array.isArray(manifesto.exercicios), "lista de exercícios deve existir");
  manifesto.exercicios.forEach(item => {
    assert.ok(item.id, "todo vídeo precisa do id do exercício");
    assert.match(item.video, /^assets\/videos\/exercicios\/.+\.mp4$/);
    assert.ok(!/9x16|vertical/.test(item.video), "só vídeo horizontal");
    assert.ok(!item.duracaoS || item.duracaoS <= 60, "duração máxima de 60 s");
  });
});

await runTest("2. a página tem só título + palco; nenhum resto de personagem 3D", () => {
  const dom = new JSDOM(read("exercicio/index.html"));
  const d = dom.window.document;
  const video = d.querySelector("#exercicio-video");
  const html = read("exercicio/index.html");

  assert.ok(d.querySelector("#exercicio-title"), "título ausente");
  assert.ok(d.querySelector("#exercicio-stage"), "palco ausente");
  assert.ok(video, "vídeo ausente");

  assert.equal(video.hasAttribute("autoplay"), true);
  assert.equal(video.hasAttribute("muted"), true);
  assert.equal(video.hasAttribute("loop"), true);
  assert.equal(video.hasAttribute("playsinline"), true);
  assert.equal(video.hasAttribute("controls"), false, "controles nativos não podem existir");
  assert.equal(d.querySelectorAll("button, select, input, progress").length, 0,
    "a tela não pode ter botão, seletor ou barra de progresso");
  assert.equal(d.querySelectorAll("video").length, 1, "só um vídeo");

  /* Nenhum palco, script ou folha de estilo do sistema 3D. */
  assert.equal(d.querySelector("#exercicio-3d"), null, "palco 3D ainda presente");
  assert.equal(d.querySelectorAll(".e3-palco-3d, .modal-3d, canvas").length, 0,
    "não pode existir área de renderização 3D");
  assert.ok(!/personagens-3d\.css/.test(html), "CSS de personagens ainda referenciado");
  assert.ok(!/forja-3d-cena|forja-personagens|forja-exercicio-cena|forja-exercicio-3d/.test(html),
    "script do sistema 3D ainda referenciado");
  assert.match(html, /forja-exercicio\.js/, "a página precisa do controlador de vídeo");

  assert.ok(!html.includes("9x16"), "não há variante vertical");
  assert.ok(!html.includes("9:16"), "não há variante vertical");

  const css = read("assets/css/exercicio.css");
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.ok(!/aspect-ratio:\s*9\s*\/\s*16/.test(css));
  assert.match(css, /::-webkit-media-controls/);
  assert.ok(!/e3-palco-3d/.test(css), "CSS do palco 3D ainda existe");
});

await runTest("3. MP4 aprovado: autoplay, mudo, loop, inline e sem controles", async () => {
  const { dom, w } = await abrirControlador("cal-flexao", {
    exercicio: {
      id: "cal-flexao",
      nome: "Flexão de braço",
      modalidade: "calisthenics",
      video: "assets/videos/exercicios/cal-flexao-horizontal-16x9.mp4",
      duracaoS: 12.5
    }
  });

  const d = w.document;
  const video = d.querySelector("#exercicio-video");

  assert.match(video.getAttribute("src"), /cal-flexao-horizontal-16x9\.mp4$/);
  assert.equal(video.controls, false);
  assert.equal(video.hasAttribute("controls"), false);
  assert.equal(video.muted, true);
  assert.equal(video.loop, true);
  assert.equal(video.playsInline, true);

  video.dispatchEvent(new w.Event("playing"));

  assert.equal(d.querySelector("#exercicio-stage").dataset.modo, "video");
  assert.equal(video.hidden, false);
  assert.equal(d.querySelector("#exercicio-title").textContent, "Flexão de braço");
  assert.equal(d.querySelector("#exercicio-title").textContent.includes("modelo"), false,
    "o título não menciona personagem");
  assert.equal(d.querySelector("#exercicio-stage").dataset.duracaoMaxima, "60");
  dom.window.close();
});

await runTest("4. sem MP4: pendência explícita, sem prévia 3D", async () => {
  const { dom, w } = await abrirControlador("cal-barra-fixa");

  const d = w.document;
  assert.equal(d.querySelector("#exercicio-stage").dataset.modo, "pendente");
  assert.match(d.querySelector("#exercicio-error").textContent, /ainda não tem vídeo de demonstração/);
  assert.equal(d.querySelector("#exercicio-video").hidden, true);
  assert.equal(d.querySelector("#exercicio-video").hasAttribute("src"), false);
  assert.equal(d.querySelector("#exercicio-video").hasAttribute("controls"), false);
  dom.window.close();
});

await runTest("5. vídeo fora da especificação (mais de 60 s) não é exibido", async () => {
  const { dom, w } = await abrirControlador("cal-flexao", {
    exercicio: {
      id: "cal-flexao",
      nome: "Flexão de braço",
      modalidade: "calisthenics",
      video: "assets/videos/exercicios/cal-flexao-horizontal-16x9.mp4",
      duracaoS: 95
    }
  });

  const d = w.document;
  assert.equal(d.querySelector("#exercicio-stage").dataset.modo, "pendente");
  assert.match(d.querySelector("#exercicio-error").textContent, /fora da especificação/);
  assert.equal(d.querySelector("#exercicio-video").hidden, true);
  dom.window.close();
});

await runTest("6. exercício desconhecido, sem id e sem manifesto degradam sem tela em branco", async () => {
  const desconhecido = await abrirControlador("nao-existe");
  assert.equal(desconhecido.w.document.querySelector("#exercicio-stage").dataset.modo, "erro");
  assert.match(desconhecido.w.document.querySelector("#exercicio-error").textContent,
    /não encontrado na biblioteca/);
  desconhecido.dom.window.close();

  const semId = await abrirControlador(null);
  assert.equal(semId.w.document.querySelector("#exercicio-stage").dataset.modo, "erro");
  assert.match(semId.w.document.querySelector("#exercicio-error").textContent,
    /Escolha um exercício na biblioteca/);
  semId.dom.window.close();

  const semManifesto = await abrirControlador("cal-flexao", { semManifesto: true });
  assert.equal(semManifesto.w.document.querySelector("#exercicio-stage").dataset.modo, "pendente");
  assert.match(semManifesto.w.document.querySelector("#exercicio-title").textContent,
    /Flexão de braço/);
  semManifesto.dom.window.close();
});

await runTest("7. nenhum resquício do sistema 3D e nenhum vídeo 3D no repositório", () => {
  const removidos = [
    "assets/3d",
    "assets/vendor/three",
    "assets/js/forja-personagens.js",
    "assets/js/forja-3d-cena.js",
    "assets/js/forja-exercicio-cena.js",
    "assets/js/forja-exercicio-3d.js",
    "assets/css/personagens-3d.css",
    "assets/css/exercicio-3d.css",
    "avaliacao-piloto-3d",
    "FORJA_ASSETS_3D",
    "tools/blender",
    "tools/fontes-3d",
    "docs/validacao-3d",
    "docs/assets-3d",
    "tests/personagens3d.test.mjs",
    "tests/mapeamento3d.test.mjs",
    "tests/transferencia3d.test.mjs",
    "tests/pose-autoral3d.test.mjs",
    "tests/avaliacao-piloto-3d.test.mjs"
  ];
  removidos.forEach(item => assert.equal(existe(item), false, "ainda existe: " + item));

  /* Nenhuma página do app carrega módulo, folha de estilo ou dado 3D. */
  const paginas = [];
  const varrer = (dir) => {
    fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).forEach(entrada => {
      const rel = path.posix.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (["assets", "node_modules", ".git", "tests", "tools", "docs", "design", "artifacts"].includes(rel)) return;
        varrer(rel);
      } else if (entrada.name.endsWith(".html")) {
        paginas.push(rel);
      }
    });
  };
  varrer(".");
  assert.ok(paginas.length >= 10, "espera-se as páginas do app, encontradas: " + paginas.length);

  const proibido = /personagens-3d\.css|forja-personagens\.js|forja-3d-cena\.js|forja-exercicio-cena\.js|forja-exercicio-3d\.js|vendor\/three|assets\/3d\/|avaliacao-piloto-3d/;
  paginas.forEach(pagina => {
    const html = read(pagina);
    const achado = html.match(proibido);
    assert.equal(achado, null, pagina + " ainda referencia " + (achado && achado[0]));
  });

  /*
    Trava contra o retorno de vídeo renderizado em 3D.

    A regra não é "nenhum vídeo pode existir": a próxima etapa vai acrescentar
    vídeos de pessoas reais. A regra é que o manifesto seja a única fonte da
    verdade — todo arquivo de vídeo do repositório precisa estar listado nele,
    e todo item do manifesto precisa apontar para um arquivo real, horizontal
    e com no máximo 60 s. Assim, um MP4 3D largado na pasta (ou um render novo
    copiado para `docs/`) reprova o teste em vez de passar silenciosamente.
  */
  const pastaVideos = "assets/videos/exercicios";
  const permitidosNoManifesto = new Set(
    manifesto.exercicios.map(item => item.video.replace(/^assets\/videos\/exercicios\//, ""))
  );

  const videosNoRepo = [];
  const varrerVideos = (dir) => {
    fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).forEach(entrada => {
      const rel = path.posix.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (["node_modules", ".git"].includes(rel)) return;
        varrerVideos(rel);
        return;
      }
      if (/[.](mp4|webm|mov|m4v|ogv)$/i.test(entrada.name)) videosNoRepo.push(rel);
    });
  };
  varrerVideos(".");

  const foraDoManifesto = videosNoRepo.filter(
    rel => !(rel.startsWith(pastaVideos + "/") && permitidosNoManifesto.has(path.posix.basename(rel)))
  );
  assert.deepEqual(foraDoManifesto, [],
    "vídeo fora do manifesto de vídeos aprovados: " + foraDoManifesto.join(", "));

  const ausentes = manifesto.exercicios.filter(item => !existe(item.video));
  assert.deepEqual(ausentes.map(item => item.video), [],
    "o manifesto lista vídeo que não existe no repositório");

  /* Sem vídeo aprovado, a pasta tem só documentação e manifesto. */
  const arquivosNaPasta = fs.readdirSync(path.join(repoRoot, pastaVideos)).sort();
  const esperados = manifesto.exercicios.length
    ? arquivosNaPasta
    : ["README.md", "manifest.json"];
  assert.deepEqual(arquivosNaPasta, esperados);

  /*
    Estado desta entrega: nenhum vídeo aprovado e nenhum render 3D. Os quatro
    MP4 do piloto abdominal (Blender/Cycles) foram removidos — este assert é o
    que impede que eles (ou qualquer render novo) voltem.
  */
  if (manifesto.exercicios.length === 0) {
    assert.deepEqual(videosNoRepo, [],
      "vide o de demonstração inesperado no repositório: " + videosNoRepo.join(", "));
  }

  /* A pasta antiga do piloto 3D e seus renders não podem reaparecer. */
  ["avaliacao-piloto-3d", "docs/validacao-3d", "docs/assets-3d", "assets/3d", "FORJA_ASSETS_3D"]
    .forEach(item => assert.equal(existe(item), false, "pasta do sistema 3D reapareceu: " + item));
  assert.equal(existe("docs/validacao-3d/piloto-abdominal-masculino/abdominal-masculino-horizontal-16x9.mp4"),
    false, "o MP4 do piloto abdominal voltou");
  assert.equal(existe("avaliacao-piloto-3d/midia/abdominal-masculino-vertical-9x16.mp4"),
    false, "o MP4 vertical do piloto abdominal voltou");

  /* A biblioteca de exercícios continua completa: 18 calistenia + 19 musculação. */
  const biblioteca = read("assets/js/forja-biblioteca.js");
  assert.equal((biblioteca.match(/item\("/g) || []).length, 37,
    "a biblioteca de exercícios mudou de tamanho");
  assert.match(biblioteca, /cal-flexao/);
  assert.match(biblioteca, /mus-supino-reto/);
});

const falhas = results.filter(resultado => !resultado.ok);
console.log("\n" + (results.length - falhas.length) + "/" + results.length + " testes passaram.");
if (falhas.length) process.exit(1);
