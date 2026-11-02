# Revisão — divergência de branch, preservação e plano de transporte

**Status: revisão concluída; nenhuma operação de integração executada.**
Não houve troca de branch, cherry-pick, merge, commit, push, renderização ou
publicação. Este documento apresenta o diagnóstico e o plano; a execução
aguarda aprovação.

## 1. Conclusão executiva

1. A divergência é de **vínculo de sessão**, não de conteúdo: esta sessão foi
   criada a partir de `main` (`73a9313`) na branch
   `arena/86860792-forja`, enquanto a branch autorizada
   `arena/0bd69e1c-forja` existe apenas no remoto, quatro commits à frente de
   `main`, e nunca foi feito checkout dela neste workspace.
2. O trabalho atual está **íntegro e não commitado**: 3 arquivos modificados e
   14 arquivos novos (13 da implementação + este documento de revisão). Não há
   commit nesta branch.
3. A branch autorizada **não contém** a camada de exercícios; ela contém quatro
   commits de interface do piloto, documentação e workflow do Drive. Portanto,
   não há colisão de arquivos: **zero caminhos em comum** entre as duas
   entregas.
4. Os três arquivos compartilhados que modificamos
   (`assets/js/forja-3d-cena.js`, `package.json`, `tools/preparar-site.sh`)
   estão **idênticos** entre `main` e a branch autorizada. O patch deve aplicar
   limpo.
5. O transporte é tecnicamente possível sem perder ou sobrescrever trabalho,
   mas **não pode ser executado nesta sessão** porque o ambiente fixa a branch
   atual e proíbe trocar, criar ou enviar para outra branch. É necessário
   re-vincular a sessão ou executar o transporte em uma sessão/worktree própria
   da branch autorizada, após aprovação.
6. A implementação de referência (`avaliacao-piloto-3d/`) e os 45 GLBs
   originais (43 animações + 2 personagens) permanecem intactos no nosso
   trabalho. A V1 passa na suíte completa; a alteração no renderizador
   compartilhado é condicional e não altera o caminho interativo.

## 2. Divergência de branch

### 2.1 Por que ocorreu

O workspace desta sessão foi inicializado em `arena/86860792-forja`, apontando
para o mesmo commit de `main` (`73a9313`). A branch indicada na tarefa,
`arena/0bd69e1c-forja`, não foi criada localmente nem checkada; ela só foi
consultada no remoto. O fetch anterior não deixou uma referência persistente;
nesta revisão ela foi buscada novamente, somente para leitura, como
`origin/ref-0bd69e1c`.

Consequência: as edições foram aplicadas sobre a árvore de `main`, não sobre a
árvore da branch autorizada. Como nenhum dos arquivos que alteramos foi tocado
pelos quatro commits da branch autorizada, o conteúdo continua transportável.

O ambiente também informa que a sessão está vinculada à branch
`arena/86860792-forja` e não permite alternar para outra. Isso é uma limitação
operacional, não uma decisão de conteúdo.

### 2.2 Relação entre as branches

| Item | `arena/86860792-forja` (atual) | `arena/0bd69e1c-forja` (autorizada) |
| --- | --- | --- |
| Onde existe | somente local | remoto `origin/ref-0bd69e1c` |
| Commit atual | `73a9313` (main) | `541f873` |
| Commits à frente de `main` | **0** | **4** |
| Arquivos alterados | 3 modificados + 14 novos, **não commitados** | 15 arquivos em 4 commits |
| PR aberto | nenhum | nenhum |
| Base comum | `73a9313` | `73a9313` |

`git rev-list --left-right --count origin/ref-0bd69e1c...HEAD` retornou
**`4  0`**: a branch autorizada tem quatro commits que a atual não tem; a atual
não tem nenhum commit que a autorizada não tenha. O histórico é linear a partir
de `main`; não há merge pendente.

O repositório é **shallow** (`.git/shallow` em `73a9313`), mas os quatro commits
da branch autorizada estão disponíveis e foram inspecionados. O transporte por
patch não depende de histórico anterior a `main`.

### 2.3 Commits e arquivos da branch autorizada

| Commit | Data (UTC) | Assunto | Arquivos principais |
| --- | --- | --- | --- |
| `18a62fc` | 2026-11-02 00:58 | `feat: simplificar interface de avaliação do piloto 3D` | `avaliacao-piloto-3d/index.html`, CSS, JS, `tests/avaliacao-piloto-3d.test.mjs`, 5 PNGs e `docs/.../versao-2/estado-e-linha-de-base.md` |
| `2e6f2be` | 2026-11-02 01:04 | `fix: recuperar reprodução do piloto após falha` | `avaliacao-piloto-3d/avaliacao-piloto-3d.js`, teste do piloto, 4 PNGs de retentativa |
| `640d8e7` | 2026-11-02 03:26 | `chore: autorizar validacao temporaria dos modelos Drive [autorizado]` | `.github/workflows/validar-modelos-drive-temporario.yml` |
| `541f873` | 2026-11-02 03:35 | `chore: autorizar validacao temporaria dos modelos Drive [autorizado]` | ajuste de 4 linhas no mesmo workflow |

Total: **15 arquivos** — 1 workflow, 3 arquivos do piloto, 9 PNGs de captura,
1 documento e 1 teste do piloto. Nenhum arquivo de exercício, manifesto,
ferramenta de loop, modelo ou animação.

### 2.4 Arquivos do trabalho atual

**Modificados (3):**

- `assets/js/forja-3d-cena.js`
- `package.json`
- `tools/preparar-site.sh`

**Novos (14, incluindo este documento de revisão; 13 são a implementação):**

- `exercicio/index.html`
- `assets/css/exercicio-3d.css`
- `assets/js/forja-exercicio-3d.js`
- `assets/js/forja-exercicio-cena.js`
- `assets/3d/apresentacao-exercicios.json`
- `assets/videos/exercicios/README.md`
- `tools/gerar-apresentacao-exercicios.mjs`
- `tools/lib/loop-3d.mjs`
- `tools/lib/probe-mp4.mjs`
- `tests/exercicio-apresentacao.test.mjs`
- `docs/validacao-3d/fase2/relatorio-apresentacao-exercicios.md`
- `docs/validacao-3d/fase2/apresentacao-cal-flexao.png`
- `docs/validacao-3d/fase2/apresentacao-polichinelo-pendente.png`
- `docs/validacao-3d/fase2/revisao-branches-e-preservacao.md` (este documento)
- (o diretório `exercicio/` contém apenas `index.html`; `assets/videos/` contém apenas o README)

### 2.5 É possível transportar sem perder ou sobrescrever?

**Sim, com alta confiança, pelos seguintes fatos verificados:**

- Interseção de caminhos entre o trabalho atual e a branch autorizada:
  **vazia**. Nenhum dos 17 caminhos atuais aparece nos 15 arquivos alterados
  pela branch autorizada.
- Os três arquivos compartilhados que modificamos estão **idênticos** entre
  `origin/ref-0bd69e1c` e `HEAD`: `git diff` vazio para
  `assets/js/forja-3d-cena.js`, `package.json` e `tools/preparar-site.sh`.
- Nenhum dos 14 caminhos novos existe na árvore da branch autorizada
  (`git cat-file -e` não encontrou nenhum).
- A branch autorizada não altera `forja-core.js`, `forja-personagens.js`,
  `assets/3d/animacoes/` nem `assets/3d/personagens/`.
- O trabalho atual não altera `avaliacao-piloto-3d/`, nem os arquivos que os
  quatro commits da branch autorizada modificam.

**Riscos que o plano precisa cobrir:**

1. O trabalho está **não commitado**. Qualquer checkout/limpeza antes de
   congelá-lo pode perder arquivos novos. O primeiro passo deve ser um snapshot
   e um patch verificável.
2. A branch autorizada mudou o **piloto** e o **teste do piloto**. O teste
   completo deve ser executado na árvore de destino, não apenas no workspace
   atual.
3. A branch atual não existe no remoto; não é possível “enviar a branch atual”
   como se fosse a autorizada. O destino correto é
   `arena/0bd69e1c-forja`.
4. Esta sessão não pode fazer checkout nem push para outra branch. O
   transporte exige re-vínculo da sessão ou uma sessão/worktree separada
   vinculada à branch autorizada.

## 3. Plano seguro de transporte (não executado)

### Opção A — recomendada: re-vincular a sessão à branch autorizada

1. **Congelar o trabalho atual** sem commit:
   - snapshot local do worktree, excluindo `node_modules`;
   - patch binário com as 3 modificações e os 14 arquivos novos, gerado com um
     índice temporário para não alterar o índice real;
   - registrar SHA-256 do patch e a lista dos 17 caminhos.
2. **Re-vincular** o workspace à `arena/0bd69e1c-forja` (`541f873`) pela
   interface/ambiente da sessão. Não criar branch nova, não fazer merge.
3. **Aplicar em dry-run** na árvore da branch autorizada:
   - `git apply --check` do patch;
   - conferir que os 15 arquivos dos quatro commits continuam idênticos;
   - conferir que só os 17 caminhos esperados aparecem.
4. **Validar na árvore de destino**:
   - `npm test` completo, incluindo o teste do piloto da branch;
   - `node tools/gerar-apresentacao-exercicios.mjs --check`;
   - `bash tools/preparar-site.sh /tmp/forja-site`;
   - smoke test no Chromium, se as dependências de browser estiverem
     disponíveis.
5. **Revisar o diff** antes de qualquer commit. Só depois de aprovação:
   - commit **somente** na `arena/0bd69e1c-forja`;
   - push **somente** para essa branch;
   - nenhum merge/push em `main`.

### Opção B — sessão/worktree separada

Se o re-vínculo não for possível, abrir uma nova sessão ou worktree já
checkoutada em `arena/0bd69e1c-forja`, aplicar o patch congelado, executar os
mesmos testes e fazer o commit/push lá. A sessão atual permanece intocada e
serve como snapshot de recuperação.

### Opção C — artefato de patch

Se nenhuma das opções anteriores for possível no ambiente, entregar o patch
binário + manifesto SHA-256 para aplicação na sessão autorizada. É transporte
por Git, não cópia manual de arquivos. O patch só deve ser aplicado após
`git apply --check` e com o snapshot preservado.

### Rollback

- Antes de aplicar: snapshot + patch + hashes.
- Durante: `git apply --check`; em caso de rejeição, nada é alterado.
- Depois: se qualquer teste falhar, `git apply -R` restaura a árvore de
  destino; o snapshot permanece disponível.
- Nunca usar `git reset --hard` ou `git clean` sobre o trabalho não commitado.

## 4. Revisão de preservação

### 4.1 Implementação de referência

No nosso trabalho, `git diff HEAD -- avaliacao-piloto-3d/` é **vazio**. Nenhuma
página, CSS, JS, mídia ou teste do piloto foi alterado por nós.

A branch autorizada, porém, **já contém** alterações próprias no piloto
(commits `18a62fc` e `2e6f2be`). Isso não é obra desta implementação; o patch
de exercícios não toca esses arquivos e não os sobrescreve. Se o requisito for
“piloto idêntico ao `main`”, a branch autorizada já não atende; se for
“piloto preservado como está na branch autorizada”, o transporte atende.

### 4.2 Alterações em `forja-3d-cena.js`

A revisão confirma que o modo de apresentação é **opt-in**:

- `modoApresentacao` tem default `false`;
- `alpha`, `antialias`, `pixelRatio`, tamanho inicial, clear color, background,
  FOV, piso, órbita e lift são condicionais a `apresentacao`;
- o enquadramento automático (`caixaDeformada`, `distanciaDeEnquadramento`,
  `enquadrarCaixa`, `enquadrarAutomatico`) só é chamado quando
  `apresentacao` é verdadeiro;
- `api.enquadrar()` retorna `false` no modo apresentação e mantém o
  comportamento original no interativo;
- listeners de ponteiro/roda, `ResizeObserver`, redimensionamento e o laço de
  30 FPS só mudam no modo apresentação; o caminho interativo continua no laço
  original;
- `piso` só é removido/descartado no modo apresentação;
- a API ganhou `modo` e `especificacao` (nulo no interativo), sem remover
  métodos existentes.

**Limite da revisão:** a suíte atual (`npm test`, código 0) valida a V1 no
nosso workspace, incluindo `personagens3d` 18/18. Ela ainda **não** foi
executada contra a árvore da branch autorizada, que tem o teste do piloto
modificado. Essa é uma etapa obrigatória do plano, não uma conclusão antecipada.

### 4.3 Modelos e animações originais

- 45 GLBs conferidos: **43 animações + 2 personagens**.
- Hash de cada arquivo no worktree comparado com o blob de `HEAD`:
  **45 iguais, 0 divergentes**.
- `git diff HEAD` para `assets/3d/animacoes` e `assets/3d/personagens`:
  **vazio**.
- A branch autorizada também não altera esses diretórios.
- Nenhum modelo, textura, material, osso ou animação foi criado, editado,
  substituído ou “corrigido”.
- A `caminhada` continua com 2,1 mm de residual na raiz `hips`; o status é
  `atenção`, sem correção automática.

### 4.4 V1

Os únicos arquivos de V1 tocados são:

- `assets/js/forja-3d-cena.js` — extensão condicional descrita acima;
- `package.json` — apenas inclusão de teste/atalho;
- `tools/preparar-site.sh` — apenas inclusão dos novos arquivos no artefato.

`forja-core.js` e `forja-personagens.js` estão idênticos a `HEAD`. Nenhuma
página V1, nenhum vídeo do piloto e nenhuma mídia original foram alterados.
`npm test` concluiu com código **0**.

## 5. Os 37 exercícios

### 5.1 14 com clipe próprio e prévia 3D

| ID | Exercício | Clipe |
| --- | --- | --- |
| `cal-rotacao-ombros` | Rotação de ombros | `rotacao-ombros` |
| `cal-mobilidade-quadril` | Mobilidade de quadril | `mobilidade-quadril` |
| `cal-flexao` | Flexão de braço | `flexao` |
| `cal-agachamento` | Agachamento livre | `agachamento` |
| `cal-ponte` | Ponte de glúteo | `ponte-gluteo` |
| `cal-prancha-frontal` | Prancha frontal | `prancha` |
| `cal-abdominal-supra` | Abdominal supra | `abdominal-supra` |
| `cal-elevacao-pernas` | Elevação de pernas | `elevacao-pernas` |
| `cal-mountain-climber` | Mountain climber | `mountain-climber` |
| `mus-mobilidade-ombro` | Mobilidade de ombro com elástico | `circulos-braco` |
| `mus-rosca-direta` | Rosca direta | `rosca-direta` |
| `mus-triceps-polia` | Tríceps na polia | `triceps` |
| `mus-flexora` | Mesa flexora | `flexao-joelho` |
| `mus-elevacao-lateral` | Elevação lateral | `elevacao-lateral` |

### 5.2 15 com clipe aguardando revisão

| ID | Exercício | Clipe em revisão | Referência |
| --- | --- | --- | --- |
| `cal-polichinelo` | Polichinelo | `polichinelo` | Step jack |
| `cal-remada-invertida` | Remada invertida | `remada-invertida` | Hinged bodyweight row |
| `cal-afundo` | Afundo alternado | `afundo` | Back step to knee drive |
| `cal-abdominal-infra` | Abdominal infra | `abdominal-infra` | Single leg lowers |
| `cal-corrida-estacionaria` | Corrida estacionária | `corrida-estacionaria` | Fast feet |
| `mus-esteira` | Esteira em ritmo leve | `caminhada` | March with overhead press |
| `mus-supino-reto` | Supino reto com barra | `supino` | Plank to downward dog flow |
| `mus-agachamento-barra` | Agachamento livre com barra | `agachamento-halteres` | Wide mini squat |
| `mus-terra` | Levantamento terra | `dobradiça-quadril` | Hip hinge |
| `mus-puxada-frontal` | Puxada frontal | `puxada` | Knee lift with pull-down |
| `mus-desenvolvimento` | Desenvolvimento com halteres | `desenvolvimento` | Seated shoulder press |
| `mus-remada-curvada` | Remada curvada com barra | `remada-sentada` | Seated rowing |
| `mus-extensora` | Cadeira extensora | `extensao-joelho` | Seated knee extension |
| `mus-abdominal-polia` | Abdominal na polia | `abdominal-cruzado` | Standing cross crunch |
| `mus-bicicleta` | Bicicleta ergométrica | `pedalar` | Seated pedaling |

### 5.3 5 sem clipe no catálogo

`cal-barra-fixa` (barra fixa), `cal-mergulho` (paralela), `cal-prancha-lateral`
(prancha lateral), `cal-burpee` (burpee) e `mus-leg-press` (leg press 45°).

Nenhum recebeu movimento inventado ou emprestado.

### 5.4 3 sem clipe exclusivo (não reutilização)

| ID | Exercício | Clipe existente | Já usado por | Decisão |
| --- | --- | --- | --- | --- |
| `mus-prancha` | Prancha frontal | `prancha` | `cal-prancha-frontal` | Pendente; não reutiliza |
| `mus-elevacao-barra` | Elevação de pernas na barra | `elevacao-pernas` | `cal-elevacao-pernas` | Pendente; movimento diferente |
| `mus-farmer` | Farmer walk | `caminhada` | `mus-esteira` | Pendente; não reutiliza |

**Total: 14 + 15 + 5 + 3 = 37.** Nenhum clipe aparece em dois exercícios no
manifesto; o gerador falha se isso acontecer.

## 6. Padrão visual

| Requisito | Situação | Evidência |
| --- | --- | --- |
| Horizontal 16:9 | **Confirmado na tela** | CSS `aspect-ratio: 16 / 9`; medição real 1,7778 (1140×641 e 370×208,125) |
| 1280 × 720 | **Confirmado no palco** | Canvas com buffer `[1280, 720]`; gerador rejeita MP4 fora dessa resolução |
| 30 FPS | **Implementado; não medido empiricamente** | Laço fixo em `1/30 s`; manifesto em 30 FPS; não há contador de quadros nem MP4 final |
| Câmera 3/4 | **Confirmado na configuração e na tela** | Azimute −58°, elevação 22°, FOV vertical 32°; mesma câmera do piloto |
| Fundo `#121010` | **Confirmado na tela** | Captura decodificada: RGB (18, 16, 16); sem piso, moldura, gradiente ou textura |
| Autoplay | **Confirmado no player com MP4 de teste** | `paused: false` após carregar; MP4 final ainda não existe |
| Loop contínuo | **Parcial** | `loop=true`; 42/43 clipes fechados matematicamente; `caminhada` 2,1 mm; validação visual do MP4 pendente |
| Mudo e inline | **Confirmado no player com MP4 de teste** | `muted`, `defaultMuted`, `playsinline`; sem áudio no gerador |
| Sem controles, pausa ou barra | **Confirmado** | `controls` ausente, `controls=false`, 0 `<button>/<select>/<input>/<progress>`, clique não pausa |
| Sem 9:16 | **Confirmado** | Nenhuma ocorrência de 9:16 no HTML/CSS; um único palco horizontal |
| Só título + demonstração | **Confirmado** | Um `<h1>` e um palco; o palco contém vídeo, prévia 3D ou mensagem de pendência |

### Manequim de 16 ossos × modelo realista de 78 ossos

- A **prévia web** usa `assets/3d/personagens/masculino.glb` /
  `feminino.glb`, rig de **16 ossos**, porque os 43 clipes web foram autorados
  para esse rig.
- O **vídeo final** deve usar os modelos originais do piloto:
  masculino **20.465.552 B**, 78 ossos e 3 texturas 4K; feminino
  **20.650.336 B**, mesmas características.
- Nenhum MP4 foi renderizado. Portanto, a preservação visual do modelo
  realista — anatomia, roupa, materiais, texturas, iluminação e tapete — **não
  foi verificada**; só será após a renderização autorizada.
- A prévia não é o vídeo final e não deve ser apresentada como tal.

## 7. Riscos e decisões pendentes

| Risco / decisão | Impacto | Recomendação |
| --- | --- | --- |
| Sessão presa à branch errada | Não é possível commitar/pushar na autorizada por aqui | Re-vincular a sessão ou usar sessão/worktree separada |
| Trabalho não commitado | Checkout/limpeza pode perder 14 novos arquivos | Congelar com snapshot + patch antes de qualquer integração |
| Branch autorizada tem piloto modificado | “Preservar o piloto” pode significar `main` ou o estado da branch | Definir a referência antes do transporte |
| Teste do piloto mudou na branch autorizada | A suíte atual não cobre essa versão | Rodar o teste completo na árvore de destino |
| 30 FPS não medido | Não há prova empírica da taxa efetiva | Medir no MP4 renderizado ou instrumentar contador de quadros |
| Loop `caminhada` 2,1 mm | Pode haver salto visual sutil | Inspeção quadro a quadro no MP4; não corrigir o original sem autorização |
| Prévia com manequim | Pode ser confundida com o vídeo final | Manter aviso explícito ou exibir só pendência até o MP4 realista |
| Sem link na Biblioteca | A tela só abre por URL direta | Adicionar link somente com autorização para tocar na V1 |

## 8. O que preciso de você

1. **Aprovar a Opção A** (re-vincular a sessão à `arena/0bd69e1c-forja`) ou a
   **Opção B** (sessão/worktree separada). Sem essa decisão, não há como
   executar o transporte dentro das regras deste ambiente.
2. Confirmar qual é a referência de preservação do piloto: o estado de `main`
   ou o estado atual da branch autorizada, que já contém os commits
   `18a62fc`/`2e6f2be`.
3. Autorizar o congelamento (snapshot + patch) e o `git apply --check` na árvore
   de destino. Ainda **não** autoriza commit/push.
4. Autorizar, em etapa separada, o commit e o push **somente** na
   `arena/0bd69e1c-forja`, depois de os testes da árvore de destino passarem.

Nenhuma dessas operações foi executada. O trabalho atual permanece como está:
3 modificados + 14 novos, sem commit, sem push, sem renderização e sem
alteração na V1, nos modelos ou nas animações.
