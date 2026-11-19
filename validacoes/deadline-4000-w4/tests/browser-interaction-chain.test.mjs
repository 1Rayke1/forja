/* Executes the real helper against a deterministic DOM/CSSOM model.
   ON/OFF here is modeled capability, NOT Blink flags or trusted real events. */
import assert from 'node:assert/strict';
import { scrollToInteractable } from './helpers/browser-interaction.mjs';
import { createScrollDOM } from './helpers/scroll-dom-model.mjs';
const vertical = { id: 'inner', left: 0, top: 120, width: 340, height: 300, scrollHeight: 1800, style: { overflowY: 'auto' } };
const outer = { id: 'outer', width: 360, height: 500, scrollHeight: 2000, style: { overflowY: 'auto' } };
const inner = { ...vertical, parent: 'outer', top: 800, width: 330 };
const target = { parent: 'inner', left: 30, top: 1000 };
const cases = [
  { id: 'vertical-interno', containers: [vertical], target, destination: { inner: [0, 867] } },
  { id: 'dois-aninhados', containers: [outer, inner], target, destination: { outer: [0, 700], inner: [0, 867] } },
  { id: 'externo-Y-interno-X', containers: [outer, { ...inner, width: 300, height: 200, scrollWidth: 1600, scrollHeight: 200, style: { overflowX: 'auto' } }], target: { ...target, left: 1000, top: 83 }, destination: { outer: [0, 650], inner: [800, 0] } },
  { id: 'diagonal-containers-distintos', containers: [outer, { ...inner, top: 900, width: 300, scrollWidth: 1800, scrollHeight: 300, style: { overflowX: 'auto' } }], target: { ...target, left: 1100, top: 133 }, destination: { outer: [0, 800], inner: [900, 0] } },
  { id: 'padding-margin-interno-externo', containers: [{ ...outer, style: { overflowY: 'auto', scrollPaddingTop: '40px', scrollPaddingBottom: '20px', scrollMarginTop: '18px', scrollMarginBottom: '6px' } }, { ...inner, style: { overflowY: 'auto', scrollPaddingTop: '30px', scrollPaddingBottom: '10px', scrollMarginTop: '12px', scrollMarginBottom: '4px' } }], target, targetStyle: { scrollMarginTop: '24px', scrollMarginBottom: '8px' }, destination: { outer: [0, 700], inner: [0, 849] } },
  { id: 'pausa-intermediaria', containers: [vertical], target, pause: true, destination: { inner: [0, 867] } },
  { id: 'geometria-ancestral-dinamica', containers: [outer, inner], target, dynamic: true, destination: { outer: [0, 900], inner: [0, 867] } },
  { id: 'alvo-muda-de-scroller', containers: [{ ...vertical, id: 'first', top: 0 }, { ...vertical, id: 'second', top: 360, scrollHeight: 2000 }], target: { ...target, parent: 'first' }, reparent: true, destination: { first: [0, 400], second: [0, 867] } },
  { id: 'unsupported-transform', containers: [vertical], target, targetStyle: { transform: 'translateX(2px)' }, unsupported: /transform/ },
  { id: 'unsupported-scroll-snap', containers: [{ ...vertical, style: { overflowY: 'auto', scrollSnapType: 'y mandatory' } }], target, unsupported: /scroll-snap/ },
  { id: 'timeout-aninhado-sem-clique', containers: [outer, inner], target, timeout: true },
  { id: 'fim-de-cada-container', containers: [outer, inner], target, separateEnds: true, destination: { outer: [0, 700], inner: [0, 867] } },
  { id: 'geometria-nao-dispensa-fins-retidos', containers: [outer, inner], target, heldEndsDuringGeometry: true, destination: { outer: [0, 700], inner: [0, 867] } }
];
let passed = 0, failed = 0;
for (const nativeEnd of [true, false]) for (const config of cases) {
  const fx = createScrollDOM({ nativeEnd, ...config }), { clock } = fx;
  const original = { performance: globalThis.performance, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  globalThis.performance = { now: () => clock.now, timeOrigin: 0 }; globalThis.setTimeout = clock.set; globalThis.clearTimeout = clock.clear;
  let result, continuationCount = 0;
  const operation = scrollToInteractable(fx.page, '#target').then(() => { continuationCount++; result = { outcome: 'ready', at: clock.now }; }, error => { result = { outcome: 'rejected', at: clock.now, name: error.name, message: error.message, diagnostic: error.interaction }; });
  try {
    await clock.to(96);
    if (config.unsupported) {
      await clock.to(4000); assert.equal(result?.outcome, 'rejected'); assert.equal(result?.name, 'UnsupportedScrollError');
      assert.match(result.message, config.unsupported); assert.ok(result.diagnostic?.unsupported); assert.equal(continuationCount, 0);
    } else if (config.timeout) {
      assert.equal(result, undefined); await clock.to(4000);
      assert.equal(result?.name, 'TimeoutError'); assert.ok(result.at <= 4000); assert.equal(continuationCount, 0);
      const count = fx.requests.length; await clock.to(6000); assert.equal(fx.requests.length, count, 'nenhum retarget após timeout');
    } else {
      assert.ok(fx.requests.length > 0, 'pedido nativo precisa existir'); assert.equal(result, undefined, 'início retido não libera interação');
      if (config.pause) {
        fx.move('inner', 0, 750); await clock.to(256);
        assert.equal(result, undefined, 'pausa visível + evento intermediário não é destino');
      }
      if (config.dynamic) {
        fx.nodes.get('outer').spec.height = 400; fx.nodes.get('inner').spec.top = 950;
        await clock.to(192); assert.equal(result, undefined); assert.ok(fx.requests.length >= 2, 'geometria ancestral deve gerar novo pedido');
      }
      if (config.reparent) {
        fx.move('first', 0, 400); fx.nodes.get('second').appendChild(fx.nodes.get('target'));
        await clock.to(192); assert.equal(result, undefined); assert.ok(fx.requests.some(r => r.parent === 'second'));
        assert.equal(fx.nodes.get('first').listeners.get('scrollend')?.size || 0, 0, 'cadeia antiga não fica observada');
      }
      for (const [id, [x, y]] of Object.entries(config.destination)) fx.move(id, x, y, !(nativeEnd && (config.heldEndsDuringGeometry || config.separateEnds && id === 'inner')));
      if (config.heldEndsDuringGeometry) {
        fx.nodes.get('outer').spec.width = 350;
        await clock.to(320);
        if (nativeEnd) { assert.equal(result, undefined, 'retarget sem deslocamento não dispensa fins nativos pendentes'); fx.end('outer'); fx.end('inner'); }
      }
      if (config.separateEnds && nativeEnd) {
        await clock.to(320); assert.equal(result, undefined, 'evento do externo não substitui fim do interno'); fx.end('inner');
      }
      await clock.to(512);
      assert.equal(result?.outcome, 'ready', JSON.stringify({ result, state: fx.snapshot() }));
      const snapshot = fx.snapshot(); assert.equal(snapshot.references, 0); assert.equal(snapshot.listeners, 0);
      const previous = Object.fromEntries(Object.entries(snapshot.positions)); await clock.to(768); assert.deepEqual(fx.snapshot().positions, previous);
      assert.equal(continuationCount, 1);
    }
    assert.equal(fx.snapshot().references, 0); assert.equal(fx.countListeners(), 0);
    passed++; console.log(`✅ CHAIN MODEL ${nativeEnd ? 'ON' : 'OFF'} ${config.id} ` + JSON.stringify({ result, continuationCount, state: fx.snapshot() }));
  } catch (error) {
    failed++; console.error(`❌ CHAIN MODEL ${nativeEnd ? 'ON' : 'OFF'} ${config.id}\n` + error.stack);
    console.error('CHAIN MODEL FAILURE ' + JSON.stringify({ result, state: fx.snapshot() }));
  } finally {
    await clock.to(6500); void operation.catch(() => {});
    globalThis.performance = original.performance; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout;
  }
}
console.log(`CHAIN MODEL — ${passed}/${passed + failed}; DOM/CSSOM/eventos modelados, nenhum clique, NÃO Chromium.`);
if (failed) process.exitCode = 1;
