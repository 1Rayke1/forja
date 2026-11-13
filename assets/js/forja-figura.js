/*
  FORJA — modelo anatômico muscular (vistas anterior e posterior).

  A anatomia exibida é a prancha oficial fornecida pelo usuário, sem redesenho:
  um único arquivo (`assets/anatomia/fontes/forja-modelo-anatomico.png`) contém
  as duas vistas do mesmo modelo — anterior à esquerda, posterior à direita.
  Cada figura é apenas uma janela (`crop`) desse arquivo; as duas janelas têm
  exatamente o mesmo tamanho e a mesma escala, então anterior e posterior
  aparecem sempre alinhadas e do mesmo tamanho.

  O fundo da prancha é transparente: quem pinta o preto do tema é a página.

  Este módulo não cria corpo, silhueta de boneco nem músculo desenhado. O que
  ele contém são projeções funcionais das regiões do catálogo, traçadas sobre
  as áreas que o próprio desenho delimita. A tinta dos destaques é recortada
  pela silhueta derivada da prancha (`mascara.png`), então nenhum destaque
  pode aparecer fora do corpo; e o preenchimento usa a máscara de tinta
  (`tinta.png`), graduada pela sombra do desenho, de modo que o realce acompanha
  o músculo em vez de chapar a região.

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
     alinhamento (460 × 1024, eixo de simetria em x = 230). O enquadramento é
     calculado por `tools/gerar-anatomia-referencia.mjs` a partir da própria
     prancha e registrado em `assets/anatomia/manifest.json`, que é a fonte
     destes números: corpo inteiro dentro da janela, sem corte de cabeça,
     mãos, pernas ou pés. O teste ATLAS 3 compara os dois. */
  const VIEWBOX = Object.freeze({ width: 460, height: 1024 });

  /* Arquivo único de referência: 1536 × 1024 (RGBA) com as duas vistas. */
  const REFERENCE = Object.freeze({
    src: "assets/anatomia/fontes/forja-modelo-anatomico.png",
    width: 1536,
    height: 1024
  });
  /* Derivados da prancha por `tools/gerar-anatomia-referencia.mjs`:
     - MASK  limita qualquer traço à silhueta do corpo;
     - INK   dosa o preenchimento pela sombra do desenho, para a cor aparecer
             nas fissuras sem cobrir os realces claros. */
  const MASK = "assets/anatomia/mascara.png";
  const INK = "assets/anatomia/tinta.png";

  /* `crop.x` seleciona a vista dentro do arquivo único; `crop.y` é negativo
     porque a margem superior do enquadramento fica acima da prancha. */
  const CROPS = Object.freeze({
    front: Object.freeze({ x: 239, y: -3, width: VIEWBOX.width, height: VIEWBOX.height }),
    back: Object.freeze({ x: 842, y: -3, width: VIEWBOX.width, height: VIEWBOX.height })
  });

  /* Eixo de simetria de cada desenho (medido nos limites do corpo). Só é usado
     para espelhar a metade autoral de uma região — não desenha anatomia. */
  const AXES = Object.freeze({ front: 230, back: 230 });

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

  function toPaths(groups, view) {
    return groups.reduce((paths, group) => paths.concat(pair(view, group).map(polygonPath)), []);
  }

  /* ------------------------------------------------------------------ */
  /* Regiões do catálogo sobre o desenho                                */
  /* ------------------------------------------------------------------ */

  /*
    Cada entrada descreve onde a região aparece e o que ela representa de fato
    nesta ilustração. `front`/`back` são as metades autorais (coordenadas da
    VIEWBOX), espelhadas em torno do eixo do desenho; viram caminhos SVG logo
    abaixo. Os IDs são os mesmos do catálogo, do atlas e da tabela de grupos.
  */
  const SHAPES = {
    "ombros": {
      label: "Ombros",
      note: "Deltoide visível, do acrômio à inserção no braço; o trapézio fica na região Costas.",
      backNote: "Deltoide posterior, do acrômio à inserção no braço; o trapézio fica na região Costas.",
      front: [
        [
          [138, 188], [118, 182], [96, 190], [84, 202], [77, 216],
          [75, 234], [76, 252], [70, 270], [64, 288], [78, 294],
          [96, 292], [112, 284], [126, 270], [136, 250], [144, 226],
          [148, 204]
        ]
      ],
      back: [
        [
          [140, 186], [120, 180], [98, 188], [86, 200], [79, 214],
          [77, 232], [78, 250], [72, 268], [66, 286], [80, 292],
          [98, 290], [114, 282], [128, 268], [138, 248], [146, 224],
          [150, 202]
        ]
      ]
    },
    "peito": {
      label: "Peitoral",
      note: "Porção visível do peitoral maior, do esterno à axila.",
      backNote: "",
      front: [
        [
          [220, 190], [202, 184], [180, 184], [162, 194], [153, 210],
          [151, 234], [155, 255], [164, 269], [178, 279], [195, 284],
          [212, 278], [220, 260], [222, 228]
        ]
      ],
      back: []
    },
    "biceps": {
      label: "Bíceps",
      note: "Ventre anterior do braço, do ombro à dobra do cotovelo.",
      backNote: "",
      front: [
        [
          [112, 290], [98, 294], [84, 304], [72, 320], [64, 340],
          [60, 360], [64, 370], [76, 372], [88, 364], [98, 348],
          [106, 328], [112, 308]
        ]
      ],
      back: []
    },
    "antebracos": {
      label: "Antebraços",
      note: "Massa muscular do antebraço; a mão e o punho não entram na região.",
      backNote: "Massa muscular do antebraço; a mão e o punho não entram na região.",
      front: [
        [
          [110, 382], [102, 398], [94, 418], [82, 440], [68, 460],
          [54, 476], [42, 486], [28, 486], [22, 470], [25, 444],
          [30, 418], [36, 396], [44, 382], [58, 374], [80, 372],
          [96, 374]
        ]
      ],
      back: [
        [
          [112, 380], [104, 396], [96, 416], [84, 438], [70, 458],
          [56, 474], [44, 484], [30, 484], [24, 468], [27, 442],
          [32, 416], [38, 394], [46, 380], [60, 372], [82, 370],
          [98, 372]
        ]
      ]
    },
    "abdomem": {
      label: "Abdômen",
      note: "Reto abdominal visível, com a linha alba e as interseções do desenho.",
      backNote: "",
      front: [
        [
          [220, 290], [208, 292], [196, 298], [189, 310], [187, 340],
          [188, 368], [192, 392], [200, 408], [212, 412], [220, 402],
          [221, 340]
        ]
      ],
      back: []
    },
    "obliquos": {
      label: "Oblíquos",
      note: "Faixa lateral do tronco entre o reto abdominal e a borda do corpo.",
      backNote: "",
      front: [
        [
          [184, 302], [172, 310], [162, 326], [156, 350], [153, 376],
          [155, 394], [162, 408], [172, 414], [181, 404], [183, 350]
        ]
      ],
      back: []
    },
    "quadril": {
      label: "Quadril",
      note: "Projeção superficial da região inguinal e do quadril — não representa o iliopsoas.",
      backNote: "",
      front: [
        [
          [176, 392], [163, 394], [154, 402], [150, 412], [156, 420],
          [169, 422], [179, 415], [182, 402]
        ]
      ],
      back: []
    },
    "quadriceps": {
      label: "Quadríceps",
      note: "Massa anterior da coxa até acima da patela; a articulação do joelho fica neutra.",
      backNote: "",
      front: [
        [
          [200, 604], [184, 604], [168, 610], [152, 622], [139, 640],
          [130, 660], [125, 680], [131, 692], [146, 694], [163, 688],
          [178, 676], [190, 656], [198, 630]
        ]
      ],
      back: []
    },
    "pernas": {
      label: "Pernas",
      note: "Região geral: coxa e perna da mesma vista, sem o pé e sem a patela.",
      backNote: "Região geral: coxa e perna da mesma vista, sem o pé e sem o tendão calcâneo.",
      front: [
        [
          [200, 604], [184, 604], [168, 610], [152, 622], [139, 640],
          [130, 660], [125, 680], [131, 694], [146, 696], [163, 690],
          [178, 676], [190, 656], [198, 630]
        ],
        [
          [133, 736], [120, 752], [111, 780], [108, 810], [111, 842],
          [122, 866], [138, 872], [150, 852], [155, 816], [153, 784],
          [144, 754]
        ]
      ],
      back: [
        [
          [202, 608], [186, 608], [171, 614], [160, 630], [155, 656],
          [155, 680], [163, 696], [179, 700], [195, 690], [202, 664],
          [206, 634]
        ],
        [
          [135, 736], [122, 752], [113, 780], [110, 810], [113, 840],
          [124, 864], [140, 868], [152, 848], [157, 814], [155, 782],
          [146, 754]
        ]
      ]
    },
    "costas": {
      label: "Costas",
      note: "",
      backNote: "Trapézio e região escapular superior, agrupados como uma única região.",
      front: [],
      back: [
        [
          [218, 174], [200, 170], [181, 178], [167, 194], [161, 216],
          [163, 240], [172, 256], [189, 264], [205, 260], [215, 244],
          [218, 208]
        ]
      ]
    },
    "dorsais": {
      label: "Dorsais",
      note: "",
      backNote: "Grande dorsal e massa lateral do dorso até a crista ilíaca.",
      front: [],
      back: [
        [
          [211, 276], [194, 282], [179, 298], [168, 324], [162, 356],
          [162, 384], [169, 404], [185, 408], [199, 398], [207, 374],
          [210, 320]
        ]
      ]
    },
    "lombar": {
      label: "Lombar",
      note: "",
      backNote: "Projeção superficial da região lombar; os eretores profundos não são isolados.",
      front: [],
      back: [
        [
          [216, 376], [201, 381], [193, 393], [195, 406], [207, 412],
          [220, 410], [227, 396], [226, 380]
        ]
      ]
    },
    "triceps": {
      label: "Tríceps",
      note: "",
      backNote: "Ventre posterior do braço, do ombro à dobra do cotovelo.",
      front: [],
      back: [
        [
          [88, 300], [78, 320], [67, 340], [55, 358], [50, 374],
          [54, 386], [68, 390], [82, 386], [90, 374], [99, 358],
          [109, 340], [114, 320], [112, 300]
        ]
      ]
    },
    "gluteos": {
      label: "Glúteos",
      note: "",
      backNote: "Projeção do glúteo sob o short — o contorno do corpo está coberto pela peça.",
      front: [],
      back: [
        [
          [212, 450], [194, 446], [178, 452], [168, 464], [162, 480],
          [161, 497], [164, 512], [170, 524], [179, 531], [190, 531],
          [199, 524], [206, 511], [210, 493], [211, 470]
        ]
      ]
    },
    "posterior-coxa": {
      label: "Posterior de coxa",
      note: "",
      backNote: "Isquiotibiais, da dobra glútea até a fossa poplítea.",
      front: [],
      back: [
        [
          [202, 608], [186, 608], [171, 614], [160, 630], [155, 656],
          [155, 680], [163, 696], [179, 700], [195, 690], [202, 664],
          [206, 634]
        ]
      ]
    },
    "panturrilha": {
      label: "Panturrilha",
      note: "",
      backNote: "Ventres do tríceps sural; o tendão calcâneo não é pintado como ventre.",
      front: [],
      back: [
        [
          [135, 734], [121, 750], [112, 778], [109, 810], [113, 842],
          [125, 868], [141, 870], [153, 846], [157, 812], [154, 778],
          [145, 750]
        ]
      ]
    }
  };

  const REGIONS = {};
  Object.keys(SHAPES).forEach(id => {
    const entry = SHAPES[id];
    REGIONS[id] = {
      label: entry.label,
      note: entry.note,
      backNote: entry.backNote || "",
      front: toPaths(entry.front, "front"),
      back: toPaths(entry.back, "back")
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
        /* Cor dosada pela sombra do desenho; contorno e área de clique presos
           à silhueta do corpo. */
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
