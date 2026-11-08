/*
  FORJA — Tela do grupo muscular (treino/grupo.html).

  Esta suíte cobre a segunda tela da Biblioteca: a que abre quando o usuário
  escolhe uma modalidade e uma região. Tudo é conferido contra o catálogo
  central — nenhuma contagem é digitada à mão.

    1–7.  Musculação em cada uma das sete regiões (e seus subgrupos)
    8–9.  Os mesmos fluxos em Calistenia e em Sem equipamentos
     10.  Filtros de equipamento calculados dos exercícios
     11.  Contador sempre igual à lista
     12.  Imagem por exercício (nunca emprestada, sem repetição aleatória)
     13.  Clique no card abre a ficha existente
     14.  Vídeo oficial da própria ficha
     15.  Atlas anatômico do exercício
     16.  "Adicionar ao treino" reaproveita o fluxo de rotina
     17.  Voltar preserva modalidade e região na Biblioteca
     18.  Barra inferior intacta, com Explorar ativa

  Uso: npm test (entra na cadeia) ou node tests/grupo-muscular.test.mjs
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  assertNoErrors,
  boot,
  closeAllApps,
  makeRoutine,
  repoRoot,
  routinesStore,
  wait
} from "./helpers/harness.mjs";

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
  } finally {
    await closeAllApps();
  }
}

const chave = value => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().trim();

const PERFIL = {
  "forja-perfil-v1": {
    version: 3,
    updatedAt: "2026-10-01T00:00:00.000Z",
    objetivo: "manterForma",
    nivel: "iniciante",
    equipamento: "casa",
    diasPorSemana: 3
  }
};

/* As sete regiões, com os grupos oficiais que cada uma agrupa. */
const REGIOES = [
  { id: "peitoral", rotulo: "Peitoral", grupos: ["peitoral"] },
  { id: "costas", rotulo: "Costas", grupos: ["costas"] },
  { id: "ombros", rotulo: "Ombros", grupos: ["ombros", "trapezio"] },
  { id: "bracos", rotulo: "Braços", grupos: ["biceps", "triceps", "antebracos"] },
  { id: "abdomen", rotulo: "Abdômen", grupos: ["abdomen", "obliquos"] },
  { id: "pernas", rotulo: "Pernas", grupos: ["quadriceps", "posteriores", "panturrilhas"] },
  { id: "gluteos", rotulo: "Glúteos", grupos: ["gluteos"] }
];

const MODALIDADES = ["academia", "calistenia", "peso-corporal"];

function url(modalidade, regiao, grupo) {
  const params = new URLSearchParams();
  if (modalidade) params.set("modalidade", modalidade);
  if (regiao) params.set("regiao", regiao);
  if (grupo) params.set("grupo", grupo);
  return "treino/grupo.html?" + params.toString();
}

async function abrir(modalidade, regiao, grupo, storage = PERFIL) {
  const app = await boot(storage, url(modalidade, regiao, grupo));
  await wait(220);
  return app;
}

const cards = app => app.$$("#grupo-lista .gr-card");
const nomesDosCards = app => cards(app).map(card => card.querySelector(".gr-card-nome").textContent.trim());
const numeroDoContador = app => Number(app.$("#grupo-contador").getAttribute("data-total"));
const pilulas = app => app.$$("#grupo-filtros .gr-pilula");
const pilulasDe = (app, linha) => app.$$('#grupo-filtros [data-linha="' + linha + '"] .gr-pilula');
const clicarPilula = async (app, linha, valor) => {
  app.click('#grupo-filtros [data-linha="' + linha + '"] .gr-pilula[data-value="' + valor + '"]');
  await wait(60);
};

/* Quantos exercícios o catálogo tem para os grupos e a modalidade. */
function esperado(app, grupos, modalidade) {
  return app.F.biblioteca.entries().filter(entry => {
    if (modalidade && entry.modalityId !== modalidade) return false;
    return grupos.includes(entry.muscleId);
  }).length;
}

/* ------------------------------------------------------------------ */
/* 1–7. Musculação nas sete regiões                                    */
/* ------------------------------------------------------------------ */

await runTest("1. Musculação → Peitoral: cabeçalho, anatomia, filtros e cards", async () => {
  const app = await abrir("academia", "peitoral");

  assert.equal(app.d.body.dataset.page, "grupo");
  assert.equal(chave(app.text("#grupo-modalidade")), "musculacao");
  assert.equal(app.text("#grupo-titulo"), "Peitoral");
  assert.match(app.text("#grupo-descricao"), /^Exercícios para o seu peitoral/);
  assert.equal(app.$$("h1").length, 1, "A tela precisa de um único h1");
  assert.equal(app.$("h1").id, "grupo-titulo");

  /* Prancha anatômica grande, com o peitoral em destaque. */
  const svg = app.$("#grupo-figura svg");
  assert.ok(svg, "A prancha do grupo não foi desenhada");
  assert.ok(svg.getAttribute("viewBox"), "A prancha precisa de enquadramento próprio");
  assert.ok(app.$$("#grupo-figura .figura-region.is-primary").length > 0,
    "Nenhuma região destacada na prancha");

  /* Filtros em pílula, com "Todos" ativo. */
  const primeira = pilulas(app)[0];
  assert.equal(chave(primeira.textContent), "todos");
  assert.equal(primeira.getAttribute("aria-pressed"), "true");

  const total = esperado(app, ["peitoral"], "academia");
  assert.equal(numeroDoContador(app), total);
  assert.equal(cards(app).length, total, "O contador e a lista discordam");
  cards(app).forEach(card => {
    assert.equal(card.getAttribute("data-muscle"), "peitoral");
    assert.equal(card.getAttribute("data-modality"), "academia");
  });

  assertNoErrors(app, "peitoral musculação");
});

await runTest("2. Musculação → Costas: dorsais em destaque e só exercícios de costas", async () => {
  const app = await abrir("academia", "costas");

  assert.equal(app.text("#grupo-titulo"), "Costas");
  assert.match(chave(app.text("#grupo-descricao")), /costas/);
  assert.equal(chave(app.text("#grupo-modalidade")), "musculacao");

  const total = esperado(app, ["costas"], "academia");
  assert.ok(total > 0);
  assert.equal(numeroDoContador(app), total);
  cards(app).forEach(card => assert.equal(card.getAttribute("data-muscle"), "costas"));
  assert.ok(cards(app).length > 0, "Costas ficou sem exercícios");

  /* A prancha é de costas (dorsais), não a vista anterior. */
  assert.equal(app.$("#grupo-figura svg").getAttribute("data-view"), "back");

  assertNoErrors(app, "costas musculação");
});

await runTest("3. Musculação → Ombros: escolha entre ombros e trapézio", async () => {
  const app = await abrir("academia", "ombros");

  const rotulos = pilulas(app).slice(0, 3).map(p => chave(p.textContent));
  assert.deepEqual(rotulos, ["todos", "ombros", "trapezio"],
    "A região Ombros deveria oferecer os dois grupos oficiais");

  const total = esperado(app, ["ombros", "trapezio"], "academia");
  assert.equal(numeroDoContador(app), total);

  /* Escolher o trapézio reduz para o músculo principal. */
  app.click('.gr-pilula[data-value="trapezio"]');
  await wait(60);
  assert.equal(numeroDoContador(app), esperado(app, ["trapezio"], "academia"));
  cards(app).forEach(card => assert.equal(card.getAttribute("data-muscle"), "trapezio"));

  assertNoErrors(app, "ombros musculação");
});

await runTest("4. Musculação → Braços e seus três subgrupos", async () => {
  const app = await abrir("academia", "bracos");

  const grupos = pilulas(app).slice(0, 4).map(p => chave(p.textContent));
  assert.deepEqual(grupos, ["todos", "biceps", "triceps", "antebracos"]);

  const total = esperado(app, ["biceps", "triceps", "antebracos"], "academia");
  assert.equal(numeroDoContador(app), total);

  for (const grupo of ["biceps", "triceps", "antebracos"]) {
    app.click('.gr-pilula[data-value="' + grupo + '"]');
    await wait(50);
    const esperadoGrupo = esperado(app, [grupo], "academia");
    assert.ok(esperadoGrupo > 0, grupo + " sem exercícios em musculação");
    assert.equal(numeroDoContador(app), esperadoGrupo, "Contador de " + grupo);
    cards(app).forEach(card => assert.equal(card.getAttribute("data-muscle"), grupo,
      "A lista misturou grupos em " + grupo));
  }

  assertNoErrors(app, "braços musculação");
});

await runTest("5. Musculação → Abdômen e oblíquos", async () => {
  const app = await abrir("academia", "abdomen");

  const grupos = pilulas(app).slice(0, 3).map(p => chave(p.textContent));
  assert.deepEqual(grupos, ["todos", "abdomen", "obliquos"]);
  assert.equal(numeroDoContador(app), esperado(app, ["abdomen", "obliquos"], "academia"));

  app.click('.gr-pilula[data-value="obliquos"]');
  await wait(50);
  assert.equal(numeroDoContador(app), esperado(app, ["obliquos"], "academia"));
  cards(app).forEach(card => assert.equal(card.getAttribute("data-muscle"), "obliquos"));

  assertNoErrors(app, "abdômen musculação");
});

await runTest("6. Musculação → Pernas: quadríceps, posteriores e panturrilhas", async () => {
  const app = await abrir("academia", "pernas");

  const grupos = pilulas(app).slice(0, 4).map(p => chave(p.textContent));
  assert.deepEqual(grupos, ["todos", "quadriceps", "posteriores de coxa", "panturrilhas"]);
  assert.equal(numeroDoContador(app),
    esperado(app, ["quadriceps", "posteriores", "panturrilhas"], "academia"));

  for (const grupo of ["quadriceps", "posteriores", "panturrilhas"]) {
    app.click('.gr-pilula[data-value="' + grupo + '"]');
    await wait(50);
    assert.equal(numeroDoContador(app), esperado(app, [grupo], "academia"));
  }

  /* Voltar para "Todos" restaura a região inteira. */
  app.click('.gr-pilula[data-value=""]');
  await wait(50);
  assert.equal(numeroDoContador(app),
    esperado(app, ["quadriceps", "posteriores", "panturrilhas"], "academia"));

  assertNoErrors(app, "pernas musculação");
});

await runTest("7. Musculação → Glúteos", async () => {
  const app = await abrir("academia", "gluteos");

  assert.equal(app.text("#grupo-titulo"), "Glúteos");
  const total = esperado(app, ["gluteos"], "academia");
  assert.ok(total > 0);
  assert.equal(numeroDoContador(app), total);
  assert.equal(app.$("#grupo-figura svg").getAttribute("data-view"), "back",
    "Glúteos deveriam aparecer na vista posterior");

  assertNoErrors(app, "glúteos musculação");
});

/* ------------------------------------------------------------------ */
/* 8–9. Mesmos fluxos nas outras modalidades                           */
/* ------------------------------------------------------------------ */

await runTest("8. Calistenia: as sete regiões usam a mesma tela", async () => {
  const vazias = [];

  for (const regiao of REGIOES) {
    const app = await abrir("calistenia", regiao.id);
    const total = esperado(app, regiao.grupos, "calistenia");

    assert.equal(chave(app.text("#grupo-modalidade")), "calistenia");
    assert.equal(numeroDoContador(app), total, "Contador de " + regiao.rotulo + " em calistenia");
    assert.equal(cards(app).length, total);
    cards(app).forEach(card => assert.equal(card.getAttribute("data-modality"), "calistenia",
      "Calistenia vazou outra modalidade em " + regiao.rotulo));
    if (total === 0) vazias.push(regiao.rotulo);
    app.close();
  }

  /* O catálogo não tem calistenia para glúteos: a tela avisa, não inventa. */
  assert.deepEqual(vazias, ["Glúteos"],
    "Só Glúteos deveria ficar sem calistenia no catálogo atual");
});

await runTest("9. Sem equipamentos: nenhuma opção de equipamento aparece", async () => {
  for (const regiao of REGIOES) {
    const app = await abrir("peso-corporal", regiao.id);
    const total = esperado(app, regiao.grupos, "peso-corporal");

    assert.equal(chave(app.text("#grupo-modalidade")), "sem equipamentos");
    assert.equal(numeroDoContador(app), total, "Contador de " + regiao.rotulo);
    cards(app).forEach(card => assert.equal(card.getAttribute("data-modality"), "peso-corporal"));

    /* Nesta modalidade não existe família de equipamento: só a linha de grupos. */
    assert.equal(pilulasDe(app, "equipamento").length, 0,
      "Sem equipamentos não deveria oferecer filtro de equipamento (" + regiao.rotulo + ")");
    assert.equal(app.F.grupo.familiasDisponiveis().length, 0,
      "Famílias de equipamento vazaram para Sem equipamentos");

    /* Toda pílula restante é grupo oficial da região. */
    pilulasDe(app, "grupo").forEach(pilula => {
      const valor = pilula.getAttribute("data-value");
      if (valor) assert.ok(regiao.grupos.includes(valor), "Pílula estranha: " + valor);
    });

    app.close();
  }
});

/* ------------------------------------------------------------------ */
/* 10. Filtros de equipamento                                          */
/* ------------------------------------------------------------------ */

await runTest("10. Filtros de equipamento existem só para equipamento usado", async () => {
  const app = await abrir("academia", "peitoral");

  const rotulos = pilulasDe(app, "equipamento").map(p => chave(p.textContent));
  assert.ok(rotulos.length > 1, "Peitoral + musculação deveria ter filtros de equipamento");
  assert.equal(rotulos[0], "todos", "“Todos” precisa abrir a linha de equipamento");

  /* Cada família oferecida precisa ter pelo menos um exercício. */
  const familias = app.F.grupo.familiasDisponiveis().map(familia => familia.id);
  assert.ok(familias.length > 0);
  familias.forEach(id => {
    app.click('#grupo-filtros [data-linha="equipamento"] .gr-pilula[data-value="' + id + '"]');
    const total = numeroDoContador(app);
    assert.ok(total > 0, "Filtro de " + id + " não deveria existir: nenhum exercício");
  });

  /* O filtro realmente restringe e "Todos" restaura. */
  await clicarPilula(app, "equipamento", "halteres");
  const comHalteres = cards(app);
  const todos = esperado(app, ["peitoral"], "academia");
  assert.ok(comHalteres.length > 0 && comHalteres.length < todos);
  comHalteres.forEach(card => {
    const entrada = app.F.biblioteca.entries().find(item => item.id === card.getAttribute("data-exercise-id"));
    const familia = app.F.grupo.familias.find(item => item.id === "halteres");
    const usa = (entrada.central ? entrada.central.equipment : []).some(id => familia.ids.includes(id));
    assert.ok(usa, "Card sem halteres no filtro de halteres: " + entrada.name);
  });

  await clicarPilula(app, "equipamento", "");
  assert.equal(numeroDoContador(app), todos, "“Todos” não restaurou a lista");

  /* O catálogo não é reclassificado: os equipamentos originais continuam lá. */
  const registro = app.F.exerciseCatalog.exercises.find(item => item.id === comHalteres[0].getAttribute("data-exercise-id"));
  assert.ok(registro.equipment.length > 0, "A classificação de equipamento sumiu do catálogo");

  assertNoErrors(app, "filtros de equipamento");
});

/* ------------------------------------------------------------------ */
/* 11. Contador                                                        */
/* ------------------------------------------------------------------ */

await runTest("11. Contador acompanha sempre a lista (nunca fixo)", async () => {
  const app = await abrir("academia", "bracos");
  const valores = [];

  const estados = [""].concat(app.F.grupo.familiasDisponiveis().map(familia => familia.id));
  for (const familia of estados) {
    await clicarPilula(app, "equipamento", familia);
    const numero = numeroDoContador(app);
    assert.equal(numero, cards(app).length, "Contador diferente do número de cards");
    assert.match(app.text("#grupo-contador"),
      new RegExp("^" + numero + (numero === 1 ? " exercício encontrado" : " exercícios encontrados") + "$"));
    valores.push(numero);
  }

  assert.ok(new Set(valores).size > 1, "O contador não mudou com os filtros");
  assertNoErrors(app, "contador");
});

/* ------------------------------------------------------------------ */
/* 12. Imagens                                                         */
/* ------------------------------------------------------------------ */

await runTest("12. Cada card usa a imagem do próprio exercício, sem emprestar", async () => {
  const app = await abrir("academia", "ombros");
  const grupos = app.F.grupo.anatomia && ["ombros", "trapezio"];
  const entradas = app.F.biblioteca.entries().filter(entry =>
    grupos.includes(entry.muscleId) && entry.modalityId === "academia");

  const arquivos = [];
  cards(app).forEach(card => {
    const id = card.getAttribute("data-exercise-id");
    const entrada = entradas.find(item => item.id === id);
    const img = card.querySelector("img");

    if (entrada.image && entrada.image.url) {
      assert.ok(img, "Imagem aprovada não apareceu no card de " + entrada.name);
      assert.equal(img.getAttribute("src"), entrada.image.url, "Imagem trocada no card");
      arquivos.push(img.getAttribute("src"));
    } else {
      assert.equal(img, null, "Exercício sem imagem recebeu uma foto emprestada");
      assert.ok(card.querySelector(".gr-card-vazio"), "Faltou o estado sem imagem");
      assert.match(chave(card.querySelector(".gr-card-vazio-texto").textContent), /imagem em revisao/);
    }
  });

  assert.equal(new Set(arquivos).size, arquivos.length,
    "Dois exercícios diferentes usaram o mesmo arquivo de imagem");

  assertNoErrors(app, "imagens dos cards");
});

/* ------------------------------------------------------------------ */
/* 13–15. Ficha, vídeo e atlas                                         */
/* ------------------------------------------------------------------ */

await runTest("13. O card abre a ficha existente, sem segunda tela de detalhe", async () => {
  const app = await abrir("academia", "peitoral");
  const primeiro = cards(app)[0];
  const nome = primeiro.querySelector(".gr-card-nome").textContent.trim();

  app.click(primeiro);
  await wait(120);

  assert.ok(app.$(".modal-backdrop"), "A ficha não abriu");
  assert.equal(app.text("#modal-title"), nome, "A ficha abriu em outro exercício");
  assert.ok(app.$("#detail-add-to-training"), "A ficha perdeu o “Adicionar ao treino”");
  app.modalAction("cancel");
  await wait(40);

  assertNoErrors(app, "ficha do exercício");
});

await runTest("14. O vídeo exibido é o do próprio exercício", async () => {
  const app = await abrir("academia", "peitoral");
  const registro = app.F.exerciseCatalog.exercises.find(item => item.primaryMuscle === "peitoral" && item.modality === "academia");
  const legado = app.F.exerciseCatalog.toLegacyExercise(registro);

  app.F.catalog.showDetail(legado);
  await wait(80);

  const bloco = app.$('[data-detail-section="video"]');
  assert.ok(bloco, "A ficha perdeu o bloco de demonstração");
  const texto = chave(bloco.textContent);
  assert.ok(/video|demonstracao/.test(texto), "O bloco de vídeo não se identifica");
  /* Sem vídeo aprovado, a mensagem é a oficial — nunca um player de outro exercício. */
  if (app.$(".bl-video-stage iframe, .bl-video-stage video")) {
    assert.ok(app.F.videos && typeof app.F.videos.render === "function");
  } else {
    assert.match(texto, /ainda nao disponivel|nao disponivel/, "Mensagem de vídeo ausente");
  }
  app.modalAction("cancel");
  await wait(40);

  assertNoErrors(app, "vídeo do exercício");
});

await runTest("15. O atlas da ficha mostra os músculos reais do exercício", async () => {
  const app = await abrir("academia", "costas");
  const registro = app.F.exerciseCatalog.exercises.find(item => item.primaryMuscle === "costas" && item.modality === "academia");

  app.F.catalog.showDetail(app.F.exerciseCatalog.toLegacyExercise(registro));
  await wait(100);

  const atlas = app.$('[data-detail-section="atlas"]');
  assert.ok(atlas, "A ficha perdeu o atlas anatômico");
  assert.ok(atlas.querySelector(".figura, svg"), "O atlas ficou sem figura");

  /* O destaque é o músculo principal daquele exercício (dorsais, no caso). */
  const destacados = Array.from(atlas.querySelectorAll('[data-role="primary"]'))
    .map(no => no.getAttribute("data-region"));
  const dorsais = ["dorsais", "costas", "lombar"];
  assert.ok(destacados.length > 0, "O atlas não destacou nenhum músculo principal");
  destacados.forEach(id => assert.ok(dorsais.includes(id),
    "O atlas destacou “" + id + "” em um exercício de costas"));

  /* Um exercício de outro grupo destaca outra região — o atlas não é genérico. */
  const peitoral = app.F.exerciseCatalog.exercises.find(item =>
    item.primaryMuscle === "peitoral" && item.modality === "academia");
  app.modalAction("cancel");
  await wait(40);
  app.F.catalog.showDetail(app.F.exerciseCatalog.toLegacyExercise(peitoral));
  await wait(100);
  const outro = app.$('[data-detail-section="atlas"]');
  const outroDestaque = Array.from(outro.querySelectorAll('[data-role="primary"]')).map(no => no.getAttribute("data-region"));
  assert.ok(outroDestaque.length > 0);
  outroDestaque.forEach(id => assert.ok(["peito"].includes(id), "Atlas trocado: " + id));

  app.modalAction("cancel");
  await wait(40);
  assertNoErrors(app, "atlas do exercício");
});

/* ------------------------------------------------------------------ */
/* 16. Adicionar ao treino                                             */
/* ------------------------------------------------------------------ */

await runTest("16. “Adicionar ao treino” grava na rotina e preserva a origem", async () => {
  const rotina = makeRoutine("calisthenics", "Rotina G", [
    { id: "m1", name: "Flexão existente", section: "main", sets: 2, reps: "10", rest: 10 }
  ], "rg");

  const app = await boot(
    Object.assign({ "forja-treino-rotinas-v1": routinesStore([rotina], []) }, PERFIL),
    url("peso-corporal", "peitoral")
  );
  await wait(220);

  const card = cards(app).find(node => chave(node.textContent).includes("flexao de braco")) || cards(app)[0];
  const nome = card.querySelector(".gr-card-nome").textContent.trim();
  app.click(card);
  await wait(120);

  app.click("#detail-add-to-training");
  await wait(80);
  app.modalField("section").value = "abs";
  app.modalAction("add");
  await wait(100);

  const salva = app.data("forja-treino-rotinas-v1").calisthenics[0];
  assert.equal(salva.sections.abs.length, 1, "O exercício não entrou na seção escolhida");
  assert.equal(salva.sections.abs[0].name, nome);
  assert.ok(salva.sections.abs[0].libraryId, "A origem no catálogo não foi preservada");
  assert.equal(salva.sections.main.length, 1, "A rotina original foi duplicada");

  assertNoErrors(app, "adicionar ao treino");
});

/* ------------------------------------------------------------------ */
/* 17. Voltar e estado                                                 */
/* ------------------------------------------------------------------ */

await runTest("17. Voltar leva à Biblioteca com modalidade e região preservadas", async () => {
  const app = await abrir("academia", "bracos", "triceps");
  const voltar = app.$("#grupo-voltar");
  assert.ok(voltar, "A tela perdeu o botão de voltar");
  assert.match(voltar.getAttribute("href"), /biblioteca\.html\?/);
  assert.match(voltar.getAttribute("href"), /modalidade=academia/);
  assert.match(voltar.getAttribute("href"), /regiao=bracos/);

  app.click(voltar);
  await wait(260);

  assert.equal(app.d.body.dataset.page, "biblioteca", "Voltar não abriu a Biblioteca");
  assert.equal(app.$$(".grupo-card").length, 7);
  assert.equal(app.$('.grupo-card[data-categoria="bracos"]').classList.contains("is-atual"), true,
    "A região de origem não ficou marcada");
  assert.equal(app.$('.modalidade-opcao[data-value="academia"]').getAttribute("aria-pressed"), "true",
    "A modalidade não voltou selecionada");

  assertNoErrors(app, "voltar para a biblioteca");
});

/* ------------------------------------------------------------------ */
/* 18. Barra inferior                                                  */
/* ------------------------------------------------------------------ */

await runTest("18. Barra inferior com cinco itens e Explorar ativa", async () => {
  const app = await abrir("academia", "pernas");

  const links = app.$$(".bottom-nav-link");
  assert.equal(links.length, 5, "A barra inferior deve ter cinco itens");
  assert.equal(app.$$(".bottom-nav-link[aria-current=page]").length, 1);
  assert.match(chave(app.$$(".bottom-nav-link[aria-current=page]")[0].textContent), /explorar/);

  /* O último card não pode ficar escondido atrás da barra. */
  const css = fs.readFileSync(path.join(repoRoot, "assets/css/grupo.css"), "utf8");
  assert.match(css, /\.gr-main\s*\{[^}]*padding-bottom:\s*\d+px/s,
    "Falta o respiro para a barra inferior");
  assert.match(css, /body\[data-page="grupo"\]/, "A folha nova precisa ser escopada");

  assertNoErrors(app, "barra inferior");
});

/* ------------------------------------------------------------------ */
/* 19. Artefato publicado                                              */
/* ------------------------------------------------------------------ */

await runTest("19. O artefato do Pages leva a tela do grupo e não tem link quebrado", async () => {
  /*
    O workflow de publicação monta o site com tools/preparar-site.sh, que
    recusa link relativo apontando para arquivo fora do artefato. Uma tela nova
    com caminho escrito à mão derrubou o deploy uma vez; este teste roda o mesmo
    script e falha antes do push.
  */
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), "forja-site-"));
  execFileSync("bash", [path.join(repoRoot, "tools/preparar-site.sh"), destino], { stdio: "pipe" });

  ["treino/grupo.html", "assets/js/forja-grupo.js", "assets/css/grupo.css"].forEach(rel => {
    assert.ok(fs.existsSync(path.join(destino, rel)), "O artefato publicado ficou sem " + rel);
  });

  /* A tela nova não pode carregar nada de fora do artefato. */
  const html = fs.readFileSync(path.join(destino, "treino/grupo.html"), "utf8");
  assert.equal(/3d|three|personagens-3d/i.test(html), false, "A tela do grupo carrega resíduo 3D");

  fs.rmSync(destino, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */

const falhas = results.filter(item => !item.ok);
console.log("");
console.log("GRUPO MUSCULAR — " + (results.length - falhas.length) + "/" + results.length + " testes aprovados");
if (falhas.length) {
  console.log("Falhas: " + falhas.map(item => item.name).join(" | "));
  process.exitCode = 1;
}
