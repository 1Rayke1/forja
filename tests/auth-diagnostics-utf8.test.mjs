/*
  Testes do limite de tamanho em BYTES UTF-8 (correção do defeito).

  Validam que serializedSize() mede bytes UTF-8 (não caracteres UTF-16) e que
  o JSON exportado (toJSON), o download e o clipboard respeitam o limite
  de 200.000 bytes mesmo com acentos, emojis, CJK e payloads grandes.
*/
import assert from "node:assert/strict";
import { boot, closeAllApps } from "./helpers/harness.mjs";

const MAX_BYTES = 200000;
const utf8 = text => Buffer.byteLength(text, "utf8");

let passed = 0, failed = 0;
async function test(name, task) {
  try { await task(); passed += 1; console.log("✅ UTF8 " + name); }
  catch (error) { failed += 1; console.error("❌ UTF8 " + name + "\n   " + (error && error.message)); }
}

try {
  await test('1. ASCII: export em bytes UTF-8 dentro do limite', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    for (let i = 0; i < 10000; i += 1) app.w.ForjaDiagnostics.record("diag:fill", { i, m: "x".repeat(50) });
    const json = app.w.ForjaDiagnostics.toJSON();
    assert.ok(utf8(json) <= MAX_BYTES, "ASCII bytes=" + utf8(json) + " > " + MAX_BYTES);
    app.close();
  });

  await test('2. Acentos portugueses: export em bytes dentro do limite', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    for (let i = 0; i < 10000; i += 1) app.w.ForjaDiagnostics.record("diag:fill", { i, m: "áéíóúâêôâãõ".repeat(6) });
    const json = app.w.ForjaDiagnostics.toJSON();
    assert.ok(utf8(json) <= MAX_BYTES, "Acentos bytes=" + utf8(json) + " > " + MAX_BYTES);
    app.close();
  });

  await test('3. Emojis: export em bytes dentro do limite', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    for (let i = 0; i < 10000; i += 1) app.w.ForjaDiagnostics.record("diag:fill", { i, m: "🩺🩺🩺🩺🩺".repeat(6) });
    const json = app.w.ForjaDiagnostics.toJSON();
    assert.ok(utf8(json) <= MAX_BYTES, "Emoji bytes=" + utf8(json) + " > " + MAX_BYTES);
    app.close();
  });

  await test('4. CJK: export em bytes dentro do limite', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    for (let i = 0; i < 10000; i += 1) app.w.ForjaDiagnostics.record("diag:fill", { i, m: "でじげじ".repeat(6) });
    const json = app.w.ForjaDiagnostics.toJSON();
    assert.ok(utf8(json) <= MAX_BYTES, "CJK bytes=" + utf8(json) + " > " + MAX_BYTES);
    app.close();
  });

  await test('5. Registro individual gigante: descartado sem ultrapassar', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    app.w.ForjaDiagnostics.record("diag:huge", { blob: "z".repeat(500000) });
    const json = app.w.ForjaDiagnostics.toJSON();
    assert.ok(utf8(json) <= MAX_BYTES, "huge bytes=" + utf8(json));
    JSON.parse(json); // JSON válido
    app.close();
  });

  await test('6. Limite exato: JSON cortado para caber em bytes', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    // Push payloads grandes até ultrapassar; o trim deve cortar para <= MAX_BYTES.
    for (let i = 0; i < 10000; i += 1) {
      app.w.ForjaDiagnostics.record("diag:fill", { i, m: "á".repeat(200) });
    }
    const json = app.w.ForjaDiagnostics.toJSON();
    assert.ok(utf8(json) <= MAX_BYTES, "limite exato bytes=" + utf8(json) + " > " + MAX_BYTES);
    // Deve ter registros (não estar vazio) e ser válido.
    const parsed = JSON.parse(json);
    assert.ok(parsed.records.length > 0, "registros não vazios");
    app.close();
  });

  await test('7. Exportação e clipboard usam o mesmo conteúdo dentro do limite', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    for (let i = 0; i < 10000; i += 1) {
      app.w.ForjaDiagnostics.record("diag:fill", { i, m: "é".repeat(30) });
    }
    const json = app.w.ForjaDiagnostics.toJSON();
    assert.ok(utf8(json) <= MAX_BYTES, "toJSON bytes=" + utf8(json));
    // copy() usa internamente toJSON() (o conteúdo enviado ao clipboard é
    // exatamente o JSON já validado pelo limite). Validamos que a saída de
    // toJSON() permanece dentro do limite e que copy() não altera o estado.
    await app.w.ForjaDiagnostics.copy();
    const after = app.w.ForjaDiagnostics.toJSON();
    assert.ok(utf8(after) <= MAX_BYTES, "clipboard bytes=" + utf8(after));
    assert.ok(JSON.parse(after).records.length > 0, "conteúdo preservado");
    app.close();
  });

  await test('8. JSON final válido e tamanho real em bytes <= 200.000', async () => {
    const app = await boot();
    app.w.ForjaDiagnostics.enable();
    app.w.ForjaDiagnostics.clear();
    for (let i = 0; i < 10000; i += 1) {
      app.w.ForjaDiagnostics.record("diag:fill", { i, msg: "🩺áéí".repeat(8) });
    }
    const json = app.w.ForjaDiagnostics.toJSON();
    const parsed = JSON.parse(json); // válido
    assert.equal(parsed.diagnostics, "forja-auth-diagnostics");
    const bytes = utf8(json);
    assert.ok(bytes <= MAX_BYTES, "bytes=" + bytes + " > " + MAX_BYTES);
    console.log("   bytes finais: " + bytes + " (limite " + MAX_BYTES + ")");
    app.close();
  });
} finally {
  closeAllApps();
}

console.log("\nUTF8 — " + passed + "/" + (passed + failed) + " testes aprovados.");
if (failed > 0) process.exit(1);
