/*
  Regressão do sombreamento no rasterizador CPU dos 28 MP4.

  Defeito corrigido: o rasterizador usava UMA normal de face por triângulo
  (flat shading). Nas superfícies curvas do manequim isso criava grandes
  "leques" de faixas radiais que não existem no modelo oficial em WebGL.
  A correção lê as normais suaves por vértice do próprio GLB, aplica o mesmo
  skinning das posições e interpola a normal POR PIXEL antes de iluminar.

  Estes testes usam os GLBs REAIS publicados em assets/3d/personagens/ e NÃO
  alteram modelos, materiais, luzes nem animações.

  Uso: node tests/normais-frame.test.mjs  (também executado por `npm test`)
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { criarCalculadoraNormais } from "../tools/lib/normais-vertice.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.self = globalThis;
globalThis.createImageBitmap = globalThis.createImageBitmap || (async () => ({ width: 2, height: 2, close() {} }));
if (typeof globalThis.URL.createObjectURL !== "function") {
  globalThis.URL.createObjectURL = () => "blob:teste";
  globalThis.URL.revokeObjectURL = () => {};
}
const THREE = await import(path.join(raiz, "assets/vendor/three/three.module.min.js"));
const { GLTFLoader } = await import(path.join(raiz, "assets/vendor/three/addons/loaders/GLTFLoader.js"));
const cenaMod = await import(path.join(raiz, "assets/js/forja-3d-cena.js"));

const carregar = arquivo => new Promise((resolve, reject) => {
  const bytes = fs.readFileSync(path.join(raiz, arquivo));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  new GLTFLoader().parse(buffer, "", resolve, reject);
});

let testes = 0;
const verificar = (nome, fn) => { fn(); testes += 1; console.log(`  ok ${testes} — ${nome}`); };

for (const personagem of ["masculino", "feminino"]) {
  const gltfP = await carregar(`assets/3d/personagens/${personagem}.glb`);
  const gltfC = await carregar("assets/3d/animacoes/agachamento.glb");
  const raizP = gltfP.scene;
  const malhas = [];
  raizP.traverse(objeto => { if (objeto.isSkinnedMesh) malhas.push(objeto); });
  const mixer = new THREE.AnimationMixer(raizP);
  const clipe = cenaMod.reamarrarFaixas(gltfC.animations[0], raizP);
  mixer.clipAction(clipe).play();
  const calcular = criarCalculadoraNormais(THREE);

  const em = tempo => {
    mixer.setTime(tempo);
    raizP.updateMatrixWorld(true);
    return malhas.map(malha => {
      malha.updateMatrixWorld(true);
      return calcular(malha);
    });
  };

  verificar(`${personagem}: 3 malhas com normal/skinIndex/skinWeight completos`, () => {
    assert.equal(malhas.length, 3);
    for (const malha of malhas) {
      const a = malha.geometry.attributes;
      assert.ok(a.normal && a.skinIndex && a.skinWeight, "atributo de normal/skinning ausente");
      assert.equal(a.normal.count, a.position.count);
      assert.equal(a.skinWeight.count, a.position.count);
    }
  });

  verificar(`${personagem}: normais deformadas são finitas e unitárias em repouso`, () => {
    for (const normais of em(0)) {
      assert.equal(normais.length % 3, 0);
      for (let i = 0; i < normais.length; i += 3) {
        const n = Math.hypot(normais[i], normais[i + 1], normais[i + 2]);
        assert.ok(Number.isFinite(n), `normal ${i / 3} não é finita`);
        assert.ok(Math.abs(n - 1) < 1e-4, `normal ${i / 3} não é unitária: ${n}`);
      }
    }
  });

  verificar(`${personagem}: o skinning realmente gira as normais`, () => {
    const repouso = em(0);
    const animado = em(clipe.duration * 0.5);
    let diferentes = 0;
    for (let m = 0; m < malhas.length; m += 1) {
      for (let i = 0; i < repouso[m].length; i += 3) {
        const d = Math.abs(repouso[m][i] - animado[m][i]) +
          Math.abs(repouso[m][i + 1] - animado[m][i + 1]) +
          Math.abs(repouso[m][i + 2] - animado[m][i + 2]);
        if (d > 0.01) diferentes += 1;
      }
    }
    assert.ok(diferentes > 100, `esperadas muitas normais animadas, vieram ${diferentes}`);
  });

  verificar(`${personagem}: normais continuam válidas no fim do clipe`, () => {
    for (const normais of em(clipe.duration * 0.95)) {
      for (let i = 0; i < normais.length; i += 3) {
        const n = Math.hypot(normais[i], normais[i + 1], normais[i + 2]);
        assert.ok(Number.isFinite(n) && Math.abs(n - 1) < 1e-4, `normal ${i / 3} inválida`);
      }
    }
  });
}

const codigo = fs.readFileSync(path.join(raiz, "tools/renderizar-videos-3d.mjs"), "utf8");
verificar("rasterizador usa as normais por vértice, não uma normal de face", () => {
  assert.match(codigo, /criarCalculadoraNormais/);
  assert.match(codigo, /normaisDeformadas\(malha\)/);
  assert.doesNotMatch(codigo, /subVectors\(vb, va\)/, "ainda calcula normal de face com cross()");
});
verificar("iluminação é aplicada por pixel com normal interpolada", () => {
  assert.match(codigo, /Iluminação por PIXEL/);
  assert.match(codigo, /let nx = w0 \* na0 \+ w1 \* nb0 \+ w2 \* nc0/);
  assert.match(codigo, /desenharTriangulo\(alvo, pa, pb, pc, corA, corB, corC, normais, ii, ij, ik\)/);
});

console.log(`\n${testes} testes de normais/sombreamento do rasterizador, todos verdes.`);
