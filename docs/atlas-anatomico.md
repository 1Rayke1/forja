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

O atlas combina uma **base anatômica humana 3D pré-renderizada** (vistas
**anterior** e **posterior** exatamente na mesma escala ortográfica) com
**contornos vetoriais projetados das 16 regiões musculares** do catálogo. A
pergunta que ele responde continua prática e direta: *"quais regiões este
exercício trabalha, e com que papel?"*. As regiões ativas são destacadas de
forma discreta sobre o relevo muscular real, com uma cor por papel, e
explicadas por uma legenda curta sem poluir o corpo com dezenas de rótulos.

O que ele **é**:

- **baseado nas pranchas anatômicas detalhadas de referência:** as pranchas
  `assets/anatomia/anterior.png` (`77.309 bytes` / `75,5 KiB`) e
  `assets/anatomia/posterior.png` (`68.084 bytes` / `66,5 KiB`), em
  `480 × 480 px` (`2×` Retina sobre `viewBox="0 0 240 240"`), e os contornos
  vetoriais em curvas de Bézier cúbicas fechadas dentro de
  `assets/js/forja-figura.js` são gerados em `tools/gerar-anatomia-referencia.mjs`
  a partir das duas imagens de referência anexadas pelo usuário (com acervo 3D
  complementar **BodyParts3D / Anatomography** e **Z-Anatomy**, **CC BY-SA 4.0**,
  preservado em `tools/gerar-anatomia-3d.mjs` e documentado em
  `assets/anatomia/NOTICE.md`);
- **transparente quanto ao enquadramento e licença:** as pranchas de referência
  abrangem da cabeça até a metade da coxa; as 15 regiões visíveis no quadro
  possuem contornos SVG exatos sobre as fibras musculares, enquanto a região
  `panturrilha` (abaixo do joelho) é marcada com `outsideFrame: true` e exibe
  aviso explícito sem pintar regiões aleatórias na coxa. A confirmação de
  licença/origem antes de versão pública está registrada em
  `assets/anatomia/NOTICE.md`;
- **leve e estático em tempo de execução:** o navegador transfere `142,0 KiB`
  de PNGs indexados locais (`anterior.png` + `posterior.png`) + o módulo
  `forja-figura.js`, com semântica SVG nativa (`role="img"`, texto alternativo
  por vista e navegação por teclado quando interativo).

O que ele **não** é:

- **não é uma representação anatômica clínica para diagnóstico.** Apesar de a
  geometria base vir de modelos anatômicos reais, os destaques agrupam músculos
  em **16 regiões funcionais de treino**; nada aqui deve ser usado para
  diagnosticar dor, lesão ou substituir avaliação profissional;
- **não usa marcadores numerados nem linhas de chamada sobre o corpo.** Não há
  círculos numerados nem dezenas de legendas encobrindo a figura: a leitura vem
  da própria região destacada em `mix-blend-mode: screen` + legenda enxuta.

O aviso e o crédito aparecem **na própria tela** (`.atlas-disclosure`), além de
`assets/anatomia/NOTICE.md`:

> Figura esquemática de regiões musculares sobre base anatômica 3D
> (BodyParts3D / Z-Anatomy, CC BY-SA 4.0) — não é uma representação anatômica
> clínica. As cores indicam o papel da região no movimento, a partir da
> classificação do catálogo.

### 1.1 Como a figura e os destaques são construídos

- As malhas 3D dos sistemas muscular (`kas.glb`), esquelético (`iskelet.glb`),
  articular (`eklem.glb`) e do envelope craniofacial externo (`FMA7163`) são
  enquadradas por câmera ortográfica simétrica nas vistas **anterior** e
  **posterior**, garantindo **mesma escala, mesma pose e proporções humanas
  reais**;
- para cada uma das 16 regiões do catálogo, o gerador offline renderiza uma
  máscara binária com **oclusão real de profundidade** no buffer WebGL sobre os
  músculos correspondentes da *Terminologia Anatomica* (TA2) e extrai curvas de
  Bézier cúbicas fechadas (*Marching Squares* orientado + simplificação RDP +
  Catmull-Rom fechado);
- no navegador, `assets/js/forja-figura.js` compõe a silhueta base, a prancha
  local `<image class="figura-plate">` e a camada `<g class="figura-regions">`
  recortadas pelo mesmo `clipPath` da silhueta, preservando o relevo 3D sob o
  destaque translúcido.

### 1.2 Cores e papéis

| Papel | Cor | Significado |
| --- | --- | --- |
| Principal | verde-lima (`#B7F34A`) | produz a maior parte do movimento |
| Secundária | âmbar (`#F2B84B`) | participa de forma relevante |
| Estabilizadora | azul-acinzentado (`#8CC0E0`, tracejado) | estabiliza ou transmite força |
| Informada por você | contorno tracejado cinza | exercício personalizado sem papéis declarados |
| Grupo em foco | contorno lima tracejado | exploração por grupo muscular |

Cor **nunca é a única informação**: cada item da legenda traz o nome do papel
escrito ("Principal", "Secundária", "Estabilizadora"), o texto alternativo do
SVG lista as regiões por papel naquela vista, e o resumo em texto repete a
classificação. As regiões de papel menor são desenhadas primeiro, para não
cobrirem a principal.

### Limitações conhecidas da figura e do mapeamento

| Limitação | Consequência prática |
| --- | --- |
| Biotipo único de referência (adulto masculino ~1,70 m do conjunto RM BodyParts3D) | Não reflete variações individuais de sexo, estatura, proporção óssea ou percentual de gordura |
| 16 regiões funcionais de treino, não dissecação músculo a músculo na UI | "Peitoral" une as cabeças clavicular, esternocostal e abdominal do peitoral maior; "Costas" reúne trapézio, romboides, infraespinal, redondo menor e levantador da escápula |
| Vista anterior e posterior ortográficas apenas (sem vistas laterais ou cortes profundos) | Músculos profundos (ex.: iliopsoas, quadrado lombar, glúteo mínimo, braquial) aparecem apenas na fração não ocluída ou integrados ao contorno regional |
| Aponeuroses largas recortadas para priorizar o ventre contrátil | A aponeurose medial do oblíquo externo sobre o reto abdominal e o losango aponeurótico lombossacral do grande dorsal são recortados para não confundir `obliquos`/`abdomem` nem `dorsais`/`lombar` |
| Pranchas derivadas sob licença CC BY-SA 4.0 | Qualquer redistribuição ou adaptação de `assets/anatomia/*.png` deve preservar os créditos e a licença indicados em `assets/anatomia/NOTICE.md` |
| Nenhuma informação de amplitude articular ou execução na figura | A técnica do movimento permanece descrita nas instruções textuais de cada exercício |

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
