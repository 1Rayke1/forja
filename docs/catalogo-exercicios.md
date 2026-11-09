# FORJA — Catálogo central de exercícios

## Escopo e arquitetura

A fonte oficial é `assets/js/forja-exercicios-dados.js`, validada por
`assets/js/forja-catalogo-central.js`. O catálogo não acessa DOM, rede ou
`localStorage`. Cada exercício tem um ID autoral e permanente, um único músculo
principal, uma modalidade, metadados técnicos, padrões de treino e mídia.

`assets/js/forja-biblioteca.js` é somente um adaptador: materializa o formato
antigo para biblioteca, atlas, planejamento, editor, sessões e demonstrações.
Os exercícios personalizados continuam na chave antiga e não entram no catálogo
oficial automaticamente.

### Modalidades e compatibilidade

| Catálogo | Regra | Formato antigo |
| --- | --- | --- |
| `academia` | Máquinas, pesos livres, cabos ou acessórios de musculação | `weights` |
| `calistenia` | Peso corporal com barra, paralelas, argolas ou estrutura | `calisthenics` |
| `peso-corporal` | Somente corpo e espaço; `equipment: []` obrigatório | `calisthenics` |

O mapeamento para o formato antigo não altera a modalidade central nem mistura
os filtros futuros. Barra fixa é Calistenia, nunca Peso corporal.

## Critérios editoriais de ranking — versão 1

Toda posição atual é identificada como `type: "editorial"`. Não representa
resultado científico, percentual de ativação ou superioridade absoluta.

A ordenação considera, de forma qualitativa:

1. participação do músculo principal no movimento;
2. eficiência biomecânica e estabilidade da execução;
3. possibilidade de progressão de carga, amplitude ou complexidade;
4. facilidade de controle técnico;
5. adequação à modalidade e aos equipamentos disponíveis.

O ranking é independente para cada `primaryMuscle + modality`. O validador exige
posições sequenciais a partir de 1, sem duplicação ou lacunas. Combinações sem
exercícios conhecidos adequados não recebem posições artificiais. Nesta versão,
não há registro de Glúteos/Calistenia porque os movimentos desse grupo que exigem
estrutura ainda não foram considerados distintos ou apropriados o suficiente para
cadastro; os exercícios de glúteos sem estrutura estão em Peso corporal.

## Modelo de registro

Cada item contém:

- `id`, `name`, `aliases`, `description`;
- `primaryMuscle`, `secondaryMuscles`, `stabilizers`;
- `modality`, `equipment`, `difficulty`, `exerciseType`, `movementPattern`;
- `instructions`, `technique`, `cautions`;
- `ranking: { position, type: "editorial", criteriaVersion: "1" }`;
- `defaults: { type, sets, reps, duration, rest }`;
- `media.image: { src, status }`;
- `media.youtube: { status, videoId, durationSeconds, validatedAt,
  editorialReview }`.

Estados de mídia: `pending`, `validated`, `rejected`, `unavailable`. Um vídeo
validado exigirá ID de 11 caracteres, duração de 1–60 segundos, data e revisão
editorial. A fonte editorial continua sem IDs; as associações administrativas
são uma camada separada e persistente, documentada em
`docs/youtube-exercicios.md`. Sem associações externas, todos permanecem
pendentes.

## Relatório da versão 1

Gerado e conferido com `node tools/relatorio-catalogo.mjs`.

**Total: 165 exercícios únicos.**

### Por músculo principal

| Grupo | Quantidade |
| --- | ---: |
| Bíceps | 10 |
| Tríceps | 12 |
| Peitoral | 15 |
| Costas | 13 |
| Ombros | 15 |
| Trapézio | 9 |
| Abdômen | 16 |
| Oblíquos | 11 |
| Quadríceps | 20 |
| Posteriores de coxa | 10 |
| Glúteos | 13 |
| Panturrilhas | 10 |
| Antebraços | 11 |

### Por modalidade

| Modalidade | Quantidade |
| --- | ---: |
| Musculação (`academia`) | 80 |
| Calistenia (`calistenia`) | 31 |
| Sem equipamentos (`peso-corporal`) | 54 |

Os IDs (`academia`, `calistenia`, `peso-corporal`) são permanentes; só o nome de
exibição mudou: "Academia" passou a "Musculação" e "Peso corporal" a "Sem
equipamentos", o mesmo rótulo usado na biblioteca, no detalhe e no Atlas.

### Integridade e mídia

- Registros editoriais incompletos: **0**.
- IDs duplicados: **0**.
- Exercícios sem ranking: **0**.
- Combinações com ranking: **38**.
- Exercícios com estrutura preparada para YouTube: **165**.
- Vídeos validados: **0**; pendentes: **165**.
- Exercícios sem imagem local associada: **123**.
- Imagens associadas: **42**; somente imagens já presentes no repositório foram
  referenciadas. A associação pendente continua identificada como tal.

## Compatibilidade de IDs

Os 37 IDs históricos continuam resolvíveis. `mus-prancha` e
`cal-prancha-frontal` representavam o mesmo movimento e foram consolidados no
registro canônico `cal-prancha-frontal`.

```js
legacyIdMap: {
  "mus-prancha": "cal-prancha-frontal"
}
```

Não há migração de armazenamento nesta etapa. O mapa é uma consulta de
compatibilidade para a próxima etapa de migração, não uma reescrita de rotinas,
histórico ou backups.

## Validação e manutenção

```sh
node tools/relatorio-catalogo.mjs          # resumo
node tools/relatorio-catalogo.mjs --json   # relatório estruturado
node tests/catalogo-central.test.mjs       # regras e compatibilidade
```

Ao acrescentar exercícios, informar manualmente ID, ranking e conteúdo completo.
Não gerar IDs pelo nome, reutilizar posições, associar vídeos pendentes ou
classificar exercícios com equipamento como Peso corporal.

## Biblioteca visual (Etapa 4)

A tela `treino/biblioteca.html` lê o catálogo central como fonte única. Duas
peças, com papéis separados:

| Arquivo | Papel |
| --- | --- |
| `assets/js/forja-biblioteca-visual.js` | tela: busca, filtros, cards, rankings e carregamento progressivo |
| `assets/js/forja-catalogo.js` | dados (`F.catalog`) e detalhe compartilhado (`F.catalog.showDetail`), inclusive `addToRoutine` |
| `assets/css/biblioteca.css` | estilos da tela, escopados em `body[data-page="biblioteca"]` |
| `assets/css/system.css` (`.bl-detail-*`) | seções do detalhe, que abrem em mais de uma página |

### Ordem e consulta

Os exercícios do usuário abrem a lista (é o que ele criou e vai procurar
primeiro); depois vêm os sugeridos na ordem já conhecida do app e, por fim, o
resto do catálogo na ordem do próprio catálogo. A ordem só muda quando o filtro
de classificação está ativo (posição crescente) ou quando há busca (alfabética).

| Faceta | Regra |
| --- | --- |
| Busca | nome, aliases, grupo muscular, modalidade, categoria e equipamento, sem acento e sem caixa |
| Grupo muscular | músculo **principal** do registro central |
| Modalidade | `academia`, `calistenia` ou `peso-corporal` — na tela: Musculação, Calistenia e Sem equipamentos |
| Classificação | só existe junto de grupo + modalidade, porque o ranking é de cada combinação |
| Envolvimento | qualquer papel muscular (principal, secundário ou estabilizador) — vem da legenda do atlas |
| Equipamento | equipamentos do registro central |
| Origem | sugeridos do catálogo ou exercícios do usuário |

Exercício personalizado não recebe classificação por suposição: o grupo vem do
que o usuário declarou, a modalidade é a do lugar onde ele criou o item e a
posição no ranking não existe.

### Parâmetros de URL

| Parâmetro | Efeito |
| --- | --- |
| `?musculo=` | envolvimento muscular (legenda do atlas) |
| `?grupo=` | grupo muscular principal |
| `?modalidade=` | `academia`, `calistenia` ou `peso-corporal` |
| `?ranking=` | posição na combinação escolhida |
| `?equipamento=`, `?origem=` | filtros avançados |
| `?exercicio=` | abre o detalhe (aceita ID antigo via `legacyIdMap`) |
| `?busca=`, `?q=` | termo de busca |
| `?visao=rankings` ou `#rankings` | abre a aba de rankings |

### Leitura sem escrita

Abrir, buscar e filtrar a biblioteca não grava nada e não faz requisição de
rede. O selo de vídeo do cartão vem do catálogo oficial local; a associação
aprovada no painel administrativo só é consultada quando o detalhe abre. A
única escrita continua sendo `F.catalog.addToRoutine`, que insere o exercício
em uma rotina existente.

## Explorar é a Biblioteca (Etapa 5)

A aba **Explorar** da barra inferior abre `treino/biblioteca.html` direto: não
existe tela intermediária, botão de desvio nem segunda biblioteca.

| Onde | O que aponta |
| --- | --- |
| `F.ROUTES.explorar` | `treino/biblioteca.html` |
| `F.ROUTES.biblioteca` | `treino/biblioteca.html` (mesma tela) |
| `F.ROUTES.descobrir` | `explorar/index.html` — o antigo hub de descoberta continua vivo como recurso, sem ocupar a aba |
| `explorar/atlas.html` | Atlas anatômico, alcançável pela Biblioteca e pelo hub |

As 14 páginas com barra inferior foram atualizadas no HTML estático **e** o
`markCurrentNav` continua marcando o item pelo `data-page`, então o estado ativo
não depende da ordem de carregamento dos scripts.

### Ordem da tela

1. Cabeçalho: título, descrição curta e os números do catálogo.
2. Busca: "Buscar exercício pelo nome…", filtrando a cada tecla.
3. Três modalidades. Não existe chip "Todas": tocar de novo no chip ativo remove
   o filtro, e "Limpar tudo" zera todos de uma vez.
4. Os 13 grupos musculares, todos visíveis (os chips quebram linha em vez de
   virar faixa deslizante, para nenhum grupo ficar escondido no celular).
5. Classificação, quando o par grupo + modalidade tem ranking.
6. Filtros ativos, cada um removível, com "Limpar tudo".
7. "Mais filtros": equipamento e origem.
8. Lista de cards horizontais e, no fim, os atalhos para Descobrir e Atlas.

### Card

Foto à esquerda; à direita o nome, o grupo muscular principal, a modalidade e a
posição no ranking (insígnia sobre a foto). Duas ações, as mesmas de antes:
**Detalhes** (abre o painel) e **Adicionar** (fluxo de rotina).

### Detalhe, em uma única tela

| Ordem | Bloco | Regra |
| --- | --- | --- |
| 1 | Identificação | nome (título), grupo, modalidade, dificuldade e a **foto do exercício** |
| 2 | Demonstração em vídeo | palco da Etapa 3 (16:9, `youtube-nocookie.com`, `autoplay=0`, `mute=1`, controles, sem Shorts e sem zoom/corte) |
| 3 | Adicionar ao treino | botão que abre o fluxo de rotina já existente (`F.catalog.addToRoutine`) |
| 4 | Atlas anatômico | figura do Atlas com o principal em destaque, secundários e estabilizadores em cores próprias e legenda escrita |
| 5 | Informações complementares | ranking, equipamento, execução, técnica, cuidados, músculos, observações e histórico real |

Sem abas e sem menu escondido. O detalhe só é somente leitura em execução e no
editor, onde o botão de adicionar e o atlas não fazem sentido.

### Imagens

- A foto vem do registro central **pelo ID do exercício**, nunca por semelhança
  de nome.
- No card entra apenas imagem `validated`. Associação `pending` aparece como
  "Imagem em revisão"; ausência de imagem aparece como "Imagem ainda não
  disponível" — nunca a foto de outro movimento.
- No detalhe, a associação pendente é exibida com a ressalva escrita
  ("associação em revisão editorial"), porque ali há espaço para explicar.
- Nenhum arquivo é compartilhado por dois exercícios (`tests/biblioteca-detalhe`
  B6 verifica isso no catálogo inteiro).

### Quando não há vídeo

A mensagem é única em todo o produto: **"Demonstração em vídeo ainda não
disponível para este exercício."** Ela vem de
`FORJA_VIDEOS_DATA.unavailableMessage` / `F.videos` e a foto continua visível no
bloco de identificação (o palco é criado com `reference: false` para não repetir
a mesma ilustração duas vezes).

### Contratos verificados

`tests/forja.test.mjs` (27, 27b, 28, 29, 30, 50, 55, 77h, 80),
`tests/biblioteca-detalhe.test.mjs` (B1–B13), `tests/atlas.test.mjs` (ATLAS 7),
`tests/demonstracoes.test.mjs` (D8) e `tests/e2e.browser.mjs` cobrem a lista de 12
em 12, a busca sem acento e por alias, as três modalidades, os 13 grupos, os
filtros combinados, a foto por identificador, o vídeo do próprio exercício, o
estado sem vídeo, a inserção em rotina, o Atlas do detalhe e a aba Explorar
abrindo a Biblioteca em todas as páginas.
