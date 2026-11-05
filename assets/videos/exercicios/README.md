# Demonstrações em vídeo dos exercícios

O FORJA exibe demonstrações reais dos exercícios nas telas do aplicativo por incorporação oficial do YouTube (`youtube-nocookie.com`), sem baixar nem armazenar vídeos de terceiros no repositório:

- `assets/js/forja-videos-dados.js` — registro dos vídeos oficiais curtos (até 60 s, proporção 16:9 e enquadramento original) para os exercícios da biblioteca.
- `assets/js/forja-videos.js` — resolvedor de prioridade (vídeo do treino personalizado → vídeo oficial → imagem de referência RepDB), player 16:9 com controles e sem reprodução automática, ajuste opcional de zoom e corte 16:9 sem deformação para Shorts verticais exclusivamente em treinos personalizados e seletor **"Procurar vídeo"** no editor de rotinas.

## Manifesto local da tela `exercicio/`

Esta pasta também mantém `manifest.json` para a tela dedicada `exercicio/`, caso vídeos locais horizontais (`16:9`, até 60 s, de pessoas reais) sejam curados manualmente no futuro.

É proibido nesta pasta:

- qualquer MP4 renderizado a partir de modelo 3D (`Blender`, `Cycles`, manequim, retarget de mocap ou similar);
- vídeo vertical (9:16) ou fora do manifesto `manifest.json`;
- vídeo baixado do YouTube ou de terceiros sem licença explícita.

Enquanto `exercicios` estiver vazio em `manifest.json`, esta pasta contém apenas `README.md` e `manifest.json`.
