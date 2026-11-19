(function (global) {
  "use strict";
  const F = global.Forja;
  const button = global.document.getElementById("google-login");
  const status = global.document.getElementById("login-status");
  const checking = "Verificando se você já está conectado…";
  let continuing = false, starting = false;
  function setError(isError) { status.classList.toggle("is-error", Boolean(isError)); }
  function continueToApp() {
    if (!F.auth.isVerified() || continuing || starting) return;
    continuing = true;
    setError(false);
    status.textContent = "Conta verificada. Abrindo o FORJA…";
    button.disabled = true;
    F.navigate(F.auth.resumeUrl(false));
  }
  function settle() {
    if (F.auth.isVerified()) continueToApp();
    else if (!continuing && !starting) {
      button.disabled = false;
      if (status.textContent === checking) {
        setError(false);
        status.textContent = "Entre com sua conta Google para continuar.";
      }
    }
  }
  button.addEventListener("click", async () => {
    if (continuing || starting) return;
    starting = true;
    button.disabled = true;
    setError(false);
    status.textContent = "Abrindo o Google na mesma aba…";
    try { await F.auth.startGoogle(); }
    catch (error) { starting = false; setError(true); status.textContent = error.message; button.disabled = false; }
  });
  global.addEventListener("forja:auth", event => {
    if (event.detail.state === "authenticated") continueToApp();
    else if (event.detail.state === "error") {
      setError(true);
      status.textContent = "Não foi possível validar a sessão. Verifique a conexão e tente entrar novamente.";
      settle();
    } else if (event.detail.state === "guest") {
      if (status.classList.contains("is-error")) status.textContent = checking;
      setError(false);
      settle();
    }
  });
  global.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    // Voltar do Google pode restaurar este documento com o botão ocupado,
    // sem callback e sem executar init de novo. Sempre revalidar antes de sair.
    continuing = false; starting = false;
    button.disabled = true; setError(false); status.textContent = checking;
    void F.auth.revalidate().then(settle);
  });
  void F.auth.init().then(settle);
})(window);
