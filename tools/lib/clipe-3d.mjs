#!/usr/bin/env node
/*
  FORJA — utilitários compartilhados das ferramentas 3D em Node.

  Aqui ficam duas coisas que mais de uma ferramenta precisa:

  - `escreverClipeGLB`: grava um GLB de clipe (só hierarquia de ossos +
    animação), no mesmo formato dos 40 arquivos de `assets/3d/animacoes/`;
  - `carregarPersonagem`: abre o GLB de um personagem publicado e devolve os
    ossos por nome, para qualquer ferramenta medir/transferir em cima dele.

  Nada aqui é usado pelo app: é ferramenta de build/validação.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

globalThis.self = globalThis;
globalThis.createImageBitmap = globalThis.createImageBitmap || (async () => ({ width: 2, height: 2, close() {} }));
if (typeof globalThis.URL.createObjectURL !== "function") {
  globalThis.URL.createObjectURL = () => "blob:forja-3d";
  globalThis.URL.revokeObjectURL = () => {};
}

export const THREE = await import(path.join(raiz, "assets/vendor/three/three.module.min.js"));
const { GLTFLoader } = await import(path.join(raiz, "assets/vendor/three/addons/loaders/GLTFLoader.js"));

export { raiz };

export function lerBytes(arquivo) {
  const caminho = path.isAbsolute(arquivo) ? arquivo : path.join(raiz, arquivo);
  const buffer = fs.readFileSync(caminho);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export function carregarGLB(arquivo) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(lerBytes(arquivo), "", resolve, reject);
  });
}

export const catalogo3D = () =>
  JSON.parse(fs.readFileSync(path.join(raiz, "assets/3d/catalogo.json"), "utf8"));

export async function carregarPersonagem(slug) {
  const catalogo = catalogo3D();
  const gltf = await carregarGLB(catalogo.personagens[slug].arquivo);
  const ossos = new Map();
  gltf.scene.traverse(objeto => { if (objeto.isBone) ossos.set(objeto.name, objeto); });
  return { cena: gltf.scene, ossos, gltf };
}

/* Ordem de hierarquia do rig do FORJA (pai antes de filho). */
export const HIERARQUIA = [
  ["hips", null],
  ["spine", "hips"],
  ["neck", "spine"],
  ["armL", "spine"], ["elbowL", "armL"], ["handL", "elbowL"],
  ["armR", "spine"], ["elbowR", "armR"], ["handR", "elbowR"],
  ["legL", "hips"], ["kneeL", "legL"], ["footL", "kneeL"],
  ["legR", "hips"], ["kneeR", "legR"], ["footR", "kneeR"]
];

/* ------------------------------------------------------------------ */
/* Escritor GLB (só hierarquia de ossos + animação)                    */
/* ------------------------------------------------------------------ */

export function escreverClipeGLB(dados, destino) {
  const nomes = Object.keys(dados.ossosDestino);
  const ordem = [];
  const visitar = nome => {
    ordem.push(nome);
    for (const outro of nomes) {
      if (dados.ossosDestino[outro].pai === nome) visitar(outro);
    }
  };
  visitar("hips");
  for (const nome of nomes) if (!ordem.includes(nome)) ordem.push(nome);

  const raizIdx = ordem.length;
  const indice = new Map(ordem.map((nome, i) => [nome, i]));

  const nodes = ordem.map((nome, i) => {
    const info = dados.ossosDestino[nome];
    const filhos = ordem.filter(outro => dados.ossosDestino[outro].pai === nome).map(outro => indice.get(outro));
    const node = {
      name: nome,
      translation: i === indice.get("hips") ? [0, 0, 0] : info.posicao,
      rotation: info.rotacao,
      scale: info.escala
    };
    if (filhos.length) node.children = filhos;
    return node;
  });
  nodes.push({ name: "rig", children: [indice.get("hips")] });

  /* animação */
  const bufferPartes = [];
  let offset = 0;
  const views = [];
  const accessors = [];
  const adicionar = (array, tipo, componentes) => {
    const dadosBin = new Float32Array(array);
    const bytes = Buffer.from(dadosBin.buffer, dadosBin.byteOffset, dadosBin.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    bufferPartes.push(Buffer.concat([bytes, Buffer.alloc(pad)]));
    offset += bytes.length + pad;
    accessors.push({
      bufferView: views.length - 1,
      componentType: 5126,
      count: array.length / componentes,
      type: tipo,
      min: tipo === "VEC3" ? [
        Math.min(...array.filter((_, i) => i % 3 === 0)),
        Math.min(...array.filter((_, i) => i % 3 === 1)),
        Math.min(...array.filter((_, i) => i % 3 === 2))
      ] : undefined,
      max: tipo === "VEC3" ? [
        Math.max(...array.filter((_, i) => i % 3 === 0)),
        Math.max(...array.filter((_, i) => i % 3 === 1)),
        Math.max(...array.filter((_, i) => i % 3 === 2))
      ] : undefined
    });
    return accessors.length - 1;
  };

  const tempoAcessor = adicionar(dados.tempos, "SCALAR", 1);
  const canais = [];
  const samplers = [];
  for (const trilha of dados.trilhas) {
    const node = indice.get(trilha.osso);
    if (node === undefined) continue;
    const tipo = trilha.caminho === "rotation" ? "VEC4" : "VEC3";
    const acessor = adicionar(trilha.valores, tipo, trilha.componentes);
    samplers.push({ input: tempoAcessor, output: acessor, interpolation: "LINEAR" });
    canais.push({ sampler: samplers.length - 1, target: { node, path: trilha.caminho } });
  }

  const gltf = {
    asset: { version: "2.0", generator: "FORJA retransferir-mocap" },
    scene: 0,
    scenes: [{ nodes: [raizIdx] }],
    nodes,
    animations: [{
      name: dados.clipe,
      channels: canais,
      samplers
    }],
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors
  };

  const bin = Buffer.concat(bufferPartes);
  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  const padJson = (4 - (json.length % 4)) % 4;
  if (padJson) json = Buffer.concat([json, Buffer.from(" ".repeat(padJson))]);
  const total = 12 + 8 + json.length + 8 + bin.length;
  const cabecalho = Buffer.alloc(12);
  cabecalho.write("glTF", 0, "ascii");
  cabecalho.writeUInt32LE(2, 4);
  cabecalho.writeUInt32LE(total, 8);
  const jsonCabecalho = Buffer.alloc(8);
  jsonCabecalho.writeUInt32LE(json.length, 0);
  jsonCabecalho.writeUInt32LE(0x4e4f534a, 4);
  const binCabecalho = Buffer.alloc(8);
  binCabecalho.writeUInt32LE(bin.length, 0);
  binCabecalho.writeUInt32LE(0x004e4942, 4);

  fs.mkdirSync(path.dirname(path.resolve(destino)), { recursive: true });
  fs.writeFileSync(destino, Buffer.concat([cabecalho, jsonCabecalho, json, binCabecalho, bin]));
  return total;
}



/* ------------------------------------------------------------------ */
/* Amostragem de um AnimationClip para o formato de clipe do FORJA     */
/* ------------------------------------------------------------------ */

/*
  Toca o clipe no rig do personagem e lê, quadro a quadro, a rotação local de
  cada osso (e a translação do quadril). Serve para qualquer origem — DeskBreak
  (mesmo rig) ou mocap já transferido — e garante o mesmo formato dos 40 clipes
  publicados: 24 fps, quaternion por osso, translação só no quadril.
*/
export function amostrarParaClipe({ cena, ossos, clipe, fps = 24, duracao, inicio = 0 }) {
  const mixer = new THREE.AnimationMixer(cena);
  const acao = mixer.clipAction(clipe);
  acao.play();
  const dur = Math.min(duracao || clipe.duration, Math.max(0.2, clipe.duration - inicio));
  const total = Math.max(2, Math.round(dur * fps) + 1);
  const tempos = [];
  const valoresRot = {};
  const valoresPos = {};
  const anterior = {};
  for (const [nome] of HIERARQUIA) {
    valoresRot[nome] = [];
    if (nome === "hips") valoresPos[nome] = [];
  }
  for (let i = 0; i < total; i += 1) {
    const t = inicio + i / fps;
    mixer.setTime(Math.min(t, clipe.duration));
    cena.updateMatrixWorld(true);
    for (const [nome] of HIERARQUIA) {
      const osso = ossos.get(nome);
      const q = osso.quaternion.clone();
      const ant = anterior[nome];
      if (ant && q.dot(ant) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      anterior[nome] = q;
      valoresRot[nome].push(q.x, q.y, q.z, q.w);
      if (nome === "hips") {
        const p = osso.position;
        valoresPos[nome].push(p.x, p.y, p.z);
      }
    }
    tempos.push(i / fps);
  }
  mixer.stopAllAction();
  const trilhas = [];
  for (const [nome] of HIERARQUIA) {
    trilhas.push({ osso: nome, caminho: "rotation", valores: valoresRot[nome], componentes: 4 });
    if (nome === "hips") trilhas.push({ osso: nome, caminho: "translation", valores: valoresPos[nome], componentes: 3 });
  }
  return { tempos, trilhas, duracao: dur, fps };
}
