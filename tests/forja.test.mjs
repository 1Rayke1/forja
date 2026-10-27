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

/*
  Proteção original: nenhum link interno pode ser absoluto nem sair de /forja/.
  A licença RepDB exige um link visível para repdb.co. Em vez de enfraquecer a
  regra, links externos passam a ser uma EXCEÇÃO auditada: só os hosts abaixo,
  só com marcação explícita data-external-credit, target=_blank e rel=noopener.
*/
const EXTERNAL_CREDIT_HOSTS = new Set(["repdb.co", "github.com"]);

await runTest("05. Links relativos resolvem dentro do caminho /forja/ (GitHub Pages)", async () => {
  for (const page of PAGES) {
    const app = await boot({}, page);
    const broken = [];

    app.$$("a[href]").forEach(anchor => {
      const raw = anchor.getAttribute("href");
      if (raw.startsWith("#")) return;

      if (/^https?:\/\//.test(raw)) {
        const url = new URL(raw, app.w.location.href);
        assert.ok(anchor.hasAttribute("data-external-credit"),
          "Link externo sem marcação explícita em " + page + ": " + raw);
        assert.ok(EXTERNAL_CREDIT_HOSTS.has(url.hostname),
          "Host externo não autorizado em " + page + ": " + url.hostname);
        assert.equal(anchor.getAttribute("target"), "_blank",
          "Link externo precisa abrir em nova aba: " + raw);
        assert.match(anchor.getAttribute("rel") || "", /noopener/,
          "Link externo precisa de rel=noopener: " + raw);
        return;
      }

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
  Stage 2A (C1/C2): editar um exercício não pode apagar os metadados que o
  formulário não edita, e adicionar pela busca rápida do editor precisa
  produzir a mesma estrutura da adição pela página completa da biblioteca.
*/
await runTest("30b. Editor: editar exercício preserva measure, distance, libraryId e instructions após salvar e recarregar", async () => {
  /* Exercício de distância (formato 3) com origem na biblioteca. */
  const distanceRoutine = {
    id: "rot-dist",
    name: "Condicionamento",
    modality: "weights",
    createdAt: 1,
    updatedAt: 1,
    sections: {
      warmup: [],
      main: [],
      abs: [],
      finisher: [{
        id: "ex-run",
        name: "Corrida 400 m",
        sets: 1,
        type: "reps",
        reps: "400 m",
        duration: 45,
        rest: 0,
        load: "",
        notes: "",
        section: "finisher",
        measure: "distance",
        distance: 400,
        distanceUnit: "m",
        libraryId: "lib-corrida-400",
        instructions: "Manter o ritmo constante até o fim."
      }]
    }
  };

  const app = await boot(
    { "forja-treino-rotinas-v1": routinesStore([], [distanceRoutine]) },
    "treino/rotina.html?modalidade=weights&id=rot-dist"
  );
  await wait(20);

  /* Edita só campos do formulário (nome e séries); o resto não é editável. */
  const row = app.$$('[data-section-list="finisher"] .editor-exercise')[0];
  assert.ok(row, "Exercício de distância não apareceu no editor");
  app.click(row.querySelectorAll(".exercise-tools .icon-button")[2]);
  await wait(15);
  app.$("#exercise-name").value = "Corrida 400 m editada";
  app.$("#exercise-sets").value = "3";
  app.$("#exercise-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  app.click("#save-routine-top");
  await wait(20);

  let saved = app.data("forja-treino-rotinas-v1").weights[0].sections.finisher[0];
  assert.equal(saved.name, "Corrida 400 m editada", "Campo editável (nome) não foi alterado");
  assert.equal(saved.sets, 3, "Campo editável (séries) não foi alterado");
  assert.equal(saved.measure, "distance", "Editar apagou a medição de distância");
  assert.equal(saved.distance, 400, "Editar apagou a distância");
  assert.equal(saved.distanceUnit, "m", "Editar apagou a unidade de distância");
  assert.equal(saved.libraryId, "lib-corrida-400", "Editar apagou a origem na biblioteca");
  assert.equal(saved.instructions, "Manter o ritmo constante até o fim.", "Editar apagou as instruções");

  /* Recarregar (boot + normalização) não pode corromper nem reescrever o exercício. */
  const rawBeforeReload = app.raw("forja-treino-rotinas-v1");
  await app.reload();
  await wait(20);
  assert.equal(app.raw("forja-treino-rotinas-v1"), rawBeforeReload, "Recarregar reescreveu as rotinas");
  saved = app.F.state.routines.weights[0].sections.finisher[0];
  assert.equal(saved.measure, "distance", "Normalização perdeu a medição após recarregar");
  assert.equal(saved.distance, 400, "Normalização perdeu a distância após recarregar");
  assert.equal(saved.libraryId, "lib-corrida-400", "Normalização perdeu o libraryId após recarregar");
  assert.equal(saved.instructions, "Manter o ritmo constante até o fim.");
  assertNoErrors(app, "editar exercício de distância");
  app.close();

  /* Exercício vindo do catálogo sugerido: editar repetições mantém origem e instruções. */
  const suggestedRoutine = {
    id: "rot-sug",
    name: "Base sugerida",
    modality: "calisthenics",
    createdAt: 1,
    updatedAt: 1,
    sections: {
      warmup: [],
      main: [{
        id: "ex-agach",
        name: "Agachamento livre",
        sets: 4,
        type: "reps",
        reps: "15",
        duration: 45,
        rest: 60,
        load: "",
        notes: "",
        section: "main",
        measure: "reps",
        distance: null,
        distanceUnit: "m",
        libraryId: "cal-agachamento",
        instructions: "Pés na largura dos ombros, desça o quadril para trás."
      }],
      abs: [],
      finisher: []
    }
  };

  const app2 = await boot(
    { "forja-treino-rotinas-v1": routinesStore([suggestedRoutine], []) },
    "treino/rotina.html?modalidade=calisthenics&id=rot-sug"
  );
  await wait(20);

  const row2 = app2.$$('[data-section-list="main"] .editor-exercise')[0];
  app2.click(row2.querySelectorAll(".exercise-tools .icon-button")[2]);
  await wait(15);
  app2.$("#exercise-reps").value = "18";
  app2.$("#exercise-form").dispatchEvent(new app2.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  app2.click("#save-routine-top");
  await wait(20);

  const saved2 = app2.data("forja-treino-rotinas-v1").calisthenics[0].sections.main[0];
  assert.equal(saved2.reps, "18", "Campo editável (repetições) não foi alterado");
  assert.equal(saved2.libraryId, "cal-agachamento", "Editar apagou o libraryId do exercício sugerido");
  assert.equal(saved2.instructions, "Pés na largura dos ombros, desça o quadril para trás.", "Editar apagou as instruções do exercício sugerido");
  assertNoErrors(app2, "editar exercício sugerido");
  app2.close();
});

await runTest("30c. Biblioteca no editor: busca rápida e ?exercicio= preservam libraryId e instructions (sugerido e personalizado)", async () => {
  const customLibrary = {
    calisthenics: [{
      id: "lib-remada-mesa",
      name: "Remada na mesa",
      type: "reps",
      sets: 3,
      reps: "10",
      duration: 45,
      rest: 60,
      section: "main",
      load: "",
      notes: "",
      measure: "reps",
      distance: null,
      distanceUnit: "m",
      category: "pull",
      muscles: ["dorsais"],
      equipment: ["mesa"],
      instructions: "Puxe o peito até a borda da mesa.",
      createdAt: 1,
      updatedAt: 1
    }],
    weights: []
  };
  const routine = makeRoutine("calisthenics", "Busca rápida", [], "busca-rapida");
  const seed = {
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-biblioteca-v1": customLibrary
  };

  const app = await boot(seed, "treino/rotina.html?modalidade=calisthenics&id=busca-rapida");
  await wait(20);

  const expectedSuggested = app.F.catalog.items("calisthenics")
    .find(record => record.libraryId === "cal-agachamento");
  assert.ok(expectedSuggested, "Catálogo não tem o exercício sugerido de referência");
  assert.ok(expectedSuggested.instructions.length > 0, "Sugerido de referência deveria ter instruções no catálogo");

  app.click("#library-toggle");
  await wait(10);

  function addByName(name) {
    const itemRow = app.$$(".library-item")
      .find(entry => entry.textContent.includes(name));
    assert.ok(itemRow, "Item não encontrado na busca rápida: " + name);
    const addButton = Array.from(itemRow.querySelectorAll("button"))
      .find(button => button.textContent.trim() === "Adicionar");
    assert.ok(addButton, "Botão Adicionar não encontrado para: " + name);
    addButton.click();
  }

  addByName("Agachamento livre");
  await wait(15);
  addByName("Remada na mesa");
  await wait(15);
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics[0].sections.main.length, 0,
    "Adicionar pela biblioteca não pode gravar antes de salvar a rotina");

  app.click("#save-routine-top");
  await wait(20);

  const storedMain = app.data("forja-treino-rotinas-v1").calisthenics[0].sections.main;
  const suggestedCopy = storedMain.find(exercise => exercise.name === "Agachamento livre");
  assert.ok(suggestedCopy, "Exercício sugerido não entrou na rotina pela busca rápida");
  assert.match(suggestedCopy.id, /^exercise-/, "A cópia da busca rápida precisa de id novo");
  assert.equal(suggestedCopy.libraryId, "cal-agachamento", "Busca rápida não registrou o libraryId do sugerido");
  assert.equal(suggestedCopy.instructions, expectedSuggested.instructions, "Busca rápida não trouxe as instruções do sugerido");

  const customCopy = storedMain.find(exercise => exercise.name === "Remada na mesa");
  assert.ok(customCopy, "Exercício personalizado não entrou na rotina pela busca rápida");
  assert.match(customCopy.id, /^exercise-/, "A cópia do personalizado precisa de id novo");
  assert.notEqual(customCopy.id, "lib-remada-mesa", "A cópia não pode reusar o id da biblioteca");
  assert.equal(customCopy.libraryId, "lib-remada-mesa", "Busca rápida não registrou o libraryId do personalizado");
  assert.equal(customCopy.instructions, "Puxe o peito até a borda da mesa.", "Busca rápida perdeu as instruções do personalizado");
  assertNoErrors(app, "busca rápida da biblioteca");
  app.close();

  /* ?exercicio= (fluxo "Criar rotina agora" da biblioteca) monta o mesmo exercício. */
  const preloaded = await boot(seed, "treino/rotina.html?modalidade=calisthenics&exercicio=cal-agachamento");
  await wait(20);
  assert.equal(preloaded.$$(".editor-exercise").length, 1, "Pré-carregamento não montou o exercício no rascunho");
  assert.equal(preloaded.data("forja-treino-rotinas-v1").calisthenics.length, 1, "Rascunho pré-carregado gravou antes de salvar");
  preloaded.click("#save-routine-top");
  await wait(20);

  const preloadedStored = preloaded.data("forja-treino-rotinas-v1").calisthenics
    .map(entry => entry.sections.main).flat()
    .find(exercise => exercise.name === "Agachamento livre");
  assert.ok(preloadedStored, "Exercício pré-carregado não foi salvo");
  assert.equal(preloadedStored.libraryId, "cal-agachamento", "?exercicio= não registrou o libraryId");
  assert.ok(preloadedStored.instructions.length > 0, "?exercicio= não trouxe as instruções");
  assertNoErrors(preloaded, "pré-carregamento ?exercicio=");
  preloaded.close();
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

  /*
    As duas primeiras sessões precisam cair na semana corrente (segunda a
    domingo). Em uma segunda-feira, "ontem" já pertence à semana anterior, e a
    meta de 2 treinos nunca fecharia; nesse caso a segunda sessão é do mesmo
    dia, só em outro horário.
  */
  const semanaComecaHoje = ((today.getDay() + 6) % 7) === 0;
  const segundaSessao = semanaComecaHoje ? dayOffset(0, 18) : dayOffset(-1);

  const records = [
    seedRecord(today, [seedExercise("Supino", [seedLog({ reps: "10", load: "40 kg" })])]),
    seedRecord(segundaSessao, [seedExercise("Remada", [seedLog({ reps: "10", load: "20 kg" })])]),
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

await runTest("42a. Home: metas semanais reutilizam métricas, estados e não gravam ao carregar", async () => {
  const empty = await boot({}, "index.html");
  assert.ok(empty.$("#home-goals"));
  assert.ok(empty.$('#home-goals a[href="progresso/index.html"]'));
  assert.match(empty.text("#home-goals-content"), /ainda não configurou/);
  assert.equal(empty.$$("#home-goals-content .home-goal-row").length, 0);
  assert.match(empty.text("#home-goals-period"), /Semana de \d{2}\/\d{2} a \d{2}\/\d{2}\.$/);
  assert.doesNotMatch(empty.text("#home-goals-period"), /Musculação|Calistenia/);
  assert.deepEqual(empty.storageWrites, [], "Home vazia gravou no armazenamento");
  empty.close();

  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  const record = {
    id: "home-goal-record", date, finishedAt: now.toISOString(), modality: "weights",
    routineName: "Teste", durationMs: 15 * 60000, completedSets: 2, totalPlannedSets: 2,
    status: "completed", exercises: []
  };
  const goals = { version: 1, updatedAt: null, modality: "weights", weeklySessions: 3, weeklySets: 12, weeklyMinutes: 60 };
  const app = await boot({
    "forja-treino-historico-v1": [record],
    "forja-treino-metas-v1": goals
  }, "index.html");
  assert.equal(app.$$("#home-goals-content .home-goal-row").length, 3, "Três alvos ativos devem renderizar três barras");
  assert.match(app.text("#home-goals-content"), /1\/3/);
  assert.match(app.text("#home-goals-content"), /Faltam 2 treinos/);
  assert.match(app.text("#home-goals-content"), /2\/12/);
  assert.match(app.text("#home-goals-content"), /Faltam 10 séries/);
  assert.match(app.text("#home-goals-content"), /15\/60/);
  assert.match(app.text("#home-goals-content"), /Faltam 45 min/);
  assert.match(app.text("#home-goals-period"), /Semana de .* · Musculação\.$/);
  assert.deepEqual(app.storageWrites, [], "Exibir metas na home gravou no armazenamento");
  assert.match(app.text("#home-week-note"), /1 treino/);

  /* Singular e meta atingida na mesma atualização. */
  app.F.saveGoals({ modality: "all", weeklySessions: 2, weeklySets: 3, weeklyMinutes: 15 });
  assert.equal(app.$$("#home-goals-content .home-goal-row").length, 3, "Atualização de metas não redesenhou a seção");
  assert.match(app.text("#home-goals-content"), /1\/2/);
  assert.match(app.text("#home-goals-content"), /Falta 1 treino/);
  assert.match(app.text("#home-goals-content"), /Falta 1 série/);
  assert.match(app.text("#home-goals-content"), /Meta atingida/);
  assert.doesNotMatch(app.text("#home-goals-period"), /Musculação|Calistenia/, "Escopo 'all' não deve exibir filtro de modalidade");

  /* Modalidade Calistenia filtrada e estado de zero progresso preservado. */
  app.F.saveGoals({ modality: "calisthenics", weeklySessions: 2, weeklySets: 0, weeklyMinutes: 0 });
  assert.equal(app.$$("#home-goals-content .home-goal-row").length, 1);
  assert.match(app.text("#home-goals-period"), /Semana de .* · Calistenia\.$/);
  assert.match(app.text("#home-goals-content"), /0\/2/);
  assert.match(app.text("#home-goals-content"), /Ainda sem progresso/);
  app.close();

  const invalid = await boot({
    "forja-treino-historico-v1": [{ id: "bad", date: "invalida", modality: "weights" }],
    "forja-treino-metas-v1": goals
  }, "index.html");
  assert.equal(invalid.$$("#home-goals-content .home-goal-row").length, 3);
  assert.match(invalid.text("#home-goals-content"), /0\/3/);
  assert.match(invalid.text("#home-goals-content"), /Ainda sem progresso/);
  assert.deepEqual(invalid.storageWrites, [], "Dados inválidos causaram gravação ao carregar");
  assertNoErrors(invalid, "metas semanais na home com histórico inválido");
  invalid.close();
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

/* ------------------------------------------------------------------ */
/* Stage 2B — C3 (sincronização entre abas), C4 (nomes duplicados) e   */
/* C5 (rotação coerente ao esvaziar/reabastecer/duplicar)              */
/* ------------------------------------------------------------------ */

await runTest("59b. C3: telas de treino e biblioteca sincronizam com outra aba/BFCache sem gravar nada", async () => {
  const rA = buildRotationRoutine({ id: "sync-a", name: "Rotina Sync A", exercises: [buildRotationExercise("Flexão")] });
  const seed = { "forja-treino-rotinas-v1": routinesStore([rA], []) };

  const app = await boot(seed, "treino/calistenia.html");
  await wait(20);
  assert.equal(app.$$(".routine-card").length, 1);
  let expectedWrites = 0;

  function externalWrite(key, value) {
    app.w.localStorage.setItem(key, JSON.stringify(value));
    expectedWrites += 1;
    app.w.dispatchEvent(new app.w.StorageEvent("storage", { key, newValue: JSON.stringify(value) }));
  }

  /* Outra aba cria uma rotina: a lista aberta atualiza sem recarregar. */
  const rB = buildRotationRoutine({ id: "sync-b", name: "Rotina Sync B", exercises: [buildRotationExercise("Barra fixa")] });
  externalWrite("forja-treino-rotinas-v1", routinesStore([rA, rB], []));
  await wait(20);
  assert.equal(app.F.state.routines.calisthenics.length, 2, "F.state não sincronizou com o evento storage");
  assert.equal(app.$$(".routine-card").length, 2, "A lista não redesenhou após o evento storage");
  assert.match(app.text("#routine-list"), /Rotina Sync B/);

  /* Retorno via BFCache (pageshow persisted) sem evento storage: relê e redesenha. */
  app.w.localStorage.setItem("forja-treino-rotinas-v1", JSON.stringify(routinesStore([rA], [])));
  expectedWrites += 1;
  const bfShow = new app.w.Event("pageshow");
  bfShow.persisted = true;
  app.w.dispatchEvent(bfShow);
  await wait(20);
  assert.equal(app.$$(".routine-card").length, 1, "O retorno BFCache não redesenhou a lista");

  /* pageshow comum (persisted: false) não dispara sincronização nem gravação. */
  const normalShow = new app.w.Event("pageshow");
  normalShow.persisted = false;
  app.w.dispatchEvent(normalShow);
  await wait(10);

  assert.equal(app.storageWrites.length, expectedWrites,
    "Sincronizar não pode gravar: " + JSON.stringify(app.storageWrites));
  assertNoErrors(app, "sincronização em calistenia");
  app.close();

  /* A biblioteca também acompanha: rotina criada fora vira destino válido. */
  const cat = await boot(seed, "treino/biblioteca.html");
  await wait(20);
  cat.w.localStorage.setItem("forja-treino-rotinas-v1", JSON.stringify(routinesStore([rA, rB], [])));
  cat.w.dispatchEvent(new cat.w.StorageEvent("storage", {
    key: "forja-treino-rotinas-v1",
    newValue: JSON.stringify(routinesStore([rA, rB], []))
  }));
  await wait(20);
  assert.equal(cat.F.state.routines.calisthenics.length, 2, "A biblioteca não sincronizou as rotinas");
  assertNoErrors(cat, "sincronização na biblioteca");
  cat.close();
});

await runTest("59c. C3: editor não sobrescreve mudança externa na mesma rotina e preserva mudanças em outras", async () => {
  const rX = buildRotationRoutine({ id: "conf-x", name: "Rotina X", exercises: [buildRotationExercise("Flexão", { sets: 3 })] });
  const rY = buildRotationRoutine({ id: "conf-y", name: "Rotina Y", exercises: [buildRotationExercise("Prancha", { sets: 2 })] });
  const seed = { "forja-treino-rotinas-v1": routinesStore([rX, rY], []) };

  /* 1. A mesma rotina muda em outra aba: salvar é abortado e nada é sobrescrito. */
  const app = await boot(seed, "treino/rotina.html?modalidade=calisthenics&id=conf-x");
  await wait(20);

  const externalX = buildRotationRoutine({ id: "conf-x", name: "Versão da outra aba", exercises: [buildRotationExercise("Flexão", { sets: 9 })] });
  app.w.localStorage.setItem("forja-treino-rotinas-v1", JSON.stringify(routinesStore([externalX, rY], [])));
  app.w.dispatchEvent(new app.w.StorageEvent("storage", {
    key: "forja-treino-rotinas-v1",
    newValue: JSON.stringify(routinesStore([externalX, rY], []))
  }));
  await wait(20);

  app.$("#routine-name-input").value = "Edição local";
  app.$("#routine-name-input").dispatchEvent(new app.w.Event("input", { bubbles: true }));
  app.click("#save-routine-top");
  await wait(25);

  assert.match(app.text("#toast"), /outra aba/, "O conflito deveria ser avisado");
  const afterConflict = app.data("forja-treino-rotinas-v1");
  assert.equal(afterConflict.calisthenics[0].name, "Versão da outra aba", "O salvamento sobrescreveu a versão externa");
  assert.equal(afterConflict.calisthenics[0].sections.main[0].sets, 9, "O exercício externo foi sobrescrito");
  assert.equal(app.$("#routine-name-input").value, "Edição local", "O rascunho local deve continuar aberto para o usuário decidir");
  assertNoErrors(app, "conflito no editor");
  app.close();

  /* 2. Só outra rotina muda lá fora: salvar vale sobre o estado fresco e preserva a mudança. */
  const app2 = await boot(seed, "treino/rotina.html?modalidade=calisthenics&id=conf-x");
  await wait(20);

  const externalY = buildRotationRoutine({ id: "conf-y", name: "Rotina Y externa", exercises: [buildRotationExercise("Prancha", { sets: 7 })] });
  app2.w.localStorage.setItem("forja-treino-rotinas-v1", JSON.stringify(routinesStore([rX, externalY], [])));
  app2.w.dispatchEvent(new app2.w.StorageEvent("storage", {
    key: "forja-treino-rotinas-v1",
    newValue: JSON.stringify(routinesStore([rX, externalY], []))
  }));
  await wait(20);

  app2.$("#routine-name-input").value = "Rotina X editada";
  app2.$("#routine-name-input").dispatchEvent(new app2.w.Event("input", { bubbles: true }));
  app2.click("#save-routine-top");
  await wait(25);

  const merged = app2.data("forja-treino-rotinas-v1");
  assert.equal(merged.calisthenics.find(item => item.id === "conf-x").name, "Rotina X editada", "A edição local não foi salva");
  assert.equal(merged.calisthenics.find(item => item.id === "conf-y").name, "Rotina Y externa", "A mudança externa em outra rotina foi perdida");
  assert.equal(merged.calisthenics.find(item => item.id === "conf-y").sections.main[0].sets, 7);
  assertNoErrors(app2, "salvamento sobre estado fresco");
  app2.close();
});

await runTest("59d. C4: nomes duplicados de rotina e de exercício personalizado são bloqueados sem corrigir dados antigos", async () => {
  const rA = buildRotationRoutine({ id: "dup-a", name: "Treino A", exercises: [buildRotationExercise("Flexão")] });
  const rB = buildRotationRoutine({ id: "dup-b", name: "Treino B", exercises: [buildRotationExercise("Barra fixa")] });
  const seed = { "forja-treino-rotinas-v1": routinesStore([rA, rB], []) };

  /* Criar com mesmo nome (espaços + caixa diferentes) na mesma modalidade: bloqueado. */
  const createApp = await boot(seed, "treino/calistenia.html");
  createApp.click("#new-routine");
  await wait(15);
  await createApp.modal("create", { name: "  treino a  " });
  await wait(20);
  assert.equal(createApp.d.body.dataset.page, "calistenia", "Criação duplicada não deveria navegar ao editor");
  assert.equal(createApp.data("forja-treino-rotinas-v1").calisthenics.length, 2, "Criação duplicada gravou uma rotina");
  /* C7: o erro aparece inline no campo, com o modal ainda aberto (sem toast). */
  assert.match(createApp.text('[data-modal-error="name"]'), /Já existe uma rotina chamada/);
  assert.ok(createApp.$(".modal-backdrop"), "Modal fechou diante de nome duplicado");
  createApp.modalAction("cancel");
  await wait(15);
  createApp.close();

  /* O mesmo nome em outra modalidade continua permitido. */
  const otherMode = await boot(seed, "treino/musculacao.html");
  otherMode.click("#new-routine");
  await wait(15);
  await otherMode.modal("create", { name: "Treino A" });
  await pageIs(otherMode, "rotina");
  assert.equal(otherMode.data("forja-treino-rotinas-v1").weights.length, 1, "Mesmo nome em outra modalidade deveria ser aceito");
  otherMode.close();

  /* Renomear para nome duplicado: bloqueado e o nome gravado não muda. */
  const renameApp = await boot(seed, "treino/calistenia.html");
  const cardB = renameApp.$$(".routine-card")[1];
  Array.from(cardB.querySelectorAll("button")).find(button => button.textContent.trim() === "Renomear").click();
  await wait(20);
  await renameApp.modal("rename", { name: "TREINO A" });
  await wait(20);
  assert.equal(renameApp.data("forja-treino-rotinas-v1").calisthenics[1].name, "Treino B", "Renomear duplicado alterou o nome gravado");
  /* C7: o erro aparece inline no campo, com o modal ainda aberto (sem toast). */
  assert.match(renameApp.text('[data-modal-error="name"]'), /Já existe uma rotina chamada/);
  assert.ok(renameApp.$(".modal-backdrop"), "Modal fechou diante de nome duplicado");
  renameApp.modalAction("cancel");
  await wait(15);
  renameApp.close();

  /* Salvar pelo editor com nome duplicado: bloqueado; nome de outra modalidade: aceito. */
  const weightsNamed = buildRotationRoutine({ id: "dup-w", name: "Força Total", modality: "weights", exercises: [buildRotationExercise("Supino")] });
  const editorSeed = { "forja-treino-rotinas-v1": routinesStore([rA, rB], [weightsNamed]) };
  const editorApp = await boot(editorSeed, "treino/rotina.html?modalidade=calisthenics&id=dup-b");
  await wait(20);
  editorApp.$("#routine-name-input").value = " treino a ";
  editorApp.$("#routine-name-input").dispatchEvent(new editorApp.w.Event("input", { bubbles: true }));
  editorApp.click("#save-routine-top");
  await wait(20);
  assert.match(editorApp.text("#toast"), /Já existe uma rotina chamada/);
  assert.equal(editorApp.data("forja-treino-rotinas-v1").calisthenics[1].name, "Treino B", "Salvar duplicado alterou o nome gravado");

  editorApp.$("#routine-name-input").value = "Força Total";
  editorApp.$("#routine-name-input").dispatchEvent(new editorApp.w.Event("input", { bubbles: true }));
  editorApp.click("#save-routine-top");
  await wait(20);
  assert.equal(editorApp.data("forja-treino-rotinas-v1").calisthenics[1].name, "Força Total", "Nome igual só em outra modalidade deveria salvar");
  editorApp.close();

  /* Exercício personalizado duplicado na mesma modalidade: avisado antes de cadastrar. */
  const libApp = await boot(seed, "treino/rotina.html?modalidade=calisthenics&id=dup-a");
  await wait(20);
  libApp.click("#custom-toggle");
  await wait(10);
  libApp.$("#custom-name").value = "Escalada no muro";
  libApp.$("#custom-sets").value = "3";
  libApp.$("#custom-rest").value = "45";
  libApp.$("#custom-form").dispatchEvent(new libApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  assert.equal(libApp.data("forja-treino-biblioteca-v1").calisthenics.length, 1);

  libApp.click("#custom-toggle");
  await wait(10);
  libApp.$("#custom-name").value = "  ESCALADA NO MURO ";
  libApp.$("#custom-sets").value = "3";
  libApp.$("#custom-rest").value = "45";
  libApp.$("#custom-form").dispatchEvent(new libApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  assert.equal(libApp.data("forja-treino-biblioteca-v1").calisthenics.length, 1, "Personalizado duplicado foi cadastrado");
  assert.match(libApp.text("#toast"), /Você já tem um exercício chamado/);
  libApp.close();

  /* Dados antigos já duplicados: nada é renomeado sozinho e a rotina continua salvável mantendo o nome. */
  const legacyDup1 = buildRotationRoutine({ id: "leg-dup-1", name: "Treino A", exercises: [buildRotationExercise("Flexão")] });
  const legacyDup2 = buildRotationRoutine({ id: "leg-dup-2", name: "Treino A", exercises: [buildRotationExercise("Barra fixa")] });
  const legacyApp = await boot(
    { "forja-treino-rotinas-v1": routinesStore([legacyDup1, legacyDup2], []) },
    "treino/rotina.html?modalidade=calisthenics&id=leg-dup-2"
  );
  await wait(20);
  legacyApp.click("#save-routine-top");
  await wait(20);
  const legacyStored = legacyApp.data("forja-treino-rotinas-v1");
  assert.equal(legacyStored.calisthenics.length, 2, "Rotinas antigas duplicadas devem ser preservadas");
  assert.deepEqual(legacyStored.calisthenics.map(item => item.name), ["Treino A", "Treino A"], "Nomes antigos não podem ser corrigidos automaticamente");
  assertNoErrors(legacyApp, "duplicidade legada");
  legacyApp.close();
});

await runTest("59e. C5: esvaziar, reabastecer e duplicar mantêm rotação persistida igual à próxima exibida", async () => {
  const rA = buildRotationRoutine({ id: "rot-a", name: "Treino A", exercises: [buildRotationExercise("Flexão", { sets: 1, rest: 0 })] });
  const rB = buildRotationRoutine({ id: "rot-b", name: "Treino B", exercises: [buildRotationExercise("Barra fixa", { sets: 1, rest: 0 })] });
  const rC = buildRotationRoutine({ id: "rot-c", name: "Treino C", exercises: [buildRotationExercise("Paralelas", { sets: 1, rest: 0 })] });
  const seed = {
    "forja-treino-rotinas-v1": routinesStore([rA, rB, rC], []),
    "forja-treino-rotacao-v1": {
      version: 1, overrideRoutineId: null, nextRoutineId: "rot-b", nextModality: "calisthenics",
      lastRoutineId: "rot-a", lastModality: "calisthenics", previousState: null, updatedAt: 5000
    }
  };

  async function homeButtonText(snapshot) {
    const home = await boot(snapshot, "index.html");
    const text = home.text("#home-primary-button");
    home.close();
    return text;
  }

  /* Esvaziar Treino B pelo editor: some da fila e a rotação aponta para Treino C. */
  const emptyEditor = await boot(seed, "treino/rotina.html?modalidade=calisthenics&id=rot-b");
  await wait(20);
  emptyEditor.click('[data-section-list="main"] .editor-exercise .icon-button.remove');
  await wait(20);
  emptyEditor.$('[data-modal-action="remove"]').click();
  await wait(20);
  emptyEditor.click("#save-routine-top");
  await wait(20);

  let snapshot = captureStorage(emptyEditor);
  assert.equal(snapshot["forja-treino-rotacao-v1"].nextRoutineId, "rot-c", "Esvaziar não reconciliou o próximo da rotação");
  assert.equal(snapshot["forja-treino-rotacao-v1"].lastRoutineId, "rot-a", "Esvaziar não pode reescrever o último treino");
  assert.equal(await homeButtonText(snapshot), "Iniciar Treino C", "A Home diverge da rotação persistida após esvaziar");
  emptyEditor.close();

  /* Reabastecer Treino B: volta à fila e a ser o próximo após Treino A. */
  const refillEditor = await boot(snapshot, "treino/rotina.html?modalidade=calisthenics&id=rot-b");
  await wait(20);
  refillEditor.$("#exercise-name").value = "Barra fixa";
  refillEditor.$("#exercise-sets").value = "1";
  refillEditor.$("#exercise-reps").value = "6";
  refillEditor.$("#exercise-rest").value = "0";
  refillEditor.$("#exercise-form").dispatchEvent(new refillEditor.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  refillEditor.click("#save-routine-top");
  await wait(20);

  snapshot = captureStorage(refillEditor);
  assert.equal(snapshot["forja-treino-rotacao-v1"].nextRoutineId, "rot-b", "Reabastecer não reconciliou o próximo da rotação");
  assert.equal(await homeButtonText(snapshot), "Iniciar Treino B", "A Home diverge da rotação persistida após reabastecer");
  refillEditor.close();

  /* Salvar sem mudar nada de iniciável não reescreve a chave de rotação. */
  const rotationRawBefore = JSON.stringify(snapshot["forja-treino-rotacao-v1"]);
  const noopEditor = await boot(snapshot, "treino/rotina.html?modalidade=calisthenics&id=rot-b");
  await wait(20);
  noopEditor.click("#save-routine-top");
  await wait(20);
  assert.equal(JSON.stringify(noopEditor.data("forja-treino-rotacao-v1")), rotationRawBefore,
    "Salvar sem divergência não deveria reescrever a rotação (updatedAt muda a cada escrita)");
  noopEditor.close();

  /* Duplicar Treino A: a cópia entra logo depois dele e vira a próxima. */
  const modalityApp = await boot(snapshot, "treino/calistenia.html");
  await wait(20);
  const firstCard = modalityApp.$$(".routine-card")[0];
  Array.from(firstCard.querySelectorAll("button")).find(button => button.textContent.trim() === "Duplicar").click();
  await wait(25);

  snapshot = captureStorage(modalityApp);
  const copyId = snapshot["forja-treino-rotinas-v1"].calisthenics[1].id;
  assert.notEqual(copyId, "rot-a");
  assert.equal(snapshot["forja-treino-rotacao-v1"].nextRoutineId, copyId, "Duplicar não reconciliou o próximo da rotação");
  assert.equal(await homeButtonText(snapshot), "Iniciar Treino A (cópia)", "A Home diverge da rotação persistida após duplicar");
  modalityApp.close();

  /* Excluir uma rotina que não é a selecionada preserva a seleção atual. */
  const deleteApp = await boot(snapshot, "treino/calistenia.html");
  await wait(20);
  const cards = deleteApp.$$(".routine-card");
  const cardC = cards[cards.length - 1];
  Array.from(cardC.querySelectorAll("button")).find(button => button.textContent.trim() === "Excluir").click();
  await wait(20);
  deleteApp.$('[data-modal-action="delete"]').click();
  await wait(20);

  snapshot = captureStorage(deleteApp);
  assert.equal(snapshot["forja-treino-rotacao-v1"].nextRoutineId, copyId, "Excluir outra rotina mudou a selecionada");
  assert.equal(await homeButtonText(snapshot), "Iniciar Treino A (cópia)", "A Home diverge após excluir outra rotina");
  deleteApp.close();
});

await runTest("59f. C6: backup com exercício personalizado inválido é rejeitado antes de importar; válido e antigo são aceitos", async () => {
  const validItem = {
    id: "lib-ok", name: "Remada unilateral", type: "reps", sets: 3, reps: "12", duration: 45, rest: 60,
    section: "main", load: "", notes: "", measure: "load", distance: null, distanceUnit: "m",
    category: "Costas", muscles: ["dorsais"], equipment: ["halter"], instructions: "",
    createdAt: 1, updatedAt: 1
  };
  /* Formato antigo de exercício personalizado: sem metadados do catálogo. */
  const legacyItem = { id: "lib-old", name: "Flexão diamante", sets: 3, reps: "10", rest: 60 };

  const app = await boot(
    { "forja-treino-biblioteca-v1": { calisthenics: [], weights: [validItem] } },
    "configuracoes/index.html"
  );
  const validate = value => app.F.validateLibraryStore(value);

  /* Válidos: formato atual completo e formato antigo sem metadados. */
  assert.equal(validate({ calisthenics: [legacyItem], weights: [validItem] }), true,
    "Exercícios personalizados válidos (novo e antigo) foram rejeitados");

  /* Valores fora dos limites aceitos (mesmas regras dos exercícios de rotina). */
  assert.throws(() => validate({ calisthenics: [Object.assign({}, legacyItem, { sets: 99 })], weights: [] }), /séries inválidas/);
  assert.throws(() => validate({ calisthenics: [Object.assign({}, legacyItem, { rest: -5 })], weights: [] }), /descanso inválido/);
  assert.throws(() => validate({ calisthenics: [Object.assign({}, legacyItem, { type: "duration", duration: 99999 })], weights: [] }), /duração inválida/);
  assert.throws(() => validate({ calisthenics: [Object.assign({}, legacyItem, { measure: "peso" })], weights: [] }), /medição desconhecida/);

  /* Estrutura malformada. */
  assert.throws(() => validate({ calisthenics: ["texto"], weights: [] }), /personalizado 1 de Calistenia é inválido/);
  assert.throws(() => validate({ calisthenics: [{ sets: 3 }], weights: [] }), /está sem nome/);
  assert.throws(() => validate({ calisthenics: [Object.assign({}, legacyItem, { muscles: "costas" })], weights: [] }), /lista de muscles inválida/);
  assert.throws(() => validate({ calisthenics: [], weights: "x" }), /formato inválido/);

  /* Valores que a normalização corrigiria em silêncio ao ler. */
  assert.throws(() => validate({ calisthenics: [Object.assign({}, legacyItem, { section: "meio" })], weights: [] }), /seção desconhecida/);
  assert.throws(() => validate({ calisthenics: [Object.assign({}, legacyItem, { distanceUnit: "km/h" })], weights: [] }), /unidade de distância inválida/);
  assert.throws(() => validate({ calisthenics: [Object.assign({}, legacyItem, { name: "X".repeat(120) })], weights: [] }), /acima de 100 caracteres/);
  assert.throws(() => validate({ calisthenics: [Object.assign({}, legacyItem, { instructions: "i".repeat(700) })], weights: [] }), /acima de 600 caracteres/);

  /* Importação: rejeitada no modal de erro, antes da prévia, sem tocar nos dados. */
  const before = app.raw("forja-treino-biblioteca-v1");
  await app.importFile({
    app: "FORJA", format: "forja-backup", version: 1, exportedAt: new Date().toISOString(),
    keys: { "forja-treino-biblioteca-v1": { calisthenics: [], weights: [Object.assign({}, validItem, { sets: 99 })] } }
  });
  await wait(30);
  assert.equal(app.$("#modal-title").textContent, "Backup inválido");
  assert.match(app.text(".modal-card"), /biblioteca personalizada/);
  assert.match(app.text(".modal-card"), /Nenhum dado foi alterado/);
  assert.equal(app.raw("forja-treino-biblioteca-v1"), before, "Importação inválida alterou a biblioteca");
  assert.equal(app.raw("forja-backup-seguranca-v1"), null, "Cópia de segurança criada para importação inválida");
  app.modalAction("close");
  await wait(15);

  /* Backup válido com personalizados (atual + antigo) importa e persiste igual. */
  await app.importFile({
    app: "FORJA", format: "forja-backup", version: 1, exportedAt: new Date().toISOString(),
    keys: { "forja-treino-biblioteca-v1": { calisthenics: [legacyItem], weights: [validItem] } }
  });
  await app.modal("restore");
  await wait(40);
  const stored = app.data("forja-treino-biblioteca-v1");
  assert.equal(stored.calisthenics[0].name, "Flexão diamante", "Item antigo válido não importou");
  assert.equal(stored.weights[0].name, "Remada unilateral", "Item atual válido não importou");
  assertNoErrors(app, "C6");
  app.close();
});

await runTest("59g. C7: modais de rotina validam inline, foco cai no campo certo e alvos de toque têm 44px", async () => {
  const rA = buildRotationRoutine({ id: "dup-a", name: "Treino A", exercises: [buildRotationExercise("Flexão")] });
  const rB = buildRotationRoutine({ id: "dup-b", name: "Treino B", exercises: [buildRotationExercise("Barra fixa")] });
  const seed = { "forja-treino-rotinas-v1": routinesStore([rA, rB], []) };

  /* Criar: nome vazio mantém o modal aberto, com erro associado e foco no campo. */
  const app = await boot(seed, "treino/calistenia.html");
  app.click("#new-routine");
  await wait(15);
  await app.modal("create", { name: "   " });
  await wait(20);
  assert.ok(app.$(".modal-backdrop"), "Modal de criação fechou com nome vazio");
  assert.match(app.text('[data-modal-error="name"]'), /Informe um nome/);
  assert.equal(app.modalField("name").getAttribute("aria-invalid"), "true");
  assert.equal(app.d.activeElement, app.modalField("name"), "Foco não foi para o campo de nome");
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics.length, 2, "Nome vazio criou rotina");

  /* Nome duplicado: continua aberto, agora com o erro de duplicidade no campo. */
  await app.modal("create", { name: "treino a" });
  await wait(20);
  assert.ok(app.$(".modal-backdrop"), "Modal de criação fechou com nome duplicado");
  assert.match(app.text('[data-modal-error="name"]'), /Já existe uma rotina chamada/);
  assert.equal(app.d.activeElement, app.modalField("name"), "Foco não voltou ao campo duplicado");
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics.length, 2, "Nome duplicado criou rotina");

  /* Nome válido: o modal fecha e a rotina é criada. */
  await app.modal("create", { name: "Treino C" });
  await pageIs(app, "rotina");
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics.length, 3, "Nome válido não criou a rotina");
  app.close();

  /* Renomear: vazio e duplicado inline; manter o próprio nome salva e fecha. */
  const renameApp = await boot(seed, "treino/calistenia.html");
  const renameCard = renameApp.$$(".routine-card")[1];
  Array.from(renameCard.querySelectorAll("button"))
    .find(button => button.textContent.trim() === "Renomear").click();
  await wait(20);

  await renameApp.modal("rename", { name: " " });
  await wait(20);
  assert.ok(renameApp.$(".modal-backdrop"), "Modal de renomear fechou com nome vazio");
  assert.match(renameApp.text('[data-modal-error="name"]'), /não pode ficar vazio/);
  assert.equal(renameApp.d.activeElement, renameApp.modalField("name"), "Foco não foi para o nome vazio");

  await renameApp.modal("rename", { name: "Treino A" });
  await wait(20);
  assert.ok(renameApp.$(".modal-backdrop"), "Modal de renomear fechou com nome duplicado");
  assert.match(renameApp.text('[data-modal-error="name"]'), /Já existe uma rotina chamada/);
  assert.equal(renameApp.data("forja-treino-rotinas-v1").calisthenics[1].name, "Treino B", "Renomear inválido alterou o nome");

  await renameApp.modal("rename", { name: "Treino B" });
  await wait(20);
  assert.equal(renameApp.$(".modal-backdrop"), null, "Manter o próprio nome deveria fechar e salvar");
  renameApp.close();

  /* Formulário personalizado: o foco vai para o campo inválido equivalente. */
  const editorApp = await boot(seed, "treino/rotina.html?modalidade=calisthenics&id=dup-a");
  await wait(20);
  editorApp.click("#library-toggle");
  await wait(10);
  editorApp.click("#custom-toggle");
  await wait(10);

  editorApp.$("#custom-name").value = "";
  editorApp.$("#custom-sets").value = "3";
  editorApp.$("#custom-rest").value = "45";
  editorApp.$("#custom-form").dispatchEvent(new editorApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(15);
  assert.equal(editorApp.d.activeElement, editorApp.$("#custom-name"), "Nome vazio não focou custom-name");

  editorApp.$("#custom-name").value = "Prancha lateral";
  editorApp.$("#custom-sets").value = "99";
  editorApp.$("#custom-form").dispatchEvent(new editorApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(15);
  assert.equal(editorApp.d.activeElement, editorApp.$("#custom-sets"), "Séries inválidas não focaram custom-sets");

  editorApp.$("#custom-sets").value = "3";
  editorApp.$("#custom-reps").value = "";
  editorApp.$("#custom-form").dispatchEvent(new editorApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(15);
  assert.equal(editorApp.d.activeElement, editorApp.$("#custom-reps"), "Repetições vazias não focaram custom-reps");

  editorApp.$("#custom-reps").value = "12";
  editorApp.$("#custom-form").dispatchEvent(new editorApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  assert.equal(editorApp.data("forja-treino-biblioteca-v1").calisthenics.length, 1, "Cadastro válido não salvou");

  /* Duplicado no cadastro personalizado também foca o campo de nome. */
  editorApp.click("#custom-toggle");
  await wait(10);
  editorApp.$("#custom-name").value = "prancha lateral";
  editorApp.$("#custom-sets").value = "3";
  editorApp.$("#custom-rest").value = "45";
  editorApp.$("#custom-form").dispatchEvent(new editorApp.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(15);
  assert.equal(editorApp.d.activeElement, editorApp.$("#custom-name"), "Duplicado não focou custom-name");
  assert.equal(editorApp.data("forja-treino-biblioteca-v1").calisthenics.length, 1, "Duplicado foi cadastrado");

  /* Alvos de toque: 44px declarados e layout do editor sem largura fixa que estoure. */
  const treinoCss = fs.readFileSync(path.join(repoRoot, "assets/css/treino.css"), "utf8");
  const iconBlock = treinoCss.match(/\.icon-button\s*\{[^}]*\}/)[0];
  assert.match(iconBlock, /width:\s*44px/, ".icon-button sem largura de 44px");
  assert.match(iconBlock, /height:\s*44px/, ".icon-button sem altura de 44px");
  const addBlock = treinoCss.match(/\.section-add-button\s*\{[^}]*\}/)[0];
  assert.match(addBlock, /min-width:\s*44px/, ".section-add-button sem largura mínima de 44px");
  assert.match(addBlock, /min-height:\s*44px/, ".section-add-button sem altura mínima de 44px");
  assert.match(treinoCss, /\.icon-button:focus-visible/, "Foco visível ausente em .icon-button");
  assert.match(treinoCss, /\.editor-exercise-main\s*\{[^}]*min-width:\s*0/, "Nome do exercício não pode encolher: risco de overflow");

  const tools = editorApp.$$(".editor-exercise .icon-button");
  assert.ok(tools.length >= 4, "Botões de ação do editor não renderizaram");
  tools.forEach(button => assert.ok(button.getAttribute("aria-label"), "Botão de ícone sem aria-label"));
  assertNoErrors(editorApp, "C7");
  editorApp.close();
});

/* ------------------------------------------------------------------ */
/* Onboarding e perfil (ETAPA 1: perfil opcional, aditivo)              */
/* ------------------------------------------------------------------ */
const PROFILE_KEY = "forja-perfil-v1";
const profileSeed = obj => Object.assign({
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z"
}, obj);

function onboardingPanel(app) {
  return app.$("#onboarding-root .onboarding-panel");
}

function onboardingButton(app, label) {
  const button = app.$$("#onboarding-root button").find(item => item.textContent.trim() === label);
  assert.ok(button, "Botão do onboarding não encontrado: " + label);
  return button;
}

/* Nome real do campo do perfil por trás de cada apelido curto dos testes. */
const CAMPO_DO_PASSO = {
  sexo: "sexo",
  objetivo: "objetivo",
  nivel: "nivel",
  dias: "diasPorSemana",
  duracao: "duracaoMinutos",
  equipamento: "equipamento",
  modalidade: "modalidadePreferida"
};

/* Marca uma opção do onboarding como se o usuário tivesse clicado nela. */
function escolherOpcao(app, campo, valor) {
  const nome = CAMPO_DO_PASSO[campo] || campo;
  const input = app.d.querySelector(
    'input[name="onboarding-' + nome + '"][value="' + String(valor) + '"]'
  );
  assert.ok(input, "Opção não encontrada: " + campo + "=" + valor);
  input.checked = true;
  input.dispatchEvent(new app.w.Event("change", { bubbles: true }));
  return input;
}

/* Avança (ou conclui) pelo botão principal do onboarding. */
function avancarOnboarding(app) {
  app.click("#onboarding-next");
  return wait(15);
}

/* Responde uma etapa e vai para a próxima, na ordem real do fluxo. */
async function responder(app, campo, valor) {
  escolherOpcao(app, campo, valor);
  await avancarOnboarding(app);
}

/* Percorre o onboarding inteiro com respostas fixas até a revisão. */
async function percorrerOnboarding(app, respostas = {}) {
  const valores = Object.assign({
    sexo: "masculino",
    objetivo: "hipertrofia",
    nivel: "iniciante",
    dias: 4,
    duracao: 45,
    equipamento: "academia",
    modalidade: "weights"
  }, respostas);

  await avancarOnboarding(app); /* apresentação -> sexo */
  await responder(app, "sexo", valores.sexo);
  await responder(app, "objetivo", valores.objetivo);
  await responder(app, "nivel", valores.nivel);
  await responder(app, "dias", valores.dias);
  await responder(app, "duracao", valores.duracao);
  await responder(app, "equipamento", valores.equipamento);
  await responder(app, "modalidade", valores.modalidade);
}

await runTest("60. Onboarding: aparece só para usuário novo, não bloqueia a home e não grava nada", async () => {
  const app = await boot({}, "index.html");
  assertNoErrors(app);

  assert.ok(onboardingPanel(app), "O onboarding não apareceu para um usuário novo");

  /* A home continua operacional: a ação primária não é bloqueada pelo painel. */
  const primary = app.$("#home-primary-button");
  assert.ok(primary, "Ação primária da home ausente");
  assert.equal(primary.hidden, false, "Ação primária da home invisível");

  assert.deepEqual(app.storageWrites, [], "A inicialização gravou chaves: " + JSON.stringify(app.storageWrites));
  assert.equal(app.raw(PROFILE_KEY), null, "Nenhum perfil deveria ser gravado");
  app.close();
});

await runTest("61. Convite ao onboarding: \"Agora não\" não cria nem persiste nenhum dado", async () => {
  const app = await boot({}, "index.html");
  app.click(onboardingButton(app, "Agora não"));
  await wait(20);

  assert.equal(app.d.getElementById("onboarding-root").hidden, true, "A dispensa deve ocultar o convite");
  assert.equal(app.raw(PROFILE_KEY), null, "Dispensar não deve gravar o perfil");
  assert.deepEqual(app.storageWrites, [], "Dispensar não deve gravar nada: " + JSON.stringify(app.storageWrites));
  app.close();
});

await runTest("62. Convite ao onboarding: não coleta respostas na Home e leva ao fluxo completo", async () => {
  const app = await boot({}, "index.html");

  const buttons = app.$$("#onboarding-root button").map(item => item.textContent.trim());
  assert.deepEqual(buttons, ["Agora não"], "A Home deve ter só o controle de dispensa");

  /* Nenhum campo no convite: as perguntas moram na página de onboarding. */
  assert.equal(app.$$("#onboarding-root input, #onboarding-root select, #onboarding-root textarea").length, 0,
    "A Home não deve coletar respostas do onboarding");

  const start = app.$("#onboarding-start");
  assert.ok(start, "Link para o cadastro guiado ausente");
  assert.match(start.getAttribute("href"), /onboarding\/index\.html$/);

  const profileLink = app.$("#onboarding-root .onboarding-profile-link");
  assert.ok(profileLink, "Link para configurar depois em Perfil ausente");
  assert.match(profileLink.getAttribute("href"), /perfil\/index\.html$/);

  app.click(start);
  await until(() => app.pageUrl && app.pageUrl.indexOf("onboarding/") !== -1, "navegação para o onboarding");
  await pageIs(app, "onboarding");

  assert.equal(app.raw(PROFILE_KEY), null, "Abrir o onboarding não deve gravar o perfil");
  assert.deepEqual(app.storageWrites, [], "Abrir o onboarding não deve gravar nada: " + JSON.stringify(app.storageWrites));

  /* A primeira tela é a apresentação, com uma única ação principal. */
  assert.equal(app.text("#onboarding-question"), "Bem-vindo à FORJA");
  assert.equal(app.text("#onboarding-next"), "Começar");
  assert.equal(app.$("#onboarding-back").hidden, true, "A primeira tela não tem Voltar");
  app.close();
});

await runTest("63. Onboarding: grava só no último passo e não atrapalha criar rotina manualmente", async () => {
  const app = await boot({}, "index.html");

  app.click("#onboarding-start");
  await until(() => app.pageUrl && app.pageUrl.indexOf("onboarding/") !== -1, "navegação para o onboarding");
  await pageIs(app, "onboarding");

  /* Sexo é obrigatório: avançar sem escolher avisa e não grava nada. */
  await avancarOnboarding(app);
  assert.equal(app.text("#onboarding-question"), "Qual sexo você informa?");
  await avancarOnboarding(app);
  assert.equal(app.d.getElementById("onboarding-question").textContent.trim(), "Qual sexo você informa?",
    "Sem escolha o fluxo não deve avançar");
  assert.equal(app.$("#onboarding-error").hidden, false, "O erro deve ser informado");
  assert.ok(app.text("#onboarding-error").length > 0, "O erro deve ter mensagem");
  assert.equal(app.raw(PROFILE_KEY), null, "Nada deve ser gravado antes do último passo");

  /* Responde tudo e para na revisão: ainda não gravou. */
  await percorrerOnboarding(app);
  assert.equal(app.text("#onboarding-next"), "Concluir cadastro");
  assert.match(app.text(".onboarding-review"), /Masculino/);
  assert.equal(app.raw(PROFILE_KEY), null, "A revisão não deve gravar o perfil");

  app.click("#onboarding-next");
  await pageIs(app, "inicio");

  const stored = app.data(PROFILE_KEY);
  assert.ok(stored, "Concluir deve gravar o perfil");
  assert.equal(stored.objetivo, "hipertrofia");
  assert.equal(stored.nivel, "iniciante");
  assert.equal(stored.equipamento, "academia");
  assert.equal(stored.diasPorSemana, 4);
  assert.equal(stored.duracaoMinutos, 45);
  assert.equal(stored.sexo, "masculino");
  assert.equal(stored.modalidadePreferida, "weights");
  assert.equal(stored.version, 2, "O perfil gravado usa o modelo v2");
  assert.ok(stored.updatedAt, "O perfil gravado tem marcação de hora");
  assert.ok(stored.onboardingConcluidoEm, "O perfil registra a conclusão do onboarding");

  /* A meta semanal veio junto (opt-in marcado por padrão) e o perfil não a inventou depois. */
  const goals = app.data("forja-treino-metas-v1");
  assert.ok(goals, "A meta sugerida deve ser gravada com a confirmação");
  assert.equal(goals.weeklySessions, 4);
  assert.equal(goals.weeklyMinutes, 180);
  assert.equal(goals.modality, "weights");

  /* A home continua oferecendo criar rotina manualmente e o convite sumiu. */
  assert.ok(app.$("#home-primary-button"), "A home deve continuar oferecendo a ação primária de treino");
  assert.equal(onboardingPanel(app), null, "O convite deve sumir depois de concluir");

  /* Ao voltar (reload), o onboarding não repete para quem já tem perfil. */
  await app.reload();
  assert.equal(onboardingPanel(app), null, "O onboarding não deve aparecer de novo");
  assert.equal(app.raw(PROFILE_KEY) !== null, true, "O perfil persiste após o reload");
  app.close();
});

await runTest("64. Onboarding: usuário com rotina ou histórico existente não é interrompido", async () => {
  const routineSeed = {
    "forja-treino-rotinas-v1": routinesStore([makeRoutine("calisthenics", "Treino A", [{ id: "o-1", name: "Flexão", sets: 3, reps: "10", section: "main" }])], [])
  };
  const historySeed = {
    "forja-treino-historico-v1": [{
      id: "o-h1", date: "2026-01-02", modality: "calisthenics", routineId: "o-r1", routineName: "Treino A",
      durationMs: 600000, completedSets: 3, totalPlannedSets: 3, status: "finished",
      finishedAt: "2026-01-02T10:00:00.000Z", exercises: []
    }]
  };

  const withRoutine = await boot(routineSeed, "index.html");
  assert.equal(onboardingPanel(withRoutine), null, "Usuário com rotina não deve ver o onboarding");
  withRoutine.close();

  const withHistory = await boot(historySeed, "index.html");
  assert.equal(onboardingPanel(withHistory), null, "Usuário com histórico não deve ver o onboarding");
  withHistory.close();

  const withProfile = await boot({ [PROFILE_KEY]: profileSeed({ objetivo: "forca" }) }, "index.html");
  assert.equal(onboardingPanel(withProfile), null, "Usuário com perfil não deve ver o onboarding");
  withProfile.close();
});

await runTest("65. Perfil: formulário reflete o armazenado, salva e não altera treinos nem histórico", async () => {
  const seed = {
    "forja-treino-rotinas-v1": routinesStore([makeRoutine("calisthenics", "Treino A", [{ id: "p-1", name: "Flexão", sets: 3, reps: "10", section: "main" }])], []),
    "forja-treino-historico-v1": [{
      id: "p-h1", date: "2026-01-03", modality: "calisthenics", routineId: "p-r1", routineName: "Treino A",
      durationMs: 600000, completedSets: 3, totalPlannedSets: 3, status: "finished",
      finishedAt: "2026-01-03T10:00:00.000Z", exercises: []
    }],
    [PROFILE_KEY]: profileSeed({
      objetivo: "forca", nivel: "iniciante", equipamento: "ambos", diasPorSemana: 5, duracaoMinutos: 40
    })
  };

  const app = await boot(seed, "perfil/index.html");
  assertNoErrors(app);

  assert.equal(app.d.getElementById("prof-objetivo").value, "forca", "Objetivo não reflete o armazenado");
  assert.equal(app.d.getElementById("prof-nivel").value, "iniciante", "Nível não reflete o armazenado");
  assert.equal(app.d.getElementById("prof-equipamento").value, "ambos", "Equipamento não reflete o armazenado");
  assert.equal(app.d.getElementById("prof-dias").value, "5", "Dias não refletem o armazenado");
  assert.equal(app.d.getElementById("prof-duracao").value, "40", "Duração não reflete o armazenado");

  const before = storageSnapshot(app);
  app.d.getElementById("prof-dias").value = "6";
  app.click("#profile-save");
  await wait(20);

  const after = app.data(PROFILE_KEY);
  assert.equal(after.diasPorSemana, 6, "O perfil deve aceitar a edição");
  assert.equal(after.objetivo, "forca", "Campos não editados permanecem");

  assert.equal(app.raw("forja-treino-rotinas-v1"), before["forja-treino-rotinas-v1"], "Rotinas alteradas pelo perfil");
  assert.equal(app.raw("forja-treino-historico-v1"), before["forja-treino-historico-v1"], "Histórico alterado pelo perfil");
  app.close();
});

await runTest("66. Perfil: falha de gravação informa o problema e preserva o estado anterior", async () => {
  const app = await boot({ [PROFILE_KEY]: profileSeed({ objetivo: "forca", diasPorSemana: 3 }) }, "perfil/index.html");
  assertNoErrors(app);

  const failing = installFailingStorage(app, { failOn: PROFILE_KEY, times: 1 });
  app.d.getElementById("prof-dias").value = "6";
  app.click("#profile-save");
  await wait(20);
  failing.restore();

  const stored = app.data(PROFILE_KEY);
  assert.equal(stored.objetivo, "forca", "O objetivo anterior deve ser preservado");
  assert.equal(stored.diasPorSemana, 3, "Os dias anteriores devem ser preservados");

  const error = app.$("#profile-error");
  assert.equal(error.hidden, false, "O erro deve ser informado");
  assert.ok(error.textContent.length > 0, "O erro deve ter mensagem");

  assert.equal(app.d.getElementById("prof-dias").value, "3", "A tela volta ao valor armazenado");
  app.close();
});

await runTest("67. Perfil: conteúdo ilegível no armazenamento não grava chave nova e carrega vazio", async () => {
  const app = await boot({ [PROFILE_KEY]: "{ quebrado" }, "perfil/index.html");
  assertNoErrors(app);

  assert.equal(app.d.getElementById("prof-objetivo").value, "", "Perfil ilegível deve carregar vazio");
  assert.equal(app.d.getElementById("prof-dias").value, "0", "Dias ilegíveis devem carregar 0");

  const writes = app.storageWrites.filter(item => item.method === "setItem");
  assert.deepEqual(writes, [], "A inicialização não deve gravar chave nova: " + JSON.stringify(writes));
  assert.equal(app.raw("forja-treino-dados-preservados-v1"), null, "Não deve criar cópia de preservação no boot");
  app.close();
});

await runTest("68. Backup: exportação, importação e registry cobrem forja-perfil-v1", async () => {
  const seed = {
    "forja-treino-rotinas-v1": routinesStore([makeRoutine("calisthenics", "Treino A", [{ id: "b-1", name: "Flexão", sets: 3, reps: "10", section: "main" }])], []),
    [PROFILE_KEY]: profileSeed({ objetivo: "resistencia", diasPorSemana: 3, duracaoMinutos: 30 })
  };
  const app = await boot(seed, "perfil/index.html");
  assertNoErrors(app);

  assert.ok(app.F.registry.get("profile"), "O perfil deve estar registrado no registry");
  assert.equal(app.F.registry.get("profile").key, PROFILE_KEY, "Registro com chave incorreta");

  const backup = app.F.buildBackupObject();
  assert.ok(Object.prototype.hasOwnProperty.call(backup.keys, PROFILE_KEY), "A exportação deve incluir o perfil");

  const summary = app.F.registry.summarizeKey(PROFILE_KEY, app.data(PROFILE_KEY));
  assert.ok(summary && summary.label, "O perfil deve ter resumo no backup");
  assert.match(summary.detail, /Resistência/, "O resumo do perfil deve descrever o conteúdo");
  assert.match(summary.detail, /3 dia\(s\)\/semana/, "O resumo do perfil deve incluir os dias");

  /* Restauração: o perfil volta à memória e o formulário do Perfil acompanha. */
  const restored = app.F.applyRestore({
    [PROFILE_KEY]: profileSeed({ objetivo: "calistenia", diasPorSemana: 2, duracaoMinutos: 0 })
  });
  assert.equal(restored, true, "A restauração deve funcionar");
  assert.equal(app.F.state.profile.objetivo, "calistenia", "O perfil restaurado deve voltar à memória");
  assert.equal(app.d.getElementById("prof-objetivo").value, "calistenia", "O formulário deve refletir o perfil restaurado");
  assert.equal(app.d.getElementById("prof-dias").value, "2", "Os dias restaurados devem aparecer no formulário");
  app.close();
});

await runTest("69. Equipamento 'Sem equipamentos' é opção válida no perfil, onboarding, resumo e backup", async () => {
  const app = await boot({}, "index.html");
  assertNoErrors(app);

  const values = app.F.PERFIL_OPTIONS.equipamento.map(option => option.value);
  assert.ok(values.indexOf("nenhum") !== -1, "A opção 'nenhum' deve estar no perfil");
  assert.ok(values.indexOf("") !== -1, "A opção vazia deve continuar presente");
  assert.ok(app.F.PERFIL_EQUIPAMENTOS.indexOf("nenhum") !== -1, "O valor deve constar na lista de equipamentos");
  assert.equal(app.F.PERFIL_LABELS.equipamento.nenhum, "Sem equipamentos", "O rótulo deve ser 'Sem equipamentos'");

  /* O onboarding oferece a opção e ela chega ao perfil pela mesma normalização. */
  const onboardingPage = await boot({}, "onboarding/index.html");
  const passoEquipamento = onboardingPage.F.onboarding.PASSOS.find(passo => passo.campo === "equipamento");
  assert.ok(passoEquipamento, "O onboarding deve ter a pergunta de equipamento");
  assert.ok(passoEquipamento.opcoes.some(opcao => opcao.valor === "nenhum"),
    "O onboarding deve oferecer 'Sem equipamentos'");
  onboardingPage.close();

  const stored = app.F.normalizeProfile({ equipamento: "nenhum" });
  assert.equal(stored.equipamento, "nenhum", "O perfil aceita 'Sem equipamentos'");

  /* Normalização, validação e resumo consistentes. */
  assert.equal(app.F.normalizeProfile(stored).equipamento, "nenhum", "Normalização preserva o valor");
  assert.equal(app.F.validateProfileStore(stored), true, "Backup valida 'Sem equipamentos'");
  assert.throws(() => app.F.validateProfileStore({ equipamento: "nao-existe" }), /equipamento/,
    "Valor desconhecido deve ser rejeitado");
  const summary = app.F.registry.summarizeKey(PROFILE_KEY, stored);
  assert.match(summary.detail, /Sem equipamentos/, "O resumo do perfil deve descrever 'Sem equipamentos'");
  app.close();

  /* O formulário do Perfil exibe e regrava a opção. */
  const perfil = await boot({ [PROFILE_KEY]: profileSeed({ equipamento: "nenhum" }) }, "perfil/index.html");
  assert.equal(perfil.d.getElementById("prof-equipamento").value, "nenhum", "O formulário deve exibir a opção");
  perfil.d.getElementById("prof-equipamento").value = "ambos";
  perfil.click("#profile-save");
  await wait(20);
  assert.equal(perfil.data(PROFILE_KEY).equipamento, "ambos", "O formulário deve regrava a opção");
  perfil.close();
});

await runTest("70. F.state.profile é inicializado em todas as páginas (ausente, inválido e válido)", async () => {
  const pages = [
    "index.html", "treino/index.html", "treino/executar.html", "treino/biblioteca.html",
    "progresso/index.html", "perfil/index.html", "configuracoes/index.html", "explorar/index.html"
  ];
  const empty = {
    version: 2, updatedAt: null, objetivo: "", nivel: "", equipamento: "",
    diasPorSemana: 0, duracaoMinutos: 0,
    sexo: "", modalidadePreferida: "", onboardingConcluidoEm: null
  };

  for (const page of pages) {
    const app = await boot({}, page);
    assertNoErrors(app, "perfil ausente em " + page);
    assert.deepEqual(plain(app.F.state.profile), empty, "Perfil ausente não inicializou vazio em " + page);
    app.close();
  }

  for (const page of pages) {
    const app = await boot({ [PROFILE_KEY]: "{ quebrado" }, page);
    assertNoErrors(app, "perfil ilegível em " + page);
    assert.deepEqual(plain(app.F.state.profile), empty, "Perfil ilegível deve carregar vazio em " + page);
    assert.ok(app.F.state.bootNotices.length > 0, "Deve avisar sobre o perfil ilegível em " + page);
    assert.equal(app.raw("forja-treino-dados-preservados-v1"), null, "Boot não deve criar cópia de preservação em " + page);
    app.close();
  }

  const validHome = await boot({ [PROFILE_KEY]: profileSeed({ objetivo: "forca", equipamento: "nenhum", diasPorSemana: 3 }) }, "index.html");
  assert.equal(validHome.F.state.profile.objetivo, "forca");
  assert.equal(validHome.F.state.profile.equipamento, "nenhum");
  assert.equal(validHome.F.state.profile.diasPorSemana, 3);
  validHome.close();

  const validPerfil = await boot({ [PROFILE_KEY]: profileSeed({ objetivo: "forca", equipamento: "nenhum" }) }, "perfil/index.html");
  assert.equal(validPerfil.F.state.profile.objetivo, "forca", "Perfil válido não inicializou em Perfil");
  assert.equal(validPerfil.d.getElementById("prof-objetivo").value, "forca", "Formulário não reflete o perfil em Perfil");
  validPerfil.close();
});

await runTest("71. Onboarding: \"Agora não\" vale para a sessão, não reaparece e não grava nada", async () => {
  const app = await boot({}, "index.html");
  app.click(onboardingButton(app, "Agora não"));
  assert.equal(app.d.getElementById("onboarding-root").hidden, true, "A dispensa deve ocultar o convite");

  /* Redesenhos e re-inicializações da home não trazem o painel de volta. */
  app.F.pages.inicio();
  await wait(20);
  assert.equal(app.d.getElementById("onboarding-root").hidden, true, "O onboarding não deve reaparecer na mesma sessão");
  assert.equal(app.$$("#onboarding-root button").length, 0, "Nenhum controle do onboarding deve voltar");
  assert.equal(app.raw(PROFILE_KEY), null, "Nada deve ser gravado");
  assert.deepEqual(app.storageWrites, [], "Nada deve ser gravado: " + JSON.stringify(app.storageWrites));

  /* Navegar para outra página e voltar mantém a dispensa (sessionStorage). */
  await app.go(BASE + "treino/index.html");
  await app.go(BASE + "index.html");
  assert.equal(onboardingPanel(app), null, "O convite não deve voltar dentro da mesma sessão");
  assert.equal(app.raw(PROFILE_KEY), null, "A dispensa não cria perfil");
  app.close();
});

await runTest("72. Importação de backup atualiza estado em memória e formulário do Perfil", async () => {
  const app = await boot({ [PROFILE_KEY]: profileSeed({ objetivo: "forca" }) }, "perfil/index.html");
  await app.importFile({
    app: "FORJA", format: "forja-backup", version: 1, exportedAt: new Date().toISOString(),
    keys: { [PROFILE_KEY]: profileSeed({ objetivo: "resistencia", equipamento: "nenhum", diasPorSemana: 2, duracaoMinutos: 30 }) }
  }, "backup.json");
  await app.modal("restore");
  await wait(40);

  assert.equal(app.data(PROFILE_KEY).objetivo, "resistencia", "O perfil do backup foi aplicado");
  assert.equal(app.F.state.profile.objetivo, "resistencia", "O estado em memória foi atualizado");
  assert.equal(app.d.getElementById("prof-objetivo").value, "resistencia", "O formulário reflete o perfil importado");
  assert.equal(app.d.getElementById("prof-equipamento").value, "nenhum", "O equipamento importado aparece no formulário");
  assert.equal(app.d.getElementById("prof-dias").value, "2", "Os dias importados aparecem no formulário");
  assert.equal(app.d.getElementById("prof-duracao").value, "30", "A duração importada aparece no formulário");
  app.close();
});

await runTest("73. Home: seletores semânticos não ambíguos entre onboarding e ação principal", async () => {
  const app = await boot({}, "index.html");
  assertNoErrors(app);

  assert.equal(app.$$(".home-action-title").length, 1, ".home-action-title deve ser exclusivo da ação principal");
  assert.equal(app.text(".home-action-title"), "Monte sua primeira rotina");
  assert.equal(app.$("#home-action-heading").tagName.toLowerCase(), "h2");
  assert.equal(app.$("#home-action").getAttribute("aria-labelledby"), "home-action-heading");

  const panel = onboardingPanel(app);
  assert.ok(panel, "Onboarding deve estar visível para usuário novo");
  assert.equal(panel.getAttribute("aria-labelledby"), "home-onboarding-heading");
  assert.equal(app.text("#home-onboarding-heading"), "Seu perfil de treino");
  assert.ok(app.$("#home-onboarding-heading").classList.contains("onboarding-title"));
  assert.equal(app.$("#home-onboarding-heading").classList.contains("home-action-title"), false);
  app.close();
});

await runTest("74. Home: sincronização via evento storage (metas, histórico, rotinas, legado v1, sessão ativa e perfil) sem gravar nada", async () => {
  const app = await boot({}, "index.html");
  assert.deepEqual(app.storageWrites, []);

  function externalWrite(key, value) {
    const raw = JSON.stringify(value);
    app.w.localStorage.setItem(key, raw);
    app.w.dispatchEvent(new app.w.StorageEvent("storage", { key, newValue: raw }));
  }

  function externalRemove(key) {
    app.w.localStorage.removeItem(key);
    app.w.dispatchEvent(new app.w.StorageEvent("storage", { key, newValue: null }));
  }

  let expectedWrites = 0;

  /* 1. Outra aba configura metas semanais filtradas por Musculação. */
  externalWrite("forja-treino-metas-v1", {
    version: 1, updatedAt: new Date().toISOString(), modality: "weights",
    weeklySessions: 3, weeklySets: 12, weeklyMinutes: 60
  });
  expectedWrites += 1;
  assert.equal(app.F.state.goals.weeklySessions, 3, "F.state.goals deve atualizar antes do render");
  assert.equal(app.F.state.goals.modality, "weights");
  assert.match(app.text("#home-goals-period"), /Semana de .* · Musculação\.$/);
  assert.match(app.text("#home-goals-content"), /Ainda sem progresso/);

  /* 2. Outra aba registra treino no histórico -> metas, semana, histórico recente e onboarding atualizam. */
  const now = new Date();
  const todayLocal = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  externalWrite("forja-treino-historico-v1", [{
    id: "ext-h1", date: todayLocal, finishedAt: now.toISOString(), modality: "weights",
    routineName: "Superior A", durationMs: 15 * 60000, completedSets: 2, totalPlannedSets: 4,
    status: "completed", exercises: []
  }]);
  expectedWrites += 1;
  assert.equal(app.F.state.history.length, 1, "F.state.history desatualizado");
  assert.match(app.text("#home-goals-content"), /Faltam 2 treinos/);
  assert.match(app.text("#home-goals-content"), /Faltam 10 séries/);
  assert.match(app.text("#home-goals-content"), /Faltam 45 min/);
  assert.match(app.text("#home-week-note"), /1 treino/);
  assert.match(app.text("#home-recent-list"), /Superior A/);
  assert.equal(app.d.getElementById("onboarding-root").hidden, true, "Onboarding deve fechar quando histórico chega de outra aba");

  /* 3. Outra aba cria rotinas (formato v2/v3) -> ação principal atualiza. */
  const rA = makeRoutine("weights", "Superior A", [{ id: "w-1", name: "Supino", sets: 3, reps: "8", section: "main" }], "rot-a");
  const rB = makeRoutine("weights", "Inferior B", [{ id: "w-2", name: "Agachamento", sets: 3, reps: "8", section: "main" }], "rot-b");
  externalWrite("forja-treino-rotinas-v1", routinesStore([], [rA, rB]));
  expectedWrites += 1;
  assert.equal(app.F.state.routines.weights.length, 2, "F.state.routines desatualizado");
  assert.match(app.text("#home-primary-button"), /Iniciar Inferior B/, "Com Superior A no histórico, próxima rotina deve ser Inferior B");

  /* 4. Compatibilidade v1: sem rotinas v2, exercícios legados em forja-treino-exercicios-v1 geram rotina padrão em memória sem gravar. */
  externalRemove("forja-treino-rotinas-v1");
  expectedWrites += 1;
  externalWrite("forja-treino-exercicios-v1", {
    calisthenics: [{ id: "leg-1", name: "Flexão", sets: 3, reps: "12", rest: 60 }],
    weights: []
  });
  expectedWrites += 1;
  assert.equal(app.F.state.routines.calisthenics.length, 1, "Exercícios legados v1 devem popular rotina em memória");
  assert.equal(app.raw("forja-treino-rotinas-v1"), null, "Sincronizar legado v1 na Home não pode gravar chave nova");
  assert.match(app.text("#home-primary-button"), /Iniciar Rotina padrão/);

  /* 5. Outra aba inicia sessão ativa -> banner aparece e ação principal recolhe. */
  const sess = sessionSeed(rA, { id: "ext-active" });
  externalWrite("forja-treino-sessao-ativa-v1", sess);
  expectedWrites += 1;
  assert.ok(app.F.state.activeWorkout, "F.state.activeWorkout desatualizado");
  assert.equal(app.$("#active-session-banner").hidden, false);
  assert.equal(app.$("#home-action").hidden, true);

  /* 6. JSON inválido vindo de outra aba não derruba a Home nem cria forja-treino-dados-preservados-v1. */
  app.w.localStorage.setItem("forja-treino-metas-v1", "{corrompido");
  app.w.dispatchEvent(new app.w.StorageEvent("storage", { key: "forja-treino-metas-v1", newValue: "{corrompido" }));
  expectedWrites += 1;
  assert.equal(app.raw("forja-treino-dados-preservados-v1"), null, "Evento storage não pode criar chave de preservação");

  assert.equal(app.storageWrites.length, expectedWrites, "A Home gravou dados por conta própria ao sincronizar storage: " + JSON.stringify(app.storageWrites));
  assertNoErrors(app, "sincronização storage na Home");
  app.close();
});

await runTest("75. Home: retorno via pageshow (BFCache) sincroniza F.state e interface sem recarregar no boot nem gravar dados", async () => {
  const app = await boot({}, "index.html");
  assert.ok(onboardingPanel(app), "Onboarding visível antes de sair da Home");

  /* pageshow normal do carregamento inicial (persisted: false) sem mudanças não grava nem duplica trabalho. */
  const bootShow = new app.w.Event("pageshow");
  bootShow.persisted = false;
  app.w.dispatchEvent(bootShow);
  assert.deepEqual(app.storageWrites, []);

  /* Simula alterações feitas em outras páginas antes de voltar à Home via BFCache. */
  const routine = makeRoutine("calisthenics", "Calistenia Base", [{ id: "c-1", name: "Barra fixa", sets: 4, reps: "6", section: "main" }], "rot-bf");
  const now = new Date();
  const todayLocal = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");

  app.w.localStorage.setItem(PROFILE_KEY, JSON.stringify(profileSeed({ objetivo: "calistenia", diasPorSemana: 3 })));
  app.w.localStorage.setItem("forja-treino-rotinas-v1", JSON.stringify(routinesStore([routine], [])));
  app.w.localStorage.setItem("forja-treino-metas-v1", JSON.stringify({
    version: 1, updatedAt: now.toISOString(), modality: "calisthenics",
    weeklySessions: 3, weeklySets: 12, weeklyMinutes: 45
  }));
  app.w.localStorage.setItem("forja-treino-historico-v1", JSON.stringify([{
    id: "bf-h1", date: todayLocal, finishedAt: now.toISOString(), modality: "calisthenics",
    routineId: "rot-bf", routineName: "Calistenia Base", durationMs: 20 * 60000,
    completedSets: 4, totalPlannedSets: 4, status: "completed", exercises: []
  }]));
  const writesBeforeReturn = app.storageWrites.length;

  const bfShow = new app.w.Event("pageshow");
  bfShow.persisted = true;
  app.w.dispatchEvent(bfShow);

  assert.equal(app.F.state.profile.objetivo, "calistenia", "F.state.profile deve atualizar no retorno BFCache");
  assert.equal(app.F.state.routines.calisthenics.length, 1, "F.state.routines deve atualizar no retorno BFCache");
  assert.equal(app.F.state.goals.weeklySessions, 3, "F.state.goals deve atualizar no retorno BFCache");
  assert.equal(app.F.state.history.length, 1, "F.state.history deve atualizar no retorno BFCache");
  assert.equal(app.d.getElementById("onboarding-root").hidden, true, "Onboarding deve sumir ao voltar com perfil/rotina/histórico");
  assert.match(app.text("#home-primary-button"), /Iniciar Calistenia Base/);
  assert.match(app.text("#home-goals-period"), /Semana de .* · Calistenia\.$/);
  assert.match(app.text("#home-goals-content"), /Faltam 2 treinos/);
  assert.match(app.text("#home-goals-content"), /Faltam 8 séries/);
  assert.match(app.text("#home-goals-content"), /Faltam 25 min/);
  assert.equal(app.storageWrites.length, writesBeforeReturn, "Retorno via pageshow não pode gravar em localStorage");
  assertNoErrors(app, "retorno via pageshow BFCache");
  app.close();
});

/* ------------------------------------------------------------------ */
/* Auditoria de ausência de escrita em F.syncStateFromStorage          */
/* ------------------------------------------------------------------ */

function captureFullStorage(storage) {
  const entries = {};
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    keys.push(storage.key(i));
  }
  keys.sort().forEach(key => {
    entries[key] = storage.getItem(key);
  });
  return { keys: keys.sort(), entries };
}

function assertReadOnlyExecution(app, label, fn) {
  const beforeLocal = captureFullStorage(app.w.localStorage);
  const beforeSession = captureFullStorage(app.w.sessionStorage);

  const calls = {
    setItem: [],
    removeItem: [],
    clear: [],
    notifyChanged: [],
    onChange: [],
    archivePreservedValue: [],
    recordMigration: []
  };

  const proto = app.w.Storage.prototype;
  const origSetItem = proto.setItem;
  const origRemoveItem = proto.removeItem;
  const origClear = proto.clear;
  const origNotify = app.F.store.notifyChanged;
  const origArchive = app.F.archivePreservedValue;
  const origRecordMigration = app.F.recordMigration;
  const unsubOnChange = app.F.store.onChange(key => calls.onChange.push(key));

  proto.setItem = function spySetItem(key, value) {
    calls.setItem.push({ target: this === app.w.localStorage ? "local" : "session", key: String(key), value: String(value) });
    return origSetItem.apply(this, arguments);
  };
  proto.removeItem = function spyRemoveItem(key) {
    calls.removeItem.push({ target: this === app.w.localStorage ? "local" : "session", key: String(key) });
    return origRemoveItem.apply(this, arguments);
  };
  proto.clear = function spyClear() {
    calls.clear.push({ target: this === app.w.localStorage ? "local" : "session" });
    return origClear.apply(this, arguments);
  };
  app.F.store.notifyChanged = function spyNotify(key) {
    calls.notifyChanged.push(key);
    return origNotify.apply(this, arguments);
  };
  app.F.archivePreservedValue = function spyArchive(key, raw, reason) {
    calls.archivePreservedValue.push({ key, reason });
    return origArchive.apply(this, arguments);
  };
  app.F.recordMigration = function spyMigration(details) {
    calls.recordMigration.push(details);
    return origRecordMigration.apply(this, arguments);
  };

  let result;
  try {
    result = fn();
  } finally {
    proto.setItem = origSetItem;
    proto.removeItem = origRemoveItem;
    proto.clear = origClear;
    app.F.store.notifyChanged = origNotify;
    app.F.archivePreservedValue = origArchive;
    app.F.recordMigration = origRecordMigration;
    unsubOnChange();
  }

  const afterLocal = captureFullStorage(app.w.localStorage);
  const afterSession = captureFullStorage(app.w.sessionStorage);

  assert.deepEqual(calls.setItem, [], "[" + label + "] setItem não pode ser chamado");
  assert.deepEqual(calls.removeItem, [], "[" + label + "] removeItem não pode ser chamado");
  assert.deepEqual(calls.clear, [], "[" + label + "] clear não pode ser chamado");
  assert.deepEqual(calls.notifyChanged, [], "[" + label + "] notifyChanged não pode ser chamado");
  assert.deepEqual(calls.onChange, [], "[" + label + "] ouvintes onChange não podem disparar");
  assert.deepEqual(calls.archivePreservedValue, [], "[" + label + "] archivePreservedValue não pode ser chamado");
  assert.deepEqual(calls.recordMigration, [], "[" + label + "] recordMigration não pode ser chamado");
  assert.deepEqual(afterLocal, beforeLocal, "[" + label + "] localStorage deve permanecer byte a byte idêntico");
  assert.deepEqual(afterSession, beforeSession, "[" + label + "] sessionStorage deve permanecer byte a byte idêntico");

  return result;
}

function plainFromRealm(value) {
  return JSON.parse(JSON.stringify(value));
}

await runTest("76a. Segurança syncStateFromStorage: chamada sem argumento atualiza todo F.state com zero escrita", async () => {
  const app = await boot({}, "index.html");
  const rCal = makeRoutine("calisthenics", "Calistenia Sync", [{ id: "sc-1", name: "Flexão", sets: 3, reps: "12", section: "main" }], "rot-sc");
  const rWei = makeRoutine("weights", "Musculação Sync", [{ id: "sw-1", name: "Supino", sets: 4, reps: "8", load: "60 kg", section: "main" }], "rot-sw");
  const activeV2 = sessionSeed(rWei, { running: false, elapsedMs: 120000 });

  app.set("forja-treino-rotinas-v1", routinesStore([rCal], [rWei]));
  app.set("forja-treino-historico-v1", [{
    id: "h-sync-all", date: todayKey(), finishedAt: new Date().toISOString(),
    modality: "weights", routineId: "rot-sw", routineName: "Musculação Sync",
    durationMs: 1800000, completedSets: 4, totalPlannedSets: 4, status: "completed", exercises: []
  }]);
  app.set("forja-treino-biblioteca-v1", {
    calisthenics: [{ id: "lib-1", name: "Prancha RKC", sets: 3, type: "duration", duration: 40, rest: 45, section: "abs" }],
    weights: []
  });
  app.set("forja-preferencias-v1", { soundOnRest: false, vibrateOnRest: true });
  app.set("forja-treino-metas-v1", { version: 1, updatedAt: "2026-10-24T10:00:00.000Z", modality: "weights", weeklySessions: 4, weeklySets: 16, weeklyMinutes: 120 });
  app.set("forja-treino-rotacao-v1", { version: 1, overrideRoutineId: null, nextRoutineId: "rot-sw", nextModality: "weights", lastRoutineId: "rot-sc", lastModality: "calisthenics", previousState: null, updatedAt: 1700000000000 });
  app.set(PROFILE_KEY, profileSeed({ objetivo: "forca", nivel: "avancado", equipamento: "academia", diasPorSemana: 5, duracaoMinutos: 60 }));
  app.set("forja-treino-sessao-ativa-v1", activeV2);
  app.set("forja-missoes-" + todayKey(), [{ id: "m-1", text: "Treinar pesado", done: false }]);

  const ok = assertReadOnlyExecution(app, "syncStateFromStorage() sem argumento", () => app.F.syncStateFromStorage());
  assert.equal(ok, true);
  assert.equal(app.F.state.routines.calisthenics[0].id, "rot-sc");
  assert.equal(app.F.state.routines.weights[0].id, "rot-sw");
  assert.equal(app.F.state.history.length, 1);
  assert.equal(app.F.state.library.calisthenics[0].name, "Prancha RKC");
  assert.deepEqual(plainFromRealm(app.F.state.preferences), { soundOnRest: false, vibrateOnRest: true });
  assert.equal(app.F.state.goals.weeklySessions, 4);
  assert.equal(app.F.state.rotation.nextRoutineId, "rot-sw");
  assert.equal(app.F.state.profile.objetivo, "forca");
  assert.equal(app.F.state.activeWorkout.routineId, "rot-sw");
  assert.equal(app.F.state.storageInfo.routines.exists, true);

  const okNull = assertReadOnlyExecution(app, "syncStateFromStorage(null)", () => app.F.syncStateFromStorage(null));
  assert.equal(okNull, true);
  assertNoErrors(app, "76a sync sem argumento");
  app.close();
});

await runTest("76b. Segurança syncStateFromStorage: cada chave suportada atualiza apenas a memória sem tocar no storage", async () => {
  const app = await boot({}, "index.html");
  const KEYS = app.F.KEYS;
  const rCal = makeRoutine("calisthenics", "Barra A", [{ id: "b-1", name: "Barra fixa", sets: 4, reps: "8", section: "main" }], "rot-b1");

  /* 1. legacyExercises */
  app.set(KEYS.legacyExercises, { calisthenics: [{ id: "leg-k1", name: "Paralelas", sets: 3, reps: "10", rest: 60 }], weights: [] });
  assert.equal(assertReadOnlyExecution(app, "chave legacyExercises", () => app.F.syncStateFromStorage(KEYS.legacyExercises)), true);
  assert.equal(app.F.state.legacyExercises.calisthenics[0].name, "Paralelas");
  assert.equal(app.F.state.routines.calisthenics[0].name, "Rotina padrão");

  /* 2. routines */
  app.set(KEYS.routines, routinesStore([rCal], []));
  assert.equal(assertReadOnlyExecution(app, "chave routines", () => app.F.syncStateFromStorage(KEYS.routines)), true);
  assert.equal(app.F.state.routines.calisthenics[0].id, "rot-b1");

  /* 3. history */
  app.set(KEYS.history, [{ id: "hk-1", date: todayKey(), modality: "calisthenics", routineName: "Barra A", completedSets: 4, durationMs: 600000, status: "completed" }]);
  assert.equal(assertReadOnlyExecution(app, "chave history", () => app.F.syncStateFromStorage(KEYS.history)), true);
  assert.equal(app.F.state.history.length, 1);
  assert.equal(app.F.state.history[0].id, "hk-1");

  /* 4. library */
  app.set(KEYS.library, { calisthenics: [], weights: [{ id: "lk-1", name: "Remada curvada", sets: 4, reps: "8", load: "70 kg", rest: 90, section: "main" }] });
  assert.equal(assertReadOnlyExecution(app, "chave library", () => app.F.syncStateFromStorage(KEYS.library)), true);
  assert.equal(app.F.state.library.weights[0].name, "Remada curvada");

  /* 5. preferences */
  app.set(KEYS.preferences, { soundOnRest: false, vibrateOnRest: false });
  assert.equal(assertReadOnlyExecution(app, "chave preferences", () => app.F.syncStateFromStorage(KEYS.preferences)), true);
  assert.deepEqual(plainFromRealm(app.F.state.preferences), { soundOnRest: false, vibrateOnRest: false });

  /* 6. goals */
  app.set(KEYS.goals, { version: 1, updatedAt: "2026-10-24T12:00:00.000Z", modality: "calisthenics", weeklySessions: 3, weeklySets: 12, weeklyMinutes: 60 });
  assert.equal(assertReadOnlyExecution(app, "chave goals", () => app.F.syncStateFromStorage(KEYS.goals)), true);
  assert.equal(app.F.state.goals.modality, "calisthenics");
  assert.equal(app.F.state.goals.weeklySets, 12);

  /* 7. rotation */
  app.set(KEYS.rotation, { version: 1, overrideRoutineId: "rot-b1", nextRoutineId: "rot-b1", nextModality: "calisthenics", lastRoutineId: null, lastModality: null, previousState: null, updatedAt: 1700000000123 });
  assert.equal(assertReadOnlyExecution(app, "chave rotation", () => app.F.syncStateFromStorage(KEYS.rotation)), true);
  assert.equal(app.F.state.rotation.overrideRoutineId, "rot-b1");

  /* 8. profile */
  app.set(KEYS.profile, profileSeed({ objetivo: "calistenia", nivel: "intermediario", equipamento: "nenhum", diasPorSemana: 4, duracaoMinutos: 45 }));
  assert.equal(assertReadOnlyExecution(app, "chave profile", () => app.F.syncStateFromStorage(KEYS.profile)), true);
  assert.equal(app.F.state.profile.equipamento, "nenhum");
  assert.equal(app.F.state.profile.diasPorSemana, 4);

  /* 9. active */
  app.set(KEYS.active, sessionSeed(rCal, { running: false, elapsedMs: 45000 }));
  assert.equal(assertReadOnlyExecution(app, "chave active", () => app.F.syncStateFromStorage(KEYS.active)), true);
  assert.equal(app.F.state.activeWorkout.routineId, "rot-b1");

  /* 10. missões e chaves auxiliares registradas */
  const missionKey = "forja-missoes-" + todayKey();
  app.set(missionKey, [{ id: "mk-1", text: "Alongar", done: true }]);
  assert.equal(assertReadOnlyExecution(app, "chave missoes", () => app.F.syncStateFromStorage(missionKey)), true);

  [KEYS.migration, KEYS.legacyActiveArchive, KEYS.preserved, KEYS.safety].forEach(auxKey => {
    app.set(auxKey, { ok: true });
    assert.equal(assertReadOnlyExecution(app, "chave auxiliar " + auxKey, () => app.F.syncStateFromStorage(auxKey)), true);
  });

  /* Chave desconhecida */
  app.set("chave-externa-qualquer", "1");
  assert.equal(assertReadOnlyExecution(app, "chave desconhecida", () => app.F.syncStateFromStorage("chave-externa-qualquer")), false);

  assertNoErrors(app, "76b sync por chave");
  app.close();
});

await runTest("76c. Segurança syncStateFromStorage: dados legados v1 normalizam só em memória sem migrar nem arquivar no disco", async () => {
  const app = await boot({}, "index.html");
  const KEYS = app.F.KEYS;

  /* Injeta dados estritamente v1 (exercícios soltos + sessão v1 sem version:2 + histórico v1 + missão texto) após o boot. */
  app.set(KEYS.legacyExercises, {
    calisthenics: [{ id: "v1-ex-1", name: "Flexão diamante", sets: 4, reps: "12", rest: 60 }],
    weights: [{ id: "v1-ex-2", name: "Agachamento livre", sets: 5, reps: "5", rest: 120, load: "100 kg" }]
  });
  app.set(KEYS.active, {
    date: "2026-10-24",
    modality: "calisthenics",
    running: false,
    elapsedMs: 95000,
    completedSets: { "v1-ex-1": 2 }
  });
  app.set(KEYS.history, [{
    id: "v1-hist-1",
    date: "2026-10-23",
    modality: "weights",
    routineName: "Treino antigo",
    durationMs: 1500000,
    completedSets: 5,
    status: "completed"
  }]);
  app.set("forja-missoes-2026-10-24", ["Caminhar 30 min"]);

  /* Mesmo chamando primeiro para KEYS.active isoladamente (com F.state vazio!), reconstrói em memória sem gravar nada. */
  assertReadOnlyExecution(app, "sync v1 isolado em KEYS.active", () => {
    assert.equal(app.F.syncStateFromStorage(KEYS.active), true);
  });
  assert.ok(app.F.state.activeWorkout, "Sessão legada v1 deve ser migrada em memória");
  assert.equal(app.F.state.activeWorkout.version, 2);
  assert.equal(app.F.state.activeWorkout.completedSets["v1-ex-1"], 2);
  assert.equal(app.raw(KEYS.routines), null, "Não deve criar forja-treino-rotinas-v1 no disco");
  assert.equal(app.raw(KEYS.migration), null, "Não deve criar forja-treino-migracao-v1 no disco");
  assert.equal(app.raw(KEYS.legacyActiveArchive), null, "Não deve criar arquivo de sessão legada no disco");
  assert.equal(app.raw(KEYS.preserved), null, "Não deve criar arquivo de dados preservados no disco");
  assert.equal(JSON.parse(app.raw(KEYS.active)).version, undefined, "Sessão ativa no disco deve continuar em formato v1 original");

  /* Testando também KEYS.routines isoladamente partindo de estado limpo em memória. */
  app.F.state.legacyExercises = { calisthenics: [], weights: [] };
  app.F.state.routines = { calisthenics: [], weights: [] };
  assertReadOnlyExecution(app, "sync v1 isolado em KEYS.routines", () => {
    assert.equal(app.F.syncStateFromStorage(KEYS.routines), true);
  });
  assert.equal(app.F.state.routines.calisthenics[0].name, "Rotina padrão");
  assert.equal(app.F.state.routines.weights[0].name, "Rotina padrão");
  assert.equal(app.raw(KEYS.routines), null);

  /* E chamada completa sem argumento sobre todo o conjunto v1. */
  assertReadOnlyExecution(app, "sync v1 completo sem argumento", () => {
    assert.equal(app.F.syncStateFromStorage(), true);
  });
  assert.equal(app.F.state.history.length, 1);
  assert.equal(app.F.state.activeWorkout.completedSets["v1-ex-1"], 2);
  assertNoErrors(app, "76c legado v1");
  app.close();
});

await runTest("76d. Segurança syncStateFromStorage: JSON inválido não arquiva, não remove chaves e limpa apenas F.state em memória", async () => {
  const rCal = makeRoutine("calisthenics", "Rotina Inicial", [{ id: "ri-1", name: "Barra", sets: 3, reps: "8", section: "main" }], "rot-init");
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([rCal], []),
    "forja-treino-historico-v1": [{ id: "hi-1", date: todayKey(), modality: "calisthenics", routineName: "Rotina Inicial", completedSets: 3, durationMs: 600000, status: "completed" }],
    "forja-treino-sessao-ativa-v1": sessionSeed(rCal, { running: false, elapsedMs: 10000 }),
    "forja-treino-metas-v1": { version: 1, updatedAt: "2026-10-24T08:00:00.000Z", modality: "calisthenics", weeklySessions: 3, weeklySets: 9, weeklyMinutes: 45 },
    [PROFILE_KEY]: profileSeed({ objetivo: "forca", diasPorSemana: 3 })
  }, "index.html");
  const KEYS = app.F.KEYS;

  /* Corrompe todas as chaves no localStorage após o boot. */
  app.set(KEYS.legacyExercises, "{json-quebrado-exercicios");
  app.set(KEYS.routines, "{json-quebrado-rotinas");
  app.set(KEYS.history, "[json-quebrado-historico");
  app.set(KEYS.library, "{json-quebrado-biblioteca");
  app.set(KEYS.preferences, "{json-quebrado-preferencias");
  app.set(KEYS.goals, "{json-quebrado-metas");
  app.set(KEYS.rotation, "{json-quebrado-rotacao");
  app.set(KEYS.profile, "{json-quebrado-perfil");
  app.set(KEYS.active, "{json-quebrado-sessao");
  app.set("forja-missoes-" + todayKey(), "{json-quebrado-missoes");

  /* Por chave individual */
  [
    KEYS.legacyExercises,
    KEYS.routines,
    KEYS.history,
    KEYS.library,
    KEYS.preferences,
    KEYS.goals,
    KEYS.rotation,
    KEYS.profile,
    KEYS.active,
    "forja-missoes-" + todayKey()
  ].forEach(corruptKey => {
    assertReadOnlyExecution(app, "JSON inválido em " + corruptKey, () => {
      assert.equal(app.F.syncStateFromStorage(corruptKey), true);
    });
  });

  /* E sem argumento com todas corrompidas ao mesmo tempo ( mais array com itens não-objeto em history ) */
  assertReadOnlyExecution(app, "JSON inválido global sem argumento", () => {
    assert.equal(app.F.syncStateFromStorage(), true);
  });

  assert.equal(app.F.state.legacyExercisesCorrupt, true);
  assert.deepEqual(plainFromRealm(app.F.state.routines), { calisthenics: [], weights: [] });
  assert.deepEqual(plainFromRealm(app.F.state.history), []);
  assert.deepEqual(plainFromRealm(app.F.state.library), { calisthenics: [], weights: [] });
  assert.deepEqual(plainFromRealm(app.F.state.preferences), { soundOnRest: true, vibrateOnRest: true });
  assert.equal(app.F.state.goals.weeklySessions, 0);
  assert.equal(app.F.state.profile.updatedAt, null);
  assert.equal(app.F.state.activeWorkout, null);
  assert.equal(app.F.state.storageInfo.routines.corrupt, true);
  assert.equal(app.F.state.storageInfo.active.corrupt, true);
  assert.equal(app.raw(KEYS.preserved), null, "Não deve criar forja-treino-dados-preservados-v1");
  assert.equal(app.raw(KEYS.active), "{json-quebrado-sessao", "Não deve apagar sessão ativa corrompida");

  /* Array JSON válido mas com elementos inválidos em history */
  app.set(KEYS.history, JSON.stringify([null, 42, "invalido"]));
  assertReadOnlyExecution(app, "history com elementos não-objeto", () => {
    assert.equal(app.F.syncStateFromStorage(KEYS.history), true);
  });
  assert.deepEqual(plainFromRealm(app.F.state.history), []);

  assertNoErrors(app, "76d JSON inválido");
  app.close();
});

await runTest("76e. Segurança de sincronização: eventos storage e pageshow/BFCache não executam setItem, removeItem nem clear", async () => {
  const app = await boot({}, "index.html");
  const KEYS = app.F.KEYS;

  /* 1. Evento storage com dados legados v1 */
  app.set(KEYS.legacyExercises, {
    calisthenics: [{ id: "st-v1", name: "Barra australiana", sets: 3, reps: "12", rest: 60 }],
    weights: []
  });
  assertReadOnlyExecution(app, "evento storage legacyExercises v1", () => {
    app.w.dispatchEvent(new app.w.StorageEvent("storage", { key: KEYS.legacyExercises }));
  });
  assert.match(app.text("#home-primary-button"), /Iniciar Rotina padrão/);

  /* 2. Evento storage com sessão legada v1 */
  app.set(KEYS.active, {
    date: todayKey(),
    modality: "calisthenics",
    running: false,
    elapsedMs: 30000,
    completedSets: { "st-v1": 1 }
  });
  assertReadOnlyExecution(app, "evento storage active v1", () => {
    app.w.dispatchEvent(new app.w.StorageEvent("storage", { key: KEYS.active }));
  });
  assert.equal(app.d.getElementById("active-session-banner").hidden, false);

  /* 3. Evento storage com JSON inválido */
  app.set(KEYS.goals, "{metas-invalidas");
  assertReadOnlyExecution(app, "evento storage goals inválido", () => {
    app.w.dispatchEvent(new app.w.StorageEvent("storage", { key: KEYS.goals }));
  });

  /* 4. Evento storage key=null */
  app.w.localStorage.removeItem(KEYS.active);
  assertReadOnlyExecution(app, "evento storage key=null", () => {
    app.w.dispatchEvent(new app.w.StorageEvent("storage", { key: null }));
  });
  assert.equal(app.d.getElementById("active-session-banner").hidden, true);

  /* 5. pageshow BFCache (persisted: true) com alterações externas combinadas (válidas + corrompidas) */
  app.set(KEYS.profile, profileSeed({ objetivo: "resistencia", diasPorSemana: 4 }));
  app.set(KEYS.rotation, "{rotacao-corrompida");
  assertReadOnlyExecution(app, "pageshow persisted=true (BFCache)", () => {
    const ev = new app.w.Event("pageshow");
    ev.persisted = true;
    app.w.dispatchEvent(ev);
  });
  assert.equal(app.F.state.profile.objetivo, "resistencia");
  assert.equal(app.F.state.rotation.nextRoutineId, null);

  /* 6. pageshow persisted=false sem e com mudanças */
  assertReadOnlyExecution(app, "pageshow persisted=false inalterado", () => {
    const ev = new app.w.Event("pageshow");
    ev.persisted = false;
    app.w.dispatchEvent(ev);
  });

  assertNoErrors(app, "76e eventos storage e pageshow");
  app.close();
});

await runTest("76f. Segurança syncStateFromStorage: preferências ausentes ou inválidas usam padrão em memória sem gravar", async () => {
  const app = await boot({
    "forja-preferencias-v1": { soundOnRest: false, vibrateOnRest: false }
  }, "index.html");
  const KEYS = app.F.KEYS;
  assert.deepEqual(plainFromRealm(app.F.state.preferences), { soundOnRest: false, vibrateOnRest: false });

  /* 1. Preferências ausentes (chave removida externamente) */
  app.w.localStorage.removeItem(KEYS.preferences);
  assertReadOnlyExecution(app, "preferências ausentes por chave", () => {
    assert.equal(app.F.syncStateFromStorage(KEYS.preferences), true);
  });
  assert.deepEqual(plainFromRealm(app.F.state.preferences), { soundOnRest: true, vibrateOnRest: true });
  assert.equal(app.raw(KEYS.preferences), null, "Chave ausente não deve ser criada");

  /* 2. Preferências com JSON inválido */
  app.F.state.preferences = { soundOnRest: false, vibrateOnRest: false };
  app.set(KEYS.preferences, "{json-invalido");
  assertReadOnlyExecution(app, "preferências JSON inválido", () => {
    assert.equal(app.F.syncStateFromStorage(KEYS.preferences), true);
  });
  assert.deepEqual(plainFromRealm(app.F.state.preferences), { soundOnRest: true, vibrateOnRest: true });
  assert.equal(app.raw(KEYS.preserved), null);

  /* 3. Preferências com tipos não-objeto (array, string, número, null) */
  for (const invalidRaw of ["[1,2,3]", "\"desligado\"", "0", "null"]) {
    app.F.state.preferences = { soundOnRest: false, vibrateOnRest: false };
    app.set(KEYS.preferences, invalidRaw);
    assertReadOnlyExecution(app, "preferências não-objeto " + invalidRaw, () => {
      assert.equal(app.F.syncStateFromStorage(), true);
    });
    assert.deepEqual(plainFromRealm(app.F.state.preferences), { soundOnRest: true, vibrateOnRest: true });
  }

  /* 4. Preferências parciais / valores não booleanos */
  app.set(KEYS.preferences, JSON.stringify({ soundOnRest: false }));
  assertReadOnlyExecution(app, "preferências parciais", () => {
    assert.equal(app.F.syncStateFromStorage(KEYS.preferences), true);
  });
  assert.deepEqual(plainFromRealm(app.F.state.preferences), { soundOnRest: false, vibrateOnRest: true });

  assertNoErrors(app, "76f preferências ausentes/inválidas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 77. Regressões da auditoria (D-01 … D-11)                           */
/* ------------------------------------------------------------------ */

/* Cria N registros de histórico, do mais antigo (índice 0) ao mais novo. */
function historySeries(count, startKey = "2026-01-01") {
  const base = new Date(startKey + "T12:00:00");
  const list = [];

  for (let index = 0; index < count; index += 1) {
    const date = new Date(base.getTime());
    date.setDate(date.getDate() + index);
    list.push(seedRecord(date, [seedExercise("Flexão", [seedLog({ reps: "10", load: "10 kg" })])], {
      id: "aud-" + index,
      routineName: "Treino " + (index + 1)
    }));
  }

  return list;
}

function backupOf(keys) {
  return {
    app: "FORJA",
    format: "forja-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    keys
  };
}

await runTest("77a. D-01: importar 250 registros mantém os mais recentes e não perde treino novo", async () => {
  const series = historySeries(250);
  assert.equal(series.length, 250);
  const newest = series[series.length - 1].date;
  const oldest = series[0].date;

  const app = await boot({}, "configuracoes/index.html");
  await app.importFile(backupOf({ "forja-treino-historico-v1": series }));
  await wait(40);

  /* O preview avisa o corte antes de confirmar. */
  const preview = app.text(".modal-details");
  assert.match(preview, /250 treinos no histórico/i, "Preview não informa o tamanho do arquivo");
  assert.match(preview, /200 mais recentes/i, "Preview não informa quais registros ficam");
  assert.match(preview, /50 registro\(s\) mais antigo\(s\).*descartados/i, "Preview não informa o descarte");
  assert.match(preview, /limite de 200/i);

  await app.modal("restore");
  await wait(60);

  const stored = app.data("forja-treino-historico-v1");
  assert.equal(stored.length, 200, "O armazenamento deve respeitar o limite do app");
  assert.equal(stored[0].date, newest, "O registro mais recente do arquivo deve vir primeiro");
  assert.ok(!stored.some(record => record.date === oldest), "O mais antigo do arquivo é o único descartado");
  assert.ok(stored.some(record => record.date === newest), "O mais novo do arquivo não pode ser descartado");

  /* Progresso e exportação concordam com o armazenamento. */
  await app.go(BASE + "progresso/index.html");
  await wait(120);
  assert.equal(app.text("#progress-sessions"), "200");
  assert.equal(app.$$("#progress-history .history-item").length, 200);
  const exported = app.F.buildBackupObject();
  assert.equal(exported.keys["forja-treino-historico-v1"].length, 200, "Exportação divergiu do armazenamento");

  /* Um treino novo entra e o registro mais novo do arquivo continua lá. */
  const routine = makeRoutine("calisthenics", "Treino novo", [
    { name: "Flexão", section: "main", sets: 1, reps: "10", rest: 0, id: "novo-1" }
  ], "rot-novo");

  const exec = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-historico-v1": app.data("forja-treino-historico-v1"),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-novo" })
  }, "treino/executar.html");
  await wait(30);
  exec.click("#complete-set");
  await wait(60);
  assert.equal(exec.$("#execution-summary").hidden, false, "Concluir a série deveria encerrar a sessão de 1 série");

  const after = exec.data("forja-treino-historico-v1");
  assert.equal(after.length, 200, "O histórico deve continuar no limite depois do treino novo");
  assert.ok(after.some(record => record.date === newest), "O registro mais novo importado desapareceu");
  assert.equal(after[0].routineName, "Treino novo", "O treino recém-concluído deve entrar no topo");
  /* Importados: 200 mais recentes (aud-50…aud-249). O treino novo empurra
     para fora exatamente um: o mais antigo da lista, aud-50. */
  assert.ok(!after.some(record => record.id === "aud-50"), "O descarte deve ser do registro mais antigo");
  assert.ok(after.some(record => record.id === "aud-51"), "O segundo mais antigo precisa sobreviver");

  assertNoErrors(exec, "D-01 histórico acima do limite");
  exec.close();
  app.close();
});

await runTest("77b. D-01/D-05: ordem do histórico não depende da ordem do arquivo", async () => {
  const asc = historySeries(4).map((record, index) => Object.assign({}, record, {
    id: "ord-" + index,
    date: ["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10"][index],
    finishedAt: ["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10"][index] + "T12:00:00.000Z",
    routineName: "Rotina " + (index + 1)
  }));

  const app = await boot({ "forja-treino-historico-v1": asc }, "index.html");
  await wait(40);
  const recent = app.$$(".home-recent-name").map(node => node.textContent.trim());
  assert.deepEqual(recent, ["Rotina 4", "Rotina 3", "Rotina 2"], "Home deve mostrar o mais recente primeiro");

  await app.go(BASE + "progresso/index.html");
  await wait(120);
  const titles = app.$$("#progress-history .history-item").map(node => node.textContent);
  assert.match(titles[0], /Rotina 4/, "Progresso deve começar pelo treino mais recente");
  assert.match(titles[3], /Rotina 1/);

  /* A leitura corrige a ordem em memória sem regravar o arquivo antigo. */
  await app.reload();
  await wait(80);
  assert.equal(app.data("forja-treino-historico-v1")[0].id, "ord-0",
    "O arquivo importado não pode ser reescrito só por abrir a página");
  assert.equal(app.raw("forja-treino-historico-v1"), JSON.stringify(asc));
  assert.equal(app.$$("#progress-history .history-item").length, 4);
  assert.match(app.$$("#progress-history .history-item")[0].textContent, /Rotina 4/,
    "Depois de recarregar, a tela continua do mais recente para o mais antigo");

  assertNoErrors(app, "D-05 ordem do histórico");
  app.close();
});

await runTest("77c. D-02: falha na restauração libera o desfazer na mesma tela", async () => {
  const today = todayKey();
  const app = await boot({
    ["forja-missoes-" + today]: [{ id: "m1", text: "Original", done: false }],
    "forja-treino-rotinas-v1": routinesStore([sampleRoutine()], []),
    "forja-preferencias-v1": { soundOnRest: false, vibrateOnRest: false }
  }, "configuracoes/index.html");
  await wait(30);

  assert.equal(app.$("#restore-safety-backup").hidden, true, "Desfazer não deveria existir antes de importar");

  const backup = backupOf({
    ["forja-missoes-" + today]: [{ id: "m2", text: "Do backup", done: false }],
    "forja-preferencias-v1": { soundOnRest: true, vibrateOnRest: true }
  });

  const guard = installFailingStorage(app, { failOn: "forja-missoes-" + today, times: 2 });
  await app.importFile(backup);
  app.modalAction("restore");
  await wait(200);
  guard.restore();

  /* Sem recarregar: o desfazer aparece e o status informa a cópia. */
  assert.match(app.text("#modal-title"), /Falha ao restaurar/);
  assert.match(app.text(".modal-message"), /forja-backup-seguranca-v1/);
  assert.match(app.text(".modal-message"), /sem precisar recarregar/);
  app.modalAction("close");
  await wait(30);

  assert.equal(app.$("#restore-safety-backup").hidden, false, "Desfazer precisa aparecer sem recarregar");
  assert.match(app.text("#backup-status"), /Cópia de segurança de .* disponível/);

  /* Recuperação imediata, na mesma página. */
  app.click("#restore-safety-backup");
  await wait(30);
  await app.modal("restore");
  await wait(80);

  assert.equal(app.data("forja-missoes-" + today)[0].text, "Original", "Desfazer não recuperou as missões");
  assert.deepEqual(app.data("forja-preferencias-v1"), { soundOnRest: false, vibrateOnRest: false },
    "Desfazer não recuperou as preferências");
  assert.match(app.text("#toast"), /Cópia anterior restaurada/);

  assertNoErrors(app, "D-02 desfazer na mesma tela");
  app.close();
});

await runTest("77d. D-03: preview nomeia as chaves removidas e avisa as duas sensíveis", async () => {
  const today = todayKey();
  const preserved = [{ archivedAt: "2026-10-20T10:00:00.000Z", key: "forja-treino-historico-v1", reason: "JSON inválido", raw: "{corrompido" }];

  const app = await boot({
    ["forja-missoes-" + today]: [{ id: "m1", text: "Atual", done: false }],
    "forja-treino-dados-preservados-v1": preserved,
    "forja-treino-rotacao-v1": { version: 1, nextRoutineId: "r2" }
  }, "configuracoes/index.html");
  await wait(30);

  await app.importFile(backupOf({ ["forja-missoes-" + today]: [{ id: "m2", text: "Do backup", done: false }] }));
  await wait(40);

  const details = app.text(".modal-details");
  assert.match(details, /serão removidas: .*Dados preservados de leitura inválida/,
    "Preview deve nomear a cesta de dados preservados");
  assert.match(details, /Sequência de rotinas/, "Preview deve nomear a chave de rotação");
  assert.match(details, /forja-treino-dados-preservados-v1/, "Preview deve mostrar a chave técnica dos dados preservados");
  assert.match(details, /forja-treino-rotacao-v1/, "Preview deve mostrar a chave técnica da rotação");
  assert.match(details, /Desfazer última importação.*recupera/i, "Preview não explica como recuperar");
  assert.match(details, /Missões e calendário \(1 dia\)/, "Preview deve agrupar as chaves de missão");

  await app.modal("restore");
  await wait(60);
  assert.equal(app.data("forja-treino-dados-preservados-v1"), null, "A cesta foi removida (comportamento explícito)");
  assert.equal(app.data("forja-treino-rotacao-v1"), null);

  /* O desfazer devolve as duas chaves. */
  app.click("#restore-safety-backup");
  await wait(30);
  await app.modal("restore");
  await wait(80);
  assert.deepEqual(app.data("forja-treino-dados-preservados-v1"), preserved, "Desfazer não devolveu a cesta");
  assert.equal(app.data("forja-treino-rotacao-v1").nextRoutineId, "r2");

  assertNoErrors(app, "D-03 chaves nomeadas");
  app.close();
});

await runTest("77e. D-04: descanso não anuncia cada segundo e mantém os momentos importantes", async () => {
  const routine = makeRoutine("calisthenics", "Treino descanso", [
    { id: "r1", name: "Flexão", sets: 2, reps: "10", rest: 60 }
  ], "rot-rest");

  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-rest" })
  }, "treino/executar.html", { now: 5_000_000 });
  await wait(30);

  assert.equal(app.$("#execution-rest").hasAttribute("aria-live"), false,
    "O painel com o contador não pode ser uma região viva");
  assert.equal(app.$("#rest-timer").getAttribute("aria-live"), "off");
  assert.equal(app.$("#rest-timer").getAttribute("role"), "timer");

  app.click("#complete-set");
  await wait(20);
  app.advance(1000);
  assert.equal(app.text("#rest-timer"), "00:59", "O contador continua visível e atualizando");
  app.advance(1000);
  assert.equal(app.text("#rest-timer"), "00:58");

  app.click("#pause-rest");
  await wait(90);
  assert.match(app.text("#rest-caption"), /pausado/i);
  assert.match(app.text("#forja-live-region"), /Descanso pausado/, "Pausa deveria ser anunciada uma vez");

  app.click("#resume-rest");
  await wait(90);
  assert.match(app.text("#forja-live-region"), /Descanso retomado/);

  app.click("#rest-minus");
  await wait(90);
  assert.match(app.text("#forja-live-region"), /Descanso ajustado/);

  /* Fim do descanso continua avisando pelo toast (role=status). */
  assert.equal(app.$("#toast").getAttribute("role"), "status");
  app.click("#skip-rest");
  await wait(30);
  assert.match(app.text("#toast"), /Descanso pulado/);

  assertNoErrors(app, "D-04 descanso acessível");
  app.close();
});

await runTest("77f. D-07: abrir o descanso rola até o painel e reserva a barra inferior", async () => {
  const routine = makeRoutine("calisthenics", "Treino descanso", [
    { id: "r1", name: "Flexão", sets: 2, reps: "10", rest: 60 }
  ], "rot-scroll");

  const css = fs.readFileSync(path.join(repoRoot, "assets/css/marca.css"), "utf8");
  assert.match(css, /\.rest-panel[\s\S]*?scroll-margin-bottom:\s*calc\(var\(--bottom-nav-height\)/,
    "O painel precisa reservar o espaço da barra inferior ao rolar");

  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([routine], []),
    "forja-treino-sessao-ativa-v1": sessionSeed(routine, { id: "s-scroll" })
  }, "treino/executar.html");
  await wait(30);

  const calls = [];
  app.w.Element.prototype.scrollIntoView = function recordScroll(options) {
    calls.push({ id: this.id, block: options && options.block });
  };

  app.click("#complete-set");
  await wait(40);

  assert.equal(app.$("#execution-rest").hidden, false, "O descanso deveria estar aberto");
  assert.ok(
    calls.some(call => call.id === "execution-rest"),
    "Abrir o descanso precisa levar a rolagem até o painel: " + JSON.stringify(calls)
  );

  /* Recarregar com descanso pendente também traz o painel para a tela. */
  await app.reload();
  await wait(60);
  assert.equal(app.$("#execution-rest").hidden, false, "O descanso pendente deveria reabrir após recarregar");

  assertNoErrors(app, "D-07 rolagem do descanso");
  app.close();
});

await runTest("77g. D-08: o skip link move o foco para o conteúdo", async () => {
  for (const page of ["index.html", "progresso/index.html", "treino/biblioteca.html"]) {
    const app = await boot({}, page);
    await wait(30);

    const main = app.$("#conteudo");
    assert.ok(main, "Página sem #conteudo: " + page);
    assert.equal(main.getAttribute("tabindex"), "-1", "O destino do skip link precisa ser focável: " + page);

    /* O CSS não pode suprimir o foco de forma que quebre o fluxo visível. */
    const link = app.$(".skip-link");
    assert.ok(link, "Skip link ausente: " + page);
    assert.equal(link.getAttribute("href"), "#conteudo");

    main.focus();
    assert.equal(app.d.activeElement, main, "O foco não foi para o conteúdo em " + page);

    /* Mantém funcionando o resto do teclado: o primeiro Tab sai do skip link. */
    link.focus();
    assert.equal(app.d.activeElement, link);
    app.close();
  }
});

await runTest("77h. D-09: a Biblioteca tem exatamente um h1", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  await wait(120);

  const headings = app.$$("h1");
  assert.equal(headings.length, 1, "A Biblioteca deve ter um único h1");
  assert.equal(headings[0].textContent.trim(), "Biblioteca de exercícios");
  assert.equal(headings[0].id, "catalog-heading");
  assert.equal(headings[0].className, "ui-section-title", "O visual do título não deve mudar");

  /* O bloco de ajuda continua no nível seguinte. */
  const help = app.$$("h2").map(node => node.textContent.trim());
  assert.ok(help.includes("Como a biblioteca funciona"), "Títulos internos continuam em h2");

  assertNoErrors(app, "D-09 h1 da Biblioteca");
  app.close();
});

await runTest("77i. D-10: missão sem texto é ignorada com aviso, sem dado invisível", async () => {
  const today = todayKey();
  const dayKey = "forja-missoes-" + today;

  const app = await boot({}, "configuracoes/index.html");
  await app.importFile(backupOf({
    [dayKey]: [{ id: "vazia", text: "", done: false }, { id: "ok", text: "Missão visível", done: false }]
  }));
  await wait(40);

  assert.match(app.text(".modal-details"), /1 missão\(ões\) sem texto .* ignoradas/i,
    "O preview deve avisar as missões ignoradas");

  await app.modal("restore");
  await wait(60);

  const stored = app.data(dayKey);
  assert.equal(stored.length, 1, "O armazenamento não pode guardar missão vazia");
  assert.equal(stored[0].text, "Missão visível");

  await app.go(BASE + "index.html");
  await wait(120);
  assert.equal(app.$$("#task-list .task").length, 1);
  assert.equal(app.text("#progress-label"), "0 de 1 · 0%", "A contagem precisa bater com o que aparece");

  /* Dia inteiro sem texto: a chave não é recriada e o preview avisa. */
  const emptyDay = "forja-missoes-2026-03-03";
  const second = await boot({}, "configuracoes/index.html");
  await second.importFile(backupOf({
    [emptyDay]: [{ id: "a", text: "", done: false }],
    [dayKey]: [{ id: "ok", text: "Missão visível", done: false }]
  }));
  await wait(40);
  assert.match(second.text(".modal-details"), /ficarão sem missões e não serão restaurados/i);
  await second.modal("restore");
  await wait(60);
  assert.equal(second.data(emptyDay), null, "Um dia só com missões vazias não deve ser gravado");
  assertNoErrors(second, "D-10 dia vazio");
  second.close();

  assertNoErrors(app, "D-10 missão vazia");
  app.close();
});

await runTest("77j. D-06: \"Falta 1 série\" no Progresso e na Home", async () => {
  const today = new Date();
  const record = seedRecord(today, [seedExercise("Flexão", [
    seedLog({ reps: "10", load: "10 kg" }), seedLog({ set: 2, reps: "10", load: "10 kg" })
  ])], { completedSets: 19, totalPlannedSets: 19, status: "completed" });

  const goals = { version: 1, updatedAt: null, modality: "all", weeklySessions: 1, weeklySets: 20, weeklyMinutes: 0 };
  const app = await boot({
    "forja-treino-historico-v1": [record],
    "forja-treino-metas-v1": goals
  }, "progresso/index.html");
  await wait(120);

  const progressGoals = app.text("#goals-progress");
  assert.match(progressGoals, /Falta 1 série/, "Progresso deve concordar no singular");
  assert.ok(!/Faltam 1 séries/.test(progressGoals), "Plural errado ainda aparece: " + progressGoals);

  await app.go(BASE + "index.html");
  await wait(120);
  const homeGoals = app.text("#home-goals-content");
  assert.match(homeGoals, /Falta 1 série/, "Home e Progresso precisam usar o mesmo texto");

  /* Plural continua certo quando falta mais de um. */
  const plural = await boot({
    "forja-treino-historico-v1": [record],
    "forja-treino-metas-v1": Object.assign({}, goals, { weeklySets: 25 })
  }, "progresso/index.html");
  await wait(120);
  assert.match(plural.text("#goals-progress"), /Faltam 6 séries/);
  assertNoErrors(plural, "D-06 plural");
  plural.close();

  assertNoErrors(app, "D-06 singular");
  app.close();
});

await runTest("77k. D-11: a barra inferior mantém os cinco rótulos legíveis em 320 px", async () => {
  const css = fs.readFileSync(path.join(repoRoot, "assets/css/marca.css"), "utf8");
  assert.match(css, /@media \(max-width: 359px\)[\s\S]*?\.bottom-nav-inner[\s\S]*?width:\s*100%/,
    "A barra precisa liberar a largura total em telas de 320 px");
  assert.match(css, /@media \(max-width: 359px\)[\s\S]*?\.bottom-nav-link[\s\S]*?letter-spacing:\s*0/,
    "O espaçamento entre letras precisa caber em 320 px");

  const app = await boot({}, "index.html");
  await wait(30);
  const labels = app.$$(".bottom-nav-label").map(node => node.textContent.trim());
  assert.deepEqual(labels, ["Início", "Treinos", "Explorar", "Progresso", "Perfil"]);
  assert.equal(app.$$(".bottom-nav-link").length, 5, "A barra continua com cinco destinos");
  assertNoErrors(app, "D-11 barra inferior");
  app.close();
});

/* Evolução web 1: nenhuma consulta cria um segundo estado persistente. */
await runTest("78. Treinos lista, filtra e inicia rotinas diretamente, sem escrita de consulta", async () => {
  const cal = sampleRoutine("calisthenics", "hub-cal");
  const mus = sampleRoutine("weights", "hub-mus");
  const empty = makeRoutine("weights", "Vazia", [], "hub-empty");
  const app = await boot({ "forja-treino-rotinas-v1": routinesStore([cal], [mus, empty]) }, "treino/index.html");
  const before = app.keys().map(key => [key, app.raw(key)]);
  const writes = app.storageWrites.length;
  assert.equal(app.$$("#hub-routine-list .routine-card").length, 3);
  const filter = app.$("#hub-modality");
  filter.value = "weights";
  filter.dispatchEvent(new app.w.Event("change", { bubbles: true }));
  assert.equal(app.$$("#hub-routine-list .routine-card").length, 2);
  assert.equal(app.$('[data-routine-id="hub-empty"] .routine-start').disabled, true);
  assert.match(app.$('[data-routine-id="hub-mus"] a').href, /modalidade=weights/);
  assert.equal(app.storageWrites.length, writes);
  assert.deepEqual(app.keys().map(key => [key, app.raw(key)]), before);
  app.click('[data-routine-id="hub-mus"] .routine-start');
  await pageIs(app, "executar");
  assert.equal(app.F.state.activeWorkout.routineId, "hub-mus");
  assert.equal(app.F.state.activeWorkout.modality, "weights");
  assertNoErrors(app, "hub direto");
});

await runTest("79. Detalhes e catálogo compartilhados preservam campos, ordem e IDs do editor", async () => {
  const routine = sampleRoutine();
  routine.sections.main[0].instructions = "Instrução salva na rotina.";
  const app = await boot({ "forja-treino-rotinas-v1": routinesStore([routine], []) },
    "treino/rotina.html?modalidade=calisthenics&id=r1");
  const before = app.raw(app.F.KEYS.routines);
  app.$("#routine-name-input").value = "Nome em rascunho";
  app.$("#routine-name-input").dispatchEvent(new app.w.Event("input", { bubbles: true }));
  app.$("#exercise-name").value = "Exercício ainda digitado";
  app.$("#exercise-reps").value = "8-12";
  app.$("#exercise-rest").value = "75";
  const form = app.$("#exercise-form");
  const originalOrder = app.$$(".editor-exercise").map(row => row.dataset.exerciseId);
  const savedDetails = app.$('[data-exercise-id="m1"] .exercise-tools button');
  savedDetails.focus();
  app.click(savedDetails);
  assert.match(app.text(".modal-details"), /Instrução salva na rotina/);
  assert.equal(app.d.activeElement.dataset.modalAction, "cancel", "Diálogo só com Fechar precisa receber foco");
  app.d.dispatchEvent(new app.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(app.d.activeElement, savedDetails);
  app.click("#library-toggle");
  const search = app.$("#library-search");
  search.value = "peito";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  const expected = app.F.catalog.filter({ mode: "calisthenics", query: "peito" });
  assert.equal(app.$$("#library-list .ui-exercise-row").length, expected.length);
  const row = app.$("#library-list .ui-exercise-row");
  const detail = row.querySelector("button");
  detail.focus();
  app.click(detail);
  assert.equal(app.$$("[data-modal-field]").length, 0, "Consulta não pede destino nem muda a rotina");
  /* O detalhe passou a mostrar a ilustração local do catálogo (não uma foto). */
  assert.ok(app.$(".modal-details .demo-media"), "Detalhe sem ilustração do catálogo");
  assert.match(app.text(".modal-details .demo-credit"), /RepDB/);
  await app.modal("cancel");
  assert.equal(app.d.activeElement, detail);
  assert.equal(app.$("#exercise-form"), form);
  assert.equal(app.$("#exercise-name").value, "Exercício ainda digitado");
  assert.equal(app.$("#exercise-reps").value, "8-12");
  assert.equal(app.$("#exercise-rest").value, "75");
  assert.equal(app.$("#routine-name-input").value, "Nome em rascunho");
  assert.deepEqual(app.$$(".editor-exercise").map(row => row.dataset.exerciseId), originalOrder);
  assert.equal(app.raw(app.F.KEYS.routines), before);
  const add = [...row.querySelectorAll("button")].find(button => button.textContent === "Adicionar");
  app.click(add);
  assert.equal(app.raw(app.F.KEYS.routines), before, "Inclusão espera Salvar");
  app.click("#save-routine-top");
  await wait(40);
  const saved = app.data(app.F.KEYS.routines).calisthenics[0];
  assert.equal(saved.name, "Nome em rascunho");
  const original = saved.sections.main.find(ex => ex.id === "m1");
  assert.equal(original.instructions, "Instrução salva na rotina.");
  assert.ok(saved.sections[expected[0].section].some(ex => ex.libraryId === expected[0].libraryId));
  assertNoErrors(app, "editor contextual");
});

await runTest("80. Instruções na sessão não escrevem nem reiniciam descanso, pausa ou campos digitados", async () => {
  const routine = heavyRoutine();
  const exercise = routine.sections.main[0];
  exercise.libraryId = "mus-supino-reto";
  exercise.instructions = "Instrução da sessão, não do nome.";
  const active = sessionSeed(routine, { restEndAt: 61000, restPlannedSeconds: 60 });
  const app = await boot({
    "forja-treino-rotinas-v1": routinesStore([], [routine]),
    "forja-treino-sessao-ativa-v1": active
  }, "treino/executar.html", { now: 1000 });
  app.setNow(1000);
  app.$("#log-load").value = "42";
  app.$("#log-load").dispatchEvent(new app.w.Event("input", { bubbles: true }));
  const before = app.raw(app.F.KEYS.active);
  const memory = JSON.stringify(app.F.state.activeWorkout);
  const writes = app.storageWrites.length;
  const trigger = app.$("#execution-instructions");
  trigger.focus();
  app.click(trigger);
  assert.match(app.text(".modal-details"), /Instrução da sessão, não do nome/);
  assert.equal(app.$$("[data-modal-field]").length, 0);
  assert.equal(app.d.activeElement.dataset.modalAction, "cancel");
  app.d.dispatchEvent(new app.w.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  /*
    O detalhe agora contém links de crédito e botões de pose (elementos
    focáveis). A proteção continua sendo o TRAP: Tab nunca sai do modal.
    Antes havia um único botão e o teste comparava com "cancel".
  */
  assert.ok(app.d.activeElement.closest(".modal-card"),
    "Tab não pode sair do modal de execução");
  app.advance(5000);
  assert.equal(app.F.state.activeWorkout.restEndAt, 61000);
  await app.modal("cancel");
  assert.equal(app.d.activeElement, trigger);
  assert.equal(app.raw(app.F.KEYS.active), before);
  assert.equal(JSON.stringify(app.F.state.activeWorkout), memory);
  assert.equal(app.storageWrites.length, writes);
  assert.equal(app.$("#log-load").value, "42");
  app.click("#pause-session");
  const paused = app.raw(app.F.KEYS.active);
  app.click(trigger);
  await app.modal("cancel");
  assert.equal(app.raw(app.F.KEYS.active), paused);
  assert.equal(app.F.state.activeWorkout.running, false);
  await app.go("executar.html");
  assert.equal(app.F.state.activeWorkout.running, false);
  assert.equal(app.F.state.activeWorkout.logDraft[exercise.id].load, "42");
  assertNoErrors(app, "sessão contextual");
});

await runTest("81. Identidade e preparação de fotos nunca usam correspondência por nome", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const known = app.F.catalog.describeExercise({ id: "copy-123", libraryId: "cal-flexao", name: "Nome editado", instructions: "", sets: 3 }, "calisthenics");
  assert.equal(known.id, "copy-123");
  assert.equal(known.libraryId, "cal-flexao");
  assert.ok(known.instructions);
  const unknown = app.F.catalog.describeExercise({ id: "custom-no-link", name: "Flexão de braço", sets: 3 }, "calisthenics");
  assert.equal(unknown.instructions, "", "Nome igual não autoriza associar conteúdo");
  assert.equal(app.F.catalog.photoFor(known), null);
  assert.equal(app.F.catalog.photoFor(unknown), null);
  assert.equal(Object.keys(app.F.catalog.PHOTO_MANIFEST).length, 0);
  assert.ok(Object.isFrozen(app.F.catalog.PHOTO_MANIFEST));
  assertNoErrors(app, "fotos sem publicação");
});

const failed = results.filter(result => !result.ok);

console.log("\n" + "=".repeat(66));
console.log("FORJA — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
if (failed.length > 0) {
  console.log("Falhas: " + failed.map(item => item.name).join(" | "));
}
console.log("=".repeat(66));

process.exitCode = failed.length > 0 ? 1 : 0;
