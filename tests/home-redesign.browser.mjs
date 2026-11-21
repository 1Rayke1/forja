import assert from 'node:assert/strict';
import {launchBrowser,startServer,waitReady} from './helpers/browser.mjs';
import {installBrowserAuth} from './helpers/browser-auth.mjs';
import {AuthFixture} from './helpers/auth-fixture.mjs';
const server = await startServer(); const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await installBrowserAuth(page, new AuthFixture(), server.origin);
  await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.goto(server.origin+'/forja/',{waitUntil:'networkidle0'}); await waitReady(page);
  await page.waitForSelector('#home-primary-button');
  for (const width of [320,360,390,430,768,1280]) {
    await page.setViewport({width,height:844,deviceScaleFactor:1,isMobile:width<768,hasTouch:width<768});
    const dimensions = await page.evaluate(() => ({scroll:document.documentElement.scrollWidth, width:innerWidth}));
    assert.ok(dimensions.scroll <= dimensions.width, JSON.stringify(dimensions));
  }
  await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.screenshot({path:'artifacts/home/home-mobile.png',fullPage:true});
  await page.screenshot({path:'artifacts/home/home-mobile-viewport.png'});
  assert.equal(await page.$eval('.home-summary-ring',n=>n.getAttribute('aria-label')), 'Meta semanal não configurada');
  assert.match(await page.$eval('.home-streak',n=>n.textContent), /Não disponível/);
  assert.deepEqual(await page.$$eval('.home-shortcuts a',xs=>xs.map(x=>x.textContent.trim())),['Calendário','Evolução','Explorar','Metas']);
  await page.click('#home-calendar-shortcut'); assert.equal(await page.$eval('#home-calendar',n=>n.open),true);
  await page.evaluate(() => {
    Forja.state.goals = { weeklySessions: 4, modality: 'all' };
    Forja.state.history = [{ date: Forja.dateKey(new Date()), status: 'completed', durationMs: 1800000 }];
    Forja.home.renderProgress();
  });
  assert.match(await page.$eval('.home-summary-goal', n => n.textContent), /1\/4 treinos/);
  assert.equal(await page.$eval('.home-summary-ring', n => n.getAttribute('aria-label')), 'Meta semanal: 25%');
  assert.match(await page.$eval('.home-summary-stats', n => n.textContent), /1Treinos concluídos/);
  for (const selector of ['.home-shortcuts a[href="progresso/index.html"]', '.home-shortcuts a[href="explorar/index.html"]', '.home-shortcuts a[href="progresso/index.html#progress-goals-heading"]', ...['inicio','treino','explorar','progresso','perfil'].map(name => '.bottom-nav-link[data-nav="' + name + '"]')]) {
    const href = await page.$eval(selector, n => n.href);
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}), page.click(selector)]);
    assert.equal(page.url(), href);
    await page.goto(server.origin+'/forja/',{waitUntil:'networkidle0'}); await waitReady(page);
  }
  for (const link of ['.home-shortcuts a[href="progresso/index.html"]','.home-shortcuts a[href="explorar/index.html"]','.home-shortcuts a[href="progresso/index.html#progress-goals-heading"]','.bottom-nav-link','#home-explore-grid a']) {
    const hrefs = await page.$$eval(link, xs=>xs.map(x=>x.href));
    for (const href of hrefs) assert.equal((await page.goto(href,{waitUntil:'domcontentloaded'})).status(),200,href);
    await page.goto(server.origin+'/forja/',{waitUntil:'networkidle0'}); await waitReady(page);
  }
  console.log('Home Chromium: larguras, estados vazios, calendário e destinos aprovados.');
} finally { await browser.close(); await server.close(); }
