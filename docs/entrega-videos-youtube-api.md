# Entrega — seleção de vídeos, YouTube Data API v3 e remoção de Shorts

Etapa: "Correções na seleção, integração com YouTube Data API v3 e
implementação de vídeos". Documentação técnica completa em
[`docs/videos-youtube.md`](videos-youtube.md).

## Arquivos

### Novos

| Arquivo | Conteúdo |
| --- | --- |
| `netlify/functions/youtube-search.mjs` | Proxy seguro da YouTube Data API v3 (pesquisa + inspeção), com filtros, cache, quota, rate limit e tratamento de erros |
| `tests/youtube-proxy.test.mjs` | 16 testes de unidade do proxy (upstream do Google simulado; zero chamada real) |
| `docs/videos-youtube.md` | Arquitetura, segurança da chave, regra de orientação, quota, nomenclatura, limitações e configuração externa |
| `.env.example` | Modelo **sem valores** das variáveis do backend (`YOUTUBE_API_KEY` e opcionais) |

### Modificados

| Arquivo | Mudança |
| --- | --- |
| `assets/js/forja-videos.js` | Pesquisa reescrita para falar só com o proxy; cache local + deduplicação; estados de carregamento/vazio/erro/quota/sem backend; modal "Procurar vídeo" com identificação do exercício, botão **Visualizar** por resultado, prévia silenciosa e campo de link que recusa Shorts; remoção de todo o código de zoom/corte; `probeOrientation()` |
| `assets/js/forja-core.js` | `YOUTUBE_FRAMING_VALUES = ["original"]`, `YOUTUBE_LEGACY_FRAMING_VALUES` (tolerância de leitura), `YOUTUBE_ORIENTATIONS`, `hasYouTubeShortsMarker()`, `isYouTubeShortsUrl()`, `youtubeThumbnailSamples()`, `isConfirmedHorizontalVideo()` |
| `assets/js/forja-videos-dados.js` | Configuração pública sem `apiKey` (campo é descartado se alguém o definir) e com `endpoint: "/api/youtube-search"`, `maxResults`, `cacheTtlMs`; comentários atualizados. **Os 26 vídeos oficiais não foram tocados** |
| `assets/js/forja-treino.js` | Rótulo da linha volta a ser apenas "Vídeo personalizado" (sem "zoom 16:9") |
| `assets/js/forja-sessao.js` | Chave de renderização do palco sem o campo `framing` |
| `assets/css/demonstracoes.css` | Removidos `.video-demo-player.is-zoom-crop` e `.video-picker-framing*`; adicionados identificação do exercício, spinner/carregamento, estados `is-loading`/`is-unconfigured`/`is-cached`, lista vazia e nota do campo de link |
| `netlify.toml` | Redirect `/api/youtube-search` → `/.netlify/functions/youtube-search` |
| `.gitignore` | `.env`, `.env.*` (com exceção `!.env.example`) e `.netlify/` |
| `configuracoes/index.html` | Créditos de vídeo: áudio sempre desligado e seção sobre a pesquisa via proxy |
| `README.md`, `assets/videos/exercicios/README.md` | Descrevem a pesquisa por proxy, a exigência de horizontal e a remoção de Shorts/zoom |
| `package.json` | `npm test` inclui o proxy; novos scripts `test:videos` e `test:youtube-proxy` |
| `tests/videos-youtube.test.mjs` | Reescrito: 14 testes (era 11) cobrindo proxy, Shorts bloqueados, cache, legado zoom, nomenclatura, modo silencioso e erros |
| `tests/e2e.browser.mjs` | `/api/youtube-search` passa a ser respondido pela **Function real** com o upstream simulado; verificações de Shorts/zoom substituídas por recusa de Shorts, resultados horizontais, legado e estados de erro |

## Antes → depois

| Situação | Antes | Depois |
| --- | --- | --- |
| Pesquisa de vídeos | Chamada direta do navegador a `googleapis.com`, exigindo chave em `window.FORJA_YOUTUBE_CONFIG.apiKey` (JavaScript público) | Chamada ao proxy `/api/youtube-search`; a chave vive só em `process.env.YOUTUBE_API_KEY` |
| Sem chave configurada | Mensagem pedindo para colocar a chave no JavaScript público | Mensagem informando que o backend precisa de `YOUTUBE_API_KEY`; link direto continua disponível |
| YouTube Shorts | Aceitos na pesquisa e por link; opção "Zoom e corte 16:9 (Short)" re-enquadrava o vídeo vertical | Recusados na pesquisa, no link `/shorts/`, no link `watch?v=` de vídeo vertical e na confirmação; nenhum zoom/corte existe |
| Vídeo sem orientação confirmada | Podia aparecer com o selo "Short vertical" | Não é apresentado (`unknown` ⇒ descartado no backend e no cliente) |
| Vídeos convencionais ≤ 60 s | Aceitos | Aceitos (comportamento preservado) |
| Consultas repetidas | Sempre nova chamada à API (100 unidades cada) | Cache no backend (600 s) + `Cache-Control` de CDN + deduplicação + cache local no cliente |
| Quota | Sem controle | Orçamento diário (padrão 3000 unidades ≈ 29 pesquisas), bloqueio 429 antes de gastar, `quotaExceeded` encerra o dia |
| Carregamento | Só texto de status | Spinner, `aria-busy`, campos e confirmação bloqueados durante a busca |
| Modal | Título "Procurar vídeo" com textos sobre Shorts e enquadramento | Título "Procurar vídeo", faixa identificando o exercício, textos sem Shorts/zoom, botões **Visualizar** / **Cancelar** / **Confirmar vídeo** |
| Áudio | `mute=1` no player e na prévia | Igual, agora com asserção explícita em todas as etapas (criação, pesquisa, prévia, execução) |
| Dados antigos com `framing: "zoom"` | Reproduzidos com corte 16:9 | Continuam válidos e reproduzem sem corte; normalizados para `"original"` ao salvar |

## Preservado (sem alteração)

26 vídeos oficiais e as 11 entradas `null`; ilustrações de referência RepDB e
seus créditos; fallbacks para vídeo indisponível/removido/erro de player;
persistência do vídeo personalizado por rotina; integração com a sessão de
treino; backup e restauração JSON (incluindo a rejeição de vídeo malformado);
criação e edição de rotinas; modo silencioso; nenhum componente do antigo
sistema 3D foi restaurado.

## Testes

| Comando | Resultado |
| --- | --- |
| `npm test` | Aprovado: métricas 18/18, forja 110/110, onboarding 21/21, plano (Endpoint + Plano) ok, atlas 13/13, paridade 40/40, demonstrações 17/17, apresentação de exercícios 7/7, **vídeos YouTube 14/14**, **proxy YouTube 16/16** |
| `npm run test:e2e` | 38/39 verificações aprovadas. A única falha (`configuracoes/ requestfailed: …/assets/demonstracoes/jumping-jacks-start.webp`) **já existe na `main`**: reproduzida na execução de referência antes de qualquer alteração desta etapa, é um `ERR_ABORTED` de imagem lazy-load ao destruir a página e não tem relação com vídeos |

Nenhum teste faz chamada real à YouTube Data API v3 (o upstream é simulado),
portanto nenhuma unidade de quota foi consumida e nenhuma chave foi necessária.

## Configurações externas pendentes (fora do repositório)

1. Publicar o site em um host com funções serverless (Netlify já está
   configurado em `netlify.toml`). **GitHub Pages não executa funções**: lá a
   pesquisa informa que o backend está ausente e o campo de link segue ativo.
2. Cadastrar `YOUTUBE_API_KEY` no ambiente privado do deploy (Netlify →
   Environment variables, `netlify env:set YOUTUBE_API_KEY …`, ou `.env` local
   para `netlify dev`). A chave enviada nesta etapa **não foi gravada em nenhum
   arquivo**; como circulou em conversa, recomenda-se rotacioná-la antes do deploy.
3. Manter no Google Cloud a restrição da chave à YouTube Data API v3 (e, se
   possível, por HTTP referrer do domínio de produção).
4. Opcionais: `YOUTUBE_DAILY_QUOTA_UNITS`, `YOUTUBE_CACHE_TTL_SECONDS`,
   `YOUTUBE_MAX_RESULTS`, `YOUTUBE_RELEVANCE_LANGUAGE`, `YOUTUBE_REGION_CODE`,
   `YOUTUBE_OEMBED_CHECK`, `FORJA_ALLOWED_ORIGINS` e armazenamento externo para
   um contador de quota compartilhado entre instâncias.

## Limitações

- A YouTube Data API v3 não tem campo oficial "é Short" nem de proporção; a
  classificação usa geometria das miniaturas, marcadores textuais e oEmbed.
  Sem sinal conclusivo o vídeo é descartado — pode haver falso negativo (vídeo
  horizontal legítimo ficar de fora).
- Cache/quota/rate limit do proxy são por instância serverless (o cache de CDN
  cobre repetições entre instâncias).
- O ambiente de desenvolvimento desta etapa não tem saída para
  `www.googleapis.com`, então nenhuma chamada real foi executada nem validada
  contra a chave de produção.
