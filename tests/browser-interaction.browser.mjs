/* Regressão da sincronização de rolagem: Chromium real com SOP/CORS ativos.
   As barreiras retêm pedidos/entregas reais, não dormem tentando vencer o scheduler. */
import assert from 'node:assert/strict';
import { launchBrowser } from './helpers/browser.mjs';
import { scrollToInteractable } from './helpers/browser-interaction.mjs';
let passed = 0, failed = 0;
// Dá oportunidades de renderização ao helper ENQUANTO a barreira continua
// fechada. Não é uma espera usada para decidir que o scroll terminou.
const renderTurns = page => page.evaluate(() => new Promise(resolve => {
  let frames = 0;
  const frame = () => { if (++frames === 6) resolve(); else requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}));
const hit = page => page.$eval('#details', element => {
  const box = element.getBoundingClientRect(), top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return { ok: top === element || element.contains(top), top: top?.tagName, scrollY, buttonTop: box.top };
});
async function fixture(browser, scrollEndEvents, paddingTop = 782, covered = false) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.setViewport({ width: 390, height: 844 });
  await page.setContent(`<!doctype html><style>html{scroll-behavior:smooth}body{margin:0}main{padding-top:${paddingTop}px;height:1600px}button{height:34px}nav{position:fixed;bottom:0;left:0;right:0;height:80px;background:#111;color:white;z-index:2}.cover{position:fixed;top:380px;left:0;right:0;height:100px;z-index:3;background:#333}</style><main><button id="details">Detalhes</button></main><nav>Barra inferior</nav>${covered ? '<aside class="cover">Obstrução</aside>' : ''}`);
  assert.equal(await page.evaluate(() => 'onscrollend' in document), scrollEndEvents, 'a configuração precisa mudar o suporte real, não apenas um mock do helper');
  await page.evaluate(() => {
    const element = document.querySelector('#details'), scroll = element.scrollIntoView.bind(element), root = document.scrollingElement;
    const box = element.getBoundingClientRect();
    window.scrollTarget = Math.max(0, Math.min(root.scrollHeight - innerHeight, root.scrollTop + box.top + box.height / 2 - innerHeight / 2));
    window.scrollTrace = []; window.scrollEndTrace = [];
    document.addEventListener('scroll', () => scrollTrace.push(scrollY));
    document.addEventListener('scrollend', event => scrollEndTrace.push({ y: scrollY, trusted: event.isTrusted }));
    window.releaseScroll = () => scroll({ block: 'center' });
    element.scrollIntoView = () => { window.scrollRequested = true; };
    element.onclick = event => { window.clickedDetails = true; window.clickEvidence = { trusted: event.isTrusted, y: scrollY, top: element.getBoundingClientRect().top }; };
    // Retém a ENTREGA dos eventos nativos ao helper. Não cria/redispara
    // scrollend; a observação acima recebe os eventos reais imediatamente.
    const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document), listeners = new Map();
    window.holdNativeEnd = true; window.pendingNativeEnds = []; window.helperEndListeners = 0;
    window.releaseNativeEnds = () => { for (const deliver of pendingNativeEnds.splice(0)) deliver(); };
    document.addEventListener = (type, listener, options) => {
      if (type !== 'scrollend') return add(type, listener, options);
      helperEndListeners++;
      const wrapped = event => { if (holdNativeEnd) pendingNativeEnds.push(() => listener(event)); else listener(event); };
      listeners.set(listener, wrapped); return add(type, wrapped, options);
    };
    document.removeEventListener = (type, listener, options) => {
      const wrapped = type === 'scrollend' && listeners.get(listener);
      if (wrapped) listeners.delete(listener);
      return remove(type, wrapped || listener, options);
    };
    window.activeEndListeners = () => listeners.size;
  });
  return { page, errors };
}
function start(page) {
  const state = { complete: false };
  state.waiting = scrollToInteractable(page, '#details').then(() => { state.complete = true; });
  // Mantém a rejeição observada mesmo se uma asserção da barreira falhar antes.
  // O resultado continua sendo aguardado abaixo; não converte falha em sucesso.
  void state.waiting.catch(() => {});
  return state;
}
async function finish(page, operation, scrollEndEvents) {
  await page.evaluate(() => releaseScroll());
  if (scrollEndEvents) {
    await page.waitForFunction(() => scrollEndTrace.some(event => Math.abs(event.y - scrollTarget) < 1) && pendingNativeEnds.length > 0, { polling: 'raf', timeout: 4000 });
    await renderTurns(page);
    assert.equal(operation.complete, false, 'com suporte, chegar ao alvo não dispensa o evento nativo');
    await page.evaluate(() => releaseNativeEnds());
  }
  await operation.waiting;
  const evidence = await hit(page); assert.equal(evidence.ok, true);
  const settled = await page.$eval('#details', element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { atTarget: Math.abs(scrollY - scrollTarget) < 1, visible: style.visibility === 'visible' && Number(style.opacity) > 0 && box.width > 0 && box.height > 0 && box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth };
  });
  assert.equal(settled.atTarget, true); assert.equal(settled.visible, true);
  await renderTurns(page); assert.deepEqual(await hit(page), evidence, 'posição/geometria não podem continuar mudando depois da conclusão');
  await page.click('#details'); assert.equal(await page.evaluate(() => window.clickedDetails), true);
  const clicked = await page.evaluate(() => clickEvidence); assert.equal(clicked.trusted, true, 'o clique precisa vir do dispositivo de entrada do navegador');
  assert.equal(clicked.y, evidence.scrollY); assert.equal(clicked.top, evidence.buttonTop);
  const events = await page.evaluate(() => ({ feature: 'onscrollend' in document, registered: helperEndListeners, active: activeEndListeners(), native: scrollEndTrace, moved: scrollTrace.some(y => y > 0 && y < scrollTarget - 1) }));
  assert.equal(events.active, 0, 'listener do helper precisa ser limpo');
  assert.equal(events.registered, scrollEndEvents ? 1 : 0);
  assert.equal(events.native.length > 0, scrollEndEvents);
  if (scrollEndEvents) assert.ok(events.native.every(event => event.trusted));
  return { ...evidence, ...settled, feature: events.feature, nativeEvents: events.native.length, intermediateMovementObserved: events.moved, trustedClick: clicked.trusted };
}
for (const scrollEndEvents of [true, false]) {
  const mode = scrollEndEvents ? 'ON' : 'OFF', browser = await launchBrowser({ enforceWebSecurity: true, scrollEndEvents });
  async function test(name, task, paddingTop, covered) {
    const { page, errors } = await fixture(browser, scrollEndEvents, paddingTop, covered);
    try {
      const evidence = await task(page);
      assert.deepEqual(errors, [], 'nenhum erro de console/página'); passed++;
      console.log(`✅ SCROLL ${mode} ${name} ` + JSON.stringify({ ...evidence, consoleErrors: errors.length }));
    } catch (error) { failed++; console.error(`❌ SCROLL ${mode} ${name}\n` + error.stack); }
    finally { await page.close(); }
  }
  try {
    console.log(`SCROLL CONFIG ${mode}: ${await browser.version()}; segurança web/isolamento ativos`);
    await test('1. Pedido pendente e alvo obstruído; fim real, visibilidade, hit-test e clique', async page => {
      const operation = start(page);
      await page.waitForFunction(() => window.scrollRequested === true, { polling: 'raf', timeout: 4000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => scrollRequested), true);
      assert.equal(operation.complete, false, 'a condição não pode passar com rolagem pendente e alvo obstruído');
      assert.deepEqual(await hit(page), { ok: false, top: 'NAV', scrollY: 0, buttonTop: 782 });
      const evidence = await finish(page, operation, scrollEndEvents);
      assert.equal(evidence.intermediateMovementObserved, true, 'a rolagem suave real precisa ter percorrido posições intermediárias');
      return evidence;
    });
    await test('2. Alvo já livre não dispensa início nem pausa intermediária fora do destino', async page => {
      const operation = start(page);
      await page.waitForFunction(() => window.scrollRequested === true, { polling: 'raf', timeout: 4000 });
      await renderTurns(page); assert.equal((await hit(page)).ok, true);
      assert.equal(operation.complete, false, 'posição parada antes do início não significa fim');
      await page.evaluate(() => scrollTo({ top: Math.floor(scrollTarget / 2), behavior: 'instant' }));
      await page.waitForFunction(() => scrollY === Math.floor(scrollTarget / 2), { polling: 'raf', timeout: 4000 });
      if (scrollEndEvents) {
        await page.waitForFunction(() => pendingNativeEnds.length > 0, { polling: 'raf', timeout: 4000 });
        await page.evaluate(() => releaseNativeEnds());
      }
      await renderTurns(page); assert.equal((await hit(page)).ok, true);
      assert.equal(operation.complete, false, 'pausa/evento intermediário longe do destino não significa fim');
      return finish(page, operation, scrollEndEvents);
    }, 650);
    await test('3. Sem deslocamento necessário não fica esperando evento inexistente', async page => {
      await scrollToInteractable(page, '#details');
      const evidence = await hit(page); assert.equal(evidence.ok, true); assert.equal(evidence.scrollY, 0);
      await page.click('#details'); assert.equal(await page.evaluate(() => window.clickedDetails), true);
      assert.equal(await page.evaluate(() => clickEvidence.trusted), true);
      assert.equal(await page.evaluate(() => activeEndListeners()), 0);
      assert.equal(await page.evaluate(() => scrollEndTrace.length), 0);
      return { ...evidence, trustedClick: true, nativeEvents: 0 };
    }, 405);
    await test('4. Pedido que nunca progride termina no limite original e limpa listener', async page => {
      await assert.rejects(scrollToInteractable(page, '#details'), { name: 'TimeoutError', message: /4000ms/ });
      assert.equal(await page.evaluate(() => activeEndListeners()), 0);
      assert.notEqual(await page.evaluate(() => window.clickedDetails), true);
      return { expectedTimeout: 4000, clickPrevented: true };
    });
    await test('5. Chegar ao destino com alvo coberto não libera clique', async page => {
      await page.evaluate(() => { holdNativeEnd = false; });
      const operation = start(page), rejected = assert.rejects(operation.waiting, { name: 'TimeoutError', message: /4000ms/ });
      await page.waitForFunction(() => window.scrollRequested === true, { polling: 'raf', timeout: 4000 });
      await page.evaluate(() => releaseScroll()); await rejected;
      assert.equal(await page.evaluate(() => Math.abs(scrollY - scrollTarget) < 1), true);
      assert.equal((await hit(page)).ok, false); assert.equal(operation.complete, false);
      assert.equal(await page.evaluate(() => activeEndListeners()), 0);
      assert.notEqual(await page.evaluate(() => window.clickedDetails), true);
      return { expectedTimeout: 4000, atTarget: true, covered: true, clickPrevented: true };
    }, 782, true);
  } finally { await browser.close(); }
}
console.log(`\nSCROLL SYNC — ${passed}/${passed + failed} cenários aprovados; eventos nativos ON/OFF, zero sleep/clique sintético.`);
if (failed) process.exitCode = 1;

// Manter integralmente a matriz original e executar também as 15 regressões
// nos dois modos pelo mesmo comando npm run test:e2e.
await import('./browser-interaction-regressions.browser.mjs');
