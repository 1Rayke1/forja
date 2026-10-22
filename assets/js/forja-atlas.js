/*
  FORJA — Atlas muscular (explorar/atlas.html) e integração com exercícios.

  Duas camadas:

  1. `F.atlas`: consultas puras sobre o catálogo. Nada aqui escreve no
     armazenamento. A classificação muscular vem de `record.roles`
     (principal/secundário/estabilizador), definida em `forja-catalogo.js`;
     o atlas não recalcula papel nenhum por conta própria.

  2. `F.pages.atlas` e os pontos de integração (detalhe na biblioteca e
     execução do treino): mostram a figura humana de `forja-figura.js` com as
     regiões destacadas pelas cores da classificação.

  A pergunta que a tela responde é "quais regiões este exercício trabalha?" —
  por isso a seleção principal é de exercício, não de grupo. A exploração por
  grupo continua existindo, como seção secundária.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const VIEWS = Object.freeze({ front: "Anterior", back: "Posterior" });

  const ROLE_ORDER = Object.freeze(["primary", "secondary", "stabilizer", "focus", "informed"]);

  const ROLE_NAMES = Object.freeze({
    primary: "Principal",
    secondary: "Secundária",
    stabilizer: "Estabilizadora",
    focus: "Grupo em foco",
    informed: "Informado por você"
  });

  /*
    Grupos do mapa, na ordem em que aparecem na exploração por grupo. `tags`
    são os nomes usados pelo catálogo; `aliases` cobrem o que o usuário pode
    digitar em um exercício personalizado.
  */
  const GROUP_DEFS = [
    { id: "peito", label: "Peitoral", kind: "group", tags: ["peito"], aliases: ["peitoral", "peitoral maior"] },
    { id: "dorsais", label: "Dorsais", kind: "group", tags: ["dorsais"], aliases: ["dorsal", "grande dorsal", "latíssimo"] },
    { id: "ombros", label: "Ombros", kind: "region", tags: ["ombros"], aliases: ["ombro", "deltoide", "deltoides"] },
    { id: "biceps", label: "Bíceps", kind: "group", tags: ["bíceps"], aliases: ["biceps"] },
    { id: "triceps", label: "Tríceps", kind: "group", tags: ["tríceps"], aliases: ["triceps"] },
    { id: "antebracos", label: "Antebraços", kind: "group", tags: ["antebraços"], aliases: ["antebraco", "antebracos"] },
    { id: "costas", label: "Costas", kind: "region", tags: ["costas"], aliases: ["trapezio", "trapézio", "romboides"] },
    { id: "lombar", label: "Lombar", kind: "region", tags: ["lombar"], aliases: ["lombares", "eretores da espinha"] },
    { id: "abdomem", label: "Abdômen", kind: "group", tags: ["abdômen"], aliases: ["abdomen", "reto abdominal", "abdominal"] },
    { id: "obliquos", label: "Oblíquos", kind: "group", tags: ["oblíquos"], aliases: ["obliquos", "obliquo", "oblíquo"] },
    { id: "gluteos", label: "Glúteos", kind: "group", tags: ["glúteos"], aliases: ["gluteo", "gluteos"] },
    { id: "quadril", label: "Quadril", kind: "region", tags: ["quadril"], aliases: ["flexores do quadril", "iliopsoas"] },
    { id: "quadriceps", label: "Quadríceps", kind: "group", tags: ["quadríceps"], aliases: ["quadriceps"] },
    { id: "posterior-coxa", label: "Posterior de coxa", kind: "group", tags: ["posterior de coxa"], aliases: ["isquiotibiais", "posterior da coxa"] },
    { id: "panturrilha", label: "Panturrilha", kind: "group", tags: ["panturrilha"], aliases: ["gastrocnêmio", "gastrocnemio", "tríceps sural"] },
    { id: "pernas", label: "Pernas (região geral)", kind: "region", tags: ["pernas"], aliases: ["perna", "membros inferiores"] }
  ];

  const GROUPS = Object.freeze(GROUP_DEFS.map(group => Object.freeze(Object.assign({}, group, {
    tags: Object.freeze(group.tags.slice()),
    aliases: Object.freeze(group.aliases.slice())
  }))));

  const GROUP_BY_ID = Object.create(null);
  GROUPS.forEach(group => { GROUP_BY_ID[group.id] = group; });

  const VIEW_OF = Object.freeze({
    peito: "front",
    abdomem: "front",
    obliquos: "front",
    quadril: "front",
    quadriceps: "front",
    biceps: "front",
    dorsais: "back",
    costas: "back",
    lombar: "back",
    triceps: "back",
    gluteos: "back",
    "posterior-coxa": "back",
    panturrilha: "back",
    ombros: "both",
    antebracos: "both",
    pernas: "both"
  });

  const DISCLOSURE = "Figura esquemática de regiões musculares — não é uma " +
    "representação anatômica clínica. As cores indicam o papel da região no " +
    "movimento, a partir da classificação do catálogo. Desenho: Open Muscle Map " +
    "(MIT), com origem declarada em ilustração gerada por IA.";

  function normalize(value) {
    return F.catalog.normalizeText(value);
  }

  function groupById(id) {
    return GROUP_BY_ID[id] || null;
  }

  function groupForMuscleName(name) {
    const key = normalize(name);
    if (!key) return null;

    return GROUPS.find(group => group.tags.concat(group.aliases).map(normalize).indexOf(key) !== -1) || null;
  }

  /* Regiões (no vocabulário da figura) atingidas por um exercício, com o papel. */
  function highlightsFor(record) {
    const out = {};
    if (!record) return out;

    const roles = record.roles;

    if (roles) {
      ["primary", "secondary", "stabilizers"].forEach(level => {
        const role = level === "stabilizers" ? "stabilizer" : level;
        (roles[level] || []).forEach(muscle => {
          const group = groupForMuscleName(muscle);
          if (!group) return;
          if (!out[group.id] || ROLE_ORDER.indexOf(role) < ROLE_ORDER.indexOf(out[group.id])) out[group.id] = role;
        });
      });

      return out;
    }

    /*
      Item personalizado: o usuário informou grupos, mas não papéis. Nada é
      suposto — a região entra como "informado por você".
    */
    (record.muscles || []).forEach(muscle => {
      const group = groupForMuscleName(muscle);
      if (group && !out[group.id]) out[group.id] = "informed";
    });

    return out;
  }

  function highlightList(highlights) {
    return Object.keys(highlights)
      .map(id => ({ id, group: groupById(id), role: highlights[id] }))
      .filter(entry => entry.group)
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  }

  function countByRole(entries) {
    const counts = { primary: 0, secondary: 0, stabilizer: 0, informed: 0 };
    entries.forEach(entry => { counts[entry.role] = (counts[entry.role] || 0) + 1; });
    return counts;
  }

  function roleLabel(role) {
    return ROLE_NAMES[role] || "";
  }

  function whereLabel(groupId) {
    const view = VIEW_OF[groupId];
    if (view === "front") return "vista anterior";
    if (view === "back") return "vista posterior";
    return "anterior e posterior";
  }

  /* Exercícios ligados a um grupo (usado pela exploração por grupo). */
  function exercisesFor(groupId, options = {}) {
    const group = groupById(groupId);
    if (!group) return [];

    const mode = options.mode === "calisthenics" || options.mode === "weights" ? options.mode : null;
    const items = F.catalog.items(mode || undefined);

    return items
      .map(record => ({ record, role: highlightsFor(record)[group.id] || null }))
      .filter(entry => entry.role !== null)
      .sort((a, b) => {
        const rank = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
        if (rank !== 0) return rank;
        return a.record.name.localeCompare(b.record.name, "pt-BR");
      });
  }

  /* Exercício do catálogo correspondente a um item de rotina/sessão. */
  function findRecordFor(exercise) {
    if (!exercise || !F.catalog) return null;

    const items = F.catalog.items();

    if (exercise.libraryId) {
      const byLibraryId = items.find(record => record.libraryId === exercise.libraryId || record.id === exercise.libraryId);
      if (byLibraryId) return byLibraryId;
    }

    const name = normalize(exercise.name);
    return items.find(record => normalize(record.name) === name) || null;
  }

  /* Exercícios sugeridos que podem ser escolhidos no atlas. */
  function choosableExercises(mode) {
    return F.catalog.items(mode || undefined)
      .filter(record => record.suggested || Object.keys(highlightsFor(record)).length > 0)
      .sort((a, b) => {
        if (a.mode !== b.mode) return a.mode === "calisthenics" ? -1 : 1;
        const order = (F.SECTION_ORDER || []).indexOf(a.section) - (F.SECTION_ORDER || []).indexOf(b.section);
        if (order !== 0) return order;
        return a.name.localeCompare(b.name, "pt-BR");
      });
  }

  /* ------------------------------------------------------------------ */
  /* Peças compartilhadas (atlas, biblioteca e execução)                 */
  /* ------------------------------------------------------------------ */

  function el(tag, className, text) {
    return F.ui.el(tag, className, text);
  }

  function figurePair(highlights, options) {
    const settings = Object.assign({ compact: false, label: "" }, options || {});
    const wrap = el("div", "atlas-figuras");

    ["front", "back"].forEach(view => {
      const cell = el("div", "atlas-figura-cell");
      cell.setAttribute("data-view", view);

      cell.appendChild(F.figura.render({
        view,
        highlights,
        compact: settings.compact,
        label: F.figura.describe(highlights, view)
      }));

      const caption = el("p", "atlas-figura-caption");
      caption.textContent = VIEWS[view];
      cell.appendChild(caption);

      wrap.appendChild(cell);
    });

    if (settings.label) {
      const note = el("p", "atlas-figuras-note", settings.label);
      wrap.appendChild(note);
    }

    return wrap;
  }

  function legendNode(highlights, options) {
    const settings = Object.assign({ compact: false, record: null }, options || {});
    const entries = highlightList(highlights);
    const box = el("div", "atlas-legenda");

    if (entries.length === 0) {
      box.appendChild(F.ui.empty({
        icon: "info",
        title: "Sem classificação muscular",
        text: "Este exercício não tem grupos musculares registrados. Nada é preenchido por suposição: a classificação vem do catálogo, e exercícios personalizados só entram no atlas quando você informa os grupos.",
        actions: settings.compact ? [] : [{
          label: "Abrir biblioteca",
          href: F.url("biblioteca"),
          variant: "secondary-button",
          icon: "book"
        }]
      }));
      return box;
    }

    const list = el("ul", "atlas-legenda-lista");

    entries.forEach(entry => {
      const item = el("li", "atlas-legenda-item");
      item.setAttribute("data-region", entry.id);
      item.setAttribute("data-role", entry.role);

      const swatch = el("span", "atlas-swatch is-" + entry.role);
      swatch.setAttribute("aria-hidden", "true");
      item.appendChild(swatch);

      const text = el("div", "atlas-legenda-texto");
      text.appendChild(el("strong", "atlas-legenda-nome", entry.group.label));

      const meta = el("span", "atlas-legenda-meta");
      meta.textContent = roleLabel(entry.role) + " · " + whereLabel(entry.id);
      text.appendChild(meta);
      item.appendChild(text);

      /* Alternativa aos filtros da biblioteca: abre a lista já filtrada. */
      const link = el("a", "atlas-legenda-link");
      link.href = F.url("biblioteca", { musculo: (entry.group.tags[0] || entry.id) });
      link.setAttribute("aria-label", "Ver exercícios de " + entry.group.label + " na biblioteca");
      link.appendChild(F.ui.icon("arrow-right"));
      item.appendChild(link);

      list.appendChild(item);
    });

    box.appendChild(list);
    return box;
  }

  /* Chave de cores: mostra o vocabulário antes da primeira seleção. */
  function colorKey() {
    const box = el("div", "atlas-color-key");
    box.setAttribute("aria-label", "Cores usadas na figura");

    [
      { role: "primary", text: "Principal" },
      { role: "secondary", text: "Secundária" },
      { role: "stabilizer", text: "Estabilizadora" }
    ].forEach(entry => {
      const item = el("span", "atlas-color-key-item");
      const swatch = el("span", "atlas-swatch is-" + entry.role);
      swatch.setAttribute("aria-hidden", "true");
      item.appendChild(swatch);
      item.appendChild(el("span", null, entry.text));
      box.appendChild(item);
    });

    return box;
  }

  /* Texto curto da classificação, usado em resumos e anúncios. */
  function describeRoles(record) {
    const entries = highlightList(highlightsFor(record));
    if (entries.length === 0) return "sem classificação muscular registrada";

    return entries.map(entry => entry.group.label + " (" + ROLE_NAMES[entry.role].toLowerCase() + ")").join(", ");
  }

  /* Modal "músculos trabalhados" (biblioteca e execução). */
  async function showMuscles(record) {
    const highlights = highlightsFor(record);
    const details = el("div", "modal-details atlas-modal");
    details.appendChild(figurePair(highlights));
    details.appendChild(legendNode(highlights, { compact: true }));
    details.appendChild(el("p", "atlas-modal-note", DISCLOSURE));

    await F.showModal({
      title: "Músculos trabalhados",
      message: record.name,
      details,
      actions: [{ id: "close", label: "Fechar", className: "secondary-button" }]
    });
  }

  /* Figura compacta dentro da execução: só a vista do grupo principal. */
  function attachToExecution(exercise, container) {
    if (!container) return null;

    const record = findRecordFor(exercise);
    const highlights = highlightsFor(record);

    while (container.firstChild) container.removeChild(container.firstChild);

    if (Object.keys(highlights).length === 0) {
      container.hidden = true;
      return null;
    }

    container.hidden = false;

    const entries = highlightList(highlights);
    const primary = entries.find(entry => entry.role === "primary");
    const view = primary && VIEW_OF[primary.id] === "back" ? "back" : "front";

    const cell = el("div", "atlas-figura-cell is-compact");
    cell.appendChild(F.figura.render({
      view,
      highlights,
      compact: true,
      label: F.figura.describe(highlights, view)
    }));

    /*
      Legenda curta: só o que aparece nesta vista, com o papel de cada região.
      Os detalhes completos ficam no botão "Ver músculos trabalhados".
    */
    const visible = entries.filter(entry => F.figura.regionsInView(view).includes(entry.id));
    const caption = el("p", "atlas-figura-caption execution-figure-caption");
    caption.textContent = VIEWS[view] + " · " + (visible.length
      ? visible.map(entry => entry.group.label).join(", ")
      : "sem regiões nesta vista");
    cell.appendChild(caption);

    container.appendChild(cell);

    return record;
  }

  F.atlas = {
    VIEWS,
    GROUPS,
    DISCLOSURE,
    ROLE_NAMES,
    groupById,
    groupForMuscleName,
    highlightsFor,
    highlightList,
    countByRole,
    roleLabel,
    whereLabel,
    exercisesFor,
    findRecordFor,
    choosableExercises,
    describeRoles,
    figurePair,
    legendNode,
    showMuscles,
    attachToExecution
  };

  /* ------------------------------------------------------------------ */
  /* Página: explorar/atlas.html                                          */
  /* ------------------------------------------------------------------ */

  const page = {
    exerciseId: null,
    groupId: null,
    mode: null
  };

  let host = null;
  let mounted = false;
  let pendingFocus = null;
  let lastError = null;

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function readInitialState() {
    let params = null;

    try {
      params = new URLSearchParams(global.location.search);
    } catch (error) {
      params = null;
    }

    if (!params) return;

    const exercise = findRecordFor({ libraryId: params.get("exercicio"), name: "" });
    if (exercise) page.exerciseId = exercise.libraryId || exercise.id;

    const group = groupById(params.get("grupo"));
    if (group) page.groupId = group.id;

    const mode = params.get("modalidade");
    if (mode === "calisthenics" || mode === "weights") page.mode = mode;
  }

  function selectedExercise() {
    if (!page.exerciseId) return null;

    return F.catalog.items().find(record => (record.libraryId || record.id) === page.exerciseId) || null;
  }

  function snapshotFocus() {
    const active = doc.activeElement;
    if (!active || !host || !host.contains(active)) return null;

    const key = active.getAttribute("data-atlas-focus");
    return key || null;
  }

  function restoreFocus(key) {
    if (!key || !host) return;

    let node = null;

    if (key === "first-group") {
      node = host.querySelector("[data-group-chip]");
    } else {
      node = host.querySelector('[data-atlas-focus="' + key.replace(/"/g, '\\"') + '"]');
    }

    if (node && typeof node.focus === "function") node.focus();
  }

  /* ---------------- seleção de exercício ---------------- */

  function exercisePicker() {
    const card = el("section", "atlas-card atlas-picker-card");
    card.setAttribute("aria-labelledby", "atlas-exercise-title");

    const head = el("div", "atlas-card-head");
    const title = el("h2", "atlas-card-title", "Exercício");
    title.id = "atlas-exercise-title";
    head.appendChild(title);
    card.appendChild(head);

    const field = el("div", "atlas-picker");
    const label = el("label", "field-label", "Escolha um exercício do catálogo");
    label.setAttribute("for", "atlas-exercise-select");
    field.appendChild(label);

    const select = doc.createElement("select");
    select.id = "atlas-exercise-select";
    select.className = "atlas-select";
    select.setAttribute("data-atlas-focus", "select");

    const placeholder = doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selecione um exercício…";
    select.appendChild(placeholder);

    ["calisthenics", "weights"].forEach(mode => {
      const group = doc.createElement("optgroup");
      group.label = F.MODE_NAMES[mode];

      choosableExercises(mode).forEach(record => {
        const option = doc.createElement("option");
        option.value = record.libraryId || record.id;
        option.textContent = record.name;
        if (option.value === page.exerciseId) option.selected = true;
        group.appendChild(option);
      });

      if (group.children.length > 0) select.appendChild(group);
    });

    select.addEventListener("change", () => {
      selectExercise(select.value || null);
    });

    field.appendChild(select);
    field.appendChild(el("p", "field-hint",
      "Os exercícios sugeridos já vêm com a classificação muscular do catálogo. Exercícios personalizados só aparecem com as regiões que você informou."));
    card.appendChild(field);

    /* Atalhos: os movimentos mais reconhecíveis, para começar em um toque. */
    const shortcuts = el("div", "atlas-shortcuts");
    shortcuts.appendChild(el("span", "atlas-shortcuts-label", "Atalhos"));

    const picks = ["cal-flexao", "cal-agachamento", "mus-supino-reto", "cal-barra-fixa", "cal-prancha-frontal", "mus-terra"];

    picks.forEach(id => {
      const record = F.catalog.items().find(item => item.libraryId === id);
      if (!record) return;

      const chip = el("button", "atlas-shortcut");
      chip.type = "button";
      chip.textContent = record.name;
      chip.setAttribute("data-atlas-focus", "shortcut:" + id);
      chip.setAttribute("aria-pressed", page.exerciseId === id ? "true" : "false");
      chip.addEventListener("click", () => selectExercise(id));
      shortcuts.appendChild(chip);
    });

    card.appendChild(shortcuts);
    return card;
  }

  /* ---------------- figura e legenda ---------------- */

  function exerciseCard() {
    const card = el("section", "atlas-card atlas-exercise-card");
    card.setAttribute("aria-labelledby", "atlas-figure-title");

    const record = selectedExercise();

    if (!record) {
      const title = el("h2", "atlas-card-title", "Regiões trabalhadas");
      title.id = "atlas-figure-title";
      card.appendChild(title);

      card.appendChild(figurePair({}, { label: "Nenhuma região destacada." }));
      card.appendChild(el("p", "atlas-card-note",
        "Escolha um exercício acima para destacar as regiões principais, secundárias e estabilizadoras. Nenhum grupo é destacado sem dado no catálogo."));
      card.appendChild(colorKey());
      card.appendChild(el("p", "atlas-disclosure", DISCLOSURE));
      return card;
    }

    const highlights = highlightsFor(record);
    const entries = highlightList(highlights);
    const counts = countByRole(entries);
    const primary = entries.filter(entry => entry.role === "primary").map(entry => entry.group.label);

    const head = el("div", "atlas-card-head atlas-exercise-head");
    const title = el("h2", "atlas-card-title", record.name);
    title.id = "atlas-figure-title";
    head.appendChild(title);

    const actions = el("div", "atlas-exercise-actions");
    actions.appendChild(F.ui.linkButton({
      label: "Ver na biblioteca",
      href: F.url("biblioteca", { exercicio: record.libraryId || record.id, modalidade: record.mode }),
      variant: "secondary-button",
      className: "small-button",
      icon: "book",
      ariaLabel: "Abrir " + record.name + " na biblioteca"
    }));
    head.appendChild(actions);
    card.appendChild(head);

    const chips = el("div", "ui-exercise-tags");
    chips.appendChild(F.ui.chip(F.MODE_NAMES[record.mode] || record.mode, record.mode === "weights" ? "accent" : "muted"));
    if (record.category) chips.appendChild(F.ui.chip(F.catalog.categoryLabel(record.category), "muted"));
    chips.appendChild(F.ui.chip(F.SECTION_NAMES[record.section] || "", "muted"));
    card.appendChild(chips);

    card.appendChild(figurePair(highlights));

    const summary = el("p", "atlas-resumo");
    summary.id = "atlas-highlight-summary";
    summary.setAttribute("aria-live", "polite");
    summary.textContent = entries.length === 0
      ? "Sem classificação muscular registrada para este exercício."
      : (primary.length
        ? "Principal: " + primary.join(" e ") + ". "
        : "") +
        (counts.secondary ? counts.secondary + (counts.secondary === 1 ? " região secundária" : " regiões secundárias") + ". " : "") +
        (counts.stabilizer ? counts.stabilizer + (counts.stabilizer === 1 ? " região estabilizadora" : " regiões estabilizadoras") + "." : "") +
        (counts.informed ? " " + counts.informed + (counts.informed === 1 ? " região informada por você." : " regiões informadas por você.") : "");
    card.appendChild(summary);

    card.appendChild(legendNode(highlights, { record }));

    card.appendChild(el("p", "atlas-disclosure", DISCLOSURE));
    return card;
  }

  /* ---------------- exploração por grupo ---------------- */

  function groupExplorer() {
    const card = el("section", "atlas-card atlas-group-card");
    card.setAttribute("aria-labelledby", "atlas-group-title");

    const head = el("div", "atlas-card-head");
    const title = el("h2", "atlas-card-title", "Explorar por grupo muscular");
    title.id = "atlas-group-title";
    head.appendChild(title);

    const clearButton = el("button", "atlas-inline-reset");
    clearButton.type = "button";
    clearButton.textContent = "Limpar seleção";
    clearButton.disabled = !page.groupId;
    if (page.groupId) clearButton.setAttribute("data-atlas-focus", "clear");
    clearButton.addEventListener("click", clearGroup);
    head.appendChild(clearButton);
    card.appendChild(head);

    card.appendChild(el("p", "atlas-card-note",
      "Escolha um grupo para ver quais exercícios do catálogo o trabalham, com o papel de cada um."));

    const chips = el("div", "atlas-group-chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Grupos musculares");

    GROUPS.forEach(group => {
      const total = F.atlas.exercisesFor(group.id, { mode: page.mode || undefined }).length;
      const active = page.groupId === group.id;
      const chip = el("button", "atlas-group-chip");
      chip.type = "button";
      chip.setAttribute("data-group-chip", group.id);
      chip.setAttribute("data-atlas-focus", "group:" + group.id);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
      chip.appendChild(el("span", "atlas-group-chip-name", group.label));
      chip.appendChild(el("span", "atlas-group-chip-count", total === 0 ? "0" : String(total)));
      chip.title = total === 0
        ? "Nenhum exercício do catálogo para " + group.label
        : total + (total === 1 ? " exercício" : " exercícios") + " para " + group.label;
      chip.addEventListener("click", () => selectGroup(group.id, active));
      chips.appendChild(chip);
    });

    card.appendChild(chips);

    const group = groupById(page.groupId);

    if (!group) {
      card.appendChild(el("p", "atlas-group-empty",
        "Nenhum grupo selecionado. A figura acima continua mostrando o exercício escolhido."));
      return card;
    }

    const status = el("p", "atlas-group-status");
    status.id = "atlas-group-status";
    status.textContent = "Grupo em foco: " + group.label + " · " + whereLabel(group.id);
    card.appendChild(status);

    const figureWrap = el("div", "atlas-group-figure");
    figureWrap.appendChild(F.figura.render({
      view: VIEW_OF[group.id] === "back" ? "back" : "front",
      highlights: (() => {
        const focus = {};
        focus[group.id] = "focus";
        return focus;
      })(),
      label: group.label + " em foco, " + whereLabel(group.id)
    }));
    card.appendChild(figureWrap);

    const entries = F.atlas.exercisesFor(group.id, { mode: page.mode });
    const everyEntry = F.atlas.exercisesFor(group.id);

    const modeWrap = el("div", "atlas-mode-control");
    modeWrap.id = "atlas-modes";
    modeWrap.appendChild(F.ui.segmented({
      label: "Filtrar exercícios por modalidade",
      value: page.mode,
      options: [
        { value: null, label: "Todas", count: everyEntry.length },
        { value: "calisthenics", label: F.MODE_NAMES.calisthenics, count: everyEntry.filter(entry => entry.record.mode === "calisthenics").length },
        { value: "weights", label: F.MODE_NAMES.weights, count: everyEntry.filter(entry => entry.record.mode === "weights").length }
      ],
      onChange(value) { selectMode(value); }
    }));
    card.appendChild(modeWrap);

    const list = el("div", "atlas-exercise-list");
    const status2 = el("p", "atlas-exercises-status");
    status2.id = "atlas-exercises-status";
    status2.setAttribute("aria-live", "polite");
    status2.textContent = entries.length === 0
      ? (page.mode
        ? "Nenhum exercício de " + F.MODE_NAMES[page.mode].toLowerCase() + " para " + group.label
        : "Nenhum exercício do catálogo para " + group.label)
      : entries.length + (entries.length === 1 ? " exercício" : " exercícios") + " · " +
        (page.mode ? F.MODE_NAMES[page.mode] : "todas as modalidades") + " · " + group.label;
    card.appendChild(status2);

    if (entries.length === 0) {
      list.appendChild(F.ui.empty({
        icon: "search",
        title: everyEntry.length ? "Nenhum exercício desta modalidade" : "Nenhum exercício para este grupo",
        text: everyEntry.length
          ? "O catálogo tem exercícios para este grupo em outra modalidade. Limpe o filtro para vê-los."
          : "O catálogo atual não tem exercícios classificados para este grupo — e o atlas não inventa vínculos.",
        actions: everyEntry.length
          ? [{ label: "Mostrar todas as modalidades", variant: "primary-button", icon: "filter", onClick: () => selectMode(null) }]
          : []
      }));
    } else {
      entries.forEach(entry => list.appendChild(groupExerciseRow(entry)));
    }

    card.appendChild(list);
    return card;
  }

  function groupExerciseRow(entry) {
    const record = entry.record;
    const row = el("div", "ui-exercise-row atlas-exercise-row");
    const main = el("div", "ui-exercise-main");

    main.appendChild(el("h3", "ui-exercise-name", record.name));

    const tags = el("div", "ui-exercise-tags");
    tags.appendChild(F.ui.chip(F.MODE_NAMES[record.mode] || record.mode, record.mode === "weights" ? "accent" : "muted"));
    tags.appendChild(F.ui.chip(roleLabel(entry.role), entry.role === "primary" ? "accent" : "muted"));
    main.appendChild(tags);

    const meta = el("p", "ui-exercise-meta");
    meta.textContent = [F.SECTION_NAMES[record.section] || "", F.catalog.summary(record)].filter(Boolean).join(" · ");
    main.appendChild(meta);

    row.appendChild(main);
    row.appendChild(F.ui.linkButton({
      label: "Detalhes",
      href: F.url("biblioteca", { exercicio: record.libraryId || record.id, modalidade: record.mode }),
      variant: "secondary-button",
      className: "small-button",
      icon: "book",
      ariaLabel: "Abrir " + record.name + " na biblioteca"
    }));

    return row;
  }

  /* ---------------- ações ---------------- */

  function announce() {
    const record = selectedExercise();

    if (page.groupId) {
      const group = groupById(page.groupId);
      const total = F.atlas.exercisesFor(group.id, { mode: page.mode || undefined }).length;
      F.ui.announce(group.label + " em foco. " +
        (total === 0 ? "Nenhum exercício do catálogo para este grupo." : total + (total === 1 ? " exercício relacionado." : " exercícios relacionados.")));
      return;
    }

    if (!record) {
      F.ui.announce("Nenhum exercício selecionado.");
      return;
    }

    F.ui.announce(record.name + ". " + describeRoles(record) + ".");
  }

  function selectExercise(id) {
    const record = id ? F.catalog.items().find(item => (item.libraryId || item.id) === id) : null;

    page.exerciseId = record ? (record.libraryId || record.id) : null;
    page.groupId = null;
    pendingFocus = "select";
    render();
    announce();
  }

  function selectGroup(id, alreadyActive) {
    page.groupId = alreadyActive ? null : id;
    pendingFocus = "group:" + id;
    render();
    announce();
  }

  function clearGroup() {
    if (!page.groupId) return;
    page.groupId = null;
    pendingFocus = "first-group";
    render();
    announce();
  }

  function selectMode(mode) {
    page.mode = mode === "calisthenics" || mode === "weights" ? mode : null;
    pendingFocus = "mode:" + (page.mode || "null");
    render();

    const total = page.groupId ? F.atlas.exercisesFor(page.groupId, { mode: page.mode || undefined }).length : 0;
    F.ui.announce((page.mode ? "Filtro: " + F.MODE_NAMES[page.mode] + ". " : "Todas as modalidades. ") +
      (total === 0 ? "Nenhum exercício." : total + (total === 1 ? " exercício." : " exercícios.")));
  }

  /* ---------------- montagem ---------------- */

  function render() {
    if (!host) return;

    lastError = null;
    const focus = pendingFocus || snapshotFocus();
    pendingFocus = null;

    clear(host);
    host.removeAttribute("aria-busy");

    const layout = el("div", "atlas-layout");
    layout.appendChild(exercisePicker());
    layout.appendChild(exerciseCard());
    layout.appendChild(groupExplorer());
    host.appendChild(layout);

    restoreFocus(focus);
  }

  function renderError(error) {
    lastError = error;
    if (!host) return;

    clear(host);
    host.removeAttribute("aria-busy");

    const box = el("div", "atlas-error");
    box.setAttribute("role", "alert");

    box.appendChild(F.ui.icon("alert"));
    const body = el("div", "atlas-error-body");
    body.appendChild(el("strong", "atlas-error-title", "Não foi possível montar o atlas agora"));
    body.appendChild(el("p", "atlas-error-text",
      "Os dados do catálogo não puderam ser lidos nesta tentativa. Nada foi gravado nem alterado. " +
      "Tente de novo; se continuar, recarregue a página."));

    const actions = el("div", "atlas-error-actions");
    const retry = F.ui.button({
      label: "Tentar de novo",
      icon: "repeat",
      variant: "primary-button",
      onClick() {
        try {
          render();
          F.ui.announce("Atlas montado.");
        } catch (nextError) {
          renderError(nextError);
        }
      }
    });
    retry.setAttribute("data-atlas-focus", "retry");
    actions.appendChild(retry);
    body.appendChild(actions);

    box.appendChild(body);
    host.appendChild(box);
    restoreFocus("retry");
  }

  function boot() {
    const root = doc.getElementById("atlas-root");
    if (!root) return;

    host = root;
    host.setAttribute("aria-busy", "true");

    try {
      readInitialState();
      render();
      mounted = true;
    } catch (error) {
      renderError(error);
    }

    F.onDataChanged(() => {
      if (!mounted) return;
      try {
        render();
      } catch (error) {
        renderError(error);
      }
    });
  }

  F.pages.atlas = boot;

  F.pages.atlas.refresh = function refresh() {
    try {
      render();
    } catch (error) {
      renderError(error);
    }
  };

  F.pages.atlas.state = function state() {
    return { exerciseId: page.exerciseId, groupId: page.groupId, mode: page.mode, error: lastError };
  };
})(window);
