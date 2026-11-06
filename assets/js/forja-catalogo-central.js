/*
  FORJA — modelo, validação e consultas do catálogo central.

  Este módulo não conhece DOM, localStorage ou rotinas. A conversão para o
  formato antigo fica em forja-biblioteca.js e é a única ponte com os consumidores
  atuais. Assim os IDs e regras novos podem evoluir sem migração de dados do usuário.
*/
(function (global) {
  "use strict";

  const F = global.Forja = global.Forja || {};
  const DATA = global.FORJA_EXERCISES_DATA;

  const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
  const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  const MEDIA_STATES = ["pending", "validated", "rejected", "unavailable"];
  const DIFFICULTIES = ["iniciante", "intermediario", "avancado"];
  const EXERCISE_TYPES = ["isolado", "multiarticular", "isometrico", "cardio", "mobilidade"];
  const DEFAULT_TYPES = ["reps", "duration"];
  const EQUIPMENT = [
    "anilhas", "argolas", "banco", "barra", "barra-fixa", "barra-t", "bicicleta",
    "bola", "cadeira-extensora", "corda", "elastico", "estrutura", "gripper",
    "halteres", "kettlebell", "leg-press", "maquina", "maquina-smith",
    "mesa-flexora", "paralelas", "peck-deck", "plataforma", "polia", "rack",
    "esteira", "toalha"
  ];
  const CALISTHENICS_EQUIPMENT = ["argolas", "barra-fixa", "estrutura", "paralelas", "plataforma", "toalha"];

  const LEGACY_MUSCLES = Object.freeze({
    biceps: "bíceps", triceps: "tríceps", peitoral: "peito", costas: "dorsais",
    ombros: "ombros", trapezio: "trapézio", abdomen: "abdômen", obliquos: "oblíquos",
    quadriceps: "quadríceps", posteriores: "posterior de coxa", gluteos: "glúteos",
    panturrilhas: "panturrilha", antebracos: "antebraços"
  });

  const LEGACY_CATEGORY = Object.freeze({
    biceps: "pull", triceps: "push", peitoral: "push", costas: "pull",
    ombros: "push", trapezio: "pull", abdomen: "core", obliquos: "core",
    quadriceps: "legs", posteriores: "legs", gluteos: "legs",
    panturrilhas: "legs", antebracos: "pull"
  });

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeText(value) {
    return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function stringArray(value, errors, path, options = {}) {
    if (!Array.isArray(value)) {
      errors.push(path + " deve ser uma lista.");
      return;
    }
    if (options.min && value.length < options.min) errors.push(path + " está incompleta.");
    const seen = new Set();
    value.forEach((item, index) => {
      if (typeof item !== "string" || !item.trim()) errors.push(path + "[" + index + "] deve ser texto preenchido.");
      const key = normalizeText(item);
      if (seen.has(key)) errors.push(path + " contém item duplicado: " + item);
      seen.add(key);
    });
  }

  function validateMedia(media, errors) {
    if (!isObject(media) || !isObject(media.image) || !isObject(media.youtube)) {
      errors.push("media deve conter image e youtube.");
      return;
    }
    const image = media.image;
    if (!MEDIA_STATES.includes(image.status)) errors.push("media.image.status inválido.");
    if (image.src !== null && (typeof image.src !== "string" || !/^assets\/demonstracoes\/[a-z0-9-]+\.webp$/.test(image.src))) {
      errors.push("media.image.src deve ser null ou um WebP local do catálogo.");
    }
    if (image.status === "validated" && !image.src) errors.push("Imagem validada precisa de src.");
    if (image.src === null && image.status !== "pending" && image.status !== "unavailable") {
      errors.push("Imagem sem src deve estar pendente ou indisponível.");
    }

    const video = media.youtube;
    if (!MEDIA_STATES.includes(video.status)) errors.push("media.youtube.status inválido.");
    if (video.videoId !== null && (typeof video.videoId !== "string" || !YOUTUBE_ID_PATTERN.test(video.videoId))) {
      errors.push("media.youtube.videoId inválido.");
    }
    if (video.durationSeconds !== null && (!Number.isInteger(video.durationSeconds) || video.durationSeconds < 1 || video.durationSeconds > 60)) {
      errors.push("media.youtube.durationSeconds deve estar entre 1 e 60 ou ser null.");
    }
    if (video.validatedAt !== null && (typeof video.validatedAt !== "string" || !Number.isFinite(Date.parse(video.validatedAt)))) {
      errors.push("media.youtube.validatedAt inválido.");
    }
    if (typeof video.editorialReview !== "boolean") errors.push("media.youtube.editorialReview deve ser booleano.");
    if (video.status === "pending") {
      if (video.videoId !== null || video.durationSeconds !== null || video.validatedAt !== null || video.editorialReview) {
        errors.push("Vídeo pendente não pode conter validação ou ID associado.");
      }
    }
    if (video.status === "validated") {
      if (!video.videoId || !video.durationSeconds || !video.validatedAt || video.editorialReview !== true) {
        errors.push("Vídeo validado exige ID, duração, data e revisão editorial.");
      }
    }
    if (video.status === "rejected" && video.editorialReview) {
      errors.push("Vídeo rejeitado não pode carregar aprovação editorial.");
    }
  }

  function validateRecord(record, context) {
    const errors = [];
    const at = message => errors.push((record && record.id ? record.id : "registro") + ": " + message);
    if (!isObject(record)) return ["Registro deve ser um objeto."];
    if (typeof record.id !== "string" || !ID_PATTERN.test(record.id)) at("id inválido.");
    if (context.ids.has(record.id)) at("id duplicado.");
    context.ids.add(record.id);
    if (!text(record.name)) at("nome ausente.");
    if (!text(record.description)) at("descrição ausente.");

    stringArray(record.aliases, errors, "aliases");
    stringArray(record.secondaryMuscles, errors, "secondaryMuscles");
    stringArray(record.stabilizers, errors, "stabilizers");
    stringArray(record.equipment, errors, "equipment");
    stringArray(record.instructions, errors, "instructions", { min: 1 });
    stringArray(record.technique, errors, "technique", { min: 1 });
    stringArray(record.cautions, errors, "cautions", { min: 1 });

    if (!context.muscles.has(record.primaryMuscle)) at("músculo principal inválido.");
    [record.secondaryMuscles, record.stabilizers].forEach((list, listIndex) => {
      if (!Array.isArray(list)) return;
      list.forEach(muscle => {
        if (!context.muscles.has(muscle)) at("músculo inválido: " + muscle);
        if (muscle === record.primaryMuscle) at("músculo principal repetido em outro papel.");
      });
      if (listIndex === 1 && Array.isArray(record.secondaryMuscles)) {
        record.secondaryMuscles.forEach(muscle => {
          if (list.includes(muscle)) at("músculo repetido entre secundários e estabilizadores: " + muscle);
        });
      }
    });

    if (!context.modalities.has(record.modality)) at("modalidade inválida.");
    if (!DIFFICULTIES.includes(record.difficulty)) at("dificuldade inválida.");
    if (!EXERCISE_TYPES.includes(record.exerciseType)) at("exerciseType inválido.");
    if (typeof record.movementPattern !== "string" || !SLUG_PATTERN.test(record.movementPattern)) at("movementPattern inválido.");
    if (Array.isArray(record.equipment)) record.equipment.forEach(item => {
      if (!EQUIPMENT.includes(item)) at("equipamento desconhecido: " + item);
    });
    if (record.modality === "peso-corporal" && (!Array.isArray(record.equipment) || record.equipment.length !== 0)) {
      at("Peso corporal exige equipment vazio.");
    }
    if (record.modality === "calistenia" && Array.isArray(record.equipment)) {
      if (!record.equipment.length) at("Calistenia deve declarar a estrutura necessária.");
      record.equipment.forEach(item => {
        if (!CALISTHENICS_EQUIPMENT.includes(item)) at("equipamento não pertence à Calistenia: " + item);
      });
    }
    if (record.modality === "academia" && (!Array.isArray(record.equipment) || !record.equipment.length)) {
      at("Academia deve declarar ao menos um equipamento.");
    }

    if (!isObject(record.ranking)) at("ranking ausente.");
    else {
      if (!Number.isInteger(record.ranking.position) || record.ranking.position < 1 || record.ranking.position > 99) at("ranking.position inválido.");
      if (record.ranking.type !== "editorial") at("somente ranking editorial identificado é aceito nesta versão.");
      if (record.ranking.criteriaVersion !== DATA.criteriaVersion) at("criteriaVersion incompatível.");
      const key = record.primaryMuscle + "|" + record.modality;
      const previous = context.rankings.get(key);
      if (previous && previous.has(record.ranking.position)) at("ranking duplicado em " + key + ": " + record.ranking.position);
      if (!previous) context.rankings.set(key, new Set());
      context.rankings.get(key).add(record.ranking.position);
    }

    if (!isObject(record.defaults)) at("defaults ausente.");
    else {
      const defaults = record.defaults;
      if (!DEFAULT_TYPES.includes(defaults.type)) at("defaults.type inválido.");
      if (!Number.isInteger(defaults.sets) || defaults.sets < 1 || defaults.sets > 30) at("defaults.sets inválido.");
      if (!Number.isInteger(defaults.rest) || defaults.rest < 0 || defaults.rest > 3600) at("defaults.rest inválido.");
      if (defaults.type === "reps") {
        if (typeof defaults.reps !== "string" || !defaults.reps.trim()) at("defaults.reps obrigatório para repetições.");
        if (defaults.duration !== null) at("exercício por repetições deve ter duration null.");
      } else {
        if (!Number.isInteger(defaults.duration) || defaults.duration < 1 || defaults.duration > 7200) at("defaults.duration inválido.");
        if (defaults.reps !== "") at("exercício por duração deve ter reps vazio.");
      }
    }

    const mediaErrors = [];
    validateMedia(record.media, mediaErrors);
    mediaErrors.forEach(at);

    const nameKey = normalizeText(record.name);
    if (context.names.has(nameKey)) at("nome duplicado com " + context.names.get(nameKey));
    context.names.set(nameKey, record.id);
    (Array.isArray(record.aliases) ? record.aliases : []).forEach(alias => {
      const key = normalizeText(alias);
      if (key === nameKey) at("alias repete o nome oficial: " + alias);
      if (context.searchNames.has(key) && context.searchNames.get(key) !== record.id) {
        at("alias/nome ambíguo com " + context.searchNames.get(key) + ": " + alias);
      }
      context.searchNames.set(key, record.id);
    });
    if (context.searchNames.has(nameKey) && context.searchNames.get(nameKey) !== record.id) {
      at("nome já usado como alias por " + context.searchNames.get(nameKey));
    }
    context.searchNames.set(nameKey, record.id);
    return errors;
  }

  function validate(data = DATA) {
    const errors = [];
    if (!isObject(data)) return { valid: false, errors: ["Dados do catálogo ausentes."] };
    if (data.schemaVersion !== 1) errors.push("schemaVersion deve ser 1.");
    if (data.criteriaVersion !== "1") errors.push("criteriaVersion deve ser 1.");
    if (!Array.isArray(data.muscleGroups) || !data.muscleGroups.length) errors.push("Grupos musculares ausentes.");
    if (!Array.isArray(data.modalities) || data.modalities.length !== 3) errors.push("São necessárias três modalidades.");
    if (!Array.isArray(data.exercises) || !data.exercises.length) errors.push("Exercícios ausentes.");
    const muscles = new Set((data.muscleGroups || []).map(group => group.id));
    const modalities = new Set((data.modalities || []).map(mode => mode.id));
    const requiredMuscles = ["biceps", "triceps", "peitoral", "costas", "ombros", "trapezio", "abdomen", "obliquos", "quadriceps", "posteriores", "gluteos", "panturrilhas", "antebracos"];
    requiredMuscles.forEach(id => { if (!muscles.has(id)) errors.push("Grupo obrigatório ausente: " + id); });
    ["academia", "calistenia", "peso-corporal"].forEach(id => { if (!modalities.has(id)) errors.push("Modalidade ausente: " + id); });
    (data.muscleGroups || []).forEach(group => {
      if (!isObject(group) || !ID_PATTERN.test(group.id || "") || !text(group.name) || !text(group.description)) errors.push("Grupo muscular inválido: " + (group && group.id));
    });
    (data.modalities || []).forEach(mode => {
      if (!isObject(mode) || !ID_PATTERN.test(mode.id || "") || !text(mode.name) || !text(mode.description)) errors.push("Modalidade inválida: " + (mode && mode.id));
      if (mode.id === "academia" && mode.legacyMode !== "weights") errors.push("Academia deve mapear para weights.");
      if ((mode.id === "calistenia" || mode.id === "peso-corporal") && mode.legacyMode !== "calisthenics") errors.push(mode.id + " deve mapear para calisthenics.");
    });
    const context = { ids: new Set(), names: new Map(), searchNames: new Map(), rankings: new Map(), muscles, modalities };
    (data.exercises || []).forEach(record => errors.push(...validateRecord(record, context)));
    context.rankings.forEach((positions, key) => {
      const ordered = Array.from(positions).sort((a, b) => a - b);
      ordered.forEach((position, index) => {
        if (position !== index + 1) errors.push("Ranking " + key + " tem lacuna ou posição artificial: esperado " + (index + 1) + ", encontrado " + position + ".");
      });
    });
    if (!isObject(data.legacyIdMap)) errors.push("legacyIdMap ausente.");
    else Object.entries(data.legacyIdMap).forEach(([legacyId, canonicalId]) => {
      if (!ID_PATTERN.test(legacyId)) errors.push("ID legado inválido: " + legacyId);
      if (context.ids.has(legacyId)) errors.push("Mapa legado desnecessário para ID já canônico: " + legacyId);
      if (!context.ids.has(canonicalId)) errors.push("Destino legado inexistente: " + legacyId + " -> " + canonicalId);
    });
    return { valid: errors.length === 0, errors };
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object") return value;
    /* DATA já congela as coleções de primeiro nível; ainda assim é preciso
       descer nos registros aninhados antes de publicar a API. */
    Object.freeze(value);
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return value;
  }

  function groupById(id) {
    return DATA.muscleGroups.find(group => group.id === id) || null;
  }

  function modalityById(id) {
    return DATA.modalities.find(mode => mode.id === id) || null;
  }

  function byId(id) {
    const canonical = DATA.legacyIdMap[id] || id;
    return DATA.exercises.find(record => record.id === canonical) || null;
  }

  function filter(options = {}) {
    const query = normalizeText(options.query);
    return DATA.exercises.filter(record => {
      if (options.primaryMuscle && record.primaryMuscle !== options.primaryMuscle) return false;
      if (options.muscle && record.primaryMuscle !== options.muscle && !record.secondaryMuscles.includes(options.muscle) && !record.stabilizers.includes(options.muscle)) return false;
      if (options.modality && record.modality !== options.modality) return false;
      if (options.difficulty && record.difficulty !== options.difficulty) return false;
      if (options.equipment && !record.equipment.includes(options.equipment)) return false;
      if (!query) return true;
      const names = [record.name].concat(record.aliases).map(normalizeText);
      return query.split(/\s+/).filter(Boolean).every(term => names.some(name => name.includes(term)));
    }).sort((a, b) => {
      if (options.primaryMuscle && options.modality) return a.ranking.position - b.ranking.position;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }

  function report() {
    const byMuscle = Object.fromEntries(DATA.muscleGroups.map(group => [group.id, 0]));
    const byModality = Object.fromEntries(DATA.modalities.map(mode => [mode.id, 0]));
    const rankings = {};
    let withoutImage = 0;
    let videosPrepared = 0;
    let validatedVideos = 0;
    const incomplete = [];
    DATA.exercises.forEach(record => {
      byMuscle[record.primaryMuscle] += 1;
      byModality[record.modality] += 1;
      const key = record.primaryMuscle + "|" + record.modality;
      rankings[key] = (rankings[key] || 0) + 1;
      if (!record.media.image.src) withoutImage += 1;
      if (isObject(record.media.youtube)) videosPrepared += 1;
      if (record.media.youtube.status === "validated") validatedVideos += 1;
      if (!record.name || !record.description || !record.instructions.length || !record.technique.length || !record.cautions.length) incomplete.push(record.id);
    });
    return {
      schemaVersion: DATA.schemaVersion,
      total: DATA.exercises.length,
      byPrimaryMuscle: byMuscle,
      byModality,
      incomplete,
      duplicateIds: [],
      withoutRanking: DATA.exercises.filter(record => !record.ranking).map(record => record.id),
      withoutImage,
      videosPrepared,
      validatedVideos,
      pendingVideos: DATA.exercises.length - validatedVideos,
      rankingCombinations: rankings,
      legacyAliases: Object.assign({}, DATA.legacyIdMap)
    };
  }

  function toLegacyExercise(recordOrId) {
    const record = typeof recordOrId === "string" ? byId(recordOrId) : recordOrId;
    if (!record) return null;
    const mode = modalityById(record.modality);
    if (!mode) return null;
    const roles = {
      primary: [LEGACY_MUSCLES[record.primaryMuscle]],
      secondary: record.secondaryMuscles.map(id => LEGACY_MUSCLES[id]),
      stabilizers: record.stabilizers.map(id => LEGACY_MUSCLES[id])
    };
    const instructions = record.instructions.concat(record.technique, record.cautions).join(" ");
    return {
      id: record.id,
      name: record.name,
      section: record.primaryMuscle === "abdomen" || record.primaryMuscle === "obliquos" ? "abs" : (record.exerciseType === "cardio" || record.exerciseType === "mobilidade" ? (record.defaults.sets <= 2 ? "warmup" : "finisher") : "main"),
      type: record.defaults.type,
      sets: record.defaults.sets,
      reps: record.defaults.type === "reps" ? record.defaults.reps : "12",
      duration: record.defaults.type === "duration" ? record.defaults.duration : 45,
      rest: record.defaults.rest,
      load: "",
      notes: "",
      category: record.exerciseType === "cardio" ? "cardio" : (record.exerciseType === "mobilidade" ? "mobility" : (record.id === "mus-farmer" ? "carry" : LEGACY_CATEGORY[record.primaryMuscle])),
      roles,
      equipment: record.modality === "peso-corporal" ? ["peso corporal"] : record.equipment.map(item => item.replace(/-/g, " ")),
      instructions,
      catalogModality: record.modality,
      difficulty: record.difficulty,
      exerciseType: record.exerciseType,
      movementPattern: record.movementPattern,
      aliases: record.aliases.slice(),
      ranking: Object.assign({}, record.ranking),
      media: JSON.parse(JSON.stringify(record.media))
    };
  }

  const initialValidation = validate();
  if (!initialValidation.valid) throw new Error("Catálogo central inválido:\n" + initialValidation.errors.join("\n"));

  deepFreeze(DATA);
  F.exerciseCatalog = Object.freeze({
    schemaVersion: DATA.schemaVersion,
    criteriaVersion: DATA.criteriaVersion,
    muscleGroups: DATA.muscleGroups,
    modalities: DATA.modalities,
    exercises: DATA.exercises,
    legacyIdMap: DATA.legacyIdMap,
    normalizeText,
    validate,
    byId,
    groupById,
    modalityById,
    filter,
    report,
    toLegacyExercise
  });
})(typeof window !== "undefined" ? window : globalThis);
