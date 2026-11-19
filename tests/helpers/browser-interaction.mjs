/* E2E only. One Node monotonic budget covers every protocol await.
   Renderer commands also carry an expiring lease, so a queued command cannot
   start a scroll or install a reference after the operation has expired.
   W4: traceable metrics contract (no physical 4000ms guarantee claimed),
   explicit post-cutoff expiration timestamp, separated temporal & late
   disposal metrics, primary error preservation, and idempotent inert cleanup. */
const DEADLINE_MS = 4000;
const NODE_TIMER_RESERVE_MS = 24;
const LOGICAL_CUTOFF_MS = DEADLINE_MS - NODE_TIMER_RESERVE_MS;

export async function scrollToInteractable(page, selector) {
  const started = performance.now();
  const cutoffAt = started + LOGICAL_CUTOFF_MS;
  const elapsedNow = () => Math.max(0, performance.now() - started);
  const remaining = () => Math.max(0, cutoffAt - performance.now());

  let phase = 'clock';
  let controller;
  let pollingResult;
  let limits;
  let snapshot;
  let failure;
  let finished = false;
  let returned = false;

  let cleanupConfirmed = false;
  let disposed = false;
  let pollingDisposed = false;
  let lastDiagnostic = { reason: 'deadline' };

  let logicalExpired = false;
  let expirationSource = null;
  let logicalExpiredAtMs = null;
  let timerFiredAtMs = null;
  let timerDelayMs = null;
  let timerDriftMs = null;

  let activePreparePromise = null;
  let prepareSettled = false;
  let activeGeometryPromise = null;
  let geometrySettled = false;
  let activePollingPromise = null;
  let pollingSettled = false;
  let activeDiagnosticPromise = null;
  let diagnosticSettled = false;
  let activeCleanupPromise = null;
  let cleanupSettled = false;

  const disposedHandles = new WeakSet();
  let controllerDisposeStarted = false;
  let pollingDisposeStarted = false;
  let controllerDisposePromise = null;
  let pollingDisposePromise = null;

  const disposeErrorsAtReturn = [];
  const cleanupErrorsAtReturn = [];
  const lateTasks = [];

  const lateSettlement = {
    scope: 'pending',
    pending: false,
    lateDisposedController: false,
    lateDisposedPolling: false,
    lateDisposeErrors: [],
    lateCleanupErrors: [],
    finalResources: null,
    settledAtMs: null
  };

  const markExpired = (source, atMs = elapsedNow()) => {
    if (!logicalExpired) {
      logicalExpired = true;
      expirationSource = source;
      logicalExpiredAtMs = atMs;
    }
  };

  const computeInertResources = () => {
    const resources = [];
    if (limits && !cleanupConfirmed) {
      resources.push(logicalExpired ? 'renderer-controller-lease-expired' : 'renderer-controller-unconfirmed');
    }
    if (controller && !disposed) resources.push('controller-handle');
    if (pollingResult && !pollingDisposed) resources.push('polling-handle');
    if (activePreparePromise && !prepareSettled) resources.push('pending-prepare-handle');
    if (activePollingPromise && !pollingSettled) resources.push('pending-polling-handle');
    return resources;
  };

  const toErrorRecord = (target, atPhase, err, sync) => ({
    target,
    phase: atPhase,
    stage: returned ? 'late-after-return' : 'at-or-before-return',
    sync,
    name: err?.name || 'Error',
    message: err?.message || String(err),
    atMs: elapsedNow()
  });

  const recordCleanupError = (atPhase, err) => {
    const entry = toErrorRecord('cleanup', atPhase, err, false);
    if (returned) lateSettlement.lateCleanupErrors.push(entry);
    else cleanupErrorsAtReturn.push(entry);
  };

  const invokeDispose = (targetName, handle, atPhase) => {
    if (!handle || typeof handle.dispose !== 'function') return Promise.resolve();
    if (targetName === 'controller' && controllerDisposeStarted) return controllerDisposePromise || Promise.resolve();
    if (targetName === 'polling' && pollingDisposeStarted) return pollingDisposePromise || Promise.resolve();
    if (disposedHandles.has(handle)) return Promise.resolve();
    disposedHandles.add(handle);
    if (targetName === 'controller') controllerDisposeStarted = true;
    if (targetName === 'polling') pollingDisposeStarted = true;

    let rawCall;
    try {
      rawCall = Promise.resolve(handle.dispose());
    } catch (syncError) {
      const entry = toErrorRecord(targetName, atPhase, syncError, true);
      if (returned) lateSettlement.lateDisposeErrors.push(entry);
      else disposeErrorsAtReturn.push(entry);
      const resolved = Promise.resolve();
      if (targetName === 'controller') controllerDisposePromise = resolved;
      if (targetName === 'polling') pollingDisposePromise = resolved;
      return resolved;
    }

    void rawCall.catch(() => {});
    const tracked = rawCall.then(() => {
      if (targetName === 'controller') {
        disposed = true;
        if (returned) lateSettlement.lateDisposedController = true;
      }
      if (targetName === 'polling') {
        pollingDisposed = true;
        if (returned) lateSettlement.lateDisposedPolling = true;
      }
    }, asyncError => {
      const entry = toErrorRecord(targetName, atPhase, asyncError, false);
      if (returned) lateSettlement.lateDisposeErrors.push(entry);
      else disposeErrorsAtReturn.push(entry);
    });
    if (targetName === 'controller') controllerDisposePromise = tracked;
    if (targetName === 'polling') pollingDisposePromise = tracked;
    return tracked;
  };

  const timeoutError = () => {
    if (!logicalExpired && (!remaining() || elapsedNow() >= LOGICAL_CUTOFF_MS)) {
      markExpired('node-cutoff-check', elapsedNow());
    }
    const error = new Error('Waiting failed: 4000ms integral scroll deadline exceeded');
    error.name = 'TimeoutError';
    return error;
  };

  let timer;
  let rejectExpired;
  const expired = new Promise((_, reject) => {
    rejectExpired = reject;
    timer = setTimeout(() => {
      const firedAt = elapsedNow();
      timerFiredAtMs = firedAt;
      timerDriftMs = firedAt - LOGICAL_CUTOFF_MS;
      timerDelayMs = Math.max(0, timerDriftMs);
      markExpired('node-timer', firedAt);
      reject(timeoutError());
    }, remaining());
  });
  void expired.catch(() => {});

  const run = async (label, task) => {
    if (finished || logicalExpired || !remaining()) throw timeoutError();
    phase = label;
    const work = Promise.resolve().then(() => {
      if (finished || logicalExpired || !remaining()) throw timeoutError();
      return task(remaining());
    });
    void work.catch(() => {});
    if (label === 'prepare') {
      activePreparePromise = work;
      prepareSettled = false;
      void work.then(() => { prepareSettled = true; }, () => { prepareSettled = true; });
    } else if (label === 'geometry') {
      activeGeometryPromise = work;
      geometrySettled = false;
      void work.then(() => { geometrySettled = true; }, () => { geometrySettled = true; });
    } else if (label === 'polling') {
      activePollingPromise = work;
      pollingSettled = false;
      void work.then(() => { pollingSettled = true; }, () => { pollingSettled = true; });
    } else if (label === 'diagnostic') {
      activeDiagnosticPromise = work;
      diagnosticSettled = false;
      void work.then(() => { diagnosticSettled = true; }, () => { diagnosticSettled = true; });
    } else if (label === 'cleanup') {
      activeCleanupPromise = work;
      cleanupSettled = false;
      void work.then(() => { cleanupSettled = true; }, () => { cleanupSettled = true; });
    }
    return Promise.race([work, expired]);
  };

  try {
    // Read-only calibration. A delayed result cannot mutate the document.
    const clock = await run('clock', () => page.evaluate(() => ({ now: performance.now(), timeOrigin: performance.timeOrigin })));
    if (!Number.isFinite(clock?.now) || !Number.isFinite(clock?.timeOrigin)) throw new Error('Invalid renderer monotonic clock');
    // Subtract the completed round-trip conservatively: never grant the
    // renderer a later deadline. The 64ms reserve belongs to the SAME 4000ms
    // budget: 32ms for cleanup, 32ms with no permitted page mutations before
    // reporting/disposal (with 24ms Node logical cutoff reserve at 3976ms).
    const remainingBudget = Math.max(0, started + DEADLINE_MS - performance.now());
    const finalAt = clock.timeOrigin + clock.now + remainingBudget;
    limits = { finalAt, expiresAt: finalAt - 64, cleanupUntil: finalAt - 32, timeoutMs: DEADLINE_MS };

    controller = await run('prepare', () => page.evaluateHandle(installScrollController, selector, limits));
    await run('geometry', () => controller.evaluate((state, lease) => {
      if (performance.timeOrigin + performance.now() >= lease.expiresAt) return false;
      return state.sample(true);
    }, limits));
    pollingResult = await run('polling', left => page.waitForFunction((state, lease) => {
      if (performance.timeOrigin + performance.now() >= lease.expiresAt) return true;
      return state.sample();
    }, { polling: 'raf', timeout: Math.max(1, Math.floor(left)) }, controller, limits));

    if (pollingResult?.dispose) {
      await run('polling-dispose', () => invokeDispose('polling', pollingResult, 'polling-dispose'));
    }
    if (pollingDisposed || disposeErrorsAtReturn.some(e => e.target === 'polling')) {
      pollingResult = undefined;
    }

    snapshot = await run('diagnostic', () => controller.evaluate(state => state.inspect()));
    lastDiagnostic = snapshot.diagnostic || lastDiagnostic;
    if (snapshot.outcome === 'unsupported') {
      const error = new Error('Unsupported scroll case: ' + (snapshot.diagnostic?.unsupported || snapshot.diagnostic?.reason));
      error.name = 'UnsupportedScrollError';
      error.interaction = snapshot.diagnostic;
      throw error;
    }
    if (snapshot.outcome === 'timeout') {
      markExpired('renderer-lease', elapsedNow());
      failure = timeoutError();
    } else if (snapshot.outcome !== 'ready') {
      failure = timeoutError();
    }
  } catch (error) {
    failure = error;
    if (!snapshot && controller && remaining() && !logicalExpired) {
      try {
        snapshot = await run('diagnostic', () => controller.evaluate(state => state.inspect()));
        lastDiagnostic = snapshot.diagnostic || lastDiagnostic;
        if (snapshot.outcome === 'timeout') {
          markExpired('renderer-lease', elapsedNow());
        }
      } catch (diagnosticError) {
        if (diagnosticError.name === 'TimeoutError' && failure.name === 'TimeoutError') {
          failure = diagnosticError;
        }
      }
    }
    if (failure?.name === 'TimeoutError') failure = timeoutError();
  }

  try {
    if (controller && remaining() && !logicalExpired) {
      const requireReady = !failure && snapshot?.outcome === 'ready';
      try {
        const cleanup = await run('cleanup', () => controller.evaluate((state, lease, verify) => {
          if (performance.timeOrigin + performance.now() >= lease.cleanupUntil) {
            return { cleanupConfirmed: false, ready: false, closed: true, partial: true };
          }
          return state.cleanup(verify);
        }, limits, requireReady));
        cleanupConfirmed = cleanup?.cleanupConfirmed === true;
        if (cleanup?.diagnostic) lastDiagnostic = cleanup.diagnostic;
        if (requireReady && cleanup?.ready !== true) {
          const refused = new Error('Scroll state changed before cleanup; interaction refused');
          refused.name = 'InteractionRefusedError';
          refused.interaction = lastDiagnostic;
          failure = refused;
        }
      } catch (cleanupError) {
        recordCleanupError('cleanup', cleanupError);
        if (!failure || failure.name === 'TimeoutError') {
          failure = cleanupError;
        }
      }
    }

    if (pollingResult?.dispose && remaining() && !logicalExpired) {
      try {
        await run('polling-dispose', () => invokeDispose('polling', pollingResult, 'cleanup-polling-dispose'));
      } catch (disposeRunErr) {
        if (!failure && disposeRunErr?.name === 'TimeoutError') failure = disposeRunErr;
      }
    }

    if (controller && remaining() && !logicalExpired) {
      try {
        await run('dispose', () => invokeDispose('controller', controller, 'dispose'));
      } catch (disposeRunErr) {
        if (!failure && disposeRunErr?.name === 'TimeoutError') failure = disposeRunErr;
      }
    }

    // Without an acknowledged close, do not return early while a renderer
    // command can still hold a valid lease. Its expiry is within this budget.
    if (remaining() && !logicalExpired && (failure?.name === 'TimeoutError' || (limits && !cleanupConfirmed))) {
      try {
        await expired;
      } catch (expiryError) {
        if (!failure || failure.name === 'TimeoutError') failure = expiryError;
      }
    }

    if (!failure && (!cleanupConfirmed || !disposed || (pollingResult && !pollingDisposed) || disposeErrorsAtReturn.length > 0)) {
      const refused = new Error('Scroll cleanup/disposal not confirmed; interaction refused');
      refused.name = 'InteractionRefusedError';
      refused.interaction = lastDiagnostic;
      failure = refused;
    }
  } catch (unexpectedError) {
    if (!failure || failure.name === 'TimeoutError') failure = unexpectedError;
  } finally {
    finished = true;
    clearTimeout(timer);
  }

  // Ensure expiration state is recorded whenever cutoff was reached/crossed,
  // including non-timeout failures settling after 3976ms.
  if (!logicalExpired && (!remaining() || elapsedNow() >= LOGICAL_CUTOFF_MS)) {
    markExpired('node-cutoff-check', elapsedNow());
  }

  // Preserve real non-timeout primary failures; only synthesize TimeoutError
  // if there is no failure or the failure itself was TimeoutError.
  if (logicalExpired && (!failure || failure.name === 'TimeoutError')) {
    failure = timeoutError();
  }

  // Trigger non-blocking disposal of any remaining handles or pending protocol
  // promises when returning on failure/expiration so nothing leaks or emits
  // unhandled rejections, and track any pending late disposals explicitly.
  const pendingResources = [];
  if (failure || logicalExpired) {
    if (activePreparePromise && !prepareSettled) {
      pendingResources.push('prepare-controller-promise');
      const task = activePreparePromise.then(
        lateCtrl => invokeDispose('controller', lateCtrl, 'late-prepare-settle'),
        () => {}
      );
      void task.catch(() => {});
      lateTasks.push(task);
    } else if (controller && !controllerDisposeStarted) {
      const p = invokeDispose('controller', controller, 'at-return-controller-dispose');
      if (!disposed && !disposeErrorsAtReturn.some(e => e.target === 'controller')) {
        pendingResources.push('controller-dispose-promise');
        lateTasks.push(p);
      }
    } else if (controller && controllerDisposeStarted && !disposed && !disposeErrorsAtReturn.some(e => e.target === 'controller') && controllerDisposePromise) {
      pendingResources.push('controller-dispose-promise');
      lateTasks.push(controllerDisposePromise);
    }

    if (activePollingPromise && !pollingSettled) {
      pendingResources.push('polling-handle-promise');
      const task = activePollingPromise.then(
        latePoll => invokeDispose('polling', latePoll, 'late-polling-settle'),
        () => {}
      );
      void task.catch(() => {});
      lateTasks.push(task);
    } else if (pollingResult && !pollingDisposeStarted) {
      const p = invokeDispose('polling', pollingResult, 'at-return-polling-dispose');
      if (!pollingDisposed && !disposeErrorsAtReturn.some(e => e.target === 'polling')) {
        pendingResources.push('polling-dispose-promise');
        lateTasks.push(p);
      }
    } else if (pollingResult && pollingDisposeStarted && !pollingDisposed && !disposeErrorsAtReturn.some(e => e.target === 'polling') && pollingDisposePromise) {
      pendingResources.push('polling-dispose-promise');
      lateTasks.push(pollingDisposePromise);
    }

    if (activeCleanupPromise && !cleanupSettled) {
      pendingResources.push('cleanup-evaluate-promise');
      const task = activeCleanupPromise.then(() => {}, err => {
        if (err?.name !== 'TimeoutError') recordCleanupError('late-cleanup-settle', err);
      });
      void task.catch(() => {});
      lateTasks.push(task);
    }
    if (activeGeometryPromise && !geometrySettled) {
      const task = activeGeometryPromise.then(() => {}, () => {});
      void task.catch(() => {});
      lateTasks.push(task);
    }
    if (activeDiagnosticPromise && !diagnosticSettled) {
      const task = activeDiagnosticPromise.then(() => {}, () => {});
      void task.catch(() => {});
      lateTasks.push(task);
    }
  }

  returned = true;
  const physicalReturnedAtMs = elapsedNow();
  const returnDelayMs = logicalExpiredAtMs !== null ? Math.max(0, physicalReturnedAtMs - logicalExpiredAtMs) : null;
  const cutoffOvershootMs = Math.max(0, physicalReturnedAtMs - LOGICAL_CUTOFF_MS);
  const deadlineOvershootMs = Math.max(0, physicalReturnedAtMs - DEADLINE_MS);
  const inertResources = computeInertResources();
  const hasPendingLateDisposal = lateTasks.length > 0;

  let lateSettledPromise;
  if (!hasPendingLateDisposal) {
    lateSettlement.scope = 'final-at-return';
    lateSettlement.pending = false;
    lateSettlement.settledAtMs = physicalReturnedAtMs;
    lateSettlement.finalResources = {
      cleanupConfirmed,
      controllerDisposed: disposed,
      pollingDisposed,
      inertResources: [...inertResources],
      allDisposeErrors: [...disposeErrorsAtReturn],
      allCleanupErrors: [...cleanupErrorsAtReturn]
    };
    lateSettledPromise = Promise.resolve(lateSettlement);
  } else {
    lateSettlement.scope = 'pending';
    lateSettlement.pending = true;
    lateSettledPromise = Promise.allSettled(lateTasks).then(() => {
      lateSettlement.scope = 'final-settled';
      lateSettlement.pending = false;
      lateSettlement.settledAtMs = elapsedNow();
      lateSettlement.finalResources = {
        cleanupConfirmed,
        controllerDisposed: disposed,
        pollingDisposed,
        inertResources: computeInertResources(),
        allDisposeErrors: [...disposeErrorsAtReturn, ...lateSettlement.lateDisposeErrors],
        allCleanupErrors: [...cleanupErrorsAtReturn, ...lateSettlement.lateCleanupErrors]
      };
      return lateSettlement;
    });
    void lateSettledPromise.catch(() => {});
  }
  Object.defineProperty(lateSettlement, 'settled', {
    value: lateSettledPromise,
    enumerable: false,
    configurable: true
  });

  if (failure) {
    const baseDiagnostic = (failure.interaction && typeof failure.interaction === 'object')
      ? failure.interaction
      : lastDiagnostic;
    const metricsPayload = {
      phase,
      metricsSnapshotScope: hasPendingLateDisposal ? 'partial-at-return' : 'final-at-return',
      metricsPartialAtReturn: hasPendingLateDisposal,
      deadlineMs: DEADLINE_MS,
      logicalCutoffMs: LOGICAL_CUTOFF_MS,
      logicalExpired,
      expirationSource,
      logicalExpiredAtMs,
      timerFiredAtMs,
      timerDelayMs,
      timerDriftMs,
      physicalReturnedAtMs,
      physicalElapsedMs: physicalReturnedAtMs,
      elapsedMs: physicalReturnedAtMs,
      returnDelayMs,
      cutoffOvershootMs,
      deadlineOvershootMs,
      cleanupConfirmed,
      disposed,
      pollingDisposed,
      lateDisposalPending: hasPendingLateDisposal,
      pendingResources,
      inertResources,
      disposeErrorsAtReturn: [...disposeErrorsAtReturn],
      cleanupErrorsAtReturn: [...cleanupErrorsAtReturn],
      disposeErrors: [...disposeErrorsAtReturn],
      cleanupErrors: [...cleanupErrorsAtReturn],
      lateSettlement,
      safety: 'No click is performed by this helper.'
    };
    if (typeof failure === 'object' && failure !== null) {
      failure.interaction = { ...baseDiagnostic, ...metricsPayload };
    }
    throw failure;
  }
}

// Serialized as a single renderer function: no closure, dependency or URL.
function installScrollController(selector, lease) {
  const now = () => performance.timeOrigin + performance.now();
  const near = (a, b, tolerance = 1) => !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < tolerance);
  const expired = () => now() >= lease.expiresAt;
  if (expired()) return {
    sample: () => true,
    inspect: () => ({ outcome: 'timeout', diagnostic: { reason: 'expired-before-prepare' }, cleanupConfirmed: true, closed: true, partial: false, inertResources: [] }),
    cleanup: () => ({ cleanupConfirmed: true, ready: false, closed: true, partial: false, inertResources: [], diagnostic: { reason: 'expired-before-prepare' } })
  };
  const element = document.querySelector(selector), root = document.scrollingElement;
  if (!element || !root) throw new Error('Alvo de rolagem ausente: ' + selector);
  const sides = ['Top', 'Right', 'Bottom', 'Left'], options = { block: 'center', inline: 'nearest' };
  let reference, referenceRemoved = false, expiryTimer, records = [], geometry, previous, stableFrames = 0, requests = 0, revision = 0;
  let closed = false, cleanupConfirmed = false, closeReady = false, outcome = 'waiting', diagnostic = { reason: 'preparing' };
  let partialCleanupResult = null;
  let verifyBeforeClose = () => false;
  const position = node => [node.scrollLeft, node.scrollTop];
  const label = node => node === root ? 'document' : (node.tagName || 'element').toLowerCase() + (node.id ? '#' + node.id : '');
  const computeInertResources = () => {
    const resources = [];
    if (reference && !referenceRemoved) resources.push('reference-iframe');
    for (const record of records) {
      if (!record.cleaned) {
        resources.push('scroll-listeners:' + record.id);
        if (requests > 0 || record.requiresEnd) resources.push('pending-scroll:' + record.id);
      }
    }
    return resources;
  };
  const describe = (reason, unsupported) => {
    const scrollers = records.map(record => {
      const actual = position(record.node);
      return { id: record.id, position: actual, destination: record.destination,
        max: [record.node.scrollWidth - record.node.clientWidth, record.node.scrollHeight - record.node.clientHeight],
        atDestination: near(actual, record.destination), nativeEnd: record.nativeEnd, requiresEnd: record.requiresEnd,
        nativeReceived: !!record.end && near(actual, record.end.position), lastScrollTime: record.lastScrollTime,
        requestTime: record.requestTime, endTime: record.end?.time };
    });
    diagnostic = { reason, connected: element.isConnected && document.querySelector(selector) === element,
      position: position(root), destination: records[0]?.destination, atDestination: scrollers.every(s => s.atDestination),
      stableFrames, nativeEnd: records.some(r => r.nativeEnd), requiresEnd: records.some(r => r.requiresEnd),
      nativeReceived: records.filter(r => r.requiresEnd).every(r => !!r.end && near(position(r.node), r.end.position)),
      requests, revision, scrollers, ...(unsupported ? { unsupported } : {}) };
    return false;
  };
  const freezePartial = () => {
    closed = true;
    clearTimeout(expiryTimer);
    const inertResources = computeInertResources();
    partialCleanupResult = {
      cleanupConfirmed: false,
      ready: false,
      closed: true,
      partial: true,
      inertResources,
      diagnostic
    };
    return { ...partialCleanupResult, inertResources: [...inertResources] };
  };
  const cleanup = (requireReady = false) => {
    if (cleanupConfirmed) return { cleanupConfirmed: true, ready: closeReady, closed: true, partial: false, inertResources: [], diagnostic };
    if (partialCleanupResult) return { ...partialCleanupResult, inertResources: [...partialCleanupResult.inertResources] };
    // A queued, non-cancellable protocol command never changes the page after
    // the lease. A frozen renderer may leave resources behind as inert; that
    // is NOT a successful interaction or confirmed cleanup.
    if (now() >= lease.cleanupUntil) return freezePartial();
    if (requireReady) {
      try { closeReady = !expired() && outcome === 'ready' && verifyBeforeClose(); } catch { closeReady = false; }
      if (!closeReady) describe('changed-before-cleanup');
    }
    closed = true; clearTimeout(expiryTimer);
    for (const record of records) {
      if (record.cleaned) continue;
      if (now() >= lease.cleanupUntil) return freezePartial();
      // Abort an outstanding animation at its CURRENT position on failure;
      // never teleport to the expected destination to manufacture success.
      if (!closeReady && requests) record.node.scrollTo({ left: record.node.scrollLeft, top: record.node.scrollTop, behavior: 'instant' });
      record.events.removeEventListener('scroll', record.track, true);
      if (record.nativeEnd) record.events.removeEventListener('scrollend', record.finish, true);
      record.cleaned = true;
    }
    if (now() >= lease.cleanupUntil) return freezePartial();
    reference?.remove();
    referenceRemoved = true;
    cleanupConfirmed = true;
    return { cleanupConfirmed: true, ready: closeReady, closed: true, partial: false, inertResources: [], diagnostic };
  };
  const expire = () => {
    if (closed) return;
    outcome = 'timeout';
    cleanup(false);
  };
  expiryTimer = setTimeout(expire, Math.max(0, lease.expiresAt - now()));
  const unsupported = cause => { const error = new Error(cause); error.name = 'UnsupportedScrollError'; throw error; };
  const active = () => !closed && !expired();
  const readGeometry = () => {
    if (document.compatMode && document.compatMode !== 'CSS1Compat') unsupported('quirks-mode');
    const vv = globalThis.visualViewport;
    if (vv && (vv.scale !== 1 || vv.offsetLeft !== 0 || vv.offsetTop !== 0)) unsupported('visual-viewport zoom/offset');
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) {
      if (ancestors.length >= 128) unsupported('ancestor chain exceeds 128 elements');
      const s = getComputedStyle(node);
      if (s.direction !== 'ltr' || s.writingMode !== 'horizontal-tb') unsupported('direction/writing-mode at ' + label(node));
      for (const property of ['transform', 'perspective', 'translate', 'rotate', 'scale', 'filter', 'clipPath']) {
        if (s[property] && s[property] !== 'none') unsupported(property + ' at ' + label(node));
      }
      if (s.zoom && !['1', 'normal'].includes(s.zoom)) unsupported('zoom at ' + label(node));
      if (['fixed', 'sticky'].includes(s.position)) unsupported('fixed/sticky at ' + label(node));
      if (s.scrollSnapType && s.scrollSnapType !== 'none') unsupported('scroll-snap at ' + label(node));
      if ([s.overflowX, s.overflowY].includes('clip')) unsupported('overflow:clip at ' + label(node));
      if (node !== element) ancestors.push(node);
      if (node === root) break;
    }
    if (element !== root && !ancestors.includes(root)) unsupported('shadow/disconnected ancestor chain');
    const scrollValues = ['auto', 'scroll', 'hidden', 'overlay'];
    const chain = ancestors.reverse().filter(node => node === root || [getComputedStyle(node).overflowX, getComputedStyle(node).overflowY].some(v => scrollValues.includes(v)));
    if (chain[0] !== root) unsupported('target is the document scroller');
    if (document.body && root !== document.body && chain.includes(document.body)) unsupported('body-overflow propagation');
    const numeric = [innerWidth, innerHeight], styles = [], containers = [];
    const local = (box, parent) => {
      if (parent === root) return [root.scrollLeft + box.left, root.scrollTop + box.top];
      const p = parent.getBoundingClientRect();
      return [parent.scrollLeft + box.left - p.left - parent.clientLeft, parent.scrollTop + box.top - p.top - parent.clientTop];
    };
    for (const node of chain) {
      const box = node.getBoundingClientRect(), s = getComputedStyle(node), parent = containers.at(-1)?.node;
      const origin = node === root ? [0, 0] : local(box, parent);
      const item = { node, origin, width: node === root ? innerWidth : box.width, height: node === root ? innerHeight : box.height,
        client: [node.clientWidth, node.clientHeight], extent: [node.scrollWidth, node.scrollHeight],
        borders: sides.map(side => s['border' + side + 'Width']), paddings: sides.map(side => s['scrollPadding' + side]),
        margins: sides.map(side => s['scrollMargin' + side]),
        overflow: [s.overflowX, s.overflowY], scrollbar: [s.scrollbarWidth, s.scrollbarGutter] };
      containers.push(item);
      numeric.push(...origin, item.width, item.height, ...item.client, ...item.extent, node.clientLeft, node.clientTop);
      styles.push(...item.borders, ...item.paddings, ...item.margins, ...item.overflow, ...item.scrollbar);
    }
    const box = element.getBoundingClientRect(), targetStyle = getComputedStyle(element);
    const target = { origin: local(box, chain.at(-1)), width: box.width, height: box.height, margins: sides.map(side => targetStyle['scrollMargin' + side]) };
    numeric.push(...target.origin, target.width, target.height); styles.push(...target.margins);
    if (!numeric.every(Number.isFinite)) unsupported('non-finite geometry');
    return { containers, target, numeric, styles, layout: target.width > 0 && target.height > 0 && containers.every(c => c.client.every(n => n > 0)) };
  };
  const sameGeometry = (a, b) => a && b && a.containers.length === b.containers.length &&
    a.containers.every((c, i) => c.node === b.containers[i].node) && near(a.numeric, b.numeric, 0.01) &&
    a.styles.length === b.styles.length && a.styles.every((v, i) => v === b.styles[i]);
  const updateChain = next => {
    const nodes = next.containers.map(c => c.node);
    for (const old of records) if (!nodes.includes(old.node)) {
      if (!active()) return;
      old.node.scrollTo({ left: old.node.scrollLeft, top: old.node.scrollTop, behavior: 'instant' });
      old.events.removeEventListener('scroll', old.track, true);
      if (old.nativeEnd) old.events.removeEventListener('scrollend', old.finish, true);
      old.cleaned = true;
    }
    records = nodes.map(node => {
      const existing = records.find(r => r.node === node); if (existing) return existing;
      const events = node === root ? document : node;
      const record = { node, events, id: label(node), origin: position(node), destination: null, cleaned: false,
        nativeEnd: 'onscrollend' in events, requiresEnd: false, end: null, requestTime: Infinity, lastScrollTime: -Infinity };
      const owns = event => event.target === node || node === root && event.target === document;
      record.track = event => {
        if (!active() || !owns(event)) return;
        if (!near(position(node), record.origin)) record.requiresEnd = true;
        record.lastScrollTime = event.timeStamp; record.end = null;
      };
      record.finish = event => {
        if (active() && owns(event) && event.isTrusted && event.timeStamp >= record.requestTime && event.timeStamp >= record.lastScrollTime) {
          record.end = { position: position(node), time: event.timeStamp };
        }
      };
      events.addEventListener('scroll', record.track, true);
      if (record.nativeEnd) events.addEventListener('scrollend', record.finish, true);
      return record;
    });
  };
  const project = next => {
    if (!active()) return null;
    if (!reference) {
      reference = document.createElement('iframe');
      reference.setAttribute('aria-hidden', 'true'); reference.setAttribute('data-forja-scroll-reference', '');
      reference.setAttribute('sandbox', 'allow-same-origin'); reference.tabIndex = -1; reference.inert = true;
      reference.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;border:0!important;margin:0!important;padding:0!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;z-index:-2147483648!important;';
      if (!active()) { reference = null; return null; }
      document.documentElement.appendChild(reference);
      referenceRemoved = false;
    }
    if (!active()) return null;
    reference.style.setProperty('width', innerWidth + 'px', 'important'); reference.style.setProperty('height', innerHeight + 'px', 'important');
    const doc = reference.contentDocument;
    if (!doc) unsupported('reference document unavailable');
    if (!active()) return null;
    doc.open(); doc.write('<!doctype html><html><head></head><body></body></html>'); doc.close();
    doc.body.style.cssText = 'margin:0;padding:0;border:0;width:0;height:0;'; doc.body.replaceChildren();
    const viewport = doc.documentElement, clones = [];
    viewport.style.cssText = 'margin:0;padding:0;border:0;scroll-behavior:auto;overflow-anchor:none;';
    let parent = doc.body;
    for (let i = 0; i < next.containers.length; i++) {
      if (!active()) return null;
      const c = next.containers[i], clone = i === 0 ? viewport : doc.createElement('div');
      if (i !== 0) {
        clone.style.cssText = 'position:absolute;box-sizing:border-box;margin:0;padding:0;border-style:solid;border-color:transparent;scroll-behavior:auto;overflow-anchor:none;';
        clone.style.left = c.origin[0] + 'px'; clone.style.top = c.origin[1] + 'px'; clone.style.width = c.width + 'px'; clone.style.height = c.height + 'px';
        sides.forEach((side, j) => { clone.style['border' + side + 'Width'] = c.borders[j]; });
        parent.appendChild(clone);
      }
      clone.style.overflowX = c.overflow[0]; clone.style.overflowY = c.overflow[1];
      clone.style.scrollbarWidth = c.scrollbar[0]; clone.style.scrollbarGutter = c.scrollbar[1];
      sides.forEach((side, j) => { clone.style['scrollPadding' + side] = c.paddings[j]; clone.style['scrollMargin' + side] = c.margins[j]; });
      const extent = doc.createElement('div');
      extent.style.cssText = 'position:absolute;left:0;top:0;margin:0;padding:0;border:0;'; extent.style.width = c.extent[0] + 'px'; extent.style.height = c.extent[1] + 'px';
      (i === 0 ? doc.body : clone).appendChild(extent); clones.push(clone); parent = i === 0 ? doc.body : clone;
    }
    if (!active()) return null;
    const target = doc.createElement('div'), t = next.target;
    target.style.cssText = 'position:absolute;box-sizing:border-box;margin:0;padding:0;border:0;';
    target.style.left = t.origin[0] + 'px'; target.style.top = t.origin[1] + 'px'; target.style.width = t.width + 'px'; target.style.height = t.height + 'px';
    sides.forEach((side, i) => { target.style['scrollMargin' + side] = t.margins[i]; }); parent.appendChild(target);
    const verify = () => clones.forEach((clone, i) => {
      const c = next.containers[i];
      if (!near([clone.clientWidth, clone.clientHeight], c.client, 0.01) || !near([clone.scrollWidth, clone.scrollHeight], c.extent, 0.01)) unsupported('reference dimensions/range mismatch at ' + label(c.node));
    });
    verify();
    clones.forEach((clone, i) => {
      const [left, top] = records[i].origin;
      if (i === 0) reference.contentWindow.scrollTo({ left, top, behavior: 'instant' });
      else clone.scrollTo({ left, top, behavior: 'instant' });
    });
    if (!active()) return null;
    target.scrollIntoView({ ...options, behavior: 'instant' }); verify();
    return clones.map(clone => position(clone));
  };
  const request = next => {
    updateChain(next); revision++; previous = undefined; stableFrames = 0;
    for (const record of records) record.origin = position(record.node);
    const destinations = next.layout ? project(next) : null;
    if (!active()) return;
    for (let i = 0; i < records.length; i++) {
      const r = records[i]; r.destination = destinations?.[i] || null;
      const willMove = !!r.destination && !near(position(r.node), r.destination);
      if (willMove || !Number.isFinite(r.requestTime)) {
        r.requiresEnd = willMove; r.end = null; r.lastScrollTime = -Infinity; r.requestTime = performance.now();
      }
      // A geometry-only retarget must not waive a still-undelivered end from
      // a container already at destination. Keep that request's timestamp
      // and evidence when the native re-request needs no new movement.
    }
    // All actual scroll requests are guarded. Oracle operations affect only
    // the inert reference; the application's scroll is always native.
    if (!active()) return;
    requests++; element.scrollIntoView(options);
  };
  const visualReason = box => {
    if (element.matches(':disabled')) return 'disabled';
    if (element.closest('[inert]')) return 'inert';
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const s = getComputedStyle(ancestor);
      if (s.display === 'none') return 'display-none'; if (Number(s.opacity) === 0) return 'opacity'; if (s.contentVisibility === 'hidden') return 'content-visibility';
    }
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible') return 'visibility'; if (style.pointerEvents === 'none') return 'pointer-events';
    if (element.checkVisibility && !element.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })) return 'visibility';
    if (box.width <= 0 || box.height <= 0) return 'empty-box';
    if (box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight) return 'viewport';
    for (const r of records.slice(1)) {
      const b = r.node.getBoundingClientRect(), left = b.left + r.node.clientLeft, top = b.top + r.node.clientTop;
      if (box.left < left || box.top < top || box.right > left + r.node.clientWidth || box.bottom > top + r.node.clientHeight) return 'clipped';
    }
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (hit !== element && !element.contains(hit)) return 'covered';
    return null;
  };
  // Re-read without retargeting before the final close. A stale successful
  // polling result is not permission to click after geometry/chain changed.
  verifyBeforeClose = () => {
    if (!element.isConnected || document.querySelector(selector) !== element || stableFrames < 2) return false;
    const next = readGeometry(), box = element.getBoundingClientRect();
    const current = [...records.flatMap(r => position(r.node)), box.left, box.top, box.width, box.height, ...next.numeric];
    return sameGeometry(geometry, next) && previous?.every((v, i) => v === current[i]) &&
      records.every(r => near(position(r.node), r.destination) && (!r.nativeEnd || !r.requiresEnd || r.end && near(position(r.node), r.end.position))) && !visualReason(box);
  };
  const sample = () => {
    if (closed) return true;
    if (expired()) { expire(); return true; }
    if (!element.isConnected || document.querySelector(selector) !== element) return describe('detached');
    try {
      const next = readGeometry();
      if (!sameGeometry(geometry, next)) { geometry = next; request(next); }
      if (!active()) { expire(); return true; }
      const box = element.getBoundingClientRect();
      const current = [...records.flatMap(r => position(r.node)), box.left, box.top, box.width, box.height, ...next.numeric];
      const same = previous && previous.every((v, i) => v === current[i]); previous = current;
      if (!records.every(r => near(position(r.node), r.destination))) { stableFrames = 0; return describe('destination'); }
      stableFrames = same ? stableFrames + 1 : 0;
      if (stableFrames < 2) return describe('unstable');
      if (records.some(r => r.nativeEnd && r.requiresEnd && (!r.end || !near(position(r.node), r.end.position)))) return describe('native-scrollend');
      const reason = visualReason(box); if (reason) return describe(reason);
      describe('ready'); outcome = 'ready'; return true;
    } catch (error) {
      if (error.name !== 'UnsupportedScrollError') throw error;
      describe('unsupported', error.message); outcome = 'unsupported'; cleanup(); return true;
    }
  };
  const state = {
    sample,
    cleanup,
    inspect: () => ({
      outcome,
      diagnostic,
      cleanupConfirmed,
      closed,
      partial: !!partialCleanupResult,
      inertResources: partialCleanupResult ? [...partialCleanupResult.inertResources] : []
    })
  };
  // Install listeners and issue the request in the same lease-guarded turn.
  try {
    geometry = readGeometry();
    request(geometry);
    if (!active()) expire();
    else describe('destination');
  } catch (error) {
    if (error.name === 'UnsupportedScrollError') { outcome = 'unsupported'; describe('unsupported', error.message); cleanup(); }
    else { cleanup(); throw error; }
  }
  return state;
}
