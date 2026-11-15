# Entrega para revisão — Google/Supabase Auth

**Data:** 2026-11-15. **Publicação não autorizada / não realizada pelo agente.**

## Base e escopo

Reconstrução sobre a **main remota `99cffc9147d72cc4eedd2eaf47310fc135815c3b`**, reconferida com `git fetch origin main`. A implementação anterior apenas local não foi usada como base. A branch da sessão é `arena/468b7e01-forja` (nome fixo do ambiente; não foi criada/trocada uma branch `feature/forja-google-auth`).

A entrega é para revisão em PR contra `main`. **Não fazer merge, publicar ou disparar workflows de deploy sem nova autorização.** Nenhum SQL, PGlite, mudança de schema/RLS/privilégios, configuração de Supabase/Google Cloud, credencial real privada ou execução de workflow fez parte desta reconstrução.

### O que mudou

- Login exclusivo por Google com SDK oficial Supabase **2.119.0**, PKCE S256 e validação remota `getUser`; sem senha própria, visitante ou anonymous sign-in.
- Guard nas 15 páginas, inclusive URLs diretas, antes de carregar dados pessoais. JavaScript desativado, falha de configuração/rede e sessão inválida não abrem acesso alternativo.
- Retorno à página **originalmente solicitada**, com subpasta `/forja/`, query/fragmento permitidos e onboarding intermediário quando necessário.
- Sessão persistida/refresh do SDK, invalidação entre abas, expiração, logout, BFCache e respostas atrasadas. Escritas conferem a sessão/UID antes mesmo do evento `storage`.
- Dados locais e rascunhos por UID sem trocar/apagar um conjunto global. Eventos físicos são normalizados somente para a conta ativa. Refresh da mesma conta preserva rascunho do editor; trocar UID exige novo documento.
- Legado com consentimento mostrando a conta correta, dono antes da cópia, Web Lock, journal recuperável, strings/checksum/readback e retomada de falhas, sem descartar originais.
- Cópia inicial em `user_data_imports` com JWT do usuário, UID+checksum, INSERT idempotente sem UPDATE e SELECT/readback antes de confirmar. **Não foi implementada sincronização contínua.**
- Configurações mostra conta, logout e estado/nova tentativa da cópia inicial. “Sair das configurações” continua apenas navegando, sem logout inesperado.
- Configuração pública somente no artefato por `FORJA_SUPABASE_URL` / `FORJA_SUPABASE_ANON_KEY`; fonte mantém chave vazia. Build/CSP/licença/SDK/links/assets e regras existentes da Netlify preservados. Nenhuma funcionalidade ou asset 3D reintroduzido.
- Harness, testes multipágina e ferramenta de capturas adaptados para passar pelo Auth real do SDK com serviços HTTP fictícios, não por bypass no código de produção.

## Validação executada

| Comando / verificação | Resultado | Limite da evidência |
| --- | --- | --- |
| `npm test` | **450/450**, exit 0 | Inclui regressão de domínio e, dentro desse total, Auth **32/32** + build/config **12/12** |
| `npm run test:auth:e2e` | **19/19**, exit 0 | Chromium e SDK reais; Google/Auth/PostgREST **simulados** |
| `npm run test:e2e` | **46/46**, exit 0 | Regressão multipágina sob `/forja/`, Auth HTTP simulado, sem erros JS no fluxo |
| `node tools/capturas-configuracoes.mjs --out .cache/capturas-configuracoes-auth` | **10 capturas**, zero overflow, zero erro de console | Fixture visual explícita; não demonstra autenticação remota real |
| `npm run vendor:supabase -- --check` | Distribuição, licença e SHA-256 conferidos | Bundle oficial fixado e sem alteração |
| Builds locais pela suíte de configuração | Login/15 rotas/SDK presentes, **148 WebP**, links relativos OK; ausência/segredos/symlinks recusados | Só configuração pública fictícia; não foi deploy |
| `node --check` nos JS/MJS novos/alterados, `bash -n`, `git diff --check` | Sem erro | Validação estática local |
| `npm audit --omit=dev` | **0 vulnerabilidades** de runtime | Não é auditoria de RLS, Google ou aplicação inteira |
| `npm audit` completo | **10 high**, restritas à cadeia de desenvolvimento já existente do Puppeteer | Pendência de manutenção; não foi feito upgrade major/`audit fix --force` fora do escopo |

Os 450 checks incluem os fluxos existentes de calendário/missões, onboarding, planejamento, rotinas, execução/descanso, métricas, backup/restauração, biblioteca/grupos/atlas, evolução, configurações e vídeos/proxy. O teste visual agora aguarda o Auth após reload de viewport e o fim da transição CSS antes de conferir cores; não foi alterado o design dessas telas para contornar teste.

A matriz de Auth cobre cancelamento/falha/código PKCE inválido, sessão persistida/renovada/revogada, acesso direto às 15 páginas, logout com erro remoto, A → B → A, escrita stale, getUser atrasado, rascunho no refresh, consentimento trocando de conta, espera por Web Lock, quota, recuperação parcial/conflitante, checksum inválido, falha/readback remoto divergente, repetição idempotente e exclusão de tokens/dados de B dos backups. Os testes cruzados de SELECT/INSERT/UPDATE/DELETE são **fixtures HTTP**, não prova de políticas do banco real.

O bundle oficial mantém seu whitespace original; `.gitattributes` impede normalização de fim de linha e limita a exceção de whitespace a esse arquivo de terceiro. O verificador de vendor exige identidade byte a byte.

Logs e capturas de teste ficam em `.cache/` ou diretório temporário, não no Git/artefato publicado. Comandos podem ser reexecutados sem credenciais reais e sem SQL. O bundle tem SHA-256 `a867edbcfb029370aeec7223dd6180b560b621fbe3bc64c6584fb0369d1b7bce` (MIT; licença incluída).

## Configuração a conferir manualmente

Guia completo, arquitetura, recuperação e checklist: [autenticacao-google.md](autenticacao-google.md).

1. **GitHub Repository Variables:** `FORJA_SUPABASE_URL=https://abundydxjclcgonctirx.supabase.co` e `FORJA_SUPABASE_ANON_KEY` com a chave **publishable/anon** do projeto. O cadastro remoto não foi confirmado: a API de variables não permitiu listagem. Não colocar `service_role`, `sb_secret` ou Client Secret nessas variáveis.
2. **Netlify:** as duas variáveis públicas no ambiente do build; Functions/segredos de backend mantidos separadamente. Conferir também as regras externas de Deploy Preview/publicação. Nenhum painel foi alterado nesta sessão.
3. **Google Cloud:** OAuth Web, consentimento/usuários de teste, origens corretas e callback **`https://abundydxjclcgonctirx.supabase.co/auth/v1/callback`**. Client Secret somente no provider do Supabase.
4. **Supabase Auth:** Google habilitado, entradas email/senha e anonymous desabilitadas conforme a política do projeto; Site URL canônica e Redirect URLs exatas abaixo. O frontend rejeita tipos não Google, mas não administra esses painéis.

```text
https://1rayke1.github.io/forja/login.html
https://prismatic-parfait-be3644.netlify.app/login.html
http://localhost:8080/login.html
http://127.0.0.1:8080/login.html
http://localhost:8080/forja/login.html
http://127.0.0.1:8080/forja/login.html
```

As origens JavaScript do Google não levam `/forja/` ou `/login.html`. O callback Google é o do Supabase; os URLs acima são retornos ao app allowlisted no Supabase. Iniciar/concluir PKCE na mesma aba/origem.

## Pendências e limites para homologação real

- **Google/Supabase/RLS reais ainda não homologados.** Os serviços remotos não foram usados nestes testes, nem uma chave pública real foi obtida/injetada. Conferir login/consentimento/refresh/revogação/retorno com contas Google reais em ambiente aprovado.
- As oito tabelas/16 políticas/RLS/FORCE RLS/privilégios e UPDATE negado em `user_data_imports` são informações fornecidas pelo usuário, **não uma nova auditoria remota feita pelo agente**. Homologar isolamento com dois JWTs reais via SDK/PostgREST, sem SQL ou credencial privilegiada, somente com dados/ambiente e eventuais escritas autorizados.
- A cópia inicial é um snapshot fixo do primeiro vínculo, anterior às migrações/uso posterior. Para uma conta nova pode estar vazia; não é backup diário, sincronização das outras sete tabelas ou restauração entre aparelhos.
- Originais locais, journals e cópia de segurança não devem ser apagados para “forçar” uma migração. Erros de dono/checksum/conflito param a operação; seguir o guia de recuperação.
- Namespace local não protege contra DevTools/XSS/extensões nem substitui RLS. Auth remoto indisponível no boot mantém o conteúdo fechado: não existe modo offline/visitante.
- Logout é local à sessão e às abas dessa origem, com revogação remota best effort. Não garante invalidação instantânea de access tokens já emitidos nem logout de todos os aparelhos.
- Os 10 alertas high de desenvolvimento do Puppeteer já pertenciam ao conjunto de dependências da base; precisam de manutenção separada. Não fazem parte do bundle Auth do navegador ou das dependências de runtime auditadas sem dev.
- Documentos antigos de design/auditorias preservados no repositório são registros históricos. Para o comportamento atual de conta/armazenamento, prevalecem README e o guia de autenticação desta entrega.

## Lista completa dos arquivos desta entrega

**65 arquivos** (incluindo este relatório); agrupamento principal:

- Entrada/guard/SDK: login, Auth, proteção nas 15 páginas e fornecedor/licença.
- Domínio: boot, driver, plano/calendário, rascunhos/flash, backup e configurações; modelos/migrações de `forja-dados.js` não foram reescritos.
- Build/documentação: variáveis, workflow main-only, Netlify, preparo e guias.
- Testes/ferramentas: fixtures/harness, regressões, Auth/browser/build e capturas.

```text
.env.example
.gitattributes
.github/workflows/static.yml
.gitignore
README.md
admin/exercicios.html
assets/css/auth-guard.css
assets/css/login.css
assets/js/admin-exercicios.js
assets/js/forja-app.js
assets/js/forja-auth-data.js
assets/js/forja-auth-guard.js
assets/js/forja-auth.js
assets/js/forja-backup.js
assets/js/forja-calendario.js
assets/js/forja-configuracoes.js
assets/js/forja-core.js
assets/js/forja-login.js
assets/js/forja-onboarding.js
assets/js/forja-plano.js
assets/js/forja-store.js
assets/js/forja-supabase-config.js
assets/vendor/supabase/LICENSE
assets/vendor/supabase/README.md
assets/vendor/supabase/supabase.js
configuracoes/index.html
docs/autenticacao-google.md
docs/entrega-google-auth.md
exercicio/index.html
explorar/atlas.html
explorar/index.html
index.html
login.html
netlify.toml
onboarding/index.html
package-lock.json
package.json
progresso/index.html
tests/atlas.test.mjs
tests/auth-config.test.mjs
tests/auth.browser.mjs
tests/auth.test.mjs
tests/e2e.browser.mjs
tests/exercicio-apresentacao.test.mjs
tests/forja.test.mjs
tests/grupo-muscular.test.mjs
tests/helpers/auth-fixture.mjs
tests/helpers/browser-auth.mjs
tests/helpers/browser.mjs
tests/helpers/harness.mjs
tests/helpers/legacy-flows.mjs
tests/onboarding.test.mjs
tests/paridade.test.mjs
tests/youtube-frontend.test.mjs
tools/capturas-configuracoes.mjs
tools/configurar-auth.mjs
tools/preparar-site.sh
tools/sincronizar-supabase.mjs
treino/biblioteca.html
treino/calistenia.html
treino/executar.html
treino/grupo.html
treino/index.html
treino/musculacao.html
treino/rotina.html
```
