/*
  FORJA — onboarding: personalização completa do perfil, uma pergunta por tela.

  Página: onboarding/index.html (data-page="onboarding").

  Regras que valem para tudo aqui:

  - Nada é gravado no armazenamento do FORJA até o último passo ("Entrar no
    FORJA", na tela de preparação). Antes disso, as respostas ficam só em
    memória e num rascunho de `sessionStorage` (que morre com a aba e nunca
    entra em backup).
  - A única gravação do perfil é `F.saveProfile` (uma escrita atômica na chave
    `forja-perfil-v1`). Se o navegador recusar, a tela mostra o erro e mantém o
    rascunho: nenhuma resposta é perdida em silêncio.
  - Cada etapa é um objeto de `PASSOS`: identificador, pergunta, subtítulo,
    tipo de controle, opções, obrigatoriedade e faixa de validação. O motor
    (render, navegação, progresso, revisão) é único — não há 24 páginas.
  - As respostas novas vivem nos campos v3 do mesmo perfil (ver
    `normalizeProfile` em forja-dados.js). Campos clássicos continuam sendo a
    fonte do que o app já usa: `sexo`, `objetivo`, `nivel`, `diasPorSemana`,
    `equipamento`, `modalidadePreferida`. Os dois últimos são derivados de
    forma explícita e determinística das perguntas detalhadas
    (`derivarEquipamento`, `derivarModalidade`) — nunca um cálculo escondido.
  - Altura, peso e ano são guardados exatamente como declarados, em unidade
    canônica (cm, kg, ano). Nenhum IMC, idade ou meta é calculado nem exibido.
  - O sexo informado só escolhe o personagem das demonstrações no futuro. Não
    altera treino, histórico, carga ou objetivo.
  - Pergunta pulada (opção "Prefiro pular" ou botão de pular de uma etapa
    opcional) não entra no patch final: concluir sem responder preserva o que
    já estava salvo, em vez de apagar.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const DRAFT_KEY = "forja-onboarding-rascunho-v1";
  /* O rascunho ganhou campos novos (pulos, unidades). Rascunho da versão
     antiga é aproveitado só nas respostas, recomeçando da primeira etapa. */
  const DRAFT_VERSION = 2;
  const ANO_ATUAL = new Date().getFullYear();

  /* Ícones de linha do próprio FORJA (SVG inline, sem arquivo externo). */
  const svg = corpo => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    corpo + "</svg>";
  const ICONES = {
    corpo: svg('<circle cx="12" cy="5" r="2.2"/><path d="M12 8v5M5 10h14M12 13l-3 7M12 13l3 7"/>'),
    halter: svg('<path d="M6 6.5v11M18 6.5v11M3 9.5v5M21 9.5v5M6 12h12"/>'),
    escudo: svg('<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3Z"/>'),
    abdomen: svg('<rect x="7" y="4" width="10" height="16" rx="4"/><path d="M12 4v16M7 10h10M7 15h10"/>'),
    pernas: svg('<path d="M8 3c0 5-1 9-2 13l-1 4M16 3c0 5 1 9 2 13l1 4M8 3h8"/>'),
    descer: svg('<path d="M4 6l5 5 4-3 7 7"/><path d="M20 10v5h-5"/>'),
    manter: svg('<circle cx="12" cy="8" r="3"/><path d="M5 20c1.5-3 4-4.5 7-4.5S17.5 17 19 20"/>'),
    coracao: svg('<path d="M12 20s-7-4.3-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.7-9 9-9 9Z"/>'),
    raio: svg('<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8Z"/>'),
    estrela: svg('<path d="M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1-5.5-2.9L6.5 20l1-6.1L3 9.5l6.3-.9L12 3Z"/>'),
    folha: svg('<path d="M5 19C5 10 12 4 20 4c0 8-5 14-13 14M5 19c3-6 7-10 11-12"/>'),
    casa: svg('<path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V9.5Z"/><path d="M9 21V11h6v10"/>'),
    predio: svg('<rect x="5" y="4" width="14" height="17" rx="1"/><path d="M9 21v-4h6v4M9 8h2M13 8h2M9 12h2M13 12h2"/>'),
    troca: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
    pin: svg('<path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10Z"/><circle cx="12" cy="11" r="2"/>'),
    ajuda: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5A2.5 2.5 0 1 1 12 12v1"/><path d="M12 17h.01"/>'),
    grafico: svg('<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>'),
    trofeu: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 5H5a3 3 0 0 0 3 4M16 5h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4"/>'),
    check: svg('<path d="M5 12l5 5 9-10"/>'),
    sentado: svg('<circle cx="10" cy="4" r="1.8"/><path d="M10 7v5h6l2 7M10 12l-1 8"/>'),
    caminhar: svg('<circle cx="13" cy="4" r="1.8"/><path d="M13 7l-2 5 3 3 1 6M11 12l-3 3-2 5M11 9l-4 2"/>'),
    chama: svg('<path d="M12 3c2 4-3 5-1 8 1.2 1.8 4 1 4-2 2.5 2.5 3 6 .5 9.5C13.5 21 8 21 6 17.5 4 14 7 8 12 3Z"/>'),
    flexao: svg('<circle cx="6" cy="6" r="1.8"/><path d="M7 9l7 4-2 5M14 13l6-1M3 20h18"/>'),
    arco: svg('<path d="M4 20a9 9 0 0 1 16 0"/><path d="M12 11l4-4M4 20h16"/>'),
    vento: svg('<path d="M3 8h10a3 3 0 1 0-3-3M2 13h14a3 3 0 1 1-3 3M4 18h7"/>'),
    bandeira: svg('<path d="M5 21V4"/><path d="M5 5h12l-3 4 3 4H5"/>'),
    repetir: svg('<path d="M20 12a8 8 0 1 1-2.3-5.6M20 3v4h-4"/>'),
    relogio: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    alvo: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>'),
    voltarSeta: svg('<path d="M9 6l-5 6 5 6M4 12h10a6 6 0 0 1 0 12h-3"/>'),
    interrogar: svg('<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20"/>')
  };

  /*
    Etapas do fluxo (22 perguntas + revisão + preparação = 24 telas).

    campo      Campo do perfil alimentado pela etapa.
    tipo       "foto" (cartões com imagem), "escolha" (uma opção), "multipla"
               (várias), "numero" (seletor numérico), "revisao", "preparacao".
    obrigatorio Exige resposta válida para avançar.
    opcional   Pode ser pulada (botão `pularRotulo` ou opção com `pular: true`).
    alternativa (número opcional) Resposta explícita de "sem valor", ex.:
               "Ainda não defini" no peso-alvo — diferente de pular, porque
               ela é gravada como ausência de meta.
  */
  const PASSOS = [
    {
      id: "sexo",
      campo: "sexo",
      tipo: "foto",
      obrigatorio: true,
      rotuloCurto: "Sexo",
      titulo: "Vamos personalizar seu treino.",
      descricao: "Escolha uma opção para começarmos. Ela serve apenas para escolher o " +
        "personagem das demonstrações — não muda treinos, cargas nem objetivos.",
      erroObrigatorio: "Escolha uma opção para continuar. Se preferir não responder, " +
        "selecione \"Prefiro não informar\".",
      opcoes: [
        {
          valor: "masculino",
          titulo: "Masculino",
          imagem: "assets/onboarding/sexo-masculino.png",
          alt: "Atleta masculino em pé, de camiseta e shorts pretos da FORJA com detalhes verde-limão"
        },
        {
          valor: "feminino",
          titulo: "Feminino",
          imagem: "assets/onboarding/sexo-feminino.jpg",
          alt: "Atleta feminina em pé, de camiseta e shorts pretos da FORJA com detalhes verde-limão"
        },
        {
          valor: "",
          titulo: "Prefiro não informar",
          texto: "O FORJA segue funcionando normalmente, sem personagem."
        }
      ]
    },
    {
      id: "area-foco",
      campo: "areaFoco",
      tipo: "escolha",
      obrigatorio: true,
      rotuloCurto: "Área de foco",
      titulo: "Qual área você quer priorizar?",
      descricao: "Escolha a sua prioridade principal. Você muda quando quiser.",
      opcoes: [
        { valor: "corpoTodo", titulo: "Corpo todo", texto: "Equilíbrio entre todas as áreas.", icone: "corpo" },
        { valor: "bracos", titulo: "Braços", texto: "Bíceps, tríceps e ombros.", icone: "halter" },
        { valor: "peito", titulo: "Peito", texto: "Peitoral e empurrar.", icone: "escudo" },
        { valor: "abdomen", titulo: "Abdômen", texto: "Core e estabilidade.", icone: "abdomen" },
        { valor: "pernas", titulo: "Pernas", texto: "Quadríceps, posterior e panturrilhas.", icone: "pernas" }
      ]
    },
    {
      id: "objetivo",
      campo: "objetivo",
      tipo: "escolha",
      obrigatorio: true,
      rotuloCurto: "Objetivo",
      titulo: "Qual é o seu principal objetivo?",
      descricao: "Orienta como você organiza as rotinas. Nada é prescrito automaticamente.",
      opcoes: [
        { valor: "perderPeso", titulo: "Perder peso", texto: "Reduzir o peso corporal com o tempo.", icone: "descer" },
        { valor: "hipertrofia", titulo: "Ganhar massa muscular", texto: "Volume de treino para construir músculo.", icone: "halter" },
        { valor: "manterForma", titulo: "Manter a forma", texto: "Seguir ativo e consistente.", icone: "manter" },
        { valor: "resistencia", titulo: "Melhorar o condicionamento físico", texto: "Fôlego e capacidade de repetir esforço.", icone: "coracao" },
        { valor: "forca", titulo: "Aumentar a força", texto: "Levantar mais carga, com técnica.", icone: "raio" }
      ]
    },
    {
      id: "motivacao",
      campo: "motivacoes",
      tipo: "multipla",
      obrigatorio: true,
      rotuloCurto: "Motivação",
      titulo: "O que mais motiva você?",
      descricao: "Pode escolher mais de uma opção.",
      erroObrigatorio: "Escolha pelo menos uma motivação para continuar.",
      opcoes: [
        { valor: "aparencia", titulo: "Parecer mais atraente", icone: "estrela" },
        { valor: "forca", titulo: "Ficar mais forte", icone: "raio" },
        { valor: "saude", titulo: "Melhorar minha saúde", icone: "coracao" },
        { valor: "confianca", titulo: "Sentir mais confiança", icone: "escudo" },
        { valor: "energia", titulo: "Ter mais energia", icone: "chama" },
        { valor: "estresse", titulo: "Aliviar o estresse", icone: "folha" }
      ]
    },
    {
      id: "altura",
      campo: "alturaCm",
      tipo: "numero",
      obrigatorio: true,
      rotuloCurto: "Altura",
      titulo: "Qual é a sua altura?",
      descricao: "Fica guardada só no seu perfil, neste aparelho. Nenhum cálculo é feito a partir dela sem você saber.",
      min: 80,
      max: 250,
      passoValor: 1,
      decimais: 0,
      base: 170,
      sufixo: "cm",
      placeholder: "Ex.: 172",
      grupoUnidade: "altura",
      unidades: [
        { valor: "cm", titulo: "cm" },
        { valor: "ftin", titulo: "pés/pol" }
      ],
      erroVazio: "Informe sua altura para continuar.",
      erroFaixa: "Use uma altura entre 80 e 250 cm."
    },
    {
      id: "peso",
      campo: "pesoKg",
      tipo: "numero",
      obrigatorio: true,
      rotuloCurto: "Peso atual",
      titulo: "Qual é o seu peso atual?",
      descricao: "Um valor aproximado já basta. Fica guardado só neste aparelho.",
      min: 25,
      max: 350,
      passoValor: 0.5,
      decimais: 1,
      base: 70,
      sufixo: "kg",
      placeholder: "Ex.: 74,5",
      grupoUnidade: "peso",
      unidades: [
        { valor: "kg", titulo: "kg" },
        { valor: "lb", titulo: "lb" }
      ],
      erroVazio: "Informe seu peso atual para continuar.",
      erroFaixa: "Use um peso entre 25 e 350 kg."
    },
    {
      id: "peso-alvo",
      campo: "pesoAlvoKg",
      tipo: "numero",
      opcional: true,
      rotuloCurto: "Peso-alvo",
      titulo: "Qual peso você deseja alcançar?",
      descricao: "Só se você já tiver um número em mente. Definir uma meta de peso não é obrigatório.",
      min: 25,
      max: 350,
      passoValor: 0.5,
      decimais: 1,
      base: 70,
      baseDoCampo: "pesoKg",
      sufixo: "kg",
      placeholder: "Ex.: 70",
      grupoUnidade: "peso",
      unidades: [
        { valor: "kg", titulo: "kg" },
        { valor: "lb", titulo: "lb" }
      ],
      alternativa: {
        rotulo: "Ainda não defini",
        texto: "Tudo bem — você pode definir uma meta quando quiser."
      },
      erroFaixa: "Use um peso entre 25 e 350 kg, ou escolha \"Ainda não defini\"."
    },
    {
      id: "tipo-corpo",
      campo: "tipoCorpo",
      tipo: "escolha",
      obrigatorio: true,
      rotuloCurto: "Tipo de corpo",
      titulo: "Como você descreveria seu corpo atualmente?",
      descricao: "É só a sua própria descrição do ponto de partida.",
      opcoes: [
        { valor: "magro", titulo: "Mais magro", icone: "corpo" },
        { valor: "intermediario", titulo: "Intermediário", icone: "manter" },
        { valor: "musculoso", titulo: "Mais musculoso", icone: "halter" },
        { valor: "", titulo: "Prefiro não informar", icone: "ajuda" }
      ]
    },
    {
      id: "ano-nascimento",
      campo: "anoNascimento",
      tipo: "numero",
      ehAno: true,
      obrigatorio: true,
      rotuloCurto: "Ano de nascimento",
      titulo: "Em que ano você nasceu?",
      descricao: "Guardamos apenas o ano, neste aparelho.",
      min: 1900,
      max: ANO_ATUAL,
      passoValor: 1,
      decimais: 0,
      base: 1995,
      sufixo: "",
      placeholder: "Ex.: 1996",
      erroVazio: "Informe o ano em que você nasceu.",
      erroFaixa: "Use um ano entre 1900 e " + ANO_ATUAL + ".",
      erroFuturo: "O ano de nascimento não pode estar no futuro."
    },
    {
      id: "rotina-diaria",
      campo: "rotinaDiaria",
      tipo: "escolha",
      obrigatorio: true,
      rotuloCurto: "Rotina diária",
      titulo: "Como é sua rotina diária?",
      descricao: "Fora do treino: como o seu dia costuma ser?",
      opcoes: [
        { valor: "sentado", titulo: "Principalmente sentado", texto: "Mesa, estudo ou direção na maior parte do dia.", icone: "sentado" },
        { valor: "emPe", titulo: "Fico em pé boa parte do dia", texto: "Em pé, com pouco deslocamento.", icone: "corpo" },
        { valor: "caminha", titulo: "Caminho bastante", texto: "Muitos passos ao longo do dia.", icone: "caminhar" },
        { valor: "esforcoFisico", titulo: "Trabalho com esforço físico", texto: "Carregar, construir, mover o corpo no trabalho.", icone: "halter" },
        { valor: "varia", titulo: "Minha rotina varia bastante", texto: "Cada dia é de um jeito.", icone: "troca" }
      ]
    },
    {
      id: "local-treino",
      campo: "localTreino",
      tipo: "escolha",
      obrigatorio: true,
      rotuloCurto: "Local de treino",
      titulo: "Onde você costuma treinar?",
      opcoes: [
        { valor: "casa", titulo: "Em casa", icone: "casa" },
        { valor: "academia", titulo: "Na academia", icone: "predio" },
        { valor: "arLivre", titulo: "Ao ar livre", icone: "folha" },
        { valor: "casaEAcademia", titulo: "Em casa e na academia", icone: "troca" },
        { valor: "", titulo: "Ainda não tenho um local definido", icone: "pin" }
      ]
    },
    {
      id: "preferencia-treino",
      campo: "preferenciasTreino",
      tipo: "multipla",
      obrigatorio: true,
      rotuloCurto: "Tipo de treino",
      titulo: "Que tipo de treino você prefere?",
      descricao: "Pode escolher mais de uma opção. Musculação ou calistenia isoladas " +
        "definem a modalidade inicial da sua lista de rotinas.",
      erroObrigatorio: "Escolha pelo menos um tipo de treino para continuar.",
      opcoes: [
        { valor: "musculacao", titulo: "Musculação", texto: "Cargas, halteres e máquinas.", icone: "halter" },
        { valor: "calistenia", titulo: "Calistenia", texto: "Peso corporal, barras e chão.", icone: "corpo" },
        { valor: "funcional", titulo: "Treino funcional", texto: "Movimentos variados e circuitos.", icone: "repetir" },
        { valor: "cardio", titulo: "Cardio", texto: "Corrida, bike e fôlego.", icone: "chama" },
        { valor: "combinacao", titulo: "Uma combinação de modalidades", texto: "Um pouco de cada.", icone: "troca" },
        { valor: "descobrir", titulo: "Quero descobrir o que funciona para mim", texto: "Ainda explorando.", icone: "interrogar" }
      ]
    },
    {
      id: "dias",
      campo: "diasPorSemana",
      tipo: "escolha",
      numerico: true,
      obrigatorio: true,
      rotuloCurto: "Dias por semana",
      titulo: "Quantos dias por semana você quer treinar?",
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
      id: "nivel",
      campo: "nivel",
      tipo: "escolha",
      obrigatorio: true,
      rotuloCurto: "Nível",
      titulo: "Qual é o seu nível de experiência?",
      descricao: "Serve para você reconhecer o próprio ponto de partida. O FORJA não prescreve carga.",
      opcoes: [
        { valor: "iniciante", titulo: "Iniciante", texto: "Primeiros meses, aprendendo a técnica.", icone: "bandeira" },
        { valor: "intermediario", titulo: "Intermediário", texto: "Treina com certa regularidade.", icone: "grafico" },
        { valor: "avancado", titulo: "Avançado", texto: "Anos de treino consistente.", icone: "trofeu" },
        { valor: "retornando", titulo: "Estou voltando a treinar", texto: "Já treinou antes e está retomando.", icone: "voltarSeta" },
        { valor: "", titulo: "Não tenho certeza", texto: "Pode definir depois em Perfil.", icone: "ajuda" }
      ]
    },
    {
      id: "experiencia",
      campo: "experienciaAtual",
      tipo: "escolha",
      obrigatorio: true,
      rotuloCurto: "Capacidade atual",
      titulo: "Como você está se sentindo com sua capacidade física?",
      descricao: "Responda conforme sua experiência atual. Nenhum teste é necessário.",
      opcoes: [
        { valor: "comecando", titulo: "Estou começando agora", icone: "bandeira" },
        { valor: "basicos", titulo: "Consigo realizar alguns exercícios básicos", icone: "check" },
        { valor: "regular", titulo: "Tenho experiência com treinos regulares", icone: "grafico" },
        { valor: "experiente", titulo: "Já treino há bastante tempo", icone: "trofeu" },
        { valor: "", titulo: "Prefiro não informar", icone: "ajuda" }
      ]
    },
    {
      id: "consideracoes",
      campo: "consideracoes",
      tipo: "multipla",
      obrigatorio: true,
      rotuloCurto: "Considerações",
      titulo: "Existe algo que devemos considerar no seu treino?",
      descricao: "Não pedimos diagnóstico nem fazemos recomendação médica: é só como " +
        "você prefere adaptar os exercícios. Pode escolher mais de uma opção.",
      erroObrigatorio: "Escolha uma opção para continuar — inclusive \"Nenhuma consideração específica\".",
      opcoes: [
        { valor: "nenhuma", titulo: "Nenhuma consideração específica", exclusiva: true, icone: "check" },
        { valor: "desconfortos", titulo: "Tenho desconfortos que quero levar em conta", texto: "Como preferência de adaptação, sem diagnóstico.", icone: "escudo" },
        { valor: "baixoImpacto", titulo: "Preciso de exercícios de baixo impacto", icone: "folha" },
        { valor: "adaptarNivel", titulo: "Quero adaptar os exercícios ao meu nível atual", icone: "alvo" },
        { valor: "depois", titulo: "Prefiro conversar sobre isso depois", exclusiva: true, icone: "relogio" }
      ]
    },
    {
      id: "equipamentos",
      campo: "equipamentos",
      tipo: "multipla",
      opcional: true,
      rotuloCurto: "Equipamentos",
      titulo: "Quais equipamentos você tem disponíveis?",
      descricao: "Pode escolher mais de um. Isso resume, no seu perfil, se o treino " +
        "é sem equipamento, em casa, na academia ou nos dois.",
      pularRotulo: "Continuar sem equipamentos definidos",
      opcoes: [
        { valor: "nenhum", titulo: "Nenhum equipamento", texto: "Só peso corporal e chão.", exclusiva: true, icone: "corpo" },
        { valor: "halteres", titulo: "Halteres", icone: "halter" },
        { valor: "barraAnilhas", titulo: "Barra e anilhas", icone: "halter" },
        { valor: "elasticos", titulo: "Elásticos", icone: "troca" },
        { valor: "maquinas", titulo: "Máquinas de musculação", icone: "predio" },
        { valor: "academiaCompleta", titulo: "Equipamentos de academia completos", icone: "predio" },
        { valor: "outros", titulo: "Outros equipamentos", icone: "interrogar" }
      ]
    },
    {
      id: "flexoes",
      campo: "flexoes",
      tipo: "escolha",
      opcional: true,
      rotuloCurto: "Flexões seguidas",
      titulo: "Quantas flexões você consegue fazer seguidas?",
      descricao: "Avaliação opcional, pela sua lembrança — não precisa testar agora.",
      opcoes: [
        { valor: "nenhuma", titulo: "Ainda não consigo fazer", icone: "flexao" },
        { valor: "1a5", titulo: "1–5", icone: "flexao" },
        { valor: "6a10", titulo: "6–10", icone: "flexao" },
        { valor: "11a20", titulo: "11–20", icone: "flexao" },
        { valor: "mais20", titulo: "Mais de 20", icone: "flexao" },
        { valor: "", titulo: "Prefiro pular", pular: true, icone: "ajuda" }
      ]
    },
    {
      id: "mobilidade",
      campo: "mobilidade",
      tipo: "escolha",
      opcional: true,
      rotuloCurto: "Mobilidade",
      titulo: "Como está sua mobilidade ao se inclinar para a frente?",
      descricao: "Responda pela sua percepção. Não faça nenhum movimento que provoque dor.",
      opcoes: [
        { valor: "dificuldade", titulo: "Tenho bastante dificuldade", icone: "arco" },
        { valor: "umPouco", titulo: "Consigo me inclinar um pouco", icone: "arco" },
        { valor: "pernas", titulo: "Consigo alcançar as pernas", icone: "arco" },
        { valor: "pes", titulo: "Consigo alcançar os pés", icone: "arco" },
        { valor: "naoSei", titulo: "Não sei avaliar", icone: "ajuda" },
        { valor: "", titulo: "Prefiro pular", pular: true, icone: "ajuda" }
      ]
    },
    {
      id: "sensacao-esforco",
      campo: "recuperacaoEsforco",
      tipo: "escolha",
      opcional: true,
      rotuloCurto: "Após o esforço",
      titulo: "Como você costuma se sentir após um esforço intenso?",
      descricao: "Pergunta opcional, só pela sua experiência — sem qualquer avaliação de saúde.",
      opcoes: [
        { valor: "rapida", titulo: "Consigo recuperar meu fôlego rapidamente", icone: "vento" },
        { valor: "algumTempo", titulo: "Preciso de algum tempo para recuperar o fôlego", icone: "vento" },
        { valor: "muitoCansado", titulo: "Costumo ficar muito cansado", icone: "vento" },
        { valor: "semExperiencia", titulo: "Não tenho experiência suficiente para avaliar", icone: "ajuda" },
        { valor: "", titulo: "Prefiro pular", pular: true, icone: "ajuda" }
      ]
    },
    {
      id: "celebracao",
      campo: "celebracao",
      tipo: "escolha",
      obrigatorio: true,
      rotuloCurto: "Conquistas",
      titulo: "Como você gostaria de celebrar suas conquistas?",
      descricao: "Usamos isso para falar da sua evolução do seu jeito — sem promessas de resultado.",
      opcoes: [
        { valor: "evolucao", titulo: "Perceber minha evolução", icone: "grafico" },
        { valor: "metas", titulo: "Completar minhas metas", icone: "bandeira" },
        { valor: "desempenho", titulo: "Melhorar meu desempenho", icone: "trofeu" },
        { valor: "consistencia", titulo: "Manter uma rotina consistente", icone: "repetir" },
        { valor: "pequenas", titulo: "Celebrar pequenas conquistas", icone: "estrela" },
        { valor: "", titulo: "Ainda não sei", icone: "ajuda" }
      ]
    },
    {
      id: "acompanhamento",
      campo: "acompanhamento",
      tipo: "escolha",
      obrigatorio: true,
      rotuloCurto: "Evolução",
      titulo: "Como você gostaria de perceber sua evolução?",
      opcoes: [
        { valor: "forca", titulo: "Acompanhar minha força", icone: "raio" },
        { valor: "resistencia", titulo: "Acompanhar minha resistência", icone: "coracao" },
        { valor: "consistencia", titulo: "Acompanhar a consistência dos treinos", icone: "repetir" },
        { valor: "metasPessoais", titulo: "Acompanhar minhas metas pessoais", icone: "bandeira" },
        { valor: "varios", titulo: "Acompanhar diferentes indicadores", icone: "grafico" },
        { valor: "", titulo: "Ainda não sei", icone: "ajuda" }
      ]
    },
    {
      id: "revisao",
      tipo: "revisao",
      titulo: "Confira suas respostas",
      resumo: "Toque em Editar para corrigir qualquer resposta. Perguntas puladas não aparecem aqui e nada é gravado ainda."
    },
    {
      id: "preparacao",
      tipo: "preparacao",
      titulo: "Seu perfil está pronto para o próximo passo.",
      resumo: "Este é o resumo do que vai orientar a sua entrada no FORJA."
    }
  ];

  const TIPOS_PERGUNTA = ["foto", "escolha", "multipla", "numero"];
  const ehPergunta = passo => TIPOS_PERGUNTA.indexOf(passo.tipo) !== -1;
  const passoPorId = id => PASSOS.find(passo => passo.id === id);
  const indiceDoPasso = id => PASSOS.findIndex(passo => passo.id === id);

  /* Rótulos clássicos de reserva (valores antigos sem cartão na pergunta). */
  const LABELS = {
    sexo: valor => (F.PERFIL_LABELS.sexo[valor] || "Não informado"),
    objetivo: valor => (F.PERFIL_LABELS.objetivo[valor] || "Não definido"),
    nivel: valor => (F.PERFIL_LABELS.nivel[valor] || "Não definido"),
    equipamento: valor => (F.PERFIL_LABELS.equipamento[valor] || "Não definido"),
    modalidadePreferida: valor => (F.PERFIL_LABELS.modalidade[valor] || "Sem preferência"),
    diasPorSemana: valor => (valor > 0
      ? valor + (valor === 1 ? " dia por semana" : " dias por semana")
      : "Ainda não sei"),
    duracaoMinutos: valor => (valor > 0 ? valor + " min por sessão" : "Não definido")
  };

  /* ------------------------------------------------------------------ */
  /* Conversões de unidade (armazenamento sempre em cm e kg)             */
  /* ------------------------------------------------------------------ */

  const arredondar1 = numero => Math.round(numero * 10) / 10;

  function cmParaPesPolegadas(cm) {
    const totalPolegadas = Number(cm) / 2.54;
    if (!Number.isFinite(totalPolegadas) || totalPolegadas <= 0) return { pes: 0, polegadas: 0 };
    let pes = Math.floor(totalPolegadas / 12);
    let polegadas = Math.round(totalPolegadas - pes * 12);
    if (polegadas === 12) { pes += 1; polegadas = 0; }
    return { pes, polegadas };
  }

  function pesPolegadasParaCm(pes, polegadas) {
    const total = Number(pes) * 12 + Number(polegadas);
    if (!Number.isFinite(total) || total <= 0) return 0;
    return Math.round(total * 2.54);
  }

  function kgParaLb(kg) {
    const numero = Number(kg);
    return Number.isFinite(numero) && numero > 0 ? arredondar1(numero / 0.45359237) : 0;
  }

  function lbParaKg(lb) {
    const numero = Number(lb);
    return Number.isFinite(numero) && numero > 0 ? arredondar1(numero * 0.45359237) : 0;
  }

  function formatarNumero(numero, decimais) {
    const valor = Number(numero);
    if (!Number.isFinite(valor)) return "";
    if (!decimais) return String(Math.round(valor));
    return arredondar1(valor).toFixed(1).replace(/\.0$/, "").replace(".", ",");
  }

  function lerNumeroDigitado(texto) {
    const limpo = String(texto || "").trim().replace(",", ".");
    if (limpo === "") return NaN;
    const numero = Number(limpo);
    return Number.isFinite(numero) ? numero : NaN;
  }

  /* ------------------------------------------------------------------ */
  /* Derivações explícitas para os campos clássicos do perfil            */
  /* ------------------------------------------------------------------ */

  /*
    `modalidadePreferida` (filtro inicial das rotinas) a partir das
    preferências marcadas: só musculação → "weights"; só calistenia →
    "calisthenics"; as duas, nenhuma das duas ou "combinação" → "" (sem
    preferência). Regra única, também usada nos testes.
  */
  function derivarModalidade(preferencias) {
    const lista = Array.isArray(preferencias) ? preferencias : [];
    const musculacao = lista.indexOf("musculacao") !== -1;
    const calistenia = lista.indexOf("calistenia") !== -1;
    if (musculacao && !calistenia) return "weights";
    if (calistenia && !musculacao) return "calisthenics";
    return "";
  }

  /*
    `equipamento` clássico (resumo de contexto) a partir da lista detalhada:
    "nenhum" marcado → "nenhum"; item de academia + item de casa → "ambos";
    só academia → "academia"; só itens de casa → "casa"; lista vazia → "".
  */
  function derivarEquipamento(equipamentos) {
    const lista = Array.isArray(equipamentos) ? equipamentos : [];
    if (lista.indexOf("nenhum") !== -1) return "nenhum";
    const academia = lista.some(item => item === "maquinas" || item === "academiaCompleta");
    const casa = lista.some(item =>
      item === "halteres" || item === "barraAnilhas" || item === "elasticos" || item === "outros");
    if (academia && casa) return "ambos";
    if (academia) return "academia";
    if (casa) return "casa";
    return "";
  }

  function sincronizarDerivados(state) {
    state.respostas.modalidadePreferida = derivarModalidade(state.respostas.preferenciasTreino);
    state.respostas.equipamento = derivarEquipamento(state.respostas.equipamentos);
  }

  /*
    Semeadura para quem tem perfil antigo (sem as respostas detalhadas):
    apresenta a resposta anterior dela nas perguntas novas equivalentes, sem
    tocar nos campos clássicos. A derivação só roda se a pessoa mexer nos
    cartões — concluir sem tocar preserva o que já existia.
  */
  function semearDePerfilAntigo(respostas) {
    if ((!respostas.preferenciasTreino || respostas.preferenciasTreino.length === 0) &&
      respostas.modalidadePreferida) {
      respostas.preferenciasTreino = [
        respostas.modalidadePreferida === "weights" ? "musculacao" : "calistenia"
      ];
    }

    if ((!respostas.equipamentos || respostas.equipamentos.length === 0) && respostas.equipamento) {
      respostas.equipamentos = {
        nenhum: ["nenhum"],
        casa: ["halteres", "elasticos"],
        academia: ["academiaCompleta"],
        ambos: ["halteres", "elasticos", "academiaCompleta"]
      }[respostas.equipamento] || [];
    }
  }

  /* ------------------------------------------------------------------ */
  /* Estado inicial e rascunho                                           */
  /* ------------------------------------------------------------------ */

  /* Respostas iniciais: perfil salvo, senão vazio. Nunca um palpite. */
  function respostasDoPerfil(profile) {
    const atual = F.normalizeProfile(profile);
    const respostas = {};

    PASSOS.forEach(passo => {
      if (passo.campo) respostas[passo.campo] = atual[passo.campo];
    });
    /* Campos clássicos derivados e a duração (sem pergunta neste fluxo: ela
       não entra no patch e continua como estava salva). */
    respostas.equipamento = atual.equipamento;
    respostas.modalidadePreferida = atual.modalidadePreferida;
    respostas.duracaoMinutos = atual.duracaoMinutos;

    return respostas;
  }

  function lerRascunho() {
    try {
      const raw = global.sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (!F.isPlainObject(value) || !F.isPlainObject(value.respostas)) return null;

      if (value.versao !== DRAFT_VERSION) {
        /* Rascunho do fluxo antigo: aproveita as respostas, recomeça as telas. */
        return { passo: 0, respostas: value.respostas, tocados: {}, pulados: {}, indefinidos: {}, unidades: {} };
      }

      const indice = Number(value.passo);
      return {
        passo: Number.isInteger(indice) && indice >= 0 && indice < PASSOS.length ? indice : 0,
        respostas: value.respostas,
        tocados: F.isPlainObject(value.tocados) ? value.tocados : {},
        pulados: F.isPlainObject(value.pulados) ? value.pulados : {},
        indefinidos: F.isPlainObject(value.indefinidos) ? value.indefinidos : {},
        unidades: F.isPlainObject(value.unidades) ? value.unidades : {}
      };
    } catch (error) {
      return null;
    }
  }

  function gravarRascunho(state) {
    try {
      global.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        versao: DRAFT_VERSION,
        passo: state.passo,
        respostas: state.respostas,
        tocados: state.tocados,
        pulados: state.pulados,
        indefinidos: state.indefinidos,
        unidades: state.unidades,
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

  /* ------------------------------------------------------------------ */
  /* Resposta presente, validação e rótulos                              */
  /* ------------------------------------------------------------------ */

  function valorPresente(state, passo) {
    const valor = state.respostas[passo.campo];
    if (passo.tipo === "multipla") return Array.isArray(valor) && valor.length > 0;
    if (passo.tipo === "numero") return Number(valor) > 0;
    if (passo.numerico) return Number(valor) > 0;
    return typeof valor === "string" && valor !== "";
  }

  /* Respondida de fato (inclui escolhas neutras tocadas e "Ainda não defini"). */
  function passoRespondido(state, passo) {
    if (!passo.campo || state.pulados[passo.id]) return false;
    if (state.indefinidos[passo.id]) return true;
    if (valorPresente(state, passo)) return true;
    return Boolean(state.tocados[passo.id]);
  }

  function validarPasso(state, passo) {
    if (!ehPergunta(passo)) return { ok: true };
    const valor = state.respostas[passo.campo];

    if (passo.tipo === "numero") {
      if (state.indefinidos[passo.id]) return { ok: true };
      const numero = Number(valor);
      if (!numero) {
        return passo.opcional
          ? { ok: true }
          : { ok: false, mensagem: passo.erroVazio || "Informe um valor para continuar." };
      }
      if (passo.ehAno && numero > ANO_ATUAL) {
        return { ok: false, mensagem: passo.erroFuturo || passo.erroFaixa };
      }
      if (numero < passo.min || numero > passo.max) {
        return { ok: false, mensagem: passo.erroFaixa || "O valor está fora da faixa esperada." };
      }
      return { ok: true };
    }

    if (!passo.obrigatorio) return { ok: true };

    if (passoRespondido(state, passo)) return { ok: true };
    return {
      ok: false,
      mensagem: passo.erroObrigatorio || "Escolha uma opção para continuar."
    };
  }

  function rotuloDaOpcao(passo, valor) {
    const opcao = (passo.opcoes || []).find(item => String(item.valor) === String(valor));
    return opcao ? opcao.titulo : null;
  }

  function rotuloResposta(state, passo) {
    const valor = state.respostas[passo.campo];

    if (state.indefinidos[passo.id] && passo.alternativa) return passo.alternativa.rotulo;

    if (passo.tipo === "numero") {
      if (!Number(valor)) return "Não informado";
      if (passo.ehAno) return String(valor);
      if (passo.campo === "alturaCm") {
        const imp = cmParaPesPolegadas(valor);
        return valor + " cm (" + imp.pes + "′" + imp.polegadas + "″)";
      }
      return formatarNumero(valor, passo.decimais) + " " + passo.sufixo;
    }

    if (passo.tipo === "multipla") {
      const titulos = (Array.isArray(valor) ? valor : [])
        .map(item => rotuloDaOpcao(passo, item) || String(item));
      return titulos.length ? titulos.join(", ") : "Não informado";
    }

    if (passo.campo === "diasPorSemana") return LABELS.diasPorSemana(Number(valor) || 0);

    return rotuloDaOpcao(passo, valor) ||
      (LABELS[passo.campo] ? LABELS[passo.campo](valor) : String(valor || "Não informado"));
  }

  /* ------------------------------------------------------------------ */
  /* Render da etapa atual                                               */
  /* ------------------------------------------------------------------ */

  /* Mensagem de erro da página. Vive no módulo porque quem a limpa é o
     handler dos controles, fora da função de inicialização. */
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

  function criarIcone(nome) {
    if (!nome || !ICONES[nome]) return null;
    const caixa = criar("span", "onboarding-option-icon");
    caixa.setAttribute("aria-hidden", "true");
    caixa.innerHTML = ICONES[nome];
    return caixa;
  }

  function renderProgresso(host, state) {
    host.replaceChildren();

    const total = PASSOS.length;
    const atual = state.passo + 1;
    const perguntas = PASSOS.filter(ehPergunta).length;
    const numeroPergunta = PASSOS.slice(0, state.passo + 1).filter(ehPergunta).length;
    const passo = PASSOS[state.passo];

    const rotulo = passo.tipo === "revisao"
      ? "Revisão das respostas"
      : passo.tipo === "preparacao"
        ? "Último passo"
        : "Etapa " + numeroPergunta + " de " + perguntas;

    const texto = criar("p", "onboarding-step-count", rotulo);
    texto.id = "onboarding-step-count";

    const trilha = criar("div", "onboarding-track");
    trilha.id = "onboarding-progressbar";
    trilha.setAttribute("role", "progressbar");
    trilha.setAttribute("aria-valuemin", "0");
    trilha.setAttribute("aria-valuemax", String(total - 1));
    trilha.setAttribute("aria-valuenow", String(state.passo));
    trilha.setAttribute("aria-valuetext", "Passo " + atual + " de " + total + ": " + passo.titulo);
    trilha.setAttribute("aria-labelledby", "onboarding-step-count");

    const preenchimento = criar("div", "onboarding-track-fill");
    preenchimento.style.width = Math.round((state.passo / (total - 1)) * 100) + "%";
    trilha.appendChild(preenchimento);

    host.append(texto, trilha);
  }

  /* Cartão de opção (rótulo + input nativo): teclado e leitor de tela. */
  function criarCartaoOpcao(passo, opcao, indice, tipoInput) {
    const rotulo = criar("label", "onboarding-option");
    rotulo.setAttribute("data-value", String(opcao.valor));

    const input = doc.createElement("input");
    input.type = tipoInput;
    input.name = "onboarding-" + passo.campo;
    input.id = "onboarding-" + passo.campo + "-" + indice;
    input.value = String(opcao.valor);
    input.className = "onboarding-radio";

    const icone = criarIcone(opcao.icone);
    const corpo = criar("span", "onboarding-option-body");
    corpo.appendChild(criar("span", "onboarding-option-title", opcao.titulo));
    if (opcao.texto) corpo.appendChild(criar("span", "onboarding-option-text", opcao.texto));

    const marca = criar("span", "onboarding-option-check");
    marca.setAttribute("aria-hidden", "true");

    rotulo.append(input);
    if (icone) rotulo.appendChild(icone);
    rotulo.append(corpo, marca);
    return { rotulo, input };
  }

  function marcarSelecionados(grupo, estaSelecionado) {
    grupo.querySelectorAll(".onboarding-option, .onboarding-photo-card").forEach(item => {
      const input = item.querySelector("input");
      item.classList.toggle("is-selected", Boolean(input && estaSelecionado(input)));
    });
  }

  function renderEscolha(host, state, passo) {
    const grupo = criar("div", "onboarding-options");
    grupo.setAttribute("role", "radiogroup");
    grupo.setAttribute("aria-labelledby", "onboarding-question");
    if (passo.descricao) grupo.setAttribute("aria-describedby", "onboarding-question-description");

    const atual = state.respostas[passo.campo];

    passo.opcoes.forEach((opcao, indice) => {
      const { rotulo, input } = criarCartaoOpcao(passo, opcao, indice, "radio");
      input.checked = opcao.pular
        ? Boolean(state.pulados[passo.id])
        : String(opcao.valor) === String(atual) && !state.pulados[passo.id];
      if (input.checked) rotulo.classList.add("is-selected");

      input.addEventListener("change", () => {
        if (opcao.pular) {
          state.pulados[passo.id] = true;
          delete state.tocados[passo.id];
        } else {
          state.respostas[passo.campo] = passo.numerico ? Number(opcao.valor) : String(opcao.valor);
          state.tocados[passo.id] = true;
          delete state.pulados[passo.id];
        }
        gravarRascunho(state);
        marcarSelecionados(grupo, item => item === input);
        esconderErroVisivel();
        F.ui.announce(opcao.titulo + " selecionado.");
      });

      grupo.appendChild(rotulo);
    });

    host.appendChild(grupo);
  }

  function renderFoto(host, state, passo) {
    const atual = state.respostas[passo.campo];
    const grade = criar("div", "onboarding-photo-grid");
    grade.setAttribute("role", "radiogroup");
    grade.setAttribute("aria-labelledby", "onboarding-question");
    if (passo.descricao) grade.setAttribute("aria-describedby", "onboarding-question-description");

    const opcoesFoto = passo.opcoes.filter(opcao => opcao.imagem);
    const opcoesTexto = passo.opcoes.filter(opcao => !opcao.imagem);

    opcoesFoto.forEach((opcao, indice) => {
      const cartao = criar("label", "onboarding-photo-card");
      cartao.setAttribute("data-value", String(opcao.valor));

      const input = doc.createElement("input");
      input.type = "radio";
      input.name = "onboarding-" + passo.campo;
      input.id = "onboarding-" + passo.campo + "-" + indice;
      input.value = String(opcao.valor);
      input.className = "onboarding-photo-radio";
      input.checked = String(opcao.valor) === String(atual);
      if (input.checked) cartao.classList.add("is-selected");

      input.addEventListener("change", () => {
        state.respostas[passo.campo] = String(opcao.valor);
        state.tocados[passo.id] = true;
        delete state.pulados[passo.id];
        gravarRascunho(state);
        marcarSelecionados(host, item => item === input);
        esconderErroVisivel();
        F.ui.announce(opcao.titulo + " selecionado.");
      });

      const midia = criar("span", "onboarding-photo-media");
      const imagem = doc.createElement("img");
      imagem.src = F.url(opcao.imagem);
      imagem.alt = opcao.alt || opcao.titulo;
      imagem.width = 1024;
      imagem.height = 1536;
      imagem.decoding = "async";
      imagem.setAttribute("data-sexo", String(opcao.valor));
      midia.appendChild(imagem);

      const legenda = criar("span", "onboarding-photo-caption");
      legenda.appendChild(criar("span", "onboarding-option-title", opcao.titulo));
      const marca = criar("span", "onboarding-option-check");
      marca.setAttribute("aria-hidden", "true");
      legenda.appendChild(marca);

      cartao.append(input, midia, legenda);
      grade.appendChild(cartao);
    });

    host.appendChild(grade);

    /* "Prefiro não informar": cartão de texto comum, abaixo das fotos. */
    if (opcoesTexto.length) {
      const grupo = criar("div", "onboarding-options onboarding-options-after-photo");
      opcoesTexto.forEach((opcao, indice) => {
        const { rotulo, input } = criarCartaoOpcao(
          passo, opcao, opcoesFoto.length + indice, "radio");
        input.checked = String(opcao.valor) === String(atual) && Boolean(state.tocados[passo.id]);
        if (input.checked) rotulo.classList.add("is-selected");

        input.addEventListener("change", () => {
          state.respostas[passo.campo] = String(opcao.valor);
          state.tocados[passo.id] = true;
          delete state.pulados[passo.id];
          gravarRascunho(state);
          marcarSelecionados(host, item => item === input);
          esconderErroVisivel();
          F.ui.announce(opcao.titulo + " selecionado.");
        });

        grupo.appendChild(rotulo);
      });
      host.appendChild(grupo);
    }
  }

  function renderMultipla(host, state, passo) {
    const grupo = criar("div", "onboarding-options");
    grupo.setAttribute("role", "group");
    grupo.setAttribute("aria-labelledby", "onboarding-question");
    if (passo.descricao) grupo.setAttribute("aria-describedby", "onboarding-question-description");

    const exclusivas = new Set(
      passo.opcoes.filter(opcao => opcao.exclusiva).map(opcao => String(opcao.valor)));
    const contador = criar("p", "onboarding-multi-count");
    contador.id = "onboarding-multi-count";
    contador.setAttribute("aria-live", "polite");

    function atualizarContador() {
      const total = (state.respostas[passo.campo] || []).length;
      contador.textContent = total === 0
        ? "Nenhuma opção selecionada."
        : total === 1 ? "1 opção selecionada." : total + " opções selecionadas.";
    }

    passo.opcoes.forEach((opcao, indice) => {
      const { rotulo, input } = criarCartaoOpcao(passo, opcao, indice, "checkbox");
      input.checked = (state.respostas[passo.campo] || []).indexOf(opcao.valor) !== -1;
      if (input.checked) rotulo.classList.add("is-selected");

      input.addEventListener("change", () => {
        let lista = Array.isArray(state.respostas[passo.campo])
          ? state.respostas[passo.campo].slice()
          : [];
        if (input.checked) {
          lista = opcao.exclusiva
            ? [opcao.valor]
            : lista.filter(item => !exclusivas.has(String(item))).concat(opcao.valor);
        } else {
          lista = lista.filter(item => item !== opcao.valor);
        }
        state.respostas[passo.campo] = lista;
        state.tocados[passo.id] = true;
        delete state.pulados[passo.id];
        if (passo.campo === "preferenciasTreino" || passo.campo === "equipamentos") {
          sincronizarDerivados(state);
        }
        gravarRascunho(state);
        grupo.querySelectorAll("input").forEach(item => {
          item.checked = lista.map(String).indexOf(item.value) !== -1;
        });
        marcarSelecionados(grupo, item => item.checked);
        esconderErroVisivel();
        atualizarContador();
        F.ui.announce(opcao.titulo + (input.checked ? " selecionado." : " desmarcado."));
      });

      grupo.appendChild(rotulo);
    });

    atualizarContador();
    host.append(grupo, contador);
  }

  /* ------------------------------------------------------------------ */
  /* Seletor numérico (altura, peso, peso-alvo, ano)                     */
  /* ------------------------------------------------------------------ */

  function unidadeAtual(state, passo) {
    if (!passo.unidades) return null;
    const escolhida = state.unidades[passo.grupoUnidade];
    return passo.unidades.some(opcao => opcao.valor === escolhida)
      ? escolhida
      : passo.unidades[0].valor;
  }

  function canonicoDaTela(passo, unidade, valorTela) {
    if (passo.grupoUnidade === "peso" && unidade === "lb") return lbParaKg(valorTela);
    return passo.decimais ? arredondar1(valorTela) : Math.round(valorTela);
  }

  function telaDoCanonico(passo, unidade, canonico) {
    if (!canonico) return 0;
    if (passo.grupoUnidade === "peso" && unidade === "lb") return kgParaLb(canonico);
    return canonico;
  }

  function renderNumero(host, state, passo) {
    const caixa = criar("div", "onboarding-number");
    caixa.setAttribute("data-campo", passo.campo);

    const entradas = criar("div", "onboarding-number-main");
    entradas.id = "onboarding-number-main";
    const dica = criar("p", "onboarding-number-hint");
    dica.id = "onboarding-number-hint";
    dica.setAttribute("aria-live", "polite");

    function canonico() {
      return Number(state.respostas[passo.campo]) || 0;
    }

    function atualizarDica() {
      const valor = canonico();
      const unidade = unidadeAtual(state, passo);
      let texto;
      if (passo.ehAno) {
        texto = "Entre " + passo.min + " e " + passo.max + ".";
      } else if (!valor) {
        texto = "Entre " + formatarNumero(passo.min, passo.decimais) + " e " +
          formatarNumero(passo.max, passo.decimais) + " " + passo.sufixo + ".";
      } else if (passo.campo === "alturaCm") {
        const imp = cmParaPesPolegadas(valor);
        texto = unidade === "ftin"
          ? "= " + valor + " cm"
          : "= " + imp.pes + " pés e " + imp.polegadas + " pol";
      } else {
        texto = unidade === "lb"
          ? "= " + formatarNumero(valor, 1) + " kg"
          : "= " + formatarNumero(kgParaLb(valor), 1) + " lb";
      }
      if (valor && (valor < passo.min || valor > passo.max)) {
        texto += " Fora da faixa esperada.";
        dica.classList.add("is-invalid");
      } else {
        dica.classList.remove("is-invalid");
      }
      dica.textContent = texto;
    }

    function gravarCanonico(novoValor) {
      state.respostas[passo.campo] = novoValor;
      state.tocados[passo.id] = true;
      delete state.pulados[passo.id];
      if (passo.alternativa && novoValor > 0) delete state.indefinidos[passo.id];
      gravarRascunho(state);
      esconderErroVisivel();
      atualizarDica();
    }

    function criarBotaoPasso(rotulo, sinal, aoAplicar) {
      const botao = criar("button", "onboarding-stepper", rotulo);
      botao.type = "button";
      botao.disabled = Boolean(state.indefinidos[passo.id]);
      botao.setAttribute(
        "aria-label",
        (sinal < 0 ? "Diminuir " : "Aumentar ") + (passo.rotuloCurto || "valor").toLowerCase()
      );
      botao.addEventListener("click", aoAplicar);
      return botao;
    }

    function montarEntradas() {
      entradas.replaceChildren();
      const unidade = unidadeAtual(state, passo);
      const desabilitado = Boolean(state.indefinidos[passo.id]);

      if (passo.grupoUnidade === "altura" && unidade === "ftin") {
        const imp = canonico() ? cmParaPesPolegadas(canonico()) : { pes: 0, polegadas: 0 };
        const campos = [
          { sufId: "pes", rotulo: "pés", valor: imp.pes },
          { sufId: "pol", rotulo: "polegadas", valor: imp.polegadas }
        ];
        const inputs = {};

        const lerImperial = () => pesPolegadasParaCm(
          lerNumeroDigitado(inputs.pes.value) || 0,
          lerNumeroDigitado(inputs.pol.value) || 0
        );

        const diminuir = criarBotaoPasso("−", -1, () => {
          const atual = canonico() || passo.base;
          const novo = Math.max(passo.min, atual - 3);
          gravarCanonico(novo);
          montarEntradas();
        });
        entradas.appendChild(diminuir);

        campos.forEach(campoImp => {
          const item = criar("label", "onboarding-number-part");
          const input = doc.createElement("input");
          input.type = "number";
          input.id = "onboarding-" + passo.campo + "-" + campoImp.sufId;
          input.className = "onboarding-number-input onboarding-number-input-part";
          input.inputMode = "numeric";
          input.min = "0";
          input.max = campoImp.sufId === "pes" ? "8" : "11";
          input.value = campoImp.valor ? String(campoImp.valor) : "";
          input.placeholder = campoImp.sufId === "pes" ? "5" : "7";
          input.disabled = desabilitado;
          input.setAttribute("aria-label", "Altura em " + campoImp.rotulo);
          input.setAttribute("aria-describedby", "onboarding-number-hint");
          input.addEventListener("input", () => gravarCanonico(lerImperial()));
          inputs[campoImp.sufId] = input;
          item.append(input, criar("span", "onboarding-number-unit", campoImp.rotulo));
          entradas.appendChild(item);
        });

        const aumentar = criarBotaoPasso("+", 1, () => {
          const atual = canonico() || passo.base;
          const novo = Math.min(passo.max, atual + 3);
          gravarCanonico(novo);
          montarEntradas();
        });
        entradas.appendChild(aumentar);
        return;
      }

      const input = doc.createElement("input");
      input.type = passo.decimais ? "text" : "number";
      input.id = "onboarding-" + passo.campo;
      input.className = "onboarding-number-input";
      input.inputMode = passo.decimais ? "decimal" : "numeric";
      input.autocomplete = "off";
      input.placeholder = passo.placeholder || "";
      input.disabled = desabilitado;
      input.setAttribute("aria-label", passo.titulo.replace(/\?$/, ""));
      input.setAttribute("aria-describedby", "onboarding-number-hint");
      const inicial = telaDoCanonico(passo, unidade, canonico());
      input.value = inicial
        ? formatarNumero(inicial, passo.grupoUnidade === "peso" ? 1 : passo.decimais)
        : "";

      input.addEventListener("input", () => {
        const digitado = lerNumeroDigitado(input.value);
        gravarCanonico(Number.isNaN(digitado) ? 0 : canonicoDaTela(passo, unidade, digitado));
        input.setAttribute(
          "aria-invalid",
          canonico() && (canonico() < passo.min || canonico() > passo.max) ? "true" : "false"
        );
      });
      input.addEventListener("change", () => {
        const tela = telaDoCanonico(passo, unidade, canonico());
        input.value = tela
          ? formatarNumero(tela, passo.grupoUnidade === "peso" ? 1 : passo.decimais)
          : "";
      });

      const passoDaTela = passo.grupoUnidade === "peso" && unidade === "lb" ? 1 : passo.passoValor;
      const aplicarPasso = sinal => () => {
        const baseDoPasso = canonico() ||
          (passo.baseDoCampo ? Number(state.respostas[passo.baseDoCampo]) || passo.base : passo.base);
        const telaAtual = telaDoCanonico(passo, unidade, baseDoPasso);
        let novo = canonicoDaTela(passo, unidade, telaAtual + sinal * passoDaTela);
        novo = Math.min(passo.max, Math.max(passo.min, novo));
        gravarCanonico(novo);
        input.value = formatarNumero(
          telaDoCanonico(passo, unidade, novo),
          passo.grupoUnidade === "peso" ? 1 : passo.decimais
        );
      };

      const sufixo = passo.grupoUnidade === "peso" && unidade === "lb" ? "lb" : passo.sufixo;
      const campo = criar("label", "onboarding-number-field");
      campo.appendChild(input);
      if (sufixo) campo.appendChild(criar("span", "onboarding-number-unit", sufixo));

      entradas.append(
        criarBotaoPasso("−", -1, aplicarPasso(-1)),
        campo,
        criarBotaoPasso("+", 1, aplicarPasso(1))
      );
    }

    if (passo.unidades) {
      const seletor = criar("div", "onboarding-units");
      seletor.setAttribute("role", "radiogroup");
      seletor.setAttribute("aria-label", "Unidade de medida");
      const atual = unidadeAtual(state, passo);

      passo.unidades.forEach((unidadeOpcao, indice) => {
        const rotulo = criar("label", "onboarding-unit");
        if (unidadeOpcao.valor === atual) rotulo.classList.add("is-selected");
        const input = doc.createElement("input");
        input.type = "radio";
        input.name = "onboarding-unidade-" + passo.id;
        input.id = "onboarding-unidade-" + passo.id + "-" + indice;
        input.value = unidadeOpcao.valor;
        input.className = "onboarding-unit-radio";
        input.checked = unidadeOpcao.valor === atual;
        input.addEventListener("change", () => {
          state.unidades[passo.grupoUnidade] = unidadeOpcao.valor;
          gravarRascunho(state);
          seletor.querySelectorAll(".onboarding-unit").forEach(item => {
            const radio = item.querySelector("input");
            item.classList.toggle("is-selected", radio === input);
          });
          montarEntradas();
          atualizarDica();
        });
        rotulo.append(input, criar("span", null, unidadeOpcao.titulo));
        seletor.appendChild(rotulo);
      });

      caixa.appendChild(seletor);
    }

    caixa.append(entradas, dica);

    if (passo.alternativa) {
      const rotulo = criar("label", "onboarding-option onboarding-alternative");
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.id = "onboarding-indefinido";
      input.className = "onboarding-radio";
      input.checked = Boolean(state.indefinidos[passo.id]);
      if (input.checked) rotulo.classList.add("is-selected");
      input.addEventListener("change", () => {
        if (input.checked) {
          state.indefinidos[passo.id] = true;
          state.respostas[passo.campo] = 0;
          state.tocados[passo.id] = true;
          delete state.pulados[passo.id];
        } else {
          delete state.indefinidos[passo.id];
          if (!Number(state.respostas[passo.campo])) delete state.tocados[passo.id];
        }
        rotulo.classList.toggle("is-selected", input.checked);
        gravarRascunho(state);
        esconderErroVisivel();
        montarEntradas();
        atualizarDica();
      });
      const corpo = criar("span", "onboarding-option-body");
      corpo.appendChild(criar("span", "onboarding-option-title", passo.alternativa.rotulo));
      if (passo.alternativa.texto) {
        corpo.appendChild(criar("span", "onboarding-option-text", passo.alternativa.texto));
      }
      rotulo.append(input, corpo);
      caixa.appendChild(rotulo);
    }

    montarEntradas();
    atualizarDica();
    host.appendChild(caixa);
  }

  /* ------------------------------------------------------------------ */
  /* Revisão e preparação                                                */
  /* ------------------------------------------------------------------ */

  function criarOptinMetas(state) {
    const sugestao = F.profileGoalSuggestion(state.respostas);
    const metasExistentes = F.state.goals && F.state.goals.updatedAt;
    if (!sugestao || metasExistentes) return null;

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
    return caixa;
  }

  function renderRevisao(host, state, acoes) {
    const lista = criar("dl", "onboarding-review");
    let mostradas = 0;
    let puladas = 0;

    PASSOS.forEach((passo, indice) => {
      if (!ehPergunta(passo)) return;
      if (state.pulados[passo.id]) puladas += 1;
      if (!passoRespondido(state, passo)) return;
      mostradas += 1;

      const linha = criar("div", "onboarding-review-row");
      const nomeCurto = passo.rotuloCurto || passo.titulo.replace(/\?$/, "");
      linha.appendChild(criar("dt", "onboarding-review-term", nomeCurto));
      linha.appendChild(criar("dd", "onboarding-review-value", rotuloResposta(state, passo)));

      const editar = criar("button", "onboarding-edit", "Editar");
      editar.type = "button";
      editar.setAttribute("data-step", String(indice));
      editar.setAttribute("aria-label", "Editar " + nomeCurto.toLowerCase());
      editar.addEventListener("click", () => acoes.irPara(indice));
      linha.appendChild(editar);

      lista.appendChild(linha);
    });

    if (mostradas > 0) {
      host.appendChild(lista);
    } else {
      host.appendChild(criar(
        "p",
        "onboarding-note",
        "Nenhuma resposta para revisar ainda. Volte e responda o que fizer sentido para você."
      ));
    }

    if (puladas > 0) {
      host.appendChild(criar(
        "p",
        "onboarding-note",
        puladas === 1
          ? "1 pergunta opcional foi pulada. Você pode continuar sem respondê-la."
          : puladas + " perguntas opcionais foram puladas. Você pode continuar sem respondê-las."
      ));
    }

    host.appendChild(criar(
      "p",
      "onboarding-note",
      "Nada foi gravado ainda: o perfil só é salvo na próxima tela, apenas neste navegador. " +
      "Depois você pode alterar ou limpar os dados em Perfil."
    ));
  }

  function renderPreparacao(host, state) {
    const objetivoPasso = passoPorId("objetivo");
    const areaPasso = passoPorId("area-foco");
    const diasPasso = passoPorId("dias");
    const modalidade = LABELS.modalidadePreferida(state.respostas.modalidadePreferida);

    const resumo = criar("dl", "onboarding-summary");
    [
      ["Objetivo", rotuloResposta(state, objetivoPasso)],
      ["Área de foco", rotuloResposta(state, areaPasso)],
      ["Modalidade inicial", modalidade],
      ["Disponibilidade", rotuloResposta(state, diasPasso)]
    ].forEach(([termo, valor]) => {
      const item = criar("div", "onboarding-summary-item");
      item.append(
        criar("dt", "onboarding-summary-term", termo),
        criar("dd", "onboarding-summary-value", valor)
      );
      resumo.appendChild(item);
    });
    host.appendChild(resumo);

    host.appendChild(criar(
      "p",
      "onboarding-prep-note",
      "Sem plano automático escondido: no FORJA é você quem monta e executa as rotinas. " +
      "Suas respostas ficam no perfil para personalizar o que o app já sugere — a meta " +
      "semanal abaixo e a modalidade inicial da lista de rotinas."
    ));

    const optin = criarOptinMetas(state);
    if (optin) host.appendChild(optin);

    host.appendChild(criar(
      "p",
      "onboarding-note",
      "Ao entrar, o perfil é gravado apenas neste navegador. Você pode refazer este " +
      "cadastro ou limpar os dados quando quiser em Perfil."
    ));
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

    if (!shell || !stepHost || !form || !avancar) return;

    const rascunho = lerRascunho();
    const state = {
      passo: rascunho ? rascunho.passo : 0,
      respostas: Object.assign(
        respostasDoPerfil(F.state.profile),
        rascunho ? rascunho.respostas : {}
      ),
      tocados: rascunho ? rascunho.tocados : {},
      pulados: rascunho ? rascunho.pulados : {},
      indefinidos: rascunho ? rascunho.indefinidos : {},
      unidades: Object.assign({ altura: "cm", peso: "kg" }, rascunho ? rascunho.unidades : {})
    };

    /* Respostas fora do vocabulário do perfil não entram no fluxo. */
    const normalizadas = F.normalizeProfile(state.respostas);
    Object.keys(state.respostas).forEach(campo => {
      if (normalizadas[campo] !== undefined) state.respostas[campo] = normalizadas[campo];
    });
    semearDePerfilAntigo(state.respostas);

    function documentoQuerRefazer() {
      const busca = (global.location && global.location.search) || "";
      return /(\?|&)refazer=1(&|$)/.test(busca);
    }

    /* Perfil concluído não repete o onboarding em visitas comuns. */
    if (F.profileIsConfigured(F.state.profile) && !documentoQuerRefazer()) {
      F.navigate(F.url("inicio"));
      return;
    }

    function esconderErro() {
      esconderErroVisivel();
    }

    function mostrarErro(mensagem) {
      if (!erro) return;
      erro.textContent = mensagem;
      erro.hidden = false;
    }

    /*
      A barra inferior é fixa. Em telas baixas, uma etapa com muitas opções
      empurrava "Continuar" para trás da barra: o toque no botão ativava a
      navegação em vez de avançar. Esta função alinha o início do cartão e,
      quando a ação ainda fica na faixa da barra, rola o mínimo necessário
      para deixá-la inteira acima dela.

      A correção usa rolagem explícita: `scrollIntoView({ block: "nearest" })`
      considera o botão visível quando ele está inteiro dentro da viewport,
      mesmo que a barra fixa esteja por cima — e não rola nada. O
      `scroll-margin-bottom` de #onboarding-next (onboarding.css) continua
      protegendo outros alinhamentos programáticos do botão.

      A rolagem é instantânea de propósito: `html { scroll-behavior: smooth }`
      (performance.css) deixava a posição final indefinida durante a animação,
      e um clique imediato acertava o elemento errado. Em ambientes sem
      `scrollIntoView` (jsdom, navegadores antigos) a função não faz nada e a
      rolagem natural continua valendo.
    */
    function revelarEtapa(alinharTopo) {
      if (typeof shell.scrollIntoView !== "function" ||
          typeof avancar.getBoundingClientRect !== "function" ||
          typeof global.scrollTo !== "function") return;

      try {
        if (alinharTopo) shell.scrollIntoView({ behavior: "instant", block: "start" });
      } catch (error) {
        return; /* Sem suporte a opções: mantém a posição atual. */
      }

      const nav = doc.querySelector(".bottom-nav");
      const alturaNav = nav && typeof nav.getBoundingClientRect === "function"
        ? nav.getBoundingClientRect().height
        : 0;
      const limite = global.innerHeight - alturaNav - 12;
      const caixa = avancar.getBoundingClientRect();

      if (caixa.bottom <= limite) return;

      const destino = global.scrollY + Math.ceil(caixa.bottom - limite);
      try {
        global.scrollTo({ top: destino, behavior: "instant" });
      } catch (error) {
        try { global.scrollTo(0, destino); } catch (ignorado) { /* sem rolagem programática */ }
      }
    }

    function irPara(indice) {
      state.passo = Math.max(0, Math.min(PASSOS.length - 1, indice));
      gravarRascunho(state);
      render();
      const alvo = stepHost.querySelector("#onboarding-question");
      if (alvo && typeof alvo.focus === "function") alvo.focus({ preventScroll: true });
      revelarEtapa(true);
    }

    function pularEtapa(passo) {
      state.pulados[passo.id] = true;
      delete state.tocados[passo.id];
      gravarRascunho(state);
      irPara(state.passo + 1);
    }

    function render() {
      const passo = PASSOS[state.passo];
      stepHost.replaceChildren();

      const titulo = criar("h1", "onboarding-title", passo.titulo);
      titulo.id = "onboarding-question";
      titulo.tabIndex = -1;
      stepHost.appendChild(titulo);

      const descricao = ehPergunta(passo) ? passo.descricao : passo.resumo;
      if (descricao) {
        const paragrafo = criar("p", "onboarding-description", descricao);
        paragrafo.id = "onboarding-question-description";
        stepHost.appendChild(paragrafo);
      }

      const acoes = { irPara, pularEtapa };
      if (passo.tipo === "foto") renderFoto(stepHost, state, passo);
      if (passo.tipo === "escolha") renderEscolha(stepHost, state, passo);
      if (passo.tipo === "multipla") renderMultipla(stepHost, state, passo);
      if (passo.tipo === "numero") renderNumero(stepHost, state, passo);
      if (passo.tipo === "revisao") renderRevisao(stepHost, state, acoes);
      if (passo.tipo === "preparacao") renderPreparacao(stepHost, state);

      /* Etapas opcionais com texto próprio de pulo (ex.: equipamentos). */
      if (passo.opcional && passo.pularRotulo) {
        const pular = criar("button", "onboarding-skip-step", passo.pularRotulo);
        pular.type = "button";
        pular.id = "onboarding-skip-step";
        pular.addEventListener("click", () => pularEtapa(passo));
        stepHost.appendChild(pular);
      }

      renderProgresso(progressHost, state);

      avancar.textContent = passo.tipo === "preparacao" ? "Entrar no FORJA" : "Continuar";

      voltar.hidden = state.passo === 0;
      voltar.disabled = state.passo === 0;

      esconderErro();
      F.ui.announce("Passo " + (state.passo + 1) + " de " + PASSOS.length + ": " + passo.titulo);
    }

    function montarPatch() {
      const patch = {
        onboardingConcluidoEm: new Date().toISOString()
      };

      PASSOS.forEach(passo => {
        if (!passo.campo) return;
        /* Pulada sem resposta: fora do patch, o valor já salvo fica. */
        if (state.pulados[passo.id] && !state.tocados[passo.id]) return;
        const valor = state.respostas[passo.campo];
        patch[passo.campo] = Array.isArray(valor) ? valor.slice() : valor;
      });

      /* Derivados só quando a pergunta detalhada foi de fato respondida aqui;
         `duracaoMinutos` não tem pergunta neste fluxo e nunca entra no patch. */
      if (state.tocados["preferencia-treino"]) {
        patch.modalidadePreferida = state.respostas.modalidadePreferida;
      }
      if (state.tocados.equipamentos) {
        patch.equipamento = state.respostas.equipamento;
      }

      return patch;
    }

    function concluir() {
      /* Evita gravar duas vezes se o clique for repetido durante a escrita. */
      if (avancar.disabled) return;
      avancar.disabled = true;

      if (!F.saveProfile(montarPatch())) {
        avancar.disabled = false;
        mostrarErro("Não foi possível salvar o perfil neste navegador. " +
          "Suas respostas continuam nesta aba: verifique o espaço disponível e tente de novo.");
        F.showToast("O perfil não foi salvo. Nenhuma resposta foi perdida.", "error", 6000);
        return;
      }

      apagarRascunho();

      /* Elemento criado na preparação (não existe no HTML estático). */
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

      const passo = PASSOS[state.passo];

      if (passo.tipo === "preparacao") {
        concluir();
        return;
      }

      const validacao = validarPasso(state, passo);
      if (!validacao.ok) {
        mostrarErro(validacao.mensagem);
        const primeiro = stepHost.querySelector("input:not([disabled])");
        if (primeiro && typeof primeiro.focus === "function") primeiro.focus({ preventScroll: true });
        revelarEtapa(false);
        return;
      }

      /* Opcional avançada sem resposta conta como pulada nesta passagem. */
      if (passo.opcional && !passoRespondido(state, passo)) {
        state.pulados[passo.id] = true;
        delete state.tocados[passo.id];
      }

      irPara(state.passo + 1);
    });

    if (voltar) {
      voltar.addEventListener("click", () => irPara(state.passo - 1));
    }

    render();
    /* Primeira renderização: sem alinhar o topo (o cabeçalho continua visível),
       mas já garantindo que a ação não nasça atrás da barra inferior. */
    revelarEtapa(false);

    /* As fontes auto-hospedadas usam font-display: swap. Quando a fonte
       definitiva assenta, as opções podem ficar mais altas e empurrar o botão
       de novo para a faixa da barra. Recheca sem alinhar o topo nem mudar a
       etapa; ambientes sem FontFaceSet (jsdom) ficam só com a checagem acima. */
    if (doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === "function") {
      doc.fonts.ready.then(() => revelarEtapa(false));
    }

    /* Girar o aparelho muda a largura e pode empurrar a ação para trás da barra
       de novo. Só reage à largura: mostrar/esconder a barra do navegador muda
       a altura e não deve puxar a página enquanto a pessoa lê a pergunta. */
    let larguraAnterior = global.innerWidth;
    global.addEventListener("resize", () => {
      if (global.innerWidth === larguraAnterior) return;
      larguraAnterior = global.innerWidth;
      revelarEtapa(false);
    });
  };

  F.onboarding = {
    DRAFT_KEY,
    PASSOS,
    lerRascunho,
    apagarRascunho,
    conversoes: { cmParaPesPolegadas, pesPolegadasParaCm, kgParaLb, lbParaKg },
    derivarModalidade,
    derivarEquipamento
  };
})(window);
