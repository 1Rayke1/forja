/* Chromium + SDK reais, serviços Google/Auth/PostgREST SIMULADOS. Zero SQL/deploy. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchBrowser, startServer, waitReady, waitLogin } from './helpers/browser.mjs';
import { installBrowserAuth, browserSetSession } from './helpers/browser-auth.mjs';
import { AuthFixture, USERS, PROFILE, AUTH_STORAGE_KEY, AUTH_URL, DATA_PREFIX, COPY_KEY, completedJournal, checksum } from './helpers/auth-fixture.mjs';
import { userResponse, within, holdNavigations } from './helpers/auth-concurrency.mjs';
const localServer = await startServer();
const browser = await launchBrowser({ enforceWebSecurity: true });
const browserArgs = browser.process().spawnargs;
assert.equal(browserArgs.includes('--disable-web-security'), false);
assert.equal(browserArgs.includes('--allow-running-insecure-content'), false);
assert.equal(browserArgs.includes('--disable-site-isolation-trials'), false);
assert.equal(browserArgs.some(arg => arg.startsWith('--disable-features=') && /(?:^|,)(?:IsolateOrigins|site-per-process)(?:,|$)/.test(arg.split('=')[1])), false);
console.log('AUTH Chromium: segurança web e isolamento de origens habilitados.');
const base = localServer.origin + '/forja/';
const P = 'forja-perfil-v1';
let passed = 0, failed = 0;
const selectedCase = process.env.FORJA_AUTH_BROWSER_CASE;
async function test(name, task) {
  if (selectedCase && name.split('.')[0] !== selectedCase) return;
  const context = await browser.createBrowserContext();
  const fixture = new AuthFixture();
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try { await task({ context, fixture, page, errors }); assert.deepEqual(errors, [], 'exceções no navegador'); passed++; console.log('✅ BROWSER AUTH ' + name); }
  catch (error) { failed++; console.error('❌ BROWSER AUTH ' + name + '\n' + error.stack); }
  finally { await context.close(); }
}
const goto = async (page, url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); };
// O predicado pode atravessar vários documentos (troca de conta/reload). Poll
// pelo CDP em cada documento, em vez de manter um WaitTask na página antiga.
const until = async (page, callback, ...args) => {
  const limit = Date.now() + 10000;
  while (Date.now() < limit) {
    try { if (await page.evaluate(callback, ...args)) return; }
    catch (error) { if (!/context.*destroyed|Cannot find context|Inspected target navigated|Forja is not defined/i.test(error.message)) throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const state = await page.evaluate(() => ({ page: document.body?.dataset.page, state: window.Forja?.auth?.state, uid: window.Forja?.auth?.user?.id, bound: window.Forja?.authData?.userId, gate: document.getElementById('auth-gate-status')?.textContent, ready: document.documentElement.dataset.forjaAuth }));
  throw new Error('Condição não atingida: ' + JSON.stringify(state));
};
try {
  await test('1. Acesso direto às 15 páginas exige Google', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin, { local: {} });
    const routes = ['index.html','onboarding/index.html','treino/index.html','treino/calistenia.html','treino/musculacao.html','treino/biblioteca.html','treino/grupo.html','treino/rotina.html','treino/executar.html','progresso/index.html','explorar/index.html','explorar/atlas.html','exercicio/index.html','configuracoes/index.html','admin/exercicios.html'];
    for (const route of routes) {
      await goto(page, base + route); await waitLogin(page);
      assert.equal(new URL(page.url()).searchParams.get('next'), route);
      assert.equal(await page.evaluate(() => window.Forja?.auth?.isVerified()), false);
    }
  });
  for (const [number, mount] of [[2, '/'], [3, '/forja/']]) await test(number + '. OAuth/PKCE completo e retorno correto sob ' + mount, async ({ fixture, page }) => {
    const local = fixture.seed(USERS.A, { [P]: PROFILE }); delete local[AUTH_STORAGE_KEY];
    await installBrowserAuth(page, fixture, localServer.origin, { local });
    const target = 'progresso/index.html?retorno=1#progress-goals-heading';
    await goto(page, localServer.origin + mount + 'login.html?next=' + encodeURIComponent(target));
    await page.waitForSelector('#google-login:not([disabled])'); await page.click('#google-login');
    await until(page, () => document.body?.dataset.page === 'progresso'); await waitReady(page);
    assert.equal(page.url(), localServer.origin + mount + target);
    const authorize = fixture.requests.find(r => r.url.includes('/auth/v1/authorize'));
    assert.equal(new URL(authorize.url).searchParams.get('code_challenge_method').toLowerCase(), 's256');
    assert.ok(fixture.requests.some(r => r.url.includes('grant_type=pkce') && r.body.code_verifier));
    assert.equal(await page.evaluate(() => Forja.auth.user.id), USERS.A);
  });
  await test('4. Cancelamento OAuth não libera o app e limpa a URL', async ({ fixture, page }) => {
    fixture.oauthMode = 'cancel'; await installBrowserAuth(page, fixture, localServer.origin, { local: {} });
    await goto(page, base + 'login.html'); await page.waitForSelector('#google-login:not([disabled])'); await page.click('#google-login');
    await until(page, () => document.getElementById('login-status')?.textContent.includes('cancelado'));
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.evaluate(() => window.Forja?.auth?.isVerified()), false);
  });
  await test('5. Sessão expirada renova pelo SDK e persiste no reload', async ({ fixture, page }) => {
    const expired = fixture.issue(USERS.A, { expiresAt: Math.floor(Date.now() / 1000) - 60 });
    await installBrowserAuth(page, fixture, localServer.origin, { local: fixture.seed(USERS.A, { [P]: PROFILE }, { session: expired }) });
    await goto(page, base); await waitReady(page);
    assert.ok(fixture.requests.some(r => r.url.includes('grant_type=refresh_token')));
    await page.reload({ waitUntil: 'domcontentloaded' }); await waitReady(page);
    assert.equal(await page.evaluate(() => Forja.auth.user.id), USERS.A);
  });
  await test('6. Logout com erro remoto bloqueia as duas abas e não apaga dados', async ({ context, fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin);
    await goto(page, base + 'configuracoes/index.html'); await waitReady(page);
    const other = await context.newPage(); await installBrowserAuth(other, fixture, localServer.origin, { seed: false });
    await goto(other, base); await waitReady(other);
    const original = await page.evaluate(key => localStorage.getItem(key), DATA_PREFIX(USERS.A) + P);
    fixture.failLogout = true;
    await page.bringToFront(); await page.click('#account-signout');
    await waitLogin(page); await waitLogin(other);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY), null);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), DATA_PREFIX(USERS.A) + P), original);
  });
  await test('7. Troca A→B→A entre abas não mistura dados', async ({ context, fixture, page }) => {
    const local = fixture.seed(USERS.A, { [P]: { ...PROFILE, nomeExibicao: 'Conta A' }, 'forja-preferencias-v1': { soundOnRest: false, vibrateOnRest: false } });
    local[DATA_PREFIX(USERS.B) + P] = JSON.stringify({ ...PROFILE, nomeExibicao: 'Conta B' }); local[COPY_KEY(USERS.B)] = completedJournal(USERS.B);
    await installBrowserAuth(page, fixture, localServer.origin, { local }); await goto(page, base); await waitReady(page);
    const other = await context.newPage(); await installBrowserAuth(other, fixture, localServer.origin, { seed: false }); await goto(other, base); await waitReady(other);
    await browserSetSession(other, fixture.issue(USERS.B));
    await until(page, id => !window.Forja?.auth?.isVerified(id), USERS.A);
    // Navegações de abas em background podem ser adiadas pelo Chromium.
    // Ao voltar à aba, o fluxo real de visibilitychange também deve revalidar.
    await page.bringToFront();
    await until(page, id => window.Forja?.auth?.user?.id === id && document.documentElement.dataset.forjaAuth === 'ready', USERS.B);
    assert.equal(await page.evaluate(() => Forja.state.profile.nomeExibicao), 'Conta B');
    assert.equal(await page.evaluate(() => Forja.store.readRaw('forja-preferencias-v1')), null);
    await other.bringToFront(); await waitReady(other); await browserSetSession(other, fixture.defaultSession);
    await until(page, id => !window.Forja?.auth?.isVerified(id), USERS.B);
    await page.bringToFront();
    await until(page, id => window.Forja?.auth?.user?.id === id && document.documentElement.dataset.forjaAuth === 'ready', USERS.A);
    assert.equal(await page.evaluate(() => Forja.state.profile.nomeExibicao), 'Conta A');
    assert.equal(await page.evaluate(() => Forja.state.preferences.soundOnRest), false);
  });
  await test('8. Refresh entre abas preserva rascunho não salvo do editor', async ({ context, fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin); await goto(page, base + 'treino/rotina.html?novo=1&modalidade=calisthenics'); await waitReady(page);
    await page.$eval('#routine-name-input', input => { input.value = 'Rascunho não salvo'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    const initialTime = await page.evaluate(() => performance.timeOrigin);
    const other = await context.newPage(); await installBrowserAuth(other, fixture, localServer.origin, { seed: false }); await goto(other, base); await waitReady(other);
    await browserSetSession(other, fixture.issue(USERS.A));
    await until(page, () => window.Forja?.auth?.isVerified() && document.documentElement.dataset.forjaAuth === 'ready');
    assert.equal(await page.$eval('#routine-name-input', input => input.value), 'Rascunho não salvo');
    assert.equal(await page.evaluate(() => performance.timeOrigin), initialTime);
  });
  await test('9. Escrita stale falha antes mesmo do evento storage', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin); await goto(page, base); await waitReady(page);
    const result = await page.evaluate((session, key, physical) => {
      const before = localStorage.getItem(physical);
      localStorage.setItem(key, JSON.stringify(session));
      return { saved: Forja.store.write('forja-perfil-v1', { nomeExibicao: 'errado' }).ok, unchanged: localStorage.getItem(physical) === before };
    }, fixture.issue(USERS.B), AUTH_STORAGE_KEY, DATA_PREFIX(USERS.A) + P);
    assert.deepEqual(result, { saved: false, unchanged: true });
  });
  await test('10. Legado só é vinculado com confirmação e cópia tem readback/checksum', async ({ fixture, page }) => {
    const raw = JSON.stringify({ ...PROFILE, nomeExibicao: 'Legado realista', campoFuturo: [1,2,3] }, null, 2);
    const local = { [AUTH_STORAGE_KEY]: JSON.stringify(fixture.defaultSession), [P]: raw, 'forja-futuro': ' { "bytes": true } ' };
    await installBrowserAuth(page, fixture, localServer.origin, { local }); await goto(page, base + 'configuracoes/index.html');
    await page.waitForSelector('#auth-legacy-choice:not([hidden])'); await page.click('#auth-import-confirm'); await waitReady(page);
    await until(page, () => window.Forja?.authData?.copyStatus.state === 'confirmed');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), P), raw);
    const row = [...fixture.imports.values()][0]; assert.equal(row.raw_by_key[P], raw); assert.equal(row.checksum, checksum(row.raw_by_key));
    assert.match(await page.$eval('#initial-copy-status', node => node.textContent), /conferida/);
  });
  await test('11. Falha local de cota não perde legado; retry retoma sem apagar a origem', async ({ fixture, page }) => {
    const raw = JSON.stringify(PROFILE);
    await installBrowserAuth(page, fixture, localServer.origin, { local: { [AUTH_STORAGE_KEY]: JSON.stringify(fixture.defaultSession), [P]: raw } });
    await goto(page, base); await page.waitForSelector('#auth-legacy-choice:not([hidden])');
    await page.evaluate(key => {
      window.originalStorageSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('fixture full', 'QuotaExceededError'); return originalStorageSet.call(this, name, value); };
    }, COPY_KEY(USERS.A));
    await page.click('#auth-import-confirm'); await page.waitForSelector('#auth-retry:not([hidden])');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), P), raw);
    await page.evaluate(() => { Storage.prototype.setItem = originalStorageSet; });
    await page.click('#auth-retry'); await waitReady(page);
    assert.equal(await page.evaluate(() => Forja.state.profile.objetivo), PROFILE.objetivo);
  });
  await test('12. Readback divergente permanece pendente e pode ser repetido pela UI', async ({ fixture, page }) => {
    fixture.badReadback = true;
    await installBrowserAuth(page, fixture, localServer.origin, { local: fixture.seed(USERS.A, { [P]: PROFILE }, { completed: false }) });
    await goto(page, base + 'configuracoes/index.html#privacidade'); await waitReady(page);
    await until(page, () => window.Forja?.authData?.copyStatus.state === 'error');
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).phase, COPY_KEY(USERS.A)), 'pending');
    fixture.badReadback = false; await page.click('#initial-copy-retry');
    await until(page, () => window.Forja?.authData?.copyStatus.state === 'confirmed'); assert.equal(fixture.imports.size, 1);
  });
  await test('13. Voltar/BFCache fecha o conteúdo antes de revalidar', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin); await goto(page, base); await waitReady(page);
    await goto(page, base + 'configuracoes/index.html'); await waitReady(page);
    await page.goBack({ waitUntil: 'domcontentloaded' }); await waitReady(page);
    const locked = await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      const hidden = getComputedStyle(document.getElementById('conteudo')).display === 'none';
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); return hidden;
    });
    assert.equal(locked, true); await waitReady(page);
    await page.evaluate(() => { void Forja.auth.signOut(); }); await waitLogin(page);
    await page.goBack({ waitUntil: 'domcontentloaded' }); await waitLogin(page);
    assert.equal(await page.evaluate(() => window.Forja?.auth?.isVerified()), false);
  });
  await test('14. Com JavaScript desativado, conteúdo interno fica fechado e há orientação', async ({ page }) => {
    await page.setJavaScriptEnabled(false); await goto(page, base + 'treino/index.html');
    assert.equal(await page.$eval('main', node => getComputedStyle(node).display), 'none');
    assert.match(await page.$eval('noscript', node => node.textContent), /Google/);
    assert.ok(await page.$('noscript a[href="../login.html"]'));
  });
  await test('15. Login é utilizável por teclado e sem overflow em 320/390/1280 px', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin, { local: {} }); await goto(page, base + 'login.html');
    await page.waitForSelector('#google-login:not([disabled])');
    for (const width of [320,390,1280]) {
      await page.setViewport({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.focus('#google-login'); assert.equal(await page.evaluate(() => document.activeElement.id), 'google-login');
    fs.mkdirSync('.cache/auth', { recursive: true }); await page.setViewport({ width: 390, height: 844 }); await page.screenshot({ path: '.cache/auth/login-390.png', fullPage: true });
  });
  await test('16. Configuração ausente nunca abre visitante ou uma página interna', async ({ fixture, page }) => {
    fixture.configured = false; await installBrowserAuth(page, fixture, localServer.origin, { local: {} }); await goto(page, base);
    await until(page, () => window.Forja?.auth?.state === 'error');
    assert.notEqual(await page.evaluate(() => document.documentElement.dataset.forjaAuth), 'ready');
    assert.match(await page.$eval('#auth-gate-status', node => node.textContent), /chave pública/);
  });
  await test('17. PostgREST SIMULADO recebe JWT do usuário e nega ações cruzadas', async ({ fixture, page }) => {
    const row = { user_id: USERS.B, checksum: checksum({}), format_version: 1, raw_by_key: {} };
    fixture.imports.set(USERS.B + ':' + row.checksum, row);
    await installBrowserAuth(page, fixture, localServer.origin); await goto(page, base); await waitReady(page);
    const result = await page.evaluate(async other => {
      const api = Forja.auth.client;
      const read = await api.from('user_data_imports').select('*').eq('user_id', other.user_id);
      const insert = await api.from('user_data_imports').insert(other);
      const update = await api.from('user_data_imports').update({ raw_by_key: {} }).eq('user_id', other.user_id);
      const remove = await api.from('user_data_imports').delete().eq('user_id', other.user_id).select();
      return { rows: read.data, insert: insert.status, update: update.status, deleted: remove.data };
    }, row);
    assert.deepEqual(result, { rows: [], insert: 403, update: 403, deleted: [] }); assert.equal(fixture.imports.size, 1);
    assert.ok(fixture.requests.filter(r => r.url.includes('/rest/')).every(r => r.headers.authorization === 'Bearer ' + fixture.defaultSession.access_token));
  });
  await test('18. Sessão alterada enquanto espera Web Lock não vincula legado à conta antiga', async ({ context, fixture, page }) => {
    const raw = JSON.stringify({ ...PROFILE, nomeExibicao: 'Legado aguardando' });
    await installBrowserAuth(page, fixture, localServer.origin, { local: { [AUTH_STORAGE_KEY]: JSON.stringify(fixture.defaultSession), [P]: raw } });
    await goto(page, base); await page.waitForSelector('#auth-legacy-choice:not([hidden])');
    const other = await context.newPage(); await installBrowserAuth(other, fixture, localServer.origin, { seed: false }); await goto(other, base + 'login.html');
    await other.waitForSelector('#auth-legacy-choice:not([hidden])');
    await other.evaluate(() => { void navigator.locks.request('forja-legacy-binding-v1', () => new Promise(resolve => { window.releaseBinding = resolve; })); });
    await until(other, () => typeof window.releaseBinding === 'function');
    await page.click('#auth-import-confirm');
    await browserSetSession(other, fixture.issue(USERS.B));
    await until(page, id => window.Forja?.auth?.user?.id === id, USERS.B);
    await other.evaluate(() => releaseBinding());
    await page.waitForSelector('#auth-legacy-choice:not([hidden])');
    assert.match(await page.$eval('#auth-gate-status', node => node.textContent), /conta-b@example.test/);
    const check = await page.evaluate((originalKey, uid) => ({ owner: localStorage.getItem('forja-auth-legacy-owner-v1'), original: localStorage.getItem(originalKey), journal: localStorage.getItem('forja-auth-copy-v1:' + uid) }), P, USERS.A);
    assert.deepEqual(check, { owner: null, original: raw, journal: null });
    await page.click('#auth-import-skip'); await waitReady(page);
    assert.equal(await page.evaluate(() => Forja.auth.user.id), USERS.B);
    assert.equal(await page.evaluate(() => Forja.state.profile.nomeExibicao || ''), '');
  });
  await test('19. Missões atualizam imediatamente entre abas pelo namespace UID; eventos de B não chegam ao domínio', async ({ context, fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin); await goto(page, base); await waitReady(page);
    const other = await context.newPage(); await installBrowserAuth(other, fixture, localServer.origin, { seed: false }); await goto(other, base + 'configuracoes/index.html'); await waitReady(other);
    await page.evaluate(() => { window.domainStorageEvents = []; addEventListener('storage', event => domainStorageEvents.push(event.key)); });
    const key = await other.evaluate(() => 'forja-missoes-' + Forja.dateKey(new Date()));
    await other.evaluate((physical, logical) => {
      localStorage.setItem(physical, JSON.stringify([{ id: 'b', text: 'Missão só de B', done: false }]));
      Forja.store.write(logical, [{ id: 'a', text: 'Missão da conta ativa', done: true }]);
    }, DATA_PREFIX(USERS.B) + key, key);
    await until(page, () => document.getElementById('task-list')?.textContent.includes('Missão da conta ativa'));
    assert.equal(await page.evaluate(() => document.getElementById('task-list').textContent.includes('Missão só de B')), false);
    assert.deepEqual(await page.evaluate(() => domainStorageEvents), [key]);
    assert.equal(await page.$eval('#progress-label', node => node.textContent), '1 de 1 · 100%');
  });
  await test('20. getUser 401 durante o uso retorna ao login sem perder destino ou dados', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin);
    const target = 'progresso/index.html?origem=expiracao#progress-goals-heading';
    await goto(page, base + target); await waitReady(page);
    const original = await page.evaluate(key => localStorage.getItem(key), DATA_PREFIX(USERS.A) + P);
    fixture.userErrors.set(fixture.defaultSession.access_token, { status: 401, code: 'bad_jwt' });
    await page.evaluate(() => { void Forja.auth.revalidate(); }); await waitLogin(page);
    await page.waitForSelector('#google-login:not([disabled])');
    assert.equal(new URL(page.url()).searchParams.get('next'), target);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY), null);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), DATA_PREFIX(USERS.A) + P), original);
    assert.equal(await page.evaluate(() => Forja.auth.isVerified()), false);
  });
  await test('21. Falha transitória de Auth fecha o conteúdo e retry restaura sem OAuth/reload', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin); await goto(page, base); await waitReady(page);
    const initialTime = await page.evaluate(() => performance.timeOrigin);
    fixture.userErrors.set(fixture.defaultSession.access_token, { status: 503, code: 'temporarily_unavailable' });
    await page.evaluate(() => { void Forja.auth.revalidate(); });
    await until(page, () => Forja.auth.state === 'error');
    assert.equal(await page.$eval('#conteudo', node => getComputedStyle(node).display), 'none');
    assert.equal(await page.evaluate(() => Forja.auth.canWrite()), false);
    assert.ok(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY));
    fixture.userErrors.clear(); await page.click('#auth-retry'); await waitReady(page);
    assert.equal(await page.evaluate(() => performance.timeOrigin), initialTime);
    assert.equal(fixture.requests.some(r => r.url.includes('/auth/v1/authorize')), false);
  });
  await test('22. Login em espera reage à conta Google verificada em outra aba e preserva o destino', async ({ context, fixture, page }) => {
    const local = fixture.seed(USERS.A, { [P]: PROFILE }); delete local[AUTH_STORAGE_KEY];
    await installBrowserAuth(page, fixture, localServer.origin, { local });
    const target = 'treino/index.html?origem=outra-aba#preferences-heading';
    await goto(page, base + 'login.html?next=' + encodeURIComponent(target)); await page.waitForSelector('#google-login:not([disabled])');
    const other = await context.newPage(); await installBrowserAuth(other, fixture, localServer.origin, { seed: false });
    await goto(other, base + 'login.html'); await other.waitForSelector('#google-login:not([disabled])');
    await browserSetSession(other, fixture.defaultSession);
    await page.bringToFront(); await until(page, () => document.body?.dataset.page === 'treino'); await waitReady(page);
    assert.equal(page.url(), base + target);
    assert.equal(await page.evaluate(() => Forja.auth.user.id), USERS.A);
  });
  await test('23. Login restaura botão/estado após pageshow persistido (evento BFCache simulado)', async ({ fixture, page }) => {
    const local = fixture.seed(USERS.A, { [P]: PROFILE }); delete local[AUTH_STORAGE_KEY];
    await installBrowserAuth(page, fixture, localServer.origin, { local });
    const target = 'progresso/index.html?origem=voltar';
    await goto(page, base + 'login.html?next=' + encodeURIComponent(target)); await page.waitForSelector('#google-login:not([disabled])');
    // Somente a navegação de saída é retida, para restaurar o mesmo documento
    // com o botão ocupado. O SDK/PKCE e a revalidação continuam reais.
    await page.evaluate(() => { window.realNavigate = Forja.navigate; Forja.navigate = url => { window.pendingOAuth = url; }; });
    await page.click('#google-login'); await until(page, () => Boolean(window.pendingOAuth));
    assert.equal(await page.$eval('#google-login', button => button.disabled), true);
    await page.evaluate(() => { Forja.navigate = window.realNavigate; dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await page.waitForSelector('#google-login:not([disabled])');
    assert.equal(await page.evaluate(() => Forja.auth.isVerified()), false);
    await page.click('#google-login'); await until(page, () => document.body?.dataset.page === 'progresso'); await waitReady(page);
    assert.equal(page.url(), base + target);
  });
  await test('24. Callback é sanitizado mesmo sem configuração pública; não existe fallback visitante', async ({ fixture, page }) => {
    fixture.configured = false; await installBrowserAuth(page, fixture, localServer.origin, { local: {} });
    await goto(page, base + 'login.html?code=fixture-code&state=fixture-state#access_token=fixture-token');
    await until(page, () => Forja.auth.state === 'error');
    assert.equal(new URL(page.url()).search, ''); assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.evaluate(() => Forja.auth.isVerified()), false);
    assert.match(await page.$eval('#login-status', node => node.textContent), /chave pública|configuração/i);
  });
  await test('25. Logout e nova escolha Google A→B usam OAuth sem misturar os namespaces', async ({ fixture, page }) => {
    const local = fixture.seed(USERS.A, { [P]: { ...PROFILE, nomeExibicao: 'Conta A' } });
    local[DATA_PREFIX(USERS.B) + P] = JSON.stringify({ ...PROFILE, nomeExibicao: 'Conta B' }); local[COPY_KEY(USERS.B)] = completedJournal(USERS.B);
    await installBrowserAuth(page, fixture, localServer.origin, { local }); await goto(page, base + 'configuracoes/index.html'); await waitReady(page);
    const originalA = await page.evaluate(key => localStorage.getItem(key), DATA_PREFIX(USERS.A) + P);
    await page.click('#account-signout'); await waitLogin(page); await page.waitForSelector('#google-login:not([disabled])');
    fixture.oauthUser = USERS.B; await page.click('#google-login');
    await until(page, id => window.Forja?.auth?.user?.id === id && document.documentElement.dataset.forjaAuth === 'ready', USERS.B);
    assert.equal(await page.evaluate(() => Forja.state.profile.nomeExibicao), 'Conta B');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), DATA_PREFIX(USERS.A) + P), originalA);
    const authorize = fixture.requests.find(r => r.url.includes('/auth/v1/authorize'));
    assert.equal(new URL(authorize.url).searchParams.get('prompt'), 'select_account');
  });
  for (const [number, width] of [[26, 320], [27, 390]]) await test(number + '. Mobile emulado ' + width + ' px: Google, navegação, reload e logout pela UI', async ({ fixture, page }) => {
    await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const local = fixture.seed(USERS.A, { [P]: PROFILE }); delete local[AUTH_STORAGE_KEY];
    await installBrowserAuth(page, fixture, localServer.origin, { local });
    await goto(page, base + 'login.html'); await page.waitForSelector('#google-login:not([disabled])');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.tap('#google-login'); await until(page, () => document.body?.dataset.page === 'inicio'); await waitReady(page);
    await page.tap('a.bottom-nav-link[data-nav="treino"]'); await until(page, () => document.body?.dataset.page === 'treino'); await waitReady(page);
    await page.reload({ waitUntil: 'domcontentloaded' }); await waitReady(page);
    assert.equal(await page.evaluate(() => Forja.auth.user.id), USERS.A);
    await page.tap('a.bottom-nav-link[data-nav="perfil"]'); await until(page, () => document.body?.dataset.page === 'configuracoes'); await waitReady(page);
    await page.$eval('#account-signout', button => button.scrollIntoView({ block: 'center' })); await page.tap('#account-signout');
    await waitLogin(page); await page.waitForSelector('#google-login:not([disabled])');
    assert.equal(await page.evaluate(() => Forja.auth.isVerified()), false);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY), null);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#google-login:not([disabled])');
    assert.equal(await page.evaluate(() => Forja.auth.isVerified()), false);
  });
  await test('28. Cancelamento não reutiliza sessão antiga; somente nova escolha Google permite continuar', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin); await goto(page, base + 'login.html?error=access_denied');
    await page.waitForSelector('#google-login:not([disabled])');
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await page.evaluate(() => document.body.dataset.page), 'login');
    assert.equal(await page.evaluate(() => Forja.auth.isVerified()), false);
    assert.match(await page.$eval('#login-status', node => node.textContent), /cancelado|não autorizado/i);
    await page.click('#google-login'); await until(page, () => document.body?.dataset.page === 'inicio'); await waitReady(page);
    assert.ok(fixture.requests.some(r => r.url.includes('grant_type=pkce')));
  });
  await test('29. session_not_found atrasado de A não encerra B nem seu login em outra aba', async ({ context, fixture, page }) => {
    const local = fixture.seed(USERS.A, { [P]: { ...PROFILE, nomeExibicao: 'Conta A' } });
    local[DATA_PREFIX(USERS.B) + P] = JSON.stringify({ ...PROFILE, nomeExibicao: 'Conta B' }); local[COPY_KEY(USERS.B)] = completedJournal(USERS.B);
    await installBrowserAuth(page, fixture, localServer.origin, { local }); await goto(page, base); await waitReady(page);
    const other = await context.newPage(); await installBrowserAuth(other, fixture, localServer.origin, { seed: false }); await goto(other, base); await waitReady(other);
    fixture.userErrors.set(fixture.defaultSession.access_token, { status: 403, code: 'session_not_found' });
    const old = userResponse(fixture, fixture.defaultSession.access_token);
    const resumeA = await holdNavigations(page), resumeB = await holdNavigations(other);
    try {
      await page.evaluate(() => { window.authScenario29 = Forja.auth.revalidate(); });
      await within(old.entered, 'getUser A não iniciou');
      const b = fixture.issue(USERS.B); await browserSetSession(other, b);
      // Prova o commit B ANTES de permitir a resposta antiga, sem uma janela
      // arbitrária de 300 ms e sem destruir a Promise CDP por navegação.
      await until(other, id => Forja.auth.isVerified(id), USERS.B);
      assert.equal(await other.evaluate((key, expected) => {
        const current = JSON.parse(localStorage.getItem(key));
        return current.access_token === expected.access_token && current.refresh_token === expected.refresh_token;
      }, AUTH_STORAGE_KEY, b), true);
      old.release(); await within(old.completed, 'resposta A não foi liberada');
      await page.evaluate(() => authScenario29);
      assert.equal(await page.evaluate((key, expected) => JSON.parse(localStorage.getItem(key) || 'null')?.access_token === expected, AUTH_STORAGE_KEY, b.access_token), true, 'rejeição antiga removeu B');
      await resumeB(); await resumeA();
      await page.bringToFront();
      await until(page, id => window.Forja?.auth?.user?.id === id && document.documentElement.dataset.forjaAuth === 'ready', USERS.B);
      await other.bringToFront();
      await until(other, id => window.Forja?.auth?.user?.id === id && document.documentElement.dataset.forjaAuth === 'ready', USERS.B);
      assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).access_token, AUTH_STORAGE_KEY), b.access_token);
      assert.equal(await page.evaluate(() => Forja.state.profile.nomeExibicao), 'Conta B');
      assert.equal(fixture.requests.some(r => r.url.includes('/auth/v1/logout')), false);
    } finally { old.restore(); }
  });
} finally { await browser.close(); await localServer.close(); }
assert.ok(passed + failed > 0 && (!selectedCase || passed + failed === 1), 'filtro não selecionou exatamente o cenário solicitado');
console.log(`\nBROWSER AUTH — ${passed}/${passed + failed} testes aprovados. Google/Auth/PostgREST simulados; nenhuma homologação remota ou SQL.`);
if (failed) process.exitCode = 1;
