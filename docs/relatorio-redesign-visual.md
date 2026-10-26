# FORJA — relatório do redesign visual

**Data da validação:** 26/10/2026

**Base de comparação:** `main` / `origin/main`, commit `059b235` (PR #33 integrada).

**Revisão validada:** branch `arena/bccf915f-forja`, PR #34. A branch é fixada pelo ambiente Arena.

**Estado da PR:** aberta, sem merge e sem deploy.

## Redesign e comparação visual

Foi adicionada uma camada de apresentação em `assets/css/redesign.css`, carregada apenas nas cinco páginas principais. A revisão das capturas Antes/Depois confirmou mudanças de hierarquia e layout, não só de cor ou acabamento:

- **Início:** antes o CTA ocupava sozinho a largura toda e os resumos vinham depois; agora saudação e próximo treino formam o primeiro bloco, com resumo e metas agrupados abaixo. Em telas pequenas o CTA e os cartões empilham sem perda de ação. Barras de meta, calendário e missões conservam os dados e controles existentes.
- **Treinos:** a lista vertical de largura única passou a cartões comparáveis em duas colunas em desktop, uma coluna no celular; filtro/criação ficam juntos, iniciar e editar permanecem explícitos e as demais ações continuam no menu recolhível.
- **Explorar:** busca maior e mais visível, filtros adicionais compactos/recolhíveis e resultados em grade de duas colunas em desktop/uma em celular. Atlas continua acessível e não foram adicionadas imagens demonstrativas. O título interno da biblioteca é `h2` nesta página, preservando um único `h1`.
- **Progresso:** filtros e período foram agrupados, totais reais ficaram compactos e a evolução medida ganhou prioridade visual; os painéis analíticos restantes continuam acessíveis em seções recolhíveis. O gráfico de evolução conserva alternativa tabular e critério textual.
- **Perfil:** formulário de treino em duas colunas quando há espaço e empilhado no celular; preferências e backup/restauração ficaram em grupos mais definidos, sem criar opções fictícias.
- **Navegação:** em 320 px todos os cinco rótulos ficam visíveis; o ajuste evita truncar “Progresso”. A navegação continua fixa e com as mesmas cinco rotas.

Comparação representativa: [Início — antes, 1280 px](../artifacts/forja-redesign/before/inicio-1280.png) · [depois, 1280 px](../artifacts/forja-redesign/after/inicio-1280.png); [Treinos — antes, 1280 px](../artifacts/forja-redesign/before/treinos-1280.png) · [depois, 1280 px](../artifacts/forja-redesign/after/treinos-1280.png); [Explorar — depois, 320 px](../artifacts/forja-redesign/after/explorar-320.png); [Progresso — depois, 1280 px](../artifacts/forja-redesign/after/progresso-1280.png); [Perfil — depois, 1280 px](../artifacts/forja-redesign/after/perfil-1280.png).

## Capturas e método

Foram geradas **60 capturas de navegador**: 30 Antes e 30 Depois — cinco telas × seis larguras (`320`, `360`, `390`, `430`, `768`, `1280` px). Cada captura mostra o viewport real de **900 px de altura**, com a navegação fixa no seu lugar normal. O relatório de cada conjunto também registra a largura e a altura completa do documento.

- Antes: [`artifacts/forja-redesign/before/`](../artifacts/forja-redesign/before/) — revisão `059b235`, exportada com `git archive` para `/tmp/forja-before`, sem trocar de branch.
- Depois: [`artifacts/forja-redesign/after/`](../artifacts/forja-redesign/after/) — implementação desta PR.
- Relatórios de captura: [`before/capture-report.json`](../artifacts/forja-redesign/before/capture-report.json) e [`after/capture-report.json`](../artifacts/forja-redesign/after/capture-report.json). Cada diretório também contém as 30 imagens PNG.

As duas revisões usaram a mesma ferramenta, o mesmo fixture sintético versionado (`redesign-visual-sample-v1`), o mesmo instante fixo (`2026-10-26T14:00:00-03:00`) e armazenamento isolado/reinicializado por captura. O fixture fornece três rotinas, quatro registros de treino, metas e perfil para que cartões, gráfico e indicadores tenham conteúdo comparável; não representa nem modifica dados de usuário.

## Ambiente de navegador

Não havia Chrome ou Firefox instalado no sistema. O Chromium 138 usado pelos testes já estava empacotado em `@sparticuz/chromium`; seu arquivo `al2023.tar.br` contém `libnspr4.so` e bibliotecas NSS. Extraí essas bibliotecas apenas para `/tmp/forja-browser-libs/lib` e executei os processos com `LD_LIBRARY_PATH=/tmp/forja-browser-libs/lib`. Assim, foi possível usar um navegador real sem adicionar dependências ao aplicativo publicado, alterar testes ou modificar `package.json`/lockfile.

Preparo temporário e execução reproduzível:

```sh
mkdir -p /tmp/forja-browser-libs
node -e "const f=require('node:fs'),z=require('node:zlib');f.writeFileSync('/tmp/al2023.tar',z.brotliDecompressSync(f.readFileSync('node_modules/@sparticuz/chromium/bin/al2023.tar.br')))"
tar -xf /tmp/al2023.tar -C /tmp/forja-browser-libs

# Depois (branch atual)
env FORJA_CAPTURE_NOW='2026-10-26T14:00:00-03:00' LD_LIBRARY_PATH=/tmp/forja-browser-libs/lib node tools/capturas-redesign.mjs artifacts/forja-redesign/after

# Antes (checkout de arquivos da base, sem trocar a branch da sessão)
mkdir -p /tmp/forja-before
git archive 059b235 | tar -x -C /tmp/forja-before
env FORJA_ROOT=/tmp/forja-before FORJA_CAPTURE_NOW='2026-10-26T14:00:00-03:00' LD_LIBRARY_PATH=/tmp/forja-browser-libs/lib node tools/capturas-redesign.mjs artifacts/forja-redesign/before

env LD_LIBRARY_PATH=/tmp/forja-browser-libs/lib npm run test:e2e
```

## Testes e verificações executados

- `npm test` — **aprovado**: métricas 18/18; FORJA 107/107; onboarding 17/17; atlas 12/12; paridade 40/40.
- `LD_LIBRARY_PATH=/tmp/forja-browser-libs/lib npm run test:e2e` — **aprovado em Chromium real**: 34/34 verificações.
- E2E mediu **zero rolagem horizontal** nas larguras 320, 360, 390, 430, 768 e 1280 px em todas as páginas cobertas; também verificou erros de JavaScript, HTTP e recursos ausentes, alvos de toque, navegação, fluxos de dados/backup e as telas principais.
- Capturas Antes/Depois: **0 overflow e 0 erros de página, console ou requisição** em cada conjunto (30 combinações de tela/largura por revisão); relatórios JSON anexos às imagens.
- Parse sintático de `assets/css/redesign.css` com `css-tree` — **aprovado**.
- `git diff --check` — **aprovado**.
- Arquivos protegidos — **sem alterações**: `assets/js/forja-calendario.js`, `assets/anatomia/*`, `assets/js/forja-figura.js`, `assets/js/forja-atlas.js`, `assets/css/atlas.css`, `explorar/atlas.html` e `tests/atlas.test.mjs`.

## Arquivos da implementação

- `assets/css/redesign.css` — camada visual e regras responsivas.
- `assets/js/forja-catalogo.js` — hierarquia semântica do título da biblioteca em Explorar.
- `index.html`, `treino/index.html`, `explorar/index.html`, `progresso/index.html`, `perfil/index.html` — inclusão da folha visual.
- `tools/capturas-redesign.mjs` — captura das cinco telas, com fixture/horário fixos, seleção de raiz para Antes/Depois, medição de overflow e coleta de erros.
- `artifacts/forja-redesign/{before,after}/` — 60 capturas e dois relatórios JSON.
- `docs/relatorio-redesign-visual.md` — este relatório.

## Limitações

1. As capturas mostram os primeiros 900 px do viewport em cada largura; o conteúdo abaixo da dobra continua navegável e as alturas totais estão nos JSONs.
2. Os dados das imagens são sintéticos e controlados para comparação justa, não dados pessoais do usuário.
3. A referência mostra cinco mockups lado a lado; o produto mantém suas páginas e navegação reais para preservar a arquitetura estática e a usabilidade em celulares.
4. Fotografias de exercícios e modelos/personagens 3D permanecem fora do escopo, conforme solicitado.
5. As bibliotecas NSPR/NSS foram extraídas temporariamente em `/tmp`; nenhum pacote de runtime foi adicionado ao GitHub Pages.
