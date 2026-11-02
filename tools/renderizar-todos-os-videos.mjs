#!/usr/bin/env node
/*
  FORJA — renderiza TODOS os vídeos das demonstrações de exercício
  (14 exercícios com clipe exato × 2 personagens = 28 MP4).

  Reusa o mesmo pipeline de `tools/renderizar-videos-3d.mjs`:
  - personagem oficial (masculino/feminino) + clipe próprio do exercício;
  - enquadramento 3/4 fixo (azimute -58°, elevação 22°, corpo inteiro, margem 9%);
  - 1280 × 720, 30 FPS, H.264 yuv420p, sem áudio, loop;
  - verificação de especificação via tools/lib/probe-mp4.mjs.

  Saída: assets/videos/exercicios/<exercicioId>-<personagem>-horizontal-16x9.mp4
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(".");
const lerJSON = arquivo => JSON.parse(fs.readFileSync(arquivo, "utf8"));

const catalogo = lerJSON(path.join(raiz, "assets", "3d", "catalogo.json"));
const apresentacao = lerJSON(path.join(raiz, "assets", "3d", "apresentacao-exercicios.json"));

const DIR_VIDEOS = path.join(raiz, "assets", "videos", "exercicios");
fs.mkdirSync(DIR_VIDEOS, { recursive: true });

/* Exercícios com clipe EXATO (apenas estes recebem vídeo próprio). */
const exerciciosComClipe = apresentacao.exercicios
  .filter(item => item.clipeId && item.clipeQualidade === "exact")
  .map(item => ({ id: item.id, clipeId: item.clipeId }));

console.log("Exercícios com clipe exato:", exerciciosComClipe.length);
exerciciosComClipe.forEach(e => console.log("  ", e.id, "→", e.clipeId));

/* Importa o renderizador como função. Para evitar recarregar o three a cada
   exercício, encapsulamos a lógica por cópia do arquivo via import dinâmico
   não é possível parametrizar; então rodamos o renderizador por processo.
   Mais simples e robusto: invocar `node tools/renderizar-videos-3d.mjs` por
   combinação. O custo de inicialização (~1s) é aceitável para 28 vídeos. */

import { execFileSync } from "node:child_process";

let ok = 0;
let falhou = 0;
for (const personagem of ["masculino", "feminino"]) {
  for (const { id, clipeId } of exerciciosComClipe) {
    const saida = path.join(DIR_VIDEOS, `${id}-${personagem}-horizontal-16x9.mp4`);
    console.log(`\n### ${id} — ${personagem} (clipe ${clipeId})`);
    try {
      execFileSync(process.execPath, [
        path.join(raiz, "tools", "renderizar-videos-3d.mjs"),
        "--personagem", personagem,
        "--clipe", clipeId,
        "--saida", saida,
      ], { stdio: "inherit", timeout: 600000, cwd: raiz });
      ok += 1;
      console.log("   ✅ OK");
    } catch (erro) {
      falhou += 1;
      console.error("   ❌ FALHOU:", erro && erro.message);
    }
  }
}

console.log(`\nResultado: ${ok} OK, ${falhou} falhas de ${exerciciosComClipe.length * 2}.`);

/* Relatório final de especificação de cada MP4 gerado. */
const { lerMP4 } = await import(path.join(raiz, "tools", "lib", "probe-mp4.mjs"));
const problemas = [];
for (const personagem of ["masculino", "feminino"]) {
  for (const { id } of exerciciosComClipe) {
    const arquivo = path.join(DIR_VIDEOS, `${id}-${personagem}-horizontal-16x9.mp4`);
    if (!fs.existsSync(arquivo)) { problemas.push(arquivo + " (ausente)"); continue; }
    const meta = lerMP4(arquivo);
    const erro = [];
    if (meta.largura !== 1280 || meta.altura !== 720) erro.push(`res ${meta.largura}x${meta.altura}`);
    if (meta.fps === null || Math.abs(meta.fps - 30) > 0.05) erro.push(`fps ${meta.fps}`);
    if (meta.proporcao === null || Math.abs(meta.proporcao - 16 / 9) > 0.002) erro.push(`prop ${meta.proporcao}`);
    if (meta.temAudio) erro.push("audio");
    if (!meta.temVideo) erro.push("sem-video");
    if (erro.length) problemas.push(`${arquivo}: ${erro.join(", ")}`);
    else console.log(`   ✔ ${path.relative(raiz, arquivo)} ${meta.bytes} B ${meta.fps} fps`);
  }
}
if (problemas.length) {
  console.log("\nProblemas de especificação:");
  problemas.forEach(p => console.log("  -", p));
  process.exit(1);
}
console.log("\nTodos os 28 MP4 atendem à especificação 1280×720 @30 FPS 16:9 sem áudio.");
