/*
  Regressão da leitura de UV no rasterizador CPU dos 28 MP4.

  O defeito: `uv.getX(k * 2)` em um BufferAttribute de itemSize 2 lia a UV do
  vértice 2k; para a metade superior dos índices o valor era undefined/NaN e a
  amostra de textura virava preta. A referência oficial (mesmo GLB renderizado
  pela cena WebGL do app) mostra o personagem inteiro em madeira bege.

  Estes testes usam os GLBs REAIS publicados em assets/3d/personagens/ e não
  alteram nenhum modelo, material, luz ou animação.

  Uso: node tests/uv-frame.test.mjs  (também executado por `npm test`)
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uvDoVertice } from "../tools/lib/amostra-uv.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

globalThis.self = globalThis;
globalThis.createImageBitmap = globalThis.createImageBitmap || (async () => ({ width: 2, height: 2, close() {} }));
if (typeof globalThis.URL.createObjectURL !== "function") {
  globalThis.URL.createObjectURL = () => "blob:teste";
  globalThis.URL.revokeObjectURL = () => {};
}
const { GLTFLoader } = await import(path.join(raiz, "assets/vendor/three/addons/loaders/GLTFLoader.js"));

async function malhasDoPersonagem(arquivo) {
  const bytes = fs.readFileSync(path.join(raiz, arquivo));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, "", resolve, reject));
  const malhas = [];
  gltf.scene.traverse(objeto => { if (objeto.isMesh) malhas.push(objeto); });
  return malhas;
}

let testes = 0;
const verificar = (nome, fn) => { fn(); testes += 1; console.log(`  ok ${testes} — ${nome}`); };

for (const personagem of ["masculino", "feminino"]) {
  const arquivo = `assets/3d/personagens/${personagem}.glb`;
  const malhas = await malhasDoPersonagem(arquivo);

  verificar(`${personagem}: 3 malhas com os materiais oficiais`, () => {
    assert.equal(malhas.length, 3);
    const nomes = malhas.map(m => m.material.name).sort();
    assert.ok(nomes.every(n => /^(wood|wood_joint|plastic)/.test(n)));
  });

  verificar(`${personagem}: UV é finita para TODOS os vértices com o índice corrigido`, () => {
    for (const malha of malhas) {
      const uv = malha.geometry.attributes.uv;
      assert.ok(uv, "atributo UV ausente");
      assert.equal(uv.itemSize, 2);
      for (let k = 0; k < uv.count; k += 1) {
        const [u, v] = uvDoVertice(uv, k);
        assert.ok(Number.isFinite(u) && Number.isFinite(v), `vértice ${k} de ${malha.material.name}`);
        assert.ok(u >= -0.001 && u <= 1.001, `u fora da textura no vértice ${k}`);
        assert.ok(v >= -0.001 && v <= 1.001, `v fora da textura no vértice ${k}`);
      }
    }
  });

  verificar(`${personagem}: o índice antigo (k*2) de fato quebrava ~50% da malha`, () => {
    for (const malha of malhas) {
      const uv = malha.geometry.attributes.uv;
      let invalidos = 0;
      for (let k = 0; k < uv.count; k += 1) {
        if (!Number.isFinite(uv.getX(k * 2)) || !Number.isFinite(uv.getY(k * 2))) invalidos += 1;
      }
      assert.equal(invalidos, Math.floor(uv.count / 2), "a regressão deve ser reproduzível");
    }
  });
}

verificar("uvDoVertice rejeita índice fora da malha", () => {
  const falso = { getX: () => undefined, getY: () => undefined };
  assert.throws(() => uvDoVertice(falso, 0), /UV inválida/);
});

console.log(`\n${testes} testes de UV do rasterizador, todos verdes.`);
