/*
  FORJA — tela Descobrir (explorar/index.html).

  Reorganiza a entrada do app em seções visuais inspiradas na interface de
  referência, mas com dados, rotas e identidade próprias do FORJA:

  - Cabeçalho fixo: logotipo FORJA + indicador de sessão ativa (quando houver).
  - Planos em destaque: rotinas iniciáveis do usuário (dados reais).
  - Foco do treino: filtros funcionais sobre o catálogo real de exercícios.
  - Planos de 7 dias: exemplos ilustrativos, claramente identificados.
  - Descubra recursos: links para telas existentes (biblioteca, treinos,
    progresso, atlas). Sem cobrança, assinatura ou pagamento.
  - Treinos populares: rotinas iniciáveis do usuário.
  - Treinos rápidos: exercícios de duração do catálogo (duração real).
  - Treino direcionado: links por objetivo funcional.

  Nenhum dado é inventado: duração, quantidade de exercícios e dificuldade só
  aparecem quando vêm de um dado real do FORJA.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;
  const ui = F && F.ui;

  if (!F || !F.catalog || !ui) return;

  const MODALITIES = ["calisthenics", "weights"];

  /* ------------------------------------------------------------------ */
  /* Categorias de foco do treino. O filtro é aplicado sobre o catálogo    */
  /* real (forja-catalogo.js): nunca se inventa grupo muscular, duração    */
  /* ou dificuldade de exercício.                                        */
  /* ------------------------------------------------------------------ */

  const FOCO_CATEGORIAS = Object.freeze([
    { id: "corpo-todo", label: "Corpo inteiro" },
    { id: "abdomen-core", label: "Abdômen e core", muscles: ["abdômen", "oblíquos", "lombar"], category: "core" },
    { id: "braços", label: "Braços", muscles: ["bíceps", "tríceps", "antebraços"] },
    { id: "peito", label: "Peito", muscles: ["peito"] },
    { id: "costas", label: "Costas", muscles: ["dorsais", "costas"] },
    { id: "ombros", label: "Ombros", muscles: ["ombros"] },
    { id: "pernas", label: "Pernas", muscles: ["pernas", "quadríceps", "posterior de coxa", "glúteos", "quadril"] },
    { id: "mobilidade", label: "Mobilidade", category: "mobility" },
    { id: "condicionamento", label: "Condicionamento", category: "cardio" }
  ]);

  /* Exemplos de planos de 7 dias. Não existem planos desse tipo gravados no
     FORJA. Cada item é uma referência ilustrativa para montar sua própria
     rotina; não é um plano funcional nem um calendário semanal implementado. */
  const EXEMPLOS_SETE_DIAS = Object.freeze([
    {
      id: "ex-7d-corpo",
      label: "Referência: 7 dias · Corpo inteiro",
      resumo: "Referência ilustrativa para montar sua própria rotina de corpo inteiro ao longo de 7 dias. Não é um plano gravado no FORJA nem um calendário semanal implementado."
    },
    {
      id: "ex-7d-abdomen",
      label: "Referência: 7 dias · Abdômen e core",
      resumo: "Referência ilustrativa para montar sua própria rotina de abdômen e core ao longo de 7 dias. Não é um plano gravado no FORJA nem um calendário semanal implementado."
    },
    {
      id: "ex-7d-mobilidade",
      label: "Referência: 7 dias · Mobilidade",
      resumo: "Referência ilustrativa para montar sua própria rotina de mobilidade ao longo de 7 dias. Não é um plano gravado no FORJA nem um calendário semanal implementado."
    }
  ]);

  /* Recursos do app com destino em rotas existentes. */
  const RECURSOS = Object.freeze([
    { id: "biblioteca", label: "Biblioteca de exercícios", route: "biblioteca", icon: "book",
      desc: "Consulte os exercícios sugeridos e crie os seus próprios para usar nas rotinas." },
    { id: "rotinas", label: "Rotinas de treino", route: "treino", icon: "dumbbell",
      desc: "Organize aquecimento, treino principal, abdômen e finalizador em calistenia ou musculação." },
    { id: "progresso", label: "Histórico e progresso", route: "progresso", icon: "chart",
      desc: "Acompanhe os treinos registrados, séries concluídas e metas semanais." },
    { id: "atlas", label: "Atlas muscular", route: "atlas", icon: "target",
      desc: "Consulte grupos musculares e as regiões trabalhadas por cada exercício." }
  ]);

  /* Treinos por objetivo funcional, com destino em rotas existentes. */
  const DIRECIONADO = Object.freeze([
    { id: "geral", label: "Fortalecimento geral", icon: "dumbbell",
      desc: "Treinos que trabalham o corpo todo, sem focar em uma região só.", route: "treino" },
    { id: "mobilidade", label: "Mobilidade", icon: "target",
      desc: "Amplitude de movimento, articulações e postura.", query: "foco=mobilidade" },
    { id: "resistencia", label: "Resistência", icon: "flame",
      desc: "Condicionamento com o peso do próprio corpo.", route: "calistenia" },
    { id: "condicionamento", label: "Condicionamento físico", icon: "clock",
      desc: "Frequência cardíaca, fôlego e resistência aeróbica.", query: "foco=condicionamento" },
    { id: "estabilidade", label: "Estabilidade e equilíbrio", icon: "timer",
      desc: "Core, equilíbrio e controle corporal.", query: "foco=abdomen-core" }
  ]);

  /* Estado da tela. */
  let focoAtivo = "corpo-todo";

  /* ------------------------------------------------------------------ */
  /* Utilitários                                                        */
  /* ------------------------------------------------------------------ */

  function textoSemAcento(value) {
    return F.catalog.normalizeText(value || "");
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function recordVemDoFoco(record, cat) {
    if (!cat) return true;
    if (cat.category && record.category === cat.category) return true;
    if (cat.muscles) {
      return record.muscles.some(mus =>
        cat.muscles.some(alvo => textoSemAcento(mus) === textoSemAcento(alvo))
      );
    }
    /* Sem músculos nem categoria definidos: "Corpo inteiro", mostra tudo. */
    return true;
  }

  function categoriaPorId(id) {
    return FOCO_CATEGORIAS.find(cat => cat.id === id) || FOCO_CATEGORIAS[0];
  }

  function primeiroExercicioDaRotina(routine) {
    if (!routine || !routine.sections) return null;
    for (let i = 0; i < F.SECTION_ORDER.length; i += 1) {
      const list = routine.sections[F.SECTION_ORDER[i]];
      if (Array.isArray(list) && list.length > 0) return list[0];
    }
    return null;
  }

  /*
    Fotografias: a tela Explorar usa fotografias locais (assets/fotografias) em
    vez de ícones ou ilustrações como imagem de cartão. O resolvedor é somente
    leitura e nunca inventa correspondência: exercício só por `mode:libraryId`;
    quando não há foto do exercício, usa a foto de contexto da categoria, que
    não é anunciada como execução do movimento.
  */
  function fotosDisponiveis() {
    return Boolean(F.fotos && F.fotos.available());
  }

  function fotoDoExercicio(record, mode) {
    return fotosDisponiveis() ? F.fotos.forCard(record, mode) : null;
  }

  function fotoDaCategoria(categoriaId) {
    return fotosDisponiveis() ? F.fotos.forCategoria(categoriaId) : null;
  }

  /* Fundo fotográfico do cartão (posicionado em CSS, cortado em 16:10 na origem). */
  function anexarFundo(article, photo, className, alt) {
    if (!photo) {
      article.classList.add("sem-foto");
      return null;
    }
    const picture = F.fotos.buildPicture(photo, {
      className: "cartao-foto " + (className || ""),
      sizes: "(max-width: 520px) 92vw, 340px",
      alt: alt === undefined ? photo.alt : alt
    });
    if (!picture) return null;
    article.classList.add("com-foto");
    article.insertBefore(picture, article.firstChild);
    return photo;
  }

  /* Linha discreta de crédito: fonte e licença visíveis no próprio cartão. */
  function anexarCredito(container, photo) {
    if (!photo) return;
    const credito = doc.createElement("span");
    credito.className = "cartao-credito";
    credito.textContent = F.fotos.creditLine(photo);
    container.appendChild(credito);
  }

  function modoDoRecord(record) {
    return record.mode === "weights" ? "weights" : "calisthenics";
  }

  function descricaoRotina(routine) {
    const total = F.countRoutineExercises ? F.countRoutineExercises(routine) : 0;
    const series = F.getRoutineTotalSets ? F.getRoutineTotalSets(routine) : 0;
    const modo = F.MODE_NAMES[routine.modality] || routine.modality;
    return modo + " · " +
      (total === 0 ? "Sem exercícios" : F.pluralize(total, "exercício", "exercícios")) +
      " · " + F.pluralize(series, "série", "séries") + " planejadas";
  }

  /* ------------------------------------------------------------------ */
  /* Cabeçalho fixo (logo + indicador de atividade)                     */
  /* ------------------------------------------------------------------ */

  function montarCabecalho() {
    const host = doc.getElementById("header-actions");
    if (!host) return;

    function atualizar() {
      clear(host);
      const sessao = F.state && F.state.activeWorkout;
      if (sessao) {
        const modo = F.MODE_NAMES[sessao.modality] || sessao.modality;
        const chip = ui.linkButton({
          href: F.url("executar"),
          label: "Sessão ativa · " + sessao.routineName + " (" + modo + ")",
          icon: "timer",
          variant: "secondary-button",
          className: "sessao-chip",
          ariaLabel: "Retomar sessão ativa: " + sessao.routineName
        });
        host.appendChild(chip);
      }
    }

    atualizar();
    /* Reage a mudanças vindas de outras abas/janelas. */
    if (typeof F.onDataChanged === "function") {
      F.onDataChanged(() => atualizar());
    }
    global.addEventListener("storage", () => atualizar());
    global.addEventListener("pageshow", event => {
      if (event && event.persisted) atualizar();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Seção 1 — Planos em destaque (carrossel de rotinas do usuário)     */
  /* ------------------------------------------------------------------ */

  function cardPlano(routine) {
    const article = doc.createElement("article");
    article.className = "plano-card";
    article.setAttribute("aria-label", "Plano " + routine.name);

    const exercicio = primeiroExercicioDaRotina(routine);
    const photo = fotosDisponiveis()
      ? (F.fotos.forExercise(exercicio, routine.modality) || F.fotos.forModality(routine.modality))
      : null;
    anexarFundo(article, photo, "plano-fundo");

    const sobre = doc.createElement("div");
    sobre.className = "plano-sobre";

    const etiqueta = doc.createElement("span");
    etiqueta.className = "plano-etiqueta";
    etiqueta.textContent = routine.modality === "weights" ? "Musculação" : "Calistenia";
    sobre.appendChild(etiqueta);

    const nome = doc.createElement("h3");
    nome.className = "plano-nome";
    nome.textContent = routine.name;
    sobre.appendChild(nome);

    const descricao = doc.createElement("p");
    descricao.className = "plano-descricao";
    descricao.textContent = descricaoRotina(routine);
    sobre.appendChild(descricao);

    const botao = ui.button({
      label: "Começar",
      icon: "play",
      variant: "primary-button",
      className: "plano-botao",
      onClick: () => F.startRoutine(routine.modality, routine.id)
    });
    sobre.appendChild(botao);
    anexarCredito(sobre, photo);

    article.appendChild(sobre);
    return article;
  }

  function estadoVazioPlanos(host) {
    const card = doc.createElement("article");
    card.className = "plano-card plano-vazio";
    card.setAttribute("aria-label", "Sem planos para destacar");

    const sobre = doc.createElement("div");
    sobre.className = "plano-sobre";

    const etiqueta = doc.createElement("span");
    etiqueta.className = "plano-etiqueta";
    etiqueta.textContent = "Sem planos ainda";
    sobre.appendChild(etiqueta);

    const nome = doc.createElement("h3");
    nome.className = "plano-nome";
    nome.textContent = "Não há planos para destacar";
    sobre.appendChild(nome);

    const descricao = doc.createElement("p");
    descricao.className = "plano-descricao";
    descricao.textContent = "Crie rotinas em Treinos para elas aparecerem aqui como planos em destaque.";
    sobre.appendChild(descricao);

    const criar = ui.linkButton({
      href: F.url("rotina", { nova: "1" }),
      label: "Criar primeira rotina",
      icon: "plus",
      variant: "primary-button",
      className: "plano-botao"
    });
    sobre.appendChild(criar);

    const irTreinos = ui.linkButton({
      href: F.url("treino"),
      label: "Ir para Treinos",
      icon: "arrow-right",
      variant: "secondary-button",
      className: "plano-botao secundario"
    });
    sobre.appendChild(irTreinos);

    card.appendChild(sobre);
    host.appendChild(card);
  }

  function renderPlanosDestaque(host) {
    clear(host);
    const rotinas = typeof F.getStartableRoutines === "function"
      ? F.getStartableRoutines()
      : [];

    if (rotinas.length === 0) {
      estadoVazioPlanos(host);
      return;
    }

    rotinas.forEach(routine => host.appendChild(cardPlano(routine)));
  }

  /* ------------------------------------------------------------------ */
  /* Seção 2 — Foco do treino (filtro funcional sobre o catálogo real)   */
  /* ------------------------------------------------------------------ */

  function cardFoco(record) {
    const mode = modoDoRecord(record);
    const artigo = doc.createElement("article");
    artigo.className = "foco-card";
    artigo.setAttribute("aria-label", record.name);

    const photo = fotoDoExercicio(record, mode);
    const miniatura = doc.createElement("div");
    miniatura.className = "foco-miniatura-wrap";

    if (photo) {
      const picture = F.fotos.buildPicture(photo, {
        className: "foco-foto",
        imgClass: "foco-miniatura",
        sizes: "60px",
        alt: photo.alt
      });
      if (picture) miniatura.appendChild(picture);
    } else {
      /* Nenhuma foto disponível: marcador neutro de marca, nunca emoji. */
      miniatura.classList.add("sem-foto");
      miniatura.appendChild(ui.icon("dumbbell", "foco-icone"));
    }

    artigo.appendChild(miniatura);

    const corpo = doc.createElement("div");
    corpo.className = "foco-corpo";

    const nome = doc.createElement("h3");
    nome.className = "foco-nome";
    nome.textContent = record.name;
    corpo.appendChild(nome);

    const meta = doc.createElement("p");
    meta.className = "foco-meta";
    meta.textContent = F.catalog.summary(record);
    corpo.appendChild(meta);

    const tags = doc.createElement("div");
    tags.className = "foco-tags";

    (record.muscles || []).slice(0, 2).forEach(musculo => {
      tags.appendChild(ui.chip(musculo, "muted"));
    });
    (record.equipment || []).slice(0, 2).forEach(equipamento => {
      tags.appendChild(ui.chip(equipamento, "muted"));
    });
    corpo.appendChild(tags);

    artigo.appendChild(corpo);

    const abrir = () => F.catalog.showDetail(record);
    artigo.addEventListener("click", abrir);
    artigo.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        abrir();
      }
    });
    artigo.setAttribute("tabindex", "0");
    artigo.setAttribute("role", "button");

    return artigo;
  }

  function estadoVazioFoco(cat) {
    const card = ui.empty({
      icon: "search",
      title: cat.id === "corpo-todo" ? "Catálogo vazio" : "Nenhum exercício nesta categoria",
      text: cat.id === "corpo-todo"
        ? "O FORJA ainda não tem exercícios sugeridos cadastrados."
        : "Não há exercícios do catálogo que correspondam a \"" + cat.label + "\". Tente outro foco.",
      actions: [
        { label: cat.id === "corpo-todo" ? "Ver rotinas" : "Ver todos os exercícios",
          variant: "primary-button", icon: "arrow-right",
          onClick: () => { focoAtivo = "corpo-todo"; renderFocoTreino(doc.getElementById("foco-treino")); } }
      ]
    });
    return card;
  }

  function renderFocoTreino(host) {
    clear(host);

    const barra = doc.createElement("div");
    barra.className = "foco-barra";
    barra.setAttribute("role", "group");
    barra.setAttribute("aria-label", "Foco do treino");

    FOCO_CATEGORIAS.forEach(cat => {
      const botao = doc.createElement("button");
      botao.type = "button";
      botao.className = "foco-tab";
      botao.setAttribute("data-foco", cat.id);
      botao.setAttribute("aria-pressed", String(focoAtivo === cat.id));
      botao.textContent = cat.label;
      botao.addEventListener("click", () => {
        focoAtivo = cat.id;
        renderFocoTreino(host);
      });
      barra.appendChild(botao);
    });

    host.appendChild(barra);

    const lista = doc.createElement("div");
    lista.className = "foco-lista";
    lista.setAttribute("role", "region");
    lista.setAttribute("aria-label", "Exercícios do foco selecionado");

    const cat = categoriaPorId(focoAtivo);
    const todos = F.catalog.items();
    const filtrados = todos.filter(record => recordVemDoFoco(record, cat));

    if (filtrados.length === 0) {
      lista.appendChild(estadoVazioFoco(cat));
    } else {
      filtrados.forEach(record => lista.appendChild(cardFoco(record)));
    }

    host.appendChild(lista);
  }

  /* ------------------------------------------------------------------ */
  /* Seção 3 — Planos de 7 dias (exemplos claramente identificados)     */
  /* ------------------------------------------------------------------ */

  function cardSeteDias(exemplo) {
    const article = doc.createElement("article");
    article.className = "plano-card";
    article.setAttribute("aria-label", exemplo.label);

    const photo = fotosDisponiveis() ? F.fotos.forSeteDias(exemplo.id) : null;
    anexarFundo(article, photo, "plano-fundo");

    const selo = doc.createElement("span");
    selo.className = "selo-exemplo";
    selo.textContent = "Exemplo";

    const sobre = doc.createElement("div");
    sobre.className = "plano-sobre";

    sobre.appendChild(selo);

    const nome = doc.createElement("h3");
    nome.className = "plano-nome";
    nome.textContent = exemplo.label;
    sobre.appendChild(nome);

    const descricao = doc.createElement("p");
    descricao.className = "plano-descricao";
    descricao.textContent = exemplo.resumo;
    sobre.appendChild(descricao);

    const botao = ui.linkButton({
      href: F.url("rotina", { nova: "1" }),
      label: "Montar rotina",
      icon: "plus",
      variant: "secondary-button",
      className: "plano-botao"
    });
    sobre.appendChild(botao);

    const irTreinos = ui.linkButton({
      href: F.url("treino"),
      label: "Ver rotinas",
      icon: "arrow-right",
      variant: "secondary-button",
      className: "plano-botao secundario"
    });
    sobre.appendChild(irTreinos);
    anexarCredito(sobre, photo);

    article.appendChild(sobre);
    return article;
  }

  function renderPlanosSeteDias(host) {
    clear(host);
    EXEMPLOS_SETE_DIAS.forEach(exemplo => host.appendChild(cardSeteDias(exemplo)));
  }

  /* ------------------------------------------------------------------ */
  /* Seção 4 — Descubra recursos (links para telas existentes)          */
  /* ------------------------------------------------------------------ */

  function cardRecurso(recurso) {
    const article = doc.createElement("article");
    article.className = "recurso-card";
    article.setAttribute("aria-label", recurso.label);

    const photo = fotosDisponiveis() ? F.fotos.forRecurso(recurso.id) : null;
    if (photo) {
      const capa = doc.createElement("div");
      capa.className = "recurso-capa";
      const picture = F.fotos.buildPicture(photo, {
        className: "cartao-foto recurso-foto",
        sizes: "(max-width: 380px) 92vw, (max-width: 760px) 46vw, 320px",
        alt: photo.alt
      });
      if (picture) capa.appendChild(picture);
      article.appendChild(capa);
    } else {
      const iconeWrap = doc.createElement("div");
      iconeWrap.className = "recurso-icone";
      iconeWrap.appendChild(ui.icon(recurso.icon));
      article.appendChild(iconeWrap);
    }

    const nome = doc.createElement("h3");
    nome.className = "recurso-nome";
    nome.textContent = recurso.label;

    const descricao = doc.createElement("p");
    descricao.className = "recurso-descricao";
    descricao.textContent = recurso.desc;

    const link = ui.linkButton({
      href: recurso.route === "explorar"
        ? (recurso.query ? "../explorar/index.html?" + recurso.query : "../explorar/index.html")
        : F.url(recurso.route),
      label: "Abrir " + recurso.label,
      icon: "arrow-right",
      variant: "secondary-button",
      className: "recurso-botao"
    });

    article.append(nome, descricao, link);
    anexarCredito(article, photo);
    return article;
  }

  function renderRecursos(host) {
    clear(host);
    RECURSOS.forEach(recurso => host.appendChild(cardRecurso(recurso)));
  }

  /* ------------------------------------------------------------------ */
  /* Seção 5 — Treinos populares (rotinas iniciáveis do usuário)        */
  /* ------------------------------------------------------------------ */

  function cardPopular(routine) {
    const article = doc.createElement("article");
    article.className = "popular-card";
    article.setAttribute("aria-label", "Treino popular " + routine.name);

    const exercicio = primeiroExercicioDaRotina(routine);
    const photo = fotosDisponiveis()
      ? (F.fotos.forExercise(exercicio, routine.modality) || F.fotos.forModality(routine.modality))
      : null;
    anexarFundo(article, photo, "popular-fundo");

    const sobre = doc.createElement("div");
    sobre.className = "popular-sobre";

    const nome = doc.createElement("h3");
    nome.className = "popular-nome";
    nome.textContent = routine.name;
    sobre.appendChild(nome);

    const descricao = doc.createElement("p");
    descricao.className = "popular-descricao";
    descricao.textContent = descricaoRotina(routine);
    sobre.appendChild(descricao);

    const botao = ui.button({
      label: "Iniciar treino",
      icon: "play",
      variant: "primary-button",
      className: "popular-botao",
      onClick: () => F.startRoutine(routine.modality, routine.id)
    });
    sobre.appendChild(botao);
    anexarCredito(sobre, photo);

    article.appendChild(sobre);
    return article;
  }

  function estadoVazioPopulares(host) {
    const card = ui.empty({
      icon: "dumbbell",
      title: "Sem rotinas para mostrar",
      text: "Crie rotinas em Treinos para elas aparecerem entre os treinos populares.",
      actions: [
        { label: "Criar primeira rotina", variant: "primary-button", icon: "plus",
          href: F.url("rotina", { nova: "1" }) },
        { label: "Ir para Treinos", variant: "secondary-button", icon: "arrow-right",
          href: F.url("treino") }
      ]
    });
    host.appendChild(card);
  }

  function renderTreinosPopulares(host) {
    clear(host);
    const rotinas = typeof F.getStartableRoutines === "function"
      ? F.getStartableRoutines()
      : [];

    if (rotinas.length === 0) {
      estadoVazioPopulares(host);
      return;
    }

    rotinas.forEach(routine => host.appendChild(cardPopular(routine)));
  }

  /* ------------------------------------------------------------------ */
  /* Seção 6 — Treinos rápidos (exercícios de duração real)             */
  /* ------------------------------------------------------------------ */

  function cardRapido(record) {
    const mode = modoDoRecord(record);
    const article = doc.createElement("article");
    article.className = "rapido-card";
    article.setAttribute("aria-label", record.name);

    const photo = fotoDoExercicio(record, mode);
    anexarFundo(article, photo, "rapido-fundo");

    const sobre = doc.createElement("div");
    sobre.className = "rapido-sobre";

    const nome = doc.createElement("h3");
    nome.className = "rapido-nome";
    nome.textContent = record.name;
    sobre.appendChild(nome);

    const duracao = doc.createElement("p");
    duracao.className = "rapido-duracao";
    duracao.textContent = record.duration ? "Duração: " + F.formatRestValue(record.duration) + " por série" : "Sem duração definida";
    sobre.appendChild(duracao);
    anexarCredito(sobre, photo);

    const abrir = () => F.catalog.showDetail(record);
    article.addEventListener("click", abrir);
    article.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        abrir();
      }
    });
    article.setAttribute("tabindex", "0");
    article.setAttribute("role", "button");

    article.appendChild(sobre);
    return article;
  }

  function renderTreinosRapidos(host) {
    clear(host);
    const todos = F.catalog.items();
    const rapidos = todos.filter(record => record.type === "duration");

    if (rapidos.length === 0) {
      host.appendChild(ui.empty({
        icon: "clock",
        title: "Sem treinos rápidos",
        text: "O catálogo não tem exercícios com duração definida no momento."
      }));
      return;
    }

    rapidos.forEach(record => host.appendChild(cardRapido(record)));
  }

  /* ------------------------------------------------------------------ */
  /* Seção 7 — Treino direcionado (objetivo funcional)                  */
  /* ------------------------------------------------------------------ */

  function cardDirecionado(item) {
    const article = doc.createElement("article");
    article.className = "direcionado-card";
    article.setAttribute("aria-label", item.label);

    const photo = fotosDisponiveis() ? F.fotos.forDirecionado(item.id) : null;
    anexarFundo(article, photo, "direcionado-fundo");

    if (!photo) {
      const iconeWrap = doc.createElement("div");
      iconeWrap.className = "direcionado-icone";
      iconeWrap.appendChild(ui.icon(item.icon));
      article.appendChild(iconeWrap);
    }

    const nome = doc.createElement("h3");
    nome.className = "direcionado-nome";
    nome.textContent = item.label;

    const descricao = doc.createElement("p");
    descricao.className = "direcionado-descricao";
    descricao.textContent = item.desc;

    const link = ui.linkButton({
      href: item.query
        ? "../explorar/index.html?" + item.query
        : F.url(item.route),
      label: "Acessar " + item.label,
      icon: "chevron-right",
      variant: "secondary-button",
      className: "direcionado-botao"
    });

    article.append(nome, descricao, link);
    anexarCredito(article, photo);
    return article;
  }

  function renderTreinoDirecionado(host) {
    clear(host);
    DIRECIONADO.forEach(item => host.appendChild(cardDirecionado(item)));
  }

  /* ------------------------------------------------------------------ */
  /* Montagem da tela                                                   */
  /* ------------------------------------------------------------------ */

  function lerFocoInicial() {
    const params = new URLSearchParams(global.location.search);
    const foco = params.get("foco");
    if (foco && FOCO_CATEGORIAS.some(cat => cat.id === foco)) {
      focoAtivo = foco;
    }
  }

  function seção(id, classe, eyebrow, título, nota) {
    const section = doc.createElement("section");
    section.className = "explore-section " + classe;
    if (id) section.id = id;

    const cabeça = doc.createElement("div");
    cabeça.className = "section-head";

    const olho = doc.createElement("span");
    olho.className = "eyebrow";
    olho.textContent = eyebrow;
    cabeça.appendChild(olho);

    const h2 = doc.createElement("h2");
    h2.className = "section-title";
    h2.textContent = título;
    cabeça.appendChild(h2);

    if (nota) {
      const p = doc.createElement("p");
      p.className = "section-note";
      p.textContent = nota;
      cabeça.appendChild(p);
    }

    section.appendChild(cabeça);
    return section;
  }

  function montarEstrutura(conteudo) {
    /* 1. Planos em destaque */
    const s1 = seção("planos-destaque", "planos-destaque", "Planos em destaque", "Seus planos");
    const carrousel1 = doc.createElement("div");
    carrousel1.className = "carousel";
    carrousel1.id = "carousel-planos";
    carrousel1.setAttribute("role", "region");
    carrousel1.setAttribute("aria-label", "Planos em destaque");
    s1.appendChild(carrousel1);
    conteudo.appendChild(s1);

    /* 2. Foco do treino */
    const s2 = seção(null, "foco-treino", "Foco do treino", "Escolha um foco", "Filtre os exercícios por região do corpo ou tipo de treino.");
    const focoHost = doc.createElement("div");
    focoHost.id = "foco-treino";
    s2.appendChild(focoHost);
    conteudo.appendChild(s2);

    /* 3. Planos de 7 dias */
    const s3 = seção("planos-sete-dias", "planos-sete-dias", "Planos de 7 dias", "Referências para montar sua rotina", "Exemplos ilustrativos de como organizar 7 dias de treino. Não são planos gravados no FORJA nem um calendário semanal implementado.");
    const carrousel3 = doc.createElement("div");
    carrousel3.className = "carousel";
    carrousel3.id = "carousel-sete-dias";
    carrousel3.setAttribute("role", "region");
    carrousel3.setAttribute("aria-label", "Planos de 7 dias");
    s3.appendChild(carrousel3);
    conteudo.appendChild(s3);

    /* 4. Descubra recursos */
    const s4 = seção("recursos", "recursos", "Descubra recursos", "Recursos do FORJA", "Telas que já existem no seu app — sem cobrança ou assinatura.");
    const recursosGrade = doc.createElement("div");
    recursosGrade.className = "recursos-grade";
    recursosGrade.id = "recursos-grade";
    s4.appendChild(recursosGrade);
    conteudo.appendChild(s4);

    /* 5. Treinos populares */
    const s5 = seção("treinos-populares", "treinos-populares", "Treinos populares", "Seus treinos mais usados", "Rotinas que você já criou e pode iniciar agora.");
    const popularesGrade = doc.createElement("div");
    popularesGrade.className = "grade";
    popularesGrade.id = "grade-populares";
    s5.appendChild(popularesGrade);
    conteudo.appendChild(s5);

    /* 6. Treinos rápidos */
    const s6 = seção("treinos-rapidos", "treinos-rapidos", "Treinos rápidos", "Exercícios curtos", "Exercícios do catálogo com duração definida, ideais para encaixar no dia.");
    const carrousel6 = doc.createElement("div");
    carrousel6.className = "carousel";
    carrousel6.id = "carousel-rapidos";
    carrousel6.setAttribute("role", "region");
    carrousel6.setAttribute("aria-label", "Treinos rápidos");
    s6.appendChild(carrousel6);
    conteudo.appendChild(s6);

    /* 7. Treino direcionado */
    const s7 = seção("treino-direcionado", "treino-direcionado", "Treino direcionado", "Treinos por objetivo", "Escolha o objetivo funcional e acesse a tela correspondente.");
    const direcionadoLinha = doc.createElement("div");
    direcionadoLinha.className = "linha";
    direcionadoLinha.id = "linha-direcionado";
    s7.appendChild(direcionadoLinha);
    conteudo.appendChild(s7);
  }

  function renderTudo() {
    montarCabecalho();
    renderPlanosDestaque(doc.getElementById("carousel-planos"));
    renderFocoTreino(doc.getElementById("foco-treino"));
    renderPlanosSeteDias(doc.getElementById("carousel-sete-dias"));
    renderRecursos(doc.getElementById("recursos-grade"));
    renderTreinosPopulares(doc.getElementById("grade-populares"));
    renderTreinosRapidos(doc.getElementById("carousel-rapidos"));
    renderTreinoDirecionado(doc.getElementById("linha-direcionado"));
  }

  /* Inicialização da página (chamada por forja-app.js via F.pages[name]). */
  function initExplorar() {
    const conteudo = doc.getElementById("conteudo");
    if (!conteudo) return;

    lerFocoInicial();
    montarEstrutura(conteudo);
    renderTudo();

    /* Reage a mudanças de dados vindas de outras abas/janelas. */
    if (typeof F.onDataChanged === "function") {
      F.onDataChanged(renderTudo);
    }

    const chaves = F.KEYS
      ? [F.KEYS.routines, F.KEYS.legacyExercises, F.KEYS.active]
      : [];
    function sincronizarERender(key) {
      if (typeof F.syncStateFromStorage === "function") F.syncStateFromStorage(key);
      renderTudo();
    }
    global.addEventListener("storage", event => {
      if (!event) return;
      if (event.key !== null && chaves.indexOf(event.key) === -1) return;
      sincronizarERender(event.key);
    });
    global.addEventListener("pageshow", event => {
      if (event && event.persisted) sincronizarERender(null);
    });
  }

  F.pages.explorar = initExplorar;

})(window);
