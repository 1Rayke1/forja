# Contrato de Métricas Temporais e Descarte — W4 (`scrollToInteractable`)

> **Sem garantia física de 4.000 ms:** `scrollToInteractable` aplica um orçamento lógico monotônico único em Node (`deadlineMs = 4000`, `logicalCutoffMs = 3976`, reserva lógica de `24 ms`) e um lease no renderer (`expiresAt = finalAt - 64`, `cleanupUntil = finalAt - 32`). Como o event loop, o agendador de timers do SO e chamadas síncronas/protocolo do navegador podem sofrer atraso físico externo, **nenhum código ou evidência afirma garantia física de 4.000 ms**. Eventuais excessos físicos são medidos e expostos em `physicalReturnedAtMs`, `returnDelayMs`, `cutoffOvershootMs` e `deadlineOvershootMs`.

## 1. Campos temporais (`error.interaction`)

| Campo | Origem | Significado | Unidade | Cálculo | Quando pode ser `null` |
|---|---|---|---|---|---|
| `deadlineMs` | Constante `DEADLINE_MS` em Node | Orçamento nominal integral da operação | `ms` | `4000` | Nunca |
| `logicalCutoffMs` | Constante `DEADLINE_MS - NODE_TIMER_RESERVE_MS` (`4000 - 24`) em Node | Corte lógico a partir do qual o Node não inicia novas etapas de protocolo e entra em expiração | `ms` | `3976` | Nunca |
| `logicalExpired` | Estado booleano da máquina de expiração Node/renderer | Indica se a operação entrou em estado de expiração lógica | `boolean` | `true` se `markExpired(...)` foi acionado; caso contrário `false` | Nunca (`boolean`) |
| `expirationSource` | Primeiro gatilho que chamou `markExpired` | Origem da expiração lógica | string \| `null` | `'node-timer'` \| `'node-cutoff-check'` \| `'renderer-lease'` \| `null` | Quando `logicalExpired === false` |
| `logicalExpiredAtMs` | `performance.now() - started` no instante do primeiro `markExpired` | Instante lógico-monotônico em que a expiração foi registrada (inclusive em erro não-timeout pós-cutoff `>= 3976 ms`) | `ms` | `elapsedNow()` na transição inicial para expirado; garantido não-nulo sempre que `physicalReturnedAtMs >= logicalCutoffMs` ou em `TimeoutError` | Somente quando `logicalExpired === false` (ex.: erro não-timeout antes de `3976 ms` ou `InteractionRefusedError` antes do cutoff) |
| `timerFiredAtMs` | Callback de `setTimeout(..., remaining())` em Node | Instante em que o timer de deadline do Node realmente disparou | `ms` | `performance.now() - started` dentro do callback do `setTimeout` | Quando o timer foi cancelado antes de disparar (sucesso, erro pré-cutoff, expiração prévia pelo lease do renderer em `3936 ms`, ou erro não-timeout pós-cutoff que retornou antes da rodada do timer) |
| `timerDelayMs` | Derivado de `timerFiredAtMs` | Atraso positivo do disparo do timer em relação ao `logicalCutoffMs` (`3976`) | `ms` | `timerFiredAtMs !== null ? Math.max(0, timerFiredAtMs - logicalCutoffMs) : null` | Quando `timerFiredAtMs === null` |
| `timerDriftMs` | Derivado de `timerFiredAtMs` | Desvio com sinal do disparo do timer em relação a `logicalCutoffMs` (expõe disparo sub-ms antecipado de libuv/timer wheel) | `ms` | `timerFiredAtMs !== null ? timerFiredAtMs - logicalCutoffMs : null` | Quando `timerFiredAtMs === null` |
| `physicalReturnedAtMs` | `performance.now() - started` imediatamente antes do `throw` final | Tempo físico decorrido até o helper devolver controle ao chamador | `ms` | `elapsedNow()` após `finally` e disparo de descartes não bloqueantes | Nunca |
| `physicalElapsedMs` | Alias estrito de `physicalReturnedAtMs` | Mantido idêntico a `physicalReturnedAtMs` (`physicalElapsedMs === physicalReturnedAtMs`) | `ms` | `physicalReturnedAtMs` | Nunca |
| `returnDelayMs` | Derivado de `physicalReturnedAtMs` e `logicalExpiredAtMs` | Latência física entre a expiração lógica e o efetivo retorno ao chamador | `ms` | `logicalExpiredAtMs !== null ? Math.max(0, physicalReturnedAtMs - logicalExpiredAtMs) : null` | Quando `logicalExpiredAtMs === null` |
| `cutoffOvershootMs` | Derivado de `physicalReturnedAtMs` e `logicalCutoffMs` | Excesso físico do retorno além de `3976 ms` | `ms` | `Math.max(0, physicalReturnedAtMs - logicalCutoffMs)` | Nunca |
| `deadlineOvershootMs` | Derivado de `physicalReturnedAtMs` e `deadlineMs` | Excesso físico do retorno além de `4000 ms` | `ms` | `Math.max(0, physicalReturnedAtMs - deadlineMs)` | Nunca |
| `cleanupConfirmed` | Retorno booleano de `state.cleanup(verify)` executado dentro de `lease.cleanupUntil` | Confirma se o renderer concluiu a remoção da referência/listeners dentro da janela válida | `boolean` | `cleanup?.cleanupConfirmed === true` | Nunca (`boolean`) |

> **Observação sobre `eventLoopDelayMs`:** O nome `eventLoopDelayMs` foi removido por ser semanticamente enganoso (na W3 media apenas `max(0, logicalExpiredAtMs - logicalCutoffMs)` com valor `0` mesmo quando o retorno físico cruzava `3976 ms`). A separação explícita em `timerFiredAtMs`, `timerDelayMs`, `timerDriftMs`, `returnDelayMs`, `cutoffOvershootMs` e `deadlineOvershootMs` distingue o disparo do timer do retorno ao chamador.

## 2. Contrato de Snapshot no Retorno vs. Dispose/Cleanup Tardio

- **`metricsSnapshotScope`**: `'partial-at-return'` quando existe ao menos uma operação de `dispose()` ou promessa pendente em `lateTasks`; `'final-at-return'` quando todos os recursos já encerraram antes do retorno.
- **`metricsPartialAtReturn`**: booleano explícito (`true` quando ainda há `lateDisposalPending`, evitando interpretar `disposeErrorsAtReturn: []` como estado final completo).
- **`disposeErrorsAtReturn` / `cleanupErrorsAtReturn`**: erros observados **até** o instante do retorno.
- **`lateSettlement`**: objeto separado que acompanha a resolução assíncrona pós-retorno (`pending`, `scope: 'pending' | 'final-settled' | 'final-at-return'`, `lateDisposedController`, `lateDisposedPolling`, `lateDisposeErrors`, `lateCleanupErrors`, `finalResources`, `settledAtMs`, além da Promise não-enumerável `lateSettlement.settled`).
- Erros de `dispose()` nunca substituem o erro primário e nunca vazam como `UnhandledPromiseRejection`.
