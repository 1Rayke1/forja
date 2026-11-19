/* Deterministic CSSOM/event model, NOT a browser, native events or real input.
   The real helper's serialized functions run unchanged in a vm context.
   A small independent scrollIntoView model supplies the reference oracle;
   this cannot validate Chromium layout/CSSOM, SOP/CORS or trusted input. */
import vm from 'node:vm';
export class VirtualClock {
  now = 0; id = 0; timers = new Map();
  set = (fn, ms = 0) => { const id = ++this.id; this.timers.set(id, { at: this.now + Math.max(0, ms), fn }); return id; };
  clear = id => this.timers.delete(id);
  async flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
  async to(end) {
    await this.flush();
    for (;;) {
      const next = [...this.timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next; this.now = timer.at; this.timers.delete(id); timer.fn(); await this.flush();
    }
    this.now = end; await this.flush();
  }
}
const camel = key => key.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function style(initial = {}) {
  return new Proxy({ ...initial, setProperty(key, value) { this[camel(key)] = value; } }, {
    set(object, key, value) {
      if (key === 'cssText') {
        for (const k of Object.keys(object)) if (k !== 'setProperty') delete object[k];
        for (const declaration of value.split(';')) {
          const i = declaration.indexOf(':'); if (i >= 0) object[camel(declaration.slice(0, i))] = declaration.slice(i + 1).replace(/!important/g, '').trim();
        }
      } else object[key] = value;
      return true;
    }
  });
}
const defaults = { display: 'block', opacity: '1', visibility: 'visible', pointerEvents: 'auto', contentVisibility: 'visible',
  position: 'static', direction: 'ltr', writingMode: 'horizontal-tb', transform: 'none', perspective: 'none', zoom: '1',
  scrollSnapType: 'none', overflowX: 'visible', overflowY: 'visible', scrollbarWidth: 'auto', scrollbarGutter: 'auto',
  borderLeftWidth: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px',
  scrollPaddingTop: '0px', scrollPaddingRight: '0px', scrollPaddingBottom: '0px', scrollPaddingLeft: '0px',
  scrollMarginTop: '0px', scrollMarginRight: '0px', scrollMarginBottom: '0px', scrollMarginLeft: '0px' };
export function createScrollDOM({ nativeEnd, containers, target, rootHeight = 844, targetStyle = {} }) {
  const clock = new VirtualClock(), nodes = new Map(), refs = [], effects = [], requests = [], trace = [], docEvents = new Map();
  const dim = value => Number.parseFloat(value) || 0;
  const computed = node => new Proxy(node.style, { get(object, key) {
    if (key === 'getPropertyValue') return name => computed(node)[camel(name)];
    if (key === 'overflowX' || key === 'overflowY') return object[key] || object.overflow || defaults[key];
    return object[key] ?? defaults[key] ?? '';
  } });
  class Element {
    constructor(id, spec = {}, reference = false) {
      this.id = id; this.tagName = spec.tagName || 'DIV'; this.spec = structuredClone(spec); this.reference = reference;
      this.style = style(spec.style); this.children = []; this.listeners = new Map(); this._x = this._y = 0;
      if (nativeEnd) this.onscrollend = null;
    }
    appendChild(node) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(n => n !== node); node.parentElement = this; node.parentNode = this; this.children.push(node); return node; }
    append(...children) { children.forEach(c => this.appendChild(c)); }
    replaceChildren(...children) { for (const c of this.children) c.parentElement = null; this.children = []; this.append(...children); }
    remove() { if (this.tagName === 'IFRAME') effects.push({ kind: 'reference-remove', at: clock.now }); if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
    setAttribute(key, value) { this[key] = value; }
    getAttribute(key) { return this[key] ?? null; }
    hasAttribute(key) { return this[key] !== undefined; }
    addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    get clientLeft() { return dim(computed(this).borderLeftWidth); }
    get clientTop() { return dim(computed(this).borderTopWidth); }
    get offsetWidth() { return this.boxWidth; } get offsetHeight() { return this.boxHeight; }
    get boxWidth() { if (this.isRoot) return this.frame ? dim(this.frame.style.width) || 390 : 390; return this.spec.width ?? dim(this.style.width); }
    get boxHeight() { if (this.isRoot) return this.frame ? dim(this.frame.style.height) || 844 : 844; return this.spec.height ?? dim(this.style.height); }
    get clientWidth() { return this.boxWidth - this.clientLeft - dim(computed(this).borderRightWidth); }
    get clientHeight() { return this.boxHeight - this.clientTop - dim(computed(this).borderBottomWidth); }
    get scrollWidth() { return this.spec.scrollWidth ?? Math.max(this.clientWidth, ...this.extentChildren.map(c => (c.spec.left ?? dim(c.style.left)) + c.boxWidth)); }
    get scrollHeight() { return this.spec.scrollHeight ?? Math.max(this.clientHeight, ...this.extentChildren.map(c => (c.spec.top ?? dim(c.style.top)) + c.boxHeight)); }
    get extentChildren() { return this.children.flatMap(c => c.isBody ? c.children : [c]).filter(c => c.tagName !== 'IFRAME' && computed(c).position !== 'fixed'); }
    get scrollLeft() { return this._x; } set scrollLeft(x) { this._x = Math.max(0, Math.min(Number(x), this.scrollWidth - this.clientWidth)); }
    get scrollTop() { return this._y; } set scrollTop(y) { this._y = Math.max(0, Math.min(Number(y), this.scrollHeight - this.clientHeight)); }
    get isConnected() { return this.isRoot || !!this.parentElement?.isConnected; }
    getBoundingClientRect() {
      if (this.isRoot || this.isBody) return rect(0, 0, this.boxWidth, this.boxHeight);
      const parent = this.parentElement, b = parent?.getBoundingClientRect() || rect(0, 0, 390, 844);
      return rect(b.left + (parent?.clientLeft || 0) + (this.spec.left ?? dim(this.style.left)) - (parent?.scrollLeft || 0),
        b.top + (parent?.clientTop || 0) + (this.spec.top ?? dim(this.style.top)) - (parent?.scrollTop || 0), this.boxWidth, this.boxHeight);
    }
    contains(other) { for (; other; other = other.parentElement) if (other === this) return true; return false; }
    matches(selector) { return selector === ':disabled' ? false : false; }
    closest(selector) { for (let n = this; n; n = n.parentElement) if (selector === '[inert]' && n.inert) return n; return null; }
    getRootNode() { return this.reference ? this.ownerDocument : document; }
    checkVisibility() { return true; }
    scrollTo(options) {
      if (!this.reference) effects.push({ kind: 'abort-at-current-position', id: this.id, at: clock.now, before: [this.scrollLeft, this.scrollTop] });
      this.scrollLeft = options.left ?? this.scrollLeft; this.scrollTop = options.top ?? this.scrollTop;
    }
    scrollIntoView() {
      if (!this.reference) { requests.push({ at: clock.now, parent: this.parentElement.id }); effects.push({ kind: 'scroll-request', at: clock.now }); return; }
      for (let parent = this.parentElement; parent; parent = parent.parentElement) {
        const s = computed(parent);
        if (!parent.isRoot && ![s.overflowX, s.overflowY].some(v => ['auto', 'scroll', 'hidden', 'overlay'].includes(v))) continue;
        const b = this.getBoundingClientRect(), p = parent.getBoundingClientRect(), t = computed(this);
        const startX = p.left + parent.clientLeft + dim(s.scrollPaddingLeft), endX = p.left + parent.clientLeft + parent.clientWidth - dim(s.scrollPaddingRight);
        const startY = p.top + parent.clientTop + dim(s.scrollPaddingTop), endY = p.top + parent.clientTop + parent.clientHeight - dim(s.scrollPaddingBottom);
        const left = b.left - dim(t.scrollMarginLeft), right = b.right + dim(t.scrollMarginRight);
        if (left < startX && right <= endX) parent.scrollLeft += left - startX;
        else if (right > endX && left >= startX) parent.scrollLeft += right - endX;
        parent.scrollTop += (b.top - dim(t.scrollMarginTop) + b.bottom + dim(t.scrollMarginBottom)) / 2 - (startY + endY) / 2;
      }
    }
  }
  function rect(left, top, width, height) { return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return { left, top, width, height, right: left + width, bottom: top + height }; } }; }
  const root = new Element('root', { scrollWidth: 390, scrollHeight: rootHeight }); root.isRoot = true; nodes.set('root', root);
  const makeDocument = (frame, reference = false) => {
    const html = reference ? new Element('reference-root', {}, true) : root; html.isRoot = true; html.frame = frame;
    const body = new Element('body', { width: 390, height: 844 }, reference); body.isBody = true; html.appendChild(body);
    const doc = { documentElement: html, scrollingElement: html, body, defaultView: null,
      createElement(tag) {
        if (tag === 'iframe') {
          const f = new Element('reference-frame', { tagName: 'IFRAME' }); refs.push(f);
          f.contentDocument = makeDocument(f, true); f.contentWindow = { scrollTo: options => f.contentDocument.documentElement.scrollTo(options) };
          const append = root.appendChild.bind(root); f.connect = () => append(f); return f;
        }
        const e = new Element('', { tagName: tag.toUpperCase() }, reference); e.ownerDocument = doc; return e;
      },
      open() {}, write() { body.children = []; body.appendChild(doc.createElement('div')); body.appendChild(doc.createElement('div')); }, close() {},
      querySelector: selector => nodes.get(selector.replace(/^#/, '')) || null,
      querySelectorAll: selector => selector === 'iframe' ? refs.filter(f => f.parentElement) : [],
      elementFromPoint(x, y) {
        const e = nodes.get('target'), b = e.getBoundingClientRect();
        if (x < b.left || x > b.right || y < b.top || y > b.bottom) return null;
        for (let p = e.parentElement; p && p !== root; p = p.parentElement) {
          const s = computed(p), pb = p.getBoundingClientRect();
          if ([s.overflowX, s.overflowY].some(v => v !== 'visible') && (x < pb.left || x > pb.right || y < pb.top || y > pb.bottom)) return null;
        }
        return e;
      },
      addEventListener(type, listener) { if (!docEvents.has(type)) docEvents.set(type, new Set()); docEvents.get(type).add(listener); },
      removeEventListener(type, listener) { docEvents.get(type)?.delete(listener); }
    };
    if (nativeEnd) doc.onscrollend = null;
    html.ownerDocument = body.ownerDocument = doc;
    return doc;
  };
  const document = makeDocument(null);
  for (const spec of containers) { const e = new Element(spec.id, spec); nodes.set(spec.id, e); (nodes.get(spec.parent || 'root')).appendChild(e); e.ownerDocument = document; }
  const button = new Element('target', { width: 100, height: 34, ...target, style: targetStyle, tagName: 'BUTTON' }); nodes.set('target', button); nodes.get(target.parent).appendChild(button); button.ownerDocument = document;
  const countListeners = () => [...docEvents.values()].reduce((n, s) => n + s.size, 0) + [...nodes.values()].reduce((sum, n) => sum + [...n.listeners.values()].reduce((m, s) => m + s.size, 0), 0);
  const dispatch = (id, type) => {
    const n = nodes.get(id), event = { type, target: n === root ? document : n, isTrusted: true, timeStamp: clock.now };
    for (const listener of [...(docEvents.get(type) || [])]) listener(event);
    for (let p = n; p; p = p.parentElement) for (const listener of [...(p.listeners.get(type) || [])]) listener(event);
    trace.push({ id, type, at: clock.now, position: [n.scrollLeft, n.scrollTop], modeled: true });
  };
  const context = vm.createContext({ document, innerWidth: 390, innerHeight: 844,
    performance: { now: () => clock.now, timeOrigin: 0 }, getComputedStyle: computed,
    setTimeout: clock.set, clearTimeout: clock.clear, requestAnimationFrame: fn => clock.set(() => fn(clock.now), 16), cancelAnimationFrame: clock.clear,
    Element, HTMLElement: Element, CSS: { supports: () => true }, console });
  const execute = (fn, args) => { context.args = args; return vm.runInContext('(' + fn.toString() + ')(...args)', context); };
  const pendingPolls = new Set();
  const handle = value => ({ value, evaluate: (fn, ...args) => Promise.resolve().then(() => execute(fn, [value, ...args])), dispose: () => Promise.resolve() });
  const page = {
    evaluate: (fn, ...args) => Promise.resolve().then(() => execute(fn, args)),
    evaluateHandle: (fn, ...args) => Promise.resolve().then(() => handle(execute(fn, args))),
    waitForFunction(fn, options, ...args) {
      return new Promise((resolve, reject) => {
        const task = {}; pendingPolls.add(task);
        const timeoutId = clock.set(() => { task.closed = true; pendingPolls.delete(task); const e = new Error('Waiting failed: 4000ms exceeded'); e.name = 'TimeoutError'; reject(e); }, options.timeout);
        const poll = async () => {
          if (task.closed) return;
          try {
            if (await execute(fn, args.map(a => a?.value || a))) { task.closed = true; clock.clear(timeoutId); pendingPolls.delete(task); resolve(handle(true)); return; }
            clock.set(poll, 16);
          } catch (error) { task.closed = true; clock.clear(timeoutId); pendingPolls.delete(task); reject(error); }
        };
        clock.set(poll, 16);
      });
    }
  };
  return { page, clock, nodes, refs, effects, requests, trace, document, countListeners,
    move(id, x, y, end = true) { const n = nodes.get(id); n.scrollLeft = x; n.scrollTop = y; dispatch(id, 'scroll'); if (end && nativeEnd) dispatch(id, 'scrollend'); },
    end(id) { if (nativeEnd) dispatch(id, 'scrollend'); },
    snapshot() { return { positions: Object.fromEntries([...nodes].filter(([id]) => id !== 'target').map(([id, n]) => [id, [n.scrollLeft, n.scrollTop]])), requests: [...requests], trace: [...trace], listeners: countListeners(), references: refs.filter(f => f.parentElement).length, effects: [...effects] }; }
  };
}
