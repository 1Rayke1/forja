/*
  FORJA — normais suaves por vértice para o rasterizador de CPU.

  O rasterizador antes iluminava cada TRIÂNGULO com uma única normal de face
  (flat shading). Em superfícies curvas do manequim (tronco, juntas esféricas,
  coxas) isso produz faixas radiais/"leques" que não existem no modelo oficial
  renderizado em WebGL, que usa as normais suaves do próprio GLB.

  Este módulo aplica às normais o MESMO skinning aplicado às posições:
    matrizPele[b] = bones[b].matrixWorld * boneInverses[b]
    normal[i] = normaliza( normalMatrix(malha.matrixWorld) * Σ peso[k] * matrizPele[joint[k]] * normalBind[i] )

  Não altera modelos, materiais, luzes nem animações: apenas lê atributos que
  já existem no GLB e calcula a orientação correta da superfície.
*/

export function criarCalculadoraNormais(THREE) {
  const tmpM = new THREE.Matrix4();
  const tmpMundo = new THREE.Matrix3();
  const base = new THREE.Vector3();
  const parcela = new THREE.Vector3();
  const soma = new THREE.Vector3();
  const cache = new Map();

  return function normaisDeformadas(malha, destino) {
    const g = malha.geometry;
    const juntas = g.attributes.skinIndex;
    const pesos = g.attributes.skinWeight;
    const atributo = g.attributes.normal;
    const esqueleto = malha.skeleton;
    if (!juntas || !pesos || !atributo || !esqueleto) {
      throw new Error("malha sem skinIndex/skinWeight/normal/skeleton");
    }

    /* 16 matrizes de pele por quadro — não 4 por vértice. */
    let matrizes = cache.get(malha);
    if (!matrizes) {
      matrizes = esqueleto.bones.map(() => new THREE.Matrix3());
      cache.set(malha, matrizes);
    }
    for (let b = 0; b < esqueleto.bones.length; b += 1) {
      tmpM.multiplyMatrices(esqueleto.bones[b].matrixWorld, esqueleto.boneInverses[b]);
      matrizes[b].setFromMatrix4(tmpM);
    }
    tmpMundo.setFromMatrix4(malha.matrixWorld);

    const total = atributo.count;
    const saida = destino && destino.length === total * 3 ? destino : new Float32Array(total * 3);
    for (let i = 0; i < total; i += 1) {
      base.fromBufferAttribute(atributo, i);
      soma.set(0, 0, 0);
      for (let k = 0; k < 4; k += 1) {
        const peso = pesos.getComponent(i, k);
        if (peso === 0) continue;
        const osso = juntas.getComponent(i, k);
        parcela.copy(base).applyMatrix3(matrizes[osso]);
        soma.addScaledVector(parcela, peso);
      }
      /* Vértice sem peso válido: mantém a normal de repouso. */
      if (soma.lengthSq() < 1e-12) soma.copy(base);
      soma.applyMatrix3(tmpMundo).normalize();
      saida[i * 3] = soma.x;
      saida[i * 3 + 1] = soma.y;
      saida[i * 3 + 2] = soma.z;
    }
    return saida;
  };
}
