# Auditoria da demonstração 3D — as 9 perguntas

Este documento responde, uma a uma, às nove perguntas da auditoria que abriu o
trabalho. Regra da casa: **nada aqui é estimativa**. Cada número sai de arquivo
em disco ou de teste que roda; quando algo não pôde ser medido neste ambiente,
está escrito que não pôde.

Evidência bruta: `docs/assets-3d/relatorio-integracao-3d.json`, gerado por
`node tools/auditar-integracao-3d.mjs` (sai com código 1 se o catálogo apontar
para arquivo inexistente). Imagens: `docs/validacao-3d/` (16 PNGs).

---

## 1. O 3D desta entrega é real ou é uma simulação?

Real, renderizado no navegador com three.js 0.180.0 e `AnimationMixer` de
verdade. O que existe fisicamente no repositório:

| Item | Realidade |
| --- | --- |
| Personagens | 2 arquivos GLB em `assets/3d/personagens/` — `masculino.glb` (860 KB) e `feminino.glb` (872 KB), 16 ossos, 12.960 vértices, 21.772 polígonos cada |
| Clipes | 40 GLB em `assets/3d/animacoes/`, 897 KB somados, 122,7 s de animação |
| Catálogo | `assets/3d/catalogo.json` — 40 clipes, 2 personagens, **0 indisponíveis** |
| Render | `assets/js/forja-3d-cena.js` (cena, luz, câmera, mixer, crossfade) e `assets/js/forja-personagens.js` (painel, resolução de clipe, selo, degradação) |
| Prova visual | 16 PNGs em `docs/validacao-3d/`, 2 personagens × 8 clipes, gerados por `tools/renderizar-3d.mjs` fora do navegador |

O que **não** é 3D: a figura anatômica 2D do Atlas (`forja-figura.js`) continua
sendo SVG e não foi substituída — ela resolve outra coisa (mapa muscular) e o
painel 3D não a sobrepõe. Nenhuma imagem 3D "de mentira" é usada como se fosse
modelo: não há captura de tela fingindo ser WebGL.

## 2. De onde vêm os modelos e o rig? Qual é a licença?

Os dois personagens são **construídos por script** em
`tools/blender/construir-personagens.py`: malha paramétrica (12.960 vértices,
21.772 polígonos, 3 materiais) e o **mesmo rig de 16 ossos** nos dois, com
nomes idênticos entre masculino e feminino — é isso que permite um único
controlador e um único conjunto de clipes.

- Masculino: 1,832 m, ombros 0,641 m.
- Feminino: 1,692 m, ombros 0,416 m.
- Nada de mesh de terceiros nessa etapa: nenhum asset de marketplace, nenhum
  download, portanto nenhuma licença de terceiro a cumprir nos personagens.
- O selo de origem e a licença de cada peça ficam visíveis em
  `configuracoes/index.html#creditos-3d`, com link para o texto da licença
  servido pelo próprio app.

**Pendência do seu lado:** se você tem um mesh escaneado/licenciado (o caso do
feminino), ele entra no lugar sem mexer em código — só precisa respeitar o rig
de 16 ossos ou vir com mapeamento declarado. Enquanto isso não chega, os dois
personagens são os paramétricos acima, e isso está dito na interface.

## 3. De onde vêm as animações? Foram retargetadas?

**Não houve retargeting publicado.** As 40 animações são exportadas das ações
que já vêm no pacote **DeskBreak** (release anexada por você), que usa um rig
compatível. `tools/animacoes-mapa.json` liga cada clipe à ação de origem, com
`fonte: "deskbreak"` nas 40 entradas, e `tools/blender/exportar-animacoes.py`
faz a exportação para GLB.

| Situação | Clipes |
| --- | --- |
| Clipe próprio do exercício (exato) | 18 |
| Clipe do mesmo grupo muscular (aproximado, com selo "Movimento aproximado" na tela) | 22 |
| Retargetados de mocap | **0** |

Sobre o pacote de mocap (`Mocap_Pack_06_Fitness_and_Workout.zip`, 237 MiB): foi
aberto e amostrado — 26 arquivos inspecionados (22 `Rokoko_Default`, 2 `_ue5`,
2 `_iclone`). O pipeline de retargeting existe
(`tools/blender/retarget-mocap.py`) e foi executado, mas as poses colapsam a
partir da fase 3 do clipe de 6 s. **Não publico animação que não passa na
validação de pose só para dizer que tem mocap.** O script fica no repositório
como experimento, marcado como tal, e a licença do pacote de mocap continua
sendo uma pergunta sua — sem ela, nada desse pacote vai para o app.

## 4. Como se garante que o clipe é compatível com o esqueleto?

Por teste, não por confiança no nome do arquivo:

- `tests/personagens3d.test.mjs` **13** percorre todos os clipes publicados e
  compara osso a osso com o rig — qualquer faixa apontando para osso
  inexistente derruba o teste.
- **14** roda o `AnimationMixer` e confere que o esqueleto **se move de fato**
  (posição dos ossos muda ao longo do tempo); um clipe que carrega mas não
  anima não passa.
- **15** faz sanidade de pose em todos os clipes (sem colapso, sem membro
  atravessando o corpo, amplitude dentro do plausível).
- **12** confirma que os dois personagens abrem com o mesmo rig de 16 ossos.
- `tools/auditar-integracao-3d.mjs` repete a checagem contra o disco e falha se
  o catálogo citar arquivo que não existe.

Um clipe só entra no catálogo depois de passar por isso. Nome bonito nunca foi
critério.

## 5. Como o personagem é escolhido? A escolha de gênero é obrigatória?

A pergunta existe e é **obrigatória para avançar**, mas com saída honesta: as
três opções são "Masculino", "Feminino" e **"Prefiro não informar"** — nenhuma
vem pré-selecionada (`assets/js/forja-onboarding.js`, passo `sexo`,
`obrigatorio: true`, sem `padrao`). Quem escolhe "prefiro não informar" usa o
app inteiro normalmente, só sem personagem nas demonstrações.

- A escolha vira `profile.sexo` e é lida por `F.resolvePersonagem`; **não**
  entra em cálculo de fisiologia, carga, meta ou plano — é só qual GLB abrir.
- Trocar depois em Perfil/Configurações não apaga histórico, rotina nem
  medida; o painel 3D aberto se remonta sozinho com o outro personagem
  (teste **11**).
- A pergunta **não** aparece no meio do treino: durante a execução, sem
  personagem escolhido, o painel fica escondido e o app segue (teste novo desta
  entrega). A escolha mora na biblioteca, no detalhe do exercício e nas
  configurações.
- **17** garante que a escolha do Perfil chega ao painel 3D e **16** que a tela
  de execução mostra o painel do exercício certo.

## 6. Um controlador só? Sem bundler? Serve no GitHub Pages?

- **Um controlador compartilhado:** `forja-3d-cena.js` expõe
  `criarCena()`, `modeloCarregado`, `clipeCarregado`, `webglDisponivel`,
  `reamarrarFaixas`; quem consome é sempre `forja-personagens.js`. As três
  páginas que mostram 3D (`treino/biblioteca.html`, `treino/executar.html`,
  `configuracoes/index.html`) usam o mesmo módulo — não existe segunda cena.
- **Sem bundler:** three.js está vendorizado em `assets/vendor/three/` como
  módulos ES (`three.module.min.js`, `three.core.min.js`, `GLTFLoader`,
  `BufferGeometryUtils`), importados por caminho relativo. Teste **18** valida
  o grafo de módulos sem passo de build.
- **Pages:** tudo é estático e servido do próprio site; nada de CDN, nada de
  URL temporária, nada de Git LFS no caminho publicado (o LFS continua restrito
  a `FORJA_ASSETS_3D/`, e `assets/3d/` é commit normal). O app já publicava
  assim e continua.
- `window.Forja` e a arquitetura multi-página estática seguem intactos.

## 7. Quanto pesa e o que acontece num Android médio?

Números medidos em disco:

| Momento | Bytes |
| --- | --- |
| Runtime 3D completo (three + addons + ponte + CSS) | 903 KB (three.js 77 KB gzip) |
| Primeira demonstração: three 850 KB + ponte 44 KB + personagem 860 KB + clipe 22 KB | **≈ 1.777 KB** |
| Personagem trocado depois | +860 KB (só o GLB novo) |
| Cada exercício novo, mesmo personagem | +22 KB (só o clipe) |

O que o código faz para segurar isso:

- three.js e a cena só carregam quando o painel 3D é realmente montado
  (`import()` dinâmico) — abrir a biblioteca sem abrir demonstração não baixa
  nada de 3D.
- Carrega **um** personagem, o do perfil. Nunca os dois.
- Carrega **um** clipe, o do exercício. Nunca os 40.
- Trocar de exercício reaproveita a cena viva e só faz crossfade do clipe; o
  `WebGLRenderer` não é recriado (é o que mantém a troca instantânea).
- Sem WebGL, com `import` quebrado ou com catálogo incompleto, o painel avisa e
  a página continua funcionando (testes **9** e **10**).

**O que não pude medir:** FPS, tempo de primeira pintura e memória de GPU num
Android real. Este ambiente não tem navegador nem GPU — só Node. Então entrego
bytes e caminho de carregamento, não prometo "60 fps". Para medir de verdade:
abra `treino/biblioteca.html` no celular, toque em "Ver demonstração 3D" e
acompanhe a aba Performance do Chrome remoto. Se aparecer travamento, os
suspeitos já estão isolados (sombra, DPR, número de luzes) nas opções de
`criarCena`.

## 8. Que testes cobrem isso e o que eles provam?

`npm test` saiu **verde por inteiro**:

| Suíte | Resultado |
| --- | --- |
| MÉTRICAS | 18/18 |
| FORJA | 110/110 |
| ONBOARDING | 21/21 |
| ATLAS | 13/13 |
| PARIDADE | 40/40 |
| DEMONSTRAÇÕES | 17/17 |
| PERSONAGENS 3D | 18/18 |
| **Total** | **237/237, código de saída 0** |

Os 18 de `tests/personagens3d.test.mjs` cobrem, em ordem: catálogo publicado
sem arquivo fantasma, exercício com clipe próprio resolvendo exato, exercício
sem clipe caindo no grupo muscular como aproximado, exercício sem classificação
caindo na pose base, ausência de WebGL avisando sem exceção, catálogo
incompleto degradando com mensagem, troca de personagem remontando o painel
aberto, os dois rigs com os mesmos 16 ossos, clipe casando osso a osso,
`AnimationMixer` movendo o esqueleto, sanidade de pose em todos os clipes,
painel aparecendo na execução, escolha do Perfil chegando ao painel e o grafo
de módulos funcionando sem bundler.

Para chegar nesse verde, dois testes antigos precisaram de correção — nenhum
por "afrouxar" a regra:

- `tests/atlas.test.mjs` verificava o link do Atlas no HTML cru do hub, mas o
  hub é renderizado por JS: agora o link é conferido no DOM final.
- `tests/paridade.test.mjs` acusava ids "inexistentes" que o próprio módulo
  cria via JS (`#foco-treino`, `#recursos-grade`…): o verificador passou a
  considerar ids criados pelo módulo antes de dar erro.

E um bug real foi corrigido de verdade: `explorar/index.html` carregava
`forja-calendario.js` sem ter o calendário no DOM, e o listener em nó nulo
derrubava o script naquela página. A correção foi tirar o script de lá — sem
tocar no código do calendário, cujo hash continua idêntico ao da `main`.

## 9. O que ficou em falta? Onde ainda posso te decepcionar?

Sem maquiagem:

1. **5 exercícios da biblioteca sem clipe próprio** (caem no grupo muscular):
   barra fixa, mergulho, prancha lateral, burpee, leg press. São **32/37
   (86,5 %)** com clipe dedicado.
2. **22 clipes são aproximados**, não a execução exata do exercício. A tela
   diz isso com o selo "Movimento aproximado" — não escondo no rodapé.
3. **Mocap não entrou.** A retargetagem colapsa; publicar seria pior que não
   publicar.
4. **Performance em Android real não foi medida aqui** (sem navegador/GPU). O
   relatório entrega bytes e ordem de carregamento; a medição de FPS é sua.
5. **Licença do pacote de mocap e o mesh feminino definitivo** dependem de você.
   Nada do pacote de mocap vai para o app antes da licença.
6. **FORJA preservado**, e não é promessa vazia: 110/110 na suíte FORJA, 40/40
   em paridade, calendário com hash da `main`, nenhuma mudança em cálculo de
   treino, carga, histórico ou backup. O 3D é uma camada por cima — quando ele
   não pode aparecer, a demonstração ilustrada de antes assume.
