# FORJA — relatório do redesign visual

**Data:** 26/10/2026

**Base examinada:** `main` / `origin/main` em `059b235`

**PR #33:** integrado (`MERGED`) em 26/10/2026; base da PR: `main`.

**Branch desta sessão:** `arena/bccf915f-forja` (fixada pelo ambiente Arena).

## Implementação

Foi adicionada uma camada de apresentação separada em `assets/css/redesign.css`, carregada apenas nas cinco páginas principais. Ela reorganiza a hierarquia e as superfícies sem alterar armazenamento, histórico, contratos do catálogo ou fluxos de ação:

- **Início:** saudação e ação principal, resumo semanal e metas em grupos distintos; progresso por barras; calendário e missões continuam recolhíveis; cartões recentes ficam abaixo da prioridade de treino.
- **Treinos:** filtro e criação agrupados como barra de ferramentas; cartões comparáveis em duas colunas em telas amplas e uma em telas pequenas; iniciar e editar permanecem visíveis; ações adicionais ficam num `details` acessível que já existe no DOM.
- **Explorar:** busca mais destacada; filtros adicionais compactos/recolhíveis; resultados em primeiro plano e atlas acessível pelo cartão próprio. O título da biblioteca passa a `h2` nesta tela, mantendo o único `h1` da página.
- **Progresso:** filtros e período agrupados; totais reais e evolução com prioridade; painéis analíticos secundários permanecem recolhíveis. O gráfico de evolução existente já inclui tabela textual e critério de medição.
- **Perfil:** formulário e preferências organizados em superfícies consistentes; formulário de treino em duas colunas quando cabe; preferências e controles reais de backup/restauração permanecem presentes.
- **Sistema visual compartilhado:** carvão, verde-limão, bordas discretas, títulos Archivo, texto Inter, estados de foco visíveis, alvos de toque ampliados e ajustes para 320–760 px. Nenhuma fotografia de exercício nem personagem/modelo novo foi adicionado.

## Arquivos alterados

- `assets/css/redesign.css` — camada visual e layouts responsivos das cinco telas.
- `assets/js/forja-catalogo.js` — hierarquia de heading da biblioteca na tela Explorar.
- `index.html`, `treino/index.html`, `explorar/index.html`, `progresso/index.html`, `perfil/index.html` — carregam a nova folha visual.
- `tools/capturas-redesign.mjs` — ferramenta reprodutível para capturar as mesmas cinco telas, com o mesmo conjunto local de dados de teste, em 320, 360, 390, 430, 768 e 1280 px.

## Verificações executadas

- `npm test` — **aprovado**: métricas 18/18, testes FORJA 107/107, onboarding 17/17, atlas 12/12, paridade 40/40.
- `git diff --check` — **aprovado**.
- Parse sintático de `assets/css/redesign.css` usando `css-tree` — **aprovado**, 165 regras CSS parseadas.
- Arquivos protegidos — **sem alterações no diff**: calendário, `assets/anatomia/*`, figura, atlas JS/CSS/HTML e `tests/atlas.test.mjs`.
- `npm run test:e2e` — **não executou**: o Chromium empacotado não inicia neste sandbox, pois faltam `libnspr4.so` (e dependências NSS). Nenhum teste de navegador real foi contado como aprovado.

## Capturas e comparação visual — pendente por limitação do ambiente

O gerador de capturas foi executado contra a revisão anterior, mas o processo terminou antes de abrir qualquer página: `/tmp/chromium` falhou ao carregar por falta de `libnspr4.so`. Portanto, **não há capturas Antes/Depois nem comparação visual medida neste workspace**. Não foram substituídas por mockups ou imagens sintéticas.

Quando houver Chromium com bibliotecas NSPR/NSS, executar:

```sh
node tools/capturas-redesign.mjs artifacts/forja-redesign/before
node tools/capturas-redesign.mjs artifacts/forja-redesign/after
```

O script usa a mesma rotina, histórico, metas e perfil de demonstração nos dois diretórios e escreve `capture-report.json` com dimensões, overflow e erros de JavaScript. A ausência das capturas significa que a matriz real de overflow nas seis larguras e a comparação visual **ainda precisam de confirmação no navegador**.

## Limitações remanescentes

1. A validação E2E e as capturas em Chromium dependem de bibliotecas de runtime ausentes no sandbox.
2. A imagem de referência organiza cinco mockups lado a lado; o app real continua sendo um fluxo de páginas com navegação inferior, para preservar sua arquitetura estática e usabilidade móvel.
3. O aceite final de fidelidade visual requer revisar as capturas de navegador nas larguras solicitadas. Esta mudança implementa uma reorganização perceptível de hierarquia/layout, mas não declara essa comparação concluída.
4. A branch de trabalho é fixada pelo ambiente Arena; não foi criada outra branch. A PR de revisão deve sair de `arena/bccf915f-forja`.
