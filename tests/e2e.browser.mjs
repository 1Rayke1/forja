/*
  Teste end-to-end em navegador real (multipágina).

  Sobe o repositório em um servidor HTTP local sob o caminho /forja/, igual ao
  GitHub Pages (https://1rayke1.github.io/forja/), e percorre as páginas com
  puppeteer-core usando um Chromium do sistema (PUPPETEER_EXECUTABLE_PATH) ou o
  binário empacotado em @sparticuz/chromium. Nenhum processo externo é necessário.

  Uso:
    npm install
    npm run test:e2e

  Variáveis opcionais:
    PUPPETEER_EXECUTABLE_PATH  caminho de um Chrome/Chromium local
    FORJA_URL                  URL base de um servidor já em execução (ex.: http://127.0.0.1:8080/forja/)
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-e2e-'));
const artifactPath = name => path.join(artifactsDir, name);
const MOBILE = { width: 390, height: 844 };

const PAGES = [
  '',
  'treino/',
  'treino/calistenia.html',
  'treino/musculacao.html',
  'treino/rotina.html',
  'treino/executar.html',
  'treino/biblioteca.html',
  'progresso/',
  'configuracoes/',
  'perfil/',
  'explorar/',
  'explorar/atlas.html',
  'onboarding/index.html'
];

/* Destino que a barra inferior deve destacar em cada página. */
const EXPECTED_NAV = {
  '': 'inicio',
  'treino/': 'treino',
  'treino/calistenia.html': 'treino',
  'treino/musculacao.html': 'treino',
  'treino/rotina.html': 'treino',
  'treino/executar.html': 'treino',
  'treino/biblioteca.html': 'explorar',
  'progresso/': 'progresso',
  'configuracoes/': 'perfil',
  'perfil/': 'perfil',
  'explorar/': 'explorar',
  'explorar/atlas.html': 'explorar',
  'onboarding/index.html': 'perfil'
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
  // Sem o binário empacotado; usamos um Chrome do sistema se existir.
}

const systemCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

let executablePath = systemCandidates.find(candidate => fs.existsSync(candidate));
let launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

if (!executablePath && chromium) {
  executablePath = await chromium.executablePath();
  launchArgs = [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'];
}

if (!executablePath) {
  console.error(
    'Nenhum navegador encontrado. Defina PUPPETEER_EXECUTABLE_PATH apontando ' +
    'para um Chrome/Chromium ou instale @sparticuz/chromium (npm install).'
  );
  process.exit(1);
}

/*
  O binário Linux empacotado é construído para Amazon Linux; em ambientes
  Debian/Ubuntu mínimos algumas bibliotecas (NSPR/NSS) não estão no sistema.
  Reutilizamos o tar.br de dependências que já vem no mesmo pacote (sem rede e
  sem modificar o repositório) para que `npm run test:e2e` seja autônomo.
*/
if (process.platform === 'linux' && chromium && !process.env.LD_LIBRARY_PATH && executablePath.includes('/tmp/')) {
  try {
    const modulePath = fileURLToPath(import.meta.resolve('@sparticuz/chromium'));
    const packageRoot = path.resolve(path.dirname(modulePath), '../..');
    const archive = path.join(packageRoot, 'bin', 'al2023.tar.br');
    const libRoot = path.join(os.tmpdir(), 'forja-e2e-al2023');
    const nspr = path.join(libRoot, 'lib', 'libnspr4.so');
    if (!fs.existsSync(nspr)) {
      fs.mkdirSync(libRoot, { recursive: true });
      const unpacked = path.join(os.tmpdir(), 'forja-e2e-al2023.tar');
      fs.writeFileSync(unpacked, brotliDecompressSync(fs.readFileSync(archive)));
      execFileSync('tar', ['-xf', unpacked, '-C', libRoot]);
      fs.unlinkSync(unpacked);
    }
    process.env.LD_LIBRARY_PATH = path.join(libRoot, 'lib');
  } catch (error) {
    console.warn('Dependências Linux do Chromium não puderam ser extraídas: ' + error.message);
  }
}

/* Servidor estático: o repositório fica sob /forja/, como no GitHub Pages. */
function startStaticServer(rootDir) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.webmanifest': 'application/manifest+json'
  };
  const blocked = new Set(['node_modules', '.git', 'tests', 'docs', '.github']);

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

let browser;
try {
  browser = await puppeteer.launch({
    args: launchArgs,
    defaultViewport: MOBILE,
    executablePath,
    headless: true
  });
} catch (error) {
  console.error('Não foi possível iniciar o navegador (' + executablePath + '): ' + error.message);
  if (localServer) localServer.server.close();
  process.exit(1);
}

const page = await browser.newPage();
let currentLabel = 'carga';
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(currentLabel + ' console: ' + m.text()); });
page.on('pageerror', e => errors.push(currentLabel + ' pageerror: ' + e.message));
page.on('requestfailed', r => errors.push(currentLabel + ' requestfailed: ' + r.url()));
page.on('response', r => {
  if (r.status() >= 400 && r.url().startsWith(BASE)) errors.push(currentLabel + ' HTTP ' + r.status() + ': ' + r.url());
});

const client = await page.createCDPSession();
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: artifactsDir });

const text = async sel => page.$eval(sel, e => e.textContent.trim());
const isVisible = sel => page.$eval(sel, e => {
  const style = getComputedStyle(e);
  return !e.hidden && style.display !== 'none' && style.visibility !== 'hidden' && e.getClientRects().length > 0;
}).catch(() => false);
const waitFor = async (fn, timeout = 6000, arg) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn, arg)) return true;
    await sleep(60);
  }
  return false;
};
const pathOf = () => new URL(page.url()).pathname;
// Aceita "treino/" e "treino/index.html" como a mesma página.
const normalizePath = p => p.replace(/index\.html$/, '');
const expectPath = async suffix => {
  const want = normalizePath(suffix);
  const ok = await waitFor(s => location.pathname.replace(/index\.html$/, '').endsWith(s), 6000, want);
  assert.ok(ok, 'Esperava a página ' + suffix + ', mas está em ' + pathOf());
};

// Clica pelo DOM (para links e botões ocultos sob estilos customizados).
async function jsClick(sel, pattern) {
  const ok = await page.evaluate((s, src) => {
    const re = src ? new RegExp(src, 'i') : null;
    const el = [...document.querySelectorAll(s)].find(e => !re || re.test(e.textContent.trim()));
    if (!el) return false;
    el.click();
    return true;
  }, sel, pattern ? pattern.source : '');
  assert.ok(ok, 'Elemento não encontrado: ' + sel + (pattern ? ' (' + pattern + ')' : ''));
  await sleep(120);
}

async function fill(sel, value) {
  await page.$eval(sel, (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
  await sleep(40);
}

// Conclui séries e pula descansos até o exercício indicado ficar atual.
async function advanceUntil(namePattern) {
  for (let i = 0; i < 40; i++) {
    if (namePattern.test(await text('#current-name'))) return;
    if (await isVisible('#execution-rest')) {
      await jsClick('#skip-rest');
    } else if (await isVisible('#set-timer-skip')) {
      await jsClick('#set-timer-skip');
    } else {
      await jsClick('#complete-set');
    }
    await sleep(450);
  }
  assert.fail('Não chegou a ' + namePattern + '; atual: ' + (await text('#current-name')));
}

// Preenche e confirma o diálogo modal (ex.: "Nova rotina").
async function answerModal(values, action) {
  await page.waitForSelector('[data-modal-action]', { timeout: 4000 });
  for (const [field, value] of Object.entries(values)) await fill('[data-modal-field="' + field + '"]', value);
  await jsClick('[data-modal-action="' + action + '"]');
  await sleep(150);
}

// Rola até o centro antes de clicar: a barra inferior fixa pode cobrir o alvo.
async function clickCentered(selector) {
  await page.$eval(selector, el => el.scrollIntoView({ block: 'center' }));
  await sleep(90);
  await page.click(selector);
  await sleep(140);
}

async function go(rel) {
  currentLabel = rel || 'index';
  if (process.env.FORJA_E2E_DEBUG) console.log('  [go] -> ' + (rel || 'index'));
  if (page.url().startsWith(new URL(BASE).origin)) {
    await page.evaluate(path => {
      if (!path.includes('onboarding/') && !localStorage.getItem('forja-perfil-v1')) {
        localStorage.setItem('forja-perfil-v1', JSON.stringify({ version: 3, updatedAt: '2026-10-01T00:00:00.000Z', objetivo: 'manterForma', nivel: 'iniciante', equipamento: 'casa', diasPorSemana: 3 }));
      }
    }, String(rel || ''));
  }
  let target = rel;
  if (String(rel) === 'onboarding/index.html' && page.url().startsWith(new URL(BASE).origin)) {
    const hasProfile = await page.evaluate(() => Boolean(localStorage.getItem('forja-perfil-v1')));
    if (hasProfile) target = 'onboarding/index.html?refazer=1';
  }
  await page.goto(new URL(target, BASE).href, { waitUntil: 'networkidle0' });
  if (process.env.FORJA_E2E_DEBUG) console.log('  [go] ok ' + (rel || 'index'));
  // Rolagem suave faz o clique por coordenadas errar o alvo durante a animação.
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
  await sleep(120);
}

async function clearForjaStorage() {
  await page.evaluate(() => {
    // Remove somente as chaves do FORJA (nunca localStorage.clear()).
    Object.keys(localStorage).filter(k => k.startsWith('forja-')).forEach(k => localStorage.removeItem(k));
    sessionStorage.clear();
  });
}

const data = key => page.evaluate(k => {
  const raw = localStorage.getItem(k);
  return raw === null ? null : JSON.parse(raw);
}, key);

const PREFS_KEY = 'forja-preferencias-v1';
const SAFETY_KEY = 'forja-backup-seguranca-v1';

/* Chaves do FORJA em texto puro, para guardar e repor o estado de um teste. */
const forjaRaw = () => page.evaluate(() => Object.fromEntries(
  Object.keys(localStorage).filter(k => k.startsWith('forja-')).sort().map(k => [k, localStorage.getItem(k)])
));

/* Chaves do FORJA já interpretadas (o mesmo conjunto que o backup exporta). */
const forjaData = (skip = []) => page.evaluate(skipKeys => Object.fromEntries(
  Object.keys(localStorage)
    .filter(k => k.startsWith('forja-') && !skipKeys.includes(k))
    .sort()
    .map(k => [k, JSON.parse(localStorage.getItem(k))])
), skip);

async function restoreForjaRaw(saved) {
  await page.evaluate(entries => {
    Object.keys(localStorage).filter(k => k.startsWith('forja-')).forEach(k => localStorage.removeItem(k));
    Object.entries(entries).forEach(([k, v]) => localStorage.setItem(k, v));
  }, saved);
}

const prefBoxes = (target = page) => target.evaluate(() => [
  document.getElementById('pref-sound').checked,
  document.getElementById('pref-vibrate').checked
]);

/* Roda antes dos scripts da página: registra toda escrita no localStorage. */
function installWriteSpy() {
  const writes = [];
  Object.defineProperty(window, '__forjaWrites', { value: writes });
  for (const method of ['setItem', 'removeItem', 'clear']) {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function (...args) {
      if (this === window.localStorage) writes.push(method + (args.length ? ':' + args[0] : ''));
      return original.apply(this, args);
    };
  }
}

/* Roda antes dos scripts da página: conta vibrações e sons do fim do descanso. */
function installRestSignals() {
  const signals = { vibrate: 0, sound: 0 };
  Object.defineProperty(window, '__restSignals', { value: signals });
  Object.defineProperty(Navigator.prototype, 'vibrate', {
    configurable: true,
    value() {
      signals.vibrate += 1;
      return true;
    }
  });
  class FakeAudioContext {
    constructor() {
      signals.sound += 1;
      this.currentTime = 0;
      this.destination = {};
    }
    createOscillator() {
      return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {}, onended: null };
    }
    createGain() {
      return { gain: { value: 0 }, connect() {} };
    }
    close() {
      return Promise.resolve();
    }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;
}

/* Rotina e sessão próprias, para o descanso começar do zero a cada rodada. */
async function seedRestSession() {
  await page.evaluate(() => {
    const exercise = {
      id: 'e2e-prefs-ex', name: 'Flexão E2E', sets: 3, type: 'reps', reps: '10',
      duration: 45, rest: 30, load: '', notes: '', section: 'main'
    };
    const routine = {
      id: 'e2e-prefs-rest', name: 'Descanso E2E', modality: 'calisthenics',
      sections: { warmup: [], main: [exercise], abs: [], finisher: [] },
      createdAt: Date.now(), updatedAt: Date.now()
    };
    const store = JSON.parse(localStorage.getItem('forja-treino-rotinas-v1') || '{"calisthenics":[],"weights":[]}');
    store.calisthenics = (store.calisthenics || []).filter(r => r.id !== routine.id).concat([routine]);
    localStorage.setItem('forja-treino-rotinas-v1', JSON.stringify(store));

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    localStorage.setItem('forja-treino-sessao-ativa-v1', JSON.stringify({
      version: 2, id: 'e2e-prefs-' + now.getTime(),
      date: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
      modality: 'calisthenics', routineId: routine.id, routineName: routine.name,
      startedAt: now.getTime() - 60000, elapsedMs: 0, running: true, currentIndex: 0,
      completedSets: { [exercise.id]: 0 }, totalPlannedSets: exercise.sets,
      queue: [Object.assign({}, exercise)], status: 'active',
      restEndAt: null, restRemainingMs: 0, restPaused: false, pendingAdvance: false,
      restPlannedSeconds: 0, setTimer: null, setLogs: {}, logDraft: {}
    }));
  });
}

/* Conclui uma série, encurta o descanso até 1 s e deixa o cronômetro terminá-lo. */
async function restEndRound() {
  await seedRestSession();
  await go('treino/executar.html');
  await jsClick('#complete-set');
  assert.ok(await waitFor(() => !document.getElementById('execution-rest').hidden, 4000), 'O descanso não começou');
  await jsClick('#rest-minus');
  await jsClick('#rest-minus');
  assert.ok(await waitFor(() => document.getElementById('execution-rest').hidden, 6000), 'O descanso não terminou pelo cronômetro');
  await sleep(200);
  return page.evaluate(() => ({
    vibrate: window.__restSignals.vibrate,
    sound: window.__restSignals.sound,
    prefs: window.Forja.state.preferences
  }));
}

async function check(name, fn) {
  try {
    await fn();
    results.push([name, 'ok']);
    console.log('✅ ' + name);
  } catch (e) {
    results.push([name, 'fail']);
    console.log('❌ ' + name + '\n   ' + e.message.split('\n').slice(0, 6).join('\n   '));
  }
}

/* ------------------------------------------------------------------ */

await go('');
await clearForjaStorage();
currentLabel = 'onboarding-obrigatorio';
await page.goto(new URL('treino/index.html', BASE).href, { waitUntil: 'networkidle0' });
await expectPath('onboarding/index.html');
assert.equal(await text('#onboarding-question'), 'Vamos personalizar seu treino.');
await page.setViewport(MOBILE);
await page.screenshot({ path: path.join(repoRoot, 'artifacts/forja-visual/onboarding-obrigatorio-390.png') });
await go('');

await check('Calendário e missões funcionam na página inicial', async () => {
  currentLabel = 'inicio';
  assert.equal(await page.$eval('#calendar-heading', el => el.closest('details').open), false,
    'Calendário começa recolhido');
  assert.equal(await page.$eval('#missions-heading', el => el.closest('details').open), false,
    'Missões começam recolhidas');
  await page.click('#calendar-heading');
  await page.click('#missions-heading');
  assert.ok((await page.$$('#calendar-grid .day')).length >= 28, 'Calendário sem dias');
  await page.$eval('#task-input', el => { el.value = 'Missão E2E'; });
  await page.evaluate(() => document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await sleep(120);
  assert.equal(await page.$$eval('#task-list .task', rows => rows.length), 1, 'Missão não foi adicionada');
  await page.$eval('#task-list .task input[type=checkbox]', el => el.scrollIntoView({ block: 'center' }));
  await page.click('#task-list .task input[type=checkbox]');
  await sleep(120);
  assert.equal(await text('#progress-label'), '1 de 1 · 100%');
  const title = await text('#month-title');
  await page.click('#next-month');
  await sleep(120);
  assert.notEqual(await text('#month-title'), title);
  await page.click('#prev-month');
  await sleep(120);
  assert.equal(await text('#month-title'), title);
  await page.screenshot({ path: artifactPath('inicio.png') });
});

await check('Nenhum erro de JavaScript, HTTP ou recurso ausente em todas as páginas', async () => {
  for (const rel of PAGES) {
    errors.length = 0;
    await go(rel);
    assert.deepEqual(errors, [], 'Erros em ' + (rel || 'index'));
  }
});

await check('Sem rolagem horizontal em 320, 360, 390, 430, 768 e 1280 px em todas as páginas', async () => {
  for (const rel of PAGES) {
    await go(rel);
    for (const width of [320, 360, 390, 430, 768, 1280]) {
      await page.setViewport({ width, height: 800 });
      await sleep(120);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, 'Rolagem horizontal de ' + overflow + 'px em ' + (rel || 'index') + ' a ' + width + 'px');
    }
  }
  await page.setViewport(MOBILE);
});

await check('Ação TREINO é compacta, acessível e cabe em 390 px', async () => {
  await go('');
  await page.setViewport(MOBILE);
  await sleep(120);
  const box = await page.$eval('.home-action-button', el => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, centerX: r.left + r.width / 2, vw: window.innerWidth,
      tag: el.tagName, label: el.textContent.trim(), aria: el.getAttribute('aria-label'),
      href: el.getAttribute('href') };
  });
  assert.ok(box.width <= box.vw - 24, 'Ação ultrapassa a viewport');
  assert.ok(box.height >= 44 && box.height < 100, 'Altura não é compacta/acessível: ' + box.height);
  assert.equal(box.tag, 'A', 'Sem rotina, a ação principal precisa ser um link para Treinos');
  assert.equal(box.label, 'Montar meu treino');
  assert.equal(box.aria, 'Montar meu treino');
  assert.match(box.href, /treino\/index\.html/);
  assert.equal(await text('.home-action-title'), 'Monte sua primeira rotina');
  const botao = await page.$('.home-action-button');
  await botao.screenshot({ path: artifactPath('treino-acao-390.png') });
});

await check('Atlas: exercício escolhido, figura anterior/posterior, filtro e detalhe na biblioteca', async () => {
  await go('explorar/atlas.html');

  assert.equal((await page.$$('.figura-svg')).length, 2, 'O atlas precisa das duas vistas da silhueta');
  assert.equal((await page.$$('.figura-region')).length, 0, 'Região destacada sem exercício escolhido');
  assert.equal(await page.$$eval('#atlas-exercise-select option', els => els.length), 38, 'Seletor deveria ter 37 exercícios + vazio');
  assert.match(await text('.atlas-disclosure'), /não uma segmentação anatômica clínica/i);
  const navLabels = await page.$$eval('.bottom-nav-link', els => els.map(e => e.textContent.trim()));
  assert.equal(navLabels.length, 5, 'Barra inferior precisa manter 5 destinos');

  await clickCentered('[data-atlas-focus="shortcut:cal-flexao"]');
  assert.equal(await text('#atlas-figure-title'), 'Flexão de braço');
  assert.equal((await page.$$('.figura-region')).length, 5, 'Flexão deveria destacar 5 formas na silhueta');
  assert.equal(await page.$$eval('.figura-svg text, .figura-svg circle', els => els.length), 0,
    'A figura não deve ter números nem círculos sobrepostos');
  assert.match(await text('#atlas-highlight-summary'), /Principal: Peitoral/);
  const highlightRoles = await page.$$eval('.figura-region', els => els.map(e => e.getAttribute('data-role')));
  assert.ok(highlightRoles.includes('primary') && highlightRoles.includes('secondary'), 'Papéis não chegaram à figura');
  assert.match(await text('.atlas-legenda'), /Tríceps/);
  assert.match(await text('.atlas-legenda'), /Secundária/);

  await clickCentered('[data-group-chip="antebracos"]');
  assert.equal(await page.$$eval('.atlas-exercise-row', els => els.length), 3, 'Antebraços deveria listar 3 exercícios');
  assert.match(await page.$eval('.atlas-exercise-list', el => el.textContent), /Principal/);

  await clickCentered('#atlas-modes [data-value="calisthenics"]');
  assert.match(await text('.atlas-exercise-list .ui-empty-title'), /Nenhum exercício desta modalidade/);
  await clickCentered('.atlas-exercise-list .ui-empty-actions .primary-button');
  assert.equal(await page.$$eval('.atlas-exercise-row', els => els.length), 3, 'Limpar filtro não restaurou a lista');

  await clickCentered('[data-group-chip="panturrilha"]');
  assert.match(await text('.atlas-exercise-list .ui-empty-title'), /Nenhum exercício para este grupo/);

  await clickCentered('.atlas-inline-reset');
  assert.equal(await page.$$('.atlas-exercise-row').then(rows => rows.length), 0, 'Limpar o grupo não esvaziou a lista');

  /* A legenda leva à biblioteca filtrada. */
  await clickCentered('[data-atlas-focus="shortcut:cal-flexao"]');
  const legendHref = await page.$eval('.atlas-legenda-item .atlas-legenda-link', el => el.getAttribute('href'));
  assert.match(legendHref, /biblioteca\.html\?musculo=/);
  await jsClick('.atlas-legenda-item .atlas-legenda-link');
  await expectPath('/treino/biblioteca.html');
  assert.equal(await page.$$eval('#catalog-list .ui-exercise-row', els => els.length), 4,
    'O filtro por peitoral deveria listar 4 exercícios');

  /* Detalhe do exercício mostra a mesma figura. */
  await jsClick('#catalog-list .ui-exercise-row .ui-exercise-main button, #catalog-list .ui-exercise-row .ui-button');
  await page.waitForSelector('.modal-backdrop', { timeout: 4000 });
  assert.equal((await page.$$('.modal-figure .figura-svg')).length, 2, 'O detalhe não mostra as duas vistas');
  assert.match(await text('.modal-details'), /Grupos musculares — principal: peito/);
  await page.evaluate(() => document.querySelector('.modal-card').scrollTo(0, 0));
  await sleep(120);
  await page.screenshot({ path: artifactPath('biblioteca-figura-390.png') });
  await page.click('[data-modal-action="cancel"]');
  await sleep(120);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, 'Rolagem horizontal no atlas: ' + overflow);
  await go('explorar/atlas.html?exercicio=cal-flexao');
  await sleep(150);
  await page.screenshot({ path: artifactPath('atlas-390.png'), fullPage: true });
});

await check('Atlas: prancha única íntegra, duas vistas alinhadas e destaques sobre o corpo', async () => {
  await go('explorar/atlas.html?exercicio=cal-flexao');
  const audit = await page.evaluate(async base => {
    const loadImage = async relative => {
      const image = new Image();
      image.src = base + relative;
      await image.decode();
      return image;
    };
    const manifest = await fetch(base + 'assets/anatomia/manifest.json').then(response => {
      if (!response.ok) throw new Error('Manifesto anatômico HTTP ' + response.status);
      return response.json();
    });
    const referenceResponse = await fetch(base + 'assets/anatomia/' + manifest.reference.file);
    const referenceBytes = await referenceResponse.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', referenceBytes)))
      .map(byte => byte.toString(16).padStart(2, '0')).join('');

    const reference = await loadImage('assets/anatomia/' + manifest.reference.file);
    const mask = await loadImage('assets/anatomia/' + manifest.mask.file);
    const ink = await loadImage('assets/anatomia/' + manifest.ink.file);

    const failures = {
      file: [],
      framing: [],
      region: [],
      window: []
    };

    if (digest !== manifest.reference.sha256) failures.file.push('sha256 diverge do manifesto: ' + digest);
    if (reference.naturalWidth !== 1536 || reference.naturalHeight !== 1024) {
      failures.file.push('referência ' + reference.naturalWidth + '×' + reference.naturalHeight);
    }
    [mask, ink].forEach(image => {
      if (image.naturalWidth !== reference.naturalWidth || image.naturalHeight !== reference.naturalHeight) {
        failures.file.push('máscara fora do tamanho da referência: ' +
          image.naturalWidth + '×' + image.naturalHeight);
      }
    });

    const pixels = image => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const referencePixels = pixels(reference);
    const maskPixels = pixels(mask);
    const inkPixels = pixels(ink);
    const alphaAt = (data, x, y) => {
      if (x < 0 || y < 0 || x >= 1536 || y >= 1024) return 0;
      return data[((y | 0) * 1536 + (x | 0)) * 4 + 3];
    };
    const luminanceAt = (x, y) => {
      if (x < 0 || y < 0 || x >= 1536 || y >= 1024) return 0;
      const offset = ((y | 0) * 1536 + (x | 0)) * 4;
      return Math.max(referencePixels[offset], referencePixels[offset + 1], referencePixels[offset + 2]);
    };

    /* A tinta é subconjunto da silhueta: nada pode ser pintado fora do corpo
       nem sobre as linhas claras do desenho. */
    let inkOutside = 0;
    let inkOnLines = 0;
    let inkTotal = 0;
    for (let index = 0; index < 1536 * 1024; index += 1) {
      if (inkPixels[index * 4 + 3] === 0) continue;
      inkTotal += 1;
      const x = index % 1536;
      const y = Math.floor(index / 1536);
      if (maskPixels[index * 4 + 3] === 0) inkOutside += 1;
      if (luminanceAt(x, y) >= manifest.ink.ramp) inkOnLines += 1;
    }
    if (inkTotal < 200000 || inkOutside !== 0 || inkOnLines !== 0) {
      failures.file.push('tinta inválida: ' + inkTotal + ' px, ' + inkOutside + ' fora da silhueta, ' +
        inkOnLines + ' sobre linhas claras');
    }

    const figures = {};
    document.querySelectorAll('.figura-svg').forEach(svgEl => {
      figures[svgEl.dataset.view] = svgEl;
    });

    /* A prancha é o arquivo único, com a janela de cada vista. */
    for (const view of ['front', 'back']) {
      const figure = figures[view];
      if (!figure) {
        failures.window.push('vista ausente: ' + view);
        continue;
      }
      const plate = figure.querySelector('image.figura-plate');
      const bodyMaskImage = figure.querySelector('mask.figura-body-mask image.figura-mask-plate');
      const inkMaskImage = figure.querySelector('mask.figura-ink-mask image.figura-mask-plate');
      const crop = manifest.views[view].crop;
      const href = plate.getAttribute('href').split('/').slice(-2).join('/');
      if (href !== 'fontes/referencia-muscular.png') failures.window.push(view + ': href ' + href);
      if (plate.getAttribute('x') !== String(-crop.x)) failures.window.push(view + ': x ' + plate.getAttribute('x'));
      if (plate.getAttribute('y') !== String(-crop.y)) failures.window.push(view + ': y ' + plate.getAttribute('y'));
      if (plate.getAttribute('width') !== '1536' || plate.getAttribute('height') !== '1024') {
        failures.window.push(view + ': tamanho da imagem ' + plate.getAttribute('width') + '×' + plate.getAttribute('height'));
      }
      [bodyMaskImage, inkMaskImage].forEach(maskImage => {
        if (!maskImage) {
          failures.window.push(view + ': máscara ausente');
          return;
        }
        ['x', 'y', 'width', 'height'].forEach(attribute => {
          if (maskImage.getAttribute(attribute) !== plate.getAttribute(attribute)) {
            failures.window.push(view + ': máscara com ' + attribute + ' diferente da prancha');
          }
        });
      });

      /* Corpo inteiro dentro da janela, com margem em todos os lados. */
      let left = 1536;
      let right = -1;
      let top = 1024;
      let bottom = -1;
      for (let y = 0; y < crop.height; y += 1) {
        for (let x = 0; x < crop.width; x += 1) {
          if (alphaAt(maskPixels, crop.x + x, crop.y + y) === 0) continue;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
      if (top < 2 || bottom > crop.height - 3 || left < 2 || right > crop.width - 3) {
        failures.framing.push(view + ': corpo em ' + JSON.stringify({ left, top, right, bottom }));
      }
      if (Math.abs(left - manifest.views[view].body.left) > 1 ||
          Math.abs(bottom - manifest.views[view].body.bottom) > 1) {
        failures.framing.push(view + ': limites divergem do manifesto');
      }

      /* A silhueta precisa alcançar cabeça e pés: nada cortado. */
      const columnInk = (x) => {
        let count = 0;
        for (let y = crop.y; y < crop.y + crop.height; y += 1) {
          if (alphaAt(maskPixels, crop.x + x, y) > 0) count += 1;
        }
        return count;
      };
      if (columnInk(left + 1) < 1 || columnInk(right - 1) < 1) {
        failures.framing.push(view + ': extremos laterais vazios');
      }
    }

    /* Cada caminho: fechado, dentro da silhueta e com tinta suficiente para
       aparecer. A curva é percorrida de verdade, como no navegador. */
    const NS = 'http://www.w3.org/2000/svg';
    const geometry = document.createElementNS(NS, 'svg');
    geometry.setAttribute('viewBox', '0 0 600 1024');
    geometry.setAttribute('width', '600');
    geometry.setAttribute('height', '1024');
    geometry.style.position = 'fixed';
    geometry.style.left = '-10000px';
    geometry.style.top = '0';
    document.body.appendChild(geometry);

    for (const view of ['front', 'back']) {
      const offset = manifest.views[view].crop.x;
      for (const [regionId, region] of Object.entries(window.Forja.figura.REGIONS)) {
        const shapes = window.Forja.figura.shapesFor(regionId, view) || [];
        shapes.forEach((shape, index) => {
          const path = document.createElementNS(NS, 'path');
          path.setAttribute('d', shape);
          geometry.appendChild(path);
          const box = path.getBBox();
          const length = path.getTotalLength();
          const samples = 40;
          let outside = 0;
          for (let step = 0; step < samples; step += 1) {
            const point = path.getPointAtLength(length * step / samples);
            let inside = false;
            for (let dy = -3; dy <= 3 && !inside; dy += 1) {
              for (let dx = -3; dx <= 3 && !inside; dx += 1) {
                if (alphaAt(maskPixels, point.x + offset + dx, point.y + dy) > 0) inside = true;
              }
            }
            if (!inside) outside += 1;
          }

          let inked = 0;
          let total = 0;
          for (let row = 0; row < 12; row += 1) {
            for (let column = 0; column < 8; column += 1) {
              const px = box.x + box.width * (column + 0.5) / 8;
              const py = box.y + box.height * (row + 0.5) / 12;
              total += 1;
              if (alphaAt(inkPixels, px + offset, py) > 0) inked += 1;
            }
          }

          if (box.x < 0 || box.y < 0 || box.x + box.width > 600 || box.y + box.height > 1024 ||
              !Number.isFinite(length) || length < 20 || outside > 2 || inked / total < 0.5) {
            failures.region.push(view + '/' + regionId + '[' + index + ']: ' + outside + '/' + samples +
              ' amostras fora, ' + inked + '/' + total + ' com tinta; bbox=' +
              JSON.stringify({ x: box.x, y: box.y, width: box.width, height: box.height }));
          }
          path.remove();
        });
      }
    }
    geometry.remove();

    const roles = {};
    for (const role of ['primary', 'secondary', 'stabilizer']) {
      const shape = document.querySelector('.figura-region.is-' + role + ' .figura-region-shape');
      const outline = document.querySelector('.figura-region.is-' + role + ' .figura-region-outline');
      if (!shape || !outline) {
        roles[role] = null;
        continue;
      }
      const shapeStyle = getComputedStyle(shape);
      const outlineStyle = getComputedStyle(outline);
      roles[role] = {
        fill: shapeStyle.fill,
        opacity: shapeStyle.fillOpacity,
        blend: shapeStyle.mixBlendMode,
        stroke: outlineStyle.stroke,
        outlineBlend: outlineStyle.mixBlendMode
      };
    }
    return { failures, roles };
  }, BASE);

  assert.deepEqual(audit.failures.file, [], 'A referência e as máscaras precisam ser as registradas');
  assert.deepEqual(audit.failures.window, [], 'Cada vista precisa recortar a metade certa do arquivo único');
  assert.deepEqual(audit.failures.framing, [], 'Cabeça, mãos ou pés fora do enquadramento');
  assert.deepEqual(audit.failures.region, [], 'Destaques desalinhados da anatomia visível');

  /* Cor no preenchimento e no contorno, sem blend: o detalhe vem da máscara
     de tinta, que preserva as linhas claras do desenho. */
  assert.deepEqual(audit.roles, {
    primary: { fill: 'rgb(183, 243, 74)', opacity: '0.92', blend: 'normal', stroke: 'rgb(183, 243, 74)', outlineBlend: 'normal' },
    secondary: { fill: 'rgb(242, 184, 75)', opacity: '0.9', blend: 'normal', stroke: 'rgb(242, 184, 75)', outlineBlend: 'normal' },
    stabilizer: { fill: 'rgb(140, 192, 224)', opacity: '0.88', blend: 'normal', stroke: 'rgb(140, 192, 224)', outlineBlend: 'normal' }
  });

  /* Redimensionar não pode deslocar as áreas interativas: a razão entre a
     caixa do destaque e a caixa da prancha precisa ficar constante. */
  const ratios = [];
  for (const width of [320, 360, 390, 430, 768, 1280]) {
    await page.setViewport({ width, height: 900 });
    await sleep(140);
    const measured = await page.evaluate(() => {
      const notHidden = node => node.getClientRects().length > 0;
      return Array.from(document.querySelectorAll('.figura-svg')).filter(notHidden).map(svgEl => {
        const plate = svgEl.querySelector('image.figura-plate').getBoundingClientRect();
        const shape = svgEl.querySelector('.figura-region-shape').getBoundingClientRect();
        const outline = svgEl.querySelector('.figura-region-outline').getBoundingClientRect();
        return {
          view: svgEl.dataset.view,
          width: Math.round(plate.width),
          x: (shape.x - plate.x) / plate.width,
          y: (shape.y - plate.y) / plate.height,
          w: shape.width / plate.width,
          h: shape.height / plate.height,
          outlineMatches: Math.abs(outline.x - shape.x) < 0.6 && Math.abs(outline.width - shape.width) < 0.6
        };
      });
    });
    assert.equal(measured.length, 2, 'As duas vistas precisam estar visíveis em ' + width + 'px');
    ratios.push({ width, measured });
    const canvasWidth = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(canvasWidth, 0, 'Rolagem horizontal em ' + width + 'px');
  }
  await page.setViewport(MOBILE);
  await sleep(120);

  const baseline = ratios[0].measured;
  ratios.forEach(entry => {
    entry.measured.forEach((item, index) => {
      const reference = baseline[index];
      assert.equal(item.view, reference.view);
      assert.ok(Math.abs(item.x - reference.x) < 0.01 && Math.abs(item.y - reference.y) < 0.01,
        'Destaque deslocado ao redimensionar para ' + entry.width + 'px: ' +
        JSON.stringify({ now: [item.x, item.y], base: [reference.x, reference.y] }));
      assert.ok(Math.abs(item.w - reference.w) < 0.01 && Math.abs(item.h - reference.h) < 0.01,
        'Destaque mudou de tamanho relativo em ' + entry.width + 'px');
      assert.ok(item.outlineMatches, 'Contorno e preenchimento divergiram em ' + entry.width + 'px');
    });
  });
  assert.ok(baseline[0].w > 0.05 && baseline[0].h > 0.02, 'Destaque pequeno demais no layout real');
});

await check('Alvos de toque principais têm pelo menos 44px de altura', async () => {
  await go('treino/');
  const small = await page.$$eval('.modality-card, .primary-button, .secondary-button:not(.small-button)', els =>
    els.filter(e => e.getClientRects().length > 0).map(e => Math.round(e.getBoundingClientRect().height) + ' ' + e.textContent.trim().slice(0, 30))
      .filter(s => parseInt(s, 10) < 44)
  );
  assert.deepEqual(small, []);
});

await check('Navegação por seções: início → TREINO → hub → CALISTENIA e MUSCULAÇÃO → voltar', async () => {
  await go('');
  await jsClick('a[href="treino/index.html"], a[href="treino/"]');
  await expectPath('/treino/');
  assert.equal(await text('h1'), 'TREINO', 'Título do hub');
  assert.ok(await page.$('a#mode-calisthenics'), 'Cartão de calistenia');
  assert.ok(await page.$('a#mode-weights'), 'Cartão de musculação');
  assert.ok(await page.$('[aria-current="page"]'), 'Seção atual não indicada');

  await jsClick('#mode-calisthenics');
  await expectPath('/treino/calistenia.html');
  assert.match(await text('#modality-title'), /^CALISTENIA$/);
  await jsClick('#back-to-modality, a[href*="treino/index.html"]');
  await expectPath('/treino/index.html');

  await jsClick('#mode-weights');
  await expectPath('/treino/musculacao.html');
  assert.match(await text('#modality-title'), /^MUSCULAÇÃO$/);
  await page.screenshot({ path: artifactPath('musculacao.png') });
});

await check('Criar rotina de calistenia com exercício da biblioteca e personalizado por duração', async () => {
  await go('treino/calistenia.html');
  await jsClick('#new-routine');
  await page.waitForSelector('[data-modal-field="name"]', { timeout: 4000 });
  await fill('[data-modal-field="name"]', 'Treino A');
  await jsClick('[data-modal-action="create"]');
  await expectPath('/treino/rotina.html');

  await jsClick('#library-toggle');
  await fill('#library-search', 'agach');
  await sleep(100);
  await jsClick('#library-list .library-item .secondary-button', /Adicionar/);
  await sleep(100);

  await jsClick('#custom-toggle');
  await fill('#custom-name', 'Prancha E2E');
  await jsClick('#custom-type-duration');
  await fill('#custom-duration', 2);
  await fill('#custom-sets', 1);
  await page.evaluate(() => document.getElementById('custom-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await sleep(150);
  await fill('#library-search', 'Prancha E2E');
  await sleep(100);
  await jsClick('#library-list .library-item .secondary-button', /Adicionar/);
  await sleep(100);

  await jsClick('#save-routine');
  await sleep(200);
  assert.match(await text('#editor-save-note, #editor-dirty-pill'), /salv|Salv|alter/, 'Salvamento sem confirmação visível');
  await jsClick('#back-to-modality');
  await expectPath('/treino/calistenia.html');
  assert.ok(await waitFor(() => document.querySelectorAll('#routine-list .routine-card').length === 1), 'Rotina não listada');
  assert.match(await text('#routine-list .routine-name'), /Treino A/);

  const stored = await data('forja-treino-rotinas-v1');
  const routine = stored.calisthenics[0];
  assert.equal(routine.sections.main.length + routine.sections.abs.length + routine.sections.finisher.length + routine.sections.warmup.length, 2);
  assert.equal((await data('forja-treino-rotinas-v1')).weights.length, 0, 'Musculação recebeu rotina de calistenia');
  await page.screenshot({ path: artifactPath('rotina-criada.png') });
});

await check('Editar rotina e musculação mantém listas separadas', async () => {
  await go('treino/musculacao.html');
  assert.equal(await page.$$eval('#routine-list .routine-card', c => c.length), 0, 'Musculação mostra rotinas de calistenia');
  await go('treino/calistenia.html');
  await jsClick('#routine-list .routine-card a.secondary-button, #routine-list .routine-card a[href*="rotina"]');
  await expectPath('/treino/rotina.html');
  await fill('#routine-name-input', 'Treino A2');
  await jsClick('#save-routine');
  await sleep(200);
  await jsClick('#back-to-modality');
  await expectPath('/treino/calistenia.html');
  assert.match(await text('#routine-list .routine-name'), /Treino A2/);
});

await check('Iniciar rotina, cronômetro por duração, pausa e descanso', async () => {
  await go('treino/calistenia.html');
  await jsClick('#routine-list .routine-start');
  await expectPath('/treino/executar.html');
  assert.ok(await isVisible('#execution-live'), 'Tela de execução não visível');
  assert.match(await text('#current-name'), /^Agachamento/);

  /* A execução reaproveita a figura do atlas para o exercício atual. */
  assert.ok(await isVisible('#execution-figure'), 'Execução sem figura do exercício com metadados');
  assert.equal((await page.$$('#execution-figure .figura-svg, #execution-figure-body .figura-svg')).length, 1,
    'A figura da execução deveria ter uma vista');
  assert.match(await page.$eval('#execution-figure .figura-svg', el => el.getAttribute('aria-label')), /Modelo anatômico muscular/);
  await page.$eval('#execution-figure-details', el => el.scrollIntoView({ block: 'center' }));
  await sleep(180);
  const detailsCovered = await page.$eval('#execution-figure-details', el => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return JSON.stringify({ ok: top === el || el.contains(top), top: top ? top.tagName + '.' + String(top.className) : null, box: { top: Math.round(box.top), height: Math.round(box.height) }, vh: innerHeight });
  });
  if (JSON.parse(detailsCovered).ok !== true) assert.fail('Botão de detalhes coberto por outro elemento: ' + detailsCovered);
  await jsClick('#execution-figure-details');
  await page.waitForSelector('.modal-backdrop', { timeout: 4000 });
  assert.equal(await text('#modal-title'), 'Músculos trabalhados');
  assert.equal((await page.$$('.modal-details .figura-svg')).length, 2, 'O detalhe na execução não tem as duas vistas');
  await page.click('[data-modal-action="close"]');
  await sleep(150);

  await page.screenshot({ path: artifactPath('executar-ativo-390.png') });

  // Conclui as séries de Agachamento (pulando descansos) até chegar à prancha.
  await advanceUntil(/^Prancha E2E/);

  /* Exercício sem classificação muscular: a figura some em vez de inventar. */
  assert.equal(await isVisible('#execution-figure'), false,
    'A execução mostrou figura para exercício sem metadados');
  // Prancha por duração de 2 s, medida com timestamps reais.
  await jsClick('#set-timer-start');
  await sleep(700);
  await jsClick('#set-timer-pause');
  const paused = await text('#set-timer-display');
  await sleep(1200);
  assert.equal(await text('#set-timer-display'), paused, 'Cronômetro não pausou');
  await jsClick('#set-timer-resume');
  await sleep(1700);
  const done = await waitFor(() => {
    const s = JSON.parse(localStorage.getItem('forja-treino-sessao-ativa-v1') || 'null');
    return !s || Object.values(s.completedSets || {}).every(Boolean) || !!document.querySelector('#execution-summary:not([hidden])');
  }, 4000);
  assert.ok(done, 'Prancha por duração não concluiu ao atingir o tempo');
  await page.screenshot({ path: artifactPath('executar.png') });
});

await check('Sessão ativa sobrevive à navegação e ao recarregamento', async () => {
  // Nova sessão para testar o estado intermediário.
  await go('treino/calistenia.html');
  await jsClick('#routine-list .routine-start');
  await expectPath('/treino/executar.html');
  await jsClick('#complete-set');
  await sleep(300);
  const name = await text('#current-name');

  await go('progresso/');
  assert.ok(await isVisible('#active-session-banner'), 'Banner de sessão ativa ausente em progresso');
  await jsClick('#resume-active-session');
  await expectPath('/treino/executar.html');
  /* A URL muda antes do primeiro render da execução: esperar o nome evita
     ler '#current-name' ainda vazio (intermitente em máquina carregada). */
  const nameReady = () => {
    const el = document.querySelector('#current-name');
    return Boolean(el && el.textContent.trim());
  };
  assert.ok(await waitFor(nameReady, 6000), 'Nome do exercício não renderizou após retomar');
  assert.equal(await text('#current-name'), name);

  await page.reload({ waitUntil: 'networkidle0' });
  assert.ok(await isVisible('#execution-live'), 'Sessão não sobreviveu ao recarregamento');
  assert.ok(await waitFor(nameReady, 6000), 'Nome do exercício não renderizou após recarregar');
  assert.equal(await text('#current-name'), name);
});

await check('Pausar sessão, descanso com pular e confirmação antes de descartar', async () => {
  await go('treino/executar.html');
  await jsClick('#pause-session');
  assert.ok(await isVisible('#session-paused-overlay'), 'Overlay de pausa');
  await jsClick('#resume-session');
  assert.ok(!(await isVisible('#session-paused-overlay')), 'Overlay não fechou');

  // Descanso: a sessão pode ter um exercício com descanso; apenas confirmamos o controle.
  const hasRest = await page.$('#start-rest');
  assert.ok(hasRest, 'Botão de descanso ausente');

  await jsClick('#end-session');
  await page.waitForSelector('[data-modal-action]', { timeout: 4000 });
  await jsClick('[data-modal-action="cancel"], [data-modal-action="close"]');
  await sleep(150);
  assert.ok(await data('forja-treino-sessao-ativa-v1'), 'Cancelar o descarte removeu a sessão');
});

await check('Finalizar sessão mostra resumo e grava no histórico de progresso', async () => {
  await go('treino/executar.html');
  // Conclui séries restantes até o resumo, sempre pelo botão de série.
  for (let i = 0; i < 12; i++) {
    const summary = await isVisible('#execution-summary');
    if (summary) break;
    const live = await isVisible('#execution-live');
    if (!live) break;
    const disabled = await page.$eval('#complete-set', b => b.disabled).catch(() => true);
    if (!disabled) {
      await jsClick('#complete-set');
      await sleep(450);
    } else if (await isVisible('#execution-rest')) {
      await jsClick('#skip-rest');
      await sleep(150);
    } else if (await isVisible('#set-timer-skip')) {
      await jsClick('#set-timer-skip');
      await sleep(150);
    } else {
      await jsClick('#next-exercise');
      await sleep(150);
    }
  }
  if (!(await isVisible('#execution-summary'))) {
    await jsClick('#end-session');
    await page.waitForSelector('[data-modal-action]', { timeout: 4000 });
    await jsClick('[data-modal-action]:not([data-modal-action="cancel"]):not([data-modal-action="close"])');
  }
  assert.ok(await waitFor(() => !!document.querySelector('#execution-summary:not([hidden])'), 4000), 'Resumo não apareceu');
  assert.equal(await data('forja-treino-sessao-ativa-v1'), null, 'Sessão ativa não foi limpa');

  const history = await data('forja-treino-historico-v1');
  assert.ok(Array.isArray(history) && history.length >= 1, 'Histórico vazio');
  assert.ok(['completed', 'partial'].includes(history[0].status));

  await go('progresso/');
  assert.ok(Number(await text('#progress-sessions')) >= 1, 'Progresso sem sessões');
  assert.ok(await page.$('#progress-history .history-item'), 'Histórico não listado');
  await go('progresso/?modalidade=weights');
  assert.equal(await text('#progress-sessions'), '0', 'Filtro por modalidade não separa');
  await page.screenshot({ path: artifactPath('progresso.png') });
});

await check('Progresso: calendário, gráficos, recordes, metas e busca com histórico real', async () => {
  /*
    Histórico sintético com três semanas de Supino (carga crescente), uma
    Remada e uma corrida por distância. Datas relativas a agora: o calendário
    e as metas usam a semana corrente do navegador.
  */
  const now = Date.now();
  const DAY = 86400000;
  const keyFor = days => {
    const d = new Date(now - days * DAY);
    const two = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  };
  const log = (set, reps, load, extra = {}) => Object.assign({
    set, reps: String(reps), load: load === null ? '' : String(load), seconds: 0,
    distance: null, rpe: null, editedAt: null
  }, extra);
  const exercise = (name, logs, extra = {}) => Object.assign({
    id: 'e2e-' + name.toLowerCase().replace(/\s+/g, '-'),
    name, section: 'main', plannedSets: logs.length, completedSets: logs.length,
    reps: '10', duration: 45, type: 'reps', rest: 60, load: '', notes: '',
    distance: null, distanceUnit: 'm', logs,
    timedSeconds: logs.reduce((sum, entry) => sum + (Number(entry.seconds) || 0), 0)
  }, extra);
  const session = (days, loads, extra = {}) => {
    const exercises = [exercise('Supino', loads.map((load, index) => log(index + 1, 10 - index, load)))];
    if (extra.remada) exercises.push(exercise('Remada curvada', [log(1, 10, 30)]));
    if (extra.corrida) exercises.push(exercise('Corrida', [log(1, '', null, { distance: 1.2 })], { distanceUnit: 'km', measure: 'distance' }));
    const date = new Date(now - days * DAY);
    const completedSets = exercises.reduce((sum, item) => sum + item.completedSets, 0);
    return {
      id: 'e2e-progresso-' + days,
      date: keyFor(days),
      finishedAt: date.toISOString(),
      modality: 'weights',
      routineName: extra.routineName || 'Peito e ombro',
      durationMs: 35 * 60000,
      completedSets,
      totalPlannedSets: completedSets,
      status: 'completed',
      exercises,
      feedback: extra.note ? { rpe: 8, note: extra.note } : { rpe: null, note: '' },
      totals: {
        volumeKg: exercises.reduce((sum, item) => sum + item.logs.reduce((acc, entry) => {
          return acc + (Number(entry.reps) || 0) * (Number(entry.load) || 0);
        }, 0), 0),
        reps: exercises.reduce((sum, item) => sum + item.logs.reduce((acc, entry) => acc + (Number(entry.reps) || 0), 0), 0),
        seconds: 0,
        distanceMeters: extra.corrida ? 1200 : 0,
        setsLogged: completedSets,
        setsWithoutVolume: extra.corrida ? 1 : 0
      }
    };
  };

  const history = [
    session(1, [40, 35], { remada: true, note: 'Ombro esquerdo sensível' }),
    session(8, [35, 30]),
    session(15, [30], { corrida: true })
  ];

  await go('progresso/');
  await page.evaluate(list => localStorage.setItem('forja-treino-historico-v1', JSON.stringify(list)), history);
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(200);

  assert.equal(await text('#progress-sessions'), '3', 'Resumo do progresso não usou o histórico');
  assert.equal(await page.$$eval('#progress-frequency .ui-heatmap-cell', cells => cells.length), 84, 'Calendário de frequência incompleto');
  assert.ok(await page.$('#progress-frequency .ui-heatmap-cell.level-1, #progress-frequency .ui-heatmap-cell.level-2, #progress-frequency .ui-heatmap-cell.level-3, #progress-frequency .ui-heatmap-cell.level-4'), 'Nenhum dia treinado marcado no calendário');
  assert.equal(await page.$$eval('#progress-weekly .ui-column', columns => columns.length), 8, 'Gráfico semanal incompleto');
  assert.ok(await page.$('#progress-weekly .ui-bars'), 'Gráfico de séries por semana ausente');

  /* Evolução: Supino vem selecionado (mais treinos) com três pontos reais. */
  assert.match(await page.$eval('#evolution-select', select => select.value), /supino/);
  assert.ok(await page.$('#progress-evolution .ui-line-svg'), 'Linha de evolução ausente');
  assert.equal(await page.$$eval('#progress-evolution .ui-line-dot', dots => dots.length), 3, 'Evolução com número errado de pontos');
  assert.match(await text('#progress-evolution'), /Melhor registro: 40 kg/);

  /* Recordes com critério visível. */
  assert.equal(await text('[data-record="load"] .record-value'), '40 kg');
  assert.match(await text('[data-record="load"]'), /Critério:.*kg/i);
  assert.match(await text('#records-note'), /série mais longa/);

  /* Metas: só grava ao salvar e persiste depois do recarregamento. */
  assert.equal(await data('forja-treino-metas-v1'), null, 'Abrir progresso gravou metas');
  await fill('#goal-sessions', 3);
  await fill('#goal-sets', 6);
  await fill('#goal-minutes', 75);
  await jsClick('#goals-save');
  await sleep(150);
  const goals = await data('forja-treino-metas-v1');
  assert.equal(goals.weeklySessions, 3, 'Meta de treinos não foi salva');
  assert.equal(await page.$$eval('#goals-progress .ui-ring', rings => rings.length), 3, 'Metas salvas não viraram anéis');

  /* Busca no histórico. */
  await fill('#history-search', 'remada');
  await sleep(150);
  assert.equal(await page.$$eval('#progress-history .history-item', items => items.length), 1, 'Busca não filtrou o histórico');
  await fill('#history-search', '');
  await sleep(120);
  assert.equal(await page.$$eval('#progress-history .history-item', items => items.length), 3, 'Limpar a busca não restaurou o histórico');

  /* Capturas e overflow em 320/390/768/1280 px, com metas e dados na tela. */
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewport({ width, height: 900 });
    await sleep(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, 'Overflow em progresso a ' + width + 'px: ' + overflow);
  }
  await page.setViewport({ width: 390, height: 844 });
  await sleep(120);
  await page.screenshot({ path: artifactPath('progresso-etapa5-390.png'), fullPage: true });
  await page.setViewport({ width: 1280, height: 900 });
  await sleep(120);
  await page.screenshot({ path: artifactPath('progresso-etapa5-1280.png'), fullPage: true });
  await page.setViewport(MOBILE);
});

await check('Configurações: exportar, rejeitar importação inválida, importar com confirmação e desfazer', async () => {
  await go('configuracoes/');
  const beforeRoutines = await data('forja-treino-rotinas-v1');
  await page.evaluate(() => { document.getElementById('export-backup').click(); });
  let exported = null;
  for (let i = 0; i < 60 && !fs.readdirSync(artifactsDir).some(f => f.endsWith('.json')); i++) await sleep(100);
  const files = fs.readdirSync(artifactsDir).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 1, 'Exportação não baixou arquivo');
  exported = files[0];
  const backup = JSON.parse(fs.readFileSync(path.join(artifactsDir, exported), 'utf8'));
  assert.equal(backup.format, 'forja-backup');
  assert.ok(backup.keys['forja-treino-rotinas-v1'], 'Backup sem rotinas');

  // Importação inválida é recusada.
  const bad = artifactPath('invalido.json');
  fs.writeFileSync(bad, '{"not":"forja"}');
  const input = await page.$('#import-backup-input');
  await input.uploadFile(bad);
  await sleep(300);
  assert.ok(!(await isVisible('[data-modal-action="restore"]')), 'Importação inválida abriu confirmação');

  // Importação válida (com uma rotina extra) pede confirmação.
  const modified = JSON.parse(JSON.stringify(backup));
  modified.keys['forja-treino-rotinas-v1'] = { ...beforeRoutines, weights: [] };
  modified.keys['forja-treino-rotinas-v1'].calisthenics = [];
  const good = artifactPath('valido.json');
  fs.writeFileSync(good, JSON.stringify(modified));
  await (await page.$('#import-backup-input')).uploadFile(good);
  await page.waitForSelector('[data-modal-action="restore"]', { timeout: 4000 });
  assert.deepEqual(await data('forja-treino-rotinas-v1'), beforeRoutines, 'Importação aplicou sem confirmação');
  await jsClick('[data-modal-action="restore"]');
  await sleep(300);
  assert.equal((await data('forja-treino-rotinas-v1')).calisthenics.length, 0, 'Importação não aplicou');

  // Desfazer a última restauração.
  await jsClick('#restore-safety-backup');
  await page.waitForSelector('[data-modal-action="restore"]', { timeout: 4000 });
  await jsClick('[data-modal-action="restore"]');
  await sleep(300);
  assert.ok((await data('forja-treino-rotinas-v1')).calisthenics.length >= 1, 'Desfazer não restaurou');
  await page.screenshot({ path: artifactPath('configuracoes.png') });
});

await check('Perfil: inicializa, checkboxes refletem o armazenado e abrir a página não grava nada', async () => {
  const saved = await forjaRaw();
  const spy = await page.evaluateOnNewDocument(installWriteSpy);
  try {
    const cases = [
      [null, [true, true]],
      [{ soundOnRest: false, vibrateOnRest: true }, [false, true]],
      [{ soundOnRest: true, vibrateOnRest: false }, [true, false]],
      [{ soundOnRest: false, vibrateOnRest: false }, [false, false]]
    ];
    for (const [stored, expected] of cases) {
      await page.evaluate((key, value) => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
      }, PREFS_KEY, stored);

      for (const rel of ['perfil/', 'configuracoes/']) {
        const where = rel + ' com ' + JSON.stringify(stored);
        const before = await forjaRaw();
        await go(rel);
        await sleep(600); // alguns ciclos do intervalo único de 250 ms
        const state = await page.evaluate(() => ({
          shared: typeof window.Forja.pages.perfil === 'function' &&
            window.Forja.pages.perfil === window.Forja.pages.configuracoes,
          boxes: [document.getElementById('pref-sound').checked, document.getElementById('pref-vibrate').checked],
          memory: window.Forja.state.preferences,
          undoHidden: document.getElementById('restore-safety-backup').hidden,
          safety: localStorage.getItem('forja-backup-seguranca-v1') !== null,
          writes: window.__forjaWrites.slice()
        }));
        assert.ok(state.shared, 'Perfil sem o controlador compartilhado (' + where + ')');
        assert.deepEqual(state.boxes, expected, 'Checkboxes não refletem o armazenado em ' + where);
        assert.deepEqual(state.memory, { soundOnRest: expected[0], vibrateOnRest: expected[1] }, 'Memória do descanso diverge em ' + where);
        assert.equal(state.undoHidden, !state.safety, 'Botão de desfazer não reflete a cópia de segurança em ' + where);
        assert.deepEqual(state.writes, [], 'Abrir ' + where + ' gravou: ' + state.writes.join(', '));
        assert.deepEqual(await forjaRaw(), before, 'Conteúdo mudou ao abrir ' + where);
      }
    }
    await page.screenshot({ path: artifactPath('perfil.png') });
  } finally {
    await page.removeScriptToEvaluateOnNewDocument(spy.identifier);
    await restoreForjaRaw(saved);
  }
});

await check('Perfil: exportar, rejeitar importação inválida, importar com confirmação e desfazer', async () => {
  const downloadDir = fs.mkdtempSync(path.join(artifactsDir, 'perfil-downloads-'));
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  try {
    await go('perfil/');
    assert.equal(await page.evaluate(() => document.body.dataset.page), 'perfil');
    const before = await forjaData([SAFETY_KEY]);
    assert.ok(before['forja-treino-rotinas-v1'], 'O fluxo anterior deveria ter deixado rotinas');

    /* Exportar pelo botão do próprio Perfil. */
    await clickCentered('#export-backup');
    let files = [];
    for (let i = 0; i < 60; i++) {
      files = fs.readdirSync(downloadDir).filter(f => /^forja-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f));
      if (files.length) break;
      await sleep(100);
    }
    assert.equal(files.length, 1, 'Exportar no Perfil não baixou o arquivo: ' + fs.readdirSync(downloadDir).join(', '));
    const backup = JSON.parse(fs.readFileSync(path.join(downloadDir, files[0]), 'utf8'));
    assert.equal(backup.app, 'FORJA');
    assert.equal(backup.format, 'forja-backup');
    assert.deepEqual(backup.keys, before, 'O backup exportado no Perfil difere do armazenamento');
    assert.match(await text('#backup-status'), /Último backup exportado em/);

    /* Inválido: recusado com explicação, nada muda (nem a cópia de segurança). */
    const safetyBefore = await page.evaluate(key => localStorage.getItem(key), SAFETY_KEY);
    const bad = artifactPath('perfil-invalido.json');
    fs.writeFileSync(bad, JSON.stringify({ app: 'OUTRO', format: 'forja-backup', version: 1, keys: {} }));
    await (await page.$('#import-backup-input')).uploadFile(bad);
    await page.waitForSelector('[data-modal-action="close"]', { timeout: 4000 });
    assert.match(await text('#modal-title'), /Backup inválido/);
    assert.equal(await page.$('[data-modal-action="restore"]'), null, 'Importação inválida abriu a confirmação');
    await jsClick('[data-modal-action="close"]');
    assert.deepEqual(await forjaData([SAFETY_KEY]), before, 'Importação inválida alterou dados');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), SAFETY_KEY), safetyBefore,
      'Importação inválida mexeu na cópia de segurança');

    /* Válido: só aplica depois de confirmar; os checkboxes acompanham. */
    const modified = JSON.parse(JSON.stringify(backup));
    modified.keys['forja-missoes-2030-01-01'] = [{ id: 'e2e-perfil', text: 'Importada pelo Perfil', done: false }];
    modified.keys[PREFS_KEY] = { soundOnRest: false, vibrateOnRest: false };
    const good = artifactPath('perfil-valido.json');
    fs.writeFileSync(good, JSON.stringify(modified));
    await (await page.$('#import-backup-input')).uploadFile(good);
    await page.waitForSelector('[data-modal-action="restore"]', { timeout: 4000 });
    assert.match(await text('#modal-title'), /Restaurar backup/);
    assert.deepEqual(await forjaData([SAFETY_KEY]), before, 'Importação aplicou sem confirmação');
    await jsClick('[data-modal-action="restore"]');
    await sleep(300);
    assert.deepEqual(await data('forja-missoes-2030-01-01'), modified.keys['forja-missoes-2030-01-01'], 'Importação não aplicou no Perfil');
    assert.deepEqual(await prefBoxes(), [false, false], 'Checkboxes não acompanharam a importação');
    assert.ok(await isVisible('#restore-safety-backup'), 'Desfazer não apareceu no Perfil');

    /* Desfazer a última restauração: volta exatamente ao estado anterior. */
    await clickCentered('#restore-safety-backup');
    await page.waitForSelector('[data-modal-action="restore"]', { timeout: 4000 });
    assert.match(await text('#modal-title'), /Desfazer última importação/);
    await jsClick('[data-modal-action="restore"]');
    await sleep(300);
    assert.deepEqual(await forjaData([SAFETY_KEY]), before, 'Desfazer não restaurou o estado anterior');
    const prefs = before[PREFS_KEY] || {};
    assert.deepEqual(await prefBoxes(), [prefs.soundOnRest !== false, prefs.vibrateOnRest !== false]);
    await page.screenshot({ path: artifactPath('perfil-backup.png') });
  } finally {
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: artifactsDir });
  }
});

await check('Som e vibração: a mesma escolha vale em Perfil, Configurações, outra aba e no fim do descanso', async () => {
  const saved = await forjaRaw();
  let signals = null;
  let other = null;
  try {
    await page.evaluate(key => localStorage.removeItem(key), PREFS_KEY);

    /* Perfil → Configurações → Perfil, com cliques reais. */
    await go('perfil/');
    assert.deepEqual(await prefBoxes(), [true, true], 'Sem nada gravado, os dois deveriam estar ligados');
    await clickCentered('#pref-sound');
    assert.deepEqual(await data(PREFS_KEY), { soundOnRest: false, vibrateOnRest: true });
    assert.match(await text('#toast'), /Preferência salva/);

    await go('configuracoes/');
    assert.deepEqual(await prefBoxes(), [false, true], 'Configurações não viu a escolha feita no Perfil');
    await clickCentered('#pref-vibrate');
    assert.deepEqual(await data(PREFS_KEY), { soundOnRest: false, vibrateOnRest: false });

    await go('perfil/');
    assert.deepEqual(await prefBoxes(), [false, false], 'Perfil não viu a escolha feita nas Configurações');

    /* Outra aba aberta no Perfil acompanha a mudança sem recarregar. */
    other = await browser.newPage();
    other.on('console', m => { if (m.type() === 'error') errors.push('outra aba console: ' + m.text()); });
    other.on('pageerror', e => errors.push('outra aba pageerror: ' + e.message));
    other.on('requestfailed', r => errors.push('outra aba requestfailed: ' + r.url()));
    await other.goto(new URL('perfil/', BASE).href, { waitUntil: 'networkidle0' });
    assert.deepEqual(await prefBoxes(other), [false, false]);
    await page.bringToFront();
    await clickCentered('#pref-sound');
    assert.deepEqual(await data(PREFS_KEY), { soundOnRest: true, vibrateOnRest: false });
    let synced = false;
    for (let i = 0; i < 40 && !synced; i++) {
      synced = JSON.stringify(await prefBoxes(other)) === JSON.stringify([true, false]);
      if (!synced) await sleep(50);
    }
    assert.ok(synced, 'A outra aba não recebeu a mudança: ' + JSON.stringify(await prefBoxes(other)));
    assert.deepEqual(await other.evaluate(() => window.Forja.state.preferences), { soundOnRest: true, vibrateOnRest: false });
    await other.close();
    other = null;

    /* Fim do descanso na execução, com som e vibração observados. */
    signals = await page.evaluateOnNewDocument(installRestSignals);

    let round = await restEndRound();
    assert.deepEqual(round, { vibrate: 0, sound: 1, prefs: { soundOnRest: true, vibrateOnRest: false } },
      'Som ligado e vibração desligada: aviso errado no fim do descanso');

    await go('perfil/');
    await clickCentered('#pref-sound');
    await clickCentered('#pref-vibrate');
    assert.deepEqual(await data(PREFS_KEY), { soundOnRest: false, vibrateOnRest: true });
    round = await restEndRound();
    assert.deepEqual(round, { vibrate: 1, sound: 0, prefs: { soundOnRest: false, vibrateOnRest: true } },
      'Som desligado e vibração ligada: aviso errado no fim do descanso');

    await go('configuracoes/');
    assert.deepEqual(await prefBoxes(), [false, true]);
    await clickCentered('#pref-vibrate');
    assert.deepEqual(await data(PREFS_KEY), { soundOnRest: false, vibrateOnRest: false });
    round = await restEndRound();
    assert.deepEqual(round, { vibrate: 0, sound: 0, prefs: { soundOnRest: false, vibrateOnRest: false } },
      'Som e vibração desligados: o descanso ainda avisou');
  } finally {
    if (other) await other.close();
    if (signals) await page.removeScriptToEvaluateOnNewDocument(signals.identifier);
    /* Sai da execução antes de repor o estado salvo (sessão e rotina de teste somem). */
    await go('perfil/');
    await restoreForjaRaw(saved);
  }
});

await check('Navegação ativa igual em HTML, JS e CSS, e F.url de perfil/explorar sob /forja/ em todas as páginas', async () => {
  const basePath = new URL(BASE).pathname;
  await page.setViewport(MOBILE);
  await page.mouse.move(0, 0);
  for (const rel of PAGES) {
    const where = rel || 'index';
    const want = EXPECTED_NAV[rel];
    assert.ok(want, 'Página sem destino esperado: ' + where);
    await go(rel);
    const state = await page.evaluate(async () => {
      const pick = (root, selector) => [...root.querySelectorAll(selector)].map(node => node.getAttribute('data-nav'));
      const html = await fetch(location.href, { cache: 'no-store' }).then(response => response.text());
      const original = new DOMParser().parseFromString(html, 'text/html');
      const target = name => new URL(window.Forja.url(name), location.href);
      /* Lê o corpo inteiro: resposta pendente seria abortada na próxima navegação. */
      const status = async url => {
        const response = await fetch(url, { cache: 'no-store' });
        await response.text();
        return response.status;
      };
      return {
        htmlActive: pick(original, '.bottom-nav-link.is-active'),
        htmlCurrent: pick(original, '.bottom-nav-link[aria-current="page"]'),
        jsActive: pick(document, '.bottom-nav-link.is-active'),
        jsCurrent: pick(document, '.bottom-nav-link[aria-current="page"]'),
        colors: Object.fromEntries([...document.querySelectorAll('.bottom-nav-link')]
          .map(node => [node.getAttribute('data-nav'), getComputedStyle(node).color])),
        perfil: target('perfil').pathname,
        explorar: target('explorar').pathname,
        perfilStatus: await status(target('perfil').href),
        explorarStatus: await status(target('explorar').href)
      };
    });
    assert.deepEqual(state.htmlActive, [want], 'HTML: is-active em ' + where);
    assert.deepEqual(state.htmlCurrent, [want], 'HTML: aria-current em ' + where);
    assert.deepEqual(state.jsActive, [want], 'JS: is-active em ' + where);
    assert.deepEqual(state.jsCurrent, [want], 'JS: aria-current em ' + where);
    assert.equal(state.colors[want], 'rgb(183, 243, 74)', 'CSS: item ativo sem destaque em ' + where);
    for (const [nav, color] of Object.entries(state.colors)) {
      if (nav !== want) assert.notEqual(color, state.colors[want], 'CSS: ' + nav + ' também destacado em ' + where);
    }
    assert.equal(state.perfil, basePath + 'perfil/index.html', 'F.url("perfil") em ' + where);
    assert.equal(state.explorar, basePath + 'explorar/index.html', 'F.url("explorar") em ' + where);
    assert.equal(state.perfilStatus, 200, 'Destino de F.url("perfil") não carrega a partir de ' + where);
    assert.equal(state.explorarStatus, 200, 'Destino de F.url("explorar") não carrega a partir de ' + where);
  }
});

await check('Armazenamento local é informado em todas as páginas', async () => {
  for (const rel of ['', 'treino/', 'progresso/', 'configuracoes/', 'perfil/', 'onboarding/index.html']) {
    await go(rel);
    const body = await page.evaluate(() => document.body.textContent);
    assert.match(body, /neste navegador e não são sincronizados/i, 'Aviso de armazenamento local ausente em ' + (rel || 'index'));
  }
});

await check('Capturas visuais das páginas em mobile e desktop', async () => {
  const shots = await browser.newPage();
  shots.on('pageerror', error => errors.push('screenshot: ' + error.message));
  shots.on('console', message => { if (message.type() === 'error') errors.push('screenshot console: ' + message.text()); });
  for (const [index, rel] of PAGES.entries()) {
    const slug = ['inicio','treino','calistenia','musculacao','rotinas','execucao','biblioteca','progresso','configuracoes','perfil','explorar','atlas','onboarding'][index];
    for (const width of [390, 1280]) {
      await shots.setViewport({ width, height: width === 390 ? 844 : 900 });
      let screenshotUrl = new URL(rel, BASE);
      if (rel === 'progresso/') {
        // Vista filtrada: além da captura completa da etapa 5, registra o recorte por modalidade/semana.
        screenshotUrl.searchParams.set('modalidade', 'weights');
        screenshotUrl.searchParams.set('periodo', 'semana');
      }
      if (rel === 'treino/rotina.html') {
        const saved = await shots.evaluate(() => JSON.parse(localStorage.getItem('forja-treino-rotinas-v1') || 'null'));
        const routine = saved?.calisthenics?.[0] || saved?.weights?.[0];
        if (routine) {
          screenshotUrl.searchParams.set('modalidade', routine.modality || (saved.calisthenics?.includes(routine) ? 'calisthenics' : 'weights'));
          screenshotUrl.searchParams.set('id', routine.id);
        }
      }
      await shots.goto(screenshotUrl.href, { waitUntil: 'networkidle0' });
      await shots.evaluate(() => window.scrollTo(0, 0));
      await sleep(250);
      const overflow = await shots.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, 'Overflow em captura ' + slug + ' @ ' + width + 'px: ' + overflow);
      await shots.screenshot({ path: artifactPath(slug + '-' + width + '.png'), fullPage: true });
    }
  }
  await shots.close();
});

await check('Fluxo completo em navegador limpo: Home sem rotina, criação sem #editor-missing, rotação e exclusão', async () => {
  const saved = await forjaRaw();
  try {
    await page.setViewport({ width: 390, height: 844 });
    await restoreForjaRaw({});

    /* 1. Perfil concluído: Home sem rotina, sem botão Iniciar, CTA leva ao hub de treino. */
    await go('');
    const initialKeys = await page.evaluate(() => Object.keys(localStorage));
    assert.deepEqual(initialKeys, ['forja-perfil-v1'], 'Home deve conter somente o perfil obrigatório já salvo');
    const homeBtn = await page.$eval('#home-primary-button', el => ({
      tag: el.tagName,
      text: el.textContent.trim(),
      href: el.getAttribute('href')
    }));
    assert.equal(homeBtn.tag, 'A');
    assert.equal(homeBtn.text, 'Montar meu treino');
    assert.doesNotMatch(homeBtn.text, /\bIniciar\b/);

    /* 2. Segue Home -> Montar meu treino -> Criar primeira rotina -> Editor direto sem #editor-missing. */
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('#home-primary-button')
    ]);
    assert.equal(await page.$eval('#hub-create-routine', el => el.textContent.trim()), 'Criar primeira rotina');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('#hub-create-routine')
    ]);
    assert.equal(await page.$eval('#editor-missing', el => el.hidden), true, '#editor-missing exibido na criação');
    assert.equal(await page.$eval('#editor-body', el => el.hidden), false, '#editor-body oculto na criação');

    /* Cancelar sem salvar não cria rotina órfã. */
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('#cancel-routine')
    ]);
    assert.equal(await page.evaluate(() => localStorage.getItem('forja-treino-rotinas-v1')), null);

    /* 3. Cria duas rotinas reais (Rotina 1 e Rotina 2) pelo fluxo completo de UI. */
    for (const [name, exName] of [['Rotina E2E 1', 'Flexão'], ['Rotina E2E 2', 'Barra fixa']]) {
      await go('treino/rotina.html?modalidade=calisthenics');
      assert.equal(await page.$eval('#editor-missing', el => el.hidden), true);
      await page.$eval('#routine-name-input', (el, v) => {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, name);
      await page.$eval('#exercise-name', (el, v) => { el.value = v; }, exName);
      await page.$eval('#exercise-sets', el => { el.value = '1'; });
      await page.$eval('#exercise-rest', el => { el.value = '0'; });
      await page.$eval('#exercise-submit', el => el.click());
      await sleep(150);
      await page.$eval('#save-routine-top', el => el.click());
      await sleep(150);
    }

    /* 4. Home oferece a 1ª rotina (não a mais recentemente salva) e não avança ao recarregar. */
    await go('');
    assert.equal(await page.$eval('#home-primary-button', el => el.textContent.trim()), 'Iniciar Rotina E2E 1');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#home-primary-button', el => el.textContent.trim()), 'Iniciar Rotina E2E 1');

    /* 5. Inicia e conclui Rotina E2E 1 -> Home avança para Rotina E2E 2 e persiste após reload. */
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('#home-primary-button')
    ]);
    await page.$eval('#complete-set', el => el.click());
    await page.waitForSelector('#execution-summary:not([hidden])', { timeout: 5000 });
    await sleep(200);

    await go('');
    assert.equal(await page.$eval('#home-primary-button', el => el.textContent.trim()), 'Iniciar Rotina E2E 2');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#home-primary-button', el => el.textContent.trim()), 'Iniciar Rotina E2E 2');

    /* 6. Exclui a rotina atualmente selecionada (Rotina E2E 2) -> Home volta para Rotina E2E 1. */
    await go('treino/calistenia.html');
    await page.$$eval('#routine-list .routine-card .danger-button', buttons => buttons[1].click());
    await page.waitForSelector('[data-modal-action="delete"]', { timeout: 4000 });
    await page.click('[data-modal-action="delete"]');
    await sleep(200);

    await go('');
    assert.equal(await page.$eval('#home-primary-button', el => el.textContent.trim()), 'Iniciar Rotina E2E 1');
  } finally {
    await go('perfil/');
    await restoreForjaRaw(saved);
  }
});

await check('Home e gate: perfil obrigatório, 5 larguras, metas com unidades/modalidade, outra aba e pageshow', async () => {
  const saved = await forjaRaw();
  let otherTab = null;
  try {
    await restoreForjaRaw({});
    await page.goto(new URL('treino/index.html', BASE).href, { waitUntil: 'networkidle0' });
    await expectPath('onboarding/index.html');
    assert.equal(await text('#onboarding-question'), 'Vamos personalizar seu treino.');
    assert.equal(await page.$('#onboarding-skip'), null, 'Cadastro não pode ser dispensado');
    assert.equal(await page.$('#onboarding-start'), null, 'A Home antiga não pode oferecer um atalho');

    /* Perfil concluído libera a Home; o CTA antigo de onboarding não existe. */
    await go('');
    assert.equal(await page.$('#onboarding-start'), null);
    assert.equal(await page.$('#onboarding-skip'), null);
    assert.equal(await text('#home-action-heading'), 'Monte sua primeira rotina');
    assert.equal(await page.$$eval('.home-action-title', els => els.length), 1, '.home-action-title deve ser único');

    for (const width of [320, 360, 390, 768, 1280]) {
      await page.setViewport({ width, height: 844 });
      await sleep(100);
      const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth }));
      assert.ok(metrics.overflow <= 1, 'Overflow horizontal na Home a ' + width + 'px: ' + metrics.overflow);
    }
    await page.setViewport(MOBILE);

    /* 2. Sincronização real entre duas abas do navegador (metas, histórico e rotinas). */
    otherTab = await browser.newPage();
    otherTab.on('pageerror', e => errors.push('otherTab pageerror: ' + e.message));
    await otherTab.goto(new URL('progresso/', BASE).href, { waitUntil: 'networkidle0' });

    await otherTab.evaluate(() => {
      const now = new Date();
      const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
      ].join('-');
      localStorage.setItem('forja-treino-metas-v1', JSON.stringify({
        version: 1, updatedAt: now.toISOString(), modality: 'weights',
        weeklySessions: 3, weeklySets: 12, weeklyMinutes: 60
      }));
      localStorage.setItem('forja-treino-historico-v1', JSON.stringify([{
        id: 'tab2-h1', date, finishedAt: now.toISOString(), modality: 'weights',
        routineName: 'Força A', durationMs: 15 * 60000, completedSets: 2, totalPlannedSets: 4,
        status: 'completed', exercises: []
      }]));
      localStorage.setItem('forja-treino-rotinas-v1', JSON.stringify({
        calisthenics: [],
        weights: [{
          id: 'tab2-r1', name: 'Força A', modality: 'weights', createdAt: 1000, updatedAt: 1000,
          sections: { warmup: [], main: [{ id: 'ex-1', name: 'Supino reto', sets: 3, type: 'reps', reps: '8', duration: 45, rest: 90, load: '40 kg', notes: '' }], abs: [], finisher: [] }
        }]
      }));
    });

    assert.ok(await waitFor(() => {
      const goalsText = document.getElementById('home-goals-content')?.textContent || '';
      return /Faltam 2 treinos/.test(goalsText) && /Faltam 10 séries/.test(goalsText) && /Faltam 45 min/.test(goalsText);
    }), 'Home não refletiu metas/histórico gravados em outra aba');
    assert.match(await text('#home-goals-period'), /Semana de .* · Musculação\.$/);
    assert.equal(await text('#home-primary-button'), 'Iniciar Força A');
    assert.equal(await page.$('#onboarding-start'), null, 'Home não restaura convite após evento storage');

    /* 3. Simula restauração via BFCache (pageshow persisted: true) após mudança silenciosa no armazenamento. */
    await page.evaluate(() => {
      /* Altera o storage sem disparar StorageEvent e confirma que pageshow persisted sincroniza F.state e UI. */
      const rawGoals = JSON.parse(localStorage.getItem('forja-treino-metas-v1'));
      rawGoals.modality = 'calisthenics';
      rawGoals.weeklySessions = 2;
      rawGoals.weeklySets = 0;
      rawGoals.weeklyMinutes = 0;
      localStorage.setItem('forja-treino-metas-v1', JSON.stringify(rawGoals));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await sleep(80);
    assert.equal(await page.evaluate(() => window.Forja.state.goals.modality), 'calisthenics');
    assert.match(await text('#home-goals-period'), /Semana de .* · Calistenia\.$/);
    assert.match(await text('#home-goals-content'), /Ainda sem progresso/);
  } finally {
    if (otherTab) await otherTab.close();
    await go('perfil/');
    await restoreForjaRaw(saved);
  }
});

await check('Onboarding: 24 telas em 320 px, erro sem escolha, voltar/corrigir, conclusão e perfil persistente', async () => {
  const saved = await forjaRaw();
  try {
    await restoreForjaRaw({});
    await page.goto(new URL('onboarding/index.html', BASE).href, { waitUntil: 'networkidle0' });
    await expectPath('/onboarding/index.html');
    await page.setViewport({ width: 320, height: 720 });
    await sleep(150);

    const etapa = () => page.evaluate(() => ({
      pergunta: document.getElementById('onboarding-question')?.textContent.trim(),
      contador: document.getElementById('onboarding-step-count')?.textContent.trim(),
      acao: document.getElementById('onboarding-next')?.textContent.trim(),
      valor: document.getElementById('onboarding-progressbar')?.getAttribute('aria-valuenow'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      opcao: (() => {
        const el = document.querySelector('#onboarding-step .onboarding-photo-card, #onboarding-step .onboarding-option');
        return el ? Math.round(el.getBoundingClientRect().height) : 0;
      })(),
      botao: (() => {
        const el = document.getElementById('onboarding-next');
        return el ? Math.round(el.getBoundingClientRect().height) : 0;
      })()
    }));

    const escolher = async valor => {
      const ok = await page.evaluate(v => {
        const input = [...document.querySelectorAll('#onboarding-step input[type="radio"], #onboarding-step input[type="checkbox"]')]
          .find(node => node.value === String(v));
        if (!input) return false;
        if (!input.checked) input.click();
        return input.checked;
      }, valor);
      assert.ok(ok, 'Opção não encontrada: ' + valor);
      await sleep(60);
    };

    const escolherMultipla = async valores => {
      for (const valor of valores) await escolher(valor);
    };

    const avancar = async () => {
      await clickCentered('#onboarding-next');
      await sleep(90);
    };

    let info = await etapa();
    assert.equal(info.pergunta, 'Vamos personalizar seu treino.');
    assert.equal(info.contador, 'Etapa 1 de 22');
    assert.equal(info.acao, 'Continuar');
    assert.equal(info.valor, '0');
    assert.ok(info.opcao >= 44, 'Cartão de resposta abaixo de 44px: ' + info.opcao);
    assert.ok(info.botao >= 44, 'Botão principal abaixo de 44px a 320px');
    assert.ok(info.overflow <= 1, 'Overflow na primeira etapa a 320px: ' + info.overflow);

    const imagens = await page.$$eval('#onboarding-step img', els => els.map(e => ({
      sexo: e.dataset.sexo,
      src: e.getAttribute('src')
    })));
    assert.equal(imagens.length, 2, 'A primeira etapa deve mostrar exatamente as duas imagens fornecidas');
    assert.ok(imagens.find(item => item.sexo === 'masculino')?.src.includes('sexo-masculino.png'),
      'A imagem masculina deve estar no cartão Masculino');
    assert.ok(imagens.find(item => item.sexo === 'feminino')?.src.includes('sexo-feminino.jpg'),
      'A imagem feminina deve estar no cartão Feminino');

    /* Sem escolha não avança: o erro aparece e nada é gravado. */
    await avancar();
    assert.equal(await page.$eval('#onboarding-error', el => el.hidden), false, 'Faltou avisar que a escolha é obrigatória');
    assert.equal(await etapa().then(e => e.pergunta), 'Vamos personalizar seu treino.');
    assert.equal(await data('forja-perfil-v1'), null);

    /* Responde as perguntas até os dias, com uma volta para corrigir essa resposta. */
    await escolher('feminino');
    await avancar();
    await escolher('corpoTodo');
    await avancar();
    await escolher('forca');
    await avancar();
    await escolherMultipla(['forca']);
    await avancar();
    await fill('#onboarding-alturaCm', 168);
    await avancar();
    await fill('#onboarding-pesoKg', '64,5');
    await avancar();
    await jsClick('#onboarding-indefinido');
    await avancar();
    await escolher('intermediario');
    await avancar();
    await fill('#onboarding-anoNascimento', 1994);
    await avancar();
    await escolher('caminha');
    await avancar();
    await escolher('casa');
    await avancar();
    await escolherMultipla(['calistenia']);
    await avancar();
    await escolher('3');
    await avancar();
    assert.equal((await etapa()).pergunta, 'Qual é o seu nível de experiência?');
    await jsClick('#onboarding-back');
    await sleep(120);
    assert.equal((await etapa()).pergunta, 'Quantos dias por semana você quer treinar?');
    assert.equal(await page.$eval('input[name="onboarding-diasPorSemana"][value="3"]', el => el.checked), true,
      'A resposta anterior deve continuar marcada');
    await escolher('5');
    await avancar();

    /* Responde o restante do fluxo. */
    await escolher('iniciante');
    await avancar();
    await escolher('basicos');
    await avancar();
    await escolherMultipla(['nenhuma']);
    await avancar();
    await escolherMultipla(['halteres']);
    await avancar();
    await escolher('1a5');
    await avancar();
    await escolher('pernas');
    await avancar();
    await escolher('algumTempo');
    await avancar();
    await escolher('consistencia');
    await avancar();
    await escolher('consistencia');
    await avancar();

    info = await etapa();
    assert.equal(info.pergunta, 'Confira suas respostas');
    assert.equal(info.contador, 'Revisão das respostas');
    assert.equal(info.acao, 'Continuar');
    assert.equal(info.valor, '22');
    assert.ok(info.overflow <= 1, 'Overflow na revisão a 320px: ' + info.overflow);
    assert.equal(await page.$$eval('.onboarding-review-row', els => els.length), 22, 'A revisão deve listar as 22 respostas');
    assert.equal(await data('forja-perfil-v1'), null, 'A revisão ainda não deve gravar o perfil');

    /* A preparação é a última tela; só “Entrar no FORJA” conclui e grava. */
    await avancar();
    info = await etapa();
    assert.equal(info.pergunta, 'Seu perfil está pronto para o próximo passo.');
    assert.equal(info.contador, 'Último passo');
    assert.equal(info.acao, 'Entrar no FORJA');
    assert.equal(info.valor, '23');
    assert.ok(info.overflow <= 1, 'Overflow na preparação a 320px: ' + info.overflow);
    assert.equal(await data('forja-perfil-v1'), null, 'A preparação ainda não deve gravar o perfil');

    await avancar();
    await expectPath('/');
    await sleep(200);

    const perfil = await data('forja-perfil-v1');
    assert.ok(perfil, 'O perfil deve ser gravado na conclusão');
    assert.deepEqual(
      {
        version: perfil.version, sexo: perfil.sexo, objetivo: perfil.objetivo, nivel: perfil.nivel,
        diasPorSemana: perfil.diasPorSemana, duracaoMinutos: perfil.duracaoMinutos,
        equipamento: perfil.equipamento, modalidadePreferida: perfil.modalidadePreferida
      },
      {
        version: 3, sexo: 'feminino', objetivo: 'forca', nivel: 'iniciante',
        diasPorSemana: 5, duracaoMinutos: 0,
        equipamento: 'casa', modalidadePreferida: 'calisthenics'
      }
    );
    assert.ok(perfil.onboardingConcluidoEm, 'A conclusão do onboarding deve ficar registrada');

    /* Confirmação na Home e convite encerrado. */
    assert.match(await text('#toast'), /Cadastro concluído/);
    assert.equal(await page.$('#onboarding-start'), null, 'A Home não deve oferecer convite após concluir');

    /* Reabrir o app (recarregar) não repete o onboarding. */
    await go('');
    await page.setViewport(MOBILE);
    assert.equal(await page.$('#onboarding-start'), null, 'Recarregar não deve trazer cadastro opcional');

    /* Perfil mostra o sexo e permite editar; editar não altera o restante. */
    await go('perfil/');
    assert.equal(await page.$eval('#prof-sexo', el => el.value), 'feminino');
    await page.select('#prof-sexo', 'masculino');
    await jsClick('#profile-save');
    await sleep(220);
    assert.equal((await data('forja-perfil-v1')).sexo, 'masculino', 'A edição do sexo não foi gravada');
    assert.equal((await data('forja-perfil-v1')).objetivo, 'forca', 'A edição do sexo alterou outros campos');
  } finally {
    await page.setViewport(MOBILE);
    await go('perfil/');
    await restoreForjaRaw(saved);
  }
});

/* ------------------------------------------------------------------ */
/* Regressões da auditoria (D-01, D-02, D-04, D-07, D-08, D-11)        */
/* ------------------------------------------------------------------ */

/* Backup sintético com `count` treinos, do mais antigo ao mais novo. */
function historyBackupFile(count, name) {
  const records = [];
  const base = new Date('2026-01-01T12:00:00');

  for (let index = 0; index < count; index += 1) {
    const date = new Date(base.getTime());
    date.setDate(date.getDate() + index);
    const key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') +
      '-' + String(date.getDate()).padStart(2, '0');
    records.push({
      id: 'e2e-aud-' + index,
      date: key,
      modality: 'calisthenics',
      routineName: 'Auditoria ' + (index + 1),
      durationMs: 600000,
      completedSets: 1,
      totalPlannedSets: 1,
      status: 'completed',
      finishedAt: key + 'T12:00:00.000Z',
      exercises: [{ id: 'ex', name: 'Flexão', section: 'main', plannedSets: 1, completedSets: 1, reps: '10', type: 'reps', logs: [{ set: 1, reps: '10' }] }]
    });
  }

  const file = artifactPath(name);
  fs.writeFileSync(file, JSON.stringify({
    app: 'FORJA', format: 'forja-backup', version: 1,
    exportedAt: new Date().toISOString(),
    keys: { 'forja-treino-historico-v1': records }
  }));
  return { file, newest: records[records.length - 1].date, records };
}

await check('D-01: importar 250 treinos avisa o limite, guarda os 200 mais recentes e não perde o novo', async () => {
  const saved = await forjaRaw();
  try {
    await go('configuracoes/');
    await clearForjaStorage();
    await go('configuracoes/');

    const { file, newest } = historyBackupFile(250, 'aud-250.json');
    await (await page.$('#import-backup-input')).uploadFile(file);
    await page.waitForSelector('[data-modal-action="restore"]', { timeout: 5000 });

    const preview = await text('.modal-details');
    assert.match(preview, /250 treinos no histórico/i, 'Preview não informa o tamanho do arquivo');
    assert.match(preview, /200 mais recentes/i, 'Preview não informa o que fica');
    assert.match(preview, /50 registro\(s\) mais antigo\(s\).*descartados/i, 'Preview não informa o descarte');

    await jsClick('[data-modal-action="restore"]');
    await sleep(400);

    const stored = await data('forja-treino-historico-v1');
    assert.equal(stored.length, 200, 'O armazenamento deveria respeitar o limite de 200');
    assert.equal(stored[0].date, newest, 'O mais recente do arquivo deveria estar no topo');
    assert.match(await text('#toast'), /Backup restaurado\. 1 chave\(s\) carregada\(s\)\./);

    await go('progresso/');
    assert.equal(await text('#progress-sessions'), '200', 'Sessões deveria contar os 200 guardados');
    const rows = await page.$$eval('#progress-history .history-item', els => els.length);
    assert.equal(rows, 200, 'A lista deveria ter 200 registros');
    const exportedCount = await page.evaluate(() => window.Forja.buildBackupObject().keys['forja-treino-historico-v1'].length);
    assert.equal(exportedCount, 200, 'A exportação precisa concordar com a tela e o armazenamento');

    /* Conclui um treino novo de uma série: o importado mais recente precisa ficar. */
    await page.evaluate(() => {
      const exercise = {
        id: 'aud-ex', name: 'Flexão', sets: 1, type: 'reps', reps: '10',
        duration: 45, rest: 0, load: '', notes: '', section: 'main'
      };
      const routine = {
        id: 'aud-r1', name: 'Treino novo', modality: 'calisthenics',
        sections: { warmup: [], main: [exercise], abs: [], finisher: [] },
        createdAt: 1, updatedAt: 1
      };
      localStorage.setItem('forja-treino-rotinas-v1', JSON.stringify({ calisthenics: [routine], weights: [] }));
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      localStorage.setItem('forja-treino-sessao-ativa-v1', JSON.stringify({
        version: 2, id: 'aud-session', date: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
        modality: 'calisthenics', routineId: routine.id, routineName: routine.name,
        startedAt: now.getTime() - 60000, elapsedMs: 0, running: true, currentIndex: 0,
        completedSets: { [exercise.id]: 0 }, totalPlannedSets: 1,
        queue: [Object.assign({}, exercise)], status: 'active',
        restEndAt: null, restRemainingMs: 0, restPaused: false, pendingAdvance: false,
        restPlannedSeconds: 0, setTimer: null, setLogs: {}, logDraft: {}
      }));
    });

    await go('treino/executar.html');
    await jsClick('#complete-set');
    assert.ok(await waitFor(() => !document.getElementById('execution-summary').hidden, 6000),
      'A sessão de uma série deveria ser concluída');

    const after = await data('forja-treino-historico-v1');
    assert.equal(after.length, 200, 'O histórico deveria continuar com 200 registros');
    assert.equal(after[0].routineName, 'Treino novo', 'O treino novo deveria entrar no topo');
    assert.ok(after.some(record => record.date === newest),
      'O registro mais recente importado desapareceu depois do treino novo');
    assert.ok(!after.some(record => record.id === 'e2e-aud-0'),
      'Apenas o mais antigo do arquivo pode sair');
    await page.screenshot({ path: artifactPath('d01-historico-200.png') });
  } finally {
    await go('configuracoes/');
    await restoreForjaRaw(saved);
  }
});

await check('D-02: falha na restauração deixa o desfazer disponível na mesma tela', async () => {
  const saved = await forjaRaw();
  try {
    await go('configuracoes/');
    await clearForjaStorage();
    await page.evaluate(() => {
      localStorage.setItem('forja-missoes-2026-10-25', JSON.stringify([{ id: 'm1', text: 'Original', done: false }]));
      localStorage.setItem('forja-preferencias-v1', JSON.stringify({ soundOnRest: false, vibrateOnRest: false }));
      localStorage.setItem('forja-treino-rotinas-v1', JSON.stringify({ calisthenics: [], weights: [] }));
    });
    await go('configuracoes/');
    assert.equal(await page.$eval('#restore-safety-backup', el => el.hidden), true,
      'Desfazer não deveria aparecer antes de importar');

    const backup = artifactPath('aud-falha.json');
    fs.writeFileSync(backup, JSON.stringify({
      app: 'FORJA', format: 'forja-backup', version: 1, exportedAt: new Date().toISOString(),
      keys: {
        'forja-missoes-2026-10-25': [{ id: 'm2', text: 'Do backup', done: false }],
        'forja-preferencias-v1': { soundOnRest: true, vibrateOnRest: true }
      }
    }));

    await (await page.$('#import-backup-input')).uploadFile(backup);
    await page.waitForSelector('[data-modal-action="restore"]', { timeout: 5000 });

    /* Falha simulada de cota a partir da segunda escrita, sem recarregar. */
    await page.evaluate(() => {
      window.__forjaOriginalSetItem = Storage.prototype.setItem;
      window.__forjaWriteCount = 0;
      Storage.prototype.setItem = function (key, value) {
        window.__forjaWriteCount += 1;
        if (window.__forjaWriteCount >= 2) {
          const error = new Error('QuotaExceededError simulado');
          error.name = 'QuotaExceededError';
          throw error;
        }
        return window.__forjaOriginalSetItem.call(this, key, value);
      };
    });
    await jsClick('[data-modal-action="restore"]');
    await sleep(500);
    await page.evaluate(() => { Storage.prototype.setItem = window.__forjaOriginalSetItem; });

    assert.match(await text('#modal-title'), /Falha ao restaurar/);
    assert.match(await text('.modal-message'), /forja-backup-seguranca-v1/);
    await jsClick('[data-modal-action="close"]');
    await sleep(150);

    assert.equal(await page.$eval('#restore-safety-backup', el => el.hidden), false,
      'O desfazer precisa aparecer sem recarregar a página');
    assert.match(await text('#backup-status'), /Cópia de segurança de .* disponível/);

    await jsClick('#restore-safety-backup');
    await page.waitForSelector('[data-modal-action="restore"]', { timeout: 5000 });
    await jsClick('[data-modal-action="restore"]');
    await sleep(400);

    assert.equal((await data('forja-missoes-2026-10-25'))[0].text, 'Original', 'Desfazer não recuperou as missões');
    assert.equal((await data('forja-preferencias-v1')).soundOnRest, false, 'Desfazer não recuperou as preferências');
    assert.match(await text('#toast'), /Cópia anterior restaurada/);
  } finally {
    await go('configuracoes/');
    await restoreForjaRaw(saved);
  }
});

await check('D-04/D-07: descanso sem anúncio por segundo, com as ações visíveis acima da barra', async () => {
  const saved = await forjaRaw();
  try {
    await page.setViewport(MOBILE);
    await seedRestSession();
    await go('treino/executar.html');
    await jsClick('#complete-set');
    assert.ok(await waitFor(() => !document.getElementById('execution-rest').hidden, 5000),
      'O descanso não começou');
    await sleep(300);

    const rest = await page.evaluate(() => {
      const panel = document.getElementById('execution-rest');
      const timer = document.getElementById('rest-timer');
      return {
        panelLive: panel.getAttribute('aria-live'),
        timerLive: timer.getAttribute('aria-live'),
        timerRole: timer.getAttribute('role'),
        caption: document.getElementById('rest-caption').textContent.trim()
      };
    });
    assert.equal(rest.panelLive, null, 'O painel do descanso não pode ser uma região viva');
    assert.equal(rest.timerLive, 'off', 'O contador precisa ficar fora da região viva');
    assert.equal(rest.timerRole, 'timer');

    const geometry = async () => page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
      const skip = document.getElementById('skip-rest').getBoundingClientRect();
      const toast = document.getElementById('toast');
      const toastRect = toast && !toast.hidden ? toast.getBoundingClientRect() : null;
      return {
        navTop: nav.top,
        skipTop: skip.top,
        skipBottom: skip.bottom,
        toastTop: toastRect ? toastRect.top : Infinity,
        viewport: window.innerHeight
      };
    });

    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1280, height: 900 }]) {
      await page.setViewport(viewport);
      await sleep(500);
      const box = await geometry();
      assert.ok(box.skipTop >= 0 && box.skipBottom <= box.viewport,
        'Pular descanso fora da tela em ' + viewport.width + 'x' + viewport.height + ': ' + JSON.stringify(box));
      assert.ok(box.skipBottom <= box.navTop + 0.5,
        'Pular descanso coberto pela barra inferior em ' + viewport.width + 'x' + viewport.height + ': ' + JSON.stringify(box));
      assert.ok(box.skipBottom <= box.toastTop + 0.5,
        'Pular descanso coberto pelo toast em ' + viewport.width + 'x' + viewport.height + ': ' + JSON.stringify(box));
    }

    await page.setViewport(MOBILE);
    await page.screenshot({ path: artifactPath('d07-descanso-visivel.png') });

    /* Pausa é anunciada uma vez na região viva, sem depender do contador. */
    await jsClick('#pause-rest');
    assert.ok(await waitFor(() => (document.getElementById('forja-live-region')?.textContent || '').includes('Descanso pausado'), 3000),
      'A pausa do descanso deveria ser anunciada');
    await jsClick('#resume-rest');
    assert.ok(await waitFor(() => (document.getElementById('forja-live-region')?.textContent || '').includes('Descanso retomado'), 3000),
      'A retomada do descanso deveria ser anunciada');
  } finally {
    await page.setViewport(MOBILE);
    await go('configuracoes/');
    await restoreForjaRaw(saved);
  }
});

await check('D-08/D-11: skip link foca o conteúdo e a barra mantém os rótulos em 320 px', async () => {
  const saved = await forjaRaw();
  try {
    for (const rel of ['', 'progresso/', 'treino/biblioteca.html', 'explorar/atlas.html']) {
      await go(rel);
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement.className);
      assert.match(String(focused), /skip-link/, 'O primeiro Tab deveria focar o skip link em ' + (rel || 'index'));
      await page.keyboard.press('Enter');
      await sleep(200);
      const target = await page.evaluate(() => ({
        tag: document.activeElement.tagName,
        id: document.activeElement.id,
        tabindex: document.getElementById('conteudo')?.getAttribute('tabindex')
      }));
      assert.equal(target.id, 'conteudo', 'O skip link não moveu o foco para o conteúdo em ' + (rel || 'index'));
      assert.equal(target.tabindex, '-1');
    }

    await go('treino/biblioteca.html');
    await page.setViewport({ width: 320, height: 640 });
    await sleep(250);

    const h1 = await page.$$eval('h1', els => els.map(el => el.textContent.trim()));
    assert.deepEqual(h1, ['Biblioteca de exercícios'], 'A Biblioteca deveria ter um h1 com o título');

    const nav = await page.evaluate(() => [...document.querySelectorAll('.bottom-nav-label')].map(el => ({
      text: el.textContent.trim(),
      clipped: el.scrollWidth > el.clientWidth + 1
    })));
    assert.deepEqual(nav.map(item => item.text), ['Início', 'Treinos', 'Explorar', 'Progresso', 'Perfil']);
    assert.deepEqual(nav.filter(item => item.clipped), [], 'Nenhum rótulo pode ficar truncado a 320 px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0,
      'A barra inferior não pode criar rolagem horizontal');
    await page.screenshot({ path: artifactPath('d11-nav-320.png') });
  } finally {
    await page.setViewport(MOBILE);
    await go('configuracoes/');
    await restoreForjaRaw(saved);
  }
});

/* Fluxos da primeira evolução web, isolados dos dados das verificações acima. */
await check('Explorar — busca e resultados inline, filtros recolhidos e atlas em acesso único', async () => {
  const saved = await forjaRaw();
  try {
    await restoreForjaRaw({});
    await go('explorar/');
    const existingProfile = await forjaRaw();
    assert.ok(existingProfile['forja-perfil-v1'], 'Rota protegida exige perfil salvo');
    assert.ok(await page.$('#catalog-root'), 'Catálogo inline ausente');
    assert.equal(await page.$eval('#catalog-controls', el => el.closest('details').open), false,
      'Filtros secundários começam recolhidos');
    assert.equal(await page.$$eval('.explore-atlas a[href="atlas.html"]', els => els.length), 1,
      'Acesso ao atlas deve aparecer uma vez');
    await fill('#catalog-search', 'flexão');
    assert.ok(await page.$$eval('#catalog-list .ui-exercise-row', els => els.length > 0),
      'A busca não mostrou resultados na tela Explorar');
    assert.match(await text('#catalog-list'), /flexão/i);
    await page.click('.catalog-filter-disclosure > summary');
    assert.equal(await page.$eval('#catalog-controls', el => el.closest('details').open), true);
    assert.deepEqual(await forjaRaw(), existingProfile, 'Consultar catálogo não alterou dados locais além do perfil existente');
    await page.screenshot({ path: artifactPath('explorar-inline-390.png'), fullPage: true });
  } finally {
    await page.setViewport(MOBILE);
    await go('configuracoes/');
    await restoreForjaRaw(saved);
  }
});

await check('Evolução 1 — rotinas diretas, filtro e início com a modalidade correta', async () => {
  const saved = await forjaRaw();
  try {
    await restoreForjaRaw({});
    await seedRestSession();
    await page.evaluate(() => {
      localStorage.removeItem('forja-treino-sessao-ativa-v1');
      const key = 'forja-treino-rotinas-v1';
      const routines = JSON.parse(localStorage.getItem(key));
      const weights = structuredClone(routines.calisthenics[0]);
      weights.id = 'e2e-direto-weights'; weights.name = 'Musculação direta'; weights.modality = 'weights';
      routines.weights = [weights];
      localStorage.setItem(key, JSON.stringify(routines));
    });
    await go('treino/');
    const before = await forjaRaw();
    for (const width of [320, 390, 1280]) {
      await page.setViewport({ width, height: 844 });
      assert.equal(await page.$$eval('#hub-routine-list .routine-card', els => els.length), 2);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const heights = await page.$$eval('#hub-routine-list .routine-actions > *', els => els.map(el => el.getBoundingClientRect().height));
      assert.ok(heights.every(height => height >= 44));
    }
    await page.setViewport(MOBILE);
    await page.screenshot({ path: artifactPath('evolucao1-rotinas-390.png'), fullPage: true });
    await page.select('#hub-modality', 'weights');
    assert.equal(await page.$$eval('#hub-routine-list .routine-card', els => els.length), 1);
    assert.deepEqual(await forjaRaw(), before, 'Filtrar não pode alterar dados');
    await clickCentered('#hub-routine-list .routine-start');
    await expectPath('/treino/executar.html');
    const active = await data('forja-treino-sessao-ativa-v1');
    assert.equal(active.routineId, 'e2e-direto-weights');
    assert.equal(active.modality, 'weights');
  } finally {
    await page.setViewport(MOBILE);
    await go('configuracoes/');
    await restoreForjaRaw(saved);
  }
});

await check('Evolução 1 — consulta e inclusão contextual preservam rascunho, ordem, foco e IDs', async () => {
  const saved = await forjaRaw();
  try {
    await restoreForjaRaw({});
    await seedRestSession();
    await page.evaluate(() => localStorage.removeItem('forja-treino-sessao-ativa-v1'));
    await go('treino/rotina.html?modalidade=calisthenics&id=e2e-prefs-rest');
    await fill('#routine-name-input', 'Rascunho preservado');
    await fill('#exercise-name', 'Ainda digitando');
    await fill('#exercise-reps', '8-12');
    await fill('#exercise-rest', '75');
    const before = await forjaRaw();
    const order = await page.$$eval('.editor-exercise', els => els.map(el => el.dataset.exerciseId));
    await clickCentered('#library-toggle');
    await fill('#library-search', 'peito');
    const count = await page.evaluate(() => Forja.catalog.filter({ mode: 'calisthenics', query: 'peito' }).length);
    assert.equal(await page.$$eval('#library-list .ui-exercise-row', els => els.length), count);
    await clickCentered('#library-list .ui-exercise-row button');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.modalAction), 'cancel');
    /* O detalhe agora tem botões de pose e links de crédito focáveis: a
       proteção continua sendo o trap — Tab/Shift+Tab não saem do modal. */
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => !!document.activeElement.closest('.modal-card')),
      'Tab saiu do modal');
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    assert.ok(await page.evaluate(() => !!document.activeElement.closest('.modal-card')),
      'Shift+Tab saiu do modal');
    await page.screenshot({ path: artifactPath('evolucao1-editor-detalhes-390.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Ver detalhes de Flexão de braço');
    assert.equal(await page.$eval('#routine-name-input', el => el.value), 'Rascunho preservado');
    assert.equal(await page.$eval('#exercise-name', el => el.value), 'Ainda digitando');
    assert.equal(await page.$eval('#exercise-reps', el => el.value), '8-12');
    assert.equal(await page.$eval('#exercise-rest', el => el.value), '75');
    assert.deepEqual(await page.$$eval('.editor-exercise', els => els.map(el => el.dataset.exerciseId)), order);
    assert.deepEqual(await forjaRaw(), before);
    await jsClick('#library-list .ui-exercise-row button', /^Adicionar$/);
    assert.deepEqual(await forjaRaw(), before, 'Inclusão não salva antes da confirmação');
    await jsClick('#save-routine-top');
    await expectPath('/treino/rotina.html');
    const routine = (await data('forja-treino-rotinas-v1')).calisthenics[0];
    assert.equal(routine.name, 'Rascunho preservado');
    assert.equal(routine.sections.main[0].id, order[0]);
    assert.equal(routine.sections.main[1].libraryId, 'cal-flexao');
    assert.ok(routine.sections.main[1].instructions);
  } finally {
    await go('configuracoes/');
    await restoreForjaRaw(saved);
  }
});

await check('Evolução 1 — instruções preservam sessão, descanso, valores, pausa e recuperação', async () => {
  const saved = await forjaRaw();
  try {
    await restoreForjaRaw({});
    await seedRestSession();
    await page.evaluate(() => {
      const key = 'forja-treino-sessao-ativa-v1';
      const s = JSON.parse(localStorage.getItem(key));
      s.queue[0].libraryId = 'cal-flexao';
      s.queue[0].instructions = 'Instrução da sessão: mantenha o corpo alinhado.';
      s.restEndAt = Date.now() + 60000; s.restPlannedSeconds = 60;
      localStorage.setItem(key, JSON.stringify(s));
    });
    await go('treino/executar.html');
    await fill('#log-reps', '12');
    const before = await forjaRaw();
    const deadline = (await data('forja-treino-sessao-ativa-v1')).restEndAt;
    await clickCentered('#execution-instructions');
    assert.match(await text('.modal-details'), /Instrução da sessão/);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.modalAction), 'cancel');
    await sleep(1300);
    assert.equal(await page.evaluate(() => Forja.state.activeWorkout.restEndAt), deadline);
    await page.screenshot({ path: artifactPath('evolucao1-execucao-instrucoes-390.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'execution-instructions');
    assert.deepEqual(await forjaRaw(), before, 'Consulta não escreve a sessão');
    assert.equal(await page.$eval('#log-reps', el => el.value), '12');
    await clickCentered('#pause-session');
    const paused = await forjaRaw();
    await clickCentered('#execution-instructions');
    await page.keyboard.press('Escape');
    assert.deepEqual(await forjaRaw(), paused);
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.evaluate(() => Forja.state.activeWorkout.running), false);
    assert.equal(await page.$eval('#log-reps', el => el.value), '12');
    await clickCentered('#resume-session');
    assert.equal(await page.evaluate(() => Forja.state.activeWorkout.running), true);
  } finally {
    await go('configuracoes/');
    await restoreForjaRaw(saved);
  }
});

await check('Demonstrações: imagem local decodifica, créditos visíveis e fallback sem rede', async () => {
  const before = errors.length;
  await go('treino/biblioteca.html');

  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#catalog-list .ui-exercise-row')]
      .find(node => /Flexão de braço/.test(node.textContent));
    if (!row) throw new Error('exercício Flexão de braço não encontrado');
    row.querySelector('.ui-exercise-actions button').click();
  });
  await page.waitForSelector('.demo-media img', { timeout: 4000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('.demo-media img');
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 5000 });
  const info = await page.$eval('.demo-media', el => ({
    id: el.dataset.demoId,
    confirmation: el.dataset.confirmation,
    src: el.querySelector('img').getAttribute('src'),
    width: el.querySelector('img').naturalWidth
  }));
  assert.equal(info.id, 'repdb:push-up');
  assert.equal(info.confirmation, 'confirmed');
  assert.equal(info.width, 512);
  assert.ok(info.src.startsWith('../assets/demonstracoes/') || info.src.startsWith('assets/demonstracoes/'),
    'imagem não é local: ' + info.src);
  assert.match(await text('.demo-credit'), /RepDB/);
  assert.equal(await page.$('.demo-badge'), null, 'exata não deve ter selo de revisão');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.modal-backdrop'), { timeout: 4000 });

  await page.evaluate(() => {
    const record = Forja.catalog.items('calisthenics').find(item => item.id === 'cal-rotacao-ombros');
    Forja.catalog.showDetail(record, { readOnly: true });
  });
  await page.waitForSelector('.modal-backdrop .modal-details', { timeout: 4000 });
  assert.match(await text('.modal-backdrop .modal-details'), /Demonstração visual ainda não disponível/);
  assert.equal(await page.$('.demo-media'), null, 'exercício sem correspondência ganhou imagem');
  await page.keyboard.press('Escape');

  /* Nenhuma requisição externa: os créditos são links, não imagens remotas. */
  const added = errors.slice(before);
  assert.deepEqual(added.filter(e => /requestfailed|HTTP [45]/.test(e)), [],
    'falha de recurso ao exibir demonstrações: ' + added.join(' | '));
  await page.setViewport(MOBILE);
});

await check('Demonstrações: seletor no editor persiste demoId e chega à execução', async () => {
  const saved = await forjaRaw();
  const today = new Date().toISOString().slice(0, 10);
  const routine = {
    id: 'r-demo', name: 'Treino Demo', modality: 'calisthenics',
    createdAt: 1, updatedAt: 1,
    sections: {
      warmup: [],
      main: [{
        id: 'm-demo', name: 'Flexão de braço', sets: 2, type: 'reps', reps: '10',
        duration: 45, rest: 10, load: '', notes: '', section: 'main',
        libraryId: 'cal-flexao'
      }],
      abs: [], finisher: []
    }
  };
  try {
    await restoreForjaRaw({});
    await page.evaluate(r => localStorage.setItem('forja-treino-rotinas-v1',
      JSON.stringify({ calisthenics: [r], weights: [] })), routine);
    await go('treino/rotina.html?id=r-demo&modalidade=calisthenics');

    await clickCentered('.editor-exercise .demo-row-button');
    await page.waitForSelector('.demo-picker', { timeout: 4000 });
    await page.waitForFunction(() => {
      const img = document.querySelector('.demo-card img');
      return img && img.complete && img.naturalWidth > 0;
    }, { timeout: 5000 });
    assert.ok((await page.$$('.demo-card')).length >= 4, 'seletor sem alternativas');
    assert.match(await text('.demo-picker-notice'), /Precisa de revisão/);
    assert.ok(await page.$('.demo-card-status.is-review'), 'sem selo de revisão');
    assert.match(await text('.demo-card-source'), /RepDB/, 'card sem fonte');

    /* Sem overflow em telas pequenas com o seletor aberto. */
    for (const width of [320, 390, 768]) {
      await page.setViewport({ width, height: 800 });
      await sleep(120);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, 'Overflow no seletor a ' + width + 'px: ' + overflow);
    }
    await page.setViewport(MOBILE);

    await fill('.demo-picker-input', 'aranha');
    await sleep(80);
    assert.ok((await page.$$('.demo-card')).length >= 1, 'busca não encontrou alternativa');
    await jsClick('.demo-card[data-demo-id="repdb:spiderman-push-up"]');
    await jsClick('[data-modal-action="confirm"]');
    await sleep(200);
    assert.equal(await page.$('.modal-backdrop'), null, 'seletor não fechou');

    await clickCentered('#save-routine-top');
    await sleep(160);
    const stored = await data('forja-treino-rotinas-v1');
    assert.equal(stored.calisthenics[0].sections.main[0].demoId, 'repdb:spiderman-push-up');

    await go('treino/rotina.html?id=r-demo&modalidade=calisthenics');
    await jsClick('.editor-exercise .exercise-tools button');
    await page.waitForSelector('.demo-media', { timeout: 4000 });
    assert.equal(await page.$eval('.demo-media', el => el.dataset.demoId),
      'repdb:spiderman-push-up', 'reabrir editor perdeu a escolha');
    assert.match(await text('.demo-badge'), /Precisa de revisão/);
    await page.keyboard.press('Escape');

    /* Sessão ativa com a mesma escolha. */
    await page.evaluate((r, day) => {
      const exercise = r.sections.main[0];
      exercise.demoId = 'repdb:spiderman-push-up';
      const session = {
        version: 2, id: 's-demo', date: day, modality: 'calisthenics',
        routineId: r.id, routineName: r.name, startedAt: Date.now() - 1000,
        elapsedMs: 0, running: true, currentIndex: 0,
        completedSets: { 'm-demo': 0 }, totalPlannedSets: exercise.sets,
        queue: [Object.assign({}, exercise)], status: 'active',
        restEndAt: null, restRemainingMs: 0, restPaused: false,
        pendingAdvance: false, restPlannedSeconds: 0, setTimer: null,
        setLogs: {}, logDraft: {}
      };
      localStorage.setItem('forja-treino-sessao-ativa-v1', JSON.stringify(session));
    }, routine, today);
    await go('treino/executar.html');
    await page.waitForFunction(() => {
      const img = document.querySelector('#execution-demo .demo-image');
      return img && img.complete && img.naturalWidth > 0;
    }, { timeout: 5000 });
    assert.equal(await page.$eval('#execution-demo .demo-media', el => el.dataset.demoId),
      'repdb:spiderman-push-up');
    assert.match(await text('#execution-demo .demo-credit'), /RepDB/);
    assert.ok(await page.$('#execution-figure'), 'figura do atlas sumiu');
  } finally {
    await go('configuracoes/');
    await restoreForjaRaw(saved);
  }
});

await check('Nenhum erro de JavaScript durante todo o fluxo', async () => {
  assert.deepEqual(errors, []);
});

console.log('\n' + '='.repeat(60));
const failed = results.filter(r => r[1] === 'fail');
console.log('E2E navegador real — ' + (results.length - failed.length) + '/' + results.length + ' verificações aprovadas');
if (failed.length) console.log('Falhas: ' + failed.map(f => f[0]).join(' | '));
console.log('='.repeat(60));
console.log('Artefatos (screenshots/downloads): ' + artifactsDir);

await browser.close();
if (localServer) localServer.server.close();
process.exitCode = failed.length ? 1 : 0;
