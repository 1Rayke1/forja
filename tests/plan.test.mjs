import assert from "node:assert/strict";
import { validateInput, validatePlan } from "../netlify/functions/workout-plan.mjs";
import { boot, closeAllApps, wait } from "./helpers/harness.mjs";

const catalog = [
  { id: "mus-supino-reto", name: "Supino reto", mode: "weights", category: "push", section: "main", type: "reps", muscles: ["peito"], equipment: ["barra", "banco"], sets: 3, reps: "10", duration: 45, rest: 90 },
  { id: "mus-remada-curvada", name: "Remada curvada", mode: "weights", category: "pull", section: "main", type: "reps", muscles: ["costas"], equipment: ["barra"], sets: 3, reps: "10", duration: 45, rest: 90 }
];
const input = validateInput({ profile: { daysPerWeek: 3, objective: "forca", age: 34, email: "not-sent" }, catalog, feedback: {} });
assert.equal(input.profile.daysPerWeek, 3);
assert.equal(Object.hasOwn(input.profile, "age"), false, "Dados pessoais não permitidos não entram no payload do provedor");
assert.equal(input.ids.has("mus-supino-reto"), true);
assert.throws(() => validateInput({ profile: { daysPerWeek: 0 }, catalog }), /Disponibilidade inválida/);

const valid = validatePlan({ summary: "Sessão de força", sessions: [{ day: "Segunda", title: "A", rationale: "Alternar com descanso", exercises: [{ exerciseId: "mus-supino-reto", sets: 3, repetitions: 8, restSeconds: 90 }, { exerciseId: "mus-remada-curvada", sets: 3, repetitions: 8, restSeconds: 90 }] }] }, catalog, 3);
assert.equal(valid.sessions[0].exercises[0].exerciseId, "mus-supino-reto");
assert.throws(() => validatePlan({ sessions: [{ exercises: [{ exerciseId: "id-inventado", sets: 3, repetitions: 8, restSeconds: 60 }, { exerciseId: "mus-supino-reto", sets: 3, repetitions: 8, restSeconds: 60 }] }] }, catalog, 3), /ID de exercício que não existe/);
assert.throws(() => validatePlan({ sessions: [{ exercises: [{ exerciseId: "mus-supino-reto", sets: 9, repetitions: 8, restSeconds: 60 }, { exerciseId: "mus-supino-reto", sets: 3, repetitions: 8, restSeconds: 60 }] }] }, catalog, 3), /Sessão fora do esquema|Parâmetros de treino fora/);
console.log("✅ Endpoint: valida payload enxuto, esquema, limites e IDs do catálogo");

const profile = { version: 3, updatedAt: "2026-10-01T12:00:00.000Z", objetivo: "hipertrofia", nivel: "iniciante", equipamento: "academia", diasPorSemana: 3, areaFoco: "corpoTodo", localTreino: "academia", experienciaAtual: "basicos", equipamentos: ["academiaCompleta"], preferenciasTreino: ["musculacao"], consideracoes: ["nenhuma"] };
const history = [{ id: "historic-session", modality: "weights", date: "2026-10-20", exercises: [] }];
const app = await boot({ "forja-perfil-v1": profile, "forja-treino-historico-v1": history }, "treino/index.html");
try {
  assert.equal(app.d.body.dataset.page, "treino", "Perfil concluído acessa o hub");
  assert.ok(app.F.plan && app.F.catalog.items().length > 0, "Módulo real e catálogo inicializados");
  const candidates = app.F.plan.compatibleCatalog(app.F.state.profile);
  assert.ok(candidates.length > 0);
  assert.throws(() => app.F.plan.validateModelOutput({ sessions: [{ exercises: [{ exerciseId: "fabricado" }, { exerciseId: candidates[0].libraryId || candidates[0].id }] }] }, candidates, app.F.state.profile, null), /ausente ou incompatível/);

  const advanced = Object.assign({}, app.F.state.profile, { nivel: "avancado", experienciaAtual: "experiente" });
  const baseline = app.F.plan.generateLocal(advanced, null);
  const recentId = baseline.sessions[0].exercises.find(exercise => exercise.section === "main").catalogId;
  const oldHistory = app.F.state.history;
  app.F.state.history = [{ finishedAt: new Date().toISOString(), feedback: { rpe: 9 }, exercises: [{ libraryId: recentId }] }];
  const adapted = app.F.plan.generateLocal(advanced, null);
  assert.match(adapted.summary, /1 sessão\(ões\) recente/);
  assert.equal(adapted.sessions[0].exercises.filter(exercise => exercise.section === "main")[0].sets, 2,
    "RPE alto recente deve reduzir prudentemente o volume local");
  assert.notEqual(adapted.sessions[0].exercises.find(exercise => exercise.section === "main").catalogId, recentId,
    "Histórico recente deve reduzir repetição do mesmo exercício quando há alternativas catalogadas");
  app.F.state.history = oldHistory;

  app.click("#generate-plan");
  const started = Date.now();
  while (!app.$("#training-plan-preview .plan-session-card") && Date.now() - started < 3000) await wait(20);
  assert.ok(app.$("#training-plan-preview .plan-session-card"), "Falha de API sem credenciais/serviço produz o gerador local, não um plano fixo atribuído à IA");
  assert.equal(app.F.plan.read(), null, "Prévia não salva até confirmação");
  app.click("#training-plan-preview .plan-save");
  const plan = app.F.plan.read();
  assert.ok(plan && plan.sessions.length === 3);
  assert.equal(plan.engine, "rules", "Serviço sem configuração deve identificar o gerador local");
  const validIds = new Set(candidates.map(item => item.libraryId || item.id));
  for (const session of plan.sessions) for (const exercise of session.exercises) {
    assert.ok(validIds.has(exercise.catalogId), "Plano contém exercício fora do catálogo");
    const source = candidates.find(item => (item.libraryId || item.id) === exercise.catalogId);
    assert.deepEqual(exercise.muscles, source.muscles, "Grupos musculares precisam vir do catálogo");
    assert.deepEqual(exercise.equipment, source.equipment, "Equipamentos precisam vir do catálogo");
  }
  assert.equal(app.F.state.history[0].id, "historic-session", "Histórico anterior é preservado");
  const routineIds = app.F.state.routines.calisthenics.concat(app.F.state.routines.weights).map(item => item.id);
  assert.ok(routineIds.some(id => id.startsWith("forja-plan-session-")), "Sessões entram nas rotinas executáveis do app");
  const calendarTask = plan.calendarTasks[0];
  assert.ok(calendarTask);
  const tasks = app.data("forja-missoes-" + calendarTask.date);
  assert.ok(tasks.some(task => task.id === calendarTask.id), "Sessão aparece no calendário sem substituir tarefas existentes");
  app.click("#regenerate-plan");
  await wait(100);
  assert.equal(app.F.plan.read().id, plan.id, "Regenerar mantém identidade e não duplica o plano salvo até confirmação");
  assert.equal(app.F.state.history[0].id, "historic-session");
  console.log("✅ Plano: fallback local, prévia, persistência, calendário e preservação do histórico");
} finally { closeAllApps(); }

/*
  FUNC-01 — modalidade das rotinas geradas pelo plano.

  A modalidade vinha de `exercise.mode`, campo que não existe no exercício
  normalizado: todo plano era salvo como calistenia, inclusive o de um perfil de
  musculação. A fonte correta é o catálogo (`record.mode`), alcançado pelo
  vínculo `libraryId`/`catalogId` que o exercício guarda.
*/
const modalityProfile = preferencias => ({
  version: 3, updatedAt: "2026-10-01T12:00:00.000Z", objetivo: "hipertrofia",
  nivel: "intermediario", equipamento: "academia", diasPorSemana: 3, areaFoco: "corpoTodo",
  localTreino: "academia", experienciaAtual: "intermediario", equipamentos: ["academiaCompleta"],
  preferenciasTreino: preferencias, consideracoes: ["nenhuma"]
});

async function saveGeneratedPlan(preferencias) {
  const app = await boot({ "forja-perfil-v1": modalityProfile(preferencias) }, "treino/index.html");
  try {
    const profile = app.F.state.profile || {};
    const candidates = app.F.plan.compatibleCatalog(profile);
    assert.ok(candidates.length > 0, "perfil sem exercícios compatíveis");
    /* Perfil de musculação só pode sortear exercício de musculação. */
    if (preferencias.includes("musculacao") && !preferencias.includes("calistenia")) {
      assert.ok(candidates.every(record => record.mode === "weights"),
        "perfil de musculação recebeu exercício de outra modalidade");
    }
    /* Fluxo real da tela: gerar a prévia e salvar pelo botão do plano. */
    app.click("#generate-plan");
    const started = Date.now();
    while (!app.$("#training-plan-preview .plan-session-card") && Date.now() - started < 5000) await wait(20);
    assert.ok(app.$("#training-plan-preview .plan-session-card"), "prévia do plano não apareceu");
    app.click("#training-plan-preview .plan-save");
    await wait(60);
    const plan = app.F.plan.read();
    assert.ok(plan, "plano não foi salvo");
    assert.equal(plan.sessions.length, 3, "plano de 3 dias por semana");
    assert.ok(app.$("#training-plan-preview .plan-session-actions"), "ações da sessão salva não apareceram");
    assert.equal(app.$("#plan-error").hidden, true, "erro exposto na tela: " + app.text("#plan-error"));
    return { app, plan, candidates };
  } catch (error) {
    app.close();
    throw error;
  }
}

{
  const { app, plan, candidates } = await saveGeneratedPlan(["musculacao"]);
  try {
    const routines = app.F.state.routines;
    assert.equal(routines.weights.length, 3, "três rotinas de musculação, vieram " + routines.weights.length);
    assert.equal(routines.calisthenics.length, 0,
      "nenhuma rotina de calistenia para perfil de musculação, vieram " + routines.calisthenics.length);
    const stored = app.data("forja-treino-rotinas-v1");
    assert.equal(stored.weights.length, 3, "o armazenamento guarda as três em musculação");
    assert.equal(stored.calisthenics.length, 0, "o armazenamento não guardou calistenia");

    const validIds = new Set(candidates.map(item => item.libraryId || item.id));
    plan.sessions.forEach((session, index) => {
      const routine = routines.weights.find(item => item.id === "forja-plan-session-" + plan.id + "-" + index);
      assert.ok(routine, "rotina " + index + " não está em musculação");
      assert.equal(routine.modality, "weights");
      const exercises = ["warmup", "main", "abs", "finisher"].flatMap(section => routine.sections[section]);
      assert.ok(exercises.length > 0, "rotina " + index + " ficou sem exercício");
      exercises.forEach(exercise => {
        assert.ok(typeof exercise.id === "string" && exercise.id, "exercício sem identificador válido");
        assert.ok(validIds.has(exercise.libraryId), "exercício sem vínculo com o catálogo: " + exercise.libraryId);
        assert.ok(typeof exercise.name === "string" && exercise.name, "exercício sem nome");
      });
    });

    /* Depois de recarregar, a rotina continua em musculação e é a fonte da
       modalidade usada por "Iniciar sessão". */
    await app.reload();
    await wait(40);
    assert.equal(app.F.state.routines.weights.length, 3, "recarregar perdeu as rotinas de musculação");
    assert.equal(app.F.state.routines.calisthenics.length, 0, "recarregar trouxe rotina de calistenia");
    assert.ok(app.$("#training-plan-preview .plan-session-actions"), "plano salvo não voltou na prévia");

    const start = app.$("#training-plan-preview .plan-session-actions .primary-button");
    assert.ok(start, "botão de iniciar sessão do plano não apareceu");
    app.click(start);
    await wait(60);
    const active = app.F.state.activeWorkout;
    assert.ok(active, "sessão não iniciou");
    assert.equal(active.modality, "weights", "sessão iniciou em " + active.modality);
    assert.equal(active.routineId, "forja-plan-session-" + plan.id + "-0");
    assert.ok(active.queue.length > 0, "sessão sem exercícios");
  } finally { app.close(); }
  console.log("✅ FUNC-01: plano de musculação salva três rotinas em weights e inicia a sessão correta");
}

{
  const { app } = await saveGeneratedPlan(["calistenia"]);
  try {
    const routines = app.F.state.routines;
    assert.equal(routines.calisthenics.length, 3, "três rotinas de calistenia, vieram " + routines.calisthenics.length);
    assert.equal(routines.weights.length, 0, "nenhuma rotina de musculação para perfil de calistenia");
    const start = app.$("#training-plan-preview .plan-session-actions .primary-button");
    app.click(start);
    await wait(60);
    assert.equal(app.F.state.activeWorkout.modality, "calisthenics", "calistenia regrediu");
  } finally { app.close(); }
  console.log("✅ FUNC-01: plano de calistenia continua em calisthenics");
}
