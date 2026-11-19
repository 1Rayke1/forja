/* Run: node --import ./tests/helpers/scrollend-off.mjs tests/e2e.browser.mjs
   A module wrapper, not an edit of the protected browser launcher. */
import { registerHooks } from 'node:module';
registerHooks({
  load(url, context, nextLoad) {
    const path = new URL(url);
    if (path.protocol === 'file:' && path.pathname.endsWith('/tests/helpers/browser.mjs') && !path.searchParams.has('scrollend-native')) {
      const original = new URL(url); original.searchParams.set('scrollend-native', '1');
      return { format: 'module', shortCircuit: true, source: `
        import { launchBrowser as nativeLaunch } from ${JSON.stringify(original.href)};
        export * from ${JSON.stringify(original.href)};
        export async function launchBrowser(options = {}) {
          const browser = await nativeLaunch({ ...options, enforceWebSecurity: true, scrollEndEvents: false });
          const probe = await browser.newPage();
          try {
            const feature = await probe.evaluate(() => 'onscrollend' in document);
            if (feature !== false) throw new Error('Blink ScrollEndEvents OFF was not applied');
            console.log('SCROLLEND OFF real capability=false; original launcher and web security preserved');
          } catch (error) { await browser.close(); throw error; }
          finally { if (!probe.isClosed()) await probe.close(); }
          return browser;
        }
      ` };
    }
    return nextLoad(url, context);
  }
});
