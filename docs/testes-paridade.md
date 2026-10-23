# Testes de paridade: correspondência com a suíte antiga

A suíte de página única (39 testes, em `acbcbfb:tests/forja.test.mjs`) foi portada para o app multipágina em `tests/paridade.test.mjs`. Os nomes são os originais, para rastreio. Nenhum teste foi removido; cada um exercita o mesmo comportamento pelas páginas reais, com o mesmo armazenamento.

Testes novos além dos 39:

| Novo | Nome | Arquivo | Descrição |
|---|---|---|---|
| + | 9b. Botão TREINO quadrado, destacado, com ícone e texto (mobile) | tests/paridade.test.mjs | Marcação, ícone, texto e regra CSS de quadrado. A medição real em 390 px está em `tests/e2e.browser.mjs`. |

As telas e regras novas das etapas 3–5 são cobertas onde o comportamento vive,
sem afrouxar nenhum dos 39 testes portados:

- funções puras de análise → `tests/metricas.test.mjs` (18 testes, jsdom sem página);
- fluxo real de catálogo, execução e progresso → `tests/forja.test.mjs` (27–39);
- contrato preservado (hash de `forja-calendario.js`, um único `setInterval`,
  ausência de gravação ociosa, ids e boot) → continua em `tests/paridade.test.mjs`
  (12b, 15a–15d) e agora também em FORJA 38, que compara o armazenamento antes e
  depois de navegar, filtrar e buscar na página de Progresso;
- atlas anatômico (pacote 3.1) → `tests/atlas.test.mjs` (11 testes em jsdom,
  chamados por `npm test`), mais a verificação de fluxo e as capturas no
  navegador real em `tests/e2e.browser.mjs`. A relação requisito → teste está em
  `docs/atlas-anatomico.md` §5.
- a verificação de integridade do paridade (teste 10) passou a considerar
  `explorar/index.html` e `explorar/atlas.html` na lista de páginas com IDs
  referenciados pelos módulos.

| # | Teste antigo | Teste novo | Como foi portado |
|---|---|---|---|
| 1 | 1. Migração dos dados antigos | tests/paridade.test.mjs | Migração lida em index.html (missões) e páginas de treino; mesmas chaves e formatos. |
| 2 | 1b. Migração não destrói JSON corrompido | tests/paridade.test.mjs | Mesma verificação de JSON corrompido, com boot pela página de treino. |
| 3 | 1c. Rotinas ausentes são reconstruídas a partir do legado | tests/paridade.test.mjs | Rotinas reconstruídas do legado; checagem igual. |
| 4 | 1d. Auditoria: calendário, missões, exercícios e histórico são preservados | tests/paridade.test.mjs | Auditoria de dados preservados; leitura por storage, não pelo DOM único. |
| 5 | 1e. Conteúdo parcialmente inválido é arquivado, nunca descartado | tests/paridade.test.mjs | Arquivamento de conteúdo inválido, igual ao original. |
| 6 | 1f. Formato antigo ilegível não é sobrescrito por rotinas vazias | tests/paridade.test.mjs | Formato ilegível não é sobrescrito; igual ao original. |
| 7 | 1g. Sessão ativa com itens não reconhecidos preserva o original | tests/paridade.test.mjs | Sessão com itens desconhecidos preserva o original; igual. |
| 8 | 2. Criar, editar, duplicar, renomear, reordenar e excluir rotinas | tests/paridade.test.mjs | Editor de rotina em treino/rotina.html (navegação por links reais). |
| 9 | 2b. Rotina não é iniciada sem exercícios e alterações não salvas são protegidas | tests/paridade.test.mjs | Bloqueio de início sem exercícios e proteção de alterações não salvas em rotina.html. |
| 10 | 3. Calistenia e Musculação têm rotinas e históricos separados | tests/paridade.test.mjs | Hub treino/index.html → calistenia.html / musculacao.html. |
| 11 | 4. Execução com descanso, pausa, retomada e avanço automático | tests/paridade.test.mjs | Execução em treino/executar.html; mesmos IDs de controle. |
| 12 | 4b. Pular descanso não prende o usuário e descanso manual funciona | tests/paridade.test.mjs | Pular descanso e descanso manual em executar.html. |
| 13 | 5. Recarregar a página durante uma sessão ativa | tests/paridade.test.mjs | Recarga com sessão ativa; storage preservado entre boots. |
| 14 | 6. Concluir e cancelar sessões sem corromper o histórico | tests/paridade.test.mjs | Concluir/cancelar; toast de descarte lido logo após a ação (é consumido ao trocar de página). |
| 15 | 7. Exportar e importar backup JSON com validação e segurança | tests/paridade.test.mjs | Backup via configuracoes/index.html; import com validação e confirmação. |
| 16 | 7b. Backup inclui sessão ativa e a restaura com segurança | tests/paridade.test.mjs | Sessão ativa no backup, restaurada com segurança. |
| 17 | 7c. Importação de backup antigo sem rotinas gera rotinas padrão | tests/paridade.test.mjs | Backup antigo sem rotinas gera rotinas padrão. |
| 18 | 8. Calendário e missões antes e depois das alterações | tests/paridade.test.mjs | Calendário e missões em index.html. |
| 19 | 9. Base responsiva presente (viewport e media queries) | tests/paridade.test.mjs | Viewport e media queries lidos de assets/css/*.css (antes: <style> inline). |
| 20 | 10. Integridade: ids referenciados existem e nenhum erro de console | tests/paridade.test.mjs | Ids referenciados por assets/js checados contra o HTML de todas as páginas, e botões essenciais por página. |
| 21 | 11a. Calendário e missões: dias, conclusão, exclusão e persistência | tests/paridade.test.mjs | Calendário e missões em index.html. |
| 22 | 11b. Um envio cria exatamente um item (sem listeners duplicados) | tests/paridade.test.mjs | Um envio cria exatamente um item; listeners conferidos em forja-calendario.js. |
| 23 | 11c. Missões antigas em formato de texto continuam funcionando | tests/paridade.test.mjs | Missões em formato de texto antigo. |
| 24 | 12a. IDs únicos inclusive com modal, editor e execução abertos | tests/paridade.test.mjs | IDs únicos com modal, editor e execução abertos (em páginas reais). |
| 25 | 12b. Nenhuma função/ID antiga referenciada e um único boot | tests/paridade.test.mjs | Funções removidas checadas em assets/js e HTML; deleteExercise/renderExercises/renderHistory reaproveitados como funções locais de módulo (checadas como handler inline e global). Único boot: forja-app.js incluído uma vez por página. SHA de forja-calendario.js. |
| 26 | 12c. Regras móveis de calendário/missões seguem presentes em ≤380px | tests/paridade.test.mjs | Regras de 380 px lidas de todos os arquivos de assets/css. Correção: base.css tinha um bloco @media sem fechamento; agora balanceado e checado. |
| 27 | 13a. Exportar/importar/desfazer preserva todas as chaves exatamente | tests/paridade.test.mjs | Backup por configuracoes/index.html: exportar, importar e desfazer. |
| 28 | 13b. Falha de gravação na importação restaura os dados e informa a chave | tests/paridade.test.mjs | Falha de gravação na importação, com rollback e mensagem da chave. |
| 29 | 13c. Falha também no rollback é reportada sem esconder as chaves afetadas | tests/paridade.test.mjs | Falha também no rollback: reportada, cópia de segurança completa. |
| 30 | 13d. Falha ao criar a cópia de segurança aborta sem alterar dados | tests/paridade.test.mjs | Falha ao criar a cópia de segurança aborta sem alterar dados. |
| 31 | 13e. Exportar sem dados orienta o usuário e não gera arquivo vazio | tests/paridade.test.mjs | Exportação vazia sem arquivo, na página de configurações. |
| 32 | 14a. Pausar a sessão durante o descanso pendente e recarregar mantém o avanço | tests/paridade.test.mjs | Pausa com avanço pendente, recarga em treino/executar.html. |
| 33 | 14b. Pausar apenas o descanso pendente e recarregar mantém o avanço | tests/paridade.test.mjs | Pausa só do descanso pendente, recarga e retomada. |
| 34 | 14c. Estado inconsistente não pula séries pendentes | tests/paridade.test.mjs | Estado inconsistente: séries pendentes não são puladas (lido de F.state). |
| 35 | 14d. Descanso pendente no último exercício conclui a sessão uma única vez | tests/paridade.test.mjs | Último exercício com descanso pendente conclui uma única vez. |
| 36 | 15a. Carregar só com missões não grava nenhuma chave de treino | tests/paridade.test.mjs | Boot só com missões não grava chaves de treino (index.html). |
| 37 | 15b. Migração é idempotente em três carregamentos consecutivos | tests/paridade.test.mjs | Migração idempotente em três boots consecutivos. |
| 38 | 15c. Sessão antiga com progresso extra migra e preserva o original | tests/paridade.test.mjs | Sessão antiga com progresso extra migra e arquiva o original. |
| 39 | 15d. Rotinas existentes impedem migração duplicada do legado | tests/paridade.test.mjs | Rotinas existentes impedem migração duplicada do legado. |
