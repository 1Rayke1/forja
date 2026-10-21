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
  'treino/biblioteca.html',
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
  const box = await page.$eval('.treino-square', el => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, centerX: r.left + r.width / 2, vw: window.innerWidth,
      icon: !!el.querySelector('svg'), title: el.querySelector('.treino-square-title')?.textContent.trim() };
  });
  assert.ok(box.width <= box.vw - 24, 'Ação ultrapassa a viewport');
  assert.ok(box.height >= 44 && box.height < 100, 'Altura não é compacta/acessível: ' + box.height);
  assert.ok(box.icon, 'Ícone ausente');
  assert.equal(box.title, 'Abrir área de treino');
  const botao = await page.$('.treino-square');
  await botao.screenshot({ path: artifactPath('treino-acao-390.png') });
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
  await page.screenshot({ path: artifactPath('executar-ativo-390.png') });

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

await check('Armazenamento local é informado em todas as páginas', async () => {
  for (const rel of ['', 'treino/', 'progresso/', 'configuracoes/']) {
    await go(rel);
    const body = await page.evaluate(() => document.body.textContent);
    assert.match(body, /neste navegador e não são sincronizados/i, 'Aviso de armazenamento local ausente em ' + (rel || 'index'));
  }
});

await check('Capturas visuais das nove páginas em mobile e desktop', async () => {
  const shots = await browser.newPage();
  shots.on('pageerror', error => errors.push('screenshot: ' + error.message));
  shots.on('console', message => { if (message.type() === 'error') errors.push('screenshot console: ' + message.text()); });
  for (const [index, rel] of PAGES.entries()) {
    const slug = ['inicio','treino','calistenia','musculacao','rotinas','execucao','biblioteca','progresso','configuracoes'][index];
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

await check('Início útil: semana real, rotinas, histórico, retomada e orientação de primeiro uso', async () => {
  const now = Date.now();
  const DAY = 86400000;
  const two = n => String(n).padStart(2, '0');
  const keyFor = ms => {
    const d = new Date(ms);
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  };
  const monday = (() => {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  })();

  const record = (when, extra = {}) => {
    const completedSets = extra.completedSets === undefined ? 3 : extra.completedSets;
    const totalPlannedSets = extra.totalPlannedSets === undefined ? completedSets : extra.totalPlannedSets;
    return Object.assign({
      id: 'e2e-home-' + keyFor(when.getTime()) + '-' + Math.random().toString(36).slice(2, 6),
      date: keyFor(when.getTime()),
      finishedAt: when.toISOString(),
      modality: 'weights',
      routineName: 'Peito',
      durationMs: 30 * 60000,
      completedSets,
      totalPlannedSets,
      status: completedSets >= totalPlannedSets ? 'completed' : 'partial',
      exercises: [],
      totals: {
        volumeKg: 300, reps: 30, seconds: 0, distanceMeters: 0,
        setsLogged: completedSets, setsWithoutVolume: 0
      }
    }, extra);
  };

  const calRoutine = {
    id: 'e2e-home-cal', name: 'Empurrar', modality: 'calisthenics',
    createdAt: 1, updatedAt: 1,
    sections: {
      warmup: [],
      main: [{ id: 'e2e-hc1', name: 'Flexão', section: 'main', sets: 3, type: 'reps', reps: '10', rest: 60, load: '', notes: '' }],
      abs: [],
      finisher: []
    }
  };
  const weightsRoutine = {
    id: 'e2e-home-weights', name: 'Puxar', modality: 'weights',
    createdAt: 2, updatedAt: 2,
    sections: {
      warmup: [],
      main: [{ id: 'e2e-hw1', name: 'Remada', section: 'main', sets: 4, type: 'reps', reps: '8', rest: 90, load: '30 kg', notes: '' }],
      abs: [],
      finisher: []
    }
  };

  const session = {
    version: 2,
    id: 'e2e-home-session',
    date: keyFor(now),
    modality: 'calisthenics',
    routineId: calRoutine.id,
    routineName: 'Empurrar',
    startedAt: now - 600000,
    elapsedMs: 600000,
    running: false,
    currentIndex: 0,
    completedSets: { 'e2e-hc1': 1 },
    totalPlannedSets: 3,
    queue: [{ id: 'e2e-hc1', name: 'Flexão', section: 'main', sets: 3, type: 'reps', reps: '10', rest: 60, load: '', notes: '' }],
    status: 'active',
    restEndAt: null,
    restRemainingMs: 0,
    restPaused: false,
    pendingAdvance: false,
    restPlannedSeconds: 0,
    setTimer: null,
    setLogs: { 'e2e-hc1': [{ set: 1, reps: '10', load: '', seconds: 0, distance: null, rpe: null, editedAt: null }] },
    logDraft: {}
  };

  const seed = {
    'forja-treino-rotinas-v1': { calisthenics: [calRoutine], weights: [weightsRoutine] },
    'forja-treino-historico-v1': [
      record(new Date(now), { routineId: 'e2e-home-weights' }),
      record(monday, {
        routineId: 'e2e-home-weights',
        routineName: 'Pernas',
        completedSets: 2,
        totalPlannedSets: 4,
        durationMs: 20 * 60000
      }),
      record(new Date(now - 9 * DAY), { routineName: 'Semana anterior', durationMs: 45 * 60000 })
    ],
    'forja-treino-metas-v1': {
      version: 1, updatedAt: new Date(now).toISOString(), modality: 'all',
      weeklySessions: 3, weeklySets: 6, weeklyMinutes: 60
    }
  };

  await go('');
  await page.evaluate(data => {
    Object.entries(data).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
  }, seed);
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  /* Semana real: 2 treinos desta semana (30 + 20 min), 5 séries, fora o registro antigo. */
  const statValues = await page.$$eval('#home-week-body .ui-stat-value', nodes => nodes.map(n => n.textContent.trim()));
  const statLabels = await page.$$eval('#home-week-body .ui-stat-label', nodes => nodes.map(n => n.textContent.trim()));
  assert.equal(statValues[statLabels.indexOf('treinos')], '2', 'Treinos da semana errados');
  assert.equal(statValues[statLabels.indexOf('séries')], '5', 'Séries da semana erradas');
  assert.equal(statValues[statLabels.indexOf('tempo')], '50 min', 'Tempo da semana errado');
  assert.ok(await page.$('#home-week-body .home-goal'), 'Metas configuradas não apareceram');
  assert.match(await text('#home-week-body .home-goals'), /2\/3/, 'Progresso da meta de treinos errado');
  assert.match(await text('#home-week-body'), /1 parcial\(is\)/, 'Registro parcial não declarado');

  /* Rotinas reais das duas modalidades, com iniciar e abrir. */
  assert.equal(await page.$$eval('#home-next-body .home-routine', nodes => nodes.length), 2, 'Rotinas reais ausentes na home');
  assert.match(await text('#home-next-body'), /Calistenia/);
  assert.match(await text('#home-next-body'), /Musculação/);
  assert.match(await text('#home-next-body'), /mais recentemente treinada primeiro/);
  const openHref = await page.$eval('#home-next-body .home-routine a.secondary-button', a => a.getAttribute('href'));
  assert.match(openHref, /^treino\/rotina\.html\?modalidade=(calisthenics|weights)&id=/, 'Link de abrir rotina errado');

  /* Histórico recente: só os registros reais, mais novo primeiro. */
  const recentNames = await page.$$eval('#home-recent-body .home-history-name', nodes => nodes.map(n => n.textContent.trim()));
  assert.deepEqual(recentNames.slice(0, 2), ['Peito', 'Pernas'], 'Histórico recente fora de ordem: ' + recentNames.join(' | '));
  assert.equal(await page.$eval('#home-guide', node => node.hidden), true, 'Orientação inicial deveria sair com histórico');

  /* Painel novo respeita as seis larguras, sem rolagem horizontal. */
  for (const width of [320, 360, 390, 430, 768, 1280]) {
    await page.setViewport({ width, height: 900 });
    await sleep(120);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, 'Rolagem horizontal na home a ' + width + 'px: ' + overflow);
  }

  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await page.screenshot({ path: artifactPath('inicio-etapa6-390.png'), fullPage: true });
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await page.screenshot({ path: artifactPath('inicio-etapa6-1280.png'), fullPage: true });
  await page.setViewport(MOBILE);

  /* Sessão ativa: painel oferece retomada e leva à execução real. */
  await page.evaluate(value => {
    localStorage.setItem('forja-treino-sessao-ativa-v1', JSON.stringify(value));
  }, session);
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  assert.ok(await page.$('#home-next-body [data-home-active]'), 'Painel não mostrou a sessão ativa');
  assert.equal(await page.$eval('#active-session-banner', node => node.hidden), false, 'Banner de sessão ativa ausente');
  const resumeHref = await page.$eval('#home-next-body [data-home-active] a.primary-button', a => a.getAttribute('href'));
  assert.match(resumeHref, /treino\/executar\.html$/, 'Link de retomada errado');
  assert.match(await text('#home-next-body [data-home-active]'), /Sessão em andamento/);

  /* Sem dados: orientação de primeiro uso e estados vazios claros. */
  await page.evaluate(() => {
    Object.keys(localStorage).filter(key => key.startsWith('forja-')).forEach(key => localStorage.removeItem(key));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  assert.equal(await page.$$eval('.home-step', nodes => nodes.length), 3, 'Orientação inicial sem os três passos');
  assert.match(await text('#home-guide'), /Por onde começar/);
  assert.match(await text('#home-week-body'), /Nenhum treino registrado ainda/);
  assert.match(await text('#home-next-body'), /Nenhuma rotina cadastrada/);
  assert.match(await text('#home-recent-body'), /Nenhum treino registrado/);
  assert.equal(await page.$$eval('#home-week-body .ui-stat', nodes => nodes.length), 0, 'Estado vazio mostrou número inventado');
  assert.equal(await page.$$eval('#home-next-body .home-routine', nodes => nodes.length), 0);

  for (const width of [320, 360, 390, 430, 768, 1280]) {
    await page.setViewport({ width, height: 900 });
    await sleep(120);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, 'Rolagem horizontal na home vazia a ' + width + 'px: ' + overflow);
  }
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await page.screenshot({ path: artifactPath('inicio-novo-390.png'), fullPage: true });
  await page.setViewport(MOBILE);
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
