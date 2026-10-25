# Auditoria técnica — base para o rebranding da FORJA

Data da auditoria: 24 de outubro de 2026.
Repositório: `1Rayke1/forja` · branch auditada: `main`.

> Esta auditoria foi feita lendo o repositório atual, não relatórios antigos.
> Tudo abaixo foi verificado por inspeção de arquivo, contagem, execução das
> suítes e captura em navegador real. Onde a documentação anterior divergia do
> código, vale o código — e a divergência está registrada.

---

## 1. Estado do repositório e commit-base

| Item | Valor |
| --- | --- |
| Commit-base (`main`) | `17a9157d3b764329977899a8bbd0195efbfc4801` |
| Mensagem | `Merge pull request #19 from 1Rayke1/arena/87b22eb0-forja` |
| Data do commit | 24 de outubro de 2026, 20:19 (UTC−3) |
| `main` local = `origin/main` | sim (`git rev-parse main origin/main` idêntico) |
| Branch de trabalho desta etapa | `arena/03b006b1-forja` |
| Alterações no código do app nesta etapa | **nenhuma** — só `design/` e `docs/rebranding/` foram adicionados |

Verificação executada em 24/10/2026, com `npm ci` limpo:

```
MÉTRICAS — 18/18 testes aprovados
FORJA    — 92/92 testes aprovados
ATLAS    — 12/12 testes aprovados
PARIDADE — 40/40 testes aprovados

E2E navegador real — 25/25 verificações aprovadas
```

O total de 25 verificações E2E é o real do arquivo `tests/e2e.browser.mjs`
(26 chamadas `check`, uma delas desativada por fluxo condicional). Relatórios
anteriores citavam 16 e 17 — número desatualizado, não erro de teste.

---

## 2. Arquitetura real

**Aplicativo multipágina estático, sem build, executado inteiramente no
cliente.** 12 páginas HTML, 9 folhas de estilo, 16 módulos JavaScript
clássicos (IIFE em `window.Forja`), publicadas por GitHub Pages a partir da
raiz do repositório (`.github/workflows/static.yml`, gatilho: push em `main`).

| Camada | Arquivos | Papel |
| --- | --- | --- |
| Núcleo | `forja-core.js` (754 linhas) | utilitários, `F.state`, `showModal`, `showToast`, `F.url`, formatação |
| Persistência | `forja-store.js` (665) | driver `localStorage`, `F.registry`, `F.DATA_VERSION = 3`, migrações, rollback |
| Modelos e regras | `forja-dados.js` (2 838), `forja-catalogo.js` (1 160), `forja-biblioteca.js` (72) | rotinas, sessão, histórico, catálogo de 37 exercícios |
| Cálculos | `forja-metricas.js` (1 223) | períodos, totais, recordes, evolução, metas |
| Sessão/execução | `forja-sessao.js` (1 943), `forja-treino.js` (1 658) | cronômetros, séries, descanso, editor de rotina |
| Telas | `forja-inicio.js` (872), `forja-progresso.js` (1 208), `forja-calendario.js` (284, protegido) | render por página |
| Componentes visuais | `forja-ui.js` (547), `forja-graficos.js` (357) | fábricas de elemento, ícones SVG, gráficos acessíveis |
| Atlas (protegido) | `forja-atlas.js` (944), `forja-figura.js` (364) | pranchas raster e destaques regionais |
| Backup | `forja-backup.js` (958) | exportar, validar, importar, desfazer |
| Boot | `forja-app.js` (66) | um único `setInterval` (250 ms) e um único `boot()` por página |

Total em `assets/js`: **15 913 linhas**.

### Páginas (12)

| Página | `data-page` | IDs no HTML | Observação de auditoria |
| --- | --- | --- | --- |
| `index.html` | `inicio` | 37 | carrega `forja-inicio.js` + `forja-calendario.js` |
| `treino/index.html` | `treino` | 12 | hub de modalidades |
| `treino/calistenia.html` | `calistenia` | 21 | rotinas + histórico da modalidade |
| `treino/musculacao.html` | `musculacao` | 21 | idem |
| `treino/rotina.html` | `rotina` | 68 | editor completo de rotina |
| `treino/executar.html` | `executar` | 96 | execução + resumo pós-treino |
| `treino/biblioteca.html` | `biblioteca` | 8 | catálogo com filtros |
| `progresso/index.html` | `progresso` | 59 | análise completa |
| `perfil/index.html` | `perfil` | 29 | perfil, dados, preferências |
| `configuracoes/index.html` | `configuracoes` | 17 | backup/restauração e preferências |
| `explorar/index.html` | `explorar` | 10 | hub para biblioteca e atlas |
| `explorar/atlas.html` | `atlas` | 8 | atlas muscular (protegido) |

**285 IDs únicos** no conjunto das páginas. **~300 nomes de classe** distintos
somando HTML e classes geradas em JS.

### Folhas de estilo (9) e ordem de carregamento

```
base.css        (474 linhas,  81 regras)  ← tokens antigos, calendário/missões, modal, toast
treino.css      (735, 105)                ← hub, cards de modalidade, editor, biblioteca
execucao.css    (447,  64)                ← execução, cronômetros, descanso, resumo
configuracoes.css (35,   6)               ← painéis de dados/preferências
app.css         (747, 269)                ← shell, bottom-nav, home, progresso, hub
responsive.css  ( 84,  38)                ← ajustes < 560 e < 380
performance.css ( 11,  10)                ← "Dark Performance": redefine TODOS os tokens
system.css      (483, 198)                ← tokens derivados + componentes de forja-ui/graficos
atlas.css       (597, 100)                ← PROTEGIDA
```

### Constatação crítica para o rebranding: a paleta é definida três vezes

| Origem | Variáveis | Valores |
| --- | --- | --- |
| `base.css :root` | `--bg --panel --panel2 --gold --text --muted --border --green --red` | `#101010 · #191919 · #222222 · #e7c779 · #f5f5f5 · #a5a5a5 · #303030` |
| `performance.css :root` | **os mesmos nomes**, redefinidos | `#0D0F0E · #191C1A · #252925 · #B7F34A` (verde-limão) + `--lime` |
| `system.css :root` | tokens derivados (`--space-*`, `--radius-*`, `--font-*`, `--accent-*`, `--danger`, `--ok`) | derivados do limão |

Ou seja: o aplicativo **já tem uma troca de identidade anterior** — o dourado
`#e7c779` do `base.css` é sobrescrito pelo verde-limão `#B7F34A` do
`performance.css`. Hoje a cor de acento percebida é **limão**, não dourado.
Qualquer proposta de paleta precisa entrar como **quarta camada**, depois de
`performance.css` e `system.css`, sem reescrever os arquivos antigos.

Cores literais fora de token (inconsistências atuais, por arquivo):
`base.css` 28 · `treino.css` 41 · `execucao.css` 24 · `app.css` 16 ·
`performance.css` 25 · `system.css` 11 · `atlas.css` 14 (protegida).

---

## 3. Estrutura visual existente

### Shell presente em todas as páginas

```
<header class="site-header"> .logo (texto "FORJA") + .tagline </header>
<main class="container">
  <section class="active-session-banner">   ← faixa "treino em andamento"
  …conteúdo da página…
</main>
<nav class="bottom-nav"> 5 links com SVG inline + .bottom-nav-label </nav>
<footer class="site-footer"> mote + nota de armazenamento </footer>
<div id="modal-root"> <div class="toast" id="toast">
15 <script defer> (a maioria das páginas) + forja-app.js sempre por último
```

- A logo é **texto puro** (`.logo`, `font-size: 27px`, `letter-spacing: 4px`,
  cor antiga var(--gold)) — não existe arquivo de marca, favicon, ícone de app
  ou `manifest`. Não há `<link rel="icon">` em nenhuma página.
- `theme-color` está fixo em `#101010` nas 12 páginas.
- A tela de navegação é a barra inferior de 5 destinos: **Início, Treinos,
  Explorar, Progresso, Perfil**. `Perfil` é o 5º destino e existe como página;
  `Configurações` fica acessível por dentro de Perfil (link “Abrir Dados”).
- Dois padrões de cabeçalho convivem: `.page-head` (eyebrow + `.screen-title`
  + `.screen-subtitle`) e `.screen-toolbar` (voltar + eyebrow). Três páginas
  ainda usam `style="…"` inline (`explorar/index.html`, `perfil/index.html`).

### Componentes compartilhados de fato

`forja-ui.js` expõe: `icon()` com 26 caminhos SVG (24×24, traço 2),
`button/linkButton`, `card`, `sectionHead`, `stat/statRow`, `chip`,
`segmented`, `emptyState`, `list`, `dataTable`, `searchField`,
`confirmDestructive`. `forja-graficos.js` expõe barras, colunas, linha,
heatmap e anel — todos com tabela alternativa acessível.

Isso é o que torna o rebranding viável por CSS: **a maioria dos blocos já nasce
com classe estável** (`.ui-card`, `.ui-stat`, `.ui-chip`, `.ui-empty`,
`.ui-bar-*`, `.ui-heatmap-*`, `.ui-ring-*`).

### Inconsistências visuais encontradas (não são bugs funcionais)

1. Emojis/símbolos tipográficos no lugar de ícone: `◉` e `◎` em
   `explorar/index.html` (cartões Exercícios/Atlas) e `↗` em ícone de ação.
2. `base.css` e `performance.css` divergem em raio, altura e espaçamento; o
   resultado depende da ordem de carregamento — hoje quem vence é
   `performance.css`.
3. `.ui-card` usa `linear-gradient(150deg, rgba(255,255,255,.026), transparent)`
   como “textura” de superfície — exatamente o efeito que a nova direção evita.
4. `body` tem um `radial-gradient` de limão no canto superior direito.
5. Três páginas usam atributo `style` inline para layout.
6. Não há favicon, ícone de app nem imagem social — a marca não existe fora do
   texto.

---

## 4. Testes e comandos disponíveis

| Comando | O que roda | Tempo aprox. |
| --- | --- | --- |
| `npm test` | `metricas` (18) → `forja` (92) → `atlas` (12) → `paridade` (40) | ~90 s |
| `npm run test:e2e` | Chromium real, 25 verificações + capturas | ~170 s |
| `npm run serve` | `python3 -m http.server 8080 --bind 127.0.0.1` | — |

Dependências de desenvolvimento (`package.json`): `jsdom ^30`, `puppeteer-core
^24.43.1`, `@sparticuz/chromium ^138`. `package-lock.json` presente.

### Testes que **amarram decisões visuais** (leia antes de mexer em CSS)

| Teste | Arquivo:linha | O que trava |
| --- | --- | --- |
| item ativo da nav = `rgb(183, 243, 74)` | `e2e.browser.mjs:1309` | cor computada do link ativo em todas as páginas |
| papéis do atlas = `183,243,74` / `242,184,75` / `140,192,224` | `e2e.browser.mjs:691-704` | cores computadas dos destaques |
| `#b7f34a`, `#f2b84b`, `#8cc0e0` e regras de `atlas.css` | `atlas.test.mjs:756-772` | texto do CSS do atlas (protegido) |
| `.bottom-nav-link.is-active … color: var(--lime)` | `forja.test.mjs:2660` | seletor literal em `app.css` |
| `.hub-list { display: grid`, `.big-set-button`, `.task-form input { flex: 1 1 100%`, `@media (max-width: 380px)` | `forja.test.mjs:738-745` | existência de regras específicas |
| `.bottom-nav { position: fixed`, `env(safe-area-inset-bottom` | `forja.test.mjs:2176-2178` | barra inferior fixa com área segura |
| `min-height: 52px\|56px` em `.home-action-button` | `paridade.test.mjs:1351-1356` | alvo de toque do botão principal |
| hash SHA-256 de `forja-calendario.js` = `30a8253…928c5` | `forja.test.mjs:725-731` e `paridade.test.mjs:1711-1716` | arquivo protegido (hash do conteúdo com `.trim()`) |
| conjunto fixo de páginas e `EXPECTED_NAV` | `e2e.browser.mjs:31-60` | 12 páginas com destino de nav esperado |
| ausência de erro de console e de recurso 404 | `e2e.browser.mjs:442` | qualquer `<link>`/`<script>` novo precisa existir |

**Consequência direta:** trocar a cor de acento quebra o E2E na linha 1309 e o
`forja.test.mjs:2660`. Os dois testes precisam ser atualizados junto com a
camada visual — e isso é esperado, não é “afrouxar teste”. Nenhum teste de
comportamento, dado ou métrica é afetado por cor.

---

## 5. Arquivos que podem receber mudanças exclusivamente visuais

### Pode mudar (visual puro, risco baixo)

| Arquivo | Mudança prevista | Por que é seguro |
| --- | --- | --- |
| `assets/css/performance.css` | passa a ser a camada de tokens nova (ou é substituída por `marca.css`) | redefine tokens; nenhuma regra funcional |
| `assets/css/system.css` | ajuste de raio, sombra, densidade dos componentes `.ui-*` | é a camada de componentes |
| `assets/css/app.css` | shell, cabeçalho, barra inferior, home, cards, progresso | só aparência |
| `assets/css/base.css` | modal, toast, calendário, missões (aparência) | sem alterar seletores referenciados por JS |
| `assets/css/treino.css`, `execucao.css`, `configuracoes.css`, `responsive.css` | superfícies, tipografia, espaçamento, breakpoints | só aparência |
| `assets/css/marca.css` *(novo)* | emblema, lockup do cabeçalho, favicon em CSS, grafismos | arquivo novo, isolado |
| `*.html` (12 páginas) | `<head>`: `<link>` do CSS novo, `<link rel="icon">`, `theme-color`; `<header>`: logo com SVG inline; remoção de `style=""` inline | estrutura semântica, `id` e `data-*` intactos |
| `assets/js/forja-ui.js` | ajuste do traço/ícones, classes de componente | não conhece storage; só cria elemento |
| `assets/js/forja-graficos.js` | cores de série via token | cálculos vêm prontos de `forja-metricas.js` |
| `explorar/index.html` | trocar `◉`/`◎` por SVG de `F.icon()` | só apresentação |
| `design/**` *(novo)* | protótipo, marca, tokens, capturas | fora do app publicado |
| `docs/rebranding/**` *(novo)* | documentação | — |

### Não pode mudar

| Arquivo | Motivo |
| --- | --- |
| `assets/js/forja-calendario.js` | **hash protegido** `30a8253…928c5` conferido em duas suítes |
| `assets/anatomia/*` | pranchas com hash no `manifest.json`, verificadas por `ATLAS 3` e pelo E2E de pixels |
| `assets/js/forja-figura.js` | desenho das regiões sobre a prancha |
| `assets/js/forja-atlas.js` | classificação, seleção e interação do atlas |
| `assets/css/atlas.css` | regras e cores de papel conferidas por `atlas.test.mjs` |
| `explorar/atlas.html` | página do atlas; `atlas.css` e a estrutura são verificadas |
| `assets/js/forja-store.js`, `forja-dados.js`, `forja-sessao.js`, `forja-backup.js`, `forja-metricas.js`, `forja-treino.js`, `forja-catalogo.js`, `forja-biblioteca.js`, `forja-inicio.js`, `forja-progresso.js`, `forja-core.js`, `forja-app.js` | lógica, chaves, formatos, migrações e boot. **Nenhum precisa mudar** para o rebranding |
| `package.json`, `package-lock.json` | dependências aprovadas; o rebranding não precisa de nenhuma |
| `.github/workflows/static.yml` | publicação |
| `tests/**` | só quando o próprio critério visual mudar (cor de acento), de forma explícita e documentada |

### Arquivos que **precisam** de mudança mínima de HTML (não é só CSS)

O rebranding completo exige estes pontos fora do CSS — todos sem tocar em
lógica:

1. **`<head>` das 12 páginas**: `<link rel="stylesheet" href="…/marca.css">`
   como última folha, `<link rel="icon" href="…/assets/marca/favicon.svg">`,
   `theme-color` atualizado.
2. **`<header class="site-header">`**: `.logo` deixa de ser texto e passa a
   conter o SVG do emblema + `<span class="logo-word">`. Precisa de `aria-label`
   para não perdê-la.
3. **`assets/js/forja-ui.js`**: `ICON_PATHS` ganha os ícones que substituem
   `◉`/`◎`/`↗`; nenhuma assinatura muda.
4. **Imagens de marca novas** (`assets/marca/*.svg`, `favicon.ico`,
   `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`) — arquivos novos,
   nenhum existente é sobrescrito.

Fora isso, **a interface inteira pode ser reestilizada só com CSS**: foi
exatamente o que o protótipo provou (ver `docs/rebranding/05-prototipo.md`).

---

## 6. Restrições técnicas confirmadas no código

- `localStorage` com 14 chaves registradas em `F.registry`
  (`forja-calendario-*`, `forja-missoes-*`, `forja-treino-rotinas-v1`,
  `forja-treino-historico-v1`, `forja-treino-sessao-ativa-v1`,
  `forja-treino-biblioteca-v1`, `forja-treino-metas-v1`,
  `forja-treino-rotacao-v1`, `forja-perfil-v1`, `forja-preferencias-v1`,
  `forja-treino-dados-preservados-v1`, `forja-treino-migracao-v1`,
  `forja-backup-seguranca-v1`, `forja-treino-exercicios-v1`).
- `F.DATA_VERSION = 3`; migração idempotente, com arquivo do conteúdo ilegível.
- Abrir qualquer página **não grava chave nova** (testes FORJA 38 e PARIDADE
  15a cobrem isso). O rebranding não pode introduzir escrita no boot — logo,
  nada de “primeira visita grava preferência de tema”.
- `forja-app.js` cria **um único** `setInterval`; nenhum módulo novo pode criar
  outro.
- Nenhuma página usa framework, bundler, CDN ou fonte externa: hoje a
  tipografia é `Arial` (base.css) e `Inter, ui-sans-serif` (performance.css),
  ambas **sem arquivo de fonte** — ou seja, o app pede Inter mas não a entrega.
  A nova direção resolve isso com fonte auto-hospedada (OFL), sem CDN.

---

## 7. Riscos do rebranding mapeados

| Risco | Probabilidade | Impacto | Mitigação proposta |
| --- | --- | --- | --- |
| Testes E2E que amarram cor quebram | certa | baixo | atualizar os 2 pontos de cor no mesmo commit, com nota |
| Tema “viking” dominar a interface | média | alto | regra de uso: grafismo só em 4 lugares (ver `02-conceito-e-marca.md`) |
| Paleta nova reduzir contraste | média | alto | todos os pares medidos (AA/AAA) antes de implementar |
| Fonte nova pesar no carregamento | média | médio | 2 arquivos woff2, subconjunto latino, `font-display: swap` (~137 KB) |
| Fonte indisponível offline | baixa | médio | fallback de sistema declarado; `font-display: swap` |
| Atlas perder a identidade funcional | baixa | alto | `atlas.css` e pranchas intocados; cores de papel preservadas |
| Divergência entre protótipo e implementação | média | médio | o protótipo usa os mesmos nomes de classe do app |
| Navegação de 5 itens não caber com nome maior | baixa | médio | testado em 320 px; rótulos não mudam |

---

## 8. Divergências entre documentação antiga e código atual

| Documento | Diz | Realidade em `main` |
| --- | --- | --- |
| `docs/forja-3.0-plano.md` §3 | etapa 6 “em andamento” | home já entrega próximo treino, semana, metas, último treino e onboarding — etapa concluída no código |
| `docs/forja-3.0-plano.md` | “16 testes E2E” / “17 E2E” | 25 verificações reais |
| `docs/forja-3.0-plano.md` §1 | home “é calendário + missões” | a home foi reescrita; calendário e missões continuam existindo, abaixo do resumo |
| `docs/atlas-anatomico.md` | 16 IDs de região | confirmado |
| `docs/testes-paridade.md` | “39 testes portados + 9b” | 40 testes na suíte de paridade — confere |

Nenhuma dessas divergências bloqueia o rebranding; elas só mostram que relatório
antigo não serve como fonte de escopo. O escopo desta proposta foi levantado
arquivo por arquivo.
