/*
  FORJA — INSTRUMENTAÇÃO DIAGNÓSTICA TEMPORÁRIA (apenas leitura).
  ------------------------------------------------------------------
  Captura passiva da sequência de eventos do fluxo de autenticação para
  diagnosticar o travamento persistente de "Verificando sua sessão…" no
  Android. NÃO altera lock(), unlock(), gate(), verify(), revalidate(),
  invalidate(), continueBoot(), OAuth, Supabase, RLS ou persistência.

  - Ativada somente por opção explícita: URL ?forja-diag=1,
    window.FORJA_AUTH_DIAG = true (antes deste script) ou botão no painel.
  - Registros só em memória (e no exportador local), com limite de eventos
    e de tamanho. Não envia nada para servidores.
  - NUNCA registra tokens, cookies, senhas, PII ou corpos de requisição.
    Registra apenas booleanos de presença e timestamps.
  - Remover este arquivo e suas chamadas de instrumentação após o diagnóstico.
*/
(function (global) {
  "use strict";
  const DIAG_NS = "forja-auth-diagnostics";
  const MAX_EVENTS = 2000;        // limite de registros mantidos
  const MAX_BYTES = 200000;       // limite aproximado do JSON exportado
  const VERSION = 1;

  let enabled = false;
  let records = [];
  let startTime = Date.now();
  let seq = 0;                    // sequencial único por registro
  let revalidateSeq = 0;          // ID único por execução de revalidate
  let listenerCounts = {};        // contagem de listeners por ponto instrumentado
  let panelBuilt = false;
  let panelPending = false;

  function now() { return Date.now(); }
  function rel() { return now() - startTime; }
  function gateState() {
    try { return global.document.documentElement.dataset.forjaAuth || "(none)"; }
    catch (_) { return "(unavailable)"; }
  }
  function visibilityState() {
    try { return global.document.visibilityState || "(unknown)"; }
    catch (_) { return "(unavailable)"; }
  }
  function hasFocus() {
    try { return global.document.hasFocus ? global.document.hasFocus() : null; }
    catch (_) { return null; }
  }
  function safeError(error) {
    if (!error) return null;
    const out = { name: String(error.name || "Error") };
    if (error.status !== undefined && error.status !== null) out.status = error.status;
    if (error.code && typeof error.code === "string") out.code = error.code;
    if (error.stale) out.stale = true;
    if (error.loginRequired) out.loginRequired = true;
    return out;
  }

  // Tamanho em BYTES UTF-8 do texto (não caracteres UTF-16). O limite
  // MAX_BYTES é em bytes; medir caracteres permitiria que a exportação
  // ultrapassasse o limite com acentos/emojis/CJK. TextEncoder é o método
  // correto no ambiente browser; o fallback cobre ambientes sem ele.
  function utf8Bytes(text) {
    try {
      if (global.TextEncoder) return new global.TextEncoder().encode(text).length;
    } catch (_) { /* TextEncoder indisponível: usa o fallback abaixo */ }
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xD800 && code <= 0xDBFF) { bytes += 4; index += 1; }
      else bytes += 3;
    }
    return bytes;
  }

  // Serialização de referência: exatamente a mesma usada em toJSON() (com
  // indentação e envelope), mas medida em BYTES UTF-8, para que o limite
  // reflita o tamanho real do JSON efetivo exportado.
  function serializedSize() {
    try { return utf8Bytes(JSON.stringify(buildExport(), null, 2)); }
    catch (_) { return Number.MAX_SAFE_INTEGER; }
  }

  function trim() {
    // Limite de eventos: descarta os mais antigos.
    while (records.length > MAX_EVENTS) records.shift();
    // Limite de tamanho: mede o JSON com a mesma formatação do export e
    // descarta os registros mais antigos (shift) até caber. Um registro único
    // que exceda sozinho o limite também é descartado, garantindo que o
    // JSON exportado nunca ultrapasse MAX_BYTES.
    try {
      while (records.length > 0 && serializedSize() > MAX_BYTES) {
        records.shift();
      }
    } catch (_) {
      while (records.length > 1) records.shift();
    }
  }

  function record(event, data) {
    if (!enabled) return;
    const base = {
      seq: ++seq,
      t: now(),
      rel: rel(),
      event: String(event),
      vis: visibilityState(),
      focus: hasFocus(),
      gateBefore: undefined,
      gateAfter: undefined
    };
    const before = gateState();
    const payload = Object.assign({}, data || {});
    // O valor de "gate" nos dados extras (quando presente) refere-se a um
    // estado observado, não ao antes/depois do registro em si.
    base.gateBefore = before;
    const rec = Object.assign(base, payload);
    if (rec.gateAfter === undefined) rec.gateAfter = gateState();
    records.push(rec);
    trim();
    return rec;
  }

  function nextRevalidateId() { return ++revalidateSeq; }

  function noteListener(where) {
    listenerCounts[where] = (listenerCounts[where] || 0) + 1;
    return listenerCounts[where];
  }

  function isEnabled() { return enabled; }
  function count() { return records.length; }
  function listenerSummary() { return Object.assign({}, listenerCounts); }

  function enable() {
    if (enabled) return;
    enabled = true;
    startTime = now();
    seq = 0;
    records = [];
    record("diag:enable", { note: "captura iniciada" });
    ensurePanel();
  }
  function disable() {
    if (!enabled) return;
    enabled = false;
    record("diag:disable", { note: "captura encerrada" });
    ensurePanel();
  }
  function clear() {
    records = [];
    seq = 0;
    record("diag:clear", { note: "registros limpos" });
  }
  // Objeto completo exportado. Usado tanto por toJSON() quanto pelo limite de
  // tamanho, para medir exatamente o JSON efetivo (com envelope).
  function buildExport() {
    return {
      version: VERSION,
      diagnostics: "forja-auth-diagnostics",
      enabled: enabled,
      capturedAt: now(),
      relativeStartMs: 0,
      eventCount: records.length,
      listeners: listenerSummary(),
      records: records
    };
  }
  function toJSON() {
    return JSON.stringify(buildExport(), null, 2);
  }
  function copy() {
    const text = toJSON();
    try {
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        return global.navigator.clipboard.writeText(text).then(() => true).catch(() => false);
      }
    } catch (_) { /* sem clipboard */ }
    return Promise.resolve(false);
  }
  function download() {
    try {
      const text = toJSON();
      const blob = new global.Blob([text], { type: "application/json" });
      const url = global.URL.createObjectURL(blob);
      const anchor = global.document.createElement("a");
      anchor.href = url;
      anchor.download = "forja-auth-diagnostics.json";
      global.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
      return true;
    } catch (_) { return false; }
  }

  /* Painel temporário. O botão flutuante e o painel usam !important inline
     para permanecerem visíveis tanto no bloqueio quanto no estado ready,
      sem depender do CSS do gate. */
  function ensurePanel() {
    if (panelBuilt) return;
    const doc = global.document;
    if (!doc) return;
    // O script pode rodar no <head> antes do <body> existir: aguarda o body
    // e monta o painel assim que possível (o botão deve estar visível no
    // bloqueio, que ocorre logo após a parse).
    if (!doc.body) {
      panelPending = true;
      if (typeof doc.addEventListener === "function") {
        doc.addEventListener("DOMContentLoaded", mountPanel, { once: true, passive: true });
      }
      return;
    }
    mountPanel();
  }

  function mountPanel() {
    if (panelBuilt) return;
    const doc = global.document;
    if (!doc || !doc.body) return;
    panelBuilt = true;

    const style = doc.createElement("style");
    style.id = "forja-diag-style";
    style.textContent = [
      "#forja-diag-fab{position:fixed;z-index:2147483647;right:12px;top:12px;",
      "width:44px;height:44px;border-radius:50%;border:none;cursor:pointer;",
      "background:#0c0c0c;color:#ffd76a;font-size:18px;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,.4);",
      "display:flex;align-items:center;justify-content:center;font-family:inherit;}",
      "#forja-diag-fab:focus-visible{outline:2px solid #ffd76a;outline-offset:2px;}",
      "#forja-diag-panel{position:fixed;z-index:2147483647;right:12px;top:64px;width:min(340px,calc(100vw - 24px));",
      "max-height:70vh;overflow:auto;background:#141414;color:#e8e6e1;border:1px solid #333;border-radius:10px;",
      "padding:14px;font-family:inherit;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.5);}",
      "#forja-diag-panel h2{font-size:14px;margin:0 0 8px;color:#ffd76a;}",
      "#forja-diag-panel .forja-diag-row{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;}",
      "#forja-diag-panel button{flex:1 1 auto;min-width:90px;padding:7px 8px;border-radius:6px;border:1px solid #444;",
      "background:#1e1e1e;color:#e8e6e1;cursor:pointer;font-family:inherit;font-size:12px;}",
      "#forja-diag-panel button.primary{background:#ffd76a;color:#101010;border-color:#ffd76a;}",
      "#forja-diag-panel .forja-diag-stat{color:#9a9a92;margin:4px 0;word-break:break-all;}",
      "#forja-diag-panel .forja-diag-help{color:#7a7a72;font-size:11px;line-height:1.4;margin-top:8px;}"
    ].join("");
    (doc.head || doc.documentElement).appendChild(style);

    const fab = doc.createElement("button");
    fab.id = "forja-diag-fab";
    fab.type = "button";
    fab.textContent = "🩺";
    fab.title = "Diagnóstico de autenticação FORJA (temporário)";
    fab.setAttribute("aria-label", "Diagnóstico de autenticação FORJA");
    fab.addEventListener("click", () => {
      const panel = doc.getElementById("forja-diag-panel");
      if (panel) { panel.hidden = !panel.hidden; return; }
      buildPanel();
    });
    // !important inline para ser visível mesmo sob o gate CSS (bloqueio/ready).
    fab.setAttribute("style", "display:flex !important;");
    doc.body.appendChild(fab);

    function buildPanel() {
      const existing = doc.getElementById("forja-diag-panel");
      if (existing) { existing.hidden = false; refreshPanel(); return; }
      const panel = doc.createElement("div");
      panel.id = "forja-diag-panel";
      panel.hidden = false;
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Diagnóstico de autenticação");
      panel.setAttribute("style", "display:block !important;");
      panel.innerHTML = [
        "<h2>Diagnóstico de autenticação</h2>",
        "<div class=\"forja-diag-stat\" id=\"forja-diag-status\"></div>",
        "<div class=\"forja-diag-stat\" id=\"forja-diag-count\"></div>",
        "<div class=\"forja-diag-row\">",
        "  <button type=\"button\" id=\"forja-diag-start\" class=\"primary\">Iniciar captura</button>",
        "  <button type=\"button\" id=\"forja-diag-stop\">Parar</button>",
        "</div>",
        "<div class=\"forja-diag-row\">",
        "  <button type=\"button\" id=\"forja-diag-export\">Exportar JSON</button>",
        "  <button type=\"button\" id=\"forja-diag-copy\">Copiar</button>",
        "</div>",
        "<div class=\"forja-diag-row\">",
        "  <button type=\"button\" id=\"forja-diag-clear\">Limpar</button>",
        "</div>",
        "<div class=\"forja-diag-help\">",
        "Uso: iniciar a captura, usar o FORJA, coloca-lo em segundo plano e retornar.",
        "Se a tela \"Verificando sua sessão…\" permanecer, exporte os registros sem recarregar.",
        "Nenhum token, cookie ou dado pessoal é registrado. Dados somente locais.",
        "</div>"
      ].join("");
      doc.body.appendChild(panel);

      doc.getElementById("forja-diag-start").addEventListener("click", enable);
      doc.getElementById("forja-diag-stop").addEventListener("click", disable);
      doc.getElementById("forja-diag-clear").addEventListener("click", clear);
      doc.getElementById("forja-diag-export").addEventListener("click", () => { download(); });
      doc.getElementById("forja-diag-copy").addEventListener("click", () => { copy().then(ok => { if (ok) refreshPanel(); }); });
      refreshPanel();
    }

    function refreshPanel() {
      const status = doc.getElementById("forja-diag-status");
      const count = doc.getElementById("forja-diag-count");
      if (status) status.textContent = enabled ? "Captura ATIVO" : "Captura pausado";
      if (count) count.textContent = "Eventos registrados: " + records.length;
    }

    // Reatualiza o painel quando a contagem muda (sem interferir no fluxo).
    global.setInterval(() => { if (panelBuilt) refreshPanel(); }, 1000);
  }

  /* Ativação explícita via URL ?forja-diag=1 ou flag global prévia. */
  function autoEnable() {
    try {
      if (global.FORJA_AUTH_DIAG === true) { enable(); return; }
      const url = new global.URL(global.location.href);
      if (url.searchParams.get("forja-diag") === "1" || url.hash === "#forja-diag") { enable(); return; }
    } catch (_) { /* ambiente sem URL */ }
  }

  global.ForjaDiagnostics = {
    record, nextRevalidateId, noteListener,
    safeError,
    enable, disable, clear, isEnabled, count, listenerSummary,
    toJSON, copy, download, ensurePanel
  };

  // Eventos de lifecycle do navegador (quando suportados). Apenas registram
  // quando a captura está ativa; não alteram o comportamento do app.
  function captureLifecycle() {
    const targets = [global, global.document];
    const events = ["freeze", "resume", "focus", "blur"];
    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") continue;
      for (const name of events) {
        target.addEventListener(name, () => {
          if (enabled) record("diag:lifecycle:" + name, {});
        }, { passive: true, capture: true });
      }
    }
  }

  // O painel/botão é montado independentemente da captura, para que o
  // botão "Exportar diagnóstico" esteja disponível na tela de bloqueio
  // mesmo antes de iniciada a captura.
  ensurePanel();
  autoEnable();
  captureLifecycle();
})(window);
