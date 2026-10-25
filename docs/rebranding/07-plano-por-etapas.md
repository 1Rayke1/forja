# Plano técnico por etapas

Como sair do estado atual (identidade textual, limão) para a identidade FORJA
sem quebrar nada. **Nada aqui foi executado** — este é o plano da etapa
seguinte, condicionado à sua aprovação.

---

## Andamento e mudança de direção (25/10/2026)

**Direção revisada a pedido do dono do projeto:** ficam as cores, o fundo e o
padrão visual atuais do app (acento limão, superfícies de `performance.css` e
`system.css`, fundo carvão de `marca.css`). A proposta de tema nórdico e a
estética de forja foram abandonadas — paleta brasa/bronze, emblema de bigorna
e chama, hachura, bigorna isolada e tagline **não** serão aplicados. As
etapas seguintes continuam valendo como lista de trabalho, lidas sob esta
direção: componentes e telas usam só os tokens que o app já tem. Os tokens
`--fj-brasa*`, `--fj-bronze*` e semânticos declarados em `marca.css` ficaram
sem uso e **foram removidos na etapa 10** (só permanecem os 14 tokens
`--fj-*` efetivamente referenciados).

| Etapa | Situação |
| --- | --- |
| 1 | congelada (`738eca5`) |
| 2 | parcial: `marca.css` com fontes e tokens, `<link>` em 11 páginas (`11c18c7`, `184b218`); favicon, SVGs de marca, `theme-color` e `preload` eram do emblema e saem do escopo |
| 3 | fatia 1: tipografia por classe e superfície do casco (`8b17e3e`); cartões mantidos como estão |
| 4 | **feita em 25/10/2026, na paleta atual** — ver “Situação” na própria etapa |
| 5 | **feita em 25/10/2026, na paleta atual** — ver “Situação” na própria etapa |
| 6 | **feita em 25/10/2026, na paleta atual e só com CSS** — ver “Situação” na própria etapa |
| 7 | **feita em 25/10/2026, na paleta atual e só com CSS** — ver “Situação” na própria etapa |
| 8 | **feita em 25/10/2026, na paleta atual e só com CSS + constantes de estilo** — ver “Situação” na própria etapa |
| 9 | **feita em 25/10/2026, na paleta atual (CSS + limpeza pontual de HTML)** — ver “Situação” na própria etapa |
| 10 | **feita em 25/10/2026** — ver “Situação” na própria etapa |

Pendências encontradas na etapa 4 e deixadas para a etapa de cada tela:

- ~~resíduos do dourado antigo em blocos de tela — hover e `::after` de
  `.modality-card`; `.exercise-focus` (pai da figura: exige o cuidado da
  etapa 3); `.session-notes`; `.rest-panel` e `.rest-caption`;
  `.session-summary` com `.summary-stat` e itens; `.exercise-form-card.editing`;
  `.timer-panel.is-paused` (etapa 7)~~ — resolvido na etapa 7;
- `.summary-label` (Progresso, modalidades, resumo) em minúsculas de 10 px,
  enquanto `.ui-stat-label` e `.home-week-stat-label` são caixa-alta de 11 px:
  padronizado na etapa 7 nas telas de treino;
- foco inicial do diálogo destrutivo cai no botão de perigo (`F.showModal`
  foca a primeira ação que não é “cancelar”); levar ao botão seguro exige
  mudança de lógica em `forja-core.js`;
- ~~`.compare-delta.is-down` usa `var(--gold)`, hoje igual ao limão de
  `is-up`~~ — resolvido na etapa 8 (queda em osso claro, distinta da alta e do
  estável);
- ~~nomes que quebram no meio da palavra em 320 px (linha do editor, caixas de
  seção do cartão de rotina) e `.history-status` esticado na largura do item
  (etapa 7)~~ — resolvido na etapa 7 com `overflow-wrap: anywhere` e `white-space: nowrap`;
- ~~`--bottom-nav-height` é usada em `app.css` e não é definida~~ — resolvido na etapa 5 (definida em `marca.css` pelo cálculo da barra: 69 px);
- `explorar/atlas.html` não carrega `marca.css` (isolamento): seus botões,
  campos e o select sem seta seguem o estado anterior.

---

## 0. Regras que valem para todas as etapas

1. **Entrega pequena, sempre verde.** Ao fim de cada etapa: `npm test`
   (162 asserções) e `npm run test:e2e` (25 verificações) passando. Se uma
   etapa não fecha verde, ela não é mesclada.
2. **Sem *big bang*.** A camada nova entra como **quarta camada de CSS**
   (`assets/css/marca.css`, depois de `performance.css` e `system.css`), não
   como reescrita de `base.css`. Isso permite reverter uma etapa com um
   `git revert` de um único commit.
3. **Sem mudança de lógica.** Nenhum arquivo de `forja-store.js`,
   `forja-dados.js`, `forja-metricas.js`, `forja-sessao.js`, `forja-treino.js`,
   `forja-progresso.js`, `forja-backup.js` é tocado em nenhuma etapa.
4. **Sem mudança de dado.** Nenhuma chave, formato ou migração muda. O teste de
   paridade (`tests/paridade.test.mjs`) roda em toda etapa justamente para
   provar isso.
5. **Protegidos intocados.** `forja-calendario.js`, `assets/anatomia/*`,
   `forja-figura.js`, `forja-atlas.js`, `atlas.css`, `explorar/atlas.html`.
   O hash do calendário (`sha256` do conteúdo sem espaços nas pontas) continua
   sendo `30a8253…928c5`, o mesmo de `00-auditoria.md`.
6. **Sem dependência nova.** Fontes são arquivos `.woff2` versionados em
   `assets/fontes/`; nenhum `npm install`.
7. **Nada novo no boot.** Nenhuma etapa introduz leitura/escrita em
   `localStorage` na inicialização. A única gravação que existe hoje ao abrir
   uma página é a migração de esquema (`F.bootData` → `F.schema.run`), e essa
   continua exatamente igual. Nenhuma preferência visual é persistida.

### Sobre os testes que verificam cor

Há asserções que hoje conferem o **limão** da implementação
(`rgb(183,243,74)` no item ativo da navegação, `#b7f34a` nos papéis do atlas,
`var(--lime)` no `bottom-nav`). Elas são de *implementação*, não de regra de
negócio. Regra para o plano:

- asserção que descreve **comportamento** (navegação ativa, região do atlas,
  contraste, hash protegido) → **não muda**;
- asserção que descreve **literal de cor do app** → muda no **mesmo commit** da
  etapa que troca a cor, passando a apontar para o token novo;
- asserção que descreve **cor do atlas** → **não muda** em nenhuma etapa; o
  atlas mantém `#b7f34a`, `#f2b84b`, `#8cc0e0`.

Além disso, o teste 24 de `forja.test.mjs` lê **exatamente seis** arquivos
(`base`, `treino`, `execucao`, `configuracoes`, `app`, `responsive`) procurando
as regras móveis (`.task-form`, `.bottom-nav-inner` com 5 colunas, `.hub-list`,
`--bottom-nav-height`). Um `marca.css` novo fica **fora** dessa varredura: ou as
regras móveis continuam nesses seis arquivos (preferível, e é o que o plano
faz), ou o teste é ampliado na mesma etapa — nunca as duas coisas ao mesmo
tempo, para não mascarar regressão.

---

## Etapa 1 — Aprovação e congelamento (0 código)

**Objetivo:** fechar símbolo, palavra, paleta e tipografia.

**Estado: aprovada em direção em 24/10/2026.** As cinco decisões de
`04-alternativas-logo.md` §8 estão respondidas: emblema A, ícone em disco
vazado (condicionado à prova, já entregue em `design/marca/icone.html`),
cabeçalho de 24 + 19 px com tagline a partir de 720 px, tagline oficial e
emblema duo de 40 px no resumo pós-treino.

O que resta desta etapa:

- [ ] Aval final desta rodada: telas principais, biblioteca, perfil, prova do
      ícone, auditoria de Git e plano técnico.
- [ ] Congelar a versão aprovada em `design/` (tag/commit de referência).

**Saída:** aprovação registrada. Sem ela, nenhuma etapa seguinte começa.

---

## Etapa 2 — Fundação invisível

**Objetivo:** instalar tokens, fontes e marca **sem mudar a aparência** além do
inevitável.

| Ação | Arquivo |
| --- | --- |
| Criar `assets/css/marca.css` só com `:root` de tokens e os `@font-face` | novo |
| Copiar `archivo-variable-latin.woff2` e `inter-variable-latin.woff2` + OFL | `assets/fontes/` (novo) |
| Copiar os 12 SVG de marca | `assets/marca/` (novo) |
| `<link>` do `marca.css` depois de `system.css`; favicon e `theme-color` no `<head>` | 12 páginas (+ `explorar/atlas.html` depois de `atlas.css`) |
| `preload` das duas fontes | 12 páginas |

**Verificação:** E2E verde; capturas antes/depois comparadas (só devem diferir
onde o `theme-color` e o favicon aparecem; fonte ainda não aplicada).
**Risco:** baixo. **Reversão:** remover as linhas do `<head>`.

---

## Etapa 3 — Tipografia e superfícies

A etapa de maior impacto visual e a que concentra risco de quebra de layout.

| Ação | Arquivo |
| --- | --- |
| Escala tipográfica, pesos, *tracking*, `font-variant-numeric: tabular-nums` em métricas | `marca.css` |
| Superfícies (`--fj-carvao`/`ferro`/`ferro-alto`), bordas, raios, sombras — aplicando os tokens `--fj-*` em **seletor explícito de cada componente autorizado**. Proibido redefinir token legado (`--panel`, `--border`, `--muted`, `--accent`, `--lime`, `--bg`, `--text`) em `:root` ou em `body`: o atlas consome esses nomes e as cores de papel são verificadas por teste de pixel | `marca.css` |
| Substituir fontes `system-ui` por Archivo/Inter nas declarações de `base.css` | `base.css` (edição pontual) |

**Verificação:**
- E2E: verificação “Sem rolagem horizontal em 320…1280 px em todas as
  páginas” é o juiz desta etapa. Se quebrar, o problema é tamanho de fonte ou
  `letter-spacing`, não o teste.
- Conferir visualmente as 12 páginas em 320, 360, 390, 430, 768 e 1280.
- Rodar de novo o gerador de capturas do protótipo — não do app.

**Risco:** médio-alto em 320 px (títulos longos como “Rotina sem exercícios”).
**Mitigação:** cada título recebe `text-wrap: balance` + limite de tamanho por
`clamp()`, e a checagem em 320 px fecha antes de seguir.
**Reversão:** `git revert` de um commit; `marca.css` pode ficar vazio.

---

## Etapa 4 — Componentes e estados

| Ação | Arquivo |
| --- | --- |
| Botões (primário/secundário/`danger`/`ghost`/`is-danger`), com estados de foco, hover, ativo, desabilitado | `marca.css` + `system.css` |
| Campos, `label`, `hint`, `field-error`, `[aria-invalid]` | idem |
| `.chip`, `.ui-stat`, `.ui-stats`, barras de meta, pips de série | idem |
| `.modal-card`, `.modal-actions`, `.modal-details` (17 diálogos, uma função) | idem |
| `.toast`, `#backup-status`, `.ui-empty` (14 vazios) | idem |

**Verificação:** E2E já abre modais e estados (25 verificações). Verificar
foco visível em todos os controles: `:focus-visible` com contorno de 2 px em
aço, nunca removido.
**Risco:** baixo — são regras aditivas. **Reversão:** remover o bloco.

**Situação (25/10/2026): feita, na paleta atual.** Um bloco no fim de
`marca.css` (“ETAPA 4”); `system.css` não precisou mudar. Nenhuma cor nova:
os componentes legados foram levados ao padrão dos componentes `.ui-*` e
estados quebrados foram corrigidos — perigo voltou a ser vermelho (o
`!important` de `performance.css` o deixava igual ao secundário), seta do
select restaurada, seletor de tipo com estado visível acima de 560 px,
desabilitado único (opacidade 0,45 + cinza), botões de ação com 44 px, aviso
acima da barra inferior e resíduos dourados trocados pelos equivalentes em
limão translúcido. O contorno de foco continua o atual (3 px limão): a
auditoria por Tab encontrou 309 paradas de foco nas 11 páginas, todas
visíveis em 390 e 1280 px (antes, o rádio do seletor de tipo ficava
invisível em 1280 px). `npm test` 162/162, `npm run test:e2e` 25/25, sem
rolagem horizontal em 320–1280 px; estilos computados do atlas idênticos
(328 nós em quatro blocos) e arquivos protegidos com o mesmo hash.

---

## Etapa 5 — Cabeçalho, navegação e rodapé (12 páginas + logo)

| Ação | Arquivo |
| --- | --- |
| `.logo`: emblema óptico `<svg>` de 24 px (`assets/marca/emblema-24.svg`, inline) + `<span class="logo-word">Forja</span>`, com `aria-label` preservando o texto | 12 páginas |
| `.tagline` em Inter 600 / 0,30 em, texto **DISCIPLINA • EVOLUÇÃO • CONSISTÊNCIA**, `display: none` abaixo de 720 px | `marca.css` |
| Nav e `.bottom-nav-link.is-active` em brasa com fio de 2 px | `marca.css` |
| **Atualizar a asserção de cor** do item ativo (`e2e.browser.mjs` ~1309 e `forja.test.mjs` ~2660) para o token novo | testes |

**Verificação:** E2E de navegação (5 destinos, `aria-current`) verde;
`e2e.browser.mjs` “PAGES + EXPECTED_NAV” intocado.
**Risco:** médio — mexer no `<header>` de 12 páginas ao mesmo tempo. Mitigação:
script de substituição único + revisão arquivo a arquivo (`git diff` de 12
arquivos com 3 linhas cada).
**Reversão:** `git revert`; o `<svg>` inline não tem dependência.

**Situação (25/10/2026): feita, na paleta atual e sem HTML novo.** A tabela
acima é a proposta original (emblema, tagline nova e brasa), abandonada pela
direção revisada. Como cabeçalho, barra inferior e rodapé já eram idênticos
nas 12 páginas — mesmos ícones SVG (traço 1,9), mesmos cinco destinos, mesma
palavra FORJA e mesma linha DISCIPLINA DIÁRIA — nenhum HTML precisou mudar:
a etapa é um bloco “ETAPA 5” no fim de `marca.css`. Nele: cabeçalho com
alinhamento central, altura mínima de 60 px, palavra em Archivo 800 com alvo
de 44 px e linha de apoio em Inter 600 legível (com recuo só em ≤380 px);
barra inferior com rótulos de 11 px e item ativo distinguível sem depender
só da cor (fundo `--accent-soft` + traço do ícone em 2,2), mantidos cor
limão, destinos, `is-active`/`aria-current` e foco de 3 px; rodapé com
hierarquia de rótulo/texto de apoio e padding inferior somando a barra fixa,
que antes cobria o fim do rodapé; e `--bottom-nav-height` enfim definida
(69 px = 1 + 6 + 56 + 6), corrigindo o `padding-bottom` de `app.css` que
referenciava uma variável inexistente. `explorar/atlas.html` não carrega
`marca.css` e segue intocado, como mandam as regras de isolamento.
`npm test` 162/162 (inclui navegação ativa nas 12 páginas e hash dos
arquivos protegidos). O `npm run test:e2e` não pôde rodar no ambiente desta
sessão: o Chromium empacotado exige `libnspr4.so`, ausente e sem pacote
disponível no sandbox — pendência de ambiente, não de código. **Resolvido na
etapa 6:** a suíte de navegador rodou integralmente (25/25) com a solução de
ambiente descrita na “Situação” da etapa 6.

---

## Etapa 6 — Início

Os 8 blocos de `index.html` (165 linhas, 37 IDs), um por commit:
saudação → ação principal → semana → metas → último treino → calendário (só
CSS) → missões → onboarding.

**Verificação:** o E2E de “Home estabilizada” (320/360/390/768/1280,
onboarding com 2 botões exatos, `#home-action-heading` com o texto certo) é o
contrato. Nenhum texto funcional muda.
**Risco:** alto — é a página mais testada. Cada commit roda E2E completo.
**Reversão:** granular, um bloco por vez.

**Situação (25/10/2026): feita, na paleta atual e só com CSS.** Os oito
blocos entraram como oito commits no fim de `app.css` (`5ec93a9` … `832d552`,
um por bloco, na ordem do plano; +145 linhas, nenhuma linha apagada):

1. **Saudação** — hierarquia e medida de leitura: `clamp(26–34 px)` com
   `text-wrap: balance`, subtítulo em 15 px na família de texto.
2. **Ação principal** — cartão no padrão do sistema (raio 18, ritmo
   `--space-*`); o CTA, que recebe `.treino-square` de compatibilidade e era
   reescrito por `performance.css` (fundos translúcidos, texto claro,
   alinhado à esquerda, 66 px), volta ao padrão dos botões primários do app
   por seletor `#home-action .home-action-button`: limão, texto escuro, 48 px
   e centralizado. A classe legada e o texto não mudam.
3. **Semana** — cabeçalho 19 px e as três estatísticas em cartões do sistema
   (raio 13, valor tabular, rótulo legível).
4. **Metas** — período, anéis e notas alinhados (raio do sistema nos cartões
   de anel, percentuais tabulares).
5. **Último treino** — item de lista legível em 320 px (nome 15/700, meta em
   13 px, quebra por palavra).
6. **Calendário** — só CSS, como manda a tabela: mesmos IDs, mesmas células e
   as mesmas cores funcionais (`today`, `selected`, `has-tasks` em limão);
   alvos de 44 px nos botões de mês e números tabulares.
7. **Missões** — mesmo formulário e mesma lista (42/100 px nas telas
   estreitas): trilho de 8 px, alvo de 44 px no “Adicionar” e no excluir,
   itens na superfície afundada e vazio no padrão `.ui-empty`.
8. **Onboarding** — mesmos campos, colunas e gramatura compacta; as regras
   novas estão escopadas sob `#onboarding-root` porque o mesmo formulário
   (`.field-block`/`.field-input`) vive no Perfil, que pertence à etapa 9.

Nenhum HTML, ID, texto, script, chave de `localStorage` ou arquivo protegido
foi tocado: `git diff` da etapa mostra um arquivo (`app.css`). Todas as regras
são explicitamente escopadas em blocos da home (`#conteudo`, `#home-week`,
`.home-secondary`, `#onboarding-root`), então nada vaza para as outras 11
páginas — que compartilham classes como `.section-title` e `.calendar-panel`.
`npm test` 162/162 e `npm run test:e2e` **25/25**, incluindo “Home
estabilizada”, “Ação TREINO compacta”, “Sem rolagem horizontal em
320…1280 px em todas as páginas” e “Atlas: pixels fiéis à referência”.

**E2E de volta no ambiente, resolvendo a pendência da etapa 5:** o tarball
`al2023.tar.br` que o próprio `@sparticuz/chromium` empacota traz
`libnspr4.so`/`libnss3.so`; extraídas em `/tmp` e lançadas no
`LD_LIBRARY_PATH`, o navegador empacotado abre normalmente
(`LD_LIBRARY_PATH=/tmp/fjlibs/lib npm run test:e2e`). Nada disso entra no
repositório nem no `package.json`: é só a camada de bibliotecas do próprio
pacote, em disco temporário do ambiente de teste.

---

## Etapa 7 — Treino e execução

`treino/index.html` → `calistenia`/`musculacao` → `rotina` (editor) →
`biblioteca` → `executar`.

Atenção especial: `executar.html` tem cronômetro e estado em memória. A regra
é **só CSS e markup estático**; nenhum `id` some, nenhum `data-*` muda.

**Verificação:** E2E cobre iniciar, registrar série, descanso, pausa, concluir,
resumo. Rodar em 390 px (alvo real) e 1280.
**Risco:** alto. **Reversão:** commit por tela.

**Situação (25/10/2026): feita, na paleta atual e só com CSS.** O bloco
entrou no fim de `assets/css/marca.css` sob o cabeçalho “ETAPA 7”, sem tocar
em nenhum arquivo JavaScript nem alterar nenhum ID ou contrato funcional do
HTML:

1. **Hub de treino (`treino/index.html`):** `.modality-card` na superfície do
   sistema com sombra e borda limpas, sem o pseudo-elemento circular decorativo
   dourado (`::after`); hover com borda em acento limão translúcido;
   números de modalidade tabulares em limão e setas responsivas com hover.
2. **Modalidades (`calistenia.html` e `musculacao.html`):** `.routine-card` e
   seções em cartões consistentes; contadores de seção em limão tabular;
   resumo de histórico (`.history-summary`) com superfícies afundadas e
   valores tabulares; `.history-status` contido com `white-space: nowrap` e
   `flex-shrink: 0`, eliminando o problema de esticar na largura do item;
   resíduos dourados de `.active-hint` trocados por acento limão translúcido.
3. **Editor de rotina (`rotina.html`):** seções estilizadas com
   `.editor-section`, títulos integrados, contadores de seção tabulares;
   nomes de exercícios com proteção contra quebra anômala de palavras;
   cartão de edição `.exercise-form-card.editing` em acento limão translúcido;
   barra de salvamento alinhada com as superfícies do sistema.
4. **Execução (`executar.html`):** `.exercise-focus` e `.focus-stat` limpos
   com superfícies neutras de alto contraste, preservando estritamente o
   painel e a figura do atlas (`.execution-figure`); `.session-notes` com fio
   de limão translúcido; cronômetro da série e timers com borda ativa limão e
   pausado neutro; descanso (`.rest-panel` e `.rest-caption`) com acento limão
   e superfícies do sistema; painel de pausa `.session-paused-overlay`
   tracejado no padrão; rodapé de ações (`.execution-footer`) centralizado e
   balanceado para desktop e celular sem alterar a fixação.
5. **Resumo pós-treino (`.session-summary`):** círculo de sucesso
   `.summary-check`, rótulo de modalidade e valores estatísticos consolidados
   em limão e superfícies escuras de alto contraste, removendo os gradientes
   dourados residuais.

Nenhum arquivo JS, chave de storage, HTML ou arquivo protegido do atlas foi
alterado. Testes aprovados: `tests/metricas.test.mjs` (18/18),
`tests/forja.test.mjs` (92/92), `tests/atlas.test.mjs` (12/12),
`tests/paridade.test.mjs` (40/40) e suíte ponta a ponta em navegador real
`tests/e2e.browser.mjs` (25/25 verificações completas).

---

## Etapa 8 — Progresso e gráficos

| Ação | Arquivo |
| --- | --- |
| Paleta dos 5 tipos de gráfico, espessura de linha, pontos, rótulos | `forja-graficos.js` (só constantes de estilo) |
| Heatmap, colunas semanais, recordes, histórico | `progresso/index.html` |
| Comparação com sinal e unidade em todos os deltas | markup |

**Verificação:** nenhuma métrica muda de valor — `tests/metricas.test.mjs`
(18 asserções) é a prova. Os gráficos são desenhados em SVG por JS; conferir que
o tema novo não depende de `getComputedStyle` para cor (hoje as cores são
literais no JS → passam a vir de constantes).
**Risco:** médio. **Reversão:** `forja-graficos.js` é um arquivo pequeno (357
linhas) e isolado.

**Situação (25/10/2026): feita, na paleta atual, só com CSS.** A tabela desta
etapa previa paleta no JS; as cores dos cinco gráficos já vinham **todas** de
classes CSS (`--lime`, `--accent-soft`, `rgba(183,243,74,…)`, `--danger`) e
nenhum builder usa `getComputedStyle`. Então não houve cor a mover: o que
faltava era padronizar e consertar. Arquivos tocados: `assets/css/marca.css`
(bloco “ETAPA 8”, escopado em `body[data-page="progresso"]`) e
`assets/js/forja-graficos.js` (só constantes de estilo no topo — geometria da
linha, raio do ponto e medidas do anel — sem tocar em cálculo, saída, texto ou
`aria-label`).

O que entrou:

1. **Gráficos no padrão do sistema:** rótulos na família de texto e valores,
   eixos e tabelas com numerais tabulares; barras com trilho afundado e fio,
   colunas com raio e altura de leitura, linha com área em limão translúcido de
   12% e ponto com anel da cor do fundo (para dois pontos próximos não se
   fundirem com a própria linha).
2. **Heatmap:** dia sem treino com superfície afundada e fio discreto (a grade
   existe mesmo com a janela zerada) e os quatro níveis de limão reafirmados.
   **Correção concreta:** `.ui-heatmap-swatch` não tinha `background` nenhum —
   os cinco quadradinhos da legenda “menos … mais” apareciam vazios em todas as
   telas, não só no Progresso.
3. **Colunas semanais — correção de defeito real:** `.ui-column` era um grid
   sem linha de altura definida e o builder escreve `height: N%` na barra;
   porcentagem contra altura indefinida caía no `min-height`, então **todas as
   oito semanas apareciam com a mesma barra de 2 px** e o gráfico ficava vazio
   (confirmado medindo `getBoundingClientRect` em 390 e 1280 px). Com a linha
   `1fr` e `align-self: end` na barra, a proporção passou a valer: 0 treinos →
   3 px no eixo, 1 de 3 → 26 px, 3 de 3 → 78 px em 390 px e 87 px em 1280 px.
4. **Deltas da comparação:** `.compare-delta.is-down` usava `var(--gold)`, que
   em `performance.css` vale o mesmo limão de `is-up` — alta e queda saíam com
   a mesma cor. Agora alta em limão, queda em `--fj-osso-suave` e estável em
   cinza; o sinal (+/−) e a unidade continuam no texto, medidos no navegador
   (“+2 treinos (+200%)”, “+4 séries (+200%)”, “+1 h 10 min (+200%)”,
   “+200 kg (+200%)”). Nenhum estado depende só da cor.
5. **Recordes, por rotina/exercício e histórico:** superfícies, fios, raios e
   ritmo do sistema; título de recorde em Archivo; valor medido em limão
   tabular; `overflow-wrap` para os nomes longos de exercício em 320 px.
6. **Responsivo:** colunas e células do heatmap crescem um degrau a partir de
   720 px (barra até 44 px, célula 18 px) e encolhem até 320 px (célula 14 px,
   respiro de 3 px, rótulos de 10 px) sem gerar rolagem horizontal.

Escopo preservado: nenhum ID, `data-*`, `href`, `aria-*`, texto, chave de
`localStorage` ou arquivo protegido mudou; `forja-progresso.js` (agregações da
tela), `forja-metricas.js` e `forja-calendario.js` ficaram intocados. Testes
executados: `npm test` **162/162** (MÉTRICAS 18, FORJA 92, ATLAS 12,
PARIDADE 40) e `npm run test:e2e` **25/25** com o Chromium empacotado
(`LD_LIBRARY_PATH` das bibliotecas do próprio pacote, como na etapa 6).

---

## Etapa 9 — Perfil, configurações, explorar

- Formulário de perfil, preferências, três `.storage-panel`, backup.
- `explorar/index.html`: `◉`/`◎` → SVG; remoção dos `style=""` inline.
- Nenhum controle novo; nenhuma preferência nova.

**Verificação:** E2E de backup/restauração; conferir que exportar segue gerando
o mesmo JSON (comparação campo a campo com o export de antes).
**Risco:** baixo.

**Situação (25/10/2026): feita, na paleta atual.** Arquivos tocados:
`assets/css/marca.css` (bloco “ETAPA 9”, escopado em
`body[data-page="perfil"]`, `body[data-page="configuracoes"]` e
`body[data-page="explorar"]`), `perfil/index.html` e `explorar/index.html`
(`configuracoes/index.html` já não tinha estilos inline e recebeu todas as
melhorias via `marca.css`; nenhum arquivo JS foi alterado).

O que entrou:

1. **Superfícies unificadas em Perfil e Configurações:** `.preferences-panel`,
   `.backup-panel` e os três blocos `.storage-panel` (dois em
   `perfil/index.html` e um em `configuracoes/index.html`) passaram ao mesmo
   cartão do sistema (`var(--surface)`, borda `1px solid var(--border)`,
   `var(--radius-lg)`, sem sombra herdada nem fundo translúcido divergente),
   com ritmo vertical consistente e recuos responsivos (20 px em desktop,
   16 px em celular e 14 px até 380 px). Em `configuracoes/index.html`, o
   `.back-link` recebeu superfície contida sem `margin-left: -10px` nem
   sublinhado, evitando corte de foco em 320 px.
2. **Formulário de perfil (`#profile-form`) e seção “Meu corpo”:** grade em
   1 coluna abaixo de 560 px (evitando truncamento de rótulos e `select` em
   320–430 px) e 2 colunas equilibradas a partir de 560 px, com
   `#prof-equipamento` ocupando a linha inteira (`1 / -1`); numerais tabulares
   nos campos numéricos e em `#profile-status`; botão `#profile-save` em
   largura total até 420 px; estado vazio de medidas corporais com borda
   tracejada via CSS e zero `style=""` inline (8 atributos removidos de
   `perfil/index.html`).
3. **Painel de backup (`.backup-panel`) e preferências do descanso
   (`.preferences-panel .check-row`):** botões de exportação, importação e
   desfazer empilhados em largura total no celular e distribuídos em linha a
   partir de 560 px; `#backup-status` separado por fio sutil com tipografia
   tabular legível; linhas `.check-row` escopadas ao painel (sem afetar
   modais de `forja-core.js`) com superfície afundada, alvo mínimo de 48 px e
   realce em `--accent-line` quando marcadas.
4. **Explorar (`explorar/index.html`):** substituição dos glifos `◉`
   (`#card-exercicios`) e `◎` (`#card-anatomia`) por ícones SVG `24×24` de
   traço (`stroke="currentColor"`, `stroke-width="2"`, `aria-hidden="true"`)
   alinhados ao catálogo do sistema (`book` e `atlas`), remoção integral dos
   4 atributos `style=""` inline, restauração da legibilidade de
   `.modality-desc` em 13 px (`Inter Forja`) em todas as larguras (corrigindo a
   redução de 9–10 px herdada de `responsive.css`), grade de 2 colunas em
   `.hub-list` a partir de 720 px com `.modality-meta` alinhado na base e
   atalhos em 2 colunas a partir de 560 px.

Escopo e garantias preservados: nenhum controle novo, nenhuma preferência nova,
nenhum ID, `aria-*`, `role`, texto visível, chave/esquema de `localStorage` ou
arquivo protegido (`forja-calendario.js`, `assets/anatomia/*`,
`forja-figura.js`, `forja-atlas.js`, `atlas.css`, `explorar/atlas.html`) foi
alterado. Comparação campo a campo do JSON gerado por `F.buildBackupObject()`
antes e depois das mudanças (em `perfil` e `configuracoes`): **100% idêntico**
em todas as chaves, metadados e resumos. Testes executados: `npm test`
**162/162** (`metricas` 18/18, `forja` 92/92, `atlas` 12/12, `paridade` 40/40)
e `npm run test:e2e` **25/25** em Chromium real (incluindo backup/restauração
ponta a ponta em Perfil e Configurações e ausência de rolagem horizontal de
320 a 1280 px).

---

## Etapa 10 — Fechamento

| Ação | Detalhe |
| --- | --- |
| Remover literais de cor órfãos | ~159 fora de token no início; meta: só dentro de `atlas.css` e das cores funcionais do atlas |
| Remover regras mortas | 982 regras hoje; medir antes/depois |
| Revisar contraste de toda a UI em 12 páginas | script + leitura |
| Conferir que `marca.css` não passa de ~35 KB | orçamento de CSS |
| Capturas finais das 12 páginas × 6 larguras | `tools/capturas.mjs` |
| Atualizar `docs/forja-3.0-plano.md` com o que mudou | documentação |

**Situação (25/10/2026): feita, na paleta atual e só com CSS + documentação.**
Nenhum JavaScript, HTML, ID, `aria-*`, texto funcional, chave de `localStorage`,
formato de backup ou arquivo protegido mudou. O hash de `forja-calendario.js`
continua `30a8253…928c5` e `atlas.css`/`explorar/atlas.html`/`assets/anatomia/*`
seguem intocados.

1. **Tokens órfãos removidos de `marca.css`.** O `:root` declarava 75 tokens
   `--fj-*`; uma varredura de alcançabilidade sobre `assets/`, as 12 páginas e
   os testes mostrou que só 14 eram referenciados (os de tipografia,
   `--fj-carvao*`, `--fj-linha`, `--fj-ferro-baixo`, `--fj-osso-suave`). Os
   **61 sem consumo** saíram — inclusive toda a paleta brasa/bronze
   (`--fj-brasa*`, `--fj-bronze*`), a semântica não usada (`--fj-ok*`,
   `--fj-alerta*`, `--fj-erro*`), as escalas de texto/raio/espaço/sombra/
   movimento e as medidas de layout não aplicadas. Os protótipos de `design/`
   têm CSS próprio e não consomem esta folha, então nada quebrou.
2. **Regras mortas removidas (comprovadas por ausência no HTML estático e nos
   literais do JS).** Total de conjuntos de regra nas 10 folhas: **1262 →
   1176 (−86)**. Por arquivo: `base` 80→72, `treino` 105→87, `execucao`
   64→61, `app` 351→342, `performance` 93→68, `responsive` 35→27, `system`
   193→179, `marca` 239→238; `atlas.css` (96) e `configuracoes.css` (6)
   intactos. Exemplos removidos: `.app-nav`/`.nav-link` (a navegação é toda
   `.bottom-nav-*`), `.hero`/`.quote*`/`.subtitle`/`.workout-*`,
   `.home-hero*`/`.home-start-*`/`.treino-cta`/`.treino-square-icon|-title|-sub`,
   `.routine-badge`/`.routine-head`/`.active-routine`/`.editor-header`/
   `.editor-name-label`/`.editor-toolbar-actions`, `.session-subactions`,
   `.summary-check`, `.ui-tabs`/`.ui-screen-head`/`.ui-record*`/
   `.ui-chip-ok`/`.ui-chip-danger`/`.ui-button-block`, `.save-button`,
   `.history-card`/`.session-card`/`.settings-card`/`.mission-item`/
   `.modal`/`.modal-content` e `.field-grid.three`.
   **Preservados de propósito:** `.workout-panel` e `.modality-grid` (o teste
   de paridade casa esses seletores no conjunto concatenado das folhas),
   `.treino-square` (forja-inicio.js ainda adiciona a classe por
   compatibilidade), `.task.done`/`.set-pip.done` e `.ui-chip-accent`/
   `.ui-chip-muted` (montados por JS), e tudo do atlas.
3. **Literais de cor.** Total nas 10 folhas: **274 → 237 (−37)**; os 25 de
   `atlas.css` permanecem exatamente iguais. Os literais dourados que sobram
   vivem em regras **vivas** (muitas ativas no `atlas.html`, que não carrega
   `marca.css`), portanto não são órfãos e foram mantidos. As cores
   funcionais e o acento limão (`#B7F34A`/`var(--lime)`) não mudaram.
4. **Tamanho de `marca.css`: 63 129 → 44 301 bytes (−18 828, −29,8%)**, e
   **10 264 bytes em gzip**. O código CSS puro da folha ficou em ~32 KB,
   abaixo do orçamento de ~35 KB; o arquivo cru não chega aos 35 KB por causa
   dos comentários e da formatação expandida (estilo do projeto, sem etapa de
   build/minificação). A meta não foi forçada: nenhuma regra necessária foi
   apagada.
5. **Contraste (medição em navegador real, 12 páginas).** Nova ferramenta
   `tools/auditoria-etapa10.mjs` calcula a razão WCAG 2.1 do texto contra o
   fundo resolvido (composição dos ancestrais) em 390 e 1280 px. **Zero
   falhas**: o menor contraste medido foi **5,94:1** (chip da biblioteca),
   acima do mínimo AA de 4,5:1 para texto normal. Pares-chave: texto escuro
   `#12160c` sobre botão limão = 13,91:1; limão sobre carvão = 14,39:1;
   texto `#F2F4F0` sobre `#0D0F0E` = 17,38:1; apoio `#A0A69F` sobre painel =
   6,91:1; perigo `#FF7777` = 6,67:1; placeholder = 4,56:1.
6. **Capturas e overflow.** A auditoria gera 24 capturas (12 páginas × 390 e
   1280 px) em `artifacts/forja-etapa10/` e mede rolagem horizontal em
   320/360/390/430/768/1280 px: **nenhuma página estoura em nenhuma largura**.
   `tools/capturas.mjs` (fluxo de execução) falha neste ambiente **já na
   `main` limpa, antes de qualquer mudança** — o Chromium empacotado não chega
   a expor `#log-reps` no fluxo automatizado; é limitação da ferramenta/
   ambiente, não regressão (a suíte E2E, que cobre a execução, segue 25/25).

**Testes no estado final:** `npm test` **162/162** (MÉTRICAS 18, FORJA 92,
ATLAS 12, PARIDADE 40) e `npm run test:e2e` **25/25** em Chromium real
(`LD_LIBRARY_PATH=/tmp/fjlibs/lib`, bibliotecas do próprio
`@sparticuz/chromium`, como nas etapas 6–9). Balanço de chaves verificado nas
10 folhas e nenhum erro de console/pageerror nas 12 páginas.

**Saída:** fechamento com métricas antes/depois medidas, sem novas
dependências e sem deploy manual.

---

## 10. Resumo de esforço e risco

| Etapa | Arquivos tocados | Risco | Esforço estimado |
| --- | --- | --- | --- |
| 1 · aprovação | 0 | — | depende de você |
| 2 · fundação | 12 `<head>` + 15 novos | baixo | 0,5 dia |
| 3 · tipografia/superfícies | 2 CSS | médio-alto | 1,5 dia |
| 4 · componentes | 2 CSS | baixo | 1 dia |
| 5 · cabeçalho/logo | 12 HTML + 2 testes | médio | 0,5 dia |
| 6 · início | 1 HTML + CSS | alto | 1,5 dia |
| 7 · treino/execução | 6 HTML + CSS | alto | 2,5 dias |
| 8 · progresso | 1 HTML + 1 JS | médio | 1,5 dia |
| 9 · perfil/explorar | 3 HTML | baixo | 0,5 dia |
| 10 · fechamento | CSS + docs | baixo | 1 dia |
| **Total** | | | **≈ 10,5 dias** |

Sem contar revisão visual a cada etapa, que na prática é o que determina o
ritmo.

---

## 11. Ordem se o tempo for curto

Se só houver espaço para o essencial, a ordem de maior retorno por dia:

1. **Etapa 2 + 5** (fundação + cabeçalho/logo): a marca passa a existir na
   tela, com risco baixo.
2. **Etapa 3** (tipografia + superfícies): é o que faz o produto parecer novo.
3. **Etapa 7** (execução): a tela em que o usuário passa mais tempo.
4. **Etapa 6** (início): a primeira impressão.
5. O resto.

O que **não** deve ser cortado: etapa 4 (estados). Sem estados, a interface
nova parece inacabada nos momentos em que o usuário mais precisa de clareza.

---

## 12. Riscos transversais e como são tratados

| Risco | Probabilidade | Tratamento |
| --- | --- | --- |
| Fonte variável não carrega offline / `file://` | baixa | `@font-face` com caminho relativo + `font-display: swap`; fallback declarado (`ui-sans-serif`, sem salto grande de métrica) |
| Quebra em 320 px | média | checagem obrigatória por etapa, antes de seguir |
| Teste de cor quebra e alguém “conserta” o teste sem critério | média | regra da §0: só muda asserção de literal do app; asserção de atlas nunca muda |
| Divergência entre protótipo e app | média | o protótipo usa as mesmas classes; ao fim de cada etapa, uma captura do app é comparada à do protótipo |
| Alguém pede “tema claro” no meio do caminho | — | fora de escopo: exigiria preferência persistida; fica registrado como decisão consciente |
| Custo de CSS acumulado | baixa | orçamento de 35 KB e remoção dos literais na etapa 10 |
