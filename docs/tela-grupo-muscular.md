# Tela do grupo muscular (`treino/grupo.html`)

Segunda tela da Biblioteca: aberta quando o usuário escolhe uma **modalidade** e
uma **região**, ela mostra o grupo muscular em destaque, os filtros derivados do
catálogo e os exercícios daquela combinação. Substitui a lista que antes era
despejada abaixo da Biblioteca.

## Contrato de endereço

```
treino/grupo.html?modalidade=<id>&regiao=<id>&grupo=<id>&equipamento=<id>
```

- `modalidade` — `academia`, `calistenia` ou `peso-corporal`. Ausente = todas.
- `regiao` — uma das sete regiões da Biblioteca (`peitoral`, `costas`, `ombros`,
  `bracos`, `abdomen`, `pernas`, `gluteos`).
- `grupo` — um dos 13 grupos oficiais. Regiões de um grupo só resolvem sozinhas;
  regiões com dois ou três grupos oferecem a escolha em pílulas.
- `equipamento` — família de equipamento (`barra`, `halteres`, `maquinas`,
  `polia`, `acessorios`, `calistenia`).

Toda escolha é escrita no endereço com `history.replaceState`: recarregar ou
compartilhar o link mantém exatamente a mesma visão, sem gravar nada no
armazenamento. O botão de voltar devolve à Biblioteca com modalidade e região
preservadas.

## De onde vem cada coisa

| Elemento da tela | Fonte |
| --- | --- |
| Nome e descrição do grupo | `F.exerciseCatalog.groupById` + textos de apresentação da tela |
| Prancha anatômica | `F.biblioteca.figuraAnatomica` com as regiões de `ANATOMIA` (uma vista por grupo) |
| Pílulas de grupo | grupos oficiais da região (`F.biblioteca.categorias`) |
| Pílulas de equipamento | equipamentos reais dos exercícios daquela modalidade + grupo (`F.grupo.familiasDisponiveis`) |
| Lista e contador | `F.biblioteca.entries()` filtrado por modalidade, grupo e família |
| Ficha do exercício | `F.catalog.showDetail` (a ficha já existente: vídeo, atlas, “Adicionar ao treino”) |

Os filtros **nunca** alteram a classificação do catálogo: `record.equipment`
continua sendo a fonte da verdade e as famílias são apenas um agrupamento de
apresentação (`ANILHAS` entra em “Com halteres”, `CORDA` em “Com polia” etc.).
Nenhuma pílula é oferecida se não existir pelo menos um exercício nela — em
“Sem equipamentos” a linha de equipamento nem aparece.

## Prancha anatômica

`ANATOMIA` mapeia cada um dos 13 grupos para uma vista e as regiões do atlas:

| Grupo | Vista | Regiões |
| --- | --- | --- |
| Peitoral | anterior | `peito` |
| Costas | posterior | `dorsais`, `costas`, `lombar` |
| Ombros | anterior | `ombros` |
| Trapézio | posterior | `costas` |
| Bíceps / Tríceps / Antebraços | anterior / posterior / anterior | um lado do corpo (`focoLado`) |
| Abdômen / Oblíquos | anterior | `abdomem` / `obliquos` |
| Quadríceps | anterior | `quadriceps` |
| Posteriores / Glúteos / Panturrilhas | posterior | `posterior-coxa` / `gluteos` / `panturrilha` |

Grupos que aparecem em pares afastados (bíceps, tríceps, antebraços) usam
`focoLado`: o recorte mira o caminho mais à esquerda para virar um detalhe
legível, em vez de abraçar o tronco inteiro.

## Arquivos

- `treino/grupo.html` — estrutura da tela (barra superior, herói, filtros, lista,
  barra inferior de cinco itens).
- `assets/js/forja-grupo.js` — lógica; registrada em `F.pages.grupo`, API em `F.grupo`.
- `assets/css/grupo.css` — folha escopada em `body[data-page="grupo"]`.
- `assets/js/forja-biblioteca-visual.js` — `figuraAnatomica` recebeu a opção
  `focoLado`; os cards de região passaram a ser links.

## Testes

- `tests/grupo-muscular.test.mjs` — 18 casos: as sete regiões, as três
  modalidades, filtros, contador, imagens, ficha, vídeo, atlas, adicionar ao
  treino, voltar e barra inferior.
- `tests/biblioteca-grupos.test.mjs`, `tests/biblioteca-detalhe.test.mjs` e
  `tests/forja.test.mjs` — fluxo da Biblioteca atualizado para região → grupo.
- `tests/e2e.browser.mjs` — verificação em Chromium real, de 320 px ao desktop.

## Limitações conhecidas

- Só 25 dos 165 exercícios têm imagem aprovada. Os demais mostram um estado
  neutro com o aviso “imagem em revisão” — nunca a foto de outro exercício.
- Calistenia não tem exercício de glúteos no catálogo atual: a tela avisa em vez
  de inventar resultado.
