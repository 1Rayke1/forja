/*
  Harness do FORJA para testes em jsdom com páginas multipágina.

  - Serve os arquivos reais do repositório sob https://forja.test/forja/,
    como o GitHub Pages serve https://usuario.github.io/forja/.
  - Cada página é carregada em uma nova janela jsdom. O localStorage e o
    sessionStorage são copiados para a janela seguinte, como um navegador faria.
  - Cliques em links (inclusive F.navigate, que chama anchor.click()) trocam de
    página. Links de download são capturados em app.downloads.
*/
import jsdomPkg from "jsdom";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { JSDOM, VirtualConsole, requestInterceptor } = jsdomPkg;

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..");
export const BASE = "https://forja.test/forja/";

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const interceptor = requestInterceptor(async request => {
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
});

const openApps = new Set();

export class App {
  constructor() {
    this.errors = [];
    this.downloads = [];
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

  raw(key) { return this.w.localStorage.getItem(key); }

  data(key, fallback = null) {
    const raw = this.raw(key);
    return raw === null ? fallback : JSON.parse(raw);
  }

  keys() {
    const list = [];
    for (let index = 0; index < this.w.localStorage.length; index++) {
      list.push(this.w.localStorage.key(index));
    }
    return list.sort();
  }

  set(key, value) {
    this.w.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
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
    const file = path.join(repoRoot, page.split(/[?#]/)[0]);
    const html = fs.readFileSync(file, "utf8");

    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", error => this.errors.push("jsdomError: " + error.message));
    virtualConsole.on("error", (...args) => this.errors.push("console.error: " + args.join(" ")));
    virtualConsole.on("warn", (...args) => this.errors.push("console.warn: " + args.join(" ")));

    const app = this;

    this.dom = new JSDOM(html, {
      url,
      runScripts: "dangerously",
      resources: { interceptors: [interceptor] },
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
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

        if (carry.local) {
          Object.entries(carry.local).forEach(([key, value]) => window.localStorage.setItem(key, value));
        }
        if (carry.session) {
          Object.entries(carry.session).forEach(([key, value]) => window.sessionStorage.setItem(key, value));
        }
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
  const app = new App();
  const local = {};
  Object.entries(seed).forEach(([key, value]) => {
    local[key] = typeof value === "string" ? value : JSON.stringify(value);
  });
  if (options.now !== undefined) app.fakeNow = options.now;
  await app.load(BASE + page, {
    local,
    session: options.session || null,
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
