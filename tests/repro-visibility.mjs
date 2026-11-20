/* Reprodução pontual (não parte da suíte): confirma a causa raiz do flash
   "Verificando sua sessão…" ao retornar do segundo plano com sessão válida,
   e que a sessão inválida ainda bloqueia. */
import { launchBrowser, startServer, waitReady } from './helpers/browser.mjs';
import { installBrowserAuth } from './helpers/browser-auth.mjs';
import { AuthFixture, USERS, PROFILE } from './helpers/auth-fixture.mjs';

const localServer = await startServer();
const browser = await launchBrowser({ enforceWebSecurity: true });
const context = await browser.createBrowserContext();
const fixture = new AuthFixture();
const page = await context.newPage();
await installBrowserAuth(page, fixture, localServer.origin, { local: fixture.seed(USERS.A, { 'forja-perfil-v1': PROFILE }) });
await page.goto(localServer.origin + '/forja/', { waitUntil: 'domcontentloaded' });
await waitReady(page);

// Sessão válida: o documento nunca pode voltar a "locked" ao retornar.
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await new Promise(r => setTimeout(r, 50));
const visible = await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  return document.documentElement.dataset.forjaAuth;
});
await new Promise(r => setTimeout(r, 1200));
const after = await page.evaluate(() => ({
  ready: document.documentElement.dataset.forjaAuth,
  verified: window.Forja?.auth?.isVerified(),
  user: window.Forja?.auth?.user?.id
}));
console.log('Retorno com sessão válida: imediato=' + visible + ' final=' + JSON.stringify(after));
if (visible !== 'ready' || after.ready !== 'ready' || !after.verified) {
  console.log('FALHA: tela bloqueante reapareceu com sessão válida');
  await browser.close(); await localServer.close(); process.exit(1);
}

// Sessão que se torna inválida (token revogado): o retorno deve bloquear e pedir autenticação.
fixture.sessions.clear(); // Revogação: tokens antigos não são mais conhecidos.
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForFunction(() => document.body?.dataset.page === 'login', { polling: 50, timeout: 10000 });
await new Promise(r => setTimeout(r, 800));
const blocked = await page.evaluate(() => ({
  page: document.body?.dataset.page,
  ready: document.documentElement.dataset.forjaAuth,
  verified: window.Forja?.auth?.isVerified()
}));
console.log('Retorno com sessão inválida: ' + JSON.stringify(blocked));
if (blocked.page !== 'login' || blocked.verified) {
  console.log('FALHA: sessão inválida não bloqueou');
  await browser.close(); await localServer.close(); process.exit(1);
}
console.log('REPRO OK');
await browser.close();
await localServer.close();
