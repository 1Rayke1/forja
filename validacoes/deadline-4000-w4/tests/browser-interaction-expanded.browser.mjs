/* Existing 40 scroll scenarios stay byte-exact. This separate entry adds
   26 nested + 12 protocol scenarios without editing package.json/launcher. */
await import('./browser-interaction.browser.mjs');
await import('./browser-interaction-nested.browser.mjs');
await import('./browser-interaction-protocol.browser.mjs');
