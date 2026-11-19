# Guia e Roteiro de Homologação Real — Google OAuth + Supabase Auth (PR #71)

> **Importante:** os testes automatizados deste repositório validam o SDK oficial `@supabase/supabase-js` (`2.119.0`) e o comportamento no Chromium com servidores HTTP simulados. **Google OAuth real, consentimento Google Cloud, JWT assinado em produção e RLS remoto no projeto só ficam homologados após a execução manual deste roteiro** com duas contas Google reais (Conta A e Conta B).

---

## 1. Estado consolidado antes da homologação

### Confirmado em código, no workflow e nos painéis externos
- **Projeto Supabase (`abundydxjclcgonctirx`):** status `ACTIVE_HEALTHY`, origem `https://abundydxjclcgonctirx.supabase.co`, Postgres `17`.
- **Google Cloud Console:** callback oficial do Supabase (`https://abundydxjclcgonctirx.supabase.co/auth/v1/callback`) cadastrado.
- **Supabase Auth (verificado em leitura + confirmação do operador):**
  - Provider Google habilitado (`external_google_enabled: true`, `external_google_skip_nonce_check: false`, `external_anonymous_users_enabled: false`, `refresh_token_rotation_enabled: true`).
  - `site_url`: `https://1rayke1.github.io/forja/`.
  - `uri_allow_list` atual: `https://1rayke1.github.io/forja/,https://1rayke1.github.io/forja/login.html`.
  - Banco/RLS (`public`): 8 tabelas (`activity_history`, `goals`, `profiles`, `progress_entries`, `routines`, `user_data_imports`, `user_preferences`, `user_settings`) com `RLS` e `FORCE RLS`, 16 políticas para `authenticated`, zero privilégios a `anon`, e `user_data_imports` sem `UPDATE`.
- **GitHub Repository Variables:** `FORJA_SUPABASE_URL` e `FORJA_SUPABASE_ANON_KEY` confirmadas pelo responsável no repositório (a API REST retorna HTTP `403` para o token de integração da auditoria, impedindo listagem automática).
- **Netlify:** variáveis adicionadas nos contextos disponíveis, porém **deploys de produção da Netlify estão pausados por limitação de créditos** (sem upgrade).
- **Pipeline `.github/workflows/static.yml` (PR #71):**
  - Job `deploy` restrito a `if: github.ref == 'refs/heads/main'` e environment `github-pages`.
  - Setup de Node `22`, build via `bash tools/preparar-site.sh site-publicado` recebendo `FORJA_SUPABASE_URL` e `FORJA_SUPABASE_ANON_KEY` de `vars.*`, nunca de `secrets.*`.
  - `assets/js/forja-supabase-config.js` mantém `anonKey: ""` no código-fonte; `tools/configurar-auth.mjs` injeta apenas URL pública e chave `sb_publishable_` ou JWT `role: "anon"` exclusivamente no artefato gerado, recusando e abortando caso receba `sb_secret_`, `service_role` ou segredo equivalente.

### Pontos de atenção e divergências documentadas
- **PR #71 remoto vs. workspace consolidado:** o PR #71 no GitHub (`headRefOid: 15c531e0`) ainda reflete o commit anterior; as correções consolidadas locais (corridas Auth, recovery HTTP de 12 s, helper W4, `safeReturn`, `forja-login.js` e este guia) permanecem locais até decisão de commit/push após validação.
- **GitHub Pages sem preview por PR:** como o GitHub Pages publica apenas a branch `main` (`https://1rayke1.github.io/forja/`) e a Netlify está pausada, a pré-homologação segura **antes do merge** deve ocorrer em build local idêntico sob `http://localhost:8080/forja/`.
- **Allowlist temporária necessária apenas para `localhost`:** para `https://1rayke1.github.io/forja/`, nenhuma URL falta no Supabase. Para testar `http://localhost:8080/forja/` antes de publicar na `main`, é obrigatório adicionar temporariamente as URLs locais à `uri_allow_list` do Supabase (e removê-las ao término).
- **Provider Email no Supabase:** `external_email_enabled` ainda está `true` no servidor; embora o frontend bloqueie qualquer sessão com `provider !== "google"`, recomenda-se desativar **Email** no painel Auth do Supabase.
- **Netlify vs. allowlist:** `https://prismatic-parfait-be3644.netlify.app/login.html` e `/` não constam na `uri_allow_list` atual do Supabase; caso os deploys da Netlify sejam reativados no futuro, adicione essas URLs antes de autenticar por lá.
- **Registros históricos:** documentos de auditoria anteriores em `docs/` (`autenticacao-google.md`, `entrega-google-auth.md`, `validacao-login-google.md`, `validacao-auth-auditoria-final.md`) registram o estado anterior à confirmação manual das variáveis no GitHub/Netlify e são mantidos intactos como trilha de auditoria.

---

## 2. Configuração e uso de variáveis

| Variável | Onde configurar | Valor / formato permitido | Restrições de segurança |
| --- | --- | --- | --- |
| `FORJA_SUPABASE_URL` | GitHub Repository Variables / Netlify / shell local de build | `https://abundydxjclcgonctirx.supabase.co` | Apenas origem HTTPS `*.supabase.co`, sem caminho, barra final ou credencial |
| `FORJA_SUPABASE_ANON_KEY` | GitHub Repository Variables / Netlify / shell local de build | Chave **publishable** (`sb_publishable_...`) ou JWT com `role: "anon"` do projeto `abundydxjclcgonctirx` | **Nunca** usar `service_role`, `sb_secret_` ou Google Client Secret (`tools/configurar-auth.mjs` falha e não imprime valores) |

> **Importante:** o `Client Secret` do Google OAuth deve permanecer **exclusivamente** em **Supabase → Authentication → Providers → Google**, nunca em variáveis do frontend, GitHub Actions ou Netlify.

---

## 3. Procedimento reproduzível de homologação local em `http://localhost:8080/forja/`

Este procedimento gera exatamente o mesmo artefato da publicação usando `tools/preparar-site.sh`, **fora do checkout** (`/tmp/forja-homolog`), sem alterar código-fonte, sem tocar na branch `main` e sem expor credenciais privadas.

### Passo A — Adicionar Redirect URLs temporárias no Supabase
No painel do projeto `abundydxjclcgonctirx`, em **Authentication → URL Configuration → Redirect URLs**, adicione temporariamente estas duas entradas exatas (mantendo **Site URL** em `https://1rayke1.github.io/forja/`):

```text
http://localhost:8080/forja/
http://localhost:8080/forja/login.html
```

> **Por quê:** `@supabase/supabase-js@2.119.0` envia `redirectTo = http://localhost:8080/forja/login.html` sem `flow_id` na URL. Sem essa entrada na allowlist, o Supabase redireciona para a `Site URL` de produção, onde o código do PR e o verifier PKCE do `sessionStorage` local não existem.

*(Verifique também no Google Cloud Console se a tela de consentimento está em **Testing** com as contas Google A e B cadastradas em **Test users**, ou em **In production**, e se `http://localhost:8080` / `https://1rayke1.github.io` constam em **Authorized JavaScript origins** caso necessário.)*

### Passo B — Gerar o build fora do checkout e servir em `/forja/`
Em um terminal na raiz `/home/user/forja` (use apenas variáveis exportadas na sessão atual, nunca gravadas em arquivo versionado):

```bash
export FORJA_SUPABASE_URL="https://abundydxjclcgonctirx.supabase.co"
export FORJA_SUPABASE_ANON_KEY="<cole-aqui-sua-chave-publishable-ou-anon>"

HOMOLOG_ROOT="/tmp/forja-homolog"
rm -rf "$HOMOLOG_ROOT"
mkdir -p "$HOMOLOG_ROOT"

# Usa o MESMO script do workflow de publicação, gerando fora do checkout sob /forja/
bash tools/preparar-site.sh "$HOMOLOG_ROOT/forja"

# Serve o diretório pai na porta 8080 para responder exatamente em http://localhost:8080/forja/
python3 -m http.server 8080 --bind 127.0.0.1 --directory "$HOMOLOG_ROOT"
```

Abra no navegador (perfil limpo):
- `http://localhost:8080/forja/`
- Use sempre o mesmo host (`localhost`, nunca misture `localhost` com `127.0.0.1` durante o OAuth, pois `sessionStorage`, `localStorage` e `navigator.locks` são isolados por origem).

### Passo C — Remover URLs temporárias e artefato após concluir
Ao terminar os testes do roteiro abaixo:

1. No terminal, interrompa o servidor (`Ctrl+C`), remova o artefato e limpe as variáveis da sessão:
   ```bash
   rm -rf /tmp/forja-homolog
   unset FORJA_SUPABASE_URL FORJA_SUPABASE_ANON_KEY
   ```
2. No painel do **Supabase (`abundydxjclcgonctirx`) → Authentication → URL Configuration → Redirect URLs**, **remova** as duas entradas temporárias:
   - `http://localhost:8080/forja/`
   - `http://localhost:8080/forja/login.html`
3. Confirme que a `uri_allow_list` voltou a conter apenas as URLs oficiais:
   - `https://1rayke1.github.io/forja/`
   - `https://1rayke1.github.io/forja/login.html`

---

## 4. Roteiro objetivo de homologação real (10 itens)

Execute na ordem em perfil limpo do navegador apontando para `http://localhost:8080/forja/` (pré-merge) e depois confirme o smoke test em `https://1rayke1.github.io/forja/` (somente após merge autorizado):

1. **Bloqueio sem autenticação:** acesse diretamente `http://localhost:8080/forja/index.html` e `http://localhost:8080/forja/configuracoes/index.html` → confirmar bloqueio imediato (`data-forja-auth="locked"`), redirecionamento para `http://localhost:8080/forja/login.html?next=...` e ausência de dados de usuário visíveis no DOM.
2. **Login Google real:** em `login.html`, clique em **Continuar com Google**, teste um cancelamento inicial (confirmar retorno sem `?error=`/`#error=` na URL e aviso `.is-error` com botão reabilitado), depois clique novamente e autentique com a **Conta Google A** real.
3. **Callback PKCE:** no DevTools → Network, confirmar redirecionamento para `https://abundydxjclcgonctirx.supabase.co/auth/v1/callback`, retorno para `.../forja/login.html?code=...`, chamada `POST /auth/v1/token?grant_type=pkce` (`200 OK`), chamada `GET /auth/v1/user` (`200 OK`, `app_metadata.provider === "google"`, `is_anonymous === false`), limpeza de `?code=` da barra de endereço e abertura na rota esperada (`onboarding/index.html` ou `index.html` / `next`).
4. **Persistência da sessão:** criar/editar uma rotina ou preferência com a Conta A; verificar em DevTools → Application → Local Storage a presença de `sb-abundydxjclcgonctirx-auth-token` e dos dados exclusivamente sob `forja-auth-data-v1:<uid_A>:*`; em **Configurações**, confirmar `#account-email` exibindo o email real da Conta A e eventual cópia inicial `user_data_imports` com readback/checksum válido.
5. **Reload e navegação:** recarregar (`F5` / `Ctrl+R`) na Home, Treinos, Progresso e Configurações → confirmar novo `GET /auth/v1/user` `200`, `document.documentElement.dataset.forjaAuth === "ready"`, dados preservados e retorno pelo botão **Voltar** (BFCache) revalidando antes de exibir conteúdo.
6. **Logout:** em Configurações da Conta A, clicar em **Sair da conta Google** → confirmar chamada `POST /auth/v1/logout`, remoção da chave `sb-abundydxjclcgonctirx-auth-token`, redirecionamento para `login.html`, preservação dos dados locais sob `forja-auth-data-v1:<uid_A>:*` e bloqueio mantido ao recarregar (`F5`).
7. **Bloqueio em múltiplas abas:** com duas abas abertas e autenticadas na Conta A (`index.html` e `treino/index.html`), acionar **Sair da conta Google** na aba 1 → confirmar que a aba 2 bloqueia imediatamente o conteúdo e navega para `login.html` sem exibir ou gravar dados após a saída.
8. **Isolamento de dados entre Conta Google A e Conta Google B:** entrar agora com uma **Conta Google B** real no mesmo navegador → confirmar que a interface abre vazia/própria de B (sem exibir rotinas, metas ou perfil de A), criando chaves exclusivamente sob `forja-auth-data-v1:<uid_B>:*`. Ao sair de B e entrar novamente com A, confirmar recuperação dos dados locais de A intactos (e caso teste dados legados anteriores ao login, confirmar que o vínculo exige clique explícito de consentimento).
9. **Verificação de RLS usando somente sessões reais e chaves públicas:** sem usar `service_role`, chave privada ou SQL direto, utilize o access token real da **Conta B** (obtido da sessão ativa de B no DevTools) e a chave pública `FORJA_SUPABASE_ANON_KEY` no console/HTTP client contra `https://abundydxjclcgonctirx.supabase.co/rest/v1/`:
   - `GET /rest/v1/user_data_imports?select=user_id,checksum` com JWT de B retorna apenas registros onde `user_id = uid_B` (nenhum registro de A);
   - `POST /rest/v1/user_data_imports` tentando gravar com `user_id = uid_A` usando o JWT de B retorna erro HTTP `401`/`403` de violação RLS;
   - `PATCH /rest/v1/user_data_imports` mesmo para `uid_B` é recusado pelo PostgreSQL (sem privilégio `UPDATE` para `authenticated`);
   - repetir checagem equivalente em `profiles` / `routines` confirmando isolamento estrito por `auth.uid() = user_id`.
10. **Limpeza das URLs temporárias:** remover `http://localhost:8080/forja/` e `http://localhost:8080/forja/login.html` da `uri_allow_list` do Supabase, apagar `/tmp/forja-homolog`, limpar variáveis locais da shell e validar que restam apenas `https://1rayke1.github.io/forja/` e `https://1rayke1.github.io/forja/login.html` no Supabase.

---

## 5. Referências de diagnóstico rápido

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| Volta para `https://1rayke1.github.io/forja/` ao testar localmente | Faltam URLs `localhost:8080/forja/` na allowlist temporária do Supabase | Adicionar as duas URLs do passo A em **Redirect URLs** no Supabase |
| `Este retorno de login expirou ou foi aberto em outra aba` | Misturou `localhost` com `127.0.0.1`, mudou de aba, ou demora > 10 min | Usar o mesmo host `localhost:8080` na mesma aba |
| `Configuração pública do Supabase ausente` | Abriu a raiz do repositório em vez do artefato gerado | Servir somente a pasta montada por `tools/preparar-site.sh` |
| `redirect_uri_mismatch` no Google | Divergência na URI de callback do Google Cloud | Confirmar `https://abundydxjclcgonctirx.supabase.co/auth/v1/callback` no Google Cloud |
| Erro HTTP `403` / acesso negado na tela do Google | Tela de consentimento em *Testing* sem o email testado | Adicionar Conta A e Conta B em *Test users* no Google Cloud Console |
