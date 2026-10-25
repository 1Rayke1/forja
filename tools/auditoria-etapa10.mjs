/*
  Auditoria da etapa 10 (fechamento visual):
   - contraste WCAG 2.1 de texto vs fundo resolvido (subindo os ancestrais),
     nas 12 páginas, em 390 e 1280 px;
   - rolagem horizontal nas larguras 320/360/390/430/768/1280;
   - capturas em 390 e 1280 px.
  Não muda nada no app: servidor estático local e perfil temporário.
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WIDTHS = [320, 360, 390, 430, 768, 1280];
const PAGES = [
  'index.html',
  'treino/index.html',
  'treino/calistenia.html',
  'treino/musculacao.html',
  'treino/rotina.html',
  'treino/executar.html',
  'treino/biblioteca.html',
  'progresso/index.html',
  'perfil/index.html',
  'configuracoes/index.html',
  'explorar/index.html',
  'explorar/atlas.html'
];
const outDir = path.join(repoRoot, 'artifacts', 'forja-etapa10');
fs.mkdirSync(outDir, { recursive: true });

const puppeteer = (await import('puppeteer-core')).default;
let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
if (!executablePath) {
  const chromium = (await import('@sparticuz/chromium')).default;
  executablePath = await chromium.executablePath();
}

function startStaticServer(rootDir) {
  const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
  };
  const blocked = new Set(['node_modules', '.git', 'artifacts']);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (!u.pathname.startsWith('/forja/')) { res.statusCode = 404; res.end(); return; }
      let rel = decodeURIComponent(u.pathname.slice('/forja/'.length));
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const fp = path.resolve(rootDir, rel);
      const first = path.relative(rootDir, fp).split(path.sep)[0];
      if (!fp.startsWith(rootDir + path.sep) || blocked.has(first) || first.startsWith('.')) {
        res.statusCode = 404; res.end(); return;
      }
      fs.readFile(fp, (e, data) => {
        if (e) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', mime[path.extname(fp)] || 'application/octet-stream');
        res.end(data);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/forja/' }));
  });
}

function parseColor(s) {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map(x => parseFloat(x));
  return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
}
function rel(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum({ r, g, b }) { return 0.2126 * rel(r) + 0.7152 * rel(g) + 0.0722 * rel(b); }
function over(top, bottom) {
  const a = top.a;
  return {
    r: Math.round(top.r * a + bottom.r * (1 - a)),
    g: Math.round(top.g * a + bottom.g * (1 - a)),
    b: Math.round(top.b * a + bottom.b * (1 - a)),
    a: 1
  };
}
function ratio(fg, bg) {
  const l1 = lum(fg), l2 = lum(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const server = await startStaticServer(repoRoot);
const BASE = server.url;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-e10-'));
const browser = await puppeteer.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  headless: true,
  userDataDir: profileDir,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 }
});

const contrastInPage = () => {
  function parseColor(s) {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  }
  function rel(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * rel(c.r) + 0.7152 * rel(c.g) + 0.0722 * rel(c.b); }
  function over(top, bottom) {
    const a = top.a;
    return {
      r: Math.round(top.r * a + bottom.r * (1 - a)),
      g: Math.round(top.g * a + bottom.g * (1 - a)),
      b: Math.round(top.b * a + bottom.b * (1 - a)),
      a: 1
    };
  }
  function ratio(fg, bg) {
    const l1 = lum(fg), l2 = lum(bg);
    const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  }
  function resolveBg(el) {
    const root = document.documentElement;
    const chain = [];
    let n = el;
    while (n && n !== root.parentNode) { chain.push(n); n = n.parentElement; }
    let acc = parseColor(getComputedStyle(root).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
    for (let i = chain.length - 1; i >= 0; i--) {
      const bg = parseColor(getComputedStyle(chain[i]).backgroundColor);
      if (bg && bg.a > 0) acc = over(bg, acc);
    }
    return acc;
  }
  const sels = [
    '.screen-title', '.home-title', '.section-title', '.home-greeting',
    '.screen-subtitle', '.home-subtitle', '.section-note', '.muted, .storage-note',
    '.primary-button', '.secondary-button', '.danger-button',
    '.bottom-nav-link', '.bottom-nav-link.is-active',
    '.field-label', '.field-input, input, select, textarea',
    '.ui-chip', '.ui-stat-label', '.ui-stat-value', '.eyebrow', '.tagline',
    '.toast', '.empty-card, .ui-empty', '.back-link', '.logo'
  ];
  const seen = new Set();
  const out = [];
  for (const s of sels) {
    for (const el of document.querySelectorAll(s)) {
      if (!el.offsetParent && el.getClientRects().length === 0) continue;
      const txt = (el.textContent || '').trim();
      if (!txt && !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const fg = parseColor(cs.color);
      if (!fg) continue;
      const bg = resolveBg(el);
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      out.push({
        sel: s,
        text: (txt || el.tagName).slice(0, 28),
        ratio: Math.round(ratio(fg, bg) * 100) / 100,
        large,
        fg: cs.color,
        bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')'
      });
    }
  }
  return out;
};

const summary = [];
const problems = [];
try {
  for (const pagePath of PAGES) {
    const page = await browser.newPage();
    page.on('pageerror', e => problems.push(pagePath + ' pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') problems.push(pagePath + ' console: ' + m.text()); });
    await page.goto(BASE + pagePath, { waitUntil: 'networkidle0' });
    await sleep(300);

    // overflow em todas as larguras
    const overflows = [];
    for (const w of WIDTHS) {
      await page.setViewport({ width: w, height: 844, deviceScaleFactor: 2 });
      await sleep(120);
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (extra > 0) overflows.push(w + 'px:+' + extra);
    }
    // contraste em 390 e 1280
    const contrast = {};
    for (const w of [390, 1280]) {
      await page.setViewport({ width: w, height: 900, deviceScaleFactor: w >= 768 ? 1 : 2 });
      await sleep(150);
      contrast[w] = await page.evaluate(contrastInPage);
    }
    const all = [...contrast[390], ...contrast[1280]];
    const min = all.reduce((a, b) => (b.ratio < a.ratio ? b : a), all[0] || { ratio: null });
    const fails = all.filter(c => (c.large ? c.ratio < 3 : c.ratio < 4.5));
    summary.push({ page: pagePath, overflow: overflows.length ? overflows.join(';') : 'nenhum', min, amostras: all.length, falhas: fails.length });
    if (fails.length) problems.push(pagePath + ' contraste abaixo do mínimo: ' + fails.map(f => f.sel + '=' + f.ratio).slice(0, 6).join(' | '));

    // capturas
    for (const w of [390, 1280]) {
      await page.setViewport({ width: w, height: w >= 768 ? 900 : 844, deviceScaleFactor: w >= 768 ? 1 : 2 });
      await sleep(150);
      const name = pagePath.replace(/[\/.]/g, '-').replace(/^-|html$/g, '').replace(/-html$/, '') + '-' + w + '.png';
      await page.screenshot({ path: path.join(outDir, name), fullPage: true });
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.server.close();
  fs.rmSync(profileDir, { recursive: true, force: true });
}

console.log('Página'.padEnd(34), 'overflow'.padEnd(12), 'contraste mínimo'.padEnd(34), 'amostras');
for (const s of summary) {
  const m = s.min.ratio ? `${s.min.ratio} (${s.min.sel})` : 'n/d';
  console.log(s.page.padEnd(34), s.overflow.padEnd(12), m.padEnd(34), s.amostras, s.falhas ? 'FALHAS=' + s.falhas : '');
}
console.log('\nProblemas:', problems.length ? problems.join('\n') : 'nenhum');
fs.writeFileSync(path.join(outDir, 'resumo-contraste.json'), JSON.stringify({ summary, problems }, null, 2));
console.log('Capturas e resumo em', outDir);
