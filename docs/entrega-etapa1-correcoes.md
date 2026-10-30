# FORJA — Etapa 1: correções funcionais e acessibilidade

Data: 30 de outubro de 2026.
Branch: `arena/ec2468a3-forja`, a partir de `main` (`1f4ead5`, merge do PR #40).
PR em rascunho: `fix: corrigir modalidade, RPE, rodapé e acessibilidade`.

> **Nota sobre a fonte da auditoria.** O caminho indicado em
> `docs/auditoria-completa-forja.md` **não existe neste repositório** (nem em
> nenhum commit do histórico disponível: `git log --all -- docs/` só tem os
> relatórios listados em `docs/`). As correções foram feitas a partir dos quatro
> defeitos descritos na solicitação (FUNC-01, FUNC-02, FUNC-03, A11Y-01),
> confirmados por inspeção do código e reproduzidos antes de corrigir. Nenhuma
> correção fora desses quatro itens foi feita.

Nada de `assets/anatomia/`, `assets/js/forja-figura.js`, máscaras, regiões
musculares, seleção de representação anatômica ou integração de destaques foi
tocado — a integração do PR #40 segue intacta.

---

## 1. Resumo

| ID | Gravidade | Estado | Correção em uma linha |
| --- | --- | --- | --- |
| FUNC-01 | funcional | corrigido | modalidade do plano vem do registro do catálogo (`record.mode`), com `catalogId` como fallback para planos antigos |
| FUNC-02 | funcional | corrigido | `normalizeRpe` substitui `clampInteger(…, 1, 10, 0)`, que transformava vazio em 1 |
| FUNC-03 | layout | corrigido | rodapé volta a reservar a altura da barra fixa em `app.css` e `redesign.css` |
| A11Y-01 | acessibilidade | corrigido | rótulo "Modalidade" oculto só visualmente (não `display: none`) |

Arquivos de aplicação alterados: `assets/js/forja-plano.js`,
`assets/js/forja-dados.js`, `assets/js/forja-sessao.js`, `assets/css/app.css`,
`assets/css/redesign.css`. Testes: `tests/plan.test.mjs`,
`tests/forja.test.mjs`, `tests/e2e.browser.mjs`.

---

## 2. FUNC-01 — planos de musculação salvos como calistenia

### Causa

`routinesForPlan` (e o botão "Iniciar sessão" da prévia, em `forja-plano.js`)
derivavam a modalidade assim:

```js
const mode = session.exercises.some(exercise => exercise.mode === "weights") ? "weights" : "calisthenics";
```

`mode` existe no **registro do catálogo** (`forja-catalogo.js`, `catalogRecord`),
mas não no **exercício normalizado**: `F.catalog.toExercise` passa o registro por
`F.normalizeExercise` (`forja-dados.js`), que devolve apenas campos do formato do
exercício — `mode` é descartado. A comparação era sempre falsa e **toda** rotina
de plano caía no ramo `calisthenics`, inclusive com perfil de musculação.

### Solução

- O plano passa a guardar a modalidade real: `mode` em cada exercício e
  `modality` em cada sessão, gravados a partir do `record.mode` do catálogo no
  momento em que o exercício é materializado (`selectSessionRecords` e
  `validateModelOutput`).
- `sessionMode(session, fallback)` deriva a modalidade **dos exercícios que
  existem**; em sessão mista musculação prevalece (regra anterior preservada).
- Para planos salvos antes da correção (sem `mode`/`modality`), a modalidade é
  resolvida pelo `catalogId`/`libraryId` no catálogo (`exerciseMode`), não por
  campo inexistente.
- `routinesForPlan` e o botão "Iniciar sessão" usam a mesma derivação, então a
  rotina é salva e iniciada na mesma modalidade.
- IDs, nomes, séries e `catalogId` dos exercícios são copiados sem alteração.

### Testes

`tests/plan.test.mjs` (jsdom, catálogo real):

- perfil `weights` → 3 sessões declaradas `weights`, todos os exercícios com
  `mode: "weights"`, **3 rotinas em `weights` e 0 em `calisthenics`** (estado e
  `localStorage`), com IDs/nomes/séries/`catalogId` idênticos aos do plano;
- plano antigo (sem `mode`/`modality`) → 3 rotinas em `weights`, resolvidas pelo
  catálogo;
- perfil `calisthenics` → 3 rotinas em `calisthenics` e 0 em `weights`.

`tests/e2e.browser.mjs` — "FUNC-01: plano de musculação é salvo e iniciado em
weights": gera e salva o plano pelo botão da tela, confere as rotinas no
`localStorage`, compara IDs do plano com os da rotina e clica em "Iniciar
sessão" verificando `activeWorkout.modality === "weights"` e que a rotina existe
em `state.routines.weights`.

---

## 3. FUNC-02 — série sem RPE reaparece como RPE 1

### Causa

`normalizeSetLogs` e `normalizeLogDraft` (usados ao recarregar/retomar a sessão)
normalizavam o RPE com `clampInteger(entry.rpe, 1, 10, 0)`. `clampInteger` faz
`Number(value)` antes de olhar o fallback: `Number(null)` e `Number("")` são `0`,
que é um número finito, então o fallback nunca era usado e o valor era preso no
mínimo — `Math.max(1, 0) = 1`. Resultado: série sem RPE voltava como `rpe: 1` no
armazenamento, no seletor e na lista de séries.

### Solução

- `normalizeRpe(value)` em `forja-dados.js`: `null`, `undefined`, string vazia,
  fora de 1–10 ou não numérico → `null`; 1–10 informado → inteiro arredondado.
- Aplicado em `normalizeSetLogs`, `normalizeLogDraft`, `normalizeSessionFeedback`
  (que tinha cópia da mesma regra) e exposto como `F.normalizeRpe`.
- `clampRpe` (`forja-sessao.js`, usado em "Concluir série", correção de série e
  esforço da sessão) passa a delegar para `F.normalizeRpe`: uma única regra para
  entrada, leitura e exibição.
- Nada muda para valores informados: continuam validados em 1–10 e preservados
  no armazenamento, na retomada e no histórico.

### Testes

`tests/forja.test.mjs` — teste 82 (jsdom):

- matriz da regra: `""`, `null`, `undefined`, `"   "`, `0`, `"0"`, `"abc"`, `11`,
  `-3`, `NaN` → `null`; `6`, `"9"`, `10`, `"7.4"`, `"8"` → preservados;
- série concluída sem RPE → `setLogs.…[0].rpe === null` e lista sem "RPE";
- **após `reload()`** → `rpe` continua `null`, rascunho `""`, seletor `""`, nada
  regravado (é exatamente onde o 1 aparecia);
- RPE 9 informado → gravado, exibido e preservado após recarregar;
- correção de série sem RPE abre com o campo vazio;
- sessão encerrada → histórico com `[null, 7, null]` e `feedback: null` (sem
  esforço inventado).

`tests/e2e.browser.mjs` — "FUNC-02: série sem RPE continua sem RPE ao recarregar
e no histórico": navegador real, série sem RPE, `page.reload()`, conferência do
estado retomado, RPE 9 informado, encerramento da sessão, histórico com
`[null, 9, null]` e página de Progresso mostrando "RPE 9" e **não** "RPE 1".

### Evidência de regressão

Com a expressão antiga restaurada apenas nas duas linhas de normalização, o
teste 82 falha em `1 !== null` — "recarregar inventou RPE na série". Com a
correção, passa.

---

## 4. FUNC-03 — rodapé coberto pela navegação inferior

### Causa

A barra inferior é `position: fixed` (`app.css`) com altura de 69 px
(`--bottom-nav-height`). `marca.css` reserva esse espaço no rodapé:

```css
.site-footer { padding-bottom: calc(var(--bottom-nav-height) + 24px + env(safe-area-inset-bottom, 0px)); }
```

Duas regras carregadas depois encolhiam esse padding:

- `redesign.css` (index, treino, progresso, perfil, explorar):
  `.site-footer { … padding-bottom: 30px; }` — 39 px a menos que a barra;
- `app.css` (rodapé base): `padding: 20px 0 28px`, que é o que vale em
  `explorar/atlas.html`, página que **não** carrega `marca.css`.

Com isso, os dois últimos links do rodapé (atribuição RepDB e "Créditos e
licenças das ilustrações") ficavam atrás da barra fixa no fim da rolagem.

### Solução

- `app.css`: `.site-footer` reserva `calc(var(--bottom-nav-height, 69px) + 28px + env(safe-area-inset-bottom, 0px))`
  (valor de reserva porque em atlas.html a variável não vem de `marca.css`).
- `redesign.css`: o `padding-bottom` volta a ser
  `calc(var(--bottom-nav-height, 69px) + 24px + env(safe-area-inset-bottom, 0px))`
  em vez de 30 px.
- `marca.css` já estava correto e não foi alterado. A navegação inferior não
  mudou (posição, altura, rótulos, item ativo).

### Medição antes/depois

Hit-test com `document.elementFromPoint` no centro de cada linha de cada link do
`.site-footer`, em 13 páginas × 6 larguras (320, 360, 390, 430, 768 e 1280 px),
com a página rolada até o fim:

| Estado | Páginas/larguras com link coberto |
| --- | --- |
| Antes (`main`) | **36** (6 páginas × 6 larguras): index, treino, progresso, perfil, explorar e explorar/atlas |
| Depois | **0** |

Capturas do fim da página (o mesmo recorte, antes e depois) em
`docs/capturas/etapa1-rodape-{antes,depois}-{treino,atlas}-{320,1280}.png` —
em `antes` a linha de créditos desaparece atrás da barra; em `depois` ela fica
inteira acima dela.

### Testes

`tests/e2e.browser.mjs` — "FUNC-03: nenhum link do rodapé fica sob a barra
inferior (6 larguras, todas as páginas)": repete o hit-test em 13 páginas × 6
larguras, exige que cada linha de cada link seja alcançável, que a barra continue
`fixed` com os 5 destinos clicáveis, e que não apareça rolagem horizontal.

---

## 5. A11Y-01 — seletor "Modalidade" sem nome acessível

### Causa

`treino/index.html` tem o rótulo correto (`<label for="hub-modality">Modalidade</label>`),
mas `redesign.css` o removia da árvore de acessibilidade:

```css
body[data-page="treino"] .hub-routines > .field-label { display: none; }
```

Com `display: none`, o `<select>` não recebia nome: a árvore de acessibilidade do
Chromium expunha `role: combobox, name: ""` e o axe acusava `select-name`.

### Solução

O rótulo continua invisível e sem ocupar espaço, mas permanece na árvore de
acessibilidade (técnica *visually hidden*: 1×1 px, `overflow: hidden`,
`clip`/`clip-path`, `white-space: nowrap`, `position: absolute`). O HTML não
mudou — o `for` já apontava para o seletor.

### Validação

- Árvore de acessibilidade (CDP `Accessibility.getPartialAXTree`), antes/depois:
  `name: ""` → `name: "Modalidade"` (`role: combobox`).
- axe-core 4.x (`select-name`, `label`, `button-name`, `link-name`,
  `input-button-name`, `aria-input-field-name`, `form-field-multiple-labels`) nas
  13 páginas: 1 violação (`#hub-modality`) → **0 violações**.
- Aparência: rótulo com 1×1 px e recortado, distância entre o cabeçalho do cartão
  e o seletor continua **0 px** (a versão com `display: none` também não gerava
  espaço) e nenhuma rolagem horizontal a 320 px.

### Testes

`tests/e2e.browser.mjs` — "A11Y-01: seletor Modalidade do hub tem nome acessível
sem mudar a aparência": lê o nó real da árvore de acessibilidade (sem
dependência nova), exige `name === "Modalidade"`, rótulo oculto sem espaço
(≤1 px), `gap ≤ 1 px` e ausência de overflow horizontal.

---

## 6. Testes e verificações executados

Todos os comandos foram executados neste checkout, nesta ordem.

| Comando | Resultado |
| --- | --- |
| `npm ci` | ok |
| `npm test` | **217/217** — MÉTRICAS 18/18, FORJA 108/108, ONBOARDING 21/21, ATLAS 13/13, PARIDADE 40/40, DEMONSTRAÇÕES 17/17 (+ `tests/plan.test.mjs` com as novas verificações de FUNC-01) |
| `npm run test:onboarding` | 21/21 |
| `npm run test:e2e` | 40/40 verificações em navegador real (ver seção 7) |
| `git diff --check` | sem erros de espaço em branco |

Reproduções usadas para provar as causas (temporárias, revertidas em seguida;
nenhuma delas ficou no código):

- `clampInteger(null, 1, 10, 0) === 1` (FUNC-02);
- teste 82 falhando em `1 !== null` com a normalização antiga (FUNC-02);
- teste de plano falhando com a derivação antiga, plano antigo indo para
  `calisthenics` (FUNC-01);
- hit-test do rodapé: 36 páginas/larguras cobertas antes, 0 depois (FUNC-03);
- axe + árvore de acessibilidade: `name: ""` antes, `"Modalidade"` depois
  (A11Y-01).

## 7. Fluxo completo pedido (navegador real)

| Passo | Onde é verificado |
| --- | --- |
| 1. Gerar e salvar um plano | e2e "FUNC-01…" (gera pela tela e salva) |
| 2. Iniciar uma sessão | e2e "FUNC-01…" (botão "Iniciar sessão" do cartão do plano) |
| 3. Registrar série sem RPE | e2e "FUNC-02…" (+ teste 82 em jsdom) |
| 4. Recarregar e retomar | e2e "FUNC-02…" (`page.reload()`) + teste 82 (`app.reload()`) |
| 5. Encerrar a sessão | e2e "FUNC-02…" (encerra e confere o resumo) + teste 82 |
| 6. Consultar o histórico | e2e "FUNC-02…" (página Progresso) + "Finalizar sessão mostra resumo e grava no histórico" |
| 7. Links do rodapé | e2e "FUNC-03…" (13 páginas × 6 larguras, hit-test) |
| 8. Seletor de modalidade | e2e "A11Y-01…" (árvore de acessibilidade) |

---

## 8. Limitações e observações

1. **Documento de auditoria ausente.** `docs/auditoria-completa-forja.md` não
   existe no repositório nem no histórico disponível (o clone tem um único
   commit). As correções seguiram a descrição dos quatro defeitos na solicitação.
2. **Instabilidade pré-existente do E2E.** Antes de qualquer alteração, duas
   execuções de `npm run test:e2e` na `main` falharam em verificações
   *diferentes* e não relacionadas ("Onboarding: 24 telas…" com
   `Opção não encontrada: algumTempo`; "Evolução 1 — instruções…"; e um
   `requestfailed` de script durante a navegação). Os scripts novos esperam o
   `load` da página antes de navegar para não gerar `net::ERR_ABORTED`; nenhuma
   verificação existente foi afrouxada.
3. **axe-core não entrou como dependência.** A suíte usa a árvore de
   acessibilidade do Chromium (CDP), sem pacote novo. O axe foi executado
   manualmente com `npm install --no-save axe-core` só para a evidência acima.
4. **Escopo.** Não há autenticação, monetização, serviço pago ou funcionalidade
   nova. `forja-figura.js`, `assets/anatomia/`, máscaras e regiões musculares não
   foram alterados; nenhuma correção depende deles.
