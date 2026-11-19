/* Real-page protocol barriers. A 4000ms deadline checkpoint is a test gate,
   not a sleep used to infer the end of scrolling. No browser dependency is
   installed by this test. Failed imports/launches are NOT green scenarios. */
import assert from 'node:assert/strict';
import { launchBrowser } from './helpers/browser.mjs';
import { scrollToInteractable } from './helpers/browser-interaction.mjs';
let passed = 0, failed = 0;
for (const mode of [true, false]) {
  const browser = await launchBrowser({ enforceWebSecurity: true, scrollEndEvents: mode });
  try {
    for (const heldPhase of ['prepare', 'geometry', 'polling', 'diagnostic', 'cleanup', 'dispose']) {
      const page = await browser.newPage(), errors = [], pending = [], calls = []; let held = false, gateOpen = false, result, releaseDone;
      page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      try {
        await page.setViewport({ width: 390, height: 844 });
        await page.setContent('<!doctype html><style>html{scroll-behavior:smooth}body{margin:0;height:844px}#inner{position:absolute;top:120px;width:340px;height:300px;overflow:auto;scroll-behavior:smooth;scrollbar-width:none}#extent{height:1800px}#target{position:absolute;top:1000px;left:30px;width:100px;height:34px;border:0;padding:0}</style><section id="inner"><div id="extent"></div><button id="target">Alvo</button></section>');
        assert.equal(await page.evaluate(() => 'onscrollend' in document), mode);
        await page.evaluate(() => {
          window.fx = { mutations: 0, requests: 0, clicks: 0, scrolls: [] };
          new MutationObserver(records => { fx.mutations += records.length; }).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
          const target = document.getElementById('target'), native = target.scrollIntoView.bind(target);
          target.scrollIntoView = options => { fx.requests++; return native(options); };
          target.addEventListener('click', () => { fx.clicks++; });
          document.addEventListener('scroll', () => fx.scrolls.push([scrollX, scrollY, document.getElementById('inner').scrollTop]), true);
        });
        const schedule = (phase, task) => {
          calls.push(phase);
          if (phase === heldPhase && !held) { held = true; if (gateOpen) return Promise.resolve().then(task); return new Promise((resolve, reject) => pending.push(() => { releaseDone = Promise.resolve().then(task).then(resolve, reject); return releaseDone; })); }
          return Promise.resolve().then(task);
        };
        const wrap = raw => ({
          raw,
          evaluate(fn, ...args) { const source = fn.toString(), phase = /\.sample\(/.test(source) ? 'geometry' : /\.cleanup\(/.test(source) ? 'cleanup' : 'diagnostic'; return schedule(phase, () => raw.evaluate(fn, ...args)); },
          dispose: () => schedule('dispose', () => raw.dispose())
        });
        const protocol = {
          evaluate: (...args) => page.evaluate(...args),
          evaluateHandle: (fn, ...args) => schedule('prepare', () => page.evaluateHandle(fn, ...args).then(wrap)),
          waitForFunction: (fn, options, ...args) => schedule(heldPhase === 'geometry' && !calls.includes('geometry') ? 'geometry' : 'polling', () => page.waitForFunction(fn, options, ...args.map(a => a?.raw || a)))
        };
        const started = performance.now();
        const operation = scrollToInteractable(protocol, '#target').then(() => { result = { outcome: 'ready', elapsed: performance.now() - started }; }, error => { result = { outcome: 'rejected', elapsed: performance.now() - started, name: error.name, message: error.message, diagnostic: error.interaction }; });
        const checkpoint = await new Promise(resolve => setTimeout(() => resolve(result && { ...result }), Math.max(0, started + 4000 - performance.now())));
        gateOpen = true;
        const before = await page.evaluate(() => ({ ...fx, scrolls: [...fx.scrolls] }));
        for (const release of pending.splice(0)) release();
        await operation; if (releaseDone) await releaseDone;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const after = await page.evaluate(() => ({ ...fx, scrolls: [...fx.scrolls] }));
        assert.equal(held, true, 'a fronteira específica precisa ter sido exercitada');
        assert.ok(checkpoint, 'helper inteiro deve encerrar antes do checkpoint global'); assert.equal(checkpoint.outcome, 'rejected'); assert.equal(checkpoint.name, 'TimeoutError');
        assert.match(checkpoint.message, /4000ms/); assert.ok(checkpoint.elapsed <= 4000, `integral: ${checkpoint.elapsed}ms`);
        assert.deepEqual(after, before, 'protocolo liberado depois do término não pode alterar DOM/scroll/pedidos'); assert.equal(after.clicks, 0); assert.deepEqual(errors, []);
        passed++; console.log(`✅ PROTOCOL ${mode ? 'ON' : 'OFF'} ${heldPhase} ` + JSON.stringify({ checkpoint, calls, before, after, consoleErrors: 0 }));
      } catch (error) { failed++; console.error(`❌ PROTOCOL ${mode ? 'ON' : 'OFF'} ${heldPhase}\n` + error.stack); }
      finally { for (const release of pending.splice(0)) release(); await page.close(); }
    }
  } finally { await browser.close(); }
}
console.log(`PROTOCOL — ${passed}/${passed + failed}; 6 fronteiras × Blink ON/OFF, deadline estrito.`);
if (failed) process.exitCode = 1;
