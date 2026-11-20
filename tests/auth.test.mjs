/* SDK Supabase real + HTTP simulado. Nenhuma conexão Google/Supabase real, nenhum SQL. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { App, BASE, closeAllApps } from './helpers/harness.mjs';
import { AuthFixture, USERS, PROFILE, AUTH_STORAGE_KEY, AUTH_URL, DATA_PREFIX, TAB_PREFIX, COPY_KEY, completedJournal, checksum } from './helpers/auth-fixture.mjs';
import { installFailingStorage } from './helpers/legacy-flows.mjs';
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
const P = 'forja-perfil-v1';
const sleepUntil = async (condition, message, timeout = 6000) => {
  const deadline = Date.now() + timeout;
  while (!condition()) { if (Date.now() > deadline) throw new Error(message); await tick(15); }
};
async function open(fixture = new AuthFixture(), { page = 'index.html', local = fixture.seed(USERS.A, { [P]: PROFILE }), session = {}, locks = true } = {}) {
  const app = new App({ fixture, locks });
  await app.load(BASE + page, { local, session });
  return app;
}
// "Pronto" significa: sessão verificada, dados vinculados (nas páginas do
// app) e página iniciada. O atributo data-forja-auth="ready" libera a
// interface logo após a verificação da sessão; a ligação dos dados e o
// boot completo seguem atrás. A administração não usa o namespace da conta.
const ready = async app => {
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'ready', 'página não liberou: ' + app.w.location.href + ' ' + app.text('#auth-gate-status'));
  if (app.F.authData) await sleepUntil(() => app.F.authData?.userId, 'dados da conta não foram vinculados');
  if (app.F.ready) await app.F.ready;
};
const login = app => sleepUntil(() => app.d.body.dataset.page === 'login', 'não chegou ao login');
async function replaceSession(app, fixture, session, uid) {
  const old = app.w.localStorage.getItem(AUTH_STORAGE_KEY);
  if (uid) {
    app.w.localStorage.setItem(DATA_PREFIX(uid) + P, JSON.stringify({ ...PROFILE, nomeExibicao: uid === USERS.B ? 'Conta B' : 'Conta A' }));
    app.w.localStorage.setItem(COPY_KEY(uid), completedJournal(uid));
  }
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key: AUTH_STORAGE_KEY, oldValue: old, newValue: JSON.stringify(session) }));
}
let passed = 0, failed = 0;
async function test(name, task) {
  try { await task(); passed++; console.log('✅ AUTH ' + name); }
  catch (error) { failed++; console.error('❌ AUTH ' + name + '\n' + error.stack); }
  finally { closeAllApps(); }
}
await test('1. As 15 páginas rejeitam acesso direto sem sessão e preservam o destino', async () => {
  const pages = ['index.html','onboarding/index.html','treino/index.html','treino/calistenia.html','treino/musculacao.html','treino/biblioteca.html','treino/grupo.html','treino/rotina.html','treino/executar.html','progresso/index.html','explorar/index.html','explorar/atlas.html','exercicio/index.html','configuracoes/index.html','admin/exercicios.html'];
  for (const page of pages) {
    const app = await open(new AuthFixture(), { page, local: {} });
    await login(app);
    assert.equal(new URL(app.w.location.href).searchParams.get('next'), page);
    assert.equal(app.F.auth.isVerified(), false);
    app.close();
  }
});
await test('2. Google + PKCE S256 real, troca de código e retorno com query/fragmento', async () => {
  const fixture = new AuthFixture();
  const local = fixture.seed(USERS.A, { [P]: PROFILE }); delete local[AUTH_STORAGE_KEY];
  const target = 'progresso/index.html?origem=login#progress-goals-heading';
  const app = await open(fixture, { page: 'login.html?next=' + encodeURIComponent(target), local });
  await sleepUntil(() => !app.$('#google-login').disabled, 'botão indisponível');
  app.click('#google-login');
  await sleepUntil(() => app.externalNavigations.length, 'OAuth não iniciou');
  const authorize = new URL(app.externalNavigations[0]);
  assert.equal(authorize.origin, AUTH_URL);
  assert.equal(authorize.searchParams.get('provider'), 'google');
  assert.equal(authorize.searchParams.get('code_challenge_method').toLowerCase(), 's256');
  assert.equal(authorize.searchParams.get('redirect_to'), BASE + 'login.html');
  assert.ok(authorize.searchParams.get('code_challenge'));
  const response = await fixture.handle(authorize.href);
  await app.go(response.headers.get('location'));
  await sleepUntil(() => app.w.location.href === BASE + target, 'destino solicitado foi perdido');
  await ready(app);
  const exchange = fixture.requests.find(r => r.url.includes('grant_type=pkce'));
  assert.ok(exchange.body.code_verifier.length >= 43);
  assert.equal(app.F.auth.user.id, USERS.A);
  assert.ok(!app.w.location.href.includes('code='));
});
await test('3. Cancelamento OAuth mantém o app bloqueado e permite nova tentativa', async () => {
  const fixture = new AuthFixture(); fixture.oauthMode = 'cancel';
  const app = await open(fixture, { page: 'login.html', local: {} });
  app.click('#google-login');
  await sleepUntil(() => app.externalNavigations.length, 'OAuth não iniciou');
  const response = await fixture.handle(app.externalNavigations[0]);
  await app.go(response.headers.get('location'));
  assert.equal(app.F.auth.isVerified(), false);
  assert.match(app.text('#login-status'), /cancelado|não autorizado/i);
  assert.equal(app.w.location.search, '');
  assert.equal(app.$('#google-login').disabled, false);
});
await test('4. Código inválido não vira sessão; retorno sem tentativa PKCE é rejeitado', async () => {
  const fixture = new AuthFixture();
  const app = await open(fixture, { page: 'login.html?code=nao-e-um-codigo', local: {} });
  assert.equal(app.F.auth.isVerified(), false);
  assert.equal(app.w.location.search, '');
  assert.match(app.text('#login-status'), /outra aba|expirou/i);
  app.click('#google-login'); await sleepUntil(() => app.externalNavigations.length, 'não iniciou');
  await app.go(BASE + 'login.html?code=codigo-invalido');
  assert.equal(app.F.auth.isVerified(), false);
  assert.match(app.text('#login-status'), /nova tentativa/i);
});
await test('5. Fluxo implícito com tokens no fragmento é rejeitado e limpo', async () => {
  const app = await open(new AuthFixture(), { page: 'login.html#access_token=falso&refresh_token=falso', local: {} });
  assert.equal(app.F.auth.isVerified(), false);
  assert.equal(app.w.location.hash, '');
  assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY), null);
});
await test('6. Sessão persistida é validada no servidor a cada reload', async () => {
  const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
  const before = fixture.requests.filter(r => r.url.endsWith('/auth/v1/user')).length;
  await app.reload(); await ready(app);
  assert.equal(app.F.auth.user.id, USERS.A);
  assert.ok(fixture.requests.filter(r => r.url.endsWith('/auth/v1/user')).length > before);
  assert.equal(fixture.requests.filter(r => r.url.includes('grant_type=pkce')).length, 0);
});
await test('7. Token expirado é renovado pelo SDK antes de liberar dados', async () => {
  const fixture = new AuthFixture();
  const expired = fixture.issue(USERS.A, { expiresAt: Math.floor(Date.now() / 1000) - 60 });
  const app = await open(fixture, { local: fixture.seed(USERS.A, { [P]: PROFILE }, { session: expired }) });
  await ready(app);
  assert.ok(fixture.requests.some(r => r.url.includes('grant_type=refresh_token')));
  assert.notEqual(JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY)).access_token, expired.access_token);
  assert.equal(app.F.auth.user.id, USERS.A);
});
await test('8. Refresh revogado/expirado não libera a página', async () => {
  const fixture = new AuthFixture();
  const expired = fixture.issue(USERS.A, { expiresAt: Math.floor(Date.now() / 1000) - 60 });
  fixture.refreshes.clear();
  const app = await open(fixture, { local: fixture.seed(USERS.A, { [P]: PROFILE }, { session: expired }) });
  await login(app);
  assert.equal(app.F.auth.isVerified(), false);
});
await test('9. Logout bloqueia imediatamente e preserva dados mesmo com falha de rede', async () => {
  const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
  const raw = app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P);
  fixture.failLogout = true;
  const pending = app.F.auth.signOut();
  assert.equal(app.F.auth.canWrite(), false);
  assert.equal(app.d.documentElement.dataset.forjaAuth, 'locked');
  await pending; await login(app);
  assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY), null);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P), raw);
  await app.reload();
  assert.equal(app.F.auth.isVerified(), false);
});
await test('10. Sessão local adulterada não substitui o getUser autoritativo', async () => {
  const fixture = new AuthFixture();
  const spoof = structuredClone(fixture.defaultSession); spoof.user.id = USERS.B; spoof.user.app_metadata.provider = 'google';
  const app = await open(fixture, { local: fixture.seed(USERS.B, { [P]: PROFILE }, { session: spoof }) });
  assert.notEqual(app.d.documentElement.dataset.forjaAuth, 'ready');
  assert.equal(app.F.auth.isVerified(), false);
});
await test('11. Outros provedores e contas anônimas são recusados', async () => {
  for (const options of [{ provider: 'email' }, { anonymous: true }]) {
    const fixture = new AuthFixture(); const denied = fixture.issue(USERS.C, options);
    denied.user.user_metadata.provider = 'google';
    const app = await open(fixture, { local: fixture.seed(USERS.C, { [P]: PROFILE }, { session: denied }) });
    assert.equal(app.F.auth.isVerified(), false);
    assert.notEqual(app.d.documentElement.dataset.forjaAuth, 'ready'); app.close();
  }
});
await test('12. UID A→B→A: namespaces, preferências e perfil não se misturam', async () => {
  const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
  app.F.store.write('forja-preferencias-v1', { soundOnRest: false, vibrateOnRest: false });
  const rawA = app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + 'forja-preferencias-v1');
  const b = fixture.issue(USERS.B);
  await replaceSession(app, fixture, b, USERS.B);
  await sleepUntil(() => app.F.auth.user?.id === USERS.B && app.d.documentElement.dataset.forjaAuth === 'ready' && app.F.authData?.userId === USERS.B, 'troca B não concluiu');
  assert.equal(app.F.state.profile.nomeExibicao, 'Conta B');
  assert.equal(app.F.store.readRaw('forja-preferencias-v1'), null);
  app.F.store.write('forja-preferencias-v1', { soundOnRest: true, vibrateOnRest: true });
  await replaceSession(app, fixture, fixture.defaultSession);
  await sleepUntil(() => app.F.auth.user?.id === USERS.A && app.d.documentElement.dataset.forjaAuth === 'ready' && app.F.authData?.userId === USERS.A, 'volta A não concluiu');
  assert.equal(app.F.store.readRaw('forja-preferencias-v1'), rawA);
});
await test('13. Escrita com token antigo é bloqueada antes do evento storage', async () => {
  const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
  const before = app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P);
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(fixture.issue(USERS.B)));
  assert.equal(app.F.auth.canWrite(), false);
  assert.equal(app.F.store.write(P, { nomeExibicao: 'não deve salvar' }).ok, false);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P), before);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.B) + P), null);
});
await test('14. Refresh em outra aba da mesma conta revalida sem apagar dados/logout', async () => {
  const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
  const dom = app.dom;
  const refreshed = fixture.issue(USERS.A);
  await replaceSession(app, fixture, refreshed);
  await sleepUntil(() => app.F.auth.isVerified() && app.d.documentElement.dataset.forjaAuth === 'ready' && app.F.authData?.userId === USERS.A, 'refresh não revalidou');
  assert.equal(app.dom, dom);
  assert.equal(app.F.auth.user.id, USERS.A);
  assert.ok(app.F.state.profile.updatedAt);
});
await test('15. Resposta getUser atrasada não aceita token substituído no meio da validação', async () => {
  const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
  fixture.userDelay = 100;
  const pending = app.F.auth.revalidate();
  await tick(20);
  const b = fixture.issue(USERS.B);
  app.w.localStorage.setItem(DATA_PREFIX(USERS.B) + P, JSON.stringify({ ...PROFILE, nomeExibicao: 'B atrasado' }));
  app.w.localStorage.setItem(COPY_KEY(USERS.B), completedJournal(USERS.B));
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(b));
  await pending;
  await sleepUntil(() => app.F.auth.user?.id === USERS.B && app.d.documentElement.dataset.forjaAuth === 'ready' && app.F.authData?.userId === USERS.B, 'resposta antiga venceu');
  assert.equal(app.F.state.profile.nomeExibicao, 'B atrasado');
});
await test('16. Legado exige consentimento; strings, segurança e desconhecidos são preservados', async () => {
  const fixture = new AuthFixture();
  const profile = JSON.stringify({ ...PROFILE, nomeExibicao: 'Legado A', campoFuturo: { preservar: true } }, null, 2);
  const local = { [AUTH_STORAGE_KEY]: JSON.stringify(fixture.defaultSession), [P]: profile, 'forja-futuro-v7': ' { "bytes": [1, 2] } ', 'forja-backup-seguranca-v1': '{"snapshot":"preservado"}', 'forja-auth-credencial': 'NUNCA ENVIAR', 'outro-aplicativo': 'intacto' };
  const app = await open(fixture, { local, session: { 'forja-onboarding-rascunho-v1': '{"versao":2,"respostas":{"nomeExibicao":"rascunho A"}}' } });
  assert.equal(app.$('#auth-legacy-choice').hidden, false);
  assert.equal(app.w.localStorage.getItem('forja-auth-legacy-owner-v1'), null);
  app.click('#auth-import-confirm'); await ready(app);
  assert.equal(await app.F.authData.runInitialCopy(), true);
  assert.equal(app.w.localStorage.getItem(P), profile);
  assert.equal(app.w.localStorage.getItem('outro-aplicativo'), 'intacto');
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + 'forja-futuro-v7'), local['forja-futuro-v7']);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + 'forja-backup-seguranca-v1'), local['forja-backup-seguranca-v1']);
  assert.ok(app.w.sessionStorage.getItem(TAB_PREFIX(USERS.A) + 'forja-onboarding-rascunho-v1'));
  const row = [...fixture.imports.values()][0];
  assert.equal(row.user_id, USERS.A); assert.equal(row.raw_by_key[P], profile);
  assert.equal(row.raw_by_key['forja-auth-credencial'], undefined);
  assert.equal(row.raw_by_key['forja-backup-seguranca-v1'], undefined);
  assert.equal(row.checksum, checksum(row.raw_by_key));
  assert.ok(fixture.requests.find(r => r.method === 'POST' && r.url.includes('/rest/v1/user_data_imports')).headers.prefer.includes('resolution=ignore-duplicates'));
});
await test('17. Recusar o vínculo mantém o legado intocado e não o atribui à conta', async () => {
  const fixture = new AuthFixture(); const raw = JSON.stringify({ ...PROFILE, nomeExibicao: 'não vincular' });
  const app = await open(fixture, { local: { [P]: raw, [AUTH_STORAGE_KEY]: JSON.stringify(fixture.defaultSession) } });
  app.click('#auth-import-skip'); await ready(app);
  assert.equal(app.w.localStorage.getItem(P), raw);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P), null);
  assert.equal(app.w.localStorage.getItem('forja-auth-legacy-owner-v1'), null);
});
await test('18. Falha de cota ao gravar journal não descarta origem; retry recupera', async () => {
  const fixture = new AuthFixture(); const raw = JSON.stringify(PROFILE);
  const app = await open(fixture, { local: { [P]: raw, [AUTH_STORAGE_KEY]: JSON.stringify(fixture.defaultSession) } });
  const failing = installFailingStorage(app, { failOn: COPY_KEY(USERS.A), times: 1 });
  app.click('#auth-import-confirm');
  await sleepUntil(() => !app.$('#auth-retry').hidden, 'falha não foi informada');
  assert.equal(app.w.localStorage.getItem(P), raw);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P), null);
  assert.equal(JSON.parse(app.w.localStorage.getItem('forja-auth-legacy-owner-v1')).userId, USERS.A);
  failing.restore();
  await app.F.retryBoot(); await ready(app);
  assert.equal(app.F.state.profile.objetivo, PROFILE.objetivo);
});
await test('19. Journal interrompido retoma cópia parcial sem reatribuir o dono', async () => {
  const fixture = new AuthFixture(); const rawByKey = { [P]: JSON.stringify(PROFILE), 'forja-futuro': '"origem"' };
  const journal = { version: 1, userId: USERS.A, source: 'legacy', phase: 'preparing', rawByKey, rawSessionByKey: {}, checksum: checksum(rawByKey) };
  const app = await open(fixture, { local: { ...rawByKey, [AUTH_STORAGE_KEY]: JSON.stringify(fixture.defaultSession), 'forja-auth-legacy-owner-v1': JSON.stringify({ version: 1, userId: USERS.A }), [COPY_KEY(USERS.A)]: JSON.stringify(journal), [DATA_PREFIX(USERS.A) + P]: rawByKey[P] } });
  await ready(app);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + 'forja-futuro'), '"origem"');
  assert.equal(app.w.localStorage.getItem('forja-futuro'), '"origem"');
});
await test('20. Recuperação com destino conflitante para sem sobrescrever nada', async () => {
  const fixture = new AuthFixture(); const rawByKey = { [P]: JSON.stringify(PROFILE) };
  const app = await open(fixture, { local: { ...rawByKey, [AUTH_STORAGE_KEY]: JSON.stringify(fixture.defaultSession), 'forja-auth-legacy-owner-v1': JSON.stringify({ version: 1, userId: USERS.A }), [COPY_KEY(USERS.A)]: JSON.stringify({ version: 1, userId: USERS.A, source: 'legacy', phase: 'preparing', rawByKey, rawSessionByKey: {}, checksum: checksum(rawByKey) }), [DATA_PREFIX(USERS.A) + P]: '"conflito"' } });
  assert.notEqual(app.d.documentElement.dataset.forjaAuth, 'ready');
  assert.match(app.text('#auth-gate-status'), /diferentes/);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P), '"conflito"');
  assert.equal(app.w.localStorage.getItem(P), rawByKey[P]);
});
await test('21. Dono inválido e checksum corrompido não viram legado vazio', async () => {
  for (const badOwner of [true, false]) {
    const fixture = new AuthFixture(); const local = fixture.seed(USERS.A, { [P]: PROFILE });
    if (badOwner) local['forja-auth-legacy-owner-v1'] = '{"version":1,"userId":"INVALIDO"}';
    else { const entry = JSON.parse(local[COPY_KEY(USERS.A)]); entry.checksum = '0'.repeat(64); local[COPY_KEY(USERS.A)] = JSON.stringify(entry); }
    const app = await open(fixture, { local });
    assert.notEqual(app.d.documentElement.dataset.forjaAuth, 'ready');
    assert.ok(app.text('#auth-gate-status').includes(badOwner ? 'inválido' : 'checksum'));
    assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P), JSON.stringify(PROFILE)); app.close();
  }
});
await test('22. Readback divergente não conclui; retry é INSERT idempotente, nunca UPDATE', async () => {
  const fixture = new AuthFixture(); fixture.badReadback = true;
  const local = fixture.seed(USERS.A, { [P]: PROFILE }, { completed: false });
  const app = await open(fixture, { local }); await ready(app);
  assert.equal(await app.F.authData.runInitialCopy(), false);
  assert.equal(JSON.parse(app.w.localStorage.getItem(COPY_KEY(USERS.A))).phase, 'pending');
  fixture.badReadback = false;
  assert.equal(await app.F.authData.runInitialCopy(), true);
  assert.equal(fixture.imports.size, 1);
  assert.equal(fixture.requests.some(r => ['PATCH', 'PUT'].includes(r.method)), false);
  const before = fixture.requests.filter(r => r.url.includes('/rest/v1/user_data_imports')).length;
  app.F.store.write('forja-futuro-diario', { modificado: true });
  await app.F.authData.runInitialCopy();
  assert.equal(fixture.requests.filter(r => r.url.includes('/rest/v1/user_data_imports')).length, before, 'não deve reenviar a cópia imutável para sincronizar uso diário');
});
await test('23. Falha remota deixa retry e conserva integralmente o journal local', async () => {
  const fixture = new AuthFixture(); fixture.failRest = true;
  const app = await open(fixture, { local: fixture.seed(USERS.A, { [P]: PROFILE }, { completed: false }) }); await ready(app);
  assert.equal(await app.F.authData.runInitialCopy(), false);
  const entry = JSON.parse(app.w.localStorage.getItem(COPY_KEY(USERS.A)));
  assert.equal(entry.rawByKey[P], JSON.stringify(PROFILE)); assert.equal(entry.phase, 'pending');
  fixture.failRest = false;
  assert.equal(await app.F.authData.runInitialCopy(), true);
});
await test('24. Navegador sem Web Locks não faz vínculo inseguro do legado', async () => {
  const fixture = new AuthFixture(); const local = { [P]: JSON.stringify(PROFILE), [AUTH_STORAGE_KEY]: JSON.stringify(fixture.defaultSession) };
  const app = await open(fixture, { local, locks: false });
  app.click('#auth-import-confirm');
  await sleepUntil(() => !app.$('#auth-retry').hidden, 'ausência de Web Locks não foi informada');
  assert.match(app.text('#auth-gate-status'), /Web Locks/);
  assert.equal(app.w.localStorage.getItem('forja-auth-legacy-owner-v1'), null);
  assert.equal(app.w.localStorage.getItem(P), local[P]);
});
await test('25. Backup/importação não incluem sessão, journals, arquivos ou dados de B', async () => {
  const fixture = new AuthFixture(); const local = fixture.seed(USERS.A, { [P]: PROFILE });
  local[DATA_PREFIX(USERS.B) + 'forja-futuro-b'] = '"PRIVADO B"';
  const app = await open(fixture, { page: 'configuracoes/index.html', local }); await ready(app);
  const backup = app.F.buildBackupObject();
  assert.equal(JSON.stringify(backup).includes('PRIVADO B'), false);
  assert.equal(JSON.stringify(backup).includes(fixture.defaultSession.access_token), false);
  assert.equal(Object.keys(backup.keys).some(k => /auth-|arquivo-/.test(k)), false);
  for (const key of ['forja-auth-v1', 'forja-arquivo-conta-b', 'forja-api-key']) assert.throws(() => app.F.registry.validateKey(key, {}));
});
await test('26. HTTP/RLS SIMULADO: JWT A não lê, insere, atualiza ou apaga cópia de B', async () => {
  const fixture = new AuthFixture(); const b = fixture.issue(USERS.B);
  const row = { user_id: USERS.B, checksum: checksum({}), format_version: 1, raw_by_key: {} };
  const bHeaders = { authorization: 'Bearer ' + b.access_token, 'content-type': 'application/json' };
  const aHeaders = { authorization: 'Bearer ' + fixture.defaultSession.access_token, 'content-type': 'application/json' };
  assert.equal((await fixture.handle(AUTH_URL + '/rest/v1/user_data_imports', { method: 'POST', headers: bHeaders, body: JSON.stringify(row) })).status, 201);
  const endpoint = AUTH_URL + '/rest/v1/user_data_imports?user_id=eq.' + USERS.B;
  assert.deepEqual(await (await fixture.handle(endpoint, { headers: aHeaders })).json(), []);
  assert.equal((await fixture.handle(endpoint, { method: 'POST', headers: aHeaders, body: JSON.stringify(row) })).status, 403);
  assert.equal((await fixture.handle(endpoint, { method: 'PATCH', headers: aHeaders, body: JSON.stringify({ raw_by_key: {} }) })).status, 403);
  assert.deepEqual(await (await fixture.handle(endpoint, { method: 'DELETE', headers: aHeaders })).json(), []);
  assert.equal(fixture.imports.size, 1);
});
await test('27. Redirects externos, outra instalação e caminhos codificados são recusados', async () => {
  const app = await open(); await ready(app);
  for (const bad of ['https://evil.test/', '//evil.test/', 'javascript:alert(1)', '../index.html', '/outro-app/index.html', '%2f%2fevil.test', 'treino\\index.html', 'assets/js/forja-core.js', 'login.html']) assert.equal(app.F.auth.safeReturn(bad), null, bad);
  assert.equal(app.F.auth.safeReturn(BASE + 'treino/?x=1#preferences-heading'), 'treino/index.html?x=1#preferences-heading');
});
await test('28. Configuração ausente mantém login/protegidas fechados, sem fallback visitante', async () => {
  const fixture = new AuthFixture(); fixture.configured = false;
  const app = await open(fixture, { local: {} });
  assert.notEqual(app.d.documentElement.dataset.forjaAuth, 'ready');
  assert.match(app.text('#auth-gate-status'), /chave pública/i);
});
await test('29. Expiração durante uso bloqueia leitura/escrita mesmo sem evento/timer', async () => {
  const app = await open(); await ready(app);
  app.w.Date.now = () => 4200000000000;
  assert.equal(app.F.auth.canWrite(), false);
  assert.equal(app.F.store.write('forja-futuro', {}).ok, false);
});
await test('30. Guard estático, JS desativado, BFCache e ordem de scripts são fail closed', async () => {
  const html = fs.readFileSync('treino/rotina.html', 'utf8');
  assert.match(html, /<html[^>]+data-forja-auth="locked"/);
  assert.ok(html.indexOf('auth-guard.css') < html.indexOf('<body'));
  assert.ok(html.indexOf('forja-auth-data.js') < html.indexOf('forja-dados.js'));
  assert.match(html, /<noscript>/);
  const app = await open(); await ready(app);
  // Sessão verificada: pagehide (BFCache) não trava; o retorno é tratado
  // pelo pageshow, que revalida silenciosamente.
  app.w.dispatchEvent(new app.w.PageTransitionEvent('pagehide', { persisted: true }));
  assert.equal(app.d.documentElement.dataset.forjaAuth, 'ready', 'pagehide não trava com sessão verificada');
  app.w.dispatchEvent(new app.w.PageTransitionEvent('pageshow', { persisted: true }));
  await ready(app);
  // Rejeição definitiva (401): a sessão não é verificada e o pagehide trava.
  app.fixture.userErrors.set(app.fixture.defaultSession.access_token, { status: 401, code: 'bad_jwt' });
  await app.F.auth.revalidate();
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'locked', 'rejeição definitiva não travou');
  app.w.dispatchEvent(new app.w.PageTransitionEvent('pagehide', { persisted: true }));
  assert.equal(app.d.documentElement.dataset.forjaAuth, 'locked', 'pagehide trava sem sessão verificada');
});
await test('31. Conta alterada durante consentimento cancela o vínculo antigo e pede nova confirmação', async () => {
  const fixture = new AuthFixture(); const raw = JSON.stringify({ ...PROFILE, nomeExibicao: 'Sem vínculo' });
  const app = await open(fixture, { local: { [P]: raw, [AUTH_STORAGE_KEY]: JSON.stringify(fixture.defaultSession) } });
  await replaceSession(app, fixture, fixture.issue(USERS.B));
  await sleepUntil(() => !app.$('#auth-legacy-choice').hidden && app.text('#auth-gate-status').includes('conta-b@example.test'), 'não atualizou a conta da confirmação');
  assert.equal(app.w.localStorage.getItem('forja-auth-legacy-owner-v1'), null);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P), null);
  app.click('#auth-import-skip'); await ready(app);
  assert.equal(app.F.auth.user.id, USERS.B);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.B) + P), null);
  assert.equal(app.w.localStorage.getItem(P), raw);
});
await test('32. Storage físico só emite a chave lógica da conta ativa; infraestrutura e B não chegam ao domínio', async () => {
  const app = await open(); await ready(app);
  const events = [];
  app.w.addEventListener('storage', event => events.push(event.key));
  const original = app.F.state.profile.nomeExibicao;
  for (const key of [DATA_PREFIX(USERS.B) + P, COPY_KEY(USERS.B), 'forja-auth-legacy-owner-v1']) {
    app.w.dispatchEvent(new app.w.StorageEvent('storage', { key, newValue: '"outra conta"' }));
  }
  assert.deepEqual(events, []);
  assert.equal(app.F.state.profile.nomeExibicao, original);
  const raw = JSON.stringify({ ...PROFILE, nomeExibicao: 'Nome da conta ativa' });
  app.w.localStorage.setItem(DATA_PREFIX(USERS.A) + P, raw);
  app.storageWrites = [];
  app.allStorageWrites = [];
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key: DATA_PREFIX(USERS.A) + P, newValue: raw, url: app.w.location.href }));
  assert.deepEqual(events, [P]);
  assert.equal(app.F.state.profile.nomeExibicao, 'Nome da conta ativa');
  assert.match(app.text('#home-greeting'), /Nome da conta ativa/);
  assert.deepEqual(app.storageWrites, [], 'sincronização externa é somente-leitura');
});
await test('33. getUser 401 encerra a sessão local, preserva os dados e retorna ao login com destino', async () => {
  const fixture = new AuthFixture();
  fixture.userErrors.set(fixture.defaultSession.access_token, { status: 401, code: 'bad_jwt' });
  const local = fixture.seed(USERS.A, { [P]: PROFILE });
  const target = 'progresso/index.html?origem=sessao#progress-goals-heading';
  const app = await open(fixture, { page: target, local }); await login(app);
  assert.equal(new URL(app.w.location.href).searchParams.get('next'), target);
  assert.equal(app.F.auth.isVerified(), false);
  assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY), null);
  for (const key of [DATA_PREFIX(USERS.A) + P, COPY_KEY(USERS.A)]) assert.equal(app.w.localStorage.getItem(key), local[key]);
  assert.equal(fixture.requests.some(r => r.url.includes('/auth/v1/logout')), false, 'não revoga outra sessão por uma resposta rejeitada');
});
await test('34. Rejeição definitiva 403 durante o uso não prende a conta no gate de rede', async () => {
  const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
  const original = app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P);
  fixture.userErrors.set(fixture.defaultSession.access_token, { status: 403, code: 'user_banned' });
  const check = app.F.auth.revalidate();
  await check;
  assert.equal(app.d.documentElement.dataset.forjaAuth, 'locked');
  await login(app);
  assert.equal(app.F.auth.isVerified(), false);
  assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY), null);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P), original);
});
await test('35. HTTP 503/429 são transitórios: interface preservada, token mantido e revalidação silenciosa sem novo OAuth', async () => {
  for (const status of [503, 429]) {
    const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
    const original = app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P);
    fixture.userErrors.set(fixture.defaultSession.access_token, { status, code: 'temporarily_unavailable' });
    const check = app.F.auth.revalidate();
    await check;
    // A sessão continua válida: a interface autenticada permanece liberada,
    // sem tela bloqueante e sem exigir retry manual.
    assert.equal(app.d.body.dataset.page, 'inicio');
    assert.equal(app.d.documentElement.dataset.forjaAuth, 'ready');
    assert.equal(app.F.auth.isVerified(), true);
    assert.equal(app.F.auth.canWrite(), true);
    assert.equal(app.$('#auth-retry').hidden, true);
    assert.equal(JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY)).access_token, fixture.defaultSession.access_token);
    // Recuperação automática e silenciosa, sem nova autenticação Google.
    fixture.userErrors.clear();
    await sleepUntil(() => app.F.auth.isVerified() && app.d.documentElement.dataset.forjaAuth === 'ready' && app.F.authData?.userId,
      'revalidação silenciosa não recuperou', 8000);
    assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P), original);
    assert.equal(fixture.requests.some(r => r.url.includes('/auth/v1/authorize')), false);
    app.close();
  }
});
await test('36. Rejeição 401 atrasada de A não remove nem encerra a sessão nova de B', async () => {
  const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
  fixture.userDelay = 100;
  fixture.userErrors.set(fixture.defaultSession.access_token, { status: 401, code: 'bad_jwt' });
  const check = app.F.auth.revalidate(); await tick(20);
  const b = fixture.issue(USERS.B);
  await replaceSession(app, fixture, b, USERS.B);
  await check;
  await sleepUntil(() => app.F.auth.user?.id === USERS.B && app.d.documentElement.dataset.forjaAuth === 'ready' && app.F.authData?.userId === USERS.B, 'rejeição antiga encerrou B');
  assert.equal(JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY)).access_token, b.access_token);
  assert.equal(app.F.state.profile.nomeExibicao, 'Conta B');
});
await test('37. Login já aberto continua ao destino quando uma sessão Google válida chega depois', async () => {
  const fixture = new AuthFixture(); const local = fixture.seed(USERS.A, { [P]: PROFILE }); delete local[AUTH_STORAGE_KEY];
  const target = 'progresso/index.html?origem=outra-aba#progress-goals-heading';
  const app = await open(fixture, { page: 'login.html?next=' + encodeURIComponent(target), local });
  await replaceSession(app, fixture, fixture.defaultSession);
  await sleepUntil(() => app.w.location.href === BASE + target, 'login não reagiu à sessão verificada'); await ready(app);
  assert.equal(app.F.auth.user.id, USERS.A);
});
await test('38. Login restaurado por BFCache revalida e reabilita o Google após voltar sem callback', async () => {
  const app = await open(new AuthFixture(), { page: 'login.html', local: {} });
  app.click('#google-login'); await sleepUntil(() => app.externalNavigations.length === 1, 'OAuth não abriu');
  assert.equal(app.$('#google-login').disabled, true);
  app.w.dispatchEvent(new app.w.PageTransitionEvent('pageshow', { persisted: true }));
  await sleepUntil(() => !app.$('#google-login').disabled, 'voltar deixou o login desabilitado');
  assert.equal(app.F.auth.isVerified(), false);
  app.click('#google-login'); await sleepUntil(() => app.externalNavigations.length === 2, 'nova tentativa não abriu');
  assert.equal(new URL(app.externalNavigations[1]).searchParams.get('prompt'), 'select_account');
});
await test('39. Código/tokens de callback são limpos mesmo quando falta configuração pública', async () => {
  const fixture = new AuthFixture(); fixture.configured = false;
  const app = await open(fixture, { page: 'login.html?code=fixture-code&state=fixture-state#access_token=fixture-token', local: {} });
  assert.equal(app.w.location.search, ''); assert.equal(app.w.location.hash, '');
  assert.equal(app.F.auth.isVerified(), false);
  assert.match(app.text('#login-status'), /chave pública|configuração/i);
});
await test('40. Login recupera erro transitório após revalidação sem exigir outro clique no Google', async () => {
  const fixture = new AuthFixture(); fixture.userErrors.set(fixture.defaultSession.access_token, { status: 503, code: 'temporarily_unavailable' });
  const target = 'treino/index.html?origem=recuperacao';
  const app = await open(fixture, { page: 'login.html?next=' + encodeURIComponent(target) });
  await sleepUntil(() => app.F.auth.state === 'error', 'falha transitória não foi apresentada');
  fixture.userErrors.clear(); await app.F.auth.revalidate();
  await sleepUntil(() => app.w.location.href === BASE + target, 'sessão recuperada não continuou'); await ready(app);
});
await test('41. Callback cancelado/inválido não reutiliza sessão antiga recuperada pelo SDK', async () => {
  for (const callback of ['?error=access_denied', '?code=fixture-invalid-code']) {
    const app = await open(new AuthFixture(), { page: 'login.html' + callback });
    await tick(200);
    assert.equal(app.d.body.dataset.page, 'login');
    assert.equal(app.F.auth.isVerified(), false);
    assert.equal(app.F.auth.state, 'error');
    assert.equal(app.$('#google-login').disabled, false);
    assert.equal(app.w.location.search, '');
    app.close();
  }
});
await test('42. session_not_found 403 atrasado não permite ao SDK apagar a sessão nova de B', async () => {
  const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
  fixture.userErrors.set(fixture.defaultSession.access_token, { status: 403, code: 'session_not_found', delay: 150 });
  const check = app.F.auth.revalidate(); await tick(25);
  const b = fixture.issue(USERS.B); await replaceSession(app, fixture, b, USERS.B);
  await check;
  await sleepUntil(() => app.F.auth.user?.id === USERS.B && app.d.documentElement.dataset.forjaAuth === 'ready' && app.F.authData?.userId === USERS.B, 'SDK apagou B por rejeição antiga de A');
  assert.equal(JSON.parse(app.w.localStorage.getItem(AUTH_STORAGE_KEY)).access_token, b.access_token);
  assert.equal(app.F.state.profile.nomeExibicao, 'Conta B');
  assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY + '-verification'), null, 'verificação não persiste outra sessão');
  assert.equal(fixture.requests.some(r => r.url.includes('/auth/v1/logout')), false);
});
await test('43. session_not_found 403 da sessão atual ainda a encerra, sem apagar dados ou verifier paralelo', async () => {
  const fixture = new AuthFixture(); const app = await open(fixture); await ready(app);
  const original = app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P);
  const verifier = AUTH_STORAGE_KEY + '-code-verifier';
  app.w.localStorage.setItem(verifier, 'not-a-real-parallel-verifier');
  fixture.userErrors.set(fixture.defaultSession.access_token, { status: 403, code: 'session_not_found' });
  await app.F.auth.revalidate(); await login(app);
  assert.equal(app.F.auth.isVerified(), false);
  assert.equal(app.w.localStorage.getItem(AUTH_STORAGE_KEY), null);
  assert.equal(app.w.localStorage.getItem(DATA_PREFIX(USERS.A) + P), original);
  assert.equal(app.w.localStorage.getItem(verifier), 'not-a-real-parallel-verifier');
});
await test('44. error_code/error_description no callback são limpos, marcam .is-error no login e #account-email tem fallback seguro', async () => {
  for (const callback of ['?error_code=access_denied&error_description=Negado', '#error_code=oauth_failed&error_description=Falha']) {
    const app = await open(new AuthFixture(), { page: 'login.html' + callback });
    await tick(200);
    assert.equal(app.d.body.dataset.page, 'login');
    assert.equal(app.F.auth.isVerified(), false);
    assert.equal(app.F.auth.state, 'error');
    assert.equal(app.w.location.search, '');
    assert.equal(app.w.location.hash, '');
    assert.equal(app.$('#login-status').classList.contains('is-error'), true);
    assert.equal(app.$('#google-login').disabled, false);
    app.close();
  }
  const fixture = new AuthFixture();
  const s = fixture.issue(USERS.A);
  delete s.user.email;
  delete fixture.sessions.get(s.access_token).user.email;
  const app = await open(fixture, { page: 'configuracoes/index.html', local: fixture.seed(USERS.A, { [P]: PROFILE }, { session: s }) });
  await ready(app);
  assert.equal(app.text('#account-email'), 'Conta Google conectada');
  app.close();
});
await test('45. safeReturn limpa error_code/expires e transição error→guest no login restaura instrução neutra', async () => {
  const fixture = new AuthFixture();
  fixture.userErrors.set(fixture.defaultSession.access_token, { status: 503, code: 'temporarily_unavailable' });
  const app = await open(fixture, { page: 'login.html' });
  await sleepUntil(() => app.F.auth.state === 'error' && app.$('#login-status').classList.contains('is-error'), 'erro transitório no login não apareceu');
  assert.equal(app.F.auth.safeReturn(BASE + 'treino/?ok=1&error_code=x&expires_in=10#error_code=y'), 'treino/index.html?ok=1');
  assert.equal(app.F.auth.safeReturn(BASE + 'index.html?x=2#access_token=abc'), 'index.html?x=2');
  app.w.localStorage.removeItem(AUTH_STORAGE_KEY);
  await app.F.auth.revalidate();
  await sleepUntil(() => app.F.auth.state === 'guest', 'transição error→guest não ocorreu');
  assert.equal(app.$('#login-status').classList.contains('is-error'), false);
  assert.equal(app.text('#login-status'), 'Entre com sua conta Google para continuar.');
  app.close();
});
console.log(`\nAUTH — ${passed}/${passed + failed} testes aprovados (SDK real / HTTP simulado; zero SQL).`);
if (failed) process.exitCode = 1;
