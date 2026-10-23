/*
  FORJA — modelo anatômico muscular (vistas anterior e posterior).

  A anatomia vem exclusivamente dos recortes raster das referências fornecidas
  pelo usuário. Não existe silhueta nem corpo desenhado por código neste módulo.
  Os caminhos abaixo são apenas destaques funcionais conservadores, traçados no
  mesmo espaço 350 × 690 das imagens; a máscara de saída usa o canal alfa da
  própria prancha para impedir tinta fora do corpo.

  Os destaques representam projeções superficiais aproximadas das regiões do
  catálogo. Não são segmentação clínica nem afirmam delimitar músculos profundos.
*/
(function (global) {
  "use strict";

  const doc = global.document;
  const F = global.Forja = global.Forja || {};
  const NS = "http://www.w3.org/2000/svg";

  const VIEWBOX = Object.freeze({ width: 350, height: 690 });
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
  const PLATES = Object.freeze({
    front: ASSET_PREFIX + "assets/anatomia/anterior.png",
    back: ASSET_PREFIX + "assets/anatomia/posterior.png"
  });

  /* Contornos compartilhados pela região geral "pernas". São reutilizados,
     não redesenhados em outra escala, para manter o registro com a prancha. */
  const FRONT_QUADRICEPS = [
    "M129 329C114 340 108 365 110 397C112 429 123 454 138 470C146 477 156 469 159 453C165 420 167 382 160 349C152 337 141 330 129 329Z",
    "M225 329C240 340 246 365 244 397C242 429 231 454 216 470C208 477 198 469 195 453C189 420 187 382 194 349C202 337 213 330 225 329Z"
  ];
  const FRONT_LOWER_LEGS = [
    "M135 487C123 504 119 532 122 560C125 586 129 607 134 619C140 624 148 617 150 604C153 574 159 543 158 516C153 499 146 489 135 487Z",
    "M219 487C229 504 231 532 229 560C227 586 224 607 220 619C214 624 208 617 208 604C208 574 205 543 205 516C208 499 213 489 219 487Z"
  ];
  const BACK_HAMSTRINGS = [
    "M116 360C131 367 149 368 163 358C165 388 161 424 152 458C146 480 138 493 126 489C113 474 106 447 103 415C102 390 106 372 116 360Z",
    "M222 360C207 367 189 368 175 358C173 388 177 424 186 458C192 480 200 493 212 489C222 474 226 447 227 415C228 390 228 372 222 360Z"
  ];
  const BACK_CALVES = [
    "M122 485C109 497 102 519 104 543C107 563 117 576 130 574C144 567 150 548 147 526C145 506 137 490 122 485Z",
    "M216 485C225 497 228 519 226 543C223 563 218 576 208 574C198 567 194 548 195 526C197 506 204 490 216 485Z"
  ];

  const REGIONS = {
    ombros: {
      label: "Ombros",
      front: [
        "M113 124C99 128 92 142 92 158C93 177 102 190 113 193C122 182 128 163 128 145C125 134 120 127 113 124Z",
        "M247 124C261 128 269 142 269 159C267 178 259 190 247 194C238 181 233 163 234 145C236 134 241 127 247 124Z"
      ],
      back: [
        "M102 127C86 134 79 150 81 169C84 187 95 197 107 193C116 180 119 161 116 143C112 134 108 130 102 127Z",
        "M236 127C252 134 259 150 257 169C254 187 243 197 231 193C222 180 219 161 222 143C226 134 230 130 236 127Z"
      ]
    },
    peito: {
      label: "Peitoral",
      front: [
        "M124 143C138 134 158 132 173 137C175 151 175 169 173 183C159 193 143 198 129 191C121 179 119 158 124 143Z",
        "M190 137C207 132 226 135 239 144C246 159 244 180 235 191C220 198 204 193 190 183C187 168 187 151 190 137Z"
      ],
      back: []
    },
    biceps: {
      label: "Bíceps",
      front: [
        "M108 183C99 194 94 211 91 226C91 237 97 242 105 238C114 227 120 208 122 191C119 184 114 181 108 183Z",
        "M252 183C261 194 266 211 269 226C269 237 263 242 255 238C246 227 240 208 238 191C241 184 246 181 252 183Z"
      ],
      back: []
    },
    antebracos: {
      label: "Antebraços",
      front: [
        "M94 229C83 244 73 267 62 291C56 305 51 316 46 323C42 329 45 334 51 332C63 319 71 300 80 280C88 262 96 246 101 237C101 232 99 229 94 229Z",
        "M266 229C276 244 284 267 291 291C296 305 299 316 303 323C307 329 304 334 298 332C289 318 282 300 276 280C270 262 263 246 259 237C259 232 261 229 266 229Z"
      ],
      back: [
        "M69 244C60 261 56 285 49 316C48 325 52 330 58 325C67 305 75 279 83 257C80 249 76 245 69 244Z",
        "M261 244C272 260 280 284 293 314C297 323 293 330 285 325C274 305 265 280 254 257C254 250 256 246 261 244Z"
      ]
    },
    abdomem: {
      label: "Abdômen",
      front: [
        "M151 194C163 190 192 190 204 194C214 211 214 240 208 267C203 293 192 322 177 339C162 322 151 293 146 267C140 240 141 211 151 194Z"
      ],
      back: []
    },
    obliquos: {
      label: "Oblíquos",
      front: [
        "M137 203C126 216 121 236 124 256C127 276 135 291 148 302L153 282C146 260 143 232 148 209C145 205 141 203 137 203Z",
        "M217 203C228 216 233 236 230 256C227 276 219 291 206 302L201 282C208 260 211 232 206 209C209 205 213 203 217 203Z"
      ],
      back: []
    },
    quadril: {
      label: "Quadril",
      front: [
        "M137 286C127 297 122 315 125 332C132 342 143 347 153 344C157 331 161 316 166 304C156 296 147 290 137 286Z",
        "M217 286C227 297 232 315 229 332C222 342 211 347 201 344C197 331 193 316 188 304C198 296 207 290 217 286Z"
      ],
      back: []
    },
    quadriceps: {
      label: "Quadríceps",
      front: FRONT_QUADRICEPS,
      back: []
    },
    pernas: {
      label: "Pernas",
      front: FRONT_QUADRICEPS.concat(FRONT_LOWER_LEGS),
      back: BACK_HAMSTRINGS.concat(BACK_CALVES)
    },
    costas: {
      label: "Costas",
      front: [],
      back: [
        "M163 94C150 105 138 112 121 115L97 125C92 138 98 151 110 157C125 153 140 145 150 139C148 163 152 190 163 215L168 228L168 107Z",
        "M175 94C188 105 200 112 217 115L241 125C246 138 240 151 228 157C213 153 198 145 188 139C190 163 186 190 175 215L170 228L170 107Z"
      ]
    },
    dorsais: {
      label: "Dorsais",
      front: [],
      back: [
        "M116 190C129 197 145 207 160 224C155 243 147 262 137 279C125 286 116 278 115 264C112 238 112 212 116 190Z",
        "M222 190C209 197 193 207 178 224C183 243 191 262 201 279C213 286 219 278 219 264C220 238 220 212 222 190Z"
      ]
    },
    lombar: {
      label: "Lombar",
      front: [],
      back: [
        "M157 228C151 248 146 270 148 291C154 299 161 302 168 304L169 242C165 235 161 230 157 228Z",
        "M181 228C187 248 192 270 190 291C184 299 177 302 170 304L169 242C173 235 177 230 181 228Z"
      ]
    },
    triceps: {
      label: "Tríceps",
      front: [],
      back: [
        "M89 187C78 202 71 224 68 244C68 256 75 263 84 257C92 240 99 219 104 198C102 190 97 186 89 187Z",
        "M249 187C260 202 267 224 270 244C270 256 263 263 254 257C246 240 239 219 234 198C236 190 241 186 249 187Z"
      ]
    },
    gluteos: {
      label: "Glúteos",
      front: [],
      back: [
        "M116 294C131 296 150 302 166 314L167 352C157 365 136 368 119 356C109 342 107 314 116 294Z",
        "M222 294C207 296 188 302 172 314L171 352C181 365 202 368 219 356C229 342 231 314 222 294Z"
      ]
    },
    "posterior-coxa": {
      label: "Posterior de coxa",
      front: [],
      back: BACK_HAMSTRINGS
    },
    panturrilha: {
      label: "Panturrilha",
      front: [],
      back: BACK_CALVES
    }
  };

  function shapesFor(regionId, view) {
    const region = REGIONS[regionId];
    if (!region) return null;
    if (view === "back") {
      if (region.back && region.back.length) return region.back;
      if (region.both && region.both.length) return region.both;
      return null;
    }
    if (region.front && region.front.length) return region.front;
    if (region.both && region.both.length) return region.both;
    return null;
  }

  function regionsInView(view) {
    return Object.keys(REGIONS).filter(id => Boolean(shapesFor(id, view)));
  }

  function svg(tag, attributes) {
    const node = doc.createElementNS(NS, tag);
    Object.keys(attributes || {}).forEach(key => node.setAttribute(key, String(attributes[key])));
    return node;
  }

  function plateImage(view, className) {
    return svg("image", {
      class: className,
      href: PLATES[view],
      x: 0,
      y: 0,
      width: VIEWBOX.width,
      height: VIEWBOX.height,
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
    const maskId = "figura-alpha-" + maskCounter;

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

    /* A máscara não contém uma segunda silhueta: referencia exatamente o PNG
       exibido abaixo. Assim, correções de enquadramento não podem divergir. */
    const defs = svg("defs", {});
    const mask = svg("mask", {
      id: maskId,
      class: "figura-alpha-mask",
      maskUnits: "userSpaceOnUse",
      x: 0,
      y: 0,
      width: VIEWBOX.width,
      height: VIEWBOX.height,
      style: "mask-type:alpha"
    });
    const maskImage = plateImage(view, "figura-mask-plate");
    maskImage.setAttribute("data-mask-for", view);
    mask.appendChild(maskImage);
    defs.appendChild(mask);
    root.appendChild(defs);

    const plate = plateImage(view, "figura-plate");
    plate.setAttribute("data-anatomy-plate", view);
    root.appendChild(plate);

    const regionLayer = svg("g", {
      class: "figura-regions",
      mask: "url(#" + maskId + ")"
    });

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
        group.appendChild(svg("path", { class: "figura-region-shape", d: path }));
        if (settings.interactive) {
          group.appendChild(svg("path", { class: "figura-region-hit", d: path, "aria-hidden": "true" }));
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
    PLATES,
    ROLE_NAMES,
    REGIONS,
    render,
    describe,
    regionsInView,
    shapesFor
  };
})(window);
