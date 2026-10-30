# FORJA — Onboarding e perfil de treino

Documento do cadastro inicial e da personalização do perfil. Descreve o fluxo
implementado, o significado de cada resposta, como os dados são gravados, a
compatibilidade com perfis antigos e os limites atuais do que essas respostas
fazem no restante do app.

- Página do fluxo: `onboarding/index.html` + `assets/js/forja-onboarding.js`
- Estilos: `assets/css/onboarding.css` (carregado só nessa página)
- Imagens da primeira pergunta: `assets/onboarding/` (ver `NOTICE.md` na pasta)
- Convite na Home: `assets/js/forja-inicio.js` (só duas ações, sem formulário)
- Modelo e validação: `assets/js/forja-dados.js` (chave `forja-perfil-v1`)
- Edição clássica e backup: `perfil/index.html` + `assets/js/forja-backup.js`
- Testes: `tests/onboarding.test.mjs`, os testes de integração em
  `tests/forja.test.mjs` e o bloco de onboarding em `tests/e2e.browser.mjs`

## 1. Estrutura geral do fluxo

O onboarding tem **24 telas**: 22 perguntas, uma revisão e uma tela final de
preparação. Não há tela separada de boas-vindas: o fluxo abre diretamente na
primeira pergunta, **“Vamos personalizar seu treino.”**

Cada tela mantém a mesma estrutura:

- marca FORJA no topo;
- rótulo de progresso: `Etapa X de 22` nas perguntas,
  `Revisão das respostas` na revisão e `Último passo` na preparação;
- barra visual com `role="progressbar"`, `aria-valuemin="0"`,
  `aria-valuemax="23"`, `aria-valuenow` igual ao índice da tela e
  `aria-valuetext="Passo X de 24: <título>"`;
- uma única pergunta em destaque e uma explicação curta;
- área grande de resposta, adequada ao toque;
- botão principal **Continuar** em posição alcançável pelo polegar;
- botão **Voltar** a partir da segunda tela;
- link **Sair e continuar depois**, oculto na tela final;
- erro inline em `#onboarding-error` quando uma etapa obrigatória está vazia
  ou inválida.

O motor é orientado por dados. `PASSOS` em
`assets/js/forja-onboarding.js` descreve cada tela com `id`, `campo`, `tipo`,
título, descrição, opções, obrigatoriedade/opcionalidade, limites e mensagens
de validação. Os renderizadores reutilizáveis cobrem:

- `foto`: escolha única com cartões fotográficos;
- `escolha`: uma opção;
- `multipla`: várias opções com checkboxes;
- `numero`: entrada editável com steppers e, quando aplicável, troca de
  unidade;
- `revisao`;
- `preparacao`.

As respostas são preservadas ao voltar e avançar. Escolhas neutras como
“Prefiro não informar”, “Ainda não sei” ou “Ainda não defini” são respostas
explícitas: contam como respondidas, aparecem na revisão e podem limpar um
valor anterior. Isso é diferente de **pular** uma pergunta opcional, situação
em que o campo fica fora do patch final e um valor já salvo é preservado.

### Regras de experiência

- **Nada é gravado em `forja-perfil-v1` antes do clique final.** Nem a revisão
  nem a simples abertura da preparação salvam o perfil. A única gravação do
  onboarding acontece ao tocar em **Entrar no FORJA**, por `F.saveProfile`.
- **Rascunho de sessão:** durante o fluxo, respostas e estado de navegação
  ficam em `sessionStorage` na chave existente
  `forja-onboarding-rascunho-v1`, com versão interna `2`. O rascunho guarda o
  passo atual, respostas, passos tocados/pulados/indefinidos e as unidades de
  exibição. Ele morre com a sessão do navegador e nunca entra em backup.
- **Rascunho do fluxo antigo:** se a versão interna for diferente da atual, as
  respostas reconhecíveis são reaproveitadas, mas a navegação recomeca na
  primeira pergunta para não interpretar índices do fluxo de 9 telas.
- **Retomada:** sair no meio e voltar à página retoma o mesmo passo, com as
  respostas anteriores marcadas e sem gravar o perfil.
- **Entrada obrigatória:** o boot valida o perfil salvo antes de inicializar
  qualquer rota protegida. Perfil ausente ou ilegível redireciona diretamente
  à primeira pergunta, inclusive em URLs internas, refresh e links salvos.
  Rotinas e histórico não são apagados nem usados para contornar a regra.
- **Perfil já configurado:** ao abrir a rota de onboarding sem intenção de
  edição, o app retorna à Home. O link explícito “Refazer o cadastro guiado”
  em Perfil usa `onboarding/index.html?refazer=1` e começa da primeira pergunta.
- **Erro de gravação:** se o navegador recusar a escrita final, o app continua
  bloqueado, mostra o erro, mantém as respostas/rascunho e permite nova tentativa.
- **Confirmação:** após salvar com sucesso, o app volta à Home, apaga o rascunho
  e libera as rotas protegidas.

## 2. Perguntas, controles e campos

| # | Pergunta/tela | Campo | Controle e respostas |
|---|---------------|-------|----------------------|
| 1 | “Vamos personalizar seu treino.” | `sexo` | Cartões fotográficos obrigatórios: `masculino`, `feminino` ou “Prefiro não informar” (`""`) |
| 2 | “Qual área você quer priorizar?” | `areaFoco` | Escolha única obrigatória: `corpoTodo`, `bracos`, `peito`, `abdomen`, `pernas` |
| 3 | “Qual é o seu principal objetivo?” | `objetivo` | Escolha única obrigatória no fluxo: `perderPeso`, `hipertrofia`, `manterForma`, `resistencia`, `forca` |
| 4 | “O que mais motiva você?” | `motivacoes[]` | Múltipla obrigatória: `aparencia`, `forca`, `saude`, `confianca`, `energia`, `estresse` |
| 5 | “Qual é a sua altura?” | `alturaCm` | Número obrigatório, cm por padrão ou pés/polegadas; armazenamento canônico em cm inteiro; faixa 80–250 |
| 6 | “Qual é o seu peso atual?” | `pesoKg` | Número obrigatório, kg por padrão ou lb; armazenamento canônico em kg com uma casa; faixa 25–350; aceita vírgula decimal |
| 7 | “Qual peso você deseja alcançar?” | `pesoAlvoKg` | Número opcional na mesma unidade do passo 6, faixa 25–350 kg, ou “Ainda não defini” (`0`) |
| 8 | “Como você descreveria seu corpo atualmente?” | `tipoCorpo` | Escolha única obrigatória: `magro`, `intermediario`, `musculoso` ou “Prefiro não informar” (`""`); apenas autodescrição |
| 9 | “Em que ano você nasceu?” | `anoNascimento` | Ano obrigatório entre 1900 e o ano atual; anos futuros são recusados; nenhuma idade é calculada ou exibida |
| 10 | “Como é sua rotina diária?” | `rotinaDiaria` | Escolha única obrigatória: `sentado`, `emPe`, `caminha`, `esforcoFisico`, `varia` |
| 11 | “Onde você costuma treinar?” | `localTreino` | Escolha única obrigatória: `casa`, `academia`, `arLivre`, `casaEAcademia` ou local ainda indefinido (`""`) |
| 12 | “Que tipo de treino você prefere?” | `preferenciasTreino[]` | Múltipla obrigatória: `musculacao`, `calistenia`, `funcional`, `cardio`, `combinacao`, `descobrir` |
| 13 | “Quantos dias por semana você quer treinar?” | `diasPorSemana` | Escolha única obrigatória: 1–7 ou “Ainda não sei” (`0`) |
| 14 | “Qual é o seu nível de experiência?” | `nivel` | Escolha única obrigatória: `iniciante`, `intermediario`, `avancado`, `retornando` ou incerteza (`""`) |
| 15 | “Como você está se sentindo com sua capacidade física?” | `experienciaAtual` | Escolha única obrigatória: `comecando`, `basicos`, `regular`, `experiente` ou “Prefiro não informar” (`""`); nenhum teste físico é exigido |
| 16 | “Existe algo que devemos considerar no seu treino?” | `consideracoes[]` | Múltipla obrigatória: `nenhuma` ou `depois` (exclusivas), `desconfortos`, `baixoImpacto`, `adaptarNivel`; apenas preferência de adaptação, sem diagnóstico |
| 17 | “Quais equipamentos você tem disponíveis?” | `equipamentos[]` | Múltipla opcional: `nenhum` (exclusivo), `halteres`, `barraAnilhas`, `elasticos`, `maquinas`, `academiaCompleta`, `outros`; ação “Continuar sem equipamentos definidos” |
| 18 | “Quantas flexões você consegue fazer seguidas?” | `flexoes` | Escolha opcional autodeclarada: `nenhuma`, `1a5`, `6a10`, `11a20`, `mais20` ou “Prefiro pular”; nenhum teste é solicitado |
| 19 | “Como está sua mobilidade ao se inclinar para a frente?” | `mobilidade` | Escolha opcional autodeclarada: `dificuldade`, `umPouco`, `pernas`, `pes`, `naoSei` ou “Prefiro pular” |
| 20 | “Como você costuma se sentir após um esforço intenso?” | `recuperacaoEsforco` | Escolha opcional autodeclarada: `rapida`, `algumTempo`, `muitoCansado`, `semExperiencia` ou “Prefiro pular” |
| 21 | “Como você gostaria de celebrar suas conquistas?” | `celebracao` | Escolha única obrigatória: `evolucao`, `metas`, `desempenho`, `consistencia`, `pequenas` ou “Ainda não sei” (`""`) |
| 22 | “Como você gostaria de perceber sua evolução?” | `acompanhamento` | Escolha única obrigatória: `forca`, `resistencia`, `consistencia`, `metasPessoais`, `varios` ou “Ainda não sei” (`""`) |
| 23 | “Confira suas respostas” | — | Revisão somente das perguntas efetivamente respondidas; cada item tem **Editar** e salta para a própria etapa |
| 24 | “Seu perfil está pronto para o próximo passo.” | — | Resumo de objetivo, área de foco, modalidade inicial e disponibilidade; botão final **Entrar no FORJA** |

### Unidades e validação numérica

- Altura usa entrada editável, botões `−`/`+` e alternância `cm` ↔
  `pés/pol`. A conversão usa 1 pol = 2,54 cm e sempre grava centímetros
  inteiros.
- Peso atual e peso-alvo usam entrada editável, steppers de 0,5 na unidade de
  exibição e alternância `kg` ↔ `lb`. A conversão usa
  1 lb = 0,45359237 kg e sempre grava quilogramas com uma casa decimal.
- A unidade escolhida para peso é compartilhada entre os passos 6 e 7; a de
  altura é independente. As preferências de unidade vivem só no rascunho,
  não no perfil.
- Valores vazios em etapas obrigatórias, texto não numérico e valores fora da
  faixa bloqueiam o avanço com mensagem inline.
- O ano de nascimento não pode ser futuro. O app não deriva idade, faixa
  etária, IMC, peso ideal nem qualquer recomendação a partir dessas medidas.

### Revisão e preparação

A revisão **não é um formulário com vários campos**. Ela lista somente
perguntas respondidas, inclusive escolhas neutras e “Ainda não defini”.
Perguntas opcionais puladas não viram linhas; em vez disso, uma nota informa
quantas foram puladas. Cada linha tem um botão **Editar** que volta à etapa
correspondente preservando as demais respostas.

A preparação mostra quatro itens — objetivo, área de foco, modalidade inicial
derivada e disponibilidade. Ela não cria um plano escondido: a pessoa acessa
o hub Treinos e solicita uma prévia do gerador local ou, quando configurado,
da integração de IA; precisa revisar e salvar antes que sessões apareçam no
calendário e nas rotinas.

Quando há uma sugestão calculável e ainda não existem metas semanais salvas,
a preparação também mostra a caixa **“Criar uma meta semanal com estes
dados”**, inicialmente marcada. Se a pessoa desmarcá-la, ou se já houver
metas, o onboarding não altera `forja-treino-metas-v1`. Se ela permanecer
marcada, a meta é criada somente depois que o perfil é salvo com sucesso.

## 3. Imagens da primeira pergunta

Somente duas imagens fornecidas pelo proprietário do projeto são usadas, e
somente na etapa 1:

| Cartão | Arquivo no repositório | Valor salvo |
|--------|------------------------|-------------|
| Masculino | `assets/onboarding/sexo-masculino.png` | `masculino` |
| Feminino | `assets/onboarding/sexo-feminino.jpg` | `feminino` |

As imagens preservam o enquadramento e as dimensões 1024 × 1536 dos arquivos
fornecidos. Como a figura masculina foi fornecida em JPEG e a feminina em PNG,
apenas o formato foi convertido para corresponder aos nomes acima; nenhum
corte, redimensionamento ou substituição visual foi feito, e os arquivos não
devem ser trocados entre si. A página faz preload das duas. Os cartões usam
proporção 2:3 e `object-fit: contain`, de modo que cada figura aparece inteira,
sem corte de corpo e sem distorção. O cartão escolhido recebe borda e fundo
verde-limão e um selo de seleção. Em telas de até 359 px, a grade vira uma
coluna para manter área de toque e evitar rolagem horizontal.

As imagens não são personagens de demonstração de exercício, não são
reutilizadas em outras etapas e não possuem dependência externa ou de PDF.
`assets/onboarding/NOTICE.md` registra essa origem e restrição de uso.

## 4. Modelo de dados

A chave continua sendo `forja-perfil-v1`. Somente o `version` **dentro** do
objeto mudou para `3`; nenhum segundo sistema de perfil ou chave paralela foi
criado.

```jsonc
{
  "version": 3,
  "updatedAt": "2026-10-29T12:00:00.000Z",
  "objetivo": "hipertrofia",        // "" | forca | hipertrofia | resistencia | calistenia | recuperacao | perderPeso | manterForma
  "nivel": "iniciante",             // "" | iniciante | intermediario | avancado | retornando
  "equipamento": "academia",        // "" | nenhum | casa | academia | ambos (resumo clássico derivado)
  "diasPorSemana": 4,               // 0..7; 0 = não definido/ainda não sei
  "duracaoMinutos": 0,              // 0..240; sem pergunta neste fluxo
  "sexo": "masculino",              // "" | masculino | feminino
  "modalidadePreferida": "weights", // "" | calisthenics | weights (clássico derivado)
  "onboardingConcluidoEm": "2026-10-29T12:00:00.000Z",
  "areaFoco": "corpoTodo",          // "" | corpoTodo | bracos | peito | abdomen | pernas
  "motivacoes": ["saude", "forca"], // lista do vocabulário v3
  "alturaCm": 178,                  // 0 ou 80..250
  "pesoKg": 82.5,                   // 0 ou 25..350, uma casa decimal
  "pesoAlvoKg": 0,                  // 0 = não definido/não informado; ou 25..350
  "tipoCorpo": "intermediario",     // "" | magro | intermediario | musculoso
  "anoNascimento": 1996,            // 0 ou 1900..ano atual
  "rotinaDiaria": "sentado",        // "" | sentado | emPe | caminha | esforcoFisico | varia
  "localTreino": "academia",        // "" | casa | academia | arLivre | casaEAcademia
  "preferenciasTreino": ["musculacao"],
  "experienciaAtual": "basicos",    // "" | comecando | basicos | regular | experiente
  "consideracoes": ["nenhuma"],
  "equipamentos": ["academiaCompleta"],
  "flexoes": "6a10",               // "" | nenhuma | 1a5 | 6a10 | 11a20 | mais20
  "mobilidade": "pernas",           // "" | dificuldade | umPouco | pernas | pes | naoSei
  "recuperacaoEsforco": "algumTempo", // "" | rapida | algumTempo | muitoCansado | semExperiencia
  "celebracao": "evolucao",         // "" | evolucao | metas | desempenho | consistencia | pequenas
  "acompanhamento": "forca"         // "" | forca | resistencia | consistencia | metasPessoais | varios
}
```

### Compatibilidade com v1/v2

- **Promoção é leitura, não escrita.** `normalizeProfile` lê v1/v2 e devolve
  em memória o formato v3, com os campos novos vazios (`""`, `[]` ou `0`).
  Ler o app não reescreve o armazenamento; a gravação como v3 ocorre na
  próxima salvamento real ou na conclusão do onboarding.
- **Nenhuma resposta nova é inferida.** Campos antigos não geram altura, peso,
  ano, tipo de corpo, rotina, capacidade ou preferências comemorativas.
  Somente os equivalentes clássicos descritos abaixo são semeados na tela.
- **Perfil antigo é configurado.** `F.profileIsConfigured` continua aceitando
  `updatedAt` ou `onboardingConcluidoEm`, logo usuários antigos não são
  obrigados a refazer o cadastro.
- **Campos desconhecidos são preservados** por `carryUnknownProfileKeys` ao
  gravar, mesmo sem serem lidos por esta versão.
- **Perfil clássico continua editável em Perfil.** `PERFIL_OPTIONS` inclui os
  novos valores clássicos `perderPeso`, `manterForma` e `retornando`, então
  salvar em Perfil não apaga essas escolhas. Os campos detalhados v3 não
  fazem parte daquele formulário, mas também não são incluídos no patch dele;
  portanto permanecem preservados e podem ser alterados refazendo o fluxo.
- **Backup:** o envelope e a chave permanecem os mesmos. `validateProfileStore`
  aceita perfis antigos sem campos v3, mas rejeita com mensagem clara um campo
  v3 presente com tipo, vocabulário ou faixa inválidos.

### Normalização e valores ausentes

- Escolha única fora do vocabulário vira `""`; listas mantêm apenas valores
  conhecidos, sem duplicatas.
- `diasPorSemana` é limitado a 0–7 e `duracaoMinutos` a 0–240.
- Altura é normalizada como inteiro até 250; pesos positivos são limitados a
  25–350 kg e arredondados para uma casa; ano futuro é limitado ao ano atual
  na leitura tolerante. A interface do onboarding e a importação de backup
  são mais estritas e recusam faixas implausíveis.
- Datas inválidas viram `null`.
- Ler nunca grava, arquiva ou “corrige” o conteúdo em disco. Um perfil
  ilegível é ignorado em memória com aviso e o conteúdo original permanece
  onde estava.

### Campos clássicos derivados e semeadura

As perguntas detalhadas mantêm funcionando os consumidores antigos sem
substituir os campos clássicos por um modelo paralelo:

| Origem detalhada | Campo clássico | Regra |
|------------------|----------------|-------|
| `preferenciasTreino[]` | `modalidadePreferida` | Só `musculacao` sem `calistenia` → `weights`; só `calistenia` sem `musculacao` → `calisthenics`; qualquer outra combinação → `""` |
| `equipamentos[]` | `equipamento` | `nenhum` → `nenhum`; itens de academia + itens de casa → `ambos`; só `maquinas`/`academiaCompleta` → `academia`; só `halteres`/`barraAnilhas`/`elasticos`/`outros` → `casa`; vazio → `""` |

Cada derivado só entra no patch quando a respectiva pergunta detalhada foi
efetivamente tocada. Pular equipamentos, por exemplo, não apaga nem recalcula
um `equipamento` clássico já salvo.

Ao abrir o fluxo para um perfil antigo sem as listas detalhadas, a tela semeia
as respostas equivalentes para exibição:

- `weights` → `["musculacao"]`; `calisthenics` → `["calistenia"]`;
- `equipamento: "nenhum"` → `["nenhum"]`;
- `"casa"` → `["halteres", "elasticos"]`;
- `"academia"` → `["academiaCompleta"]`;
- `"ambos"` → `["halteres", "elasticos", "academiaCompleta"]`.

Essa semeadura não é, por si só, uma nova resposta: concluir sem tocar nos
cartões preserva os campos clássicos existentes.

### Duração da sessão e metas

O fluxo atual **não pergunta a duração da sessão** e nunca inclui
`duracaoMinutos` no patch. Para um perfil novo, o valor permanece `0`; ao
refazer o onboarding, um valor antigo continua intacto.

`profileGoalSuggestion` não mudou:

```text
weeklySessions = diasPorSemana
weeklyMinutes  = min(7 × 60 × 24, diasPorSemana × duracaoMinutos)
modality       = modalidadePreferida ou "all"
```

Assim, um cadastro novo com 4 dias/semana sugere 4 sessões e **0 minutos**,
porque nenhuma duração foi coletada. A duração continua editável em Perfil, e
a sugestão de Progresso pode gerar minutos quando esse campo clássico já
estiver preenchido.

## 5. Sexo, imagens e personagens

- Valores persistidos com efeito definido: `masculino` e `feminino`.
- **“Prefiro não informar” grava `""`.** É uma escolha explícita, não um valor
  padrão silencioso.
- Nenhum valor é inferido por nome, aparência, objetivo, modalidade ou
  histórico.
- O campo continua alimentando apenas o contrato futuro de personagens:

  ```js
  Forja.resolvePersonagem(Forja.state.profile)
  // → { id: "masculino", label: "Personagem masculino" }
  // → { id: "feminino",  label: "Personagem feminino"  }
  // → null  (não informado, desconhecido ou perfil ausente)
  ```

- Nenhuma tela atual renderiza personagem 3D. Quem implementar demonstrações
  não deve renderizar personagem algum ao receber `null`.
- `sexo` não altera treino, carga, exercício, histórico, objetivo ou metas.
- A edição clássica posterior continua disponível em Perfil (`#prof-sexo`).

## 6. Integração com o que já existe

| Resposta | Efeito atual |
|----------|--------------|
| `modalidadePreferida` derivada | Filtro inicial da lista de rotinas em `treino/`; quando vazia, não impõe preferência |
| `diasPorSemana` + `duracaoMinutos` já existente | Base de `profileGoalSuggestion`: Progresso pode preencher a sugestão sem salvar; a preparação pode criar a meta somente com a caixa marcada e sem metas prévias |
| Campos clássicos (`objetivo`, `nivel`, `equipamento`, `sexo`, dias e duração) | Revisão, resumo/backup e formulário clássico em Perfil |
| Demais campos v3 | Gravados no perfil, exibidos na revisão do onboarding e preservados no backup; ainda não alteram treinos, filtros, cargas ou recomendações |

Limites explícitos:

- O plano semanal é uma sugestão revisável criada pelo módulo descrito em
  `docs/planejamento-inteligente.md`; nenhuma sessão começa antes de salvar
  e iniciar explicitamente.
- Não há cálculo de IMC, idade, peso ideal, gasto calórico ou prazo para
  atingir o peso-alvo.
- `consideracoes`, `flexoes`, `mobilidade` e `recuperacaoEsforco` são
  autodeclarações/preferências; não produzem diagnóstico, avaliação clínica ou
  recomendação médica.
- `tipoCorpo`, altura, peso e peso-alvo não são associados a saúde, valor
  pessoal ou promessa de resultado.

## 7. Privacidade e armazenamento

- O perfil final fica em `localStorage`, sob `forja-perfil-v1`, apenas neste
  navegador/aparelho.
- O rascunho fica em `sessionStorage`, sob
  `forja-onboarding-rascunho-v1`, e é apagado após a conclusão bem-sucedida.
- Não existe mais dispensa do onboarding. As respostas do onboarding ficam
  locais até a conclusão e não são enviadas ao provedor de IA.
- O gerador pode enviar ao backend, quando essa integração estiver configurada,
  apenas dados de planejamento minimizados e IDs/metadados do catálogo. Consulte
  `docs/planejamento-inteligente.md` para o contrato, credenciais e bloqueios.
- Para mover os dados entre aparelhos, o caminho continua sendo exportar e
  importar o backup JSON em Perfil. O rascunho não faz parte do backup.
- Metas semanais continuam em `forja-treino-metas-v1` e preferências gerais
  em `forja-preferencias-v1`; o onboarding só escreve metas na condição
  descrita para a tela de preparação.

## 8. Acessibilidade e mobile

- O fluxo usa radios, checkboxes e inputs nativos associados a cartões
  tocáveis, mantendo operação por teclado e leitor de tela.
- Cartões selecionados têm borda/fundo verde-limão e indicador de seleção;
  alvos principais têm pelo menos 44 px nas verificações automatizadas.
- O título/estado da etapa é anunciado nas trocas; erros são inline e o
  primeiro controle válido recebe foco após uma tentativa inválida.
- O layout foi desenhado mobile-first, respeita áreas seguras, evita
  dependência de hover e empilha os cartões fotográficos em telas muito
  estreitas.
- Transições são discretas e `prefers-reduced-motion` é respeitado.
- Nenhuma etapa exige executar flexões, inclinar-se ou realizar esforço para
  responder.

## 9. Testes

```bash
npm run test:onboarding  # suíte dedicada em jsdom (20 testes)
npm test                 # suítes jsdom do projeto, incluindo integração
npm run test:e2e         # navegador real (Chromium); requer ambiente de browser
```

`tests/onboarding.test.mjs` cobre, entre outros pontos:

- abertura direta na pergunta 1 e mapeamento correto das duas imagens;
- estrutura dos 24 passos, tipos de controle e vocabulários;
- fluxo completo até revisão, preparação e Home;
- nenhum salvamento antes de **Entrar no FORJA**;
- voltar/corrigir, respostas preservadas e edição a partir da revisão;
- escolhas únicas, múltiplas, exclusividades e respostas neutras;
- altura/peso/ano, limites, vírgula decimal, steppers e conversões
  cm ↔ pés/polegadas e kg ↔ lb;
- todos os opcionais e a diferença entre pular e responder explicitamente;
- revisão somente com respostas reais;
- rascunho de sessão, retomada e falha de gravação sem perda;
- perfis v1/v2, semeadura, derivações, backup v3 e preservação em Perfil;
- opt-in de metas, incluindo 4 dias com duração 0 produzindo 0 minutos;
- estrutura/acessibilidade, imagens inteiras e ausência de overflow lógico
  nas verificações de layout disponíveis em jsdom.

O bloco de onboarding em `tests/e2e.browser.mjs` percorre o fluxo em
navegador real a 320 px: valida as duas imagens e seus `data-sexo`, erro sem
escolha, inputs numéricos e checkboxes, ida/volta corrigindo os dias, as 22
linhas da revisão, ausência de gravação na revisão e na preparação, perfil v3
persistido (com `duracaoMinutos: 0`), retorno à Home, recarregamento sem novo
convite e edição posterior do sexo em Perfil sem alterar o objetivo.
