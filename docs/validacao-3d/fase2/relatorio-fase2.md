# Fase 2 — estado medido (folhas de imagens, candidatos e o que ainda trava)

Este documento é o retrato honesto da fase 2 **antes** de qualquer publicação.
Nada aqui foi publicado: os 40 clipes de `assets/3d/animacoes/` e o
`assets/3d/catalogo.json` continuam exatamente como estavam. Todo material novo
está em `docs/validacao-3d/fase2/`.

## 1. O que foi feito nesta etapa

| Item do plano aprovado | Estado | Onde ver |
| --- | --- | --- |
| 1. corrigir descontinuidade entre quadros | parcial — o caminho DeskBreak não tem salto; o caminho mocap continua com salto, e agora se sabe **por quê** | §3 |
| 2. corrigir plano de flexão de cotovelo/joelho | não concluído | §5 |
| 3. re-testar no rig iClone (`16_Barbell_Curl_iclone.fbx`) | mapeamento **consertado** (15/15 ossos); movimento gerado ainda sai **invertido** | §4 |
| 4. validar a tabela de mapeamento nos três formatos de rig | feito, com teste automático (9 testes) | §4 |
| 5. gerar os 11 clipes divergentes | **não** — a busca mediu 435 animações e não achou fonte aceitável para 8 dos 11 | §2 |
| 6. folha de imagens (poses principais + execução) das 11 | feito, para os **dois** personagens | `antes/`, `antes-feminino/`, `depois/` |
| anatomia: pesos multi-osso, fechar malha, remover Icosphere, proporções, feminino | não feito | §5 |

Ferramenta nova: `tools/folha-imagens-3d.mjs` — grade de 6 fases × 2 vistas
(frente e perfil) por clipe, renderizada na CPU (sem WebGL), usando o mesmo
caminho do app (`reamarrarFaixas` + `AnimationMixer`).

```
node tools/folha-imagens-3d.mjs --clipe prancha --saida docs/validacao-3d/fase2/antes/prancha.png
node tools/folha-imagens-3d.mjs --arquivo <candidato.glb> --clipe <id> --personagem feminino --saida <png>
```

## 2. Por que os 11 clipes divergentes não foram gerados

A fonte DeskBreak (`tools/fontes-3d/exercises.glb`, 435 animações, mesmo rig de
16 ossos do FORJA) foi medida animação por animação (`tools/escolher-clipes-3d.mjs`,
resultado em `docs/assets-3d/candidatos-clipes.json`) e a lista curta foi
re-medida uma a uma. O veredito:

| Exercício | Melhor fonte encontrada | Medida | Veredito |
| --- | --- | --- | --- |
| corrida-estacionaria | `high-knee-march` | joelho 126–140°, pés no lugar, deriva 0, higiene ok | **candidato gerado** (`candidatos/corrida-estacionaria-v2.glb`) — é marcha, não corrida |
| desenvolvimento | `chair-overhead-reach` / `dance-raise-the-roof` | punho 1,57 m / 1,83 m | sentado / dança: não é desenvolvimento |
| puxada | `pull-aparts` / `dance-pump-it` | cotovelo 85–120° | não é puxada |
| remada-alta | `goddess-pose-gentle` / `elbow-circles` | cotovelo 30–90° | yoga: não é remada |
| agachamento-halteres | `sit-back-squat` | quadril 0,695–0,948 m, deriva 0,436 m | agacha de verdade, mas **desliza 0,44 m** |
| polichinelo | `chair-jacks` / `half-jack-arms` | ombro 35–166°, abertura dos pés 0 | sentado / sem abertura de pernas |
| afundo | `low-lunge-kneeling` | assim 57,4°, quadril 0,579–0,855 m | ajoelhado, não afundo em pé |
| supino | — | — | nada deitado com barra |
| flexao | — | — | nada de flexão no chão |
| prancha | `plank-full`, `knee-plank` | quadril 0,53–0,70 m, deriva 0,69–2,27 m | prancha deslizando pelo chão |
| mountain-climber | — | — | nada no chão com joelho alternando |

Ou seja: para 8 dos 11, trocar o clipe atual por um destes seria **piorar** —
trocaria um proxy honesto por outro proxy, com nome de exercício errado. Como a
regra do projeto é "cada animação deve corresponder ao exercício", estes 8 ficam
como estão até existir mocap de força (supino, remada, flexão) ou autoria por
keyframe.

O único candidato gerado é uma melhora real e medida: troca um "fast feet"
(joelho 154–159°, praticamente parado) por uma marcha com joelho alto
(126–140°) que alterna as pernas e não desliza. Ainda não é corrida — está
marcado como candidato, não publicado.

## 3. Descontinuidade entre quadros — causa encontrada

> **Corrigido na fase 3.** A frase abaixo estava errada: aquela medição usou
> todas as 66 ossos e unidades do FBX (cm), sem escala. Medido direito — 15
> ossos mapeados, em metros, a 24 fps — o pior quadro de
> `06_Jumping_Jacks.fbx` é **0,2145 m com razão 3,6** contra a mediana dos
> vizinhos: é movimento rápido de braço, não salto. Ver
> `docs/validacao-3d/fase3/relatorio-transferencia.md` §3.

O "salto de pose" **não** é do transferidor nem da fonte do polichinelo: é do
**arquivo do iClone**, e só nas duas bordas (0,042 s e 46,067 s).

Onde a descontinuidade **não** existe: no caminho DeskBreak. `prancha-v2`
(`candidatos/prancha-v2.glb`) sai com higiene **ok**, sem salto entre quadros,
porque não há retargeting — o rig é o mesmo e a animação é reamostrada.

Conclusão prática: para ter movimento suave, a fonte tem de ser DeskBreak (ou
mocap de melhor taxa). Não há conserto de matemática que salve o FBX atual.

## 4. Mapeamento de ossos nos três formatos de rig

Bug real encontrado e corrigido: o mapa casava **nome exato**, e o pacote de
iClone usa `mixamorigHips` (sem dois-pontos). Resultado: `16_Barbell_Curl_iclone.fbx`
reprovava com `mapeamento incompleto, faltam: hips, spine, neck, …` — 100% dos
arquivos daquele pacote.

Agora o mapa vive em `tools/lib/mapeamento-ossos.mjs`, com duas passadas:
nome exato (preserva os clipes já validados do Rokoko) e nome normalizado (tira
`mixamorig:`, `Armature|`, `BIP01`, separadores e caixa).

| Rig | Antes | Depois |
| --- | --- | --- |
| Rokoko (`Hips`, `Spine4`, `LeftThigh`) | 15/15 no nome exato | 15/15 no nome exato (inalterado) |
| Mixamo GLB (`mixamorig:Hips`) | 15/15 | 15/15 (agora `spine` = `mixamorig:Spine2`, antes caía em `Spine1`) |
| iClone (`mixamorigHips`) | **0/15 — erro** | **15/15** pela normalização |
| iClone/UE5 (`pelvis`, `thigh_l`) | 15/15 | 15/15 |

Teste automático: `tests/mapeamento3d.test.mjs`, 9 testes, todos verdes.

Suíte completa: **246/246** (237 que já existiam + 9 novos), saída 0
(`metricas` 18, `forja` 110, `onboarding` 21, `plan` 110, `atlas` 13,
`paridade` 40, `demonstracoes` 17, `personagens3d` 18, `mapeamento3d` 9).

**O que ainda não funciona no iClone:** o mapeamento passa, mas o clipe gerado
sai invertido — `candidatos/rosca-biceps-mocap.glb` mede quadril 0,993 m com
**pé entre 1,601 e 1,797 m**, ou seja, pernas para cima, mais salto de pose de
0,749 m. A origem está correta (medida direto no FBX: cabeça 161,4 cm, pé 7,5 cm,
mão subindo de 87 para 138 — é rosca de verdade, 46 s, várias repetições).
Portanto o defeito está na transferência para rigs cujo repouso não é o do
Rokoko: a correção de repouso por osso (`correcaoRepouso`) foi calibrada no
Rokoko e não se sustenta aqui. É o próximo item técnico, não um item fechado.

## 5. Personagem — o que as folhas mostram

As folhas dos dois personagens (`antes/` e `antes-feminino/`) confirmam os
defeitos anatômicos apontados:

- esferas soltas junto aos pés e articulações (resíduo do `Icosphere`);
- membros finos demais para o tronco, sem volume de panturrilha/antebraço;
- silhueta de "manequim de arame": 12.960 vértices com 1 influência por vértice,
  o que produz dobras secas no quadril e no ombro;
- feminino reconhecível (ombros mais estreitos, quadril mais largo, tórax), mas
  ainda como variação de manequim, não como corpo semi-realista.

Nada disso foi alterado no catálogo: reconstruir a malha muda altura, contagem
de vértices e o `docs/assets-3d/relatorio-integracao-3d.json`, então essa etapa
vem antes de qualquer publicação e depois de o usuário aprovar o caminho.

## 6. Arquivos

Novos:

- `tools/folha-imagens-3d.mjs` — folha de imagens (6 fases × frente/perfil)
- `tools/lib/mapeamento-ossos.mjs` — mapa de ossos com duas passadas
- `tests/mapeamento3d.test.mjs` — 9 testes de mapeamento
- `docs/validacao-3d/fase2/antes/*.png` — 11 clipes atuais, masculino
- `docs/validacao-3d/fase2/antes-feminino/*.png` — os mesmos 11, feminino
- `docs/validacao-3d/fase2/depois/corrida-estacionaria-v2*.png` — candidato, 2 personagens
- `docs/validacao-3d/fase2/depois/rosca-biceps-mocap.png` — evidência do iClone invertido
- `docs/validacao-3d/fase2/candidatos/{prancha-v2,corrida-estacionaria-v2,rosca-biceps-mocap}.glb`

Alterados: `tools/retransferir-mocap.mjs` (usa a biblioteca de mapeamento;
matemática intacta), `package.json` (novo teste na suíte).

Intocados: `assets/3d/animacoes/*` (40 clipes), `assets/3d/catalogo.json`,
personagens publicados, runtime do app.
