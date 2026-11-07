# Auditoria — Biblioteca de exercícios: os 37, os 165 e o desenho novo

Data: 07/11/2026 · Branch de trabalho: `arena/4ba57c36-forja` · Nada foi commitado,
enviado ou mesclado: a validação é toda no diretório de trabalho, aguardando a sua
autorização.

---

## Resposta curta

A tela nunca "perdeu" 128 exercícios. O que havia era **código antigo na branch**:
a Biblioteca desta branch era a de antes do catálogo central, alimentada por uma
lista de 37 exercícios escrita dentro do próprio app (`EXERCISE_LIBRARY`). Os 165
exercícios estão, inteiros, no arquivo de dados que a `main` trouxe depois
(`assets/js/forja-exercicios-dados.js`). O número 37 do relatório anterior era real
— mas era o tamanho da **lista antiga**, não o do catálogo.

O que foi feito: sincronizei o diretório de trabalho com a `main` mais recente e
reimplementei o desenho aprovado **em cima do catálogo de 165**, sem tocar em
classificações, ids, modalidades ou rankings. Os sete cards passaram a ser as portas
de entrada dos 13 grupos oficiais, e a conta fecha: **15 + 13 + 24 + 33 + 27 + 40 +
13 = 165**.

---

## 1. Por que a tela mostrava 37 exercícios?

Porque, nesta branch, a Biblioteca lia uma lista local. Evidências:

| O que | Onde | Quantos |
| --- | --- | --- |
| Lista antiga usada pela tela na branch | `assets/js/forja-biblioteca.js` → `EXERCISE_LIBRARY` | **37** (18 calistenia + 19 musculação) |
| Catálogo central (só existe na `main`) | `assets/js/forja-exercicios-dados.js` + `assets/js/forja-catalogo-central.js` | **165** |

A branch estava em `0f24e7d` (PR #49). Os arquivos do catálogo central, a tela
nova da biblioteca (`forja-biblioteca-visual.js`) e os 165 registros chegaram à
`main` no PR #59 (`dbd3630`) — depois do ponto em que a branch nasceu. Ou seja: a
tela "de 37" não era um recorte do catálogo; era outra implementação, com outra
fonte de dados. Nada no catálogo central foi apagado ou reduzido.

## 2. Os outros 128 exercícios continuam no projeto?

Sim — todos. Rodando o próprio validador do projeto (`node tools/relatorio-catalogo.mjs`)
no código da `main` com o desenho novo:

```
FORJA — Catálogo central v1
Validação: OK
Total: 165 exercícios

Por músculo principal:
- Bíceps: 10            - Tríceps: 12        - Peitoral: 15
- Costas: 13            - Ombros: 15         - Trapézio: 9
- Abdômen: 16           - Oblíquos: 11       - Quadríceps: 20
- Posteriores de coxa: 10                    - Glúteos: 13
- Panturrilhas: 10      - Antebraços: 11

Por modalidade:
- Musculação: 80        - Calistenia: 31     - Sem equipamentos: 54

Rankings: 38 combinações; 0 sem posição
Registros editoriais incompletos: 0 · Duplicações de IDs: 0
Sem imagem: 123 · Preparados para YouTube: 165 · Vídeos validados: 0; pendentes: 165
```

## 3. A branch estava na `main` mais recente?

**Não.** Antes da correção:

- `HEAD` = `0f24e7d` (PR #49); `origin/main` = `dbd3630` (PR #59).
- `git rev-list --left-right --count` → **1 à frente, 1 atrás**;
  `git merge-base --is-ancestor HEAD origin/main` → **falso**.

O que foi feito, sem commitar nada:

1. `git checkout origin/main -- .` — todo o app passou a ser o da `main`.
2. Removi do diretório de trabalho os arquivos que **só existiam nesta branch** e
   que a `main` não tem (sistema 3D, `forja-personagens.js`, cenas/animações `.glb`,
   ferramentas de Blender). Não é perda de recurso: a suíte da própria `main`
   (`tests/exercicio-apresentacao.test.mjs`, caso 7) **exige** que esses arquivos
   não existam, e é ela quem falhava enquanto eles estavam aqui.
3. Reimplementei o desenho aprovado em cima da tela da `main`.

Resultado: `git diff --name-only origin/main` hoje lista apenas os arquivos do
redesenho:

```
assets/css/biblioteca-grupos.css      (novo)
assets/js/forja-biblioteca-visual.js  (desenho + 7 cards)
treino/biblioteca.html                (cabeçalho, título, subtítulo, folha nova)
tests/biblioteca-grupos.test.mjs      (novo, 15 testes)
tests/biblioteca-detalhe.test.mjs     (B3, B4, B5 adaptados ao fluxo região → grupo)
tests/forja.test.mjs                  (caso 27 adaptado ao fluxo região → grupo)
tests/e2e.browser.mjs                 (nova verificação em navegador real)
package.json                          (entra na cadeia de `npm test`)
```

## 4. Os sete cards dão acesso a todos os 165?

Dão, e sem sobra nem repetição. O mapa é uma **partição** dos 13 grupos oficiais do
catálogo — cada grupo em exatamente uma região, cada exercício em exatamente uma
região (o filtro é pelo **músculo principal**, nunca por "envolve"):

| Card | Grupos oficiais | Exercícios |
| --- | --- | ---: |
| Peitoral | Peitoral | 15 |
| Costas | Costas | 13 |
| Ombros | Ombros + Trapézio | 24 |
| Braços | Bíceps + Tríceps + Antebraços | 33 |
| Abdômen | Abdômen + Oblíquos | 27 |
| Pernas | Quadríceps + Posteriores de coxa + Panturrilhas | 40 |
| Glúteos | Glúteos | 13 |
| **Total** | **13 grupos** | **165** |

Dentro da região aberta aparecem os grupos oficiais dela como sub-filtros
("Todos / Costas", "Todos / Ombros / Trapézio", …), então dá para chegar ao grupo
exato sem perder a identificação do músculo principal: cada linha da lista carrega
`data-muscle` e o contador é recalculado a cada passo.

O que continua exatamente onde estava: busca por nome (com apelidos), três
modalidades, filtros avançados (equipamento/origem/ranking), fichas de exercício,
demonstrações, atlas anatômico, "Adicionar ao treino" e a barra inferior de cinco
itens com **Explorar** ativa.

## 5. Os rankings continuam valendo para os 165?

Sim. O catálogo tem **38 combinações** de ranking e **nenhum** exercício sem posição.
A aba "Rankings" segue na tela, e cada card de ranking lista posições que existem no
catálogo (nada é inventado): os testes conferem que a posição exibida é a posição
real do registro e que a lista não tem mais exercícios do que o catálogo classificado.

---

## O desenho aplicado (e o que veio de onde)

| Elemento da referência | Como ficou |
| --- | --- |
| Cabeçalho: marca à esquerda, `DISCIPLINA DIÁRIA` com haltere à direita | mantido; o ícone entrou em `treino/biblioteca.html` |
| Traço em lima + título em duas cores | `#catalog-heading` com `<span>` "Biblioteca de " (branco) + "exercícios" (lima); texto inteiro preservado para leitor de tela |
| Subtítulo "Encontre o exercício ideal para o seu treino." | exato, na `bl-subtitle` |
| Busca larga, arredondada, escura, com lupa | `#catalog-search` estilizado como pílula (54 px), placeholder "Buscar exercício pelo nome…" |
| `Modalidade` em pílulas (Todos / Musculação / Calistenia / Sem equip.) | `Todos` é o atalho "sem filtro"; as outras três são as modalidades reais do catálogo |
| 7 cards horizontais com anatomia à esquerda, nome, descrição, chevron, altura única | 96 px de altura, imagem recortada da própria prancha do atlas com o músculo em lima e o resto discreto |
| Painel do contador (verde-escuro, ícone e número em lima) | `#bl-contador`, `aria-live`, número calculado do catálogo e do filtro atual |

Cada card usa a **prancha do atlas** (`F.figura.render`), com recorte próprio
(`viewBox` distinto por região) — nenhuma imagem repetida, nenhum arquivo novo de
imagem, nenhuma classificação alterada. A folha de estilo é nova e escopada
(`assets/css/biblioteca-grupos.css`, tudo sob `body[data-page="biblioteca"]`), para
não alcançar nenhuma outra tela.

## Números reais desta entrega

- Catálogo: **165** exercícios · 13 grupos · 3 modalidades · 38 rankings.
- Regiões: **15 / 13 / 24 / 33 / 27 / 40 / 13** (soma 165); cada exercício em uma só.
- Semana de mídia: 123 exercícios sem imagem aprovada, 25 com demonstração oficial,
  165 vídeos pendentes e 0 validados — a tela mostra o que existe e diz quando não há.
- Contador: sempre calculado (`165 exercícios disponíveis` → `13 exercícios em Costas`
  → `0 exercícios para "…"`), com o total do catálogo como referência quando há filtro.

## Testes

`npm test` (jsdom, páginas reais) — **todas as suítes verdes**:

```
CATÁLOGO CENTRAL 17/17 · YOUTUBE 21/21 · YOUTUBE FRONTEND 8/8 · MÉTRICAS 18/18
FORJA 111/111 · ONBOARDING 21/21 · PLANO · ATLAS 13/13 · PARIDADE 40/40
DEMONSTRAÇÕES 17/17 · VÍDEOS YOUTUBE 14/14 · PROXY YOUTUBE 16/16
BIBLIOTECA E DETALHE 13/13 · BIBLIOTECA (7 REGIÕES) 15/15
```

`npm run test:e2e` (navegador real) — **40/40 verificações**, incluindo a nova
"Biblioteca — 7 regiões cobrem todos os exercícios, filtram e cabem em 390 px":
sete cards com altura idêntica, sete recortes diferentes, contador no total, abertura
de Costas com subgrupos, combinação com modalidade, sem estouro horizontal em 320 e
390 px, e duas colunas no desktop.

Testes novos/ajustados, com o motivo:

- `tests/biblioteca-grupos.test.mjs` (novo, 15 casos): desenho, mapa 7 → 13, a conta
  dos 165, pílulas, subgrupos, contador, combinações, "Limpar tudo", rankings, ficha,
  "Adicionar ao treino", ausência de gravação e escopo do CSS.
- `tests/biblioteca-detalhe.test.mjs` B3/B4/B5: os três casos falavam com os antigos
  chips soltos; agora percorrem a mesma intenção pelo fluxo região → grupo.
- `tests/forja.test.mjs` caso 27: o filtro de grupo passou a viver dentro da região.

## O que não foi feito

- Nada foi commitado, enviado, aberto em PR ou mesclado — como pedido.
- A branch continua existindo como está (mesma `HEAD`); a sincronização com a `main`
  está no diretório de trabalho, pronta para virar commit quando você autorizar.
