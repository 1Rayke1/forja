/*
  Testes de paridade: os 39 testes da suíte de página única (commit acbcbfb,
  tests/forja.test.mjs) portados para o app multipágina.

  Os nomes abaixo são os nomes originais, para rastreio. Cada teste exercita o
  mesmo comportamento no fluxo real das páginas (index, treino/*, progresso,
  configuracoes), com o mesmo armazenamento. Veja a tabela de correspondência
  em docs/testes-paridade.md.

  Uso: node tests/paridade.test.mjs  (também executado por npm test)
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { boot, closeAllApps, repoRoot, wait, BASE } from "./helpers/harness.mjs";
import {
  PAGE, todayKey, makeRoutine, waitUntil, waitPath, assertNoErrors, buttonByText,
  openPage, chooseMode, routineCard, createRoutine, addExercise, saveRoutine,
  backToRoutines, startRoutine, completeSet, endSession, formatSelected,
  installFailingStorage, snapshot
} from "./helpers/legacy-flows.mjs";

const results = [];

async function runTest(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("✅ " + name);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log("❌ " + name);
    console.log("   " + String(error && error.stack ? error.stack : error).split("\n").slice(0, 10).join("\n   "));
  } finally {
    closeAllApps();
  }
}

// Visível = elemento existe e não tem hidden (equivale ao antigo `.hidden === false`).
const shown = (app, sel) => {
  const el = app.$(sel);
  return !!el && !el.hidden;
};

/* ------------------------------------------------------------------ */
/* 1. Leitura de dados antigos e migração                              */
/* ------------------------------------------------------------------ */

await runTest("1. Migração dos dados antigos", async () => {
  const legacyExercises = {
    calisthenics: [
      { id: "c1", name: "Flexão", sets: 3, reps: "12", rest: 45, load: "" },
      { id: "c2", name: "Barra fixa", sets: 2, reps: "6", rest: 90, load: "" }
    ],
    weights: [
      { id: "w1", name: "Supino reto", sets: 4, reps: "10", rest: 120, load: "40 kg" }
    ]
  };
  const legacyHistory = [{
    id: "old-session",
    date: "2026-10-18",
    modality: "weights",
    durationMs: 600000,
    completedSets: 4,
    exercises: [{ id: "w1", name: "Supino reto", plannedSets: 4, reps: "10", load: "40 kg", completedSets: 4 }]
  }];
  const legacyActive = {
    id: "legacy-active",
    date: todayKey(),
    modality: "calisthenics",
    startedAt: Date.now() - 30000,
    elapsedMs: 0,
    running: true,
    completedSets: { c1: 1 },
    restEndAt: null,
    restRemainingMs: 0,
    restPaused: false
  };
  const missions = [{ id: "m1", text: "Ler 20 páginas", done: false }];

  const seed = {
    "forja-treino-exercicios-v1": legacyExercises,
    "forja-treino-historico-v1": legacyHistory,
    "forja-treino-sessao-ativa-v1": legacyActive,
    ["forja-missoes-" + todayKey()]: missions
  };

  const app = await boot(seed, PAGE.index);

  // A chave antiga permanece byte a byte.
  assert.equal(app.raw("forja-treino-exercicios-v1"), JSON.stringify(legacyExercises));

  // Rotinas padrão por modalidade, com ids e cargas preservados.
  const routines = app.data("forja-treino-rotinas-v1");
  assert.equal(routines.calisthenics.length, 1);
  assert.equal(routines.weights.length, 1);
  assert.equal(routines.calisthenics[0].name, "Rotina padrão");
  assert.deepEqual(routines.calisthenics[0].sections.main.map(item => item.id), ["c1", "c2"]);
  assert.equal(routines.weights[0].sections.main[0].load, "40 kg");
  assert.equal(routines.calisthenics[0].sections.warmup.length, 0);
  assert.equal(routines.calisthenics[0].sections.abs.length, 0);
  assert.equal(routines.calisthenics[0].sections.finisher.length, 0);

  // Histórico antigo intacto e visível na modalidade correta.
  assert.equal(app.raw("forja-treino-historico-v1"), JSON.stringify(legacyHistory));
  await chooseMode(app, "weights");
  assert.equal(app.text("#history-total"), "1");

  // Sessão ativa migrada para o novo formato, com o original arquivado.
  const active = app.data("forja-treino-sessao-ativa-v1");
  assert.equal(active.version, 2);
  assert.equal(active.id, "legacy-active");
  assert.deepEqual(active.queue.map(item => item.id), ["c1", "c2"]);
  assert.equal(active.completedSets.c1, 1);
  assert.equal(active.currentIndex, 0);
  assert.equal(active.routineName, "Rotina padrão");
  assert.ok(app.raw("forja-treino-sessao-ativa-legada-v1"), "Sessão antiga deve ser arquivada");
  assert.ok(app.data("forja-treino-migracao-v1").activeSessionMigratedAt);

  // Tela de execução abre retomando onde parou.
  await openPage(app, PAGE.executar);
  assert.ok(shown(app, "#execution-live"), "Execução não exibida");
  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.text("#current-sets-value").replace(/\s+/g, " "), "1 / 3");

  // Missões do dia continuam funcionando.
  await openPage(app, PAGE.index);
  assert.equal(app.text(".task-text"), "Ler 20 páginas");

  assertNoErrors(app, "migração");
});

await runTest("1b. Migração não destrói JSON corrompido", async () => {
  const app = await boot({
    "forja-treino-exercicios-v1": { calisthenics: "quebrado", weights: null },
    "forja-treino-historico-v1": "{isso não é json",
    "forja-treino-sessao-ativa-v1": "também quebrado",
    ["forja-missoes-" + todayKey()]: [{ id: "m", text: "Missão íntegra", done: false }]
  }, PAGE.index);

  // Histórico ilegível permanece no armazenamento (não é apagado em silêncio).
  assert.equal(app.raw("forja-treino-historico-v1"), "{isso não é json");

  // A sessão ativa ilegível sai da chave de execução; o original fica arquivado.
  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null);

  const preserved = app.data("forja-treino-dados-preservados-v1");
  assert.ok(preserved, "Dados ilegíveis devem ser preservados");
  assert.equal(preserved.length >= 2, true);
  const archivedActive = preserved.find(item => item.key === "forja-treino-sessao-ativa-v1");
  assert.ok(archivedActive, "Sessão ativa ilegível deve ser arquivada");
  assert.equal(archivedActive.raw, "também quebrado");
  assert.equal(app.text(".task-text"), "Missão íntegra");
  assert.equal(shown(app, "#toast") && /preservad/i.test(app.text("#toast")), true);

  await openPage(app, PAGE.executar);
  assert.equal(shown(app, "#execution-live"), false, "Sessão ilegível não deve reabrir");

  assertNoErrors(app, "corrompido");
});

await runTest("1c. Rotinas ausentes são reconstruídas a partir do legado", async () => {
  const app = await boot({
    "forja-treino-exercicios-v1": {
      calisthenics: [{ name: "Flexão", sets: 2, reps: "8", rest: 30 }],
      weights: []
    }
  }, PAGE.index);

  const routines = app.data("forja-treino-rotinas-v1");
  assert.equal(routines.calisthenics[0].sections.main.length, 1);
  assert.equal(routines.weights.length, 0);
  assert.match(app.text("#toast"), /migrad/i);

  assertNoErrors(app, "rotinas legadas");
});

await runTest("1d. Auditoria: calendário, missões, exercícios e histórico são preservados", async () => {
  const today = todayKey();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = [
    yesterdayDate.getFullYear(),
    String(yesterdayDate.getMonth() + 1).padStart(2, "0"),
    String(yesterdayDate.getDate()).padStart(2, "0")
  ].join("-");

  const missionsToday = [
    { id: "m1", text: "Beber água", done: true },
    { id: "m2", text: "Ler 20 páginas", done: false }
  ];
  const missionsLegacy = ["Caminhar 30 min", "Alongar"];
  const legacyExercises = {
    calisthenics: [
      { id: "c1", name: "Flexão", sets: 3, reps: "12", rest: 60, load: "" },
      { id: "c2", name: "Barra fixa", sets: 4, reps: "6", rest: 90, load: "" }
    ],
    weights: [
      { id: "w1", name: "Supino reto", sets: 4, reps: "8", rest: 120, load: "50 kg" }
    ]
  };
  const legacyHistory = [
    {
      id: "h1", date: yesterday, modality: "calisthenics",
      durationMs: 1800000, completedSets: 7,
      exercises: [
        { id: "c1", name: "Flexão", plannedSets: 3, reps: "12", completedSets: 3 },
        { id: "c2", name: "Barra fixa", plannedSets: 4, reps: "6", completedSets: 4 }
      ]
    },
    {
      id: "h2", date: "2026-10-10", modality: "weights",
      durationMs: 2400000, completedSets: 9,
      exercises: [
        { id: "w1", name: "Supino reto", plannedSets: 4, reps: "8", load: "50 kg", completedSets: 4 }
      ]
    }
  ];
  const legacyActive = {
    id: "legacy-audit",
    date: today,
    modality: "weights",
    startedAt: Date.now() - 90000,
    elapsedMs: 0,
    running: true,
    completedSets: { w1: 2 },
    restEndAt: null,
    restRemainingMs: 0,
    restPaused: false
  };
  const foreignForjaKey = "forja-preferencias-visuais";
  const foreignValue = { tema: "escuro", dourado: true };
  const unrelatedKey = "outro-app-qualquer";
  const unrelatedValue = "não deve ser tocado";

  const seed = {
    ["forja-missoes-" + today]: missionsToday,
    ["forja-missoes-" + yesterday]: missionsLegacy,
    "forja-treino-exercicios-v1": legacyExercises,
    "forja-treino-historico-v1": legacyHistory,
    "forja-treino-sessao-ativa-v1": legacyActive,
    [foreignForjaKey]: foreignValue,
    [unrelatedKey]: unrelatedValue
  };
  const seedRaw = key => {
    const value = seed[key];
    return typeof value === "string" ? value : JSON.stringify(value);
  };

  const app = await boot(seed, PAGE.index);

  const untouchedKeys = [
    "forja-missoes-" + today,
    "forja-missoes-" + yesterday,
    "forja-treino-exercicios-v1",
    "forja-treino-historico-v1",
    foreignForjaKey,
    unrelatedKey
  ];

  const afterMigration = snapshot(app);
  untouchedKeys.forEach(key => {
    assert.equal(afterMigration[key], seedRaw(key), "A migração alterou " + key);
  });

  // A sessão ativa é o único dado que muda de formato; o original fica arquivado.
  const archived = JSON.parse(afterMigration["forja-treino-sessao-ativa-legada-v1"]);
  const archivedSession = archived.session || archived;
  assert.equal(archivedSession.id, "legacy-audit");
  assert.equal(archivedSession.completedSets.w1, 2);

  // Rotinas padrão criadas com ids/cargas originais.
  const routines = app.data("forja-treino-rotinas-v1");
  assert.equal(routines.calisthenics.length, 1);
  assert.equal(routines.weights.length, 1);
  assert.deepEqual(routines.calisthenics[0].sections.main.map(item => item.id), ["c1", "c2"]);
  assert.equal(routines.weights[0].sections.main[0].load, "50 kg");

  const migration = app.data("forja-treino-migracao-v1");
  assert.equal(migration.source, "forja-treino-exercicios-v1");
  assert.deepEqual(
    migration.routinesCreated.map(item => [item.modality, item.exercises]),
    [["calisthenics", 2], ["weights", 1]]
  );

  // Nada foi arquivado como "corrompido" em uma migração saudável.
  assert.equal(app.raw("forja-treino-dados-preservados-v1"), null);

  // Missões em formato antigo continuam legíveis pela função do app.
  const legacyTasks = app.w.readTasks(new Date(
    Number(yesterday.slice(0, 4)),
    Number(yesterday.slice(5, 7)) - 1,
    Number(yesterday.slice(8, 10))
  ));
  assert.deepEqual(Array.from(legacyTasks, task => String(task.text)), missionsLegacy);

  // Segundo carregamento: idempotente, sem rotinas duplicadas nem reescritas.
  const storedAfterFirstBoot = snapshot(app);
  app.close();

  const second = await boot(storedAfterFirstBoot, PAGE.index);
  const afterSecondBoot = snapshot(second);

  assert.equal(afterSecondBoot["forja-treino-rotinas-v1"], storedAfterFirstBoot["forja-treino-rotinas-v1"],
    "Rotinas não devem mudar no segundo boot");
  assert.equal(afterSecondBoot["forja-treino-historico-v1"], storedAfterFirstBoot["forja-treino-historico-v1"]);
  assert.equal(afterSecondBoot["forja-treino-exercicios-v1"], storedAfterFirstBoot["forja-treino-exercicios-v1"]);
  assert.equal(afterSecondBoot["forja-treino-sessao-ativa-legada-v1"], storedAfterFirstBoot["forja-treino-sessao-ativa-legada-v1"]);
  assert.equal(JSON.parse(afterSecondBoot["forja-treino-rotinas-v1"]).calisthenics.length, 1);
  assert.equal(JSON.parse(afterSecondBoot["forja-treino-sessao-ativa-v1"]).version, 2);

  // A sessão ativa migrada reabre; descartá-la não altera o histórico.
  await openPage(second, PAGE.executar);
  assert.equal(shown(second, "#execution-live"), true);
  assert.equal(second.text("#current-name"), "Supino reto");
  await endSession(second, "discard");
  assert.equal(second.raw("forja-treino-sessao-ativa-v1"), null);
  assert.equal(second.data("forja-treino-historico-v1").length, legacyHistory.length);

  // Histórico visível por modalidade, com os registros antigos intactos.
  await chooseMode(second, "calisthenics");
  assert.equal(second.text("#history-total"), "1");
  await chooseMode(second, "weights");
  assert.equal(second.text("#history-total"), "1");

  // Adicionar missão muda somente a chave do dia atual.
  await openPage(second, PAGE.index);
  const rawBeforeMission = snapshot(second);
  second.$("#task-input").value = "Nova missão de auditoria";
  second.$("#task-form").dispatchEvent(new second.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);

  untouchedKeys.forEach(key => {
    if (key === "forja-missoes-" + today) return;
    assert.equal(second.raw(key), rawBeforeMission[key], "Missão alterou " + key);
  });
  assert.equal(second.data("forja-missoes-" + today).length, missionsToday.length + 1);

  // CRUD de rotina muda somente a chave de rotinas.
  const rawBeforeRoutines = snapshot(second);
  await chooseMode(second, "calisthenics");
  await createRoutine(second, "Rotina de auditoria");
  await addExercise(second, { name: "Agachamento livre", sets: 1, reps: "15", rest: 0 });
  await saveRoutine(second);
  await backToRoutines(second);

  untouchedKeys.forEach(key => {
    assert.equal(second.raw(key), rawBeforeRoutines[key], "Rotina alterou " + key);
  });
  assert.equal(second.data("forja-treino-historico-v1").length, legacyHistory.length);

  // Concluir um treino acrescenta ao histórico e preserva os registros antigos.
  await startRoutine(second, "Rotina de auditoria");
  await completeSet(second);
  await wait(40);
  assert.equal(shown(second, "#execution-summary"), true);
  assert.match(second.text("#summary-title"), /Treino concluído/);

  const historyAfterWorkout = second.data("forja-treino-historico-v1");
  assert.equal(historyAfterWorkout.length, legacyHistory.length + 1);
  assert.deepEqual(historyAfterWorkout.slice(1), legacyHistory);
  assert.deepEqual(second.data("forja-missoes-" + today).slice(0, missionsToday.length), missionsToday);
  assert.equal(second.raw("forja-treino-exercicios-v1"), rawBeforeMission["forja-treino-exercicios-v1"]);

  assertNoErrors(second, "auditoria de preservação");
});

await runTest("1e. Conteúdo parcialmente inválido é arquivado, nunca descartado", async () => {
  const validRoutine = makeRoutine("calisthenics", "Treino válido", [
    { name: "Flexão", sets: 2, reps: "10", rest: 0 }
  ]);
  const routinesRaw = {
    calisthenics: [validRoutine, { id: "sem-nome", sections: {} }],
    weights: []
  };

  const app = await boot({
    "forja-treino-rotinas-v1": routinesRaw,
    "forja-treino-exercicios-v1": {
      calisthenics: [
        { id: "ok", name: "Exercício legível", sets: 2, reps: "10", rest: 30 },
        { id: "ruim", sets: 3, reps: "10", rest: 30 }
      ],
      weights: []
    }
  }, PAGE.calistenia);

  // A rotina válida carrega; a inválida não é mostrada.
  assert.equal(app.$$(".routine-card").length, 1);

  // O armazenamento original permanece intacto após o boot.
  assert.equal(app.raw("forja-treino-rotinas-v1"), JSON.stringify(routinesRaw));

  const preserved = app.data("forja-treino-dados-preservados-v1");
  assert.ok(preserved, "Conteúdo parcialmente inválido deve ser arquivado");
  assert.ok(preserved.some(item => item.key === "forja-treino-rotinas-v1" && item.raw === JSON.stringify(routinesRaw)));
  assert.ok(preserved.some(item => item.key === "forja-treino-exercicios-v1"));
  assert.match(app.text("#toast"), /preservad/i);

  // Reiniciar não duplica arquivamentos idênticos.
  const stored = snapshot(app);
  app.close();

  const second = await boot(stored, PAGE.calistenia);
  const routineArchives = second.data("forja-treino-dados-preservados-v1").filter(item => {
    return item.key === "forja-treino-rotinas-v1" && item.raw === JSON.stringify(routinesRaw);
  });
  assert.equal(routineArchives.length, 1, "O mesmo conteúdo não deve ser arquivado duas vezes");

  assertNoErrors(second, "arquivamento parcial");
});

await runTest("1f. Formato antigo ilegível não é sobrescrito por rotinas vazias", async () => {
  const corruptLegacy = "{isto não é json";

  const app = await boot({
    "forja-treino-exercicios-v1": corruptLegacy
  }, PAGE.index);

  // Nenhuma rotina vazia é gravada, permitindo recuperar o dado e migrar depois.
  assert.equal(app.raw("forja-treino-rotinas-v1"), null);
  assert.equal(app.raw("forja-treino-exercicios-v1"), corruptLegacy);
  const preserved = app.data("forja-treino-dados-preservados-v1");
  assert.equal(preserved[0].key, "forja-treino-exercicios-v1");
  assert.equal(preserved[0].raw, corruptLegacy);
  assert.match(app.text("#toast"), /ilegíveis|preservad/i);

  // Segundo boot mantém o comportamento e não duplica o arquivo.
  const stored = snapshot(app);
  app.close();

  const second = await boot(stored, PAGE.index);
  assert.equal(second.raw("forja-treino-rotinas-v1"), null);
  assert.equal(second.raw("forja-treino-exercicios-v1"), corruptLegacy);
  assert.equal(second.data("forja-treino-dados-preservados-v1").filter(item => item.raw === corruptLegacy).length, 1);

  // A interface continua funcional: cria rotina do zero e salva.
  await chooseMode(second, "calisthenics");
  await createRoutine(second, "Rotina nova");
  await addExercise(second, { name: "Remada", sets: 2, reps: "10", rest: 30 });
  await saveRoutine(second);
  assert.equal(second.data("forja-treino-rotinas-v1").calisthenics.length, 1);
  assert.equal(second.raw("forja-treino-exercicios-v1"), corruptLegacy);

  assertNoErrors(second, "legado ilegível");
});

await runTest("1g. Sessão ativa com itens não reconhecidos preserva o original", async () => {
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Treino A", [
      { id: "ex1", name: "Flexão", sets: 3, reps: "10", rest: 0 },
      { id: "ex2", name: "Barra", sets: 2, reps: "5", rest: 0 }
    ])],
    weights: []
  };

  const sessionRaw = {
    version: 2,
    id: "sessao-parcial",
    date: todayKey(),
    modality: "calisthenics",
    routineId: "calisthenics-routine-treino-a",
    routineName: "Treino A",
    startedAt: Date.now() - 20000,
    elapsedMs: 0,
    running: true,
    currentIndex: 0,
    completedSets: { ex1: 1, fantasma: 4 },
    totalPlannedSets: 5,
    queue: [
      { id: "ex1", name: "Flexão", sets: 3, type: "reps", reps: "10", rest: 0, section: "main" },
      { id: "quebrado" }
    ],
    status: "active",
    restEndAt: null,
    restRemainingMs: 0,
    restPaused: false,
    pendingAdvance: false
  };

  const app = await boot({
    "forja-treino-rotinas-v1": routines,
    "forja-treino-sessao-ativa-v1": sessionRaw
  }, PAGE.executar);

  // Sessão normalizada continua utilizável.
  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.text("#current-sets-value").replace(/\s+/g, " "), "1 / 3");

  // Original arquivado antes de qualquer regravação.
  const preserved = app.data("forja-treino-dados-preservados-v1");
  assert.ok(preserved.some(item => item.key === "forja-treino-sessao-ativa-v1" && item.raw === JSON.stringify(sessionRaw)));
  assert.match(app.text("#toast"), /preservad/i);

  // Concluir uma série regrava apenas a versão normalizada; o arquivo permanece.
  await completeSet(app);
  assert.equal(app.data("forja-treino-sessao-ativa-v1").version, 2);
  assert.ok(app.data("forja-treino-dados-preservados-v1").some(item => item.raw === JSON.stringify(sessionRaw)));

  assertNoErrors(app, "sessão parcial");
});

const waitFor = (predicate, options = {}) => waitUntil(predicate, options.timeout || 4000);

async function openRoutine(app, name) {
  const card = routineCard(app, name);
  assert.ok(card, "Rotina não encontrada: " + name);
  app.click(buttonByText(card, /Editar exercícios/));
  await waitPath(app, "rotina.html");
}

/* ------------------------------------------------------------------ */
/* 2. CRUD de rotinas                                                  */
/* ------------------------------------------------------------------ */

await runTest("2. Criar, editar, duplicar, renomear, reordenar e excluir rotinas", async () => {
  const app = await boot({}, PAGE.calistenia);

  await createRoutine(app, "Treino A");
  assert.equal(app.$("#routine-name-input").value, "Treino A");

  await addExercise(app, { section: "main", name: "Flexão", sets: 3, reps: "12", rest: 45, notes: "Descer controlado" });
  await addExercise(app, { section: "main", name: "Remada invertida", sets: 3, reps: "10", rest: 60 });
  await addExercise(app, { section: "abs", name: "Prancha", type: "duration", sets: 2, duration: 40, rest: 30 });
  await saveRoutine(app);
  assert.match(app.text("#toast"), /Rotina salva/);

  let stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics.length, 1);
  assert.equal(stored.calisthenics[0].sections.main.length, 2);
  assert.equal(stored.calisthenics[0].sections.abs[0].type, "duration");
  assert.equal(stored.calisthenics[0].sections.abs[0].duration, 40);
  assert.equal(stored.calisthenics[0].sections.main[0].notes, "Descer controlado");

  await backToRoutines(app);
  assert.match(app.w.location.pathname, /calistenia\.html$/);
  const card = routineCard(app, "Treino A");
  assert.match(card.textContent, /3 exercícios/);
  assert.match(card.textContent, /8 séries planejadas/);

  // Renomear
  app.click(buttonByText(card, /Renomear/));
  await wait(20);
  app.modalField("name").value = "Treino A — Superior";
  app.modalAction("rename");
  await wait(25);
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics[0].name, "Treino A — Superior");

  // Reordenar (main: Flexão, Remada -> Remada, Flexão)
  await openRoutine(app, "Treino A — Superior");
  const firstRow = app.$$('[data-section-list="main"] .editor-exercise')[0];
  app.click(firstRow.querySelectorAll(".exercise-tools .icon-button")[1]);
  await wait(15);
  await saveRoutine(app);
  stored = app.data("forja-treino-rotinas-v1");
  assert.deepEqual(stored.calisthenics[0].sections.main.map(item => item.name), ["Remada invertida", "Flexão"]);

  // Editar exercício
  app.click(app.$$('[data-section-list="main"] .editor-exercise')[1].querySelectorAll(".exercise-tools .icon-button")[2]);
  await wait(15);
  app.$("#exercise-sets").value = "5";
  app.$("#exercise-notes").value = "Uma repetição a mais que a última vez";
  app.$("#exercise-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  app.$("#routine-name-input").value = "Treino A";
  await saveRoutine(app);
  stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics[0].name, "Treino A");
  assert.equal(stored.calisthenics[0].sections.main[1].sets, 5);
  assert.match(stored.calisthenics[0].sections.main[1].notes, /repetição a mais/);

  // Remover exercício
  await backToRoutines(app);
  await openRoutine(app, "Treino A");
  app.click(app.$$('[data-section-list="abs"] .editor-exercise')[0].querySelector(".icon-button.remove"));
  await wait(20);
  app.modalAction("remove");
  await wait(20);
  await saveRoutine(app);
  stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics[0].sections.abs.length, 0);

  // Duplicar
  await backToRoutines(app);
  app.click(buttonByText(routineCard(app, "Treino A"), /Duplicar/));
  await wait(25);
  stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics.length, 2);
  const copy = stored.calisthenics.find(item => item.name === "Treino A (cópia)");
  assert.ok(copy, "Cópia da rotina deve existir");
  const originalIds = new Set(stored.calisthenics[0].sections.main.map(item => item.id));
  copy.sections.main.forEach(item => {
    assert.equal(originalIds.has(item.id), false, "Duplicata deve ter ids novos");
  });

  // Excluir com confirmação: cancelar mantém
  app.click(buttonByText(routineCard(app, "Treino A (cópia)"), /Excluir/));
  await wait(20);
  assert.match(app.text("#modal-title"), /Excluir rotina/);
  app.modalAction("cancel");
  await wait(20);
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics.length, 2);

  // Excluir com confirmação: confirmar remove
  app.click(buttonByText(routineCard(app, "Treino A (cópia)"), /Excluir/));
  await wait(20);
  app.modalAction("delete");
  await wait(25);
  stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics.length, 1);
  assert.equal(stored.calisthenics[0].name, "Treino A");

  assertNoErrors(app, "CRUD de rotinas");
});

await runTest("2b. Rotina não é iniciada sem exercícios e alterações não salvas são protegidas", async () => {
  const app = await boot({}, PAGE.calistenia);
  await createRoutine(app, "Vazia");
  await addExercise(app, { name: "Agachamento", sets: 2, reps: "15", rest: 0 });
  await saveRoutine(app);
  await backToRoutines(app);

  // Alteração não salva: sair pede confirmação
  await openRoutine(app, "Vazia");
  app.$("#exercise-name").value = "Afundo";
  app.$("#exercise-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  app.click("#back-to-modality");
  await wait(20);
  assert.match(app.text("#modal-title"), /Descartar alterações/);
  app.modalAction("cancel");
  await wait(20);
  assert.match(app.w.location.pathname, /rotina\.html$/, "Cancelar deve manter no editor");
  app.click("#back-to-modality");
  await wait(20);
  app.modalAction("discard");
  await wait(25);
  const routine = app.data("forja-treino-rotinas-v1").calisthenics[0];
  assert.equal(routine.sections.main.length, 1, "Exercício não salvo não deve persistir");

  // Rotina sem exercícios tem início desabilitado
  await createRoutine(app, "Outra vazia");
  await backToRoutines(app);
  const emptyCard = routineCard(app, "Outra vazia");
  const start = emptyCard.querySelector(".routine-start");
  assert.equal(start.disabled, true);
  assert.match(start.textContent, /Adicione exercícios/);

  assertNoErrors(app, "rotina vazia");
});

/* ------------------------------------------------------------------ */
/* 3. Modalidades independentes                                        */
/* ------------------------------------------------------------------ */

await runTest("3. Calistenia e Musculação têm rotinas e históricos separados", async () => {
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Treino A", [
      { name: "Flexão", sets: 1, reps: "10", rest: 0 }
    ])],
    weights: [makeRoutine("weights", "Treino A", [
      { name: "Supino", sets: 1, reps: "8", rest: 0, load: "30 kg" }
    ])]
  };

  const app = await boot({ "forja-treino-rotinas-v1": routines }, PAGE.hub);

  await chooseMode(app, "calisthenics");
  assert.equal(app.$$(".routine-card").length, 1);
  assert.equal(app.$(".routine-name").textContent, "Treino A");
  const calisthenicsRoutines = app.data("forja-treino-rotinas-v1").calisthenics;
  assert.equal(calisthenicsRoutines[0].sections.main[0].name, "Flexão");
  assert.equal(calisthenicsRoutines[0].sections.main[0].load, "");
  const weightsRoutines = app.data("forja-treino-rotinas-v1").weights;
  assert.equal(weightsRoutines[0].sections.main[0].name, "Supino");
  assert.equal(weightsRoutines[0].sections.main[0].load, "30 kg");

  await startRoutine(app, "Treino A");
  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.text("#current-plan").includes("Carga"), false);
  await completeSet(app);
  assert.equal(app.text("#summary-title"), "Treino concluído");
  app.click("#summary-close");
  await waitUntil(() => !app.w.location.pathname.includes("executar.html"));
  await wait(30);

  await chooseMode(app, "weights");
  assert.equal(app.$$(".routine-card").length, 1);
  assert.equal(app.$(".routine-name").textContent, "Treino A");
  assert.equal(app.text("#history-total"), "0", "Histórico de musculação deve estar vazio");

  await chooseMode(app, "calisthenics");
  assert.equal(app.text("#history-total"), "1");
  const history = app.data("forja-treino-historico-v1");
  assert.equal(history.length, 1);
  assert.equal(history[0].modality, "calisthenics");
  assert.equal(history[0].exercises[0].name, "Flexão");

  // Carga aparece na musculação
  await chooseMode(app, "weights");
  await startRoutine(app, "Treino A");
  assert.match(app.text("#current-plan"), /Carga: 30 kg/);

  assertNoErrors(app, "modalidades");
});

/* ------------------------------------------------------------------ */
/* 4. Execução, descanso, pausa, retomada, avanço automático           */
/* ------------------------------------------------------------------ */

await runTest("4. Execução com descanso, pausa, retomada e avanço automático", async () => {
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Treino A", [
      { id: "ex1", name: "Flexão", sets: 2, reps: "10", rest: 1 },
      { id: "ex2", name: "Barra", sets: 1, reps: "5", rest: 0 }
    ])],
    weights: []
  };

  const app = await boot({ "forja-treino-rotinas-v1": routines }, PAGE.calistenia);
  await startRoutine(app, "Treino A");

  // Tela focada: sem lista completa de exercícios
  assert.equal(app.$(".exercise-list"), null, "Lista completa não deve existir na execução");
  assert.equal(shown(app, "#execution-live"), true);
  assert.equal(app.text("#current-section"), "Treino principal");
  assert.equal(app.text("#execution-position"), "Exercício 1 de 2");
  assert.equal(app.text("#current-sets-value").replace(/\s+/g, " "), "0 / 2");
  assert.match(app.text("#current-plan"), /10 repetições/);
  assert.match(app.text("#current-rest-value"), /1 s/);

  // Série 1: inicia descanso automaticamente
  await completeSet(app);
  assert.equal(shown(app, "#execution-rest"), true);
  assert.equal(app.$("#complete-set").disabled, true);
  assert.match(app.text("#rest-caption"), /série 2 de 2/);

  // Pausa e retomada do descanso
  app.click("#pause-rest");
  await wait(20);
  assert.match(app.text("#rest-caption"), /pausado/i);
  assert.equal(app.$("#pause-rest").hidden, true);
  assert.equal(app.$("#resume-rest").hidden, false);
  const pausedValue = app.text("#rest-timer");
  await wait(250);
  assert.equal(app.text("#rest-timer"), pausedValue, "Descanso pausado não pode contar");

  app.click("#resume-rest");
  await wait(20);
  assert.equal(app.$("#resume-rest").hidden, true);

  // Pausa e retomada do treino
  app.click("#pause-session");
  await wait(20);
  assert.equal(app.$("#session-paused-overlay").hidden, false);
  assert.equal(app.$("#complete-set").disabled, true);
  assert.equal(app.$("#pause-session").hidden, true);
  assert.equal(app.$("#resume-session").hidden, false);
  app.click("#resume-session");
  await wait(20);
  assert.equal(app.$("#session-paused-overlay").hidden, true);

  // Fim do descanso (sem prender o usuário)
  const restEnded = await waitFor(() => app.$("#execution-rest").hidden, { timeout: 4000 });
  assert.equal(restEnded, true, "Descanso deve terminar sozinho");
  assert.equal(app.$("#complete-set").disabled, false);
  assert.match(app.text("#complete-set"), /Concluir série 2 de 2/);

  // Última série do exercício 1: descanso e avanço automático
  await completeSet(app);
  assert.equal(shown(app, "#execution-rest"), true);
  assert.equal(app.text("#current-position"), "Exercício 1 de 2");
  assert.match(app.text("#rest-caption"), /avança para Barra/);
  assert.match(app.text("#skip-rest"), /Pular e avançar/);
  const advanced = await waitFor(() => app.text("#current-position") === "Exercício 2 de 2", { timeout: 4000 });
  assert.equal(advanced, true, "O treino deve avançar automaticamente após o descanso");
  assert.equal(app.text("#current-name"), "Barra");
  assert.equal(app.$("#previous-exercise").disabled, false);

  // Voltar ao exercício anterior e avançar novamente
  app.click("#previous-exercise");
  await wait(20);
  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.text("#current-sets-value").replace(/\s+/g, " "), "2 / 2");
  app.click("#next-exercise");
  await wait(20);
  assert.equal(app.text("#current-name"), "Barra");

  // Concluir a rotina
  await completeSet(app);
  await wait(40);
  assert.equal(shown(app, "#execution-summary"), true);
  assert.equal(app.text("#summary-title"), "Treino concluído");
  assert.equal(app.text("#summary-sets").replace(/\s+/g, ""), "3/3");

  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null, "Sessão ativa deve ser removida após concluir");

  const history = app.data("forja-treino-historico-v1");
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "completed");
  assert.equal(history[0].completedSets, 3);
  assert.equal(history[0].totalPlannedSets, 3);
  assert.equal(history[0].routineName, "Treino A");
  assert.ok(history[0].durationMs >= 0);

  app.click("#summary-close");
  await waitUntil(() => !app.w.location.pathname.includes("executar.html"));
  await wait(30);
  assert.match(app.w.location.pathname, /calistenia\.html$/);
  assert.equal(app.text("#history-total"), "1");

  assertNoErrors(app, "execução");
});

await runTest("4b. Pular descanso não prende o usuário e descanso manual funciona", async () => {
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "A", [
      { name: "Agachamento", sets: 2, reps: "15", rest: 30 },
      { name: "Flexão", sets: 1, reps: "10", rest: 0 }
    ])],
    weights: []
  };

  const app = await boot({ "forja-treino-rotinas-v1": routines }, PAGE.calistenia);
  await startRoutine(app);

  // Descanso manual antes da série
  app.click("#start-rest");
  await wait(20);
  assert.equal(shown(app, "#execution-rest"), true);
  assert.match(app.text("#skip-rest"), /Pular descanso/);
  app.click("#skip-rest");
  await wait(25);
  assert.equal(shown(app, "#execution-rest"), false);
  assert.equal(app.$("#complete-set").disabled, false);

  // Descanso automático pulado
  await completeSet(app);
  assert.equal(shown(app, "#execution-rest"), true);
  app.click("#skip-rest");
  await wait(25);
  assert.equal(shown(app, "#execution-rest"), false);
  assert.equal(app.$("#complete-set").disabled, false);

  // Concluir exercício com descanso e pular o avanço
  await wait(420);
  await completeSet(app);
  assert.equal(shown(app, "#execution-rest"), true);
  app.click("#skip-rest");
  await wait(25);
  assert.equal(app.text("#current-name"), "Flexão", "Pular o descanso final deve avançar");

  assertNoErrors(app, "pular descanso");
});

/* ------------------------------------------------------------------ */
/* 5. Recarregar durante a sessão                                      */
/* ------------------------------------------------------------------ */

await runTest("5. Recarregar a página durante uma sessão ativa", async () => {
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Treino A", [
      { id: "ex1", name: "Flexão", sets: 3, reps: "10", rest: 2 },
      { id: "ex2", name: "Barra", sets: 1, reps: "5", rest: 0 }
    ])],
    weights: []
  };

  const first = await boot({ "forja-treino-rotinas-v1": routines }, PAGE.calistenia);
  await startRoutine(first, "Treino A");
  await completeSet(first);
  first.click("#pause-rest");
  await wait(20);

  const stored = snapshot(first);
  first.close();

  const second = await boot(stored, PAGE.executar);
  assert.equal(shown(second, "#execution-live"), true, "Sessão deve reabrir");
  assert.equal(second.text("#current-name"), "Flexão");
  assert.equal(second.text("#current-sets-value").replace(/\s+/g, " "), "1 / 3");
  assert.match(second.text("#rest-caption"), /pausado/i);

  // Retomar o descanso após recarregar
  second.click("#resume-rest");
  await wait(20);
  assert.equal(shown(second, "#execution-rest"), true);
  const restEnded = await waitFor(() => second.$("#execution-rest").hidden, { timeout: 4000 });
  assert.equal(restEnded, true, "Descanso deve terminar após recarregar");
  assert.match(second.text("#complete-set"), /série 2 de 3/);

  // Continuar e concluir (descansos pulados)
  for (let index = 0; index < 4; index++) {
    await waitFor(() => !second.$("#complete-set").disabled);
    await wait(420);
    await completeSet(second);

    if (shown(second, "#execution-rest")) {
      await waitFor(() => !second.$("#skip-rest").disabled);
      second.click("#skip-rest");
      await wait(30);
    }
  }

  await waitFor(() => shown(second, "#execution-summary"), { timeout: 3000 });

  assert.equal(second.text("#summary-title"), "Treino concluído");
  assert.equal(second.data("forja-treino-historico-v1")[0].completedSets, 4);

  assertNoErrors(second, "recarregar");
});

/* ------------------------------------------------------------------ */
/* 6. Conclusão e cancelamento sem corromper o histórico               */
/* ------------------------------------------------------------------ */

await runTest("6. Concluir e cancelar sessões sem corromper o histórico", async () => {
  const previousHistory = [{
    id: "hist-1",
    date: "2026-10-17",
    modality: "calisthenics",
    routineName: "Treino antigo",
    durationMs: 900000,
    completedSets: 5,
    status: "completed",
    exercises: [{ id: "a", name: "Flexão", plannedSets: 5, completedSets: 5 }]
  }];

  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Treino A", [
      { name: "Flexão", sets: 2, reps: "10", rest: 0 }
    ])],
    weights: []
  };

  const app = await boot({
    "forja-treino-historico-v1": previousHistory,
    "forja-treino-rotinas-v1": routines
  }, PAGE.hub);

  await chooseMode(app, "calisthenics");

  // Cancelar sem concluir nada: nada é registrado
  await startRoutine(app);
  await endSession(app, "discard");
  // O aviso de descarte é exibido na página que o app abre em seguida.
  await waitUntil(() => /descartada/i.test(app.text("#toast") || ""), 3000);
  assert.match(app.text("#toast") || "", /descartada/i);
  assert.equal(app.data("forja-treino-historico-v1").length, 1);
  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null);

  // Parcial: encerrar e salvar registra status partial
  await startRoutine(app);
  await completeSet(app);
  await endSession(app, "save");
  let history = app.data("forja-treino-historico-v1");
  assert.equal(history.length, 2);
  assert.equal(history[0].status, "partial");
  assert.equal(history[0].completedSets, 1);
  assert.equal(history[0].totalPlannedSets, 2);
  assert.match(app.text("#summary-title"), /Sessão encerrada/);
  app.click("#summary-close");
  await waitUntil(() => !app.w.location.pathname.includes("executar.html"));
  await wait(25);

  // Histórico anterior permanece intacto
  assert.deepEqual(history[1], previousHistory[0]);

  // Concluir normalmente adiciona apenas um registro
  await startRoutine(app);
  await completeSet(app);
  await wait(420);
  await completeSet(app);
  await wait(30);
  history = app.data("forja-treino-historico-v1");
  assert.equal(history.length, 3);
  assert.equal(history[0].status, "completed");
  assert.equal(history[1].status, "partial");
  assert.deepEqual(history[2], previousHistory[0]);

  // Sessão descartada após concluir não pode reaparecer
  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null);

  // Encerrar durante a pausa mantém consistência
  app.click("#summary-close");
  await waitUntil(() => !app.w.location.pathname.includes("executar.html"));
  await wait(25);
  await startRoutine(app);
  app.click("#pause-session");
  await wait(20);
  app.click("#end-session");
  await wait(20);
  assert.match(app.text("#modal-title"), /Encerrar sessão/);
  app.modalAction("discard");
  await wait(30);
  assert.equal(app.data("forja-treino-historico-v1").length, 3);
  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null);

  assertNoErrors(app, "histórico");
});

/* ------------------------------------------------------------------ */
/* 7. Backup JSON                                                      */
/* ------------------------------------------------------------------ */

// Código-fonte completo do app (HTML das páginas e JS dos módulos).
function appSource() {
  const parts = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "tests", "docs", ".github"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|js|mjs)$/.test(entry.name)) parts.push(fs.readFileSync(full, "utf8"));
    }
  };
  walk(repoRoot);
  return parts.join("\n");
}

await runTest("7. Exportar e importar backup JSON com validação e segurança", async () => {
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Treino A", [
      { id: "ex1", name: "Flexão", sets: 2, reps: "10", rest: 0 }
    ])],
    weights: [makeRoutine("weights", "Treino B", [
      { id: "w1", name: "Supino", sets: 3, reps: "8", rest: 60, load: "40 kg" }
    ])]
  };
  const history = [{
    id: "h1", date: "2026-10-16", modality: "weights",
    routineName: "Treino B", durationMs: 60000, completedSets: 3,
    exercises: [{ name: "Supino", plannedSets: 3, completedSets: 3 }]
  }];
  const missions = [{ id: "m1", text: "Missão do backup", done: true }];

  const app = await boot({
    "forja-treino-rotinas-v1": routines,
    "forja-treino-historico-v1": history,
    ["forja-missoes-" + todayKey()]: missions
  }, PAGE.config);

  // Exportação via UI
  app.click("#export-backup");
  await wait(30);
  assert.equal(app.downloads.length, 1);
  assert.match(app.downloads[0].download, /^forja-backup-\d{4}-\d{2}-\d{2}\.json$/);
  assert.match(app.text("#toast"), /Backup exportado/);

  const backup = app.F.buildBackupObject();
  assert.equal(backup.app, "FORJA");
  assert.equal(backup.format, "forja-backup");
  assert.equal(backup.version, 1);
  assert.ok(backup.keys["forja-treino-rotinas-v1"]);
  assert.ok(backup.keys["forja-treino-historico-v1"]);
  assert.ok(backup.keys["forja-missoes-" + todayKey()]);

  // Altera os dados atuais para provar restauração
  app.set("forja-treino-rotinas-v1", { calisthenics: [], weights: [] });
  app.set("forja-treino-historico-v1", []);
  app.set("forja-missoes-" + todayKey(), [{ id: "x", text: "Missão nova", done: false }]);

  // Importar com prévia e cancelar: nada muda
  await app.importFile(backup);
  assert.match(app.text("#modal-title"), /Restaurar backup/);
  const preview = app.$(".modal-details").textContent;
  assert.match(preview, /Missões e calendário: 1 dia/);
  assert.match(preview, /Rotinas: 2 \(Calistenia: 1, Musculação: 1\)/);
  assert.match(preview, /Histórico: 1 treino/);
  app.modalAction("cancel");
  await wait(25);
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics.length, 0);
  assert.equal(app.data("forja-treino-historico-v1").length, 0);

  // Importar e confirmar
  await app.importFile(backup);
  app.modalAction("restore");
  await wait(160);
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics.length, 1);
  assert.equal(app.data("forja-treino-rotinas-v1").weights[0].sections.main[0].load, "40 kg");
  assert.equal(app.data("forja-treino-historico-v1").length, 1);
  assert.equal(app.data("forja-treino-historico-v1")[0].id, "h1");
  assert.deepEqual(app.data("forja-missoes-" + todayKey()), missions);
  assert.ok(app.raw("forja-backup-seguranca-v1"), "Cópia de segurança deve existir");
  assert.equal(shown(app, "#restore-safety-backup"), true);

  // Desfazer a importação restaura o estado anterior
  app.click("#restore-safety-backup");
  await wait(40);
  assert.match(app.text("#modal-title"), /Desfazer última importação/);
  app.modalAction("restore");
  await wait(150);
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics.length, 0);
  assert.equal(app.data("forja-treino-historico-v1").length, 0);
  assert.equal(app.data("forja-missoes-" + todayKey())[0].text, "Missão nova");

  // JSON inválido não altera nada
  const before = app.raw("forja-treino-rotinas-v1");
  await app.importFile("{ não é json");
  assert.match(app.text("#modal-title"), /Arquivo inválido/);
  app.modalAction("close");
  await wait(20);
  assert.equal(app.raw("forja-treino-rotinas-v1"), before);

  // Arquivo de outro app é rejeitado
  await app.importFile({ app: "OUTRO", format: "forja-backup", version: 1, keys: { "forja-treino-historico-v1": [] } });
  assert.match(app.text("#modal-title"), /Backup inválido/);
  app.modalAction("close");
  await wait(20);
  assert.equal(app.raw("forja-treino-rotinas-v1"), before);

  // Estrutura inválida é rejeitada
  await app.importFile({
    app: "FORJA",
    format: "forja-backup",
    version: 1,
    keys: { "forja-treino-rotinas-v1": { calisthenics: [{ id: "r", sections: {} }] } }
  });
  assert.match(app.text("#modal-title"), /Backup inválido/);
  assert.match(app.text(".modal-message"), /não tem nome/);
  app.modalAction("close");
  await wait(20);
  assert.equal(app.raw("forja-treino-rotinas-v1"), before);

  // Chave desconhecida/fora do FORJA é rejeitada
  await app.importFile({ app: "FORJA", format: "forja-backup", version: 1, keys: { "outra-chave": [] } });
  assert.match(app.text("#modal-title"), /Backup inválido/);
  app.modalAction("close");
  await wait(20);

  // Não usa localStorage.clear (verificado em todo o código do app)
  assert.equal(/localStorage\.clear\s*\(/.test(appSource()), false);

  assertNoErrors(app, "backup");
});

await runTest("7b. Backup inclui sessão ativa e a restaura com segurança", async () => {
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Treino A", [
      { id: "ex1", name: "Flexão", sets: 3, reps: "10", rest: 30 },
      { id: "ex2", name: "Barra", sets: 2, reps: "5", rest: 30 }
    ])],
    weights: []
  };

  const app = await boot({ "forja-treino-rotinas-v1": routines }, PAGE.calistenia);
  await startRoutine(app, "Treino A");
  await completeSet(app);
  app.click("#pause-rest");
  await wait(20);

  // O backup é gerado a partir da página de configurações (mesma origem e storage).
  await openPage(app, PAGE.config);
  const backup = app.F.buildBackupObject();
  assert.ok(backup.keys["forja-treino-sessao-ativa-v1"]);
  assert.equal(backup.summary.activeSession.modality, "calisthenics");
  assert.equal(backup.summary.activeSession.legacy, false);

  // Descarta a sessão e restaura o backup
  await openPage(app, PAGE.executar);
  await endSession(app, "discard");
  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null);

  await openPage(app, PAGE.config);
  await app.importFile(backup);
  assert.match(app.$(".modal-details").textContent, /Sessão ativa: Calistenia · Treino A/);
  assert.match(app.$(".modal-details").textContent, /Atenção: O backup contém uma sessão ativa/);
  app.modalAction("restore");
  await wait(150);

  await openPage(app, PAGE.executar);
  assert.equal(shown(app, "#execution-live"), true, "Sessão restaurada deve reabrir");
  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.text("#current-sets-value").replace(/\s+/g, " "), "1 / 3");

  assertNoErrors(app, "backup com sessão ativa");
});

await runTest("7c. Importação de backup antigo sem rotinas gera rotinas padrão", async () => {
  const app = await boot({}, PAGE.config);
  const legacyBackup = {
    app: "FORJA",
    format: "forja-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    keys: {
      "forja-treino-exercicios-v1": {
        calisthenics: [{ id: "c1", name: "Flexão", sets: 3, reps: "12", rest: 45 }],
        weights: []
      },
      "forja-treino-historico-v1": []
    }
  };

  await app.importFile(legacyBackup);
  assert.match(app.$(".modal-details").textContent, /Exercícios antigos preservados: 1/);
  assert.match(app.$(".modal-details").textContent, /serão recriadas a partir dos exercícios antigos/);
  app.modalAction("restore");
  await wait(150);

  const routines = app.data("forja-treino-rotinas-v1");
  assert.equal(routines.calisthenics.length, 1);
  assert.equal(routines.calisthenics[0].name, "Rotina padrão");
  assert.equal(app.raw("forja-treino-exercicios-v1").includes("Flexão"), true);

  assertNoErrors(app, "backup legado");
});

/* ------------------------------------------------------------------ */
/* 8. Calendário e missões                                             */
/* ------------------------------------------------------------------ */

await runTest("8. Calendário e missões antes e depois das alterações", async () => {
  const today = todayKey();
  const [year, month, day] = today.split("-").map(Number);

  const app = await boot({
    ["forja-missoes-" + today]: [
      { id: "m1", text: "Beber 3L de água", done: false },
      { id: "m2", text: "Alongar", done: true }
    ]
  }, PAGE.index);

  assert.match(app.text("#month-title"), new RegExp(String(year)));
  assert.match(app.text("#selected-date"), new RegExp(String(day)));
  assert.equal(app.text("#progress-label"), "1 de 2 · 50%");
  assert.equal(app.$$(".task").length, 2);

  // Concluir missão
  const checkbox = app.$$(".task input[type=checkbox]")[0];
  checkbox.checked = true;
  checkbox.dispatchEvent(new app.w.Event("change", { bubbles: true }));
  await wait(25);
  assert.equal(app.text("#progress-label"), "2 de 2 · 100%");
  assert.equal(app.data("forja-missoes-" + today)[0].done, true);

  // Adicionar missão
  app.$("#task-input").value = "Treinar calistenia";
  app.$("#task-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(25);
  assert.equal(app.$$(".task").length, 3);
  assert.equal(app.data("forja-missoes-" + today).length, 3);

  // Dia marcado no calendário
  assert.ok(app.$$(".calendar-grid .day.has-tasks").length >= 1, "O dia com missões deve ter indicador");

  // Navegação de meses preservada
  const titleBefore = app.text("#month-title");
  app.click("#next-month");
  await wait(25);
  assert.notEqual(app.text("#month-title"), titleBefore);
  app.click("#prev-month");
  await wait(25);
  assert.equal(app.text("#month-title"), titleBefore);
  assert.equal(app.text("#progress-label"), "2 de 3 · 67%");

  // Modalidade e missões convivem sem interferência
  await chooseMode(app, "calisthenics");
  await openPage(app, PAGE.index);
  assert.equal(app.text("#progress-label"), "2 de 3 · 67%");

  // Backup e restauração não quebram o calendário
  const backup = app.F.buildBackupObject();
  app.set("forja-missoes-" + today, []);
  await openPage(app, PAGE.config);
  await app.importFile(backup);
  app.modalAction("restore");
  await wait(150);
  await openPage(app, PAGE.index);
  assert.equal(app.text("#progress-label"), "2 de 3 · 67%");
  assert.equal(app.$$(".task").length, 3);
  assert.equal(app.text(".task-text"), "Beber 3L de água");

  assertNoErrors(app, "calendário");
});

/* ------------------------------------------------------------------ */
/* 9/10. Responsividade estática e integridade de IDs                  */
/* ------------------------------------------------------------------ */

// Lê os arquivos CSS reais do app (sem os arquivos de teste).
function appCss() {
  const dir = path.join(repoRoot, "assets", "css");
  return fs.readdirSync(dir).filter(f => f.endsWith(".css"))
    .map(f => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
}

await runTest("9. Base responsiva presente (viewport e media queries)", async () => {
  const app = await boot({}, PAGE.index);

  const viewport = app.d.querySelector('meta[name="viewport"]');
  assert.ok(viewport, "Meta viewport ausente");
  assert.match(viewport.content, /width=device-width/);

  const css = appCss();
  assert.ok(css.includes("@media (max-width: 560px)"), "Media query mobile ausente");
  assert.ok(css.includes("@media (max-width: 380px)"), "Media query mobile estreita ausente");
  assert.ok(css.includes(".modality-grid"), "Grid de modalidades ausente");
  assert.ok(css.includes(".execution-screen"), "Tela de execução ausente");

  assertNoErrors(app, "responsivo estático");
});

// Ids referenciados pelos módulos (byId, getElementById, bindEvent). Todos os
// módulos carregam em todas as páginas e a maioria dos seletores só é usada na
// página correspondente; por isso a checagem é contra o conjunto de ids de todas
// as páginas, e os botões essenciais são verificados página a página.
function allModuleIds() {
  const dir = path.join(repoRoot, "assets", "js");
  const referenced = new Map();
  const patterns = [/byId\("([^"]+)"\)/g, /getElementById\("([^"]+)"\)/g, /bindEvent\("([^"]+)",/g];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".js"))) {
    const code = fs.readFileSync(path.join(dir, file), "utf8");
    for (const pattern of patterns) {
      for (const match of code.matchAll(pattern)) {
        if (!referenced.has(match[1])) referenced.set(match[1], file);
      }
    }
  }
  return referenced;
}

function idsInAllPages() {
  const ids = new Set();
  for (const page of Object.values(PAGE)) {
    const html = fs.readFileSync(path.join(repoRoot, page), "utf8");
    for (const match of html.matchAll(/\sid="([^"]+)"/g)) ids.add(match[1]);
  }
  return ids;
}

const ESSENTIAL_BY_PAGE = {
  [PAGE.hub]: ["mode-calisthenics", "mode-weights"],
  [PAGE.calistenia]: ["new-routine", "routine-list"],
  [PAGE.rotina]: ["save-routine", "save-routine-top", "exercise-form", "library-search"],
  [PAGE.executar]: [
    "complete-set", "pause-session", "resume-session", "end-session", "pause-rest",
    "resume-rest", "skip-rest", "start-rest", "previous-exercise", "next-exercise"
  ],
  [PAGE.config]: ["export-backup", "import-backup-button", "restore-safety-backup", "pref-sound"]
};

await runTest("9b. Botão TREINO quadrado, destacado, com ícone e texto (mobile)", async () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const anchorTag = html.match(/<a class="treino-square"[^>]*>[\s\S]*?<\/a>/);
  assert.ok(anchorTag, "Botão TREINO ausente na página inicial");
  assert.match(anchorTag[0], /href="treino\/index\.html"/);
  assert.match(anchorTag[0], /aria-label="Abrir TREINO/);
  assert.match(anchorTag[0], /<svg[^>]*class="treino-square-icon"/, "Ícone ausente");
  assert.match(anchorTag[0], /class="treino-square-title">TREINO</, "Texto TREINO ausente");

  const css = appCss();
  const rule = css.match(/\.treino-square\s*\{[^}]*\}/);
  assert.ok(rule, "Regra .treino-square ausente");
  assert.match(rule[0], /aspect-ratio:\s*1\s*\/\s*1/, "Botão deve ser quadrado");
  assert.match(rule[0], /width:\s*min\(240px,\s*72vw\)/, "Largura deve caber em telas pequenas");
  assert.match(css, /\.treino-square:focus-visible\s*\{/, "Foco visível ausente");
  assert.match(css, /\.treino-square-icon\s*\{/);
  assert.match(css, /\.treino-square-title\s*\{[^}]*font-size:\s*2\d+px/, "Título em destaque ausente");

  const indexApp = await boot({}, PAGE.index);
  assert.ok(indexApp.$(".treino-square"), "Botão TREINO não renderizado");
  assertNoErrors(indexApp, "botão TREINO");
  indexApp.close();
});

await runTest("10. Integridade: ids referenciados existem e nenhum erro de console", async () => {
  const pages = [PAGE.index, PAGE.hub, PAGE.calistenia, PAGE.musculacao, PAGE.rotina, PAGE.executar, PAGE.progresso, PAGE.config];
  const referenced = allModuleIds();
  const existing = idsInAllPages();
  const missing = Array.from(referenced.keys()).filter(id => !existing.has(id));
  assert.deepEqual(missing, [], "Ids referenciados nos módulos não existem em nenhuma página: " + missing.join(", ") +
    " (" + Array.from(referenced.entries()).filter(([id]) => missing.includes(id)).map(([, file]) => file).join(", ") + ")");
  assert.ok(referenced.size > 40, "Verificação de ids deve cobrir a aplicação (" + referenced.size + ")");

  for (const rel of pages) {
    const app = await boot({}, rel);
    (ESSENTIAL_BY_PAGE[rel] || []).forEach(id => {
      assert.ok(app.d.getElementById(id), "Botão ausente em " + rel + ": " + id);
    });
    assertNoErrors(app, "integridade " + rel);
    app.close();
  }
});

/* ------------------------------------------------------------------ */
/* 11. Regressão do calendário e das missões                           */
/* ------------------------------------------------------------------ */

// Armazenamento sem a cópia de segurança (como o teste antigo).
function parsedStorage(app) {
  const snap = {};
  app.keys().forEach(key => {
    if (key === "forja-backup-seguranca-v1") return;
    snap[key] = app.data(key);
  });
  return snap;
}

await runTest("11a. Calendário e missões: dias, conclusão, exclusão e persistência", async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayDay = now.getDate();
  const otherDay = todayDay === 1 ? 2 : 1;
  const pad = value => String(value).padStart(2, "0");
  const keyFor = day => "forja-missoes-" + year + "-" + pad(month + 1) + "-" + pad(day);
  const todayKeyStr = keyFor(todayDay);
  const otherKeyStr = keyFor(otherDay);

  const app = await boot({
    [todayKeyStr]: [
      { id: "t1", text: "Missão A", done: false },
      { id: "t2", text: "Missão B", done: true }
    ],
    [otherKeyStr]: [
      { id: "o1", text: "Missão de outro dia", done: false }
    ]
  }, PAGE.index);

  const fmt = day => formatSelected(app.w, year, month, day);

  assert.equal(app.text("#selected-date"), fmt(todayDay));
  assert.equal(app.text("#progress-label"), "1 de 2 · 50%");
  assert.equal(app.$$(".task").length, 2);
  assert.equal(app.$$("#calendar-grid .day.selected").length, 1);
  assert.equal(app.$$("#calendar-grid .day.has-tasks").length, 2);

  // Trocar de dia mostra apenas as missões daquele dia.
  const otherButton = app.$$("#calendar-grid .day").find(button => {
    return !button.disabled && button.textContent.trim() === String(otherDay);
  });
  assert.ok(otherButton, "Dia alternativo não encontrado no calendário");
  app.click(otherButton);
  await wait(30);

  assert.equal(app.text("#selected-date"), fmt(otherDay));
  assert.equal(app.text("#progress-label"), "0 de 1 · 0%");
  assert.equal(app.$$(".task").length, 1);
  assert.equal(app.text(".task-text"), "Missão de outro dia");

  // Persistência diária: adicionar no outro dia não toca no dia atual.
  app.$("#task-input").value = "Nova missão do outro dia";
  app.$("#task-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);
  assert.equal(app.data(otherKeyStr).length, 2);
  assert.equal(app.data(todayKeyStr).length, 2);

  // Voltar ao dia de hoje pelo calendário.
  const todayButton = app.$$("#calendar-grid .day").find(button => {
    return !button.disabled && button.textContent.trim() === String(todayDay);
  });
  app.click(todayButton);
  await wait(30);
  assert.equal(app.text("#selected-date"), fmt(todayDay));
  assert.equal(app.$$(".task").length, 2);

  // Concluir uma tarefa.
  const checkbox = app.$$(".task input[type=checkbox]")[0];
  checkbox.checked = true;
  checkbox.dispatchEvent(new app.w.Event("change", { bubbles: true }));
  await wait(30);
  assert.equal(app.text("#progress-label"), "2 de 2 · 100%");
  assert.equal(app.data(todayKeyStr)[0].done, true);
  assert.equal(app.data(otherKeyStr)[1].done, false);

  // Excluir uma tarefa.
  app.click(app.$$(".task .delete-button")[0]);
  await wait(30);
  assert.equal(app.data(todayKeyStr).length, 1);
  assert.equal(app.data(otherKeyStr).length, 2);

  // Excluir todas: estado vazio e ponto do dia removido.
  app.click(app.$$(".task .delete-button")[0]);
  await wait(30);
  assert.equal(app.data(todayKeyStr).length, 0);
  assert.equal(app.$$(".task").length, 0);
  assert.ok(app.text(".empty"), "Estado vazio deve aparecer");
  assert.equal(app.$$("#calendar-grid .day.selected.has-tasks").length, 0);
  assert.equal(app.$$("#calendar-grid .day.has-tasks").length, 1);

  // Recarregar: missões continuam salvas por dia.
  const raw = parsedStorage(app);
  app.close();

  const second = await boot(raw, PAGE.index);
  assert.equal(second.text("#selected-date"), formatSelected(second.w, year, month, todayDay));
  assert.equal(second.text("#progress-label"), "0 de 0 · 0%");
  assert.equal(second.$$(".task").length, 0);
  assert.equal(second.data(otherKeyStr).length, 2);
  assert.equal(second.data(otherKeyStr)[1].text, "Nova missão do outro dia");
  assert.equal(second.$$("#calendar-grid .day.has-tasks").length, 1);

  // Navegação de meses preservada e sem perder missões.
  const beforeNavigation = second.w.eval("({ year: displayedYear, month: displayedMonth })");
  const title = second.text("#month-title");
  second.click("#next-month");
  await wait(25);
  const afterNext = second.w.eval("({ year: displayedYear, month: displayedMonth })");
  assert.equal(afterNext.month, (beforeNavigation.month + 1) % 12);
  second.click("#prev-month");
  await wait(25);
  assert.equal(second.text("#month-title"), title);
  assert.equal(second.data(otherKeyStr).length, 2);

  assertNoErrors(second, "calendário completo");
});

await runTest("11b. Um envio cria exatamente um item (sem listeners duplicados)", async () => {
  const today = todayKey();
  const app = await boot({}, PAGE.index);

  const before = app.$$(".task").length;
  app.$("#task-input").value = "Missão única";
  app.$("#task-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);
  assert.equal(app.$$(".task").length, before + 1);
  assert.equal(app.data("forja-missoes-" + today).length, 1);

  // Navegar dois meses avança exatamente dois meses.
  const start = app.w.eval("displayedMonth");
  app.click("#next-month");
  app.click("#next-month");
  await wait(30);
  const after = app.w.eval("displayedMonth");
  assert.equal(after, (start + 2) % 12);
  app.click("#prev-month");
  app.click("#prev-month");
  await wait(30);
  assert.equal(app.w.eval("displayedMonth"), start);

  // Duas submissões geram duas missões (e não quatro).
  app.$("#task-input").value = "Segunda missão";
  app.$("#task-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  app.$("#task-input").value = "Terceira missão";
  app.$("#task-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);
  assert.equal(app.data("forja-missoes-" + today).length, 3);

  assertNoErrors(app, "listeners únicos");
});

await runTest("11c. Missões antigas em formato de texto continuam funcionando", async () => {
  const today = todayKey();
  const app = await boot({
    ["forja-missoes-" + today]: ["Missão em texto 1", "Missão em texto 2"]
  }, PAGE.index);

  assert.equal(app.$$(".task").length, 2);
  assert.equal(app.text(".task-text"), "Missão em texto 1");
  assert.equal(app.text("#progress-label"), "0 de 2 · 0%");

  const checkbox = app.$$(".task input[type=checkbox]")[0];
  checkbox.checked = true;
  checkbox.dispatchEvent(new app.w.Event("change", { bubbles: true }));
  await wait(30);

  const stored = app.data("forja-missoes-" + today);
  assert.equal(stored.length, 2);
  assert.equal(stored[0].text, "Missão em texto 1");
  assert.equal(stored[0].done, true);
  assert.equal(stored[1].text, "Missão em texto 2");
  assert.equal(stored[1].done, false);
  assert.equal(app.text("#progress-label"), "1 de 2 · 50%");

  const raw = parsedStorage(app);
  app.close();

  const second = await boot(raw, PAGE.index);
  assert.equal(second.text("#progress-label"), "1 de 2 · 50%");
  assert.equal(second.$$(".task.done").length, 1);

  assertNoErrors(second, "missões antigas");
});

/* ------------------------------------------------------------------ */
/* 12. Integridade estrutural e conflitos                              */
/* ------------------------------------------------------------------ */

await runTest("12a. IDs únicos inclusive com modal, editor e execução abertos", async () => {
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Treino A", [
      { id: "ex1", name: "Flexão", sets: 1, reps: "10", rest: 0 }
    ])],
    weights: []
  };

  const app = await boot({ "forja-treino-rotinas-v1": routines }, PAGE.calistenia);

  const assertUniqueIds = label => {
    const ids = app.$$("[id]").map(element => element.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual(duplicates, [], "IDs duplicados (" + label + "): " + duplicates.join(", "));
    assert.ok(ids.length > 20);
  };

  assertUniqueIds("inicial");

  app.click("#new-routine");
  await wait(25);
  assertUniqueIds("modal aberto");
  app.modalAction("cancel");
  await wait(20);

  app.click(buttonByText(routineCard(app, "Treino A"), /Editar exercícios/));
  await waitPath(app, "rotina.html");
  assertUniqueIds("editor aberto");
  app.click("#back-to-modality");
  await waitUntil(() => !app.w.location.pathname.includes("rotina.html"));
  await wait(30);

  await startRoutine(app, "Treino A");
  assertUniqueIds("execução aberta");

  app.click("#end-session");
  await wait(25);
  assertUniqueIds("modal sobre execução");
  app.modalAction("discard");
  await wait(30);

  assertNoErrors(app, "ids únicos");
});

await runTest("12b. Nenhuma função/ID antiga referenciada e um único boot", async () => {
  const source = appSource();

  // Nomes da versão de página única que não devem mais ser chamados.
  const removedFunctions = [
    "beginExerciseEdit", "cancelExerciseEdit", "completeSet",
    "endRest", "finishWorkout", "getActiveForMode", "getModeExercises",
    "pauseWorkout", "readJSON", "renderWorkout", "resumeWorkout",
    "saveExercises", "saveHistory", "selectWorkoutMode", "setWorkoutNotice",
    "startWorkout", "updateWorkoutTimers", "validExercisesData"
  ];
  // Nomes reutilizados por funções novas e locais a um módulo (IIFE).
  // Não podem ser globais nem handlers inline.
  const reusedFunctions = ["deleteExercise", "renderExercises", "renderHistory"];

  removedFunctions.forEach(name => {
    const calls = new RegExp("\\b" + name + "\\s*\\(").test(source);
    assert.equal(calls, false, "Função removida ainda referenciada: " + name);
  });

  const pagesHtml = Object.values(PAGE).map(page =>
    fs.readFileSync(path.join(repoRoot, page), "utf8")).join("\n");
  reusedFunctions.forEach(name => {
    const defined = new RegExp("^  (async )?function " + name + "\\(", "m");
    const jsFiles = fs.readdirSync(path.join(repoRoot, "assets", "js"))
      .map(f => fs.readFileSync(path.join(repoRoot, "assets", "js", f), "utf8"));
    assert.ok(jsFiles.some(code => defined.test(code)), name + " deve ser função local de módulo");
    assert.equal(
      new RegExp("(window|F|w)\\." + name + "\\s*=").test(source), false,
      name + " não pode ser exposta como global"
    );
  });

  // Nenhum handler inline antigo (onclick="...") com estes nomes em qualquer página.
  [...removedFunctions, ...reusedFunctions].forEach(name => {
    assert.equal(
      new RegExp("on\\w+\\s*=\\s*[\"'][^\"']*\\b" + name + "\\s*\\(").test(pagesHtml), false,
      "Handler inline antigo ainda presente no HTML: " + name
    );
  });

  [
    "workout-content", "session-timer", "session-caption", "start-workout",
    "pause-workout", "resume-workout", "finish-workout", "exercise-list",
    "workout-notice", "choose-calisthenics", "choose-weight"
  ].forEach(id => {
    assert.equal(source.includes('"' + id + '"'), false, "ID removido ainda referenciado: " + id);
  });

  // Ligação única dos controles do calendário/missões (código verbatim em forja-calendario.js).
  const calendar = fs.readFileSync(path.join(repoRoot, "assets", "js", "forja-calendario.js"), "utf8");
  ["task-form", "prev-month", "next-month"].forEach(id => {
    const count = (calendar.match(new RegExp('getElementById\\("' + id + '"\\)\\.addEventListener\\(', "g")) || []).length;
    assert.equal(count, 1, "Listener duplicado ou ausente em #" + id);
  });

  // Um único ciclo de atualização e um único boot por página.
  const jsDir = path.join(repoRoot, "assets", "js");
  const intervals = fs.readdirSync(jsDir).reduce((total, file) => {
    const code = fs.readFileSync(path.join(jsDir, file), "utf8");
    return total + (code.match(/setInterval\(\s*(F\.)?workoutTick/g) || []).length;
  }, 0);
  assert.equal(intervals, 1, "Deve existir exatamente um setInterval do cronômetro");

  // Ponto de boot único em forja-app.js (equivalente ao bootWorkoutModule antigo).
  const appJs = fs.readFileSync(path.join(jsDir, "forja-app.js"), "utf8");
  assert.equal((appJs.match(/function\s+boot\s*\(/g) || []).length, 1, "boot() deve ser definido uma vez");
  assert.equal((appJs.match(/^\s*boot\(\);/gm) || []).length, 1, "boot() deve ser chamado uma vez");

  for (const page of Object.values(PAGE)) {
    const html = fs.readFileSync(path.join(repoRoot, page), "utf8");
    const boots = (html.match(/<script[^>]+src="[^"]*forja-app\.js"/g) || []).length;
    assert.equal(boots, 1, "Página " + page + " deve carregar o boot exatamente uma vez");
  }

  // O bloco de calendário/missões é idêntico ao extraído da main (SHA-256 verificado).
  assert.equal(
    createHash("sha256").update(calendar.trim()).digest("hex"),
    "30a825330793e156adc357ae714f022c853033c1016ee66ffeaec1ab705928c5",
    "O código de calendário/missões mudou em relação à main"
  );

  const indexApp = await boot({}, PAGE.index);
  assertNoErrors(indexApp, "integridade estrutural");
  indexApp.close();
});

await runTest("12c. Regras móveis de calendário/missões seguem presentes em ≤380px", async () => {
  const css = appCss();

  // Todos os blocos de 380px são lidos; o efeito combinado é o que importa.
  const blocks = [];
  let searchFrom = 0;
  while (true) {
    const start = css.indexOf("@media (max-width: 380px)", searchFrom);
    if (start < 0) break;
    const open = css.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (let index = open; index < css.length; index++) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) { end = index; break; }
      }
    }
    assert.ok(end > open, "Bloco de 380px não fechado");
    blocks.push(css.slice(open + 1, end));
    searchFrom = end + 1;
  }

  assert.ok(blocks.length >= 1, "Media query de 380px ausente");
  const mobile = blocks.join("\n");

  assert.match(mobile, /\.calendar-panel,\s*\.missions-panel,\s*\.workout-panel\s*\{\s*padding:\s*12px;/);
  assert.match(mobile, /\.calendar-grid\s*\{\s*gap:\s*3px;\s*\}/);
  assert.match(mobile, /\.day\s*\{\s*font-size:\s*12px;\s*\}/);
  assert.match(mobile, /\.task-form\s*\{\s*flex-wrap:\s*wrap;\s*\}/);
  assert.match(mobile, /\.task-form input\s*\{\s*flex:\s*1 1 100%;\s*\}/);
  assert.match(mobile, /\.task-form \.add-button\s*\{[^}]*width:\s*100%/);
  assert.match(mobile, /\.history-summary\s*\{\s*gap:\s*5px;\s*\}/);

  // Cada arquivo de CSS precisa ter chaves balanceadas (o bloco não fechado
  // em base.css foi o defeito detectado por esta verificação).
  const dir = path.join(repoRoot, "assets", "css");
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".css"))) {
    const code = fs.readFileSync(path.join(dir, file), "utf8");
    assert.equal(
      (code.match(/\{/g) || []).length,
      (code.match(/\}/g) || []).length,
      "Chaves desbalanceadas em " + file
    );
  }

  const cssApp = await boot({}, PAGE.index);
  assertNoErrors(cssApp, "css mobile");
  cssApp.close();
});

/* ------------------------------------------------------------------ */
/* 13. Backup: round-trip, rollback e falhas                           */
/* ------------------------------------------------------------------ */

await runTest("13a. Exportar/importar/desfazer preserva todas as chaves exatamente", async () => {
  const today = todayKey();
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Treino A", [
      { id: "ex1", name: "Flexão", sets: 2, reps: "10", rest: 30 }
    ])],
    weights: []
  };
  const activeSession = {
    version: 2,
    id: "session-roundtrip",
    date: today,
    modality: "calisthenics",
    routineId: routines.calisthenics[0].id,
    routineName: "Treino A",
    startedAt: Date.now() - 30000,
    elapsedMs: 0,
    running: true,
    currentIndex: 0,
    completedSets: { ex1: 1 },
    totalPlannedSets: 2,
    queue: routines.calisthenics[0].sections.main,
    status: "active",
    restEndAt: null,
    restRemainingMs: 0,
    restPaused: false,
    pendingAdvance: false,
    restPlannedSeconds: 0
  };

  const seed = {
    ["forja-missoes-" + today]: [{ id: "m1", text: "Missão do round-trip", done: false }],
    "forja-treino-exercicios-v1": {
      calisthenics: [{ id: "legacy1", name: "Legado", sets: 2, reps: "10", rest: 30 }],
      weights: []
    },
    "forja-treino-rotinas-v1": routines,
    "forja-treino-historico-v1": [{
      id: "h1", date: today, modality: "calisthenics", routineName: "Treino A",
      durationMs: 120000, completedSets: 2, status: "completed",
      exercises: [{ id: "ex1", name: "Flexão", plannedSets: 2, completedSets: 2 }]
    }],
    "forja-treino-sessao-ativa-v1": activeSession,
    "forja-treino-migracao-v1": { version: 2, updatedAt: new Date().toISOString(), source: "teste" },
    "forja-treino-sessao-ativa-legada-v1": {
      archivedAt: new Date().toISOString(),
      session: { id: "antiga", modality: "weights", completedSets: {} }
    },
    "forja-treino-dados-preservados-v1": [{
      archivedAt: new Date().toISOString(),
      key: "forja-treino-historico-v1",
      reason: "teste",
      raw: "conteudo preservado"
    }]
  };

  const app = await boot(seed, PAGE.config);
  const original = parsedStorage(app);

  const backup = app.F.buildBackupObject();
  assert.ok(backup.keys["forja-treino-exercicios-v1"]);
  assert.ok(backup.keys["forja-treino-sessao-ativa-legada-v1"]);
  assert.ok(backup.keys["forja-treino-dados-preservados-v1"]);
  assert.ok(backup.keys["forja-treino-migracao-v1"]);
  assert.equal(backup.keys["forja-backup-seguranca-v1"], undefined);

  // Altera o estado atual antes de restaurar.
  app.set("forja-missoes-" + today, []);
  app.set("forja-treino-rotinas-v1", { calisthenics: [], weights: [] });
  app.w.localStorage.removeItem("forja-treino-sessao-ativa-legada-v1");
  app.w.localStorage.removeItem("forja-treino-dados-preservados-v1");
  const mutated = parsedStorage(app);

  await app.importFile(backup);
  app.modalAction("restore");
  await wait(220);

  assert.deepEqual(parsedStorage(app), original, "Restauração deve reproduzir todas as chaves");

  // Desfazer volta exatamente ao estado imediatamente anterior à importação.
  app.click("#restore-safety-backup");
  await wait(40);
  assert.match(app.text("#modal-title"), /Desfazer última importação/);
  app.modalAction("restore");
  await wait(220);

  assert.deepEqual(parsedStorage(app), mutated, "Desfazer deve restaurar o estado anterior");

  // A cópia de segurança não entra em um novo backup.
  const secondBackup = app.F.buildBackupObject();
  assert.equal(secondBackup.keys["forja-backup-seguranca-v1"], undefined);

  assertNoErrors(app, "round-trip de backup");
});

await runTest("13b. Falha de gravação na importação restaura os dados e informa a chave", async () => {
  const today = todayKey();
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Treino A", [
      { id: "ex1", name: "Flexão", sets: 2, reps: "10", rest: 0 }
    ])],
    weights: []
  };

  const app = await boot({
    ["forja-missoes-" + today]: [{ id: "m1", text: "Original", done: false }],
    "forja-treino-rotinas-v1": routines,
    "forja-treino-historico-v1": [{
      id: "h1", date: today, modality: "calisthenics", durationMs: 1000,
      completedSets: 1, exercises: []
    }]
  }, PAGE.config);

  const original = parsedStorage(app);
  const backup = app.F.buildBackupObject();
  backup.keys["forja-missoes-" + today] = [{ id: "novo", text: "Importada", done: false }];
  backup.keys["forja-treino-historico-v1"] = [];

  const guard = installFailingStorage(app, { failOn: "forja-treino-rotinas-v1", times: 1 });

  await app.importFile(backup);
  app.modalAction("restore");
  await wait(180);
  guard.restore();

  assert.match(app.text("#modal-title"), /Falha ao restaurar/);
  assert.match(app.text(".modal-message"), /recuperados integralmente/);
  assert.match(app.text(".modal-message"), /forja-treino-rotinas-v1/, "A mensagem deve identificar a chave que falhou");
  assert.deepEqual(parsedStorage(app), original, "Rollback deve restaurar todas as chaves originais");
  assert.ok(app.raw("forja-backup-seguranca-v1"), "Cópia de segurança deve permanecer");

  assertNoErrors(app, "rollback integral");
});

await runTest("13c. Falha também no rollback é reportada sem esconder as chaves afetadas", async () => {
  const today = todayKey();
  const app = await boot({
    ["forja-missoes-" + today]: [{ id: "m1", text: "Original", done: false }],
    "forja-treino-historico-v1": [{
      id: "h1", date: today, modality: "calisthenics", durationMs: 1000,
      completedSets: 1, exercises: []
    }],
    "forja-treino-rotinas-v1": {
      calisthenics: [makeRoutine("calisthenics", "A", [
        { id: "ex1", name: "Flexão", sets: 1, reps: "10", rest: 0 }
      ])],
      weights: []
    }
  }, PAGE.config);

  const original = parsedStorage(app);
  const backup = app.F.buildBackupObject();
  backup.keys["forja-missoes-" + today] = [{ id: "novo", text: "Importada", done: false }];

  // Falha na gravação e novamente no rollback da mesma chave.
  const guard = installFailingStorage(app, { failOn: "forja-treino-rotinas-v1", times: 2 });

  await app.importFile(backup);
  app.modalAction("restore");
  await wait(200);
  guard.restore();

  assert.match(app.text("#modal-title"), /Falha ao restaurar/);
  assert.match(app.text(".modal-message"), /forja-treino-rotinas-v1/);
  assert.match(app.text(".modal-message"), /forja-backup-seguranca-v1/);

  // As demais chaves voltam ao conteúdo original.
  assert.equal(app.raw("forja-missoes-" + today), JSON.stringify(original["forja-missoes-" + today]));
  assert.equal(app.raw("forja-treino-historico-v1"), JSON.stringify(original["forja-treino-historico-v1"]));

  // A cópia de segurança contém o estado anterior completo.
  const safety = app.data("forja-backup-seguranca-v1");
  assert.deepEqual(safety.keys, original);

  assertNoErrors(app, "falha no rollback");
});

await runTest("13d. Falha ao criar a cópia de segurança aborta sem alterar dados", async () => {
  const today = todayKey();
  const app = await boot({
    ["forja-missoes-" + today]: [{ id: "m1", text: "Original", done: false }],
    "forja-treino-historico-v1": []
  }, PAGE.config);

  const original = parsedStorage(app);
  const backup = app.F.buildBackupObject();
  backup.keys["forja-missoes-" + today] = [{ id: "novo", text: "Importada", done: false }];

  const guard = installFailingStorage(app, { failOn: "forja-backup-seguranca-v1", times: 1 });

  await app.importFile(backup);
  app.modalAction("restore");
  await wait(180);
  guard.restore();

  assert.deepEqual(parsedStorage(app), original);
  assert.equal(app.raw("forja-backup-seguranca-v1"), null);
  assert.match(app.text("#toast"), /Não foi possível salvar/);

  assertNoErrors(app, "falha na cópia de segurança");
});

await runTest("13e. Exportar sem dados orienta o usuário e não gera arquivo vazio", async () => {
  const app = await boot({}, PAGE.config);

  assert.deepEqual(app.keys(), [], "Boot vazio não deve gravar chaves de treino");

  app.click("#export-backup");
  await wait(30);

  assert.equal(app.downloads.length, 0);
  assert.match(app.text("#toast"), /Ainda não há dados do FORJA para exportar/);

  assertNoErrors(app, "exportação vazia");
});

/* ------------------------------------------------------------------ */
/* 14. Avanço pendente após pausa e recarga                            */
/* ------------------------------------------------------------------ */

function pendingRoutine() {
  return {
    calisthenics: [makeRoutine("calisthenics", "Treino pendente", [
      { id: "p1", name: "Exercício 1", sets: 2, reps: "10", rest: 1 },
      { id: "p2", name: "Exercício 2", sets: 1, reps: "10", rest: 0 }
    ])],
    weights: []
  };
}

await runTest("14a. Pausar a sessão durante o descanso pendente e recarregar mantém o avanço", async () => {
  const app = await boot({ "forja-treino-rotinas-v1": pendingRoutine() }, PAGE.calistenia);
  await startRoutine(app);

  await completeSet(app);
  app.click("#skip-rest");
  await wait(420);
  await completeSet(app);
  assert.equal(shown(app, "#execution-rest"), true);
  assert.match(app.text("#rest-caption"), /avança para Exercício 2/);

  app.click("#pause-session");
  await wait(30);

  const raw = parsedStorage(app);
  app.close();

  const second = await boot(raw, PAGE.executar);
  assert.equal(shown(second, "#execution-live"), true);
  assert.equal(second.text("#current-position"), "Exercício 1 de 2");

  const stored = second.data("forja-treino-sessao-ativa-v1");
  assert.equal(stored.pendingAdvance, true);
  assert.equal(stored.restPaused, true);
  assert.equal(stored.running, false);

  second.click("#resume-session");
  const advanced = await waitFor(() => second.text("#current-position") === "Exercício 2 de 2", { timeout: 5000 });

  assert.equal(advanced, true, "O avanço pendente deve continuar após recarregar");
  assert.equal(second.text("#current-name"), "Exercício 2");

  assertNoErrors(second, "avanço pendente pausado");
});

await runTest("14b. Pausar apenas o descanso pendente e recarregar mantém o avanço", async () => {
  const app = await boot({ "forja-treino-rotinas-v1": pendingRoutine() }, PAGE.calistenia);
  await startRoutine(app);

  await completeSet(app);
  app.click("#skip-rest");
  await wait(420);
  await completeSet(app);
  app.click("#pause-rest");
  await wait(30);

  const raw = parsedStorage(app);
  app.close();

  const second = await boot(raw, PAGE.executar);
  const stored = second.data("forja-treino-sessao-ativa-v1");
  assert.equal(stored.pendingAdvance, true);
  assert.equal(stored.restPaused, true);

  second.click("#resume-rest");
  const advanced = await waitFor(() => second.text("#current-position") === "Exercício 2 de 2", { timeout: 5000 });

  assert.equal(advanced, true, "O avanço deve ocorrer após o descanso retomado");
  assertNoErrors(second, "descanso pendente pausado");
});

await runTest("14c. Estado inconsistente não pula séries pendentes", async () => {
  const routines = pendingRoutine();
  const queue = routines.calisthenics[0].sections.main;
  const session = {
    version: 2,
    id: "sessao-inconsistente",
    date: todayKey(),
    modality: "calisthenics",
    routineId: routines.calisthenics[0].id,
    routineName: "Treino pendente",
    startedAt: Date.now() - 5000,
    elapsedMs: 0,
    running: false,
    currentIndex: 0,
    completedSets: { p1: 0, p2: 0 },
    totalPlannedSets: 3,
    queue,
    status: "active",
    restEndAt: null,
    restRemainingMs: 700,
    restPaused: true,
    pendingAdvance: true,
    restPlannedSeconds: 1
  };

  const app = await boot({
    "forja-treino-rotinas-v1": routines,
    "forja-treino-sessao-ativa-v1": session
  }, PAGE.executar);

  // O estado inconsistente é aceito na tela, mas o avanço pendente é descartado em memória.
  assert.equal(app.F.state.activeWorkout.pendingAdvance, false);
  app.click("#resume-session");
  await wait(1200);

  assert.equal(app.text("#current-position"), "Exercício 1 de 2");
  assert.match(app.text("#complete-set"), /Concluir série 1 de 2/);
  assert.equal(app.$("#complete-set").disabled, false);

  assertNoErrors(app, "estado inconsistente");
});

await runTest("14d. Descanso pendente no último exercício conclui a sessão uma única vez", async () => {
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Único", [
      { id: "u1", name: "Único exercício", sets: 1, reps: "10", rest: 1 }
    ])],
    weights: []
  };
  const queue = routines.calisthenics[0].sections.main;
  const session = {
    version: 2,
    id: "sessao-ultimo-pendente",
    date: todayKey(),
    modality: "calisthenics",
    routineId: routines.calisthenics[0].id,
    routineName: "Único",
    startedAt: Date.now() - 5000,
    elapsedMs: 0,
    running: false,
    currentIndex: 0,
    completedSets: { u1: 1 },
    totalPlannedSets: 1,
    queue,
    status: "active",
    restEndAt: null,
    restRemainingMs: 700,
    restPaused: true,
    pendingAdvance: true,
    restPlannedSeconds: 1
  };

  const raw = {
    "forja-treino-rotinas-v1": JSON.stringify(routines),
    "forja-treino-sessao-ativa-v1": JSON.stringify(session)
  };

  const second = await boot(raw, PAGE.executar);
  assert.equal(shown(second, "#execution-summary"), false);
  assert.equal(shown(second, "#execution-rest"), true);
  assert.equal(second.F.state.activeWorkout.pendingAdvance, true);

  second.click("#resume-session");
  const finished = await waitFor(() => shown(second, "#execution-summary"), { timeout: 5000 });

  assert.equal(finished, true, "O resumo deve aparecer após o descanso pendente");
  assert.equal(second.text("#summary-title"), "Treino concluído");
  assert.equal(second.text("#summary-sets").replace(/\s+/g, ""), "1/1");

  const history = second.data("forja-treino-historico-v1");
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "completed");
  assert.equal(second.raw("forja-treino-sessao-ativa-v1"), null);

  assertNoErrors(second, "pendente no último exercício");
});

/* ------------------------------------------------------------------ */
/* 15. Idempotência e preservação na migração                          */
/* ------------------------------------------------------------------ */

await runTest("15a. Carregar só com missões não grava nenhuma chave de treino", async () => {
  const today = todayKey();
  const seed = {
    ["forja-missoes-" + today]: [{ id: "m1", text: "Só missão", done: false }]
  };
  const expected = {
    ["forja-missoes-" + today]: JSON.stringify(seed["forja-missoes-" + today])
  };

  const app = await boot(seed, PAGE.index);

  assert.deepEqual(app.keys(), Object.keys(expected).sort());
  assert.equal(app.raw("forja-treino-rotinas-v1"), null);
  assert.equal(app.raw("forja-treino-migracao-v1"), null);
  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null);
  assert.equal(app.text(".task-text"), "Só missão");

  assertNoErrors(app, "boot só com missões");
});

await runTest("15b. Migração é idempotente em três carregamentos consecutivos", async () => {
  const legacyExercises = {
    calisthenics: [{ id: "c1", name: "Flexão", sets: 3, reps: "12", rest: 60 }],
    weights: [{ id: "w1", name: "Supino", sets: 4, reps: "8", rest: 120, load: "40 kg" }]
  };
  const legacyHistory = [{
    id: "h1", date: "2026-10-01", modality: "calisthenics",
    durationMs: 60000, completedSets: 3, exercises: []
  }];

  const snapshots = [];
  let raw = {
    "forja-treino-exercicios-v1": JSON.stringify(legacyExercises),
    "forja-treino-historico-v1": JSON.stringify(legacyHistory)
  };
  const legacyRaw = raw["forja-treino-exercicios-v1"];

  for (let bootIndex = 0; bootIndex < 3; bootIndex++) {
    const app = await boot(raw, PAGE.index);
    const snap = parsedStorage(app);
    snapshots.push(snap);
    assert.equal(app.raw("forja-treino-exercicios-v1"), legacyRaw);
    app.close();
    raw = snap;
  }

  const routines = snapshots[0]["forja-treino-rotinas-v1"];
  assert.equal(routines.calisthenics.length, 1);
  assert.equal(routines.weights.length, 1);

  for (let index = 1; index < snapshots.length; index++) {
    assert.deepEqual(snapshots[index]["forja-treino-rotinas-v1"], routines, "Rotinas não podem mudar entre carregamentos");
    assert.deepEqual(snapshots[index]["forja-treino-historico-v1"], legacyHistory);
    assert.equal(snapshots[index]["forja-treino-migracao-v1"].routinesCreated.length, 2);
  }
});

await runTest("15c. Sessão antiga com progresso extra migra e preserva o original", async () => {
  const legacyExercises = {
    calisthenics: [
      { id: "c1", name: "Flexão", sets: 3, reps: "12", rest: 0 },
      { id: "c2", name: "Barra", sets: 2, reps: "5", rest: 0 }
    ],
    weights: []
  };

  const legacySession = {
    id: "legado-extra",
    date: todayKey(),
    modality: "calisthenics",
    startedAt: Date.now() - 45000,
    elapsedMs: 0,
    running: true,
    completedSets: { c1: 1, c2: 0, fantasma: 7 },
    restEndAt: null,
    restRemainingMs: 0,
    restPaused: false
  };

  const app = await boot({
    "forja-treino-exercicios-v1": legacyExercises,
    "forja-treino-sessao-ativa-v1": legacySession
  }, PAGE.executar);

  const active = app.data("forja-treino-sessao-ativa-v1");
  assert.equal(active.version, 2);
  assert.deepEqual(active.queue.map(item => item.id), ["c1", "c2"]);
  assert.deepEqual(active.completedSets, { c1: 1, c2: 0 });

  const archived = app.data("forja-treino-sessao-ativa-legada-v1");
  assert.equal(archived.session.id, "legado-extra");
  assert.equal(archived.session.completedSets.fantasma, 7);

  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.text("#current-sets-value").replace(/\s+/g, " "), "1 / 3");

  assertNoErrors(app, "sessão antiga com progresso extra");
});

await runTest("15d. Rotinas existentes impedem migração duplicada do legado", async () => {
  const existing = {
    calisthenics: [makeRoutine("calisthenics", "Minha rotina", [
      { id: "existente", name: "Exercício atual", sets: 1, reps: "10", rest: 0 }
    ])],
    weights: []
  };
  const legacyExercises = {
    calisthenics: [{ id: "c1", name: "Exercício antigo", sets: 2, reps: "8", rest: 30 }],
    weights: []
  };

  const app = await boot({
    "forja-treino-rotinas-v1": existing,
    "forja-treino-exercicios-v1": legacyExercises
  }, PAGE.calistenia);

  assert.equal(app.$$(".routine-card").length, 1);
  assert.equal(app.text(".routine-name"), "Minha rotina");
  assert.equal(app.raw("forja-treino-migracao-v1"), null);
  assert.equal(app.raw("forja-treino-exercicios-v1"), JSON.stringify(legacyExercises));

  assertNoErrors(app, "rotinas existentes");
});






const failed = results.filter(r => !r.ok);
console.log("\n" + "=".repeat(60));
console.log("PARIDADE — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
if (failed.length) console.log("Falhas: " + failed.map(f => f.name).join(" | "));
console.log("=".repeat(60));
process.exitCode = failed.length ? 1 : 0;
