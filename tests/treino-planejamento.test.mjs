import assert from "node:assert/strict";
import { boot, closeAllApps } from "./helpers/harness.mjs";

const profile = { version:3, updatedAt:"2026-11-08T12:00:00.000Z", objetivo:"hipertrofia", nivel:"intermediario", equipamento:"academia", diasPorSemana:4, areaFoco:"corpoTodo", localTreino:"academia", experienciaAtual:"experiente", equipamentos:["academiaCompleta"], preferenciasTreino:["musculacao","calistenia"], consideracoes:["nenhuma"] };
const app = await boot({ "forja-perfil-v1":profile }, "treino/index.html");
try {
  assert.equal(app.$("#training-plan-heading").textContent, "Seu plano semanal");
  assert.ok(app.$("#preferences-heading"));
  assert.ok(app.$("#hub-routine-list"));
  assert.equal(app.$$(".bottom-nav-link").length, 5);

  app.click('[data-pref="goal"][data-value="emagrecer"]');
  app.click('[data-pref="level"][data-value="avancado"]');
  app.click('[data-pref="days"][data-value="5"]');
  app.click('[data-pref="time"][data-value="short"]');
  app.click('[data-pref="equipment"][data-value="none"]');
  const prefs = app.data("forja-planejamento-preferencias-v1");
  assert.deepEqual(prefs, { goal:"emagrecer", level:"avancado", days:5, time:"short", equipment:"none" });
  for (const key of ["goal","level","days","time","equipment"]) {
    assert.equal(app.$(`[data-pref="${key}"][aria-pressed="true"]`).getAttribute("data-value"), String(prefs[key]));
  }

  const noGearProfile = app.F.plan.profileForPreferences(prefs);
  const noGear = app.F.plan.compatibleCatalog(noGearProfile);
  assert.ok(noGear.every(item => Array.isArray(item.equipment) && item.equipment.length === 0), "Sem equipamento deve aceitar somente equipment: [] no catálogo");
  app.click("#generate-plan");
  assert.match(app.text("#plan-error"), /compatíveis|compatível/i, "Sem opções seguras, a interface informa em vez de inserir equipamento");
  assert.equal(app.F.plan.read(), null, "Erro de compatibilidade não cria nem salva plano");

  app.click('[data-pref="equipment"][data-value="gym"]');
  app.click('[data-pref="days"][data-value="4"]');
  app.click('[data-pref="time"][data-value="medium"]');
  app.click("#generate-plan");
  const preview = app.$$("#training-plan-preview .plan-session-card");
  assert.equal(preview.length, 4, "A prévia respeita os dias solicitados");
  assert.equal(app.F.plan.read(), null, "Prévia exige confirmação explícita");
  const plan = app.F.plan.generateLocal(app.F.plan.profileForPreferences(app.data("forja-planejamento-preferencias-v1")), null);
  assert.equal(new Set(plan.sessions.map(item => item.day)).size, 4, "Sessões distribuídas em dias diferentes");
  assert.equal(7 - new Set(plan.sessions.map(item => item.day)).size, 3, "Os demais dias são recuperação/descanso");
  for (const count of [2,3,4,5,6]) assert.equal(app.F.plan.trainingDays(count).length, count, "Distribuição deve respeitar " + count + " dias");
  const cardioPlan = app.F.plan.generateLocal(app.F.plan.profileForPreferences({ goal:"condicionamento", level:"intermediario", days:3, time:"medium", equipment:"gym" }), null);
  assert.ok(cardioPlan.sessions.every(session => session.exercises.length > 0), "Objetivo de condicionamento produz sessões reais");
  const catalogIds = new Set(app.F.catalog.items().map(item => item.libraryId || item.id));
  for (const session of plan.sessions) for (const exercise of session.exercises) {
    assert.ok(catalogIds.has(exercise.catalogId), "ID catalogado original preservado");
    assert.ok(exercise.sets >= 1 && exercise.sets <= 5, "Volume por exercício fica em limites moderados");
  }
  assert.ok(app.$("#training-plan-preview .week-schedule"), "A revisão apresenta treino e recuperação na semana");
  assert.ok(app.$("#training-plan-preview .plan-save"), "A revisão oferece salvamento explícito");
  const replacement = app.$("#training-plan-preview select[aria-label^='Substituir']");
  if (replacement && replacement.options.length > 1) {
    replacement.value = replacement.options[1].value;
    replacement.dispatchEvent(new app.w.Event("change", { bubbles:true }));
  }
  const setsInput = app.$("#training-plan-preview input[aria-label^='Séries de']");
  setsInput.value = "1"; setsInput.dispatchEvent(new app.w.Event("change", { bubbles:true }));
  const removeExercise = app.$("#training-plan-preview button[aria-label^='Remover']");
  removeExercise.dispatchEvent(new app.w.MouseEvent("click", { bubbles:true }));
  app.click("#training-plan-preview .plan-save");
  const saved = app.F.plan.read();
  assert.ok(saved && saved.sessions.length === 4, "Confirmação persiste o plano");
  assert.ok(app.F.state.routines.calisthenics.concat(app.F.state.routines.weights).some(routine => routine.id.startsWith("forja-plan-session-")), "Sessões viram rotinas existentes executáveis");
  assert.ok(app.raw(app.F.KEYS.routines), "Rotinas persistidas pela chave existente");
  assert.ok(app.$$("#hub-routine-list .routine-card").length > 0, "Minhas rotinas renderiza dados reais salvos");
  console.log("✅ Planejamento: preferências, filtro estrito, dias de recuperação, revisão, IDs e persistência integrados");
} finally { closeAllApps(); }
