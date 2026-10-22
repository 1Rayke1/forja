# FORJA 3.1 — Atlas anatômico e modelo de metadados musculares

Documento de referência do recurso implementado em `explorar/atlas.html`
(módulo `assets/js/forja-atlas.js`, estilo `assets/css/atlas.css`) e da revisão
de metadados feita em `assets/js/forja-catalogo.js`.

O objetivo é duplo: (1) explicar com precisão o que o desenho é e o que ele **não**
é, e (2) descrever o modelo de dados que liga cada exercício do catálogo a
grupos musculares, para que ele possa ser revisado por quem entende de
treinamento sem precisar ler o código.

---

## 1. O que o mapa é — e o que ele não é

O atlas é um **mapa esquemático de grupos musculares**, desenhado à mão em SVG
com formas geométricas (círculo para a cabeça, retângulos arredondados para
tronco, braços e pernas, marcadores numerados por região). Ele serve para
*localizar* uma região do corpo e, a partir dela, listar os exercícios do
catálogo que trabalham aquela região.

O que ele **não** é:

- **não é uma representação anatômica clínica.** Não há músculos individuais
  desenhados, nem fibras, nem inserções, nem origem/inserção, nem planos de
  corte. O manequim é uma silhueta de blocos, de propósito;
- **não é um atlas médico nem material de estudo de anatomia.** Nada aqui deve
  ser usado para localizar dor, diagnosticar lesão ou estudar anatomia formal;
- **não é uma ilustração licenciada de terceiros.** Todo o SVG é autoral, gerado
  no próprio módulo (`figureNode`), sem imagem, fonte ou biblioteca externa.
  Por isso não há atribuição de terceiros a fazer — e por isso também não há
  precisão anatômica de ilustração profissional. A escolha foi explícita:
  melhor um esquema honesto e assumido do que uma silhueta "realista" sem
  fundamento.

O aviso aparece **na própria tela** (`.atlas-disclosure`), não só neste
documento:

> Mapa esquemático de grupos musculares. Não é uma representação anatômica
> clínica: o desenho apenas localiza regiões para ligar cada grupo aos
> exercícios do catálogo.

### Limitações conhecidas do desenho

| Limitação | Consequência prática |
| --- | --- |
| Silhueta genérica, sem variação de biotipo, sexo ou idade | O mapa não representa corpos reais; regiões são aproximadas |
| Marcadores são círculos com número, não contornos musculares | A área destacada não corresponde ao tamanho real do músculo |
| Vista anterior e posterior apenas; sem vistas laterais, mediais ou cortes | Alguns grupos (ex.: oblíquos, glúteo médio) aparecem de forma resumida |
| Grupos são agrupamentos funcionais, não músculos isolados | "Dorsais" agrupa grande dorsal e adjacentes; "Peitoral" não separa porções clavicular/esternal |
| Nenhuma informação de função, amplitude ou biomecânica é exibida | O atlas não ensina execução — isso fica nas instruções do exercício |
| Regiões amplas (`kind: "region"`) existem por causa do catálogo | "Pernas", "costas", "ombros" e "quadril" aparecem como região, não como músculo |

---

## 2. Regiões do mapa

Cada região tem: `id` (chave interna estável), `number` (o número exibido na
vista), `view` (`front`/`back`), `kind` (`group` = grupo muscular;
`region` = região ampla), `label` (nome em português), `tags` (nomes aceitos
pelo catálogo), `aliases` (sinônimos aceitos em exercícios personalizados),
`x`/`y`/`r` (posição e raio do marcador) e `where` (descrição curta exibida no
painel de seleção).

| Nº | Região | Vista | Tipo | Exercícios ligados |
| --- | --- | --- | --- | --- |
| 1 | Ombros (deltoides) | Anterior | Região | 13 |
| 2 | Peitoral | Anterior | Grupo | 4 |
| 3 | Bíceps braquial | Anterior | Grupo | 4 |
| 4 | Antebraços | Anterior | Grupo | 3 |
| 5 | Abdômen (reto abdominal) | Anterior | Grupo | 23 |
| 6 | Oblíquos | Anterior | Grupo | 1 |
| 7 | Flexores do quadril | Anterior | Região | 5 |
| 8 | Quadríceps | Anterior | Grupo | 5 |
| 9 | Membros inferiores (região geral) | Anterior | Região | 5 |
| 1 | Costas (região superior) | Posterior | Região | 2 |
| 2 | Dorsais (grande dorsal) | Posterior | Grupo | 5 |
| 3 | Tríceps braquial | Posterior | Grupo | 5 |
| 4 | Lombar | Posterior | Região | 6 |
| 5 | Glúteos | Posterior | Grupo | 8 |
| 6 | Posterior de coxa | Posterior | Grupo | 3 |
| 7 | Panturrilha | Posterior | Grupo | 0 |

Contagens calculadas a partir do catálogo atual (`F.atlas.exercisesFor`), não
digitadas à mão. **Panturrilha está no mapa com zero exercícios** porque o
catálogo revisado não tem nenhum movimento classificado para ela: o estado vazio
honesto é preferível a classificar, por exemplo, o agachamento como exercício de
panturrilha.

Comparação é feita **sem acentos e sem caixa** (`forja-catalogo.js`
`normalizeText`), então "Bíceps", "biceps" e "BICEPS" são o mesmo grupo.

---

## 3. Modelo de metadados musculares

### 3.1 Estrutura

O catálogo passa a declarar, para cada exercício sugerido, um objeto `roles`:

```js
"cal-flexao": {
  category: "push",
  roles: {
    primary: ["peito"],                     // produz a maior parte do movimento
    secondary: ["tríceps", "ombros"],       // participa de forma relevante
    stabilizers: ["abdômen"]                // estabiliza/transmite força
  },
  equipment: ["peso corporal"],
  instructions: "Corpo em prancha, cotovelos a cerca de 45° do tronco…"
}
```

Regras aplicadas no código (`normalizeRoles`, em `forja-catalogo.js`):

1. **A ordem é sempre principal → secundário → estabilizador.** O mesmo grupo
   não pode aparecer em dois níveis; se aparecer, vale o nível mais alto.
2. **O campo é opcional por nível.** `secondary` e `stabilizers` só existem
   quando a participação é clara. Ausência significa "não classificado", não
   "não participa".
3. **No máximo dois grupos principais.** Um movimento tem um motor principal;
   dois é o limite aceito para movimentos compostos (ex.: levantamento terra).
4. **Nem todo músculo envolvido é principal.** A lista plana `muscles` do
   catálogo — a mesma que a busca e os filtros da biblioteca usam — é
   **derivada** de `roles`, nunca digitada em paralelo:

   ```js
   musclesFromRoles({ primary: ["peito"], secondary: ["tríceps","ombros"], stabilizers: ["abdômen"] })
   // → ["peito", "tríceps", "ombros", "abdômen"]
   ```

   O teste `ATLAS 5` falha se alguém editar `muscles` e esquecer `roles`.
5. **A fonte de verdade é o catálogo.** O atlas não tem metadata própria: ele
   lê `F.catalog.items()` e chama `F.atlas.roleFor(record, groupId)`.

### 3.2 Exercícios personalizados

Um exercício criado pelo usuário (`forja-treino-biblioteca-v1`) **não é
obrigado** a ter metadados. O comportamento é:

| Situação do item personalizado | No atlas |
| --- | --- |
| Sem `muscles` e sem `roles` | Não aparece em nenhuma região; continua normal na biblioteca |
| Com `muscles` digitados (ex.: "peito") | Aparece na região correspondente com o selo **"Informado por você"** — sem alegar principal/secundário/estabilizador |
| Fora do mapa (ex.: "pescoço") | Não aparece em nenhuma região; permanece na biblioteca e na busca |

Nenhuma classificação é inferida por nome de exercício, categoria ou
equipamento. O teste `ATLAS 8` cobre os três casos.

### 3.3 Persistência

Nada muda no armazenamento: **nenhuma chave existente foi criada, renomeada ou
alterada** e o atlas não escreve nada. Os metadados são conteúdo do app (como os
nomes dos exercícios), vivem no código e entram no backup exatamente como já
entravam. Um exercício copiado do catálogo para uma rotina continua guardando
`libraryId` e `instructions`; a classificação muscular **não** é copiada para a
rotina, então revisar o catálogo no futuro não reescreve rotinas salvas.

---

## 4. Revisão dos metadados do catálogo

Escopo da revisão: consistência de nomes de grupos, coerência de categoria e
equipamento, instruções compreensíveis em português e correção de erros de
digitação. **Não houve reescrita indiscriminada**: nomes de exercícios, séries,
repetições, duração e descanso foram preservados (a suíte `forja.test.mjs`
compara contagens e conteúdos).

### 4.1 Erros corrigidos

| Item | Antes | Depois | Motivo |
| --- | --- | --- | --- |
| Corrida estacionária | "**Sirve** para elevar a frequência cardíaca" | "**Serve** para elevar…" | erro de digitação (espanhol) |
| Prancha lateral | músculo `"obligos"` | `"oblíquos"` | grafia correta; sem isso o grupo não existiria no mapa |
| Desenvolvimento com halteres | "empurre para cima sem **estocar** o cotovelo" | "sem **estender totalmente** o cotovelo" | termo sem sentido na frase |
| Leg press 45° | "Não **tranque** os joelhos no fim" | "Não **trave** os joelhos no fim" | erro de digitação |
| Mesa flexora | "volte **sem soltar o impulso**" | "volte devagar, **sem usar impulso**" | instrução ambígua/contraditória |
| Abdominal infra | "se **doer** as costas" | "se **sentir dor** nas costas" | concordância |
| Levantamento terra | principal: posterior de coxa, glúteos e lombar | principal: **glúteos**; secundários: posterior de coxa e lombar; estabilizadores: abdômen e dorsais | três grupos principais não é classificação útil |
| Elevação de pernas na barra | equipamento "barra fixa", categoria core, sem papéis | idem + papéis explícitos (abdômen principal) | integração com o atlas |

Também foram normalizados nomes de grupo que estavam em variações diferentes
("bíceps"/"biceps", "tríceps"/"triceps", "abdômen"/"abdomen") para a forma
acentuada usada em todo o catálogo.

### 4.2 Classificação completa (fonte: catálogo)

| Exercício | Modalidade | Principal | Secundários | Estabilizadores |
| --- | --- | --- | --- | --- |
| Rotação de ombros | Calistenia | ombros | — | — |
| Mobilidade de quadril | Calistenia | quadril | glúteos | — |
| Polichinelo | Calistenia | pernas | ombros | — |
| Flexão de braço | Calistenia | peito | tríceps, ombros | abdômen |
| Agachamento livre | Calistenia | quadríceps | glúteos | abdômen |
| Barra fixa (pegada pronada) | Calistenia | dorsais | bíceps | abdômen |
| Remada invertida | Calistenia | dorsais | costas | abdômen |
| Paralela (mergulho) | Calistenia | tríceps | peito, ombros | abdômen |
| Afundo alternado | Calistenia | quadríceps | glúteos | abdômen |
| Ponte de glúteo | Calistenia | glúteos | posterior de coxa | abdômen |
| Prancha frontal | Calistenia | abdômen | lombar | ombros, glúteos |
| Prancha lateral | Calistenia | oblíquos | abdômen | ombros |
| Abdominal supra | Calistenia | abdômen | — | — |
| Elevação de pernas | Calistenia | abdômen | quadril | lombar |
| Abdominal infra | Calistenia | abdômen | quadril | — |
| Burpee | Calistenia | pernas | peito | abdômen |
| Mountain climber | Calistenia | abdômen | quadril | ombros |
| Corrida estacionária | Calistenia | pernas | — | — |
| Esteira em ritmo leve | Musculação | pernas | — | — |
| Mobilidade de ombro com elástico | Musculação | ombros | — | — |
| Supino reto com barra | Musculação | peito | tríceps, ombros | abdômen |
| Agachamento livre com barra | Musculação | quadríceps | glúteos | abdômen, lombar |
| Levantamento terra | Musculação | glúteos | posterior de coxa, lombar | abdômen, dorsais |
| Puxada frontal | Musculação | dorsais | bíceps | abdômen |
| Desenvolvimento com halteres | Musculação | ombros | tríceps | abdômen |
| Remada curvada com barra | Musculação | dorsais | costas, bíceps | lombar |
| Leg press 45° | Musculação | quadríceps | glúteos | — |
| Rosca direta | Musculação | bíceps | antebraços | — |
| Tríceps na polia | Musculação | tríceps | — | — |
| Cadeira extensora | Musculação | quadríceps | — | — |
| Mesa flexora | Musculação | posterior de coxa | — | — |
| Elevação lateral | Musculação | ombros | — | — |
| Abdominal na polia | Musculação | abdômen | — | — |
| Prancha frontal (musculação) | Musculação | abdômen | lombar | ombros |
| Elevação de pernas na barra | Musculação | abdômen | quadril | antebraços |
| Bicicleta ergométrica | Musculação | pernas | — | — |
| Farmer walk | Musculação | antebraços | ombros | abdômen |

Observações de revisão que valem registro:

- exercícios de **condicionamento e mobilidade** (polichinelo, burpee, esteira,
  bike, rotações) são classificados pela **região geral** que domina o esforço,
  não por um músculo específico;
- **"quadril"** é usado como região (flexores do quadril) e não como músculo —
  o catálogo nunca afirma "iliopsoas";
- onde havia dúvida razoável, o campo ficou vazio. Isso é intencional e está
  coberto pelos testes (nenhum exercício tem mais de dois principais);
- as instruções descrevem execução e ajustes de amplitude/carga, **sem prometer
  resultado** e sem prescrição universal ("para reduzir dificuldade, apoie os
  joelhos", "amplitude conforme o ombro permitir").

### 4.3 Como revisar isso no futuro

1. Altere `roles` em `SUGGESTED_META` (`assets/js/forja-catalogo.js`). Não edite
   `muscles` de exercício sugerido — ele é derivado.
2. Se o grupo não existir no mapa, adicione-o em `GROUP_DEFS`
   (`assets/js/forja-atlas.js`) com `view`, `kind`, `tags` e `where`; o teste
   `ATLAS 5` acusa grupo desconhecido no catálogo.
3. Rode `npm test`. O teste `ATLAS 5` valida níveis, unicidade e cobertura.
4. Se a mudança for de classificação (não de redação), atualize a tabela 4.2
   deste documento no mesmo commit.

---

## 5. Requisitos → testes

| Requisito (FORJA 3.1) | Onde é verificado |
| --- | --- |
| Página própria acessível pelo destino Explorar | `ATLAS 1` (jsdom), `ATLAS 1` valida `href="atlas.html"` no hub; E2E "Atlas: …" |
| Visual Dark Performance e mobile-first desde 320 px | `ATLAS 11` (CSS/media queries), capturas reais em 320/360/390/430/768/1280, E2E "Sem rolagem horizontal…" |
| Vistas anterior e posterior com alternância clara | `ATLAS 3` (jsdom) e E2E "Atlas: …" (9 → 7 regiões) |
| Regiões selecionáveis com nomes em português | `ATLAS 1` (rótulos) e `ATLAS 2` |
| Destaque visual da região selecionada | `ATLAS 2` (`is-selected`, `aria-pressed`) e `ATLAS 11` (CSS) |
| Identificação sem depender só de cor | `ATLAS 1` (número visível + rótulo acessível), `ATLAS 2` (texto "selecionado" na legenda) |
| Botão para limpar a seleção | `ATLAS 2` |
| Estados de carregamento, vazio e erro acessíveis | `ATLAS 6` (vazio), `ATLAS 9` (`role="alert"`, retentativa), `ATLAS 11` (região `role="status"` de carregamento) |
| Navegação por teclado e foco visível | `ATLAS 3` (Enter e setas), `ATLAS 11` (`:focus-visible`) |
| `prefers-reduced-motion` | `ATLAS 11` |
| Nome + modalidade do exercício na lista | `ATLAS 4` |
| Principal, secundários e estabilizadores quando houver dados | `ATLAS 4` e `ATLAS 5` |
| Abrir o detalhe na biblioteca | `ATLAS 7` (jsdom, link real → modal) e E2E |
| Filtrar por calistenia/musculação | `ATLAS 4` |
| Mensagem honesta quando não há exercícios | `ATLAS 6` e `ATLAS 4` (vazio por filtro ≠ vazio por região) |
| Modelo explícito de principais/secundários/estabilizadores | `ATLAS 5` (máx. 2 principais, sem repetição de nível, grupos existentes) |
| Exercício personalizado sem metadados | `ATLAS 8` |
| Nomes de grupo consistentes / sem promessa de resultado | `ATLAS 5` + revisão da seção 4 |
| Preservação de chaves e fluxos de armazenamento | `ATLAS 10` (comparação byte a byte do storage antes/depois) |
| Sem `localStorage.clear()`, sem telemetria, sem dependência nova | `ATLAS 10` + `forja.test.mjs` teste 23 |
| Ausência de erros de JavaScript | `assertNoErrors` em todos os testes jsdom + E2E "Nenhum erro de JavaScript…" |
| Barra inferior com cinco destinos preservada | `ATLAS 1`, `forja.test.mjs` 43 e 44 |

---

## 6. Como validar

```bash
npm install
npm test                 # métricas + integração + atlas + paridade
npm run test:e2e         # navegador real (Chromium via puppeteer-core)
node tools/capturas-atlas.mjs
```

`npm test` inclui `node tests/atlas.test.mjs` (11 verificações).
`tools/capturas-atlas.mjs` gera as imagens em `artifacts/forja-visual/`
(`atlas-inicial-390.png`, `atlas-320.png`…`atlas-1280.png`,
`atlas-posterior-390.png`, `atlas-vazio-390.png`, `atlas-filtro-vazio-390.png`,
`atlas-erro-390.png`, `atlas-selecionado-1280.png`) e imprime a medição de
rolagem horizontal por largura em cada estado.

Se o Chromium empacotado não iniciar por falta de bibliotecas do sistema
(`libnss3`/`libnspr4`), extraia as bibliotecas de
`node_modules/@sparticuz/chromium/bin/al2023.tar.br` e aponte o
`LD_LIBRARY_PATH`:

```bash
node -e "const fs=require('fs'),z=require('zlib');fs.writeFileSync('/tmp/al2023.tar',z.brotliDecompressSync(fs.readFileSync('node_modules/@sparticuz/chromium/bin/al2023.tar.br')))"
mkdir -p /tmp/libs && tar -xf /tmp/al2023.tar -C /tmp/libs
LD_LIBRARY_PATH=/tmp/libs/lib npm run test:e2e
```

### Roteiro manual (o mesmo que os testes automatizam)

1. Abrir `explorar/` e tocar em **Atlas muscular**.
2. Tocar no marcador 2 (Peitoral): painel mostra nome, região, contagem e lista.
3. Alternar **Vista posterior**: a seleção é limpa e a legenda muda para 7 itens.
4. Selecionar **Panturrilha**: mensagem de "nenhum exercício para esta região".
5. Selecionar **Antebraços** e filtrar **Calistenia**: mensagem de vazio por
   filtro, com botão para voltar a todas as modalidades.
6. Em qualquer exercício, **Detalhes na biblioteca**: abre o detalhe daquele
   exercício (o mesmo modal do botão "Detalhes" da biblioteca).
7. Percorrer o mapa só com Tab e setas; conferir o anel de foco em cada região.
8. Ativar redução de movimento no sistema e confirmar que nada anima.

---

## 7. O que ficou de fora (limitações do pacote 3.1)

- **Precisão anatômica ilustrada.** O mapa é esquemático por decisão; um desenho
  anatômico detalhado exige ilustrador ou licença verificável, e continua como
  próximo passo de produto (ver `docs/forja-2.0-refresh.md`, §5).
- **Revisão por profissional de educação física.** A classificação
  principal/secundário/estabilizador foi feita com base no movimento descrito e
  segue as regras da seção 3, mas não passou por revisão formal de um
  profissional. A estrutura `roles` existe exatamente para permitir essa revisão
  sem tocar em código de tela.
- **Regiões sem exercícios.** Panturrilha aparece no mapa sem nenhum exercício
  associado; oblíquos tem apenas um. A correção disso é aumentar o catálogo, não
  reclassificar exercícios existentes.
- **Vistas laterais e subdivisões musculares** (porções do peitoral e do
  deltoide, glúteo médio, adutores) não existem nesta versão.
- **Busca por grupo no atlas** não foi adicionada: a biblioteca já tem filtro por
  grupo muscular e busca textual; o atlas trabalha por seleção no mapa.
