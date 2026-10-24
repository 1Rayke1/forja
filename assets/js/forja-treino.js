/*
  FORJA — treino: hub, listas de rotinas por modalidade e editor de rotina.

  - treino/index.html        → hub com CALISTENIA e MUSCULAÇÃO (vertical).
  - calistenia.html /
    musculacao.html          → rotinas da modalidade e histórico recente.
  - treino/rotina.html       → editor (criar/editar exercícios, biblioteca).

  Rotinas de calistenia e musculação ficam em listas separadas
  (F.state.routines.calisthenics / .weights). Nenhuma página altera a outra.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const {
    KEYS,
    MODE_NAMES,
    MODE_DESCRIPTIONS,
    SECTION_ORDER,
    SECTION_NAMES,
    isPlainObject,
    cloneData,
    createId,
    escapeHtml,
    byId,
    formatRest,
    formatExerciseMeta,
    formatDurationLong,
    showToast,
    showModal,
    saveJSON,
    safeScrollIntoView,
    flattenRoutine,
    countRoutineExercises,
    findRoutine,
    getModeRoutines,
    getRoutineTotalSets,
    normalizeExercise,
    /* A resolução/formatação de data do histórico é compartilhada (etapa 5). */
    metricas
  } = F;

  const MODALITIES = ["calisthenics", "weights"];
  const RECENT_HISTORY = 5;

  function isModality(value) {
    return MODALITIES.indexOf(value) !== -1;
  }

  function pluralize(count, singular, plural) {
    return count + " " + (count === 1 ? singular : plural);
  }

  /* Texto normalizado para busca (ignora acentos e maiúsculas). */
  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function sectionCounts(routine) {
    return SECTION_ORDER.map(section => {
      const list = Array.isArray(routine.sections && routine.sections[section])
        ? routine.sections[section]
        : [];
      return { section, count: list.length };
    });
  }

  function modalityHistory(modality) {
    return F.state.history.filter(record => {
      return isPlainObject(record) && record.modality === modality;
    });
  }

  /* Hub */

  function renderHub() {
    let totalRoutines = 0;

    MODALITIES.forEach(modality => {
      const meta = byId(modality === "calisthenics" ? "home-calisthenics-meta" : "home-weights-meta");
      const routines = getModeRoutines(modality).length;
      totalRoutines += routines;
      if (!meta) return;

      const records = modalityHistory(modality).length;
      meta.textContent = pluralize(routines, "rotina", "rotinas") + " · " +
        pluralize(records, "treino registrado", "treinos registrados");
    });

    const createLink = byId("hub-create-routine");
    if (createLink) {
      createLink.href = F.url("rotina", { nova: "1" });
      createLink.textContent = totalRoutines === 0
        ? "Criar primeira rotina"
        : "Criar nova rotina";
    }
  }

  F.pages.treino = function initTreinoHub() {
    renderHub();
    F.onDataChanged(renderHub);
    watchExternalChanges(
      [KEYS.routines, KEYS.legacyExercises, KEYS.history, KEYS.active, KEYS.rotation],
      renderHub
    );
  };

  /* Lista de rotinas e histórico da modalidade */

  let currentModality = null;

  function commitRoutines(previous) {
    if (F.saveRoutines()) return true;
    F.state.routines = previous;
    return false;
  }

  /*
    Sincronização somente-leitura com o que outra aba/janela gravou (mesmo
    padrão da Home): `F.syncStateFromStorage` nunca grava, arquiva ou migra —
    só atualiza a memória. Usada antes de mutações para nunca sobrescrever o
    conjunto inteiro de rotinas/biblioteca com um snapshot desatualizado, e
    pelos vigias de `storage`/`pageshow` para redesenhar a tela atual.
  */
  function syncKeyFromStorage(key) {
    if (typeof F.syncStateFromStorage === "function") {
      F.syncStateFromStorage(key === undefined ? null : key);
    }
  }

  function watchExternalChanges(keys, refresh) {
    global.addEventListener("storage", event => {
      if (!event) return;
      if (event.key !== null && keys.indexOf(event.key) === -1) return;
      syncKeyFromStorage(event.key);
      refresh();
    });

    /* Retorno via BFCache: o boot não roda de novo, então relê e redesenha. */
    global.addEventListener("pageshow", event => {
      if (!event || !event.persisted) return;
      syncKeyFromStorage(null);
      refresh();
    });
  }

  function reconcileRotation() {
    if (typeof F.reconcileRotationAfterRoutineChange === "function") {
      F.reconcileRotationAfterRoutineChange();
    }
  }

  /* Nome comparável: espaços externos fora, sem diferenciar caixa. */
  function comparableName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function routineNameTaken(name, modality, excludeRoutineId) {
    const target = comparableName(name);
    if (!target) return false;

    return getModeRoutines(modality).some(routine => {
      return routine.id !== excludeRoutineId &&
        comparableName(routine.name) === target;
    });
  }

  function nextRoutineName(modality) {
    const used = new Set(getModeRoutines(modality).map(routine => routine.name));
    for (let index = 0; index < 26; index++) {
      const candidate = "Treino " + String.fromCharCode(65 + index);
      if (!used.has(candidate)) return candidate;
    }
    let counter = 27;
    while (used.has("Treino " + counter)) counter++;
    return "Treino " + counter;
  }

  function uniqueCopyName(baseName, modality) {
    const used = new Set(getModeRoutines(modality).map(routine => routine.name));
    const first = baseName + " (cópia)";
    if (!used.has(first)) return first;
    let counter = 2;
    while (used.has(baseName + " (cópia " + counter + ")")) counter++;
    return baseName + " (cópia " + counter + ")";
  }

  function editorUrl(modality, routineId) {
    return F.url("rotina", { modalidade: modality, id: routineId });
  }

  async function createRoutine() {
    const result = await showModal({
      title: "Nova rotina",
      message: "Dê um nome para a rotina. Você poderá adicionar exercícios em seguida.",
      fields: [{ id: "name", label: "Nome da rotina", value: nextRoutineName(currentModality), maxlength: 60 }],
      submitActions: ["create"],
      validate(values) {
        const name = (values.name || "").trim().slice(0, 60);
        if (!name) {
          return { ok: false, errors: { name: "Informe um nome para a rotina." } };
        }

        /* Confere contra o estado fresco, sem fechar o modal em caso de erro. */
        syncKeyFromStorage(KEYS.routines);
        if (routineNameTaken(name, currentModality, null)) {
          return {
            ok: false,
            errors: {
              name: "Já existe uma rotina chamada \"" + name + "\" em " +
                MODE_NAMES[currentModality] + ". Escolha outro nome."
            }
          };
        }

        return { ok: true };
      },
      actions: [
        { id: "cancel", label: "Cancelar", className: "secondary-button" },
        { id: "create", label: "Criar rotina", className: "primary-button" }
      ]
    });

    if (result.action !== "create") return;

    const name = (result.values.name || "").trim().slice(0, 60);
    if (!name) {
      showToast("Informe um nome para a rotina.", "error");
      return;
    }

    /* Outra aba pode ter mexido nas rotinas enquanto o modal estava aberto. */
    syncKeyFromStorage(KEYS.routines);

    if (routineNameTaken(name, currentModality, null)) {
      showToast("Já existe uma rotina chamada \"" + name + "\" em " +
        MODE_NAMES[currentModality] + ". Escolha outro nome.", "error");
      return;
    }

    const now = Date.now();
    const routine = {
      id: createId("routine"),
      name,
      modality: currentModality,
      createdAt: now,
      updatedAt: now,
      sections: { warmup: [], main: [], abs: [], finisher: [] }
    };

    const previous = cloneData(F.state.routines);
    F.state.routines[currentModality].push(routine);

    if (!commitRoutines(previous)) return;

    F.flash("Rotina criada. Adicione exercícios e salve.");
    F.navigate(editorUrl(currentModality, routine.id));
  }

  async function renameRoutine(routineId) {
    const routine = findRoutine(currentModality, routineId);
    if (!routine) return;

    const result = await showModal({
      title: "Renomear rotina",
      message: "O novo nome será usado no treino e no histórico.",
      fields: [{ id: "name", label: "Nome da rotina", value: routine.name, maxlength: 60 }],
      submitActions: ["rename"],
      validate(values) {
        const name = (values.name || "").trim().slice(0, 60);
        if (!name) {
          return { ok: false, errors: { name: "O nome da rotina não pode ficar vazio." } };
        }

        /* Confere contra o estado fresco, sem fechar o modal em caso de erro. */
        syncKeyFromStorage(KEYS.routines);
        const freshRoutine = findRoutine(currentModality, routineId);
        if (!freshRoutine) {
          return {
            ok: false,
            errors: { name: "Esta rotina não existe mais. Feche o diálogo e recarregue a lista." }
          };
        }

        if (comparableName(name) !== comparableName(freshRoutine.name) &&
          routineNameTaken(name, currentModality, routineId)) {
          return {
            ok: false,
            errors: {
              name: "Já existe uma rotina chamada \"" + name + "\" em " +
                MODE_NAMES[currentModality] + ". Escolha outro nome."
            }
          };
        }

        return { ok: true };
      },
      actions: [
        { id: "cancel", label: "Cancelar", className: "secondary-button" },
        { id: "rename", label: "Salvar nome", className: "primary-button" }
      ]
    });

    if (result.action !== "rename") return;

    const name = (result.values.name || "").trim().slice(0, 60);
    if (!name) {
      showToast("O nome da rotina não pode ficar vazio.", "error");
      return;
    }

    /* Relê o estado fresco: o objeto de antes do modal pode ter ficado obsoleto. */
    syncKeyFromStorage(KEYS.routines);

    const freshRoutine = findRoutine(currentModality, routineId);
    if (!freshRoutine) {
      renderModality();
      showToast("Esta rotina não existe mais.", "error");
      return;
    }

    if (comparableName(name) !== comparableName(freshRoutine.name) &&
      routineNameTaken(name, currentModality, routineId)) {
      showToast("Já existe uma rotina chamada \"" + name + "\" em " +
        MODE_NAMES[currentModality] + ". Escolha outro nome.", "error");
      return;
    }

    const previous = cloneData(F.state.routines);
    freshRoutine.name = name;
    freshRoutine.updatedAt = Date.now();

    if (commitRoutines(previous)) {
      renderModality();
      showToast("Rotina renomeada.");
    }
  }

  function duplicateRoutine(routineId) {
    syncKeyFromStorage(KEYS.routines);

    const routine = findRoutine(currentModality, routineId);
    if (!routine) {
      renderModality();
      return;
    }

    const copy = cloneData(routine);
    copy.id = createId("routine");
    copy.name = uniqueCopyName(routine.name, currentModality);
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    copy.modality = currentModality;

    SECTION_ORDER.forEach(section => {
      copy.sections[section].forEach(exercise => {
        exercise.id = createId("exercise");
      });
    });

    const previous = cloneData(F.state.routines);
    const index = F.state.routines[currentModality].findIndex(item => item.id === routineId);
    F.state.routines[currentModality].splice(index + 1, 0, copy);

    if (commitRoutines(previous)) {
      /* A cópia entra na fila iniciável e pode virar a próxima da rotação. */
      reconcileRotation();
      renderModality();
      showToast("Rotina duplicada: " + copy.name + ".");
    }
  }

  async function deleteRoutine(routineId) {
    const routine = findRoutine(currentModality, routineId);
    if (!routine) return;

    const exerciseCount = countRoutineExercises(routine);
    const details = document.createElement("div");
    details.className = "modal-details";
    details.innerHTML =
      "<strong>" + escapeHtml(routine.name) + "</strong><br>" +
      pluralize(exerciseCount, "exercício", "exercícios") + " serão removidos da rotina.";

    if (F.state.activeWorkout && F.state.activeWorkout.routineId === routine.id) {
      details.appendChild(document.createTextNode(
        " A sessão ativa continuará com a cópia já iniciada."
      ));
    }

    const result = await showModal({
      title: "Excluir rotina?",
      message: "Esta ação não pode ser desfeita. O histórico de treinos já registrado será mantido.",
      details,
      actions: [
        { id: "cancel", label: "Cancelar", className: "secondary-button" },
        { id: "delete", label: "Excluir rotina", className: "secondary-button danger-button" }
      ]
    });

    if (result.action !== "delete") return;

    /*
      Relê o estado fresco antes de mutar: a seleção da rotação e a lista de
      iniciáveis precisam refletir o que está gravado agora, não o que esta
      aba carregou — senão a exclusão sobrescreveria mudanças de outra aba.
    */
    syncKeyFromStorage(KEYS.routines);

    if (!findRoutine(currentModality, routine.id)) {
      renderModality();
      showToast("Rotina excluída. Nenhum histórico foi apagado.");
      return;
    }

    const oldStartable = typeof F.getStartableRoutines === "function"
      ? F.getStartableRoutines()
      : [];
    const wasSelected = typeof F.resolveNextRoutine === "function"
      ? F.resolveNextRoutine()
      : null;

    const previous = cloneData(F.state.routines);
    F.state.routines[currentModality] = F.state.routines[currentModality]
      .filter(item => item.id !== routine.id);

    if (commitRoutines(previous)) {
      if (typeof F.reconcileRotationAfterDelete === "function") {
        F.reconcileRotationAfterDelete(oldStartable, wasSelected, routine.id);
      }
      renderModality();
      showToast("Rotina excluída. Nenhum histórico foi apagado.");
    }
  }

  function renderRoutineCard(routine) {
    const card = document.createElement("article");
    card.className = "routine-card";
    card.setAttribute("data-routine-id", routine.id);

    const header = document.createElement("header");
    header.className = "routine-card-header";

    const name = document.createElement("h3");
    name.className = "routine-name";
    name.textContent = routine.name;

    const total = countRoutineExercises(routine);
    const meta = document.createElement("p");
    meta.className = "routine-meta";
    meta.textContent = total === 0
      ? "Sem exercícios ainda"
      : pluralize(total, "exercício", "exercícios") + " · " +
        pluralize(getRoutineTotalSets(routine), "série", "séries") + " planejadas";

    header.append(name, meta);

    const sections = document.createElement("ul");
    sections.className = "routine-sections";

    sectionCounts(routine).forEach(entry => {
      const item = document.createElement("li");
      item.className = entry.count === 0 ? "is-empty" : "";
      const label = document.createElement("span");
      label.textContent = SECTION_NAMES[entry.section];
      const value = document.createElement("strong");
      value.textContent = String(entry.count);
      item.append(label, value);
      sections.appendChild(item);
    });

    const actions = document.createElement("div");
    actions.className = "routine-actions";

    const start = document.createElement("button");
    start.type = "button";
    start.className = "primary-button routine-start";
    start.textContent = total === 0 ? "Adicione exercícios para iniciar" : "Iniciar treino";
    start.disabled = total === 0;
    start.addEventListener("click", () => {
      F.startRoutine(currentModality, routine.id);
    });

    const edit = document.createElement("a");
    edit.className = "secondary-button";
    edit.href = editorUrl(currentModality, routine.id);
    edit.textContent = "Editar exercícios";

    const tools = document.createElement("div");
    tools.className = "routine-tools";

    const rename = makeToolButton("Renomear", () => renameRoutine(routine.id));
    const duplicate = makeToolButton("Duplicar", () => duplicateRoutine(routine.id));
    const remove = makeToolButton("Excluir", () => deleteRoutine(routine.id));
    remove.classList.add("danger-button");

    tools.append(rename, duplicate, remove);
    actions.append(start, edit, tools);
    card.append(header, sections, actions);

    return card;
  }

  function makeToolButton(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button small-button";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function renderHistory() {
    const records = modalityHistory(currentModality);
    const totalSets = records.reduce((sum, record) => sum + (Number(record.completedSets) || 0), 0);
    const totalMs = records.reduce((sum, record) => sum + (Number(record.durationMs) || 0), 0);
    const completed = records.filter(record => record.status === "completed").length;

    byId("history-total").textContent = String(records.length);
    byId("history-completed").textContent = String(completed);
    byId("history-sets").textContent = String(totalSets);
    byId("history-time").textContent = totalMs > 0 ? formatDurationLong(totalMs) : "0 min";

    const list = byId("modality-history-list");
    list.innerHTML = "";

    if (records.length === 0) {
      list.appendChild(makeEmpty(
        "Nenhum treino registrado ainda",
        "Quando você concluir ou encerrar uma sessão, ela aparece aqui."
      ));
    }

    records.slice(0, RECENT_HISTORY).forEach(record => {
      list.appendChild(renderHistoryItem(record));
    });

    const more = byId("history-more");
    more.href = F.url("progresso", { modalidade: currentModality });
    more.hidden = records.length === 0;
    more.textContent = records.length > RECENT_HISTORY
      ? "Ver todo o histórico (" + records.length + ")"
      : "Ver histórico e progresso";
  }

  function renderHistoryItem(record) {
    const item = document.createElement("div");
    item.className = "history-item";

    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = record.routineName || "Treino";

    const status = document.createElement("span");
    status.className = "history-status " + (record.status === "completed" ? "completed" : "partial");
    status.textContent = record.status === "completed" ? "Concluído" : "Parcial";

    const details = document.createElement("div");
    details.className = "history-details";
    details.textContent = metricas.formatRecordDate(record) + " · " +
      (Number(record.completedSets) || 0) + "/" + (Number(record.totalPlannedSets) || 0) +
      " séries · " + formatDurationLong(Number(record.durationMs) || 0);

    item.append(title, status, details);
    return item;
  }

  function makeEmpty(title, text, action) {
    const card = document.createElement("div");
    card.className = "empty-card";

    const heading = document.createElement("strong");
    heading.textContent = title;

    const paragraph = document.createElement("p");
    paragraph.textContent = text;

    card.append(heading, paragraph);

    if (action && action.label && typeof action.onClick === "function") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "primary-button empty-card-cta";
      button.textContent = action.label;
      button.addEventListener("click", action.onClick);
      card.appendChild(button);
    }

    return card;
  }

  function renderModality() {
    if (!currentModality) return;

    const routines = getModeRoutines(currentModality);
    const list = byId("routine-list");
    list.innerHTML = "";

    byId("routine-count").textContent = pluralize(routines.length, "rotina", "rotinas");

    if (routines.length === 0) {
      list.appendChild(makeEmpty(
        "Nenhuma rotina ainda",
        "Crie uma rotina e organize aquecimento, treino principal, abdômen e finalizador.",
        { label: "Criar primeira rotina", onClick: createRoutine }
      ));
    }

    routines.forEach(routine => list.appendChild(renderRoutineCard(routine)));

    renderHistory();
    renderActiveHint();
  }

  function renderActiveHint() {
    const hint = byId("modality-active-hint");
    if (!hint) return;

    const session = F.state.activeWorkout;
    hint.hidden = !session || session.modality !== currentModality;
    if (!hint.hidden) {
      hint.querySelector("a").href = F.url("executar");
      hint.querySelector("[data-active-name]").textContent = session.routineName;
    }
  }

  function initModality(modality) {
    currentModality = modality;

    byId("modality-title").textContent = MODE_NAMES[modality].toUpperCase();
    byId("modality-subtitle").textContent = MODE_DESCRIPTIONS[modality];
    byId("new-routine").addEventListener("click", createRoutine);

    renderModality();
    F.onDataChanged(renderModality);
    watchExternalChanges(
      [KEYS.routines, KEYS.legacyExercises, KEYS.history, KEYS.active, KEYS.rotation],
      renderModality
    );
  }

  F.pages.calistenia = () => initModality("calisthenics");
  F.pages.musculacao = () => initModality("weights");

  /* Editor de rotina (treino/rotina.html) */

  let draft = null;
  let draftRoutineId = null;
  let draftModality = null;
  let draftExplicitModality = false;
  let isNewRoutine = false;
  let draftDirty = false;
  let editingRef = null;
  let librarySearchValue = "";
  /* Base da abertura do editor, para detectar mudanças externas (C3). */
  let editorRoutinesRawAtOpen = null;
  let editorRoutineFingerprintAtOpen = null;
  let editorOpenedName = "";

  function editorBackHref() {
    if (isNewRoutine && !draftExplicitModality) return F.url("treino");
    return F.modalityUrl(isModality(draftModality) ? draftModality : "calisthenics");
  }

  function renderDirtyState() {
    const pill = byId("editor-dirty-pill");
    const note = byId("editor-save-note");
    if (!pill || !note) return;

    if (draftDirty) {
      pill.textContent = "Alterações não salvas";
      pill.classList.remove("saved");
      note.textContent = "Você tem alterações não salvas. Salve antes de sair ou iniciar o treino.";
      return;
    }

    if (isNewRoutine) {
      pill.textContent = "Nova rotina";
      pill.classList.add("saved");
      note.textContent = "Adicione exercícios e toque em Salvar rotina para criar.";
      return;
    }

    pill.textContent = "Salvo";
    pill.classList.add("saved");
    note.textContent = "Rotina salva. Você pode voltar e iniciar o treino.";
  }

  function markDirty() {
    draftDirty = true;
    renderDirtyState();
  }

  function renderEditorMeta() {
    const exercises = flattenRoutine(draft);
    const totalSets = exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
    byId("editor-meta").textContent = pluralize(exercises.length, "exercício", "exercícios") +
      " · " + totalSets + " séries planejadas · " + MODE_NAMES[draftModality];
    byId("editor-title").textContent = draft.name;
  }

  function renderEditorSections() {
    SECTION_ORDER.forEach(section => {
      const container = document.querySelector('[data-section-list="' + section + '"]');
      const countElement = document.querySelector('[data-section-count="' + section + '"]');
      if (!container) return;

      const exercises = draft.sections[section] || [];
      container.innerHTML = "";

      if (countElement) {
        countElement.textContent = pluralize(exercises.length, "exercício", "exercícios");
      }

      if (exercises.length === 0) {
        const empty = document.createElement("div");
        empty.className = "section-empty";
        empty.textContent = "Nenhum exercício nesta seção.";
        container.appendChild(empty);
        return;
      }

      exercises.forEach((exercise, index) => {
        container.appendChild(renderEditorRow(section, exercise, index, exercises.length));
      });
    });
  }

  function renderEditorRow(section, exercise, index, count) {
    const row = document.createElement("div");
    row.className = "editor-exercise";
    row.setAttribute("data-exercise-id", exercise.id);

    const main = document.createElement("div");
    main.className = "editor-exercise-main";

    const name = document.createElement("div");
    name.className = "editor-exercise-name";
    name.textContent = exercise.name;

    const meta = document.createElement("div");
    meta.className = "editor-exercise-meta";
    const parts = [formatExerciseMeta(exercise), "Descanso: " + formatRest(exercise.rest)];
    if (exercise.load && draftModality === "weights") parts.push("Carga: " + exercise.load);
    if (exercise.notes) parts.push("com observações");
    meta.textContent = parts.join(" · ");

    main.append(name, meta);

    const tools = document.createElement("div");
    tools.className = "exercise-tools";

    tools.append(
      makeIconButton("↑", "Mover " + exercise.name + " para cima", index === 0,
        () => moveExercise(section, exercise.id, -1)),
      makeIconButton("↓", "Mover " + exercise.name + " para baixo", index === count - 1,
        () => moveExercise(section, exercise.id, 1)),
      makeIconButton("✎", "Editar " + exercise.name, false,
        () => beginEditExercise(section, exercise.id)),
      makeIconButton("×", "Remover " + exercise.name, false,
        () => deleteExercise(section, exercise.id), "remove")
    );

    row.append(main, tools);
    return row;
  }

  function makeIconButton(text, label, disabled, handler, extraClass) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button" + (extraClass ? " " + extraClass : "");
    button.textContent = text;
    button.disabled = disabled;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", handler);
    return button;
  }

  function renderEditor() {
    renderEditorMeta();
    renderDirtyState();
    renderEditorSections();
    byId("exercise-load-field").hidden = draftModality !== "weights";

    const nameInput = byId("routine-name-input");
    if (document.activeElement !== nameInput) nameInput.value = draft.name;
  }

  function moveExercise(section, exerciseId, offset) {
    const list = draft.sections[section];
    const index = list.findIndex(exercise => exercise.id === exerciseId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= list.length) return;

    const moved = list.splice(index, 1)[0];
    list.splice(target, 0, moved);
    markDirty();
    renderEditorSections();
    renderEditorMeta();
  }

  function beginEditExercise(section, exerciseId) {
    const exercise = draft.sections[section].find(item => item.id === exerciseId);
    if (!exercise) return;

    editingRef = { section, id: exerciseId };
    byId("exercise-section").value = section;
    byId("exercise-name").value = exercise.name;
    byId("exercise-sets").value = exercise.sets;
    byId("exercise-reps").value = exercise.reps || "";
    byId("exercise-duration").value = exercise.duration || 45;
    byId("exercise-rest").value = exercise.rest;
    byId("exercise-load").value = exercise.load || "";
    byId("exercise-notes").value = exercise.notes || "";
    byId("exercise-type-reps").checked = exercise.type !== "duration";
    byId("exercise-type-duration").checked = exercise.type === "duration";
    toggleMeasurementFields();

    byId("exercise-form-heading").textContent = "Editar exercício";
    byId("exercise-submit").textContent = "Salvar exercício";
    byId("cancel-exercise-edit").hidden = false;
    byId("exercise-form-card").classList.add("editing");
    safeScrollIntoView(byId("exercise-form-card"));
    byId("exercise-name").focus();
  }

  function resetExerciseForm(section) {
    editingRef = null;
    byId("exercise-form").reset();
    byId("exercise-section").value = SECTION_NAMES[section] ? section : "main";
    byId("exercise-sets").value = 4;
    byId("exercise-reps").value = "12";
    byId("exercise-duration").value = 45;
    byId("exercise-rest").value = 60;
    byId("exercise-load").value = "";
    byId("exercise-notes").value = "";
    byId("exercise-type-reps").checked = true;
    byId("exercise-type-duration").checked = false;
    byId("exercise-form-heading").textContent = "Adicionar exercício";
    byId("exercise-submit").textContent = "Adicionar exercício";
    byId("cancel-exercise-edit").hidden = true;
    byId("exercise-form-card").classList.remove("editing");
    byId("exercise-load-field").hidden = draftModality !== "weights";
    toggleMeasurementFields();
  }

  function toggleMeasurementFields() {
    const isDuration = byId("exercise-type-duration").checked;
    byId("exercise-reps-field").hidden = isDuration;
    byId("exercise-duration-field").hidden = !isDuration;
    byId("exercise-reps").required = !isDuration;
    byId("exercise-duration").required = isDuration;
  }

  /*
    Valida os campos de um exercício (formulário da rotina e biblioteca).
    Retorna { error, focus } ou { value }.
  */
  function validateExercise(input) {
    if (!SECTION_NAMES[input.section]) {
      return { error: "Escolha uma seção válida.", focus: null };
    }
    if (!input.name) {
      return { error: "Informe o nome do exercício.", focus: "exercise-name" };
    }
    if (!Number.isInteger(input.sets) || input.sets < 1 || input.sets > 30) {
      return { error: "Informe de 1 a 30 séries.", focus: "exercise-sets" };
    }
    if (input.type === "reps" && !input.reps) {
      return { error: "Informe as repetições do exercício.", focus: "exercise-reps" };
    }
    if (input.type === "duration" && (!Number.isFinite(input.duration) || input.duration < 1 || input.duration > 7200)) {
      return { error: "Informe uma duração entre 1 e 7200 segundos.", focus: "exercise-duration" };
    }
    if (!Number.isInteger(input.rest) || input.rest < 0 || input.rest > 3600) {
      return { error: "O descanso deve estar entre 0 e 3600 segundos.", focus: "exercise-rest" };
    }

    return {
      value: {
        name: input.name.slice(0, 100),
        sets: input.sets,
        type: input.type,
        reps: input.type === "reps" ? input.reps.slice(0, 30) : (input.reps.slice(0, 30) || "12"),
        duration: input.type === "duration" ? Math.round(input.duration) : 45,
        rest: Math.round(input.rest),
        load: draftModality === "weights" ? (input.load || "").slice(0, 50) : "",
        notes: (input.notes || "").slice(0, 300),
        section: input.section
      }
    };
  }

  function readExerciseForm() {
    return {
      section: byId("exercise-section").value,
      name: byId("exercise-name").value.trim(),
      type: byId("exercise-type-duration").checked ? "duration" : "reps",
      sets: Number(byId("exercise-sets").value),
      reps: byId("exercise-reps").value.trim(),
      duration: Number(byId("exercise-duration").value),
      rest: Number(byId("exercise-rest").value),
      load: byId("exercise-load").value.trim(),
      notes: byId("exercise-notes").value.trim()
    };
  }

  function handleExerciseSubmit(event) {
    event.preventDefault();
    if (!draft) return;

    const checked = validateExercise(readExerciseForm());
    if (checked.error) {
      showToast(checked.error, "error");
      if (checked.focus) byId(checked.focus).focus();
      return;
    }

    const wasEditing = Boolean(editingRef);
    const exercise = Object.assign({
      id: editingRef ? editingRef.id : createId("exercise")
    }, checked.value);

    if (editingRef) {
      /*
        Campos que o formulário não edita são herdados do exercício original,
        sem inventar valores: sem esta herança, editar séries ou repetições
        apagaria a medição (ex.: distância), a origem na biblioteca
        (`libraryId`) e as instruções — e a perda só apareceria depois de
        salvar, recarregar e normalizar os dados.
      */
      const original = draft.sections[editingRef.section]
        .find(item => item.id === editingRef.id);
      if (original) {
        ["measure", "distance", "distanceUnit", "libraryId", "instructions"]
          .forEach(field => {
            if (original[field] !== undefined) exercise[field] = original[field];
          });
      }

      const origin = draft.sections[editingRef.section];
      const index = origin.findIndex(item => item.id === editingRef.id);
      if (index >= 0) origin.splice(index, 1);

      if (editingRef.section === exercise.section && index >= 0) {
        draft.sections[exercise.section].splice(index, 0, exercise);
      } else {
        draft.sections[exercise.section].push(exercise);
      }
    } else {
      draft.sections[exercise.section].push(exercise);
    }

    markDirty();
    renderEditorSections();
    renderEditorMeta();
    resetExerciseForm(exercise.section);
    showToast("Exercício " + (wasEditing ? "atualizado" : "adicionado") + ". Salve a rotina para confirmar.");
  }

  async function deleteExercise(section, exerciseId) {
    const exercise = draft.sections[section].find(item => item.id === exerciseId);
    if (!exercise) return;

    const result = await showModal({
      title: "Remover exercício?",
      message: "O exercício será removido da rotina em edição. A alteração só será gravada quando você salvar a rotina.",
      actions: [
        { id: "cancel", label: "Cancelar", className: "secondary-button" },
        { id: "remove", label: "Remover", className: "secondary-button danger-button" }
      ]
    });

    if (result.action !== "remove") return;

    draft.sections[section] = draft.sections[section].filter(item => item.id !== exerciseId);

    if (editingRef && editingRef.id === exerciseId) {
      resetExerciseForm(section);
    }

    markDirty();
    renderEditorSections();
    renderEditorMeta();
  }

  /*
    Impressão digital de uma rotina para comparar versões sem depender dos
    carimbos de tempo: `createdAt`/`updatedAt` podem ser re-derivados na
    normalização de dados antigos, então ficam fora da comparação — qualquer
    mudança real de nome, modalidade ou exercícios continua detectável.
  */
  function routineFingerprint(routine) {
    if (!routine) return null;

    const copy = cloneData(routine);
    delete copy.createdAt;
    delete copy.updatedAt;
    return JSON.stringify(copy);
  }

  function rememberEditorSaveBase() {
    editorRoutinesRawAtOpen = F.store && typeof F.store.readRaw === "function"
      ? F.store.readRaw(KEYS.routines)
      : null;
    editorRoutineFingerprintAtOpen = isNewRoutine
      ? null
      : routineFingerprint(findRoutine(draftModality, draftRoutineId) || draft);
    editorOpenedName = draft ? draft.name : "";
  }

  /*
    Antes de salvar, confere se as rotinas mudaram fora deste editor desde a
    abertura. Mudanças em outras rotinas são preservadas (o salvamento passa
    a valer sobre o estado fresco); se a própria rotina aberta foi alterada
    ou excluída lá fora, o salvamento é abortado com aviso — nunca sobrescreve
    silenciosamente a versão mais recente.
  */
  function refreshEditorSaveBase() {
    if (!F.store || typeof F.store.readRaw !== "function" ||
      typeof F.syncStateFromStorage !== "function") {
      return true;
    }

    const currentRaw = F.store.readRaw(KEYS.routines);
    if (editorRoutinesRawAtOpen === null || currentRaw === editorRoutinesRawAtOpen) {
      return true;
    }

    F.syncStateFromStorage(KEYS.routines);

    if (isNewRoutine) return true;

    const current = findRoutine(draftModality, draftRoutineId);
    if (current && routineFingerprint(current) === editorRoutineFingerprintAtOpen) {
      return true;
    }

    showToast(
      "Esta rotina foi alterada ou excluída em outra aba/janela depois que o editor foi aberto. " +
      "Para não sobrescrever a versão mais recente, nada foi salvo. Recarregue a página e tente novamente.",
      "error",
      7000
    );
    return false;
  }

  function saveRoutine() {
    if (!draft) return false;

    const name = byId("routine-name-input").value.trim().slice(0, 60);
    if (!name) {
      showToast("O nome da rotina não pode ficar vazio.", "error");
      byId("routine-name-input").focus();
      return false;
    }

    if (!refreshEditorSaveBase()) return false;

    /*
      Nome duplicado na mesma modalidade é bloqueado. Rotina já existente que
      mantém o nome com que foi aberta não é bloqueada: dados antigos com
      duplicidade continuam editáveis, sem correção automática.
    */
    const keepsOpenedName = !isNewRoutine &&
      comparableName(name) === comparableName(editorOpenedName);
    if (!keepsOpenedName && routineNameTaken(name, draftModality, draftRoutineId)) {
      showToast("Já existe uma rotina chamada \"" + name + "\" em " +
        MODE_NAMES[draftModality] + ". Escolha outro nome.", "error");
      byId("routine-name-input").focus();
      return false;
    }

    const list = F.state.routines[draftModality];
    const index = list.findIndex(routine => routine.id === draftRoutineId);
    if (index < 0 && !isNewRoutine) {
      showToast("Esta rotina não existe mais.", "error");
      return false;
    }

    const previous = cloneData(F.state.routines);
    draft.name = name;
    draft.modality = draftModality;
    draft.updatedAt = Date.now();

    if (index >= 0) {
      list[index] = cloneData(draft);
    } else {
      list.push(cloneData(draft));
    }

    if (!commitRoutines(previous)) {
      draftDirty = true;
      renderDirtyState();
      return false;
    }

    const wasNew = isNewRoutine;
    isNewRoutine = false;
    draftExplicitModality = true;
    draftDirty = false;

    /* A versão salva vira a nova base: salvar de novo não é conflito. */
    rememberEditorSaveBase();

    /* Esvaziar ou reabastecer a rotina muda a fila iniciável da rotação. */
    reconcileRotation();

    const modalityField = byId("editor-modality-field");
    if (modalityField) modalityField.hidden = true;

    const backLink = byId("back-to-modality");
    if (backLink) backLink.href = F.modalityUrl(draftModality);

    if (wasNew && global.history && typeof global.history.replaceState === "function") {
      try {
        global.history.replaceState(null, "", editorUrl(draftModality, draftRoutineId));
      } catch (err) {
        /* Em ambientes de teste com URL about:blank/opaca, ignora SecurityError. */
      }
    }

    renderEditor();

    const total = countRoutineExercises(draft);
    showToast(total === 0
      ? "Rotina salva, mas ainda não tem exercícios para iniciar."
      : "Rotina salva. Você já pode iniciar o treino.");
    return true;
  }

  /* Biblioteca: busca, sugestões e exercícios personalizados */

  /*
    "peito, tríceps, peito" -> ["peito", "tríceps"]. A leitura já deduplica,
    mas limpar na entrada evita gravar repetição que o usuário não pediu.
  */
  function splitList(value) {
    const seen = new Set();
    const out = [];

    String(value || "").split(",").forEach(item => {
      const text = item.trim().slice(0, 28);
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return;
      seen.add(key);
      out.push(text);
    });

    return out.slice(0, 6);
  }

  function catalogMetaFor(item) {
    if (!F.catalog) return null;
    return F.catalog.metadataFor(item);
  }


  function libraryItems() {
    const builtin = (F.EXERCISE_LIBRARY[draftModality] || []).map(item => {
      return Object.assign({}, item, { custom: false });
    });
    const custom = (F.state.library[draftModality] || []).map(item => {
      return Object.assign({}, item, { custom: true });
    });

    return custom.concat(builtin);
  }

  function renderLibrary() {
    const list = byId("library-list");
    const catalogLink = byId("open-catalog");

    /*
      O painel dentro do editor é a busca rápida; a tela completa tem filtros
      por categoria, músculo, equipamento e medição. O link leva já filtrado
      pela modalidade da rotina aberta.
    */
    if (catalogLink) {
      const mode = draftModality || currentModality;
      catalogLink.href = F.url("biblioteca", mode ? { modalidade: mode } : null);
    }
    const query = normalizeSearch(librarySearchValue);
    const items = libraryItems().filter(item => {
      return !query || normalizeSearch(item.name).includes(query);
    });

    list.innerHTML = "";

    if (items.length === 0) {
      list.appendChild(makeEmpty(
        "Nenhum exercício encontrado",
        "Tente outro termo ou crie um exercício personalizado abaixo."
      ));
      return;
    }

    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "library-item";

      const main = document.createElement("div");
      main.className = "library-item-main";

      const name = document.createElement("strong");
      name.textContent = item.name;

      const meta = document.createElement("span");
      meta.className = "library-item-meta";
      const metaParts = [(item.custom ? "Personalizado" : "Sugerido") + " · " +
        SECTION_NAMES[item.section] + " · " + formatExerciseMeta(item)];
      const meta2 = catalogMetaFor(item);

      if (meta2 && meta2.label) metaParts.push(meta2.label);
      if (meta2 && meta2.muscles.length) metaParts.push(meta2.muscles.join(", "));

      meta.textContent = metaParts.join(" · ");

      main.append(name, meta);

      const actions = document.createElement("div");
      actions.className = "library-item-actions";

      const add = document.createElement("button");
      add.type = "button";
      add.className = "secondary-button small-button";
      add.textContent = "Adicionar";
      add.setAttribute("aria-label", "Adicionar " + item.name + " à rotina");
      add.addEventListener("click", () => addFromLibrary(item));
      actions.appendChild(add);

      if (item.custom) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary-button small-button danger-button";
        remove.textContent = "Excluir";
        remove.setAttribute("aria-label", "Excluir " + item.name + " da biblioteca");
        remove.addEventListener("click", () => deleteCustomExercise(item.id));
        actions.appendChild(remove);
      }

      row.append(main, actions);
      list.appendChild(row);
    });
  }

  /*
    Converte um item da biblioteca (sugerido ou personalizado) no exercício
    que entra na rotina, com a mesma estrutura produzida pela página completa
    da biblioteca: a conversão canônica é `F.catalog.toExercise`, que registra
    `libraryId` e traz as instruções do item. O catálogo só é consultado na
    hora do uso — nunca na carga deste módulo —, portanto não há dependência
    circular entre os scripts; sem ele, a cópia local aplica as mesmas regras
    a partir do item cru (origem explícita e instruções do catálogo).
  */
  function exerciseFromLibraryItem(item) {
    if (!item) return null;

    const section = SECTION_NAMES[item.section] ? item.section : "main";

    if (F.catalog && typeof F.catalog.items === "function" &&
      typeof F.catalog.toExercise === "function") {
      const wantedId = item.libraryId || item.id;
      const record = F.catalog.items(draftModality).find(candidate => {
        return candidate.id === item.id ||
          candidate.libraryId === wantedId ||
          candidate.id === wantedId;
      });
      if (record) {
        const fromCatalog = F.catalog.toExercise(record, section);
        if (fromCatalog) return fromCatalog;
      }
    }

    const copy = normalizeExercise(Object.assign({}, item, {
      id: createId("exercise"),
      libraryId: item.libraryId || item.id || null,
      load: draftModality === "weights" ? item.load || "" : ""
    }), section);

    if (copy && !copy.instructions) {
      const meta = catalogMetaFor(item);
      if (meta && meta.instructions) copy.instructions = meta.instructions;
    }

    return copy;
  }

  function addFromLibrary(item) {
    if (!draft) return;

    const copy = exerciseFromLibraryItem(item);

    if (!copy) return;

    draft.sections[copy.section].push(copy);
    markDirty();
    renderEditorSections();
    renderEditorMeta();
    showToast(item.name + " adicionado em " + SECTION_NAMES[copy.section] + ". Salve a rotina para confirmar.");
  }

  function toggleCustomForm(show) {
    byId("custom-form").hidden = !show;
    byId("custom-toggle").setAttribute("aria-expanded", String(show));
    if (show) byId("custom-name").focus();
  }

  function handleCustomSubmit(event) {
    event.preventDefault();

    const input = {
      section: byId("custom-section").value,
      name: byId("custom-name").value.trim(),
      type: byId("custom-type-duration").checked ? "duration" : "reps",
      sets: Number(byId("custom-sets").value),
      reps: byId("custom-reps").value.trim(),
      duration: Number(byId("custom-duration").value),
      rest: Number(byId("custom-rest").value),
      load: "",
      notes: ""
    };

    const checked = validateExercise(input);
    if (checked.error) {
      showToast(checked.error, "error");
      /*
        `validateExercise` devolve o foco com os IDs do formulário de
        exercício da rotina; aqui o formulário é o de exercício personalizado,
        então o campo equivalente (`custom-*`) recebe o foco.
      */
      const customFocus = {
        "exercise-name": "custom-name",
        "exercise-sets": "custom-sets",
        "exercise-reps": "custom-reps",
        "exercise-duration": "custom-duration",
        "exercise-rest": "custom-rest"
      }[checked.focus] || "custom-section";
      const focusTarget = byId(customFocus);
      if (focusTarget) focusTarget.focus();
      return;
    }

    /* Outra aba pode ter mexido na biblioteca enquanto o formulário estava aberto. */
    syncKeyFromStorage(KEYS.library);

    const libraryTarget = comparableName(checked.value.name);
    const alreadyInLibrary = (F.state.library[draftModality] || [])
      .some(item => comparableName(item.name) === libraryTarget);
    if (alreadyInLibrary) {
      showToast("Você já tem um exercício chamado \"" + checked.value.name +
        "\" na biblioteca de " + MODE_NAMES[draftModality] +
        ". Exclua o atual ou escolha outro nome.", "error");
      const nameField = byId("custom-name");
      if (nameField) nameField.focus();
      return;
    }

    const libraryEntry = Object.assign({
      id: createId("lib-" + draftModality),
      category: byId("custom-category").value || "",
      muscles: splitList(byId("custom-muscles").value),
      equipment: splitList(byId("custom-equipment").value),
      instructions: byId("custom-instructions").value.trim().slice(0, 600)
    }, checked.value);
    const previous = cloneData(F.state.library);

    F.state.library[draftModality].push(libraryEntry);

    if (!F.saveLibrary(F.state.library)) {
      F.state.library = previous;
      showToast("Não foi possível salvar o exercício na biblioteca deste navegador.", "error");
      return;
    }

    byId("custom-form").reset();
    byId("custom-category").value = "";
    byId("custom-muscles").value = "";
    byId("custom-equipment").value = "";
    byId("custom-instructions").value = "";
    byId("custom-meta").open = false;
    byId("custom-sets").value = 3;
    byId("custom-reps").value = "10";
    byId("custom-duration").value = 45;
    byId("custom-rest").value = 60;
    toggleCustomFields();
    toggleCustomForm(false);
    renderLibrary();
    showToast("Exercício salvo na biblioteca. Use Adicionar para incluí-lo na rotina.");
  }

  function toggleCustomFields() {
    const isDuration = byId("custom-type-duration").checked;
    byId("custom-reps-field").hidden = isDuration;
    byId("custom-duration-field").hidden = !isDuration;
  }

  async function deleteCustomExercise(itemId) {
    const result = await showModal({
      title: "Excluir exercício da biblioteca?",
      message: "O exercício some da biblioteca. Rotinas que já o usam não são alteradas.",
      actions: [
        { id: "cancel", label: "Cancelar", className: "secondary-button" },
        { id: "delete", label: "Excluir", className: "secondary-button danger-button" }
      ]
    });

    if (result.action !== "delete") return;

    syncKeyFromStorage(KEYS.library);

    const previous = cloneData(F.state.library);
    F.state.library[draftModality] = F.state.library[draftModality]
      .filter(item => item.id !== itemId);

    if (!F.saveLibrary(F.state.library)) {
      F.state.library = previous;
      return;
    }

    renderLibrary();
    showToast("Exercício removido da biblioteca.");
  }

  /* Abertura, navegação e alerta de alterações não salvas */

  function showMissing(message, modalityHint) {
    byId("editor-missing").hidden = false;
    byId("editor-missing-text").textContent = message;
    const createLink = byId("editor-missing-create");
    if (createLink) {
      createLink.href = isModality(modalityHint)
        ? F.url("rotina", { modalidade: modalityHint })
        : F.url("rotina", { nova: "1" });
    }
    byId("editor-body").hidden = true;
  }

  function leaveEditorPage(href) {
    const destination = href || editorBackHref();
    if (draftDirty) {
      return showModal({
        title: "Descartar alterações?",
        message: "Você tem mudanças não salvas nesta rotina. Se voltar agora, essas alterações serão perdidas.",
        actions: [
          { id: "cancel", label: "Continuar editando", className: "secondary-button" },
          { id: "discard", label: "Descartar e voltar", className: "secondary-button danger-button" }
        ]
      }).then(result => {
        if (result.action !== "discard") return;
        draftDirty = false;
        F.navigate(destination);
      });
    }

    F.navigate(destination);
    return Promise.resolve();
  }

  function resolveExistingRoutine(modalityParam, routineId) {
    if (isModality(modalityParam)) {
      const direct = findRoutine(modalityParam, routineId);
      if (direct) return { modality: modalityParam, routine: direct };
    }
    for (let i = 0; i < MODALITIES.length; i += 1) {
      const candidateMode = MODALITIES[i];
      const found = findRoutine(candidateMode, routineId);
      if (found) return { modality: candidateMode, routine: found };
    }
    return null;
  }

  F.pages.rotina = function initRoutineEditor() {
    const params = new URLSearchParams(global.location.search);
    const modality = params.get("modalidade");
    const routineId = params.get("id");
    const preloadExercise = params.get("exercicio");

    draftExplicitModality = isModality(modality);

    global.addEventListener("beforeunload", event => {
      if (!draftDirty) return;
      event.preventDefault();
      event.returnValue = "";
    });

    if (routineId) {
      const resolved = resolveExistingRoutine(modality, routineId);
      if (!resolved) {
        const fallbackBack = isModality(modality) ? F.modalityUrl(modality) : F.url("treino");
        byId("back-to-modality").href = fallbackBack;
        showMissing("Esta rotina não existe mais. Ela pode ter sido excluída.", modality);
        return;
      }

      isNewRoutine = false;
      draftExplicitModality = true;
      draftModality = resolved.modality;
      draftRoutineId = resolved.routine.id;
      draft = cloneData(resolved.routine);
      draftDirty = false;
      editingRef = null;
    } else {
      /*
        Modo de criação direta (ex.: rotina.html, rotina.html?modalidade=...,
        rotina.html?nova=1): gera um ID válido em memória seguindo o padrão do
        projeto, sem gravar nada em localStorage até o usuário tocar em Salvar.
      */
      const now = Date.now();
      isNewRoutine = true;
      draftModality = isModality(modality) ? modality : "calisthenics";
      draftRoutineId = createId("routine");
      draft = {
        id: draftRoutineId,
        name: nextRoutineName(draftModality),
        modality: draftModality,
        createdAt: now,
        updatedAt: now,
        sections: { warmup: [], main: [], abs: [], finisher: [] }
      };
      draftDirty = false;
      editingRef = null;

      if (preloadExercise) {
        const match = libraryItems().find(item => {
          return item.id === preloadExercise ||
            normalizeSearch(item.name) === normalizeSearch(preloadExercise);
        });
        if (match) {
          const copy = exerciseFromLibraryItem(match);
          if (copy) {
            draft.sections[copy.section].push(copy);
            draftDirty = true;
          }
        }
      }
    }

    rememberEditorSaveBase();

    /*
      Mudanças de outra aba entram só na memória e na biblioteca exibida: o
      rascunho em edição nunca é redesenhado por sincronização — um conflito
      com a rotina aberta é detectado no salvamento (refreshEditorSaveBase).
    */
    watchExternalChanges(
      [KEYS.routines, KEYS.legacyExercises, KEYS.library, KEYS.active, KEYS.rotation],
      () => {
        renderLibrary();
        if (typeof F.updateActiveBanner === "function") F.updateActiveBanner();
      }
    );

    byId("back-to-modality").href = editorBackHref();
    byId("back-to-modality").addEventListener("click", event => {
      if (!draftDirty) return;
      event.preventDefault();
      leaveEditorPage(editorBackHref());
    });

    const modalityField = byId("editor-modality-field");
    const modalitySelect = byId("editor-modality-select");
    if (modalityField && modalitySelect) {
      modalityField.hidden = !isNewRoutine;
      modalitySelect.value = draftModality;
      modalitySelect.addEventListener("change", () => {
        const nextMode = modalitySelect.value;
        if (!isModality(nextMode) || nextMode === draftModality) return;

        const nameInput = byId("routine-name-input");
        const previousAutoName = nextRoutineName(draftModality);
        const currentInputName = nameInput ? nameInput.value.trim() : draft.name;

        draftModality = nextMode;
        draftExplicitModality = true;
        draft.modality = nextMode;

        if (!currentInputName || currentInputName === previousAutoName) {
          draft.name = nextRoutineName(nextMode);
          if (nameInput) nameInput.value = draft.name;
        }

        byId("routine-modality").textContent = MODE_NAMES[draftModality];
        byId("back-to-modality").href = editorBackHref();
        renderEditor();
        renderLibrary();
      });
    }

    byId("editor-missing").hidden = true;
    byId("editor-body").hidden = false;
    byId("routine-modality").textContent = MODE_NAMES[draftModality];

    byId("routine-name-input").addEventListener("input", event => {
      const value = event.target.value;
      if (value !== draft.name) markDirty();
    });

    byId("save-routine").addEventListener("click", saveRoutine);
    byId("save-routine-top").addEventListener("click", saveRoutine);
    const cancelButton = byId("cancel-routine");
    if (cancelButton) {
      cancelButton.addEventListener("click", () => leaveEditorPage(editorBackHref()));
    }

    byId("exercise-form").addEventListener("submit", handleExerciseSubmit);
    byId("cancel-exercise-edit").addEventListener("click", () => resetExerciseForm("main"));
    ["exercise-type-reps", "exercise-type-duration"].forEach(id => {
      byId(id).addEventListener("change", toggleMeasurementFields);
    });

    document.querySelectorAll("[data-add-section]").forEach(button => {
      button.addEventListener("click", () => {
        const section = button.getAttribute("data-add-section");
        resetExerciseForm(section);
        safeScrollIntoView(byId("exercise-form-card"));
        byId("exercise-name").focus();
      });
    });

    byId("library-search").addEventListener("input", event => {
      librarySearchValue = event.target.value;
      renderLibrary();
    });

    byId("library-toggle").addEventListener("click", () => {
      const panel = byId("library-panel");
      panel.hidden = !panel.hidden;
      byId("library-toggle").setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) {
        renderLibrary();
        byId("library-search").focus();
      }
    });

    byId("custom-toggle").addEventListener("click", () => {
      toggleCustomForm(byId("custom-form").hidden);
    });
    byId("custom-form").addEventListener("submit", handleCustomSubmit);
    ["custom-type-reps", "custom-type-duration"].forEach(id => {
      byId(id).addEventListener("change", toggleCustomFields);
    });
    toggleCustomFields();

    resetExerciseForm("main");
    renderEditor();
    renderLibrary();
  };

  F.leaveEditorPage = leaveEditorPage;
  F.modalityForEditor = () => draftModality;
  F.hasUnsavedRoutine = () => draftDirty;

})(window);
