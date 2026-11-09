#!/usr/bin/env node
/* Valida e resume o catálogo sem DOM, rede ou escrita em armazenamento. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = { console };
context.globalThis = context;
vm.createContext(context);
for (const file of ["forja-exercicios-dados.js", "forja-catalogo-central.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, "assets/js", file), "utf8"), context, { filename: file });
}
const catalog = context.Forja.exerciseCatalog;
const validation = catalog.validate();
const report = catalog.report();
const args = new Set(process.argv.slice(2));

if (args.has("--json")) {
  console.log(JSON.stringify({ validation, report }, null, 2));
} else {
  const groupNames = Object.fromEntries(catalog.muscleGroups.map(group => [group.id, group.name]));
  const modeNames = Object.fromEntries(catalog.modalities.map(mode => [mode.id, mode.name]));
  console.log("FORJA — Catálogo central v" + report.schemaVersion);
  console.log("Validação: " + (validation.valid ? "OK" : "FALHOU"));
  console.log("Total: " + report.total + " exercícios");
  console.log("\nPor músculo principal:");
  Object.entries(report.byPrimaryMuscle).forEach(([id, count]) => console.log("- " + groupNames[id] + ": " + count));
  console.log("\nPor modalidade:");
  Object.entries(report.byModality).forEach(([id, count]) => console.log("- " + modeNames[id] + ": " + count));
  console.log("\nRankings: " + Object.keys(report.rankingCombinations).length + " combinações; " + report.withoutRanking.length + " sem posição");
  console.log("Registros editoriais incompletos: " + report.incomplete.length);
  console.log("Duplicações de IDs: " + report.duplicateIds.length);
  console.log("Sem imagem: " + report.withoutImage);
  console.log("Preparados para YouTube: " + report.videosPrepared);
  console.log("Vídeos validados: " + report.validatedVideos + "; pendentes: " + report.pendingVideos);
}
if (!validation.valid) {
  validation.errors.forEach(error => console.error("- " + error));
  process.exitCode = 1;
}
