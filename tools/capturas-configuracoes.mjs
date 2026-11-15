/*
  Capturas reais da tela de Configurações em Chromium, com SDK Supabase real
  e Auth/PostgREST HTTP SIMULADOS. Não homologa Google/RLS, não usa chave real,
  não executa SQL. O nome "Ravy" é fixture, nunca dado padrão do aplicativo.

  Uso: npm run capturas:configuracoes
       node tools/capturas-configuracoes.mjs --out .cache/capturas-configuracoes
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, startServer, waitReady } from '../tests/helpers/browser.mjs';
import { installBrowserAuth } from '../tests/helpers/browser-auth.mjs';
import { AuthFixture, USERS, PROFILE } from '../tests/helpers/auth-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.FORJA_ROOT || path.join(here, '..'));
const outArg = process.argv.indexOf('--out');
const output = path.resolve(outArg >= 0 && process.argv[outArg + 1]
  ? process.argv[outArg + 1]
  : path.join(root, 'artifacts', 'forja-configuracoes'));
fs.mkdirSync(output, { recursive: true });
const server = await startServer(root);
const base = server.origin + '/forja/';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await launchBrowser();
const page = await browser.newPage();
const errors = [];
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => {
  if (!/ERR_ABORTED/i.test(request.failure()?.errorText || '')) errors.push(request.url());
});
const fixture = new AuthFixture();
await installBrowserAuth(page, fixture, server.origin, { local: fixture.seed(USERS.A, {
  'forja-perfil-v1': {
    ...PROFILE,
    updatedAt: '2026-01-02T00:00:00.000Z',
    onboardingConcluidoEm: '2026-01-02T00:00:00.000Z',
    nomeExibicao: 'Ravy',
    objetivo: 'hipertrofia',
    nivel: 'intermediario',
    equipamento: 'academia'
  }
}) });
const report = {
  generatedAt: new Date().toISOString(),
  fixture: 'configuracoes-captura-v2 (nome Ravy apenas para a captura; SDK real / Auth HTTP simulado)',
  remoteAuthenticationVerified: false,
  screenshots: [],
  layout: [],
  consoleErrors: errors
};

async function capture(name, url, width, height, fullPage = true) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(base + url, { waitUntil: 'networkidle0' });
  await waitReady(page);
  await page.evaluate(() => document.fonts.ready);
  await sleep(250);
  const layout = await page.evaluate(() => ({
    title: document.title,
    overflow: document.documentElement.scrollWidth - innerWidth,
    height: document.documentElement.scrollHeight,
    visiblePanel: document.querySelector('[data-settings-panel]:not([hidden])')?.getAttribute('data-settings-panel') || null
  }));
  const file = path.join(output, name + '.png');
  await page.screenshot({ path: file, fullPage });
  report.screenshots.push(path.relative(root, file));
  report.layout.push({ name, width, height, ...layout });
}

try {
  await capture('configuracoes-320', 'configuracoes/', 320, 844);
  await capture('configuracoes-390', 'configuracoes/', 390, 844);
  await capture('configuracoes-390-viewport', 'configuracoes/', 390, 844, false);
  await capture('configuracoes-1280', 'configuracoes/', 1280, 900);
  await capture('editar-perfil-390', 'configuracoes/#editar-perfil', 390, 844);
  await capture('notificacoes-390', 'configuracoes/#notificacoes', 390, 844);
  await capture('aparencia-390', 'configuracoes/#aparencia', 390, 844);
  await capture('privacidade-390', 'configuracoes/#privacidade', 390, 844);

  /* Tema alternativo aplicado de verdade, inclusive fora de Configurações. */
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(base + 'configuracoes/#aparencia', { waitUntil: 'networkidle0' });
  await waitReady(page);
  await page.click('input[name="appearance-theme"][value="contrast"]');
  await sleep(150);
  await capture('aparencia-alto-contraste-390', 'configuracoes/#aparencia', 390, 844);
  await capture('inicio-alto-contraste-390', 'index.html', 390, 844);
} finally {
  await browser.close();
  await server.close();
}
fs.writeFileSync(path.join(output, 'relatorio.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Capturas em ' + output);
console.log('Overflow: ' + report.layout.every(item => item.overflow === 0));
console.log('Erros de console: ' + errors.length);
if (errors.length || report.layout.some(item => item.overflow !== 0)) process.exitCode = 1;
