/*
  FORJA — métricas de progresso (módulo puro).

  Regras deste arquivo, deliberadas:

  - Nada de DOM, nada de armazenamento, nada de `F.state`. Entram registros do
    histórico e saem números, datas e critérios. Por isso o mesmo módulo roda
    na página e na suíte unitária (`tests/metricas.test.mjs`).
  - Unidades nunca se misturam: carga em kg, distância em metros, tempo em
    segundos, repetições e séries são campos separados. Nenhum total soma
    coisas diferentes, e uma métrica sem dado fica marcada como indisponível
    (`hasVolume`, `hasDistance`, ...) em vez de virar zero "de mentira".
  - Comparar períodos, recordes e evolução só usam o que foi gravado. Quando o
    registro não tem `totals` (histórico anterior à etapa 4), os números são
    derivados das séries registradas com os mesmos parsers do modelo
    (`F.parseLoadKg`, `F.parseMaxReps`); texto sem número não vira carga.
  - Todo critério é explícito e vem junto do número (`criteria`), para a tela
    poder mostrar por que aquele valor está ali.

  Semana do app: segunda a domingo (a mesma leitura do calendário local).
*/
(function (global) {
  "use strict";

  const F = global.Forja = global.Forja || {};

  const WEEKDAY_SHORT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
  const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const DEFAULT_WEEKLY_WEEKS = 8;
  const DEFAULT_FREQUENCY_WEEKS = 12;

  /* ------------------------------------------------------------------ */
  /* Datas                                                               */
  /* ------------------------------------------------------------------ */

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function toNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value.replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function positive(value) {
    const number = toNumber(value);
    return number !== null && number > 0 ? number : 0;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    const next = startOfDay(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  /* Segunda-feira da semana que contém `date`. */
  function startOfWeek(date) {
    const day = startOfDay(date);
    const offset = (day.getDay() + 6) % 7;
    return addDays(day, -offset);
  }

  function endOfWeek(date) {
    return addDays(startOfWeek(date), 6);
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function dateKeyOf(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  /* Aceita apenas AAAA-MM-DD que exista no calendário (rejeita 31/02). */
  function parseKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const date = new Date(year, month - 1, day);

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }

    return date;
  }

  /*
    Data de um registro. `finishedAt` manda quando é um ISO válido; senão vale
    o campo `date` (AAAA-MM-DD), que existe desde o histórico antigo.
  */
  function recordDate(record) {
    if (!isObject(record)) return null;

    if (record.finishedAt) {
      const finished = new Date(record.finishedAt);
      if (!Number.isNaN(finished.getTime())) return finished;
    }

    return parseKey(record.date);
  }

  function formatDayMonth(date) {
    if (!date) return "—";
    return String(date.getDate()).padStart(2, "0") + "/" + String(date.getMonth() + 1).padStart(2, "0");
  }

  function formatFullDate(date) {
    if (!date) return "—";
    return formatDayMonth(date) + "/" + date.getFullYear();
  }

  /* "01 de mar. de 2025, 09:00" — mesmo formato usado antes no histórico. */
  function formatRecordDate(record, options) {
    const date = recordDate(record);
    if (!date) return "Data não registrada";

    const format = options || {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    };

    try {
      return date.toLocaleDateString("pt-BR", format);
    } catch (error) {
      return formatFullDate(date);
    }
  }

  function startOfWeekLabel(date) {
    return "semana de " + formatDayMonth(startOfWeek(date));
  }

  /* ------------------------------------------------------------------ */
  /* Períodos                                                            */
  /* ------------------------------------------------------------------ */

  function monthLabel(date) {
    const label = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function daysBetween(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
  }

  function period(id, label, from, to, previous) {
    return {
      id,
      label,
      from: from || null,
      to: to || null,
      previous: previous || null
    };
  }

  /*
    Resolve um período de análise:

      "week"    segunda a domingo da semana atual   → compara com a anterior
      "month"   mês corrente                        → compara com o anterior
      "all"     histórico inteiro                   → sem comparação automática
      "custom"  intervalo de/até (AAAA-MM-DD)       → compara com o bloco do
                                                       mesmo tamanho logo antes

    `previous` só existe quando a comparação faz sentido; "all" devolve null
    em vez de inventar um recorte escondido.
  */
  function resolvePeriod(kind, options) {
    const settings = isObject(options) ? options : {};
    const now = settings.now instanceof Date && !Number.isNaN(settings.now.getTime())
      ? settings.now
      : new Date();

    if (kind === "week") {
      const from = startOfWeek(now);
      const to = endOfWeek(now);
      const previousFrom = addDays(from, -7);
      const previousTo = addDays(to, -7);

      return period(
        "week",
        formatDayMonth(from) + " – " + formatDayMonth(to) + " de " + to.getFullYear(),
        from, to,
        period("week-previous", "semana anterior", previousFrom, previousTo, null)
      );
    }

    if (kind === "month") {
      const from = startOfMonth(now);
      const to = endOfMonth(now);
      const previousMonth = new Date(from.getFullYear(), from.getMonth() - 1, 1);

      return period(
        "month",
        monthLabel(from),
        from, to,
        period("month-previous", monthLabel(previousMonth), startOfMonth(previousMonth), endOfMonth(previousMonth), null)
      );
    }

    if (kind === "custom") {
      const from = parseKey(settings.from);
      const to = parseKey(settings.to);

      if (!from || !to || from > to) return null;

      const span = daysBetween(from, to) + 1;
      const previousTo = addDays(from, -1);
      const previousFrom = addDays(previousTo, -(span - 1));

      return period(
        "custom",
        formatFullDate(from) + " – " + formatFullDate(to),
        from, to,
        period("custom-previous", "período anterior", previousFrom, previousTo, null)
      );
    }

    return period("all", "Todo o período", null, null, null);
  }

  /* Registros dentro do período. Sem período definido, tudo que tem data. */
  function filterByPeriod(records, range) {
    const list = Array.isArray(records) ? records.filter(isObject) : [];

    if (!range || !range.from || !range.to) {
      return list.slice();
    }

    const from = startOfDay(range.from).getTime();
    const to = addDays(range.to, 1).getTime();

    return list.filter(record => {
      const date = recordDate(record);
      if (!date) return false;
      return date.getTime() >= from && date.getTime() < to;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Séries registradas → números                                       */
  /* ------------------------------------------------------------------ */

  function parseLoad(value) {
    return typeof F.parseLoadKg === "function" ? F.parseLoadKg(value) : null;
  }

  function parseReps(value) {
    return typeof F.parseMaxReps === "function" ? F.parseMaxReps(value) : null;
  }

  /*
    Uma série registrada. Distância é convertida para metros pela unidade do
    exercício; carga em lb é convertida pelo modelo (`F.parseLoadKg`).
  */
  function setMetrics(exercise, log) {
    if (!isObject(log)) return null;

    const reps = parseReps(log.reps);
    const loadKg = parseLoad(log.load);
    const seconds = positive(log.seconds);
    const rawDistance = positive(log.distance);
    const inKilometers = exercise && exercise.distanceUnit === "km";
    const distanceMeters = rawDistance > 0
      ? (inKilometers ? Math.round(rawDistance * 1000) : rawDistance)
      : 0;

    return {
      set: toNumber(log.set),
      reps: reps || 0,
      loadKg: loadKg || 0,
      seconds,
      distanceMeters,
      volumeKg: reps && loadKg ? reps * loadKg : 0,
      corrected: Boolean(log.editedAt)
    };
  }

  function eachExercise(record) {
    return Array.isArray(record.exercises) ? record.exercises.filter(isObject) : [];
  }

  function eachSet(record) {
    const sets = [];

    eachExercise(record).forEach(exercise => {
      const logs = Array.isArray(exercise.logs) ? exercise.logs : [];
      logs.forEach(log => {
        const metrics = setMetrics(exercise, log);
        if (metrics) {
          metrics.exercise = typeof exercise.name === "string" ? exercise.name : "";
          sets.push(metrics);
        }
      });
    });

    return sets;
  }

  function emptyRecordMetrics() {
    return {
      sets: 0,
      plannedSets: 0,
      durationMs: 0,
      volumeKg: 0,
      reps: 0,
      seconds: 0,
      distanceMeters: 0,
      setsLogged: 0,
      setsWithoutVolume: 0,
      hasVolume: false,
      hasReps: false,
      hasTime: false,
      hasDistance: false,
      best: { loadKg: 0, reps: 0, seconds: 0, distanceMeters: 0 }
    };
  }

  /*
    Números de uma sessão. `totals` gravados pela execução têm prioridade
    (foram calculados no momento do registro). Sessões antigas, sem `totals`,
    são derivadas das séries — com os mesmos critérios e a mesma conversão.
  */
  function recordMetrics(record) {
    const metrics = emptyRecordMetrics();
    if (!isObject(record)) return metrics;

    const exercises = eachExercise(record);
    const sets = eachSet(record);

    let derivedSets = 0;
    let derivedPlanned = 0;
    let derivedVolume = 0;
    let derivedReps = 0;
    let derivedSeconds = 0;
    let derivedDistance = 0;
    let derivedWithoutVolume = 0;

    exercises.forEach(exercise => {
      derivedSets += positive(exercise.completedSets);
      derivedPlanned += positive(exercise.plannedSets);
    });

    sets.forEach(set => {
      derivedVolume += set.volumeKg;
      derivedReps += set.reps;
      derivedSeconds += set.seconds;
      derivedDistance += set.distanceMeters;

      if (!set.volumeKg && !set.distanceMeters) derivedWithoutVolume += 1;

      metrics.best.loadKg = Math.max(metrics.best.loadKg, set.loadKg);
      metrics.best.reps = Math.max(metrics.best.reps, set.reps);
      metrics.best.seconds = Math.max(metrics.best.seconds, set.seconds);
      metrics.best.distanceMeters = Math.max(metrics.best.distanceMeters, set.distanceMeters);
    });

    const totals = isObject(record.totals) ? record.totals : null;

    metrics.sets = toNumber(record.completedSets) !== null
      ? Math.max(0, Math.round(record.completedSets))
      : derivedSets;
    metrics.plannedSets = toNumber(record.totalPlannedSets) !== null
      ? Math.max(0, Math.round(record.totalPlannedSets))
      : derivedPlanned;
    metrics.durationMs = positive(record.durationMs);

    metrics.volumeKg = totals ? positive(totals.volumeKg) : Math.round(derivedVolume * 10) / 10;
    metrics.reps = totals ? positive(totals.reps) : derivedReps;
    metrics.seconds = totals ? positive(totals.seconds) : derivedSeconds;
    metrics.distanceMeters = totals ? positive(totals.distanceMeters) : derivedDistance;
    metrics.setsLogged = totals ? positive(totals.setsLogged) : sets.length;
    metrics.setsWithoutVolume = totals ? positive(totals.setsWithoutVolume) : derivedWithoutVolume;

    metrics.hasVolume = metrics.volumeKg > 0;
    metrics.hasReps = metrics.reps > 0;
    metrics.hasTime = metrics.seconds > 0;
    metrics.hasDistance = metrics.distanceMeters > 0;

    return metrics;
  }

  /* ------------------------------------------------------------------ */
  /* Totais                                                              */
  /* ------------------------------------------------------------------ */

  function summarize(records) {
    const summary = {
      sessions: 0,
      completed: 0,
      partial: 0,
      sets: 0,
      plannedSets: 0,
      durationMs: 0,
      minutes: 0,
      volumeKg: 0,
      reps: 0,
      seconds: 0,
      distanceMeters: 0,
      setsLogged: 0,
      setsWithoutVolume: 0,
      hasVolume: false,
      hasReps: false,
      hasTime: false,
      hasDistance: false,
      firstDate: null,
      lastDate: null,
      trainedDays: 0
    };

    const days = new Set();
    const list = Array.isArray(records) ? records.filter(isObject) : [];

    list.forEach(record => {
      const metrics = recordMetrics(record);

      summary.sessions += 1;
      if (record.status === "completed") summary.completed += 1;
      else summary.partial += 1;

      summary.sets += metrics.sets;
      summary.plannedSets += metrics.plannedSets;
      summary.durationMs += metrics.durationMs;
      summary.volumeKg += metrics.volumeKg;
      summary.reps += metrics.reps;
      summary.seconds += metrics.seconds;
      summary.distanceMeters += metrics.distanceMeters;
      summary.setsLogged += metrics.setsLogged;
      summary.setsWithoutVolume += metrics.setsWithoutVolume;

      if (metrics.hasVolume) summary.hasVolume = true;
      if (metrics.hasReps) summary.hasReps = true;
      if (metrics.hasTime) summary.hasTime = true;
      if (metrics.hasDistance) summary.hasDistance = true;

      const date = recordDate(record);
      if (date) {
        days.add(dateKeyOf(date));
        if (!summary.firstDate || date < summary.firstDate) summary.firstDate = date;
        if (!summary.lastDate || date > summary.lastDate) summary.lastDate = date;
      }
    });

    summary.volumeKg = Math.round(summary.volumeKg * 10) / 10;
    summary.minutes = Math.round(summary.durationMs / 60000);
    summary.trainedDays = days.size;

    return summary;
  }

  /* ------------------------------------------------------------------ */
  /* Séries semanais (gráfico de colunas)                                */
  /* ------------------------------------------------------------------ */

  function weeklySeries(records, options) {
    const settings = isObject(options) ? options : {};
    const now = settings.now instanceof Date && !Number.isNaN(settings.now.getTime())
      ? settings.now
      : new Date();
    const totalWeeks = Math.max(1, Math.min(52, Math.round(settings.weeks || DEFAULT_WEEKLY_WEEKS)));
    const anchor = startOfWeek(now);
    const weeks = [];

    for (let index = totalWeeks - 1; index >= 0; index -= 1) {
      const from = addDays(anchor, -index * 7);
      weeks.push({
        key: dateKeyOf(from),
        from,
        to: addDays(from, 6),
        label: formatDayMonth(from),
        sessions: 0,
        completed: 0,
        sets: 0,
        plannedSets: 0,
        durationMs: 0,
        minutes: 0,
        volumeKg: 0,
        hasVolume: false
      });
    }

    const byKey = new Map(weeks.map(week => [week.key, week]));
    const list = Array.isArray(records) ? records.filter(isObject) : [];

    list.forEach(record => {
      const date = recordDate(record);
      if (!date) return;

      const bucket = byKey.get(dateKeyOf(startOfWeek(date)));
      if (!bucket) return;

      const metrics = recordMetrics(record);
      bucket.sessions += 1;
      if (record.status === "completed") bucket.completed += 1;
      bucket.sets += metrics.sets;
      bucket.plannedSets += metrics.plannedSets;
      bucket.durationMs += metrics.durationMs;
      bucket.volumeKg += metrics.volumeKg;
      if (metrics.hasVolume) bucket.hasVolume = true;
    });

    weeks.forEach(week => {
      week.minutes = Math.round(week.durationMs / 60000);
      week.volumeKg = Math.round(week.volumeKg * 10) / 10;
    });

    return weeks;
  }

  /* ------------------------------------------------------------------ */
  /* Calendário de frequência                                            */
  /* ------------------------------------------------------------------ */

  /*
    Devolve `weeks * 7` dias corridos (segunda → domingo), do mais antigo para
    o mais recente. `count` é o número de séries concluídas no dia — a mesma
    escala que o heatmap usa (0 a 12+). Dias futuros da semana corrente vêm
    com `future: true` e contagem zero, para a grade não perder a forma.
  */
  function frequency(records, options) {
    const settings = isObject(options) ? options : {};
    const now = settings.now instanceof Date && !Number.isNaN(settings.now.getTime())
      ? settings.now
      : new Date();
    const totalWeeks = Math.max(1, Math.min(52, Math.round(settings.weeks || DEFAULT_FREQUENCY_WEEKS)));
    const anchor = startOfWeek(now);
    const first = addDays(anchor, -(totalWeeks - 1) * 7);
    const today = startOfDay(now);

    const byDay = new Map();
    const list = Array.isArray(records) ? records.filter(isObject) : [];

    list.forEach(record => {
      const date = recordDate(record);
      if (!date) return;

      const key = dateKeyOf(date);
      const entry = byDay.get(key) || { sessions: 0, sets: 0, durationMs: 0, volumeKg: 0, hasVolume: false };
      const metrics = recordMetrics(record);

      entry.sessions += 1;
      entry.sets += metrics.sets;
      entry.durationMs += metrics.durationMs;
      entry.volumeKg += metrics.volumeKg;
      entry.hasVolume = entry.hasVolume || metrics.hasVolume;

      byDay.set(key, entry);
    });

    const days = [];
    let trainedDays = 0;
    let trainedSessions = 0;
    let maxSets = 0;

    for (let week = 0; week < totalWeeks; week += 1) {
      for (let index = 0; index < 7; index += 1) {
        const date = addDays(first, week * 7 + index);
        const key = dateKeyOf(date);
        const entry = byDay.get(key);
        const count = entry ? entry.sets : 0;

        if (entry && entry.sessions > 0) {
          trainedDays += 1;
          trainedSessions += entry.sessions;
        }

        maxSets = Math.max(maxSets, count);

        days.push({
          date: key,
          label: formatFullDate(date),
          short: formatDayMonth(date),
          weekday: WEEKDAY_SHORT[index],
          weekKey: dateKeyOf(startOfWeek(date)),
          sessions: entry ? entry.sessions : 0,
          count,
          minutes: entry ? Math.round(entry.durationMs / 60000) : 0,
          volumeKg: entry ? Math.round(entry.volumeKg * 10) / 10 : 0,
          hasVolume: entry ? entry.hasVolume : false,
          future: date.getTime() > today.getTime()
        });
      }
    }

    return {
      weeks: totalWeeks,
      days,
      from: first,
      to: addDays(anchor, 6),
      trainedDays,
      trainedSessions,
      maxSets,
      hasData: trainedDays > 0
    };
  }

  /* ------------------------------------------------------------------ */
  /* Exercícios: lista e evolução                                        */
  /* ------------------------------------------------------------------ */

  function normalizeName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function exerciseKey(modality, name) {
    return (modality || "") + "|" + normalizeName(name);
  }

  function splitKey(key) {
    const text = String(key || "");
    const index = text.indexOf("|");
    if (index < 0) return { modality: "", name: "" };
    return { modality: text.slice(0, index), name: text.slice(index + 1) };
  }

  /*
    Exercícios que aparecem no histórico, com a medida inferida do que foi
    registrado (distância > carga > tempo > repetições). A inferência olha só
    para as séries gravadas: um exercício sem série registrada não entra.
  */
  function exerciseList(records) {
    const entries = new Map();
    const list = Array.isArray(records) ? records.filter(isObject) : [];

    list.forEach(record => {
      eachExercise(record).forEach(exercise => {
        const name = typeof exercise.name === "string" ? exercise.name.trim() : "";
        if (!name) return;

        const key = exerciseKey(record.modality, name);
        const entry = entries.get(key) || {
          key,
          name,
          modality: record.modality || "",
          sessions: 0,
          setsLogged: 0,
          hasDistance: false,
          hasLoad: false,
          hasTime: false,
          hasReps: false,
          lastDate: null
        };

        const logs = Array.isArray(exercise.logs) ? exercise.logs : [];
        const date = recordDate(record);

        entry.sessions += 1;
        entry.setsLogged += logs.length;
        if (date && (!entry.lastDate || date > entry.lastDate)) {
          entry.lastDate = date;
          entry.name = name;
        }

        logs.forEach(log => {
          const metrics = setMetrics(exercise, log);
          if (!metrics) return;
          if (metrics.distanceMeters > 0) entry.hasDistance = true;
          if (metrics.loadKg > 0) entry.hasLoad = true;
          if (metrics.seconds > 0) entry.hasTime = true;
          if (metrics.reps > 0) entry.hasReps = true;
        });

        entries.set(key, entry);
      });
    });

    return Array.from(entries.values()).map(entry => {
      const measure = entry.hasDistance ? "distance"
        : entry.hasLoad ? "load"
        : entry.hasTime ? "time"
        : "reps";

      return Object.assign({}, entry, { measure });
    }).sort((a, b) => {
      if (b.sessions !== a.sessions) return b.sessions - a.sessions;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }

  const EVOLUTION = {
    load: {
      unit: "kg",
      valueLabel: "Maior carga por treino",
      criteria: "Cada ponto é a maior carga numérica registrada em uma série daquele treino. " +
        "Cargas em lb são convertidas para kg; anotação sem número não entra no gráfico."
    },
    reps: {
      unit: "reps",
      valueLabel: "Repetições por treino",
      criteria: "Cada ponto soma as repetições registradas nas séries daquele treino. " +
        "Faixas como \"8-12\" contam o maior número da faixa."
    },
    time: {
      unit: "s",
      valueLabel: "Tempo registrado por treino",
      criteria: "Cada ponto soma os segundos registrados nas séries daquele treino; " +
        "série sem cronômetro não é estimada."
    },
    distance: {
      unit: "m",
      valueLabel: "Maior distância por treino",
      criteria: "Cada ponto é a maior distância registrada em uma série daquele treino. " +
        "Quilômetros são convertidos para metros."
    }
  };

  function sessionValueFor(measure, sets) {
    if (sets.length === 0) return 0;

    if (measure === "distance") {
      return sets.reduce((best, set) => Math.max(best, set.distanceMeters), 0);
    }

    if (measure === "load") {
      return sets.reduce((best, set) => Math.max(best, set.loadKg), 0);
    }

    if (measure === "time") {
      return sets.reduce((sum, set) => sum + set.seconds, 0);
    }

    return sets.reduce((sum, set) => sum + set.reps, 0);
  }

  /*
    Evolução de um exercício (ou de todos, quando `key` é vazio). A medida vem
    do que existe nas séries; a página só desenha a linha quando há pelo menos
    dois treinos com valor medido.
  */
  function exerciseEvolution(records, key, options) {
    const settings = isObject(options) ? options : {};
    const target = splitKey(key);
    const list = Array.isArray(records) ? records.filter(isObject) : [];
    const sessions = [];

    list.forEach(record => {
      const date = recordDate(record);
      if (!date) return;

      if (target.modality && record.modality !== target.modality) return;

      const sets = [];

      eachExercise(record).forEach(exercise => {
        const name = typeof exercise.name === "string" ? exercise.name : "";
        if (!name) return;

        if (target.name && normalizeName(name) !== target.name) return;

        const logs = Array.isArray(exercise.logs) ? exercise.logs : [];
        logs.forEach(log => {
          const metrics = setMetrics(exercise, log);
          if (!metrics) return;
          metrics.name = name;
          sets.push(metrics);
        });
      });

      if (sets.length === 0) return;

      sessions.push({ date, sets, name: sets[0].name });
    });

    sessions.sort((a, b) => a.date - b.date);

    const flags = { load: false, reps: false, time: false, distance: false };
    sessions.forEach(session => {
      session.sets.forEach(set => {
        if (set.loadKg > 0) flags.load = true;
        if (set.reps > 0) flags.reps = true;
        if (set.seconds > 0) flags.time = true;
        if (set.distanceMeters > 0) flags.distance = true;
      });
    });

    const measure = flags.distance ? "distance"
      : flags.load ? "load"
      : flags.time ? "time"
      : "reps";

    const descriptor = EVOLUTION[measure];
    const displayName = target.name
      ? (sessions.length > 0 ? sessions[sessions.length - 1].name : key)
      : "Todos os exercícios";

    const points = [];
    let unmeasured = 0;

    sessions.forEach(session => {
      const value = sessionValueFor(measure, session.sets);

      if (!(value > 0)) {
        unmeasured += 1;
        return;
      }

      points.push({
        date: session.date,
        dateKey: dateKeyOf(session.date),
        label: formatDayMonth(session.date),
        y: Math.round(value * 10) / 10,
        sets: session.sets.length,
        note: session.sets.length === 1 ? "1 série" : session.sets.length + " séries"
      });
    });

    const ordered = points.slice().sort((a, b) => b.y - a.y);
    const best = ordered.length > 0 ? ordered[0] : null;

    return {
      requestedKey: key || "",
      key: target.name ? key : "",
      name: displayName,
      modality: target.modality || "",
      measure,
      unit: descriptor.unit,
      valueLabel: descriptor.valueLabel,
      criteria: descriptor.criteria,
      sessions: sessions.length,
      unmeasured,
      points,
      best,
      hasSeries: points.length >= 2
    };
  }

  /* ------------------------------------------------------------------ */
  /* Recordes                                                            */
  /* ------------------------------------------------------------------ */

  /*
    Recordes com critério explícito. Cada categoria só existe quando há um
    valor medido > 0; empate fica com o registro mais recente. Nada é
    extrapolado a partir de texto livre.
  */
  const RECORD_DEFINITIONS = [
    {
      id: "load",
      title: "Maior carga em uma série",
      unit: "kg",
      criteria: "Maior carga numérica registrada em uma única série. " +
        "Cargas em lb são convertidas para kg; anotação sem número não conta."
    },
    {
      id: "reps",
      title: "Mais repetições em uma série",
      unit: "reps",
      criteria: "Maior número de repetições em uma única série. " +
        "Faixas como \"8-12\" contam o maior número da faixa."
    },
    {
      id: "time",
      title: "Série mais longa",
      unit: "s",
      criteria: "Maior tempo contínuo registrado em uma única série, pelo cronômetro."
    },
    {
      id: "distance",
      title: "Maior distância em uma série",
      unit: "m",
      criteria: "Maior distância registrada em uma única série, em metros (km convertido)."
    },
    {
      id: "volume",
      title: "Maior volume em um treino",
      unit: "kg",
      criteria: "Maior soma de repetições × carga numérica em um único treino. " +
        "Séries sem carga numérica ficam fora — não são estimadas."
    },
    {
      id: "sets",
      title: "Mais séries em um treino",
      unit: "sets",
      criteria: "Maior número de séries concluídas em um único treino registrado."
    },
    {
      id: "sessionTime",
      title: "Treino mais longo",
      unit: "s",
      criteria: "Maior duração de sessão registrada pelo cronômetro do treino."
    }
  ];

  function personalRecords(records) {
    const list = Array.isArray(records) ? records.filter(isObject) : [];
    const candidates = new Map();

    function offer(id, value, payload) {
      if (!(value > 0)) return;

      const current = candidates.get(id);
      const isBetter = !current || value > current.value ||
        (value === current.value && payload.date && current.date && payload.date > current.date);

      if (isBetter) candidates.set(id, Object.assign({ value }, payload));
    }

    list.forEach(record => {
      const date = recordDate(record);
      const modality = record.modality || "";
      const routineName = typeof record.routineName === "string" ? record.routineName : "Treino";
      const metrics = recordMetrics(record);

      eachExercise(record).forEach(exercise => {
        const name = typeof exercise.name === "string" ? exercise.name : "";
        const logs = Array.isArray(exercise.logs) ? exercise.logs : [];

        logs.forEach(log => {
          const set = setMetrics(exercise, log);
          if (!set) return;

          const context = {
            exercise: name,
            modality,
            routineName,
            date,
            set: set.set,
            reps: set.reps,
            loadKg: set.loadKg,
            seconds: set.seconds,
            distanceMeters: set.distanceMeters
          };

          offer("load", set.loadKg, context);
          offer("reps", set.reps, context);
          offer("time", set.seconds, context);
          offer("distance", set.distanceMeters, context);
        });
      });

      const sessionContext = { exercise: routineName, modality, routineName, date };

      offer("volume", metrics.volumeKg, sessionContext);
      offer("sets", metrics.sets, sessionContext);
      offer("sessionTime", metrics.durationMs / 1000, sessionContext);
    });

    const items = RECORD_DEFINITIONS.reduce((collected, definition) => {
      const best = candidates.get(definition.id);
      if (!best) return collected;

      collected.push({
        id: definition.id,
        title: definition.title,
        unit: definition.unit,
        criteria: definition.criteria,
        value: best.value,
        exercise: best.exercise || "",
        modality: best.modality || "",
        routineName: best.routineName || "",
        date: best.date || null,
        set: best.set === undefined ? null : best.set,
        reps: best.reps || 0,
        loadKg: best.loadKg || 0,
        seconds: best.seconds || 0,
        distanceMeters: best.distanceMeters || 0
      });

      return collected;
    }, []);

    return {
      items,
      hasData: items.length > 0,
      absent: RECORD_DEFINITIONS.filter(definition => !candidates.has(definition.id))
        .map(definition => ({ id: definition.id, title: definition.title, criteria: definition.criteria }))
    };
  }

  /* ------------------------------------------------------------------ */
  /* Comparação de períodos                                              */
  /* ------------------------------------------------------------------ */

  function percentChange(current, previous) {
    if (!(previous > 0)) return current > 0 ? null : 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  /*
    Compara o período atual com o anterior equivalente. Métricas de unidades
    diferentes ficam em linhas separadas; volume só aparece quando um dos dois
    períodos tem carga numérica registrada.
  */
  function comparePeriods(records, current, previous) {
    if (!current || !current.from || !current.to) {
      return { available: false, reason: "period", metrics: [], hasData: false, current: null, previous: null };
    }

    if (!previous) {
      return { available: false, reason: "previous", metrics: [], hasData: false, current: null, previous: null };
    }

    const currentSummary = summarize(filterByPeriod(records, current));
    const previousSummary = summarize(filterByPeriod(records, previous));

    const metrics = [
      {
        id: "sessions", label: "Treinos", unit: "sessions",
        current: currentSummary.sessions, previous: previousSummary.sessions
      },
      {
        id: "sets", label: "Séries concluídas", unit: "sets",
        current: currentSummary.sets, previous: previousSummary.sets
      },
      {
        id: "minutes", label: "Tempo de treino", unit: "minutes",
        current: currentSummary.minutes, previous: previousSummary.minutes
      },
      {
        id: "volume", label: "Volume com carga", unit: "kg",
        current: currentSummary.volumeKg, previous: previousSummary.volumeKg,
        available: currentSummary.hasVolume || previousSummary.hasVolume
      }
    ].map(metric => Object.assign({}, metric, {
      available: metric.available !== false,
      delta: metric.current - metric.previous,
      percent: percentChange(metric.current, metric.previous)
    }));

    return {
      available: true,
      reason: null,
      current,
      previous,
      metrics,
      hasData: currentSummary.sessions > 0 || previousSummary.sessions > 0,
      currentSummary,
      previousSummary
    };
  }

  /* ------------------------------------------------------------------ */
  /* Metas semanais                                                      */
  /* ------------------------------------------------------------------ */

  const GOAL_ITEMS = [
    { id: "weeklySessions", label: "Treinos", unit: "sessions" },
    { id: "weeklySets", label: "Séries", unit: "sets" },
    { id: "weeklyMinutes", label: "Minutos", unit: "minutes" }
  ];

  function normalizeGoalsFallback(goals) {
    const raw = isObject(goals) ? goals : {};
    const limit = F.GOAL_TARGET_LIMIT || 50;

    function clamp(value, max) {
      const number = toNumber(value);
      if (number === null) return 0;
      return Math.max(0, Math.min(max, Math.round(number)));
    }

    return {
      modality: raw.modality === "calisthenics" || raw.modality === "weights" ? raw.modality : "all",
      weeklySessions: clamp(raw.weeklySessions, limit),
      weeklySets: clamp(raw.weeklySets, limit * 30),
      weeklyMinutes: clamp(raw.weeklyMinutes, 7 * 60 * 24)
    };
  }

  /*
    Progresso das metas da semana corrente. O escopo é o da própria meta
    (`modality`), independente do filtro da página: uma meta de musculação não
    muda porque a tela está filtrada por calistenia. Alvo 0 = item desligado.
  */
  function goalProgress(records, goals, options) {
    const settings = isObject(options) ? options : {};
    const normalized = typeof F.normalizeGoals === "function"
      ? F.normalizeGoals(goals)
      : normalizeGoalsFallback(goals);

    const now = settings.now instanceof Date && !Number.isNaN(settings.now.getTime())
      ? settings.now
      : new Date();
    const week = resolvePeriod("week", { now });
    const scoped = (Array.isArray(records) ? records : []).filter(record => {
      if (!isObject(record)) return false;
      return normalized.modality === "all" || record.modality === normalized.modality;
    });
    const summary = summarize(filterByPeriod(scoped, week));

    const items = GOAL_ITEMS.map(item => {
      const target = normalized[item.id] || 0;
      const current = item.id === "weeklySessions" ? summary.sessions
        : item.id === "weeklySets" ? summary.sets
        : summary.minutes;

      return {
        id: item.id,
        label: item.label,
        unit: item.unit,
        target,
        current,
        active: target > 0,
        percent: target > 0 ? Math.round((current / target) * 100) : 0,
        met: target > 0 && current >= target,
        remaining: Math.max(0, target - current)
      };
    });

    return {
      active: items.some(item => item.active),
      modality: normalized.modality,
      week,
      summary,
      items
    };
  }

  /* ------------------------------------------------------------------ */
  /* Busca e filtros do histórico                                        */
  /* ------------------------------------------------------------------ */

  function recordHaystack(record) {
    const parts = [];

    if (typeof record.routineName === "string") parts.push(record.routineName);

    eachExercise(record).forEach(exercise => {
      if (typeof exercise.name === "string") parts.push(exercise.name);
      if (typeof exercise.notes === "string") parts.push(exercise.notes);
      const logs = Array.isArray(exercise.logs) ? exercise.logs : [];
      logs.forEach(log => {
        if (isObject(log) && typeof log.load === "string") parts.push(log.load);
      });
    });

    if (isObject(record.feedback) && typeof record.feedback.note === "string") {
      parts.push(record.feedback.note);
    }

    return normalizeName(parts.join(" "));
  }

  /*
    Filtra o histórico por texto (rotina, exercício, carga digitada e nota),
    status e período. Todos os termos digitados precisam aparecer — a busca é
    por interseção, não por "qualquer palavra".
  */
  function searchRecords(records, filters) {
    const settings = isObject(filters) ? filters : {};
    const inPeriod = filterByPeriod(records, settings.period);
    const query = normalizeName(settings.query);
    const tokens = query ? query.split(" ").filter(Boolean) : [];
    const status = settings.status === "completed" || settings.status === "partial"
      ? settings.status
      : "all";

    return inPeriod.filter(record => {
      if (status !== "all" && record.status !== status) return false;
      if (tokens.length === 0) return true;
      const haystack = recordHaystack(record);
      return tokens.every(token => haystack.indexOf(token) !== -1);
    });
  }

  /* ------------------------------------------------------------------ */

  F.metricas = {
    /* datas */
    recordDate,
    dateKeyOf,
    parseKey,
    formatRecordDate,
    formatFullDate,
    formatDayMonth,
    startOfDay,
    addDays,
    startOfWeek,
    endOfWeek,
    startOfMonth,
    endOfMonth,
    startOfWeekLabel,
    /* períodos */
    resolvePeriod,
    filterByPeriod,
    /* números */
    recordMetrics,
    summarize,
    weeklySeries,
    frequency,
    /* exercícios */
    normalizeName,
    exerciseKey,
    exerciseList,
    exerciseEvolution,
    /* recordes e comparação */
    personalRecords,
    comparePeriods,
    /* metas e busca */
    goalProgress,
    searchRecords,
    /* constantes úteis para a tela */
    WEEKDAY_SHORT,
    WEEKDAY_ORDER,
    DEFAULT_WEEKLY_WEEKS,
    DEFAULT_FREQUENCY_WEEKS,
    EVOLUTION
  };
})(window);
