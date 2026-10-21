/*
  Suíte de testes do FORJA (jsdom, multipágina).

  Executa as páginas reais do repositório (index.html, treino/, progresso/,
  configuracoes/) com o mesmo JavaScript que roda no navegador. Cada teste
  corresponde a um critério de aceite ou a um requisito de execução.

  Uso: npm install && npm test
*/

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  BASE,
  App,
  assertNoErrors,
  boot,
  closeAllApps,
  makeRoutine,
  repoRoot,
  routinesStore,
  todayKey,
  wait
} from "./helpers/harness.mjs";

const results = [];

const PAGES = [
  "index.html",
  "treino/index.html",
  "treino/calistenia.html",
  "treino/musculacao.html",
  "treino/rotina.html",
  "treino/executar.html",
  "treino/biblioteca.html",
  "progresso/index.html",
  "configuracoes/index.html"
];

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
    closeAllApps();
  }
}

/* Espera uma condição (polling curto). */
async function until(predicate, label, ms = 4000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const value = predicate();
    if (value) return value;
    await wait(20);
  }
  assert.fail("Condição não atingida: " + label);
}

async function pageIs(app, name) {
  return until(() => app.d.body.dataset.page === name, "página " + name);
}

/* Sessão de treino seed para testes (formato v2). */
function sessionSeed(routine, extra = {}) {
  const queue = [];
  ["warmup", "main", "abs", "finisher"].forEach(section => {
    routine.sections[section].forEach(exercise => queue.push(Object.assign({}, exercise, { section })));
  });
  const completedSets = {};
  queue.forEach(exercise => { completedSets[exercise.id] = 0; });
  return Object.assign({
    version: 2,
    id: "session-test",
    date: todayKey(),
    modality: routine.modality,
    routineId: routine.id,
    routineName: routine.name,
    startedAt: 1000,
    elapsedMs: 0,
    running: true,
    currentIndex: 0,
    completedSets,
    totalPlannedSets: queue.reduce((sum, exercise) => sum + exercise.sets, 0),
    queue,
    status: "active",
    restEndAt: null,
    restRemainingMs: 0,
    restPaused: false,
    pendingAdvance: false,
    restPlannedSeconds: 0,
    setTimer: null,
    setLogs: {},
    logDraft: {}
  }, extra);
}

function sampleRoutine(modality = "calisthenics", id = "r1") {
  return makeRoutine(modality, "Treino A", [
    { name: "Aquecimento leve", section: "warmup", type: "duration", sets: 1, duration: 60, rest: 0, id: "w1" },
    { name: "Flexão", section: "main", sets: 2, reps: "10", rest: 10, id: "m1" },
    { name: "Prancha", section: "abs", type: "duration", sets: 2, duration: 30, rest: 10, id: "a1" }
  ], id);
}

/* ------------------------------------------------------------------ */

await runTest("01. Calendário e missões funcionam na página inicial", async () => {
  const app = await boot({}, "index.html");
  assert.ok(app.$$(".day").length >= 28, "Calendário não renderizou os dias");

  const title = app.text("#month-title");
  app.click("#next-month");
  await wait(10);
  assert.notEqual(app.text("#month-title"), title, "Próximo mês não mudou o título");

  app.click("#prev-month");
  await wait(10);
  assert.equal(app.text("#month-title"), title, "Mês anterior não voltou");

  app.$("#task-input").value = "Treinar cedo";
  app.$("#task-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);

  const tasks = app.data("forja-missoes-" + todayKey(), []);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, "Treinar cedo");
  assert.match(app.text("#task-list"), /Treinar cedo/);
  assertNoErrors(app, "calendário");
});

await runTest("02. Dados antigos são preservados após a migração", async () => {
  const legacyExercises = {
    calisthenics: [{ id: "old-1", name: "Flexão antiga", sets: 3, reps: "8", rest: 60, section: "main" }],
    weights: [{ id: "old-2", name: "Supino antigo", sets: 4, reps: "10", rest: 90, load: "40 kg", section: "main" }]
  };
  const history = [{
    id: "h-old", date: "2025-01-02", modality: "calisthenics", routineName: "Treino antigo",
    durationMs: 600000, completedSets: 3, totalPlannedSets: 3, status: "completed",
    finishedAt: "2025-01-02T10:00:00.000Z", exercises: []
  }];
  const seed = {
    "forja-treino-exercicios-v1": legacyExercises,
    "forja-treino-historico-v1": history,
    "forja-missoes-2025-01-02": [{ id: "t1", text: "Missão antiga", done: false }]
  };
  const before = JSON.stringify(legacyExercises);

  const app = await boot(seed, "treino/calistenia.html");
  assert.equal(app.F.state.routines.calisthenics.length, 1, "Rotina legada não foi migrada");
  assert.equal(app.F.state.routines.weights.length, 1, "Rotina de musculação não foi migrada");
  assert.equal(app.F.state.routines.calisthenics[0].sections.main[0].name, "Flexão antiga");
  assert.equal(app.F.state.routines.weights[0].sections.main[0].load, "40 kg");

  assert.equal(app.raw("forja-treino-exercicios-v1"), before, "Chave legada foi alterada");
  assert.deepEqual(app.data("forja-treino-historico-v1"), history, "Histórico foi alterado");
  assert.deepEqual(app.data("forja-missoes-2025-01-02"), seed["forja-missoes-2025-01-02"]);
  assert.ok(app.raw("forja-treino-migracao-v1"), "Registro de migração ausente");
  assert.ok(app.data("forja-treino-rotinas-v1"), "Rotinas novas não foram gravadas");
  assertNoErrors(app, "migração");
  app.close();
});

await runTest("03. A migração não é repetida e não duplica rotinas", async () => {
  const seed = {
    "forja-treino-exercicios-v1": { calisthenics: [{ name: "Agachamento", sets: 3, reps: "10", section: "main" }], weights: [] }
  };
  const first = await boot(seed, "treino/index.html");
  const count = first.F.state.routines.calisthenics.length;
  const stored = first.raw("forja-treino-rotinas-v1");

  // Recarregar a página com o mesmo armazenamento não migra de novo.
  await first.reload();
  assert.equal(first.F.state.routines.calisthenics.length, count, "Recarga duplicou rotinas");
  assert.equal(first.raw("forja-treino-rotinas-v1"), stored, "Recarga reescreveu as rotinas");
  assert.equal(first.F.state.routines.calisthenics.length, 1);
  first.close();
});

await runTest("04. Todas as páginas carregam sem erros de JavaScript e sem recursos ausentes", async () => {
  for (const page of PAGES) {
    const app = await boot({}, page);
    assert.ok(app.d.body.dataset.page, "data-page ausente em " + page);
    assertNoErrors(app, page);

    const missing = [];
    app.$$("link[rel=stylesheet], script[src]").forEach(node => {
      const url = node.getAttribute("href") || node.getAttribute("src");
      const file = path.join(repoRoot, new URL(url, BASE + page).pathname.replace("/forja/", ""));
      if (!fs.existsSync(file)) missing.push(url);
    });
    assert.deepEqual(missing, [], "Recursos ausentes em " + page);

    assert.equal(app.$$("[aria-current=page]").length, 1, "Seção atual não indicada em " + page);
    app.close();
  }
});

await runTest("05. Links relativos resolvem dentro do caminho /forja/ (GitHub Pages)", async () => {
  for (const page of PAGES) {
    const app = await boot({}, page);
    const broken = [];

    app.$$("a[href]").forEach(anchor => {
      const raw = anchor.getAttribute("href");
      if (raw.startsWith("#")) return;
      assert.ok(!raw.startsWith("/"), "Link absoluto da raiz em " + page + ": " + raw);
      const url = new URL(raw, app.w.location.href);
      assert.ok(url.pathname.startsWith("/forja/"), "Link fora de /forja/ em " + page + ": " + raw);
      const file = path.join(repoRoot, url.pathname.replace("/forja/", "").replace(/\/$/, "/index.html"));
      if (!fs.existsSync(file)) broken.push(raw);
    });

    assert.deepEqual(broken, [], "Links quebrados em " + page);
    app.close();
  }
});

await runTest("06. TREINO abre o hub e o hub leva a CALISTENIA e MUSCULAÇÃO", async () => {
  const home = await boot({}, "index.html");
  // O botão agora tem ícone, título e subtítulo; o texto começa com TREINO.
  const treinoLink = home.$("a.treino-square");
  assert.ok(treinoLink, "Botão TREINO ausente na página inicial");
  assert.match(treinoLink.textContent.trim(), /^(TREINO|Abrir área de treino)\b/i);
  assert.equal(treinoLink.getAttribute("href"), "treino/index.html");

  home.click(treinoLink);
  await pageIs(home, "treino");
  assert.match(home.text("h1"), /TREINO/);
  assert.ok(home.$('a[href="calistenia.html"]'), "Hub sem CALISTENIA");
  assert.ok(home.$('a[href="musculacao.html"]'), "Hub sem MUSCULAÇÃO");

  home.click("#mode-calisthenics");
  await pageIs(home, "calistenia");
  assert.equal(home.text("#modality-title"), "CALISTENIA");

  home.click(home.$(".back-link"));
  await pageIs(home, "treino");
  home.click("#mode-weights");
  await pageIs(home, "musculacao");
  assert.equal(home.text("#modality-title"), "MUSCULAÇÃO");
  assertNoErrors(home, "hub");
});

await runTest("07. Rotinas de calistenia e musculação permanecem separadas", async () => {
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([sampleRoutine("calisthenics", "cal-1")], [])
  }, "treino/musculacao.html");

  assert.equal(app.$$(".routine-card").length, 0, "Calistenia apareceu na musculação");
  app.click("#new-routine");
  await wait(15);
  await app.modal("create", { name: "Peito" });
  await pageIs(app, "rotina");

  const stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics.length, 1, "Calistenia foi alterada");
  assert.equal(stored.weights.length, 1, "Musculação não recebeu a rotina");
  assert.equal(stored.weights[0].name, "Peito");
  assert.equal(stored.weights[0].modality, "weights");
  app.close();
});

await runTest("08. Criar, editar e iniciar uma rotina", async () => {
  const app = await boot({}, "treino/calistenia.html");
  app.click("#new-routine");
  await wait(15);
  await app.modal("create", { name: "Dia 1" });
  await pageIs(app, "rotina");

  assert.equal(app.text("#editor-title"), "Dia 1");
  app.$("#exercise-section").value = "main";
  app.$("#exercise-name").value = "Flexão";
  app.$("#exercise-sets").value = "3";
  app.$("#exercise-reps").value = "12";
  app.$("#exercise-rest").value = "45";
  app.$("#exercise-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(15);
  app.$("#routine-name-input").value = "Dia 1 editado";
  app.$("#routine-name-input").dispatchEvent(new app.w.Event("input", { bubbles: true }));
  app.click("#save-routine-top");
  await wait(20);

  let stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics[0].name, "Dia 1 editado");
  assert.equal(stored.calisthenics[0].sections.main.length, 1);

  app.click(".back-link");
  await pageIs(app, "calistenia");
  assert.match(app.text(".routine-card .routine-name"), /Dia 1 editado/);

  app.click(".routine-card .routine-start");
  await pageIs(app, "executar");
  const session = app.F.state.activeWorkout;
  assert.ok(session, "Sessão não foi criada");
  assert.equal(session.routineName, "Dia 1 editado");
  assert.equal(session.modality, "calisthenics");
  assert.equal(app.$("#execution-live").hidden, false);
  assert.equal(app.text("#current-name"), "Flexão");
  app.close();
});

await runTest("09. Cronômetro de exercício por duração usa timestamps", async () => {
  const routine = sampleRoutine("calisthenics", "dur");
  routine.sections.warmup = [];
  routine.sections.abs = [];
  routine.sections.main = [{ id: "d1", name: "Prancha", sets: 2, type: "duration", reps: "", duration: 30, rest: 10, load: "", notes: "", section: "main" }];

  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-dur" })
  }, "treino/executar.html", { now: 1_000_000 });

  assert.equal(app.$("#timer-panel").hidden, false, "Cronômetro da série não apareceu");
  app.click("#set-timer-start");
  await wait(10);
  const timerStart = app.F.state.activeWorkout.setTimer;
  assert.ok(timerStart && timerStart.status === "running", "Série não iniciou");

  app.advance(10_000);
  assert.equal(app.text("#set-timer-display"), "00:20", "Contagem não usa o tempo decorrido");
  assert.equal(app.F.state.activeWorkout.completedSets.d1, 0);

  // Ticks repetidos não criam registros extras nem reiniciam a série.
  app.advance(0);
  app.advance(0);
  assert.equal(app.F.state.activeWorkout.setTimer.startedAt, timerStart.startedAt);

  app.advance(20_000);
  const session = app.F.state.activeWorkout;
  assert.equal(session.completedSets.d1, 1, "Série não foi registrada ao chegar ao tempo");
  assert.equal(session.setLogs.d1[0].seconds, 30, "Tempo registrado incorreto");
  assert.ok(session.restEndAt, "Descanso não iniciou após a série");
  assertNoErrors(app, "cronômetro");
  app.close();
});

await runTest("10. Pausar, retomar e descanso (com pular)", async () => {
  const routine = sampleRoutine("calisthenics", "pause");
  routine.sections.warmup = [];
  routine.sections.abs = [];
  routine.sections.main = [
    { id: "p1", name: "Flexão", sets: 2, type: "reps", reps: "10", duration: 45, rest: 30, load: "", notes: "", section: "main" },
    { id: "p2", name: "Agachamento", sets: 1, type: "reps", reps: "10", duration: 45, rest: 0, load: "", notes: "", section: "main" }
  ];

  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-pause" })
  }, "treino/executar.html", { now: 2_000_000 });

  app.click("#complete-set");
  app.advance(500);
  let session = app.F.state.activeWorkout;
  assert.equal(session.completedSets.p1, 1);
  assert.equal(app.$("#execution-rest").hidden, false, "Descanso não apareceu");
  assert.equal(app.text("#rest-timer"), "00:30");

  app.advance(10_000);
  assert.equal(app.text("#rest-timer"), "00:20");

  app.click("#pause-rest");
  await wait(10);
  app.advance(60_000);
  assert.equal(app.text("#rest-timer"), "00:20", "Descanso continuou durante a pausa");

  app.click("#resume-rest");
  await wait(10);
  app.advance(5_000);
  assert.equal(app.text("#rest-timer"), "00:15");

  app.click("#pause-session");
  await wait(10);
  app.advance(30_000);
  session = app.F.state.activeWorkout;
  assert.equal(session.running, false);
  assert.equal(app.$("#session-paused-overlay").hidden, false);
  assert.equal(app.text("#rest-timer"), "00:15", "Treino pausado não congelou o descanso");

  app.click("#resume-session");
  await wait(10);
  assert.equal(app.F.state.activeWorkout.running, true);
  app.advance(15_000);
  assert.equal(app.$("#execution-rest").hidden, true, "Descanso não terminou ao chegar a zero");
  assert.equal(app.F.state.activeWorkout.currentIndex, 0);

  app.click("#complete-set");
  app.advance(500);
  assert.equal(app.F.state.activeWorkout.completedSets.p1, 2);
  app.click("#skip-rest");
  await wait(10);
  assert.equal(app.$("#execution-rest").hidden, true, "Pular descanso não funcionou");
  assertNoErrors(app, "pausa e descanso");
  app.close();
});

await runTest("11. Sessão ativa sobrevive à navegação e ao recarregamento", async () => {
  const routine = sampleRoutine("weights", "w-life");
  routine.sections.warmup = [];
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([], [routine]),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-life", modality: "weights" })
  }, "index.html", { now: 3_000_000 });

  assert.equal(app.$("#active-session-banner").hidden, false, "Banner ausente na inicial");
  assert.match(app.text("#active-session-summary"), /Treino A/);

  await app.go(BASE + "progresso/index.html");
  assert.equal(app.$("#active-session-banner").hidden, false, "Banner ausente em progresso");

  await app.reload();
  assert.equal(app.$("#active-session-banner").hidden, false, "Banner sumiu após recarregar");
  assert.ok(app.F.state.activeWorkout, "Sessão não foi restaurada");

  await app.go(BASE + "treino/executar.html");
  assert.equal(app.$("#execution-live").hidden, false, "Execução não retomou a sessão");
  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.F.state.activeWorkout.id, "s-life");
  app.close();
});

await runTest("12. Histórico registra treino concluído e treino parcial", async () => {
  const routine = makeRoutine("calisthenics", "Curto", [
    { name: "Agachamento", section: "main", sets: 1, reps: "5", rest: 0, id: "c1" },
    { name: "Burpee", section: "finisher", sets: 1, reps: "5", rest: 0, id: "c2" }
  ], "curto");

  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-hist" })
  }, "treino/executar.html", { now: 4_000_000 });

  app.click("#complete-set");
  app.advance(500);
  app.click("#next-exercise");
  await wait(10);
  app.click("#complete-set");
  app.advance(500);

  let history = app.data("forja-treino-historico-v1");
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "completed");
  assert.equal(history[0].completedSets, 2);
  assert.equal(app.F.state.activeWorkout, null, "Sessão não foi encerrada");
  assert.equal(app.$("#execution-summary").hidden, false, "Resumo não apareceu");
  assert.equal(app.text("#summary-status-stat"), "Concluído");

  app.close();

  const partialApp = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-partial" })
  }, "treino/executar.html", { now: 5_000_000 });

  partialApp.click("#complete-set");
  partialApp.advance(500);
  partialApp.click("#end-session");
  await wait(15);
  partialApp.modalAction("save");
  await wait(40);

  history = partialApp.data("forja-treino-historico-v1");
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "partial");
  assert.equal(history[0].completedSets, 1);
  assert.equal(history[0].totalPlannedSets, 2);
  assertNoErrors(partialApp, "histórico");
  partialApp.close();
});

await runTest("13. Descartar a sessão pede confirmação e não grava histórico", async () => {
  const routine = sampleRoutine("calisthenics", "disc");
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-disc" })
  }, "treino/executar.html", { now: 6_000_000 });

  app.click("#end-session");
  await wait(15);
  assert.ok(app.$(".modal-backdrop"), "Não pediu confirmação");
  app.modalAction("cancel");
  await wait(25);
  assert.ok(app.F.state.activeWorkout, "Cancelar descartou a sessão");

  app.click("#end-session");
  await wait(15);
  app.modalAction("discard");
  await wait(40);
  assert.equal(app.F.state.activeWorkout, null);
  assert.equal(app.raw("forja-treino-historico-v1"), null, "Descarte gravou histórico");
  app.close();
});

await runTest("14. Repetidos cliques em concluir série não concluem duas séries", async () => {
  const routine = makeRoutine("calisthenics", "Duplo", [
    { name: "Flexão", section: "main", sets: 3, reps: "10", rest: 0, id: "dup" }
  ], "dup-routine");
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-dup" })
  }, "treino/executar.html", { now: 7_000_000 });

  app.click("#complete-set");
  app.click("#complete-set");
  app.click("#complete-set");
  await wait(10);
  assert.equal(app.F.state.activeWorkout.completedSets.dup, 1, "Clique repetido concluiu mais de uma série");
  app.close();
});

await runTest("15. Voltar ao exercício anterior e navegar entre exercícios", async () => {
  const routine = makeRoutine("calisthenics", "Nav", [
    { name: "A", section: "main", sets: 1, reps: "5", rest: 0, id: "na" },
    { name: "B", section: "main", sets: 1, reps: "5", rest: 0, id: "nb" }
  ], "nav-routine");
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-nav" })
  }, "treino/executar.html", { now: 8_000_000 });

  assert.equal(app.text("#current-name"), "A");
  app.click("#complete-set");
  await wait(10);
  app.click("#next-exercise");
  await wait(10);
  assert.equal(app.text("#current-name"), "B");
  app.click("#previous-exercise");
  await wait(10);
  assert.equal(app.text("#current-name"), "A", "Voltar ao exercício anterior falhou");
  app.close();
});

await runTest("16. Resumo ao finalizar e reordenação no editor", async () => {
  const routine = makeRoutine("weights", "Ordem", [
    { name: "Primeiro", section: "main", sets: 1, reps: "5", rest: 0, id: "o1" },
    { name: "Segundo", section: "main", sets: 1, reps: "5", rest: 0, id: "o2" }
  ], "ordem");
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([], [routine])
  }, "treino/rotina.html?modalidade=weights&id=ordem");

  const names = () => app.$$("[data-section-list=main] .editor-exercise-name").map(node => node.textContent);
  assert.deepEqual(names(), ["Primeiro", "Segundo"]);
  app.click('[data-section-list=main] .editor-exercise:nth-child(2) button[aria-label^="Mover"][aria-label*="para cima"]');
  await wait(10);
  assert.deepEqual(names(), ["Segundo", "Primeiro"], "Reordenação não funcionou");
  app.click("#save-routine");
  await wait(20);
  assert.deepEqual(app.data("forja-treino-rotinas-v1").weights[0].sections.main.map(item => item.name), ["Segundo", "Primeiro"]);
  app.close();
});

await runTest("17. Biblioteca: busca e exercício personalizado", async () => {
  const routine = makeRoutine("calisthenics", "Biblioteca", [], "bib");
  const app = await boot({ "forja-treino-rotinas-v1": routinesStore([routine], []) }, "treino/rotina.html?modalidade=calisthenics&id=bib");

  app.click("#library-toggle");
  await wait(10);
  app.$("#library-search").value = "prancha";
  app.$("#library-search").dispatchEvent(new app.w.Event("input", { bubbles: true }));
  await wait(10);
  const items = app.$$(".library-item").map(item => item.textContent);
  assert.ok(items.some(text => /Prancha/.test(text)), "Busca não encontrou Prancha");
  assert.ok(!items.some(text => /Flexão de braço/.test(text)), "Busca não filtrou");

  app.$("#library-search").value = "";
  app.$("#library-search").dispatchEvent(new app.w.Event("input", { bubbles: true }));
  app.click("#custom-toggle");
  await wait(10);
  app.$("#custom-name").value = "Escalada no muro";
  app.$("#custom-sets").value = "3";
  app.$("#custom-rest").value = "45";
  app.$("#custom-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);

  const saved = app.data("forja-treino-biblioteca-v1");
  assert.equal(saved.calisthenics.length, 1, "Exercício personalizado não foi salvo");
  assert.equal(saved.calisthenics[0].name, "Escalada no muro");
  assert.ok(app.$$(".library-item").some(item => /Escalada no muro/.test(item.textContent)));
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics[0].sections.main.length, 0, "Biblioteca alterou a rotina sem pedido");
  assertNoErrors(app, "biblioteca");
  app.close();
});

await runTest("18. Progresso mostra só dados reais e filtra por modalidade", async () => {
  const record = (id, modality, routineName, status, sets) => ({
    id, date: "2025-03-01", modality, routineName, durationMs: 120000,
    completedSets: sets, totalPlannedSets: 4, status,
    finishedAt: "2025-03-01T12:00:00.000Z",
    exercises: [{ id: "x", name: "Exercício " + id, section: "main", plannedSets: 4, completedSets: sets, reps: "10", duration: 45, type: "reps", rest: 60, load: "", notes: "", logs: [], timedSeconds: 0 }]
  });
  const app = await boot({
    "forja-treino-historico-v1": [
      record("p1", "calisthenics", "Cal", "completed", 4),
      record("p2", "weights", "Mus", "partial", 2)
    ]
  }, "progresso/index.html");

  assert.equal(app.text("#progress-sessions"), "2");
  assert.equal(app.text("#progress-completed"), "1");
  assert.equal(app.text("#progress-partial"), "1");
  assert.equal(app.text("#progress-sets"), "6/8");

  app.click('[data-filter="weights"]');
  await wait(10);
  assert.equal(app.text("#progress-sessions"), "1");
  assert.equal(app.text("#progress-sets"), "2/4");
  assert.equal(app.w.location.search, "?modalidade=weights");
  assert.equal(app.$('[data-filter="weights"]').getAttribute("aria-pressed"), "true");
  assert.ok(!/%|sequência|streak/i.test(app.text("#progress-routines") + app.text("#progress-exercises")), "Métrica sem dados reais");
  app.close();
});

await runTest("19. Exportar, importar e desfazer restauração", async () => {
  const routine = sampleRoutine("calisthenics", "bk");
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-missoes-2025-02-02": [{ id: "t", text: "Original", done: false }]
  }, "configuracoes/index.html");

  app.click("#export-backup");
  await wait(20);
  assert.equal(app.downloads.length, 1, "Exportação não gerou arquivo");
  assert.match(app.downloads[0].download, /^forja-backup-\d{4}-\d{2}-\d{2}\.json$/);

  const backup = app.F.buildBackupObject();
  assert.equal(backup.format, "forja-backup");
  assert.ok(backup.keys["forja-treino-rotinas-v1"], "Backup sem rotinas");
  assert.ok(Object.keys(backup.keys).includes("forja-treino-biblioteca-v1") === false || backup.keys["forja-treino-biblioteca-v1"]);

  const replacement = {
    app: "FORJA", format: "forja-backup", version: 1, exportedAt: new Date().toISOString(),
    keys: { "forja-missoes-2025-02-02": [{ id: "n", text: "Importada", done: false }] }
  };
  await app.importFile(replacement);
  assert.equal(app.data("forja-missoes-2025-02-02")[0].text, "Original", "Importação aplicou sem confirmação");
  await app.modal("restore");
  await wait(40);
  assert.equal(app.data("forja-missoes-2025-02-02")[0].text, "Importada", "Importação não aplicou");
  assert.equal(app.$("#restore-safety-backup").hidden, false, "Desfazer não apareceu");

  app.click("#restore-safety-backup");
  await wait(15);
  await app.modal("restore");
  await wait(40);
  assert.equal(app.data("forja-missoes-2025-02-02")[0].text, "Original", "Desfazer não restaurou");
  assertNoErrors(app, "backup");
  app.close();
});

await runTest("20. Importação inválida é rejeitada sem alterar dados", async () => {
  const app = await boot({
    "forja-missoes-2025-02-03": [{ id: "k", text: "Intacta", done: false }]
  }, "configuracoes/index.html");

  await app.importFile("{ isto não é json");
  await wait(40);
  assert.equal(app.data("forja-missoes-2025-02-03")[0].text, "Intacta");

  await app.importFile({ app: "OUTRO", format: "x", version: 1, keys: {} });
  await wait(40);
  assert.equal(app.data("forja-missoes-2025-02-03")[0].text, "Intacta");
  assert.equal(app.raw("forja-backup-seguranca-v1"), null, "Cópia de segurança criada para importação inválida");
  app.close();
});

await runTest("21. Preferências de descanso são salvas e a biblioteca é validada no backup", async () => {
  const app = await boot({}, "configuracoes/index.html");
  assert.equal(app.$("#pref-sound").checked, true);
  assert.equal(app.$("#pref-vibrate").checked, true);
  assert.equal(app.raw("forja-preferencias-v1"), null, "Preferências gravadas sem ação do usuário");

  app.$("#pref-sound").click();
  await wait(20);
  assert.deepEqual(app.data("forja-preferencias-v1"), { soundOnRest: false, vibrateOnRest: true });
  app.close();
});

await runTest("22. Armazenamento local é informado em todas as páginas", async () => {
  for (const page of PAGES) {
    const app = await boot({}, page);
    assert.match(app.text(".storage-note"), /somente neste navegador/, "Aviso ausente em " + page);
    app.close();
  }
});

await runTest("23. Código: sem localStorage.clear(), um único intervalo e calendário intacto", async () => {
  const jsDir = path.join(repoRoot, "assets", "js");
  const sources = fs.readdirSync(jsDir).filter(name => name.endsWith(".js"));
  const all = sources.map(name => fs.readFileSync(path.join(jsDir, name), "utf8")).join("\n");
  const html = PAGES.map(page => fs.readFileSync(path.join(repoRoot, page), "utf8")).join("\n");

  assert.equal((all + html).includes("localStorage.clear("), false, "localStorage.clear() encontrado");

  const intervals = sources.filter(name => /setInterval\(/.test(fs.readFileSync(path.join(jsDir, name), "utf8")));
  assert.deepEqual(intervals, ["forja-app.js"], "Intervalo fora do módulo de inicialização");
  assert.equal((fs.readFileSync(path.join(jsDir, "forja-app.js"), "utf8").match(/setInterval\(/g) || []).length, 1);

  const calendar = fs.readFileSync(path.join(jsDir, "forja-calendario.js"), "utf8").trim();
  assert.equal(
    createHash("sha256").update(calendar).digest("hex"),
    "30a825330793e156adc357ae714f022c853033c1016ee66ffeaec1ab705928c5",
    "O código de calendário/missões mudou em relação à main"
  );
});

await runTest("24. Regras móveis: sem rolagem horizontal, alvos grandes e empilhamento no hub", async () => {
  const css = ["base", "treino", "execucao", "configuracoes", "app", "responsive"]
    .map(name => fs.readFileSync(path.join(repoRoot, "assets", "css", name + ".css"), "utf8"))
    .join("\n");

  assert.match(css, /@media \(max-width: 380px\)/, "Regra para telas de 380px ausente");
  assert.match(css, /\.task-form input \{[^}]*flex: 1 1 100%/);
  assert.match(css, /\.app-nav-inner[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.hub-list \{[^}]*display: grid/);
  assert.match(css, /\.big-set-button/);
});

await runTest("25. Execução: série por duração não é registrada duas vezes com cliques repetidos", async () => {
  const routine = sampleRoutine("calisthenics", "twice");
  routine.sections.warmup = [];
  routine.sections.abs = [];
  routine.sections.main = [{ id: "t1", name: "Prancha", sets: 2, type: "duration", reps: "", duration: 20, rest: 0, load: "", notes: "", section: "main" }];

  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-twice" })
  }, "treino/executar.html", { now: 9_000_000 });

  app.click("#set-timer-start");
  app.click("#set-timer-start");
  app.click("#set-timer-start");
  await wait(10);
  assert.equal(app.F.state.activeWorkout.setTimer.setNumber, 1);
  app.advance(20_000);
  app.advance(20_000);
  assert.equal(app.F.state.activeWorkout.completedSets.t1, 1, "Série por duração registrada duas vezes");
  app.close();
});

await runTest("26. Cronômetro da série pausa, retoma e não avança com a pausa", async () => {
  const routine = sampleRoutine("calisthenics", "tpause");
  routine.sections.warmup = [];
  routine.sections.abs = [];
  routine.sections.main = [
    { id: "q1", name: "Prancha", sets: 1, type: "duration", reps: "", duration: 30, rest: 0, load: "", notes: "", section: "main" },
    { id: "q2", name: "Agachamento", sets: 1, type: "reps", reps: "10", rest: 0, load: "", notes: "", section: "main" }
  ];

  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-tpause" })
  }, "treino/executar.html", { now: 10_000_000 });

  app.click("#set-timer-start");
  app.advance(10_000);
  app.click("#set-timer-pause");
  await wait(10);
  app.advance(60_000);
  assert.equal(app.text("#set-timer-display"), "00:20", "Pausa do cronômetro não congelou a contagem");
  assert.equal(app.F.state.activeWorkout.completedSets.q1, 0, "Série concluída durante a pausa");

  app.click("#set-timer-resume");
  await wait(10);
  app.advance(15_000);
  assert.equal(app.F.state.activeWorkout.completedSets.q1, 0, "Concluiu antes do tempo planejado");
  assert.equal(app.text("#set-timer-display"), "00:05");

  app.advance(5_000);
  assert.equal(app.F.state.activeWorkout.completedSets.q1, 1, "Não concluiu ao chegar ao tempo");
  assertNoErrors(app, "pausa do cronômetro");
  app.close();
});

await runTest("27. Biblioteca: busca, filtros e detalhe sem alterar dados", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  await wait(20);

  assert.equal(app.d.body.dataset.page, "biblioteca");
  assert.ok(app.$("#catalog-root"), "Contêiner da biblioteca ausente");

  const rows = () => app.$$("#catalog-list .ui-exercise-row");
  const total = () => app.F.catalog.items().length;

  assert.equal(total(), 37, "Catálogo sugerido não carregou inteiro");
  assert.match(app.text("#catalog-status"), /37 exercícios no catálogo/);
  assert.equal(rows().length, 12, "A lista não veio em blocos para caber na tela");
  assert.match(app.text(".catalog-more"), /Mostrar mais 12 de 25/, "Contador de 'mostrar mais' errado");

  app.click(".catalog-more button");
  await wait(15);
  assert.equal(rows().length, 24, "Mostrar mais não revelou o bloco seguinte");
  assert.match(app.text(".catalog-more"), /Mostrar mais 12 de 13/);
  app.click(".catalog-more button");
  await wait(15);
  assert.match(app.text(".catalog-more"), /Mostrar mais 1 de 1/, "Último bloco não avisou que era o resto");
  app.click(".catalog-more button");
  await wait(15);
  assert.equal(rows().length, 37, "Último bloco não mostrou o restante");
  assert.equal(app.$(".catalog-more"), null, "Botão 'Mostrar mais' ficou depois de tudo visível");

  /* Busca ignora acentos e considera nome, músculo, categoria e equipamento. */
  const search = app.$("#catalog-search");
  search.value = "flexao";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  await wait(10);
  const found = rows().map(row => row.querySelector(".ui-exercise-name").textContent);
  assert.ok(found.includes("Flexão de braço"), "Busca sem acento não encontrou Flexão");
  assert.ok(found.length < 37 && found.length > 0, "Busca não filtrou a lista");

  search.value = "peito";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  await wait(10);
  assert.ok(rows().length > 1, "Busca por grupo muscular não retornou itens");
  assert.ok(rows().length <= 12, "Busca ignorou o bloco visível");

  search.value = "";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  await wait(10);
  assert.equal(rows().length, 12, "Limpar a busca não trouxe o catálogo de volta");
  assert.match(app.text("#catalog-status"), /37 exercícios/);

  /* Filtros: modalidade, medição e categoria funcionam e mostram contagem. */
  const weightsSegment = app.$$("#catalog-controls .ui-segment").find(node => /Muscula/.test(node.textContent));
  weightsSegment.click();
  await wait(15);
  assert.match(app.text("#catalog-status"), /19 exercícios/);
  assert.equal(rows().length, 12, "Filtro de modalidade não reiniciou o bloco visível");
  app.click(".catalog-more button");
  await wait(15);
  assert.equal(rows().length, 19, "Filtro de modalidade não reduziu a lista");
  assert.ok(rows().every(row => /Muscula/.test(row.textContent)), "Filtro de modalidade vazou itens de calistenia");

  app.$$("#catalog-controls .ui-segment")[0].click();
  await wait(15);
  assert.match(app.text("#catalog-status"), /37 exercícios no catálogo/);
  assert.equal(rows().length, 12, "Voltar para Todas não restaurou a lista");

  const measureRow = app.$('#catalog-controls [data-filter-group="measure"]');
  assert.ok(measureRow, "Filtro de medição ausente");
  measureRow.querySelector('[data-value="time"]').click();
  await wait(15);
  const timed = app.F.catalog.filter({ measure: "time" });
  assert.ok(timed.length > 0 && timed.length < 37, "Filtro de medição não funcionou");
  assert.equal(rows().length, Math.min(12, timed.length), "Filtro novo não reiniciou o bloco visível");
  /*
    `Array.from` no domínio do teste: os objetos vêm da janela jsdom e a
    comparação estrita de arrays também compara protótipos.
  */
  assert.deepEqual(
    rows().map(row => row.querySelector(".ui-exercise-name").textContent),
    Array.from(timed.slice(0, 12), record => record.name),
    "Filtro de medição listou itens diferentes dos que têm medição por tempo"
  );

  app.$('#catalog-controls [data-filter-group="measure"] [data-value="null"]').click();
  await wait(15);
  assert.equal(rows().length, 12, "Limpeza do filtro não voltou ao primeiro bloco");
  assert.match(app.text("#catalog-status"), /37 exercícios/);

  /* Detalhe traz instruções reais e a frase de histórico (sem inventar dado). */
  app.click('#catalog-list .ui-exercise-row [aria-label^="Ver detalhes"]');
  await wait(20);
  assert.ok(app.$(".modal-backdrop"), "Detalhe não abriu");
  assert.match(app.text(".modal-details"), /sem registros no seu histórico/i, "Detalhe inventou histórico");
  app.modalAction("cancel");
  await wait(20);

  /* Consultar não escreve nada. */
  assert.deepEqual(app.keys(), [], "A biblioteca gravou dados sem pedido do usuário");
  assertNoErrors(app, "biblioteca");
  app.close();
});

await runTest("27b. Biblioteca: detalhe usa o histórico real, não número inventado", async () => {
  const record = (id, name, sets, load) => ({
    id, date: "2026-10-01", modality: "calisthenics", routineName: "Treino X",
    durationMs: 60000, completedSets: sets, totalPlannedSets: sets, status: "completed",
    finishedAt: "2026-10-01T12:00:00.000Z",
    exercises: [{
      id: "e-" + id, name, section: "main", plannedSets: sets, completedSets: sets,
      reps: "10", duration: 45, type: "reps", rest: 60, load: "", notes: "", timedSeconds: 0,
      logs: Array.from({ length: sets }, (_, index) => ({ set: index + 1, reps: "12", load, seconds: undefined }))
    }]
  });

  const app = await boot({
    "forja-treino-historico-v1": [
      record("h1", "Flexão de braço", 3, "20 kg"),
      record("h2", "Flexão de braço", 2, "25 kg")
    ]
  }, "treino/biblioteca.html");
  await wait(20);

  const row = app.$$("#catalog-list .ui-exercise-row").find(node => /Flexão de braço/.test(node.textContent));
  app.click(row.querySelector('[aria-label^="Ver detalhes"]'));
  await wait(20);

  const details = app.text(".modal-details");
  assert.match(details, /2 treinos registrados/);
  assert.match(details, /5 séries concluídas/);
  assert.match(details, /maior carga 25 kg/);
  assert.match(details, /máximo de 12 repetições/);
  assert.match(details, /último em 01 de out/, "Data do último treino não formatada: " + details);
  assertNoErrors(app, "detalhe com histórico");
  app.close();
});

await runTest("28. Biblioteca: adicionar à rotina grava na seção escolhida", async () => {
  const routine = makeRoutine("calisthenics", "Rotina B", [
    { id: "m1", name: "Flexão existing", section: "main", sets: 2, reps: "10", rest: 10 }
  ], "rb");

  const app = await boot({ "forja-treino-rotinas-v1": routinesStore([routine], []) }, "treino/biblioteca.html");
  await wait(20);

  const before = app.raw("forja-treino-rotinas-v1");
  assert.equal(routine.sections.warmup.length, 0);

  /* Adicionar direto pelo botão: modal pede rotina e seção. */
  const target = app.$$("#catalog-list .ui-exercise-row")
    .find(row => /Agachamento livre/.test(row.textContent));
  app.click(target.querySelector('[aria-label^="Adicionar"]'));
  await wait(20);
  assert.match(app.text("#modal-title"), /Adicionar Agachamento livre/);
  assert.equal(app.modalField("routine").options.length, 1, "Seletor de rotina incorreto");
  app.modalField("section").value = "main";
  app.modalAction("add");
  await wait(40);

  const after = app.data("forja-treino-rotinas-v1").calisthenics[0];
  assert.equal(after.sections.main.length, 2, "Exercício não entrou na rotina");
  const added = after.sections.main[1];
  assert.equal(added.name, "Agachamento livre");
  assert.match(added.id, /^exercise-/, "O exercício copiado precisa de id novo");
  assert.equal(added.libraryId, "cal-agachamento", "A origem no catálogo não foi registrada");
  assert.equal(added.section, "main");
  assert.ok(added.instructions.length > 0, "As instruções não viajaram com o exercício");
  assert.match(app.text("#toast"), /entrou em Rotina B/);

  /* Cancelar o modal não altera a rotina. */
  const untouched = app.raw("forja-treino-rotinas-v1");
  const second = app.$$("#catalog-list .ui-exercise-row")[0];
  app.click(second.querySelector('[aria-label^="Adicionar"]'));
  await wait(20);
  app.modalAction("cancel");
  await wait(20);
  assert.equal(app.raw("forja-treino-rotinas-v1"), untouched, "Cancelar alterou a rotina");

  /* Rotina atualizada no estado: nada de recarregar a página. */
  assert.equal(app.F.state.routines.calisthenics[0].sections.main.length, 2);
  assert.deepEqual(Object.keys(app.data("forja-treino-rotinas-v1")).sort(), ["calisthenics", "weights"]);
  assert.notEqual(before, app.raw("forja-treino-rotinas-v1"));
  assertNoErrors(app, "adicionar da biblioteca");
  app.close();
});

await runTest("29. Biblioteca sem rotinas leva o usuário ao lugar certo", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  await wait(20);

  app.click('#catalog-list .ui-exercise-row [aria-label^="Adicionar"]');
  await wait(20);
  assert.match(app.text("#modal-title"), /Nenhuma rotina de Calistenia/);
  assert.match(app.text(".modal-message"), /A biblioteca não guarda treinos sozinha/);

  app.modalAction("open");
  await pageIs(app, "calistenia");
  assertNoErrors(app, "biblioteca sem rotinas");
  app.close();
});

await runTest("30. Editor: metadados do exercício personalizado chegam à biblioteca", async () => {
  const routine = makeRoutine("calisthenics", "Com metadados", [], "meta");
  const app = await boot({ "forja-treino-rotinas-v1": routinesStore([routine], []) }, "treino/rotina.html?modalidade=calisthenics&id=meta");
  await wait(20);

  app.click("#library-toggle");
  app.click("#custom-toggle");
  await wait(10);

  app.$("#custom-name").value = "Prancha Esequena";
  app.$("#custom-sets").value = "2";
  app.$("#custom-rest").value = "30";
  app.$("#custom-category").value = "core";
  app.$("#custom-muscles").value = "abdômen, lombar, abdômen";
  app.$("#custom-equipment").value = "peso corporal";
  app.$("#custom-instructions").value = "Subir o quadril só depois de estabilizar a respiração.";
  app.$("#custom-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);

  const saved = app.data("forja-treino-biblioteca-v1").calisthenics[0];
  assert.equal(saved.name, "Prancha Esequena");
  assert.equal(saved.category, "core");
  assert.deepEqual(saved.muscles, ["abdômen", "lombar"], "Lista de músculos não foi deduplicada/limitada");
  assert.deepEqual(saved.equipment, ["peso corporal"]);
  assert.equal(saved.instructions, "Subir o quadril só depois de estabilizar a respiração.");

  assert.match(app.text("#library-list"), /Core/i, "Categoria não apareceu na lista do editor");

  /* O bloco opcional volta fechado e limpo para o próximo cadastro. */
  assert.equal(app.$("#custom-muscles").value, "");
  assert.equal(app.$("#custom-meta").open, false);

  /* O exercício personalizado aparece no catálogo com os metadados. */
  app.click("#open-catalog");
  await pageIs(app, "biblioteca");
  await wait(20);

  const sourceChip = app.$('#catalog-controls [data-filter-group="source"]');
  sourceChip.querySelector('[data-value="personalizado"]').click();
  await wait(20);
  const rows = app.$$("#catalog-list .ui-exercise-row");
  assert.equal(rows.length, 1, "Exercício personalizado não apareceu no catálogo");
  assert.match(rows[0].textContent, /Prancha Esequena/);
  assert.match(rows[0].textContent, /Core/);
  assert.match(rows[0].textContent, /abdômen/);
  assertNoErrors(app, "metadados do editor");
  app.close();
});

/*
  Execução (etapa 4): carga, distância, correção de série, ajuste do descanso
  e resumo com volume real. A rotina abaixo cobre os três tipos de medição.
*/
function heavyRoutine() {
  const base = (extra) => Object.assign({
    sets: 3, reps: "10", rest: 60, type: "reps", duration: 0, load: "", notes: "", measure: "reps"
  }, extra);

  return {
    id: "exec1",
    name: "Empurrar pesado",
    modality: "weights",
    createdAt: 1,
    updatedAt: 1,
    sections: {
      warmup: [],
      main: [
        base({ id: "bench", name: "Supino", load: "60 kg" }),
        base({ id: "row", name: "Remada curvada", sets: 1, rest: 0, load: "30 kg" })
      ],
      abs: [],
      finisher: [base({
        id: "run",
        name: "Esteira 400 m",
        sets: 1,
        reps: "",
        rest: 0,
        measure: "distance",
        distance: 400,
        distanceUnit: "m"
      })]
    }
  };
}

function setLog(extra) {
  return Object.assign({ set: 1, reps: "", load: "", seconds: null, distance: null, rpe: null, editedAt: null }, extra);
}

async function bootExecution(seedExtra = {}) {
  const routine = heavyRoutine();
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([], [routine]),
    "forja-treino-sessao-ativa-v1": sessionSeed(
      routine,
      Object.assign({ id: "s-exec", modality: "weights" }, seedExtra)
    )
  }, "treino/executar.html", { now: 20_000_000 });

  await pageIs(app, "executar");
  return app;
}

/* Escreve num campo como o usuário (input para texto, change para select). */
function typeField(app, selector, value, eventName = "input") {
  const field = app.$(selector);
  assert.ok(field, "Campo ausente: " + selector);
  field.value = value;
  field.dispatchEvent(new app.w.Event(eventName, { bubbles: true }));
}

await runTest("31. Execução: corrigir e remover uma série já registrada", async () => {
  const app = await bootExecution();

  assert.equal(app.text("#current-name"), "Supino");

  typeField(app, "#log-reps", "8");
  typeField(app, "#log-load", "62 kg");
  typeField(app, "#log-rpe", "8", "change");
  app.click("#complete-set");
  app.advance(600);

  assert.equal(app.text("#set-progress-label"), "1 de 3");
  assert.match(app.text("#log-list"), /Série 1 · 8 reps · 62 kg · RPE 8/);
  assert.equal(app.$("#execution-rest").hidden, false, "descanso não começou depois da série");

  /* No meio do descanso não se remove série: o tempo em andamento é dali. */
  app.click("#log-list .log-entry button");
  await wait(20);
  app.modalAction("remove");
  await wait(20);
  assert.match(app.text("#toast"), /Termine ou pule o descanso/);
  assert.equal(app.F.state.activeWorkout.completedSets.bench, 1, "Removeu série durante o descanso");
  assert.equal(app.$$("#log-list .log-entry").length, 1);

  app.click("#skip-rest");
  await wait(20);

  /* Corrigir mostra só os campos que fazem sentido para o exercício. */
  app.click("#log-list .log-entry button");
  await wait(20);
  assert.match(app.text("#modal-title"), /Corrigir série 1/);
  assert.deepEqual(
    app.$$("[data-modal-field]").map(node => node.getAttribute("data-modal-field")),
    ["reps", "load", "rpe"]
  );

  app.modalField("reps").value = "10";
  app.modalField("load").value = "65 kg";
  app.modalAction("save");
  await wait(30);

  assert.match(app.text("#log-list"), /Série 1 · 10 reps · 65 kg · RPE 8 · corrigida/);
  assert.match(app.text("#toast"), /atualizada/);
  assert.equal(app.F.state.activeWorkout.completedSets.bench, 1, "Corrigir mudou a contagem de séries");

  const stored = app.data("forja-treino-sessao-ativa-v1").setLogs.bench[0];
  assert.equal(stored.reps, "10");
  assert.equal(stored.load, "65 kg");
  assert.ok(stored.editedAt > 0, "edição sem marca de tempo");

  /* Remover a última série devolve o direito de registrá-la de novo. */
  app.click("#log-list .log-entry button");
  await wait(20);
  app.modalAction("remove");
  await wait(20);

  assert.equal(app.text("#set-progress-label"), "0 de 3");
  assert.equal(app.$$("#log-list .log-entry").length, 0);
  assert.match(app.text("#toast"), /removida/);

  app.click("#complete-set");
  app.advance(600);
  assert.equal(app.text("#set-progress-label"), "1 de 3", "não deixou registrar a série removida");
  assert.match(app.text("#log-list"), /Série 1 ·/);

  assertNoErrors(app, "corrigir e remover série");
  app.close();
});

await runTest("32. Execução: ajustar o descanso em andamento em passos de 15 s", async () => {
  const app = await bootExecution();

  app.click("#complete-set");
  app.advance(600);
  assert.equal(app.text("#rest-timer"), "01:00");
  assert.match(app.text("#rest-adjust-state"), /1 min neste descanso/);

  app.advance(10_000);
  assert.equal(app.text("#rest-timer"), "00:50");

  app.click("#rest-plus");
  assert.equal(app.text("#rest-timer"), "01:05", "+15 s não entrou no tempo restante");
  assert.equal(app.F.state.activeWorkout.restPlannedSeconds, 65);
  assert.match(app.text("#rest-adjust-state"), /ajustado de 1 min/);
  assert.equal(app.F.state.activeWorkout.queue[0].rest, 60, "o ajuste reescreveu o plano do exercício");

  /* O tempo novo é real: continua contando a partir dele. */
  app.advance(10_000);
  assert.equal(app.text("#rest-timer"), "00:55");

  app.click("#rest-minus");
  assert.equal(app.text("#rest-timer"), "00:40");

  /* Pausado, o ajuste soma no tempo que falta e nada continua contando. */
  app.click("#pause-rest");
  await wait(20);
  assert.equal(app.F.state.activeWorkout.restEndAt, null, "pausa não guardou o tempo restante");

  app.advance(30_000);
  assert.equal(app.text("#rest-timer"), "00:40", "descanso contou durante a pausa");

  app.click("#rest-plus");
  assert.equal(app.text("#rest-timer"), "00:55", "ajuste com descanso pausado não somou 15 s");

  app.click("#resume-rest");
  await wait(20);
  app.advance(15_000);
  assert.equal(app.text("#rest-timer"), "00:40");

  /* O piso é 1 s: não dá para travar a tela com descanso negativo. */
  app.click("#rest-minus");
  app.click("#rest-minus");
  app.click("#rest-minus");
  assert.equal(app.text("#rest-timer"), "00:01");
  assert.equal(app.$("#execution-rest").hidden, false, "descanso sumiu antes da hora");

  /* Sobrevive ao recarregamento: são timestamps, não contadores de aba. */
  const persisted = app.data("forja-treino-sessao-ativa-v1");
  assert.equal(persisted.restPlannedSeconds, 1);
  await app.reload();
  await wait(30);
  assert.equal(app.F.state.activeWorkout.restPlannedSeconds, 1, "ajuste do descanso não persistiu");
  assert.equal(app.text("#rest-timer"), "00:01");
  assert.equal(app.$("#execution-rest").hidden, false);

  assertNoErrors(app, "ajuste de descanso");
  app.close();
});

await runTest("33. Execução: série por distância e resumo com volume real", async () => {
  const app = await bootExecution({
    currentIndex: 2,
    completedSets: { bench: 3, row: 1, run: 0 },
    setLogs: {
      bench: [
        setLog({ set: 1, reps: "10", load: "60 kg", rpe: 7 }),
        setLog({ set: 2, reps: "8", load: "" }),
        setLog({ set: 3, reps: "10", load: "30 kg" })
      ],
      row: [setLog({ set: 1, reps: "12", load: "30 kg" })]
    }
  });

  assert.equal(app.text("#current-name"), "Esteira 400 m");
  assert.match(app.text("#current-plan-value"), /400 m/);
  assert.equal(app.$("#log-reps-field").hidden, true, "pediu repetições em exercício de distância");
  assert.equal(app.$("#log-distance-field").hidden, false, "campo de distância não apareceu");
  assert.equal(app.text("#log-distance-unit"), "m");
  assert.match(app.text("#log-distance-hint"), /Alvo da série: 400 m/);

  typeField(app, "#log-distance", "420");
  app.click("#complete-set");
  await wait(60);

  const record = app.data("forja-treino-historico-v1")[0];
  assert.ok(record, "sessão concluída não entrou no histórico");
  assert.equal(record.status, "completed");
  assert.equal(record.exercises[2].logs[0].distance, 420, "distância da série não foi salva");
  assert.equal(record.totals.distanceMeters, 420);
  assert.equal(record.totals.volumeKg, 1260, "volume somado errado");
  assert.equal(record.totals.reps, 40);
  assert.equal(record.totals.setsLogged, 5);
  assert.equal(record.totals.setsWithoutVolume, 1, "série sem carga numérica não foi sinalizada");

  assert.equal(app.$("#execution-summary").hidden, false, "resumo não apareceu ao concluir a sessão");
  assert.equal(app.text("#summary-volume"), "1.260 kg");
  assert.equal(app.text("#summary-reps"), "40");
  assert.equal(app.text("#summary-distance"), "420 m");
  assert.equal(app.text("#summary-time-under"), "—");
  assert.match(app.text("#summary-note"), /1 série ficou fora do volume/);
  assert.equal(app.$("#summary-feedback").hidden, true, "inventou esforço sem registro");

  app.click("#summary-close");
  await wait(20);
  assert.equal(app.F.state.activeWorkout, null);

  assertNoErrors(app, "distância e resumo");
  app.close();
});

await runTest("33b. Resposta da sessão: RPE e nota são opcionais e vão para o histórico", async () => {
  const app = await bootExecution();

  /* Sem série concluída, não se pergunta o esforço de uma sessão que não aconteceu. */
  app.click("#end-session");
  await wait(20);
  assert.equal(app.$$("[data-modal-field]").length, 0, "pediu RPE sem nenhuma série registrada");
  assert.deepEqual(
    app.$$("[data-modal-action]").map(node => node.getAttribute("data-modal-action")),
    ["cancel", "discard"]
  );
  app.modalAction("cancel");
  await wait(20);
  assert.equal(app.F.state.activeWorkout.id, "s-exec", "cancelar encerrou a sessão");

  /* Uma série registrada libera o resumo; preencher só a nota também basta. */
  app.click("#complete-set");
  app.advance(600);
  app.click("#skip-rest");
  await wait(20);

  app.click("#end-session");
  await wait(20);
  assert.deepEqual(
    app.$$("[data-modal-field]").map(node => node.getAttribute("data-modal-field")),
    ["rpe", "note"]
  );

  app.modalField("note").value = "  ombro esquerdo incomodou na última série  ";
  app.modalAction("save");
  await wait(60);

  const record = app.data("forja-treino-historico-v1")[0];
  assert.ok(record, "sessão parcial não entrou no histórico");
  assert.equal(record.status, "partial");
  assert.equal(record.feedback.rpe, null, "criou RPE fantasma");
  assert.equal(record.feedback.note, "ombro esquerdo incomodou na última série");
  assert.ok(record.feedback.updatedAt > 0);

  assert.equal(app.text("#summary-feedback"), "Nota: ombro esquerdo incomodou na última série");
  /* A série herdou reps e carga planejados (10 × 60 kg): volume real, sem aviso. */
  assert.equal(app.text("#summary-volume"), "600 kg");
  assert.equal(app.$("#summary-note").hidden, true, "avisou de falta de dados que existem");

  assert.equal(app.text("#summary-distance"), "—");

  /* O histórico conta a mesma história: número registrado, RPE e nota. */
  app.click("#summary-history-link");
  await wait(60);

  const historyText = app.text(".history-item");
  assert.match(historyText, /600 kg/);
  assert.match(historyText, /10 repetições/);
  assert.match(historyText, /ombro esquerdo incomodou na última série/, "nota não chegou ao histórico");
  assert.doesNotMatch(historyText, /Esforço da sessão/, "apareceu RPE que ninguém registrou");
  assertNoErrors(app, "feedback da sessão");
  app.close();

  /* Com RPE preenchido, a linha de esforço aparece no resumo e no histórico. */
  const second = await bootExecution({ id: "s-exec-2" });
  second.click("#complete-set");
  second.advance(600);
  second.click("#skip-rest");
  await wait(20);
  second.click("#end-session");
  await wait(20);

  second.modalField("rpe").value = "9";
  second.modalField("note").value = "última série quase falhou";
  second.modalAction("save");
  await wait(60);

  assert.equal(second.text("#summary-feedback"), "Esforço registrado: RPE 9 · Nota: última série quase falhou");
  assert.equal(second.data("forja-treino-historico-v1")[0].feedback.rpe, 9);

  second.click("#summary-history-link");
  await wait(60);
  const secondHistory = second.text(".history-item");
  assert.match(secondHistory, /Esforço da sessão \(RPE\) 9/);
  assert.match(secondHistory, /última série quase falhou/);
  assertNoErrors(second, "feedback com RPE");
});

/* ------------------------------------------------------------------ */
/* Etapa 5 — análise de progresso                                      */
/* ------------------------------------------------------------------ */

/* Datas relativas ao relógio real: a página usa a semana/mês correntes. */
function dayOffset(days, hour = 12) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function keyOf(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + month + "-" + day;
}

function dayMonth(date) {
  return String(date.getDate()).padStart(2, "0") + "/" + String(date.getMonth() + 1).padStart(2, "0");
}

function startOfWeek(date) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

function sameWeek(a, b) {
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}

function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function seedLog(extra = {}) {
  return Object.assign({
    set: 1, reps: "", load: "", seconds: 0, distance: null, rpe: null, editedAt: null
  }, extra);
}

function seedExercise(name, logs, extra = {}) {
  return Object.assign({
    id: "ex-" + name.toLowerCase().replace(/\s+/g, "-"),
    name,
    section: "main",
    plannedSets: logs.length,
    completedSets: logs.length,
    reps: "10",
    duration: 45,
    type: "reps",
    rest: 60,
    load: "",
    notes: "",
    distance: null,
    distanceUnit: "m",
    logs,
    timedSeconds: logs.reduce((sum, entry) => sum + (Number(entry.seconds) || 0), 0)
  }, extra);
}

function seedRecord(date, exercises, extra = {}) {
  const completedSets = exercises.reduce((sum, exercise) => sum + exercise.completedSets, 0);
  const totalPlannedSets = exercises.reduce((sum, exercise) => sum + exercise.plannedSets, 0);

  return Object.assign({
    id: "seed-" + keyOf(date) + "-" + Math.random().toString(36).slice(2, 8),
    date: keyOf(date),
    finishedAt: date.toISOString(),
    modality: "weights",
    routineName: "Treino de teste",
    durationMs: 30 * 60000,
    completedSets,
    totalPlannedSets,
    status: completedSets >= totalPlannedSets ? "completed" : "partial",
    exercises,
    feedback: { rpe: null, note: "" }
  }, extra);
}

function storageSnapshot(app) {
  const snapshot = {};
  app.keys().forEach(key => { snapshot[key] = app.raw(key); });
  return snapshot;
}

await runTest("34. Progresso: resumo, período e calendário de frequência com dados reais", async () => {
  const today = dayOffset(0);
  const yesterday = dayOffset(-1);
  const weekAgo = dayOffset(-8);
  const longAgo = dayOffset(-35);

  const records = [
    seedRecord(today, [seedExercise("Supino", [seedLog({ reps: "10", load: "40 kg" })])]),
    seedRecord(yesterday, [seedExercise("Remada", [seedLog({ reps: "10", load: "30 kg" })])]),
    seedRecord(weekAgo, [seedExercise("Supino", [seedLog({ reps: "8", load: "35 kg" })])]),
    seedRecord(longAgo, [seedExercise("Agachamento", [seedLog({ reps: "12" })])], { modality: "calisthenics" })
  ];

  const app = await boot({ "forja-treino-historico-v1": records }, "progresso/index.html");
  await wait(20);

  assert.match(app.text("#progress-scope"), /Todas as modalidades · Todo o período/);
  assert.equal(app.text("#progress-sessions"), "4");
  assert.equal(app.text("#progress-completed"), "4");
  assert.equal(app.text("#progress-partial"), "0");
  assert.equal(app.text("#progress-sets"), "4/4");

  const statValues = app.$$("#progress-totals .ui-stat-value").map(node => node.textContent);
  const statLabels = app.$$("#progress-totals .ui-stat-label").map(node => node.textContent);
  assert.ok(statLabels.includes("volume com carga"), "Volume não apareceu no resumo");
  assert.ok(statValues.includes("980 kg"), "Volume real (10x40 + 10x30 + 8x35) não apareceu");
  assert.ok(statValues.includes("40"), "Repetições reais não apareceram");
  assert.equal(statValues[statLabels.indexOf("dias treinados")], "4", "Dias treinados errados");

  /* Calendário: 12 semanas × 7 dias, com o dia de hoje marcado. */
  assert.equal(app.$$("#progress-frequency .ui-heatmap-cell").length, 84);
  const todayCell = app.$('#progress-frequency .ui-heatmap-cell[data-date="' + keyOf(today) + '"]');
  assert.ok(todayCell, "Célula de hoje não existe no calendário");
  assert.match(todayCell.className, /level-[1-4]/);
  assert.match(app.text("#progress-frequency"), /4 dia\(s\) com treino e 4 treino\(s\) nas últimas 12 semanas/);

  /* Semana: só os treinos da semana corrente. */
  const expectedWeek = records.filter(record => sameWeek(record.finishedAt ? new Date(record.finishedAt) : new Date(record.date), today)).length;
  app.$('#period-control [data-value="week"]').click();
  await wait(20);
  assert.equal(app.text("#progress-sessions"), String(expectedWeek), "Filtro de semana errado");
  assert.match(app.w.location.search, /periodo=semana/);
  assert.match(app.text("#progress-scope"), /\d{2}\/\d{2} – \d{2}\/\d{2} de \d{4}/);

  /* Mês: só o mês corrente. */
  const expectedMonth = records.filter(record => sameMonth(new Date(record.finishedAt), today)).length;
  app.$('#period-control [data-value="month"]').click();
  await wait(20);
  assert.equal(app.text("#progress-sessions"), String(expectedMonth), "Filtro de mês errado");
  assert.match(app.w.location.search, /periodo=mes/);

  /* Personalizado: um dia específico, e erro não troca os dados. */
  app.$('#period-control [data-value="custom"]').click();
  await wait(20);
  assert.equal(app.$("#period-custom").hidden, false, "Campos do período personalizado não apareceram");

  app.$("#period-from").value = keyOf(weekAgo);
  app.$("#period-to").value = keyOf(weekAgo);
  app.click("#period-apply");
  await wait(20);
  assert.equal(app.text("#progress-sessions"), "1");
  assert.match(app.w.location.search, /de=\d{4}-\d{2}-\d{2}/);
  assert.ok(app.w.location.search.includes("ate=" + keyOf(weekAgo)));

  app.$("#period-from").value = keyOf(today);
  app.$("#period-to").value = keyOf(weekAgo);
  app.click("#period-apply");
  await wait(20);
  assert.equal(app.$("#period-error").hidden, false, "Intervalo invertido não avisou nada");
  assert.equal(app.text("#progress-sessions"), "1", "Intervalo inválido mudou o resumo");

  assertNoErrors(app, "progresso com período");
  app.close();
});

await runTest("35. Progresso: gráficos semana a semana e evolução real por exercício", async () => {
  const records = [
    seedRecord(dayOffset(-21), [seedExercise("Supino", [seedLog({ reps: "10", load: "30 kg" }), seedLog({ set: 2, reps: "10", load: "30 kg" })])]),
    seedRecord(dayOffset(-14), [seedExercise("Supino", [seedLog({ reps: "8", load: "35 kg" })])]),
    seedRecord(dayOffset(-7), [seedExercise("Supino", [seedLog({ reps: "6", load: "40 kg" })])]),
    seedRecord(dayOffset(-1), [seedExercise("Supino", [seedLog({ reps: "5", load: "45 kg" })]),
      seedExercise("Corrida", [seedLog({ distance: 800 })], { measure: "distance" })])
  ];

  const app = await boot({ "forja-treino-historico-v1": records }, "progresso/index.html");
  await wait(20);

  /* Semana a semana: 8 colunas, mesmo nas semanas zeradas, e barras de séries. */
  assert.equal(app.$$("#progress-weekly .ui-column").length, 8);
  assert.equal(app.$$("#progress-weekly .ui-bars .ui-bar-row").length, 8);
  assert.ok(app.$("#progress-weekly .ui-columns"), "Gráfico de colunas ausente");
  assert.match(app.$("#progress-weekly .ui-columns").getAttribute("aria-label"), /Treinos por semana/);

  /* Evolução: Supino é o exercício com mais treinos e vem selecionado. */
  const options = app.$$("#evolution-select option").map(option => option.textContent);
  assert.ok(options.some(text => /Supino/.test(text)), "Supino não apareceu na evolução");
  assert.match(app.$("#evolution-select").value, /supino/);
  assert.ok(app.$("#progress-evolution .ui-line-svg"), "Linha de evolução não foi desenhada");
  assert.equal(app.$$("#progress-evolution .ui-line-dot").length, 4);
  assert.match(app.text("#progress-evolution"), /Melhor registro: 45 kg/);
  assert.match(app.text("#progress-evolution"), /maior carga numérica/i);
  assert.ok(app.$("#progress-evolution .ui-table"), "Tabela acessível do gráfico ausente");

  /* Corrida só tem um treino medido: estado vazio explica o critério. */
  const runOption = app.$$("#evolution-select option").find(option => /Corrida/.test(option.textContent));
  assert.ok(runOption, "Corrida não apareceu na evolução");
  app.$("#evolution-select").value = runOption.value;
  app.$("#evolution-select").dispatchEvent(new app.w.Event("change", { bubbles: true }));
  await wait(20);
  assert.equal(app.$("#progress-evolution .ui-line-svg"), null, "Um ponto isolado virou linha");
  assert.match(app.text("#progress-evolution"), /Ainda não há série de evolução/);
  assert.match(app.text("#progress-evolution"), /1 treino/);

  assertNoErrors(app, "gráficos e evolução");
  app.close();
});

await runTest("36. Progresso: recordes com critério explícito e sem categoria inventada", async () => {
  const records = [
    seedRecord(dayOffset(-20), [seedExercise("Supino", [seedLog({ reps: "10", load: "40 kg" }), seedLog({ set: 2, reps: "12", load: "35 kg" })])]),
    seedRecord(dayOffset(-6), [seedExercise("Supino", [seedLog({ reps: "8", load: "50 kg" })])]),
    seedRecord(dayOffset(-2), [seedExercise("Corrida", [seedLog({ distance: 1.5 })], { measure: "distance", distanceUnit: "km" })])
  ];

  const app = await boot({ "forja-treino-historico-v1": records }, "progresso/index.html");
  await wait(20);

  const loadRecord = app.$('[data-record="load"]');
  assert.ok(loadRecord, "Recorde de carga ausente");
  assert.equal(app.text('[data-record="load"] .record-value'), "50 kg");
  assert.match(loadRecord.textContent, /Critério:.*lb.*kg|Critério:.*convertidas/i);
  assert.match(loadRecord.textContent, /Supino/);

  assert.equal(app.text('[data-record="reps"] .record-value'), "12 reps");
  assert.equal(app.text('[data-record="distance"] .record-value'), "1,5 km");
  assert.equal(app.$('[data-record="time"]'), null, "Recorde de tempo sem série cronometrada");
  assert.match(app.text("#records-note"), /série mais longa/);

  assertNoErrors(app, "recordes");
  app.close();

  const empty = await boot({}, "progresso/index.html");
  await wait(20);
  assert.equal(empty.$$(".record-item").length, 0);
  assert.match(empty.text("#progress-records"), /Nenhum recorde medido ainda/);
  empty.close();
});

await runTest("37. Progresso: comparação de períodos e metas semanais persistentes", async () => {
  const today = dayOffset(0);
  const records = [
    seedRecord(today, [seedExercise("Supino", [seedLog({ reps: "10", load: "40 kg" })])]),
    seedRecord(dayOffset(-1), [seedExercise("Remada", [seedLog({ reps: "10", load: "20 kg" })])]),
    seedRecord(dayOffset(-8), [seedExercise("Supino", [seedLog({ reps: "8", load: "30 kg" })])])
  ];

  const app = await boot({ "forja-treino-historico-v1": records }, "progresso/index.html");
  await wait(20);

  app.$('#period-control [data-value="week"]').click();
  await wait(20);

  const compare = app.text("#progress-compare");
  assert.match(compare, /Treinos/);
  assert.match(compare, /Séries concluídas/);
  assert.match(compare, /agora · .* antes/);
  assert.match(app.text("#compare-scope-note"), /comparado com semana anterior/);

  /* Antes de qualquer confirmação, a chave de metas não pode ser criada. */
  assert.equal(app.raw("forja-treino-metas-v1"), null, "Abrir a página gravou metas");
  assert.match(app.text("#goals-progress"), /Nenhuma meta ativa/);

  app.$("#goal-sessions").value = "2";
  app.$("#goal-sets").value = "4";
  app.$("#goal-minutes").value = "10";
  app.$("#goal-modality").value = "all";
  app.$("#goals-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);

  const saved = app.data("forja-treino-metas-v1");
  assert.ok(saved, "Metas não foram gravadas");
  assert.equal(saved.weeklySessions, 2);
  assert.equal(saved.weeklySets, 4);
  assert.equal(saved.weeklyMinutes, 10);
  assert.equal(typeof saved.updatedAt, "string");
  assert.equal(app.$$("#goals-progress .ui-ring").length, 3, "Metas ativas não viraram anéis");
  assert.match(app.text("#goals-progress"), /2\/2/);

  /* Recarregar mantém metas e mostra o progresso calculado da semana. */
  await app.reload();
  await wait(30);
  assert.equal(app.$("#goal-sessions").value, "2");
  assert.equal(app.$$("#goals-progress .ui-ring").length, 3);
  assert.match(app.text("#goals-progress"), /Meta batida/);

  /* Entrada inválida não grava e explica o motivo. */
  const before = app.raw("forja-treino-metas-v1");
  app.$("#goal-sessions").value = "2.5";
  app.$("#goals-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  assert.equal(app.$("#goals-error").hidden, false, "Meta fracionada não avisou");
  assert.equal(app.raw("forja-treino-metas-v1"), before, "Meta inválida alterou o armazenamento");

  /* Alvo 0 desliga tudo, mas continua salvo (sem meta padrão escondida). */
  app.$("#goal-sessions").value = "0";
  app.$("#goal-sets").value = "0";
  app.$("#goal-minutes").value = "0";
  app.$("#goals-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);
  assert.equal(app.data("forja-treino-metas-v1").weeklySessions, 0);
  assert.match(app.text("#goals-progress"), /Nenhuma meta ativa/);

  assertNoErrors(app, "comparação e metas");
  app.close();
});

await runTest("38. Progresso: busca, status e período no histórico; abrir a tela não grava nada", async () => {
  const records = [
    seedRecord(dayOffset(-1), [seedExercise("Supino inclinado", [seedLog({ reps: "8", load: "40 kg" })])], {
      routineName: "Peito e ombro", status: "completed",
      feedback: { rpe: 8, note: "Ombro esquerdo sensível" }
    }),
    seedRecord(dayOffset(-2), [seedExercise("Remada curvada", [seedLog({ reps: "10", load: "30 kg" })])], {
      routineName: "Costas", status: "partial"
    }),
    seedRecord(dayOffset(-40), [seedExercise("Supino inclinado", [seedLog({ reps: "8", load: "35 kg" })])], {
      routineName: "Peito antigo", status: "completed"
    })
  ];

  const app = await boot({ "forja-treino-historico-v1": records }, "progresso/index.html");
  await wait(20);

  const before = storageSnapshot(app);
  assert.equal(app.$$("#progress-history .history-item").length, 3);

  const search = app.$("#history-search");
  search.value = "SUPINO";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  await wait(20);
  assert.equal(app.$$("#progress-history .history-item").length, 2, "Busca sem acento/caixa não filtrou");
  assert.match(app.text("#history-filter-count"), /2 de 3 treino/);

  search.value = "sensivel";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  await wait(20);
  assert.equal(app.$$("#progress-history .history-item").length, 1, "Nota da sessão não entrou na busca");
  assert.match(app.text("#progress-history"), /Ombro esquerdo sensível/);

  search.value = "";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  app.$("#history-status").value = "partial";
  app.$("#history-status").dispatchEvent(new app.w.Event("change", { bubbles: true }));
  await wait(20);
  assert.equal(app.$$("#progress-history .history-item").length, 1);
  assert.match(app.text("#progress-history"), /Parcial/);

  app.click("#history-clear");
  await wait(20);
  assert.equal(search.value, "");
  assert.equal(app.$("#history-status").value, "all");
  assert.equal(app.$$("#progress-history .history-item").length, 3);

  /* Semana não contém o treino antigo: busca vazia explica o filtro. */
  app.$('#period-control [data-value="week"]').click();
  await wait(20);
  search.value = "peito antigo";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  await wait(20);
  assert.equal(app.$$("#progress-history .history-item").length, 0);
  assert.match(app.text("#progress-history"), /Nenhum treino corresponde à busca/);

  assert.deepEqual(storageSnapshot(app), before, "Navegar/filtrar a tela gravou dados");
  assertNoErrors(app, "busca no histórico");
  app.close();
});

await runTest("39. Progresso: limite de 200 registros e dados antigos sem totals", async () => {
  /* 205 registros: a página só conta os 200 que o app mantém. */
  const many = [];
  for (let index = 0; index < 205; index += 1) {
    many.push(seedRecord(dayOffset(-index), [seedExercise("Supino", [seedLog({ reps: "10", load: "10 kg" })])]));
  }

  const app = await boot({ "forja-treino-historico-v1": many }, "progresso/index.html");
  await wait(30);
  assert.equal(app.text("#progress-sessions"), "200", "A página ignorou o limite do histórico");
  assert.equal(app.$("#progress-limit-note").hidden, false, "Limite cheio não foi avisado");
  assert.match(app.text("#progress-limit-note"), /até 200 treinos/);
  assert.match(app.text("#history-filter-count"), /200 treino/);
  app.close();

  /* Registro antigo, sem `totals`, com carga ilegível e distância em km. */
  const legacy = {
    id: "legado-etapa5",
    date: keyOf(dayOffset(-10)),
    modality: "weights",
    routineName: "Treino antigo",
    durationMs: 20 * 60000,
    completedSets: 2,
    totalPlannedSets: 3,
    status: "partial",
    exercises: [
      seedExercise("Remada", [
        seedLog({ reps: "10", load: "40 kg" }),
        seedLog({ set: 2, reps: "10", load: "pesado" })
      ]),
      seedExercise("Caminhada", [seedLog({ distance: 1.2 })], { distanceUnit: "km", measure: "distance" })
    ]
  };

  const old = await boot({ "forja-treino-historico-v1": [legacy] }, "progresso/index.html");
  await wait(20);

  const values = old.$$("#progress-totals .ui-stat-value").map(node => node.textContent);
  const labels = old.$$("#progress-totals .ui-stat-label").map(node => node.textContent);
  assert.equal(values[labels.indexOf("volume com carga")], "400 kg", "Volume derivado das séries antigas está errado");
  assert.equal(values[labels.indexOf("distância")], "1,2 km", "Distância antiga não foi convertida");
  assert.equal(values[labels.indexOf("repetições")], "20", "Repetições antigas não foram somadas");
  assert.match(old.text("#progress-measure-note"), /1 série ficou fora do volume/);
  assert.match(old.text('[data-record="load"]'), /40 kg/);
  assert.equal(old.$$('[data-record="time"]').length, 0);
  assert.match(old.text("#progress-history"), /Parcial/);

  assertNoErrors(old, "histórico antigo sem totals");
  old.close();
});

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Etapa 6 — início útil (e refinamento visual)                       */
/* ------------------------------------------------------------------ */

/*
  Registro de histórico com `totals` explícitos. Os testes da home usam este
  construtor para provar que o painel lê `F.metricas`, não números inventados.
*/
function homeRecord(date, extra = {}) {
  const completedSets = extra.completedSets === undefined ? 3 : extra.completedSets;
  const totalPlannedSets = extra.totalPlannedSets === undefined ? completedSets : extra.totalPlannedSets;

  return Object.assign({
    id: "home-" + Math.random().toString(36).slice(2, 9),
    date: keyOf(date),
    finishedAt: date.toISOString(),
    modality: "weights",
    routineName: "Treino registrado",
    durationMs: 30 * 60000,
    completedSets,
    totalPlannedSets,
    status: completedSets >= totalPlannedSets ? "completed" : "partial",
    exercises: [],
    totals: {
      volumeKg: 0,
      reps: 0,
      seconds: 0,
      distanceMeters: 0,
      setsLogged: completedSets,
      setsWithoutVolume: 0
    }
  }, extra);
}

/* Hoje e a segunda-feira da semana corrente: sempre dentro da semana atual. */
function thisMonday() {
  const monday = startOfWeek(dayOffset(0));
  monday.setHours(12, 0, 0, 0);
  return monday;
}

function previousMonday() {
  const date = thisMonday();
  date.setDate(date.getDate() - 7);
  return date;
}

function homeWeek(app) {
  const values = app.$$("#home-week-body .home-metric-value").map(node => node.textContent);
  const labels = app.$$("#home-week-body .home-metric-label").map(node => node.textContent);
  return { values, labels, at: label => values[labels.indexOf(label)] };
}

await runTest("42. Início sem dados: uma ação clara, estados vazios compactos e nada inventado", async () => {
  const app = await boot({}, "index.html");
  await wait(20);

  /*
    Nível 1: sem rotina, a única ação primária é abrir a área de treino — o
    mesmo elemento `a.treino-square`, sem um segundo CTA concorrente.
  */
  const square = app.$("a.treino-square");
  assert.ok(square, "Ação de treino ausente");
  assert.equal(square.classList.contains("is-primary"), true, "A ação única deveria estar destacada");
  assert.equal(square.getAttribute("href"), "treino/index.html");
  assert.equal(app.$$(".home-action .primary-button").length, 0, "Há dois CTAs principais na home vazia");

  /* Orientação: uma frase curta integrada à ação, não um painel. */
  assert.equal(app.$("#home-guide").hidden, false, "Frase de orientação ausente");
  assert.match(app.text("#home-guide"), /Primeira vez aqui\?/);
  assert.match(app.text("#home-guide"), /sem cadastro/);
  assert.equal(app.$$(".home-step").length, 0, "Painel de passos não deve existir");

  /* Nível 2: uma linha, sem números fabricados nem metas padrão. */
  assert.match(app.text("#home-week-body"), /Nenhum treino registrado ainda/);
  assert.equal(app.$$("#home-week-body .home-metric").length, 0, "Sem histórico não pode haver métrica");
  assert.equal(app.$$("#home-week-body .home-goal").length, 0, "Meta padrão escondida apareceu");
  assert.match(app.text("#home-week-range"), /^\d{2}\/\d{2} – \d{2}\/\d{2}$/);
  assert.ok(app.$('.home-block a[href="progresso/index.html"]'), "Falta link para Progresso");

  /* Nível 3: histórico compacto e vazio de verdade. */
  assert.match(app.text("#home-recent-body"), /Seus treinos aparecem aqui depois do primeiro registro/);
  assert.equal(app.$$("#home-recent-body .home-history-item").length, 0);

  /* Uma única seção de treino: nada de repetir o atalho no fim da página. */
  assert.equal(app.$$("a.treino-square").length, 1, "O acesso ao treino foi duplicado");
  assert.equal(app.$$(".treino-cta").length, 0, "Bloco de treino duplicado no fim da home");

  /* Nada foi gravado por abrir a home. */
  assert.deepEqual(app.keys(), [], "Abrir a home sem dados gravou chaves: " + app.keys().join(", "));

  assertNoErrors(app, "início vazio");
  app.close();
});

await runTest("43. Início destaca a rotina real mais recente e inicia pelo fluxo existente", async () => {
  const cal = makeRoutine("calisthenics", "Empurrar", [
    { name: "Flexão", section: "main", sets: 3, reps: "10", id: "h-cal-1" },
    { name: "Prancha", section: "abs", type: "duration", sets: 2, duration: 30, id: "h-cal-2" }
  ], "home-cal");
  const weights = makeRoutine("weights", "Puxar", [
    { name: "Remada", section: "main", sets: 4, reps: "8", load: "30 kg", id: "h-weights-1" }
  ], "home-weights");

  /* Puxar foi treinada ontem: é ela que o topo deve sugerir. */
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([cal], [weights]),
    "forja-treino-historico-v1": [homeRecord(dayOffset(-1), {
      routineId: "home-weights",
      routineName: "Puxar",
      modality: "weights"
    })]
  }, "index.html");
  await wait(20);

  const primary = app.$(".home-action .primary-button");
  assert.ok(primary, "Sem ação primária de iniciar rotina");
  assert.match(primary.textContent, /Iniciar Puxar/, "A rotina sugerida não é a mais recente");
  assert.match(app.text(".home-action-meta"), /Musculação/);
  assert.match(app.text(".home-action-meta"), /1 exercício/);
  assert.match(app.text(".home-action-meta"), /última vez ontem/);

  /* Uma ação primária só; o acesso à área de treino fica secundário. */
  assert.equal(app.$$(".home-action .primary-button").length, 1, "Mais de uma ação primária");
  const square = app.$("a.treino-square");
  assert.equal(square.classList.contains("is-primary"), false, "Dois CTAs disputando destaque");
  assert.equal(square.hidden, false, "Acesso à área de treino sumiu");

  /* Com histórico, a frase de orientação sai de cena. */
  assert.equal(app.$("#home-guide").hidden, true, "Orientação não deveria aparecer com histórico");

  /* Iniciar usa o fluxo existente e a rotina correta. */
  app.click(primary);
  await pageIs(app, "executar");
  const session = app.F.state.activeWorkout;
  assert.ok(session, "Iniciar pela home não criou sessão ativa");
  assert.equal(session.routineName, "Puxar");
  assert.equal(session.modality, "weights");

  assertNoErrors(app, "rotina destacada");
  app.close();
});

await runTest("43b. Nome de rotina é texto, nunca HTML injetado na home", async () => {
  const hostile = makeRoutine("weights", "<img src=x onerror=alert(1)>Supino", [
    { name: "Supino", section: "main", sets: 1, reps: "10", id: "x-1" }
  ], "hostile");

  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([], [hostile]),
    "forja-treino-historico-v1": [homeRecord(dayOffset(0), {
      routineName: hostile.name,
      routineId: hostile.id,
      modality: "weights"
    })]
  }, "index.html");
  await wait(20);

  assert.equal(app.$$("main img").length, 0, "Nome de rotina virou marcação no botão");
  assert.equal(app.$$("#home-recent-body img").length, 0, "Nome de rotina virou marcação no histórico");
  assert.match(app.text(".home-action .primary-button"), /<img src=x onerror=alert\(1\)>Supino/);
  assert.match(app.text("#home-recent-body .home-history-name"), /<img src=x onerror=alert\(1\)>Supino/);

  assertNoErrors(app, "escape na home");
  app.close();
});

await runTest("44. Resumo semanal usa histórico real, inclui parciais e ignora a semana passada", async () => {
  const today = dayOffset(0);
  const monday = thisMonday();
  const old = previousMonday();

  const records = [
    homeRecord(today, {
      routineName: "Peito",
      completedSets: 3,
      totalPlannedSets: 3,
      durationMs: 30 * 60000,
      totals: { volumeKg: 300, reps: 30, seconds: 0, distanceMeters: 0, setsLogged: 3, setsWithoutVolume: 0 }
    }),
    homeRecord(monday, {
      routineName: "Pernas",
      completedSets: 2,
      totalPlannedSets: 4,
      durationMs: 20 * 60000,
      totals: { volumeKg: 0, reps: 20, seconds: 0, distanceMeters: 0, setsLogged: 2, setsWithoutVolume: 2 }
    }),
    homeRecord(old, {
      routineName: "Semana passada",
      completedSets: 5,
      totalPlannedSets: 5,
      durationMs: 45 * 60000,
      totals: { volumeKg: 999, reps: 50, seconds: 0, distanceMeters: 0, setsLogged: 5, setsWithoutVolume: 0 }
    })
  ];

  const app = await boot({ "forja-treino-historico-v1": records }, "index.html");
  await wait(20);

  const week = homeWeek(app);
  assert.equal(week.values.length, 3, "O resumo deve ter exatamente três métricas");
  assert.equal(week.at("treinos"), "2", "Treinos da semana errados (a semana passada não conta)");
  assert.equal(week.at("séries"), "5", "Séries da semana erradas");
  assert.equal(week.at("tempo"), "50 min", "Tempo da semana errado");
  assert.match(app.text(".home-week-note"), /1 treino parcial/, "Registro parcial não foi declarado");
  assert.match(app.text(".home-week-note"), /300 kg de volume/);
  assert.doesNotMatch(app.text(".home-week-note"), /999/, "Dado de fora da semana vazou para o resumo");

  /* Registro sem duração não vira "0 min": o tempo fica indisponível. */
  const noTime = await boot({ "forja-treino-historico-v1": [homeRecord(today, { durationMs: 0 })] }, "index.html");
  await wait(20);
  assert.equal(homeWeek(noTime).at("tempo"), "—", "Tempo ausente virou zero");
  assert.match(noTime.text(".home-week-note"), /tempo não registrado/);
  noTime.close();

  /* Histórico existe, mas a semana está vazia: zero real, com explicação. */
  const emptyWeek = await boot({ "forja-treino-historico-v1": [homeRecord(old)] }, "index.html");
  await wait(20);
  assert.equal(homeWeek(emptyWeek).at("treinos"), "0");
  assert.match(emptyWeek.text(".home-week-note"), /Nenhum treino nesta semana ainda/);
  emptyWeek.close();

  assertNoErrors(app, "resumo semanal");
  app.close();
});

await runTest("45. Metas: barras só quando configuradas, alinhadas ao resumo da semana", async () => {
  const today = dayOffset(0);
  const monday = thisMonday();
  const history = [
    homeRecord(today, { completedSets: 2, totalPlannedSets: 2, durationMs: 30 * 60000 }),
    homeRecord(monday, { completedSets: 3, totalPlannedSets: 3, durationMs: 20 * 60000 })
  ];

  const withGoals = await boot({
    "forja-treino-historico-v1": history,
    "forja-treino-metas-v1": {
      version: 1,
      updatedAt: new Date().toISOString(),
      modality: "all",
      weeklySessions: 3,
      weeklySets: 6,
      weeklyMinutes: 60
    }
  }, "index.html");
  await wait(20);

  const goals = withGoals.$$("#home-week-body .home-goal");
  assert.equal(goals.length, 3, "Metas ativas não apareceram na home");
  const goalText = withGoals.text("#home-week-body .home-goals");
  assert.match(goalText, /2\/3/, "Meta de treinos com valor errado");
  assert.match(goalText, /5\/6/, "Meta de séries com valor errado");
  assert.match(goalText, /50\/60/, "Meta de minutos com valor errado");
  assert.match(goalText, /0\/3 metas batidas/);

  /* Barra acessível com o valor real e largura correspondente. */
  const bars = withGoals.$$("#home-week-body .home-goal-bar");
  assert.equal(bars.length, 3);
  assert.equal(bars[0].getAttribute("role"), "progressbar");
  assert.equal(bars[0].getAttribute("aria-valuenow"), "67");
  assert.match(bars[0].getAttribute("aria-label"), /Treinos da semana: 2 de 3/);
  assert.match(withGoals.$$("#home-week-body .home-goal-fill")[0].getAttribute("style"), /67%/);
  withGoals.close();

  /* Meta batida aparece como batida, não como "0%". */
  const met = await boot({
    "forja-treino-historico-v1": history,
    "forja-treino-metas-v1": { weeklySessions: 2, modality: "all" }
  }, "index.html");
  await wait(20);
  assert.match(met.text("#home-week-body .home-goals"), /1\/1 metas batidas/);
  met.close();

  /* Sem metas não há bloco nem texto extra: a página fica mais curta. */
  const withoutGoals = await boot({ "forja-treino-historico-v1": history }, "index.html");
  await wait(20);
  assert.equal(withoutGoals.$$("#home-week-body .home-goal").length, 0, "Metas apareceram sem configuração");
  assert.equal(withoutGoals.$("#home-week-body .home-goals"), null, "Bloco de metas vazio ocupando espaço");
  assert.doesNotMatch(withoutGoals.text("#home-week-body"), /meta/i);

  assertNoErrors(withoutGoals, "metas na home");
  withoutGoals.close();
});

await runTest("46. Histórico recente: três linhas compactas, ordenadas por data real", async () => {
  const days = [3, 1, 0, 1];
  const names = ["Terça", "Ontem", "Hoje", "Outro ontem"];
  const records = days.map((offset, index) => homeRecord(dayOffset(-offset), {
    routineName: names[index],
    modality: index % 2 === 0 ? "weights" : "calisthenics",
    completedSets: index === 1 ? 1 : 2,
    totalPlannedSets: 2
  }));

  /* Registro sem data legível não pode ser inventado no topo da lista. */
  records.push({
    id: "sem-data",
    date: "31/02/2025",
    modality: "weights",
    routineName: "Sem data",
    durationMs: 0,
    completedSets: 1,
    totalPlannedSets: 1,
    status: "completed",
    exercises: []
  });

  const app = await boot({ "forja-treino-historico-v1": records }, "index.html");
  await wait(20);

  const items = app.$$("#home-recent-body .home-history-item");
  const shown = items.map(node => node.querySelector(".home-history-name").textContent);

  assert.equal(items.length, 3, "O histórico da home deve mostrar no máximo três registros");
  assert.deepEqual(shown, ["Hoje", "Ontem", "Outro ontem"],
    "Ordem do histórico recente errada: " + shown.join(" | "));

  const first = items[0];
  assert.match(first.textContent, /Musculação/);
  assert.match(first.textContent, /Concluído/);
  assert.match(first.textContent, /\d{2}\/\d{2}\/d{2}|\d{2}\/\d{2}/);
  assert.match(first.textContent, /2\/2 séries/);

  /* A parcial preserva o status real, não "concluído". */
  assert.match(items[1].textContent, /Parcial/);
  assert.match(items[1].textContent, /1\/2 séries/);
  assert.match(items[1].textContent, /Calistenia/);

  /* Nenhum cartão grande: a lista é uma sequência de linhas. */
  assert.equal(app.$$("#home-recent-body .home-history-item .routine-card").length, 0);
  assert.ok(app.$('.home-block a[href="progresso/index.html"]'), "Falta acesso ao histórico completo");

  assertNoErrors(app, "histórico recente");
  app.close();

  /* Registro sem data legível: fica no fim, não no topo. */
  const undated = await boot({ "forja-treino-historico-v1": records }, "index.html");
  await wait(20);
  const undatedNames = undated.$$("#home-recent-body .home-history-name").map(node => node.textContent);
  assert.ok(undatedNames.indexOf("Sem data") === -1 || undatedNames.indexOf("Sem data") === undatedNames.length - 1,
    "Registro sem data apareceu fora do fim da lista");
  undated.close();
});

await runTest("47. Sessão ativa: o banner é a ação de retomada, sem duplicar CTA na home", async () => {
  const routine = sampleRoutine("calisthenics", "home-active");
  const session = sessionSeed(routine, { id: "home-session", routineName: "Treino A" });

  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": session
  }, "index.html", { now: 5_000_000 });
  await wait(20);

  /* Um único caminho de retomada, no topo, com as duas ações reais. */
  const banner = app.$("#active-session-banner");
  assert.equal(banner.hidden, false, "Banner de sessão ativa não apareceu");
  assert.match(app.text("#active-session-summary"), /Calistenia · Treino A/);
  const resume = app.$("#resume-active-session");
  assert.equal(resume.getAttribute("href"), "treino/executar.html");
  const end = app.$("#end-active-session");
  assert.match(end.getAttribute("href"), /encerrar=1/);

  /* O bloco de treino se retira: nada de um segundo "Iniciar/Retomar". */
  assert.equal(app.$("#home-action").hidden, true, "Ação duplicada com a sessão ativa");
  assert.equal(app.$$(".home-action .primary-button").length, 0, "Botão de iniciar durante sessão ativa");
  assert.match(app.text("#home-guide"), /retome pelo aviso acima/);

  app.click(resume);
  await pageIs(app, "executar");
  assert.equal(app.F.state.activeWorkout.id, "home-session", "A retomada perdeu a sessão");
  assertNoErrors(app, "sessão ativa na home");
  app.close();
});

await runTest("48. Home se atualiza quando os dados mudam (sem recarregar a página)", async () => {
  const routine = makeRoutine("weights", "Full body", [
    { name: "Agachamento", section: "main", sets: 3, reps: "10", id: "upd-1" }
  ], "upd-routine");

  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([], [routine])
  }, "index.html");
  await wait(20);

  assert.match(app.text("#home-week-body"), /Nenhum treino registrado ainda/);
  assert.match(app.text(".home-action .primary-button"), /Iniciar Full body/);
  assert.equal(app.$("#home-guide").hidden, false, "Primeiro treino deve explicar o próximo passo");

  /* 1. Metas salvas por qualquer tela do app atualizam o painel. */
  assert.ok(app.F.saveGoals({ weeklySessions: 2 }), "Não foi possível gravar as metas");
  await wait(20);
  assert.equal(app.$$("#home-week-body .home-goal").length, 1, "Meta nova não redesenhou a home");
  assert.match(app.text("#home-week-body .home-goal-value"), /0\/2/);

  /* 2. Um treino registrado atualiza semana, histórico e orientação. */
  const record = homeRecord(dayOffset(0), { routineName: "Full body", routineId: routine.id });
  app.F.state.history.unshift(record);
  assert.ok(app.F.saveJSON(app.F.KEYS.history, app.F.state.history), "Não foi possível gravar o histórico");
  await wait(20);

  assert.equal(homeWeek(app).at("treinos"), "1");
  assert.equal(homeWeek(app).at("séries"), "3");
  assert.equal(app.$$("#home-recent-body .home-history-item").length, 1, "Histórico novo não apareceu");
  assert.equal(app.$("#home-guide").hidden, true, "Orientação inicial deveria sair depois do primeiro treino");
  assert.match(app.text("#home-week-body .home-goal-value"), /1\/2/);

  /* 3. Trocar de rotina recente muda a ação principal sem recarregar. */
  const other = makeRoutine("calisthenics", "Barra", [
    { name: "Barra fixa", section: "main", sets: 3, reps: "6", id: "upd-2" }
  ], "upd-routine-2");
  app.F.state.routines.calisthenics.push(other);
  assert.ok(app.F.saveRoutines(), "Não foi possível gravar a rotina nova");
  await wait(20);
  assert.match(app.text(".home-action .primary-button"), /Iniciar (Full body|Barra)/);

  /* 4. Atualizar o painel é sempre leitura: nada de gravação ociosa. */
  const before = storageSnapshot(app);
  app.F.home.refresh();
  app.F.home.refresh();
  await wait(20);
  assert.deepEqual(storageSnapshot(app), before, "Redesenhar a home gravou no armazenamento");

  assertNoErrors(app, "atualização da home");
  app.close();
});

await runTest("49. Navegar pela home e redesenhar não grava nada", async () => {
  const routine = makeRoutine("calisthenics", "Base", [
    { name: "Flexão", section: "main", sets: 2, reps: "10", id: "nav-1" }
  ], "nav-routine");

  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-historico-v1": [homeRecord(dayOffset(0))],
    "forja-treino-metas-v1": { weeklySessions: 3, modality: "all" }
  }, "index.html");
  await wait(20);

  const before = storageSnapshot(app);
  app.click("#next-month");
  await wait(15);
  app.click("#prev-month");
  await wait(15);
  app.F.home.refresh();
  await wait(15);
  assert.deepEqual(storageSnapshot(app), before, "Abrir/navegar/atualizar a home gravou algo");

  /* Navegação real para Progresso e volta: nenhuma chave muda. */
  app.click('.home-block a[href="progresso/index.html"]');
  await pageIs(app, "progresso");
  await wait(30);
  assert.deepEqual(storageSnapshot(app), before, "Ir ao Progresso a partir da home gravou algo");

  await app.go(BASE + "index.html");
  await pageIs(app, "inicio");
  await wait(30);
  assert.deepEqual(storageSnapshot(app), before, "Voltar para a home gravou algo");

  assertNoErrors(app, "navegação sem gravação");
  app.close();
});

await runTest("50. Home preserva calendário, missões e o acesso ao treino", async () => {
  const today = todayKey();
  const app = await boot({
    "forja-treino-historico-v1": [homeRecord(dayOffset(0))],
    ["forja-missoes-" + today]: [{ id: "m1", text: "Beber água", done: false }]
  }, "index.html");
  await wait(20);

  /* Calendário e missões intactos, mesmo com o painel novo acima. */
  assert.ok(app.$$(".calendar-grid .day").length >= 28, "Calendário não renderizou");
  assert.equal(app.text("#progress-label"), "0 de 1 · 0%");
  assert.match(app.text("#task-list"), /Beber água/);

  app.$("#task-input").value = "Treinar cedo";
  app.$("#task-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  assert.equal(app.data("forja-missoes-" + today).length, 2);
  app.click("#task-list .task input[type=checkbox]");
  await wait(20);
  assert.equal(app.text("#progress-label"), "1 de 2 · 50%", "Concluir missão não atualizou o progresso");

  const title = app.text("#month-title");
  app.click("#next-month");
  await wait(15);
  assert.notEqual(app.text("#month-title"), title);
  app.click("#prev-month");
  await wait(15);
  assert.equal(app.text("#month-title"), title);

  /* Calendário e missões ficam visivelmente abaixo do treino (hierarquia). */
  const order = app.$$("main section, main header").map(node => node.id || node.className);
  const trainIndex = order.findIndex(entry => /home-top/.test(entry));
  const calendarIndex = order.findIndex(entry => /home-block-quiet/.test(entry));
  assert.ok(trainIndex >= 0 && calendarIndex > trainIndex, "Treino deveria vir antes de calendário/missões");

  /* Acesso à área de treino continua na home, uma vez só. */
  assert.equal(app.$$("a.treino-square").length, 1, "Ação TREINO duplicada ou ausente");
  /* Sem rotinas a frase continua útil — mas não trata quem já treinou como novato. */
  assert.match(app.text("#home-guide"), /ainda não tem rotinas/);
  assert.doesNotMatch(app.text("#home-guide"), /Primeira vez aqui/);

  assertNoErrors(app, "calendário preservado");
  app.close();
});

/* ------------------------------------------------------------------ */

const failed = results.filter(result => !result.ok);

console.log("\n" + "=".repeat(66));
console.log("FORJA — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
if (failed.length > 0) {
  console.log("Falhas: " + failed.map(item => item.name).join(" | "));
}
console.log("=".repeat(66));

process.exitCode = failed.length > 0 ? 1 : 0;
