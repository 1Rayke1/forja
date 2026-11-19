/* Chromium contract: native CSSOM control in a separate page, real Blink
   ON/OFF, native event barriers and page.click trusted input. No sleeps.
   Do not confuse authoring this matrix with having executed it successfully. */
import assert from 'node:assert/strict';
import { launchBrowser } from './helpers/browser.mjs';
import { scrollToInteractable } from './helpers/browser-interaction.mjs';
const viewport = { width: 390, height: 844 };
const cases = [
  { id: 'inner-Y', kind: 'single' },
  { id: 'two-nested', kind: 'nested' },
  { id: 'outer-Y-inner-X', kind: 'cross' },
  { id: 'diagonal-distinct-containers', kind: 'diagonal', partial: true },
  { id: 'inner-outer-padding-and-margin', kind: 'padding' },
  { id: 'intermediate-visible-pause', kind: 'single', pause: true },
  { id: 'dynamic-ancestor-geometry', kind: 'nested', dynamic: true },
  { id: 'reparent-between-scrollers', kind: 'reparent', reparent: true },
  { id: 'every-native-scrollend', kind: 'nested', separateEnds: true },
  { id: 'geometry-does-not-waive-held-ends', kind: 'nested', heldEndsDuringGeometry: true },
  { id: 'unsupported-transform', kind: 'single', unsupported: 'transform' },
  { id: 'unsupported-snap', kind: 'single', unsupported: 'scroll-snap' },
  { id: 'nested-timeout-no-click', kind: 'nested', timeout: true }
];
const turns = page => page.evaluate(() => new Promise(resolve => {
  let frames = 0; const tick = () => { if (++frames === 6) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick);
}));
function html(config) {
  const cross = ['cross', 'diagonal'].includes(config.kind), single = config.kind === 'single', reparent = config.kind === 'reparent';
  const inner = `<section class="scroller" id="inner" style="left:0;top:${single ? 120 : cross && config.kind === 'diagonal' ? 900 : 800}px;width:${cross ? 300 : 330}px;height:${config.kind === 'cross' ? 200 : 300}px;overflow-x:${cross ? 'auto' : 'hidden'};overflow-y:${cross ? 'hidden' : 'auto'}"><div class="extent" style="width:${cross ? 1800 : 330}px;height:${cross ? config.kind === 'cross' ? 200 : 300 : 1800}px"></div><button id="target" style="left:${cross ? config.kind === 'cross' ? 1000 : 1100 : 30}px;top:${cross ? config.kind === 'cross' ? 83 : 133 : 1000}px">Alvo</button></section>`;
  const body = reparent ? '<section id="first" class="scroller" style="left:0;top:0;width:340px;height:300px"><div class="extent" style="width:340px;height:1800px"></div><button id="target" style="left:30px;top:1000px">Alvo</button></section><section id="second" class="scroller" style="left:0;top:360px;width:340px;height:300px"><div class="extent" style="width:340px;height:2000px"></div></section>' : single ? inner : `<main class="scroller" id="outer" style="left:0;top:0;width:360px;height:500px"><div class="extent" style="width:360px;height:2000px"></div>${inner}</main>`;
  return `<!doctype html><style>html{scroll-behavior:smooth;scrollbar-width:none}body{margin:0;width:390px;height:844px;overflow-anchor:none}.scroller{position:absolute;box-sizing:border-box;border:0;padding:0;margin:0;overflow-y:auto;overflow-x:hidden;scroll-behavior:smooth;scrollbar-width:none;overflow-anchor:none}.extent{position:absolute;left:0;top:0}button{position:absolute;box-sizing:border-box;width:100px;height:34px;padding:0;margin:0;border:0}${config.kind === 'padding' ? '#outer{scroll-padding-top:40px;scroll-padding-bottom:20px;scroll-margin-top:18px;scroll-margin-bottom:6px}#inner{scroll-padding-top:30px;scroll-padding-bottom:10px;scroll-margin-top:12px;scroll-margin-bottom:4px}#target{scroll-margin-top:24px;scroll-margin-bottom:8px}' : ''}${config.unsupported === 'transform' ? '#target{transform:translateX(2px)}' : config.unsupported ? '#inner{scroll-snap-type:y mandatory}#target{scroll-snap-align:center}' : ''}</style>${body}`;
}
function change(config) {
  if (config.heldEndsDuringGeometry) document.getElementById('outer').style.width = '350px';
  if (config.dynamic) { document.getElementById('outer').style.height = '400px'; document.getElementById('inner').style.top = '950px'; }
  if (config.reparent) { document.getElementById('first').scrollTo({ top: 400, behavior: 'instant' }); document.getElementById('second').appendChild(document.getElementById('target')); }
}
function positions() {
  return Object.fromEntries([['root', document.scrollingElement], ...[...document.querySelectorAll('.scroller')].map(n => [n.id, n])].map(([id, node]) => [id, [node.scrollLeft, node.scrollTop]]));
}
async function control(browser, config) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.setViewport(viewport); await page.setContent(html(config)); await page.evaluate(change, config);
    await page.$eval('#target', node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    const expected = await page.evaluate(positions); assert.deepEqual(errors, []); return expected;
  } finally { await page.close(); }
}
async function fixture(browser, mode, config) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push('pageerror: ' + error.message)); page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.setViewport(viewport); await page.setContent(html(config));
  await page.evaluate(() => {
    const target = document.getElementById('target'), native = target.scrollIntoView.bind(target), tracked = new Map();
    const nodes = [['root', document.scrollingElement, document], ...[...document.querySelectorAll('.scroller')].map(n => [n.id, n, n])];
    window.fx = { requested: 0, holdRequest: true, pending: null, ends: [], scrolls: [], clicks: [], active: tracked,
      holdEnds: new Set(nodes.map(([id]) => id)), pendingEnds: [], registeredEnds: [], capability: nodes.map(([id, , e]) => [id, 'onscrollend' in e]) };
    for (const [id, node, eventNode] of nodes) {
      const owns = event => event.target === node || id === 'root' && event.target === document;
      eventNode.addEventListener('scroll', event => { if (owns(event)) fx.scrolls.push({ id, position: [node.scrollLeft, node.scrollTop], trusted: event.isTrusted }); }, true);
      eventNode.addEventListener('scrollend', event => { if (owns(event)) fx.ends.push({ id, position: [node.scrollLeft, node.scrollTop], trusted: event.isTrusted }); }, true);
      const add = eventNode.addEventListener.bind(eventNode), remove = eventNode.removeEventListener.bind(eventNode);
      eventNode.addEventListener = (type, listener, options) => {
        if (!['scroll', 'scrollend'].includes(type)) return add(type, listener, options);
        const wrapped = event => {
          if (type !== 'scrollend' || !owns(event) || !fx.holdEnds.has(id)) return listener(event);
          fx.pendingEnds.push({ id, deliver: () => listener(event) });
        };
        tracked.set(listener, { id, type, wrapped }); if (type === 'scrollend') fx.registeredEnds.push(id);
        return add(type, wrapped, options);
      };
      eventNode.removeEventListener = (type, listener, options) => { const old = tracked.get(listener); tracked.delete(listener); return remove(type, old?.wrapped || listener, options); };
    }
    target.scrollIntoView = options => { fx.requested++; const run = () => native(options); if (fx.holdRequest) fx.pending = run; else run(); };
    fx.releaseRequest = () => { fx.holdRequest = false; const run = fx.pending; fx.pending = null; if (run) run(); };
    fx.releaseEnds = id => {
      if (id) fx.holdEnds.delete(id); else fx.holdEnds.clear();
      const deliver = fx.pendingEnds.filter(e => !id || e.id === id); fx.pendingEnds = fx.pendingEnds.filter(e => id && e.id !== id); deliver.forEach(e => e.deliver());
    };
    target.addEventListener('click', event => fx.clicks.push({ trusted: event.isTrusted }));
  });
  assert.ok((await page.evaluate(() => fx.capability)).every(([, supported]) => supported === mode), 'ON/OFF precisa alterar cada capacidade Blink real');
  return { page, errors };
}
const closeTo = (actual, expected) => { for (const [id, p] of Object.entries(expected)) assert.ok(actual[id]?.every((v, i) => Math.abs(v - p[i]) < 1), `${id}: ${actual[id]} vs ${p}`); };
const state = async page => ({ position: await page.evaluate(positions), ...await page.evaluate(() => {
  const target = document.getElementById('target'), b = target.getBoundingClientRect(), top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return { box: b.toJSON(), hit: top === target || target.contains(top), clicks: fx.clicks, ends: fx.ends, pendingEnds: fx.pendingEnds.map(e => e.id), requested: fx.requested, registeredEnds: fx.registeredEnds, active: fx.active.size, references: document.querySelectorAll('iframe[data-forja-scroll-reference],iframe[aria-hidden="true"]').length };
}) });
function start(page) {
  const operation = { complete: false, started: performance.now() };
  operation.waiting = scrollToInteractable(page, '#target').then(() => { operation.complete = true; operation.elapsed = performance.now() - operation.started; }, error => { operation.elapsed = performance.now() - operation.started; throw error; });
  void operation.waiting.catch(() => {}); return operation;
}
let passed = 0, failed = 0;
for (const mode of [true, false]) {
  const browser = await launchBrowser({ enforceWebSecurity: true, scrollEndEvents: mode });
  try {
    console.log(`NESTED CONFIG ${mode ? 'ON' : 'OFF'} ${await browser.version()}; web security preserved`);
    for (const config of cases) {
      const expected = config.unsupported || config.timeout ? null : await control(browser, config), { page, errors } = await fixture(browser, mode, config);
      try {
        const operation = start(page);
        if (config.unsupported) {
          await assert.rejects(operation.waiting, error => error.name === 'UnsupportedScrollError' && !!error.interaction?.unsupported && error.message.includes(config.unsupported));
          assert.equal(operation.complete, false); assert.equal((await state(page)).clicks.length, 0);
        } else {
          await page.waitForFunction(() => fx.requested > 0, { polling: 'raf', timeout: 4000 }); await turns(page); assert.equal(operation.complete, false);
          if (config.timeout) {
            await assert.rejects(operation.waiting, { name: 'TimeoutError', message: /4000ms/ });
            assert.ok(operation.elapsed <= 4000, `deadline integral: ${operation.elapsed}ms`); assert.equal(operation.complete, false);
            assert.equal((await state(page)).clicks.length, 0); await turns(page); assert.equal(operation.complete, false);
          } else {
            if (config.pause) {
              await page.$eval('#inner', node => node.scrollTo({ top: 750, behavior: 'instant' }));
              if (mode) {
                await page.waitForFunction(() => fx.pendingEnds.some(e => e.id === 'inner'), { polling: 'raf', timeout: 4000 });
                await page.evaluate(() => { const held = fx.pendingEnds.splice(0); held.forEach(e => e.deliver()); });
              }
              await turns(page); assert.equal((await state(page)).hit, true); assert.equal(operation.complete, false, 'pausa visível, inclusive OFF, não é destino');
            }
            if (config.partial) {
              await page.evaluate(expected => { document.getElementById('outer').scrollTo({ top: expected.outer[1], behavior: 'instant' }); document.getElementById('inner').scrollTo({ left: expected.inner[0] / 2, behavior: 'instant' }); }, expected);
              await turns(page); assert.equal(operation.complete, false, 'Y pronto não substitui X pendente');
            }
            if (config.dynamic || config.reparent || config.heldEndsDuringGeometry && !mode) {
              const before = (await state(page)).requested; await page.evaluate(change, config);
              await page.waitForFunction(before => fx.requested > before, { polling: 'raf', timeout: 4000 }, before); assert.equal(operation.complete, false);
            }
            await page.evaluate(() => fx.releaseRequest());
            await page.waitForFunction(expected => Object.entries(expected).every(([id, p]) => {
              const n = id === 'root' ? document.scrollingElement : document.getElementById(id); return Math.abs(n.scrollLeft - p[0]) < 1 && Math.abs(n.scrollTop - p[1]) < 1;
            }), { polling: 'raf', timeout: 4000 }, expected);
            if (mode) {
              const moved = Object.entries(expected).filter(([, p]) => p.some(v => v > 0)).map(([id]) => id).filter(id => id !== 'first');
              await page.waitForFunction(ids => ids.every(id => fx.pendingEnds.some(e => e.id === id)), { polling: 'raf', timeout: 4000 }, moved);
              await turns(page); assert.equal(operation.complete, false);
              if (config.heldEndsDuringGeometry) {
                const before = (await state(page)).requested; await page.evaluate(change, config);
                await page.waitForFunction(before => fx.requested > before, { polling: 'raf', timeout: 4000 }, before);
                await turns(page); assert.equal(operation.complete, false, 'retarget sem deslocamento não dispensa fins retidos');
              }
              if (config.separateEnds) { await page.evaluate(() => fx.releaseEnds('outer')); await turns(page); assert.equal(operation.complete, false, 'fim externo não substitui fim interno'); }
              await page.evaluate(() => fx.releaseEnds());
            }
            await operation.waiting;
            const settled = await state(page); closeTo(settled.position, expected); assert.equal(settled.hit, true); assert.ok(operation.elapsed <= 4000);
            assert.equal(settled.active, 0); assert.equal(settled.references, 0);
            if (mode) assert.ok(settled.ends.length > 0 && settled.ends.every(e => e.trusted)); else assert.equal(settled.registeredEnds.length, 0);
            await turns(page); const later = await state(page); assert.deepEqual(later.position, settled.position); assert.deepEqual(later.box, settled.box);
            await page.click('#target'); assert.equal((await state(page)).clicks.at(-1)?.trusted, true);
          }
        }
        const final = await state(page); assert.equal(final.active, 0); assert.equal(final.references, 0); assert.deepEqual(errors, []);
        passed++; console.log(`✅ NESTED ${mode ? 'ON' : 'OFF'} ${config.id} ` + JSON.stringify({ expected, final, consoleErrors: 0 }));
      } catch (error) { failed++; console.error(`❌ NESTED ${mode ? 'ON' : 'OFF'} ${config.id}\n` + error.stack); console.error('NESTED FAILURE ' + JSON.stringify({ interaction: error.interaction, state: await state(page).catch(e => ({ error: e.message })), errors })); }
      finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
console.log(`NESTED — ${passed}/${passed + failed}; 13 casos × Blink ON/OFF.`);
if (failed) process.exitCode = 1;
