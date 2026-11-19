import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { launchBrowser } from '../checkout/tests/helpers/browser.mjs';
import { scrollToInteractable } from '../checkout/tests/helpers/browser-interaction.mjs';

const require = createRequire(import.meta.url);
let timerSlackNs = null;
try {
  timerSlackNs = Number(readFileSync('/proc/self/timerslack_ns', 'utf8').trim());
} catch {}

// 1. Pure Node.js event-loop timer scheduling jitter (idle vs during Chromium launch/close)
async function measurePureNodeTimers(samples, label, withBrowserChurn = false) {
  const rows = [];
  for (let i = 0; i < samples; i++) {
    let browser;
    if (withBrowserChurn) {
      browser = await launchBrowser({ enforceWebSecurity: true, scrollEndEvents: i % 2 === 0 });
      const page = await browser.newPage();
      await page.setContent('<!doctype html><p>churn</p>');
      await browser.close();
    }
    const targetMs = 3976;
    const t0 = performance.now();
    const firedAt = await new Promise(resolve => {
      setTimeout(() => resolve(performance.now()), targetMs);
    });
    const elapsedMs = firedAt - t0;
    const delayMs = elapsedMs - targetMs;
    rows.push({
      sample: i + 1,
      targetMs,
      elapsedMs: +elapsedMs.toFixed(3),
      delayMs: +delayMs.toFixed(3)
    });
  }
  const delays = rows.map(r => r.delayMs).sort((a, b) => a - b);
  return {
    label,
    samples,
    minDelayMs: delays[0],
    medianDelayMs: delays[Math.floor(delays.length / 2)],
    p95DelayMs: delays[Math.min(delays.length - 1, Math.floor(delays.length * 0.95))],
    maxDelayMs: delays[delays.length - 1],
    over24msCount: delays.filter(d => d > 24).length,
    rows
  };
}

// 2. Real Chromium decomposition of A, B, C, D across all 12 protocol barrier scenarios
async function measureChromiumProtocolDecomposition() {
  const records = [];
  for (const mode of [true, false]) {
    const browser = await launchBrowser({ enforceWebSecurity: true, scrollEndEvents: mode });
    try {
      for (const heldPhase of ['prepare', 'geometry', 'polling', 'diagnostic', 'cleanup', 'dispose']) {
        const page = await browser.newPage();
        const pending = [], calls = [];
        const callTimings = [];
        let held = false, gateOpen = false, result, settledAt, releaseDone;
        try {
          await page.setViewport({ width: 390, height: 844 });
          await page.setContent('<!doctype html><style>html{scroll-behavior:smooth}body{margin:0;height:844px}#inner{position:absolute;top:120px;width:340px;height:300px;overflow:auto;scroll-behavior:smooth;scrollbar-width:none}#extent{height:1800px}#target{position:absolute;top:1000px;left:30px;width:100px;height:34px;border:0;padding:0}</style><section id="inner"><div id="extent"></div><button id="target">Alvo</button></section>');
          await page.evaluate(() => {
            window.fx = { mutations: 0, requests: 0, clicks: 0, scrolls: [] };
            new MutationObserver(r => { fx.mutations += r.length; }).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
            const target = document.getElementById('target'), native = target.scrollIntoView.bind(target);
            target.scrollIntoView = options => { fx.requests++; return native(options); };
            target.addEventListener('click', () => { fx.clicks++; });
            document.addEventListener('scroll', () => fx.scrolls.push([scrollX, scrollY, document.getElementById('inner').scrollTop]), true);
          });
          let started = 0;
          const schedule = (phase, task) => {
            const enqueuedAt = started ? +(performance.now() - started).toFixed(3) : 0;
            calls.push(phase);
            if (phase === heldPhase && !held) {
              held = true;
              if (gateOpen) {
                return Promise.resolve().then(async () => {
                  const s = performance.now();
                  const v = await task();
                  callTimings.push({ phase, held: false, startMs: +(s - started).toFixed(3), endMs: +(performance.now() - started).toFixed(3) });
                  return v;
                });
              }
              return new Promise((resolve, reject) => pending.push(() => {
                const rs = performance.now();
                releaseDone = Promise.resolve().then(task).then(
                  v => { callTimings.push({ phase, held: true, startMs: +(rs - started).toFixed(3), endMs: +(performance.now() - started).toFixed(3) }); resolve(v); },
                  e => { callTimings.push({ phase, held: true, startMs: +(rs - started).toFixed(3), endMs: +(performance.now() - started).toFixed(3), err: true }); reject(e); }
                );
                return releaseDone;
              }));
            }
            return Promise.resolve().then(async () => {
              const s = performance.now();
              const v = await task();
              callTimings.push({ phase, held: false, startMs: +(s - started).toFixed(3), endMs: +(performance.now() - started).toFixed(3) });
              return v;
            });
          };
          const wrap = raw => ({
            raw,
            evaluate(fn, ...args) {
              const source = fn.toString();
              const phase = /\.sample\(/.test(source) ? 'geometry' : /\.cleanup\(/.test(source) ? 'cleanup' : 'diagnostic';
              return schedule(phase, () => raw.evaluate(fn, ...args));
            },
            dispose: () => schedule('dispose', () => raw.dispose())
          });
          const protocol = {
            evaluate: (...args) => page.evaluate(...args),
            evaluateHandle: (fn, ...args) => schedule('prepare', () => page.evaluateHandle(fn, ...args).then(wrap)),
            waitForFunction: (fn, options, ...args) => schedule(
              heldPhase === 'geometry' && !calls.includes('geometry') ? 'geometry' : 'polling',
              () => page.waitForFunction(fn, options, ...args.map(a => a?.raw || a))
            )
          };
          started = performance.now();
          const operation = scrollToInteractable(protocol, '#target').then(
            () => { settledAt = performance.now(); result = { outcome: 'ready', elapsed: settledAt - started }; },
            error => { settledAt = performance.now(); result = { outcome: 'rejected', elapsed: settledAt - started, name: error.name, diagnostic: error.interaction }; }
          );
          const checkpointAt = await new Promise(resolve => setTimeout(() => resolve({ at: performance.now() - started, result: result && { ...result } }), Math.max(0, started + 4000 - performance.now())));
          gateOpen = true;
          const before = await page.evaluate(() => ({ ...fx, scrolls: [...fx.scrolls] }));
          const releaseStart = performance.now() - started;
          for (const release of pending.splice(0)) release();
          await operation;
          if (releaseDone) await releaseDone;
          // Allow detached post-rejection dispose() microtasks/CDP calls to settle
          await new Promise(resolve => setTimeout(resolve, 30));
          const after = await page.evaluate(() => ({ ...fx, scrolls: [...fx.scrolls] }));
          assert.deepEqual(after, before);
          assert.equal(after.clicks, 0);

          const timerFiredElapsed = result.diagnostic.elapsedMs;
          const helperReturnElapsed = result.elapsed;
          const scheduledCutoff = 3976;
          const eventLoopTimerDelay = timerFiredElapsed - scheduledCutoff;
          const microtaskRejectDelay = helperReturnElapsed - timerFiredElapsed;
          const disposeCalls = callTimings.filter(c => c.phase === 'dispose');
          const postRejectCalls = callTimings.filter(c => c.startMs >= helperReturnElapsed - 0.1);
          const postRejectCleanupDuration = postRejectCalls.length
            ? Math.max(...postRejectCalls.map(c => c.endMs)) - Math.min(...postRejectCalls.map(c => c.startMs))
            : 0;

          records.push({
            mode: mode ? 'ON' : 'OFF',
            heldPhase,
            A_logicalBudgetMs: 4000,
            A_nodeCutoffMs: scheduledCutoff,
            B_helperReturnMs: +helperReturnElapsed.toFixed(3),
            C_timerFiredElapsedMs: +timerFiredElapsed.toFixed(3),
            C_eventLoopTimerDeltaFromCutoffMs: +eventLoopTimerDelay.toFixed(3),
            C_microtaskRejectDelayMs: +microtaskRejectDelay.toFixed(3),
            C_checkpointTimerElapsedMs: +checkpointAt.at.toFixed(3),
            C_within4000Ms: helperReturnElapsed <= 4000,
            D_releaseStartedMs: +releaseStart.toFixed(3),
            D_postRejectCleanupDurationMs: +postRejectCleanupDuration.toFixed(3),
            D_disposeCalls: disposeCalls,
            D_cleanupConfirmedBeforeReject: result.diagnostic.cleanupConfirmed,
            calls,
            mutationsUnchanged: JSON.stringify(before) === JSON.stringify(after)
          });
        } finally {
          for (const release of pending.splice(0)) release();
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  return records;
}

const idleTimers = await measurePureNodeTimers(10, 'pure-idle-3976ms', false);
const churnTimers = await measurePureNodeTimers(8, 'post-chromium-churn-3976ms', true);
const chromiumDecomp = await measureChromiumProtocolDecomposition();

console.log(JSON.stringify({
  measuredAtUtc: new Date().toISOString(),
  kernelTimerSlackNs: timerSlackNs,
  idleTimers: { ...idleTimers, rows: undefined },
  idleTimerRows: idleTimers.rows,
  churnTimers: { ...churnTimers, rows: undefined },
  churnTimerRows: churnTimers.rows,
  chromiumDecomposition: chromiumDecomp
}, null, 2));
