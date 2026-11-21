/*
  FORJA — inicialização comum de todas as páginas.

  Ordem: Google verificado → dados da conta → modelos existentes → página → avisos.
  Existe um único intervalo de atualização (F.workoutTick), criado aqui.
  Os tempos são calculados a partir de timestamps; o intervalo só redesenha.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const diag = global.ForjaDiagnostics; // instrumentação diagnóstica temporária (leitura)
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
    if (diag) diag.record("app:refreshAfterVisibility", {});
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

  // Se a sessão mudou durante a inicialização, revalida uma única vez e
  // continua o boot com o usuário verificado — sem validação duplicada.
  async function retryChangedSession() {
    if (diag) diag.record("app:retryChangedSession", {});
    const user = await F.auth.revalidate();
    if (diag) diag.record("app:retryChangedSession:after", { hasUser: Boolean(user) });
    if (!user) return;
    if (!F.auth.isVerified(user.id)) return;
    global.setTimeout(() => { void continueBoot(user); }, 0);
  }

  /*
    Continuação do boot a partir de um usuário CUJO a sessão já foi
    verificada (getUser). A interface é liberada imediatamente após a
    verificação: a recuperação dos dados (vinculação, journal, hidratação
    remota) acontece por trás da tela autenticada, sem manter a tela
    "Verificando sua sessão…" visível além do necessário. A segurança
    não muda: a escrita continua bloqueada até a ligação dos dados, e
    qualquer mudança de sessão durante a recuperação reinicia o fluxo.
  */
  async function continueBoot(actualUser) {
    if (diag) diag.record("app:continueBoot", { hasUid: Boolean(actualUser && actualUser.id) });
    try {
      await F.authData.bind(actualUser);
    } catch (error) {
      if (error.sessionChanged) { await retryChangedSession(); return; }
      F.auth.gate(error.message || "Não foi possível preparar os dados. Os originais estão preservados.", true);
      return;
    }
    if (!F.auth.isVerified(actualUser.id)) { await retryChangedSession(); return; }
    // O vínculo do legado pode ter exibido o painel de consentimento através
    // do gate (bloqueio temporário). O bootData roda antes do unlock final,
    // de modo que, quando a interface é liberada, o estado já está completo
    // (e o "ready" não aparece antes da hidratação dos dados).
    prepareSkipTarget();
    F.bootData();
    if (typeof F.applyAppearance === "function") F.applyAppearance();
    // Liberação definitiva: a interface autenticada fica pronta somente
    // depois da hidratação dos dados.
    if (!F.auth.unlock(actualUser.id, true)) return;

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
      if (diag) {
        diag.noteListener("app:visibilitychange");
        diag.record("app:visibilitychange", { hidden: doc.hidden, canWrite: F.auth.canWrite() });
      }
      if (!doc.hidden && F.auth.canWrite()) refreshAfterVisibility();
    });

    global.addEventListener("pageshow", event => {
      if (diag) {
        diag.noteListener("app:pageshow");
        diag.record("app:pageshow", { persisted: event.persisted, canWrite: F.auth.canWrite() });
      }
      if (event.persisted && F.auth.canWrite()) refreshAfterVisibility();
    });
  }

  async function bootPage(retry) {
    if (booted) return F.auth.revalidate();
    const actualUser = await (retry ? F.auth.revalidate() : F.auth.init());
    if (!actualUser) return;
    if (!F.auth.isVerified(actualUser.id)) { await retryChangedSession(); return; }
    await continueBoot(actualUser);
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
