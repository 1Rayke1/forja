import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const W = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const checkout = path.join(W, '.cache/checkout');
const { launchBrowser } = await import(pathToFileURL(path.join(checkout, 'tests/helpers/browser.mjs')).href);

const records = [];
const target = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<!doctype html><p>Cross-origin local target without CORS.</p>'));
await new Promise(resolve => target.listen(0, '0.0.0.0', resolve));
const other = 'http://127.0.0.1:' + target.address().port;
const source = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(`<!doctype html><iframe src="${other}/"></iframe>`));
await new Promise(resolve => source.listen(0, '0.0.0.0', resolve));

try {
  for (const scrollEndEvents of [true, false]) {
    const browser = await launchBrowser({ enforceWebSecurity: true, scrollEndEvents });
    try {
      const page = await browser.newPage();
      const expectedConsole = [];
      page.on('console', m => { if (m.type() === 'error') expectedConsole.push(m.text()); });
      await page.goto('http://127.0.0.1:' + source.address().port + '/', { waitUntil: 'load' });
      const observed = await page.evaluate(async otherOrigin => {
        let sop, cors;
        try { void document.querySelector('iframe').contentWindow.document; sop = 'UNEXPECTED_READ'; } catch (e) { sop = e.name; }
        try { await fetch(otherOrigin + '/no-cors'); cors = 'UNEXPECTED_READ'; } catch (e) { cors = e.name; }
        return { sop, cors, nativeScrollend: 'onscrollend' in document };
      }, other);
      const session = await page.createCDPSession();
      const actual = await session.send('Browser.getBrowserCommandLine');
      const unsafe = actual.arguments.filter(a =>
        /^--(?:disable-web-security|allow-running-insecure-content|disable-site-isolation-trials)(?:=|$)/.test(a) ||
        (a.startsWith('--disable-features=') && /(?:^|,)(?:IsolateOrigins|site-per-process)(?:,|$)/.test(a.split('=')[1] || ''))
      );
      assert.equal(observed.sop, 'SecurityError');
      assert.equal(observed.cors, 'TypeError');
      assert.equal(observed.nativeScrollend, scrollEndEvents);
      assert.deepEqual(unsafe, []);
      records.push({
        scrollEndEvents,
        version: await browser.version(),
        observed,
        unsafe,
        actualBrowserArguments: actual.arguments,
        expectedCorsConsole: expectedConsole,
        note: 'Expected CORS-denial console entries occur only in this deliberate SOP/CORS denial probe.'
      });
      console.log(`✅ SECURITY PROBE ${scrollEndEvents ? 'ON' : 'OFF'} ` + JSON.stringify({ scrollEndEvents, observed, unsafe }));
    } finally {
      await browser.close();
    }
  }
} finally {
  await Promise.all([new Promise(r => source.close(r)), new Promise(r => target.close(r))]);
}

fs.writeFileSync(path.join(W, 'evidence/security-capability-probe.json'), JSON.stringify(records, null, 2) + '\n');
console.log(`SECURITY CAPABILITY PROBE — ${records.length}/${records.length} passed.`);
