/*
  Contrato da tela de apresentação do exercício (V2).

  Não testa WebGL nem renderização: testa o que a tela promete ao usuário.
    1. O manifesto cobre a biblioteca inteira e declara a especificação.
    2. Nenhum exercício usa o clipe abdominal por empréstimo.
    3. A auditoria tem 42 loops fechados + 1 exceção conhecida (caminhada).
    4. A página tem só título + palco; o vídeo nasce mudo, inline, em loop e
       sem controles.
    5. O controlador mostra vídeo quando existe MP4 aprovado.
    6. Sem MP4, mostra a prévia 3D do clipe EXATO do exercício.
    7. Sem clipe, mostra a pendência — sem inventar movimento.
    8. Perfil feminino chega ao título e ao palco.
    9. O gerador está atualizado (`--check`).
   10. A página está ligada ao gerador/ponte e não carrega o painel interativo.
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const manifesto = JSON.parse(read("assets/3d/apresentacao-exercicios.json"));

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
  <div id="exercicio-3d" hidden></div>
  <div id="exercicio-loading"></div>
  <p id="exercicio-error" hidden></p>
  <h1 id="exercicio-title"></h1>
  <a id="exercicio-voltar"></a>
</body></html>`;

async function abrirControlador(exercicioId, opcoes = {}) {
  const virtualConsole = new VirtualConsole();
  const errosJsdom = [];
  virtualConsole.on("jsdomError", erro => errosJsdom.push(erro));

  const dom = new JSDOM(ESQUELETO, {
    url: "https://forja.test/forja/exercicio/index.html?exercicio=" + encodeURIComponent(exercicioId),
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole
  });
  const w = dom.window;

  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};

  const chamadas = [];
  const dados = JSON.parse(JSON.stringify(manifesto));
  if (typeof opcoes.alterar === "function") opcoes.alterar(dados);

  w.fetch = async () => {
    if (opcoes.semManifesto) throw new Error("sem rede");
    return { ok: true, json: async () => dados };
  };

  w.Forja = {
    pages: {},
    state: {
      profile: Object.assign(
        { version: 3, objetivo: "hipertrofia" },
        opcoes.personagem ? { sexo: opcoes.personagem } : { sexo: "masculino" }
      )
    },
    resolvePersonagem: perfil => ({
      id: perfil && perfil.sexo === "feminino" ? "feminino" : "masculino"
    }),
    EXERCISE_LIBRARY: {
      calisthenics: [
        { id: "cal-flexao", name: "Flexão de braço" },
        { id: "cal-barra-fixa", name: "Barra fixa (pegada pronada)" }
      ],
      weights: []
    },
    exercicio3d: {
      montar: async (container, dados) => {
        chamadas.push({ container, dados });
        return {
          estado: { erro: null, carregado: true, tocando: true },
          especificacao: {
            camera: {
              azimuteGraus: -58,
              elevacaoGraus: 22,
              campoVisaoVerticalGraus: 32
            }
          },
          destruir() {}
        };
      }
    }
  };

  w.eval(read("assets/js/forja-exercicio-3d.js"));
  await w.Forja.pages.exercicio();

  return { dom, w, chamadas, errosJsdom };
}

await runTest("1. manifesto cobre a biblioteca e declara 16:9 / 1280×720 / 30 FPS / #121010", () => {
  assert.equal(manifesto.formato, "forja-apresentacao-exercicios");
  assert.equal(manifesto.exercicios.length, 37);
  assert.equal(manifesto.resumo.totalExercicios, 37);
  assert.equal(manifesto.resumo.comClipe3d + manifesto.resumo.semClipe3d, 37);
  assert.equal(manifesto.resumo.comClipe3d, 14);
  assert.equal(manifesto.resumo.comClipeEmRevisao, 15);
  assert.equal(manifesto.resumo.emPrevia3d, 0);
  assert.equal(manifesto.resumo.comVideoPronto, 14);
  assert.equal(manifesto.resumo.pendentesDeAnimacao, 23);
  assert.equal(manifesto.resumo.pendentesSemClipe, 8);
  assert.equal(manifesto.resumo.pendentesComClipeEmRevisao, 15);

  const especificacao = manifesto.especificacao;
  assert.equal(especificacao.proporcao, "16:9");
  assert.equal(especificacao.orientacao, "horizontal");
  assert.equal(especificacao.largura, 1280);
  assert.equal(especificacao.altura, 720);
  assert.equal(especificacao.fps, 30);
  assert.equal(especificacao.fundo, "#121010");
  assert.equal(especificacao.loop, "infinito");
  assert.equal(especificacao.audio, false);
  assert.equal(especificacao.controles, false);
  assert.equal(especificacao.autoplay, true);
  assert.equal(especificacao.reproduzirInline, true);
  assert.equal(especificacao.camera.azimuteGraus, -58);
  assert.equal(especificacao.camera.elevacaoGraus, 22);
  assert.equal(especificacao.camera.campoVisaoVerticalGraus, 32);

  const ids = manifesto.exercicios.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, "id de exercício repetido no manifesto");

  /* O manifesto precisa ser idêntico em qualquer worktree. Caminho absoluto
     do ambiente de geração vazaria para o JSON e quebraria o --check. */
  const json = JSON.stringify(manifesto);
  assert.ok(!json.includes("/home/"), "manifesto contém caminho absoluto /home/");
  assert.ok(!json.includes("/tmp/"), "manifesto contém caminho absoluto /tmp/");
});

await runTest("2. nenhum exercício pega o clipe abdominal emprestado", () => {
  const comAbdominal = manifesto.exercicios.filter(item => item.clipeId === "abdominal-supra");
  assert.deepEqual(comAbdominal.map(item => item.id), ["cal-abdominal-supra"]);

  manifesto.exercicios.forEach(item => {
    if (item.clipeId) assert.equal(item.clipeQualidade, "exact");
    if (item.clipeRevisao) {
      assert.equal(item.clipeId, null);
      assert.equal(item.clipeRevisao.status, "review");
      assert.equal(item.personagens.masculino, null);
      assert.equal(item.personagens.feminino, null);
    }
    if (!item.clipeId) return;
    assert.ok(
      item.personagens.masculino && item.personagens.feminino,
      item.id + " tem clipe sem os dois personagens"
    );
    assert.ok(
      item.personagens.masculino.modelo.endsWith("masculino.glb"),
      item.id + " aponta para o modelo errado"
    );
    assert.ok(
      item.personagens.feminino.modelo.endsWith("feminino.glb"),
      item.id + " aponta para o modelo errado"
    );
  });
});

await runTest("2b. nenhum clipe é reutilizado entre exercícios", () => {
  assert.match(manifesto.mapeamento.regra, /no máximo um exercício/);
  assert.equal(manifesto.mapeamento.conflitos.length, 3);

  const usados = [];
  manifesto.exercicios.forEach(item => {
    if (item.clipeId) usados.push(item.clipeId);
    if (item.clipeRevisao) usados.push(item.clipeRevisao.id);
  });
  assert.equal(new Set(usados).size, usados.length, "clipe repetido no manifesto");

  const conflitos = new Map(manifesto.mapeamento.conflitos.map(item => [item.exercicioId, item]));
  assert.deepEqual([...conflitos.keys()].sort(), ["mus-elevacao-barra", "mus-farmer", "mus-prancha"]);
  conflitos.forEach((conflito, id) => {
    const item = manifesto.exercicios.find(entrada => entrada.id === id);
    assert.equal(item.modo, "pendente-animacao");
    assert.equal(item.clipeId, null);
    assert.equal(item.clipeRevisao, null);
    assert.ok(item.pendencias.some(texto => /já é usado por outro exercício/.test(texto)));
  });
});

await runTest("3. auditoria: 42 loops fechados + 1 exceção conhecida (caminhada)", () => {
  const resumo = manifesto.fontes.auditoriaLoop.resumo;
  assert.equal(resumo.total, 43);
  assert.equal(resumo.fechados, 42);
  assert.equal(resumo.atencao, 1);
  assert.equal(resumo.falhas, 0);
  assert.equal(manifesto.resumo.clipesComLoopFechado, 42);
  assert.equal(manifesto.resumo.clipesComAtencaoDeLoop, 1);
  assert.equal(manifesto.resumo.clipesComFalhaDeLoop, 0);

  const caminhada = manifesto.fontes.auditoriaLoop.arquivos["caminhada.glb"];
  assert.equal(caminhada.status, "atencao");
  assert.equal(caminhada.statusOriginal, "fechado");
  assert.equal(caminhada.excecao.noRaiz, "hips");
  assert.ok(Math.abs(caminhada.excecao.residualRaizM - 0.0021) < 0.0001);
  assert.match(caminhada.excecao.motivo, /preservado sem correção/);
});

await runTest("4. a página tem só título + palco; o vídeo não nasce com controles", () => {
  const dom = new JSDOM(read("exercicio/index.html"));
  const d = dom.window.document;
  const video = d.querySelector("#exercicio-video");

  assert.ok(d.querySelector("#exercicio-title"), "título ausente");
  assert.ok(d.querySelector("#exercicio-stage"), "palco ausente");
  assert.ok(video, "vídeo ausente");

  assert.equal(video.hasAttribute("autoplay"), true);
  assert.equal(video.hasAttribute("muted"), true);
  assert.equal(video.hasAttribute("loop"), true);
  assert.equal(video.hasAttribute("playsinline"), true);
  assert.equal(video.hasAttribute("controls"), false, "controles nativos não podem existir");
  assert.equal(video.controls, false);

  assert.equal(d.querySelectorAll("button, select, input, progress").length, 0,
    "a tela não pode ter botão, seletor ou barra de progresso");
  assert.equal(d.querySelectorAll("video").length, 1, "só um vídeo");
  assert.ok(!read("exercicio/index.html").includes("9x16"), "não há variante vertical");
  assert.ok(!read("exercicio/index.html").includes("9:16"), "não há variante vertical");

  const css = read("assets/css/exercicio-3d.css");
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.ok(!/aspect-ratio:\s*9\s*\/\s*16/.test(css));
  assert.match(css, /::-webkit-media-controls/);
});

await runTest("5. MP4 aprovado: autoplay, mudo, loop, inline e sem controles", async () => {
  const { dom, w, chamadas } = await abrirControlador("cal-flexao", {
    alterar: dados => {
      const item = dados.exercicios.find(entrada => entrada.id === "cal-flexao");
      item.video.masculino = {
        status: "pronto",
        arquivo: "assets/videos/exercicios/cal-flexao-masculino-horizontal-16x9.mp4",
        meta: { largura: 1280, altura: 720, fps: 30, duracaoS: 6, temAudio: false }
      };
    }
  });

  const d = w.document;
  const video = d.querySelector("#exercicio-video");
  Object.defineProperty(video, "videoWidth", { value: 1280, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: 720, configurable: true });
  video.dispatchEvent(new w.Event("loadedmetadata"));
  video.dispatchEvent(new w.Event("playing"));

  assert.match(video.getAttribute("src"), /cal-flexao-masculino-horizontal-16x9\.mp4$/);
  assert.equal(video.controls, false);
  assert.equal(video.hasAttribute("controls"), false);
  assert.equal(video.muted, true);
  assert.equal(video.loop, true);
  assert.equal(video.playsInline, true);
  assert.equal(video.autoplay, true);
  assert.equal(d.querySelector("#exercicio-stage").dataset.modo, "video");
  assert.equal(chamadas.length, 0, "com vídeo pronto, o palco 3D não é montado");
  assert.match(d.querySelector("#exercicio-title").textContent, /Flexão de braço — modelo masculino/);
  assert.equal(video.hidden, false);
  dom.window.close();
});

await runTest("6. sem MP4: prévia 3D com modelo e clipe EXATOS do exercício", async () => {
  const { dom, w, chamadas } = await abrirControlador("cal-flexao", {
    alterar: dados => {
      const item = dados.exercicios.find(entrada => entrada.id === "cal-flexao");
      item.video = { masculino: null, feminino: null };
    },
  });

  assert.equal(chamadas.length, 1);
  const { dados } = chamadas[0];
  assert.match(dados.modelo, /assets\/3d\/personagens\/masculino\.glb$/);
  assert.match(dados.clipeArquivo, /assets\/3d\/animacoes\/flexao\.glb$/);
  assert.equal(dados.clipeId, "flexao");
  assert.equal(dados.personagem, "masculino");
  assert.equal(w.document.querySelector("#exercicio-stage").dataset.modo, "3d");
  assert.equal(w.document.querySelector("#exercicio-video").hidden, true);
  dom.window.close();
});

await runTest("7. sem clipe: pendência explícita, sem movimento inventado", async () => {
  const { dom, w, chamadas } = await abrirControlador("cal-barra-fixa");

  assert.equal(chamadas.length, 0);
  assert.equal(w.document.querySelector("#exercicio-stage").dataset.modo, "pendente");
  assert.match(w.document.querySelector("#exercicio-error").textContent, /ainda não tem animação 3D própria/);
  assert.equal(w.document.querySelector("#exercicio-video").hasAttribute("controls"), false);
  dom.window.close();
});

await runTest("7b. clipe em revisão não vira demonstração: pendência com motivo", async () => {
  const { dom, w, chamadas } = await abrirControlador("cal-polichinelo");

  assert.equal(chamadas.length, 0, "clipe review não pode ser montado como se fosse o exercício");
  assert.equal(w.document.querySelector("#exercicio-stage").dataset.modo, "pendente");
  assert.match(w.document.querySelector("#exercicio-error").textContent, /revisão técnica/);
  dom.window.close();
});

await runTest("7c. clipe já usado por outro exercício: pendência, sem reutilização", async () => {
  const { dom, w, chamadas } = await abrirControlador("mus-prancha");

  assert.equal(chamadas.length, 0, "não pode montar a prancha de outro exercício");
  assert.equal(w.document.querySelector("#exercicio-stage").dataset.modo, "pendente");
  assert.match(w.document.querySelector("#exercicio-error").textContent, /já é usado por outro exercício/);
  dom.window.close();
});

await runTest("8. perfil feminino chega ao título e ao modelo", async () => {
  const { dom, w, chamadas } = await abrirControlador("cal-flexao", {
    personagem: "feminino",
    alterar: dados => {
      const item = dados.exercicios.find(entrada => entrada.id === "cal-flexao");
      item.video = { masculino: null, feminino: null };
    },
  });

  assert.match(w.document.querySelector("#exercicio-title").textContent, /modelo feminino/);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].dados.personagem, "feminino");
  assert.match(chamadas[0].dados.modelo, /feminino\.glb$/);
  dom.window.close();
});

await runTest("9. manifesto indisponível degrada para a biblioteca, sem tela em branco", async () => {
  const { dom, w } = await abrirControlador("cal-flexao", { semManifesto: true });

  assert.equal(w.document.querySelector("#exercicio-stage").dataset.modo, "pendente");
  assert.match(w.document.querySelector("#exercicio-title").textContent, /Flexão de braço/);
  dom.window.close();
});

await runTest("10. gerador atualizado e página de apresentação presente", () => {
  const saida = execFileSync(process.execPath, ["tools/gerar-apresentacao-exercicios.mjs", "--check"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(saida, /Manifesto atualizado: 37 exercícios/);

  assert.ok(fs.existsSync(path.join(repoRoot, "exercicio/index.html")));
  assert.match(read("assets/js/forja-exercicio-cena.js"), /modoApresentacao:\s*true/);
  assert.match(read("exercicio/index.html"), /forja-exercicio-cena\.js/);
  assert.ok(!read("exercicio/index.html").includes("forja-personagens.js"),
    "a tela não deve carregar o painel 3D interativo");
});

const falhas = results.filter(resultado => !resultado.ok);
console.log("\n" + (results.length - falhas.length) + "/" + results.length + " testes passaram.");
if (falhas.length) process.exit(1);
