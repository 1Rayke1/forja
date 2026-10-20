/*
  FORJA — inicialização comum de todas as páginas.

  Ordem: dados (uma leitura por página) → módulo da página → avisos.
  Existe um único intervalo de atualização (F.workoutTick), criado aqui.
  Os tempos são calculados a partir de timestamps; o intervalo só redesenha.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const TICK_MS = 250;

  function showFlash() {
    const flash = F.consumeFlash();
    if (flash) F.showToast(flash.message, flash.tone || "info", 4500);
  }

  function showBootNotices() {
    if (!F.state.bootNotices || F.state.bootNotices.length === 0) return;
    F.showToast(F.state.bootNotices.join(" "), "info", 6500);
  }

  function refreshAfterVisibility() {
    F.workoutTick();
    if (typeof F.renderExecution === "function") F.renderExecution();
  }

  function boot() {
    F.bootData();

    const name = F.pageName();
    const init = F.pages[name];

    if (typeof init === "function") {
      try {
        init();
      } catch (error) {
        console.error("Falha ao iniciar a página " + name + ":", error);
        F.showToast("Esta página não pôde ser carregada. Recarregue e tente de novo.", "error", 8000);
      }
    }

    F.updateActiveBanner();
    showFlash();
    showBootNotices();

    global.setInterval(F.workoutTick, TICK_MS);

    doc.addEventListener("visibilitychange", () => {
      if (!doc.hidden) refreshAfterVisibility();
    });

    global.addEventListener("pageshow", event => {
      if (event.persisted) refreshAfterVisibility();
    });
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
