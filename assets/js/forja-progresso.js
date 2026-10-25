/*
  FORJA — progresso: análise dos treinos registrados.

  Esta página não inventa nada e não grava nada ao abrir. Toda a conta vem de
  `F.metricas` (módulo puro) sobre `F.state.history`; a tela só formata e
  desenha. As únicas gravações possíveis são as metas semanais, quando o
  usuário confirma o formulário — e vão para `forja-treino-metas-v1` pelo store.

  Filtros:
  - modalidade (Todas / Calistenia / Musculação) vale para resumo, comparação,
    gráficos, evolução, recordes, grupos e histórico;
  - período (Semana / Mês / Tudo / Personalizado) vale para resumo, comparação,
    grupos e histórico;
  - calendário e "semana a semana" têm janela própria (12 e 8 semanas) porque
    um calendário de uma semana não mostraria frequência;
  - metas usam sempre a semana corrente e o escopo salvo na própria meta.

  O histórico respeita o limite do app (`HISTORY_LIMIT`): os registros mais
  antigos já não existem nem para a conta, e a página avisa quando o limite
  está cheio.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const {
    MODE_NAMES,
    isPlainObject,
    byId,
    formatDurationLong,
    formatClock,
    HISTORY_LIMIT,
    metricas
  } = F;

  const FILTERS = ["all", "calisthenics", "weights"];
  const PERIODS = [
    { value: "week", label: "Semana", param: "semana" },
    { value: "month", label: "Mês", param: "mes" },
    { value: "all", label: "Tudo", param: "tudo" },
    { value: "custom", label: "Personalizado", param: "personalizado" }
  ];
  const WEEKLY_CHART_WEEKS = 8;
  const FREQUENCY_WEEKS = 12;
  const GOAL_MAX_MINUTES = 7 * 24 * 60;

  let currentFilter = "all";
  let currentPeriod = "all";
  let customFrom = "";
  let customTo = "";
  let historyQuery = "";
  let historyStatus = "all";
  let selectedExercise = "";

  /* ------------------------------------------------------------------ */
  /* Dados de entrada                                                    */
  /* ------------------------------------------------------------------ */

  /*
    O histórico é limitado desde a gravação, mas um storage antigo pode ter
    mais registros do que o limite atual. Aqui vale o mesmo teto do app.
  */
  function allRecords() {
    const history = Array.isArray(F.state.history) ? F.state.history : [];
    return history.slice(0, HISTORY_LIMIT).filter(isPlainObject);
  }

  function recordsByModality(records) {
    return records.filter(record => currentFilter === "all" || record.modality === currentFilter);
  }

  function currentRange() {
    const now = new Date();

    if (currentPeriod === "custom") {
      const custom = metricas.resolvePeriod("custom", { from: customFrom, to: customTo, now });
      if (custom) return custom;
    }

    return metricas.resolvePeriod(currentPeriod === "custom" ? "all" : currentPeriod, { now });
  }

  /* ------------------------------------------------------------------ */
  /* Formatação                                                          */
  /* ------------------------------------------------------------------ */

  function formatMeasure(value, unit) {
    const number = Number(value) || 0;

    if (unit === "kg") return F.formatKg(number);
    if (unit === "m") return F.formatDistance(number);
    if (unit === "s") return formatClock(number);
    if (unit === "reps") return F.formatNumber(number) + " reps";
    if (unit === "sets") return F.formatNumber(number) + " séries";
    if (unit === "minutes") return F.formatMinutes(number);
    return F.formatNumber(number);
  }

  function filterFromParam(value) {
    return FILTERS.indexOf(value) !== -1 ? value : "all";
  }

  function periodFromParam(value) {
    const found = PERIODS.find(option => option.param === value);
    return found ? found.value : "all";
  }

  /* ------------------------------------------------------------------ */
  /* Controles de período                                                */
  /* ------------------------------------------------------------------ */

  function buildPeriodControl() {
    const host = byId("period-control");
    if (!host) return;

    host.innerHTML = "";
    host.appendChild(F.ui.segmented({
      label: "Filtrar por período",
      value: currentPeriod,
      options: PERIODS.map(option => ({ value: option.value, label: option.label })),
      onChange: setPeriod
    }));
  }

  function updatePeriodControl() {
    document.querySelectorAll("#period-control [data-value]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-value") === currentPeriod));
    });

    const custom = byId("period-custom");
    if (custom) custom.hidden = currentPeriod !== "custom";

    if (currentPeriod !== "custom") {
      const error = byId("period-error");
      if (error) {
        error.textContent = "";
        error.hidden = true;
      }
    }

    if (currentPeriod === "custom") {
      const from = byId("period-from");
      const to = byId("period-to");
      if (from) from.value = customFrom;
      if (to) to.value = customTo;
    }
  }

  function defaultCustomRange() {
    const now = new Date();
    return {
      from: metricas.dateKeyOf(metricas.startOfMonth(now)),
      to: metricas.dateKeyOf(now)
    };
  }

  function setPeriod(value) {
    if (!PERIODS.some(option => option.value === value)) return;

    currentPeriod = value;

    if (value === "custom" && (!customFrom || !customTo)) {
      const fallback = defaultCustomRange();
      customFrom = fallback.from;
      customTo = fallback.to;
    }

    updatePeriodControl();
    syncUrl();
    renderAll();
  }

  function applyCustomPeriod() {
    const fromInput = byId("period-from");
    const toInput = byId("period-to");
    const error = byId("period-error");

    const fromKey = fromInput ? fromInput.value : "";
    const toKey = toInput ? toInput.value : "";
    const range = metricas.resolvePeriod("custom", { from: fromKey, to: toKey });

    if (!range) {
      if (error) {
        error.textContent = "Escolha uma data inicial e uma final válidas, com a inicial antes da final.";
        error.hidden = false;
      }
      return;
    }

    if (error) {
      error.textContent = "";
      error.hidden = true;
    }

    customFrom = fromKey;
    customTo = toKey;
    syncUrl();
    renderAll();
  }

  /* ------------------------------------------------------------------ */
  /* URL (compartilhável, sem parâmetro padrão)                          */
  /* ------------------------------------------------------------------ */

  function syncUrl() {
    const url = new URL(global.location.href);

    if (currentFilter === "all") url.searchParams.delete("modalidade");
    else url.searchParams.set("modalidade", currentFilter);

    if (currentPeriod === "all") url.searchParams.delete("periodo");
    else url.searchParams.set("periodo", periodFromValue(currentPeriod));

    if (currentPeriod === "custom") {
      url.searchParams.set("de", customFrom);
      url.searchParams.set("ate", customTo);
    } else {
      url.searchParams.delete("de");
      url.searchParams.delete("ate");
    }

    global.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function periodFromValue(value) {
    const found = PERIODS.find(option => option.value === value);
    return found ? found.param : "tudo";
  }

  /* ------------------------------------------------------------------ */
  /* Resumo                                                              */
  /* ------------------------------------------------------------------ */

  function renderSummary(records) {
    const summary = metricas.summarize(records);

    byId("progress-sessions").textContent = String(summary.sessions);
    byId("progress-completed").textContent = String(summary.completed);
    byId("progress-partial").textContent = String(summary.partial);
    byId("progress-sets").textContent = summary.sets + "/" + summary.plannedSets;
    byId("progress-time").textContent = summary.durationMs > 0
      ? formatDurationLong(summary.durationMs)
      : "0 min";

    /*
      Só entra no resumo a unidade que existe. Volume, repetições, tempo sob
      tensão e distância nunca são somados entre si.
    */
    const host = byId("progress-totals");
    host.innerHTML = "";

    const stats = [];

    if (summary.hasVolume) {
      stats.push({ value: F.formatKg(summary.volumeKg), label: "volume com carga" });
    }
    if (summary.hasReps) {
      stats.push({ value: F.formatNumber(summary.reps), label: "repetições" });
    }
    if (summary.hasTime) {
      stats.push({ value: formatClock(summary.seconds), label: "tempo sob tensão" });
    }
    if (summary.hasDistance) {
      stats.push({ value: F.formatDistance(summary.distanceMeters), label: "distância" });
    }
    if (summary.trainedDays > 0) {
      stats.push({ value: String(summary.trainedDays), label: "dias treinados" });
    }

    if (stats.length > 0) {
      host.appendChild(F.ui.statRow(stats, "progress-stats"));
    }

    const measureNote = byId("progress-measure-note");
    if (summary.setsWithoutVolume > 0) {
      measureNote.textContent = summary.setsWithoutVolume +
        (summary.setsWithoutVolume === 1 ? " série ficou" : " séries ficaram") +
        " fora do volume porque não tinha carga e repetições numéricas registradas.";
      measureNote.hidden = false;
    } else {
      measureNote.textContent = "";
      measureNote.hidden = true;
    }

    const limitNote = byId("progress-limit-note");
    const atLimit = F.state.history.length >= HISTORY_LIMIT;
    limitNote.textContent = atLimit
      ? "O histórico guarda até " + HISTORY_LIMIT + " treinos; os mais antigos são removidos automaticamente e não entram nestas contas."
      : "";
    limitNote.hidden = !atLimit;
  }

  /* ------------------------------------------------------------------ */
  /* Metas semanais                                                      */
  /* ------------------------------------------------------------------ */

  const GOAL_FIELDS = [
    { id: "weeklySessions", input: "goal-sessions", label: "Treinos", unit: "sessions", max: () => (F.GOAL_TARGET_LIMIT || 50) },
    { id: "weeklySets", input: "goal-sets", label: "Séries", unit: "sets", max: () => (F.GOAL_TARGET_LIMIT || 50) * 30 },
    { id: "weeklyMinutes", input: "goal-minutes", label: "Minutos", unit: "minutes", max: () => GOAL_MAX_MINUTES }
  ];

  function currentGoals() {
    return F.normalizeGoals(F.state.goals);
  }

  function fillGoalForm() {
    const goals = currentGoals();

    GOAL_FIELDS.forEach(field => {
      const input = byId(field.input);
      if (input) input.value = String(goals[field.id] || 0);
    });

    const modality = byId("goal-modality");
    if (modality) modality.value = goals.modality || "all";

    const status = byId("goals-status");
    if (status) {
      status.textContent = goals.updatedAt
        ? "Metas salvas em " + metricas.formatRecordDate({ finishedAt: goals.updatedAt }) + "."
        : "Nenhuma meta salva ainda.";
    }
  }

  function readGoalValue(field) {
    const input = byId(field.input);
    if (!input) return { value: 0 };

    const raw = String(input.value || "").trim();
    if (raw === "") return { value: 0 };

    if (!/^\d+$/.test(raw)) {
      return { error: "Use números inteiros nas metas (sem vírgula)." };
    }

    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > field.max()) {
      return { error: "A meta de " + field.label.toLowerCase() + " está fora do intervalo permitido." };
    }

    return { value };
  }

  function submitGoals(event) {
    if (event) event.preventDefault();

    const error = byId("goals-error");
    const values = { modality: byId("goal-modality").value };

    for (const field of GOAL_FIELDS) {
      const outcome = readGoalValue(field);

      if (outcome.error) {
        if (error) {
          error.textContent = outcome.error;
          error.hidden = false;
        }
        return;
      }

      values[field.id] = outcome.value;
    }

    if (error) {
      error.textContent = "";
      error.hidden = true;
    }

    /*
      Única gravação desta página: acontece só aqui, depois da confirmação.
      `saveGoals` normaliza e grava pelo store; se o navegador recusar, a tela
      avisa e mantém os valores digitados.
    */
    if (!F.saveGoals(values)) {
      if (error) {
        error.textContent = "Não foi possível salvar as metas. Verifique o espaço do navegador e tente de novo.";
        error.hidden = false;
      }
      return;
    }

    fillGoalForm();
    renderGoals();

    if (typeof F.ui.announce === "function") F.ui.announce("Metas semanais salvas.");
    F.showToast("Metas semanais salvas. Elas não alteram o histórico.", "info", 4000);
  }

  function renderGoals() {
    const host = byId("goals-progress");
    const note = byId("goals-scope-note");
    host.innerHTML = "";

    const records = allRecords();
    const progress = metricas.goalProgress(records, F.state.goals, { now: new Date() });
    const scope = progress.modality === "all" ? "todas as modalidades" : MODE_NAMES[progress.modality];

    note.textContent = "Semana de " + metricas.formatDayMonth(progress.week.from) +
      " a " + metricas.formatDayMonth(progress.week.to) + " · escopo: " + scope +
      ". Só os treinos desta semana entram na conta.";

    if (!progress.active) {
      host.appendChild(F.ui.empty({
        icon: "target",
        title: "Nenhuma meta ativa",
        text: "Defina treinos, séries ou minutos por semana acima. Alvo 0 desliga o item — " +
          "o FORJA não cria meta padrão escondida."
      }));
      return;
    }

    const grid = document.createElement("div");
    grid.className = "goals-progress";

    progress.items.filter(item => item.active).forEach(item => {
      grid.appendChild(F.charts.ring({
        percent: Math.min(100, item.percent),
        label: item.label,
        valueText: item.current + "/" + item.target,
        note: item.met
          ? "Meta batida"
          : F.formatGoalRemaining(item)
      }));
    });

    host.appendChild(grid);

    const metCount = progress.items.filter(item => item.active && item.met).length;
    const activeCount = progress.items.filter(item => item.active).length;
    const summary = document.createElement("p");
    summary.className = "limit-note";
    summary.textContent = metCount + " de " + activeCount + " meta(s) batida(s) nesta semana.";
    host.appendChild(summary);
  }

  /* ------------------------------------------------------------------ */
  /* Comparação de períodos                                              */
  /* ------------------------------------------------------------------ */

  /* Diferença com plural correto: "+1 série", não "+1 séries". */
  function deltaAmount(metric) {
    const size = Math.abs(metric.delta);

    if (metric.id === "sessions") return F.pluralize(size, "treino", "treinos");
    if (metric.id === "sets") return F.pluralize(size, "série", "séries");

    return formatMeasure(size, metric.unit);
  }

  function deltaText(metric) {
    if (metric.delta === 0) return "sem mudança";

    const signal = metric.delta > 0 ? "+" : "−";
    const amount = deltaAmount(metric);

    if (metric.percent === null) return signal + amount + " (sem base anterior)";
    return signal + amount + " (" + (metric.percent > 0 ? "+" : "") + metric.percent + "%)";
  }

  function renderComparison(records, range) {
    const host = byId("progress-compare");
    const note = byId("compare-scope-note");
    host.innerHTML = "";

    const comparison = metricas.comparePeriods(records, range, range.previous);

    if (!comparison.available) {
      note.textContent = "A comparação precisa de dois períodos do mesmo tipo.";
      host.appendChild(F.ui.empty({
        icon: "chart",
        title: "Escolha um período comparável",
        text: "Semana, Mês ou um intervalo personalizado são comparados com o bloco " +
          "imediatamente anterior. Em \"Tudo\" não existe período anterior e o FORJA " +
          "não inventa um recorte escondido."
      }));
      return;
    }

    note.textContent = range.label + " comparado com " + range.previous.label + ".";
    const list = document.createElement("ul");
    list.className = "compare-list";

    comparison.metrics.filter(metric => metric.available).forEach(metric => {
      const item = document.createElement("li");
      item.className = "compare-row";

      const main = document.createElement("div");
      main.className = "compare-main";

      const title = document.createElement("strong");
      title.textContent = metric.label;

      const detail = document.createElement("span");
      detail.textContent = formatMeasure(metric.current, metric.unit) + " agora · " +
        formatMeasure(metric.previous, metric.unit) + " antes";

      main.append(title, detail);

      const delta = document.createElement("span");
      delta.className = "compare-delta " + (metric.delta > 0 ? "is-up" : metric.delta < 0 ? "is-down" : "is-flat");
      delta.textContent = deltaText(metric);

      item.append(main, delta);
      list.appendChild(item);
    });

    if (list.children.length === 0) {
      host.appendChild(F.ui.empty({
        icon: "chart",
        title: "Nada registrado nos dois períodos",
        text: "Os dois períodos estão vazios. Registre um treino para a comparação aparecer."
      }));
      return;
    }

    host.appendChild(list);

    const summaryNote = document.createElement("p");
    summaryNote.className = "limit-note";
    summaryNote.textContent = comparison.metrics.some(metric => metric.id === "volume" && metric.available)
      ? "O volume considera apenas séries com repetições e carga numéricas; as demais ficaram fora."
      : "Nenhum dos dois períodos tem carga numérica registrada, então não há volume para comparar.";
    host.appendChild(summaryNote);
  }

  /* ------------------------------------------------------------------ */
  /* Calendário de frequência                                            */
  /* ------------------------------------------------------------------ */

  function renderFrequency(records) {
    const host = byId("progress-frequency");
    const note = byId("frequency-note");
    host.innerHTML = "";

    const calendar = metricas.frequency(records, { weeks: FREQUENCY_WEEKS });

    note.textContent = "Calendário fixo das últimas " + FREQUENCY_WEEKS +
      " semanas: o período e a busca do histórico não mudam este bloco.";

    if (!calendar.hasData) {
      host.appendChild(F.ui.empty({
        icon: "calendar",
        title: "Sem treinos nas últimas 12 semanas",
        text: "Quando houver treino registrado nessa janela, os dias aparecem aqui com a " +
          "quantidade de séries concluídas."
      }));
      return;
    }

    const chart = F.charts.heatmap({
      days: calendar.days,
      ariaLabel: "Frequência de treinos nas últimas 12 semanas",
      legendStart: "menos séries",
      legendEnd: "mais séries",
      caption: calendar.trainedDays + " dia(s) com treino e " + calendar.trainedSessions +
        " treino(s) nas últimas 12 semanas."
    });

    if (chart) host.appendChild(chart);
  }

  /* ------------------------------------------------------------------ */
  /* Semana a semana                                                     */
  /* ------------------------------------------------------------------ */

  function renderWeekly(records) {
    const host = byId("progress-weekly");
    host.innerHTML = "";

    const weeks = metricas.weeklySeries(records, { weeks: WEEKLY_CHART_WEEKS });

    if (!weeks.some(week => week.sessions > 0)) {
      host.appendChild(F.ui.empty({
        icon: "chart",
        title: "Sem treinos nas últimas 8 semanas",
        text: "O gráfico aparece quando houver pelo menos um treino registrado nessa janela."
      }));
      return;
    }

    const sessionsChart = F.charts.columns({
      items: weeks.map(week => ({
        label: week.label,
        value: week.sessions,
        hint: "Semana de " + week.label + " · " + week.sessions + " treino(s)"
      })),
      format: value => F.formatNumber(value),
      ariaLabel: "Treinos por semana nas últimas 8 semanas",
      caption: "Treinos encerrados por semana. Semanas sem treino aparecem zeradas, não omitidas."
    });

    if (sessionsChart) host.appendChild(sessionsChart);

    const setsChart = F.charts.bars({
      items: weeks.map(week => ({ label: week.label, value: week.sets })),
      format: value => F.formatNumber(value),
      ariaLabel: "Séries concluídas por semana nas últimas 8 semanas",
      caption: "Séries concluídas por semana, somando todos os treinos da semana.",
      tableCaption: "Séries concluídas por semana",
      tableColumns: ["Semana", "Séries concluídas"],
      tableRows: weeks.map(week => [week.label, F.formatNumber(week.sets)])
    });

    if (setsChart) host.appendChild(setsChart);
  }

  /* ------------------------------------------------------------------ */
  /* Evolução por exercício                                              */
  /* ------------------------------------------------------------------ */

  function evolutionFormat(unit) {
    return value => formatMeasure(value, unit);
  }

  function renderEvolution(records) {
    const select = byId("evolution-select");

    const exercises = metricas.exerciseList(records);
    select.innerHTML = "";

    if (exercises.length === 0) {
      select.disabled = true;
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Nenhum exercício registrado";
      select.appendChild(option);
      selectedExercise = "";

      const host = byId("progress-evolution");
      host.innerHTML = "";
      host.appendChild(F.ui.empty({
        icon: "chart",
        title: "Nenhum exercício registrado neste filtro",
        text: "A evolução começa depois do primeiro treino com séries registradas."
      }));
      return;
    }

    select.disabled = false;

    exercises.forEach(entry => {
      const option = document.createElement("option");
      option.value = entry.key;
      const modality = currentFilter === "all" ? " · " + MODE_NAMES[entry.modality] : "";
      option.textContent = entry.name + modality + " · " +
        entry.sessions + (entry.sessions === 1 ? " treino" : " treinos");
      select.appendChild(option);
    });

    if (exercises.some(entry => entry.key === selectedExercise)) {
      select.value = selectedExercise;
    } else {
      selectedExercise = exercises[0].key;
      select.value = selectedExercise;
    }

    renderEvolutionChart(records);
  }

  function renderEvolutionChart(records) {
    const host = byId("progress-evolution");
    host.innerHTML = "";

    if (!selectedExercise) return;

    const evolution = metricas.exerciseEvolution(records, selectedExercise);

    if (!evolution.hasSeries) {
      host.appendChild(F.ui.empty({
        icon: "chart",
        title: "Ainda não há série de evolução",
        text: evolution.points.length === 1
          ? "Só há 1 treino com " + evolution.valueLabel.toLowerCase() + " medido. " +
            "A linha aparece a partir do segundo treino — um ponto isolado não é evolução."
          : "Não há valor medido para " + evolution.valueLabel.toLowerCase() +
            " neste exercício. " + evolution.criteria
      }));
      return;
    }

    const chart = F.charts.line({
      points: evolution.points.map(point => ({
        label: point.label,
        y: point.y,
        note: point.note
      })),
      format: evolutionFormat(evolution.unit),
      ariaLabel: evolution.name + " — " + evolution.valueLabel,
      caption: evolution.criteria,
      tableCaption: "Evolução de " + evolution.name,
      tableColumns: ["Data", evolution.valueLabel]
    });

    if (chart) host.appendChild(chart);

    const best = evolution.best;
    const summary = document.createElement("p");
    summary.className = "limit-note";
    summary.textContent = best
      ? "Melhor registro: " + formatMeasure(best.y, evolution.unit) + " em " + best.label +
        ". " + evolution.sessions + " treino(s) com este exercício; " +
        evolution.points.length + " com valor medido."
      : "";

    if (evolution.unmeasured > 0) {
      summary.textContent += " " + evolution.unmeasured +
        " treino(s) sem " + evolution.valueLabel.toLowerCase() + " ficaram fora da linha.";
    }

    host.appendChild(summary);
  }

  /* ------------------------------------------------------------------ */
  /* Recordes                                                            */
  /* ------------------------------------------------------------------ */

  function recordDetail(item) {
    const parts = [];

    if (item.id === "load" || item.id === "reps") {
      if (item.exercise) parts.push(item.exercise);
      if (item.id === "load" && item.reps > 0) parts.push(item.reps + " reps");
      if (item.id === "reps" && item.loadKg > 0) parts.push(F.formatKg(item.loadKg));
    } else if (item.id === "time" || item.id === "distance") {
      if (item.exercise) parts.push(item.exercise);
      if (item.id === "time" && item.reps > 0) parts.push(item.reps + " reps");
    } else if (item.routineName) {
      parts.push(item.routineName);
    }

    if (item.date) parts.push(metricas.formatFullDate(item.date));

    return parts.join(" · ");
  }

  function renderRecords(records) {
    const list = byId("progress-records");
    const note = byId("records-note");
    list.innerHTML = "";

    const recordsResult = metricas.personalRecords(records);

    if (!recordsResult.hasData) {
      const empty = F.ui.empty({
        icon: "flame",
        title: "Nenhum recorde medido ainda",
        text: "Recordes usam séries com número registrado. Um treino sem carga, tempo ou " +
          "distância numérica não cria recorde de fachada."
      });
      const item = document.createElement("li");
      item.className = "records-empty";
      item.appendChild(empty);
      list.appendChild(item);
      note.textContent = "";
      return;
    }

    recordsResult.items.forEach(item => {
      const li = document.createElement("li");
      li.className = "record-item";
      li.setAttribute("data-record", item.id);

      const head = document.createElement("div");
      head.className = "record-head";

      const title = document.createElement("strong");
      title.className = "record-title";
      title.textContent = item.title;

      const value = document.createElement("span");
      value.className = "record-value";
      value.textContent = formatMeasure(item.value, item.unit);

      head.append(title, value);

      const detail = document.createElement("p");
      detail.className = "record-detail";
      detail.textContent = recordDetail(item);

      const criteria = document.createElement("p");
      criteria.className = "record-criteria";
      criteria.textContent = "Critério: " + item.criteria;

      li.append(head, detail, criteria);
      list.appendChild(li);
    });

    note.textContent = recordsResult.absent.length > 0
      ? "Sem dado medido para: " + recordsResult.absent.map(item => item.title.toLowerCase()).join(", ") + "."
      : "";
  }

  /* ------------------------------------------------------------------ */
  /* Por rotina / por exercício (listas do período)                      */
  /* ------------------------------------------------------------------ */

  function emptyItem(text) {
    const item = document.createElement("li");
    item.className = "progress-empty";
    item.textContent = text;
    return item;
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
      if (!group.lastDate) group.lastDate = metricas.formatRecordDate(record);
    });

    if (groups.size === 0) {
      list.appendChild(emptyItem("Nenhuma rotina treinada no período selecionado."));
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
        if (!isPlainObject(exercise) || typeof exercise.name !== "string") return;

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
        if (!entry.last && isPlainObject(lastLog)) {
          const parts = [];
          if (lastLog.reps) parts.push(lastLog.reps + " reps");
          if (lastLog.load) parts.push(lastLog.load);
          if (typeof lastLog.seconds === "number" && lastLog.seconds > 0) parts.push(formatClock(lastLog.seconds));
          if (Number(lastLog.distance) > 0) {
            parts.push(lastLog.distance + " " + (exercise.distanceUnit || "m"));
          }
          if (parts.length > 0) entry.last = parts.join(" · ");
        }
      });
    });

    if (byName.size === 0) {
      list.appendChild(emptyItem("Os exercícios aparecem aqui depois do primeiro treino registrado no período."));
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

  /* ------------------------------------------------------------------ */
  /* Histórico com busca e filtros                                       */
  /* ------------------------------------------------------------------ */

  function historyFiltersActive() {
    return historyQuery.trim() !== "" || historyStatus !== "all";
  }

  function clearHistoryFilters() {
    historyQuery = "";
    historyStatus = "all";

    const search = byId("history-search");
    const status = byId("history-status");
    if (search) search.value = "";
    if (status) status.value = "all";

    renderHistory(recordsByModality(allRecords()), currentRange());
  }

  function renderHistory(records, range) {
    const list = byId("progress-history");
    const count = byId("history-filter-count");
    const clear = byId("history-clear");
    list.innerHTML = "";

    const inPeriod = metricas.filterByPeriod(records, range);
    const filtered = metricas.searchRecords(records, {
      query: historyQuery,
      status: historyStatus,
      period: range
    });

    if (historyFiltersActive()) {
      count.textContent = filtered.length + " de " + inPeriod.length + " treino(s) no período.";
    } else {
      count.textContent = filtered.length + (filtered.length === 1 ? " treino no período." : " treinos no período.");
    }

    if (clear) clear.hidden = !historyFiltersActive();

    if (filtered.length === 0) {
      const hasRecords = records.length > 0;

      const empty = F.ui.empty({
        icon: "history",
        title: hasRecords ? "Nenhum treino corresponde à busca" : "Nenhum treino registrado ainda",
        text: hasRecords
          ? "A busca considera rotina, exercício, carga digitada e nota da sessão, sempre dentro do período selecionado."
          : "Inicie uma rotina em Treino. Sessões concluídas e encerradas com progresso parcial aparecem aqui.",
        actions: hasRecords && historyFiltersActive()
          ? [{ label: "Limpar busca e status", onClick: clearHistoryFilters }]
          : undefined
      });

      list.appendChild(empty);
      return;
    }

    filtered.forEach(record => {
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
    details.textContent = metricas.formatRecordDate(record) + " · " +
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
        if (!isPlainObject(exercise)) return;

        const li = document.createElement("li");
        const line = document.createElement("div");
        line.textContent = exercise.name + " · " +
          (Number(exercise.completedSets) || 0) + "/" + (Number(exercise.plannedSets) || 0) + " séries";
        li.appendChild(line);

        const logs = Array.isArray(exercise.logs) ? exercise.logs : [];
        if (logs.length > 0) {
          const logLine = document.createElement("small");
          logLine.textContent = logs.filter(isPlainObject).map(entry => {
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

  /* ------------------------------------------------------------------ */
  /* Render geral                                                        */
  /* ------------------------------------------------------------------ */

  function renderAll() {
    const records = allRecords();
    const modalityRecords = recordsByModality(records);
    const range = currentRange();
    const periodRecords = metricas.filterByPeriod(modalityRecords, range);

    document.querySelectorAll("[data-filter]").forEach(button => {
      const active = button.getAttribute("data-filter") === currentFilter;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
    });

    const scope = currentFilter === "all" ? "Todas as modalidades" : MODE_NAMES[currentFilter];
    byId("progress-scope").textContent = scope + " · " + range.label;

    updatePeriodControl();

    renderSummary(periodRecords);
    renderGoals();
    renderComparison(modalityRecords, range);
    renderFrequency(modalityRecords);
    renderWeekly(modalityRecords);
    renderEvolution(modalityRecords);
    renderRecords(modalityRecords);
    renderRoutines(periodRecords);
    renderExercises(periodRecords);
    renderHistory(modalityRecords, range);
  }

  function setFilter(value) {
    currentFilter = filterFromParam(value);
    syncUrl();
    renderAll();
  }

  /* ------------------------------------------------------------------ */
  /* Inicialização                                                       */
  /* ------------------------------------------------------------------ */

  F.pages.progresso = function initProgresso() {
    const params = new URLSearchParams(global.location.search);

    currentFilter = filterFromParam(params.get("modalidade"));
    currentPeriod = periodFromParam(params.get("periodo"));

    if (currentPeriod === "custom") {
      const from = metricas.parseKey(params.get("de"));
      const to = metricas.parseKey(params.get("ate"));

      if (from && to && from <= to) {
        customFrom = params.get("de");
        customTo = params.get("ate");
      } else {
        currentPeriod = "all";
      }
    }

    if (currentPeriod === "custom" && (!customFrom || !customTo)) {
      const fallback = defaultCustomRange();
      customFrom = fallback.from;
      customTo = fallback.to;
    }

    buildPeriodControl();
    updatePeriodControl();

    document.querySelectorAll("[data-filter]").forEach(button => {
      button.addEventListener("click", () => {
        setFilter(button.getAttribute("data-filter"));
      });
    });

    const apply = byId("period-apply");
    if (apply) apply.addEventListener("click", applyCustomPeriod);

    const goalsForm = byId("goals-form");
    if (goalsForm) goalsForm.addEventListener("submit", submitGoals);

    const search = byId("history-search");
    if (search) {
      search.addEventListener("input", () => {
        historyQuery = search.value;
        renderHistory(recordsByModality(allRecords()), currentRange());
      });
    }

    const status = byId("history-status");
    if (status) {
      status.addEventListener("change", () => {
        historyStatus = status.value;
        renderHistory(recordsByModality(allRecords()), currentRange());
      });
    }

    const clear = byId("history-clear");
    if (clear) clear.addEventListener("click", clearHistoryFilters);

    const evolutionSelect = byId("evolution-select");
    if (evolutionSelect) {
      evolutionSelect.addEventListener("change", () => {
        selectedExercise = evolutionSelect.value;
        renderEvolutionChart(recordsByModality(allRecords()));
      });
    }

    fillGoalForm();
    renderAll();

    F.onDataChanged(() => {
      fillGoalForm();
      renderAll();
    });
  };

  F.progressFilter = () => currentFilter;
  F.setProgressFilter = setFilter;
  F.progressPeriod = () => currentPeriod;

})(window);
