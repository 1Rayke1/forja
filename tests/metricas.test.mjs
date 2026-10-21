/*
  Testes unitários das funções puras de métricas (`assets/js/forja-metricas.js`).

  Diferente de `forja.test.mjs`, aqui não há página: o módulo de métricas é
  carregado em uma janela jsdom vazia, junto com o núcleo, o store e os modelos
  (dos quais ele usa `parseLoadKg`/`parseMaxReps`). Nada é escrito no
  armazenamento — se uma função de métrica tentar gravar, o teste falha no
  driver em memória usado como sentinela.

  Uso: node tests/metricas.test.mjs
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsdomPkg from "jsdom";

const { JSDOM } = jsdomPkg;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const jsDir = path.join(repoRoot, "assets", "js");

const dom = new JSDOM("<!doctype html><html><body data-root=\"../\"></body></html>", {
  url: "https://forja.test/forja/progresso/",
  runScripts: "outside-only",
  pretendToBeVisual: true
});

const scripts = ["forja-core.js", "forja-store.js", "forja-dados.js", "forja-metricas.js"];

scripts.forEach(file => {
  const source = fs.readFileSync(path.join(jsDir, file), "utf8");
  dom.window.eval(source + "\n//# sourceURL=" + file);
});

const F = dom.window.Forja;
const M = F && F.metricas;

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log("✅ " + name);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log("❌ " + name);
    console.log("   " + String(error && error.stack ? error.stack : error)
      .split("\n").slice(0, 10).join("\n   "));
  }
}

/* ------------------------------------------------------------------ */
/* Dados de apoio                                                      */
/* ------------------------------------------------------------------ */

function at(year, month, day, hour = 10, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function key(date) {
  return M.dateKeyOf(date);
}

function log(extra = {}) {
  return Object.assign({ set: 1, reps: "", load: "", seconds: 0, distance: null, rpe: null }, extra);
}

function exercise(name, logs, extra = {}) {
  return Object.assign({
    id: "ex-" + name,
    name,
    section: "main",
    plannedSets: logs.length,
    completedSets: logs.length,
    logs,
    type: "reps",
    distanceUnit: "m"
  }, extra);
}

function record(date, exercises, extra = {}) {
  return Object.assign({
    id: "rec-" + key(date) + "-" + Math.random().toString(36).slice(2, 6),
    date: key(date),
    finishedAt: date.toISOString(),
    modality: "weights",
    routineName: "Treino de teste",
    durationMs: 30 * 60000,
    status: "completed",
    completedSets: exercises.reduce((sum, item) => sum + item.completedSets, 0),
    totalPlannedSets: exercises.reduce((sum, item) => sum + item.plannedSets, 0),
    exercises
  }, extra);
}

/* ------------------------------------------------------------------ */
/* Módulo disponível                                                   */
/* ------------------------------------------------------------------ */

test("00. Módulo de métricas está carregado e é independente de DOM/estado", () => {
  assert.ok(M, "F.metricas não foi definido");
  assert.equal(typeof M.summarize, "function");
  assert.equal(typeof M.goalProgress, "function");
  assert.equal(F.state.history.length, 0, "O módulo não deve alterar F.state ao carregar");

  const memory = F.store.createMemoryDriver();
  F.store.useDriver(memory);
  assert.equal(memory.keys().length, 0, "Carregar métricas não pode gravar chaves");
});

/* ------------------------------------------------------------------ */
/* Datas                                                               */
/* ------------------------------------------------------------------ */

test("01. recordDate usa finishedAt e cai para a data antiga sem inventar", () => {
  const withFinished = { date: "2025-01-01", finishedAt: at(2026, 3, 4, 9, 30).toISOString() };
  assert.equal(key(M.recordDate(withFinished)), "2026-03-04");

  const legacy = { date: "2025-07-09" };
  assert.equal(key(M.recordDate(legacy)), "2025-07-09");

  assert.equal(M.recordDate({ date: "2025-02-31" }), null, "Data inexistente não pode virar 3 de março");
  assert.equal(M.recordDate({ date: "ontem" }), null);
  assert.equal(M.recordDate({ finishedAt: "não é data", date: "2025-05-05" }) && key(M.recordDate({ finishedAt: "não é data", date: "2025-05-05" })), "2025-05-05");
  assert.equal(M.recordDate(null), null);
  assert.equal(M.formatRecordDate({ date: "invalida" }), "Data não registrada");
});

/* ------------------------------------------------------------------ */
/* Períodos                                                            */
/* ------------------------------------------------------------------ */

test("02. Períodos: semana segunda→domingo, mês, tudo e personalizado", () => {
  const now = at(2026, 10, 21); // quarta-feira

  const week = M.resolvePeriod("week", { now });
  assert.equal(key(week.from), "2026-10-19", "Semana deve começar na segunda");
  assert.equal(key(week.to), "2026-10-25");
  assert.equal(key(week.previous.from), "2026-10-12");
  assert.equal(key(week.previous.to), "2026-10-18");

  const month = M.resolvePeriod("month", { now });
  assert.equal(key(month.from), "2026-10-01");
  assert.equal(key(month.to), "2026-10-31");
  assert.equal(key(month.previous.from), "2026-09-01");
  assert.equal(key(month.previous.to), "2026-09-30");

  const all = M.resolvePeriod("all", { now });
  assert.equal(all.from, null);
  assert.equal(all.to, null);
  assert.equal(all.previous, null, "Período total não inventa comparação");

  const custom = M.resolvePeriod("custom", { from: "2026-10-01", to: "2026-10-10", now });
  assert.equal(key(custom.from), "2026-10-01");
  assert.equal(key(custom.to), "2026-10-10");
  assert.equal(key(custom.previous.from), "2026-09-21", "Período anterior tem o mesmo tamanho");
  assert.equal(key(custom.previous.to), "2026-09-30");

  assert.equal(M.resolvePeriod("custom", { from: "2026-10-10", to: "2026-10-01", now }), null);
  assert.equal(M.resolvePeriod("custom", { from: "2026-02-30", to: "2026-03-01", now }), null);
  assert.equal(M.resolvePeriod("desconhecido", { now }).id, "all");
});

test("03. filterByPeriod inclui os limites do dia e descarta registro sem data", () => {
  const range = M.resolvePeriod("custom", { from: "2026-10-01", to: "2026-10-03" });
  const records = [
    record(at(2026, 10, 1, 0, 1), []),
    record(at(2026, 10, 3, 23, 59), []),
    record(at(2026, 9, 30, 23, 59), []),
    record(at(2026, 10, 4, 0, 1), []),
    { id: "sem-data", exercises: [] }
  ];

  const filtered = M.filterByPeriod(records, range);
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map(item => item.date).sort(), ["2026-10-01", "2026-10-03"]);

  assert.equal(M.filterByPeriod(records, { from: null, to: null }).length, 5);
});

/* ------------------------------------------------------------------ */
/* Totais                                                              */
/* ------------------------------------------------------------------ */

test("04. Totais separam unidades e respeitam totals gravados", () => {
  const session = record(at(2026, 10, 20), [
    exercise("Supino", [
      log({ reps: "10", load: "40 kg", seconds: 40 }),
      log({ set: 2, reps: "8", load: "45 kg", seconds: 35 })
    ]),
    exercise("Prancha", [log({ reps: "", seconds: 60 })], { type: "duration" }),
    exercise("Corrida", [log({ reps: "", distance: 400 })], { measure: "distance" })
  ], {
    totals: {
      volumeKg: 760, reps: 18, seconds: 135, distanceMeters: 400,
      setsLogged: 4, setsWithoutVolume: 1
    }
  });

  const metrics = M.recordMetrics(session);
  assert.equal(metrics.sets, 4);
  assert.equal(metrics.volumeKg, 760);
  assert.equal(metrics.reps, 18);
  assert.equal(metrics.seconds, 135);
  assert.equal(metrics.distanceMeters, 400);
  assert.equal(metrics.hasVolume, true);
  assert.equal(metrics.hasDistance, true);
  assert.equal(metrics.best.loadKg, 45);
  assert.equal(metrics.best.seconds, 60);
  assert.equal(metrics.best.distanceMeters, 400);

  const summary = M.summarize([session]);
  assert.equal(summary.volumeKg, 760);
  assert.equal(summary.seconds, 135);
  assert.equal(summary.distanceMeters, 400, "Distância não pode entrar no volume");
  assert.equal(summary.minutes, 30);
});

test("05. Histórico antigo sem totals é derivado das séries, sem estimativa", () => {
  const legacy = {
    id: "legado",
    date: "2025-03-01",
    modality: "weights",
    routineName: "Antigo",
    durationMs: 60000,
    completedSets: 2,
    totalPlannedSets: 3,
    exercises: [
      exercise("Remada", [log({ reps: "8-12", load: "2x20 kg" }), log({ set: 2, reps: "10", load: "puxada leve" })]),
      exercise("Caminhada", [log({ distance: 1.2 })], { distanceUnit: "km" })
    ]
  };

  const metrics = M.recordMetrics(legacy);
  assert.equal(metrics.sets, 2);
  assert.equal(metrics.plannedSets, 3);
  assert.equal(metrics.reps, 22, "8-12 conta 12 e o texto sem número não vira repetição");
  assert.equal(metrics.volumeKg, 240, "Carga ilegível não entra no volume");
  assert.equal(metrics.distanceMeters, 1200, "1,2 km deve virar 1200 m");
  assert.equal(metrics.hasVolume, true);
  assert.equal(metrics.hasDistance, true);
  assert.equal(metrics.hasTime, false);
  assert.equal(metrics.setsWithoutVolume, 1, "Série sem carga numérica é declarada; a de distância não é volume");
});

test("06. Métrica sem dado fica indisponível, nunca zero fabricado", () => {
  const bodyweight = {
    id: "sem-carga",
    date: "2026-10-19",
    modality: "calisthenics",
    completedSets: 3,
    totalPlannedSets: 3,
    durationMs: 0,
    exercises: [exercise("Flexão", [log({ reps: "12" }), log({ set: 2, reps: "10" }), log({ set: 3, reps: "8" })])]
  };

  const metrics = M.recordMetrics(bodyweight);
  assert.equal(metrics.volumeKg, 0);
  assert.equal(metrics.hasVolume, false, "Sem carga numérica não há volume");
  assert.equal(metrics.reps, 30);
  assert.equal(metrics.hasReps, true);
  assert.equal(metrics.hasDistance, false);
  assert.equal(metrics.hasTime, false);

  const summary = M.summarize([bodyweight]);
  assert.equal(summary.hasVolume, false);
  assert.equal(summary.minutes, 0);
  assert.equal(summary.trainedDays, 1);
  assert.equal(key(summary.lastDate), "2026-10-19");
});

test("07. As funções não mutam os registros recebidos", () => {
  const session = record(at(2026, 10, 20), [exercise("Agachamento", [log({ reps: "10", load: "30 kg" })])]);
  const snapshot = JSON.stringify(session);

  M.summarize([session]);
  M.weeklySeries([session], { now: at(2026, 10, 21) });
  M.frequency([session], { now: at(2026, 10, 21) });
  M.exerciseList([session]);
  M.exerciseEvolution([session], "weights|agachamento", { now: at(2026, 10, 21) });
  M.personalRecords([session]);
  M.comparePeriods([session], M.resolvePeriod("week", { now: at(2026, 10, 21) }), M.resolvePeriod("week", { now: at(2026, 10, 21) }).previous);
  M.goalProgress([session], { weeklySessions: 3 }, { now: at(2026, 10, 21) });
  M.searchRecords([session], { query: "agachamento" });

  assert.equal(JSON.stringify(session), snapshot, "Nenhuma função de métrica deve alterar o registro");
});

/* ------------------------------------------------------------------ */
/* Séries semanais e frequência                                        */
/* ------------------------------------------------------------------ */

test("08. weeklySeries agrupa por semana e cobre a janela pedida", () => {
  const now = at(2026, 10, 21);
  const records = [
    record(at(2026, 10, 20), [exercise("A", [log({ reps: "10", load: "10 kg" })])]),
    record(at(2026, 10, 19), [exercise("B", [log({ reps: "10" })])], { modality: "calisthenics", status: "partial" }),
    record(at(2026, 10, 12), [exercise("C", [log({ reps: "5", load: "20 kg" })])]),
    record(at(2026, 9, 1), [exercise("D", [log({ reps: "5" })])])
  ];

  const weeks = M.weeklySeries(records, { now, weeks: 4 });
  assert.equal(weeks.length, 4);
  assert.equal(key(weeks[0].from), "2026-09-28");
  assert.equal(key(weeks[3].from), "2026-10-19");

  const current = weeks[3];
  assert.equal(current.sessions, 2);
  assert.equal(current.completed, 1);
  assert.equal(current.sets, 2);
  assert.equal(current.volumeKg, 100);
  assert.equal(current.hasVolume, true);

  const previous = weeks[2];
  assert.equal(previous.sessions, 1);
  assert.equal(previous.volumeKg, 100);

  assert.equal(weeks.reduce((sum, week) => sum + week.sessions, 0), 3, "Fora da janela não entra");
});

test("09. frequency monta 7 dias por semana, começando na segunda", () => {
  const now = at(2026, 10, 21);
  const records = [
    record(at(2026, 10, 20), [exercise("A", [log({ reps: "10" }), log({ set: 2, reps: "10" })])]),
    record(at(2026, 10, 20), [exercise("B", [log({ reps: "8" })])]),
    record(at(2026, 10, 14), [exercise("C", [log({ reps: "6" })])])
  ];

  const calendar = M.frequency(records, { now, weeks: 12 });
  assert.equal(calendar.days.length, 84);
  assert.equal(calendar.days[0].weekday, "seg");
  assert.equal(calendar.days[0].date, "2026-08-03", "12 semanas antes da de 19/10 começa em 03/08");
  assert.equal(calendar.days[83].date, "2026-10-25");

  const day = calendar.days.find(item => item.date === "2026-10-20");
  assert.equal(day.sessions, 2);
  assert.equal(day.count, 3, "O heatmap usa séries concluídas no dia");
  assert.equal(day.future, false);

  const future = calendar.days.find(item => item.date === "2026-10-24");
  assert.equal(future.future, true);
  assert.equal(future.count, 0);

  assert.equal(calendar.trainedDays, 2);
  assert.equal(calendar.trainedSessions, 3);
  assert.equal(calendar.maxSets, 3);
  assert.equal(calendar.hasData, true);
  assert.equal(M.frequency([], { now }).hasData, false);
});

/* ------------------------------------------------------------------ */
/* Exercícios                                                          */
/* ------------------------------------------------------------------ */

test("10. exerciseList infere a medida e ignora acento/caixa", () => {
  const records = [
    record(at(2026, 10, 20), [
      exercise("Flexão", [log({ reps: "12" })]),
      exercise("Supino", [log({ reps: "8", load: "40 kg" })])
    ], { modality: "weights" }),
    record(at(2026, 10, 18), [exercise("FLEXAO", [log({ reps: "10" })])], { modality: "weights" })
  ];

  const list = M.exerciseList(records);
  const flexao = list.find(item => item.name.toLowerCase() === "flexão" || item.name.toLowerCase() === "flexao");
  assert.ok(flexao, "Exercício sem acento não foi agrupado");
  assert.equal(flexao.sessions, 2);
  assert.equal(flexao.measure, "reps");

  const supino = list.find(item => item.name === "Supino");
  assert.equal(supino.measure, "load");
  assert.equal(supino.sessions, 1);
});

test("11. exerciseEvolution usa a maior carga por treino, em ordem cronológica", () => {
  const records = [
    record(at(2026, 10, 20), [exercise("Supino", [log({ reps: "8", load: "50 kg" }), log({ set: 2, reps: "6", load: "45 kg" })])]),
    record(at(2026, 10, 6), [exercise("Supino", [log({ reps: "10", load: "40 kg" })])]),
    record(at(2026, 10, 13), [exercise("Supino", [log({ reps: "9", load: "42,5 kg" })])])
  ];

  const evolution = M.exerciseEvolution(records, "weights|supino");
  assert.equal(evolution.measure, "load");
  assert.equal(evolution.unit, "kg");
  assert.deepEqual([...evolution.points.map(point => point.y)], [40, 42.5, 50]);
  assert.deepEqual([...evolution.points.map(point => point.dateKey)], ["2026-10-06", "2026-10-13", "2026-10-20"]);
  assert.equal(evolution.best.y, 50);
  assert.equal(evolution.hasSeries, true);
  assert.match(evolution.criteria, /maior carga numérica/i);
});

test("12. exerciseEvolution: distância, tempo, pontos insuficientes e sessões sem medida", () => {
  const records = [
    record(at(2026, 10, 1), [exercise("Corrida", [log({ distance: 400 })], { measure: "distance" })]),
    record(at(2026, 10, 8), [exercise("Corrida", [log({ distance: 1.2 })], { measure: "distance", distanceUnit: "km" })]),
    record(at(2026, 10, 15), [exercise("Corrida", [log({ reps: "" })], { measure: "distance" })])
  ];

  const run = M.exerciseEvolution(records, "weights|corrida");
  assert.equal(run.measure, "distance");
  assert.deepEqual([...run.points.map(point => point.y)], [400, 1200]);
  assert.equal(run.unmeasured, 1, "Sessão sem distância medida é declarada, não zerada");
  assert.equal(run.hasSeries, true);

  const plank = M.exerciseEvolution([
    record(at(2026, 10, 1), [exercise("Prancha", [log({ seconds: 30 })], { type: "duration" })])
  ], "weights|prancha");
  assert.equal(plank.measure, "time");
  assert.equal(plank.hasSeries, false, "Um ponto só não é evolução");
  assert.equal(plank.points.length, 1);
});

/* ------------------------------------------------------------------ */
/* Recordes                                                            */
/* ------------------------------------------------------------------ */

test("13. Recordes têm critério explícito, empate recente e categorias ausentes", () => {
  const records = [
    record(at(2026, 10, 6), [exercise("Supino", [log({ reps: "10", load: "40 kg" }), log({ set: 2, reps: "12", load: "35 kg" })])]),
    record(at(2026, 10, 20), [exercise("Supino", [log({ reps: "8", load: "40 kg" })])], {
      totals: { volumeKg: 320, reps: 8, seconds: 0, distanceMeters: 0, setsLogged: 1, setsWithoutVolume: 0 },
      completedSets: 1, totalPlannedSets: 1
    }),
    record(at(2026, 10, 13), [exercise("Corrida", [log({ distance: 900 })], { measure: "distance" })])
  ];

  const recordsResult = M.personalRecords(records);
  const byId = new Map(recordsResult.items.map(item => [item.id, item]));

  assert.equal(byId.get("load").value, 40);
  assert.equal(key(byId.get("load").date), "2026-10-20", "Empate fica com o registro mais recente");
  assert.match(byId.get("load").criteria, /lb.*kg/i);

  assert.equal(byId.get("reps").value, 12);
  assert.equal(key(byId.get("reps").date), "2026-10-06");

  assert.equal(byId.get("distance").value, 900);
  assert.equal(byId.get("volume").value, 820, "Volume da primeira sessão: 10x40 + 12x35 = 820 kg");
  assert.equal(byId.get("sets").value, 2);
  assert.equal(byId.get("sessionTime").value, 1800);

  assert.equal(byId.has("time"), false, "Sem série cronometrada não existe recorde de tempo");
  assert.ok(recordsResult.absent.some(item => item.id === "time"));
  assert.equal(recordsResult.hasData, true);
});

test("14. Recordes ignoram carga ilegível e histórico vazio não gera recorde", () => {
  const illegible = record(at(2026, 10, 20), [exercise("Remada", [log({ reps: "10", load: "pesado" })])]);
  const recordsResult = M.personalRecords([illegible]);

  assert.equal(recordsResult.items.some(item => item.id === "load"), false);
  assert.equal(recordsResult.items.some(item => item.id === "reps"), true);
  assert.equal(M.personalRecords([]).hasData, false);
  assert.equal(M.personalRecords([]).items.length, 0);
});

/* ------------------------------------------------------------------ */
/* Comparação                                                          */
/* ------------------------------------------------------------------ */

test("15. comparePeriods calcula diferença, percentual e ausência de base", () => {
  const now = at(2026, 10, 21);
  const current = M.resolvePeriod("week", { now });
  const records = [
    record(at(2026, 10, 20), [exercise("A", [log({ reps: "10", load: "10 kg" })])]),
    record(at(2026, 10, 19), [exercise("B", [log({ reps: "10" })])]),
    record(at(2026, 10, 13), [exercise("C", [log({ reps: "10" })])])
  ];

  const comparison = M.comparePeriods(records, current, current.previous);
  assert.equal(comparison.available, true);
  assert.equal(comparison.hasData, true);

  const byId = new Map(comparison.metrics.map(metric => [metric.id, metric]));
  assert.equal(byId.get("sessions").current, 2);
  assert.equal(byId.get("sessions").previous, 1);
  assert.equal(byId.get("sessions").delta, 1);
  assert.equal(byId.get("sessions").percent, 100);

  assert.equal(byId.get("sets").current, 2);
  assert.equal(byId.get("volume").current, 100);
  assert.equal(byId.get("volume").previous, 0);
  assert.equal(byId.get("volume").percent, null, "Sem base anterior, percentual é indefinido");
  assert.equal(byId.get("volume").available, true);

  const empty = M.comparePeriods([], current, current.previous);
  assert.equal(empty.hasData, false);
  assert.equal(empty.metrics.find(metric => metric.id === "volume").available, false);

  const all = M.resolvePeriod("all", { now });
  const unavailable = M.comparePeriods(records, all, all.previous);
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.metrics.length, 0);
});

/* ------------------------------------------------------------------ */
/* Metas                                                               */
/* ------------------------------------------------------------------ */

test("16. Metas semanais usam a semana corrente e o escopo da meta", () => {
  const now = at(2026, 10, 21);
  const records = [
    record(at(2026, 10, 20), [exercise("A", [log({ reps: "10" })])], { modality: "weights", durationMs: 30 * 60000 }),
    record(at(2026, 10, 19), [exercise("B", [log({ reps: "10" }), log({ set: 2, reps: "10" })])], { modality: "calisthenics", durationMs: 15 * 60000 }),
    record(at(2026, 10, 12), [exercise("C", [log({ reps: "10" })])], { modality: "weights" })
  ];

  const all = M.goalProgress(records, {
    modality: "all", weeklySessions: 2, weeklySets: 4, weeklyMinutes: 40
  }, { now });

  assert.equal(all.week.from.getDate(), 19);
  assert.equal(all.active, true);
  assert.equal(all.summary.sessions, 2, "A sessão da semana passada não conta");
  assert.equal(all.summary.sets, 3);
  assert.equal(all.summary.minutes, 45);

  const sessions = all.items.find(item => item.id === "weeklySessions");
  assert.equal(sessions.current, 2);
  assert.equal(sessions.target, 2);
  assert.equal(sessions.met, true);
  assert.equal(sessions.percent, 100);
  assert.equal(sessions.remaining, 0);

  const sets = all.items.find(item => item.id === "weeklySets");
  assert.equal(sets.percent, 75);
  assert.equal(sets.met, false);
  assert.equal(sets.remaining, 1);

  const weightsOnly = M.goalProgress(records, {
    modality: "weights", weeklySessions: 3, weeklySets: 0, weeklyMinutes: 0
  }, { now });
  assert.equal(weightsOnly.summary.sessions, 1);
  assert.equal(weightsOnly.items.find(item => item.id === "weeklySessions").percent, 33);
  assert.equal(weightsOnly.items.find(item => item.id === "weeklySets").active, false);

  const inactive = M.goalProgress(records, { modality: "all", weeklySessions: 0, weeklySets: 0, weeklyMinutes: 0 }, { now });
  assert.equal(inactive.active, false);
});

/* ------------------------------------------------------------------ */
/* Busca                                                               */
/* ------------------------------------------------------------------ */

test("17. searchRecords combina texto, status e período com acento e caixa ignorados", () => {
  const current = M.resolvePeriod("week", { now: at(2026, 10, 21) });
  const records = [
    record(at(2026, 10, 20), [exercise("Supino inclinado", [log({ reps: "8", load: "40 kg" })])], {
      routineName: "Peito e ombro", status: "completed",
      feedback: { rpe: 8, note: "Ombro esquerdo levemente sensível" }
    }),
    record(at(2026, 10, 19), [exercise("Remada curvada", [log({ reps: "10", load: "30 kg" })])], {
      routineName: "Costas", status: "partial", feedback: { rpe: null, note: "" }
    }),
    record(at(2026, 9, 1), [exercise("Supino inclinado", [log({ reps: "8", load: "35 kg" })])], {
      routineName: "Peito antigo", status: "completed"
    })
  ];

  assert.equal(M.searchRecords(records, { period: current, query: "SUPINO" }).length, 1);
  assert.equal(M.searchRecords(records, { period: current, query: "supino ombro" }).length, 1);
  assert.equal(M.searchRecords(records, { period: current, query: "sensivel" }).length, 1, "Nota da sessão entra na busca");
  assert.equal(M.searchRecords(records, { period: current, query: "", status: "partial" }).length, 1);
  assert.equal(M.searchRecords(records, { period: current, query: "", status: "completed" }).length, 1);
  assert.equal(M.searchRecords(records, { period: null, query: "supino" }).length, 2);
  assert.equal(M.searchRecords(records, { period: current, query: "inexistente" }).length, 0);
});

/* ------------------------------------------------------------------ */

const failed = results.filter(result => !result.ok);

console.log("");
console.log("============================================================");
console.log("MÉTRICAS — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
console.log("============================================================");

if (failed.length > 0) process.exitCode = 1;
