# Helper de scroll E2E — aninhados e deadline integral

**Parecer final desta correção local: NÃO PRONTO PARA O PR #71.**

O reparo foi aplicado localmente e os testes determinísticos passaram. A validação obrigatória em Chromium e as suítes completas estão **bloqueadas por dependências locais ausentes**. Não há prova nova de prazo integral em navegador real, console zero ou estabilidade nativa ON/OFF. Não equiparar os modelos abaixo a essa homologação.

Data de referência da sessão: 2026-11-15. Branch mantida: `arena/468b7e01-forja`; HEAD `99cffc9147d72cc4eedd2eaf47310fc135815c3b`. Nenhum stage/commit/push/merge/deploy, alteração de PR, instalação, download, SQL ou operação remota. Apps conectados não foram acessados. Ao encerrar, parar.

## 1. Baseline e preservação

Esta tarefa começa **exatamente** no helper SHA-256 `251191203b1462c01d3b6108fa4b6d15b36e86eae162ba99339c75adcda7ef62`, preservado como `entry/tests/helpers/browser-interaction.mjs` no novo ZIP. O `before/` do pacote antigo, `e49c03…`, NÃO é o baseline usado aqui.

Antes de editar foram copiadas as fontes para uma área isolada, sem dependências, e registrados os 813 arquivos de entrada, seus hashes, estado Git, índice e diffs locais. Fingerprint da entrada: `e635e7166f14e9cf67b68f714b724e94c1e958c5a02a775b1f5d7d113470f1fd`.

Mantidos byte a byte os três entregáveis históricos:

- `docs/correcao-helper-scroll-e2e.md`: `9e6058e3d6ffa5a97cb014d6324faf234152eb2364b352ae33a5aa29b7c53da8`.
- `docs/evidencias-helper-scroll-e2e.json`: `e7305dfb9cde59dbda2e6c597f1c30b34b0f74a194f98c5b73f0aeaeef12a640`.
- `docs/evidencias-helper-scroll-e2e.zip`: `50eb7a29903ceff7dd192c1f9bb05f8b54f1e44fefc0b65d8d20d692c4de6615`.

Nenhum resultado daquele pacote foi reutilizado como execução desta tarefa. O RED→GREEN histórico do Auth `141f2961…` continua **NÃO VERIFICADO**; não houve download/reconstrução desse baseline.

## 2. Delta permitido

**Um arquivo de entrada alterado:** `tests/helpers/browser-interaction.mjs`.

**Oito arquivos de testes adicionados:**

- `tests/browser-interaction-chain.test.mjs`: 13 casos × capacidade modelada ON/OFF = 26.
- `tests/browser-interaction-deadline.test.mjs`: 13 retenções/limites com relógio monotônico virtual.
- `tests/browser-interaction-late-protocol.test.mjs`: 12 casos × ON/OFF modelados = 24, executando o controlador serializado real.
- `tests/helpers/scroll-dom-model.mjs`: DOM/CSSOM/eventos modelados; não é jsdom nem Chromium.
- `tests/browser-interaction-nested.browser.mjs`: 13 casos × **Blink real** ON/OFF, escritos, mas **não executados**.
- `tests/browser-interaction-protocol.browser.mjs`: seis fronteiras de protocolo × Blink ON/OFF, escritas, mas **não executadas**.
- `tests/browser-interaction-expanded.browser.mjs`: entrada separada para 40 cenários existentes + 26 aninhados + 12 de protocolo = 78 cenários nativos planejados.
- `tests/helpers/scrollend-off.mjs`: wrapper de módulo para o E2E geral OFF, sem editar o launcher; exige capacidade nativa realmente falsa se conseguir lançar.

**Quatro novos entregáveis documentais:** este MD, `docs/evidencias-helper-scroll-aninhados-deadline.json`, `.zip` e `.sha256`. O último traz o SHA do ZIP final sem criar autorreferência no pacote.

Não foram alterados Auth3, SDK oficial, launcher, package/lock, testes Auth, matriz geral, matriz original de scroll nem suas regressões anteriores. Os 812 outros arquivos da entrada permanecem idênticos.

## 3. Técnica: scrollers aninhados

1. Percorre os ancestrais e identifica todos os scroll containers relevantes, inclusive `overflow:hidden` programaticamente rolável e contêineres ainda com limite zero; inclui o documento e acompanha os dois eixos de cada um.
2. Mede origem local não rolada, bordas, viewport/client, extensões/limites, `scroll-padding`, `scroll-margin` dos contêineres e margem do alvo. Compara geometria e identidade da cadeia a cada amostra; posições de animação não são tratadas como nova geometria.
3. Replica **a cadeia**, não uma página achatada, numa referência inerte `iframe` sem scripts/URLs do app, sandbox `allow-same-origin` sem `allow-scripts`. O CSSOM escolhe `center`/`nearest` e clamps. Antes/depois confere client/extensão de cada réplica: divergência é rejeição explícita, não destino aproximado aceito silenciosamente.
4. Observa `scroll`/`scrollend` no documento para o root e diretamente nos elementos internos. Filtra alvo do evento, `isTrusted`, timestamp do pedido e último scroll; guarda posição e prova por contêiner. Não substitui fim interno pelo externo.
5. Exige destino de **todos** os contêineres, geometria/posições iguais em amostras RAF consecutivas e prova nativa de cada movimento quando disponível. OFF continua exigindo o destino completo, não uma pausa visível. Reconfere sem retarget antes do fechamento final; mudança nessa janela gera `InteractionRefusedError`.
6. Uma troca de scroller remove observadores antigos, aborta animação obsoleta na posição atual e registra a nova cadeia sem renovar prazo. Retarget sem novo deslocamento preserva o `scrollend` ainda devido e seu timestamp, em vez de dispensá-lo.
7. Mantém identidade/conexão do alvo, disabled/inert, display/opacity de ancestrais, visibility/pointer-events/checkVisibility, caixa positiva, viewport/clip dos contêineres e hit-test central. O helper nunca clica. Abort em falha usa scroll nativo instantâneo na **posição atual**, nunca o destino para produzir verde.

### Suporte explicitamente limitado

Rejeita com `UnsupportedScrollError` + `interaction.unsupported`: RTL/writing-mode não horizontal, transformações/zoom/perspectiva/filtros/clip-path, fixed/sticky, snap, `overflow:clip`, quirks, visual viewport com zoom/offset, propagação especial de overflow no body, cadeia fora do documento/mais de 128 ancestrais, geometria não finita, referência indisponível ou client/ranges que não possam ser reproduzidos. Isso é fail-closed; não significa suporte a esses casos. Layout zero/oculto aguarda recuperação, e alvo original desconectado não é substituído por clone de mesmo seletor.

## 4. Técnica: um único orçamento monotônico de 4000 ms

- `performance.now()` no início, um único deadline absoluto Node e uma única Promise de expiração para **todas** as operações: calibração somente leitura, preparação CSSOM, geometria, polling, diagnóstico, cleanup e ambos os descartes.
- Cada await disputa esse mesmo deadline e recebe apenas o restante quando a API possui timeout. O polling não começa com novos 4000 ms; retarget/cadeia/amostras não renovam orçamento.
- Comando pendente não é aguardado sem limite. As respostas tardias não retomam a sequência Node encerrada. Calibra o relógio monotônico do renderer conservadoramente (sem conceder o round-trip novamente).
- Lease absoluta dentro de cada callback mutante do renderer: trabalho até `finalAt - 64ms`, cleanup até `finalAt - 32ms`; os 32 ms finais não concedem mutação de página. É repartição dos mesmos 4000 ms, **não** aumento nem sleep. Um comando enfileirado e só executado depois encontra lease expirada/estado fechado.
- Expiração local do controlador tenta abort/remoção dentro da lease; `cleanupConfirmed`/`disposed` nunca são presumidos. Sem close reconhecido, uma falha não retorna cedo enquanto um comando ainda possa ter lease válida. Cleanup/descarte pendente termina em timeout, nunca em sucesso/clique.
- Diagnóstico possui fase, elapsed, orçamento, prova por scroller e estado de cleanup. Se não há resposta de protocolo, relata falta de confirmação em vez de aguardar diagnóstico indefinidamente.

**Alcance da prova:** os modelos observaram rejeição até 4000 ms virtuais, nenhuma continuação liberada e nenhum efeito tardio após liberar as filas. Não há medição nova equivalente em Chromium/OS. Um renderer/loop suspenso pode impedir cleanup e deixar referência/listeners/handle sem confirmação; a implementação recusa sucesso e não agenda remoção DOM após a lease. Esse cenário real e cancelamento de animações nativas ainda não foram comprovados. Não prometer hard realtime durante suspensão do processo nem considerar o impedimento integralmente homologado.

## 5. RED→GREEN real desta tarefa, com escopo correto

Os mesmos corpos finais de testes/double foram executados contra o módulo exato `251191…` e contra o final `ead9c732a5e62142ac04acecb737a2b7bbd5c1dc5b43fe0da99019b58d75f7dc`, com SHA por execução. As duas cópias tinham arquivos protegidos iguais. Logs completos/metadados e fontes ficam no ZIP; `evidence/per-case-v9.json` discrimina **cada um dos 63 casos**.

| Suíte determinística | Entrada exata | Final aplicado | Natureza |
|---|---:|---:|---|
| Cadeia de scrollers | 11/26 | **26/26** | DOM/CSSOM/eventos modelados |
| Deadline | 0/13 | **13/13** | relógio virtual/protocolo retido |
| Controlador real + protocolo tardio | 2/24 | **24/24** | controlador serializado real, DOM/tempo/protocolo modelados |

Não são 63 REDs históricos: a classificação final separa **39 transições de contrato modelado**, quatro exigências de diagnóstico Unsupported que antes já bloqueavam por timeout, um contrato de callback de controller fechado sem prova de mutação tardia da aplicação, **13 casos já aprovados na entrada** e seis casos cuja fronteira específica não existe/não é alcançada na entrada. Nesses seis não é declarado RED específico.

Exemplos das ressalvas: a entrada não tem calibração de relógio; diagnóstico no sucesso OFF é uma fronteira nova; ON pode bloquear antes de chegar à janela poll→cleanup ou ao callback pós-close. Timeout aninhado e orçamento não reiniciado no retarget já tinham proteções em parte do baseline. Sintéticos não são Chromium, e nenhum mutante novo do helper foi apresentado como fonte histórica.

### Intermediários e falhas preservados

- `v1-deadline-red`: testes iniciais, entrada exata, 0/13.
- Tentativa de montagem v2 falhou com `ValueError: substring not found` antes de gerar novo helper. O run chamado `deadline-boundary-v2` ainda exercitou a entrada, não a fronteira v2. Não usá-lo como prova v2. A execução correta foi `deadline-boundary-v2-actual`, 13/13 modelados.
- v3/v4: primeira matriz de cadeia. A primeira tentativa final v4 deu 18/24 por vazamento de objetos de fixtures no próprio double. v5 usa `structuredClone(spec)`; corpos/asserts mantidos. O baseline também foi reexecutado após a correção do double, não retroativamente declarado vermelho.
- v6/v7: snapshots por ordem de efeitos corrigiram uma asserção inválida que confundia cleanup **antes** do settlement, mas no mesmo timestamp, com mutação posterior. A prova atual compara todos os efeitos capturados no settlement com o pós-liberação; mantém também a comparação pré/pós-fila. REDs que só dependiam da comparação temporal inválida não são contados como defeitos do baseline. Hook de mudança final passou a exercer também cleanup da entrada, e cada barreira agora precisa ter sido efetivamente alcançada.
- **v8 tinha um defeito real intermediário:** nova geometria sem movimento dispensava ends retidos. Com teste novo, fonte exata `5e7d974a…` deu **25/26**, liberando ON aos 144 ms sem ambos os fins. Fonte/teste exatos em `versions/v8-added-end-proof/`. Isso é RED do intermediário, NÃO da entrada histórica. v9 preserva requisito/timestamp de fim pendente por contêiner e passou **26/26** no teste reforçado. As matrizes nativas ganharam o mesmo caso, ainda bloqueadas.
- v9 copiou/fingerprintou também scroll-margin dos contêineres e reforçou a fixture padding/margin. Fontes v1–v9 disponíveis, inclusive runs que falharam; nenhuma falha intermediária foi apagada.

## 6. Validação final nova, fonte v9 congelada

Árvore de código: 821 arquivos, fingerprint `86841997424b64519dbeb85d42ac44627847ec2cf36dab20d02f36bdf3033a70`, igual na cópia isolada e no checkout aplicado. Os três testes modelados foram reexecutados também no checkout real. Durante cada run não houve alteração de arquivos da árvore testada ou do checkout.

As dependências/Chromium anteriores não existem localmente. Nada foi instalado. A primeira nova tentativa de `npm test` passou catálogo **17/17**, mas parou ao importar `@netlify/blobs`; **não** passou a suíte completa. Auth/E2E/scroll não conseguiram importar `puppeteer-core`. As cinco novas tentativas consecutivas de concorrência pararam em `jsdom`, antes dos cenários; a componente browser também foi tentada separadamente e bloqueou em `puppeteer-core`.

| Execução nova final | Exit | Duração real do processo | Resultado |
|---|---:|---:|---|
| `v9-npm-test` | 1 | 0.516 s | **BLOQUEADO** — `@netlify/blobs` após catálogo 17/17 |
| `v9-auth-e2e` | 1 | 0.215 s | **BLOQUEADO** — `puppeteer-core`; não lançou navegador |
| `v9-scroll-original` | 1 | 0.064 s | **BLOQUEADO** — `puppeteer-core`; não lançou navegador |
| `v9-scroll-expanded` | 1 | 0.064 s | **BLOQUEADO** — `puppeteer-core`; não lançou navegador |
| `v9-nested-browser` | 1 | 0.064 s | **BLOQUEADO** — `puppeteer-core`; não lançou navegador |
| `v9-protocol-browser` | 1 | 0.064 s | **BLOQUEADO** — `puppeteer-core`; não lançou navegador |
| `v9-npm-e2e` | 1 | 0.215 s | **BLOQUEADO** — `puppeteer-core`; não lançou navegador |
| `v9-general-e2e` | 1 | 0.064 s | **BLOQUEADO** — `puppeteer-core`; não lançou navegador |
| `v9-general-e2e-off` | 1 | 0.114 s | **BLOQUEADO** — `puppeteer-core`; não lançou navegador |
| `v9-concurrency-round-1` | 1 | 0.215 s | **BLOQUEADO** — `jsdom`; nenhum cenário de concorrência |
| `v9-concurrency-round-2` | 1 | 0.215 s | **BLOQUEADO** — `jsdom`; nenhum cenário de concorrência |
| `v9-concurrency-round-3` | 1 | 0.215 s | **BLOQUEADO** — `jsdom`; nenhum cenário de concorrência |
| `v9-concurrency-round-4` | 1 | 0.215 s | **BLOQUEADO** — `jsdom`; nenhum cenário de concorrência |
| `v9-concurrency-round-5` | 1 | 0.215 s | **BLOQUEADO** — `jsdom`; nenhum cenário de concorrência |
| `v9-concurrency-browser` | 1 | 0.064 s | **BLOQUEADO** — `puppeteer-core`; não lançou navegador |
| `v9-chain-applied` | 0 | 0.265 s | **PASSOU**, só modelo |
| `v9-deadline-applied` | 0 | 0.064 s | **PASSOU**, só modelo |
| `v9-late-applied` | 0 | 0.215 s | **PASSOU**, só modelo |
| `v9-static-applied` | 0 | 3.875 s | **PASSOU**, sintaxe/AST/integridade |

As cinco linhas `v9-concurrency-round-1` a `-5` são sequenciais, sem intercalar outra suíte, mesma árvore congelada e sem alterações. São **cinco tentativas novas bloqueadas, zero rodadas verdes**. Não suprem o requisito de cinco rodadas aprovadas. Tentativas anteriores v8 e demais intermediários estão preservadas como anteriores desta tarefa, não substituem o v9 e muito menos os resultados históricos.

**Sintaxe/AST/integridade:** `node --check` em **105/105** arquivos JS/MJS/CJS; E2E geral mantém **589 asserts / 46 cenários**, com textos e ordem e arquivo inteiro idênticos. Matrizes anteriores: **38 e 66 asserts**, ambas byte-exatas. Sem novos skip/only ou erro de whitespace nos arquivos de código alterados/adicionados; `git diff --check` e `git diff --cached --check`, exit 0. Isso é evidência estática, não execução dos 46 cenários.

**ON/OFF e console:** ON/OFF nos 50 casos de cadeia/protocolo real do controlador são capacidades/eventos modelados (mais 13 de deadline). A matriz nativa codifica flag Blink e checagens por elemento, input `page.click` trusted e console zero. Não foi possível lançar Chromium: **ON/OFF reais, SOP/CORS em execução, console zero e estabilidade/clique nativos não estão comprovados nesta tarefa**. Launcher byte-exato preserva suas proteções; nenhum bypass de segurança foi introduzido. Os contadores de continuação nos doubles não são cliques DOM nem prova de input real.

## 7. Integridade do checkout e índice

- Entrada 813 arquivos; só helper alterado; outros **812 idênticos**. Oito arquivos de testes e quatro documentais novos; total esperado ao final **825**. Nenhum original excluído/renomeado.
- Auth3/SDK/launcher/package/lock/geral/matrizes históricas byte-exatos, hashes completos nos JSONs. Esses arquivos não foram reescritos para obter verde.
- Índice físico da entrada **desta tarefa** `933ebc5aab05c88b2e0b2a0e12e257762957e9023935421edf75948b1873e5b3`, conferido novamente após aplicar v9. Entradas staged, diff cached, diff tracked, HEAD e reflog idênticos à entrada.
- Não atribuir causa a diferenças físicas de índice entre sessões anteriores. A preservação física acima vale somente para o início/fim desta correção, não autentica retroativamente a auditoria.
- O helper e vários arquivos prévios já eram untracked. Portanto `git diff` sozinho não mede esse delta; a comparação integral usa manifest SHA da entrada, sem stage.

## 8. Hashes e pacote independente

| Fonte final | SHA-256 |
|---|---|
| `tests/browser-interaction-chain.test.mjs` | `a41a49b5acf697c2219f9c4a3aa6311efd651bf66442f1bb39f283e12acef3a0` |
| `tests/browser-interaction-deadline.test.mjs` | `34ac2c4d07ea819c79e45776c3cb2430a83570c49685a9be0526ac399c913611` |
| `tests/browser-interaction-late-protocol.test.mjs` | `ab0b0df47f69deccb9fa88384805339dfa470798301e39c40b82f9756bf3304a` |
| `tests/browser-interaction-nested.browser.mjs` | `e4986c9fdcd847398a4ce5e7d5ba88df18799c86fc427ef38ac484c9e53b8067` |
| `tests/browser-interaction-protocol.browser.mjs` | `9b82474ba06aa29526e7bd145b3c0cdd3de1cb5e8207fc0b3b03d45d386fe325` |
| `tests/browser-interaction-expanded.browser.mjs` | `1c4695737c51305c09d305acb3822abdc178d9d2be7ce7b254c440426f3b02b0` |
| `tests/helpers/scroll-dom-model.mjs` | `e590be5475387a7d3a24d3b6731b2403e8a46e819bf4b002ef1303a7b5910a11` |
| `tests/helpers/scrollend-off.mjs` | `60fb3ab48a429f429dbf02bd0fddbfc14b8f05839c927b1555991486515f5f06` |
| `tests/helpers/browser-interaction.mjs` | `ead9c732a5e62142ac04acecb737a2b7bbd5c1dc5b43fe0da99019b58d75f7dc` |

- `docs/evidencias-helper-scroll-aninhados-deadline.json`: resultados por execução, classificação dos 63 casos, SHA dos logs/metadados/fontes intermediárias/instrumentos e integridade.
- `docs/evidencias-helper-scroll-aninhados-deadline.zip`: baseline exato do helper, fontes finais/intermediárias, testes, instrumentos, logs brutos e evidências Git/AST. `manifest.json` e `SHA256SUMS` permitem verificar todos os payloads; CRC e hashes conferidos ao gerar.
- `docs/evidencias-helper-scroll-aninhados-deadline.sha256`: hashes do ZIP final, MD/JSON e nove arquivos de código/teste, mais índice/fingerprint em comentários. Manifestos não se auto-hasheiam; o checksum externo evita ciclo.
- Fingerprint da árvore completa, **excluindo só o próprio arquivo `.sha256`**, registrado no checksum externo. O fingerprint de código acima exclui os quatro documentos novos por definição e continua válido para as execuções.

A coerência local dos arquivos/logs é verificável. O ZIP não é assinatura/atestado externo da execução e não converte doubles em Chromium.

## 9. Reexecução sem instalar ou acessar rede

Disponíveis agora, sem dependências adicionais:

```sh
node tests/browser-interaction-chain.test.mjs
node tests/browser-interaction-deadline.test.mjs
node tests/browser-interaction-late-protocol.test.mjs
```

Com dependências e Chromium **já disponíveis localmente**, em autorização/ambiente adequados, ainda será necessário executar novamente, sem alterar asserts/prazos:

```sh
npm test
npm run test:auth:e2e
node tests/browser-interaction-expanded.browser.mjs
npm run test:e2e
node tests/e2e.browser.mjs
node --import ./tests/helpers/scrollend-off.mjs tests/e2e.browser.mjs
# Cinco rodadas novas completas e consecutivas:
npm run test:auth:concurrency
npm run test:auth:concurrency
npm run test:auth:concurrency
npm run test:auth:concurrency
npm run test:auth:concurrency
git diff --check
```

Esses comandos são pendências registradas, **não** autorização de instalação, rede, execução remota ou envio. Qualquer falha real de destino/estabilidade/deadline/cleanup nessa reexecução mantém o helper não aprovado; não aumentar os 4000 ms nem ignorar console/falhas para conseguir verde.

## 10. Encerramento

**Reparo local aplicado; aceite final não atingido.** Faltam execução nativa completa, prova integral wall-clock no ambiente de browser, console zero e cinco rodadas verdes de concorrência. Nenhum envio ao PR #71 e nenhuma operação remota. Parar após a entrega local.
