/*
  FORJA — sessão de treino.

  Regras principais (ver docs/forja-rotinas-e-backup.md, seção 1.5):

  - Todo tempo é calculado a partir de timestamps (Date.now()). Nada depende
    de um contador incrementado a cada chamada: o cronômetro da sessão, o
    cronômetro da série (exercícios por duração) e o descanso sobrevivem a
    pausas, recarregamentos e trocas de página.
  - A sessão ativa fica em localStorage a cada mudança. Qualquer página pode
    retomá-la; a página "executar" é a única que desenha a execução.
  - Concluir uma série é idempotente: o cronômetro e o botão só registram
    uma série uma vez, e cliques repetidos dentro de uma janela curta são
    ignorados.
  - Um único intervalo (workoutTick) é criado por página, pelo módulo app.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const {
    MODE_NAMES,
    SECTION_NAMES,
    KEYS,
    HISTORY_LIMIT,
    cloneData,
    createId,
    formatClock,
    formatRest,
    formatRestValue,
    formatDurationLong,
    escapeHtml,
    byId,
    dateKey,
    showToast,
    showModal,
    saveJSON,
    safeScrollIntoView,
    scrollPageToTop,
    flattenRoutine,
    findRoutine,
    getElapsedMs,
    getRestRemainingMs,
    hasRestState,
    totalCompletedSets,
    currentSessionExercise,
    completedExerciseCount,
    saveActiveWorkout
  } = F;

  /* Janela para ignorar cliques repetidos (duplo toque) no mesmo botão de série. */
  const SET_ACTION_COOLDOWN_MS = 400;

  let lastSetActionAt = 0;
  let lastBannerSecond = -1;
  let summaryVisible = false;

  function session() {
    return F.state.activeWorkout;
  }

  function isExecutionPage() {
    return Boolean(byId("execution-screen"));
  }

  /* Tempo do cronômetro da série (exercício por duração). */

  function timerElapsedMs(timer, now = Date.now()) {
    if (!timer) return 0;
    const running = timer.startedAt && session() && session().running;
    return (Number(timer.accumulatedMs) || 0) +
      (running ? Math.max(0, now - timer.startedAt) : 0);
  }

  F.timerElapsedMs = timerElapsedMs;

  function currentTimerFor(exercise) {
    const s = session();
    if (!s || !exercise || !s.setTimer) return null;
    return s.setTimer.exerciseId === exercise.id ? s.setTimer : null;
  }

  /* Dados das séries: registro usado pelo histórico e pela evolução. */

  function defaultLogDraft(exercise) {
    return {
      reps: exercise.type === "reps" && /^\d+$/.test(String(exercise.reps || ""))
        ? String(exercise.reps)
        : "",
      load: exercise.load || ""
    };
  }

  function getLogDraft(exercise) {
    const s = session();
    const stored = s && s.logDraft ? s.logDraft[exercise.id] : null;
    return stored ? { reps: stored.reps || "", load: stored.load || "" } : defaultLogDraft(exercise);
  }

  /* Início, rotinas e progresso */

  F.startRoutine = function startRoutine(modality, routineId) {
    if (session()) {
      showToast("Já existe uma sessão ativa. Retome ou encerre antes de iniciar outra.");
      F.navigate(F.url("executar"));
      return;
    }

    const routine = findRoutine(modality, routineId);
    if (!routine) return;

    const queue = flattenRoutine(routine).map(exercise => cloneData(exercise));

    if (queue.length === 0) {
      showToast("Adicione ao menos um exercício e salve a rotina antes de iniciar.", "error");
      return;
    }

    const completedSets = {};
    const logs = {};
    queue.forEach(exercise => {
      completedSets[exercise.id] = 0;
      logs[exercise.id] = [];
    });

    F.state.activeWorkout = {
      version: 2,
      id: createId("session"),
      date: dateKey(new Date()),
      modality,
      routineId: routine.id,
      routineName: routine.name,
      startedAt: Date.now(),
      elapsedMs: 0,
      running: true,
      currentIndex: 0,
      completedSets,
      totalPlannedSets: queue.reduce((sum, exercise) => sum + exercise.sets, 0),
      queue,
      status: "active",
      restEndAt: null,
      restRemainingMs: 0,
      restPaused: false,
      pendingAdvance: false,
      restPlannedSeconds: 0,
      setTimer: null,
      setLogs: logs,
      logDraft: {}
    };

    if (!saveActiveWorkout()) {
      F.state.activeWorkout = null;
      updateActiveBanner();
      return;
    }

    F.flash("Treino iniciado. Foco no exercício atual.");
    F.navigate(F.url("executar"));
  };

  /* Descanso */

  function setRestState(seconds, pendingAdvance, baseMs) {
    const s = session();
    if (!s) return;

    const restSeconds = Math.max(0, Number(seconds) || 0);
    const restMs = restSeconds * 1000;
    const start = typeof baseMs === "number" ? baseMs : Date.now();

    s.restRemainingMs = restMs;
    s.restEndAt = restMs > 0 ? start + restMs : null;
    s.restPaused = false;
    s.pendingAdvance = Boolean(pendingAdvance);
    s.restPlannedSeconds = restSeconds;
  }

  function startRestManually() {
    const s = session();
    if (!s || !s.running || hasRestState()) return;
    if (currentTimerFor(currentSessionExercise()) && session().setTimer.startedAt) {
      showToast("Pause ou conclua a série antes de iniciar o descanso.");
      return;
    }

    const exercise = currentSessionExercise();
    if (!exercise || exercise.rest <= 0) return;

    setRestState(exercise.rest, false);
    saveActiveWorkout();
    renderExecution();
    showToast("Descanso iniciado. Você pode pular quando quiser.");
  }

  function notifyRestEnd() {
    const prefs = F.state.preferences || {};
    if (prefs.vibrateOnRest !== false && global.navigator && typeof global.navigator.vibrate === "function") {
      try {
        global.navigator.vibrate([200, 100, 200]);
      } catch (error) {
        // Vibração não suportada neste aparelho.
      }
    }
    if (prefs.soundOnRest !== false) playRestSound();
  }

  function finishRest(options = {}) {
    const s = session();
    if (!s) return;

    const wasPendingAdvance = Boolean(s.pendingAdvance);
    const fromTimer = Boolean(options.timer);

    s.restEndAt = null;
    s.restRemainingMs = 0;
    s.restPaused = false;
    s.pendingAdvance = false;
    s.restPlannedSeconds = 0;

    if (wasPendingAdvance) {
      if (s.currentIndex < s.queue.length - 1) {
        s.currentIndex += 1;
        saveActiveWorkout();
        requestExecutionScroll("top");
        renderExecution();
        updateActiveBanner();

        const next = currentSessionExercise();
        if (fromTimer) notifyRestEnd();
        showToast(
          (fromTimer ? "Descanso concluído. " : "Descanso pulado. ") +
          "Agora: " + (next ? next.name : "próximo exercício") + "."
        );
        return;
      }

      finalizeSession({ natural: true });
      return;
    }

    saveActiveWorkout();
    renderExecution();
    updateActiveBanner();

    if (fromTimer) {
      notifyRestEnd();
      showToast("Descanso concluído. Faça a próxima série quando estiver pronto.");
    } else if (options.manual) {
      showToast("Descanso pulado. Faça a próxima série quando estiver pronto.");
    }
  }

  function pauseRest() {
    const s = session();
    if (!s || !s.restEndAt || !s.running) return;

    s.restRemainingMs = getRestRemainingMs();
    s.restEndAt = null;
    s.restPaused = true;

    saveActiveWorkout();
    renderExecution();
  }

  function resumeRest() {
    const s = session();
    if (!s || !s.restPaused || !s.running) return;

    if (s.restRemainingMs <= 0) {
      finishRest({ manual: true });
      return;
    }

    s.restEndAt = Date.now() + s.restRemainingMs;
    s.restPaused = false;

    saveActiveWorkout();
    renderExecution();
  }

  function skipRest() {
    const s = session();
    if (!s || !s.running) return;
    finishRest({ manual: true });
  }

  /* Cronômetro da série: iniciar, pausar, retomar, pular e concluir */

  function startSetTimer() {
    const s = session();
    if (!s) return;

    if (!s.running) {
      showToast("Retome o treino antes de iniciar a série.", "error");
      return;
    }

    if (hasRestState()) {
      showToast("Aguarde o descanso ou pule-o antes de iniciar a próxima série.");
      return;
    }

    const exercise = currentSessionExercise();
    if (!exercise || exercise.type !== "duration") return;

    const done = Number(s.completedSets[exercise.id]) || 0;
    if (done >= exercise.sets) return;

    // Duplo toque: se o cronômetro desta série já existe, apenas redesenha.
    if (currentTimerFor(exercise) && s.setTimer.setNumber === done + 1) {
      renderExecution();
      return;
    }

    s.setTimer = {
      exerciseId: exercise.id,
      setNumber: done + 1,
      targetMs: exercise.duration * 1000,
      accumulatedMs: 0,
      startedAt: Date.now(),
      status: "running"
    };

    saveActiveWorkout();
    renderExecution();
    showToast("Série " + (done + 1) + " iniciada. O cronômetro está correndo.");
  }

  function pauseSetTimer() {
    const s = session();
    const timer = s && s.setTimer;
    if (!timer || !timer.startedAt) return;

    timer.accumulatedMs = timerElapsedMs(timer);
    timer.startedAt = null;
    timer.status = "paused";

    saveActiveWorkout();
    renderExecution();
  }

  function resumeSetTimer() {
    const s = session();
    const timer = s && s.setTimer;
    if (!timer || timer.status !== "paused") return;

    timer.status = "running";
    timer.startedAt = s.running ? Date.now() : null;

    saveActiveWorkout();
    renderExecution();
  }

  function skipSetTimer() {
    const s = session();
    if (!s || !s.setTimer) return;

    s.setTimer = null;
    saveActiveWorkout();
    renderExecution();
    showToast("Cronômetro descartado. Esta série não foi registrada.");
  }

  /*
    Conclui a série atual. `auto` indica que o cronômetro chegou ao tempo
    planejado; `endedAt` é o instante em que o tempo acabou, usado como base
    do descanso (assim um descanso iniciado com a tela bloqueada fica correto).
  */
  function registerSet(options = {}) {
    const s = session();
    if (!s) return false;

    const exercise = currentSessionExercise();
    if (!exercise) return false;

    const done = Number(s.completedSets[exercise.id]) || 0;
    if (done >= exercise.sets) return false;

    const timer = currentTimerFor(exercise);
    if (options.auto && !timer) return false;

    const now = Date.now();
    const endedAt = typeof options.endedAt === "number" ? options.endedAt : now;
    const seconds = timer
      ? Math.round((options.auto ? timer.targetMs : timerElapsedMs(timer, now)) / 1000)
      : null;

    const draft = s.logDraft && s.logDraft[exercise.id]
      ? s.logDraft[exercise.id]
      : defaultLogDraft(exercise);

    const setNumber = done + 1;
    s.completedSets[exercise.id] = setNumber;
    s.setLogs = s.setLogs || {};
    s.setLogs[exercise.id] = (s.setLogs[exercise.id] || []).concat([{
      set: setNumber,
      reps: exercise.type === "reps" ? String(draft.reps || "").trim().slice(0, 30) : "",
      load: s.modality === "weights" ? String(draft.load || "").trim().slice(0, 50) : "",
      seconds
    }]);
    s.setTimer = null;

    const isLastExercise = s.currentIndex >= s.queue.length - 1;
    const exerciseFinished = setNumber >= exercise.sets;
    let restStarted = false;
    let advanced = false;

    if (exerciseFinished) {
      if (isLastExercise) {
        saveActiveWorkout();
        finalizeSession({ natural: true });
        return true;
      }

      if (exercise.rest > 0) {
        setRestState(exercise.rest, true, endedAt);
        restStarted = true;
      } else {
        s.currentIndex += 1;
        advanced = true;
      }
    } else if (exercise.rest > 0) {
      setRestState(exercise.rest, false, endedAt);
      restStarted = true;
    }

    saveActiveWorkout();
    if (restStarted) requestExecutionScroll("rest");
    if (advanced) requestExecutionScroll("top");
    renderExecution();
    updateActiveBanner();

    if (options.auto) {
      showToast(
        "Tempo da série " + setNumber + " de " + exercise.sets + " concluído." +
        (restStarted ? " Descanso iniciado." : "")
      );
    } else if (restStarted) {
      showToast(
        "Série " + setNumber + " de " + exercise.sets + " concluída. " +
        (exerciseFinished
          ? "Descanso antes do próximo exercício."
          : "Descanso iniciado.")
      );
    } else if (advanced) {
      const next = currentSessionExercise();
      showToast("Exercício concluído." + (next ? " Agora: " + next.name + "." : ""));
    } else {
      showToast("Série " + setNumber + " de " + exercise.sets + " concluída.");
    }

    return true;
  }

  /* Botão "Concluir série": protegido contra cliques repetidos. */
  function completeCurrentSet() {
    const s = session();
    if (!s) return;

    if (!s.running) {
      showToast("Retome o treino antes de concluir uma série.", "error");
      return;
    }

    if (hasRestState()) {
      showToast("Pule o descanso antes de concluir a próxima série.");
      return;
    }

    const now = Date.now();
    if (now - lastSetActionAt < SET_ACTION_COOLDOWN_MS) return;
    lastSetActionAt = now;

    registerSet({ endedAt: now });
  }

  /* Verifica se o cronômetro da série chegou ao fim (chamado a cada tick). */
  function settleSetTimer(now = Date.now()) {
    const s = session();
    const timer = s && s.setTimer;
    if (!timer || !timer.startedAt || !s.running) return false;

    const elapsed = timerElapsedMs(timer, now);
    if (elapsed < timer.targetMs) return false;

    const endedAt = timer.startedAt + Math.max(0, timer.targetMs - timer.accumulatedMs);
    return registerSet({ auto: true, endedAt });
  }

  /* Navegação entre exercícios */

  function requestExecutionScroll(target) {
    pendingScrollTarget = target;
  }

  let pendingScrollTarget = null;

  function applyExecutionScroll() {
    if (!pendingScrollTarget) return;

    const target = pendingScrollTarget;
    pendingScrollTarget = null;

    if (!isExecutionPage()) return;

    if (target === "rest") {
      safeScrollIntoView(byId("execution-rest"));
      return;
    }

    if (target === "top") {
      scrollPageToTop();
    }
  }

  function goToPreviousExercise() {
    const s = session();
    if (!s || hasRestState() || s.setTimer) return;
    if (s.currentIndex <= 0) return;

    s.currentIndex -= 1;
    saveActiveWorkout();
    requestExecutionScroll("top");
    renderExecution();
  }

  function goToNextExercise() {
    const s = session();
    if (!s || hasRestState() || s.setTimer) return;

    const exercise = currentSessionExercise();
    if (!exercise) return;

    const done = Number(s.completedSets[exercise.id]) || 0;
    if (done < exercise.sets) return;

    if (s.currentIndex < s.queue.length - 1) {
      s.currentIndex += 1;
      saveActiveWorkout();
      requestExecutionScroll("top");
      renderExecution();
      return;
    }

    finalizeSession({ natural: true });
  }

  /* Pular exercício: segue adiante sem concluí-lo (fica pendente no registro). */
  function skipExercise() {
    const s = session();
    if (!s || hasRestState() || s.setTimer) return;

    if (s.currentIndex >= s.queue.length - 1) {
      showToast("Este é o último exercício. Use Concluir treino ou Encerrar sessão.");
      return;
    }

    const skipped = currentSessionExercise();
    s.currentIndex += 1;
    saveActiveWorkout();
    requestExecutionScroll("top");
    renderExecution();
    showToast("Exercício pulado: " + (skipped ? skipped.name : "") +
      ". Ele ficará pendente no registro.");
  }

  function updateLogDraft() {
    const s = session();
    const exercise = currentSessionExercise();
    if (!s || !exercise) return;

    s.logDraft = s.logDraft || {};
    s.logDraft[exercise.id] = {
      reps: byId("log-reps").value.slice(0, 30),
      load: byId("log-load").value.slice(0, 50)
    };

    saveActiveWorkout();
  }

  /* Pausa e retomada da sessão inteira */

  function pauseSession(options = {}) {
    const s = session();
    if (!s || !s.running) return;

    // Antes de pausar, aplica o que já venceu (série ou descanso).
    settleSetTimer();
    if (!session() || !session().running) return;

    s.elapsedMs = getElapsedMs();
    s.running = false;
    s.startedAt = null;

    if (s.restEndAt && !s.restPaused) {
      const remaining = Math.max(0, s.restEndAt - Date.now());
      s.restRemainingMs = remaining;
      s.restEndAt = null;
      s.restPaused = remaining > 0;
    }

    if (s.setTimer && s.setTimer.startedAt) {
      s.setTimer.accumulatedMs = timerElapsedMs(s.setTimer);
      s.setTimer.startedAt = null;
    }

    saveActiveWorkout();
    updateActiveBanner();
    renderExecution();

    if (!options.silent) {
      showToast("Treino pausado. Retome quando estiver pronto.");
    }
  }

  function resumeSession() {
    const s = session();
    if (!s || s.running) return;

    s.running = true;
    s.startedAt = Date.now();

    if (s.restPaused && s.restRemainingMs > 0) {
      s.restEndAt = Date.now() + s.restRemainingMs;
      s.restPaused = false;
    }

    if (s.setTimer && s.setTimer.status === "running") {
      s.setTimer.startedAt = Date.now();
    }

    const pendingWithoutRest = s.pendingAdvance && !s.restEndAt && !s.restPaused;

    saveActiveWorkout();
    updateActiveBanner();
    renderExecution();

    if (pendingWithoutRest) {
      finishRest({ timer: false });
      return;
    }

    showToast("Treino retomado.");
  }

  /* Encerramento: registro no histórico */

  function buildSessionRecord() {
    const s = session();
    if (!s) return null;

    const completed = totalCompletedSets();
    const status = completed >= s.totalPlannedSets ? "completed" : "partial";

    return {
      id: s.id,
      date: s.date,
      modality: s.modality,
      routineId: s.routineId,
      routineName: s.routineName,
      durationMs: getElapsedMs(),
      completedSets: completed,
      totalPlannedSets: s.totalPlannedSets,
      status,
      finishedAt: new Date().toISOString(),
      exercises: s.queue.map(exercise => {
        const logs = Array.isArray(s.setLogs && s.setLogs[exercise.id])
          ? s.setLogs[exercise.id]
          : [];

        return {
          id: exercise.id,
          name: exercise.name,
          section: exercise.section,
          plannedSets: exercise.sets,
          completedSets: Number(s.completedSets[exercise.id]) || 0,
          reps: exercise.reps,
          duration: exercise.duration,
          type: exercise.type,
          rest: exercise.rest,
          load: exercise.load || "",
          notes: exercise.notes || "",
          logs: logs.map(entry => ({
            set: entry.set,
            reps: entry.reps || "",
            load: entry.load || "",
            seconds: entry.seconds
          })),
          timedSeconds: logs.reduce((sum, entry) => {
            return sum + (Number(entry.seconds) || 0);
          }, 0)
        };
      })
    };
  }

  function persistHistoryRecord(record) {
    if (!record) return false;

    if (F.state.history.some(item => F.isPlainObject(item) && item.id === record.id)) {
      return true;
    }

    const previous = F.state.history.slice();
    F.state.history.unshift(record);

    if (F.state.history.length > HISTORY_LIMIT) {
      F.state.history = F.state.history.slice(0, HISTORY_LIMIT);
    }

    if (!saveJSON(KEYS.history, F.state.history)) {
      F.state.history = previous;
      return false;
    }

    return true;
  }

  function finalizeSession(options = {}) {
    const s = session();
    if (!s) return false;

    const record = buildSessionRecord();
    if (!record) return false;

    if (!persistHistoryRecord(record)) {
      renderExecution();
      showModal({
        title: "Não foi possível salvar o histórico",
        message: "Seu treino continua ativo. Verifique o espaço disponível no navegador e use \"Encerrar sessão\" para tentar novamente.",
        actions: [
          { id: "close", label: "Fechar", className: "secondary-button" }
        ]
      });
      return false;
    }

    F.state.activeWorkout = null;
    saveActiveWorkout();
    updateActiveBanner();

    if (isExecutionPage()) {
      showSessionSummary(record);
    } else {
      showToast(
        record.status === "completed"
          ? "Treino concluído e registrado no histórico."
          : "Treino encerrado. O progresso parcial foi registrado.",
        "info",
        5000
      );
    }

    return true;
  }

  function discardCurrentSession() {
    const s = session();
    const modality = s ? s.modality : "calisthenics";

    F.state.activeWorkout = null;
    saveActiveWorkout();

    F.flash("Sessão descartada. Nenhum treino foi registrado no histórico.");
    F.navigate(F.modalityUrl(modality));
  }

  async function openEndSessionDialog() {
    const s = session();
    if (!s) return;

    const completed = totalCompletedSets();
    const planned = s.totalPlannedSets;
    const details = document.createElement("div");
    details.className = "modal-details";
    details.innerHTML =
      "<strong>" + escapeHtml(s.routineName) + "</strong><br>" +
      MODE_NAMES[s.modality] + " · " +
      formatClock(Math.floor(getElapsedMs() / 1000)) + " de duração<br>" +
      completed + " de " + planned + " séries concluídas.";

    const actions = [
      { id: "cancel", label: "Continuar treinando", className: "secondary-button" }
    ];

    if (completed > 0) {
      actions.push({
        id: "save",
        label: completed >= planned ? "Concluir e salvar" : "Salvar e encerrar",
        className: "primary-button"
      });
    }

    actions.push({
      id: "discard",
      label: "Descartar sessão",
      className: "secondary-button danger-button"
    });

    const result = await showModal({
      title: "Encerrar sessão?",
      message: "Você pode registrar o progresso no histórico ou descartar esta sessão sem registrar um treino.",
      details,
      actions
    });

    if (result.action === "save") {
      finalizeSession({ natural: false });
    } else if (result.action === "discard") {
      discardCurrentSession();
    }
  }

  /* Resumo final (na página de execução) */

  function showSessionSummary(record) {
    if (!record || !isExecutionPage()) return;

    summaryVisible = true;
    byId("execution-live").hidden = true;
    byId("execution-footer").hidden = true;
    byId("execution-empty").hidden = true;
    byId("execution-summary").hidden = false;

    const completed = Number(record.completedSets) || 0;
    const planned = Number(record.totalPlannedSets) || 0;
    const exercises = Array.isArray(record.exercises) ? record.exercises : [];
    const finishedExercises = exercises.filter(exercise => {
      return Number(exercise.completedSets) >= Number(exercise.plannedSets);
    }).length;

    const modeName = MODE_NAMES[record.modality] || "Treino";

    byId("summary-routine").textContent = modeName + " · " + (record.routineName || "Treino");
    byId("summary-title").textContent = record.status === "completed"
      ? "Treino concluído"
      : "Sessão encerrada";
    byId("summary-description").textContent = record.status === "completed"
      ? "Sua sessão foi registrada no histórico desta modalidade."
      : "O progresso parcial foi registrado no histórico desta modalidade.";
    byId("summary-duration").textContent = formatDurationLong(record.durationMs);
    byId("summary-sets").textContent = completed + "/" + planned;
    byId("summary-exercises-stat").textContent = finishedExercises + "/" + exercises.length;
    byId("summary-status-stat").textContent = record.status === "completed"
      ? "Concluído"
      : "Parcial";

    const list = byId("summary-exercises");
    list.innerHTML = "";

    exercises.forEach(exercise => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = exercise.name;
      const value = document.createElement("span");
      value.textContent = (Number(exercise.completedSets) || 0) + "/" +
        (Number(exercise.plannedSets) || 0) + " séries";
      item.append(name, value);
      list.appendChild(item);
    });

    const historyLink = byId("summary-history-link");
    if (historyLink) historyLink.href = F.url("progresso", { modalidade: record.modality });

    byId("summary-close").focus();
    scrollPageToTop();
  }

  /* Volta para a modalidade. A sessão continua salva e pode ser retomada. */
  function leaveExecution() {
    const s = session();

    if (s && s.running) {
      pauseSession({ silent: true });
    }

    F.flash("Treino pausado. Use o aviso no topo para retomar.");
    F.navigate(F.modalityUrl(s ? s.modality : "calisthenics"));
  }

  /* Áudio e vibração ao fim do descanso (respeitam as preferências). */
  function playRestSound() {
    try {
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;

      if (!AudioContextClass) return;

      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.1;

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start();
      oscillator.stop(context.currentTime + 0.22);

      oscillator.onended = () => {
        context.close().catch(() => {});
      };
    } catch (error) {
      // O navegador pode bloquear áudio automático.
    }
  }

  /* Banner de sessão ativa (aparece em todas as páginas) */

  function updateActiveBanner() {
    const banner = byId("active-session-banner");
    if (!banner) return;

    const s = session();
    if (!s || isExecutionPage()) {
      banner.hidden = true;
      return;
    }

    const elapsed = formatClock(Math.floor(getElapsedMs() / 1000));
    const state = s.running ? "" : " · pausado";

    byId("active-session-summary").textContent =
      MODE_NAMES[s.modality] + " · " + s.routineName + " · " + elapsed + state;

    const resume = byId("resume-active-session");
    if (resume) resume.href = F.url("executar");
    const end = byId("end-active-session");
    if (end) end.href = F.url("executar", { encerrar: "1" });

    banner.hidden = false;
  }

  F.updateActiveBanner = updateActiveBanner;

  /* Renderização da página de execução */

  function renderExecution() {
    if (!isExecutionPage() || summaryVisible) return;

    const s = session();
    const live = byId("execution-live");
    const empty = byId("execution-empty");

    if (!s) {
      live.hidden = true;
      byId("execution-footer").hidden = true;
      empty.hidden = false;
      return;
    }

    live.hidden = false;
    byId("execution-footer").hidden = false;
    empty.hidden = true;

    const exercise = currentSessionExercise();
    if (!exercise) {
      finalizeSession({ natural: true });
      return;
    }

    const queue = s.queue;
    const done = Number(s.completedSets[exercise.id]) || 0;
    const totalDone = totalCompletedSets();
    const percent = s.totalPlannedSets > 0
      ? Math.min(100, Math.round(totalDone / s.totalPlannedSets * 100))
      : 0;
    const restActive = hasRestState();
    const timer = currentTimerFor(exercise);
    const isTimed = exercise.type === "duration";

    byId("execution-mode").textContent =
      MODE_NAMES[s.modality].toUpperCase() + " · SESSÃO ATIVA";
    byId("execution-title").textContent = s.routineName;
    byId("execution-clock").textContent = formatClock(Math.floor(getElapsedMs() / 1000));

    byId("execution-position").textContent =
      "Exercício " + (s.currentIndex + 1) + " de " + queue.length;
    byId("execution-progress-label").textContent =
      totalDone + " / " + s.totalPlannedSets + " séries";
    byId("execution-progress-fill").style.width = percent + "%";

    byId("current-section").textContent = SECTION_NAMES[exercise.section] || "Treino";
    byId("current-position").textContent =
      "Exercício " + (s.currentIndex + 1) + " de " + queue.length;
    byId("current-name").textContent = exercise.name;

    const plan = byId("current-plan");
    plan.innerHTML = "";

    const setsChip = document.createElement("span");
    setsChip.className = "plan-chip";
    setsChip.textContent = exercise.sets + " séries";
    plan.appendChild(setsChip);

    const targetChip = document.createElement("span");
    targetChip.className = "plan-chip";
    targetChip.textContent = isTimed
      ? formatRestValue(exercise.duration) + " por série"
      : exercise.reps + " repetições";
    plan.appendChild(targetChip);

    if (exercise.load) {
      const loadChip = document.createElement("span");
      loadChip.className = "plan-chip";
      loadChip.textContent = "Carga: " + exercise.load;
      plan.appendChild(loadChip);
    }

    byId("current-sets-value").innerHTML = "";
    byId("current-sets-value").appendChild(document.createTextNode(String(done) + " "));
    const totalSmall = document.createElement("small");
    totalSmall.textContent = "/ " + exercise.sets;
    byId("current-sets-value").appendChild(totalSmall);

    const plannedValue = byId("current-plan-value");
    plannedValue.innerHTML = "";
    plannedValue.appendChild(document.createTextNode(
      (isTimed ? String(exercise.duration) : exercise.reps) + " "
    ));
    const plannedUnit = document.createElement("small");
    plannedUnit.textContent = isTimed ? "seg" : "reps";
    plannedValue.appendChild(plannedUnit);

    byId("current-rest-value").textContent = exercise.rest > 0
      ? formatRest(exercise.rest)
      : "Sem descanso";

    const notes = byId("session-notes");
    if (exercise.notes) {
      byId("session-notes-text").textContent = exercise.notes;
      notes.hidden = false;
    } else {
      byId("session-notes-text").textContent = "";
      notes.hidden = true;
    }

    const pips = byId("set-pips");
    pips.innerHTML = "";
    for (let index = 0; index < exercise.sets; index++) {
      const pip = document.createElement("span");
      pip.className = "set-pip" + (index < done ? " done" : "");
      pips.appendChild(pip);
    }

    byId("set-count-label").textContent = "Séries concluídas";
    byId("set-progress-label").textContent = done + " de " + exercise.sets;

    renderTimerPanel(exercise, done, timer, restActive);
    renderLogPanel(exercise, done);

    const completeButton = byId("complete-set");
    completeButton.hidden = isTimed;
    completeButton.disabled = false;

    if (!isTimed) {
      if (!s.running) {
        completeButton.textContent = "Retome o treino para continuar";
        completeButton.disabled = true;
      } else if (restActive) {
        completeButton.textContent = "Aguarde o descanso";
        completeButton.disabled = true;
      } else if (done >= exercise.sets) {
        completeButton.textContent = "Séries concluídas";
        completeButton.disabled = true;
      } else {
        completeButton.textContent = "Concluir série " + (done + 1) + " de " + exercise.sets;
      }
    }

    const startRestButton = byId("start-rest");
    const canStartRest = s.running &&
      !restActive &&
      !(timer && timer.startedAt) &&
      exercise.rest > 0 &&
      done < exercise.sets;

    startRestButton.hidden = !canStartRest;
    startRestButton.textContent = "Iniciar descanso (" + formatRest(exercise.rest) + ")";

    const blocked = restActive || Boolean(s.setTimer);

    const previousButton = byId("previous-exercise");
    previousButton.disabled = s.currentIndex <= 0 || blocked;
    previousButton.hidden = false;

    const exerciseDone = done >= exercise.sets;
    const hasNext = s.currentIndex < queue.length - 1;
    const canAdvance = exerciseDone && !restActive;

    const nextButton = byId("next-exercise");
    nextButton.hidden = !canAdvance;
    if (canAdvance) {
      nextButton.textContent = hasNext ? "Próximo exercício →" : "Concluir treino →";
      nextButton.disabled = false;
    }

    const skipButton = byId("skip-exercise");
    skipButton.hidden = exerciseDone || !hasNext;
    skipButton.disabled = blocked;

    byId("pause-session").hidden = !s.running;
    byId("resume-session").hidden = s.running;
    byId("session-paused-overlay").hidden = s.running;

    renderRestPanel();
    updateExecutionClockText();
    applyExecutionScroll();
  }

  function renderTimerPanel(exercise, done, timer, restActive) {
    const s = session();
    const panel = byId("timer-panel");
    const isTimed = exercise.type === "duration";

    panel.hidden = !isTimed;
    if (!isTimed) return;

    const finished = done >= exercise.sets;
    const running = Boolean(timer && timer.startedAt && s.running);
    const paused = Boolean(timer && !running);

    byId("set-timer-start").hidden = Boolean(timer) || finished || !s.running || restActive;
    byId("set-timer-start").disabled = restActive;
    byId("set-timer-manual").hidden = Boolean(timer) || finished;
    byId("set-timer-pause").hidden = !running;
    byId("set-timer-resume").hidden = !(timer && timer.status === "paused" && s.running);
    byId("set-timer-finish").hidden = !timer || finished;
    byId("set-timer-skip").hidden = !timer;

    byId("set-timer-start").textContent = "Iniciar série " + (done + 1) +
      " (" + formatRestValue(exercise.duration) + ")";

    updateSetTimerClock();

    byId("set-timer-status").textContent = finished
      ? "Séries concluídas"
      : timer
        ? (running ? "Em andamento" : (s.running ? "Pausado" : "Treino pausado"))
        : "Série " + (done + 1) + " de " + exercise.sets + " · pronta para começar";

    byId("set-timer-caption").textContent = !timer && !finished
      ? "O tempo planejado é " + formatRestValue(exercise.duration) +
        ". O cronômetro registra a série sozinho quando o tempo acabar."
      : paused && !s.running
        ? "Pausado junto com o treino."
        : "";

    panel.classList.toggle("is-running", running);
    panel.classList.toggle("is-paused", paused);
  }

  /* Atualiza só o mostrador do cronômetro (chamado a cada tick). */
  function updateSetTimerClock() {
    const s = session();
    const panel = byId("timer-panel");
    if (!s || !panel || panel.hidden) return;

    const exercise = currentSessionExercise();
    if (!exercise || exercise.type !== "duration") return;

    const timer = currentTimerFor(exercise);
    const now = Date.now();
    const elapsed = timer ? timerElapsedMs(timer, now) : 0;
    const remaining = timer ? Math.max(0, timer.targetMs - elapsed) : exercise.duration * 1000;
    const ratio = timer && timer.targetMs > 0
      ? Math.min(1, elapsed / timer.targetMs)
      : 0;

    byId("set-timer-display").textContent = formatClock(Math.ceil(remaining / 1000));
    byId("set-timer-elapsed").textContent = timer
      ? "Decorrido " + formatClock(Math.floor(elapsed / 1000))
      : "Aguardando início";
    byId("set-timer-fill").style.width = Math.round(ratio * 100) + "%";
  }

  function renderLogPanel(exercise, done) {
    const s = session();
    const panel = byId("log-panel");
    const draft = getLogDraft(exercise);
    const isTimed = exercise.type === "duration";
    const isWeights = s.modality === "weights";

    byId("log-reps-field").hidden = isTimed;
    byId("log-load-field").hidden = !isWeights;
    panel.hidden = false;

    const repsInput = byId("log-reps");
    const loadInput = byId("log-load");

    if (document.activeElement !== repsInput) repsInput.value = draft.reps;
    if (document.activeElement !== loadInput) loadInput.value = draft.load;
    repsInput.placeholder = exercise.type === "reps" ? String(exercise.reps) : "";
    loadInput.placeholder = exercise.load || "Ex.: 20 kg";

    const list = byId("log-list");
    list.innerHTML = "";

    const logs = Array.isArray(s.setLogs && s.setLogs[exercise.id])
      ? s.setLogs[exercise.id]
      : [];

    if (logs.length === 0) {
      const empty = document.createElement("li");
      empty.className = "log-empty";
      empty.textContent = done > 0
        ? "Nenhuma série com registro detalhado."
        : "Registre as séries conforme forem concluídas.";
      list.appendChild(empty);
      return;
    }

    logs.forEach(entry => {
      const item = document.createElement("li");
      const parts = ["Série " + entry.set];

      if (entry.reps) parts.push(entry.reps + " reps");
      if (entry.load) parts.push(entry.load);
      if (typeof entry.seconds === "number") parts.push(formatClock(entry.seconds) + " de tempo");

      item.textContent = parts.join(" · ");
      list.appendChild(item);
    });
  }

  function renderRestPanel() {
    const panel = byId("execution-rest");
    const s = session();
    const active = Boolean(s && hasRestState());

    panel.hidden = !active;
    if (!active) return;

    const exercise = currentSessionExercise();
    const done = exercise ? Number(s.completedSets[exercise.id]) || 0 : 0;
    const paused = s.restPaused || !s.running;

    byId("rest-timer").textContent = formatClock(Math.ceil(getRestRemainingMs() / 1000));

    if (paused) {
      byId("rest-caption").textContent = "Descanso pausado.";
    } else if (s.pendingAdvance) {
      const next = s.queue[s.currentIndex + 1];
      byId("rest-caption").textContent = next
        ? "Descanse. Depois o treino avança para " + next.name + "."
        : "Descanse antes de concluir o treino.";
    } else if (exercise && done < exercise.sets) {
      byId("rest-caption").textContent =
        "Respire e prepare-se para a série " + (done + 1) + " de " + exercise.sets + ".";
    } else {
      byId("rest-caption").textContent = "Respire e prepare-se para o próximo exercício.";
    }

    byId("pause-rest").hidden = paused || !s.restEndAt;
    byId("resume-rest").hidden = !s.restPaused || !s.running;
    byId("skip-rest").disabled = !s.running;
    byId("skip-rest").textContent = s.pendingAdvance
      ? "Pular e avançar"
      : "Pular descanso";
  }

  function updateExecutionClockText() {
    if (!session() || !isExecutionPage()) return;

    byId("execution-clock").textContent = formatClock(Math.floor(getElapsedMs() / 1000));
    byId("rest-timer").textContent = formatClock(Math.ceil(getRestRemainingMs() / 1000));
    updateSetTimerClock();
  }

  /* Resumo (quando o treino é concluído ou encerrado na página de execução). */

  function showSummaryById(recordId) {
    const record = F.state.history.find(item => {
      return F.isPlainObject(item) && item.id === recordId;
    });

    if (record) {
      showSessionSummary(record);
    }
  }

  function closeSessionSummary() {
    summaryVisible = false;
    const modality = F.state.history.length > 0 ? F.state.history[0].modality : "calisthenics";
    F.navigate(F.modalityUrl(modality));
  }

  /* Ciclo de um tick: um único intervalo por página, criado pelo módulo app. */
  F.workoutTick = function workoutTick() {
    const s = session();
    if (!s) {
      updateActiveBanner();
      return;
    }

    const now = Date.now();

    if (s.running && s.restEndAt && !s.restPaused && s.restEndAt <= now) {
      finishRest({ timer: true });
      return;
    }

    if (s.running && s.pendingAdvance && !hasRestState()) {
      finishRest({ timer: false });
      return;
    }

    if (s.running && settleSetTimer(now)) {
      return;
    }

    if (isExecutionPage()) {
      updateExecutionClockText();
      return;
    }

    const second = Math.floor(getElapsedMs() / 1000);
    if (second !== lastBannerSecond) {
      lastBannerSecond = second;
      updateActiveBanner();
    }
  };

  /* Página "executar" */

  F.pages.executar = function initExecution() {
    const bind = (id, handler) => {
      const element = byId(id);
      if (element) element.addEventListener("click", handler);
    };

    bind("complete-set", completeCurrentSet);
    bind("start-rest", startRestManually);
    bind("previous-exercise", goToPreviousExercise);
    bind("next-exercise", goToNextExercise);
    bind("skip-exercise", skipExercise);
    bind("pause-rest", pauseRest);
    bind("resume-rest", resumeRest);
    bind("skip-rest", skipRest);
    bind("pause-session", () => pauseSession());
    bind("resume-session", resumeSession);
    bind("end-session", openEndSessionDialog);
    bind("minimize-session", leaveExecution);
    bind("summary-close", closeSessionSummary);
    bind("set-timer-start", startSetTimer);
    bind("set-timer-pause", pauseSetTimer);
    bind("set-timer-resume", resumeSetTimer);
    bind("set-timer-finish", completeCurrentSet);
    bind("set-timer-skip", skipSetTimer);
    bind("set-timer-manual", () => {
      const now = Date.now();
      if (now - lastSetActionAt < SET_ACTION_COOLDOWN_MS) return;
      lastSetActionAt = now;
      registerSet({ endedAt: now });
    });

    ["log-reps", "log-load"].forEach(id => {
      const input = byId(id);
      if (input) input.addEventListener("input", updateLogDraft);
    });

    const params = new URLSearchParams(global.location.search);
    const summaryId = params.get("resumo");

    if (summaryId) {
      showSummaryById(summaryId);
      return;
    }

    if (!session()) {
      renderExecution();
      return;
    }

    renderExecution();

    if (params.get("encerrar") === "1") {
      openEndSessionDialog();
    }
  };

  /* Exposição para o módulo de treino (rotinas) e para os testes. */
  F.renderExecution = renderExecution;
  F.finalizeSession = finalizeSession;
  F.registerSet = registerSet;
  F.pauseSession = pauseSession;
  F.resumeSession = resumeSession;
  F.settleSetTimer = settleSetTimer;
  F.setRestState = setRestState;
  F.finishRest = finishRest;
  F.completedExerciseCount = completedExerciseCount;
  F.persistHistoryRecord = persistHistoryRecord;
  F.buildSessionRecord = buildSessionRecord;
})(window);
