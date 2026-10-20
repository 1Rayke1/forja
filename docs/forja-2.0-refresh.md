# FORJA · atualização Dark Performance

## Escopo

Esta entrega preserva o app multipágina e seus fluxos existentes; não introduz login, backend, sincronização ou dependências de runtime. A base já contém rotinas/exercícios por modalidade, execução persistente, timers com timestamps, histórico parcial/completo, biblioteca, filtros de modalidade, preferências e backup JSON validado. A rodada atualiza o sistema visual, melhora a responsividade do editor e do resumo de progresso, sem alterar as chaves de persistência.

## Identidade e navegação

`assets/css/performance.css` é carregado nas oito páginas e aplica os tokens Dark Performance, componentes de superfície, foco visível e `prefers-reduced-motion`. A home usa um acesso compacto para iniciar treino. A camada visual evita mexer nos contratos HTML/JS que a suíte multipágina exercita.

Na inspeção visual, ajustei o seletor de modalidade do progresso para caber em telas estreitas sem quebrar “Musculação” em duas linhas, o seletor de tipo de exercício no editor para usar a largura móvel disponível, e a altura do calendário no desktop para evitar células quadradas desproporcionais. O atalho de treino segue compacto.

## Persistência e privacidade

Nenhuma migração ou escrita de dados da instalação do usuário foi necessária. As capturas e testes E2E são feitos num Chromium automatizado com perfil temporário e dados de teste; não acessam o `localStorage` do navegador do usuário. Permanecem inalterados os nomes das chaves, formatos e regras de migração/backup documentados em `forja-rotinas-e-backup.md`.

## Validação executada

- `npm test`: **26/26 testes base e 40/40 testes de paridade aprovados**.
- `npm run test:e2e`: **16/16 verificações aprovadas** em Chromium real/headless, incluindo fluxo de navegação, criação/edição de rotinas, modalidades separadas, treino, pausa/retomada, descanso, histórico, backup/restauração, ausência de erros JS/HTTP e overflow horizontal.
- Viewports com medição de overflow em **320, 360, 390, 430, 768 e 1280 px** em todas as rotas do teste.
- Capturas reais automatizadas em **390 px e 1280 px** para Início, hub, Calistenia, Musculação, editor de rotina, Execução, Progresso e Configurações. Uma captura adicional mostra sessão ativa em execução.
- Os testes de fluxo de rotina/exercício/descanso/histórico e backup foram executados de novo em E2E; não foi necessário redefinir armazenamento de usuário. Os dados manipulados pertencem ao perfil descartável do teste.
- `git diff --check`: aprovado.
- Teste Android: **não executado em aparelho real**. O Chromium desktop/headless não substitui verificação física de Android.

## Chromium no ambiente

A falha original ocorreu porque `libnspr4.so` não estava no caminho de bibliotecas do sistema. Não foi necessário alterar dependências do projeto nem o `package.json`: usei a biblioteca `al2023.tar.br` já empacotada pela dependência de teste `@sparticuz/chromium`, extraída para `/tmp/al2023`, e executei:

```sh
LD_LIBRARY_PATH=/tmp/al2023/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH} npm run test:e2e
```

A extração é temporária do ambiente, não entra no repositório e permite que o Chromium bundled carregue as bibliotecas compatíveis. O comando E2E padrão sem essa variável continua dependendo das bibliotecas do sistema instaladas.

## Capturas

Capturas de teste, renderizadas pelo Chromium. O conteúdo de missões e sessões que aparece em algumas delas é fixture de E2E, não dado de usuário real.

| Página | Mobile 390 px | Desktop 1280 px |
|---|---|---|
| Início | [PNG](../artifacts/forja-visual/inicio-390.png) | [PNG](../artifacts/forja-visual/inicio-1280.png) |
| Hub de treino | [PNG](../artifacts/forja-visual/treino-390.png) | [PNG](../artifacts/forja-visual/treino-1280.png) |
| Calistenia | [PNG](../artifacts/forja-visual/calistenia-390.png) | [PNG](../artifacts/forja-visual/calistenia-1280.png) |
| Musculação | [PNG](../artifacts/forja-visual/musculacao-390.png) | [PNG](../artifacts/forja-visual/musculacao-1280.png) |
| Editor de rotina | [PNG](../artifacts/forja-visual/rotinas-390.png) | [PNG](../artifacts/forja-visual/rotinas-1280.png) |
| Execução (estado sem sessão) | [PNG](../artifacts/forja-visual/execucao-390.png) | [PNG](../artifacts/forja-visual/execucao-1280.png) |
| Progresso | [PNG](../artifacts/forja-visual/progresso-390.png) | [PNG](../artifacts/forja-visual/progresso-1280.png) |
| Configurações | [PNG](../artifacts/forja-visual/configuracoes-390.png) | [PNG](../artifacts/forja-visual/configuracoes-1280.png) |
| Execução (sessão ativa) | [PNG 390 px](../artifacts/forja-visual/executar-ativo-390.png) | — |

## Limitações

- As capturas são feitas por Chromium automatizado, não em Android físico; comportamento tátil, teclado virtual e diferenças de Chrome Android precisam de validação manual antes de release.
- O app continua local ao dispositivo; sincronização futura não existe.
- Metas semanais com histórico dedicado, gráficos e filtros por período continuam fora do escopo desta continuação.
- Não foi realizado deploy, publicação nem merge.
