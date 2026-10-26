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
  const WORKOUT_ROTATION_KEY = KEYS.rotation;
  const WORKOUT_PROFILE_KEY = KEYS.profile;

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

  /* RPE fora de 1–10 (inclusive "não registrar") vira ausente, nunca 0 ou 1. */
  const rawRpe = Number(raw.rpe);
  const rpe = Number.isFinite(rawRpe) && rawRpe >= 1 && rawRpe <= 10 ? Math.round(rawRpe) : null;

  if (!note && !rpe) return null;

  return {
    note,
    rpe,
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
/* Perfil de treino (chave nova, aditiva)                              */
/* ------------------------------------------------------------------ */

/*
  Perfil opcional do usuário: objetivo, nível, equipamento disponível, dias
  por semana, duração desejada, sexo informado (usado só para escolher o
  personagem das demonstrações) e modalidade preferida. Todos os campos são
  opcionais (ausente = 0 ou "") e editáveis depois. O perfil orienta sugestões
  futuras e nunca impede a criação manual de rotinas. A chave é aditiva: nada
  que já existe muda.

  Versão do modelo (`version` dentro do valor, não a chave):

    1  objetivo, nível, equipamento, diasPorSemana, duracaoMinutos
    2  + sexo, modalidadePreferida, onboardingConcluidoEm (aditivo)

  Um perfil v1 é lido como v2 na primeira leitura: os campos novos ficam
  vazios (nunca inferidos) e nada é gravado até o usuário salvar de novo. A
  chave `forja-perfil-v1` não muda de nome nem de formato de JSON — o backup
  continua sendo o mesmo objeto.
*/
const PERFIL_VERSION = 2;
const PERFIL_OBJETIVOS = ["forca", "hipertrofia", "resistencia", "calistenia", "recuperacao"];
const PERFIL_NIVEIS = ["iniciante", "intermediario", "avancado"];
const PERFIL_EQUIPAMENTOS = ["nenhum", "casa", "academia", "ambos"];

/*
  Sexo informado pelo usuário. Só dois valores com efeito definido:
  "masculino" e "feminino", que futuramente selecionam o personagem das
  demonstrações. O vazio significa "não informado" (inclui "prefiro não
  informar") e o app continua funcionando sem personagem. Nenhum outro valor
  é aceito e nada é inferido por nome, aparência ou objetivo.
*/
const PERFIL_SEXOS = ["masculino", "feminino"];
const PERFIL_MODALIDADES = ["calisthenics", "weights"];
const PERFIL_MAX_DIAS = 7;
const PERFIL_MAX_MINUTOS = 240;

/*
  Personagens de demonstração (3D entram numa etapa futura). Hoje existe só o
  contrato: `resolvePersonagem(perfil)` devolve um destes objetos quando o sexo
  informado é reconhecido e `null` em qualquer outro caso — quem desenhar o
  personagem não deve exibir nada quando receber `null`.
*/
const PERSONAGENS = Object.freeze({
  masculino: Object.freeze({ id: "masculino", label: "Personagem masculino" }),
  feminino: Object.freeze({ id: "feminino", label: "Personagem feminino" })
});

const PERFIL_LABELS = {
  objetivo: {
    forca: "Força",
    hipertrofia: "Hipertrofia",
    resistencia: "Resistência",
    calistenia: "Calistenia",
    recuperacao: "Recuperação"
  },
  nivel: {
    iniciante: "Iniciante",
    intermediario: "Intermediário",
    avancado: "Avançado"
  },
  equipamento: {
    nenhum: "Sem equipamentos",
    casa: "Casa / peso corporal",
    academia: "Academia",
    ambos: "Ambos"
  },
  sexo: {
    masculino: "Masculino",
    feminino: "Feminino"
  },
  modalidade: {
    calisthenics: "Calistenia",
    weights: "Musculação"
  }
};

/* Opções exatas usadas pelas telas (onboarding e Perfil). */
const PERFIL_OPTIONS = {
  objetivo: [
    { value: "", label: "Não definido" },
    { value: "forca", label: "Força" },
    { value: "hipertrofia", label: "Hipertrofia" },
    { value: "resistencia", label: "Resistência" },
    { value: "calistenia", label: "Calistenia" },
    { value: "recuperacao", label: "Recuperação" }
  ],
  nivel: [
    { value: "", label: "Não definido" },
    { value: "iniciante", label: "Iniciante" },
    { value: "intermediario", label: "Intermediário" },
    { value: "avancado", label: "Avançado" }
  ],
  equipamento: [
    { value: "", label: "Não definido" },
    { value: "nenhum", label: "Sem equipamentos" },
    { value: "casa", label: "Casa / peso corporal" },
    { value: "academia", label: "Academia" },
    { value: "ambos", label: "Ambos" }
  ],
  sexo: [
    { value: "", label: "Não informado" },
    { value: "masculino", label: "Masculino" },
    { value: "feminino", label: "Feminino" }
  ],
  modalidade: [
    { value: "", label: "Sem preferência" },
    { value: "calisthenics", label: "Calistenia" },
    { value: "weights", label: "Musculação" }
  ]
};

/* Campos conhecidos do perfil. Qualquer outro campo é preservado, não lido. */
const PERFIL_KNOWN_KEYS = [
  "version",
  "updatedAt",
  "objetivo",
  "nivel",
  "equipamento",
  "diasPorSemana",
  "duracaoMinutos",
  "sexo",
  "modalidadePreferida",
  "onboardingConcluidoEm"
];

/* Data ISO aceita só quando é texto e o navegador consegue interpretar. */
function normalizeIsoText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return Number.isNaN(Date.parse(text)) ? null : text;
}

function normalizeProfile(raw) {
  const base = {
    version: PERFIL_VERSION,
    updatedAt: null,
    objetivo: "",
    nivel: "",
    equipamento: "",
    diasPorSemana: 0,
    duracaoMinutos: 0,
    sexo: "",
    modalidadePreferida: "",
    onboardingConcluidoEm: null
  };

  if (!isPlainObject(raw)) return base;

  return {
    version: PERFIL_VERSION,
    updatedAt: normalizeIsoText(raw.updatedAt),
    objetivo: PERFIL_OBJETIVOS.indexOf(raw.objetivo) !== -1 ? raw.objetivo : "",
    nivel: PERFIL_NIVEIS.indexOf(raw.nivel) !== -1 ? raw.nivel : "",
    equipamento: PERFIL_EQUIPAMENTOS.indexOf(raw.equipamento) !== -1 ? raw.equipamento : "",
    diasPorSemana: clampInteger(raw.diasPorSemana, 0, PERFIL_MAX_DIAS, 0),
    duracaoMinutos: clampInteger(raw.duracaoMinutos, 0, PERFIL_MAX_MINUTOS, 0),
    /* Valor não reconhecido vira "não informado": nunca um palpite. */
    sexo: PERFIL_SEXOS.indexOf(raw.sexo) !== -1 ? raw.sexo : "",
    modalidadePreferida: PERFIL_MODALIDADES.indexOf(raw.modalidadePreferida) !== -1
      ? raw.modalidadePreferida
      : "",
    onboardingConcluidoEm: normalizeIsoText(raw.onboardingConcluidoEm)
  };
}

/*
  Preserva campos que este módulo não conhece (versões futuras do app ou
  anotações de outra ferramenta). Eles não são lidos nem usados, mas também não
  são apagados na gravação.
*/
function carryUnknownProfileKeys(normalized, source) {
  if (!isPlainObject(source)) return normalized;

  const out = Object.assign({}, normalized);

  Object.keys(source).forEach(key => {
    if (PERFIL_KNOWN_KEYS.indexOf(key) !== -1) return;
    out[key] = cloneData(source[key]);
  });

  return out;
}

/* Perfil já configurado: salvo agora ou por uma versão anterior do app. */
function profileIsConfigured(profile) {
  const current = isPlainObject(profile) ? profile : F.state.profile;

  if (!isPlainObject(current)) return false;
  return Boolean(normalizeIsoText(current.updatedAt) || normalizeIsoText(current.onboardingConcluidoEm));
}

/* Campo vazio porque o usuário nunca respondeu (não é "resposta errada"). */
function profileHasAnyAnswer(profile) {
  const current = normalizeProfile(profile);

  return Boolean(
    current.objetivo || current.nivel || current.equipamento || current.sexo ||
    current.modalidadePreferida || current.diasPorSemana > 0 || current.duracaoMinutos > 0
  );
}

/*
  Personagem das demonstrações. Retorna `null` enquanto o sexo não estiver
  informado ou não for reconhecido — e nenhuma tela deve exibir personagem
  nesse caso. Não olha nome, aparência, objetivo nem histórico.
*/
function resolvePersonagem(profile) {
  const current = normalizeProfile(profile);
  const personagem = PERSONAGENS[current.sexo];
  return personagem ? Object.assign({}, personagem) : null;
}

/*
  Sugestão de metas semanais a partir do perfil: treinos por semana = dias
  respondidos; minutos = dias × duração da sessão. É só uma sugestão — quem
  grava é a tela de metas, depois da confirmação do usuário.
*/
function profileGoalSuggestion(profile) {
  const current = normalizeProfile(profile);
  const sessions = current.diasPorSemana;
  const minutes = Math.min(7 * 60 * 24, sessions * current.duracaoMinutos);

  if (sessions === 0 && minutes === 0) return null;

  return {
    weeklySessions: sessions,
    weeklyMinutes: minutes,
    modality: current.modalidadePreferida || "all"
  };
}

/*
  Leitura: nunca grava. Conteúdo ilegível é ignorado (sem reescrita) e a tela
  continua com perfil vazio — o app funciona sem perfil.
*/
function loadProfile() {
  const stored = parseStorageValue(WORKOUT_PROFILE_KEY);

  if (!stored.exists) return normalizeProfile(null);

  if (stored.error || !isPlainObject(stored.value)) {
    /*
      A inicialização não grava chave nova: o conteúdo ilegível continua
      exatamente onde estava e a tela carrega um perfil vazio.
    */
    F.state.bootNotices.push(
      "O perfil salvo estava ilegível. Ele foi ignorado sem gravar nada; o conteúdo original continua no armazenamento."
    );
    return normalizeProfile(null);
  }

  return normalizeProfile(stored.value);
}

/*
  Única gravação do perfil: só acontece quando o usuário confirma. Parte do que
  está armazenado agora (não só da memória) para não perder alterações feitas
  em outra aba nem campos desconhecidos. Se o navegador recusar, a memória
  volta exatamente ao que estava.
*/
function saveProfile(patch) {
  const previous = cloneData(F.state.profile);
  const stored = parseStorageValue(WORKOUT_PROFILE_KEY);
  const storedValue = stored.exists && !stored.error && isPlainObject(stored.value)
    ? stored.value
    : null;

  const merged = Object.assign({}, storedValue, F.state.profile, patch, {
    updatedAt: new Date().toISOString()
  });

  const next = carryUnknownProfileKeys(normalizeProfile(merged), storedValue);

  F.state.profile = next;

  if (!saveJSON(WORKOUT_PROFILE_KEY, next)) {
    F.state.profile = previous;
    return false;
  }

  return true;
}

function validateProfileStore(value) {
  if (!isPlainObject(value)) {
    throw new Error("O perfil do FORJA está em formato inválido.");
  }

  if (value.objetivo !== undefined &&
    value.objetivo !== "" &&
    PERFIL_OBJETIVOS.indexOf(value.objetivo) === -1) {
    throw new Error("O objetivo do perfil é inválido.");
  }

  if (value.nivel !== undefined &&
    value.nivel !== "" &&
    PERFIL_NIVEIS.indexOf(value.nivel) === -1) {
    throw new Error("O nível do perfil é inválido.");
  }

  if (value.equipamento !== undefined &&
    value.equipamento !== "" &&
    PERFIL_EQUIPAMENTOS.indexOf(value.equipamento) === -1) {
    throw new Error("O equipamento do perfil é inválido.");
  }

  if (value.sexo !== undefined &&
    value.sexo !== "" &&
    PERFIL_SEXOS.indexOf(value.sexo) === -1) {
    throw new Error("O sexo informado no perfil é inválido.");
  }

  if (value.modalidadePreferida !== undefined &&
    value.modalidadePreferida !== "" &&
    PERFIL_MODALIDADES.indexOf(value.modalidadePreferida) === -1) {
    throw new Error("A modalidade preferida do perfil é inválida.");
  }

  ["updatedAt", "onboardingConcluidoEm"].forEach(field => {
    if (value[field] === undefined || value[field] === null) return;
    if (typeof value[field] !== "string" || Number.isNaN(Date.parse(value[field]))) {
      throw new Error("A data de atualização do perfil é inválida.");
    }
  });

  if (value.diasPorSemana !== undefined) {
    const dias = Number(value.diasPorSemana);
    if (!Number.isInteger(dias) || dias < 0 || dias > PERFIL_MAX_DIAS) {
      throw new Error("Os dias por semana do perfil estão fora do intervalo.");
    }
  }

  if (value.duracaoMinutos !== undefined) {
    const minutos = Number(value.duracaoMinutos);
    if (!Number.isInteger(minutos) || minutos < 0 || minutos > PERFIL_MAX_MINUTOS) {
      throw new Error("A duração desejada do perfil está fora do intervalo.");
    }
  }

  return true;
}

function profileSummarize(value) {
  const profile = normalizeProfile(value);
  const parts = [];

  if (profile.objetivo) parts.push(PERFIL_LABELS.objetivo[profile.objetivo]);
  if (profile.nivel) parts.push(PERFIL_LABELS.nivel[profile.nivel]);
  if (profile.equipamento) parts.push(PERFIL_LABELS.equipamento[profile.equipamento]);
  if (profile.diasPorSemana > 0) parts.push(profile.diasPorSemana + " dia(s)/semana");
  if (profile.duracaoMinutos > 0) parts.push(profile.duracaoMinutos + " min/sessão");

  return {
    label: "Perfil",
    detail: parts.length ? parts.join(" · ") : "ausente"
  };
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

/*
  Data de um registro do histórico, usada para ordenar e limitar por data em
  vez de por posição no arquivo. A regra é a mesma da leitura de métricas:
  `finishedAt` quando válido e, na falta dele, a chave `date`.
*/
function historyRecordTime(record) {
  if (!isPlainObject(record)) return 0;

  if (record.finishedAt) {
    const finished = Date.parse(record.finishedAt);
    if (Number.isFinite(finished)) return finished;
  }

  if (record.date) {
    const day = Date.parse(record.date + "T00:00:00");
    if (Number.isFinite(day)) return day;
  }

  if (record.startedAt) {
    const started = Date.parse(record.startedAt);
    if (Number.isFinite(started)) return started;
  }

  return 0;
}

/*
  Histórico do mais recente para o mais antigo, sem alterar os registros.
  A ordenação é estável: empates mantêm a ordem em que já estavam.
*/
function sortHistoryRecords(list) {
  if (!Array.isArray(list)) return [];

  return list
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      const diff = historyRecordTime(b.record) - historyRecordTime(a.record);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(item => item.record);
}

/*
  Histórico canônico do app: ordenado por data e limitado ao teto do histórico.
  O corte escolhe os registros mais recentes — nunca os que estão no fim do
  arquivo —, então um backup fora de ordem não perde os treinos novos.
*/
function normalizeHistoryList(list, limit) {
  const max = Number.isInteger(limit) && limit > 0 ? limit : F.HISTORY_LIMIT;
  return sortHistoryRecords(list).slice(0, max);
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

      const where = "biblioteca personalizada de " + MODE_NAMES[mode] +
        " (exercício \"" + item.name.trim().slice(0, 40) + "\")";

      /*
        Mesmas regras estruturais dos exercícios de rotina e de sessão
        (séries, tipo, descanso, duração, medição, distância e listas):
        biblioteca personalizada guarda o mesmo formato de exercício, então
        reutiliza `assertExerciseShape` em vez de duplicar limites.
      */
      assertExerciseShape(item, where);

      /*
        Campos próprios da biblioteca que `assertExerciseShape` não conhece e
        que `normalizeLibraryItem` corrigiria em silêncio na leitura: seção e
        unidade desconhecidas, identificador quebrado e textos/listas acima
        do limite que a normalização truncaria. Backup inválido é rejeitado
        aqui, antes da importação — nunca aceito para ser alterado depois.
      */
      if (item.section !== undefined && !SECTION_NAMES[item.section]) {
        throw new Error("Exercício com seção desconhecida em " + where + ".");
      }

      if (item.distanceUnit !== undefined &&
        item.distanceUnit !== "m" && item.distanceUnit !== "km") {
        throw new Error("Exercício com unidade de distância inválida em " + where + ".");
      }

      if (item.id !== undefined && (typeof item.id !== "string" || !item.id)) {
        throw new Error("Exercício com identificador inválido em " + where + ".");
      }

      const textLimits = [
        ["name", 100, "nome"],
        ["reps", 30, "repetições"],
        ["load", 50, "carga"],
        ["notes", 300, "observações"],
        ["category", 40, "categoria"],
        ["instructions", 600, "instruções"]
      ];

      textLimits.forEach(([field, limit, label]) => {
        if (typeof item[field] === "string" && item[field].length > limit) {
          throw new Error("Exercício com " + label + " acima de " + limit +
            " caracteres em " + where + ".");
        }
      });

      ["muscles", "equipment"].forEach(field => {
        if (!Array.isArray(item[field])) return;

        if (item[field].length > 6) {
          throw new Error("Exercício com lista de " + field + " acima de 6 itens em " +
            where + ".");
        }

        if (item[field].some(entry => typeof entry === "string" && entry.trim().length > 28)) {
          throw new Error("Exercício com item de " + field + " acima de 28 caracteres em " +
            where + ".");
        }
      });
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

/* ------------------------------------------------------------------ */
/* Sequência / rotação de rotinas na tela inicial                      */
/* ------------------------------------------------------------------ */

function emptyRotation() {
  return {
    version: 1,
    overrideRoutineId: null,
    nextRoutineId: null,
    nextModality: null,
    lastRoutineId: null,
    lastModality: null,
    previousState: null,
    updatedAt: null
  };
}

function normalizeRotationSnapshot(raw) {
  if (!isPlainObject(raw)) return null;

  const cleanId = value => (typeof value === "string" && value.trim()
    ? value.trim().slice(0, 120)
    : null);
  const cleanMode = value => (typeof value === "string" && MODE_NAMES[value] ? value : null);

  return {
    overrideRoutineId: cleanId(raw.overrideRoutineId),
    nextRoutineId: cleanId(raw.nextRoutineId),
    nextModality: cleanMode(raw.nextModality),
    lastRoutineId: cleanId(raw.lastRoutineId),
    lastModality: cleanMode(raw.lastModality)
  };
}

function normalizeRotation(raw) {
  if (!isPlainObject(raw)) return emptyRotation();

  const base = normalizeRotationSnapshot(raw);

  return {
    version: 1,
    overrideRoutineId: base.overrideRoutineId,
    nextRoutineId: base.nextRoutineId,
    nextModality: base.nextModality,
    lastRoutineId: base.lastRoutineId,
    lastModality: base.lastModality,
    previousState: normalizeRotationSnapshot(raw.previousState),
    updatedAt: Number.isFinite(Number(raw.updatedAt)) && Number(raw.updatedAt) > 0
      ? Math.round(Number(raw.updatedAt))
      : null
  };
}

function loadRotation() {
  const stored = parseStorageValue(WORKOUT_ROTATION_KEY);

  if (!stored.exists) return emptyRotation();

  if (stored.error || !isPlainObject(stored.value)) {
    archivePreservedValue(WORKOUT_ROTATION_KEY, stored.raw, "Sequência de rotinas inválida");
    return emptyRotation();
  }

  return normalizeRotation(stored.value);
}

function validateRotationStore(value) {
  if (!isPlainObject(value)) {
    throw new Error("A sequência de rotinas do FORJA está em formato inválido.");
  }

  ["overrideRoutineId", "nextRoutineId", "lastRoutineId"].forEach(field => {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== "string") {
      throw new Error("O campo \"" + field + "\" da sequência de rotinas é inválido.");
    }
  });

  ["nextModality", "lastModality"].forEach(field => {
    if (value[field] !== undefined && value[field] !== null && !MODE_NAMES[value[field]]) {
      throw new Error("A modalidade salva na sequência de rotinas é desconhecida.");
    }
  });

  if (value.previousState !== undefined &&
    value.previousState !== null &&
    !isPlainObject(value.previousState)) {
    throw new Error("O estado anterior da sequência de rotinas é inválido.");
  }

  return true;
}

function saveRotation(next) {
  const previous = cloneData(F.state.rotation || emptyRotation());
  const normalized = normalizeRotation(next);
  F.state.rotation = normalized;

  const ok = saveJSON(WORKOUT_ROTATION_KEY, normalized);

  if (!ok) {
    F.state.rotation = previous;
    return false;
  }

  F.store.notifyChanged(WORKOUT_ROTATION_KEY);
  return true;
}

/*
  Lista ordenada das rotinas aptas a iniciar (com pelo menos 1 exercício):
  Calistenia na ordem definida pelo usuário, seguida de Musculação na ordem
  definida pelo usuário. Rotinas vazias (0 exercícios) nunca entram na fila de
  início rápido.
*/
function getStartableRoutines() {
  const list = [];

  MODALITIES.forEach(modality => {
    getModeRoutines(modality).forEach(routine => {
      if (countRoutineExercises(routine) > 0) list.push(routine);
    });
  });

  return list;
}

/*
  Regra pura (zero escrita em localStorage) para escolher a próxima rotina:
  1. Se houver `overrideRoutineId` explícito (ex.: após exclusão da rotina
     selecionada ou descarte de sessão) e ela continuar iniciável, usa ela.
  2. Se `lastRoutineId` existir na lista iniciável atual, avança circularmente
     para `list[(idx + 1) % len]` (incluindo novas rotinas criadas depois).
  3. Se `nextRoutineId` explícito existir na lista, usa ela.
  4. Senão, consulta `F.state.history` (do treino mais recente ao mais antigo,
     casando por `routineId` ou por `modality + routineName` para dados v1/v2)
     e retorna `list[(idx + 1) % len]`.
  5. Primeiro uso / histórico vazio / nenhuma rotina anterior encontrada:
     retorna `list[0]` (ou `null` quando não há rotina iniciável).
*/
function resolveNextRoutine() {
  const list = getStartableRoutines();
  if (list.length === 0) return null;

  const rotation = F.state && isPlainObject(F.state.rotation)
    ? F.state.rotation
    : emptyRotation();

  if (rotation.overrideRoutineId) {
    const pinned = list.find(item => item.id === rotation.overrideRoutineId);
    if (pinned) return pinned;
  }

  if (rotation.lastRoutineId) {
    const lastIdx = list.findIndex(item => item.id === rotation.lastRoutineId);
    if (lastIdx >= 0) return list[(lastIdx + 1) % list.length];
  }

  if (rotation.nextRoutineId) {
    const explicit = list.find(item => item.id === rotation.nextRoutineId);
    if (explicit) return explicit;
  }

  const history = F.state && Array.isArray(F.state.history) ? F.state.history : [];
  for (let i = 0; i < history.length; i += 1) {
    const record = history[i];
    if (!isPlainObject(record)) continue;

    let matchIdx = -1;
    if (typeof record.routineId === "string" && record.routineId) {
      matchIdx = list.findIndex(item => item.id === record.routineId);
    }

    if (matchIdx < 0 && typeof record.routineName === "string" && record.routineName.trim()) {
      const targetName = record.routineName.trim().toLowerCase();
      matchIdx = list.findIndex(item => {
        const sameMode = !record.modality || item.modality === record.modality;
        return sameMode && String(item.name || "").trim().toLowerCase() === targetName;
      });
    }

    if (matchIdx >= 0) {
      return list[(matchIdx + 1) % list.length];
    }
  }

  return list[0];
}

/*
  Avança a rotação quando um treino é efetivamente iniciado ou concluído.
  Idempotente para a mesma rotina: iniciar A e depois concluir A apontam ambos
  para a rotina imediatamente após A na lista iniciável.
*/
function advanceRotation(modality, routineId, options = {}) {
  if (!routineId) return false;

  const list = getStartableRoutines();
  const currentRotation = F.state && isPlainObject(F.state.rotation)
    ? F.state.rotation
    : emptyRotation();

  const idx = list.findIndex(item => item.id === routineId);
  const next = idx >= 0
    ? list[(idx + 1) % list.length]
    : (list[0] || null);

  const hasExplicitPrevious = Object.prototype.hasOwnProperty.call(options, "previousNextRoutineId");
  const previousState = hasExplicitPrevious && options.previousNextRoutineId !== null
    ? normalizeRotationSnapshot(currentRotation)
    : (hasExplicitPrevious ? null : currentRotation.previousState);

  return saveRotation({
    version: 1,
    overrideRoutineId: null,
    nextRoutineId: next ? next.id : null,
    nextModality: next ? next.modality : null,
    lastRoutineId: routineId,
    lastModality: MODE_NAMES[modality] ? modality : null,
    previousState,
    updatedAt: Date.now()
  });
}

/*
  Se uma sessão recém-iniciada (0 séries concluídas) for descartada, desfaz o
  avanço antecipado restaurando exatamente o estado anterior da rotação.
*/
function rollbackDiscardedRotation(routineId) {
  const currentRotation = F.state && isPlainObject(F.state.rotation)
    ? F.state.rotation
    : null;

  if (!currentRotation || currentRotation.lastRoutineId !== routineId) return false;
  if (!currentRotation.previousState) return false;

  const prev = currentRotation.previousState;

  return saveRotation({
    version: 1,
    overrideRoutineId: prev.overrideRoutineId,
    nextRoutineId: prev.nextRoutineId,
    nextModality: prev.nextModality,
    lastRoutineId: prev.lastRoutineId,
    lastModality: prev.lastModality,
    previousState: null,
    updatedAt: Date.now()
  });
}

/*
  Quando uma rotina é excluída:
  - Se ela era a rotina selecionada na Home, avança circularmente para a
    próxima rotina restante na sequência anterior (ou limpa se não sobrou
    nenhuma rotina iniciável).
  - Se outra rotina estava selecionada, preserva essa seleção.
*/
function reconcileRotationAfterDelete(oldStartableList, wasSelected, deletedRoutineId) {
  const remaining = getStartableRoutines();
  const currentRotation = F.state && isPlainObject(F.state.rotation)
    ? F.state.rotation
    : emptyRotation();

  if (remaining.length === 0) {
    return saveRotation({
      version: 1,
      overrideRoutineId: null,
      nextRoutineId: null,
      nextModality: null,
      lastRoutineId: currentRotation.lastRoutineId === deletedRoutineId
        ? null
        : currentRotation.lastRoutineId,
      lastModality: currentRotation.lastRoutineId === deletedRoutineId
        ? null
        : currentRotation.lastModality,
      previousState: null,
      updatedAt: Date.now()
    });
  }

  let next = null;

  if (wasSelected && wasSelected.id === deletedRoutineId && Array.isArray(oldStartableList)) {
    const oldIdx = oldStartableList.findIndex(item => item.id === deletedRoutineId);
    if (oldIdx >= 0) {
      for (let step = 1; step < oldStartableList.length; step += 1) {
        const candidate = oldStartableList[(oldIdx + step) % oldStartableList.length];
        const alive = remaining.find(item => item.id === candidate.id);
        if (alive) {
          next = alive;
          break;
        }
      }
    }
  } else if (wasSelected) {
    next = remaining.find(item => item.id === wasSelected.id) || null;
  }

  if (!next) next = remaining[0];

  return saveRotation({
    version: 1,
    overrideRoutineId: next.id,
    nextRoutineId: next.id,
    nextModality: next.modality,
    lastRoutineId: currentRotation.lastRoutineId === deletedRoutineId
      ? null
      : currentRotation.lastRoutineId,
    lastModality: currentRotation.lastRoutineId === deletedRoutineId
      ? null
      : currentRotation.lastModality,
    previousState: null,
    updatedAt: Date.now()
  });
}

/*
  Quando rotinas mudam sem exclusão (editar, esvaziar, voltar a ter
  exercícios, duplicar, adicionar exercício pela biblioteca), a próxima
  rotina exibida continua saindo de `resolveNextRoutine()` — mas os
  ponteiros gravados podem ficar apontando para uma rotina que não é mais
  iniciável, ou deixar de refletir a exibida. Esta reconciliação reescreve
  somente os ponteiros que divergirem da resolução atual:

  - `nextRoutineId`/`nextModality` passam a ser exatamente a rotina que
    `resolveNextRoutine()` apresenta (ou `null` quando nada é iniciável);
  - `overrideRoutineId` só é mantido enquanto a rotina fixada continuar
    iniciável (ao esvaziá-la, a fixação cai junto);
  - `lastRoutineId`/`lastModality` e `previousState` são preservados: o que
    foi treinado por último não muda porque uma rotina esvaziou, e o estado
    anterior continua disponível para desfazer o avanço ao descartar uma
    sessão recém-iniciada.

  Sem divergência, nada é gravado. Abrir ou recarregar telas nunca chama
  esta função — só mutações explícitas de rotinas.
*/
function reconcileRotationAfterRoutineChange() {
  const startable = getStartableRoutines();
  const displayed = resolveNextRoutine();
  const current = F.state && isPlainObject(F.state.rotation)
    ? F.state.rotation
    : emptyRotation();

  const overrideId = current.overrideRoutineId &&
    startable.some(item => item.id === current.overrideRoutineId)
    ? current.overrideRoutineId
    : null;
  const nextId = displayed ? displayed.id : null;
  const nextModality = displayed ? displayed.modality : null;

  if (
    current.overrideRoutineId === overrideId &&
    current.nextRoutineId === nextId &&
    current.nextModality === nextModality
  ) {
    return false;
  }

  return saveRotation({
    version: 1,
    overrideRoutineId: overrideId,
    nextRoutineId: nextId,
    nextModality,
    lastRoutineId: current.lastRoutineId,
    lastModality: current.lastModality,
    previousState: current.previousState,
    updatedAt: Date.now()
  });
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

    /*
      Ordena por data sem gravar nada. Um histórico gravado fora de ordem (por
      exemplo, por uma importação antiga) passa a aparecer do mais recente para
      o mais antigo em todas as telas, que é como o app grava os seus.
    */
    return sortHistoryRecords(stored.value.filter(isPlainObject));
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
  id: "profile",
  key: WORKOUT_PROFILE_KEY,
  label: "Perfil de treino",
  empty: () => normalizeProfile(null),
  read: loadProfile,
  validate: validateProfileStore,
  persist: () => saveJSON(WORKOUT_PROFILE_KEY, F.state.profile),
  summarize: profileSummarize
});

F.registry.register({
  id: "rotation",
  key: WORKOUT_ROTATION_KEY,
  label: "Sequência de rotinas",
  empty: emptyRotation,
  read: loadRotation,
  validate: validateRotationStore,
  persist: () => saveJSON(WORKOUT_ROTATION_KEY, F.state.rotation),
  summarize(value) {
    const rotation = normalizeRotation(value);
    return {
      label: "Sequência",
      detail: rotation.nextRoutineId
        ? "próxima rotina definida"
        : "automática pelo histórico"
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

/*
  Sincroniza `F.state` em memória a partir do armazenamento sem nunca gravar,
  arquivar ou migrar chaves no disco. Usada por ouvintes de `storage`,
  `pageshow` (BFCache) e mudanças externas: se um valor estiver ilegível, a
  fatia correspondente volta ao vazio seguro em memória e o conteúdo original
  no armazenamento permanece intocado.
*/
function readLegacyExercisesStateReadOnly() {
  const stored = parseStorageValue(WORKOUT_EXERCISES_KEY);
  if (!stored.exists) {
    return {
      corrupt: false,
      data: { calisthenics: [], weights: [] }
    };
  }
  if (stored.error || !isPlainObject(stored.value)) {
    return {
      corrupt: true,
      data: { calisthenics: [], weights: [] }
    };
  }
  return {
    corrupt: false,
    data: normalizeLegacyExercises(stored.value)
  };
}

function readRoutinesReadOnly() {
  const stored = parseStorageValue(WORKOUT_ROUTINES_KEY);

  if (stored.exists) {
    if (stored.error || !isPlainObject(stored.value)) {
      return { calisthenics: [], weights: [] };
    }
    return normalizeRoutinesData(stored.value);
  }

  if (F.state.legacyExercisesCorrupt) {
    return { calisthenics: [], weights: [] };
  }

  const hasLegacy = MODALITIES.some(mode => (F.state.legacyExercises[mode] || []).length > 0);
  if (hasLegacy) {
    return migrateLegacyExercisesToRoutines().routines;
  }

  return { calisthenics: [], weights: [] };
}

function readHistoryReadOnly() {
  const stored = parseStorageValue(WORKOUT_HISTORY_KEY);
  if (!stored.exists || stored.error || !Array.isArray(stored.value)) return [];

  /* Ler já devolve a ordem canônica, sem gravar nada: a Home e o Progresso
     mostram sempre o treino mais recente primeiro, mesmo com um arquivo
     importado fora de ordem por uma versão anterior. */
  return sortHistoryRecords(stored.value.filter(isPlainObject));
}

function readLibraryReadOnly() {
  const empty = { calisthenics: [], weights: [] };
  const stored = parseStorageValue(WORKOUT_LIBRARY_KEY);
  if (!stored.exists || stored.error || !isPlainObject(stored.value)) return empty;

  const result = { calisthenics: [], weights: [] };
  MODALITIES.forEach(mode => {
    if (!Array.isArray(stored.value[mode])) return;
    stored.value[mode].forEach(item => {
      const normalized = normalizeLibraryItem(item, mode);
      if (normalized) result[mode].push(normalized);
    });
  });
  return result;
}

function readGoalsReadOnly() {
  const stored = parseStorageValue(WORKOUT_GOALS_KEY);
  if (!stored.exists || stored.error || !isPlainObject(stored.value)) {
    return normalizeGoals(null);
  }
  return normalizeGoals(stored.value);
}

function readRotationReadOnly() {
  const stored = parseStorageValue(WORKOUT_ROTATION_KEY);
  if (!stored.exists || stored.error || !isPlainObject(stored.value)) {
    return emptyRotation();
  }
  return normalizeRotation(stored.value);
}

function readProfileReadOnly() {
  const stored = parseStorageValue(WORKOUT_PROFILE_KEY);
  if (!stored.exists || stored.error || !isPlainObject(stored.value)) {
    return normalizeProfile(null);
  }
  return normalizeProfile(stored.value);
}

function readActiveWorkoutReadOnly() {
  const stored = parseStorageValue(WORKOUT_ACTIVE_KEY);
  if (!stored.exists || stored.error || !isPlainObject(stored.value)) return null;

  if (stored.value.version === 2) {
    return normalizeSessionV2(stored.value);
  }

  return migrateLegacySession(stored.value);
}

function refreshStorageInfoReadOnly(targetKey) {
  if (!isPlainObject(F.state.storageInfo)) {
    F.state.storageInfo = {};
  }

  F.registry.list().forEach(spec => {
    if (targetKey && spec.key !== targetKey) return;
    const stored = parseStorageValue(spec.key);
    F.state.storageInfo[spec.id] = {
      key: spec.key,
      label: spec.label,
      exists: stored.exists,
      corrupt: Boolean(stored.error)
    };
  });
}

function syncStateFromStorage(changedKey) {
  const syncAll = changedKey === undefined || changedKey === null;

  if (!syncAll) {
    if (typeof changedKey !== "string") return false;
    if (MISSION_KEY_PATTERN.test(changedKey) || changedKey === KEYS.safety) return true;
  }

  let handled = syncAll;
  const activeLegacyNeedsContext = changedKey === WORKOUT_ACTIVE_KEY && (() => {
    const activeStored = parseStorageValue(WORKOUT_ACTIVE_KEY);
    return activeStored.exists &&
      !activeStored.error &&
      isPlainObject(activeStored.value) &&
      activeStored.value.version !== 2;
  })();

  if (
    syncAll ||
    changedKey === WORKOUT_EXERCISES_KEY ||
    changedKey === WORKOUT_ROUTINES_KEY ||
    activeLegacyNeedsContext
  ) {
    const legacyState = readLegacyExercisesStateReadOnly();
    F.state.legacyExercises = legacyState.data;
    F.state.legacyExercisesCorrupt = legacyState.corrupt;
    if (syncAll || changedKey === WORKOUT_EXERCISES_KEY) handled = true;
  }

  if (
    syncAll ||
    changedKey === WORKOUT_ROUTINES_KEY ||
    changedKey === WORKOUT_EXERCISES_KEY ||
    activeLegacyNeedsContext
  ) {
    F.state.routines = readRoutinesReadOnly();
    if (syncAll || changedKey === WORKOUT_ROUTINES_KEY || changedKey === WORKOUT_EXERCISES_KEY) {
      handled = true;
    }
  }

  if (syncAll || changedKey === WORKOUT_HISTORY_KEY) {
    F.state.history = readHistoryReadOnly();
    handled = true;
  }

  if (syncAll || changedKey === WORKOUT_LIBRARY_KEY) {
    F.state.library = readLibraryReadOnly();
    handled = true;
  }

  if (syncAll || changedKey === WORKOUT_PREFERENCES_KEY) {
    F.state.preferences = loadPreferences();
    handled = true;
  }

  if (syncAll || changedKey === WORKOUT_GOALS_KEY) {
    F.state.goals = readGoalsReadOnly();
    handled = true;
  }

  if (syncAll || changedKey === WORKOUT_ROTATION_KEY) {
    F.state.rotation = readRotationReadOnly();
    handled = true;
  }

  if (syncAll || changedKey === WORKOUT_PROFILE_KEY) {
    F.state.profile = readProfileReadOnly();
    handled = true;
  }

  if (
    syncAll ||
    changedKey === WORKOUT_ACTIVE_KEY ||
    changedKey === WORKOUT_ROUTINES_KEY ||
    changedKey === WORKOUT_EXERCISES_KEY
  ) {
    F.state.activeWorkout = readActiveWorkoutReadOnly();
    handled = true;
  }

  if (syncAll) {
    refreshStorageInfoReadOnly(null);
  } else if (F.registry.byKey(changedKey)) {
    refreshStorageInfoReadOnly(changedKey);
    handled = true;
  }

  return handled;
}

F.syncStateFromStorage = syncStateFromStorage;

F.saveRoutines = function saveRoutines() {
  const ok = saveJSON(WORKOUT_ROUTINES_KEY, F.state.routines);
  if (ok) F.store.notifyChanged(WORKOUT_ROUTINES_KEY);
  return ok;
};

F.saveLibrary = saveLibrary;
F.savePreferences = savePreferences;
F.saveActiveWorkout = saveActiveWorkout;
F.saveGoals = saveGoals;
F.saveRotation = saveRotation;

Object.assign(F, {
  normalizeExercise,
  normalizeRoutine,
  normalizeLibraryItem,
  normalizeGoals,
  normalizeRotation,
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
  getStartableRoutines,
  resolveNextRoutine,
  nextRoutine: resolveNextRoutine,
  advanceRotation,
  rollbackDiscardedRotation,
  reconcileRotationAfterDelete,
  reconcileRotationAfterRoutineChange,
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
  emptyRotation,
  loadLibrary,
  loadPreferences,
  loadGoals,
  loadRotation,
  goalsAreActive,
  normalizeProfile,
  loadProfile,
  saveProfile,
  validateProfileStore,
  profileSummarize,
  profileIsConfigured,
  profileHasAnyAnswer,
  profileGoalSuggestion,
  resolvePersonagem,
  PERFIL_OPTIONS,
  PERFIL_LABELS,
  PERFIL_OBJETIVOS,
  PERFIL_NIVEIS,
  PERFIL_EQUIPAMENTOS,
  PERFIL_SEXOS,
  PERFIL_MODALIDADES,
  PERFIL_VERSION,
  PERFIL_MAX_DIAS,
  PERFIL_MAX_MINUTOS,
  PERSONAGENS,
  validateRoutinesStore,
  validateHistoryList,
  normalizeHistoryList,
  sortHistoryRecords,
  historyRecordTime,
  validateActiveSession,
  validateLibraryStore,
  validateGoalsStore,
  validateRotationStore,
  validateLegacyExercises,
  validateAuxiliaryValue,
  assertExerciseShape,
  removeStorageKey,
  WORKOUT_GOALS_KEY,
  WORKOUT_ROTATION_KEY,
  MISSION_KEY_PATTERN,
  GOAL_TARGET_LIMIT
});

F.validateMissionList = validateMissionList;
F.summarizeMissionList = summarizeMissionList;

})(window);
