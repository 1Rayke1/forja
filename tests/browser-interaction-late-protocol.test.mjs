/* Real serialized renderer controller + protocol queue model + virtual time.
   This is stronger than a stub controller, but still NOT Chromium. */
import assert from 'node:assert/strict';
import { scrollToInteractable } from './helpers/browser-interaction.mjs';
import { createScrollDOM } from './helpers/scroll-dom-model.mjs';
const cases = [
  { id: 'clock-queued', hold: 'clock' },
  { id: 'prepare-queued', hold: 'prepare' },
  { id: 'prepare-response-retained', hold: 'prepare', response: true },
  { id: 'geometry-queued', hold: 'geometry' },
  { id: 'polling-queued', hold: 'polling' },
  { id: 'diagnostic-queued', hold: 'diagnostic' },
  { id: 'cleanup-queued', hold: 'cleanup' },
  { id: 'cleanup-response-retained', hold: 'cleanup', response: true },
  { id: 'dispose-queued', hold: 'dispose' },
  { id: 'retargets-share-original-deadline', retargets: true },
  { id: 'geometry-changes-between-poll-and-cleanup', finalChange: true },
  { id: 'stale-poll-after-confirmed-close', stale: true }
];
let passed = 0, failed = 0;
for (const nativeEnd of [true, false]) for (const config of cases) {
  const fx = createScrollDOM({ nativeEnd, containers: [{ id: 'inner', top: 120, width: 340, height: 300, scrollHeight: 1800, style: { overflowY: 'auto' } }], target: { parent: 'inner', left: 30, top: 1000 } });
  const { clock } = fx, calls = [], pending = [], polls = []; let used = false, result, effectsAtSettlement, continuations = 0, changed = false;
  const schedule = (phase, task) => {
    calls.push({ phase, at: clock.now });
    if (config.finalChange && ['diagnostic', 'cleanup'].includes(phase) && !changed) { fx.nodes.get('inner').spec.top += 20; changed = true; }
    if (config.hold === phase && !used) {
      used = true;
      if (config.response) {
        const started = Promise.resolve().then(task); void started.catch(() => {});
        return new Promise((resolve, reject) => pending.push(() => started.then(resolve, reject)));
      }
      return new Promise((resolve, reject) => pending.push(() => Promise.resolve().then(task).then(resolve, reject)));
    }
    return Promise.resolve().then(task);
  };
  const wrap = raw => ({ value: raw.value,
    evaluate(fn, ...args) { const text = fn.toString(), phase = /\.sample\(/.test(text) ? 'geometry' : /\.cleanup\(/.test(text) ? 'cleanup' : 'diagnostic'; return schedule(phase, () => raw.evaluate(fn, ...args)); },
    dispose: () => schedule('dispose', () => raw.dispose())
  });
  const page = {
    evaluate: (fn, ...args) => schedule('clock', () => fx.page.evaluate(fn, ...args)),
    evaluateHandle: (fn, ...args) => schedule('prepare', () => fx.page.evaluateHandle(fn, ...args).then(wrap)),
    waitForFunction(fn, options, ...args) {
      polls.push({ fn, options, args });
      // The entry version has no separate geometry call. Retain its first
      // polling call for the same pending-geometry boundary, not a mutation.
      const phase = config.hold === 'geometry' && !calls.some(c => c.phase === 'geometry') ? 'geometry' : 'polling';
      return schedule(phase, () => fx.page.waitForFunction(fn, options, ...args));
    }
  };
  const original = { performance: globalThis.performance, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  globalThis.performance = { now: () => clock.now, timeOrigin: 0 }; globalThis.setTimeout = clock.set; globalThis.clearTimeout = clock.clear;
  const operation = scrollToInteractable(page, '#target').then(() => { effectsAtSettlement = [...fx.effects]; continuations++; result = { outcome: 'ready', at: clock.now }; }, error => { effectsAtSettlement = [...fx.effects]; result = { outcome: 'rejected', name: error.name, message: error.message, diagnostic: error.interaction, at: clock.now }; });
  try {
    await clock.to(96);
    if (!config.retargets) fx.move('inner', 0, 867);
    else {
      await clock.to(2000); fx.nodes.get('inner').spec.top = 160;
      await clock.to(2080); assert.ok(fx.requests.length >= 2, 'primeiro retarget');
      await clock.to(3900); fx.nodes.get('inner').spec.height = 280;
    }
    if (config.finalChange) {
      await clock.to(512); assert.equal(result?.name, 'InteractionRefusedError'); assert.equal(continuations, 0);
      assert.equal(result.diagnostic.reason, 'changed-before-cleanup');
    } else if (config.stale) {
      await clock.to(512); assert.equal(result?.outcome, 'ready');
      const before = fx.snapshot(); fx.nodes.get('target').spec.top += 200;
      for (const p of polls) {
        let staleDone = false;
        void fx.page.waitForFunction(p.fn, p.options, ...p.args).then(async handle => { await handle.dispose(); staleDone = true; }, () => { staleDone = true; });
        await clock.to(clock.now + 32); assert.equal(staleDone, true);
      }
      assert.deepEqual(fx.effects, before.effects, 'sample de controller já fechado não retargeta');
    } else {
      await clock.to(4000); assert.equal(result?.outcome, 'rejected', 'protocolo pendente não pode prender nem liberar a continuação');
      assert.equal(result.name, 'TimeoutError'); assert.ok(result.at <= 4000); assert.equal(continuations, 0);
      const before = fx.snapshot(); for (const release of pending.splice(0)) release();
      // Run all queued protocol callbacks and timers long after settlement.
      await clock.to(6000); assert.deepEqual(fx.effects, before.effects, 'callback tardio não pode instalar referência, retargetar nem limpar DOM depois do encerramento');
      assert.equal(continuations, 0);
      assert.deepEqual(fx.effects, effectsAtSettlement, 'ordem de efeitos após settlement, inclusive timestamps iguais');
    }
    if (config.hold) assert.equal(used, true, 'a fronteira de protocolo especificada precisa ter sido exercitada');
    assert.equal(fx.snapshot().references, 0); assert.equal(fx.countListeners(), 0);
    passed++; console.log(`✅ LATE MODEL ${nativeEnd ? 'ON' : 'OFF'} ${config.id} ` + JSON.stringify({ result, continuations, calls, state: fx.snapshot() }));
  } catch (error) {
    failed++; console.error(`❌ LATE MODEL ${nativeEnd ? 'ON' : 'OFF'} ${config.id}\n` + error.stack);
    console.error('LATE MODEL FAILURE ' + JSON.stringify({ result, continuations, calls, state: fx.snapshot() }));
  } finally {
    for (const release of pending.splice(0)) release(); await clock.to(8000); void operation.catch(() => {});
    globalThis.performance = original.performance; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout;
  }
}
console.log(`LATE MODEL — ${passed}/${passed + failed}; controlador real, DOM/eventos/protocolo/tempo modelados, NÃO Chromium.`);
if (failed) process.exitCode = 1;
