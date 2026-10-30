# Onboarding obrigatório e planejamento semanal

## Entrada e perfis

`forja-app.js` valida o estado salvo antes de inicializar qualquer rota. Sem um perfil salvo (`updatedAt`/`onboardingConcluidoEm`), todas as páginas do aplicativo redirecionam a `onboarding/index.html`; essa própria rota é liberada para iniciar ou retomar. O rascunho continua em `sessionStorage`, e a gravação final só libera a navegação após `saveProfile` confirmar sucesso. Perfis legados já salvos seguem aceitos, sem migração destrutiva. Perfil → **Refazer o cadastro guiado** abre `?refazer=1`.

A antiga caixa opcional da Home e seu controle “Agora não” foram removidos. Os dados de rotina, sessões e histórico não são utilizados para forçar o onboarding nem apagados.

## Gerador disponível sem serviços

`assets/js/forja-plano.js` consulta `F.catalog`, usa o perfil v3, disponibilidade, local/equipamento/modalidade, limitações e feedback. O gerador por regras escolhe apenas itens reais da biblioteca; usa os metadados existentes para músculos, instruções e equipamento. Ele é identificado como **Gerador local por regras**, não como IA. O plano aparece como prévia no hub Treinos; a confirmação grava sessões como rotinas executáveis e cria tarefas do calendário sem sobrescrever tarefas ou histórico concluído. Regenerar atualiza as rotinas de plano pelo mesmo identificador, mantendo registros históricos (que são snapshots independentes).

## Integração de IA opcional (real)

O cliente tenta `POST /api/workout-plan`; nenhuma chave ou segredo existe no JavaScript. A implementação de referência é `netlify/functions/workout-plan.mjs`, uma Netlify Function que encaminha dados mínimos e IDs permitidos para OpenAI Responses API com JSON Schema estrito. Configure no ambiente privado do deploy:

- `OPENAI_API_KEY` (obrigatória; segredo do backend, nunca do site estático);
- `OPENAI_MODEL` (opcional; padrão `gpt-4.1-mini`).

A Function limita método, tamanho do corpo e taxa por IP, valida entradas e saídas, confirma IDs com o catálogo recebido e trata 429, timeout/erro, JSON inválido e indisponibilidade. A saída também é revalidada no navegador. Dados de sexo, idade, peso, altura, nome, e-mail e histórico detalhado não são enviados; somente objetivo/foco/experiência, dias, local/equipamentos/modalidades/limitações, feedback compacto e metadados/IDs do catálogo sugerido. Exercícios personalizados (incluindo nomes e instruções digitados pelo usuário) ficam fora do payload. Do histórico, somente a contagem agregada de sessões recentes e a média de RPE declarada (quando houver) são enviados; no cliente, o gerador local também evita repetir exercícios do catálogo usados recentemente.

**Bloqueio atual:** o FORJA é publicado como site estático no GitHub Pages, não há runtime backend configurado no repositório nem credenciais `OPENAI_API_KEY` disponíveis nesta execução. Portanto uma chamada real ao modelo não foi possível nem é declarada como testada. No Pages, a chamada API falha e o usuário recebe o gerador local por regras. Para habilitar IA de verdade, publique a Function em Netlify (ou implemente a mesma interface em outro backend) e direcione `/api/workout-plan` para `/.netlify/functions/workout-plan`; cadastre a chave somente no painel seguro do provedor.

## Segurança e escopo

As considerações do onboarding são sinais amplos, não dados clínicos. O sistema não diagnostica, promete resultados, nem tenta interpretar dor específica. Em baixo impacto remove escolhas de alto impacto; volume inicial é moderado e há orientação para selecionar alternativas compatíveis do catálogo. Interrompa movimentos dolorosos e procure orientação profissional quando necessário. A geração atual cria sessões, calendário e execução via rotinas existentes; não altera retroativamente sessões concluídas.
