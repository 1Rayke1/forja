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
  const OAUTH_CURRENT = "forja-auth-oauth-current-v1";
  const RETURN_TTL = 30 * 60 * 1000;
  const SESSION_ERRORS = new Set([
    "bad_jwt", "session_expired", "session_not_found", "user_not_found", "user_banned",
    "refresh_token_not_found", "refresh_token_already_used"
  ]);
  const routes = new Set([
    "index.html", "onboarding/index.html", "treino/index.html", "treino/calistenia.html",
    "treino/musculacao.html", "treino/biblioteca.html", "treino/grupo.html", "treino/rotina.html",
    "treino/executar.html", "progresso/index.html", "explorar/index.html", "explorar/atlas.html",
    "exercicio/index.html", "configuracoes/index.html", "admin/exercicios.html"
  ]);
  let client = null, verifier = null, storageKey = "", session = null, user = null, verifiedToken = "";
  let state = "idle", revision = 0, work = null, initWork = null, disabled = false;
  let dataUid = null, expiryTimer = null, validationTimer = null, needsDataRefresh = false;
  let epoch = 0, lifetime = new global.AbortController();
  let pkceWork = null, logoutContext = null, logoutPending = false, logoutChannel = null;
  let refreshCommit = null, oauthIntent = null;
  const requests = new Set(), retiredLogins = new Set();

  // Ponto de extensão PÚBLICO do SDK: os valores de sessão são gravados
  // integralmente pelo fornecedor, sem criação/rotação de tokens pelo app.
  // O lock é curto (somente storage), nunca fica preso a uma chamada HTTP.
  function mutateSession(action, required = false) {
    if (global.navigator?.locks?.request) return global.navigator.locks.request("forja:auth:" + storageKey, { mode: "exclusive" }, action);
    if (required) return Promise.reject(new Error("Este navegador não oferece o armazenamento coordenado necessário. Atualize o navegador para entrar com segurança."));
    try { return Promise.resolve(action()); } catch (error) { return Promise.reject(error); }
  }
  function sharedPkceKey(key) {
    return key === storageKey + "-code-verifier" || key === storageKey + "-flows-code-verifier";
  }
  function sdkStorage() {
    function pkceMutation(key, value, remove) {
      const job = pkceWork, observed = job?.reads.get(key), hasSnapshot = Boolean(job?.reads.has(key));
      return mutateSession(() => {
        // O SDK pode aguardar entre comparar o verifier legado e removê-lo.
        // CAS de bytes opacos fecha essa janela, sem reimplementar PKCE nem
        // apagar o verifier/índice que outro fluxo acabou de escrever.
        if (hasSnapshot && global.localStorage.getItem(key) !== observed) return;
        if (remove) global.localStorage.removeItem(key); else global.localStorage.setItem(key, value);
        if (job) job.reads.set(key, remove ? null : value);
      }, Boolean(job));
    }
    return {
      getItem(key) {
        const value = global.localStorage.getItem(key);
        if (pkceWork && sharedPkceKey(key)) pkceWork.reads.set(key, value);
        return value;
      },
      setItem(key, value) {
        if (sharedPkceKey(key)) return pkceMutation(key, value, false);
        if (key !== storageKey) return global.localStorage.setItem(key, value);
        // O ticket de refresh nasce ANTES do HTTP, não depois de obter o
        // lock. A correlação usa só o token opaco devolvido ao SDK oficial;
        // não criamos/renovamos tokens nem implementamos outro Auth.
        const candidate = JSON.parse(value);
        const refresh = refreshCommit?.token === candidate.access_token ? refreshCommit : null;
        const job = refresh || pkceWork || { generation: epoch, expected: global.localStorage.getItem(key) };
        return mutateSession(() => {
          assertSessionMutation(job);
          if (refresh) {
            const before = loginIdentity(refresh.original), after = loginIdentity(candidate);
            if (before.userId !== after.userId || (before.sessionId && after.sessionId && before.sessionId !== after.sessionId)) throw stale();
          }
          if (retiredLogin(candidate)) throw stale();
          global.localStorage.setItem(key, value);
          job.expected = value;
          if (oauthIntent) {
            const next = loginIdentity(candidate), previous = oauthIntent.previous;
            // Também cobre exchange oficial concluído no mesmo documento.
            // Um SIGNED_IN/recovery da sessão anterior NÃO conclui a intenção;
            // nem uma rotação, que carrega seu ticket próprio de refresh.
            const acquired = !refresh && !job.intent && global.localStorage.getItem(OAUTH_CURRENT) === oauthIntent.id &&
              (next.userId !== previous?.userId || (next.sessionId && next.sessionId !== previous?.sessionId));
            if (job.intent === oauthIntent.id || acquired) oauthIntent.sessionIdentity = next;
          }
        }, true);
      },
      removeItem(key) {
        if (sharedPkceKey(key)) return pkceMutation(key, null, true);
        if (key !== storageKey) return global.localStorage.removeItem(key);
        // O erro de refresh também pode iniciar cleanup no SDK. Sua permissão
        // continua vinculada ao snapshot A, nunca ao B encontrado mais tarde.
        const refresh = refreshCommit?.failed ? refreshCommit : null;
        const job = refresh || pkceWork || { generation: epoch, expected: global.localStorage.getItem(key) };
        return mutateSession(() => {
          assertSessionMutation(job);
          global.localStorage.removeItem(key);
          job.expected = null;
        }, true);
      }
    };
  }
  function assertSessionMutation(job) {
    if (disabled) throw aborted();
    // Não há await entre esta revalidação DENTRO do Web Lock e a mutação.
    // Serializar a fila não torna válido um resultado de outra geração.
    if (job.cancelled || job.generation !== epoch || global.localStorage.getItem(storageKey) !== job.expected ||
        (job.intent && global.localStorage.getItem(OAUTH_CURRENT) !== job.intent)) {
      job.cancelled = true; throw stale();
    }
  }
  function storedSession() {
    const raw = storageKey ? global.localStorage.getItem(storageKey) : null;
    try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
  }
  function loginIdentity(candidate) {
    // session_id é só um identificador de geração para NÃO encerrar outra
    // sessão. Decodificá-lo NÃO verifica assinatura nem concede autorização;
    // somente getUser continua autorizando o app. Tokens permanecem opacos
    // para criação, persistência, renovação e revogação, todas a cargo do SDK.
    try {
      const claims = JSON.parse(global.atob(candidate.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (claims.sub === candidate.user.id && UUID.test(claims.session_id)) return { userId: claims.sub, sessionId: claims.session_id };
    } catch (_) { /* Sem identificador, somente igualdade exata de token. */ }
    return { userId: candidate?.user?.id || null, sessionId: null };
  }
  function sameLogin(candidate, original) {
    if (!candidate || !original || candidate.user?.id !== original.user?.id) return false;
    if (candidate.access_token === original.access_token) return true;
    const a = loginIdentity(candidate), b = loginIdentity(original);
    return Boolean(a.sessionId && a.sessionId === b.sessionId && a.userId === b.userId);
  }
  function markerApplies(marker, active) {
    if (UUID.test(marker?.userId) && UUID.test(active?.user?.id)) {
      if (marker.userId !== active.user.id) return false;
      const identity = loginIdentity(active);
      if (UUID.test(marker.sessionId) && identity.sessionId && marker.sessionId !== identity.sessionId) return false;
    }
    return true;
  }
  function retiredLogin(candidate) {
    const identity = loginIdentity(candidate);
    return Boolean(identity.sessionId && retiredLogins.has(identity.userId + ":" + identity.sessionId));
  }
  function receiveLogout(marker, fromStorage = false) {
    const qualified = UUID.test(marker?.userId) && UUID.test(marker?.sessionId) && UUID.test(marker?.nonce) && Number.isFinite(marker?.at);
    // UID sozinho não identifica uma entrada. Sinais do canal precisam da
    // geração completa; o marcador legado persistido continua fail closed.
    if (!qualified && !fromStorage) return;
    if (qualified) retiredLogins.add(marker.userId + ":" + marker.sessionId);
    // Uma intenção explícita já bloqueou A, mas ainda não adquiriu sua nova
    // sessão. Logout de A não pode cancelar OAuth B nem reinstalar SIGNED_OUT.
    // Retemos o impedimento de A em memória, inclusive sem nenhum storage.
    if (oauthIntent && (!oauthIntent.sessionIdentity ||
        marker?.userId !== oauthIntent.sessionIdentity.userId || marker?.sessionId !== oauthIntent.sessionIdentity.sessionId)) return;
    let active = session;
    try { active = storedSession() || active; } catch (_) { /* Usa a identidade já conhecida; nenhum acesso é concedido. */ }
    if ((!active && !fromStorage) || !markerApplies(marker, active) || disabled) return;
    disabled = true; nextEpoch(); invalidate();
    session = null; user = null; dataUid = null; emit("guest");
    try { global.sessionStorage.setItem(SIGNED_OUT, "1"); } catch (_) { /* gate fechado */ }
    goLogin();
  }

  function aborted() { return new global.DOMException("Operação de autenticação cancelada.", "AbortError"); }
  function cancellable(promise, signal) {
    let cancel;
    const stopped = new Promise((_, reject) => {
      cancel = () => reject(aborted());
      if (signal.aborted) cancel(); else signal.addEventListener("abort", cancel, { once: true });
    });
    return Promise.race([promise, stopped]).finally(() => signal.removeEventListener("abort", cancel));
  }
  function nextEpoch() {
    epoch += 1;
    oauthIntent = null;
    if (pkceWork) pkceWork.cancelled = true;
    lifetime.abort(); lifetime = new global.AbortController();
    work = null;
    // Revogações já vinculadas a um JWT explícito não administram a sessão
    // atual. Todas as demais operações da geração encerrada são canceladas.
    for (const request of requests) if (request.kind !== "logout") request.controller.abort();
  }

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
      for (const key of ["code", "state", "access_token", "refresh_token", "error", "error_code", "error_description", "token_type", "expires_in", "expires_at"]) url.searchParams.delete(key);
      if (/(?:access_token|refresh_token|error|error_code|error_description|code)=/i.test(url.hash)) url.hash = "";
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
  function logoutApplies(raw = global.localStorage.getItem(LOGOUT)) {
    if (!raw) return false;
    try {
      // UID/session_id só limitam o alcance do encerramento. Outra identidade
      // ou geração continua obrigada a passar por getUser antes de entrar.
      if (!markerApplies(JSON.parse(raw), storedSession())) return false;
    } catch (_) { /* marcadores legados/ilegíveis continuam fail closed */ }
    return true;
  }
  function isLogoutCurrent(event) {
    try { return event.newValue !== null && global.localStorage.getItem(LOGOUT) === event.newValue && logoutApplies(event.newValue); }
    catch (_) { return true; }
  }
  function isVerified(uid) {
    try {
      return !disabled && state === "authenticated" && Boolean(user && session && verifiedToken) &&
        (!uid || user.id === uid) && session.expires_at * 1000 > Date.now() &&
        storedToken() === verifiedToken && !retiredLogin(session) && !logoutApplies();
    } catch (_) { return false; }
  }
  function unlock(uid, verified) {
    // `verified`: esta chamada vem de um verify() que já concluiu getUser
    // para este acesso. Nesse caso a sessão foi efetivamente validada agora,
    // então não recorremos à checagem de memória (que pode ter sido zerada
    // por uma rotação silenciosa que ocorreu entre a validação e este ponto).
    if (!verified && !isVerified(uid)) { gate("Sua sessão precisa ser verificada novamente.", true); return false; }
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
  function loginRequired(message) { const error = new Error(message); error.loginRequired = true; return error; }
  function endedSession(error) {
    return error.loginRequired || error.name === "AuthSessionMissingError" ||
      (error.name === "AuthApiError" && (error.status === 401 || error.status === 403 || SESSION_ERRORS.has(error.code)));
  }
  // Erros do servidor que explicitamente não encerram a sessão e dão para
  // tentar novamente: 5xx e 429. Apenas esses sustentam a interface
  // autenticada durante uma revalidação silenciosa. O SDK nomeia 5xx/rede
  // repetáveis como AuthRetryableFetchError; 429 como AuthApiError.
  function isServerTransient(error) {
    if (error.name === "AuthRetryableFetchError") return error.status >= 500 || error.status === 429;
    return error.name === "AuthApiError" && (error.status >= 500 || error.status === 429);
  }
  function invalidate(silent) {
    if (dataUid) needsDataRefresh = true;
    revision += 1;
    for (const request of requests) if (["verification", "data"].includes(request.kind)) request.controller.abort();
    user = null;
    verifiedToken = "";
    global.clearTimeout(expiryTimer);
    global.clearTimeout(validationTimer);
    // Rotação de token da MESMA sessão (rotação silenciosa): a sessão
    // continua válida e será revalidada imediatamente, então a interface
    // autenticada não volta a ser bloqueada. Erros reais ainda fecham.
    if (!silent) gate("Verificando sua sessão…", false);
  }
  function scheduleValidation() {
    global.clearTimeout(validationTimer);
    if (!disabled) validationTimer = global.setTimeout(() => { void revalidate(); }, 0);
  }
  // Revalidação silenciosa após uma falha transitória (rede/5xx) de uma sessão
  // que continua verificada: a interface autenticada permanece, e a checagem
  // é repetida com recuo, sem bloquear e sem rodape infinito.
  let silentRetryMs = 1000;
  function scheduleSilentRetry() {
    global.clearTimeout(validationTimer);
    if (disabled) return;
    validationTimer = global.setTimeout(() => { void revalidate(); }, silentRetryMs);
    silentRetryMs = Math.min(30000, silentRetryMs * 2);
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
  async function boundedFetch(input, options, kind) {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname === "/auth/v1/logout") kind = "logout";
    // Um retry interno do SDK pode sobreviver ao cancelamento do fetch.
    // Não envie um refresh antigo depois que a sessão persistida foi trocada.
    let refresh = null;
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      let active = null, body = null, expected = null;
      try { expected = global.localStorage.getItem(storageKey); active = JSON.parse(expected); body = JSON.parse(options.body); } catch (_) { /* fechado abaixo */ }
      if (disabled || !active || body?.refresh_token !== active.refresh_token || retiredLogin(active)) throw aborted();
      // O SDK mantém só um refresh em andamento por cliente. Um retry pode
      // renovar o ticket só se o MESMO refresh token ainda for o persistido.
      refresh = { generation: epoch, expected, original: active, token: null, failed: false };
      refreshCommit = refresh;
    }
    const controller = new global.AbortController();
    const request = { controller, kind }, generation = epoch;
    const original = options && options.signal;
    const abort = () => controller.abort();
    if (original) {
      if (original.aborted) controller.abort();
      else original.addEventListener("abort", abort, { once: true });
    }
    requests.add(request);
    const timer = global.setTimeout(abort, 12000);
    try {
      // O SDK recebe uma Response normal, mas só depois de TODO o corpo ter
      // chegado. O mesmo prazo/sinal abrange cabeçalhos e leitura, inclusive
      // respostas de erro. Não deixamos response.json() escapar do timeout.
      return await cancellable((async () => {
        const response = await global.fetch(input, Object.assign({}, options, { signal: controller.signal }));
        const body = response.body === null ? null : await response.arrayBuffer();
        if (controller.signal.aborted || (kind !== "logout" && generation !== epoch)) throw aborted();
        if (refresh) {
          // Erros/corpos atrasados também não podem iniciar cleanup de B.
          if (disabled || global.localStorage.getItem(storageKey) !== refresh.expected) throw aborted();
          refresh.failed = !response.ok && response.status < 500 && response.status !== 429;
          if (response.ok) {
            try { refresh.token = JSON.parse(new global.TextDecoder().decode(body)).access_token || null; }
            catch (_) { /* O SDK continua responsável por validar a resposta. */ }
          }
        }
        return new global.Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      })(), controller.signal);
    } finally {
      requests.delete(request); global.clearTimeout(timer);
      if (original) original.removeEventListener("abort", abort);
    }
  }
  function sdk() {
    if (client) return client;
    const cfg = config();
    if (!global.supabase || !global.supabase.createClient) throw new Error("Não foi possível carregar o SDK de autenticação. Recarregue a página.");
    storageKey = "sb-" + cfg.ref + "-auth-token";
    // getUser pode limpar a sessão do próprio cliente ao receber
    // session_not_found, antes de conferirmos revisão/token. Um cliente
    // oficial sem persistência isola esse efeito de respostas atrasadas:
    // a verificação recebe o JWT explícito e nunca administra a sessão ativa.
    verifier = global.supabase.createClient(cfg.url, cfg.key, {
      auth: { flowType: "pkce", detectSessionInUrl: false, persistSession: false, autoRefreshToken: false, storageKey: storageKey + "-verification" },
      global: { fetch: (input, options) => boundedFetch(input, options, "verification") }
    });
    client = global.supabase.createClient(cfg.url, cfg.key, {
      auth: { flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey, storage: sdkStorage() },
      global: { fetch: (input, options) => boundedFetch(input, options, "session") }
    });
    try {
      if (global.BroadcastChannel) {
        logoutChannel = new global.BroadcastChannel("forja:logout:" + storageKey);
        logoutChannel.onmessage = event => receiveLogout(event.data);
      }
    } catch (_) { /* Storage events continuam disponíveis; falhas são mostradas no logout. */ }
    // Nunca aguardar chamadas do SDK dentro do callback: ele roda sob lock do Auth.
    client.auth.onAuthStateChange((event, next) => {
      if (disabled || event === "INITIAL_SESSION") return;
      if (pkceWork) {
        if (global.localStorage.getItem(storageKey) === pkceWork.expected && global.localStorage.getItem(OAUTH_CURRENT) === pkceWork.intent) return;
        nextEpoch();
      }
      // A notificação oficial de rotação atualiza o snapshot da MESMA sessão,
      // mas não autoriza nada: ainda invalidamos e exigimos getUser abaixo.
      if (event === "TOKEN_REFRESHED" && sameLogin(next, session) && next.access_token === storedToken()) session = next;
      if (event === "SIGNED_OUT") {
        // Uma notificação antiga não deve derrubar uma sessão já substituída.
        if (storedToken()) { invalidate(); emit("validating"); scheduleValidation(); return; }
        invalidate(); session = null; emit("guest"); goLogin();
      } else if (next && next.access_token === storedToken() && next.access_token !== verifiedToken) {
        // Rotação da MESMA sessão: a interface autenticada já exibida
        // permanece enquanto a revalidação conclui (sem flash bloqueante).
        invalidate(true); emit("validating"); scheduleValidation();
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
  async function verify(generation, signal) {
    // Se a sessão já estava verificada em memória quando esta checagem começou,
    // ela é uma REVALIDAÇÃO SILENCIOSA: uma falha transitória não pode tirar a
    // interface autenticada do usuário (a sessão continua válida até sua
    // expiração). Sessões encerradas/alteradas e erros em inicializações
    // continuam bloqueando com rigor.
    const wasVerified = isVerified();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (disabled || generation !== epoch || (oauthIntent && !oauthIntent.sessionIdentity)) return null;
      let candidate = null;
      const observed = revision;
      try {
        const api = sdk(), tokenAtStart = storedToken();
        const result = await cancellable(api.auth.getSession(), signal);
        if (disabled || generation !== epoch) return null;
        if (observed !== revision || tokenAtStart !== storedToken()) throw stale();
        if (result.error) throw result.error;
        candidate = result.data.session;
        if (!candidate) { invalidate(); session = null; emit("guest"); goLogin(); return null; }
        if (retiredLogin(candidate)) throw loginRequired("Esta sessão foi encerrada em outra aba. Entre novamente com Google.");
        const response = await verifier.auth.getUser(candidate.access_token);
        if (disabled || generation !== epoch) return null;
        if (observed !== revision || storedToken() !== candidate.access_token) throw stale();
        if (response.error) throw response.error;
        const actual = response.data.user;
        if (!actual || !UUID.test(actual.id) || actual.id !== candidate.user.id || actual.is_anonymous === true ||
            !actual.app_metadata || actual.app_metadata.provider !== "google") {
          throw loginRequired("Esta instalação aceita somente contas Google verificadas.");
        }
        if (!Number.isFinite(candidate.expires_at) || candidate.expires_at * 1000 <= Date.now()) throw loginRequired("Sua sessão expirou. Entre novamente com Google.");
        const oldDataUid = dataUid;
        session = candidate; user = actual; verifiedToken = candidate.access_token;
        // SIGNED_IN da recuperação inicial pode ter agendado uma validação
        // redundante. Não deixar esse timer apagar um erro de vínculo local.
        global.clearTimeout(validationTimer);
        silentRetryMs = 1000;
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
            unlock(actual.id, true);
          }
          else if (oldDataUid === actual.id) {
            // Mesma conta, mas a ligação dos dados ainda não está pronta. A
            // sessão continua válida e igual, então não há necessidade de
            // recarregar (o que reintroduziria a tela bloqueante): apenas
            // religa os dados e libera a interface.
            if (typeof F.authData?.bind === "function") { void F.authData.bind(actual.id).catch(() => { /* bind reentrante/silencioso seguro */ }); }
            needsDataRefresh = false;
            unlock(actual.id, true);
          }
          else if (!isLogin()) F.navigate(global.location.href);
        }
        return actual;
      } catch (error) {
        if (disabled || generation !== epoch) return null;
        if (observed !== revision || (candidate && storedToken() !== candidate.access_token)) error = stale();
        if (error.stale && attempt < 2) continue;
        if (endedSession(error)) {
          invalidate();
          // O Auth já rejeitou este acesso. Esqueça apenas o token observado,
          // sem revogar no servidor uma sessão nova de outra aba. Não toque
          // nos dados/journals nem no verifier de uma tentativa OAuth paralela.
          try {
            await mutateSession(() => {
              if (candidate && storedToken() === candidate.access_token) global.localStorage.removeItem(storageKey);
            }, true);
          } catch (_) { /* Mesmo sem remoção, só getUser pode autorizar acesso. */ }
          session = null; emit("guest"); goLogin(); return null;
        }
        // Erro explicitamente transitório DO SERVIDOR (5xx/429) em uma
        // REVALIDAÇÃO SILENCIOSA: o servidor confirmou que a sessão existe e
        // pede para tentar depois. A sessão continua verificada e válida em
        // memória, então a interface autenticada já exibida é preservada e
        // a checagem se repete com recuo. Timeout, abort, falha de rede e
        // qualquer erro que não confirme a sessão continuam bloqueando:
        // uma checagem não concluída não pode sustentar a liberação.
        if (wasVerified && !error.stale && isServerTransient(error)) {
          scheduleSilentRetry();
          return null;
        }
        invalidate();
        emit("error");
        gate(error.stale ? "A conta mudou. Recarregue para continuar com segurança." :
          "Não foi possível validar sua sessão. Confira a conexão e tente novamente; seus dados continuam preservados.", true);
        return null;
      }
    }
    return null;
  }
  function revalidate() {
    if (disabled) return Promise.resolve(null);
    if (work) return work.promise;
    // Revalidação: a checagem ocorre e só TRAVA se a sessão for encerrada,
    // expirada ou alterada (ver verify). Não dispara tela bloqueante no
    // início, para que o retorno do segundo plano com sessão válida não
    // reintroduza "Verificando sua sessão…". O cold-start usa init().
    const job = {};
    job.promise = verify(epoch, lifetime.signal).finally(() => { if (work === job) work = null; });
    work = job;
    return job.promise;
  }
  function cleanCallback(url) {
    for (const key of ["code", "state", "error", "error_code", "error_description", "access_token", "refresh_token", "token_type", "expires_in", "expires_at"]) url.searchParams.delete(key);
    if (/(?:access_token|refresh_token|error|error_code|error_description|code)=/i.test(url.hash)) url.hash = "";
    global.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  async function init() {
    if (initWork) return initWork;
    initWork = (async () => {
      const generation = epoch;
      try {
        const url = new URL(global.location.href);
        const code = url.searchParams.get("code");
        const failure = url.searchParams.has("error") || url.searchParams.has("error_code") ||
          /(?:^#|&)(?:error|error_code|error_description|access_token|refresh_token)=/i.test(url.hash);
        // Sanitizar antes até da configuração/SDK: um build mal configurado
        // não pode deixar código ou tokens de retorno no histórico/URL.
        if (code || failure) cleanCallback(url);
        sdk();
        if (code || failure) {
          const pending = readTab(ATTEMPT);
          global.sessionStorage.removeItem(ATTEMPT);
          if (failure) throw new Error("Login cancelado ou não autorizado. Você pode tentar novamente com Google.");
          if (!isLogin() || !pending || !Number.isFinite(pending.at) || Date.now() < pending.at || Date.now() - pending.at > 10 * 60 * 1000) {
            throw new Error("Este retorno de login expirou ou foi aberto em outra aba. Inicie o login novamente.");
          }
          setReturn(pending.target);
          // O seletor público do SDK viaja só nesta aba, sem mudar redirectTo
          // ou allowlists externas. Nunca recorrer ao verifier legado de B.
          if (!pending.id || !/^[A-Za-z0-9_-]{8,64}$/.test(pending.flowId || "")) {
            throw new Error("Esta tentativa de login precisa ser reiniciada na mesma aba.");
          }
          if (global.localStorage.getItem(OAUTH_CURRENT) !== pending.id) return await revalidate();
          oauthIntent = { id: pending.id, sessionIdentity: null };
          const job = { generation, intent: pending.id, expected: global.localStorage.getItem(storageKey), cancelled: false, reads: new Map() };
          let exchanged, exchangeError;
          pkceWork = job;
          try { exchanged = await client.auth.exchangeCodeForSession(code, { flowId: pending.flowId }); }
          catch (error) { exchangeError = error; }
          finally { if (pkceWork === job) pkceWork = null; }
          if (job.cancelled || generation !== epoch || global.localStorage.getItem(OAUTH_CURRENT) !== job.intent ||
              global.localStorage.getItem(storageKey) !== job.expected) return await revalidate();
          if (exchangeError || exchanged.error) throw new Error("Não foi possível concluir o login. Inicie uma nova tentativa na mesma aba.");
        } else if (isLogin() && url.searchParams.has("next")) setReturn(url.searchParams.get("next"));
        if (global.sessionStorage.getItem(SIGNED_OUT) || logoutApplies()) {
          disabled = true; emit("guest"); goLogin(); return null;
        }
        return await revalidate();
      } catch (error) {
        // Erros de início/callback exigem nova tentativa explícita. Uma
        // recuperação assíncrona do SDK não deve contornar um cancelamento.
        if (generation !== epoch) return null;
        disabled = true; nextEpoch();
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
    nextEpoch(); invalidate();
    const generation = epoch;
    disabled = false; logoutPending = false; logoutContext = null;
    const intent = { id: global.crypto.randomUUID(), sessionIdentity: null };
    oauthIntent = intent;
    try {
      const pending = { at: Date.now(), target: returnTarget(), id: intent.id };
      global.sessionStorage.removeItem(SIGNED_OUT);
      await mutateSession(() => {
        if (generation !== epoch) throw aborted();
        intent.previous = loginIdentity(storedSession());
        global.localStorage.removeItem(LOGOUT);
        global.localStorage.setItem(OAUTH_CURRENT, pending.id);
      }, true);
      if (generation !== epoch) return;
      global.sessionStorage.setItem(ATTEMPT, JSON.stringify(pending));
      if (global.sessionStorage.getItem(ATTEMPT) !== JSON.stringify(pending)) throw new Error("O navegador não permitiu guardar a tentativa de login. Habilite o armazenamento e tente novamente.");
      const result = await api.auth.signInWithOAuth({ provider: "google", options: {
        redirectTo: new URL("login.html", rootUrl()).href,
        queryParams: { prompt: "select_account" }, skipBrowserRedirect: true
      } });
      if (generation !== epoch) return;
      if (global.localStorage.getItem(OAUTH_CURRENT) !== pending.id) throw new Error("Outro login foi iniciado. Aguarde sua conclusão ou inicie uma nova tentativa.");
      if (result.error || !result.data.url || !result.data.flowId) {
        global.sessionStorage.removeItem(ATTEMPT);
        throw new Error("Não foi possível abrir o Google. Confira a conexão e tente novamente.");
      }
      pending.flowId = result.data.flowId;
      global.sessionStorage.setItem(ATTEMPT, JSON.stringify(pending));
      if (global.sessionStorage.getItem(ATTEMPT) !== JSON.stringify(pending)) throw new Error("O navegador não permitiu guardar a tentativa de login.");
      const targetUrl = new URL(result.data.url);
      const project = new URL((global.FORJA_PUBLIC_CONFIG || {}).url);
      if (targetUrl.origin !== project.origin || targetUrl.pathname !== "/auth/v1/authorize") throw new Error("Endereço de autenticação inesperado.");
      F.navigate(targetUrl.href);
    } catch (error) {
      if (generation === epoch) {
        disabled = true; nextEpoch(); invalidate(); emit("error");
      }
      throw error;
    }
  }
  async function signOut() {
    // Somente memória antes do bloqueio. Nem mesmo getItem é confiável aqui.
    const original = logoutContext || (session && { access_token: verifiedToken || session.access_token,
      user: { id: user?.id || session.user?.id } });
    disabled = true; nextEpoch(); invalidate();
    session = null; user = null; dataUid = null; emit("guest");
    const generation = epoch;
    logoutContext = original; logoutPending = false;
    gate("Encerrando sua sessão…", false);
    let storageFailed = false, revocationConfirmed = false, active = null, readable = false, ownsSession = false;
    let revocationToken = original?.access_token || null;
    try { global.sessionStorage.setItem(SIGNED_OUT, "1"); } catch (_) { storageFailed = true; }
    try {
      active = storedSession(); readable = true;
      ownsSession = sameLogin(active, original);
      // Uma rotação da mesma sessão não é uma nova entrada. JWT/identidade são
      // capturados agora, ainda ANTES de qualquer await, nunca de B depois dele.
      if (ownsSession) { logoutContext = active; revocationToken = active.access_token; }
    } catch (_) { storageFailed = true; }
    const identity = loginIdentity(logoutContext);
    if (UUID.test(identity.userId) && (ownsSession || !readable || !active)) {
      const marker = { ...identity, at: Date.now(), nonce: global.crypto.randomUUID() };
      try { global.localStorage.setItem(LOGOUT, JSON.stringify(marker)); } catch (_) { storageFailed = true; }
      // Canal separado do protocolo do SDK; envia só identidade/geração, NUNCA
      // tokens. Também fecha abas já abertas quando todo o storage é recusado.
      try { logoutChannel?.postMessage(marker); } catch (_) { storageFailed = true; }
    }
    clearReturn();
    try { global.sessionStorage.removeItem(ATTEMPT); } catch (_) { storageFailed = true; }
    const captured = logoutContext;
    try {
      if (ownsSession) await mutateSession(() => {
        // Reconfere dentro do lock. Só remove a geração capturada, mesmo que
        // uma rotação de A termine enquanto esperamos; jamais uma nova B/A.
        if (sameLogin(storedSession(), captured)) global.localStorage.removeItem(storageKey);
      }, true);
    } catch (_) { storageFailed = true; }
    try {
      if (client) await client.auth.stopAutoRefresh();
      // API OFICIAL, com chave pública e JWT explícito capturado no início.
      // Não consulta getSession/signOut do cliente persistente nem remove PKCE.
      if (revocationToken && verifier) {
        const result = await verifier.auth.admin.signOut(revocationToken, "local");
        revocationConfirmed = !result.error;
      }
    } catch (_) { /* Revogação remota é best effort; não reautoriza o acesso. */ }
    finally {
      if (generation === epoch && disabled) {
        if (storageFailed) {
          logoutPending = true;
          gate("O acesso foi bloqueado nesta aba, mas o navegador recusou parte da limpeza. O bloqueio não garante a saída após recarregar. " +
            (revocationConfirmed ? "" : "A revogação no servidor não foi confirmada. ") +
            "Tente concluir a saída novamente. Se o armazenamento continuar indisponível, feche as abas e limpe a sessão deste site antes de entrar.", true);
        } else {
          logoutPending = false; logoutContext = null;
          F.navigate(new URL("login.html", rootUrl()).href);
        }
      }
    }
  }
  // The data client cannot switch accounts or refresh. Pin the verified JWT
  // through every SDK await/retry and abort outstanding HTTP on invalidation.
  function dataClient(uid) {
    const token = verifiedToken, rev = revision, cfg = config();
    const check = () => {
      if (!isVerified(uid) || revision !== rev || verifiedToken !== token) {
        const error = stale(); error.sessionChanged = true; throw error;
      }
    };
    check();
    return { check, api: global.supabase.createClient(cfg.url, cfg.key, {
      accessToken: async () => { check(); return token; }, db: { retry: false },
      global: { fetch: (url, options) => { check(); return boundedFetch(url, options, "data"); } }
    }) };
  }
  F.auth = Object.freeze({
    dataClient, init, revalidate, startGoogle, signOut, isVerified, unlock, gate, safeReturn, resumeUrl, handleStorage, isLogoutCurrent,
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
      if (!isLogoutCurrent(event)) return;
      try { receiveLogout(JSON.parse(event.newValue), true); }
      catch (_) {
        // Marcador legado/ilegível persistido: não libera uma sessão por erro.
        receiveLogout(null, true);
      }
    } else if (!disabled && (event.key === null || (storageKey && event.key === storageKey) || (pkceWork && event.key === OAUTH_CURRENT))) {
      if (pkceWork && (event.key === OAUTH_CURRENT || global.localStorage.getItem(storageKey) !== pkceWork.expected)) nextEpoch();
      invalidate(); emit("validating"); scheduleValidation();
    }
  }
  global.addEventListener("storage", handleStorage);
  // Retorno do segundo plano: revalidação SILENCIOSA. Se a sessão continuar
  // verificada, a interface autenticada já exibida permanece (sem tela
  // bloqueante); se a sessão estiver encerrada/expirada, revalidate()
  // bloqueia e solicita autenticação.
  doc.addEventListener("visibilitychange", () => {
    if (!doc.hidden && !disabled && dataUid) void revalidate();
  });
  doc.addEventListener("click", event => {
    if (event.target.closest && event.target.closest("#auth-retry")) {
      if (logoutPending) void signOut();
      else if (typeof F.retryBoot === "function") void F.retryBoot(); else void revalidate();
    }
  });
})(window);
