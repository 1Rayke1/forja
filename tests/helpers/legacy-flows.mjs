/*
  Auxiliares de fluxo para os testes de paridade (tests/paridade.test.mjs).

  Reproduzem as ações da suíte antiga de página única, agora sobre as páginas
  reais do app. O armazenamento é preservado entre páginas pelo harness, como em
  um navegador. Todas as funções recebem a instância App de helpers/harness.mjs.
*/
import assert from "node:assert/strict";
import { BASE, wait } from "./harness.mjs";

export const PAGE = {
  index: "index.html",
  hub: "treino/index.html",
  calistenia: "treino/calistenia.html",
  musculacao: "treino/musculacao.html",
  rotina: "treino/rotina.html",
  executar: "treino/executar.html",
  biblioteca: "treino/biblioteca.html",
  explorar: "explorar/index.html",
  atlas: "explorar/atlas.html",
  progresso: "progresso/index.html",
  perfil: "perfil/index.html",
  config: "configuracoes/index.html"
};

export function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + month + "-" + day;
}

export function makeRoutine(modality, name, exercises) {
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

export async function waitUntil(predicate, timeout = 4000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (predicate()) return true;
    await wait(25);
  }
  return false;
}

export async function waitPath(app, fragment, timeout = 4000) {
  const ok = await waitUntil(() => app.w.location.pathname.includes(fragment), timeout);
  assert.ok(ok, "Esperava a página com " + fragment + ", mas está em " + app.w.location.pathname);
  await wait(30);
}

export function assertNoErrors(app, label = "") {
  const relevant = app.errors.filter(error => !/Could not parse CSS stylesheet/i.test(error));
  assert.deepEqual(relevant, [], "Erros de console" + (label ? " (" + label + ")" : "") + ": " + relevant.join(" | "));
}

export function buttonByText(root, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp("^" + pattern + "$", "i");
  return Array.from(root.querySelectorAll("button, a")).find(el => re.test(el.textContent.trim()));
}

export async function openPage(app, rel) {
  await app.go(BASE + rel);
  await wait(30);
}

export async function chooseMode(app, mode) {
  await openPage(app, PAGE.hub);
  app.click("#mode-" + mode);
  await waitPath(app, mode === "calisthenics" ? "calistenia.html" : "musculacao.html");
}

export function routineCard(app, name) {
  return app.$$(".routine-card").find(card => {
    const title = card.querySelector(".routine-name");
    return title && title.textContent.trim() === name;
  });
}

export async function createRoutine(app, name) {
  app.click("#new-routine");
  await waitUntil(() => app.modalField("name"));
  assert.ok(app.modalField("name"), "Campo de nome da rotina não apareceu");
  app.modalField("name").value = name;
  app.modalAction("create");
  await waitPath(app, "rotina.html");
}

export async function addExercise(app, options = {}) {
  const {
    section = "main", name, sets = 3, type = "reps", reps = "10",
    duration = 45, rest = 0, load = "", notes = ""
  } = options;

  app.$("#exercise-section").value = section;
  app.$("#exercise-name").value = name;
  app.$("#exercise-sets").value = String(sets);
  if (type === "duration") {
    app.click("#exercise-type-duration");
    app.$("#exercise-duration").value = String(duration);
  } else {
    app.click("#exercise-type-reps");
    app.$("#exercise-reps").value = reps;
  }
  app.$("#exercise-rest").value = String(rest);
  app.$("#exercise-load").value = load;
  app.$("#exercise-notes").value = notes;
  app.$("#exercise-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
}

export async function saveRoutine(app) {
  app.click("#save-routine-top");
  await wait(25);
}

export async function backToRoutines(app) {
  app.click("#back-to-modality");
  await waitUntil(() => !app.w.location.pathname.includes("rotina.html"));
  await wait(30);
}

export async function startRoutine(app, name) {
  const card = name ? routineCard(app, name) : app.$(".routine-card");
  assert.ok(card, "Rotina para iniciar não encontrada: " + name);
  app.click(card.querySelector(".routine-start"));
  await waitPath(app, "executar.html");
}

export async function completeSet(app) {
  app.click("#complete-set");
  await wait(20);
}

export async function endSession(app, action) {
  app.click("#end-session");
  await wait(20);
  app.modalAction(action);
  await wait(35);
}

export function formatSelected(w, year, month, day) {
  return w.eval(
    "formatDate(new Date(" + year + ", " + month + ", " + day + "), " +
    "{ weekday: \"long\", day: \"numeric\", month: \"long\", year: \"numeric\" })"
  );
}

export function installFailingStorage(app, options) {
  const real = app.w.localStorage;
  const state = { failOn: options.failOn, times: options.times === undefined ? 1 : options.times, hits: 0 };
  const fake = {
    get length() { return real.length; },
    key(index) { return real.key(index); },
    getItem(key) { return real.getItem(key); },
    setItem(key, value) {
      if (key === state.failOn && state.hits < state.times) {
        state.hits += 1;
        const error = new Error("QuotaExceededError simulado");
        error.name = "QuotaExceededError";
        throw error;
      }
      real.setItem(key, value);
    },
    removeItem(key) { return real.removeItem(key); },
    clear() { return real.clear(); }
  };
  Object.defineProperty(app.w, "localStorage", { value: fake, configurable: true });
  return {
    state,
    real,
    restore() {
      Object.defineProperty(app.w, "localStorage", { value: real, configurable: true });
    }
  };
}

export function snapshot(app) {
  return Object.fromEntries(app.keys().map(key => [key, app.raw(key)]));
}
