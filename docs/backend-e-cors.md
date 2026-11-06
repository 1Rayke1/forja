# Backend (Netlify Functions), CORS e GitHub Pages

O FORJA é publicado em dois lugares:

- **GitHub Pages** (fonte oficial do código, branch `main`):
  <https://1rayke1.github.io/forja/> — site estático, sem servidor.
- **Netlify** (backend + hospedagem alternativa):
  <https://prismatic-parfait-be3644.netlify.app> — hospeda as Netlify Functions
  (plano por IA e busca de vídeos do YouTube).

O GitHub Pages não executa serverless, então o frontend resolve os endpoints
do backend de forma diferente dependendo de onde está rodando.

## Resolução do endpoint (`F.apiUrl`)

O utilitário `F.apiUrl(path)` em `assets/js/forja-core.js` é usado por:

- `assets/js/forja-plano.js` (chamada ao gerador de planos);
- `assets/js/forja-videos.js` e `assets/js/forja-videos-dados.js` (busca do
  YouTube); todos os caminhos relativos de configuração passam por
  `resolveEndpoint`, que chama `F.apiUrl` quando o endpoint não é absoluto.

Regras:

| Host atual                                | Resultado de `F.apiUrl("api/x")`         |
|-------------------------------------------|------------------------------------------|
| `prismatic-parfait-be3644.netlify.app`    | `/api/x` (a Netlify redireciona para `/.netlify/functions/x`) |
| `1rayke1.github.io`, `localhost`, `file://` ou qualquer outro host | `https://prismatic-parfait-be3644.netlify.app/api/x` |

Sobrescrita para desenvolvimento local com `netlify dev`:

```js
window.FORJA_API_BASE = "http://localhost:8888";
location.reload();
```

Isso garante que chamadas cross-origin vindas do GitHub Pages acertem o backend
da Netlify (que tem CORS liberado para essa origem) e que chamadas feitas
diretamente da Netlify continuem usando o caminho relativo, evitando ida e
volta desnecessária.

## `FORJA_ALLOWED_ORIGINS` (CORS)

Variável de ambiente da Netlify, lista separada por vírgulas de origens
autorizadas a chamar as Functions. Se não for definida, o padrão de produção
é aplicado:

```
https://prismatic-parfait-be3644.netlify.app,https://1rayke1.github.io
```

Isso libera:

- o frontend servido pela própria Netlify;
- o site publicado no GitHub Pages em `https://1rayke1.github.io`.

Nenhuma outra origem recebe `Access-Control-Allow-Origin`; o navegador bloqueia
a leitura da resposta. O valor do cabeçalho nunca é copiado cegamente do
`Origin` da requisição.

Comportamento por endpoint:

- `workout-plan` (`POST /api/workout-plan`): responde preflight `OPTIONS 204`
  e adiciona os cabeçalhos CORS em todas as respostas (inclusive erros).
- `youtube-search` (`GET /api/youtube-search`): já possuía sua própria
  implementação de CORS; foi ajustada para usar o mesmo conjunto padrão de
  origens de produção e responder preflight `OPTIONS 204` com
  `access-control-allow-methods: GET, HEAD, OPTIONS`.

Para adicionar, por exemplo, um domínio próprio de homologação:

```
FORJA_ALLOWED_ORIGINS=https://prismatic-parfait-be3644.netlify.app,https://1rayke1.github.io,https://staging.forja.app
```

## Variáveis de ambiente do backend

| Variável                     | Obrigatória | Finalidade                                                                 |
|------------------------------|-------------|----------------------------------------------------------------------------|
| `OPENAI_API_KEY`             | para IA     | Chave da OpenAI usada por `workout-plan`.                                 |
| `OPENAI_MODEL`               | não         | Modelo (padrão `gpt-4.1-mini`).                                           |
| `YOUTUBE_API_KEY`            | para vídeos | Chave do YouTube Data API v3 (busca de vídeos).                           |
| `YOUTUBE_DAILY_QUOTA_UNITS`  | não         | Orçamento diário de quota (padrão 3000).                                  |
| `YOUTUBE_CACHE_TTL_SECONDS`  | não         | TTL do cache (padrão 600).                                                |
| `YOUTUBE_MAX_RESULTS`        | não         | Máximo de resultados por busca (padrão 10, teto 12).                      |
| `YOUTUBE_MAX_DURATION_SECONDS`| não        | Duração máxima aceita (padrão e teto 60).                                 |
| `YOUTUBE_RELEVANCE_LANGUAGE` | não         | Idioma de relevância (padrão `pt`).                                       |
| `YOUTUBE_REGION_CODE`        | não         | Região opcional (padrão vazio).                                           |
| `YOUTUBE_OEMBED_CHECK`       | não         | `0` desativa a confirmação extra via oEmbed (padrão ligado).              |
| `FORJA_ALLOWED_ORIGINS`      | não         | Origens liberadas para CORS (ver acima).                                  |

Nenhuma chave (`OPENAI_API_KEY`, `YOUTUBE_API_KEY`) é embutida no JavaScript
do cliente ou versionada no repositório.

## Workflow do GitHub Pages

`.github/workflows/static.yml` faz deploy automático em cada push para `main`
usando o artefato montado por `tools/preparar-site.sh` (preservado
integralmente). O site é publicado sob o caminho `/forja/` graças aos
caminhos relativos (`data-root`) e ao `F.url(...)`; nenhum `<base>` é
utilizado.

## Funcionalidades preservadas

- Remoção do sistema 3D antigo (não reintroduzido).
- Vídeos de demonstração silenciosos (`muted`, `mute=1` no embed, sem
  autoplay); controles visíveis conforme o contrato atual.
- Exclusão total de YouTube Shorts (marcadores de #shorts, miniaturas
  verticais, confirmação oEmbed) no backend — a função nunca devolve um
  Short ou um vídeo de orientação não confirmada.
- Somente vídeos horizontais (16:9) com até 60 segundos.
- Fallback para imagem de referência (RepDB) quando não houver vídeo
  disponível, sem tela quebrada.
- Pesquisa de vídeos personalizados pelo usuário via proxy seguro, em todos
  os hosts (Netlify e GitHub Pages).

## Testando

Em `localhost` com `npm run serve` (que só serve arquivos estáticos),
`F.apiUrl` detecta que não está na Netlify e aponta direto para o backend de
produção — a busca de vídeos e o gerador de planos funcionam sem precisar
subir Functions localmente.

Para testar as Functions localmente com chaves próprias:

```sh
netlify dev                       # sobe o frontend + Functions em :8888
# no console do navegador:
window.FORJA_API_BASE = "http://localhost:8888";
location.reload();
```

Ver também: `docs/videos-youtube.md` (detalhes do proxy, cache, quota, testes
específicos) e `docs/planejamento-inteligente.md` (gerador por IA).
