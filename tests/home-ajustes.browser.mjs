import assert from 'node:assert/strict';
import { launchBrowser, startServer, waitReady } from './helpers/browser.mjs';
import { installBrowserAuth } from './helpers/browser-auth.mjs';
import { AuthFixture } from './helpers/auth-fixture.mjs';

const server = await startServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateTimezone('America/Sao_Paulo');
  await page.setViewport({ width: 320, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await installBrowserAuth(page, new AuthFixture(), server.origin);
  await page.evaluateOnNewDocument(() => {
    const original = window.setTimeout;
    window.setTimeout = function (callback, delay, ...args) {
      if (delay === 30000) window.__greetingTimeout = callback;
      return original.call(this, callback, delay, ...args);
    };
  });
  await page.goto(server.origin + '/forja/', { waitUntil: 'networkidle0' });
  await waitReady(page);
  await page.waitForSelector('#home-motivation:not(:empty)');
  await page.evaluate(() => {
    window.__RealDate = Date;
    window.Date = class extends window.__RealDate {
      constructor(...args) { super(...(args.length ? args : [window.__fakeNow ?? window.__RealDate.now()])); }
      static now() { return window.__fakeNow ?? window.__RealDate.now(); }
    };
  });
  // São Paulo é UTC−3: garante que o resultado segue a hora local, não UTC.
  for (const [iso, expected] of [
    ['2026-11-21T07:59:00Z', 'Boa noite,'], // 04:59
    ['2026-11-21T08:00:00Z', 'Bom dia,'],
    ['2026-11-21T14:59:00Z', 'Bom dia,'],
    ['2026-11-21T15:00:00Z', 'Boa tarde,'],
    ['2026-11-21T20:59:00Z', 'Boa tarde,'],
    ['2026-11-21T21:00:00Z', 'Boa noite,'],
    ['2026-11-21T05:00:00Z', 'Boa noite,'] // 02:00
  ]) {
    await page.evaluate(instant => { window.__fakeNow = window.__RealDate.parse(instant); Forja.home.renderGreeting(); }, iso);
    assert.equal(await page.$eval('.home-greeting-time', n => n.textContent), expected);
  }
  await page.evaluate(() => {
    Forja.state.profile.nomeExibicao = 'Pessoa Real';
    window.__fakeNow = window.__RealDate.parse('2026-11-21T14:59:00Z');
    Forja.home.renderGreeting();
    window.__fakeNow = window.__RealDate.parse('2026-11-21T15:00:00Z');
    window.__greetingTimeout();
  });
  assert.equal(await page.$eval('.home-greeting-time', n => n.textContent), 'Boa tarde,');
  assert.equal(await page.$eval('.home-greeting-name', n => n.textContent), 'Pessoa Real.');
  await page.evaluate(() => {
    window.__fakeNow = window.__RealDate.parse('2026-11-21T21:00:00Z');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.$eval('.home-greeting-time', n => n.textContent), 'Boa noite,');

  const messages = new Set();
  for (const width of [320, 360, 390, 430]) {
    await page.setViewport({ width, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    for (let i = 0; i < 20; i++) {
      const previous = await page.$eval('#home-motivation', n => n.textContent);
      // Retorno à Home via BFCache escolhe outra mensagem, como uma nova visita.
      await page.evaluate(() => { const event = new PageTransitionEvent('pageshow', { persisted: true }); Object.defineProperty(event, 'forjaVerified', { value: true }); window.dispatchEvent(event); });
      const details = await page.evaluate(() => {
        const p = document.querySelector('#home-motivation');
        const card = p.closest('.home-consistency');
        const streak = card.querySelector('.home-streak');
        const r = p.getBoundingClientRect(), c = card.getBoundingClientRect(), s = streak.getBoundingClientRect();
        return { text: p.textContent, scroll: document.documentElement.scrollWidth, width: innerWidth,
          textFits: p.scrollWidth <= p.clientWidth + 1 && p.scrollHeight <= p.clientHeight + 1, sizes: [p.scrollWidth, p.clientWidth, p.scrollHeight, p.clientHeight],
          fitsCard: r.left >= c.left && r.right <= s.left && r.top >= c.top && r.bottom <= c.bottom };
      });
      assert.notEqual(details.text, previous);
      assert.ok(details.textFits && details.fitsCard, JSON.stringify(details));
      assert.ok(details.scroll <= details.width, JSON.stringify(details));
      messages.add(details.text);
    }
  }
  assert.ok(messages.size >= 5, `Pouca variedade: ${messages.size}`);
  const previous = await page.$eval('#home-motivation', n => n.textContent);
  await page.reload({ waitUntil: 'networkidle0' }); await waitReady(page);
  assert.notEqual(await page.$eval('#home-motivation', n => n.textContent), previous);

  // Se o navegador bloquear sessionStorage, a Home segue funcionando e evita
  // repetição enquanto a instância da página permanece em memória.
  await page.evaluate(() => {
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    window.__restoreStorage = () => { Storage.prototype.getItem = originalGet; Storage.prototype.setItem = originalSet; };
    Storage.prototype.getItem = function (key) { if (this === sessionStorage && key === 'forja-home-motivacao-anterior') throw new Error('bloqueado'); return originalGet.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (this === sessionStorage && key === 'forja-home-motivacao-anterior') throw new Error('bloqueado'); return originalSet.call(this, key, value); };
  });
  let fallbackPrevious = await page.$eval('#home-motivation', n => n.textContent);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => { const event = new PageTransitionEvent('pageshow', { persisted: true }); Object.defineProperty(event, 'forjaVerified', { value: true }); window.dispatchEvent(event); });
    const next = await page.$eval('#home-motivation', n => n.textContent);
    assert.notEqual(next, fallbackPrevious); fallbackPrevious = next;
  }
  await page.evaluate(() => window.__restoreStorage());

  for (const theme of ['default', 'contrast']) {
    await page.evaluate(value => { document.documentElement.dataset.forjaTheme = value; }, theme);
    const header = await page.evaluate(() => {
      const el = document.querySelector('.home-header');
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const brand = el.querySelector('.home-brand').getBoundingClientRect();
      const bell = el.querySelector('#home-notifications').getBoundingClientRect();
      return { background: style.backgroundColor, image: style.backgroundImage, opacity: style.opacity,
        filter: style.backdropFilter, height: rect.height, brand: [brand.left, brand.right], bell: [bell.left, bell.right] };
    });
    assert.equal(header.background, 'rgb(5, 6, 5)');
    assert.equal(header.image, 'none'); assert.equal(header.opacity, '1'); assert.equal(header.filter, 'none');
    assert.ok(header.height >= 60 && header.brand[1] < header.bell[0] && header.bell[1] <= 430, JSON.stringify(header));
  }
  await page.evaluate(() => { document.documentElement.dataset.forjaTheme = 'default'; });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.screenshot({ path: 'artifacts/home/home-ajustes-mobile.png' });
  assert.deepEqual(errors, []);
  console.log(`Ajustes Home: horários locais, atualização, ${messages.size} mensagens, responsividade e cabeçalho opaco aprovados.`);
} finally { await browser.close(); await server.close(); }
