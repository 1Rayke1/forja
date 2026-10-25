# Fotografias demonstrativas — contrato preparado, sem publicação

## Identidade existente

- `id` no catálogo sugerido identifica a origem (`cal-flexao`, `mus-supino-reto` etc.).
- `id` de um item personalizado identifica aquela entrada da biblioteca local.
- Incluir na rotina gera um novo `id` de exercício e preserva a origem em `libraryId`.
- Rotina e sessão guardam cópias de dados; renomear a cópia não muda a origem.
- Itens antigos ou personalizados podem não possuir vínculo de origem. Não fazer
  correspondência por nome, aproximada ou automática. Nenhum ID/histórico é reescrito.
- Metadados salvos na cópia são prioritários. Na consulta, campos vazios podem ser
  completados por uma origem exata existente, apenas em memória.

`F.catalog.describeExercise(exercise, mode)` produz essa visão somente-leitura.
`F.catalog.photoFor(record)` consulta por `mode + ':' + (libraryId || id)`.
A modalidade impede misturar origens de contextos diferentes. O manifesto
`F.catalog.PHOTO_MANIFEST` é vazio e congelado. Não há URLs, downloads de imagens,
cache, dependências nem pranchas do atlas nesse contrato.

## Metadados exigidos para um futuro lote aprovado

Cada entrada deverá conter:

| Campo | Significado |
| --- | --- |
| `exerciseId`, `mode`, `variant` | Origem exata e descrição de equipamento, posição, pegada e lateralidade |
| `status` | Apenas `approved` poderá ser selecionado; rascunhos não devem entrar no manifesto distribuído |
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
Permissões privadas de modelos não devem ser publicadas no Git: o manifesto
público registra somente uma referência não sensível à comprovação.

Uma cópia alterada para representar outra variante precisa de nova revisão ou
remoção explícita do vínculo de mídia; um `libraryId` não prova que uma nova
variante corresponde à fotografia. Não inferir foto de um exercício desconhecido.

## Comportamento nesta etapa

O detalhe compartilhado apresenta “Fotografia demonstrativa ainda não disponível”.
Instruções, equipamento, músculos e observações disponíveis continuam acessíveis.
Sem instrução, isso é informado, sem texto técnico inventado. Nenhuma imagem é
exibida e nenhuma representação anatômica substitui uma fotografia de movimento.

## Piloto separado proposto (aguarda aprovação)

Até oito origens bem definidas: `cal-flexao`, `cal-agachamento`, `cal-prancha-frontal`,
`cal-ponte`, `mus-supino-reto`, `mus-agachamento-barra`, `mus-remada-curvada` e
`mus-elevacao-lateral`. A seleção não é uma afirmação de frequência de uso.

Antes de publicar, apresentar ao responsável pelo produto cada arquivo real,
sua origem e licença individual, atribuição e revisão técnica. Priorizar produção
própria autorizada; Wikimedia Commons e wger são candidatos a pesquisa, não
acervos previamente autorizados. Não foi escolhida/aprovada nenhuma fotografia.

A próxima autorização deverá incluir renderização, créditos visíveis, orçamento
de bytes, imagens responsivas e tratamento de falha de rede. Não habilitar apenas
preenchendo o manifesto: a presente entrega prepara identidade e contrato, mas
não implementa o carregamento de mídia nem o piloto.
