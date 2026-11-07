/*
  FORJA — Biblioteca como "Explorar" e detalhe do exercício (Etapa 5)

  Cobre, em jsdom com as páginas reais do repositório:

   1. "Explorar" abre a Biblioteca (rota, barra inferior, sem tela intermediária)
   2. busca por nome e por nome alternativo, atualizando durante a digitação
   3. filtro de modalidade (três, sem "Todas", "Sem equipamentos" puro)
   4. filtro de grupo muscular (os 13)
   5. filtros combinados, filtros ativos, remoção individual e "Limpar tudo"
   6. cada foto pertence ao identificador certo (e nenhuma foto é compartilhada)
   7. exercício sem foto aprovada não ganha foto de outro movimento
   8. o vídeo exibido é o do próprio exercício
   9. sem vídeo, a mensagem exata aparece e a foto continua lá
  10. "Adicionar ao treino" usa o fluxo de rotina existente e preserva o ID
  11. o Atlas do detalhe mostra os músculos reais do exercício
  12. papéis musculares (principal, secundário, estabilizador) com legenda
  13. não regressão: editor, execução (somente leitura), hub e página do Atlas
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { boot, closeAllApps, wait, repoRoot, assertNoErrors, makeRoutine, routinesStore } from "./helpers/harness.mjs";

const results = [];
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    results.push(name);
    console.log("✅ " + name);
  } catch (error) {
    failed += 1;
    console.error("❌ " + name + "\n", error);
    process.exitCode = 1;
  } finally {
    closeAllApps();
  }
}

async function until(predicate, label, ms = 4000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const value = predicate();
    if (value) return value;
    await wait(20);
  }
  assert.fail("Condição não atingida: " + label);
}

const rows = app => app.$$("#catalog-list .ui-exercise-row");

function search(app, value) {
  const input = app.$("#catalog-search");
  assert.ok(input, "campo de busca ausente");
  input.value = value;
  input.dispatchEvent(new app.w.Event("input", { bubbles: true }));
}

const chip = (app, group, value) =>
  app.$('#catalog-controls [data-filter-group="' + group + '"] [data-value="' + value + '"]');

const UNIFIED_VIDEO_MESSAGE = "Demonstração em vídeo ainda não disponível para este exercício.";

const approvedFixture = {
  exerciseId: "cal-flexao",
  videoId: "abc123def45",
  youtubeUrl: "https://www.youtube.com/watch?v=abc123def45",
  title: "Flexão — demonstração de teste",
  channelTitle: "Canal de teste",
  durationSeconds: 45,
  visibility: "public",
  embeddable: true,
  orientation: "horizontal",
  aspectRatio: "16:9",
  status: "validated",
  reviewedAt: "2026-11-06T18:00:00.000Z",
  updatedAt: "2026-11-06T18:00:00.000Z"
};
const emptyReport = {
  total: 165, approved: 0, pending: 165, review: 0, rejected: 0, unavailable: 0,
  coveragePercent: 0, withoutVideo: [], inconsistencies: []
};

function stubApproved(app, associations) {
  app.w.fetch = async () => new Response(
    JSON.stringify({ associations, report: Object.assign({}, emptyReport, { approved: associations.length }) }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

/* ------------------------------------------------------------------ */
/* 1. Explorar abre a Biblioteca                                       */
/* ------------------------------------------------------------------ */

await test("B1. A aba Explorar abre a Biblioteca, sem tela intermediária", async () => {
  const home = await boot({}, "index.html");
  const link = home.$('.bottom-nav-link[data-nav="explorar"]');
  assert.ok(link, "barra inferior sem a aba Explorar");
  assert.equal(
    new URL(link.getAttribute("href"), home.w.location.href).pathname,
    "/forja/treino/biblioteca.html",
    "a aba Explorar aponta para outro lugar"
  );

  home.click(link);
  await until(() => home.d.body.dataset.page === "biblioteca", "biblioteca aberta pela barra");
  assert.equal(home.F.ROUTES.explorar, "treino/biblioteca.html");
  assert.equal(new URL(home.F.url("explorar"), home.w.location.href).pathname, "/forja/treino/biblioteca.html");
  assert.match(home.text("#catalog-heading"), /Biblioteca de exercícios/);
  /* A própria biblioteca é a página ativa da aba Explorar. */
  assert.equal(home.$('.bottom-nav-link[aria-current="page"]').getAttribute("data-nav"), "explorar");

  /* Nenhuma página manda "Explorar" para o hub antigo. */
  const pages = ["index.html", "treino/index.html", "progresso/index.html", "perfil/index.html"];
  for (const page of pages) {
    const app = await boot({}, page);
    const href = app.$('.bottom-nav-link[data-nav="explorar"]').getAttribute("href");
    assert.equal(
      new URL(href, app.w.location.href).pathname,
      "/forja/treino/biblioteca.html",
      "aba Explorar aponta para outro lugar em " + page
    );
    app.close();
  }
});

/* ------------------------------------------------------------------ */
/* 2. Busca                                                            */
/* ------------------------------------------------------------------ */

await test("B2. Busca por nome e por nome alternativo filtra enquanto digita", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  assert.equal(app.$("#catalog-search").getAttribute("placeholder"), "Buscar exercício pelo nome…");

  const before = rows(app).length;
  assert.ok(before > 0, "lista não renderizou");
  assert.match(app.text("#catalog-status"), /^165 exercícios no catálogo$/);

  /* Sem acento, minúsculas: a busca normaliza os dois lados. */
  search(app, "flexao");
  await wait(30);
  const names = rows(app).map(row => row.querySelector(".ui-exercise-name").textContent);
  assert.ok(names.includes("Flexão de braço"), "busca por 'flexao' não achou Flexão de braço: " + names.join(" | "));
  /* A lista é progressiva (12 por vez), então o total vem do contador. */
  const flexaoTotal = Number((app.text("#catalog-status") || "").split(" ")[0]);
  assert.ok(flexaoTotal > 0 && flexaoTotal < 165, "a busca não reduziu o catálogo: " + flexaoTotal);

  /* Nome alternativo do catálogo. */
  const withAlias = app.F.exerciseCatalog.exercises.find(record => record.aliases.length > 0);
  assert.ok(withAlias, "catálogo sem aliases");
  const alias = withAlias.aliases[0];
  search(app, alias);
  await wait(30);
  assert.ok(
    rows(app).some(row => row.querySelector(".ui-exercise-name").textContent === withAlias.name),
    "busca pelo alias '" + alias + "' não encontrou " + withAlias.name
  );

  /* Sem resultado: estado vazio com o texto do catálogo. */
  search(app, "zzzz-nao-existe");
  await wait(30);
  assert.equal(rows(app).length, 0);
  assert.match(app.text("#catalog-status"), /Nenhum exercício com esses critérios/);
  assert.match(app.text("#catalog-list"), /Nenhum exercício com esses critérios/);

  /* Limpar a busca devolve a lista inteira. */
  search(app, "");
  await wait(30);
  assert.equal(rows(app).length, before);
  assert.match(app.text("#catalog-status"), /^165 exercícios no catálogo$/);
  assertNoErrors(app, "busca da biblioteca");
});

/* ------------------------------------------------------------------ */
/* 3. Modalidade                                                       */
/* ------------------------------------------------------------------ */

await test("B3. Três modalidades, sem 'Todas', e 'Sem equipamentos' só com corpo e chão", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const group = app.$('#catalog-controls [data-filter-group="modality"]');
  const labels = Array.from(group.querySelectorAll("[data-value]")).map(node => node.textContent.trim());
  assert.deepEqual(labels, ["Musculação", "Calistenia", "Sem equipamentos"]);
  assert.equal(group.querySelector('[data-value=""]'), null, "não deve existir chip 'Todas'");

  /* Nenhum exercício se mistura entre modalidades. */
  for (const [value, expected] of [["academia", "academia"], ["calistenia", "calistenia"], ["peso-corporal", "peso-corporal"]]) {
    chip(app, "modality", value).click();
    await wait(30);
    const cards = rows(app);
    assert.ok(cards.length > 0, "modalidade " + value + " sem resultados");
    cards.forEach(card => assert.equal(card.getAttribute("data-modality"), expected));
    /* O contador visível é o do catálogo central para a mesma modalidade. */
    const total = app.F.exerciseCatalog.filter({ modality: value }).length;
    assert.match(app.text("#catalog-status"), new RegExp("^" + total + " exercícios"));
    chip(app, "modality", value).click();
    await wait(30);
  }

  /* "Sem equipamentos" não aceita máquina, barra, haltere nem acessório. */
  chip(app, "modality", "peso-corporal").click();
  await wait(30);
  app.F.exerciseCatalog.filter({ modality: "peso-corporal" }).forEach(record => {
    assert.equal(record.equipment.length, 0, record.id + " tem equipamento em Sem equipamentos");
  });
  rows(app).forEach(card => {
    assert.equal(card.querySelector(".ui-exercise-meta").textContent.includes("Sem equipamentos"), true);
  });
  assertNoErrors(app, "filtro de modalidade");
});

/* ------------------------------------------------------------------ */
/* 4. Grupo muscular                                                   */
/* ------------------------------------------------------------------ */

await test("B4. Os 13 grupos musculares filtram pelo músculo principal", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const group = app.$('#catalog-controls [data-filter-group="muscle"]');
  const values = Array.from(group.querySelectorAll("[data-value]")).map(node => node.getAttribute("data-value"));
  assert.deepEqual(values, Array.from(app.F.exerciseCatalog.muscleGroups, item => item.id));
  assert.equal(values.length, 13);

  chip(app, "muscle", "peitoral").click();
  await wait(30);
  const cards = rows(app);
  assert.ok(cards.length > 0);
  cards.forEach(card => assert.equal(card.getAttribute("data-muscle"), "peitoral"));
  const expected = app.F.exerciseCatalog.filter({ primaryMuscle: "peitoral" }).length;
  assert.match(app.text("#catalog-status"), new RegExp("^" + expected + " exercícios"));

  /* Tocar de novo no chip ativo remove o filtro. */
  chip(app, "muscle", "peitoral").click();
  await wait(30);
  assert.match(app.text("#catalog-status"), /no catálogo$/);
  assertNoErrors(app, "filtro de grupo muscular");
});

/* ------------------------------------------------------------------ */
/* 5. Combinação, filtros ativos e limpeza                             */
/* ------------------------------------------------------------------ */

await test("B5. Modalidade + grupo + ranking combinam, aparecem como filtros ativos e somem", async () => {
  const app = await boot({}, "treino/biblioteca.html");

  assert.equal(app.$("#bl-active-filters").hasAttribute("hidden"), true, "filtros ativos começaram visíveis");

  chip(app, "modality", "peso-corporal").click();
  await wait(30);
  chip(app, "muscle", "peitoral").click();
  await wait(30);

  assert.match(app.text("#catalog-status"), /com os filtros atuais$/);
  const active = app.$("#bl-active-filters");
  assert.equal(active.hasAttribute("hidden"), false);
  assert.ok(active.querySelector('[data-active-filter="modality"]'), "modalidade não aparece nos filtros ativos");
  assert.ok(active.querySelector('[data-active-filter="muscle"]'), "grupo não aparece nos filtros ativos");
  assert.ok(active.querySelector("[data-clear-filters]"), "faltou o 'Limpar tudo'");

  /* O ranking só existe dentro da combinação. */
  const ranking = app.$('#catalog-controls [data-filter-group="ranking"]');
  assert.ok(ranking, "filtro de classificação ausente com grupo + modalidade");
  chip(app, "ranking", "1").click();
  await wait(30);
  const cards = rows(app);
  assert.ok(cards.length > 0);
  cards.forEach(card => assert.equal(card.getAttribute("data-ranking-position"), "1"));
  assert.ok(app.$('#bl-active-filters [data-active-filter="ranking"]'));

  /* Remover um filtro pelo chip mantém os outros. */
  app.$('#bl-active-filters [data-active-filter="ranking"]').click();
  await wait(30);
  assert.equal(app.$('#bl-active-filters [data-active-filter="ranking"]'), null);
  assert.match(app.text("#catalog-status"), /com os filtros atuais$/);
  assert.ok(app.$('#bl-active-filters [data-active-filter="modality"]'));

  /* Limpar tudo volta ao catálogo inteiro. */
  app.$("#bl-active-filters [data-clear-filters]").click();
  await wait(30);
  assert.match(app.text("#catalog-status"), /^165 exercícios no catálogo$/);
  assert.equal(app.$("#bl-active-filters").hasAttribute("hidden"), true);

  /* Busca também entra nos filtros ativos e é removível. */
  search(app, "flexao");
  await wait(30);
  const queryChip = app.$('#bl-active-filters [data-active-filter="query"]');
  assert.ok(queryChip, "busca não aparece nos filtros ativos");
  queryChip.click();
  await wait(30);
  assert.equal(app.$("#catalog-search").value, "");
  assertNoErrors(app, "filtros combinados");
});

/* ------------------------------------------------------------------ */
/* 6. Foto ↔ identificador                                             */
/* ------------------------------------------------------------------ */

await test("B6. Cada card usa a foto do próprio exercício, sem compartilhar arquivo", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const entries = app.F.biblioteca.entries();
  const central = app.F.exerciseCatalog;

  const used = new Map();
  let withImage = 0;

  entries.forEach(entry => {
    if (!entry.image) return;
    withImage += 1;
    const record = central.byId(entry.id);
    assert.ok(record, "entrada sem registro central: " + entry.id);
    assert.equal(entry.image.src, record.media.image.src, "foto trocada no exercício " + entry.id);
    assert.equal(entry.image.status, "validated", "card exibindo imagem não aprovada: " + entry.id);
    assert.ok(!used.has(entry.image.src), "arquivo repetido: " + entry.image.src);
    used.set(entry.image.src, entry.id);
  });

  /* Todas as imagens aprovadas do catálogo entram na lista, uma vez cada. */
  const validated = central.exercises.filter(record => record.media && record.media.image &&
    record.media.image.src && record.media.image.status === "validated");
  assert.equal(withImage, validated.length, "quantidade de fotos aprovadas mudou");

  /* No DOM, o src de cada card corresponde ao seu data-exercise-id. */
  const shown = rows(app).filter(card => card.querySelector(".bl-card-image"));
  assert.ok(shown.length > 0, "nenhum card renderizou foto");
  shown.forEach(card => {
    const id = card.getAttribute("data-exercise-id");
    const src = card.querySelector(".bl-card-image").getAttribute("src");
    const record = central.byId(id);
    assert.ok(src.endsWith(record.media.image.src), "src do card " + id + " não é o do exercício: " + src);
    assert.ok((card.querySelector(".bl-card-image").getAttribute("alt") || "").length > 10);
  });
  assertNoErrors(app, "fotos dos cards");
});

/* ------------------------------------------------------------------ */
/* 7. Sem associação falsa                                             */
/* ------------------------------------------------------------------ */

await test("B7. Sem foto aprovada não há foto emprestada; associação pendente é sinalizada", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const central = app.F.exerciseCatalog;

  const withoutImage = central.exercises.find(record => !(record.media && record.media.image && record.media.image.src));
  assert.ok(withoutImage, "o catálogo não tem exercício sem imagem para testar");

  search(app, withoutImage.name);
  await wait(30);
  const card = rows(app).find(node => node.getAttribute("data-exercise-id") === withoutImage.id);
  assert.ok(card, "card do exercício sem imagem não encontrado");
  assert.equal(card.getAttribute("data-has-image"), "false");
  assert.equal(card.querySelector(".bl-card-image"), null, "exercício sem imagem ganhou <img>");
  assert.match(card.querySelector(".bl-card-fallback-label").textContent, /Imagem ainda não disponível/);
  search(app, "");

  /* Associação existente mas ainda em revisão: sem foto, com aviso. */
  const pending = central.exercises.find(record => record.media && record.media.image &&
    record.media.image.src && record.media.image.status === "pending");
  assert.ok(pending, "o catálogo não tem imagem pendente para testar");
  search(app, pending.name);
  await wait(30);
  const pendingCard = rows(app).find(node => node.getAttribute("data-exercise-id") === pending.id);
  assert.ok(pendingCard, "card da imagem pendente não encontrado");
  assert.equal(pendingCard.querySelector(".bl-card-image"), null, "imagem pendente exibida como definitiva");
  assert.equal(pendingCard.querySelector(".bl-card-media").getAttribute("data-image"), "review");
  assert.match(pendingCard.querySelector(".bl-card-fallback-label").textContent, /Imagem em revisão/);

  /* No detalhe, a mesma imagem aparece com a ressalva escrita. */
  app.F.catalog.showDetail(app.F.catalog.items().find(item => item.id === pending.id));
  await wait(40);
  assert.equal(app.$(".bl-detail-photo").getAttribute("data-photo"), "ok");
  assert.match(app.text(".bl-detail-photo-caption"), /revisão editorial/i);
  app.modalAction("cancel");
  await wait(20);

  /* Exercício personalizado não herda foto do catálogo. */
  const custom = await boot({
    "forja-treino-biblioteca-v1": {
      calisthenics: [{
        id: "custom-1", name: "Exercício inventado", category: "core",
        sets: 3, reps: "10", rest: 30, muscles: ["abdômen"], equipment: ["peso corporal"]
      }],
      weights: []
    }
  }, "treino/biblioteca.html");
  custom.$('#catalog-controls [data-filter-group="source"] [data-value="personalizado"]').click();
  await wait(30);
  const customCard = rows(custom).find(node => node.getAttribute("data-origin") === "pessoal");
  assert.ok(customCard, "exercício personalizado não apareceu na lista");
  assert.equal(customCard.querySelector(".bl-card-image"), null, "personalizado ganhou foto do catálogo");
  assert.match(customCard.textContent, /Seu exercício/);
  assertNoErrors(app, "imagens ausentes");
  assertNoErrors(custom, "exercício personalizado");
});

/* ------------------------------------------------------------------ */
/* 8. Vídeo do próprio exercício                                       */
/* ------------------------------------------------------------------ */

await test("B8. O vídeo aprovado aparece só no exercício a que pertence", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  stubApproved(app, [approvedFixture]);

  app.F.catalog.showDetail(app.F.catalog.items("calisthenics").find(item => item.id === "cal-flexao"));
  await until(() => app.$(".youtube-player"), "player do exercício com associação aprovada");
  const iframe = app.$(".youtube-player");
  assert.equal(new URL(iframe.src).hostname, "www.youtube-nocookie.com");
  assert.match(iframe.src, /abc123def45/);
  assert.equal(iframe.getAttribute("src").includes("autoplay=0"), true);
  assert.equal(iframe.getAttribute("src").includes("mute=1"), true);
  app.modalAction("cancel");
  await wait(40);

  /* Outro exercício não recebe o vídeo de cal-flexao. */
  app.F.catalog.showDetail(app.F.catalog.items("calisthenics").find(item => item.id === "cal-polichinelo"));
  await wait(60);
  const other = app.$(".youtube-player");
  assert.ok(!other || !/abc123def45/.test(other.getAttribute("src") || ""),
    "vídeo de um exercício apareceu em outro");
  assertNoErrors(app, "vídeo próprio");
});

/* ------------------------------------------------------------------ */
/* 9. Estado sem vídeo                                                 */
/* ------------------------------------------------------------------ */

await test("B9. Sem vídeo: mensagem exata e a foto do exercício continua visível", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  stubApproved(app, []);

  /* Um exercício cujo vídeo oficial realmente não existe no catálogo. */
  const record = app.F.catalog.items().find(item => !app.F.videos.resolve(item, item.mode));
  assert.ok(record, "nenhum exercício sem vídeo para testar");
  app.F.catalog.showDetail(record);
  await wait(60);

  const stage = app.$(".modal-details .video-demo");
  assert.ok(stage, "bloco de demonstração ausente");
  assert.equal(app.$(".modal-details .video-demo-iframe"), null);
  assert.equal(app.text(".modal-details .video-demo-unavailable"), UNIFIED_VIDEO_MESSAGE);

  /* A foto fica na identificação, não é engolida pelo aviso de vídeo. */
  const photo = app.$('.modal-details [data-detail-section="identificacao"] .bl-detail-photo');
  assert.ok(photo, "foto do exercício não está na identificação");
  assert.equal(photo.getAttribute("data-photo"), "ok");
  assert.ok(photo.querySelector("img"), "foto sumiu quando o vídeo não estava disponível");
  assert.equal(app.$$('.modal-details [data-detail-section="video"] .demo-media').length, 0,
    "a foto foi repetida dentro do bloco de vídeo");
  app.modalAction("cancel");
  assertNoErrors(app, "estado sem vídeo");
});

/* ------------------------------------------------------------------ */
/* 10. Adicionar ao treino                                             */
/* ------------------------------------------------------------------ */

await test("B10. 'Adicionar ao treino' reaproveita o fluxo de rotina e preserva a origem", async () => {
  const routine = makeRoutine("calisthenics", "Rotina D", [
    { id: "m1", name: "Flexão existente", section: "main", sets: 2, reps: "10", rest: 10 }
  ], "rd");

  const app = await boot({ "forja-treino-rotinas-v1": routinesStore([routine], []) }, "treino/biblioteca.html");
  search(app, "Agachamento livre");
  await wait(30);
  const card = rows(app)[0];
  assert.ok(card, "card não encontrado");
  card.querySelector('.ui-exercise-actions button[aria-label^="Ver detalhes"]').click();
  await wait(40);

  const cta = app.$("#detail-add-to-training");
  assert.ok(cta, "detalhe sem botão de adicionar ao treino");
  cta.click();
  await wait(40);

  assert.match(app.text("#modal-title"), /Adicionar Agachamento livre/);
  assert.equal(app.modalField("routine").value, "rd");
  app.modalField("section").value = "abs";
  app.modalAction("add");
  await wait(60);

  const saved = app.data("forja-treino-rotinas-v1").calisthenics[0];
  assert.equal(saved.sections.abs.length, 1, "exercício não entrou na seção escolhida");
  const added = saved.sections.abs[0];
  assert.equal(added.name, "Agachamento livre");
  assert.equal(added.libraryId, "cal-agachamento", "a origem no catálogo não foi preservada");
  assert.match(added.id, /^exercise-/, "o exercício copiado precisa de id novo");
  assert.equal(saved.sections.main.length, 1, "a rotina original não pode ser duplicada");
  assertNoErrors(app, "adicionar ao treino");
});

/* ------------------------------------------------------------------ */
/* 11. Atlas do detalhe                                                */
/* ------------------------------------------------------------------ */

await test("B11. O Atlas do detalhe mostra os músculos reais do exercício", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const record = app.F.catalog.items("calisthenics").find(item => item.id === "cal-flexao");

  app.F.catalog.showDetail(record);
  await wait(50);

  const atlas = app.$('.modal-details [data-detail-section="atlas"]');
  assert.ok(atlas, "detalhe sem seção de atlas");
  assert.match(atlas.querySelector(".bl-detail-heading").textContent, /Atlas anatômico/);
  assert.equal(atlas.querySelectorAll(".figura-svg").length, 2, "o atlas do detalhe precisa das duas vistas");

  const central = app.F.exerciseCatalog.byId("cal-flexao");
  const legend = Array.from(atlas.querySelectorAll(".atlas-legenda-item"))
    .map(item => ({ role: item.getAttribute("data-role"), region: item.getAttribute("data-region") }));
  assert.ok(legend.length > 0);

  /*
    Nenhum grupo inventado: cada região da legenda é um músculo do registro.
    A legenda do Atlas usa os nomes históricos ("peito", "tríceps"), que são a
    projeção dos mesmos IDs do catálogo central.
  */
  /*
    A legenda do Atlas é exatamente o que a figura destaca — e cada região
    destacada vem de um músculo do registro central (principal, secundário ou
    estabilizador). Nada é acrescentado por conta da tela.
  */
  const legacyRecord = app.F.catalog.items("calisthenics").find(item => item.id === "cal-flexao");
  const expectedRegions = Object.keys(app.F.atlas.highlightsFor(legacyRecord)).sort();
  assert.deepEqual(legend.map(item => item.region).sort(), expectedRegions);

  /* A legenda e a figura falam das mesmas regiões; nenhuma sobra. */
  const drawn = Array.from(atlas.querySelectorAll(".figura-region")).map(node => node.getAttribute("data-region"));
  legend.forEach(item => assert.ok(drawn.includes(item.region), "legenda sem região na figura: " + item.region));

  /* O músculo principal do catálogo aparece escrito na legenda. */
  const primaryName = app.F.exerciseCatalog.muscleName(central.primaryMuscle);
  assert.match(atlas.querySelector(".atlas-legenda").textContent, new RegExp(primaryName, "i"));

  /* O principal do catálogo está marcado como principal na figura. */
  const primaryRegions = Array.from(atlas.querySelectorAll('.figura-region[data-role="primary"]'));
  assert.ok(primaryRegions.length > 0, "figura sem músculo principal em destaque");
  app.modalAction("cancel");
  assertNoErrors(app, "atlas do detalhe");
});

/* ------------------------------------------------------------------ */
/* 12. Papéis musculares                                               */
/* ------------------------------------------------------------------ */

await test("B12. Principal, secundário e estabilizador têm cores e legenda escritas", async () => {
  const app = await boot({}, "treino/biblioteca.html");

  /* Exercício com os três papéis preenchidos no catálogo. */
  const record = app.F.exerciseCatalog.exercises.find(item =>
    item.secondaryMuscles.length > 0 && item.stabilizers.length > 0);
  assert.ok(record, "catálogo sem exercício com os três papéis");

  const legacy = app.F.catalog.items().find(item => item.id === record.id);
  app.F.catalog.showDetail(legacy);
  await wait(50);

  const keys = Array.from(app.$$(".bl-detail-atlas-key [data-atlas-role]")).map(node => node.getAttribute("data-atlas-role"));
  assert.deepEqual(keys, ["is-primary", "is-secondary", "is-stabilizer"]);
  app.$$(".bl-detail-atlas-key [data-atlas-role]").forEach(item => {
    assert.ok(item.textContent.trim().length > 8, "legenda de papel sem explicação escrita");
    assert.ok(item.querySelector(".bl-detail-atlas-dot"), "papel sem marcador visual");
  });

  /* Cores diferentes para papéis diferentes (mesma paleta do Atlas). */
  const css = fs.readFileSync(path.join(repoRoot, "assets/css/system.css"), "utf8");
  ["primary", "secondary", "stabilizer"].forEach(role => {
    assert.ok(css.includes(".bl-detail-atlas-key-item.is-" + role), "sem cor para o papel " + role);
  });
  assert.match(css, /\.bl-detail-atlas-key-item\.is-primary \.bl-detail-atlas-dot \{ background: #b7f34a/);
  assert.match(css, /\.bl-detail-atlas-key-item\.is-secondary \.bl-detail-atlas-dot \{ background: #f2b84b/);
  assert.match(css, /\.bl-detail-atlas-key-item\.is-stabilizer \.bl-detail-atlas-dot \{ background: #8cc0e0/);

  /* Um marcador por papel também na figura. */
  app.$$(".modal-figure .figura-region").forEach(region => {
    assert.ok(["primary", "secondary", "stabilizer", "informed"].includes(region.getAttribute("data-role")));
  });
  app.modalAction("cancel");
  assertNoErrors(app, "papéis musculares");
});

/* ------------------------------------------------------------------ */
/* 13. Não regressão                                                   */
/* ------------------------------------------------------------------ */

await test("B13. Editor, execução, hub antigo e página do Atlas continuam funcionando", async () => {
  /* O editor continua apontando para a mesma biblioteca. */
  const editor = await boot({}, "treino/rotina.html?modalidade=calisthenics");
  assert.equal(new URL(editor.F.url("biblioteca"), editor.w.location.href).pathname, "/forja/treino/biblioteca.html");
  assert.equal(editor.F.ROUTES.descobrir, "explorar/index.html");

  /* Detalhe somente leitura (execução/editor) não ganha botão nem atlas. */
  const app = await boot({}, "treino/biblioteca.html");
  app.F.catalog.showDetail(app.F.catalog.items("calisthenics")[0], { readOnly: true });
  await wait(40);
  assert.equal(app.$("#detail-add-to-training"), null, "detalhe somente leitura ganhou botão de adicionar");
  assert.equal(app.$('.modal-details [data-detail-section="atlas"]'), null, "detalhe somente leitura ganhou atlas");
  assert.ok(app.$('.modal-details [data-detail-section="video"]'), "detalhe somente leitura perdeu a demonstração");
  app.modalAction("cancel");
  await wait(20);

  /* Ordem do detalhe completo: identificação → vídeo → adicionar → atlas. */
  const full = await boot({}, "treino/biblioteca.html");
  full.F.catalog.showDetail(full.F.catalog.items("calisthenics")[0]);
  await wait(40);
  const order = Array.from(full.d.querySelectorAll(".modal-details > *"))
    .map(node => node.getAttribute("data-detail-section"))
    .filter(Boolean);
  assert.deepEqual(order, ["identificacao", "video", "adicionar", "atlas"]);
  full.modalAction("cancel");
  await wait(20);

  /* O hub de descoberta continua vivo como "descobrir". */
  const hub = await boot({}, "explorar/index.html");
  assert.equal(hub.d.body.dataset.page, "explorar");
  assert.ok(hub.$(".bottom-nav-link[data-nav='explorar']"));
  const toAtlas = hub.$('a[href*="atlas"]');
  assert.ok(toAtlas, "hub sem link para o atlas");

  /* A página do Atlas continua abrindo com a figura. */
  const atlas = await boot({}, "explorar/atlas.html");
  assert.ok(atlas.$(".figura-svg"), "página do atlas sem figura");
  assertNoErrors(hub, "hub de descoberta");
  assertNoErrors(atlas, "página do atlas");
});

console.log("\n" + "=".repeat(66));
if (failed === 0) {
  console.log("BIBLIOTECA E DETALHE — " + results.length + "/" + results.length + " testes aprovados");
} else {
  console.log("BIBLIOTECA E DETALHE — " + (results.length) + " aprovados, " + failed + " falharam");
}
console.log("=".repeat(66));
