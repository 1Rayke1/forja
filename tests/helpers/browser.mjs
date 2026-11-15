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
export async function launchBrowser() {
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
  return puppeteer.launch({ executablePath, headless: true, args: [...chromium.args.filter(arg => arg !== '--single-process'), '--no-sandbox', '--disable-dev-shm-usage'] });
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
export const waitLogin = page => page.waitForFunction(() => document.body?.dataset.page === 'login', { polling: 50, timeout: 10000 });
