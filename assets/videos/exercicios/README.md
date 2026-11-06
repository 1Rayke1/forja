# Demonstrações em vídeo dos exercícios

O FORJA exibe demonstrações reais dos exercícios nas telas do aplicativo por incorporação oficial do YouTube (`youtube-nocookie.com`), sem baixar nem armazenar vídeos de terceiros no repositório:

- `assets/js/forja-videos-dados.js` — registro dos vídeos oficiais curtos (até 60 s, proporção 16:9 e enquadramento original) para os exercícios da biblioteca.
- `assets/js/forja-videos.js` — resolvedor de prioridade (vídeo do treino personalizado → vídeo oficial → imagem de referência RepDB), player 16:9 com controles, sem reprodução automática e sempre silencioso (`mute=1`), além do seletor **"Procurar vídeo"** no editor de rotinas.
- `netlify/functions/youtube-search.mjs` — proxy seguro da YouTube Data API v3 usado pela pesquisa de vídeos personalizados (`YOUTUBE_API_KEY` só no backend).

Somente vídeos **convencionais horizontais** (16:9) de até 60 s podem ser escolhidos; YouTube Shorts não são aceitos e não existe zoom/corte de enquadramento. Detalhes em `docs/videos-youtube.md`.

## Manifesto local da tela `exercicio/`

Esta pasta também mantém `manifest.json` para a tela dedicada `exercicio/`, caso vídeos locais horizontais (`16:9`, até 60 s, de pessoas reais) sejam curados manualmente no futuro.

É proibido nesta pasta:

- qualquer MP4 renderizado a partir de modelo 3D (`Blender`, `Cycles`, manequim, retarget de mocap ou similar);
- vídeo vertical (9:16) ou fora do manifesto `manifest.json`;
- vídeo baixado do YouTube ou de terceiros sem licença explícita.

Enquanto `exercicios` estiver vazio em `manifest.json`, esta pasta contém apenas `README.md` e `manifest.json`.
