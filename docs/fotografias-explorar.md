# Fotografias da tela Explorar — procedência, contrato e validação

> **Escopo.** Esta entrega troca as imagens da tela **Descobrir/Explorar** por
> fotografias reais, licenciadas e otimizadas. Nada mais muda: rotas, filtros,
> exercícios, sessões, histórico, armazenamento e o Atlas muscular continuam
> como estavam. As ilustrações do RepDB continuam sendo o recurso das telas de
> exercício e o fallback visual do app.

## O que mudou na tela

| Seção | Antes | Depois |
| --- | --- | --- |
| Planos em destaque | ilustração RepDB | fotografia de contexto da modalidade |
| Foco do treino | ilustração RepDB (60×60) | fotografia do exercício ou do grupo muscular (60×60) |
| Planos de 7 dias | cartão sem imagem | fotografia de referência |
| Descubra recursos | ícone | capa fotográfica (ícone permanece só se não houver foto) |
| Treinos populares | ilustração RepDB | fotografia do exercício ou do grupo muscular |
| Treinos rápidos | ilustração RepDB | fotografia do exercício ou do grupo muscular |
| Treino direcionado | ícone | fotografia de fundo com sobreposição para contraste |

Cada cartão com fotografia exibe uma linha discreta de crédito
(`Foto: Autor / Unsplash`). Quando não existe fotografia adequada, o cartão
mostra o fundo de marca com o ícone neutro — **nenhum emoji** é usado como
substituto de imagem.

## Contrato de dados

O recurso é separado do contrato de FOTOS do catálogo
(`docs/fotografias-exercicios.md`): `F.catalog.PHOTO_MANIFEST` continua vazio e
congelado e `F.catalog.photoFor()` continua retornando `null` (teste 81). As
fotografias da Explorar vivem em um módulo próprio:

| Peça | Papel |
| --- | --- |
| `tools/fotografias/fontes.json` | procedência: provedor, licença, autor, página de origem, texto alternativo, foco do recorte, evidência |
| `tools/fotografias/cartoes.json` | vínculo cartão → fotografia, com o tipo `exato` ou `contexto` |
| `tools/gerar-fotografias.mjs` | gera derivados, `manifest.json`, `assets/js/forja-fotografias-dados.js` e `NOTICE.md` |
| `assets/fotografias/*.webp` | derivados publicados (960 px e 480 px de largura, corte 16:10) |
| `assets/fotografias/manifest.json` | manifesto distribuído, com SHA-256 de cada derivado |
| `assets/js/forja-fotografias.js` | resolvedor somente-leitura `F.fotos` |

Campos por fotografia no manifesto (contrato de `docs/fotografias-exercicios.md`):
`id`, `status` (`approved`), `variante`, `tipo`, `alt`, `foco`, `formato`,
`proporcao`, `variantes[]` (arquivo, largura, altura, bytes, SHA-256), `autor`,
`autorUrl`, `sourcePage`, `origemId`, `licenca`, `licencaUrl`, `provedor`,
`verificadoEm`, `evidencia`, `attribution`, `modificacoes`, `revisao`,
`modelPermission`.

### Regras de correspondência

1. Exercício só combina por `mode:libraryId` (mesma chave das demonstrações).
   **Nunca por nome**, aproximação ou heurística de texto.
2. `tipo: "exato"` significa que a fotografia mostra o próprio exercício.
   `tipo: "contexto"` significa categoria, equipamento ou ambiente — e o cartão
   nunca anuncia essa foto como execução do movimento.
3. Sem correspondência de exercício, entra a fotografia do grupo muscular
   (`roles.primary`, depois `roles.secondary`, depois `category` do catálogo),
   depois a da modalidade. Sem nada disso, o cartão usa o marcador neutro.
4. Se um derivado faltar, o `error` da imagem remove o elemento e o cartão fica
   com o fundo de marca — nenhuma imagem quebrada permanece na tela.

### Semântica visual

- Fotos mostram pessoas reais, com corpos, idades e níveis variados (inclui uma
  corredora com mais de sessenta anos), em academias reais e em ambientes
  externos — não apenas modelos de fitness.
- Nenhuma imagem passa por geração artificial. Nenhuma ilustração gerada por IA
  é usada como se fosse foto.
- O recorte é sempre 16:10 com gravidade declarada por foto, e o CSS usa
  `object-fit: cover` com sobreposição em degradê para manter o contraste do
  texto em telas de 320 px a 1440 px.

## Procedência e licença

Todas as fotografias vêm do **Unsplash** sob a **Unsplash License**
(<https://unsplash.com/license>): uso comercial e não comercial gratuito, sem
exigência de atribuição. O FORJA mantém autoria e página de origem visíveis.

- Nenhuma amostra da coleção paga (Unsplash+) foi baixada ou usada.
- Os arquivos originais não são versionados. O repositório contém apenas os
  derivados WebP, o manifesto e o `NOTICE`.
- Lista completa com autoria, título e página de cada foto:
  [`assets/fotografias/NOTICE.md`](../assets/fotografias/NOTICE.md).
- Créditos na interface: `configuracoes/index.html#creditos-fotografias`.

Para regerar os derivados, coloque os originais (nomes em `fontes.json`) numa
pasta e rode:

```sh
node tools/gerar-fotografias.mjs --origem /caminho/dos/originais
node tools/gerar-fotografias.mjs --check   # valida o que está versionado
```

Requer ImageMagick (`convert`) com suporte a WebP. O gerador falha se algum
cartão apontar para uma fotografia inexistente ou tiver tipo inválido.

## Validação desta entrega

| Verificação | Resultado |
| --- | --- |
| Arquivos e SHA-256 do manifesto | teste 82 (jsdom/Node) |
| Imagens locais, `srcset`, dimensões e texto alternativo nos cartões | teste 83 |
| Créditos com autoria, licença e link externo seguro | teste 84 |
| Peso do conjunto | 17 fotos, 34 derivados, ~0,95 MB no total (960 px ≈ 40–90 KB) |
| Telas pequenas (320–430 px) | alturas de cartão reduzidas por CSS; texto e crédito permanecem legíveis |
| Telas grandes (≥768 px) | cartões um pouco mais altos, mesmo corte 16:10 |
| `npm test` | mesma linha de base: 107/110 (falhas 01, 04 e 70 são anteriores a esta entrega) |

Limitações registradas:

- Não há captura de tela automatizada neste ambiente (Chromium sem bibliotecas
  de sistema). A revisão visual foi feita com os derivados renderizados nos
  tamanhos reais de cartão (300 px, 400 px e miniatura de 60 px).
- Não foi encontrada fotografia livre, com resolução suficiente e enquadramento
  honesto, de **bicicleta ergométrica**. O cartão desse exercício usa a foto de
  contexto de cardio em máquina (`tipo: "contexto"`) e não afirma ser a
  bicicleta.
- O banner "Copyright" do Unsplash não é exibido; o crédito fica no rodapé de
  cada cartão e na tela de Configurações.
