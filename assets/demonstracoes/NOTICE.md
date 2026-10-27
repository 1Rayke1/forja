# FORJA — NOTICE das demonstrações visuais

Este diretório contém um **subconjunto** de ilustrações de exercícios usado
dentro do app FORJA. Não é o dataset completo e não é uma redistribuição de
dataset/API.

## Fonte

- Projeto: [RepDB exercise-dataset](https://github.com/RepDB/exercise-dataset)
- Edição: **free tier**
- Commit fixado: `b407c5951a027a27817fb2a5cee9ec9feffc4dc7` (2026-10-18)
- Arquivos de origem: `images/flat/*.webp` (ilustrações flat 512×512)
- Autoridade licenciante: © 2026 Sergei Argutin (RepDB), Berlim, Alemanha
- Licença: **RepDB Free Tier License v1.0**, cópia integral em
  [`LICENSE-DATA.md`](LICENSE-DATA.md); snippets de atribuição em
  [`ATTRIBUTION.md`](ATTRIBUTION.md).

## Atribuição exigida

> Exercise data by [RepDB (repdb.co)](https://repdb.co)

O texto com link visível está no rodapé das 13 páginas do app e na tela
`configuracoes/index.html#creditos-imagens`. Cada ilustração exibida também
leva uma legenda com a fonte e o link para os créditos.

## O que foi usado

- 148 arquivos WebP (2.573.658 bytes ≈ 2,45 MiB), listados com SHA-256,
  tamanho e URL de origem em [`manifest.json`](manifest.json).
- 121 IDs de demonstração (`repdb:<id>`), com rótulos pt-BR em
  [`rotulos.json`](rotulos.json), status e revisões em
  [`mapeamento.json`](mapeamento.json) e créditos em
  [`creditos.json`](creditos.json).
- Nenhum arquivo de `exercises.json` completo, nenhum arquivo de
  `premium-samples/`, nenhuma imagem de outra fonte.

## Restrições observadas

1. **Uso in-app.** Os arquivos são servidos como parte deste aplicativo
   estático; não há endpoint, API, dump de dados ou diretório navegável com o
   catálogo completo.
2. **Sem redistribuição como dataset.** O manifesto e o mapeamento são
   metadados de uso interno do app, não um dataset autônomo.
3. **Sem IA generativa.** Nenhuma imagem foi usada como entrada, referência
   ou condicionamento para modelos generativos, reestilização, style transfer
   ou fine-tuning. A galeria de revisão
   (`tools/revisao-demonstracoes.html`, ferramenta de manutenção que fica apenas
   no repositório e não é publicada no site) apenas compõe `<img>` locais em
   HTML. Nota de procedência: o próprio RepDB
   declara, no termo final da licença, que as ilustrações são obras originais
   criadas com ferramentas de IA sob encomenda. O FORJA não acrescentou nenhum
   processamento generativo — os bytes são os do commit fixado.
4. **Sem amostras pagas.** `premium-samples/` (animações de avaliação do tier
   pago, de uso apenas de avaliação segundo o termo 6) está excluído.
5. **Modificações.** Nenhuma. Os bytes são cópia integral dos arquivos do
   commit fixado, verificável por `node tools/sincronizar-repdb.mjs --check`.
6. **Sem garantia / não é conselho médico.** As ilustrações são informativas
   (termo 7 da licença). A figura anatômica do atlas do FORJA é um recurso
   separado e continua com seu próprio aviso de licença.

## Verificação visual

As revisões em `mapeamento.json` registram `reviewedBy`, `reviewedAt`,
`method`, `evidenceFiles` e `visualCheck`. As confirmações existentes foram
feitas pelo **agente de desenvolvimento**, por inspeção de folhas de contato
geradas localmente, e **não** foram atribuídas ao usuário do FORJA.
Nenhuma correspondência foi inventada: itens sem verificação documentada
permanecem `pending` e são exibidos com o selo “Precisa de revisão”.

## Regeneração

```sh
node tools/sincronizar-repdb.mjs          # baixa o commit fixado e regenera
node tools/sincronizar-repdb.mjs --check  # valida hashes, tamanho e bundle (offline)
```
