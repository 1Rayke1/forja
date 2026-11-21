/*
  Testes da instrumentação diagnóstica temporária (forja-auth-diagnostics.js).

  Garantias verificadas:
  - Diagnóstico desativado não altera o comportamento do fluxo de autenticação.
  - Registros não contêm tokens, cookies, senhas ou PII.
  - Eventos são registrados na ordem correta.
  - A exportação (toJSON) funciona e respeita o formato.
  - O limite de registros é respeitado.
  - A instrumentação não cria listeners duplicados.
  - A instrumentação não altera o resultado de Promises/revalidações.

  Não simula a correção do bug: apenas valida a captura.
*/
import assert from "node:assert/strict";
import { boot, closeAllApps, assertNoErrors } from "./helpers/harness.mjs";
import { AUTH_STORAGE_KEY, USERS } from "./helpers/auth-fixture.mjs";

const MAX_EVENTS = 2000;
const SENSITIVE_PATTERNS = [
  "access_token", "refresh_token", "Bearer", "bearer ", "sb-", "pkce",
  "code_verifier", "token_type", "apikey", "api_key", "service_role",
  "sb_secret", "password", "senha"
];

let passed = 0, failed = 0;
async function test(name, task) {
  try { await task(); passed += 1; console.log("✅ DIAG " + name); }
  catch (error) { failed += 1; console.error("❌ DIAG " + name + "\n   " + (error && error.message)); }
}
const wait = async ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  await test('1. Diagnóstico desativado não altera o comportamento do fluxo', async () => {
    const app = await boot();
    assert.ok(app.w.ForjaDiagnostics, "módulo de diagnóstico presente");
    assert.equal(app.w.ForjaDiagnostics.isEnabled(), false, "captura deve começar desativada");
    // Aguardar a conclusão do fluxo (same helper da suíte auth).
    if (app.F.authData?.userId) await app.F.auth.revalidate();
    const deadline = Date.now() + 6000;
    while (app.d.documentElement.dataset.forjaAuth !== "ready" && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.equal(app.d.documentElement.dataset.forjaAuth, "ready");
    assert.equal(app.F.auth.isVerified(), true);
    assert.equal(app.w.ForjaDiagnostics.count(), 0, "sem registros quando desativado");
    assertNoErrors(app, "diag desativado");
    app.close();
  });

  await test('2. Ativação explícita registra eventos e permite desativar', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    assert.equal(app.w.ForjaDiagnostics.isEnabled(), true);
    assert.ok(app.w.ForjaDiagnostics.count() > 0, "registros criados após ativação");
    app.w.ForjaDiagnostics.disable();
    assert.equal(app.w.ForjaDiagnostics.isEnabled(), false);
    assertNoErrors(app, "ativação");
    app.close();
  });

  await test('3. Registros não contêm tokens, cookies ou credenciais', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    // Disparar eventos que tocam os pontos instrumentado.
    app.w.dispatchEvent(new app.w.PageTransitionEvent("pagehide", { persisted: true }));
    app.w.dispatchEvent(new app.w.PageTransitionEvent("pageshow", { persisted: true }));
    app.d.dispatchEvent(new app.w.Event("visibilitychange"));
    app.w.ForjaDiagnostics.record("diag:manual", { nota: "teste" });
    const records = JSON.parse(app.w.ForjaDiagnostics.toJSON()).records;
    assert.ok(records.length > 0);
    for (const record of records) {
      const text = JSON.stringify(record);
      for (const pattern of SENSITIVE_PATTERNS) {
        assert.ok(!text.includes(pattern), "registro com dado sensível ('" + pattern + "'): " + text.slice(0, 200));
      }
    }
    assertNoErrors(app, "sensibilidade");
    app.close();
  });

  await test('4. Eventos são registrados na ordem correta', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    app.w.dispatchEvent(new app.w.PageTransitionEvent("pagehide", { persisted: true }));
    app.d.dispatchEvent(new app.w.Event("visibilitychange"));
    app.w.dispatchEvent(new app.w.PageTransitionEvent("pageshow", { persisted: true }));
    const events = JSON.parse(app.w.ForjaDiagnostics.toJSON()).records.map(r => r.event);
    assert.ok(events.includes("guard:pagehide"), "pagehide registrado");
    assert.ok(events.includes("auth:visibilitychange"), "visibilitychange registrado");
    assert.ok(events.includes("guard:pageshow"), "pageshow registrado");
    // Ordem relativa: pagehide vem antes de pageshow.
    const idxHide = events.indexOf("guard:pagehide");
    const idxShow = events.indexOf("guard:pageshow");
    assert.ok(idxHide >= 0 && idxShow >= 0 && idxHide < idxShow, "ordem pagehide < pageshow");
    assertNoErrors(app, "ordem");
    app.close();
  });

  await test('5. Exportação (toJSON) funciona e tem o formato esperado', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.record("diag:export-test", {});
    const json = app.w.ForjaDiagnostics.toJSON();
    const parsed = JSON.parse(json);
    assert.equal(parsed.diagnostics, "forja-auth-diagnostics");
    assert.equal(typeof parsed.enabled, "boolean");
    assert.equal(typeof parsed.eventCount, "number");
    assert.ok(Array.isArray(parsed.records));
    assert.equal(parsed.eventCount, parsed.records.length);
    assertNoErrors(app, "exportação");
    app.close();
  });

  await test('6. Limite de registros é respeitado', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    for (let i = 0; i < MAX_EVENTS + 500; i += 1) {
      app.w.ForjaDiagnostics.record("diag:fill", { i });
    }
    assert.ok(app.w.ForjaDiagnostics.count() <= MAX_EVENTS, "contagem deve respeitar o limite");
    const json = JSON.parse(app.w.ForjaDiagnostics.toJSON());
    assert.ok(json.records.length <= MAX_EVENTS);
    assertNoErrors(app, "limite");
    app.close();
  });

  await test('7. Instrumentação não cria listeners duplicados', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    // Disparar o mesmo evento várias vezes: cada disparo deve gerar exatamente
    // um registro (não dois por listener duplicado).
    const N = 5;
    for (let i = 0; i < N; i += 1) {
      app.d.dispatchEvent(new app.w.Event("visibilitychange"));
    }
    const records = JSON.parse(app.w.ForjaDiagnostics.toJSON()).records;
    const count = records.filter(r => r.event === "auth:visibilitychange").length;
    assert.equal(count, N, "cada disparo deve registrar exatamente uma vez (sem listener duplicado)");
    assertNoErrors(app, "listeners");
    app.close();
  });

  await test('8. Instrumentação não altera o resultado de revalidações', async () => {
    // Com diagnóstico desativado.
    const appOff = await boot();
    const resultOff = await appOff.F.auth.revalidate();
    const verifiedOff = appOff.F.auth.isVerified();
    const gateOff = appOff.d.documentElement.dataset.forjaAuth;
    appOff.close();

    // Com diagnóstico ativado.
    const appOn = await boot();
    appOn.w.ForjaDiagnostics.enable();
    const resultOn = await appOn.F.auth.revalidate();
    const verifiedOn = appOn.F.auth.isVerified();
    const gateOn = appOn.d.documentElement.dataset.forjaAuth;

    assert.equal(resultOn && resultOn.id, resultOff && resultOff.id, "revalidate retorno igual");
    assert.equal(verifiedOn, verifiedOff, "isVerified igual");
    assert.equal(gateOn, gateOff, "gate igual");
    assertNoErrors(appOn, "resultado");
    appOn.close();
  });

  await test('9. LIMITES e helpers de diagnóstico estão coerentes', async () => {
    const app = await boot();
    const diag = app.w.ForjaDiagnostics;
    assert.equal(typeof diag.record, "function");
    assert.equal(typeof diag.enable, "function");
    assert.equal(typeof diag.disable, "function");
    assert.equal(typeof diag.clear, "function");
    assert.equal(typeof diag.toJSON, "function");
    assert.equal(typeof diag.count, "function");
    assert.equal(typeof diag.listenerSummary, "function");
    diag.clear();
    assert.equal(diag.count(), 0, "clear zera os registros");
    app.close();
  });
} finally {
  closeAllApps();
}

console.log("\nDIAG — " + passed + "/" + (passed + failed) + " testes aprovados.");
if (failed > 0) process.exit(1);
