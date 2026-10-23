/*
  Suíte de testes do FORJA (jsdom, multipágina).

  Executa as páginas reais do repositório (index.html, treino/, progresso/,
  perfil/, configuracoes/, explorar/) com o mesmo JavaScript que roda no
  navegador. Cada teste corresponde a um critério de aceite ou a um requisito
  de execução.

  Uso: npm install && npm test
*/

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import jsdomPkg from "jsdom";
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
import { installFailingStorage } from "./helpers/legacy-flows.mjs";

const { JSDOM } = jsdomPkg;

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
  "perfil/index.html",
  "configuracoes/index.html",
  "explorar/index.html",
  "explorar/atlas.html"
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
  // Home simplificada: ação principal única (#home-primary-button + .treino-square para compatibilidade).
  const primary = home.$("#home-primary-button") || home.$("#home-action .treino-square") || home.$("#home-action a") || home.$("a.treino-square");
  assert.ok(primary, "Ação principal ausente na home");
  const txt = primary.textContent.trim();
  assert.match(txt, /(Montar meu treino|Iniciar)/i, "Texto da ação principal inesperado: " + txt);
  if (primary.tagName.toLowerCase() === "a") {
    assert.equal(primary.getAttribute("href"), "treino/index.html");
  } else {
    assert.equal(primary.getAttribute("aria-label")?.includes("Iniciar") || primary.textContent.includes("Iniciar"), true, "Botão Iniciar sem aria-label correto");
  }
  // Garantir que não há ação duplicada visível quando não há sessão ativa (uma única .home-action-button)
  const actions = home.$$("#home-action .home-action-button");
  assert.equal(actions.length, 1, "Deveria haver exatamente 1 ação principal na home");
  // Para hub, usa o link Montar quando for âncora; se for botão (com rotina), navega direto ao hub via bottom-nav como fallback
  const toClick = primary.tagName.toLowerCase() === "a" ? primary : home.$('a.bottom-nav-link[data-nav="treino"]') || home.$('a[href="treino/index.html"]');
  assert.ok(toClick, "Link para Treinos não encontrado");
  home.click(toClick);
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
  assert.match(css, /\.bottom-nav-inner[\s\S]*repeat\(5, minmax\(0, 1fr\)\)/, "Barra inferior deve ter 5 colunas");
  assert.match(css, /\.hub-list \{[^}]*display: grid/);
  assert.match(css, /\.big-set-button/);
  // Barra não pode cobrir conteúdo: padding inferior + safe-area
  assert.match(css, /padding-bottom:\s*calc\(var\(--bottom-nav-height\)/);
  // prefers-reduced-motion deve ser respeitado (pode estar em performance.css)
  const allCss = css + fs.readFileSync(path.join(repoRoot, "assets/css/performance.css"), "utf8") + fs.readFileSync(path.join(repoRoot, "assets/css/app.css"), "utf8");
  assert.match(allCss, /prefers-reduced-motion/);
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


await runTest("40. Home: uma única ação principal por estado", async () => {
  // Estado vazio -> Montar meu treino (link)
  const empty = await boot({}, "index.html");
  const actionEmpty = empty.$("#home-action");
  assert.ok(actionEmpty, "#home-action ausente");
  assert.equal(actionEmpty.hidden, false, "Ação deveria estar visível quando não há sessão");
  const btnEmpty = empty.$("#home-primary-button");
  assert.ok(btnEmpty, "Botão primário ausente no estado vazio");
  assert.match(btnEmpty.textContent, /Montar meu treino/);
  assert.equal(btnEmpty.tagName.toLowerCase(), "a");
  assert.equal(btnEmpty.getAttribute("href"), "treino/index.html");
  // Garantir que há apenas um botão/link visível na home-action
  assert.equal(empty.$$("#home-action .home-action-button").length, 1, "Deveria haver exatamente 1 ação principal no vazio");
  assert.equal(empty.$$("#home-action [hidden]").length, 0, "Nada deve estar hidden quando não há sessão");
  empty.close();

  // Com rotina real -> Iniciar Treino (button)
  const routine = makeRoutine("calisthenics", "Rotina Teste", [{ name: "Flexão", section: "main", sets: 2, reps: "10", id: "m1" }], "rt1");
  const withRoutine = await boot({ "forja-treino-rotinas-v1": routinesStore([routine], []) }, "index.html");
  const btnRoutine = withRoutine.$("#home-primary-button");
  assert.ok(btnRoutine, "Botão Iniciar ausente quando há rotina");
  assert.match(btnRoutine.textContent, /Iniciar Rotina Teste/);
  assert.equal(btnRoutine.tagName.toLowerCase(), "button");
  assert.equal(withRoutine.$$("#home-action .home-action-button").length, 1, "Deveria haver exatamente 1 botão Iniciar");
  withRoutine.close();
});

await runTest("41. Home: com sessão ativa a ação principal some e só o banner permite retomar", async () => {
  const routine = makeRoutine("calisthenics", "Ativa", [{ name: "Flex", section: "main", sets: 1, reps: "10", id: "a1" }], "r2");
  const sess = sessionSeed(routine, { id: "s-active" });
  const app = await boot({ "forja-treino-rotinas-v1": routinesStore([routine], []), "forja-treino-sessao-ativa-v1": sess }, "index.html");
  const container = app.$("#home-action");
  assert.ok(container, "#home-action ausente");
  assert.equal(container.hidden, true, "#home-action deveria estar hidden com sessão ativa");
  assert.equal(container.getAttribute("hidden"), "", "deveria ter atributo hidden");
  assert.equal(app.$("#home-primary-button"), null, "Botão primário não deve existir quando sessão está ativa");
  assert.equal(app.$("#active-session-banner").hidden, false, "Banner de sessão deveria estar visível");
  assert.ok(app.$("#resume-active-session"), "Link Retomar ausente");
  app.close();
});

await runTest("42. Home simplificada: hierarquia curta e dados reais", async () => {
  const app = await boot({}, "index.html");
  assert.ok(app.$("#home-greeting") || app.$(".home-greeting"), "Saudação ausente");
  assert.ok(app.$("#home-action-heading"), "Heading da ação ausente");
  assert.ok(app.$("#home-week") || app.$(".home-week"), "Resumo semanal ausente");
  assert.ok(app.$("#home-recent") || app.$(".home-recent"), "Último treino compacto ausente");
  assert.ok(app.$("#home-week-stats"), "Stats da semana ausentes");
  assert.ok(app.$("#home-recent-list"), "Lista recente ausente");
  // Calendário e missões devem existir mas não competir visualmente (são secundários)
  assert.ok(app.$(".calendar-panel"), "Calendário ausente");
  assert.ok(app.$(".missions-panel"), "Missões ausentes");
  assert.equal(app.$(".home-secondary") !== null, true, "Secundários deveriam estar agrupados");
  // Estado vazio honesto: sem treinos, mensagem não inventa métrica
  assert.match(app.text("#home-week-note"), /Sem treinos nesta semana ainda/);
  assert.match(app.text("#home-recent-note"), /Nenhum treino registrado ainda/);
  assert.ok(!/streak|sequência|%/.test(app.text("#home-week")), "Métrica inventada na semana");
  app.close();

  // Com histórico real, a semana reflete o tempo real
  const today = new Date();
  const rec = { id: "h1", date: today.toISOString().slice(0,10), modality: "calisthenics", routineName: "Teste", durationMs: 60000, completedSets: 2, totalPlannedSets: 2, status: "completed", finishedAt: today.toISOString(), exercises: [] };
  const app2 = await boot({ "forja-treino-historico-v1": [rec] }, "index.html");
  assert.match(app2.text("#home-week-note"), /1 treino/);
  assert.match(app2.text("#home-recent-list"), /Teste/);
  app2.close();
});

await runTest("43. Barra inferior fixa: 5 itens, aria-current, safe-area e não cobre conteúdo", async () => {
  for (const page of PAGES) {
    const app = await boot({}, page);
    const nav = app.$(".bottom-nav");
    assert.ok(nav, "bottom-nav ausente em " + page);
    const links = app.$$(".bottom-nav-link");
    assert.equal(links.length, 5, "Deveria haver 5 itens na barra em " + page);
    const labels = links.map(a => a.textContent.trim());
    assert.ok(labels.some(t => /Início/.test(t)), "Início ausente em " + page);
    assert.ok(labels.some(t => /Treinos/.test(t)), "Treinos ausente");
    assert.ok(labels.some(t => /Explorar/.test(t)), "Explorar ausente");
    assert.ok(labels.some(t => /Progresso/.test(t)), "Progresso ausente");
    assert.ok(labels.some(t => /Perfil/.test(t)), "Perfil ausente");
    assert.equal(app.$$(".bottom-nav-link[aria-current=page]").length, 1, "aria-current ausente ou duplicado em " + page);
    // Ícones presentes
    assert.equal(app.$$(".bottom-nav-icon svg").length, 5, "Ícones ausentes em " + page);
    // Touch target e posição fixa
    const css = fs.readFileSync(path.join(repoRoot, "assets/css/app.css"), "utf8");
    assert.match(css, /\.bottom-nav\s*\{/);
    assert.match(css, /position:\s*fixed/);
    assert.match(css, /env\(safe-area-inset-bottom/);
    app.close();
  }
  const appCss = fs.readFileSync(path.join(repoRoot, "assets/css/app.css"), "utf8");
  assert.match(appCss, /padding-bottom:\s*calc\(var\(--bottom-nav-height\)/);
  // Prefers reduced motion
  assert.match(appCss, /prefers-reduced-motion/);
});

await runTest("44. Links da barra inferior resolvem e perfil/explorar existem", async () => {
  const pagesToCheck = ["index.html", "treino/index.html", "explorar/index.html", "explorar/atlas.html", "progresso/index.html", "perfil/index.html"];
  for (const page of pagesToCheck) {
    const app = await boot({}, page);
    const broken = [];
    app.$$(".bottom-nav-link").forEach(a => {
      const href = a.getAttribute("href");
      const url = new URL(href, app.w.location.href);
      const file = path.join(repoRoot, url.pathname.replace("/forja/", "").replace(/\/$/, "/index.html"));
      if (!fs.existsSync(file)) broken.push(href + " em " + page);
    });
    assert.deepEqual(broken, [], "Links quebrados na bottom-nav: " + broken.join(", "));
    app.close();
  }
  assert.ok(fs.existsSync(path.join(repoRoot, "explorar/index.html")), "explorar/index.html ausente");
  assert.ok(fs.existsSync(path.join(repoRoot, "explorar/atlas.html")), "explorar/atlas.html ausente");
  assert.ok(fs.existsSync(path.join(repoRoot, "perfil/index.html")), "perfil/index.html ausente");
});

/* ------------------------------------------------------------------ */
/* Perfil: dados, backup e preferências do descanso                     */
/* ------------------------------------------------------------------ */

const PREFS_KEY = "forja-preferencias-v1";
const SAFETY_KEY = "forja-backup-seguranca-v1";
const DATA_PAGES = ["perfil/index.html", "configuracoes/index.html"];

/* Cópia no realm do Node: objetos criados no jsdom têm outro protótipo. */
const plain = value => JSON.parse(JSON.stringify(value));

/* Destino esperado da barra inferior em cada página. */
const EXPECTED_NAV = {
  "index.html": "inicio",
  "treino/index.html": "treino",
  "treino/calistenia.html": "treino",
  "treino/musculacao.html": "treino",
  "treino/rotina.html": "treino",
  "treino/executar.html": "treino",
  "treino/biblioteca.html": "explorar",
  "progresso/index.html": "progresso",
  "perfil/index.html": "perfil",
  "configuracoes/index.html": "perfil",
  "explorar/index.html": "explorar",
  "explorar/atlas.html": "explorar"
};

function seedAsStored(seed) {
  return Object.fromEntries(Object.entries(seed).map(([key, value]) => [
    key, typeof value === "string" ? value : JSON.stringify(value)
  ]));
}

/* Dados no formato atual (versão 3), como um usuário que já usa o app teria. */
function currentFormatSeed() {
  const routine = makeRoutine("weights", "Peito", [
    { id: "cf-1", name: "Supino", sets: 3, reps: "10", rest: 90, load: "40 kg" },
    { id: "cf-2", name: "Bicicleta", sets: 1, type: "duration", duration: 600, rest: 0, section: "finisher" }
  ], "cf-routine");
  routine.sections.main[0].measure = "load";
  routine.sections.finisher[0].measure = "time";

  return {
    "forja-treino-rotinas-v1": routinesStore([], [routine]),
    "forja-treino-historico-v1": [{
      id: "cf-h1", date: "2025-03-01", modality: "weights", routineId: routine.id, routineName: "Peito",
      durationMs: 1800000, completedSets: 3, totalPlannedSets: 4, status: "partial",
      finishedAt: "2025-03-01T10:00:00.000Z",
      exercises: [{
        id: "cf-1", name: "Supino", section: "main", plannedSets: 3, completedSets: 3, reps: "10",
        duration: 45, type: "reps", rest: 90, load: "40 kg", notes: "",
        logs: [{ set: 1, reps: "10", load: "40", seconds: 0, distance: null, rpe: null, editedAt: null }]
      }],
      feedback: { rpe: 7, note: "" },
      totals: { volumeKg: 400, reps: 10, seconds: 0, distanceMeters: 0, setsLogged: 1, setsWithoutVolume: 0 }
    }],
    "forja-missoes-2025-03-01": [{ id: "cf-m", text: "Treinar", done: true }],
    "forja-treino-biblioteca-v1": {
      calisthenics: [],
      weights: [{
        id: "lib-cf", name: "Remada unilateral", type: "reps", sets: 3, reps: "12", duration: 45, rest: 60,
        section: "main", load: "", notes: "", measure: "load", distance: null, distanceUnit: "m",
        category: "Costas", muscles: ["dorsais"], equipment: ["halter"], instructions: "",
        createdAt: 1, updatedAt: 1
      }]
    },
    [PREFS_KEY]: { soundOnRest: false, vibrateOnRest: true },
    "forja-treino-metas-v1": {
      version: 1, updatedAt: "2025-03-01T09:00:00.000Z", modality: "all",
      weeklySessions: 3, weeklySets: 20, weeklyMinutes: 90
    },
    "forja-treino-migracao-v1": { version: 3, dataVersion: 3, updatedAt: "2025-02-01T00:00:00.000Z" },
    [SAFETY_KEY]: {
      app: "FORJA", format: "forja-backup-seguranca", version: 1,
      exportedAt: "2025-03-02T12:00:00.000Z", reason: "before-restore",
      keys: { "forja-missoes-2025-03-01": [{ id: "cf-m", text: "Treinar", done: false }] }
    }
  };
}

/* Observa os avisos do fim do descanso: vibração e som (AudioContext). */
function installRestSignals(app) {
  const signals = { vibrate: [], sound: 0 };

  Object.defineProperty(app.w.navigator, "vibrate", {
    configurable: true,
    value: pattern => {
      signals.vibrate.push(Array.from(pattern));
      return true;
    }
  });

  app.w.AudioContext = class FakeAudioContext {
    constructor() {
      signals.sound += 1;
      this.currentTime = 0;
      this.destination = {};
    }
    createOscillator() {
      return { type: "", frequency: { value: 0 }, connect() {}, start() {}, stop() {}, onended: null };
    }
    createGain() {
      return { gain: { value: 0 }, connect() {} };
    }
    close() {
      return Promise.resolve();
    }
  };

  return signals;
}

/* Abre a execução com uma sessão nova, conclui uma série e deixa o descanso acabar pelo cronômetro. */
async function restEndSignals(app, routine) {
  app.set("forja-treino-sessao-ativa-v1", sessionSeed(routine, { id: "s-prefs-" + app.fakeNow }));
  await app.go(BASE + "treino/executar.html");
  await pageIs(app, "executar");

  const signals = installRestSignals(app);
  app.click("#complete-set");
  app.advance(500);
  assert.equal(app.$("#execution-rest").hidden, false, "O descanso não começou");

  app.advance(10_500);
  assert.equal(app.$("#execution-rest").hidden, true, "O descanso não terminou pelo cronômetro");
  return signals;
}

await runTest("45. Perfil: usa o controlador de Configurações e os checkboxes refletem o armazenado", async () => {
  const cases = [
    { label: "sem preferência gravada", seed: undefined, sound: true, vibrate: true },
    { label: "som desligado", seed: { soundOnRest: false, vibrateOnRest: true }, sound: false, vibrate: true },
    { label: "vibração desligada", seed: { soundOnRest: true, vibrateOnRest: false }, sound: true, vibrate: false },
    { label: "ambos desligados", seed: { soundOnRest: false, vibrateOnRest: false }, sound: false, vibrate: false },
    { label: "conteúdo ilegível", seed: "{ quebrado", sound: true, vibrate: true }
  ];

  for (const page of DATA_PAGES) {
    for (const item of cases) {
      const where = page + " (" + item.label + ")";
      const app = await boot(item.seed === undefined ? {} : { [PREFS_KEY]: item.seed }, page);

      assert.equal(typeof app.F.pages.perfil, "function", "F.pages.perfil não registrado");
      assert.equal(app.F.pages.perfil, app.F.pages.configuracoes,
        "Perfil deveria reutilizar o mesmo controlador de Configurações");
      assert.equal(app.$("#pref-sound").checked, item.sound, "Som não reflete o armazenado em " + where);
      assert.equal(app.$("#pref-vibrate").checked, item.vibrate, "Vibração não reflete o armazenado em " + where);
      assert.deepEqual(plain(app.F.state.preferences), { soundOnRest: item.sound, vibrateOnRest: item.vibrate },
        "Memória do descanso diverge da tela em " + where);

      /* Painel de backup inicializado: sem cópia de segurança, nada para desfazer. */
      assert.equal(app.$("#restore-safety-backup").hidden, true, "Desfazer visível sem cópia em " + where);
      assert.match(app.text("#backup-status"), /permanecem apenas neste navegador/);
      assert.deepEqual(app.storageWrites, [], "Abrir " + where + " gravou no armazenamento");
      assertNoErrors(app, where);
      app.close();
    }
  }

  /* Com uma cópia de segurança válida, o Perfil já abre oferecendo o desfazer. */
  const withSafety = await boot({ [SAFETY_KEY]: currentFormatSeed()[SAFETY_KEY] }, "perfil/index.html");
  assert.equal(withSafety.$("#restore-safety-backup").hidden, false, "Desfazer ausente com cópia de segurança");
  assert.match(withSafety.text("#backup-status"), /Cópia de segurança de .+ disponível/);
  assertNoErrors(withSafety, "perfil com cópia de segurança");
  withSafety.close();
});

await runTest("46. Perfil e Configurações: abrir a página não grava nada no localStorage", async () => {
  const scenarios = [
    { label: "armazenamento vazio", seed: {} },
    { label: "dados no formato atual", seed: currentFormatSeed() }
  ];

  for (const scenario of scenarios) {
    const expected = seedAsStored(scenario.seed);

    for (const page of DATA_PAGES) {
      const where = page + " (" + scenario.label + ")";
      const app = await boot(scenario.seed, page);
      /* Espera alguns ciclos do intervalo único (250 ms) além do carregamento. */
      await wait(650);
      assert.deepEqual(app.storageWrites, [], "Gravação ao abrir " + where);
      assert.deepEqual(storageSnapshot(app), expected, "Conteúdo mudou ao abrir " + where);

      await app.reload();
      await wait(300);
      assert.deepEqual(app.storageWrites, [], "Gravação ao recarregar " + where);
      assert.deepEqual(storageSnapshot(app), expected, "Conteúdo mudou ao recarregar " + where);
      assertNoErrors(app, where);
      app.close();
    }
  }
});

await runTest("47. Som e vibração: a mesma escolha vale em Perfil, Configurações e no fim do descanso", async () => {
  const routine = makeRoutine("calisthenics", "Descanso", [
    { id: "pr-1", name: "Flexão", sets: 3, reps: "10", rest: 10 }
  ], "prefs-rest");
  const app = await boot({ "forja-treino-rotinas-v1": routinesStore([routine], []) },
    "perfil/index.html", { now: 2_000_000 });

  /* Perfil: sem nada gravado, os dois ligados; a primeira gravação é a do usuário. */
  assert.equal(app.$("#pref-sound").checked, true);
  assert.equal(app.$("#pref-vibrate").checked, true);
  assert.equal(app.raw(PREFS_KEY), null);
  app.$("#pref-sound").click();
  await wait(20);
  assert.deepEqual(app.data(PREFS_KEY), { soundOnRest: false, vibrateOnRest: true });
  assert.match(app.text("#toast"), /Preferência salva/);

  /* Configurações lê a mesma escolha e grava a outra opção sem desfazer a primeira. */
  await app.go(BASE + "configuracoes/index.html");
  await pageIs(app, "configuracoes");
  assert.equal(app.$("#pref-sound").checked, false, "Configurações não viu o som desligado no Perfil");
  assert.equal(app.$("#pref-vibrate").checked, true);
  app.$("#pref-vibrate").click();
  await wait(20);
  assert.deepEqual(app.data(PREFS_KEY), { soundOnRest: false, vibrateOnRest: false });

  /* De volta ao Perfil: os dois desmarcados, como gravado. */
  await app.go(BASE + "perfil/index.html");
  await pageIs(app, "perfil");
  assert.equal(app.$("#pref-sound").checked, false);
  assert.equal(app.$("#pref-vibrate").checked, false);

  /* Execução: o fim do descanso respeita "sem som e sem vibração". */
  let signals = await restEndSignals(app, routine);
  assert.deepEqual(plain(app.F.state.preferences), { soundOnRest: false, vibrateOnRest: false });
  assert.deepEqual(signals, { vibrate: [], sound: 0 }, "O descanso avisou com som e vibração desligados");

  /* Só vibração, ligada pelo Perfil: vibra e não toca. */
  await app.go(BASE + "perfil/index.html");
  await pageIs(app, "perfil");
  app.$("#pref-vibrate").click();
  await wait(20);
  assert.deepEqual(app.data(PREFS_KEY), { soundOnRest: false, vibrateOnRest: true });
  signals = await restEndSignals(app, routine);
  assert.deepEqual(signals.vibrate, [[200, 100, 200]], "O descanso não vibrou com a vibração ligada");
  assert.equal(signals.sound, 0, "O descanso tocou com o som desligado");

  /* Os dois ligados, pelas Configurações: vibra e toca. */
  await app.go(BASE + "configuracoes/index.html");
  await pageIs(app, "configuracoes");
  assert.equal(app.$("#pref-sound").checked, false);
  assert.equal(app.$("#pref-vibrate").checked, true);
  app.$("#pref-sound").click();
  await wait(20);
  assert.deepEqual(app.data(PREFS_KEY), { soundOnRest: true, vibrateOnRest: true });
  signals = await restEndSignals(app, routine);
  assert.equal(signals.vibrate.length, 1, "O descanso não vibrou");
  assert.equal(signals.sound, 1, "O descanso não tocou o aviso sonoro");

  assertNoErrors(app, "preferências entre Perfil, Configurações e execução");
});

await runTest("48. Perfil: exportar, rejeitar backup inválido, importar e desfazer direto na página", async () => {
  const routine = sampleRoutine("calisthenics", "perfil-bk");
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-missoes-2025-02-02": [{ id: "t", text: "Original", done: false }],
    [PREFS_KEY]: { soundOnRest: false, vibrateOnRest: true }
  }, "perfil/index.html");
  await pageIs(app, "perfil");

  /* Exportar */
  app.click("#export-backup");
  await wait(20);
  assert.equal(app.downloads.length, 1, "Exportar não gerou arquivo no Perfil");
  assert.match(app.downloads[0].download, /^forja-backup-\d{4}-\d{2}-\d{2}\.json$/);
  assert.match(app.text("#toast"), /Backup exportado com 3 chaves/);
  assert.match(app.text("#backup-status"), /Último backup exportado em/);
  const exported = plain(app.F.buildBackupObject());
  assert.equal(exported.app, "FORJA");
  assert.equal(exported.format, "forja-backup");
  assert.deepEqual(Object.keys(exported.keys).sort(),
    ["forja-missoes-2025-02-02", PREFS_KEY, "forja-treino-rotinas-v1"].sort());
  assert.deepEqual(exported.keys[PREFS_KEY], { soundOnRest: false, vibrateOnRest: true });
  assert.deepEqual(app.storageWrites, [], "Exportar gravou no armazenamento");
  const before = storageSnapshot(app);

  /* Inválidos são recusados com explicação e sem tocar em nada. */
  const invalid = [
    ["{ isto não é json", /Arquivo inválido/],
    [{ app: "OUTRO", format: "x", version: 1, keys: {} }, /Backup inválido/],
    [{ app: "FORJA", format: "forja-backup", version: 1, keys: { "outra-chave": [] } }, /Backup inválido/],
    [{ app: "FORJA", format: "forja-backup", version: 99, keys: { "forja-missoes-2025-02-02": [] } }, /Backup inválido/]
  ];
  for (const [content, title] of invalid) {
    await app.importFile(content);
    assert.match(app.text("#modal-title"), title);
    assert.match(app.text(".modal-message"), /Nenhum dado foi alterado/);
    assert.equal(app.$('[data-modal-action="restore"]'), null, "Backup inválido abriu a confirmação");
    app.modalAction("close");
    await wait(20);
    assert.deepEqual(storageSnapshot(app), before, "Backup inválido alterou dados");
  }
  assert.equal(app.raw(SAFETY_KEY), null, "Cópia de segurança criada para backup inválido");

  /* Válido: pede confirmação; cancelar não muda nada. */
  const replacement = {
    app: "FORJA", format: "forja-backup", version: 1, exportedAt: new Date().toISOString(),
    keys: {
      "forja-missoes-2025-02-02": [{ id: "n", text: "Importada", done: false }],
      [PREFS_KEY]: { soundOnRest: true, vibrateOnRest: false }
    }
  };
  await app.importFile(replacement);
  assert.match(app.text("#modal-title"), /Restaurar backup/);
  app.modalAction("cancel");
  await wait(20);
  assert.deepEqual(storageSnapshot(app), before, "Cancelar a importação alterou dados");

  await app.importFile(replacement);
  await app.modal("restore");
  await wait(40);
  assert.equal(app.data("forja-missoes-2025-02-02")[0].text, "Importada", "Importação não aplicou no Perfil");
  assert.equal(app.raw("forja-treino-rotinas-v1"), null, "Chave ausente do backup deveria ter sido removida");
  assert.equal(app.$("#pref-sound").checked, true, "Checkbox de som não acompanhou a restauração");
  assert.equal(app.$("#pref-vibrate").checked, false, "Checkbox de vibração não acompanhou a restauração");
  assert.deepEqual(plain(app.F.state.preferences), { soundOnRest: true, vibrateOnRest: false });
  assert.equal(app.$("#restore-safety-backup").hidden, false, "Desfazer não apareceu no Perfil");
  assert.match(app.text("#backup-status"), /Cópia de segurança de .+ disponível/);
  const safety = app.data(SAFETY_KEY);
  assert.equal(safety.format, "forja-backup-seguranca");
  assert.deepEqual(Object.keys(safety.keys).sort(), Object.keys(before).sort(), "Cópia de segurança incompleta");

  /* Desfazer a última restauração volta exatamente ao estado anterior. */
  app.click("#restore-safety-backup");
  await wait(15);
  assert.match(app.text("#modal-title"), /Desfazer última importação/);
  await app.modal("restore");
  await wait(40);
  const after = storageSnapshot(app);
  delete after[SAFETY_KEY];
  assert.deepEqual(after, before, "Desfazer não restaurou o estado anterior no Perfil");
  assert.equal(app.$("#pref-sound").checked, false);
  assert.equal(app.$("#pref-vibrate").checked, true);
  assertNoErrors(app, "backup no Perfil");
});

await runTest("49. Perfil: backups com dados das versões 1, 2 e 3 continuam aceitos", async () => {
  const v2Routine = makeRoutine("weights", "Treino B", [
    { id: "v2-ex", name: "Agachamento livre", sets: 4, reps: "8", rest: 120, load: "60 kg" }
  ], "v2-routine");
  const v3Routine = makeRoutine("calisthenics", "Treino C", [
    { id: "v3-ex", name: "Corrida leve", sets: 1, type: "reps", reps: "1", rest: 0, section: "finisher" }
  ], "v3-routine");
  Object.assign(v3Routine.sections.finisher[0], { measure: "distance", distance: 400, distanceUnit: "m" });

  const backups = [
    {
      label: "versão 1 (exercícios soltos)",
      keys: {
        "forja-treino-exercicios-v1": {
          calisthenics: [{ id: "c1", name: "Flexão", sets: 3, reps: "12", rest: 45 }],
          weights: []
        },
        "forja-missoes-2024-05-01": [{ id: "a", text: "Antiga", done: true }]
      },
      verify(app) {
        assert.match(app.text("#backup-status"), /Cópia de segurança/);
        const routines = app.data("forja-treino-rotinas-v1");
        assert.equal(routines.calisthenics.length, 1, "Backup v1 não virou rotina");
        assert.equal(routines.calisthenics[0].name, "Rotina padrão");
        assert.ok(app.raw("forja-treino-exercicios-v1").includes("Flexão"), "Chave antiga não foi preservada");
      }
    },
    {
      label: "versão 2 (rotinas e histórico sem totais)",
      keys: {
        "forja-treino-rotinas-v1": routinesStore([], [v2Routine]),
        "forja-treino-historico-v1": [{
          id: "h-v2", date: "2025-01-02", modality: "weights", routineName: "Treino B",
          durationMs: 600000, completedSets: 4, totalPlannedSets: 4, status: "completed",
          finishedAt: "2025-01-02T10:00:00.000Z", exercises: []
        }]
      },
      verify(app, keys) {
        assert.deepEqual(app.data("forja-treino-rotinas-v1"), keys["forja-treino-rotinas-v1"]);
        assert.deepEqual(app.data("forja-treino-historico-v1"), keys["forja-treino-historico-v1"]);
      }
    },
    {
      label: "versão 3 (medição, metas e preferências)",
      keys: {
        "forja-treino-rotinas-v1": routinesStore([v3Routine], []),
        "forja-treino-metas-v1": {
          version: 1, updatedAt: "2025-04-01T08:00:00.000Z", modality: "calisthenics",
          weeklySessions: 4, weeklySets: 0, weeklyMinutes: 120
        },
        [PREFS_KEY]: { soundOnRest: false, vibrateOnRest: false }
      },
      verify(app, keys) {
        assert.deepEqual(app.data("forja-treino-rotinas-v1"), keys["forja-treino-rotinas-v1"]);
        assert.deepEqual(app.data("forja-treino-metas-v1"), keys["forja-treino-metas-v1"]);
        assert.equal(app.$("#pref-sound").checked, false);
        assert.equal(app.$("#pref-vibrate").checked, false);
      }
    }
  ];

  for (const backup of backups) {
    const app = await boot({ "forja-missoes-2025-02-02": [{ id: "t", text: "Atual", done: false }] }, "perfil/index.html");
    await app.importFile({
      app: "FORJA", format: "forja-backup", version: 1,
      exportedAt: "2025-05-01T12:00:00.000Z", keys: backup.keys
    });
    assert.match(app.text("#modal-title"), /Restaurar backup/, "Backup " + backup.label + " foi recusado");
    await app.modal("restore");
    await wait(60);
    assert.equal(app.raw("forja-missoes-2025-02-02"), null, "Restauração de " + backup.label + " não substituiu os dados");
    backup.verify(app, backup.keys);
    assert.equal(app.$("#restore-safety-backup").hidden, false);
    assertNoErrors(app, "backup " + backup.label);
    app.close();
  }
});

await runTest("50. F.url(\"perfil\") e F.url(\"explorar\") resolvem sob /forja/ em todas as páginas", async () => {
  for (const page of PAGES) {
    const app = await boot({}, page);
    assert.equal(app.F.ROUTES.perfil, "perfil/index.html");
    assert.equal(app.F.ROUTES.explorar, "explorar/index.html");

    for (const [name, file] of [
      ["perfil", "perfil/index.html"],
      ["explorar", "explorar/index.html"],
      ["configuracoes", "configuracoes/index.html"]
    ]) {
      const href = app.F.url(name);
      assert.ok(!href.startsWith("/"), "F.url(" + name + ") absoluto em " + page + ": " + href);
      const url = new URL(href, app.w.location.href);
      assert.equal(url.pathname, "/forja/" + file, "F.url(" + name + ") em " + page + " resolveu para " + href);

      /* O destino coincide com o link da barra inferior, quando existe. */
      const navLink = app.$('.bottom-nav-link[data-nav="' + name + '"]');
      if (navLink) {
        assert.equal(new URL(navLink.getAttribute("href"), app.w.location.href).pathname, url.pathname,
          "Barra inferior e F.url(" + name + ") divergem em " + page);
      }
    }

    assert.equal(new URL(app.F.url("perfil", { origem: "teste" }), app.w.location.href).search, "?origem=teste");

    /* Toda rota registrada aponta para um arquivo que existe. */
    Object.entries(app.F.ROUTES).forEach(([name, file]) => {
      assert.ok(fs.existsSync(path.join(repoRoot, file)), "Rota " + name + " aponta para arquivo inexistente: " + file);
    });
    app.close();
  }
});

await runTest("51. Navegação ativa: HTML, JavaScript e CSS marcam o mesmo item em todas as páginas", async () => {
  const css = fs.readFileSync(path.join(repoRoot, "assets/css/app.css"), "utf8");
  assert.match(css, /\.bottom-nav-link\.is-active,\s*\.bottom-nav-link\[aria-current="page"\]\s*\{[^}]*color:\s*var\(--lime\)/,
    "app.css deve estilizar is-active e aria-current juntos");

  for (const page of PAGES) {
    const expected = EXPECTED_NAV[page];
    assert.ok(expected, "Página sem destino esperado na barra: " + page);

    /* HTML estático, antes do JavaScript. */
    const staticDoc = new JSDOM(fs.readFileSync(path.join(repoRoot, page), "utf8")).window.document;
    const pick = (root, selector) => Array.from(root.querySelectorAll(selector)).map(node => node.getAttribute("data-nav"));
    assert.deepEqual(pick(staticDoc, ".bottom-nav-link.is-active"), [expected], "HTML: is-active em " + page);
    assert.deepEqual(pick(staticDoc, '.bottom-nav-link[aria-current="page"]'), [expected], "HTML: aria-current em " + page);

    /* Depois do JavaScript: o mesmo e único item, com a classe que o CSS estiliza. */
    const app = await boot({}, page);
    assert.deepEqual(pick(app.d, ".bottom-nav-link.is-active"), [expected], "JS: is-active em " + page);
    assert.deepEqual(pick(app.d, '.bottom-nav-link[aria-current="page"]'), [expected], "JS: aria-current em " + page);
    assert.equal(app.$$(".bottom-nav-link.is-current").length, 0, "Classe sem estilo na barra em " + page);
    app.close();
  }

  /* Um HTML desalinhado é corrigido pelo JavaScript. */
  const app = await boot({}, "perfil/index.html");
  const wrong = app.$('.bottom-nav-link[data-nav="treino"]');
  wrong.classList.add("is-active");
  wrong.setAttribute("aria-current", "page");
  app.F.ui.markCurrentNav("perfil");
  assert.deepEqual(app.$$(".bottom-nav-link.is-active").map(node => node.getAttribute("data-nav")), ["perfil"]);
  assert.deepEqual(app.$$('.bottom-nav-link[aria-current="page"]').map(node => node.getAttribute("data-nav")), ["perfil"]);
  app.close();
});

await runTest("52. Preferências: falha ao gravar no Perfil mantém tela e descanso no valor armazenado", async () => {
  const app = await boot({ [PREFS_KEY]: { soundOnRest: true, vibrateOnRest: true } }, "perfil/index.html");
  const failing = installFailingStorage(app, { failOn: PREFS_KEY, times: 1 });

  app.$("#pref-sound").click();
  await wait(20);
  failing.restore();

  assert.equal(failing.state.hits, 1, "A gravação não chegou a ser tentada");
  assert.deepEqual(app.data(PREFS_KEY), { soundOnRest: true, vibrateOnRest: true }, "O valor armazenado mudou");
  assert.equal(app.$("#pref-sound").checked, true, "O checkbox não voltou ao valor armazenado");
  assert.deepEqual(plain(app.F.state.preferences), { soundOnRest: true, vibrateOnRest: true },
    "O descanso usaria um valor que não foi gravado");
  assert.match(app.text("#toast"), /Não foi possível salvar a preferência/);
  assert.ok(app.$("#toast").classList.contains("error"));

  /* Com o armazenamento normal, a mesma ação grava. */
  app.$("#pref-sound").click();
  await wait(20);
  assert.deepEqual(app.data(PREFS_KEY), { soundOnRest: false, vibrateOnRest: true });
  assertNoErrors(app, "falha ao gravar preferência");
});

await runTest("53. Preferências: mudança feita em outra aba chega ao Perfil, às Configurações e à execução", async () => {
  for (const page of [...DATA_PAGES, "treino/executar.html"]) {
    const app = await boot({ [PREFS_KEY]: { soundOnRest: true, vibrateOnRest: true } }, page);
    const own = app.storageWrites.length;

    /* Outra aba grava; o evento `storage` só é entregue às demais abas. */
    const next = JSON.stringify({ soundOnRest: false, vibrateOnRest: true });
    app.w.localStorage.setItem(PREFS_KEY, next);
    app.w.dispatchEvent(new app.w.StorageEvent("storage", { key: PREFS_KEY, newValue: next }));
    await wait(10);
    assert.deepEqual(plain(app.F.state.preferences), { soundOnRest: false, vibrateOnRest: true }, "Memória desatualizada em " + page);
    if (app.$("#pref-sound")) {
      assert.equal(app.$("#pref-sound").checked, false, "Checkbox de som desatualizado em " + page);
      assert.equal(app.$("#pref-vibrate").checked, true);
    }

    /* Outras chaves não mexem nas preferências. */
    app.w.dispatchEvent(new app.w.StorageEvent("storage", { key: "forja-treino-historico-v1", newValue: "[]" }));
    await wait(10);
    assert.deepEqual(plain(app.F.state.preferences), { soundOnRest: false, vibrateOnRest: true });

    /* Outra aba apagou a chave: volta ao padrão (ligado), sem gravar nada aqui. */
    app.w.localStorage.removeItem(PREFS_KEY);
    app.w.dispatchEvent(new app.w.StorageEvent("storage", { key: PREFS_KEY, newValue: null }));
    await wait(10);
    assert.deepEqual(plain(app.F.state.preferences), { soundOnRest: true, vibrateOnRest: true });
    if (app.$("#pref-sound")) assert.equal(app.$("#pref-sound").checked, true);

    assert.deepEqual(app.storageWrites.slice(own), [
      { method: "setItem", key: PREFS_KEY },
      { method: "removeItem", key: PREFS_KEY }
    ], "A página gravou algo ao receber o evento em " + page);
    assertNoErrors(app, "evento de outra aba em " + page);
    app.close();
  }
});

function buildRotationExercise(name, extra = {}) {
  return Object.assign({
    id: "ex-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    sets: 3,
    type: "reps",
    reps: "10",
    duration: 45,
    rest: 60,
    load: "",
    notes: "",
    section: "main"
  }, extra);
}

function buildRotationRoutine({ id, name, modality = "calisthenics", exercises = [], createdAt = 1000, updatedAt = 1000 }) {
  return {
    id,
    name,
    modality,
    createdAt,
    updatedAt,
    sections: {
      warmup: [],
      main: exercises,
      abs: [],
      finisher: []
    }
  };
}

await runTest("54. Home sem rotina e com rotina vazia nunca exibe botão Iniciar quebrado", async () => {
  /* 1. Estado completamente vazio: zero escrita ao abrir, sem <button> Iniciar, CTA aponta para criação. */
  const emptyApp = await boot({}, "index.html");
  assert.deepEqual(emptyApp.storageWrites, [], "Abrir a Home vazia não pode gravar em localStorage");
  const primaryEmpty = emptyApp.$("#home-primary-button");
  assert.ok(primaryEmpty, "CTA principal ausente na Home vazia");
  assert.equal(primaryEmpty.tagName, "A", "Na Home sem rotinas o CTA deve ser link de criação, não botão de iniciar");
  assert.equal(emptyApp.text("#home-primary-button"), "Montar meu treino");
  assert.doesNotMatch(emptyApp.text("#home-action"), /\bIniciar\b/, "Home vazia não deve mostrar Iniciar");
  assert.equal(primaryEmpty.getAttribute("href"), "treino/index.html");
  assertNoErrors(emptyApp, "home vazia");
  emptyApp.close();

  /* 2. Rotina salva, porém ainda sem exercícios (0 exercícios): nunca mostra Iniciar, leva direto ao editor da rotina. */
  const incompleteSeed = {
    "forja-treino-rotinas-v1": {
      version: 2,
      calisthenics: [buildRotationRoutine({ id: "routine-empty-1", name: "Treino Vazio", exercises: [] })],
      weights: []
    }
  };
  const incompleteApp = await boot(incompleteSeed, "index.html");
  assert.deepEqual(incompleteApp.storageWrites, [], "Abrir a Home com rotina vazia não pode gravar em localStorage");
  const primaryIncomplete = incompleteApp.$("#home-primary-button");
  assert.equal(primaryIncomplete.tagName, "A", "Rotina sem exercícios não pode renderizar botão Iniciar");
  assert.equal(incompleteApp.text("#home-primary-button"), "Adicionar exercícios");
  assert.doesNotMatch(primaryIncomplete.textContent, /\bIniciar\b/);
  assert.match(primaryIncomplete.getAttribute("href"), /^treino\/rotina\.html\?modalidade=calisthenics&id=routine-empty-1$/);
  assertNoErrors(incompleteApp, "home com rotina sem exercicios");
  incompleteApp.close();
});

function captureStorage(app) {
  const out = {};
  for (let i = 0; i < app.w.localStorage.length; i += 1) {
    const key = app.w.localStorage.key(i);
    out[key] = JSON.parse(app.w.localStorage.getItem(key));
  }
  return out;
}

await runTest("55. Biblioteca vazia, hub e editor direto abrem criação válida sem #editor-missing", async () => {
  /* Hub sem rotinas oferece criação da primeira rotina apontando para rota válida. */
  const hubApp = await boot({}, "treino/index.html");
  assert.deepEqual(hubApp.storageWrites, []);
  const hubCreate = hubApp.$("#hub-create-routine");
  assert.ok(hubCreate, "CTA de criação ausente no hub de treino");
  assert.equal(hubApp.text("#hub-create-routine"), "Criar primeira rotina");
  assert.equal(new URL(hubCreate.getAttribute("href"), hubApp.w.location.href).pathname, "/forja/treino/rotina.html");
  hubApp.close();

  /* Modalidades vazias mostram botão de CTA direto no card vazio, sem gravar até confirmar. */
  for (const page of ["treino/calistenia.html", "treino/musculacao.html"]) {
    const modApp = await boot({}, page);
    assert.deepEqual(modApp.storageWrites, []);
    const emptyCta = modApp.$("#routine-list .empty-card-cta");
    assert.ok(emptyCta, "CTA do estado vazio ausente em " + page);
    assert.equal(emptyCta.textContent.trim(), "Criar primeira rotina");
    modApp.close();
  }

  /* Todas as entradas sem ID no editor abrem modo de criação limpo, zero escrita e sem #editor-missing. */
  for (const url of [
    "treino/rotina.html",
    "treino/rotina.html?nova=1",
    "treino/rotina.html?modalidade=calisthenics",
    "treino/rotina.html?modalidade=weights",
    "treino/rotina.html?modalidade=calisthenics&exercicio=cal-flexao"
  ]) {
    const editorApp = await boot({}, url);
    assert.deepEqual(editorApp.storageWrites, [], "Abrir " + url + " não pode gravar em localStorage");
    assert.equal(editorApp.$("#editor-missing").hidden, true, "#editor-missing apareceu indevidamente em " + url);
    assert.equal(editorApp.$("#editor-body").hidden, false, "#editor-body deveria estar visível em " + url);
    assert.ok(editorApp.$("#routine-name-input").value.trim().length > 0, "Nome inicial ausente em " + url);
    assertNoErrors(editorApp, "abertura direta " + url);
    editorApp.close();
  }

  /* Biblioteca sem rotinas permite ir direto para criação já com o exercício pré-carregado. */
  const catApp = await boot({}, "treino/biblioteca.html");
  let destination = null;
  catApp.F.navigate = href => { destination = href; };
  catApp.$("#catalog-list .ui-exercise-row .primary-button").click();
  await wait(20);
  const createBtn = catApp.$('[data-modal-action="create"]');
  assert.ok(createBtn, "Ação 'Criar rotina agora' ausente no modal da biblioteca");
  createBtn.click();
  await wait(20);
  const resolvedDest = new URL(destination, catApp.w.location.href);
  assert.equal(resolvedDest.pathname, "/forja/treino/rotina.html");
  assert.equal(resolvedDest.searchParams.get("modalidade"), "calisthenics");
  assert.ok(resolvedDest.searchParams.get("exercicio"));

  const preloadedEditor = await boot({}, "treino/rotina.html" + resolvedDest.search);
  assert.equal(preloadedEditor.$("#editor-missing").hidden, true);
  assert.equal(preloadedEditor.$("#editor-body").hidden, false);
  assert.equal(preloadedEditor.$$(".editor-exercise").length, 1, "Exercício da biblioteca não veio pré-carregado no rascunho");
  assert.equal(preloadedEditor.data("forja-treino-rotinas-v1"), null, "Rascunho não deve gravar antes de salvar");
  preloadedEditor.close();
  catApp.close();
});

await runTest("56. Editor: criar, salvar sem duplicar, cancelar e voltar sem órfãos nem perda de dados", async () => {
  const existing = buildRotationRoutine({
    id: "routine-existing",
    name: "Base Existente",
    modality: "calisthenics",
    exercises: [buildRotationExercise("Barra fixa")]
  });
  const seed = {
    "forja-treino-rotinas-v1": {
      version: 2,
      calisthenics: [existing],
      weights: []
    }
  };

  /* 1. Cancelar imediatamente uma nova rotina sem alterações não grava nada nem cria rotina órfã. */
  const cleanCancelApp = await boot(seed, "treino/rotina.html?nova=1");
  let cancelDest = null;
  cleanCancelApp.F.navigate = href => { cancelDest = href; };
  const writesBeforeCancel = cleanCancelApp.storageWrites.length;
  cleanCancelApp.$("#cancel-routine").click();
  await wait(20);
  assert.equal(new URL(cancelDest, cleanCancelApp.w.location.href).pathname, "/forja/treino/index.html");
  assert.equal(cleanCancelApp.storageWrites.length, writesBeforeCancel, "Cancelar rascunho limpo não pode gravar nada");
  assert.equal(cleanCancelApp.data("forja-treino-rotinas-v1").calisthenics.length, 1);
  assert.equal(cleanCancelApp.data("forja-treino-rotinas-v1").weights.length, 0);
  cleanCancelApp.close();

  /* 2. Criar rotina em Musculação, adicionar exercício, salvar múltiplas vezes: 1 única rotina criada + existente preservada. */
  const createApp = await boot(seed, "treino/rotina.html?nova=1");
  createApp.$("#editor-modality-select").value = "weights";
  createApp.$("#editor-modality-select").dispatchEvent(new createApp.w.Event("change", { bubbles: true }));
  createApp.$("#routine-name-input").value = "Força Superior";
  createApp.$("#routine-name-input").dispatchEvent(new createApp.w.Event("input", { bubbles: true }));
  createApp.$("#exercise-name").value = "Supino reto";
  createApp.$("#exercise-sets").value = "4";
  createApp.$("#exercise-reps").value = "8";
  createApp.$("#exercise-load").value = "60 kg";
  createApp.$("#exercise-form").dispatchEvent(new createApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);

  assert.equal(createApp.data("forja-treino-rotinas-v1").weights.length, 0, "Antes de salvar não deve persistir");
  createApp.$("#save-routine-top").click();
  await wait(20);

  let savedStore = createApp.data("forja-treino-rotinas-v1");
  assert.equal(savedStore.calisthenics.length, 1, "Rotina existente de calistenia foi alterada/perdida");
  assert.equal(savedStore.calisthenics[0].name, "Base Existente");
  assert.equal(savedStore.weights.length, 1, "Nova rotina de musculação deveria ter sido criada");
  const createdId = savedStore.weights[0].id;
  assert.match(createdId, /^routine-/, "ID gerado fora da convenção do projeto");
  assert.equal(savedStore.weights[0].sections.main.length, 1);

  /* Salvar de novo após editar atualiza a mesma rotina, nunca duplica. */
  createApp.$("#routine-name-input").value = "Força Superior v2";
  createApp.$("#routine-name-input").dispatchEvent(new createApp.w.Event("input", { bubbles: true }));
  createApp.$("#save-routine").click();
  await wait(20);

  savedStore = createApp.data("forja-treino-rotinas-v1");
  assert.equal(savedStore.weights.length, 1, "Salvar novamente duplicou a rotina");
  assert.equal(savedStore.weights[0].id, createdId);
  assert.equal(savedStore.weights[0].name, "Força Superior v2");

  /* Alteração não salva pede confirmação ao cancelar/voltar; descartar preserva a versão salva. */
  let navAfterDiscard = null;
  createApp.F.navigate = href => { navAfterDiscard = href; };
  createApp.$("#routine-name-input").value = "Rascunho Descartado";
  createApp.$("#routine-name-input").dispatchEvent(new createApp.w.Event("input", { bubbles: true }));
  createApp.$("#cancel-routine").click();
  await wait(20);
  assert.equal(createApp.$("#modal-title").textContent, "Descartar alterações?");
  createApp.$('[data-modal-action="cancel"]').click();
  await wait(20);
  assert.equal(navAfterDiscard, null, "Continuar editando não deveria sair da página");
  assert.equal(createApp.$("#routine-name-input").value, "Rascunho Descartado");

  createApp.$("#cancel-routine").click();
  await wait(20);
  createApp.$('[data-modal-action="discard"]').click();
  await wait(20);
  assert.equal(new URL(navAfterDiscard, createApp.w.location.href).pathname, "/forja/treino/musculacao.html");
  assert.equal(createApp.data("forja-treino-rotinas-v1").weights[0].name, "Força Superior v2");
  createApp.close();
});

await runTest("57. Home: rotação previsível entre sessões/reloads, sem depender de updatedAt nem avançar ao abrir", async () => {
  /* Treino C tem updatedAt mais recente de propósito para provar que updatedAt não sequestra a seleção. */
  const rA = buildRotationRoutine({
    id: "routine-a",
    name: "Treino A Empurrar",
    modality: "calisthenics",
    exercises: [buildRotationExercise("Flexão", { sets: 1, rest: 0 })],
    createdAt: 1000,
    updatedAt: 1000
  });
  const rB = buildRotationRoutine({
    id: "routine-b",
    name: "Treino B Puxar",
    modality: "calisthenics",
    exercises: [buildRotationExercise("Barra fixa", { sets: 1, rest: 0 })],
    createdAt: 2000,
    updatedAt: 2000
  });
  const rC = buildRotationRoutine({
    id: "routine-c",
    name: "Treino C Pernas",
    modality: "weights",
    exercises: [buildRotationExercise("Agachamento livre", { sets: 1, rest: 0, load: "80 kg" })],
    createdAt: 3000,
    updatedAt: 999999
  });

  const baseStorage = {
    "forja-treino-rotinas-v1": {
      version: 2,
      calisthenics: [rA, rB],
      weights: [rC]
    }
  };

  /* 1. Primeiro uso (histórico vazio): escolhe Treino A (1ª da sequência), não Treino C (mais recente). */
  /* 2. Recarregar a Home múltiplas vezes não avança a rotação nem grava nada em localStorage. */
  for (let reload = 0; reload < 3; reload += 1) {
    const home = await boot(baseStorage, "index.html");
    assert.deepEqual(home.storageWrites, [], "Abrir/recarregar a Home não pode gravar em localStorage");
    assert.equal(home.text("#home-primary-button"), "Iniciar Treino A Empurrar");
    home.close();
  }

  /* Helper para executar 1 treino completo da rotina atualmente selecionada na Home e retornar o snapshot salvo. */
  async function startAndFinishFromHome(storageSnapshot) {
    const home = await boot(storageSnapshot, "index.html");
    let execDest = null;
    home.F.navigate = href => { execDest = href; };
    const chosenLabel = home.text("#home-primary-button");
    home.$("#home-primary-button").click();
    await wait(20);
    assert.equal(execDest, "treino/executar.html");
    const afterStart = captureStorage(home);
    home.close();

    const exec = await boot(afterStart, "treino/executar.html");
    exec.$("#complete-set").click();
    await wait(60);
    assert.equal(exec.$("#execution-summary").hidden, false, "Resumo da sessão concluída deveria aparecer");
    const afterFinish = captureStorage(exec);
    exec.close();
    return { chosenLabel, storage: afterFinish };
  }

  /* 3. Ciclo completo A -> B -> C -> A persistindo entre sessões e recarregamentos. */
  const step1 = await startAndFinishFromHome(baseStorage);
  assert.equal(step1.chosenLabel, "Iniciar Treino A Empurrar");

  const homeAfterA = await boot(step1.storage, "index.html");
  assert.deepEqual(homeAfterA.storageWrites, [], "Reload após Treino A não pode gravar");
  assert.equal(homeAfterA.text("#home-primary-button"), "Iniciar Treino B Puxar");
  homeAfterA.close();

  /* Iniciar B por engano e descartar com 0 séries desfaz o avanço e mantém B selecionado. */
  const accidentalStartHome = await boot(step1.storage, "index.html");
  accidentalStartHome.F.navigate = () => {};
  accidentalStartHome.$("#home-primary-button").click();
  await wait(20);
  const midDiscardSnap = captureStorage(accidentalStartHome);
  accidentalStartHome.close();

  const discardExec = await boot(midDiscardSnap, "treino/executar.html");
  discardExec.F.navigate = () => {};
  discardExec.$("#end-session").click();
  await wait(20);
  discardExec.$('[data-modal-action="discard"]').click();
  await wait(20);
  const postDiscardSnap = captureStorage(discardExec);
  discardExec.close();

  const homeAfterDiscard = await boot(postDiscardSnap, "index.html");
  assert.equal(homeAfterDiscard.text("#home-primary-button"), "Iniciar Treino B Puxar",
    "Descartar sessão sem séries deveria restaurar Treino B na fila");
  homeAfterDiscard.close();

  const step2 = await startAndFinishFromHome(postDiscardSnap);
  assert.equal(step2.chosenLabel, "Iniciar Treino B Puxar");

  const homeAfterB = await boot(step2.storage, "index.html");
  assert.equal(homeAfterB.text("#home-primary-button"), "Iniciar Treino C Pernas");
  homeAfterB.close();

  const step3 = await startAndFinishFromHome(step2.storage);
  assert.equal(step3.chosenLabel, "Iniciar Treino C Pernas");

  const homeAfterC = await boot(step3.storage, "index.html");
  assert.equal(homeAfterC.text("#home-primary-button"), "Iniciar Treino A Empurrar",
    "Após a última rotina a rotação deve voltar circularmente para a primeira");
  homeAfterC.close();
});

await runTest("58. Exclusão da rotina atualmente selecionada avança de forma consistente e limpa ao esvaziar", async () => {
  const rA = buildRotationRoutine({ id: "routine-a", name: "Rotina A", exercises: [buildRotationExercise("Flexão")] });
  const rB = buildRotationRoutine({ id: "routine-b", name: "Rotina B", exercises: [buildRotationExercise("Barra")] });
  const rC = buildRotationRoutine({ id: "routine-c", name: "Rotina C", exercises: [buildRotationExercise("Paralelas")] });

  const seed = {
    "forja-treino-rotinas-v1": {
      version: 2,
      calisthenics: [rA, rB, rC],
      weights: []
    },
    "forja-treino-rotacao-v1": {
      version: 1,
      overrideRoutineId: null,
      nextRoutineId: "routine-b",
      nextModality: "calisthenics",
      lastRoutineId: "routine-a",
      lastModality: "calisthenics",
      previousState: null,
      updatedAt: 5000
    }
  };

  /* Confirma que Rotina B está selecionada antes da exclusão. */
  const checkBefore = await boot(seed, "index.html");
  assert.equal(checkBefore.text("#home-primary-button"), "Iniciar Rotina B");
  checkBefore.close();

  /* Exclui Rotina B em calistenia.html -> Home passa para Rotina C. */
  const mod1 = await boot(seed, "treino/calistenia.html");
  const deleteButtons1 = mod1.$$(".routine-card .danger-button");
  deleteButtons1[1].click();
  await wait(20);
  mod1.$('[data-modal-action="delete"]').click();
  await wait(20);
  const snapAfterDeleteB = captureStorage(mod1);
  mod1.close();

  const checkAfterB = await boot(snapAfterDeleteB, "index.html");
  assert.equal(checkAfterB.text("#home-primary-button"), "Iniciar Rotina C");
  checkAfterB.close();

  /* Exclui Rotina C (última da lista) -> Home volta circularmente para Rotina A. */
  const mod2 = await boot(snapAfterDeleteB, "treino/calistenia.html");
  mod2.$$(".routine-card .danger-button")[1].click();
  await wait(20);
  mod2.$('[data-modal-action="delete"]').click();
  await wait(20);
  const snapAfterDeleteC = captureStorage(mod2);
  mod2.close();

  const checkAfterC = await boot(snapAfterDeleteC, "index.html");
  assert.equal(checkAfterC.text("#home-primary-button"), "Iniciar Rotina A");
  checkAfterC.close();

  /* Exclui Rotina A (não resta nenhuma rotina) -> Home volta ao estado vazio honesto. */
  const mod3 = await boot(snapAfterDeleteC, "treino/calistenia.html");
  mod3.$$(".routine-card .danger-button")[0].click();
  await wait(20);
  mod3.$('[data-modal-action="delete"]').click();
  await wait(20);
  const snapEmpty = captureStorage(mod3);
  mod3.close();

  const checkEmpty = await boot(snapEmpty, "index.html");
  assert.equal(checkEmpty.text("#home-primary-button"), "Montar meu treino");
  assert.doesNotMatch(checkEmpty.text("#home-action"), /\bIniciar\b/);
  checkEmpty.close();
});

await runTest("59. Compatibilidade com dados legados (v1/v2) e backups v1/v2/v3 sem chave de rotação", async () => {
  /* Histórico legado v2 (sem routineId, apenas modality + routineName) e sem forja-treino-rotacao-v1. */
  const legacyV2Storage = {
    "forja-treino-rotinas-v1": {
      version: 2,
      calisthenics: [
        buildRotationRoutine({ id: "routine-leg-1", name: "Treino Base 1", exercises: [buildRotationExercise("Flexão")] }),
        buildRotationRoutine({ id: "routine-leg-2", name: "Treino Base 2", exercises: [buildRotationExercise("Barra")] })
      ],
      weights: []
    },
    "forja-treino-historico-v1": [{
      id: "hist-legacy-1",
      date: "2026-10-20",
      modality: "calisthenics",
      routineName: "Treino Base 1",
      status: "completed",
      completedSets: 3,
      totalPlannedSets: 3,
      durationMs: 900000,
      exercises: [{ name: "Flexão", completedSets: 3, plannedSets: 3 }]
    }]
  };

  const legacyHome = await boot(legacyV2Storage, "index.html");
  assert.deepEqual(legacyHome.storageWrites, [], "Dados legados não podem causar escrita na abertura da Home");
  assert.equal(legacyHome.text("#home-primary-button"), "Iniciar Treino Base 2",
    "Com histórico legado de Treino Base 1, a próxima rotina deve ser Treino Base 2");
  legacyHome.close();

  /* Backup completo v3 (com rotação) e restauração de backup antigo v2 (sem forja-treino-rotacao-v1). */
  const withRotation = Object.assign({}, legacyV2Storage, {
    "forja-treino-rotacao-v1": {
      version: 1,
      overrideRoutineId: "routine-leg-1",
      nextRoutineId: "routine-leg-1",
      nextModality: "calisthenics",
      lastRoutineId: "routine-leg-2",
      lastModality: "calisthenics",
      previousState: null,
      updatedAt: 12345
    }
  });

  const perfil = await boot(withRotation, "perfil/index.html");
  const exportedWithRotation = perfil.F.buildBackupObject();
  assert.ok(exportedWithRotation.keys["forja-treino-rotacao-v1"], "Backup deve incluir forja-treino-rotacao-v1");

  /* Importa backup antigo sem forja-treino-rotacao-v1 -> limpa rotação antiga e usa histórico legado. */
  await perfil.importFile({
    app: "FORJA",
    format: "forja-backup",
    version: 1,
    exportedAt: "2026-10-20T12:00:00.000Z",
    keys: legacyV2Storage
  });
  await perfil.modal("restore");
  await wait(40);

  const restoredHome = await boot(captureStorage(perfil), "index.html");
  assert.equal(restoredHome.text("#home-primary-button"), "Iniciar Treino Base 2");
  restoredHome.close();

  /* Desfazer restauração restaura exatamente a rotação anterior. */
  perfil.$("#restore-safety-backup").click();
  await wait(20);
  await perfil.modal("restore");
  await wait(40);

  const undoneHome = await boot(captureStorage(perfil), "index.html");
  assert.equal(undoneHome.text("#home-primary-button"), "Iniciar Treino Base 1");
  undoneHome.close();
  perfil.close();
});

const failed = results.filter(result => !result.ok);

console.log("\n" + "=".repeat(66));
console.log("FORJA — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
if (failed.length > 0) {
  console.log("Falhas: " + failed.map(item => item.name).join(" | "));
}
console.log("=".repeat(66));

process.exitCode = failed.length > 0 ? 1 : 0;
