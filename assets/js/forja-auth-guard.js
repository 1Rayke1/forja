/* Executado no head. HTML/CSS já começam fechados, mesmo sem JavaScript. */
(function () {
  "use strict";
  const root = document.documentElement;
  const lock = () => { root.dataset.forjaAuth = "locked"; };
  const READY = "forja-auth-ready-v1";
  const SIGNED_OUT = "forja-auth-signed-out-v1";
  const LOGOUT = "forja-auth-logout-v1";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /*
    Inicialização fluida em navegação entre páginas (multipágina, não SPA).
    Se este navegador já verificou uma sessão (marcador escrito pelo módulo
    auth após getUser) e não houve saída/troca, libera a página IMEDIATAMENTE,
    antes da primeira pintura: o conteúdo aparece sem reiniciar a tela
    "Verificando sua sessão…". O estado "warm" mostra a página, mas a
    autenticação real (getUser) e o bloqueio dos dados (driver auth-locked)
    continuam a cargo do módulo auth, que revalida em segundo plano e volta a
    travar a página (gate) se a sessão estiver expirada/inválida/alterada.
    O marcador NUNCA autoriza acesso: sem ele, a página continua "locked".
  */
  function warmStart() {
    try {
      const raw = localStorage.getItem(READY);
      if (!raw) return;
      const marker = JSON.parse(raw);
      if (!marker || !UUID.test(marker.uid) || !Number.isFinite(marker.at)) return;
      // Fail closed: qualquer sinal de saída/troca impede a liberação antecipada.
      if (sessionStorage.getItem(SIGNED_OUT) !== null) return;
      if (localStorage.getItem(LOGOUT) !== null) return;
      root.dataset.forjaAuth = "warm";
    } catch (_) {
      /* Marcador ilegível/ausente: a página verifica normalmente (locked). */
    }
  }
  warmStart();
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
    if (!verified) lock();
  });
  addEventListener("pageshow", event => {
    if (event.persisted && !event.forjaVerified) {
      // Sessão ainda verificada em memória: a revalidação é silenciosa e a
      // interface autenticada já exibida permanece. Só bloqueia o retorno
      // do BFCache quando não há sessão verificada (fail closed).
      const verified = Boolean(window.Forja && Forja.auth && Forja.auth.isVerified());
      if (!verified) lock();
      // As telas só recebem o retorno BFCache depois da revalidação. Não
      // deixamos um snapshot antigo redesenhar/ler dados da conta anterior.
      event.stopImmediatePropagation();
      if (window.Forja && Forja.auth) {
        void Forja.auth.revalidate().then(() => {
          if (!Forja.auth.canWrite()) return;
          const restored = new PageTransitionEvent("pageshow", { persisted: true });
          Object.defineProperty(restored, "forjaVerified", { value: true });
          dispatchEvent(restored);
        });
      }
    }
  });
  // Decodifica apenas o "sub" (id de usuário) do JWT para decidir se uma
  // mudança na storageKey é uma rotação da MESMA conta. Não verifica
  // assinatura: a segurança real é o getUser do módulo auth. O guard só
  // decide se a interface deve piscar (lock) ou permanecer liberada.
  function storedUserId(raw) {
    try {
      const session = JSON.parse(raw);
      const payload = session && session.access_token && session.access_token.split(".")[1];
      if (!payload) return null;
      return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).sub || null;
    } catch (_) { return null; }
  }
  // Guardas de escrita checam também o token persistido, sem esperar este evento.
  addEventListener("storage", event => {
    const key = window.Forja && Forja.auth && Forja.auth.storageKey;
    if (event.key === "forja-auth-logout-v1" && event.newValue !== null && window.Forja?.auth && !Forja.auth.isLogoutCurrent(event)) {
      event.stopImmediatePropagation(); return;
    }
    if (event.key === null || (key && event.key === key) || (event.key === "forja-auth-logout-v1" && event.newValue !== null)) {
      // Rotação do token da MESMA conta (mesmo usuário) é revalidação
      // silenciosa: a interface autenticada já exibida permanece enquanto o
      // módulo auth revalida. Só trava (fail closed) quando a conta/sessão
      // realmente mudar, for encerrada ou o armazenamento for limpo —
      // evitando o flash "Verificando sua sessão…" com sessão válida.
      // verifiedUserId permanece válido durante a rotação (antes da
      // revalidação concluir), diferente de isVerified(), que depende do
      // token persistido já atualizado.
      const sameAccount = Boolean(key && event.key === key && event.newValue !== null &&
        window.Forja?.auth?.verifiedUserId &&
        storedUserId(event.newValue) === window.Forja.auth.verifiedUserId);
      if (!sameAccount) lock();
      // Eventos de autenticação não são eventos de dados de negócio. As
      // telas antigas não podem tentar reler o driver enquanto está fechado.
      event.stopImmediatePropagation();
      if (window.Forja && Forja.auth) Forja.auth.handleStorage(event);
    }
  });
})();
