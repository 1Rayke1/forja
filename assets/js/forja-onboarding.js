/*
  FORJA — onboarding: cadastro inicial e personalização do perfil.

  Página: onboarding/index.html (data-page="onboarding").

  Regras que valem para tudo aqui:

  - Nada é gravado no armazenamento do FORJA até o último passo ("Concluir
    cadastro"). Antes disso, as respostas ficam só em memória e num rascunho de
    `sessionStorage` (que morre com a aba e nunca entra em backup).
  - A única gravação do perfil é `F.saveProfile` (uma escrita atômica na chave
    `forja-perfil-v1`). Se o navegador recusar, a tela mostra o erro e mantém o
    rascunho: nenhuma resposta é perdida em silêncio.
  - Cada pergunta tem uma finalidade declarada. Perguntas do app de referência
    sem efeito real no FORJA (sono, estresse, hábitos, eventos, peso/altura)
    foram deixadas de fora de propósito — ver docs/onboarding.md.
  - O sexo informado só escolhe o personagem das demonstrações no futuro.
    Nenhum personagem é exibido enquanto o dado não existir, e o dado nunca
    altera treino, histórico, carga ou objetivo.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const DRAFT_KEY = "forja-onboarding-rascunho-v1";

  /*
    Passos do fluxo. `campo` é o campo do perfil alimentado pelo passo; `tipo`
    "escolha" rende um grupo de rádios (teclado e leitor de tela nativos),
    "intro" e "revisao" são telas de contexto.
  */
  const PASSOS = [
    {
      id: "boas-vindas",
      tipo: "intro",
      titulo: "Bem-vindo à FORJA",
      resumo: "Vamos montar seu perfil de treino em etapas curtas."
    },
    {
      id: "sexo",
      campo: "sexo",
      tipo: "escolha",
      obrigatorio: true,
      rotuloCurto: "Sexo",
      titulo: "Qual sexo você informa?",
      descricao: "Serve apenas para escolher o personagem das demonstrações dos exercícios. " +
        "Não muda treinos, cargas, histórico nem objetivos.",
      opcoes: [
        {
          valor: "masculino",
          titulo: "Masculino",
          texto: "Demonstrações com personagem masculino."
        },
        {
          valor: "feminino",
          titulo: "Feminino",
          texto: "Demonstrações com personagem feminino."
        },
        {
          valor: "",
          titulo: "Prefiro não informar",
          texto: "O FORJA segue funcionando normalmente, sem personagem."
        }
      ]
    },
    {
      id: "objetivo",
      campo: "objetivo",
      tipo: "escolha",
      rotuloCurto: "Objetivo",
      titulo: "Qual é o seu objetivo principal?",
      descricao: "Orienta a organização das rotinas que você criar. Nada é prescrito automaticamente.",
      opcoes: [
        { valor: "forca", titulo: "Força", texto: "Cargas altas, poucas repetições." },
        { valor: "hipertrofia", titulo: "Hipertrofia", texto: "Volume de treino para ganhar massa." },
        { valor: "resistencia", titulo: "Resistência", texto: "Fôlego e capacidade de repetir esforço." },
        { valor: "calistenia", titulo: "Calistenia", texto: "Peso corporal, barras e chão." },
        { valor: "recuperacao", titulo: "Recuperação", texto: "Voltar a treinar com segurança." },
        { valor: "", titulo: "Ainda não sei", texto: "Pode definir depois em Perfil." }
      ]
    },
    {
      id: "nivel",
      campo: "nivel",
      tipo: "escolha",
      rotuloCurto: "Experiência",
      titulo: "Qual é a sua experiência com treino?",
      descricao: "Serve para você reconhecer o próprio ponto de partida. O FORJA não prescreve carga.",
      opcoes: [
        { valor: "iniciante", titulo: "Iniciante", texto: "Primeiros meses, aprendendo a técnica." },
        { valor: "intermediario", titulo: "Intermediário", texto: "Treina com certa regularidade." },
        { valor: "avancado", titulo: "Avançado", texto: "Anos de treino consistente." },
        { valor: "", titulo: "Ainda não sei", texto: "Pode definir depois em Perfil." }
      ]
    },
    {
      id: "dias",
      campo: "diasPorSemana",
      tipo: "escolha",
      numerico: true,
      rotuloCurto: "Dias por semana",
      titulo: "Quantos dias por semana você consegue treinar?",
      descricao: "Usado para sugerir metas semanais. Você continua livre para treinar quando quiser.",
      opcoes: [
        { valor: 1, titulo: "1 dia", texto: "Um treino por semana." },
        { valor: 2, titulo: "2 dias", texto: "Dois treinos por semana." },
        { valor: 3, titulo: "3 dias", texto: "Três treinos por semana." },
        { valor: 4, titulo: "4 dias", texto: "Quatro treinos por semana." },
        { valor: 5, titulo: "5 dias", texto: "Cinco treinos por semana." },
        { valor: 6, titulo: "6 dias", texto: "Seis treinos por semana." },
        { valor: 7, titulo: "7 dias", texto: "Todos os dias." },
        { valor: 0, titulo: "Ainda não sei", texto: "Pode definir depois em Perfil." }
      ]
    },
    {
      id: "duracao",
      campo: "duracaoMinutos",
      tipo: "escolha",
      numerico: true,
      rotuloCurto: "Duração da sessão",
      titulo: "Quanto tempo costuma durar uma sessão?",
      descricao: "Entra na sugestão de minutos por semana. O cronômetro do treino continua sendo seu.",
      opcoes: [
        { valor: 20, titulo: "Até 20 min", texto: "Sessões curtas." },
        { valor: 30, titulo: "30 min", texto: "Meia hora por sessão." },
        { valor: 45, titulo: "45 min", texto: "Três quartos de hora." },
        { valor: 60, titulo: "60 min", texto: "Uma hora por sessão." },
        { valor: 90, titulo: "90 min", texto: "Sessões longas." },
        { valor: 0, titulo: "Ainda não sei", texto: "Pode definir depois em Perfil." }
      ]
    },
    {
      id: "equipamento",
      campo: "equipamento",
      tipo: "escolha",
      rotuloCurto: "Equipamento",
      titulo: "Qual equipamento você tem disponível?",
      descricao: "Ajuda a saber o que faz sentido procurar na biblioteca de exercícios.",
      opcoes: [
        { valor: "nenhum", titulo: "Sem equipamentos", texto: "Só peso corporal e chão." },
        { valor: "casa", titulo: "Casa / peso corporal", texto: "Elástico, halteres leves, barras simples." },
        { valor: "academia", titulo: "Academia", texto: "Máquinas, barras, anilhas e polias." },
        { valor: "ambos", titulo: "Ambos", texto: "Treina em casa e na academia." },
        { valor: "", titulo: "Não definido", texto: "Pode definir depois em Perfil." }
      ]
    },
    {
      id: "modalidade",
      campo: "modalidadePreferida",
      tipo: "escolha",
      rotuloCurto: "Modalidade",
      titulo: "Qual modalidade você prefere começar?",
      descricao: "Vira o filtro inicial da lista de rotinas. Você troca o filtro quando quiser.",
      opcoes: [
        { valor: "calisthenics", titulo: "Calistenia", texto: "Peso corporal, barras e chão." },
        { valor: "weights", titulo: "Musculação", texto: "Cargas, halteres e máquinas." },
        { valor: "", titulo: "Sem preferência", texto: "Ver todas as rotinas." }
      ]
    },
    {
      id: "revisao",
      tipo: "revisao",
      titulo: "Confira suas respostas",
      resumo: "Você pode editar qualquer resposta antes de concluir."
    }
  ];

  const LABELS = {
    sexo: campo => (F.PERFIL_LABELS.sexo[campo] || "Não informado"),
    objetivo: campo => (F.PERFIL_LABELS.objetivo[campo] || "Não definido"),
    nivel: campo => (F.PERFIL_LABELS.nivel[campo] || "Não definido"),
    equipamento: campo => (F.PERFIL_LABELS.equipamento[campo] || "Não definido"),
    modalidadePreferida: campo => (F.PERFIL_LABELS.modalidade[campo] || "Sem preferência"),
    diasPorSemana: campo => (campo > 0
      ? campo + (campo === 1 ? " dia por semana" : " dias por semana")
      : "Não definido"),
    duracaoMinutos: campo => (campo > 0 ? campo + " min por sessão" : "Não definido")
  };

  /* Respostas iniciais: perfil salvo, senão vazio. Nunca um palpite. */
  function respostasDoPerfil(profile) {
    const atual = F.normalizeProfile(profile);
    const respostas = {};

    PASSOS.forEach(passo => {
      if (!passo.campo) return;
      respostas[passo.campo] = atual[passo.campo];
    });

    return respostas;
  }

  function lerRascunho() {
    try {
      const raw = global.sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (!F.isPlainObject(value) || !F.isPlainObject(value.respostas)) return null;

      const indice = Number(value.passo);
      return {
        passo: Number.isInteger(indice) && indice >= 0 && indice < PASSOS.length ? indice : 0,
        respostas: value.respostas,
        tocados: F.isPlainObject(value.tocados) ? value.tocados : {}
      };
    } catch (error) {
      return null;
    }
  }

  function gravarRascunho(state) {
    try {
      global.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        passo: state.passo,
        respostas: state.respostas,
        tocados: state.tocados,
        atualizadoEm: new Date().toISOString()
      }));
      return true;
    } catch (error) {
      /* Sem sessionStorage (modo privado): as respostas seguem em memória. */
      return false;
    }
  }

  function apagarRascunho() {
    try {
      global.sessionStorage.removeItem(DRAFT_KEY);
    } catch (error) {
      /* Nada a fazer: a chave simplesmente fica. */
    }
  }

  /*
    Aviso de dispensa do convite na Home: a implementação é compartilhada
    (`F.setOnboardingSkipped` em forja-core.js) porque a Home precisa da mesma
    chave sem carregar este módulo.
  */
  const marcarDispensado = F.setOnboardingSkipped;
  const foiDispensado = F.onboardingSkipped;
  const limparDispensa = F.clearOnboardingSkipped;

  /* ------------------------------------------------------------------ */
  /* Render da etapa atual                                               */
  /* ------------------------------------------------------------------ */

  /* Mensagem de erro da página. Vive no módulo porque quem a limpa é o
     handler do rádio, fora da função de inicialização. */
  function esconderErroVisivel() {
    const erro = F.byId("onboarding-error");
    if (!erro) return;
    erro.textContent = "";
    erro.hidden = true;
  }

  function criar(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function renderProgresso(host, state) {
    host.replaceChildren();

    const total = PASSOS.length;
    const atual = state.passo + 1;
    const perguntas = PASSOS.filter(passo => passo.tipo === "escolha").length;
    const numeroPergunta = PASSOS.slice(0, state.passo + 1)
      .filter(passo => passo.tipo === "escolha").length;

    const rotulo = PASSOS[state.passo].tipo === "intro"
      ? "Comece por aqui"
      : PASSOS[state.passo].tipo === "revisao"
        ? "Revisão das respostas"
        : "Etapa " + numeroPergunta + " de " + perguntas;

    const texto = criar("p", "onboarding-step-count", rotulo);
    texto.id = "onboarding-step-count";

    const trilha = criar("div", "onboarding-track");
    trilha.id = "onboarding-progressbar";
    trilha.setAttribute("role", "progressbar");
    trilha.setAttribute("aria-valuemin", "0");
    trilha.setAttribute("aria-valuemax", String(total - 1));
    trilha.setAttribute("aria-valuenow", String(state.passo));
    trilha.setAttribute("aria-valuetext", "Passo " + atual + " de " + total + ": " + PASSOS[state.passo].titulo);
    trilha.setAttribute("aria-labelledby", "onboarding-step-count");

    const preenchimento = criar("div", "onboarding-track-fill");
    preenchimento.style.width = Math.round((state.passo / (total - 1)) * 100) + "%";
    trilha.appendChild(preenchimento);

    host.append(texto, trilha);
  }

  function renderIntro(host, state) {
    const lista = criar("ul", "onboarding-facts");

    [
      "Oito etapas curtas, uma pergunta por tela.",
      "Tudo fica apenas neste navegador — nada é enviado a servidores.",
      "Suas rotinas e seu histórico atuais não são alterados.",
      "Você pode editar tudo depois em Perfil."
    ].forEach(texto => lista.appendChild(criar("li", "onboarding-fact", texto)));

    const skip = criar("a", "onboarding-skip", "Agora não, quero explorar o app");
    skip.href = F.url("inicio");
    skip.id = "onboarding-skip";

    host.append(lista);

    if (F.profileIsConfigured(F.state.profile)) {
      host.appendChild(criar(
        "p",
        "onboarding-note",
        "Você já tem um perfil salvo. Responder de novo substitui as respostas anteriores."
      ));
    }

    host.appendChild(skip);
  }

  function renderEscolha(host, state, passo) {
    const grupo = criar("div", "onboarding-options");
    grupo.setAttribute("role", "radiogroup");
    grupo.setAttribute("aria-labelledby", "onboarding-question");
    if (passo.descricao) grupo.setAttribute("aria-describedby", "onboarding-question-description");

    const atual = state.respostas[passo.campo];

    passo.opcoes.forEach((opcao, indice) => {
      const rotulo = criar("label", "onboarding-option");
      rotulo.setAttribute("data-value", String(opcao.valor));

      const input = doc.createElement("input");
      input.type = "radio";
      input.name = "onboarding-" + passo.campo;
      input.id = "onboarding-" + passo.campo + "-" + indice;
      input.value = String(opcao.valor);
      input.className = "onboarding-radio";
      input.checked = String(opcao.valor) === String(atual);

      if (String(opcao.valor) === String(atual)) rotulo.classList.add("is-selected");

      input.addEventListener("change", () => {
        state.respostas[passo.campo] = passo.numerico ? Number(opcao.valor) : String(opcao.valor);
        state.tocados[passo.campo] = true;
        gravarRascunho(state);
        grupo.querySelectorAll(".onboarding-option").forEach(item => {
          item.classList.toggle("is-selected", item.getAttribute("data-value") === input.value);
        });
        esconderErroVisivel();
        F.ui.announce(opcao.titulo + " selecionado.");
      });

      const corpo = criar("span", "onboarding-option-body");
      corpo.appendChild(criar("span", "onboarding-option-title", opcao.titulo));
      if (opcao.texto) corpo.appendChild(criar("span", "onboarding-option-text", opcao.texto));

      rotulo.append(input, corpo);
      grupo.appendChild(rotulo);
    });

    host.appendChild(grupo);
  }

  function renderRevisao(host, state, acoes) {
    const lista = criar("dl", "onboarding-review");

    PASSOS.forEach((passo, indice) => {
      if (!passo.campo) return;

      const linha = criar("div", "onboarding-review-row");
      const nomeCurto = passo.rotuloCurto || passo.titulo.replace(/\?$/, "");
      linha.appendChild(criar("dt", "onboarding-review-term", nomeCurto));

      const rotulo = LABELS[passo.campo]
        ? LABELS[passo.campo](state.respostas[passo.campo])
        : String(state.respostas[passo.campo] || "Não definido");
      linha.appendChild(criar("dd", "onboarding-review-value", rotulo));

      const editar = criar("button", "onboarding-edit", "Editar");
      editar.type = "button";
      editar.setAttribute("data-step", String(indice));
      editar.setAttribute("aria-label", "Editar " + nomeCurto.toLowerCase());
      editar.addEventListener("click", () => acoes.irPara(indice));
      linha.appendChild(editar);

      lista.appendChild(linha);
    });

    host.appendChild(lista);

    /* Metas semanais: sugestão explícita, nunca gravação silenciosa. */
    const sugestao = F.profileGoalSuggestion(state.respostas);
    const metasExistentes = F.state.goals && F.state.goals.updatedAt;

    if (sugestao && !metasExistentes) {
      const caixa = criar("label", "onboarding-optin");
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.id = "onboarding-goals";
      input.checked = true;

      const texto = criar("span", "onboarding-optin-text");
      texto.appendChild(criar("strong", null, "Criar uma meta semanal com estes dados"));
      const partes = [];
      if (sugestao.weeklySessions > 0) {
        partes.push(sugestao.weeklySessions + (sugestao.weeklySessions === 1 ? " treino" : " treinos"));
      }
      if (sugestao.weeklyMinutes > 0) partes.push(sugestao.weeklyMinutes + " minutos");
      texto.appendChild(criar(
        "span",
        "onboarding-optin-detail",
        partes.join(" · ") + (sugestao.modality === "all"
          ? " · todas as modalidades"
          : " · " + F.PERFIL_LABELS.modalidade[sugestao.modality])
      ));

      caixa.append(input, texto);
      host.appendChild(caixa);
    }

    const nota = criar(
      "p",
      "onboarding-note",
      "Ao concluir, o perfil é gravado apenas neste navegador. Você pode alterar ou limpar os dados em Perfil."
    );
    host.appendChild(nota);
  }

  /* ------------------------------------------------------------------ */
  /* Página                                                              */
  /* ------------------------------------------------------------------ */

  F.pages.onboarding = function initOnboarding() {
    const shell = F.byId("onboarding-shell");
    const progressHost = F.byId("onboarding-progress");
    const stepHost = F.byId("onboarding-step");
    const form = F.byId("onboarding-form");
    const erro = F.byId("onboarding-error");
    const voltar = F.byId("onboarding-back");
    const avancar = F.byId("onboarding-next");
    const sair = F.byId("onboarding-exit");

    if (!shell || !stepHost || !form || !avancar) return;

    const rascunho = lerRascunho();
    const state = {
      passo: rascunho ? rascunho.passo : 0,
      respostas: Object.assign(
        respostasDoPerfil(F.state.profile),
        rascunho ? rascunho.respostas : {}
      ),
      tocados: rascunho ? rascunho.tocados : {}
    };

    /* Respostas fora do vocabulário do perfil não entram no fluxo. */
    const normalizadas = F.normalizeProfile(state.respostas);
    Object.keys(state.respostas).forEach(campo => {
      state.respostas[campo] = normalizadas[campo];
    });

    /* Quem já configurou o perfil e abre a página direto começa revisando. */
    if (!rascunho && F.profileIsConfigured(F.state.profile) && !documentoQuerRefazer()) {
      state.passo = PASSOS.length - 1;
    }

    function documentoQuerRefazer() {
      const busca = (global.location && global.location.search) || "";
      return /(\?|&)refazer=1(&|$)/.test(busca);
    }

    function esconderErro() {
      esconderErroVisivel();
    }

    function mostrarErro(mensagem) {
      if (!erro) return;
      erro.textContent = mensagem;
      erro.hidden = false;
    }

    function irPara(indice) {
      state.passo = Math.max(0, Math.min(PASSOS.length - 1, indice));
      gravarRascunho(state);
      render();
      const alvo = stepHost.querySelector("#onboarding-question");
      if (alvo && typeof alvo.focus === "function") alvo.focus({ preventScroll: true });
      F.safeScrollIntoView(shell, { block: "start" });
    }

    function render() {
      const passo = PASSOS[state.passo];
      stepHost.replaceChildren();

      const titulo = criar("h1", "onboarding-title", passo.titulo);
      titulo.id = "onboarding-question";
      titulo.tabIndex = -1;
      stepHost.appendChild(titulo);

      const descricao = passo.tipo === "escolha" ? passo.descricao : passo.resumo;
      if (descricao) {
        const paragrafo = criar("p", "onboarding-description", descricao);
        paragrafo.id = "onboarding-question-description";
        stepHost.appendChild(paragrafo);
      }

      if (passo.tipo === "intro") renderIntro(stepHost, state);
      if (passo.tipo === "escolha") renderEscolha(stepHost, state, passo);
      if (passo.tipo === "revisao") renderRevisao(stepHost, state, { irPara });

      renderProgresso(progressHost, state);

      const ultimo = state.passo === PASSOS.length - 1;
      avancar.textContent = passo.tipo === "intro"
        ? "Começar"
        : ultimo
          ? "Concluir cadastro"
          : "Continuar";

      voltar.hidden = state.passo === 0;
      voltar.disabled = state.passo === 0;

      if (sair) {
        sair.hidden = state.passo === 0 || ultimo;
      }

      esconderErro();
      F.ui.announce("Passo " + (state.passo + 1) + " de " + PASSOS.length + ": " + passo.titulo);
    }

    function podeAvancar() {
      const passo = PASSOS[state.passo];

      if (passo.tipo !== "escolha" || !passo.obrigatorio) return true;
      return Boolean(state.tocados[passo.campo]);
    }

    function concluir() {
      /* Evita gravar duas vezes se o clique for repetido durante a escrita. */
      if (avancar.disabled) return;
      avancar.disabled = true;

      const patch = {
        onboardingConcluidoEm: new Date().toISOString()
      };

      PASSOS.forEach(passo => {
        if (passo.campo) patch[passo.campo] = state.respostas[passo.campo];
      });

      if (!F.saveProfile(patch)) {
        avancar.disabled = false;
        mostrarErro("Não foi possível salvar o perfil neste navegador. " +
          "Suas respostas continuam nesta aba: verifique o espaço disponível e tente de novo.");
        F.showToast("O perfil não foi salvo. Nenhuma resposta foi perdida.", "error", 6000);
        return;
      }

      limparDispensa();
      apagarRascunho();

      /* Elemento criado na revisão (não existe no HTML estático). */
      const caixa = stepHost.querySelector("#onboarding-goals");
      let metasSalvas = true;

      if (caixa && caixa.checked) {
        const sugestao = F.profileGoalSuggestion(state.respostas);
        if (sugestao) {
          metasSalvas = F.saveGoals({
            modality: sugestao.modality,
            weeklySessions: sugestao.weeklySessions,
            weeklyMinutes: sugestao.weeklyMinutes
          });
        }
      }

      F.flash(
        metasSalvas
          ? "Cadastro concluído. Seu perfil está salvo neste aparelho."
          : "Perfil salvo. As metas semanais não puderam ser criadas — configure em Progresso.",
        metasSalvas ? "info" : "error"
      );
      F.navigate(F.url("inicio"));
    }

    form.addEventListener("submit", event => {
      event.preventDefault();

      const ultimo = state.passo === PASSOS.length - 1;

      if (ultimo) {
        concluir();
        return;
      }

      if (!podeAvancar()) {
        mostrarErro(PASSOS[state.passo].obrigatorio
          ? "Escolha uma opção para continuar. Se preferir não responder, selecione \"Prefiro não informar\"."
          : "Escolha uma opção para continuar.");
        const primeiro = stepHost.querySelector("input[type=\"radio\"]");
        if (primeiro && typeof primeiro.focus === "function") primeiro.focus({ preventScroll: true });
        return;
      }

      irPara(state.passo + 1);
    });

    if (voltar) {
      voltar.addEventListener("click", () => irPara(state.passo - 1));
    }

    render();
  };

  F.onboarding = {
    DRAFT_KEY,
    PASSOS,
    marcarDispensado,
    foiDispensado,
    limparDispensa,
    lerRascunho,
    apagarRascunho
  };
})(window);
