# Plano técnico por etapas

Como sair do estado atual (identidade textual, limão) para a identidade FORJA
sem quebrar nada. **Nada aqui foi executado** — este é o plano da etapa
seguinte, condicionado à sua aprovação.

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
| Superfícies (`--fj-carvao`/`ferro`/`ferro-alto`), bordas, raios, sombras — **remapeando os nomes legados** (`--panel`, `--border`, `--muted`, `--accent`) dentro de `marca.css` | `marca.css` |
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
