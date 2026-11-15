/* Executado no head. HTML/CSS já começam fechados, mesmo sem JavaScript. */
(function () {
  "use strict";
  const root = document.documentElement;
  const lock = () => { root.dataset.forjaAuth = "locked"; };
  addEventListener("pagehide", lock);
  addEventListener("pageshow", event => {
    if (event.persisted && !event.forjaVerified) {
      lock();
      // As telas só recebem o retorno BFCache depois da revalidação. Não
      // deixamos um snapshot antigo redesenhar/ler dados da conta anterior.
      event.stopImmediatePropagation();
      if (window.Forja && Forja.auth) void Forja.auth.revalidate().then(() => {
        if (!Forja.auth.canWrite()) return;
        const restored = new PageTransitionEvent("pageshow", { persisted: true });
        Object.defineProperty(restored, "forjaVerified", { value: true });
        dispatchEvent(restored);
      });
    }
  });
  // Guardas de escrita checam também o token persistido, sem esperar este evento.
  addEventListener("storage", event => {
    const key = window.Forja && Forja.auth && Forja.auth.storageKey;
    if (event.key === null || (key && event.key === key) || (event.key === "forja-auth-logout-v1" && event.newValue !== null)) {
      lock();
      // Eventos de autenticação não são eventos de dados de negócio. As
      // telas antigas não podem tentar reler o driver enquanto está fechado.
      event.stopImmediatePropagation();
      if (window.Forja && Forja.auth) Forja.auth.handleStorage(event);
    }
  });
})();
