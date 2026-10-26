/*
  FORJA — P1.3: capturas e medições de referência (antes/depois).

  Sobe o repositório num servidor local sob /forja/ (igual ao GitHub Pages),
  congela o relógio do navegador, semeia dados sintéticos determinísticos e
  fotografa Início, Treinos, Explorar, Progresso e Perfil em
  320/360/390/430/768/1280 px. Também grava medições de tipografia, cartões,
  botões, grids, gráficos, overflow, alvos de toque e contraste, além de um
  snapshot de texto/storage para comparar os dados funcionais.

  Uso:
    npm install
    node tools/capturas-p13.mjs --out /tmp/forja-p13/antes
    node tools/capturas-p13.mjs --out /tmp/forja-p13/depois
    PUPPETEER_EXECUTABLE_PATH=/caminho/do/chrome node tools/capturas-p13.mjs --out /tmp/x

  O navegador e as bibliotecas do pacote @sparticuz/chromium são preparados
  automaticamente quando não existe um Chrome do sistema. Nenhum dado real é
  usado: o perfil do navegador é temporário.
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const WIDTHS = [320, 360, 390, 430, 768, 1280];
const HEIGHT = 844;
const FIXED_NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const DAY = 86400000;
const PAGES = [
  { id: 'inicio', path: '' },
  { id: 'treinos', path: 'treino/' },
  { id: 'explorar', path: 'explorar/' },
  { id: 'progresso', path: 'progresso/' },
  { id: 'perfil', path: 'perfil/' }
];
const ANCHORS = { inicio: '#home-goals', progresso: '#progress-weekly' };

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const outDir = path.resolve(arg('--out', path.join(os.tmpdir(), 'forja-p13')));
fs.mkdirSync(outDir, { recursive: true });
/* Remove só os arquivos desta ferramenta, para uma segunda execução não
   misturar capturas antigas com um conjunto novo. */
const SHOT_RE = /^(inicio|treinos|explorar|progresso|perfil)-\d+(?:-(?:meio|fim|detalhe|completa))?\.png$|^medicoes\.json$/;
for (const name of fs.readdirSync(outDir)) {
  if (SHOT_RE.test(name)) fs.rmSync(path.join(outDir, name));
}

/* Bibliotecas AL2023 do Chromium empacotado: extração apenas quando preciso. */
function prepareChromiumLibs() {
  const libDir = path.join(os.tmpdir(), 'forja-p13-libs', 'lib');
  const archive = path.join(repoRoot, 'node_modules', '@sparticuz', 'chromium', 'bin', 'al2023.tar.br');
  if (!fs.existsSync(path.join(libDir, 'libnspr4.so')) && fs.existsSync(archive)) {
    fs.mkdirSync(path.dirname(libDir), { recursive: true });
    const tarPath = path.join(os.tmpdir(), 'forja-p13-al2023.tar');
    fs.writeFileSync(tarPath, zlib.brotliDecompressSync(fs.readFileSync(archive)));
    execFileSync('tar', ['-xf', tarPath, '-C', path.dirname(libDir)]);
  }
  if (fs.existsSync(path.join(libDir, 'libnspr4.so'))) {
    process.env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
  }
}
prepareChromiumLibs();

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('puppeteer-core não está instalado. Rode "npm install" na raiz do projeto.');
  process.exit(1);
}
let chromium = null;
try {
  chromium = (await import('@sparticuz/chromium')).default;
} catch {
  // Um Chrome do sistema informado pela variável é suficiente.
}
const systemCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
let executablePath = systemCandidates.find(candidate => fs.existsSync(candidate));
let launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
if (!executablePath && chromium) {
  executablePath = await chromium.executablePath();
  launchArgs = [...chromium.args, ...launchArgs];
}
if (!executablePath) {
  console.error('Nenhum navegador encontrado. Defina PUPPETEER_EXECUTABLE_PATH.');
  process.exit(1);
}

/* Dados sintéticos determinísticos ---------------------------------------- */
const dateKey = days => {
  const d = new Date(FIXED_NOW - days * DAY);
  const two = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
};
const log = (set, reps, load, extra = {}) => ({
  set, reps: String(reps), load: load === null ? '' : String(load), seconds: 0,
  distance: null, rpe: null, editedAt: null, ...extra
});
const exercise = (name, logs, extra = {}) => ({
  id: 'p13-' + name.toLowerCase().replace(/\s+/g, '-'), name, section: 'main',
  plannedSets: logs.length, completedSets: logs.length, reps: '10', duration: 45,
  type: 'reps', rest: 60, load: '', notes: '', distance: null, distanceUnit: 'm',
  logs, timedSeconds: 0, ...extra
});
const session = (days, name, modality, loads, extra = {}) => {
  const exercises = [exercise(modality === 'weights' ? 'Supino reto' : 'Flexão', loads.map((load, i) => log(i + 1, 10 - i, load)))];
  if (extra.second) exercises.push(exercise(extra.second, [log(1, 10, 35)]));
  if (extra.run) exercises.push(exercise('Corrida', [log(1, '', null, { distance: 2.4 })], { distanceUnit: 'km', measure: 'distance' }));
  const completedSets = exercises.reduce((sum, item) => sum + item.completedSets, 0);
  const volumeKg = exercises.reduce((sum, item) => sum + item.logs.reduce((acc, entry) => acc + (Number(entry.reps) || 0) * (Number(entry.load) || 0), 0), 0);
  const reps = exercises.reduce((sum, item) => sum + item.logs.reduce((acc, entry) => acc + (Number(entry.reps) || 0), 0), 0);
  return {
    id: `p13-h-${days}`, date: dateKey(days), finishedAt: new Date(FIXED_NOW - days * DAY).toISOString(),
    modality, routineName: name, durationMs: (38 + (days % 3) * 6) * 60000,
    completedSets, totalPlannedSets: completedSets + (days === 22 ? 1 : 0),
    status: days === 22 ? 'partial' : 'completed', exercises,
    feedback: days === 1 ? { rpe: 8, note: 'Sessão sólida, sem dor no ombro.' } : { rpe: null, note: '' },
    totals: {
      volumeKg, reps, seconds: 0, distanceMeters: extra.run ? 2400 : 0,
      setsLogged: completedSets, setsWithoutVolume: extra.run ? 1 : 0
    }
  };
};
const routines = [
  {
    id: 'p13-r1', name: 'Força A — peito e ombro', modality: 'weights', createdAt: FIXED_NOW - 80 * DAY, updatedAt: FIXED_NOW - 3 * DAY,
    sections: { warmup: [], main: [
      { id: 'p13-e1', name: 'Supino reto', section: 'main', sets: 4, type: 'reps', reps: '8', rest: 90, load: '50 kg', notes: 'Escápulas travadas.' },
      { id: 'p13-e2', name: 'Desenvolvimento', section: 'main', sets: 3, type: 'reps', reps: '10', rest: 75, load: '24 kg', notes: '' }
    ], abs: [], finisher: [] }
  },
  {
    id: 'p13-r2', name: 'Pernas e core', modality: 'weights', createdAt: FIXED_NOW - 60 * DAY, updatedAt: FIXED_NOW - 8 * DAY,
    sections: { warmup: [], main: [
      { id: 'p13-e3', name: 'Agachamento', section: 'main', sets: 4, type: 'reps', reps: '10', rest: 90, load: '70 kg', notes: '' }
    ], abs: [{ id: 'p13-e4', name: 'Prancha', section: 'abs', sets: 3, type: 'duration', duration: 45, rest: 45, load: '', notes: '' }], finisher: [] }
  },
  {
    id: 'p13-r3', name: 'Calistenia base', modality: 'calisthenics', createdAt: FIXED_NOW - 45 * DAY, updatedAt: FIXED_NOW - 12 * DAY,
    sections: { warmup: [], main: [
      { id: 'p13-e5', name: 'Flexão', section: 'main', sets: 4, type: 'reps', reps: '12', rest: 60, load: '', notes: '' },
      { id: 'p13-e6', name: 'Barra fixa', section: 'main', sets: 3, type: 'reps', reps: '6', rest: 90, load: '', notes: '' }
    ], abs: [], finisher: [] }
  }
];
const history = [
  session(1, 'Força A — peito e ombro', 'weights', [52, 50, 48], { second: 'Remada curvada' }),
  session(3, 'Calistenia base', 'calisthenics', [0, 0, 0]),
  session(6, 'Pernas e core', 'weights', [70, 68]),
  session(9, 'Força A — peito e ombro', 'weights', [48, 46], { run: true }),
  session(13, 'Calistenia base', 'calisthenics', [0, 0]),
  session(16, 'Força A — peito e ombro', 'weights', [46, 44, 42]),
  session(22, 'Pernas e core', 'weights', [65, 62]),
  session(29, 'Força A — peito e ombro', 'weights', [44, 42]),
  session(38, 'Calistenia base', 'calisthenics', [0, 0, 0]),
  session(48, 'Força A — peito e ombro', 'weights', [40, 38])
];
const seed = {
  'forja-treino-rotinas-v1': { calisthenics: [routines[2]], weights: [routines[0], routines[1]] },
  'forja-treino-historico-v1': history,
  'forja-treino-metas-v1': {
    version: 1, updatedAt: new Date(FIXED_NOW - 5 * DAY).toISOString(), modality: 'all',
    weeklySessions: 3, weeklySets: 24, weeklyMinutes: 120
  },
  'forja-perfil-v1': {
    version: 2, updatedAt: new Date(FIXED_NOW - 20 * DAY).toISOString(),
    objetivo: 'hipertrofia', nivel: 'intermediario', equipamento: 'academia',
    diasPorSemana: 4, duracaoMinutos: 55, sexo: 'feminino',
    modalidadePreferida: 'weights', onboardingConcluidoEm: new Date(FIXED_NOW - 20 * DAY).toISOString()
  },
  'forja-preferencias-v1': { soundOnRest: false, vibrateOnRest: true },
  'forja-missoes-2026-10-26': [
    { id: 'p13-m1', text: 'Preparar a mochila antes do treino', done: true },
    { id: 'p13-m2', text: 'Revisar cargas do supino', done: false }
  ]
};

/* Servidor estático: o repositório fica sob /forja/, como no GitHub Pages. */
function startStaticServer(rootDir) {
  const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2'
  };
  const blocked = new Set(['node_modules', '.git', 'tests', 'docs', '.github']);
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      if (!requestUrl.pathname.startsWith('/forja/')) {
        response.statusCode = 404; response.end('not found'); return;
      }
      let relative = decodeURIComponent(requestUrl.pathname.slice('/forja/'.length));
      if (relative === '' || relative.endsWith('/')) relative += 'index.html';
      const filePath = path.resolve(rootDir, relative);
      const first = path.relative(rootDir, filePath).split(path.sep)[0];
      if (!filePath.startsWith(rootDir + path.sep) || blocked.has(first) || first.startsWith('.')) {
        response.statusCode = 404; response.end('not found'); return;
      }
      fs.readFile(filePath, (error, data) => {
        if (error) { response.statusCode = 404; response.end('not found'); return; }
        response.setHeader('Content-Type', mime[path.extname(filePath)] || 'application/octet-stream');
        response.end(data);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/forja/` }));
  });
}

const localServer = process.env.FORJA_URL ? null : await startStaticServer(repoRoot);
const BASE = (process.env.FORJA_URL || localServer.url).replace(/\/?$/, '/');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-p13-'));
const browser = await puppeteer.launch({
  executablePath, args: launchArgs, headless: true, userDataDir: profileDir,
  defaultViewport: { width: 390, height: HEIGHT, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
page.on('requestfailed', r => consoleErrors.push('requestfailed: ' + r.url()));

/* Relógio fixo e dados iguais em todas as cargas. */
await page.evaluateOnNewDocument((entries, fixedNow) => {
  const NativeDate = Date;
  class ForjaDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return fixedNow; }
  }
  window.Date = ForjaDate;
  try {
    Object.keys(localStorage).filter(k => k.startsWith('forja-')).forEach(k => localStorage.removeItem(k));
    Object.entries(entries).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
    sessionStorage.setItem('forja-onboarding-dispensado', '1');
  } catch { /* origem sem storage: nada a semear */ }
}, seed, FIXED_NOW);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Medições genéricas: nada aqui altera o DOM. */
async function measure() {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const visible = node => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const px = value => Math.round(parseFloat(value) * 100) / 100;
    const colorToRgb = value => {
      const match = String(value).match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(',').map(v => parseFloat(v));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const blend = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1
    });
    const luminance = color => {
      const channel = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const effectiveBackground = node => {
      let current = node;
      let acc = { r: 13, g: 15, b: 14, a: 1 };
      const stack = [];
      while (current && current !== document.documentElement) {
        const bg = colorToRgb(getComputedStyle(current).backgroundColor);
        if (bg && bg.a > 0) stack.unshift(bg);
        if (bg && bg.a === 1) break;
        current = current.parentElement;
      }
      stack.forEach(bg => { acc = blend(bg, acc); });
      return acc;
    };
    const contrast = node => {
      const fg = colorToRgb(getComputedStyle(node).color);
      if (!fg) return null;
      const bg = effectiveBackground(node);
      const a = luminance(blend(fg, bg));
      const b = luminance(bg);
      return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
    };
    const styleOf = selector => Array.from(document.querySelectorAll(selector)).filter(visible).map(node => {
      const s = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        tag: node.tagName.toLowerCase(), class: String(node.className || '').slice(0, 80),
        text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70),
        width: Math.round(box.width), height: Math.round(box.height),
        fontFamily: s.fontFamily.split(',')[0].replace(/"/g, ''), fontSize: px(s.fontSize),
        fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
        color: s.color, background: s.backgroundColor, borderColor: s.borderTopColor,
        borderWidth: px(s.borderTopWidth), borderRadius: px(s.borderTopLeftRadius),
        padding: s.padding, gap: s.gap, marginTop: px(s.marginTop), marginBottom: px(s.marginBottom),
        boxShadow: s.boxShadow === 'none' ? 'none' : 'yes', contrast: contrast(node)
      };
    });
    const grids = {};
    ['.home-week-stats', '.home-goals-grid', '.home-goals-grid .goals-progress', '.goals-progress',
      '#goals-progress', '#goals-progress .goals-progress', '.history-summary', '.hub-list',
      '.routine-list', '.explorar-shortcuts', '.ui-stats', '.summary-totals'].forEach(selector => {
      const host = document.querySelector(selector);
      if (!host || !visible(host)) return;
      const s = getComputedStyle(host);
      grids[selector] = {
        display: s.display, columns: s.gridTemplateColumns, gap: s.gap,
        children: Array.from(host.children).filter(visible).map(child => {
          const b = child.getBoundingClientRect();
          return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
        })
      };
    });
    const interactive = Array.from(document.querySelectorAll(
      'a:not(.skip-link), button, input, select, summary, [role="button"]'
    )).filter(visible).map(node => {
      const b = node.getBoundingClientRect();
      const s = getComputedStyle(node);
      return {
        selector: node.tagName.toLowerCase() + (node.id ? '#' + node.id : '.' + String(node.className || '').split(' ')[0]),
        text: (node.textContent || node.value || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        width: Math.round(b.width), height: Math.round(b.height),
        fontSize: px(s.fontSize), background: s.backgroundColor, color: s.color,
        borderColor: s.borderTopColor, borderRadius: px(s.borderTopLeftRadius)
      };
    });
    const wide = [];
    if (doc.scrollWidth > doc.clientWidth + 1) {
      document.querySelectorAll('body *').forEach(node => {
        const b = node.getBoundingClientRect();
        if (visible(node) && b.right > doc.clientWidth + 1) {
          wide.push(node.tagName.toLowerCase() + (node.id ? '#' + node.id : '.' + String(node.className || '').split(' ')[0]) + ' → ' + Math.round(b.right));
        }
      });
    }
    const clipped = Array.from(document.querySelectorAll('body *')).filter(node => {
      if (!visible(node) || node.children.length > 0) return false;
      const s = getComputedStyle(node);
      if (s.overflow === 'visible' && s.textOverflow !== 'ellipsis') return false;
      return node.scrollWidth > node.clientWidth + 1 && (node.textContent || '').trim().length > 1;
    }).slice(0, 12).map(node => node.tagName.toLowerCase() + '.' + String(node.className || '').split(' ')[0] + ':' + (node.textContent || '').trim().slice(0, 25));
    const charts = {};
    ['.ui-chart', '.ui-table', '.ui-bars', '.ui-columns', '.ui-line', '.ui-heatmap', '.ui-ring',
      '.ui-chart-caption', '.ui-bar-value', '.ui-column-value', '.ui-table tbody tr'].forEach(selector => {
      charts[selector] = { count: document.querySelectorAll(selector).length, visible: Array.from(document.querySelectorAll(selector)).filter(visible).length };
    });
    const typography = {};
    ['.home-title', '.screen-title', '.section-title', '.ui-section-title', '.home-week-title',
      '.home-action-title', '.modality-name', '.routine-name', '.home-recent-name',
      '.screen-subtitle', '.home-subtitle', '.section-note', '.eyebrow', '.home-eyebrow',
      '.field-label', '.ui-stat-label', '.home-week-stat-label', '.ui-chart-caption',
      '.ui-card-title', '.ui-card-subtitle', '.ui-table th', '.ui-table td'].forEach(selector => {
      const node = Array.from(document.querySelectorAll(selector)).find(visible);
      if (!node) return;
      const s = getComputedStyle(node);
      typography[selector] = {
        fontFamily: s.fontFamily.split(',')[0].replace(/"/g, ''), fontSize: px(s.fontSize),
        fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
        color: s.color, contrast: contrast(node), text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
      };
    });
    const surfaces = {};
    ['.ui-card', '.home-action-card', '.routine-card', '.modality-card', '.section-block',
      '.preferences-panel', '.backup-panel', '.storage-panel', '.home-week-stat',
      '.home-goals-ring', '.goals-progress .ui-ring', '.ui-stat', '.ui-list-item',
      '.history-item', '.record-item', '.primary-button', '.secondary-button', '.filter-button'].forEach(selector => {
      const node = Array.from(document.querySelectorAll(selector)).find(visible);
      if (!node) return;
      const s = getComputedStyle(node);
      surfaces[selector] = {
        background: s.backgroundColor, borderColor: s.borderTopColor,
        borderWidth: px(s.borderTopWidth), borderRadius: px(s.borderTopLeftRadius),
        padding: s.padding, boxShadow: s.boxShadow === 'none' ? 'none' : 'yes'
      };
    });
    const limeRgb = 'rgb(183, 243, 74)';
    const accent = {};
    ['color', 'backgroundColor', 'borderTopColor'].forEach(prop => {
      const byClass = {};
      accent[prop] = Array.from(document.querySelectorAll('body *')).filter(node => {
        if (!visible(node) || getComputedStyle(node)[prop] !== limeRgb) return false;
        const key = node.tagName.toLowerCase() + '.' + String(node.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
        byClass[key] = (byClass[key] || 0) + 1;
        return true;
      }).length;
      accent[prop + 'ByClass'] = Object.entries(byClass).sort((a, b) => b[1] - a[1]);
    });
    const dataSelectors = {};
    ['#home-title', '#home-subtitle', '#home-week-stats', '#home-week-note', '#home-goals-content',
      '#home-recent-list', '#progress-sessions', '#progress-completed', '#progress-partial',
      '#progress-sets', '#progress-time', '#progress-totals', '#goals-progress',
      '#progress-compare', '#progress-frequency', '#progress-weekly', '#progress-evolution',
      '#progress-records', '#progress-routines', '#progress-exercises', '#progress-history',
      '#hub-routine-list', '#profile-form', '#backup-status'].forEach(selector => {
      const node = document.querySelector(selector);
      if (node) dataSelectors[selector] = (node.textContent || '').replace(/\s+/g, ' ').trim();
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      page: document.body.dataset.page,
      overflow: { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, extra: doc.scrollWidth - doc.clientWidth, wide },
      documentHeight: doc.scrollHeight,
      typography, surfaces, styleOf: {
        h1: styleOf('h1'), h2: styleOf('h2'), primaryButtons: styleOf('.primary-button, .home-action-button'),
        secondaryButtons: styleOf('.secondary-button'), links: styleOf('.home-week-link, .back-link, .modality-meta')
      },
      grids, charts, accent,
      interactive: {
        count: interactive.length,
        below44: interactive.filter(i => i.height < 44 || i.width < 44).slice(0, 30),
        buttonsBelow44: interactive.filter(i => /button|primary|secondary|nav|filter|segment|chip-toggle/i.test(i.selector) && (i.height < 44 || i.width < 44)).slice(0, 30)
      },
      clipped,
      contrastMin: Math.min(...Object.values(typography).map(t => t.contrast).filter(v => typeof v === 'number')),
      data: {
        mainText: (document.querySelector('main')?.textContent || '').replace(/\s+/g, ' ').trim(),
        selectors: dataSelectors,
        storage: Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('forja-')).sort().map(k => [k, localStorage.getItem(k)]))
      }
    };
  });
}

const report = { base: BASE, fixedNow: new Date(FIXED_NOW).toISOString(), widths: WIDTHS, pages: {}, consoleErrors };
try {
  for (const entry of PAGES) {
    report.pages[entry.id] = {};
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: HEIGHT, deviceScaleFactor: 1 });
      await page.goto(new URL(entry.path, BASE).href, { waitUntil: 'networkidle0' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.evaluate(() => document.fonts.ready);
      await sleep(140);
      const shot = path.join(outDir, `${entry.id}-${width}.png`);
      await page.screenshot({ path: shot });
      report.pages[entry.id][width] = await measure();
      /* Duas posições reais de rolagem. fullPage não é usado: a barra fixa
         seria pintada no meio da página pelo Chromium e prejudicaria a
         comparação visual. */
      if (width === 390 || width === 1280) {
        const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        for (const [fraction, label] of [[0.45, 'meio'], [0.8, 'fim']]) {
          await page.evaluate(y => window.scrollTo(0, y), Math.round(maxScroll * fraction));
          await sleep(120);
          await page.screenshot({ path: path.join(outDir, `${entry.id}-${width}-${label}.png`) });
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      const anchor = ANCHORS[entry.id];
      if (anchor && [320, 390, 1280].includes(width)) {
        await page.$eval(anchor, node => node.scrollIntoView({ block: 'start' }));
        await sleep(140);
        await page.screenshot({ path: path.join(outDir, `${entry.id}-${width}-detalhe.png`) });
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
    console.log('capturado', entry.id, WIDTHS.join('/'));
  }
} finally {
  await browser.close();
  if (localServer) localServer.server.close();
  fs.rmSync(profileDir, { recursive: true, force: true });
}
fs.writeFileSync(path.join(outDir, 'medicoes.json'), JSON.stringify(report, null, 2));
if (consoleErrors.length) console.log('ERROS DE CONSOLE:', consoleErrors.slice(0, 10).join(' | '));
console.log('capturas e medições em', outDir);
