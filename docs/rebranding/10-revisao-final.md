# Revisão final da etapa 1 — o que aprovar agora

Documento de fechamento da etapa 1. Ele não propõe nada novo: reúne o que você
já aprovou, as telas para revisar nesta rodada, a prova do ícone, a auditoria
de Git e o plano que começa **depois** do seu aval.

**Nada foi implementado. Nenhum commit, push, merge ou deploy.** A árvore de
trabalho tem exatamente dois diretórios novos, `design/` e `docs/rebranding/`,
e zero arquivos rastreados modificados.

---

## 1. Decisões que você já tomou (24/10/2026)

| # | Decisão | Estado |
| --- | --- | --- |
| 1 | Símbolo **A · Emblema** — aro + chama + bigorna de face trapezoidal | fechada |
| 2 | Ícone de app em **disco vazado** | fechada **com condição** — prova entregue (§3) |
| 3 | Cabeçalho 24 px + palavra 19 px, tagline só a partir de 720 px | fechada |
| 4 | Tagline “DISCIPLINA • EVOLUÇÃO • CONSISTÊNCIA”, nunca comprimida | fechada |
| 5 | Emblema duo de **40 px** no resumo pós-treino | fechada |

O que falta: o **aval final** sobre esta rodada. Ele destrava a etapa 2
(aplicação em `assets/`).

---

## 2. Telas para revisar

Todas em `design/prototipo/`, com dados de exemplo digitados a partir dos
fluxos reais. Abra pelo hub: **`design/prototipo/index.html`**.

| Arquivo | O que revisar | Captura |
| --- | --- | --- |
| `inicio.html` | emblema 24 px + “Forja” 19 px no cabeçalho, tagline oculta no celular, fio de brasa nos títulos | `design/capturas/inicio-390.png` · `-1280.png` |
| `execucao.html` | treino em andamento, descanso, pausa e **resumo pós-treino com o duo de 40 px** no canto do bloco de conclusão | `execucao-390.png` · `-1280.png` |
| `rotinas.html` | cartões de rotina, rotação, editor de seções e estado vazio com a bigorna | `rotinas-390.png` · `-1280.png` |
| `biblioteca.html` | **novo**: busca, 5 linhas de filtro com contagem (`seção`, `medida`, `categoria`, `músculo`, `equipamento`), 4 resultados, chip “Seu”, detalhe em modal com a prancha do atlas preservada, estado vazio | `biblioteca-390.png` · `-1280.png` |
| `perfil.html` | **novo**: perfil de treino (5 campos), “Meu corpo” com estado vazio, backup, preferências de descanso, armazenamento e privacidade | `perfil-390.png` · `-1280.png` |
| `progresso.html` | resumo, metas, heatmap, recordes, histórico | `progresso-390.png` · `-1280.png` |
| `componentes.html` | 10 seções do sistema, com todos os estados | `componentes-390.png` · `-1280.png` |
| `responsivo.html` | as 7 telas em 320–768 px e no desktop | — |
| `../marca/index.html` | emblema em três recortes, lockups, construção, regras | `marca-390.png` · `-1280.png` |
| `../marca/icone.html` | **novo**: prova do ícone | `icone-1280.png` |

**Fidelidade ao app.** Biblioteca e Perfil não inventam tela: são espelhos de
`treino/biblioteca.html` e `perfil/index.html`, com as classes que o app já usa
(`catalog-root`, `ui-chips`, `ui-chip-toggle`, `ui-empty`, `backup-panel`,
`preferences-panel`). Nenhum campo, seção ou ação foi acrescentado — só cor,
tipo, espaço e os estados vazios.

**Correção desta rodada.** O glifo de bigorna dos estados vazios foi
redesenhado: na versão anterior, a 34 px ele lia como mesa. A nova silhueta tem
chifre à esquerda, cintura afilada e base larga, e é a mesma nos quatro lugares
onde aparece (vazio de seção, vazio de biblioteca, “Meu corpo” e componentes).

---

## 3. Prova do ícone (a condição do item 2)

Página: **`design/marca/icone.html`** — tamanho real, sem reescalonamento.

| Fundo | 512 / 192 / 180 px | Contraste da silhueta | Veredito |
| --- | --- | --- | --- |
| `#121010` | ícone completo, todos os cortes visíveis | disco × carvão 5,76 : 1 | aprovado |
| `#EFE9E2` | ícone completo, **placa carvão** visível | placa × claro 15,33 : 1 | aprovado |
| claro, disco solto | — | brasa × claro 2,73 : 1 | **reprovado** — por isso o ícone sempre leva a placa |

- **Máscaras:** círculo, squircle e quadrado não mordem a bigorna (folga de 3
  unidades no `viewBox` 64). No recorte circular sobre claro sobra o disco de
  brasa, sem a placa — documentado como exceção de tela inicial.
- **Tamanhos:** 32 px é o menor em que o desenho inteiro se sustenta; em 16 px
  lê-se “disco de brasa”, aceitável só em aba/favicon.
- **O que a prova não cobre:** tela inicial real de iOS/Android (papel de
  parede, sombra, redução do sistema). Isso só se confirma instalando um PWA de
  teste na etapa 2.

---

## 4. Auditoria de Git

Executada no checkout desta sessão, agora:

```
$ git rev-parse --abbrev-ref HEAD
arena/03b006b1-forja

$ git log --oneline -1
17a9157 Merge pull request #19 from 1Rayke1/arena/87b22eb0-forja

$ git status --short
?? design/
?? docs/rebranding/

$ git diff --stat          # arquivos rastreados
(vazio)

$ git diff --cached --stat
(vazio)

$ git ls-files -m | wc -l
0
```

- **65 arquivos novos**, todos dentro de `design/` (7,3 MB, incluindo as 17
  capturas) e `docs/rebranding/` (164 KB). Nenhum arquivo do aplicativo foi
  criado, alterado, renomeado ou apagado.
- Nenhuma dependência nova, nenhuma alteração em `package.json`,
  `package-lock.json` ou `.github/workflows/`.
- Nenhuma chave, formato ou migração de `localStorage` foi tocada.

---

## 5. Arquivos protegidos — conferidos, não presumidos

| Protegido | Verificação | Resultado |
| --- | --- | --- |
| `assets/js/forja-calendario.js` | `sha256` do conteúdo sem espaços nas pontas | `30a825330793e156adc357ae714f022c853033c1016ee66ffeaec1ab705928c5` — idêntico ao da `main` |
| `assets/anatomia/*` (5 arquivos) | `git ls-files -m` | sem modificação |
| `assets/js/forja-figura.js` | idem | sem modificação |
| `assets/js/forja-atlas.js` | idem | sem modificação |
| `assets/css/atlas.css` | idem | sem modificação |
| `explorar/atlas.html` | idem | sem modificação |

Suítes rodadas neste estado (nada em `assets/` mudou, então o placar tinha de
ser o da `main`):

- `npm test` → **162 / 162** (FORJA 92, PARIDADE 40, MÉTRICAS 18, ATLAS 12).
- `npm run test:e2e` → **25 / 25**.

---

## 6. Plano que começa depois do aval

| Etapa | O que faz | Arquivos | Risco |
| --- | --- | --- | --- |
| 1 | congelar esta versão (tag/commit de referência) | — | nenhum |
| 2 | tokens, fontes e os 12 SVG entram como **quarta camada** (`assets/css/marca.css`), sem mudar aparência | +1 CSS, +2 fontes, +12 SVG | baixo · reversível por `git revert` |
| 3 | tipografia e superfícies | `base.css` lido, sobrescrito em `marca.css` | baixo |
| 4 | componentes e estados | `system.css` sobrescrito | baixo |
| 5 | cabeçalho, navegação e rodapé nas 12 páginas | 12 HTML + `marca.css` | médio · é onde a tagline entra |
| 6 | Início | `inicio` + CSS de página | baixo |
| 7 | Treino e execução (inclui resumo com o duo) | `execucao` + CSS | médio |
| 8 | Progresso e gráficos | `progresso` + `forja-graficos.js` | médio |
| 9 | Perfil, configurações, explorar | `perfil`, `configuracoes` | baixo |
| 10 | fechamento: remover literais de cor, orçamento de 35 KB, capturas antes/depois | — | baixo |

- **Esforço:** ~10,5 dias, com a etapa 2–5 concentrando 60% do risco.
- **Testes:** apenas **2 de 187** asserções mudam, ambas por literal de cor
  (`e2e.browser.mjs:1309` e `forja.test.mjs:2660`). As do atlas não mudam.
- **Reversão:** cada etapa é um commit isolado; reverter devolve a aparência
  atual sem tocar em dado.
- **Preservação de dados:** nenhuma etapa escreve em `localStorage`; o backup
  continua nos 13 mesmos nomes de chave e no mesmo formato.

---

## 7. O que preciso de você

1. **Aval final desta rodada** — sim, começa a etapa 2 / não, e o que muda.
2. Se quiser, posso **commitar esta entrega** (`design/` + `docs/rebranding/`)
   num commit de documentação para servir de referência congelada. Hoje ela
   está só na árvore de trabalho, não rastreada.
3. Se aprovar, o primeiro commit da etapa 2 é o mais seguro de todos: tokens e
   fontes, sem mudar um pixel visível — e o placar tem de continuar 162 + 25.
