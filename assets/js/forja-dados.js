/*
  FORJA — dados: normalização, migração e leitura do armazenamento.

  Preserva as chaves e os formatos antigos (forja-treino-exercicios-v1,
  forja-treino-historico-v1, forja-treino-sessao-ativa-v1). Nada é apagado:
  conteúdo ilegível ou não reconhecido é arquivado antes de qualquer
  normalização (ver docs/forja-rotinas-e-backup.md, seção 2).
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const {
    KEYS,
    SECTION_ORDER,
    SECTION_NAMES,
    MODE_NAMES,
    isPlainObject,
    cloneData,
    createId,
    clampInteger,
    dateKey,
    parseStorageValue,
    saveJSON,
    removeStorageKey,
    archivePreservedValue,
    recordMigration
  } = F;

  const WORKOUT_EXERCISES_KEY = KEYS.legacyExercises;
  const WORKOUT_HISTORY_KEY = KEYS.history;
  const WORKOUT_ACTIVE_KEY = KEYS.active;
  const WORKOUT_ROUTINES_KEY = KEYS.routines;
  const WORKOUT_MIGRATION_KEY = KEYS.migration;
  const LEGACY_ACTIVE_ARCHIVE_KEY = KEYS.legacyActiveArchive;
  const PRESERVED_DATA_KEY = KEYS.preserved;
  const WORKOUT_LIBRARY_KEY = KEYS.library;
  const WORKOUT_PREFERENCES_KEY = KEYS.preferences;

  /* Estado mutável: expõe as referências usadas pelos módulos (F.state). */

/* Normalização e migração de exercícios legados */

function normalizeLegacyExercises(raw) {
  const result = { calisthenics: [], weights: [] };
  if (!isPlainObject(raw)) return result;

  ["calisthenics", "weights"].forEach(mode => {
    if (!Array.isArray(raw[mode])) return;

    raw[mode].forEach((exercise, index) => {
      if (!isPlainObject(exercise)) return;

      const name = typeof exercise.name === "string"
        ? exercise.name.trim().slice(0, 100)
        : "";
      if (!name) return;

      result[mode].push({
        id: typeof exercise.id === "string" && exercise.id
          ? exercise.id
          : "legacy-" + mode + "-" + index,
        name,
        sets: clampInteger(exercise.sets, 1, 30, 4),
        reps: exercise.reps === undefined || exercise.reps === null
          ? "12"
          : String(exercise.reps).trim().slice(0, 30) || "12",
        rest: clampInteger(exercise.rest, 0, 3600, 60),
        load: typeof exercise.load === "string"
          ? exercise.load.trim().slice(0, 50)
          : ""
      });
    });
  });

  return result;
}

function normalizeExercise(raw, fallbackSection) {
  if (!isPlainObject(raw)) return null;

  const name = typeof raw.name === "string"
    ? raw.name.trim().slice(0, 100)
    : "";
  if (!name) return null;

  const type = raw.type === "duration" ? "duration" : "reps";
  const section = SECTION_NAMES[raw.section] ? raw.section : fallbackSection;

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : createId("exercise"),
    name,
    sets: clampInteger(raw.sets, 1, 30, 4),
    type,
    reps: raw.reps === undefined || raw.reps === null
      ? "12"
      : String(raw.reps).trim().slice(0, 30) || "12",
    duration: clampInteger(raw.duration, 1, 7200, 45),
    rest: clampInteger(raw.rest, 0, 3600, 60),
    load: typeof raw.load === "string"
      ? raw.load.trim().slice(0, 50)
      : "",
    notes: typeof raw.notes === "string"
      ? raw.notes.trim().slice(0, 300)
      : "",
    section
  };
}

function normalizeRoutine(raw, modality) {
  if (!isPlainObject(raw)) return null;

  const name = typeof raw.name === "string"
    ? raw.name.trim().slice(0, 60)
    : "";
  if (!name) return null;

  const sections = {};
  const usedIds = new Set();

  SECTION_ORDER.forEach(section => {
    sections[section] = [];
    const list = isPlainObject(raw.sections) && Array.isArray(raw.sections[section])
      ? raw.sections[section]
      : [];

    list.forEach(item => {
      const exercise = normalizeExercise(item, section);
      if (!exercise) return;

      if (usedIds.has(exercise.id)) {
        exercise.id = createId("exercise");
      }
      usedIds.add(exercise.id);
      exercise.section = section;
      sections[section].push(exercise);
    });
  });

  const now = Date.now();

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : createId("routine"),
    name,
    modality,
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
    sections
  };
}

function normalizeRoutinesData(raw) {
  const result = { calisthenics: [], weights: [] };
  if (!isPlainObject(raw)) return result;

  ["calisthenics", "weights"].forEach(mode => {
    if (!Array.isArray(raw[mode])) return;

    raw[mode].forEach(item => {
      const routine = normalizeRoutine(item, mode);
      if (routine) result[mode].push(routine);
    });
  });

  return result;
}

function countRoutineData(raw) {
  const stats = { routines: 0, exercises: 0 };
  if (!isPlainObject(raw)) return stats;

  ["calisthenics", "weights"].forEach(mode => {
    if (!Array.isArray(raw[mode])) return;

    raw[mode].forEach(routine => {
      stats.routines += 1;

      SECTION_ORDER.forEach(section => {
        const list = isPlainObject(routine) &&
          isPlainObject(routine.sections) &&
          Array.isArray(routine.sections[section])
          ? routine.sections[section]
          : [];
        stats.exercises += list.length;
      });
    });
  });

  return stats;
}

function flattenRoutine(routine) {
  if (!routine || !isPlainObject(routine.sections)) return [];

  const list = [];
  SECTION_ORDER.forEach(section => {
    const exercises = Array.isArray(routine.sections[section])
      ? routine.sections[section]
      : [];

    exercises.forEach(exercise => {
      list.push({ ...cloneData(exercise), section });
    });
  });

  return list;
}

function countRoutineExercises(routine) {
  return flattenRoutine(routine).length;
}

function getModeRoutines(modality) {
  return F.state.routines[modality] || [];
}

function findRoutine(modality, routineId) {
  return getModeRoutines(modality).find(routine => routine.id === routineId) || null;
}

function getRoutineById(routineId) {
  for (const mode of ["calisthenics", "weights"]) {
    const routine = findRoutine(mode, routineId);
    if (routine) return routine;
  }
  return null;
}

function getRoutineTotalSets(routine) {
  return flattenRoutine(routine).reduce((total, exercise) => {
    return total + exercise.sets;
  }, 0);
}

function migrateLegacyExercisesToRoutines() {
  const routines = { calisthenics: [], weights: [] };
  const created = [];
  const now = Date.now();

  ["calisthenics", "weights"].forEach(mode => {
    const legacy = F.state.legacyExercises[mode] || [];
    if (legacy.length === 0) return;

    const exercises = legacy.map((exercise, index) => ({
      id: exercise.id || "legacy-" + mode + "-" + index,
      name: exercise.name,
      sets: exercise.sets,
      type: "reps",
      reps: exercise.reps,
      duration: 45,
      rest: exercise.rest,
      load: exercise.load || "",
      notes: "",
      section: "main"
    }));

    const routine = {
      id: createId("routine"),
      name: "Rotina padrão",
      modality: mode,
      createdAt: now,
      updatedAt: now,
      sections: {
        warmup: [],
        main: exercises,
        abs: [],
        finisher: []
      }
    };

    routines[mode].push(routine);
    created.push({
      modality: mode,
      routineId: routine.id,
      name: routine.name,
      exercises: exercises.length
    });
  });

  return { routines, created };
}

function loadRoutines() {
  const stored = parseStorageValue(WORKOUT_ROUTINES_KEY);

  if (stored.exists) {
    if (stored.error) {
      archivePreservedValue(
        WORKOUT_ROUTINES_KEY,
        stored.raw,
        "JSON de rotinas ilegível"
      );
      F.state.bootNotices.push(
        "As rotinas salvas estavam ilegíveis. O conteúdo original foi preservado e uma base vazia foi carregada."
      );
      return { calisthenics: [], weights: [] };
    }

    const normalized = normalizeRoutinesData(stored.value);
    const rawStats = countRoutineData(stored.value);
    const normalizedCount = normalized.calisthenics.length + normalized.weights.length;
    const normalizedExercises = normalized.calisthenics
      .concat(normalized.weights)
      .reduce((total, routine) => total + countRoutineExercises(routine), 0);

    if (
      (rawStats.routines > 0 && normalizedCount === 0) ||
      rawStats.routines > normalizedCount ||
      rawStats.exercises > normalizedExercises
    ) {
      archivePreservedValue(
        WORKOUT_ROUTINES_KEY,
        stored.raw,
        rawStats.routines > 0 && normalizedCount === 0
          ? "Rotinas em formato não reconhecido"
          : "Rotinas parcialmente inválidas"
      );
      F.state.bootNotices.push(
        "Algumas rotinas ou exercícios não puderam ser lidos. O conteúdo original foi preservado."
      );
    }

    return normalized;
  }

  if (F.state.legacyExercisesCorrupt) {
    // Não grava rotinas vazias para não inviabilizar uma migração futura
    // caso o dado antigo seja recuperado manualmente.
    return { calisthenics: [], weights: [] };
  }

  const migrated = migrateLegacyExercisesToRoutines();

  if (migrated.created.length === 0) {
    // Nada a migrar: não cria chave nova só por abrir o site.
    // Assim, um usuário que só usa calendário/missões não tem dados
    // de treino gravados sem ação própria.
    return migrated.routines;
  }

  if (saveJSON(WORKOUT_ROUTINES_KEY, migrated.routines)) {
    recordMigration({
      source: WORKOUT_EXERCISES_KEY,
      routinesCreated: migrated.created
    });
    F.state.bootNotices.push(
      "Seus exercícios antigos foram migrados para uma rotina padrão em cada modalidade."
    );
  }

  return migrated.routines;
}


function countLegacyExercises(raw) {
  if (!isPlainObject(raw)) return { entries: 0 };

  let entries = 0;

  ["calisthenics", "weights"].forEach(mode => {
    if (!Array.isArray(raw[mode])) return;
    entries += raw[mode].length;
  });

  return { entries };
}

function loadLegacyExercises() {
  const stored = parseStorageValue(WORKOUT_EXERCISES_KEY);
  F.state.legacyExercisesCorrupt = false;

  if (!stored.exists) return { calisthenics: [], weights: [] };

  if (stored.error || !isPlainObject(stored.value)) {
    F.state.legacyExercisesCorrupt = true;
    archivePreservedValue(
      WORKOUT_EXERCISES_KEY,
      stored.raw,
      "Exercícios do formato antigo ilegíveis"
    );
    F.state.bootNotices.push(
      "Os exercícios do formato antigo estavam ilegíveis. O conteúdo original foi preservado e nenhuma rotina foi criada automaticamente."
    );
    return { calisthenics: [], weights: [] };
  }

  const normalized = normalizeLegacyExercises(stored.value);
  const rawStats = countLegacyExercises(stored.value);
  const normalizedCount = normalized.calisthenics.length + normalized.weights.length;
  const invalidShape = ["calisthenics", "weights"].some(mode => {
    return stored.value[mode] !== undefined && !Array.isArray(stored.value[mode]);
  });

  if (invalidShape) {
    archivePreservedValue(
      WORKOUT_EXERCISES_KEY,
      stored.raw,
      "Exercícios antigos com estrutura inesperada"
    );
    F.state.bootNotices.push(
      "A estrutura dos exercícios antigos era inesperada. O conteúdo original foi preservado."
    );
  }

  if (rawStats.entries > normalizedCount) {
    archivePreservedValue(
      WORKOUT_EXERCISES_KEY,
      stored.raw,
      "Exercícios antigos parcialmente inválidos"
    );
    F.state.bootNotices.push(
      "Alguns exercícios do formato antigo não puderam ser lidos. O conteúdo original foi preservado."
    );
  }

  return normalized;
}

/* Sessão ativa: leitura, migração e normalização */

function normalizeCompletedSets(raw, queue) {
  const completed = {};
  queue.forEach(exercise => {
    const value = isPlainObject(raw) ? Number(raw[exercise.id]) : 0;
    completed[exercise.id] = Number.isFinite(value)
      ? Math.min(exercise.sets, Math.max(0, Math.floor(value)))
      : 0;
  });
  return completed;
}

function normalizeSessionExercise(raw, fallbackSection) {
  const exercise = normalizeExercise(raw, fallbackSection || "main");
  if (!exercise) return null;

  exercise.section = SECTION_NAMES[raw.section]
    ? raw.section
    : (SECTION_NAMES[fallbackSection] ? fallbackSection : "main");

  return exercise;
}

function normalizeSessionV2(raw) {
  if (!isPlainObject(raw) || !MODE_NAMES[raw.modality]) return null;
  if (!Array.isArray(raw.queue) || raw.queue.length === 0) return null;

  const queue = [];
  raw.queue.forEach(item => {
    const exercise = normalizeSessionExercise(item, "main");
    if (exercise && !queue.some(existing => existing.id === exercise.id)) {
      queue.push(exercise);
    }
  });

  if (queue.length === 0) return null;

  const completedSets = normalizeCompletedSets(raw.completedSets, queue);
  const totalPlannedSets = queue.reduce((sum, exercise) => sum + exercise.sets, 0);
  const currentIndex = clampInteger(raw.currentIndex, 0, queue.length - 1, 0);
  const currentExercise = queue[currentIndex];
  const currentDone = Number(completedSets[currentExercise.id]) || 0;

  let running = raw.running !== false;
  let startedAt = Number(raw.startedAt) || null;
  let elapsedMs = Math.max(0, Number(raw.elapsedMs) || 0);

  if (running && !startedAt) startedAt = Date.now();
  if (!running) startedAt = null;

  let restPaused = Boolean(raw.restPaused);
  let restEndAt = Number(raw.restEndAt) || null;
  let restRemainingMs = Math.max(0, Number(raw.restRemainingMs) || 0);

  if (!running && restEndAt) {
    restRemainingMs = Math.max(0, restEndAt - Date.now());
    restEndAt = null;
    restPaused = true;
  }

  if (restPaused && restRemainingMs <= 0) {
    restPaused = false;
  }

  if (!restPaused) restRemainingMs = 0;

  return {
    version: 2,
    id: typeof raw.id === "string" && raw.id ? raw.id : createId("session"),
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || "")
      ? raw.date
      : dateKey(new Date()),
    modality: raw.modality,
    routineId: typeof raw.routineId === "string" ? raw.routineId : null,
    routineName: typeof raw.routineName === "string" && raw.routineName.trim()
      ? raw.routineName.trim().slice(0, 60)
      : "Treino",
    startedAt,
    elapsedMs,
    running,
    currentIndex,
    completedSets,
    totalPlannedSets,
    queue,
    status: "active",
    restEndAt,
    restRemainingMs,
    restPaused,
    // O avanço pendente precisa sobreviver à pausa (descanso ou sessão).
    // Só é aceito quando o exercício atual realmente terminou, para não
    // pular séries caso o estado salvo esteja inconsistente.
    pendingAdvance: Boolean(raw.pendingAdvance) && currentDone >= currentExercise.sets,
    restPlannedSeconds: clampInteger(raw.restPlannedSeconds, 0, 3600, 0),
    setTimer: normalizeSetTimer(raw.setTimer, queue, completedSets, running),
    setLogs: normalizeSetLogs(raw.setLogs, queue),
    logDraft: normalizeLogDraft(raw.logDraft, queue)
  };
}

/*
  Cronômetro da série (exercícios por duração) e registros de execução.

  O tempo é guardado como `accumulatedMs` + `startedAt` (timestamp). Enquanto
  a série está correndo, `startedAt` é preenchido; pausar a sessão ou a série
  soma o trecho decorrido em `accumulatedMs`. Assim o tempo continua correto
  após recarregar ou trocar de página, sem depender de intervalos.
*/
function normalizeSetTimer(raw, queue, completedSets, running) {
  if (!isPlainObject(raw)) return null;

  const exercise = queue.find(item => item.id === raw.exerciseId);
  if (!exercise || exercise.type !== "duration") return null;

  const done = Number(completedSets[exercise.id]) || 0;
  if (done >= exercise.sets) return null;

  // Um cronômetro de uma série já concluída é descartado (evita contagem dupla).
  const setNumber = done + 1;
  if (clampInteger(raw.setNumber, 1, exercise.sets, 0) !== setNumber) return null;

  const status = raw.status === "paused" ? "paused" : "running";
  let startedAt = Number(raw.startedAt) || null;

  if (!running) startedAt = null;
  if (running && status === "running" && !startedAt) startedAt = Date.now();
  if (status === "paused") startedAt = null;

  return {
    exerciseId: exercise.id,
    setNumber,
    targetMs: exercise.duration * 1000,
    accumulatedMs: Math.max(0, Number(raw.accumulatedMs) || 0),
    startedAt,
    status
  };
}

function normalizeSetLogs(raw, queue) {
  const logs = {};

  queue.forEach(exercise => {
    const list = isPlainObject(raw) && Array.isArray(raw[exercise.id])
      ? raw[exercise.id]
      : [];

    logs[exercise.id] = list
      .filter(isPlainObject)
      .slice(0, exercise.sets)
      .map((entry, index) => ({
        set: clampInteger(entry.set, 1, 30, index + 1),
        reps: typeof entry.reps === "string"
          ? entry.reps.trim().slice(0, 30)
          : (typeof entry.reps === "number" ? String(entry.reps) : ""),
        load: typeof entry.load === "string" ? entry.load.trim().slice(0, 50) : "",
        seconds: Number.isFinite(Number(entry.seconds)) && entry.seconds !== null
          ? Math.max(0, Math.round(Number(entry.seconds)))
          : null
      }));
  });

  return logs;
}

function normalizeLogDraft(raw, queue) {
  const draft = {};

  queue.forEach(exercise => {
    const entry = isPlainObject(raw) && isPlainObject(raw[exercise.id])
      ? raw[exercise.id]
      : null;

    if (!entry) return;

    draft[exercise.id] = {
      reps: typeof entry.reps === "string" ? entry.reps.slice(0, 30) : "",
      load: typeof entry.load === "string" ? entry.load.slice(0, 50) : ""
    };
  });

  return draft;
}

function buildQueueForLegacySession(modality, completedSets) {
  const routines = getModeRoutines(modality).filter(routine => {
    return countRoutineExercises(routine) > 0;
  });

  const completedIds = Object.keys(completedSets || {}).filter(key => {
    return Number(completedSets[key]) > 0;
  });

  const matchingRoutine = routines.find(routine => {
    const ids = flattenRoutine(routine).map(exercise => exercise.id);
    return completedIds.every(id => ids.includes(id));
  });

  if (matchingRoutine) {
    return {
      routine: matchingRoutine,
      queue: flattenRoutine(matchingRoutine)
    };
  }

  const legacy = (F.state.legacyExercises[modality] || []).map(exercise => ({
    ...cloneData(exercise),
    id: exercise.id,
    type: "reps",
    duration: 45,
    notes: "",
    section: "main"
  }));

  if (legacy.length > 0) {
    return { routine: null, queue: legacy };
  }

  if (routines.length > 0) {
    return {
      routine: routines[0],
      queue: flattenRoutine(routines[0])
    };
  }

  return { routine: null, queue: [] };
}

function migrateLegacySession(raw) {
  if (!isPlainObject(raw) || !MODE_NAMES[raw.modality]) return null;

  const built = buildQueueForLegacySession(raw.modality, raw.completedSets);
  const queue = built.queue.filter(Boolean).map(exercise => ({
    ...exercise,
    section: SECTION_NAMES[exercise.section] ? exercise.section : "main"
  }));

  if (queue.length === 0) return null;

  const completedSets = normalizeCompletedSets(raw.completedSets, queue);
  const totalPlannedSets = queue.reduce((sum, exercise) => sum + exercise.sets, 0);

  let currentIndex = queue.findIndex(exercise => {
    return completedSets[exercise.id] < exercise.sets;
  });
  if (currentIndex < 0) currentIndex = queue.length - 1;

  let running = raw.running !== false;
  let startedAt = Number(raw.startedAt) || null;
  let elapsedMs = Math.max(0, Number(raw.elapsedMs) || 0);

  if (running && !startedAt) startedAt = Date.now();
  if (!running) startedAt = null;

  let restPaused = Boolean(raw.restPaused);
  let restEndAt = Number(raw.restEndAt) || null;
  let restRemainingMs = Math.max(0, Number(raw.restRemainingMs) || 0);

  if (!running && restEndAt) {
    restRemainingMs = Math.max(0, restEndAt - Date.now());
    restEndAt = null;
    restPaused = true;
  }

  if (!restPaused) restRemainingMs = 0;

  return {
    version: 2,
    id: typeof raw.id === "string" && raw.id ? raw.id : createId("session"),
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || "")
      ? raw.date
      : dateKey(new Date()),
    modality: raw.modality,
    routineId: built.routine ? built.routine.id : null,
    routineName: built.routine ? built.routine.name : "Treino migrado",
    startedAt,
    elapsedMs,
    running,
    currentIndex,
    completedSets,
    totalPlannedSets,
    queue,
    status: "active",
    restEndAt,
    restRemainingMs,
    restPaused,
    pendingAdvance: false,
    restPlannedSeconds: 0,
    setTimer: null,
    setLogs: {},
    logDraft: {}
  };
}

function loadActiveWorkout() {
  const stored = parseStorageValue(WORKOUT_ACTIVE_KEY);
  if (!stored.exists) return null;

  if (stored.error) {
    archivePreservedValue(
      WORKOUT_ACTIVE_KEY,
      stored.raw,
      "Sessão ativa ilegível"
    );
    removeStorageKey(WORKOUT_ACTIVE_KEY);
    F.state.bootNotices.push(
      "A sessão ativa estava ilegível. Ela foi preservada no histórico de dados e não será retomada."
    );
    return null;
  }

  if (!isPlainObject(stored.value)) {
    archivePreservedValue(
      WORKOUT_ACTIVE_KEY,
      stored.raw,
      "Sessão ativa em formato inválido"
    );
    removeStorageKey(WORKOUT_ACTIVE_KEY);
    F.state.bootNotices.push(
      "A sessão ativa em formato inválido foi preservada e removida da tela."
    );
    return null;
  }

  if (stored.value.version === 2) {
    const rawQueueLength = Array.isArray(stored.value.queue)
      ? stored.value.queue.length
      : 0;
    const rawCompleted = Object.values(
      isPlainObject(stored.value.completedSets) ? stored.value.completedSets : {}
    ).reduce((sum, count) => sum + (Number(count) || 0), 0);

    const normalized = normalizeSessionV2(stored.value);
    if (!normalized) {
      archivePreservedValue(
        WORKOUT_ACTIVE_KEY,
        stored.raw,
        "Sessão ativa incompleta"
      );
      removeStorageKey(WORKOUT_ACTIVE_KEY);
      F.state.bootNotices.push(
        "A sessão ativa não pôde ser recuperada com segurança. O conteúdo foi preservado."
      );
      return null;
    }

    const normalizedCompleted = totalCompletedSets(normalized);

    if (
      normalized.queue.length < rawQueueLength ||
      normalizedCompleted < rawCompleted
    ) {
      archivePreservedValue(
        WORKOUT_ACTIVE_KEY,
        stored.raw,
        "Sessão ativa com exercícios ou progresso não reconhecidos"
      );
      F.state.bootNotices.push(
        "Parte da sessão ativa não pôde ser lida. O conteúdo original foi preservado antes de continuar."
      );
    }

    return normalized;
  }

  const migrated = migrateLegacySession(stored.value);

  if (!migrated) {
    archivePreservedValue(
      WORKOUT_ACTIVE_KEY,
      stored.raw,
      "Sessão legada sem exercícios recuperáveis"
    );
    archivePreservedValue(
      LEGACY_ACTIVE_ARCHIVE_KEY,
      stored.raw,
      "Sessão ativa no formato anterior"
    );
    removeStorageKey(WORKOUT_ACTIVE_KEY);
    F.state.bootNotices.push(
      "Uma sessão ativa do formato anterior não pôde ser retomada. O conteúdo original foi preservado nos dados do navegador."
    );
    return null;
  }

  saveJSON(LEGACY_ACTIVE_ARCHIVE_KEY, {
    archivedAt: new Date().toISOString(),
    session: stored.value
  });

  if (saveJSON(WORKOUT_ACTIVE_KEY, migrated)) {
    recordMigration({
      activeSessionMigratedAt: new Date().toISOString(),
      legacyActivePreservedIn: LEGACY_ACTIVE_ARCHIVE_KEY
    });
    F.state.bootNotices.push(
      "Sua sessão ativa anterior foi preservada e retomada no novo formato."
    );
  }

  return migrated;
}

function saveActiveWorkout() {
  if (!F.state.activeWorkout) {
    return removeStorageKey(WORKOUT_ACTIVE_KEY);
  }
  return saveJSON(WORKOUT_ACTIVE_KEY, F.state.activeWorkout);
}

function getElapsedMs() {
  if (!F.state.activeWorkout) return 0;

  let elapsed = Number(F.state.activeWorkout.elapsedMs) || 0;

  if (F.state.activeWorkout.running && F.state.activeWorkout.startedAt) {
    elapsed += Math.max(0, Date.now() - F.state.activeWorkout.startedAt);
  }

  return elapsed;
}

function getRestRemainingMs() {
  if (!F.state.activeWorkout) return 0;

  if (F.state.activeWorkout.restEndAt && !F.state.activeWorkout.restPaused) {
    return Math.max(0, F.state.activeWorkout.restEndAt - Date.now());
  }

  return Math.max(0, Number(F.state.activeWorkout.restRemainingMs) || 0);
}

function hasRestState() {
  if (!F.state.activeWorkout) return false;
  return Boolean(
    F.state.activeWorkout.restEndAt ||
    (F.state.activeWorkout.restPaused && F.state.activeWorkout.restRemainingMs > 0)
  );
}

function totalCompletedSets(session = F.state.activeWorkout) {
  if (!session) return 0;
  return Object.values(session.completedSets || {}).reduce((sum, count) => {
    return sum + (Number(count) || 0);
  }, 0);
}

function currentSessionExercise() {
  if (!F.state.activeWorkout || !Array.isArray(F.state.activeWorkout.queue)) return null;
  return F.state.activeWorkout.queue[F.state.activeWorkout.currentIndex] || null;
}

function completedExerciseCount(session) {
  if (!session || !Array.isArray(session.queue)) return 0;
  return session.queue.filter(exercise => {
    return (Number(session.completedSets[exercise.id]) || 0) >= exercise.sets;
  }).length;
}



/* Biblioteca personalizada: exercícios salvos pelo usuário por modalidade. */

function normalizeLibraryItem(raw, mode) {
  if (!isPlainObject(raw)) return null;

  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 100) : "";
  if (!name) return null;

  const type = raw.type === "duration" ? "duration" : "reps";

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : createId("lib-" + mode),
    name,
    type,
    sets: clampInteger(raw.sets, 1, 30, 3),
    reps: type === "reps"
      ? (String(raw.reps === undefined || raw.reps === null ? "10" : raw.reps).trim().slice(0, 30) || "10")
      : "",
    duration: clampInteger(raw.duration, 1, 7200, 45),
    rest: clampInteger(raw.rest, 0, 3600, 60),
    section: SECTION_NAMES[raw.section] ? raw.section : "main"
  };
}

function loadLibrary() {
  const empty = { calisthenics: [], weights: [] };
  const stored = parseStorageValue(WORKOUT_LIBRARY_KEY);

  if (!stored.exists) return empty;

  if (stored.error || !isPlainObject(stored.value)) {
    archivePreservedValue(WORKOUT_LIBRARY_KEY, stored.raw, "Biblioteca personalizada ilegível");
    F.state.bootNotices.push(
      "A biblioteca personalizada estava ilegível. O conteúdo original foi preservado."
    );
    return empty;
  }

  const result = { calisthenics: [], weights: [] };
  let rawCount = 0;
  let validCount = 0;

  ["calisthenics", "weights"].forEach(mode => {
    if (!Array.isArray(stored.value[mode])) return;

    stored.value[mode].forEach(item => {
      rawCount += 1;
      const normalized = normalizeLibraryItem(item, mode);
      if (normalized) {
        result[mode].push(normalized);
        validCount += 1;
      }
    });
  });

  if (validCount < rawCount) {
    archivePreservedValue(WORKOUT_LIBRARY_KEY, stored.raw, "Biblioteca personalizada parcialmente inválida");
    F.state.bootNotices.push(
      "Alguns exercícios da biblioteca não puderam ser lidos. O conteúdo original foi preservado."
    );
  }

  return result;
}

function saveLibrary(library) {
  return saveJSON(WORKOUT_LIBRARY_KEY, library);
}

/* Preferências: somente leitura com padrões seguros; a chave só é gravada pelo usuário. */

function loadPreferences() {
  const defaults = { soundOnRest: true, vibrateOnRest: true };
  const stored = parseStorageValue(WORKOUT_PREFERENCES_KEY);

  if (!stored.exists || stored.error || !isPlainObject(stored.value)) {
    return defaults;
  }

  return {
    soundOnRest: stored.value.soundOnRest !== false,
    vibrateOnRest: stored.value.vibrateOnRest !== false
  };
}

function savePreferences(preferences) {
  const next = {
    soundOnRest: Boolean(preferences.soundOnRest),
    vibrateOnRest: Boolean(preferences.vibrateOnRest)
  };

  F.state.preferences = next;
  return saveJSON(WORKOUT_PREFERENCES_KEY, next);
}

/* Carregamento inicial (executado uma vez por página, antes do módulo da página). */

F.bootData = function bootData() {
  F.state.bootNotices = [];

  F.state.legacyExercises = loadLegacyExercises();
  F.state.routines = loadRoutines();

  const historyStored = parseStorageValue(WORKOUT_HISTORY_KEY);

  if (!historyStored.exists) {
    F.state.history = [];
  } else if (historyStored.error) {
    archivePreservedValue(WORKOUT_HISTORY_KEY, historyStored.raw, "Histórico ilegível");
    F.state.history = [];
    F.state.bootNotices.push(
      "O histórico de treinos estava ilegível. O conteúdo original foi preservado."
    );
  } else if (!Array.isArray(historyStored.value)) {
    archivePreservedValue(WORKOUT_HISTORY_KEY, historyStored.raw, "Histórico em formato inválido");
    F.state.history = [];
    F.state.bootNotices.push(
      "O histórico de treinos estava em formato inválido. O conteúdo original foi preservado."
    );
  } else {
    F.state.history = historyStored.value;
  }

  F.state.library = loadLibrary();
  F.state.preferences = loadPreferences();
  F.state.activeWorkout = loadActiveWorkout();

  return F.state;
};

F.saveRoutines = function saveRoutines() {
  return saveJSON(WORKOUT_ROUTINES_KEY, F.state.routines);
};

F.saveLibrary = saveLibrary;
F.savePreferences = savePreferences;
F.saveActiveWorkout = saveActiveWorkout;

Object.assign(F, {
  normalizeExercise,
  normalizeRoutine,
  normalizeLibraryItem,
  flattenRoutine,
  countRoutineExercises,
  countRoutineData,
  getModeRoutines,
  findRoutine,
  getRoutineById,
  getRoutineTotalSets,
  normalizeSessionV2,
  getElapsedMs,
  getRestRemainingMs,
  hasRestState,
  totalCompletedSets,
  currentSessionExercise,
  completedExerciseCount,
  loadLibrary,
  loadPreferences,
  removeStorageKey
});

})(window);
