# Fase 3 — transferidor corrigido para rigs de repouso diferente

Escopo desta etapa: **consertar a transferência de mocap**, sem tocar nos 40
clipes publicados nem no `assets/3d/catalogo.json`. Nada aqui foi publicado.

## 1. O defeito, em uma frase

O transferidor antigo calculava uma "correção de repouso por osso" assumindo que
o osso aponta para o **+Y local** — verdade no pacote Rokoko, mentira nos outros.
Onde a suposição falhava, o `setFromUnitVectors` caía perto de 180° e escolhia um
eixo arbitrário. Resultado no iClone/Mixamo: **personagem de cabeça para baixo**.

Antes e depois, no **mesmo arquivo, mesma janela, mesma medição**
(`16_Barbell_Curl_iclone.fbx`, 0–3 s):

| | quadril | pés | inversões | salto entre quadros |
| --- | --- | --- | --- | --- |
| antes (`fase2/candidatos/rosca-biceps-mocap.glb`) | 0,993 m | **1,601–1,797 m** | rig virado | 0,749 m (27× a mediana) |
| depois (`--modo direcao`) | 0,772–0,916 m | **0–0,066 m** | 0 | 0,824 m — **da fonte** (§4) |

## 2. O que passou a existir

`tools/lib/retarget-3d.mjs` — a matemática da transferência, fora do CLI, para
ser testável. Quatro modos:

| modo | conta | serve para |
| --- | --- | --- |
| **`direcao`** (padrão) | copia a **direção real** do osso (filho − osso) nos dois rigs, e reaplica a torção relativa em torno do eixo já transferido | todos os rigs; preserva a pose que se vê |
| `mundo` | delta de rotação de mundo aplicado ao repouso do destino | fica em pé em qualquer rig, mas **comprime** a flexão (medido: cotovelo 103–137° onde a fonte tem 53–163°) |
| `local` | delta local por osso com correção constante entre pais | comparação |
| `legado` | a conta antiga, com eixo +Y fixo | só para documentar o "antes" |

Por que `direcao` e não `mundo`: medindo o iClone, `mundo` deu cotovelo
**103–137°** com a fonte em **53–163°** — o personagem fica em pé e no chão, mas
a rosca perde dois terços da flexão. `direcao` devolveu **53,3–162,9°**, idêntico
à fonte, e joelho **157,28–162,89°** contra **157,28–162,89°** da fonte.

A direção sai da **geometria do próprio rig** (posição do filho menos a posição
do osso), nunca de um eixo fixo. Por isso funciona com qualquer roll, eixo e
pose de repouso. O filho usado é o que continua a cadeia (`hips→spine`,
`spine→neck`, `armL→elbowL`, …) — usar "o primeiro filho que aparecer" fazia a
torção do tronco virar rotação de ombro.

Apoio no chão: um **único deslocamento constante** em Y, para o pé mais baixo do
clipe encostar no chão. Constante para não destruir o movimento; garante
`pé ≥ 0` em todo o clipe.

## 3. Inspeção da fonte: `tools/inspecionar-fonte-3d.mjs`

Separa **defeito do arquivo** de **defeito da transferência**, porque esconder o
primeiro com filtro é o que produz clipe publicado com salto. Mede salto por
quadro (pico contra a mediana dos vizinhos), amplitude de joelho/cotovelo, altura
de pé/quadril/punho, e um perfil por segundo (`--perfil`) para achar a janela em
que o exercício realmente acontece.

Achados nos dois arquivos reais:

- `16_Barbell_Curl_iclone.fbx` — 46,07 s, 66 ossos, mapeia **15/15**. Roscas de
  verdade entre 15 s e 41 s (cotovelo chega a 49°), parado no lugar (pé 0,080 m
  constante). **Duas bordas ruins**: 0,042 s e 46,067 s (salto de 0,83 m e
  1,04 m). Janela usada: **15–21 s**, contínua (pico 0,065 m, razão 3,6).
- `06_Jumping_Jacks.fbx` — 4 s, mapeia 15/15, joelho 107–157°, cotovelo 89–169°,
  abertura de pés 0,50 m. Pico por quadro **0,2145 m**, mas razão **3,6** contra a
  mediana: é movimento rápido, **não** descontinuidade.

> **Correção de um erro meu da fase 2.** Eu havia escrito que a fonte do
> polichinelo "pula 1,12 m entre amostras". Estava errado: aquela medição usou
> todas as 66 ossos e unidades do FBX (cm), sem escala. Medido direito — 15 ossos
> mapeados, em metros, a 24 fps — o pior quadro é 0,2145 m com razão 3,6, típico
> de braço de polichinelo, não de salto. A fonte **não** é defeituosa.

## 4. Resultados medidos

Janela iClone **15–21 s**, `--modo direcao`, apoio no chão ligado:

| medida | fonte | resultado (masculino) | resultado (feminino) |
| --- | --- | --- | --- |
| quadril | — | 0,890–0,899 m | 0,822–0,830 m |
| pés | 0,080 m | 0–0,003 m | 0–0,002 m |
| joelho | 157,3–162,9° | 157,3–162,9° | 157,2–163,9° |
| cotovelo | 53,3–162,9° | 53,3–162,9° | 56,8–164,2° |
| inversões | — | 0 | 0 |
| pés abaixo do chão | — | 0 | 0 |
| salto entre quadros | 0,065 m | 0,058 m | 0,054 m |

Polichinelo (`06_Jumping_Jacks.fbx`, 0,1–4 s), mesmo modo:

| medida | masculino | feminino |
| --- | --- | --- |
| pés | 0,001–0,141 m (no ar no salto) | 0,001–0,131 m |
| quadril | 0,709–1,006 m | 0,655–0,930 m |
| cotovelo | 96,3–170,2° | 96,3–170,2° |
| abertura dos pés | 0,499 m | 0,464 m |
| punho máx | 1,794 m | 1,657 m |
| deslocamento no chão (XZ) | 0,25 m | 0,25 m |
| higiene | ok | ok |

Folhas de imagem fonte × resultado (6 fases, frente e perfil, linha do chão
desenhada; linhas 1–2 = fonte, 3–4 = resultado):

- `docs/validacao-3d/fase3/rosca-masculino.png`
- `docs/validacao-3d/fase3/rosca-feminino.png`
- `docs/validacao-3d/fase3/jumping-jacks-masculino.png`

Candidatos gerados (para revisão, **fora** do catálogo):
`docs/validacao-3d/fase3/candidatos/{rosca-biceps,polichinelo-mocap}-{masculino,feminino}.glb`.

## 5. Testes (17 novos)

`tests/transferencia3d.test.mjs` — todos fechados, sem depender de arquivo que
possa faltar: um rig **sintético** é montado a partir do próprio esqueleto do
FORJA, com o vocabulário escolhido e a pose de repouso alterada de propósito; o
clipe aplicado nele reproduz exatamente as orientações de mundo de um clipe
publicado; a transferência tem de reconstruir essa pose.

| # | teste | o que prova |
| --- | --- | --- |
| 1–4 | Rokoko / iClone / Mixamo / UE5, masculino e feminino | direção de cada osso volta com menos de 6° de erro; posição de articulação < 6 cm |
| 5–8 | repouso A-45°, corpo virado 180°, virado 30°, rig em centímetros | pose de repouso diferente não muda o resultado |
| 9 | guinada com rig virado 180° | o personagem não chega de costas |
| 10 | rig em centímetros | escala de altura aplicada, quadril na altura do alvo |
| 11 | pés e quadril, nos dois personagens | pés nunca abaixo do chão, nenhuma inversão |
| 12 | amplitude de joelho e cotovelo | flexão preservada, não comprimida |
| 13 | modo `mundo` | fica em pé, mas comprime (por isso não é o padrão) |
| 14 | continuidade | nenhum salto entre quadros |
| 15 | detector de descontinuidade | distingue movimento rápido de salto |
| 16 | iClone real | 15/15 ossos, em pé, no chão, rosca com flexão |
| 17 | borda ruim do iClone | fonte descontínua é **detectada**, não mascarada |

Suíte completa: **263 testes** (237 anteriores + 9 de mapeamento + 17 de
transferência), saída **0**.

## 6. Limites do que foi feito

- **Não** houve retrabalho de malha, pesos ou anatomia (é a etapa de personagem,
  separada).
- O `--modo legado` continua no código como documentação do "antes"; a conta
  antiga não é usada para gerar clipe.
- A duração dos clipes transferidos é curta (6 s de rosca, 4 s de polichinelo):
  é a janela limpa da fonte, não o exercício inteiro.
- Flexão, prancha e mountain-climber continuam sem fonte (nem DeskBreak nem os
  dois FBX do disco têm esses movimentos) — seguem pendentes de autoria.

## 7. Como reproduzir

```
npm install
node tools/inspecionar-fonte-3d.mjs --origem tools/fontes-3d/16_Barbell_Curl_iclone.fbx --perfil
node tools/retransferir-mocap.mjs --origem tools/fontes-3d/16_Barbell_Curl_iclone.fbx \
  --inicio 15 --duracao 6 --modo direcao --clipe rosca-biceps \
  --saida docs/validacao-3d/fase3/candidatos/rosca-biceps-masculino.glb
node tools/folha-comparativa-3d.mjs --origem tools/fontes-3d/16_Barbell_Curl_iclone.fbx \
  --inicio 15 --duracao 6 --saida docs/validacao-3d/fase3/rosca-masculino.png
node tools/analisar-movimentos-3d.mjs --arquivo docs/validacao-3d/fase3/candidatos/rosca-biceps-masculino.glb
node tests/transferencia3d.test.mjs
```

## 8. Arquivos

Novos: `tools/lib/retarget-3d.mjs`, `tools/inspecionar-fonte-3d.mjs`,
`tools/folha-comparativa-3d.mjs`, `tests/transferencia3d.test.mjs`,
`docs/validacao-3d/fase3/**`.

Alterados: `tools/retransferir-mocap.mjs` (virou CLI fina sobre a biblioteca),
`tools/analisar-movimentos-3d.mjs` (respeita `--personagem`; salto por razão
contra a mediana; novo `deslocamentoXZ`), `package.json` (novo teste na suíte).

Intocados: `assets/3d/animacoes/*` (40 clipes), `assets/3d/catalogo.json`,
`assets/3d/personagens/*`, runtime do app.
