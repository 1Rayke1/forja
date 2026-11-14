# FORJA — Tela de Configurações: relatório de implementação

Branch: `arena/3b462fb4-forja` (base `main` @ `7a04e1e`). Nenhuma alteração foi merged na `main`.

## Análise inicial

- App estático multipágina, sem build/bundler; scripts IIFE em `assets/js/`, namespace `window.Forja`.
- Persistência existente: `F.store` / `localStorage`, chaves prefixadas `forja-`, registry/validação em `forja-dados.js`.
- `configuracoes/index.html` e `perfil/index.html` já compartilhavam o controlador `initDadosEPreferencias` (`F.pages.perfil === F.pages.configuracoes`).
- Nome de exibição já existia em `forja-perfil-v1.nomeExibicao`, consumido pela Home.
- Metas semanais já existiam em `forja-treino-metas-v1` (tela Evolução/Progresso).
- Preferências do planejador já existiam em `forja-planejamento-preferencias-v1` (hub Treinos).
- Preferências de descanso já existiam em `forja-preferencias-v1`.
- Backup/rollback e créditos já existiam e foram preservados.

## O que foi implementado

A rota `configuracoes/index.html` virou um hub fiel à referência visual:

- Header FORJA + “DISCIPLINA DIÁRIA”, botão voltar circular.
- Título com ícone de engrenagem verde-lima e subtítulo.
- Cartão de perfil com avatar, nome real (ou fallback neutro), ano de cadastro/perfil e chevron.
- Seções **Perfil**, **Aplicativo** e **Suporte**, com títulos verde-lima, divisórias, cartões escuros agrupados e chevrons.
- Botão outlined inferior. Como o FORJA não tem autenticação, o rótulo honesto é **“Sair das configurações”** e a ação volta ao Perfil sem apagar dados.
- Bottom nav preservada, com Perfil ativo (mapeamento existente `configuracoes → perfil`).

Cada item abre um destino real:

| Item | Destino / comportamento | Persistência |
|---|---|---|
| Editar perfil | Painel `#editar-perfil` com o formulário de nome existente + resumo do perfil; links para Perfil completo e onboarding | `forja-perfil-v1.nomeExibicao` via `F.saveProfile` |
| Minhas metas | `progresso/index.html#progress-goals-heading`; abre o disclosure “Metas da semana” e rola até o formulário existente | `forja-treino-metas-v1` via `F.saveGoals` |
| Preferências de treino | `treino/index.html#preferences-heading`; abre o plan-builder existente | `forja-planejamento-preferencias-v1` (controlador do planejador) |
| Notificações | Painel `#notificacoes` com switches de som e vibração do descanso | `forja-preferencias-v1` via `F.savePreferences` |
| Aparência | Painel `#aparencia`: tema FORJA padrão / alto contraste + reduzir animações + restaurar padrão com confirmação | Nova chave aditiva `forja-aparencia-v1` via `F.saveAppearance`, registrada no registry/backup |
| Privacidade e dados | Painel `#privacidade`: aviso de armazenamento local, exportar/importar/desfazer backup existentes, auditoria de chaves sem expor conteúdo pessoal | Chaves de backup existentes; nenhuma gravação ao abrir |
| Central de ajuda | Painel `#ajuda` com dúvidas reais sobre dados, nome, alertas, metas e ausência de conta | Somente leitura |
| Fale conosco | Painel `#contato` com canal oficial GitHub do projeto + copiar diagnóstico técnico sem dados pessoais | Somente leitura; link externo marcado `data-external-support` |
| Sobre o FORJA | Painel `#sobre` com versão real do pacote e créditos/licenças existentes (imagens, fotografias, vídeos) | Somente leitura |

### Aparência

- Dois temas escuros preserving a identidade: padrão (`#080C0D` / `#B7F34A`) e alto contraste (fundo mais escuro, textos/bordas reforçados, lima mais claro).
- “Reduzir animações” desliga transições/rolagem suave; a preferência do sistema (`prefers-reduced-motion`) continua respeitada.
- A preferência é aplicada em todas as páginas do app (novo módulo carregado antes do boot) e sincroniza via `storage`/`pageshow`.
- Abrir a tela não grava o padrão; só uma ação do usuário grava.
- Falha de escrita mantém a preferência anterior e informa o erro.

### Nome de exibição

- Editável e persistido no perfil existente; usado na Home e no cartão de Configurações.
- Sem nome cadastrado: fallback neutro (“Seu perfil” / “Olá!”). Nenhum nome demo fixo no código do app.
- “Membro desde” só usa `onboardingConcluidoEm`; sem essa data, mostra “Perfil desde” com `updatedAt`, sem inventar data de cadastro.
- Apagar nome pede confirmação; cancelar não grava.

## Arquivos

### Criados

- `assets/js/forja-configuracoes.js` — hub por fragmentos, painéis, aparência compartilhada, suporte/diagnóstico, auditoria.
- `assets/css/configuracoes-tela.css` — layout mobile-first escopado em `body[data-page="configuracoes"]`.
- `assets/css/aparencia.css` — camada global de tema/movimento, carregada por último nas páginas do app.
- `tests/configuracoes.test.mjs` — 15 testes jsdom focados.
- `tools/capturas-configuracoes.mjs` — capturas reais em Chromium + relatório de layout.
- `artifacts/forja-configuracoes/` — PNGs e `relatorio.json` (fixture de captura explicitamente identificada).

### Modificados (principais)

- `configuracoes/index.html` — nova organização em hub/painéis, preservando ids de backup, nome, prefs e âncoras de créditos.
- `perfil/index.html` — atalho visível para Configurações; texto do nome atualizado.
- `assets/js/forja-backup.js` — confirmação ao apagar nome; inicializa o hub apenas em Configurações; mensagens atualizadas.
- `assets/js/forja-dados.js` — modelo/registro de `forja-aparencia-v1`; rollback de estado em falha de gravação; sync de aparência.
- `assets/js/forja-core.js` — `F.APP_VERSION`, chave de aparência, estado inicial, scroll respeitando movimento reduzido.
- `assets/js/forja-app.js` — aplica aparência após `bootData`.
- `assets/js/forja-progresso.js` — deep link de metas abre o disclosure e rola após layout assentar.
- `assets/js/forja-ui.js` — ícones novos (bell, palette, shield-check, help-circle, mail, log-out, arrow-left) e path `settings` corrigido para o Lucide settings real.
- `assets/css/configuracoes.css` — atalho Perfil → Configurações e scroll-margin dos destinos.
- `index.html` e demais páginas do app — carregam a camada global de aparência/movimento; sino da Home aponta para `#notificacoes`.
- `tests/e2e.browser.mjs` — novo fluxo real de Configurações; fluxos existentes ajustados aos fragmentos.
- `tests/forja.test.mjs` — links externos de suporte auditados como exceção explícita (mesma política de hosts/segurança).
- `tests/evolucao.test.mjs` — Evolução continua última folha específica da página; camada global de aparência vem depois por design.
- `tools/preparar-site.sh` — novos recursos obrigatórios no artefato do Pages.
- `package.json` — scripts `test:configuracoes` e `capturas:configuracoes`; suíte `npm test` inclui os novos testes.

## Testes executados (resultados reais)

| Comando | Resultado |
|---|---|
| `npm test` | **exit 0**. Suítes: Catálogo 17/17, YouTube 21/21, YouTube frontend 8/8, Métricas 18/18, FORJA 110/110, Onboarding 21/21, Planejamento 21/21, Preferências 21/21, Atlas 15/15, Paridade 40/40, Demonstrações 17/17, Vídeos 14/14, Proxy 16/16, Biblioteca/Detalhe 13/13, Biblioteca regiões 16/16, Grupo muscular 19/19, Evolução 14/14, **Configurações 15/15**. |
| `npm run test:e2e` | **exit 0 — 46/46 verificações em Chromium real**, incluindo o novo fluxo de Configurações (hub, painéis, nome, aparência, suporte, metas/treino, 6 larguras sem overflow/texto cortado). Console/HTTP/recursos sem erros. |
| `npm run capturas:configuracoes` | **exit 0**. Overflow horizontal 0 em todas as capturas; 0 erros de console. |
| `bash tools/preparar-site.sh /tmp/forja-site-configuracoes` | **exit 0**. Artefato com 280 arquivos, 148 WebP, links relativos OK. |
| `node --check` nos JS alterados | **exit 0**. |
| `git diff --check` | **exit 0**. |

Logs completos: `/home/user/forja-final-unit.log`, `/home/user/forja-final-e2e.log`.

## Capturas

Em `artifacts/forja-configuracoes/`:

- `configuracoes-320.png`, `configuracoes-390.png`, `configuracoes-390-viewport.png`, `configuracoes-1280.png`
- `editar-perfil-390.png`, `notificacoes-390.png`, `aparencia-390.png`, `privacidade-390.png`
- `aparencia-alto-contraste-390.png`, `inicio-alto-contraste-390.png`
- `relatorio.json` com dimensões/overflow por captura.

O nome “Ravy” nas capturas é **fixture de teste** do script de captura, não dado padrão do app.

## Limitações e decisões explícitas

- **Sem autenticação**: não existe conta/login. “Sair da conta” seria enganoso; a ação real é “Sair das configurações” → Perfil, sem apagar dados.
- **Versão exibida**: `2.0.0`, a versão real em `package.json` (a referência ilustrativa mostrava 1.0.0; não foi inventado downgrade).
- **Notificações**: o FORJA não tem push em segundo plano. Os switches controlam som/vibração ao fim do descanso durante o treino, que é o comportamento real existente.
- **Suporte**: canal oficial externo no GitHub do repositório; não foi inventado e-mail/chat. Diagnóstico técnico não inclui nome, peso, treinos ou histórico.
- **Dados**: continuam locais ao navegador, sem sincronização entre dispositivos. Backup manual continua o caminho de transferência.
- **Aparência**: dois temas escuros (padrão e alto contraste), sem tema claro, para preservar a identidade da referência.
