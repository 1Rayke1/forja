/*
  Teste end-to-end em navegador real.

  Sobe a própria página em um servidor HTTP local (nenhum processo externo é
  necessário) e usa puppeteer-core com um Chromium já instalado no sistema
  (PUPPETEER_EXECUTABLE_PATH) ou o binário empacotado em
  @sparticuz/chromium. As duas dependências estão em devDependencies.

  Uso:
    npm install
    npm run test:e2e

  Variáveis opcionais:
    PUPPETEER_EXECUTABLE_PATH  caminho de um Chrome/Chromium local
    FORJA_URL                  usa um servidor já em execução
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

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch (error) {
  console.error(
    'puppeteer-core não está instalado. Rode "npm install" na raiz do projeto.'
  );
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

function startStaticServer(rootDir) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      const relative = requestUrl.pathname === '/'
        ? 'index.html'
        : decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
      const filePath = path.resolve(rootDir, relative);

      if (!filePath.startsWith(rootDir + path.sep) && filePath !== rootDir) {
        response.statusCode = 403;
        response.end('forbidden');
        return;
      }

      // O app é um único index.html; não expõe node_modules, .git ou testes.
      if (relative !== 'index.html') {
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

        response.setHeader(
          'Content-Type',
          mime[path.extname(filePath)] || 'application/octet-stream'
        );
        response.end(data);
      });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        url: 'http://127.0.0.1:' + server.address().port + '/index.html'
      });
    });
  });
}

const localServer = process.env.FORJA_URL
  ? null
  : await startStaticServer(repoRoot);
const BASE = process.env.FORJA_URL || localServer.url;

let browser;
try {
  browser = await puppeteer.launch({
    args: launchArgs,
    defaultViewport: { width: 390, height: 844 },
    executablePath,
    headless: true
  });
} catch (error) {
  console.error(
    'Não foi possível iniciar o navegador (' + executablePath + '): ' + error.message +
    '\nDica: defina PUPPETEER_EXECUTABLE_PATH para um Chrome/Chromium compatível.'
  );
  if (localServer) localServer.server.close();
  process.exit(1);
}
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
page.on('requestfailed', r => consoleErrors.push('requestfailed: ' + r.url()));

const $ = s => page.$(s);
const text = async s => page.$eval(s, e => e.textContent.trim());
const click = async s => { await page.click(s); await sleep(60); };
const waitFor = async (fn, timeout = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return true;
    await sleep(50);
  }
  return false;
};

async function check(name, fn) {
  try { await fn(); results.push([name, 'ok']); console.log('✅ ' + name); }
  catch (e) { results.push([name, 'fail']); console.log('❌ ' + name + '\n   ' + e.message.split('\n')[0]); }
}


await page.goto(BASE, { waitUntil: 'networkidle0' });
await sleep(200);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await sleep(200);

await check('Sem erros de console na carga inicial', async () => {
  assert.deepEqual(consoleErrors, []);
});

await check('Sem overflow horizontal em 320, 360, 390, 430, 768 e 1280', async () => {
  for (const width of [320, 360, 390, 430, 768, 1280]) {
    await page.setViewport({ width, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(120);
    const overflow = await page.evaluate(() => {
      const innerWidth = window.innerWidth;
      const offenders = [];
      document.querySelectorAll('body *').forEach(el => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.right > innerWidth + 1 || rect.left < -1) {
          offenders.push(el.tagName + '.' + el.className + ' [' + Math.round(rect.left) + ',' + Math.round(rect.right) + ']');
        }
      });
      return { docScroll: document.documentElement.scrollWidth, innerWidth, offenders: offenders.slice(0, 5) };
    });
    assert.ok(overflow.docScroll <= overflow.innerWidth + 1, 'docScroll ' + overflow.docScroll + ' em ' + width);
    assert.deepEqual(overflow.offenders, [], 'overflow em ' + width + ': ' + overflow.offenders.join(' | '));
  }
  await page.setViewport({ width: 390, height: 844 });
});

await check('Cartões de modalidade são tocáveis e não sobrepostos (320px)', async () => {
  await page.setViewport({ width: 320, height: 700 });
  await page.evaluate(() => document.getElementById('workout-heading').scrollIntoView());
  await sleep(250);
  for (const id of ['#mode-calisthenics', '#mode-weights']) {
    const info = await page.$eval(id, el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { r: { w: r.width, h: r.height }, hit: top ? (top.closest('#' + el.id) !== null) : false };
    });
    assert.ok(info.r.w > 120 && info.r.h > 120, id + ' pequeno: ' + JSON.stringify(info.r));
    assert.equal(info.hit, true, 'Toque em ' + id + ' atinge outro elemento');
  }
  await page.setViewport({ width: 390, height: 844 });
});

await check('Fluxo completo: rotinas A/B/C nas duas modalidades', async () => {
  for (const mode of ['calisthenics', 'weights']) {
    await page.evaluate(m => document.getElementById('mode-' + m).click(), mode);
    await sleep(100);
    for (const name of ['Treino A', 'Treino B']) {
      await page.evaluate(() => document.getElementById('new-routine').click());
      await sleep(120);
      const input = await page.$('[data-modal-field="name"]');
      await input.click({ clickCount: 3 });
      await page.keyboard.type(name);
      await page.evaluate(() => document.querySelector('[data-modal-action="create"]').click());
      await sleep(150);

      const exercises = [
        { section: 'warmup', name: 'Mobilidade de ombro', sets: 2, type: 'duration', duration: 30, rest: 15, notes: '' },
        { section: 'main', name: mode === 'weights' ? 'Supino reto' : 'Flexão de braço', sets: 3, type: 'reps', reps: '8-12', rest: 1, notes: 'Execução controlada', load: mode === 'weights' ? '40 kg' : '' },
        { section: 'abs', name: 'Prancha', sets: 2, type: 'duration', duration: 40, rest: 20 },
        { section: 'finisher', name: 'Burpee', sets: 1, type: 'reps', reps: '10', rest: 0 }
      ];

      for (const ex of exercises) {
        await page.select('#exercise-section', ex.section);
        await page.evaluate(() => { document.getElementById('exercise-name').value = ''; });
        await page.type('#exercise-name', ex.name);
        await page.evaluate((e) => {
          document.getElementById('exercise-sets').value = String(e.sets);
          document.getElementById(e.type === 'duration' ? 'exercise-type-duration' : 'exercise-type-reps').click();
          if (e.type === 'duration') document.getElementById('exercise-duration').value = String(e.duration);
          else document.getElementById('exercise-reps').value = e.reps;
          document.getElementById('exercise-rest').value = String(e.rest);
          document.getElementById('exercise-load').value = e.load || '';
          document.getElementById('exercise-notes').value = e.notes || '';
          document.getElementById('exercise-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }, ex);
        await sleep(120);
      }

      await page.evaluate(() => document.getElementById('save-routine-top').click());
      await sleep(150);
      await page.evaluate(() => document.getElementById('back-from-editor').click());
      await sleep(180);
    }
  }

  const routines = await page.evaluate(() => JSON.parse(localStorage.getItem('forja-treino-rotinas-v1')));
  assert.equal(routines.calisthenics.length, 2);
  assert.equal(routines.weights.length, 2);
  assert.equal(routines.weights[0].sections.main[0].load, '40 kg');
  assert.equal(routines.calisthenics[0].sections.warmup[0].type, 'duration');
});

await check('Rotinas duplicam/renomeiam/excluem com confirmação', async () => {
  await page.evaluate(() => document.getElementById('mode-weights').click());
  await sleep(120);
  await page.evaluate(() => document.querySelector('.routine-card .small-button').click());
  await sleep(150);
  let routines = await page.evaluate(() => JSON.parse(localStorage.getItem('forja-treino-rotinas-v1')));
  assert.equal(routines.weights.length, 3);
  assert.ok(routines.weights.some(r => r.name === 'Treino A (cópia)'));

  const copyCard = await page.evaluateHandle(() => {
    return [...document.querySelectorAll('.routine-card')].find(c => c.textContent.includes('(cópia)'));
  });
  await page.evaluate(el => el.querySelector('.danger-button').click(), copyCard);
  await sleep(150);
  assert.equal(await text('#modal-title'), 'Excluir rotina?');
  await page.evaluate(() => document.querySelector('[data-modal-action="cancel"]').click());
  await sleep(120);
  routines = await page.evaluate(() => JSON.parse(localStorage.getItem('forja-treino-rotinas-v1')));
  assert.equal(routines.weights.length, 3, 'Cancelar deve manter a rotina');

  await page.evaluate(el => el.querySelector('.danger-button').click(), copyCard);
  await sleep(150);
  await page.evaluate(() => document.querySelector('[data-modal-action="delete"]').click());
  await sleep(180);
  routines = await page.evaluate(() => JSON.parse(localStorage.getItem('forja-treino-rotinas-v1')));
  assert.equal(routines.weights.length, 2);
});

await check('Execução, descanso, pausa, retomada e recarregamento no meio da sessão', async () => {
  await page.evaluate(() => document.getElementById('mode-calisthenics').click());
  await sleep(120);
  await page.evaluate(() => document.querySelector('.routine-card [data-action="start"]').click());
  await sleep(250);

  assert.equal(await page.evaluate(() => document.getElementById('execution-screen').hidden), false);
  assert.equal(await text('#current-name'), 'Mobilidade de ombro');
  assert.equal(await text('#execution-position'), 'Exercício 1 de 4');
  assert.equal((await text('#current-sets-value')).replace(/\s+/g, ' '), '0 / 2');
  await page.screenshot({ path: artifactPath('e2e-execution.png') });

  // pausar treino e retomar
  await click('#pause-session');
  assert.equal(await page.evaluate(() => document.getElementById('session-paused-overlay').hidden), false);
  await click('#resume-session');
  assert.equal(await page.evaluate(() => document.getElementById('session-paused-overlay').hidden), true);

  // concluir série e recarregar durante o descanso
  await click('#complete-set');
  assert.equal(await page.evaluate(() => document.getElementById('execution-rest').hidden), false);
  const before = await text('#current-sets-value');
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(300);
  assert.equal(await page.evaluate(() => document.getElementById('execution-screen').hidden), false);
  assert.equal(await text('#current-name'), 'Mobilidade de ombro');
  assert.equal((await text('#current-sets-value')).replace(/\s+/g, ' '), (await before).replace(/\s+/g, ' '));

  // pausar/retomar descanso
  await click('#pause-rest');
  assert.match(await text('#rest-caption'), /pausado/);
  await click('#resume-rest');
  assert.match(await text('#rest-caption'), /série 2 de 2|Respire/);

  // avançar automaticamente (descanso de 15s -> pular)
  await page.evaluate(() => document.getElementById('skip-rest').click());
  await sleep(150);
  await page.evaluate(() => document.getElementById('complete-set').click());
  await sleep(150);
  if (await page.evaluate(() => !document.getElementById('execution-rest').hidden)) {
    await page.evaluate(() => document.getElementById('skip-rest').click());
    await sleep(150);
  }
  assert.equal(await text('#current-name'), 'Flexão de braço');

  // concluir as séries restantes pulando descansos
  for (let i = 0; i < 12; i++) {
    const state = await page.evaluate(() => {
      const btn = document.getElementById('complete-set');
      if (!btn.disabled) { btn.click(); return 'set'; }
      const rest = document.getElementById('execution-rest');
      if (!rest.hidden && !document.getElementById('skip-rest').disabled) {
        document.getElementById('skip-rest').click(); return 'skip';
      }
      const next = document.getElementById('next-exercise');
      if (!next.hidden && !next.disabled) { next.click(); return 'next'; }
      return 'idle';
    });
    if (state === 'idle') break;
    await sleep(70);
  }

  const summaryVisible = await waitFor(() => !document.getElementById('execution-summary').hidden, 4000);
  assert.equal(summaryVisible, true, 'Resumo não apareceu');
  assert.equal(await text('#summary-sets'), '8/8');
  assert.match(await text('#summary-title'), /Treino concluído/);
  await page.screenshot({ path: artifactPath('e2e-summary.png') });
  await click('#summary-close');
  await sleep(200);
  assert.equal(await page.evaluate(() => document.getElementById('execution-screen').hidden), true);
  assert.equal(await text('#history-total'), '1');
});

await check('Cancelar sessão não registra treino', async () => {
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('forja-treino-historico-v1') || '[]').length);
  await page.evaluate(() => document.querySelector('.routine-card [data-action="start"]').click());
  await sleep(200);
  await page.evaluate(() => document.getElementById('complete-set').click());
  await sleep(100);
  await page.evaluate(() => document.getElementById('end-session').click());
  await sleep(150);
  const actions = await page.$$eval('[data-modal-action]', els => els.map(e => e.getAttribute('data-modal-action')));
  assert.ok(actions.includes('discard'), 'Modal deve oferecer descarte');
  await page.evaluate(() => document.querySelector('[data-modal-action="discard"]').click());
  await sleep(200);
  const after = await page.evaluate(() => ({
    history: JSON.parse(localStorage.getItem('forja-treino-historico-v1') || '[]').length,
    active: localStorage.getItem('forja-treino-sessao-ativa-v1')
  }));
  assert.equal(after.history, before);
  assert.equal(after.active, null);
});

await check('Exportação e importação via seletor de arquivo', async () => {
  const downloadPath = artifactPath('downloads');
  fs.mkdirSync(downloadPath, { recursive: true });
  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });

  await page.evaluate(() => document.getElementById('export-backup').click());
  let file = null;
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    const files = fs.readdirSync(downloadPath).filter(f => f.endsWith('.json'));
    if (files.length) { file = files[0]; break; }
  }
  assert.ok(file, 'Download do backup não aconteceu');
  const content = fs.readFileSync(path.join(downloadPath, file), 'utf8');
  const backup = JSON.parse(content);
  assert.equal(backup.app, 'FORJA');
  assert.ok(backup.keys['forja-treino-rotinas-v1']);
  assert.ok(backup.keys['forja-treino-historico-v1']);

  // alterar dados e restaurar via input de arquivo
  await page.evaluate(() => {
    localStorage.setItem('forja-treino-rotinas-v1', JSON.stringify({ calisthenics: [], weights: [] }));
    localStorage.setItem('forja-missoes-2026-10-19', JSON.stringify([{ id: 'x', text: 'Missão temporária', done: false }]));
    document.getElementById('import-backup-button').click();
  });
  const input = await page.$('#import-backup-input');
  await input.uploadFile(path.join(downloadPath, file));
  await sleep(400);
  assert.match(await text('#modal-title'), /Restaurar backup/);
  const preview = await page.$eval('.modal-details', e => e.textContent);
  assert.match(preview, /Histórico: 1 treino/);
  await page.screenshot({ path: artifactPath('e2e-import.png') });
  await page.evaluate(() => document.querySelector('[data-modal-action="restore"]').click());
  await sleep(400);
  const restored = await page.evaluate(() => ({
    routines: JSON.parse(localStorage.getItem('forja-treino-rotinas-v1')),
    mission: localStorage.getItem('forja-missoes-2026-10-19'),
    safety: !!localStorage.getItem('forja-backup-seguranca-v1')
  }));
  assert.equal(restored.routines.calisthenics.length, 2);
  assert.equal(restored.mission, null);
  assert.equal(restored.safety, true);

  // desfazer última importação
  const undoVisible = await page.evaluate(() => !document.getElementById('restore-safety-backup').hidden);
  assert.equal(undoVisible, true);
  await page.evaluate(() => document.getElementById('restore-safety-backup').click());
  await sleep(250);
  await page.evaluate(() => document.querySelector('[data-modal-action="restore"]').click());
  await sleep(400);
  const undone = await page.evaluate(() => ({
    routines: JSON.parse(localStorage.getItem('forja-treino-rotinas-v1')),
    mission: localStorage.getItem('forja-missoes-2026-10-19')
  }));
  assert.equal(undone.routines.calisthenics.length, 0);
  assert.match(undone.mission, /Missão temporária/);
});

await check('JSON inválido é rejeitado sem alterar dados', async () => {
  const badBackupPath = artifactPath('bad-backup.json');
  fs.writeFileSync(badBackupPath, '{isto não é json');
  const before = await page.evaluate(() => JSON.stringify(localStorage));
  const input = await page.$('#import-backup-input');
  await input.uploadFile(badBackupPath);
  await sleep(350);
  assert.match(await text('#modal-title'), /Arquivo inválido/);
  await page.evaluate(() => document.querySelector('[data-modal-action="close"]').click());
  await sleep(150);
  const after = await page.evaluate(() => JSON.stringify(localStorage));
  assert.equal(after, before);
});

await check('Calendário e missões funcionam após as mudanças', async () => {
  const today = await page.evaluate(() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });

  await page.evaluate(() => {
    document.getElementById('task-input').value = 'Missão E2E';
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await sleep(200);

  let tasks = await page.evaluate(t => JSON.parse(localStorage.getItem('forja-missoes-' + t) || '[]'), today);
  assert.equal(tasks.some(task => task.text === 'Missão E2E'), true, 'Missão E2E não foi salva');
  const total = tasks.length;
  const doneBefore = tasks.filter(task => task.done).length;
  assert.equal(
    await text('#progress-label'),
    doneBefore + ' de ' + total + ' · ' + Math.round(doneBefore / total * 100) + '%'
  );

  for (let i = 0; i < total; i++) {
    const clicked = await page.evaluate(() => {
      const box = [...document.querySelectorAll('.task input[type=checkbox]')].find(el => !el.checked);
      if (!box) return false;
      box.click();
      return true;
    });
    if (!clicked) break;
    await sleep(120);
  }

  tasks = await page.evaluate(t => JSON.parse(localStorage.getItem('forja-missoes-' + t) || '[]'), today);
  assert.equal(tasks.every(task => task.done), true, 'Todas as missões devem estar concluídas');
  assert.equal(await text('#progress-label'), total + ' de ' + total + ' · 100%');
  await sleep(150);
  assert.ok((await page.$$('.calendar-grid .day.has-tasks')).length >= 1, 'Dia com missões deve ter indicador');

  const title = await text('#month-title');
  await page.evaluate(() => document.getElementById('next-month').click());
  await sleep(150);
  assert.notEqual(await text('#month-title'), title);
  await page.evaluate(() => document.getElementById('prev-month').click());
  await sleep(150);
  assert.equal(await text('#month-title'), title);
  await page.screenshot({ path: artifactPath('e2e-calendar.png') });
});

await check('Nenhum erro de console durante todo o fluxo', async () => {
  assert.deepEqual(consoleErrors, []);
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
