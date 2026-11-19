# Registro histórico — evidências da auditoria local anterior de Auth

> **Registro histórico, não parecer atual.** A auditoria readonly posterior a esta entrega encontrou duas corridas bloqueadoras (refresh antigo × nova sessão e BroadcastChannel antigo × nova intenção Google). A correção local autorizada, seus novos RED→GREEN, resultados e limites estão em [Correção das últimas corridas de Auth](correcao-concorrencia-auth.md). Os números e aprovações abaixo pertencem à rodada anterior; não autorizam merge, publicação ou homologação remota.

Síntese persistente da rodada descrita no [relatório final](validacao-auth-auditoria-final.md). Não é homologação de Google/Supabase/RLS reais nem autorização de publicação. Data de referência da sessão: **2026-11-15**.

## Proveniência e execução

- Checkout: `/home/user/forja`; branch fixa `arena/468b7e01-forja`; HEAD `99cffc9147d72cc4eedd2eaf47310fc135815c3b`.
- Área de trabalho isolada: `/tmp/forja-final-fixes-gtygc81v` (cópias `before`, `original-runtime`, `cas-control`, `current`). Testes não executados contra serviços/contas reais.
- Manifesto de entrada: 799 caminhos → SHA-256; fingerprint canônico **`cb52fa4d47918f39ddd190d0ce8ed669c631e087b24f4f6949df196f110441aa`** (JSON com chaves ordenadas e separadores compactos).
- Cada execução padronizada tem `.log`, `.exit` e `.json`: comando/cwd, hashes de runtime/testes, duração monotônica, exit code e `changedDuringRun`. Este último ficou vazio nas execuções registradas.
- Node **22.22.3**, npm **10.9.8**, Chromium **138.0.7204.0**, SDK oficial **2.119.0**. Dependências instaladas do lockfile em cópia isolada, sem scripts de instalação. O harness unitário jsdom simula Web Locks; os cenários Chromium usam storage e Web Locks reais do navegador.
- HOME/TMP/npm cache próprios. Preload de teste bloqueia fetch/HTTP Node não loopback e escrita no checkout durante as execuções isoladas; observa argumentos do Chromium. Fixtures do navegador respondem/interceptam serviços externos, usando o host fictício `forja-auth-tests.supabase.co` e JWTs deliberadamente inválidos.

**Logs redigidos preservados fora de `/tmp`:** `/home/user/forja/.cache/auditoria-auth-final/`, com arquivo `evidencias-auth-final.zip`. Seguem a convenção de artefatos locais ignorados: não entram no Git/build/deploy. O arquivo contém logs/metadados, manifesto de hashes, instrumentos de execução/diagnóstico e fontes dos contrafactuais relevantes; não contém dependências, tarball do repositório, credenciais ou dados reais. JWTs e refresh/codes fictícios nos logs são redigidos. O manifesto distingue SHA-256 do log bruto e do arquivo redigido. Esta síntese e o relatório guardam os resultados essenciais independentemente do ciclo de vida do cache local.

## 1. Execuções completas

Prefixos abaixo identificam os arquivos de log/metadados no arquivo local; tempos não são benchmark de performance (houve execução paralela).

| Prefixo | Comando | Exit | Resultado | Segundos |
| --- | --- | --- | --- | --- |
| `full-npm-test-1` | `npm test` | 0 | 491/491 | 390,828 |
| `full-npm-test-2` | `npm test` | 0 | 491/491 | 516,360 |
| `full-auth-browser-1` | `npm run test:auth:e2e` | 0 | 29 + 19 + 11 = 59/59 | 126,529 |
| `full-auth-browser-2` | mesmo comando | 0 | 59/59 | 181,174 |
| `full-auth-browser-3` | mesmo comando | 0 | 59/59 | 186,210 |
| `full-auth-browser-4-final` | mesmo comando, fixture final | 0 | 59/59 | 118,795 |
| `full-general-browser-1` | `npm run test:e2e` | 0 | 46/46 | 445,754 |

Trechos dos logs finais:

```text
AUTH — 43/43 testes aprovados (SDK real / HTTP simulado; zero SQL).
CONFIG — 12/12 testes aprovados (zero deploy/SQL).
AUTH RECOVERY — 19/19 testes aprovados. SDK real, HTTP simulado/local, zero SQL.
AUTH CONCURRENCY — 11/11 testes aprovados. SDK real, serviços fictícios, zero SQL.

BROWSER AUTH — 29/29 testes aprovados.
BROWSER RECOVERY — 19/19 testes aprovados.
BROWSER CONCURRENCY — 11/11 testes aprovados.

E2E navegador real (Auth/Google/PostgREST simulados) — 46/46 verificações aprovadas
```

Conferência de contagem: os rodapés de `npm test` somam **488**; os três resultados integrados sem rodapé são **Endpoint**, **Plano** e **Planejamento**, totalizando **491**. Os 43 Auth, 12 config, 19 recovery e 11 concurrency já estão incluídos. Não somar de novo nem apresentar execuções repetidas como casos distintos.

## 2. Lotes de repetibilidade (quantidade fixa; fail-fast)

| Rodada | `case29-repeat-N` (exit 0, 1/1) | `concurrency-repeat-N` (exit 0, 11/11 + 11/11) |
| --- | --- | --- |
| 1 | 11,417 s | 69,334 s |
| 2 | 10,883 s | 42,677 s |
| 3 | 13,931 s | 34,491 s |
| 4 | 16,210 s | 26,288 s |
| 5 | 12,381 s | 27,801 s |

O cenário 29 manteve o mesmo corpo com barreiras em todas essas execuções e nas quatro suítes completas. O último ajuste da fixture concurrency 4 lê o mesmo slot compartilhado pelo documento A retido, para obter RED contratual mesmo se o runtime defeituoso navegar B; não relaxa a igualdade exata nem afeta o cenário 29.

Comandos reproduzíveis, após instalar as dependências no ambiente local:

```sh
npm test
npm run test:auth:e2e
npm run test:e2e
npm run test:auth:concurrency
FORJA_AUTH_BROWSER_CASE=29 node tests/auth.browser.mjs
# Filtro opcional dos cenários novos (IDs separados por vírgula):
FORJA_AUTH_CONCURRENCY_CASE=4,5,7,8 npm run test:auth:concurrency
npm run vendor:supabase -- --check
```

O filtro não é aplicado às execuções completas. As guardas dos runners recusam seleção vazia; o filtro do cenário 29 exige exatamente um teste. Não há `skip`/`only`, retry até passar ou aumento de timeouts de produção/teste.

## 3. Controles RED e preservação

| Prefixo | Runtime / execução | Exit | Resultado |
| --- | --- | --- | --- |
| `red-before-unit-verified` | Runtime local anterior, testes novos | 1 | 3/11; falham 1–5, 7, 8, 11 |
| `red-before-browser-final` | Mesmo runtime, Chromium/fixture final | 1 | 2/11; falham 1–8, 11 |
| `red-pr71-unit-final` | Quatro módulos Auth originais do PR | 1 | 3/11; falham 1–5, 9–11 |
| `red-pr71-browser` | Módulos originais, Chromium | 1 | 2/11; falham 1–6, 9–11 |
| `red-without-cas-case5` | Corrigido, retirando somente CAS das chaves PKCE compartilhadas | 1 | 0/1, verifier B removido após leitura A |
| `green-cas-case5` | Mesmo caso, CAS presente | 0 | 1/1 |
| `red-pr71-case29` | Cenário 29 com módulos originais | 1 | 0/1, rejeição antiga remove B |
| `red-pr71-recovery-unit` | Recovery anterior contra módulos originais | 1 | 5/19; centrais 1–3 falham |
| `red-pr71-recovery-browser` | Mesmo controle, Chromium | 1 | 5/19; centrais 1–3 falham |

`original-runtime` não é outra branch: é uma cópia de teste que recebe `forja-auth.js`, `forja-auth-guard.js`, `forja-login.js` e `admin-exercicios.js` do head original `15c531e0b6a6a209c548cfa172b9ee313188c9ef`. Demais fontes/fixtures são da cópia isolada. Vendor e lockfile foram conferidos iguais; não se alega que todo o checkout original foi reconstituído/testado integralmente.

Falhas contratuais observadas no RED, sem publicar valores de tokens:

```text
primeira ação deve fechar o DOM: 'ready' !== 'locked'
saída incompleta precisa de retry próprio, não de reautorização
PKCE antigo substituiu B
cleanup antigo apagou verifier de B
sessão rotacionada sobreviveu ao logout
CAS do cleanup removeu verifier B gravado depois da leitura A
rejeição antiga removeu B
```

Os cenários storage Chromium também falham no runtime anterior por não restaurar o botão/finalizar a saída dentro do mesmo limite de 3 s. Os controles que já passavam não são apresentados como novas reproduções: rotação 7/8 passa no PR original, mas falha no runtime local anterior às correções finais. Em `auth-recovery.*`, o corrigido permanece em **19/19** nas duas modalidades e os três centrais em **3/3**; os arquivos dessas suítes não foram editados nesta rodada.

## 4. Segurança web, diagnósticos e estática

`web-security-proof.log`, exit 0:

```json
{
  "browser": "HeadlessChrome/138.0.7204.0",
  "cors": "TypeError",
  "sop": "SecurityError",
  "unsafeLaunchFlags": 0
}
```

A prova usa dois servidores/origens locais: fetch sem CORS e acesso ao DOM de iframe cross-origin precisam ser recusados. O observador registrou **34 launches**, **zero flags inseguras** e nenhum evento de bloqueio Node/escrita no checkout. Os helpers conferem também os argumentos reais. Isso não é uma captura absoluta de toda rede do processo Chromium, nem declaração de `crossOriginIsolated`/COOP/COEP. `--no-sandbox` não desliga SOP/CORS.

`storage-first-read-diagnostic.log`, exit 0, classificou a primeira leitura recusada da fixture antiga como:

```text
beforeClick: true; gate: ready; state: authenticated
workoutTick → canWrite → isVerified → storedToken → getItem
```

Por isso a falha agora é armada no capture do clique, antes do handler do botão. A asserção não foi removida: exige primeiro acesso com estado não autenticado **e gate locked**. Os logs intermediários de RED com setup OAuth incompleto e Chromium 10/11 também estão retidos e não são usados como aprovação/RED contratual. O RED final e o GREEN completo foram reexecutados depois dos ajustes de fixture.

`static-and-integrity.{log,json}` registra:

- `node --check`: **93/93** JS/MJS, incluindo arquivos não rastreados;
- `bash -n tools/preparar-site.sh`, `git diff --check` e whitespace dos arquivos incrementais: sem erro;
- **799 de entrada → 790 idênticos + 9 existentes alterados + 5 novos; zero removidos**;
- branch/HEAD/índice preservados; índice SHA-256 `f852072a74f756d642b2871c38d1a924526f549d1c7feb0f4395c1ef44bbb249`;
- 14 arquivos protegidos byte a byte iguais à entrada (suítes anteriores, helper recovery, Admin/guard/login/driver/app, lockfile e vendor);
- 19 corpos Chromium originais do PR idênticos; E2E geral intacto, **589 chamadas `assert`**; Auth unitário intacto, **163 chamadas `assert`**;
- fornecedor: distribuição, licença e SHA-256 conferidos por `vendor-check`, exit 0.

## 5. Hashes de runtime e testes

SHA-256 de `assets/js/forja-auth.js` por controle:

```text
before           6b85b653106b4f6fef11de3cac4c35482ea4f8d2b18a0b70a5b1daf8915def50
original-runtime 7dee1dca8c2cc2752a23f6c4b6c79e0e9589dc3f0b33797489af861aae61cc69
cas-control      c188fd76ea7651922136f0f02133f0fda4ffca263b0a32b16f1dc0b78703d1d0
current          141f2961b3fedc08ab4abdfe320b7ddaaf3b9001c1b7b1e7ce783aeae03cc201
```

Arquivos finais de execução:

```text
assets/vendor/supabase/supabase.js a867edbcfb029370aeec7223dd6180b560b621fbe3bc64c6584fb0369d1b7bce
package-lock.json                 b490e9738f8c589f3e84700468a0d49f78a9cbfe38abf0c1282d135951f49cd6
tests/auth-concurrency.test.mjs    d7c79567edf052ae43a2c6fec343bda36b10b377f9d530487925b8d030a455ae
tests/auth-concurrency.browser.mjs c384a3588b73f73698d9f88582c52f80e63005d9c53ccaddd0126c4d720fb9b5
tests/helpers/auth-concurrency.mjs 1da928bc3d3332ed4a3fa647f8b693ea204d202509cfe5406081f22fbfdbbbac
tests/auth.browser.mjs             2d9c53b8ef3be93949405ab14d7a43dbd76962c1025c1de16401e7595825980b
```

**Limites inalterados:** sem SQL/PGlite; nenhum segredo ou conta real; sem homologação remota de Google/Auth/PostgREST/RLS, Safari/aparelho físico ou deploy. As seis não conformidades backend e o primeiro erro do deploy falho continuam pendentes. Nenhuma ação remota foi tomada nesta implementação; aguardar autorização.
