/*
  Auth Google/PKCE pelo SDK OFICIAL do Supabase. Nada de Auth REST artesanal,
  sessão de produção simulada, email/senha ou entrada anônima.
  getSession cuida do refresh; só getUser(access_token) autoriza a interface.
  Segurança remota: JWT do usuário + RLS existente, nunca o guard do navegador.
*/
(function (global) {
  "use strict";
  const F = global.Forja;
  const doc = global.document;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const NEXT = "forja-auth-return-v1";
  const ATTEMPT = "forja-auth-oauth-v1";
  const LOGOUT = "forja-auth-logout-v1";
  const SIGNED_OUT = "forja-auth-signed-out-v1";
  const RETURN_TTL = 30 * 60 * 1000;
  const routes = new Set([
    "index.html", "onboarding/index.html", "treino/index.html", "treino/calistenia.html",
    "treino/musculacao.html", "treino/biblioteca.html", "treino/grupo.html", "treino/rotina.html",
    "treino/executar.html", "progresso/index.html", "explorar/index.html", "explorar/atlas.html",
    "exercicio/index.html", "configuracoes/index.html", "admin/exercicios.html"
  ]);
  let client = null, storageKey = "", session = null, user = null, verifiedToken = "";
  let state = "idle", revision = 0, work = null, initWork = null, disabled = false;
  let dataUid = null, expiryTimer = null, validationTimer = null, needsDataRefresh = false;

  function rootUrl() {
    return new URL((doc.body && doc.body.getAttribute("data-root")) || "./", global.location.href);
  }
  function isLogin() { return doc.body && doc.body.dataset.page === "login"; }
  function safeReturn(input) {
    try {
      const root = rootUrl();
      if (typeof input !== "string" || !input || /[\\\u0000-\u001f]/.test(input)) return null;
      const url = new URL(input, root);
      if (url.origin !== root.origin || url.username || url.password || !url.pathname.startsWith(root.pathname)) return null;
      let rel = url.pathname.slice(root.pathname.length);
      if (!rel || rel.endsWith("/")) rel += "index.html";
      if (!routes.has(rel)) return null;
      for (const key of ["code", "state", "access_token", "refresh_token", "error", "error_description", "token_type"]) url.searchParams.delete(key);
      if (/(?:access_token|refresh_token|error_description)=/i.test(url.hash)) url.hash = "";
      return rel + url.search + url.hash;
    } catch (_) { return null; }
  }
  function readTab(key) {
    const raw = global.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }
  function setReturn(target) {
    global.sessionStorage.setItem(NEXT, JSON.stringify({ target: safeReturn(target) || "index.html", at: Date.now() }));
  }
  function returnTarget() {
    try {
      const next = readTab(NEXT);
      if (next && Number.isFinite(next.at) && Date.now() >= next.at && Date.now() - next.at < RETURN_TTL) {
        return safeReturn(next.target) || "index.html";
      }
    } catch (_) { /* Destino inválido/ilegível: Home, nunca URL externa. */ }
    return "index.html";
  }
  function clearReturn() { try { global.sessionStorage.removeItem(NEXT); } catch (_) { /* opcional */ } }
  function resumeUrl(consume) {
    const next = returnTarget();
    const target = new URL(consume && next.split(/[?#]/)[0] === "onboarding/index.html" ? "index.html" : next, rootUrl()).href;
    if (consume) clearReturn();
    return target;
  }
  function emit(nextState) {
    state = nextState;
    global.dispatchEvent(new global.CustomEvent("forja:auth", { detail: { state, userId: user ? user.id : null } }));
  }
  function gate(message, retry) {
    doc.documentElement.dataset.forjaAuth = "locked";
    const text = doc.getElementById("auth-gate-status");
    if (text && message) text.textContent = message;
    const button = doc.getElementById("auth-retry");
    if (button) button.hidden = !retry;
  }
  function storedToken() {
    if (!storageKey) return null;
    const raw = global.localStorage.getItem(storageKey);
    if (!raw) return null;
    try { return JSON.parse(raw).access_token || null; } catch (_) { return null; }
  }
  function isVerified(uid) {
    try {
      return !disabled && state === "authenticated" && Boolean(user && session && verifiedToken) &&
        (!uid || user.id === uid) && session.expires_at * 1000 > Date.now() &&
        storedToken() === verifiedToken && !global.localStorage.getItem(LOGOUT);
    } catch (_) { return false; }
  }
  function unlock(uid) {
    if (!isVerified(uid)) { gate("Sua sessão precisa ser verificada novamente.", true); return false; }
    dataUid = uid;
    doc.documentElement.dataset.forjaAuth = "ready";
    return true;
  }
  function loginUrl() {
    const url = new URL("login.html", rootUrl());
    const next = safeReturn(global.location.href);
    if (next) url.searchParams.set("next", next);
    return url.href;
  }
  function goLogin() {
    gate("Entre com sua conta Google para continuar.", false);
    if (!isLogin()) F.navigate(loginUrl());
  }
  function stale() { const error = new Error("Sessão alterada durante a verificação."); error.stale = true; return error; }
  function invalidate() {
    if (dataUid) needsDataRefresh = true;
    revision += 1;
    user = null;
    verifiedToken = "";
    global.clearTimeout(expiryTimer);
    gate("Verificando sua sessão…", false);
  }
  function scheduleValidation() {
    global.clearTimeout(validationTimer);
    if (!disabled) validationTimer = global.setTimeout(() => { void revalidate(); }, 0);
  }
  function config() {
    const cfg = global.FORJA_PUBLIC_CONFIG || {};
    let url;
    try { url = new URL(cfg.url); } catch (_) { throw new Error("Configuração pública do Supabase ausente. Avise o responsável pelo site."); }
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("A URL pública do Supabase é inválida.");
    }
    const key = String(cfg.anonKey || "").trim();
    let allowed = /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key);
    if (!allowed && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
      try {
        const payload = JSON.parse(global.atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        allowed = payload.role === "anon" && (!payload.ref || payload.ref === url.hostname.split(".")[0]);
      } catch (_) { /* não é chave pública anon */ }
    }
    if (!allowed || /sb_secret_|service_role/i.test(key)) throw new Error("A chave pública de autenticação não foi configurada corretamente.");
    return { url: url.origin, key, ref: url.hostname.split(".")[0] };
  }
  async function boundedFetch(input, options) {
    const controller = new global.AbortController();
    const original = options && options.signal;
    const abort = () => controller.abort();
    if (original) {
      if (original.aborted) controller.abort();
      else original.addEventListener("abort", abort, { once: true });
    }
    const timer = global.setTimeout(abort, 12000);
    try { return await global.fetch(input, Object.assign({}, options, { signal: controller.signal })); }
    finally { global.clearTimeout(timer); if (original) original.removeEventListener("abort", abort); }
  }
  function sdk() {
    if (client) return client;
    const cfg = config();
    if (!global.supabase || !global.supabase.createClient) throw new Error("Não foi possível carregar o SDK de autenticação. Recarregue a página.");
    storageKey = "sb-" + cfg.ref + "-auth-token";
    client = global.supabase.createClient(cfg.url, cfg.key, {
      auth: { flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey },
      global: { fetch: boundedFetch }
    });
    // Nunca aguardar chamadas do SDK dentro do callback: ele roda sob lock do Auth.
    client.auth.onAuthStateChange((event, next) => {
      if (disabled || event === "INITIAL_SESSION") return;
      if (event === "SIGNED_OUT") {
        invalidate(); session = null; emit("guest"); goLogin();
      } else if (next && next.access_token !== verifiedToken) {
        invalidate(); emit("validating"); scheduleValidation();
      }
    });
    return client;
  }
  function armExpiry() {
    global.clearTimeout(expiryTimer);
    if (!session || disabled) return;
    const delay = Math.max(0, Math.min(60000, session.expires_at * 1000 - Date.now()));
    expiryTimer = global.setTimeout(() => {
      if (!isVerified()) { invalidate(); emit("validating"); scheduleValidation(); }
      else armExpiry();
    }, delay);
  }
  async function verify() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (disabled) return null;
      try {
        const api = sdk();
        const result = await api.auth.getSession();
        if (result.error) throw result.error;
        const candidate = result.data.session;
        if (!candidate) { invalidate(); session = null; emit("guest"); goLogin(); return null; }
        const observed = revision;
        const response = await api.auth.getUser(candidate.access_token);
        if (disabled) return null;
        if (observed !== revision || storedToken() !== candidate.access_token) throw stale();
        if (response.error) throw response.error;
        const actual = response.data.user;
        if (!actual || !UUID.test(actual.id) || actual.id !== candidate.user.id || actual.is_anonymous === true ||
            !actual.app_metadata || actual.app_metadata.provider !== "google") {
          throw new Error("Esta instalação aceita somente contas Google verificadas.");
        }
        if (!Number.isFinite(candidate.expires_at) || candidate.expires_at * 1000 <= Date.now()) throw new Error("Sua sessão expirou. Entre novamente com Google.");
        const oldDataUid = dataUid;
        session = candidate; user = actual; verifiedToken = candidate.access_token;
        // SIGNED_IN da recuperação inicial pode ter agendado uma validação
        // redundante. Não deixar esse timer apagar um erro de vínculo local.
        global.clearTimeout(validationTimer);
        emit("authenticated"); armExpiry();
        if (oldDataUid) {
          if (oldDataUid === actual.id && (!F.authData || F.authData.isBound(actual.id))) {
            if (needsDataRefresh && F.authData && typeof F.syncStateFromStorage === "function") {
              // Só leitura e mesmos eventos lógicos já usados pelas telas: o
              // editor preserva seu rascunho e detecta conflitos no salvamento.
              F.syncStateFromStorage(null);
              for (const key of new Set(Object.values(F.KEYS))) global.dispatchEvent(new global.StorageEvent("storage", { key }));
            }
            needsDataRefresh = false;
            unlock(actual.id);
          }
          else if (!isLogin()) F.navigate(global.location.href);
        }
        return actual;
      } catch (error) {
        if (error.stale && attempt < 2) continue;
        if (disabled) return null;
        invalidate(); emit("error");
        gate(error.stale ? "A conta mudou. Recarregue para continuar com segurança." :
          "Não foi possível validar sua sessão. Confira a conexão e tente novamente; seus dados continuam preservados.", true);
        return null;
      }
    }
    return null;
  }
  function revalidate() {
    if (disabled) return Promise.resolve(null);
    if (work) return work;
    gate("Verificando sua sessão…", false);
    work = verify().finally(() => { work = null; });
    return work;
  }
  function cleanCallback(url) {
    for (const key of ["code", "state", "error", "error_code", "error_description", "access_token", "refresh_token", "token_type", "expires_in", "expires_at"]) url.searchParams.delete(key);
    if (/(?:access_token|refresh_token|error|code)=/i.test(url.hash)) url.hash = "";
    global.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  async function init() {
    if (initWork) return initWork;
    initWork = (async () => {
      try {
        sdk();
        const url = new URL(global.location.href);
        const code = url.searchParams.get("code");
        const failure = url.searchParams.has("error") || /(?:^#|&)(?:error|access_token|refresh_token)=/.test(url.hash);
        if (code || failure) {
          cleanCallback(url);
          const pending = readTab(ATTEMPT);
          global.sessionStorage.removeItem(ATTEMPT);
          if (failure) throw new Error("Login cancelado ou não autorizado. Você pode tentar novamente com Google.");
          if (!isLogin() || !pending || !Number.isFinite(pending.at) || Date.now() < pending.at || Date.now() - pending.at > 10 * 60 * 1000) {
            throw new Error("Este retorno de login expirou ou foi aberto em outra aba. Inicie o login novamente.");
          }
          setReturn(pending.target);
          const exchanged = await client.auth.exchangeCodeForSession(code);
          if (exchanged.error) throw new Error("Não foi possível concluir o login. Inicie uma nova tentativa na mesma aba.");
        } else if (isLogin() && url.searchParams.has("next")) setReturn(url.searchParams.get("next"));
        if (global.sessionStorage.getItem(SIGNED_OUT) || global.localStorage.getItem(LOGOUT)) {
          disabled = true; emit("guest"); goLogin(); return null;
        }
        return await revalidate();
      } catch (error) {
        invalidate(); emit("error");
        const message = String(error.message || "Não foi possível iniciar a autenticação.");
        gate(message, false);
        const status = doc.getElementById("login-status");
        if (status) status.textContent = message;
        return null;
      }
    })();
    return initWork;
  }
  async function startGoogle() {
    const api = sdk();
    disabled = false;
    global.sessionStorage.removeItem(SIGNED_OUT);
    global.localStorage.removeItem(LOGOUT);
    const target = returnTarget();
    const pending = JSON.stringify({ at: Date.now(), target });
    global.sessionStorage.setItem(ATTEMPT, pending);
    if (global.sessionStorage.getItem(ATTEMPT) !== pending) throw new Error("O navegador não permitiu guardar a tentativa de login. Habilite o armazenamento e tente novamente.");
    const result = await api.auth.signInWithOAuth({ provider: "google", options: {
      redirectTo: new URL("login.html", rootUrl()).href,
      queryParams: { prompt: "select_account" }, skipBrowserRedirect: true
    } });
    if (result.error || !result.data.url) {
      global.sessionStorage.removeItem(ATTEMPT);
      throw new Error("Não foi possível abrir o Google. Confira a conexão e tente novamente.");
    }
    const targetUrl = new URL(result.data.url);
    const project = new URL((global.FORJA_PUBLIC_CONFIG || {}).url);
    if (targetUrl.origin !== project.origin || targetUrl.pathname !== "/auth/v1/authorize") throw new Error("Endereço de autenticação inesperado.");
    F.navigate(targetUrl.href);
  }
  async function signOut() {
    const originalToken = verifiedToken;
    disabled = true; invalidate(); emit("guest");
    gate("Encerrando sua sessão…", false);
    try { global.sessionStorage.setItem(SIGNED_OUT, "1"); } catch (_) { /* chave removida abaixo */ }
    try { global.localStorage.setItem(LOGOUT, String(Date.now()) + ":" + Math.random().toString(36).slice(2)); } catch (_) { /* gate já fechado */ }
    clearReturn();
    try {
      if (client) { client.auth.stopAutoRefresh(); await client.auth.signOut({ scope: "local" }); }
    } catch (_) { /* Revogação remota é best effort se estiver offline. */ }
    finally {
      try {
        // Não apaga uma sessão nova que outra aba já tenha iniciado.
        if (!originalToken || storedToken() === originalToken) global.localStorage.removeItem(storageKey);
        global.localStorage.removeItem(storageKey + "-code-verifier");
        global.sessionStorage.removeItem(ATTEMPT);
      } catch (_) {
        gate("A sessão foi bloqueada, mas o navegador recusou remover o acesso salvo. Feche as abas e limpe apenas a sessão do site antes de entrar novamente.", false);
        return;
      }
      session = null; user = null; dataUid = null;
      F.navigate(new URL("login.html", rootUrl()).href);
    }
  }
  F.auth = Object.freeze({
    init, revalidate, startGoogle, signOut, isVerified, unlock, gate, safeReturn, resumeUrl, handleStorage,
    clearReturn, setReturn, loginUrl,
    get client() { return sdk(); },
    get storageKey() { return storageKey; },
    get user() { return isVerified() ? user : null; },
    get revision() { return revision; },
    get state() { return state; },
    canWrite() { return Boolean(dataUid && isVerified(dataUid) && (!F.authData || F.authData.isBound(dataUid))); },
    requireAuth() { if (!isVerified()) { gate("Sua sessão precisa ser validada para continuar.", true); return false; } return true; }
  });
  function handleStorage(event) {
    if (event.key === LOGOUT && event.newValue !== null) {
      disabled = true; invalidate(); emit("guest");
      try { global.sessionStorage.setItem(SIGNED_OUT, "1"); } catch (_) { /* gate fechado */ }
      goLogin();
    } else if (event.key === null || (storageKey && event.key === storageKey)) {
      invalidate(); emit("validating"); scheduleValidation();
    }
  }
  global.addEventListener("storage", handleStorage);
  doc.addEventListener("visibilitychange", () => {
    if (!doc.hidden && !disabled && dataUid) { gate("Verificando sua sessão…", false); void revalidate(); }
  });
  doc.addEventListener("click", event => {
    if (event.target.closest && event.target.closest("#auth-retry")) {
      if (typeof F.retryBoot === "function") void F.retryBoot(); else void revalidate();
    }
  });
})(window);
