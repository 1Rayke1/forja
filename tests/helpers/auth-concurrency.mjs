/* Barreiras de teste: SDK real, HTTP/identidades fictícios, nenhuma rede real.
   Ordem observável de operações, não sleeps para tentar vencer uma corrida. */
import assert from 'node:assert/strict';
import { deferred, within, until } from './auth-recovery.mjs';
export { deferred, within, until };
export function assertFailedLogoutFor(fixture, token) {
  const requests = fixture.requests.filter(request => request.url.includes('/auth/v1/logout'));
  assert.equal(fixture.failLogout, true, 'a fixture deve devolver 503 na revogação');
  assert.ok(requests.length > 0, 'a revogação precisa ter sido realmente solicitada');
  assert.equal(requests.every(request => request.headers.authorization === 'Bearer ' + token), true, 'revogação não usou exclusivamente o JWT vigente da sessão encerrada');
}
export const OAUTH_INTENT = 'forja-auth-oauth-current-v1';
export const LOGOUT_KEY = 'forja-auth-logout-v1';

// Captura a resposta ANTES de retê-la: o erro/código/token já pertence à
// requisição original, mesmo que a fixture mude enquanto ela está pendente.
export function holdResponse(fixture, predicate) {
  const original = fixture.handle.bind(fixture);
  const entered = deferred(), release = deferred(), completed = deferred();
  let taken = false;
  fixture.handle = async (input, options = {}) => {
    const response = await original(input, options);
    if (!taken && predicate(String(input), options, response)) {
      taken = true; entered.resolve({ response, options });
      try { await release.promise; } finally { completed.resolve(); }
    }
    return response;
  };
  return { entered: entered.promise, completed: completed.promise,
    release: () => release.resolve(), restore() { release.resolve(); fixture.handle = original; } };
}
export function userResponse(fixture, token) {
  return holdResponse(fixture, (url, options) => url.endsWith('/auth/v1/user') &&
    new Headers(options.headers).get('authorization') === 'Bearer ' + token);
}
// A interface SupportedStorage do SDK aceita Promise. Só a leitura escolhida
// é retida; o SDK continua executando seu próprio exchange/cleanup real.
export function holdStorageRead(storage, key) {
  const getItem = storage.getItem, entered = deferred(), release = deferred();
  let taken = false;
  storage.getItem = async function (name) {
    const value = await getItem.call(this, name);
    if (!taken && name === key) { taken = true; entered.resolve(); await release.promise; }
    return value;
  };
  return { entered: entered.promise, release: () => release.resolve(),
    restore() { release.resolve(); storage.getItem = getItem; } };
}
export function localSnapshot(window) {
  return Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, index) => {
    const key = window.localStorage.key(index); return [key, window.localStorage.getItem(key)];
  }));
}
export function copyLocal(from, to, { notify = false } = {}) {
  const values = localSnapshot(from), old = localSnapshot(to);
  for (const key of Object.keys(old)) if (!(key in values)) to.localStorage.removeItem(key);
  for (const [key, value] of Object.entries(values)) to.localStorage.setItem(key, value);
  if (notify) for (const key of new Set([...Object.keys(old), ...Object.keys(values)])) {
    if (old[key] !== values[key]) to.dispatchEvent(new to.StorageEvent('storage', { key, oldValue: old[key] ?? null, newValue: values[key] ?? null }));
  }
}
export function storageFault(window, method, { area = 'localStorage', key = null } = {}) {
  const storage = window[area], proto = window.Storage.prototype, original = proto[method];
  const evidence = { hits: 0, first: null };
  proto[method] = function (...args) {
    if (this === storage && (key === null || String(args[0]) === key)) {
      evidence.hits++;
      evidence.first ||= { state: window.Forja?.auth?.state, gate: window.document.documentElement.dataset.forjaAuth };
      throw new window.DOMException('Storage indisponível na fixture', 'SecurityError');
    }
    return original.apply(this, args);
  };
  return { evidence, restore() { proto[method] = original; } };
}
export async function browserStorageFault(page, method, { area = 'localStorage', key = null, armOnLogout = false } = {}) {
  await page.evaluate((method, area, key, armOnLogout) => {
    const proto = Storage.prototype, storage = window[area], original = proto[method];
    const arm = event => { if (event.target.closest?.('#account-signout')) authFixtureFault.armed = true; };
    // A falha precisa atingir signOut, não um tick/visibilitychange ANTES do
    // clique. Arma no capture do evento, antes do handler de produção.
    window.authFixtureFault = { hits: 0, first: null, armed: !armOnLogout,
      restore() { proto[method] = original; document.removeEventListener('click', arm, true); } };
    if (armOnLogout) document.addEventListener('click', arm, true);
    proto[method] = function (...args) {
      if (authFixtureFault.armed && this === storage && (key === null || String(args[0]) === key)) {
        authFixtureFault.hits++;
        authFixtureFault.first ||= { state: Forja.auth.state, gate: document.documentElement.dataset.forjaAuth };
        throw new DOMException('Storage indisponível na fixture', 'SecurityError');
      }
      return original.apply(this, args);
    };
  }, method, area, key, armOnLogout);
  return async () => page.evaluate(() => window.authFixtureFault?.restore());
}
export async function deferAuthNotifications(page) {
  await page.evaluateOnNewDocument(() => {
    // Simula UI anterior à entrega das notificações, não um navegador sem
    // segurança web. O storage compartilhado e o SDK continuam reais.
    window.BroadcastChannel = undefined;
    addEventListener('storage', event => event.stopImmediatePropagation(), true);
  });
}
export async function readyAs(page, uid) {
  await until(async () => {
    try { return await page.evaluate(id => window.Forja?.auth?.isVerified(id) && document.documentElement.dataset.forjaAuth === 'ready', uid); }
    catch (error) { if (!/context.*destroyed|Cannot find context|Inspected target navigated/i.test(error.message)) throw error; return false; }
  }, 'Documento final não validou a identidade esperada');
}

// Retém apenas navegações do app, explicitamente neste cenário. O SDK e suas
// Promises terminam no documento antigo; depois a navegação real é retomada.
export async function holdNavigations(page) {
  await page.evaluate(() => {
    window.authFixtureNavigation = { original: Forja.navigate, pending: null };
    Forja.navigate = url => { authFixtureNavigation.pending = url; };
  });
  return async () => page.evaluate(() => {
    const saved = authFixtureNavigation; Forja.navigate = saved.original;
    if (saved.pending) Forja.navigate(saved.pending);
  });
}
