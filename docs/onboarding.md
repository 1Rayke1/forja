# FORJA — cadastro guiado (onboarding) e perfil de treino

Documento do fluxo de personalização: as 24 telas, o sistema que as renderiza,
como cada resposta é armazenada, o que mudou no modelo de perfil e o que as
respostas **ainda não** fazem.

- Página do fluxo: `onboarding/index.html` + `assets/js/forja-onboarding.js`
- Estilos: `assets/css/onboarding.css` (carregado só nessa página)
- Imagens da etapa 1: `assets/imagens/onboarding/perfil-masculino.jpg` e
  `perfil-feminino.jpg` (arquivos fornecidos pelo projeto, redimensionados
  proporcionalmente de 1024 × 1536 para 720 × 1080)
- Modelo e validação: `assets/js/forja-dados.js` (chave `forja-perfil-v1`)
- Edição e backup: `perfil/index.html` + `assets/js/forja-backup.js`
- Convite na Home: `assets/js/forja-inicio.js` (só duas ações, sem formulário)
- Testes: `tests/onboarding.test.mjs` (jsdom) e o bloco de onboarding em
  `tests/e2e.browser.mjs` (navegador real)

## 1. Um fluxo data-driven, não 24 páginas

`F.onboarding.PASSOS` é a única fonte de verdade do fluxo. Cada etapa declara:

| Chave | Significado |
|-------|-------------|
| `id` | identificador estável (usado em `data-step` e no rascunho) |
| `tipo` | `imagem`, `escolha`, `multipla`, `numero`, `revisao` ou `final` |
| `campo` | campo do perfil alimentado (nome igual ao de `F.normalizeProfile`) |
| `obrigatorio` | libera ou não o link "Pular esta etapa" |
| `titulo` / `subtitulo` | pergunta principal e explicação curta |
| `opcoes` | valores, títulos, ícones, textos de apoio e `pular: true` |
| `unidades` / `minimo` / `maximo` / `casas` | só nas etapas numéricas |

O renderizador escolhe o controle pelo `tipo`; adicionar uma pergunta é
adicionar um objeto, não uma página. A revisão também é gerada a partir dessa
lista, então uma etapa nova aparece automaticamente para revisão e edição.

## 2. Sequência do fluxo

24 telas, uma pergunta por tela, com "ETAPA X DE 24", barra de progresso com
`role="progressbar"`, Voltar a partir da etapa 2 e "Pular esta etapa" apenas
onde a resposta é opcional.

| # | Etapa | Campo | Obrigatória |
|---|-------|-------|-------------|
| 1 | Vamos personalizar seu treino (Masculino / Feminino, com fotos) | `sexo` | sim |
| 2 | Qual área você quer priorizar? | `focoArea` | sim |
| 3 | Qual é o seu principal objetivo? | `objetivo` | sim |
| 4 | O que mais motiva você? (múltipla) | `motivacoes` | não |
| 5 | Qual é a sua altura? | `alturaCm` | sim |
| 6 | Qual é o seu peso atual? | `pesoKg` | sim |
| 7 | Qual peso você deseja alcançar? | `pesoAlvoKg` | não |
| 8 | Como você descreveria seu corpo atualmente? | `tipoCorpo` | não |
| 9 | Em que ano você nasceu? | `anoNascimento` | sim |
| 10 | Como é sua rotina diária? | `rotinaDiaria` | sim |
| 11 | Onde você costuma treinar? | `localTreino` | sim |
| 12 | Que tipo de treino você prefere? (múltipla) | `preferenciasTreino` | sim |
| 13 | Quantos dias por semana você quer treinar? | `diasPorSemana` | sim |
| 14 | Qual é o seu nível de experiência? | `nivel` | sim |
| 15 | Como você está se sentindo com sua capacidade física? | `experienciaFisica` | não |
| 16 | Existe algo que devemos considerar no seu treino? (múltipla) | `consideracoes` | não |
| 17 | Quais equipamentos você tem disponíveis? (múltipla) | `equipamentos` | não |
| 18 | Quantas flexões você consegue fazer seguidas? | `flexoes` | não |
| 19 | Como está sua mobilidade ao se inclinar para a frente? | `mobilidade` | não |
| 20 | Como você costuma se sentir após um esforço intenso? | `recuperacao` | não |
| 21 | Como você gostaria de celebrar suas conquistas? | `recompensa` | não |
| 22 | Como você gostaria de perceber sua evolução? | `progressoPercebido` | não |
| 23 | Revisão | — | — |
| 24 | Seu perfil está pronto para o próximo passo | — | — |

Regras de experiência:

- **Nada é gravado no armazenamento do FORJA antes da revisão.** As respostas
  ficam em memória e num rascunho de `sessionStorage`
  (`forja-onboarding-rascunho-v1`), que morre com a aba e nunca entra em backup.
  O rascunho guarda também a unidade escolhida (cm/pés, kg/lb) de cada medida.
- **Retomada:** sair no meio e voltar à página retoma na mesma etapa, com as
  respostas marcadas e nada gravado.
- **Gravação:** ao sair da revisão, `F.saveProfile` escreve uma única vez em
  `forja-perfil-v1` e a tela de preparação do plano aparece já com o perfil
  salvo. O botão "Entrar no FORJA" apenas navega para a Home.
- **Edição:** cada linha da revisão tem "Editar", que volta para a etapa sem
  perder nenhuma resposta. Quem já tem perfil e abre a página direto começa na
  revisão; `onboarding/index.html?refazer=1` recomeça da etapa 1.
- **Pular:** link explícito nas etapas opcionais. Pular não inventa nem apaga
  resposta: o campo fica como estava (vazio ou herdado do perfil salvo).
- **Erro de gravação:** se o navegador recusar a escrita, a tela mostra o
  motivo, **mantém o rascunho** e libera nova tentativa. Nenhuma resposta é
  perdida em silêncio.
- **Acessibilidade:** grupos de rádio/checkbox nativos (teclado e leitor de
  tela), título da etapa recebendo foco a cada troca, erro com `role="alert"`,
  visor numérico com `aria-live`, alvos de 44 px ou mais, foco visível e
  `prefers-reduced-motion` respeitado.

## 3. Etapa 1 — imagens masculina e feminina

- Cartão **Masculino** → `assets/imagens/onboarding/perfil-masculino.jpg`
- Cartão **Feminino** → `assets/imagens/onboarding/perfil-feminino.jpg`
- Nenhuma imagem é sintética ou substituída: os arquivos recebidos foram apenas
  reduzidos proporcionalmente (mesma proporção 2:3, sem recorte e sem
  distorção) e recomprimidos para caber no repositório.
- O CSS usa `aspect-ratio: 2 / 3` — a mesma proporção do arquivo — com
  `object-fit: cover`, então nada do corpo é cortado.
- Seleção: borda verde-limão, brilho, marca circular com check e legenda em
  verde. A escolha é única (rádio nativo) e tocar de novo no cartão já
  selecionado mantém a escolha.
- "Prefiro não informar" continua existindo como alternativa explícita (rádio
  de valor vazio): grava `sexo: ""`, nenhum personagem é exibido e o app segue
  igual.

## 4. Controles numéricos e unidades

| Medida | Unidade gravada | Unidades na tela | Faixa aceita |
|--------|-----------------|------------------|--------------|
| Altura | cm (`alturaCm`) | cm e pés/polegadas | 90–250 cm |
| Peso atual | kg (`pesoKg`) | kg e lb | 25–350 kg |
| Peso-alvo | kg (`pesoAlvoKg`) | kg e lb | 25–350 kg ou 0 ("ainda não defini") |
| Ano de nascimento | ano (`anoNascimento`) | ano | 1900–ano corrente |

- O perfil guarda **sempre** a unidade-base; a unidade da tela é só exibição.
  Conversões: 1 pol = 2,54 cm, 1 lb = 0,45359237 kg.
- Visor grande com o valor em destaque, botões − / +, campo numérico editável e
  troca de unidade (segmento com `aria-pressed`). Quando o campo está vazio, os
  botões partem de um valor-base plausível (170 cm, 70 kg, ano corrente − 30) —
  nunca de uma resposta já registrada.
- Valor fora da faixa **não é corrigido**: a tela avisa e o avanço é bloqueado.
  Na leitura, valor fora da faixa vira `0` ("não informado") em vez de ser
  aproximado para o limite, porque aproximar inventaria uma medida.
- Nenhuma idade é calculada ou exibida; o ano fica só como dado do perfil.

## 5. Modelo de dados (perfil v3)

A chave continua sendo `forja-perfil-v1`. O que mudou é o `version` **dentro**
do valor e o acréscimo de campos opcionais.

```jsonc
{
  "version": 3,
  "updatedAt": "2026-10-29T12:00:00.000Z",
  "objetivo": "hipertrofia",        // "" | forca | hipertrofia | resistencia | calistenia | recuperacao | emagrecimento | manutencao
  "nivel": "iniciante",             // "" | iniciante | intermediario | avancado | voltando
  "equipamento": "ambos",           // "" | nenhum | casa | academia | ambos
  "diasPorSemana": 4,               // 0..7  (0 = não definido)
  "duracaoMinutos": 45,             // 0..240 (0 = não definido) — preservado; não é mais perguntado
  "sexo": "masculino",              // "" | masculino | feminino
  "modalidadePreferida": "weights", // "" | calisthenics | weights
  "onboardingConcluidoEm": "2026-10-29T12:00:00.000Z",

  // v3 — aditivo, tudo opcional
  "focoArea": "corpo-todo",
  "motivacoes": ["forca", "saude"],
  "alturaCm": 178,                  // 0 = não informado
  "pesoKg": 80,                     // 0 = não informado (1 casa decimal)
  "pesoAlvoKg": 0,                  // 0 = "ainda não defini"
  "tipoCorpo": "intermediario",
  "anoNascimento": 1994,            // 0 = não informado
  "rotinaDiaria": "sentado",
  "localTreino": "academia",
  "preferenciasTreino": ["musculacao"],
  "experienciaFisica": "basicos",
  "consideracoes": ["baixo-impacto"],
  "equipamentos": ["halteres", "maquinas"],
  "flexoes": "6-10",
  "mobilidade": "pernas",
  "recuperacao": "algum-tempo",
  "recompensa": "metas",
  "progressoPercebido": "consistencia"
}
```

### Tradução para os campos que já existiam

O app inteiro continua lendo os mesmos campos de sempre. A tradução é explícita,
feita só na hora de salvar o cadastro e só quando a pessoa respondeu:

- `equipamentos` (lista) → `equipamento` (valor único):
  `[] → ""`; `["nenhum"] → "nenhum"`; itens de casa (`halteres`,
  `barra-anilhas`, `elasticos`, `outros`) → `"casa"`; `maquinas` /
  `academia-completa` → `"academia"`; os dois grupos → `"ambos"`.
- `preferenciasTreino` (lista) → `modalidadePreferida`: só musculação → `weights`;
  só calistenia → `calisthenics`; qualquer outra combinação (funcional, cardio,
  "descobrir", as duas juntas) mantém o valor anterior em vez de escolher por
  conta própria.

Nenhum outro campo antigo é recalculado. `duracaoMinutos` continua no perfil
(editável em Perfil) e continua alimentando a sugestão de metas: se estiver 0,
a meta é criada só com treinos/semana.

### Compatibilidade e migração

- **v1/v2 → v3 é leitura, não escrita.** `normalizeProfile` lê qualquer objeto e
  devolve o formato v3 com os campos novos vazios. O armazenamento **não** é
  reescrito no boot.
- **Perfis antigos contam como configurados.** `F.profileIsConfigured` aceita
  `updatedAt` ou `onboardingConcluidoEm`; quem já tinha perfil não é obrigado a
  refazer o cadastro e quem tem rotina/histórico nunca vê o convite.
- **Backup:** mesmo formato (`forja-backup` v1), mesma chave, mesma validação.
  Perfis v1/v2 continuam aceitos; valores novos desconhecidos, listas com item
  fora do vocabulário e números fora da faixa são recusados com mensagem clara.
- **Campos desconhecidos são preservados** (`carryUnknownProfileKeys`).
- **Perfil não apaga respostas novas:** o formulário de Perfil edita só os
  campos dele (`F.saveProfile` parte do que está gravado); as respostas do
  cadastro guiado aparecem em "Respostas do cadastro guiado", somente leitura,
  com o link "Refazer o cadastro guiado".

## 6. Revisão e preparação do plano

- A revisão mostra **apenas o que foi respondido** (as etapas puladas não
  aparecem), com "Editar" por linha.
- O opt-in de meta semanal continua igual: só é oferecido quando o perfil ainda
  não tem meta, e nunca sobrescreve metas existentes.
- A tela 24 não finge processamento: mostra objetivo, preferência de treino,
  frequência e disponibilidade já salvos, explica que o FORJA **não** monta
  plano automático e oferece "Entrar no FORJA" (Home) e "Ver rotinas".

## 7. O que as respostas fazem hoje

| Resposta | Efeito hoje |
|----------|-------------|
| `diasPorSemana` (+ `duracaoMinutos`) | Botão "Usar meu perfil" em Progresso preenche treinos/minutos por semana sem salvar; o opt-in da revisão cria a meta uma única vez |
| `modalidadePreferida` (derivado de `preferenciasTreino`) | Filtro inicial da lista de rotinas em `treino/` |
| `equipamento` (derivado de `equipamentos`) | Contexto no Perfil e no resumo do backup (mesmo campo de antes) |
| `sexo` | Escolhe o personagem das demonstrações quando elas existirem; nada é exibido hoje |
| Demais respostas | Registradas no perfil e visíveis em Perfil. **Sem efeito funcional ainda** — o app não monta plano automático, não calcula IMC e não emite recomendação clínica |

Integrações possíveis no futuro (não implementadas para não fingir
recomendação): `equipamentos` → filtro da biblioteca; `focoArea` + `nivel` →
sugestão de estrutura de rotina; `recompensa`/`progressoPercebido` → tom das
mensagens e destaque em Progresso.

## 8. Privacidade e limites

Tudo permanece no `localStorage` do navegador. Não há sincronização, conta,
rastreamento ou envio de dados; o backup JSON em Perfil é o único caminho para
levar os dados a outro aparelho.

O cadastro **não** pede diagnóstico médico, não prescreve carga, não avalia
composição corporal e não exige teste físico. Desconfortos declarados são
tratados como preferência de adaptação. Flexões e mobilidade são opcionais e
podem ser puladas.

## 9. Testes

```bash
npm test              # métricas, forja, onboarding, atlas e paridade (jsdom)
npm run test:onboarding
npm run test:e2e      # navegador real (Chromium) — precisa das libs do sistema
```

`tests/onboarding.test.mjs` cobre: primeiro acesso; as 24 telas e o contador;
imagens masculina/feminina por cartão e existência dos arquivos; seleção única
e múltipla (inclusive exclusividade de "nenhum equipamento" e "quero
descobrir"); etapas obrigatórias bloqueando; etapas opcionais e "pular";
altura com botões, digitação e conversão cm ↔ pés/polegadas; peso kg ↔ lb;
peso-alvo "ainda não defini"; ano de nascimento validado; revisão com apenas as
respostas dadas e edição por linha; conclusão com perfil v3 e traduções para
`equipamento`/`modalidadePreferida`; reabertura e `?refazer=1`; perfil v1 sem
campos novos; normalização e validação de backup; Perfil preservando as
respostas novas; retomada de rascunho; falha de gravação sem perda; rotinas e
histórico intactos; ausência de erros de console.

O bloco de e2e percorre as 24 telas em 320 px, confere as duas imagens
carregadas, overflow, alvos de toque, erro sem escolha, troca de unidade,
volta/correção, revisão com 22 linhas, conclusão e persistência após recarregar.
