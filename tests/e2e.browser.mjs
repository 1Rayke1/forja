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
  'progresso/',
  'configuracoes/'
];

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

/* Servidor estático: o repositório fica sob /forja/, como no GitHub Pages. */
function startStaticServer(rootDir) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
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

async function go(rel) {
  currentLabel = rel || 'index';
  await page.goto(new URL(rel, BASE).href, { waitUntil: 'networkidle0' });
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
await go('');

await check('Calendário e missões funcionam na página inicial', async () => {
  currentLabel = 'inicio';
  assert.ok((await page.$$('#calendar-grid .day')).length >= 28, 'Calendário sem dias');
  await page.$eval('#task-input', el => { el.value = 'Missão E2E'; });
  await page.evaluate(() => document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await sleep(120);
  assert.equal(await page.$$eval('#task-list .task', rows => rows.length), 1, 'Missão não foi adicionada');
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

await check('Sem rolagem horizontal em 320, 390, 768 e 1280 px em todas as páginas', async () => {
  for (const rel of PAGES) {
    await go(rel);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewport({ width, height: 800 });
      await sleep(120);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, 'Rolagem horizontal de ' + overflow + 'px em ' + (rel || 'index') + ' a ' + width + 'px');
    }
  }
  await page.setViewport(MOBILE);
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
  assert.ok(await page.$('.modality-card#mode-calisthenics'), 'Cartão de calistenia');
  assert.ok(await page.$('.modality-card#mode-weights'), 'Cartão de musculação');
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

  // Conclui as séries de Agachamento (pulando descansos) até chegar à prancha.
  await advanceUntil(/^Prancha E2E/);
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
  assert.equal(await text('#current-name'), name);

  await page.reload({ waitUntil: 'networkidle0' });
  assert.ok(await isVisible('#execution-live'), 'Sessão não sobreviveu ao recarregamento');
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

await check('Armazenamento local é informado em todas as páginas', async () => {
  for (const rel of ['', 'treino/', 'progresso/', 'configuracoes/']) {
    await go(rel);
    const body = await page.evaluate(() => document.body.textContent);
    assert.match(body, /neste navegador e não são sincronizados/i, 'Aviso de armazenamento local ausente em ' + (rel || 'index'));
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
