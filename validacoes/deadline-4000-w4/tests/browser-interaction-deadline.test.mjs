/* Contract tests with virtual monotonic time and retained protocol promises.
   No dependencies, browser, sleeps or real input. These are NOT Chromium E2E. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { scrollToInteractable } from './helpers/browser-interaction.mjs';
class Clock {
  now = 0; next = 1; timers = new Map();
  set = (fn, delay = 0) => { const id = this.next++; this.timers.set(id, { at: this.now + Math.max(0, delay), fn }); return id; };
  clear = id => this.timers.delete(id);
  async flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
  async to(time) {
    await this.flush();
    for (;;) {
      const pending = [...this.timers].filter(([, t]) => t.at <= time).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!pending.length) break;
      const [id, timer] = pending[0]; this.timers.delete(id); this.now = timer.at; timer.fn(); await this.flush();
    }
    this.now = time; await this.flush();
  }
}
function environment(clock, config) {
  const calls = [], mutations = [], holds = [], clicks = [];
  const effect = kind => mutations.push({ kind, at: clock.now });
  const state = {
    diagnostic: { reason: 'destination', scrollers: [{ id: 'inner', position: [0, 0], destination: [0, 867] }] },
    sample() { effect('sample-may-retarget'); return false; },
    inspect() { return { outcome: 'ready', ready: true, diagnostic: { reason: 'ready' }, cleanupConfirmed: false }; },
    cleanup() { effect('cleanup'); return { cleanupConfirmed: true, ready: true }; },
    close() { return this.cleanup(); }
  };
  const styles = { visibility: 'visible', pointerEvents: 'auto', opacity: '1', writingMode: 'horizontal-tb', direction: 'ltr', overflowX: 'visible', overflowY: 'visible', scrollbarWidth: 'auto', scrollbarGutter: 'auto' };
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) { styles['scrollMargin' + side] = '0px'; styles['scrollPadding' + side] = '0px'; }
  const root = { scrollLeft: 0, scrollTop: 0, scrollWidth: 390, scrollHeight: 844, clientWidth: 390, clientHeight: 844, appendChild() { effect('append-reference'); } };
  const element = { getBoundingClientRect: () => ({ left: 0, top: 405, width: 100, height: 34 }), scrollIntoView() { effect('native-scroll-request'); } };
  const style = () => ({ setProperty() {} });
  const viewport = { scrollLeft: 0, scrollTop: 0, style: style() }, extent = { style: style() }, target = { style: style(), scrollIntoView() {} };
  const reference = { style: style(), setAttribute() {}, remove() { effect('remove-reference'); }, contentDocument: { open() {}, write() {}, close() {}, documentElement: viewport, body: { style: style(), children: [extent, target] } }, contentWindow: { scrollTo() {} } };
  const document = { scrollingElement: root, documentElement: root, querySelector: () => element, createElement: () => reference, addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({ performance: { now: () => clock.now, timeOrigin: 0 }, document, getComputedStyle: () => styles, innerWidth: 390, innerHeight: 844, setTimeout: clock.set, clearTimeout: clock.clear });
  const execute = (fn, args) => { context.args = args; return vm.runInContext('(' + fn.toString() + ')(...args)', context); };
  const run = (phase, action, lateAction = action) => {
    calls.push({ phase, at: clock.now });
    if (config.hold === phase || config.hold === 'geometry' && phase === 'polling' && !calls.some(c => c.phase === 'geometry')) {
      return new Promise((resolve, reject) => holds.push(() => { Promise.resolve().then(lateAction).then(resolve, reject); }));
    }
    const delay = config.cumulative && ['prepare', 'polling'].includes(phase) ? 2300 : 0;
    if (delay) return new Promise((resolve, reject) => clock.set(() => { Promise.resolve().then(action).then(resolve, reject); }, delay));
    return Promise.resolve().then(action);
  };
  const handle = {
    evaluate(fn, ...args) {
      const text = fn.toString();
      const phase = /\.sample\(/.test(text) ? 'geometry' : /\.cleanup\(|\.close\(/.test(text) ? 'cleanup' : 'diagnostic';
      return run(phase, () => execute(fn, [state, ...args]));
    },
    dispose() { return run('dispose', () => undefined); }
  };
  const page = {
    evaluate(fn, ...args) { return run('clock', () => ({ now: clock.now, timeOrigin: 0 })); },
    evaluateHandle(fn, ...args) { return run('prepare', () => handle, () => { if (config.executeLatePrepare) execute(fn, args); return handle; }); },
    waitForFunction(fn, options, ...args) {
      return run('polling', () => {
        if (config.diagnosticFailure) { const error = new Error('Waiting failed: 4000ms exceeded'); error.name = 'TimeoutError'; throw error; }
        return { dispose: () => Promise.resolve() };
      }, () => { if (config.executeLatePolling) execute(fn, args.map(a => a === handle ? state : a)); return { dispose: () => Promise.resolve() }; });
    },
    click() { clicks.push(clock.now); }
  };
  return { page, calls, mutations, clicks, release() { for (const fn of holds.splice(0)) fn(); } };
}
const cases = [
  { name: 'preparação CSSOM pendente', hold: 'prepare' },
  { name: 'consulta de geometria pendente', hold: 'geometry' },
  { name: 'polling pendente', hold: 'polling' },
  { name: 'diagnóstico pendente', hold: 'diagnostic', diagnosticFailure: true },
  { name: 'cleanup pendente', hold: 'cleanup' },
  { name: 'descarte pendente', hold: 'dispose' },
  { name: 'operações cumulativas excedem 4000ms', cumulative: true },
  { name: 'timeout com cadeia aninhada pendente', hold: 'polling', nested: true },
  { name: 'preparação tardia não injeta referência nem rola', hold: 'prepare', executeLatePrepare: true },
  { name: 'geometria tardia não retargeta', hold: 'geometry' },
  { name: 'polling tardio não retargeta', hold: 'polling', executeLatePolling: true },
  { name: 'cleanup tardio não modifica a aplicação', hold: 'cleanup' },
  { name: 'nenhum clique após timeout e liberação tardia', hold: 'polling' }
];
let passed = 0, failed = 0;
for (const config of cases) {
  const original = { performance: globalThis.performance, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const clock = new Clock(), fx = environment(clock, config); let result;
  globalThis.performance = { now: () => clock.now, timeOrigin: 0 }; globalThis.setTimeout = clock.set; globalThis.clearTimeout = clock.clear;
  const operation = scrollToInteractable(fx.page, '#target').then(() => { result = { outcome: 'resolved', at: clock.now }; fx.page.click(); }, error => { result = { outcome: 'rejected', at: clock.now, name: error.name, message: error.message, diagnostic: error.interaction }; });
  try {
    await clock.to(4000); const atDeadline = result && { ...result };
    fx.release(); await clock.to(10000); await clock.flush();
    assert.ok(atDeadline, 'a Promise inteira deve encerrar até o deadline, não só o polling');
    assert.equal(atDeadline.outcome, 'rejected'); assert.equal(atDeadline.name, 'TimeoutError'); assert.match(atDeadline.message, /4000ms/);
    assert.ok(atDeadline.at <= 4000); assert.equal(fx.clicks.length, 0, 'continuação tardia não pode liberar clique');
    assert.deepEqual(fx.mutations.filter(m => m.at >= 4000), [], 'nenhum callback de protocolo tardio pode modificar a aplicação');
    assert.equal(result.at, atDeadline.at, 'resultado não pode mudar quando o protocolo finalmente responde');
    passed++; console.log('✅ DEADLINE ' + config.name + ' ' + JSON.stringify({ atDeadline, calls: fx.calls, lateMutations: [], clicks: fx.clicks }));
  } catch (error) {
    failed++; console.error('❌ DEADLINE ' + config.name + '\n' + error.stack);
    console.error('DEADLINE FAILURE ' + JSON.stringify({ result, calls: fx.calls, mutations: fx.mutations, clicks: fx.clicks }));
  } finally {
    fx.release(); await clock.to(20000); void operation.catch(() => {});
    globalThis.performance = original.performance; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout;
  }
}
console.log(`DEADLINE CONTRACT — ${passed}/${passed + failed}; relógio virtual/protocolo modelado, NÃO Chromium.`);
if (failed) process.exitCode = 1;
