/* Executado no head. HTML/CSS já começam fechados, mesmo sem JavaScript. */
(function () {
  "use strict";
  const root = document.documentElement;
  const diag = window.ForjaDiagnostics; // instrumentação diagnóstica temporária (leitura)
  const lock = () => { root.dataset.forjaAuth = "locked"; };
  // pagehide: a página pode entrar no BFCache (persisted=true) e ser
  // restaurada depois. Quando a sessão já está verificada em memória, a
  // interface autenticada já exibida permanece liberada — a revalidação
  // ocorre silenciosamente no pageshow. Só trava (fail closed) quando não
  // há sessão verificada. Não usamos flags locais como prova de sessão:
  // a decisão é do estado real de autenticação (isVerified()). O
  // event.persisted indica se haverá restauração (tratada pelo pageshow),
  // não se travamos agora.
  addEventListener("pagehide", event => {
    const verified = Boolean(window.Forja && Forja.auth && Forja.auth.isVerified());
    if (diag) {
      diag.noteListener("guard:pagehide");
      diag.record("guard:pagehide", {
        persisted: event.persisted,
        verified: verified,
        willLock: !verified,
        lockReason: !verified ? "pagehide-unverified" : null
      });
    }
    if (!verified) lock();
    if (diag) diag.record("guard:pagehide:after", {});
  });
  addEventListener("pageshow", event => {
    if (event.persisted && !event.forjaVerified) {
      // Sessão ainda verificada em memória: a revalidação é silenciosa e a
      // interface autenticada já exibida permanece. Só bloqueia o retorno
      // do BFCache quando não há sessão verificada (fail closed).
      const verified = Boolean(window.Forja && Forja.auth && Forja.auth.isVerified());
      if (diag) {
        diag.noteListener("guard:pageshow");
        diag.record("guard:pageshow", {
          persisted: event.persisted,
          verified: verified,
          willLock: !verified,
          lockReason: !verified ? "pageshow-persisted-unverified" : null
        });
      }
      if (!verified) lock();
      // As telas só recebem o retorno BFCache depois da revalidação. Não
      // deixamos um snapshot antigo redesenhar/ler dados da conta anterior.
      event.stopImmediatePropagation();
      if (window.Forja && Forja.auth) {
        if (diag) diag.record("guard:pageshow:revalidate-start", {});
        void Forja.auth.revalidate().then(() => {
          if (diag) diag.record("guard:pageshow:revalidate-end", {});
          if (!Forja.auth.canWrite()) return;
          const restored = new PageTransitionEvent("pageshow", { persisted: true });
          Object.defineProperty(restored, "forjaVerified", { value: true });
          dispatchEvent(restored);
        });
      }
      if (diag) diag.record("guard:pageshow:after", {});
    } else if (diag) {
      diag.record("guard:pageshow:nonpersisted", { persisted: event.persisted });
    }
  });
  // Guardas de escrita checam também o token persistido, sem esperar este evento.
  addEventListener("storage", event => {
    if (diag) {
      diag.noteListener("guard:storage");
      diag.record("guard:storage", {
        key: event.key === null ? "(all)" : String(event.key),
        newValuePresent: event.newValue !== null
      });
    }
    const key = window.Forja && Forja.auth && Forja.auth.storageKey;
    if (event.key === "forja-auth-logout-v1" && event.newValue !== null && window.Forja?.auth && !Forja.auth.isLogoutCurrent(event)) {
      event.stopImmediatePropagation(); return;
    }
    if (event.key === null || (key && event.key === key) || (event.key === "forja-auth-logout-v1" && event.newValue !== null)) {
      if (diag) diag.record("guard:storage:lock", { reason: "storage-auth" });
      lock();
      // Eventos de autenticação não são eventos de dados de negócio. As
      // telas antigas não podem tentar reler o driver enquanto está fechado.
      event.stopImmediatePropagation();
      if (window.Forja && Forja.auth) Forja.auth.handleStorage(event);
    }
    if (diag) diag.record("guard:storage:after", {});
  });
  if (diag) diag.record("guard:loaded", {});
})();
