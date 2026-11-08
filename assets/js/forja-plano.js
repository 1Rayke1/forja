/*
  FORJA — geração de plano semanal integrada ao catálogo e às rotinas.
  O gerador local é determinístico por regras, nunca apresentado como IA.
  Se uma API backend estiver configurada, tenta primeiro o endpoint seguro e
  valida a resposta contra os IDs reais de F.catalog antes de usá-la.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const PLAN_KEY = "forja-plano-semanal-v1";
  const PREFERENCES_KEY = "forja-planejamento-preferencias-v1";
  const DEFAULT_PREFERENCES = Object.freeze({ goal: "massa", level: "intermediario", days: 4, time: "medium", equipment: "none" });
  const CATEGORY_TO_MUSCLE = Object.freeze({
    pernas: ["legs"], peito: ["push"], bracos: ["push", "pull"],
    abdomen: ["core"], corpoTodo: ["legs", "push", "pull", "core"]
  });
  const DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
  const el = id => F.byId(id);
  const cleanString = (value, max = 220) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const safeArray = value => Array.isArray(value) ? value : [];

  function readPlan() {
    try {
      const value = JSON.parse(global.localStorage.getItem(PLAN_KEY) || "null");
      return F.isPlainObject(value) && value.version === 1 && Array.isArray(value.sessions) ? value : null;
    } catch (_) { return null; }
  }

  function writePlan(plan) {
    try { global.localStorage.setItem(PLAN_KEY, JSON.stringify(plan)); return true; }
    catch (_) { return false; }
  }

  function supportedModes(profile) {
    const preference = safeArray(profile.preferenciasTreino);
    if (profile.modalidadePreferida === "calisthenics") return ["calisthenics"];
    if (profile.modalidadePreferida === "weights") return ["weights"];
    if (preference.includes("calistenia") && !preference.includes("musculacao")) return ["calisthenics"];
    if (preference.includes("musculacao") && !preference.includes("calistenia")) return ["weights"];
    if (profile.localTreino === "casa" || profile.localTreino === "arLivre") return ["calisthenics"];
    if (profile.localTreino === "academia") return ["weights", "calisthenics"];
    if (profile.equipamento === "nenhum" || profile.equipamento === "casa") return ["calisthenics"];
    if (profile.equipamento === "academia") return ["weights", "calisthenics"];
    return ["calisthenics", "weights"];
  }

  function equipmentAllowed(record, profile) {
    const equipment = safeArray(record.equipment);
    const preference = profile.planPreferences && profile.planPreferences.equipment;
    /* Sem equipamento e em casa são deliberadamente estritos: somente [] do catálogo central passa. */
    if (preference === "none" || preference === "home") return equipment.length === 0;
    if (preference === "gym") return true;
    /* Compatibilidade com perfis antigos, fora do novo planejador. */
    const legacy = profile.equipamento;
    if (!equipment.length || equipment.includes("peso corporal")) return true;
    if (legacy === "nenhum") return false;
    if (legacy === "academia" || legacy === "ambos") return true;
    return false;
  }

  function compatibleCatalog(profile) {
    const equipmentPreference = profile.planPreferences && profile.planPreferences.equipment;
    const modes = equipmentPreference === "gym" ? ["weights", "calisthenics"] :
      (equipmentPreference === "home" || equipmentPreference === "none") ? ["calisthenics", "weights"] : supportedModes(profile);
    let records = modes.flatMap(mode => F.catalog.items(mode));
    records = records.filter(record => equipmentAllowed(record, profile));
    const prefs = safeArray(profile.preferenciasTreino);
    if (prefs.includes("cardio") && !prefs.includes("musculacao") && !prefs.includes("calistenia")) {
      records = records.filter(record => record.category === "cardio" || record.category === "mobility");
    }
    if (safeArray(profile.consideracoes).includes("baixoImpacto")) {
      records = records.filter(record => record.category !== "cardio" || !/burpee|polichinelo|salto|jump/i.test(record.name));
    }
    return records;
  }

  function focusCategories(profile) {
    const focus = CATEGORY_TO_MUSCLE[profile.areaFoco] || CATEGORY_TO_MUSCLE.corpoTodo;
    const objective = profile.objetivo;
    if (["resistencia", "perderPeso"].includes(objective)) return ["legs", "push", "pull", "core", "cardio"];
    return focus;
  }

  function trainingSignals(records) {
    const cutoff = Date.now() - 28 * 24 * 60 * 60 * 1000;
    const known = new Set(records.map(record => record.libraryId || record.id));
    const recentExerciseCounts = {};
    const rpes = [];
    let recentSessions = 0;
    safeArray(F.state && F.state.history).forEach(entry => {
      if (!F.isPlainObject(entry)) return;
      const timestamp = Date.parse(entry.finishedAt || entry.date || "");
      if (!Number.isFinite(timestamp) || timestamp < cutoff || timestamp > Date.now() + 86400000) return;
      recentSessions += 1;
      const rpe = Number(entry.feedback && entry.feedback.rpe);
      if (Number.isFinite(rpe) && rpe >= 1 && rpe <= 10) rpes.push(rpe);
      safeArray(entry.exercises).forEach(exercise => {
        const id = exercise && exercise.libraryId;
        if (typeof id === "string" && known.has(id)) recentExerciseCounts[id] = (recentExerciseCounts[id] || 0) + 1;
      });
    });
    return { recentSessions, averageRpe: rpes.length ? Math.round(rpes.reduce((sum, value) => sum + value, 0) / rpes.length * 10) / 10 : null,
      highEffort: rpes.length > 0 && rpes.reduce((sum, value) => sum + value, 0) / rpes.length >= 8, recentExerciseCounts };
  }

  function sessionFocus(profile, index, count) {
    const objective = profile.planPreferences && profile.planPreferences.goal;
    if (objective === "condicionamento") return index % 2 === 0 ? ["cardio", "legs", "core"] : ["cardio", "push", "pull"];
    if (objective === "emagrecer") return index % 2 === 0 ? ["legs", "cardio", "core", "push"] : ["push", "pull", "cardio", "legs"];
    const splits = [
      ["push", "pull", "legs", "core"],
      ["legs", "push", "pull", "core"],
      ["pull", "legs", "core", "push"],
      ["legs", "core", "push", "pull"]
    ];
    return splits[index % splits.length];
  }

  function selectSessionRecords(records, profile, sessionIndex, feedback, signals, alreadyUsed) {
    const focus = sessionFocus(profile, sessionIndex, Number(profile.diasPorSemana) || 3);
    const preference = profile.planPreferences || {};
    const maxExercises = preference.time === "short" ? 3 : 5;
    const avoidHighVolume = ["iniciante", "retornando", ""].includes(profile.nivel) ||
      ["comecando", "basicos"].includes(profile.experienciaAtual) || safeArray(profile.consideracoes).includes("adaptarNivel");
    const ordered = records.filter(item => item.section === "main" || item.section === "abs" || item.section === "finisher");
    const affinity = record => { const rank = focus.indexOf(record.category); return rank < 0 ? focus.length + 1 : rank; };
    ordered.sort((a, b) => {
      const aId = a.libraryId || a.id, bId = b.libraryId || b.id;
      const usedA = alreadyUsed.has(aId) ? 1 : 0, usedB = alreadyUsed.has(bId) ? 1 : 0;
      const aUse = signals && signals.recentExerciseCounts[aId] || 0, bUse = signals && signals.recentExerciseCounts[bId] || 0;
      return usedA - usedB || affinity(a) - affinity(b) || aUse - bUse || a.name.localeCompare(b.name, "pt-BR");
    });
    const picked = [], categories = new Set();
    for (const record of ordered) {
      if (picked.length >= maxExercises) break;
      const id = record.libraryId || record.id;
      if (picked.some(item => (item.libraryId || item.id) === id)) continue;
      /* Não enche uma sessão com várias variações do mesmo padrão quando há outras categorias. */
      if (categories.has(record.category) && categories.size < Math.min(3, maxExercises)) continue;
      picked.push(record); categories.add(record.category);
    }
    const easy = avoidHighVolume || feedback === "muito-dificil" || Boolean(signals && signals.highEffort);
    const targetSets = easy ? 2 : (preference.time === "long" && profile.nivel !== "iniciante" ? 3 : 2);
    return picked.map(record => {
      const clone = F.catalog.toExercise(record, record.section);
      if (!clone) return null;
      clone.catalogId = record.libraryId || record.id;
      clone.muscles = safeArray(record.muscles).slice();
      clone.equipment = safeArray(record.equipment).slice();
      clone.instructions = cleanString(record.instructions, 600);
      clone.sets = Math.max(2, Math.min(Number(record.sets) || 3, targetSets));
      clone.rest = Math.max(Number(record.rest) || 45, profile.nivel === "avancado" ? 75 : 60);
      if (record.type === "duration") clone.duration = Math.min(Number(record.duration) || 30, 45);
      else clone.reps = preference.goal === "condicionamento" ? "10–15" : profile.nivel === "iniciante" ? "8–10" : profile.nivel === "avancado" ? "6–10" : "8–12";
      const alternative = records.find(other => other.category === record.category && (other.libraryId || other.id) !== clone.catalogId);
      clone.notes = alternative ? "Alternativa compatível: " + cleanString(alternative.name, 90) : "";
      return clone;
    }).filter(Boolean);
  }

  function rationale(profile, sessionCount, signals) {
    const objective = F.PERFIL_OPTIONS.objetivo.find(item => item.value === profile.objetivo);
    const focusLabels = { corpoTodo: "corpo inteiro", bracos: "braços", peito: "peito", abdomen: "abdômen", pernas: "pernas" };
    const level = profile.nivel || profile.experienciaAtual || "nível informado";
    return "Organização de " + sessionCount + " sessões por semana para " +
      (objective ? objective.label.toLowerCase() : "seu objetivo") + ", com prioridade em " +
      (focusLabels[profile.areaFoco] || "movimentos de corpo inteiro") +
      ". Volume moderado para respeitar a experiência (" + level + ") e alternar estímulos com recuperação." +
      (signals && signals.recentSessions ? " Considera " + signals.recentSessions + " sessão(ões) recentes e o feedback de esforço disponível." : " Ainda não há histórico recente para orientar os ajustes.");
  }

  function trainingDays(count) {
    const map = { 2:[0,3], 3:[0,2,4], 4:[0,2,4,6], 5:[0,1,3,4,6], 6:[0,1,2,4,5,6] };
    return map[count] || map[3];
  }

  function estimateSessionMinutes(exercises) {
    const seconds = exercises.reduce((sum, exercise) => {
      const work = exercise.type === "duration" ? Number(exercise.duration) || 30 : 40;
      return sum + Number(exercise.sets || 2) * work + Math.max(0, Number(exercise.sets || 2) - 1) * Number(exercise.rest || 60) + 90;
    }, 360);
    return Math.max(10, Math.round((seconds * 1.12) / 60 / 5) * 5);
  }

  function localPlan(profile, previous) {
    const count = Math.min(6, Math.max(2, Number(profile.diasPorSemana) || 3));
    const records = compatibleCatalog(profile);
    const signals = trainingSignals(records);
    const existingFeedback = previous && previous.feedback ? previous.feedback : {};
    if (!records.some(record => ["main", "abs", "finisher"].includes(record.section))) {
      throw new Error("Não encontramos exercícios compatíveis no catálogo com essa disponibilidade. O FORJA não vai incluir equipamentos que você não selecionou.");
    }
    const days = trainingDays(count), sessions = [], used = new Set();
    for (let index = 0; index < count; index += 1) {
      const dayRecords = selectSessionRecords(records, profile, index, existingFeedback["session-" + index], signals, used);
      if (!dayRecords.length) throw new Error("Não há exercícios compatíveis disponíveis no catálogo para este perfil.");
      dayRecords.forEach(exercise => used.add(exercise.catalogId));
      const focus = sessionFocus(profile, index, count);
      const labels = { push:"Empurrar", pull:"Puxar", legs:"Pernas", core:"Core", cardio:"Condicionamento" };
      const focusLabel = focus.slice(0, 2).map(key => labels[key]).join(" e ");
      sessions.push({ id:"session-" + index, day:DAYS[days[index]], title: profile.planPreferences && profile.planPreferences.goal === "condicionamento" ? "Condicionamento " + String.fromCharCode(65 + index) : "Treino " + focusLabel,
        rationale:"Sessão moderada, organizada para alternar grupos musculares e preservar recuperação entre os estímulos.", exercises:dayRecords, scheduleDate:null,
        estimatedMinutes:estimateSessionMinutes(dayRecords) });
    }
    const goalLabels = { massa:"ganho de massa", emagrecer:"emagrecimento", condicionamento:"condicionamento" };
    return { version:1, id:previous && previous.id || "plan-" + Date.now().toString(36) + Math.random().toString(36).slice(2,7),
      engine:"rules", createdAt:new Date().toISOString(), summary:"Proposta de " + count + " sessões para " + (goalLabels[profile.planPreferences && profile.planPreferences.goal] || "seu objetivo") + ". A estimativa de duração é aproximada; revise exercícios, séries e repetições antes de salvar." + (signals.recentSessions ? " Considera " + signals.recentSessions + " sessão(ões) recente e o feedback de esforço disponível." : " Ainda não há histórico recente para orientar ajustes."),
      weeklyDays:count, sessions, feedback:existingFeedback, preferences:Object.assign({}, profile.planPreferences || {}) };
  }

  function publicPayload(profile, records, previous) {
    return {
      profile: {
        objective: profile.objetivo || "",
        focus: profile.areaFoco || "",
        level: profile.nivel || "",
        experience: profile.experienciaAtual || "",
        daysPerWeek: Math.max(1, Math.min(6, Number(profile.diasPorSemana) || 3)),
        location: profile.localTreino || "",
        equipment: safeArray(profile.equipamentos),
        legacyEquipment: profile.equipamento || "",
        modalities: safeArray(profile.preferenciasTreino),
        limitations: safeArray(profile.consideracoes)
      },
      feedback: previous && previous.feedback || {},
      history: (() => {
        const signals = trainingSignals(records);
        return { recentSessions: Math.min(30, signals.recentSessions), averageRpe: signals.averageRpe };
      })(),
      catalog: records.map(record => ({ id: record.libraryId || record.id, name: record.name,
        mode: record.mode, category: record.category, section: record.section, type: record.type,
        muscles: safeArray(record.muscles), equipment: safeArray(record.equipment),
        sets: record.sets, reps: record.reps, duration: record.duration, rest: record.rest }))
    };
  }

  function validateModelOutput(value, records, profile, previous) {
    if (!F.isPlainObject(value) || !Array.isArray(value.sessions)) throw new Error("Formato de plano inválido.");
    const maxDays = Math.min(6, Math.max(1, Number(profile.diasPorSemana) || 3));
    if (value.sessions.length < 1 || value.sessions.length > maxDays) throw new Error("A IA sugeriu uma quantidade de sessões incompatível.");
    const allow = new Map(records.map(record => [record.libraryId || record.id, record]));
    const sessions = value.sessions.map((session, index) => {
      if (!F.isPlainObject(session) || !Array.isArray(session.exercises) || session.exercises.length < 2 || session.exercises.length > 8) {
        throw new Error("Estrutura de sessão inválida.");
      }
      const exercises = session.exercises.map(item => {
        const record = allow.get(item.exerciseId);
        if (!record) throw new Error("A IA sugeriu um exercício ausente ou incompatível com a biblioteca.");
        const sets = Number(item.sets);
        const rest = Number(item.restSeconds);
        if (!Number.isInteger(sets) || sets < 1 || sets > 5 || !Number.isInteger(rest) || rest < 0 || rest > 300) {
          throw new Error("Parâmetros de treino fora dos limites seguros.");
        }
        const exercise = F.catalog.toExercise(record, record.section);
        if (!exercise) throw new Error("Não foi possível materializar um exercício validado.");
        exercise.catalogId = record.libraryId || record.id;
        exercise.muscles = safeArray(record.muscles).slice();
        exercise.equipment = safeArray(record.equipment).slice();
        exercise.instructions = cleanString(record.instructions, 600);
        exercise.sets = sets;
        exercise.rest = rest;
        if (record.type === "duration") {
          const duration = Number(item.durationSeconds);
          if (!Number.isInteger(duration) || duration < 10 || duration > 600) throw new Error("Duração inválida.");
          exercise.duration = duration;
        } else {
          const reps = Number(item.repetitions);
          if (!Number.isInteger(reps) || reps < 4 || reps > 20) throw new Error("Repetições inválidas.");
          exercise.reps = String(reps);
        }
        const alternative = records.find(other => other.category === record.category && other.id !== record.id);
        exercise.notes = [cleanString(record.instructions, 180), alternative ? "Alternativa: " + cleanString(alternative.name, 90) : ""].filter(Boolean).join(" ");
        return exercise;
      });
      const weekday = DAYS.includes(session.day) ? session.day : DAYS[(index * 2) % DAYS.length];
      return { id: "session-" + index, day: weekday, title: cleanString(session.title, 50) || "Treino " + (index + 1),
        rationale: cleanString(session.rationale, 240) || "Sessão equilibrada com descanso entre grupos musculares.", exercises, scheduleDate: null };
    });
    return { version: 1, id: previous && previous.id || "plan-" + Date.now().toString(36), engine: "ai",
      createdAt: new Date().toISOString(), summary: cleanString(value.summary, 300) || rationale(profile, sessions.length),
      weeklyDays: sessions.length, sessions, feedback: previous && previous.feedback || {} };
  }

  async function requestAI(profile, records, previous) {
    /* Não encaminha exercícios personalizados: seus nomes e instruções podem conter informação do usuário. */
    const providerRecords = records.filter(record => record.suggested === true);
    if (!providerRecords.length) throw new Error("Catálogo público indisponível para solicitar IA.");
    const response = await global.fetch("/api/workout-plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(publicPayload(profile, providerRecords, previous))
    });
    if (!response.ok) throw new Error("Serviço de IA indisponível (HTTP " + response.status + ").");
    const data = await response.json();
    return validateModelOutput(data.plan, providerRecords, profile, previous);
  }

  function nextDates(sessions) {
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const jsDay = { Domingo: 0, Segunda: 1, Terça: 2, Quarta: 3, Quinta: 4, Sexta: 5, Sábado: 6 };
    return sessions.map(session => {
      const target = jsDay[session.day];
      const date = new Date(now);
      let delta = (target - date.getDay() + 7) % 7;
      date.setDate(date.getDate() + delta);
      return date;
    });
  }

  function dateKey(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function updateCalendarTasks(previous, next) {
    const oldTasks = previous && Array.isArray(previous.calendarTasks) ? previous.calendarTasks : [];
    oldTasks.forEach(item => {
      try {
        const key = "forja-missoes-" + item.date;
        const current = JSON.parse(global.localStorage.getItem(key) || "[]");
        const updated = current.filter(task => !(task && task.id === item.id && !task.done && !task.completed));
        if (updated.length !== current.length) global.localStorage.setItem(key, JSON.stringify(updated));
      } catch (_) { /* calendário antigo/corrompido permanece intacto */ }
    });
    const dates = nextDates(next.sessions);
    const refs = [];
    next.sessions.forEach((session, index) => {
      const date = dates[index], dateText = dateKey(date);
      const id = next.id + "-" + session.id;
      const key = "forja-missoes-" + dateText;
      let tasks = [];
      try { tasks = JSON.parse(global.localStorage.getItem(key) || "[]"); if (!Array.isArray(tasks)) tasks = []; }
      catch (_) { tasks = []; }
      if (!tasks.some(task => task && task.id === id)) {
        tasks.push({ id, text: "Treino FORJA · " + session.title, done: false });
        global.localStorage.setItem(key, JSON.stringify(tasks));
      }
      session.scheduleDate = dateText;
      refs.push({ date: dateText, id });
    });
    return refs;
  }

  function routinesForPlan(plan) {
    const state = F.state.routines;
    const prefix = "forja-plan-session-" + plan.id + "-";
    const next = { calisthenics: state.calisthenics.filter(item => !String(item.id).startsWith(prefix)), weights: state.weights.filter(item => !String(item.id).startsWith(prefix)) };
    plan.sessions.forEach((session, index) => {
      const mode = session.exercises.some(exercise => exercise.mode === "weights") ? "weights" : "calisthenics";
      const routine = { id: "forja-plan-session-" + plan.id + "-" + index, name: "Plano FORJA · " + session.title,
        modality: mode, createdAt: Date.now(), updatedAt: Date.now(),
        sections: { warmup: [], main: [], abs: [], finisher: [] } };
      session.exercises.forEach(exercise => {
        const copy = Object.assign({}, exercise);
        const section = F.SECTION_ORDER.includes(copy.section) ? copy.section : "main";
        routine.sections[section].push(copy);
      });
      ["calisthenics", "weights"].forEach(key => {
        const existing = next[key].findIndex(item => item.id === routine.id);
        if (existing !== -1) next[key].splice(existing, 1);
      });
      next[mode].push(routine);
    });
    return next;
  }

  function savePlan(plan) {
    const previousPlan = readPlan();
    const previousRoutines = F.state.routines;
    const newRoutines = routinesForPlan(plan);
    F.state.routines = newRoutines;
    if (!F.saveRoutines()) { F.state.routines = previousRoutines; throw new Error("Não foi possível salvar as rotinas. Nenhum plano foi substituído."); }
    try { plan.calendarTasks = updateCalendarTasks(previousPlan, plan); }
    catch (_) { /* Rotinas continuam disponíveis mesmo se o calendário falhar. */ plan.calendarTasks = []; }
    if (!writePlan(plan)) throw new Error("Rotinas salvas, mas o plano não pôde ser registrado neste navegador.");
    return plan;
  }

  function text(tag, className, value) {
    const node = document.createElement(tag); if (className) node.className = className;
    node.textContent = value == null ? "" : String(value); return node;
  }

  function readPreferences() {
    /* As escolhas deste planejador são próprias; não sobrescrevem o perfil nem herdam suas metas. */
    const fallback = Object.assign({}, DEFAULT_PREFERENCES);
    try {
      const stored = JSON.parse(global.localStorage.getItem(PREFERENCES_KEY) || "null");
      const value = Object.assign({}, fallback, F.isPlainObject(stored) ? stored : {});
      if (!["massa","emagrecer","condicionamento"].includes(value.goal)) value.goal = fallback.goal;
      if (!["iniciante","intermediario","avancado"].includes(value.level)) value.level = fallback.level;
      if (![2,3,4,5,6].includes(Number(value.days))) value.days = fallback.days; else value.days = Number(value.days);
      if (!["short","medium","long"].includes(value.time)) value.time = fallback.time;
      if (!["gym","home","none"].includes(value.equipment)) value.equipment = fallback.equipment;
      return value;
    } catch (_) { return fallback; }
  }

  function profileForPreferences(preferences) {
    const goals = { massa:"hipertrofia", emagrecer:"perderPeso", condicionamento:"resistencia" };
    const levels = { iniciante:"iniciante", intermediario:"intermediario", avancado:"avancado" };
    return { objetivo:goals[preferences.goal] || goals.massa, nivel:levels[preferences.level] || levels.intermediario,
      experienciaAtual:preferences.level === "iniciante" ? "basicos" : "experiente", diasPorSemana:Number(preferences.days) || 4,
      equipamento:preferences.equipment === "gym" ? "academia" : "nenhum", equipamentos:preferences.equipment === "gym" ? ["academiaCompleta"] : [],
      preferenciasTreino:preferences.equipment === "gym" ? ["musculacao","calistenia"] : ["calistenia"],
      areaFoco:"corpoTodo", localTreino:preferences.equipment === "gym" ? "academia" : "casa", consideracoes:[], planPreferences:Object.assign({}, preferences) };
  }

  function renderPreferenceState(preferences) {
    document.querySelectorAll("[data-pref]").forEach(button => {
      button.setAttribute("aria-pressed", String(String(preferences[button.dataset.pref]) === button.dataset.value));
    });
  }

  function renderPlan(plan, saved) {
    const host = el("training-plan-preview"); if (!host) return;
    host.replaceChildren();
    if (!plan) return;
    const header = document.createElement("div"); header.className = "plan-summary";
    header.append(text("h3", "plan-summary-text", "Seu planejamento semanal"));
    header.append(text("p", "field-hint", saved ? "Plano salvo · sessões disponíveis em Minhas rotinas e no calendário." : plan.summary));
    host.appendChild(header);
    const schedule = document.createElement("div"); schedule.className = "week-schedule"; schedule.setAttribute("aria-label", "Semana de treino e recuperação");
    DAYS.forEach(day => {
      const session = plan.sessions.find(item => item.day === day);
      const cell = document.createElement("div"); cell.className = "week-schedule-day" + (session ? " is-training" : " is-rest");
      cell.append(text("strong", "", day.slice(0,3)), text("span", "", session ? "Treino" : "Recuperação"));
      schedule.appendChild(cell);
    });
    host.appendChild(schedule);
    plan.sessions.forEach((session, sessionIndex) => {
      const card = document.createElement("article"); card.className = "plan-session-card";
      const head = document.createElement("div"); head.className = "plan-session-head";
      head.append(text("div", "plan-session-day", session.day));
      const title = document.createElement("input"); title.className = "plan-session-title plan-title-input"; title.value = session.title; title.setAttribute("aria-label", "Nome da sessão de " + session.day); title.disabled = saved;
      title.addEventListener("input", () => { session.title = title.value.slice(0,50); });
      head.appendChild(title); card.appendChild(head);
      const groups = [...new Set(session.exercises.flatMap(exercise => safeArray(exercise.muscles)))];
      const duration = estimateSessionMinutes(session.exercises);
      session.estimatedMinutes = duration;
      card.appendChild(text("p", "plan-rationale", groups.join(" · ") + " · " + session.exercises.length + " exercícios · cerca de " + duration + " min"));
      const list = document.createElement("ul"); list.className = "plan-exercise-list";
      session.exercises.forEach((exercise, exerciseIndex) => {
        const item = document.createElement("li");
        item.appendChild(text("strong", "", exercise.name));
        if (!saved) {
          const tools = document.createElement("div"); tools.className = "plan-exercise-tools";
          const compatible = compatibleCatalog(profileForPreferences(plan.preferences || readPreferences())).filter(record => record.category === exercise.category && (record.libraryId || record.id) !== exercise.catalogId);
          if (compatible.length) {
            const replace = document.createElement("select"); replace.setAttribute("aria-label", "Substituir " + exercise.name); replace.title = "Substituir exercício";
            const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Trocar"; replace.appendChild(placeholder);
            compatible.forEach(record => { const option = document.createElement("option"); option.value = record.libraryId || record.id; option.textContent = record.name; replace.appendChild(option); });
            replace.addEventListener("change", () => {
              const record = compatible.find(candidate => (candidate.libraryId || candidate.id) === replace.value); if (!record) return;
              const replacement = F.catalog.toExercise(record, record.section); replacement.catalogId = record.libraryId || record.id;
              replacement.muscles = safeArray(record.muscles).slice(); replacement.equipment = safeArray(record.equipment).slice();
              replacement.sets = exercise.sets; replacement.reps = exercise.reps; replacement.rest = exercise.rest;
              session.exercises[exerciseIndex] = replacement; renderPlan(plan, false);
            });
            tools.appendChild(replace);
          }
          const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-button small-button"; remove.textContent = "Remover"; remove.setAttribute("aria-label", "Remover " + exercise.name);
          remove.addEventListener("click", () => { session.exercises.splice(exerciseIndex,1); if (!session.exercises.length) plan.sessions.splice(sessionIndex,1); renderPlan(plan,false); });
          tools.appendChild(remove); item.appendChild(tools);
        }
        const details = document.createElement("span");
        details.textContent = exercise.type === "duration" ? exercise.sets + " séries · " + exercise.duration + " s · descanso " + exercise.rest + " s" : exercise.sets + " séries · " + exercise.reps + " repetições · descanso " + exercise.rest + " s";
        item.appendChild(details);
        if (exercise.instructions) item.appendChild(text("small", "", exercise.instructions));
        if (!saved) {
          const adjust = document.createElement("div"); adjust.className = "plan-exercise-tools plan-adjust-tools";
          const sets = document.createElement("input"); sets.type="number"; sets.min="1"; sets.max="5"; sets.value=exercise.sets; sets.setAttribute("aria-label","Séries de " + exercise.name); sets.addEventListener("change",()=>{ exercise.sets=Math.max(1,Math.min(5,Number(sets.value)||1)); renderPlan(plan,false); });
          adjust.appendChild(sets);
          if (exercise.type === "duration") {
            const durationInput=document.createElement("input"); durationInput.type="number"; durationInput.min="10"; durationInput.max="600"; durationInput.value=exercise.duration; durationInput.setAttribute("aria-label","Duração em segundos de " + exercise.name); durationInput.addEventListener("change",()=>{exercise.duration=Math.max(10,Math.min(600,Number(durationInput.value)||30));renderPlan(plan,false);}); adjust.appendChild(durationInput);
          } else {
            const reps=document.createElement("input"); reps.type="text"; reps.maxLength=30; reps.value=exercise.reps; reps.setAttribute("aria-label","Repetições de " + exercise.name); reps.addEventListener("change",()=>{exercise.reps=reps.value.trim().slice(0,30)||"8";renderPlan(plan,false);}); adjust.appendChild(reps);
          }
          const rest=document.createElement("input"); rest.type="number"; rest.min="0"; rest.max="300"; rest.value=exercise.rest; rest.setAttribute("aria-label","Descanso em segundos de " + exercise.name); rest.addEventListener("change",()=>{exercise.rest=Math.max(0,Math.min(300,Number(rest.value)||0));renderPlan(plan,false);}); adjust.appendChild(rest);
          item.appendChild(adjust);
        }
        list.appendChild(item);
      });
      card.appendChild(list);
      host.appendChild(card);
    });
    if (!saved) {
      const save = document.createElement("button"); save.type="button"; save.className="primary-button plan-save"; save.textContent="Salvar meu planejamento";
      save.addEventListener("click", () => {
        if (!plan.sessions.length || plan.sessions.some(session => !session.exercises.length)) { showError("Cada sessão precisa conter pelo menos um exercício."); return; }
        try { const stored=savePlan(plan); renderPlan(stored,true); el("regenerate-plan").hidden=false; F.showToast("Planejamento salvo em Minhas rotinas e no calendário.","info",4500); }
        catch(error) { showError(error.message); }
      });
      host.appendChild(save);
    }
  }

  function showError(message) { const error = el("plan-error"); if (!error) return; error.textContent = message; error.hidden = false; }

  function init() {
    if (F.pageName() !== "treino" || !el("training-plan-preview")) return;
    let preferences = readPreferences();
    renderPreferenceState(preferences);
    document.querySelectorAll("[data-pref]").forEach(button => button.addEventListener("click", () => {
      const key = button.dataset.pref, value = button.dataset.value;
      if (key === "days") preferences[key] = Number(value); else preferences[key] = value;
      renderPreferenceState(preferences);
      try { global.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch (_) {}
    }));
    const existing = readPlan(), badge = el("plan-engine-badge");
    if (existing) { renderPlan(existing,true); el("regenerate-plan").hidden=false; }
    const run = () => {
      const button=el("generate-plan"); button.disabled=true; el("plan-error").hidden=true;
      try {
        preferences=readPreferences();
        const profile=profileForPreferences(preferences);
        const records=compatibleCatalog(profile);
        if (!records.some(record => ["main","abs","finisher"].includes(record.section))) {
          throw new Error("Não encontramos exercícios compatíveis no catálogo com essa disponibilidade. O FORJA só usa exercícios catalogados e não presume acessórios.");
        }
        const proposal=localPlan(profile,readPlan());
        proposal.preferences=Object.assign({},preferences);
        badge.textContent="Gerador local por regras · catálogo FORJA";
        renderPlan(proposal,false);
      } catch(error) { showError(error.message || "Não foi possível gerar um plano."); }
      finally { button.disabled=false; }
    };
    el("generate-plan").addEventListener("click",run);
    el("regenerate-plan").addEventListener("click",run);
  }

  F.plan = { storageKey: PLAN_KEY, preferencesKey:PREFERENCES_KEY, read:readPlan, readPreferences, profileForPreferences, compatibleCatalog, validateModelOutput, generateLocal:localPlan, save:savePlan, trainingDays, estimateSessionMinutes };
  F.pages.treinoPlan = init;
  /* Hub já possui initializer; adicionamos a integração sem substituir a tela. */
  const previousHub = F.pages.treino;
  F.pages.treino = function initTreinoWithPlan() {
    if (typeof previousHub === "function") previousHub();
    init();
  };
})(window);
