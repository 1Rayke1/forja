/*
  FORJA — painel de Evolução (progresso/index.html).

  Camada de apresentação sobre `assets/js/forja-progresso.js`, que continua
  dono de todo o cálculo e do estado da página (filtro de modalidade, período
  do histórico, metas, recordes, histórico, evolução por exercício).

  Aqui ficam apenas as quatro peças novas da tela:

  - abas Visão Geral / Músculos / Histórico (acessíveis por teclado);
  - indicadores do topo (treinos, consistência, calorias estimadas);
  - gráfico de evolução com filtro de 7 / 30 / 90 dias / tudo;
  - cartão de grupos musculares sobre a ilustração anatômica e a mensagem
    de incentivo.

  Regras que valem para tudo abaixo:

  - nenhum número é inventado. Treinos e dias treinados vêm de `F.metricas`
    sobre o histórico real. As calorias usam a mesma fórmula já publicada na
    home (MET 5,0 × peso declarado × duração registrada) e viram "—" quando
    falta peso ou duração;
  - nenhuma gravação: abrir a tela não escreve em storage;
  - a ilustração usa o mesmo `F.figura` do atlas, com os grupos musculares
    derivados do catálogo central pelo nome real do exercício.
*/

(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const TABS = ["overview", "muscles", "history"];
  const PERIODS = { "7": 7, "30": 30, "90": 90, all: null };
  const KCAL_MET = 5;

  /* Traduz o id do grupo muscular do catálogo central para a região desenhada
     na figura anatômica. Grupos sem região própria ficam de fora da figura,
     mas continuam na lista. */
  const GROUP_TO_REGION = Object.freeze({
    biceps: "biceps",
    triceps: "triceps",
    peitoral: "peito",
    costas: "dorsais",
    ombros: "ombros",
    trapezio: "costas",
    abdomen: "abdomem",
    obliquos: "obliquos",
    quadriceps: "quadriceps",
    posteriores: "pernas",
    gluteos: "gluteos",
    panturrilhas: "panturrilha",
    antebracos: "antebracos"
  });

  let chartPeriod = "30";
  let activeTab = "overview";

  function byId(id) { return doc.getElementById(id); }

  function text(id, value) {
    const node = byId(id);
    if (node) node.textContent = value;
  }

  function pct(part, whole) {
    if (!(whole > 0)) return 0;
    return Math.round((part / whole) * 100);
  }

  /* A marcação guarda só `data-icon`; o desenho vem do conjunto do app. */
  function hydrateIcons() {
    if (!F.ui || typeof F.ui.icon !== "function") return;
    doc.querySelectorAll("[data-icon]").forEach(node => {
      const name = node.getAttribute("data-icon");
      if (!name || node.querySelector("svg")) return;
      const drawn = F.ui.icon(name);
      if (!drawn) return;
      node.appendChild(drawn.querySelector("svg") || drawn);
      node.removeAttribute("data-icon");
    });
  }

  /* ------------------------------------------------------------------ */
  /* Abas                                                                */
  /* ------------------------------------------------------------------ */

  function showTab(name) {
    if (TABS.indexOf(name) === -1) return;
    activeTab = name;

    TABS.forEach(tab => {
      const button = byId("ev-tab-" + tab);
      const panel = byId("ev-panel-" + tab);
      const selected = tab === name;

      if (button) {
        button.setAttribute("aria-selected", String(selected));
        button.setAttribute("tabindex", selected ? "0" : "-1");
      }
      if (panel) panel.hidden = !selected;
    });

    /* A aba vai para a URL para sobreviver ao recarregamento, sem rota nova. */
    const url = new URL(global.location.href);
    if (name === "overview") url.searchParams.delete("aba");
    else url.searchParams.set("aba", name);
    global.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function initTabs() {
    doc.querySelectorAll(".ev-tab").forEach(button => {
      button.addEventListener("click", () => showTab(button.getAttribute("data-tab")));
      button.addEventListener("keydown", event => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const index = TABS.indexOf(button.getAttribute("data-tab"));
        const next = TABS[(index + step + TABS.length) % TABS.length];
        showTab(next);
        const target = byId("ev-tab-" + next);
        if (target) target.focus();
      });
    });

    const requested = new URLSearchParams(global.location.search).get("aba");
    showTab(TABS.indexOf(requested) === -1 ? "overview" : requested);
  }

  /* ------------------------------------------------------------------ */
  /* Dados de entrada                                                    */
  /* ------------------------------------------------------------------ */

  function modalityFilter() {
    return typeof F.progressFilter === "function" ? F.progressFilter() : "all";
  }

  function filteredRecords() {
    const history = Array.isArray(F.state.history) ? F.state.history.slice() : [];
    const filter = modalityFilter();
    return history.filter(record => record && typeof record === "object" &&
      (filter === "all" || record.modality === filter));
  }

  function withinDays(records, days) {
    if (!days) return records;
    const limit = days * 24 * 60 * 60 * 1000;
    const now = Date.now();
    return records.filter(record => {
      const date = F.metricas.recordDate(record);
      return Boolean(date) && now - date.getTime() <= limit;
    });
  }

  function windowSummary(records) {
    const days = PERIODS[chartPeriod];
    return F.metricas.summarize(withinDays(records, days));
  }

  /* Janela imediatamente anterior, do mesmo tamanho, para o comparativo. */
  function previousSummary(records) {
    const days = PERIODS[chartPeriod];
    if (!days) return null;

    const limit = days * 24 * 60 * 60 * 1000;
    const now = Date.now();

    return F.metricas.summarize(records.filter(record => {
      const date = F.metricas.recordDate(record);
      if (!date) return false;
      const age = now - date.getTime();
      return age > limit && age <= limit * 2;
    }));
  }

  function periodLabel() {
    const days = PERIODS[chartPeriod];
    return days ? "Últimos " + days + " dias" : "Todo o histórico";
  }

  /* ------------------------------------------------------------------ */
  /* Indicadores                                                         */
  /* ------------------------------------------------------------------ */

  /*
    Consistência = dias treinados ÷ dias planejados na janela do gráfico.

    O denominador vem do perfil (`diasPorSemana`, informado no onboarding ou no
    Perfil): 3 dias por semana em 30 dias são ~12,9 dias previstos, então 6
    dias treinados dão 47%. Sem dias planejados no perfil não existe
    denominador honesto — a tela mostra "—" em vez de inventar uma base.
  */
  function plannedDaysPerWeek() {
    const profile = F.state && F.isPlainObject(F.state.profile) ? F.state.profile : {};
    const days = Number(profile.diasPorSemana) || 0;
    return days > 0 ? Math.min(7, days) : 0;
  }

  function windowDays() {
    const days = PERIODS[chartPeriod];
    if (days) return days;

    /* Todo o histórico: do primeiro treino até hoje, no mínimo uma semana. */
    const dates = filteredRecords()
      .map(record => F.metricas.recordDate(record))
      .filter(Boolean);

    if (dates.length === 0) return 7;

    const first = dates.reduce((a, b) => (a < b ? a : b));
    const span = Math.ceil((Date.now() - first.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    return Math.max(7, span);
  }

  function consistencyFor(summary) {
    const perWeek = plannedDaysPerWeek();

    if (!(perWeek > 0)) {
      return { value: null, planned: 0, trained: summary.trainedDays };
    }

    const planned = Math.max(1, (windowDays() / 7) * perWeek);
    const value = Math.min(100, Math.round((summary.trainedDays / planned) * 100));

    return { value: value, planned: Math.round(planned), trained: summary.trainedDays };
  }

  /*
    Calorias: mesma fórmula declarada na home — MET 5,0 (treino de força
    moderado), kcal = MET × 3,5 × peso(kg) / 200 × minutos. Só é calculada
    quando existem peso no perfil e duração registrada; caso contrário o
    indicador mostra "—" e o motivo no rodapé do cartão.
  */
  function caloriesFor(summary) {
    const profile = F.state && F.isPlainObject(F.state.profile) ? F.state.profile : {};
    const weight = Number(profile.pesoKg) || 0;
    const minutes = Math.round((Number(summary.durationMs) || 0) / 60000);

    if (!(weight > 0)) {
      return { available: false, reason: "informe seu peso no perfil", kcal: 0, minutes: minutes };
    }
    if (!(minutes > 0)) {
      return { available: false, reason: "sem duração registrada", kcal: 0, minutes: minutes };
    }

    return {
      available: true,
      reason: "",
      kcal: Math.round((KCAL_MET * 3.5 * weight / 200) * minutes),
      minutes: minutes
    };
  }

  function weekSummary(records) {
    const range = F.metricas.resolvePeriod("week");
    return F.metricas.summarize(F.metricas.filterByPeriod(records, range));
  }

  function renderKpis() {
    const records = filteredRecords();
    const current = windowSummary(records);
    const previous = previousSummary(records);
    const week = weekSummary(records);
    const calories = caloriesFor(current);

    const consistency = consistencyFor(current);

    text("ev-kpi-sessions", String(current.sessions));
    text("ev-kpi-consistency", consistency.value === null ? "—" : consistency.value + "%");
    text("ev-kpi-calories", calories.available ? F.formatNumber(calories.kcal) : "—");

    const deltaSessions = byId("ev-kpi-sessions-delta");
    if (deltaSessions) {
      let label = "primeiro período com dados";
      let neutral = true;

      if (previous && current.sessions > 0) {
        const diff = current.sessions - previous.sessions;
        label = diff === 0
          ? "mesmo ritmo do período anterior"
          : (diff > 0 ? "+" : "−") + Math.abs(diff) + " vs. período anterior";
        neutral = diff <= 0;
      } else if (previous && previous.sessions > 0 && current.sessions === 0) {
        label = previous.sessions + (previous.sessions === 1 ? " treino" : " treinos") + " no período anterior";
      }

      deltaSessions.textContent = label;
      deltaSessions.classList.toggle("is-neutral", neutral);
    }

    const deltaConsistency = byId("ev-kpi-consistency-delta");
    if (deltaConsistency) {
      if (consistency.value === null) {
        deltaConsistency.textContent = "informe dias por semana no perfil";
        deltaConsistency.classList.add("is-neutral");
      } else {
        deltaConsistency.textContent = consistency.trained + " de " + consistency.planned +
          (consistency.planned === 1 ? " dia planejado" : " dias planejados");
        deltaConsistency.classList.toggle("is-neutral", consistency.trained === 0);
      }
    }

    const deltaCalories = byId("ev-kpi-calories-delta");
    if (deltaCalories) {
      deltaCalories.textContent = calories.available
        ? "MET " + KCAL_MET + " · " + calories.minutes + " min registrados"
        : calories.reason;
      deltaCalories.classList.toggle("is-neutral", !calories.available);
    }

    text("ev-kpi-note", "Consistência = dias treinados ÷ dias planejados no perfil em " +
      periodLabel().toLowerCase() + ". Calorias são uma estimativa (MET " + KCAL_MET +
      " × seu peso declarado × duração registrada) — o FORJA não mede calorias.");
  }

  /* ------------------------------------------------------------------ */
  /* Gráfico de evolução com filtro de período                            */
  /* ------------------------------------------------------------------ */

  function bucketDates(days) {
    const now = new Date();

    if (!days) return null;

    const count = days <= 7 ? 7 : days <= 30 ? 10 : 13;
    const step = Math.ceil(days / count);
    const buckets = [];

    for (let index = count - 1; index >= 0; index -= 1) {
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - index * step, 23, 59, 59, 999);
      const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - step + 1, 0, 0, 0, 0);
      buckets.push({ start: start, end: end, label: F.metricas.formatDayMonth(start) });
    }

    return buckets;
  }

  function allTimeBuckets(records) {
    const dates = records
      .map(record => F.metricas.recordDate(record))
      .filter(Boolean)
      .sort((a, b) => a - b);

    if (dates.length === 0) return [];

    const first = F.metricas.startOfWeek(dates[0]);
    const last = F.metricas.startOfWeek(new Date());
    const totalWeeks = Math.max(1, Math.round((last - first) / (7 * 24 * 60 * 60 * 1000)) + 1);

    /* No máximo 26 colunas: acima disso a leitura vira ruído no celular. */
    const stride = Math.max(1, Math.ceil(totalWeeks / 26));
    const buckets = [];

    for (let week = 0; week < totalWeeks; week += stride) {
      const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() + week * 7 + first.getHours(), 0, 0, 0, 0);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + stride * 7 - 1, 23, 59, 59, 999);
      buckets.push({
        start: start,
        end: end,
        label: F.metricas.formatDayMonth(start),
        note: stride > 1 ? stride + " semanas" : ""
      });
    }

    return buckets.slice(-26);
  }

  function seriesFor(records) {
    const days = PERIODS[chartPeriod];
    const windowed = withinDays(records, days);
    const buckets = days ? bucketDates(days) : allTimeBuckets(windowed);

    return {
      records: windowed,
      items: buckets.map(bucket => ({
        label: bucket.label,
        note: bucket.note || "",
        value: windowed.filter(record => {
          const date = F.metricas.recordDate(record);
          return Boolean(date) && date >= bucket.start && date <= bucket.end;
        }).length
      }))
    };
  }

  function syncPeriodButtons() {
    doc.querySelectorAll(".ev-period [data-period]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-period") === chartPeriod));
    });
  }

  function renderChart() {
    const host = byId("ev-chart");
    if (!host) return;

    const records = filteredRecords();
    const windowed = withinDays(records, PERIODS[chartPeriod]);
    const summary = F.metricas.summarize(windowed);

    host.innerHTML = "";
    host.removeAttribute("data-total");

    syncPeriodButtons();

    text("ev-chart-total", summary.sessions + (summary.sessions === 1 ? " treino" : " treinos"));

    const note = byId("ev-chart-note");

    if (records.length === 0) {
      host.appendChild(F.ui.empty({
        icon: "chart",
        title: "Ainda sem treinos registrados",
        text: "Conclua um treino para ver a evolução aqui. Nada é estimado.",
        actions: [{ label: "Ir para treinos", href: "../treino/index.html" }]
      }));
      if (note) note.textContent = "O gráfico só desenha dados reais do histórico deste navegador.";
      return;
    }

    const series = seriesFor(records);

    const figure = F.charts.columns({
      items: series.items.map(item => Object.assign({}, item, {
        tone: item.value > 0 ? null : "muted"
      })),
      format: value => F.formatNumber(value),
      ariaLabel: "Treinos por período · " + periodLabel(),
      caption: periodLabel() + " · " + summary.sessions +
        (summary.sessions === 1 ? " treino no total" : " treinos no total")
    });

    if (figure) {
      figure.setAttribute("data-role", "evolucao-colunas");
      host.appendChild(figure);
      host.setAttribute("data-total", String(summary.sessions));
    }

    if (note) {
      note.textContent = summary.sessions > 0
        ? periodLabel() + ": " + summary.sessions + (summary.sessions === 1 ? " treino" : " treinos") +
          ", " + summary.trainedDays + (summary.trainedDays === 1 ? " dia treinado" : " dias treinados") +
          " e " + F.formatMinutes(Math.round(summary.durationMs / 60000)) + " de duração registrada."
        : periodLabel() + ": nenhum treino registrado nesta janela. As colunas ficam em zero porque nada foi registrado.";
    }
  }

  /*
    O período é um só para a tela: o controle do cartão do gráfico e o controle
    compacto dentro de "Grupos musculares" escrevem no mesmo estado, e os dois
    são marcados em `syncPeriodButtons()`.
  */
  function initPeriodFilter() {
    doc.querySelectorAll(".ev-period [data-period]").forEach(button => {
      button.addEventListener("click", () => {
        const value = button.getAttribute("data-period");
        if (!Object.prototype.hasOwnProperty.call(PERIODS, value)) return;
        chartPeriod = value;
        render();
      });
    });
  }

  /*
    O filtro de modalidade é do módulo de progresso. O botão dele já foi
    ligado antes daqui, então basta redesenhar os indicadores depois do clique
    — sem duplicar a lógica de filtro nem tocar no estado dele.
  */
  function initModalitySync() {
    doc.querySelectorAll("[data-filter]").forEach(button => {
      button.addEventListener("click", () => render());
    });
  }

  /* ------------------------------------------------------------------ */
  /* Grupos musculares                                                   */
  /* ------------------------------------------------------------------ */

  /*
    Cada exercício do histórico é casado com o catálogo central pelo id da
    biblioteca ou pelo nome normalizado — o treino salvo não guarda músculos.
    Sem casamento, o exercício não entra na conta: nada é deduzido de um nome
    parcial. A série concluída é o peso do grupo principal do exercício.
  */
  function muscleVolume(records) {
    const catalog = F.exerciseCatalog;

    if (!catalog) return { groups: [], series: 0, unmatched: 0 };

    const byIdMap = new Map();
    catalog.exercises.forEach(item => byIdMap.set(item.id, item));

    const totals = new Map();
    let series = 0;
    let unmatched = 0;

    records.forEach(record => {
      const exercises = Array.isArray(record.exercises) ? record.exercises : [];

      exercises.forEach(exercise => {
        const name = typeof exercise.name === "string" ? exercise.name.trim() : "";
        if (!name) return;

        const canonical = byIdMap.get(exercise.libraryId) ||
          catalog.exercises.find(item => catalog.normalizeText(item.name) === catalog.normalizeText(name));

        const sets = Number(exercise.completedSets) ||
          (Array.isArray(exercise.logs) ? exercise.logs.length : 0);

        if (!canonical) {
          unmatched += 1;
          return;
        }
        if (!(sets > 0)) return;

        series += sets;

        const entry = totals.get(canonical.primaryMuscle) || { id: canonical.primaryMuscle, sets: 0 };
        entry.sets += sets;
        totals.set(canonical.primaryMuscle, entry);
      });
    });

    const groups = Array.from(totals.values())
      .map(entry => {
        const group = catalog.groupById(entry.id);
        return {
          id: entry.id,
          name: group ? group.name : entry.id,
          sets: entry.sets,
          share: pct(entry.sets, series)
        };
      })
      .sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name, "pt-BR"));

    return { groups: groups, series: series, unmatched: unmatched };
  }

  function highlightsFor(groups) {
    const highlights = {};
    groups.slice(0, 6).forEach((group, index) => {
      const region = GROUP_TO_REGION[group.id];
      if (region && F.figura && F.figura.REGIONS[region]) {
        highlights[region] = index === 0 ? "primary" : "secondary";
      }
    });
    return highlights;
  }

  function renderFigure(groups) {
    const host = byId("ev-muscles-figure");
    if (!host) return;

    host.innerHTML = "";

    if (!F.figura || groups.length === 0) return;

    const highlights = highlightsFor(groups);
    const pair = doc.createElement("div");
    pair.className = "atlas-figuras";
    pair.setAttribute("data-role", "evolucao-musculos");

    [["front", "Vista anterior"], ["back", "Vista posterior"]].forEach(entry => {
      const cell = doc.createElement("div");
      cell.className = "atlas-figura-cell";
      cell.setAttribute("data-view", entry[0]);
      cell.appendChild(F.figura.render({
        view: entry[0],
        highlights: highlights,
        compact: true,
        label: entry[1] + ": " + groups.slice(0, 3).map(group => group.name).join(", ")
      }));
      pair.appendChild(cell);
    });

    host.appendChild(pair);
  }

  function renderMuscles() {
    const records = withinDays(filteredRecords(), PERIODS[chartPeriod]);
    const data = muscleVolume(records);
    const list = byId("ev-muscle-list");

    if (list) list.innerHTML = "";
    text("ev-muscles-total", data.series + (data.series === 1 ? " série" : " séries"));

    if (data.groups.length === 0) {
      renderFigure([]);
      if (list) {
        list.appendChild(F.ui.empty({
          icon: "target",
          title: "Nenhum grupo muscular em " + periodLabel().toLowerCase(),
          text: "Os grupos aparecem quando um exercício do catálogo é registrado com séries concluídas.",
          actions: [{ label: "Ver todo o histórico", onClick: () => { chartPeriod = "all"; render(); } }]
        }));
      }
      text("ev-muscles-note", "Nada é estimado a partir do nome do treino: só entram exercícios do catálogo com séries concluídas.");
      return;
    }

    renderFigure(data.groups);

    if (list) {
      data.groups.slice(0, 8).forEach(group => {
        const row = doc.createElement("li");
        row.className = "ev-muscle-row";
        row.setAttribute("data-group", group.id);

        const name = doc.createElement("span");
        name.className = "ev-muscle-name";
        name.textContent = group.name;

        const share = doc.createElement("span");
        share.className = "ev-muscle-share";
        share.textContent = group.share + "%";

        const bar = doc.createElement("div");
        bar.className = "ev-muscle-bar";
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", group.name + ": " + group.sets +
          (group.sets === 1 ? " série, " : " séries, ") + group.share + "% do total");

        const fill = doc.createElement("span");
        fill.style.width = Math.max(4, group.share) + "%";
        bar.appendChild(fill);

        row.append(name, share, bar);
        list.appendChild(row);
      });
    }

    text("ev-muscles-note", "Percentual sobre " + data.series +
      (data.series === 1 ? " série concluída" : " séries concluídas") +
      " em exercícios do catálogo, " + periodLabel().toLowerCase() + "." +
      (data.unmatched > 0
        ? " " + data.unmatched + (data.unmatched === 1
          ? " exercício sem correspondência no catálogo ficou fora da conta."
          : " exercícios sem correspondência no catálogo ficaram fora da conta.")
        : ""));
  }

  /* ------------------------------------------------------------------ */
  /* Mensagem de incentivo                                               */
  /* ------------------------------------------------------------------ */

  function renderNudge() {
    const records = filteredRecords();
    const all = F.metricas.summarize(records);
    const week = weekSummary(records);
    const goals = typeof F.normalizeGoals === "function" ? F.normalizeGoals(F.state.goals) : null;
    const goalSessions = goals ? Number(goals.weeklySessions) || 0 : 0;

    let title = "Seu progresso começa no primeiro treino";
    let body = "Registre um treino para ver treinos, consistência e grupos musculares calculados com dados reais.";

    if (all.sessions > 0 && goalSessions > 0) {
      const remaining = goalSessions - week.sessions;

      if (remaining > 0) {
        title = "Faltam " + remaining + (remaining === 1 ? " treino" : " treinos") + " para a meta da semana";
        body = "Você fez " + week.sessions + " de " + goalSessions + " treinos nesta semana. O próximo registro conta aqui.";
      } else {
        title = "Meta da semana batida";
        body = week.sessions + " de " + goalSessions + " treinos concluídos nesta semana, " + all.sessions + " no histórico.";
      }
    } else if (all.sessions > 0 && week.sessions > 0) {
      title = week.sessions + (week.sessions === 1 ? " treino nesta semana" : " treinos nesta semana");
      body = "Defina uma meta semanal na aba Visão Geral para acompanhar o quanto falta.";
    } else if (all.sessions > 0) {
      title = all.lastDate
        ? "Último treino em " + F.metricas.formatDayMonth(all.lastDate)
        : "Nenhum treino nesta semana";
      body = "Nenhum treino nesta semana ainda. Um treino já muda o calendário de frequência.";
    }

    text("ev-nudge-title", title);
    text("ev-nudge-text", body);
  }

  /* ------------------------------------------------------------------ */
  /* Ciclo de renderização                                               */
  /* ------------------------------------------------------------------ */

  /*
    Todas as peças leem o estado atual; a aba ativa continua na tela, o filtro
    de modalidade e o período do histórico continuam com `forja-progresso.js`.
  */
  function render() {
    renderKpis();
    renderChart();
    renderMuscles();
    renderNudge();
  }

  /*
    Entra no ciclo do app como uma página a mais: `F.pages.progresso` já é do
    módulo de progresso e roda antes (resumo, metas, recordes, histórico,
    evolução por exercício). Os controles só podem ser ligados depois do boot,
    porque é ali que o DOM e o estado estão prontos.
  */
  const initProgressoAnterior = F.pages.progresso;

  F.pages.progresso = function initPaginaProgresso() {
    if (typeof initProgressoAnterior === "function") initProgressoAnterior();

    hydrateIcons();
    initTabs();
    initPeriodFilter();
    initModalitySync();
    render();

    if (typeof F.onDataChanged === "function") {
      F.onDataChanged(() => render());
    }
  };

  F.evolucao = {
    showTab,
    render,
    periodLabel,
    muscleVolume,
    highlightsFor,
    caloriesFor,
    consistencyFor,
    seriesFor,
    currentTab: () => activeTab,
    chartPeriod: () => chartPeriod,
    setChartPeriod: value => {
      if (!Object.prototype.hasOwnProperty.call(PERIODS, value)) return;
      chartPeriod = value;
      render();
    }
  };

})(window);
