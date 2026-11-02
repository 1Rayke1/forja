// Teste de interface com Chromium; capturas opcionais nunca sobrescrevem a v1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath();
if (executablePath.startsWith('/tmp/') && !process.env.LD_LIBRARY_PATH) {
  const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@sparticuz/chromium'))), '../..');
  const lib = path.join(os.tmpdir(), 'forja-e2e-al2023');
  if (!fs.existsSync(path.join(lib, 'lib', 'libnspr4.so'))) {
    fs.mkdirSync(lib, { recursive: true });
    const archive = path.join(os.tmpdir(), 'forja-e2e-al2023.tar');
    fs.writeFileSync(archive, brotliDecompressSync(fs.readFileSync(path.join(pkg, 'bin', 'al2023.tar.br'))));
    execFileSync('tar', ['-xf', archive, '-C', lib]);
    fs.unlinkSync(archive);
  }
  process.env.LD_LIBRARY_PATH = path.join(lib, 'lib');
}
const mime = {'.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.mp4':'video/mp4', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2'};
const server = http.createServer((req,res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const f = path.resolve(root, '.' + pathname);
  if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404).end(); return; }
  const size = fs.statSync(f).size;
  const headers = {'Content-Type': mime[path.extname(f)] || 'application/octet-stream', 'Accept-Ranges':'bytes'};
  let start = 0, end = size - 1, status = 200;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (range) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end; status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`; }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(f, {start,end}).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({executablePath, args:[...chromium.args, '--no-sandbox', '--disable-dev-shm-usage']});
const url = `http://127.0.0.1:${server.address().port}/avaliacao-piloto-3d/`;
const screenshots = process.env.PILOTO_CAPTURAS_DIR;
if (screenshots) fs.mkdirSync(screenshots, {recursive:true});
try {
  for (const [name, viewport] of [
    ['desktop', {width:1440,height:900,deviceScaleFactor:1}],
    ['android-emulado', {width:412,height:915,deviceScaleFactor:2,isMobile:true,hasTouch:true}],
    ['android-paisagem-emulado', {width:915,height:412,deviceScaleFactor:1,isMobile:true,hasTouch:true,isLandscape:true}]
  ]) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    if (name.startsWith('android')) await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36');
    const requests = [], errors = [];
    page.on('request', r => requests.push(r.url()));
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(url, {waitUntil:'networkidle0'});
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && (v.readyState >= 2 || v.error); }, {timeout:15000});
    const initial = await page.evaluate(() => ({videos:document.querySelectorAll('video').length, images:document.querySelectorAll('img,picture,canvas').length, poster:document.querySelectorAll('video[poster]').length, text:document.body.innerText, overflow:document.documentElement.scrollWidth > innerWidth, error:document.querySelector('video').error?.message}));
    assert.equal(initial.error, undefined, `Falha de decodificação ${name}: ${initial.error}`);
    assert.equal(initial.videos, 1); assert.equal(initial.images, 0); assert.equal(initial.poster, 0);
    assert.doesNotMatch(initial.text, /vertical|9:16|mosaico|galeria/i);
    assert.equal(initial.overflow, false);
    await page.click('#btn-play-horizontal');
    await page.waitForFunction(() => {const v=document.querySelector('video');return !v.paused && v.currentTime > 0.2;}, {timeout:10000});
    const metadata = await page.evaluate(() => {const v=document.querySelector('video'); return [v.videoWidth,v.videoHeight,v.duration]});
    assert.equal(metadata[0], 1280); assert.equal(metadata[1], 720); assert.ok(Math.abs(metadata[2]-6)<.15);
    if (screenshots) await page.screenshot({path:path.join(screenshots, `verificacao-${name}.png`)});
    await page.click('#btn-pause-horizontal');
    assert.equal(await page.$eval('video', v=>v.paused), true);
    await page.click('#btn-restart-horizontal');
    assert.equal(await page.$eval('video', v=>v.currentTime), 0);
    await page.click('#btn-play-horizontal');
    for (const [button, rate] of [['#speed-h-025',.25],['#speed-h-050',.5],['#speed-h-100',1]]) {
      await page.click(button);
      assert.equal(await page.$eval('video',v=>v.playbackRate),rate);
      assert.equal(await page.$eval(button,b=>b.getAttribute('aria-pressed')),'true');
      const start = await page.$eval('video', v=>v.currentTime);
      await page.waitForFunction(t=>document.querySelector('video').currentTime > t + 0.02, {timeout:3000}, start);
    }
    await page.click('#btn-fs-horizontal');
    await page.waitForFunction(() => {const s=document.querySelector('[data-piloto-stage]');return document.fullscreenElement===s || s.classList.contains('is-pseudo-fullscreen');});
    assert.equal(await page.$eval('.piloto-fs-toolbar', e=>getComputedStyle(e).display !== 'none'),true);
    await page.click('[data-action="exit-fullscreen"]');
    await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('[data-piloto-stage]').classList.contains('is-pseudo-fullscreen'));
    assert.ok(requests.some(x=>x.includes('abdominal-masculino-horizontal-16x9.mp4')));
    assert.ok(!requests.some(x=>/vertical|mosaico|poster|\.(png|jpg|jpeg|webp)(\?|$)/i.test(x)), `Recurso indevido: ${requests.join('\n')}`);
    assert.deepEqual(errors, []);
    console.log(`OK ${name}: vídeo, controles, tela cheia e ausência de imagens; ${metadata.join(' × ')}`);
    await page.close();
  }
  // Falha do preload antes do clique deve ser informada.
  const erroPage = await browser.newPage();
  await erroPage.setRequestInterception(true);
  let bloquearVideo = true;
  erroPage.on('request', req => {
    if (bloquearVideo && req.method() === 'GET' && req.url().endsWith('.mp4')) req.abort();
    else req.continue();
  });
  await erroPage.goto(url, {waitUntil:'networkidle0'});
  await erroPage.waitForFunction(() => document.querySelector('video').error, {timeout:10000});
  await erroPage.click('#btn-play-horizontal');
  await erroPage.waitForFunction(() => !document.querySelector('[data-piloto-error]').hidden);
  console.log('OK falha no preload informada');
  await erroPage.close();
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
