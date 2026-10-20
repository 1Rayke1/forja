/*
  FORJA — backup, restauração e preferências (página configurações).

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
    SECTION_ORDER,
    SECTION_NAMES,
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

function getForjaStorageKeys(includeSafety = false) {
  const keys = [];

  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith("forja-")) continue;
      if (!includeSafety && key === KEYS.safety) continue;
      keys.push(key);
    }
  } catch (error) {
    throw new Error("Não foi possível ler o armazenamento do navegador.");
  }

  return keys;
}

function validateBackupEntry(key, value) {
  if (key === KEYS.safety) {
    throw new Error("O backup contém uma chave interna de segurança que não deve ser importada.");
  }

  if (/^forja-missoes-\d{4}-\d{2}-\d{2}$/.test(key)) {
    if (!Array.isArray(value)) {
      throw new Error("A lista de missões de " + key + " é inválida.");
    }

    value.forEach((task, index) => {
      if (typeof task === "string") return;

      if (!isPlainObject(task)) {
        throw new Error("A missão " + (index + 1) + " de " + key + " é inválida.");
      }

      if (typeof task.text !== "string" && typeof task.title !== "string") {
        throw new Error("Uma missão de " + key + " não tem texto.");
      }

      if (task.done !== undefined && typeof task.done !== "boolean") {
        throw new Error("Uma missão de " + key + " tem estado inválido.");
      }
    });

    return;
  }

  if (key === KEYS.routines) {
    if (!isPlainObject(value)) {
      throw new Error("As rotinas do backup estão em formato inválido.");
    }

    ["calisthenics", "weights"].forEach(mode => {
      if (value[mode] === undefined) return;

      if (!Array.isArray(value[mode])) {
        throw new Error("A lista de rotinas de " + MODE_NAMES[mode] + " é inválida.");
      }

      value[mode].forEach((routine, index) => {
        validateBackupRoutine(routine, index);
      });
    });

    return;
  }

  if (key === KEYS.legacyExercises) {
    if (!isPlainObject(value)) {
      throw new Error("Os exercícios antigos do backup estão em formato inválido.");
    }

    ["calisthenics", "weights"].forEach(mode => {
      if (value[mode] === undefined) return;

      if (!Array.isArray(value[mode])) {
        throw new Error("A lista de exercícios antigos de " + MODE_NAMES[mode] + " é inválida.");
      }

      value[mode].forEach((exercise, index) => {
        if (!isPlainObject(exercise) ||
          typeof exercise.name !== "string" ||
          !exercise.name.trim()) {
          throw new Error("O exercício antigo " + (index + 1) + " é inválido.");
        }

        if (exercise.sets !== undefined &&
          (!Number.isInteger(Number(exercise.sets)) ||
            Number(exercise.sets) < 1 ||
            Number(exercise.sets) > 30)) {
          throw new Error("Um exercício antigo tem número de séries inválido.");
        }

        if (exercise.rest !== undefined &&
          (!Number.isFinite(Number(exercise.rest)) ||
            Number(exercise.rest) < 0 ||
            Number(exercise.rest) > 3600)) {
          throw new Error("Um exercício antigo tem descanso inválido.");
        }
      });
    });

    return;
  }

  if (key === KEYS.history) {
    if (!Array.isArray(value)) {
      throw new Error("O histórico de treinos do backup é inválido.");
    }

    value.forEach((record, index) => {
      if (!isPlainObject(record)) {
        throw new Error("O registro " + (index + 1) + " do histórico é inválido.");
      }

      if (!MODE_NAMES[record.modality]) {
        throw new Error("O registro " + (index + 1) + " do histórico tem modalidade inválida.");
      }

      if (record.completedSets !== undefined &&
        (!Number.isFinite(Number(record.completedSets)) ||
          Number(record.completedSets) < 0)) {
        throw new Error("O registro " + (index + 1) + " tem séries concluídas inválidas.");
      }

      if (record.durationMs !== undefined &&
        (!Number.isFinite(Number(record.durationMs)) ||
          Number(record.durationMs) < 0)) {
        throw new Error("O registro " + (index + 1) + " tem duração inválida.");
      }

      if (record.exercises !== undefined) {
        if (!Array.isArray(record.exercises)) {
          throw new Error("O registro " + (index + 1) + " tem exercícios inválidos.");
        }

        record.exercises.forEach(exercise => {
          if (!isPlainObject(exercise) || typeof exercise.name !== "string") {
            throw new Error("Um exercício do histórico é inválido.");
          }
        });
      }
    });

    return;
  }

  if (key === KEYS.active) {
    if (!isPlainObject(value)) {
      throw new Error("A sessão ativa do backup é inválida.");
    }

    if (!MODE_NAMES[value.modality]) {
      throw new Error("A sessão ativa do backup tem modalidade inválida.");
    }

    if (value.version === 2) {
      if (!Array.isArray(value.queue) || value.queue.length === 0) {
        throw new Error("A sessão ativa do backup não tem exercícios.");
      }

      value.queue.forEach(exercise => {
        if (!isPlainObject(exercise) ||
          typeof exercise.name !== "string" ||
          !exercise.name.trim() ||
          !Number.isInteger(Number(exercise.sets)) ||
          Number(exercise.sets) < 1 ||
          Number(exercise.sets) > 30) {
          throw new Error("A sessão ativa do backup tem um exercício inválido.");
        }
      });

      if (!Number.isInteger(Number(value.currentIndex)) ||
        Number(value.currentIndex) < 0 ||
        Number(value.currentIndex) >= value.queue.length) {
        throw new Error("A posição atual da sessão ativa é inválida.");
      }

      if (!isPlainObject(value.completedSets)) {
        throw new Error("O progresso da sessão ativa é inválido.");
      }
    } else if (!isPlainObject(value.completedSets)) {
      throw new Error("O progresso da sessão antiga é inválido.");
    }

    return;
  }

  if (key === KEYS.legacyActiveArchive ||
    key === KEYS.preserved ||
    key === KEYS.migration) {
    if (!isPlainObject(value) && !Array.isArray(value)) {
      throw new Error("Os dados auxiliares do FORJA estão em formato inválido.");
    }
    return;
  }

  if (key === KEYS.library) {
    if (!isPlainObject(value) || !Array.isArray(value.calisthenics) || !Array.isArray(value.weights)) {
      throw new Error("A biblioteca de exercícios do FORJA está em formato inválido.");
    }
    return;
  }

  if (key === KEYS.preferences) {
    if (!isPlainObject(value)) {
      throw new Error("As preferências do FORJA estão em formato inválido.");
    }
    return;
  }

  // Chaves extras com prefixo forja- são preservadas depois que o JSON
  // de origem foi validado. Elas não têm efeito visual no aplicativo atual.
}

function validateBackupExercise(exercise, path) {
  if (!isPlainObject(exercise)) {
    throw new Error("Exercício inválido em " + path + ".");
  }

  if (typeof exercise.name !== "string" || !exercise.name.trim()) {
    throw new Error("Exercício sem nome em " + path + ".");
  }

  const sets = Number(exercise.sets);
  if (!Number.isInteger(sets) || sets < 1 || sets > 30) {
    throw new Error("Exercício com séries inválidas em " + path + ".");
  }

  if (exercise.type !== undefined &&
    exercise.type !== "reps" &&
    exercise.type !== "duration") {
    throw new Error("Exercício com tipo inválido em " + path + ".");
  }

  if (exercise.rest !== undefined) {
    const rest = Number(exercise.rest);
    if (!Number.isFinite(rest) || rest < 0 || rest > 3600) {
      throw new Error("Exercício com descanso inválido em " + path + ".");
    }
  }

  if (exercise.type === "duration") {
    const duration = Number(exercise.duration);
    if (!Number.isFinite(duration) || duration < 1 || duration > 7200) {
      throw new Error("Exercício com duração inválida em " + path + ".");
    }
  } else if (exercise.reps !== undefined &&
    typeof exercise.reps !== "string" &&
    typeof exercise.reps !== "number") {
    throw new Error("Exercício com repetições inválidas em " + path + ".");
  }

  if (exercise.load !== undefined && typeof exercise.load !== "string") {
    throw new Error("Exercício com carga inválida em " + path + ".");
  }

  if (exercise.notes !== undefined && typeof exercise.notes !== "string") {
    throw new Error("Exercício com observações inválidas em " + path + ".");
  }
}

function validateBackupRoutine(routine, index) {
  if (!isPlainObject(routine)) {
    throw new Error("A rotina " + (index + 1) + " do backup é inválida.");
  }

  if (typeof routine.name !== "string" || !routine.name.trim()) {
    throw new Error("A rotina " + (index + 1) + " do backup não tem nome.");
  }

  if (routine.sections !== undefined) {
    if (!isPlainObject(routine.sections)) {
      throw new Error("As seções da rotina " + routine.name + " são inválidas.");
    }

    Object.keys(routine.sections).forEach(section => {
      if (!SECTION_NAMES[section]) {
        throw new Error("A rotina " + routine.name + " tem uma seção desconhecida.");
      }

      if (!Array.isArray(routine.sections[section])) {
        throw new Error("A seção " + SECTION_NAMES[section] + " da rotina " +
          routine.name + " é inválida.");
      }

      routine.sections[section].forEach(exercise => {
        validateBackupExercise(exercise, routine.name + " / " + SECTION_NAMES[section]);
      });
    });
  }
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
    if (!key.startsWith("forja-")) {
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
    extraKeys: []
  };

  Object.keys(keys || {}).forEach(key => {
    const value = keys[key];

    if (/^forja-missoes-\d{4}-\d{2}-\d{2}$/.test(key)) {
      summary.missionDays += 1;
      if (Array.isArray(value)) summary.tasks += value.length;
      return;
    }

    if (key === KEYS.routines && isPlainObject(value)) {
      ["calisthenics", "weights"].forEach(mode => {
        if (!Array.isArray(value[mode])) return;
        summary.routines[mode] = value[mode].length;

        value[mode].forEach(routine => {
          SECTION_ORDER.forEach(section => {
            const list = isPlainObject(routine.sections) &&
              Array.isArray(routine.sections[section])
              ? routine.sections[section]
              : [];
            summary.routineExercises += list.length;
          });
        });
      });
      return;
    }

    if (key === KEYS.legacyExercises && isPlainObject(value)) {
      summary.legacyExercises.calisthenics =
        Array.isArray(value.calisthenics) ? value.calisthenics.length : 0;
      summary.legacyExercises.weights =
        Array.isArray(value.weights) ? value.weights.length : 0;
      return;
    }

    if (key === KEYS.history && Array.isArray(value)) {
      summary.history = value.length;
      value.forEach(record => {
        if (MODE_NAMES[record.modality]) {
          summary.historyByMode[record.modality] += 1;
        }
      });
      return;
    }

    if (key === KEYS.active && isPlainObject(value)) {
      summary.activeSession = {
        modality: value.modality,
        routineName: value.routineName || "Treino",
        running: value.running !== false,
        legacy: value.version !== 2
      };
      return;
    }

    if (
      key === KEYS.legacyActiveArchive ||
      key === KEYS.preserved ||
      key === KEYS.migration
    ) {
      return;
    }

    if (key === KEYS.library) {
      summary.libraryItems = ["calisthenics", "weights"].reduce((sum, mode) => {
        return sum + (isPlainObject(value) && Array.isArray(value[mode]) ? value[mode].length : 0);
      }, 0);
      return;
    }

    if (key === KEYS.preferences) {
      return;
    }

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

function writeKeysTransaction(keys) {
  getForjaStorageKeys(true).forEach(key => {
    if (key === KEYS.safety) return;
    localStorage.removeItem(key);
  });

  Object.keys(keys).forEach(key => {
    try {
      localStorage.setItem(key, JSON.stringify(keys[key]));
    } catch (error) {
      throw new Error("Falha ao gravar \"" + key + "\": " + error.message);
    }
  });

  Object.keys(keys).forEach(key => {
    const raw = localStorage.getItem(key);

    if (raw === null) {
      throw new Error("Falha ao verificar \"" + key + "\" após a gravação.");
    }

    try {
      JSON.parse(raw);
    } catch (error) {
      throw new Error("O dado \"" + key + "\" ficou inválido após a gravação.");
    }
  });
}

function rollbackToSafety(safetyRawValues) {
  const failedKeys = [];

  getForjaStorageKeys(true).forEach(key => {
    if (key === KEYS.safety) return;

    try {
      localStorage.removeItem(key);
    } catch (error) {
      failedKeys.push(key);
    }
  });

  Object.keys(safetyRawValues).forEach(key => {
    try {
      localStorage.setItem(key, safetyRawValues[key]);
    } catch (error) {
      failedKeys.push(key);
    }
  });

  return { ok: failedKeys.length === 0, failedKeys };
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
    const rollback = rollbackToSafety(currentRaw);

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
    F.state.preferences = Object.assign({}, F.state.preferences, { [name]: Boolean(value) });

    if (!F.savePreferences(F.state.preferences)) {
      renderPreferences();
      showToast("Não foi possível salvar a preferência neste navegador.", "error");
      return;
    }

    showToast("Preferência salva.");
  }

  /* Página configurações */

  F.pages.configuracoes = function initConfiguracoes() {
    byId("export-backup").addEventListener("click", exportBackup);

    byId("import-backup-button").addEventListener("click", () => {
      byId("import-backup-input").click();
    });

    byId("import-backup-input").addEventListener("change", async event => {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (file) await handleBackupFile(file);
    });

    byId("restore-safety-backup").addEventListener("click", restoreSafetyBackup);

    byId("pref-sound").addEventListener("change", event => {
      changePreference("soundOnRest", event.target.checked);
    });

    byId("pref-vibrate").addEventListener("change", event => {
      changePreference("vibrateOnRest", event.target.checked);
    });

    renderPreferences();
    updateBackupStatus();
  };

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
