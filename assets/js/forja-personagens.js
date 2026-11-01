/*
  FORJA — personagens 3D das demonstrações (masculino e feminino).

  Camada de produto, em script clássico como o resto do app. Responsabilidades:

  1. Ler `assets/3d/catalogo.json` (gerado por tools/gerar-catalogo-3d.mjs).
  2. Exigir a escolha do personagem antes de qualquer demonstração 3D — sem
     opção pré-selecionada — e gravar a escolha no perfil que JÁ existe
     (`sexo`, via F.saveProfile). Não cria chave nova nem segunda fonte de
     verdade do perfil.
  3. Descobrir qual animação corresponde ao exercício atual.
  4. Montar o painel 3D (canvas, controles, créditos) carregando sob demanda o
     modelo do personagem escolhido e o clipe do exercício.
  5. Cair para um estado explícito (com a ilustração 2D intacta) quando faltar
     arquivo, WebGL ou animação — nunca tela em branco.

  A reprodução em si mora em `forja-3d-cena.js` (módulo ES com three.js),
  carregado só quando existe um painel visível. Um controlador, dois personagens.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const CATALOGO = "assets/3d/catalogo.json";
  const MODULO_CENA = "assets/js/forja-3d-cena.js";
  /* Rótulos vêm do contrato já existente em forja-dados.js (F.PERSONAGENS). */
  function rotuloPersonagem(id) {
    const definido = (F && F.PERSONAGENS && F.PERSONAGENS[id]) || null;
    return definido ? definido.label : "Personagem " + id;
  }
  const PERSONAGENS = Object.freeze({
    masculino: { id: "masculino", rotulo: "Masculino", titulo: rotuloPersonagem("masculino") },
    feminino: { id: "feminino", rotulo: "Feminino", titulo: rotuloPersonagem("feminino") }
  });
  const PERGUNTA = "Qual personagem você deseja utilizar nas demonstrações dos exercícios?";

  /* Grupos musculares do catálogo → grupo do mapa de animações. */
  const ALIAS_GRUPO = Object.freeze({
    "posterior de coxa": "posterior",
    "posterior": "posterior",
    "quadríceps": "quadríceps",
    "quadriceps": "quadríceps",
    "panturrilha": "panturrilha",
    "glúteos": "glúteos",
    "gluteos": "glúteos",
    "oblíquos": "abdômen",
    "obliquos": "abdômen",
    "abdômen": "abdômen",
    "abdomen": "abdômen",
    "lombar": "core",
    "core": "core",
    "peito": "peito",
    "peitoral": "peito",
    "costas": "costas",
    "dorsais": "costas",
    "bíceps": "bíceps",
    "biceps": "bíceps",
    "tríceps": "tríceps",
    "triceps": "tríceps",
    "ombros": "ombros",
    "pernas": "pernas",
    "quadril": "pernas",
    "cardio": "cardio",
    "mobilidade": "mobilidade",
    "corpo inteiro": "corpo inteiro"
  });

  let catalogoPromessa = null;
  let cenaModulo = null;
  const paineis = [];

  /* ------------------------------------------------------------------ */
  /* Catálogo                                                            */
  /* ------------------------------------------------------------------ */

  function url(relativo) {
    return F.url(relativo);
  }

  function buscarCatalogo() {
    if (typeof global.fetch !== "function") {
      return Promise.reject(new Error("busca de arquivos indisponível neste navegador"));
    }
    return global.fetch(url(CATALOGO), { credentials: "same-origin" })
      .then(resposta => {
        if (!resposta.ok) throw new Error("catálogo 3D indisponível (" + resposta.status + ")");
        return resposta.json();
      })
      .then(dados => {
        if (!dados || dados.formato !== "forja-catalogo-3d") {
          throw new Error("catálogo 3D em formato inesperado");
        }
        return dados;
      });
  }

  let porId = new Map();

  /*
    Carrega o catálogo uma única vez por página. O resultado fica guardado na
    promessa, o que permite consultar o catálogo de forma síncrona depois do
    primeiro carregamento (os painéis montam sem esperar de novo).
  */
  function prepararCatalogo() {
    if (catalogoPromessa) return catalogoPromessa;
    let inicio;
    try {
      inicio = buscarCatalogo();
    } catch (erro) {
      inicio = Promise.reject(erro);
    }
    const promessa = inicio.then(dados => {
      porId = new Map(dados.clipes.map(clipe => [clipe.id, clipe]));
      promessa.catalogo = dados;
      return dados;
    }).catch(erro => {
      catalogoPromessa = null;
      throw erro;
    });
    catalogoPromessa = promessa;
    return promessa;
  }

  function catalogoSincrono() {
    return catalogoPromessa ? catalogoPromessa.catalogo || null : null;
  }

  function clipePorId(id) {
    return porId.get(id) || null;
  }

  function personagemDoPerfil() {
    const personagem = typeof F.resolvePersonagem === "function"
      ? F.resolvePersonagem(F.state && F.state.profile)
      : null;
    return personagem ? personagem.id : null;
  }

  function dadosDoPersonagem(id) {
    const catalogo = catalogoSincrono();
    if (!catalogo || !id || !catalogo.personagens[id]) return null;
    return catalogo.personagens[id];
  }

  /* ------------------------------------------------------------------ */
  /* Exercício → clipe                                                   */
  /* ------------------------------------------------------------------ */

  /*
    Registro do catálogo correspondente ao exercício da tela. O item de sessão
    costuma trazer só `id`/`nome`; o atlas resolve por `libraryId` e, na falta
    dele, pelo nome normalizado. Sem esse elo, um exercício da rotina cairia
    sempre no fallback por grupo — movendo o boneco de forma aproximada quando o
    clipe exato existia.
  */
  function registroDoExercicio(exercicio) {
    try {
      if (F.atlas && typeof F.atlas.findRecordFor === "function") {
        return F.atlas.findRecordFor(exercicio);
      }
    } catch (erro) {
      return null;
    }
    return null;
  }

  function gruposDoRegistro(record) {
    const lista = [];
    if (record && record.roles) {
      ["primary", "secondary", "stabilizers"].forEach(nivel => {
        (record.roles[nivel] || []).forEach(grupo => lista.push(grupo));
      });
    }
    return lista;
  }

  /*
    Resolve a animação do exercício em três degraus, do mais específico ao mais
    genérico. `aproximado` marca o que veio do fallback — a interface avisa.
  */
  function resolverClipe(exercicio) {
    const catalogo = catalogoSincrono();
    if (!catalogo || !exercicio) return null;

    const record = registroDoExercicio(exercicio);
    const chaves = [
      exercicio.libraryId,
      exercicio.id,
      record && record.libraryId,
      record && record.id
    ].filter(Boolean);

    for (const chave of chaves) {
      const id = catalogo.exercicios[chave];
      const clipe = id ? clipePorId(id) : null;
      if (clipe) return { clipe, aproximado: false, motivo: null };
    }

    for (const grupo of gruposDoRegistro(record)) {
      const chave = ALIAS_GRUPO[String(grupo).toLowerCase()] || grupo;
      const id = catalogo.fallbackPorGrupo[chave];
      const clipe = id ? clipePorId(id) : null;
      if (clipe) {
        /*
          Um clipe do mesmo grupo muscular não é o movimento exato deste
          exercício: sempre entra como aproximado, com o motivo exposto.
        */
        return { clipe, aproximado: true, motivo: "grupo muscular: " + grupo };
      }
    }

    const idPadrao = catalogo.fallbackPorGrupo["corpo inteiro"];
    const padrao = idPadrao ? clipePorId(idPadrao) : null;
    if (padrao) {
      return { clipe: padrao, aproximado: true, motivo: "movimento base" };
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Escolha do personagem                                              */
  /* ------------------------------------------------------------------ */

  function escolherPersonagem(id, opcoes) {
    if (!PERSONAGENS[id]) return false;
    const gravou = F.saveProfile({ sexo: id });
    if (!gravou) {
      if (F.showToast) {
        F.showToast("Não foi possível salvar a escolha do personagem. Tente de novo.", "error", 6000);
      }
      return false;
    }
    if (!opcoes || opcoes.avisar !== false) {
      if (F.showToast) F.showToast("Personagem " + PERSONAGENS[id].rotulo + " salvo no seu perfil.", "success", 4000);
    }
    atualizarPaineis();
    atualizarSeletoresLocais();
    return true;
  }

  function atualizarSeletoresLocais() {
    const atual = personagemDoPerfil();
    doc.querySelectorAll("[data-personagem-opcao]").forEach(botao => {
      const alvo = botao.getAttribute("data-personagem-opcao");
      const ativo = atual === alvo;
      botao.classList.toggle("is-active", ativo);
      botao.setAttribute("aria-pressed", ativo ? "true" : "false");
    });
    const rotulo = doc.querySelectorAll("[data-personagem-atual]");
    rotulo.forEach(node => {
      node.textContent = atual ? PERSONAGENS[atual].titulo : "Nenhum personagem escolhido";
    });
  }

  /* ------------------------------------------------------------------ */
  /* Painel 3D                                                          */
  /* ------------------------------------------------------------------ */

  function elemento(tag, classe, texto) {
    const node = doc.createElement(tag);
    if (classe) node.className = classe;
    if (texto !== undefined && texto !== null) node.textContent = String(texto);
    return node;
  }

  function linkCredito() {
    const link = elemento("a", "c3-credito-link", "Créditos e licenças dos modelos 3D");
    link.href = F.url("configuracoes") + "#creditos-3d";
    return link;
  }

  function carregarModuloCena() {
    if (!cenaModulo) {
      cenaModulo = import(url(MODULO_CENA)).catch(erro => {
        cenaModulo = null;
        throw erro;
      });
    }
    return cenaModulo;
  }

  function idDoExercicio(exercicio) {
    return (exercicio && (exercicio.id || exercicio.libraryId)) || "";
  }

  /*
    Monta o painel dentro do container. É idempotente:
    - mesmo exercício e mesmo personagem → não mexe em nada;
    - mesmo personagem, exercício novo → reaproveita a cena já criada (o GLB do
      personagem continua o mesmo) e só troca o clipe, com crossfade;
    - personagem novo → descarta a cena e monta de novo.
    Evitar recriar o WebGLRenderer a cada exercício é o que mantém a troca de
    exercício instantânea no celular.
  */
  async function montar(container, exercicio) {
    if (!container || !exercicio) return null;

    const personagem = personagemDoPerfil();
    const chave = idDoExercicio(exercicio);
    const existente = paineis.find(painel => painel.container === container);

    if (existente && existente.personagem === personagem && container.isConnected) {
      if (existente.exercicioId === chave) return existente;
      if (await trocarExercicio(existente, exercicio)) return existente;
    }
    if (existente) destruirPainel(existente);

    return criarPainel(container, exercicio, personagem);
  }

  /* Reaproveita a cena viva e troca só o clipe. `false` manda remontar tudo. */
  async function trocarExercicio(painel, exercicio) {
    if (!painel.api || !painel.controles) return false;
    try {
      await prepararCatalogo();
    } catch (erro) {
      return false;
    }

    painel.exercicio = exercicio;
    painel.exercicioId = idDoExercicio(exercicio);

    const resolvido = resolverClipe(exercicio);
    if (!resolvido || !resolvido.clipe) {
      mostrarSemClipe(painel);
      return true;
    }

    aplicarSelo(painel, resolvido);
    painel.aviso.hidden = true;
    painel.controles.hidden = false;
    await painel.api.trocarClipe(url(resolvido.clipe.arquivo), resolvido.clipe.id);
    montarControles(painel.controles, painel.api, resolvido.clipe);
    return true;
  }

  function aplicarSelo(painel, resolvido) {
    const aproximado = resolvido.clipe.status === "review" || resolvido.aproximado;
    if (painel.selo) {
      if (aproximado) {
        painel.selo.textContent = "Movimento aproximado";
        painel.selo.hidden = false;
      } else {
        painel.selo.hidden = true;
      }
      return;
    }
    if (aproximado) {
      painel.selo = elemento("span", "c3-selo", "Movimento aproximado");
      painel.cabecalho.appendChild(painel.selo);
    }
  }

  function mostrarSemClipe(painel) {
    const palco = painel.palco;
    palco.setAttribute("data-estado", "sem-clipe");
    while (palco.firstChild) palco.removeChild(palco.firstChild);
    palco.appendChild(elemento("p", "c3-sem-clipe",
      "Ainda não existe animação 3D validada para este exercício. A demonstração ilustrada acima continua valendo."));
    painel.controles.hidden = true;
  }

  async function criarPainel(container, exercicio, personagem) {
    container.hidden = false;
    while (container.firstChild) container.removeChild(container.firstChild);

    const painel = {
      container,
      exercicio,
      exercicioId: idDoExercicio(exercicio),
      personagem,
      api: null,
      destruir: () => {}
    };
    paineis.push(painel);

    const cartao = elemento("section", "c3-card");
    cartao.setAttribute("aria-label", "Demonstração 3D do exercício");
    container.appendChild(cartao);
    painel.cartao = cartao;

    const cabecalho = elemento("header", "c3-head");
    cabecalho.appendChild(elemento("span", "c3-kicker", "Demonstração 3D"));
    const quem = elemento("button", "c3-quem", personagem
      ? PERSONAGENS[personagem].titulo
      : "Escolher personagem");
    quem.type = "button";
    quem.addEventListener("click", () => abrirSeletor(container, exercicio));
    cabecalho.appendChild(quem);
    cartao.appendChild(cabecalho);
    painel.cabecalho = cabecalho;

    const corpo = elemento("div", "c3-body");
    cartao.appendChild(corpo);

    if (!personagem) {
      renderizarEscolha(corpo, container, exercicio);
      return painel;
    }

    const palco = elemento("div", "c3-palco");
    palco.setAttribute("data-estado", "carregando");
    corpo.appendChild(palco);
    painel.palco = palco;

    const carregando = elemento("div", "c3-carregando");
    carregando.appendChild(elemento("span", "c3-spinner", ""));
    const textoCarregando = elemento("p", "c3-carregando-texto", "Carregando o personagem…");
    carregando.appendChild(textoCarregando);
    palco.appendChild(carregando);

    const controles = elemento("div", "c3-controles");
    const aviso = elemento("p", "c3-aviso", "");
    aviso.hidden = true;
    corpo.appendChild(controles);
    corpo.appendChild(aviso);
    corpo.appendChild(linkCredito());
    painel.controles = controles;
    painel.aviso = aviso;

    let catalogo;
    try {
      catalogo = await prepararCatalogo();
    } catch (erro) {
      return falharPainel(painel,
        "Não foi possível carregar o catálogo 3D. A ilustração do exercício continua disponível.");
    }

    const dadosPersonagem = dadosDoPersonagem(personagem);
    if (!dadosPersonagem) {
      return falharPainel(painel, "O personagem escolhido não está disponível neste momento.");
    }

    const resolvido = resolverClipe(exercicio);
    if (!resolvido || !resolvido.clipe) {
      if (carregando.parentNode) carregando.parentNode.removeChild(carregando);
      mostrarSemClipe(painel);
      return painel;
    }

    const clipe = resolvido.clipe;
    aplicarSelo(painel, resolvido);

    let modulo;
    try {
      modulo = await carregarModuloCena();
    } catch (erro) {
      return falharPainel(painel,
        "O visualizador 3D não pôde ser carregado (rede ou navegador sem suporte).");
    }

    try {
      const api = await modulo.criarCena(palco, {
        personagemId: personagem,
        personagemUrl: url(dadosPersonagem.arquivo),
        clipeUrl: url(clipe.arquivo),
        clipeId: clipe.id,
        aoCarregar: info => {
          if (info.fase === "personagem" && info.progresso) {
            textoCarregando.textContent =
              "Carregando o personagem… " + Math.round(info.progresso * 100) + "%";
          }
        },
        aoErro: info => {
          falharPainel(painel, info.fase === "clipe"
            ? "A animação deste exercício não pôde ser baixada. A ilustração continua disponível."
            : "Não foi possível exibir o personagem em 3D.");
        }
      });

      palco.setAttribute("data-estado", "pronto");
      if (carregando.parentNode) carregando.parentNode.removeChild(carregando);
      painel.api = api;
      painel.destruir = () => api.destruir();
      montarControles(controles, api, clipe);
      return painel;
    } catch (erro) {
      return falharPainel(painel,
        "Não foi possível iniciar o 3D neste dispositivo. A demonstração ilustrada continua disponível.");
    }
  }

  function falharPainel(painel, mensagem) {
    if (painel.palco) {
      painel.palco.setAttribute("data-estado", "erro");
      const carregando = painel.palco.querySelector(".c3-carregando");
      if (carregando && carregando.parentNode) carregando.parentNode.removeChild(carregando);
    }
    if (painel.controles) painel.controles.hidden = true;
    if (painel.aviso) {
      painel.aviso.hidden = false;
      painel.aviso.textContent = mensagem;
    }
    return painel;
  }

  function montarControles(container, api, clipe, personagem) {
    while (container.firstChild) container.removeChild(container.firstChild);

    const grupo = elemento("div", "c3-botoes");
    grupo.setAttribute("role", "group");
    grupo.setAttribute("aria-label", "Controles da demonstração 3D");

    const pausar = elemento("button", "c3-botao", "Pausar");
    pausar.type = "button";
    pausar.setAttribute("aria-pressed", "false");
    pausar.addEventListener("click", () => {
      const tocando = api.alternar();
      pausar.textContent = tocando ? "Pausar" : "Continuar";
      pausar.setAttribute("aria-pressed", tocando ? "false" : "true");
    });

    const reiniciar = elemento("button", "c3-botao", "Reiniciar");
    reiniciar.type = "button";
    reiniciar.addEventListener("click", () => api.reiniciar());

    const velocidade = elemento("label", "c3-velocidade");
    velocidade.appendChild(elemento("span", "c3-velocidade-rotulo", "Velocidade"));
    const seletor = doc.createElement("select");
    seletor.className = "c3-select";
    [0.5, 1, 1.5].forEach(valor => {
      const opcao = doc.createElement("option");
      opcao.value = String(valor);
      opcao.textContent = valor === 1 ? "Normal" : valor + "×";
      if (valor === 1) opcao.selected = true;
      seletor.appendChild(opcao);
    });
    seletor.addEventListener("change", () => api.velocidade(seletor.value));
    velocidade.appendChild(seletor);

    const recentrar = elemento("button", "c3-botao c3-botao-sutil", "Recentralizar câmera");
    recentrar.type = "button";
    recentrar.addEventListener("click", () => api.enquadrar());

    grupo.appendChild(pausar);
    grupo.appendChild(reiniciar);
    grupo.appendChild(velocidade);
    grupo.appendChild(recentrar);
    container.appendChild(grupo);

    const legenda = elemento("p", "c3-legenda");
    const duracao = clipe.duracaoS > 0 ? " · " + clipe.duracaoS.toFixed(1) + " s" : "";
    legenda.textContent = clipe.nome + duracao + " · " +
      (clipe.retarget ? "animação retargetada para o rig do personagem" : "animação do próprio rig") +
      " · Arraste para girar, use a roda ou o gesto de pinça para aproximar.";
    container.appendChild(legenda);
  }

  /* ------------------------------------------------------------------ */
  /* Escolha obrigatória (sem item pré-selecionado)                      */
  /* ------------------------------------------------------------------ */

  function renderizarEscolha(corpo, container, exercicio) {
    const bloco = elemento("div", "c3-escolha");
    bloco.appendChild(elemento("h3", "c3-escolha-titulo", PERGUNTA));
    bloco.appendChild(elemento("p", "c3-escolha-texto",
      "A escolha define o personagem e o conjunto de animações das demonstrações 3D. " +
      "Ela fica salva no seu perfil e não altera treinos, cálculos, histórico nem progresso."));

    const opcoes = elemento("div", "c3-escolha-opcoes");
    Object.keys(PERSONAGENS).forEach(id => {
      const botao = elemento("button", "c3-opcao");
      botao.type = "button";
      botao.setAttribute("data-personagem-opcao", id);
      botao.setAttribute("aria-pressed", "false");
      botao.appendChild(elemento("span", "c3-opcao-icone", id === "masculino" ? "M" : "F"));
      botao.appendChild(elemento("span", "c3-opcao-rotulo", PERSONAGENS[id].rotulo));
      botao.addEventListener("click", () => {
        botao.disabled = true;
        const ok = escolherPersonagem(id);
        if (ok) {
          montar(container, exercicio);
        } else {
          botao.disabled = false;
        }
      });
      opcoes.appendChild(botao);
    });
    bloco.appendChild(opcoes);
    bloco.appendChild(elemento("p", "c3-escolha-nota",
      "Nenhuma opção vem marcada: escolher é obrigatório para abrir a demonstração 3D."));
    corpo.appendChild(bloco);
    corpo.appendChild(linkCredito());
  }

  function abrirSeletor(container, exercicio) {
    const personagem = personagemDoPerfil();
    const fundo = elemento("div", "c3-modal-fundo");
    const caixa = elemento("div", "c3-modal");
    caixa.setAttribute("role", "dialog");
    caixa.setAttribute("aria-modal", "true");
    caixa.setAttribute("aria-labelledby", "c3-modal-titulo");

    const titulo = elemento("h2", "c3-modal-titulo", PERGUNTA);
    titulo.id = "c3-modal-titulo";
    caixa.appendChild(titulo);
    caixa.appendChild(elemento("p", "c3-modal-texto",
      "Você pode trocar quando quiser no perfil ou aqui mesmo. O personagem vale só para as demonstrações 3D."));

    const opcoes = elemento("div", "c3-escolha-opcoes");
    Object.keys(PERSONAGENS).forEach(id => {
      const botao = elemento("button", "c3-opcao" + (personagem === id ? " is-active" : ""));
      botao.type = "button";
      botao.setAttribute("data-personagem-opcao", id);
      botao.setAttribute("aria-pressed", personagem === id ? "true" : "false");
      botao.appendChild(elemento("span", "c3-opcao-icone", id === "masculino" ? "M" : "F"));
      botao.appendChild(elemento("span", "c3-opcao-rotulo", PERSONAGENS[id].rotulo));
      botao.addEventListener("click", () => {
        if (escolherPersonagem(id)) {
          fechar();
          if (container && exercicio) montar(container, exercicio);
          else atualizarPaineis();
        }
      });
      opcoes.appendChild(botao);
    });
    caixa.appendChild(opcoes);

    const fecharBotao = elemento("button", "c3-botao c3-modal-fechar", "Fechar");
    fecharBotao.type = "button";
    fecharBotao.addEventListener("click", () => fechar());
    caixa.appendChild(fecharBotao);

    fundo.appendChild(caixa);
    doc.body.appendChild(fundo);

    function aoTecla(evento) {
      if (evento.key === "Escape") fechar();
    }
    function fechar() {
      doc.removeEventListener("keydown", aoTecla);
      if (fundo.parentNode) fundo.parentNode.removeChild(fundo);
    }
    doc.addEventListener("keydown", aoTecla);
    fundo.addEventListener("click", evento => {
      if (evento.target === fundo) fechar();
    });
    fecharBotao.focus();

    /* Botões fora do modal também acompanham a escolha. */
    atualizarPaineis();
  }

  function destruirPainel(painel) {
    if (painel.destruir) {
      try { painel.destruir(); } catch (erro) { /* painel já descartado */ }
    }
    const indice = paineis.indexOf(painel);
    if (indice !== -1) paineis.splice(indice, 1);
  }

  /*
    Injeta um catálogo já pronto. Existe para os testes determinísticos (jsdom
    não passa pelo build) e NÃO é usado pelas páginas.
  */
  function definirCatalogo(dados) {
    if (!dados) {
      catalogoPromessa = null;
      porId = new Map();
      return;
    }
    const promessa = Promise.resolve(dados);
    promessa.catalogo = dados;
    porId = new Map(dados.clipes.map(clipe => [clipe.id, clipe]));
    catalogoPromessa = promessa;
  }

  /* Fecha o painel de um container específico (usado ao fechar o modal). */
  function descartar(container) {
    const painel = paineis.find(item => item.container === container);
    if (painel) destruirPainel(painel);
  }

  function atualizarPaineis() {
    paineis.slice().forEach(painel => {
      if (!painel.container || !painel.container.isConnected) {
        destruirPainel(painel);
        return;
      }
      const exercicio = painel.exercicio;
      destruirPainel(painel);
      montar(painel.container, exercicio);
    });
    atualizarSeletoresLocais();
  }

  /* ------------------------------------------------------------------ */
  /* Pontos de integração com as páginas                                 */
  /* ------------------------------------------------------------------ */

  /*
    Painel da tela de execução. Durante o treino não se pergunta nada: sem
    personagem escolhido o painel simplesmente não aparece (a ilustração do
    exercício continua sendo a demonstração). A pergunta fica no detalhe da
    biblioteca e nas configurações, onde o usuário está escolhendo, não treinando.
  */
  function montarEmExecucao(exercicio) {
    const container = doc.getElementById("execution-3d");
    if (!container) return;
    if (!exercicio || !personagemDoPerfil()) {
      descartar(container);
      container.hidden = true;
      return;
    }
    montar(container, exercicio);
  }

  /* Seletor de personagem (perfil e configurações). */
  function montarSelecaoPersonagem() {
    const containers = doc.querySelectorAll("[data-seletor-personagem]");
    if (!containers.length) return;

    prepararCatalogo().catch(() => null).then(atualizarSeletoresLocais);

    containers.forEach(container => {
      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(elemento("h3", "c3-escolha-titulo", PERGUNTA));
      container.appendChild(elemento("p", "c3-escolha-texto",
        "Vale apenas para as demonstrações 3D. Trocar aqui não apaga histórico, treinos, sessões nem progresso."));

      const opcoes = elemento("div", "c3-escolha-opcoes");
      Object.keys(PERSONAGENS).forEach(id => {
        const botao = elemento("button", "c3-opcao");
        botao.type = "button";
        botao.setAttribute("data-personagem-opcao", id);
        botao.setAttribute("aria-pressed", "false");
        botao.appendChild(elemento("span", "c3-opcao-icone", id === "masculino" ? "M" : "F"));
        botao.appendChild(elemento("span", "c3-opcao-rotulo", PERSONAGENS[id].rotulo));
        botao.addEventListener("click", () => {
          if (escolherPersonagem(id)) {
            const select = doc.getElementById("prof-sexo");
            if (select) select.value = id;
          }
        });
        opcoes.appendChild(botao);
      });
      container.appendChild(opcoes);

      const atual = elemento("p", "c3-escolha-nota");
      atual.setAttribute("data-personagem-atual", "");
      atual.textContent = personagemDoPerfil()
        ? PERSONAGENS[personagemDoPerfil()].titulo
        : "Nenhum personagem escolhido";
      container.appendChild(atual);
    });

    atualizarSeletoresLocais();
  }

  /* ------------------------------------------------------------------ */
  /* API pública                                                         */
  /* ------------------------------------------------------------------ */

  F.personagens3d = {
    catalogo: prepararCatalogo,
    catalogoAtual: catalogoSincrono,
    definirCatalogo,
    personagemDoPerfil,
    escolherPersonagem,
    resolverClipe,
    montar,
    montarEmExecucao,
    montarSelecaoPersonagem,
    abrirSeletor,
    descartar,
    atualizarPaineis,
    PERGUNTA,
    PERSONAGENS
  };

  function iniciar() {
    montarSelecaoPersonagem();
    doc.querySelectorAll("[data-demonstracao-3d]").forEach(container => {
      const exercicio = {
        id: container.getAttribute("data-demonstracao-3d"),
        libraryId: container.getAttribute("data-demonstracao-3d")
      };
      montar(container, exercicio);
    });
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }

  /* Perfil editado em outra aba/página → personagem acompanha. */
  global.addEventListener("storage", evento => {
    if (evento && evento.key && evento.key.indexOf("forja-perfil") === -1) return;
    if (F.loadProfile) {
      const perfil = F.loadProfile();
      if (perfil) F.state.profile = perfil;
    }
    atualizarPaineis();
  });
})(window);
