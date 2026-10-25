# Lista prevista de arquivos

O que muda se o plano de `07-plano-por-etapas.md` for aprovado. Nada aqui foi
alterado — este documento é uma previsão verificada contra a árvore atual
(commit `17a9157`).

Legenda: **novo** (não existe hoje) · **altera** (existe, recebe mudança) ·
**intocado** (não pode ser tocado).

---

## 1. Arquivos novos

| Caminho | O que contém | Tamanho previsto |
| --- | --- | --- |
| `assets/css/marca.css` | tokens `--fj-*` e `@font-face` das duas famílias; da etapa 3 em diante, estilos de componente, superfície e estado aplicados por **seletor explícito** com esses tokens — sem redefinir token legado | 25–35 KB |
| `assets/fontes/archivo-variable-latin.woff2` | Archivo variável (wght 100–900, `wdth`) | 88 KB |
| `assets/fontes/inter-variable-latin.woff2` | Inter variável | 47 KB |
| `assets/fontes/OFL-Archivo.txt`, `OFL-Inter.txt` | licenças (obrigatório redistribuir) | 8 KB |
| `assets/marca/emblema.svg` | emblema bigorna e chama em `currentColor` | 0,7 KB |
| `assets/marca/emblema-24.svg` | emblema óptico (aro 3,6 · miolo +7,5%) | 0,8 KB |
| `assets/marca/emblema-compacto.svg` | sem aro, para ≤ 20 px | 0,6 KB |
| `assets/marca/emblema-duo.svg` | duas cores: bronze + brasa | 0,7 KB |
| `assets/marca/bigorna.svg` | grafismo de estado vazio | 0,4 KB |
| `assets/marca/icone-app.svg` | disco vazado (512 px) | 0,7 KB |
| `assets/marca/favicon.svg` | 32 × 32 com fundo carvão | 0,6 KB |
| `assets/marca/logo-horizontal.svg` | lockup (nome contornado) | 12–18 KB |
| `assets/marca/logo-horizontal-claro.svg` | idem, preto quente | 12–18 KB |
| `assets/marca/logo-horizontal-mono.svg` | uma cor | 12–18 KB |
| `assets/marca/logo-horizontal-duo.svg` | emblema duo + nome | 12–18 KB |
| `assets/marca/logo-vertical.svg` | emblema sobre nome | 12–18 KB |

**Total novo:** 17 arquivos — 1 CSS, 2 fontes, 2 licenças e 12 vetores
(≈ 220 KB, dos quais 135 KB de fonte). Nenhuma dependência de rede: tudo local.

> Doze dos dezesseis vetores de `design/marca/svg/` são copiados para
> `assets/marca/` (com nomes curtos); os que ficam só no laboratório são
> `emblema-cunha.svg` (secundário), `logo-horizontal-bronze.svg`,
> `logo-horizontal-claro.svg`, `logo-vertical-escuro.svg`, `logo-vertical-duo.svg`
> e `logo-vertical-claro.svg` — material de marca, não de produto. Não há
> geração em tempo de build: `design/` continua fora do app e pode ser
> removido depois da aprovação sem quebrar nada.
>
> Os dois vetores da revisão 1 (`emblema-chapas.svg` e
> `emblema-chapas-compacto.svg`) estão em `design/marca/svg/descartados/` e
> **não** entram em `assets/`.

---

## 2. Páginas que mudam

As 12 páginas recebem, no mínimo, três linhas no `<head>` (stylesheet, favicon,
`theme-color`) e `preload` das fontes. O resto varia:

| Página | Linhas | Mudanças previstas | Etapa |
| --- | --- | --- | --- |
| `index.html` | 165 | head + logo + **reestruturação visual** de 8 blocos (saudação, ação, semana, metas, último treino, calendário, missões, onboarding) | 2, 5, 6 |
| `treino/index.html` | 123 | head + logo + `.modality-card` (ícone real ao lado do número) + rodapé de ações | 2, 5, 7 |
| `treino/calistenia.html` | 129 | head + logo + `.routine-card` (seções em grade, hierarquia de ações) + `.screen-toolbar` | 2, 5, 7 |
| `treino/musculacao.html` | 129 | idem (arquivo quase idêntico) | 2, 5, 7 |
| `treino/rotina.html` | 317 | head + logo + editor (4 seções, `.editor-exercise`, `.dirty-pill`, barra fixa) | 2, 5, 7 |
| `treino/biblioteca.html` | 115 | head + logo + filtros e `.ui-exercise-row` | 2, 5, 7 |
| `treino/executar.html` | 280 | head + logo + cabeçalho, foco, pips, cronômetro, descanso, resumo | 2, 5, 7 |
| `progresso/index.html` | 244 | head + logo + resumo, metas, heatmap, comparação, recordes, histórico | 2, 5, 8 |
| `perfil/index.html` | 180 | head + logo + **8 `style=""` inline → classes** · formulário e painéis de dados | 2, 5, 9 |
| `configuracoes/index.html` | 134 | head + logo + painéis | 2, 5, 9 |
| `explorar/index.html` | 126 | head + logo + **4 `style=""` inline → classes** · `◉`/`◎` → SVG | 2, 5, 9 |
| `explorar/atlas.html` | 111 | **intocado** (ver §5) | — |

Total de páginas alteradas: **11 de 12**.

---

## 3. CSS que muda

| Arquivo | Linhas | Mudança | Etapa |
| --- | --- | --- | --- |
| `base.css` | 474 | tipografia base (família, escala, `line-height`), `body` e superfícies; **sem** reescrever layout | 3 |
| `system.css` | 483 | componentes (botões, campos, chips, stats, modal, toast) — ajustes pontuais, mantendo as regras que os testes leem | 3, 4 |
| `app.css` | 747 | cabeçalho, navegação, cartões da home — **mantendo** `position: fixed`, `env(safe-area-inset-bottom)` e `padding-bottom: calc(var(--bottom-nav-height)…)` que os testes exigem | 5, 6 |
| `treino.css` | 735 | cartões de rotina, editor, biblioteca — mantendo `.hub-list` em grid e `.big-set-button` | 7 |
| `execucao.css` | 447 | foco, pips, cronômetro, descanso, resumo | 7 |
| `responsive.css` | 84 | ajustes de 380/430/600/760/1024; **manter** `@media (max-width: 380px)` (teste 24) | 3, 7 |
| `performance.css` | 11 | **intocado**: a camada nova não redefine `--bg`/`--panel`/`--accent`/`--lime` nem o sobrescreve. A troca de cor entra por componente, nas etapas 4 e 5, com tokens `--fj-*` em seletor explícito | — |
| `configuracoes.css` | 35 | painéis da página de configurações | 9 |
| `atlas.css` | 597 | **intocado** | — |
| `marca.css` | — | **novo** | 2–10 |

**Arquivos CSS alterados: 8 de 9 existentes + 1 novo.**

---

## 4. JavaScript que muda

Muito pouco — de propósito.

| Arquivo | Linhas | Mudança permitida | Mudança proibida |
| --- | --- | --- | --- |
| `forja-graficos.js` | 357 | constantes de cor/espessura no topo do arquivo | qualquer cálculo |
| `forja-ui.js` | 547 | `ICON_PATHS` (desenho dos 26 ícones) | assinatura das funções, `showModal`, `toast`, i18n |
| `forja-app.js` | 66 | nenhuma | ordem de boot, `setInterval` |
| `forja-core.js` | 754 | nenhuma | helpers, storage |
| `forja-store.js` | 665 | nenhuma | chaves, migrações |
| `forja-dados.js` | 2838 | nenhuma | catálogo, dados padrão |
| `forja-metricas.js` | 1223 | nenhuma | qualquer cálculo |
| `forja-sessao.js` | 1943 | nenhuma | cronômetro, descanso, fila |
| `forja-treino.js` | 1658 | nenhuma | rotinas, séries |
| `forja-progresso.js` | 1208 | nenhuma | agregações |
| `forja-backup.js` | 958 | nenhuma | export/import, formato |
| `forja-catalogo.js` | 1160 | nenhuma | filtros, busca |
| `forja-inicio.js` | 872 | nenhuma | boot da home |
| `forja-calendario.js` | 284 | **intocado** (hash) | tudo |
| `forja-atlas.js` | 944 | **intocado** | tudo |
| `forja-figura.js` | 364 | **intocado** | tudo |
| `forja-biblioteca.js` | 72 | nenhuma | 37 exercícios |

Soma de JS que pode mudar: **2 arquivos, ~15 linhas de cor/ícone**. As outras
15 009 linhas (de 15 913) ficam como estão.

> Se preferir risco zero em JS, os gráficos podem receber as cores por
> `var(--fj-…)` em vez de constantes — mas isso exige `getComputedStyle` no
> desenho, o que muda o comportamento em teste. A proposta mantém constantes.

---

## 5. Arquivos que **não** podem ser tocados

| Arquivo | Por que | O que verifica |
| --- | --- | --- |
| `assets/js/forja-calendario.js` | núcleo de calendário/missões congelado | `sha256(trim)` = `30a8253…928c5` em `forja.test.mjs` e `paridade.test.mjs` |
| `assets/anatomia/manifest.json`, `anterior.png`, `posterior.png` | pranchas licenciadas, com orçamento de peso | `atlas.test.mjs` (< 256 KB por prancha, NOTICE.md) |
| `assets/js/forja-figura.js` | desenho das regiões | `atlas.test.mjs` |
| `assets/js/forja-atlas.js` | interação do atlas | `atlas.test.mjs` + E2E |
| `assets/css/atlas.css` | 3 cores de papel, `mix-blend-mode`, foco, mídias | `atlas.test.mjs:756–772` (inclui `#b7f34a`) e E2E de pixels |
| `explorar/atlas.html` | página protegida | E2E + testes estruturais |

**Consequência honesta:** a página do atlas fica com o logotipo **textual**
(“FORJA” em Archivo, sem emblema), porque o `<header>` dela está no arquivo
protegido. É uma diferença de uma linha visual em uma página; a alternativa
seria pedir sua autorização explícita para editar `explorar/atlas.html` — algo
que **não** está sendo pedido agora.

---

## 6. Testes que mudam

| Arquivo | Linha | O que muda | Por quê |
| --- | --- | --- | --- |
| `tests/e2e.browser.mjs` | ~1309 | `rgb(183,243,74)` → cor do token novo | asserção de literal do app |
| `tests/forja.test.mjs` | ~2660 | `color: var(--lime)` → token novo | idem |
| `tests/forja.test.mjs` | 725–731 | **não muda** | hash do calendário |
| `tests/paridade.test.mjs` | 1711–1716 | **não muda** | hash do calendário |
| `tests/atlas.test.mjs` | 756–772 | **não muda** | cores funcionais do atlas |
| `tests/forja.test.mjs` | 734–745 | **não muda** | regras móveis nos 6 CSS existentes |
| `tests/metricas.test.mjs` | todas | **não muda** | nenhuma métrica é tocada |

Dos 162 testes do `npm test` + 25 verificações do E2E, **2 asserções** são
ajustadas. Se alguma outra começar a falhar, é regressão real, não ajuste.

---

## 7. Documentação que muda

| Arquivo | Mudança |
| --- | --- |
| `docs/forja-3.0-plano.md` | recebe o registro do que foi aplicado (etapa por etapa) |
| `docs/rebranding/*` | passam a ser o histórico da decisão; congelados após a aprovação |
| `README.md` (se existir) | menção à identidade e às fontes |

Nenhum documento existente é apagado.

---

## 8. O que **não** entra na árvore

- `design/` (protótipo e laboratório de marca) não é publicado: fica fora de
  `assets/` e nenhuma página o referencia. O workflow de Pages publica o root,
  então ele *ficaria* acessível por URL se fosse mantido — por isso a
  recomendação é removê-lo (ou movê-lo para `docs/rebranding/prototipo/`) ao
  fim da etapa 1, depois da aprovação.
- `node_modules/`, capturas e scripts de geração de imagem não entram no repo
  além do que já existe (`tools/` já é versionado).
- **Biblioteca e Perfil do protótipo não existem no app**: `biblioteca.html` e
  `perfil.html` são espelhos de `treino/biblioteca.html` e `perfil/index.html`,
  escritos para provar a marca em telas que já existem. Nenhuma tela ou
  funcionalidade nova é proposta — a etapa 9 continua sendo só aplicação de
  cor, tipo e espaçamento nas mesmas seções.
- Nenhum `package.json` novo, nenhum lockfile alterado, nenhum workflow
  alterado.

---

## 9. Resumo numérico

| Categoria | Quantidade |
| --- | --- |
| Arquivos novos | 17 (1 CSS, 2 fontes, 2 licenças, 12 SVG) |
| Páginas alteradas | 11 de 12 |
| CSS alterados | 8 de 9 (+1 novo) |
| JS alterados | 2 de 17 (só cor e ícone) |
| JS proibidos | 4 (calendário, atlas, figura, biblioteca funcional) |
| Asserções de teste ajustadas | 2 de 187 |
| Dependências novas | 0 |
| Chaves de `localStorage` alteradas | 0 |
| Páginas do estudo (`design/`) | 9 de protótipo + 2 de marca · 17 capturas |
