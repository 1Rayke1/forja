/* Regressões finais: SDK oficial, storage/HTTP fictícios, ordem determinística. */
import assert from 'node:assert/strict';
import { App, BASE, closeAllApps } from './helpers/harness.mjs';
import { AuthFixture, USERS, AUTH_STORAGE_KEY, AUTH_URL, DATA_PREFIX } from './helpers/auth-fixture.mjs';
import { twoAccounts } from './helpers/auth-recovery.mjs';
import { holdResponse, holdStorageRead, deferred, within, until, localSnapshot, copyLocal, storageFault, LOGOUT_KEY, assertFailedLogoutFor } from './helpers/auth-concurrency.mjs';
const selected = process.env.FORJA_AUTH_CONCURRENCY_CASE;
let passed = 0, failed = 0;
async function test(name, run) {
  if (selected && !selected.split(',').includes(name.split('.')[0])) return;
  try { await run(); passed++; console.log('✅ AUTH CONCURRENCY ' + name); }
  catch (error) { failed++; console.error('❌ AUTH CONCURRENCY ' + name + '\n' + error.stack); }
  finally { closeAllApps(); }
}
async function open(fixture, { page = 'configuracoes/index.html', local = twoAccounts(fixture) } = {}) {
  const app = new App({ fixture }); await app.load(BASE + page, { local, session: {} }); return app;
}
const ready = app => until(() => app.d.documentElement.dataset.forjaAuth === 'ready', 'documento não ficou pronto');
const guest = app => until(() => ['guest', 'error'].includes(app.F.auth.state), 'documento não permaneceu fechado');
const keep = app => { app.F.navigate = url => { if (new URL(url).origin === AUTH_URL) app.externalNavigations.push(url); }; };
const payload = session => JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString());
async function google(app, fixture) {
  keep(app);
  await app.F.auth.startGoogle();
  const response = await fixture.handle(app.externalNavigations.at(-1));
  await app.go(response.headers.get('location'));
}
for (const [id, method, key] of [[1, 'getItem', AUTH_STORAGE_KEY], [2, 'setItem', LOGOUT_KEY], [3, 'removeItem', AUTH_STORAGE_KEY]]) {
  await test(id + '. SecurityError em ' + method + ': fechar antes da falha, preservar dados e concluir saída no retry', async () => {
    const f = new AuthFixture(); f.failLogout = true;
    const app = await open(f); await ready(app); keep(app);
    const original = app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + 'forja-perfil-v1');
    const fault = storageFault(app.w, method, { key });
    const exiting = app.F.auth.signOut().then(() => null, error => error.name);
    try {
      assert.equal(app.d.documentElement.dataset.forjaAuth, 'locked', 'primeira ação deve fechar o DOM');
      assert.equal(app.F.auth.canWrite(), false);
      assert.equal(await exiting, null, 'logout não pode rejeitar por storage');
      assert.ok(fault.evidence.hits > 0);
      assert.notEqual(fault.evidence.first.state, 'authenticated', 'storage foi acessado antes de invalidar autorização');
      assert.equal(fault.evidence.first.gate, 'locked', 'o primeiro acesso recusado ocorreu antes do bloqueio');
    } finally { fault.restore(); }
    assert.equal(app.F.auth.isVerified(), false); assert.equal(app.F.auth.canWrite(), false);
    await app.F.auth.revalidate(); assert.equal(app.d.documentElement.dataset.forjaAuth, 'locked');
    assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + 'forja-perfil-v1'), original);
    assert.equal(app.$('#auth-retry').hidden, false, 'saída incompleta precisa de retry próprio, não de reautorização');
    app.click('#auth-retry');
    await until(() => app.w.localStorage.getItem(AUTH_STORAGE_KEY) === null, 'retry de saída não removeu a sessão');
    assert.equal(app.F.auth.isVerified(), false);
  });
}
async function pendingA({ error = false } = {}) {
  const f = new AuthFixture(), facade = Object.create(f), original = f.handle.bind(f);
  facade.handle = async (input, options) => {
    const response = await original(input, options);
    return error && String(input).includes('grant_type=pkce')
      ? new Response(JSON.stringify({ code: 'bad_code_verifier', message: 'old exchange failed' }), { status: 400, headers: { 'content-type': 'application/json' } }) : response;
  };
  const hold = holdResponse(facade, url => url.includes('grant_type=pkce'));
  const local = twoAccounts(f); delete local[AUTH_STORAGE_KEY];
  const a = await open(facade, { page: 'login.html', local }); await guest(a);
  await google(a, facade); await within(hold.entered, 'PKCE A não iniciou'); keep(a);
  const b = await open(f, { page: 'login.html', local: localSnapshot(a.w) }); await guest(b);
  return { f, a, b, hold };
}
await test('4. PKCE A pendente não substitui B pronta mesmo antes de entregar storage ao documento antigo', async () => {
  const { f, a, b, hold } = await pendingA();
  try {
    f.oauthUser = USERS.B; await google(b, f); await ready(b);
    copyLocal(b.w, a.w); // Commit de outro SDK; deliberadamente antes da notificação.
    const expected = a.w.localStorage.getItem(AUTH_STORAGE_KEY);
    hold.release(); await within(hold.completed, 'resposta antiga não foi liberada');
    await within(a.F.auth.init(), 'callback A não terminou');
    assert.equal(a.w.localStorage.getItem(AUTH_STORAGE_KEY) === expected, true, 'PKCE antigo substituiu B');
    assert.equal(JSON.parse(expected).user.id, USERS.B); assert.equal(b.F.auth.isVerified(USERS.B), true);
  } finally { hold.restore(); }
});
await test('5. Erro PKCE antigo não apaga o verifier nem a tentativa de B ainda em andamento', async () => {
  const { f, a, b, hold } = await pendingA({ error: true });
  try {
    f.oauthUser = USERS.B; keep(b); await b.F.auth.startGoogle(); copyLocal(b.w, a.w);
    const key = AUTH_STORAGE_KEY + '-code-verifier', before = a.w.localStorage.getItem(key);
    assert.ok(before); const pending = b.w.sessionStorage.getItem('forja-auth-oauth-v1');
    hold.release(); await within(hold.completed, 'erro antigo não foi liberado'); await within(a.F.auth.init(), 'callback antigo não terminou');
    assert.equal(a.w.localStorage.getItem(key) === before, true, 'cleanup antigo apagou verifier de B');
    assert.equal(b.w.sessionStorage.getItem('forja-auth-oauth-v1'), pending);
    copyLocal(a.w, b.w);
    const response = await f.handle(b.externalNavigations.at(-1)); await b.go(response.headers.get('location')); await ready(b);
    assert.equal(b.F.auth.isVerified(USERS.B), true);
  } finally { hold.restore(); }
  // Também fecha a janela menor: A já LEU o verifier legado, B grava outro
  // antes do remove aguardado pelo SDK. Não basta comparar só após o HTTP.
  const race = await pendingA({ error: true });
  const key = AUTH_STORAGE_KEY + '-code-verifier';
  const read = holdStorageRead(race.a.F.auth.client.auth.storage, key);
  try {
    race.hold.release(); await within(read.entered, 'cleanup A não leu o verifier');
    race.f.oauthUser = USERS.B; keep(race.b); await race.b.F.auth.startGoogle(); copyLocal(race.b.w, race.a.w);
    const expected = race.a.w.localStorage.getItem(key); assert.ok(expected);
    read.release(); await within(race.a.F.auth.init(), 'cleanup A não terminou');
    assert.equal(race.a.w.localStorage.getItem(key) === expected, true, 'CAS do cleanup removeu verifier B gravado depois da leitura A');
    copyLocal(race.a.w, race.b.w);
    const response = await race.f.handle(race.b.externalNavigations.at(-1)); await race.b.go(response.headers.get('location')); await ready(race.b);
    assert.equal(race.b.F.auth.isVerified(USERS.B), true);
  } finally { read.restore(); race.hold.restore(); }
});
await test('6. Callback A que só chega depois do login B também não substitui a sessão recente', async () => {
  const f = new AuthFixture(), local = twoAccounts(f); delete local[AUTH_STORAGE_KEY];
  const a = await open(f, { page: 'login.html', local }); await guest(a); keep(a); await a.F.auth.startGoogle();
  const callback = (await f.handle(a.externalNavigations.at(-1))).headers.get('location');
  const b = await open(f, { page: 'login.html', local: localSnapshot(a.w) }); await guest(b);
  f.oauthUser = USERS.B; await google(b, f); await ready(b); copyLocal(b.w, a.w);
  const expected = a.w.localStorage.getItem(AUTH_STORAGE_KEY);
  await a.go(callback); await within(a.F.auth.init(), 'callback atrasado não terminou');
  assert.equal(a.w.localStorage.getItem(AUTH_STORAGE_KEY) === expected, true, 'callback tardio substituiu B');
  assert.equal(b.F.auth.isVerified(USERS.B), true);
});
await test('7. Refresh SDK concluído → logout imediato → revogação 503 não deixa A rotacionada ativa', async () => {
  const f = new AuthFixture(); f.failLogout = true;
  const app = await open(f); await ready(app); keep(app);
  const refresh = await app.F.auth.client.auth.refreshSession(); assert.equal(refresh.error, null);
  assert.equal(payload(refresh.data.session).session_id, payload(f.defaultSession).session_id);
  await app.F.auth.signOut();
  assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY), null, 'sessão rotacionada sobreviveu ao logout');
  assert.equal(app.F.auth.canWrite(), false); assert.ok(app.w.localStorage.getItem(LOGOUT_KEY));
  assertFailedLogoutFor(f, refresh.data.session.access_token);
  await app.F.auth.revalidate(); assert.equal(app.F.auth.isVerified(), false);
  const fresh = await open(f, { page: 'login.html', local: localSnapshot(app.w) }); await guest(fresh);
  assert.equal(fresh.F.auth.isVerified(), false, 'reload reautorizou a conta encerrada');
});
await test('8. UI A anterior a storage/BroadcastChannel encerra a rotação da MESMA geração', async () => {
  const f = new AuthFixture(); f.failLogout = true;
  const app = await open(f); await ready(app); keep(app);
  const rotated = f.issue(USERS.A, { sessionId: payload(f.defaultSession).session_id });
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(rotated)); // Refresh oficial em outra aba antes do evento.
  await app.F.auth.signOut();
  assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY), null);
  assert.ok(app.w.localStorage.getItem(LOGOUT_KEY)); assert.equal(app.F.auth.canWrite(), false);
  assertFailedLogoutFor(f, rotated.access_token);
});
await test('9. Logout A rotacionada nunca remove, sinaliza ou revoga uma sessão posterior de B', async () => {
  const f = new AuthFixture(), app = await open(f); await ready(app); keep(app);
  await app.F.auth.client.auth.refreshSession();
  const b = f.issue(USERS.B); app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(b));
  await app.F.auth.signOut();
  assert.equal(JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY)).user.id, USERS.B);
  assert.equal(app.w.localStorage.getItem(LOGOUT_KEY), null);
  assert.ok(f.refreshes.has(b.refresh_token));
  assert.ok(f.requests.filter(r => r.url.includes('/auth/v1/logout')).every(r => r.headers.authorization !== 'Bearer ' + b.access_token));
});
await test('10. Mesmo UID com outro session_id é um novo login, não uma rotação pertencente ao logout antigo', async () => {
  const f = new AuthFixture(), app = await open(f); await ready(app); keep(app);
  const next = f.issue(USERS.A); assert.notEqual(payload(next).session_id, payload(f.defaultSession).session_id);
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next)); await app.F.auth.signOut();
  assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY) === JSON.stringify(next), true);
  assert.equal(app.w.localStorage.getItem(LOGOUT_KEY), null);
  assert.ok(f.refreshes.has(next.refresh_token));
});
await test('11. Falhas combinadas de storage mantêm bloqueio em memória e não liberam retry de autenticação', async () => {
  const f = new AuthFixture(); f.failLogout = true; const app = await open(f); await ready(app); keep(app);
  const faults = ['getItem', 'setItem', 'removeItem'].map(method => storageFault(app.w, method));
  const tab = storageFault(app.w, 'setItem', { area: 'sessionStorage' });
  try { await assert.doesNotReject(app.F.auth.signOut()); }
  finally { tab.restore(); for (const fault of faults.reverse()) fault.restore(); }
  await app.F.auth.revalidate(); assert.equal(app.F.auth.isVerified(), false); assert.equal(app.F.auth.canWrite(), false);
  assert.equal(app.d.documentElement.dataset.forjaAuth, 'locked');
  assert.equal(app.$('#auth-retry').hidden, false); app.click('#auth-retry');
  await until(() => app.w.localStorage.getItem(AUTH_STORAGE_KEY) === null, 'retry após recuperar storage não encerrou sessão');
});
// Complemento unitário: o Chromium abaixo usa Web Locks reais; aqui a fila
// TestLocks permite reter exatamente o commit/cleanup do SDK oficial.
async function unitQueuedMutation({ uid = USERS.B, rejected = false } = {}) {
  const f = new AuthFixture(), app = await open(f); await ready(app); keep(app);
  if (rejected) {
    const expired = JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY)); expired.expires_at = 1;
    app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(expired));
    const handle = f.handle.bind(f);
    f.handle = (input, options) => String(input).includes('grant_type=refresh_token')
      ? Promise.resolve(new Response(JSON.stringify({ code: 'refresh_token_not_found', message: 'expired fixture refresh' }), { status: 400, headers: { 'content-type': 'application/json' } })) : handle(input, options);
  }
  const release = deferred(), entered = deferred(), requested = deferred();
  const storage = app.F.auth.client.auth.storage, method = rejected ? 'removeItem' : 'setItem', mutate = storage[method];
  storage[method] = function (key, ...rest) { if (key === AUTH_STORAGE_KEY) requested.resolve(); return mutate.call(this, key, ...rest); };
  const held = app.w.navigator.locks.request('forja:auth:' + AUTH_STORAGE_KEY, {}, async () => { entered.resolve(); await release.promise; });
  await within(entered.promise, 'barreira unitária não adquiriu lock');
  const refreshing = app.F.auth.client.auth.refreshSession().then(result => result.error, error => error);
  try {
    await within(requested.promise, 'SDK não solicitou mutação de sessão');
    const expected = JSON.stringify(f.issue(uid)); app.w.localStorage.setItem(AUTH_STORAGE_KEY, expected);
    release.resolve(); await within(refreshing, 'refresh/cleanup não terminou'); await held;
    assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY) === expected, true, 'mutação A obsoleta alterou B após aguardar lock');
    assert.equal(await app.w.navigator.locks.request('forja:auth:' + AUTH_STORAGE_KEY, { ifAvailable: true }, lock => Boolean(lock)), true);
  } finally { release.resolve(); await held; storage[method] = mutate; }
}
await test('12. CAS de refresh dentro do lock preserva a sessão de B gravada durante a espera', () => unitQueuedMutation());
await test('13. CAS de refresh distingue nova sessão do mesmo UID da rotação original', () => unitQueuedMutation({ uid: USERS.A }));
await test('14. Cleanup de refresh rejeitado também preserva B gravada enquanto esperava lock', () => unitQueuedMutation({ rejected: true }));
await test('15. Refresh legítimo sem concorrente mantém a geração e pode ser validado novamente', async () => {
  const f = new AuthFixture(), app = await open(f); await ready(app); keep(app);
  const result = await app.F.auth.client.auth.refreshSession(); assert.equal(result.error, null);
  assert.equal(payload(result.data.session).session_id, payload(f.defaultSession).session_id);
  assert.notEqual(result.data.session.access_token, f.defaultSession.access_token);
  await app.F.auth.revalidate(); await ready(app); assert.equal(app.F.auth.isVerified(USERS.A), true);
});
await test('16. Integração do canal preserva o bloqueio de marcador legado persistido via storage', async () => {
  const f = new AuthFixture(), app = await open(f); await ready(app); keep(app);
  app.w.localStorage.setItem(LOGOUT_KEY, '1');
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key: LOGOUT_KEY, newValue: '1' }));
  assert.equal(app.d.documentElement.dataset.forjaAuth, 'locked');
  assert.equal(app.F.auth.state, 'guest'); assert.equal(app.F.auth.canWrite(), false);
  assert.equal(app.w.sessionStorage.getItem('forja-auth-signed-out-v1'), '1');
});
for (const [number, uid] of [[17, USERS.B], [18, USERS.A]]) {
  await test(number + '. Ticket pré-HTTP reconhece o refresh antigo mesmo se B vencer ANTES de chamar o adapter (UID ' + (uid === USERS.A ? 'igual' : 'diferente') + ')', async () => {
    const f = new AuthFixture(), app = await open(f); await ready(app); keep(app);
    const storage = app.F.auth.client.auth.storage, set = storage.setItem, expected = JSON.stringify(f.issue(uid));
    let intercepted = false;
    // Fronteira inferior: o SDK já passou seu commit guard, mas o adapter
    // ainda não foi chamado. Não basta capturar o snapshot no setItem.
    storage.setItem = function (key, value) {
      if (!intercepted && key === AUTH_STORAGE_KEY) { intercepted = true; app.w.localStorage.setItem(key, expected); }
      return set.call(this, key, value);
    };
    try {
      const error = await app.F.auth.client.auth.refreshSession().then(result => result.error, error => error);
      assert.equal(intercepted, true); assert.equal(Boolean(error?.stale), true);
      assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY) === expected, true);
    } finally { storage.setItem = set; }
  });
}
assert.ok(passed + failed > 0, 'filtro não selecionou testes');
console.log(`\nAUTH CONCURRENCY — ${passed}/${passed + failed} testes aprovados. SDK real, serviços fictícios, zero SQL.`);
if (failed) process.exitCode = 1;
