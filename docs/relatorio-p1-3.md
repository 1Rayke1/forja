# FORJA — P1.3: refinamento da hierarquia visual e consistência da interface

**Base:** `e6a0793a1af261a0f9276918bc4d7cc4e338fabe` (merge do PR #32 na `main`).
**Status do PR #32:** `MERGED` em 2026-10-26T12:49:10Z — confirmado via `gh pr view 32` e via o próprio commit da `main`. Portanto esta etapa usa o código já atualizado, sem misturar entregas.
**Branch de entrega:** `arena/8eb5828b-forja` — branch fixa desta sessão; por isso ela é a branch específica da P1.3. Não foi criada nem alterada outra branch, conforme a restrição do ambiente.

> `relatorio-diagnostico.md` não existe neste checkout, no histórico Git nem no workspace. O corpo do PR #32 informa que as evidências do diagnóstico ficaram fora do repositório, em `/home/user/forja-diagnostico`, diretório que também não está disponível aqui. Em vez de presumir as medições antigas, todas foram refeitas sobre o código atual com um conjunto de dados sintético determinístico e relógio congelado.

---

## 1. Arquivos alterados

| Arquivo | Tipo | Papel |
|---|---|---|
| `assets/css/marca.css` | **único arquivo de runtime alterado** | Nova seção P1.3 na camada de marca já existente, com escopo explícito para `inicio`, `treino`, `explorar`, `progresso` e `perfil`. Nenhuma folha nova, nenhuma mudança na ordem de carregamento. |
| `tools/capturas-p13.mjs` | ferramenta de evidência | Sobe o app sob `/forja/`, congela o relógio, semeia dados sintéticos e captura as 5 telas em 320/360/390/430/768/1280 px, com medições de layout. |
| `tools/comparar-p13.mjs` | ferramenta de evidência | Compara antes/depois: texto, storage, overflow, contraste, alvos, grids e uso do verde-limão. |
| `docs/relatorio-p1-3.md` | relatório | Este documento. |
| `docs/capturas/p1-3/**` | evidências | 60 capturas de viewport antes/depois, 10 comparativos, medições brutas e `validacao.json`. |

**Não houve diff** em `assets/js/*`, `assets/css/atlas.css`, `assets/anatomia/*`, `explorar/atlas.html`, `tests/*`, `package.json`, `package-lock.json`, nenhum HTML de runtime, nenhuma chave de `localStorage`, nenhuma migração, nenhum cálculo e nenhuma dependência nova. O `npm install` usado para rodar os testes apenas instalou `devDependencies` já declaradas.

---

## 2. Principais decisões visuais e justificativa

### A. Hierarquia tipográfica

Escala validada no navegador em 320 px antes de adotada:

| Papel | Antes (390 px) | Depois (390 px) | Em 1280 px |
|---|---:|---:|---:|
| H1 | 26–27,3 px | **30 px** | **38 px** |
| Título da ação principal | 19 px | **21–24 px** | 24 px |
| Título de seção | 19 px / peso 800 | **18 px / peso 700** | ~20,5 px |
| Título de cartão | 15–19 px | **16–18 px** | 16–18 px |
| Texto de apoio | 13–15 px | **13–15 px** | 13–15 px |
| Rótulos | 11 px | **12 px** | 12 px |

O H1 ficou visivelmente dominante; as seções perderam peso em vez de competir com ele. Rótulos subiram de 11 para 12 px para melhorar a leitura no celular. A medida dos subtítulos e notas foi limitada a 66–70 caracteres. Nenhuma família tipográfica foi trocada: Archivo e Inter continuam sendo as fontes.

### B. Cartões e superfícies

- Raios e bordas padronizados em duas escalas: **12 px** para linhas/cartões secundários e **16 px** para painéis principais.
- O cartão de ação da Home deixou de ter fundo verde translúcido; agora é uma superfície neutra com **um traço vertical lime** na borda. O verde ficou concentrado no botão.
- Estatísticas repetidas viraram **faixas com separadores de 1 px**: semana na Home, resumo do período e totais em Progresso. Em vez de 3, 4 ou 5 cartões visualmente iguais, há uma única superfície com divisórias.
- Painéis de Perfil e cartões de Explorar/Treinos passaram a usar a mesma superfície, borda e padding.

### C. Botões, links e verde-limão

- **Primário:** preenchido em verde-limão, texto escuro, 48 px de altura, sem brilho/glow.
- **Secundário:** superfície elevada escura, borda cinza, texto claro, 44 px de altura.
- **Link:** verde-limão, sem preenchimento, sublinhado no hover e alvo de 44 px.
- Não foi aplicada a regra mecânica de “um botão verde por tela”: em Treinos, cada rotina mantém sua própria ação primária “Iniciar treino”; removê-la ou descolori-la prejudicaria a função.
- Em Progresso, o filtro ativo passou a ter superfície neutra com **traço lime na base**, enquanto o segmento de período ativo continua preenchido em lime. Valores informativos, status “Concluído”, recordes, ícones de Explorar e navegação do calendário deixaram de usar lime sem necessidade.

Redução de elementos com lime (soma dos 30 snapshots de 5 telas × 6 larguras):

| Propriedade | Antes | Depois |
|---|---:|---:|
| `color` | 564 | **324** |
| `background-color` | 186 | **96** |
| `border-color` | 534 | **366** |

Exemplo por tela em 390 px — Progresso: `color` **41 → 11**, `background` **20 → 5**, `border` **34 → 12**; Explorar: `color` **17 → 11**.

### D. Grids e indicadores

- Metas da Home e de Progresso: sempre **1, 2 ou 3 colunas conforme o número real de metas ativas**, via `:has()`; em 320 px os anéis reduzem de 88 para 72 px para caberem em três colunas. Fim do anel órfão na última linha.
- Resumo do período: **2+2+1** em telas estreitas, com o último item ocupando a largura toda; **5 colunas** a partir de 720 px.
- Totais de Progresso: **2+2** no celular e **4 colunas** a partir de 560 px.
- O validador encontrou **22 problemas de grid antes** (linha órfã ou colunas vazias) e **0 depois** em todos os snapshots.

### E. Gráficos

- Barras e colunas históricas passaram a usar verde-limão **translúcido**; apenas a semana atual recebe lime cheio. A linha de evolução mantém lime no traço, com área e pontos históricos mais discretos.
- Onde existe tabela acessível, os valores numéricos repetidos ao lado de cada barra foram **ocultados apenas visualmente** (técnica de `clip`, não `display:none`). Eles continuam no DOM, no `aria-label` do gráfico e, principalmente, na **tabela visível** logo abaixo, que conserva todas as linhas e valores. Justificativa funcional: o desenho mostra a forma/comparação e a tabela continua sendo a leitura exata; nenhuma tabela ou informação foi removida.
- A tabela ficou tipograficamente secundária, com separador superior e a última linha em destaque. Captions e explicações continuam presentes.
- Os dois gráficos de “Semana a semana” (treinos × séries) foram separados por um divisor e mais espaço, deixando claro que são métricas diferentes, não uma duplicação.

### F. Telas maiores

- Container das cinco telas passou de 860 px para **até 1120 px** a partir de 1100 px, sem alterar outras páginas.
- **Início:** semana e metas lado a lado; último treino, calendário e missões em largura cheia; calendário e missões em duas colunas.
- **Treinos:** rotinas em duas colunas no desktop; se houver número ímpar, o último cartão ocupa a largura toda em vez de ficar órfão.
- **Progresso:** pares de seções em duas colunas; “Semana a semana” e “Histórico” permanecem em largura cheia por conterem gráficos/tabelas longos. A ordem visual acompanha a ordem do DOM e do teclado.
- **Perfil:** formulário principal e Privacidade em largura cheia; os quatro painéis curtos em duas linhas equilibradas.
- Altura do documento a 1280 px: Início **2201 → 1751**, Treinos **1159 → 899**, Progresso **6715 → 5699**, Perfil **2152 → 1843**. Explorar subiu pouco (**844 → 885**) por conta do padding maior dos cartões.

---

## 3. Capturas antes/depois

Método: Chromium 138 headless, servidor local sob `/forja/`, relógio fixo em 2026-10-26, dados sintéticos idênticos antes e depois, `deviceScaleFactor: 1`, fonte carregada antes da captura. O “antes” foi gerado restaurando temporariamente `assets/css/marca.css` do commit-base; nenhuma branch foi trocada.

Comparativos por largura — **linha de cima: antes; linha de baixo: depois**, na ordem Início, Treinos, Explorar, Progresso, Perfil:

| Largura | Comparativo |
|---:|---|
| 320 px | [abrir](capturas/p1-3/comparativos/largura-320.png) |
| 360 px | [abrir](capturas/p1-3/comparativos/largura-360.png) |
| 390 px | [abrir](capturas/p1-3/comparativos/largura-390.png) |
| 430 px | [abrir](capturas/p1-3/comparativos/largura-430.png) |
| 768 px | [abrir](capturas/p1-3/comparativos/largura-768.png) |
| 1280 px | [abrir](capturas/p1-3/comparativos/largura-1280.png) |

Recortes específicos:

- [Metas da Home em 320/390 px](capturas/p1-3/comparativos/metas-inicio.png)
- [Gráficos semana a semana em 390/1280 px](capturas/p1-3/comparativos/graficos-progresso.png)
- [Progresso em 390 px: topo, meio e fim](capturas/p1-3/comparativos/progresso-390.png)
- [Progresso em 1280 px: topo, meio e fim](capturas/p1-3/comparativos/progresso-1280.png)

Capturas individuais de viewport: `capturas/p1-3/antes/<tela>-<largura>.png` e `capturas/p1-3/depois/<tela>-<largura>.png` (5 telas × 6 larguras × 2 estados). As capturas roladas e de detalhe foram consolidadas nos comparativos acima para evitar o artefato do Chromium que pinta a barra fixa no meio de um `fullPage`.

Medições brutas: [antes](capturas/p1-3/medicoes/antes.json), [depois](capturas/p1-3/medicoes/depois.json). Resumo da comparação: [validacao.json](capturas/p1-3/validacao.json).

---

## 4. Verificação funcional e de acessibilidade

### Dados exibidos

`tools/comparar-p13.mjs` comparou, nos 30 pares de página × largura:

- `main.textContent` normalizado: **idêntico**;
- texto dos seletores funcionais (`#progress-sessions`, `#goals-progress`, `#progress-history`, `#hub-routine-list`, `#profile-form` etc.): **idêntico**;
- snapshot de todas as chaves `forja-*` do `localStorage`: **idêntico**.

Nenhuma fórmula, valor, cálculo, chave, migração ou formato de backup foi alterado.

### Layout e acessibilidade

| Verificação | Antes | Depois |
|---|---:|---:|
| Overflow horizontal máximo nas 6 larguras | 0 px | **0 px** |
| Contraste mínimo medido (meta ≥ 4,5:1) | 6,91:1 | **6,91:1** |
| Alvos < 44 px sem justificativa (30 snapshots) | 42 | **0** |
| Problemas de grid (órfãos/colunas vazias) | 22 | **0** |
| Erros de console nas capturas | 0 | 0 |

Exceções declaradas de alvo de toque: os botões `.day` do calendário têm **altura ≥ 44 px** mas largura de 34–41 px em telas estreitas, pois sete colunas precisam caber em 320 px; os `input[type=checkbox]` visuais têm 20 px, mas o `label.check-row` inteiro tem altura ≥ 48 px e é clicável. O foco visível global de `performance.css`, a navegação por teclado, o skip link e `prefers-reduced-motion` foram preservados — nenhuma animação nova foi adicionada.

---

## 5. Resultados reais dos testes

Comandos executados após a alteração final (com as bibliotecas do Chromium empacotado disponíveis via `LD_LIBRARY_PATH`):

```
npm test
  MÉTRICAS   — 18/18
  FORJA      — 107/107
  ONBOARDING — 17/17
  ATLAS      — 12/12
  PARIDADE   — 40/40
  TOTAL      — 194/194, exit 0

npm run test:e2e
  E2E navegador real — 33/33 verificações aprovadas, exit 0
```

O baseline antes das mudanças também passou com **194/194** e **33/33**. Nenhum teste foi alterado. `git diff --check` limpo.

---

## 6. Arquivos protegidos

`git diff --exit-code` aplicado a `assets/js/`, `assets/css/atlas.css`, `assets/anatomia/`, `explorar/atlas.html`, `tests/`, `package.json` e `package-lock.json` retornou **sem diferenças**. Hashes SHA-256 (prefixo) comparados com `HEAD`:

| Arquivo | HEAD | Working tree |
|---|---|---|
| `assets/js/forja-calendario.js` | `9db0176e…` | `9db0176e…` |
| `assets/js/forja-atlas.js` | `fd4603d3…` | `fd4603d3…` |
| `assets/js/forja-figura.js` | `1caaf7f6…` | `1caaf7f6…` |
| `assets/css/atlas.css` | `019b66d1…` | `019b66d1…` |
| `explorar/atlas.html` | `f674b9c9…` | `f674b9c9…` |
| `assets/anatomia/anterior.png` | `ea3543dc…` | `ea3543dc…` |
| `assets/anatomia/posterior.png` | `d00d8144…` | `d00d8144…` |
| `assets/anatomia/manifest.json` | `3d12a6e1…` | `3d12a6e1…` |

`marca.css` não é carregado por `explorar/atlas.html`; além disso, todos os novos seletores são restritos às cinco páginas desta etapa. Os testes de pixel, cores e responsividade do atlas continuam passando.

---

## 7. Problemas conhecidos e itens fora do escopo

- O `relatorio-diagnostico.md` e as evidências externas citadas no PR #32 não estavam disponíveis neste ambiente; as medições foram refeitas, não presumidas.
- Validação feita em Chromium headless no sandbox. Sem teste em aparelho Android/iOS real, Safari, leitor de tela físico, toque real ou rede lenta.
- A grade de 7 dias do calendário não consegue oferecer 44 px de largura em 320 px sem rolagem interna; optou-se por manter a grade inteira e garantir 44 px de altura. Checkboxes pequenos mantêm o rótulo inteiro como alvo.
- Onboarding, Configurações, Biblioteca, Execução, Editor de rotina, telas de modalidade e Atlas ficaram fora do escopo visual. Eles podem herdar apenas os tokens já existentes; nenhuma regra P1.3 os alcança.
- A seção nova de `marca.css` é extensa porque concentra, num único lugar e com escopo explícito, decisões que antes estariam espalhadas em cinco folhas. Não foi criada uma folha nova nem alterada a ordem de carregamento — é a camada final que o projeto já usa. Uma consolidação futura poderá incorporar essas regras às seções originais, se a revisão julgar pertinente.
- **Sem merge e sem deploy.** Esta entrega aguarda revisão do PR.
