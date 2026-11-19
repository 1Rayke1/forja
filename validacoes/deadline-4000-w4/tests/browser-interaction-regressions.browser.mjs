/* CSSOM/Chromium reais. Barreiras explícitas, nenhum sleep/clique DOM.
   Cada aprovação prova posição, estabilidade, visibilidade e input trusted.
   Bloqueios têm causa observada + recuperação ou diagnóstico específico. */
import assert from 'node:assert/strict';
import { launchBrowser } from './helpers/browser.mjs';
import { scrollToInteractable } from './helpers/browser-interaction.mjs';
let passed = 0, failed = 0;
const viewport = { width: 390, height: 844 };
const turns = page => page.evaluate(() => new Promise(resolve => {
  let frames = 0;
  const tick = () => { if (++frames === 6) resolve(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}));
const cases = [
  { id: 1, name: 'scroll-margin vertical', css: '#target{scroll-margin-top:120px}' },
  { id: 2, name: 'scroll-padding vertical', css: 'html{scroll-padding-top:120px}' },
  { id: 3, name: 'scroll-margin horizontal', axis: 'horizontal', css: '#target{scroll-margin-right:120px}' },
  { id: 4, name: 'scroll-padding horizontal', axis: 'horizontal', css: 'html{scroll-padding-right:120px}' },
  { id: 5, name: 'redução dinâmica do limite máximo', change: 'limit', top: 1200, height: 2034 },
  { id: 6, name: 'geometria muda durante a animação', change: 'geometry' },
  { id: 7, name: 'ancestral opacity zero', hidden: 'opacity' },
  { id: 8, name: 'ancestral visibility hidden', hidden: 'visibility' },
  { id: 9, name: 'ancestral display none', hidden: 'display' },
  { id: 10, name: 'original removido durante a rolagem', change: 'remove' },
  { id: 11, name: 'obstrução por outro elemento', covered: true },
  { id: 12, name: 'horizontal: dois eixos, pulso não estável e evento nativo', axis: 'horizontal' },
  { id: 13, name: 'diagonal: pausa com eixo Y pronto e X ainda pendente', axis: 'diagonal', css: 'html{scroll-padding-right:120px}' },
  { id: 14, name: 'pausa intermediária antes do destino atualizado' },
  { id: 15, name: 'ausência de progresso com alvo já livre', top: 650 }
];
function html(config, visible = false) {
  const x = config.axis ? 1000 : 0, y = config.axis === 'horizontal' ? 405 : config.top ?? 900;
  const width = config.axis ? 2200 : 390, height = config.axis === 'horizontal' ? 844 : config.height ?? 2500;
  const hidden = visible ? '' : ({ opacity: 'opacity:0', visibility: 'visibility:hidden', display: 'display:none' }[config.hidden] || '');
  return `<!doctype html><style>html{scroll-behavior:smooth}body{margin:0;width:${width}px;height:${height}px;overflow-anchor:none}#target{position:absolute;left:${x}px;top:${y}px;width:100px;height:34px;padding:0;border:0}#cover{position:fixed;inset:0;background:#333;z-index:20}${config.css || ''}</style><main id="wrap" style="${hidden}"><button id="target">Alvo</button></main>${config.covered && !visible ? '<aside id="cover">Obstrução</aside>' : ''}`;
}
// Controle independente: DOM real idêntico, pedido nativo instantâneo, em OUTRA
// página. Os valores esperados não usam a fórmula nem a referência do helper.
async function nativeDestination(browser, config) {
  const page = await browser.newPage();
  try {
    await page.setViewport(viewport); await page.setContent(html(config, true));
    return await page.evaluate(change => {
      const element = document.getElementById('target');
      if (change === 'limit') document.body.style.height = '1234px';
      if (change === 'geometry') { element.style.top = '1100px'; element.style.width = '140px'; document.body.style.height = '2200px'; }
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      return [scrollX, scrollY];
    }, config.id === 14 ? 'geometry' : config.change);
  } finally { await page.close(); }
}
async function fixture(browser, mode, config) {
  const expected = await nativeDestination(browser, config), page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.setViewport(viewport); await page.setContent(html(config));
  assert.equal(await page.evaluate(() => 'onscrollend' in document), mode, 'ON/OFF deve mudar a capacidade real');
  await page.evaluate(change => {
    const original = document.querySelector('#target'), native = original.scrollIntoView.bind(original);
    const root = document.scrollingElement;
    window.fx = { original, holdRequest: true, holdEnd: true, requested: 0, nativeRequests: 0, delivered: 0,
      ends: [], moves: [], pendingEnds: [], clicks: [], changed: false };
    document.addEventListener('scroll', event => {
      if (event.target === document || event.target === root) fx.moves.push([scrollX, scrollY]);
    });
    document.addEventListener('scrollend', event => {
      if (event.target === document || event.target === root) fx.ends.push({ position: [scrollX, scrollY], trusted: event.isTrusted, time: event.timeStamp });
    });
    if (['limit', 'geometry', 'remove'].includes(change)) document.addEventListener('scroll', () => {
      if (change === 'limit') document.body.style.height = '1234px';
      if (change === 'geometry') { original.style.top = '1100px'; original.style.width = '140px'; document.body.style.height = '2200px'; }
      if (change === 'remove') original.replaceWith(original.cloneNode(true));
      fx.changed = true;
    }, { once: true });
    original.scrollIntoView = options => {
      fx.requested++;
      const run = () => { fx.nativeRequests++; native(options); };
      if (fx.holdRequest) fx.pendingRequest = run; else run();
    };
    fx.releaseRequest = () => { fx.holdRequest = false; const run = fx.pendingRequest; fx.pendingRequest = null; if (run) run(); };
    original.addEventListener('click', event => fx.clicks.push({ trusted: event.isTrusted, position: [scrollX, scrollY] }));
    const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document), listeners = new Map();
    document.addEventListener = (type, listener, options) => {
      if (!['scroll', 'scrollend'].includes(type)) return add(type, listener, options);
      const wrapped = event => {
        if (type !== 'scrollend') return listener(event);
        const deliver = () => { fx.delivered++; listener(event); };
        if (fx.holdEnd) fx.pendingEnds.push(deliver); else deliver();
      };
      listeners.set(listener, { type, wrapped }); return add(type, wrapped, options);
    };
    document.removeEventListener = (type, listener, options) => {
      const entry = listeners.get(listener); if (entry) listeners.delete(listener);
      return remove(type, entry?.wrapped || listener, options);
    };
    fx.active = () => listeners.size;
    fx.releaseEnds = (keepHolding = false) => { fx.holdEnd = keepHolding; for (const deliver of fx.pendingEnds.splice(0)) deliver(); };
  }, config.change);
  return { page, errors, expected };
}
const snapshot = page => page.evaluate(() => {
  const element = document.getElementById('target'), box = element?.getBoundingClientRect(), root = document.scrollingElement;
  const top = box && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2), style = element && getComputedStyle(element);
  return { position: [scrollX, scrollY], max: [root.scrollWidth - innerWidth, root.scrollHeight - innerHeight],
    box: box?.toJSON(), connectedOriginal: fx.original.isConnected, sameElement: element === fx.original,
    visible: !!element?.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true }),
    ownOpacity: style?.opacity, ancestorOpacity: getComputedStyle(document.getElementById('wrap')).opacity,
    visibility: style?.visibility, ancestorDisplay: getComputedStyle(document.getElementById('wrap')).display,
    inViewport: !!box && box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
    hit: top?.tagName, hitOk: !!element && (top === element || element.contains(top)),
    requested: fx.requested, nativeRequests: fx.nativeRequests, delivered: fx.delivered, pending: fx.pendingEnds.length,
    events: fx.ends, moves: fx.moves, changed: fx.changed, active: fx.active(), references: document.querySelectorAll('iframe').length, clicks: fx.clicks };
});
function start(page) {
  const operation = { complete: false, settled: false, started: performance.now() };
  operation.waiting = scrollToInteractable(page, '#target').then(() => { operation.complete = true; operation.settled = true; }, error => { operation.settled = true; throw error; });
  void operation.waiting.catch(() => {}); return operation;
}
const closeTo = (actual, expected) => assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) < 1), `posição ${actual} difere do controle nativo ${expected}`);
async function requested(page, operation) {
  await page.waitForFunction(() => fx.requested > 0, { polling: 'raf', timeout: 4000 });
  await turns(page); assert.equal(operation.complete, false, 'pedido retido não pode ser dado como concluído');
  assert.deepEqual((await snapshot(page)).position, [0, 0], 'a referência do helper não pode rolar a página real');
}
async function atFinal(page, expected, mode, held = true) {
  await page.waitForFunction(expected => Math.abs(scrollX - expected[0]) < 1 && Math.abs(scrollY - expected[1]) < 1,
    { polling: 'raf', timeout: 4000 }, expected);
  if (mode) await page.waitForFunction((expected, held) => (!held || fx.pendingEnds.length > 0) &&
    fx.ends.some(event => event.position.every((v, i) => Math.abs(v - expected[i]) < 1)),
    { polling: 'raf', timeout: 4000 }, expected, held);
}
async function ready(page, operation, expected, mode) {
  await operation.waiting;
  const result = await snapshot(page); closeTo(result.position, expected);
  assert.equal(result.connectedOriginal, true); assert.equal(result.sameElement, true);
  assert.equal(result.visible, true); assert.equal(result.inViewport, true); assert.equal(result.hitOk, true);
  assert.equal(result.active, 0, 'listeners precisam ser limpos'); assert.equal(result.references, 0, 'referência precisa ser removida');
  assert.equal(result.events.length > 0, mode); if (mode) assert.ok(result.events.every(event => event.trusted));
  await turns(page); const later = await snapshot(page);
  assert.deepEqual(later.position, result.position); assert.deepEqual(later.box, result.box, 'geometria não pode mudar após conclusão');
  await page.click('#target'); const clicked = (await snapshot(page)).clicks.at(-1);
  assert.equal(clicked?.trusted, true); closeTo(clicked.position, result.position);
  return { expected, position: result.position, box: result.box, nativeEvents: result.events.length, nativeDelivered: result.delivered,
    requests: result.requested, changed: result.changed, visible: true, hit: result.hit, trustedClick: clicked.trusted, cleanup: true };
}
async function finish(page, operation, expected, mode) {
  await page.evaluate(() => fx.releaseRequest());
  await atFinal(page, expected, mode);
  if (mode) {
    await turns(page); assert.equal(operation.complete, false, 'destino/estabilidade não dispensam o evento nativo de nenhum eixo');
    await page.evaluate(() => fx.releaseEnds());
  }
  return ready(page, operation, expected, mode);
}
async function negativeTimeout(page, operation, reason) {
  let caught;
  await assert.rejects(operation.waiting, error => {
    caught = error; assert.equal(error.name, 'TimeoutError'); assert.match(error.message, /4000ms/);
    assert.equal(error.interaction?.reason, reason, 'timeout precisa comprovar a causa específica'); return true;
  });
  const elapsedMs = Math.round(performance.now() - operation.started);
  assert.ok(elapsedMs >= 3900, 'não pode ser uma rejeição genérica imediata');
  const state = await snapshot(page); assert.equal(state.active, 0); assert.equal(state.references, 0); assert.equal(state.clicks.length, 0);
  return { elapsedMs, reason, diagnostic: caught.interaction, state };
}
for (const mode of [true, false]) {
  const browser = await launchBrowser({ enforceWebSecurity: true, scrollEndEvents: mode });
  try {
    console.log(`REGRESSION CONFIG ${mode ? 'ON' : 'OFF'}: ${await browser.version()}; SOP/CORS/isolamento ativos`);
    for (const config of cases) {
      const { page, errors, expected } = await fixture(browser, mode, config);
      let checkpoint;
      try {
        const operation = start(page); await requested(page, operation);
        let evidence;
        if (config.id === 10) {
          await page.evaluate(() => { fx.holdEnd = false; fx.releaseRequest(); });
          await page.waitForFunction(() => fx.changed && !fx.original.isConnected, { polling: 'raf', timeout: 4000 });
          const negative = await negativeTimeout(page, operation, 'detached');
          assert.equal(negative.diagnostic.connected, false); assert.equal(negative.state.sameElement, false);
          assert.equal(negative.state.connectedOriginal, false); assert.equal(negative.state.changed, true);
          evidence = { blockedBecause: 'original-disconnected-even-with-same-selector-replacement', ...negative };
        } else if (config.id === 15) {
          const initial = await snapshot(page); assert.equal(initial.hitOk, true); assert.equal(initial.inViewport, true); assert.equal(initial.visible, true);
          const negative = await negativeTimeout(page, operation, 'destination');
          assert.deepEqual(negative.diagnostic.position, [0, 0]); closeTo(negative.diagnostic.destination, expected);
          assert.equal(negative.diagnostic.atDestination, false); assert.equal(negative.state.requested > 0, true);
          assert.equal(negative.state.nativeRequests, 0); assert.equal(negative.state.moves.length, 0);
          await page.evaluate(() => { fx.holdRequest = false; fx.holdEnd = false; });
          const control = start(page); evidence = { blockedBecause: 'request-retained-with-visible-uncovered-target', negative: { ...negative, state: undefined }, recovery: await ready(page, control, expected, mode) };
        } else if (config.hidden || config.covered) {
          await page.evaluate(() => { fx.holdEnd = false; fx.releaseRequest(); });
          if (config.hidden !== 'display') await atFinal(page, expected, mode, false);
          await turns(page); checkpoint = await snapshot(page);
          assert.equal(operation.complete, false, 'condição visual fechada deve bloquear mesmo com scroll liberado');
          assert.ok(checkpoint.nativeRequests > 0);
          if (mode && config.hidden !== 'display') assert.ok(checkpoint.delivered > 0, 'o bloqueio visual não pode ser falta de evento');
          if (config.hidden) {
            assert.equal(checkpoint.visible, false);
            if (config.hidden === 'opacity') { assert.equal(checkpoint.ownOpacity, '1'); assert.equal(checkpoint.ancestorOpacity, '0'); assert.equal(checkpoint.hitOk, true); }
            if (config.hidden === 'visibility') assert.equal(checkpoint.visibility, 'hidden');
            if (config.hidden === 'display') { assert.equal(checkpoint.ancestorDisplay, 'none'); assert.equal(checkpoint.box.width, 0); }
            await page.evaluate(() => { document.getElementById('wrap').style.cssText = ''; });
          } else {
            closeTo(checkpoint.position, expected); assert.equal(checkpoint.visible, true); assert.equal(checkpoint.inViewport, true);
            assert.equal(checkpoint.hit, 'ASIDE'); assert.equal(checkpoint.hitOk, false);
            await page.evaluate(() => document.getElementById('cover').remove());
          }
          evidence = { blockedBecause: config.hidden || 'covered', checkpoint, recovery: await ready(page, operation, expected, mode) };
        } else {
          if (config.id === 12) {
            // Um único frame no destino não é estabilidade final. A barreira
            // do pedido permanece fechada, e a página volta à origem.
            await page.evaluate(expected => new Promise(resolve => {
              scrollTo({ left: expected[0], top: expected[1], behavior: 'instant' });
              requestAnimationFrame(() => { scrollTo({ left: 0, top: 0, behavior: 'instant' }); resolve(); });
            }), expected);
            await turns(page); assert.equal(operation.complete, false, 'um pulso de um frame não pode liberar clique');
          }
          if ([3, 4, 13, 14].includes(config.id)) {
            // Com scroll-margin/nearest, deixar a borda ainda parcialmente
            // fora: um novo pedido feito com a caixa já inteiramente visível
            // pode legitimamente escolher não mover no Chromium.
            const pause = config.id === 14 ? [0, 495] : [config.id === 3 ? 650 : 710, expected[1]];
            if (config.id === 14) await page.evaluate(() => {
              const element = document.getElementById('target'); element.style.top = '1100px'; element.style.width = '140px'; document.body.style.height = '2200px'; fx.changed = true;
            });
            await page.evaluate(pause => scrollTo({ left: pause[0], top: pause[1], behavior: 'instant' }), pause);
            await page.waitForFunction(pause => scrollX === pause[0] && scrollY === pause[1], { polling: 'raf', timeout: 4000 }, pause);
            if (mode) {
              await page.waitForFunction(() => fx.pendingEnds.length > 0, { polling: 'raf', timeout: 4000 });
              await page.evaluate(() => fx.releaseEnds(true));
            }
            await turns(page); checkpoint = await snapshot(page);
            if (config.id === 3) {
              assert.equal(checkpoint.inViewport, false);
              assert.ok(checkpoint.box.left < viewport.width && checkpoint.box.right > viewport.width, 'visibilidade apenas parcial deve continuar bloqueada');
            } else { assert.equal(checkpoint.hitOk, true); assert.equal(checkpoint.inViewport, true); }
            assert.ok(pause.some((value, i) => Math.abs(value - expected[i]) >= 1));
            assert.equal(operation.complete, false, 'pausa/evento intermediário com alvo livre não é destino final');
          }
          evidence = { checkpoint, ...await finish(page, operation, expected, mode) };
          if ([5, 6, 14].includes(config.id)) assert.equal(evidence.changed, true);
          if (config.id === 5) { assert.equal((await snapshot(page)).max[1], 390); assert.equal(evidence.position[1], 390); }
          if (config.id === 6) { assert.equal(evidence.box.width, 140); assert.ok(evidence.requests >= 2, 'nova geometria exige pedido nativo atualizado'); }
          if (config.axis) assert.ok(evidence.position[0] > 0, 'rolagem horizontal deve ocorrer de verdade');
          if (config.axis === 'diagonal') assert.ok(evidence.position[1] > 0);
        }
        assert.deepEqual(errors, [], 'zero erros de console/página'); passed++;
        console.log(`✅ REGRESSION ${mode ? 'ON' : 'OFF'} ${config.id}. ${config.name} ` + JSON.stringify({ ...evidence, consoleErrors: errors.length }));
      } catch (error) {
        failed++;
        console.error(`❌ REGRESSION ${mode ? 'ON' : 'OFF'} ${config.id}. ${config.name}\n` + error.stack);
        console.error('REGRESSION FAILURE STATE ' + JSON.stringify({ checkpoint, state: await snapshot(page).catch(e => ({ error: e.message })), interaction: error.interaction, consoleErrors: errors }));
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
console.log(`\nSCROLL REGRESSIONS — ${passed}/${passed + failed} cenários aprovados; 15 casos × ON/OFF.`);
if (failed) process.exitCode = 1;
