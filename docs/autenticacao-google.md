# Google + Supabase Auth no FORJA

## Escopo e limites

Integração reconstruída da `main` remota `99cffc9147d72cc4eedd2eaf47310fc135815c3b`, em 2026-11-15. O app continua estático, multipágina, com caminhos relativos e `body[data-root]`, compatível com GitHub Pages em `/forja/` e Netlify na raiz.

- **Google obrigatório** pelo SDK oficial `@supabase/supabase-js` **2.119.0**, PKCE S256, sem email/senha do FORJA, visitante ou Auth anônimo.
- Sessão persistida/renovada pelo SDK. A liberação depende de **`getUser(access_token)` no Auth**, com UID consistente, conta não anônima e provedor Google em `app_metadata`; dados locais/user_metadata não autorizam entrada.
- **Uso diário local por UID**, incluindo perfil, preferências, plano, missões, rotinas, biblioteca, histórico, metas, aparência e backup de segurança. Rascunhos/flash de navegação também são separados por UID.
- **Uma cópia inicial verificável** em `user_data_imports`. Não é sincronização contínua, espelhamento das oito tabelas, nem restauração remota automática.
- **Nenhum SQL**, alteração de schema, política, privilégio ou painel externo faz parte desta entrega. O usuário informou que o banco já tem oito tabelas, 16 políticas, RLS/FORCE RLS e UPDATE negado em `user_data_imports`. Isso não foi reinspecionado nem homologado remotamente por estes testes.

A fronteira de segurança remota é o JWT do usuário e o **RLS existente baseado em `auth.uid()`**. O guard não protege arquivos estáticos e o namespace local não é criptografia: DevTools, extensões, XSS ou alguém com acesso ao perfil do navegador podem ler o armazenamento local. Em computador compartilhado, use perfis separados do navegador e exporte seus backups.

## Arquitetura

Ordem nas páginas do aplicativo:

1. HTML começa com `data-forja-auth="locked"`; CSS esconde o conteúdo antes de qualquer script.
2. `forja-core.js` → configuração pública → SDK oficial → `forja-auth.js`.
3. `forja-store.js` → `forja-auth-data.js`, que instala inicialmente um driver bloqueado.
4. Auth remoto verificado → vínculo do namespace UID → migrações/modelos existentes (`F.bootData`) → gate do perfil → inicializador da página.
5. Só depois disso a interface é liberada e o intervalo de treino pode atuar. A cópia inicial remota é tentada sem impedir o uso local já preparado.

Arquivos de autenticação têm responsabilidades separadas:

| Arquivo | Responsabilidade |
| --- | --- |
| `forja-auth-guard.js` / `auth-guard.css` | Fechamento estático, `pagehide`, BFCache e interceptação de eventos de sessão antes dos listeners de negócio |
| `forja-auth.js` | SDK, sessão, verificação remota, PKCE, retorno, refresh, logout e mudanças de conta |
| `forja-auth-data.js` | Driver UID, consentimento do legado, Web Lock, journal, checksum e cópia/readback |
| `forja-login.js` / `login.html` / `login.css` | Única entrada: Google na mesma aba, estados de espera/cancelamento/falha |
| `forja-supabase-config.js` | Configuração pública; chave vazia no fonte e preenchida somente no artefato |

### Quinze páginas protegidas

```text
index.html
onboarding/index.html
treino/index.html
treino/calistenia.html
treino/musculacao.html
treino/biblioteca.html
treino/grupo.html
treino/rotina.html
treino/executar.html
progresso/index.html
explorar/index.html
explorar/atlas.html
exercicio/index.html
configuracoes/index.html
admin/exercicios.html
```

A administração exige **Google e a credencial administrativa já existente**. O backend administrativo da Netlify continua exigindo sua própria credencial, mantida somente na memória da aba; Google não concede automaticamente acesso administrativo.

### Retorno após OAuth e onboarding

`next` aceita apenas as 15 rotas acima, na mesma origem e dentro da raiz do app. Caminhos externos, outra subpasta, arquivos arbitrários, login recursivo e caminhos ambíguos são recusados. Query e fragmento normais são preservados; parâmetros de autenticação são removidos.

O destino fica em `sessionStorage` por até **30 minutos**; a tentativa OAuth vale **10 minutos**, exige o verifier PKCE e retorno na mesma aba/origem. O callback troca o código explicitamente (`detectSessionInUrl: false`) e limpa código/erros/tokens da URL. Sem perfil completo, o onboarding guarda o destino solicitado e o retoma ao concluir; perfil concluído não reabre o cadastro.

Inicie uma tentativa OAuth por vez no mesmo navegador/origem: o verifier do SDK é compartilhado entre abas. Tentativas concorrentes podem invalidar uma à outra; nesse caso o app permanece fechado e é necessário iniciar um novo login. Isso não é um modo visitante.

### Sessão, abas e navegação de volta

- `getSession` permite ao SDK renovar; só `getUser` autoriza. Fetch tem limite de 12 segundos; falha de rede mantém o gate fechado com nova tentativa.
- Toda operação do driver confere UID, expiração e token persistido **antes** de ler/gravar, mesmo antes da entrega do evento `storage`.
- Refresh da mesma conta revalida e atualiza a memória somente por leitura. Não reinicializa o editor nem apaga rascunho não salvo.
- Conta diferente fecha o conteúdo e recarrega a página para não reutilizar estado/closures da conta anterior. Respostas atrasadas são rechecadas por revisão/token/UID.
- `pagehide` fecha o snapshot. O retorno BFCache só chega aos listeners das telas depois de revalidação.
- Eventos físicos `forja-auth-*` não chegam aos módulos de domínio. Só alterações do namespace da conta ativa são traduzidas para os nomes lógicos que as telas já usam; eventos de outra conta não provocam releitura/redesenho.
- Logout usa `auth.signOut({ scope: "local" })`, bloqueia imediatamente, sinaliza às outras abas e remove a sessão local mesmo se a revogação remota falhar. **Não promete revogar instantaneamente um access token já emitido nem sair de todos os aparelhos**; isso depende da validade do JWT/serviço remoto. Os dados locais por conta não são apagados. Uma nova entrada explícita por Google é necessária.

## Dados locais, legado e recuperação

### Chaves físicas

| Chave/prefixo | Conteúdo |
| --- | --- |
| `sb-<project-ref>-auth-token` | Persistência de sessão do SDK oficial, nunca exportada no backup |
| `forja-auth-data-v1:<uid>:<chave-lógica>` | Dados locais daquela conta, mantendo formatos lógicos existentes |
| `forja-auth-tab-v1:<uid>:<chave-lógica>` | Rascunhos/flash no `sessionStorage` daquela aba/conta |
| `forja-auth-legacy-owner-v1` | Dono confirmado do conjunto legado sem conta |
| `forja-auth-copy-v1:<uid>` | Journal recuperável da cópia inicial, incluindo snapshot textual/checksum |

Não há troca de um conjunto global ao alternar contas: os dois namespaces permanecem separados. Infraestrutura Auth, arquivos internos e chaves que parecem credenciais/segredos não entram no backup ou na cópia remota. A cópia de segurança de restauração (`forja-backup-seguranca-v1`) continua local e não é enviada ao servidor.

### Primeiro vínculo

1. Dados antigos sem conta não são atribuídos silenciosamente. O gate mostra o email Google verificado e pede confirmação de vínculo; **“Usar a conta sem importar o legado” ainda exige Google** e deixa os originais intocados.
2. O vínculo do legado é serializado por **Web Locks**, em contexto seguro HTTPS/localhost. Sem esse recurso, o vínculo é bloqueado com orientação, sem apagar a origem.
3. Dentro do lock, sessão e dono são rechecados. O dono é gravado **antes** da cópia, para uma falha posterior nunca deixar o legado livre para outra conta.
4. Journal `preparing` guarda strings originais, chaves elegíveis desconhecidas, rascunhos e SHA-256. A cópia local exige readback; não substitui um destino conflitante.
5. A fase `pending` significa que a preparação local terminou. Os modelos/migrações existentes atuam somente no namespace autenticado; o conjunto legado original é preservado byte a byte.
6. Trocar de conta durante confirmação ou espera do lock cancela a operação antiga. Uma nova confirmação deve identificar a nova conta.

O snapshot é fixado no primeiro vínculo, **antes das migrações e do uso posterior**. Para uma conta nova sem dados, ele pode estar vazio; o perfil criado depois no onboarding não será continuamente enviado. Recusar o legado não o apaga nem cria sincronização posterior automática. Para mover dados depois, use exportação/importação JSON pela interface ou peça suporte para uma recuperação assistida.

### Cópia inicial remota

O cliente usa exclusivamente o JWT da sessão para escrever em `user_data_imports`:

- `user_id`: UID retornado pelo Auth;
- `checksum`: SHA-256 do mapa textual canônico, ordenado por chave;
- `format_version`: `1`;
- `raw_by_key`: objeto cujos valores são as strings originais.

É feito INSERT com conflito `(user_id,checksum)` e `ignoreDuplicates: true` (**não UPDATE**). Em seguida, SELECT filtrado por UID/checksum deve devolver os mesmos dados, versão e checksum; só então o journal recebe `confirmed`. O limite do contrato é 12 MiB; o cliente também limita o tamanho conservadoramente. `profiles`, `routines`, `activity_history`, `progress_entries`, `goals`, `user_preferences` e `user_settings` não recebem sincronização diária nesta etapa.

Em **Configurações → Privacidade e segurança**, o estado da cópia e o botão de nova tentativa distinguem pendência, envio, confirmação e falha. Uma falha de envio/readback não apaga a origem nem impede o uso local já preparado. Repetir a cópia usa o mesmo snapshot/checksum, não um novo backup diário.

| Falha | Comportamento / recuperação |
| --- | --- |
| Rede/Auth indisponível ou sessão expirada sem refresh válido | Conteúdo fechado; tentar novamente ou entrar com Google; dados locais preservados |
| Quota/falha ao gravar vínculo/journal/namespace | Preparação para; liberar espaço com cuidado e usar **Tentar novamente**, sem apagar origem/journals |
| Journal `preparing` interrompido | Retoma as chaves faltantes com o mesmo dono; destino diferente bloqueia em vez de sobrescrever |
| Dono/journal ilegível, checksum local divergente ou conflito | Fail closed; preserve o perfil do navegador e peça suporte; não edite/apague marcadores para “forçar” importação |
| PostgREST recusa, falha de rede ou readback divergente | Permanece `pending`; nova tentativa pela interface; nunca marca confirmação sem conferir |
| Logout / conta B | Dados de A ficam no namespace de A; B não herda legado/backup/rascunho de A |

A cópia inicial não substitui backup JSON atualizado. Limpar o navegador pode apagar tanto dados diários quanto os registros locais de recuperação; não existe restauração remota automática.

## Configuração pública e preparo do artefato

Projeto previsto: **`https://abundydxjclcgonctirx.supabase.co`**.

| Variável | Onde | Valor esperado |
| --- | --- | --- |
| `FORJA_SUPABASE_URL` | GitHub **Repository Variables**, ambiente de build Netlify ou shell local | URL acima, apenas origem HTTPS |
| `FORJA_SUPABASE_ANON_KEY` | Nos mesmos ambientes | Chave pública **publishable** (`sb_publishable_…`) ou JWT de papel **anon** do mesmo projeto |

Não versionar o valor real nem colocá-lo no fonte. Ele será público no artefato por natureza; não é Client Secret. **Nunca** usar Google Client Secret, `service_role`, `sb_secret`, access/refresh token ou credencial administrativa nessa variável. Segredos de Google ficam somente no provider do Supabase; segredos das Functions continuam somente no backend.

`tools/configurar-auth.mjs` valida configuração/destino, recusa chaves privadas e symlinks, não imprime valores, grava só o artefato e ajusta a CSP administrativa à origem Supabase exata. `tools/preparar-site.sh` copia login, as 15 páginas, SDK/licença e os assets existentes, sem testes/docs/segredos. Mantém as 148 imagens WebP e valida links relativos.

```sh
npm ci
# Disponibilizar FORJA_SUPABASE_URL e FORJA_SUPABASE_ANON_KEY no ambiente.
npm run build
npm run serve
# Abrir http://localhost:8080/ (não file://).
```

O build não lê `.env` automaticamente. `.env.example` é apenas um modelo; se usado, o carregamento deve ser feito pelo shell/provedor. Nunca sirva a raiz do repositório como site de produção, pois ela contém arquivos de desenvolvimento. `npm run serve` aponta somente para `.site-publish`.

O workflow `.github/workflows/static.yml` usa `${{ vars.FORJA_SUPABASE_URL }}` e `${{ vars.FORJA_SUPABASE_ANON_KEY }}` na preparação do artefato, com Node 22. Deploy fica limitado a `refs/heads/main`, inclusive para disparo manual. **Não executar o workflow, fazer merge ou publicar sem autorização.** O cadastro remoto das Repository Variables não foi confirmado nesta sessão (a consulta não tinha permissão para listá-las).

`netlify.toml` mantém Functions e redirects existentes e publica `.site-publish`; as duas variáveis públicas também precisam existir no ambiente de build da Netlify. Verifique as regras externas de build/Deploy Preview antes de publicar; esta entrega não altera configurações do painel.

## Conferência manual dos painéis — não executada pelo agente

### Google Cloud / provider do Supabase

- Cliente OAuth do tipo **Web application**, consentimento/usuários de teste/domínios conforme o estado real do projeto.
- Origens JavaScript do app, **sem caminho**: `https://1rayke1.github.io`, `https://prismatic-parfait-be3644.netlify.app`, `http://localhost:8080` e `http://127.0.0.1:8080`, conforme os ambientes usados.
- Redirect URI do Google é o callback do **Supabase**, não o login do FORJA:
  **`https://abundydxjclcgonctirx.supabase.co/auth/v1/callback`**.
- Client ID/Client Secret configurados somente no provider Google do Supabase. Não os enviar por chat, Git, frontend ou logs.
- Confirmar Google habilitado e entradas não desejadas (email/senha e anonymous sign-ins) desabilitadas no projeto. O app também rejeita esses tipos, mas não substitui as configurações do serviço.

### Supabase Auth → URL Configuration

Conferir Site URL de produção (`https://1rayke1.github.io/forja/`, se Pages for o endereço canônico) e incluir os retornos **exatos** que serão usados em Redirect URLs:

```text
https://1rayke1.github.io/forja/login.html
https://prismatic-parfait-be3644.netlify.app/login.html
http://localhost:8080/login.html
http://127.0.0.1:8080/login.html
http://localhost:8080/forja/login.html
http://127.0.0.1:8080/forja/login.html
```

`localhost` e `127.0.0.1` são origens diferentes: inicie e conclua no mesmo host/porta/aba. Variações com `/forja/` são para um servidor local que monte o site nessa subpasta, como os testes. Domínio próprio/porta diferente exigem seu retorno exato. Não liberar coringas amplos ou hosts de preview no projeto de produção sem necessidade.

## Testes e homologação

```sh
npm test
npm run test:auth:e2e
npm run test:e2e
npm run vendor:supabase -- --check
node tools/capturas-configuracoes.mjs --out .cache/capturas-configuracoes
```

Os testes usam SDK/Chromium reais, chaves/JWTs fictícios e interceptação HTTP para Google/Auth/PostgREST. **Não validam consentimento Google, assinatura de um JWT real, configuração do projeto, permissões PostgREST reais nem RLS real. Não executam SQL ou PGlite.** A conferência local do fornecedor compara distribuição/licença/SHA-256 com o pacote oficial fixado no lockfile.

Antes de autorizar publicação, homologar com duas contas Google reais, de preferência em perfis de navegador separados e em ambiente aprovado:

- [ ] Login/cancelamento/erro, retorno expirado, voltar/avançar e tentativa em outra aba.
- [ ] Acesso direto às 15 páginas, retorno com query/fragmento sob `/forja/` e na raiz; onboarding novo retoma o destino solicitado.
- [ ] Reload, refresh real, sessão revogada/expirada, rede indisponível e reconexão, sem liberação offline de sessão não verificada.
- [ ] Logout nas abas, novo login, troca A → B → A e editor com alterações não salvas durante refresh da mesma conta.
- [ ] Legado com confirmação do email correto, recusa, quota/interrupção e retomada sem perda; rascunhos/backup segregados.
- [ ] Cópia inicial com JWT do usuário, payload correto, INSERT repetido idempotente e readback igual; alterações diárias não geram sync.
- [ ] Isolamento remoto por chamadas normais do SDK/PostgREST com JWTs de A e B: SELECT cruzado não retorna dados; INSERT para outro UID e UPDATE vedado são recusados; DELETE cruzado não afeta B. Verificar também as demais tabelas conforme o contrato existente. **Sem SQL, service_role ou superuser.** Qualquer escrita de homologação deve usar dados/contas e ambiente autorizados.
- [ ] Nenhum segredo nos artefatos/logs, variáveis públicas corretas, callbacks exatos e credencial administrativa adicional preservada.

Não anexar HARs com tokens ou dados pessoais ao repositório. Nada desta lista autoriza por si só merge, deploy, mudanças no banco ou alterações nos painéis.

## Referências oficiais

- [Google OAuth no Supabase](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/social-sign-in/auth-google.mdx)
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [PKCE](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/sessions/pkce-flow.mdx)
- [SDK oficial](https://github.com/supabase/supabase-js)
