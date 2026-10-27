# FORJA

Aplicativo estático de treinos, calendário e missões. Funciona sem build,
sem backend e sem conta: os dados ficam no `localStorage` do navegador.
Publicável diretamente no GitHub Pages (inclusive sob `/forja/`).

## Executar

```sh
npm install
npm run serve          # http://127.0.0.1:8080/
npm test               # métricas, forja, onboarding, atlas, paridade, demonstrações
npm run test:e2e       # Chromium real, servindo o repo sob /forja/
```

## Ilustrações de exercícios

As demonstrações visuais usam um subconjunto do catálogo livre da RepDB.

> **Exercise data by [RepDB (repdb.co)](https://repdb.co)** — usado sob a
> [RepDB Free Tier License v1.0](assets/demonstracoes/LICENSE-DATA.md), com
> atribuição visível. © 2026 Sergei Argutin (RepDB).

- Procedência, restrições e hashes: [`assets/demonstracoes/NOTICE.md`](assets/demonstracoes/NOTICE.md)
  e [`assets/demonstracoes/manifest.json`](assets/demonstracoes/manifest.json).
- Mapeamento, status (`exact`/`review`/`none`) e revisões visuais:
  [`docs/demonstracoes-revisao.md`](docs/demonstracoes-revisao.md).
- Créditos completos: [`docs/creditos-repdb.md`](docs/creditos-repdb.md).

```sh
node tools/sincronizar-repdb.mjs --check   # valida hashes, tamanho e bundle
```

Ferramenta de revisão visual: `tools/revisao-demonstracoes.html` (abrir por
HTTP, não `file://`). Nenhuma imagem de `premium-samples/`, nenhuma fonte
externa e nenhum processamento por IA generativa foram usados. Observação de
procedência: o próprio RepDB declara que as ilustrações foram criadas com
ferramentas de IA sob encomenda; o FORJA apenas as copia, sem derivação
generativa.

A figura anatômica do atlas é um recurso separado, com aviso próprio em
`assets/anatomia/NOTICE.md`.

## Documentação

- `docs/forja-rotinas-e-backup.md` — formato de dados, migração e backup JSON.
- `docs/fotografias-exercicios.md` — contrato de fotos (nenhuma publicada).
- `docs/atlas-anatomico.md` — classificação muscular e figuras.
- `docs/testes-paridade.md` — suíte de paridade.
