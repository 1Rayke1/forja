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
`--fj-brasa*`, `--fj-bronze*` e semânticos declarados em `marca.css` seguem lá
sem uso (remoção possível na etapa 10).

| Etapa | Situação |
| --- | --- |
| 1 | congelada (`738eca5`) |
| 2 | parcial: `marca.css` com fontes e tokens, `<link>` em 11 páginas (`11c18c7`, `184b218`); favicon, SVGs de marca, `theme-color` e `preload` eram do emblema e saem do escopo |
| 3 | fatia 1: tipografia por classe e superfície do casco (`8b17e3e`); cartões mantidos como estão |
| 4 | **feita em 25/10/2026, na paleta atual** — ver “Situação” na própria etapa |
| 5 | **feita em 25/10/2026, na paleta atual** — ver “Situação” na própria etapa |
| 6 | **feita em 25/10/2026, na paleta atual e só com CSS** — ver “Situação” na própria etapa |
| 7–10 | pendentes |

Pendências encontradas na etapa 4 e deixadas para a etapa de cada tela:

- resíduos do dourado antigo em blocos de tela — hover e `::after` de
  `.modality-card`; `.exercise-focus` (pai da figura: exige o cuidado da
  etapa 3); `.session-notes`; `.rest-panel` e `.rest-caption`;
  `.session-summary` com `.summary-stat` e itens; `.exercise-form-card.editing`;
  `.timer-panel.is-paused` (etapa 7);
- `.summary-label` (Progresso, modalidades, resumo) em minúsculas de 10 px,
  enquanto `.ui-stat-label` e `.home-week-stat-label` são caixa-alta de 11 px:
  padronizar com a tela, porque em 320 px “CONCLUÍDOS” não cabe na coluna;
- foco inicial do diálogo destrutivo cai no botão de perigo (`F.showModal`
  foca a primeira ação que não é “cancelar”); levar ao botão seguro exige
  mudança de lógica em `forja-core.js`;
- `.compare-delta.is-down` usa `var(--gold)`, hoje igual ao limão de
  `is-up` (etapa 8);
- nomes que quebram no meio da palavra em 320 px (linha do editor, caixas de
  seção do cartão de rotina) e `.history-status` esticado na largura do item
  (etapa 7);
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

---

## Etapa 9 — Perfil, configurações, explorar

- Formulário de perfil, preferências, três `.storage-panel`, backup.
- `explorar/index.html`: `◉`/`◎` → SVG; remoção dos `style=""` inline.
- Nenhum controle novo; nenhuma preferência nova.

**Verificação:** E2E de backup/restauração; conferir que exportar segue gerando
o mesmo JSON (comparação campo a campo com o export de antes).
**Risco:** baixo.

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

**Saída:** um commit de fechamento com métricas antes/depois.

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
