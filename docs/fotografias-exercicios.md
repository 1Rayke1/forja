# Fotografias demonstrativas — contrato (fotos) e ilustrações (RepDB)

> **Atualização de escopo (2026-10-31).** A tela Explorar passou a usar
> fotografias reais do Unsplash em um recurso **separado** deste contrato:
> `F.fotos` / `assets/fotografias/manifest.json`, documentado em
> `docs/fotografias-explorar.md`. O contrato abaixo continua valendo para fotos
> do catálogo de exercícios: `F.catalog.PHOTO_MANIFEST` permanece vazio e
> congelado e `F.catalog.photoFor()` continua retornando `null` (teste 81).
>
> **Atualização de escopo (2026-10-27).** Este documento continua sendo o
> contrato de **FOTOS**. A partir desta entrega o FORJA também exibe
> **ilustrações** do catálogo livre RepDB, que são um recurso diferente e
> seguem o contrato descrito em `docs/demonstracoes-revisao.md` e
> `docs/creditos-repdb.md`. Nenhuma foto foi publicada.

## Identidade existente

- `id` no catálogo sugerido identifica a origem (`cal-flexao`, `mus-supino-reto` etc.).
- `id` de um item personalizado identifica aquela entrada da biblioteca local.
- Incluir na rotina gera um novo `id` de exercício e preserva a origem em `libraryId`.
- Rotina e sessão guardam cópias de dados; renomear a cópia não muda a origem.
- Itens antigos ou personalizados podem não possuir vínculo de origem. **Não fazer
  correspondência por nome, aproximada ou automática.** Nenhum ID/histórico é reescrito.
- Metadados salvos na cópia são prioritários. Na consulta, campos vazios podem ser
  completados por uma origem exata existente, apenas em memória.

`F.catalog.describeExercise(exercise, mode)` produz essa visão somente-leitura.
`F.catalog.photoFor(record)` consulta por `mode + ':' + (libraryId || id)`.
A modalidade impede misturar origens de contextos diferentes. O manifesto
`F.catalog.PHOTO_MANIFEST` continua **vazio e congelado**: nenhuma foto entrou
no produto e o teste 81 cobre isso.

## Metadados exigidos para um futuro lote de FOTOS aprovado

| Campo | Significado |
| --- | --- |
| `exerciseId`, `mode`, `variant` | Origem exata e descrição de equipamento, posição, pegada e lateralidade |
| `status` | Apenas `approved` poderá ser selecionado; rascunhos não entram no manifesto distribuído |
| `src`, `alt` | Caminho local otimizado e texto alternativo descritivo |
| `sourceUrl`, `author` | Página original individual e autoria |
| `license`, `licenseUrl` | Nome, versão e endereço dos termos aplicáveis à fotografia |
| `attribution` | Crédito completo pronto para apresentação |
| `verifiedAt`, `evidence` | Data ISO e referência da comprovação da permissão individual |
| `reviewedBy` | Responsável pela revisão técnica de correspondência e execução |
| `modifications` | Recorte, otimização e outras alterações, se permitidas |
| `modelPermission` | Referência da autorização de imagem aplicável ou justificativa documentada |

A entrada só pode ser marcada como aprovada após revisão técnica e de direitos;
a propriedade `status` não verifica nem concede uma licença por si só. Código de
um repositório ser aberto não autoriza automaticamente suas fotografias.
Permissões privadas de modelos não devem ser publicadas no Git.

Uma cópia alterada para representar outra variante precisa de nova revisão ou
remoção explícita do vínculo de mídia; um `libraryId` não prova que uma nova
variante corresponde à fotografia. Não inferir foto de um exercício desconhecido.

## Separação entre os dois contratos (resolução de conflito)

| | Fotos (este documento) | Ilustrações RepDB (nova entrega) |
| --- | --- | --- |
| Manifesto | `F.catalog.PHOTO_MANIFEST` — vazio, congelado | `assets/demonstracoes/mapeamento.json` + `manifest.json` |
| Resolvedor | `F.catalog.photoFor()` — sempre `null` | `F.demos.resolve()` |
| Origem | ainda não aprovada | RepDB free tier, commit fixado, licença documentada |
| Correspondência | proibida por nome | por `mode:libraryId`; **personalizado só por escolha manual** |
| Status | `approved` (futuro) | `exact` / `review` / `none` + `visualCheck` |
| Texto de ausência | “Fotografia demonstrativa ainda não disponível.” (legado) | “Demonstração visual ainda não disponível.” |

O detalhe compartilhado prioriza `F.demos.resolve()`. Quando não há ilustração,
mostra o texto de fallback e mantém as instruções e a figura anatômica do atlas.
A figura do atlas continua representando **grupos musculares**, nunca a execução
do movimento — as duas mídias são irmãs, não substitutas.

## Pesquisa de fontes externas (registro da decisão)

Para esta primeira versão, **somente o catálogo local RepDB** foi usado. Fontes
externas foram avaliadas e adiadas:

- **wger** — código AGPL-3.0+, dados CC por entrada (CC BY-SA 3/4, CC BY 4,
  CC0, ODbL), licença/autor por imagem na API. Exigiria verificação
  arquivo por arquivo e compartilhamento igual em derivados.
- **Workout Guide / Everkinetic** — 302 exercícios, SVGs CC BY-SA 4.0, código
  MIT. Boa opção futura, mas impõe publicar adaptações sob a mesma licença.
- **Wikimedia Commons** — licença por arquivo; exigiria checagem individual de
  autor/fonte e direitos de imagem de pessoas identificáveis.
- **Rejeitadas**: `yuhonas/free-exercise-db` (Unlicense declarado, mas o
  mantenedor afirma desconhecer a origem das imagens; upstream indica material
  raspado da internet), `hasaneyldrm/exercises-dataset` (GIFs © Gym visual,
  uso pessoal), ExerciseDB/WorkoutX (API comercial com cache restrito),
  `premium-samples/` da RepDB (avaliação, CC BY-NC) e qualquer imagem vinda de
  busca geral sem licença verificável.

Nenhuma dessas fontes entrou no repositório. A licença RepDB e os hashes estão
em `assets/demonstracoes/NOTICE.md` e `manifest.json`.
