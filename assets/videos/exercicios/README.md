# Vídeos de apresentação dos exercícios

Esta pasta recebe o MP4 final de cada exercício. O gerador
`tools/gerar-apresentacao-exercicios.mjs` varre os arquivos daqui e só marca
`modo: "video"` quando o arquivo passa em todas as verificações.

## Nome obrigatório

```
{exercicioId}-{personagem}-horizontal-16x9.mp4
```

- `exercicioId`: o `id` da biblioteca (`cal-flexao`, `mus-supino-reto`…).
- `personagem`: `masculino` ou `feminino`.
- Extensão `.mp4` (H.264, `yuv420p`, `+faststart`, sem trilha de áudio).

Exemplo: `cal-flexao-masculino-horizontal-16x9.mp4`.

## Especificação verificada

| Item | Valor |
| --- | --- |
| Proporção | 16:9 horizontal (9:16 é rejeitado) |
| Resolução | 1280 × 720 |
| FPS | 30 |
| Fundo | `#121010` uniforme |
| Câmera | ¾, quase lateral, azimute −58°, elevação 22°, FOV vertical 32° |
| Corpo | inteiro visível, enquadramento consistente entre exercícios |
| Áudio | nenhum |
| Loop | infinito; a emenda qN→q0 deve ser visualmente contínua |

O player da tela `exercicio/` é mudo, inline, com autoplay e loop, e não
oferece controles. O arquivo continua sendo a fonte da verdade: se estiver
fora da especificação, a tela não o exibe.

## Estado atual

Nenhum MP4 foi renderizado nesta etapa. Dos 37 exercícios:

- **14** têm clipe próprio com `status: "exact"` e aparecem em prévia 3D;
- **15** têm apenas um clipe `status: "review"` (aproximado, ainda não é o
  movimento final) e aparecem como pendência de revisão técnica;
- **8** não têm clipe próprio disponível e aparecem como pendência de animação.

Nenhum clipe é reutilizado entre exercícios. Quando o catálogo lista o mesmo
clipe em dois exercícios (prancha, elevação de pernas e caminhada), só o
primeiro fica com ele; o outro entra como pendência explícita.

A auditoria dos 43 GLBs encontrou **42 loops fechados e 1 exceção conhecida**:
`caminhada`, com **2,1 mm** de deslocamento residual na raiz (`hips`). O clipe
original é preservado sem correção automática; a continuidade visual no MP4
renderizado ainda precisa ser inspecionada quadro a quadro.

A renderização dos MP4 depende de aprovação explícita.
