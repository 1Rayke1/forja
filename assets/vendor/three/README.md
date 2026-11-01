# three.js — cópia local (MIT)

Versão **r180** (`three@0.180.0`), servida pelo próprio FORJA em vez de CDN: o
app funciona offline, sem rastreamento e sem depender de terceiros em runtime.

Arquivos:

- `three.module.min.js` + `three.core.min.js` — build ESM. O módulo importa o
  core por caminho relativo, então os DOIS precisam existir lado a lado.
- `addons/loaders/GLTFLoader.js` — carrega os GLB dos personagens e animações.
- `addons/utils/BufferGeometryUtils.js` — dependência do GLTFLoader.
- `LICENSE` — texto da licença MIT, exigido na redistribuição.

## Uma modificação, de propósito

Os addons publicados no npm importam `"three"` como especificador nu, o que só
funciona com import map ou bundler. O FORJA não usa bundler, então as duas
linhas de import foram apontadas para `../../three.module.min.js`. Nada mais foi
alterado; para atualizar a versão, refaça essa troca depois de copiar os arquivos
novos.

O crédito aparece em `configuracoes/index.html#creditos-3d`.
