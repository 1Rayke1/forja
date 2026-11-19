# Correção das últimas corridas de Auth — PR #71, somente local

**Referência da sessão: 2026-11-15. Resultado: as duas falhas reproduzidas foram corrigidas e a matriz local final passou.** Isso **não é homologação de Google/Supabase/RLS reais, aprovação para merge ou autorização de publicação**. A limitação de logout sem nenhum storage permanece explicitamente documentada e testada.

Branch `arena/468b7e01-forja`; HEAD/base `99cffc9147d72cc4eedd2eaf47310fc135815c3b`. A entrada já continha trabalho não commitado: 804 arquivos no manifesto, 43 modificados rastreados e 31 entradas não rastreadas no status resumido. Não houve reset, troca/criação de branch, stage, commit, push, merge, deploy/retry, workflow, alteração do PR, SQL/PGlite, conta/credencial real ou mudança de configuração externa. **Nenhuma nova consulta GitHub/Supabase/Google/Netlify foi feita nesta correção.** O último estado remoto conhecido do PR era aberto/draft; não foi apresentado como uma nova consulta. Aguardar autorização antes de qualquer ação remota.

Os relatórios anteriores foram marcados como **históricos**: sua aprovação antiga não é a evidência desta correção. Resultados verificáveis desta rodada estão também em [evidencias-corridas-auth.json](evidencias-corridas-auth.json).

## 1. Refresh A antigo versus nova sessão B

**Causa raiz:** o CAS do adapter estava vinculado a `pkceWork`. Refresh comum não tinha esse trabalho. O SDK oficial verificava o storage antes de salvar, mas o `setItem` aguardava um Web Lock: B podia persistir e validar nesse intervalo, e A finalmente adquiria o lock e sobrescrevia B. Serialização não prova atualidade. O cleanup de um refresh rejeitado tinha a mesma janela para remover B.

**Correção em `assets/js/forja-auth.js`:**

- `boundedFetch` captura geração, bytes exatos do slot e sessão iniciadora **antes da requisição de refresh**. Continua recusando retry de um refresh token que já não é o persistido.
- O token opaco da resposta é usado apenas para correlacionar o ticket com a gravação pedida pelo SDK. Não é criado, rotacionado, reconstruído ou persistido por um gerenciador alternativo.
- `sdkStorage.setItem`/`removeItem` e `assertSessionMutation` revalidam geração/cancelamento, snapshot e, em PKCE, intenção, **dentro do Web Lock imediatamente antes da mutação**, sem await entre check e escrita/remoção. Refresh confere também UID e `session_id` quando disponíveis. Uma falha de refresh mantém seu cleanup vinculado ao snapshot original.
- Mesmo se B vencer **antes da chamada ao adapter**, o ticket pré-HTTP ainda identifica A. Capturar somente o storage encontrado no início de `setItem` não resolveria esse caso.
- Rotação legítima da mesma sessão continua funcionando e exige novo `getUser`; outro `session_id` do mesmo UID é uma nova entrada, não rotação de A. `session_id` limita o alcance da operação, **não verifica JWT nem autoriza acesso**.

**Sequência Chromium comprovada, com fila nativa:** barreira segura → escrita B enfileirada → segunda barreira → commit/cleanup A enfileirado → B persiste, passa por `getUser` e fica com `canWrite() === true` → liberar A → slot B permanece byte a byte idêntico, B continua autorizada e o lock fica disponível. Não há Promise artificial no storage de A nem substituição de `navigator.locks`. Notificações de A são retidas para não mascarar a lacuna.

Os três casos nativos — B de outro UID, novo `session_id` do mesmo UID e cleanup de refresh rejeitado — registram, em cada uma das cinco rodadas:

```json
{
  "bVerifiedBeforeRelease": true,
  "exactBPreserved": true,
  "staleRefreshRejected": true,
  "lockAvailable": true
}
```

O SDK oficial **2.119.0**, sua distribuição/licença e o lockfile não foram alterados. Persistência, PKCE, geração/rotação/revogação continuam a cargo do fornecedor. O cliente oficial sem persistência já existente continua isolando `getUser(jwtExplícito)` e revogação explícita; não foi criado outro sistema de Auth. Nenhum lock é retido durante HTTP/OAuth.

## 2. BroadcastChannel antigo versus intenção Google nova

**Causa raiz:** `receiveLogout` aceitava o sinal só pelo alcance UID/sessão encontrado naquele instante. Sem sessão nova ainda persistida, um sinal antigo de A passava no filtro, incrementava `epoch`, cancelava a intenção B e/ou reinstalava `SIGNED_OUT` depois de `startGoogle` tê-lo removido. O callback podia persistir B e, mesmo assim, permanecer fechado; antes de abrir OAuth, o botão podia ficar ocupado sem URL utilizável.

**Correção nas funções `startGoogle`, `init`, `receiveLogout`, `nextEpoch`, `verify`, `isVerified`, `sdkStorage` e `handleStorage`:**

1. A intenção explícita existe em memória **antes do primeiro await**, inclusive enquanto espera o primeiro lock. O callback a retoma e o commit oficial identifica a sessão que ela realmente adquiriu. O exchange oficial no mesmo documento também é reconhecido sem confundir recovery/rotação da sessão anterior com um novo login.
2. O canal de logout do app exige UID + `session_id` + nonce válido + instante finito; UID sozinho não identifica uma entrada. O instante não é usado para ordenar relógios entre abas.
3. Um sinal A durante a intenção nova impede A em memória (`retiredLogins`), mas **não cancela a geração B nem reinstala `SIGNED_OUT`**. Esses impedimentos também são conferidos na verificação e no commit, sem conceder autorização por mensagem.
4. Depois do commit, o logout da sessão **atual B** continua eficaz. A antigo, outro UID e outra sessão do mesmo UID não se confundem. Duplicadas/fora de ordem são idempotentes por identidade de sessão.
5. Eventos de storage usam o mesmo tratamento de alcance; marcadores legados persistidos continuam fail closed. Não foi enfraquecida a exigência de `getUser`.

**Conteúdo exato do canal do app:** `userId`, `sessionId`, `at`, `nonce`. Os testes conferem as quatro chaves e tipos. **Sem JWT, refresh token ou verifier.** O protocolo interno do SDK não foi substituído.

### Matriz Chromium nova

| Caso | Ordem/condição exercitada |
| --- | --- |
| 12–13 | Refresh A espera lock; B validada antes da liberação; UIDs diferentes e mesmo UID com novo `session_id` |
| 14 | Refresh legítimo mantém a geração e passa novamente por `getUser` |
| 15 | Refresh rejeitado; cleanup antigo espera lock enquanto B fica pronta |
| 16 | Sinal emitido antes do novo login, entregue antes de abrir OAuth, com setup do SDK retido por **lock nativo** e navegações reais |
| 17 | Sinal durante a intenção OAuth, antes do callback; navegação externa retida explicitamente pela fixture, callback real |
| 18 | Sinais duplicados/fora de ordem durante exchange PKCE real retido pela resposta |
| 19 | Após exchange, novo `session_id` do mesmo UID; receptor sem leitura/escrita/remoção nos dois storages durante a entrega |
| 20 | Logout legítimo A fecha a outra aba, mesmo quando a emissora não consegue usar storage e a revogação retorna 503 |
| 21 | A antigo/duplicado não fecha B pronta; sinal da própria sessão B atual fecha B |
| 22 | Duas abas/tentativas Google concorrentes; sinal antigo não vence a intenção B mais recente; callback A posterior adota B validada |
| 23 | Falha total dos dois storages + 503: bloqueio imediato, limitação no reload e saída durável depois do retry seguro |

São Chromium, storage, BroadcastChannel e SDK reais, com Google/Auth/PostgREST e identidades **fictícios**. As caixas de mensagens retêm a entrega nativa somente do canal de logout do app, não o canal oficial do SDK. Os casos 17/22 declaram a retenção de navegação; não são apresentados como prova de navegação externa real durante essa retenção. Os demais cenários de callback indicados navegam de verdade.

## 3. Storage totalmente indisponível e revogação não confirmada

`signOut` continua bloqueando memória/UI **antes de qualquer acesso a storage**, preservando dados por UID e o contexto original para um **retry exclusivo de saída**. `revalidate` não reabre A nessa aba depois de sair.

A API oficial pode devolver `{ error }` sem rejeitar a Promise. Agora `signOut` confere esse resultado; **503 não é revogação confirmada**. Se a limpeza falhar, a UI avisa que o bloqueio da aba **não garante saída após recarregar** e, se aplicável, que a revogação no servidor não foi confirmada.

**Limite físico, demonstrado sem ocultar o resultado:** quando `localStorage` e `sessionStorage` recusam get/set/remove e o servidor retorna 503, nenhum marcador/remoção consegue persistir. Depois de restaurar storage e recarregar **sem concluir o retry**, o Auth fictício ainda aceita o JWT válido e A pode ser autorizada novamente. O caso 23 afirma explicitamente esse resultado. Memória não torna durável uma escrita recusada pelo navegador.

Depois de recuperar storage, o retry usa a identidade originalmente capturada, não consulta/revoga B nova, conclui marcador/remoção e mantém a saída após reload, mesmo com 503 remoto. Se storage continuar recusado, fechar as abas e limpar a sessão do site é a orientação; não se promete uma limpeza que não ocorreu. Mesmo revogação remota bem-sucedida não garante invalidação imediata de JWT já emitido até sua expiração.

## 4. Rolagem suave e botão de detalhes

A espera fixa de **180 ms** não significava fim nem mesmo início de rolagem suave. A reprodução determinística reteve o pedido: após a espera antiga, `scrollY=0`, botão em `top=782`, `elementFromPoint` retornando `NAV` — **RED**.

Uma primeira proposta de aguardar somente um hit-test livre também se mostrou insuficiente: durante a animação, as coordenadas ainda mudavam entre localizar o alvo e enviar o clique real. O novo guard falhou antes de iniciar os 46 cenários; esse resultado não foi contado como E2E geral aprovado.

A solução final, `tests/helpers/browser-interaction.mjs::scrollToInteractable`, registra **`scrollend` antes de solicitar scroll**, cobre o caso em que nenhuma rolagem é necessária e depois exige alvo conectado, habilitado, visível, dentro do viewport e livre no hit-test. Mantém prazo de condição de 4 s, usado na suíte, **sem aumentar timeouts existentes ou trocar 180 ms por outro sleep**. O clique é real (`page.click`). A reprodução passa com `scrollY=377`, botão em `top=405` e hit em `BUTTON`.

`tests/browser-interaction.browser.mjs` mantém esse guard determinístico no início de `npm run test:e2e`. `tests/e2e.browser.mjs` preserva **os 46 cenários e todas as 589 chamadas de assert, inclusive texto e ordem**, também a asserção de botão não coberto e as do modal. CSS/scroll/design de produção não foram alterados.

## 5. Testes primeiro e RED → GREEN

Os testes iniciais foram escritos/executados **antes de alterar o Auth**, contra o SHA de entrada `141f2961b3fedc08ab4abdfe320b7ddaaf3b9001c1b7b1e7ce783aeae03cc201`:

- Unitários iniciais 12–15: **1/4**, exit 1; falham os dois refresh concorrentes e o cleanup, passa a rotação legítima.
- Matriz Chromium inicial 12–23: **5/12**, exit 1; confirma refresh sobrescrevendo B e mensagens antigas reinstalando `SIGNED_OUT`. Naquela versão do teste 19, storage ainda era legível; o teste 23 ainda não exigia o novo texto explicativo.
- O teste da mensagem ao concluir exchange foi depois reforçado com storage indisponível; o de storage passou a exigir a mensagem honesta; foram adicionados dois testes unitários da fronteira anterior à chamada ao adapter e um controle de marcador legado.

Contrafactual complementar com **os corpos finais dos mesmos testes**, SDK/lockfile iguais e runtime de entrada em cópia isolada, seguido do runtime corrigido:

| Matriz nova | Entrada original | Corrigida |
| --- | --- | --- |
| Unitários 12–18 | **2/7**, exit 1 | **7/7**, exit 0 |
| Chromium 12–23 | **3/12**, exit 1 | **12/12**, exit 0 |
| Guard de rolagem com pedido pendente | 180 ms: alvo coberto, exit 1 | `scrollend` + hit-test + clique real: exit 0 |

Não se alega que controles já corretos falhavam: na matriz final original, passam rotação legítima e marcador legado nos unitários; no Chromium, rotação legítima, logout legítimo e alcance de A antigo versus B já pronta. O código de produção nunca foi revertido no checkout; os contrafactuais usam a cópia de teste.

### Falhas intermediárias mantidas no registro

- Uma primeira montagem de fixture durante navegação externa pendente produziu timeout CDP nos casos 17/22. Foi descartada como evidência do app e corrigida retendo explicitamente a navegação nesses dois casos. Não se aumentou `protocolTimeout`.
- O primeiro `npm test` desta implementação ficou em **17/19 recovery**, exit 1 (420,993 s): o guard da intenção ainda não reconhecia exchange oficial no mesmo documento. A implementação foi ajustada; os corpos/helpers anteriores não foram enfraquecidos. Os casos 4 e 16 de recovery voltaram a passar, assim como 19/19 completos.
- A primeira execução de `test:e2e` parou no novo guard de interação, exit 1 (0,980 s), antes de executar a suíte geral. A correção foi aguardar `scrollend`, não repetir até passar com o mesmo código.

## 6. Resultados completos finais

Node **22.22.3**, npm **10.9.8**, Chromium **138.0.7204.0**. Testes em cópia sincronizada com Git real isolado, HOME/cache próprios e 169 dependências do lockfile. Nenhum fonte da cópia foi alterado durante os runners guardados (`changedDuringRun: []`). Os tempos incluem carga concorrente e não são benchmark.

| Comando/verificação | Resultado final | Tempo |
| --- | --- | --- |
| `npm test` | **498/498**, exit 0: 491 checks de entrada + 7 novos unitários | 387,517 s |
| `npm run test:auth:e2e` | **71/71**, exit 0: 29 Auth + 19 recovery + 23 concurrency | 176,856 s |
| `npm run test:e2e` | **1/1 guard + 46/46 cenários**, exit 0; 589 asserts gerais mantidos | 487,422 s |
| `npm run test:auth:concurrency`, cinco rodadas fixas | **5/5**, cada uma com **18/18 unitários + 23/23 Chromium**, exit 0 | abaixo |
| Sintaxe `node --check` | **96/96 JS/MJS**, exit 0 | — |
| Shell `bash -n tools/preparar-site.sh` | exit 0 | — |
| Guards iniciais das páginas protegidas | **15/15** presentes no head, antes do app, HTML iniciado fechado | — |
| `git diff --check` + whitespace do delta incluindo não rastreados | exit 0 / sem erros | — |
| Segurança entre duas origens locais | CORS → `TypeError`; SOP → `SecurityError`; **0 flags inseguras** | — |

Contagem de `npm test`: 495 resultados nos rodapés + os 3 checks integrados de endpoint/plano/planejamento = 498; os grupos Auth/config/recovery/concurrency já estão incluídos. Repetições não são casos diferentes. A última execução foi repetida com a árvore final de código, testes e documentos presentes (809 arquivos), após o ajuste de scroll; a execução completa verde anterior também fez 498/498 em 384,986 s.

| Rodada fixa | Unitários | Chromium | Exit | Segundos |
| --- | --- | --- | --- | --- |
| 1 | 18/18 | 23/23 | 0 | 58,682 |
| 2 | 18/18 | 23/23 | 0 | 63,227 |
| 3 | 18/18 | 23/23 | 0 | 66,564 |
| 4 | 18/18 | 23/23 | 0 | 65,117 |
| 5 | 18/18 | 23/23 | 0 | 61,223 |

Todas incluem os três cenários de refresh sob lock, todos os estágios de BroadcastChannel, controles legítimos e falha total de storage. Lote com quantidade fixada e fail-fast; **não** repetir até obter verde. Chromium manteve segurança web/isolamento, sem `--disable-web-security` ou desativação de site isolation. `--no-sandbox` do ambiente não foi tratado como desativação de SOP/CORS.

## 7. Arquivos e preservação

| Arquivo(s) | Alteração desta etapa |
| --- | --- |
| `assets/js/forja-auth.js` | Fences de refresh/cleanup, intenção versus mensagem antiga, impedimentos em memória, informação honesta sobre revogação/storage |
| `tests/auth-concurrency.test.mjs` | 7 unitários novos; os 11 anteriores preservados |
| `tests/auth-concurrency.browser.mjs` | 12 cenários novos; os 11 anteriores preservados |
| `tests/helpers/auth-lifecycle.mjs` | Caixas de entrega, observadores síncronos e coordenador de lock nativo, somente teste |
| `tests/helpers/browser-interaction.mjs`, `tests/browser-interaction.browser.mjs` | Sincronização por evento/estado e guard determinístico |
| `tests/e2e.browser.mjs`, `package.json` | Usar sincronização e clique real; executar guard antes dos 46 cenários |
| `docs/autenticacao-google.md` | Contratos atuais de refresh, mensagem, storage e comandos |
| Quatro relatórios anteriores | Sinalização de histórico, sem usar aprovação antiga como parecer atual |
| Este relatório e `evidencias-corridas-auth.json` | Evidências e limites novos |

A comparação AST com a entrada examinou **28 arquivos de teste**: 587 → 605 callbacks estáticos nas suítes anteriores, **nenhum removido**; 586 antigos byte a byte iguais, um único corpo geral alterado para sincronizar o scroll/clique. As **589 chamadas de assert e sua ordem são idênticas** na suíte geral. Nenhum `skip`/`only` novo. Os 22 casos antigos de concorrência mantêm seus corpos. Callbacks estáticos não são contagens de casos de runtime.

Permanecem preservados os testes e as correções anteriores de PKCE/`flowId`/CAS, cenário 29 e 403 antigo A sem apagar B, logout após rotação, Admin 503/retry idempotente com credencial adicional, cancelamento/limite de 12 s para corpo HTTP, segregação por UID, migração/cópia inicial/backup/recuperação, guard das 15 páginas e login exclusivo por Google. SDK/licença, lockfile, Functions, workflow, Netlify, HTML/CSS de produção e módulos de dados/admin não foram alterados nesta etapa.

Hashes SHA-256 centrais:

```text
Auth entrada: 141f2961b3fedc08ab4abdfe320b7ddaaf3b9001c1b7b1e7ce783aeae03cc201
Auth final:   ebc0716a7dfaec4266113460ded8764402652b4a048df41710f139f8a1843ef8
SDK oficial:  a867edbcfb029370aeec7223dd6180b560b621fbe3bc64c6584fb0369d1b7bce
Lockfile:     b490e9738f8c589f3e84700468a0d49f78a9cbfe38abf0c1282d135951f49cd6
Índice Git:   2779024fc80dd12ec7599e243ea254aa4d38144a394cfce2b2146fd1f8f712dc
```

O índice e suas entradas staged, HEAD e branch permanecem iguais à entrada. O manifesto final não remove nenhum dos 804 arquivos anteriores; o delta permitido e os hashes centrais constam do JSON de evidências. Logs completos, matrizes e instrumentos estão na área local `/tmp/forja-last-races-pl0g62au`; uma cópia redigida segue a convenção ignorada `.cache/correcao-concorrencia-auth/`. Esse cache é auxiliar e pode não persistir entre ambientes: os resultados essenciais estão neste relatório e no JSON, não dependem de `/tmp`/cache.

## 8. Limites e próximo passo

- Google/consentimento, configuração real de redirect/provider, JWT/RLS/PostgREST reais, Safari e aparelho físico continuam **sem homologação**. Mobile/BFCache emulados não substituem esses testes.
- OAuth real pode iniciar a cópia inicial em `user_data_imports`; não executar sem autorização e definição de ambiente/dados ou bloqueio externo apropriado de chamadas de dados. Nenhum SQL foi usado.
- As não conformidades backend fora de escopo (autorização/JWT das Functions, isolamento de previews/Blobs, CORS das APIs e quotas de IA/YouTube) não foram corrigidas nem aprovadas aqui. O log original do deploy falho continua pendente; não foi tentado novo deploy nem atribuída causa sem prova.
- Resultado local verde **não elimina** o limite de saída após reload quando ambos os storages e a revogação falham.

**Entrega exclusivamente local concluída. PR remoto não alterado; nenhuma publicação. Aguardar autorização.**
