/*
  FORJA — modelos e regras de dados: normalização, validação e migração.

  Preserva as chaves e os formatos antigos (forja-treino-exercicios-v1,
  forja-treino-historico-v1, forja-treino-sessao-ativa-v1). Nada é apagado:
  conteúdo ilegível ou não reconhecido é arquivado antes de qualquer
  normalização (ver docs/forja-rotinas-e-backup.md, seção 2).

  A persistência em si (ler/gravar/listar/transações) está em `forja-store.js`;
  este módulo decide *o que* cada chave significa. Ao final ele registra as
  descrições de chave (usada também pela validação de backup) e as migrações
  do formato de dados.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const {
    KEYS,
    SECTION_ORDER,
    SECTION_NAMES,
    MODE_NAMES,
    MEASURE_NAMES,
    isPlainObject,
    cloneData,
    createId,
    clampInteger,
    dateKey,
    MISSION_KEY_PATTERN,
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
  const WORKOUT_GOALS_KEY = KEYS.goals;

  const MODALITIES = ["calisthenics", "weights"];

  /* Estado mutável: expõe as referências usadas pelos módulos (F.state). */

/* ------------------------------------------------------------------ */
/* Campo de carga: texto digitado + número derivado                     */
/* ------------------------------------------------------------------ */

/*
  `load` continua sendo o texto digitado pelo usuário (formato antigo
  preservado). `loadKg` é derivado dele: número em quilogramas quando o texto
  traz um valor numérico claro (ex.: "80 kg", "2x12,5 kg", "45"), `null`
  quando não é possível afirmar. Cálculos de volume só usam o que for número,
  então nada aqui é estimado.
*/
function parseLoadKg(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  }

  if (typeof value !== "string" || !value.trim()) return null;

  const text = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  if (/^\d+\s*(lb|lbs|libras)$/.test(text.trim())) {
    const pounds = Number(text.replace(/[^\d.]/g, ""));
    return Number.isFinite(pounds) && pounds > 0 ? Math.round(pounds * 0.45359237 * 100) / 100 : null;
  }

  if (/[^0-9.,\sxkglb+]/.test(text)) return null;

  const matches = text.match(/(\d+(?:[.,]\d+)?)/g);
  if (!matches || matches.length === 0) return null;

  const numbers = matches.map(item => Number(item.replace(",", "."))).filter(Number.isFinite);
  if (numbers.length === 0) return null;

  /* "2x12,5" ou "2 × 12,5 kg": o maior número é a carga por halute/barra. */
  const kg = Math.max(...numbers);
  if (kg <= 0 || kg > 2000) return null;

  return Math.round(kg * 100) / 100;
}

/* Reps: aceita "12", "8-12", "12, 10, 8" e devolve o máximo numérico. */
function parseMaxReps(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }

  if (typeof value !== "string") return null;

  const numbers = value.match(/\d+/g);
  if (!numbers) return null;

  const parsed = numbers.map(Number).filter(Number.isFinite);
  if (parsed.length === 0) return null;

  const max = Math.max(...parsed);
  return max > 0 && max <= 999 ? max : null;
}

function normalizeMeasure(raw, exercise) {
  const allowed = Object.keys(MEASURE_NAMES);
  const explicit = allowed.indexOf(raw) !== -1 ? raw : null;

  if (explicit) return explicit;

  /* Sem campo gravado: deriva do tipo e da presença de carga, sem inventar. */
  if (exercise && exercise.type === "duration") return "time";
  if (exercise && exercise.load && String(exercise.load).trim()) return "load";
  return "reps";
}

function normalizeOptionalText(value, limit) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, limit);
}

function normalizeStringList(value, limit, itemLimit) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const out = [];

  value.forEach(item => {
    const text = normalizeOptionalText(typeof item === "string" ? item : "", itemLimit);
    if (!text) return;

    const key = text.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    out.push(text);
  });

  return out.slice(0, limit);
}

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
    section,
    /* Campos aditivos (formato 3). Ausentes no legado: derivados acima. */
    measure: normalizeMeasure(raw.measure, raw),
    distance: Number.isFinite(Number(raw.distance)) && Number(raw.distance) > 0
      ? Math.min(100000, Math.max(1, Math.round(Number(raw.distance))))
      : null,
    distanceUnit: raw.distanceUnit === "km" ? "km" : "m",
    libraryId: typeof raw.libraryId === "string" && raw.libraryId ? raw.libraryId : null,
    instructions: normalizeOptionalText(raw.instructions, 600)
  };
}

/*
  Métricas derivadas de um exercício, usadas pela biblioteca, pelo resumo da
  rotina e pelos cálculos de volume. Não grava nada: é cálculo sobre o que já
  está normalizado.
*/
function exerciseTarget(exercise) {
  if (!exercise) return null;

  if (exercise.type === "duration") {
    return { kind: "time", seconds: Number(exercise.duration) || 0 };
  }

  if (exercise.measure === "distance" && exercise.distance) {
    return {
      kind: "distance",
      meters: exercise.distanceUnit === "km"
        ? Math.round(exercise.distance * 1000)
        : exercise.distance
    };
  }

  const reps = parseMaxReps(exercise.reps);
  return { kind: "reps", reps };
}

function exercisePlannedLoadKg(exercise) {
  return parseLoadKg(exercise && exercise.load);
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

    const exercises = legacy
      .map((exercise, index) => normalizeExercise({
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
      }, "main"))
      .filter(Boolean);

    if (exercises.length === 0) return;

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

  /*
    Sem a chave de rotinas: o estado é vazio e o runner de migrações decide se
    há uma base antiga a promover (ver `rotinas-a-partir-do-legado` abaixo).
    Quando o dado antigo está ilegível, nada é gravado — uma promoção futura
    continua possível se o usuário recuperar a chave manualmente.
  */
  return { calisthenics: [], weights: [] };
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
    logDraft: normalizeLogDraft(raw.logDraft, queue),
    /*
      `revision` marca o formato 3 de forma aditiva: quem lê `version` continua
      vendo 2, então uma versão anterior do app retoma a sessão normalmente e
      apenas ignora os campos novos.
    */
    revision: 3,
    feedback: normalizeSessionFeedback(raw.feedback)
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
          : null,
        /* Campos aditivos da versão 3 do formato de sessão. */
        distance: Number.isFinite(Number(entry.distance)) && Number(entry.distance) > 0
          ? Math.min(100000, Math.max(1, Math.round(Number(entry.distance))))
          : null,
        rpe: clampInteger(entry.rpe, 1, 10, 0) || null,
        editedAt: Number(entry.editedAt) || null
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
      load: typeof entry.load === "string" ? entry.load.slice(0, 50) : "",
      distance: Number.isFinite(Number(entry.distance)) && Number(entry.distance) > 0
        ? String(Math.round(Number(entry.distance)))
        : "",
      rpe: clampInteger(entry.rpe, 1, 10, 0) || ""
    };
  });

  return draft;
}

/* Nota e percepção de esforço da sessão inteira (opcional, nunca estimada). */
function normalizeSessionFeedback(raw) {
  if (!isPlainObject(raw)) return null;

  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 300) : "";
  const rpe = clampInteger(raw.rpe, 1, 10, 0);

  if (!note && !rpe) return null;

  return {
    note,
    rpe: rpe || null,
    updatedAt: Number(raw.updatedAt) || Date.now()
  };
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
    section: SECTION_NAMES[raw.section] ? raw.section : "main",
    /* Metadados do catálogo (opcionais; ausentes no formato antigo). */
    load: typeof raw.load === "string" ? raw.load.trim().slice(0, 50) : "",
    notes: typeof raw.notes === "string" ? raw.notes.trim().slice(0, 300) : "",
    measure: normalizeMeasure(raw.measure, raw),
    distance: Number.isFinite(Number(raw.distance)) && Number(raw.distance) > 0
      ? Math.min(100000, Math.max(1, Math.round(Number(raw.distance))))
      : null,
    distanceUnit: raw.distanceUnit === "km" ? "km" : "m",
    category: normalizeOptionalText(raw.category, 40),
    muscles: normalizeStringList(raw.muscles, 6, 28),
    equipment: normalizeStringList(raw.equipment, 6, 28),
    instructions: normalizeOptionalText(raw.instructions, 600),
    createdAt: Number(raw.createdAt) || null,
    updatedAt: Number(raw.updatedAt) || null
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

/* ------------------------------------------------------------------ */
/* Metas semanais (chave nova, aditiva)                                 */
/* ------------------------------------------------------------------ */

/*
  Metas configuráveis, medidas sobre o histórico real. `modality` define o
  escopo ("all" conta qualquer treino). Alvo 0 desativa o acompanhamento daquele
  item — não existe meta "padrão" inventada.
*/
const GOAL_TARGET_LIMIT = 50;

function normalizeGoals(raw) {
  const base = {
    version: 1,
    updatedAt: null,
    modality: "all",
    weeklySessions: 0,
    weeklySets: 0,
    weeklyMinutes: 0
  };

  if (!isPlainObject(raw)) return base;

  const modality = raw.modality === "calisthenics" || raw.modality === "weights"
    ? raw.modality
    : "all";

  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    modality,
    weeklySessions: clampInteger(raw.weeklySessions, 0, GOAL_TARGET_LIMIT, 0),
    weeklySets: clampInteger(raw.weeklySets, 0, GOAL_TARGET_LIMIT * 30, 0),
    weeklyMinutes: clampInteger(raw.weeklyMinutes, 0, 7 * 60 * 24, 0)
  };
}

function loadGoals() {
  const stored = parseStorageValue(WORKOUT_GOALS_KEY);

  if (!stored.exists) return normalizeGoals(null);

  if (stored.error || !isPlainObject(stored.value)) {
    archivePreservedValue(WORKOUT_GOALS_KEY, stored.raw, "Metas em formato inválido");
    F.state.bootNotices.push(
      "As metas salvas estavam ilegíveis. O conteúdo original foi preservado e as metas foram desativadas."
    );
    return normalizeGoals(null);
  }

  return normalizeGoals(stored.value);
}

function saveGoals(goals) {
  const next = normalizeGoals(Object.assign({}, F.state.goals, goals, {
    updatedAt: new Date().toISOString()
  }));

  F.state.goals = next;
  return saveJSON(WORKOUT_GOALS_KEY, next);
}

function goalsAreActive(goals) {
  const current = goals || F.state.goals;

  if (!current) return false;
  return current.weeklySessions > 0 || current.weeklySets > 0 || current.weeklyMinutes > 0;
}

/* ------------------------------------------------------------------ */
/* Validação compartilhada: boot, auditoria e backup usam as mesmas regras*/
/* ------------------------------------------------------------------ */

function assertExerciseShape(exercise, where) {
  if (!isPlainObject(exercise)) throw new Error("Exercício inválido em " + where + ".");
  if (typeof exercise.name !== "string" || !exercise.name.trim()) {
    throw new Error("Exercício sem nome em " + where + ".");
  }

  const sets = Number(exercise.sets);
  if (!Number.isInteger(sets) || sets < 1 || sets > 30) {
    throw new Error("Exercício com séries inválidas em " + where + ".");
  }

  if (exercise.type !== undefined && exercise.type !== "reps" && exercise.type !== "duration") {
    throw new Error("Exercício com tipo inválido em " + where + ".");
  }

  if (exercise.rest !== undefined) {
    const rest = Number(exercise.rest);
    if (!Number.isFinite(rest) || rest < 0 || rest > 3600) {
      throw new Error("Exercício com descanso inválido em " + where + ".");
    }
  }

  if (exercise.type === "duration") {
    const duration = Number(exercise.duration);
    if (!Number.isFinite(duration) || duration < 1 || duration > 7200) {
      throw new Error("Exercício com duração inválida em " + where + ".");
    }
  } else if (exercise.reps !== undefined &&
    typeof exercise.reps !== "string" &&
    typeof exercise.reps !== "number") {
    throw new Error("Exercício com repetições inválidas em " + where + ".");
  }

  if (exercise.load !== undefined && typeof exercise.load !== "string") {
    throw new Error("Exercício com carga inválida em " + where + ".");
  }

  if (exercise.notes !== undefined && typeof exercise.notes !== "string") {
    throw new Error("Exercício com observações inválidas em " + where + ".");
  }

  if (exercise.measure !== undefined && MEASURE_NAMES[exercise.measure] === undefined) {
    throw new Error("Exercício com medição desconhecida em " + where + ".");
  }

  if (exercise.distance !== undefined && exercise.distance !== null) {
    const distance = Number(exercise.distance);
    if (!Number.isFinite(distance) || distance < 1 || distance > 100000) {
      throw new Error("Exercício com distância inválida em " + where + ".");
    }
  }

  ["muscles", "equipment", "category", "instructions"].forEach(field => {
    if (exercise[field] === undefined) return;

    if (field === "muscles" || field === "equipment") {
      if (!Array.isArray(exercise[field]) || exercise[field].some(item => typeof item !== "string")) {
        throw new Error("Exercício com lista de " + field + " inválida em " + where + ".");
      }
      return;
    }

    if (typeof exercise[field] !== "string") {
      throw new Error("Exercício com \"" + field + "\" inválido em " + where + ".");
    }
  });

  return true;
}

function validateRoutinesStore(value, label) {
  if (!isPlainObject(value)) throw new Error(label + " estão em formato inválido.");

  MODALITIES.forEach(mode => {
    if (value[mode] === undefined) return;
    if (!Array.isArray(value[mode])) {
      throw new Error("A lista de " + label.toLowerCase() + " de " + MODE_NAMES[mode] + " é inválida.");
    }

    value[mode].forEach((routine, index) => {
      if (!isPlainObject(routine)) throw new Error("A rotina " + (index + 1) + " do backup é inválida.");

      if (typeof routine.name !== "string" || !routine.name.trim()) {
        throw new Error("A rotina " + (index + 1) + " do backup não tem nome.");
      }

      if (routine.sections === undefined) return;

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
          assertExerciseShape(exercise, routine.name + " / " + SECTION_NAMES[section]);
        });
      });
    });
  });

  return true;
}

function validateHistoryList(value) {
  if (!Array.isArray(value)) throw new Error("O histórico de treinos do backup é inválido.");

  value.forEach((record, index) => {
    if (!isPlainObject(record)) throw new Error("O registro " + (index + 1) + " do histórico é inválido.");

    if (!MODE_NAMES[record.modality]) {
      throw new Error("O registro " + (index + 1) + " do histórico tem modalidade inválida.");
    }

    if (record.completedSets !== undefined &&
      (!Number.isFinite(Number(record.completedSets)) || Number(record.completedSets) < 0)) {
      throw new Error("O registro " + (index + 1) + " tem séries concluídas inválidas.");
    }

    if (record.durationMs !== undefined &&
      (!Number.isFinite(Number(record.durationMs)) || Number(record.durationMs) < 0)) {
      throw new Error("O registro " + (index + 1) + " tem duração inválida.");
    }

    if (record.status !== undefined &&
      record.status !== "completed" && record.status !== "partial") {
      throw new Error("O registro " + (index + 1) + " tem status inválido.");
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

  return true;
}

function validateActiveSession(value) {
  if (!isPlainObject(value)) throw new Error("A sessão ativa do backup é inválida.");
  if (!MODE_NAMES[value.modality]) throw new Error("A sessão ativa do backup tem modalidade inválida.");

  if (value.version === 2) {
    if (!Array.isArray(value.queue) || value.queue.length === 0) {
      throw new Error("A sessão ativa do backup não tem exercícios.");
    }

    value.queue.forEach(exercise => assertExerciseShape(exercise, "sessão ativa"));

    if (!Number.isInteger(Number(value.currentIndex)) ||
      Number(value.currentIndex) < 0 ||
      Number(value.currentIndex) >= value.queue.length) {
      throw new Error("A posição atual da sessão ativa é inválida.");
    }
  }

  if (!isPlainObject(value.completedSets)) {
    throw new Error("O progresso da sessão ativa é inválido.");
  }

  return true;
}

function validateLibraryStore(value) {
  if (!isPlainObject(value) || !Array.isArray(value.calisthenics) || !Array.isArray(value.weights)) {
    throw new Error("A biblioteca de exercícios do FORJA está em formato inválido.");
  }

  MODALITIES.forEach(mode => {
    value[mode].forEach((item, index) => {
      if (!isPlainObject(item)) {
        throw new Error("O exercício personalizado " + (index + 1) + " de " +
          MODE_NAMES[mode] + " é inválido.");
      }

      if (typeof item.name !== "string" || !item.name.trim()) {
        throw new Error("Um exercício personalizado de " + MODE_NAMES[mode] + " está sem nome.");
      }
    });
  });

  return true;
}

function validateGoalsStore(value) {
  if (!isPlainObject(value)) throw new Error("As metas semanais do FORJA estão em formato inválido.");

  ["weeklySessions", "weeklySets", "weeklyMinutes"].forEach(field => {
    if (value[field] === undefined) return;

    const number = Number(value[field]);

    if (!Number.isFinite(number) || number < 0 || number > GOAL_TARGET_LIMIT * 30) {
      throw new Error("A meta \"" + field + "\" está fora do intervalo permitido.");
    }
  });

  if (value.modality !== undefined &&
    value.modality !== "all" && !MODE_NAMES[value.modality]) {
    throw new Error("As metas apontam para uma modalidade desconhecida.");
  }

  return true;
}

function validateLegacyExercises(value) {
  if (!isPlainObject(value)) throw new Error("Os exercícios antigos do backup estão em formato inválido.");

  MODALITIES.forEach(mode => {
    if (value[mode] === undefined) return;

    if (!Array.isArray(value[mode])) {
      throw new Error("A lista de exercícios antigos de " + MODE_NAMES[mode] + " é inválida.");
    }

    value[mode].forEach((exercise, index) => {
      if (!isPlainObject(exercise) || typeof exercise.name !== "string" || !exercise.name.trim()) {
        throw new Error("O exercício antigo " + (index + 1) + " é inválido.");
      }

      if (exercise.sets !== undefined &&
        (!Number.isInteger(Number(exercise.sets)) ||
          Number(exercise.sets) < 1 || Number(exercise.sets) > 30)) {
        throw new Error("Um exercício antigo tem número de séries inválido.");
      }

      if (exercise.rest !== undefined &&
        (!Number.isFinite(Number(exercise.rest)) ||
          Number(exercise.rest) < 0 || Number(exercise.rest) > 3600)) {
        throw new Error("Um exercício antigo tem descanso inválido.");
      }
    });
  });

  return true;
}

function validateAuxiliaryValue(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    throw new Error("Os dados auxiliares do FORJA estão em formato inválido.");
  }

  return true;
}

/* Missões e calendário: validação e resumo usados pelo backup. */
function validateMissionList(key, value) {
  if (!Array.isArray(value)) throw new Error("A lista de missões de " + key + " é inválida.");

  value.forEach((task, index) => {
    if (typeof task === "string") return;

    if (!isPlainObject(task)) throw new Error("A missão " + (index + 1) + " de " + key + " é inválida.");
    if (typeof task.text !== "string" && typeof task.title !== "string") {
      throw new Error("Uma missão de " + key + " não tem texto.");
    }
    if (task.done !== undefined && typeof task.done !== "boolean") {
      throw new Error("Uma missão de " + key + " tem estado inválido.");
    }
  });

  return true;
}

function summarizeMissionList(key, value) {
  return {
    label: "Missões de " + key.slice("forja-missoes-".length),
    detail: (Array.isArray(value) ? value.length : 0) + " item(ns)"
  };
}

/* ------------------------------------------------------------------ */
/* Registro das chaves no store                                         */
/* ------------------------------------------------------------------ */

function emptyByModality() {
  return { calisthenics: [], weights: [] };
}

F.registry.register({
  id: "legacyExercises",
  key: WORKOUT_EXERCISES_KEY,
  label: "Exercícios do formato anterior",
  empty: emptyByModality,
  read: loadLegacyExercises,
  validate: validateLegacyExercises,
  /* Somente leitura: o app nunca reescreve esta chave. */
  writable: false,
  summarize(value) {
    return {
      label: "Exercícios antigos preservados",
      detail: countLegacyExercises(value).entries + " item(ns)"
    };
  }
});

F.registry.register({
  id: "routines",
  key: WORKOUT_ROUTINES_KEY,
  label: "Rotinas",
  empty: emptyByModality,
  read: loadRoutines,
  validate(value) {
    return validateRoutinesStore(value, "As rotinas do backup");
  },
  persist: () => saveJSON(WORKOUT_ROUTINES_KEY, F.state.routines),
  summarize(value) {
    const stats = countRoutineData(value);
    return {
      label: "Rotinas",
      detail: stats.routines + " rotina(s) com " + stats.exercises + " exercício(s)"
    };
  }
});

F.registry.register({
  id: "history",
  key: WORKOUT_HISTORY_KEY,
  label: "Histórico de treinos",
  empty: () => [],
  read() {
    const stored = parseStorageValue(WORKOUT_HISTORY_KEY);

    if (!stored.exists) return [];

    if (stored.error) {
      archivePreservedValue(WORKOUT_HISTORY_KEY, stored.raw, "Histórico ilegível");
      F.state.bootNotices.push(
        "O histórico de treinos estava ilegível. O conteúdo original foi preservado."
      );
      return [];
    }

    if (!Array.isArray(stored.value)) {
      archivePreservedValue(WORKOUT_HISTORY_KEY, stored.raw, "Histórico em formato inválido");
      F.state.bootNotices.push(
        "O histórico de treinos estava em formato inválido. O conteúdo original foi preservado."
      );
      return [];
    }

    return stored.value;
  },
  validate: validateHistoryList,
  persist: () => saveJSON(WORKOUT_HISTORY_KEY, F.state.history),
  summarize(value) {
    const byMode = { calisthenics: 0, weights: 0 };

    if (Array.isArray(value)) {
      value.forEach(record => {
        if (isPlainObject(record) && MODE_NAMES[record.modality]) byMode[record.modality] += 1;
      });
    }

    return {
      label: "Histórico",
      detail: (Array.isArray(value) ? value.length : 0) + " treino(s) (Calistenia: " +
        byMode.calisthenics + ", Musculação: " + byMode.weights + ")"
    };
  }
});

F.registry.register({
  id: "library",
  key: WORKOUT_LIBRARY_KEY,
  label: "Biblioteca personalizada",
  empty: emptyByModality,
  read: loadLibrary,
  validate: validateLibraryStore,
  persist: () => saveJSON(WORKOUT_LIBRARY_KEY, F.state.library),
  summarize(value) {
    const total = MODALITIES.reduce((sum, mode) => {
      return sum + (isPlainObject(value) && Array.isArray(value[mode]) ? value[mode].length : 0);
    }, 0);

    return { label: "Biblioteca personalizada", detail: total + " exercício(s)" };
  }
});

F.registry.register({
  id: "goals",
  key: WORKOUT_GOALS_KEY,
  label: "Metas semanais",
  empty: () => normalizeGoals(null),
  read: loadGoals,
  validate: validateGoalsStore,
  persist: () => saveJSON(WORKOUT_GOALS_KEY, F.state.goals),
  summarize(value) {
    const goals = normalizeGoals(value);
    const parts = [];

    if (goals.weeklySessions > 0) parts.push(goals.weeklySessions + " treino(s)/semana");
    if (goals.weeklySets > 0) parts.push(goals.weeklySets + " série(s)/semana");
    if (goals.weeklyMinutes > 0) parts.push(goals.weeklyMinutes + " min/semana");

    return {
      label: "Metas",
      detail: parts.length
        ? parts.join(" · ") + " (" + (MODE_NAMES[goals.modality] || "todas") + ")"
        : "nenhuma meta ativa"
    };
  }
});

F.registry.register({
  id: "preferences",
  key: WORKOUT_PREFERENCES_KEY,
  label: "Preferências",
  empty: () => ({ soundOnRest: true, vibrateOnRest: true }),
  read: loadPreferences,
  validate(value) {
    if (!isPlainObject(value)) throw new Error("As preferências do FORJA estão em formato inválido.");
    return true;
  },
  persist: () => saveJSON(WORKOUT_PREFERENCES_KEY, F.state.preferences),
  summarize() {
    return { label: "Preferências", detail: "som e vibração do descanso" };
  }
});

F.registry.register({
  id: "active",
  key: WORKOUT_ACTIVE_KEY,
  label: "Sessão ativa",
  empty: () => null,
  read: loadActiveWorkout,
  validate: validateActiveSession,
  persist: saveActiveWorkout,
  summarize(value) {
    if (!isPlainObject(value)) return null;

    return {
      label: "Sessão ativa",
      detail: (MODE_NAMES[value.modality] || "modalidade desconhecida") + " · " +
        (value.routineName || "Treino") + (value.version !== 2 ? " (formato antigo)" : "")
    };
  }
});

/*
  Chaves de arquivo: o app não as reinterpreta no boot, mas o backup as
  valida e preserva exatamente como vieram.
*/
[
  { id: "migration", key: WORKOUT_MIGRATION_KEY, label: "Registro de migração" },
  { id: "legacyActiveArchive", key: LEGACY_ACTIVE_ARCHIVE_KEY, label: "Sessão antiga arquivada" },
  { id: "preserved", key: PRESERVED_DATA_KEY, label: "Dados preservados" }
].forEach(entry => {
  F.registry.register({
    id: entry.id,
    key: entry.key,
    label: entry.label,
    empty: () => null,
    read: () => null,
    validate: validateAuxiliaryValue,
    writable: false
  });
});

/* ------------------------------------------------------------------ */
/* Migrações do formato de dados                                        */
/* ------------------------------------------------------------------ */

/*
  1 → 2: os exercícios soltos do formato anterior viram uma "Rotina padrão" por
  modalidade. A chave antiga permanece byte a byte. Só roda enquanto a chave de
  rotinas não existir, o que torna o passo idempotente.
*/
F.schema.register({
  id: "rotinas-a-partir-do-legado",
  from: 1,
  to: 2,
  description: "Exercícios do formato anterior promovidos a uma rotina padrão por modalidade.",
  applies() {
    if (parseStorageValue(WORKOUT_ROUTINES_KEY).exists) return false;
    if (F.state.legacyExercisesCorrupt) return false;

    return MODALITIES.some(mode => (F.state.legacyExercises[mode] || []).length > 0);
  },
  apply() {
    const migrated = migrateLegacyExercisesToRoutines();

    if (migrated.created.length === 0) return {};

    F.state.routines = migrated.routines;

    if (!saveJSON(WORKOUT_ROUTINES_KEY, migrated.routines)) {
      return {
        notices: ["Não foi possível gravar as rotinas migradas. Seus exercícios antigos continuam intactos."]
      };
    }

    return {
      dirty: ["routines"],
      record: {
        source: WORKOUT_EXERCISES_KEY,
        routinesCreated: migrated.created
      },
      notices: ["Seus exercícios antigos foram migrados para uma rotina padrão em cada modalidade."]
    };
  }
});

/*
  2 → 3: medição por exercício, distância, metadados de catálogo e metas.
  Todos os campos novos são opcionais e derivados na leitura, portanto não há
  reescrita de dados do usuário. O passo apenas garante um objeto de metas
  normalizado em memória; ele não grava nada por conta própria.
*/
F.schema.register({
  id: "modelo-de-medicao-e-metas",
  from: 2,
  to: 3,
  description: "Campos de medição, distância, metadados e metas (aditivos, sem reescrita).",
  applies() {
    return true;
  },
  apply() {
    const goals = normalizeGoals(F.state.goals);

    if (JSON.stringify(goals) === JSON.stringify(F.state.goals)) return {};

    F.state.goals = goals;
    return { notices: ["As metas salvas foram ajustadas ao formato atual."] };
  }
});

/* ------------------------------------------------------------------ */
/* Repositório: a única porta de entrada para gravar estado              */
/* ------------------------------------------------------------------ */

F.repo = {
  save(id) {
    const spec = F.registry.get(id);

    if (!spec) return false;
    if (spec.writable === false) return false;
    if (typeof spec.persist !== "function") return false;

    const ok = spec.persist();
    if (ok) F.store.notifyChanged(spec.key);

    return ok;
  },
  read(id) {
    const spec = F.registry.get(id);

    if (!spec) return { exists: false, raw: null, value: null, error: null };
    return parseStorageValue(spec.key);
  },
  /* Usado pela importação de backup: escreve, confere e reverte se falhar. */
  applySet(keys, options) {
    return F.store.applySet(keys, options);
  },
  validate(key, value) {
    return F.registry.validateKey(key, value);
  },
  summarize(key, value) {
    return F.registry.summarizeKey(key, value);
  },
  /* Auditoria de armazenamento exibida em Configurações. */
  audit() {
    const usage = F.store.usage();

    return {
      available: F.store.available(),
      driver: F.store.driver().id,
      totalBytes: usage.total,
      rows: usage.rows.map(row => {
        const spec = F.registry.byKey(row.key);
        const stored = parseStorageValue(row.key);

        return {
          key: row.key,
          bytes: row.bytes,
          label: spec
            ? spec.label
            : (MISSION_KEY_PATTERN.test(row.key) ? "Missões do dia" : "Dado auxiliar"),
          readable: !stored.error,
          exists: stored.exists
        };
      })
    };
  }
};

/*
  Chaves que o boot não lê pelo repositório: o legado tem loader próprio
  (roda antes das migrações), a sessão ativa roda depois delas e as chaves de
  arquivo não têm representação em memória.
*/
const SKIP_AT_BOOT = [
  "legacyExercises",
  "active",
  "migration",
  "legacyActiveArchive",
  "preserved"
];

/* Carregamento inicial (executado uma vez por página, antes do módulo da página). */

F.bootData = function bootData() {
  F.state.bootNotices = [];
  F.state.storageInfo = {};

  /* 1. Origem legada primeiro: a promoção a rotinas depende dela. */
  F.state.legacyExercises = loadLegacyExercises();

  /* 2. Cada chave registrada lê o seu próprio estado, na ordem do registro. */
  F.registry.list().forEach(spec => {
    if (SKIP_AT_BOOT.indexOf(spec.id) !== -1) return;
    if (typeof spec.read !== "function") return;
    F.state[spec.id] = spec.read();
  });

  /* 3. Migrações pendentes do formato de dados. */
  const outcome = F.schema.run({
    has: key => parseStorageValue(key).exists,
    read: key => parseStorageValue(key)
  });

  outcome.notices.forEach(notice => F.state.bootNotices.push(notice));

  if (outcome.blocked) {
    F.state.bootNotices.push(outcome.blocked + " Seus dados existentes continuam preservados.");
  }

  if (outcome.dirty.length > 0 && Object.keys(outcome.recordPatch).length > 0) {
    recordMigration(outcome.recordPatch);
  }

  F.state.dataVersion = F.DATA_VERSION;
  F.state.dataVersionFrom = outcome.from;
  F.state.migrationApplied = outcome.applied;

  /* 4. A sessão ativa depende das rotinas carregadas, por isso vem depois. */
  F.state.activeWorkout = loadActiveWorkout();

  /* 5. Metadados por chave, para a tela de dados e para diagnósticos. */
  F.registry.list().forEach(spec => {
    const stored = parseStorageValue(spec.key);

    F.state.storageInfo[spec.id] = {
      key: spec.key,
      label: spec.label,
      exists: stored.exists,
      corrupt: Boolean(stored.error)
    };
  });

  return F.state;
};

F.saveRoutines = function saveRoutines() {
  const ok = saveJSON(WORKOUT_ROUTINES_KEY, F.state.routines);
  if (ok) F.store.notifyChanged(WORKOUT_ROUTINES_KEY);
  return ok;
};

F.saveLibrary = saveLibrary;
F.savePreferences = savePreferences;
F.saveActiveWorkout = saveActiveWorkout;
F.saveGoals = saveGoals;

Object.assign(F, {
  normalizeExercise,
  normalizeRoutine,
  normalizeLibraryItem,
  normalizeGoals,
  normalizeMeasure,
  normalizeSetLogs,
  normalizeSessionFeedback,
  flattenRoutine,
  countRoutineExercises,
  countRoutineData,
  getModeRoutines,
  findRoutine,
  getRoutineById,
  getRoutineTotalSets,
  exerciseTarget,
  exercisePlannedLoadKg,
  parseLoadKg,
  parseMaxReps,
  normalizeSessionV2,
  getElapsedMs,
  getRestRemainingMs,
  hasRestState,
  totalCompletedSets,
  currentSessionExercise,
  completedExerciseCount,
  loadLibrary,
  loadPreferences,
  loadGoals,
  goalsAreActive,
  validateRoutinesStore,
  validateHistoryList,
  validateActiveSession,
  validateLibraryStore,
  validateGoalsStore,
  validateLegacyExercises,
  validateAuxiliaryValue,
  assertExerciseShape,
  removeStorageKey,
  WORKOUT_GOALS_KEY,
  MISSION_KEY_PATTERN,
  GOAL_TARGET_LIMIT
});

F.validateMissionList = validateMissionList;
F.summarizeMissionList = summarizeMissionList;

})(window);
