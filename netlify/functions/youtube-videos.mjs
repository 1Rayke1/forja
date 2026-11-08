/*
 * YouTube Data API v3 + administração editorial de vídeos.
 * Segredos somente no backend: YOUTUBE_API_KEY e FORJA_ADMIN_CREDENTIAL.
 * Persistência durável: Netlify Blobs, uma entrada por exerciseId.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import catalog from "../../assets/js/forja-exercicios-dados.js";

const EXERCISES = new Map(catalog.exercises.map(record => [record.id, record]));
const STATUSES = new Set(["review", "validated", "rejected", "unavailable"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_BODY = 24_000;
const SEARCH_RESULTS = 8;
const SEARCH_CACHE_MS = 12 * 60 * 60 * 1000;
const attempts = new Map();

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function parseDuration(value) {
  if (typeof value !== "string") return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match || value === "P" || value === "PT") return null;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  const total = Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

function cleanText(value, max) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

function videoDetails(item) {
  if (!item || typeof item.id !== "string" || !VIDEO_ID.test(item.id)) return null;
  const snippet = item.snippet || {};
  const status = item.status || {};
  const details = item.contentDetails || {};
  const durationSeconds = parseDuration(details.duration);
  const visibility = cleanText(status.privacyStatus, 20);
  const embeddable = status.embeddable === true;
  const rejectionReasons = [];
  if (visibility !== "public") rejectionReasons.push("Vídeo privado ou não público.");
  if (!embeddable) rejectionReasons.push("Incorporação não permitida.");
  if (durationSeconds === null) rejectionReasons.push("Duração insuficiente ou inválida.");
  else if (durationSeconds > 60) rejectionReasons.push("Duração superior a 60 segundos.");
  if (item.snippet?.liveBroadcastContent && item.snippet.liveBroadcastContent !== "none") rejectionReasons.push("Transmissão ao vivo ou estreia indisponível como demonstração.");
  if (!cleanText(snippet.title, 300) || !cleanText(snippet.channelTitle, 200) || !details.duration || !status.privacyStatus || typeof status.embeddable !== "boolean") {
    rejectionReasons.push("Dados insuficientes para validar o vídeo.");
  }
  return {
    videoId: item.id,
    youtubeUrl: "https://www.youtube.com/watch?v=" + item.id,
    title: cleanText(snippet.title, 300),
    channelTitle: cleanText(snippet.channelTitle, 200),
    durationSeconds,
    visibility,
    embeddable,
    thumbnailUrl: "https://i.ytimg.com/vi/" + item.id + "/hqdefault.jpg",
    eligible: rejectionReasons.length === 0,
    rejectionReasons
  };
}

export function buildReport(associations) {
  const byExercise = new Map(associations.map(item => [item.exerciseId, item]));
  const counts = { pending: 0, review: 0, validated: 0, rejected: 0, unavailable: 0 };
  const withoutVideo = [];
  const inconsistencies = [];
  for (const exerciseId of EXERCISES.keys()) {
    const association = byExercise.get(exerciseId);
    if (!association) { counts.pending += 1; withoutVideo.push(exerciseId); continue; }
    if (!STATUSES.has(association.status)) {
      counts.pending += 1; withoutVideo.push(exerciseId);
      inconsistencies.push({ exerciseId, reason: "Estado desconhecido." });
      continue;
    }
    if (association.status === "validated" && !validAssociation(association)) {
      counts.pending += 1;
      withoutVideo.push(exerciseId);
      inconsistencies.push({ exerciseId, reason: "Aprovação sem metadados ou revisão horizontal 16:9 completa." });
      continue;
    }
    counts[association.status] += 1;
    if (association.status !== "validated") withoutVideo.push(exerciseId);
    if (association.videoId && !VIDEO_ID.test(association.videoId)) inconsistencies.push({ exerciseId, reason: "videoId inválido." });
  }
  for (const association of associations) {
    if (!EXERCISES.has(association.exerciseId)) inconsistencies.push({ exerciseId: association.exerciseId || null, reason: "exerciseId fora do catálogo." });
  }
  return {
    total: EXERCISES.size,
    approved: counts.validated,
    pending: counts.pending,
    review: counts.review,
    rejected: counts.rejected,
    unavailable: counts.unavailable,
    coveragePercent: Number((counts.validated / EXERCISES.size * 100).toFixed(2)),
    withoutVideo,
    inconsistencies
  };
}

function validAssociation(value) {
  return value && EXERCISES.has(value.exerciseId) && VIDEO_ID.test(value.videoId || "") &&
    value.status === "validated" && value.youtubeUrl === "https://www.youtube.com/watch?v=" + value.videoId &&
    value.durationSeconds >= 1 && value.durationSeconds <= 60 && value.visibility === "public" &&
    value.embeddable === true && value.orientation === "horizontal" && value.aspectRatio === "16:9" &&
    typeof value.reviewedAt === "string" && Number.isFinite(Date.parse(value.reviewedAt)) &&
    typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt)) &&
    value.manualReview && ["matchesExercise", "compatibleEquipment", "visibleExecution", "horizontal", "aspectRatio16x9", "notShorts"]
      .every(key => value.manualReview[key] === true);
}

async function listAssociations(store) {
  const associations = [];
  /* Netlify Blobs: paginate:true retorna AsyncIterable<ListResult>. */
  for await (const page of store.list({ prefix: "associations/", paginate: true })) {
    for (const blob of page.blobs || []) {
      const value = await store.get(blob.key, { type: "json" });
      if (value) associations.push(value);
    }
  }
  return associations;
}

function safeEqual(received, expected) {
  const a = createHash("sha256").update(String(received)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function tooManyFailures(identity) {
  const now = Date.now();
  const recent = (attempts.get(identity) || []).filter(time => now - time < 15 * 60_000);
  attempts.set(identity, recent);
  return recent.length >= 5;
}

function recordFailure(identity) {
  const recent = attempts.get(identity) || [];
  recent.push(Date.now()); attempts.set(identity, recent);
}

function requireAdmin(request, context, env) {
  if (!env.FORJA_ADMIN_CREDENTIAL) throw new HttpError(503, "FORJA_ADMIN_CREDENTIAL não configurada no backend.");
  const identity = context.ip || request.headers.get("x-nf-client-connection-ip") || "admin";
  if (tooManyFailures(identity)) throw new HttpError(429, "Muitas tentativas administrativas. Aguarde 15 minutos.");
  const header = request.headers.get("authorization") || "";
  const credential = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!credential || credential.length > 512 || !safeEqual(credential, env.FORJA_ADMIN_CREDENTIAL)) {
    recordFailure(identity);
    throw new HttpError(401, "Credencial administrativa inválida.");
  }
  attempts.delete(identity);
}

async function youtubeFetch(fetchImpl, path, params, env) {
  if (!env.YOUTUBE_API_KEY) throw new HttpError(503, "YOUTUBE_API_KEY não configurada no backend.");
  const query = new URLSearchParams({ ...params, key: env.YOUTUBE_API_KEY });
  let upstream;
  try {
    upstream = await fetchImpl("https://www.googleapis.com/youtube/v3/" + path + "?" + query, {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000)
    });
  } catch (_) {
    throw new HttpError(502, "Não foi possível comunicar com o YouTube.");
  }
  if (upstream.status === 429 || upstream.status === 403) throw new HttpError(429, "O YouTube recusou a consulta ou a cota foi atingida. Tente mais tarde.");
  if (!upstream.ok) throw new HttpError(502, "O YouTube não está disponível no momento.");
  try { return await upstream.json(); }
  catch (_) { throw new HttpError(502, "Resposta inválida do YouTube."); }
}

async function fetchVideos(fetchImpl, ids, env) {
  if (!ids.length) return [];
  const data = await youtubeFetch(fetchImpl, "videos", {
    part: "snippet,contentDetails,status", id: ids.slice(0, 20).join(","), maxResults: "20"
  }, env);
  return (Array.isArray(data.items) ? data.items : []).map(videoDetails).filter(Boolean);
}

async function searchVideos(store, fetchImpl, input, env, now) {
  const exercise = EXERCISES.get(input.exerciseId);
  if (!exercise) throw new HttpError(400, "exerciseId fora do catálogo.");
  const query = cleanText(input.query, 180);
  if (query.length < 2) throw new HttpError(400, "Informe uma pesquisa com pelo menos 2 caracteres.");
  const normalized = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const cacheKey = "search-cache/" + createHash("sha256").update(normalized).digest("hex") + ".json";
  const cached = await store.get(cacheKey, { type: "json" });
  if (cached && now() - Date.parse(cached.cachedAt) < SEARCH_CACHE_MS) return { query, cached: true, items: cached.items };

  const day = now().toISOString().slice(0, 10);
  const quotaKey = "meta/search-quota-" + day + ".json";
  const quota = await store.get(quotaKey, { type: "json" }) || { count: 0 };
  const dailyLimit = Math.max(1, Math.min(80, Number(env.YOUTUBE_DAILY_SEARCH_LIMIT) || 80));
  if (quota.count >= dailyLimit) throw new HttpError(429, "Limite diário de pesquisas do FORJA atingido.");

  const data = await youtubeFetch(fetchImpl, "search", {
    part: "snippet", type: "video", maxResults: String(SEARCH_RESULTS), q: query,
    safeSearch: "strict", relevanceLanguage: "pt"
  }, env);
  const ids = (Array.isArray(data.items) ? data.items : []).map(item => item?.id?.videoId).filter(id => VIDEO_ID.test(id || ""));
  const items = await fetchVideos(fetchImpl, [...new Set(ids)], env);
  await store.setJSON(quotaKey, { count: quota.count + 1, updatedAt: now().toISOString() });
  await store.setJSON(cacheKey, { cachedAt: now().toISOString(), items });
  return { query, cached: false, items };
}

function manualConfirmation(input) {
  const review = input.review || {};
  return {
    matchesExercise: review.matchesExercise === true,
    compatibleEquipment: review.compatibleEquipment === true,
    visibleExecution: review.visibleExecution === true,
    horizontal: review.horizontal === true,
    aspectRatio16x9: review.aspectRatio16x9 === true,
    notShorts: review.notShorts === true
  };
}

async function saveAssociation(store, fetchImpl, input, env, now) {
  if (!EXERCISES.has(input.exerciseId)) throw new HttpError(400, "exerciseId fora do catálogo.");
  if (!VIDEO_ID.test(input.videoId || "")) throw new HttpError(400, "videoId inválido.");
  if (!STATUSES.has(input.status)) throw new HttpError(400, "Estado de revisão inválido.");
  const video = (await fetchVideos(fetchImpl, [input.videoId], env)).find(item => item.videoId === input.videoId);
  if (!video) throw new HttpError(422, "Vídeo privado, removido ou indisponível.");
  if (["review", "validated"].includes(input.status) && !video.eligible) {
    throw new HttpError(422, "Vídeo reprovado nos critérios técnicos: " + video.rejectionReasons.join(" "));
  }
  const manualReview = manualConfirmation(input);
  if (input.status === "validated" && !Object.values(manualReview).every(Boolean)) {
    throw new HttpError(422, "A aprovação exige revisão visual completa, formato horizontal 16:9 e confirmação de que não é Short.");
  }
  const timestamp = now().toISOString();
  const previous = await store.get("associations/" + input.exerciseId + ".json", { type: "json" });
  const association = {
    exerciseId: input.exerciseId,
    videoId: video.videoId,
    youtubeUrl: video.youtubeUrl,
    title: video.title,
    channelTitle: video.channelTitle,
    durationSeconds: video.durationSeconds,
    visibility: video.visibility,
    embeddable: video.embeddable,
    orientation: input.status === "validated" ? "horizontal" : null,
    aspectRatio: input.status === "validated" ? "16:9" : null,
    status: input.status,
    reviewedAt: ["validated", "rejected", "unavailable"].includes(input.status) ? timestamp : null,
    updatedAt: timestamp,
    createdAt: previous?.createdAt || timestamp,
    manualReview
  };
  await store.setJSON("associations/" + input.exerciseId + ".json", association);
  return association;
}

async function refreshAssociation(store, fetchImpl, input, env, now) {
  const key = "associations/" + input.exerciseId + ".json";
  const previous = await store.get(key, { type: "json" });
  if (!previous || !EXERCISES.has(input.exerciseId)) throw new HttpError(404, "Associação não encontrada.");
  const current = (await fetchVideos(fetchImpl, [previous.videoId], env)).find(item => item.videoId === previous.videoId);
  if (current?.eligible) return previous;
  const updated = { ...previous, status: "unavailable", reviewedAt: now().toISOString(), updatedAt: now().toISOString() };
  await store.setJSON(key, updated);
  return updated;
}

export function createHandler(options = {}) {
  const env = options.env || process.env;
  const store = options.store || getStore({ name: "forja-exercise-videos", consistency: "strong" });
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || (() => new Date());

  return async function handler(request, context = {}) {
    const origin = request.headers.get("origin") || "";
    const allowedOrigins = new Set([
      "https://1rayke1.github.io", "https://prismatic-parfait-be3644.netlify.app",
      "http://localhost:8888", "http://127.0.0.1:8888"
    ]);
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      vary: "Origin"
    };
    if (origin && allowedOrigins.has(origin)) headers["access-control-allow-origin"] = origin;
    const respond = (status, payload) => new Response(JSON.stringify(payload), { status, headers });
    try {
      if (origin && !allowedOrigins.has(origin)) throw new HttpError(403, "Origem não permitida.");
      if (request.method === "OPTIONS") {
        headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
        headers["access-control-allow-headers"] = "authorization, content-type";
        headers["access-control-max-age"] = "600";
        return new Response(null, { status: 204, headers });
      }
      if (request.method === "GET") {
        const associations = await listAssociations(store);
        const approved = associations.filter(validAssociation);
        headers["cache-control"] = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
        return respond(200, { associations: approved, report: buildReport(associations) });
      }
      if (request.method !== "POST") throw new HttpError(405, "Método não permitido.");
      requireAdmin(request, context, env);
      const raw = await request.text();
      if (raw.length > MAX_BODY) throw new HttpError(413, "Requisição muito grande.");
      let input;
      try { input = JSON.parse(raw); } catch (_) { throw new HttpError(400, "JSON inválido."); }
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Requisição inválida.");
      const action = input.action;
      if (action === "dashboard") {
        const associations = await listAssociations(store);
        return respond(200, { associations, report: buildReport(associations) });
      }
      if (action === "search") return respond(200, await searchVideos(store, fetchImpl, input, env, now));
      if (action === "save") return respond(200, { association: await saveAssociation(store, fetchImpl, input, env, now) });
      if (action === "refresh") return respond(200, { association: await refreshAssociation(store, fetchImpl, input, env, now) });
      if (action === "remove") {
        if (!EXERCISES.has(input.exerciseId)) throw new HttpError(400, "exerciseId fora do catálogo.");
        await store.delete("associations/" + input.exerciseId + ".json");
        return respond(200, { removed: true });
      }
      throw new HttpError(400, "Ação administrativa desconhecida.");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      return respond(status, { error: status === 500 ? "Falha interna no serviço de vídeos." : error.message });
    }
  };
}

let defaultHandler;
export default async function handler(request, context) {
  if (!defaultHandler) defaultHandler = createHandler();
  return defaultHandler(request, context);
}
