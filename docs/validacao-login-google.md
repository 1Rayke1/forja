# Registro histórico — concorrência e recuperação anteriores de Auth / PR #71

> **Registro histórico, não parecer atual.** A auditoria readonly posterior a esta entrega encontrou duas corridas bloqueadoras (refresh antigo × nova sessão e BroadcastChannel antigo × nova intenção Google). A correção local autorizada, seus novos RED→GREEN, resultados e limites estão em [Correção das últimas corridas de Auth](correcao-concorrencia-auth.md). Os números e aprovações abaixo pertencem à rodada anterior; não autorizam merge, publicação ou homologação remota.

**Data de referência da sessão:** 2026-11-15. **Resultado: três correções implementadas e regressões locais aprovadas.** Google/Supabase/RLS reais continuam sem homologação. Esta entrega **não autoriza publicação**.

> Esta seção substitui a conclusão da validação local anterior. A auditoria posterior identificou três defeitos herdados do PR que os números **461/461 e 29/29**, isoladamente, não detectavam. O registro anterior está preservado ao final como histórico, não como aprovação atual.

Branch fixa: `arena/468b7e01-forja`; HEAD local/base `99cffc9147d72cc4eedd2eaf47310fc135815c3b`. O PR #71 não foi atualizado por esta rodada. Seu último estado remoto observado era aberto e draft, head `15c531e0b6a6a209c548cfa172b9ee313188c9ef`; isso não é uma nova consulta ao remoto. Alterações preexistentes foram preservadas. **Sem commit, stage, push, merge, deploy, workflow, preview remoto, SQL, credenciais reais ou mudanças em painéis/banco.**

## 1. Causas raiz e correções

### 1.1 Logout A versus novo Google/PKCE B

**Causa:** o logout delegava a `signOut` do cliente com persistência. Essa chamada podia esperar um refresh de A e consultar novamente o slot compartilhado, agora contendo B. Assim, a revogação podia usar o JWT de B e o SDK remover sua sessão. O `finally` antigo também removia incondicionalmente o verifier PKCE compartilhado. Uma resposta antiga podia ainda alterar estado/Promise/UI de um trabalho novo.

**Correção em `forja-auth.js`:**

- Capturar JWT/UID da sessão observada no início; não fazer `getSession` durante o logout. Fechar o acesso, invalidar/cancelar a geração e remover condicionalmente somente o registro que ainda contém aquele JWT, **antes de qualquer `await`**.
- Revogar com **`verifier.auth.admin.signOut(jwtOriginal, "local")`**, API do SDK oficial, com chave pública e JWT de A explícito. Esse endpoint de logout não exige `service_role`, não administra usuários nem usa tokens de B. A remoção local é condicional; não há implementação de criação, rotação ou renovação de tokens fora do SDK.
- Vincular trabalho à geração e conferir revisão/token/UID após awaits; cancelar requisições antigas, impedir retries de refresh cujo token já não corresponde ao slot ativo e impedir `finally` antigo de apagar trabalho novo. Eventos atrasados do SDK só revalidam o estado atual, sem tratar B como A.
- Não remover verifier PKCE em nome do logout. Marcador sem tokens, identificado por UID/nonce, e `isLogoutCurrent` no Auth/guard descartam evento removido/substituído ou referente a outra conta. B só é liberada após validação remota própria.

**Comprovação:** A → refresh pendente → logout → Google/PKCE B em outra aba → conclusões antigas. B permanece armazenada, validada e utilizável; todas as requisições de logout da operação de A usam **somente o JWT de A**. Também há casos de verifier em uso, UI A ainda não notificada de B, `getUser` pendente e evento de logout antigo. A revogação continua best effort se a rede falhar; não se promete invalidar instantaneamente um access token já emitido ou sair de todos os aparelhos.

### 1.2 Admin após 503/retry

**Causa:** a IIFE administrativa encerrava antes de instalar filtros/listeners quando o Auth inicial falhava. O retry genérico revalidava o Auth, mas não retomava esse inicializador; o conteúdo podia continuar bloqueado ou sem funcionalidade.

**Correção em `admin-exercicios.js`:** `boot(retry)`, `bootWork`, `initializedUid`, `initializeAdmin` e `F.retryBoot` retomam o boot completo depois da validação, sem duplicar listeners/filtros. Mudança de UID exige novo documento. `request` confere revisão e identidade **depois de ler o corpo**, antes de aceitar payload antigo ou habilitar controles. A credencial administrativa adicional e seu contrato permanecem, somente em memória da aba.

**Comprovação:** 503 → sucesso; sessão válida no retry/idempotência; segunda falha → novo retry; expiração durante recuperação; resposta antiga A com B ainda recusada; dashboard A concluído após troca para B. Não há loading permanente, liberação de conta não validada ou renderização do payload antigo nesses casos.

### 1.3 Prazo de 12 segundos do transporte completo

**Causa:** o timer de `boundedFetch` terminava quando `fetch` entregava cabeçalhos. `response.json()`/leitura do corpo pelo SDK ficava fora do prazo e podia aguardar indefinidamente.

**Correção em `boundedFetch`/`cancellable`:** um único timer/`AbortController` abrange cabeçalhos e leitura integral em `arrayBuffer()`; só depois o SDK recebe uma `Response` normal. O prazo não é renovado por chunks. Timeout/invalidação abortam o HTTP e sua leitura, removem listeners/timer e não deixam conclusão cancelada atualizar a interface de uma tentativa nova. O limite é por requisição completa do transporte; não substitui a política interna de retries do SDK por um Auth artesanal.

**Comprovação:** sem cabeçalhos, corpo normal, atrasado dentro do prazo, atrasado além do prazo, interrompido durante leitura, sem fim e streaming contínuo. Os testes usam HTTP local real e conferem **sinal abortado e conexão fechada**, não só o retorno de `Promise.race`. Timeout → retry recupera; a tentativa de conclusão antiga não interfere na validação de B. O tempo mínimo observado é verificado em 11,7 s, com janela de teste até 14,5 s para o prazo nominal de 12 s.

## 2. Arquivos/funções alterados nesta rodada

| Arquivo | Alteração |
| --- | --- |
| `assets/js/forja-auth.js` | `nextEpoch`, `cancellable`, `invalidate`, `boundedFetch`, `sdk`, `verify`, `revalidate`, `init`, `startGoogle`, `signOut`, `logoutApplies`/`isLogoutCurrent`/`handleStorage`: identidade, geração, cancelamento, logout explícito e corpo HTTP completo |
| `assets/js/forja-auth-guard.js` | Ignora apenas logout obsoleto/de outra identidade antes de fechar o DOM; os demais guards permanecem fail closed |
| `assets/js/admin-exercicios.js` | Boot/retry idempotente por UID e rejeição pós-corpo de payload administrativo antigo |
| `tests/auth-recovery.test.mjs` **(novo)** | 19 regressões unitárias/integradas com SDK oficial |
| `tests/auth-recovery.browser.mjs` **(novo)** | 19 regressões Chromium, incluindo duas abas e round-trip Google/PKCE simulado |
| `tests/helpers/auth-recovery.mjs` **(novo)** | Barreiras determinísticas, identidades fictícias, fixtures Admin e servidor HTTP real local com interrupção/streaming |
| `tests/helpers/browser.mjs` | Segurança web ativa por padrão e conferida no processo real; espera por login inicializado |
| `tests/helpers/browser-auth.mjs` | Injeção explícita de fixture Admin; sincronização CDP em navegação exige commit exato e verificação independente, sem ocultar erros normais |
| `tests/e2e.browser.mjs` | Segurança explícita e fixtures CORS/Origin/headers locais; nenhum cenário/assert removido |
| `package.json` | Integra as novas suítes a `test:auth` (incluído em `npm test`) e `test:auth:e2e`; sem dependências novas |
| `docs/autenticacao-google.md`, `docs/entrega-google-auth.md`, este relatório | Arquitetura/correções atuais, resultados e limites; números anteriores mantidos como histórico |

## 3. Matriz de regressões e RED → GREEN

As três regressões centrais foram executadas contra uma cópia do runtime **anterior às correções**, com o mesmo SDK oficial e fixtures: **0/3 unitárias e 0/3 Chromium**, pelas falhas esperadas de logout, Admin e corpo HTTP. Depois da correção: **3/3 e 3/3**. A ampliação e integração chegaram aos resultados completos abaixo.

Os números correspondem aos cenários de mesmo número nos dois arquivos `auth-recovery.*`:

| Falha / matriz | Cenários novos | Resultado final |
| --- | --- | --- |
| Logout/identidade/geração | **1, 4, 5, 16, 17**: refresh + Google B, verifier paralelo, UI antiga, getUser pendente e evento antigo | **5/5 unitários + 5/5 Chromium** |
| Admin/recuperação completa | **2, 6–10**: 503 → sucesso, nova falha, idempotência/credencial, expiração, Auth antigo e dashboard antigo | **6/6 + 6/6** |
| Transporte/cancelamento | **3, 11–15, 18, 19**: corpo normal/atrasado/interrompido/infinito, retry, conta nova, sem headers e streaming em progresso | **8/8 + 8/8** |
| **Total adicionado** | Sem `skip`/`only`, bypass de produção ou remoção de asserts anteriores | **19/19 + 19/19** |

## 4. Execuções finais completas

Node **22.22.3**, npm **10.9.8**, Chromium **138.0.7204.0**. Execução em cópia isolada e sincronizada do checkout, dependências do lockfile, HOME/TMP isolados, bloqueio de saída externa no processo Node e interceptação dos serviços externos no navegador. **SDK e Chromium reais; Google/Auth/PostgREST/JWT/RLS de teste simulados.** O transporte problemático também foi testado por servidor HTTP local real.

| Comando / verificação | Resultado final | Comparação / limite |
| --- | --- | --- |
| `npm test` | **480/480**, exit 0; ~349 s | **461 anteriores + 19 novos**. Inclui Auth 43, config/build 12 e recovery 19; não somá-los novamente |
| `npm run test:auth:e2e` | **48/48**, exit 0; ~116 s | **29 anteriores + 19 novos**, segurança web/isolamento ativos |
| `npm run test:e2e` | **46/46**, exit 0; ~363 s | Matriz multipágina geral preservada, agora validada com segurança web ativa |
| `node --check` | **90/90 arquivos JS/MJS**, sem erro | Inclui o bundle oficial e fontes/testes do checkout |
| `bash -n tools/preparar-site.sh` | Exit 0 | Sintaxe, não build/deploy remoto |
| `npm run vendor:supabase -- --check` | Distribuição/licença/SHA-256 OK | SDK **2.119.0**, não editado |
| `git diff --check` e conferência dos diffs incrementais, inclusive arquivos não rastreados | Sem erro | Validação local de whitespace/preservação |

**Nenhuma das três falhas continua reproduzível nas regressões finais.** Os dois fluxos mobile emulados de 320/390 px continuam dentro dos 29 cenários anteriores de Auth; teclado/layout também foram mantidos. O E2E geral cobre 320/360/390/430/768/1280 px. Mobile Chromium não é aparelho físico/Safari; os casos BFCache mantêm a limitação de evento simulado explicitada no histórico.

Todas as suítes Chromium executadas conferem a ausência de `--disable-web-security`, `--allow-running-insecure-content`, desativação de site isolation e de `IsolateOrigins`/`site-per-process` nas features desabilitadas. `--no-sandbox` é uma exigência do processo neste ambiente, não desligamento da segurança web. **Nenhuma aprovação usa segurança web desabilitada.**

Para o E2E geral, os ajustes de CORS ficaram só no teste: origem local exata em `FORJA_ALLOWED_ORIGINS` no processo local do handler real com upstream simulado, `Origin` encaminhado e headers reais preservados; preflight no stub de vídeos. Não se alterou nenhuma Function/CORS/allowlist de produção nem se declarou resolvida a não conformidade de backend.

Evidências brutas temporárias (fora do Git/artefato público): `/tmp/forja-auth-recovery-_20olth1/logs/`. Baseline RED: `baseline-recovery-{unit,browser}.log`; resultados finais: `final-npm-test.log`, `final-auth-browser-2.log`, `final-e2e-browser.log`, respectivos `.exit` e `final-vendor-check.log`. São arquivos temporários, não armazenamento permanente. Execuções intermediárias com falhas de sincronização de fixture foram substituídas por **reexecução integral** dos comandos, sem remover/enfraquecer checks.

## 5. Auditoria de preservação e escopo

- Manifesto de entrada: **796 arquivos**. Conferência final: **786 byte a byte idênticos**, **10 existentes alterados intencionalmente** e **3 arquivos novos**; **nenhum removido**. Mudanças incrementais limitadas aos 13 caminhos descritos acima.
- `tests/auth.test.mjs` **43 cenários** e `tests/auth.browser.mjs` **29 cenários** permaneceram **byte a byte iguais** ao início desta rodada; as correções/testes locais anteriores não foram descartados. E2E geral mantém os **46 nomes e 589 asserts** e nenhum skip. As novas suítes foram integradas, não usadas em substituição às antigas.
- Login exclusivo Google, retorno query/hash/`/forja/`, sanitização de callback, validação autoritativa, proteção contra `session_not_found`, UID/rascunhos, migração/journal/checksum/readback, cópia inicial sem sync contínuo, backup/recuperação e credencial administrativa adicional foram preservados e cobertos pelas suítes.
- `forja-login.js`, `forja-auth-data.js`, `forja-app.js`, módulos de armazenamento/backup, HTML/CSS/imagens/catálogo e `package-lock.json` não foram modificados nesta rodada. Também não foram modificados Functions, Netlify/workflow/build ou configuração pública. Não foi reintroduzido 3D.
- Bundle oficial intacto: SHA-256 **`a867edbcfb029370aeec7223dd6180b560b621fbe3bc64c6584fb0369d1b7bce`**. Sem dependências novas, Auth REST artesanal, credenciais reais ou privilegiadas.
- Branch e HEAD locais mantidos; index vazio. Sem reset, troca de branch, stage, commit, push, merge ou ação remota nesta implementação.

## 6. Pendências de homologação real e encerramento

1. **Google/Supabase reais não testados.** Provider, URLs/chave pública, consentimento/callback, refresh/revogação reais e isolamento/RLS com contas reais continuam pendentes de ambiente e autorização. A saúde de Auth consultada na auditoria anterior não homologa esses itens. Nenhum conector/painel externo foi acionado nesta implementação.
2. Conferir `FORJA_SUPABASE_URL`/`FORJA_SUPABASE_ANON_KEY` no ambiente aprovado, sem presumir ausência por respostas GitHub 403. Usar somente chave anon/publishable; nunca solicitar/armazenar `service_role`, `sb_secret`, JWT signing secret, Google Client Secret ou tokens reais no chat/Git.
3. A entrada real pode iniciar a cópia original para `user_data_imports`; é necessário definir previamente ambiente/dados autorizados ou bloqueio externo de chamadas de dados, **sem simular Auth**, antes de homologação exclusivamente de login. Nenhuma escrita de dados reais foi feita.
4. Homologar duas contas, concorrência em abas, retorno com query/hash, navegação/reload/expiração/refresh/logout, Admin e celular físico. Callback esperado: `https://abundydxjclcgonctirx.supabase.co/auth/v1/callback`; retornos Pages/Netlify e checklist estão no [guia](autenticacao-google.md).
5. As **seis não conformidades de backend** (Functions/JWT, previews, Blobs, CORS e quotas/IA/YouTube) continuam fora do escopo, sem correção. O log/primeiro erro do deploy falho `6afa2ff1223ea7e78d2f1eef` permanece pendente; nenhuma nova tentativa ou atribuição de causa sem prova.

**Entrega local concluída; aguardar autorização para qualquer próxima ação remota.** Não houve SQL (nem SELECT/PGlite), contas/credenciais reais, alteração de dados/RLS/painéis, commit, push, merge, publicação, deploy/retry, workflow ou novo preview remoto.

---

# Registro histórico — validação focada anterior do login Google

> O restante preserva a entrega anterior (461/461 e 29/29). Seus resultados e conclusões pertencem àquela rodada; não substituem a validação atual acima nem homologam serviços reais.

**Resultado:** correções de autenticação implementadas e aprovadas localmente. **Google/Supabase reais ainda não homologados; o critério de conclusão real permanece pendente.**

Base desta rodada: conteúdo do PR #71, head `15c531e0b6a6a209c548cfa172b9ee313188c9ef`, na branch fixa `arena/468b7e01-forja`. O checkout tinha alterações preexistentes correspondentes ao PR; elas foram preservadas. Esta rodada não recriou a arquitetura, não fez commit/push e não atualizou o PR remoto.

## 1. Arquivos alterados nesta rodada

| Arquivo | Alteração sobre o conteúdo original do PR |
| --- | --- |
| `assets/js/forja-auth.js` | Isola `getUser` em cliente oficial sem persistência; distingue sessão rejeitada de erro transitório e retorna ao login; sanitiza callback antes do SDK/configuração; exige nova tentativa após erro de início/callback |
| `assets/js/forja-login.js` | Reage a sessão validada posteriormente, recupera botão/estado no retorno BFCache e evita redirecionamento concorrente com a abertura do Google |
| `tests/auth.test.mjs` | Onze regressões adicionais; total de Auth passou de 32 para 43 |
| `tests/auth.browser.mjs` | Dez cenários adicionais; total passou de 19 para 29, incluindo dois fluxos mobile emulados e as novas regressões |
| `tests/helpers/auth-fixture.mjs` | Respostas de erro de Auth por token, com status/código e atraso determinísticos; somente teste |
| `tests/helpers/browser.mjs` | Opção explícita para exigir segurança web/isolamento de origens na suíte de Auth, sem mudar os stubs/CORS das outras APIs |
| `docs/autenticacao-google.md` | Atualização do comportamento de sessão/callback/BFCache e limites de homologação |
| `docs/entrega-google-auth.md` | Identificação dos resultados históricos e link para este complemento |
| `docs/validacao-login-google.md` | Este registro de entrega e bloqueios |

Não foram alterados nesta rodada HTML/CSS/design, SDK vendorizado, driver de dados/cópia, modelos de domínio, banco/RLS, Functions, Netlify, workflow ou configuração pública de produção.

## 2. Funcionalidades concluídas e verificadas localmente

A arquitetura original foi mantida: **Google obrigatório via SDK oficial Supabase 2.119.0, PKCE S256, persistência/refresh pelo SDK e `getUser(access_token)` para autorizar a interface**. Não foi criado visitante, login anônimo ou email/senha.

- Login público e acesso direto às **15 páginas internas** fechado sem autenticação. Administração continua exigindo também a credencial adicional existente.
- Retorno à página solicitada com query/fragmento, na raiz e sob `/forja/`; rejeição de destinos externos e fluxo de onboarding preservados.
- Persistência ao navegar/recarregar, refresh, bloqueio por expiração, logout entre abas e troca A → B → A sem misturar namespaces locais.
- **Correção:** rejeições definitivas de Auth (incluindo HTTP 401/403) não ficam presas no gate de rede. O registro local do token observado é removido, se ainda for o mesmo, e o usuário volta ao login com o destino preservado. Não se chama revogação remota para essa rejeição; dados/journals e verifier de outra tentativa não são removidos por esse tratamento.
- Falhas transitórias (ex.: 503/429) mantêm o conteúdo fechado, preservam a sessão armazenada e permitem retry sem novo OAuth. Resposta 401 atrasada de A não vence uma troca já observada para B.
- **Correção de concorrência no SDK:** `getUser` usa um segundo cliente oficial **sem persistência nem refresh**, com JWT explícito. Uma resposta `session_not_found` antiga só pode limpar o estado efêmero desse cliente; não apaga a sessão ativa de B nem o verifier de outra tentativa. A revisão/token ainda são conferidos antes de autorizar. O cliente principal continua responsável por PKCE, persistência, refresh e logout. Não há Auth REST artesanal ou SDK editado.
- **Correção:** uma tela de login já aberta avança quando uma sessão Google é validada posteriormente, inclusive por mudança em outra aba ou recuperação de erro transitório. Apenas receber um token local não autoriza a entrada.
- **Correção:** retorno BFCache da tela de login reinicia o estado de espera, revalida e reabilita o botão se o login não foi concluído. Não fica preso em “Abrindo o Google”.
- **Correção:** código/erros/tokens de callback são limpos da URL mesmo com configuração ausente. Callback cancelado/inválido exige nova tentativa Google e não reaproveita silenciosamente uma sessão antiga recuperada pelo SDK.

Os testes de regressão reproduziram os cinco problemas acima antes das respectivas correções. O comportamento de recuperação transitória e a proteção contra resposta 401 antiga também receberam cobertura explícita. Nenhuma nova sincronização ou alteração da cópia inicial foi introduzida.

## 3. Testes executados e resultado final

| Execução | Resultado final | Evidência e limite |
| --- | --- | --- |
| `npm test` | **461/461**, exit 0 | Regressão de domínio + Auth **43/43** + configuração/build **12/12**, já incluídos no total |
| `npm run test:auth:e2e` | **29/29**, exit 0 | Chromium e SDK reais, segurança web e isolamento de origens habilitados; Google/Auth/PostgREST simulados |
| Mobile na suíte de Auth | **2/2 fluxos**, dentro dos 29 | Viewports 320 e 390 px com emulação mobile/touch: Google → navegação → reload → logout → reload desautenticado |
| Layout/teclado do login | Aprovados, dentro dos 29 | 320/390/1280 px, sem overflow; foco visível; captura de 390 px inspecionada |
| `node --check` nos seis arquivos JS/MJS alterados; `git diff --check` | Aprovados | Validação estática, não prova de serviço remoto |
| Supabase `list_projects` + `get_project_health` apenas para `auth` | Projeto FORJA encontrado; Auth `ACTIVE_HEALTHY` / `healthy: true` | Consulta real somente leitura de metadados/saúde; **não testa provider, OAuth, sessão de usuário ou RLS** |

**Nenhum teste final reprovado.** As falhas das regressões novas no baseline foram corrigidas. As 43 verificações de Auth e as 12 de configuração não devem ser somadas novamente aos 461; os dois cenários mobile já fazem parte dos 29 do navegador.

Os testes rodaram sobre uma cópia isolada do checkout atualizado, com os mesmos seis arquivos JS/MJS alterados e bloqueio de rede externa no processo Node. O navegador interceptou os serviços externos com fixtures explícitas. Não houve conexão dos tokens fictícios ao projeto real, nem SQL/PGlite. Logs e capturas foram mantidos fora do Git/artefato público, em diretório temporário.

A suíte de Auth agora remove e verifica a ausência de `--disable-web-security`, `--allow-running-insecure-content`, desativação de site isolation e de `IsolateOrigins`/`site-per-process` nas features desabilitadas. O sandbox do processo Chromium é desabilitado no ambiente de testes; isso não desliga a segurança web do navegador. Os argumentos legados das suítes não Auth foram preservados, sem corrigir CORS de APIs ou seus stubs nesta etapa.

O teste de retorno persistido da tela de login **simula o evento BFCache e retém somente a navegação de saída** para restaurar o mesmo documento ocupado. Não é prova de BFCache em Safari/iOS ou aparelho físico. Os testes mobile são emulação Chromium, não execução em celulares reais. `npm run test:e2e` multipágina geral não foi reexecutado nesta rodada; seus resultados anteriores continuam históricos, não evidência nova destas correções.

## 4. Resultado do teste real Google/Supabase

**Não realizado. Não há evidência de entrada/consentimento/callback/refresh/logout Google reais nesta rodada.**

Bloqueios observados:

1. `FORJA_SUPABASE_URL` e `FORJA_SUPABASE_ANON_KEY` não estão disponíveis no processo desta sessão. Consultas somente leitura aos dois nomes nas Repository Variables retornaram **403 — Resource not accessible by integration**. Isso é limite de acesso: **não prova ausência das variáveis remotas e não explica a falha de deploy**.
2. Não há artefato com estas correções publicado em ambiente aprovado. O preview do PR já estava indisponível na rodada anterior; não foi disparada nova tentativa, workflow ou preview para contornar isso.
3. Não há sessão de uma conta Google autorizada nem participação humana no consentimento. Não foram solicitadas senhas, tokens ou chaves privadas.
4. Entrar no aplicativo pode iniciar a cópia remota original do PR. Não foi autorizada escrita real de dados de uso/cópia, portanto ela não foi executada como parte de um teste de login.

Somente metadados do projeto e saúde de Auth foram consultados via conector Supabase. Não foram lidos API keys, secrets, usuários, tabelas, políticas ou configuração que pudesse retornar segredos. Google habilitado, email/anonymous desabilitados e Redirect URLs **continuam sem confirmação remota pelo agente**. Nenhum painel foi modificado.

## 5. Configurações/conferências manuais necessárias

O cadastro já informado pelo usuário deve ser **conferido no ambiente correto**, não substituído por chaves fictícias nem presumido ausente. Não colar valores privados em chat/Git/logs.

1. Disponibilizar as variáveis públicas existentes ao build/ambiente de homologação autorizado:
   - `FORJA_SUPABASE_URL=https://abundydxjclcgonctirx.supabase.co`;
   - `FORJA_SUPABASE_ANON_KEY`: chave pública **anon/publishable** do mesmo projeto. Nunca `service_role`, `sb_secret`, Client Secret ou token de usuário.
   - GitHub Repository Variables e ambiente de build Netlify são configurações independentes. O gerador existente continua responsável por preencher somente o artefato.
2. No Supabase Auth, conferir Google habilitado, email/senha e anonymous desabilitados conforme a política do projeto, Site URL canônica e retornos exatos necessários:

   ```text
   https://1rayke1.github.io/forja/login.html
   https://prismatic-parfait-be3644.netlify.app/login.html
   ```

   Usar somente os ambientes aprovados. Para servidor local autorizado, conferir host/porta e os retornos locais descritos no [guia de autenticação](autenticacao-google.md); não abrir coringas amplos ou hosts de preview no projeto de produção.
3. No Google Cloud, conferir cliente OAuth Web, consentimento/usuários de teste, origens sem caminho e callback exato:

   ```text
   https://abundydxjclcgonctirx.supabase.co/auth/v1/callback
   ```

   Client Secret somente no provider do Supabase, nunca no frontend.
4. Homologar com participação humana em perfil de navegador separado e ambiente autorizado: entrar por uma rota interna com query/fragmento, concluir Google na mesma aba/origem, navegar, recarregar, aguardar refresh real, sair e testar acesso direto/Voltar após logout. Repetir com outra conta e em mobile real.
5. Definir antes dessa homologação como impedir escrita de dados de uso/cópia sem autorização. Pode-se bloquear externamente as requisições de dados no navegador de teste, **sem simular Auth**, ou obter autorização específica para ambiente/dados de teste. Não criar bypass/modo visitante em produção, executar SQL ou alterar RLS para testar login.

Estes itens são checklist, **não autorização para alterar painéis, publicar, fazer merge ou executar deploy**.

## 6. Pendências para a próxima etapa

- Homologação Google/Supabase real e critério real **entrar → permanecer ao navegar/recarregar → sair**: pendentes pelos bloqueios acima. O mesmo fluxo passou apenas com provider/serviços simulados.
- Aprovação para levar estas alterações locais ao PR. Nenhum commit/push foi feito nesta rodada, para não disparar publicação automática. PR #71 deve permanecer aberto e draft.
- Causa da falha do deploy anterior e acesso ao seu primeiro erro/log completo: pendentes, sem nova tentativa e sem atribuir causa às variáveis sem prova.
- As seis não conformidades anteriores relativas a Functions/JWT, isolamento de previews, Blobs, CORS e quotas/serviços de IA/YouTube **continuam fora do escopo e sem correção**. Não se deve considerar o backend protegido só porque a interface exige Google.
- Isolamento/RLS e cópia inicial reais, navegadores móveis reais e demais painéis/provedores não foram homologados nesta rodada. Nenhuma tabela, dado real, política ou privilégio foi alterado.

**Operações que não ocorreram:** commit, push, merge, publicação, deploy/retry/workflow/novo preview remoto, SQL, modificação de banco/RLS/painéis ou uso de credenciais privadas/privilegiadas.
