/* Regressões de recuperação: SDK oficial + fixtures; nenhum serviço/usuário real. */
import assert from 'node:assert/strict';
import { App, BASE, closeAllApps } from './helpers/harness.mjs';
import { AuthFixture, USERS, PROFILE, AUTH_STORAGE_KEY, AUTH_URL, DATA_PREFIX } from './helpers/auth-fixture.mjs';
import { tick, until, within, twoAccounts, holdAuth, unitBodyTransport, deferred, adminHttp } from './helpers/auth-recovery.mjs';
let passed = 0, failed = 0;
async function test(name, task) {
  try { await task(); passed++; console.log('✅ AUTH RECOVERY ' + name); }
  catch (error) { failed++; console.error('❌ AUTH RECOVERY ' + name + '\n' + error.stack); }
  finally { closeAllApps(); }
}
async function open(fixture = new AuthFixture(), { page = 'index.html', local = twoAccounts(fixture) } = {}) {
  const app = new App({ fixture }); await app.load(BASE + page, { local, session: {} }); return app;
}
// Pronto = sessão verificada + (dados vinculados, quando a página usa o
// namespace da conta) + boot completo. O atributo "ready" libera a interface
// antes da ligação dos dados; a administração não usa o namespace da conta.
const ready = async app => {
  await until(() => app.d.documentElement.dataset.forjaAuth === 'ready', 'conteúdo não foi recuperado');
  if (app.F.authData) await until(() => app.F.authData?.userId, 'dados da conta não foram vinculados');
  if (app.F.ready) await app.F.ready;
};
const guest = app => until(() => app.d.body.dataset.page === 'login', 'não retornou ao login');
async function beginGoogleB(app, fixture) {
  await app.F.auth.startGoogle();
  const response = await fixture.handle(app.externalNavigations.at(-1));
  const code = new URL(response.headers.get('location')).searchParams.get('code');
  const result = await app.F.auth.client.auth.exchangeCodeForSession(code);
  assert.equal(result.error, null);
  return result.data.session;
}
await test('1. Logout A aguarda refresh; Google B conclui; respostas antigas não removem nem revogam B', async () => {
  const fixture = new AuthFixture(); const a = fixture.issue(USERS.A, { expiresAt: Math.floor(Date.now() / 1000) + 300 }); fixture.defaultSession = a;
  const app = await open(fixture, { local: twoAccounts(fixture, a) }); await ready(app);
  const barriers = holdAuth(fixture);
  // Retém somente navegações neste teste de unidade. O cenário Chromium faz navegações reais entre duas abas.
  app.F.navigate = url => { if (new URL(url).origin === AUTH_URL) app.externalNavigations.push(url); };
  const now = app.w.Date.now.bind(app.w.Date); app.w.Date.now = () => now() + 240000;
  const checking = app.F.auth.revalidate();
  try {
    await within(barriers.refreshing.promise, 'refresh A não iniciou');
    const exiting = app.F.auth.signOut();
    fixture.oauthUser = USERS.B; const b = await beginGoogleB(app, fixture);
    assert.equal(JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY)).user.id, USERS.B);
    barriers.refresh.resolve(); await within(barriers.loggingOut.promise, 'logout não iniciou'); barriers.logout.resolve();
    await Promise.all([exiting, checking]); await tick(100);
    assert.equal(JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY) || 'null')?.access_token, b.access_token, 'logout antigo apagou B');
    assert.ok(fixture.requests.filter(r => r.url.includes('/auth/v1/logout')).every(r => r.headers.authorization === 'Bearer ' + a.access_token), 'revogação usou token que não era de A');
    assert.equal((await fixture.handle(AUTH_URL + '/auth/v1/user', { headers: { authorization: 'Bearer ' + b.access_token } })).status, 200);
  } finally { barriers.release(); }
});
await test('2. Administração recupera 503 inicial e inicializa controles após retry válido', async () => {
  const fixture = new AuthFixture(); fixture.userErrors.set(fixture.defaultSession.access_token, { status: 503, code: 'temporarily_unavailable' });
  const app = await open(fixture, { page: 'admin/exercicios.html' });
  assert.equal(app.$('#auth-retry').hidden, false);
  fixture.userErrors.clear(); app.click('#auth-retry'); await ready(app);
  assert.equal(app.F.auth.isVerified(), true);
  assert.ok(app.$('#muscle-filter').options.length > 1, 'inicializador administrativo não retomou');
});
await test('3. Cabeçalhos sem fim de corpo respeitam 12 s, abortam o HTTP e permitem retry', async () => {
  const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
  const transport = await unitBodyTransport(app);
  try {
    const entered = transport.queue('hanging', fixture.user(USERS.A));
    const started = Date.now(); const checking = app.F.auth.revalidate(); const request = await entered;
    await until(() => app.F.auth.state === 'error', 'validação não terminou após o limite completo', 14500);
    await checking;
    assert.ok(Date.now() - started >= 11700, 'timeout antecipado');
    assert.equal(transport.signals[0].aborted, true);
    await until(() => request.aborted, 'conexão HTTP não foi cancelada');
    assert.equal(app.$('#auth-retry').hidden, false);
    transport.disable(); app.click('#auth-retry'); await ready(app);
    assert.equal(app.F.auth.user.id, USERS.A);
  } finally { await transport.stop(); }
});
function keepDocument(app) {
  app.F.navigate = url => { if (new URL(url).origin === AUTH_URL) app.externalNavigations.push(url); };
}
function replace(app, session) {
  const oldValue = app.w.localStorage.getItem(AUTH_STORAGE_KEY), newValue = JSON.stringify(session);
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, newValue);
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key: AUTH_STORAGE_KEY, oldValue, newValue }));
}
await test('4. Conclusão de logout antigo preserva verifier e tentativa de um novo Google', async () => {
  const fixture = new AuthFixture(), app = await open(fixture); await ready(app); keepDocument(app);
  const barriers = holdAuth(fixture);
  try {
    const exiting = app.F.auth.signOut(); await within(barriers.loggingOut.promise, 'logout não iniciou');
    fixture.oauthUser = USERS.B; await app.F.auth.startGoogle();
    const verifier = app.w.localStorage.getItem(AUTH_STORAGE_KEY + '-code-verifier');
    const attempt = app.w.sessionStorage.getItem('forja-auth-oauth-v1');
    assert.ok(verifier); barriers.logout.resolve(); await exiting;
    assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY + '-code-verifier'), verifier);
    assert.equal(app.w.sessionStorage.getItem('forja-auth-oauth-v1'), attempt);
    const callback = await fixture.handle(app.externalNavigations.at(-1));
    const code = new URL(callback.headers.get('location')).searchParams.get('code');
    assert.equal((await app.F.auth.client.auth.exchangeCodeForSession(code)).error, null);
    await until(() => app.F.auth.isVerified(USERS.B), 'B não concluiu a tentativa preservada');
  } finally { barriers.release(); }
});
await test('5. Logout de uma UI antiga A não remove nem sinaliza logout sobre B já persistida', async () => {
  const fixture = new AuthFixture(), app = await open(fixture); await ready(app); keepDocument(app);
  const b = fixture.issue(USERS.B);
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(b)); // antes de storage ser entregue
  await app.F.auth.signOut();
  assert.equal(JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY)).access_token, b.access_token);
  assert.equal(app.w.localStorage.getItem('forja-auth-logout-v1'), null);
  assert.ok(fixture.requests.filter(r => r.url.includes('/auth/v1/logout')).every(r => r.headers.authorization === 'Bearer ' + fixture.defaultSession.access_token));
  assert.ok(fixture.refreshes.has(b.refresh_token));
});
await test('6. Administração: nova falha 503 no retry continua fechada, e terceiro retry recupera', async () => {
  const fixture = new AuthFixture(); fixture.userErrors.set(fixture.defaultSession.access_token, { status: 503 });
  const app = await open(fixture, { page: 'admin/exercicios.html' });
  await app.F.retryBoot();
  assert.equal(app.F.auth.state, 'error'); assert.equal(app.d.documentElement.dataset.forjaAuth, 'locked');
  assert.equal(app.$('#auth-retry').hidden, false); assert.equal(app.$('#muscle-filter').options.length, 1);
  fixture.userErrors.clear(); app.click('#auth-retry'); await ready(app);
  assert.ok(app.$('#muscle-filter').options.length > 1);
});
await test('7. Administração: retries de sessão válida são idempotentes e a credencial adicional continua obrigatória', async () => {
  const fixture = new AuthFixture(); adminHttp(fixture);
  const app = await open(fixture, { page: 'admin/exercicios.html' }); await ready(app);
  const count = app.$('#muscle-filter').options.length;
  await app.F.retryBoot(); await app.F.retryBoot();
  assert.equal(app.$('#muscle-filter').options.length, count);
  assert.equal(app.$('#refresh-dashboard').disabled, true);
  app.$('#admin-credential').value = 'not-a-real-admin-credential';
  app.$('#auth-form').dispatchEvent(new app.w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !app.$('#refresh-dashboard').disabled, 'controles administrativos não retomaram');
  assert.equal(fixture.adminRequests.length, 1, 'listeners foram duplicados');
  assert.equal(app.$('#admin-credential').value, '');
  assert.equal(app.w.localStorage.getItem('FORJA_ADMIN_CREDENTIAL'), null);
  assert.match(app.text('#report'), /165/);
});
await test('8. Administração: expiração sem refresh durante recuperação exige novo Google', async () => {
  const fixture = new AuthFixture(); fixture.userErrors.set(fixture.defaultSession.access_token, { status: 503 });
  const app = await open(fixture, { page: 'admin/exercicios.html' });
  const raw = app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + 'forja-perfil-v1');
  const expired = fixture.issue(USERS.A, { expiresAt: Math.floor(Date.now() / 1000) - 60 }); fixture.refreshes.clear();
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(expired));
  app.click('#auth-retry'); await guest(app);
  assert.equal(app.F.auth.isVerified(), false);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + 'forja-perfil-v1'), raw);
});
await test('9. Administração: resposta antiga A não libera B rejeitada; B só entra após validação própria', async () => {
  const fixture = new AuthFixture(); fixture.userErrors.set(fixture.defaultSession.access_token, { status: 503 });
  const app = await open(fixture, { page: 'admin/exercicios.html' });
  fixture.userErrors.clear(); const handle = fixture.handle.bind(fixture), entered = deferred(), release = deferred();
  fixture.handle = async (input, options) => {
    if (String(input).endsWith('/auth/v1/user') && new Headers(options.headers).get('authorization') === 'Bearer ' + fixture.defaultSession.access_token) { entered.resolve(); await release.promise; }
    return handle(input, options);
  };
  try {
    const retry = app.F.retryBoot(); await within(entered.promise, 'verificação antiga não iniciou');
    const b = fixture.issue(USERS.B); fixture.userErrors.set(b.access_token, { status: 503 }); replace(app, b);
    release.resolve(); await retry;
    assert.equal(app.F.auth.isVerified(), false); assert.equal(app.d.documentElement.dataset.forjaAuth, 'locked');
    assert.equal(app.$('#muscle-filter').options.length, 1);
    fixture.userErrors.clear(); app.click('#auth-retry'); await ready(app);
    assert.equal(app.F.auth.user.id, USERS.B);
  } finally { release.resolve(); }
});
await test('10. Administração: dashboard antigo de A não é renderizado após mudar a geração/conta', async () => {
  const fixture = new AuthFixture(), app = await open(fixture, { page: 'admin/exercicios.html' }); await ready(app); keepDocument(app);
  const entered = deferred(), release = deferred(); const original = app.w.fetch;
  app.w.fetch = async (input, options) => {
    if (/youtube-videos/.test(String(input))) { entered.resolve(); await release.promise; return new Response(JSON.stringify({ associations: [], report: { total: 999 } }), { headers: { 'content-type': 'application/json' } }); }
    return original(input, options);
  };
  try {
    app.$('#admin-credential').value = 'not-a-real-admin-credential'; app.$('#auth-form').dispatchEvent(new app.w.Event('submit', { bubbles: true, cancelable: true }));
    await within(entered.promise, 'dashboard não iniciou'); replace(app, fixture.issue(USERS.B));
    await until(() => app.F.auth.isVerified(USERS.B), 'B não foi validada'); release.resolve();
    await until(() => app.text('#session-status').includes('sessão mudou'), 'resposta antiga não foi recusada');
    assert.equal(app.text('#report').includes('999'), false);
    assert.equal(app.$('#refresh-dashboard').disabled, true);
    assert.equal(app.d.documentElement.dataset.forjaAuth, 'locked', 'não pode liberar closures de A para B');
  } finally { release.resolve(); }
});
await test('11. HTTP normal: corpo completo dentro do prazo mantém sessão e dados', async () => {
  const fixture = new AuthFixture(), app = await open(fixture); await ready(app);
  const transport = await unitBodyTransport(app);
  try {
    const entered = transport.queue('normal', fixture.user(USERS.A));
    const result = await app.F.auth.revalidate(); await entered;
    assert.equal(result.id, USERS.A); assert.equal(app.F.auth.isVerified(), true);
    assert.equal(transport.signals[0].aborted, false); assert.equal(transport.requests[0].finishAttempts, 1);
  } finally { await transport.stop(); }
});
await test('12. Cabeçalhos chegam primeiro: corpo atrasado conclui a revalidação silenciosa sem bloqueio', async () => {
  const fixture = new AuthFixture(), app = await open(fixture); await ready(app);
  const transport = await unitBodyTransport(app);
  try {
    const entered = transport.queue('delayed', fixture.user(USERS.A), 200);
    const checking = app.F.auth.revalidate(); const request = await entered;
    // Sessão já verificada: a revalidação é silenciosa e a interface permanece
    // liberada enquanto o corpo atrasado ainda não chegou.
    assert.equal(request.finishAttempts, 0);
    assert.equal(app.d.documentElement.dataset.forjaAuth, 'ready');
    await checking;
    assert.equal(app.d.documentElement.dataset.forjaAuth, 'ready');
    assert.equal(app.F.auth.isVerified(), true);
    assert.equal(transport.signals[0].aborted, false);
  } finally { await transport.stop(); }
});
await test('13. Corpo atrasado além de 12 s não altera B validada no retry seguinte', async () => {
  const fixture = new AuthFixture(), app = await open(fixture); await ready(app); keepDocument(app);
  const transport = await unitBodyTransport(app);
  try {
    const entered = transport.queue('delayed', fixture.user(USERS.A), 13000);
    const checking = app.F.auth.revalidate(); const request = await entered;
    await until(() => app.F.auth.state === 'error', 'corpo atrasado não expirou', 14500); await checking;
    assert.equal(transport.signals[0].aborted, true); transport.disable();
    const b = fixture.issue(USERS.B); replace(app, b);
    await until(() => app.F.auth.isVerified(USERS.B), 'retry B não validou');
    await until(() => request.finishAttempts === 1, 'servidor não tentou a conclusão atrasada', 2500);
    assert.equal(app.F.auth.user.id, USERS.B);
    assert.equal(JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY)).access_token, b.access_token);
  } finally { await transport.stop(); }
});
await test('14. Falha durante leitura do corpo mantém gate fechado e sessão recuperável', async () => {
  const fixture = new AuthFixture(), app = await open(fixture); await ready(app);
  const transport = await unitBodyTransport(app);
  try {
    transport.queue('broken', fixture.user(USERS.A)); await app.F.auth.revalidate();
    assert.equal(app.F.auth.state, 'error'); assert.equal(app.F.auth.canWrite(), false);
    assert.equal(app.$('#auth-retry').hidden, false);
    assert.equal(JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY)).access_token, fixture.defaultSession.access_token);
    transport.disable(); app.click('#auth-retry'); await ready(app);
    assert.equal(app.F.auth.user.id, USERS.A);
  } finally { await transport.stop(); }
});
await test('15. Troca de geração cancela corpo pendente A sem esperar timeout e valida B separadamente', async () => {
  const fixture = new AuthFixture(), app = await open(fixture); await ready(app); keepDocument(app);
  const transport = await unitBodyTransport(app, fixture.defaultSession.access_token);
  try {
    const entered = transport.queue('hanging', fixture.user(USERS.A)); const checking = app.F.auth.revalidate(); const request = await entered;
    const b = fixture.issue(USERS.B); replace(app, b);
    await until(() => app.F.auth.isVerified(USERS.B), 'B ficou presa na operação antiga', 2000);
    await checking; await until(() => request.aborted, 'corpo da geração A não foi cancelado');
    assert.equal(transport.signals[0].aborted, true);
    request.finish(); await tick(50); assert.equal(app.F.auth.user.id, USERS.B);
    assert.equal(app.d.documentElement.dataset.forjaAuth, 'locked', 'UI/driver antigos não podem ser liberados para B');
  } finally { await transport.stop(); }
});
await test('16. Logout invalida getUser pendente; resposta A atrasada não vence novo Google B', async () => {
  const fixture = new AuthFixture(), app = await open(fixture); await ready(app); keepDocument(app);
  const handle = fixture.handle.bind(fixture), entered = deferred(), release = deferred();
  fixture.handle = async (input, options) => {
    if (String(input).endsWith('/auth/v1/user') && new Headers(options.headers).get('authorization') === 'Bearer ' + fixture.defaultSession.access_token) { entered.resolve(); await release.promise; }
    return handle(input, options);
  };
  try {
    const checking = app.F.auth.revalidate(); await within(entered.promise, 'getUser A não iniciou');
    await app.F.auth.signOut(); fixture.oauthUser = USERS.B; const b = await beginGoogleB(app, fixture);
    await until(() => app.F.auth.isVerified(USERS.B), 'B esperou getUser antigo', 2000);
    release.resolve(); await checking; await tick(50);
    assert.equal(app.F.auth.user.id, USERS.B);
    assert.equal(JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY)).access_token, b.access_token);
    assert.ok(fixture.requests.filter(r => r.url.includes('/auth/v1/logout')).every(r => r.headers.authorization !== 'Bearer ' + b.access_token));
  } finally { release.resolve(); }
});
await test('17. Evento de logout antigo/removido ou pertencente a A não bloqueia B atual', async () => {
  const fixture = new AuthFixture(), b = fixture.issue(USERS.B);
  const app = await open(fixture, { local: fixture.seed(USERS.B, { 'forja-perfil-v1': PROFILE }, { session: b }) }); await ready(app);
  const key = 'forja-auth-logout-v1', marker = JSON.stringify({ userId: USERS.A, at: Date.now(), nonce: 'fixture-old-generation' });
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key, newValue: marker }));
  assert.equal(app.F.auth.isVerified(USERS.B), true); assert.equal(app.d.documentElement.dataset.forjaAuth, 'ready');
  app.w.localStorage.setItem(key, marker);
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key, newValue: marker }));
  assert.equal(app.F.auth.isVerified(USERS.B), true); assert.equal(app.d.documentElement.dataset.forjaAuth, 'ready');
  assert.equal(app.w.sessionStorage.getItem('forja-auth-signed-out-v1'), null);
});
await test('18. HTTP sem cabeçalhos também expira/aborta aos 12 s e permite retry', async () => {
  const fixture = new AuthFixture(), app = await open(fixture); await ready(app);
  const transport = await unitBodyTransport(app);
  try {
    const entered = transport.queue('headers-hanging', fixture.user(USERS.A)), started = Date.now();
    const checking = app.F.auth.revalidate(); const request = await entered;
    await until(() => app.F.auth.state === 'error', 'espera por cabeçalhos não expirou', 14500); await checking;
    assert.ok(Date.now() - started >= 11700); assert.equal(request.headersAt, null);
    assert.equal(transport.signals[0].aborted, true); await until(() => request.aborted, 'HTTP sem cabeçalhos não foi cancelado');
    transport.disable(); app.click('#auth-retry'); await ready(app);
  } finally { await transport.stop(); }
});
await test('19. HTTP com corpo infinito em progresso não reinicia o prazo total de 12 s', async () => {
  const fixture = new AuthFixture(), app = await open(fixture); await ready(app);
  const transport = await unitBodyTransport(app);
  try {
    const entered = transport.queue('streaming', fixture.user(USERS.A)), started = Date.now();
    const checking = app.F.auth.revalidate(); const request = await entered;
    await until(() => app.F.auth.state === 'error', 'stream infinito não expirou', 14500); await checking;
    assert.ok(Date.now() - started >= 11700); assert.ok(request.chunks >= 3);
    assert.equal(transport.signals[0].aborted, true); await until(() => request.aborted, 'stream infinito não foi cancelado');
    assert.equal(app.F.auth.canWrite(), false); transport.disable(); app.click('#auth-retry'); await ready(app);
  } finally { await transport.stop(); }
});
console.log(`\nAUTH RECOVERY — ${passed}/${passed + failed} testes aprovados. SDK real, HTTP simulado/local, zero SQL.`);
if (failed) process.exitCode = 1;
