/*
  Ponte entre a tela de exercício (script clássico) e a cena 3D (módulo ESM).

  A tela recebe do manifesto o modelo e o clipe EXATOS do exercício; esta ponte
  só os entrega ao `criarCena` em modo de apresentação. Não resolve clipe por
  grupo muscular e não tem fallback: sem caminho próprio, a tela mostra a
  pendência.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  if (!F) return;

  let moduloPromessa = null;

  function carregarModulo() {
    if (!moduloPromessa) {
      const url = new URL("../assets/js/forja-3d-cena.js", document.baseURI).href;
      moduloPromessa = import(url);
    }
    return moduloPromessa;
  }

  async function montar(container, dados) {
    if (!container || !dados || !dados.modelo || !dados.clipeArquivo) {
      const erro = new Error("Sem modelo ou clipe próprio para a apresentação.");
      erro.codigo = "sem-clipe";
      throw erro;
    }

    const modulo = await carregarModulo();
    return modulo.criarCena(container, {
      personagemId: dados.personagem,
      personagemUrl: dados.modelo,
      clipeUrl: dados.clipeArquivo,
      clipeId: dados.clipeId || null,
      modoApresentacao: true,
      aoCarregar: dados.aoCarregar,
      aoErro: dados.aoErro
    });
  }

  F.exercicio3d = { montar, carregarModulo };
})(window);
