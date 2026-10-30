/*
  FORJA — modelo anatômico muscular (vistas anterior e posterior).

  A anatomia exibida é a prancha fornecida pelo usuário, sem redesenho:
  um único arquivo (`assets/anatomia/fontes/referencia-muscular.png`) contém as
  duas vistas, no mesmo desenho, fundo preto e linhas brancas. Cada figura é
  apenas uma janela (`crop`) desse arquivo, e as duas janelas têm o mesmo
  tamanho — por isso anterior e posterior aparecem sempre na mesma escala e
  alinhadas.

  Este módulo não cria corpo, silhueta de boneco nem músculo desenhado. O que
  ele contém são projeções funcionais das regiões do catálogo, traçadas sobre
  as áreas que o próprio desenho delimita. A tinta dos destaques é recortada
  pela silhueta derivada da prancha (`mascara.png`), então nenhum destaque
  pode aparecer no fundo preto fora do corpo.

  As formas são projeções superficiais aproximadas. Não são segmentação
  clínica e não afirmam isolar músculos profundos: quando o desenho não separa
  uma estrutura, a região representa o agrupamento visível, como está
  documentado em `docs/modelo-anatomico.md`.
*/
(function (global) {
  "use strict";

  const doc = global.document;
  const F = global.Forja = global.Forja || {};
  const NS = "http://www.w3.org/2000/svg";

  /* Janela de desenho — igual nas duas vistas para preservar escala e
     alinhamento. Coordenadas das regiões neste mesmo espaço. */
  const VIEWBOX = Object.freeze({ width: 600, height: 1024 });

  /* Arquivo único de referência: 1536 × 1024 com as duas vistas. */
  const REFERENCE = Object.freeze({
    src: "assets/anatomia/fontes/referencia-muscular.png",
    width: 1536,
    height: 1024
  });
  /* Derivados da prancha por `tools/gerar-anatomia-referencia.mjs`:
     - MASK  limita qualquer traço à silhueta do corpo;
     - INK   limita o preenchimento às áreas escuras do desenho, para a cor
             aparecer nas fissuras sem cobrir as linhas brancas. */
  const MASK = "assets/anatomia/mascara.png";
  const INK = "assets/anatomia/tinta.png";

  /* `crop.x` seleciona a vista dentro do arquivo único. O `y` é zero nas duas
     para que os corpos fiquem na mesma linha de base. */
  const CROPS = Object.freeze({
    front: Object.freeze({ x: 110, y: 0, width: VIEWBOX.width, height: VIEWBOX.height }),
    back: Object.freeze({ x: 770, y: 0, width: VIEWBOX.width, height: VIEWBOX.height })
  });

  /* Eixo de simetria de cada desenho (medido nos limites do corpo). Só é usado
     para espelhar a metade autoral de uma região — não desenha anatomia. */
  const AXES = Object.freeze({ front: 301, back: 298 });

  const VIEWS = Object.freeze({ front: "Vista anterior", back: "Vista posterior" });
  const ROLE_NAMES = Object.freeze({
    primary: "principal",
    secondary: "secundária",
    stabilizer: "estabilizadora",
    informed: "informada por você",
    focus: "região em foco"
  });

  let maskCounter = 0;

  function detectAssetPrefix() {
    if (!doc) return "../";
    const scripts = doc.getElementsByTagName ? doc.getElementsByTagName("script") : [];
    for (let i = 0; i < scripts.length; i += 1) {
      const src = (scripts[i].getAttribute && scripts[i].getAttribute("src")) || "";
      const index = src.indexOf("assets/js/forja-figura.js");
      if (index !== -1) return src.slice(0, index);
    }
    return "../";
  }

  const ASSET_PREFIX = detectAssetPrefix();

  /* ------------------------------------------------------------------ */
  /* Geometria das regiões                                              */
  /* ------------------------------------------------------------------ */

  function round(value) {
    return Math.round(value * 10) / 10;
  }

  function formatPoint(point) {
    return round(point[0]) + " " + round(point[1]);
  }

  /*
    Polígono fechado com cantos arredondados: liga os pontos médios das arestas
    por curvas quadráticas que usam o vértice como controle. A curva fica
    dentro do polígono autoral, então nenhuma região ganha área além do que foi
    traçado.
  */
  function polygonPath(points) {
    const total = points.length;
    const middle = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let path = "M" + formatPoint(middle(points[total - 1], points[0]));
    for (let i = 0; i < total; i += 1) {
      const current = points[i];
      const next = points[(i + 1) % total];
      path += "Q" + formatPoint(current) + " " + formatPoint(middle(current, next));
    }
    return path + "Z";
  }

  function mirror(points, axis) {
    return points.map(point => [round(axis * 2 - point[0]), point[1]]);
  }

  /* Par espelhado: uma metade autoral vira as duas laterais. */
  function pair(view, points) {
    return [points, mirror(points, AXES[view])];
  }

  function toPaths(groups) {
    return groups.map(polygonPath);
  }

  /* ------------------------------------------------------------------ */
  /* Regiões do catálogo sobre o desenho                                */
  /* ------------------------------------------------------------------ */

  /*
    Cada entrada descreve onde a região aparece e o que ela representa de fato
    nesta ilustração. `groups` são os polígonos autorais (coordenadas da
    VIEWBOX); `front`/`back` são preenchidos abaixo já como caminhos SVG.
  */
  const SHAPES = {
    ombros: {
      label: "Ombros",
      note: "Deltoide visível, do acrômio à inserção no braço; o trapézio fica na região Costas.",
      front: pair("front", [
        [176, 184], [200, 174], [209, 196], [211, 224], [205, 250],
        [191, 272], [165, 276], [146, 250], [141, 215]
      ]),
      back: pair("back", [
        [172, 184], [196, 174], [206, 196], [208, 224], [202, 250],
        [188, 272], [163, 276], [144, 250], [139, 215]
      ])
    },
    peito: {
      label: "Peitoral",
      note: "Porção visível do peitoral maior, do esterno à axila.",
      front: pair("front", [
        [299, 190], [268, 182], [238, 184], [214, 196], [199, 226],
        [194, 250], [226, 268], [258, 284], [292, 292], [299, 240]
      ]),
      back: []
    },
    biceps: {
      label: "Bíceps",
      note: "Ventre anterior do braço, do ombro à dobra do cotovelo.",
      front: pair("front", [
        [150, 278], [128, 300], [121, 340], [118, 362], [140, 368],
        [162, 352], [176, 320], [180, 292], [165, 276]
      ]),
      back: []
    },
    antebracos: {
      label: "Antebraços",
      note: "Massa muscular do antebraço; a mão e o punho não entram na região.",
      front: pair("front", [
        [152, 368], [120, 386], [98, 420], [84, 458], [74, 500],
        [110, 506], [124, 480], [142, 450], [160, 415], [172, 384], [166, 368]
      ]),
      back: pair("back", [
        [160, 376], [126, 392], [102, 428], [88, 470], [78, 506],
        [106, 514], [122, 486], [140, 452], [158, 420], [170, 392], [166, 380]
      ])
    },
    abdomem: {
      label: "Abdômen",
      note: "Reto abdominal visível, com a linha alba e as interseções do desenho.",
      front: [[
        [252, 298], [301, 292], [350, 298], [352, 392],
        [344, 446], [301, 506], [258, 446], [250, 392]
      ]],
      back: []
    },
    obliquos: {
      label: "Oblíquos",
      note: "Faixa lateral do tronco entre o reto abdominal e a borda do corpo.",
      front: pair("front", [
        [248, 300], [228, 318], [219, 350], [215, 392], [217, 425],
        [228, 452], [250, 462], [254, 430], [252, 370], [250, 330]
      ]),
      back: []
    },
    quadril: {
      label: "Quadril",
      note: "Projeção superficial da região inguinal e do quadril — não representa o iliopsoas.",
      front: pair("front", [
        [218, 448], [248, 458], [292, 498], [301, 516],
        [262, 506], [226, 466]
      ]),
      back: []
    },
    quadriceps: {
      label: "Quadríceps",
      note: "Massa anterior da coxa até acima da patela; a articulação do joelho fica neutra.",
      front: pair("front", [
        [216, 505], [198, 545], [190, 600], [196, 660], [207, 716],
        [212, 764], [248, 780], [281, 752], [288, 700], [289, 640],
        [285, 586], [277, 540], [298, 520]
      ]),
      back: []
    },
    pernas: {
      label: "Pernas",
      note: "Região geral: coxa e perna já visíveis na mesma vista, sem o pé e sem a patela.",
      front: pair("front", [
        [216, 505], [198, 545], [190, 600], [196, 660], [207, 716],
        [212, 764], [248, 780], [281, 752], [288, 700], [289, 640],
        [285, 586], [277, 540], [298, 520]
      ]).concat(pair("front", [
        [200, 800], [206, 848], [214, 900], [220, 932], [248, 932],
        [256, 890], [261, 845], [263, 805]
      ])),
      back: pair("back", [
        [196, 556], [240, 566], [288, 566], [293, 620], [285, 690],
        [270, 745], [250, 782], [216, 782], [195, 720], [188, 650], [190, 590]
      ]).concat(pair("back", [
        [198, 800], [240, 806], [262, 830], [258, 872], [246, 902],
        [220, 902], [205, 870], [196, 830]
      ]))
    },
    costas: {
      label: "Costas",
      note: "Trapézio e região escapular superior, agrupados como uma única região.",
      front: [],
      back: [[
        [298, 168], [246, 178], [200, 204], [187, 236], [203, 258],
        [246, 270], [298, 278], [350, 270], [393, 258], [409, 236],
        [396, 204], [350, 178]
      ]]
    },
    dorsais: {
      label: "Dorsais",
      note: "Grande dorsal e massa lateral do dorso até a crista ilíaca.",
      front: [],
      back: pair("back", [
        [290, 286], [252, 300], [226, 332], [217, 380], [214, 430],
        [220, 470], [250, 496], [282, 492], [293, 450], [295, 380], [293, 320]
      ])
    },
    lombar: {
      label: "Lombar",
      note: "Projeção superficial da região lombar; os eretores profundos não são isolados.",
      front: [],
      back: [[
        [266, 378], [298, 388], [330, 378], [334, 412], [298, 424], [262, 412]
      ]]
    },
    triceps: {
      label: "Tríceps",
      note: "Ventre posterior do braço, do ombro à dobra do cotovelo.",
      front: [],
      back: pair("back", [
        [150, 280], [126, 302], [118, 356], [128, 380], [152, 370],
        [170, 336], [180, 302], [165, 278]
      ])
    },
    gluteos: {
      label: "Glúteos",
      note: "Glúteo máximo visível, da crista ilíaca à dobra glútea.",
      front: [],
      back: pair("back", [
        [214, 426], [252, 421], [290, 430], [297, 470], [292, 512],
        [272, 542], [240, 554], [211, 540], [200, 504], [203, 462]
      ])
    },
    "posterior-coxa": {
      label: "Posterior de coxa",
      note: "Isquiotibiais até a fossa poplítea.",
      front: [],
      back: pair("back", [
        [196, 556], [240, 566], [288, 566], [293, 620], [285, 690],
        [270, 745], [250, 782], [216, 782], [195, 720], [188, 650], [190, 590]
      ])
    },
    panturrilha: {
      label: "Panturrilha",
      note: "Ventres do tríceps sural; o tendão calcâneo não é pintado como ventre.",
      front: [],
      back: pair("back", [
        [198, 800], [240, 806], [262, 830], [258, 872], [246, 902],
        [220, 902], [205, 870], [196, 830]
      ])
    }
  };

  const REGIONS = {};
  Object.keys(SHAPES).forEach(id => {
    const entry = SHAPES[id];
    REGIONS[id] = {
      label: entry.label,
      note: entry.note,
      front: toPaths(entry.front),
      back: toPaths(entry.back)
    };
  });

  function shapesFor(regionId, view) {
    const region = REGIONS[regionId];
    if (!region) return null;
    const current = view === "back" ? "back" : "front";
    const shapes = region[current];
    return shapes && shapes.length ? shapes : null;
  }

  function regionsInView(view) {
    return Object.keys(REGIONS).filter(id => Boolean(shapesFor(id, view)));
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  function svg(tag, attributes) {
    const node = doc.createElementNS(NS, tag);
    Object.keys(attributes || {}).forEach(key => node.setAttribute(key, String(attributes[key])));
    return node;
  }

  /* A prancha é uma janela do arquivo único. O deslocamento negativo de `x`
     recorta a vista sem gerar um segundo arquivo de imagem. */
  function plateImage(view, className) {
    const crop = CROPS[view];
    return svg("image", {
      class: className,
      href: ASSET_PREFIX + REFERENCE.src,
      x: -crop.x,
      y: -crop.y,
      width: REFERENCE.width,
      height: REFERENCE.height,
      preserveAspectRatio: "xMidYMid meet"
    });
  }

  function maskImage(view, className, href) {
    const crop = CROPS[view];
    return svg("image", {
      class: className,
      href: ASSET_PREFIX + href,
      x: -crop.x,
      y: -crop.y,
      width: REFERENCE.width,
      height: REFERENCE.height,
      preserveAspectRatio: "xMidYMid meet"
    });
  }

  /*
    options:
      view        "front" | "back"
      highlights  { regiãoId: papel }
      interactive adiciona teclado/clique às regiões
      onSelect    callback da região interativa
      selected    região pressionada
      label       texto alternativo
      compact     apresentação enxuta na execução
  */
  function render(options) {
    const settings = Object.assign({ view: "front", highlights: {}, interactive: false }, options || {});
    const view = settings.view === "back" ? "back" : "front";
    const highlights = settings.highlights || {};

    maskCounter += 1;
    const bodyMaskId = "figura-corpo-" + maskCounter;
    const inkMaskId = "figura-tinta-" + maskCounter;

    const wrapper = doc.createElement("div");
    wrapper.className = "figura figura-" + view + (settings.compact ? " is-compact" : "");

    const root = svg("svg", {
      viewBox: "0 0 " + VIEWBOX.width + " " + VIEWBOX.height,
      preserveAspectRatio: "xMidYMid meet",
      class: "figura-svg",
      "data-view": view,
      role: settings.interactive ? "group" : "img",
      "aria-label": settings.label || describe(highlights, view)
    });

    /* As máscaras não desenham um corpo: são derivadas da mesma prancha e só
       limitam a tinta dos destaques. */
    const defs = svg("defs", {});
    const bodyMask = svg("mask", {
      id: bodyMaskId,
      class: "figura-body-mask",
      maskUnits: "userSpaceOnUse",
      x: 0,
      y: 0,
      width: VIEWBOX.width,
      height: VIEWBOX.height,
      style: "mask-type:alpha"
    });
    const bodyPlate = maskImage(view, "figura-mask-plate", MASK);
    bodyPlate.setAttribute("data-mask-for", "body");
    bodyMask.appendChild(bodyPlate);
    defs.appendChild(bodyMask);

    const inkMask = svg("mask", {
      id: inkMaskId,
      class: "figura-ink-mask",
      maskUnits: "userSpaceOnUse",
      x: 0,
      y: 0,
      width: VIEWBOX.width,
      height: VIEWBOX.height,
      style: "mask-type:alpha"
    });
    const inkPlate = maskImage(view, "figura-mask-plate is-ink", INK);
    inkPlate.setAttribute("data-mask-for", "ink");
    inkMask.appendChild(inkPlate);
    defs.appendChild(inkMask);
    root.appendChild(defs);

    const plate = plateImage(view, "figura-plate");
    plate.setAttribute("data-anatomy-plate", view);
    root.appendChild(plate);

    const regionLayer = svg("g", { class: "figura-regions" });
    const inkMaskRef = "url(#" + inkMaskId + ")";
    const bodyMaskRef = "url(#" + bodyMaskId + ")";

    const roleRank = { informed: 0, stabilizer: 1, secondary: 2, primary: 3, focus: 4 };
    const ordered = Object.keys(REGIONS)
      .filter(regionId => highlights[regionId] && shapesFor(regionId, view))
      .sort((a, b) => (roleRank[highlights[a]] || 0) - (roleRank[highlights[b]] || 0));

    ordered.forEach(regionId => {
      const shapes = shapesFor(regionId, view);
      const role = highlights[regionId];
      const group = svg("g", {
        class: "figura-region is-" + role,
        "data-region": regionId,
        "data-role": role
      });
      const focused = settings.selected === regionId;

      if (settings.interactive) {
        group.setAttribute("role", "button");
        group.setAttribute("tabindex", "0");
        group.setAttribute("aria-pressed", focused ? "true" : "false");
        group.setAttribute("aria-label", REGIONS[regionId].label + ", " +
          (ROLE_NAMES[role] || role) + (focused ? ", selecionada" : "") + ". " + VIEWS[view] + ".");

        const activate = event => {
          if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
          if (event.type === "keydown") event.preventDefault();
          if (typeof settings.onSelect === "function") settings.onSelect(regionId);
        };
        group.addEventListener("click", activate);
        group.addEventListener("keydown", activate);
      }

      shapes.forEach(path => {
        /* Cor só nas áreas escuras do desenho; contorno e área de clique
           presos à silhueta do corpo. */
        group.appendChild(svg("path", { class: "figura-region-shape", d: path, mask: inkMaskRef }));
        group.appendChild(svg("path", { class: "figura-region-outline", d: path, mask: bodyMaskRef }));
        if (settings.interactive) {
          group.appendChild(svg("path", {
            class: "figura-region-hit",
            d: path,
            mask: bodyMaskRef,
            "aria-hidden": "true"
          }));
        }
      });
      regionLayer.appendChild(group);
    });

    root.appendChild(regionLayer);
    wrapper.appendChild(root);
    return wrapper;
  }

  function describe(highlights, view) {
    const current = view === "back" ? "back" : "front";
    const levels = { primary: [], secondary: [], stabilizer: [], informed: [], focus: [] };
    Object.keys(highlights || {}).forEach(regionId => {
      const role = highlights[regionId];
      if (REGIONS[regionId] && shapesFor(regionId, current) && levels[role]) {
        levels[role].push(REGIONS[regionId].label);
      }
    });

    const parts = [];
    if (levels.primary.length) parts.push("principal: " + levels.primary.join(", "));
    if (levels.secondary.length) parts.push("secundária: " + levels.secondary.join(", "));
    if (levels.stabilizer.length) parts.push("estabilizadora: " + levels.stabilizer.join(", "));
    if (levels.informed.length) parts.push("informada por você: " + levels.informed.join(", "));
    if (levels.focus.length) parts.push("em foco: " + levels.focus.join(", "));

    const viewLabel = current === "back"
      ? "Modelo anatômico muscular, vista posterior"
      : "Modelo anatômico muscular, vista anterior";
    return parts.length ? viewLabel + ". " + parts.join(". ") + "." : viewLabel + ", nenhuma região destacada.";
  }

  F.figura = {
    VIEWS,
    VIEWBOX,
    REFERENCE,
    MASK,
    INK,
    CROPS,
    AXES,
    ROLE_NAMES,
    REGIONS,
    render,
    describe,
    regionsInView,
    shapesFor
  };
})(window);
