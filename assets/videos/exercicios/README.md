# Vídeos de demonstração dos exercícios

Esta pasta é o destino dos vídeos horizontais de **pessoas reais** que vão
substituir as antigas demonstrações por personagens 3D. Nenhum vídeo foi
adicionado ainda e nenhuma busca automática é feita: os arquivos entram aqui
somente por curadoria manual, depois de aprovados.

## Especificação

| Item | Valor |
| --- | --- |
| Proporção | 16:9 horizontal (9:16 é rejeitado) |
| Resolução | 1280 × 720 |
| FPS | 30 |
| Duração | no máximo 60 segundos |
| Fundo | `#121010` uniforme |
| Corpo | inteiro visível, enquadramento consistente entre exercícios |
| Áudio | nenhum |
| Loop | infinito; a emenda do último quadro ao primeiro deve ser contínua |

O player da tela `exercicio/` é mudo, inline, com autoplay e loop, e não
oferece controles. O arquivo continua sendo a fonte da verdade: se estiver
fora da especificação, a tela não o exibe e informa a pendência.

## Nome do arquivo

```
{exercicioId}-horizontal-16x9.mp4
```

`exercicioId` é o `id` da biblioteca (`cal-flexao`, `mus-supino-reto`…). Exemplo:
`cal-flexao-horizontal-16x9.mp4`. O nome não leva modelo nem personagem: cada
exercício tem um único vídeo horizontal.

## Curadoria de origem (obrigatória)

Só entra aqui vídeo de **pessoa real**, gravado ou licenciado para o FORJA.
É proibido nesta pasta:

- qualquer MP4 renderizado a partir de modelo 3D (`Blender`, `Cycles`, manequim,
  retarget de mocap ou similar);
- vídeo vertical (9:16) ou com áudio;
- vídeo baixado de terceiros sem licença e atribuição registradas.

O manifesto guarda `origem` (`autoral` | `licenciado`) e `fonte` (autor ou
licença) por exercício, para que a origem seja auditável depois.

## Manifesto

`manifest.json` lista só os vídeos aprovados. Um exercício só aparece nele
quando o MP4 existe nesta pasta e cumpre a especificação:

```json
{
  "formato": "forja-videos-exercicios",
  "versao": 1,
  "especificacao": { "proporcao": "16:9", "largura": 1280, "altura": 720,
                     "fps": 30, "duracaoMaximaS": 60, "audio": false },
  "exercicios": [
    {
      "id": "cal-flexao",
      "nome": "Flexão de braço",
      "modalidade": "calisthenics",
      "video": "assets/videos/exercicios/cal-flexao-horizontal-16x9.mp4",
      "duracaoS": 12.5
    }
  ]
}
```

O manifesto é opcional: sem ele (ou sem a entrada de um exercício) a tela de
apresentação mostra o estado de pendência, sem quebrar a navegação.

## Estado atual

Nenhum vídeo publicado. A lista `exercicios` está vazia e todos os exercícios
da biblioteca aparecem na tela de apresentação como "ainda não tem vídeo de
demonstração".
