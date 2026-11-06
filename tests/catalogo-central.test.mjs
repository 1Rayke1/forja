import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = { console };
context.globalThis = context;
vm.createContext(context);
for (const file of ["forja-exercicios-dados.js", "forja-catalogo-central.js", "forja-biblioteca.js"]) {
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "assets/js", file), "utf8"), context, { filename: file });
}
const F = context.Forja;
const catalog = F.exerciseCatalog;
const raw = context.FORJA_EXERCISES_DATA;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("✅ " + name);
  } catch (error) {
    results.push({ name, ok: false });
    console.error("❌ " + name + "\n", error);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const legacyIds = [
  "cal-rotacao-ombros", "cal-mobilidade-quadril", "cal-polichinelo", "cal-flexao",
  "cal-agachamento", "cal-barra-fixa", "cal-remada-invertida", "cal-mergulho",
  "cal-afundo", "cal-ponte", "cal-prancha-frontal", "cal-prancha-lateral",
  "cal-abdominal-supra", "cal-elevacao-pernas", "cal-abdominal-infra", "cal-burpee",
  "cal-mountain-climber", "cal-corrida-estacionaria", "mus-esteira",
  "mus-mobilidade-ombro", "mus-supino-reto", "mus-agachamento-barra", "mus-terra",
  "mus-puxada-frontal", "mus-desenvolvimento", "mus-remada-curvada", "mus-leg-press",
  "mus-rosca-direta", "mus-triceps-polia", "mus-extensora", "mus-flexora",
  "mus-elevacao-lateral", "mus-abdominal-polia", "mus-prancha", "mus-elevacao-barra",
  "mus-bicicleta", "mus-farmer"
];

await test("C01. Catálogo válido, expandido e com os 13 grupos e três modalidades", () => {
  const validation = catalog.validate();
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.ok(catalog.exercises.length >= 120, "Expansão insuficiente");
  assert.equal(catalog.muscleGroups.length, 13);
  assert.deepEqual(Array.from(catalog.modalities, mode => mode.id), ["academia", "calistenia", "peso-corporal"]);
  catalog.muscleGroups.forEach(group => {
    assert.ok(catalog.exercises.some(record => record.primaryMuscle === group.id), "Grupo vazio: " + group.id);
  });
});

await test("C02. IDs, nomes e aliases são únicos e todos os campos obrigatórios estão preenchidos", () => {
  const ids = new Set(catalog.exercises.map(record => record.id));
  assert.equal(ids.size, catalog.exercises.length);
  catalog.exercises.forEach(record => {
    assert.match(record.id, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    assert.ok(record.name && record.description && record.instructions.length && record.technique.length && record.cautions.length);
    assert.ok(record.primaryMuscle);
    assert.ok(!record.secondaryMuscles.includes(record.primaryMuscle));
    assert.ok(!record.stabilizers.includes(record.primaryMuscle));
  });
});

await test("C03. Peso corporal não contém nenhum equipamento ou estrutura", () => {
  const records = catalog.filter({ modality: "peso-corporal" });
  assert.ok(records.length > 0);
  records.forEach(record => assert.deepEqual(Array.from(record.equipment), [], record.id));
  assert.equal(catalog.byId("cal-barra-fixa").modality, "calistenia");
  assert.ok(!records.some(record => record.id === "cal-barra-fixa"));
});

await test("C04. Academia e Calistenia declaram equipamentos pertencentes à modalidade", () => {
  catalog.exercises.filter(record => record.modality === "academia").forEach(record => assert.ok(record.equipment.length > 0, record.id));
  catalog.exercises.filter(record => record.modality === "calistenia").forEach(record => {
    assert.ok(record.equipment.length > 0, record.id);
    assert.ok(record.equipment.every(item => ["argolas", "barra-fixa", "estrutura", "paralelas", "plataforma", "toalha"].includes(item)), record.id);
  });
});

await test("C05. Rankings são editoriais, independentes, sequenciais e sem lacunas", () => {
  const groups = new Map();
  catalog.exercises.forEach(record => {
    assert.equal(record.ranking.type, "editorial");
    assert.equal(record.ranking.criteriaVersion, "1");
    const key = record.primaryMuscle + "|" + record.modality;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record.ranking.position);
  });
  groups.forEach((positions, key) => {
    positions.sort((a, b) => a - b);
    assert.deepEqual(positions, positions.map((_, index) => index + 1), key);
  });
  const direct = catalog.byId("mus-rosca-direta");
  const inclinada = catalog.byId("mus-rosca-inclinada");
  const martelo = catalog.byId("mus-rosca-martelo");
  assert.deepEqual([direct.ranking.position, inclinada.ranking.position, martelo.ranking.position], [1, 3, 4]);
  assert.equal(catalog.byId("cal-barra-fixa-supinada").ranking.position, 1);
});

await test("C06. Toda mídia tem estrutura válida e nenhum ID de YouTube foi inventado", () => {
  catalog.exercises.forEach(record => {
    assert.deepEqual(Object.keys(record.media.youtube).sort(), ["durationSeconds", "editorialReview", "status", "validatedAt", "videoId"].sort());
    assert.equal(record.media.youtube.status, "pending");
    assert.equal(record.media.youtube.videoId, null);
    assert.equal(record.media.youtube.editorialReview, false);
    if (record.media.image.src) assert.ok(fs.existsSync(path.join(repoRoot, record.media.image.src)), record.id);
  });
});

await test("C07. Todos os 37 IDs históricos permanecem resolvíveis", () => {
  legacyIds.forEach(id => assert.ok(catalog.byId(id), "ID histórico ausente: " + id));
  assert.equal(catalog.byId("mus-prancha").id, "cal-prancha-frontal");
  assert.equal(catalog.legacyIdMap["mus-prancha"], "cal-prancha-frontal");
});

await test("C08. Adaptador preserva os modos antigos sem misturar as modalidades centrais", () => {
  const total = F.EXERCISE_LIBRARY.calisthenics.length + F.EXERCISE_LIBRARY.weights.length;
  assert.equal(total, catalog.exercises.length);
  assert.equal(F.EXERCISE_LIBRARY.weights.length, catalog.filter({ modality: "academia" }).length);
  const bodyweight = F.EXERCISE_LIBRARY.calisthenics.find(record => record.id === "cal-flexao");
  assert.equal(bodyweight.catalogModality, "peso-corporal");
  assert.deepEqual(Array.from(bodyweight.equipment), ["peso corporal"]);
  const bar = F.EXERCISE_LIBRARY.calisthenics.find(record => record.id === "cal-barra-fixa");
  assert.equal(bar.catalogModality, "calistenia");
  assert.ok(!bar.equipment.includes("peso corporal"));
});

await test("C09. Adaptador entrega papéis, padrões, instruções e IDs à biblioteca atual", () => {
  const record = F.EXERCISE_LIBRARY.weights.find(item => item.id === "mus-rosca-direta");
  assert.equal(record.roles.primary[0], "bíceps");
  assert.equal(record.sets, 3);
  assert.equal(record.reps, "8-12");
  assert.ok(record.instructions.includes("cotovelos"));
  const old = F.EXERCISE_LIBRARY.calisthenics.find(item => item.id === "cal-flexao");
  assert.equal(old.section, "main");
  assert.equal(old.ranking.type, "editorial");
});

await test("C10. Pesquisa usa nome oficial, aliases, parcial, caixa e acentos", () => {
  assert.ok(catalog.filter({ query: "barbell curl" }).some(record => record.id === "mus-rosca-direta"));
  assert.ok(catalog.filter({ query: "ROSCA DIRETA" }).some(record => record.id === "mus-rosca-direta"));
  assert.ok(catalog.filter({ query: "flexao" }).some(record => record.id === "cal-flexao"));
  assert.ok(catalog.filter({ query: "supin" }).some(record => record.id === "cal-barra-fixa-supinada"));
  assert.equal(catalog.filter({ query: "exercicio inexistente xyz" }).length, 0);
});

await test("C11. Filtros combinados ordenam pelo ranking da combinação", () => {
  const records = catalog.filter({ primaryMuscle: "biceps", modality: "academia" });
  assert.equal(records.length, 6);
  assert.deepEqual(Array.from(records, record => record.ranking.position), [1, 2, 3, 4, 5, 6]);
  assert.ok(records.every(record => record.primaryMuscle === "biceps" && record.modality === "academia"));
  assert.equal(catalog.byId("cal-flexao").modality, "peso-corporal");
  assert.ok(catalog.filter({ muscle: "peitoral", modality: "peso-corporal" }).every(record => record.equipment.length === 0));
});

await test("C12. Relatório reflete os registros reais e pendências sem dados fictícios", () => {
  const report = catalog.report();
  assert.equal(report.total, catalog.exercises.length);
  assert.equal(report.incomplete.length, 0);
  assert.equal(report.duplicateIds.length, 0);
  assert.equal(report.withoutRanking.length, 0);
  assert.equal(report.videosPrepared, report.total);
  assert.equal(report.validatedVideos, 0);
  assert.equal(report.pendingVideos, report.total);
  assert.equal(report.withoutImage, catalog.exercises.filter(record => !record.media.image.src).length);
  Object.values(report.byPrimaryMuscle).forEach(count => assert.ok(count > 0));
  assert.equal(Object.values(report.byModality).reduce((a, b) => a + b, 0), report.total);
});

await test("C13. Validador rejeita IDs/nomes duplicados e aliases ambíguos", () => {
  const data = clone(raw);
  data.exercises.push(clone(data.exercises[0]));
  const duplicate = catalog.validate(data);
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.errors.some(error => /id duplicado|nome duplicado|alias\/nome ambíguo/.test(error)));
  const ambiguous = clone(raw);
  ambiguous.exercises[1].aliases = [ambiguous.exercises[0].name];
  assert.equal(catalog.validate(ambiguous).valid, false);
});

await test("C14. Validador rejeita equipamento incorreto, músculo inválido e ranking artificial", () => {
  const equipped = clone(raw);
  equipped.exercises.find(record => record.id === "cal-flexao").equipment = ["barra-fixa"];
  assert.ok(catalog.validate(equipped).errors.some(error => /Peso corporal exige equipment vazio/.test(error)));
  const muscle = clone(raw);
  muscle.exercises[0].primaryMuscle = "inventado";
  assert.equal(catalog.validate(muscle).valid, false);
  const ranking = clone(raw);
  ranking.exercises.find(record => record.id === "mus-rosca-direta").ranking.position = 99;
  assert.ok(catalog.validate(ranking).errors.some(error => /lacuna|duplicado/.test(error)));
});

await test("C15. Validador exige mídia real e rejeita validação incompleta de YouTube", () => {
  const data = clone(raw);
  const video = data.exercises[0].media.youtube;
  video.status = "validated";
  video.videoId = "abc";
  const validation = catalog.validate(data);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => /videoId inválido|Vídeo validado exige/.test(error)));
  const pending = clone(raw);
  pending.exercises[0].media.youtube.videoId = "dQw4w9WgXcQ";
  assert.ok(catalog.validate(pending).errors.some(error => /Vídeo pendente/.test(error)));
});

await test("C16. Consultas combinadas permanecem rápidas com o catálogo expandido", () => {
  const start = performance.now();
  let matches = 0;
  for (let index = 0; index < 5000; index += 1) {
    matches += catalog.filter({ query: "rosca", primaryMuscle: "biceps", modality: "academia" }).length;
  }
  const elapsed = performance.now() - start;
  assert.ok(matches > 0);
  assert.ok(elapsed < 2000, "5000 consultas demoraram " + elapsed.toFixed(1) + " ms");
  console.log("   desempenho: 5000 consultas em " + elapsed.toFixed(1) + " ms");
});

await test("C17. O catálogo publicado é imutável durante a execução", () => {
  assert.ok(Object.isFrozen(catalog.exercises));
  assert.ok(Object.isFrozen(catalog.exercises[0]));
  assert.ok(Object.isFrozen(catalog.exercises[0].media.youtube));
  assert.throws(() => { catalog.exercises[0].name = "Alteração indevida"; }, TypeError);
  assert.equal(catalog.byId("mus-prancha").id, "cal-prancha-frontal");
});

const failed = results.filter(result => !result.ok);
console.log("\n============================================================");
console.log("CATÁLOGO CENTRAL — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
console.log("============================================================");
if (failed.length) process.exitCode = 1;
