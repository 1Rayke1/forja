# FORJA 3.0 — plano técnico de transformação em app fitness

Documento de planejamento e rastreamento. O relatório de entrega (o que foi
implementado, testado e o que ficou pendente) está em `forja-2.0-refresh.md`.

## 1. Diagnóstico do estado atual (inspeção real)

App multipágina estático (9 páginas sem build), com módulos clássicos em
`assets/js` carregados por todas as páginas.

**Já funciona de verdade** (preservar): CRUD de rotinas por modalidade com
rascunho, edição de exercícios, reordenação dentro da seção, duplicar,
renomear e excluir com confirmação; execução com fila congelada da rotina,
cronômetro de sessão e de série por timestamps, descanso persistente com
pausar/retomar/pular e avanço pendente; registro por série (`reps`/`load`);
histórico com status `completed`/`partial`; biblioteca embutida + personalizados
com busca por nome; progresso com totais, agrupamentos e filtro por modalidade;
backup JSON com validação, cópia de segurança e desfazer; migrações de dados
antigos com arquivo do conteúdo ilegível; calendário/missões; 26 testes de
integração, 40 de paridade e 16 de E2E.

**Limitações reais encontradas:**

1. Home era calendário + missões: não mostrava treino planejado, resumo da
   semana, metas nem histórico — não servia como tela inicial de um app de
   treino. **(→ etapa 6 — resolvida em parte: resumo da semana, metas, rotinas
   reais e histórico recente implementados; "treino planejado do dia" não
   existe porque o modelo não guarda dia da semana — ver §5)**
2. Biblioteca é um painel dobrável dentro do editor: sem página própria, sem
   filtros por categoria/grupo muscular/equipamento, sem detalhe com instruções,
   e a busca só cobre o nome. **(→ etapa 3 — resolvida)**
3. Modelo de exercício não tem distância, nem carga numérica, nem metadados
   (categoria, grupos musculares, equipamento, instruções). `load` é texto
   livre, então volume de treino não pode ser calculado de forma confiável. **(→ etapa 3 — resolvida: `measure`, `distance`, `load` lido como número)**
4. Execução não permite corrigir uma série já registrada (só o rascunho da
   próxima), não permite ajustar o descanso em andamento e não avisa ao sair da
   página com sessão em andamento (`beforeunload` só existe no editor). **(→ etapa 4 — corrigir/editar série, ±15 s e resumo com volume resolvidos; ver nota em 4.1 sobre `beforeunload`)**
5. Progresso é lista de números: sem calendário de frequência, sem gráficos,
   sem recordes, sem evolução por exercício, sem comparação de períodos, sem
   metas, sem busca no histórico. As funções `recordDate`/`formatRecordDate`
   e o resumo de histórico estão **duplicados** entre `forja-progresso.js` e
   `forja-treino.js`. **(→ etapa 5 — resolvida: cálculos em `forja-metricas.js`,
   data do histórico resolvida por `F.metricas.formatRecordDate` nos dois módulos)**
6. Arquitetura: leitura/escrita de `localStorage` espalhada por `forja-core.js`,
   `forja-dados.js`, `forja-sessao.js` e `forja-backup.js`; `F.state` é mutado
   por cinco módulos; validação do backup existe em `forja-backup.js` e em
   `forja-dados.js` com regras ligeiramente diferentes; não há versão de esquema
   declarada (só `version: 2` na sessão e um campo solto no registro de migração)
   nem runner de migração.
7. `forja-calendario.js` usa `localStorage` cru, `alert()` e dependência de IDs
   da home; está travado por hash nas duas suítes (é código legítimo do PR #1 e
   continua intacto — ver limitação no relatório).
8. Nenhuma PWA: sem manifest, sem ícones. Nenhum service worker.

## 2. Decisões de arquitetura

- **Camadas**: núcleo (utilitários/shell) → persistência (`forja-store.js`) →
  modelos e regras (`forja-dados.js`, `forja-catalogo.js`) → cálculos
  (`forja-metricas.js`) → componentes de interface (`forja-ui.js`,
  `forja-graficos.js`) → páginas (um módulo por página).
- **`forja-store.js`**: driver plugável (`localStorage` hoje, adaptador de
  sincronização depois), leitura/escrita com parse seguro, `applySet` com
  verificação pós-gravação e reversão, registro de chaves (`F.registry`) com
  `empty/normalize/validate/summarize` por chave, versão de dados
  (`F.DATA_VERSION = 3`) e runner de migrações idempotente. Todo o resto do app
  passa a gravar por aqui; `F.parseStorageValue`, `F.saveJSON`,
  `F.removeStorageKey`, `F.archivePreservedValue` e `F.recordMigration` viram
  fachadas finas do store, preservando o contrato usado hoje.
- **Compatibilidade preservada**: nenhuma chave existente muda de nome ou de
  formato. Dados novos são **aditivos** (`measure`, `distance`, `loadKg`,
  `metas`, metadados de biblioteca, `revision: 3` na sessão). Migração roda só
  quando há o que migrar e nunca reescreve `forja-treino-exercicios-v1`.
  Carregar o app sem dados de treino continua sem gravar nenhuma chave.
- **Nada inventado**: métricas só aparecem quando há dados suficientes; caso
  contrário o estado vazio explica o critério e o que falta.

## 3. Etapas

| # | Etapa | Status | Entregável |
|---|---|---|---|
| 1 | Camada de persistência | **concluída** | `forja-store.js`, registry, `DATA_VERSION`, migrações, refactor de `forja-dados.js`; testes de paridade inalterados e verdes |
| 2 | Sistema de UI | **concluída** | `forja-ui.js`, `forja-graficos.js`, `system.css`, componentes (cabeçalho de página, cartões, chips, segmented, estados vazios, tabela de dados, modal de formulário), foco e `aria` |
| 3 | Catálogo | **concluída** | `treino/biblioteca.html` + `forja-catalogo.js`: busca com normalização, filtros (seção, categoria, grupo muscular, equipamento, tipo de medição), detalhe com instruções, adicionar à rotina; metadados no modelo e no editor |
| 4 | Execução | **concluída** | edição/remoção de série registrada, ajuste de descanso ±15 s, registro de distância, RPE + nota da sessão, guarda de sessão não salva, resumo pós-treino com volume real |
| 5 | Análise de progresso | **concluída** | calendário de frequência, volume semanal, evolução de carga/reps por exercício, recordes com critério, comparação de períodos, filtros por semana/mês/personalizado, metas semanais, histórico pesquisável |
| 6 | Início útil | **concluída** | resumo real da semana (treinos, séries, tempo, volume quando há carga), metas com progresso, rotinas de calistenia e musculação com iniciar/abrir, retomada de sessão ativa, histórico recente com data/modalidade/status e orientação de primeiro uso — sem treino do dia inventado |
| 7 | Dados e robustez | pendente | auditoria de armazenamento e visualizador de dados preservados em Configurações, erros de importação/corrupção, validação do modelo no backup |
| 8 | Testes e docs | em andamento | suíte unitária de funções puras, integração dos fluxos novos, paridade estendida às rotas novas, E2E com capturas, relatório atualizado |

## 4. Riscos controlados
### 4.1 Saída da tela de execução (verificado, não é falha)

A auditoria suspeitava de perda de rascunho ao fechar a aba durante o treino.
Foi conferido no código: cada mutation da sessão (`registerSet`, rascunho do
painel de registro, ajuste de descanso, pausa, correção/remoção de série) passa
por `saveActiveWorkout()` → `forja-store.js`, com verificação pós-gravação e
reversão em caso de recusa do navegador. Não há estado "só na tela" a perder,
então **não foi adicionado `beforeunload`** na execução: ele bloquearia a
navegação para proteger nada e puniria quem só quer voltar ao treino. O editor de
rotinas mantém a guarda que já tinha (lá existe rascunho sem gravar).

### 4.2 Componentes sem consumo de tela ainda não contam como prontos

`forja-graficos.js` (barras, colunas, linha, heatmap e anel acessíveis) e a
camada de metas semanais (`forja-treino-metas-v1`, `F.normalizeGoals`, resumo no
backup) estavam carregados e validados, mas sem consumo de tela até a etapa 4.
**Na etapa 5 passaram a ser usados pela página de Progresso** (heatmap de
frequência, colunas e barras semanais, linha de evolução, anéis de meta e
tabelas acessíveis) e, na etapa 6, o Início passou a consumir as mesmas
métricas (resumo semanal e progresso de metas em barras
`role="progressbar"`). Nenhum componente acessível do sistema de UI segue sem
tela; o relatório de entrega lista cada item separadamente.

### 4.3 Critérios de métrica escritos antes de exibir número

Toda métrica da etapa 5 tem critério declarado e testado:

- **Recordes** (`F.metricas.personalRecords`): carga por série, repetições por
  série, tempo por série, distância por série, volume por treino, séries por
  treino e duração de treino. Cada item leva `criteria` em texto e só existe
  quando há valor medido > 0; empate fica com o registro mais recente. Carga em
  lb é convertida para kg; anotação sem número ("pesado") não vira recorde.
- **Evolução** (`F.metricas.exerciseEvolution`): a medida vem das séries
  registradas (distância > carga > tempo > repetições). Carga e distância usam o
  **melhor valor por treino**; tempo e repetições usam a **soma do treino**. A
  linha só aparece com 2+ treinos medidos; treino sem valor medido é contado e
  declarado (`unmeasured`).
- **Comparação** (`F.metricas.comparePeriods`): período atual contra o bloco
  imediatamente anterior de mesmo tamanho. "Tudo" não compara, porque não há
  período anterior — a tela diz isso em vez de escolher um recorte escondido.
  Sem base anterior, o percentual é `null` e a tela escreve "sem base anterior".
- **Metas** (`F.metricas.goalProgress`): semana segunda→domingo, escopo salvo na
  própria meta (`all`/modalidade), alvo 0 desliga o item. Metas não dependem do
  filtro de modalidade da página.
- **Frequência** (`F.metricas.frequency`): 12 semanas fixas, célula = séries
  concluídas no dia (mesma escala do heatmap). Dias futuros aparecem vazios e
  marcados (`future`).

### 4.4 Início: o que a home pode afirmar (etapa 6)

- **Semana** = semana corrente do calendário local, segunda→domingo, exatamente
  `F.metricas.resolvePeriod("week")` — a mesma janela das metas no Progresso.
  Treino fora da semana não entra; o registro antigo é contado no histórico
  recente, não no resumo.
- **Zero × ausente**: `summarize` devolve `durationMs: 0` tanto para "treinou
  sem cronômetro" quanto para "não treinou". Por isso a tela só escreve tempo
  quando `durationMs > 0`; caso contrário mostra `—` com o motivo. Já o número
  de treinos só aparece como `0` quando existe histórico (e a semana está
  vazia); sem histórico a tela usa estado vazio com explicação.
- **Metas** só aparecem se estiverem configuradas (`goalProgress(...).active`);
  alvo 0 continua desligando o item e nenhuma meta padrão é criada.
- **Próximo treino**: a ordem é "mais recentemente treinada primeiro", com a
  data vinda do histórico (`routineId` e, para registros antigos, nome exato).
  Rotina nunca treinada aparece depois, em ordem alfabética. A seção diz que o
  app **não** guarda treino agendado por dia.
- **Histórico recente**: limite de 5, ordenado por `F.metricas.recordDate`.
  Registro sem data legível vai para o fim em vez de receber uma data qualquer.
  Nada é reescrito nem duplicado para exibir.
- **Nenhuma gravação**: a home só lê. A única escrita possível a partir dela é
  iniciar um treino, que grava a sessão ativa pelo módulo de sessão.



- As suítes travam o hash de `forja-calendario.js`, a presença de regras CSS
  específicas e um único `setInterval`/boot — nada disso é tocado; novas
  telas reutilizam o tick existente em vez de criar intervalos.
- Testes de paridade comparando o armazenamento inteiro: nenhuma gravação
  ociosa é adicionada.
- Edição de histórico (mudança de registros já gravados) não é feita: as
  correções acontecem durante a sessão, antes do registro final.
- Abrir a página de Progresso não grava nada (teste FORJA 38 compara o storage
  antes/depois de navegar, filtrar e buscar). A única escrita da tela é
  `F.saveGoals` quando o formulário é enviado.
- O calendário de frequência e o gráfico semanal têm janela própria (12 e 8
  semanas) e não seguem o período selecionado — a tela explica; um calendário de
  sete dias não mostraria frequência.
- A home **não grava nada**: nem ao abrir, nem ao trocar de mês, nem ao
  redesenhar. O ouvinte de `F.store.onChange` só chama renderização. A única
  escrita possível a partir dela é iniciar um treino (sessão ativa, via
  `F.startRoutine`). FORJA 48/49 comparam o armazenamento inteiro antes/depois.
- O `index.html` ganhou quatro seções e novos `id`s (`home-week-body`,
  `home-next-body`, `home-recent-body`, `home-guide-body`); nada existente foi
  renomeado ou removido, e o bloco de calendário/missões do HTML continua igual
  em estrutura (o hash travado é o do JS).

## 5. Evidência por etapa

| Etapa | O que ficou de pé | Como foi verificado |
|---|---|---|
| 1 | `forja-store.js` (driver, leitura/escrita segura, `applySet` com reversão), `F.registry` por chave, `F.DATA_VERSION = 3`, runner de migrações idempotente; `forja-dados.js`/`forja-backup.js` passando pelo store | `npm test` (na época 26/26 + 40/40) sem alterar nenhum hash travado; testes 15a–15d e 1b–1g de paridade cobrem "não grava chave ociosa", idempotência e preservação de conteúdo ilegível |
| 2 | `forja-ui.js` (botões, chips, segmented com teclado, tabela, estado vazio, cabeçalho de seção, `announce`), `forja-graficos.js`, `system.css` com tokens e primitivos `.ui-*`; destaque da navegação marcado por `F.ui.markCurrentNav` a partir de `data-page` | E2E de foco/aria (teste 04 da suíte base: um `[aria-current=page]` por página), suíte de paridade 9/9b/12a, E2E 16/16 |
| 3 | `treino/biblioteca.html` + `forja-catalogo.js`: 37 exercícios com metadados, busca com normalização NFD, filtros combináveis, revelação progressiva (12 por bloco), detalhe sem gravar nada, adicionar à rotina com rollback; metadados no editor de rotina e link da biblioteca nas páginas de modalidade | Testes FORJA 27, 27b, 28, 29, 30; paridade 10 (ids e ausência de erro de console); E2E cobre a rota nova em 6 larguras; capturas `biblioteca-390/1280.png` |
| 4 | Correção e remoção da última série por série; ajuste do descanso em andamento em passos de 15 s (com pausar/retomar e persistência por timestamp); registro de distância por série com unidade do exercício; RPE por série e RPE/nota da sessão; totais reais (`volumeKg`, `reps`, `seconds`, `distanceMeters`, `setsLogged`, `setsWithoutVolume`) no registro e no resumo; nota e esforço aparecem no histórico | Testes FORJA 31, 32, 33, 33b (fluxo real na página, incluindo recarregar no meio do descanso ajustado); suíte completa 35/35 + 40/40; E2E 16/16; checagem de overflow das telas novas em 320–1280 px; capturas `executar-log/descanso/corrigir/resumo-390.png` e `executar-resumo-1280.png` |
| 5 | `forja-metricas.js`: períodos (semana/mês/tudo/personalizado com comparação do bloco anterior), totais por unidade, séries semanais, frequência de 12 semanas, evolução por exercício (4 medidas), recordes com critério, comparação de períodos, metas semanais e busca/filtro do histórico. Página de Progresso reescrita consumindo `forja-graficos.js` e a camada de metas; formulário de metas (`forja-treino-metas-v1`) com validação e persistência; busca no histórico (rotina, exercício, carga digitada, nota) + status; controles de período na URL. `recordDate`/`formatRecordDate` deixaram de ser duplicados (usados de `F.metricas` em progresso e treino) | `npm test`: métricas 18/18, FORJA 41/41 (34–39 novos, incluindo comparação de storage antes/depois para provar ausência de gravação ociosa e o teto de 200 registros), paridade 40/40 (hash do calendário e count de `setInterval` intactos); `npm run test:e2e` 17/17 com verificação nova da tela em Chromium real (calendário, gráficos, recordes, metas salvas e persistentes, busca, overflow em 320/390/768/1280 px); capturas `progresso-etapa5-390.png` e `progresso-etapa5-1280.png` |
| 6 | Início útil: `forja-inicio.js` (resumo semanal, metas, rotinas reais com iniciar/abrir, retomada de sessão, histórico recente, orientação de primeiro uso) + seções em `index.html` + estilos `.home-*` em `app.css`; calendário/missões e banner de sessão preservados sem tocar no arquivo travado por hash | `npm test`: métricas 18/18, FORJA 51/51 (42–50 e 43b novos: home vazia, rotinas das duas modalidades, escape de nome hostil, semana com parcial, metas com e sem configuração, ordenação do histórico, sessão ativa, atualização sem recarregar, ausência de gravação ociosa, calendário/missões preservados), paridade 40/40 (hash do calendário intacto); `npm run test:e2e` 18/18 com verificação nova em Chromium real (semana, metas, rotinas, histórico, retomada, estados vazios, overflow em 320/360/390/430/768/1280 px); capturas `inicio-etapa6-390.png`, `inicio-etapa6-1280.png` e `inicio-novo-390.png` |
