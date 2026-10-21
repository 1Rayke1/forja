/*
  FORJA — progresso: histórico e totais calculados apenas a partir dos
  registros salvos (forja-treino-historico-v1). Nenhuma métrica é estimada:
  se não há registro, a página mostra zero ou uma mensagem de vazio.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const {
    MODE_NAMES,
    isPlainObject,
    byId,
    formatDate,
    parseDateKey,
    formatDurationLong,
    formatClock,
    HISTORY_LIMIT
  } = F;

  const FILTERS = ["all", "calisthenics", "weights"];
  let currentFilter = "all";

  function filterFromParam(value) {
    return FILTERS.indexOf(value) !== -1 ? value : "all";
  }

  function visibleRecords() {
    return F.state.history.filter(record => {
      if (!isPlainObject(record)) return false;
      return currentFilter === "all" || record.modality === currentFilter;
    });
  }

  function recordDate(record) {
    const parsed = record.finishedAt ? new Date(record.finishedAt) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
    return parseDateKey(record.date) || null;
  }

  function formatRecordDate(record) {
    const date = recordDate(record);
    if (!date) return "Data não registrada";
    return formatDate(date, {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

  function sumBy(records, getValue) {
    return records.reduce((sum, record) => sum + (Number(getValue(record)) || 0), 0);
  }

  function renderSummary(records) {
    const completed = records.filter(record => record.status === "completed").length;
    const partial = records.length - completed;
    const doneSets = sumBy(records, record => record.completedSets);
    const plannedSets = sumBy(records, record => record.totalPlannedSets);
    const totalMs = sumBy(records, record => record.durationMs);

    byId("progress-sessions").textContent = String(records.length);
    byId("progress-completed").textContent = String(completed);
    byId("progress-partial").textContent = String(partial);
    byId("progress-sets").textContent = doneSets + "/" + plannedSets;
    byId("progress-time").textContent = totalMs > 0 ? formatDurationLong(totalMs) : "0 min";
  }

  function renderRoutines(records) {
    const list = byId("progress-routines");
    list.innerHTML = "";

    const groups = new Map();
    records.forEach(record => {
      const key = record.modality + "|" + (record.routineName || "Treino");
      if (!groups.has(key)) {
        groups.set(key, {
          name: record.routineName || "Treino",
          modality: record.modality,
          sessions: 0,
          completed: 0,
          lastDate: null
        });
      }

      const group = groups.get(key);
      group.sessions += 1;
      if (record.status === "completed") group.completed += 1;
      if (!group.lastDate) group.lastDate = formatRecordDate(record);
    });

    if (groups.size === 0) {
      list.appendChild(emptyItem("Nenhuma rotina treinada ainda."));
      return;
    }

    Array.from(groups.values()).forEach(group => {
      const item = document.createElement("li");
      const label = document.createElement("div");
      label.className = "progress-row-main";

      const name = document.createElement("strong");
      name.textContent = group.name;

      const meta = document.createElement("span");
      meta.textContent = (currentFilter === "all" ? MODE_NAMES[group.modality] + " · " : "") +
        group.sessions + (group.sessions === 1 ? " treino" : " treinos") +
        " · " + group.completed + " concluído(s) · último em " + group.lastDate;

      label.append(name, meta);
      item.appendChild(label);
      list.appendChild(item);
    });
  }

  function renderExercises(records) {
    const list = byId("progress-exercises");
    list.innerHTML = "";

    const byName = new Map();

    records.forEach(record => {
      (Array.isArray(record.exercises) ? record.exercises : []).forEach(exercise => {
        const key = (record.modality || "") + "|" + exercise.name;
        if (!byName.has(key)) {
          byName.set(key, {
            name: exercise.name,
            modality: record.modality,
            sessions: 0,
            sets: 0,
            last: ""
          });
        }

        const entry = byName.get(key);
        entry.sessions += 1;
        entry.sets += Number(exercise.completedSets) || 0;

        const logs = Array.isArray(exercise.logs) ? exercise.logs : [];
        const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
        if (!entry.last && lastLog) {
          const parts = [];
          if (lastLog.reps) parts.push(lastLog.reps + " reps");
          if (lastLog.load) parts.push(lastLog.load);
          if (typeof lastLog.seconds === "number") parts.push(formatClock(lastLog.seconds));
          if (parts.length > 0) entry.last = parts.join(" · ");
        }
      });
    });

    if (byName.size === 0) {
      list.appendChild(emptyItem("Os exercícios aparecem aqui depois do primeiro treino registrado."));
      return;
    }

    Array.from(byName.values())
      .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, 30)
      .forEach(entry => {
        const item = document.createElement("li");
        const label = document.createElement("div");
        label.className = "progress-row-main";

        const name = document.createElement("strong");
        name.textContent = entry.name;

        const meta = document.createElement("span");
        meta.textContent = entry.sessions + (entry.sessions === 1 ? " treino" : " treinos") +
          " · " + entry.sets + " série(s) concluída(s)" +
          (entry.last ? " · último registro: " + entry.last : "");

        label.append(name, meta);
        item.appendChild(label);
        list.appendChild(item);
      });
  }

  function emptyItem(text) {
    const item = document.createElement("li");
    item.className = "progress-empty";
    item.textContent = text;
    return item;
  }

  function renderHistory(records) {
    const list = byId("progress-history");
    list.innerHTML = "";

    if (records.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-card";
      const heading = document.createElement("strong");
      heading.textContent = currentFilter === "all"
        ? "Nenhum treino registrado ainda"
        : "Nenhum treino de " + MODE_NAMES[currentFilter] + " registrado";
      const text = document.createElement("p");
      text.textContent = "Inicie uma rotina em Treino. Sessões concluídas e encerradas com progresso parcial aparecem aqui.";
      empty.append(heading, text);
      list.appendChild(empty);
      return;
    }

    records.forEach(record => {
      list.appendChild(renderRecord(record));
    });
  }

  function renderRecord(record) {
    const item = document.createElement("div");
    item.className = "history-item";

    const head = document.createElement("div");
    head.className = "history-item-head";

    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = (record.routineName || "Treino") + " · " + (MODE_NAMES[record.modality] || "");

    const status = document.createElement("span");
    status.className = "history-status " + (record.status === "completed" ? "completed" : "partial");
    status.textContent = record.status === "completed" ? "Concluído" : "Parcial";

    head.append(title, status);

    const details = document.createElement("div");
    details.className = "history-details";
    details.textContent = formatRecordDate(record) + " · " +
      (Number(record.completedSets) || 0) + "/" + (Number(record.totalPlannedSets) || 0) +
      " séries · " + formatDurationLong(Number(record.durationMs) || 0);

    item.append(head, details);

    /*
      Só mostram números que a sessão realmente registrou: volume em kg aparece
      quando houve carga numérica, distância quando houve série por distância.
    */
    const totals = F.isPlainObject(record.totals) ? record.totals : null;
    const measured = [];

    if (totals) {
      if (totals.volumeKg > 0) measured.push(F.formatKg(totals.volumeKg));
      if (totals.reps > 0) measured.push(F.formatNumber(totals.reps) + " repetições");
      if (totals.seconds > 0) measured.push(formatClock(totals.seconds) + " por duração");
      if (totals.distanceMeters > 0) measured.push(F.formatDistance(totals.distanceMeters));
    }

    if (measured.length > 0) {
      const totalsLine = document.createElement("div");
      totalsLine.className = "history-record-extra";
      totalsLine.textContent = "Registrado: " + measured.join(" · ");
      item.appendChild(totalsLine);
    }

    const feedback = F.isPlainObject(record.feedback) ? record.feedback : null;

    if (feedback && (feedback.note || feedback.rpe)) {
      const feedbackLine = document.createElement("div");
      feedbackLine.className = "history-record-extra history-record-feedback";
      feedbackLine.textContent = [
        feedback.rpe ? "Esforço da sessão (RPE) " + feedback.rpe : "",
        feedback.note ? "Nota: " + feedback.note : ""
      ].filter(Boolean).join(" · ");
      item.appendChild(feedbackLine);
    }

    const exercises = Array.isArray(record.exercises) ? record.exercises : [];
    if (exercises.length > 0) {
      const toggle = document.createElement("details");
      toggle.className = "history-exercises";

      const summary = document.createElement("summary");
      summary.textContent = "Ver exercícios (" + exercises.length + ")";
      toggle.appendChild(summary);

      const ul = document.createElement("ul");
      exercises.forEach(exercise => {
        const li = document.createElement("li");
        const line = document.createElement("div");
        line.textContent = exercise.name + " · " +
          (Number(exercise.completedSets) || 0) + "/" + (Number(exercise.plannedSets) || 0) + " séries";
        li.appendChild(line);

        const logs = Array.isArray(exercise.logs) ? exercise.logs : [];
        if (logs.length > 0) {
          const logLine = document.createElement("small");
          logLine.textContent = logs.map(entry => {
            const parts = ["S" + entry.set];
            if (entry.reps) parts.push(entry.reps + " reps");
            if (entry.load) parts.push(entry.load);
            if (typeof entry.seconds === "number") parts.push(formatClock(entry.seconds));
            if (Number(entry.distance) > 0) parts.push(entry.distance + " " + (exercise.distanceUnit || "m"));
            if (Number(entry.rpe) > 0) parts.push("RPE " + entry.rpe);
            return parts.join(" ");
          }).join(" · ");
          li.appendChild(logLine);
        }

        ul.appendChild(li);
      });

      toggle.appendChild(ul);
      item.appendChild(toggle);
    }

    return item;
  }

  function render() {
    const records = visibleRecords();

    document.querySelectorAll("[data-filter]").forEach(button => {
      const active = button.getAttribute("data-filter") === currentFilter;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
    });

    byId("progress-scope").textContent = currentFilter === "all"
      ? "Todas as modalidades"
      : MODE_NAMES[currentFilter];

    renderSummary(records);
    renderRoutines(records);
    renderExercises(records);
    renderHistory(records);

    const note = byId("progress-limit-note");
    if (note) {
      note.textContent = F.state.history.length >= HISTORY_LIMIT
        ? "O histórico guarda até " + HISTORY_LIMIT + " treinos; os mais antigos são removidos automaticamente."
        : "";
      note.hidden = F.state.history.length < HISTORY_LIMIT;
    }
  }

  function setFilter(value) {
    currentFilter = filterFromParam(value);

    const url = new URL(global.location.href);
    if (currentFilter === "all") {
      url.searchParams.delete("modalidade");
    } else {
      url.searchParams.set("modalidade", currentFilter);
    }
    global.history.replaceState(null, "", url.pathname + url.search + url.hash);

    render();
  }

  F.pages.progresso = function initProgresso() {
    const params = new URLSearchParams(global.location.search);
    currentFilter = filterFromParam(params.get("modalidade"));

    document.querySelectorAll("[data-filter]").forEach(button => {
      button.addEventListener("click", () => {
        setFilter(button.getAttribute("data-filter"));
      });
    });

    render();
    F.onDataChanged(render);
  };

  F.progressFilter = () => currentFilter;
  F.setProgressFilter = setFilter;

})(window);
