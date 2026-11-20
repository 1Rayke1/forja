# Persistência da conta FORJA

A recuperação faz parte do gate das 14 páginas de uso diário. A página administrativa não carrega dados de treino e mantém o segundo controle de acesso. Login e callback continuam usando o SDK oficial e o PKCE do PR #71.

## Contrato

Antes de implementar o codec, consultamos **somente metadados e contagens** do projeto FORJA. As sete tabelas estavam vazias e `user_data_imports` continha duas cópias. As políticas exigem UID e `forja_google_account()`; RLS e FORCE RLS ativos. `authenticated` tem CRUD nas sete tabelas, mas não tem UPDATE na tabela de cópias. Não é necessário aplicar SQL, mudar políticas, plugins ou variáveis externas.

A coluna `data` sempre é um objeto JSONB com `format: 1`, `rev` (nonce para compare-and-swap) e `payload`. Formato externo desconhecido bloqueia a recuperação em vez de inicializar dados vazios. PK simples `user_id` ou composta `(user_id,id)`; IDs de domínio são texto, não UUIDs artificiais. `display_name` é limitado a 100 caracteres. `occurred_at` usa a data do treino quando disponível.

| Tabela | Estado recuperado |
| --- | --- |
| `profiles` | Perfil inteiro, inclusive campos aditivos e marcadores de onboarding; nome projetado em `display_name` |
| `routines` | Uma linha por rotina, modalidade, posição, seções e exercícios com IDs originais |
| `goals` | A aplicação mantém **um conjunto** de metas semanais (linha `weekly`) |
| `activity_history` | Uma linha por sessão finalizada ou parcial, incluindo exercícios, cargas, séries, feedback e medidas. Histórico legado sem ID usa identidade determinística sem modificar o registro original |
| `progress_entries` | Sessão ativa em `@active` e projeções de progresso por sessão, recalculáveis a partir do histórico completo. Não há um segundo histórico editável de recordes |
| `user_preferences` | Som/vibração e seletores do planejador |
| `user_settings` | Aparência, planejamento semanal, missões por data, rotação, biblioteca, arquivos de migração de domínio, chaves futuras do app; marcadores de importação e exclusão |

Coleções de formato antigo não representáveis sem perda usam uma cópia textual em `user_settings`. O driver autenticado captura `store.write`, `writeRaw`, remoções e restaurações em lote. Calendário e plano usam a fachada do store. Os acessos físicos restantes são infraestrutura do Auth, adaptadores do store e journals particionados por UID. Tokens, PKCE, logs de sincronização, backup de segurança local, rascunho temporário do onboarding, flash de navegação e credencial administrativa **não são dados sincronizados**.

## Leitura, concorrência e falha

1. `getUser(JWT)` verifica o Google. O driver continua fechado até terminar o vínculo/consentimento do legado e a leitura PostgREST paginada das sete tabelas. Snapshots antigos de `user_data_imports` são conferidos por checksum, não usados como autoridade sobre o estado atual.
2. O worker concilia três versões: base confirmada, edição local e linhas remotas. Chaves e campos independentes e listas de objetos com ID são unidos. Em colisão no mesmo campo, prevalece o servidor; contra exclusão, prevalece a remoção. Alternativas conflitantes ficam no arquivo local por conta, disponível em **Configurações → Privacidade e dados → Versões em conflito**. Um perfil local não configurado não substitui um remoto configurado.
3. A hidratação tem journal de recuperação; usa o namespace físico sem reenfileirar as próprias escritas. Somente depois `bootData()` carrega os modelos e decide se o onboarding é necessário. Se não for possível ler a nuvem, o gate oferece nova tentativa, sem concluir que o usuário é novo.
4. A fila durável é a diferença entre cache e base confirmada, complementada por intenção por chave/aba. Uma Web Lock por UID serializa os workers deste navegador. Em outro dispositivo, INSERT com unicidade da PK, ou PATCH/DELETE filtrado pela revisão observada, impede atualização cega. Zero linhas afetadas **não é sucesso**. O nonce do envio em andamento permite reconhecer commit sem resposta após reload. Exclusões de registros geram DELETE; em documentos agregados são removidos os itens correspondentes. Marcadores sem conteúdo evitam reimportar registros de versões antigas.
5. Só um JWT já verificado, capturado para aquela geração, pode chegar ao transporte de dados. A confirmação é testada após cada await relevante. Refresh, logout e troca de usuário invalidam os trabalhos antigos. Uma requisição que já chegou ao servidor pode concluir para a **conta original**. O logout não espera pela rede nem apaga a fila; a mesma conta a retoma no próximo acesso.
6. O rodapé distingue pendente, enviando, confirmado e falha. O worker tenta novamente com atraso crescente (até 60 s), no evento `online` e por ação explícita. Outras telas recuperam mudanças ao abrir ou revalidar a sessão; **não é um feed Realtime**.

**Limites operacionais:** as sete tabelas não são uma única transação SQL. Enquanto o status não for *Sincronizado*, outro dispositivo pode observar parte do lote; o worker retoma o restante. Limpar o cache antes da confirmação perde alterações ainda não enviadas. A cota de armazenamento do navegador também limita o journal; em falha não limpe os dados, exporte um backup e libere espaço. O cache e as versões preservadas não são criptografados. O recibo de cópia inicial não confirma sincronização diária.

## Validação e homologação sem deploy

- `npm ci && npm test`: regressões e testes de persistência, SDK real em jsdom e HTTP de teste.
- `npm run test:auth:e2e`, `npm run test:e2e`, `npm run test:interaction:e2e`: Chromium real; verificações de segurança do navegador continuam ativas.
- `npm run test:cloud:e2e`: contexts com armazenamento independente, PKCE simulado, escrita automática nas sete tabelas, retorno A/B, conflitos entre abas e dispositivos, falha/reentrada e exclusão. Nenhuma dessas fixtures valida políticas do projeto hospedado.
- `npm run build`: artefato estático do Pages. Requer as duas variáveis públicas de build do README. O fonte propositalmente não contém uma chave preenchida.

**Homologação real pendente:** em uma máquina com rede para Google/Supabase e Chrome visível, use o artefato desta branch em uma origem **já autorizada** para o callback. Não publique para rodar o teste. Configure `PUPPETEER_EXECUTABLE_PATH` e `FORJA_HOMOLOGACAO_URL` (raiz do artefato), execute `npm run test:cloud:live` e siga os passos no terminal com duas contas descartáveis autorizadas. A autenticação é interativa no navegador: não fornecer senha, sessão, JWT ou refresh token ao script/chat. O teste não intercepta HTTP, não semeia storage e verifica as linhas por leitura PostgREST com o JWT real antes de comparar os dados após reload/logout e recuperação sem cache. O runner cria uma rotina-canário descartável para verificar UPDATE e DELETE entre contas. As contas de teste conservam os dados ao final.

Antes do merge, confirmar que o canário permaneceu íntegro na releitura final e repetir a queda de rede e o retry durante um treino. Não testar mutações em dados de terceiros. Registrar somente contagens, estados e resultado; nunca conteúdo pessoal, HAR com headers de autorização ou capturas do Google.
