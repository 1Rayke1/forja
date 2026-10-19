/*
  Suíte de testes do FORJA (jsdom).
  Executa o index.html real, com o mesmo JavaScript que roda no navegador.

  Uso: npm install && npm test
*/

import { JSDOM, VirtualConsole } from "jsdom";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
