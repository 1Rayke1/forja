/*
  FORJA — página inicial (index.html).

  A home tem duas responsabilidades:

  1. Preservar o que já existia: calendário, missões e o atalho para a área de
     treino continuam sendo o código de `forja-calendario.js`, chamado aqui sem
     alterações (o arquivo é travado por hash nas suítes).
  2. Complementar com um painel de treino que só mostra dado real:
     - resumo da semana corrente (treinos, séries, tempo e metas);
     - suas rotinas (calistenia e musculação) para abrir ou iniciar agora;
     - histórico recente com data, modalidade, rotina e status;
     - orientação curta para quem ainda não tem rotina nem histórico.

  Regras deste módulo, deliberadas:

  - Nenhuma gravação ao abrir, navegar ou redesenhar. Só há escrita quando o
    usuário aperta "Iniciar treino" — e a escrita é a sessão ativa, feita por
    `F.startRoutine` (módulo de sessão), não por este arquivo.
  - Toda conta vem de `F.metricas` (módulo puro). Nada é recalculado aqui: o
    resumo semanal é `summarize(filterByPeriod(...))` e as metas são
    `goalProgress`, exatamente como na página de Progresso.
  - Ausência de dado não vira zero: tempo sem registro aparece como "—" e a
    tela diz o motivo; "0 treinos nesta semana" só aparece quando o histórico
    existe e a semana está realmente vazia.
  - O modelo não guarda "rotina programada para hoje". Por isso a seção se
    chama "Próximo treino" e explica que a escolha é do usuário — não existe
    treino do dia inventado.
  - Todo texto do usuário entra por `textContent` (nunca HTML concatenado).
  - Nenhum temporizador é criado aqui: o único intervalo do app continua em
    `forja-app.js`.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const MODALITIES = ["calisthenics", "weights"];
  const RECENT_LIMIT = 5;
  const ROUTINES_PER_MODALITY = 3;

  /* ------------------------------------------------------------------ */
  /* Utilitários                                                         */
  /* ------------------------------------------------------------------ */

  function make(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function byIdSafe(id) {
    return doc.getElementById(id);
  }

  function records() {
    const list = Array.isArray(F.state.history) ? F.state.history : [];
    return list.filter(record => F.isPlainObject(record));
  }

  function routinesOf(modality) {
    const store = F.state.routines;
    const list = store && Array.isArray(store[modality]) ? store[modality] : [];
    return list.filter(routine => F.isPlainObject(routine) && typeof routine.name === "string");
  }

  function totalRoutineCount() {
    return MODALITIES.reduce((sum, modality) => sum + routinesOf(modality).length, 0);
  }

  function exerciseCount(routine) {
    return F.SECTION_ORDER.reduce((sum, section) => {
      const list = routine.sections && Array.isArray(routine.sections[section])
        ? routine.sections[section]
        : [];
      return sum + list.length;
    }, 0);
  }

  /*
    Data de um registro, sem inventar: usa `F.metricas.recordDate` (finishedAt
    válido, senão `date`). Registro sem data legível vai para o fim da lista.
  */
  function sortedByDateDesc(list) {
    return list.slice().sort((a, b) => {
      const dateA = F.metricas.recordDate(a);
      const dateB = F.metricas.recordDate(b);

      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateB - dateA;
    });
  }

  function timeText(summary) {
    if (!summary || !(summary.durationMs > 0)) return null;
    const minutes = Math.round(summary.durationMs / 60000);
    return minutes < 1 ? "< 1 min" : F.formatMinutes(minutes);
  }

  function statusLabel(record) {
    return record.status === "completed" ? "Concluído" : "Parcial";
  }

  function linkButton(label, href, className) {
    const link = make("a", className || "secondary-button", label);
    link.href = href;
    return link;
  }

  function button(label, className, onClick) {
    const node = make("button", className || "secondary-button", label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  function emptyCard(options) {
    if (F.ui && typeof F.ui.empty === "function") return F.ui.empty(options);

    const card = make("div", "home-empty");
    card.appendChild(make("strong", "home-empty-title", options.title));
    if (options.text) card.appendChild(make("p", "home-empty-text", options.text));
    return card;
  }

  /* ------------------------------------------------------------------ */
  /* A. Resumo real da semana                                            */
  /* ------------------------------------------------------------------ */

  function weekSnapshot(now) {
    const today = now instanceof Date ? now : new Date();
    const week = F.metricas.resolvePeriod("week", { now: today });
    const history = records();

    return {
      week,
      hasHistory: history.length > 0,
      summary: F.metricas.summarize(F.metricas.filterByPeriod(history, week)),
      goals: F.metricas.goalProgress(history, F.state.goals, { now: today })
    };
  }

  function renderWeekGoals(goals) {
    const block = make("div", "home-goals");

    if (!goals || !goals.active) {
      block.appendChild(make("h3", "home-subtitle", "Metas da semana"));
      block.appendChild(make(
        "p",
        "home-note",
        "Nenhuma meta configurada. Você pode definir treinos, séries ou minutos por semana no Progresso."
      ));

      const actions = make("div", "home-actions");
      actions.appendChild(linkButton("Definir metas semanais", F.url("progresso"), "secondary-button small-button"));
      block.appendChild(actions);
      return block;
    }

    block.appendChild(make("h3", "home-subtitle", "Metas da semana"));

    const active = goals.items.filter(item => item.active);
    const met = active.filter(item => item.met).length;

    active.forEach(item => {
      const row = make("div", "home-goal");
      const head = make("div", "home-goal-head");
      head.appendChild(make("span", "home-goal-label", item.label));
      head.appendChild(make(
        "strong",
        "home-goal-value",
        item.current + "/" + item.target
      ));

      row.appendChild(head);

      if (F.ui && typeof F.ui.progressBar === "function") {
        row.appendChild(F.ui.progressBar(item.percent, item.label + " da semana"));
      }

      row.appendChild(make(
        "p",
        "home-goal-note",
        item.met
          ? "Meta batida nesta semana."
          : "Faltam " + item.remaining + " " + goalUnit(item.unit, item.remaining)
      ));

      block.appendChild(row);
    });

    block.appendChild(make(
      "p",
      "home-note",
      met + " de " + active.length + " meta(s) batida(s) nesta semana · escopo: " +
        (goals.modality === "all" ? "todas as modalidades" : F.MODE_NAMES[goals.modality])
    ));

    return block;
  }

  function goalUnit(unit, count) {
    if (unit === "sessions") return count === 1 ? "treino" : "treinos";
    if (unit === "sets") return count === 1 ? "série" : "séries";
    return count === 1 ? "minuto" : "minutos";
  }

  function renderWeek() {
    const body = byIdSafe("home-week-body");
    const range = byIdSafe("home-week-range");
    if (!body) return;

    const snapshot = weekSnapshot();
    const { week, summary, goals } = snapshot;

    if (range) {
      range.textContent = "Semana de " +
        F.metricas.formatDayMonth(week.from) + " a " +
        F.metricas.formatDayMonth(week.to) + " · segunda a domingo.";
    }

    body.innerHTML = "";

    if (!snapshot.hasHistory) {
      body.appendChild(emptyCard({
        icon: "chart",
        title: "Nenhum treino registrado ainda",
        text: "Quando você concluir ou encerrar uma sessão, os números da semana aparecem aqui. " +
          "Não existe dado de exemplo: o painel começa vazio.",
        actions: [{ label: "Começar um treino", href: F.url("treino"), icon: "play" }]
      }));

      /*
        Metas aparecem mesmo sem histórico: se existem, o progresso é zero
        real; se não existem, a linha curta diz onde defini-las. Nenhuma meta
        padrão é criada e nenhum número é exibido no lugar do vazio.
      */
      body.appendChild(renderWeekGoals(goals));
      return;
    }

    const time = timeText(summary);
    const stats = [
      { value: String(summary.sessions), label: "treinos", hint: summary.partial > 0 ? summary.partial + " parcial(is)" : null },
      { value: String(summary.sets), label: "séries", hint: null },
      { value: time === null ? "—" : time, label: "tempo", hint: time === null ? "sem tempo registrado" : null }
    ];

    if (summary.hasVolume) {
      stats.push({ value: F.formatKg(summary.volumeKg), label: "volume", hint: null, tone: "accent" });
    }

    if (F.ui && typeof F.ui.statRow === "function") {
      body.appendChild(F.ui.statRow(stats, "home-week-stats"));
    }

    if (summary.sessions === 0) {
      const empty = make("p", "home-note home-week-empty",
        "Nenhum treino nesta semana ainda. O histórico existe, mas nenhum registro cai entre " +
        F.metricas.formatDayMonth(week.from) + " e " + F.metricas.formatDayMonth(week.to) + ".");
      body.appendChild(empty);
    } else {
      body.appendChild(make(
        "p",
        "home-note",
        F.pluralize(summary.sessions, "treino", "treinos") + " nesta semana · " +
          F.pluralize(summary.sets, "série", "séries") + " registradas."
      ));
    }

    body.appendChild(renderWeekGoals(goals));
  }

  /* ------------------------------------------------------------------ */
  /* B. Próximo treino (rotinas reais)                                   */
  /* ------------------------------------------------------------------ */

  /*
    Última vez que cada rotina apareceu no histórico. Usa `routineId` (campo
    gravado desde a etapa 2); registros antigos sem id são associados pelo
    nome exato da rotina. Nada é criado quando não há registro.
  */
  function lastUseByRoutine(history) {
    const map = new Map();

    history.forEach(record => {
      const date = F.metricas.recordDate(record);
      if (!date) return;

      const keys = [];

      if (typeof record.routineId === "string" && record.routineId) {
        keys.push(record.modality + "|id|" + record.routineId);
      }
      if (typeof record.routineName === "string" && record.routineName) {
        keys.push(record.modality + "|name|" + record.routineName);
      }

      keys.forEach(key => {
        const current = map.get(key);
        if (!current || date > current) map.set(key, date);
      });
    });

    return map;
  }

  function lastUsedFor(map, modality, routine) {
    const byId = map.get(modality + "|id|" + routine.id);
    if (byId) return byId;
    return map.get(modality + "|name|" + routine.name) || null;
  }

  function lastUsedText(date) {
    if (!date) return "Ainda não treinada";
    const relative = F.relativeDayText(date);
    return "Última vez: " + relative;
  }

  function routineCard(modality, routine, lastUsed) {
    const item = make("li", "home-routine");
    item.setAttribute("data-home-routine", routine.id);
    item.setAttribute("data-modality", modality);

    const main = make("div", "home-routine-main");
    main.appendChild(make("strong", "home-routine-name", routine.name));

    const totalExercises = exerciseCount(routine);
    const totalSets = typeof F.getRoutineTotalSets === "function" ? F.getRoutineTotalSets(routine) : 0;

    main.appendChild(make(
      "span",
      "home-routine-meta",
      totalExercises === 0
        ? "Sem exercícios ainda"
        : F.pluralize(totalExercises, "exercício", "exercícios") + " · " +
          F.pluralize(totalSets, "série", "séries") + " planejadas"
    ));
    main.appendChild(make("span", "home-routine-history", lastUsedText(lastUsed)));

    const actions = make("div", "home-routine-actions");

    const start = button(
      totalExercises === 0 ? "Adicione exercícios" : "Iniciar treino",
      "primary-button",
      () => F.startRoutine(modality, routine.id)
    );
    start.disabled = totalExercises === 0;

    actions.appendChild(start);
    actions.appendChild(linkButton(
      "Abrir rotina",
      F.url("rotina", { modalidade: modality, id: routine.id }),
      "secondary-button"
    ));

    item.append(main, actions);
    return item;
  }

  function activeSessionCard(session) {
    const card = make("div", "home-active-session");
    card.setAttribute("data-home-active", "1");

    card.appendChild(make("span", "eyebrow", "Sessão em andamento"));
    card.appendChild(make("strong", "home-active-name", session.routineName || "Treino"));
    card.appendChild(make(
      "p",
      "home-note",
      (F.MODE_NAMES[session.modality] || "Treino") +
        (session.running === false ? " · pausada" : " · em andamento") +
        ". Retome de onde parou — as séries já registradas continuam lá."
    ));

    const actions = make("div", "home-actions");
    actions.appendChild(linkButton("Retomar sessão", F.url("executar"), "primary-button"));
    actions.appendChild(linkButton("Encerrar", F.url("executar", { encerrar: "1" }), "secondary-button"));
    card.appendChild(actions);

    return card;
  }

  function renderNext() {
    const body = byIdSafe("home-next-body");
    if (!body) return;

    const session = F.state.activeWorkout;
    const history = records();
    const lastUse = lastUseByRoutine(history);
    const routines = {};
    MODALITIES.forEach(modality => { routines[modality] = routinesOf(modality); });

    const total = routines.calisthenics.length + routines.weights.length;

    body.innerHTML = "";

    if (session && session.routineName) {
      body.appendChild(activeSessionCard(session));
    }

    body.appendChild(make("p", "home-note", total > 0
      ? "O FORJA não agenda um treino por dia: estas são as suas rotinas cadastradas, " +
        "com a mais recentemente treinada primeiro. Escolha uma para começar agora."
      : "O FORJA não agenda um treino por dia. Crie uma rotina para começar."));

    if (total === 0) {
      body.appendChild(emptyCard({
        icon: "dumbbell",
        title: "Nenhuma rotina cadastrada",
        text: "Escolha uma modalidade, toque em “+ Nova rotina” e monte aquecimento, treino " +
          "principal, abdômen e finalizador. Depois o treino começa por aqui.",
        actions: [
          { label: "Criar rotina de calistenia", href: F.url("calistenia") },
          { label: "Criar rotina de musculação", href: F.url("musculacao") }
        ]
      }));
      return;
    }

    MODALITIES.forEach(modality => {
      const list = routines[modality];
      if (list.length === 0) return;

      body.appendChild(make("h3", "home-subtitle", F.MODE_NAMES[modality]));

      const ordered = list.slice().sort((a, b) => {
        const dateA = lastUsedFor(lastUse, modality, a);
        const dateB = lastUsedFor(lastUse, modality, b);
        const timeA = dateA ? dateA.getTime() : -1;
        const timeB = dateB ? dateB.getTime() : -1;
        if (timeA !== timeB) return timeB - timeA;
        return String(a.name).localeCompare(String(b.name), "pt-BR");
      });

      const visible = ordered.slice(0, ROUTINES_PER_MODALITY);
      const ul = make("ul", "home-routine-list");

      visible.forEach(routine => {
        ul.appendChild(routineCard(modality, routine, lastUsedFor(lastUse, modality, routine)));
      });

      body.appendChild(ul);

      if (ordered.length > visible.length) {
        const more = make("div", "home-actions");
        more.appendChild(linkButton(
          "Ver todas as " + ordered.length + " rotinas de " + F.MODE_NAMES[modality].toLowerCase(),
          F.url(F.MODE_PAGES[modality]),
          "secondary-button small-button"
        ));
        body.appendChild(more);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* C. Histórico recente                                                */
  /* ------------------------------------------------------------------ */

  function renderRecent() {
    const body = byIdSafe("home-recent-body");
    if (!body) return;

    const history = sortedByDateDesc(records());
    body.innerHTML = "";

    if (history.length === 0) {
      body.appendChild(emptyCard({
        icon: "history",
        title: "Nenhum treino registrado",
        text: "Cada sessão encerrada vira um registro com data, rotina e status. " +
          "Nada é criado por você abrir esta página.",
        actions: [{ label: "Ver área de treino", href: F.url("treino") }]
      }));
      return;
    }

    const list = make("ul", "home-history-list");

    history.slice(0, RECENT_LIMIT).forEach(record => {
      const item = make("li", "home-history-item");
      item.setAttribute("data-home-history", record.id || "record");

      const head = make("div", "home-history-head");
      head.appendChild(make("strong", "home-history-name", record.routineName || "Treino"));

      const status = make(
        "span",
        "history-status " + (record.status === "completed" ? "completed" : "partial"),
        statusLabel(record)
      );
      head.appendChild(status);

      const meta = make("div", "home-history-meta");
      const modality = F.MODE_NAMES[record.modality] || "Modalidade não registrada";
      meta.textContent = F.metricas.formatRecordDate(record) + " · " + modality;

      const sets = make("div", "home-history-meta");
      const completed = Number(record.completedSets);
      const planned = Number(record.totalPlannedSets);
      sets.textContent = (Number.isFinite(completed) ? completed : 0) + "/" +
        (Number.isFinite(planned) ? planned : 0) + " séries" +
        (record.durationMs > 0 ? " · " + F.formatDurationLong(record.durationMs) : "");

      item.append(head, meta, sets);
      list.appendChild(item);
    });

    body.appendChild(list);

    if (history.length > RECENT_LIMIT) {
      body.appendChild(make(
        "p",
        "home-note",
        "Mostrando os " + RECENT_LIMIT + " mais recentes de " +
          F.pluralize(history.length, "treino registrado", "treinos registrados") + "."
      ));
    }
  }

  /* ------------------------------------------------------------------ */
  /* D. Orientação para novos usuários                                   */
  /* ------------------------------------------------------------------ */

  function renderGuide() {
    const section = byIdSafe("home-guide");
    if (!section) return;

    const body = byIdSafe("home-guide-body");
    if (!body) return;

    const hasHistory = records().length > 0;
    const hasRoutines = totalRoutineCount() > 0;

    body.innerHTML = "";

    /* Com histórico a orientação já cumpriu o papel: sai da tela. */
    if (hasHistory) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    if (hasRoutines) {
      body.appendChild(make(
        "p",
        "home-note",
        "Suas rotinas estão prontas. Inicie um treino para ver o resumo da semana e o " +
          "histórico aparecerem aqui — eles só mostram o que foi realmente registrado."
      ));
      const actions = make("div", "home-actions");
      actions.appendChild(linkButton("Abrir minhas rotinas", F.url("treino"), "primary-button"));
      body.appendChild(actions);
      return;
    }

    const steps = make("ol", "home-steps");
    [
      ["Escolha a modalidade", "Calistenia usa peso corporal; musculação usa cargas. As rotinas e o histórico ficam separados."],
      ["Crie a primeira rotina", "Na modalidade, toque em “+ Nova rotina” e organize aquecimento, treino principal, abdômen e finalizador."],
      ["Inicie o treino", "A sessão registra séries, tempo e descanso. Ao encerrar, o resumo da semana e o histórico aparecem aqui."]
    ].forEach(([title, text]) => {
      const li = make("li", "home-step");
      li.appendChild(make("strong", "home-step-title", title));
      li.appendChild(make("span", "home-step-text", text));
      steps.appendChild(li);
    });
    body.appendChild(steps);

    body.appendChild(make(
      "p",
      "home-note",
      "Nada é obrigatório: o FORJA não pede perfil, cadastro nem dados pessoais. " +
        "Rotinas, histórico e metas ficam salvas apenas neste navegador."
    ));

    const actions = make("div", "home-actions");
    actions.appendChild(linkButton("Começar pela calistenia", F.url("calistenia"), "primary-button"));
    actions.appendChild(linkButton("Começar pela musculação", F.url("musculacao"), "secondary-button"));
    body.appendChild(actions);
  }

  /* ------------------------------------------------------------------ */
  /* Inicialização                                                       */
  /* ------------------------------------------------------------------ */

  function renderDashboard() {
    renderWeek();
    renderNext();
    renderRecent();
    renderGuide();
  }

  function renderHome() {
    /* Calendário e missões: código existente, chamado sem alterações. */
    if (typeof global.renderCalendar === "function") global.renderCalendar();
    if (typeof global.renderMissions === "function") global.renderMissions();

    renderDashboard();
  }

  /*
    Redesenho sem gravar: qualquer escrita feita pelo store (dentro ou fora da
    home) atualiza o painel. Nenhum ouvinte chama `saveJSON`.
  */
  function watchStore() {
    if (!F.store || typeof F.store.onChange !== "function") return;

    F.store.onChange(key => {
      if (!F.pageName || F.pageName() !== "inicio") return;
      if (key && [
        F.KEYS.routines,
        F.KEYS.history,
        F.KEYS.active,
        F.KEYS.goals,
        F.KEYS.legacyExercises
      ].indexOf(key) === -1) {
        return;
      }
      renderDashboard();
    });
  }

  F.pages = F.pages || {};
  F.pages.inicio = function initInicio() {
    if (typeof global.updateTodayLabel === "function") global.updateTodayLabel();
    renderHome();
  };

  /* Recarga de dados do backup e desfazer continuam redesenhando a home. */
  F.onDataChanged(renderHome);

  watchStore();

  /*
    Superfície mínima para testes e para depuração: redesenha a partir do
    estado atual, sem tocar no armazenamento.
  */
  F.home = {
    refresh: renderDashboard,
    snapshot: weekSnapshot,
    limits: { recent: RECENT_LIMIT, routinesPerModality: ROUTINES_PER_MODALITY }
  };
})(window);
