# Créditos e licença — ilustrações RepDB (free tier)

## Atribuição exigida

> Exercise data by <a href="https://repdb.co">RepDB (repdb.co)</a>

Presente de forma visível em:

- rodapé das **13 páginas** do app (`.footer-credits`);
- tela `configuracoes/index.html#creditos-imagens`;
- legenda de **cada** ilustração exibida (modal de detalhe e execução);
- **cada card** do seletor “Buscar outra imagem” (prévia + fonte);
- `README.md` e `assets/demonstracoes/NOTICE.md`.

## Fonte

| | |
| --- | --- |
| Projeto | [RepDB/exercise-dataset](https://github.com/RepDB/exercise-dataset) |
| Edição | Free tier |
| Commit fixado | `b407c5951a027a27817fb2a5cee9ec9feffc4dc7` (2026-10-18) |
| Arquivos | `images/flat/*.webp` — ilustrações flat 512×512 |
| Autor | © 2026 Sergei Argutin (RepDB), Berlim, Alemanha |
| Licença | [RepDB Free Tier License v1.0](https://github.com/RepDB/exercise-dataset/blob/b407c5951a027a27817fb2a5cee9ec9feffc4dc7/LICENSE-DATA.md) |
| Cópia local | `assets/demonstracoes/LICENSE-DATA.md`, `assets/demonstracoes/ATTRIBUTION.md` |
| Procedência/hashes | `assets/demonstracoes/NOTICE.md`, `assets/demonstracoes/manifest.json` |
| Verificado em | 2026-10-27 |

## Termos relevantes

1. Uso pessoal **e comercial dentro de aplicações**, sem custo.
2. **Atribuição visível obrigatória** com link para `https://repdb.co`.
3. **Sem republicação como dataset/API**: o FORJA vende/serve um app, não um
   dataset. Por isso só um subconjunto de imagens e um mapa de uso interno são
   versionados — nunca o `exercises.json` completo de 650 registros.
4. Recorte/redimensionamento/recolorização são permitidos para uso in-app.
   **Nenhuma modificação** foi feita: os bytes são cópia integral do commit.
5. **Sem IA generativa**: as imagens não foram usadas como entrada, referência
   ou condicionamento para reestilização, style transfer ou treinamento.
   A galeria de revisão só compõe `<img>` locais em HTML. Observação de
   procedência: o próprio RepDB declara, no texto da licença, que as
   ilustrações são obras originais criadas com ferramentas de IA sob
   encomenda. O FORJA não fez nenhuma derivação generativa adicional.
6. `premium-samples/` (animações de avaliação do tier pago, termo 6) **não**
   foi usado.
7. Sem garantia; conteúdo informativo, não conselho médico.

## O que está no repositório

- 148 WebP (2.573.658 bytes ≈ 2,45 MiB), cada um com SHA-256, tamanho e URL de
  origem em `manifest.json`.
- 121 `demoId`s com rótulo pt-BR, nome original em inglês, poses disponíveis e
  `creditId`.
- `creditos.json` com autor, licença, URL da licença, URL da fonte e notas.

O bundle de runtime (`assets/js/forja-demonstracoes-dados.js`) contém apenas os
metadados necessários para exibir; os hashes ficam no manifesto do repositório.

## Verificação

```sh
node tools/sincronizar-repdb.mjs --check
npm test
```

O comando valida hashes, tamanho total (≤ 3,6 MiB), ausência de
`premium-samples`, sincronia entre `mapeamento.json`/`manifest.json`/bundle e
rótulos órfãos.

## Recursos separados

A figura anatômica do atlas (`assets/anatomia/`) **não** vem da RepDB e tem seu
próprio `NOTICE.md` com licença ainda não verificada. Os créditos acima não a
cobrem; ela mostra grupos musculares, não a execução do movimento.
