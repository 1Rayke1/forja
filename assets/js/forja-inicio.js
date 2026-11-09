/*
  FORJA — página inicial (painel central).

  Hierarquia (a mesma da referência visual aprovada):

  1. saudação personalizada ("Olá, Nome!" ou a versão neutra);
  2. treino do dia — cartão grande com a rotina real, exercícios, tempo
     estimado, imagem de contexto e o botão que inicia o fluxo existente;
  3. quatro indicadores calculados a partir do histórico real;
  4. seu progresso — gráfico de uma métrica consistente + conquista real;
  5. explore o FORJA — atalhos que só existem quando há destino real;
  6. blocos secundários herdados (semana, metas, último treino, calendário
     e missões) continuam vivos abaixo, sem competir com o topo.

  Regras inegociáveis deste módulo:

  - Nenhum número inventado: indicador sem base mostra "—" e diz o que falta;
    estimativa (calorias) sempre identificada como estimativa;
  - nenhuma escrita no armazenamento por simples abertura da Home
    (`expectedWrites` da suíte depende disso);
  - uma única ação principal (`#home-primary-button`), que é o Iniciar real
    ou o caminho de criação quando ainda não há rotina;
  - com sessão ativa a ação some e a única via é o banner "Retomar";
  - o nome vem do perfil (`forja-perfil-v1` → `nomeExibicao`), nunca fixo;
  - nada de emoji decorativo em conteúdo de dados: ícones são SVG do sistema.
*/
(function (global) {
  "use strict";

  var F = global.Forja;
  var doc = global.document;

  /* Metros equivalentes usados só na estimativa de calorias (identificada). */
  var KCAL_MET_STRENGTH = 5.0;
  var KCAL_EXPLAIN = "Estimativa: MET 5,0 × peso declarado × duração registrada.";
  var STRENGTH_DAYS = 30;
  var RECORD_FRESH_DAYS = 14;

  function byId(id) { return doc.getElementById(id); }

  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function icon(name, extraClass) {
    if (F.ui && typeof F.ui.icon === "function") return F.ui.icon(name, extraClass);
    var span = el("span", "ui-icon" + (extraClass ? " " + extraClass : ""));
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  function clear(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function history() {
    return (F.state && Array.isArray(F.state.history)) ? F.state.history : [];
  }

  function profile() {
    return (F.state && F.isPlainObject(F.state.profile)) ? F.state.profile : {};
  }

  function hasActiveSession() {
    return Boolean(F.state && F.state.activeWorkout);
  }

  function modeName(modality) {
    return (F.MODE_NAMES && F.MODE_NAMES[modality]) || modality || "";
  }

  /* ------------------------------------------------------------------ */
  /* Rotinas: leitura e próxima da sequência                             */
  /* ------------------------------------------------------------------ */

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

  function routineExercises(routine) {
    try {
      return typeof F.flattenRoutine === "function" ? F.flattenRoutine(routine) : [];
    } catch (e) {
      return [];
    }
  }

  function startableRoutines() {
    if (typeof F.getStartableRoutines === "function") return F.getStartableRoutines();
    return allRoutines().filter(function (routine) {
      return routineExerciseCount(routine) > 0;
    });
  }

  function nextRoutine() {
    if (typeof F.resolveNextRoutine === "function") return F.resolveNextRoutine();
    var list = startableRoutines();
    return list.length > 0 ? list[0] : null;
  }

  function routineTotalSets(routine) {
    try {
      return F.getRoutineTotalSets ? F.getRoutineTotalSets(routine) : 0;
    } catch (e) {
      return 0;
    }
  }

  /*
    Estimativa de duração a partir dos dados da própria rotina: cada série
    consome o tempo previsto (cronômetro do exercício ou repetições × ~3 s,
    mínimo de 20 s) e os descansos entre séries. Arredonda para 5 min e nunca
    promete precisão: a tela mostra "~ N min".
  */
  function estimateMinutes(routine) {
    var exercises = routineExercises(routine);
    if (exercises.length === 0) return 0;

    var totalSeconds = 0;

    exercises.forEach(function (exercise) {
      var sets = Math.max(1, Number(exercise.sets) || 1);
      var rest = Math.max(0, Number(exercise.rest) || 0);
      var work;

      if (exercise.type === "duration") {
        work = Math.max(10, Number(exercise.duration) || 0);
      } else {
        var reps = typeof F.parseMaxReps === "function"
          ? (F.parseMaxReps(exercise.reps) || 10)
          : 10;
        work = Math.max(20, reps * 3);
      }

      totalSeconds += sets * work + Math.max(0, sets - 1) * rest;
    });

    /* Transições entre exercícios (10 s cada) fazem parte do treino real. */
    totalSeconds += Math.max(0, exercises.length - 1) * 10;

    return Math.max(5, Math.round(totalSeconds / 60 / 5) * 5);
  }

  /* ------------------------------------------------------------------ */
  /* Saudação                                                            */
  /* ------------------------------------------------------------------ */

  function displayName() {
    if (typeof F.displayNameOf === "function") {
      try {
        return F.displayNameOf(profile());
      } catch (e) {
        return "";
      }
    }
    return "";
  }

  function renderGreeting() {
    var title = byId("home-title");
    var subtitle = byId("home-subtitle");
    if (!title || !subtitle) return;

    var name = displayName();

    /* Sem nome cadastrado a saudação é neutra — nunca um nome de exemplo. */
    title.textContent = name ? "Olá, " + name + "!" : "Olá!";
    subtitle.textContent = "Hora de evoluir ainda mais.";
    title.setAttribute("aria-label", name ? "Olá, " + name : "Olá");
  }

  /* ------------------------------------------------------------------ */
  /* Treino do dia                                                       */
  /* ------------------------------------------------------------------ */

  /*
    A foto é contexto da modalidade (nunca anunciada como execução do treino):
    fica de fundo, com máscara, e o crédito é devolvido para o cartão exibir
    fora da área mascarada.
  */
  function attachPhoto(host, routine) {
    if (!host || !routine) return "";
    if (!F.fotos || typeof F.fotos.forModality !== "function") return "";

    var photo = null;
    try {
      photo = F.fotos.forModality(routine.modality);
    } catch (e) {
      photo = null;
    }
    if (!photo) return "";

    var img = doc.createElement("img");
    img.className = "home-today-photo";
    img.src = photo.fontes[photo.fontes.length - 1].url;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.setAttribute("decoding", "async");
    img.setAttribute("loading", "lazy");
    img.width = photo.largura;
    img.height = photo.altura;

    img.addEventListener("error", function () {
      if (img.parentNode) img.parentNode.removeChild(img);
      host.classList.add("sem-foto");
    });

    host.appendChild(img);

    /* Crédito visível da fotografia (mesma regra da tela Explorar). */
    if (typeof F.fotos.creditLine === "function") {
      try {
        return F.fotos.creditLine(photo);
      } catch (e) {
        return "";
      }
    }
    return "";
  }

  function renderAction() {
    var container = byId("home-action");
    if (!container) return;

    clear(container);
    container.hidden = false;
    container.removeAttribute("hidden");

    if (hasActiveSession()) {
      /* Com sessão ativa a Home não oferece outro treino: o banner é a via. */
      container.hidden = true;
      container.setAttribute("hidden", "");
      return;
    }

    var startable = startableRoutines();
    var routine = nextRoutine();
    var savedRoutines = allRoutines();
    var pendingEmpty = !routine && savedRoutines.length > 0 ? savedRoutines[0] : null;

    var card = el("article", "home-action-card home-today" + (routine ? " is-ready" : " is-empty"));

    var main = el("div", "home-today-main");

    var eyebrow = el("p", "home-action-eyebrow");
    eyebrow.appendChild(icon(routine ? "calendar" : "plus", "home-action-eyebrow-icon"));
    eyebrow.appendChild(doc.createTextNode(routine ? "Treino do dia" : "Comece por aqui"));
    main.appendChild(eyebrow);

    var title = el("h2", "home-action-title", "");
    title.id = "home-action-heading";
    main.appendChild(title);

    var meta = el("p", "home-action-meta", "");
    main.appendChild(meta);

    if (routine) {
      title.textContent = routine.name;

      var total = routineExerciseCount(routine);
      var minutes = estimateMinutes(routine);

      meta.appendChild(icon("dumbbell", "home-action-meta-icon"));
      meta.appendChild(doc.createTextNode(
        (total === 1 ? "1 exercício" : total + " exercícios") +
        " · " + modeName(routine.modality)
      ));

      var time = el("span", "home-action-time");
      time.appendChild(icon("clock", "home-action-meta-icon"));
      time.appendChild(doc.createTextNode(minutes ? "~ " + minutes + " min" : "sem estimativa"));
      meta.appendChild(time);

      if (minutes) {
        time.title = "Estimativa: " + routineTotalSets(routine) + " série(s) da rotina, " +
          "com o tempo previsto de cada exercício e os descansos entre séries.";
        time.setAttribute("aria-label", "Duração estimada: cerca de " + minutes + " minutos");
      }
    } else if (pendingEmpty) {
      title.textContent = pendingEmpty.name;
      meta.textContent = modeName(pendingEmpty.modality) +
        " · A rotina ainda não tem exercícios. Adicione ao menos um para poder iniciar.";
    } else {
      /* Estado vazio (título estável para compatibilidade com a suíte). */
      title.textContent = "Monte sua primeira rotina";
      meta.textContent = "Seu treino de hoje ainda não está definido. Organize sua rotina e prepare seu próximo treino.";
    }

    card.appendChild(main);

    if (routine || pendingEmpty) {
      var media = el("div", "home-today-media" + (routine ? "" : " is-empty"));
      media.setAttribute("aria-hidden", "true");
      var credit = routine ? attachPhoto(media, routine) : "";
      card.appendChild(media);
      if (credit) card.appendChild(el("span", "home-today-credit", credit));
    }

    /* Seta de acesso ao treino (o cartão inteiro leva para Treinos). */
    var open = doc.createElement("a");
    open.className = "home-today-open";
    open.href = F.url("treino");
    open.setAttribute("aria-label", routine
      ? "Abrir " + routine.name + " em Treinos"
      : "Abrir Treinos");
    open.appendChild(icon("chevron-right"));
    card.appendChild(open);

    var button;
    if (routine) {
      button = doc.createElement("button");
      button.type = "button";
      button.textContent = "Iniciar " + routine.name;
      button.setAttribute("aria-label", "Iniciar treino " + routine.name);
      button.addEventListener("click", function () {
        if (F.startRoutine) F.startRoutine(routine.modality, routine.id);
      });
    } else if (pendingEmpty) {
      button = doc.createElement("a");
      button.href = F.url("rotina", { modalidade: pendingEmpty.modality, id: pendingEmpty.id });
      button.textContent = "Adicionar exercícios";
      button.setAttribute("aria-label", "Adicionar exercícios em " + pendingEmpty.name);
    } else {
      button = doc.createElement("a");
      button.href = F.url("treino");
      button.textContent = "Montar meu treino";
      button.setAttribute("aria-label", "Montar meu treino");
    }

    button.classList.add("home-action-button", "treino-square");
    button.id = "home-primary-button";

    if (routine) {
      /* Ícone de play antes do rótulo, como na referência. */
      button.insertBefore(icon("play", "home-action-play"), button.firstChild);
    }

    card.appendChild(button);

    if (routine) {
      var hint = el("p", "home-action-hint", "");
      var index = startable.findIndex(function (item) { return item.id === routine.id; });
      hint.textContent = startable.length > 1
        ? "Próxima da sequência (" + (index + 1) + " de " + startable.length + "). Você pode escolher outra em Treinos."
        : "Sua rotina está pronta. Você pode criar ou escolher outra em Treinos.";
      card.appendChild(hint);
    } else if (pendingEmpty) {
      card.appendChild(el("p", "home-action-hint",
        "A rotina existe, mas ainda não pode ser iniciada sem exercícios."));
    } else {
      card.appendChild(el("p", "home-action-hint",
        "Crie treinos de calistenia ou musculação e comece quando quiser."));
    }

    container.appendChild(card);
  }

  /* ------------------------------------------------------------------ */
  /* Indicadores de desempenho                                           */
  /* ------------------------------------------------------------------ */

  function daysAgo(days) {
    var date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - days);
    return date;
  }

  /* Minutos de uma sessão: `recordMetrics` já normaliza a duração em ms. */
  function recordMinutes(record) {
    var metrics = null;
    try {
      metrics = F.metricas.recordMetrics(record);
    } catch (e) {
      metrics = null;
    }
    if (metrics) return Math.round(Number(metrics.durationMs || 0) / 60000);
    return Math.round((Number(record.durationMs) || 0) / 60000);
  }

  function recordTime(record) {
    if (F.metricas && typeof F.metricas.recordDate === "function") {
      var date = F.metricas.recordDate(record);
      if (date) return date.getTime();
    }
    return null;
  }

  /* Maior carga numérica registrada dentro de uma janela (kg, já convertida). */
  function bestLoadWithin(records, from, to) {
    var best = 0;

    records.forEach(function (record) {
      var time = recordTime(record);
      if (time === null) return;
      if (from && time < from.getTime()) return;
      if (to && time >= to.getTime()) return;

      var metrics = null;
      try {
        metrics = F.metricas.recordMetrics(record);
      } catch (e) {
        metrics = null;
      }
      if (!metrics) return;

      if (metrics.best && metrics.best.loadKg > best) best = metrics.best.loadKg;
    });

    return best;
  }

  /*
    Evolução de força: maior carga registrada nos últimos 30 dias comparada à
    maior carga dos 30 dias anteriores. Mesma unidade (kg), mesma regra de
    conversão do Progresso. Sem carga numérica nas duas janelas o indicador
    fica "—" em vez de um percentual inventado.
  */
  function strengthEvolution(records) {
    var from = daysAgo(STRENGTH_DAYS);
    var before = daysAgo(STRENGTH_DAYS * 2);
    var current = bestLoadWithin(records, from, null);
    var previous = bestLoadWithin(records, before, from);

    if (!(current > 0) || !(previous > 0)) {
      return { available: false, current: current, previous: previous, percent: null };
    }

    return {
      available: true,
      current: current,
      previous: previous,
      percent: Math.round(((current - previous) / previous) * 100),
      window: STRENGTH_DAYS
    };
  }

  /*
    Calorias: estimativa declarada como tal. Só é calculada quando existe peso
    informado no perfil e duração registrada — dois dados que o FORJA realmente
    guarda. MET 5,0 (treino de força moderado), fórmula
    kcal = MET × 3,5 × peso(kg) / 200 × minutos. Não é medição.
  */
  function caloriesEstimate(records) {
    var weight = Number(profile().pesoKg) || 0;
    var minutes = 0;

    records.forEach(function (record) {
      minutes += recordMinutes(record);
    });

    if (!(weight > 0) || !(minutes > 0)) {
      return { available: false, weight: weight, minutes: minutes, kcal: 0 };
    }

    return {
      available: true,
      weight: weight,
      minutes: minutes,
      kcal: Math.round((KCAL_MET_STRENGTH * 3.5 * weight / 200) * minutes)
    };
  }

  function formatTotalTime(totalMinutes) {
    if (!(totalMinutes > 0)) return "0 min";

    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;

    if (hours === 0) return minutes + " min";
    if (minutes === 0) return hours + " h";
    return hours + " h " + minutes + " min";
  }

  function metricCard(options) {
    var card = el("div", "home-metric" + (options.tone ? " is-" + options.tone : ""));
    card.setAttribute("role", "listitem");
    if (options.hint) card.title = options.hint;

    var head = el("span", "home-metric-icon");
    head.appendChild(icon(options.icon));
    card.appendChild(head);

    var value = el("strong", "home-metric-value", options.value);
    card.appendChild(value);

    card.appendChild(el("span", "home-metric-label", options.label));

    if (options.hint) card.appendChild(el("span", "home-metric-hint", options.hint));

    return card;
  }

  function computeMetrics() {
    var records = history().filter(function (record) {
      return F.isPlainObject ? F.isPlainObject(record) : Boolean(record && typeof record === "object");
    });

    var completed = 0;
    var totalMinutes = 0;

    records.forEach(function (record) {
      if (record.status === "completed") completed += 1;
      totalMinutes += recordMinutes(record);
    });

    return {
      records: records,
      completed: completed,
      sessions: records.length,
      totalMinutes: totalMinutes,
      strength: strengthEvolution(records),
      calories: caloriesEstimate(records)
    };
  }

  function renderMetrics() {
    var grid = byId("home-metrics-grid");
    var note = byId("home-metrics-note");
    if (!grid) return;

    clear(grid);
    if (note) note.textContent = "";

    var data = computeMetrics();
    var notes = [];

    /* 1. Treinos concluídos — direto do histórico. */
    grid.appendChild(metricCard({
      icon: "dumbbell",
      value: String(data.completed),
      label: "Treinos concluídos",
      tone: "reps",
      hint: data.completed === 0
        ? "Nenhum treino concluído ainda. Conclua um treino para o número aparecer."
        : String(data.sessions) + " sessão(ões) no histórico."
    }));

    /* 2. Tempo total — soma das durações registradas. */
    grid.appendChild(metricCard({
      icon: "clock",
      value: formatTotalTime(data.totalMinutes),
      label: "Tempo total de treino",
      tone: "time",
      hint: data.totalMinutes === 0
        ? "O tempo aparece quando você registra um treino."
        : "Soma das sessões registradas neste navegador."
    }));

    /* 3. Evolução de força — só com histórico comparável. */
    var strength = data.strength;
    var strengthValue = "—";
    var strengthHint = "Sem histórico suficiente: precisa de carga registrada neste mês e no anterior.";

    if (strength.available) {
      var sign = strength.percent > 0 ? "+" : "";
      strengthValue = sign + strength.percent + "%";
      strengthHint = "Maior carga dos últimos " + strength.window + " dias (" +
        F.formatKg(strength.current) + ") comparada à dos " + strength.window +
        " dias anteriores (" + F.formatKg(strength.previous) + ").";
    } else if (strength.current > 0) {
      strengthHint = "Primeira marca registrada: " + F.formatKg(strength.current) +
        ". O percentual aparece quando houver outro período para comparar.";
    }

    grid.appendChild(metricCard({
      icon: "chart",
      value: strengthValue,
      label: "Evolução de força",
      tone: "strength",
      hint: strengthHint
    }));

    /* 4. Calorias — estimativa identificada, nunca medição. */
    var calories = data.calories;
    var caloriesValue = "—";
    var caloriesHint;

    if (calories.available) {
      caloriesValue = F.formatNumber(calories.kcal);
      caloriesHint = "Estimativa (não é medição): " + KCAL_MET_STRENGTH +
        " MET × seu peso (" + F.formatKg(calories.weight) + ") × " +
        calories.minutes + " min registrados.";
    } else if (!(calories.weight > 0)) {
      caloriesHint = "Informe seu peso no perfil para uma estimativa. O FORJA não mede calorias.";
    } else {
      caloriesHint = "Sem sessões com duração registrada ainda.";
    }

    grid.appendChild(metricCard({
      icon: "flame",
      value: caloriesValue,
      label: "Calorias queimadas",
      tone: "kcal",
      hint: caloriesHint
    }));

    if (data.sessions === 0) {
      notes.push("Ainda não há histórico: os indicadores aparecem quando você concluir um treino.");
    } else {
      if (!strength.available) notes.push("A evolução de força precisa de dois períodos com carga registrada.");
      if (calories.available) notes.push("Calorias são uma estimativa calculada com o seu peso declarado — não são medidas.");
    }

    if (note) {
      note.textContent = notes.join(" ");
      note.hidden = notes.length === 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Seu progresso                                                       */
  /* ------------------------------------------------------------------ */

  /* Uma métrica por vez, sempre na mesma unidade. */
  function buildEvolutionSeries(records) {
    var metricas = F.metricas;
    if (!metricas) return null;

    var exercises = [];
    try {
      exercises = metricas.exerciseList(records);
    } catch (e) {
      exercises = [];
    }

    /* 1ª escolha: o exercício mais registrado com evolução real (≥ 2 treinos). */
    for (var index = 0; index < exercises.length && index < 4; index += 1) {
      var entry = exercises[index];
      var evolution = null;

      try {
        evolution = metricas.exerciseEvolution(records, entry.key);
      } catch (e) {
        evolution = null;
      }

      if (evolution && evolution.hasSeries && evolution.points.length >= 2) {
        return {
          kind: "exercise",
          title: evolution.name,
          valueLabel: evolution.valueLabel,
          criteria: evolution.criteria,
          unit: evolution.unit,
          points: evolution.points
        };
      }
    }

    /* 2ª escolha: volume com carga por treino (mesma unidade em todos os pontos). */
    var volumePoints = [];
    var repsPoints = [];

    records.slice().reverse().forEach(function (record) {
      var metrics = null;
      try {
        metrics = metricas.recordMetrics(record);
      } catch (e) {
        metrics = null;
      }
      if (!metrics) return;

      var date = metricas.recordDate(record);
      if (!date) return;

      var label = metricas.formatDayMonth(date);

      if (metrics.volumeKg > 0) {
        volumePoints.push({ label: label, y: metrics.volumeKg, note: record.routineName || "" });
      }
      if (metrics.reps > 0) {
        repsPoints.push({ label: label, y: metrics.reps, note: record.routineName || "" });
      }
    });

    if (volumePoints.length >= 2) {
      return {
        kind: "volume",
        title: "Volume com carga por treino",
        valueLabel: "Volume (kg)",
        criteria: "Cada ponto é a soma de repetições × carga numérica de um treino. " +
          "Séries sem carga numérica ficam fora — não são estimadas.",
        unit: "kg",
        points: volumePoints.slice(-8)
      };
    }

    if (repsPoints.length >= 2) {
      return {
        kind: "reps",
        title: "Repetições por treino",
        valueLabel: "Repetições",
        criteria: "Cada ponto soma as repetições registradas nas séries daquele treino.",
        unit: "reps",
        points: repsPoints.slice(-8)
      };
    }

    return null;
  }

  function formatEvolutionValue(unit) {
    return function (value) {
      if (unit === "kg") return F.formatKg(value);
      if (unit === "s") return F.formatRestValue(value);
      if (unit === "m") return F.formatDistance(value);
      return F.formatNumber(value);
    };
  }

  /*
    Conquista: só aparece com recorde real no histórico. "Nova marca" é usado
    quando o recorde foi registrado nos últimos 14 dias; mais antigo vira
    "Recorde pessoal". Sem recorde, o cartão não existe.
  */
  function buildAchievement(records) {
    if (!F.metricas || typeof F.metricas.personalRecords !== "function") return null;

    var recordsData = null;
    try {
      recordsData = F.metricas.personalRecords(records);
    } catch (e) {
      return null;
    }

    if (!recordsData || !recordsData.hasData) return null;

    var load = recordsData.items.find(function (item) { return item.id === "load"; });
    var chosen = load || recordsData.items[0];
    if (!chosen) return null;

    var fresh = false;
    if (chosen.date) {
      var days = (Date.now() - chosen.date.getTime()) / 86400000;
      fresh = days <= RECORD_FRESH_DAYS;
    }

    var subtitle;
    if (chosen.id === "load") {
      subtitle = (chosen.exercise || "Exercício") + ": " + F.formatKg(chosen.value);
    } else if (chosen.id === "reps") {
      subtitle = (chosen.exercise || "Exercício") + ": " + chosen.value + " reps";
    } else {
      subtitle = chosen.title + ": " + F.formatNumber(chosen.value);
    }

    return {
      fresh: fresh,
      title: fresh ? "Nova marca!" : "Recorde pessoal",
      subtitle: subtitle,
      criteria: chosen.criteria,
      date: chosen.date
    };
  }

  function progressEmpty(host) {
    var empty = el("div", "home-progress-empty");

    var text = el("div", "home-progress-empty-text");
    text.appendChild(el("strong", null, "Sua evolução começa aqui."));
    text.appendChild(el("p", null,
      "Quando houver pelo menos dois treinos com a mesma medida registrada, o gráfico aparece aqui."));

    var button = doc.createElement("a");
    button.className = "secondary-button home-progress-cta";
    button.href = F.url("treino");
    button.textContent = "Registrar meu primeiro treino";

    empty.appendChild(text);
    empty.appendChild(button);
    host.appendChild(empty);
  }

  function renderProgress() {
    var host = byId("home-progress-body");
    if (!host) return;

    clear(host);

    var records = history().filter(function (record) {
      return record && typeof record === "object" && !Array.isArray(record);
    });

    var series = buildEvolutionSeries(records);

    if (!series) {
      progressEmpty(host);
      return;
    }

    var grid = el("div", "home-progress-grid");

    var chartHost = el("div", "home-progress-chart");
    var chart = null;

    if (F.charts && typeof F.charts.line === "function") {
      try {
        chart = F.charts.line({
          points: series.points.map(function (point) {
            return { label: point.label, y: point.y, note: point.note };
          }),
          format: formatEvolutionValue(series.unit),
          ariaLabel: series.title + " — " + series.valueLabel,
          /* O critério aparece uma vez só, logo abaixo do cartão. */
          tableCaption: "Evolução — " + series.title,
          tableColumns: ["Data", series.valueLabel]
        });
      } catch (e) {
        chart = null;
      }
    }

    if (chart) {
      chartHost.appendChild(chart);
    } else {
      chartHost.appendChild(el("p", "home-progress-note",
        "Não foi possível desenhar o gráfico agora."));
    }
    grid.appendChild(chartHost);

    var achievement = buildAchievement(records);
    if (achievement) {
      var card = el("div", "home-achievement" + (achievement.fresh ? " is-fresh" : ""));
      card.setAttribute("role", "note");
      if (achievement.criteria) card.title = achievement.criteria;

      var head = el("div", "home-achievement-head");
      head.appendChild(icon("flag", "home-achievement-icon"));
      head.appendChild(doc.createTextNode(achievement.title));
      card.appendChild(head);

      card.appendChild(el("p", "home-achievement-value", achievement.subtitle));

      if (achievement.date && F.metricas.formatRecordDate) {
        card.appendChild(el("p", "home-achievement-date",
          "em " + F.metricas.formatDayMonth(achievement.date)));
      }

      grid.appendChild(card);
    } else {
      var hint = el("p", "home-progress-note",
        "Nenhum recorde registrado ainda. Seus melhores resultados aparecem aqui quando existirem.");
      grid.appendChild(hint);
    }

    host.appendChild(grid);

    if (seriesKindNote(series)) {
      host.appendChild(el("p", "home-progress-criteria", seriesKindNote(series)));
    }
  }

  function seriesKindNote(series) {
    if (!series) return "";
    return "Métrica: " + series.title + ". " + series.criteria;
  }

  /* ------------------------------------------------------------------ */
  /* Explore o FORJA                                                     */
  /* ------------------------------------------------------------------ */

  function exploreCard(options) {
    var node;

    if (options.available) {
      node = doc.createElement("a");
      node.href = options.href;
      if (options.id) node.id = options.id;
      if (options.ariaLabel) node.setAttribute("aria-label", options.ariaLabel);
    } else {
      node = doc.createElement("div");
      if (options.id) node.id = options.id;
      node.setAttribute("aria-disabled", "true");
      node.title = options.hint || "Indisponível no FORJA hoje.";
    }

    node.className = "home-explore-card" + (options.available ? "" : " is-unavailable");
    node.setAttribute("role", "listitem");

    var art = el("span", "home-explore-art");
    if (options.anatomy) art.classList.add("is-anatomy");
    art.appendChild(icon(options.icon));
    node.appendChild(art);

    node.appendChild(el("span", "home-explore-label", options.label));

    if (!options.available) {
      node.appendChild(el("span", "home-explore-badge", "Indisponível"));
    }

    return node;
  }

  function renderExplore() {
    var grid = byId("home-explore-grid");
    var note = byId("home-explore-note");
    if (!grid) return;

    clear(grid);
    if (note) note.textContent = "";

    grid.appendChild(exploreCard({
      id: "home-explore-biblioteca",
      icon: "book",
      label: "Biblioteca de Exercícios",
      href: F.url("biblioteca"),
      available: true,
      ariaLabel: "Abrir a Biblioteca de Exercícios"
    }));

    grid.appendChild(exploreCard({
      id: "home-explore-atlas",
      icon: "target",
      label: "Atlas Muscular",
      href: F.url("atlas"),
      available: true,
      anatomy: true,
      ariaLabel: "Abrir o Atlas muscular"
    }));

    grid.appendChild(exploreCard({
      id: "home-explore-planejador",
      icon: "calendar",
      label: "Planejador Semanal",
      href: F.url("treino") + "#training-plan-heading",
      available: true,
      ariaLabel: "Abrir o planejador semanal em Treinos"
    }));

    /*
      Substituições inteligentes não existem no FORJA: o cartão é mostrado como
      indisponível, sem link e sem rota vazia — nada de prometer o que não há.
    */
    grid.appendChild(exploreCard({
      id: "home-explore-substituicoes",
      icon: "repeat",
      label: "Substituições Inteligentes",
      available: false,
      hint: "Ainda não disponível: o FORJA não tem substituição automática de exercícios."
    }));

    if (note) {
      note.textContent = "Planejador Semanal abre o plano por regras no hub Treinos. " +
        "Substituições Inteligentes ainda não fazem parte do app.";
    }
  }

  /* ------------------------------------------------------------------ */
  /* Blocos herdados (semana, metas, último treino)                      */
  /* ------------------------------------------------------------------ */

  function renderWeek() {
    var statsHost = byId("home-week-stats");
    var note = byId("home-week-note");
    if (!statsHost || !note) return;
    statsHost.innerHTML = "";
    note.textContent = "";

    var records = history();
    var metricas = F.metricas;
    var summary = null;
    var week = null;

    if (metricas && metricas.resolvePeriod && metricas.filterByPeriod && metricas.summarize) {
      try {
        week = metricas.resolvePeriod("week", { now: new Date() });
        summary = metricas.summarize(metricas.filterByPeriod(records, week));
      } catch (e) { summary = null; }
    }

    if (!summary) {
      var now = new Date();
      var start = new Date(now);
      start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      start.setHours(0, 0, 0, 0);
      var end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);

      var filtered = records.filter(function (r) {
        if (!r || !r.date) return false;
        var d = new Date(r.finishedAt || r.date);
        return !isNaN(d) && d >= start && d <= end;
      });

      var totalSets = filtered.reduce(function (s, r) { return s + (Number(r.completedSets) || 0); }, 0);
      var totalMs = filtered.reduce(function (s, r) { return s + (Number(r.durationMs) || 0); }, 0);
      summary = {
        sessions: filtered.length,
        sets: totalSets,
        minutes: Math.round(totalMs / 60000),
        hasVolume: false,
        setsWithoutVolume: 0
      };
      week = { label: "" };
    }

    [
      { value: String(summary.sessions), label: "treinos" },
      { value: String(summary.sets), label: "séries" },
      { value: summary.minutes ? (summary.minutes + " min") : "0 min", label: "tempo" }
    ].forEach(function (item) {
      var card = el("div", "home-week-stat");
      card.setAttribute("role", "listitem");
      card.appendChild(el("div", "home-week-stat-value", item.value));
      card.appendChild(el("div", "home-week-stat-label", item.label));
      statsHost.appendChild(card);
    });

    statsHost.setAttribute("role", "list");

    if (summary.sessions === 0) {
      note.textContent = "Sem treinos nesta semana ainda. Quando registrar um, ele aparece aqui.";
    } else {
      var weekLabel = week && week.label ? week.label : "esta semana";
      note.textContent = summary.sessions + (summary.sessions === 1 ? " treino" : " treinos") + " em " + weekLabel + ".";
      if (summary.setsWithoutVolume > 0) {
        note.textContent += " " + summary.setsWithoutVolume + " série(s) ficaram fora do volume por falta de carga numérica.";
      }
    }
  }

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
      host.appendChild(el("p", "home-goals-note", "Não foi possível consultar suas metas agora."));
      return;
    }

    var progress;
    try {
      progress = metricas.goalProgress(history(), F.state ? F.state.goals : null, { now: new Date() });
    } catch (error) {
      host.appendChild(el("p", "home-goals-note", "Não foi possível consultar suas metas agora."));
      return;
    }

    var periodParts = [];
    if (progress && progress.week && progress.week.from && progress.week.to && metricas.formatDayMonth) {
      periodParts.push("Semana de " + metricas.formatDayMonth(progress.week.from) +
        " a " + metricas.formatDayMonth(progress.week.to));
    }
    if (progress && progress.modality && progress.modality !== "all") {
      periodParts.push(modeName(progress.modality));
    }
    if (periodParts.length > 0) periodNote.textContent = periodParts.join(" · ") + ".";

    var items = progress && Array.isArray(progress.items)
      ? progress.items.filter(function (item) { return item && item.active; })
      : [];

    if (!progress || !progress.active || items.length === 0) {
      host.appendChild(el("p", "home-goals-note",
        "Você ainda não configurou metas semanais. Defina seus objetivos em Progresso."));
      return;
    }

    var grid = el("div", "home-goals-grid");
    grid.setAttribute("role", "list");

    items.forEach(function (item) {
      var current = Number(item.current) || 0;
      var target = Number(item.target) || 0;
      var percent = Math.max(0, Math.min(100, Number(item.percent) || 0));

      var row = el("div", "home-goal-row");
      row.setAttribute("role", "listitem");

      var head = el("div", "home-goal-head");
      head.appendChild(el("strong", null, item.label));
      head.appendChild(el("span", "home-goal-value", current + "/" + target));

      var track = el("div", "home-goal-track");
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", String(Math.round(percent)));
      track.setAttribute("aria-label", item.label + ": " + current + " de " + target);

      var fill = el("span", "home-goal-fill");
      fill.style.width = percent + "%";
      track.appendChild(fill);

      row.append(head, track, el("span", "home-goal-note", formatGoalNote(item)));
      grid.appendChild(row);
    });

    host.appendChild(grid);
  }

  function formatRecordDate(record) {
    if (F.metricas && F.metricas.formatRecordDate) {
      try { return F.metricas.formatRecordDate(record); } catch (e) { /* segue */ }
    }
    if (record.finishedAt) {
      try { return new Date(record.finishedAt).toLocaleDateString("pt-BR"); } catch (e) { /* segue */ }
    }
    return record.date || "";
  }

  function renderRecent() {
    var list = byId("home-recent-list");
    var note = byId("home-recent-note");
    if (!list || !note) return;
    list.innerHTML = "";
    note.textContent = "";

    var records = history().filter(function (item) {
      return F.isPlainObject ? F.isPlainObject(item) : Boolean(item && typeof item === "object");
    });

    if (records.length === 0) {
      note.textContent = "Nenhum treino registrado ainda. Conclua um treino e ele aparecerá aqui.";
      return;
    }

    var archive = null;

    records.slice(0, 3).forEach(function (record, index) {
      if (index === 1) {
        archive = doc.createElement("details");
        archive.className = "home-recent-archive";
        var summary = doc.createElement("summary");
        summary.textContent = "Treinos anteriores";
        archive.appendChild(summary);
        list.appendChild(archive);
      }

      var item = el("div", "home-recent-item");
      item.appendChild(el("div", "home-recent-name", record.routineName || "Treino"));

      var status = record.status === "completed" ? "Concluído" : "Parcial";
      item.appendChild(el("div", "home-recent-meta",
        formatRecordDate(record) + " · " + modeName(record.modality) + " · " + status +
        " · " + (Number(record.completedSets) || 0) + "/" + (Number(record.totalPlannedSets) || 0) + " séries"));

      (index === 0 ? list : archive).appendChild(item);
    });

    if (records.length > 3) {
      note.textContent = "Mais " + (records.length - 3) + " treinos no histórico. Veja todos em Progresso.";
    }
  }

  /* ------------------------------------------------------------------ */
  /* Avisos do cabeçalho                                                 */
  /* ------------------------------------------------------------------ */

  /*
    O sino só ganha o ponto quando existe algo concreto para resolver: sessão
    em andamento ou treino programado para hoje ainda não executado. Sem
    pendência, nenhum ponto — nunca um número para chamar atenção.
  */
  function renderNotifications() {
    var dot = byId("home-notifications-dot");
    var link = byId("home-notifications");
    if (!dot) return;

    var pending = false;
    var message = "Avisos do FORJA";

    if (hasActiveSession()) {
      pending = true;
      message = "Avisos do FORJA: existe um treino em andamento";
    } else {
      var routine = nextRoutine();
      if (routine) {
        var todayKey = F.dateKey ? F.dateKey(new Date()) : "";
        var doneToday = history().some(function (record) {
          return record && record.date === todayKey && record.status === "completed";
        });
        if (!doneToday) {
          pending = true;
          message = "Avisos do FORJA: o treino de hoje ainda não foi concluído";
        }
      }
    }

    dot.hidden = !pending;
    if (link) {
      link.classList.toggle("has-alert", pending);
      link.setAttribute("aria-label", message);
      link.title = message;
    }
  }

  /* ------------------------------------------------------------------ */

  function renderHome() {
    if (typeof global.renderCalendar === "function") global.renderCalendar();
    if (typeof global.renderMissions === "function") global.renderMissions();
    renderGreeting();
    renderAction();
    renderMetrics();
    renderProgress();
    renderExplore();
    renderWeek();
    renderGoals();
    renderRecent();
    renderNotifications();
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

    function sync() {
      if (syncMemory && typeof F.syncStateFromStorage === "function") {
        F.syncStateFromStorage(key === null || key === undefined ? null : key);
      }
    }

    if (key === null || key === undefined) {
      sync();
      if (typeof global.updateTodayLabel === "function") global.updateTodayLabel();
      if (typeof F.updateActiveBanner === "function") F.updateActiveBanner();
      renderHome();
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
      sync();
      renderGoals();
      refreshHomeSnapshotMeta();
      return;
    }

    if (key === F.KEYS.rotation || key === F.KEYS.routines || key === F.KEYS.legacyExercises) {
      sync();
      if (typeof F.updateActiveBanner === "function") F.updateActiveBanner();
      renderGreeting();
      renderAction();
      renderNotifications();
      refreshHomeSnapshotMeta();
      return;
    }

    if (key === F.KEYS.history) {
      sync();
      renderGreeting();
      renderAction();
      renderMetrics();
      renderProgress();
      renderWeek();
      renderGoals();
      renderRecent();
      renderNotifications();
      refreshHomeSnapshotMeta();
      return;
    }

    if (key === F.KEYS.active) {
      sync();
      if (typeof F.updateActiveBanner === "function") F.updateActiveBanner();
      renderGreeting();
      renderAction();
      renderNotifications();
      refreshHomeSnapshotMeta();
      return;
    }

    if (key === F.KEYS.profile) {
      sync();
      /* O nome de exibição mora no perfil: salvar em Configurações atualiza a
         saudação (e a estimativa de calorias, que usa o peso declarado). */
      renderGreeting();
      renderMetrics();
      renderNotifications();
      refreshHomeSnapshotMeta();
    }
  }

  F.pages.inicio = function initInicio() {
    if (typeof global.updateTodayLabel === "function") global.updateTodayLabel();
    renderHome();
    refreshHomeSnapshotMeta();
  };

  F.onDataChanged(function () {
    if (!isHomeActive()) return;
    renderHome();
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

    lastHomeSignature = currentSig;
    lastHomeDayKey = currentDay;
  });

  /* Exposto para testes e para outras telas que queiram as mesmas regras. */
  F.home = {
    renderAction: renderAction,
    renderWeek: renderWeek,
    renderGoals: renderGoals,
    renderRecent: renderRecent,
    renderGreeting: renderGreeting,
    renderMetrics: renderMetrics,
    renderProgress: renderProgress,
    renderExplore: renderExplore,
    renderNotifications: renderNotifications,
    nextRoutine: nextRoutine,
    startableRoutines: startableRoutines,
    estimateMinutes: estimateMinutes,
    strengthEvolution: strengthEvolution,
    caloriesEstimate: caloriesEstimate,
    displayName: displayName
  };
})(window);
