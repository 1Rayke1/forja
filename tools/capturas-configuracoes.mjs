/*
  Capturas reais da tela de Configurações em Chromium.

  Usa um perfil de teste isolado (nome "Ravy" é fixture de captura, nunca
  dado padrão do app). Sobe o repositório sob /forja/, mede overflow e
  grava PNGs + relatório JSON em artifacts/forja-configuracoes.

  Uso: npm run capturas:configuracoes
       node tools/capturas-configuracoes.mjs --out /tmp/capturas
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.FORJA_ROOT || path.join(here, '..'));
const outArg = process.argv.indexOf('--out');
const output = path.resolve(outArg >= 0 && process.argv[outArg + 1]
  ? process.argv[outArg + 1]
  : path.join(root, 'artifacts', 'forja-configuracoes'));
fs.mkdirSync(output, { recursive: true });

const puppeteer = (await import('puppeteer-core')).default;
let chromium = null;
try { chromium = (await import('@sparticuz/chromium')).default; } catch { /* navegador do sistema */ }
const candidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
let executablePath = candidates.find(candidate => fs.existsSync(candidate));
let launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
if (!executablePath && chromium) {
  executablePath = await chromium.executablePath();
  launchArgs = [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'];
}
if (!executablePath) {
  console.error('Nenhum Chromium encontrado. Defina PUPPETEER_EXECUTABLE_PATH ou rode npm install.');
  process.exit(1);
}
if (process.platform === 'linux' && chromium && !process.env.LD_LIBRARY_PATH && executablePath.includes('/tmp/')) {
  try {
    const modulePath = fileURLToPath(import.meta.resolve('@sparticuz/chromium'));
    const packageRoot = path.resolve(path.dirname(modulePath), '../..');
    const archive = path.join(packageRoot, 'bin', 'al2023.tar.br');
    const libRoot = path.join(os.tmpdir(), 'forja-e2e-al2023');
    if (!fs.existsSync(path.join(libRoot, 'lib', 'libnspr4.so'))) {
      fs.mkdirSync(libRoot, { recursive: true });
      const unpacked = path.join(os.tmpdir(), 'forja-e2e-al2023.tar');
      fs.writeFileSync(unpacked, brotliDecompressSync(fs.readFileSync(archive)));
      execFileSync('tar', ['-xf', unpacked, '-C', libRoot]);
      fs.unlinkSync(unpacked);
    }
    process.env.LD_LIBRARY_PATH = path.join(libRoot, 'lib');
  } catch (error) {
    console.warn('Dependências Linux do Chromium: ' + error.message);
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8'
};
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (!url.pathname.startsWith('/forja/')) { response.writeHead(404).end(); return; }
  let relative = decodeURIComponent(url.pathname.slice('/forja/'.length));
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const file = path.resolve(root, relative);
  const first = path.relative(root, file).split(path.sep)[0];
  if (!file.startsWith(root + path.sep) || ['node_modules', '.git', 'tests', 'docs'].includes(first) || first.startsWith('.')) {
    response.writeHead(404).end(); return;
  }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port + '/forja/';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await puppeteer.launch({ executablePath, args: launchArgs, headless: true });
const page = await browser.newPage();
const errors = [];
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => {
  if (!/ERR_ABORTED/i.test(request.failure()?.errorText || '')) errors.push(request.url());
});

/* Fixture explícita de captura; não é semeada pelo app em produção. */
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('forja-perfil-v1', JSON.stringify({
    version: 3,
    updatedAt: '2026-01-02T00:00:00.000Z',
    onboardingConcluidoEm: '2026-01-02T00:00:00.000Z',
    nomeExibicao: 'Ravy',
    objetivo: 'hipertrofia',
    nivel: 'intermediario',
    equipamento: 'academia'
  }));
});

const report = {
  generatedAt: new Date().toISOString(),
  fixture: 'configuracoes-captura-v1 (nome Ravy apenas para a captura)',
  screenshots: [],
  layout: [],
  consoleErrors: errors
};

async function capture(name, url, width, height, fullPage = true) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(base + url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await sleep(250);
  const layout = await page.evaluate(() => ({
    title: document.title,
    overflow: document.documentElement.scrollWidth - innerWidth,
    height: document.documentElement.scrollHeight,
    visiblePanel: document.querySelector('[data-settings-panel]:not([hidden])')?.getAttribute('data-settings-panel') || null
  }));
  const file = path.join(output, name + '.png');
  await page.screenshot({ path: file, fullPage });
  report.screenshots.push(path.relative(root, file));
  report.layout.push({ name, width, height, ...layout });
}

await capture('configuracoes-320', 'configuracoes/', 320, 844);
await capture('configuracoes-390', 'configuracoes/', 390, 844);
await capture('configuracoes-390-viewport', 'configuracoes/', 390, 844, false);
await capture('configuracoes-1280', 'configuracoes/', 1280, 900);
await capture('editar-perfil-390', 'configuracoes/#editar-perfil', 390, 844);
await capture('notificacoes-390', 'configuracoes/#notificacoes', 390, 844);
await capture('aparencia-390', 'configuracoes/#aparencia', 390, 844);
await capture('privacidade-390', 'configuracoes/#privacidade', 390, 844);

/* Tema alternativo aplicado de verdade, inclusive fora de Configurações. */
await page.setViewport({ width: 390, height: 844 });
await page.goto(base + 'configuracoes/#aparencia', { waitUntil: 'networkidle0' });
await page.click('input[name="appearance-theme"][value="contrast"]');
await sleep(150);
await capture('aparencia-alto-contraste-390', 'configuracoes/#aparencia', 390, 844);
await capture('inicio-alto-contraste-390', 'index.html', 390, 844);

await browser.close();
server.close();
fs.writeFileSync(path.join(output, 'relatorio.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Capturas em ' + output);
console.log('Overflow: ' + report.layout.every(item => item.overflow === 0));
console.log('Erros de console: ' + errors.length);
if (errors.length || report.layout.some(item => item.overflow !== 0)) process.exitCode = 1;
