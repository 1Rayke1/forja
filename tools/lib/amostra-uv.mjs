/*
  FORJA — leitura correta da coordenada UV de um vértice no rasterizador CPU.

  `uv` é um THREE.BufferAttribute com itemSize 2: `getX(i)`/`getY(i)` já
  recebem o ÍNDICE DO VÉRTICE e internamente fazem `array[i * 2]` e
  `array[i * 2 + 1]`. A versão anterior chamava `uv.getX(k * 2)`, lendo a UV
  do vértice 2k. Para k acima da metade da malha isso saía do intervalo e
  devolvia undefined/NaN, que virava preto ao amostrar a textura — metade dos
  braços/pernas aparecia preta nos MP4, diferente da referência oficial do app
  (WebGL), onde o mesmo GLB é inteiro em madeira bege.

  Nenhum material, textura, luz ou animação é modificado aqui: apenas o índice
  usado para consultar o atributo UV já existente no GLB.
*/

export function uvDoVertice(uv, indiceVertice) {
  const u = uv.getX(indiceVertice);
  const v = uv.getY(indiceVertice);
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    throw new Error(`UV inválida para o vértice ${indiceVertice}`);
  }
  return [u, v];
}
