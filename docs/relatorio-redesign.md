# Redesign funcional FORJA — PR #33

## Resultado

Redesign estrutural das cinco telas, sem mudar o carvão, o verde-limão, a marca FORJA ou as fontes Archivo/Inter. Busca, histórico, rotinas, metas, preferências e backups continuam ligados aos dados reais do navegador; nenhum armazenamento foi apagado ou recriado.

## O que mudou

- **Início:** ação de treino/retomada vem primeiro; resumo semanal em faixa, metas comparáveis por progresso, treino mais recente em uma linha e treinos anteriores sob disclosure. Calendário e missões continuam completos, acessíveis e recolhidos inicialmente.
- **Treinos:** rotinas aparecem como linhas comparáveis, com modalidade, exercícios e séries planejadas, nomes reais dos exercícios e ações Iniciar/Editar expostas. Renomear, Duplicar e Excluir estão agrupados em “Mais ações”; rotinas sem exercícios continuam visíveis e não podem ser iniciadas.
- **Explorar:** a biblioteca existente foi montada na própria tela. Busca e resultados ficam juntos; filtros secundários iniciam recolhidos; há um único acesso contextual ao atlas. Não foram acrescentadas imagens nem demonstrações fictícias.
- **Progresso:** filtros e período foram agrupados; evolução por exercício e frequência ganharam prioridade; totais aparecem em faixas compactas. Metas, comparações, semana a semana, recordes, listas por rotina/exercício e histórico completo permanecem disponíveis em disclosures, sem remover valores nem controles.
- **Perfil:** organização em perfil de treino, preferências e dados/backup. Removido somente o teaser não funcional “Medidas em breve”; IDs e campos existentes do perfil, preferências e operações de backup foram preservados. Textos repetidos de armazenamento/privacidade foram consolidados.

## Evidência visual e responsividade

As capturas **antes** foram produzidas a partir do commit anterior do PR (`bfb84f6`); as capturas **depois** usam o mesmo relógio e dados sintéticos determinísticos. As cinco telas foram fotografadas em **320, 360, 390, 430, 768 e 1280 px**. As medições estão junto às imagens em `antes/medicoes.json` e `depois/medicoes.json`.

- [Início — depois, 390 px](capturas/redesign/depois/inicio-390.png) · [antes](capturas/redesign/antes/inicio-390.png)
- [Treinos — depois, 390 px](capturas/redesign/depois/treinos-390.png) · [antes](capturas/redesign/antes/treinos-390.png)
- [Explorar — depois, 390 px](capturas/redesign/depois/explorar-390.png) · [antes](capturas/redesign/antes/explorar-390.png)
- [Progresso — depois, 390 px](capturas/redesign/depois/progresso-390.png) · [antes](capturas/redesign/antes/progresso-390.png)
- [Perfil — depois, 390 px](capturas/redesign/depois/perfil-390.png) · [antes](capturas/redesign/antes/perfil-390.png)

Nas 30 combinações tela/largura: **sem rolagem horizontal e sem erros de console**. Os novos controles compactos têm alvos de toque de 44 px; no calendário em 320 px, cada dia mantém 44 px de altura e a largura inevitavelmente acompanha a grade de sete colunas. Movimento reduzido e foco visível foram mantidos.

## Verificações executadas

- `npm test` — **194/194**: métricas 18, FORJA 107, onboarding 17, atlas 12 e paridade 40.
- `LD_LIBRARY_PATH=/tmp/forja-p13-libs/lib npm run test:e2e` — **34/34 verificações** em navegador real. Inclui um fluxo específico para busca inline de Explorar, filtros recolhidos, acesso único ao atlas e expansão das missões/calendário.
- `node tools/capturas-p13.mjs --out docs/capturas/redesign/depois` — capturas e medições concluídas nas seis larguras.
- `git diff --check` e verificações de sintaxe JavaScript — sem erros.

A biblioteca, o calendário, os backups e o atlas continuam usando suas implementações existentes. `assets/js/forja-calendario.js`, os arquivos protegidos do atlas e os testes do atlas não foram alterados. O PR #33 permanece aberto para revisão; **sem merge e sem deploy**.
