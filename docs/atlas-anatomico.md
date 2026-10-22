# FORJA 3.1 — Atlas anatômico e modelo de metadados musculares

Documento de referência do recurso implementado em `explorar/atlas.html`
(módulos `assets/js/forja-atlas.js` e `assets/js/forja-figura.js`, estilo
`assets/css/atlas.css`) e da revisão de metadados feita em
`assets/js/forja-catalogo.js`.

O objetivo é duplo: (1) explicar com precisão o que o desenho é e o que ele **não**
é, e (2) descrever o modelo de dados que liga cada exercício do catálogo a
grupos musculares, para que ele possa ser revisado por quem entende de
treinamento sem precisar ler o código.

---

## 1. O que a figura é — e o que ela não é

O atlas é um **esquema de regiões musculares sobre uma silhueta humana
vetorial**. A pergunta que ele responde é prática: *"quais regiões este
exercício trabalha, e com que papel?"*. A figura é desenhada em SVG (sem imagem
externa) com uma silhueta de corpo inteiro — cabeça, pescoço, tórax, cintura,
pelve, braços separados do tronco, mãos, coxas, joelhos, panturrilhas e pés —
nas vistas **anterior** e **posterior**. As regiões trabalhadas são pintadas
sobre o corpo, com uma cor por papel, e explicadas por uma legenda curta.

O que ele **não** é:

- **não é uma representação anatômica clínica.** Os músculos não são desenhados
  individualmente, não há fibras, inserções, origem/inserção nem planos de
  corte. As formas são agrupamentos funcionais pintados sobre a silhueta;
- **não é um atlas médico nem material de estudo de anatomia.** Nada aqui deve
  ser usado para localizar dor, diagnosticar lesão ou estudar anatomia formal;
- **não é uma ilustração licenciada de terceiros.** Todo o SVG é autoral, gerado
  no próprio módulo (`assets/js/forja-figura.js`), sem imagem, fonte, sprite ou
  biblioteca externa. Por isso não há atribuição de terceiros a fazer — e por
  isso também não há precisão de ilustração profissional;
- **não usa marcadores numerados.** A versão anterior do atlas mostrava círculos
  numerados sobre um manequim de blocos; ela foi substituída. Não há números
  espalhados pelo corpo nem círculos sobrepostos: a informação é a própria
  região colorida + a legenda.

O aviso aparece **na própria tela** (`.atlas-disclosure`), não só neste
documento:

> Figura esquemática de regiões musculares — não é uma representação anatômica
> clínica. As cores indicam o papel da região no movimento, a partir da
> classificação do catálogo.

### 1.1 Como a silhueta é construída

- Proporções de referência: cabeça ≈ 1/7,5 da altura, ombros largos, cintura
  marcada, quadril um pouco mais largo que a cintura, coxa que afina até o
  joelho, panturrilha com volume e tornozelo fino.
- Tronco, cabeça e pescoço são **contornos fechados** suavizados (Catmull-Rom →
  Bézier), com o lado direito espelhado.
- Braços, mãos, pernas e pés são **membros** gerados a partir de uma linha média
  com meia-largura em cada ponto (ombro → cotovelo → punho; quadril → joelho →
  tornozelo). O volume é contínuo e as extremidades afinam.
- Cada parte é desenhada com o próprio contorno, na ordem de trás para a frente:
  o braço aparece separado do tronco e as pernas, separadas entre si.
- O preenchimento usa um degradê horizontal (bordas mais claras, centro mais
  escuro) para dar leitura de volume.
- as regiões são formas fechadas suavizadas, **recortadas pela silhueta** com
  `clipPath`, então o destaque acompanha o corpo em vez de flutuar sobre ele.

### 1.2 Cores e papéis

| Papel | Cor | Significado |
| --- | --- | --- |
| Principal | verde-lima (`#B7F34A`) | produz a maior parte do movimento |
| Secundária | âmbar (`#F2B84B`) | participa de forma relevante |
| Estabilizadora | azul-acinzentado (`#7FB3D5`) | estabiliza ou transmite força |
| Informada por você | contorno tracejado cinza | exercício personalizado sem papéis declarados |
| Grupo em foco | contorno lima tracejado | exploração por grupo muscular |

Cor **nunca é a única informação**: cada item da legenda traz o nome do papel
escrito ("Principal", "Secundária", "Estabilizadora"), o texto alternativo do
SVG lista as regiões por papel naquela vista, e o resumo em texto repete a
classificação. As regiões de papel menor são desenhadas primeiro, para não
cobrirem a principal.

### Limitações conhecidas do desenho

| Limitação | Consequência prática |
| --- | --- |
| Silhueta genérica, sem variação de biotipo, sexo, idade ou roupa | A figura não representa corpos reais; regiões são aproximadas |
| Formas são agrupamentos, não contornos musculares exatos | A área pintada não corresponde ao tamanho real do músculo |
| Vista anterior e posterior apenas; sem vistas laterais, mediais ou cortes | Alguns grupos (ex.: oblíquos, glúteo médio) aparecem de forma resumida |
| Grupos são agrupamentos funcionais, não músculos isolados | "Dorsais" agrupa grande dorsal e adjacentes; "Peitoral" não separa porções clavicular/esternal |
| Braços ficam levemente afastados do tronco | É uma pose de leitura (para a separação ser visível), não uma postura de execução |
| Nenhuma informação de função, amplitude ou biomecânica é exibida | O atlas não ensina execução — isso fica nas instruções do exercício |
| Regiões amplas (`kind: "region"`) existem por causa do catálogo | "Pernas", "costas", "ombros" e "quadril" aparecem como região, não como músculo |

---

## 2. Regiões e vistas

Cada região tem: `id` (chave interna estável), `label` (nome em português),
`kind` (`group` = grupo muscular; `region` = região ampla), `tags` (nomes
aceitos pelo catálogo), `aliases` (sinônimos aceitos em exercícios
personalizados) e `where` (descrição curta, exibida na legenda e no painel do
grupo). A vista de cada região é definida pelas formas desenhadas
(`F.figura.regionsInView("front" | "back")`), não por um campo separado.

| Região | Vista | Tipo | Exercícios ligados |
| --- | --- | --- | --- |
| Ombros (deltoides) | Anterior e posterior | Região | 13 |
| Peitoral | Anterior | Grupo | 4 |
| Bíceps braquial | Anterior | Grupo | 4 |
| Antebraços | Anterior e posterior | Grupo | 3 |
| Abdômen (reto abdominal) | Anterior | Grupo | 23 |
| Oblíquos | Anterior | Grupo | 1 |
| Flexores do quadril | Anterior | Região | 5 |
| Quadríceps | Anterior | Grupo | 5 |
| Membros inferiores (região geral) | Anterior e posterior | Região | 5 |
| Costas (região superior) | Posterior | Região | 2 |
| Dorsais (grande dorsal) | Posterior | Grupo | 5 |
| Tríceps braquial | Posterior | Grupo | 5 |
| Lombar | Posterior | Região | 6 |
| Glúteos | Posterior | Grupo | 8 |
| Posterior de coxa | Posterior | Grupo | 3 |
| Panturrilha | Posterior | Grupo | 0 |

Contagens calculadas a partir do catálogo atual (`F.atlas.exercisesFor`), não
digitadas à mão. **Panturrilha está no mapa com zero exercícios** porque o
catálogo revisado não tem nenhum movimento classificado para ela: o estado vazio
honesto é preferível a classificar, por exemplo, o agachamento como exercício de
panturrilha.

Comparação é feita **sem acentos e sem caixa** (`forja-catalogo.js`
`normalizeText`), então "Bíceps", "biceps" e "BICEPS" são o mesmo grupo.

### 2.1 Fluxo da página

A página é centrada no exercício, não em um mapa clicável:

1. **Exercício** — um seletor com os 37 exercícios sugeridos (agrupados por
   modalidade) e seis atalhos para os movimentos mais reconhecíveis. Também
   aceita link direto `?exercicio=cal-flexao`.
2. **Regiões trabalhadas** — a mesma silhueta em duas vistas (anterior e
   posterior), o resumo em texto, a legenda por papel e o link para a
   biblioteca. Sem exercício escolhido, a figura fica neutra e a página mostra a
   chave de cores em vez de inventar um destaque.
3. **Explorar por grupo muscular** — 16 grupos com a contagem de exercícios do
   catálogo; ao escolher um, a figura mostra o grupo em foco e a lista traz os
   exercícios daquele grupo com o papel de cada um, filtráveis por modalidade
   (`?grupo=peito&modalidade=calisthenics` também funciona por link).

Consultar não escreve nada: a página lê o catálogo e o armazenamento local,
nunca grava (ver `ATLAS 10`).

### 2.2 Onde a figura aparece

| Lugar | O que mostra |
| --- | --- |
| `explorar/atlas.html` | duas vistas + legenda completa do exercício escolhido |
| `treino/biblioteca.html` (detalhe do exercício) | duas vistas + legenda curta, dentro do modal que já existia |
| `treino/executar.html` (sessão ativa) | **uma** vista, compacta, do exercício atual, com o botão "Ver músculos trabalhados" |

A mesma função (`F.atlas.figurePair`, `F.atlas.legendNode`,
`F.atlas.attachToExecution`) é usada nos três lugares: não há desenho duplicado.
Na execução, exercício sem classificação muscular simplesmente **não** mostra a
figura — nada é inferido pelo nome.

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
   lê `F.catalog.items()` e chama `F.atlas.highlightsFor(record)`, que devolve
   `{ regiãoId: "primary" | "secondary" | "stabilizer" | "informed" }`.

### 3.2 Exercícios personalizados

Um exercício criado pelo usuário (`forja-treino-biblioteca-v1`) **não é
obrigado** a ter metadados. O comportamento é:

| Situação do item personalizado | No atlas |
| --- | --- |
| Sem `muscles` e sem `roles` | Não aparece em nenhuma região; continua normal na biblioteca |
| Com `muscles` digitados (ex.: "peito") | Aparece na região correspondente com contorno tracejado e o selo **"Informado por você"** — sem alegar principal/secundário/estabilizador |
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

| Requisito | Onde é verificado |
| --- | --- |
| Silhueta humana proporcional, com volume (sem boneco palito) | `ATLAS 3` (11 partes do corpo, contorno em curvas, sem `rect`/`line`, sem `text`/`circle`), capturas em 320–1280 px |
| Vistas anterior e posterior, ambas com a mesma figura | `ATLAS 1` (duas células `data-view`), `ATLAS 3` (mesma contagem de partes) |
| Destaque por região com cores por papel + legenda curta | `ATLAS 2` (peitoral principal, tríceps/ombros secundários, abdômen estabilizador), `ATLAS 11` (CSS das três cores) |
| Sem números no corpo nem círculos sobrepostos | `ATLAS 2` e E2E ("0 `text`/`circle` dentro do SVG") |
| Exemplo exigido: flexão de braço | `ATLAS 2` e `ATLAS 5` (`highlightsFor`) |
| Identificação sem depender só de cor | `ATLAS 2` (papel escrito na legenda + resumo com `aria-live`), `ATLAS 3` (`aria-label` por vista) |
| Teclado, foco visível e `prefers-reduced-motion` | `ATLAS 3` (clique/Enter na figura interativa), `ATLAS 11` (`:focus-visible`, media query) |
| Visualização vinculada ao exercício escolhido | `ATLAS 2` (seletor e atalhos) e `ATLAS 9` (**link direto `?exercicio=`**) |
| Reuso na biblioteca | `ATLAS 7` (link da legenda + figura no modal do detalhe) e E2E |
| Reuso na execução | `ATLAS 11` (bloco `#execution-figure` e botão de detalhes) e E2E "Iniciar rotina…" (figura aparece e some sem metadados) |
| Explorar por grupo com papéis explícitos | `ATLAS 4` (filtro por modalidade) e `ATLAS 5` (contagens e papéis) |
| Mensagem honesta quando não há exercícios | `ATLAS 6` (grupo sem exercícios) e `ATLAS 4` (vazio por filtro ≠ vazio por grupo) |
| Modelo explícito de principais/secundários/estabilizadores | `ATLAS 5` (máx. 2 principais, sem repetição de nível, grupos existentes) |
| Exercício personalizado sem metadados | `ATLAS 8` |
| Estados de carregamento e erro acessíveis | `ATLAS 1` (`role="status"`), `ATLAS 9` (`role="alert"` + retentativa) |
| Responsivo de 320 a 1280 px | `ATLAS 11` (media queries), E2E "Sem rolagem horizontal…", `tools/capturas-atlas.mjs` |
| Preservação de chaves, rotinas e histórico | `ATLAS 10` (comparação byte a byte do storage antes/depois) |
| Sem `localStorage.clear()`, sem telemetria, sem dependência nova | `ATLAS 10` + `forja.test.mjs` 23 |
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
`atlas-erro-390.png`, `atlas-selecionado-1280.png`) e imprime, por largura, a
quantidade de figuras, a largura da figura, o número de destaques e a rolagem
horizontal de cada estado.

As capturas do **modelo antigo** (marcadores numerados) foram preservadas em
`artifacts/forja-visual/antigo/atlas-*-antigo.png` para comparação direta.

Se o Chromium empacotado não iniciar por falta de bibliotecas do sistema
(`libnss3`/`libnspr4`), extraia as bibliotecas de
`node_modules/@sparticuz/chromium/bin/al2023.tar.br` e aponte o
`LD_LIBRARY_PATH`:

```bash
node -e "const fs=require('fs'),z=require('zlib');fs.writeFileSync('/tmp/al2023.tar',z.brotliDecompressSync(fs.readFileSync('node_modules/@sparticuz/chromium/bin/al2023.tar.br')))"
mkdir -p /tmp/libs && tar -xf /tmp/al2023.tar -C /tmp/libs
LD_LIBRARY_PATH=/tmp/libs/lib PUPPETEER_EXECUTABLE_PATH=/tmp/chromium npm run test:e2e
```

### Roteiro manual (o mesmo que os testes automatizam)

1. Abrir `explorar/` e tocar em **Atlas muscular**.
2. Escolher **Flexão de braço** no seletor (ou no atalho): o peitoral fica
   verde, tríceps e ombros em âmbar, abdômen em azul; a legenda repete os papéis
   por extenso.
3. Trocar para **Barra fixa**: os destaques passam para dorsais (posterior) e
   bíceps (anterior).
4. Em **Explorar por grupo**, tocar em **Panturrilha**: mensagem de "nenhum
   exercício para este grupo".
5. Tocar em **Antebraços** e filtrar **Calistenia**: vazio por filtro, com botão
   para voltar a todas as modalidades.
6. Na legenda, tocar na seta de **Peitoral**: abre a biblioteca já filtrada.
   Abrir o exercício: o detalhe mostra a mesma figura.
7. Iniciar uma rotina com exercício do catálogo: a execução mostra a figura
   compacta do exercício atual e o botão **Ver músculos trabalhados**.
8. Percorrer a página só com Tab; conferir o anel de foco. Ativar redução de
   movimento no sistema e confirmar que nada anima.

---

## 7. O que ficou de fora (limitações do pacote 3.1)

- **Precisão anatômica ilustrada.** A silhueta tem volume e proporções
  coerentes, mas é um esquema: não há músculos individualizados, sombreamento
  nem vistas laterais. Um desenho anatômico detalhado exigiria ilustrador ou
  licença verificável e continua como próximo passo de produto (ver
  `docs/forja-2.0-refresh.md`, §5).
- **Revisão por profissional de educação física.** A classificação
  principal/secundário/estabilizador foi feita com base no movimento descrito e
  segue as regras da seção 3, mas não passou por revisão formal de um
  profissional. A estrutura `roles` existe exatamente para permitir essa revisão
  sem tocar em código de tela.
- **Regiões sem exercícios.** Panturrilha aparece na figura sem nenhum exercício
  associado; oblíquos tem apenas um. A correção disso é aumentar o catálogo, não
  reclassificar exercícios existentes.
- **Vistas laterais e subdivisões musculares** (porções do peitoral e do
  deltoide, glúteo médio, adutores) não existem nesta versão.
- **Figura interativa na página do atlas.** O módulo suporta regiões clicáveis
  (`F.figura.render({ interactive: true })`, coberto por `ATLAS 3`), mas o fluxo
  atual prefere o seletor de exercícios e os chips de grupo — duplicar a seleção
  na figura só aumentaria a superfície de erro.
- **Execução com duas vistas.** Para não competir com o registro da série, a
  sessão ativa mostra uma vista; a segunda fica no modal de detalhes.
