# FORJA — Rotinas A/B/C e backup JSON

Este documento registra o formato de armazenamento, a estratégia de migração,
o funcionamento do backup e o resultado real dos testes executados.

Tudo roda no navegador (`localStorage`). Não há servidor, conta ou coleta de
dados. O aplicativo continua sendo um único `index.html` estático.

---

## 1. Chaves de armazenamento

### 1.1 Chaves preservadas (mesmo nome e mesmo formato)

| Chave | Formato | Uso |
| --- | --- | --- |
| `forja-missoes-AAAA-MM-DD` | `Array<{id, text, done}>` (também aceita `string` e `{title, completed}` na leitura) | Missões e calendário |
| `forja-treino-exercicios-v1` | `{calisthenics: Exercicio[], weights: Exercicio[]}` | Exercícios do modelo antigo |
| `forja-treino-historico-v1` | `Array<Registro>` | Histórico de treinos |
| `forja-treino-sessao-ativa-v1` | Objeto de sessão (formato antigo ou novo) | Sessão em andamento |

`forja-treino-exercicios-v1` **nunca é apagada nem reescrita** por esta versão.
Ela é apenas lida para a migração e incluída no backup.

### 1.2 Chaves novas

| Chave | Formato | Uso |
| --- | --- | --- |
| `forja-treino-rotinas-v1` | `{calisthenics: Rotina[], weights: Rotina[]}` | Rotinas por modalidade |
| `forja-treino-migracao-v1` | `{version, updatedAt, source, routinesCreated?, activeSessionMigratedAt?}` | Registro auditável da migração |
| `forja-treino-sessao-ativa-legada-v1` | `{archivedAt, session}` | Cópia integral da sessão antiga migrada |
| `forja-treino-dados-preservados-v1` | `Array<{archivedAt, key, reason, raw}>` | Conteúdo ilegível/não reconhecido, preservado |
| `forja-backup-seguranca-v1` | `{app, format, version, exportedAt, reason, keys}` | Cópia automática antes de cada restauração |

### 1.3 Formato de `Rotina`

```js
{
  id: "routine-...",
  name: "Treino A",
  modality: "calisthenics" | "weights",
  createdAt: Number,     // ms
  updatedAt: Number,     // ms
  sections: {
    warmup:   [Exercicio],  // Aquecimento
    main:     [Exercicio],  // Treino principal
    abs:      [Exercicio],  // Abdômen
    finisher: [Exercicio]   // Finalizador
  }
}
```

### 1.4 Formato de `Exercicio`

```js
{
  id: "exercise-...",
  name: "Flexão de braço",
  sets: 3,                    // 1..30
  type: "reps" | "duration",
  reps: "8-12",               // usado quando type === "reps"
  duration: 45,               // segundos, usado quando type === "duration"
  rest: 60,                   // segundos, 0..3600
  load: "40 kg",              // exibido/aceito na Musculação
  notes: "Descer controlado", // até 300 caracteres
  section: "warmup" | "main" | "abs" | "finisher"
}
```

### 1.5 Sessão ativa — versão 2

```js
{
  version: 2,
  id, date, modality, routineId, routineName,
  startedAt, elapsedMs, running,
  currentIndex,
  completedSets: { [exerciseId]: Number },
  totalPlannedSets,
  queue: [Exercicio],          // cópia imutável da rotina no início
  status: "active",
  restEndAt, restRemainingMs, restPaused,
  pendingAdvance,              // descanso antes de trocar de exercício
  restPlannedSeconds
}
```

A execução usa **somente** `queue`: editar ou excluir a rotina durante a
sessão não altera o treino em andamento.

### 1.6 Registro do histórico

O histórico anterior (`id, date, modality, durationMs, completedSets,
exercises`) continua válido. Os novos registros acrescentam:

```js
{
  routineId, routineName,
  totalPlannedSets,
  status: "completed" | "partial",
  finishedAt: ISOString,
  exercises: [{ id, name, section, plannedSets, completedSets,
                reps, duration, type, rest, load, notes }]
}
```

Limite de 200 registros (mesmo comportamento anterior).

---

## 2. Migração

A migração roda no carregamento, apenas quando necessário, e é **reversível
por natureza**: nenhuma chave antiga é alterada ou removida.

1. **Exercícios antigos → rotinas**
   Se `forja-treino-rotinas-v1` não existe e `forja-treino-exercicios-v1`
   tem exercícios, cria-se uma `Rotina padrão` por modalidade, na seção
   `main`, preservando `id`, `name`, `sets`, `reps`, `rest` e `load`.
   A origem é registrada em `forja-treino-migracao-v1`.

2. **Sessão ativa antiga → versão 2**
   A sessão antiga é convertida para o novo formato com um `queue`
   construído a partir da rotina correspondente (ou dos exercícios antigos,
   como fallback). O progresso (`completedSets`) é preservado e o índice
   atual é o primeiro exercício com séries pendentes.
   - Cópia integral em `forja-treino-sessao-ativa-legada-v1`.
   - Se não houver como reconstruir a fila com segurança, a sessão é
     arquivada em `forja-treino-dados-preservados-v1` e removida apenas da
     chave de execução, com aviso explícito na tela.

3. **Dados ilegíveis ou parcialmente inválidos**
   JSON inválido nunca é apagado em silêncio:
   - histórico ilegível permanece na chave e é arquivado;
   - rotinas irreconhecíveis **ou parcialmente inválidas** são arquivadas antes
     de carregar o que for válido (nada é descartado sem cópia em
     `forja-treino-dados-preservados-v1`);
   - exercícios antigos com estrutura inesperada ou itens inválidos são
     arquivados; os itens legíveis continuam migrando;
   - se o JSON de exercícios antigos estiver totalmente ilegível, **nenhuma
     rotina vazia é gravada** — assim o dado pode ser recuperado e migrado
     depois sem bloqueio;
   - sessão ativa com exercícios/progresso não reconhecidos é normalizada,
     mas o original é arquivado antes de qualquer regravação;
   - sessão ativa ilegível é arquivada e não é retomada.
   Em todos os casos a tela mostra um aviso. Arquivamentos idênticos são
   deduplicados para não crescerem a cada carregamento.

4. **Formato não reconhecido no futuro**
   Campos ausentes recebem valores seguros; exercícios sem nome são
   descartados somente na leitura, sem alterar o armazenamento.

---

## 3. Backup JSON

### 3.1 Exportação

- Varre **todas** as chaves com prefixo `forja-` (exceto a cópia interna de
  segurança) e exporta o JSON já interpretado.
- Formato:

```json
{
  "app": "FORJA",
  "format": "forja-backup",
  "version": 1,
  "exportedAt": "2026-10-19T18:55:00.000Z",
  "summary": { "...": "resumo para conferência" },
  "keys": {
    "forja-missoes-2026-10-19": [],
    "forja-treino-rotinas-v1": {},
    "forja-treino-historico-v1": [],
    "forja-treino-sessao-ativa-v1": {}
  }
}
```

- Arquivo: `forja-backup-AAAA-MM-DD.json`.
- Se alguma chave `forja-*` contiver JSON inválido, a exportação é abortada
  com mensagem (não gera backup parcial silencioso).

### 3.2 Importação

1. Lê o arquivo (máximo 5 MB).
2. `JSON.parse` — JSON inválido mostra "Arquivo inválido" e não altera nada.
3. Validação estrita:
   - `app: "FORJA"` e `format: "forja-backup"`;
   - versão inteira entre 1 e a versão suportada;
   - todas as chaves começam com `forja-`;
   - missões: array, texto presente, `done` booleano quando existir;
   - rotinas: objeto, listas por modalidade, nomes, séries 1..30,
     seções conhecidas, tipos `reps`/`duration`, descanso 0..3600,
     duração 1..7200, carga/observações textuais;
   - histórico: array, modalidade válida, números não negativos;
   - sessão ativa: modalidade, fila não vazia, índice dentro da fila,
     progresso em objeto.
4. Prévia em modal com:
   - dias de missões e total de missões;
   - rotinas por modalidade e total de exercícios;
   - histórico por modalidade;
   - exercícios antigos preservados;
   - sessão ativa (ou aviso de que a atual será removida);
   - quantas chaves serão substituídas/removidas e avisos.
5. Só após o botão **"Substituir e restaurar"** os dados mudam.
6. Antes de gravar:
   - cópia integral do estado atual em `forja-backup-seguranca-v1`;
   - remoção e regravação das chaves `forja-*` **uma a uma** (nunca
     `localStorage.clear()`), com verificação de leitura/parse;
   - em caso de falha, tentativa de rollback para a cópia de segurança.
7. A tela é recarregada com os dados restaurados e a sessão ativa, se
   existir, é reaberta.

### 3.3 Desfazer

O botão **"Desfazer última importação"** aplica a cópia de segurança usando
o mesmo fluxo validado e mostra a mesma prévia. A cópia de segurança é
sobrescrita a cada nova restauração (é sempre "um passo atrás").

### 3.4 O que não é apagado

- Nenhuma chamada a `localStorage.clear()`.
- Chaves fora do prefixo `forja-` nunca são tocadas.
- O backup **não** inclui a cópia de segurança para evitar recursão.

---

## 4. Funcionalidades da interface

- Tela inicial com dois cartões: **Calistenia** e **Musculação**, com
  contagem de rotinas/exercícios e aviso de sessão ativa.
- Lista de rotinas por modalidade: iniciar, abrir, duplicar, renomear e
  excluir (com confirmação).
- Editor:
  - nome da rotina, quatro seções, adicionar/editar/remover/reordenar;
  - séries, repetições **ou** duração, descanso, carga (Musculação) e
    observações;
  - indicador de alterações não salvas e proteção ao sair;
  - salvar antes de iniciar.
- Execução em tela dedicada (overlay):
  - seção, nome, "Exercício X de Y", séries concluídas/total, plano,
    descanso, carga e observações do exercício atual;
  - concluir série, pausar/retomar treino, iniciar/pausar/retomar/pular
    descanso, voltar ao exercício anterior;
  - avanço automático ao concluir a última série, com descanso entre
    exercícios quando configurado (e botão para pular);
  - encerrar com confirmação: salvar progresso (parcial) ou descartar;
  - resumo final com duração, séries, exercícios e status de registro.
- Histórico separado por modalidade, com indicador `parcial`.
- Calendário, missões, navegação de meses e visual dourado preservados.

---

## 5. Testes

### 5.1 Automatizados (jsdom) — `npm test`

Executam o `index.html` real, com o mesmo script do navegador.

| # | Teste | Resultado |
| --- | --- | --- |
| 1 | Leitura de dados antigos e migração (exercícios, histórico, sessão ativa, ids/cargas) | ✅ |
| 1b | JSON corrompido é preservado e a interface segue funcionando | ✅ |
| 1c | Rotinas ausentes reconstruídas a partir do legado | ✅ |
| 1d | Auditoria: calendário, missões, exercícios e histórico intactos após migração, CRUD e treino; segundo boot idempotente | ✅ |
| 1e | Rotinas/exercícios parcialmente inválidos são arquivados, não descartados; arquivamento sem duplicatas | ✅ |
| 1f | Formato antigo ilegível não é sobrescrito por rotinas vazias e a interface segue funcional | ✅ |
| 1g | Sessão ativa com itens/progresso não reconhecidos preserva o JSON original | ✅ |
| 2 | Criar, editar, reordenar, remover, duplicar, renomear e excluir rotinas | ✅ |
| 2b | Rotina vazia não inicia; alterações não salvas são protegidas | ✅ |
| 3 | Rotinas e históricos independentes por modalidade; carga só na Musculação | ✅ |
| 4 | Execução: descanso, pausa/retomada do descanso e do treino, avanço automático, voltar | ✅ |
| 4b | Pular descanso e descanso manual | ✅ |
| 5 | Recarregar durante a sessão ativa (inclusive descanso pausado) | ✅ |
| 6 | Conclusão e cancelamento sem corromper o histórico | ✅ |
| 7 | Exportar/importar, prévia, confirmação, desfazer, JSON inválido, arquivo de outro app, chave desconhecida | ✅ |
| 7b | Backup com sessão ativa restaura a sessão | ✅ |
| 7c | Backup antigo (sem rotinas) gera rotinas padrão | ✅ |
| 8 | Calendário e missões antes/depois; navegação de meses; restauração | ✅ |
| 9 | Meta viewport e media queries responsivas presentes | ✅ |
| 10 | Todos os ids usados no script existem; nenhum erro de console | ✅ |

Resultado: **20/20**.

### 5.2 Navegador real — `npm run test:e2e`

O script sobe o próprio servidor HTTP (porta efêmera em `127.0.0.1`), abre o
Chromium headless e usa viewport móvel. Não é necessário iniciar `python3 -m
http.server` nem qualquer processo externo.

Dependências instaladas por `npm install`:

| Pacote | Papel |
| --- | --- |
| `jsdom` | testes de unidade/integração |
| `puppeteer-core` | controle do navegador |
| `@sparticuz/chromium` | binário de Chromium empacotado, usado quando não há Chrome no sistema |

Resolução do navegador, nesta ordem:

1. `PUPPETEER_EXECUTABLE_PATH`;
2. Chrome/Chromium em caminhos comuns do Linux, macOS e Windows;
3. binário do `@sparticuz/chromium` (fallback).

Em contêineres mínimos sem `libnss3`/`libnspr4`, use o Chrome do sistema via
`PUPPETEER_EXECUTABLE_PATH` ou instale essas bibliotecas. Screenshots e
downloads do teste vão para um diretório temporário informado no final.

| Verificação | Resultado |
| --- | --- |
| Console limpo na carga | ✅ |
| Sem overflow horizontal em 320/360/390/430/768/1280 px | ✅ |
| Cartões de modalidade tocáveis e sem sobreposição em 320 px | ✅ |
| Fluxo completo de rotinas A/B nas duas modalidades | ✅ |
| Duplicar/renomear/excluir com confirmação | ✅ |
| Execução, descanso, pausa, retomada, reload no meio da sessão | ✅ |
| Cancelar sessão não registra treino | ✅ |
| Exportar via download real e importar via seletor de arquivo | ✅ |
| JSON inválido rejeitado sem alterar dados | ✅ |
| Calendário e missões após as mudanças | ✅ |
| Nenhum erro de console durante todo o fluxo | ✅ |

Resultado: **11/11** em ambiente limpo (`git archive` → `npm ci` → `npm test`
→ `npm run test:e2e`).

### 5.3 Auditoria de layout

Todas as telas (início, rotinas, editor, modal, execução, descanso e resumo)
foram medidas em 320, 360, 390 e 430 px: sem overflow horizontal e com alvos
de toque de pelo menos 34 px.

---

## 6. Auditoria de preservação (revisão do PR #1)

Verificação explícita do que a migração e o uso normal tocam:

| Dado | Migração | Uso normal | Teste |
| --- | --- | --- | --- |
| `forja-missoes-*` (objetos e strings antigas) | não altera (byte a byte) | só a chave do dia editado | 1d, 8 |
| `forja-treino-exercicios-v1` | lê e mantém intacta | nunca é regravada | 1, 1d, 1e, 1f |
| `forja-treino-historico-v1` | mantém intacto | novo registro é inserido; antigos preservados | 1, 1d, 6 |
| `forja-treino-sessao-ativa-v1` | muda de formato (documentado), original arquivado | progresso normal da sessão | 1, 1d, 1g |
| Chaves `forja-*` desconhecidas | não altera | não são tocadas | 1d |
| Chaves fora de `forja-` | não altera | não são tocadas | 1d |

A auditoria 1d também confirma que um segundo carregamento é idempotente: não
duplica a “Rotina padrão”, não reescreve histórico, missões ou exercícios
antigos, e mantém a sessão já migrada estável.

Casos parciais não são descartados: rotinas, exercícios e sessões com itens
inválidos têm o JSON original copiado para
`forja-treino-dados-preservados-v1` antes de qualquer normalização.

---

## 7. Limitações conhecidas

- **Alvos de toque**: alguns botões de ícone têm 34 px (abaixo dos 44 px
  recomendados por WCAG). Foram aumentados na auditoria, mas ainda não
  chegam a 44 px para não comprimir a lista de exercícios em 320 px.
- **Sem áudio garantido**: o som ao fim do descanso depende da política de
  autoplay do navegador; a interface nunca depende dele.
- **Testes em um único navegador**: a verificação visual e E2E usou Chromium.
  Firefox e Safari não foram testados nesta rodada.
- **Peso das dependências de teste**: `@sparticuz/chromium` ocupa cerca de
  66 MB em `node_modules` (não entra no site publicado). Quem já tem Chrome
  pode usar `PUPPETEER_EXECUTABLE_PATH` e remover o pacote, mas ele fica em
  `devDependencies` para o `npm install` funcionar sem configuração.
- **Ambiente mínimo**: o Chromium empacotado exige bibliotecas do sistema
  (`libnss3`, `libnspr4`). Em Debian/Ubuntu: `sudo apt install libnss3`.
- **Sem sincronização**: os dados continuam locais ao navegador/dispositivo.
- **Migração reversível por preservação**: as chaves antigas ficam intactas;
  não existe botão "desfazer migração", pois não há nada a desfazer. Para
  voltar ao estado pré-importação existe "Desfazer última importação".
- **Chaves fora do padrão**: dados `forja-*` desconhecidos são preservados no
  backup, mas não têm interface própria.
