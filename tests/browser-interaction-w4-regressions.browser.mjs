/* Real Chromium W4 regressions (6 cases: A, B, C x Blink ScrollEndEvents ON/OFF).
   Tests real headless Chromium with web security active (SOP/CORS enabled),
   non-timeout post-cutoff rejection, late dispose error preservation, and
   renderer partial cleanup idempotency + scrollToInteractable roundtrip. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchBrowser } from './helpers/browser.mjs';
import { scrollToInteractable } from './helpers/browser-interaction.mjs';

const helperSrc = fs.readFileSync(new URL('./helpers/browser-interaction.mjs', import.meta.url), 'utf8');
const installIdx = helperSrc.indexOf('function installScrollController');
if (installIdx < 0) throw new Error('installScrollController not found in helper');
const installFn = new Function(`return (${helperSrc.slice(installIdx)})`)();

const PAGE_HTML = `<!doctype html>
<style>
  html { scroll-behavior: smooth; scrollbar-width: none; }
  body { margin: 0; width: 390px; height: 844px; overflow-anchor: none; }
  #inner { position: absolute; left: 0; top: 120px; width: 340px; height: 300px; overflow-y: auto; scroll-behavior: smooth; scrollbar-width: none; }
  #extent { position: absolute; left: 0; top: 0; width: 340px; height: 1800px; }
  #target { position: absolute; left: 30px; top: 1000px; width: 100px; height: 34px; border: 0; padding: 0; }
</style>
<section id="inner"><div id="extent"></div><button id="target">Alvo</button></section>`;

let passed = 0;
let failed = 0;
const unhandled = [];
const onUnhandled = err => unhandled.push(err);
process.on('unhandledRejection', onUnhandled);

for (const mode of [true, false]) {
  const tag = mode ? 'ON' : 'OFF';
  const browser = await launchBrowser({ enforceWebSecurity: true, scrollEndEvents: mode });
  try {
    // A: Erro não-timeout após cutoff lógico (3976 ms) em Chromium real
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      let rejectPendingPoll;
      let timerId;
      try {
        await page.setViewport({ width: 390, height: 844 });
        await page.setContent(PAGE_HTML);
        await page.evaluate(() => {
          window.clicks = 0;
          document.getElementById('target').addEventListener('click', () => { window.clicks++; });
        });
        let controllerDisposes = 0;
        let cleanupCalls = 0;
        let started;

        const wrap = raw => ({
          evaluate(fn, ...args) {
            if (/\.cleanup\(/.test(fn.toString())) cleanupCalls++;
            return raw.evaluate(fn, ...args);
          },
          dispose() {
            controllerDisposes++;
            return raw.dispose();
          }
        });

        const protocol = {
          evaluate: (...args) => page.evaluate(...args),
          evaluateHandle: (...args) => page.evaluateHandle(...args).then(wrap),
          waitForFunction: () => new Promise((_, reject) => { rejectPendingPoll = reject; })
        };

        // Agendado com margem antes do timer interno (3972 < 3976) para garantir execução antes do disparo do timer
        timerId = setTimeout(() => {
          while (performance.now() - started < 3977.2) { /* salto monotônico controlado > 3976ms */ }
          if (rejectPendingPoll) rejectPendingPoll(new Error('real chromium non-timeout failure at cutoff'));
        }, 3972);

        started = performance.now();
        let caught;
        try {
          await scrollToInteractable(protocol, '#target');
        } catch (err) {
          caught = err;
        }
        assert.ok(caught, 'erro não-timeout deve rejeitar');
        assert.notEqual(caught.name, 'TimeoutError', 'não deve substituir erro real por TimeoutError');
        assert.equal(caught.message, 'real chromium non-timeout failure at cutoff');
        if (caught.interaction?.lateSettlement?.settled) {
          await caught.interaction.lateSettlement.settled;
        }
        assert.equal(controllerDisposes, 1, 'controller JSHandle real deve ser descartado 1x');
        assert.equal(cleanupCalls, 0, 'cleanup não pode iniciar após cutoff');
        const clicks = await page.evaluate(() => window.clicks);
        assert.equal(clicks, 0);

        const m = caught.interaction;
        assert.equal(m.deadlineMs, 4000);
        assert.equal(m.logicalCutoffMs, 3976);
        assert.equal(m.logicalExpired, true);
        assert.equal(typeof m.logicalExpiredAtMs, 'number', 'logicalExpiredAtMs não pode ser nulo após cutoff');
        assert.ok(m.logicalExpiredAtMs >= 3976, `esperado >= 3976, obtido ${m.logicalExpiredAtMs}`);
        assert.equal(m.physicalReturnedAtMs, m.physicalElapsedMs);
        assert.equal(typeof m.returnDelayMs, 'number');
        assert.ok(m.returnDelayMs >= 0);
        assert.equal(m.cleanupConfirmed, false);
        assert.deepEqual(errors, []);

        passed++;
        console.log(`✅ W4-CHROMIUM ${tag} A_non_timeout_cutoff ${JSON.stringify({
          caught: caught.message,
          controllerDisposes,
          cleanupCalls,
          clicks,
          metrics: {
            deadlineMs: m.deadlineMs,
            logicalCutoffMs: m.logicalCutoffMs,
            logicalExpired: m.logicalExpired,
            expirationSource: m.expirationSource,
            logicalExpiredAtMs: m.logicalExpiredAtMs,
            timerFiredAtMs: m.timerFiredAtMs,
            physicalReturnedAtMs: m.physicalReturnedAtMs,
            physicalElapsedMs: m.physicalElapsedMs,
            returnDelayMs: m.returnDelayMs,
            cleanupConfirmed: m.cleanupConfirmed
          }
        })}`);
      } catch (error) {
        failed++;
        console.error(`❌ W4-CHROMIUM ${tag} A_non_timeout_cutoff\n${error.stack}`);
      } finally {
        clearTimeout(timerId);
        await page.close();
      }
    }

    // B: Dispose lança/rejeita no timeout + separação snapshot no retorno vs lateSettlement
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      let releasePoll;
      let releaseDispose;
      try {
        await page.setViewport({ width: 390, height: 844 });
        await page.setContent(PAGE_HTML);
        let controllerDisposes = 0;
        let pollingDisposes = 0;

        const wrapCtrl = raw => ({
          evaluate: (...args) => raw.evaluate(...args),
          async dispose() {
            controllerDisposes++;
            await new Promise(resolve => { releaseDispose = resolve; });
            await raw.dispose();
            throw new Error('real chromium controller async dispose failure');
          }
        });

        const protocol = {
          evaluate: (...args) => page.evaluate(...args),
          evaluateHandle: (...args) => page.evaluateHandle(...args).then(wrapCtrl),
          waitForFunction: () => new Promise(resolve => {
            releasePoll = () => resolve({
              dispose() {
                pollingDisposes++;
                throw new Error('real chromium polling sync dispose failure');
              }
            });
          })
        };

        let caught;
        try {
          await scrollToInteractable(protocol, '#target');
        } catch (err) {
          caught = err;
        }
        assert.ok(caught);
        assert.equal(caught.name, 'TimeoutError');
        const m = caught.interaction;
        assert.ok(m, 'métricas devem existir');
        // No momento do retorno, a operação ainda tem promises de dispose/polling pendentes!
        assert.equal(m.metricsPartialAtReturn, true, 'snapshot no retorno deve sinalizar pendência tardia');
        assert.equal(m.metricsSnapshotScope, 'partial-at-return');
        assert.equal(m.lateDisposalPending, true);
        assert.equal(m.physicalReturnedAtMs, m.physicalElapsedMs);
        assert.equal(typeof m.returnDelayMs, 'number');
        assert.ok(m.returnDelayMs >= 0);
        assert.equal('eventLoopDelayMs' in m, false);

        // Libera polling e dispose tardio; valida captura completa no lateSettlement
        if (releasePoll) { const rp = releasePoll; releasePoll = null; rp(); }
        if (releaseDispose) { const rd = releaseDispose; releaseDispose = null; rd(); }
        await m.lateSettlement.settled;

        assert.equal(controllerDisposes, 1);
        assert.equal(pollingDisposes, 1);
        assert.equal(m.lateSettlement.pending, false);
        assert.equal(m.lateSettlement.scope, 'final-settled');
        assert.ok(
          m.lateSettlement.finalResources.allDisposeErrors.some(e => e.message.includes('controller async dispose failure')),
          'erro tardio de controller.dispose deve ser preservado'
        );
        assert.ok(
          m.lateSettlement.finalResources.allDisposeErrors.some(e => e.message.includes('polling sync dispose failure')),
          'erro tardio de polling.dispose deve ser preservado'
        );
        assert.deepEqual(errors, []);

        passed++;
        console.log(`✅ W4-CHROMIUM ${tag} B_dispose_throws_and_metrics ${JSON.stringify({
          controllerDisposes,
          pollingDisposes,
          atReturn: {
            metricsSnapshotScope: m.metricsSnapshotScope,
            metricsPartialAtReturn: m.metricsPartialAtReturn,
            lateDisposalPending: m.lateDisposalPending,
            logicalExpiredAtMs: m.logicalExpiredAtMs,
            timerFiredAtMs: m.timerFiredAtMs,
            timerDelayMs: m.timerDelayMs,
            physicalReturnedAtMs: m.physicalReturnedAtMs,
            returnDelayMs: m.returnDelayMs,
            disposeErrorsAtReturn: m.disposeErrorsAtReturn
          },
          lateSettlement: {
            scope: m.lateSettlement.scope,
            pending: m.lateSettlement.pending,
            lateDisposeErrors: m.lateSettlement.lateDisposeErrors.map(e => e.message),
            allDisposeErrorsCount: m.lateSettlement.finalResources.allDisposeErrors.length
          }
        })}`);
      } catch (error) {
        failed++;
        console.error(`❌ W4-CHROMIUM ${tag} B_dispose_throws_and_metrics\n${error.stack}`);
      } finally {
        if (releasePoll) releasePoll();
        if (releaseDispose) releaseDispose();
        await page.close();
      }
    }

    // C: Cleanup parcial no renderer Chromium real (idempotente e inerte) + fluxo scrollToInteractable
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      try {
        await page.setViewport({ width: 390, height: 844 });
        await page.setContent(PAGE_HTML);
        await page.evaluate(() => {
          window.muts = 0;
          window.reqs = 0;
          new MutationObserver(recs => { window.muts += recs.length; }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
          const t = document.getElementById('target');
          const orig = t.scrollIntoView.bind(t);
          t.scrollIntoView = opts => { window.reqs++; return orig(opts); };
        });

        // Parte 1: controller real interrompido em cleanupUntil no Chromium
        // Arm the short lease, inspect the iframe and cross cleanupUntil in ONE
        // renderer task. CDP round trips under CPU load used to spend the lease
        // before the test had even inspected the reference.
        const ctrl = await page.evaluateHandle(new Function(`
          const now0 = performance.timeOrigin + performance.now();
          const lease = { finalAt: now0 + 120, expiresAt: now0 + 56, cleanupUntil: now0 + 88, timeoutMs: 4000 };
          const state = (${installFn})('#target', lease);
          const ref = document.querySelector('iframe[data-forja-scroll-reference]');
          window.referenceAttributes = ref && { inert: ref.inert, tabIndex: ref.tabIndex,
            ariaHidden: ref.getAttribute('aria-hidden'), pointerEvents: getComputedStyle(ref).pointerEvents,
            sandbox: ref.getAttribute('sandbox') };
          const until = performance.now() + 110;
          while (performance.now() < until) {}
          return state;
        `));
        const refAttrs = await page.evaluate(() => window.referenceAttributes);
        assert.deepEqual(refAttrs, {
          inert: true,
          tabIndex: -1,
          ariaHidden: 'true',
          pointerEvents: 'none',
          sandbox: 'allow-same-origin'
        });

        const mutsBefore = await page.evaluate(() => window.muts);
        const reqsBefore = await page.evaluate(() => window.reqs);
        const c1 = await ctrl.evaluate(s => s.cleanup(false));
        const c2 = await ctrl.evaluate(s => s.cleanup(false));
        const sampleAfter = await ctrl.evaluate(s => s.sample());
        const mutsDelta = (await page.evaluate(() => window.muts)) - mutsBefore;
        const reqsDelta = (await page.evaluate(() => window.reqs)) - reqsBefore;
        await ctrl.dispose();

        assert.equal(c1.closed, true, 'cleanup parcial deve marcar closed=true');
        assert.equal(c1.partial, true);
        assert.equal(c1.cleanupConfirmed, false);
        assert.ok(Array.isArray(c1.inertResources) && c1.inertResources.includes('reference-iframe'));
        assert.deepEqual(c2, c1);
        assert.equal(sampleAfter, true);
        assert.equal(mutsDelta, 0);
        assert.equal(reqsDelta, 0);

        // Parte 2: fluxo completo scrollToInteractable com atraso na etapa cleanup em página limpa
        const page2 = await browser.newPage();
        let releaseCleanupDelay;
        try {
          await page2.setViewport({ width: 390, height: 844 });
          await page2.setContent(PAGE_HTML);
          let roundtripDisposes = 0;
          const wrap2 = raw => ({
            evaluate(fn, ...args) {
              if (/\.cleanup\(/.test(fn.toString())) {
                return new Promise(resolve => {
                  const t = setTimeout(() => resolve(raw.evaluate(fn, ...args)), 4000);
                  releaseCleanupDelay = () => { clearTimeout(t); resolve({ cleanupConfirmed: false, ready: false, closed: true, partial: true }); };
                });
              }
              return raw.evaluate(fn, ...args);
            },
            dispose() { roundtripDisposes++; return raw.dispose(); }
          });
          const protocol2 = {
            evaluate: (...args) => page2.evaluate(...args),
            evaluateHandle: (...args) => page2.evaluateHandle(...args).then(wrap2),
            waitForFunction: (...args) => page2.waitForFunction(...args)
          };
          let rtErr;
          try {
            await scrollToInteractable(protocol2, '#target');
          } catch (err) {
            rtErr = err;
          }
          if (releaseCleanupDelay) releaseCleanupDelay();
          if (rtErr?.interaction?.lateSettlement?.settled) await rtErr.interaction.lateSettlement.settled;
          assert.ok(rtErr);
          assert.equal(rtErr.name, 'TimeoutError');
          assert.equal(rtErr.interaction.cleanupConfirmed, false);
          assert.equal(roundtripDisposes, 1);
          assert.deepEqual(errors, []);

          passed++;
          console.log(`✅ W4-CHROMIUM ${tag} C_renderer_partial_cleanup_inert ${JSON.stringify({
            refAttrs,
            c1,
            c2,
            sampleAfter,
            mutsDelta,
            reqsDelta,
            roundtrip: {
              errorName: rtErr.name,
              cleanupConfirmed: rtErr.interaction.cleanupConfirmed,
              roundtripDisposes,
              physicalReturnedAtMs: rtErr.interaction.physicalReturnedAtMs,
              logicalExpiredAtMs: rtErr.interaction.logicalExpiredAtMs
            }
          })}`);
        } finally {
          if (releaseCleanupDelay) releaseCleanupDelay();
          await page2.close();
        }
      } catch (error) {
        failed++;
        console.error(`❌ W4-CHROMIUM ${tag} C_renderer_partial_cleanup_inert\n${error.stack}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

process.off('unhandledRejection', onUnhandled);
assert.equal(unhandled.length, 0, 'nenhuma unhandledRejection permitida');

console.log(`\nW4 CHROMIUM REGRESSIONS — ${passed}/${passed + failed}; Chromium real Blink ON/OFF.`);
if (failed) process.exitCode = 1;
