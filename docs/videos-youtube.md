# Vídeos de demonstração e pesquisa YouTube Data API v3

Este documento descreve o sistema de vídeos do FORJA depois da etapa
"Correções na seleção, integração com YouTube Data API v3 e implementação de
vídeos": os 26 vídeos oficiais, a pesquisa de vídeos personalizados via API
oficial, a remoção definitiva dos YouTube Shorts e o modo silencioso.

## 1. O que existe hoje

| Camada | Arquivo | Papel |
| --- | --- | --- |
| Catálogo oficial | `assets/js/forja-videos-dados.js` | 37 entradas (26 com vídeo, 11 `null`), duração ≤ 60 s, 16:9 |
| Resolução + player | `assets/js/forja-videos.js` | prioridade vídeo do treino → vídeo oficial → imagem de referência |
| Regras de dados | `assets/js/forja-core.js` | validação de id/URL, duração, orientação, normalização |
| Editor de rotinas | `assets/js/forja-treino.js` | botão **"Procurar vídeo"** por exercício e no formulário |
| Execução | `assets/js/forja-sessao.js` | palco de demonstração durante a sessão |
| Backend | `netlify/functions/youtube-search.mjs` | proxy seguro da YouTube Data API v3 |
| Rota | `netlify.toml` | `/api/youtube-search` → `/.netlify/functions/youtube-search` |
| Testes | `tests/videos-youtube.test.mjs`, `tests/youtube-proxy.test.mjs`, `tests/e2e.browser.mjs` | jsdom, unidade do proxy e Chromium real |

Prioridade de demonstração (inalterada):

1. vídeo personalizado do exercício **naquela rotina**;
2. vídeo oficial do catálogo;
3. imagem de referência RepDB + aviso discreto *"Vídeo de demonstração ainda não
   disponível"*.

Nada disso foi substituído pela pesquisa: a API é usada **exclusivamente** para
escolher vídeos personalizados.

## 2. Integração com a YouTube Data API v3

### Arquitetura

```
Navegador (assets/js/forja-videos.js)
   │  GET /api/youtube-search?q=<termo>&limit=10        (mesmo domínio, sem chave)
   ▼
Proxy backend (netlify/functions/youtube-search.mjs)
   │  GET https://www.googleapis.com/youtube/v3/search   (chave no servidor)
   │  GET https://www.googleapis.com/youtube/v3/videos   (duração, status, miniaturas)
   │  GET https://www.youtube.com/oembed                 (confirmação extra, sem chave)
   ▼
YouTube Data API v3
```

O navegador nunca fala com `googleapis.com` e nunca possui a chave. A Function:

1. valida método, parâmetros e taxa por IP;
2. chama `search.list` com `type=video`, `videoEmbeddable=true`,
   `videoDuration=short`, `safeSearch=strict`, `relevanceLanguage=pt` e
   `maxResults` limitado (padrão 10, teto 12);
3. chama `videos.list` uma única vez para todos os ids (`snippet,contentDetails,status`);
4. filtra duração (1–60 s), privacidade (`public`), incorporação (`embeddable`) e
   **orientação horizontal confirmada**;
5. devolve `videoId`, `title`, `channelTitle`, `durationSeconds`, `thumbnailUrl`,
   `orientation` e `meta` com contadores de quota e de rejeições.

Modo de inspeção: `GET /api/youtube-search?id=<videoId>` valida um vídeo cujo
link foi colado no modal e responde `ok`, `vertical`, `duration`, `unconfirmed`,
`not-embeddable`, `not-public` ou `not-found`.

### Segurança da chave

- `YOUTUBE_API_KEY` é lida apenas de `process.env` no backend
  (`readConfig(env = process.env)`);
- nenhuma chave existe em `assets/js/*`, em HTML, em CSS ou em testes
  (`tests/videos-youtube.test.mjs` varre o repositório inteiro procurando o
  padrão `AIza[0-9A-Za-z_-]{35}` e falha se encontrar);
- `.env` e `.env.*` estão no `.gitignore`; apenas `.env.example` (sem valores) é
  versionado;
- a resposta nunca contém a chave nem a URL upstream (que a carrega): existe uma
  verificação final (`serialize`) que redige qualquer ocorrência, e os logs usam
  a mesma proteção;
- `referrer-policy: no-referrer` e `x-content-type-options: nosniff` saem em
  todas as respostas; CORS só é liberado para origens listadas em
  `FORJA_ALLOWED_ORIGINS` (padrão de produção:
  `https://prismatic-parfait-be3644.netlify.app,https://1rayke1.github.io`,
  liberando o site da Netlify e o GitHub Pages);
- a restrição da chave à YouTube Data API v3 configurada no Google Cloud é
  preservada: o proxy só chama `search.list`, `videos.list` e o oEmbed público.

### Cache e quota

| Mecanismo | Onde | Efeito |
| --- | --- | --- |
| Cache de respostas (padrão 600 s, máx. 200 entradas) | Function | pesquisa repetida custa 0 unidades |
| `Cache-Control: public, max-age=60, s-maxage=600` | Function → CDN/navegador | repetições nem chegam à Function |
| Deduplicação de chamadas simultâneas | Function | duas pesquisas iguais ao mesmo tempo = 1 chamada upstream |
| Orçamento diário (`YOUTUBE_DAILY_QUOTA_UNITS`, padrão 3000) | Function | bloqueia com HTTP 429 antes de gastar além do previsto |
| `quotaExceeded` upstream marca o dia como esgotado | Function | nenhuma chamada extra no mesmo dia |
| Rate limit por IP (24 req/min) | Function | 429 `rate-limited` |
| `search.list` = 100 unidades, `videos.list` = 1, oEmbed = 0 | YouTube | uma pesquisa completa = 101 unidades |
| Cache local do cliente (padrão 600 s, máx. 60 entradas) + deduplicação | `forja-videos.js` | reabrir o modal ou repetir o termo não refaz requisição |

Com o orçamento padrão de 3000 unidades, são ~29 pesquisas reais por dia por
instância (o resto é absorvido por cache). Para um contador diário compartilhado
entre instâncias é preciso um armazenamento externo (ex.: Netlify Blobs) — veja
"Configurações externas pendentes".

### Erros tratados

| Situação | Backend | Interface |
| --- | --- | --- |
| Sem `YOUTUBE_API_KEY` | 503 `unconfigured` | aviso citando a variável e oferecendo o campo de link |
| Orçamento/`quotaExceeded` | 429 `quota` | aviso de limite diário |
| Excesso de requisições | 429 `rate-limited` | aviso para aguardar |
| Termo inválido | 400 | "Digite o nome do exercício…" |
| Falha do provedor / rede | 502 | "Não foi possível consultar…" |
| Rota inexistente (site só estático) | 404 (HTML) | "busca integrada não está disponível neste servidor" |
| Pesquisa sem resultados | 200 com `items: []` | "Nenhum vídeo convencional horizontal (16:9) de até 60 segundos…" |
| Durante a pesquisa | — | spinner + `aria-busy`, campos e confirmação bloqueados |

## 3. YouTube Shorts fora da seleção

Shorts foram removidos do produto, junto com o recurso de "zoom e corte 16:9":

- `F.YOUTUBE_FRAMING_VALUES` passou a ser `["original"]`; o CSS
  `.video-demo-player.is-zoom-crop`, os botões `[data-framing-option]` e todos os
  textos de enquadramento foram removidos;
- nenhum vídeo é re-enquadrado: o iframe ocupa o quadro 16:9 inteiro, sempre no
  formato original;
- links `youtube.com/shorts/<id>` (inclusive com `?feature=share`) são recusados
  no modal antes de qualquer requisição (`F.isYouTubeShortsUrl`);
- resultados de pesquisa só entram na lista com orientação **horizontal
  confirmada** (`F.isConfirmedHorizontalVideo`): sem o campo `orientation`, com
  `vertical`/`unknown`, com marcador de Short ou com miniatura mais alta do que
  larga, o item é descartado;
- confirmar sem vídeo selecionado continua bloqueado, e um Short nunca chega a
  ganhar prévia.

### Como a orientação é determinada

Título e duração **não** são usados como prova. Os sinais, em ordem:

1. **Geometria das miniaturas** devolvidas por `videos.list`
   (`snippet.thumbnails.*`): vídeos convencionais retornam a escada padrão do
   YouTube (120×90, 320×180, 480×360, 640×480, 1280×720 — sempre mais larga do
   que alta); Shorts retornam miniaturas verticais (9:16). Qualquer amostra com
   altura > largura ⇒ vertical.
2. **Marcadores textuais**: `#shorts` ou link `/shorts/` em título, descrição ou
   tags ⇒ vertical.
3. **oEmbed público** (`youtube.com/oembed`, sem chave e sem quota): usado só
   quando as miniaturas não confirmam (ausentes ou quadradas). Geometria do
   player e da miniatura decidem entre horizontal e vertical.
4. **Sonda local no navegador** (`probeOrientation`, geometria de
   `i.ytimg.com/vi/<id>/mqdefault.jpg`): último recurso quando o backend não
   existe (hospedagem puramente estática) e o usuário cola um link.

Se nenhum sinal confirma que o vídeo é horizontal, ele **não** é apresentado como
resultado aprovável (`orientation: "unknown"` ⇒ rejeitado no backend e no
cliente).

## 4. Vídeos sempre sem som

Todos os embeds são montados por `F.videos.buildEmbedUrl()` com os mesmos
parâmetros, em qualquer etapa:

```
https://www.youtube-nocookie.com/embed/<id>?autoplay=0&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&mute=1
```

Coberto por testes (`assertSilentEmbed`): criação/edição de treinos, pesquisa e
seleção, prévia antes da confirmação, detalhe da biblioteca e execução do treino.
Nenhum elemento `<video>`/`<audio>` é criado pelo módulo.

## 5. Modal "Procurar vídeo"

- **Título**: "Procurar vídeo".
- **Identificação do exercício**: faixa com o rótulo "Exercício", o nome digitado
  e a modalidade; a mensagem do modal repete o nome e diz que vale para aquele
  treino personalizado.
- **Campo de pesquisa**: preenchido com o nome do exercício, aceita termo
  relacionado; botão "Pesquisar" (vira "Pesquisando…" durante a busca).
- **Resultados**: cartões com miniatura, duração, título, canal e o selo
  "Horizontal 16:9", cada um com a ação **Visualizar**.
- **Prévia**: player 16:9 silencioso, sem autoplay, com controles, título, canal,
  duração e aviso de que a prévia não tem áudio.
- **Link direto**: campo opcional para vídeo convencional, com botão
  **Visualizar** e nota de que só vídeos horizontais de até 60 s são aceitos.
- **Ações**: **Cancelar**, **Usar vídeo padrão** (quando já existe vídeo
  personalizado) e **Confirmar vídeo**.

## 6. Compatibilidade com dados já salvos

- `framing: "zoom"` (herança do recurso removido) continua **aceito** na leitura
  de rotinas e backups (`F.YOUTUBE_LEGACY_FRAMING_VALUES`), para não invalidar um
  treino existente; ao normalizar, vira `"original"` e o vídeo toca sem corte;
- `isValidYouTubeVideoShape` continua rejeitando valores inventados
  (`"stretch"`) e campos desconhecidos (`orientation` nunca é persistido);
- vídeos personalizados convencionais já salvos seguem intactos;
- o formato do backup JSON não mudou.

## 7. Configurações externas pendentes

Nenhuma delas pode ser feita a partir do repositório:

1. **Publicar o backend.** O FORJA hoje é servido como site estático no GitHub
   Pages, que **não executa funções serverless** — lá a pesquisa responde
   "busca integrada não está disponível neste servidor" e o campo de link
   continua funcionando com a sonda local. Para ativar a pesquisa é preciso
   publicar em um host com funções (Netlify é o suporte já existente no
   repositório: `netlify.toml` + `netlify/functions/`).
2. **Cadastrar `YOUTUBE_API_KEY`** no ambiente privado do deploy (Netlify:
   *Site configuration → Environment variables*, ou `netlify env:set
   YOUTUBE_API_KEY <chave> --scope <equipe> <site>`; local: `.env` criado a
   partir de `.env.example` para `netlify dev`). A chave fornecida nesta etapa
   **não** foi gravada em nenhum arquivo do repositório; como ela circulou em
   conversa, recomenda-se rotacioná-la no Google Cloud antes do deploy.
3. **Manter as restrições da chave** no Google Cloud: API = YouTube Data API v3;
   restrição de aplicação = HTTP referrers com o domínio de produção; quota
   compatível com o orçamento definido em `YOUTUBE_DAILY_QUOTA_UNITS`.
4. **Opcional**: `FORJA_ALLOWED_ORIGINS` (CORS), `YOUTUBE_MAX_RESULTS`,
   `YOUTUBE_CACHE_TTL_SECONDS`, `YOUTUBE_RELEVANCE_LANGUAGE`,
   `YOUTUBE_REGION_CODE`, `YOUTUBE_OEMBED_CHECK=0` (desliga a confirmação extra)
   e um armazenamento externo (ex.: Netlify Blobs) se o contador diário de quota
   precisar ser compartilhado entre instâncias.

## 8. Testes

```sh
npm test                 # inclui tests/videos-youtube.test.mjs e tests/youtube-proxy.test.mjs
npm run test:videos      # só a suíte de vídeos (frontend)
npm run test:youtube-proxy  # só a suíte do proxy backend
npm run test:e2e         # Chromium real; /api/youtube-search é atendido pela Function real
```

No E2E, a rota `/api/youtube-search` é respondida pela **própria Function do
repositório** com o upstream do Google simulado, então filtros de duração,
orientação, Shorts, cache e quota são exercitados de ponta a ponta. Nenhuma
chamada real é feita à API do YouTube nos testes (nenhuma unidade de quota é
gasta) — e a chave de produção não está disponível no ambiente de testes.

## 9. Limitações conhecidas

- A YouTube Data API v3 não expõe um campo oficial "é Short" nem a proporção do
  vídeo; a classificação usa a geometria das miniaturas, marcadores textuais e o
  oEmbed. Vídeos sem nenhum desses sinais são tratados como **não confirmados** e
  descartados (podem existir falsos negativos: um vídeo horizontal legítimo pode
  ficar de fora).
- Contadores de cache/quota/rate limit vivem na memória da instância serverless;
  instâncias frias recomeçam do zero (o cache de CDN cobre as repetições).
- Sem backend (GitHub Pages), a pesquisa não funciona e a confirmação de um link
  colado depende da sonda local de geometria; quando ela não confirma, o vídeo é
  bloqueado.
- O sandbox de desenvolvimento desta etapa não tem acesso a
  `www.googleapis.com`, então nenhuma chamada real à API foi executada aqui.
