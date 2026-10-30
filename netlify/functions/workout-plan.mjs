/*
 * Netlify Function: endpoint privado para geração de planos via OpenAI.
 * Configure OPENAI_API_KEY e (opcional) OPENAI_MODEL na plataforma de deploy.
 * Nenhum segredo é enviado ao cliente. A hospedagem estática GitHub Pages não
 * executa esta função; publique a Function em Netlify ou adapte o handler.
 */
const MAX_BODY_BYTES = 32000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12;
const requests = new Map();
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

const response = (statusCode, payload) => new Response(JSON.stringify(payload), { status: statusCode, headers });
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function validateInput(body) {
  if (!isObject(body) || !isObject(body.profile) || !Array.isArray(body.catalog)) throw new Error("Formato de requisição inválido.");
  const profile = body.profile;
  if (!Number.isInteger(profile.daysPerWeek) || profile.daysPerWeek < 1 || profile.daysPerWeek > 6) throw new Error("Disponibilidade inválida.");
  const catalog = body.catalog;
  if (catalog.length < 1 || catalog.length > 100) throw new Error("Catálogo inválido.");
  const ids = new Set();
  for (const item of catalog) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id || item.id.length > 120 || ids.has(item.id)) throw new Error("Exercício inválido no catálogo.");
    ids.add(item.id);
  }
  const safeProfile = {
    objective: String(profile.objective || "").slice(0, 40), focus: String(profile.focus || "").slice(0, 40),
    level: String(profile.level || "").slice(0, 40), experience: String(profile.experience || "").slice(0, 40),
    daysPerWeek: profile.daysPerWeek, location: String(profile.location || "").slice(0, 40),
    equipment: Array.isArray(profile.equipment) ? profile.equipment.filter(x => typeof x === "string").slice(0, 12) : [],
    legacyEquipment: String(profile.legacyEquipment || "").slice(0, 30),
    modalities: Array.isArray(profile.modalities) ? profile.modalities.filter(x => typeof x === "string").slice(0, 10) : [],
    limitations: Array.isArray(profile.limitations) ? profile.limitations.filter(x => typeof x === "string").slice(0, 10) : []
  };
  const safeCatalog = catalog.map(item => ({
    id: item.id, name: String(item.name || "").slice(0, 100), mode: item.mode,
    category: String(item.category || "").slice(0, 40), section: item.section, type: item.type,
    muscles: Array.isArray(item.muscles) ? item.muscles.filter(x => typeof x === "string").slice(0, 12) : [],
    equipment: Array.isArray(item.equipment) ? item.equipment.filter(x => typeof x === "string").slice(0, 12) : [],
    sets: item.sets, reps: String(item.reps || "").slice(0, 20), duration: item.duration, rest: item.rest
  }));
  const feedback = isObject(body.feedback) ? Object.fromEntries(Object.entries(body.feedback).slice(0, 8).map(([key, value]) => [String(key).slice(0, 40), String(value).slice(0, 30)])) : {};
  const history = isObject(body.history) ? {
    recentSessions: Number.isInteger(body.history.recentSessions) ? Math.max(0, Math.min(30, body.history.recentSessions)) : 0,
    averageRpe: Number.isFinite(body.history.averageRpe) && body.history.averageRpe >= 1 && body.history.averageRpe <= 10 ? body.history.averageRpe : null
  } : { recentSessions: 0, averageRpe: null };
  return { profile: safeProfile, catalog: safeCatalog, feedback, history, ids };
}

export function validatePlan(plan, catalog, maxSessions) {
  if (!isObject(plan) || !Array.isArray(plan.sessions) || plan.sessions.length < 1 || plan.sessions.length > maxSessions) throw new Error("Resposta do modelo fora do esquema.");
  const allowed = new Map(catalog.map(item => [item.id, item]));
  const clean = {
    summary: typeof plan.summary === "string" ? plan.summary.slice(0, 300) : "Plano personalizado com recuperação entre sessões.",
    sessions: plan.sessions.map((session, index) => {
      if (!isObject(session) || !Array.isArray(session.exercises) || session.exercises.length < 2 || session.exercises.length > 8) throw new Error("Sessão fora do esquema.");
      const seen = new Set();
      const exercises = session.exercises.map(item => {
        if (!isObject(item) || typeof item.exerciseId !== "string" || !allowed.has(item.exerciseId)) throw new Error("O modelo indicou um ID de exercício que não existe no catálogo permitido.");
        if (seen.has(item.exerciseId)) throw new Error("Exercício duplicado na sessão.");
        seen.add(item.exerciseId);
        const record = allowed.get(item.exerciseId);
        const sets = Number(item.sets), restSeconds = Number(item.restSeconds);
        if (!Number.isInteger(sets) || sets < 1 || sets > 5 || !Number.isInteger(restSeconds) || restSeconds < 0 || restSeconds > 300) throw new Error("Parâmetros de treino fora dos limites.");
        const out = { exerciseId: item.exerciseId, sets, restSeconds };
        if (record.type === "duration") {
          const durationSeconds = Number(item.durationSeconds);
          if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 600) throw new Error("Duração fora dos limites.");
          out.durationSeconds = durationSeconds;
        } else {
          const repetitions = Number(item.repetitions);
          if (!Number.isInteger(repetitions) || repetitions < 4 || repetitions > 20) throw new Error("Repetições fora dos limites.");
          out.repetitions = repetitions;
        }
        return out;
      });
      return { day: String(session.day || "").slice(0, 20), title: String(session.title || `Treino ${index + 1}`).slice(0, 50),
        rationale: String(session.rationale || "Sessão com estímulo equilibrado e recuperação adequada.").slice(0, 240), exercises };
    })
  };
  return clean;
}

function limited(key) {
  const now = Date.now();
  const values = (requests.get(key) || []).filter(stamp => now - stamp < WINDOW_MS);
  if (values.length >= MAX_REQUESTS) return true;
  values.push(now); requests.set(key, values); return false;
}

export default async function handler(request, context = {}) {
  if (request.method !== "POST") return response(405, { error: "Método não permitido." });
  const identity = context.ip || request.headers?.get?.("x-nf-client-connection-ip") || request.headers?.get?.("x-forwarded-for")?.split(",")[0] || "anonymous";
  if (limited(identity)) return response(429, { error: "Limite de requisições atingido. Tente novamente em alguns minutos." });
  if (!process.env.OPENAI_API_KEY) return response(503, { error: "OPENAI_API_KEY não configurada no backend." });
  let raw;
  try { raw = await request.text(); }
  catch (_) { return response(400, { error: "Corpo da requisição inválido." }); }
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return response(413, { error: "Requisição muito grande." });
  let input;
  try { input = validateInput(JSON.parse(raw)); }
  catch (error) { return response(400, { error: error.message }); }

  const schema = {
    type: "object", additionalProperties: false, required: ["summary", "sessions"], properties: {
      summary: { type: "string" }, sessions: { type: "array", minItems: 1, maxItems: input.profile.daysPerWeek, items: {
        type: "object", additionalProperties: false, required: ["day", "title", "rationale", "exercises"], properties: {
          day: { type: "string" }, title: { type: "string" }, rationale: { type: "string" }, exercises: { type: "array", minItems: 2, maxItems: 8, items: {
            type: "object", additionalProperties: false, required: ["exerciseId", "sets", "restSeconds", "repetitions", "durationSeconds"], properties: {
              exerciseId: { type: "string", enum: input.catalog.map(item => item.id) }, sets: { type: "integer", minimum: 1, maximum: 5 },
              restSeconds: { type: "integer", minimum: 0, maximum: 300 }, repetitions: { type: ["integer", "null"], minimum: 4, maximum: 20 }, durationSeconds: { type: ["integer", "null"], minimum: 10, maximum: 600 }
            }
          } }
        }
      } }
    }
  };

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", store: false,
        instructions: "Você planeja treino geral, não diagnostica doenças. Use somente IDs da lista fornecida. Considere limitações de baixo impacto, nível e descanso prudente. Responda estritamente no esquema. Não prometa resultados.",
        input: JSON.stringify({ profile: input.profile, feedback: input.feedback, recentTrainingSummary: input.history, catalog: input.catalog }),
        text: { format: { type: "json_schema", name: "forja_workout_plan", strict: true, schema } }
      })
    });
    if (upstream.status === 429) return response(429, { error: "O provedor de IA limitou as requisições. O gerador local pode ser usado." });
    if (!upstream.ok) return response(502, { error: "O provedor de IA não está disponível no momento." });
    const result = await upstream.json();
    const outputText = result.output_text || result.output?.flatMap(item => item.content || []).find(item => item.type === "output_text")?.text;
    if (!outputText) return response(502, { error: "Resposta vazia do provedor de IA." });
    let parsed;
    try { parsed = JSON.parse(outputText); } catch (_) { return response(502, { error: "O provedor retornou JSON inválido." }); }
    const plan = validatePlan(parsed, input.catalog, input.profile.daysPerWeek);
    return response(200, { engine: "ai", plan });
  } catch (error) {
    console.error("workout-plan provider error:", error?.message || "unknown");
    return response(502, { error: "Falha de comunicação com o provedor de IA." });
  }
}
