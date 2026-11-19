/* Chromium/SDK reais, Auth/Google fictícios, barreiras explícitas. Zero SQL. */
import assert from 'node:assert/strict';
import { launchBrowser, startServer, waitReady, waitLogin } from './helpers/browser.mjs';
import { installBrowserAuth, browserSetSession } from './helpers/browser-auth.mjs';
import { AuthFixture, USERS, AUTH_STORAGE_KEY, DATA_PREFIX } from './helpers/auth-fixture.mjs';
import { twoAccounts } from './helpers/auth-recovery.mjs';
import { holdResponse, within, readyAs, holdNavigations, browserStorageFault, deferAuthNotifications, LOGOUT_KEY, assertFailedLogoutFor } from './helpers/auth-concurrency.mjs';
import { until, currentSession, sessionId, SIGNED_OUT, ATTEMPT, stayOnLogin, installMailbox, waitMessages, deliver, assertTokenless, lockController, observeSessionWrite, startRefresh, finishRefresh, allStorageUnavailable, authorizeLocation, isAuthorize } from './helpers/auth-lifecycle.mjs';
const server = await startServer(), browser = await launchBrowser({ enforceWebSecurity: true });
const base = server.origin + '/forja/', selected = process.env.FORJA_AUTH_CONCURRENCY_CASE;
let passed = 0, failed = 0;
async function test(name, task) {
  if (selected && !selected.split(',').includes(name.split('.')[0])) return;
  const context = await browser.createBrowserContext(), fixture = new AuthFixture(), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try { await task({ context, fixture, page }); assert.deepEqual(errors, [], 'exceções no navegador'); passed++; console.log('✅ BROWSER CONCURRENCY ' + name); }
  catch (error) { failed++; console.error('❌ BROWSER CONCURRENCY ' + name + '\n' + error.stack); }
  finally { await context.close(); }
}
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), AUTH_STORAGE_KEY);
async function seed(page, fixture, path = 'configuracoes/index.html', options = {}) {
  await installBrowserAuth(page, fixture, server.origin, options); await page.goto(base + path);
}
try {
  console.log('AUTH CONCURRENCY: segurança web/isolamento ativos; ' + await browser.version());
  for (const [id, method, key] of [[1, 'getItem', AUTH_STORAGE_KEY], [2, 'setItem', LOGOUT_KEY], [3, 'removeItem', AUTH_STORAGE_KEY]]) {
    await test(id + '. Botão logout com SecurityError em ' + method + ': fechado, botão restaurado e retry de saída', async ({ page, fixture }) => {
      fixture.failLogout = true; await seed(page, fixture); await waitReady(page);
      const original = await page.evaluate(key => localStorage.getItem(key), DATA_PREFIX(USERS.A) + 'forja-perfil-v1');
      const restore = await browserStorageFault(page, method, { key, armOnLogout: true });
      try {
        await page.click('#account-signout');
        await page.waitForFunction(() => window.authFixtureFault?.hits > 0 && document.querySelector('#account-signout')?.disabled === false, { timeout: 3000 });
        assert.equal(await page.evaluate(() => document.documentElement.dataset.forjaAuth), 'locked');
        assert.equal(await page.evaluate(() => Forja.auth.isVerified()), false);
        assert.notEqual(await page.evaluate(() => authFixtureFault.first.state), 'authenticated');
        assert.equal(await page.evaluate(() => authFixtureFault.first.gate), 'locked', 'o primeiro acesso recusado de signOut ocorreu antes do bloqueio');
      } finally { await restore(); }
      assert.equal(await page.evaluate(() => Forja.auth.canWrite()), false);
      await page.evaluate(() => Forja.auth.revalidate());
      assert.equal(await page.$eval('#auth-retry', el => el.hidden), false);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), DATA_PREFIX(USERS.A) + 'forja-perfil-v1'), original);
      await page.click('#auth-retry'); await waitLogin(page);
      assert.equal(await stored(page), null); assert.equal(await page.evaluate(() => Forja.auth.isVerified()), false);
      await page.reload(); await waitLogin(page);
    });
  }
  async function pending({ context, fixture: f, page: a }, { error = false } = {}) {
    await deferAuthNotifications(a);
    const facade = Object.create(f), original = f.handle.bind(f);
    facade.handle = async (input, options) => {
      const response = await original(input, options);
      return error && String(input).includes('grant_type=pkce')
        ? new Response(JSON.stringify({ code: 'bad_code_verifier', message: 'old exchange failed' }), { status: 400, headers: { 'content-type': 'application/json' } }) : response;
    };
    const hold = holdResponse(facade, url => url.includes('grant_type=pkce'));
    const local = twoAccounts(f); delete local[AUTH_STORAGE_KEY];
    await seed(a, facade, 'login.html', { local }); await a.waitForSelector('#google-login:not([disabled])');
    await a.click('#google-login'); await within(hold.entered, 'PKCE A não iniciou'); await holdNavigations(a);
    const b = await context.newPage(); await seed(b, f, 'login.html', { seed: false }); await b.waitForSelector('#google-login:not([disabled])');
    return { a, b, hold };
  }
  await test('4. PKCE A pendente não substitui B pronta com notificações de A ainda não entregues', async args => {
    const { a, b, hold } = await pending(args);
    try {
      args.fixture.oauthUser = USERS.B; await b.click('#google-login'); await readyAs(b, USERS.B);
      const expected = (await stored(b)).access_token;
      hold.release(); await within(hold.completed, 'resposta antiga não foi liberada'); await a.evaluate(() => Forja.auth.init());
      // Ler pelo documento A retido: no runtime defeituoso a escrita antiga
      // pode navegar B antes do CDP. O slot é compartilhado, a asserção não.
      assert.equal((await stored(a))?.access_token === expected, true, 'PKCE antigo substituiu B');
      assert.equal(await b.evaluate(id => Forja.auth.isVerified(id), USERS.B), true);
      assert.equal(await b.evaluate(() => Forja.auth.canWrite()), true);
    } finally { hold.restore(); }
  });
  await test('5. Erro PKCE antigo preserva verifier e callback de B ainda pendente', async args => {
    const { a, b, hold } = await pending(args, { error: true });
    const next = holdResponse(args.fixture, url => url.includes('/auth/v1/authorize'));
    try {
      args.fixture.oauthUser = USERS.B; await b.click('#google-login'); await within(next.entered, 'Google B não iniciou');
      const before = await a.evaluate(key => localStorage.getItem(key + '-code-verifier'), AUTH_STORAGE_KEY); assert.ok(before);
      hold.release(); await within(hold.completed, 'erro antigo não foi liberado'); await a.evaluate(() => Forja.auth.init());
      assert.equal(await a.evaluate((key, value) => localStorage.getItem(key + '-code-verifier') === value, AUTH_STORAGE_KEY, before), true, 'cleanup antigo apagou verifier de B');
      next.release(); await readyAs(b, USERS.B);
      assert.equal(await b.evaluate(() => Forja.auth.canWrite()), true);
    } finally { hold.restore(); next.restore(); }
  });
  await test('6. Callback A que chega após B concluída não reaproveita nem substitui a geração recente', async ({ context, fixture, page }) => {
    const local = twoAccounts(fixture); delete local[AUTH_STORAGE_KEY];
    const old = holdResponse(fixture, url => url.includes('/auth/v1/authorize'));
    try {
      await seed(page, fixture, 'login.html', { local }); await page.waitForSelector('#google-login:not([disabled])');
      await page.click('#google-login'); await within(old.entered, 'Google A não iniciou');
      const b = await context.newPage(); await seed(b, fixture, 'login.html', { seed: false }); await b.waitForSelector('#google-login:not([disabled])');
      fixture.oauthUser = USERS.B; await b.click('#google-login'); await readyAs(b, USERS.B); const expected = (await stored(b)).access_token;
      old.release(); await readyAs(page, USERS.B);
      assert.equal((await stored(b))?.access_token === expected, true);
    } finally { old.restore(); }
  });
  await test('7. SDK refresh → logout imediato → 503 encerra A também na outra aba e no reload', async ({ context, fixture, page }) => {
    fixture.failLogout = true; await seed(page, fixture); await waitReady(page);
    const other = await context.newPage(); await seed(other, fixture, '', { seed: false }); await waitReady(other);
    await page.evaluate(() => { void Forja.auth.client.auth.refreshSession().then(result => { if (result.error) throw result.error; return Forja.auth.signOut(); }); });
    await waitLogin(page); await waitLogin(other);
    assert.equal(await stored(other), null); assert.equal(await other.evaluate(() => Forja.auth.canWrite()), false);
    const rotated = [...fixture.sessions.values()].at(-1);
    assertFailedLogoutFor(fixture, rotated.access_token);
    await other.reload(); await waitLogin(other); assert.equal(await other.evaluate(() => Forja.auth.isVerified()), false);
  });
  await test('8. Clique na UI ainda anterior às notificações encerra refresh real feito pela outra aba', async ({ context, fixture, page }) => {
    fixture.failLogout = true; await deferAuthNotifications(page); await seed(page, fixture); await waitReady(page);
    const other = await context.newPage(); await seed(other, fixture, '', { seed: false }); await waitReady(other);
    await page.bringToFront(); await waitReady(page);
    const rotated = await other.evaluate(async () => { const result = await Forja.auth.client.auth.refreshSession(); if (result.error) throw result.error; return result.data.session.access_token; });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.forjaAuth), 'ready', 'a fixture precisa reter as notificações, não revalidar A');
    await page.click('#account-signout'); await waitLogin(page); await waitLogin(other);
    assert.equal(await stored(other), null);
    assertFailedLogoutFor(fixture, rotated);
  });
  await test('9. Logout de UI A rotacionada não encerra B já persistida por outro SDK', async ({ context, fixture, page }) => {
    await deferAuthNotifications(page); await seed(page, fixture); await waitReady(page);
    await page.evaluate(() => Forja.auth.client.auth.refreshSession()); await waitReady(page);
    const other = await context.newPage(); await seed(other, fixture, '', { seed: false }); await waitReady(other);
    const resume = await holdNavigations(other), b = fixture.issue(USERS.B); await browserSetSession(other, b); await resume(); await readyAs(other, USERS.B);
    await page.evaluate(() => { void Forja.auth.signOut(); }); await waitLogin(page);
    assert.equal((await stored(other))?.access_token === b.access_token, true); assert.equal(await other.evaluate(() => Forja.auth.canWrite()), true);
    assert.equal(await other.evaluate(key => localStorage.getItem(key), LOGOUT_KEY), null);
    assert.ok(fixture.refreshes.has(b.refresh_token));
    assert.ok(fixture.requests.filter(r => r.url.includes('/auth/v1/logout')).every(r => r.headers.authorization !== 'Bearer ' + b.access_token));
  });
  await test('10. Outro session_id do mesmo UID não pertence ao logout da UI anterior', async ({ context, fixture, page }) => {
    await deferAuthNotifications(page); await seed(page, fixture); await waitReady(page);
    const other = await context.newPage(); await seed(other, fixture, '', { seed: false }); await waitReady(other);
    const next = fixture.issue(USERS.A); await browserSetSession(other, next); await waitReady(other);
    await page.evaluate(() => { void Forja.auth.signOut(); }); await waitLogin(page);
    assert.equal((await stored(other))?.access_token === next.access_token, true);
    assert.equal(await other.evaluate(() => Forja.auth.canWrite()), true); assert.ok(fixture.refreshes.has(next.refresh_token));
  });
  await test('11. Storage sem leitura/escrita/remoção não reautoriza A; sinal sem tokens fecha a outra aba', async ({ context, fixture, page }) => {
    fixture.failLogout = true; await seed(page, fixture); await waitReady(page);
    const other = await context.newPage(); await seed(other, fixture, '', { seed: false }); await waitReady(other);
    await page.evaluate(key => {
      window.authFixtureAllFaults = [];
      window.authFixtureLogoutSignals = [];
      const postMessage = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (value) {
        if (this.name === 'forja:logout:' + key) authFixtureLogoutSignals.push(structuredClone(value));
        return postMessage.call(this, value);
      };
      authFixtureAllFaults.push(() => { BroadcastChannel.prototype.postMessage = postMessage; });
      for (const method of ['getItem', 'setItem', 'removeItem']) {
        const original = Storage.prototype[method]; authFixtureAllFaults.push(() => { Storage.prototype[method] = original; });
        Storage.prototype[method] = function (...args) { if (this === localStorage || method === 'setItem' && this === sessionStorage) throw new DOMException('Storage indisponível', 'SecurityError'); return original.apply(this, args); };
      }
      window.authFixtureExit = Forja.auth.signOut();
    }, AUTH_STORAGE_KEY);
    await page.evaluate(() => authFixtureExit); await waitLogin(other);
    const signals = await page.evaluate(() => authFixtureLogoutSignals);
    assert.ok(signals.length > 0, 'o fechamento da outra aba deve ter um sinal observável');
    for (const marker of signals) {
      assert.deepEqual(Object.keys(marker).sort(), ['at', 'nonce', 'sessionId', 'userId']);
      assert.equal(marker.userId, USERS.A);
      assert.match(marker.sessionId, /^[0-9a-f-]{36}$/i);
      assert.match(marker.nonce, /^[0-9a-f-]{36}$/i);
      assert.ok(Number.isFinite(marker.at));
    }
    await page.evaluate(() => { for (const restore of authFixtureAllFaults.reverse()) restore(); });
    await page.evaluate(() => Forja.auth.revalidate());
    assert.equal(await page.evaluate(() => Forja.auth.canWrite()), false);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.forjaAuth), 'locked');
    await page.click('#auth-retry'); await waitLogin(page); assert.equal(await stored(page), null);
  });

  // Novas regressões: a fila NATIVA fecha a lacuna entre o check do SDK e o
  // commit do SupportedStorage. Não há await artificial no storage de A.
  async function replacementBehindLock({ context, fixture, page }, { uid = USERS.B, rejected = false } = {}) {
    await deferAuthNotifications(page); await seed(page, fixture); await waitReady(page);
    if (rejected) await holdNavigations(page);
    const other = await context.newPage(); await deferAuthNotifications(other); await seed(other, fixture, '', { seed: false }); await waitReady(other);
    const resume = await holdNavigations(other), controller = await lockController(context, server.origin);
    const next = fixture.issue(uid);
    if (rejected) {
      await page.evaluate(key => { const value = JSON.parse(localStorage.getItem(key)); value.expires_at = 1; localStorage.setItem(key, JSON.stringify(value)); }, AUTH_STORAGE_KEY);
      const handle = fixture.handle.bind(fixture);
      fixture.handle = (input, options) => String(input).includes('grant_type=refresh_token')
        ? Promise.resolve(new Response(JSON.stringify({ code: 'refresh_token_not_found', message: 'expired fixture refresh' }), { status: 400, headers: { 'content-type': 'application/json' } })) : handle(input, options);
    }
    await observeSessionWrite(page); await observeSessionWrite(other);
    await page.evaluate(key => {
      const storage = Forja.auth.client.auth.storage, remove = storage.removeItem;
      window.lifecycleRemovalRequested = false;
      storage.removeItem = function (name) { if (name === key) lifecycleRemovalRequested = true; return remove.call(this, name); };
    }, AUTH_STORAGE_KEY);
    try {
      await controller.queue(0); await controller.entered(0);
      await other.evaluate(value => {
        window.lifecycleBSet = Forja.auth.client.auth.setSession({ access_token: value.access_token, refresh_token: value.refresh_token }).then(result => {
          if (result.error) throw result.error; return true;
        });
      }, next);
      await until(() => other.evaluate(() => lifecycleWriteRequested), 'B não solicitou persistência'); await controller.pending();
      await controller.queue(1); await controller.pending(2);
      await startRefresh(page);
      await until(() => page.evaluate(rejected => rejected ? lifecycleRemovalRequested : lifecycleWriteRequested, rejected), 'refresh A não atingiu a mutação de storage');
      await controller.pending(3);
      await controller.release(0); await controller.entered(1);
      await within(other.evaluate(() => lifecycleBSet), 'SDK não concluiu o login B'); await resume(); await readyAs(other, uid);
      const expected = await other.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY);
      assert.equal(await other.evaluate(() => Forja.auth.canWrite()), true, 'B precisa estar autorizada ANTES de liberar A');
      assert.equal((await currentSession(other)).access_token === next.access_token, true);
      await controller.release(1); const result = await finishRefresh(page);
      const preserved = await page.evaluate((key, expected) => localStorage.getItem(key) === expected, AUTH_STORAGE_KEY, expected);
      console.log('  LOCK EVIDENCE ' + JSON.stringify({ rejected, sameUidNewSession: uid === USERS.A, bVerifiedBeforeRelease: true, exactBPreserved: preserved, staleRefreshRejected: result.stale || Boolean(result.error), lockAvailable: await controller.available() }));
      assert.equal(preserved, true, 'refresh/cleanup A obsoleto alterou a sessão B já validada');
      assert.equal(await other.evaluate(id => Forja.auth.isVerified(id) && Forja.auth.canWrite(), uid), true);
      assert.equal(await controller.available(), true);
    } finally { await controller.releaseAll(); }
  }
  await test('12. Refresh A espera Web Lock real, B fica persistida e autorizada e A não a substitui', args => replacementBehindLock(args));
  await test('13. Refresh A também não substitui outro session_id do MESMO UID após esperar o lock', args => replacementBehindLock(args, { uid: USERS.A }));
  await test('14. Refresh legítimo da mesma sessão continua rotacionando e exigindo getUser', async ({ context, fixture, page }) => {
    await seed(page, fixture); await waitReady(page); const previous = await currentSession(page);
    const before = fixture.requests.filter(request => request.url.endsWith('/auth/v1/user')).length;
    await startRefresh(page); assert.deepEqual(await finishRefresh(page), { rejected: false, error: null, stale: false });
    await readyAs(page, USERS.A); const current = await currentSession(page);
    assert.equal(sessionId(current), sessionId(previous)); assert.notEqual(current.access_token, previous.access_token);
    assert.equal(await page.evaluate(() => Forja.auth.canWrite()), true);
    assert.ok(fixture.requests.filter(request => request.url.endsWith('/auth/v1/user')).length > before);
    const controller = await lockController(context, server.origin); assert.equal(await controller.available(), true);
  });
  await test('15. Erro de refresh A com cleanup esperando lock não remove B persistida depois', args => replacementBehindLock(args, { rejected: true }));

  async function oldLogout({ context, fixture, page }) {
    fixture.failLogout = true; await seed(page, fixture); await waitReady(page); await holdNavigations(page);
    const recipient = await context.newPage(); await stayOnLogin(recipient); await installMailbox(recipient, { holdStorageEvents: true });
    await seed(recipient, fixture, 'login.html', { seed: false }); await waitLogin(recipient);
    await page.evaluate(() => Forja.auth.signOut());
    const [marker] = await waitMessages(recipient); assertTokenless(marker); assert.equal(marker.userId, USERS.A);
    assertFailedLogoutFor(fixture, fixture.defaultSession.access_token);
    const controller = await lockController(context, server.origin);
    return { recipient, marker, controller };
  }
  async function checkNoReinstalledLogout(recipient) {
    assert.equal(await recipient.evaluate(key => sessionStorage.getItem(key), SIGNED_OUT), null, 'BroadcastChannel antigo reinstalou SIGNED_OUT depois da nova intenção Google');
  }
  await test('16. Mensagem A antes de abrir OAuth não cancela nova intenção Google sob lock real', async args => {
    const { recipient, controller } = await oldLogout(args); args.fixture.oauthUser = USERS.B;
    try {
      await controller.queue(0); await controller.entered(0);
      await recipient.click('#google-login'); await controller.pending(); await controller.queue(1);
      await controller.release(0); await controller.entered(1);
      assert.ok(await recipient.evaluate(key => JSON.parse(sessionStorage.getItem(key))?.id, ATTEMPT));
      await deliver(recipient); await checkNoReinstalledLogout(recipient);
      await controller.release(1); await readyAs(recipient, USERS.B);
      assert.equal(await recipient.evaluate(() => Forja.auth.canWrite()), true);
    } finally { await controller.releaseAll(); }
  });
  await test('17. Mensagem A durante OAuth não bloqueia callback B nem reinstala logout', async args => {
    const { recipient, controller } = await oldLogout(args); args.fixture.oauthUser = USERS.B;
    // Só a navegação externa fica retida. O SDK oficial gera URL/verifier;
    // o provedor fictício devolve o código e o callback navega de verdade.
    await holdNavigations(recipient);
    try {
      await recipient.click('#google-login');
      await until(() => recipient.evaluate(() => Boolean(authFixtureNavigation.pending)), 'SDK não abriu a intenção OAuth B');
      const url = await recipient.evaluate(() => authFixtureNavigation.pending); assert.equal(isAuthorize(url), true);
      await deliver(recipient); await checkNoReinstalledLogout(recipient);
      const callback = authorizeLocation(await args.fixture.handle(url)); await recipient.goto(callback);
      await readyAs(recipient, USERS.B); assert.equal(await recipient.evaluate(() => Forja.auth.canWrite()), true);
    } finally { await controller.releaseAll(); }
  });
  await test('18. Mensagens duplicadas/fora de ordem durante exchange não cancelam B da nova intenção', async args => {
    const { recipient, marker, controller } = await oldLogout(args), hold = holdResponse(args.fixture, url => url.includes('grant_type=pkce'));
    args.fixture.oauthUser = USERS.B;
    try {
      await recipient.click('#google-login'); await within(hold.entered, 'exchange B não iniciou');
      await controller.post({ ...marker, nonce: '33333333-3333-4333-8333-000000000001', at: marker.at - 1000 });
      await controller.post(marker); await waitMessages(recipient, 2); await deliver(recipient, [1, 0, 1]);
      await checkNoReinstalledLogout(recipient); hold.release(); await readyAs(recipient, USERS.B);
      assert.equal(await recipient.evaluate(() => Forja.auth.canWrite()), true);
    } finally { hold.restore(); await controller.releaseAll(); }
  });
  await test('19. Depois do exchange, logout antigo não bloqueia novo session_id do MESMO UID', async args => {
    const { recipient, marker, controller } = await oldLogout(args);
    args.fixture.oauthUser = USERS.A;
    const hold = holdResponse(args.fixture, url => url.endsWith('/auth/v1/user'));
    try {
      await recipient.click('#google-login'); await within(hold.entered, 'verificação do novo A não iniciou');
      const next = await currentSession(recipient); assert.ok(next); assert.notEqual(sessionId(next), marker.sessionId);
      const restore = await allStorageUnavailable(recipient);
      try { await controller.post(marker); await waitMessages(recipient); await deliver(recipient); } finally { await restore(); }
      await checkNoReinstalledLogout(recipient);
      assert.notEqual(await recipient.evaluate(() => Forja.auth.state), 'guest', 'sinal antigo cancelou a geração B durante storage indisponível');
      hold.release(); await readyAs(recipient, USERS.A); assert.equal(await recipient.evaluate(() => Forja.auth.canWrite()), true);
    } finally { hold.restore(); await controller.releaseAll(); }
  });
  await test('20. Logout legítimo de A fecha a outra aba mesmo sem leitura/escrita/remoção de storage', async ({ context, fixture, page }) => {
    fixture.failLogout = true; await seed(page, fixture); await waitReady(page); await holdNavigations(page);
    const recipient = await context.newPage(); await installMailbox(recipient, { holdStorageEvents: true });
    await seed(recipient, fixture, '', { seed: false }); await waitReady(recipient);
    const restore = await allStorageUnavailable(page);
    try { await page.evaluate(() => Forja.auth.signOut()); } finally { await restore(); }
    const [marker] = await waitMessages(recipient); assertTokenless(marker); await deliver(recipient); await waitLogin(recipient);
    assert.equal(await recipient.evaluate(() => Forja.auth.canWrite()), false);
    assert.equal(await page.evaluate(() => Forja.auth.canWrite()), false);
    assertFailedLogoutFor(fixture, fixture.defaultSession.access_token);
  });
  await test('21. Logout antigo e duplicado ignora B pronta, mas logout da sessão B atual continua eficaz', async args => {
    const { recipient, marker, controller } = await oldLogout(args); args.fixture.oauthUser = USERS.B;
    await recipient.click('#google-login'); await readyAs(recipient, USERS.B);
    const next = await currentSession(recipient), expected = await recipient.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY);
    await controller.post(marker); await controller.post(marker); await waitMessages(recipient, 2); await deliver(recipient, [1, 0, 1]);
    assert.equal(await recipient.evaluate(id => Forja.auth.isVerified(id) && Forja.auth.canWrite(), USERS.B), true);
    assert.equal(await recipient.evaluate((key, expected) => localStorage.getItem(key) === expected, AUTH_STORAGE_KEY, expected), true);
    await controller.post({ userId: USERS.B, sessionId: sessionId(next), nonce: '33333333-3333-4333-8333-000000000002', at: Date.now() });
    await waitMessages(recipient, 3); await deliver(recipient, [2]); await waitLogin(recipient);
    assert.equal(await recipient.evaluate(() => Forja.auth.canWrite()), false);
  });
  await test('22. Duas abas/tentativas Google concorrentes: sinais antigos não vencem a intenção B mais nova', async args => {
    const { recipient: a, marker, controller } = await oldLogout(args);
    const b = await args.context.newPage(); await stayOnLogin(b); await installMailbox(b, { holdStorageEvents: true });
    await seed(b, args.fixture, 'login.html', { seed: false }); await waitLogin(b);
    await holdNavigations(a); await holdNavigations(b);
    try {
      await a.click('#google-login');
      await until(() => a.evaluate(() => Boolean(authFixtureNavigation.pending)), 'SDK não abriu a intenção A');
      const urlA = await a.evaluate(() => authFixtureNavigation.pending); assert.equal(isAuthorize(urlA), true);
      const callbackA = authorizeLocation(await args.fixture.handle(urlA));
      args.fixture.oauthUser = USERS.B; await b.click('#google-login');
      await until(() => b.evaluate(() => Boolean(authFixtureNavigation.pending)), 'SDK não abriu a intenção B concorrente');
      const urlB = await b.evaluate(() => authFixtureNavigation.pending); assert.equal(isAuthorize(urlB), true);
      await controller.post(marker); await waitMessages(b); await deliver(b); await checkNoReinstalledLogout(b);
      await b.goto(authorizeLocation(await args.fixture.handle(urlB))); await readyAs(b, USERS.B);
      const expected = await b.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY);
      await a.goto(callbackA); await readyAs(a, USERS.B);
      assert.equal(await b.evaluate((key, expected) => localStorage.getItem(key) === expected, AUTH_STORAGE_KEY, expected), true);
      assert.equal(await b.evaluate(() => Forja.auth.canWrite()), true);
    } finally { await controller.releaseAll(); }
  });
  await test('23. Storage totalmente indisponível + revogação 503: bloqueio imediato, limite no reload e retry durável', async ({ fixture, page }) => {
    fixture.failLogout = true; await seed(page, fixture); await waitReady(page); await holdNavigations(page);
    const original = await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY);
    const restore = await allStorageUnavailable(page);
    try {
      await page.evaluate(() => { window.lifecycleExit = Forja.auth.signOut(); });
      assert.equal(await page.evaluate(() => Forja.auth.canWrite()), false);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.forjaAuth), 'locked');
      await page.evaluate(() => lifecycleExit);
      assert.match(await page.$eval('#auth-gate-status', element => element.textContent), /não.*confirm|recusou|indisponível/i);
      assert.match(await page.$eval('#auth-gate-status', element => element.textContent), /recarregar/i);
      assert.match(await page.$eval('#auth-gate-status', element => element.textContent), /revogação.*não foi confirmada/i);
    } finally { await restore(); }
    assert.equal(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY), original);
    await page.evaluate(() => Forja.auth.revalidate()); assert.equal(await page.evaluate(() => Forja.auth.canWrite()), false);
    assertFailedLogoutFor(fixture, fixture.defaultSession.access_token);
    // Não esconder a limitação física: nenhum marcador/limpeza persistiu e o
    // servidor devolveu 503. Um reload novo pode validar o token ainda válido.
    await page.reload(); await waitReady(page); assert.equal(await page.evaluate(() => Forja.auth.canWrite()), true);
    const resume = await holdNavigations(page); const restoreAgain = await allStorageUnavailable(page);
    try { await page.evaluate(() => Forja.auth.signOut()); } finally { await restoreAgain(); }
    await page.click('#auth-retry');
    await until(() => page.evaluate(key => localStorage.getItem(key) === null, AUTH_STORAGE_KEY), 'retry seguro não removeu a sessão');
    await resume(); await waitLogin(page); await page.reload(); await waitLogin(page);
    assert.equal(await page.evaluate(() => Forja.auth.canWrite()), false);
  });
} finally { await browser.close(); server.server.closeAllConnections(); await server.close(); }
assert.ok(passed + failed > 0, 'filtro não selecionou testes');
console.log(`\nBROWSER CONCURRENCY — ${passed}/${passed + failed} testes aprovados. Google/Auth fictícios, segurança web ativa.`);
if (failed) process.exitCode = 1;
