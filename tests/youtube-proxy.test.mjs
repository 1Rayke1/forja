/*
  Suíte do proxy backend da YouTube Data API v3 (`netlify/functions/youtube-search.mjs`).

  Cobre, sem nenhuma chamada real de rede (o `fetch` é substituído):
  - Chave só no servidor: YOUTUBE_API_KEY vai na requisição upstream e nunca na resposta
  - Filtros: duração <= 60s, público, incorporável e orientação horizontal confirmada
  - Shorts/verticais e vídeos não confirmados nunca são devolvidos
  - Confirmação adicional via oEmbed quando as miniaturas da API não bastam
  - Cache de respostas (pesquisa repetida não gasta quota) e deduplicação
  - Orçamento diário de quota, quotaExceeded upstream, rate limit por IP
  - Erros: sem chave, termo inválido, upstream 5xx, falha de rede, sem resultados
  - Inspeção de um vídeo pelo id (link colado no modal "Procurar vídeo")
  - Cabeçalhos de cache/CORS e ausência de vazamento em logs
*/
import assert from "node:assert/strict";
import handler, {
  analyzeOrientation,
  normalizeVideoItem,
  parseIsoDurationSeconds,
  readConfig,
  resetRuntimeState,
  runtimeStateSnapshot,
  thumbnailSamples
} from "../netlify/functions/youtube-search.mjs";

const TEST_KEY = "FORJA-CHAVE-FALSA-SOMENTE-PARA-TESTES-000";
const results = [];
const logs = [];
const realFetch = globalThis.fetch;
const realError = console.error;

async function runTest(name, fn) {
  resetRuntimeState();
  logs.length = 0;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  process.env.YOUTUBE_API_KEY = TEST_KEY;
  delete process.env.YOUTUBE_DAILY_QUOTA_UNITS;
  delete process.env.YOUTUBE_CACHE_TTL_SECONDS;
  delete process.env.YOUTUBE_MAX_RESULTS;
  delete process.env.YOUTUBE_OEMBED_CHECK;
  delete process.env.FORJA_ALLOWED_ORIGINS;
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("✅ " + name);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log("❌ " + name);
    console.log(
      "   " + String(error && error.stack ? error.stack : error).split("\n").slice(0, 12).join("\n   ")
    );
  } finally {
    console.error = realError;
    globalThis.fetch = realFetch;
  }
}

/* --------------------------- utilidades --------------------------- */

function horizontalThumbs() {
  return {
    default: { width: 120, height: 90 },
    medium: { width: 320, height: 180 },
    high: { width: 480, height: 360 },
    maxres: { width: 1280, height: 720 }
  };
}

function verticalThumbs() {
  return {
    default: { width: 225, height: 400 },
    medium: { width: 225, height: 400 },
    high: { width: 360, height: 640 }
  };
}

function video(id, overrides = {}) {
  return Object.assign(
    {
      id,
      status: { embeddable: true, privacyStatus: "public" },
      contentDetails: { duration: "PT24S" },
      snippet: {
        title: "Flexão de braço — execução correta",
        channelTitle: "Canal de Treino",
        description: "Demonstração horizontal do movimento.",
        thumbnails: horizontalThumbs()
      }
    },
    overrides
  );
}

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

/* Registra cada chamada upstream e responde por padrão com fixtures. */
function mockUpstream({ search = [], videos = [], oembed = null, failSearch = null, failVideos = null, failAll = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push({ url: target, init });
    if (failAll) throw new Error(failAll);
    if (target.includes("/youtube/v3/search")) {
      if (failSearch) return json(failSearch.body || {}, failSearch.status);
      return json({ items: search });
    }
    if (target.includes("/youtube/v3/videos")) {
      if (failVideos) return json(failVideos.body || {}, failVideos.status);
      return json({ items: videos });
    }
    if (target.includes("youtube.com/oembed")) {
      return oembed ? json(oembed) : json({ error: "not found" }, 404);
    }
    return json({}, 404);
  };
  return calls;
}

function request(query, options = {}) {
  const url = "https://forja.local/api/youtube-search" + (query ? "?" + query : "");
  return new Request(url, {
    method: options.method || "GET",
    headers: options.headers || {}
  });
}

async function call(query, options = {}) {
  const response = await handler(request(query, options), { ip: options.ip || "203.0.113.7" });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (error) {
    body = null;
  }
  return { response, status: response.status, text, body };
}

/* ------------------------------ testes ------------------------------ */

await runTest("P1. Regras puras: duração ISO, miniaturas e análise de orientação", async () => {
  assert.equal(parseIsoDurationSeconds("PT42S"), 42);
  assert.equal(parseIsoDurationSeconds("PT1M"), 60);
  assert.equal(parseIsoDurationSeconds("PT1M1S"), 61);
  assert.equal(parseIsoDurationSeconds("PT0S"), null);
  assert.equal(parseIsoDurationSeconds("garbage"), null);

  assert.equal(thumbnailSamples(horizontalThumbs()).length, 4);
  assert.equal(thumbnailSamples(null).length, 0);
  assert.equal(thumbnailSamples({ high: { width: 0, height: 0 } }).length, 0);

  assert.equal(analyzeOrientation(video("HorizVid001")).orientation, "horizontal");
  assert.equal(
    analyzeOrientation(video("ShortVert01", { snippet: { thumbnails: verticalThumbs() } })).orientation,
    "vertical",
    "miniatura vertical precisa ser identificada"
  );
  assert.equal(
    analyzeOrientation(
      video("ShortTag0001", {
        snippet: { title: "Dica rápida #shorts", thumbnails: horizontalThumbs() }
      })
    ).orientation,
    "vertical",
    "marcador #shorts precisa ser identificado mesmo com miniatura horizontal"
  );
  assert.equal(
    analyzeOrientation(video("SquareThmb1", { snippet: { thumbnails: { high: { width: 480, height: 480 } } } })).orientation,
    "unknown",
    "sem confirmação a orientação é unknown"
  );
  assert.equal(
    analyzeOrientation(
      video("SquareThmb1", { snippet: { thumbnails: { high: { width: 480, height: 480 } } } }),
      { thumbnail_width: 480, thumbnail_height: 360, width: 480, height: 270 }
    ).orientation,
    "horizontal",
    "oEmbed confirma a orientação quando a API não confirma"
  );
  assert.equal(
    analyzeOrientation(video("NoThumbs0001", { snippet: {} }), { width: 200, height: 356 }).orientation,
    "vertical"
  );

  assert.equal(normalizeVideoItem(video("HorizVid001")).item.videoId, "HorizVid001");
  assert.equal(normalizeVideoItem(video("TooLongVid1", { contentDetails: { duration: "PT2M15S" } })).rejected, "duration");
  assert.equal(normalizeVideoItem(video("PrivateVid1", { status: { privacyStatus: "private", embeddable: true } })).rejected, "not-public");
  assert.equal(normalizeVideoItem(video("NoEmbedVid1", { status: { privacyStatus: "public", embeddable: false } })).rejected, "not-embeddable");
  assert.equal(normalizeVideoItem(video("ShortVert01", { snippet: { thumbnails: verticalThumbs() } })).rejected, "vertical");
  assert.equal(normalizeVideoItem({ id: "invalid" }).rejected, "invalid");
});

await runTest("P2. Método e parâmetros: 405 em POST e 400 sem q/id", async () => {
  mockUpstream();
  const post = await call("q=flexao", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.body.status, "error");
  assert.equal(post.response.headers.get("allow"), "GET, HEAD");

  const noParams = await call("");
  assert.equal(noParams.status, 400);
  assert.equal(noParams.body.status, "error");

  const shortQuery = await call("q=a");
  assert.equal(shortQuery.status, 400);

  const badId = await call("id=curto");
  assert.equal(badId.status, 400);
});

await runTest("P3. Sem YOUTUBE_API_KEY: 503 unconfigured, zero chamadas upstream", async () => {
  const calls = mockUpstream({ search: [{ id: { videoId: "HorizVid001" } }] });
  delete process.env.YOUTUBE_API_KEY;

  const result = await call("q=flexao");
  assert.equal(result.status, 503);
  assert.equal(result.body.status, "unconfigured");
  assert.match(result.body.error, /YOUTUBE_API_KEY/);
  assert.equal(calls.length, 0, "não pode chamar o YouTube sem chave");
  assert.equal(result.response.headers.get("cache-control"), "no-store");
});

await runTest("P4. Pesquisa: filtros de duração, incorporação e orientação horizontal confirmada", async () => {
  const calls = mockUpstream({
    search: [
      { id: { videoId: "HorizVid001" } },
      { id: { videoId: "ShortVert01" } },
      { id: { videoId: "TooLongVid1" } },
      { id: { videoId: "NoEmbedVid1" } },
      { id: { videoId: "UnknownVid1" } }
    ],
    videos: [
      video("HorizVid001"),
      video("ShortVert01", {
        contentDetails: { duration: "PT18S" },
        snippet: { title: "Dica rápida #shorts", thumbnails: verticalThumbs() }
      }),
      video("TooLongVid1", { contentDetails: { duration: "PT1M35S" } }),
      video("NoEmbedVid1", { status: { privacyStatus: "public", embeddable: false } }),
      video("UnknownVid1", { snippet: { title: "Sem geometria", thumbnails: { high: { width: 400, height: 400 } } } })
    ]
  });

  const result = await call("q=flex%C3%A3o%20de%20bra%C3%A7o&limit=10");
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "ok");
  assert.deepEqual(result.body.items.map(item => item.videoId), ["HorizVid001"],
    "apenas vídeos horizontais confirmados e de até 60s podem ser devolvidos");

  const item = result.body.items[0];
  assert.equal(item.orientation, "horizontal");
  assert.equal(item.aspectRatio, "16:9");
  assert.equal(item.durationSeconds, 24);
  assert.equal(item.channelTitle, "Canal de Treino");
  assert.equal(item.thumbnailUrl, "https://i.ytimg.com/vi/HorizVid001/mqdefault.jpg");

  assert.equal(result.body.meta.rejected.vertical, 1);
  assert.equal(result.body.meta.rejected.duration, 1);
  assert.equal(result.body.meta.rejected["not-embeddable"], 1);
  assert.equal(result.body.meta.candidates, 5);
  assert.equal(result.body.meta.returned, 1);
  assert.equal(result.body.meta.source, "youtube-data-api-v3");

  /* Custos: search.list (100) + videos.list (1); oEmbed confirma sem gastar quota. */
  assert.equal(calls.filter(entry => entry.url.includes("/youtube/v3/search")).length, 1);
  assert.equal(calls.filter(entry => entry.url.includes("/youtube/v3/videos")).length, 1);
  assert.match(calls[0].url, /\/youtube\/v3\/search\?/);
  assert.match(calls[0].url, /videoDuration=short/);
  assert.match(calls[0].url, /videoEmbeddable=true/);
  assert.match(calls[0].url, /safeSearch=strict/);
  assert.match(calls[0].url, /relevanceLanguage=pt/);
  assert.match(calls[1].url, /\/youtube\/v3\/videos\?/);
  assert.equal(result.body.meta.quota.unitsUsedToday, 101);

  const oembedCalls = calls.filter(entry => entry.url.includes("youtube.com/oembed"));
  assert.equal(oembedCalls.length, 1, "vídeo não confirmado pelas miniaturas deve passar pelo oEmbed");
  assert.equal(oembedCalls[0].url.includes("key="), false, "oEmbed não usa chave de API");
  assert.equal(result.body.meta.rejected.unconfirmed, 1, "sem confirmação o vídeo é recusado");
});

await runTest("P5. A chave existe só no servidor: vai ao upstream e nunca aparece na resposta ou nos logs", async () => {
  const calls = mockUpstream({
    search: [{ id: { videoId: "HorizVid001" } }],
    videos: [video("HorizVid001")]
  });

  const result = await call("q=flexao");
  assert.equal(result.status, 200);
  assert.equal(calls[0].url.includes("key=" + encodeURIComponent(TEST_KEY)), true,
    "a chave precisa ser enviada pelo backend");
  assert.equal(result.text.includes(TEST_KEY), false, "a chave não pode aparecer no corpo da resposta");
  assert.equal(result.text.includes("[redigida]"), false);
  for (const header of result.response.headers) {
    assert.equal(String(header[1]).includes(TEST_KEY), false, "chave em cabeçalho: " + header[0]);
  }
  assert.equal(logs.join("\n").includes(TEST_KEY), false, "chave não pode ir para os logs");
  assert.equal(JSON.stringify(result.body.meta).includes("googleapis.com"), false,
    "meta não pode expor a URL upstream (que contém a chave)");
});

await runTest("P6. Cache: pesquisa repetida não chama o YouTube de novo e chega marcada como cached", async () => {
  const calls = mockUpstream({
    search: [{ id: { videoId: "HorizVid001" } }],
    videos: [video("HorizVid001")]
  });

  const first = await call("q=flexao");
  assert.equal(first.body.meta.cached, false);
  assert.equal(calls.length, 2);
  assert.match(first.response.headers.get("cache-control"), /s-maxage=600/);

  const second = await call("q=flexao");
  assert.equal(calls.length, 2, "consulta repetida não pode gastar quota");
  assert.equal(second.body.meta.cached, true);
  assert.deepEqual(second.body.items, first.body.items);
  assert.equal(second.body.meta.quota.unitsUsedToday, 101);
  assert.equal(second.body.meta.quota.cacheHitsToday, 1);

  /* Normalização de espaços/maiúsculas cai no mesmo cache. */
  const third = await call("q=Flexao");
  assert.equal(calls.length, 2);
  assert.equal(third.body.meta.cached, true);

  /* Termo diferente consulta de novo. */
  const fourth = await call("q=agachamento");
  assert.equal(calls.length, 4);
  assert.equal(fourth.body.meta.cached, false);
  assert.equal(runtimeStateSnapshot().cacheEntries, 2);
});

await runTest("P7. Deduplicação: pesquisas idênticas simultâneas geram uma única chamada", async () => {
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    await gate;
    if (String(url).includes("/search")) return json({ items: [{ id: { videoId: "HorizVid001" } }] });
    return json({ items: [video("HorizVid001")] });
  };

  const pendingA = call("q=flexao");
  const pendingB = call("q=flexao");
  release();
  const [a, b] = await Promise.all([pendingA, pendingB]);

  /* As duas requisições compartilharam a mesma tarefa em andamento. */
  assert.equal(calls.filter(url => url.includes("/search")).length, 1,
    "duas pesquisas iguais simultâneas devem compartilhar a chamada upstream");
  assert.deepEqual(a.body.items.map(item => item.videoId), ["HorizVid001"]);
  assert.deepEqual(b.body.items.map(item => item.videoId), ["HorizVid001"]);
});

await runTest("P8. Orçamento diário de quota: bloqueia antes de chamar o YouTube", async () => {
  process.env.YOUTUBE_DAILY_QUOTA_UNITS = "101";
  const calls = mockUpstream({
    search: [{ id: { videoId: "HorizVid001" } }],
    videos: [video("HorizVid001")]
  });

  const first = await call("q=flexao");
  assert.equal(first.status, 200);
  assert.equal(first.body.meta.quota.unitsUsedToday, 101);
  assert.equal(first.body.meta.quota.remainingUnitsToday, 0);

  const second = await call("q=agachamento");
  assert.equal(second.status, 429);
  assert.equal(second.body.status, "quota");
  assert.match(second.body.error, /orçamento diário/i);
  assert.equal(calls.length, 2, "nenhuma chamada extra pode ser feita sem orçamento");
});

await runTest("P9. quotaExceeded upstream vira 429 e encerra as consultas do dia", async () => {
  const calls = mockUpstream({
    failSearch: {
      status: 403,
      body: { error: { message: "Daily Limit Exceeded", errors: [{ reason: "quotaExceeded" }] } }
    }
  });

  const first = await call("q=flexao");
  assert.equal(first.status, 429);
  assert.equal(first.body.status, "quota");
  assert.equal(first.text.includes("Daily Limit Exceeded"), false, "detalhe upstream não vaza");
  assert.equal(calls.length, 1);

  const second = await call("q=agachamento");
  assert.equal(second.status, 429);
  assert.equal(calls.length, 1, "após quotaExceeded o backend não tenta mais o YouTube");
});

await runTest("P10. Falhas upstream e de rede devolvem 502 genérico, sem vazar detalhes", async () => {
  mockUpstream({
    failSearch: { status: 500, body: { error: { message: "Internal error with key " + TEST_KEY } } }
  });
  const serverError = await call("q=flexao");
  assert.equal(serverError.status, 502);
  assert.equal(serverError.body.status, "error");
  assert.equal(serverError.text.includes(TEST_KEY), false, "mensagem upstream com chave precisa ser redigida");
  assert.match(logs.join("\n"), /youtube-search upstream 500/);
  assert.equal(logs.join("\n").includes(TEST_KEY), false, "log não pode conter a chave");

  resetRuntimeState();
  mockUpstream({ failAll: "socket hang up" });
  const networkError = await call("q=flexao");
  assert.equal(networkError.status, 502);
  assert.equal(networkError.body.status, "error");
});

await runTest("P11. Pesquisa sem resultados devolve 200 com lista vazia", async () => {
  mockUpstream({ search: [], videos: [] });
  const result = await call("q=exercicio+inexistente");
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "ok");
  assert.deepEqual(result.body.items, []);
  assert.equal(result.body.meta.returned, 0);
  assert.equal(result.body.meta.candidates, 0);
});

await runTest("P12. Inspeção por id: horizontal aprovado, Short recusado, longo recusado, inexistente 404", async () => {
  const calls = mockUpstream({
    videos: [video("HorizVid001")],
    oembed: null
  });

  const ok = await call("id=HorizVid001");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "ok");
  assert.equal(ok.body.item.videoId, "HorizVid001");
  assert.equal(ok.body.item.orientation, "horizontal");
  assert.equal(calls.length, 1);

  /* Repetição do mesmo id sai do cache. */
  const cached = await call("id=HorizVid001");
  assert.equal(cached.body.meta.cached, true);
  assert.equal(calls.length, 1);

  resetRuntimeState();
  mockUpstream({
    videos: [video("ShortVert01", { contentDetails: { duration: "PT15S" }, snippet: { thumbnails: verticalThumbs() } })]
  });
  const short = await call("id=ShortVert01");
  assert.equal(short.status, 200);
  assert.equal(short.body.status, "vertical");
  assert.equal(short.body.item, null);

  resetRuntimeState();
  mockUpstream({ videos: [video("TooLongVid1", { contentDetails: { duration: "PT3M" } })] });
  const long = await call("id=TooLongVid1");
  assert.equal(long.body.status, "duration");

  resetRuntimeState();
  mockUpstream({ videos: [] });
  const missing = await call("id=GoneVideoV1");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.status, "not-found");
});

await runTest("P13. oEmbed confirma orientação quando as miniaturas da API não confirmam", async () => {
  const calls = mockUpstream({
    search: [{ id: { videoId: "SquareThmb1" } }],
    videos: [video("SquareThmb1", { snippet: { thumbnails: { high: { width: 480, height: 480 } } } })],
    oembed: { width: 480, height: 270, thumbnail_width: 480, thumbnail_height: 360, title: "Flexão" }
  });

  const confirmed = await call("q=flexao");
  assert.deepEqual(confirmed.body.items.map(item => item.videoId), ["SquareThmb1"]);
  assert.equal(confirmed.body.meta.rejected.unconfirmed, 0);
  assert.equal(calls.some(entry => entry.url.includes("youtube.com/oembed")), true);
  assert.equal(calls.some(entry => entry.url.includes("oembed") && entry.url.includes("key=")), false,
    "oEmbed não usa chave de API");

  /* Com a verificação desativada, o vídeo não confirmado é recusado. */
  resetRuntimeState();
  process.env.YOUTUBE_OEMBED_CHECK = "0";
  mockUpstream({
    search: [{ id: { videoId: "SquareThmb1" } }],
    videos: [video("SquareThmb1", { snippet: { thumbnails: { high: { width: 480, height: 480 } } } })]
  });
  const refused = await call("q=flexao");
  assert.deepEqual(refused.body.items, []);
  assert.equal(refused.body.meta.rejected.unconfirmed, 1);
});

await runTest("P14. Rate limit por IP e CORS restrito a origens allowlist", async () => {
  mockUpstream({ search: [], videos: [] });
  process.env.YOUTUBE_DAILY_QUOTA_UNITS = "1000000";

  let blocked = 0;
  for (let index = 0; index < 30; index++) {
    const result = await call("q=busca-" + index, { ip: "203.0.113.9" });
    if (result.status === 429 && result.body.status === "rate-limited") blocked += 1;
  }
  assert.ok(blocked > 0, "excesso de requisições do mesmo IP precisa ser limitado");

  resetRuntimeState();
  const withoutOrigin = await call("q=flexao", { headers: { origin: "https://malicioso.example" } });
  assert.equal(withoutOrigin.response.headers.get("access-control-allow-origin"), null);

  resetRuntimeState();
  process.env.FORJA_ALLOWED_ORIGINS = "https://1rayke1.github.io";
  const allowed = await call("q=flexao", { headers: { origin: "https://1rayke1.github.io" } });
  assert.equal(allowed.response.headers.get("access-control-allow-origin"), "https://1rayke1.github.io");
  const denied = await call("q=agachamento", { headers: { origin: "https://outro.example" } });
  assert.equal(denied.response.headers.get("access-control-allow-origin"), null);
});

await runTest("P15. Configuração por ambiente com limites seguros", async () => {
  const defaults = readConfig({ YOUTUBE_API_KEY: "  " + TEST_KEY + " " });
  assert.equal(defaults.apiKey, TEST_KEY);
  assert.equal(defaults.maxDurationSeconds, 60);
  assert.equal(defaults.maxResults, 10);
  assert.equal(defaults.dailyQuotaUnits, 3000);
  assert.equal(defaults.cacheTtlSeconds, 600);
  assert.equal(defaults.oembedCheck, true);

  const tuned = readConfig({
    YOUTUBE_API_KEY: TEST_KEY,
    YOUTUBE_MAX_DURATION_SECONDS: "900",
    YOUTUBE_MAX_RESULTS: "50",
    YOUTUBE_DAILY_QUOTA_UNITS: "abc",
    YOUTUBE_OEMBED_CHECK: "0"
  });
  assert.equal(tuned.maxDurationSeconds, 60, "duração nunca passa de 60s");
  assert.equal(tuned.maxResults, 12, "máximo de resultados limitado");
  assert.equal(tuned.dailyQuotaUnits, 3000, "valor inválido volta ao padrão");
  assert.equal(tuned.oembedCheck, false);

  const noKey = readConfig({});
  assert.equal(noKey.apiKey, "");
});

await runTest("P16. Ordem de relevância preservada entre os vídeos aprovados", async () => {
  mockUpstream({
    search: [
      { id: { videoId: "SegundoVid1" } },
      { id: { videoId: "ShortVert01" } },
      { id: { videoId: "PrimeiroVd1" } }
    ],
    videos: [
      video("SegundoVid1", { snippet: { title: "Segundo", thumbnails: horizontalThumbs() } }),
      video("ShortVert01", { snippet: { title: "#shorts", thumbnails: verticalThumbs() } }),
      video("PrimeiroVd1", { snippet: { title: "Primeiro", thumbnails: horizontalThumbs() } })
    ]
  });

  const result = await call("q=flexao");
  assert.deepEqual(result.body.items.map(item => item.videoId), ["SegundoVid1", "PrimeiroVd1"],
    "a ordem devolvida pela pesquisa do YouTube deve ser mantida");
});

const failed = results.filter(result => !result.ok);
console.log("\n" + "=".repeat(66));
console.log("PROXY YOUTUBE DATA API v3 — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
if (failed.length > 0) {
  console.log("Falhas: " + failed.map(item => item.name).join(" | "));
}
console.log("=".repeat(66));
process.exitCode = failed.length > 0 ? 1 : 0;
