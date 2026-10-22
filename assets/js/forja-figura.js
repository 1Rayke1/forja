/*
  FORJA — figura humana vetorial (vistas anterior e posterior).

  Este módulo desenha SÓ o corpo e as regiões musculares. Ele não conhece
  catálogo, exercícios nem páginas: recebe um mapa `região → papel` já
  calculado e devolve um `<svg>`. Quem decide o papel é o catálogo
  (ver `forja-atlas.js`), então não há duas fontes de verdade.

  Como o desenho é feito:
  - cada membro é gerado a partir de uma linha média com meia-largura em cada
    ponto (ombro → cotovelo → punho, quadril → joelho → tornozelo). O contorno
    é a curva que passa pelos deslocamentos perpendiculares dessa linha, então
    o volume é contínuo e as extremidades afinam de verdade (punho, tornozelo);
  - o contorno geral é suavizado por Catmull-Rom convertido em curvas de Bézier;
  - a silhueta é montada em duas camadas (traço grosso embaixo, preenchimento em
    cima) para que os encontros entre tronco e membros não deixem costuras;
  - as regiões musculares são formas fechadas suavizadas, recortadas pela
    silhueta com `clipPath`. Assim o destaque acompanha o corpo em vez de virar
    um círculo solto em cima dele.

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
  /* Geometria: linha média com volume → contorno orgânico              */
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

  /* Catmull-Rom fechado: usado nas formas de região (peitoral, abdômen…). */
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

  /* Contorno de um membro: desce por um lado, volta pelo outro. */
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
    Recorta um trecho do membro entre duas alturas (as linhas médias são
    verticais o bastante para isso) e devolve o contorno com uma margem
    interna, para o destaque não encostar na borda do corpo.
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
  /* Corpo: linhas médias com volume                                    */
  /* ------------------------------------------------------------------ */

  /*
    Tronco: trapézio descendo do pescoço para o ombro, tórax largo, cintura
    marcada, pelve e virilha. A pelve é mais estreita que o tórax, como no
    corpo humano — é isso que separa visualmente as pernas do tronco.
  */
  const TORSO = [
    { x: 120, y: 78, w: 9 },
    { x: 120, y: 84, w: 16 },
    { x: 120, y: 90, w: 26 },
    { x: 120, y: 96, w: 34 },
    { x: 120, y: 104, w: 39 },
    { x: 120, y: 114, w: 41.5 },
    { x: 120, y: 126, w: 42 },
    { x: 120, y: 140, w: 40 },
    { x: 120, y: 156, w: 36 },
    { x: 120, y: 172, w: 32.5 },
    { x: 120, y: 188, w: 33 },
    { x: 120, y: 206, w: 36 },
    { x: 120, y: 220, w: 36.5 },
    { x: 120, y: 232, w: 36 },
    { x: 120, y: 243, w: 30 },
    { x: 120, y: 251, w: 21 },
    { x: 120, y: 257, w: 12 }
  ];

  /* Braço: deltoide → bíceps → cotovelo → antebraço → punho (afina de verdade). */
  const ARM_LEFT = [
    { x: 77, y: 92, w: 4 },
    { x: 75, y: 98, w: 11 },
    { x: 71, y: 106, w: 13.5 },
    { x: 68, y: 118, w: 13.5 },
    { x: 66, y: 132, w: 12.5 },
    { x: 64, y: 146, w: 11.5 },
    { x: 63, y: 164, w: 12 },
    { x: 63, y: 188, w: 10.5 },
    { x: 64, y: 212, w: 9 },
    { x: 65, y: 232, w: 7 },
    { x: 66, y: 243, w: 6 }
  ];
  /* Perna: quadril → coxa → joelho → panturrilha → tornozelo. */
  const LEG_LEFT = [
    { x: 100, y: 236, w: 13 },
    { x: 100, y: 252, w: 17 },
    { x: 99, y: 270, w: 18 },
    { x: 99, y: 288, w: 17.5 },
    { x: 100, y: 310, w: 16 },
    { x: 101, y: 332, w: 13.5 },
    { x: 103, y: 352, w: 12 },
    { x: 103, y: 372, w: 13 },
    { x: 103, y: 390, w: 15 },
    { x: 104, y: 412, w: 13 },
    { x: 105, y: 436, w: 9.5 },
    { x: 105, y: 456, w: 7.5 },
    { x: 106, y: 468, w: 7 }
  ];

  /* Cabeça: crânio arredondado, maçãs do rosto e mandíbula afunilando. */
  const HEAD = "M120,12 C132.5,12 143,21.5 144.5,36 C145.5,46 143.5,54 140,60 " +
    "C137,65 131.5,70.5 126,72.5 C123.6,73.3 121.6,73.5 120,73.5 " +
    "C118.4,73.5 116.4,73.3 114,72.5 C108.5,70.5 103,65 100,60 " +
    "C96.5,54 94.5,46 95.5,36 C97,21.5 107.5,12 120,12 Z";

  /* Pescoço com trapézio subindo para os ombros (sem tubo reto). */
  const NECK = "M108,57 C109.5,68 107.5,76 104.5,84 C110,90.5 130,90.5 135.5,84 " +
    "C132.5,76 130.5,68 132,57 C127.5,64 112.5,64 108,57 Z";

  /* Mão: punho estreito, dorso, dedos fechados e polegar marcado do lado de dentro. */
  const HAND_LEFT = "M66,241 C62,247 59.5,258 59,269 C58.5,279 60,289 63.5,293 " +
    "C66,296 69.5,295 71,291 C73,286 72.5,277 72,269 " +
    "C71.5,261 71,252 71,246 C71,242 69,240.5 66,241 Z";

  /* Pé: calcanhar estreito e dorso abrindo para a caixa dos dedos, à frente. */
  const FOOT_LEFT = "M106,466 C100,465.5 94,468 92,474 C90,480 92,490 96,496.5 " +
    "C99,501 104,502.5 108.5,501.5 C112.5,500.5 115.5,496.5 116,491 " +
    "C116.5,484 116,476 114,470.5 C112,466.5 109,466 106,466 Z";

  /* Lado direito = espelho do esquerdo; o SVG faz isso com uma transformação. */
  const MIRROR = "translate(240,0) scale(-1,1)";

  function partPath(part) {
    return part.transform ? { d: part.d, transform: part.transform } : { d: part.d };
  }

  function bodyParts() {
    return [
      { id: "head", d: HEAD },
      { id: "neck", d: NECK },
      { id: "torso", d: limb(TORSO) },
      { id: "arm-left", d: limb(ARM_LEFT) },
      { id: "arm-right", d: limb(mirror(ARM_LEFT)) },
      { id: "hand-left", d: HAND_LEFT },
      { id: "hand-right", d: HAND_LEFT, transform: MIRROR },
      { id: "leg-left", d: limb(LEG_LEFT) },
      { id: "leg-right", d: limb(mirror(LEG_LEFT)) },
      { id: "foot-left", d: FOOT_LEFT },
      { id: "foot-right", d: FOOT_LEFT, transform: MIRROR }
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

  /* Deltoide: cobre a articulação do ombro, do acrômio até a inserção no braço. */
  const DELTOID = [
    { x: 80, y: 96 }, { x: 71, y: 94 }, { x: 63, y: 98 }, { x: 58, y: 106 },
    { x: 57, y: 117 }, { x: 60, y: 126 }, { x: 67, y: 131 }, { x: 76, y: 130 },
    { x: 80, y: 124 }, { x: 74, y: 117 }, { x: 74, y: 105 }
  ];

  /* Peitoral: placa larga sob a clavícula, borda inferior quase reta. */
  const PEC = [
    { x: 118, y: 99 }, { x: 111, y: 95 }, { x: 102, y: 94.5 }, { x: 94, y: 97.5 },
    { x: 88, y: 104 }, { x: 84, y: 114 }, { x: 84, y: 124 }, { x: 88, y: 132 },
    { x: 95, y: 136.5 }, { x: 104, y: 137 }, { x: 112, y: 134 }, { x: 118, y: 126 }
  ];

  const ABS = [
    { x: 106, y: 146 }, { x: 113, y: 142 }, { x: 127, y: 142 }, { x: 134, y: 146 },
    { x: 135, y: 160 }, { x: 133, y: 180 }, { x: 130, y: 198 }, { x: 125, y: 207 },
    { x: 120, y: 209 }, { x: 115, y: 207 }, { x: 110, y: 198 }, { x: 107, y: 180 },
    { x: 105, y: 160 }
  ];

  const OBLIQUE = [
    { x: 95, y: 150 }, { x: 102, y: 148 }, { x: 102, y: 170 }, { x: 100, y: 194 },
    { x: 96, y: 210 }, { x: 88, y: 214 }, { x: 84, y: 198 }, { x: 85, y: 176 },
    { x: 88, y: 160 }
  ];

  const HIP = [
    { x: 86, y: 214 }, { x: 100, y: 217 }, { x: 120, y: 220 }, { x: 140, y: 217 },
    { x: 154, y: 214 }, { x: 157, y: 226 }, { x: 151, y: 236 }, { x: 136, y: 240 },
    { x: 120, y: 241 }, { x: 104, y: 240 }, { x: 89, y: 236 }, { x: 83, y: 226 }
  ];

  const UPPER_BACK = [
    { x: 98, y: 92 }, { x: 108, y: 96 }, { x: 120, y: 98 }, { x: 132, y: 96 },
    { x: 142, y: 92 }, { x: 148, y: 104 }, { x: 146, y: 120 }, { x: 138, y: 130 },
    { x: 120, y: 134 }, { x: 102, y: 130 }, { x: 94, y: 120 }, { x: 92, y: 104 }
  ];

  const LAT = [
    { x: 94, y: 116 }, { x: 104, y: 122 }, { x: 106, y: 146 }, { x: 104, y: 170 },
    { x: 99, y: 184 }, { x: 91, y: 180 }, { x: 85, y: 160 }, { x: 84, y: 134 }
  ];

  const LOWER_BACK = [
    { x: 106, y: 162 }, { x: 120, y: 159 }, { x: 134, y: 162 }, { x: 136, y: 178 },
    { x: 135, y: 194 }, { x: 129, y: 202 }, { x: 120, y: 204 }, { x: 111, y: 202 },
    { x: 105, y: 194 }, { x: 104, y: 178 }
  ];

  const GLUTE = [
    { x: 97, y: 203 }, { x: 110, y: 200 }, { x: 117, y: 208 }, { x: 118, y: 222 },
    { x: 113, y: 234 }, { x: 103, y: 238 }, { x: 95, y: 232 }, { x: 92, y: 218 }
  ];

  /*
    Cada região declara os desenhos que a representam. `both` vale nas duas
    vistas (ombros e pernas aparecem de frente e de costas), `front`/`back` só
    na sua vista. `segment` usa a linha média do membro para acompanhar o
    volume real do braço/perna.
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
      front: [segment(ARM_LEFT, 124, 184, 2.4), segment(mirror(ARM_LEFT), 124, 184, 2.4)]
    },
    antebracos: {
      label: "Antebraços",
      both: [segment(ARM_LEFT, 198, 256, 1.6), segment(mirror(ARM_LEFT), 198, 256, 1.6)]
    },
    abdomem: {
      label: "Abdômen",
      front: [ring(ABS)]
    },
    obliquos: {
      label: "Oblíquos",
      front: [ring(OBLIQUE), mirroredRing(OBLIQUE)]
    },
    quadril: {
      label: "Quadril",
      front: [ring(HIP)]
    },
    quadriceps: {
      label: "Quadríceps",
      front: [segment(LEG_LEFT, 258, 372, 4), segment(mirror(LEG_LEFT), 258, 372, 4)]
    },
    pernas: {
      label: "Pernas",
      both: [
        segment(LEG_LEFT, 256, 460, 3.2), segment(mirror(LEG_LEFT), 256, 460, 3.2)
      ]
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
      back: [segment(ARM_LEFT, 122, 190, 2.4), segment(mirror(ARM_LEFT), 122, 190, 2.4)]
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
      back: [segment(LEG_LEFT, 250, 366, 4), segment(mirror(LEG_LEFT), 250, 366, 4)]
    },
    panturrilha: {
      label: "Panturrilha",
      back: [segment(LEG_LEFT, 386, 452, 4), segment(mirror(LEG_LEFT), 386, 452, 4)]
    }
  };

  /* Detalhes discretos (linhas de referência), recortados pela silhueta. */
  const DETAIL_LINES = {
    front: [
      { d: "M120,96 C119.5,124 120,158 120,214", className: "figura-line-strong" },
      { d: "M107,100 C112,104 128,104 133,100", className: "figura-line" },
      { d: "M104,168 C112,170 128,170 136,168", className: "figura-line" },
      { d: "M104,186 C112,188 128,188 136,186", className: "figura-line" },
      { d: "M86,150 C90,158 91,170 90,182", className: "figura-line" },
      { d: "M154,150 C150,158 149,170 150,182", className: "figura-line" },
      { d: "M58,146 C55,148 53,150 52,154", className: "figura-line" },
      { d: "M182,146 C185,148 187,150 188,154", className: "figura-line" },
      { d: "M98,368 C101,366 106,366 108,368", className: "figura-line" },
      { d: "M132,368 C134,366 139,366 142,368", className: "figura-line" }
    ],
    back: [
      { d: "M120,92 C119,130 120,170 120,226", className: "figura-line-strong" },
      { d: "M98,106 C107,118 112,130 114,142", className: "figura-line" },
      { d: "M142,106 C133,118 128,130 126,142", className: "figura-line" },
      { d: "M104,196 C110,200 130,200 136,196", className: "figura-line" },
      { d: "M98,368 C101,366 106,366 108,368", className: "figura-line" },
      { d: "M132,368 C134,366 139,366 142,368", className: "figura-line" }
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

    const defs = svg("defs", {});
    const clip = svg("clipPath", { id: clipId, clipPathUnits: "userSpaceOnUse" });
    bodyParts().forEach(part => clip.appendChild(svg("path", partPath(part))));
    defs.appendChild(clip);
    root.appendChild(defs);

    /* Traço por baixo: a união das partes vira um contorno só, sem costuras. */
    const outline = svg("g", { class: "figura-outline" });
    bodyParts().forEach(part => outline.appendChild(svg("path", partPath(part))));
    root.appendChild(outline);

    const base = svg("g", { class: "figura-base" });
    bodyParts().forEach(part => base.appendChild(svg("path", partPath(part))));
    root.appendChild(base);

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
