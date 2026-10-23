/*
  FORJA — backup, restauração e preferências (páginas Perfil e Configurações).

  Mantém o formato e as validações do backup original (forja-backup v1):
  exportação, importação validada com pré-visualização, cópia de segurança
  antes de cada restauração e "desfazer última restauração". Nunca apaga
  o armazenamento inteiro: só grava ou remove as chaves do próprio backup.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const {
    KEYS,
    BACKUP_FORMAT,
    BACKUP_VERSION,
    MAX_BACKUP_BYTES,
    MODE_NAMES,
    isPlainObject,
    byId,
    dateKey,
    formatDate,
    parseStorageValue,
    saveJSON,
    showToast,
    showModal
  } = F;

  F.dataListeners = F.dataListeners || [];
  F.onDataChanged = function onDataChanged(listener) {
    F.dataListeners.push(listener);
  };

  const MAX_IMPORT_FILE_SIZE = MAX_BACKUP_BYTES;

let lastExportAt = null;

/*
  As chaves do FORJA são todas as com o prefixo `forja-`. A cópia de segurança
  interna é excluída por padrão: ela não é dado do usuário, é um mecanismo de
  reversão. A listagem vem do store, então um adaptador de sincronização futuro
  só precisa trocar o driver.
*/
function getForjaStorageKeys(includeSafety = false) {
  if (!F.store.available()) {
    throw new Error("Não foi possível ler o armazenamento do navegador.");
  }

  return F.store.keys().filter(key => includeSafety || key !== KEYS.safety);
}

/*
  A validação de cada chave mora no registro do store (o mesmo usado na leitura
  do boot): importação e boot aceitam exatamente o mesmo conjunto de dados.
*/
function validateBackupEntry(key, value) {
  if (key === KEYS.safety) {
    throw new Error("O backup contém uma chave interna de segurança que não deve ser importada.");
  }

  return F.registry.validateKey(key, value);
}

function validateBackupKeys(keys) {
  if (!isPlainObject(keys)) {
    throw new Error("O backup não contém um objeto de dados válido.");
  }

  const keyNames = Object.keys(keys);

  if (keyNames.length === 0) {
    throw new Error("O backup não contém nenhum dado do FORJA.");
  }

  keyNames.forEach(key => {
    if (!key.startsWith(F.STORAGE_PREFIX)) {
      throw new Error("O backup contém uma chave desconhecida: " + key + ".");
    }

    validateBackupEntry(key, keys[key]);
  });

  return true;
}

function validateBackupPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error("O arquivo não contém um objeto JSON de backup.");
  }

  if (payload.app !== "FORJA" || payload.format !== BACKUP_FORMAT) {
    throw new Error("Este arquivo não é um backup do FORJA.");
  }

  if (!Number.isInteger(payload.version) || payload.version < 1) {
    throw new Error("A versão do backup é inválida.");
  }

  if (payload.version > BACKUP_VERSION) {
    throw new Error("Este backup foi criado por uma versão mais nova do FORJA.");
  }

  if (!isPlainObject(payload.keys)) {
    throw new Error("O backup não contém dados para restaurar.");
  }

  validateBackupKeys(payload.keys);

  return {
    keys: payload.keys,
    exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : null,
    version: payload.version
  };
}

/*
  Resumo do conteúdo, montado pelos descritores de chave. A estrutura é a
  mesma que sempre existiu (missões, rotinas, histórico, sessão ativa, chaves
  extras), acrescida dos itens que a versão atual conhece.
*/
function computeBackupSummary(keys) {
  const summary = {
    missionDays: 0,
    tasks: 0,
    routines: { calisthenics: 0, weights: 0 },
    routineExercises: 0,
    legacyExercises: { calisthenics: 0, weights: 0 },
    history: 0,
    historyByMode: { calisthenics: 0, weights: 0 },
    activeSession: null,
    libraryItems: 0,
    goals: null,
    extraKeys: [],
    items: []
  };

  Object.keys(keys || {}).forEach(key => {
    const value = keys[key];
    const problem = "O conteúdo de \"" + key + "\" não pôde ser resumido.";

    if (F.MISSION_KEY_PATTERN.test(key)) {
      summary.missionDays += 1;
      if (Array.isArray(value)) summary.tasks += value.length;
      return;
    }

    if (key === KEYS.migration || key === KEYS.preserved || key === KEYS.legacyActiveArchive) {
      return;
    }

    let item = null;

    try {
      item = F.registry.summarizeKey(key, value);
    } catch (error) {
      item = { label: "Dado do FORJA", detail: problem };
    }

    if (item) summary.items.push(Object.assign({ key }, item));
  });

  const routines = isPlainObject(keys[KEYS.routines]) ? keys[KEYS.routines] : null;

  if (routines) {
    ["calisthenics", "weights"].forEach(mode => {
      if (!Array.isArray(routines[mode])) return;
      summary.routines[mode] = routines[mode].length;
      summary.routineExercises += F.countRoutineData({ [mode]: routines[mode] }).exercises;
    });
  }

  const legacy = isPlainObject(keys[KEYS.legacyExercises]) ? keys[KEYS.legacyExercises] : null;

  if (legacy) {
    ["calisthenics", "weights"].forEach(mode => {
      summary.legacyExercises[mode] = Array.isArray(legacy[mode]) ? legacy[mode].length : 0;
    });
  }

  if (Array.isArray(keys[KEYS.history])) {
    summary.history = keys[KEYS.history].length;
    keys[KEYS.history].forEach(record => {
      if (isPlainObject(record) && MODE_NAMES[record.modality]) {
        summary.historyByMode[record.modality] += 1;
      }
    });
  }

  if (isPlainObject(keys[KEYS.active])) {
    const session = keys[KEYS.active];
    summary.activeSession = {
      modality: session.modality,
      routineName: session.routineName || "Treino",
      running: session.running !== false,
      legacy: session.version !== 2
    };
  }

  const library = isPlainObject(keys[KEYS.library]) ? keys[KEYS.library] : null;

  if (library) {
    summary.libraryItems = ["calisthenics", "weights"].reduce((total, mode) => {
      return total + (Array.isArray(library[mode]) ? library[mode].length : 0);
    }, 0);
  }

  if (isPlainObject(keys[KEYS.goals])) {
    const goals = F.normalizeGoals(keys[KEYS.goals]);
    summary.goals = {
      sessions: goals.weeklySessions,
      sets: goals.weeklySets,
      minutes: goals.weeklyMinutes,
      modality: goals.modality
    };
  }

  const known = F.registry.list().map(spec => spec.key);

  Object.keys(keys || {}).forEach(key => {
    if (F.MISSION_KEY_PATTERN.test(key)) return;
    if (known.indexOf(key) !== -1) return;
    summary.extraKeys.push(key);
  });

  return summary;
}

function buildBackupObject() {
  const keys = {};

  getForjaStorageKeys().forEach(key => {
    const stored = parseStorageValue(key);

    if (!stored.exists) return;

    if (stored.error) {
      throw new Error(
        "O dado \"" + key + "\" não é um JSON válido. Corrija ou remova esse dado antes de exportar."
      );
    }

    keys[key] = stored.value;
  });

  validateBackupKeys(keys);

  return {
    app: "FORJA",
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    summary: computeBackupSummary(keys),
    keys
  };
}

function exportBackup() {
  let backup;

  if (getForjaStorageKeys().length === 0) {
    showToast(
      "Ainda não há dados do FORJA para exportar. Crie missões ou rotinas primeiro."
    );
    return false;
  }

  try {
    backup = buildBackupObject();
  } catch (error) {
    showToast("Não foi possível exportar: " + error.message, "error", 6000);
    return false;
  }

  const json = JSON.stringify(backup, null, 2);
  const filename = "forja-backup-" + dateKey(new Date()) + ".json";

  try {
    if (typeof Blob !== "function" || typeof URL.createObjectURL !== "function") {
      throw new Error("O navegador não suporta download de arquivos.");
    }

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        // Ignora falha ao liberar a URL temporária.
      }
    }, 1000);

    lastExportAt = backup.exportedAt;
    updateBackupStatus();
    showToast("Backup exportado com " + Object.keys(backup.keys).length + " chaves de dados.");
    return true;
  } catch (error) {
    showToast("Não foi possível gerar o download: " + error.message, "error", 5000);
    return false;
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    if (typeof file.text === "function") {
      file.text().then(resolve).catch(reject);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsText(file);
  });
}

function makeBackupPreview(validated, currentKeys) {
  const summary = computeBackupSummary(validated.keys);
  const backupKeyNames = Object.keys(validated.keys);
  const removed = currentKeys.filter(key => !backupKeyNames.includes(key));
  const overwritten = currentKeys.filter(key => backupKeyNames.includes(key));
  const warnings = [];

  if (F.state.activeWorkout && !validated.keys[KEYS.active]) {
    warnings.push(
      "A sessão ativa atual será removida; ela não será registrada no histórico."
    );
  }

  if (summary.activeSession) {
    warnings.push(
      "O backup contém uma sessão ativa de " +
      (MODE_NAMES[summary.activeSession.modality] || "modalidade desconhecida") +
      ", que será restaurada e aberta."
    );
  }

  if (!validated.keys[KEYS.routines] &&
    validated.keys[KEYS.legacyExercises]) {
    warnings.push(
      "O backup não tem rotinas novas; elas serão recriadas a partir dos exercícios antigos."
    );
  }

  if (removed.length > 0) {
    warnings.push(
      removed.length + " chave(s) atual(is) que não existem no backup serão removidas."
    );
  }

  const details = document.createElement("div");
  details.className = "modal-details";

  const restoredTitle = document.createElement("strong");
  restoredTitle.textContent = "Será restaurado";
  details.appendChild(restoredTitle);

  const restoredList = document.createElement("ul");

  const missionItem = document.createElement("li");
  missionItem.textContent = "Missões e calendário: " + summary.missionDays +
    " dia(s) com " + summary.tasks + " missão(ões).";
  restoredList.appendChild(missionItem);

  const routineItem = document.createElement("li");
  routineItem.textContent = "Rotinas: " +
    (summary.routines.calisthenics + summary.routines.weights) +
    " (Calistenia: " + summary.routines.calisthenics +
    ", Musculação: " + summary.routines.weights + ") com " +
    summary.routineExercises + " exercício(s).";
  restoredList.appendChild(routineItem);

  const historyItem = document.createElement("li");
  historyItem.textContent = "Histórico: " + summary.history + " treino(s) " +
    "(Calistenia: " + summary.historyByMode.calisthenics +
    ", Musculação: " + summary.historyByMode.weights + ").";
  restoredList.appendChild(historyItem);

  const legacyTotal = summary.legacyExercises.calisthenics +
    summary.legacyExercises.weights;
  if (legacyTotal > 0) {
    const legacyItem = document.createElement("li");
    legacyItem.textContent = "Exercícios antigos preservados: " + legacyTotal +
      " (Calistenia: " + summary.legacyExercises.calisthenics +
      ", Musculação: " + summary.legacyExercises.weights + ").";
    restoredList.appendChild(legacyItem);
  }

  const sessionItem = document.createElement("li");
  sessionItem.textContent = summary.activeSession
    ? "Sessão ativa: " + MODE_NAMES[summary.activeSession.modality] +
      " · " + summary.activeSession.routineName +
      (summary.activeSession.legacy ? " (formato antigo será migrado)." : ".")
    : "Sessão ativa: nenhuma.";
  restoredList.appendChild(sessionItem);

  if (summary.extraKeys.length > 0) {
    const extraItem = document.createElement("li");
    extraItem.textContent = summary.extraKeys.length +
      " chave(s) auxiliar(es) do FORJA.";
    restoredList.appendChild(extraItem);
  }

  details.appendChild(restoredList);

  const effectTitle = document.createElement("strong");
  effectTitle.textContent = "Efeito nos dados atuais";
  details.appendChild(effectTitle);

  const effectList = document.createElement("ul");
  const replaceItem = document.createElement("li");
  replaceItem.textContent = overwritten.length +
    " chave(s) serão substituídas; " + removed.length +
    " chave(s) atual(is) serão removidas.";
  effectList.appendChild(replaceItem);

  const safetyItem = document.createElement("li");
  safetyItem.textContent =
    "Uma cópia de segurança do estado atual será guardada antes da restauração.";
  effectList.appendChild(safetyItem);

  if (validated.exportedAt) {
    const date = new Date(validated.exportedAt);
    if (!Number.isNaN(date.getTime())) {
      const dateItem = document.createElement("li");
      dateItem.textContent = "Backup criado em " +
        formatDate(date, {
          day: "2-digit", month: "long", year: "numeric",
          hour: "2-digit", minute: "2-digit"
        }) + ".";
      effectList.appendChild(dateItem);
    }
  }

  warnings.forEach(warning => {
    const warningItem = document.createElement("li");
    warningItem.textContent = "Atenção: " + warning;
    effectList.appendChild(warningItem);
  });

  details.appendChild(effectList);
  return details;
}

/*
  Instantâneo textual de todas as chaves do FORJA (exceto a cópia de
  segurança). Serve de base tanto para a cópia automática antes de importar
  quanto para a reversão de uma transação incompleta.
*/
function collectCurrentRawSnapshot() {
  const rawValues = {};

  getForjaStorageKeys().forEach(key => {
    const stored = parseStorageValue(key);

    if (stored.exists && stored.error) {
      throw new Error(
        "Não foi possível criar a cópia de segurança: o dado \"" + key +
        "\" não é um JSON válido."
      );
    }

    if (stored.exists) rawValues[key] = stored.raw;
  });

  return rawValues;
}

/*
  Transação de substituição: delegada ao store, que grava, confere o que voltou
  parseável, remove apenas o que não faz parte do backup e reverte ao
  instantâneo em caso de falha. A cópia de segurança nunca é tocada aqui.
*/
function writeKeysTransaction(keys) {
  const result = F.store.applySet(keys, { protect: [KEYS.safety] });

  if (!result.ok) {
    const error = new Error(result.error || "Falha ao aplicar o backup.");
    error.rollback = result.rollback;
    error.failedKeys = result.failed;
    throw error;
  }

  return result;
}

function rollbackToSafety(safetyRawValues) {
  const result = F.store.restoreRaw(safetyRawValues, { protect: [KEYS.safety] });

  return { ok: result.ok, failedKeys: result.failedKeys };
}

/*
  Recarrega os dados em memória depois de uma restauração. Nenhum intervalo é
  criado aqui. Cada página registra F.onDataChanged para redesenhar a própria
  tela; a sessão ativa, se houver, é retomada pela página "executar".
*/
function reloadApplicationData() {
  F.state.bootNotices = [];
  F.bootData();

  if (typeof global.renderCalendar === "function") global.renderCalendar();
  if (typeof global.renderMissions === "function") global.renderMissions();

  F.updateActiveBanner();
  updateBackupStatus();

  F.dataListeners.forEach(listener => {
    try {
      listener();
    } catch (error) {
      console.error(error);
    }
  });
}

function applyRestore(keys, options = {}) {
  let currentKeys;
  let currentRaw;

  try {
    currentRaw = collectCurrentRawSnapshot();
    currentKeys = {};
    Object.keys(currentRaw).forEach(key => {
      currentKeys[key] = JSON.parse(currentRaw[key]);
    });
  } catch (error) {
    showToast(error.message, "error", 6000);
    return false;
  }

  const safety = {
    app: "FORJA",
    format: "forja-backup-seguranca",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    reason: options.reason || "before-restore",
    keys: currentKeys
  };

  if (!saveJSON(KEYS.safety, safety)) {
    return false;
  }

  try {
    writeKeysTransaction(keys);
  } catch (error) {
    /*
      A transação do store já reverteu para o instantâneo tirado antes de
      escrever e devolveu o resultado dessa reversão. Quando a falha veio de
      outro ponto (por exemplo, ao ler o estado atual), a reversão é feita
      aqui, pela cópia de segurança.
    */
    const rollback = error.rollback || rollbackToSafety(currentRaw);

    showModal({
      title: "Falha ao restaurar",
      message: rollback.ok
        ? "Não foi possível concluir a restauração. Seus dados anteriores foram recuperados integralmente. Detalhe: " + error.message
        : "Não foi possível concluir a restauração nem recuperar todas as chaves. " +
          "Chaves com problema: " + rollback.failedKeys.join(", ") + ". " +
          "A cópia de segurança anterior continua em forja-backup-seguranca-v1. " +
          "Detalhe: " + error.message,
      actions: [
        { id: "close", label: "Fechar", className: "secondary-button" }
      ]
    });

    return false;
  }

  reloadApplicationData();
  showToast("Backup restaurado. " + Object.keys(keys).length + " chave(s) carregada(s).");
  return true;
}

async function previewAndRestore(validated, options = {}) {
  const currentKeys = getForjaStorageKeys();
  const details = makeBackupPreview(validated, currentKeys);

  const result = await showModal({
    title: options.title || "Restaurar backup?",
    message: options.message ||
      "Revise o que será restaurado. Esta ação substitui os dados atuais do FORJA neste navegador.",
    details,
    actions: [
      { id: "cancel", label: "Cancelar", className: "secondary-button" },
      {
        id: "restore",
        label: options.confirmLabel || "Substituir e restaurar",
        className: "primary-button"
      }
    ]
  });

  if (result.action !== "restore") return false;

  return applyRestore(validated.keys, { reason: options.reason || "import" });
}

async function processBackupText(text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch (error) {
    showModal({
      title: "Arquivo inválido",
      message: "O arquivo selecionado não é um JSON válido. Nenhum dado foi alterado.",
      actions: [
        { id: "close", label: "Fechar", className: "secondary-button" }
      ]
    });
    return false;
  }

  let validated;

  try {
    validated = validateBackupPayload(payload);
  } catch (error) {
    showModal({
      title: "Backup inválido",
      message: error.message + " Nenhum dado foi alterado.",
      actions: [
        { id: "close", label: "Fechar", className: "secondary-button" }
      ]
    });
    return false;
  }

  return previewAndRestore(validated);
}

async function handleBackupFile(file) {
  if (!file) return false;

  if (file.size > MAX_BACKUP_BYTES) {
    showModal({
      title: "Arquivo muito grande",
      message: "O backup deve ter no máximo 5 MB. Nenhum dado foi alterado.",
      actions: [
        { id: "close", label: "Fechar", className: "secondary-button" }
      ]
    });
    return false;
  }

  let text;

  try {
    text = await readFileAsText(file);
  } catch (error) {
    showToast("Não foi possível ler o arquivo: " + error.message, "error");
    return false;
  }

  return processBackupText(text);
}

async function restoreSafetyBackup() {
  const stored = parseStorageValue(KEYS.safety);

  if (!stored.exists || stored.error || !isPlainObject(stored.value) ||
    !isPlainObject(stored.value.keys)) {
    showToast("Não há uma cópia de segurança válida para restaurar.", "error");
    return false;
  }

  let validated;

  try {
    validated = validateBackupPayload({
      app: "FORJA",
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: stored.value.exportedAt,
      keys: stored.value.keys
    });
  } catch (error) {
    showToast("A cópia de segurança está inválida: " + error.message, "error", 6000);
    return false;
  }

  const result = await previewAndRestore(validated, {
    title: "Desfazer última importação?",
    message: "Os dados atuais serão substituídos pela cópia de segurança criada antes da última restauração. Uma nova cópia do estado atual será guardada.",
    confirmLabel: "Restaurar cópia anterior",
    reason: "undo-import"
  });

  return result;
}

function updateBackupStatus() {
  const status = byId("backup-status");
  const undoButton = byId("restore-safety-backup");
  if (!status || !undoButton) return;

  const parts = [
    "Seus dados permanecem apenas neste navegador. Faça backups regulares."
  ];

  if (lastExportAt) {
    const exported = new Date(lastExportAt);
    if (!Number.isNaN(exported.getTime())) {
      parts.push("Último backup exportado em " +
        formatDate(exported, {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit"
        }) + ".");
    }
  }

  const stored = parseStorageValue(KEYS.safety);
  const hasSafety = stored.exists && !stored.error &&
    isPlainObject(stored.value) && isPlainObject(stored.value.keys);

  undoButton.hidden = !hasSafety;

  if (hasSafety) {
    const created = new Date(stored.value.exportedAt);
    if (!Number.isNaN(created.getTime())) {
      parts.push("Cópia de segurança de " +
        formatDate(created, {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit"
        }) + " disponível.");
    }
  }

  status.textContent = parts.join(" ");
}


/* Inicialização e eventos */

  /* Preferências (sons e vibração no descanso). */

  function renderPreferences() {
    const sound = byId("pref-sound");
    const vibrate = byId("pref-vibrate");
    if (!sound || !vibrate) return;

    const prefs = F.state.preferences || {};
    sound.checked = prefs.soundOnRest !== false;
    vibrate.checked = prefs.vibrateOnRest !== false;
  }

  function changePreference(name, value) {
    /* Parte do que está gravado agora: outra aba pode ter mudado a outra opção. */
    const next = Object.assign({}, F.loadPreferences(), { [name]: Boolean(value) });

    if (!F.savePreferences(next)) {
      /* Nada foi gravado: a tela e o aviso do descanso voltam ao valor armazenado. */
      F.state.preferences = F.loadPreferences();
      renderPreferences();
      showToast("Não foi possível salvar a preferência neste navegador.", "error");
      return;
    }

    showToast("Preferência salva.");
  }

  /*
    Outra aba (Perfil ou Configurações) pode mudar as preferências enquanto esta
    está aberta — inclusive durante um descanso na execução. O evento `storage`
    só chega às demais abas; aqui a memória e os checkboxes são relidos do
    armazenamento, sem gravar nada.
  */
  global.addEventListener("storage", event => {
    if (event.key !== null && event.key !== KEYS.preferences) return;
    F.state.preferences = F.loadPreferences();
    renderPreferences();
  });

  /*
    Controlador único de dados e preferências. Perfil (destino da barra
    inferior) e Configurações (mantida para links antigos e favoritos) têm a
    mesma marcação de backup e descanso, então as duas páginas usam esta mesma
    inicialização. Abrir a página só lê o armazenamento: nada é gravado até o
    usuário agir.
  */
  function listen(element, type, handler) {
    if (element) element.addEventListener(type, handler);
  }

  function initDadosEPreferencias() {
    listen(byId("export-backup"), "click", exportBackup);

    listen(byId("import-backup-button"), "click", () => {
      const input = byId("import-backup-input");
      if (input) input.click();
    });

    listen(byId("import-backup-input"), "change", async event => {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (file) await handleBackupFile(file);
    });

    listen(byId("restore-safety-backup"), "click", restoreSafetyBackup);

    listen(byId("pref-sound"), "change", event => {
      changePreference("soundOnRest", event.target.checked);
    });

    listen(byId("pref-vibrate"), "change", event => {
      changePreference("vibrateOnRest", event.target.checked);
    });

    renderPreferences();
    updateBackupStatus();
  }

  F.pages.perfil = initDadosEPreferencias;
  F.pages.configuracoes = initDadosEPreferencias;

  F.onDataChanged(() => {
    if (byId("backup-status")) {
      renderPreferences();
      updateBackupStatus();
    }
  });

  F.exportBackup = exportBackup;
  F.buildBackupObject = buildBackupObject;
  F.applyRestore = applyRestore;
  F.handleBackupFile = handleBackupFile;
  F.updateBackupStatus = updateBackupStatus;

})(window);
