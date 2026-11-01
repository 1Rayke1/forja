#!/usr/bin/env node
/*
  FORJA — separa o mapa de animações em duas filas de build:

    <trabalho>/clipes-deskbreak.json  {"id", "acao"}  → exportador Blender
    <trabalho>/fila-mocap.tsv         id, fbx, quadros, deslocamento (tab)

  Não inventa clipe: só escreve o que está no mapa e só aceita as duas fontes
  auditadas (deskbreak e mocap).

  FBX de mocap ausente NÃO derruba o build: o clipe correspondente fica de fora
  da fila e é listado em `<trabalho>/mocap-pendente.json`. Assim o app entrega
  todas as animações disponíveis e o catálogo marca o resto como indisponível,
  em vez de impedir que qualquer clipe seja publicado. `--exigir-tudo` volta ao
  comportamento estrito (usado em CI quando todas as fontes já foram baixadas).
*/
import fs from "node:fs";
import path from "node:path";

const [mapaPath, saidaDir] = process.argv.slice(2);
const exigirTudo = process.argv.includes("--exigir-tudo");
if (!mapaPath || !saidaDir) {
  console.error("uso: preparar-mapa-animacoes.mjs <mapa.json> <dir-de-trabalho>");
  process.exit(2);
}

const mapa = JSON.parse(fs.readFileSync(mapaPath, "utf8"));
const fontesDir = path.resolve(path.dirname(mapaPath), "fontes-3d");
const deskbreak = [];
const mocap = [];
const mocapPendente = [];
const vistos = new Set();

for (const clipe of mapa.clipes) {
  if (vistos.has(clipe.id)) throw new Error(`id de clipe repetido: ${clipe.id}`);
  vistos.add(clipe.id);

  if (clipe.fonte === "deskbreak") {
    if (!clipe.acao) throw new Error(`clipe ${clipe.id}: falta "acao"`);
    deskbreak.push({ id: clipe.id, acao: clipe.acao });
  } else if (clipe.fonte === "mocap") {
    if (!clipe.fbx) throw new Error(`clipe ${clipe.id}: falta "fbx"`);
    const fbx = path.join(fontesDir, clipe.fbx);
    if (!fs.existsSync(fbx)) {
      if (exigirTudo) throw new Error(`FBX ausente: ${fbx}`);
      mocapPendente.push({ id: clipe.id, fbx: clipe.fbx, motivo: "FBX ausente em tools/fontes-3d" });
      continue;
    }
    mocap.push([
      clipe.id,
      fbx,
      String(clipe.quadros || 144),
      String(clipe.deslocamento || 0)
    ].join("\t"));
  } else {
    throw new Error(`clipe ${clipe.id}: fonte desconhecida "${clipe.fonte}"`);
  }
}

fs.mkdirSync(saidaDir, { recursive: true });
fs.writeFileSync(path.join(saidaDir, "clipes-deskbreak.json"),
  JSON.stringify(deskbreak, null, 2) + "\n");
fs.writeFileSync(path.join(saidaDir, "fila-mocap.tsv"), mocap.join("\n") + "\n");
fs.writeFileSync(path.join(saidaDir, "mocap-pendente.json"),
  JSON.stringify(mocapPendente, null, 2) + "\n");

console.log(`[mapa] ${deskbreak.length} clipes do manequim, ${mocap.length} clipes de mocap` +
  (mocapPendente.length ? `, ${mocapPendente.length} sem FBX (fora da fila)` : ""));
mocapPendente.forEach(pendente =>
  console.log(`[mapa] PENDENTE ${pendente.id} (${pendente.fbx})`));
