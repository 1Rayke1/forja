# Modelo anatômico — prancha, máscaras e regiões

Documento técnico do modelo anatômico do FORJA. Para a decisão de produto e a
integração na tela do Atlas, ver `docs/atlas-anatomico.md`. Para origem,
licença e limitações de uso da imagem, ver `assets/anatomia/NOTICE.md`.

> **Procedência:** a prancha é **conteúdo gerado por IA** — o arquivo carrega um
> manifesto C2PA da OpenAI (`trainedAlgorithmicMedia`), verificável com
> `python3 tools/verificar-procedencia.py`. Isso não concede licença de uso: a
> autorização de redistribuição continua pendente (`NOTICE.md` §2).

## 1. Princípio

A anatomia exibida é **a imagem oficial fornecida pelo usuário**, sem redesenho:

- um único arquivo, `assets/anatomia/fontes/forja-modelo-anatomico.png`
  (1536 × 1024, RGBA, fundo transparente, vistas anterior e posterior lado a
  lado);
- nenhum corpo vetorial, silhueta de boneco ou músculo desenhado por código;
- nenhuma cor aplicada à prancha: a escala de cinza, o contorno verde discreto
  e o short preto com o símbolo do FORJA permanecem como no original.

A prancha de linhas brancas sobre fundo preto usada na revisão anterior
(`fontes/referencia-muscular.png`) foi substituída por esta e não é exibida em
nenhuma tela.

Sobre essa prancha existe uma **camada de interação independente**: caminhos
SVG com as regiões do catálogo. Essa camada não cria anatomia — ela indica
onde cada região já visível fica.

## 2. Um arquivo, duas vistas

As duas vistas são janelas do mesmo arquivo, não duas imagens:

| Vista | Janela na prancha | Canvas da figura |
| --- | --- | --- |
| Anterior | `x = 239`, `y = -3`, 460 × 1024 | `viewBox="0 0 460 1024"` |
| Posterior | `x = 842`, `y = -3`, 460 × 1024 | `viewBox="0 0 460 1024"` |

O `<image>` da prancha é posicionado em `x = -crop.x` e `y = -crop.y`; a viewBox
recicla o resto. Como as duas janelas têm exatamente o mesmo tamanho e a mesma
escala, as vistas aparecem **do mesmo tamanho e alinhadas**, inclusive quando o
layout muda de largura. Os recortes estão em `assets/anatomia/manifest.json` e
em `Forja.figura.CROPS`, e um teste compara os dois.

O enquadramento não é escolhido a olho: o gerador mede o corpo de cada vista
(primeira e última coluna, topo da cabeça, planta dos pés), acha o eixo de
simetria espelhando a silhueta e monta uma janela com margem dos dois lados.
Resultado medido nesta prancha: eixo em `x = 230`, corpo de `x = 11` a `446`
(anterior) e de `x = 10` a `450` (posterior), do topo `y = 4` aos pés em
`y = 1015` — nada de cabeça, mão, perna ou pé cortado, com margem de 4 px em
cima e 6 px embaixo. A escala comum é **1:1** (um pixel da prancha é uma
unidade da viewBox): a imagem não é esticada nem reduzida, e as duas vistas
nunca ficam com tamanhos diferentes.

Consequências: não há duplicata da imagem no repositório, o navegador baixa a
prancha uma vez e não existe a possibilidade de as duas vistas ficarem em
escalas diferentes.

## 3. Máscaras derivadas

O fundo da prancha é **transparente**, com um halo residual de alfa baixo. Duas
máscaras são calculadas da própria prancha por
`tools/gerar-anatomia-referencia.mjs`:

| Arquivo | Conteúdo | Uso |
| --- | --- | --- |
| `mascara.png` | silhueta: alfa `> 140`, fechamento morfológico de raio 6, margem de 2 px | prende o **contorno** dos destaques ao corpo |
| `tinta.png` | silhueta **e** luminância `< 176`, alfa proporcional à sombra em 4 degraus, com teto próprio sobre o short | dosa a **cor** pela sombra do desenho |

O resultado visual: a cor é forte nas fissuras e inserções, fraca no meio-tom e
ausente nos realces claros (peitoral, deltoide, quadríceps), que continuam
cinza-claros. É o comportamento "destaque discreto, sem encobrir os detalhes"
exigido — o corpo nunca fica chapado de verde — e é determinístico.

### O short não é músculo

O short é quase preto (luminância mediana ≈ 30), então com o degradê normal ele
recebia cor cheia e a peça virava uma mancha verde. Mas o tecido cobre a pelve,
e **Glúteos** e **Quadril** são regiões que existem justamente ali: apagar a
tinta sobre a peça deixaria essas duas regiões invisíveis.

A solução: a tinta sobre o tecido tem um **teto de alfa** próprio
(`FABRIC_ALPHA = 78`, contra 255 no resto do corpo). Assim o destaque aparece
como véu translúcido sobre o short — reconhecível, sem transformar a peça em
músculo e sem inventar anatomia por baixo dela. A faixa é reconhecida pela
própria imagem (a peça é a massa escura contínua abaixo de 42 % da altura da
prancha), não por coordenada digitada à mão; o manifesto registra
`ink.fabric.{ramp,alphaCeiling,pixels}` para auditoria.

Nenhuma das duas máscaras é desenhada à mão: são recalculadas dos mesmos pixels
exibidos. Se a prancha for trocada, as máscaras acompanham.

### Por que não há `mix-blend-mode`

A revisão anterior usava `mix-blend-mode: color`. Na prancha anterior (fundo
preto) o modo `color` preserva a luminância do fundo — que é zero fora das
linhas — e a região ficava invisível. Testes com `screen` e `lighten` também falharam de
forma intermitente: no Chromium 138, uma camada SVG com máscara de imagem e
blend era composta **abaixo** da prancha opaca em parte das figuras da mesma
página, e a região desaparecia.

A solução adotada não usa blend: cor sólida recortada por `tinta.png` e
contorno recortado por `mascara.png`. Junto com isso, `.figura-svg` usa
`overflow: hidden` (o padrão da especificação para a raiz de um SVG). Com
`overflow: visible` o mesmo defeito de composição reaparecia — está registrado
no CSS e coberto por teste.

## 4. Como as regiões foram mapeadas

Cada região é uma **projeção funcional superficial**, traçada sobre as áreas
que o próprio desenho delimita. O processo foi:

1. medir os limites do corpo nas duas vistas (perfil do contorno a cada 20 px);
2. identificar no desenho as divisões visíveis — clavícula, linha do peitoral,
   dobra do cotovelo, linha alba, crista ilíaca, dobra glútea, patela, tendão
   calcâneo;
3. traçar um polígono por região, espelhado em torno do eixo de cada desenho
   (nesta prancha, `x = 230` nas duas vistas);
4. comparar o traçado com a prancha em render real, região por região;
5. validar que cada caminho fecha, fica dentro da silhueta, cobre sombra de
   verdade (teste E2E) e que todo vértice cai sobre o corpo (testes ATLAS 3 e
   ATLAS 14).

| ID (catálogo) | Vista | O que a região representa nesta prancha |
| --- | --- | --- |
| `peito` | anterior | porção visível do peitoral maior, do esterno à axila |
| `ombros` | anterior e posterior | deltoide, do acrômio à inserção no braço |
| `biceps` | anterior | ventre anterior do braço até a dobra do cotovelo |
| `triceps` | posterior | ventre posterior do braço até a dobra do cotovelo |
| `antebracos` | anterior e posterior | massa do antebraço; punho e mão ficam neutros |
| `abdomem` | anterior | reto abdominal visível, com linha alba e interseções |
| `obliquos` | anterior | faixa lateral do tronco entre o reto e a borda do corpo |
| `quadril` | anterior | projeção inguinal/do quadril — não é o iliopsoas |
| `quadriceps` | anterior | massa anterior da coxa até acima da patela |
| `pernas` | anterior e posterior | região geral: coxa + perna da mesma vista, sem pé nem patela |
| `costas` | posterior | trapézio e região escapular superior, agrupados |
| `dorsais` | posterior | grande dorsal e massa lateral do dorso até a crista ilíaca |
| `lombar` | posterior | projeção da região lombar; eretores profundos não isolados |
| `gluteos` | posterior | glúteo sob o short, da crista ilíaca à dobra glútea — o tecido cobre o contorno |
| `posterior-coxa` | posterior | isquiotibiais até a fossa poplítea |
| `panturrilha` | posterior | ventres do tríceps sural; tendão calcâneo não é pintado |

Os 16 IDs são os mesmos de antes: catálogo, atlas, biblioteca e execução não
mudaram de vocabulário.

### Limitações anatômicas (explícitas na interface)

- são **projeções**, não segmentação clínica;
- o desenho é superficial: músculos profundos não aparecem e não são inferidos;
- "Costas" agrupa trapézio e região escapular; "Dorsais" agrupa a massa lateral;
  "Pernas" agrupa coxa e perna;
- serrátil, esternocleidomastoideo, adutores e estruturas articulares não têm
  região no catálogo e permanecem neutros;
- a patela e o tendão calcâneo ficam sem cor de propósito;
- cada `REGIONS[id].note` repete a limitação da região no código.

## 5. Coordenadas das regiões

`SHAPES` em `assets/js/forja-figura.js` é declarativo:

```js
peito: {
  label: "Peitoral",
  note: "Porção visível do peitoral maior, do esterno à axila.",
  backNote: "",
  front: [[[220, 192], [202, 186], /* … */]],
  back: []
}
```

- as coordenadas estão no mesmo espaço da viewBox (460 × 1024);
- `pair(view, pontos)` devolve a metade autoral **e** o espelho em torno do eixo
  daquela vista;
- `polygonPath` fecha o polígono com curvas quadráticas nos pontos médios: a
  curva fica sempre dentro do polígono autoral, nunca além do que foi traçado;
- a cor só aparece onde `tinta.png` permite; o contorno é recortado pela
  silhueta. Um ponto traçado fora do corpo não pinta o fundo — o excesso é
  cortado.

## 6. Como adicionar ou corrigir uma região

1. Abra o Atlas, escolha um exercício e inspecione a vista com a região
   destacada (ou use `Forja.figura.render` numa página de teste).
2. Ajuste os pontos em `SHAPES`; use `pair("front" | "back", [...])` para
   regiões simétricas e um único polígono para regiões centrais (reto
   abdominal, costas, lombar).
3. Mantenha a ordem dos pontos no sentido do contorno; o primeiro e o último se
   conectam automaticamente.
4. Rode `npm test` (valida janela, hashes, fechamento dos caminhos e o mapa de
   regiões) e `npm run test:e2e` (valida que cada caminho fica dentro da
   silhueta e pinta áreas escuras da prancha).
5. Gere as capturas: `node tools/capturas-atlas.mjs` mede 320–1280 px e grava
   em `artifacts/forja-visual/`.
6. Se a região nova for um grupo do catálogo, atualize também `GROUP_DEFS` e
   `VIEW_OF` em `assets/js/forja-atlas.js` e a tabela da seção 4.

Para trocar a prancha por outra imagem (ou por uma versão feminina do mesmo
desenho):

1. substitua `assets/anatomia/fontes/forja-modelo-anatomico.png` (e atualize a
   origem em `NOTICE.md`; rode `python3 tools/verificar-procedencia.py` na
   imagem nova para registrar se ela traz manifesto e de quem);
2. rode `node tools/gerar-anatomia-referencia.mjs`: ele recalcula eixo, janela,
   escala, máscaras e manifesto;
3. copie os números de `manifest.views` para `CROPS`/`AXES`/`VIEWBOX` em
   `assets/js/forja-figura.js` (o teste ATLAS 14 falha se os dois divergirem);
4. revise os pontos de `SHAPES` — eles são relativos a esta pose e a esta
   escala;
5. rode as duas suítes e gere as capturas.

## 7. Regeneração

```bash
npm ci
node tools/gerar-anatomia-referencia.mjs
```

Em contêineres mínimos pode ser necessário apontar `PUPPETEER_EXECUTABLE_PATH`
e `LD_LIBRARY_PATH`, como documentado em `docs/forja-2.0-refresh.md`. O gerador
não desenha anatomia: só calcula as máscaras, confere o hash da referência e
escreve `manifest.json` e os limites do corpo por vista.
