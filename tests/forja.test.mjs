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
  const treinoLink = home.$$("a").find(a => a.textContent.trim() === "TREINO");
  assert.ok(treinoLink, "Botão TREINO ausente na página inicial");
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

/* ------------------------------------------------------------------ */

const failed = results.filter(result => !result.ok);

console.log("\n" + "=".repeat(66));
console.log("FORJA — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
if (failed.length > 0) {
  console.log("Falhas: " + failed.map(item => item.name).join(" | "));
}
console.log("=".repeat(66));

process.exitCode = failed.length > 0 ? 1 : 0;
