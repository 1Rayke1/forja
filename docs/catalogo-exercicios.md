# FORJA — Catálogo central de exercícios

## Escopo e arquitetura

A fonte oficial é `assets/js/forja-exercicios-dados.js`, validada por
`assets/js/forja-catalogo-central.js`. O catálogo não acessa DOM, rede ou
`localStorage`. Cada exercício tem um ID autoral e permanente, um único músculo
principal, uma modalidade, metadados técnicos, padrões de treino e mídia.

`assets/js/forja-biblioteca.js` é somente um adaptador: materializa o formato
antigo para biblioteca, atlas, planejamento, editor, sessões e demonstrações.
Os exercícios personalizados continuam na chave antiga e não entram no catálogo
oficial automaticamente.

### Modalidades e compatibilidade

| Catálogo | Regra | Formato antigo |
| --- | --- | --- |
| `academia` | Máquinas, pesos livres, cabos ou acessórios de musculação | `weights` |
| `calistenia` | Peso corporal com barra, paralelas, argolas ou estrutura | `calisthenics` |
| `peso-corporal` | Somente corpo e espaço; `equipment: []` obrigatório | `calisthenics` |

O mapeamento para o formato antigo não altera a modalidade central nem mistura
os filtros futuros. Barra fixa é Calistenia, nunca Peso corporal.

## Critérios editoriais de ranking — versão 1

Toda posição atual é identificada como `type: "editorial"`. Não representa
resultado científico, percentual de ativação ou superioridade absoluta.

A ordenação considera, de forma qualitativa:

1. participação do músculo principal no movimento;
2. eficiência biomecânica e estabilidade da execução;
3. possibilidade de progressão de carga, amplitude ou complexidade;
4. facilidade de controle técnico;
5. adequação à modalidade e aos equipamentos disponíveis.

O ranking é independente para cada `primaryMuscle + modality`. O validador exige
posições sequenciais a partir de 1, sem duplicação ou lacunas. Combinações sem
exercícios conhecidos adequados não recebem posições artificiais. Nesta versão,
não há registro de Glúteos/Calistenia porque os movimentos desse grupo que exigem
estrutura ainda não foram considerados distintos ou apropriados o suficiente para
cadastro; os exercícios de glúteos sem estrutura estão em Peso corporal.

## Modelo de registro

Cada item contém:

- `id`, `name`, `aliases`, `description`;
- `primaryMuscle`, `secondaryMuscles`, `stabilizers`;
- `modality`, `equipment`, `difficulty`, `exerciseType`, `movementPattern`;
- `instructions`, `technique`, `cautions`;
- `ranking: { position, type: "editorial", criteriaVersion: "1" }`;
- `defaults: { type, sets, reps, duration, rest }`;
- `media.image: { src, status }`;
- `media.youtube: { status, videoId, durationSeconds, validatedAt,
  editorialReview }`.

Estados de mídia: `pending`, `validated`, `rejected`, `unavailable`. Um vídeo
validado exigirá ID de 11 caracteres, duração de 1–60 segundos, data e revisão
editorial. A fonte editorial continua sem IDs; as associações administrativas
são uma camada separada e persistente, documentada em
`docs/youtube-exercicios.md`. Sem associações externas, todos permanecem
pendentes.

## Relatório da versão 1

Gerado e conferido com `node tools/relatorio-catalogo.mjs`.

**Total: 165 exercícios únicos.**

### Por músculo principal

| Grupo | Quantidade |
| --- | ---: |
| Bíceps | 10 |
| Tríceps | 12 |
| Peitoral | 15 |
| Costas | 13 |
| Ombros | 15 |
| Trapézio | 9 |
| Abdômen | 16 |
| Oblíquos | 11 |
| Quadríceps | 20 |
| Posteriores de coxa | 10 |
| Glúteos | 13 |
| Panturrilhas | 10 |
| Antebraços | 11 |

### Por modalidade

| Modalidade | Quantidade |
| --- | ---: |
| Academia | 80 |
| Calistenia | 31 |
| Peso corporal | 54 |

### Integridade e mídia

- Registros editoriais incompletos: **0**.
- IDs duplicados: **0**.
- Exercícios sem ranking: **0**.
- Combinações com ranking: **38**.
- Exercícios com estrutura preparada para YouTube: **165**.
- Vídeos validados: **0**; pendentes: **165**.
- Exercícios sem imagem local associada: **123**.
- Imagens associadas: **42**; somente imagens já presentes no repositório foram
  referenciadas. A associação pendente continua identificada como tal.

## Compatibilidade de IDs

Os 37 IDs históricos continuam resolvíveis. `mus-prancha` e
`cal-prancha-frontal` representavam o mesmo movimento e foram consolidados no
registro canônico `cal-prancha-frontal`.

```js
legacyIdMap: {
  "mus-prancha": "cal-prancha-frontal"
}
```

Não há migração de armazenamento nesta etapa. O mapa é uma consulta de
compatibilidade para a próxima etapa de migração, não uma reescrita de rotinas,
histórico ou backups.

## Validação e manutenção

```sh
node tools/relatorio-catalogo.mjs          # resumo
node tools/relatorio-catalogo.mjs --json   # relatório estruturado
node tests/catalogo-central.test.mjs       # regras e compatibilidade
```

Ao acrescentar exercícios, informar manualmente ID, ranking e conteúdo completo.
Não gerar IDs pelo nome, reutilizar posições, associar vídeos pendentes ou
classificar exercícios com equipamento como Peso corporal.
