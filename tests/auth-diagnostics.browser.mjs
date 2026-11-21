/*
  Testes da instrumentação diagnóstica temporária no navegador real (Chromium).

  Verifica:
  - O botão/painel de diagnóstico é acessível mesmo com a tela bloqueada.
  - A captura pode ser iniciada/encerrada/limpa.
  - A exportação (toJSON) funciona no navegador.
  - Registros não contêm tokens/credenciais.
  - Diagnóstico desativado não grava registros.
*/
import assert from 'node:assert/strict';
import { launchBrowser, startServer } from './helpers/browser.mjs';
import { installBrowserAuth } from './helpers/browser-auth.mjs';
import { AuthFixture, AUTH_STORAGE_KEY } from './helpers/auth-fixture.mjs';

const localServer = await startServer();
const browser = await launchBrowser({ enforceWebSecurity: true });
const base = localServer.origin + '/forja/';
const SENSITIVE_PATTERNS = ["access_token", "refresh_token", "Bearer", "sb-", "code_verifier", "service_role", "sb_secret"];
let passed = 0, failed = 0;

async function test(name, task) {
  const context = await browser.createBrowserContext();
  const fixture = new AuthFixture();
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try { await task({ fixture, page, errors }); assert.deepEqual(errors, [], 'exceções no navegador'); passed++; console.log('✅ BROWSER DIAG ' + name); }
  catch (error) { failed++; console.error('❌ BROWSER DIAG ' + name + '\n' + error.stack); }
  finally { await context.close(); }
}
const goto = async (page, url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); };

try {
  // Força o estado de tela bloqueada travada ("Verificando sua sessão…") para
  // verificar que o botão de diagnóstico permanece acessível sob o gate CSS,
  // exatamente a condição que o Android encontra.
  const forceLocked = page => page.evaluate(() => {
    document.documentElement.dataset.forjaAuth = 'locked';
    const status = document.getElementById('auth-gate-status');
    if (status) status.textContent = 'Verificando sua sessão…';
    const retry = document.getElementById('auth-retry');
    if (retry) retry.hidden = true;
  });

  await test('1. Botão de diagnóstico visível com a tela bloqueada', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin);
    await goto(page, base);
    await page.waitForSelector('html[data-forja-auth="ready"]', { timeout: 10000 });
    await forceLocked(page);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.forjaAuth), 'locked');
    const fabVisible = await page.evaluate(() => {
      const fab = document.getElementById('forja-diag-fab');
      if (!fab) return false;
      const style = getComputedStyle(fab);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    assert.equal(fabVisible, true, 'botão de diagnóstico deve estar visível no bloqueio');
  });

  await test('2. Painel abre e mostra controles', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin);
    await goto(page, base);
    await page.waitForSelector('html[data-forja-auth="ready"]', { timeout: 10000 });
    await forceLocked(page);
    await page.waitForSelector('#forja-diag-fab');
    await page.click('#forja-diag-fab');
    const panelOpen = await page.evaluate(() => {
      const panel = document.getElementById('forja-diag-panel');
      return Boolean(panel) && panel.hidden === false;
    });
    assert.equal(panelOpen, true, 'painel deve abrir');
    const controls = await page.evaluate(() => {
      const panel = document.getElementById('forja-diag-panel');
      return Array.from(panel.querySelectorAll('button')).map(b => b.id);
    });
    for (const id of ['forja-diag-start', 'forja-diag-stop', 'forja-diag-export', 'forja-diag-copy', 'forja-diag-clear']) {
      assert.ok(controls.includes(id), 'controle presente: ' + id);
    }
  });

  await test('3. Iniciar/parar/limpar captura funcionam', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin);
    await goto(page, base);
    await page.waitForSelector('html[data-forja-auth="ready"]');
    await page.click('#forja-diag-fab');
    await page.click('#forja-diag-start');
    await page.waitForFunction(() => window.ForjaDiagnostics.isEnabled() && window.ForjaDiagnostics.count() > 0);
    await page.click('#forja-diag-stop');
    await page.waitForFunction(() => window.ForjaDiagnostics.isEnabled() === false);
    await page.click('#forja-diag-clear');
    await page.waitForFunction(() => window.ForjaDiagnostics.count() === 0);
    assert.equal(await page.evaluate(() => window.ForjaDiagnostics.count()), 0, 'limpeza zera registros');
  });

  await test('4. Exportação (toJSON/download) funciona e não tem credenciais', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin);
    await goto(page, base);
    await page.waitForSelector('html[data-forja-auth="ready"]');
    await page.click('#forja-diag-fab');
    await page.click('#forja-diag-start');
    await page.waitForFunction(() => window.ForjaDiagnostics.count() > 0);
    // Disparar eventos do fluxo.
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const json = await page.evaluate(() => window.ForjaDiagnostics.toJSON());
    const parsed = JSON.parse(json);
    assert.equal(parsed.diagnostics, 'forja-auth-diagnostics');
    assert.ok(parsed.records.length > 0);
    const text = JSON.stringify(parsed);
    for (const pattern of SENSITIVE_PATTERNS) {
      assert.ok(!text.includes(pattern), 'dado sensível no export: ' + pattern);
    }
    // download() deve retornar true (cria o blob local).
    const downloaded = await page.evaluate(() => window.ForjaDiagnostics.download());
    assert.equal(downloaded, true, 'download local funciona');
  });

  await test('5. Diagnóstico desativado não grava registros', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin);
    await goto(page, base);
    await page.waitForSelector('html[data-forja-auth="ready"]');
    const count = await page.evaluate(() => window.ForjaDiagnostics.count());
    assert.equal(count, 0, 'sem registros quando desativado');
    assert.equal(await page.evaluate(() => window.ForjaDiagnostics.isEnabled()), false);
  });

  await test('6. Ativação por URL ?forja-diag=1 funciona', async ({ fixture, page }) => {
    await installBrowserAuth(page, fixture, localServer.origin);
    await goto(page, base + '?forja-diag=1');
    await page.waitForSelector('html[data-forja-auth="ready"]');
    await page.waitForFunction(() => window.ForjaDiagnostics.isEnabled() === true);
    assert.ok(await page.evaluate(() => window.ForjaDiagnostics.count() > 0), 'captura ativada pela URL');
  });
} finally {
  await browser.close();
}

console.log('\nBROWSER DIAG — ' + passed + '/' + (passed + failed) + ' testes aprovados.');
if (failed > 0) process.exit(1);
