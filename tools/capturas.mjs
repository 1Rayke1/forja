/*
  Capturas reais da tela de execução com dados de teste (etapa 4 do plano 3.0).

  Sobe o repositório num servidor local sob /forja/ (igual ao GitHub Pages),
  abre o Chromium disponível e percorre a execução de verdade: registra séries
  com carga e RPE, ajusta o descanso em ±15 s, corrige uma série, registra uma
  série por distância e encerra a sessão para capturar o resumo. Também mede
  overflow horizontal em 320/360/390/430/768/1280 px em cada um desses estados.

  Nada aqui toca em dados reais: o perfil do navegador é temporário e os dados
  de treino são gravados só no localStorage daquele perfil.

  Uso:
    npm install
    node tools/capturas.mjs                     # grava em artifacts/forja-visual
    node tools/capturas.mjs --out /tmp/capturas # grava noutro lugar
    FORJA_URL=http://127.0.0.1:8080/forja/ node tools/capturas.mjs
    PUPPETEER_EXECUTABLE_PATH=/caminho/do/chrome LD_LIBRARY_PATH=/tmp/libs node tools/capturas.mjs
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const WIDTHS = [320, 360, 390, 430, 768, 1280];

const outArg = process.argv.indexOf('--out');
const outDir = outArg >= 0 && process.argv[outArg + 1]
  ? path.resolve(process.argv[outArg + 1])
  : path.join(repoRoot, 'artifacts', 'forja-visual');
fs.mkdirSync(outDir, { recursive: true });

const routine = {
  id: 'demo-capturas',
  name: 'Empurrar pesado',
  modality: 'weights',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  sections: {
    warmup: [],
    main: [{
      id: 'bench',
      name: 'Supino reto',
      section: 'main',
      sets: 3,
      reps: '10',
      rest: 60,
      type: 'reps',
      measure: 'reps',
      load: '60 kg',
      notes: 'Pés firmes, escápulas travadas, desça controlando.'
    }],
    abs: [],
    finisher: [{
      id: 'esteira',
      name: 'Esteira 400 m',
      section: 'finisher',
      sets: 1,
      reps: '',
      rest: 0,
      type: 'reps',
      measure: 'distance',
      distance: 400,
      distanceUnit: 'm',
      load: '',
      notes: 'Ritmo conversável.'
    }]
  }
};

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch (error) {
  console.error('puppeteer-core não está instalado. Rode "npm install" na raiz do projeto.');
  process.exit(1);
}

let chromium = null;
try {
  chromium = (await import('@sparticuz/chromium')).default;
} catch (error) {
  // Sem o binário empacotado: usa o navegador do sistema informado pela variável.
}

const systemCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

let executablePath = systemCandidates.find(candidate => fs.existsSync(candidate));
let launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

if (!executablePath && chromium) {
  executablePath = await chromium.executablePath();
  launchArgs = [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'];
}

if (!executablePath) {
  console.error('Nenhum navegador encontrado. Defina PUPPETEER_EXECUTABLE_PATH.');
  process.exit(1);
}

/* Servidor estático local, mesmo caminho do GitHub Pages. */
function startStaticServer(rootDir) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json'
  };
  const blocked = new Set(['node_modules', '.git', 'artifacts']);

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      if (!requestUrl.pathname.startsWith('/forja/')) {
        response.statusCode = 404;
        response.end('not found');
        return;
      }
      let relative = decodeURIComponent(requestUrl.pathname.slice('/forja/'.length));
      if (relative === '' || relative.endsWith('/')) relative += 'index.html';
      const filePath = path.resolve(rootDir, relative);
      const first = path.relative(rootDir, filePath).split(path.sep)[0];

      if (!filePath.startsWith(rootDir + path.sep) || blocked.has(first) || first.startsWith('.')) {
        response.statusCode = 404;
        response.end('not found');
        return;
      }

      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.statusCode = 404;
          response.end('not found');
          return;
        }
        response.setHeader('Content-Type', mime[path.extname(filePath)] || 'application/octet-stream');
        response.end(data);
      });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/forja/' });
    });
  });
}

const localServer = process.env.FORJA_URL ? null : await startStaticServer(repoRoot);
const BASE = (process.env.FORJA_URL || localServer.url).replace(/\/?$/, '/');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-capturas-'));

const browser = await puppeteer.launch({
  executablePath,
  args: launchArgs,
  headless: true,
  userDataDir: profileDir,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 }
});

const page = await browser.newPage();
const problems = [];
page.on('pageerror', error => problems.push('pageerror: ' + error.message));
page.on('console', message => { if (message.type() === 'error') problems.push('console: ' + message.text()); });

const shot = name => page.screenshot({ path: path.join(outDir, name) });

async function type(selector, value, event = 'input') {
  await page.$eval(selector, (node, next, type) => {
    node.value = next;
    node.dispatchEvent(new Event(type, { bubbles: true }));
  }, value, event);
}

/* Mede rolagem horizontal real do documento em cada largura. */
async function checkOverflow(label) {
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2 });
    await sleep(140);
    const result = await page.evaluate(() => {
      const doc = document.documentElement;
      const extra = doc.scrollWidth - doc.clientWidth;
      const wide = [];
      if (extra > 0) {
        document.querySelectorAll('body *').forEach(node => {
          const box = node.getBoundingClientRect();
          if (box.right > doc.clientWidth + 1 && box.width > 0) {
            wide.push(
              node.tagName.toLowerCase() +
              (node.id ? '#' + node.id : '.' + String(node.className).split(' ')[0]) +
              ' → ' + Math.round(box.right)
            );
          }
        });
      }
      return { extra, wide: wide.slice(0, 4) };
    });
    if (result.extra > 0) console.log('OVERFLOW', label, width + 'px', '+' + result.extra, JSON.stringify(result.wide));
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await sleep(140);
}

try {
  await page.goto(BASE + 'treino/musculacao.html', { waitUntil: 'networkidle0' });
  await page.evaluate(seed => {
    window.localStorage.setItem('forja-treino-rotinas-v1', JSON.stringify(seed));
  }, { calisthenics: [], weights: [routine] });
  await page.reload({ waitUntil: 'networkidle0' });

  await page.evaluate(() => window.Forja.startRoutine('weights', 'demo-capturas'));
  await page.waitForFunction(() => location.pathname.endsWith('/executar.html'), { timeout: 10000 });
  await sleep(400);

  await checkOverflow('execução (sessão iniciada)');

  /* Série 1 com RPE; série 2 corrigida depois. */
  await type('#log-reps', '10');
  await type('#log-load', '60 kg');
  await type('#log-rpe', '8', 'change');
  await page.click('#complete-set');
  await sleep(250);
  await page.click('#skip-rest');
  await sleep(250);

  await type('#log-reps', '12');
  await type('#log-load', '62 kg');
  await page.click('#complete-set');
  await sleep(250);

  /* Descanso ajustado em +15 s e depois devolvido em dois passos de −15 s. */
  await page.click('#rest-plus');
  await sleep(200);
  await shot('executar-descanso-390.png');
  await page.click('#rest-minus');
  await page.click('#rest-minus');
  await sleep(200);
  await page.click('#skip-rest');
  await sleep(250);

  await page.click('#log-list .log-entry:first-child button');
  await sleep(300);
  await checkOverflow('modal de correção de série');
  await shot('executar-corrigir-390.png');
  await page.evaluate(() => {
    const field = document.querySelector('[data-modal-field="reps"]');
    field.value = '11';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('[data-modal-action="save"]');
  await sleep(300);

  await page.$eval('#log-panel', node => node.scrollIntoView({ block: 'start' }));
  await sleep(200);
  await checkOverflow('painel de séries registradas');
  await page.$eval('#log-panel', node => node.scrollIntoView({ block: 'start' }));
  await sleep(150);
  await shot('executar-log-390.png');

  /* Última série do supino e a série por distância, que fecha a sessão. */
  await type('#log-reps', '8');
  await type('#log-load', '60 kg');
  await page.click('#complete-set');
  await sleep(250);
  await page.click('#skip-rest');
  await sleep(350);

  await page.waitForFunction(() => document.getElementById('current-name').textContent.includes('Esteira'), { timeout: 6000 });
  await type('#log-distance', '420');
  await page.click('#complete-set');
  await sleep(500);

  await page.waitForFunction(() => !document.getElementById('execution-summary').hidden, { timeout: 8000 });
  await page.evaluate(() => document.getElementById('execution-summary').scrollIntoView({ block: 'start' }));
  await sleep(200);
  await checkOverflow('resumo da sessão');
  await page.evaluate(() => document.getElementById('execution-summary').scrollIntoView({ block: 'start' }));
  await sleep(150);
  await shot('executar-resumo-390.png');

  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await sleep(250);
  await shot('executar-resumo-1280.png');

  const numbers = await page.evaluate(() => {
    const ids = ['summary-volume', 'summary-reps', 'summary-time-under', 'summary-distance', 'summary-note'];
    return ids.map(id => id + ': ' + (document.getElementById(id) || {}).textContent);
  });
  console.log('números do resumo capturado:');
  console.log(numbers.map(line => '  ' + line).join('\n'));
  console.log('capturas gravadas em', outDir);

  if (problems.length > 0) {
    console.log('PROBLEMAS:', problems.join(' | '));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  if (localServer) localServer.server.close();
  fs.rmSync(profileDir, { recursive: true, force: true });
}
