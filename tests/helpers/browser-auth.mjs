/* Fixture HTTP, não bypass de produção. Intercepta todo o host Supabase fictício.
   A assinatura JWT, o consentimento Google e as políticas remotas NÃO são homologados. */
import fs from 'node:fs';
import path from 'node:path';
import { root } from './browser.mjs';
import { AUTH_URL, AUTH_STORAGE_KEY, CONFIG_SCRIPT, USERS, PROFILE } from './auth-fixture.mjs';
export async function seedBrowserAuth(page, fixture, { local = fixture.seed(USERS.A, { 'forja-perfil-v1': PROFILE }), session = {}, seed = true } = {}) {
  await page.evaluateOnNewDocument((values, tab, shouldSeed) => {
    if (!shouldSeed) return;
    if (!localStorage.getItem('__forja_auth_fixture_seeded__')) {
      Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
      localStorage.setItem('__forja_auth_fixture_seeded__', '1');
    }
    if (!sessionStorage.getItem('__forja_auth_fixture_tab__')) {
      Object.entries(tab).forEach(([key, value]) => sessionStorage.setItem(key, value));
      sessionStorage.setItem('__forja_auth_fixture_tab__', '1');
    }
  }, local, session, seed);
}
export async function respondAuth(request, fixture) {
  if (request.isInterceptResolutionHandled()) return true;
  const url = request.url();
  if (url.split(/[?#]/)[0].endsWith('/assets/js/forja-supabase-config.js') && fixture.configured) {
    await request.respond({ status: 200, contentType: 'text/javascript', body: CONFIG_SCRIPT }); return true;
  }
  if (new URL(url).origin === AUTH_URL) {
    const cors = { 'access-control-allow-origin': request.headers().origin || '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'access-control-allow-headers': request.headers()['access-control-request-headers'] || '*', 'access-control-expose-headers': '*' };
    if (request.method() === 'OPTIONS') { await request.respond({ status: 204, headers: cors }); return true; }
    try {
      const response = await fixture.handle(url, { method: request.method(), headers: request.headers(), body: request.postData() });
      await request.respond({ status: response.status, headers: { ...Object.fromEntries(response.headers), ...cors }, body: await response.text() });
    } catch (_) { await request.abort('internetdisconnected'); }
    return true;
  }
  if (new URL(url).pathname.endsWith('/admin/exercicios.html') && fixture.configured) {
    // Em testes a origem exata da CSP acompanha o projeto fictício, como faz o build.
    const html = fs.readFileSync(path.join(root, 'admin/exercicios.html'), 'utf8').replaceAll('https://abundydxjclcgonctirx.supabase.co', AUTH_URL);
    await request.respond({ status: 200, contentType: 'text/html', body: html }); return true;
  }
  return false;
}
export async function installBrowserAuth(page, fixture, origin, options = {}) {
  await seedBrowserAuth(page, fixture, options);
  await page.setRequestInterception(true);
  page.on('request', async request => {
    try {
      if (await respondAuth(request, fixture)) return;
      if (new URL(request.url()).origin === origin || request.url().startsWith('data:')) { await request.continue(); return; }
      // Todo serviço que não é objeto da suíte fica isolado, sem rede externa.
      if (/youtube-videos|youtube-search|workout-plan/.test(request.url())) {
        await request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ associations: [], items: [] }) });
      } else await request.respond({ status: 404, contentType: 'text/plain', body: 'network not used in auth tests' });
    } catch (_) { if (!request.isInterceptResolutionHandled()) await request.abort(); }
  });
}
export async function browserSetSession(page, session) {
  // O SDK real valida o usuário antes de persistir/anunciar a nova sessão.
  await page.evaluate(async value => {
    const result = await window.Forja.auth.client.auth.setSession({ access_token: value.access_token, refresh_token: value.refresh_token });
    if (result.error) throw new Error('fixture setSession failed');
  }, session);
}
export { AUTH_STORAGE_KEY };
