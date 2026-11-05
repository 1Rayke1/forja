/*
 * Netlify Function — proxy seguro da YouTube Data API v3 (busca de vídeos).
 *
 * Por que existe:
 *   O FORJA é um site estático. Uma chave de API dentro do JavaScript público
 *   seria lida por qualquer visitante e consumiria a quota do projeto. Esta
 *   função recebe a pesquisa do navegador, chama a YouTube Data API v3 com a
 *   chave guardada SOMENTE no ambiente do backend (YOUTUBE_API_KEY) e devolve
 *   apenas o resultado já filtrado — nunca a chave, nunca a URL upstream.
 *
 * Contrato (GET):
 *   ?q=<termo>&limit=<1..12>&lang=<pt>  pesquisa de vídeos de exercícios
 *   ?id=<videoId>                       inspeção de um vídeo (link colado)
 *
 * Regras aplicadas aqui (o cliente apenas as reforça):
 *   - somente vídeos convencionais, públicos e incorporáveis;
 *   - duração entre 1 e 60 segundos;
 *   - somente orientação horizontal CONFIRMADA: Shorts/verticais e vídeos cuja
 *     orientação não pôde ser confirmada são descartados (nunca re-enquadrados
 *     com zoom/corte);
 *   - YouTube Shorts nunca são devolvidos como resultado aprovável.
 *
 * Custo de quota (YouTube Data API v3):
 *   search.list = 100 unidades, videos.list = 1 unidade, oEmbed = 0 unidades.
 *   Uma pesquisa completa custa 101 unidades; repetições saem do cache (0).
 *
 * Variáveis de ambiente (todas opcionais, exceto a primeira):
 *   YOUTUBE_API_KEY              chave restrita à YouTube Data API v3 (obrigatória)
 *   YOUTUBE_DAILY_QUOTA_UNITS    orçamento diário em unidades (padrão 3000)
 *   YOUTUBE_CACHE_TTL_SECONDS    validade do cache de respostas (padrão 600)
 *   YOUTUBE_MAX_RESULTS          máximo de resultados por pesquisa (padrão 10, teto 12)
 *   YOUTUBE_MAX_DURATION_SECONDS duração máxima aceita (padrão 60, teto 60)
 *   YOUTUBE_RELEVANCE_LANGUAGE   idioma de relevância (padrão "pt")
 *   YOUTUBE_REGION_CODE          região opcional (padrão vazio = não envia)
 *   YOUTUBE_OEMBED_CHECK         "0" desativa a confirmação extra via oEmbed (padrão ligado)
 *   FORJA_ALLOWED_ORIGINS        origens separadas por vírgula liberadas para CORS
 *
 * Limitação conhecida: cache, contadores de quota e rate limit vivem na memória
 * da instância serverless. Cada instância fria recomeça do zero; o cache de CDN
 * (Cache-Control: s-maxage) cobre as repetições entre instâncias. Para um
 * contador diário compartilhado é preciso um armazenamento externo (ex.: Netlify
 * Blobs) — configuração pendente documentada em docs/videos-youtube.md.
 */

const API_BASE = "https://www.googleapis.com/youtube/v3";
const OEMBED_URL = "https://www.youtube.com/oembed";
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const THUMBNAIL_KEYS = ["maxres", "standard", "high", "medium", "default"];
const SHORTS_MARKER_RE = /(?:#shorts?\b|(?:youtube\.com|youtu\.be)\/shorts\/)/i;

/* Proporção largura/altura para classificar uma amostra de imagem. */
const HORIZONTAL_RATIO = 1.2;
const VERTICAL_RATIO = 0.85;

const LIMITS = {
  maxDurationSeconds: 60,
  maxResults: 12,
  defaultResults: 10,
  searchCostUnits: 100,
  videosCostUnits: 1,
  defaultDailyQuotaUnits: 3000,
  defaultCacheTtlSeconds: 600,
  cacheMaxEntries: 200,
  rateLimitWindowMs: 60_000,
  rateLimitMaxRequests: 24,
  upstreamTimeoutMs: 8_000,
  oembedTimeoutMs: 3_000,
  oembedMaxProbes: 6,
  queryMaxLength: 120,
  queryMinLength: 2
};

/* ------------------------------------------------------------------ */
/* Utilidades puras (exportadas para os testes unitários)               */
/* ------------------------------------------------------------------ */

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

function toInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function readConfig(env = process.env) {
  return {
    apiKey: typeof env.YOUTUBE_API_KEY === "string" ? env.YOUTUBE_API_KEY.trim() : "",
    dailyQuotaUnits: toInt(env.YOUTUBE_DAILY_QUOTA_UNITS, LIMITS.defaultDailyQuotaUnits, 101, 1_000_000),
    cacheTtlSeconds: toInt(env.YOUTUBE_CACHE_TTL_SECONDS, LIMITS.defaultCacheTtlSeconds, 0, 86_400),
    maxResults: toInt(env.YOUTUBE_MAX_RESULTS, LIMITS.defaultResults, 1, LIMITS.maxResults),
    maxDurationSeconds: toInt(
      env.YOUTUBE_MAX_DURATION_SECONDS,
      LIMITS.maxDurationSeconds,
      1,
      LIMITS.maxDurationSeconds
    ),
    relevanceLanguage: typeof env.YOUTUBE_RELEVANCE_LANGUAGE === "string" && env.YOUTUBE_RELEVANCE_LANGUAGE.trim()
      ? env.YOUTUBE_RELEVANCE_LANGUAGE.trim().slice(0, 16)
      : "pt",
    regionCode: typeof env.YOUTUBE_REGION_CODE === "string" ? env.YOUTUBE_REGION_CODE.trim().slice(0, 8) : "",
    oembedCheck: env.YOUTUBE_OEMBED_CHECK !== "0",
    allowedOrigins: typeof env.FORJA_ALLOWED_ORIGINS === "string"
      ? env.FORJA_ALLOWED_ORIGINS.split(",").map(item => item.trim()).filter(Boolean)
      : []
  };
}

export function parseIsoDurationSeconds(iso) {
  if (typeof iso !== "string") return null;
  const match = iso.trim().match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const total =
    Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  return total > 0 ? total : null;
}

/*
 * Amostra todas as miniaturas declaradas pela API. Vídeos convencionais devolvem
 * a escada padrão do YouTube (120x90, 320x180, 480x360, 640x480, 1280x720 —
 * sempre mais largas do que altas). Shorts devolvem miniaturas verticais (9:16),
 * o sinal mais confiável disponível na YouTube Data API v3.
 */
export function thumbnailSamples(thumbnails) {
  if (!isObject(thumbnails)) return [];
  const samples = [];
  THUMBNAIL_KEYS.forEach(key => {
    const thumb = thumbnails[key];
    if (!isObject(thumb)) return;
    const width = Number(thumb.width);
    const height = Number(thumb.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    samples.push({ key, width, height, ratio: width / height });
  });
  return samples;
}

export function hasShortsMarker(...texts) {
  return texts.some(text => typeof text === "string" && SHORTS_MARKER_RE.test(text));
}

function oembedOrientation(oembed) {
  if (!isObject(oembed)) return { orientation: "unknown", ratio: null };
  const pairs = [
    [Number(oembed.thumbnail_width), Number(oembed.thumbnail_height)],
    [Number(oembed.width), Number(oembed.height)]
  ].filter(pair => Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && pair[0] > 0 && pair[1] > 0);
  if (!pairs.length) return { orientation: "unknown", ratio: null };

  const ratios = pairs.map(pair => pair[0] / pair[1]);
  if (ratios.some(ratio => ratio <= VERTICAL_RATIO)) {
    return { orientation: "vertical", ratio: Math.min(...ratios) };
  }
  if (ratios.every(ratio => ratio >= HORIZONTAL_RATIO)) {
    return { orientation: "horizontal", ratio: Math.max(...ratios) };
  }
  return { orientation: "unknown", ratio: ratios[0] };
}

/*
 * Decide a orientação de um vídeo. Retorna sempre um dos três estados e o
 * motivo. "unknown" significa "não confirmado" e, por regra de produto, um
 * vídeo não confirmado NUNCA é oferecido para seleção.
 */
export function analyzeOrientation(video, oembed = null) {
  const snippet = isObject(video && video.snippet) ? video.snippet : {};
  const tags = Array.isArray(snippet.tags) ? snippet.tags.join(" ") : "";

  if (hasShortsMarker(snippet.title, snippet.description, tags)) {
    return {
      orientation: "vertical",
      ratio: null,
      reason: "Marcador de Short (#shorts ou link /shorts/) no título, na descrição ou nas tags."
    };
  }

  const samples = thumbnailSamples(snippet.thumbnails);
  const vertical = samples.filter(sample => sample.ratio <= VERTICAL_RATIO);
  if (vertical.length) {
    return {
      orientation: "vertical",
      ratio: vertical[0].ratio,
      reason: "Miniatura vertical (" + vertical[0].width + "x" + vertical[0].height + ") devolvida pela API."
    };
  }

  const horizontal = samples.filter(sample => sample.ratio >= HORIZONTAL_RATIO);
  if (samples.length && horizontal.length === samples.length) {
    return {
      orientation: "horizontal",
      ratio: horizontal[0].ratio,
      reason: "Miniaturas horizontais (" + horizontal.map(s => s.width + "x" + s.height).join(", ") + ")."
    };
  }

  /* Miniaturas ausentes ou quadradas: tenta confirmar pelo oEmbed (custo zero). */
  const fromOembed = oembedOrientation(oembed);
  if (fromOembed.orientation !== "unknown") {
    return {
      orientation: fromOembed.orientation,
      ratio: fromOembed.ratio,
      reason: "Geometria devolvida pelo oEmbed público do YouTube."
    };
  }

  return {
    orientation: "unknown",
    ratio: null,
    reason: "Orientação não confirmada pelos dados disponíveis da API."
  };
}

function thumbnailUrlFor(videoId) {
  return "https://i.ytimg.com/vi/" + encodeURIComponent(videoId) + "/mqdefault.jpg";
}

/*
 * Converte um item de videos.list em resposta pública. Devolve `{ rejected }`
 * quando o vídeo não atende às regras e `{ item }` quando é aprovável.
 */
export function normalizeVideoItem(video, options = {}) {
  const maxDuration = options.maxDurationSeconds || LIMITS.maxDurationSeconds;
  if (!isObject(video) || typeof video.id !== "string" || !YOUTUBE_ID_RE.test(video.id)) {
    return { rejected: "invalid" };
  }

  const status = isObject(video.status) ? video.status : {};
  if (status.privacyStatus && status.privacyStatus !== "public") return { rejected: "not-public" };
  if (status.embeddable === false || status.rejectionReason || status.failureReason) {
    return { rejected: "not-embeddable" };
  }

  const contentDetails = isObject(video.contentDetails) ? video.contentDetails : {};
  const durationSeconds = parseIsoDurationSeconds(contentDetails.duration);
  if (!durationSeconds || durationSeconds < 1 || durationSeconds > maxDuration) {
    return { rejected: "duration" };
  }

  const orientation = analyzeOrientation(video, options.oembed || null);
  if (orientation.orientation !== "horizontal") {
    return { rejected: orientation.orientation === "vertical" ? "vertical" : "unconfirmed" };
  }

  const snippet = isObject(video.snippet) ? video.snippet : {};
  return {
    item: {
      videoId: video.id,
      title: String(snippet.title || "").slice(0, 160),
      channelTitle: String(snippet.channelTitle || "").slice(0, 120),
      durationSeconds,
      thumbnailUrl: thumbnailUrlFor(video.id),
      orientation: "horizontal",
      aspectRatio: "16:9",
      publishedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : null
    },
    reason: orientation.reason
  };
}

/* ------------------------------------------------------------------ */
/* Estado de execução (por instância serverless)                        */
/* ------------------------------------------------------------------ */

const state = {
  cache: new Map(),
  inflight: new Map(),
  rate: new Map(),
  quota: { day: "", units: 0, cacheHits: 0, exhausted: false }
};

export function resetRuntimeState() {
  state.cache.clear();
  state.inflight.clear();
  state.rate.clear();
  state.quota = { day: "", units: 0, cacheHits: 0, exhausted: false };
}

export function runtimeStateSnapshot() {
  return { cacheEntries: state.cache.size, quota: Object.assign({}, state.quota) };
}

function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function quotaState(now = Date.now()) {
  const day = utcDay(now);
  if (state.quota.day !== day) {
    state.quota = { day, units: 0, cacheHits: 0, exhausted: false };
  }
  return state.quota;
}

function rateLimited(identity, now = Date.now()) {
  const stamps = (state.rate.get(identity) || []).filter(stamp => now - stamp < LIMITS.rateLimitWindowMs);
  if (stamps.length >= LIMITS.rateLimitMaxRequests) {
    state.rate.set(identity, stamps);
    return true;
  }
  stamps.push(now);
  state.rate.set(identity, stamps);
  if (state.rate.size > 5000) {
    /* Evita crescimento sem limite do mapa em instâncias longevas. */
    for (const [key, values] of state.rate) {
      if (!values.length || now - values[values.length - 1] > LIMITS.rateLimitWindowMs) {
        state.rate.delete(key);
      }
    }
  }
  return false;
}

function cacheRead(key, now = Date.now()) {
  const entry = state.cache.get(key);
  if (!entry) return null;
  if (now - entry.at > entry.ttl * 1000) {
    state.cache.delete(key);
    return null;
  }
  return entry;
}

function cacheWrite(key, result, ttlSeconds, now = Date.now()) {
  if (ttlSeconds <= 0) return;
  if (state.cache.size >= LIMITS.cacheMaxEntries && !state.cache.has(key)) {
    const oldestKey = state.cache.keys().next().value;
    if (oldestKey !== undefined) state.cache.delete(oldestKey);
  }
  state.cache.set(key, { at: now, ttl: ttlSeconds, result });
}

/* ------------------------------------------------------------------ */
/* Respostas                                                            */
/* ------------------------------------------------------------------ */

function baseHeaders(config, request) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  };
  const origin = request && request.headers && typeof request.headers.get === "function"
    ? request.headers.get("origin")
    : "";
  if (origin && config.allowedOrigins.indexOf(origin) !== -1) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return headers;
}

function cacheHeaders(headers, ttlSeconds) {
  return Object.assign({}, headers, {
    /* Cache de CDN + navegador: a mesma pesquisa não volta a gastar quota. */
    "cache-control": "public, max-age=60, s-maxage=" + Math.max(0, ttlSeconds) +
      (ttlSeconds > 0 ? ", stale-while-revalidate=3600" : "")
  });
}

/*
 * Rede de segurança: mesmo que um campo upstream vazasse para o payload, a
 * chave jamais sai daqui — o texto é verificado e substituído antes do envio.
 */
function serialize(payload, apiKey) {
  const text = JSON.stringify(payload);
  if (apiKey && text.includes(apiKey)) return text.split(apiKey).join("[redigida]");
  return text;
}

function toResponse(result, apiKey) {
  const headers = Object.assign({}, result.headers);
  if (!headers["cache-control"]) headers["cache-control"] = "no-store";
  return new Response(serialize(result.payload, apiKey), { status: result.status, headers });
}

/* ------------------------------------------------------------------ */
/* Chamadas upstream                                                    */
/* ------------------------------------------------------------------ */

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" }
  });
  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

function upstreamErrorKind(status, body) {
  const reason = body && body.error && Array.isArray(body.error.errors) && body.error.errors[0]
    ? String(body.error.errors[0].reason || "")
    : "";
  if (status === 403 && /quotaExceeded|dailyLimitExceeded|userRateLimitExceeded|rateLimitExceeded/i.test(reason)) {
    return "quota";
  }
  if (status === 403) return "forbidden";
  if (status === 400) return "bad-request";
  if (status === 404) return "not-found";
  return "upstream";
}

async function listVideos(ids, config) {
  const params = new URLSearchParams({
    part: "snippet,contentDetails,status",
    maxResults: String(Math.min(50, Math.max(1, ids.length))),
    id: ids.join(","),
    key: config.apiKey
  });
  return fetchJson(API_BASE + "/videos?" + params.toString(), LIMITS.upstreamTimeoutMs);
}

async function searchVideos(query, config) {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoDuration: "short",
    safeSearch: "strict",
    maxResults: String(config.maxResults),
    relevanceLanguage: config.relevanceLanguage,
    q: query,
    key: config.apiKey
  });
  if (config.regionCode) params.set("regionCode", config.regionCode);
  return fetchJson(API_BASE + "/search?" + params.toString(), LIMITS.upstreamTimeoutMs);
}

/*
 * Confirmação adicional sem custo de quota: o oEmbed público do YouTube devolve
 * a geometria do player e da miniatura. Usado apenas quando as miniaturas da API
 * não permitem confirmar a orientação.
 */
async function probeOembed(videoId) {
  const target = "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId);
  const url = OEMBED_URL + "?format=json&url=" + encodeURIComponent(target);
  try {
    const result = await fetchJson(url, LIMITS.oembedTimeoutMs);
    return result.ok && isObject(result.body) ? result.body : null;
  } catch (error) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Metadados e respostas de erro                                        */
/* ------------------------------------------------------------------ */

function buildMeta({ config, quota, now, query, limit, returned, rejected, candidates }) {
  const meta = {
    source: "youtube-data-api-v3",
    transport: "netlify-function",
    maxDurationSeconds: config.maxDurationSeconds,
    orientationPolicy: "horizontal-confirmado",
    cached: false,
    generatedAt: new Date(now).toISOString(),
    quota: {
      unitsUsedToday: quota.units,
      dailyBudgetUnits: config.dailyQuotaUnits,
      remainingUnitsToday: Math.max(0, config.dailyQuotaUnits - quota.units),
      cacheHitsToday: quota.cacheHits
    }
  };
  if (query !== undefined && query !== null) meta.query = query;
  if (limit !== undefined && limit !== null) meta.limit = limit;
  if (returned !== undefined && returned !== null) meta.returned = returned;
  if (candidates !== undefined && candidates !== null) meta.candidates = candidates;
  if (rejected) meta.rejected = rejected;
  return meta;
}

function quotaResult(headers, config, quota, now) {
  return {
    status: 429,
    headers: Object.assign({}, headers, { "cache-control": "no-store" }),
    payload: {
      status: "quota",
      error:
        "O orçamento diário de consultas da YouTube Data API v3 foi atingido neste servidor. " +
        "Tente novamente amanhã ou cole o link de um vídeo convencional do YouTube.",
      meta: buildMeta({ config, quota, now })
    }
  };
}

function upstreamFailure(result, { config, headers, quota, now }) {
  const kind = upstreamErrorKind(result.status, result.body);
  if (kind === "quota") {
    /* Não tenta mais chamadas hoje: preserva a quota real do projeto. */
    quota.exhausted = true;
    quota.units = config.dailyQuotaUnits;
    return quotaResult(headers, config, quota, now);
  }
  const apiKey = config.apiKey;
  const message = result.body && result.body.error && typeof result.body.error.message === "string"
    ? result.body.error.message.split(apiKey).join("[redigida]")
    : "";
  console.error(
    "youtube-search upstream " + result.status + " (" + kind + ")" +
    (message ? ": " + message.slice(0, 200) : "")
  );
  return {
    status: 502,
    headers: Object.assign({}, headers, { "cache-control": "no-store" }),
    payload: {
      status: "error",
      error: "Não foi possível consultar a YouTube Data API v3 neste momento. Tente novamente em instantes."
    }
  };
}

function plainResult(status, headers, payload) {
  return { status, headers: Object.assign({}, headers), payload };
}

/* ------------------------------------------------------------------ */
/* Inspeção de um vídeo (link colado pelo usuário)                      */
/* ------------------------------------------------------------------ */

async function inspectVideo(videoId, { config, headers, now }) {
  if (!YOUTUBE_ID_RE.test(videoId)) {
    return plainResult(400, headers, { status: "error", error: "Identificador de vídeo inválido." });
  }

  const cacheKey = "i:" + videoId;
  const cached = cacheRead(cacheKey, now);
  if (cached) {
    return cachedResult(cached, {
      config,
      headers,
      now,
      ttlSeconds: Math.min(config.cacheTtlSeconds, 120)
    });
  }

  const quota = quotaState(now);
  if (quota.exhausted || quota.units + LIMITS.videosCostUnits > config.dailyQuotaUnits) {
    return quotaResult(headers, config, quota, now);
  }

  const videosRes = await listVideos([videoId], config);
  if (!videosRes.ok) return upstreamFailure(videosRes, { config, headers, quota, now });
  quota.units += LIMITS.videosCostUnits;

  const items = Array.isArray(videosRes.body && videosRes.body.items) ? videosRes.body.items : [];
  if (!items.length) {
    const result = plainResult(404, cacheHeaders(headers, 60), {
      status: "not-found",
      item: null,
      meta: buildMeta({ config, quota, now })
    });
    cacheWrite(cacheKey, result, Math.min(config.cacheTtlSeconds, 120), now);
    return result;
  }

  const video = items[0];
  let oembed = null;
  if (config.oembedCheck) {
    const tentative = normalizeVideoItem(video, { maxDurationSeconds: config.maxDurationSeconds });
    if (tentative.rejected === "unconfirmed") oembed = await probeOembed(videoId);
  }

  const normalized = normalizeVideoItem(video, {
    maxDurationSeconds: config.maxDurationSeconds,
    oembed
  });

  if (normalized.item) {
    const result = plainResult(200, cacheHeaders(headers, config.cacheTtlSeconds), {
      status: "ok",
      item: normalized.item,
      meta: buildMeta({ config, quota, now })
    });
    cacheWrite(cacheKey, result, config.cacheTtlSeconds, now);
    return result;
  }

  const result = plainResult(200, cacheHeaders(headers, 60), {
    status: normalized.rejected,
    item: null,
    meta: buildMeta({ config, quota, now })
  });
  cacheWrite(cacheKey, result, Math.min(config.cacheTtlSeconds, 120), now);
  return result;
}

/* ------------------------------------------------------------------ */
/* Pesquisa                                                             */
/* ------------------------------------------------------------------ */

function normalizeQuery(raw) {
  return raw.replace(/\s+/g, " ").trim().slice(0, LIMITS.queryMaxLength);
}

function withCachedFlag(payload, cached) {
  return Object.assign({}, payload, { meta: Object.assign({}, payload.meta, { cached }) });
}

/*
 * Resposta de cache: reutiliza o resultado anterior, marca `cached` e refresca
 * os contadores de quota (o cache também economiza unidades).
 */
function cachedResult(entry, { config, headers, now, ttlSeconds }) {
  const quota = quotaState(now);
  quota.cacheHits += 1;
  const payload = withCachedFlag(entry.result.payload, true);
  payload.meta = Object.assign({}, payload.meta, {
    cached: true,
    quota: {
      unitsUsedToday: quota.units,
      dailyBudgetUnits: config.dailyQuotaUnits,
      remainingUnitsToday: Math.max(0, config.dailyQuotaUnits - quota.units),
      cacheHitsToday: quota.cacheHits
    }
  });
  return {
    status: entry.result.status,
    headers: cacheHeaders(headers, ttlSeconds),
    payload
  };
}

async function runSearch(query, { config, headers, limit, now }) {
  const searchRes = await searchVideos(query, config);
  const quota = quotaState(now);
  if (!searchRes.ok) return upstreamFailure(searchRes, { config, headers, quota, now });
  quota.units += LIMITS.searchCostUnits;

  const cacheKey = searchCacheKey(query, limit, config.relevanceLanguage);
  const searchItems = Array.isArray(searchRes.body && searchRes.body.items) ? searchRes.body.items : [];
  const ids = [];
  searchItems.forEach(entry => {
    const id = entry && entry.id && entry.id.videoId;
    if (typeof id === "string" && YOUTUBE_ID_RE.test(id) && ids.indexOf(id) === -1) ids.push(id);
  });

  if (!ids.length) {
    const result = plainResult(200, cacheHeaders(headers, config.cacheTtlSeconds), {
      status: "ok",
      items: [],
      meta: buildMeta({ config, quota, now, query, limit, returned: 0, candidates: 0 })
    });
    cacheWrite(cacheKey, result, config.cacheTtlSeconds, now);
    return result;
  }

  const wanted = ids.slice(0, Math.max(limit, 1));
  const videosRes = await listVideos(wanted, config);
  if (!videosRes.ok) return upstreamFailure(videosRes, { config, headers, quota, now });
  quota.units += LIMITS.videosCostUnits;

  const videos = Array.isArray(videosRes.body && videosRes.body.items) ? videosRes.body.items : [];
  const rejected = {
    vertical: 0,
    duration: 0,
    unconfirmed: 0,
    "not-embeddable": 0,
    "not-public": 0,
    invalid: 0
  };
  const items = [];
  const inconclusive = [];

  videos.forEach(video => {
    const tentative = normalizeVideoItem(video, { maxDurationSeconds: config.maxDurationSeconds });
    if (tentative.item) {
      items.push(tentative.item);
      return;
    }
    rejected[tentative.rejected] = (rejected[tentative.rejected] || 0) + 1;
    if (tentative.rejected === "unconfirmed" && config.oembedCheck && inconclusive.length < LIMITS.oembedMaxProbes) {
      inconclusive.push(video);
    }
  });

  /* Segunda chance: confirmação via oEmbed (sem custo de quota). */
  if (inconclusive.length) {
    const probes = await Promise.all(inconclusive.map(video => probeOembed(String(video.id))));
    inconclusive.forEach((video, index) => {
      const retried = normalizeVideoItem(video, {
        maxDurationSeconds: config.maxDurationSeconds,
        oembed: probes[index]
      });
      if (retried.item) {
        rejected.unconfirmed = Math.max(0, rejected.unconfirmed - 1);
        items.push(retried.item);
      }
    });
  }

  /* Mantém a ordem de relevância devolvida pela pesquisa. */
  const order = new Map(wanted.map((id, index) => [id, index]));
  items.sort((a, b) => (order.has(a.videoId) ? order.get(a.videoId) : 99) - (order.has(b.videoId) ? order.get(b.videoId) : 99));

  const kept = items.slice(0, Math.max(limit, 1));
  const result = plainResult(200, cacheHeaders(headers, config.cacheTtlSeconds), {
    status: "ok",
    items: kept,
    meta: buildMeta({
      config,
      quota,
      now,
      query,
      limit,
      returned: kept.length,
      candidates: ids.length,
      rejected
    })
  });
  cacheWrite(cacheKey, result, config.cacheTtlSeconds, now);
  return result;
}

function searchCacheKey(query, limit, language) {
  return "s:" + query.toLowerCase() + ":" + limit + ":" + language;
}

async function searchVideosFlow(rawQuery, { config, headers, limit, now }) {
  const query = normalizeQuery(rawQuery);
  if (query.length < LIMITS.queryMinLength) {
    return plainResult(400, headers, { status: "error", error: "Termo de pesquisa muito curto." });
  }

  const cacheKey = searchCacheKey(query, limit, config.relevanceLanguage);
  const cached = cacheRead(cacheKey, now);
  if (cached) {
    return cachedResult(cached, { config, headers, now, ttlSeconds: config.cacheTtlSeconds });
  }

  const quota = quotaState(now);
  const needed = LIMITS.searchCostUnits + LIMITS.videosCostUnits;
  if (quota.exhausted || quota.units + needed > config.dailyQuotaUnits) {
    return quotaResult(headers, config, quota, now);
  }

  /* Pesquisas idênticas simultâneas compartilham uma única chamada upstream. */
  if (state.inflight.has(cacheKey)) return state.inflight.get(cacheKey);

  const task = runSearch(query, { config, headers, limit, now })
    .finally(() => state.inflight.delete(cacheKey));
  state.inflight.set(cacheKey, task);
  return task;
}

/* ------------------------------------------------------------------ */
/* Handler                                                              */
/* ------------------------------------------------------------------ */

export default async function handler(request, context = {}) {
  const config = readConfig();
  const method = String(request.method || "GET").toUpperCase();

  if (method !== "GET" && method !== "HEAD") {
    return toResponse(
      {
        status: 405,
        headers: Object.assign(baseHeaders(config, request), { allow: "GET, HEAD" }),
        payload: { status: "error", error: "Método não permitido. Use GET." }
      },
      config.apiKey
    );
  }

  const headers = baseHeaders(config, request);

  let url;
  try {
    url = new URL(request.url, "http://forja.local");
  } catch (error) {
    return toResponse(plainResult(400, headers, { status: "error", error: "Requisição inválida." }), config.apiKey);
  }

  const identity =
    (context && context.ip) ||
    (request.headers && typeof request.headers.get === "function"
      ? request.headers.get("x-nf-client-connection-ip") ||
        String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim()
      : "") ||
    "anonymous";

  const now = Date.now();

  if (rateLimited(identity, now)) {
    return toResponse(
      plainResult(429, headers, {
        status: "rate-limited",
        error: "Muitas pesquisas em sequência. Aguarde alguns segundos e tente novamente."
      }),
      config.apiKey
    );
  }

  if (!config.apiKey) {
    return toResponse(
      plainResult(503, headers, {
        status: "unconfigured",
        error: "A busca de vídeos não está configurada neste ambiente: defina YOUTUBE_API_KEY no backend."
      }),
      ""
    );
  }

  const requestedId = String(url.searchParams.get("id") || "").trim();
  const rawQuery = String(url.searchParams.get("q") || "").trim();
  const limit = toInt(url.searchParams.get("limit"), config.maxResults, 1, LIMITS.maxResults);

  try {
    const result = requestedId
      ? await inspectVideo(requestedId, { config, headers, now })
      : rawQuery
        ? await searchVideosFlow(rawQuery, { config, headers, limit, now })
        : plainResult(400, headers, {
            status: "error",
            error: "Informe ?q=<termo de pesquisa> ou ?id=<videoId>."
          });
    return toResponse(result, config.apiKey);
  } catch (error) {
    /* Nunca registra a URL upstream (ela contém a chave). */
    const message = String((error && error.message) || error).split(config.apiKey).join("[redigida]");
    console.error("youtube-search falhou:", message);
    return toResponse(
      plainResult(502, headers, {
        status: "error",
        error: "Falha inesperada ao consultar a YouTube Data API v3."
      }),
      config.apiKey
    );
  }
}
