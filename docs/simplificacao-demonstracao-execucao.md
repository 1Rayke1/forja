# Simplificação visual da demonstração — relatório

Data: 2026-11-24 · Branch: `arena/b1020537-forja` (base `1f8c0710c52d2714cb6e890b3086a1c614882eb1`)
**Estado: commit único na branch `arena/b1020537-forja` (sobre `1f8c071`); PR
aberto para a `main` sem merge — o merge continua aguardando aprovação.**

## 1. Resultado em uma frase

A execução do treino agora mostra a foto do exercício maior e mais legível, e
**Ver demonstração** deixou de abrir a ficha completa: apresenta apenas o
**Atlas muscular** com os destaques do exercício e o **vídeo já associado**
(16:9, sem autoplay). Nenhum texto editorial, card ou botão extra.

## 2. O que foi implementado

### 2.1 Tela de execução (`assets/css/execucao-referencia.css`)

| Item | Antes | Depois |
| --- | --- | --- |
| Altura do bloco da foto (390 px) | 192 px | **211 px** (`clamp(190px, 54vw, 300px)`) |
| Largura | 390 px (cheia) | 390 px (cheia, mantida) |
| Dessaturação / brilho | `grayscale(.88) contrast(1.14) brightness(.76)` | `grayscale(.42) contrast(1.06) brightness(.9)` |
| Scrim | topo `#050605`, 42% nas laterais | topo `rgba(5,6,5,.86)`, 32% nas laterais |
| Espaço vertical entre blocos | `gap: 8px` | `gap: 6px` |

- A foto continua com `object-fit: cover` e `object-position: center 30%`;
  a altura só cresce quando existe foto (`:not(.sem-foto)`), então o estado sem
  foto mantém a altura compacta original.
- Nenhum controle mudou de tamanho: a folga veio apenas do `gap` da coluna.
- Em 390 × 844 o documento fecha em **844 px = viewport** (sem rolagem), com
  CTA e barra inferior visíveis.

### 2.2 Fluxo próprio da demonstração (`assets/js/forja-catalogo.js`, `forja-sessao.js`)

- Novo `showDemonstration(record)` dentro de `forja-catalogo.js`.
- `showDetail(record, { demonstration: true })` desvia para esse fluxo; o botão
  `#execution-instructions` passou a chamar com `{ readOnly: true, demonstration: true }`.
- `demonstrationAtlasBlock(record)` reutiliza `F.atlas.figurePair` +
  `F.atlas.highlightsFor` — a mesma prancha e a mesma classificação do Atlas,
  sem legenda escrita nem tabela de papéis.
- `videoBlock(record, { title: "Demonstração", reference: <tem ilustração> })`
  reutiliza o palco existente (`F.videos.createStage` + `F.youtube.render`),
  com as mesmas regras: `youtube-nocookie`, `autoplay=0`, `controls=1`,
  16:9, sem Shorts.
- O detalhe completo (biblioteca, editor, busca de vídeo) **não mudou**: o
  desvio só acontece com a opção `demonstration`.

### 2.3 Ausência de vídeo

| Situação | Comportamento |
| --- | --- |
| Sem vídeo, com ilustração de referência | mostra a ilustração RepDB do próprio exercício + aviso discreto “Demonstração em vídeo ainda não disponível para este exercício.” |
| Sem vídeo e sem ilustração (exercício personalizado) | mostra **apenas** o aviso; nenhuma imagem/vídeo inventado |
| Offline | mesmo caminho acima, sem requisição externa |

A imagem de referência só entra como **substituta** do player ausente
(`referenceDetails: false` em `forja-videos.js` evita repetir a ilustração ao
lado de um vídeo disponível).

### 2.4 Cache

- `treino/executar.html`: `execucao-referencia.css?v=4` e
  `forja-sessao.js?v=4`.

## 3. Medições no navegador

### Execução (Supino reto com barra, foto exata)

| Viewport | Foto | Documento | Concluir série | Rodapé |
| --- | --- | --- | --- | --- |
| 320 × 568 | 320 × 190 | 820 px (rola) | fora da 1ª tela (igual à base) | fora (igual à base) |
| 360 × 800 | 360 × 194 | 810 px (10 px, base já rolava 8 px) | visível | visível |
| 390 × 844 | 390 × 211 | **844 px = viewport** | visível | visível |
| 412 × 915 | 412 × 222 | **915 px = viewport** | visível | visível |

Controles medidos em 320/360/390/412: `Encerrar` 44 px, gatilho do anel 148–181 px,
`Anterior`/`Próximo` 60 × 77–81 px, `Concluir série` 58 px, `Pausar treino` e
`Mais opções` 48 px, `Ver demonstração` 94–98 × 82–84 px. **Nenhum** ausente,
oculto ou abaixo de 44 px em nenhuma largura; nome do exercício sem corte.

### Demonstração (390 × 844)

| Item | Antes | Depois |
| --- | --- | --- |
| Cartão | 354 × 680 | **374 × 828** |
| Rolagem interna do painel | 2052 px | **707 px = 707 px (não rola)** |
| Seções | Identificação, Demonstração em vídeo, Classificação no ranking, Equipamentos, Execução, Técnica, Cuidados, Músculos, Suas observações | **Atlas muscular, Demonstração** |
| Títulos | 9 | **2** |
| Atlas | — | 140 × 312 por vista, 2 vistas, regiões do exercício |
| Player | 16:9 | 320 × 179 (16:9) |
| Botões | Fechar + Adicionar ao treino | **Fechar** |

Destaques do supino lidos do DOM: `peito:primary`, `triceps:secondary`,
`ombros:secondary`, `dorsais:stabilizer` — exatamente a classificação do
catálogo (`F.atlas.highlightsFor`).

Em 320 × 568 a demonstração continua `atlas + vídeo`, sem overflow horizontal
(`atlas 124 × 276`, cartão 304 × 552); o vídeo exige rolagem vertical, como
esperado em uma tela de 568 px.

## 4. Testes executados

| Suíte | Resultado |
| --- | --- |
| `tests/forja.test.mjs` | 109/110 (falha só em `76e`, pré-existente) |
| `tests/atlas.test.mjs` | **16/16** (novo `ATLAS 12b`: atlas + vídeo, destaques por exercício) |
| `tests/demonstracoes.test.mjs` | **17/17** (`D16` reescrito para o contrato atlas + vídeo) |
| `tests/videos-youtube.test.mjs` | **14/14** (`V4`: sem vídeo → ilustração + aviso) |
| `tests/biblioteca-detalhe.test.mjs` | **13/13** |
| `tests/youtube-frontend.test.mjs` | **8/8** |
| `tests/execucao-referencia.browser.mjs` | **7/7** (mede foto nas 6 larguras e o modal enxuto) |
| `tests/e2e.browser.mjs` | **46/46** |
| `tests/paridade.test.mjs` | 39/40 (`10. home-notifications-dot`, pré-existente) |

Falhas **preexistentes**, confirmadas com `git stash` e nova execução na base:

- `forja.test.mjs 76e` — contagem de chaves de storage (21 ≠ 19) durante eventos
  `storage`/`pageshow`; flake de ambiente.
- `paridade.test.mjs 10` — id `home-notifications-dot` citado por
  `forja-inicio.js` e ausente das páginas; já falhava em `1f8c071`.

Observação: a primeira execução de `execucao-referencia.browser.mjs` logo após
`npm install` costuma dar 2/7 por Cold start do CDP; as execuções seguintes dão
7/7 (repetido 3×).

## 5. Capturas

Em `docs/capturas/`:

- `antes-execucao-390.png` / `demonstracao-execucao-390.png` — execução antes
  (foto 192 px, dessaturada) e depois (211 px, legível).
- `antes-demonstracao-390.png` / `demonstracao-atlas-video-390.png` — modal
  antes (9 seções, 2052 px de rolagem) e depois (atlas + vídeo, sem rolagem
  interna).
- `demonstracao-atlas-video-320.png` — mesma tela em 320 px.
- `demonstracao-sem-video-390.png` — polichinelo: ilustração de referência +
  aviso discreto.

## 6. Arquivos modificados

```
assets/css/execucao-referencia.css
assets/css/system.css
assets/js/forja-catalogo.js
assets/js/forja-sessao.js
assets/js/forja-videos.js
treino/executar.html
tests/atlas.test.mjs
tests/demonstracoes.test.mjs
tests/e2e.browser.mjs
tests/execucao-referencia.browser.mjs
tests/forja.test.mjs
docs/atlas-anatomico.md
docs/capturas/*.png (6 novas)
docs/simplificacao-demonstracao-execucao.md (este relatório)
```

## 7. Pendências / riscos

- Em 320 × 568 e 360 × 800 a página de execução rola na vertical, como já
  acontecia antes da mudança em 320 (e em 360 por 8 px, agora 10 px).
- A ilustração de referência do polichinelo é a do próprio RepDB (não é uma
  animação de polichinelo); é o dado existente, não foi substituída nem
  inventada.
- As alterações estão em um commit único da branch `arena/b1020537-forja`;
  `main` não foi tocada e nenhum merge foi feito.
