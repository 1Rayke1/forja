# Demonstrações visuais — mapeamento, revisão e correção

Registro auditável de como cada exercício sugerido do FORJA se relaciona com as
ilustrações do catálogo local RepDB (free tier).

- Fonte e licença: `docs/creditos-repdb.md`, `assets/demonstracoes/NOTICE.md`.
- Dados: `assets/demonstracoes/mapeamento.json` (status, candidatos, revisões),
  `manifest.json` (arquivos e SHA-256), `rotulos.json` (nomes pt-BR),
  `creditos.json` (créditos por fonte).
- Código: `assets/js/forja-demonstracoes-dados.js` (bundle gerado) e
  `assets/js/forja-demonstracoes.js` (resolvedor e seletor).
- Ferramenta de revisão: `tools/revisao-demonstracoes.html`.

## 1. Regras

1. **Um candidato só é uma demonstração confirmada** quando `status === "exact"`
   **e** `reviews[demoId].visualCheck === "confirmed"` com evidência registrada.
2. `status: "review"` (movimento diferente/parcial), revisão `approximate`,
   revisão `pending`, escolha manual e exercício personalizado aparecem
   **sempre** com o selo **“Precisa de revisão”**.
3. `status: "none"` não tem imagem padrão. O seletor ainda oferece alternativas
   locais, todas marcadas como aproximadas. O fallback permanece:
   “Demonstração visual ainda não disponível.” + instruções + figura do atlas.
4. **Sem correspondência por nome.** A chave é `mode:libraryId`. Exercícios
   personalizados (sem `libraryId` conhecido) só recebem imagem por escolha
   manual no seletor, que lista o catálogo para navegação.
5. Um `demoId` que deixou de existir no bundle é ignorado; o resolvedor volta
   ao padrão e avisa, sem imagem quebrada.
6. Um candidato `rejected` não aparece no seletor. Se o padrão for rejeitado,
   o exercício passa a `none`.

## 2. Situação atual (2026-10-27)

| Métrica | Valor |
| --- | --- |
| Exercícios sugeridos registrados | 37 (18 calistenia + 19 musculação) |
| `exact` (padrão com mesmo movimento) | 29 |
| `review` (padrão aproximado/diferente) | 5 |
| `none` (sem padrão fiel) | 3 |
| Candidatos distintos no seletor | 121 `demoId`s |
| Arquivos WebP vendorizados | 148 |
| Peso real do catálogo | **2.573.658 bytes ≈ 2,45 MiB** (limite aceito: 3,6 MiB) |
| Revisões visuais documentadas | 28 `confirmed`, 19 `approximate`, 74 `pending` |

Verificado por `node tools/sincronizar-repdb.mjs --check`. Os 74 `pending` são
alternativas que **nunca** são apresentadas como confirmadas: aparecem no
seletor com o selo “Precisa de revisão”.

### Exercícios `none` (sem demonstração fiel)

| Exercício | Por que não há padrão | Alternativas locais (todas `review`) |
| --- | --- | --- |
| `cal-rotacao-ombros` | RepDB tem alongamentos e exercícios com faixa/polia, não círculos de ombro | `band-pull-apart`, `cable-external-rotation`, `banded-shoulder-stretch`, `cross-body-shoulder-stretch`, `banded-rear-delt-stretch` |
| `cal-mobilidade-quadril` | RepDB tem alongamentos estáticos de quadril, não a mobilidade dinâmica descrita | `90-90-hold`, `lean-back-90-90-hold`, `pigeon-stretch`, `half-kneeling-hip-flexor-rock`, `kneeling-hip-flexor-stretch` |
| `cal-corrida-estacionaria` | Não há corrida parada; candidatos são movimentos diferentes | `high-knees`, `walking`, `step-ups`, `incline-treadmill-walk`, `treadmill-running` |

### Exercícios `review` (padrão aproximado)

| Exercício | Padrão | Motivo do selo |
| --- | --- | --- |
| `cal-mergulho` | `repdb:dips` | A ilustração mostra mergulho em paralelas; confirmar pegada/amplitude antes de considerar exata. |
| `cal-afundo` | `repdb:lunge` | Afundo estático vs. alternado descrito no FORJA. |
| `cal-abdominal-infra` | `repdb:reverse-crunches` | “Abdominal infra” é ambíguo: pode significar elevação de pernas. |
| `mus-esteira` | `repdb:incline-treadmill-walk` | Caminhada em esteira **inclinada** vs. “ritmo leve”. `treadmill-running` é alternativa. |
| `mus-mobilidade-ombro` | `repdb:band-pull-apart` | Movimento com elástico confere, mas o FORJA o classifica como mobilidade. |

Os três exercícios com padrão `exact` que usam a mesma ilustração
(`cal-prancha-frontal`, `mus-prancha` → `repdb:plank`) compartilham a revisão
confirmada — por isso há 28 `confirmed` para 29 exercícios `exact`.

## 3. Como a verificação visual foi documentada

As 47 imagens com revisão documentada (28 confirmadas + 19 aproximadas; os
34 padrões e as alternativas curadas dos exercícios `none`) foram
comparadas às instruções pt-BR do FORJA em folhas de contato geradas
localmente com ImageMagick (`montage`), **sem IA generativa**. Cada revisão em
`mapeamento.json` registra:

```json
"repdb:push-up": {
  "visualCheck": "confirmed",
  "reviewedAt": "2026-10-27",
  "reviewedBy": "agente Arena (inspeção visual assistida por ferramenta de leitura de imagem)",
  "method": "Folhas de contato locais geradas com ImageMagick (sem IA generativa) comparando a instrução pt-BR do FORJA com o still RepDB.",
  "evidenceFiles": ["push-up-peak.webp"],
  "notes": "Still confere com o movimento descrito no FORJA. Hashes em manifest.json."
}
```

**Transparência:** as revisões existentes foram feitas pelo **agente de
desenvolvimento**, não pelo usuário do FORJA. Nenhuma confirmação foi atribuída
ao usuário e nenhuma confirmação foi inventada para preencher o catálogo.
Os hashes citados como evidência estão em `manifest.json` e são validados por
`node tools/sincronizar-repdb.mjs --check`.

Valores de `visualCheck`:

| Valor | Significado | Resultado na UI |
| --- | --- | --- |
| `confirmed` | Imagem inspecionada e compatível (só vale como confirmação se `status=exact`) | sem selo quando `exact` |
| `approximate` | Inspecionada, mas movimento diferente/parcial | selo “Precisa de revisão” |
| `pending` | Sem inspeção documentada | selo “Precisa de revisão” |
| `rejected` | Incorreta | removida do seletor |

## 4. Corrigindo casos incorretos

### Pelo usuário, no aplicativo

O botão **“Buscar outra imagem”** (linha do exercício no editor e no formulário
de criação/edição) permite procurar, visualizar, selecionar e confirmar outra
ilustração, remover a escolha (volta ao padrão do catálogo) ou escolher
**“Sem demonstração”**. A escolha fica apenas naquela instância do exercício.

### Pelo mantenedor, no repositório

1. Sirva a raiz por HTTP: `npm run serve` e abra
   `http://127.0.0.1:8080/tools/revisao-demonstracoes.html`.
2. Preencha **Revisor** com o nome de quem está revisando (obrigatório para
   confirmar/rejeitar — a ferramenta não atribui revisão ao usuário).
3. Compare a instrução do FORJA com as imagens; use **Confirmar**,
   **Aproximada**, **Em revisão**, **Rejeitar** e **Definir padrão**.
4. Clique em **Baixar mapeamento.json atualizado**, substitua
   `assets/demonstracoes/mapeamento.json`.
5. Rode:
   ```sh
   node tools/sincronizar-repdb.mjs --offline
   node tools/sincronizar-repdb.mjs --check
   npm test
   ```
   (`--offline` recalcula hashes e o bundle sem baixar o dataset.)
6. Atualize a tabela desta página e registre a data/revisor.

Para adicionar ou trocar **candidatos** (não apenas revisões), edite também
`rotulos.json` e rode `node tools/sincronizar-repdb.mjs` (com rede) para baixar
os novos WebP do commit fixado.

## 5. Persistência da escolha

O campo opcional `demoId` fica **dentro do exercício** na chave já existente
`forja-treino-rotinas-v1` (e viaja para a sessão ativa). Não foi criada nenhuma
chave nova e `BACKUP_VERSION`/`DATA_VERSION` não mudaram. Detalhes em
`docs/forja-rotinas-e-backup.md` §1.4.
