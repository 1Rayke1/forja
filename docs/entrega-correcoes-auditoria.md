# FORJA — entrega das correções da auditoria (25/10/2026)

Correção dos **11 defeitos confirmados** na auditoria somente leitura feita sobre
`bb81416` (0 P0, 1 P1, 3 P2, 7 P3). Branch: `arena/e7efcb30-forja`.

O relatório e as evidências originais da auditoria ficavam em `/home/user/auditoria`
(fora do repositório) e não estão mais presentes neste workspace; os defeitos estão
descritos novamente abaixo, junto do que foi corrigido. As evidências novas ficam em
`docs/capturas/auditoria-*.png`.

Resumo: **11/11 corrigidos na origem**, cada um com teste de regressão (11 testes
unitários + 4 verificações em navegador real). Nenhuma dependência nova, nenhuma
chave de armazenamento renomeada, nenhum formato de backup alterado, identidade
visual preservada.

---

## 1. Estado de cada correção

| ID | Gravidade | Estado | Correção | Testes |
| --- | --- | --- | --- | --- |
| D-01 | P1 | corrigido | limite de 200 passou a valer **por data**, com normalização e aviso na prévia | 77a, 77b, E2E D-01 |
| D-02 | P2 | corrigido | falha na restauração relê a tela: aviso e "Desfazer" na mesma tela, sem reload | 77c, E2E D-02 |
| D-03 | P2 | corrigido | prévia nomeia chaves substituídas/removidas e avisa as duas sensíveis | 77d |
| D-04 | P2 | corrigido | contador fora de região viva; início/fim/pausa/ajuste anunciados uma vez | 77e, E2E D-04/D-07 |
| D-05 | P3 | corrigido | histórico ordenado por data na leitura e na importação, sem regravar arquivo | 77b |
| D-06 | P3 | corrigido | `F.formatGoalRemaining` única para Home e Progresso ("Falta 1 série") | 77j |
| D-07 | P3 | corrigido | descanso abre na área visível e se corrige ao girar a tela | 77f, E2E D-04/D-07 |
| D-08 | P3 | corrigido | `<main id="conteudo">` recebe `tabindex="-1"`: o skip link move o foco | 77g, E2E D-08/D-11 |
| D-09 | P3 | corrigido | Biblioteca tem um `h1` (componente aceita `headingLevel`) | 77h |
| D-10 | P3 | corrigido | missão sem texto é ignorada com aviso; dia que ficaria vazio não é gravado | 77i |
| D-11 | P3 | corrigido | barra inferior mantém os cinco rótulos em 320 px | 77k, E2E D-08/D-11 |

### D-01 (P1) — integridade do histórico após importação

**Origem exata.** O histórico era limitado a `HISTORY_LIMIT = 200` em
`persistHistoryRecord`, por **posição**: `unshift(record)` e `slice(0, 200)`. A
importação gravava o array do arquivo inteiro (250 registros) sem aviso, e a
leitura (`readHistoryReadOnly`, `F.state.history`) devolvia a ordem do arquivo.
Na primeira conclusão de treino depois de uma importação de 250 registros em
ordem crescente, o corte mantinha o treino novo e os 199 primeiros do arquivo —
ou seja, descartava os 50 mais recentes, incluindo o registro mais novo
importado (`2026-09-07`). Prévia, armazenamento, telas e exportação divergiam.

**Comportamento agora.**

- `historyRecordTime`, `sortHistoryRecords` e `normalizeHistoryList` (em
  `forja-dados.js`) definem a ordem canônica: `finishedAt` válido, senão
  `date`, senão `startedAt`; empates preservam a ordem original.
- A importação normaliza o histórico **antes** da prévia
  (`normalizeBackupHistory`, em `forja-backup.js`) e a prévia informa: total do
  arquivo, quantos ficam, data do mais antigo mantido, quantos saem e o limite.
  O usuário vê a consequência antes de confirmar.
- `persistHistoryRecord` usa `normalizeHistoryList` e descarta sempre o registro
  mais **antigo**; se o relógio do aparelho estiver atrás dos registros
  existentes, o treino recém-concluído entra mesmo assim (é a ação mais recente
  do usuário) e o mais antigo da lista sai.
- Leitura (`readHistoryReadOnly`) e telas ordenam em memória, sem regravar o
  arquivo existente; exportação sai na mesma ordem da tela.

**Testes.** `77a` (250 registros, importação, novo treino, exportação), `77b`
(arquivo fora de ordem, `raw` do arquivo importado idêntico depois da leitura) e
a verificação E2E "D-01" (aviso na prévia, 200 na lista, exportação com 200,
registro novo presente e os mais recentes preservados).

### D-02 (P2) — "Desfazer última importação" após falha

**Origem.** Quando a restauração falhava no meio, o erro era mostrado em toast,
mas o estado de tela (status da cópia de segurança e botão "Desfazer última
importação") não era recalculado; o botão só aparecia depois de recarregar.

**Comportamento agora.** A falha chama `reloadApplicationData()`, que relê os
dados e redesenha a tela de configurações: o modal "Falha ao restaurar" cita a
chave que falhou (`forja-backup-seguranca-v1`), o botão "Desfazer" fica
acionável imediatamente e o status "Cópia de segurança de … disponível." aparece
sem reload. A cópia de segurança é gravada antes de qualquer escrita e fica
protegida durante a transação e o rollback: se ela não puder ser gravada, nada
muda; se a restauração falhar, ela continua disponível para o desfazer, que usa
o mesmo fluxo validado e confirma com "Cópia anterior restaurada. N chave(s)
carregada(s).".

**Testes.** `77c` (falha forçada no 2º `setItem`, botão e status visíveis sem
reload, desfazer restaura missões e preferências) e E2E "D-02" (falha de cota
real no navegador, desfazer na mesma tela).

### D-03 (P2) — chaves removidas/substituídas na prévia

**Origem.** A prévia dizia apenas quantas chaves seriam substituídas/removidas.
`forja-treino-dados-preservados-v1` e `forja-treino-rotacao-v1` podiam ser
apagadas por uma restauração sem que o usuário soubesse o que perdia.

**Comportamento agora.** `describeStorageKey`/`describeKeyList` traduzem cada
chave (registro no `F.registry`, missões agrupadas como "Missões e calendário
(N dia(s))" e rótulos para as auxiliares) e a prévia lista **pelo nome** o que
será substituído e o que será removido. As duas chaves sensíveis ganham aviso
próprio, com a chave técnica e a explicação de que o desfazer as devolve.

**Decisão registrada.** A restauração continua substituindo o conjunto de dados
(o contrato documentado é "restaurar substitui", e o desfazer precisa reproduzir
o estado anterior exatamente — teste 13a). O que mudou é que a remoção deixou de
ser silenciosa: é nomeada, explicada e reversível em um clique.

**Teste.** `77d`.

### D-04 (P2) — contador de descanso em região viva

**Origem.** `#execution-rest` tinha `aria-live="polite"` e continha o contador
atualizado a cada segundo: leitores de tela anunciavam cada segundo.

**Comportamento agora.** O painel não é mais região viva; `#rest-timer` tem
`role="timer"` e `aria-live="off"`. O início do descanso, o fim, a pausa, a
retomada e o ajuste são anunciados uma vez por ação via `F.ui.announce`
(região viva dedicada, com debounce). O estado do descanso continua legível por
leitor de tela ao navegar pelos elementos; as ações (pular, pausar, ajustar)
seguem acessíveis por teclado.

**Testes.** `77e` (nenhum anúncio por segundo; pausa/retomada/ajuste anunciados)
e E2E "D-04/D-07".

### D-05 a D-11 (P3)

- **D-05 (ordem do "Último treino")**: a ordem vinha do arquivo importado.
  Agora `sortHistoryRecords` ordena por data na leitura e na importação, sem
  reescrever o arquivo (teste `77b`).
- **D-06 ("Faltam 1 séries")**: a Home tinha uma cópia da regra e o Progresso
  usava outra. `F.formatGoalRemaining` centraliza: "Falta 1 série", "Faltam 3
  séries", "Falta 1 treino", "Faltam 45 min" (teste `77j`, Home e Progresso
  idênticos).
- **D-07 (painel sob a dobra/nav)**: `.rest-panel` ganhou
  `scroll-margin-bottom: calc(var(--bottom-nav-height) + 72px)`; o painel rola
  para a área visível ao abrir (inclusive depois de recarregar com descanso
  pendente) e `keepRestPanelVisible()` reajusta no `resize`/rotação com
  `behavior:"auto"`, apenas quando o botão principal saiu da área visível
  (quem rolou de propósito não é interrompido). `F.safeScrollIntoView` passou a
  aceitar `behavior`/`block` e respeita `prefers-reduced-motion` (teste `77f`,
  E2E em 390×844, 320×568 e 1280×900; medições adicionais em 320×480 e
  768×1024).
- **D-08 (skip link não transfere foco)**: `prepareSkipTarget()` aplica
  `tabindex="-1"` em `#conteudo` no boot das 12 páginas com o `main` (teste
  `77g`, E2E em quatro rotas; antes `activeElement` era `BODY`).
- **D-09 (Biblioteca sem `h1`)**: `F.ui.sectionHead` aceita `headingLevel`, e a
  Biblioteca passa `"h1"` para "Biblioteca de exercícios" (`#catalog-heading`),
  mantendo classe e visual; os blocos internos seguem `h2` (teste `77h`).
- **D-10 (missão com texto vazio)**: `missionText` decide o que é texto útil; a
  importação ignora missões vazias, avisa na prévia ("N missão(ões) sem texto …
  ignoradas") e não grava um dia que ficaria sem missões. Nada invisível é
  contado (teste `77i`, contagem "0 de 1 · 0%").
- **D-11 ("Progresso" truncado a 320 px)**: em até 359 px a barra usa
  `width:100%`, `gap:2px`, sem padding lateral e sem `letter-spacing` — os cinco
  rótulos cabem sem reticências, com a mesma fonte e o mesmo visual (teste
  `77k`, E2E a 320 px: 5 destinos, sem rolagem horizontal).

---

## 2. Arquivos alterados e justificativa

18 arquivos, 1622 inserções / 53 remoções (incluindo este documento e três capturas).

| Arquivo | Alteração | Por quê |
| --- | --- | --- |
| `assets/js/forja-dados.js` | `historyRecordTime`, `sortHistoryRecords`, `normalizeHistoryList` (+ exports); `readHistoryReadOnly` ordena em memória | D-01/D-05: ordem e limite por data, sem regravar o arquivo |
| `assets/js/forja-backup.js` | `AUXILIARY_KEY_LABELS`, `describeStorageKey`, `describeKeyList`, `missionText`, `normalizeBackupMissions`, `normalizeBackupHistory`, `describeOldestKept`, `adjustments`, listas nomeadas na prévia, recarga após falha, toast do desfazer | D-01, D-02, D-03, D-10 |
| `assets/js/forja-sessao.js` | `announceRest`; `persistHistoryRecord` com ordem/limite por data; rolagem ao abrir o descanso; `keepRestPanelVisible` + `resize` | D-01, D-04, D-07 |
| `assets/js/forja-core.js` | `F.formatGoalRemaining`; `F.safeScrollIntoView(element, options)` | D-06 (texto único) e D-07 (rolagem determinística) |
| `assets/js/forja-app.js` | `prepareSkipTarget()` no boot | D-08 |
| `assets/js/forja-ui.js` | `sectionHead` aceita `headingLevel` | D-09 |
| `assets/js/forja-catalogo.js` | `headingLevel: "h1"` no título da Biblioteca | D-09 |
| `assets/js/forja-inicio.js` | usa `F.formatGoalRemaining` | D-06 |
| `assets/js/forja-progresso.js` | usa `F.formatGoalRemaining` | D-06 |
| `assets/css/marca.css` | `scroll-margin-bottom` no `.rest-panel`; `@media (max-width:359px)` na barra inferior | D-07 e D-11 |
| `treino/executar.html` | `#execution-rest` sem `aria-live`; `#rest-timer` com `role="timer"` e `aria-live="off"` | D-04 |
| `tests/forja.test.mjs` | bloco 77a–77k + helpers `historySeries`, `backupOf` | regressão dos 11 defeitos |
| `tests/e2e.browser.mjs` | 4 verificações novas + `historyBackupFile` | D-01, D-02, D-04/D-07, D-08/D-11 em navegador real |
| `docs/forja-rotinas-e-backup.md` | seção 6.2 e ajustes na descrição da importação | documentar o comportamento novo |

**Intocados de propósito:** `assets/css/app.css` (chegou a receber
`#conteudo:focus { outline:none }`, removido: o foco programático mantém o anel
na página inteira), `index.html` e demais páginas (nenhuma mudança estrutural),
`assets/js/forja-calendario.js`, todo o atlas, `package.json`/`package-lock.json`
e os arquivos de design.

---

## 3. Testes executados e resultados reais

Estado testado: código final desta entrega (depois dele só entraram este
documento e as capturas).

### 3.1 `npm test` (jsdom)

```
MÉTRICAS — 18/18 testes aprovados
FORJA — 103/103 testes aprovados
ATLAS — 12/12 testes aprovados
PARIDADE — 40/40 testes aprovados
```

173 testes no total (162 antes: a suíte FORJA passou de 92 para 103 com os
testes 77a–77k).

Novos testes de regressão:

| Teste | Cobre |
| --- | --- |
| 77a | D-01: importar 250 mantém os mais recentes e não perde treino novo |
| 77b | D-01/D-05: ordem do histórico não depende da ordem do arquivo |
| 77c | D-02: falha na restauração libera o desfazer na mesma tela |
| 77d | D-03: prévia nomeia chaves removidas e avisa as duas sensíveis |
| 77e | D-04: descanso não anuncia cada segundo e mantém os momentos importantes |
| 77f | D-07: abrir o descanso rola até o painel e reserva a barra inferior |
| 77g | D-08: o skip link move o foco para o conteúdo |
| 77h | D-09: a Biblioteca tem exatamente um `h1` |
| 77i | D-10: missão sem texto é ignorada com aviso, sem dado invisível |
| 77j | D-06: "Falta 1 série" no Progresso e na Home |
| 77k | D-11: a barra mantém os cinco rótulos legíveis em 320 px |

### 3.2 `npm run test:e2e` (Chromium real)

```
✅ Fluxo completo em navegador limpo: Home sem rotina, criação sem #editor-missing, rotação e exclusão
✅ Home estabilizada: onboarding compacto em 5 larguras, metas com unidades/modalidade, outra aba e pageshow
✅ D-01: importar 250 treinos avisa o limite, guarda os 200 mais recentes e não perde o novo
✅ D-02: falha na restauração deixa o desfazer disponível na mesma tela
✅ D-04/D-07: descanso sem anúncio por segundo, com as ações visíveis acima da barra
✅ D-08/D-11: skip link foca o conteúdo e a barra mantém os rótulos em 320 px
✅ Nenhum erro de JavaScript durante todo o fluxo

============================================================
E2E navegador real — 29/29 verificações aprovadas
============================================================
```

29/29 (25 antes), 0 erros de JavaScript e 0 respostas HTTP de erro. Tempo da
execução: ~196 s.

### 3.3 Verificações pontuais durante o desenvolvimento

- `node --check` em todos os arquivos JS alterados.
- Medições de geometria em 390×844, 320×568, 320×480, 1280×900 e 768×1024:
  `#skip-rest` acima da barra inferior e da faixa do toast.
- Fluxo completo (rotina → execução → descanso → conclusão → Progresso →
  Home → editor → backup) em navegador, sem erro de console.

---

## 4. Evidências do D-01 (registros recentes não são descartados)

Backup de teste: 250 registros, um por dia, de `2026-01-01` a `2026-09-07`,
importado nas duas ordens (crescente e decrescente). Resultado **idêntico** nos
dois casos:

| Etapa | Registros | Mais recente | Mais antigo | Treino novo | `2026-09-07` |
| --- | --- | --- | --- | --- | --- |
| Arquivo importado | 250 | 2026-09-07 | 2026-01-01 | — | presente |
| Após a importação | 200 | 2026-09-07 | 2026-02-20 | — | **mantido** |
| Após concluir um treino novo | 200 | 2026-10-25 | 2026-02-21 | **presente** | **mantido** |
| Exportação após o treino | 200 | 2026-10-25 | 2026-02-21 | presente | **mantido** |

- A importação descarta os **50 mais antigos** (`2026-01-01`…`2026-02-19`) e
  mantém os 200 mais recentes — antes ela aceitava 250 sem aviso.
- Concluir um treino mantém 200 registros e remove **um** registro: o mais
  antigo (`2026-02-20`). O mais novo importado (`2026-09-07`) continua lá, com
  o treino novo no topo.
- Antes da correção, com o arquivo em ordem crescente, esse mesmo passo
  descartava os 50 mais recentes, incluindo `2026-09-07`.
- A exportação coincide com a tela e com o armazenamento (200 registros, mesmo
  primeiro e último).

Evidência visual: `docs/capturas/auditoria-d01-historico-200.png` (Progresso
com "200" treinos e a lista terminando no registro mais antigo mantido).

A verificação E2E confirma o aviso da prévia ("250 treinos … 50 registro(s)
mais antigo(s) … descartados"), `200` em `#progress-sessions`, 200 linhas na
lista, exportação com 200, o registro mais antigo do arquivo fora e o mais novo
dentro.

---

## 5. Integridade: backups, dados e arquivos protegidos

| Verificação | Resultado |
| --- | --- |
| Formato de backup (`forja-backup`, `BACKUP_VERSION = 1`, `DATA_VERSION = 3`) | inalterado |
| Chaves de armazenamento | nenhuma renomeada, criada ou removida |
| Compatibilidade v1/v2/v3 | testes 13a–13e, 77a–77d verdes |
| Cópia de segurança antes de restaurar | gravada **antes** de qualquer escrita e protegida durante a transação e o rollback; se ela não puder ser gravada, nada é alterado |
| Desfazer após falha | restaura missões e preferências na mesma tela (77c, E2E D-02) |
| Ida e volta de backup | importar 250 → exportar 200 coerente com a tela (D-01) |
| `assets/js/forja-calendario.js` | **não alterado**: `sha256 9db0176ee944a96dbe14afede5f6c4dea346f09729f235f109d3fcfcc0a3a44d`, blob `15e2bd4…` idêntico ao commit base `bb81416` |
| Atlas (`assets/anatomia/*`, `forja-figura.js`, `forja-atlas.js`, `atlas.css`, `explorar/atlas.html`, `tests/atlas.test.mjs`) | `git diff` contra `bb81416`: **vazio**; suíte ATLAS 12/12 |
| Páginas HTML | nenhuma alterada além de `treino/executar.html` (dois atributos de acessibilidade) |
| Dependências | `package.json` e `package-lock.json` intactos; nenhuma dependência nova |
| CSS global | `assets/css/app.css` intacto; só `marca.css` mudou (19 linhas) |
| Dados reais do usuário | nenhum dado pessoal usado: fixtures sintéticas em testes e no navegador |

---

## 6. Limitações e defeitos remanescentes

**Defeitos confirmados na auditoria:** nenhum dos 11 fica em aberto. As
recomendações da auditoria (observações que não eram defeitos confirmados) não
fazem parte deste escopo e não foram implementadas.

Limitações que permanecem, por decisão:

- **Limite de 200 registros** continua existindo (é o comportamento histórico do
  app). A diferença é que agora ele é explícito na prévia, vale por data e nunca
  descarta os registros mais recentes. Históricos com mais de 200 registros
  continuam perdendo os mais antigos — com aviso e com o desfazer disponível.
- **D-03 — restauração substitui o conjunto**: uma restauração que não inclua
  `forja-treino-dados-preservados-v1` ainda remove essa cesta. É intencional (o
  desfazer precisa reproduzir o estado anterior exatamente), agora nomeado,
  explicado e reversível.
- **D-07 — alturas não medidas**: a geometria foi conferida em 390×844,
  320×568, 320×480, 1280×900 e 768×1024. Alturas menores que 480 px ou zoom de
  texto alto não foram medidos.
- **Acessibilidade**: as verificações do D-04 são estruturais (atributos ARIA,
  chamadas de anúncio, região viva) e em DOM real, não com NVDA/VoiceOver;
  leitores de tela reais não foram testados nesta rodada.
- **Navegador**: toda a verificação E2E usou Chromium. Firefox e Safari não
  foram testados.
- **D-11**: a correção atua até 359 px; com zoom de texto em 200% a barra não
  foi medida.
- **Alvos de toque**: alguns botões de ícone seguem com 34 px (abaixo dos 44 px
  recomendados), como já documentado; não foram alterados para não comprimir as
  listas em 320 px.
- **Sem sincronização**: os dados continuam locais ao navegador/dispositivo.

---

## 7. Como reproduzir

```bash
npm ci
npm test                 # MÉTRICAS 18/18, FORJA 103/103, ATLAS 12/12, PARIDADE 40/40
npm run test:e2e         # 29/29 em Chromium real
```

No ambiente usado aqui, o Chromium vem de `@sparticuz/chromium`: é preciso
extrair `node_modules/@sparticuz/chromium/bin/al2023.tar.br` para `/tmp/al2023`
e rodar com `LD_LIBRARY_PATH=/tmp/al2023/lib` e
`executablePath: '/tmp/chromium'`.
