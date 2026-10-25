# Sistema visual — especificação completa

Protótipo executável: `design/prototipo/componentes.html`.
Tokens: `design/tokens/forja.css` (arquivo de proposta, fora de `assets/`).

---

## 1. Princípios

1. **O treino é o conteúdo.** Cor, forma e grafismo nunca competem com série,
   carga, descanso e histórico.
2. **Uma ação primária por tela.** Só ela usa brasa. Todo o resto é neutro.
3. **Borda antes de sombra.** No escuro, o que separa planos é 1 px de linha —
   não brilho. Sombra só em três casos: modal, pílula de navegação e toast.
4. **Zero efeito decorativo.** Sem gradiente de superfície, sem glow, sem
   textura metálica, sem vidro.
5. **Nada aparece duas vezes.** Um símbolo, um acento, um ângulo (45°), uma
   escala de espaço.
6. **A imagem da marca é a calma.** Premium, aqui, é contenção.

---

## 2. Cor

### 2.1 Paleta principal

| Token | Hex | Papel | Onde |
| --- | --- | --- | --- |
| `--fj-carvao` | `#121010` | fundo do app | `body` |
| `--fj-carvao-fundo` | `#0D0B0B` | fundo de moldura | cabeçalho fixo, ícone |
| `--fj-ferro` | `#1A1717` | superfície 1 | cartões, painéis |
| `--fj-ferro-alto` | `#221E1D` | superfície 2 | item dentro do cartão, botão de nav |
| `--fj-ferro-baixo` | `#151212` | superfície afundada | input, trilha de progresso |
| `--fj-linha` | `#302B29` | borda padrão | 1 px em tudo |
| `--fj-linha-forte` | `#453E3A` | borda de destaque | hover, divisor visível |
| `--fj-osso` | `#F2EDE7` | texto primário | títulos, números |
| `--fj-osso-suave` | `#D8D2CA` | texto primário em cartão | corpo |
| `--fj-aco` | `#A6A29B` | texto secundário | meta, descrição |
| `--fj-aco-forte` | `#8C8781` | texto terciário | legenda, nota |
| `--fj-desligado` | `#6E6964` | desabilitado | botão e campo bloqueado |
| `--fj-brasa` | `#E4693A` | **ação** | botão primário, foco, série feita |
| `--fj-brasa-alta` | `#F08356` | hover | — |
| `--fj-brasa-baixa` | `#B04F27` | pressionado | — |
| `--fj-bronze` | `#C08B4E` | **material** | emblema, fio de seção, recorde |
| `--fj-bronze-alto` | `#DCA75F` | bronze em texto pequeno | valor de recorde |
| `--fj-bronze-escuro` | `#8A5A2B` | bronze sobre claro | material impresso |
| `--fj-claro` | `#EFE9E2` | superfície clara | material, imagem de compartilhamento |
| `--fj-preto-quente` | `#17130F` | texto sobre claro | — |

### 2.2 Semântica

| Token | Hex | Uso |
| --- | --- | --- |
| `--fj-ok` | `#7FB08D` | treino concluído, salvamento confirmado |
| `--fj-alerta` | `#D9A657` | alterações não salvas, treino parcial |
| `--fj-erro` | `#E2706A` | falha de gravação, exclusão, arquivo inválido |

Cada um tem uma variante “lavada” a 12% de opacidade, usada só como fundo de
faixa de estado — nunca como cor de texto.

### 2.3 Contraste medido (WCAG 2.1)

Fundo de referência `#121010` (carvão) e `#1A1717` (ferro).

| Cor de texto | vs carvão | vs ferro | AA texto normal (4,5) | AAA (7) |
| --- | --- | --- | --- | --- |
| osso `#F2EDE7` | **16,29** | 15,31 | ✅ | ✅ |
| osso suave `#D8D2CA` | 12,64 | 11,87 | ✅ | ✅ |
| aço `#A6A29B` | **7,46** | 7,01 | ✅ | ✅ |
| aço forte `#8C8781` | **5,33** | 5,00 | ✅ | ❌ (usar só ≤ 14 px de apoio) |
| brasa `#E4693A` | **5,76** | 5,41 | ✅ | ❌ |
| brasa alta `#F08356` | 7,30 | 6,86 | ✅ | ✅ |
| bronze `#C08B4E` | **6,36** | 5,98 | ✅ | ❌ |
| bronze alto `#DCA75F` | 8,42 | 7,91 | ✅ | ✅ |
| ok `#7FB08D` | 7,67 | 7,21 | ✅ | ✅ |
| alerta `#D9A657` | 8,62 | 8,09 | ✅ | ✅ |
| erro `#E2706A` | 6,10 | 5,73 | ✅ | ❌ |
| desabilitado `#6E6964` | 3,49 | 3,28 | ❌ (não textual / estado desabilitado é isento) | ❌ |

Contraste de **botão primário**: texto `#14100C` sobre brasa `#E4693A` = **5,75**
✅. Osso sobre brasa daria 2,83 ❌ — por isso o texto de botão nunca é branco.

Contraste sobre **fundo claro** `#EFE9E2`: preto quente 15,33 ✅ · bronze escuro
4,87 ✅ · aço `#6B6156` 5,02 ✅ · erro `#B3453F` 4,54 ✅. **Brasa 2,73 ❌ e
bronze 2,47 ❌** — proibidos sobre claro.

### 2.4 Regras de cor

- Uma cor de acento por bloco. Brasa é ação/progresso; bronze é material.
- Brasa nunca é fundo de texto corrido, nunca é fundo de card inteiro.
- Nunca comunicar estado **só** por cor: todo chip e todo gráfico tem texto
  equivalente (o app já faz isso com a tabela alternativa dos gráficos).
- Cores de papel do atlas (`#B7F34A`, `#F2B84B`, `#8CC0E0`) **não entram nesta
  camada** — são dado funcional da página protegida.

### 2.5 O que muda em relação ao app atual

| Hoje | Proposta | Motivo |
| --- | --- | --- |
| acento verde-limão `#B7F34A` | brasa `#E4693A` | limão é a cor mais “tech fitness” do mercado e foi escolha da versão anterior; brasa carrega o conceito de forja com contraste equivalente (14,4 → 5,76) |
| dois `:root` concorrentes com os mesmos nomes | uma camada final que redefine tokens | hoje a paleta é definida três vezes (`base`, `performance`, `system`) |
| `radial-gradient` de limão no `body` | fundo chapado `#121010` | efeito decorativo; o princípio 4 elimina |
| `linear-gradient` como “textura” do `.ui-card` | superfície chapada + borda | idem |
| `Arial` (`base.css`) e `Inter` pedida mas não entregue | Archivo + Inter auto-hospedadas | consistência real de tipografia |

---

## 3. Tipografia

### 3.1 Famílias

| Função | Família | Arquivo | Licença |
| --- | --- | --- | --- |
| Títulos, marca, números-herói, cronômetro | **Archivo** (variável, `wght` 100–900, `wdth` 62–125) | `archivo-variable-latin.woff2` · 88 KB | SIL OFL 1.1 |
| Corpo, rótulos, tabelas, inputs | **Inter** (variável, `wght` 100–900) | `inter-variable-latin.woff2` · 47 KB | SIL OFL 1.1 |
| Fallback | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` | — | — |

Total de fonte: **~135 KB**, subconjunto latino, `font-display: swap`,
auto-hospedado. Nenhuma requisição a terceiros (coerente com um app que declara
não enviar dados para fora). Sem CDN, sem Google Fonts.

**Cronômetro:** Inter com `font-variant-numeric: tabular-nums`. Não se usa fonte
monoespaçada separada — o relógio não pode parecer um componente de outro
produto.

### 3.2 Escala

| Token | Tamanho | Altura de linha | Uso |
| --- | --- | --- | --- |
| `--fj-texto-2xs` | 10 px | 1,4 | eixo de gráfico, marca d'água |
| `--fj-texto-xs` | 11 px | 1,45 | rótulo caixa-alta, nota |
| `--fj-texto-sm` | 13 px | 1,5 | meta, apoio, botão |
| `--fj-texto-md` | 15 px | 1,55 | corpo |
| `--fj-texto-lg` | 18 px | 1,2 | título de seção |
| `--fj-texto-xl` | 22 px | 1,2 | título de bloco |
| `--fj-texto-2xl` | 28 px | 1,2 | título de tela |
| `--fj-texto-3xl` | 34 px | 1,08 | número-herói, título da home |
| `--fj-texto-4xl` | 44 px | 1,05 | cronômetro |

Razão aproximada de 1,25 entre degraus. No celular, título de tela fica em
`clamp(26px, 7vw, 30px)`; no desktop (`≥ 720 px`) vai a 34 px e a home a 44 px.

### 3.3 Pesos e tracking

| Papel | Peso | Tracking |
| --- | --- | --- |
| Título grande | 800 | −0,025 em |
| Título de tela | 800 | −0,02 em |
| Título de seção | 750 | −0,01 em |
| Rótulo caixa-alta | 700 | +0,09 a +0,13 em |
| Corpo | 420 | 0 |
| Botão | 650–700 | 0 |
| Número de dado | 800 | −0,02 em, tabular |
| Palavra da marca | 750 · largura 108% | +0,06 em |

### 3.4 Regras

- Título é **caixa alta só na marca e em dois rótulos** (eyebrow de seção e
  nome de modalidade). Fora disso, frase normal — caixa alta em frase longa é
  ilegível.
- Nenhum texto abaixo de 10 px.
- Nenhum texto de corpo abaixo de 13 px.
- Números sempre com `tabular-nums` quando estão em coluna ou mudam em tempo
  real.
- Não existe itálico no sistema (a marca não usa; a interface não precisa).

---

## 4. Espaço, forma e elevação

### 4.1 Escala de espaço (base 4)

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56` → `--fj-1 … --fj-9`

| Aplicação | Celular | Desktop |
| --- | --- | --- |
| Margem lateral do container | 16 (32 no total) | 24 (48 no total) |
| Largura máxima de leitura | — | 880 px |
| Largura máxima de formulário | 560 px | 560 px |
| Padding de cartão | 16 | 20 |
| Espaço entre seções | 32 | 40 |
| Espaço entre cartões | 12 | 16 |
| Gap interno de grade | 8 | 8–12 |

**Nenhum valor fora da escala.** Hoje há 5, 7, 9, 10, 11, 13, 14, 17, 18, 19,
21, 22, 23, 25, 27 px espalhados pelos arquivos; a camada nova normaliza.

### 4.2 Raios

| Token | Valor | Uso |
| --- | --- | --- |
| `--fj-raio-xs` | 6 px | chip, marca d'água, item de log |
| `--fj-raio-sm` | 10 px | input, botão, cartão interno |
| `--fj-raio-md` | 14 px | cartão, painel |
| `--fj-raio-lg` | 20 px | modal, folha |
| `--fj-raio-pill` | 999 px | filtro segmentado, pílula de navegação, contador |

Regra: **ação principal nunca é pílula** (pílula é filtro/contador). Botão de
execução usa 10 px para parecer instrumento, não etiqueta.

### 4.3 Bordas e elevação

- **1 px** `--fj-linha` em toda superfície. É o que separa planos no escuro.
- **1 px** `--fj-linha-forte` apenas no hover/foco de superfície.
- **2 px bronze** no fio do título de seção.
- **2 px tracejado** em vazio (linha forte) e em erro (vermelho).
- Sombra 1: `inset 0 1px 0 rgba(255,255,255,.03)` — relevo quase invisível.
- Sombra 2: `0 8px 24px rgba(0,0,0,.28)` — pílula de nav no desktop, toast.
- Sombra 3: `0 24px 64px rgba(0,0,0,.46)` — modal.
- Proibido: `box-shadow` colorida, glow, `backdrop-filter` fora do cabeçalho e
  da barra inferior.

---

## 5. Ícones e elementos gráficos

- Conjunto: os **26 caminhos SVG** de `forja-ui.js` (24×24, traço 2, cantos
  arredondados, `currentColor`). Nenhum emoji, nenhum símbolo tipográfico
  (`◉`, `◎`, `↗`) na interface.
- Tamanhos: 20 px na barra inferior, 18 px dentro de botão, 16 px em rótulo.
- Traço 2 em 24 px; em tamanhos menores, 1,75.
- Ícone nunca é a única informação: sempre há rótulo ou `aria-label`.
- **Grafismos:** fio de brasa (2 px, topo do cartão de ação), fio de bronze
  (14 × 2 px, antes do título de seção), hachura de 45° (vazio/onboarding,
  opacidade 0,16), bigorna isolada (34 px, só em vazio) e o emblema nos dois
  pontos de marca (cabeçalho e confirmação de treino). Nada mais.

---

## 6. Componentes

Todos correspondem a classes que **já existem** no app.

| Componente | Classe real | Especificação nova |
| --- | --- | --- |
| Botão primário | `.primary-button`, `.add-button`, `.save-button`, `.big-set-button` | brasa, texto `#14100C`, raio 10, altura mín. 44 (execução: 58), peso 700 |
| Botão secundário | `.secondary-button`, `.small-button` | transparente, borda `--fj-linha-forte`, texto osso |
| Ação terciária | `.nav-text-button` | texto aço, sublinhado de 1 px, altura 40 |
| Ação destrutiva | `.danger-button` | texto erro, borda erro a 40%; no modal, fundo erro |
| Cartão | `.ui-card`, `.calendar-panel`, `.routine-card`, `.backup-panel`, `.preferences-panel` | ferro, borda 1 px, raio 14, padding 16/20, sem gradiente |
| Cabeçalho de seção | `.section-title` + `.ui-section-head` | Archivo 18/750 + fio bronze 14×2 à esquerda |
| Chip | `.ui-chip`, `.chip` | raio 6, caixa alta 10 px, borda 1 px; variantes brasa/ok/erro/bronze |
| Estatística | `.ui-stat`, `.summary-item`, `.summary-stat` | valor Archivo 18/800 tabular; rótulo 10 px caixa-alta |
| Segmentado | `.filter-group`, `.ui-segmented` | pílula, item ativo em brasa cheia, texto escuro |
| Lista | `.ui-list`, `.ui-list-item` | ferro baixo, borda 1 px, raio 10, hover `rgba(255,255,255,.03)` |
| Linha de exercício | `.ui-exercise-row` | 58 px de altura mínima, nome 13/650, meta 11 aço, tags à direita |
| Barra de progresso | `.progress-track` / `.progress-fill` | 4 px (7 no bloco de missões), pílula, brasa; variante bronze para meta secundária |
| Registro de série | `.log-entry` | ferro baixo, número tabular, ações em texto |
| Cronômetro | `.timer-display`, `.execution-clock`, `.rest-timer` | Archivo 800, tabular; 44 px na série, 46 no descanso, 18 no cabeçalho |
| Barra inferior | `.bottom-nav` + `.bottom-nav-inner` | 5 colunas; celular: barra com borda superior; desktop: pílula flutuante centralizada; ativo em brasa + fio de 2 px |
| Cabeçalho | `.site-header` | fixo, `backdrop-filter: blur(14px)`, emblema óptico 24 + palavra 19; tagline “DISCIPLINA • EVOLUÇÃO • CONSISTÊNCIA” só a partir de 720 px |
| Rodapé | `.site-footer` | borda superior, mote em bronze caixa-alta, nota de armazenamento |
| Modal | `.modal-backdrop` / `.modal-card` | folha de raio 20, borda forte, sombra 3, ações em 2 colunas |
| Toast | `.toast` | faixa de 2 px à esquerda (brasa/ok/erro), fundo ferro alto |
| Campo | `input`, `select`, `textarea` | ferro baixo, borda forte, raio 10, 44 px, foco brasa + halo 3 px a 12% |
| Estado vazio | `.ui-empty` | tracejado, bigorna isolada em bronze, título Archivo, texto aço, ação opcional |
| Confirmação de treino | `.session-summary` + `.summary-head` | emblema duo de 34–40 px no canto, alinhado ao título; nunca acima da métrica |
| Esqueleto | *(novo, só onde há espera real)* | bloco ferro alto com brilho de 1,6 s, desligado em `prefers-reduced-motion` |

---

## 7. Estados

| Estado | Desenho | Regra de texto |
| --- | --- | --- |
| **Vazio** | `.ui-empty` tracejado + bigorna | dizer o que falta, o que **não** foi apagado e a próxima ação |
| **Carregando** | esqueleto com altura final preservada | — |
| **Erro** | `.ui-empty` com borda erro + ícone alerta | dizer o que aconteceu, o que permanece intacto e como tentar de novo |
| **Sucesso** | `.toast.ok` + chip ok | confirmar o efeito colateral (“o histórico não foi alterado”) |
| **Foco** | contorno 2 px brasa, offset 3 px | obrigatório em todo controle; nunca remover |
| **Desabilitado** | opacidade 0,42, sem sombra | sempre acompanhado do motivo visível |
| **Sessão ativa** | `.active-session-banner` com borda brasa a 38% | nome da rotina + “Retomar” + “Encerrar” |
| **Sujo/salvo** | `.dirty-pill` (alerta / ok) | no editor de rotina |
| **Validação** | `.field-error` + `[aria-invalid]` | mensagem afirma o intervalo válido |

---

## 8. Responsividade

| Largura | Layout | Detalhes |
| --- | --- | --- |
| 320–359 | 1 coluna | container 24 px; título 26 px; estatística em 2 colunas; navegação com rótulo de 10 px |
| 360–429 | 1 coluna | padrão; container 32 px; título 30 px; células de calendário 36 px |
| 430–559 | 1 coluna larga | resumo em 4 colunas; tags do exercício à direita |
| 560–719 | 1 coluna | grades internas em 3; foco de execução com 3 indicadores na linha |
| 720–1023 | 2 colunas | container 48 px até 880; hub e biblioteca em 2 colunas; calendário 54 px |
| 1024+ | 2 colunas + pílula | home em 2 colunas; barra inferior vira pílula centralizada |

Regras invioláveis: **nenhuma rolagem horizontal** (≤ 1 px), **alvo de toque
mínimo 44 px**, `overflow-wrap: anywhere` em nome de rotina/exercício,
`min-width: 0` em toda coluna de grade, e a barra inferior sempre reservando o
próprio espaço com `padding-bottom`.

---

## 9. Movimento

- 120 ms para cor/borda, 180 ms para opacidade e transform.
- Curva `cubic-bezier(.2,.7,.3,1)`.
- Só animam: cor, borda, opacidade, `width` de barra de progresso.
- Nunca animam: posição de layout, altura, imagem, cronômetro.
- `prefers-reduced-motion: reduce` zera tudo (0,01 ms), inclusive o brilho do
  esqueleto — herdando o que `performance.css` já faz hoje.

---

## 10. Uso pontual de grafismos da forja

| Grafismo | Onde | Como | Nunca |
| --- | --- | --- | --- |
| Fio de brasa | topo de `.home-action-card` | 2 px, degradê de brasa para transparente em 70% | em cartão comum |
| Fio de bronze | antes de `.section-title` | 14 × 2 px, raio 2 | como marcador de lista |
| Hachura 45° | vazio, onboarding | `repeating-linear-gradient`, bronze 0,16 | no fundo do app |
| Bigorna isolada | vazio, onboarding | 34–56 px, bronze | com dados na tela |
| Emblema óptico | cabeçalho de todas as páginas | 24 px, ao lado da palavra de 19 px | como textura repetida |
| Emblema duo | confirmação de treino | 34–40 px no canto do bloco, bronze + brasa | acima das métricas, ou em tamanho que compita |
| Tagline | cabeçalho ≥ 720 px, rodapé, material | Inter 600 · 6,2–9 px · tracking 0,30 em · aço | no celular, em chips, em modal, em ícone |

---

## 11. Acessibilidade

- Contraste AA em todo texto e 3:1 em todo elemento de interface (medido em §2.3).
- Foco sempre visível, 2 px, com afastamento.
- Nenhum estado transmitido só por cor.
- Toda imagem de marca com `role="img"` e rótulo; ícone decorativo com
  `aria-hidden="true"`.
- Alvo de toque ≥ 44 × 44 px.
- Texto ampliado a 200% sem corte (a grade cai para 1 coluna em vez de esconder).
- `prefers-reduced-motion` respeitado.
- Nenhuma informação essencial em `title` de tooltip (não existe em toque).
