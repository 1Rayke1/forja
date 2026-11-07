/*
  FORJA — Tela do grupo muscular (treino/grupo.html).

  Esta é a segunda tela da Biblioteca: depois de escolher a modalidade e a
  região, o usuário chega aqui — uma tela por grupo, com apresentação
  anatômica, filtros de equipamento calculados do catálogo e os exercícios em
  cards horizontais.

  Regras que valem para toda a tela:

  - O catálogo é o central (`F.exerciseCatalog`): nenhum exercício, id ou
    classificação é criado aqui.
  - Os filtros saem dos equipamentos que realmente existem nos exercícios
    daquela modalidade e daquele grupo — nada de opção vazia.
  - A prancha anatômica é a do atlas (`F.figura`), recortada pela mesma função
    dos cards da Biblioteca (`F.biblioteca.figuraAnatomica`).
  - O detalhe é o único que existe no app (`F.catalog.showDetail`).
  - A tela não grava nada no armazenamento: só lê o catálogo e o histórico.

  Uso: treino/grupo.html?modalidade=academia&regiao=peitoral
       treino/grupo.html?modalidade=calistenia&regiao=bracos&grupo=biceps
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;
  if (!F || !doc || !F.exerciseCatalog || !F.biblioteca) return;

  const CATALOG = F.exerciseCatalog;
  const BIB = F.biblioteca;

  /* ------------------------------------------------------------------ */
  /* Textos da tela                                                      */
  /* ------------------------------------------------------------------ */

  const DESCRICOES = Object.freeze({
    peitoral: "Exercícios para o seu peitoral, com foco em força e definição.",
    costas: "Exercícios para as costas, com foco em dorsais, força de puxada e postura.",
    ombros: "Exercícios para os ombros, com foco em deltoides, força e amplitude.",
    trapezio: "Exercícios para o trapézio, com foco em estabilidade e postura.",
    biceps: "Exercícios para o bíceps, com foco em força e volume.",
    triceps: "Exercícios para o tríceps, com foco em força e definição.",
    antebracos: "Exercícios para os antebraços, com foco em pegada e resistência.",
    abdomen: "Exercícios para o abdômen, com foco em força de core.",
    obliquos: "Exercícios para os oblíquos, com foco em estabilidade lateral.",
    quadriceps: "Exercícios para o quadríceps, com foco em força e potência.",
    posteriores: "Exercícios para a parte posterior da coxa, com foco em força e controle.",
    gluteos: "Exercícios para os glúteos, com foco em força e estabilidade.",
    panturrilhas: "Exercícios para as panturrilhas, com foco em força e resistência."
  });

  /* Descrição das sete regiões (quando ainda não há grupo escolhido). */
  const DESCRICOES_REGIAO = Object.freeze({
    peitoral: "Exercícios para o seu peitoral, com foco em força e definição.",
    costas: "Exercícios para as costas, com foco em dorsais, força de puxada e postura.",
    ombros: "Exercícios para ombros e trapézio, com foco em força e estabilidade.",
    bracos: "Exercícios para os braços: bíceps, tríceps e antebraços.",
    abdomen: "Exercícios para o abdômen e os oblíquos, com foco em força de core.",
    pernas: "Exercícios para as pernas: quadríceps, posteriores de coxa e panturrilhas.",
    gluteos: "Exercícios para os glúteos, com foco em força e estabilidade."
  });

  /*
    Regiões do atlas usadas em cada grupo oficial. É só a legenda do desenho:
    a classificação do exercício continua sendo a do catálogo.
  */
  const ANATOMIA = Object.freeze({
    peitoral: { view: "front", regioes: ["peito"] },
    costas: { view: "back", regioes: ["dorsais", "costas", "lombar"] },
    ombros: { view: "front", regioes: ["ombros"] },
    trapezio: { view: "back", regioes: ["costas"] },
    /* Braços aparecem em pares afastados: o recorte mira um dos lados. */
    biceps: { view: "front", regioes: ["biceps"], focoLado: true },
    triceps: { view: "back", regioes: ["triceps"], focoLado: true },
    antebracos: { view: "front", regioes: ["antebracos"], focoLado: true },
    abdomen: { view: "front", regioes: ["abdomem"] },
    obliquos: { view: "front", regioes: ["obliquos"] },
    quadriceps: { view: "front", regioes: ["quadriceps"] },
    posteriores: { view: "back", regioes: ["posterior-coxa"] },
    gluteos: { view: "back", regioes: ["gluteos"] },
    panturrilhas: { view: "back", regioes: ["panturrilha"] }
  });

  /*
    Famílias de equipamento dos filtros. O catálogo guarda ids granulares
    (banco, rack, polia, peck-deck…); aqui eles são agrupados apenas na
    apresentação — `record.equipment` continua sendo a classificação oficial.
  */
  const FAMILIAS = Object.freeze([
    Object.freeze({ id: "barra", rotulo: "Com barra", ids: ["barra", "barra-t", "rack"] }),
    Object.freeze({ id: "halteres", rotulo: "Com halteres", ids: ["halteres", "anilhas"] }),
    Object.freeze({
      id: "maquinas",
      rotulo: "Em máquinas",
      ids: ["maquina", "peck-deck", "leg-press", "cadeira-extensora", "mesa-flexora", "plataforma"]
    }),
    Object.freeze({ id: "polia", rotulo: "Com polia", ids: ["polia", "corda"] }),
    Object.freeze({ id: "acessorios", rotulo: "Acessórios", ids: ["banco", "bola", "elastico", "toalha", "gripper"] }),
    Object.freeze({ id: "calistenia", rotulo: "Calistenia", ids: ["barra-fixa", "paralelas", "argolas", "estrutura"] })
  ]);

  const ICONES = Object.freeze({
    barra: "M6 6.5v11M18 6.5v11M3 9.5v5M21 9.5v5M6 12h12",
    halteres: "M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10",
    maquinas: "M4 20V8h5v12M4 12h5M20 20V4M20 8h-5v4h5M9 20h6",
    polia: "M12 4v6M6 10h12M12 10v10M8 20h8",
    acessorios: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M4 12h16",
    calistenia: "M4 6h16M6 6v14M18 6v14M6 12h12"
  });

  /* ------------------------------------------------------------------ */
  /* Estado e parâmetros                                                 */
  /* ------------------------------------------------------------------ */

  const state = {
    modalidade: null,
    regiao: null,
    grupo: null,
    equipamento: null
  };

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function icone(nome, extraClass) {
    if (F.ui.ICON_PATHS && F.ui.ICON_PATHS[nome]) return F.ui.icon(nome, extraClass);

    const span = el("span", "gr-icone" + (extraClass ? " " + extraClass : ""));
    span.setAttribute("aria-hidden", "true");
    span.setAttribute("focusable", "false");

    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");

    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICONES[nome] || ICONES.barra);
    svg.appendChild(path);
    span.appendChild(svg);
    return span;
  }

  function lerParams() {
    let params;
    try {
      params = new URLSearchParams(global.location.search);
    } catch (error) {
      params = new URLSearchParams("");
    }

    const modalidade = params.get("modalidade");
    state.modalidade = CATALOG.modalities.some(mode => mode.id === modalidade) ? modalidade : null;

    const regiao = BIB.categoriaPorId(params.get("regiao"));
    state.regiao = regiao ? regiao.id : null;

    const grupo = params.get("grupo");
    state.grupo = CATALOG.groupById(grupo) ? grupo : null;

    /*
      Região com um único grupo é o próprio grupo: Peitoral, Costas e Glúteos
      não mostram uma etapa a mais. Regiões com dois ou três grupos oferecem a
      escolha antes (chips), como pedido.
    */
    if (!state.grupo && state.regiao) {
      const categoria = BIB.categoriaPorId(state.regiao);
      if (categoria && categoria.grupos.length === 1) state.grupo = categoria.grupos[0];
    }

    const familia = params.get("equipamento");
    state.equipamento = FAMILIAS.some(item => item.id === familia) ? familia : null;

  }

  /* ------------------------------------------------------------------ */
  /* Recorte atual da tela                                               */
  /* ------------------------------------------------------------------ */

  function grupoDaRegiao() {
    return state.regiao ? BIB.categoriaPorId(state.regiao) : null;
  }

  /*
    Região da tela: a que veio na URL ou, quando o link traz só o grupo, a
    região que agrupa aquele grupo.
  */
  function regiaoAtual() {
    const direta = grupoDaRegiao();
    if (direta) return direta;
    if (!state.grupo) return null;
    return BIB.categorias.find(categoria => categoria.grupos.indexOf(state.grupo) !== -1) || null;
  }

  function gruposDaTela() {
    if (state.grupo) return [state.grupo];
    const regiao = regiaoAtual();
    return regiao ? Array.from(regiao.grupos) : [];
  }

  function modalidadeAtual() {
    return state.modalidade ? CATALOG.modalityById(state.modalidade) : null;
  }

  function equipamentosDoExercicio(entry) {
    const ids = entry.equipmentIds && entry.equipmentIds.length
      ? entry.equipmentIds
      : (entry.central && entry.central.equipment) || [];
    return Array.from(ids);
  }

  function familiaDoEquipamento(id) {
    return FAMILIAS.find(familia => familia.ids.indexOf(id) !== -1) || null;
  }

  /* Exercícios da seleção, antes do filtro de equipamento. */
  function base() {
    const grupos = gruposDaTela();
    return BIB.entries().filter(entry => {
      if (state.modalidade && entry.modalityId !== state.modalidade) return false;
      return grupos.indexOf(entry.muscleId) !== -1;
    });
  }

  function selecionados() {
    let lista = base();

    if (state.equipamento) {
      const familia = FAMILIAS.find(item => item.id === state.equipamento);
      lista = lista.filter(entry => {
        const ids = equipamentosDoExercicio(entry);
        return ids.some(id => familia.ids.indexOf(id) !== -1);
      });
    }

    return lista;
  }

  /* Famílias que existem de verdade nesta seleção, na ordem canônica. */
  function familiasDisponiveis() {
    const presentes = new Set();
    base().forEach(entry => {
      equipamentosDoExercicio(entry).forEach(id => {
        const familia = familiaDoEquipamento(id);
        if (familia) presentes.add(familia.id);
      });
    });
    return FAMILIAS.filter(familia => presentes.has(familia.id));
  }

  /* ------------------------------------------------------------------ */
  /* Cabeçalho                                                           */
  /* ------------------------------------------------------------------ */

  function textoDeTitulo() {
    if (state.grupo) return CATALOG.muscleName(state.grupo);
    const regiao = regiaoAtual();
    return regiao ? regiao.rotulo : "Exercícios";
  }

  function textoDeDescricao() {
    if (state.grupo && DESCRICOES[state.grupo]) return DESCRICOES[state.grupo];
    const regiao = regiaoAtual();
    if (regiao && DESCRICOES_REGIAO[regiao.id]) return DESCRICOES_REGIAO[regiao.id];
    if (regiao) return regiao.descricao + ".";
    return "Escolha um grupo muscular na Biblioteca para ver os exercícios.";
  }

  /*
    A prancha mostra o grupo escolhido. Sem grupo (região com vários), mostra
    a união das regiões daqueles grupos — os mesmos 13 do catálogo.
  */
  function anatomiaAtual() {
    if (state.grupo && ANATOMIA[state.grupo]) return ANATOMIA[state.grupo];

    const regiao = regiaoAtual();
    if (!regiao) return null;

    const partes = Array.from(regiao.grupos, grupo => ANATOMIA[grupo]).filter(Boolean);
    if (partes.length === 0) return { view: regiao.figura.view, regioes: Array.from(regiao.figura.regioes) };

    const view = partes[0].view;
    const regioes = [];
    partes.forEach(parte => {
      if (parte.view !== view) return;
      parte.regioes.forEach(id => {
        if (regioes.indexOf(id) === -1) regioes.push(id);
      });
    });

    /*
      Na região o enquadramento é o do conjunto: mirar um lado do corpo
      cortaria grupos diferentes (braço, antebraço) um do outro.
    */
    return { view, regioes };
  }

  function siglaDaModalidade() {
    const modalidade = modalidadeAtual();
    return modalidade ? modalidade.name : "Todas as modalidades";
  }

  const dom = {};

  function renderHero() {
    const modalidade = modalidadeAtual();

    dom.badge.textContent = siglaDaModalidade();
    dom.badge.setAttribute("data-modalidade", modalidade ? modalidade.id : "todas");
    dom.titulo.textContent = textoDeTitulo();
    dom.descricao.textContent = textoDeDescricao();

    while (dom.figura.firstChild) dom.figura.removeChild(dom.figura.firstChild);

    const anatomia = anatomiaAtual();
    const desenho = anatomia
      ? BIB.figuraAnatomica({
          view: anatomia.view,
          regioes: anatomia.regioes,
          proporcao: 0.92,
          focoLado: anatomia.focoLado,
          classe: "gr-prancha"
        })
      : null;

    if (desenho) {
      desenho.setAttribute("aria-hidden", "true");
      dom.figura.appendChild(desenho);
    } else {
      dom.figura.appendChild(icone("target", "gr-prancha-vazia"));
    }

    dom.hero.setAttribute("data-grupo", state.grupo || (state.regiao || ""));
  }

  /* ------------------------------------------------------------------ */
  /* Filtros                                                             */
  /* ------------------------------------------------------------------ */

  function linhaDeChips(rotulo, itens, aoEscolher, chaveDaLinha) {
    const wrap = el("div", "gr-filtro-linha");
    if (chaveDaLinha) wrap.setAttribute("data-linha", chaveDaLinha);

    const grupo = el("div", "ui-chips gr-chips");
    grupo.setAttribute("role", "group");
    grupo.setAttribute("aria-label", rotulo);

    itens.forEach(item => {
      const button = el("button", "ui-chip-toggle gr-pilula" + (item.active ? " is-active" : ""));
      button.type = "button";
      button.setAttribute("data-value", item.value === null ? "" : String(item.value));
      button.setAttribute("aria-pressed", String(Boolean(item.active)));
      if (item.icone) button.appendChild(icone(item.icone, "gr-pilula-icone"));
      button.appendChild(el("span", "gr-pilula-texto", item.label));
      if (item.count !== undefined && item.count !== null) {
        button.appendChild(el("span", "gr-pilula-contagem", String(item.count)));
      }
      button.addEventListener("click", () => aoEscolher(item.value));
      grupo.appendChild(button);
    });

    wrap.appendChild(grupo);
    return wrap;
  }

  function renderFiltros() {
    while (dom.filtros.firstChild) dom.filtros.removeChild(dom.filtros.firstChild);

    /* Escolha do grupo quando a região agrupa mais de um. */
    const regiao = regiaoAtual();
    if (regiao && regiao.grupos.length > 1) {
      const itens = [{
        value: "",
        label: "Todos",
        active: !state.grupo
      }].concat(regiao.grupos.map(grupo => ({
        value: grupo,
        label: CATALOG.muscleName(grupo),
        active: state.grupo === grupo
      })));

      dom.filtros.appendChild(linhaDeChips("Grupo muscular", itens, value => {
        atualizar({ grupo: value || null, equipamento: null });
      }, "grupo"));
    }

    /* Filtros de equipamento: só o que existe nesta modalidade e grupo. */
    const familias = familiasDisponiveis();
    if (familias.length > 0) {
      const itens = [{ value: "", label: "Todos", active: !state.equipamento }]
        .concat(familias.map(familia => ({
          value: familia.id,
          label: familia.rotulo,
          active: state.equipamento === familia.id,
          icone: familia.id
        })));

      dom.filtros.appendChild(linhaDeChips("Equipamento", itens, value => {
        atualizar({ equipamento: value || null });
      }, "equipamento"));
    }

    dom.filtros.hidden = dom.filtros.childNodes.length === 0;
  }

  /* ------------------------------------------------------------------ */
  /* Cards dos exercícios                                                */
  /* ------------------------------------------------------------------ */

  function imagemDoCard(entry) {
    if (entry.image && entry.image.url) {
      const img = doc.createElement("img");
      img.className = "gr-card-img";
      img.src = entry.image.url;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      return img;
    }

    /*
      Sem imagem aprovada o card não reaproveita a foto de outro exercício nem
      repete a prancha em todos: fica um estado neutro com o aviso, para o
      espaço vazio ser intencional em vez de parecer erro.
    */
    const vazio = el("span", "gr-card-vazio");
    vazio.appendChild(icone("dumbbell", "gr-card-vazio-icone"));
    vazio.appendChild(el("span", "gr-card-vazio-texto", "imagem em revisão"));
    return vazio;
  }

  function cardDoExercicio(entry) {
    const card = el("button", "gr-card");
    card.type = "button";
    card.setAttribute("data-exercise-id", entry.id);
    card.setAttribute("data-muscle", entry.muscleId);
    card.setAttribute("data-modality", entry.modalityId || "");
    card.setAttribute("aria-label", "Ver detalhes de " + entry.name);

    const faixa = el("span", "gr-card-faixa");
    faixa.setAttribute("aria-hidden", "true");

    const figura = el("span", "gr-card-figura");
    figura.setAttribute("aria-hidden", "true");
    figura.appendChild(imagemDoCard(entry));

    const texto = el("span", "gr-card-texto");
    texto.appendChild(el("span", "gr-card-nome", entry.name));
    texto.appendChild(el("span", "gr-card-grupo", entry.muscleName || CATALOG.muscleName(entry.muscleId)));

    const seta = el("span", "gr-card-seta");
    seta.appendChild(F.ui.icon("chevron-right"));

    card.append(faixa, figura, texto, seta);
    card.addEventListener("click", () => abrirDetalhe(entry));
    return card;
  }

  function abrirDetalhe(entry) {
    if (!entry.legacy) {
      if (typeof F.showToast === "function") {
        F.showToast("Este exercício não pôde ser lido do catálogo. Recarregue a página e tente de novo.", "error", 6000);
      }
      return;
    }
    return F.catalog.showDetail(entry.legacy);
  }

  function renderLista() {
    const lista = selecionados();

    while (dom.lista.firstChild) dom.lista.removeChild(dom.lista.firstChild);

    if (lista.length === 0) {
      const vazio = el("div", "gr-vazio");
      vazio.appendChild(el("p", "gr-vazio-titulo", "Nenhum exercício com esses filtros"));
      vazio.appendChild(el("p", "gr-vazio-texto",
        "O catálogo não tem exercício desta combinação. Troque o filtro ou volte para a Biblioteca."));
      dom.lista.appendChild(vazio);
      return;
    }

    const fragmento = doc.createDocumentFragment();
    lista.forEach(entry => fragmento.appendChild(cardDoExercicio(entry)));
    dom.lista.appendChild(fragmento);
  }

  function renderContador() {
    const total = selecionados().length;
    while (dom.contador.firstChild) dom.contador.removeChild(dom.contador.firstChild);

    dom.contador.appendChild(F.ui.icon("info"));
    dom.contador.appendChild(el("span", null,
      total + (total === 1 ? " exercício encontrado" : " exercícios encontrados")));

    dom.contador.setAttribute("data-total", String(total));
  }

  /* ------------------------------------------------------------------ */
  /* Endereço e botão voltar                                             */
  /* ------------------------------------------------------------------ */

  function enderecoDaBiblioteca() {
    const params = new URLSearchParams();
    if (state.modalidade) params.set("modalidade", state.modalidade);
    if (state.regiao) params.set("regiao", state.regiao);
    const query = params.toString();
    return "biblioteca.html" + (query ? "?" + query : "");
  }

  function sincronizarEndereco() {
    if (!global.history || typeof global.history.replaceState !== "function") return;

    const params = new URLSearchParams();
    if (state.modalidade) params.set("modalidade", state.modalidade);
    if (state.regiao) params.set("regiao", state.regiao);
    if (state.grupo) params.set("grupo", state.grupo);
    if (state.equipamento) params.set("equipamento", state.equipamento);

    const query = params.toString();
    try {
      global.history.replaceState(null, "", "grupo.html" + (query ? "?" + query : ""));
    } catch (error) {
      /* Endereço é conveniência: a tela funciona mesmo sem atualizar a URL. */
    }
  }

  function renderVoltar() {
    if (!dom.voltar) return;
    dom.voltar.href = enderecoDaBiblioteca();
    dom.voltar.setAttribute("aria-label", "Voltar para a Biblioteca" +
      (state.modalidade ? " em " + CATALOG.modalityName(state.modalidade) : ""));
  }

  /* ------------------------------------------------------------------ */

  function atualizar(patch) {
    Object.assign(state, patch);

    /* Filtro de equipamento que deixou de existir volta para "Todos". */
    if (state.equipamento && !familiasDisponiveis().some(familia => familia.id === state.equipamento)) {
      state.equipamento = null;
    }

    render();
  }

  function render() {
    renderHero();
    renderFiltros();
    renderLista();
    renderContador();
    renderVoltar();
    sincronizarEndereco();
  }

  function iniciar() {
    dom.hero = doc.getElementById("grupo-hero");
    dom.badge = doc.getElementById("grupo-modalidade");
    dom.titulo = doc.getElementById("grupo-titulo");
    dom.descricao = doc.getElementById("grupo-descricao");
    dom.figura = doc.getElementById("grupo-figura");
    dom.filtros = doc.getElementById("grupo-filtros");
    dom.lista = doc.getElementById("grupo-lista");
    dom.contador = doc.getElementById("grupo-contador");
    dom.voltar = doc.getElementById("grupo-voltar");

    if (!dom.hero || !dom.lista) return;

    lerParams();

    /* Sem seleção na URL, a tela explica o caminho em vez de inventar filtro. */
    if (!state.regiao && !state.grupo) {
      renderHero();
      renderFiltros();
      dom.lista.replaceChildren();
      const vazio = el("div", "gr-vazio");
      vazio.appendChild(el("p", "gr-vazio-titulo", "Escolha um grupo na Biblioteca"));
      const voltar = el("a", "gr-vazio-acao", "Abrir a Biblioteca");
      /* F.url resolve o caminho a partir de data-root, como nas outras telas. */
      voltar.href = F.url("biblioteca");
      vazio.appendChild(voltar);
      dom.lista.appendChild(vazio);
      dom.contador.replaceChildren();
      renderVoltar();
      return;
    }

    render();
  }

  /* API pública: usada pelos testes e por outras telas do app. */
  F.grupo = Object.freeze({
    familias: FAMILIAS,
    anatomia: ANATOMIA,
    descricoes: DESCRICOES,
    estado: () => Object.assign({}, state),
    atualizar,
    selecionados,
    familiasDisponiveis,
    enderecoDaBiblioteca
  });

  /* A página é iniciada por forja-app.js (F.pages), como as demais telas. */
  F.pages.grupo = iniciar;
})(typeof window !== "undefined" ? window : globalThis);
