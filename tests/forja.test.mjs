/*
  Suíte de testes do FORJA (jsdom).
  Executa o index.html real, com o mesmo JavaScript que roda no navegador.

  Uso: npm install && npm test
*/

import { JSDOM, VirtualConsole } from "jsdom";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const results = [];
let currentErrors = [];
const openApps = new Set();

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function assertNoErrors(label = "") {
  const relevant = currentErrors.filter(error => {
    return !/Could not parse CSS stylesheet/i.test(error);
  });

  assert.deepEqual(
    relevant,
    [],
    "Erros de console encontrados" + (label ? " (" + label + ")" : "") +
    ": " + relevant.join(" | ")
  );
}

class App {
  constructor(dom, errors) {
    this.dom = dom;
    this.w = dom.window;
    this.d = dom.window.document;
    this.errors = errors;
    this.downloads = [];
  }

  $(selector) {
    return this.d.querySelector(selector);
  }

  $$(selector) {
    return Array.from(this.d.querySelectorAll(selector));
  }

  text(selector) {
    const element = this.$(selector);
    return element ? element.textContent.trim() : null;
  }

  click(target) {
    const element = typeof target === "string" ? this.$(target) : target;
    assert.ok(element, "Elemento para clique não encontrado: " + target);
    element.dispatchEvent(new this.w.MouseEvent("click", {
      bubbles: true,
      cancelable: true
    }));
  }

  raw(key) {
    return this.w.localStorage.getItem(key);
  }

  data(key, fallback = null) {
    const raw = this.raw(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  }

  keys() {
    const list = [];
    for (let index = 0; index < this.w.localStorage.length; index++) {
      list.push(this.w.localStorage.key(index));
    }
    return list.sort();
  }

  set(key, value) {
    this.w.localStorage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value)
    );
  }

  modalAction(id) {
    this.click('[data-modal-action="' + id + '"]');
  }

  modalField(id) {
    return this.$('[data-modal-field="' + id + '"]');
  }

  async openModalThen(action, callback) {
    callback();
    await wait(15);
    assert.ok(this.$(".modal-backdrop"), "Modal não abriu");
    this.modalAction(action);
    await wait(25);
  }

  async chooseMode(mode) {
    this.click("#mode-" + mode);
    await wait(20);
  }

  async createRoutine(name) {
    this.click("#new-routine");
    await wait(20);
    const input = this.modalField("name");
    assert.ok(input, "Campo de nome da rotina não apareceu");
    input.value = name;
    this.modalAction("create");
    await wait(30);
  }

  async addExercise(options = {}) {
    const {
      section = "main",
      name,
      sets = 3,
      type = "reps",
      reps = "10",
      duration = 45,
      rest = 0,
      load = "",
      notes = ""
    } = options;

    this.$("#exercise-section").value = section;
    this.$("#exercise-name").value = name;
    this.$("#exercise-sets").value = String(sets);

    if (type === "duration") {
      this.click("#exercise-type-duration");
      this.$("#exercise-duration").value = String(duration);
    } else {
      this.click("#exercise-type-reps");
      this.$("#exercise-reps").value = reps;
    }

    this.$("#exercise-rest").value = String(rest);
    this.$("#exercise-load").value = load;
    this.$("#exercise-notes").value = notes;

    this.$("#exercise-form").dispatchEvent(new this.w.Event("submit", {
      bubbles: true,
      cancelable: true
    }));
    await wait(20);
  }

  async saveRoutine() {
    this.click("#save-routine-top");
    await wait(25);
  }

  async backToRoutines() {
    this.click("#back-from-editor");
    await wait(25);
  }

  async openRoutine(name) {
    const card = this.$$(".routine-card").find(item => {
      return item.querySelector(".routine-name").textContent === name;
    });
    assert.ok(card, "Rotina não encontrada: " + name);
    this.click(card.querySelector('button[aria-label^="Abrir"]'));
    await wait(25);
  }

  routineCard(name) {
    return this.$$(".routine-card").find(item => {
      return item.querySelector(".routine-name").textContent === name;
    });
  }

  async startRoutine(name) {
    const card = name ? this.routineCard(name) : this.$(".routine-card");
    assert.ok(card, "Rotina para iniciar não encontrada");
    this.click(card.querySelector('[data-action="start"]'));
    await wait(30);
  }

  async completeSet() {
    this.click("#complete-set");
    await wait(20);
  }

  async endSession(action) {
    this.click("#end-session");
    await wait(20);
    this.modalAction(action);
    await wait(35);
  }

  async importFile(content, filename = "backup.json") {
    const file = new this.w.File(
      [typeof content === "string" ? content : JSON.stringify(content)],
      filename,
      { type: "application/json" }
    );
    const input = this.$("#import-backup-input");
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true
    });
    input.dispatchEvent(new this.w.Event("change", { bubbles: true }));
    await wait(120);
  }

  close() {
    openApps.delete(this);
    this.dom.window.close();
  }
}

async function boot(seed = {}) {
  const errors = [];
  currentErrors = errors;

  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push("jsdomError: " + error.message));
  virtualConsole.on("error", (...args) => errors.push("console.error: " + args.join(" ")));
  virtualConsole.on("warn", (...args) => {
    const message = args.join(" ");
    if (!/Could not parse CSS stylesheet/i.test(message)) {
      errors.push("console.warn: " + message);
    }
  });

  const dom = new JSDOM(html, {
    url: "https://forja.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.alert = (...args) => errors.push("alert: " + args.join(" "));

      window.AudioContext = class {
        constructor() {
          this.currentTime = 0;
          this.destination = {};
        }
        createOscillator() {
          return {
            type: "sine",
            frequency: { value: 0 },
            connect() {},
            start() {},
            stop() {},
            onended: null
          };
        }
        createGain() {
          return { connect() {}, gain: { value: 0 } };
        }
        close() {
          return Promise.resolve();
        }
      };

      for (const [key, value] of Object.entries(seed)) {
        window.localStorage.setItem(
          key,
          typeof value === "string" ? value : JSON.stringify(value)
        );
      }
    }
  });

  const app = new App(dom, errors);

  const createObjectURL = () => "blob:forja-test";
  const revokeObjectURL = () => {};
  app.w.URL.createObjectURL = createObjectURL;
  app.w.URL.revokeObjectURL = revokeObjectURL;
  app.w.HTMLAnchorElement.prototype.click = function captureDownload() {
    app.downloads.push({
      href: this.getAttribute("href"),
      download: this.getAttribute("download")
    });
  };

  await wait(90);
  openApps.add(app);
  return app;
}

function closeAllApps() {
  for (const app of Array.from(openApps)) {
    app.close();
  }
}

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + month + "-" + day;
}

function makeRoutine(modality, name, exercises) {
  const sections = { warmup: [], main: [], abs: [], finisher: [] };

  exercises.forEach((exercise, index) => {
    sections[exercise.section || "main"].push({
      id: exercise.id || modality + "-ex-" + index,
      name: exercise.name,
      sets: exercise.sets || 3,
      type: exercise.type || "reps",
      reps: exercise.reps || "10",
      duration: exercise.duration || 45,
      rest: exercise.rest === undefined ? 0 : exercise.rest,
      load: exercise.load || "",
      notes: exercise.notes || "",
      section: exercise.section || "main"
    });
  });

  return {
    id: modality + "-routine-" + name.replace(/\s+/g, "-").toLowerCase(),
    name,
    modality,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sections
  };
}

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

function parsedStorage(app, options = {}) {
  const includeSafety = options.includeSafety === true;
  const snapshot = {};

  app.keys().forEach(key => {
    if (!includeSafety && key === "forja-backup-seguranca-v1") return;
    snapshot[key] = app.data(key);
  });

  return snapshot;
}

function installFailingStorage(app, options) {
  const real = app.w.localStorage;
  const state = {
    failOn: options.failOn,
    times: options.times === undefined ? 1 : options.times,
    hits: 0
  };

  const fake = {
    get length() {
      return real.length;
    },
    key(index) {
      return real.key(index);
    },
    getItem(key) {
      return real.getItem(key);
    },
    setItem(key, value) {
      if (key === state.failOn && state.hits < state.times) {
        state.hits += 1;
        const error = new Error("QuotaExceededError simulado");
        error.name = "QuotaExceededError";
        throw error;
      }
      real.setItem(key, value);
    },
    removeItem(key) {
      return real.removeItem(key);
    },
    clear() {
      return real.clear();
    }
  };

  Object.defineProperty(app.w, "localStorage", {
    value: fake,
    configurable: true
  });

  return {
    state,
    real,
    restore() {
      Object.defineProperty(app.w, "localStorage", {
        value: real,
        configurable: true
      });
    }
  };
}

function formatSelected(w, year, month, day) {
  return w.eval(
    "formatDate(new Date(" + year + ", " + month + ", " + day + "), " +
    "{ weekday: \"long\", day: \"numeric\", month: \"long\", year: \"numeric\" })"
  );
}

async function waitFor(predicate, options = {}) {
  const timeout = options.timeout || 4000;
  const interval = 25;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    if (predicate()) return true;
    await wait(interval);
  }

  return false;
}


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
    exercises: [{
      id: "w1", name: "Supino reto", plannedSets: 4,
      reps: "10", load: "40 kg", completedSets: 4
    }]
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

  const app = await boot(seed);

  // A chave antiga permanece byte a byte.
  assert.equal(app.raw("forja-treino-exercicios-v1"), JSON.stringify(legacyExercises));

  // Rotinas padrão por modalidade, com ids e cargas preservados.
  const routines = app.data("forja-treino-rotinas-v1");
  assert.equal(routines.calisthenics.length, 1);
  assert.equal(routines.weights.length, 1);
  assert.equal(routines.calisthenics[0].name, "Rotina padrão");
  assert.deepEqual(
    routines.calisthenics[0].sections.main.map(item => item.id),
    ["c1", "c2"]
  );
  assert.equal(routines.weights[0].sections.main[0].load, "40 kg");
  assert.equal(routines.calisthenics[0].sections.warmup.length, 0);
  assert.equal(routines.calisthenics[0].sections.abs.length, 0);
  assert.equal(routines.calisthenics[0].sections.finisher.length, 0);

  // Histórico antigo intacto e visível na modalidade correta.
  assert.equal(app.raw("forja-treino-historico-v1"), JSON.stringify(legacyHistory));
  await app.chooseMode("weights");
  assert.equal(app.text("#history-total"), "1");

  // Sessão ativa migrada para o novo formato com snapshot.
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
  assert.equal(app.$("#execution-screen").hidden, false);
  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.text("#current-sets-value").replace(/\s+/g, " "), "1 / 3");

  // Missões do dia continuam funcionando.
  assert.equal(app.text(".task-text"), "Ler 20 páginas");

  assertNoErrors("migração");
  app.close();
});

await runTest("1b. Migração não destrói JSON corrompido", async () => {
  const app = await boot({
    "forja-treino-exercicios-v1": { calisthenics: "quebrado", weights: null },
    "forja-treino-historico-v1": "{isso não é json",
    "forja-treino-sessao-ativa-v1": "também quebrado",
    ["forja-missoes-" + todayKey()]: [{ id: "m", text: "Missão íntegra", done: false }]
  });

  // Histórico ilegível permanece no armazenamento (não é apagado em silêncio).
  assert.equal(app.raw("forja-treino-historico-v1"), "{isso não é json");

  // A sessão ativa ilegível sai da chave de execução, mas o conteúdo
  // original fica arquivado para inspeção/recuperação.
  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null);

  const preserved = app.data("forja-treino-dados-preservados-v1");
  assert.ok(preserved, "Dados ilegíveis devem ser preservados");
  assert.equal(preserved.length >= 2, true);
  const archivedActive = preserved.find(item => {
    return item.key === "forja-treino-sessao-ativa-v1";
  });
  assert.ok(archivedActive, "Sessão ativa ilegível deve ser arquivada");
  assert.equal(archivedActive.raw, "também quebrado");
  assert.equal(app.text(".task-text"), "Missão íntegra");
  assert.equal(app.$("#execution-screen").hidden, true);
  assert.match(app.text("#toast"), /preservad/i);

  assertNoErrors("corrompido");
  app.close();
});

await runTest("1c. Rotinas ausentes são reconstruídas a partir do legado", async () => {
  const app = await boot({
    "forja-treino-exercicios-v1": {
      calisthenics: [{ name: "Flexão", sets: 2, reps: "8", rest: 30 }],
      weights: []
    }
  });

  const routines = app.data("forja-treino-rotinas-v1");
  assert.equal(routines.calisthenics[0].sections.main.length, 1);
  assert.equal(routines.weights.length, 0);
  assert.match(app.text("#toast"), /migrad/i);

  assertNoErrors("rotinas legadas");
  app.close();
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

  const app = await boot({
    ["forja-missoes-" + today]: missionsToday,
    ["forja-missoes-" + yesterday]: missionsLegacy,
    "forja-treino-exercicios-v1": legacyExercises,
    "forja-treino-historico-v1": legacyHistory,
    "forja-treino-sessao-ativa-v1": legacyActive,
    [foreignForjaKey]: foreignValue,
    [unrelatedKey]: unrelatedValue
  });

  const untouchedKeys = [
    "forja-missoes-" + today,
    "forja-missoes-" + yesterday,
    "forja-treino-exercicios-v1",
    "forja-treino-historico-v1",
    foreignForjaKey,
    unrelatedKey
  ];

  const rawSnapshot = () => Object.fromEntries(
    app.keys().map(key => [key, app.raw(key)])
  );

  const afterMigration = rawSnapshot();

  untouchedKeys.forEach(key => {
    assert.equal(
      afterMigration[key],
      seedRaw(key),
      "A migração alterou " + key
    );
  });

  // A sessão ativa é o único dado que muda de formato; o original fica arquivado.
  assert.equal(
    JSON.parse(afterMigration["forja-treino-sessao-ativa-legada-v1"]).session.id,
    "legacy-audit"
  );
  assert.equal(
    JSON.parse(afterMigration["forja-treino-sessao-ativa-legada-v1"]).session.completedSets.w1,
    2
  );

  // Rotinas padrão criadas com ids/cargas originais.
  const routines = app.data("forja-treino-rotinas-v1");
  assert.equal(routines.calisthenics.length, 1);
  assert.equal(routines.weights.length, 1);
  assert.deepEqual(
    routines.calisthenics[0].sections.main.map(item => item.id),
    ["c1", "c2"]
  );
  assert.equal(routines.weights[0].sections.main[0].load, "50 kg");

  const migration = app.data("forja-treino-migracao-v1");
  assert.equal(migration.source, "forja-treino-exercicios-v1");
  assert.deepEqual(
    migration.routinesCreated.map(item => [item.modality, item.exercises]),
    [["calisthenics", 2], ["weights", 1]]
  );

  // Nada foi arquivado como "corrompido" em uma migração saudável.
  assert.equal(app.raw("forja-treino-dados-preservados-v1"), null);

  // Missões em formato antigo continuam legíveis através da função do app.
  const legacyTasks = app.w.readTasks(new Date(
    Number(yesterday.slice(0, 4)),
    Number(yesterday.slice(5, 7)) - 1,
    Number(yesterday.slice(8, 10))
  ));
  assert.deepEqual(
    Array.from(legacyTasks, task => String(task.text)),
    missionsLegacy
  );

  // Segundo carregamento: idempotente, sem rotinas duplicadas nem reescritas.
  const storedAfterFirstBoot = rawSnapshot();
  app.close();

  const second = await boot(storedAfterFirstBoot);
  const afterSecondBoot = Object.fromEntries(
    second.keys().map(key => [key, second.raw(key)])
  );

  assert.deepEqual(
    afterSecondBoot["forja-treino-rotinas-v1"],
    storedAfterFirstBoot["forja-treino-rotinas-v1"],
    "Rotinas não devem mudar no segundo boot"
  );
  assert.deepEqual(
    afterSecondBoot["forja-treino-historico-v1"],
    storedAfterFirstBoot["forja-treino-historico-v1"]
  );
  assert.deepEqual(
    afterSecondBoot["forja-treino-exercicios-v1"],
    storedAfterFirstBoot["forja-treino-exercicios-v1"]
  );
  assert.deepEqual(
    afterSecondBoot["forja-treino-sessao-ativa-legada-v1"],
    storedAfterFirstBoot["forja-treino-sessao-ativa-legada-v1"]
  );
  assert.equal(
    JSON.parse(afterSecondBoot["forja-treino-rotinas-v1"]).calisthenics.length,
    1
  );
  assert.equal(
    JSON.parse(afterSecondBoot["forja-treino-sessao-ativa-v1"]).version,
    2
  );

  // A sessão ativa migrada reabre; descartá-la não altera o histórico.
  assert.equal(second.$("#execution-screen").hidden, false);
  assert.equal(second.text("#current-name"), "Supino reto");
  second.click("#end-session");
  await wait(20);
  second.modalAction("discard");
  await wait(30);
  assert.equal(second.raw("forja-treino-sessao-ativa-v1"), null);
  assert.equal(
    second.data("forja-treino-historico-v1").length,
    legacyHistory.length
  );

  // Histórico visível por modalidade, com os registros antigos intactos.
  await second.chooseMode("calisthenics");
  assert.equal(second.text("#history-total"), "1");
  await second.chooseMode("weights");
  assert.equal(second.text("#history-total"), "1");

  // Adicionar missão muda somente a chave do dia atual.
  const rawBeforeMission = Object.fromEntries(
    second.keys().map(key => [key, second.raw(key)])
  );
  second.$("#task-input").value = "Nova missão de auditoria";
  second.$("#task-form").dispatchEvent(new second.w.Event("submit", {
    bubbles: true, cancelable: true
  }));
  await wait(30);

  untouchedKeys.forEach(key => {
    if (key === "forja-missoes-" + today) return;
    assert.equal(second.raw(key), rawBeforeMission[key], "Missão alterou " + key);
  });
  assert.equal(
    second.data("forja-missoes-" + today).length,
    missionsToday.length + 1
  );

  // CRUD de rotina muda somente a chave de rotinas.
  const rawBeforeRoutines = Object.fromEntries(
    second.keys().map(key => [key, second.raw(key)])
  );
  await second.chooseMode("calisthenics");
  await second.createRoutine("Rotina de auditoria");
  await second.addExercise({ name: "Agachamento livre", sets: 1, reps: "15", rest: 0 });
  await second.saveRoutine();
  await second.backToRoutines();
  await wait(20);

  untouchedKeys.forEach(key => {
    assert.equal(second.raw(key), rawBeforeRoutines[key], "Rotina alterou " + key);
  });
  assert.equal(
    second.data("forja-treino-historico-v1").length,
    legacyHistory.length
  );

  // Concluir um treino acrescenta ao histórico e preserva os registros antigos.
  await second.startRoutine("Rotina de auditoria");
  await second.completeSet();
  await wait(40);
  assert.equal(second.$("#execution-summary").hidden, false);
  assert.match(second.text("#summary-title"), /Treino concluído/);

  const historyAfterWorkout = second.data("forja-treino-historico-v1");
  assert.equal(historyAfterWorkout.length, legacyHistory.length + 1);
  assert.deepEqual(historyAfterWorkout.slice(1), legacyHistory);
  assert.deepEqual(
    second.data("forja-missoes-" + today).slice(0, missionsToday.length),
    missionsToday
  );
  assert.equal(
    second.raw("forja-treino-exercicios-v1"),
    rawBeforeMission["forja-treino-exercicios-v1"]
  );

  assertNoErrors("auditoria de preservação");
  second.close();

  function seedRaw(key) {
    const value = {
      ["forja-missoes-" + today]: missionsToday,
      ["forja-missoes-" + yesterday]: missionsLegacy,
      "forja-treino-exercicios-v1": legacyExercises,
      "forja-treino-historico-v1": legacyHistory,
      [foreignForjaKey]: foreignValue,
      [unrelatedKey]: unrelatedValue
    }[key];
    return typeof value === "string" ? value : JSON.stringify(value);
  }
});

await runTest("1e. Conteúdo parcialmente inválido é arquivado, nunca descartado", async () => {
  const validRoutine = makeRoutine("calisthenics", "Treino válido", [
    { name: "Flexão", sets: 2, reps: "10", rest: 0 }
  ]);
  const routinesRaw = {
    calisthenics: [
      validRoutine,
      { id: "sem-nome", sections: {} }
    ],
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
  });

  // A rotina válida carrega; a inválida não é mostrada.
  await app.chooseMode("calisthenics");
  assert.equal(app.$$(".routine-card").length, 1);

  // O armazenamento original permanece intacto após o boot.
  assert.equal(
    app.raw("forja-treino-rotinas-v1"),
    JSON.stringify(routinesRaw)
  );

  const preserved = app.data("forja-treino-dados-preservados-v1");
  assert.ok(preserved, "Conteúdo parcialmente inválido deve ser arquivado");
  assert.ok(preserved.some(item => item.key === "forja-treino-rotinas-v1" && item.raw === JSON.stringify(routinesRaw)));
  assert.ok(preserved.some(item => item.key === "forja-treino-exercicios-v1"));
  assert.match(app.text("#toast"), /preservad/i);

  // Reiniciar não duplica arquivamentos idênticos.
  const stored = Object.fromEntries(app.keys().map(key => [key, app.raw(key)]));
  app.close();

  const second = await boot(stored);
  const preservedAgain = second.data("forja-treino-dados-preservados-v1");
  const routineArchives = preservedAgain.filter(item => {
    return item.key === "forja-treino-rotinas-v1" &&
      item.raw === JSON.stringify(routinesRaw);
  });
  assert.equal(routineArchives.length, 1, "O mesmo conteúdo não deve ser arquivado duas vezes");

  assertNoErrors("arquivamento parcial");
  second.close();
});

await runTest("1f. Formato antigo ilegível não é sobrescrito por rotinas vazias", async () => {
  const corruptLegacy = "{isto não é json";

  const app = await boot({
    "forja-treino-exercicios-v1": corruptLegacy
  });

  // Nenhuma rotina vazia é gravada, permitindo recuperar o dado e migrar depois.
  assert.equal(app.raw("forja-treino-rotinas-v1"), null);
  assert.equal(app.raw("forja-treino-exercicios-v1"), corruptLegacy);
  const preserved = app.data("forja-treino-dados-preservados-v1");
  assert.equal(preserved[0].key, "forja-treino-exercicios-v1");
  assert.equal(preserved[0].raw, corruptLegacy);
  assert.match(app.text("#toast"), /ilegíveis|preservad/i);

  // Segundo boot mantém o comportamento e não duplica o arquivo.
  const stored = Object.fromEntries(app.keys().map(key => [key, app.raw(key)]));
  app.close();

  const second = await boot(stored);
  assert.equal(second.raw("forja-treino-rotinas-v1"), null);
  assert.equal(second.raw("forja-treino-exercicios-v1"), corruptLegacy);
  assert.equal(
    second.data("forja-treino-dados-preservados-v1")
      .filter(item => item.raw === corruptLegacy).length,
    1
  );

  // A interface continua funcional: cria rotina do zero e salva.
  await second.chooseMode("calisthenics");
  await second.createRoutine("Rotina nova");
  await second.addExercise({ name: "Remada", sets: 2, reps: "10", rest: 30 });
  await second.saveRoutine();
  assert.equal(second.data("forja-treino-rotinas-v1").calisthenics.length, 1);
  assert.equal(second.raw("forja-treino-exercicios-v1"), corruptLegacy);

  assertNoErrors("legado ilegível");
  second.close();
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
  });

  // Sessão normalizada continua utilizável.
  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.text("#current-sets-value").replace(/\s+/g, " "), "1 / 3");

  // Original arquivado antes de qualquer regravação.
  const preserved = app.data("forja-treino-dados-preservados-v1");
  assert.ok(preserved.some(item => {
    return item.key === "forja-treino-sessao-ativa-v1" &&
      item.raw === JSON.stringify(sessionRaw);
  }));
  assert.match(app.text("#toast"), /preservad/i);

  // Concluir uma série regrava apenas a versão normalizada; o arquivo permanece.
  await app.completeSet();
  assert.equal(app.data("forja-treino-sessao-ativa-v1").version, 2);
  assert.ok(app.data("forja-treino-dados-preservados-v1").some(item => {
    return item.raw === JSON.stringify(sessionRaw);
  }));

  assertNoErrors("sessão parcial");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 2. CRUD de rotinas                                                  */
/* ------------------------------------------------------------------ */

await runTest("2. Criar, editar, duplicar, renomear, reordenar e excluir rotinas", async () => {
  const app = await boot();
  await app.chooseMode("calisthenics");

  await app.createRoutine("Treino A");
  assert.equal(app.$("#editor-view").hidden, false);
  assert.equal(app.$("#routine-name-input").value, "Treino A");

  await app.addExercise({ section: "main", name: "Flexão", sets: 3, reps: "12", rest: 45, notes: "Descer controlado" });
  await app.addExercise({ section: "main", name: "Remada invertida", sets: 3, reps: "10", rest: 60 });
  await app.addExercise({ section: "abs", name: "Prancha", type: "duration", sets: 2, duration: 40, rest: 30 });
  await app.saveRoutine();
  assert.match(app.text("#toast"), /Rotina salva/);

  let stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics.length, 1);
  assert.equal(stored.calisthenics[0].sections.main.length, 2);
  assert.equal(stored.calisthenics[0].sections.abs[0].type, "duration");
  assert.equal(stored.calisthenics[0].sections.abs[0].duration, 40);
  assert.equal(stored.calisthenics[0].sections.main[0].notes, "Descer controlado");

  await app.backToRoutines();
  assert.equal(app.$("#modality-view").hidden, false);
  const card = app.routineCard("Treino A");
  assert.match(card.textContent, /3 exercícios/);
  assert.match(card.textContent, /8 séries planejadas/);

  // Renomear
  app.click(card.querySelectorAll(".small-button")[1]);
  await wait(20);
  app.modalField("name").value = "Treino A — Superior";
  app.modalAction("rename");
  await wait(25);
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics[0].name, "Treino A — Superior");

  // Reordenar (main: Flexão, Remada -> Remada, Flexão)
  await app.openRoutine("Treino A — Superior");
  const firstRow = app.$$('[data-section-list="main"] .editor-exercise')[0];
  app.click(firstRow.querySelectorAll(".exercise-tools .icon-button")[1]);
  await wait(15);
  await app.saveRoutine();
  stored = app.data("forja-treino-rotinas-v1");
  assert.deepEqual(
    stored.calisthenics[0].sections.main.map(item => item.name),
    ["Remada invertida", "Flexão"]
  );

  // Editar exercício
  app.click(app.$$('[data-section-list="main"] .editor-exercise')[1]
    .querySelectorAll(".exercise-tools .icon-button")[2]);
  await wait(15);
  app.$("#exercise-sets").value = "5";
  app.$("#exercise-notes").value = "Uma repetição a mais que a última vez";
  app.$("#exercise-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  app.$("#routine-name-input").value = "Treino A";
  await app.saveRoutine();
  stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics[0].name, "Treino A");
  assert.equal(stored.calisthenics[0].sections.main[1].sets, 5);
  assert.match(stored.calisthenics[0].sections.main[1].notes, /repetição a mais/);

  // Remover exercício
  await app.backToRoutines();
  await app.openRoutine("Treino A");
  app.click(app.$$('[data-section-list="abs"] .editor-exercise')[0]
    .querySelector(".icon-button.remove"));
  await wait(20);
  app.modalAction("remove");
  await wait(20);
  await app.saveRoutine();
  stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics[0].sections.abs.length, 0);

  // Duplicar
  await app.backToRoutines();
  app.click(app.routineCard("Treino A").querySelector(".small-button"));
  await wait(25);
  stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics.length, 2);
  const copy = stored.calisthenics.find(item => item.name === "Treino A (cópia)");
  assert.ok(copy, "Cópia da rotina deve existir");
  const originalIds = new Set(
    stored.calisthenics[0].sections.main.map(item => item.id)
  );
  copy.sections.main.forEach(item => {
    assert.equal(originalIds.has(item.id), false, "Duplicata deve ter ids novos");
  });

  // Excluir com confirmação: cancelar mantém
  app.click(app.routineCard("Treino A (cópia)").querySelector(".danger-button"));
  await wait(20);
  assert.match(app.text("#modal-title"), /Excluir rotina/);
  app.modalAction("cancel");
  await wait(20);
  assert.equal(app.data("forja-treino-rotinas-v1").calisthenics.length, 2);

  // Excluir com confirmação: confirmar remove
  app.click(app.routineCard("Treino A (cópia)").querySelector(".danger-button"));
  await wait(20);
  app.modalAction("delete");
  await wait(25);
  stored = app.data("forja-treino-rotinas-v1");
  assert.equal(stored.calisthenics.length, 1);
  assert.equal(stored.calisthenics[0].name, "Treino A");

  assertNoErrors("CRUD de rotinas");
  app.close();
});

await runTest("2b. Rotina não é iniciada sem exercícios e alterações não salvas são protegidas", async () => {
  const app = await boot();
  await app.chooseMode("calisthenics");
  await app.createRoutine("Vazia");
  await app.addExercise({ name: "Agachamento", sets: 2, reps: "15", rest: 0 });
  await app.saveRoutine();
  await app.backToRoutines();
  await wait(20);

  // Alteração não salva: sair pede confirmação
  await app.openRoutine("Vazia");
  app.$("#exercise-name").value = "Afundo";
  app.$("#exercise-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  app.click("#back-from-editor");
  await wait(20);
  assert.match(app.text("#modal-title"), /Descartar alterações/);
  app.modalAction("cancel");
  await wait(20);
  assert.equal(app.$("#editor-view").hidden, false, "Cancelar deve manter no editor");
  app.click("#back-from-editor");
  await wait(20);
  app.modalAction("discard");
  await wait(25);
  const routine = app.data("forja-treino-rotinas-v1").calisthenics[0];
  assert.equal(routine.sections.main.length, 1, "Exercício não salvo não deve persistir");

  // Rotina sem exercícios tem início desabilitado
  await app.createRoutine("Outra vazia");
  await app.backToRoutines();
  await wait(20);
  const emptyCard = app.routineCard("Outra vazia");
  const start = emptyCard.querySelector('[data-action="start"]');
  assert.equal(start.disabled, true);
  assert.match(start.textContent, /Adicione exercícios/);

  assertNoErrors("rotina vazia");
  app.close();
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

  const app = await boot({ "forja-treino-rotinas-v1": routines });

  await app.chooseMode("calisthenics");
  assert.equal(app.$$(".routine-card").length, 1);
  assert.equal(app.$(".routine-name").textContent, "Treino A");
  const calisthenicsRoutines = app.data("forja-treino-rotinas-v1").calisthenics;
  assert.equal(calisthenicsRoutines[0].sections.main[0].name, "Flexão");
  assert.equal(calisthenicsRoutines[0].sections.main[0].load, "");
  const weightsRoutines = app.data("forja-treino-rotinas-v1").weights;
  assert.equal(weightsRoutines[0].sections.main[0].name, "Supino");
  assert.equal(weightsRoutines[0].sections.main[0].load, "30 kg");

  await app.startRoutine("Treino A");
  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.text("#current-plan").includes("Carga"), false);
  await app.completeSet();
  assert.equal(app.text("#summary-title"), "Treino concluído");
  app.click("#summary-close");
  await wait(30);

  await app.chooseMode("weights");
  assert.equal(app.$$(".routine-card").length, 1);
  assert.equal(app.$(".routine-name").textContent, "Treino A");
  assert.equal(app.text("#history-total"), "0", "Histórico de musculação deve estar vazio");

  await app.chooseMode("calisthenics");
  assert.equal(app.text("#history-total"), "1");
  const history = app.data("forja-treino-historico-v1");
  assert.equal(history.length, 1);
  assert.equal(history[0].modality, "calisthenics");
  assert.equal(history[0].exercises[0].name, "Flexão");

  // Carga aparece na musculação
  await app.chooseMode("weights");
  await app.startRoutine("Treino A");
  assert.match(app.text("#current-plan"), /Carga: 30 kg/);
  assert.ok(app.text("#current-plan"));

  assertNoErrors("modalidades");
  app.close();
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

  const app = await boot({ "forja-treino-rotinas-v1": routines });
  await app.chooseMode("calisthenics");
  await app.startRoutine("Treino A");

  // Tela focada: sem lista completa de exercícios
  assert.equal(app.$(".exercise-list"), null, "Lista completa não deve existir na execução");
  assert.equal(app.$("#execution-screen").hidden, false);
  assert.equal(app.text("#current-section"), "Treino principal");
  assert.equal(app.text("#execution-position"), "Exercício 1 de 2");
  assert.equal(app.text("#current-sets-value").replace(/\s+/g, " "), "0 / 2");
  assert.match(app.text("#current-plan"), /10 repetições/);
  assert.match(app.text("#current-rest-value"), /1 s/);

  // Série 1: inicia descanso automaticamente
  await app.completeSet();
  assert.equal(app.$("#execution-rest").hidden, false);
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
  await app.completeSet();
  assert.equal(app.$("#execution-rest").hidden, false);
  assert.equal(app.text("#current-position"), "Exercício 1 de 2");
  assert.match(app.text("#rest-caption"), /avança para Barra/);
  assert.match(app.text("#skip-rest"), /Pular e avançar/);
  const advanced = await waitFor(() => {
    return app.text("#current-position") === "Exercício 2 de 2";
  }, { timeout: 4000 });
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
  await app.completeSet();
  await wait(40);
  assert.equal(app.$("#execution-summary").hidden, false);
  assert.equal(app.text("#summary-title"), "Treino concluído");
  assert.equal(app.text("#summary-sets"), "3/3");
  assert.equal(app.$("#execution-screen").hidden, false);

  const active = app.raw("forja-treino-sessao-ativa-v1");
  assert.equal(active, null, "Sessão ativa deve ser removida após concluir");

  const history = app.data("forja-treino-historico-v1");
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "completed");
  assert.equal(history[0].completedSets, 3);
  assert.equal(history[0].totalPlannedSets, 3);
  assert.equal(history[0].routineName, "Treino A");
  assert.ok(history[0].durationMs >= 0);

  app.click("#summary-close");
  await wait(30);
  assert.equal(app.$("#execution-screen").hidden, true);
  assert.equal(app.$("#modality-view").hidden, false);
  assert.equal(app.text("#history-total"), "1");

  assertNoErrors("execução");
  app.close();
});

await runTest("4b. Pular descanso não prende o usuário e descanso manual funciona", async () => {
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "A", [
      { name: "Agachamento", sets: 2, reps: "15", rest: 30 },
      { name: "Flexão", sets: 1, reps: "10", rest: 0 }
    ])],
    weights: []
  };

  const app = await boot({ "forja-treino-rotinas-v1": routines });
  await app.chooseMode("calisthenics");
  await app.startRoutine();

  // Descanso manual antes da série
  app.click("#start-rest");
  await wait(20);
  assert.equal(app.$("#execution-rest").hidden, false);
  assert.match(app.text("#skip-rest"), /Pular descanso/);
  app.click("#skip-rest");
  await wait(25);
  assert.equal(app.$("#execution-rest").hidden, true);
  assert.equal(app.$("#complete-set").disabled, false);

  // Descanso automático pulado
  await app.completeSet();
  assert.equal(app.$("#execution-rest").hidden, false);
  app.click("#skip-rest");
  await wait(25);
  assert.equal(app.$("#execution-rest").hidden, true);
  assert.equal(app.$("#complete-set").disabled, false);

  // Concluir exercício com descanso e pular o avanço
  await app.completeSet();
  assert.equal(app.$("#execution-rest").hidden, false);
  app.click("#skip-rest");
  await wait(25);
  assert.equal(app.text("#current-name"), "Flexão", "Pular o descanso final deve avançar");

  assertNoErrors("pular descanso");
  app.close();
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

  const first = await boot({ "forja-treino-rotinas-v1": routines });
  await first.chooseMode("calisthenics");
  await first.startRoutine();
  await first.completeSet();
  first.click("#pause-rest");
  await wait(20);

  const stored = {};
  first.keys().forEach(key => {
    stored[key] = first.raw(key);
  });
  first.close();

  const second = await boot(stored);
  assert.equal(second.$("#execution-screen").hidden, false, "Sessão deve reabrir");
  assert.equal(second.text("#current-name"), "Flexão");
  assert.equal(second.text("#current-sets-value").replace(/\s+/g, " "), "1 / 3");
  assert.match(second.text("#rest-caption"), /pausado/i);

  // Retomar o descanso após recarregar
  second.click("#resume-rest");
  await wait(20);
  assert.equal(second.$("#execution-rest").hidden, false);
  const restEnded = await waitFor(() => second.$("#execution-rest").hidden, { timeout: 4000 });
  assert.equal(restEnded, true, "Descanso deve terminar após recarregar");
  assert.match(second.text("#complete-set"), /série 2 de 3/);

  // Continuar e concluir (descansos pulados)
  for (let index = 0; index < 4; index++) {
    await waitFor(() => !second.$("#complete-set").disabled);
    await second.completeSet();

    if (!second.$("#execution-rest").hidden) {
      await waitFor(() => !second.$("#skip-rest").disabled);
      second.click("#skip-rest");
      await wait(30);
    }
  }

  await waitFor(() => !second.$("#execution-summary").hidden, { timeout: 3000 });

  assert.equal(second.text("#summary-title"), "Treino concluído");
  assert.equal(second.data("forja-treino-historico-v1")[0].completedSets, 4);

  assertNoErrors("recarregar");
  second.close();
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
  });

  await app.chooseMode("calisthenics");

  // Cancelar sem concluir nada: nada é registrado
  await app.startRoutine();
  await app.endSession("discard");
  assert.equal(app.data("forja-treino-historico-v1").length, 1);
  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null);
  assert.match(app.text("#toast"), /descartada/i);

  // Parcial: encerrar e salvar registra status partial
  await app.startRoutine();
  await app.completeSet();
  await app.endSession("save");
  let history = app.data("forja-treino-historico-v1");
  assert.equal(history.length, 2);
  assert.equal(history[0].status, "partial");
  assert.equal(history[0].completedSets, 1);
  assert.equal(history[0].totalPlannedSets, 2);
  assert.match(app.text("#summary-title"), /Sessão encerrada/);
  app.click("#summary-close");
  await wait(25);

  // Histórico anterior permanece intacto
  assert.deepEqual(history[1], previousHistory[0]);

  // Concluir normalmente adiciona apenas um registro
  await app.startRoutine();
  await app.completeSet();
  await app.completeSet();
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
  await wait(25);
  await app.startRoutine();
  app.click("#pause-session");
  await wait(20);
  app.click("#end-session");
  await wait(20);
  assert.match(app.text("#modal-title"), /Encerrar sessão/);
  app.modalAction("discard");
  await wait(30);
  assert.equal(app.data("forja-treino-historico-v1").length, 3);
  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null);

  assertNoErrors("histórico");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 7. Backup JSON                                                      */
/* ------------------------------------------------------------------ */

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
  });

  // Exportação via UI
  app.click("#export-backup");
  await wait(30);
  assert.equal(app.downloads.length, 1);
  assert.match(app.downloads[0].download, /^forja-backup-\d{4}-\d{2}-\d{2}\.json$/);
  assert.match(app.text("#toast"), /Backup exportado/);

  const backup = app.w.buildBackupObject();
  assert.equal(backup.app, "FORJA");
  assert.equal(backup.format, "forja-backup");
  assert.equal(backup.version, 1);
  assert.ok(backup.keys["forja-treino-rotinas-v1"]);
  assert.ok(backup.keys["forja-treino-historico-v1"]);
  assert.ok(backup.keys["forja-missoes-" + todayKey()]);

  // Altera os dados atuais para provar restauração
  app.set("forja-treino-rotinas-v1", { calisthenics: [], weights: [] });
  app.set("forja-treino-historico-v1", []);
  app.set(["forja-missoes-" + todayKey()], [{ id: "x", text: "Missão nova", done: false }]);

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
  assert.equal(app.$("#restore-safety-backup").hidden, false);

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
  await app.importFile({
    app: "FORJA",
    format: "forja-backup",
    version: 1,
    keys: { "outra-chave": [] }
  });
  assert.match(app.text("#modal-title"), /Backup inválido/);
  app.modalAction("close");
  await wait(20);

  // Não usa localStorage.clear
  assert.equal(/localStorage\.clear\s*\(/.test(html), false);

  assertNoErrors("backup");
  app.close();
});

await runTest("7b. Backup inclui sessão ativa e a restaura com segurança", async () => {
  const routines = {
    calisthenics: [makeRoutine("calisthenics", "Treino A", [
      { id: "ex1", name: "Flexão", sets: 3, reps: "10", rest: 30 },
      { id: "ex2", name: "Barra", sets: 2, reps: "5", rest: 30 }
    ])],
    weights: []
  };

  const app = await boot({ "forja-treino-rotinas-v1": routines });
  await app.chooseMode("calisthenics");
  await app.startRoutine();
  await app.completeSet();
  app.click("#pause-rest");
  await wait(20);

  const backup = app.w.buildBackupObject();
  assert.ok(backup.keys["forja-treino-sessao-ativa-v1"]);
  assert.equal(backup.summary.activeSession.modality, "calisthenics");
  assert.equal(backup.summary.activeSession.legacy, false);

  // Descarta a sessão e restaura o backup
  await app.endSession("discard");
  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null);

  await app.importFile(backup);
  assert.match(app.$(".modal-details").textContent, /Sessão ativa: Calistenia · Treino A/);
  assert.match(app.$(".modal-details").textContent, /Atenção: O backup contém uma sessão ativa/);
  app.modalAction("restore");
  await wait(150);

  assert.equal(app.$("#execution-screen").hidden, false, "Sessão restaurada deve reabrir");
  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.text("#current-sets-value").replace(/\s+/g, " "), "1 / 3");

  assertNoErrors("backup com sessão ativa");
  app.close();
});

await runTest("7c. Importação de backup antigo sem rotinas gera rotinas padrão", async () => {
  const app = await boot();
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

  assertNoErrors("backup legado");
  app.close();
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
  });

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
  const markedDays = app.$$(".calendar-grid .day.has-tasks");
  assert.ok(markedDays.length >= 1, "O dia com missões deve ter indicador");

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
  await app.chooseMode("calisthenics");
  assert.equal(app.text("#progress-label"), "2 de 3 · 67%");

  // Backup e restauração não quebram o calendário
  const backup = app.w.buildBackupObject();
  app.set("forja-missoes-" + today, []);
  await app.importFile(backup);
  app.modalAction("restore");
  await wait(150);
  assert.equal(app.text("#progress-label"), "2 de 3 · 67%");
  assert.equal(app.$$(".task").length, 3);
  assert.equal(app.text(".task-text"), "Beber 3L de água");

  assertNoErrors("calendário");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 9/10. Responsividade estática e integridade do console              */
/* ------------------------------------------------------------------ */

await runTest("9. Base responsiva presente (viewport e media queries)", async () => {
  const app = await boot();

  const viewport = app.d.querySelector('meta[name="viewport"]');
  assert.ok(viewport, "Meta viewport ausente");
  assert.match(viewport.content, /width=device-width/);

  assert.ok(html.includes("@media (max-width: 560px)"), "Media query mobile ausente");
  assert.ok(html.includes("@media (max-width: 380px)"), "Media query mobile estreita ausente");
  assert.ok(html.includes(".modality-grid"), "Grid de modalidades ausente");
  assert.ok(html.includes(".execution-screen"), "Tela de execução ausente");

  assertNoErrors("responsivo estático");
  app.close();
});

await runTest("10. Integridade: ids referenciados existem e nenhum erro de console", async () => {
  const app = await boot();

  const scriptStart = html.indexOf("<script>");
  const script = html.slice(scriptStart, html.indexOf("</script>", scriptStart));

  const referenced = new Set();
  const patterns = [
    /byId\("([^"]+)"\)/g,
    /getElementById\("([^"]+)"\)/g,
    /bindEvent\("([^"]+)",/g
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(script)) !== null) {
      referenced.add(match[1]);
    }
  });

  const missing = Array.from(referenced).filter(id => {
    return !app.d.getElementById(id);
  });

  assert.deepEqual(missing, [], "Ids referenciados no script não existem no HTML: " + missing.join(", "));
  assert.ok(referenced.size > 40, "Verificação de ids deve cobrir a aplicação");

  // Botões essenciais presentes
  [
    "mode-calisthenics", "mode-weights", "new-routine", "save-routine",
    "complete-set", "pause-session", "resume-session", "end-session",
    "pause-rest", "resume-rest", "skip-rest", "start-rest",
    "previous-exercise", "next-exercise", "export-backup",
    "import-backup-button", "restore-safety-backup"
  ].forEach(id => {
    assert.ok(app.d.getElementById(id), "Botão ausente: " + id);
  });

  assertNoErrors("integridade");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 11. Regressão do calendário e das missões                           */
/* ------------------------------------------------------------------ */

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
  });

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
  app.$("#task-form").dispatchEvent(new app.w.Event("submit", {
    bubbles: true, cancelable: true
  }));
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

  const second = await boot(raw);
  assert.equal(
    second.text("#selected-date"),
    formatSelected(second.w, year, month, todayDay)
  );
  assert.equal(second.text("#progress-label"), "0 de 0 · 0%");
  assert.equal(second.$$(".task").length, 0);
  assert.equal(second.data(otherKeyStr).length, 2);
  assert.equal(second.data(otherKeyStr)[1].text, "Nova missão do outro dia");
  assert.equal(second.$$("#calendar-grid .day.has-tasks").length, 1);

  // Navegação de meses preservada e sem perder missões.
  const beforeNavigation = second.w.eval(
    "({ year: displayedYear, month: displayedMonth })"
  );
  const title = second.text("#month-title");
  second.click("#next-month");
  await wait(25);
  const afterNext = second.w.eval(
    "({ year: displayedYear, month: displayedMonth })"
  );
  assert.equal(
    afterNext.month,
    (beforeNavigation.month + 1) % 12
  );
  second.click("#prev-month");
  await wait(25);
  assert.equal(second.text("#month-title"), title);
  assert.equal(second.data(otherKeyStr).length, 2);

  assertNoErrors("calendário completo");
  second.close();
});

await runTest("11b. Um envio cria exatamente um item (sem listeners duplicados)", async () => {
  const today = todayKey();
  const app = await boot();

  const before = app.$$(".task").length;
  app.$("#task-input").value = "Missão única";
  app.$("#task-form").dispatchEvent(new app.w.Event("submit", {
    bubbles: true, cancelable: true
  }));
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

  // Duas submissões iguais geram duas missões (e não quatro).
  app.$("#task-input").value = "Segunda missão";
  app.$("#task-form").dispatchEvent(new app.w.Event("submit", {
    bubbles: true, cancelable: true
  }));
  await wait(20);
  app.$("#task-input").value = "Terceira missão";
  app.$("#task-form").dispatchEvent(new app.w.Event("submit", {
    bubbles: true, cancelable: true
  }));
  await wait(30);
  assert.equal(app.data("forja-missoes-" + today).length, 3);

  assertNoErrors("listeners únicos");
  app.close();
});

await runTest("11c. Missões antigas em formato de texto continuam funcionando", async () => {
  const today = todayKey();
  const app = await boot({
    ["forja-missoes-" + today]: ["Missão em texto 1", "Missão em texto 2"]
  });

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

  const second = await boot(raw);
  assert.equal(second.text("#progress-label"), "1 de 2 · 50%");
  assert.equal(second.$$(".task.done").length, 1);

  assertNoErrors("missões antigas");
  second.close();
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

  const app = await boot({ "forja-treino-rotinas-v1": routines });

  const assertUniqueIds = label => {
    const ids = app.$$("[id]").map(element => element.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual(duplicates, [], "IDs duplicados (" + label + "): " + duplicates.join(", "));
    assert.ok(ids.length > 20);
  };

  assertUniqueIds("inicial");

  await app.chooseMode("calisthenics");
  app.click("#new-routine");
  await wait(25);
  assertUniqueIds("modal aberto");
  app.modalAction("cancel");
  await wait(20);

  await app.openRoutine("Treino A");
  assertUniqueIds("editor aberto");
  app.click("#back-from-editor");
  await wait(20);

  await app.startRoutine("Treino A");
  assertUniqueIds("execução aberta");

  app.click("#end-session");
  await wait(25);
  assertUniqueIds("modal sobre execução");
  app.modalAction("discard");
  await wait(30);

  assertNoErrors("ids únicos");
  app.close();
});

await runTest("12b. Nenhuma função/ID antiga referenciada e um único boot", async () => {
  const scriptStart = html.indexOf("<script>");
  const script = html.slice(scriptStart, html.indexOf("</script>", scriptStart));

  const removedFunctions = [
    "beginExerciseEdit", "cancelExerciseEdit", "completeSet", "deleteExercise",
    "endRest", "finishWorkout", "getActiveForMode", "getModeExercises",
    "pauseWorkout", "readJSON", "renderExercises", "renderHistory",
    "renderWorkout", "resumeWorkout", "saveExercises", "saveHistory",
    "selectWorkoutMode", "setWorkoutNotice", "startWorkout",
    "updateWorkoutTimers", "validExercisesData"
  ];

  removedFunctions.forEach(name => {
    assert.equal(
      new RegExp("\\b" + name + "\\s*\\(").test(script),
      false,
      "Função removida ainda referenciada: " + name
    );
  });

  [
    "workout-content", "session-timer", "session-caption", "start-workout",
    "pause-workout", "resume-workout", "finish-workout", "exercise-list",
    "workout-notice", "choose-calisthenics", "choose-weight"
  ].forEach(id => {
    assert.equal(
      script.includes(id),
      false,
      "ID removido ainda referenciado: " + id
    );
  });

  // Ligação única dos controles do calendário/missões.
  [
    "task-form", "prev-month", "next-month"
  ].forEach(id => {
    const pattern = new RegExp(
      "getElementById\\(\"" + id + "\"\\)\\.addEventListener\\(",
      "g"
    );
    const count = (script.match(pattern) || []).length;
    assert.equal(count, 1, "Listener duplicado ou ausente em #" + id);
  });

  assert.equal((script.match(/function bootWorkoutModule\s*\(/g) || []).length, 1);
  assert.equal((script.match(/^bootWorkoutModule\(\);/gm) || []).length, 1);
  assert.equal((script.match(/setInterval\(workoutTick/g) || []).length, 1);

  // O bloco de calendário/missões é idêntico ao da main (3505b01).
  const scriptContent = script.slice(script.indexOf(">") + 1);
  const calendarBlock = scriptContent.split("/* FORJA TREINO")[0].trim();
  assert.equal(
    createHash("sha256").update(calendarBlock).digest("hex"),
    "30a825330793e156adc357ae714f022c853033c1016ee66ffeaec1ab705928c5",
    "O código de calendário/missões mudou em relação à main"
  );

  assertNoErrors("integridade estrutural");
});

await runTest("12c. Regras móveis de calendário/missões seguem presentes em ≤380px", async () => {
  const cssStart = html.indexOf("<style>");
  const css = html.slice(cssStart, html.indexOf("</style>", cssStart));

  // A branch tem mais de um bloco de 380px (o novo módulo de treino tem o
  // seu). O que importa é o efeito combinado; por isso todos são lidos.
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
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }

    assert.ok(end > open, "Bloco de 380px não fechado");
    blocks.push(css.slice(open + 1, end));
    searchFrom = end + 1;
  }

  assert.ok(blocks.length >= 1, "Media query de 380px ausente");
  const mobile = blocks.join("\n");

  assert.match(
    mobile,
    /\.calendar-panel,\s*\.missions-panel,\s*\.workout-panel\s*\{\s*padding:\s*12px;/
  );
  assert.match(mobile, /\.calendar-grid\s*\{\s*gap:\s*3px;\s*\}/);
  assert.match(mobile, /\.day\s*\{\s*font-size:\s*12px;\s*\}/);
  assert.match(mobile, /\.task-form\s*\{\s*flex-wrap:\s*wrap;\s*\}/);
  assert.match(mobile, /\.task-form input\s*\{\s*flex:\s*1 1 100%;\s*\}/);
  assert.match(mobile, /\.task-form \.add-button\s*\{[^}]*width:\s*100%/);
  assert.match(mobile, /\.history-summary\s*\{\s*gap:\s*5px;\s*\}/);

  assertNoErrors("css mobile");
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
    "forja-treino-migracao-v1": {
      version: 2, updatedAt: new Date().toISOString(), source: "teste"
    },
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

  const app = await boot(seed);
  const original = parsedStorage(app);

  const backup = app.w.buildBackupObject();
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
  const secondBackup = app.w.buildBackupObject();
  assert.equal(secondBackup.keys["forja-backup-seguranca-v1"], undefined);

  assertNoErrors("round-trip de backup");
  app.close();
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
  });

  const original = parsedStorage(app);
  const backup = app.w.buildBackupObject();
  backup.keys["forja-missoes-" + today] = [{ id: "novo", text: "Importada", done: false }];
  backup.keys["forja-treino-historico-v1"] = [];

  const guard = installFailingStorage(app, {
    failOn: "forja-treino-rotinas-v1",
    times: 1
  });

  await app.importFile(backup);
  app.modalAction("restore");
  await wait(180);
  guard.restore();

  assert.match(app.text("#modal-title"), /Falha ao restaurar/);
  assert.match(app.text(".modal-message"), /recuperados integralmente/);
  assert.match(
    app.text(".modal-message"),
    /forja-treino-rotinas-v1/,
    "A mensagem deve identificar a chave que falhou"
  );
  assert.deepEqual(parsedStorage(app), original, "Rollback deve restaurar todas as chaves originais");
  assert.ok(app.raw("forja-backup-seguranca-v1"), "Cópia de segurança deve permanecer");

  assertNoErrors("rollback integral");
  app.close();
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
  });

  const original = parsedStorage(app);
  const backup = app.w.buildBackupObject();
  backup.keys["forja-missoes-" + today] = [{ id: "novo", text: "Importada", done: false }];

  // Falha na gravação e novamente no rollback da mesma chave.
  const guard = installFailingStorage(app, {
    failOn: "forja-treino-rotinas-v1",
    times: 2
  });

  await app.importFile(backup);
  app.modalAction("restore");
  await wait(200);
  guard.restore();

  assert.match(app.text("#modal-title"), /Falha ao restaurar/);
  assert.match(app.text(".modal-message"), /forja-treino-rotinas-v1/);
  assert.match(app.text(".modal-message"), /forja-backup-seguranca-v1/);

  // As demais chaves voltam ao conteúdo original.
  assert.equal(app.raw("forja-missoes-" + today), JSON.stringify(original["forja-missoes-" + today]));
  assert.equal(
    app.raw("forja-treino-historico-v1"),
    JSON.stringify(original["forja-treino-historico-v1"])
  );

  // A cópia de segurança contém o estado anterior completo.
  const safety = app.data("forja-backup-seguranca-v1");
  assert.deepEqual(safety.keys, original);

  assertNoErrors("falha no rollback");
  app.close();
});

await runTest("13d. Falha ao criar a cópia de segurança aborta sem alterar dados", async () => {
  const today = todayKey();
  const app = await boot({
    ["forja-missoes-" + today]: [{ id: "m1", text: "Original", done: false }],
    "forja-treino-historico-v1": []
  });

  const original = parsedStorage(app);
  const backup = app.w.buildBackupObject();
  backup.keys["forja-missoes-" + today] = [{ id: "novo", text: "Importada", done: false }];

  const guard = installFailingStorage(app, {
    failOn: "forja-backup-seguranca-v1",
    times: 1
  });

  await app.importFile(backup);
  app.modalAction("restore");
  await wait(180);
  guard.restore();

  assert.deepEqual(parsedStorage(app), original);
  assert.equal(app.raw("forja-backup-seguranca-v1"), null);
  assert.match(app.text("#toast"), /Não foi possível salvar/);

  assertNoErrors("falha na cópia de segurança");
  app.close();
});

await runTest("13e. Exportar sem dados orienta o usuário e não gera arquivo vazio", async () => {
  const app = await boot();

  assert.deepEqual(app.keys(), [], "Boot vazio não deve gravar chaves de treino");

  app.click("#export-backup");
  await wait(30);

  assert.equal(app.downloads.length, 0);
  assert.match(app.text("#toast"), /Ainda não há dados do FORJA para exportar/);

  assertNoErrors("exportação vazia");
  app.close();
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
  const app = await boot({ "forja-treino-rotinas-v1": pendingRoutine() });
  await app.chooseMode("calisthenics");
  await app.startRoutine();

  await app.completeSet();
  app.click("#skip-rest");
  await wait(30);
  await app.completeSet();
  assert.equal(app.$("#execution-rest").hidden, false);
  assert.match(app.text("#rest-caption"), /avança para Exercício 2/);

  app.click("#pause-session");
  await wait(30);

  const raw = parsedStorage(app);
  app.close();

  const second = await boot(raw);
  assert.equal(second.$("#execution-screen").hidden, false);
  assert.equal(second.text("#current-position"), "Exercício 1 de 2");

  const stored = second.data("forja-treino-sessao-ativa-v1");
  assert.equal(stored.pendingAdvance, true);
  assert.equal(stored.restPaused, true);
  assert.equal(stored.running, false);

  second.click("#resume-session");
  const advanced = await waitFor(() => {
    return second.text("#current-position") === "Exercício 2 de 2";
  }, { timeout: 5000 });

  assert.equal(advanced, true, "O avanço pendente deve continuar após recarregar");
  assert.equal(second.text("#current-name"), "Exercício 2");

  assertNoErrors("avanço pendente pausado");
  second.close();
});

await runTest("14b. Pausar apenas o descanso pendente e recarregar mantém o avanço", async () => {
  const app = await boot({ "forja-treino-rotinas-v1": pendingRoutine() });
  await app.chooseMode("calisthenics");
  await app.startRoutine();

  await app.completeSet();
  app.click("#skip-rest");
  await wait(30);
  await app.completeSet();
  app.click("#pause-rest");
  await wait(30);

  const raw = parsedStorage(app);
  app.close();

  const second = await boot(raw);
  const stored = second.data("forja-treino-sessao-ativa-v1");
  assert.equal(stored.pendingAdvance, true);
  assert.equal(stored.restPaused, true);

  second.click("#resume-rest");
  const advanced = await waitFor(() => {
    return second.text("#current-position") === "Exercício 2 de 2";
  }, { timeout: 5000 });

  assert.equal(advanced, true, "O avanço deve ocorrer após o descanso retomado");
  assertNoErrors("descanso pendente pausado");
  second.close();
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
  });

  // O estado inconsistente é aceito na tela, mas o avanço pendente é
  // descartado em memória (o armazenamento só é regravado em uma ação).
  assert.equal(app.w.eval("activeWorkout.pendingAdvance"), false);
  app.click("#resume-session");
  await wait(1200);

  assert.equal(app.text("#current-position"), "Exercício 1 de 2");
  assert.match(app.text("#complete-set"), /Concluir série 1 de 2/);
  assert.equal(app.$("#complete-set").disabled, false);

  assertNoErrors("estado inconsistente");
  app.close();
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

  const second = await boot(raw);
  assert.equal(second.$("#execution-summary").hidden, true);
  assert.equal(second.$("#execution-rest").hidden, false);
  assert.equal(second.w.eval("activeWorkout.pendingAdvance"), true);

  second.click("#resume-session");
  const finished = await waitFor(() => {
    return !second.$("#execution-summary").hidden;
  }, { timeout: 5000 });

  assert.equal(finished, true, "O resumo deve aparecer após o descanso pendente");
  assert.equal(second.text("#summary-title"), "Treino concluído");
  assert.equal(second.text("#summary-sets"), "1/1");

  const history = second.data("forja-treino-historico-v1");
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "completed");
  assert.equal(second.raw("forja-treino-sessao-ativa-v1"), null);

  assertNoErrors("pendente no último exercício");
  second.close();
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

  const app = await boot(seed);

  assert.deepEqual(app.keys(), Object.keys(expected).sort());
  assert.equal(app.raw("forja-treino-rotinas-v1"), null);
  assert.equal(app.raw("forja-treino-migracao-v1"), null);
  assert.equal(app.raw("forja-treino-sessao-ativa-v1"), null);
  assert.equal(app.text(".task-text"), "Só missão");

  assertNoErrors("boot só com missões");
  app.close();
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
    const app = await boot(raw);
    const snapshot = parsedStorage(app);
    snapshots.push(snapshot);
    assert.equal(app.raw("forja-treino-exercicios-v1"), legacyRaw);
    app.close();
    raw = snapshot;
  }

  const routines = snapshots[0]["forja-treino-rotinas-v1"];
  assert.equal(routines.calisthenics.length, 1);
  assert.equal(routines.weights.length, 1);

  for (let index = 1; index < snapshots.length; index++) {
    assert.deepEqual(
      snapshots[index]["forja-treino-rotinas-v1"],
      routines,
      "Rotinas não podem mudar entre carregamentos"
    );
    assert.deepEqual(
      snapshots[index]["forja-treino-historico-v1"],
      legacyHistory
    );
    assert.equal(
      snapshots[index]["forja-treino-migracao-v1"].routinesCreated.length,
      2
    );
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
  });

  const active = app.data("forja-treino-sessao-ativa-v1");
  assert.equal(active.version, 2);
  assert.deepEqual(active.queue.map(item => item.id), ["c1", "c2"]);
  assert.deepEqual(active.completedSets, { c1: 1, c2: 0 });

  const archived = app.data("forja-treino-sessao-ativa-legada-v1");
  assert.equal(archived.session.id, "legado-extra");
  assert.equal(archived.session.completedSets.fantasma, 7);

  assert.equal(app.text("#current-name"), "Flexão");
  assert.equal(app.text("#current-sets-value").replace(/\s+/g, " "), "1 / 3");

  assertNoErrors("sessão antiga com progresso extra");
  app.close();
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
  });

  await app.chooseMode("calisthenics");
  assert.equal(app.$$(".routine-card").length, 1);
  assert.equal(app.text(".routine-name"), "Minha rotina");
  assert.equal(app.raw("forja-treino-migracao-v1"), null);
  assert.equal(
    app.raw("forja-treino-exercicios-v1"),
    JSON.stringify(legacyExercises)
  );

  assertNoErrors("rotinas existentes");
  app.close();
});

/* ------------------------------------------------------------------ */

const failed = results.filter(result => !result.ok);

console.log("\n" + "=".repeat(66));
console.log(
  "FORJA — " + (results.length - failed.length) + "/" + results.length +
  " testes aprovados"
);
if (failed.length > 0) {
  console.log("Falhas: " + failed.map(item => item.name).join(" | "));
}
console.log("=".repeat(66));

process.exitCode = failed.length > 0 ? 1 : 0;
