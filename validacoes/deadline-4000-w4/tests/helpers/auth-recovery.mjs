/* Infraestrutura SOMENTE de regressão: SDK real, identidades fictícias,
   barreiras HTTP e corpos transmitidos por um servidor local real. Zero SQL. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { AUTH_URL, USERS, DATA_PREFIX, COPY_KEY, PROFILE, completedJournal } from './auth-fixture.mjs';
export const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
export async function within(promise, message, timeout = 6000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); })]); }
  finally { clearTimeout(timer); }
}
export async function until(predicate, message, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, message);
    await tick(20);
  }
}
export function twoAccounts(fixture, session = fixture.defaultSession) {
  return { ...fixture.seed(USERS.A, { 'forja-perfil-v1': { ...PROFILE, nomeExibicao: 'Conta A' } }, { session }),
    [DATA_PREFIX(USERS.B) + 'forja-perfil-v1']: JSON.stringify({ ...PROFILE, nomeExibicao: 'Conta B' }),
    [COPY_KEY(USERS.B)]: completedJournal(USERS.B) };
}
export function holdAuth(fixture) {
  const refresh = deferred(), refreshing = deferred(), logout = deferred(), loggingOut = deferred();
  const handle = fixture.handle.bind(fixture);
  fixture.handle = async (input, options = {}) => {
    const url = String(typeof input === 'object' ? input.url || input : input);
    if (url.includes('grant_type=refresh_token')) { refreshing.resolve(); await refresh.promise; }
    if (url.includes('/auth/v1/logout')) { loggingOut.resolve(); await logout.promise; }
    return handle(input, options);
  };
  return { refresh, refreshing, logout, loggingOut, release() { refresh.resolve(); logout.resolve(); } };
}
export function bodyTransport(server) {
  const original = server.listeners('request');
  const queue = [], requests = [];
  server.removeAllListeners('request');
  const listener = (req, res) => {
    if (req.url !== '/forja/__auth_recovery_body') {
      if (!original.length) res.writeHead(404).end();
      else for (const handle of original) handle(req, res);
      return;
    }
    const plan = queue.shift();
    if (!plan) { res.writeHead(500).end('Unplanned test request'); return; }
    const entry = { res, aborted: false, finished: false, finishAttempts: 0, chunks: 0, headersAt: null };
    requests.push(entry);
    res.on('close', () => { clearInterval(entry.streaming); entry.aborted = !res.writableEnded; entry.finished = true; });
    entry.finish = () => { entry.finishAttempts++; if (!res.destroyed) res.end(JSON.stringify(plan.user).slice('{"id":'.length)); };
    if (plan.mode !== 'headers-hanging') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.write('{"id":'); entry.headersAt = Date.now();
      if (plan.mode === 'normal') entry.finish();
      if (plan.mode === 'delayed') entry.timer = setTimeout(entry.finish, plan.delay || 100);
      if (plan.mode === 'broken') entry.timer = setTimeout(() => res.destroy(), 100);
      if (plan.mode === 'streaming') entry.streaming = setInterval(() => { entry.chunks++; res.write(' '); }, 80);
    }
    plan.entered.resolve(entry);
  };
  server.on('request', listener);
  return {
    requests,
    queue(mode, user, delay) { const entered = deferred(); queue.push({ mode, user, delay, entered }); return entered.promise; },
    reset() { for (const r of requests) { clearTimeout(r.timer); clearInterval(r.streaming); r.res.destroy(); } requests.length = 0; queue.length = 0; },
    close() { this.reset(); server.removeListener('request', listener); for (const handle of original) server.on('request', handle); }
  };
}
export async function unitBodyTransport(app, token = null) {
  const server = http.createServer();
  const transport = bodyTransport(server);
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const fetch = app.w.fetch;
  let enabled = true;
  const signals = [];
  app.w.fetch = (input, options) => {
    if (enabled && String(input) === AUTH_URL + '/auth/v1/user' && (!token || new Headers(options.headers).get('authorization') === 'Bearer ' + token)) {
      signals.push(options.signal);
      return globalThis.fetch('http://127.0.0.1:' + server.address().port + '/forja/__auth_recovery_body', options);
    }
    return fetch(input, options);
  };
  return { ...transport, signals, disable() { enabled = false; },
    async stop() { enabled = false; transport.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
export async function installBodyInBrowser(page, token = null) {
  await page.evaluate((authUrl, token) => {
    const fetch = window.fetch.bind(window);
    window.authBodyProbe = { enabled: true, signals: [] };
    window.fetch = (input, options) => {
      if (authBodyProbe.enabled && String(input) === authUrl + '/auth/v1/user' && (!token || new Headers(options.headers).get('authorization') === 'Bearer ' + token)) {
        authBodyProbe.signals.push(options.signal);
        return fetch('/forja/__auth_recovery_body', options);
      }
      return fetch(input, options);
    };
  }, AUTH_URL, token);
}
export const adminPayload = Object.freeze({ associations: [], report: { total: 165, approved: 0, pending: 165,
  review: 0, rejected: 0, unavailable: 0, coveragePercent: 0, withoutVideo: [], inconsistencies: [] } });
export function adminHttp(fixture) {
  const handle = fixture.handle.bind(fixture);
  fixture.adminRequests = [];
  fixture.handle = async (input, options = {}) => {
    if (/youtube-videos/.test(String(input))) {
      fixture.adminRequests.push(options);
      return new Response(JSON.stringify(adminPayload), { headers: { 'content-type': 'application/json' } });
    }
    return handle(input, options);
  };
}
export async function browserAdminHttp(request, calls, payload = adminPayload) {
  if (!/youtube-videos/.test(request.url())) return false;
  const headers = { 'access-control-allow-origin': request.headers().origin || '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,accept' };
  if (request.method() === 'OPTIONS') { await request.respond({ status: 204, headers }); return true; }
  calls.push(request.postData());
  await request.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(payload) });
  return true;
}
