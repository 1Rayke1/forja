/*
  FORJA — página inicial: ação única, semana e continuidade.

  Este módulo substitui o hero duplicado por uma hierarquia curta:
  1) saudação discreta, 2) ação principal única, 3) resumo semanal real,
  4) último treino compacto, 5) calendário/missões como apoio secundário.

  Regras:
  - Uma única ação principal por vez (Iniciar treino real OU Montar meu treino).
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

  function mostRecentRoutine() {
    var list = allRoutines();
    if (list.length === 0) return null;
    var best = list[0];
    for (var i = 1; i < list.length; i++) {
      var cur = list[i];
      var curTime = Number(cur.updatedAt || cur.createdAt || 0);
      var bestTime = Number(best.updatedAt || best.createdAt || 0);
      if (curTime > bestTime) best = cur;
    }
    return best;
  }

  function routineHref(routine) {
    if (!routine) return F.url("treino");
    // Iniciar direto chama F.startRoutine, não precisa de href, mas deixamos link para o editor como fallback sem JS.
    return F.url("rotina", { modalidade: routine.modality, id: routine.id });
  }

  function formatExerciseCount(routine) {
    if (!routine || !routine.sections) return "";
    var total = 0;
    var sets = 0;
    try {
      total = F.countRoutineExercises ? F.countRoutineExercises(routine) : 0;
      sets = F.getRoutineTotalSets ? F.getRoutineTotalSets(routine) : 0;
    } catch (e) { total = 0; }
    if (total === 0) return "Sem exercícios ainda";
    return total + " exercícios · " + sets + " séries";
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

    var routine = mostRecentRoutine();
    var card = document.createElement("div");
    card.className = "home-action-card" + (routine ? "" : " is-empty");

    var eyebrow = document.createElement("div");
    eyebrow.className = "home-action-eyebrow";
    eyebrow.id = "home-action-heading";
    eyebrow.textContent = routine ? "Próximo treino" : "Comece por aqui";
    card.appendChild(eyebrow);

    var title = document.createElement("h2");
    title.className = "home-action-title";
    title.textContent = routine ? routine.name : "Monte sua primeira rotina";
    card.appendChild(title);

    var meta = document.createElement("p");
    meta.className = "home-action-meta";
    if (routine) {
      var modeName = (F.MODE_NAMES && F.MODE_NAMES[routine.modality]) || routine.modality;
      meta.textContent = modeName + " · " + formatExerciseCount(routine);
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
    } else {
      button.href = F.url("treino");
      button.textContent = "Montar meu treino";
      button.setAttribute("aria-label", "Montar meu treino");
    }
    card.appendChild(button);

    if (routine) {
      var hint = document.createElement("p");
      hint.className = "home-action-hint";
      hint.textContent = "Vai iniciar a rotina mais recente. Você pode escolher outra em Treinos.";
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
    title.textContent = "Hora de treinar.";
    subtitle.textContent = "Sua rotina mais recente está pronta. Um toque para começar.";
  }

  function renderHome() {
    if (typeof global.renderCalendar === "function") global.renderCalendar();
    if (typeof global.renderMissions === "function") global.renderMissions();
    renderGreeting();
    renderAction();
    renderWeek();
    renderRecent();
  }

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
    mostRecentRoutine: mostRecentRoutine
  };
})(window);
