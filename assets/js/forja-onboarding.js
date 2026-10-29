/*
  FORJA — onboarding: cadastro guiado e personalização do perfil.

  Página: onboarding/index.html (data-page="onboarding").

  Como este módulo funciona:

  - Existe UM fluxo data-driven (`PASSOS`), não 24 páginas. Cada passo declara
    identificador, tipo de controle, campo do perfil, obrigatoriedade, título,
    subtítulo e opções. O renderizador é escolhido pelo `tipo`:
    "imagem" (cartões com foto), "escolha" (cartões de seleção única),
    "multipla" (cartões de seleção múltipla), "numero" (seletor numérico com
    unidades), "revisao" e "final".
  - As respostas vivem em um único objeto `state.respostas`, com os mesmos
    nomes de campo do perfil (`F.normalizeProfile`). Não existe segundo modelo
    de perfil nem armazenamento paralelo.
  - Nada é gravado no armazenamento do FORJA antes da tela de revisão. Antes
    disso as respostas ficam em memória e em um rascunho de `sessionStorage`
    (`forja-onboarding-rascunho-v1`, o mesmo de sempre), que morre com a aba e
    nunca entra em backup.
  - A única gravação do perfil continua sendo `F.saveProfile` (uma escrita
    atômica em `forja-perfil-v1`). Se o navegador recusar, a tela mostra o erro
    e mantém o rascunho: nenhuma resposta é perdida em silêncio.
  - Perguntas sem campo no perfil não existem aqui. Perguntas novas do cadastro
    (altura, peso, rotina, equipamentos etc.) entraram como campos ADITIVOS do
    perfil v3 — ver docs/onboarding.md. Nenhuma delas altera cálculo existente:
    metas semanais continuam vindo de `diasPorSemana` × `duracaoMinutos`, e o
    filtro de rotinas continua vindo de `modalidadePreferida`.
  - O sexo informado só escolhe o personagem das demonstrações no futuro.
    Nenhum personagem é exibido enquanto o dado não existir, e o dado nunca
    altera treino, histórico, carga ou objetivo.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const DRAFT_KEY = "forja-onboarding-rascunho-v1";
  const RAIZ = (doc.body && doc.body.getAttribute("data-root")) || "../";

  const ANO_LIMITE = new Date().getFullYear();

  /*
    Imagens reais fornecidas para a primeira etapa. Cada cartão usa a sua:
    a feminina nunca aparece no cartão masculino e vice-versa. A proporção
    original (2:3) é preservada no CSS, sem recorte.
  */
  const IMAGENS = {
    masculino: RAIZ + "assets/imagens/onboarding/perfil-masculino.jpg",
    feminino: RAIZ + "assets/imagens/onboarding/perfil-feminino.jpg"
  };

  /* ------------------------------------------------------------------ */
  /* Ícones (SVG inline, traço de 1.7 px, 24 × 24)                       */
  /* ------------------------------------------------------------------ */

  const ICONES = {
    corpo: '<circle cx="12" cy="4" r="2"/><path d="M12 6.5v6M12 12.5 8.5 20M12 12.5 15.5 20M8 9h8"/>',
    bracos: '<path d="M4 16.5h3.5L11 13V8.5a2 2 0 0 1 4 0V12h3.5a2 2 0 0 1 0 4h-2L14 19H9"/>',
    peito: '<path d="M3.5 8.5C5.5 6 8.5 5 12 5s6.5 1 8.5 3.5v3.8c-2 1.4-4.4 2-6.5 2h-4c-2.1 0-4.5-.6-6.5-2Z"/><path d="M12 5v9.5"/>',
    abdomen: '<path d="M7.5 4.5c-.9 4-.9 9 0 15M16.5 4.5c.9 4 .9 9 0 15M7.5 9.5h9M7.5 14.5h9"/>',
    pernas: '<path d="M8.5 3.5v8L7 20.5M15.5 3.5v8L17 20.5M8.5 11.5h7"/>',
    balanca: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M7.5 11a4.5 4.5 0 0 1 9 0"/><path d="M12 11l2.8-1.8"/>',
    alvo: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
    halter: '<path d="M3.5 9.5v5M6.7 7v10M17.3 7v10M20.5 9.5v5M6.7 12h10.6"/>',
    coracao: '<path d="M12 20s-7-4.2-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.8-7 9-7 9Z"/>',
    escudo: '<path d="M12 3l7 3v5c0 4.1-3 7.3-7 9-4-1.7-7-4.9-7-9V6Z"/><path d="M9 12l2 2 4-4"/>',
    raio: '<path d="M13.5 3 6.5 13H11l-.5 8 7-10H13Z"/>',
    folha: '<path d="M20 4C10.5 4 5.5 8 5.5 15c0 2.2.9 4.1 2.2 5.2.9-6 4-9 9-11-4.2 2.8-6.2 6-6.2 11 8.2 0 9.5-6.4 9.5-16.2Z"/>',
    cadeira: '<path d="M8 4h9v9H8z"/><path d="M8 13v7M17 13v7M5 20h14M6.5 8.5H8"/>',
    empe: '<circle cx="12" cy="4" r="2"/><path d="M12 6.5v6.5M12 13l-3 7.5M12 13l3 7.5M8.5 9.5h7"/>',
    caminhada: '<circle cx="13.5" cy="4.2" r="2"/><path d="M13 6.8 10.5 12l3 3v6M13 6.8l3 2M10.5 12l-3.5 1.6M13 12l3.5 1.6"/>',
    esforco: '<path d="M4 8.5h16V14H4z"/><path d="M4 8.5 8 4.5h8l4 4M9 14v6.5M15 14v6.5"/>',
    variacao: '<path d="M4 8.5h12.5L13 5M16.5 8.5 13 12"/><path d="M20 15.5H7.5L11 12M7.5 15.5 11 19"/>',
    casa: '<path d="M3.5 10 12 3.2 20.5 10V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1Z"/>',
    academia: '<path d="M4 20V9.4l8-4.6 8 4.6V20"/><path d="M9 20v-5.5h6V20M3 20h18M9.5 9.5h5"/>',
    arlivre: '<circle cx="17.5" cy="6" r="2.6"/><path d="M3 20.5 8.6 11l3.7 5 2.6-3 5.1 7.5Z"/>',
    semlocal: '<path d="M12 21s6.2-6.3 6.2-10.4A6.2 6.2 0 0 0 5.8 10.6C5.8 14.7 12 21 12 21Z"/><path d="M10.4 8.6a1.9 1.9 0 0 1 3.3 1.3c0 1.3-1.7 1.9-1.7 2.6M12 15h.01"/>',
    calistenia: '<circle cx="12" cy="4.3" r="2"/><path d="M7 7.5h10M12 6.5v4M12 10.5l-3 4v5M12 10.5l3 4v5"/>',
    funcional: '<path d="M9.2 10.5a2.8 2.8 0 1 1 5.6 0"/><path d="M8 10.5h8l1.8 9.5H6.2Z"/>',
    cardio: '<path d="M2.5 12.5h4L9 6.5l3 11 2.5-5h7"/>',
    combinacao: '<rect x="3.2" y="3.2" width="7.2" height="7.2" rx="2"/><rect x="13.6" y="3.2" width="7.2" height="7.2" rx="2"/><rect x="3.2" y="13.6" width="7.2" height="7.2" rx="2"/><rect x="13.6" y="13.6" width="7.2" height="7.2" rx="2"/>',
    descoberta: '<circle cx="12" cy="12" r="8.8"/><path d="M15.4 8.6 13.7 14l-5.4 1.7L10 10.2Z"/>',
    calendario: '<rect x="3.2" y="5" width="17.6" height="15.8" rx="3"/><path d="M8 3v4M16 3v4M3.2 10.2h17.6"/><path d="M8 14.5h2M13 14.5h3M8 17.5h3"/>',
    trofeu: '<path d="M8 4h8v3.8a4 4 0 0 1-8 0Z"/><path d="M8 5.6H5.2V7A3.2 3.2 0 0 0 8 10.2M16 5.6h2.8V7A3.2 3.2 0 0 1 16 10.2M12 11.8v4M8.5 20h7M10 20l.6-4h2.8l.6 4"/>',
    grafico: '<path d="M4 20V11.5M10 20V4.5M16 20v-6.5M21 20H3"/>',
    medalha: '<circle cx="12" cy="15" r="4.8"/><path d="M8.6 3 12 10.4 15.4 3M9.6 15.2l1.6 1.6 3-3.4"/>',
    chama: '<path d="M12 3.2c4.2 4 5.4 6.4 5.4 9.2a5.4 5.4 0 0 1-10.8 0c0-2.1 1-3.9 3-6 0 2 1 3.2 2.1 3.2S12.8 7.4 12 3.2Z"/>',
    ajuste: '<path d="M4 8.5h8M16.5 8.5H20M4 15.5h3.5M12 15.5H20"/><circle cx="14.2" cy="8.5" r="2.3"/><circle cx="9.7" cy="15.5" r="2.3"/>',
    conversa: '<path d="M4 5.5h16v10.2H9.4L4 20Z"/><path d="M8 9.2h8M8 12.4h5"/>',
    desconforto: '<path d="M12 4 20.4 19.2H3.6Z"/><path d="M12 10v4M12 16.6h.01"/>',
    impacto: '<path d="M2.5 14.5c3-4.2 5.4-4.2 8.4 0s5.4 4.2 8.4 0"/><path d="M2.5 9c3-4.2 5.4-4.2 8.4 0s5.4 4.2 8.4 0"/>',
    escada: '<path d="M3.5 20h4.2v-5h4.2V10h4.2V5H20"/><path d="M17 5h3v15"/>',
    check: '<path d="M5 12.5 10 17.5 19 6.5"/>',
    flexao: '<circle cx="7" cy="6" r="1.9"/><path d="M8.4 7.6 12 10l6 1.8M12 10v5.5H7.5M18 11.8l1.5 3.7M5.5 20.5h13"/>',
    respiracao: '<path d="M12 20.5c-4.6-2.6-7.5-5.4-7.5-9A3.8 3.8 0 0 1 12 8.2a3.8 3.8 0 0 1 7.5 3.3c0 3.6-2.9 6.4-7.5 9Z"/><path d="M9 12.4h6"/>',
    relogio: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3.2 2"/>'
  };

  function icone(nome, classe) {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", "onboarding-icon" + (classe ? " " + classe : ""));
    svg.innerHTML = ICONES[nome] || ICONES.alvo;
    return svg;
  }

  /* ------------------------------------------------------------------ */
  /* Fluxo                                                               */
  /* ------------------------------------------------------------------ */

  /*
    `campo` é o campo do perfil alimentado pelo passo — sempre um nome que
    existe em `F.normalizeProfile`. `obrigatorio: false` libera o link
    "Pular esta etapa". `unidades` só existe em passos numéricos; o valor
    gravado é SEMPRE o da unidade-base (cm ou kg), independente do que a tela
    mostra.
  */
  const PASSOS = [
    {
      id: "sexo",
      tipo: "imagem",
      campo: "sexo",
      obrigatorio: true,
      rotuloCurto: "Sexo",
      titulo: "Vamos personalizar seu treino.",
      subtitulo: "Escolha uma opção para começarmos.",
      nota: "O sexo informado escolhe o personagem das demonstrações dos exercícios. Ele não muda treinos, cargas, histórico nem objetivos.",
      alternativa: {
        valor: "",
        titulo: "Prefiro não informar",
        texto: "O FORJA segue funcionando normalmente, sem personagem."
      },
      opcoes: [
        {
          valor: "masculino",
          titulo: "Masculino",
          imagem: IMAGENS.masculino,
          alt: "Atleta com camiseta preta da FORJA e detalhes verde-limão, de frente"
        },
        {
          valor: "feminino",
          titulo: "Feminino",
          imagem: IMAGENS.feminino,
          alt: "Atleta com camiseta preta da FORJA e detalhes verde-limão, de frente"
        }
      ]
    },
    {
      id: "foco",
      tipo: "escolha",
      campo: "focoArea",
      obrigatorio: true,
      rotuloCurto: "Área de foco",
      titulo: "Qual área você quer priorizar?",
      subtitulo: "Escolha uma área principal. Você continua livre para treinar o corpo todo.",
      opcoes: [
        { valor: "corpo-todo", titulo: "Corpo todo", icone: "corpo", texto: "Treino equilibrado, sem foco único." },
        { valor: "bracos", titulo: "Braços", icone: "bracos", texto: "Bíceps, tríceps e antebraço." },
        { valor: "peito", titulo: "Peito", icone: "peito", texto: "Peitoral e empurrar." },
        { valor: "abdomen", titulo: "Abdômen", icone: "abdomen", texto: "Core e estabilidade." },
        { valor: "pernas", titulo: "Pernas", icone: "pernas", texto: "Coxas, glúteos e panturrilhas." }
      ]
    },
    {
      id: "objetivo",
      tipo: "escolha",
      campo: "objetivo",
      obrigatorio: true,
      rotuloCurto: "Objetivo",
      titulo: "Qual é o seu principal objetivo?",
      subtitulo: "Orienta a organização das rotinas que você criar. Nada é prescrito automaticamente.",
      opcoes: [
        { valor: "emagrecimento", titulo: "Perder peso", icone: "balanca", texto: "Mais movimento no dia a dia." },
        { valor: "hipertrofia", titulo: "Ganhar massa muscular", icone: "halter", texto: "Volume de treino progressivo." },
        { valor: "manutencao", titulo: "Manter a forma", icone: "escudo", texto: "Continuar no ritmo atual." },
        { valor: "resistencia", titulo: "Melhorar o condicionamento", icone: "cardio", texto: "Fôlego e capacidade de repetir esforço." },
        { valor: "forca", titulo: "Aumentar a força", icone: "raio", texto: "Cargas altas, poucas repetições." }
      ]
    },
    {
      id: "motivacao",
      tipo: "multipla",
      campo: "motivacoes",
      obrigatorio: false,
      rotuloCurto: "Motivação",
      titulo: "O que mais motiva você?",
      subtitulo: "Pode marcar mais de uma opção. Isso não muda o seu treino, só o contexto do perfil.",
      opcoes: [
        { valor: "aparencia", titulo: "Parecer mais atraente", icone: "corpo" },
        { valor: "forca", titulo: "Ficar mais forte", icone: "halter" },
        { valor: "saude", titulo: "Melhorar minha saúde", icone: "coracao" },
        { valor: "confianca", titulo: "Sentir mais confiança", icone: "escudo" },
        { valor: "energia", titulo: "Ter mais energia", icone: "raio" },
        { valor: "estresse", titulo: "Aliviar o estresse", icone: "folha" }
      ]
    },
    {
      id: "altura",
      tipo: "numero",
      campo: "alturaCm",
      obrigatorio: true,
      rotuloCurto: "Altura",
      titulo: "Qual é a sua altura?",
      subtitulo: "Ajuste com os botões ou digite o valor.",
      conversao: "altura",
      base: 170,
      minimo: F.PERFIL_ALTURA_MIN,
      maximo: F.PERFIL_ALTURA_MAX,
      casas: 0,
      unidades: [
        { id: "cm", rotulo: "cm" },
        { id: "imperial", rotulo: "pés / pol" }
      ],
      dica: "Entre " + F.PERFIL_ALTURA_MIN + " cm e " + F.PERFIL_ALTURA_MAX + " cm.",
      unidadeBase: "cm"
    },
    {
      id: "peso",
      tipo: "numero",
      campo: "pesoKg",
      obrigatorio: true,
      rotuloCurto: "Peso atual",
      titulo: "Qual é o seu peso atual?",
      subtitulo: "Use o valor de hoje. Ele não vira meta nem avaliação.",
      conversao: "peso",
      base: 70,
      minimo: F.PERFIL_PESO_MIN,
      maximo: F.PERFIL_PESO_MAX,
      casas: 1,
      unidades: [
        { id: "kg", rotulo: "kg" },
        { id: "lb", rotulo: "lb" }
      ],
      dica: "Entre " + F.PERFIL_PESO_MIN + " kg e " + F.PERFIL_PESO_MAX + " kg.",
      unidadeBase: "kg"
    },
    {
      id: "pesoAlvo",
      tipo: "numero",
      campo: "pesoAlvoKg",
      obrigatorio: false,
      rotuloCurto: "Peso-alvo",
      titulo: "Qual peso você deseja alcançar?",
      subtitulo: "Opcional. Um objetivo diferente do peso atual, ou nenhum por enquanto.",
      conversao: "peso",
      base: 70,
      minimo: F.PERFIL_PESO_MIN,
      maximo: F.PERFIL_PESO_MAX,
      casas: 1,
      alternativaNula: {
        titulo: "Ainda não defini",
        texto: "Guardar 0 (sem meta de peso). É uma resposta válida."
      },
      unidades: [
        { id: "kg", rotulo: "kg" },
        { id: "lb", rotulo: "lb" }
      ],
      dica: "Sem julgamento: o FORJA não usa esse número para prescrever treino nem dieta.",
      unidadeBase: "kg"
    },
    {
      id: "tipoCorpo",
      tipo: "escolha",
      campo: "tipoCorpo",
      obrigatorio: false,
      rotuloCurto: "Tipo de corpo",
      titulo: "Como você descreveria seu corpo atualmente?",
      subtitulo: "Uma descrição sua, sem nota e sem comparação. Nada é calculado a partir dela.",
      alternativa: { valor: "", titulo: "Prefiro não informar" },
      opcoes: [
        { valor: "mais-magro", titulo: "Mais magro" },
        { valor: "intermediario", titulo: "Intermediário" },
        { valor: "mais-musculoso", titulo: "Mais musculoso" }
      ]
    },
    {
      id: "anoNascimento",
      tipo: "numero",
      campo: "anoNascimento",
      obrigatorio: true,
      rotuloCurto: "Ano de nascimento",
      titulo: "Em que ano você nasceu?",
      subtitulo: "Só o ano, nada de data completa.",
      conversao: null,
      base: ANO_LIMITE - 30,
      minimo: F.PERFIL_ANO_MIN,
      maximo: ANO_LIMITE,
      casas: 0,
      step: 1,
      unidades: [{ id: "ano", rotulo: "ano" }],
      dica: "Entre " + F.PERFIL_ANO_MIN + " e " + ANO_LIMITE + ". Nenhuma idade é exibida no app.",
      unidadeBase: "ano"
    },
    {
      id: "rotina",
      tipo: "escolha",
      campo: "rotinaDiaria",
      obrigatorio: true,
      rotuloCurto: "Rotina diária",
      titulo: "Como é sua rotina diária?",
      subtitulo: "O que você faz na maior parte do dia — sem contar o treino.",
      opcoes: [
        { valor: "sentado", titulo: "Principalmente sentado", icone: "cadeira", texto: "Trabalho ou estudo em mesa." },
        { valor: "em-pe", titulo: "Fico em pé boa parte do dia", icone: "empe", texto: "Loja, atendimento, sala de aula." },
        { valor: "caminho", titulo: "Caminho bastante", icone: "caminhada", texto: "Deslocamentos a pé frequentes." },
        { valor: "esforco-fisico", titulo: "Trabalho com esforço físico", icone: "esforco", texto: "Carrego, levanto ou empurro peso." },
        { valor: "varia", titulo: "Minha rotina varia bastante", icone: "variacao", texto: "Cada dia é diferente." }
      ]
    },
    {
      id: "local",
      tipo: "escolha",
      campo: "localTreino",
      obrigatorio: true,
      rotuloCurto: "Local de treino",
      titulo: "Onde você costuma treinar?",
      subtitulo: "Ajuda a saber o que faz sentido procurar na biblioteca.",
      opcoes: [
        { valor: "casa", titulo: "Em casa", icone: "casa", texto: "Espaço próprio, peso corporal e o que tiver." },
        { valor: "academia", titulo: "Na academia", icone: "academia", texto: "Máquinas, barras e anilhas." },
        { valor: "ar-livre", titulo: "Ao ar livre", icone: "arlivre", texto: "Praça, quadra, parque ou rua." },
        { valor: "casa-academia", titulo: "Em casa e na academia", icone: "combinacao", texto: "Depende do dia." },
        { valor: "sem-local", titulo: "Ainda não tenho um local definido", icone: "semlocal", texto: "Você decide depois." }
      ]
    },
    {
      id: "preferencias",
      tipo: "multipla",
      campo: "preferenciasTreino",
      obrigatorio: true,
      rotuloCurto: "Modalidade",
      titulo: "Que tipo de treino você prefere?",
      subtitulo: "Pode marcar mais de uma. Essa resposta vira o filtro inicial das suas rotinas.",
      exclusiva: "descobrir",
      opcoes: [
        { valor: "musculacao", titulo: "Musculação", icone: "halter" },
        { valor: "calistenia", titulo: "Calistenia", icone: "calistenia" },
        { valor: "funcional", titulo: "Treino funcional", icone: "funcional" },
        { valor: "cardio", titulo: "Cardio", icone: "cardio" },
        { valor: "combinacao", titulo: "Uma combinação de modalidades", icone: "combinacao" },
        { valor: "descobrir", titulo: "Quero descobrir o que funciona para mim", icone: "descoberta" }
      ]
    },
    {
      id: "dias",
      tipo: "escolha",
      campo: "diasPorSemana",
      numerico: true,
      compacto: true,
      obrigatorio: true,
      rotuloCurto: "Frequência",
      titulo: "Quantos dias por semana você quer treinar?",
      subtitulo: "Usado como sugestão de meta semanal. Você continua livre para treinar quando quiser.",
      opcoes: [
        { valor: 1, titulo: "1 dia" },
        { valor: 2, titulo: "2 dias" },
        { valor: 3, titulo: "3 dias" },
        { valor: 4, titulo: "4 dias" },
        { valor: 5, titulo: "5 dias" },
        { valor: 6, titulo: "6 dias" },
        { valor: 7, titulo: "7 dias" },
        { valor: 0, titulo: "Ainda não sei" }
      ]
    },
    {
      id: "nivel",
      tipo: "escolha",
      campo: "nivel",
      obrigatorio: true,
      rotuloCurto: "Experiência",
      titulo: "Qual é o seu nível de experiência?",
      subtitulo: "Serve para você reconhecer o próprio ponto de partida. O FORJA não prescreve carga.",
      alternativa: { valor: "", titulo: "Não tenho certeza" },
      opcoes: [
        { valor: "iniciante", titulo: "Iniciante", icone: "corpo", texto: "Primeiros meses, aprendendo a técnica." },
        { valor: "intermediario", titulo: "Intermediário", icone: "escada", texto: "Treina com certa regularidade." },
        { valor: "avancado", titulo: "Avançado", icone: "trofeu", texto: "Anos de treino consistente." },
        { valor: "voltando", titulo: "Estou voltando a treinar", icone: "relogio", texto: "Já treinou e está retomando agora." }
      ]
    },
    {
      id: "experiencia",
      tipo: "escolha",
      campo: "experienciaFisica",
      obrigatorio: false,
      rotuloCurto: "Capacidade física",
      titulo: "Como você está se sentindo com sua capacidade física?",
      subtitulo: "Responda conforme sua experiência atual.",
      alternativa: { valor: "", titulo: "Prefiro não informar" },
      opcoes: [
        { valor: "comecando", titulo: "Estou começando agora", texto: "Pouca ou nenhuma experiência recente." },
        { valor: "basicos", titulo: "Consigo realizar alguns exercícios básicos", texto: "Flexões, agachamentos, pranchas simples." },
        { valor: "regulares", titulo: "Tenho experiência com treinos regulares", texto: "Já mantive uma rotina por um tempo." },
        { valor: "veterano", titulo: "Já treino há bastante tempo", texto: "Rotina consistente por anos." }
      ]
    },
    {
      id: "consideracoes",
      tipo: "multipla",
      campo: "consideracoes",
      obrigatorio: false,
      rotuloCurto: "Considerações",
      titulo: "Existe algo que devemos considerar no seu treino?",
      subtitulo: "Tratamos isso como preferência de adaptação, não como diagnóstico médico.",
      exclusiva: "nenhuma",
      opcoes: [
        { valor: "nenhuma", titulo: "Nenhuma consideração específica" },
        { valor: "desconfortos", titulo: "Tenho desconfortos que quero levar em conta", icone: "desconforto" },
        { valor: "baixo-impacto", titulo: "Preciso de exercícios de baixo impacto", icone: "impacto" },
        { valor: "adaptar-nivel", titulo: "Quero adaptar os exercícios ao meu nível atual", icone: "ajuste" },
        { valor: "conversar-depois", titulo: "Prefiro conversar sobre isso depois", icone: "conversa" }
      ]
    },
    {
      id: "equipamentos",
      tipo: "multipla",
      campo: "equipamentos",
      obrigatorio: false,
      rotuloCurto: "Equipamentos",
      titulo: "Quais equipamentos você tem disponíveis?",
      subtitulo: "Marque o que você realmente tem acesso. Nada aqui vira obrigação de treino.",
      exclusiva: "nenhum",
      pularRotulo: "Continuar sem equipamentos definidos",
      opcoes: [
        { valor: "nenhum", titulo: "Nenhum equipamento", icone: "corpo" },
        { valor: "halteres", titulo: "Halteres", icone: "halter" },
        { valor: "barra-anilhas", titulo: "Barra e anilhas", icone: "halter" },
        { valor: "elasticos", titulo: "Elásticos", icone: "impacto" },
        { valor: "maquinas", titulo: "Máquinas de musculação", icone: "academia" },
        { valor: "academia-completa", titulo: "Equipamentos de academia completos", icone: "academia" },
        { valor: "outros", titulo: "Outros equipamentos", icone: "ajuste" }
      ]
    },
    {
      id: "flexoes",
      tipo: "escolha",
      campo: "flexoes",
      obrigatorio: false,
      rotuloCurto: "Flexões",
      titulo: "Quantas flexões você consegue fazer seguidas?",
      subtitulo: "Uma estimativa sua, sem teste agora e sem julgamento.",
      opcoes: [
        { valor: "nenhuma", titulo: "Ainda não consigo fazer" },
        { valor: "1-5", titulo: "1–5" },
        { valor: "6-10", titulo: "6–10" },
        { valor: "11-20", titulo: "11–20" },
        { valor: "mais-20", titulo: "Mais de 20" },
        { valor: "", titulo: "Prefiro pular", pular: true }
      ]
    },
    {
      id: "mobilidade",
      tipo: "escolha",
      campo: "mobilidade",
      obrigatorio: false,
      rotuloCurto: "Mobilidade",
      titulo: "Como está sua mobilidade ao se inclinar para a frente?",
      subtitulo: "Não faça nenhum movimento que provoque dor. Responda pelo que você já sabe.",
      opcoes: [
        { valor: "dificuldade", titulo: "Tenho bastante dificuldade" },
        { valor: "pouco", titulo: "Consigo me inclinar um pouco" },
        { valor: "pernas", titulo: "Consigo alcançar as pernas" },
        { valor: "pes", titulo: "Consigo alcançar os pés" },
        { valor: "nao-sei", titulo: "Não sei avaliar" },
        { valor: "", titulo: "Prefiro pular", pular: true }
      ]
    },
    {
      id: "recuperacao",
      tipo: "escolha",
      campo: "recuperacao",
      obrigatorio: false,
      rotuloCurto: "Após esforço",
      titulo: "Como você costuma se sentir após um esforço intenso?",
      subtitulo: "Informação declarada por você. Sem diagnóstico e sem avaliação clínica.",
      opcoes: [
        { valor: "rapida", titulo: "Consigo recuperar meu fôlego rapidamente", icone: "respiracao" },
        { valor: "algum-tempo", titulo: "Preciso de algum tempo para recuperar o fôlego", icone: "relogio" },
        { valor: "muito-cansaco", titulo: "Costumo ficar muito cansado", icone: "folha" },
        { valor: "sem-experiencia", titulo: "Não tenho experiência suficiente para avaliar", icone: "descoberta" },
        { valor: "", titulo: "Prefiro pular", pular: true }
      ]
    },
    {
      id: "recompensa",
      tipo: "escolha",
      campo: "recompensa",
      obrigatorio: false,
      rotuloCurto: "Recompensa",
      titulo: "Como você gostaria de celebrar suas conquistas?",
      subtitulo: "Usado só para escolher o tom das mensagens do app.",
      alternativa: { valor: "", titulo: "Ainda não sei" },
      opcoes: [
        { valor: "evolucao", titulo: "Perceber minha evolução", icone: "grafico" },
        { valor: "metas", titulo: "Completar minhas metas", icone: "alvo" },
        { valor: "desempenho", titulo: "Melhorar meu desempenho", icone: "raio" },
        { valor: "rotina", titulo: "Manter uma rotina consistente", icone: "calendario" },
        { valor: "pequenas-conquistas", titulo: "Celebrar pequenas conquistas", icone: "medalha" }
      ]
    },
    {
      id: "progresso",
      tipo: "escolha",
      campo: "progressoPercebido",
      obrigatorio: false,
      rotuloCurto: "Progresso",
      titulo: "Como você gostaria de perceber sua evolução?",
      subtitulo: "Sem promessa de resultado físico: é sobre o que você quer acompanhar.",
      alternativa: { valor: "", titulo: "Ainda não sei" },
      opcoes: [
        { valor: "forca", titulo: "Acompanhar minha força", icone: "halter" },
        { valor: "resistencia", titulo: "Acompanhar minha resistência", icone: "cardio" },
        { valor: "consistencia", titulo: "Acompanhar a consistência dos treinos", icone: "chama" },
        { valor: "metas", titulo: "Acompanhar minhas metas pessoais", icone: "alvo" },
        { valor: "indicadores", titulo: "Acompanhar diferentes indicadores", icone: "grafico" }
      ]
    },
    {
      id: "revisao",
      tipo: "revisao",
      titulo: "Revise seu perfil",
      subtitulo: "Toque em Editar para mudar qualquer resposta. Só mostramos o que você respondeu."
    },
    {
      id: "final",
      tipo: "final",
      titulo: "Seu perfil está pronto para o próximo passo.",
      subtitulo: "Estas escolhas já estão salvas apenas neste navegador."
    }
  ];

  const TOTAL_PASSOS = PASSOS.length;

  /* Rótulos de reserva (perfil antigo pode ter valor que não está nas opções). */
  const RESERVA = {
    sexo: valor => F.PERFIL_LABELS.sexo[valor] || "Não informado",
    objetivo: valor => F.PERFIL_LABELS.objetivo[valor] || "Não definido",
    nivel: valor => F.PERFIL_LABELS.nivel[valor] || "Não definido",
    equipamento: valor => F.PERFIL_LABELS.equipamento[valor] || "Não definido",
    modalidadePreferida: valor => F.PERFIL_LABELS.modalidade[valor] || "Sem preferência",
    diasPorSemana: valor => (Number(valor) > 0
      ? Number(valor) + (Number(valor) === 1 ? " dia por semana" : " dias por semana")
      : "Ainda não sei"),
    duracaoMinutos: valor => (Number(valor) > 0 ? Number(valor) + " min por sessão" : "Não definido")
  };

  /* Conversões usadas só na tela; o perfil guarda cm e kg. */
  const CM_POR_POLEGADA = 2.54;
  const KG_POR_LIBRA = 0.45359237;

  function cmParaPesPol(cm) {
    const totalPolegadas = Math.round(Number(cm) / CM_POR_POLEGADA);
    return { pes: Math.floor(totalPolegadas / 12), pol: totalPolegadas % 12 };
  }

  function pesPolParaCm(pes, pol) {
    const total = (Number(pes) || 0) * 12 + (Number(pol) || 0);
    return Math.round(total * CM_POR_POLEGADA);
  }

  function kgParaLibra(kg) {
    return Math.round(Number(kg) / KG_POR_LIBRA);
  }

  function libraParaKg(lb) {
    return Math.round(Number(lb) * KG_POR_LIBRA * 10) / 10;
  }

  function formatarNumero(valor, casas) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return "—";
    return casas > 0
      ? numero.toFixed(casas).replace(".", ",")
      : String(Math.round(numero));
  }

  /* Respostas iniciais: perfil salvo inteiro, senão vazio. Nunca um palpite. */
  function respostasDoPerfil(profile) {
    const atual = F.normalizeProfile(profile);
    return F.cloneData(atual);
  }

  function lerRascunho() {
    try {
      const raw = global.sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (!F.isPlainObject(value) || !F.isPlainObject(value.respostas)) return null;

      const indice = Number(value.passo);
      return {
        passo: Number.isInteger(indice) && indice >= 0 && indice < TOTAL_PASSOS ? indice : 0,
        respostas: value.respostas,
        tocados: F.isPlainObject(value.tocados) ? value.tocados : {},
        ui: F.isPlainObject(value.unidades) ? value.unidades : {}
      };
    } catch (error) {
      return null;
    }
  }

  function gravarRascunho(state) {
    /* Depois de salvo o rascunho já foi apagado: não o recria ao navegar. */
    if (state.salvo) return true;
    try {
      global.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        passo: state.passo,
        respostas: state.respostas,
        tocados: state.tocados,
        unidades: state.ui,
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
  /* Apoio de renderização                                               */
  /* ------------------------------------------------------------------ */

  function criar(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function esconderErroVisivel() {
    const erro = F.byId("onboarding-error");
    if (!erro) return;
    erro.textContent = "";
    erro.hidden = true;
  }

  function valorDaOpcao(passo, opcao) {
    return passo.numerico ? Number(opcao.valor) : String(opcao.valor);
  }

  function listaAtual(state, passo) {
    const valor = state.respostas[passo.campo];
    return Array.isArray(valor) ? valor.slice() : [];
  }

  function selecionado(state, passo, opcao) {
    const atual = state.respostas[passo.campo];

    if (passo.tipo === "multipla") {
      return listaAtual(state, passo).indexOf(String(opcao.valor)) !== -1;
    }

    if (passo.numerico) return Number(atual) === Number(opcao.valor);
    return String(atual) === String(opcao.valor);
  }

  /*
    Rótulo legível de uma resposta. Prefere o texto exato que o usuário viu na
    etapa (as opções do próprio passo) e só cai nos rótulos do perfil quando o
    valor veio de um perfil antigo e não está mais entre as opções.
  */
  function rotuloResposta(passo, valor) {
    if (!passo) return String(valor || "Não informado");

    if (passo.tipo === "multipla") {
      const lista = Array.isArray(valor) ? valor : [];
      if (lista.length === 0) return "Não informado";
      return lista
        .map(id => {
          const opcao = (passo.opcoes || []).find(item => String(item.valor) === String(id));
          return opcao ? opcao.titulo : id;
        })
        .join(" · ");
    }

    if (passo.tipo === "numero") return rotuloNumero(passo, valor);

    const opcao = (passo.opcoes || []).find(item => String(item.valor) === String(valor));
    if (opcao) return opcao.titulo;
    if (passo.alternativa && String(passo.alternativa.valor) === String(valor)) {
      return passo.alternativa.titulo;
    }
    if (valor === "" || valor === null || valor === undefined || valor === 0) {
      return "Não informado";
    }

    return RESERVA[passo.campo] ? RESERVA[passo.campo](valor) : String(valor);
  }

  function rotuloNumero(passo, valor) {
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero === 0) return "Não informado";

    if (passo.campo === "alturaCm") {
      const imperial = cmParaPesPol(numero);
      return numero + " cm (" + imperial.pes + "′ " + imperial.pol + "″)";
    }

    if (passo.campo === "pesoKg" || passo.campo === "pesoAlvoKg") {
      const texto = formatarNumero(numero, Number.isInteger(numero) ? 0 : 1) + " kg";
      return passo.campo === "pesoKg"
        ? texto + " (" + kgParaLibra(numero) + " lb)"
        : texto;
    }

    return String(Math.round(numero));
  }

  /* ------------------------------------------------------------------ */
  /* Progresso                                                           */
  /* ------------------------------------------------------------------ */

  function renderProgresso(host, state) {
    host.replaceChildren();

    const atual = state.passo + 1;

    const texto = criar("p", "onboarding-step-count", "ETAPA " + atual + " DE " + TOTAL_PASSOS);
    texto.id = "onboarding-step-count";

    const trilha = criar("div", "onboarding-track");
    trilha.id = "onboarding-progressbar";
    trilha.setAttribute("role", "progressbar");
    trilha.setAttribute("aria-valuemin", "1");
    trilha.setAttribute("aria-valuemax", String(TOTAL_PASSOS));
    trilha.setAttribute("aria-valuenow", String(atual));
    trilha.setAttribute("aria-valuetext", "Etapa " + atual + " de " + TOTAL_PASSOS + ": " + PASSOS[state.passo].titulo);
    trilha.setAttribute("aria-labelledby", "onboarding-step-count");

    const preenchimento = criar("div", "onboarding-track-fill");
    preenchimento.style.width = Math.round((atual / TOTAL_PASSOS) * 100) + "%";
    trilha.appendChild(preenchimento);

    host.append(texto, trilha);
  }

  /* ------------------------------------------------------------------ */
  /* Etapa 1 — cartões com imagem (sexo)                                 */
  /* ------------------------------------------------------------------ */

  function renderImagem(host, state, passo) {
    const grupo = criar("div", "onboarding-cards onboarding-cards--image");
    grupo.setAttribute("role", "radiogroup");
    grupo.setAttribute("aria-labelledby", "onboarding-question");

    passo.opcoes.forEach((opcao, indice) => {
      const cartao = criar("label", "onboarding-image-card");
      cartao.setAttribute("data-value", String(opcao.valor));
      if (selecionado(state, passo, opcao)) cartao.classList.add("is-selected");

      const input = doc.createElement("input");
      input.type = "radio";
      input.name = "onboarding-" + passo.campo;
      input.id = "onboarding-" + passo.campo + "-" + indice;
      input.value = String(opcao.valor);
      input.className = "onboarding-radio-visually-hidden";
      input.checked = selecionado(state, passo, opcao);

      const figura = criar("span", "onboarding-image-frame");
      const imagem = doc.createElement("img");
      imagem.src = opcao.imagem;
      imagem.alt = opcao.alt || "";
      imagem.loading = indice === 0 ? "eager" : "lazy";
      imagem.decoding = "async";
      imagem.width = 720;
      imagem.height = 1080;
      figura.appendChild(imagem);

      const marca = criar("span", "onboarding-select-mark");
      marca.setAttribute("aria-hidden", "true");
      marca.appendChild(icone("check"));

      const rodape = criar("span", "onboarding-image-caption");
      rodape.appendChild(criar("span", "onboarding-image-title", opcao.titulo));
      rodape.appendChild(criar("span", "onboarding-image-hint", "Selecionar"));

      cartao.append(input, figura, marca, rodape);

      input.addEventListener("change", () => {
        state.respostas[passo.campo] = valorDaOpcao(passo, opcao);
        state.tocados[passo.campo] = true;
        gravarRascunho(state);
        grupo.querySelectorAll(".onboarding-image-card").forEach(item => {
          item.classList.toggle("is-selected", item.getAttribute("data-value") === input.value);
        });
        sincronizarAlternativa(grupo, input.value);
        esconderErroVisivel();
        F.ui.announce(opcao.titulo + " selecionado.");
      });

      grupo.appendChild(cartao);
    });

    host.appendChild(grupo);

    if (passo.alternativa) {
      host.appendChild(criarAlternativa(state, passo, grupo, () => esconderErroVisivel()));
    }

    if (passo.nota) host.appendChild(criar("p", "onboarding-note", passo.nota));
  }

  /* Marca/desmarca o rótulo de uma alternativa marcada (valor vazio). */
  function sincronizarAlternativa(grupo, valorRadio) {
    const alternativa = grupo.parentNode.querySelector("[data-onboarding-alternativa]");
    if (!alternativa) return;
    alternativa.classList.toggle("is-selected", valorRadio === "");
  }

  /*
    Alternativa de valor vazio ("Prefiro não informar", "Não tenho certeza",
    "Ainda não sei"). É um rádio do mesmo grupo: continua sendo uma escolha
    explícita, com teclado e leitor de tela nativos.
  */
  function criarAlternativa(state, passo, grupo, aoEscolher) {
    const invólucro = criar("label", "onboarding-alternative");
    invólucro.setAttribute("data-onboarding-alternativa", "1");
    invólucro.setAttribute("data-value", String(passo.alternativa.valor));

    const atual = state.respostas[passo.campo];
    const ativo = String(atual) === String(passo.alternativa.valor);
    if (ativo) invólucro.classList.add("is-selected");

    const input = doc.createElement("input");
    input.type = "radio";
    input.name = "onboarding-" + passo.campo;
    input.id = "onboarding-" + passo.campo + "-alternativa";
    input.value = String(passo.alternativa.valor);
    input.className = "onboarding-radio";
    input.checked = ativo;

    input.addEventListener("change", () => {
      state.respostas[passo.campo] = valorDaOpcao(passo, passo.alternativa);
      state.tocados[passo.campo] = true;
      gravarRascunho(state);
      invólucro.classList.add("is-selected");
      grupo.querySelectorAll(".onboarding-option, .onboarding-image-card").forEach(item => {
        item.classList.remove("is-selected");
      });
      if (aoEscolher) aoEscolher();
      F.ui.announce(passo.alternativa.titulo + " selecionado.");
    });

    const corpo = criar("span", "onboarding-alternative-body");
    corpo.appendChild(criar("span", "onboarding-option-title", passo.alternativa.titulo));
    if (passo.alternativa.texto) {
      corpo.appendChild(criar("span", "onboarding-option-text", passo.alternativa.texto));
    }

    invólucro.append(input, corpo);
    return invólucro;
  }

  /* ------------------------------------------------------------------ */
  /* Etapas de cartões (seleção única e múltipla)                        */
  /* ------------------------------------------------------------------ */

  function renderEscolha(host, state, passo, acoes) {
    const multipla = passo.tipo === "multipla";
    const grupo = criar(
      "div",
      "onboarding-options" +
        (passo.compacto ? " onboarding-options--compact" : "") +
        (multipla ? " onboarding-options--multi" : "")
    );
    grupo.setAttribute("role", multipla ? "group" : "radiogroup");
    grupo.setAttribute("aria-labelledby", "onboarding-question");

    passo.opcoes.forEach((opcao, indice) => {
      if (opcao.pular) return; /* "Prefiro pular": vira link, não cartão de resposta */

      const cartao = criar("label", "onboarding-option");
      cartao.setAttribute("data-value", String(opcao.valor));
      if (selecionado(state, passo, opcao)) cartao.classList.add("is-selected");

      const input = doc.createElement("input");
      input.type = multipla ? "checkbox" : "radio";
      input.name = "onboarding-" + passo.campo;
      input.id = "onboarding-" + passo.campo + "-" + indice;
      input.value = String(opcao.valor);
      input.className = "onboarding-radio";
      input.checked = selecionado(state, passo, opcao);

      input.addEventListener("change", () => {
        if (multipla) {
          aplicarMultipla(state, passo, opcao, grupo, input.checked);
        } else {
          state.respostas[passo.campo] = valorDaOpcao(passo, opcao);
          state.tocados[passo.campo] = true;
          grupo.querySelectorAll(".onboarding-option").forEach(item => {
            item.classList.toggle("is-selected", item.getAttribute("data-value") === input.value);
          });
          if (grupo.parentNode) {
            grupo.parentNode.querySelectorAll("[data-onboarding-alternativa]").forEach(item => {
              item.classList.remove("is-selected");
            });
          }
        }
        gravarRascunho(state);
        esconderErroVisivel();
        F.ui.announce((multipla ? (input.checked ? "Marcado: " : "Desmarcado: ") : "") + opcao.titulo);
      });

      const corpo = criar("span", "onboarding-option-body");
      const linha = criar("span", "onboarding-option-head");
      if (opcao.icone) linha.appendChild(icone(opcao.icone));
      linha.appendChild(criar("span", "onboarding-option-title", opcao.titulo));
      corpo.appendChild(linha);
      if (opcao.texto) corpo.appendChild(criar("span", "onboarding-option-text", opcao.texto));

      cartao.append(input, corpo);
      grupo.appendChild(cartao);
    });

    host.appendChild(grupo);

    /* Alternativa explícita de valor vazio ("Prefiro não informar"). */
    if (passo.alternativa && !multipla) {
      const invólucro = criar("div", "onboarding-alternative-wrap");
      invólucro.appendChild(criarAlternativa(state, passo, grupo, () => esconderErroVisivel()));
      host.appendChild(invólucro);
    }

    /* Link "Prefiro pular" para etapas opcionais com opção explícita. */
    const opcaoPular = passo.opcoes.find(opcao => opcao.pular);
    if (opcaoPular) {
      const pular = criar("button", "onboarding-inline-skip", opcaoPular.titulo);
      pular.type = "button";
      pular.id = "onboarding-pular-avaliacao";
      pular.addEventListener("click", () => {
        /* Pular deixa o campo como estava: nenhuma resposta inventada. */
        gravarRascunho(state);
        if (acoes && acoes.proximo) acoes.proximo();
      });
      host.appendChild(pular);
    }
  }

  function aplicarMultipla(state, passo, opcao, grupo, marcado) {
    const atual = listaAtual(state, passo);
    const valor = String(opcao.valor);
    let lista = atual.filter(item => item !== valor);

    if (marcado) {
      /* "Nenhum equipamento" e "Nenhuma consideração" não convivem com o resto. */
      if (passo.exclusiva === valor) lista = [];
      else if (passo.exclusiva) lista = lista.filter(item => item !== passo.exclusiva);
      lista.push(valor);
    }

    state.respostas[passo.campo] = lista;
    state.tocados[passo.campo] = true;

    grupo.querySelectorAll(".onboarding-option").forEach(item => {
      const valorItem = item.getAttribute("data-value");
      const input = item.querySelector("input");
      const ativo = lista.indexOf(valorItem) !== -1;
      item.classList.toggle("is-selected", ativo);
      if (input) input.checked = ativo;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Etapas numéricas (altura, peso, peso-alvo e ano)                    */
  /* ------------------------------------------------------------------ */
  /*
    Um único controle para todas as medidas. Regras:

    - o perfil guarda SEMPRE a unidade-base (cm para altura, kg para peso);
      a unidade escolhida na tela é só de exibição e digitação;
    - o visor grande mostra o valor atual (ou "—" quando não há resposta);
      os botões − / + partem de um valor-base plausível quando o campo está
      vazio, para o usuário não precisar digitar do zero;
    - digitar continua possível em um campo normal, sem teclado minúsculo;
    - valor fora da faixa plausível não é "corrigido" nem gravado: a tela
      avisa e o avanço fica bloqueado;
    - o editor é construído uma vez e apenas sincronizado nas digitações, para
      o cursor não pular enquanto a pessoa digita.
  */
  function renderNumero(host, state, passo) {
    const ui = state.ui[passo.id] || (state.ui[passo.id] = {
      unidade: passo.unidades[0].id,
      erro: ""
    });

    const caixa = criar("div", "onboarding-measure");

    const visor = criar("div", "onboarding-measure-display");
    const valorSaida = criar("output", "onboarding-measure-value");
    valorSaida.id = "onboarding-measure-value";
    valorSaida.setAttribute("aria-live", "polite");
    const unidadeSaida = criar("span", "onboarding-measure-unit");
    visor.append(valorSaida, unidadeSaida);
    caixa.appendChild(visor);

    const editor = criar("div", "onboarding-measure-editor");
    caixa.appendChild(editor);

    const unidades = criar("div", "onboarding-units");
    const botoesUnidade = [];
    if (passo.unidades.length > 1) {
      unidades.setAttribute("role", "group");
      unidades.setAttribute("aria-label", "Unidade de medida");
      passo.unidades.forEach(item => {
        const botao = criar("button", "onboarding-unit", item.rotulo);
        botao.type = "button";
        botao.setAttribute("data-unit", item.id);
        botao.addEventListener("click", () => trocarUnidade(item.id));
        botoesUnidade.push(botao);
        unidades.appendChild(botao);
      });
      caixa.appendChild(unidades);
    }

    const feedback = criar("p", "onboarding-measure-feedback");
    feedback.id = "onboarding-measure-feedback";
    feedback.setAttribute("role", "status");
    feedback.hidden = true;
    caixa.appendChild(feedback);

    if (passo.dica) caixa.appendChild(criar("p", "onboarding-measure-hint", passo.dica));

    let botaoNulo = null;
    if (passo.alternativaNula) {
      const blocoNulo = criar("div", "onboarding-measure-null");
      botaoNulo = criar("button", "onboarding-inline-skip", passo.alternativaNula.titulo);
      botaoNulo.type = "button";
      botaoNulo.addEventListener("click", () => {
        state.respostas[passo.campo] = 0;
        state.tocados[passo.campo] = true;
        ui.erro = "";
        gravarRascunho(state);
        sincronizar();
        esconderErroVisivel();
        F.ui.announce(passo.alternativaNula.titulo + " selecionado.");
      });
      blocoNulo.append(botaoNulo, criar("p", "onboarding-note", passo.alternativaNula.texto));
      caixa.appendChild(blocoNulo);
    }

    let campos = null;

    function valorAtual() {
      const numero = Number(state.respostas[passo.campo]);
      return Number.isFinite(numero) ? numero : 0;
    }

    function dentroDaFaixa(numero) {
      return numero >= passo.minimo && numero <= passo.maximo;
    }

    function gravar(numero) {
      if (!Number.isFinite(numero)) {
        state.respostas[passo.campo] = 0;
        ui.erro = "";
        sincronizar();
        return;
      }

      if (numero !== 0 && !dentroDaFaixa(numero)) {
        /* Fora da faixa: mostra o que foi digitado e explica, sem gravar. */
        state.respostas[passo.campo] = numero;
        ui.erro = passo.dica || "Valor fora do intervalo.";
        sincronizar();
        return;
      }

      const arredondado = passo.casas > 0
        ? Math.round(numero * 10) / 10
        : Math.round(numero);

      state.respostas[passo.campo] = arredondado > 0 ? arredondado : 0;
      state.tocados[passo.campo] = true;
      ui.erro = "";
      gravarRascunho(state);
      sincronizar();
    }

    function incrementar(direcao) {
      const referencia = valorAtual();
      const base = referencia > 0 ? referencia : passo.base;

      /* Campo vazio: o primeiro toque mostra o valor-base, não base ± 1. */
      if (!referencia) {
        gravar(base);
        return;
      }

      if (passo.conversao === "altura" && ui.unidade === "imperial") {
        gravar(Math.round((referencia > 0 ? referencia : base) + direcao * CM_POR_POLEGADA));
        return;
      }

      if (passo.conversao === "peso" && ui.unidade === "lb") {
        const atualLb = referencia > 0 ? kgParaLibra(referencia) : kgParaLibra(base);
        gravar(libraParaKg(atualLb + direcao));
        return;
      }

      if (passo.campo === "anoNascimento" || passo.campo === "alturaCm") {
        gravar(referencia + direcao);
        return;
      }

      gravar(referencia + direcao * 0.5);
    }

    function criarCampoNumero(id, rotulo, texto) {
      const input = doc.createElement("input");
      input.type = "number";
      input.id = id;
      input.className = "onboarding-number-input";
      input.autocomplete = "off";
      input.step = passo.campo === "anoNascimento" || passo.campo === "alturaCm" ? "1" : "0.5";
      input.min = String(passo.minimo);
      input.max = String(passo.maximo);
      input.setAttribute("aria-label", rotulo);
      input.value = texto;
      return input;
    }

    function montarStepper() {
      const linha = criar("div", "onboarding-stepper");

      const menos = criar("button", "onboarding-step-button", "−");
      menos.type = "button";
      menos.setAttribute("aria-label", "Diminuir " + (passo.rotuloCurto || "").toLowerCase());
      menos.addEventListener("click", () => incrementar(-1));

      const mais = criar("button", "onboarding-step-button", "+");
      mais.type = "button";
      mais.setAttribute("aria-label", "Aumentar " + (passo.rotuloCurto || "").toLowerCase());
      mais.addEventListener("click", () => incrementar(1));

      const grupo = criar("div", "onboarding-stepper-fields");
      const numero = valorAtual();

      if (passo.conversao === "altura" && ui.unidade === "imperial") {
        const imperial = cmParaPesPol(numero);
        const pes = criarCampoNumero("onboarding-number", "Altura em pés", numero ? String(imperial.pes) : "");
        const pol = criarCampoNumero("onboarding-polegadas", "Altura em polegadas", numero ? String(imperial.pol) : "");

        pes.addEventListener("input", () => {
          if (pes.value === "" && pol.value === "") { gravar(0); return; }
          gravar(pesPolParaCm(pes.value, pol.value));
        });
        pol.addEventListener("input", () => {
          if (pes.value === "" && pol.value === "") { gravar(0); return; }
          gravar(pesPolParaCm(pes.value, pol.value));
        });

        grupo.append(
          criarCampoRotulado("Pés", pes),
          criarCampoRotulado("Polegadas", pol)
        );
        campos = { pes, pol };
      } else {
        const emLibra = passo.conversao === "peso" && ui.unidade === "lb";
        const texto = !numero ? "" : emLibra ? String(kgParaLibra(numero)) : String(numero);
        const input = criarCampoNumero(
          "onboarding-number",
          (passo.rotuloCurto || "Valor") + " em " + ui.unidade,
          texto
        );
        input.inputMode = passo.campo === "anoNascimento" ? "numeric" : "decimal";

        input.addEventListener("input", () => {
          if (input.value === "") { gravar(0); return; }
          const digitado = Number(String(input.value).replace(",", "."));
          gravar(emLibra ? libraParaKg(digitado) : digitado);
        });

        grupo.appendChild(criarCampoRotulado(passo.rotuloCurto, input));
        campos = { input };
      }

      linha.append(menos, grupo, mais);
      return linha;
    }

    function criarCampoRotulado(rotulo, input) {
      const caixaCampo = criar("label", "onboarding-field");
      caixaCampo.appendChild(criar("span", "onboarding-field-label", rotulo));
      caixaCampo.appendChild(input);
      return caixaCampo;
    }

    function trocarUnidade(novaUnidade) {
      if (ui.unidade === novaUnidade) return;
      ui.unidade = novaUnidade;
      ui.erro = "";
      editor.replaceChildren(montarStepper());
      sincronizar();
      F.ui.announce("Unidade: " + novaUnidade);
    }

    function sincronizarCampos() {
      const numero = valorAtual();
      if (!campos) return;

      if (campos.pes) {
        const imperial = cmParaPesPol(numero);
        if (doc.activeElement !== campos.pes) campos.pes.value = numero ? String(imperial.pes) : "";
        if (doc.activeElement !== campos.pol) campos.pol.value = numero ? String(imperial.pol) : "";
        return;
      }

      if (doc.activeElement === campos.input) return;
      if (!numero) { campos.input.value = ""; return; }
      campos.input.value = passo.conversao === "peso" && ui.unidade === "lb"
        ? String(kgParaLibra(numero))
        : String(numero);
    }

    function sincronizarVisor() {
      const numero = valorAtual();
      const vazio = !numero;

      if (passo.conversao === "altura" && ui.unidade === "imperial") {
        const imperial = cmParaPesPol(numero);
        valorSaida.textContent = vazio
          ? "—"
          : imperial.pes + "′ " + String(imperial.pol).padStart(2, "0") + "″";
        unidadeSaida.textContent = "pés · polegadas";
        return;
      }

      if (passo.conversao === "peso" && ui.unidade === "lb") {
        valorSaida.textContent = vazio ? "—" : String(kgParaLibra(numero));
        unidadeSaida.textContent = "lb";
        return;
      }

      if (passo.campo === "alturaCm") {
        valorSaida.textContent = vazio ? "—" : String(Math.round(numero));
        unidadeSaida.textContent = "cm";
        return;
      }

      if (passo.campo === "anoNascimento") {
        valorSaida.textContent = vazio ? "—" : String(Math.round(numero));
        unidadeSaida.textContent = "ano";
        return;
      }

      valorSaida.textContent = vazio ? "—" : formatarNumero(numero, numero % 1 === 0 ? 0 : 1);
      unidadeSaida.textContent = "kg";
    }

    function sincronizar() {
      sincronizarVisor();
      sincronizarCampos();

      feedback.textContent = ui.erro || "";
      feedback.hidden = !ui.erro;

      botoesUnidade.forEach(botao => {
        const ativo = botao.getAttribute("data-unit") === ui.unidade;
        botao.setAttribute("aria-pressed", String(ativo));
        botao.classList.toggle("is-selected", ativo);
      });

      if (botaoNulo) {
        const semMeta = valorAtual() === 0;
        botaoNulo.setAttribute("aria-pressed", String(semMeta));
        botaoNulo.classList.toggle("is-selected", semMeta);
      }
    }

    host.appendChild(caixa);
    editor.appendChild(montarStepper());
    sincronizar();
  }
  /* ------------------------------------------------------------------ */
  /* Revisão                                                             */
  /* ------------------------------------------------------------------ */

  const PASSOS_COM_RESPOSTA = PASSOS.filter(passo => passo.campo);

  function renderRevisao(host, state, acoes) {
    const lista = criar("dl", "onboarding-review");
    let respostas = 0;

    PASSOS.forEach((passo, indice) => {
      if (!passo.campo) return;

      const valor = state.respostas[passo.campo];
      const vazio = passo.tipo === "multipla"
        ? !Array.isArray(valor) || valor.length === 0
        : valor === "" || valor === 0 || valor === null || valor === undefined;

      if (vazio) return;
      respostas += 1;

      const linha = criar("div", "onboarding-review-row");
      const nomeCurto = passo.rotuloCurto || passo.titulo.replace(/\?$/, "");
      linha.appendChild(criar("dt", "onboarding-review-term", nomeCurto));
      linha.appendChild(criar("dd", "onboarding-review-value", rotuloResposta(passo, valor)));

      const editar = criar("button", "onboarding-edit", "Editar");
      editar.type = "button";
      editar.setAttribute("data-step", String(indice));
      editar.setAttribute("aria-label", "Editar " + nomeCurto.toLowerCase());
      editar.addEventListener("click", () => acoes.irPara(indice));
      linha.appendChild(editar);

      lista.appendChild(linha);
    });

    host.appendChild(lista);

    if (respostas === 0) {
      host.appendChild(criar(
        "p",
        "onboarding-note",
        "Você ainda não respondeu nenhuma etapa. Volte para preencher ou continue assim mesmo."
      ));
    }

    /* Metas semanais: sugestão explícita, nunca gravação silenciosa. */
    const sugestao = acoes.sugestaoMetas();
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

    host.appendChild(criar(
      "p",
      "onboarding-note",
      "Ao continuar, o perfil é gravado apenas neste navegador. Você pode alterar tudo depois em Perfil."
    ));
  }

  /* ------------------------------------------------------------------ */
  /* Etapa final — preparação do plano                                   */
  /* ------------------------------------------------------------------ */

  function renderFinal(host, state) {
    const cartoes = criar("div", "onboarding-summary");

    const objetivo = rotuloResposta(PASSOS.find(passo => passo.campo === "objetivo"), state.respostas.objetivo);
    const modalidade = rotuloResposta(PASSOS.find(passo => passo.campo === "preferenciasTreino"), state.respostas.preferenciasTreino);
    const dias = rotuloResposta(PASSOS.find(passo => passo.campo === "diasPorSemana"), state.respostas.diasPorSemana);
    const equipamento = rotuloResposta(PASSOS.find(passo => passo.campo === "equipamentos"), state.respostas.equipamentos);
    const local = rotuloResposta(PASSOS.find(passo => passo.campo === "localTreino"), state.respostas.localTreino);

    [
      { rotulo: "Objetivo", valor: objetivo, icone: "alvo" },
      { rotulo: "Preferência de treino", valor: modalidade, icone: "halter" },
      { rotulo: "Frequência pretendida", valor: dias, icone: "calendario" },
      { rotulo: "Disponibilidade", valor: equipamento, icone: "funcional" },
      { rotulo: "Onde treina", valor: local, icone: "casa" }
    ].forEach(item => {
      if (!item.valor || item.valor === "Não informado") return;
      const cartao = criar("div", "onboarding-summary-card");
      cartao.appendChild(icone(item.icone));
      const texto = criar("div", "onboarding-summary-text");
      texto.appendChild(criar("span", "onboarding-summary-label", item.rotulo));
      texto.appendChild(criar("strong", "onboarding-summary-value", item.valor));
      cartao.appendChild(texto);
      cartoes.appendChild(cartao);
    });

    host.appendChild(cartoes);

    host.appendChild(criar(
      "p",
      "onboarding-note",
      "O FORJA não monta um plano automaticamente: você escolhe uma rotina pronta ou cria a sua, " +
        "e o app acompanha o que você treinou. Nada foi calculado nesta etapa além de gravar o seu perfil."
    ));

    const atalhos = criar("div", "onboarding-final-links");
    const rotinas = criar("a", "secondary-button", "Ver rotinas");
    rotinas.href = F.url("treino");
    rotinas.setAttribute("data-onboarding-final-link", "rotinas");
    atalhos.appendChild(rotinas);

    const perfil = criar("a", "secondary-button", "Revisar perfil depois");
    perfil.href = F.url("onboarding") + "?refazer=1";
    perfil.setAttribute("data-onboarding-final-link", "perfil");
    atalhos.appendChild(perfil);

    host.appendChild(atalhos);
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
    const pularEtapa = F.byId("onboarding-skip-step");
    const acoesHost = F.byId("onboarding-actions");

    if (!shell || !stepHost || !form || !avancar) return;

    const rascunho = lerRascunho();
    const state = {
      passo: rascunho ? rascunho.passo : 0,
      respostas: Object.assign(
        respostasDoPerfil(F.state.profile),
        rascunho ? rascunho.respostas : {}
      ),
      tocados: rascunho ? rascunho.tocados : {},
      ui: rascunho && F.isPlainObject(rascunho.ui) ? rascunho.ui : {}
    };

    /* Respostas fora do vocabulário do perfil não entram no fluxo. */
    state.respostas = F.normalizeProfile(state.respostas);

    /* Quem já configurou o perfil e abre a página direto começa revisando. */
    if (!rascunho && F.profileIsConfigured(F.state.profile) && !documentoQuerRefazer()) {
      state.passo = PASSOS.findIndex(passo => passo.tipo === "revisao");
    }

    function documentoQuerRefazer() {
      const busca = (global.location && global.location.search) || "";
      return /(\?|&)refazer=1(&|$)/.test(busca);
    }

    function mostrarErro(mensagem) {
      if (!erro) return;
      erro.textContent = mensagem;
      erro.hidden = false;
      F.ui.announce(mensagem);
    }

    /* Mantém o topo da etapa visível sem brigar com a barra inferior fixa. */
    function revelarEtapa() {
      if (typeof shell.scrollIntoView !== "function") return;
      try {
        shell.scrollIntoView({ behavior: "instant", block: "start" });
      } catch (error) {
        try { global.scrollTo(0, 0); } catch (ignorado) { /* sem rolagem programática */ }
      }
    }

    function irPara(indice) {
      state.passo = Math.max(0, Math.min(TOTAL_PASSOS - 1, indice));
      gravarRascunho(state);
      render();
      const alvo = stepHost.querySelector("#onboarding-question");
      if (alvo && typeof alvo.focus === "function") alvo.focus({ preventScroll: true });
      revelarEtapa();
    }

    /* --------------------------- validação --------------------------- */

    function numeroValido(passo, valor) {
      const numero = Number(valor);
      if (!passo.obrigatorio && (!Number.isFinite(numero) || numero === 0)) return true;
      return Number.isFinite(numero) && numero >= passo.minimo && numero <= passo.maximo;
    }

    function podeAvancar() {
      const passo = PASSOS[state.passo];
      if (!passo.campo) return true;

      if (passo.tipo === "numero") return numeroValido(passo, state.respostas[passo.campo]);
      if (passo.tipo === "multipla") {
        if (!passo.obrigatorio) return true;
        return listaAtual(state, passo).length > 0;
      }

      if (!passo.obrigatorio) return true;
      return Boolean(state.tocados[passo.campo]);
    }

    function mensagemDeErro(passo) {
      if (passo.tipo === "numero") {
        return "Informe " + (passo.rotuloCurto || "um valor").toLowerCase() +
          " entre " + passo.minimo + " e " + passo.maximo + ".";
      }
      if (passo.tipo === "multipla") return "Marque pelo menos uma opção para continuar.";
      return "Escolha uma opção para continuar. Se preferir não responder, use \"" +
        ((passo.alternativa && passo.alternativa.titulo) || "Pular esta etapa") + "\".";
    }

    /* --------------------------- gravação --------------------------- */

    /*
      Traduz as respostas novas para os campos antigos que o resto do app lê.
      A tradução é explícita e só acontece quando a pessoa respondeu:
      - lista de equipamentos → `equipamento` (único campo já existente)
      - preferências de treino → `modalidadePreferida` (filtro de rotinas)
      Nenhum outro campo antigo é recalculado.
    */
    function patchDoPerfil() {
      const patch = { onboardingConcluidoEm: new Date().toISOString() };

      PASSOS_COM_RESPOSTA.forEach(passo => {
        patch[passo.campo] = state.respostas[passo.campo];
      });

      if (listaAtual(state, PASSOS.find(passo => passo.campo === "equipamentos")).length > 0) {
        patch.equipamento = F.deriveEquipamento(state.respostas.equipamentos);
      } else {
        delete patch.equipamento;
      }

      patch.modalidadePreferida = F.deriveModalidadePreferida(
        state.respostas.preferenciasTreino,
        state.respostas.modalidadePreferida
      );

      return patch;
    }

    function sugestaoDeMetas() {
      return F.profileGoalSuggestion(Object.assign({}, state.respostas, {
        modalidadePreferida: F.deriveModalidadePreferida(
          state.respostas.preferenciasTreino,
          state.respostas.modalidadePreferida
        )
      }));
    }

    function concluir() {
      if (avancar.disabled) return;
      avancar.disabled = true;

      if (!F.saveProfile(patchDoPerfil())) {
        avancar.disabled = false;
        mostrarErro("Não foi possível salvar o perfil neste navegador. " +
          "Suas respostas continuam nesta aba: verifique o espaço disponível e tente de novo.");
        F.showToast("O perfil não foi salvo. Nenhuma resposta foi perdida.", "error", 6000);
        return;
      }

      state.respostas = F.cloneData(F.state.profile);
      limparDispensa();
      apagarRascunho();

      const caixa = stepHost.querySelector("#onboarding-goals");
      let metasSalvas = true;

      if (caixa && caixa.checked) {
        const sugestao = sugestaoDeMetas();
        if (sugestao) {
          metasSalvas = F.saveGoals({
            modality: sugestao.modality,
            weeklySessions: sugestao.weeklySessions,
            weeklyMinutes: sugestao.weeklyMinutes
          });
        }
      }

      /* A confirmação aparece na próxima página (Home), depois de "Entrar". */
      F.flash(
        metasSalvas
          ? "Cadastro concluído. Seu perfil está salvo neste aparelho."
          : "Perfil salvo. As metas semanais não puderam ser criadas — configure em Progresso.",
        metasSalvas ? "info" : "error"
      );

      state.salvo = true;
      irPara(TOTAL_PASSOS - 1);
    }

    /* --------------------------- render --------------------------- */

    function render() {
      const passo = PASSOS[state.passo];
      stepHost.replaceChildren();

      const titulo = criar("h1", "onboarding-title", passo.titulo);
      titulo.id = "onboarding-question";
      titulo.tabIndex = -1;
      stepHost.appendChild(titulo);

      if (passo.subtitulo) {
        const descricao = criar("p", "onboarding-description", passo.subtitulo);
        descricao.id = "onboarding-question-description";
        stepHost.appendChild(descricao);
      }

      if (passo.tipo === "imagem") renderImagem(stepHost, state, passo);
      if (passo.tipo === "escolha" || passo.tipo === "multipla") {
        renderEscolha(stepHost, state, passo, { proximo: () => irPara(state.passo + 1) });
      }
      if (passo.tipo === "numero") renderNumero(stepHost, state, passo);
      if (passo.tipo === "revisao") {
        renderRevisao(stepHost, state, {
          irPara: indice => irPara(indice),
          sugestaoMetas: sugestaoDeMetas
        });
      }
      if (passo.tipo === "final") renderFinal(stepHost, state);

      renderProgresso(progressHost, state);

      const ultimo = state.passo === TOTAL_PASSOS - 1;
      avancar.disabled = false;
      avancar.textContent = passo.tipo === "final"
        ? "Entrar no FORJA"
        : "Continuar";

      voltar.hidden = state.passo === 0;
      voltar.disabled = state.passo === 0;

      const opcional = !passo.obrigatorio && passo.campo && passo.tipo !== "numero";
      const comPularProprio = Boolean(passo.opcoes && passo.opcoes.some(opcao => opcao.pular));
      if (pularEtapa) {
        pularEtapa.hidden = !opcional || comPularProprio;
        pularEtapa.textContent = passo.pularRotulo || "Pular esta etapa";
      }

      if (sair) sair.hidden = ultimo;

      const shellAnterior = shell.getAttribute("data-step");
      shell.setAttribute("data-step", passo.id);
      stepHost.classList.remove("is-entering");
      if (shellAnterior) {
        /* Reinicia a animação de entrada a cada troca de etapa. */
        void stepHost.offsetWidth;
        stepHost.classList.add("is-entering");
      }

      esconderErroVisivel();
      F.ui.announce("Etapa " + (state.passo + 1) + " de " + TOTAL_PASSOS + ": " + passo.titulo);
    }

    /* --------------------------- eventos --------------------------- */

    form.addEventListener("submit", event => {
      event.preventDefault();

      const passo = PASSOS[state.passo];

      if (passo.tipo === "final") {
        F.navigate(F.url("inicio"));
        return;
      }

      if (passo.tipo === "revisao") {
        concluir();
        return;
      }

      if (!podeAvancar()) {
        mostrarErro(mensagemDeErro(passo));
        const primeiro = stepHost.querySelector(
          'input[type="radio"], input[type="checkbox"], input[type="number"]'
        );
        if (primeiro && typeof primeiro.focus === "function") primeiro.focus({ preventScroll: true });
        return;
      }

      irPara(state.passo + 1);
    });

    if (voltar) {
      voltar.addEventListener("click", () => irPara(state.passo - 1));
    }

    if (pularEtapa) {
      pularEtapa.addEventListener("click", () => {
        /*
          Pular não inventa nem apaga resposta: o campo fica exatamente como
          estava (vazio ou herdado do perfil salvo). A diferença é só que a
          etapa não bloqueia o avanço.
        */
        gravarRascunho(state);
        irPara(state.passo + 1);
      });
    }

    if (acoesHost) {
      /* Mantém a barra de ações sempre acima da navegação inferior. */
      acoesHost.style.setProperty("--onboarding-actions-bottom",
        "calc(var(--bottom-nav-height, 69px) + env(safe-area-inset-bottom, 0px) + 8px)");
    }

    render();
    revelarEtapa();

    let larguraAnterior = global.innerWidth;
    global.addEventListener("resize", () => {
      if (global.innerWidth === larguraAnterior) return;
      larguraAnterior = global.innerWidth;
    });
  };

  F.onboarding = {
    DRAFT_KEY,
    PASSOS,
    TOTAL_PASSOS,
    marcarDispensado,
    foiDispensado,
    limparDispensa,
    lerRascunho,
    apagarRascunho,
    imagemDoSexo: valor => IMAGENS[valor] || ""
  };
})(window);
