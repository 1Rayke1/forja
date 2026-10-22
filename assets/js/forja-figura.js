/*
  FORJA — figura humana (vistas anterior e posterior).

  Base visual: Open Muscle Map (MIT, origem declarada em IA — ver
  assets/anatomia/NOTICE.md). Os caminhos vêm de `forja-figura-dados.js`, gerado
  por tools/gerar-figura-dados.mjs a partir de assets/anatomia/male-muscle-map.svg.
  Nada aqui é redesenhado.

  Este módulo não conhece catálogo nem exercícios. Ele recebe `região → papel`
  (ver forja-atlas.js) e aplica o destaque aos painéis musculares que pertencem
  a cada região. Os IDs de região do FORJA são os mesmos de antes.

  O que é um esquema de regiões, não uma ilustração clínica: cada painel é uma
  área do desenho e não um músculo isolado. Ver docs/atlas-anatomico.md.
*/
(function (global) {
  "use strict";

  const doc = global.document;
  const F = global.Forja = global.Forja || {};
  const NS = "http://www.w3.org/2000/svg";

  /*
    O viewBox de cada vista é calculado a partir dos limites reais do corpo
    (gerados em forja-figura-dados.js), com uma margem pequena. Assim o desenho
    não é cortado nem fica deslocado dentro do cartão.
  */
  const PAD = 14;
  const VIEW_BOXES = {};
  function viewBoxFor(view) {
    if (VIEW_BOXES[view]) return VIEW_BOXES[view];
    const b = dados().bounds[view];
    const x = b.minX - PAD;
    const y = b.minY - PAD;
    VIEW_BOXES[view] = [x, y, (b.maxX - b.minX) + PAD * 2, (b.maxY - b.minY) + PAD * 2].map(v => Math.round(v * 10) / 10).join(" ");
    return VIEW_BOXES[view];
  }

  const VIEWS = Object.freeze({
    front: "Vista anterior",
    back: "Vista posterior"
  });

  /*
    Região do FORJA → músculos do Open Muscle Map (muscleId). A lista é
    deliberadamente conservadora: se um músculo não tem correspondência clara,
    fica fora. Não há tentativa de precisão além do que o catálogo afirma.
  */
  const REGIONS = {
    ombros: {
      label: "Ombros",
      muscles: ["anterior_deltoid", "lateral_deltoid", "posterior_deltoid"]
    },
    peito: {
      label: "Peitoral",
      muscles: ["pectoralis_major"]
    },
    biceps: {
      label: "Bíceps",
      muscles: ["biceps_brachii", "brachialis"]
    },
    triceps: {
      label: "Tríceps",
      muscles: ["triceps_brachii"]
    },
    antebracos: {
      label: "Antebraços",
      muscles: ["forearm_flexors", "forearm_extensors"]
    },
    abdomem: {
      label: "Abdômen",
      muscles: ["rectus_abdominis"]
    },
    obliquos: {
      label: "Oblíquos",
      muscles: ["external_oblique"]
    },
    quadril: {
      label: "Quadril",
      muscles: ["iliopsoas", "tensor_fasciae_latae", "sartorius"]
    },
    quadriceps: {
      label: "Quadríceps",
      muscles: ["rectus_femoris", "vastus_lateralis", "vastus_medialis"]
    },
    pernas: {
      label: "Pernas",
      muscles: [
        "rectus_femoris", "vastus_lateralis", "vastus_medialis", "sartorius",
        "hip_adductors", "biceps_femoris", "medial_hamstrings",
        "gastrocnemius", "soleus", "tibialis_anterior", "fibularis_group"
      ]
    },
    costas: {
      label: "Costas",
      muscles: ["trapezius", "posterior_rotator_cuff"]
    },
    dorsais: {
      label: "Dorsais",
      muscles: ["latissimus_dorsi"]
    },
    lombar: {
      label: "Lombar",
      muscles: ["erector_spinae"]
    },
    gluteos: {
      label: "Glúteos",
      muscles: ["gluteus_maximus", "gluteus_medius"]
    },
    "posterior-coxa": {
      label: "Posterior de coxa",
      muscles: ["biceps_femoris", "medial_hamstrings"]
    },
    panturrilha: {
      label: "Panturrilha",
      muscles: ["gastrocnemius", "soleus"]
    }
  };

  const ROLE_NAMES = Object.freeze({
    primary: "principal",
    secondary: "secundária",
    stabilizer: "estabilizadora",
    focus: "região em foco"
  });

  const ROLE_RANK = { stabilizer: 0, secondary: 1, primary: 2, focus: 3 };

  function dados() {
    const data = global.Forja && global.Forja.figuraDados;
    if (!data) throw new Error("forja-figura-dados.js não carregado");
    return data;
  }

  function panelsOf(view) {
    return dados().panels.filter(panel => panel.view === view);
  }

  function regionPanels(regionId, view) {
    const region = REGIONS[regionId];
    if (!region) return [];
    return panelsOf(view).filter(panel => region.muscles.indexOf(panel.muscle) !== -1);
  }

  /* `shapesFor` mantém o nome da API anterior: devolve os painéis da região na vista ou null. */
  function shapesFor(regionId, view) {
    const panels = regionPanels(regionId, view === "back" ? "back" : "front");
    return panels.length ? panels : null;
  }

  function regionsInView(view) {
    const current = view === "back" ? "back" : "front";
    return Object.keys(REGIONS).filter(id => Boolean(shapesFor(id, current)));
  }

  function svg(tag, attrs) {
    const node = doc.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(key => node.setAttribute(key, String(attrs[key])));
    return node;
  }

  /*
    Papel de cada painel: o maior papel entre as regiões destacadas que contêm
    o músculo do painel. Assim "Pernas" (região geral) não rebaixa o quadríceps
    principal para secundário.
  */
  function panelRoles(view, highlights) {
    const result = new Map();
    panelsOf(view).forEach(panel => {
      let best = null;
      Object.keys(highlights).forEach(regionId => {
        const role = highlights[regionId];
        const region = REGIONS[regionId];
        if (!region || !ROLE_RANK.hasOwnProperty(role)) return;
        if (region.muscles.indexOf(panel.muscle) === -1) return;
        if (!best || ROLE_RANK[role] > ROLE_RANK[best.role]) best = { regionId, role };
      });
      if (best) result.set(panel, best);
    });
    return result;
  }

  /*
    Monta a figura.

    options:
      view        "front" | "back"
      highlights  { regiãoId: "primary" | "secondary" | "stabilizer" | "focus" }
      interactive quando true, as regiões destacadas recebem foco e clique
      onSelect    (regiãoId) => void, usado com `interactive`
      selected    região marcada como pressionada (leitura por teclado)
      label       texto alternativo; ausente → gerado a partir do destaque
      compact     reduz o tamanho visual (execução do treino)
  */
  function render(options) {
    const settings = Object.assign({ view: "front", highlights: {}, interactive: false }, options || {});
    const view = settings.view === "back" ? "back" : "front";
    const highlights = settings.highlights || {};
    const data = dados();

    const wrapper = doc.createElement("div");
    wrapper.className = "figura figura-" + view + (settings.compact ? " is-compact" : "");

    const root = svg("svg", {
      viewBox: viewBoxFor(view),
      class: "figura-svg",
      role: settings.interactive ? "group" : "img",
      "aria-label": settings.label || describe(highlights, view),
      focusable: "false"
    });

    /* Silhueta de referência: contorno neutro atrás de todos os painéis. */
    const body = svg("g", { class: "figura-body", "aria-hidden": "true" });
    data.silhouettes.filter(item => item.view === view).forEach(item => {
      item.paths.forEach(part => body.appendChild(svg("path", {
        class: "figura-part", d: part.d, transform: part.t
      })));
    });
    root.appendChild(body);

    const roles = panelRoles(view, highlights);
    const muscles = svg("g", { class: "figura-muscles" });

    /* Neutros primeiro; destacados por cima, do menos ao mais importante. */
    const neutral = panelsOf(view).filter(panel => !roles.has(panel));
    const highlighted = Array.from(roles.keys()).sort(
      (a, b) => ROLE_RANK[roles.get(a).role] - ROLE_RANK[roles.get(b).role]
    );

    function paint(panel, assigned) {
      const isRegion = Boolean(assigned);
      const role = isRegion ? assigned.role : null;
      const regionId = isRegion ? assigned.regionId : null;
      const focused = isRegion && settings.selected === regionId;

      const group = svg("g", {
        class: isRegion ? "figura-region is-" + role : "figura-muscle",
        "data-muscle": panel.muscle,
        "data-side": panel.side || "",
        "data-view": view
      });

      if (isRegion) {
        group.setAttribute("data-region", regionId);
        group.setAttribute("data-role", role);
      }

      if (isRegion && settings.interactive) {
        const label = REGIONS[regionId].label;
        group.setAttribute("role", "button");
        group.setAttribute("tabindex", "0");
        group.setAttribute("aria-pressed", focused ? "true" : "false");
        group.setAttribute("aria-label",
          label + ", " + ROLE_NAMES[role] + (focused ? ", selecionada" : "") + ". " + VIEWS[view] + ".");
        group.setAttribute("data-figura-focus", regionId);

        const activate = () => {
          if (typeof settings.onSelect === "function") settings.onSelect(regionId);
        };
        group.addEventListener("click", activate);
        group.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
            event.preventDefault();
            activate();
          }
        });
      }

      panel.paths.forEach(part => group.appendChild(svg("path", {
        class: "figura-muscle-shape", d: part.d, transform: part.t
      })));
      muscles.appendChild(group);
    }

    neutral.forEach(panel => paint(panel, null));
    highlighted.forEach(panel => paint(panel, roles.get(panel)));

    root.appendChild(muscles);
    wrapper.appendChild(root);
    return wrapper;
  }

  /*
    Texto alternativo do destaque. Lista só as regiões que existem NA VISTA
    pedida e nunca depende só da cor.
  */
  function describe(highlights, view) {
    const levels = { primary: [], secondary: [], stabilizer: [], focus: [] };
    const current = view === "back" ? "back" : "front";

    Object.keys(highlights || {}).forEach(regionId => {
      const role = highlights[regionId];
      if (!levels[role]) return;
      if (!shapesFor(regionId, current)) return;
      levels[role].push((REGIONS[regionId] || {}).label || regionId);
    });

    const parts = [];

    if (levels.primary.length) parts.push("principal: " + levels.primary.join(", "));
    if (levels.secondary.length) parts.push("secundária: " + levels.secondary.join(", "));
    if (levels.stabilizer.length) parts.push("estabilizadora: " + levels.stabilizer.join(", "));
    if (levels.focus.length) parts.push("em foco: " + levels.focus.join(", "));

    const viewLabel = current === "back" ? "Silhueta humana, vista posterior" : "Silhueta humana, vista anterior";

    return parts.length ? viewLabel + ". " + parts.join(". ") + "." : viewLabel + ", nenhuma região destacada.";
  }

  F.figura = {
    VIEWS,
    viewBoxFor,
    ROLE_NAMES,
    REGIONS,
    render,
    describe,
    regionsInView,
    shapesFor
  };
})(window);
