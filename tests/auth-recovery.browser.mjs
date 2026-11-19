/* Chromium e SDK reais; Google/Auth HTTP fictícios. Segurança web obrigatória. */
import assert from 'node:assert/strict';
import { launchBrowser, startServer, waitReady, waitLogin } from './helpers/browser.mjs';
import { installBrowserAuth, browserSetSession } from './helpers/browser-auth.mjs';
import { AuthFixture, USERS, AUTH_STORAGE_KEY, AUTH_URL, DATA_PREFIX } from './helpers/auth-fixture.mjs';
import { tick, until, within, twoAccounts, holdAuth, bodyTransport, installBodyInBrowser, deferred, browserAdminHttp, adminPayload } from './helpers/auth-recovery.mjs';
const server = await startServer(); const transport = bodyTransport(server.server);
const browser = await launchBrowser({ enforceWebSecurity: true });
const args = browser.process().spawnargs;
assert.equal(args.some(arg => ['--disable-web-security', '--allow-running-insecure-content', '--disable-site-isolation-trials'].includes(arg)), false);
assert.equal(args.some(arg => arg.startsWith('--disable-features=') && /(?:^|,)(?:IsolateOrigins|site-per-process)(?:,|$)/.test(arg.split('=')[1])), false);
console.log('AUTH RECOVERY Chromium: segurança web/isolamento ativos; ' + await browser.version());
const base = server.origin + '/forja/'; let passed = 0, failed = 0;
async function test(name, task) {
  const context = await browser.createBrowserContext(), page = await context.newPage(), fixture = new AuthFixture(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try { await task({ context, page, fixture }); assert.deepEqual(errors, []); passed++; console.log('✅ BROWSER RECOVERY ' + name); }
  catch (error) { failed++; console.error('❌ BROWSER RECOVERY ' + name + '\n' + error.stack); }
  finally { transport.reset(); await context.close(); }
}
const go = (page, path = '') => page.goto(base + path, { waitUntil: 'domcontentloaded' });
// Reconsulta pelo CDP a cada documento durante o round-trip Google/PKCE.
// Um WaitTask iniciado no login antigo não é uma barreira para a página final.
async function readyAs(page, uid) {
  await until(async () => {
    try { return await page.evaluate(id => window.Forja?.auth?.isVerified(id) && document.documentElement.dataset.forjaAuth === 'ready', uid); }
    catch (error) { if (!/context.*destroyed|Cannot find context|Inspected target navigated/i.test(error.message)) throw error; return false; }
  }, 'Google/PKCE não chegou à conta/página esperada');
}
try {
  await test('1. Duas abas: logout A com refresh pendente não encerra Google B nem usa seu token', async ({ context, page, fixture }) => {
    const a = fixture.issue(USERS.A, { expiresAt: Math.floor(Date.now() / 1000) + 300 }); fixture.defaultSession = a;
    await installBrowserAuth(page, fixture, server.origin, { local: twoAccounts(fixture, a) }); await go(page, 'configuracoes/index.html'); await waitReady(page);
    const other = await context.newPage(); await installBrowserAuth(other, fixture, server.origin, { seed: false }); await go(other); await waitReady(other);
    const barriers = holdAuth(fixture);
    try {
      await page.evaluate(() => { const now = Date.now.bind(Date); Date.now = () => now() + 240000; void Forja.auth.revalidate(); });
      await within(barriers.refreshing.promise, 'refresh A não iniciou');
      await page.evaluate(() => { void Forja.auth.signOut(); });
      await waitLogin(other); await other.bringToFront(); await other.waitForSelector('#google-login:not([disabled])');
      fixture.oauthUser = USERS.B; await other.click('#google-login');
      await readyAs(other, USERS.B);
      const before = await other.evaluate(key => JSON.parse(localStorage.getItem(key)).access_token, AUTH_STORAGE_KEY);
      barriers.refresh.resolve(); await within(barriers.loggingOut.promise, 'logout não iniciou'); barriers.logout.resolve(); await tick(400);
      assert.equal(await other.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.access_token, AUTH_STORAGE_KEY), before, 'logout de A removeu B');
      assert.equal(await other.evaluate(id => Forja.auth.isVerified(id), USERS.B), true);
      assert.ok(fixture.requests.filter(r => r.url.includes('/auth/v1/logout')).every(r => r.headers.authorization === 'Bearer ' + a.access_token), 'revogação usou B');
      assert.ok(fixture.requests.some(r => r.url.includes('grant_type=pkce')), 'Google B não concluiu PKCE');
    } finally { barriers.release(); }
  });
  await test('2. Administração: 503 inicial seguido de retry recupera conteúdo e filtros', async ({ page, fixture }) => {
    fixture.userErrors.set(fixture.defaultSession.access_token, { status: 503, code: 'temporarily_unavailable' });
    await installBrowserAuth(page, fixture, server.origin); await go(page, 'admin/exercicios.html'); await page.waitForSelector('#auth-retry:not([hidden])');
    fixture.userErrors.clear(); await page.click('#auth-retry'); await waitReady(page);
    assert.equal(await page.evaluate(() => Forja.auth.isVerified()), true);
    assert.ok(await page.$eval('#muscle-filter', el => el.options.length > 1));
    assert.equal(await page.$eval('#conteudo', el => getComputedStyle(el).display !== 'none'), true);
  });
  await test('3. HTTP real local: corpo infinito expira em 12 s, conexão aborta e retry recupera', async ({ page, fixture }) => {
    await installBrowserAuth(page, fixture, server.origin); await go(page); await waitReady(page); await installBodyInBrowser(page);
    const entered = transport.queue('hanging', fixture.user(USERS.A)); const started = Date.now();
    await page.evaluate(() => { void Forja.auth.revalidate(); }); const request = await entered;
    await page.waitForFunction(() => Forja.auth.state === 'error', { timeout: 14500 });
    assert.ok(Date.now() - started >= 11700);
    assert.equal(await page.evaluate(() => authBodyProbe.signals[0].aborted), true);
    await until(() => request.aborted, 'Chromium não cancelou a conexão');
    await page.evaluate(() => { authBodyProbe.enabled = false; }); await page.click('#auth-retry'); await waitReady(page);
    assert.equal(await page.evaluate(id => Forja.auth.isVerified(id), USERS.A), true);
  });
  await test('4. Logout A concluído durante novo Google B não apaga o verifier PKCE compartilhado', async ({ context, page, fixture }) => {
    await installBrowserAuth(page, fixture, server.origin); await go(page); await waitReady(page);
    const other = await context.newPage(); await installBrowserAuth(other, fixture, server.origin, { seed: false }); await go(other); await waitReady(other);
    const barriers = holdAuth(fixture), handle = fixture.handle.bind(fixture), entered = deferred(), release = deferred();
    fixture.handle = async (input, options) => {
      if (String(input).includes('/auth/v1/authorize')) { entered.resolve(); await release.promise; }
      return handle(input, options);
    };
    try {
      await page.evaluate(() => { void Forja.auth.signOut(); }); await within(barriers.loggingOut.promise, 'logout A não iniciou');
      await waitLogin(other); fixture.oauthUser = USERS.B; await other.waitForSelector('#google-login:not([disabled])'); await other.click('#google-login');
      await within(entered.promise, 'Google B não iniciou');
      const verifier = await page.evaluate(key => localStorage.getItem(key + '-code-verifier'), AUTH_STORAGE_KEY); assert.ok(verifier);
      barriers.logout.resolve(); await waitLogin(page);
      assert.equal(await page.evaluate(key => localStorage.getItem(key + '-code-verifier'), AUTH_STORAGE_KEY), verifier);
      release.resolve(); await readyAs(other, USERS.B);
      assert.ok(fixture.requests.some(r => r.url.includes('grant_type=pkce')));
    } finally { release.resolve(); barriers.release(); }
  });
  await test('5. UI A antes de receber storage não encerra nem sinaliza logout da sessão B já salva', async ({ context, page, fixture }) => {
    await installBrowserAuth(page, fixture, server.origin); await go(page); await waitReady(page);
    const b = fixture.issue(USERS.B);
    await page.evaluate((key, session) => { localStorage.setItem(key, JSON.stringify(session)); void Forja.auth.signOut(); }, AUTH_STORAGE_KEY, b);
    await waitLogin(page);
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).access_token, AUTH_STORAGE_KEY), b.access_token);
    assert.equal(await page.evaluate(() => localStorage.getItem('forja-auth-logout-v1')), null);
    const other = await context.newPage(); await installBrowserAuth(other, fixture, server.origin, { seed: false }); await go(other); await waitReady(other);
    assert.equal(await other.evaluate(id => Forja.auth.isVerified(id), USERS.B), true);
    assert.ok(fixture.requests.filter(r => r.url.includes('/auth/v1/logout')).every(r => r.headers.authorization === 'Bearer ' + fixture.defaultSession.access_token));
    assert.ok(fixture.refreshes.has(b.refresh_token));
  });
  await test('6. Administração: segunda falha 503 não deixa loading permanente; terceiro retry recupera', async ({ page, fixture }) => {
    fixture.userErrors.set(fixture.defaultSession.access_token, { status: 503 });
    await installBrowserAuth(page, fixture, server.origin); await go(page, 'admin/exercicios.html'); await page.waitForSelector('#auth-retry:not([hidden])');
    const before = fixture.requests.filter(r => r.url.endsWith('/auth/v1/user')).length;
    await page.click('#auth-retry'); await until(() => fixture.requests.filter(r => r.url.endsWith('/auth/v1/user')).length > before, 'retry não fez nova verificação');
    await page.waitForFunction(() => Forja.auth.state === 'error' && !document.querySelector('#auth-retry').hidden);
    assert.equal(await page.$eval('#muscle-filter', el => el.options.length), 1);
    assert.equal(await page.$eval('#conteudo', el => getComputedStyle(el).display), 'none');
    fixture.userErrors.clear(); await page.click('#auth-retry'); await waitReady(page);
    assert.ok(await page.$eval('#muscle-filter', el => el.options.length > 1));
  });
  await test('7. Administração: sessão válida no retry não duplica listeners e mantém credencial adicional', async ({ page, fixture }) => {
    const calls = [];
    await installBrowserAuth(page, fixture, server.origin, { respondApi: request => browserAdminHttp(request, calls) });
    await go(page, 'admin/exercicios.html'); await waitReady(page);
    const count = await page.$eval('#muscle-filter', el => el.options.length);
    await page.evaluate(async () => { await Forja.retryBoot(); await Forja.retryBoot(); });
    assert.equal(await page.$eval('#muscle-filter', el => el.options.length), count);
    assert.equal(await page.$eval('#refresh-dashboard', el => el.disabled), true);
    await page.type('#admin-credential', 'not-a-real-admin-credential'); await page.click('#auth-form button');
    await page.waitForFunction(() => !document.querySelector('#refresh-dashboard').disabled);
    assert.equal(calls.length, 1); assert.equal(await page.$eval('#admin-credential', el => el.value), '');
    assert.match(await page.$eval('#report', el => el.textContent), /165/);
    assert.equal(await page.evaluate(() => localStorage.getItem('FORJA_ADMIN_CREDENTIAL')), null);
  });
  await test('8. Administração: sessão expira durante recuperação e exige novo Google sem apagar dados', async ({ page, fixture }) => {
    fixture.userErrors.set(fixture.defaultSession.access_token, { status: 503 });
    await installBrowserAuth(page, fixture, server.origin); await go(page, 'admin/exercicios.html'); await page.waitForSelector('#auth-retry:not([hidden])');
    const profileKey = DATA_PREFIX(USERS.A) + 'forja-perfil-v1';
    const raw = await page.evaluate(key => localStorage.getItem(key), profileKey);
    const expired = fixture.issue(USERS.A, { expiresAt: Math.floor(Date.now() / 1000) - 60 }); fixture.refreshes.clear();
    await page.evaluate((key, session) => localStorage.setItem(key, JSON.stringify(session)), AUTH_STORAGE_KEY, expired);
    await page.click('#auth-retry'); await waitLogin(page);
    assert.equal(await page.evaluate(() => Forja.auth.isVerified()), false);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), profileKey), raw);
  });
  await test('9. Administração: resposta antiga A não libera B rejeitada; retry valida B por conta própria', async ({ context, page, fixture }) => {
    fixture.userErrors.set(fixture.defaultSession.access_token, { status: 503 });
    await installBrowserAuth(page, fixture, server.origin); await go(page, 'admin/exercicios.html'); await page.waitForSelector('#auth-retry:not([hidden])');
    const other = await context.newPage(); await installBrowserAuth(other, fixture, server.origin, { seed: false }); await go(other, 'login.html'); await other.waitForSelector('#google-login:not([disabled])');
    await page.bringToFront();
    const handle = fixture.handle.bind(fixture), entered = deferred(), release = deferred(); fixture.userErrors.clear();
    fixture.handle = async (input, options) => {
      if (String(input).endsWith('/auth/v1/user') && new Headers(options.headers).get('authorization') === 'Bearer ' + fixture.defaultSession.access_token) { entered.resolve(); await release.promise; }
      return handle(input, options);
    };
    try {
      await page.click('#auth-retry'); await within(entered.promise, 'verificação antiga não iniciou');
      const b = fixture.issue(USERS.B); fixture.userErrors.set(b.access_token, { status: 503 });
      await other.evaluate((key, session) => localStorage.setItem(key, JSON.stringify(session)), AUTH_STORAGE_KEY, b);
      release.resolve(); await page.waitForFunction(() => Forja.auth.state === 'error' && !document.querySelector('#auth-retry').hidden);
      assert.equal(await page.evaluate(() => Forja.auth.isVerified()), false);
      assert.equal(await page.$eval('#muscle-filter', el => el.options.length), 1);
      assert.equal(await page.$eval('#conteudo', el => getComputedStyle(el).display), 'none');
      fixture.userErrors.clear(); await page.bringToFront(); await page.click('#auth-retry'); await waitReady(page);
      assert.equal(await page.evaluate(id => Forja.auth.isVerified(id), USERS.B), true);
    } finally { release.resolve(); }
  });
  await test('10. Administração: dashboard de A que termina após troca para B não é renderizado', async ({ context, page, fixture }) => {
    const entered = deferred(), release = deferred(), calls = [];
    await installBrowserAuth(page, fixture, server.origin, { respondApi: async request => {
      if (!/youtube-videos/.test(request.url())) return false;
      if (request.method() !== 'OPTIONS') { entered.resolve(); await release.promise; }
      return browserAdminHttp(request, calls, { ...adminPayload, report: { ...adminPayload.report, total: 999 } });
    } });
    await go(page, 'admin/exercicios.html'); await waitReady(page);
    await page.evaluate(() => { Forja.navigate = () => {}; }); // retém a closure antiga para testar sua recusa
    const other = await context.newPage(); await installBrowserAuth(other, fixture, server.origin, { seed: false }); await go(other); await waitReady(other);
    try {
      await page.type('#admin-credential', 'not-a-real-admin-credential'); await page.click('#auth-form button'); await within(entered.promise, 'dashboard não iniciou');
      const b = fixture.issue(USERS.B); await other.evaluate((key, session) => localStorage.setItem(key, JSON.stringify(session)), AUTH_STORAGE_KEY, b);
      await page.waitForFunction(id => Forja.auth.isVerified(id), {}, USERS.B); release.resolve();
      await page.waitForFunction(() => document.querySelector('#session-status').textContent.includes('sessão mudou'));
      assert.equal(await page.$eval('#report', el => el.textContent.includes('999')), false);
      assert.equal(await page.$eval('#refresh-dashboard', el => el.disabled), true);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.forjaAuth), 'locked');
    } finally { release.resolve(); }
  });
  await test('11. HTTP normal: corpo completo é validado sem cancelar a requisição', async ({ page, fixture }) => {
    await installBrowserAuth(page, fixture, server.origin); await go(page); await waitReady(page); await installBodyInBrowser(page);
    const entered = transport.queue('normal', fixture.user(USERS.A));
    await page.evaluate(() => Forja.auth.revalidate()); const request = await entered;
    assert.equal(await page.evaluate(id => Forja.auth.isVerified(id), USERS.A), true);
    assert.equal(await page.evaluate(() => authBodyProbe.signals[0].aborted), false); assert.equal(request.finishAttempts, 1);
  });
  await test('12. HTTP: cabeçalhos não liberam a UI antes de terminar o corpo atrasado dentro do prazo', async ({ page, fixture }) => {
    await installBrowserAuth(page, fixture, server.origin); await go(page); await waitReady(page); await installBodyInBrowser(page);
    const entered = transport.queue('delayed', fixture.user(USERS.A), 300);
    await page.evaluate(() => { window.pendingBodyValidation = Forja.auth.revalidate(); }); const request = await entered;
    assert.equal(request.finishAttempts, 0); assert.equal(await page.evaluate(() => document.documentElement.dataset.forjaAuth), 'locked');
    await page.evaluate(() => pendingBodyValidation); await waitReady(page);
    assert.equal(await page.evaluate(() => authBodyProbe.signals[0].aborted), false);
  });
  await test('13. HTTP: corpo >12 s é cancelado e sua conclusão tardia não interfere com B validada depois', async ({ page, fixture }) => {
    await installBrowserAuth(page, fixture, server.origin); await go(page); await waitReady(page); await installBodyInBrowser(page);
    await page.evaluate(() => { Forja.navigate = () => {}; });
    const entered = transport.queue('delayed', fixture.user(USERS.A), 13000);
    await page.evaluate(() => { void Forja.auth.revalidate(); }); const request = await entered;
    await page.waitForFunction(() => Forja.auth.state === 'error', { timeout: 14500 });
    assert.equal(await page.evaluate(() => authBodyProbe.signals[0].aborted), true);
    await page.evaluate(() => { authBodyProbe.enabled = false; }); const b = fixture.issue(USERS.B); await browserSetSession(page, b);
    await page.waitForFunction(id => Forja.auth.isVerified(id), {}, USERS.B);
    await until(() => request.finishAttempts === 1, 'corpo antigo não tentou terminar', 2500);
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).access_token, AUTH_STORAGE_KEY), b.access_token);
    assert.equal(await page.evaluate(id => Forja.auth.isVerified(id), USERS.B), true);
  });
  await test('14. HTTP: interrupção durante leitura fecha o gate; retry recupera sem apagar sessão', async ({ page, fixture }) => {
    await installBrowserAuth(page, fixture, server.origin); await go(page); await waitReady(page); await installBodyInBrowser(page);
    transport.queue('broken', fixture.user(USERS.A)); await page.evaluate(() => Forja.auth.revalidate());
    await page.waitForSelector('#auth-retry:not([hidden])');
    assert.equal(await page.evaluate(() => Forja.auth.state), 'error'); assert.equal(await page.evaluate(() => Forja.auth.canWrite()), false);
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).access_token, AUTH_STORAGE_KEY), fixture.defaultSession.access_token);
    await page.evaluate(() => { authBodyProbe.enabled = false; }); await page.click('#auth-retry'); await waitReady(page);
  });
  await test('15. HTTP: trocar a geração aborta corpo pendente A e não prende a validação própria de B', async ({ page, fixture }) => {
    await installBrowserAuth(page, fixture, server.origin); await go(page); await waitReady(page); await installBodyInBrowser(page, fixture.defaultSession.access_token);
    await page.evaluate(() => { Forja.navigate = () => {}; });
    const entered = transport.queue('hanging', fixture.user(USERS.A));
    await page.evaluate(() => { window.pendingBodyValidation = Forja.auth.revalidate(); }); const request = await entered;
    const b = fixture.issue(USERS.B); await browserSetSession(page, b);
    await page.waitForFunction(id => Forja.auth.isVerified(id), { timeout: 2500 }, USERS.B);
    await until(() => request.aborted, 'corpo A não foi cancelado');
    assert.equal(await page.evaluate(() => authBodyProbe.signals[0].aborted), true);
    request.finish(); await tick(80);
    assert.equal(await page.evaluate(id => Forja.auth.isVerified(id), USERS.B), true);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.forjaAuth), 'locked');
  });
  await test('16. Logout cancela getUser A pendente; resposta atrasada não remove novo Google B', async ({ context, page, fixture }) => {
    await installBrowserAuth(page, fixture, server.origin); await go(page); await waitReady(page);
    const other = await context.newPage(); await installBrowserAuth(other, fixture, server.origin, { seed: false }); await go(other); await waitReady(other);
    const handle = fixture.handle.bind(fixture), entered = deferred(), release = deferred();
    fixture.handle = async (input, options) => {
      if (String(input).endsWith('/auth/v1/user') && new Headers(options.headers).get('authorization') === 'Bearer ' + fixture.defaultSession.access_token) { entered.resolve(); await release.promise; }
      return handle(input, options);
    };
    await page.evaluate(() => { Forja.navigate = () => {}; void Forja.auth.revalidate(); });
    try {
      await within(entered.promise, 'getUser A não iniciou'); await page.evaluate(() => Forja.auth.signOut());
      await waitLogin(other); fixture.oauthUser = USERS.B; await other.waitForSelector('#google-login:not([disabled])'); await other.click('#google-login');
      await readyAs(other, USERS.B);
      const b = await other.evaluate(key => JSON.parse(localStorage.getItem(key)).access_token, AUTH_STORAGE_KEY);
      fixture.userErrors.set(fixture.defaultSession.access_token, { status: 403, code: 'session_not_found' }); release.resolve(); await tick(300);
      assert.equal(await other.evaluate(key => JSON.parse(localStorage.getItem(key)).access_token, AUTH_STORAGE_KEY), b);
      assert.equal(await other.evaluate(id => Forja.auth.isVerified(id), USERS.B), true);
      assert.ok(fixture.requests.filter(r => r.url.includes('/auth/v1/logout')).every(r => r.headers.authorization !== 'Bearer ' + b));
      assert.equal(await page.evaluate(() => document.documentElement.dataset.forjaAuth), 'locked');
    } finally { release.resolve(); }
  });
  await test('17. Evento de logout antigo de A não fecha a UI/driver já validados de B', async ({ page, fixture }) => {
    const b = fixture.issue(USERS.B); await installBrowserAuth(page, fixture, server.origin, { local: twoAccounts(fixture, b) }); await go(page); await waitReady(page);
    await page.evaluate(id => {
      const key = 'forja-auth-logout-v1', marker = JSON.stringify({ userId: id, at: Date.now(), nonce: 'fixture-old-generation' });
      dispatchEvent(new StorageEvent('storage', { key, newValue: marker }));
      if (!Forja.auth.canWrite()) throw new Error('evento removido bloqueou B');
      localStorage.setItem(key, marker); dispatchEvent(new StorageEvent('storage', { key, newValue: marker }));
    }, USERS.A);
    assert.equal(await page.evaluate(id => Forja.auth.isVerified(id), USERS.B), true);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.forjaAuth), 'ready');
    assert.equal(await page.evaluate(() => Forja.auth.canWrite()), true);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('forja-auth-signed-out-v1')), null);
  });
  await test('18. HTTP sem cabeçalhos tem prazo total de 12 s, cancelamento e retry utilizável', async ({ page, fixture }) => {
    await installBrowserAuth(page, fixture, server.origin); await go(page); await waitReady(page); await installBodyInBrowser(page);
    const entered = transport.queue('headers-hanging', fixture.user(USERS.A)), started = Date.now();
    await page.evaluate(() => { void Forja.auth.revalidate(); }); const request = await entered;
    await page.waitForFunction(() => Forja.auth.state === 'error', { timeout: 14500 });
    assert.ok(Date.now() - started >= 11700); assert.equal(request.headersAt, null);
    assert.equal(await page.evaluate(() => authBodyProbe.signals[0].aborted), true);
    await until(() => request.aborted, 'Chromium não cancelou espera por cabeçalhos');
    await page.evaluate(() => { authBodyProbe.enabled = false; }); await page.click('#auth-retry'); await waitReady(page);
  });
  await test('19. HTTP com corpo infinito em progresso é cancelado em 12 s; chunks não renovam o prazo', async ({ page, fixture }) => {
    await installBrowserAuth(page, fixture, server.origin); await go(page); await waitReady(page); await installBodyInBrowser(page);
    const entered = transport.queue('streaming', fixture.user(USERS.A)), started = Date.now();
    await page.evaluate(() => { void Forja.auth.revalidate(); }); const request = await entered;
    await page.waitForFunction(() => Forja.auth.state === 'error', { timeout: 14500 });
    assert.ok(Date.now() - started >= 11700); assert.ok(request.chunks >= 3);
    assert.equal(await page.evaluate(() => authBodyProbe.signals[0].aborted), true);
    await until(() => request.aborted, 'Chromium não cancelou o stream infinito');
    assert.equal(await page.evaluate(() => Forja.auth.canWrite()), false);
    await page.evaluate(() => { authBodyProbe.enabled = false; }); await page.click('#auth-retry'); await waitReady(page);
  });
} finally { transport.close(); await browser.close(); server.server.closeAllConnections(); await server.close(); }
console.log(`\nBROWSER RECOVERY — ${passed}/${passed + failed} testes aprovados. Serviços simulados; zero SQL/deploy.`);
if (failed) process.exitCode = 1;
