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
    const equipment = safeArray(record.equipment).map(item => String(item).toLowerCase());
    if (!equipment.length || equipment.includes("peso corporal")) return true;
    const detail = safeArray(profile.equipamentos);
    const legacy = profile.equipamento;
    if (detail.includes("nenhum") || legacy === "nenhum") return false;
    if (detail.includes("academiaCompleta") || legacy === "academia" || legacy === "ambos") return true;
    const aliases = {
      halteres: ["halteres"], barraAnilhas: ["barra", "anilhas", "rack", "banco"],
      elasticos: ["elástico", "elasticos"], maquinas: ["máquina", "maquinas", "polia", "leg press", "cadeira", "mesa", "esteira", "bicicleta"],
      outros: []
    };
    const allowed = detail.flatMap(key => aliases[key] || []);
    if (legacy === "casa") allowed.push("halteres", "elástico", "elasticos");
    return equipment.every(item => allowed.some(token => item.includes(token)));
  }

  function compatibleCatalog(profile) {
    const modes = supportedModes(profile);
    let records = modes.flatMap(mode => F.catalog.items(mode));
    records = records.filter(record => equipmentAllowed(record, profile));
    const prefs = safeArray(profile.preferenciasTreino);
    if (prefs.includes("cardio") && !prefs.includes("musculacao") && !prefs.includes("calistenia")) {
      records = records.filter(record => record.category === "cardio" || record.category === "mobility");
    }
    if (safeArray(profile.consideracoes).includes("baixoImpacto")) {
      records = records.filter(record => record.category !== "cardio" ||
        !/burpee|polichinelo|salto|jump/i.test(record.name));
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

  function selectSessionRecords(records, profile, sessionIndex, feedback, signals) {
    const target = focusCategories(profile);
    const avoidHighVolume = ["iniciante", "retornando", ""].includes(profile.nivel) ||
      ["comecando", "basicos"].includes(profile.experienciaAtual) ||
      safeArray(profile.consideracoes).includes("adaptarNivel");
    const maxExercises = avoidHighVolume ? 4 : 5;
    const ordered = records.filter(item => item.section === "main" && item.category !== "mobility");
    const affinity = record => target.includes(record.category) ? 0 : 1;
    ordered.sort((a, b) => {
      const aId = a.libraryId || a.id, bId = b.libraryId || b.id;
      const aUse = signals && signals.recentExerciseCounts[aId] || 0;
      const bUse = signals && signals.recentExerciseCounts[bId] || 0;
      return affinity(a) - affinity(b) || aUse - bUse || a.name.localeCompare(b.name, "pt-BR");
    });
    const picked = [];
    const categories = new Set();
    const rotate = sessionIndex % Math.max(ordered.length, 1);
    const candidates = ordered.slice(rotate).concat(ordered.slice(0, rotate));
    candidates.forEach(record => {
      if (picked.length >= maxExercises) return;
      if (picked.some(item => item.libraryId === record.libraryId)) return;
      const preferCategory = target.includes(record.category);
      if (!preferCategory && categories.size < 3) return;
      if (categories.has(record.category) && picked.length < 3) return;
      picked.push(record);
      categories.add(record.category);
    });
    if (picked.length < Math.min(3, maxExercises)) {
      candidates.forEach(record => {
        if (picked.length < Math.min(3, maxExercises) && !picked.some(item => item.libraryId === record.libraryId)) picked.push(record);
      });
    }
    const warmup = records.find(item => item.section === "warmup" && item.category !== "cardio") || null;
    const abs = records.find(item => item.section === "abs") || null;
    const combined = (warmup ? [warmup] : []).concat(picked, abs ? [abs] : []);
    const easy = avoidHighVolume || feedback === "muito-dificil" || Boolean(signals && signals.highEffort);
    const targetSets = feedback === "facil" && !avoidHighVolume && !(signals && signals.highEffort) ? 3 : (easy ? 2 : 3);
    return combined.map(record => {
      const hold = record.type === "duration";
      const sets = Math.max(2, Math.min(record.sets || 3, targetSets));
      const clone = F.catalog.toExercise(record, record.section);
      if (!clone) return null;
      clone.catalogId = record.libraryId || record.id;
      clone.muscles = safeArray(record.muscles).slice();
      clone.equipment = safeArray(record.equipment).slice();
      clone.instructions = cleanString(record.instructions, 600);
      clone.sets = sets;
      clone.rest = Math.max(record.rest || 45, easy ? 60 : 45);
      if (hold) clone.duration = Math.min(record.duration || 30, easy ? 30 : 45);
      else clone.reps = easy ? "8–10" : (profile.objetivo === "forca" ? "6–8" : "8–12");
      const alternative = records.find(other => other.category === record.category && other.libraryId !== record.libraryId);
      clone.notes = [cleanString(record.instructions, 180), alternative ? "Alternativa compatível: " + cleanString(alternative.name, 90) : ""].filter(Boolean).join(" ");
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

  function localPlan(profile, previous) {
    const count = Math.min(6, Math.max(1, Number(profile.diasPorSemana) || 3));
    const records = compatibleCatalog(profile);
    const signals = trainingSignals(records);
    const existingFeedback = previous && previous.feedback ? previous.feedback : {};
    const sessions = [];
    for (let index = 0; index < count; index += 1) {
      const dayRecords = selectSessionRecords(records, profile, index, existingFeedback["session-" + index], signals);
      if (!dayRecords.length) throw new Error("Não há exercícios compatíveis disponíveis no catálogo para este perfil.");
      const slot = [0, 2, 4, 1, 3, 5][index % 6];
      sessions.push({
        id: "session-" + index,
        day: DAYS[slot],
        title: ["Treino A", "Treino B", "Treino C"][index % 3],
        rationale: "Sessão de corpo inteiro com exercícios disponíveis e foco em recuperação entre dias.",
        exercises: dayRecords,
        scheduleDate: null
      });
    }
    return {
      version: 1,
      id: previous && previous.id || "plan-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      engine: "rules",
      createdAt: new Date().toISOString(),
      summary: rationale(profile, count, signals),
      weeklyDays: count,
      sessions,
      feedback: existingFeedback
    };
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

  /*
    Modalidade de um exercício do plano.

    A fonte é o catálogo (`record.mode`): o exercício normalizado não tem campo
    `mode` — `normalizeExercise` só devolve o que uma rotina guarda, e o vínculo
    com o item de origem fica em `libraryId` (também copiado para `catalogId`
    no plano). Ler `exercise.mode`, como era feito antes, avaliava `undefined`
    em todos os exercícios e salvava qualquer plano como calistenia.
  */
  function catalogModes() {
    const index = new Map();

    F.catalog.items().forEach(record => {
      if (!F.MODE_NAMES[record.mode]) return;
      [record.libraryId, record.id].forEach(key => {
        if (typeof key === "string" && key && !index.has(key)) index.set(key, record.mode);
      });
    });

    return index;
  }

  /*
    Modalidade da sessão: uma sessão é de musculação quando algum exercício
    vem do catálogo de musculação; sem exercício de carga (ou sem vínculo
    conhecido com o catálogo) a sessão é de calistenia. O critério é o mesmo de
    antes — só passa a usar a modalidade real de cada exercício.
  */
  function sessionModality(session, modes) {
    const index = modes || catalogModes();

    return safeArray(session && session.exercises).some(exercise =>
      index.get(exercise && (exercise.catalogId || exercise.libraryId)) === "weights")
      ? "weights"
      : "calisthenics";
  }

  function routinesForPlan(plan) {
    const state = F.state.routines;
    const next = { calisthenics: state.calisthenics.slice(), weights: state.weights.slice() };
    const modes = catalogModes();
    plan.sessions.forEach((session, index) => {
      const mode = sessionModality(session, modes);
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

  function renderPlan(plan, saved) {
    const host = el("training-plan-preview"); if (!host) return;
    host.replaceChildren();
    if (!plan) { host.appendChild(text("p", "field-hint", "Nenhum plano salvo. Gere uma prévia para revisar as sessões.")); return; }
    const header = document.createElement("div"); header.className = "plan-summary";
    header.append(text("p", "plan-summary-text", plan.summary));
    header.append(text("p", "field-hint", saved ? "Plano salvo · sessões também aparecem no calendário e em Minhas rotinas." : "Prévia não salva. Confira os exercícios antes de aplicar."));
    host.appendChild(header);
    plan.sessions.forEach(session => {
      const card = document.createElement("article"); card.className = "plan-session-card";
      const head = document.createElement("div"); head.className = "plan-session-head";
      head.append(text("div", "plan-session-day", session.day + (session.scheduleDate ? " · " + session.scheduleDate : "")));
      head.append(text("h3", "plan-session-title", session.title));
      card.appendChild(head);
      card.appendChild(text("p", "plan-rationale", session.rationale));
      const list = document.createElement("ul"); list.className = "plan-exercise-list";
      session.exercises.forEach(exercise => {
        const item = document.createElement("li");
        const details = exercise.type === "duration" ? (exercise.duration + " s") : (exercise.reps + " repetições");
        const muscles = safeArray(exercise.muscles).length ? safeArray(exercise.muscles).join(", ") : "grupos não classificados";
        item.appendChild(text("strong", "", exercise.name));
        item.appendChild(text("span", "", exercise.sets + " séries · " + details + " · descanso " + exercise.rest + " s · " + muscles));
        if (exercise.notes) item.appendChild(text("small", "", exercise.notes));
        list.appendChild(item);
      });
      card.appendChild(list);
      if (saved) {
        const actions = document.createElement("div"); actions.className = "plan-session-actions";
        const start = document.createElement("button"); start.type = "button"; start.className = "primary-button"; start.textContent = "Iniciar sessão";
        start.addEventListener("click", () => {
          const routineId = "forja-plan-session-" + plan.id + "-" + plan.sessions.indexOf(session);
          /* A rotina salva é a fonte da modalidade: é ela que foi gravada em
             "Minhas rotinas". Sem ela no estado, deriva do catálogo. */
          const saved = F.getRoutineById(routineId);
          const mode = saved ? saved.modality : sessionModality(session);
          F.startRoutine(mode, routineId);
        });
        const rating = document.createElement("select"); rating.className = "field-input plan-feedback"; rating.setAttribute("aria-label", "Dificuldade desta sessão para ajustes futuros");
        [["", "Dificuldade"], ["facil", "Fácil"], ["adequado", "Adequado"], ["muito-dificil", "Muito difícil"]].forEach(([value, label]) => {
          const option = document.createElement("option"); option.value = value; option.textContent = label; rating.appendChild(option);
        });
        rating.value = plan.feedback && plan.feedback[session.id] || "";
        rating.addEventListener("change", () => {
          if (!rating.value) return;
          const latest = readPlan(); if (!latest) return;
          latest.feedback = Object.assign({}, latest.feedback, { [session.id]: rating.value, updatedAt: new Date().toISOString() });
          writePlan(latest);
          F.showToast("Feedback salvo. Será considerado em ajustes futuros, sem alterar seu histórico.", "info", 4500);
        });
        actions.append(start, rating); card.appendChild(actions);
      }
      host.appendChild(card);
    });
    if (!saved) {
      const save = document.createElement("button"); save.type = "button"; save.className = "primary-button plan-save"; save.textContent = "Salvar plano e adicionar ao calendário";
      save.addEventListener("click", () => {
        try {
          const stored = savePlan(plan);
          renderPlan(stored, true);
          el("regenerate-plan").hidden = false;
          F.showToast("Plano salvo. Sessões adicionadas às rotinas e ao calendário.", "info", 4500);
        } catch (error) { showError(error.message); }
      });
      host.appendChild(save);
    }
  }

  function showError(message) { const error = el("plan-error"); if (!error) return; error.textContent = message; error.hidden = false; }

  function init() {
    if (F.pageName() !== "treino" || !el("training-plan-preview")) return;
    const existing = readPlan();
    const badge = el("plan-engine-badge");
    if (existing) {
      badge.textContent = existing.engine === "ai" ? "Gerado por IA" : "Gerador local por regras";
      renderPlan(existing, true);
      el("regenerate-plan").hidden = false;
    } else renderPlan(null, false);
    const run = async () => {
      const button = el("generate-plan"); button.disabled = true; el("plan-error").hidden = true;
      const profile = F.state.profile || {};
      const records = compatibleCatalog(profile);
      try {
        let plan;
        try {
          plan = await requestAI(profile, records, readPlan());
          badge.textContent = "IA via serviço seguro";
        } catch (apiError) {
          plan = localPlan(profile, readPlan());
          badge.textContent = "Gerador local por regras";
          if (apiError && apiError.message) el("plan-intro").textContent = "Serviço de IA indisponível; prévia criada localmente por regras, sem chamada simulada. " + apiError.message;
        }
        renderPlan(plan, false);
      } catch (error) { showError(error.message || "Não foi possível gerar o plano."); }
      finally { button.disabled = false; }
    };
    el("generate-plan").addEventListener("click", run);
    el("regenerate-plan").addEventListener("click", run);
  }

  F.plan = { storageKey: PLAN_KEY, read: readPlan, compatibleCatalog, validateModelOutput, generateLocal: localPlan, save: savePlan };
  F.pages.treinoPlan = init;
  /* Hub já possui initializer; adicionamos a integração sem substituir a tela. */
  const previousHub = F.pages.treino;
  F.pages.treino = function initTreinoWithPlan() {
    if (typeof previousHub === "function") previousHub();
    init();
  };
})(window);
