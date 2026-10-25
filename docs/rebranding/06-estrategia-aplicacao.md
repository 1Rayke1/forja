# Estratégia de aplicação da identidade em cada tela

Como cada área existente recebe a nova identidade **sem perder clareza e sem
mudar função**. A ordem das seções segue a ordem de implementação.

Nenhuma tela nova é criada. Nenhum elemento funcional muda de lugar dentro do
fluxo — mudam superfície, tipografia, espaçamento e hierarquia visual.

---

## 0. Regra transversal

Em todas as 12 páginas, a mesma sequência de mudanças:

1. `<head>` recebe `<link rel="stylesheet" href="…/assets/css/marca.css">`
   por último, `<link rel="icon">`, `<link rel="apple-touch-icon">` e
   `theme-color` novo.
2. `<header class="site-header">`: `.logo` deixa de ser texto e passa a ser
   `svg (emblema óptico, 24 px) + <span class="logo-word">Forja</span>`, com
   `aria-label` preservando a leitura “FORJA — início”.
3. `.tagline` passa a **DISCIPLINA • EVOLUÇÃO • CONSISTÊNCIA** (Inter 600, 9 px,
   tracking 0,30 em) e é **opcional**: visível a partir de 720 px, ausente no
   celular. Ela nunca é reduzida, quebrada ou comprimida para caber.
4. Atributos `style=""` inline são substituídos por classes do sistema
   (`explorar/`, `perfil/`).
5. Barra inferior: mesmos 5 links, mesma ordem, mesmos `data-nav`; muda só
   aparência (ativo em brasa com fio de 2 px).

---

## 1. Início · `index.html` — P0

**O que a tela já responde:** qual é o próximo treino, como está a semana, o
que foi feito por último, o que está marcado no calendário.

**O que muda visualmente:**

| Bloco | Antes | Depois |
| --- | --- | --- |
| Saudação | título 26–30 px, frase em duas cores | Archivo 34 px (44 no desktop), uma frase por linha, a segunda em brasa; eyebrow em bronze |
| Ação principal | card com gradiente de limão, botão grande | card ferro com **fio de brasa de 2 px** no topo, título 22 px, meta 13 px, botão brasa de 46 px; `hint` em 11 px |
| Semana | 4 números soltos | 4 cartões `.ui-stat` com valor 22 px tabular e rótulo 10 px caixa-alta; abaixo, nota de critério |
| Metas | grade de anéis pequenos | linhas de meta com rótulo + “3 de 4” + barra de 4 px (brasa na principal, bronze nas secundárias) |
| Último treino | item de lista simples | `.history-item` com nome, meta e `.chip.ok` |
| Calendário | células 34 px, dourado | células 36 px, ferro alto, dia atual com borda aço, selecionado em brasa, ponto de missão em brasa |
| Missões | barra 5 px, formulário | barra 7 px, checkbox nativo com acento brasa, item concluído em aço riscado |
| Onboarding | painel com borda | painel ferro + hachura de 45° no topo + bigorna 40 px; formulário em 2 colunas no desktop |

**O que não muda:** a ordem dos blocos, os IDs (`#home-action`, `#home-week`,
`#home-goals`, `#home-recent`, `#calendar-grid`, `#task-list`…), o
funcionamento de calendário e missões (`forja-calendario.js`, protegido) e o
fato de a página não gravar nada ao abrir — a única escrita no boot é a
migração de dados que já existe hoje (`F.bootData` → `F.schema.run`), e ela
continua idêntica.

**Risco:** o teste E2E exige `.home-action-button` com altura entre 44 e 100 px
e texto “Montar meu treino” quando não há rotina. A proposta mantém 46 px e o
mesmo texto.

---

## 2. Treino em execução · `treino/executar.html` — P0

É a tela em que o usuário passa mais tempo com o celular na mão e o olho longe.
A identidade entra **por contenção**: fundo mais escuro, hierarquia mais clara,
uma única coisa em brasa por vez.

| Bloco | Decisão visual |
| --- | --- |
| Cabeçalho fixo | cronômetro da sessão em Archivo 18/800 tabular; rótulo da rotina em 11 px caixa-alta |
| Progresso | 4 px, “Exercício 2 de 6” e “7 de 18 séries” em 10 px caixa-alta |
| Foco do exercício | badge de seção em bronze (borda 1 px), posição em 11 px, nome em Archivo 28–34 px, plano em 13 px aço |
| 3 indicadores | `.focus-stat` ferro com valor 18/800; “/ 4” em 11 px aço |
| Figura do atlas | mantida intacta (imagem), com moldura ferro baixo e link “Ver músculos trabalhados” em brasa |
| Pips de série | 5 barras de 5 px: feita em brasa, pendente em ferro alto |
| Cronômetro da série | 44 px, tabular; painel ferro baixo com borda forte |
| Registro | campos em 2 colunas; `.log-entry` com número tabular e ações em texto |
| **Concluir série** | único botão em brasa da tela, 58 px de altura, raio 10 |
| Descanso | painel com borda brasa a 38%, timer 46 px, ajuste ±15 s em botão de 36 px (área de toque 44) |
| Pausa | `.session-paused-overlay` tracejado, texto explica que nada se perde |
| Resumo | **emblema duo de 34–40 px** no canto direito do bloco de conclusão, alinhado ao título “Treino concluído” — nunca acima das métricas; 4 estatísticas + 4 totais em 2 colunas no celular e 4 no desktop; ações “Ver no progresso” (secundário) e “Voltar à modalidade” (primário) |

**O que não muda:** todos os 96 IDs, o cronômetro, o descanso, a fila de
exercícios, o salvamento a cada mutação, o comportamento de retomada. Nada de
novo `setInterval`.

**Cuidado específico:** a tela tem `position: fixed` no rodapé de ações. No
desktop propomos centralizar os botões (`.execution-footer` com
`justify-content: center` e largura máxima de 220 px por botão) sem tirá-los do
rodapé — evita que dois botões de 900 px de largura atravessem a tela.

---

## 3. Rotinas, modalidades e biblioteca — P1

### 3.1 Hub `treino/index.html`

- `.modality-card` recebe ícone real (halteres / barra) no lugar do número
  `01`/`02` — **sem retirar o número**, que vira rótulo pequeno em bronze no
  canto. O cartão ganha borda 1 px e hover de borda forte.
- Botões empilhados no rodapé do hub com hierarquia: primário “Criar nova
  rotina”, dois secundários.

### 3.2 Páginas de modalidade `calistenia.html` / `musculacao.html`

- `.screen-toolbar` com “← Treino”, eyebrow e botão Biblioteca à direita.
- `.routine-card` reestruturado **visualmente**: nome 15/750, meta 11 aço,
  as 4 seções em grade 4×1 com contagem em 15 px tabular (vazias em
  `--fj-desligado`), ações na base com “Iniciar treino” como primário.
- Ferramentas (renomear/duplicar/excluir) em texto 11 px, com exclusão em
  vermelho texto. Hoje estão em botões pequenos lado a lado — a mudança é só de
  peso visual, mantendo os mesmos `addEventListener`.
- `.history-summary`: 4 `.ui-stat`; `.history-list`: `.history-item` com chip.

### 3.3 Editor `treino/rotina.html`

- `.dirty-pill` passa a ter dois estados legíveis: `saved` (verde) e `dirty`
  (âmbar), com ícone de ponto.
- As 4 seções viram cartões iguais (`.editor-section`), com contador em pílula
  e “+ Adicionar” em botão de 36 px.
- `.editor-exercise` em uma linha: nome (13/600), plano (11 aço tabular),
  ferramentas de 36 px. Em 380 px, o nome quebra para a linha de cima.
- Biblioteca dobrável e formulário personalizado mantêm `<details class="custom-meta">`,
  agora com tipografia do sistema e borda 1 px.
- `.editor-save-bar`: barra fixa inferior no celular com “Cancelar” e “Salvar
  rotina” — melhora de alcance do polegar sem mudar de handler.

### 3.4 Biblioteca `treino/biblioteca.html`

- Busca com ícone de lupa dentro do campo (`.ui-search-field` já existe).
- 5 filtros em grade de 2 colunas no celular e 5 no desktop, com rótulo 10 px
  caixa-alta.
- `.ui-exercise-row` com ícone de categoria em bronze, nome 13/650, meta 11,
  tags à direita; no desktop, 2 colunas.
- Estado vazio com bigorna + “Limpar filtros”.
- Detalhe em modal: figura do atlas intacta, instruções em 13/1,55.

---

## 4. Progresso e calendário — P0

A tela mais densa. A ordem de leitura atual está correta; o trabalho é
**ritmo**, não reestruturação.

| Bloco | Decisão |
| --- | --- |
| Filtro de modalidade | segmentado em pílula, 3 itens, ativo em brasa |
| Período | pílulas de semana/mês/tudo/personalizado; campo de data com 44 px |
| Resumo | 5 + 4 `.ui-stat`; o de “concluídos” com `is-accent` |
| Metas | anéis em Archivo 18/800 no centro; legenda 11 px |
| Comparação | linhas com valor 13/750 e delta em verde/vermelho/neutro — **sempre com sinal e unidade** |
| Frequência | heatmap 13 px com 4 níveis de brasa + célula futura tracejada; legenda numérica ao lado |
| Semana a semana | colunas de 30 px, rótulo de 9 px, valor de 10 px; semana sem treino fica vazia (não é omitida) |
| Evolução | selector + linha de 1,8 px com área a 8% e pontos de 2,5 px |
| Recordes | lista com nome, valor em bronze e critério em 10 px aço — o critério **sempre visível**, não em tooltip |
| Por rotina / exercício | listas de 2 colunas com valor tabular |
| Histórico | busca + status; `.history-item` com chip de concluído/parcial |
| Calendário (na home) | ver §1 |

**O que não muda:** nenhum cálculo, nenhum critério, nenhuma métrica nova ou
removida. `forja-metricas.js` não é tocado. A tela continua sem gravar nada.

---

## 5. Perfil, dados e preferências — P1/P2

- Perfil: `.preferences-panel` com formulário em 2 colunas, `check-row` com
  checkbox nativo, três `.storage-panel` em texto 13/1,55.
- Backup: `.backup-panel` com três ações em coluna no celular e linha no
  desktop; `#backup-status` em 11 px aço.
- Configurações: mesma linguagem; a página continua sendo “compatibilidade”,
  sem ganhar destaque na navegação.
- Nenhum controle novo, nenhuma preferência nova (não criar “tema claro”: o app
  é escuro por identidade, e introduzir tema exigiria gravar preferência no
  boot, o que é proibido).

---

## 6. Explorar e Atlas — P2 / protegido

- `explorar/index.html`: os `◉` e `◎` viram ícones SVG de `forja-ui.js`
  (`book` e `atlas`), preservando `id="card-exercicios"` e `id="card-anatomia"`.
  Sai o `style=""` inline.
- `explorar/atlas.html`, `atlas.css`, `forja-atlas.js`, `forja-figura.js` e
  `assets/anatomia/*`: **intocados**. O atlas herda apenas as variáveis
  globais que ele já consome (`--border`, `--panel`, `--muted`), que a camada
  nova redefine de forma compatível. As três cores de papel
  (`#B7F34A`, `#F2B84B`, `#8CC0E0`) permanecem como estão — são informação
  funcional verificada por teste de pixel.
- Se a revisão quiser o atlas dentro da nova paleta, isso é uma etapa separada,
  com atualização de `atlas.test.mjs` e do teste de pixels do E2E, e **exige a
  sua autorização explícita** para remover a proteção.

---

## 7. Formulários, modais, alertas e estados vazios

Ponto de alavancagem: **todos os 17 diálogos passam por uma única função**
(`F.showModal` em `forja-core.js`) e todas as mensagens por `.toast`. Estilizar
esses dois blocos cobre a maior parte da sensação de “produto coeso”.

- `.modal-card`: folha de raio 20, borda forte, sombra 3, título Archivo 18,
  mensagem 13/1,55 em aço.
- `.modal-actions`: dois botões em linha; ação destrutiva em vermelho **só** no
  botão final; foco inicial no botão seguro.
- `.modal-details`: bloco ferro baixo 11 px para detalhes técnicos (chaves de
  backup).
- `.toast`: faixa de 2 px à esquerda por tom; fundo ferro alto; ícone 18 px.
- `.ui-empty`: padrão único para os 14 estados vazios mapeados — bigorna
  isolada, título, explicação do critério e ação.
- `.field-error`, `.field-hint`, `[aria-invalid]`: 11 px, com halo de 3 px.

---

## 8. O que **não** será feito

- Nenhuma tela nova, aba nova, tela de conta, tema claro, PWA ou ícone de
  compartilhamento *com lógica*.
- Nenhuma mudança em chave, formato, migração ou backup.
- Nenhuma mudança em navegação funcional: 5 destinos, mesmos `href`,
  `data-nav`, `aria-current`.
- Nenhum emoji novo; ao contrário, os três existentes saem.
- Nenhuma dependência nova no `package.json`.
- Nenhuma alteração nos 6 arquivos protegidos.

---

## 9. Como a identidade chega ao usuário atual

O usuário que já usa o app percebe a mudança em quatro ondas, e nenhuma delas
quebra seu fluxo:

1. **Primeira abertura após a atualização:** cabeçalho com emblema, paleta de
   carvão/brasa, tipografia nova. Nada de tela de “o que mudou”.
2. **Primeiro treino:** cronômetro tabular, botão de concluir série como única
   ação em brasa, descanso mais legível.
3. **Primeira visita ao progresso:** gráficos em brasa, critério de recorde
   visível, heatmap mais claro.
4. **Primeiro backup:** modal e toast do sistema novo.

Dados, histórico, rotinas, metas e preferências permanecem exatamente iguais —
a mudança é de superfície.
