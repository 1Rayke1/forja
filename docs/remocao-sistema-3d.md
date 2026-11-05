# Remoção do sistema de personagens 3D — relatório

Data: 2026-11-04 · Branch: `arena/9f2d4bd7-forja` (base `0f24e7d4c59b2e7e52d9e15107faf8e0e86745e0`)
**Estado: alterações no working tree, sem commit, sem push, sem PR, sem merge, sem publicação, sem APK.**

> Correção de auditoria: a primeira versão deste relatório citava os commits
> locais `2f84005`/`697b966`. Eles foram criados e depois descartados para
> manter a entrega exatamente como pedida (nada commitado sem autorização), por
> isso não existem mais no repositório. `git rev-parse HEAD` continua em
> `0f24e7d`, igual à base — nenhum histórico foi reescrito.

## 1. Resultado em uma frase

Todo o sistema de personagens humanos e de animação 3D saiu do repositório:
arquivos, código, ferramentas, dependências, testes, workflows e referências
visuais. O que ficou é o FORJA de treinos completo, agora sem nenhuma chamada,
import, rota ou carregamento 3D.

## 2. Decisões tomadas com você

| Tema | Decisão aplicada |
| --- | --- |
| Campo `sexo` do perfil | **Mantido** como informação declarada. Removi só o contrato `resolvePersonagem`/`PERSONAGENS` e os textos que diziam que ele escolhia personagem 3D. Dados antigos e backups continuam válidos. |
| Página `exercicio/index.html` | **Mantida**, mas sem 3D: só vídeo horizontal 16:9 de pessoa real (≤ 60 s). Sem MP4 aprovado, mostra pendência explícita. Nenhuma busca no YouTube, nenhum vídeo novo, nenhum outro sistema de demonstração. |

## 3. Arquivos removidos (284 caminhos)

**Personagens, animações e dados 3D**
- `assets/3d/personagens/masculino.glb`, `feminino.glb`, `personagens.json`
- `assets/3d/animacoes/*.glb` (43 clipes)
- `assets/3d/catalogo.json`, `assets/3d/apresentacao-exercicios.json`
- `assets/vendor/three/` (three.module.min.js, three.core.min.js, GLTFLoader.js, BufferGeometryUtils.js, LICENSE, README)

**Código do app**
- `assets/js/forja-3d-cena.js` (visualizador/renderizador WebGL)
- `assets/js/forja-personagens.js` (painel, seletor de personagem, catálogo 3D)
- `assets/js/forja-exercicio-cena.js` (ponte para a cena ESM)
- `assets/js/forja-exercicio-3d.js` (controlador da tela de exercício 3D)
- `assets/css/personagens-3d.css`

**Avaliação do piloto 3D**
- `avaliacao-piloto-3d/` inteiro (index, css, js, 2 MP4 renderizados a partir do personagem 3D e 4 PNG derivados)
- `tests/avaliacao-piloto-3d.test.mjs`

**Testes exclusivos do sistema removido**
- `tests/personagens3d.test.mjs`, `tests/mapeamento3d.test.mjs`, `tests/pose-autoral3d.test.mjs`, `tests/transferencia3d.test.mjs`

**Ferramentas e fontes de geração (33 arquivos)**
- `tools/blender/` (construir-personagens, exportar-animacoes, retarget-mocap, renderizar-validacao, renderizar-validacao-3d, comparar-motores-3d, piloto-abdominal-cycles)
- `tools/lib/` (clipe-3d, loop-3d, mapeamento-ossos, pose-autoral-3d, retarget-3d, probe-mp4 — este último só servia ao gerador de MP4 dos personagens)
- `tools/fontes-3d/` (exercises.glb, 2 FBX, exercises.json, wood.png)
- `tools/`: analisar-movimentos-3d, auditar-integracao-3d, auditar-assets-3d-releases.sh, autorar-exercicios-3d, construir-assets-3d.sh, escolher-clipes-3d, extrair-clipe-3d, folha-comparativa-3d, folha-imagens-3d, gerar-apresentacao-exercicios, gerar-catalogo-3d, importar-assets-3d.sh, normalizar-assets-3d.sh, preparar-mapa-animacoes, renderizar-3d, resumir-comparacao-motores, resumir-exercises-deskbreak.py, resumir-inventario-3d.py, retransferir-mocap, validar-assets-3d.sh, consolidar-piloto-abdominal, animacoes-mapa.json, gerar-anatomia-3d.mjs, inspecionar-3d-blender.py, inspecionar-fonte-3d.mjs, gerar-glb-teste.py

**Workflows** (`.github/workflows/`): auditar-assets-3d, comparar-motores-3d, gerar-clipes-mocap, importar-assets-3d, normalizar-assets-3d, piloto-abdominal-cycles, validar-assets-3d, validar-modelos-drive-temporario, teste-recebimento-lfs

**Documentação e dados de auditoria 3D**
- `docs/validacao-3d/` (141 arquivos: renders dos personagens, candidatos GLB, relatórios das fases 2–4, piloto abdominal com vídeos)
- `docs/assets-3d/` (12 arquivos: inventários mocap/DeskBreak, relatórios de integração)
- `docs/assets-3d-git-lfs.md`

**Git LFS**
- `FORJA_ASSETS_3D/` (README + GLB de teste em LFS) e `.gitattributes` (as 8 regras de LFS existiam só para essa pasta)

## 4. Arquivos preservados (o que não foi tocado ou só sofreu limpeza pontual)

- **Catálogo e biblioteca**: `assets/js/forja-biblioteca.js` (37 exercícios: 18 calistenia + 19 musculação), `forja-catalogo.js`, `forja-atlas.js`, `forja-figura.js`, `assets/anatomia/**`, páginas `treino/biblioteca.html`, `explorar/**`.
- **Criação e edição de exercícios/rotinas**: `forja-treino.js`, `treino/rotina.html`, editor e formulários.
- **Treinos e rotinas do usuário**: `forja-plano.js`, `forja-sessao.js`, `treino/index.html`, `calistenia.html`, `musculacao.html`, `executar.html`.
- **Histórico, métricas, progresso, calendário, gráficos**: `forja-metricas.js`, `forja-progresso.js`, `forja-graficos.js`, `forja-calendario.js`, `forja-inicio.js`, `progresso/`, `index.html`.
- **Armazenamento, exportação, restauração e backups**: `forja-store.js`, `forja-backup.js`, `forja-core.js`, `forja-dados.js` (schema, migração e validação intactos).
- **Ilustrações e fotografias**: `assets/demonstracoes/**` (148 WebP + licenças + manifesto), `assets/fotografias/**`, `assets/onboarding/**`, `assets/fontes/**`.
- **Navegação e demais telas**: `forja-app.js`, `forja-ui.js`, `perfil/`, `configuracoes/`, `onboarding/`.
- **Ferramentas não relacionadas**: capturas, comparar-p13, auditoria-etapa10, gerar-fotografias, sincronizar-repdb, gerar-anatomia-referencia, `revisao-demonstracoes.html`.
- **Design e artefatos históricos**: `design/**`, `artifacts/**`, `docs/capturas/**` (capturas antigas são histórico e citam textos antigos).

## 5. Funcionalidades alteradas

1. **Tela de execução do treino** (`treino/executar.html`): removido o palco `#execution-3d` e a chamada em `forja-sessao.js`. A ilustração RepDB continua sendo a demonstração.
2. **Detalhe do exercício na biblioteca** (`forja-catalogo.js`): removido o painel 3D no topo do modal, incluindo a montagem/destruição da cena.
3. **Configurações**: removidos o seletor "Personagem das demonstrações 3D", o painel "Avaliação do Piloto 3D" e todo o bloco "Créditos e licenças dos modelos 3D". Créditos de ilustrações, fotografias e anatomia continuam.
4. **Perfil**: removidos o cartão e o atalho da Avaliação do Piloto 3D; o texto do campo `sexo` não fala mais em personagem.
5. **Onboarding**: removido o link de revisão técnica do piloto 3D; o texto do passo `sexo` virou declarativo. Perguntas, ordem e obrigatoriedade **inalteradas**.
6. **Tela de apresentação do exercício**: `forja-exercicio-3d.js` → `forja-exercicio.js`. Só mostra MP4 aprovado (16:9, 1280×720, 30 FPS, ≤ 60 s). Estados explícitos: `video`, `pendente` (sem arquivo ou fora da especificação), `erro` (sem id / não encontrado / falha de mídia).
7. **Novo contrato de vídeos**: `assets/videos/exercicios/README.md` e `assets/videos/exercicios/manifest.json` (lista vazia, sem pesquisa automática).
8. **Dados**: removidos `F.resolvePersonagem` e `F.PERSONAGENS`. Nenhuma chave de `localStorage` mudou de nome, formato ou validação; `sexo` continua aceito e validado.
9. **Build/publicação**: `tools/preparar-site.sh` não copia mais `avaliacao-piloto-3d`, exige `forja-exercicio.js` + manifesto de vídeos e falha se qualquer caminho 3D reaparecer no artefato. `package.json` sem `three`; scripts de teste 3D removidos.
10. **CSS**: `exercicio-3d.css` → `exercicio.css`, sem as regras do palco 3D (o nome do arquivo vinha do antigo sistema; o conteúdo restante é o player de vídeo 16:9).

## 6. Reauditoria (2ª rodada) — vídeos MP4

Varredura por `*.mp4`, `*.webm`, `*.mov`, `*.m4v`, `*.ogv` em todo o repositório:

| Caminho | Exercício | Origem | Pessoa real ou 3D | Situação |
|---|---|---|---|---|
| `avaliacao-piloto-3d/midia/abdominal-masculino-horizontal-16x9.mp4` | cal-abdominal-supra (piloto) | Blender 4.2.1 + Cycles CPU, personagem 3D masculino retargetado (relatório do piloto) | **Renderizado em 3D** | **REMOVIDO** nesta remoção |
| `avaliacao-piloto-3d/midia/abdominal-masculino-vertical-9x16.mp4` | cal-abdominal-supra (piloto) | idem | **Renderizado em 3D** | **REMOVIDO** |
| `docs/validacao-3d/piloto-abdominal-masculino/abdominal-masculino-horizontal-16x9.mp4` | cal-abdominal-supra (cópia idêntica, SHA-256 `785aaf53…`) | idem | **Renderizado em 3D** | **REMOVIDO** (pasta inteira) |
| `docs/validacao-3d/piloto-abdominal-masculino/abdominal-masculino-vertical-9x16.mp4` | idem (SHA-256 `1e3b12e1…`) | idem | **Renderizado em 3D** | **REMOVIDO** |

**MP4 mantidos: nenhum.** Não existe mais nenhum arquivo de vídeo no
repositório nem no artefato publicado; `assets/videos/exercicios/` contém apenas
`README.md` e `manifest.json` (lista vazia). Nenhuma fotografia, ilustração ou
imagem de pessoa real foi tocada.

### Página de execução (`treino/executar.html`)

Não há sistema de reprodução de vídeo nem vídeo antigo: zero `<video>`, zero
`*.mp4`, zero `createElement("video")` no HTML e no JS de execução. A área de
demonstração durante o treino é só a ilustração RepDB (`#execution-demo` →
`<img>`) mais a figura anatômica. O palco 3D foi removido. O único `<video>` do
repositório é o da tela de apresentação `exercicio/` (contrato de MP4
horizontal de pessoa real), que hoje está em estado de pendência porque não há
vídeo aprovado.

### Comparação E2E com a main original

| Versão | Verificações | Falhas |
|---|---|---|
| `0f24e7d` (árvore base, extraída com `git archive`) | 35/36 | "Explorar — busca e resultados inline" |
| Branch atual (após a remoção) | 35/36 | **a mesma falha** |

Confirmado: a falha é pré-existente e idêntica. `explorar/index.html` nunca teve
`#catalog-root` (a tela Explorar é de cartões com fotografias); o teste procura
um elemento da antiga SPA de página única.

### Preservação de dados (comparação byte a byte)

Cenário legado idêntico (exercícios v1, histórico, rotina, sessão ativa legada,
perfil v2, metas) executado nas duas árvores: **mesmas 8 chaves de
`localStorage`, mesma migração, mesmos valores** — a única diferença são os
carimbos de tempo de execução. `forja-store.js`, `forja-core.js`,
`forja-backup.js`, `forja-metricas.js`, `forja-treino.js`, `forja-plano.js`,
`forja-progresso.js`, `forja-biblioteca.js` e os módulos de demonstrações estão
**byte a byte idênticos** à base. Nenhuma chave mudou de nome, formato ou
validação; nada foi apagado ou migrado de forma incompatível.

Biblioteca: **37 exercícios** (18 calistenia + 19 musculação) confirmados em
execução, com demonstrações RepDB disponíveis e zero `<video>` nas telas de
catálogo.

## 6.1. Testes executados (rodada final)

| Suíte | Resultado |
| --- | --- |
| `tests/metricas.test.mjs` | 18/18 |
| `tests/forja.test.mjs` | 110/110 |
| `tests/onboarding.test.mjs` | 21/21 (atualizado: sexo não escolhe personagem) |
| `tests/plan.test.mjs` | ok (endpoint + plano local) |
| `tests/atlas.test.mjs` | 13/13 (atualizado: ATLAS 13 confere ausência do contrato) |
| `tests/paridade.test.mjs` | 40/40 |
| `tests/demonstracoes.test.mjs` | 17/17 |
| `tests/exercicio-apresentacao.test.mjs` | 7/7 (reescrito para o contrato de vídeo; teste 7 é a trava anti-3D) |
| **`npm test` total** | **219/219, exit 0** |
| `npm run test:e2e` (Chromium real) | **35/36, "Nenhum erro de JavaScript durante todo o fluxo"** |

Comparação E2E final, rodada no mesmo ambiente e no mesmo dia:

| Árvore | ✅ | ❌ | Falha |
| --- | --- | --- | --- |
| Base `0f24e7d` (main original) | 35 | 1 | Explorar — catálogo inline |
| Branch desta entrega | 35 | 1 | **a mesma** |

O conjunto de nomes de verificações das duas rodadas é idêntico (`diff` vazio),
ou seja, nenhuma verificação foi criada, removida ou renomeada pela mudança.

Cobertura do e2e nas áreas pedidas: abertura do app, navegação entre seções,
biblioteca e editor de exercício, iniciar/editar rotina, execução com cronômetro,
pausa e descanso, sessão ativa sobrevivendo a reload, finalização com histórico,
progresso (calendário, gráficos, recordes, metas), exportar/importar/desfazer em
Configurações e Perfil, preferências de som/vibração entre abas, perfil
obrigatório em 5 larguras, onboarding completo em 320 px, armazenamento local
informado em todas as páginas e demonstrações RepDB.

Verificação adicional em Chromium real (13 páginas): zero erro de console, zero
requisição 404, zero `<canvas>`/palco 3D e nenhum script 3D carregado; a página
de exercício abriu em modo `pendente` com a mensagem "Este exercício ainda não
tem vídeo de demonstração."

`bash tools/preparar-site.sh` publica 258 arquivos com todos os links relativos
OK e 148 WebP de ilustrações — o artefato publicado não tem nada do sistema 3D
e **nenhum arquivo de vídeo**.

## 6.2. Travas implementadas contra o retorno de vídeo 3D

| Trava | Como funciona | Comprovação |
| --- | --- | --- |
| `tests/exercicio-apresentacao.test.mjs` (teste 7) | O manifesto é a única fonte da verdade: **todo** arquivo de vídeo do repositório (`mp4/webm/mov/m4v/ogv`) precisa estar listado nele; todo item do manifesto precisa apontar para arquivo real, horizontal e com `duracaoS ≤ 60`; as pastas `assets/3d`, `avaliacao-piloto-3d`, `docs/validacao-3d`, `docs/assets-3d` e `FORJA_ASSETS_3D` não podem existir; os dois caminhos dos MP4 do piloto são conferidos explicitamente | Simulei um MP4 na pasta: o teste **reprovou** com "vídeo fora do manifesto de vídeos aprovados"; removido o simulado, voltou a 7/7 |
| `tools/preparar-site.sh` | Monta `assets/videos/exercicios/` no pacote a partir do manifesto e **aborta** o build se houver vídeo na pasta que não esteja aprovado, ou se o manifesto listar arquivo inexistente/maior que 60 s | Com MP4 órfão: `ERRO: vídeo não aprovado em assets/videos/exercicios` e build interrompido. Com vídeo listado no manifesto: entrou no pacote (259 arquivos) |
| `assets/videos/exercicios/README.md` | Documenta a curadoria de origem: proíbe explicitamente vídeo de Blender/Cycles, manequim, retarget de mocap, vertical ou com áudio; exige `origem` e `fonte` no manifesto | — |
| `README.md` | Seção "Proibido: vídeo renderizado a partir de personagem 3D" com a tabela das três verificações e o registro dos 4 MP4 apagados | — |

Estado atual da pasta: `README.md` + `manifest.json` com `exercicios: []` (nenhum
vídeo aprovado). Nenhum arquivo de vídeo no repositório, nenhum no pacote
publicado (`Vídeos aprovados no artefato: 0`).

## 6.3. Verificação da página de execução com ilustrações (Chromium real)

Sessão de treino real (2 séries de "Flexão de braço", `demoId`
`repdb:spiderman-push-up`), viewport 390×844:

- ilustração RepDB renderizada e decodificada: `spiderman-push-up-peak.webp`,
  `naturalWidth = 512`, com selo "Precisa de revisão" visível;
- figura anatômica visível ("Anterior · Peitoral, Ombros, Abdômen");
- **0** elementos `<video>`, **0** `<canvas>`, sem `#execution-3d`, nenhum
  script 3D carregado;
- "Concluir série" funcionou: `completedSets = {c1: 1}`, progresso "1 de 2",
  descanso de 5 s iniciado, toast de confirmação e "Pular descanso";
- **zero** erro de console e **zero** resposta HTTP ≥ 400.

## 6.4. Hash, branch e estado da entrega

| Item | Valor |
| --- | --- |
| Branch | `arena/9f2d4bd7-forja` |
| `git rev-parse HEAD` | `0f24e7d4c59b2e7e52d9e15107faf8e0e86745e0` (igual à base — nenhum commit novo) |
| Histórico | 1 revisão, intocado; nenhum rebase, amend ou force |
| Estado | **284 remoções + 21 arquivos modificados + 4 novos, tudo no working tree, sem commit** |
| Envio | nenhum push, PR, merge, publicação ou APK |

Para um commit futuro (só depois da sua autorização), o hash correspondente será
o do commit criado naquele momento — este relatório não pode antecipá-lo.

## 7. Problemas encontrados (nenhum deles introduzido por esta mudança)

1. **E2E "Explorar — busca e resultados inline"** falha em `#catalog-root`.
   `explorar/index.html` nunca teve esse elemento: a tela Explorar é de cartões
   com fotografias. O catálogo inline em `#catalog-root` era montado na antiga
   SPA de página única. Falha pré-existente, fora do escopo (não é 3D).
2. **`assets/videos/exercicios/README.md`** afirmava que 37 exercícios tinham
   prévia 3D e que os MP4 dependiam de aprovação. Reescrito para a nova direção.
3. **`.gitattributes`** só existia para LFS da pasta de modelos 3D. Removido
   porque não há mais nenhum binário em LFS no repositório.
4. **`tests/atlas.test.mjs` e `tests/onboarding.test.mjs`** validavam o contrato
   `resolvePersonagem`, que deixou de existir por decisão de produto. Foram
   ajustados para garantir o contrário: o contrato e o módulo 3D não podem
   voltar sem uma decisão explícita.
5. **Abrir `exercicio/index.html` sem `?exercicio=`** informa "Escolha um
   exercício na biblioteca" — comportamento esperado e coberto por teste.

## 8. Confirmação de que não restaram dependências do sistema 3D

Varredura final em todo o repositório (HTML, JS, CSS, JSON, MD, SH, YML, PY):

- **Zero** ocorrências de `personagens3d`, `forja-personagens`, `forja-3d-cena`,
  `forja-exercicio-cena`, `forja-exercicio-3d`, `personagens-3d.css`,
  `e3-palco-3d`, `execution-3d`, `seletor-personagem`, `avaliacao-piloto-3d`,
  `assets/3d/`, `vendor/three`, `.glb`, `.gltf`, `deskbreak`, `mocap`, `blender`
  fora das asserções negativas dos testes novos (que existem justamente para
  impedir o retorno) e dos relatórios históricos em `docs/`/`artifacts/`.
- **Zero** dependências npm 3D (`three` removido de `package.json` e
  `package-lock.json`).
- **Zero** workflows 3D; sobra apenas `static.yml` (deploy do Pages).
- **Zero** carregamentos sob demanda: não há `import()` dinâmico nem `fetch` de
  modelo/clipe. O único `fetch` novo é do manifesto de vídeos, tolerante a
  ausência.
- Nenhum asterisco de Git LFS ativo, nenhuma referência a arquivo inexistente
  (o verificador de links do `preparar-site.sh` passa).

O aplicativo está pronto para a próxima etapa: basta colocar os MP4 horizontais
aprovados (≤ 60 s) em `assets/videos/exercicios/` e listá-los no `manifest.json`
para que a tela de apresentação passe a exibi-los.
