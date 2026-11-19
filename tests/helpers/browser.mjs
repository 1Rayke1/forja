/* Navegador/servidor de testes locais. Não publica nada nem inicia workflow. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Segurança web é o padrão em TODAS as suítes. CORS é tratado pelos servidores
// e fixtures HTTP de teste, nunca desabilitando a proteção do navegador.
export async function launchBrowser({ enforceWebSecurity = true, scrollEndEvents } = {}) {
  if (scrollEndEvents !== undefined && typeof scrollEndEvents !== 'boolean') throw new TypeError('scrollEndEvents deve ser booleano.');
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath();
  if (process.platform === 'linux' && executablePath.startsWith('/tmp/') && !process.env.LD_LIBRARY_PATH) {
    const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@sparticuz/chromium'))), '../..');
    const libs = path.join(os.tmpdir(), 'forja-browser-libs');
    if (!fs.existsSync(path.join(libs, 'lib/libnspr4.so'))) {
      fs.mkdirSync(libs, { recursive: true });
      const tar = path.join(libs, 'libs.tar');
      fs.writeFileSync(tar, brotliDecompressSync(fs.readFileSync(path.join(pkg, 'bin/al2023.tar.br'))));
      execFileSync('tar', ['-xf', tar, '-C', libs]); fs.unlinkSync(tar);
    }
    process.env.LD_LIBRARY_PATH = path.join(libs, 'lib');
  }
  let args = chromium.args.filter(arg => arg !== '--single-process');
  if (enforceWebSecurity) {
    const unsafe = new Set(['--disable-web-security', '--allow-running-insecure-content', '--disable-site-isolation-trials']);
    args = args.filter(arg => !unsafe.has(arg)).map(arg => {
      if (!arg.startsWith('--disable-features=')) return arg;
      const features = arg.slice('--disable-features='.length).split(',').filter(feature => !['IsolateOrigins', 'site-per-process'].includes(feature));
      return features.length ? '--disable-features=' + features.join(',') : '';
    }).filter(Boolean);
  }
  // Só a matriz de interação altera este recurso Blink; SOP/CORS/isolamento
  // continuam sob as mesmas verificações. Demais suítes mantêm o padrão.
  if (scrollEndEvents !== undefined) args.push(`--${scrollEndEvents ? 'enable' : 'disable'}-blink-features=ScrollEndEvents`);
  const browser = await puppeteer.launch({ executablePath, headless: true, args: [...args, '--no-sandbox', '--disable-dev-shm-usage'] });
  if (enforceWebSecurity) {
    const actual = browser.process().spawnargs;
    if (actual.some(arg => /^--(?:disable-web-security|allow-running-insecure-content|disable-site-isolation-trials)(?:=|$)/.test(arg)) ||
        actual.some(arg => arg.startsWith('--disable-features=') && /(?:^|,)(?:IsolateOrigins|site-per-process)(?:,|$)/.test(arg.split('=')[1]))) {
      await browser.close(); throw new Error('O navegador iniciou com segurança web/isolamento desabilitados.');
    }
  }
  return browser;
}
export async function startServer(rootDir = root) {
  const publicRoot = path.resolve(rootDir);
  const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.woff2':'font/woff2' };
  const publicDirs = new Set(['index.html','login.html','assets','treino','explorar','exercicio','progresso','configuracoes','onboarding','admin']);
  const server = http.createServer((request, response) => {
    let relative;
    try { relative = decodeURIComponent(new URL(request.url, 'http://test.local').pathname).replace(/^\/forja\//, '/').replace(/^\//, ''); }
    catch { response.writeHead(400).end(); return; }
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(publicRoot, relative);
    if (!file.startsWith(publicRoot + path.sep) || !publicDirs.has(relative.split('/')[0]) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end('not found'); return;
    }
    response.writeHead(200, { 'content-type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'cache-control':'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  return { server, origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
export const waitReady = page => page.waitForFunction(() => document.documentElement.dataset.forjaAuth === 'ready', { polling: 50, timeout: 10000 });
export const waitLogin = page => page.waitForFunction(() => document.body?.dataset.page === 'login' &&
  window.Forja?.auth && ['guest', 'error'].includes(Forja.auth.state), { polling: 50, timeout: 10000 });
