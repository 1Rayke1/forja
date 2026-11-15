(function (global) {
  "use strict";
  const F = global.Forja;
  const button = global.document.getElementById("google-login");
  const status = global.document.getElementById("login-status");
  let continuing = false;
  function continueToApp() {
    if (!F.auth.isVerified() || continuing) return;
    continuing = true;
    status.textContent = "Conta verificada. Abrindo o FORJA…";
    button.disabled = true;
    F.navigate(F.auth.resumeUrl(false));
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Abrindo o Google na mesma aba…";
    try { await F.auth.startGoogle(); }
    catch (error) { status.textContent = error.message; button.disabled = false; }
  });
  global.addEventListener("forja:auth", event => {
    if (event.detail.state === "error") status.textContent = "Não foi possível validar a sessão. Verifique a conexão e tente entrar novamente.";
  });
  void F.auth.init().then(() => {
    if (F.auth.isVerified()) continueToApp();
    else {
      button.disabled = false;
      if (status.textContent === "Verificando se você já está conectado…") status.textContent = "Entre com sua conta Google para continuar.";
    }
  });
})(window);
