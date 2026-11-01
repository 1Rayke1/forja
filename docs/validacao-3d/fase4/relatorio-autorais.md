# Fase 4 — animações autorais: flexão de braço, prancha e mountain climber

**Estado: PUBLICADO.** Os três exercícios foram autorados por geometria (não
transferidos, não aproximados) e entraram no catálogo com o **rig de 16 ossos**,
com um GLB por personagem. Os outros 37 clipes publicados não foram tocados.

| id no catálogo | arquivo do masculino | arquivo do feminino | duração | status |
|---|---|---|---|---|
| `flexao` | `assets/3d/animacoes/flexao.glb` | `flexao-feminino.glb` | 6,00 s | exact |
| `prancha` | `assets/3d/animacoes/prancha.glb` | `prancha-feminino.glb` | 6,00 s | exact |
| `mountain-climber` | `assets/3d/animacoes/mountain-climber.glb` | `mountain-climber-feminino.glb` | 4,50 s | exact |

---

## 1. O problema real destes três exercícios

Nos outros clipes o defeito aparece como "não é o movimento". Aqui ele é
**contato e alinhamento**: o pé que atravessa o chão, a mão que flutua, o quadril
subindo na prancha, o joelho que não chega perto do peito.

Os clipes que estavam publicados nestes três ids eram reprovados pelo próprio
analisador do repo (medido antes da publicação):

| id antes | cotovelo | joelho | quadril → tronco | veredito |
|---|---|---|---|---|
| `flexao` (plank-to-down-dog) | 132,7–180,0° | 122,5–168,0° | 85,0–127,0° | divergente |
| `prancha` (plank-full) | **163,7–180,0°** | 115,8–168,6° | **99,3–150,5°** | divergente |
| `mountain-climber` (standing-climber) | 122,0° fixo | **129,1–142,6°** (13° de amplitude) | 126,7–135,5° | divergente |

Na prancha publicada o braço ficava quase esticado (163–180°) em vez de apoiar o
antebraço. No mountain climber o joelho variava 13°: não havia perna subindo.
É esse buraco que a fase 4 fecha.

## 2. Método: a pose sai da geometria

O corpo é resolvido como **corpo rígido apoiado entre dois pontos**
(`tools/lib/pose-autoral-3d.mjs`):

- o corpo (pé → joelho → quadril → coluna → ombro) é **rígido**, inclinado β;
- os **pés** ficam plantados na origem do apoio (tornozelo na ponta do pé a 40°);
- as **mãos** ficam plantadas num ponto fixo do chão;
- a flexão do cotovelo é **consequência** da distância ombro↔punho: quem desce é
  o corpo, o braço resolve por **IK de dois ossos**;
- a perna que sai do apoio é comandada por **ângulo**, com abdução só onde é
  necessária para o joelho não raspar o chão.

Assim "mão no chão", "pé no chão" e "tronco alinhado" são verdade **por
construção** — e os testes conferem que continuam verdadeiros depois de virar GLB
e passar pelo `AnimationMixer`.

Medidas do rig usadas (não são constantes digitadas):

| medida | masculino | feminino |
|---|---|---|
| coxa / canela | 0,4389 / 0,4180 m | 0,4053 / 0,3860 m |
| braço / antebraço | 0,3030 / 0,2613 m | 0,2798 / 0,2413 m |
| quadril↔ombro projetado (`corpo`) | 1,4003 m | 1,2931 m |
| tornozelo apoiado na ponta (40°) | 0,1812 m | 0,1673 m |

## 3. Os três exercícios

| parâmetro | flexão | prancha | mountain climber |
|---|---|---|---|
| β do corpo | 17,16° → 5,45° (desce) | 6,84° | 17,16° fixo |
| ombro | 0,5943 → 0,3143 m | 0,348 m (braço + antebraço) | 0,5943 m |
| cotovelo | 61,3–177,8° | 90,0° | 177,8° (braço esticado) |
| ritmo | 2 repetições de 3 s em 6 s | isométrica, 6 s (respiração de 3 s) | 3 ciclos de 1,5 s em 4,5 s |
| pés | plantados | plantados | um plantado, o outro viaja |

**Flexão.** O parâmetro é a altura do ombro; o punho não se mexe. Ao descer, o
ombro viaja para frente (o corpo gira sobre os pés) e o cotovelo dobra para trás.
Punho 0,03 m acima do chão, pé na ponta, sem escorregar.

**Prancha.** Braço na vertical, **antebraço deitado no chão apontando para
frente**, cotovelo a 90° — a definição de prancha de antebraço, e exatamente o que
o clipe antigo não fazia. Isométrica: só o pescoço se move (1,2° de respiração),
sem deslocar mão, pé nem quadril.

**Mountain climber.** Prancha alta, pernas **defasadas em meio ciclo**: metade do
ciclo apoiada, metade no ar, nunca as duas no ar. A perna que viaja é comandada
por ângulo, não por alvo de pé:

> com a prancha alta o quadril fica a 0,45 m e a coxa mede 0,44 m. Um joelho que
> passe na vertical — inevitável no caminho "atrás → frente" — encostaria no chão.
> Quem resolve é a **abdução do quadril**, proporcional ao quanto o joelho está
> passando por baixo do corpo (`36° · sen(π·avanço)`), mais o pé que deixa de
> ficar em ponta e passa neutro quando sobe.

Isso não é enfeite: medido, a folga do joelho é exatamente o que a abdução
compra.

| abdução | joelho do viajante (mín. do ciclo) | malha no chão |
|---|---|---|
| 0° | −0,004 m | **−0,051 m** (atravessa) |
| 18° | 0,020 m | −0,031 m (atravessa) |
| 26° | 0,032 m | −0,010 m |
| 30° | 0,051 m | ≈ 0,000 m |
| **36° (publicado)** | **0,075 m** | **−0,001 m** |

O quadril não pode subir para abrir essa folga: na prancha alta o braço está
esticado com a mão no chão (ombro preso) e a perna de apoio está na extensão
máxima. Sem quebrar o tronco rígido em dois, a única variável é a abdução — e 36°
é o que mantém o joelho fora do chão com o pé ainda chegando embaixo do corpo.

## 4. Um GLB por personagem (por que não um só)

Um clipe só pode ser aplicado aos dois corpos se as poses não dependerem do
comprimento de braço e perna — o que não é o caso aqui. Medido, cruzando os
clipes antigos entre os corpos:

| clipe aplicado em | mão | pé | malha |
|---|---|---|---|
| masculino no corpo feminino | 0,048–0,062 m (flutua 2–3 cm) | 0,188–0,202 m (flutua) | 0,000 |
| feminino no corpo masculino | −0,002–0,013 m | 0,147–0,162 m | **−0,033 m (atravessa)** |

Então o catálogo ganhou `arquivos` por personagem (só nos clipes autorados, e só
quando o arquivo da variante existe):

```json
"arquivo": "assets/3d/animacoes/flexao.glb",
"personagens": ["masculino", "feminino"],
"arquivos": {
  "masculino": { "arquivo": "assets/3d/animacoes/flexao.glb", "bytes": 42556 },
  "feminino":  { "arquivo": "assets/3d/animacoes/flexao-feminino.glb", "bytes": 42560 }
}
```

`arquivo` continua sendo o caminho padrão (o do masculino), então nada que leia só
ele muda de comportamento. O app escolhe em `arquivoDoClipe(clipe, personagem)`
(`assets/js/forja-personagens.js`), nos dois pontos onde a URL do clipe é montada
(criar o painel e trocar de exercício). Os 37 outros clipes não têm `arquivos` e
seguem com um arquivo só.

## 5. Folhas de imagem (perfil e frente, 8 poses, com linha do chão)

Linha de cima **perfil**, linha de baixo **frente** (o personagem olha para +Z):

- `candidatos/flexao-masculino.png` · `flexao-feminino.png`
- `candidatos/prancha-masculino.png` · `prancha-feminino.png`
- `candidatos/mountain-climber-masculino.png` · `mountain-climber-feminino.png`

Extra para o mountain climber (vista 3/4, um ciclo inteiro): `mountain-climber-
masculino-3q.png` e `mountain-climber-feminino-3q.png` — é a vista em que se vê a
perna alternando sem precisar de imaginação.

```bash
node tools/autorar-exercicios-3d.mjs --exercicio flexao --personagem masculino
node tools/folha-imagens-3d.mjs \
  --arquivo docs/validacao-3d/fase4/candidatos/flexao-masculino.glb \
  --clipe flexao-masculino --personagem masculino --enquadrar clipe --chao \
  --tempos 0,0.45,0.9,1.35,1.5,1.8,2.4,3.0 --largura 260 --altura 300 \
  --saida docs/validacao-3d/fase4/candidatos/flexao-masculino.png
```

Mudanças na ferramenta de folha (`--enquadrar clipe`, `--chao`, `--tempos`,
`--altura`, `--linhas`, `--azimute`; defaults antigos intactos):

- **correção de rótulo**: a linha chamada "frente" usava azimute π, que é a
  **vista de costas**. Agora frente é azimute 0;
- `--linhas perfil|frente` e `--azimute <graus>` para olhar uma vista só.

## 6. Medição do que ficou publicado

Medido no GLB final, pelo caminho do app (`reamarrarFaixas` + `AnimationMixer`),
24 fps, cada clipe no **seu** personagem:

| clipe | dur. | quadril Y | pé (baixo / alto) | mão | cotovelo | joelho (dobrado) | tronco* | malha** |
|---|---|---|---|---|---|---|---|---|
| flexão masc. | 6,00 s | 0,268–0,449 | 0,181 / 0,181 | 0,030 fixo | 61,3–177,8° | 180° | 174,7° | −0,001 m |
| flexão fem. | 6,00 s | 0,235–0,416 | 0,167 / 0,167 | 0,030 fixo | 56,0–177,7° | 180° | 172,7° | 0,000 m |
| prancha masc. | 6,00 s | 0,290 (parado) | 0,181 / 0,181 | 0,045 fixo | 90,0° | 180° | 174,7° | 0,000 m |
| prancha fem. | 6,00 s | 0,270 (parado) | 0,167 / 0,167 | 0,045 fixo | 90,0° | 180° | 172,7° | 0,000 m |
| m. climber masc. | 4,50 s | 0,449 (parado) | 0,133–0,181 / 0,181–0,361 | 0,030 fixo | 177,8° | 48,8–180° | 174,7° | −0,001 m |
| m. climber fem. | 4,50 s | 0,416 (parado) | 0,124–0,167 / 0,167–0,335 | 0,030 fixo | 177,7° | 48,8–180° | 172,7° | 0,000 m |

\* ângulo ombro–quadril–tornozelo na perna mais reta (a que sustenta no mountain
climber). \** vértice mais baixo da malha no clipe inteiro: −0,001 m encosta, não
atravessa.

No mountain climber: uma perna **sempre** no apoio (0,181 / 0,167 m), a outra sobe
até 0,361 / 0,335 m, e o joelho que dobra chega a 48,8° (o clipe antigo não passava
de 129°).

## 7. Analisador do repo

O `tools/analisar-movimentos-3d.mjs` aplica a assinatura do exercício, não só
higiene. Depois da publicação, o relatório `docs/assets-3d/diagnostico-movimentos.json`
passou a mostrar os três como `exact / ok` (antes: `divergente`).

```
node tools/analisar-movimentos-3d.mjs --arquivo assets/3d/animacoes/prancha.glb \
  --personagem feminino --exercicio prancha
→ higiene: ok · assinatura de "prancha": ok (veredito: ok)
```

Duas correções de critério foram necessárias no analisador:

1. **`joelhoDobrado`**: a assinatura do mountain climber media a **média** dos
   joelhos. Num exercício que alterna pernas, a média fica em 113° mesmo com um
   joelho no peito (48°) e o outro esticado (180°) — inútil. Agora usa o menor
   ângulo por quadro.
2. **`--exercicio`** no modo `--arquivo`: aplica no candidato a mesma assinatura
   que o catálogo exige do clipe publicado. Sem isso, "higiene ok" só dizia que a
   pose é válida — não que o movimento é o exercício pedido.

## 8. Testes

`npm test` → **285 testes, exit 0** (18 + 110 + 21 + 13 + 40 + 17 + 18 + 9 + 17 +
22). Os 22 da animação autoral gravam o GLB, recarregam pelo caminho do app e
medem quadro a quadro, **inclusive os vértices da malha** — foi assim que
apareceram 13,5 cm de mão dentro do chão, 47 cm de pé e uma versão com as duas
pernas no ar ao mesmo tempo.

O teste 18 ("laço: o último quadro fecha com o primeiro") estava fraco: comparava
só a posição do **quadril**, que no mountain climber não se move — e deixou passar
uma emenda de **0,475 m na perna**. O analisador do repo pegou. Correção em dois
lugares:

- `autorarExercicio` amostra um quadro a mais, em `t = duração`, e as durações
  viraram múltiplos exatos do período (6 s = 2 × 3 s, 6 s = 2 × 3 s de respiração,
  4,5 s = 3 × 1,5 s), então o último quadro é **idêntico** ao primeiro;
- o teste 18 passou a comparar as **chaves do próprio clipe** (todas as trilhas,
  tolerância 1e-4) e a exigir duração múltipla de 1/24 s.

## 9. Limites — o que não está resolvido

1. **Abdução de 36° no mountain climber.** É o mínimo que mantém o joelho fora do
   chão com o pé chegando embaixo do corpo (tabela do §3). A alternativa real
   seria levantar o quadril, e isso não cabe no tronco rígido: o ombro está preso
   pela mão no chão e a perna de apoio está na extensão máxima. Se a leitura for
   "muito aberto", o caminho é outro exercício (prancha mais baixa, com perna de
   apoio dobrada), não um ajuste de número.
2. **Prancha é estática de propósito.** Com o braço rígido, respiração que mexa o
   ombro mexe a mão no chão; só o pescoço respira.
3. **Mão não gira**: punho com a palma para baixo, dedos à frente, sem variação.
   É pose, não preensão.
4. **Pé na ponta a 40°** é constante na flexão e na prancha; no mountain climber o
   pé que viaja sai da ponta para neutro.
5. **Custo de arquivo**: os autorados são maiores que os do DeskBreak
   (33–43 KB contra 18–33 KB) porque trazem um quadro por 1/24 s em vez de
   esparso. Total de animações: 921 KB.

## 10. Arquivos

Novos:

- `assets/3d/animacoes/{flexao,prancha,mountain-climber}-feminino.glb` — as três
  variantes novas (os arquivos masculinos são os mesmos ids de antes, com o
  conteúdo substituído)
- `tools/lib/pose-autoral-3d.mjs` — geometria do rig, IK de dois ossos, corpo
  rígido inclinado, os três exercícios, montagem das trilhas;
- `tools/autorar-exercicios-3d.mjs` — CLI (`--exercicio`, `--personagem`, `--saida`, `--fps`, `--duracao`);
- `tests/pose-autoral3d.test.mjs` — os 22 testes;
- `docs/validacao-3d/fase4/` — este relatório, 6 GLBs candidatos, 6 folhas
  perfil+frente e 2 vistas 3/4.

Alterados:

- `assets/3d/catalogo.json` — os três ids viraram `exact`, com `arquivos` por
  personagem e metadados lidos do próprio GLB (quadros, duração, bytes);
- `tools/gerar-catalogo-3d.mjs` — `fonte: "autoral"` (mede o GLB em vez de confiar
  no mapa) e `arquivos` por personagem;
- `tools/animacoes-mapa.json` — os três entram como `autoral` / `exact`;
- `assets/js/forja-personagens.js` — `arquivoDoClipe()`, usado nos dois pontos de
  montagem da URL do clipe;
- `tools/analisar-movimentos-3d.mjs` — `joelhoDobrado` e `--exercicio`;
- `tools/folha-imagens-3d.mjs` — vistas, `--linhas`, `--azimute` e a frente
  corrigida;
- `tests/personagens3d.test.mjs` — o teste 5 passou a conferir as variantes por
  personagem;
- `docs/assets-3d/diagnostico-movimentos.json` e
  `docs/assets-3d/relatorio-integracao-3d.json` — regerados a partir do catálogo
  publicado;
- `package.json` — `test` inclui a suíte autoral.

Intocados: os outros 37 clipes de `assets/3d/animacoes/`, o personagem, o
runtime 3D (`assets/js/forja-3d-cena.js`) e as telas do app.

## 11. Como conferir

```bash
npm test                                             # 285 testes, exit 0
node tools/analisar-movimentos-3d.mjs                # os três: exact / ok
node tools/auditar-integracao-3d.mjs                 # 40 clipes publicados, 20 exatos
node tools/folha-imagens-3d.mjs --arquivo assets/3d/animacoes/prancha-feminino.glb \
  --clipe prancha-feminino --personagem feminino --enquadrar clipe --chao \
  --saida /tmp/prancha.png
```

No app: Biblioteca → Flexão de braço, Prancha frontal ou Mountain climber. O painel
3D carrega o arquivo do personagem escolhido no Perfil (masculino → `flexao.glb`,
feminino → `flexao-feminino.glb`), sem selo de "movimento aproximado".
