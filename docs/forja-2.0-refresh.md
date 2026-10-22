# FORJA · relatório de entrega (plano 2.0 refresh + plano 3.0, etapas 1–5)

Documento de estado real. O plano técnico e o rastreio etapa por etapa estão em
[`forja-3.0-plano.md`](forja-3.0-plano.md). Nada aqui é promessa: cada linha de
"verificado" aponta para um teste ou captura executada neste repositório.

- Etapas 1–4: branch `arena/ca17900f-forja` (commits `3f9f897` → `46ac0d9` →
  `2b89632` → `ee935d7`), incorporadas em `main` pelo PR #4.
- Etapa 5: branch `arena/47b678d3-forja`, criada a partir do merge do PR #4
  (histórico contém `ee935d7`). PR novo aberto a partir dela; **nenhum merge em
  `main`, nenhuma publicação em produção e nenhum APK gerado**. O PR #4 está
  fechado e não foi tocado.
- O PR #3 (base do refresh Dark Performance) já estava incorporado em `main`; o
  trabalho dele foi preservado e ampliado, não reescrito.
- App continua multipágina estático, sem build, sem dependência de runtime, sem
  servidor, sem login e sem sincronização.

## Como ler o inventário

Quatro estados, sempre explícitos:

| Estado | Significado |
|---|---|
| **implementado e verificado** | funciona no fluxo real e há teste/captura que executa o fluxo |
| **parcialmente implementado** | trecho do requisito existe; falta pedaço visível ao usuário |
| **não implementado** | não existe no app (não há botão ou tela "de fachada") |
| **não verificado** | código existe, mas este ambiente não conseguiu provar o comportamento (ex.: hardware real, leitor de tela) |

## 1. Inventário de requisitos

| Requisito | Estado | Evidência / o que falta |
|---|---|---|
| Rotinas por modalidade: criar, editar, duplicar, renomear, reordenar, excluir com confirmação, rascunho | implementado e verificado (já existia; preservado) | FORJA 08/16, paridade 2/2b/3 |
| Execução: fila congelada da rotina, cronômetro de sessão e de série por timestamps, pausa/retomada, avanço, recuperação após recarregar e após trocar de página | implementado e verificado (já existia; preservado) | FORJA 09/10/11/25, paridade 4/4b/5/14a–14d |
| Descanso: iniciar, pular, pausar, retomar, recuperação por timestamp | implementado e verificado (já existia) | FORJA 10, paridade 4b/14a/14b |
| Descanso: **ajustar a duração em andamento** (±15 s), visível e persistente | **implementado e verificado (etapa 4)** | FORJA 32; `executar-descanso-390.png` |
| Registro por série: repetições e carga | implementado e verificado (já existia) | FORJA 14, paridade 6 |
| Registro por série: **duração, distância e RPE** | **implementado e verificado (etapa 4)** | FORJA 33; `#log-distance`, `#log-rpe` |
| **Corrigir uma série já registrada / remover a última** | **implementado e verificado (etapa 4)** | FORJA 31; `executar-corrigir-390.png` |
| Série não é considerada concluída só porque o cronômetro terminou | implementado e verificado | conclusão só por ação explícita do usuário; testes 25/26 |
| Resumo ao final: duração real, séries, exercícios, status, volume, repetições, tempo sob tensão, distância | **implementado e verificado (etapa 4)** | FORJA 33/33b; `executar-resumo-390/1280.png` |
| Volume calculado **somente** quando os dados permitem; o que ficou fora é declarado | **implementado e verificado (etapa 4)** | `sessionTotals()` + `#summary-note`; FORJA 33 |
| Sensação de esforço (RPE da sessão) e observação opcional, distinguidas de dado ausente | **implementado e verificado (etapa 4)** | FORJA 33b (campo omitido quando a sessão não tem série concluída) |
| Histórico: sessões completas × parciais × descartadas, limite de 200, por modalidade | implementado e verificado (já existia) | FORJA 12/13, paridade 6 |
| Histórico: totais e feedback visíveis na listagem de progresso | **implementado e verificado (etapa 4)** | FORJA 33b (`Registrado: …`, `Esforço da sessão (RPE) …`, `Nota: …`) |
| Biblioteca de exercícios em página própria: busca por nome/músculo/equipamento, filtros combináveis, detalhe, adicionar à rotina | **implementado e verificado (etapa 3)** | FORJA 27/27b/28/29/30, E2E de rota e overflow |
| Tipos de exercício suportados: repetições, carga, isometria por tempo, distância, unilateral | implementado e verificado (distância e tempo na execução; unilateral como texto de carga/observação) | `F.exerciseTarget`, `measure` no modelo; FORJA 33 |
| Descanso como item da fila, ordem por seção (aquecimento/main/abs/finisher) | implementado e verificado | FORJA 10/15 |
| Metadados de catálogo: categoria, grupos musculares, equipamento, instrução de técnica, séries/reps/descanso sugeridos | implementado e verificado (37 registros) | `F.catalog`, `SUGGESTED_META`; FORJA 27/30 |
| Metadados por exercício: nome alternativo, nível de dificuldade, padrão de movimento, posição inicial, respiração, erros comuns, orientações de segurança, variações mais fáceis/difíceis, substituições casa↔academia | **não implementado** — o modelo guarda só parte disso; exige decisão de conteúdo (fonte e revisão técnica) | ver §5 |
| Músculos principais × secundários/estabilizadores separados por exercício | **implementado no pacote 3.1** — `roles` por exercício (principal ≤ 2, secundários, estabilizadores); a lista plana de músculos é derivada | `docs/atlas-anatomico.md` §3; teste ATLAS 5 |
| Atlas anatômico interativo (vistas anterior/posterior, destaque de regiões, legenda, relação músculo→exercícios) | **implementado no pacote 3.1 como esquema sobre silhueta vetorial** — vistas anterior/posterior, 16 regiões destacadas por papel (principal/secundária/estabilizadora), legenda curta, relação grupo→exercícios com filtro por modalidade e reuso na biblioteca e na execução | `explorar/atlas.html`, `assets/js/forja-atlas.js`; `docs/atlas-anatomico.md`; teste ATLAS 1–11 |
| Ilustração específica por exercício e demonstração visual | **não implementado** — hoje não há imagem por exercício; nenhuma imagem da internet foi usada para fingir anatomia | ver §5 |
| Programas prontos por nível (iniciante casa/academia, retorno gradual, calistenia básica, hipertrofia, força, resistência, curto, dividido, corpo inteiro) com descrição, público, duração e critérios de progressão | **não implementado** — a estrutura de rotinas e o catálogo existem, mas não há biblioteca de programas empacotada | ver §5 |
| Editor de rotinas: dias planejados, reordenação, duplicar, estimativa de duração, rascunho recuperável, músculos trabalhados pela rotina | parcialmente implementado — reordenação/duplicar/rascunho/estimativa e metadados do exercício personalizado existem; faltam dias por semana, estimativa explicada na tela do editor e leitura de músculos da rotina | FORJA 08/16/30 |
| Progresso: calendário de frequência, gráficos, evolução por exercício, recordes, comparação de períodos, filtros por semana/mês/personalizado, busca no histórico, metas | **implementado e verificado (etapa 5)** | cálculos puros em `assets/js/forja-metricas.js`; tela em `progresso/index.html` + `forja-progresso.js`; testes métricas 01–17, FORJA 34–39, E2E "Progresso: calendário, gráficos, recordes, metas e busca" |
| Componentes de gráfico acessíveis (barras, colunas, linha, heatmap, anel) | **implementado e verificado em tela (etapa 5)** | consumidos pela página de Progresso com `aria-label`, tabela de dados equivalente e estado vazio quando não há dado |
| Metas semanais (treinos/séries/minutos) | **implementado e verificado (etapa 5)** — formulário valida, grava em `forja-treino-metas-v1` pelo store e sobrevive ao recarregamento | FORJA 37; E2E da etapa 5; paridade 7/13a |
| Perfil e medidas corporais (peso, altura, circunferências, histórico, comparação, IMC com contexto, fotos opcionais privadas) | **não implementado** | etapa 3 do plano mestre (Perfil e medidas); requer produto/UX, não há fachada falsa |
| Onboarding sem barreira (nome opcional, objetivo, experiência, local, equipamentos, dias, tempo, restrições, acessibilidade) | **não implementado** | ver §5 |
| Início inteligente (treino do dia com motivo, último treino, frequência semanal, sequência, aviso de sessão em andamento, atalhos) | **parcialmente implementado** — a home tem calendário, missões e o resumo de rotinas por modalidade; não mostra treino planejado nem resumo da semana | etapa 6 do plano |
| Progressão transparente (faixa de reps, carga gradual, variação mais difícil, sugestão de recuar, comparação de sessões equivalentes) | **não implementado** | precisa de critério documentado antes de existir |
| Registro de sono/recuperação, lembretes, sessão curta para dia corrido | **não implementado** — não há notificação nem permissão pedida sem finalidade | ver §5 |
| Armazenamento: camada única, registro de chaves, versão de esquema, migrações idempotentes, validação na leitura, recusa de gravação tratada, conteúdo ilegível arquivado | **implementado e verificado (etapa 1)** | `forja-store.js`; FORJA 02/03/15a–15d, paridade 1b–1g |
| Exportar/importar backup com validação, cópia de segurança e desfazer | implementado e verificado (já existia; validação cobre os campos novos) | FORJA 19/20/21, paridade 7/7b/13a–13e |
| Privacidade local, sem rastreamento/publicidade/backend, dados corporais não saem do dispositivo | implementado e verificado | nenhuma requisição de rede no app; FORJA 22 (aviso em todas as páginas) |
| Identidade visual própria, tokens, hierarquia, estados de foco, `prefers-reduced-motion` | implementado e verificado (etapa 2) | `system.css`, `performance.css`, FORJA 24, paridade 9/9b/12c |
| Acessibilidade: rótulos, `aria-live`, contraste, alvos ≥ 44 px, navegação por teclado no segmented, sem rolagem horizontal em 320–1280 | implementado e verificado no que é automatizável; **não verificado** com leitor de tela real (nenhum AT disponível no ambiente) | FORJA 24, E2E de alvos/overflow |
| PWA instalável (manifest, ícones, maskable, standalone, splash) | **não implementado** | ver §5 |
| Funcionamento offline com cache versionado e atualização segura | **não implementado** — deliberação: sem service worker até haver estratégia de atualização e recuperação testada (requisito do plano mestre e restrição deste trabalho) | ver §5 |
| APK Android (Capacitor ou TWA) | **não implementado / não compilado** — o ambiente não executa Android SDK nem assinatura | ver §5 |
| Testes: unidade de funções puras + integração de fluxo + E2E em navegador real | implementado e verificado (suíte unitária de métricas adicionada na etapa 5) | §3 |
| Documentação refletindo a implementação real | implementado (este documento + `forja-3.0-plano.md`) | — |

## 2. O que as etapas 1–4 colocaram no produto

### Etapa 1 — fundação de dados (`3f9f897`)
- `assets/js/forja-store.js`: driver plugável (hoje `localStorage`), leitura com
  parse seguro, escrita com verificação pós-gravação e reversão, registro de
  chaves com `empty/normalize/validate/summarize/persist`, `F.DATA_VERSION = 3`
  e runner de migrações idempotente.
- `forja-dados.js`/`forja-backup.js` passaram a gravar e validar por essa
  camada; `F.saveJSON`, `F.parseStorageValue`, `F.removeStorageKey`,
  `F.archivePreservedValue` e `F.recordMigration` viraram fachadas finas — o
  contrato antigo continua válido.
- Compatibilidade: nenhum nome ou formato de chave mudou; campos novos são
  aditivos; abrir o app sem dados de treino não grava chave alguma (paridade 15a).

### Etapa 2 — sistema de interface (`46ac0d9`)
- `assets/js/forja-ui.js`: `button`, `linkButton`, `chip`, `segmented` (com
  teclado), `filterChips`, `table`, `empty`, `sectionHead`, `icon`, `announce`,
  `markCurrentNav`. `assets/js/forja-graficos.js`: primitivos de barras, linha e
  anel com tabela de dados equivalente e `aria` (ainda sem consumo de tela).
- `assets/css/system.css`: tokens, primitivos `.ui-*`, estados de foco, campo de
  busca, linhas de detalhe de modal; `assets/css/performance.css` preservado.
- Destaque da navegação: `F.ui.markCurrentNav` é chamado pela própria página a
  partir de `document.body.dataset.page`; o markup das 9 páginas foi corrigido
  (havia `class` duplicado no link ativo, que o navegador ignorava).

### Etapa 3 — biblioteca de exercícios (`2b89632`)
- `treino/biblioteca.html` + `assets/js/forja-catalogo.js` (`F.catalog`,
  `F.pages.biblioteca`): 37 registros com categoria, grupos musculares,
  equipamento, instrução de técnica e série/alvo/descanso sugeridos; busca com
  normalização (ignora acento e caixa) por nome, músculo e equipamento; filtros
  combináveis com contagem; revelação progressiva de 12 em 12; detalhe em modal
  que **não grava nada**; adicionar à rotina com escolha de seção, rollback se a
  gravação for recusada e aviso sonoro/`aria-live`.
- O exercício personalizado do editor ganhou os mesmos metadados (`<details>`
  "Categoria e músculos") e continuam sobrevivendo a backup/importação.
- Entradas: "Biblioteca" no hub, nas páginas de modalidade e no editor.

### Etapa 4 — execução e registro (este commit)
- **Painel de registro por tipo de medição**: o campo certo aparece por
  exercício — repetições, tempo (série por duração), distância com a unidade do
  exercício (`m`/`km`) e "Alvo da série" como pista; RPE por série (select 6–10,
  opcional) e rascunho persistido por exercício (`logDraft`).
- **Corrigir e remover**: cada série logada tem um botão *Corrigir* que abre um
  modal só com os campos que aquele exercício usa; a edição grava `editedAt` e
  mostra "corrigida" na lista. A remoção vale apenas para a **última** série e é
  bloqueada durante descanso ou cronômetro de série em andamento (a série some da
  contagem e pode ser registrada de novo).
- **Descanso ±15 s** (`#rest-minus`/`#rest-plus`) com indicador "ajustado de
  1 min", compatível com descanso pausado (ajusta o tempo restante, não o
  relógio), com piso de 1 s, persistindo por timestamp e revertendo se o
  navegador recusar a gravação. O plano da rotina não é reescrito.
- **Totais reais** (`sessionTotals`) gravados no registro de histórico:
  `volumeKg`, `reps`, `seconds`, `distanceMeters`, `setsLogged`,
  `setsWithoutVolume`. Série sem carga numérica **não** entra no volume e isso é
  dito ao usuário; série por distância não é contada como "faltando volume".
- **Fim de sessão com feedback**: o diálogo de encerrar pede RPE da sessão e
  nota, ambos opcionais, e só aparecem se houve série concluída. O resumo mostra
  volume/reps/tempo/distância, a nota, o esforço registrado e o que faltou para
  o cálculo; a mesma linha aparece na listagem de progresso.
- Nada de guarda `beforeunload` na execução: verificado que toda mutação já é
  gravada antes de mudar a tela (justificativa em `forja-3.0-plano.md`, §4.1).

### Etapa 5 — análise de progresso (este commit)
- **`assets/js/forja-metricas.js`** (novo, puro): não toca em DOM nem em
  armazenamento. Entram registros do histórico e saem números, datas e critérios.
  Cobre períodos (semana segunda→domingo, mês, tudo, personalizado com bloco
  anterior de mesmo tamanho), totais por unidade, séries semanais, frequência de
  12 semanas, lista/evolução de exercícios, recordes, comparação de períodos,
  metas semanais e busca no histórico.
- **Compatibilidade de dados**: registros antigos (sem `totals`) são derivados
  das séries com os mesmos parsers do modelo (`F.parseLoadKg`,
  `F.parseMaxReps`); `finishedAt` inválido cai para `date`; data inexistente
  (31/02) é rejeitada em vez de "rolar" para o mês seguinte. Nenhuma chave nova
  foi criada e nenhum formato mudou.
- **Unidades separadas**: `volumeKg` (kg), `reps`, `seconds`, `distanceMeters`,
  `sets` e `minutes` nunca são somados entre si. Métrica sem dado fica marcada
  como indisponível (`hasVolume`, `hasDistance`, …) e a tela mostra só o que
  existe; série sem carga numérica é contada em `setsWithoutVolume` e declarada.
- **Calendário de frequência**: heatmap de 12 semanas (segunda→domingo), uma
  célula por dia, intensidade = séries concluídas, dias futuros vazios e
  marcados, legenda e resumo textual em `aria-label`.
- **Gráficos reais**: colunas de treinos por semana (8 semanas, semanas zeradas
  incluídas) e barras de séries por semana, ambos com tabela de dados
  equivalente; linha de evolução por exercício com tabela e legenda de critério.
- **Evolução por exercício**: seleção alimentada pelo histórico real (medida
  inferida do que foi registrado), melhor carga/distância por treino, soma de
  repetições/tempo por treino, `unmeasured` para treinos sem valor medido e
  estado vazio explicando que 1 ponto não é evolução.
- **Recordes**: sete categorias, cada uma com o critério visível na tela; só
  aparecem quando há valor medido > 0; empate fica com o registro mais recente;
  as categorias ausentes são listadas no rodapé do bloco.
- **Comparação de períodos**: período atual × bloco anterior equivalente, com
  diferença absoluta, percentual (ou "sem base anterior") e nota sobre o volume.
- **Metas semanais persistentes**: formulário com validação (inteiro, faixa,
  escopo), gravação só ao confirmar (`F.saveGoals` → store) e anéis de progresso
  da semana corrente no escopo da meta. Alvo 0 desliga o item — não existe meta
  padrão escondida. Abrir a página **não grava**.
- **Busca e filtros no histórico**: texto (rotina, exercício, carga digitada e
  nota da sessão, ignorando acento e caixa, exigindo todos os termos), status
  (concluído/parcial) e período; contador "N de M no período" e botão de limpar.
- **Período na URL** (`?periodo=semana|mes|tudo|personalizado&de=&ate=`), sem
  parâmetro quando o padrão é "Tudo".
- **Duplicação removida**: `recordDate`/`formatRecordDate` saíram de
  `forja-treino.js` e `forja-progresso.js`; os dois usam
  `F.metricas.formatRecordDate`, com o mesmo formato de antes.
- **Correção pequena em `forja-graficos.js`**: o `title` das linhas do heatmap
  começava em "Domingo" e terminava em "Sábado", enquanto os dados vão de
  segunda a domingo. Passou a segunda→domingo.

## 3. Testes executados neste ambiente

```sh
npm ci
npm test            # MÉTRICAS + FORJA + PARIDADE
npm run test:e2e    # navegador real (requer Chromium; ver §7)
```

| Suíte | Resultado | O que cobre de verdade |
|---|---|---|
| `tests/metricas.test.mjs` (novo, funções puras) | **18/18 aprovados** | períodos e limites de data, derivação de totais em registro antigo, unidades separadas, ausência de gravação, séries semanais, frequência, lista/evolução de exercícios, recordes (critério, empate, categoria ausente), comparação, metas e busca. Verifica também que nenhuma função muta o registro recebido |
| `tests/forja.test.mjs` (jsdom, 9 páginas) | **41/41 aprovados** | navegação, migrações, rotinas, execução, timers, descanso (inclusive ±15 s), correção/remoção de série, distância, totais e feedback da sessão, biblioteca (busca, filtros, detalhe sem gravar, adicionar à rotina), backup, regras móveis |
| `tests/paridade.test.mjs` | **40/40 aprovados** | regressão de dados e de contrato: migrações idempotentes, nada sobrescreve dados ilegíveis, backup validado, ids referenciados existindo, um único boot/`setInterval`, hash de `forja-calendario.js`, regras CSS móveis travadas |
| `tests/e2e.browser.mjs` (Chromium headless 138) | **17/17 aprovadas** | fluxos reais no navegador: navegação, criar/editar rotina, iniciar, cronômetro por duração, pausa, descanso, resumo, histórico, exportar/importar/desfazer, aviso de armazenamento local, ausência de erro de console/HTTP/recurso ausente, rolagem horizontal e alvos de toque, capturas das 9 páginas em 390 e 1280 px; verificação própria da etapa 5 (calendário de 84 células, gráficos semanais, linha de evolução com 3 pontos, recordes com critério, metas salvas só ao confirmar e persistentes, busca, overflow em 320/390/768/1280 px) |
| checagem de overflow das telas novas (puppeteer, 320/360/390/430/768/1280 px) | **sem overflow** | sessão em andamento, modal de correção, painel de séries e resumo da sessão |
| `git diff --check` | aprovado | — |

Não executado (e por isso não contado como aprovado): teste em aparelho Android
real, leitor de tela (NVDA/VoiceOver), PWA/install, cache offline, compilação de
APK, teste de carga real de IndexedDB, e qualquer verificação no site publicado.

## 4. Limitações conhecidas

1. **Anatomia visual é esquemática.** O atlas (pacote 3.1) existe e agora usa
   uma silhueta humana vetorial proporcional, com regiões musculares pintadas
   por papel — não um boneco de palito ou de blocos. Ainda assim é um esquema:
   sem músculos individualizados, inserções ou vistas laterais. Ele se
   identifica como tal na própria tela. A ilustração por exercício continua não
   existindo, e nada no app simula um desenho para parecer concluído. Ver
   `docs/atlas-anatomico.md`.
2. **Catálogo é curado, não revisado clinicamente.** As 37 fichas (instrução,
   músculos, equipamento, série sugerida) foram escritas para este app e cada
   uma traz texto de técnica e de progressão; não são material de referência
   científica nem substituem avaliação profissional.
3. **Métricas só existem com dado medido.** Recorde de carga exige número na
   carga; recorde de tempo exige série cronometrada; evolução exige 2+ treinos
   com valor medido. Onde falta dado, a tela mostra estado vazio com o critério
   — nada é estimado, interpolado ou preenchido com zero. Também não há edição
   de registro já gravado, então um erro antigo continua contando até ser
   substituído por um novo treino.
4. **Volume depende de carga numérica.** Quem registra "pesado" ou "12+2" no
   campo de carga não entra no volume — o app diz quantas séries ficaram fora em
   vez de chutar um número.
5. **Unilateral sem soma por lado.** Direita/esquerda hoje é texto livre no
   registro; não há contagem separada por lado nem soma bilateral.
6. **Continuidade entre abas.** A sessão vive em `localStorage` com timestamps,
   então recarregar e trocar de página é à prova de falha; duas abas abertas ao
   mesmo tempo podem sobrescrever uma à outra (sem `storage` event e sem lock).
7. **Histórico imutável depois de gravado.** Durante a sessão tudo pode ser
   corrigido; depois de virar registro, a edição não existe — decisão registrada
   no plano para não reescrever histórico real do usuário.
8. **Persistência limitada a ~5 MB por origem** e apagável pelo usuário (limpar
   dados do navegador). A única defesa é a exportação em Configurações, com
   aviso explícito em todas as páginas.
9. **Cores e contraste medidos por inspeção, não por ferramenta de contraste
   automatizada em todas as combinações.**

## 5. Pendências (com a dependência real de cada uma)

| Pendência | Dependência para sair do papel |
|---|---|
| Etapa 6 — Início útil: treino planejado com motivo, resumo da semana, aviso de sessão em andamento, atalhos, estado vazio para usuário novo | nenhuma externa — as métricas puras da etapa 5 (`F.metricas`) já estão disponíveis |
| Etapa 7 — Configurações: auditoria de armazenamento e visualizador de dados preservados, mensagens de importação/corrupção, validação do modelo no backup | nenhuma externa |
| Etapa 8 — paridade estendida às rotas novas e capturas ampliadas (a suíte unitária de funções puras já existe: `tests/metricas.test.mjs`) | nenhuma externa |
| Atlas anatômico detalhado (músculos individuais, vistas laterais) + ilustração por exercício | **dependência de arte/revisão**: o esquema 3.1 é autoral e assumidamente simplificado; um desenho anatômico mais detalhado exige ilustrador ou licença verificável e revisão por profissional de educação física |
| Modelo de metadados completo (dificuldade, padrão de movimento, respiração, erros comuns, segurança, variações, substituições) | conteúdo: cada campo novo exige texto curado por exercício; sem isso, é campo vazio com aparência de recurso |
| Programas prontos por nível e onboarding | conteúdo + decisão de produto (o app não deve prescrever sem critério); UI de perfil com campos opcionais |
| Medidas corporais, IMC com contexto, comparação de datas, fotos de progresso opcionais | produto + política de privacidade local; IMC só com fórmula e limitação explicadas |
| Progressão inteligente | critério auditável (faixa de reps, ganho de carga, recuo de dificuldade) documentado antes da primeira sugestão |
| PWA instalável (manifest, ícones, maskable, standalone) | nenhuma externa; é implementação local |
| Offline com cache versionado, atualização e recuperação | exige estratégia de atualização testada; **deliberadamente adiado** para não servir arquivo velho sem saída |
| Lembretes/notificações | permissão + finalidade; precisa de UI de preferência |
| APK (Capacitor ou TWA) e assinatura | ambiente com Android SDK, JDK, chave de assinatura fora do repositório e dispositivo para validar; nenhum foi executado aqui |
| `IndexedDB` se o volume de dados justificar | decisão depois da etapa 7 (medição do uso real de `localStorage`) |

## 6. Dados, privacidade e recuperação

- Tudo permanece em `localStorage` desta origem; nenhuma requisição de rede é
  feita pelo app, nenhum dado corporal ou de treino sai do dispositivo. Não há
  autenticação, backend, rastreamento ou publicidade (fora do escopo aprovado).
- Chaves preservadas e sem renomear: `forja-treino-exercicios-v1`,
  `forja-treino-rotinas-v1`, `forja-treino-sessao-ativa-v1`,
  `forja-treino-historico-v1`, `forja-treino-metas-v1`, `forja-preferencias-v1`,
  `forja-treino-{migracao,dados-preservados,biblioteca,sessao-ativa-legada}-v1`,
  `forja-backup-seguranca-v1`, além do padrão `forja-missao-AAAA-MM-DD`.
- Campos novos são aditivos: `measure`, `distance`, `distanceUnit`, metadados de
  catálogo no exercício, `distance`/`rpe`/`editedAt` por série, `totals` e
  `feedback` no registro de histórico, `revision: 3` na sessão. Uma instalação na
  versão 3 continua legível pela 2.
- Um carregamento sem dados de treino **não grava chave alguma**; migração roda
  uma vez e é idempotente (FORJA 02/03, paridade 15b); conteúdo ilegível é arquivado em
  `forja-treino-dados-preservados-v1` e exportável (paridade 1b/1e/1f).
- Recuperação: Configurações → exportar backup (JSON com validação de esquema e
  sumário), cópia de segurança automática antes de importar, desfazer a
  restauração, importação inválida rejeitada sem tocar nos dados.
- Testes jamais mexeram em dados reais: rodam em perfil descartável
  (`/tmp`, jsdom ou Chromium temporário) e escrevem fixtures só ali.

## 7. Ambiente: Chromium dos testes E2E

O ambiente não tinha bibliotecas do sistema para o Chromium empacotado.
Extração usada (temporária, fora do repositório):

```sh
mkdir -p /tmp/al2023/chrome-linux /tmp/al2023/lib
node -e "const z=require('zlib'),fs=require('fs');\
fs.writeFileSync('/tmp/al2023/chrome-linux/chrome',z.brotliDecompressSync(fs.readFileSync('node_modules/@sparticuz/chromium/bin/chromium.br')));\
fs.writeFileSync('/tmp/al2023/al2023.tar',z.brotliDecompressSync(fs.readFileSync('node_modules/@sparticuz/chromium/bin/al2023.tar.br')));\
fs.writeFileSync('/tmp/al2023/fonts.tar',z.brotliDecompressSync(fs.readFileSync('node_modules/@sparticuz/chromium/bin/fonts.tar.br')));"
tar -xf /tmp/al2023/al2023.tar -C /tmp/al2023/lib
tar -xf /tmp/al2023/fonts.tar -C /tmp/al2023/lib
chmod +x /tmp/al2023/chrome-linux/chrome

PUPPETEER_EXECUTABLE_PATH=/tmp/al2023/chrome-linux/chrome \
LD_LIBRARY_PATH=/tmp/al2023/lib/lib npm run test:e2e
```

`LD_LIBRARY_PATH=/tmp/al2023/lib` sozinho **não** basta: o arquivo
`al2023.tar.br` desempacota em `lib/lib/` (é daí que `libnspr4.so` é loadada).
Nenhum `package.json` do projeto foi alterado para isso.

Essa extração foi repetida para a etapa 5 e os 17 testes E2E rodaram nesse
Chromium (sem `apt`, sem biblioteca instalada no sistema). Sem
`PUPPETEER_EXECUTABLE_PATH`/`LD_LIBRARY_PATH`, `npm run test:e2e` sai com
"libnspr4.so: cannot open shared object file" neste ambiente — é limitação do
contêiner, não do app.

## 8. Capturas reais do app executado

Geradas pelo E2E (`tests/e2e.browser.mjs`) e por `tools/capturas.mjs`, que
percorre a execução de verdade (registro de séries, ajuste de descanso,
correção, série por distância, resumo) e mede overflow em 320–1280 px antes de
cada captura. As duas rotinas gravam em `artifacts/forja-visual/` usando perfil
descartável do navegador; o conteúdo de rotinas/séries visível é fixture de
teste, nunca dado de usuário real.

```sh
node tools/capturas.mjs                 # atualiza artifacts/forja-visual
node tools/capturas.mjs --out /tmp/x     # sem tocar no repositório
```

| Tela | Mobile 390 px | Desktop 1280 px |
|---|---|---|
| Início (calendário e missões) | [PNG](../artifacts/forja-visual/inicio-390.png) | [PNG](../artifacts/forja-visual/inicio-1280.png) |
| Hub de treino | [PNG](../artifacts/forja-visual/treino-390.png) | [PNG](../artifacts/forja-visual/treino-1280.png) |
| Calistenia | [PNG](../artifacts/forja-visual/calistenia-390.png) | [PNG](../artifacts/forja-visual/calistenia-1280.png) |
| Musculação | [PNG](../artifacts/forja-visual/musculacao-390.png) | [PNG](../artifacts/forja-visual/musculacao-1280.png) |
| Biblioteca de exercícios (etapa 3) | [PNG](../artifacts/forja-visual/biblioteca-390.png) | [PNG](../artifacts/forja-visual/biblioteca-1280.png) |
| Editor de rotina | [PNG](../artifacts/forja-visual/rotinas-390.png) | [PNG](../artifacts/forja-visual/rotinas-1280.png) |
| Execução — início da sessão | [PNG](../artifacts/forja-visual/executar-ativo-390.png) | — |
| Execução — descanso com ±15 s (etapa 4) | [PNG](../artifacts/forja-visual/executar-descanso-390.png) | — |
| Execução — corrigir série (etapa 4) | [PNG](../artifacts/forja-visual/executar-corrigir-390.png) | — |
| Execução — séries registradas com RPE (etapa 4) | [PNG](../artifacts/forja-visual/executar-log-390.png) | — |
| Execução — resumo com volume real (etapa 4) | [PNG](../artifacts/forja-visual/executar-resumo-390.png) | [PNG](../artifacts/forja-visual/executar-resumo-1280.png) |
| Execução — estado sem sessão | [PNG](../artifacts/forja-visual/execucao-390.png) | [PNG](../artifacts/forja-visual/execucao-1280.png) |
| Progresso — análise completa, etapa 5 (calendário, gráficos, metas, recordes, histórico) | [PNG](../artifacts/forja-visual/progresso-etapa5-390.png) | [PNG](../artifacts/forja-visual/progresso-etapa5-1280.png) |
| Progresso — estado após filtro por modalidade | [PNG](../artifacts/forja-visual/progresso-390.png) | [PNG](../artifacts/forja-visual/progresso-1280.png) |
| Configurações | [PNG](../artifacts/forja-visual/configuracoes-390.png) | [PNG](../artifacts/forja-visual/configuracoes-1280.png) |
| Ação TREINO na home (390 px) | [PNG](../artifacts/forja-visual/treino-acao-390.png) | — |

## 9. Comandos

```sh
npm ci
npm test                                  # MÉTRICAS 18/18 + FORJA 41/41 + PARIDADE 40/40
npm run test:e2e                          # E2E em Chromium real (ver §7)
node tools/capturas.mjs                   # capturas da execução + checagem de overflow
npm run serve                             # http://127.0.0.1:8080/forja/ (sirva a pasta pai)
```

O servidor de desenvolvimento precisa expor o repositório sob `/forja/`, igual ao
GitHub Pages, porque todos os links relativos assumem esse prefixo.
