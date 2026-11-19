/* E2E only. One Node monotonic budget covers every protocol await.
   Renderer commands also carry an expiring lease, so a queued command cannot
   start a scroll or install a reference after the operation has expired. */
export async function scrollToInteractable(page, selector) {
  const started = performance.now(), deadline = started + 4000;
  let phase = 'clock', controller, pollingResult, limits, snapshot, failure, finished = false;
  let cleanupConfirmed = false, disposed = false, lastDiagnostic = { reason: 'deadline' };
  const remaining = () => Math.max(0, deadline - performance.now());
  const timeout = () => {
    const error = new Error('Waiting failed: 4000ms integral scroll deadline exceeded');
    error.name = 'TimeoutError';
    error.interaction = { ...lastDiagnostic, phase, deadlineMs: 4000, elapsedMs: performance.now() - started,
      cleanupConfirmed, disposed, safety: 'No click is performed by this helper.' };
    return error;
  };
  let timer;
  const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(timeout()), remaining()); });
  void expired.catch(() => {});
  const run = async (label, task) => {
    if (finished || !remaining()) throw timeout();
    phase = label;
    const work = Promise.resolve().then(() => {
      if (finished || !remaining()) throw timeout();
      return task(remaining());
    });
    return Promise.race([work, expired]);
  };
  try {
    // Read-only calibration. A delayed result cannot mutate the document.
    const clock = await run('clock', () => page.evaluate(() => ({ now: performance.now(), timeOrigin: performance.timeOrigin })));
    if (!Number.isFinite(clock?.now) || !Number.isFinite(clock?.timeOrigin)) throw new Error('Invalid renderer monotonic clock');
    // Subtract the completed round-trip conservatively: never grant the
    // renderer a later deadline. The 64ms reserve belongs to the SAME 4000ms
    // budget: 32ms for cleanup, 32ms with no permitted page mutations before
    // reporting/disposal. It is neither an extra timeout nor a sleep.
    const finalAt = clock.timeOrigin + clock.now + remaining();
    limits = { finalAt, expiresAt: finalAt - 64, cleanupUntil: finalAt - 32, timeoutMs: 4000 };
    controller = await run('prepare', () => page.evaluateHandle(installScrollController, selector, limits));
    await run('geometry', () => controller.evaluate((state, lease) => {
      if (performance.timeOrigin + performance.now() >= lease.expiresAt) return false;
      return state.sample(true);
    }, limits));
    pollingResult = await run('polling', left => page.waitForFunction((state, lease) => {
      if (performance.timeOrigin + performance.now() >= lease.expiresAt) return true;
      return state.sample();
    }, { polling: 'raf', timeout: Math.max(1, Math.floor(left)) }, controller, limits));
    if (pollingResult?.dispose) await run('polling-dispose', () => pollingResult.dispose());
    pollingResult = undefined;
    snapshot = await run('diagnostic', () => controller.evaluate(state => state.inspect()));
    lastDiagnostic = snapshot.diagnostic || lastDiagnostic;
    if (snapshot.outcome === 'unsupported') {
      const error = new Error('Unsupported scroll case: ' + (snapshot.diagnostic?.unsupported || snapshot.diagnostic?.reason));
      error.name = 'UnsupportedScrollError'; error.interaction = snapshot.diagnostic; throw error;
    }
    if (snapshot.outcome !== 'ready') failure = timeout();
  } catch (error) {
    failure = error;
    if (!snapshot && controller && remaining()) {
      try {
        snapshot = await run('diagnostic', () => controller.evaluate(state => state.inspect()));
        lastDiagnostic = snapshot.diagnostic || lastDiagnostic;
      } catch (diagnosticError) { if (diagnosticError.name === 'TimeoutError') failure = diagnosticError; }
    }
    if (failure.name === 'TimeoutError') failure = timeout();
  }
  try {
    if (controller && remaining()) {
      const requireReady = !failure && snapshot?.outcome === 'ready';
      const cleanup = await run('cleanup', () => controller.evaluate((state, lease, verify) => {
        if (performance.timeOrigin + performance.now() >= lease.cleanupUntil) return { cleanupConfirmed: false };
        return state.cleanup(verify);
      }, limits, requireReady));
      cleanupConfirmed = cleanup?.cleanupConfirmed === true;
      if (cleanup?.diagnostic) lastDiagnostic = cleanup.diagnostic;
      if (requireReady && cleanup?.ready !== true) {
        failure = new Error('Scroll state changed before cleanup; interaction refused');
        failure.name = 'InteractionRefusedError'; failure.interaction = lastDiagnostic;
      }
    }
    if (pollingResult?.dispose && remaining()) await run('polling-dispose', () => pollingResult.dispose());
    if (controller && remaining()) { await run('dispose', () => controller.dispose()); disposed = true; }
    // Without an acknowledged close, do not return early while a renderer
    // command can still hold a valid lease. Its expiry is within this budget.
    if (remaining() && (failure?.name === 'TimeoutError' || limits && !cleanupConfirmed)) await expired;
    if (!failure && (!cleanupConfirmed || !disposed)) throw new Error('Scroll cleanup/disposal not confirmed; interaction refused');
  } catch (error) {
    failure = error;
    if (remaining() && limits && !cleanupConfirmed) {
      try { await expired; } catch (expiryError) { failure = expiryError; }
    }
  }
  finally { finished = true; clearTimeout(timer); }
  if (!remaining()) failure = timeout();
  if (failure) {
    if (failure.name === 'TimeoutError') failure = timeout();
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
    inspect: () => ({ outcome: 'timeout', diagnostic: { reason: 'expired-before-prepare' }, cleanupConfirmed: true }),
    cleanup: () => ({ cleanupConfirmed: true })
  };
  const element = document.querySelector(selector), root = document.scrollingElement;
  if (!element || !root) throw new Error('Alvo de rolagem ausente: ' + selector);
  const sides = ['Top', 'Right', 'Bottom', 'Left'], options = { block: 'center', inline: 'nearest' };
  let reference, expiryTimer, records = [], geometry, previous, stableFrames = 0, requests = 0, revision = 0;
  let closed = false, cleanupConfirmed = false, closeReady = false, outcome = 'waiting', diagnostic = { reason: 'preparing' };
  let verifyBeforeClose = () => false;
  const position = node => [node.scrollLeft, node.scrollTop];
  const label = node => node === root ? 'document' : (node.tagName || 'element').toLowerCase() + (node.id ? '#' + node.id : '');
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
  const cleanup = (requireReady = false) => {
    if (cleanupConfirmed) return { cleanupConfirmed: true, ready: closeReady, diagnostic };
    // A queued, non-cancellable protocol command never changes the page after
    // the lease. A frozen renderer may leave resources behind; that is NOT a
    // successful interaction or confirmed cleanup.
    if (now() >= lease.cleanupUntil) return { cleanupConfirmed: false, ready: false };
    if (requireReady) {
      try { closeReady = !expired() && outcome === 'ready' && verifyBeforeClose(); } catch { closeReady = false; }
      if (!closeReady) describe('changed-before-cleanup');
    }
    closed = true; clearTimeout(expiryTimer);
    for (const record of records) {
      if (now() >= lease.cleanupUntil) return { cleanupConfirmed: false, ready: false };
      // Abort an outstanding animation at its CURRENT position on failure;
      // never teleport to the expected destination to manufacture success.
      if (!closeReady && requests) record.node.scrollTo({ left: record.node.scrollLeft, top: record.node.scrollTop, behavior: 'instant' });
      record.events.removeEventListener('scroll', record.track, true);
      if (record.nativeEnd) record.events.removeEventListener('scrollend', record.finish, true);
    }
    if (now() >= lease.cleanupUntil) return { cleanupConfirmed: false, ready: false };
    reference?.remove(); cleanupConfirmed = true;
    return { cleanupConfirmed: true, ready: closeReady, diagnostic };
  };
  const expire = () => {
    if (closed || now() >= lease.cleanupUntil) return;
    outcome = 'timeout'; cleanup();
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
    }
    records = nodes.map(node => {
      const existing = records.find(r => r.node === node); if (existing) return existing;
      const events = node === root ? document : node;
      const record = { node, events, id: label(node), origin: position(node), destination: null,
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
      if (!active()) return null;
      document.documentElement.appendChild(reference);
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
  const state = { sample, cleanup, inspect: () => ({ outcome, diagnostic, cleanupConfirmed }) };
  // Install listeners and issue the request in the same lease-guarded turn.
  try { geometry = readGeometry(); request(geometry); describe('destination'); }
  catch (error) {
    if (error.name === 'UnsupportedScrollError') { outcome = 'unsupported'; describe('unsupported', error.message); cleanup(); }
    else { cleanup(); throw error; }
  }
  return state;
}
