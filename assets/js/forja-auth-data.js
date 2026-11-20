/*
  Adapta o store existente a um namespace por UID, sem trocar/apagar o conjunto
  global entre contas. Chaves e formatos lógicos do FORJA continuam iguais.
  O legado original é preservado byte a byte; um journal verificável permite
  retomar a cópia local. A cópia inicial é independente da sincronização diária em forja-cloud.
*/
(function (global) {
  "use strict";
  const F = global.Forja;
  const OWNER = "forja-auth-legacy-owner-v1";
  const DATA = "forja-auth-data-v1:";
  const COPY = "forja-auth-copy-v1:";
  const TAB = "forja-auth-tab-v1:";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const LIMIT = 12582912;
  let boundUid = null, copyWork = null, copyState = "pending", copyMessage = "";
  const deny = () => { throw new Error("Dados bloqueados: valide a conta antes de continuar."); };
  F.store.useDriver({ id: "auth-locked", available: () => false, getItem: deny, setItem: deny, removeItem: deny, keys: () => [] });

  function privateKey(key) {
    return typeof key !== "string" || !key.startsWith("forja-") ||
      /^forja-(?:auth-|arquivo-)/.test(key) ||
      /(?:token|credential|credencial|password|senha|secret|supabase|api[-_]?key)/i.test(key);
  }
  function dataKey(key) { return !privateKey(key); }
  // Também usado pelo backup: credenciais/journals nunca são dados importáveis.
  F.isAccountDataKey = dataKey;
  function assertUser(uid) {
    if (!UUID.test(uid) || !F.auth.isVerified(uid)) {
      const error = new Error("A sessão mudou. Entre novamente antes de continuar.");
      error.sessionChanged = true;
      throw error;
    }
  }
  function canonical(map) {
    const result = {};
    Object.keys(map).sort().forEach(key => { result[key] = map[key]; });
    return JSON.stringify(result);
  }
  async function digest(map) {
    const bytes = new global.TextEncoder().encode(canonical(map));
    const hash = await global.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function checkedWrite(storage, key, raw) {
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new Error("O navegador não confirmou a gravação. Os dados originais continuam preservados.");
  }
  function readObject(key) {
    const raw = global.localStorage.getItem(key);
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value;
    } catch (_) { throw new Error("Um registro de recuperação está ilegível. Nada será sobrescrito; preserve os dados e peça suporte."); }
  }
  function owner() {
    const value = readObject(OWNER);
    if (value && (value.version !== 1 || !UUID.test(value.userId))) throw new Error("O vínculo do legado está inválido. Os dados foram preservados e a migração foi bloqueada.");
    return value;
  }
  function scan(storage, prefix) {
    const result = {};
    for (let i = 0; i < storage.length; i += 1) {
      const physical = storage.key(i);
      if (!physical || !physical.startsWith(prefix)) continue;
      const key = physical.slice(prefix.length);
      if (!dataKey(key)) continue;
      const raw = storage.getItem(physical);
      if (typeof raw !== "string") throw new Error("Não foi possível ler todo o conjunto local. Nenhum dado será descartado.");
      result[key] = raw;
    }
    return result;
  }
  function legacy() { return scan(global.localStorage, ""); }
  function remoteMap(raw) {
    const result = {};
    Object.keys(raw).forEach(key => { if (dataKey(key) && key !== F.KEYS.safety) result[key] = raw[key]; });
    return result;
  }
  function validRaw(map) {
    return map && typeof map === "object" && !Array.isArray(map) &&
      Object.entries(map).every(([key, value]) => dataKey(key) && typeof value === "string");
  }
  async function readJournal(uid) {
    const entry = readObject(COPY + uid);
    if (!entry) return null;
    if (entry.version !== 1 || entry.userId !== uid || !["preparing", "pending", "confirmed"].includes(entry.phase) ||
        !["legacy", "account"].includes(entry.source) || !validRaw(entry.rawByKey) || !validRaw(entry.rawSessionByKey) ||
        !/^[0-9a-f]{64}$/.test(entry.checksum || "")) throw new Error("A cópia recuperável está inválida. Nenhum dado será substituído.");
    if (await digest(remoteMap(entry.rawByKey)) !== entry.checksum) throw new Error("A cópia recuperável diverge do checksum. Preserve o navegador e peça suporte.");
    assertUser(uid);
    return entry;
  }
  function saveJournal(uid, entry) {
    assertUser(uid);
    checkedWrite(global.localStorage, COPY + uid, JSON.stringify(entry));
  }
  function copyToNamespace(uid, entry) {
    assertUser(uid);
    if (entry.source === "legacy" && (!owner() || owner().userId !== uid)) throw new Error("O legado pertence a outra conta. A cópia foi bloqueada.");
    for (const [key, raw] of Object.entries(entry.rawByKey)) {
      assertUser(uid);
      const physical = DATA + uid + ":" + key;
      const existing = global.localStorage.getItem(physical);
      if (existing !== null && existing !== raw) throw new Error("Há dados diferentes no destino da recuperação. Nada será sobrescrito automaticamente.");
      if (existing === null) checkedWrite(global.localStorage, physical, raw);
    }
    copyDrafts(uid, entry.rawSessionByKey);
    entry.phase = "pending";
    saveJournal(uid, entry);
  }
  function copyDrafts(uid, raw) {
    for (const [key, value] of Object.entries(raw)) {
      assertUser(uid);
      const physical = TAB + uid + ":" + key;
      // Rascunho mais recente da mesma conta nunca é sobrescrito pelo legado.
      if (global.sessionStorage.getItem(physical) === null) checkedWrite(global.sessionStorage, physical, value);
    }
  }
  function confirmLegacy(uid, count) {
    F.auth.gate("Há " + count + " conjunto(s) de dados locais sem conta. Vincular à conta Google " + F.auth.user.email + "? Os originais permanecerão neste navegador.", false);
    const panel = global.document.getElementById("auth-legacy-choice");
    if (!panel) throw new Error("A confirmação de vínculo não está disponível nesta página.");
    panel.hidden = false;
    return new Promise((resolve, reject) => {
      const confirm = global.document.getElementById("auth-import-confirm");
      const skip = global.document.getElementById("auth-import-skip");
      function cleanup() {
        panel.hidden = true; confirm.onclick = null; skip.onclick = null;
        global.removeEventListener("forja:auth", changed);
      }
      function changed(event) {
        if (event.detail.state === "guest" || (event.detail.state === "authenticated" && event.detail.userId !== uid)) {
          cleanup();
          const error = new Error("A conta mudou antes da confirmação do legado.");
          error.sessionChanged = true;
          reject(error);
        }
      }
      function finish(value) {
        cleanup();
        try { assertUser(uid); resolve(value); } catch (error) { reject(error); }
      }
      global.addEventListener("forja:auth", changed);
      confirm.onclick = () => finish(true);
      skip.onclick = () => finish(false);
    });
  }
  async function withBindingLock(task, required) {
    if (global.navigator.locks && typeof global.navigator.locks.request === "function") {
      return global.navigator.locks.request("forja-legacy-binding-v1", { mode: "exclusive" }, task);
    }
    if (required) throw new Error("Este navegador não oferece Web Locks para copiar o legado com segurança. Use um navegador atualizado em HTTPS/localhost; os originais continuam preservados.");
    return task();
  }
  function scopedDriver(uid) {
    const prefix = DATA + uid + ":";
    function check(key) { assertUser(uid); if (key !== undefined && !dataKey(key)) throw new Error("Chave privada não pertence ao conjunto de dados."); }
    const seen = new Map();
    function write(key,raw) {
      check(key);
      const before = global.localStorage.getItem(prefix + key);
      const observed = seen.has(key) ? seen.get(key) : before;
      const committed = F.cloud.record(uid,key,observed,raw,before,value => {
        if (value === null) global.localStorage.removeItem(prefix + key);
        else checkedWrite(global.localStorage,prefix + key,value);
      });
      seen.set(key,committed);
    }
    return {
      id: "account-local-storage",
      available() { try { check(); return Boolean(global.localStorage); } catch (_) { return false; } },
      getItem(key) { check(key); const raw = global.localStorage.getItem(prefix + key); seen.set(key,raw); return raw; },
      setItem(key, value) { write(key,String(value)); },
      removeItem(key) { write(key,null); },
      keys() { check(); return Object.keys(scan(global.localStorage, prefix)); }
    };
  }
  async function bind(actualUser) {
    const uid = actualUser && actualUser.id;
    assertUser(uid);
    const initialOwner = owner();
    const hasJournal = global.localStorage.getItem(COPY + uid) !== null;
    const rawLegacy = legacy();
    let consent = false;
    if (!hasJournal && !initialOwner && Object.keys(rawLegacy).length) consent = await confirmLegacy(uid, Object.keys(rawLegacy).length);
    const prepared = await withBindingLock(async () => {
      assertUser(uid);
      let entry = await readJournal(uid);
      let binding = owner();
      if (!entry) {
        const available = legacy();
        if (!binding && consent) {
          binding = { version: 1, userId: uid, claimedAt: new Date().toISOString() };
          // O dono é gravado PRIMEIRO. Falha posterior nunca torna o legado livre para B.
          checkedWrite(global.localStorage, OWNER, JSON.stringify(binding));
        }
        const fromLegacy = Boolean(binding && binding.userId === uid);
        const rawByKey = fromLegacy ? available : scan(global.localStorage, DATA + uid + ":");
        const rawSessionByKey = fromLegacy ? scan(global.sessionStorage, "") : {};
        const checksum = await digest(remoteMap(rawByKey));
        assertUser(uid);
        entry = { version: 1, userId: uid, source: fromLegacy ? "legacy" : "account", phase: "preparing", checksum, rawByKey, rawSessionByKey };
        saveJournal(uid, entry);
      }
      if (entry.phase === "preparing") copyToNamespace(uid, entry);
      // Outra aba da conta legada pode ter seu próprio rascunho, ainda não copiado.
      if (binding && binding.userId === uid) copyDrafts(uid, scan(global.sessionStorage, ""));
      assertUser(uid);
      return { checksum: entry.checksum, phase: entry.phase };
    }, consent || Boolean(initialOwner && initialOwner.userId === uid && !hasJournal));
    await F.cloud.recover(uid, { read: () => remoteMap(scan(global.localStorage, DATA + uid + ":")),
      apply(key, raw) {
        assertUser(uid);
        if (!dataKey(key) || key === F.KEYS.safety) throw new Error("Chave inválida.");
        const physical = DATA + uid + ":" + key;
        if (raw === null) global.localStorage.removeItem(physical);
        else checkedWrite(global.localStorage, physical, raw);
      }, digest, validRaw, original: hasJournal ? prepared.checksum : null });
    assertUser(uid);
    boundUid = uid;
    F.store.useDriver(scopedDriver(uid));
    copyState = prepared.phase === "confirmed" ? "confirmed" : "pending";
    announce();
    return true;
  }
  function announce() {
    global.dispatchEvent(new global.CustomEvent("forja:copy", { detail: { state: copyState, message: copyMessage } }));
  }
  async function sendInitialCopy() {
    const uid = boundUid;
    assertUser(uid);
    const generation = F.auth.revision;
    const check = () => { assertUser(uid); if (F.auth.revision !== generation) throw new Error("A sessão mudou durante a cópia. Tente novamente com a conta correta."); };
    const entry = await readJournal(uid);
    if (!entry || entry.phase === "preparing") throw new Error("Conclua a recuperação local antes de enviar a cópia.");
    if (entry.phase === "confirmed") { copyState = "confirmed"; announce(); return true; }
    const raw = remoteMap(entry.rawByKey);
    if (new global.TextEncoder().encode(canonical(raw)).byteLength + Object.keys(raw).length * 2 > LIMIT) {
      throw new Error("A cópia inicial excede 12 MiB. Os dados locais foram preservados; exporte um backup e peça suporte.");
    }
    check(); copyState = "sending"; copyMessage = ""; announce();
    const api = F.auth.dataClient(uid).api;
    const payload = { user_id: uid, checksum: entry.checksum, format_version: 1, raw_by_key: raw };
    // INSERT ON CONFLICT DO NOTHING. UPDATE é negado no banco e nunca é pedido.
    const inserted = await api.from("user_data_imports").upsert(payload, { onConflict: "user_id,checksum", ignoreDuplicates: true });
    check();
    if (inserted.error) throw new Error("O Supabase recusou ou não recebeu a cópia inicial. Confira rede/configuração e tente novamente; nada local foi apagado.");
    const readback = await api.from("user_data_imports").select("user_id,checksum,format_version,raw_by_key")
      .eq("user_id", uid).eq("checksum", entry.checksum).single();
    check();
    const row = readback.data;
    if (readback.error || !row || row.user_id !== uid || row.checksum !== entry.checksum || row.format_version !== 1 ||
        !validRaw(row.raw_by_key) || canonical(row.raw_by_key) !== canonical(raw) || await digest(row.raw_by_key) !== entry.checksum) {
      throw new Error("Não foi possível conferir a cópia no servidor. Ela não foi marcada como concluída; os originais continuam preservados.");
    }
    check();
    entry.phase = "confirmed";
    saveJournal(uid, entry);
    copyState = "confirmed"; copyMessage = ""; announce();
    return true;
  }
  function runInitialCopy() {
    if (copyWork) return copyWork;
    copyWork = sendInitialCopy().catch(error => {
      copyState = "error";
      copyMessage = error.message || "A cópia inicial não foi concluída. Seus dados locais continuam preservados.";
      announce(); return false;
    }).finally(() => { copyWork = null; });
    return copyWork;
  }
  function checkBound() { assertUser(boundUid); }
  const tabStorage = Object.freeze({
    getItem(key) { checkBound(); if (!dataKey(key)) throw new Error("Chave privada."); return global.sessionStorage.getItem(TAB + boundUid + ":" + key); },
    setItem(key, value) { checkBound(); if (!dataKey(key)) throw new Error("Chave privada."); checkedWrite(global.sessionStorage, TAB + boundUid + ":" + key, String(value)); },
    removeItem(key) { checkBound(); if (!dataKey(key)) throw new Error("Chave privada."); global.sessionStorage.removeItem(TAB + boundUid + ":" + key); }
  });
  F.authData = Object.freeze({
    bind, runInitialCopy, session: tabStorage,
    isBound(uid) { return Boolean(uid && boundUid === uid); },
    get userId() { return boundUid; },
    get copyStatus() { return { state: copyState, message: copyMessage }; },
    physicalKey(key) { checkBound(); if (!dataKey(key)) throw new Error("Chave privada."); return DATA + boundUid + ":" + key; }
  });
  // Traduz apenas eventos do namespace da própria conta para os módulos legados.
  // Nenhum dado de outra conta é lido, copiado ou colocado no evento sintético.
  global.addEventListener("storage", event => {
    if (typeof event.key !== "string" || !event.key.startsWith("forja-auth-")) return;
    // Infraestrutura e namespaces físicos não são eventos de domínio. Em
    // especial, uma escrita de B nunca deve provocar leituras/redesenhos em A.
    event.stopImmediatePropagation();
    if (!boundUid || !F.auth.isVerified(boundUid)) return;
    const prefix = DATA + boundUid + ":";
    if (!event.key.startsWith(prefix)) return;
    const key = event.key.slice(prefix.length);
    if (!dataKey(key)) return;
    global.dispatchEvent(new global.StorageEvent("storage", { key, oldValue: event.oldValue, newValue: event.newValue, url: event.url }));
  });
})(window);
