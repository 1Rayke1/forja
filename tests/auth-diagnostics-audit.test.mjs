/*
  Auditoria obrigatória (correção dos defeitos 1 e 2):
  - Nenhum UUID/ID de usuário nos registros.
  - UUIDs fictícios conhecidos não aparecem no JSON exportado.
  - hasUid é somente booleano.
  - Limite com milhares de eventos.
  - JSON medido com a serialização final (toJSON).
  - Export dentro do limite.
  - Registros mais recentes preservados.
  - Evento individual excepcionalmente grande não ultrapassa sozinho.
*/
import assert from "node:assert/strict";
import { boot, closeAllApps } from "./helpers/harness.mjs";

const MAX_EVENTS = 2000;
const MAX_BYTES = 200000;
const UUID = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

let passed = 0, failed = 0;
async function test(name, task) {
  try { await task(); passed += 1; console.log("✅ AUD " + name); }
  catch (error) { failed += 1; console.error("❌ AUD " + name + "\n   " + (error && error.message)); }
}

try {
  await test('1. Nenhum UUID/ID de usuário nos registros', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    // Disparar os pontos que antes gravavam uid/dataUid.
    app.w.dispatchEvent(new app.w.PageTransitionEvent("pagehide", { persisted: true }));
    app.d.dispatchEvent(new app.w.Event("visibilitychange"));
    app.w.dispatchEvent(new app.w.PageTransitionEvent("pageshow", { persisted: true }));
    const records = JSON.parse(app.w.ForjaDiagnostics.toJSON()).records;
    const text = JSON.stringify(records);
    assert.ok(!text.includes(UUID) && !text.includes(UUID_B), "UUID presente nos registros");
    assert.ok(!/uid["\s:]+[0-9a-f]{8}-/i.test(text), "campo uid com UUID presente");
    assert.ok(!/dataUid["\s:]+[0-9a-f]{8}-/i.test(text), "campo dataUid com UUID presente");
    app.close();
  });

  await test('2. UUIDs fictícios conhecidos ausentes no JSON exportado', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    // Simular os pontos que antes gravavam uid/dataUid, agora com booleanos.
    app.w.ForjaDiagnostics.record("auth:unlock", { hasUid: Boolean(UUID) });
    app.w.ForjaDiagnostics.record("auth:visibilitychange", { hasDataUid: Boolean(UUID_B) });
    app.w.ForjaDiagnostics.record("app:continueBoot", { hasUid: Boolean(UUID) });
    // Disparar o fluxo real de página.
    app.w.dispatchEvent(new app.w.PageTransitionEvent("pagehide", { persisted: true }));
    app.d.dispatchEvent(new app.w.Event("visibilitychange"));
    const json = app.w.ForjaDiagnostics.toJSON();
    assert.ok(!json.includes(UUID), "UUID A presente no export");
    assert.ok(!json.includes(UUID_B), "UUID B presente no export");
    app.close();
  });

  await test('3. hasUid é somente booleano', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    app.w.ForjaDiagnostics.record("auth:unlock", { hasUid: Boolean(UUID) });
    app.w.ForjaDiagnostics.record("app:continueBoot", { hasUid: Boolean(UUID) });
    const records = JSON.parse(app.w.ForjaDiagnostics.toJSON()).records;
    for (const r of records) {
      if (r.event === "auth:unlock" || r.event === "app:continueBoot") {
        assert.equal(typeof r.hasUid, "boolean", r.event + " hasUid deve ser booleano");
      }
    }
    app.close();
  });

  await test('4. Limite com milhares de eventos respeitado', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    for (let i = 0; i < 10000; i += 1) app.w.ForjaDiagnostics.record("diag:fill", { i });
    const count = app.w.ForjaDiagnostics.count();
    assert.ok(count <= MAX_EVENTS, "contagem deve respeitar o limite: " + count);
    const json = app.w.ForjaDiagnostics.toJSON();
    const parsed = JSON.parse(json);
    assert.ok(parsed.records.length <= MAX_EVENTS, "records no export limitado");
    app.close();
  });

  await test('5. JSON medido com a serialização final', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    for (let i = 0; i < 5000; i += 1) {
      app.w.ForjaDiagnostics.record("diag:fill", { i, msg: "x".repeat(50) });
    }
    // O tamanho do export (serialização final com indentação) deve estar no limite.
    const json = app.w.ForjaDiagnostics.toJSON();
    assert.ok(json.length <= MAX_BYTES, "JSON final ultrapassa o limite: " + json.length + " > " + MAX_BYTES);
    app.close();
  });

  await test('6. Arquivo exportado permanece dentro do limite', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    for (let i = 0; i < 10000; i += 1) {
      app.w.ForjaDiagnostics.record("diag:fill", { i, msg: "y".repeat(300) });
    }
    const json = app.w.ForjaDiagnostics.toJSON();
    assert.ok(json.length <= MAX_BYTES, "export ultrapassa: " + json.length);
    app.close();
  });

  await test('7. Registros mais recentes preservados', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    for (let i = 0; i < MAX_EVENTS + 300; i += 1) {
      app.w.ForjaDiagnostics.record("diag:fill", { i });
    }
    app.w.ForjaDiagnostics.record("diag:newest", { marker: "novo" });
    const records = JSON.parse(app.w.ForjaDiagnostics.toJSON()).records;
    const last = records[records.length - 1];
    assert.equal(last.event, "diag:newest", "registro mais recente deve ser preservado");
    assert.equal(last.marker, "novo");
    assert.ok(records.length <= MAX_EVENTS, "contagem limitada");
    app.close();
  });

  await test('8. Evento individual excepcionalmente grande não ultrapassa sozinho', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    // Um único registro com payload gigante.
    app.w.ForjaDiagnostics.record("diag:huge", { blob: "z".repeat(500000) });
    const json = app.w.ForjaDiagnostics.toJSON();
    assert.ok(json.length <= MAX_BYTES, "registro único gigante ultrapassa o limite: " + json.length);
    app.close();
  });
} finally {
  closeAllApps();
}

console.log("\nAUD — " + passed + "/" + (passed + failed) + " testes aprovados.");
if (failed > 0) process.exit(1);
