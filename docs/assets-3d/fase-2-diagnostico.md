# Fase 2 — diagnóstico visual e plano técnico

Documento de abertura da fase 2. **Nada de novo foi publicado nesta etapa**: o
objetivo era medir, provar e propor. O código de produto (painel 3D, catálogo,
controlador, páginas) continua exatamente como na auditoria aprovada.

Baseline antes de qualquer mudança: `npm test` **237/237, saída 0**
(MÉTRICAS 18 · FORJA 110 · ONBOARDING 21 · ATLAS 13 · PARIDADE 40 ·
DEMONSTRAÇÕES 17 · PERSONAGENS 3D 18).

## Como medi

Ferramentas novas (reproduzíveis, ficam no repositório):

| Ferramenta | O que faz |
| --- | --- |
| `tools/analisar-movimentos-3d.mjs` | aplica cada clipe no esqueleto com o mesmo `AnimationMixer` do app, amostra 48 quadros e mede ângulos, alturas, contato de pé, deriva, saltos, laço, escala e NaN; compara com a assinatura esperada do exercício |
| `tools/renderizar-3d.mjs` (ampliado) | ganhou `--arquivo` (renderiza clipe fora do catálogo) e `--vista`/`--azimute` (frente, lado, 3/4) |
| `docs/assets-3d/diagnostico-movimentos.json` | resultado da análise dos 40 clipes, número por número |
| `docs/validacao-3d/fase2/*.png` | evidência visual: personagens, clipes reprovados e o colapso do mocap |

Regra que segui: **medida antes de opinião**. Toda frase abaixo tem número,
arquivo ou imagem por trás.

---

## Etapa 1 — diagnóstico

### 1.1 Anatomia e proporções dos dois personagens

Medido no GLB importado (malha com skin; o `Icosphere` solto ficou de fora).

| Medida | Masculino | Feminino |
| --- | --- | --- |
| Altura | 1,832 m | 1,692 m |
| Ombros (distância entre as juntas `armL`↔`armR`) | 0,499 m | 0,350 m |
| Largura do quadril (`legL`↔`legR`) | 0,169 m | 0,214 m |
| Coxa (`legL`) | 0,439 m | 0,405 m |
| Braço (ombro → ponta da mão) | 0,584 m | 0,448 m |
| Cabeça (alto da cabeça − base do pescoço) | 0,296 m (1/6,2 da altura) | 0,273 m (1/6,2) |
| Vértices / faces | 12.960 / 21.772 | 12.960 / 21.772 |
| Materiais | 3 | 3 |

O que isso quer dizer, sem rodeio:

1. **As proporções são de manequim de vitrine, não de atleta.** Cabeça de 1/6,2
   da altura (o padrão real fica entre 1/7,5 e 1/8), braço de 0,58 m num corpo
   de 1,83 m. Lê-se como boneco articulado — o que é honesto para um app de
   treino, mas é o teto de qualidade atual.
2. **O feminino é o corpo masculino comprimido.** Mesma topologia, mesmos
   12.960 vértices, mesma profundidade de tronco; o que muda é a escala lateral
   (ombros 0,350 m contra 0,499 m) e um pouco mais de quadril (0,214 contra
   0,169). Não há seio, cintura, escápula nem diferença de membros. Na imagem
   (`personagem-feminino-frente.png`) o resultado é um manequim andrógino mais
   estreito, não uma figura feminina.
3. **O skinning é rígido: 1 osso por vértice** (`peso_max_por_vertice: 1` nos
   dois arquivos). Cada vértice segue um único osso, então cotovelo e joelho
   "quebram" em vez de dobrar; é a razão mecânica do aspecto de tubo com esferas
   nas juntas.
4. **A malha não é fechada:** 4.050 das 34.683 arestas são de borda (11,7%).
   Funciona no painel pequeno, atrapalha em close e em sombra.
5. **Sobra um objeto no arquivo:** um `Icosphere` de 42 vértices, sem skin, em
   ambos os GLBs — resto de construção. Aparece como ponto escuro no chão nos
   renders (visível em `mocap-atual-colapso.png`).

### 1.2 Rig e articulações

O rig é o mesmo nos dois corpos: 16 ossos (`hips, spine, neck, armL/R,
elbowL/R, handL/R, legL/R, kneeL/R, footL/R, prop`), hierarquia idêntica. Isso
está **correto e é o que não se deve mexer** — é a base de um clipe servir aos
dois personagens. Limitações do rig, não do código:

- sem clavícula/escápula (ombro é uma junta só), sem dedos, sem tornozelo
  separado do pé, sem torção de antebraço;
- o osso `prop` existe para acessório (barra, halter) e é escondido com escala
  0 — correto, e o analisador aprendeu a ignorá-lo para não acusar falso
  positivo.

### 1.3 Os 40 clipes publicados, medidos

Higiene: **0 problemas** — sem NaN, sem pé abaixo do chão, sem escala de osso
animada, sem laço quebrado, sem salto de pose. Tecnicamente os 40 estão limpos.

Qualidade de movimento é outra história. **11 clipes divergem do exercício que
prometem** (10 deles já estavam marcados como aproximados; um estava marcado
como exato):

| Clipe | Status | Fonte no DeskBreak | Medido | Por que diverge |
| --- | --- | --- | --- | --- |
| `prancha` | **exact** | Plank | quadril Y 0,53–0,70 m, punho 0,24 m | quadril alto e subindo 17 cm: é cachorro olhando para baixo, não prancha isométrica |
| `flexao` | review | Plank to downward dog flow | quadril Y 0,55–0,91 m | corpo em V invertido, sem dobra de cotovelo (`133–180°`) |
| `supino` | review | **mesma fonte da flexão** | números idênticos ao `flexao` | não é supino; é o mesmo fluxo de ioga reaproveitado |
| `afundo` | review | Back step to knee drive | joelho 127–150°, quadril desce 2 cm | passada rasa, sem afundo |
| `polichinelo` | review | Step jack | abertura dos pés **0,00 m** | pernas não abrem: é "step jack" |
| `mountain-climber` | review | Standing mountain climber | joelho 129–143°, em pé | marcha em pé, sem apoio no chão |
| `corrida-estacionaria` | review | Fast feet | joelho 154–159° | passada mínima, sem elevação de joelho |
| `agachamento-halteres` | review | Wide mini squat | joelho 140–165°, desce 4 cm | meio-agachamento |
| `puxada` | review | Knee lift with pull-down | cotovelo 165–174° | braço praticamente esticado, sem puxada |
| `desenvolvimento` | review | Seated shoulder press | quadril fixo em 0,55 m, punho 1,51 m | sentado e sem passar da cabeça |
| `remada-alta` | review | Pull-aparts | cotovelo 174° | remada alta sem dobra de cotovelo |

Isso atinge **11 dos 32 exercícios** que hoje têm clipe próprio (7 de
calistenia, 4 de musculação). Os outros 29 clipes — incluindo `agachamento`,
`rosca-direta`, `elevacao-lateral`, `panturrilha`, `abdominal-supra`,
`ponte-gluteo`, `alongamentos` — medem o que prometem e **não serão tocados**.

Duas observações de produto que saem daí:

- `flexao` e `supino` apontam para **o mesmo clipe de origem**: dois exercícios
  diferentes mostrando o mesmo movimento é o pior tipo de erro, porque o usuário
  percebe na hora.
- Os clipes de solo (`prancha`, `flexao`) vêm de exercícios marcados como
  `vista: floor` no DeskBreak, mas o painel enquadra o personagem em pé. Mesmo
  quando o movimento melhorar, o enquadramento precisa acompanhar.

### 1.4 Os cinco exercícios sem clipe próprio

`cal-barra-fixa`, `cal-mergulho`, `cal-prancha-lateral`, `cal-burpee`,
`mus-leg-press` — hoje caem no clipe do grupo muscular com o selo "movimento
aproximado".

Verifiquei as duas fontes:

- **DeskBreak (`exercises.glb`, 435 animações)**: não existe barra fixa,
  mergulho, prancha lateral, burpee nem leg press. É uma biblioteca de
  mobilidade/baixo impacto — tem 20 variações de agachamento e nenhum supino.
- **Pacote de mocap (26 arquivos conferidos)**: tem supino, remada sentada,
  remada alta, elevação lateral, agachamento com halteres, afundo, polichinelo,
  salto, rosca com rotação, peck deck, panturrilha e step up — mas **também não
  tem** os cinco.

Conclusão honesta: para esses cinco não há captura pronta em nenhuma das
fontes. Ou eu **autor** o movimento (keyframe, no mesmo rig de 16 ossos) ou eles
continuam como aproximação assumida.

### 1.5 Por que o retargeting do mocap colapsa — causa encontrada

Reproduzi o pipeline publicado em cima de `06_Jumping_Jacks.fbx` (Rokoko, 61
ossos, 60 fps) e medi o resultado:

| Versão | Altura do pé (Y) | Resultado |
| --- | --- | --- |
| Pipeline atual (`tools/blender/retarget-mocap.py`) | **1,37–1,85 m** | personagem de cabeça para baixo, pernas para cima |
| Experimento desta análise (delta de rotação em mundo) | 0,08–0,22 m | personagem em pé, pés no chão, mas braços assimétricos |

A imagem `mocap-atual-colapso.png` mostra o primeiro caso: o esqueleto inteiro
invertido, pés acima do quadril. Não é "colapso a partir da fase 3" por acaso —
o defeito existe desde o primeiro quadro.

Causa raiz, em três camadas:

1. **Transferência só de direção.** O script atual pega o eixo do osso de origem
   e gira o osso de destino com `rotation_difference` até essa direção. Isso
   perde a torção e, principalmente, **não transporta a rotação relativa ao
   repouso**: cada osso é reorientado a partir da direção de repouso do destino,
   então a hierarquia desmonta.
2. **Eixo do membro inventado por sinal.** Para braços e pernas o código troca
   o eixo para `−Y` "porque o boneco ficava de cabeça para baixo". É o sintoma,
   não a causa: com o eixo trocado, os membros apontam para o lado oposto — é
   exatamente o que produz pernas acima do quadril.
3. **Nenhum alinhamento de repouso nem de guinada.** O rig de origem olha para
   um lado, o do FORJA para outro, e os repousos não coincidem (T-pose contra
   A-pose). Sem uma correção de base por osso e um ajuste de guinada da raiz, o
   movimento sai girado e assimétrico — foi o que apareceu no experimento:
   braço esquerdo à frente, direito atrás no mesmo quadro.

Falta ainda robustez: amostragem em passos de 2,5 quadros (60 → 24 fps),
quaternions sem correção de sinal (risco de interpolação pelo caminho longo) e
nenhuma validação automática antes de publicar.

Isso muda o plano: **o problema não é o pacote de mocap, é o transferidor**. E
as capturas que faltam para os clipes fracos — supino, remada, elevação lateral,
afundo, polichinelo, salto, rosca com rotação, peck deck, panturrilha, step up —
já existem no pacote.

### 1.6 O mesh feminino hoje

Resposta curta: **não existe corpo feminino**, existe o masculino escalado.
Métrica: mesma contagem de vértices e faces, mesma profundidade de tronco
(0,288 m), largura lateral 66,5% da masculina, quadril 27% mais largo que o
masculino. Sem seios, cintura, escápulas ou diferença de membros; pescoço,
cabeça e pés idênticos.

Some-se a isso o skinning rígido (1 osso por vértice) e as bordas abertas
(4.050 arestas), e o veredito é: **serve como marcador de posição, não como
personagem feminino**.

### 1.7 Proposta para o feminino (para você escolher)

Três caminhos, todos mantendo os 16 ossos, os nomes de ossos e o sistema de
animação intacto (é o que garante que o mesmo clipe serve aos dois):

**A. Refinar o paramétrico (recomendado).** Reaproveitar
`tools/blender/construir-personagens.py` e modelar de verdade o corpo feminino:
cintura marcada, quadril e glúteos, tórax com volume mamário discreto,
ombros mais estreitos com deltoide arredondado, membros com afunilamento
diferente, pescoço mais fino. Ganho grande com risco baixo, porque a topologia
e o rig continuam os mesmos.
**B. Mesh autoral novo** com a mesma topologia e o mesmo rig, feito fora do
script e importado. Permite anatomia bem melhor (inclusive rosto e mãos), mas
exige trabalho de modelagem e um passo novo no build.
**C. Mesh externo licenciado** (você fornece o arquivo e a licença). É o maior
salto de qualidade possível e o único caminho para fotorrealismo; depende de
você e de o arquivo vir com esqueleto compatível ou mapeável.

Nos três casos o mesmo pacote de melhorias de pele vale: **2 a 4 influências por
vértice** com suavização nas juntas, fechar as bordas abertas e remover o
`Icosphere`.

---

## Etapa 2 e 3 — plano técnico

Ordem por impacto, cada etapa com critério de aceite verificável. Rodo
`npm test` ao fim de cada uma e nenhuma etapa pode derrubar teste existente.

### Etapa A — um retargeter que eu consiga provar (a chave de tudo)

1. **Reescrever a transferência** em espaço de mundo com correção de repouso por
   osso: `R_destino = D_origem · R_repouso_destino`, onde
   `D_origem = R_pose_origem · R_repouso_origem⁻¹`, mais alinhamento de guinada
   da raiz e translação do quadril escalada pela razão de altura. Sem eixo
   inventado por tipo de membro.
2. **Corrigir a assimetria**: validar com um clipe simétrico (jumping jack) que
   braço esquerdo e direito descrevem o mesmo movimento espelhado; tolerância de
   5° entre lados.
3. **Prova de fidelidade (round-trip)**: pegar um clipe do DeskBreak que já
   funciona (mesmo rig de origem), passar pelo transferidor e comparar com o
   original osso a osso. Se o erro angular médio passar de 5°, o transferidor
   está errado — e eu saberei antes de olhar o mocap.
4. **Validador automático** (vira teste): pé no chão, limite articular (joelho
   não dobra ao contrário), simetria, continuidade de laço, comprimento de osso
   preservado, ausência de NaN e de escala. Clipe que reprova **não é
   publicado** — o mesmo princípio que já vale hoje.
5. **Amostragem e sinais**: reamostrar de 60 para 24 fps com interpolação
   correta e normalizar o sinal dos quaternions (evita o "giro pelo caminho
   longo").
6. Só então gerar candidatos do mocap para os 11 divergentes, um a um, com
   folha de imagens (frente + perfil, 6 fases) antes de entrar no catálogo.

Aceite: 11 clipes com movimento compatível com o exercício medido pelo
`analisar-movimentos-3d.mjs`, todos passando no validador, com imagem antes e
depois.

### Etapa B — os cinco sem fonte

1. Autorar `barra-fixa`, `mergulho`, `prancha-lateral`, `burpee` e `leg-press`
   por keyframe no rig de 16 ossos (mesmo exportador dos outros 40).
2. `barra-fixa` e `mergulho` precisam de acessório: uso o osso `prop`
   (barra/paralelas) em vez de fingir que o corpo flutua.
3. `leg-press` só entra se der para ler o movimento; senão continua aproximado e
   assumido — **não publico animação ruim para fechar número**.
4. Cada um passa pelo mesmo validador e pela mesma folha de imagens.

Aceite: cobertura de 32/37 → até 37/37, com selo honesto onde não houver.

### Etapa C — personagens

1. Skinning com 2–4 influências e suavização nas juntas; fechar bordas; remover
   o `Icosphere`.
2. Corrigir proporções do masculino (cabeça 1/7,3, braço mais longo) sem mexer
   na altura de 1,832 m que já está no catálogo.
3. Feminino conforme a opção que você escolher (A, B ou C acima), mantendo rig e
   nomes de ossos.
4. Enquadramento por clipe: clipes de solo (`prancha`, `flexao`, `burpee`)
   ganham câmera mais alta — informação já existe no catálogo (`vista`).

Aceite: os dois personagens com o mesmo rig, clipes antigos continuam abrindo
sem ajuste, e a comparação de imagem mostra ombro/cintura/quadril diferentes
entre eles.

### Etapa D — testes

- Manter os 237 atuais, sem afrouxar nenhum.
- Novos: validador de movimento (falha se um clipe publicado divergir da
  assinatura do exercício), simetria do transferidor, round-trip DeskBreak,
  qualidade de malha (influências por vértice ≥ 2 após a etapa C, zero borda
  aberta, sem objeto extra), catálogo sem clipe duplicado entre exercícios
  diferentes (o caso `flexao`/`supino` viaria teste).

---

## O que eu não vou mexer

- `window.Forja`, arquitetura multi-página, controlador de cena e painel 3D.
- Catálogo: mesmo formato, mesmos campos.
- Os 29 clipes que medem o que prometem.
- Cálculo de treino, carga, histórico, backup, calendário, Atlas 2D.
- Nenhum arquivo original é removido: clipe substituído continua no histórico do
  Git e a troca fica registrada no catálogo (`fonte`, `status`, `retarget`).

## Limitações deste diagnóstico

- Não há navegador nem GPU aqui: performance em celular continua medida só em
  bytes (como na auditoria). Validação visual é por render em CPU.
- O pacote de mocap completo (248 MB) foi apagado com o ambiente temporário;
  só os dois FBX de amostra estão no repositório. Para gerar os clipes da etapa
  A preciso baixar de novo o anexo da release.
- A assinatura de cada exercício é uma regra que **eu** escrevi a partir do
  movimento esperado. Ela é explícita no código (`ASSINATURAS` em
  `tools/analisar-movimentos-3d.mjs`) justamente para poder ser contestada.
