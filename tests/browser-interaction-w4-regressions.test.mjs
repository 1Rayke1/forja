/* W4 modeled protocol/controller regression matrix (20 cases).
   NOT Chromium: uses deterministic VirtualClock + VM/scroll-dom-model.
   Every case carries an explicit RED->GREEN classification per Phase 4:
   - discriminante (16 cases: 01-12, 14, 16, 17, 20)
   - regressao_comportamento_ja_correto (4 cases: 13, 15, 18, 19) */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { scrollToInteractable } from './helpers/browser-interaction.mjs';
import { createScrollDOM } from './helpers/scroll-dom-model.mjs';

class Clock {
  now = 0;
  next = 1;
  timers = new Map();
  set = (fn, delay = 0) => {
    const id = this.next++;
    this.timers.set(id, { at: this.now + Math.max(0, delay), fn });
    return id;
  };
  clear = id => this.timers.delete(id);
  async flush() {
    for (let i = 0; i < 80; i++) await Promise.resolve();
  }
  async to(time) {
    await this.flush();
    for (;;) {
      const pending = [...this.timers]
        .filter(([, t]) => t.at <= time)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!pending.length) break;
      const [id, timer] = pending[0];
      this.timers.delete(id);
      this.now = timer.at;
      timer.fn();
      await this.flush();
    }
    this.now = time;
    await this.flush();
  }
}

function makeHarness(clock, opts = {}) {
  const calls = [];
  const mutations = [];
  const clicks = [];
  const holds = new Map();
  let controllerDisposes = 0;
  let pollingDisposes = 0;
  let cleanupCalls = 0;
  let diagnosticCalls = 0;

  const state = {
    sample() {
      mutations.push({ kind: 'sample', at: clock.now });
      return opts.readyImmediately === true;
    },
    inspect() {
      return opts.inspectResult ?? { outcome: 'ready', diagnostic: { reason: 'ready' }, cleanupConfirmed: false };
    },
    cleanup(verify) {
      mutations.push({ kind: 'cleanup', at: clock.now, verify });
      return opts.cleanupResult ?? { cleanupConfirmed: true, ready: true };
    }
  };

  const context = vm.createContext({
    performance: { now: () => clock.now, timeOrigin: 0 },
    setTimeout: clock.set,
    clearTimeout: clock.clear
  });
  const execute = (fn, args) => {
    context.args = args;
    return vm.runInContext('(' + fn.toString() + ')(...args)', context);
  };

  const maybeHoldOrFail = (phase, runFn) => {
    calls.push({ phase, at: clock.now });
    if (opts.failAt === phase) {
      const err = typeof opts.failError === 'function' ? opts.failError(phase) : (opts.failError || new Error(`boom at ${phase}`));
      return Promise.reject(err);
    }
    if (opts.hold === phase || (Array.isArray(opts.holds) && opts.holds.includes(phase))) {
      return new Promise((resolve, reject) => {
        holds.set(phase, {
          resolve: () => {
            try { resolve(runFn()); } catch (e) { reject(e); }
          },
          reject: err => reject(err),
          resolveRaw: val => resolve(val)
        });
      });
    }
    return Promise.resolve().then(runFn);
  };

  const pollingHandle = {
    dispose() {
      pollingDisposes++;
      calls.push({ phase: 'polling-dispose', at: clock.now });
      if (opts.pollingDisposeSyncThrow) throw new Error('polling sync dispose boom');
      if (opts.pollingDisposeAsyncReject) return Promise.reject(new Error('polling async dispose boom'));
      if (opts.hold === 'polling-dispose') {
        return new Promise((resolve, reject) => holds.set('polling-dispose', { resolve, reject }));
      }
      return Promise.resolve();
    }
  };

  const handle = {
    evaluate(fn, ...args) {
      const src = fn.toString();
      const phase = /\.sample\(/.test(src)
        ? 'geometry'
        : /\.cleanup\(/.test(src)
          ? 'cleanup'
          : 'diagnostic';
      if (phase === 'cleanup') cleanupCalls++;
      if (phase === 'diagnostic') diagnosticCalls++;
      return maybeHoldOrFail(phase, () => execute(fn, [state, ...args]));
    },
    dispose() {
      controllerDisposes++;
      calls.push({ phase: 'dispose', at: clock.now });
      if (opts.controllerDisposeSyncThrow) throw new Error('controller sync dispose boom');
      if (opts.controllerDisposeAsyncReject) return Promise.reject(new Error('controller async dispose boom'));
      if (opts.hold === 'dispose') {
        return new Promise((resolve, reject) => holds.set('dispose', { resolve, reject }));
      }
      return Promise.resolve();
    }
  };

  const page = {
    evaluate() {
      return maybeHoldOrFail('clock', () => ({ now: clock.now, timeOrigin: 0 }));
    },
    evaluateHandle() {
      return maybeHoldOrFail('prepare', () => handle);
    },
    waitForFunction() {
      const phase = opts.hold === 'geometry-poll' && !calls.some(c => c.phase === 'geometry') ? 'geometry' : 'polling';
      return maybeHoldOrFail(phase, () => pollingHandle);
    },
    click() {
      clicks.push(clock.now);
    }
  };

  return {
    page,
    handle,
    pollingHandle,
    calls,
    mutations,
    clicks,
    holds,
    counts: () => ({ controllerDisposes, pollingDisposes, cleanupCalls, diagnosticCalls })
  };
}

let passed = 0;
let failed = 0;
const unhandled = [];
const uncaught = [];
const onUnhandled = err => unhandled.push(err);
const onUncaught = err => uncaught.push(err);
process.on('unhandledRejection', onUnhandled);
process.on('uncaughtException', onUncaught);

async function runCase(id, classification, title, fn) {
  const original = {
    performance: globalThis.performance,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  };
  const beforeUnhandled = unhandled.length;
  const beforeUncaught = uncaught.length;
  try {
    const out = await fn();
    await new Promise(r => setImmediate(r));
    assert.equal(unhandled.length - beforeUnhandled, 0, 'nenhuma unhandledRejection permitida');
    assert.equal(uncaught.length - beforeUncaught, 0, 'nenhuma uncaughtException permitida');
    passed++;
    console.log(`✅ W4-REG ${id} [${classification}] ${title} ${JSON.stringify(out)}`);
  } catch (error) {
    failed++;
    console.error(`❌ W4-REG ${id} [${classification}] ${title}\n${error.stack}`);
  } finally {
    globalThis.performance = original.performance;
    globalThis.setTimeout = original.setTimeout;
    globalThis.clearTimeout = original.clearTimeout;
  }
}

function withClock(clock, fn) {
  globalThis.performance = { now: () => clock.now, timeOrigin: 0 };
  globalThis.setTimeout = clock.set;
  globalThis.clearTimeout = clock.clear;
  return fn();
}

// 01
await runCase('01', 'discriminante', 'Erro não-timeout após expiração lógica com controller ativo', async () => {
  const results = [];
  for (const jumpTo of [3977, 4001]) {
    const clock = new Clock();
    const fx = makeHarness(clock, { hold: 'polling' });
    let caught;
    await withClock(clock, async () => {
      const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
      await clock.flush();
      // Simula salto físico pós-cutoff antes da execução do callback do timer
      clock.now = jumpTo;
      fx.holds.get('polling').reject(new Error('protocol non-timeout failure at boundary'));
      await clock.flush();
      if (!caught) await clock.to(4005);
      await op;
      if (caught?.interaction?.lateSettlement?.settled) {
        await caught.interaction.lateSettlement.settled;
      }
      await clock.flush();
    });
    assert.ok(caught);
    assert.notEqual(caught.name, 'TimeoutError', 'erro original não-timeout deve ser preservado');
    assert.equal(caught.message, 'protocol non-timeout failure at boundary');
    assert.equal(fx.counts().cleanupCalls, 0, 'não deve iniciar cleanup após cutoff');
    assert.equal(fx.counts().controllerDisposes, 1, 'controller ativo deve ser descartado');
    assert.equal(caught.interaction.logicalExpired, true);
    assert.equal(caught.interaction.logicalExpiredAtMs, jumpTo);
    assert.equal(caught.interaction.expirationSource, 'node-cutoff-check');
    assert.equal(caught.interaction.timerFiredAtMs, null);
    assert.equal(caught.interaction.physicalReturnedAtMs, jumpTo);
    assert.equal(caught.interaction.physicalElapsedMs, jumpTo);
    assert.equal(caught.interaction.returnDelayMs, 0);
    assert.equal(caught.interaction.cutoffOvershootMs, jumpTo - 3976);
    assert.equal(caught.interaction.cleanupConfirmed, false);
    results.push({
      jumpTo,
      controllerDispose: fx.counts().controllerDisposes,
      logicalExpiredAtMs: caught.interaction.logicalExpiredAtMs,
      physicalReturnedAtMs: caught.interaction.physicalReturnedAtMs,
      returnDelayMs: caught.interaction.returnDelayMs
    });
  }
  return { subcases: results };
});

// 02
await runCase('02', 'discriminante', 'Polling handle na fronteira do orçamento', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { hold: 'polling' });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.to(3976);
    fx.holds.get('polling').resolve();
    await clock.to(4500);
    await op;
    if (caught?.interaction?.lateSettlement?.settled) await caught.interaction.lateSettlement.settled;
  });
  assert.equal(caught.name, 'TimeoutError');
  assert.equal(fx.counts().diagnosticCalls, 0, 'nenhuma etapa posterior ao cutoff deve iniciar');
  assert.equal(fx.counts().cleanupCalls, 0);
  assert.equal(fx.counts().pollingDisposes, 1);
  assert.equal(fx.counts().controllerDisposes, 1);
  return { pollingDispose: fx.counts().pollingDisposes, controllerDispose: fx.counts().controllerDisposes };
});

// 03
await runCase('03', 'discriminante', 'Erro diagnóstico na fronteira', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { hold: 'diagnostic' });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.flush();
    clock.now = 4001;
    fx.holds.get('diagnostic').reject(new Error('diagnostic failed at cutoff'));
    await clock.flush();
    if (!caught) await clock.to(4005);
    await op;
    if (caught?.interaction?.lateSettlement?.settled) await caught.interaction.lateSettlement.settled;
  });
  assert.equal(caught.message, 'diagnostic failed at cutoff');
  assert.notEqual(caught.name, 'TimeoutError');
  assert.equal(fx.counts().pollingDisposes, 1);
  assert.equal(fx.counts().controllerDisposes, 1);
  assert.equal(caught.interaction.logicalExpiredAtMs, 4001);
  return { preserved: caught.message, ...fx.counts() };
});

// 04
await runCase('04', 'discriminante', 'Erro de cleanup na fronteira', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { hold: 'cleanup' });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.flush();
    clock.now = 4001;
    fx.holds.get('cleanup').reject(new Error('cleanup protocol crash at boundary'));
    await clock.flush();
    if (!caught) await clock.to(4005);
    await op;
    if (caught?.interaction?.lateSettlement?.settled) await caught.interaction.lateSettlement.settled;
  });
  assert.equal(caught.message, 'cleanup protocol crash at boundary');
  assert.notEqual(caught.name, 'TimeoutError');
  assert.equal(fx.counts().controllerDisposes, 1);
  assert.equal(caught.interaction.logicalExpiredAtMs, 4001);
  return { preserved: caught.message, controllerDispose: fx.counts().controllerDisposes };
});

// 05
await runCase('05', 'discriminante', 'Dispose síncrono do controller com throw', async () => {
  // Subcaso A: timeout + controller.dispose lança sincronamente
  const c1 = new Clock();
  const fx1 = makeHarness(c1, { hold: 'polling', controllerDisposeSyncThrow: true });
  let err1;
  await withClock(c1, async () => {
    const op = scrollToInteractable(fx1.page, '#target').catch(e => { err1 = e; });
    await c1.to(4000);
    fx1.holds.get('polling').resolve();
    await c1.to(5000);
    await op;
    if (err1?.interaction?.lateSettlement?.settled) await err1.interaction.lateSettlement.settled;
  });
  assert.equal(err1.name, 'TimeoutError');
  assert.equal(fx1.counts().controllerDisposes, 1);
  assert.ok(err1.interaction.disposeErrorsAtReturn.some(e => e.message === 'controller sync dispose boom'));

  // Subcaso B: erro diagnóstico primário + controller.dispose lança sincronamente
  const c2 = new Clock();
  const fx2 = makeHarness(c2, { failAt: 'diagnostic', failError: new Error('original diagnostic boom'), controllerDisposeSyncThrow: true });
  let err2;
  await withClock(c2, async () => {
    const op = scrollToInteractable(fx2.page, '#target').catch(e => { err2 = e; });
    await c2.to(100);
    await op;
    if (err2?.interaction?.lateSettlement?.settled) await err2.interaction.lateSettlement.settled;
  });
  assert.equal(err2.message, 'original diagnostic boom', 'erro primário nunca pode ser substituído pelo dispose');
  assert.equal(fx2.counts().controllerDisposes, 1);
  assert.ok(err2.interaction.disposeErrorsAtReturn.some(e => e.message === 'controller sync dispose boom'));
  return { timeoutHandled: err1.name, originalPreserved: err2.message, controllerDispose: fx2.counts().controllerDisposes };
});

// 06
await runCase('06', 'discriminante', 'Dispose assíncrono do controller com rejection', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { hold: 'polling', controllerDisposeAsyncReject: true });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.to(4000);
    await op;
    assert.equal(caught.name, 'TimeoutError');
    assert.equal(caught.interaction.metricsPartialAtReturn, true);
    assert.equal(caught.interaction.lateDisposalPending, true);
    fx.holds.get('polling').resolve();
    await clock.to(5000);
    await caught.interaction.lateSettlement.settled;
  });
  assert.equal(fx.counts().controllerDisposes, 1);
  assert.equal(caught.interaction.lateSettlement.pending, false);
  assert.ok(caught.interaction.lateSettlement.finalResources.allDisposeErrors.some(e => e.message === 'controller async dispose boom'));
  return { ok: true, controllerDispose: fx.counts().controllerDisposes, capturedErrors: caught.interaction.lateSettlement.finalResources.allDisposeErrors.length };
});

// 07
await runCase('07', 'discriminante', 'Dispose síncrono do polling com throw', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { pollingDisposeSyncThrow: true });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.to(500);
    await op;
    if (caught?.interaction?.lateSettlement?.settled) await caught.interaction.lateSettlement.settled;
  });
  assert.equal(fx.counts().pollingDisposes, 1);
  assert.equal(fx.counts().controllerDisposes, 1, 'falha no dispose do polling não pode pular descarte do controller');
  assert.ok(caught?.interaction?.disposeErrorsAtReturn.some(e => e.message === 'polling sync dispose boom'));
  return { pollingDispose: fx.counts().pollingDisposes, controllerDispose: fx.counts().controllerDisposes };
});

// 08
await runCase('08', 'discriminante', 'Dispose assíncrono do polling com rejection', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { pollingDisposeAsyncReject: true });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.to(500);
    await op;
    if (caught?.interaction?.lateSettlement?.settled) await caught.interaction.lateSettlement.settled;
  });
  assert.equal(fx.counts().pollingDisposes, 1);
  assert.equal(fx.counts().controllerDisposes, 1);
  assert.ok(caught?.interaction?.lateSettlement?.finalResources?.allDisposeErrors.some(e => e.message === 'polling async dispose boom'));
  return { pollingDispose: fx.counts().pollingDisposes, controllerDispose: fx.counts().controllerDisposes };
});

// 09
await runCase('09', 'discriminante', 'Callback tardio pós-settlement com throw em ambos disposers', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, {
    holds: ['prepare', 'polling'],
    controllerDisposeSyncThrow: true,
    pollingDisposeAsyncReject: true
  });
  // Em prepare pendente, simulamos um fluxo onde prepare ainda resolve tarde com handle que lança em dispose
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.to(4000);
    await op;
    assert.equal(caught.name, 'TimeoutError');
    assert.equal(caught.interaction.metricsPartialAtReturn, true);
    fx.holds.get('prepare').resolve();
    await clock.flush();
    fx.holds.get('polling')?.resolve();
    await clock.to(5000);
    await caught.interaction.lateSettlement.settled;
  });
  assert.equal(fx.counts().controllerDisposes, 1);
  assert.equal(caught.interaction.lateSettlement.pending, false);
  assert.ok(caught.interaction.lateSettlement.lateDisposeErrors.some(e => e.message === 'controller sync dispose boom'));
  // Caso adicional: polling já existente com dispose que lança tarde em settlement
  const clock2 = new Clock();
  const fx2 = makeHarness(clock2, { hold: 'polling', pollingDisposeAsyncReject: true, controllerDisposeAsyncReject: true });
  let caught2;
  await withClock(clock2, async () => {
    const op = scrollToInteractable(fx2.page, '#target').catch(e => { caught2 = e; });
    await clock2.to(4000);
    await op;
    fx2.holds.get('polling').resolve();
    await clock2.to(5000);
    await caught2.interaction.lateSettlement.settled;
  });
  assert.equal(fx2.counts().pollingDisposes, 1);
  assert.equal(fx2.counts().controllerDisposes, 1);
  assert.equal(caught2.interaction.lateSettlement.lateDisposeErrors.length, 2);
  return {
    prepareLateErrors: caught.interaction.lateSettlement.lateDisposeErrors.length,
    pollingDispose: fx2.counts().pollingDisposes,
    controllerDispose: fx2.counts().controllerDisposes
  };
});

// 10
await runCase('10', 'discriminante', 'Timeout durante prepare', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { hold: 'prepare' });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.to(3976);
    if (!caught) await clock.to(4005);
    await op;
    assert.equal(caught.name, 'TimeoutError');
    assert.equal(caught.interaction.logicalExpiredAtMs, 3976);
    assert.equal(fx.counts().controllerDisposes, 0, 'prepare ainda não resolveu em 3976');
    assert.equal(caught.interaction.metricsPartialAtReturn, true);
    assert.ok(caught.interaction.pendingResources.includes('prepare-controller-promise'));
    fx.holds.get('prepare').resolve();
    await clock.to(5000);
    await caught.interaction.lateSettlement.settled;
  });
  assert.equal(fx.counts().controllerDisposes, 1, 'handle tardio de prepare deve ser descartado');
  assert.equal(caught.interaction.lateSettlement.lateDisposedController, true);
  return { lateDisposes: fx.counts().controllerDisposes, elapsedMs: caught.interaction.physicalReturnedAtMs };
});

// 11
await runCase('11', 'discriminante', 'Timeout durante polling', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { hold: 'polling' });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.to(4000);
    await op;
    fx.holds.get('polling').resolve();
    await clock.to(5000);
    await caught.interaction.lateSettlement.settled;
  });
  assert.equal(caught.name, 'TimeoutError');
  assert.equal(fx.counts().diagnosticCalls, 0);
  assert.equal(fx.counts().cleanupCalls, 0);
  assert.equal(fx.counts().pollingDisposes, 1);
  assert.equal(fx.counts().controllerDisposes, 1);
  return { calls: fx.calls.map(c => c.phase) };
});

// 12
await runCase('12', 'discriminante', 'Timeout durante cleanup', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { hold: 'cleanup' });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.to(4000);
    await op;
    assert.equal(caught.name, 'TimeoutError');
    assert.ok(caught.interaction.pendingResources.includes('cleanup-evaluate-promise'));
    fx.holds.get('cleanup').reject(new Error('late cleanup failure after timeout'));
    await clock.to(5000);
    await caught.interaction.lateSettlement.settled;
  });
  assert.equal(fx.counts().controllerDisposes, 1);
  assert.equal(fx.mutations.filter(m => m.at >= 3976).length, 0);
  assert.ok(caught.interaction.lateSettlement.lateCleanupErrors.some(e => e.message === 'late cleanup failure after timeout'));
  return { controllerDispose: fx.counts().controllerDisposes, mutationsAtExpiry: fx.mutations.length };
});

// 13
await runCase('13', 'regressao_comportamento_ja_correto', 'Dispose concorrente com timeout (idempotente sem duplo dispose)', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { hold: 'dispose' });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.to(4000);
    await op;
    assert.equal(caught.name, 'TimeoutError');
    assert.equal(fx.counts().controllerDisposes, 1);
    fx.holds.get('dispose').resolve();
    await clock.to(5000);
    await caught.interaction?.lateSettlement?.settled;
  });
  assert.equal(fx.counts().controllerDisposes, 1, 'não pode disparar segundo dispose concorrente');
  return { controllerDispose: fx.counts().controllerDisposes };
});

// 14
await runCase('14', 'discriminante', 'Cleanup parcial interrompido e idempotência inerte no renderer', async () => {
  const fx = createScrollDOM({
    nativeEnd: true,
    containers: [
      { id: 'outer', width: 360, height: 500, scrollHeight: 2000, style: { overflowY: 'auto' } },
      { id: 'inner', parent: 'outer', top: 800, width: 330, height: 300, scrollHeight: 1800, style: { overflowY: 'auto' } }
    ],
    target: { parent: 'inner', left: 30, top: 1000 }
  });
  const lease = { finalAt: 4000, expiresAt: 3936, cleanupUntil: 3968, timeoutMs: 4000 };
  const fs = await import('node:fs');
  const helperSrc = fs.readFileSync(new URL('./helpers/browser-interaction.mjs', import.meta.url), 'utf8');
  const idx = helperSrc.indexOf('function installScrollController');
  assert.ok(idx >= 0);
  const installFn = vm.runInThisContext('(' + helperSrc.slice(idx) + ')');
  const h = await fx.page.evaluateHandle(installFn, '#target', lease);
  await h.evaluate(s => s.sample(true));
  fx.clock.now = 3970; // salto pós cleanupUntil (3968) simulando renderer congelado -> cleanup interrompido
  const effectsBefore = fx.effects.length;
  const res1 = await h.evaluate(s => s.cleanup(false));
  const effectsAfter1 = fx.effects.length;
  const res2 = await h.evaluate(s => s.cleanup(false));
  const effectsAfter2 = fx.effects.length;
  const sampleAfter = await h.evaluate(s => s.sample());
  const effectsAfter3 = fx.effects.length;

  assert.equal(res1.cleanupConfirmed, false);
  assert.equal(res1.closed, true, 'estado deve estar fechado após interrupção');
  assert.equal(res1.partial, true);
  assert.ok(Array.isArray(res1.inertResources) && res1.inertResources.includes('reference-iframe'));
  assert.deepEqual(res2, res1);
  assert.equal(sampleAfter, true);
  assert.equal(effectsAfter1, effectsBefore, 'cleanup após cleanupUntil não pode mutar DOM');
  assert.equal(effectsAfter2, effectsBefore);
  assert.equal(effectsAfter3, effectsBefore);
  return { res1, res2, effectsFrozen: true };
});

// 15
await runCase('15', 'regressao_comportamento_ja_correto', 'Cleanup/dispose repetido (idempotência)', async () => {
  const fx = createScrollDOM({
    nativeEnd: true,
    containers: [{ id: 'inner', top: 120, width: 340, height: 300, scrollHeight: 1800, style: { overflowY: 'auto' } }],
    target: { parent: 'inner', left: 30, top: 1000 }
  });
  const fs = await import('node:fs');
  const helperSrc = fs.readFileSync(new URL('./helpers/browser-interaction.mjs', import.meta.url), 'utf8');
  const installFn = vm.runInThisContext('(' + helperSrc.slice(helperSrc.indexOf('function installScrollController')) + ')');
  const h = await fx.page.evaluateHandle(installFn, '#target', { finalAt: 4000, expiresAt: 3936, cleanupUntil: 3968, timeoutMs: 4000 });
  const c1 = await h.evaluate(s => s.cleanup(false));
  const c2 = await h.evaluate(s => s.cleanup(false));
  const c3 = await h.evaluate(s => s.cleanup(false));
  assert.equal(c1.cleanupConfirmed, true);
  assert.equal(c2.cleanupConfirmed, true);
  assert.equal(c3.cleanupConfirmed, true);
  return { first: c1.cleanupConfirmed, second: c2.cleanupConfirmed, third: c3.cleanupConfirmed };
});

// 16 — CORRIGIDO NA W4 PARA SER DISCRIMINANTE NO BASELINE (falha se controllerDispose === 0)
await runCase('16', 'discriminante', 'Operação antiga resolve após expiração (descarte obrigatório nas 5 fases)', async () => {
  const verifiedPhases = [];
  for (const heldPhase of ['prepare', 'geometry', 'polling', 'diagnostic', 'cleanup']) {
    const clock = new Clock();
    const fx = makeHarness(clock, { hold: heldPhase });
    let caught;
    await withClock(clock, async () => {
      const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
      await clock.to(4000);
      await op;
      assert.equal(caught.name, 'TimeoutError');
      fx.holds.get(heldPhase).resolve();
      await clock.to(6000);
      if (caught?.interaction?.lateSettlement?.settled) {
        await caught.interaction.lateSettlement.settled;
      }
    });
    const c = fx.counts();
    assert.equal(c.controllerDisposes, 1, `controller precisa ser descartado após expiração em ${heldPhase}`);
    if (heldPhase === 'polling') {
      assert.equal(c.pollingDisposes, 1, 'polling handle tardio também precisa ser descartado');
    }
    assert.equal(fx.clicks.length, 0);
    verifiedPhases.push({ phase: heldPhase, controllerDispose: c.controllerDisposes, pollingDispose: c.pollingDisposes });
  }
  return { verifiedPhases };
});

// 17
await runCase('17', 'discriminante', 'Operação antiga não inicia a próxima etapa após expiração', async () => {
  const expectedPrefix = {
    clock: ['clock'],
    prepare: ['clock', 'prepare'],
    geometry: ['clock', 'prepare', 'geometry'],
    polling: ['clock', 'prepare', 'geometry', 'polling'],
    diagnostic: ['clock', 'prepare', 'geometry', 'polling', 'diagnostic'],
    cleanup: ['clock', 'prepare', 'geometry', 'polling', 'diagnostic', 'cleanup']
  };
  const verified = [];
  for (const [heldPhase, allowedProtocolPhases] of Object.entries(expectedPrefix)) {
    const clock = new Clock();
    const fx = makeHarness(clock, { hold: heldPhase });
    let caught;
    await withClock(clock, async () => {
      const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
      await clock.to(4000);
      await op;
      fx.holds.get(heldPhase).resolve();
      await clock.to(6000);
      if (caught?.interaction?.lateSettlement?.settled) await caught.interaction.lateSettlement.settled;
    });
    const executedProtocol = fx.calls.map(c => c.phase).filter(p => p !== 'dispose' && p !== 'polling-dispose');
    assert.deepEqual(executedProtocol, allowedProtocolPhases, `fase seguinte não pode iniciar após expiração em ${heldPhase}`);
    if (heldPhase !== 'clock') {
      assert.equal(fx.counts().controllerDisposes, 1, `dispose deve ocorrer após expiração em ${heldPhase}`);
    }
    verified.push(heldPhase);
  }
  return { verified };
});

// 18
await runCase('18', 'regressao_comportamento_ja_correto', 'Ausência de clique tardio', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { hold: 'polling' });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').then(() => fx.page.click(), e => { caught = e; });
    await clock.to(4000);
    fx.holds.get('polling').resolve();
    await clock.to(6000);
    await op;
    if (caught?.interaction?.lateSettlement?.settled) await caught.interaction.lateSettlement.settled;
  });
  assert.equal(caught.name, 'TimeoutError');
  assert.equal(fx.clicks.length, 0);
  return { clicks: fx.clicks.length };
});

// 19
await runCase('19', 'regressao_comportamento_ja_correto', 'Ausência de mutação tardia', async () => {
  const fx = createScrollDOM({
    nativeEnd: true,
    containers: [{ id: 'inner', top: 120, width: 340, height: 300, scrollHeight: 1800, style: { overflowY: 'auto' } }],
    target: { parent: 'inner', left: 30, top: 1000 }
  });
  let caught;
  await withClock(fx.clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await fx.clock.to(4000);
    await op;
    const snapBefore = fx.snapshot();
    await fx.clock.to(8000);
    assert.equal(fx.snapshot().effects.length, snapBefore.effects.length);
    assert.equal(fx.snapshot().references, 0);
    assert.equal(fx.countListeners(), 0);
  });
  assert.equal(caught.name, 'TimeoutError');
  return { lateEffects: 0, references: 0, listeners: 0 };
});

// 20
await runCase('20', 'discriminante', 'Ausência de unhandled rejection e métricas temporais separadas W4', async () => {
  const clock = new Clock();
  const fx = makeHarness(clock, { hold: 'polling' });
  let caught;
  await withClock(clock, async () => {
    const op = scrollToInteractable(fx.page, '#target').catch(e => { caught = e; });
    await clock.to(4000);
    await op;
  });
  const m = caught.interaction;
  assert.equal(m.deadlineMs, 4000);
  assert.equal(m.logicalCutoffMs, 3976);
  assert.equal(m.logicalExpired, true);
  assert.equal(m.expirationSource, 'node-timer');
  assert.equal(m.logicalExpiredAtMs, 3976);
  assert.equal(m.timerFiredAtMs, 3976);
  assert.equal(m.timerDelayMs, 0);
  assert.equal(m.timerDriftMs, 0);
  assert.equal(m.physicalReturnedAtMs, 3976);
  assert.equal(m.physicalElapsedMs, m.physicalReturnedAtMs);
  assert.equal(m.returnDelayMs, 0);
  assert.equal(m.cutoffOvershootMs, 0);
  assert.equal(m.deadlineOvershootMs, 0);
  assert.equal(m.cleanupConfirmed, false);
  assert.equal(m.metricsSnapshotScope, 'partial-at-return');
  assert.equal(m.metricsPartialAtReturn, true);
  assert.equal(m.lateDisposalPending, true);
  assert.equal('eventLoopDelayMs' in m, false, 'não deve expor eventLoopDelayMs enganoso');

  await withClock(clock, async () => {
    fx.holds.get('polling').resolve();
    await clock.to(5000);
    await m.lateSettlement.settled;
  });
  assert.equal(m.lateSettlement.pending, false);
  assert.equal(m.lateSettlement.scope, 'final-settled');
  assert.equal(m.lateSettlement.finalResources.controllerDisposed, true);
  assert.equal(m.lateSettlement.finalResources.pollingDisposed, true);

  return {
    metrics: {
      deadlineMs: m.deadlineMs,
      logicalCutoffMs: m.logicalCutoffMs,
      logicalExpired: m.logicalExpired,
      expirationSource: m.expirationSource,
      logicalExpiredAtMs: m.logicalExpiredAtMs,
      timerFiredAtMs: m.timerFiredAtMs,
      timerDelayMs: m.timerDelayMs,
      physicalReturnedAtMs: m.physicalReturnedAtMs,
      physicalElapsedMs: m.physicalElapsedMs,
      returnDelayMs: m.returnDelayMs,
      cleanupConfirmed: m.cleanupConfirmed,
      metricsSnapshotScope: m.metricsSnapshotScope,
      lateSettlementScope: m.lateSettlement.scope
    },
    unhandledCount: unhandled.length,
    uncaughtCount: uncaught.length
  };
});

process.off('unhandledRejection', onUnhandled);
process.off('uncaughtException', onUncaught);

console.log(`\nW4 REGRESSIONS — ${passed}/${passed + failed}; 20 casos obrigatórios (16 discriminantes, 4 regressões de comportamento já correto; modelo/protocolo, NÃO Chromium).`);
if (failed) process.exitCode = 1;
