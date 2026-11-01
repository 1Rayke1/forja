#!/usr/bin/env node
/*
  FORJA — auditoria da integração 3D.

  Lê o que foi REALMENTE publicado (assets/3d/catalogo.json + arquivos no disco),
  cruza com a biblioteca de exercícios do app e com o peso do runtime, e escreve
  `docs/assets-3d/relatorio-integracao-3d.json`. Nada é inferido: cada número
  vem de um arquivo existente.

  Uso: node tools/auditar-integracao-3d.mjs
*/
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = rel => fs.readFileSync(path.join(raiz, rel), "utf8");
const existe = rel => fs.existsSync(path.join(raiz, rel));
const bytes = rel => (existe(rel) ? fs.statSync(path.join(raiz, rel)).size : null);

const catalogo = JSON.parse(ler("assets/3d/catalogo.json"));

/* ------------------------------------------------------------------ */
/* Personagens e clipes                                                */
/* ------------------------------------------------------------------ */

const personagens = Object.entries(catalogo.personagens).map(([id, dados]) => ({
  id,
  arquivo: dados.arquivo,
  existe: existe(dados.arquivo),
  bytes: bytes(dados.arquivo),
  ossos: dados.ossos,
  vertices: dados.vertices,
  poligonos: dados.poligonos,
  alturaM: dados.alturaM,
  materiais: dados.materiais.length
}));

const clipes = catalogo.clipes.map(clipe => ({
  id: clipe.id,
  arquivo: clipe.arquivo,
  existe: existe(clipe.arquivo),
  bytes: bytes(clipe.arquivo),
  duracaoS: clipe.duracaoS,
  status: clipe.status,
  retarget: clipe.retarget,
  rigOrigem: clipe.rigOrigem,
  exercicios: clipe.exercicios
}));

/* ------------------------------------------------------------------ */
/* Cobertura da biblioteca do app                                      */
/* ------------------------------------------------------------------ */

const fonteBiblioteca = ler("assets/js/forja-biblioteca.js");
const idsBiblioteca = [...new Set(
  [...fonteBiblioteca.matchAll(/item\("([a-z]+-[a-z0-9-]+)"/g)].map(m => m[1])
)];
const cobertos = idsBiblioteca.filter(id => catalogo.exercicios[id]);
const descobertos = idsBiblioteca.filter(id => !catalogo.exercicios[id]);

/* ------------------------------------------------------------------ */
/* Runtime servido ao navegador                                        */
/* ------------------------------------------------------------------ */

const runtime = [
  "assets/vendor/three/three.module.min.js",
  "assets/vendor/three/three.core.min.js",
  "assets/vendor/three/addons/loaders/GLTFLoader.js",
  "assets/vendor/three/addons/utils/BufferGeometryUtils.js",
  "assets/js/forja-3d-cena.js",
  "assets/js/forja-personagens.js",
  "assets/css/personagens-3d.css"
].map(arquivo => ({ arquivo, bytes: bytes(arquivo) }));

const gzip = arquivo => zlib.gzipSync(fs.readFileSync(path.join(raiz, arquivo))).length;

const primeiraAbertura = {
  /* o que o navegador baixa na primeira demonstração: módulo + personagem + clipe */
  tres: runtime[0].bytes + runtime[1].bytes + runtime[2].bytes + runtime[3].bytes,
  ponte: runtime[4].bytes + runtime[5].bytes,
  personagem: personagens[0].bytes,
  clipeTipico: Math.round(clipes.reduce((soma, c) => soma + c.bytes, 0) / clipes.length)
};
primeiraAbertura.total = primeiraAbertura.tres + primeiraAbertura.ponte +
  primeiraAbertura.personagem + primeiraAbertura.clipeTipico;

const relatorio = {
  geradoEm: new Date().toISOString(),
  formatoCatalogo: catalogo.formato,
  personagens,
  clipes: {
    total: clipes.length,
    publicados: clipes.filter(c => c.existe).length,
    semArquivo: clipes.filter(c => !c.existe).map(c => c.id),
    exatos: clipes.filter(c => c.status === "exact").length,
    aproximados: clipes.filter(c => c.status === "review").length,
    retargetados: clipes.filter(c => c.retarget).length,
    bytes: clipes.reduce((soma, c) => soma + (c.bytes || 0), 0),
    duracaoTotalS: Number(clipes.reduce((soma, c) => soma + (c.duracaoS || 0), 0).toFixed(1)),
    porFonte: clipes.reduce((acc, clipe) => {
      const chave = clipe.retarget ? "mocap retargetado" : "DeskBreak (mesmo rig)";
      acc[chave] = (acc[chave] || 0) + 1;
      return acc;
    }, {})
  },
  coberturaBiblioteca: {
    exerciciosSugeridos: idsBiblioteca.length,
    comClipe3d: cobertos.length,
    semClipe3d: descobertos,
    percentual: Number(((cobertos.length / idsBiblioteca.length) * 100).toFixed(1)),
    /* todo exercício sem clipe próprio ainda recebe fallback por grupo muscular */
    fallbackPorGrupo: catalogo.fallbackPorGrupo
  },
  runtime: {
    arquivos: runtime,
    totalBytes: runtime.reduce((soma, item) => soma + item.bytes, 0),
    threeGzipBytes: gzip("assets/vendor/three/three.module.min.js")
  },
  primeiraAbertura
};

fs.mkdirSync(path.join(raiz, "docs/assets-3d"), { recursive: true });
fs.writeFileSync(path.join(raiz, "docs/assets-3d/relatorio-integracao-3d.json"),
  JSON.stringify(relatorio, null, 2) + "\n");

/* ------------------------------------------------------------------ */
/* Resumo no terminal                                                  */
/* ------------------------------------------------------------------ */

const kb = valor => (valor / 1024).toFixed(0) + " KB";
console.log("PERSONAGENS");
personagens.forEach(personagem => console.log(
  `  ${personagem.id.padEnd(10)} ${personagem.existe ? "OK   " : "FALTA"} ${kb(personagem.bytes)} ` +
  `${personagem.ossos} ossos · ${personagem.poligonos} polígonos · ${personagem.alturaM} m`
));
console.log("CLIPES");
console.log(`  publicados ${relatorio.clipes.publicados}/${relatorio.clipes.total} · ` +
  `${relatorio.clipes.exatos} exatos, ${relatorio.clipes.aproximados} aproximados · ` +
  kb(relatorio.clipes.bytes) + " no total");
console.log("COBERTURA");
console.log(`  ${relatorio.coberturaBiblioteca.comClipe3d}/${idsBiblioteca.length} exercícios ` +
  `sugeridos com clipe próprio (${relatorio.coberturaBiblioteca.percentual}%)`);
if (descobertos.length) console.log("  sem clipe próprio: " + descobertos.join(", "));
console.log("RUNTIME");
console.log(`  ${kb(relatorio.runtime.totalBytes)} no total · three.js ${kb(relatorio.runtime.threeGzipBytes)} gzip`);
console.log(`  primeira demonstração ≈ ${kb(primeiraAbertura.total)} ` +
  `(three ${kb(primeiraAbertura.tres)} + ponte ${kb(primeiraAbertura.ponte)} + ` +
  `personagem ${kb(primeiraAbertura.personagem)} + clipe ${kb(primeiraAbertura.clipeTipico)})`);

if (personagens.some(p => !p.existe) || clipes.some(c => !c.existe)) {
  console.error("\nERRO: catálogo aponta para arquivo inexistente.");
  process.exit(1);
}
