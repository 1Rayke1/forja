# Instrumentação diagnóstica temporária — FORJA auth (Android)

Instrumentação **passiva e temporária** para capturar a sequência real de eventos
que deixa o FORJA em `data-forja-auth="locked"` com **“Verificando sua sessão…”**
após o retorno do segundo plano no Android. **Não corrige** o bug de autenticação;
apenas coleta evidência. É removível e não altera o comportamento quando desativada.

## 1. Arquivos modificados

| Arquivo | Alteração |
| --- | --- |
| `assets/js/forja-auth-diagnostics.js` | **NOVO** — módulo de diagnóstico: `record()`, `nextRevalidateId()`, `noteListener()`, `enable/disable/clear/toJSON/copy/download/ensurePanel`, captura de lifecycle (`freeze`/`resume`/`focus`/`blur`). Limites 2000 eventos / ~200 KB JSON, só em memória, sem envio automático. |
| `assets/js/forja-auth-guard.js` | Adição **leitura** de registros (`diag.noteListener`, `diag.record`) em `pagehide`, `pageshow`, `storage`. Lógica de `lock()` inalterada. |
| `assets/js/forja-auth.js` | Registros em `gate`, `unlock`, `invalidate`, `scheduleValidation`, `scheduleSilentRetry`, `armExpiry`, `nextEpoch`, `revalidate` (incl. dedup), `onAuthStateChange`, `handleStorage`, `init`, `verify` (start/attempt/stale/aborted/transient/error/end), listeners `visibilitychange`/`click`. Reestruturas equivalentes apenas para inserir os registros. |
| `assets/js/forja-app.js` | Registros em `refreshAfterVisibility`, `retryChangedSession`, `continueBoot` e listeners `visibilitychange`/`pageshow`. |
| `index.html` + 14 páginas | `<script src="assets/js/forja-auth-diagnostics.js">` (caminho relativo `../assets/...` em subpastas) antes do guard. |

**Novos testes:**
- `tests/auth-diagnostics.test.mjs` — 9 testes jsdom.
- `tests/auth-diagnostics.browser.mjs` — 6 testes no Chromium real.

## 2. Descrição da instrumentação

Cada registro tem: `seq`, `t` (timestamp), `rel` (ms desde o início), `event`,
`vis` (`document.visibilityState`), `focus` (`document.hasFocus()`),
`gateBefore`/`gateAfter` (`data-forja-auth` antes/depois), e dados específicos:

- **Guard** — `guard:loaded`, `guard:pagehide` (persisted, verified, willLock, lockReason), `guard:pagehide:after`, `guard:pageshow` (persisted, verified, willLock, lockReason), `guard:pageshow:revalidate-start/end`, `guard:pageshow:after`, `guard:pageshow:nonpersisted`, `guard:storage`, `guard:storage:lock`, `guard:storage:after`.
- **Auth** — `auth:gate(:after)`, `auth:unlock(:after)` (uid, verified, willUnlock, unlockReason), `auth:invalidate(:after)` (silent, revisionBefore/After), `auth:scheduleValidation`, `auth:scheduleSilentRetry` (delayMs), `auth:armExpiry(:fired)` (armed, delayMs, expiresAt), `auth:nextEpoch(:after)` (epochBefore/After), `auth:revalidate(:after)` (disabled, dedup, newJob), `auth:onAuthStateChange` (supabaseEvent, **presença booleana** de token: `hasNextToken`, `hasStoredToken`, `verifiedTokenPresent`), `auth:handleStorage` (key, newValuePresent), `auth:verify:start/attempt/attempt-ok/stale/aborted/transient/error/end` (verifyId, attempt, generation, epoch, observed, durationMs, error sanitizado), `auth:init(:start)`, `auth:visibilitychange`, `auth:click`.
- **App** — `app:refreshAfterVisibility`, `app:retryChangedSession(:after)` (hasUser), `app:continueBoot` (uid), `app:visibilitychange`, `app:pageshow`.
- **Diag** — `diag:enable/disable/clear`, `diag:lifecycle:{freeze,resume,focus,blur}`.

**O que NUNCA é gravado:** conteúdo de tokens, cookies, senhas, PII, corpos de
requisição, assinaturas. Apenas **presença booleana** de token e nomes de eventos
Supabase (`INITIAL_SESSION`, `TOKEN_REFRESHED`, `SIGNED_IN`, `SIGNED_OUT`). Erros
são sanitizados por `safeError()` (name/status/code/stale/loginRequired apenas).

## 3. Como ativar no Android

1. Atualize a página no Android até carregar a instrumentação (ou publique-a —
   veja item 9).
2. Adicione `?forja-diag=1` à URL da página (ex.:
   `https://1rayke1.github.io/forja/?forja-diag=1`), **ou** abra o DevTools
   do Android e defina `window.FORJA_AUTH_DIAG = true` antes do carregamento.
3. O botão flutuante **🩺** (canto superior direito) aparece em qualquer estado,
   inclusive no bloqueio. Toque nele para abrir o painel.

> Alternativa: ativar depois da carga com `window.ForjaDiagnostics.enable()`
> (via DevTools remote). A captura por URL é a forma mais simples.

## 4. Como iniciar/encerrar uma captura

No painel **🩺 Diagnóstico de autenticação**:

- **Iniciar captura** — começa a gravar (se a URL já não tiver ativado).
- **Parar** — pausa a gravação (os registros já feitos são mantidos).
- **Limpar** — remove todos os registros em memória.

**Sequência de repro (Android):**
1. Faça login no FORJA.
2. Inicie a captura (botão **Iniciar captura**).
3. Use o app normalmente.
4. Coloque o app em segundo plano.
5. Espere alguns minutos (o tempo de expiração/refresh).
6. Volte ao app.
7. Se a tela **“Verificando sua sessão…”** permanecer travada, **não recarregue**.

## 5. Como exportar o JSON

No painel, toque em **Exportar JSON**. O arquivo `forja-auth-diagnostics.json`
é baixado **localmente** no dispositivo (Blob, sem rede). Alternativa: **Copiar**
para a área de transferência, ou `JSON.stringify(ForjaDiagnostics.toJSON(), null, 2)`
via DevTools. O JSON contém o campo `diagnostics: "forja-auth-diagnostics"`,
`enabled`, `eventCount` e o array `records`. **Nunca é enviado automaticamente.**

## 6. Testes executados e resultados

| Suíte | Comando | Resultado |
| --- | --- | --- |
| Diagnóstico (jsdom) | `node tests/auth-diagnostics.test.mjs` | **9/9 aprovados** |
| Diagnóstico (Chromium) | `node tests/auth-diagnostics.browser.mjs` | **6/6 aprovados** |
| Auth (jsdom) | `node tests/auth.test.mjs` | **45/45 aprovados** |
| Auth (Chromium) | `node tests/auth.browser.mjs` | **35/35 aprovados** |
| Auth recovery (jsdom) | `node tests/auth-recovery.test.mjs` | **19/19 aprovados** |
| Auth concurrency (jsdom) | `node tests/auth-concurrency.test.mjs` | **18/18 aprovados** |
| Build | `npm run build` | exit 0 (o aviso `FORJA_SUPABASE_URL ausente` é esperado sem configuração) |

Os testes de diagnóstico cobrem: desativado = comportamento inalterado; nenhum
token/credencial nos registros; ordem dos eventos; exportação (`toJSON`); limite
de eventos; ausência de listeners duplicados; **revalidação com e sem captura
retorno idêntico**; ativação por URL; painel acessível no bloqueio travado.

## 7. Confirmação: nenhuma lógica de autenticação foi alterada

A instrumentação é **passiva**. `lock()`, `unlock()`, `gate()`, `verify()`,
`revalidate()`, `invalidate()`, `continueBoot()`, refresh do SDK, OAuth e
Supabase **não foram modificados**. Os únicos passos adicionados são chamadas de
`diag.record(...)`/`diag.noteListener(...)` que só gravam quando a captura está
ativa. Reestruturas aparentes em `forja-auth.js` (ex.: `const ok = ...` em
`unlock`, `if (work) return work.promise;` em `revalidate`, `if (error.stale &&
attempt < 2) continue;`) são **equivalentes semanticamente** e apenas permitem
inserir os registros. A suíte de autenticação (45 + 35 + 19 + 18 testes) passa
inteira com a instrumentação, confirmando equivalência.

## 8. Verificação: nenhum dado sensível é gravado

- `safeError()` sanitiza erros (apenas name/status/code/flags).
- `auth:onAuthStateChange` grava **booleanos** (`hasNextToken`, `hasStoredToken`,
  `verifiedTokenPresent`), nunca conteúdos.
- `guard:storage`/`auth:handleStorage` gravam apenas a chave e `newValuePresent`
  (booleano), nunca o valor.
- `auth:verify:*` grava durações, IDs de tentativa e erros sanitizados.
- Testes 3 (jsdom) e 4 (Chromium) percorrem os registros em busca de
  `access_token`, `refresh_token`, `Bearer`, `sb-`, `pkce`, `code_verifier`,
  `service_role`, `sb_secret`, `password`, `senha` — **nenhum encontrado**.

## 9. Como publicar temporariamente no GitHub Pages oficial (após revisão)

A instrumentação está **isolada na branch `arena/0a562617-forja`**, sem commit
ainda. Para publicar temporariamente:

1. **Revise o diff** nesta branch (`git diff`) e confirme que quer expor a
   instrumentação publicamente.
2. **Commit e publique a branch:**
   ```bash
   git add assets/js/forja-auth-diagnostics.js assets/js/forja-auth-guard.js \
           assets/js/forja-auth.js assets/js/forja-app.js \
           index.html admin/exercicios.html configuracoes/index.html \
           exercicio/index.html explorar/atlas.html explorar/index.html \
           onboarding/index.html progresso/index.html treino/biblioteca.html \
           treino/calistenia.html treino/executar.html treino/grupo.html \
           treino/index.html treino/musculacao.html treino/rotina.html
   git commit -m "Instrumentação diagnóstica temporária para auth (Android)"
   git push origin arena/0a562617-forja
   ```
3. **Publique o site pela workflow do GitHub Pages** (a source `main` é o
   official; para publicar a branch em vez do `main`, use um workflow/ação que
   publique `arena/0a562617-forja`, ou faça um PR e publique após aprová-lo).
   O build local de referência: `npm run build` (gera `.site-publish/`).
4. **Confirme o deploy** com `gh api repos/1Rayke1/forja/deployments` /
   `gh run list` e a página `https://1rayke1.github.io/forja/?forja-diag=1`.
5. **Remova** após a captura: exclua o commit da instrumentação e republique o
   `main` sem os arquivos `forja-auth-diagnostics.js`, os registros e os
   scripts HTML.

> **Não commit/publicar antes da revisão.** A captura no Android deve ser feita
> **sem recarregar** a página bloqueada para que os registros do segundo plano
> sejam exportados.
