# Inventário de telas, componentes, modais e estados

Levantamento feito no código de `main` (`17a9157`), arquivo por arquivo: 12
páginas HTML, 9 CSS, 16 módulos JS. Cada tela lista o que existe **hoje** —
nada aqui é funcionalidade proposta.

Legenda de prioridade de redesign:
**P0** = tela que define a marca (aparece primeiro, precisa estar impecável);
**P1** = tela de uso intenso; **P2** = tela de apoio, ganha o sistema por
arrasto.

---

## 1. Mapa de navegação real

```
Início (index.html)                          ← destino 1 da barra inferior
├─ banner "treino em andamento" → executar.html?encerrar=1 / retomar
├─ próximo treino (inicia a rotina ou leva a Treinos)
├─ semana · metas · último treino → progresso/
├─ calendário + missões (na própria home)
└─ cartão Treino → treino/

Treinos (treino/index.html)                  ← destino 2
├─ Calistenia (treino/calistenia.html)
│  ├─ rotinas: iniciar · editar · renomear · duplicar · excluir
│  ├─ histórico da modalidade → progresso/
│  └─ biblioteca?modalidade=calisthenics
└─ Musculação (treino/musculacao.html)  (idem)
   ├─ rotina.html?nova=1 · rotina.html?modalidade=&id=
   ├─ biblioteca.html
   └─ executar.html

Execução (treino/executar.html)              ← fora da barra inferior
└─ resumo pós-treino → progresso/ · voltar à modalidade

Explorar (explorar/index.html)               ← destino 3
├─ treino/biblioteca.html  (catálogo: busca + 5 filtros + detalhe)
└─ explorar/atlas.html     (atlas muscular, protegido)

Progresso (progresso/index.html)             ← destino 4
Perfil (perfil/index.html)                   ← destino 5
└─ configuracoes/index.html (backup/restauração, preferências)
```

Não existe tela de login, conta, sincronização ou ajuste de tema. Não há PWA
(sem manifest, sem service worker, sem ícone).

---

## 2. Telas — conteúdo, componentes e estados

### 2.1 Início · `index.html` · P0

| Bloco | Classes reais | Estados existentes |
| --- | --- | --- |
| Banner de sessão ativa | `.active-session-banner` | oculto / visível com resumo |
| Saudação | `.home-greeting .home-eyebrow .home-title .home-subtitle` | data de hoje no eyebrow |
| Onboarding do perfil | `.onboarding-panel` + formulário | não iniciado · preenchido · erro de validação |
| Ação principal | `.home-action-card` (+ `.is-empty`) · `.home-action-eyebrow/title/meta/button/hint` | com rotina pronta · rotina sem exercícios · sem nenhuma rotina (vira link “Montar meu treino”) |
| Semana | `.home-week-*` | com dados · sem dados (`home-week-note` explicando) |
| Metas | `.home-goals-*` (grade de metas) | metas ativas · metas ausentes · gráfico indisponível |
| Último treino | `.home-recent-*` | com registro · sem registro |
| Calendário | `.calendar-panel .month-navigation .calendar-grid .day` | dia normal · hoje · selecionado · com missões · desabilitado (fora do mês) |
| Missões | `.missions-panel .task-form .task` | vazio · parcial · 100% · item concluído (`.done`) |
| Rodapé | `.site-footer .footer-motto .storage-note` | fixo |

Observação: a home é a única página que carrega **15** scripts (inclui
`forja-inicio.js` e `forja-calendario.js`).

### 2.2 Hub de treino · `treino/index.html` · P1

`.page-head`, `.hub-list` com 2 `.modality-card` (`01`/`02`, nome, descrição,
meta dinâmica “N rotinas · M séries”), `.hub-footer-links` com botão primário
“Criar nova rotina” e dois secundários. **Ponto de emoji/ícone:** os números
`01`/`02` fazem o papel de ícone; o cartão não tem glifo próprio.

### 2.3 Modalidade · `treino/calistenia.html` e `musculacao.html` · P1

`.screen-toolbar` (voltar + eyebrow + botão Biblioteca), `.page-head`
(título da modalidade + subtítulo dinâmico), `.active-hint` (sessão ativa),
`.section-block` de rotinas (`.section-head`, `.routine-list`,
`.routine-count`, `.section-note`), `.section-block` de histórico
(`.history-summary` 4 números, `.history-list`, `#history-more`).
Estados: sem rotinas · rotina sem exercícios · sem histórico.

### 2.4 Editor de rotina · `treino/rotina.html` · P1

68 IDs. Blocos: `.editor-missing` (rotina não encontrada), `.page-head` com
`.dirty-pill` (salvo/alterações não salvas), campo de nome
`.routine-name-input` (máx. 60), `.editor-save-bar`, **4 seções fixas**
(`warmup`, `main`, `abs`, `finisher`) com `.editor-section-head`,
`.section-count`, `.editor-exercise` e `.exercise-tools`, biblioteca
dobrável (`.library-block`, `#library-panel`, busca, lista), formulário de
exercício personalizado (`.custom-form`, `.custom-meta` em `<details>`,
`.type-switch` rádio reps/duração), formulário de exercício
(`.exercise-form-card`, `.field-grid`, `.workout-form`).
Estados: rascunho sujo · salvo · exercício sem metadados · lista vazia por
seção · confirmação de descarte ao sair.

### 2.5 Execução · `treino/executar.html` · P0

96 IDs — a tela mais complexa. Blocos: `.execution-header` (cronômetro da
sessão + rotina), `.execution-progress`, `.exercise-focus`
(`.section-badge`, `.exercise-position`, `.focus-name`, `.focus-plan`,
`.focus-grid` com 3 `.focus-stat`, `.execution-figure` com prancha do atlas,
`.session-notes`), `.set-panel` (`.set-count`, `.set-pips`, `.timer-panel` com
`.timer-display`/`.timer-track`/`.timer-actions`, `.log-panel` com
`.log-fields` reps/carga/distância/RPE e `.log-list` de `.log-entry`,
`.big-set-button`, `#start-rest`), `.exercise-nav`, `.rest-panel`
(`.rest-timer`, `.rest-adjust` ±15 s, pausar/pular),
`.session-paused-overlay`, `.execution-footer` (pausar/retomar/encerrar),
`.session-summary` (`.summary-stats`, `.summary-totals`, `.summary-note`,
`.summary-feedback`, `.summary-exercises`, `.summary-actions`).

Estados existentes: série por repetições · série por duração com cronômetro ·
cronômetro pausado · descanso · descanso pausado · descanso ajustado ·
sessão pausada · sessão encerrada com resumo · falha ao salvar histórico ·
sessão retomada após recarregar.

### 2.6 Biblioteca / catálogo · `treino/biblioteca.html` · P1

`.screen-toolbar`, `#catalog-root`, `.catalog-search-wrap` + `.ui-search-field`,
`.catalog-controls` com 5 filtros (modalidade, seção, categoria, grupo
muscular, equipamento, medição), `.catalog-status`, `.catalog-list` de
`.ui-exercise-row` (nome, meta, `.ui-exercise-tags`), `.catalog-more`,
`.catalog-help`, `.catalog-session-note` (aviso quando há sessão ativa).
Estados: lista completa · filtrada · vazia com “Limpar filtros” · detalhe em
modal com figura.

### 2.7 Progresso · `progresso/index.html` · P0

59 IDs. `.filter-group` (3 modalidades), `.progress-period`
(`#period-control`, `.progress-custom-period` com duas datas),
`#period-error`, `.scope-note`, `.history-summary.progress-summary`
(5 números), `#progress-totals`, notas de limite, metas (`#goals-form`,
`.goals-fields`, `#goals-progress` com anéis), comparação de períodos,
calendário de frequência (heatmap 12 semanas), semana a semana (colunas),
evolução por exercício (seletor + linha), recordes (`.records-list` com
critério), por rotina / por exercício (`.progress-list`), histórico com
busca e filtro de status (`.history-tools`, `.history-item`).
Estados: cada bloco tem um `ui-empty` próprio com explicação do critério
(“Nenhuma meta ativa”, “Escolha um período comparável”, “Sem treinos nas
últimas 12 semanas”, “Nenhum recorde medido ainda”…).

### 2.8 Perfil · `perfil/index.html` · P1

`.page-head`, `.preferences-panel` com formulário de perfil de treino
(objetivo, nível, equipamento, dias, duração), painel de medidas (estado
vazio “Medidas em breve”), `.backup-panel` (exportar/importar/desfazer),
`.preferences-panel` com `.check-row` de som e vibração, dois
`.storage-panel` (onde ficam os dados, privacidade). Usa `style=""` inline em
três pontos.

### 2.9 Configurações · `configuracoes/index.html` · P2

`.screen-toolbar`, `.page-head`, `.backup-panel`, `.preferences-panel`
(som/vibração), `.storage-panel`. Página de compatibilidade: duplica o backup
que já está em Perfil.

### 2.10 Explorar · `explorar/index.html` · P2

`.page-head`, `.hub-list` com dois `.modality-card` — **`◉` e `◎` como
“ícones”** com `style` inline — e `.section-block` de atalhos.

### 2.11 Atlas · `explorar/atlas.html` · protegida

`.page-head`, `#atlas-root` (`aria-busy`), `.atlas-loading`, seletor de
exercício, figura anterior/posterior (`.figura-svg`, `.figura-region`,
`.figura-region-shape`, `.figura-plate`, `.figura-region-hit`), legenda
(`.atlas-legenda`, `.atlas-swatch`), lista por grupo
(`.atlas-exercise-row`, `.atlas-exercise-list`), `.atlas-disclosure`
(“projeção funcional aproximada”), estados de filtro vazio e erro de
carregamento. **Não pode ser reestilizada nesta etapa** além do que o
`atlas.css` já permite.

---

## 3. Modais (todos via `F.showModal`)

| Onde | Título real | Tipo |
| --- | --- | --- |
| `forja-treino.js:198` | “Nova rotina” | formulário de campo único |
| `forja-treino.js:270` | “Renomear rotina” | formulário |
| `forja-treino.js:396` | “Excluir rotina?” | confirmação destrutiva |
| `forja-treino.js:970` | “Remover exercício?” | confirmação |
| `forja-treino.js:1404` | “Excluir exercício da biblioteca?” | confirmação |
| `forja-treino.js:1447` | “Descartar alterações?” | confirmação |
| `forja-sessao.js:714` | “Corrigir série N” | formulário |
| `forja-sessao.js:1062` | “Não foi possível salvar o histórico” | erro |
| `forja-sessao.js:1173` | “Encerrar sessão?” | escolha entre registrar/descartar |
| `forja-backup.js:565` | “Falha ao restaurar” | erro |
| `forja-backup.js:616` | “Arquivo inválido” | erro |
| `forja-backup.js:631` | “Backup inválido” | erro (com detalhes por chave) |
| `forja-backup.js:648` | “Arquivo muito grande” | erro |
| `forja-backup.js:694` | “Desfazer última importação?” | confirmação |
| `forja-catalogo.js:718/828/856` | detalhe do exercício · “Nenhuma rotina de …” · “Adicionar …” | detalhe / vazio / formulário |
| `forja-atlas.js:348` | “Músculos trabalhados” | detalhe com figura (protegido) |
| `forja-progresso.js` | períodos, metas, recordes | formulários e leituras |

Estrutura comum: `.modal-backdrop` > `.modal-card` > `h2` +
`.modal-message` + `.modal-details` (opcional) + `.modal-field`/`.modal-actions`.
Isso significa **um único ponto de estilo** para todos os 17 diálogos.

## 4. Avisos e mensagens

`.toast` (`info`/`ok`/`error`) + `#toast`, `modal-field input`,
`#live-region` (`ui-visually-hidden`, anúncios para leitor de tela),
`.field-error`, `.field-hint`, `[aria-invalid="true"]`, `.limit-note`
(critérios de métrica), `.catalog-status`, `.backup-meta`.

## 5. Estados transversais

| Estado | Como aparece hoje | Onde |
| --- | --- | --- |
| Vazio | `.ui-empty` (ícone + título + texto + ação) e `.empty` (legado) | home sem rotina, progresso sem dados, biblioteca filtrada, atlas |
| Carregando | `.atlas-loading` (texto, `role="status"`) | só no atlas |
| Erro | `.toast.error`, modal de erro, `.field-error` | backup, gravação, validação |
| Foco | `:focus-visible` com outline de 3 px | global |
| Desabilitado | `button[disabled]`, `.ui-button[disabled]` | “Adicione exercícios para iniciar” |
| Sucesso | `.toast`, `.dirty-pill.saved`, `.chip-ok` | salvar rotina, backup, sessão |
| Sessão ativa | `.active-session-banner`, `.active-hint`, `.session-paused-overlay` | 11 das 12 páginas |

Não existe estado de carregamento fora do atlas — o app é síncrono e local.
Introduzir esqueleto de carregamento na etapa de implementação seria **inventar
estado**: a proposta usa o desenho de esqueleto só onde já há espera real
(atlas) e como padrão para futuras consultas.

## 6. Números da interface (para dimensionar o CSS)

| Métrica | Valor |
| --- | --- |
| Páginas | 12 |
| IDs únicos | 285 |
| Classes únicas (HTML + geradas em JS) | ~300 |
| Regras CSS | 982 (somando as 9 folhas) |
| Cores literais fora de token | ~159 |
| Modais | 17 |
| Ícones SVG disponíveis em `forja-ui.js` | 26 |
| Componentes de gráfico em `forja-graficos.js` | 5 (barras, colunas, linha, heatmap, anel) |
| Exercícios sugeridos | 37 (18 calistenia + 19 musculação) |
| Seções de rotina | 4 (aquecimento, principal, abdômen, finalizador) |
