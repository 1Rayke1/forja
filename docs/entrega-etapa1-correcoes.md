# FORJA — Etapa 1: correções funcionais e acessibilidade (30/10/2026)

Correção dos **quatro defeitos prioritários** apontados para esta etapa:
modalidade do plano, RPE vazio, rodapé coberto pela navegação inferior e nome
acessível do seletor de modalidade. Branch: `arena/40b31f61-forja`.
Nenhuma mudança de formato de dados, nenhuma migração removida, nenhum
identificador de exercício alterado e nenhuma consolidação visual geral.

> O relatório citado na etapa (`docs/auditoria-completa-forja.md`) **não existe
> neste repositório** — foi verificado com `find`/`git log` em `main` e no
> checkout atual. Os quatro defeitos foram lidos da descrição da etapa e
> **confirmados por inspeção do código e medição em navegador real** antes de
> qualquer alteração; as medições estão em "Evidências".

---

## 1. Estado de cada correção

| ID | Estado | Causa raiz | Correção | Teste de regressão |
| --- | --- | --- | --- | --- |
| FUNC-01 | corrigido | `exercise.mode` não existe no exercício normalizado | modalidade derivada do catálogo (`record.mode`) via `libraryId`/`catalogId` | `tests/plan.test.mjs` (2 blocos) |
| FUNC-02 | corrigido | `clampInteger("")` devolve 1 (mínimo da faixa) | `normalizeRpe`: vazio/fora da faixa ficam ausentes | `tests/forja.test.mjs` (teste 82) |
| FUNC-03 | corrigido | `redesign.css` sobrescrevia o padding do rodapé com 30 px; o Atlas não carrega `marca.css` | padding do rodapé passa a somar a altura real da barra | `tests/e2e.browser.mjs` (FUNC-03) |
| A11Y-01 | corrigido | `display: none` tirava o `<label>` da árvore de acessibilidade | rótulo com `.ui-visually-hidden` | `tests/e2e.browser.mjs` (A11Y-01) |

---

## 2. FUNC-01 — modalidade incorreta ao salvar planos

**Origem.** `assets/js/forja-plano.js` derivava a modalidade com
`session.exercises.some(exercise => exercise.mode === "weights")`.
`normalizeExercise` (`forja-dados.js`) não devolve campo `mode`: o exercício de
uma rotina guarda `id`, `name`, `sets`, `type`, `reps`, `duration`, `rest`,
`load`, `notes`, `section`, `measure`, `distance`, `distanceUnit`, `libraryId`,
`instructions` e, opcionalmente, `demoId`. A expressão era sempre falsa, então
**todo plano era salvo em `calisthenics`** — inclusive o de um perfil de
musculação, cujos exercícios são todos de `weights`.

**Solução.** A modalidade vem do catálogo, que é a fonte da verdade
(`record.mode` em `forja-catalogo.js`). `catalogModes()` indexa
`F.catalog.items()` por `libraryId` e por `id`; `sessionModality(session)`
consulta esse índice pelo vínculo que o exercício guarda (`catalogId`, copiado
de `libraryId` no plano). O critério de escolha é o de antes — um exercício de
musculação torna a sessão de musculação; sem exercício de carga a sessão é de
calistenia —, só passa a usar a modalidade real de cada exercício. Nenhum campo
fictício foi criado e nenhum identificador foi alterado.

O botão **"Iniciar sessão"** usava a mesma expressão quebrada: agora usa a
modalidade da rotina já salva (`F.getRoutineById`), que é a que está em "Minhas
rotinas", e só deriva do catálogo se a rotina não existir no estado. Antes, com
a modalidade errada, `F.startRoutine` não encontrava a rotina e o botão não
fazia nada.

**Arquivo:** `assets/js/forja-plano.js`.

---

## 3. FUNC-02 — RPE vazio aparece como RPE 1

**Origem.** `normalizeSetLogs` (e `normalizeLogDraft`) em `forja-dados.js` fazia
`rpe: clampInteger(entry.rpe, 1, 10, 0) || null`. `clampInteger`
(`forja-core.js`) começa com `Number(value)`: `Number("")` é **0**, que é
finito, então o clamping devolvia o mínimo da faixa — **1**. A série era gravada
com `rpe: null` (correto) e, ao recarregar, a leitura da sessão ativa devolvia
`rpe: 1`: a lista mostrava "RPE 1", o editor da série mostrava 1 e o rascunho
reabria com 1.

**Solução.** `normalizeRpe(value)` em `forja-dados.js`: `undefined`, `null`,
string vazia, texto e número fora de 1–10 ficam **ausentes** (`null`); valor
informado é arredondado para inteiro e mantido. Usada em `normalizeSetLogs`,
`normalizeLogDraft`, `normalizeSessionFeedback` (regra única, mesmo
comportamento de antes) e em `clampRpe` de `forja-sessao.js`, que passa a
delegar para ela — o valor digitado, o corrigido e o relido do armazenamento
não podem divergir. O formato gravado não mudou: `rpe` continua `null` ou
inteiro de 1 a 10.

**Arquivos:** `assets/js/forja-dados.js`, `assets/js/forja-sessao.js`.

---

## 4. FUNC-03 — rodapé atrás da navegação inferior

**Origem.** `marca.css` (regra 5.3) dá ao rodapé
`padding-bottom: calc(var(--bottom-nav-height) + 24px + env(safe-area-inset-bottom))`
— 93 px, contra uma barra de 69 px. `redesign.css` é carregado **depois** e
sobrescrevia só o `padding-bottom` com **30 px**, cobrindo os links do rodapé.
A barra nessas páginas é mais alta que a das outras (`.bottom-nav-link` com
`min-height: 62px` → 1 + 6 + 62 + 6 = **75 px**), então o token de 69 px de
`marca.css` também não servia.

Medição antes da correção (Chromium headless, página rolada até o fim,
`document.elementFromPoint` no centro de cada caixa de texto do link):

| Página | 320 | 360 | 390 | 430 | 768 | 1280 |
| --- | --- | --- | --- | --- | --- | --- |
| início, treino, explorar, progresso, perfil | 27–44 px cobertos, toque caía na barra | idem | idem | idem | idem | idem |
| configuracoes, biblioteca, calistenia, musculacao, rotina, executar | 0 px | 0 px | 0 px | 0 px | 0 px | 0 px |
| **explorar/atlas.html** | 0 px* | 22–39 px cobertos | idem | idem | idem | idem |

\* a 320 px o Atlas redireciona para a início (gate de perfil), por isso a
auditoria não viu a página.

**Solução.**

- `redesign.css`: `--fj-bottom-nav-height: 75px` (altura real da barra nessas
  páginas) e `padding-bottom: calc(var(--fj-bottom-nav-height) + 24px +
  env(safe-area-inset-bottom, 0px))` — a mesma regra 5.3 de `marca.css`, com a
  medida certa. Nenhuma margem exagerada: a folga visível entre o último texto
  do rodapé e a barra continua de 24 px, igual às outras páginas.
- `app.css`: o valor padrão do rodapé passa a
  `calc(var(--bottom-nav-height, 69px) + 28px)`, com fallback para a página do
  Atlas, que não carrega `marca.css`. É a única página afetada por essa linha
  (todas as outras sobrescrevem o padding em `marca.css`/`redesign.css`).

**Arquivos:** `assets/css/redesign.css`, `assets/css/app.css`.

---

## 5. A11Y-01 — seletor de modalidade sem nome acessível

**Origem.** O HTML de `treino/index.html` tinha
`<label class="field-label" for="hub-modality">Modalidade</label>`, mas
`redesign.css` ocultava o rótulo com
`body[data-page="treino"] .hub-routines > .field-label { display: none; }`.
`display: none` remove o elemento da árvore de acessibilidade, então o
`<select id="hub-modality">` ficava **sem nome acessível** (regra `select-name`
do axe; `<select>` não tem placeholder).

Verificado na árvore de acessibilidade do Chrome (`Accessibility.getFullAXTree`,
o mesmo algoritmo de cálculo de nome usado pelo axe):

| Estado | nó do seletor |
| --- | --- |
| antes (`display: none`) | `{ role: "combobox", name: "" }` |
| depois | `{ role: "combobox", name: "Modalidade" }` |

**Solução.** A regra `display: none` foi removida e o rótulo passou a usar
`.ui-visually-hidden` (utilitário já existente em `system.css`, usado por
`forja-ui.js` e `forja-graficos.js`): invisível na tela, mas anunciado. O nome
vem do `<label for>` — não de placeholder nem de `aria-label` — e o `<select>`
continua com `select.labels === ["Modalidade"]`.

**Sem regressão visual:** as capturas `a11y-hub-modalidade-390-antes.png` e
`a11y-hub-modalidade-390-depois.png` são **pixel a pixel idênticas** (maior
diferença de canal: 1 em 8 bits, sobre 329.160 pixels). O teste E2E compara a
geometria do seletor e da lista com o rótulo em `display: none` e exige que
seja igual.

**Arquivos:** `treino/index.html`, `assets/css/redesign.css`.

---

## 6. Testes executados (resultados reais)

```
npm test                       → MÉTRICAS 18/18 · FORJA 108/108 · ONBOARDING 21/21
                                 PLANO (endpoint + plano + FUNC-01) · ATLAS 12/12
                                 PARIDADE 40/40 · DEMONSTRAÇÕES 17/17
npm run test:e2e               → E2E navegador real — 38/38 verificações aprovadas
git diff --check               → sem erros de espaço em branco
```

Novos testes de regressão:

- `tests/plan.test.mjs` — FUNC-01: perfil de musculação gera e salva **três
  rotinas em `weights` e nenhuma em `calisthenics`** (no estado e no
  armazenamento), identificadores e vínculos com o catálogo válidos, rotina
  sobrevive ao reload, "Iniciar sessão" abre a sessão em `weights`; perfil de
  calistenia continua em `calisthenics`.
- `tests/forja.test.mjs` — teste 82 (FUNC-02): unidade de `normalizeRpe`
  (vazio, `null`, `"0"`, 0, 11, texto, 10.6 → ausentes; 1, 6, 8, 10, 7.4 →
  válidos), `normalizeSetLogs`/`normalizeLogDraft`, e o ciclo completo na tela:
  registrar série sem RPE → lista sem RPE → `rpe: null` gravado → **recarregar**
  → continua sem RPE na lista, no rascunho e no editor → encerrar → histórico
  sem RPE. Segunda sessão com RPE 9: aparece, sobrevive ao reload, correção para
  7 e limpeza para ausente funcionam.
- `tests/e2e.browser.mjs` — FUNC-03: 14 páginas × 6 larguras (320, 360, 390,
  430, 768, 1280) = 84 combinações, com hit-test real (`elementFromPoint` no
  centro de cada caixa de texto do link) e clique real no link "Créditos e
  licenças das ilustrações" a 320, 390 e 1280 px, que navega para
  `configuracoes/index.html#creditos-imagens`.
- `tests/e2e.browser.mjs` — A11Y-01: nome acessível na árvore de acessibilidade
  do Chrome, rótulo associado e invisível, geometria inalterada, filtro
  continua funcionando.

Cada teste novo foi verificado contra o código anterior: com as correções
revertidas, FUNC-01 falha em `0 !== 3` (nenhuma rotina em `weights`), FUNC-02
falha em `[1, 1, ...]` (séries sem RPE voltando com 1), FUNC-03 falha em 27–44 px
de sobreposição e A11Y-01 falha com `name: ""`.

---

## 7. Evidências

- `artifacts/forja-visual/func03-rodape-perfil-390-antes.png` e `-depois.png` —
  Perfil a 390 px: antes, os links de crédito ficavam sob a barra; depois, o
  rodapé inteiro fica acima dela.
- `artifacts/forja-visual/func03-rodape-inicio-390-antes.png` e `-depois.png` —
  mesma comparação na página inicial.
- `artifacts/forja-visual/a11y-hub-modalidade-390-antes.png` e `-depois.png` —
  hub de treino a 390 px, idênticos pixel a pixel.

---

## 8. Limitações e observações

1. **O arquivo `docs/auditoria-completa-forja.md` não está no repositório.** Os
   defeitos foram confirmados por inspeção e medição próprias; se o relatório
   original existir em outro lugar, vale cruzar os números da tabela da seção 4.
2. **Uma sexta página tinha o mesmo defeito do rodapé:** `explorar/atlas.html`,
   que não carrega `marca.css`. A auditoria citava cinco páginas; a correção
   cobre as seis, com a mesma regra e sem tocar no Atlas.
3. **O teste E2E de onboarding é instável neste ambiente** (depende de `sleep`):
   em 7 execuções completas com as correções aplicadas, 5 passaram 38/38 e 2
   falharam **apenas** nesse verificador — que não foi alterado por esta etapa e
   não tem relação com as quatro correções (as duas falhas foram em asserções
   diferentes: "O perfil deve ser gravado na conclusão" e uma etapa fora de
   ordem). Para descartar relação de causa, a réplica isolada do mesmo fluxo
   (23 telas, com o armazenamento limpo entre execuções) passa **5/5 no código
   corrigido e 5/5 no código anterior**. Nenhum dos testes novos apresenta
   instabilidade nas 7 execuções.
4. **Sessão mista:** se um perfil com acesso a academia sortear, na mesma sessão,
   exercícios de musculação e de calistenia, a rotina continua sendo salva em
   `weights` (critério preservado de "qualquer exercício de carga"), e os
   exercícios de calistenia entram com ela. É o comportamento anterior à
   correção, agora com a modalidade certa.
