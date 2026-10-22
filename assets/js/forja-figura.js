/*
  FORJA — figura humana vetorial (vistas anterior e posterior).

  Este módulo desenha SÓ o corpo e as regiões musculares. Ele não conhece
  catálogo, exercícios nem páginas: recebe um mapa `região → papel` já
  calculado e devolve um `<svg>`. Quem decide o papel é o catálogo
  (ver `forja-atlas.js`), então não há duas fontes de verdade.

  Como o desenho é feito (sem boneco palito):
  - proporções de referência: cabeça ≈ 1/7,5 da altura, ombros largos, cintura
    marcada, quadril ligeiramente mais largo que a cintura, coxa grossa que
    afina até o joelho, panturrilha com volume e tornozelo fino;
  - tronco, cabeça e pescoço são contornos fechados e suavizados (Catmull-Rom →
    Bézier). Braços, mãos, pernas e pés são membros com linha média e meia-largura
    em cada ponto, então o volume é contínuo e as extremidades afinam;
  - cada parte é desenhada na sua ordem, com contorno próprio. Por isso o braço
    aparece separado do tronco e a perna separada da outra, sem depender de cor;
  - o preenchimento tem um degradê horizontal (mais claro nas bordas, mais
    escuro no centro) que dá a leitura de volume cilíndrico;
  - as regiões musculares são formas fechadas suavizadas, recortadas pela
    silhueta com `clipPath`, então o destaque acompanha o corpo.

  O que continua valendo do documento `docs/atlas-anatomico.md`: isto é um
  esquema de regiões, não uma ilustração anatômica clínica. Não há músculos
  individuais, fibras, inserções nem vistas laterais.
*/
(function (global) {
  "use strict";

  const doc = global.document;
  const F = global.Forja = global.Forja || {};
  const NS = "http://www.w3.org/2000/svg";

  const VIEWBOX = Object.freeze({ width: 240, height: 520 });
  const CENTER = VIEWBOX.width / 2;

  const VIEWS = Object.freeze({
    front: "Vista anterior",
    back: "Vista posterior"
  });

  let clipCounter = 0;

  /* ------------------------------------------------------------------ */
  /* Geometria: curvas suaves, membros com volume                        */
  /* ------------------------------------------------------------------ */

  const round = value => Math.round(value * 100) / 100;
  const at = (list, index) => list[Math.max(0, Math.min(list.length - 1, index))];
  const fmt = point => round(point.x) + "," + round(point.y);

  /* Catmull-Rom → Bézier cúbica (curva aberta, passando por todos os pontos). */
  function smoothOpen(points) {
    if (!points || points.length === 0) return "";
    if (points.length === 1) return "M" + fmt(points[0]);

    let d = "M" + fmt(points[0]);

    for (let index = 0; index < points.length - 1; index += 1) {
      const p0 = at(points, index - 1);
      const p1 = points[index];
      const p2 = points[index + 1];
      const p3 = at(points, index + 2);

      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };

      d += "C" + fmt(c1) + " " + fmt(c2) + " " + fmt(p2);
    }

    return d;
  }

  /* Catmull-Rom fechado: usado nas formas de região e no tronco/cabeça. */
  function smoothClosed(points) {
    const total = points.length;
    if (total < 3) return smoothOpen(points) + "Z";

    let d = "M" + fmt(points[0]);

    for (let index = 0; index < total; index += 1) {
      const p0 = points[(index - 1 + total) % total];
      const p1 = points[index];
      const p2 = points[(index + 1) % total];
      const p3 = points[(index + 2) % total];

      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };

      d += "C" + fmt(c1) + " " + fmt(c2) + " " + fmt(p2);
    }

    return d + "Z";
  }

  function normals(points) {
    return points.map((point, index) => {
      const prev = at(points, index - 1);
      const next = at(points, index + 1);
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      return { x: -dy / length, y: dx / length };
    });
  }

  /* Membro: desce por um lado com a meia-largura de cada ponto, volta pelo outro. */
  function limb(points) {
    const n = normals(points);
    const left = points.map((point, index) => ({
      x: point.x + n[index].x * point.w,
      y: point.y + n[index].y * point.w
    }));
    const right = points.map((point, index) => ({
      x: point.x - n[index].x * point.w,
      y: point.y - n[index].y * point.w
    })).reverse();

    return smoothOpen(left) + smoothOpen(right).replace(/^M/, "L") + "Z";
  }

  function mirror(points) {
    return points.map(point => ({ x: CENTER * 2 - point.x, y: point.y, w: point.w }));
  }

  /*
    Contorno simétrico: `right` vai do topo ao fundo pelo lado direito da
    figura (x > 120). O lado esquerdo é o espelho, percorrido de volta.
  */
  function bilateral(right, top, bottom) {
    const mirrored = right.map(point => ({ x: CENTER * 2 - point.x, y: point.y })).reverse();
    return smoothClosed([
      { x: CENTER, y: top },
      ...right,
      { x: CENTER, y: bottom },
      ...mirrored
    ]);
  }

  /*
    Recorta um trecho do membro entre duas alturas e devolve o contorno com
    uma margem interna, para o destaque não encostar na borda do corpo.
  */
  function segment(points, top, bottom, inset) {
    const margin = inset === undefined ? 2.5 : inset;
    const sliced = [];
    const clampWidth = point => Math.max(2, point.w - margin);

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];

      if (point.y > top && point.y < bottom) {
        sliced.push({ x: point.x, y: point.y, w: clampWidth(point) });
      }
    }

    const first = points[0];
    const last = points[points.length - 1];

    if (sliced.length === 0 || sliced[0].y - top > 1) {
      const limit = top < first.y ? first.y + 1 : top;
      sliced.unshift({ x: interpolateX(points, limit), y: limit, w: clampWidth(interpolate(points, limit)) });
    }

    if (sliced[sliced.length - 1].y < bottom - 1) {
      const limit = bottom > last.y ? last.y - 1 : bottom;
      sliced.push({ x: interpolateX(points, limit), y: limit, w: clampWidth(interpolate(points, limit)) });
    }

    /* Pontas arredondadas: o destaque acompanha o músculo, sem corte reto. */
    const head = sliced[0];
    const tail = sliced[sliced.length - 1];
    const cap = point => ({ x: point.x, y: point.y, w: Math.max(1.6, point.w * 0.45) });

    const withCaps = [
      { x: head.x, y: head.y - 2.5, w: Math.max(1.2, head.w * 0.2) },
      cap(head),
      ...sliced.slice(1, -1),
      cap(tail),
      { x: tail.x, y: tail.y + 2.5, w: Math.max(1.2, tail.w * 0.2) }
    ];

    return limb(withCaps);
  }

  function interpolate(points, y) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];

      if ((y >= a.y && y <= b.y) || (y <= a.y && y >= b.y)) {
        const ratio = (y - a.y) / ((b.y - a.y) || 1);
        return { x: a.x + (b.x - a.x) * ratio, y: y, w: a.w + (b.w - a.w) * ratio };
      }
    }

    const closest = Math.abs(points[0].y - y) <= Math.abs(points[points.length - 1].y - y) ? points[0] : points[points.length - 1];
    return { x: closest.x, y: y, w: closest.w };
  }

  function interpolateX(points, y) {
    return interpolate(points, y).x;
  }

  /* ------------------------------------------------------------------ */
  /* Corpo (coordenadas do lado direito da figura, x > 120)              */
  /* Altura total ≈ 500 (cabeça no topo, pés em ~506).                   */
  /* ------------------------------------------------------------------ */

  /* Cabeça: crânio, maçãs do rosto e queixo. Topo y=10, queixo y=74. */
  const HEAD_RIGHT = [
    { x: 126, y: 10.5 }, { x: 134, y: 13 }, { x: 138.5, y: 22 }, { x: 139, y: 36 },
    { x: 136, y: 50 }, { x: 130, y: 61 }, { x: 125, y: 70 }
  ];

  /* Pescoço: sai sob a cabeça e entra nos trapézios. */
  const NECK_RIGHT = [
    { x: 127, y: 62 }, { x: 129.5, y: 72 }, { x: 131, y: 82 }, { x: 133, y: 90 }
  ];

  /*
    Tronco: trapézio saindo do pescoço, ombro, peito largo, cintura (≈ 28 de
    meia-largura), quadril (≈ 36) e virilha. Topo y=86, fundo y=278.
  */
  const TORSO_RIGHT = [
    { x: 130, y: 88 }, { x: 140, y: 91 }, { x: 153, y: 97 }, { x: 163, y: 107 },
    { x: 167, y: 120 }, { x: 164, y: 132 }, { x: 162, y: 144 }, { x: 158, y: 158 },
    { x: 150, y: 172 }, { x: 148, y: 186 }, { x: 152, y: 200 }, { x: 157, y: 216 },
    { x: 157, y: 230 }, { x: 153, y: 244 }, { x: 145, y: 259 }, { x: 134, y: 270 },
    { x: 124, y: 277 }
  ];

  /* Braço: deltoide → bíceps → cotovelo → antebraço → punho. */
  const ARM = [
    { x: 152, y: 106, w: 7 },
    { x: 156, y: 116, w: 11 },
    { x: 160, y: 128, w: 12.5 },
    { x: 163, y: 142, w: 11.5 },
    { x: 166, y: 158, w: 10 },
    { x: 169, y: 176, w: 9 },
    { x: 172, y: 192, w: 8 },
    { x: 175, y: 206, w: 8.6 },
    { x: 178, y: 222, w: 9.4 },
    { x: 180, y: 238, w: 8.6 },
    { x: 181, y: 252, w: 7 },
    { x: 182, y: 264, w: 5.2 }
  ];

  /* Mão: punho, palma larga e dedos afinando até a ponta. */
  const HAND = [
    { x: 182, y: 262, w: 5.2 },
    { x: 184, y: 274, w: 6.6 },
    { x: 185, y: 288, w: 6.6 },
    { x: 186, y: 300, w: 5.6 },
    { x: 186.5, y: 311, w: 4.2 },
    { x: 187, y: 318, w: 2.2 }
  ];

  /* Perna: quadril → coxa (mais grossa perto do quadril) → joelho → panturrilha → tornozelo. */
  const LEG = [
    { x: 144, y: 258, w: 17 },
    { x: 143, y: 276, w: 18.5 },
    { x: 141, y: 298, w: 17 },
    { x: 138, y: 322, w: 13.5 },
    { x: 135, y: 344, w: 10.5 },
    { x: 134, y: 364, w: 9.5 },
    { x: 134, y: 384, w: 10.5 },
    { x: 134, y: 404, w: 13 },
    { x: 135, y: 422, w: 12.5 },
    { x: 136, y: 440, w: 9.5 },
    { x: 137, y: 458, w: 6.8 },
    { x: 138, y: 476, w: 5.8 }
  ];

  /* Pé: calcanhar, dorso e ponta voltada para a frente. */
  const FOOT = [
    { x: 138, y: 477, w: 6 },
    { x: 140, y: 488, w: 6.5 },
    { x: 142.5, y: 496, w: 7.8 },
    { x: 146, y: 503, w: 6 },
    { x: 149, y: 506, w: 3 }
  ];

  /* Os desenhos de corpo são calculados uma vez e reutilizados em cada render. */
  const BODY = Object.freeze({
    legs: [limb(LEG), limb(mirror(LEG))],
    feet: [limb(FOOT), limb(mirror(FOOT))],
    torso: bilateral(TORSO_RIGHT, 86, 278),
    neck: bilateral(NECK_RIGHT, 60, 94),
    head: bilateral(HEAD_RIGHT, 10, 74),
    arms: [limb(ARM), limb(mirror(ARM))],
    hands: [limb(HAND), limb(mirror(HAND))]
  });

  /* Partes na ordem de desenho: de trás para a frente. */
  function bodyParts() {
    return [
      { id: "leg-right", d: BODY.legs[0] },
      { id: "leg-left", d: BODY.legs[1] },
      { id: "foot-right", d: BODY.feet[0] },
      { id: "foot-left", d: BODY.feet[1] },
      { id: "torso", d: BODY.torso },
      { id: "neck", d: BODY.neck },
      { id: "head", d: BODY.head },
      { id: "arm-right", d: BODY.arms[0] },
      { id: "arm-left", d: BODY.arms[1] },
      { id: "hand-right", d: BODY.hands[0] },
      { id: "hand-left", d: BODY.hands[1] }
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Regiões musculares (formas fechadas, recortadas pela silhueta)      */
  /* ------------------------------------------------------------------ */

  function ring(points) {
    return smoothClosed(points.map(point => ({ x: point.x, y: point.y })));
  }

  function mirroredRing(points) {
    return ring(points.map(point => ({ x: CENTER * 2 - point.x, y: point.y })));
  }

  /* Faixa de músculo ao longo de um membro, deslocada `dx` e com largura `scale`. */
  function armBand(points, top, bottom, dx, scale) {
    const band = points.map(point => ({ x: point.x + dx, y: point.y, w: point.w * scale }));
    return [segment(band, top, bottom, 1.5), segment(mirror(band), top, bottom, 1.5)];
  }

  /* Deltoide: cobre a articulação do ombro, do acrômio até a inserção no braço. */
  const DELTOID = [
    { x: 146, y: 104 }, { x: 156, y: 100 }, { x: 166, y: 105 }, { x: 172, y: 118 },
    { x: 171, y: 132 }, { x: 163, y: 139 }, { x: 155, y: 134 }, { x: 148, y: 122 }
  ];

  /* Peitoral: placa larga sob a clavícula, borda inferior curva. */
  const PEC = [
    { x: 124, y: 100 }, { x: 136, y: 95 }, { x: 150, y: 98 }, { x: 160, y: 108 },
    { x: 163, y: 122 }, { x: 159, y: 134 }, { x: 146, y: 140 }, { x: 132, y: 139 },
    { x: 124, y: 132 }
  ];

  /* Reto abdominal: metade direita (a esquerda é o espelho, com a linha alba no meio). */
  const ABS = [
    { x: 120, y: 146 }, { x: 127, y: 144 }, { x: 131, y: 150 }, { x: 132, y: 166 },
    { x: 131, y: 184 }, { x: 128, y: 200 }, { x: 120, y: 207 }
  ];

  const OBLIQUE = [
    { x: 134, y: 146 }, { x: 142, y: 150 }, { x: 144, y: 166 }, { x: 142, y: 186 },
    { x: 136, y: 198 }, { x: 132, y: 186 }, { x: 132, y: 164 }
  ];

  const HIP = [
    { x: 124, y: 216 }, { x: 138, y: 216 }, { x: 154, y: 220 }, { x: 158, y: 234 },
    { x: 150, y: 246 }, { x: 134, y: 250 }, { x: 124, y: 246 }
  ];

  const UPPER_BACK = [
    { x: 104, y: 96 }, { x: 120, y: 94 }, { x: 136, y: 96 }, { x: 146, y: 104 },
    { x: 142, y: 122 }, { x: 128, y: 134 }, { x: 120, y: 136 }, { x: 112, y: 134 },
    { x: 98, y: 122 }, { x: 94, y: 104 }
  ];

  const LAT = [
    { x: 134, y: 126 }, { x: 146, y: 134 }, { x: 148, y: 150 }, { x: 140, y: 170 },
    { x: 132, y: 186 }, { x: 126, y: 178 }, { x: 128, y: 156 }, { x: 130, y: 138 }
  ];

  const LOWER_BACK = [
    { x: 110, y: 160 }, { x: 120, y: 156 }, { x: 130, y: 160 }, { x: 130, y: 184 },
    { x: 120, y: 192 }, { x: 110, y: 184 }
  ];

  const GLUTE = [
    { x: 124, y: 208 }, { x: 140, y: 212 }, { x: 152, y: 224 }, { x: 154, y: 240 },
    { x: 144, y: 256 }, { x: 130, y: 254 }, { x: 122, y: 238 }
  ];

  /*
    Cada região declara os desenhos que a representam. `both` vale nas duas
    vistas (ombros e pernas aparecem de frente e de costas), `front`/`back` só
    na sua vista.
  */
  const REGIONS = {
    ombros: {
      label: "Ombros",
      both: [ring(DELTOID), mirroredRing(DELTOID)]
    },
    peito: {
      label: "Peitoral",
      front: [ring(PEC), mirroredRing(PEC)]
    },
    biceps: {
      label: "Bíceps",
      front: armBand(ARM, 128, 190, -2.5, 0.55)
    },
    antebracos: {
      label: "Antebraços",
      both: [segment(ARM, 206, 262, 1.6), segment(mirror(ARM), 206, 262, 1.6)]
    },
    abdomem: {
      label: "Abdômen",
      front: [ring(ABS), mirroredRing(ABS)]
    },
    obliquos: {
      label: "Oblíquos",
      front: [ring(OBLIQUE), mirroredRing(OBLIQUE)]
    },
    quadril: {
      label: "Quadril",
      front: [ring(HIP), mirroredRing(HIP)]
    },
    quadriceps: {
      label: "Quadríceps",
      front: [segment(LEG, 262, 356, 4), segment(mirror(LEG), 262, 356, 4)]
    },
    pernas: {
      label: "Pernas",
      both: [segment(LEG, 258, 470, 3), segment(mirror(LEG), 258, 470, 3)]
    },
    costas: {
      label: "Costas",
      back: [ring(UPPER_BACK)]
    },
    dorsais: {
      label: "Dorsais",
      back: [ring(LAT), mirroredRing(LAT)]
    },
    triceps: {
      label: "Tríceps",
      back: armBand(ARM, 128, 190, 2.5, 0.55)
    },
    lombar: {
      label: "Lombar",
      back: [ring(LOWER_BACK)]
    },
    gluteos: {
      label: "Glúteos",
      back: [ring(GLUTE), mirroredRing(GLUTE)]
    },
    "posterior-coxa": {
      label: "Posterior de coxa",
      back: [segment(LEG, 260, 362, 4), segment(mirror(LEG), 260, 362, 4)]
    },
    panturrilha: {
      label: "Panturrilha",
      back: [segment(LEG, 392, 458, 4), segment(mirror(LEG), 392, 458, 4)]
    }
  };

  /*
    Linhas de referência discretas (recortadas pela silhueta). Poucas e finas:
    clavícula, linha alba, virilha e a fenda entre as escápulas e a coluna.
  */
  const DETAIL_LINES = {
    front: [
      { d: "M120,150 C120,170 120,188 120,208", className: "figura-line-strong" },
      { d: "M120,96 C112,100 104,100 96,104", className: "figura-line" },
      { d: "M120,96 C128,100 136,100 144,104", className: "figura-line" },
      { d: "M124,242 C128,252 127,262 122,274", className: "figura-line" },
      { d: "M116,242 C112,252 113,262 118,274", className: "figura-line" }
    ],
    back: [
      { d: "M120,100 C119,130 120,170 120,240", className: "figura-line-strong" },
      { d: "M104,112 C110,122 114,132 115,144", className: "figura-line" },
      { d: "M136,112 C130,122 126,132 125,144", className: "figura-line" }
    ]
  };

  const ROLE_NAMES = Object.freeze({
    primary: "principal",
    secondary: "secundária",
    stabilizer: "estabilizadora",
    focus: "região em foco"
  });

  function shapesFor(regionId, view) {
    const region = REGIONS[regionId];
    if (!region) return null;

    if (view === "back") {
      if (region.back) return region.back;
      if (region.both) return region.both;
      return null;
    }

    if (region.front) return region.front;
    if (region.both) return region.both;
    return null;
  }

  function regionsInView(view) {
    return Object.keys(REGIONS).filter(id => Boolean(shapesFor(id, view)));
  }

  function svg(tag, attrs) {
    const node = doc.createElementNS(NS, tag);

    Object.keys(attrs || {}).forEach(key => {
      node.setAttribute(key, String(attrs[key]));
    });

    return node;
  }

  /*
    Monta a figura.

    options:
      view        "front" | "back"
      highlights  { regiãoId: "primary" | "secondary" | "stabilizer" | "focus" }
      interactive opcional; quando existe, as regiões ganham foco e clique
      onSelect    (regiãoId) => void, usado com `interactive`
      selected    região marcada como pressionada (para leitura por teclado)
      label       texto alternativo; quando ausente é gerado a partir do destaque
      compact     reduz detalhes (usado na execução do treino)
  */
  function render(options) {
    const settings = Object.assign({ view: "front", highlights: {}, interactive: false }, options || {});
    const view = settings.view === "back" ? "back" : "front";
    const highlights = settings.highlights || {};

    clipCounter += 1;
    const clipId = "figura-clip-" + clipCounter;

    const wrapper = doc.createElement("div");
    wrapper.className = "figura figura-" + view + (settings.compact ? " is-compact" : "");

    const root = svg("svg", {
      viewBox: "0 0 " + VIEWBOX.width + " " + VIEWBOX.height,
      class: "figura-svg",
      role: settings.interactive ? "group" : "img",
      "aria-label": settings.label || describe(highlights, view)
    });

    if (!settings.interactive && settings.label === undefined) {
      root.setAttribute("role", "img");
    }

    /* Degradê horizontal: bordas mais claras, centro mais escuro (volume). */
    const defs = svg("defs", {});
    const gradient = svg("linearGradient", {
      id: clipId + "-volume", gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2: VIEWBOX.width, y2: 0
    });
    [[0, "#3a443b"], [0.3, "#2a322b"], [0.5, "#222922"], [0.7, "#2a322b"], [1, "#3a443b"]].forEach(([offset, color]) => {
      gradient.appendChild(svg("stop", { offset: offset, "stop-color": color }));
    });
    defs.appendChild(gradient);

    const clip = svg("clipPath", { id: clipId, clipPathUnits: "userSpaceOnUse" });
    bodyParts().forEach(part => clip.appendChild(svg("path", { d: part.d })));
    defs.appendChild(clip);
    root.appendChild(defs);

    /* Corpo: cada parte é desenhada com o próprio contorno, na ordem de trás
       para a frente. O contorno do braço sobre o tronco é o que separa os dois. */
    const body = svg("g", { class: "figura-body" });
    bodyParts().forEach(part => {
      body.appendChild(svg("path", {
        class: "figura-part figura-part-" + part.id,
        d: part.d,
        fill: "url(#" + clipId + "-volume)"
      }));
    });
    root.appendChild(body);

    const regionLayer = svg("g", { class: "figura-regions", "clip-path": "url(#" + clipId + ")" });

    const roleRank = { stabilizer: 0, secondary: 1, primary: 2, focus: 3 };
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
        group.setAttribute("aria-label",
          REGIONS[regionId].label + ", " + ROLE_NAMES[role] + (focused ? ", selecionada" : "") + ". " + VIEWS[view] + ".");
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

      shapes.forEach(pathData => {
        group.appendChild(svg("path", { class: "figura-region-shape", d: pathData }));
      });

      if (settings.interactive) {
        shapes.forEach(pathData => {
          group.appendChild(svg("path", { class: "figura-region-hit", d: pathData }));
        });
      }

      regionLayer.appendChild(group);
    });

    root.appendChild(regionLayer);

    if (!settings.compact) {
      const details = svg("g", { class: "figura-details", "clip-path": "url(#" + clipId + ")" });
      (DETAIL_LINES[view] || []).forEach(line => {
        details.appendChild(svg("path", { d: line.d, class: line.className }));
      });
      root.appendChild(details);
    }

    wrapper.appendChild(root);
    return wrapper;
  }

  /*
    Texto alternativo do destaque. Lista só as regiões que existem NA VISTA
    pedida (o peitoral não aparece na vista posterior, por exemplo) e nunca
    depende só da cor.
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
    VIEWBOX,
    ROLE_NAMES,
    REGIONS,
    render,
    describe,
    regionsInView,
    shapesFor
  };
})(window);
