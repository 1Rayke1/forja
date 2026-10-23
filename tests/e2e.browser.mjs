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
  'configuracoes/',
  'explorar/',
  'explorar/atlas.html'
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
  await page.goto(new URL(rel, BASE).href, { waitUntil: 'networkidle0' });
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

await check('Atlas: pixels fiéis à referência, corpo completo e destaques registrados na anatomia', async () => {
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
    const source = await loadImage('assets/anatomia/' + manifest.source);
    const plates = {
      front: await loadImage('assets/anatomia/anterior.png'),
      back: await loadImage('assets/anatomia/posterior.png')
    };
    const pixelFailures = [];
    const framingFailures = [];
    const regionFailures = [];
    const alphaByView = {};
    const NS = 'http://www.w3.org/2000/svg';

    for (const view of ['front', 'back']) {
      const plate = plates[view];
      const crop = manifest.plates[view].crop;
      if (plate.naturalWidth !== 350 || plate.naturalHeight !== 690) {
        pixelFailures.push(view + ': dimensões naturais ' + plate.naturalWidth + '×' + plate.naturalHeight);
        continue;
      }

      const referenceCanvas = document.createElement('canvas');
      referenceCanvas.width = crop.width;
      referenceCanvas.height = crop.height;
      const referenceContext = referenceCanvas.getContext('2d');
      referenceContext.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      const reference = referenceContext.getImageData(0, 0, crop.width, crop.height).data;

      const plateCanvas = document.createElement('canvas');
      plateCanvas.width = crop.width;
      plateCanvas.height = crop.height;
      const plateContext = plateCanvas.getContext('2d');
      plateContext.drawImage(plate, 0, 0);
      const rendered = plateContext.getImageData(0, 0, crop.width, crop.height).data;
      alphaByView[view] = { pixels: rendered, width: crop.width, height: crop.height };

      let compared = 0;
      let mismatched = 0;
      let maxDelta = 0;
      let top = crop.height;
      let left = crop.width;
      let right = -1;
      let bottom = -1;
      for (let index = 0; index < crop.width * crop.height; index += 1) {
        const offset = index * 4;
        const alpha = rendered[offset + 3];
        if (alpha >= 128) {
          const x = index % crop.width;
          const y = Math.floor(index / crop.width);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
        if (alpha !== 255) continue;
        compared += 1;
        const delta = Math.max(
          Math.abs(rendered[offset] - reference[offset]),
          Math.abs(rendered[offset + 1] - reference[offset + 1]),
          Math.abs(rendered[offset + 2] - reference[offset + 2])
        );
        maxDelta = Math.max(maxDelta, delta);
        /* SwiftShader e o decodificador de software podem variar 1 nível de
           8 bits. Não há tolerância para deslocamento ou alteração visível. */
        if (delta > 1) mismatched += 1;
      }
      if (compared < 40000 || mismatched !== 0) {
        pixelFailures.push(view + ': ' + mismatched + ' pixels com delta > 1 em ' + compared +
          ' comparados; delta máximo=' + maxDelta);
      }
      if (top < 4 || bottom < 650 || bottom > 681 || left < 2 || right > 347) {
        framingFailures.push(view + ': limites ' + JSON.stringify({ left, top, right, bottom }));
      }
    }

    /* Cada caminho é percorrido de verdade. Amostras de sua borda precisam
       encontrar corpo opaco num raio de 2 px na prancha correspondente. */
    const geometry = document.createElementNS(NS, 'svg');
    geometry.setAttribute('viewBox', '0 0 350 690');
    geometry.setAttribute('width', '350');
    geometry.setAttribute('height', '690');
    geometry.style.position = 'fixed';
    geometry.style.left = '-10000px';
    geometry.style.top = '0';
    document.body.appendChild(geometry);

    const opaqueNear = (view, x, y) => {
      const data = alphaByView[view];
      if (!data) return false;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const px = Math.round(x) + dx;
          const py = Math.round(y) + dy;
          if (px < 0 || py < 0 || px >= data.width || py >= data.height) continue;
          if (data.pixels[(py * data.width + px) * 4 + 3] >= 128) return true;
        }
      }
      return false;
    };

    for (const view of ['front', 'back']) {
      for (const [regionId, region] of Object.entries(window.Forja.figura.REGIONS)) {
        const shapes = window.Forja.figura.shapesFor(regionId, view) || [];
        for (const shape of shapes) {
          const path = document.createElementNS(NS, 'path');
          path.setAttribute('d', shape);
          geometry.appendChild(path);
          const box = path.getBBox();
          const length = path.getTotalLength();
          let outside = 0;
          const samples = 24;
          for (let index = 0; index < samples; index += 1) {
            const point = path.getPointAtLength(length * index / samples);
            if (!opaqueNear(view, point.x, point.y)) outside += 1;
          }
          if (box.x < 0 || box.y < 0 || box.x + box.width > 350 || box.y + box.height > 690 ||
              !Number.isFinite(length) || length < 20 || outside > 2) {
            regionFailures.push(view + '/' + regionId + ': ' + outside + '/' + samples +
              ' amostras fora; bbox=' + JSON.stringify({ x: box.x, y: box.y, width: box.width, height: box.height }));
          }
          path.remove();
        }
      }
    }
    geometry.remove();

    const roles = {};
    for (const role of ['primary', 'secondary', 'stabilizer']) {
      const shape = document.querySelector('.figura-region.is-' + role + ' .figura-region-shape');
      if (!shape) {
        roles[role] = null;
        continue;
      }
      const style = getComputedStyle(shape);
      roles[role] = { fill: style.fill, opacity: style.fillOpacity, blend: style.mixBlendMode };
    }
    return { pixelFailures, framingFailures, regionFailures, roles };
  }, BASE);

  assert.deepEqual(audit.pixelFailures, [], 'As pranchas devem preservar os RGB opacos da referência (delta máximo 1/255)');
  assert.deepEqual(audit.framingFailures, [], 'Cabeça, mãos ou pés fora do enquadramento');
  assert.deepEqual(audit.regionFailures, [], 'Destaques desalinhados da anatomia visível');
  assert.deepEqual(audit.roles, {
    primary: { fill: 'rgb(183, 243, 74)', opacity: '0.62', blend: 'color' },
    secondary: { fill: 'rgb(242, 184, 75)', opacity: '0.56', blend: 'color' },
    stabilizer: { fill: 'rgb(140, 192, 224)', opacity: '0.54', blend: 'color' }
  });
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

await check('Capturas visuais das páginas em mobile e desktop', async () => {
  const shots = await browser.newPage();
  shots.on('pageerror', error => errors.push('screenshot: ' + error.message));
  shots.on('console', message => { if (message.type() === 'error') errors.push('screenshot console: ' + message.text()); });
  for (const [index, rel] of PAGES.entries()) {
    const slug = ['inicio','treino','calistenia','musculacao','rotinas','execucao','biblioteca','progresso','configuracoes','explorar','atlas'][index];
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
