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
    eyebrow.id = "home-action-heading";
    eyebrow.textContent = routine ? "Próximo treino" : "Comece por aqui";
    card.appendChild(eyebrow);

    var title = document.createElement("h2");
    title.className = "home-action-title";
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

    var history = (F.state && Array.isArray(F.state.history)) ? F.state.history : [];
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
    renderRecent();
  }

  global.addEventListener("storage", function (event) {
    if (!F.KEYS) return;
    if (event.key !== null && event.key !== F.KEYS.rotation) return;
    if (typeof F.loadRotation === "function") {
      F.state.rotation = F.loadRotation();
    }
    if (byId("home-action")) {
      renderGreeting();
      renderAction();
    }
  });

  F.pages.inicio = function initInicio() {
    if (typeof global.updateTodayLabel === "function") global.updateTodayLabel();
    renderHome();
  };

  F.onDataChanged(renderHome);

  // Exposto para testes
  F.home = {
    renderAction: renderAction,
    renderWeek: renderWeek,
    renderRecent: renderRecent,
    renderGreeting: renderGreeting,
    nextRoutine: nextRoutine,
    startableRoutines: startableRoutines
  };
})(window);
