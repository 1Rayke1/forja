import assert from "node:assert/strict";
import fs from "node:fs";
import { createHandler, parseDuration, buildReport } from "../netlify/functions/youtube-videos.mjs";

class MemoryStore {
  constructor() { this.data = new Map(); }
  async get(key) { return structuredClone(this.data.get(key) ?? null); }
  async setJSON(key, value) { this.data.set(key, structuredClone(value)); }
  async delete(key) { this.data.delete(key); }
  list({ prefix = "", paginate = false } = {}) {
    const result = { blobs: [...this.data.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), directories: [] };
    if (!paginate) return Promise.resolve(result);
    return (async function* () { yield result; })();
  }
}

const ENV = { YOUTUBE_API_KEY: "test-secret-key-never-publish", FORJA_ADMIN_CREDENTIAL: "test-admin-credential", YOUTUBE_DAILY_SEARCH_LIMIT: "80" };
const validId = "abc123def45";
const secondId = "xyz987uvw65";
const fixedNow = () => new Date("2026-11-06T18:00:00.000Z");
const fullReview = { matchesExercise: true, compatibleEquipment: true, visibleExecution: true, horizontal: true, aspectRatio16x9: true, notShorts: true };

function video(id = validId, overrides = {}) {
  return {
    id,
    snippet: { title: "Demonstração controlada", channelTitle: "Canal editorial", liveBroadcastContent: "none", ...overrides.snippet },
    contentDetails: { duration: "PT45S", ...overrides.contentDetails },
    status: { privacyStatus: "public", embeddable: true, ...overrides.status }
  };
}

function youtubeMock(items = [video()]) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/search")) return new Response(JSON.stringify({ items: items.map(item => ({ id: { videoId: item.id } })) }), { status: 200 });
    if (parsed.pathname.endsWith("/videos")) {
      const ids = (parsed.searchParams.get("id") || "").split(",");
      return new Response(JSON.stringify({ items: items.filter(item => ids.includes(item.id)) }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls };
}

function setup(items, options = {}) {
  const store = options.store || new MemoryStore();
  const mock = youtubeMock(items);
  const handler = createHandler({ store, fetchImpl: options.fetchImpl || mock.fetchImpl, env: options.env || ENV, now: fixedNow });
  return { store, handler, calls: mock.calls };
}

async function call(handler, action, body = {}, credential = ENV.FORJA_ADMIN_CREDENTIAL) {
  const response = await handler(new Request("https://prismatic-parfait-be3644.netlify.app/.netlify/functions/youtube-videos", {
    method: "POST",
    headers: { origin: "https://1rayke1.github.io", "content-type": "application/json", authorization: credential ? "Bearer " + credential : "" },
    body: JSON.stringify({ action, ...body })
  }), { ip: "test-ip" });
  return { response, payload: await response.json() };
}

const tests = [];
async function test(name, fn) {
  try { await fn(); tests.push(name); console.log("✅ " + name); }
  catch (error) { console.error("❌ " + name + "\n", error); process.exitCode = 1; }
}

await test("Y01. Duração ISO 8601 é convertida e entradas incompletas são rejeitadas", () => {
  assert.equal(parseDuration("PT60S"), 60); assert.equal(parseDuration("PT1M"), 60);
  assert.equal(parseDuration("PT1M1S"), 61); assert.equal(parseDuration("PT0S"), null); assert.equal(parseDuration("lixo"), null);
});

await test("Y02. Relatório vazio mantém os 165 exercícios pendentes e cobertura zero", () => {
  const report = buildReport([]);
  assert.equal(report.total, 165); assert.equal(report.pending, 165); assert.equal(report.approved, 0);
  assert.equal(report.coveragePercent, 0); assert.equal(report.withoutVideo.length, 165);
});

await test("Y03. GET público não exige credencial e POST administrativo é protegido", async () => {
  const { handler } = setup([]);
  const publicResponse = await handler(new Request("https://prismatic-parfait-be3644.netlify.app/.netlify/functions/youtube-videos"));
  assert.equal(publicResponse.status, 200);
  const denied = await call(handler, "dashboard", {}, null);
  assert.equal(denied.response.status, 401);
});

await test("Y04. Ausência das variáveis produz erro administrativo claro e sem segredos", async () => {
  const store = new MemoryStore(); const mock = youtubeMock([video()]);
  const handler = createHandler({ store, fetchImpl: mock.fetchImpl, env: {}, now: fixedNow });
  const auth = await call(handler, "dashboard", {}, "qualquer");
  assert.equal(auth.response.status, 503); assert.match(auth.payload.error, /FORJA_ADMIN_CREDENTIAL/);
  const noKey = createHandler({ store, fetchImpl: mock.fetchImpl, env: { FORJA_ADMIN_CREDENTIAL: ENV.FORJA_ADMIN_CREDENTIAL }, now: fixedNow });
  const result = await call(noKey, "search", { exerciseId: "cal-flexao", query: "flexão" });
  assert.equal(result.response.status, 503); assert.match(result.payload.error, /YOUTUBE_API_KEY/);
});

await test("Y05. Pesquisa consulta search.list + videos.list e sanitiza resultados", async () => {
  const { handler, calls } = setup([video()]);
  const result = await call(handler, "search", { exerciseId: "cal-flexao", query: "flexão de braço" });
  assert.equal(result.response.status, 200); assert.equal(result.payload.items.length, 1);
  assert.equal(result.payload.items[0].eligible, true); assert.equal(result.payload.items[0].durationSeconds, 45);
  assert.ok(calls.some(url => url.includes("/search?")) && calls.some(url => url.includes("/videos?")));
  assert.ok(!JSON.stringify(result.payload).includes(ENV.YOUTUBE_API_KEY));
});

await test("Y06. Pesquisa idêntica usa cache persistente e não repete consumo de cota", async () => {
  const { handler, calls } = setup([video()]);
  await call(handler, "search", { exerciseId: "cal-flexao", query: "Flexão" });
  const before = calls.length;
  const result = await call(handler, "search", { exerciseId: "cal-flexao", query: "flexão" });
  assert.equal(result.payload.cached, true); assert.equal(calls.length, before);
});

await test("Y07. Vídeo com mais de 60 segundos é reprovado e não entra em análise", async () => {
  const { handler } = setup([video(validId, { contentDetails: { duration: "PT1M1S" } })]);
  const search = await call(handler, "search", { exerciseId: "cal-flexao", query: "flexão" });
  assert.equal(search.payload.items[0].eligible, false); assert.match(search.payload.items[0].rejectionReasons.join(" "), /60/);
  const saved = await call(handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "review" });
  assert.equal(saved.response.status, 422);
});

await test("Y08. Vídeo não incorporável é reprovado automaticamente", async () => {
  const { handler } = setup([video(validId, { status: { embeddable: false } })]);
  const result = await call(handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "validated", review: fullReview });
  assert.equal(result.response.status, 422); assert.match(result.payload.error, /Incorporação/);
});

await test("Y09. Vídeo privado ou ausente não pode ser aprovado", async () => {
  const { handler } = setup([video(validId, { status: { privacyStatus: "private" } })]);
  const result = await call(handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "validated", review: fullReview });
  assert.equal(result.response.status, 422);
  const empty = setup([]); const missing = await call(empty.handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "validated", review: fullReview });
  assert.equal(missing.response.status, 422);
});

await test("Y10. Aprovação exige todas as confirmações visuais, inclusive não Shorts", async () => {
  const { handler } = setup([video()]);
  const result = await call(handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "validated", review: { ...fullReview, notShorts: false } });
  assert.equal(result.response.status, 422); assert.match(result.payload.error, /revisão visual/);
});

await test("Y11. Aprovação associa pelo exerciseId e persiste todos os campos obrigatórios", async () => {
  const { handler, store } = setup([video()]);
  const result = await call(handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "validated", review: fullReview });
  assert.equal(result.response.status, 200);
  const saved = await store.get("associations/cal-flexao.json");
  assert.equal(saved.exerciseId, "cal-flexao"); assert.equal(saved.videoId, validId);
  assert.equal(saved.orientation, "horizontal"); assert.equal(saved.aspectRatio, "16:9");
  assert.equal(saved.visibility, "public"); assert.equal(saved.embeddable, true);
  assert.equal(saved.reviewedAt, fixedNow().toISOString()); assert.equal(saved.updatedAt, fixedNow().toISOString());
});

await test("Y12. Nova instância do handler recupera a associação após reinicialização", async () => {
  const { handler, store } = setup([video()]);
  await call(handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "validated", review: fullReview });
  const restarted = setup([video()], { store }).handler;
  const dashboard = await call(restarted, "dashboard");
  assert.equal(dashboard.payload.report.approved, 1); assert.equal(dashboard.payload.report.pending, 164);
  assert.equal(dashboard.payload.associations[0].exerciseId, "cal-flexao");
});

await test("Y13. GET público expõe somente associação aprovada e válida", async () => {
  const { handler } = setup([video()]);
  await call(handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "review" });
  let response = await handler(new Request("https://prismatic-parfait-be3644.netlify.app/.netlify/functions/youtube-videos"));
  assert.equal((await response.json()).associations.length, 0);
  await call(handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "validated", review: fullReview });
  response = await handler(new Request("https://prismatic-parfait-be3644.netlify.app/.netlify/functions/youtube-videos"));
  const payload = await response.json(); assert.equal(payload.associations.length, 1);
  assert.equal(payload.report.coveragePercent, 0.61);
});

await test("Y14. Rejeição manual é persistida sem aprovar automaticamente por título", async () => {
  const { handler } = setup([video()]);
  const result = await call(handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "rejected", review: {} });
  assert.equal(result.response.status, 200); assert.equal(result.payload.association.status, "rejected");
  const dashboard = await call(handler, "dashboard"); assert.equal(dashboard.payload.report.rejected, 1); assert.equal(dashboard.payload.report.approved, 0);
});

await test("Y15. Remover associação devolve o exercício ao estado pendente", async () => {
  const { handler } = setup([video()]);
  await call(handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "validated", review: fullReview });
  await call(handler, "remove", { exerciseId: "cal-flexao" });
  const dashboard = await call(handler, "dashboard"); assert.equal(dashboard.payload.report.pending, 165); assert.equal(dashboard.payload.report.approved, 0);
});

await test("Y16. Auditoria marca vídeo removido como indisponível", async () => {
  const { handler, store } = setup([video()]);
  await call(handler, "save", { exerciseId: "cal-flexao", videoId: validId, status: "validated", review: fullReview });
  const removed = setup([], { store }).handler;
  const result = await call(removed, "refresh", { exerciseId: "cal-flexao" });
  assert.equal(result.payload.association.status, "unavailable");
  const dashboard = await call(removed, "dashboard"); assert.equal(dashboard.payload.report.unavailable, 1); assert.equal(dashboard.payload.report.approved, 0);
});

await test("Y17. exerciseId e videoId fora do contrato são rejeitados", async () => {
  const { handler } = setup([video()]);
  const exercise = await call(handler, "save", { exerciseId: "nome-solto", videoId: validId, status: "validated", review: fullReview });
  assert.equal(exercise.response.status, 400);
  const id = await call(handler, "save", { exerciseId: "cal-flexao", videoId: "curto", status: "review" });
  assert.equal(id.response.status, 400);
});

await test("Y18. Limite diário persistente protege a cota; cache continua disponível", async () => {
  const { handler } = setup([video()], { env: { ...ENV, YOUTUBE_DAILY_SEARCH_LIMIT: "1" } });
  await call(handler, "search", { exerciseId: "cal-flexao", query: "flexão" });
  const limited = await call(handler, "search", { exerciseId: "cal-flexao", query: "flexão barra" });
  assert.equal(limited.response.status, 429);
  const cached = await call(handler, "search", { exerciseId: "cal-flexao", query: "flexão" });
  assert.equal(cached.response.status, 200); assert.equal(cached.payload.cached, true);
});

await test("Y19. CORS aceita origens oficiais e rejeita origem desconhecida", async () => {
  const { handler } = setup([]);
  const preflight = await handler(new Request("https://prismatic-parfait-be3644.netlify.app/.netlify/functions/youtube-videos", { method: "OPTIONS", headers: { origin: "https://1rayke1.github.io" } }));
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("access-control-allow-origin"), "https://1rayke1.github.io");
  const denied = await handler(new Request("https://prismatic-parfait-be3644.netlify.app/.netlify/functions/youtube-videos", { headers: { origin: "https://evil.example" } }));
  assert.equal(denied.status, 403);
});

await test("Y20. Tentativas administrativas repetidas são limitadas", async () => {
  const { handler } = setup([]);
  for (let index = 0; index < 5; index += 1) await call(handler, "dashboard", {}, "incorreta");
  const limited = await call(handler, "dashboard");
  assert.equal(limited.response.status, 429);
});

await test("Y21. Código público não contém segredos e jogador usa somente nocookie", () => {
  const files = ["assets/js/forja-youtube.js", "assets/js/admin-exercicios.js", "admin/exercicios.html"];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(!source.includes(ENV.YOUTUBE_API_KEY) && !source.includes(ENV.FORJA_ADMIN_CREDENTIAL));
    assert.ok(!/YOUTUBE_API_KEY\s*=\s*[^=\s]/.test(source));
  }
  assert.match(fs.readFileSync("assets/js/forja-youtube.js", "utf8"), /youtube-nocookie\.com\/embed/);
});

console.log("\n============================================================");
console.log("YOUTUBE — " + tests.length + "/21 testes aprovados");
console.log("============================================================");
