/*
  Harness do FORJA para testes em jsdom com páginas multipágina.

  - Serve os arquivos reais do repositório sob https://forja.test/forja/,
    como o GitHub Pages serve https://usuario.github.io/forja/.
  - Cada página é carregada em uma nova janela jsdom. O localStorage e o
    sessionStorage são copiados para a janela seguinte, como um navegador faria.
  - Cliques em links (inclusive F.navigate, que chama anchor.click()) trocam de
    página. Links de download são capturados em app.downloads.
  - app.storageWrites observa dados de negócio (nomes lógicos preservados).
    authStorageWrites e allStorageWrites observam separadamente tokens/journals
    e os nomes físicos, sem esconder operações da suíte de autenticação.
  - O SDK é real; apenas os endpoints HTTP e a configuração pública são fixtures.
    A semeadura nunca injeta um bypass no código de produção.
*/
import jsdomPkg from "jsdom";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthFixture, CONFIG_SCRIPT, AUTH_STORAGE_KEY, USERS, DATA_PREFIX, TAB_PREFIX, completedJournal, COPY_KEY, installJsdomAuth } from "./auth-fixture.mjs";

const { JSDOM, VirtualConsole, requestInterceptor } = jsdomPkg;

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..");
export const BASE = "https://forja.test/forja/";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Os fluxos de domínio não dependem da latência arbitrária do gate assíncrono.
export const wait = async ms => {
  await delay(ms);
  const pending = [...openApps].filter(app => app.dom && app.F && app.F.ready &&
    !["guest", "error"].includes(app.F.auth?.state) &&
    app.d.documentElement.dataset.forjaAuth !== "ready" &&
    (app.$("#auth-legacy-choice")?.hidden !== false) && (app.$("#auth-retry")?.hidden !== false));
  await Promise.all(pending.map(app => Promise.race([(async () => {
    if (app.F.authData?.userId) await app.F.auth.revalidate();
    await app.F.ready;
  })(), delay(4000)])));
};

function makeInterceptor(app) { return requestInterceptor(async request => {
  if (request.url.split(/[?#]/)[0].endsWith("/assets/js/forja-supabase-config.js") && app.fixture.configured) {
    return new Response(CONFIG_SCRIPT, { headers: { "content-type": "text/javascript" } });
  }
  if (request.url.startsWith("https://www.youtube-nocookie.com/embed/")) {
    return new Response("<!doctype html><title>YouTube Embed</title>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }
  if (request.url.startsWith("https://i.ytimg.com/vi/")) {
    return new Response("", {
      status: 200,
      headers: { "content-type": "image/jpeg" }
    });
  }
  if (!request.url.startsWith(BASE)) {
    return new Response("", { status: 404 });
  }

  const relative = request.url.slice(BASE.length).split(/[?#]/)[0];
  const file = path.resolve(repoRoot, relative);

  if (!file.startsWith(repoRoot + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return new Response("", { status: 404 });
  }

  const type = file.endsWith(".js") ? "text/javascript"
    : file.endsWith(".css") ? "text/css"
    : "text/html";

  return new Response(fs.readFileSync(file), {
    status: 200,
    headers: { "content-type": type + "; charset=utf-8" }
  });
}); }

const openApps = new Set();

export class App {
  constructor(options = {}) {
    this.fixture = options.fixture || new AuthFixture();
    this.authOptions = options;
    this.authStorageWrites = [];
    this.allStorageWrites = [];
    this.externalNavigations = [];
    this.errors = [];
    this.downloads = [];
    this.storageWrites = [];
    this.dom = null;
    this.fakeNow = null;
    this.pageUrl = null;
  }

  get w() { return this.dom.window; }
  get d() { return this.dom.window.document; }

  $(selector) { return this.d.querySelector(selector); }
  $$(selector) { return Array.from(this.d.querySelectorAll(selector)); }

  text(selector) {
    const element = this.$(selector);
    return element ? element.textContent.trim() : null;
  }

  click(target) {
    const element = typeof target === "string" ? this.$(target) : target;
    assert.ok(element, "Elemento para clique não encontrado: " + target);
    element.dispatchEvent(new this.w.MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  raw(key) { return this.F.store && key.startsWith("forja-") ? this.F.store.readRaw(key) : this.w.localStorage.getItem(key); }

  data(key, fallback = null) {
    const raw = this.raw(key);
    return raw === null ? fallback : JSON.parse(raw);
  }

  keys() { return Array.from(this.F.store.keys()).sort(); }

  set(key, value) {
    this.F.store.driver().setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  get F() { return this.w.Forja; }

  /* Relógio controlado: Date.now() passa a ser fakeNow quando definido. */
  setNow(ms) {
    this.fakeNow = ms;
    this.w.Date.now = () => this.fakeNow;
  }

  advance(ms) {
    this.setNow(this.fakeNow + ms);
    this.F.workoutTick();
  }

  modalField(id) { return this.$('[data-modal-field="' + id + '"]'); }

  modalAction(id) { this.click('[data-modal-action="' + id + '"]'); }

  async modal(action, fields = {}) {
    await wait(15);
    assert.ok(this.$(".modal-backdrop"), "Modal não abriu");
    Object.entries(fields).forEach(([id, value]) => {
      this.modalField(id).value = value;
    });
    this.modalAction(action);
    await wait(25);
  }

  async importFile(content, filename = "backup.json") {
    const file = new this.w.File(
      [typeof content === "string" ? content : JSON.stringify(content)],
      filename,
      { type: "application/json" }
    );
    const input = this.$("#import-backup-input");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new this.w.Event("change", { bubbles: true }));
    await wait(120);
  }

  /* Navega como um navegador: salva o storage, troca de janela e carrega a nova página. */
  async go(href) {
    const target = new URL(href, this.w.location.href);
    if (target.origin !== new URL(BASE).origin) { this.externalNavigations.push(target.href); return; }
    const local = snapshotStorage(this.w.localStorage);
    const session = snapshotStorage(this.w.sessionStorage);
    const fakeNow = this.fakeNow;
    this.dom.window.close();
    openApps.delete(this);
    await this.load(target.href, { local, session, fakeNow });
  }

  /* Recarrega a página atual com o storage preservado (simula F5). */
  async reload() {
    await this.go(this.w.location.href);
  }

  async load(url, carry = {}) {
    const page = url.replace(BASE, "").replace(/^\/+/, "");
    let relative = page.split(/[?#]/)[0];
    if (!relative || relative.endsWith("/")) relative += "index.html";
    const file = path.join(repoRoot, relative);
    const html = fs.readFileSync(file, "utf8");

    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", error => this.errors.push("jsdomError: " + error.message));
    virtualConsole.on("error", (...args) => this.errors.push("console.error: " + args.join(" ")));
    virtualConsole.on("warn", (...args) => this.errors.push("console.warn: " + args.join(" ")));

    const app = this;
    this.storageWrites = [];
    this.authStorageWrites = [];
    this.allStorageWrites = [];

    this.dom = new JSDOM(html, {
      url,
      runScripts: "dangerously",
      resources: { interceptors: [makeInterceptor(app)] },
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
        installJsdomAuth(window, app.fixture, carry.local, carry.session, app.authOptions);
        window.URL.createObjectURL = () => "blob:forja-test";
        window.URL.revokeObjectURL = () => {};
        window.HTMLAnchorElement.prototype.click = function captureNavigation() {
          if (this.hasAttribute("download")) {
            app.downloads.push({ href: this.getAttribute("href"), download: this.getAttribute("download") });
            return;
          }
          const href = this.href;
          setTimeout(() => app.go(href), 0);
        };

        window.addEventListener("click", event => {
          if (event.defaultPrevented || event.button > 0) return;
          const anchor = event.target && event.target.closest && event.target.closest("a[href]");
          if (!anchor || anchor.hasAttribute("download")) return;
          const raw = anchor.getAttribute("href");
          if (raw.startsWith("#")) return;
          event.preventDefault();
          setTimeout(() => app.go(anchor.href), 0);
        });

        window.AudioContext = undefined;
        window.webkitAudioContext = undefined;

        /* Só observa: registra e repassa ao método original desta janela. */
        const local = window.localStorage;
        ["setItem", "removeItem", "clear"].forEach(method => {
          const original = window.Storage.prototype[method];
          window.Storage.prototype[method] = function recordStorageWrite(...args) {
            if (this === local) {
              const physical = args.length > 0 ? String(args[0]) : null;
              const record = { method, key: physical };
              app.allStorageWrites.push(record);
              if (physical && physical.startsWith(DATA_PREFIX(app.authOptions.uid || USERS.A))) {
                app.storageWrites.push({ method, key: physical.slice(DATA_PREFIX(app.authOptions.uid || USERS.A).length) });
              } else if (physical && physical.startsWith("forja-") && !physical.startsWith("forja-auth-")) {
                app.storageWrites.push(record);
              } else app.authStorageWrites.push(record);
            }
            return original.apply(this, args);
          };
        });
      }
    });

    if (carry.fakeNow !== null && carry.fakeNow !== undefined) {
      this.setNow(carry.fakeNow);
    } else if (this.fakeNow !== null) {
      this.setNow(this.fakeNow);
    }

    this.pageUrl = url;
    openApps.add(this);

    await new Promise(resolve => {
      if (this.d.readyState === "complete") return resolve();
      this.w.addEventListener("load", () => resolve());
      setTimeout(resolve, 3000);
    });
    const loadedDom = this.dom;
    for (let i = 0; i < 300; i += 1) {
      if (this.dom !== loadedDom) break;
      const auth = this.F && this.F.auth;
      const choice = this.$("#auth-legacy-choice");
      if (this.d.documentElement.dataset.forjaAuth === "ready" ||
          (choice && !choice.hidden) ||
          (auth && ["guest", "error"].includes(auth.state)) ||
          this.d.body.dataset.page === "login") break;
      if (this.$("#auth-retry")?.hidden === false) break;
      await delay(10);
    }
    await wait(30);
  }

  close() {
    openApps.delete(this);
    if (this.dom) this.dom.window.close();
  }
}

function snapshotStorage(storage) {
  const out = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    out[key] = storage.getItem(key);
  }
  return out;
}

export async function boot(seed = {}, page = "index.html", options = {}) {
  const app = new App(options);
  const local = {};
  Object.entries(seed).forEach(([key, value]) => {
    local[key] = typeof value === "string" ? value : JSON.stringify(value);
  });
  /*
    A maioria das suítes testa funcionalidades internas, não primeiro acesso.
    Dê a esses cenários um perfil legado concluído; testes de gate passam
    `noProfile: true` explicitamente e exercícios do onboarding usam sua rota.
  */
  const profileKey = "forja-perfil-v1";
  if (!Object.prototype.hasOwnProperty.call(local, profileKey) &&
      options.noProfile !== true && !String(page).startsWith("onboarding/")) {
    local[profileKey] = JSON.stringify({ version: 3, updatedAt: "2026-10-01T00:00:00.000Z",
      objetivo: "manterForma", nivel: "iniciante", equipamento: "casa", diasPorSemana: 3 });
  }
  const uid = options.uid || USERS.A;
  let physical = local;
  if (options.auth !== false) {
    const active = options.authSession || (uid === USERS.A ? app.fixture.defaultSession : app.fixture.issue(uid));
    if (options.legacy) physical = { ...local, [AUTH_STORAGE_KEY]: JSON.stringify(active) };
    else physical = app.fixture.seed(uid, local, { session: active });
  }
  const tab = {};
  for (const [key, value] of Object.entries(options.session || {})) {
    tab[options.legacy || key.startsWith("forja-auth-") ? key : TAB_PREFIX(uid) + key] = value;
  }
  if (options.now !== undefined) app.fakeNow = options.now;
  await app.load(BASE + page, {
    local: physical,
    session: tab,
    fakeNow: options.now === undefined ? null : options.now
  });
  return app;
}

export function closeAllApps() {
  for (const app of Array.from(openApps)) app.close();
}

export function assertNoErrors(app, label = "") {
  const relevant = app.errors.filter(error => !/Could not parse CSS stylesheet/i.test(error));
  assert.deepEqual(
    relevant,
    [],
    "Erros de console" + (label ? " (" + label + ")" : "") + ": " + relevant.join(" | ")
  );
}

export function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + month + "-" + day;
}

export function makeRoutine(modality, name, exercises, id) {
  const sections = { warmup: [], main: [], abs: [], finisher: [] };

  exercises.forEach((exercise, index) => {
    const section = exercise.section || "main";
    sections[section].push({
      id: exercise.id || (id || modality) + "-ex-" + index,
      name: exercise.name,
      sets: exercise.sets || 3,
      type: exercise.type || "reps",
      reps: exercise.reps || "10",
      duration: exercise.duration || 45,
      rest: exercise.rest === undefined ? 0 : exercise.rest,
      load: exercise.load || "",
      notes: exercise.notes || "",
      section
    });
  });

  return {
    id: id || modality + "-routine-" + name.replace(/\s+/g, "-").toLowerCase(),
    name,
    modality,
    createdAt: 1,
    updatedAt: 1,
    sections
  };
}

export function routinesStore(calisthenics = [], weights = []) {
  return { calisthenics, weights };
}
