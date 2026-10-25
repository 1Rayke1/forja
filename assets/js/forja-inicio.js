/*
  FORJA — página inicial: ação única, semana e continuidade.

  Este módulo substitui o hero duplicado por uma hierarquia curta:
  1) saudação discreta, 2) ação principal única, 3) resumo semanal real,
  4) último treino compacto, 5) calendário/missões como apoio secundário.

  Regras:
  - Uma única ação principal por vez (Iniciar treino real OU Montar meu treino).
  - Nunca exibe "Iniciar" quando não há rotina válida com exercícios.
  - A próxima rotina segue sequência previsível (rotação/histórico), sem avançar
    apenas ao abrir ou recarregar a página.
  - Com sessão ativa, a única via é o banner "Retomar" — a ação da home some.
  - Nunca se esconde visualmente deixando foco/leitores: usa hidden.
  - Resumo semanal e último treino vêm do histórico real via F.metricas; sem dado, estado vazio honesto.
*/
(function (global) {
  "use strict";

  var F = global.Forja;

  function byId(id) { return document.getElementById(id); }

  function hasActiveSession() {
    return Boolean(F.state && F.state.activeWorkout);
  }

  function allRoutines() {
    var routines = F.state && F.state.routines;
    if (!routines) return [];
    var a = Array.isArray(routines.calisthenics) ? routines.calisthenics : [];
    var b = Array.isArray(routines.weights) ? routines.weights : [];
    return a.concat(b);
  }

  function routineExerciseCount(routine) {
    if (!routine || !routine.sections) return 0;
    try {
      return F.countRoutineExercises ? F.countRoutineExercises(routine) : 0;
    } catch (e) {
      return 0;
    }
  }

  function startableRoutines() {
    if (typeof F.getStartableRoutines === "function") {
      return F.getStartableRoutines();
    }
    return allRoutines().filter(function (routine) {
      return routineExerciseCount(routine) > 0;
    });
  }

  function nextRoutine() {
    if (typeof F.resolveNextRoutine === "function") {
      return F.resolveNextRoutine();
    }
    var list = startableRoutines();
    return list.length > 0 ? list[0] : null;
  }

  function formatExerciseCount(routine) {
    var total = routineExerciseCount(routine);
    var sets = 0;
    try {
      sets = F.getRoutineTotalSets ? F.getRoutineTotalSets(routine) : 0;
    } catch (e) { sets = 0; }
    if (total === 0) return "Sem exercícios ainda";
    return total + (total === 1 ? " exercício · " : " exercícios · ") + sets + (sets === 1 ? " série" : " séries");
  }

  function renderAction() {
    var container = byId("home-action");
    if (!container) return;

    // Limpa
    container.innerHTML = "";
    container.hidden = false;
    container.removeAttribute("hidden");

    if (hasActiveSession()) {
      // Com sessão ativa, a home não oferece outro treino; o banner é a única via.
      container.hidden = true;
      container.setAttribute("hidden", "");
      container.innerHTML = "";
      return;
    }

    var startable = startableRoutines();
    var routine = nextRoutine();
    var totalSavedRoutines = allRoutines();
    var pendingEmpty = !routine && totalSavedRoutines.length > 0 ? totalSavedRoutines[0] : null;

    var card = document.createElement("div");
    card.className = "home-action-card" + (routine ? "" : " is-empty");

    var eyebrow = document.createElement("div");
    eyebrow.className = "home-action-eyebrow";
    eyebrow.textContent = routine ? "Próximo treino" : "Comece por aqui";
    card.appendChild(eyebrow);

    var title = document.createElement("h2");
    title.className = "home-action-title";
    title.id = "home-action-heading";
    if (routine) {
      title.textContent = routine.name;
    } else if (pendingEmpty) {
      title.textContent = pendingEmpty.name;
    } else {
      title.textContent = "Monte sua primeira rotina";
    }
    card.appendChild(title);

    var meta = document.createElement("p");
    meta.className = "home-action-meta";
    if (routine) {
      var modeName = (F.MODE_NAMES && F.MODE_NAMES[routine.modality]) || routine.modality;
      meta.textContent = modeName + " · " + formatExerciseCount(routine);
    } else if (pendingEmpty) {
      var pendingMode = (F.MODE_NAMES && F.MODE_NAMES[pendingEmpty.modality]) || pendingEmpty.modality;
      meta.textContent = pendingMode + " · Sem exercícios ainda. Adicione ao menos um exercício para iniciar.";
    } else {
      meta.textContent = "Crie treinos de calistenia ou musculação e comece quando quiser.";
    }
    card.appendChild(meta);

    var button = document.createElement(routine ? "button" : "a");
    button.className = "home-action-button";
    // Compatibilidade: o botão principal mantém também a classe antiga para testes que a procurem, mas só quando existe.
    button.classList.add("treino-square");
    button.id = "home-primary-button";
    if (routine) {
      button.type = "button";
      button.textContent = "Iniciar " + routine.name;
      button.setAttribute("aria-label", "Iniciar treino " + routine.name);
      button.addEventListener("click", function () {
        if (F.startRoutine) F.startRoutine(routine.modality, routine.id);
      });
    } else if (pendingEmpty) {
      button.href = F.url("rotina", { modalidade: pendingEmpty.modality, id: pendingEmpty.id });
      button.textContent = "Adicionar exercícios";
      button.setAttribute("aria-label", "Adicionar exercícios em " + pendingEmpty.name);
    } else {
      button.href = F.url("treino");
      button.textContent = "Montar meu treino";
      button.setAttribute("aria-label", "Montar meu treino");
    }
    card.appendChild(button);

    if (routine) {
      var hint = document.createElement("p");
      hint.className = "home-action-hint";
      var idx = startable.findIndex(function (item) { return item.id === routine.id; });
      hint.textContent = startable.length > 1
        ? "Próxima da sequência (" + (idx + 1) + " de " + startable.length + "). Você pode escolher outra em Treinos."
        : "Sua rotina está pronta. Você pode criar ou escolher outra em Treinos.";
      card.appendChild(hint);
    }

    container.appendChild(card);
  }

  function renderWeek() {
    var statsHost = byId("home-week-stats");
    var note = byId("home-week-note");
    if (!statsHost || !note) return;
    statsHost.innerHTML = "";
    note.textContent = "";

    var history = (F.state && Array.isArray(F.state.history)) ? F.state.history : [];
    var metricas = F.metricas;
    var summary = null;
    var week = null;
    if (metricas && metricas.resolvePeriod && metricas.filterByPeriod && metricas.summarize) {
      try {
        week = metricas.resolvePeriod("week", { now: new Date() });
        var weekRecords = metricas.filterByPeriod(history, week);
        summary = metricas.summarize(weekRecords);
      } catch (e) { summary = null; }
    }
    // Fallback sem metricas: conta manual da semana
    if (!summary) {
      var now = new Date();
      var start = new Date(now); start.setDate(now.getDate() - ((now.getDay()+6)%7)); start.setHours(0,0,0,0);
      var end = new Date(start); end.setDate(start.getDate()+6); end.setHours(23,59,59,999);
      var filtered = history.filter(function (r) {
        if (!r || !r.date) return false;
        var d = new Date(r.finishedAt || r.date);
        return !isNaN(d) && d >= start && d <= end;
      });
      var totalSets = filtered.reduce(function (s, r) { return s + (Number(r.completedSets)||0); }, 0);
      var totalMs = filtered.reduce(function (s, r) { return s + (Number(r.durationMs)||0); }, 0);
      summary = { sessions: filtered.length, sets: totalSets, minutes: Math.round(totalMs/60000), hasVolume: false, setsWithoutVolume: 0 };
      week = { label: "" };
    }

    var items = [
      { value: String(summary.sessions), label: "treinos" },
      { value: String(summary.sets), label: "séries" },
      { value: summary.minutes ? (summary.minutes + " min") : "0 min", label: "tempo" }
    ];

    items.forEach(function (item) {
      var card = document.createElement("div");
      card.className = "home-week-stat";
      card.setAttribute("role", "listitem");
      var v = document.createElement("div");
      v.className = "home-week-stat-value";
      v.textContent = item.value;
      var l = document.createElement("div");
      l.className = "home-week-stat-label";
      l.textContent = item.label;
      card.appendChild(v);
      card.appendChild(l);
      statsHost.appendChild(card);
    });
    statsHost.setAttribute("role", "list");

    if (summary.sessions === 0) {
      note.textContent = "Sem treinos nesta semana ainda. Quando registrar um, ele aparece aqui.";
    } else {
      var weekLabel = week && week.label ? week.label : "esta semana";
      note.textContent = summary.sessions + (summary.sessions===1 ? " treino" : " treinos") + " em " + weekLabel + ".";
      if (summary.setsWithoutVolume > 0) {
        note.textContent += " " + summary.setsWithoutVolume + " série(s) ficaram fora do volume por falta de carga numérica.";
      }
    }
  }

  /* Mesma regra e mesmo texto do Progresso (F.formatGoalRemaining). */
  function formatGoalRemaining(item) {
    if (typeof F.formatGoalRemaining === "function") return F.formatGoalRemaining(item);
    return "Faltam " + Math.max(0, Math.round(Number(item && item.remaining) || 0));
  }

  function formatGoalNote(item) {
    if (item && item.met) return "Meta atingida";
    var current = Number(item && item.current) || 0;
    if (current === 0) return "Ainda sem progresso";
    return formatGoalRemaining(item);
  }

  function renderGoals() {
    var host = byId("home-goals-content");
    var periodNote = byId("home-goals-period");
    if (!host || !periodNote) return;
    host.innerHTML = "";
    periodNote.textContent = "";

    var metricas = F.metricas;
    if (!metricas || typeof metricas.goalProgress !== "function") {
      var unavailable = document.createElement("p");
      unavailable.className = "home-goals-note";
      unavailable.textContent = "Não foi possível consultar suas metas agora.";
      host.appendChild(unavailable);
      return;
    }

    var progress;
    try {
      progress = metricas.goalProgress(
        F.state && Array.isArray(F.state.history) ? F.state.history : [],
        F.state ? F.state.goals : null,
        { now: new Date() }
      );
    } catch (error) {
      var failed = document.createElement("p");
      failed.className = "home-goals-note";
      failed.textContent = "Não foi possível consultar suas metas agora.";
      host.appendChild(failed);
      return;
    }

    var periodParts = [];
    if (progress && progress.week && progress.week.from && progress.week.to && metricas.formatDayMonth) {
      periodParts.push(
        "Semana de " + metricas.formatDayMonth(progress.week.from) +
        " a " + metricas.formatDayMonth(progress.week.to)
      );
    }
    if (progress && progress.modality && progress.modality !== "all") {
      var modeLabel = (F.MODE_NAMES && F.MODE_NAMES[progress.modality]) || progress.modality;
      periodParts.push(modeLabel);
    }
    if (periodParts.length > 0) {
      periodNote.textContent = periodParts.join(" · ") + ".";
    }

    var items = progress && Array.isArray(progress.items) ? progress.items.filter(function (item) {
      return item && item.active;
    }) : [];
    if (!progress || !progress.active || items.length === 0) {
      var empty = document.createElement("p");
      empty.className = "home-goals-note";
      empty.textContent = "Você ainda não configurou metas semanais. Defina seus objetivos em Progresso.";
      host.appendChild(empty);
      return;
    }

    if (!F.charts || typeof F.charts.ring !== "function") {
      var noChart = document.createElement("p");
      noChart.className = "home-goals-note";
      noChart.textContent = "Suas metas estão configuradas. Consulte o progresso para ver os detalhes.";
      host.appendChild(noChart);
      return;
    }

    var grid = document.createElement("div");
    grid.className = "home-goals-grid";
    grid.setAttribute("role", "list");
    items.forEach(function (item) {
      var current = Number(item.current) || 0;
      var target = Number(item.target) || 0;
      var ring = F.charts.ring({
        percent: Math.max(0, Math.min(100, Number(item.percent) || 0)),
        label: item.label,
        valueText: current + "/" + target,
        note: formatGoalNote(item)
      });
      ring.setAttribute("role", "listitem");
      ring.classList.add("home-goals-ring");
      grid.appendChild(ring);
    });
    host.appendChild(grid);
  }

  function formatRecordDate(record) {
    if (F.metricas && F.metricas.formatRecordDate) {
      try { return F.metricas.formatRecordDate(record); } catch(e) {}
    }
    if (record.finishedAt) {
      try { return new Date(record.finishedAt).toLocaleDateString("pt-BR"); } catch(e) {}
    }
    return record.date || "";
  }

  function renderRecent() {
    var list = byId("home-recent-list");
    var note = byId("home-recent-note");
    if (!list || !note) return;
    list.innerHTML = "";
    note.textContent = "";

    var history = (F.state && Array.isArray(F.state.history))
      ? F.state.history.filter(function (item) { return F.isPlainObject ? F.isPlainObject(item) : Boolean(item && typeof item === "object"); })
      : [];
    if (history.length === 0) {
      note.textContent = "Nenhum treino registrado ainda. Conclua um treino e ele aparecerá aqui.";
      return;
    }

    var recent = history.slice(0, 3);
    recent.forEach(function (record) {
      var item = document.createElement("div");
      item.className = "home-recent-item";
      var name = document.createElement("div");
      name.className = "home-recent-name";
      name.textContent = record.routineName || "Treino";
      var meta = document.createElement("div");
      meta.className = "home-recent-meta";
      var mode = (F.MODE_NAMES && F.MODE_NAMES[record.modality]) ? F.MODE_NAMES[record.modality] : record.modality;
      var status = record.status === "completed" ? "Concluído" : "Parcial";
      meta.textContent = formatRecordDate(record) + " · " + mode + " · " + status + " · " + (Number(record.completedSets)||0) + "/" + (Number(record.totalPlannedSets)||0) + " séries";
      item.appendChild(name);
      item.appendChild(meta);
      list.appendChild(item);
    });

    if (history.length > 3) {
      note.textContent = history.length + " treinos no histórico. Veja todos em Progresso.";
    }
  }

  function renderGreeting() {
    var title = byId("home-title");
    var subtitle = byId("home-subtitle");
    if (!title || !subtitle) return;
    var routines = allRoutines();
    var startable = startableRoutines();
    var history = (F.state && Array.isArray(F.state.history)) ? F.state.history : [];
    if (hasActiveSession()) {
      title.textContent = "Treino em andamento";
      subtitle.textContent = "Retome pelo aviso acima. Bom treino!";
      return;
    }
    if (routines.length === 0 && history.length === 0) {
      title.textContent = "Bem-vindo à FORJA.";
      subtitle.textContent = "Crie sua primeira rotina e faça seu primeiro treino. Tudo fica neste aparelho.";
      return;
    }
    if (routines.length === 0) {
      title.textContent = "Hora de montar.";
      subtitle.textContent = "Você já treinou antes, mas não há rotinas salvas agora.";
      return;
    }
    if (startable.length === 0) {
      title.textContent = "Hora de montar.";
      subtitle.textContent = "Adicione exercícios à sua rotina para liberar o início do treino.";
      return;
    }
    title.textContent = "Hora de treinar.";
    subtitle.textContent = "Sua próxima rotina está pronta. Um toque para começar.";
  }

  function renderHome() {
    if (typeof global.renderCalendar === "function") global.renderCalendar();
    if (typeof global.renderMissions === "function") global.renderMissions();
    renderGreeting();
    renderAction();
    renderWeek();
    renderGoals();
    renderRecent();
  }

  /* ------------------------------------------------------------------ */
  /* Onboarding opcional (usuário realmente novo)                        */
  /* ------------------------------------------------------------------ */
  /*
    Regras:
    - Só aparece para quem não tem rotinas, nem histórico e nem perfil salvo.
    - "Pular" dispensa o cartão nesta visita sem criar nem persistir nenhum dado.
    - A gravação do perfil só acontece no confirm explícito ("Salvar perfil").
    - O perfil continua configurável a qualquer momento em Perfil.
  */
  let onboardingDismissed = false;

  function profileIsConfigured() {
    return Boolean(F.state.profile && F.state.profile.updatedAt);
  }

  function isNewUser() {
    const routines = allRoutines();
    const history = (F.state && Array.isArray(F.state.history)) ? F.state.history : [];
    return routines.length === 0 && history.length === 0 && !profileIsConfigured();
  }

  function buildSelectField(name, labelText, options, value, extraClass) {
    const block = document.createElement("div");
    block.className = "field-block" + (extraClass ? " " + extraClass : "");

    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = labelText;

    const select = document.createElement("select");
    select.id = "onb-" + name;
    select.className = "field-input";
    options.forEach(option => {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      if (String(option.value) === String(value || "")) item.selected = true;
      select.appendChild(item);
    });

    label.htmlFor = select.id;
    block.append(label, select);
    return { block, select };
  }

  function buildNumberField(name, labelText, value, min, max, step) {
    const block = document.createElement("div");
    block.className = "field-block";

    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = "number";
    input.id = "onb-" + name;
    input.className = "field-input";
    input.value = String(value || 0);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.inputMode = "numeric";
    input.autocomplete = "off";

    label.htmlFor = input.id;
    block.append(label, input);
    return { block, input };
  }

  function readOnboardingValues(fields) {
    return {
      objetivo: fields.objetivo.select.value,
      nivel: fields.nivel.select.value,
      equipamento: fields.equipamento.select.value,
      diasPorSemana: fields.dias.input.value === ""
        ? 0
        : Number(fields.dias.input.value),
      duracaoMinutos: fields.duracao.input.value === ""
        ? 0
        : Number(fields.duracao.input.value)
    };
  }

  function validateOnboarding(fields) {
    const errors = [];
    const diasRaw = String(fields.dias.input.value || "").trim();
    const duracaoRaw = String(fields.duracao.input.value || "").trim();

    if (diasRaw !== "" && !/^\d+$/.test(diasRaw)) {
      errors.push("Use um número inteiro de dias (0 a 7).");
    } else if (diasRaw !== "" && Number(diasRaw) > F.PERFIL_MAX_DIAS) {
      errors.push("Use até " + F.PERFIL_MAX_DIAS + " dias por semana.");
    }

    if (duracaoRaw !== "" && !/^\d+$/.test(duracaoRaw)) {
      errors.push("Use um número inteiro de minutos.");
    } else if (duracaoRaw !== "" && Number(duracaoRaw) > F.PERFIL_MAX_MINUTOS) {
      errors.push("Use até " + F.PERFIL_MAX_MINUTOS + " minutos.");
    }

    return errors;
  }

  function renderOnboarding(container) {
    container.innerHTML = "";
    container.hidden = false;

    const profile = F.state.profile || {};
    const card = document.createElement("section");
    card.className = "onboarding-panel";
    card.setAttribute("aria-labelledby", "home-onboarding-heading");

    const head = document.createElement("div");
    head.className = "onboarding-head";

    const headRow = document.createElement("div");
    headRow.className = "onboarding-head-row";

    const title = document.createElement("h2");
    title.className = "onboarding-title";
    title.id = "home-onboarding-heading";
    title.textContent = "Seu perfil de treino";
    headRow.appendChild(title);

    const eyebrow = document.createElement("span");
    eyebrow.className = "onboarding-eyebrow";
    eyebrow.textContent = "Opcional";
    headRow.appendChild(eyebrow);

    head.appendChild(headRow);

    const description = document.createElement("p");
    description.className = "onboarding-meta";
    description.appendChild(document.createTextNode("Pule agora ou configure depois em "));
    const profileLink = document.createElement("a");
    profileLink.className = "onboarding-profile-link";
    profileLink.href = F.url ? F.url("perfil") : "perfil/index.html";
    profileLink.textContent = "Perfil";
    description.appendChild(profileLink);
    description.appendChild(document.createTextNode(". Não bloqueia rotinas manuais."));
    head.appendChild(description);

    card.appendChild(head);

    const form = document.createElement("form");
    form.className = "onboarding-form";
    form.noValidate = true;
    form.addEventListener("submit", event => event.preventDefault());

    const fields = {
      objetivo: buildSelectField("objetivo", "Objetivo", F.PERFIL_OPTIONS.objetivo, profile.objetivo, "onboarding-col-half"),
      nivel: buildSelectField("nivel", "Nível", F.PERFIL_OPTIONS.nivel, profile.nivel, "onboarding-col-half"),
      equipamento: buildSelectField("equipamento", "Equipamento", F.PERFIL_OPTIONS.equipamento, profile.equipamento, "onboarding-col-equip"),
      dias: buildNumberField("dias", "Dias/sem.", profile.diasPorSemana, 0, F.PERFIL_MAX_DIAS, 1),
      duracao: buildNumberField("duracao", "Duração (min)", profile.duracaoMinutos, 0, F.PERFIL_MAX_MINUTOS, 5)
    };
    fields.dias.block.classList.add("onboarding-col-days");
    fields.duracao.block.classList.add("onboarding-col-duration");

    const fieldBox = document.createElement("div");
    fieldBox.className = "onboarding-fields";
    fieldBox.append(fields.objetivo.block, fields.nivel.block, fields.equipamento.block, fields.dias.block, fields.duracao.block);
    form.appendChild(fieldBox);

    const hint = document.createElement("p");
    hint.className = "field-hint";
    hint.textContent = "Zero ou vazio desliga o item. Não altera treinos nem histórico.";
    form.appendChild(hint);

    const error = document.createElement("p");
    error.className = "field-error";
    error.setAttribute("role", "status");
    error.hidden = true;
    form.appendChild(error);

    card.appendChild(form);

    const actions = document.createElement("div");
    actions.className = "onboarding-actions";

    const pular = document.createElement("button");
    pular.type = "button";
    pular.className = "secondary-button";
    pular.id = "onboarding-skip";
    pular.textContent = "Pular";

    const salvar = document.createElement("button");
    salvar.type = "button";
    salvar.className = "primary-button";
    salvar.id = "onboarding-save";
    salvar.textContent = "Salvar perfil";

    actions.append(pular, salvar);
    card.appendChild(actions);

    container.appendChild(card);

    function hide() {
      container.hidden = true;
      container.innerHTML = "";
    }

    function focusFirstInvalid(errors) {
      if (errors.length === 0) return;
      const message = errors[0];
      if (message.indexOf("dias") !== -1) fields.dias.input.focus();
      else fields.duracao.input.focus();
    }

    pular.addEventListener("click", () => {
      onboardingDismissed = true;
      hide();
      F.showToast("Você pode configurar seu perfil depois, em Perfil.", "info", 4500);
    });

    salvar.addEventListener("click", () => {
      const values = readOnboardingValues(fields);
      const errors = validateOnboarding(fields);

      if (errors.length > 0) {
        error.textContent = errors[0];
        error.hidden = false;
        focusFirstInvalid(errors);
        return;
      }

      error.hidden = true;

      if (!F.saveProfile(values)) {
        error.textContent = "Não foi possível salvar o perfil. Os dados já salvos foram mantidos.";
        error.hidden = false;
        F.showToast("Não foi possível salvar o perfil neste navegador.", "error", 6000);
        return;
      }

      hide();
      F.showToast("Perfil de treino salvo.", "info", 4000);
      renderHome();
    });
  }

  function syncOnboardingVisibility() {
    const container = byId("onboarding-root");
    if (!container) return;

    if (!isNewUser() || onboardingDismissed) {
      container.hidden = true;
      container.innerHTML = "";
      return;
    }

    if (!container.querySelector(".onboarding-panel")) {
      renderOnboarding(container);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sincronização externa (outras abas e restauração via BFCache)       */
  /* ------------------------------------------------------------------ */

  var lastHomeSignature = "";
  var lastHomeDayKey = "";

  function isHomeActive() {
    return Boolean(byId("home-action") || byId("home-goals-content"));
  }

  function homeStorageSignature() {
    if (!F.store || typeof F.store.readRaw !== "function") return "";
    var keys = F.KEYS
      ? [
          F.KEYS.legacyExercises,
          F.KEYS.routines,
          F.KEYS.history,
          F.KEYS.goals,
          F.KEYS.rotation,
          F.KEYS.profile,
          F.KEYS.active
        ]
      : [];
    var parts = keys.map(function (key) {
      var raw = F.store.readRaw(key);
      return key + "=" + (raw === null ? "" : raw);
    });
    if (typeof F.store.keys === "function" && F.MISSION_KEY_PATTERN) {
      F.store.keys().forEach(function (key) {
        if (F.MISSION_KEY_PATTERN.test(key)) {
          var raw = F.store.readRaw(key);
          parts.push(key + "=" + (raw === null ? "" : raw));
        }
      });
    }
    return parts.join("\n");
  }

  function refreshHomeSnapshotMeta() {
    lastHomeSignature = homeStorageSignature();
    lastHomeDayKey = F.dateKey ? F.dateKey(new Date()) : "";
  }

  function applyKeyUpdateToHome(key, options) {
    if (!isHomeActive()) return;
    var syncMemory = Boolean(options && options.syncMemory);

    if (key === null || key === undefined) {
      if (syncMemory && typeof F.syncStateFromStorage === "function") {
        F.syncStateFromStorage(null);
      }
      if (typeof global.updateTodayLabel === "function") global.updateTodayLabel();
      if (typeof F.updateActiveBanner === "function") F.updateActiveBanner();
      renderHome();
      syncOnboardingVisibility();
      refreshHomeSnapshotMeta();
      return;
    }

    if (F.MISSION_KEY_PATTERN && F.MISSION_KEY_PATTERN.test(key)) {
      if (typeof global.renderCalendar === "function") global.renderCalendar();
      if (typeof global.renderMissions === "function") global.renderMissions();
      refreshHomeSnapshotMeta();
      return;
    }

    if (!F.KEYS) return;

    if (key === F.KEYS.goals) {
      if (syncMemory && typeof F.syncStateFromStorage === "function") {
        F.syncStateFromStorage(key);
      }
      renderGoals();
      refreshHomeSnapshotMeta();
      return;
    }

    if (key === F.KEYS.rotation) {
      if (syncMemory && typeof F.syncStateFromStorage === "function") {
        F.syncStateFromStorage(key);
      }
      renderGreeting();
      renderAction();
      refreshHomeSnapshotMeta();
      return;
    }

    if (key === F.KEYS.routines || key === F.KEYS.legacyExercises) {
      if (syncMemory && typeof F.syncStateFromStorage === "function") {
        F.syncStateFromStorage(key);
      }
      if (typeof F.updateActiveBanner === "function") F.updateActiveBanner();
      renderGreeting();
      renderAction();
      syncOnboardingVisibility();
      refreshHomeSnapshotMeta();
      return;
    }

    if (key === F.KEYS.history) {
      if (syncMemory && typeof F.syncStateFromStorage === "function") {
        F.syncStateFromStorage(key);
      }
      renderGreeting();
      renderAction();
      renderWeek();
      renderGoals();
      renderRecent();
      syncOnboardingVisibility();
      refreshHomeSnapshotMeta();
      return;
    }

    if (key === F.KEYS.active) {
      if (syncMemory && typeof F.syncStateFromStorage === "function") {
        F.syncStateFromStorage(key);
      }
      if (typeof F.updateActiveBanner === "function") F.updateActiveBanner();
      renderGreeting();
      renderAction();
      refreshHomeSnapshotMeta();
      return;
    }

    if (key === F.KEYS.profile) {
      if (syncMemory && typeof F.syncStateFromStorage === "function") {
        F.syncStateFromStorage(key);
      }
      syncOnboardingVisibility();
      refreshHomeSnapshotMeta();
    }
  }

  F.pages.inicio = function initInicio() {
    if (typeof global.updateTodayLabel === "function") global.updateTodayLabel();
    renderHome();
    syncOnboardingVisibility();
    refreshHomeSnapshotMeta();
  };

  F.onDataChanged(function () {
    if (!isHomeActive()) return;
    renderHome();
    syncOnboardingVisibility();
    refreshHomeSnapshotMeta();
  });

  if (F.store && typeof F.store.onChange === "function") {
    F.store.onChange(function (key) {
      if (!key || !isHomeActive()) return;
      applyKeyUpdateToHome(key, { syncMemory: true });
    });
  }

  global.addEventListener("storage", function (event) {
    if (!event || !isHomeActive()) return;
    applyKeyUpdateToHome(event.key, { syncMemory: true });
  });

  global.addEventListener("pageshow", function (event) {
    if (!isHomeActive()) return;
    var currentSig = homeStorageSignature();
    var currentDay = F.dateKey ? F.dateKey(new Date()) : "";
    var persisted = Boolean(event && event.persisted);
    var changed = currentSig !== lastHomeSignature || currentDay !== lastHomeDayKey;

    if (!persisted && !changed) return;

    if (changed && typeof F.syncStateFromStorage === "function") {
      F.syncStateFromStorage(null);
    }
    if (typeof global.updateTodayLabel === "function") global.updateTodayLabel();
    if (typeof F.updateActiveBanner === "function") F.updateActiveBanner();
    renderHome();
    syncOnboardingVisibility();
    lastHomeSignature = currentSig;
    lastHomeDayKey = currentDay;
  });

  // Exposto para testes
  F.home = {
    renderAction: renderAction,
    renderWeek: renderWeek,
    renderGoals: renderGoals,
    renderRecent: renderRecent,
    renderGreeting: renderGreeting,
    nextRoutine: nextRoutine,
    startableRoutines: startableRoutines
  };
})(window);
