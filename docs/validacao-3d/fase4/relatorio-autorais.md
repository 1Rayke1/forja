# Fase 4 — animações autorais: flexão de braço, prancha e mountain climber

**O que foi feito.** Três exercícios que mocap não cobre foram **autorados por
geometria** (não transferidos, não aproximados), nos **dois personagens**, no
**rig de 16 nós** que já está publicado. Seis clipes candidatos, folhas de imagem
com perfil e frente, medição quadro a quadro e 22 testes novos.

**O que NÃO foi feito, de propósito.** Nada entrou no catálogo. Os 40 clipes
publicados e o `assets/3d/catalogo.json` continuam byte a byte como estavam
(`git diff` contra `e0b003c` vazio). Os candidatos ficam fora até aprovação.

---

## 1. O problema real destes três exercícios

Nos outros 40 clipes o defeito aparece como "não é o movimento". Aqui o defeito
aparece como **contato e alinhamento**: o pé que atravessa o chão, a mão que
flutua, o quadril que sobe na prancha, o joelho que não chega no peito.

Os clipes publicados hoje com estes três ids já são reprovados pelo próprio
analisador do repo (`docs/assets-3d/diagnostico-movimentos.json`):

| id publicado | cotovelo | quadrilFlex | joelho (média) | veredito |
|---|---|---|---|---|
| `flexao` | 132,7–180,0° | 85,0–127,0° | 122,5–168,0° | divergente |
| `prancha` | **163,7–180,0°** | **99,3–150,5°** | 115,8–168,6° | divergente |
| `mountain-climber` | 122,0° fixo | **126,7–135,5°** | **129,1–142,6°** (amplitude 13°) | divergente |

Na prancha publicada o braço fica **quase esticado** (163–180°) em vez de apoiar
o antebraço, e o tronco↔coxa varia 51°. No mountain climber o joelho varia 13°:
não há perna subindo. É esse buraco que a fase 4 fecha.

## 2. Método: a pose sai da geometria, não de ângulo chutado

Pose por keyframe com número escolhido a olho erra exatamente no que se pede
para acertar. Então o corpo é resolvido como **corpo rígido apoiado entre dois
pontos** (`tools/lib/pose-autoral-3d.mjs`):

- o corpo (pé → joelho → quadril → coluna → ombro) é **rígido**, inclinado β;
- os **pés** ficam plantados na origem do apoio (tornozelo na ponta do pé a 40°);
- as **mãos** ficam plantadas num ponto fixo do chão;
- a flexão do cotovelo é **consequência** da distância ombro↔punho: quem desce é
  o corpo, o braço resolve por **IK de dois ossos**;
- a perna que sai do apoio usa IK/ângulo com joelho apontando para frente.

Assim "mão no chão", "pé no chão", "ombro sobre a mão" e "tronco alinhado" são
verdade **por construção** — e os testes só conferem que continuam verdadeiros
depois de virar GLB e passar pelo `AnimationMixer`.

Inclinação do corpo a partir da altura do ombro (pé plantado):

```
sen β = (alturaOmbro − tornozeloY) / corpo
```

Medidas usadas (medidas do rig, não constantes mágicas):

| medida | masculino | feminino |
|---|---|---|
| coxa / canela | 0,4389 / 0,4180 m | 0,4053 / 0,3860 m |
| braço / antebraço | 0,3030 / 0,2613 m | 0,2798 / 0,2413 m |
| quadril↔ombro projetado (`corpo`) | 1,4003 m | 1,2931 m |
| tornozelo em repouso | 0,0836 m | 0,0772 m |
| tornozelo apoiado na ponta (40°) | 0,1812 m | 0,1673 m |
| ombro / quadril em repouso | 1,4839 / 0,9927 m | 1,3703 / 0,9168 m |

## 3. Os três exercícios

Cada um tem parâmetros próprios, derivados das medidas acima:

| parâmetro | flexão | prancha | mountain climber |
|---|---|---|---|
| β do corpo | 17,16° → 5,45° (desce) | 6,84° | 17,16° fixo |
| ombro | 0,5943 → 0,3143 m | 0,348 m (braço + antebraço no chão) | 0,5943 m |
| cotovelo | 61,3–177,8° | 90,0° | 177,8° (braço esticado) |
| ritmo | 2 repetições / 6,4 s | isométrica, 6 s | 3 ciclos / 4,4 s (1,5 s por ciclo) |
| pés | plantados | plantados | um plantado, o outro viaja |

**Flexão.** O parâmetro é a altura do ombro; o punho não se mexe. Ao descer, o
ombro viaja **para frente** (o corpo gira sobre os pés) e o cotovelo dobra para
trás — que é o que a flexão faz de verdade. O punho fica 0,03 m acima do chão e
o pé na ponta, sem escorregar.

**Prancha.** Braço na vertical, **antebraço deitado no chão apontando para
frente**, cotovelo a 90° — é a definição de prancha de antebraço, e é justamente
o que o clipe publicado não faz. É isométrica: a única coisa que se move é o
pescoço (1,2° de respiração), que não desloca mão, pé nem quadril.

**Mountain climber.** Prancha alta, as duas pernas **defasadas em meio ciclo**:
metade do ciclo apoiada, metade no ar — nunca as duas no ar (a primeira versão
com onda triangular deixava as duas pernas no ar ao mesmo tempo, e o teste de
contato pegou isso). A perna que dirige é comandada por **ângulo**, não por alvo
de pé, por um motivo geométrico medido:

> com a prancha alta, o quadril fica a 0,43 m do chão e a coxa mede 0,44 m.
> Qualquer alvo de pé "na frente" obriga o joelho a passar **abaixo** do chão ou
> a dobrar 15° (canela colada na coxa). Então a coxa varre de "estendida atrás"
> até "joelho no peito" com flexão de joelho e uma **abdução de até 36°** no
> meio do arco — é o que uma perna de verdade faz para não raspar o chão, e é o
> preço honesto de um quadril baixo.

## 4. Folhas de imagem (perfil e frente, com linha do chão)

Arquivos em `docs/validacao-3d/fase4/candidatos/` (linha de cima: **perfil**;
linha de baixo: **frente**, olhando o personagem de frente — ele olha para +Z):

- `flexao-masculino.png` · `flexao-feminino.png`
- `prancha-masculino.png` · `prancha-feminino.png`
- `mountain-climber-masculino.png` · `mountain-climber-feminino.png`

Como reproduzir qualquer uma:

```bash
node tools/autorar-exercicios-3d.mjs --exercicio flexao --personagem masculino
node tools/folha-imagens-3d.mjs \
  --arquivo docs/validacao-3d/fase4/candidatos/flexao-masculino.glb \
  --clipe flexao-masculino --personagem masculino --enquadrar clipe --chao \
  --largura 400 --altura 340 --tempos 0,0.15,0.3,0.45,0.6,0.75 \
  --saida docs/validacao-3d/fase4/candidatos/flexao-masculino.png
```

### Mudanças na ferramenta de folha (só opções novas, defaults antigos intactos)

`tools/folha-imagens-3d.mjs` ganhou `--enquadrar clipe` (emoldura o movimento
inteiro — sem isso um clipe deitado sai fora do quadro), `--chao` (linha do chão
y=0 e eixo do personagem), `--tempos` (fases em segundos, para não repetir a
mesma pose nas colunas) e `--altura`.

**Correção de rótulo:** a linha chamada "frente" usava azimute π, que é a **vista
de costas** (o personagem olha para +Z — conferido na malha: ponta dos pés e
tórax em +Z). Agora a frente é azimute 0. As folhas das fases 2 e 3 não foram
regeradas; se forem, a segunda linha passa a mostrar a frente de verdade.

## 5. Medição dos seis candidatos

Medido no GLB final, pelo caminho do app (`reamarrarFaixas` + `AnimationMixer`),
24 fps, com o **personagem correto** em cada leitura:

| clipe | dur. | quadril Y | pé (baixo / alto) | mão | cotovelo | joelho (dobrado) | tronco* | malha** | passo*** |
|---|---|---|---|---|---|---|---|---|---|
| flexão masc. | 6,38 s | 0,268–0,449 | 0,181–0,181 | 0,030–0,030 | 61,3–177,8° | 180° | 180,0° | −0,001 m | 0,014 m |
| flexão fem. | 6,38 s | 0,235–0,416 | 0,167–0,167 | 0,030–0,030 | 56,0–177,7° | 180° | 180,0° | 0,000 m | 0,013 m |
| prancha masc. | 5,96 s | 0,290–0,290 | 0,181–0,181 | 0,045–0,045 | 90,0° | 180° | 180,0° | 0,000 m | 0,000 m |
| prancha fem. | 5,96 s | 0,270–0,270 | 0,167–0,167 | 0,045–0,045 | 90,0° | 180° | 180,0° | 0,000 m | 0,000 m |
| m. climber masc. | 4,38 s | 0,449–0,449 | 0,133–0,361 | 0,030–0,030 | 177,8° | 48,8–180° | 174,7–180,0° | −0,001 m | 0,273 m |
| m. climber fem. | 4,38 s | 0,416–0,416 | 0,124–0,335 | 0,030–0,030 | 177,7° | 48,8–180° | 172,7–180,0° | 0,000 m | 0,253 m |

\* ângulo ombro–quadril–tornozelo (180° = linha reta); usa a perna mais reta, que
é a que sustenta o corpo no mountain climber.
\** vértice mais baixo da malha no clipe inteiro (−0,001 m = encosta no chão, não
atravessa).
\*** maior deslocamento de um osso entre dois quadros (0,273 m a 24 fps = 6,5 m/s,
no pé que viaja; a razão contra a mediana fica em 1,5× — movimento rápido, não
salto).

Leitura do que isso quer dizer:

- **pé e mão não se movem** em flexão e prancha (faixa de 0,000 m em X, Y e Z);
- **prancha é isométrica**: quadril variando 0,000 m e cotovelo a 90,0° cravado;
- **flexão desce 0,18 m** de quadril (0,449 → 0,268) com o cotovelo indo de
  177,8° a 61,3° e voltando;
- **mountain climber**: uma perna sempre apoiada (0,181/0,167 m), a outra sobe
  até 0,36 m, e o joelho que dobra chega a 48,8° (o publicado nem passava de 129°);
- **nenhum clipe fura o chão**: o vértice mais baixo da malha fica em −1 mm.

### Analisador do repo, com a assinatura do exercício

```
node tools/analisar-movimentos-3d.mjs --arquivo docs/.../flexao-masculino.glb \
  --personagem masculino --exercicio flexao
```

| clipe | higiene | assinatura do exercício | veredito |
|---|---|---|---|
| flexão masculino / feminino | ok | ok | **ok** |
| prancha masculino / feminino | ok | ok | **ok** |
| mountain climber masculino / feminino | ok | ok | **ok** |

### Mudanças no analisador (duas, ambas de critério errado)

1. **`joelhoDobrado`** (novo): menor ângulo entre os dois joelhos. A assinatura
   do mountain climber media a **média** dos joelhos — num exercício que alterna
   as pernas de propósito, a média fica em 113° mesmo com um joelho no peito
   (48°) e o outro esticado (180°). O clipe publicado continue reprovado
   (101,1°), então nenhum veredito antigo muda.
2. **`--exercicio`** no modo `--arquivo`: aplica no candidato a mesma assinatura
   que o catálogo exige do clipe publicado. Antes um candidato só podia ser
   julgado "higiene ok", que diz que a pose é válida — **não** que o movimento é
   o exercício pedido.

## 6. Testes

`tests/pose-autoral3d.test.mjs` — **22 testes**, só verdes (rodam ~2 s). Eles não
confiam na pose em memória: gravam o GLB, carregam de volta pelo caminho do app e
medem quadro a quadro, **inclusive os vértices da malha** (único jeito de saber
que o pé não furou o chão).

1. medidas do rig batem com os ossos (coxa, canela, braço, antebraço, `corpo`);
2. IK de dois ossos: alcance, comprimentos preservados, alvo fora do alcance marcado;
3. tornozelo na ponta sobe em relação ao pé plano;
4. flexão e prancha: **mão não anda** em X/Z e fica entre 2 e 6 cm do chão;
5. flexão e prancha: **pé não anda** em X, Y, Z (0,002 m);
6. mountain climber: um pé sempre no apoio, o outro levanta > 0,28 m;
7. nenhum clipe **fura o chão** (vértice ≥ −1 cm);
8. nenhum clipe **flutua** (vértice ≤ 1 cm);
9. flexão: cotovelo dobra ≤ 70° e estica ≥ 170°, amplitude > 90°;
10. flexão: quadril desce ≥ 10 cm e não afunda;
11. flexão e prancha: ombro–quadril–tornozelo ≥ 175° em todo quadro;
12. prancha: cotovelo a 90°±2, cotovelo no chão, punho parado, quadril parado;
13. prancha: postura parada, só o pescoço respira (< 4°);
14. mountain climber: joelho dobra até ≤ 110° e a outra perna estica ≥ 165°;
15. mountain climber: joelho avança > 0,3 m à frente do quadril;
16. mountain climber: prancha alta mantida (tronco ≥ 150°) e mão fixa;
17. continuidade: nenhum osso "teleporta" entre quadros (pico < 0,35 m e < 5× a mediana);
18. laço: o último quadro fecha com o primeiro;
19. compatibilidade: toda trilha do GLB acha um osso do rig (mesmo caminho do app);
20. cada clipe passa a **assinatura do seu exercício** no analisador do repo;
21. determinismo: gerar duas vezes dá bytes idênticos;
22. os candidatos em disco são **exatamente** o que o gerador produz hoje.

**Suíte completa: 285 testes, exit 0** (263 anteriores + 22 novos).

## 7. Limites — o que não está resolvido

Registrado aqui porque esconder defeito é o pior resultado possível.

1. **Perna que viaja no mountain climber**: o joelho passa a ~5 cm do chão no meio
   do arco (o quadril está a 0,43 m e a coxa mede 0,44 m). Não atravessa a malha
   (medido: vértice mínimo −1 mm), mas é um arco baixo — quem esperar joelho
   subindo "por fora" vai achar apertado. A alternativa honesta seria levantar o
   quadril, e isso quebraria o alinhamento exigido da prancha.
2. **Abdução de 36°** no meio do arco: é o que evita o joelho raspar o chão.
   Acima do usual em mountain climber de academia, dentro do plausível.
3. **Prancha é estática de propósito.** Quem quiser respiração de corpo inteiro
   vai precisar de outro rig ou de ombro com mais de um grau de liberdade — com o
   braço rígido, qualquer respiração que mexa o ombro mexe a mão no chão.
4. **Mão não gira**: o punho fica com a palma para baixo e os dedos à frente, sem
   variação. É pose, não preensão.
5. **Pé na ponta a 40°** é constante nos três exercícios; não há apoio de ponta
   "em movimento" (o pé que viaja, sim, muda de orientação).
6. **Sem publicação.** Os seis GLBs não estão no catálogo, não são carregados pelo
   app e não aparecem em nenhuma tela.

## 8. Arquivos

Novos:

- `tools/lib/pose-autoral-3d.mjs` — geometria do rig, IK de dois ossos, corpo
  rígido inclinado, os três exercícios, montagem das trilhas;
- `tools/autorar-exercicios-3d.mjs` — CLI (`--exercicio`, `--personagem`, `--saida`, `--fps`, `--duracao`);
- `tests/pose-autoral3d.test.mjs` — os 22 testes;
- `docs/validacao-3d/fase4/relatorio-autorais.md` — este arquivo;
- `docs/validacao-3d/fase4/candidatos/` — 6 `.glb` + 6 `.png`.

Alterados:

- `tools/folha-imagens-3d.mjs` — `--enquadrar clipe`, `--chao`, `--tempos`,
  `--altura`, `--vista`; frente passa a ser azimute 0 (era π, que é costas);
- `tools/analisar-movimentos-3d.mjs` — `joelhoDobrado` na assinatura do mountain
  climber e `--exercicio` para julgar candidato pela assinatura do exercício;
- `package.json` — `test` inclui a suíte nova.

Intocados: `assets/3d/animacoes/*` (40 clipes), `assets/3d/catalogo.json`,
`assets/js/forja-3d-cena.js`, qualquer tela do app.

## 9. Para aprovar

1. Olhar as seis folhas em `docs/validacao-3d/fase4/candidatos/` (perfil em cima,
   frente embaixo, linha do chão desenhada).
2. Conferir as duas tabelas do §5 — em especial o joelho do
   mountain climber (48,8°) e o cotovelo da prancha (90,0°), que é onde os clipes
   publicados erram.
3. Se aprovado, o passo seguinte é publicar (renomear para o id do exercício no
   catálogo, `loop: true`, regerar `catalogo.json` e a folha de validação) — isso
   é uma fase própria, não foi feita aqui.
