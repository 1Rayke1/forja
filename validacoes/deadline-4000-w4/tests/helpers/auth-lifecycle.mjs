/* Instrumentação SOMENTE de teste: Web Locks/BroadcastChannel reais no
   Chromium, respostas e identidades fictícias. Sem SQL ou credenciais reais. */
import assert from 'node:assert/strict';
import { AUTH_STORAGE_KEY, AUTH_URL } from './auth-fixture.mjs';
import { until, within } from './auth-recovery.mjs';
export { until, within };
export const SIGNED_OUT = 'forja-auth-signed-out-v1';
export const ATTEMPT = 'forja-auth-oauth-v1';
export const currentSession = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), AUTH_STORAGE_KEY);
export const sessionId = session => JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString()).session_id;

export async function stayOnLogin(page) {
  await page.evaluateOnNewDocument(key => {
    if (!sessionStorage.getItem('__lifecycle_login_seeded')) {
      sessionStorage.setItem('__lifecycle_login_seeded', '1'); sessionStorage.setItem(key, '1');
    }
  }, SIGNED_OUT);
}
// Retém só a entrega do canal do app. O canal oficial do SDK não é alterado.
export async function installMailbox(page, { holdStorageEvents = false } = {}) {
  await page.evaluateOnNewDocument(holdStorageEvents => {
    if (holdStorageEvents) addEventListener('storage', event => event.stopImmediatePropagation(), true);
    const Native = BroadcastChannel, descriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage');
    window.lifecycleMailbox = [];
    window.BroadcastChannel = class extends Native {
      set onmessage(callback) {
        const channel = this;
        descriptor.set.call(this, event => {
          if (channel.name.startsWith('forja:logout:')) lifecycleMailbox.push({ data: structuredClone(event.data), deliver: () => callback.call(channel, event) });
          else callback.call(channel, event);
        });
      }
      get onmessage() { return descriptor.get.call(this); }
    };
  }, holdStorageEvents);
}
export async function waitMessages(page, count = 1) {
  await until(() => page.evaluate(count => lifecycleMailbox.length >= count, count), 'mensagem real não chegou à caixa de teste');
  return page.evaluate(() => lifecycleMailbox.map(entry => entry.data));
}
export async function deliver(page, indexes = [0]) {
  await page.evaluate(indexes => { for (const index of indexes) lifecycleMailbox[index].deliver(); }, indexes);
}
export function assertTokenless(marker) {
  assert.deepEqual(Object.keys(marker).sort(), ['at', 'nonce', 'sessionId', 'userId']);
  for (const key of ['userId', 'sessionId', 'nonce']) assert.match(marker[key], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.ok(Number.isFinite(marker.at));
}

// Página mínima da MESMA origem. Ela não executa o app e usa a fila nativa,
// sem substituir navigator.locks nem tornar assíncrono o storage de A.
export async function lockController(context, origin) {
  const page = await context.newPage(); await page.setRequestInterception(true);
  page.on('request', request => request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Local lock coordinator</title>' }));
  await page.goto(origin + '/forja/__lifecycle_coordinator');
  await page.evaluate(key => {
    window.lifecycleGates = {}; window.lifecycleLock = 'forja:auth:' + key;
    window.lifecycleQueue = id => {
      const gate = lifecycleGates[id] = { entered: false };
      void navigator.locks.request(lifecycleLock, { mode: 'exclusive' }, async () => {
        gate.entered = true; await new Promise(resolve => { gate.release = resolve; });
      });
    };
  }, AUTH_STORAGE_KEY);
  return {
    page,
    async queue(id) { await page.evaluate(id => { lifecycleQueue(id); }, id); },
    async entered(id) { await until(() => page.evaluate(id => lifecycleGates[id]?.entered === true, id), 'Web Lock nativo ' + id + ' não foi adquirido'); },
    async release(id) { await page.evaluate(id => lifecycleGates[id]?.release?.(), id); },
    async pending(count = 1) {
      await until(() => page.evaluate(async count => (await navigator.locks.query()).pending.filter(lock => lock.name === lifecycleLock).length >= count, count), 'fila nativa não atingiu ' + count + ' entradas');
    },
    async available() { return page.evaluate(() => navigator.locks.request(lifecycleLock, { ifAvailable: true }, lock => Boolean(lock))); },
    async post(marker) {
      assertTokenless(marker);
      await page.evaluate((key, marker) => { const channel = new BroadcastChannel('forja:logout:' + key); channel.postMessage(marker); channel.close(); }, AUTH_STORAGE_KEY, marker);
    },
    async releaseAll() { await page.evaluate(() => { for (const gate of Object.values(lifecycleGates)) gate.release?.(); }).catch(() => {}); }
  };
}
// Observador síncrono: não pausa nem transforma a escrita do adapter.
export async function observeSessionWrite(page) {
  await page.evaluate(key => {
    const storage = Forja.auth.client.auth.storage, setItem = storage.setItem;
    window.lifecycleWriteRequested = false;
    storage.setItem = function (name, value) {
      if (name === key) lifecycleWriteRequested = true;
      return setItem.call(this, name, value);
    };
  }, AUTH_STORAGE_KEY);
}
export async function startRefresh(page) {
  await page.evaluate(() => {
    window.lifecycleRefresh = Forja.auth.client.auth.refreshSession().then(
      result => ({ rejected: false, error: result.error?.name || null, stale: Boolean(result.error?.stale) }),
      error => ({ rejected: true, error: error.name, stale: Boolean(error.stale) })
    );
  });
}
export async function finishRefresh(page) { return within(page.evaluate(() => lifecycleRefresh), 'refresh do SDK não terminou'); }
export function authorizeLocation(response) {
  assert.equal(response.status, 302); const location = response.headers.get('location'); assert.ok(location); return location;
}
export const isAuthorize = url => new URL(url).origin === AUTH_URL && new URL(url).pathname === '/auth/v1/authorize';

export async function allStorageUnavailable(page) {
  await page.evaluate(() => {
    window.lifecycleRestoreStorage = [];
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      const original = Storage.prototype[method];
      lifecycleRestoreStorage.push(() => { Storage.prototype[method] = original; });
      Storage.prototype[method] = function (...args) {
        if (this === localStorage || this === sessionStorage) throw new DOMException('Storage totalmente indisponível na fixture', 'SecurityError');
        return original.apply(this, args);
      };
    }
  });
  return () => page.evaluate(() => { for (const restore of lifecycleRestoreStorage.reverse()) restore(); });
}
