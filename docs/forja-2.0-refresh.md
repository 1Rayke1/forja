# FORJA · atualização Dark Performance

## Escopo desta rodada

Esta entrega preserva o app multipágina e seus fluxos existentes; não introduz login, backend, sincronização ou dependências de runtime. A base do projeto já contém rotinas e exercícios por modalidade, execução persistente, temporizadores baseados em timestamps, histórico parcial/completo, filtros de progresso, biblioteca, preferências e fluxo de backup JSON validado. Esta rodada atualiza o sistema visual e a chamada de ação inicial sem reescrever esses fluxos de persistência.

## Identidade e navegação

`assets/css/performance.css` é carregado após as folhas existentes nas oito páginas e aplica os tokens Dark Performance, componentes de superfície, estados de foco/interação, responsividade desde 320 px e `prefers-reduced-motion`. As cores semânticas existentes são mapeadas para o verde-lima; não há alteração de chave/formato de armazenamento. O atalho de treino da página inicial agora é compacto, horizontal, acionável e com foco visível; a saudação apresenta uma mensagem direta sem conteúdo motivacional atribuído a terceiros.

## Dados

Nenhuma migração ou escrita de dados foi necessária nesta entrega. Permanecem os nomes das chaves e as regras de migração/backup documentadas em `forja-rotinas-e-backup.md`. Dados existentes e backups anteriores não são tocados pelos estilos nem pela mudança de HTML.

## Verificação desta rodada

- `npm test`: 26/26 testes base e 40/40 testes de paridade aprovados.
- `npm run test:e2e`: não iniciou neste ambiente. O Chromium empacotado foi encontrado, mas o processo não consegue carregar `libnspr4.so` (dependência de sistema ausente). Portanto, não houve inspeção visual por navegador real nem capturas de telas nesta execução.
- Não houve teste em aparelho Android real.
- `git diff --check`: aprovado.

## Fora do escopo / pendente de validação

Os filtros de período, metas de frequência semanais com histórico dedicado e gráficos de evolução não fazem parte desta alteração. O projeto continua local ao dispositivo; sincronização futura não está implementada. A nova camada visual foi checada por CSS e pela suíte DOM, mas precisa de E2E em ambiente com as bibliotecas Chromium e inspeção manual em larguras 320/360/390/430 px e tela ampla antes de publicação.
