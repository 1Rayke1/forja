/*
  FORJA — inicialização comum de todas as páginas.

  Ordem: Google verificado → dados da conta → modelos existentes → página → avisos.
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

  /*
    "Pular para o conteúdo" leva a rolagem até <main id="conteudo">, mas o foco
    ficava no topo porque o main não é focável. Deixá-lo focável por programa
    (tabindex="-1", fora da ordem do Tab) faz o navegador mover o foco para o
    conteúdo em todas as páginas, inclusive na do atlas.
  */
  function prepareSkipTarget() {
    const target = doc.getElementById("conteudo");
    if (target && !target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");
    }
  }

  let booted = false;
  let bootWork = null;
  let resolveReady;
  F.ready = new Promise(resolve => { resolveReady = resolve; });

  async function retryChangedSession() {
    await F.auth.revalidate();
    if (F.auth.isVerified()) global.setTimeout(() => { void boot(true); }, 0);
  }

  async function bootPage(retry) {
    if (booted) return F.auth.revalidate();
    const actualUser = await (retry ? F.auth.revalidate() : F.auth.init());
    if (!actualUser) return;
    if (!F.auth.isVerified(actualUser.id)) { await retryChangedSession(); return; }
    try {
      await F.authData.bind(actualUser);
    } catch (error) {
      if (error.sessionChanged) { await retryChangedSession(); return; }
      F.auth.gate(error.message || "Não foi possível preparar os dados. Os originais estão preservados.", true);
      return;
    }
    if (!F.auth.isVerified(actualUser.id)) { await retryChangedSession(); return; }
    prepareSkipTarget();
    F.bootData();
    if (typeof F.applyAppearance === "function") F.applyAppearance();

    const name = F.pageName();
    /*
      Perfil obrigatório: todas as páginas do aplicativo (inclusive acesso
      direto, refresh e links salvos) passam pelo mesmo gate. A própria rota de
      onboarding permanece acessível para iniciar/retomar ou refazer o perfil.
      Perfil legado com updatedAt continua válido; não migramos nem apagamos
      dados durante a checagem. A gravação final do onboarding só libera após
      saveProfile retornar sucesso.
    */
    if (name !== "onboarding" && !F.profileIsConfigured(F.state.profile)) {
      F.auth.setReturn(F.auth.safeReturn(global.location.href) || "index.html");
      F.navigate(F.url("onboarding"));
      resolveReady({ redirected: true });
      return;
    }

    if (name !== "onboarding") F.auth.clearReturn();
    if (!F.auth.unlock(actualUser.id)) return;
    booted = true;
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

    function workoutTick() { if (F.auth.canWrite()) F.workoutTick(); }
    global.setInterval(workoutTick, TICK_MS);
    resolveReady({ userId: actualUser.id });
    void F.authData.runInitialCopy();

    doc.addEventListener("visibilitychange", () => {
      if (!doc.hidden && F.auth.canWrite()) refreshAfterVisibility();
    });

    global.addEventListener("pageshow", event => {
      if (event.persisted && F.auth.canWrite()) refreshAfterVisibility();
    });
  }

  function boot(retry) {
    if (!bootWork) bootWork = bootPage(retry === true).catch(() => {
      F.auth.gate("A página não pôde ser iniciada com segurança. Recarregue; os dados locais foram preservados.", true);
    }).finally(() => { bootWork = null; });
    return bootWork;
  }
  F.retryBoot = () => boot(true);

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
