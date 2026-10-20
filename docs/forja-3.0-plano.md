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

1. Home é calendário + missões: não mostra treino planejado, resumo da semana,
   metas nem histórico — não serve como tela inicial de um app de treino.
2. Biblioteca é um painel dobrável dentro do editor: sem página própria, sem
   filtros por categoria/grupo muscular/equipamento, sem detalhe com instruções,
   e a busca só cobre o nome.
3. Modelo de exercício não tem distância, nem carga numérica, nem metadados
   (categoria, grupos musculares, equipamento, instruções). `load` é texto
   livre, então volume de treino não pode ser calculado de forma confiável.
4. Execução não permite corrigir uma série já registrada (só o rascunho da
   próxima), não permite ajustar o descanso em andamento e não avisa ao sair da
   página com sessão em andamento (`beforeunload` só existe no editor).
5. Progresso é lista de números: sem calendário de frequência, sem gráficos,
   sem recordes, sem evolução por exercício, sem comparação de períodos, sem
   metas, sem busca no histórico. As funções `recordDate`/`formatRecordDate`
   e o resumo de histórico estão **duplicados** entre `forja-progresso.js` e
   `forja-treino.js`.
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

| # | Etapa | Entregável |
|---|---|---|
| 1 | Camada de persistência | `forja-store.js`, registry, `DATA_VERSION`, migrações, refactor de `forja-dados.js`; testes de paridade inalterados e verdes |
| 2 | Sistema de UI | `forja-ui.js`, `forja-graficos.js`, `system.css`, componentes (cabeçalho de página, cartões, chips, segmented, estados vazios, tabela de dados, modal de formulário), foco e `aria` |
| 3 | Catálogo | `treino/biblioteca.html` + `forja-catalogo.js`: busca com normalização, filtros (seção, categoria, grupo muscular, equipamento, tipo de medição), detalhe com instruções, adicionar à rotina; metadados no modelo e no editor |
| 4 | Execução | edição/remoção de série registrada, ajuste de descanso ±15 s, registro de distância, RPE + nota da sessão, guarda de sessão não salva, resumo pós-treino com volume real |
| 5 | Análise de progresso | calendário de frequência, volume semanal, evolução de carga/reps por exercício, recordes com critério, comparação de períodos, filtros por semana/mês/personalizado, metas semanais, histórico pesquisável |
| 6 | Início útil | treino planejado com motivo, resumo da semana, metas, histórico recente, onboarding para usuário novo |
| 7 | Dados e robustez | auditoria de armazenamento e visualizador de dados preservados em Configurações, erros de importação/corrupção, validação do modelo no backup |
| 8 | Testes e docs | suíte unitária de funções puras, integração dos fluxos novos, paridade estendida às rotas novas, E2E com capturas, relatório atualizado |

## 4. Riscos controlados

- As suítes travam o hash de `forja-calendario.js`, a presença de regras CSS
  específicas e um único `setInterval`/boot — nada disso é tocado; novas
  telas reutilizam o tick existente em vez de criar intervalos.
- Testes de paridade comparando o armazenamento inteiro: nenhuma gravação
  ociosa é adicionada.
- Edição de histórico (mudança de registros já gravados) não é feita: as
  correções acontecem durante a sessão, antes do registro final.
