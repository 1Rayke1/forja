/*
  FORJA — Atlas anatômico interativo (mapa esquemático de grupos musculares).

  O que este módulo NÃO é: não é uma representação anatômica clínica. O desenho
  é um manequim vetorial simplificado, feito para localizar *grupos* de músculos
  e ligar cada grupo aos exercícios que o catálogo classifica. Nenhum músculo,
  inserção, função ou relação anatômica é inventada aqui: os nomes vêm dos
  metadados revisados em `forja-catalogo.js`, e a classificação principal /
  secundária / estabilizadora é declarada lá, com revisão documentada em
  `docs/atlas-anatomico.md`.

  Duas camadas, separadas:

  1. `F.atlas`: modelo de dados + consultas puras (grupos, vistas, relação
     grupo ↔ exercício). Não escreve nada no armazenamento e não depende da
     página.

  2. `F.pages.atlas`: a tela `explorar/atlas.html` — mapa anterior/posterior,
     legenda numerada, seleção de região e lista de exercícios com filtro por
     modalidade. Consultar o atlas nunca altera rotinas, sessões ou histórico.

  Acessibilidade: as regiões do mapa são `role="button"` com `tabindex`, nome
  acessível e número visível (a identificação não depende de cor); a legenda
  repete cada região em botões nativos. O estado selecionado é anunciado em
  região viva. Toda animação é opcional e desligada por
  `prefers-reduced-motion` (ver `atlas.css`).
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const VIEWS = Object.freeze({
    front: "Vista anterior",
    back: "Vista posterior"
  });

  const VIEW_SLUGS = Object.freeze({ front: "anterior", back: "posterior" });

  /*
    Grupos e regiões do mapa. `tags` são os nomes usados pelo catálogo (a mesma
    string que aparece na biblioteca e nos filtros); `aliases` cobrem sinônimos
    que o usuário pode ter digitado em um exercício personalizado. A comparação
    é feita sem acentos e sem caixa.

    `kind` distingue grupo muscular de região geral. "pernas", "costas",
    "ombros" e "quadril" são regiões amplas: o catálogo as usa para
    condicionamento e mobilidade, e o atlas não as apresenta como músculo
    isolado.
  */
  const GROUP_DEFS = [
    {
      id: "ombros", number: 1, view: "front", kind: "region",
      label: "Ombros (deltoides)", tags: ["ombros"],
      aliases: ["ombro", "deltoide", "deltoides"],
      x: 74, y: 80, r: 12,
      where: "Região das articulações dos ombros e do deltoides."
    },
    {
      id: "peito", number: 2, view: "front", kind: "group",
      label: "Peitoral", tags: ["peito"],
      aliases: ["peitoral", "peitoral maior", "peito"],
      x: 110, y: 112, r: 15,
      where: "Frente do tórax."
    },
    {
      id: "biceps", number: 3, view: "front", kind: "group",
      label: "Bíceps braquial", tags: ["bíceps"],
      aliases: ["biceps", "bíceps braquial", "biceps braquial"],
      x: 68, y: 142, r: 11,
      where: "Parte da frente do braço, entre o ombro e o cotovelo."
    },
    {
      id: "antebracos", number: 4, view: "front", kind: "group",
      label: "Antebraços", tags: ["antebraços"],
      aliases: ["antebraco", "antebraços", "antebracos"],
      x: 64, y: 196, r: 10,
      where: "Entre o cotovelo e o punho."
    },
    {
      id: "abdomem", number: 5, view: "front", kind: "group",
      label: "Abdômen (reto abdominal)", tags: ["abdômen"],
      aliases: ["abdomen", "abdômen", "reto abdominal", "abdominal"],
      x: 110, y: 150, r: 14,
      where: "Frente do tronco, abaixo do peito."
    },
    {
      id: "obliquos", number: 6, view: "front", kind: "group",
      label: "Oblíquos", tags: ["oblíquos"],
      aliases: ["obliquos", "oblíquo", "obliquo", "obligos"],
      x: 88, y: 174, r: 10,
      where: "Laterais do tronco, entre as costelas e o quadril."
    },
    {
      id: "quadril", number: 7, view: "front", kind: "region",
      label: "Flexores do quadril", tags: ["quadril"],
      aliases: ["quadril", "flexores do quadril", "iliopsoas"],
      x: 110, y: 198, r: 12,
      where: "Dobra do quadril e frente da pelve. O catálogo usa \"quadril\" como região, não como músculo isolado."
    },
    {
      id: "quadriceps", number: 8, view: "front", kind: "group",
      label: "Quadríceps", tags: ["quadríceps"],
      aliases: ["quadriceps", "quadríceps femoral"],
      x: 98, y: 250, r: 15,
      where: "Frente da coxa."
    },
    {
      id: "pernas", number: 9, view: "front", kind: "region",
      label: "Membros inferiores (região geral)", tags: ["pernas"],
      aliases: ["perna", "pernas", "membros inferiores", "membro inferior"],
      x: 124, y: 330, r: 13,
      where: "Região geral das pernas, usada por exercícios de corpo inteiro e condicionamento."
    },
    {
      id: "costas", number: 1, view: "back", kind: "region",
      label: "Costas (região superior)", tags: ["costas"],
      aliases: ["costas", "trapezio", "trapézio", "romboides"],
      x: 110, y: 96, r: 14,
      where: "Parte superior das costas, entre os ombros."
    },
    {
      id: "dorsais", number: 2, view: "back", kind: "group",
      label: "Dorsais (grande dorsal)", tags: ["dorsais"],
      aliases: ["dorsal", "dorsais", "grande dorsal", "latissimo", "latíssimo"],
      x: 84, y: 126, r: 12,
      where: "Laterais das costas, abaixo das escápulas."
    },
    {
      id: "triceps", number: 3, view: "back", kind: "group",
      label: "Tríceps braquial", tags: ["tríceps"],
      aliases: ["triceps", "tríceps braquial", "triceps braquial"],
      x: 66, y: 158, r: 11,
      where: "Parte de trás do braço, entre o ombro e o cotovelo."
    },
    {
      id: "lombar", number: 4, view: "back", kind: "region",
      label: "Lombar", tags: ["lombar"],
      aliases: ["lombar", "lombares", "eretores da espinha"],
      x: 110, y: 168, r: 11,
      where: "Parte baixa das costas."
    },
    {
      id: "gluteos", number: 5, view: "back", kind: "group",
      label: "Glúteos", tags: ["glúteos"],
      aliases: ["gluteo", "glúteo", "gluteos", "glúteos", "glúteo máximo"],
      x: 110, y: 206, r: 14,
      where: "Parte de trás do quadril."
    },
    {
      id: "posterior-coxa", number: 6, view: "back", kind: "group",
      label: "Posterior de coxa", tags: ["posterior de coxa"],
      aliases: ["posterior de coxa", "isquiotibiais", "posterior da coxa"],
      x: 98, y: 252, r: 15,
      where: "Parte de trás da coxa."
    },
    {
      id: "panturrilha", number: 7, view: "back", kind: "group",
      label: "Panturrilha", tags: ["panturrilha"],
      aliases: ["panturrilha", "gastrocnemio", "gastrocnêmio", "triceps sural", "tríceps sural"],
      x: 124, y: 328, r: 13,
      where: "Parte de trás da perna, abaixo do joelho."
    }
  ];

  const GROUPS = Object.freeze(GROUP_DEFS.map(definition => Object.freeze(Object.assign({}, definition, {
    tags: Object.freeze(definition.tags.slice()),
    aliases: Object.freeze(definition.aliases.slice())
  }))));

  const GROUP_BY_ID = Object.create(null);
  GROUPS.forEach(group => { GROUP_BY_ID[group.id] = group; });

  const VIEW_GROUPS = Object.freeze({
    front: Object.freeze(GROUPS.filter(group => group.view === "front")),
    back: Object.freeze(GROUPS.filter(group => group.view === "back"))
  });

  const ROLE_ORDER = Object.freeze(["primary", "secondary", "stabilizer", "informed"]);

  const ROLE_NAMES = Object.freeze({
    primary: "Principal",
    secondary: "Secundário",
    stabilizer: "Estabilizador",
    informed: "Informado por você"
  });

  const MAP_DISCLOSURE = "Mapa esquemático de grupos musculares. Não é uma " +
    "representação anatômica clínica: o desenho apenas localiza regiões para " +
    "ligar cada grupo aos exercícios do catálogo.";

  function normalize(value) {
    return F.catalog.normalizeText(value);
  }

  function groupById(id) {
    return GROUP_BY_ID[id] || null;
  }

  function groupsForView(view) {
    return VIEW_GROUPS[view] || VIEW_GROUPS.front;
  }

  /* Nomes aceitos por um grupo (tags do catálogo + sinônimos), normalizados. */
  function groupKeys(group) {
    return group.tags.concat(group.aliases).map(normalize).filter(Boolean);
  }

  /* Converte um nome livre de músculo (ex.: "Peitoral") em um grupo do atlas. */
  function groupForMuscleName(name) {
    const key = normalize(name);
    if (!key) return null;

    return GROUPS.find(group => groupKeys(group).indexOf(key) !== -1) || null;
  }

  /*
    Nível de participação de um grupo em um exercício. Para itens sugeridos a
    resposta vem de `record.roles` (declarado no catálogo). Para itens
    personalizados COM grupos digitados pelo usuário, o vínculo é "informed":
    aparece na lista, mas não recebe rótulo de principal/secundário. Sem grupos
    informados, o exercício não entra no atlas — nada é suposto.
  */
  function roleFor(record, groupId) {
    if (!record) return null;

    const roles = record.roles;
    if (roles) {
      if (roles.primary && roles.primary.some(name => (groupForMuscleName(name) || {}).id === groupId)) return "primary";
      if (roles.secondary && roles.secondary.some(name => (groupForMuscleName(name) || {}).id === groupId)) return "secondary";
      if (roles.stabilizers && roles.stabilizers.some(name => (groupForMuscleName(name) || {}).id === groupId)) return "stabilizer";
      return null;
    }

    const muscles = Array.isArray(record.muscles) ? record.muscles : [];
    return muscles.some(name => (groupForMuscleName(name) || {}).id === groupId) ? "informed" : null;
  }

  function roleRank(role) {
    const index = ROLE_ORDER.indexOf(role);
    return index === -1 ? ROLE_ORDER.length : index;
  }

  /*
    Exercícios ligados a um grupo. Não grava nada e não mexe em rotinas: lê o
    catálogo em memória. `options.mode` limita a uma modalidade.
  */
  function exercisesFor(groupId, options = {}) {
    const group = groupById(groupId);
    if (!group) return [];

    const mode = options.mode === "calisthenics" || options.mode === "weights" ? options.mode : null;
    const items = F.catalog.items(mode || undefined);

    return items
      .map(record => ({ record, role: roleFor(record, group.id) }))
      .filter(entry => entry.role !== null)
      .sort((a, b) => {
        const rank = roleRank(a.role) - roleRank(b.role);
        if (rank !== 0) return rank;
        return a.record.name.localeCompare(b.record.name, "pt-BR");
      });
  }

  function countByRole(entries) {
    const counts = { primary: 0, secondary: 0, stabilizer: 0, informed: 0 };
    entries.forEach(entry => { counts[entry.role] += 1; });
    return counts;
  }

  /* Rótulo curto de uma entrada, usando o papel que ela tem no grupo. */
  function roleLabel(role) {
    return ROLE_NAMES[role] || "";
  }

  F.atlas = {
    VIEWS,
    VIEW_SLUGS,
    MAP_DISCLOSURE,
    GROUPS,
    ROLE_NAMES,
    groupById,
    groupsForView,
    groupForMuscleName,
    roleFor,
    roleLabel,
    countByRole,
    exercisesFor,
    normalize
  };

  /* ------------------------------------------------------------------ */
  /* Página: explorar/atlas.html                                          */
  /* ------------------------------------------------------------------ */

  const SVG_NS = "http://www.w3.org/2000/svg";
  const FIGURE = Object.freeze({ width: 220, height: 420 });

  const page = {
    view: "front",
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

  function el(tag, className, text) {
    return F.ui.el(tag, className, text);
  }

  function svgEl(tag, attrs) {
    const node = doc.createElementNS(SVG_NS, tag);

    Object.keys(attrs || {}).forEach(key => {
      node.setAttribute(key, String(attrs[key]));
    });

    return node;
  }

  function svgText(attrs, text) {
    const node = svgEl("text", attrs);
    node.textContent = text;
    return node;
  }

  /* ---------- leitura do endereço (link direto) ---------- */

  function readInitialState() {
    let params = null;

    try {
      params = new URLSearchParams(global.location.search);
    } catch (error) {
      params = null;
    }

    if (!params) return;

    const view = params.get("vista");
    if (view === "anterior") page.view = "front";
    if (view === "posterior") page.view = "back";

    /* Grupo desconhecido no link: o mapa abre sem seleção, sem erro. */
    const group = groupById(params.get("grupo"));
    if (group) {
      page.view = group.view;
      page.groupId = group.id;
    }

    const mode = params.get("modalidade");
    if (mode === "calisthenics" || mode === "weights") page.mode = mode;
  }

  /* ---------- estado de foco ---------- */

  function focusKeyOf(node) {
    if (!node || !node.getAttribute) return null;

    const explicit = node.getAttribute("data-atlas-focus");
    if (explicit) return explicit;

    const viewSegment = node.closest ? node.closest("#atlas-view [data-value]") : null;
    if (viewSegment) return "view:" + viewSegment.getAttribute("data-value");

    const modeSegment = node.closest ? node.closest("#atlas-modes [data-value]") : null;
    if (modeSegment) return "mode:" + modeSegment.getAttribute("data-value");

    return null;
  }

  function snapshotFocus() {
    const active = doc.activeElement;
    if (!active || !host || !host.contains(active)) return null;
    return focusKeyOf(active);
  }

  function restoreFocus(key) {
    if (!key || !host) return;

    let node = null;

    if (key === "first-region") {
      node = host.querySelector(".atlas-region");
    } else if (key.indexOf("view:") === 0) {
      node = host.querySelector('#atlas-view [data-value="' + key.slice(5) + '"]');
    } else if (key.indexOf("mode:") === 0) {
      node = host.querySelector('#atlas-modes [data-value="' + key.slice(5) + '"]');
    } else {
      node = host.querySelector('[data-atlas-focus="' + key.replace(/"/g, '\\"') + '"]');
    }

    if (node && typeof node.focus === "function") node.focus();
  }

  /* ---------- dados derivados ---------- */

  function selectedGroup() {
    return groupById(page.groupId);
  }

  function entriesForSelection() {
    const group = selectedGroup();
    if (!group) return [];
    return F.atlas.exercisesFor(group.id, { mode: page.mode });
  }

  function allEntriesForSelection() {
    const group = selectedGroup();
    if (!group) return [];
    return F.atlas.exercisesFor(group.id);
  }

  function countForGroup(group, mode) {
    return F.atlas.exercisesFor(group.id, { mode: mode || undefined }).length;
  }

  function roleCountLabel(entries) {
    const counts = F.atlas.countByRole(entries);
    const parts = [];

    if (counts.primary) parts.push(counts.primary + (counts.primary === 1 ? " principal" : " principais"));
    if (counts.secondary) parts.push(counts.secondary + (counts.secondary === 1 ? " secundário" : " secundários"));
    if (counts.stabilizer) parts.push(counts.stabilizer + (counts.stabilizer === 1 ? " estabilizador" : " estabilizadores"));
    if (counts.informed) parts.push(counts.informed + " informado" + (counts.informed === 1 ? "" : "s") + " por você");

    return parts.join(" · ");
  }

  function modeLabel(mode) {
    return mode ? F.MODE_NAMES[mode] : "todas as modalidades";
  }

  /* ---------- desenho do mapa ---------- */

  function figureNode(view) {
    const group = svgEl("g", { class: "atlas-figure", "aria-hidden": "true" });

    /* Manequim geométrico: cabeça, pescoço, tronco, pelve, braços, mãos, pernas e pés. */
    group.appendChild(svgEl("circle", { cx: 110, cy: 40, r: 20, class: "atlas-figure-shape" }));
    group.appendChild(svgEl("rect", { x: 101, y: 57, width: 18, height: 14, rx: 6, class: "atlas-figure-shape" }));
    group.appendChild(svgEl("path", {
      d: "M84 76 Q110 68 136 76 L141 116 Q142 150 130 176 L127 194 Q110 200 93 194 L90 176 Q78 150 79 116 Z",
      class: "atlas-figure-shape"
    }));
    group.appendChild(svgEl("rect", { x: 87, y: 190, width: 46, height: 26, rx: 12, class: "atlas-figure-shape" }));

    /* Braços: um retângulo por braço, do ombro até o punho. */
    group.appendChild(svgEl("rect", { x: 58, y: 78, width: 20, height: 130, rx: 10, class: "atlas-figure-shape" }));
    group.appendChild(svgEl("rect", { x: 142, y: 78, width: 20, height: 130, rx: 10, class: "atlas-figure-shape" }));
    group.appendChild(svgEl("circle", { cx: 68, cy: 216, r: 8, class: "atlas-figure-shape" }));
    group.appendChild(svgEl("circle", { cx: 152, cy: 216, r: 8, class: "atlas-figure-shape" }));

    /* Pernas e pés. */
    group.appendChild(svgEl("rect", { x: 88, y: 206, width: 20, height: 166, rx: 10, class: "atlas-figure-shape" }));
    group.appendChild(svgEl("rect", { x: 112, y: 206, width: 20, height: 166, rx: 10, class: "atlas-figure-shape" }));
    group.appendChild(svgEl("rect", { x: 85, y: 366, width: 25, height: 14, rx: 6, class: "atlas-figure-shape" }));
    group.appendChild(svgEl("rect", { x: 110, y: 366, width: 25, height: 14, rx: 6, class: "atlas-figure-shape" }));

    if (view === "back") {
      group.appendChild(svgEl("path", {
        d: "M110 84 V184",
        class: "atlas-figure-guide"
      }));
    }

    return group;
  }

  function regionNode(group) {
    const total = countForGroup(group);
    const selected = page.groupId === group.id;

    const node = svgEl("g", {
      class: "atlas-region" + (selected ? " is-selected" : ""),
      role: "button",
      tabindex: "0",
      "aria-pressed": selected ? "true" : "false",
      "aria-label": group.number + ". " + group.label + " — " +
        (total === 0 ? "sem exercícios no catálogo atual" : total + (total === 1 ? " exercício relacionado" : " exercícios relacionados")) +
        " (" + VIEWS[group.view] + ")",
      "data-group": group.id,
      "data-atlas-focus": "group:" + group.id
    });

    node.appendChild(svgEl("circle", {
      class: "atlas-region-hit",
      cx: group.x, cy: group.y, r: group.r + 6
    }));
    node.appendChild(svgEl("circle", {
      class: "atlas-region-shape",
      cx: group.x, cy: group.y, r: group.r
    }));
    node.appendChild(svgEl("circle", {
      class: "atlas-region-ring",
      cx: group.x, cy: group.y, r: group.r + 5
    }));
    node.appendChild(svgText({
      class: "atlas-region-number",
      x: group.x,
      y: group.y,
      "text-anchor": "middle",
      "dominant-baseline": "central"
    }, String(group.number)));

    node.addEventListener("click", () => selectGroup(group.id));
    node.addEventListener("keydown", event => keyboardOnRegion(event, group, node));

    return node;
  }

  function keyboardOnRegion(event, group, node) {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      selectGroup(group.id);
      return;
    }

    const siblings = groupsForView(page.view);
    const index = siblings.indexOf(group);
    let next = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = siblings[(index + 1) % siblings.length];
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = siblings[(index - 1 + siblings.length) % siblings.length];
    else if (event.key === "Home") next = siblings[0];
    else if (event.key === "End") next = siblings[siblings.length - 1];

    if (!next) return;

    event.preventDefault();
    const target = node.parentNode && node.parentNode.querySelector
      ? node.parentNode.querySelector('.atlas-region[data-group="' + next.id + '"]')
      : null;

    if (target && typeof target.focus === "function") target.focus();
  }

  function mapNode() {
    const list = groupsForView(page.view);
    const numbers = list.map(group => group.number).join(", ");

    const svg = svgEl("svg", {
      class: "atlas-map-svg",
      viewBox: "0 0 " + FIGURE.width + " " + FIGURE.height,
      role: "group",
      "aria-label": "Mapa esquemático do corpo humano, " + VIEWS[page.view].toLowerCase() +
        ". Regiões numeradas: " + numbers + "."
    });

    svg.appendChild(figureNode(page.view));
    list.forEach(group => svg.appendChild(regionNode(group)));

    return svg;
  }

  /* ---------- blocos de interface ---------- */

  function disclosureNode() {
    const box = el("p", "atlas-disclosure");
    box.appendChild(F.ui.icon("info"));
    box.appendChild(el("span", null, MAP_DISCLOSURE));
    return box;
  }

  function viewControl() {
    const wrap = el("div", "atlas-view-control");
    wrap.id = "atlas-view";
    wrap.appendChild(F.ui.segmented({
      label: "Vista do mapa",
      value: page.view,
      options: [
        { value: "front", label: VIEWS.front },
        { value: "back", label: VIEWS.back }
      ],
      onChange(value) {
        if (page.view === value) return;
        setView(value);
      }
    }));
    return wrap;
  }

  function legendNode() {
    const card = el("section", "atlas-card atlas-legend");
    card.setAttribute("aria-labelledby", "atlas-legend-title");

    const head = el("div", "atlas-card-head");
    head.appendChild(el("h2", "atlas-card-title", "Legenda · " + VIEWS[page.view].toLowerCase()));
    head.appendChild(el("p", "atlas-card-note", "Os números correspondem aos marcadores do mapa."));
    card.appendChild(head);

    const list = el("ul", "atlas-legend-list");

    groupsForView(page.view).forEach(group => {
      const item = el("li", "atlas-legend-item");
      const selected = page.groupId === group.id;
      const total = countForGroup(group);

      if (selected) item.className += " is-selected";

      const button = el("button", "atlas-legend-button");
      button.type = "button";
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.setAttribute("data-group", group.id);
      button.setAttribute("data-atlas-focus", "group:" + group.id);
      button.setAttribute("aria-label",
        "Região " + group.number + ": " + group.label + ". " +
        (total === 0 ? "Sem exercícios no catálogo atual." : total + (total === 1 ? " exercício relacionado." : " exercícios relacionados.")));

      button.appendChild(el("span", "atlas-legend-number", group.number));
      button.appendChild(el("span", "atlas-legend-name", group.label));

      const meta = el("span", "atlas-legend-meta");
      meta.appendChild(el("span", "atlas-legend-kind", group.kind === "region" ? "Região" : "Grupo"));
      meta.appendChild(el("span", "atlas-legend-count", total === 0 ? "sem exercícios" : String(total)));
      if (selected) meta.appendChild(el("span", "atlas-legend-check", "selecionado"));
      button.appendChild(meta);

      button.addEventListener("click", () => selectGroup(group.id));
      item.appendChild(button);
      list.appendChild(item);
    });

    card.appendChild(list);
    return card;
  }

  function selectionCard() {
    const card = el("section", "atlas-card atlas-selection");
    card.setAttribute("aria-labelledby", "atlas-selection-title");

    const group = selectedGroup();

    if (!group) {
      const emptyTitle = el("h2", "atlas-card-title", "Nenhuma região selecionada");
      emptyTitle.id = "atlas-selection-title";
      card.appendChild(emptyTitle);

      const empty = F.ui.empty({
        icon: "target",
        title: "Escolha um grupo para ver os exercícios",
        text: "Use os números do mapa ou a legenda abaixo. Selecionar uma região não altera nenhuma rotina: o atlas é só consulta."
      });
      card.appendChild(empty);
      return card;
    }

    const entries = allEntriesForSelection();
    const total = entries.length;
    const filtered = entriesForSelection();

    const head = el("div", "atlas-selection-head");
    head.appendChild(F.ui.chip("Região " + group.number, "accent"));
    head.appendChild(F.ui.chip(group.kind === "region" ? "Região ampla" : "Grupo muscular", "muted"));
    card.appendChild(head);

    const title = el("h2", "atlas-card-title", group.label);
    title.id = "atlas-selection-title";
    card.appendChild(title);

    card.appendChild(el("p", "atlas-selection-where", group.where));

    const summary = el("p", "atlas-selection-summary");
    summary.id = "atlas-selection-summary";
    summary.textContent = total === 0
      ? "Nenhum exercício do catálogo atual está classificado para esta região."
      : total + (total === 1 ? " exercício relacionado" : " exercícios relacionados") +
        (roleCountLabel(entries) ? " — " + roleCountLabel(entries) : "") + ".";
    card.appendChild(summary);

    if (page.mode) {
      const note = el("p", "atlas-selection-filter-note",
        "Filtro ativo: " + modeLabel(page.mode) + ". " +
        (filtered.length === 0
          ? "Nenhum exercício desta modalidade para a região."
          : filtered.length + (filtered.length === 1 ? " exercício nesta modalidade." : " exercícios nesta modalidade.")));
      card.appendChild(note);
    }

    return card;
  }

  function exerciseLink(record) {
    return F.ui.linkButton({
      label: "Detalhes na biblioteca",
      href: F.url("biblioteca", { exercicio: record.libraryId, modalidade: record.mode }),
      variant: "secondary-button",
      className: "small-button",
      icon: "book",
      ariaLabel: "Abrir " + record.name + " na biblioteca"
    });
  }

  function exerciseRow(entry) {
    const record = entry.record;
    const row = el("div", "ui-exercise-row atlas-exercise-row");
    const main = el("div", "ui-exercise-main");

    main.appendChild(el("h3", "ui-exercise-name", record.name));

    const tags = el("div", "ui-exercise-tags");
    tags.appendChild(F.ui.chip(F.MODE_NAMES[record.mode] || record.mode, record.mode === "weights" ? "accent" : "muted"));
    tags.appendChild(F.ui.chip(F.atlas.roleLabel(entry.role), entry.role === "primary" ? "accent" : "muted"));
    if (record.category) tags.appendChild(F.ui.chip(F.catalog.categoryLabel(record.category), "muted"));
    main.appendChild(tags);

    const meta = el("p", "ui-exercise-meta");
    meta.textContent = [
      F.SECTION_NAMES[record.section] || "",
      F.catalog.summary(record)
    ].filter(Boolean).join(" · ");
    main.appendChild(meta);

    row.appendChild(main);
    row.appendChild(exerciseLink(record));
    return row;
  }

  function exercisesCard() {
    const card = el("section", "atlas-card atlas-exercises");
    card.setAttribute("aria-labelledby", "atlas-exercises-title");

    const head = el("div", "atlas-card-head");
    const title = el("h2", "atlas-card-title", "Exercícios relacionados");
    title.id = "atlas-exercises-title";
    head.appendChild(title);
    card.appendChild(head);

    const group = selectedGroup();

    if (!group) {
      card.appendChild(el("p", "atlas-card-note",
        "A lista aparece depois que você escolhe uma região. Nada aqui altera seus dados."));
      return card;
    }

    const everyEntry = allEntriesForSelection();
    const counts = {
      all: everyEntry.length,
      calisthenics: everyEntry.filter(entry => entry.record.mode === "calisthenics").length,
      weights: everyEntry.filter(entry => entry.record.mode === "weights").length
    };

    const modeWrap = el("div", "atlas-mode-control");
    modeWrap.id = "atlas-modes";
    modeWrap.appendChild(F.ui.segmented({
      label: "Filtrar exercícios por modalidade",
      value: page.mode,
      options: [
        { value: null, label: "Todas", count: counts.all },
        { value: "calisthenics", label: F.MODE_NAMES.calisthenics, count: counts.calisthenics },
        { value: "weights", label: F.MODE_NAMES.weights, count: counts.weights }
      ],
      onChange(value) {
        setMode(value);
      }
    }));
    card.appendChild(modeWrap);

    const entries = entriesForSelection();
    const status = el("p", "atlas-exercises-status");
    status.id = "atlas-exercises-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = entries.length === 0
      ? (page.mode
        ? "Nenhum exercício de " + modeLabel(page.mode).toLowerCase() + " para esta região"
        : "Nenhum exercício no catálogo atual para esta região")
      : entries.length + (entries.length === 1 ? " exercício" : " exercícios") +
        " · " + (page.mode ? modeLabel(page.mode) : "todas as modalidades") +
        " · " + group.label;
    card.appendChild(status);

    const list = el("div", "atlas-exercise-list");

    if (entries.length === 0) {
      const hasAny = counts.all > 0;

      list.appendChild(F.ui.empty({
        icon: "search",
        title: hasAny ? "Nenhum exercício desta modalidade" : "Nenhum exercício para esta região",
        text: hasAny
          ? "O catálogo tem exercícios para esta região em outra modalidade. Limpe o filtro para vê-los."
          : "O catálogo atual não tem exercícios classificados para esta região — e o atlas não inventa vínculos. Exercícios personalizados só aparecem aqui se você tiver informado grupos musculares neles.",
        actions: hasAny
          ? [{ label: "Mostrar todas as modalidades", variant: "primary-button", icon: "filter", onClick: () => setMode(null) }]
          : [{
            label: "Abrir biblioteca",
            href: F.url("biblioteca"),
            variant: "secondary-button",
            icon: "book"
          }]
      }));
    } else {
      entries.forEach(entry => list.appendChild(exerciseRow(entry)));
    }

    card.appendChild(list);

    const note = el("p", "atlas-card-note atlas-exercises-note");
    note.textContent = "Abrir um exercício na biblioteca não adiciona nada a uma rotina. " +
      "O papel indicado (principal, secundário, estabilizador) descreve a participação do grupo no movimento.";
    card.appendChild(note);

    return card;
  }

  function mapCard() {
    const card = el("section", "atlas-card atlas-map-card");
    card.setAttribute("aria-labelledby", "atlas-map-title");

    const head = el("div", "atlas-card-head atlas-map-head");
    const heading = el("h2", "atlas-card-title", "Mapa muscular");
    heading.id = "atlas-map-title";
    head.appendChild(heading);

    const reset = el("button", "atlas-inline-reset");
    reset.type = "button";
    reset.textContent = "Limpar seleção";
    reset.setAttribute("data-atlas-focus", "clear");
    reset.disabled = !page.groupId;
    reset.addEventListener("click", clearSelection);
    head.appendChild(reset);

    card.appendChild(head);
    card.appendChild(viewControl());

    const caption = el("p", "atlas-map-caption");
    caption.textContent = "Mapa esquemático · " + VIEWS[page.view] + " · " +
      groupsForView(page.view).length + " regiões numeradas";
    card.appendChild(caption);

    const mapWrap = el("div", "atlas-map-wrap");
    mapWrap.id = "atlas-map";
    mapWrap.appendChild(mapNode());
    card.appendChild(mapWrap);

    card.appendChild(el("p", "atlas-map-hint",
      "Toque em um número para selecionar a região. No teclado, use Tab e as setas entre as regiões."));

    return card;
  }

  /* ---------- ações ---------- */

  function announceSelection() {
    const group = selectedGroup();
    if (!group) {
      F.ui.announce("Seleção limpa. Nenhuma região selecionada.");
      return;
    }

    const total = countForGroup(group);
    F.ui.announce(group.label + " selecionado. " +
      (total === 0 ? "Nenhum exercício do catálogo atual para esta região." : total + (total === 1 ? " exercício relacionado." : " exercícios relacionados.")));
  }

  function selectGroup(id) {
    const group = groupById(id);
    if (!group) return;

    page.groupId = group.id;
    page.view = group.view;
    pendingFocus = "group:" + group.id;
    render();
    announceSelection();
  }

  function clearSelection() {
    if (!page.groupId) return;
    page.groupId = null;
    pendingFocus = "first-region";
    render();
    announceSelection();
  }

  function setView(view) {
    const next = view === "back" ? "back" : "front";
    if (page.view === next) return;

    page.view = next;

    const current = selectedGroup();
    const keepsSelection = Boolean(current && current.view === next);
    if (!keepsSelection) page.groupId = null;

    pendingFocus = "view:" + next;
    render();
    F.ui.announce(VIEWS[next] + ". " +
      groupsForView(next).length + " regiões numeradas." +
      (keepsSelection ? " " + current.label + " continua selecionado." : ""));
  }

  function setMode(mode) {
    const next = mode === "calisthenics" || mode === "weights" ? mode : null;
    page.mode = next;
    pendingFocus = "mode:" + (next || "null");
    render();

    const entries = entriesForSelection();
    F.ui.announce((next ? "Filtro: " + F.MODE_NAMES[next] + ". " : "Todas as modalidades. ") +
      (entries.length === 0 ? "Nenhum exercício." : entries.length + (entries.length === 1 ? " exercício." : " exercícios.")));
  }

  /* ---------- montagem e estados ---------- */

  function render() {
    if (!host) return;

    lastError = null;

    const focus = pendingFocus || snapshotFocus();
    pendingFocus = null;
    clear(host);
    host.removeAttribute("aria-busy");

    const layout = el("div", "atlas-layout");

    const primary = el("div", "atlas-column atlas-column-map");
    primary.appendChild(mapCard());
    primary.appendChild(disclosureNode());

    const secondary = el("div", "atlas-column atlas-column-info");
    secondary.appendChild(selectionCard());
    secondary.appendChild(legendNode());
    secondary.appendChild(exercisesCard());

    layout.appendChild(primary);
    layout.appendChild(secondary);
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
        pendingFocus = "first-region";
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

  /* Reescreve a tela com o estado atual (usado por testes e por retentativa). */
  F.pages.atlas.refresh = function refresh() {
    try {
      render();
    } catch (error) {
      renderError(error);
    }
  };

  F.pages.atlas.renderError = renderError;

  /* Leitura do estado atual, sem efeito colateral. */
  F.pages.atlas.state = function state() {
    return { view: page.view, groupId: page.groupId, mode: page.mode, error: lastError };
  };
})(window);
