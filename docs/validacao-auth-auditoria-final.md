# Registro histórico — auditoria local anterior de Auth / PR #71

> **Registro histórico, não parecer atual.** A auditoria readonly posterior a esta entrega encontrou duas corridas bloqueadoras (refresh antigo × nova sessão e BroadcastChannel antigo × nova intenção Google). A correção local autorizada, seus novos RED→GREEN, resultados e limites estão em [Correção das últimas corridas de Auth](correcao-concorrencia-auth.md). Os números e aprovações abaixo pertencem à rodada anterior; não autorizam merge, publicação ou homologação remota.

**Data de referência da sessão: 2026-11-15. Resultado: correções e regressões locais aprovadas.** Google/Supabase/RLS reais permanecem **pendentes de homologação**. Este documento não autoriza publicação.

Branch fixa `arena/468b7e01-forja`; HEAD/base local `99cffc9147d72cc4eedd2eaf47310fc135815c3b`. O trabalho anterior foi preservado. **Sem stage, commit, push, merge, deploy/retry, workflow, preview remoto, alteração do PR remoto, SQL ou mudanças em dados, RLS, painéis e configurações externas.** O PR #71 deve continuar aberto e draft; seu último head remoto observado era `15c531e0b6a6a209c548cfa172b9ee313188c9ef`, sem nova consulta de estado nesta implementação.

Esta era a conclusão daquela rodada, superada pelo registro atual indicado acima. Os relatórios [da entrega original](entrega-google-auth.md) e [das correções anteriores](validacao-login-google.md) continuam preservados como histórico. Evidências, comandos, hashes e limitações estão no [registro desta rodada](evidencias-auth-final.md).

## 1. Causas raiz e correções

### 1.1 Logout com storage indisponível

**Causa:** `signOut()` calculava `ownsSession` chamando `storedToken()` antes de desabilitar a autorização. Um `SecurityError` em `getItem` podia interromper a função com DOM ainda aberto. Falhas de gravação/remoção também não tinham uma recuperação de saída utilizável. O botão de Configurações era desabilitado sem `finally`.

**Correção:** em `forja-auth.js::signOut`, o snapshot inicial usa somente memória. Antes de qualquer storage, o código desabilita autorização, cancela/invalida a geração, limpa usuário/sessão em memória e fecha o gate. Leituras, marcadores e remoção persistida são tratados separadamente; a remoção é condicional sob Web Lock curto. Nenhuma falha reabilita `revalidate()` ou restaura a sessão encerrada.

- Limpeza incompleta mantém a interface fechada, com orientação e **retry exclusivo de saída** (`logoutPending`/`logoutContext`), não retry de autenticação.
- A identidade original é preservada para que o retry não passe a encerrar uma conta nova.
- `forja-configuracoes.js::initSettings` aguarda o logout e restaura o botão em `finally`.
- Um canal de logout separado do protocolo do SDK envia somente UID, `session_id`, instante e nonce. Isso permite fechar outra aba já aberta mesmo quando a aba que sai não consegue gravar o marcador.

**Comprovado localmente:** `SecurityError` em `getItem`, `setItem` e `removeItem`, individualmente e em conjunto; gate fechado antes do primeiro acesso recusado; `isVerified`/`canWrite` falsos; botão restaurado; dados por UID intactos; retry termina a limpeza; revalidação/reload não reabrem a conta encerrada nos cenários testados. O teste de falha total confere também os campos do sinal cross-tab e a ausência de tokens.

Se o navegador não permite persistir a saída, **não é possível prometer limpeza durável em armazenamento que ele recusa**. A aba permanece fechada e informa a pendência; feche as abas/limpe a sessão do site ou conclua o retry após recuperar o storage. Falha de revogação remota também não é prova de invalidação imediata de JWTs já emitidos.

### 1.2 PKCE A antigo versus login B posterior

**Causa:** conferir `epoch` somente depois de `exchangeCodeForSession()` era tarde: o SDK oficial já persistia a sessão antes de devolver a Promise. Eventos `storage`/BroadcastChannel não são uma barreira de commit. O uso do verifier legado compartilhado também permitia que um erro de A limpasse o verifier de B. Há ainda um intervalo assíncrono entre a leitura/comparação do verifier e sua remoção pelo SDK.

**Correção, mantendo o SDK oficial 2.119.0 intacto:**

1. `startGoogle` registra a intenção OAuth global e o **`flowId` público retornado pelo SDK** na tentativa da aba. O callback passa esse seletor a `exchangeCodeForSession`; não toma emprestado o verifier legado de outra tentativa. `redirectTo` e allowlists não foram alterados.
2. `init`, `nextEpoch`, eventos de Auth e `handleStorage` vinculam o exchange a geração/intenção/snapshot, cancelando trabalho obsoleto.
3. `sdkStorage` usa o ponto de extensão oficial **SupportedStorage**. Sob `mutateSession`, um Web Lock de curtíssima duração protege a checagem e a mutação de storage. O commit da sessão só é aceito enquanto geração, intenção e bytes observados continuam atuais. A checagem acontece **antes da escrita do SDK**, não apenas após o retorno HTTP.
4. Nas duas chaves PKCE compartilhadas, um compare-and-swap de bytes opacos impede cleanup/escrita derivados de leitura antiga de apagar o verifier/índice recém-gravado. O SDK continua gerando, selecionando e limpando seus próprios verifiers/slots.

**Sequência comprovada:** exchange A já pendente → B conclui Google/PKCE, valida a própria identidade e persiste a sessão → resposta A é liberada → sessão B permanece exatamente a mesma, válida e utilizável. A prova retém as notificações de A: o resultado não depende de elas chegarem a tempo. Outros casos cobrem erro A com verifier B pendente e callback A que só chega depois do login B.

O caso unitário 5 também pausa o cleanup **depois da leitura** do verifier por A, deixa B gravar e só então retoma a remoção. Um controle negativo retirando somente o CAS reproduz a perda; com CAS, B conclui o login. A instrumentação de teste retém uma leitura da interface assíncrona de storage; não substitui o SDK.

Os locks nunca ficam retidos durante HTTP/OAuth. Novo login exige Web Locks em contexto seguro; sem suporte, a operação coordenada falha fechada com orientação. Persistência, PKCE, criação e rotação de tokens continuam a cargo do fornecedor; não há SDK editado, Auth REST artesanal ou gerenciador paralelo de tokens.

### 1.3 Logout após rotação de A

**Causa:** igualdade exata com o JWT anteriormente verificado deixava de reconhecer A quando o SDK já havia persistido a rotação e a UI/revalidação ainda não a observara. `ownsSession` ficava falso; uma revogação 503 deixava a sessão rotacionada persistida. Tratar simplesmente todo token do mesmo UID como A, por outro lado, encerraria um novo login posterior desse mesmo usuário.

**Correção:** `loginIdentity`/`sameLogin` distinguem **rotação da mesma sessão** de **novo login**, usando UID + `session_id`, com igualdade exata de token como fallback conservador. A decodificação desse identificador **não verifica assinatura nem autoriza a interface**; isso continua dependendo de `getUser`.

- O logout bloqueia primeiro e captura, antes dos awaits, o JWT efetivamente persistido da mesma geração. A remoção reconfere a identidade dentro do lock.
- `TOKEN_REFRESHED` pode atualizar o snapshot da mesma sessão, mas não dispensa invalidação/revalidação autoritativa.
- A revogação continua pela API **oficial** `verifier.auth.admin.signOut(jwtCapturado, "local")`, com chave pública e JWT do usuário explícito. Não consulta `getSession`/`signOut` do cliente persistente nem usa credencial privilegiada.
- Marcadores/eventos são limitados por identidade e geração; B e um novo login do mesmo UID, com outro `session_id`, são preservados.

**Comprovado localmente:** refresh real do SDK → logout imediato → requisição de revogação realmente executada, com o JWT rotacionado correto → resposta 503 → acesso local fechado na aba, na outra aba e após reload. Há também clique de UI com notificações retidas e proteção de B/novo `session_id`. Esses cenários são ordens determinísticas de teste, não alegação de reprodução espontânea em cliques humanos ou de revogação remota bem-sucedida com 503.

### 1.4 Cenário 29 / sincronização da fixture

**Causa:** os atrasos de 300/350 ms não provavam que B havia concluído validação/persistência antes do `session_not_found` de A. A troca de UID também podia navegar antes de o CDP receber o resultado de `setSession`, destruindo o contexto que o teste aguardava.

**Correção em `tests/auth.browser.mjs`:** capturar a resposta 403 de A e retê-la em barreira explícita; reter somente navegações do app durante a fase concorrente; aguardar B verificada e os **access/refresh tokens exatos persistidos**; só então liberar A, aguardar sua operação e retomar as navegações reais. Os documentos finais devem estar prontos como B, renderizar seu namespace e não ter enviado logout remoto. Não há janela arbitrária de 300 ms.

`tests/helpers/browser-auth.mjs::browserSetSession` ganhou apenas diagnóstico de `name/code/status`. A recuperação já existente para destruição de contexto continua exigindo commit exato **e** verificação independente no novo documento. Erros normais não são ocultados; não há retry de `setSession`, aumento de timeout, `skip` ou remoção de asserts.

**Repetibilidade:** 5/5 execuções isoladas consecutivas e sucesso nas 4 execuções completas de Auth. Os lotes tinham número fixo de rodadas e falhavam na primeira reprovação; não foi usado “repetir até passar”.

## 2. RED → GREEN e correções anteriores preservadas

Dois contrafactuais, com o mesmo lockfile/SDK e os mesmos testes novos:

| Runtime | Novos unitários | Novos Chromium | Interpretação |
| --- | --- | --- | --- |
| Pré-correção desta rodada, mantendo as correções anteriores | **3/11**, exit 1 | **2/11**, exit 1 | Unitários falham em 1–5, 7, 8, 11; Chromium em 1–8, 11 |
| Quatro módulos Auth originais do PR `15c531e`, em cópia isolada | **3/11**, exit 1 | **2/11**, exit 1 | Storage/PKCE e perda de B reproduzidos; rotação 7/8 já passava nesse original |
| Implementação corrigida | **11/11**, exit 0 | **11/11**, exit 0 | Todos os contratos da matriz passam |

Não se alega que os 11 cenários falhavam em todo baseline: há controles de preservação que já passavam. Em particular, a falha de rotação 7/8 aparece no runtime local pré-correção, não no logout original do PR. O controle negativo específico sem CAS fica em **0/1 → 1/1** no caso 5. O cenário 29 contra os módulos originais fica em **0/1**, por remoção de B pela rejeição antiga.

As três correções da auditoria anterior foram revalidadas, não substituídas: **logout A × Google B; Admin 503/retry; limite do corpo HTTP**. Os casos centrais 1–3 de `auth-recovery.*` ficam **0/3 no original → 3/3 corrigidos**, nas duas modalidades. A matriz recovery inteira passa em **19/19 unitários + 19/19 Chromium**; no contrafactual original, apenas **5/19** passam em cada modalidade.

## 3. Suítes completas e repetibilidade

Node **22.22.3**, npm **10.9.8**, Chromium **138.0.7204.0**. Execuções em cópia isolada/sincronizada do checkout, com HOME/TMP próprios e dependências do lockfile. **Chromium e SDK reais; Google/Auth/PostgREST, identidades e JWTs de teste fictícios.** Transporte problemático também exercitado por HTTP local real. Não houve SQL/PGlite, conta/credencial real ou chamada de dados reais autorizada por esta validação.

| Comando / verificação | Resultado desta rodada |
| --- | --- |
| `npm test` | **491/491**, exit 0, em **2 execuções completas** (~391 s / 516 s) |
| `npm run test:auth:e2e` | **59/59**, exit 0, em **4 execuções completas** (~127 / 181 / 186 / 119 s): 29 Auth + 19 recovery + 11 concurrency |
| `npm run test:e2e` | **46/46**, exit 0 (~446 s) |
| `npm run test:auth:concurrency` | **5/5 rodadas consecutivas**, cada uma com 11/11 unitários e 11/11 Chromium |
| `FORJA_AUTH_BROWSER_CASE=29 node tests/auth.browser.mjs` | **5/5 isoladas consecutivas**, além das 4 passagens na suíte completa |
| `node --check` | **93/93 JS/MJS**, sem erro |
| `bash -n tools/preparar-site.sh` | Exit 0 |
| `npm run vendor:supabase -- --check` | Distribuição/licença/SHA-256 OK, versão 2.119.0 |
| `git diff --check` + whitespace dos arquivos incrementais, inclusive não rastreados | Sem erro |
| Prova funcional de segurança web entre duas origens | Fetch sem CORS bloqueado (`TypeError`); DOM cross-origin bloqueado (`SecurityError`) |

Os **491 = 480 anteriores + 11 novos**; Auth 43, config/build 12, recovery 19 e concurrency 11 já estão dentro desse total, não devem ser somados de novo. Os dois fluxos mobile emulados continuam dentro dos 29 Auth. Os 46 E2E gerais e seus **589 asserts** foram preservados.

Todas as execuções Chromium desta rodada mantiveram segurança web e isolamento habilitados. O observador registrou **34 launches e zero flags inseguras**; o helper também verifica os argumentos reais do processo. Não foi utilizado `--disable-web-security`, desativação de site isolation ou das features `IsolateOrigins`/`site-per-process`. `--no-sandbox` é limitação do processo neste ambiente, não desligamento de SOP/CORS. Isso não deve ser confundido com exigir `crossOriginIsolated`/COOP/COEP no site.

Execuções intermediárias e diagnósticos não foram apagados. O primeiro teste Chromium de `getItem` capturava uma leitura **anterior ao clique**, rastreada a `workoutTick → canWrite → isVerified`. A injeção agora é armada no capture do clique antes do handler de produção e exige também gate `locked` no primeiro erro. O primeiro preparo RED de OAuth sem retenção de navegação era inválido e não é usado como evidência. Um diagnóstico RED de PKCE que perdeu o contexto B foi substituído por leitura do mesmo slot compartilhado no documento A retido; a asserção da sessão exata permanece e o RED contratual foi reconfirmado.

## 4. Arquivos e integridade incremental

| Arquivos | Funções / responsabilidade nesta rodada |
| --- | --- |
| `assets/js/forja-auth.js` | `mutateSession`, `sdkStorage`, `init`, `startGoogle`, `nextEpoch`, `invalidate`/eventos, `verify`, `loginIdentity`/`sameLogin`, `markerApplies`/`receiveLogout`, `signOut`, `handleStorage`, retry de saída |
| `assets/js/forja-configuracoes.js` | Listener de logout de `initSettings`, com `await`/`finally` |
| `tests/auth-concurrency.test.mjs`, `tests/auth-concurrency.browser.mjs` **(novos)** | 11 cenários por modalidade: storage 1–3/11, PKCE 4–6, rotação/isolamento 7–10; CAS adicional dentro do unitário 5 |
| `tests/helpers/auth-concurrency.mjs` **(novo)** | Barreiras HTTP/storage/navegação, falhas seletivas, notificações retidas e provas de revogação |
| `tests/helpers/auth-fixture.mjs` | `session_id` sintético: estável na rotação, novo em novo login; assinatura continua inválida |
| `tests/auth.browser.mjs`, `tests/helpers/browser-auth.mjs` | Cenário 29 determinístico/filtro isolado e diagnóstico; sem enfraquecer os contratos anteriores |
| `package.json` | Acrescenta concurrency às suítes Auth existentes e script dedicado, sem remover comandos/dependências |
| Este relatório, `evidencias-auth-final.md` **(novos)** e três guias Auth | Resultado atual, evidências e separação dos registros históricos |

Manifesto de entrada: **799 arquivos**, fingerprint canônico `cb52fa4d47918f39ddd190d0ce8ed669c631e087b24f4f6949df196f110441aa`. Resultado incremental: **790 idênticos**, **9 existentes alterados**, **5 novos**, **nenhum removido**. Branch/HEAD e bytes do índice permanecem iguais; não houve stage.

- `auth.test.mjs` (43), `auth-config.test.mjs` (12), ambos `auth-recovery.*` (19 cada), helper recovery, E2E geral e helper de navegador permanecem **byte a byte iguais à entrada**. Os 19 corpos de testes Chromium do PR original também foram comparados e continuam idênticos; o cenário 29 foi fortalecido, não excluído.
- `admin-exercicios.js`, `forja-auth-guard.js`, `forja-login.js`, `forja-auth-data.js`, `forja-app.js`, `package-lock.json` e bundle oficial foram conferidos idênticos ao início desta rodada. As correções anteriores não foram revertidas.
- Sem alterações de domínio, HTML/CSS/design, Functions/CORS de produção, workflow/Netlify/build/configuração pública, armazenamento/backup/migrações ou catálogo/assets. Não há 3D reintroduzido, dependência nova, modo visitante/anônimo ou email/senha.
- SHA-256 do SDK: `a867edbcfb029370aeec7223dd6180b560b621fbe3bc64c6584fb0369d1b7bce`; lockfile: `b490e9738f8c589f3e84700468a0d49f78a9cbfe38abf0c1282d135951f49cd6`.

## 5. O que permanece não comprovado / pendente

1. **Google/Supabase reais:** provider, consentimento, callback/allowlist, chave pública do ambiente, refresh/revogação e concorrência com contas reais continuam pendentes de ambiente aprovado e autorização. SDK real + HTTP fictício não equivalem a esses serviços reais. Saúde de Auth/um GitHub 403 não comprovam configuração, ausência de variáveis ou causa de deploy.
2. **RLS/isolamento remoto:** o isolamento A/B demonstrado aqui é de runtime, sessão e namespace local, com PostgREST simulado. As oito tabelas/16 políticas/RLS/FORCE RLS/UPDATE negado são relato prévio, não nova inspeção remota. Homologação requer duas contas/JWTs de usuário e dados/ambiente autorizados, sem SQL ou chaves privilegiadas.
3. **Escrita real/cópia inicial:** entrar de verdade pode iniciar a cópia em `user_data_imports`. Antes da homologação, definir autorização para ambiente/dados ou bloqueio externo das chamadas de dados, **sem simular Auth**. Não foi criada sincronização contínua.
4. **Navegadores/aparelhos:** mobile é emulação Chromium; BFCache segue com evento simulado nos testes existentes. Safari/iOS/aparelho físico e comportamento real de storage/revogação precisam de homologação. Web Locks/HTTPS são pré-requisitos das operações coordenadas.
5. **Backend e deploy:** as seis não conformidades anteriores de Functions/JWT, previews, Blobs, CORS e quotas/IA/YouTube continuam fora do escopo. O primeiro erro/log completo do deploy falho `6afa2ff1223ea7e78d2f1eef` segue pendente; não houve nova tentativa nem atribuição de causa sem prova.

**Conclusão: entrega local concluída, com as novas regressões e as correções anteriores verdes. Aguardar autorização.** Não houve publicação, alteração remota, SQL, credencial real/privilegiada ou mudança em painéis/banco.
