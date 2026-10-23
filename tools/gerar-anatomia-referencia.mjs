#!/usr/bin/env node
/*
  FORJA — Gerador das Pranchas Anatômicas de Referência e Contornos SVG
  =====================================================================
  Processa as duas imagens de referência anexadas pelo usuário (vista anterior
  e vista posterior):
  1. Recorta o quadro anatômico quadrado original (1080 × 1080 px, y = 660..1739),
     preservando 100% da proporção original 1:1 sem cortes na cabeça, mãos ou
     região visível das coxas.
  2. Isola o fundo branco externo via flood-fill a partir das bordas com
     suavização anti-aliasing de 1 px, preservando tendões, fáscia toracolombar,
     retináculos dos punhos e aponeurose epicrânica internos.
  3. Extrai as máscaras exatas dos destaques vermelhos originais (`peito` na
     vista anterior e `dorsais` na vista posterior) antes de neutralizar a
     crominância quente para o tom grafite/cinza-anatômico neutro das fibras,
     permitindo que qualquer exercício destaque qualquer região dinamicamente.
  4. Codifica `assets/anatomia/anterior.png` e `assets/anatomia/posterior.png`
     em PNG indexado de 8 bits (480 × 480 px, Retina 2× sobre `viewBox="0 0 240 240"`).
  5. Gera os contornos SVG em curvas de Bézier cúbicas fechadas (`SILHOUETTES`
     e `REGIONS`) recortados contra a máscara exata da silhueta corporal.

  Uso:
    node tools/gerar-anatomia-referencia.mjs
*/

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'anatomia');
const SRC_DIR = process.env.ANATOMY_REF_DIR || '/tmp/arena-coding-uploads';

const FILES = {
  front: path.join(SRC_DIR, 'Screenshot_2026-10-22-09-47-24-088_com.openai.chatgpt.jpg'),
  back: path.join(SRC_DIR, 'Screenshot_2026-10-22-09-47-28-204_com.openai.chatgpt.jpg'),
};

const W = 480;
const H = 480;
const SCALE_X = 240 / W;
const SCALE_Y = 240 / H;

// ---------------------------------------------------------------------------
// Codificador PNG 8-bit indexado (PLTE + tRNS + IDAT) sem dependências externas
// ---------------------------------------------------------------------------
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodeIndexedPNG(rgba, w, h) {
  const sumR = new Float64Array(256);
  const sumG = new Float64Array(256);
  const sumB = new Float64Array(256);
  const cnt = new Uint32Array(256);

  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (rgba[i + 3] < 240) continue;
    const g = rgba[i + 1];
    sumR[g] += rgba[i];
    sumG[g] += rgba[i + 1];
    sumB[g] += rgba[i + 2];
    cnt[g]++;
  }

  const lutR = new Uint8Array(256);
  const lutG = new Uint8Array(256);
  const lutB = new Uint8Array(256);
  for (let g = 0; g < 256; g++) {
    if (cnt[g] > 0) {
      lutR[g] = Math.round(sumR[g] / cnt[g]);
      lutG[g] = Math.round(sumG[g] / cnt[g]);
      lutB[g] = Math.round(sumB[g] / cnt[g]);
    } else {
      lutR[g] = Math.min(255, Math.round(g * 1.045));
      lutG[g] = g;
      lutB[g] = Math.round(g * 0.985);
    }
  }

  const pal = [[0, 0, 0, 0]];
  for (let k = 1; k <= 220; k++) {
    const g = Math.round(((k - 1) / 219) * 255);
    pal.push([lutR[g], lutG[g], lutB[g], 255]);
  }
  const edgeAlphas = [36, 84, 132, 180, 224];
  const edgeGs = [40, 80, 120, 160, 195, 225, 244];
  for (const a of edgeAlphas) {
    for (const g of edgeGs) {
      pal.push([lutR[g], lutG[g], lutB[g], a]);
    }
  }

  const plte = Buffer.alloc(pal.length * 3);
  const trns = Buffer.alloc(pal.length);
  for (let i = 0; i < pal.length; i++) {
    plte[i * 3]     = pal[i][0];
    plte[i * 3 + 1] = pal[i][1];
    plte[i * 3 + 2] = pal[i][2];
    trns[i]         = pal[i][3];
  }

  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) {
    const rowOff = y * (w + 1);
    raw[rowOff] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = rgba[i + 3];
      if (a < 18) {
        raw[rowOff + 1 + x] = 0;
        continue;
      }
      const g = rgba[i + 1];
      if (a >= 238) {
        raw[rowOff + 1 + x] = 1 + Math.max(0, Math.min(219, Math.round((g / 255) * 219)));
      } else {
        let ai = 0, bestAd = 999;
        for (let k = 0; k < edgeAlphas.length; k++) {
          const d = Math.abs(a - edgeAlphas[k]);
          if (d < bestAd) { bestAd = d; ai = k; }
        }
        let gi = 0, bestGd = 999;
        for (let k = 0; k < edgeGs.length; k++) {
          const d = Math.abs(g - edgeGs[k]);
          if (d < bestGd) { bestGd = d; gi = k; }
        }
        raw[rowOff + 1 + x] = 221 + ai * edgeGs.length + gi;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('PLTE', plte),
    pngChunk('tRNS', trns),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Extração de contornos SVG (Marching Squares + RDP + Curvas de Bézier)
// ---------------------------------------------------------------------------
function blurMask(src, w, h, radius = 2) {
  if (radius <= 0) return Float32Array.from(src);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const diam = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += src[row + Math.max(0, Math.min(w - 1, x + k))];
      tmp[row + x] = s / diam;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += tmp[Math.max(0, Math.min(h - 1, y + k)) * w + x];
      out[y * w + x] = s / diam;
    }
  }
  return out;
}

function morphClose(mask, w, h, r = 3) {
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let found = 0;
      for (let dy = -r; dy <= r && !found; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w && dx * dx + dy * dy <= r * r && mask[ny * w + nx] > 0) {
            found = 255;
            break;
          }
        }
      }
      dil[y * w + x] = found;
    }
  }
  const ero = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = 255;
      for (let dy = -r; dy <= r && all; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) { all = 0; break; }
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || (dx * dx + dy * dy <= r * r && dil[ny * w + nx] === 0)) {
            all = 0;
            break;
          }
        }
      }
      ero[y * w + x] = all;
    }
  }
  return ero;
}

function marchingSquares(field, w, h, threshold = 110) {
  const f = Float32Array.from(field);
  for (let x = 0; x < w; x++) { f[x] = 0; f[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { f[y * w] = 0; f[y * w + (w - 1)] = 0; }

  const segs = [];
  const interp = (v1, v2) => {
    const d = v2 - v1;
    return Math.abs(d) < 1e-5 ? 0.5 : Math.max(0.02, Math.min(0.98, (threshold - v1) / d));
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v0 = f[y * w + x], v1 = f[y * w + x + 1], v2 = f[(y + 1) * w + x + 1], v3 = f[(y + 1) * w + x];
      const c = (v0 >= threshold ? 8 : 0) | (v1 >= threshold ? 4 : 0) | (v2 >= threshold ? 2 : 0) | (v3 >= threshold ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const top = [x + interp(v0, v1), y], right = [x + 1, y + interp(v1, v2)];
      const bottom = [x + interp(v3, v2), y + 1], left = [x, y + interp(v0, v3)];
      const center = (v0 + v1 + v2 + v3) * 0.25 >= threshold;
      switch (c) {
        case 1:  segs.push([left, bottom]); break;
        case 2:  segs.push([bottom, right]); break;
        case 3:  segs.push([left, right]); break;
        case 4:  segs.push([right, top]); break;
        case 5:  if (center) { segs.push([left, top], [bottom, right]); } else { segs.push([left, bottom], [right, top]); } break;
        case 6:  segs.push([bottom, top]); break;
        case 7:  segs.push([left, top]); break;
        case 8:  segs.push([top, left]); break;
        case 9:  segs.push([top, bottom]); break;
        case 10: if (center) { segs.push([top, right], [bottom, left]); } else { segs.push([top, left], [bottom, right]); } break;
        case 11: segs.push([top, right]); break;
        case 12: segs.push([right, left]); break;
        case 13: segs.push([right, bottom]); break;
        case 14: segs.push([bottom, left]); break;
      }
    }
  }
  const key = p => `${Math.round(p[0] * 64)},${Math.round(p[1] * 64)}`;
  const startMap = new Map();
  segs.forEach((s, idx) => {
    const k = key(s[0]);
    if (!startMap.has(k)) startMap.set(k, []);
    startMap.get(k).push(idx);
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const poly = [segs[i][0], segs[i][1]];
    while (true) {
      const list = startMap.get(key(poly[poly.length - 1]));
      if (!list) break;
      let nextIdx = -1;
      for (const cand of list) { if (!used[cand]) { nextIdx = cand; break; } }
      if (nextIdx === -1) break;
      used[nextIdx] = 1;
      poly.push(segs[nextIdx][1]);
    }
    if (poly.length > 4) loops.push(poly);
  }
  return loops;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a * 0.5;
}

function simplifyRDP(pts, eps) {
  if (pts.length <= 3) return pts;
  let maxDist = 0, idx = 0;
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const t = len2 > 1e-8 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
    const dist = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    if (dist > maxDist) { maxDist = dist; idx = i; }
  }
  if (maxDist > eps) {
    return simplifyRDP(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplifyRDP(pts.slice(idx), eps));
  }
  return [pts[0], pts[pts.length - 1]];
}

function simplifyClosedLoop(loop, eps = 0.85) {
  const pts = loop.slice(0, -1);
  if (pts.length < 6) return pts;
  let farIdx = 1, maxD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > maxD) { maxD = d; farIdx = i; }
  }
  const h1 = simplifyRDP(pts.slice(0, farIdx + 1), eps);
  const h2 = simplifyRDP(pts.slice(farIdx).concat([pts[0]]), eps);
  return h1.slice(0, -1).concat(h2.slice(0, -1));
}

function closedBezierPath(loops, tension = 0.19) {
  const parts = [];
  const f = v => Number(v.toFixed(1));
  for (const pts of loops) {
    const n = pts.length;
    if (n < 3) continue;
    const sp = pts.map(([x, y]) => [x * SCALE_X, y * SCALE_Y]);
    let d = `M${f(sp[0][0])} ${f(sp[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = sp[(i - 1 + n) % n], p1 = sp[i], p2 = sp[(i + 1) % n], p3 = sp[(i + 2) % n];
      d += `C${f(p1[0] + (p2[0] - p0[0]) * tension)} ${f(p1[1] + (p2[1] - p0[1]) * tension)} ` +
           `${f(p2[0] - (p3[0] - p1[0]) * tension)} ${f(p2[1] - (p3[1] - p1[1]) * tension)} ` +
           `${f(p2[0])} ${f(p2[1])}`;
    }
    parts.push(d + 'Z');
  }
  return parts.join('');
}

function maskToSvgPath(maskBytes, opts = {}) {
  const { blurRadius = 2, threshold = 115, minArea = 35, rdpEps = 0.85 } = opts;
  const blurred = blurMask(maskBytes, W, H, blurRadius);
  const cleanLoops = [];
  for (const loop of marchingSquares(blurred, W, H, threshold)) {
    if (Math.abs(polyArea(loop)) < minArea) continue;
    const simp = simplifyClosedLoop(loop, rdpEps);
    if (simp.length >= 3) cleanLoops.push(simp);
  }
  return closedBezierPath(cleanLoops, 0.19);
}

// Polígonos complementares para sombras escuras nas bordas de peito/dorsais
const RED_SHADOW_FILL = {
  front: [
    [82.5, 108], [83.2, 118.5], [86.5, 123.5], [93, 125.8], [101.5, 125.8],
    [108.5, 123.5], [114.5, 121], [117.5, 118], [117.5, 106],
  ],
  back: [
    [87.5, 108.5], [104, 109], [110, 122], [113, 134], [105, 156], [100, 168.5],
    [97, 168.5], [92, 152], [88, 134], [85.5, 120],
  ],
};

// Polígonos anatômicos no espaço 0..240 × 0..240 (recortados por fgMask e máscaras vizinhas)
const REGION_POLYS = {
  front: {
    ombros: {
      mirror: true,
      poly: [
        [92, 81.5], [83, 79.5], [73, 82.5], [66, 89.5], [62, 100], [61.5, 113], [62.5, 123.5],
        [66.2, 118.5], [70.2, 111.5], [75.2, 104], [80.5, 98.5], [82, 93], [86, 87], [92, 81.5],
      ],
      subtractRed: true,
    },
    biceps: {
      mirror: true,
      poly: [
        [80.5, 98.5], [75.2, 104], [70.2, 111.5], [66.2, 118.5], [62.5, 123.5],
        [59.5, 131], [56.5, 140], [56, 145], [58.5, 149.5], [61.5, 154], [64.5, 155],
        [67.5, 151], [71, 146], [74.5, 138], [78.5, 127], [81, 115], [81.5, 104],
      ],
      subtractRed: true,
      subtractRegions: ['ombros'],
    },
    antebracos: {
      mirror: true,
      poly: [
        [57.5, 138], [54, 144], [48, 156], [41, 173], [35, 191.2],
        [41.5, 194.2], [48.8, 197.5],
        [55, 185], [61, 172], [67, 159], [71.5, 148],
        [67.5, 151], [64.5, 155], [61.5, 154], [58.5, 149.5],
      ],
      subtractRegions: ['biceps'],
    },
    abdomem: {
      mirror: false,
      poly: [
        [120, 120.5], [111, 119.5], [103.5, 122], [101.5, 127], [101.2, 137],
        [100.8, 148], [100.8, 159], [101.2, 170], [102.5, 181], [105, 193],
        [108.5, 205], [112.5, 215], [116.5, 221.5], [120, 222.5],
        [123.5, 221.5], [127.5, 215], [131.5, 205], [135, 193], [137.5, 181],
        [138.8, 170], [139.2, 159], [139.2, 148], [138.8, 137], [138.5, 127],
        [136.5, 122], [129, 119.5],
      ],
      subtractRed: true,
    },
    obliquos: {
      mirror: true,
      poly: [
        [81, 119], [103.5, 122], [101.5, 127], [101.2, 137], [100.8, 148],
        [100.8, 159], [101.2, 170], [102.5, 181], [104.2, 189],
        [98.5, 188.5], [93, 185], [87.5, 181.5], [86, 165], [84, 145], [81, 128],
      ],
      subtractRed: true,
      subtractRegions: ['abdomem'],
    },
    quadril: {
      mirror: true,
      poly: [
        [87.5, 181.5], [93, 185], [98.5, 188.5], [104.2, 189],
        [105, 193], [108.5, 205], [112, 214], [106, 214],
        [99, 204], [91.5, 194.5], [86, 205], [81, 207], [83, 193],
      ],
      subtractRegions: ['abdomem', 'obliquos'],
    },
    quadriceps: {
      mirror: true,
      poly: [
        [91.5, 194.5], [99, 204], [106, 214], [112, 214], [115, 222], [115, 239.8],
        [76, 239.8], [81, 207], [86, 205],
      ],
      subtractRegions: ['quadril', 'abdomem'],
    },
    pernas: {
      mirror: true,
      poly: [
        [87.5, 182], [95, 187], [104, 190], [109, 206], [115, 221], [116, 239.8],
        [75, 239.8], [82, 200],
      ],
      subtractRegions: ['abdomem', 'obliquos'],
    },
  },
  back: {
    costas: {
      mirror: false,
      poly: [
        [120, 60], [111, 60.5], [106.5, 66], [101, 70.5], [89, 73], [83, 75],
        [90, 79], [89, 88], [86, 98], [85.5, 108],
        [104, 109], [111, 122], [116.5, 136], [120, 147],
        [123.5, 136], [129, 122], [136, 109],
        [154.5, 108], [154, 98], [151, 88], [150, 79],
        [157, 75], [151, 73], [139, 70.5], [133.5, 66], [129, 60.5],
      ],
      subtractRed: true,
    },
    ombros: {
      mirror: true,
      poly: [
        [84, 74.5], [76, 77], [71, 85], [68, 96], [67.5, 107.5],
        [74.5, 103.5], [81.5, 97], [86, 92], [89, 86], [90, 79],
      ],
      subtractRegions: ['costas'],
    },
    triceps: {
      mirror: true,
      poly: [
        [67.5, 107.5], [74.5, 103.5], [81.5, 97], [86, 92],
        [86.5, 102], [84, 111], [78.5, 123], [73, 136], [68.2, 146.5],
        [64, 147], [60.2, 143], [58.5, 136.5], [62, 124], [65, 114],
      ],
      subtractRed: true,
      subtractRegions: ['ombros', 'costas'],
    },
    antebracos: {
      mirror: true,
      poly: [
        [58.5, 136.5], [60.2, 143], [64, 147], [68.2, 146.5],
        [64.5, 156], [59.5, 169], [54.2, 182.5],
        [48.5, 181], [43, 178.5],
        [47, 165], [52.5, 150],
      ],
      subtractRegions: ['triceps'],
    },
    lombar: {
      mirror: false,
      poly: [
        [120, 134], [116, 136], [108, 152], [100, 169.5],
        [95, 169], [104, 173], [114, 181], [120, 186.5],
        [126, 181], [136, 173], [145, 169],
        [140, 169.5], [132, 152], [124, 136],
      ],
      subtractRed: true,
      subtractRegions: ['costas'],
    },
    gluteos: {
      mirror: true,
      poly: [
        [88, 168.5], [95, 169], [104, 173], [114, 181], [119.0, 186.5],
        [119.0, 217], [114, 222], [104, 223], [93, 220], [84.5, 214],
        [81, 200], [83, 183],
      ],
      subtractRed: true,
      subtractRegions: ['lombar'],
    },
    'posterior-coxa': {
      mirror: true,
      poly: [
        [84.5, 214], [93, 220], [104, 223], [114, 222], [116, 223],
        [115, 239.8], [80, 239.8], [81.5, 220],
      ],
      subtractRegions: ['gluteos'],
    },
    pernas: {
      mirror: true,
      poly: [
        [81.5, 208], [93, 220], [104, 223], [114, 222], [116, 223],
        [116, 239.8], [79, 239.8],
      ],
      subtractRegions: ['gluteos'],
    },
  },
};

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--disable-gpu'],
  headless: true,
});

try {
  const page = await browser.newPage();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const silhouettes = {};
  const regionsByView = { front: {}, back: {} };

  for (const [view, fp] of Object.entries(FILES)) {
    if (!fs.existsSync(fp)) {
      throw new Error(`Imagem de referência não encontrada: ${fp}`);
    }
    const b64 = fs.readFileSync(fp).toString('base64');

    const viewData = await page.evaluate(async (src, W, H, shadowPoly) => {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + src;
      await img.decode();
      const S = 1080;
      const c = document.createElement('canvas');
      c.width = S;
      c.height = S;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 660, S, S, 0, 0, S, S);
      const imgData = ctx.getImageData(0, 0, S, S);
      const d = imgData.data;

      const bgMask = new Uint8Array(S * S);
      const queue = new Int32Array(S * S);
      let qHead = 0, qTail = 0;

      const isWhiteBg = (idx) => {
        const i = idx * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        return r >= 246 && g >= 246 && b >= 246 && Math.max(r, g, b) - Math.min(r, g, b) <= 6;
      };

      const pushIfBg = (x, y) => {
        if (x < 0 || x >= S || y < 0 || y >= S) return;
        const idx = y * S + x;
        if (bgMask[idx]) return;
        if (isWhiteBg(idx)) {
          bgMask[idx] = 1;
          queue[qTail++] = idx;
        }
      };

      for (let x = 0; x < S; x++) { pushIfBg(x, 0); pushIfBg(x, S - 1); }
      for (let y = 0; y < S; y++) { pushIfBg(0, y); pushIfBg(S - 1, y); }

      while (qHead < qTail) {
        const idx = queue[qHead++];
        const x = idx % S, y = (idx / S) | 0;
        pushIfBg(x - 1, y); pushIfBg(x + 1, y);
        pushIfBg(x, y - 1); pushIfBg(x, y + 1);
      }

      const alpha = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) alpha[i] = bgMask[i] ? 0.0 : 1.0;

      for (let y = 1; y < S - 1; y++) {
        for (let x = 1; x < S - 1; x++) {
          const idx = y * S + x;
          if (bgMask[idx]) continue;
          if (bgMask[idx - 1] || bgMask[idx + 1] || bgMask[idx - S] || bgMask[idx + S]) {
            const i = idx * 4;
            const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
            if (lum >= 241) {
              alpha[idx] = Math.max(0.08, (248 - lum) / 7);
            }
          }
        }
      }

      const redMask1080 = new Uint8Array(S * S);
      for (let idx = 0; idx < S * S; idx++) {
        if (alpha[idx] === 0) {
          d[idx * 4] = 0;
          d[idx * 4 + 1] = 0;
          d[idx * 4 + 2] = 0;
          d[idx * 4 + 3] = 0;
          continue;
        }
        const i = idx * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const warmExcess = Math.max(r - g * 1.05, r - b * 1.07, g - b * 1.04);
        const relRed = (r - g * 1.04) / Math.max(g, 20);
        if ((warmExcess > 14 && r > 70) || (relRed > 0.17 && (r - g) > 8 && r > 42)) {
          redMask1080[idx] = 255;
        }
        if (warmExcess > 5) {
          const w = Math.min(1, (warmExcess - 5) / 15);
          const fiberLum = 0.34 * r + 0.52 * g + 0.14 * b;
          const nr = Math.min(255, Math.round(fiberLum * 1.045));
          const ng = Math.min(255, Math.round(fiberLum * 1.000));
          const nb = Math.min(255, Math.round(fiberLum * 0.985));
          d[i]     = Math.round(r * (1 - w) + nr * w);
          d[i + 1] = Math.round(g * (1 - w) + ng * w);
          d[i + 2] = Math.round(b * (1 - w) + nb * w);
        }
        d[i + 3] = Math.round(alpha[idx] * 255);
      }
      ctx.putImageData(imgData, 0, 0);

      const outC = document.createElement('canvas');
      outC.width = W;
      outC.height = H;
      const outCtx = outC.getContext('2d');
      outCtx.imageSmoothingEnabled = true;
      outCtx.imageSmoothingQuality = 'high';
      outCtx.drawImage(c, 0, 0, W, H);
      const outData = outCtx.getImageData(0, 0, W, H).data;

      const fgMask = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) {
        fgMask[p] = outData[p * 4 + 3] >= 96 ? 255 : 0;
      }

      const redC = document.createElement('canvas');
      redC.width = S;
      redC.height = S;
      const redCtx = redC.getContext('2d');
      const redImg = redCtx.createImageData(S, S);
      for (let p = 0; p < S * S; p++) {
        const v = redMask1080[p];
        redImg.data[p * 4]     = v;
        redImg.data[p * 4 + 1] = v;
        redImg.data[p * 4 + 2] = v;
        redImg.data[p * 4 + 3] = 255;
      }
      redCtx.putImageData(redImg, 0, 0);

      const red480C = document.createElement('canvas');
      red480C.width = W;
      red480C.height = H;
      const red480Ctx = red480C.getContext('2d');
      red480Ctx.drawImage(redC, 0, 0, W, H);
      if (shadowPoly) {
        red480Ctx.fillStyle = '#ffffff';
        const drawP = (pts) => {
          red480Ctx.beginPath();
          pts.forEach(([x, y], i) => {
            const px = x * (W / 240), py = y * (H / 240);
            if (i === 0) red480Ctx.moveTo(px, py);
            else red480Ctx.lineTo(px, py);
          });
          red480Ctx.closePath();
          red480Ctx.fill();
        };
        drawP(shadowPoly);
        drawP(shadowPoly.map(([x, y]) => [240 - x, y]));
      }
      const red480Data = red480Ctx.getImageData(0, 0, W, H).data;
      const rawRedMask = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) {
        rawRedMask[p] = (red480Data[p * 4] >= 100 && fgMask[p]) ? 255 : 0;
      }

      return {
        rgba: Array.from(outData),
        fgMask: Array.from(fgMask),
        rawRedMask: Array.from(rawRedMask),
      };
    }, b64, W, H, RED_SHADOW_FILL[view]);

    const rgba = Uint8Array.from(viewData.rgba);
    const pngBuf = encodeIndexedPNG(rgba, W, H);
    const outName = view === 'front' ? 'anterior.png' : 'posterior.png';
    const outPath = path.join(OUT_DIR, outName);
    fs.writeFileSync(outPath, pngBuf);
    console.log(`[anatomia-ref] ${outName}: ${pngBuf.length} bytes (${W}×${H})`);

    const closedRed = morphClose(Uint8Array.from(viewData.rawRedMask), W, H, 3);
    for (let p = 0; p < W * H; p++) {
      if (!viewData.fgMask[p]) closedRed[p] = 0;
    }

    const regionMasks = await page.evaluate((W, H, fgMask, redMask, polys, viewName) => {
      const out = {};
      if (viewName === 'front') out.peito = redMask;
      if (viewName === 'back') out.dorsais = redMask;

      for (const [regId, spec] of Object.entries(polys)) {
        const rc = document.createElement('canvas');
        rc.width = W;
        rc.height = H;
        const rctx = rc.getContext('2d');
        rctx.fillStyle = '#ffffff';
        const drawPoly = (pts) => {
          rctx.beginPath();
          pts.forEach(([x, y], i) => {
            const px = x * (W / 240), py = y * (H / 240);
            if (i === 0) rctx.moveTo(px, py);
            else rctx.lineTo(px, py);
          });
          rctx.closePath();
          rctx.fill();
        };
        drawPoly(spec.poly);
        if (spec.mirror) {
          drawPoly(spec.poly.map(([x, y]) => [240 - x, y]));
        }
        const rData = rctx.getImageData(0, 0, W, H).data;
        const mask = new Uint8Array(W * H);
        for (let p = 0; p < W * H; p++) {
          let on = rData[p * 4 + 3] >= 128 && fgMask[p] > 0;
          if (on && spec.subtractRed && redMask[p] > 0) on = false;
          if (on && spec.subtractRegions) {
            for (const subId of spec.subtractRegions) {
              if (out[subId] && out[subId][p] > 0) { on = false; break; }
            }
          }
          mask[p] = on ? 255 : 0;
        }
        out[regId] = Array.from(mask);
      }
      return out;
    }, W, H, viewData.fgMask, Array.from(closedRed), REGION_POLYS[view], view);

    silhouettes[view] = maskToSvgPath(viewData.fgMask, {
      blurRadius: 1,
      threshold: 110,
      minArea: 40,
      rdpEps: 0.75,
    });
    for (const [regId, maskArr] of Object.entries(regionMasks)) {
      regionsByView[view][regId] = maskToSvgPath(maskArr, {
        blurRadius: 2,
        threshold: 115,
        minArea: 40,
        rdpEps: 0.85,
      });
    }
  }

  const outJson = { silhouettes, regionsByView };
  fs.writeFileSync('/tmp/contornos-referencia.json', JSON.stringify(outJson, null, 2));
  console.log('[anatomia-ref] Contornos salvos em /tmp/contornos-referencia.json');

  if (process.argv.includes('--contornos')) {
    const META = [
      ['ombros',         'Ombros',            ['front', 'back']],
      ['peito',          'Peitoral',          ['front']],
      ['biceps',         'Bíceps',            ['front']],
      ['antebracos',     'Antebraços',        ['front', 'back']],
      ['abdomem',        'Abdômen',           ['front']],
      ['obliquos',       'Oblíquos',          ['front']],
      ['quadril',        'Quadril',           ['front']],
      ['quadriceps',     'Quadríceps',        ['front']],
      ['pernas',         'Pernas',            ['front', 'back']],
      ['costas',         'Costas',            ['back']],
      ['dorsais',        'Dorsais',           ['back']],
      ['lombar',         'Lombar',            ['back']],
      ['triceps',        'Tríceps',           ['back']],
      ['gluteos',        'Glúteos',           ['back']],
      ['posterior-coxa', 'Posterior de coxa', ['back']],
      ['panturrilha',    'Panturrilha',       []],
    ];
    const regionsObj = {};
    for (const [id, label, views] of META) {
      const entry = { label };
      if (id === 'panturrilha') {
        entry.outsideFrame = true;
        entry.limitationNote = 'A prancha anatômica de referência possui enquadramento até a metade da coxa; a panturrilha situa-se abaixo do recorte visível.';
        entry.back = [];
      } else {
        for (const v of views) entry[v] = [regionsByView[v][id]];
      }
      regionsObj[id] = entry;
    }
    const figPath = path.join(ROOT, 'assets', 'js', 'forja-figura.js');
    let figCode = fs.readFileSync(figPath, 'utf8');
    figCode = figCode.replace(
      /const SILHOUETTES = Object\.freeze\(\{[\s\S]*?\}\);/,
      `const SILHOUETTES = Object.freeze(${JSON.stringify(silhouettes, null, 4).replace(/\n/g, '\n  ')});`
    );
    figCode = figCode.replace(
      /const REGIONS = \{[\s\S]*?\n  \};/,
      `const REGIONS = ${JSON.stringify(regionsObj, null, 4).replace(/\n/g, '\n  ')};`
    );
    fs.writeFileSync(figPath, figCode);
    console.log('[anatomia-ref] Contornos atualizados em assets/js/forja-figura.js');
  }
} finally {
  await browser.close();
}
