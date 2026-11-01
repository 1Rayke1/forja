#!/usr/bin/env node
/*
  FORJA — render de validação dos personagens 3D sem navegador.

  Este script usa EXATAMENTE o caminho do app: o mesmo three.js vendorizado, o
  mesmo GLTFLoader, o mesmo `reamarrarFaixas` de `assets/js/forja-3d-cena.js` e
  o mesmo AnimationMixer com o clipe publicado em `assets/3d/animacoes/`. A
  diferença é só o desenho: em vez de WebGL (que exige GPU/contexto de
  navegador), a malha com skin é rasterizada na CPU em Node, num PNG.

  Serve para provar, com imagem, que:
    - o GLB do personagem abre e a malha é deformada pelo esqueleto;
    - cada clipe move o boneco no rig certo;
    - masculino e feminino usam o MESMO clipe (um controlador, dois corpos).

  Uso:
    node tools/renderizar-3d.mjs --personagem masculino --clipe flexao \
      --saida docs/validacao-3d/masculino-flexao.png [--fases 6] [--tempo 0.5]

  Sem `--fases` o PNG tem um quadro só (no `--tempo`, em fração do clipe).
*/
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

/* O carregador de GLB usa APIs de navegador só para textura; a cor do material
   basta para o render, então os stubs ficam restritos a este processo. */
globalThis.self = globalThis;
globalThis.createImageBitmap = globalThis.createImageBitmap || (async () => ({ width: 2, height: 2, close() {} }));
if (typeof globalThis.URL.createObjectURL !== "function") {
  globalThis.URL.createObjectURL = () => "blob:render";
  globalThis.URL.revokeObjectURL = () => {};
}

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argumentos(lista) {
  const saida = {};
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i];
    if (!item.startsWith("--")) continue;
    const chave = item.slice(2);
    const proximo = lista[i + 1];
    if (proximo && !proximo.startsWith("--")) {
      saida[chave] = proximo;
      i += 1;
    } else {
      saida[chave] = true;
    }
  }
  return saida;
}

const opcoes = argumentos(process.argv.slice(2));
const personagem = opcoes.personagem || "masculino";
const clipeId = opcoes.clipe || "flexao";
const arquivoClipe = typeof opcoes.arquivo === "string" ? opcoes.arquivo : null;
const destino = opcoes.saida || path.join(raiz, "docs", "validacao-3d", `${personagem}-${clipeId}.png`);
const fases = Number(opcoes.fases || 1);
const tempoFracao = Number(opcoes.tempo === undefined ? 0.35 : opcoes.tempo);
const larguraCelula = Number(opcoes.largura || 340);
const alturaCelula = Math.round(larguraCelula * 1.4);
const escala = 2; /* supersampling: renderiza 2× e reduz para suavizar */

/*
  Vista do render. O padrão continua sendo o 3/4 usado na validação publicada;
  `--vista frente` e `--vista lado` existem para a inspeção de anatomia e para
  comparar pose de perfil (que é onde joelho e quadril mentem).
*/
const VISTAS = { "tres-quartos": 0.42, frente: 0, lado: Math.PI / 2, costas: Math.PI };
const vista = opcoes.vista || "tres-quartos";
const azimuteVista = opcoes.azimute !== undefined ? Number(opcoes.azimute) : VISTAS[vista];
if (!Number.isFinite(azimuteVista)) throw new Error("vista desconhecida: " + vista);

const THREE = await import(path.join(raiz, "assets/vendor/three/three.module.min.js"));
const { GLTFLoader } = await import(
  path.join(raiz, "assets/vendor/three/addons/loaders/GLTFLoader.js")
);
const cenaMod = await import(path.join(raiz, "assets/js/forja-3d-cena.js"));

function carregarGLB(relativo) {
  return new Promise((resolve, reject) => {
    const buffer = fs.readFileSync(path.isAbsolute(relativo) ? relativo : path.join(raiz, relativo));
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    new GLTFLoader().parse(bytes, "", resolve, reject);
  });
}

/* ------------------------------------------------------------------ */
/* Rasterizador (CPU)                                                  */
/* ------------------------------------------------------------------ */

function criarAlvo(largura, altura, fundo) {
  const cor = new Float32Array(largura * altura * 3);
  for (let i = 0; i < largura * altura; i += 1) {
    /* fundo radial escuro, parecido com o palco do app */
    const x = (i % largura) / largura - 0.5;
    const y = Math.floor(i / largura) / altura - 0.4;
    const brilho = Math.max(0, 0.10 - Math.hypot(x, y * 1.2) * 0.10);
    cor[i * 3] = fundo[0] + brilho * 0.7;
    cor[i * 3 + 1] = fundo[1] + brilho;
    cor[i * 3 + 2] = fundo[2] + brilho * 0.6;
  }
  return { largura, altura, cor, profundidade: new Float32Array(largura * altura).fill(Infinity) };
}

function desenharTriangulo(alvo, a, b, c, corRgb, brilho) {
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(area) < 1e-6) return;

  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(alvo.largura - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(alvo.altura - 1, Math.ceil(Math.max(a.y, b.y, c.y)));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let w0 = ((b.x - px) * (c.y - py) - (c.x - px) * (b.y - py)) / area;
      let w1 = ((c.x - px) * (a.y - py) - (a.x - px) * (c.y - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.0001 || w1 < -0.0001 || w2 < -0.0001) continue;
      const z = w0 * a.z + w1 * b.z + w2 * c.z;
      const indice = y * alvo.largura + x;
      if (z >= alvo.profundidade[indice]) continue;
      alvo.profundidade[indice] = z;
      const luz = Math.min(1.35, 0.32 + brilho);
      alvo.cor[indice * 3] = corRgb[0] * luz;
      alvo.cor[indice * 3 + 1] = corRgb[1] * luz;
      alvo.cor[indice * 3 + 2] = corRgb[2] * luz;
    }
  }
}

function reduzir(alvo, fator) {
  const largura = Math.floor(alvo.largura / fator);
  const altura = Math.floor(alvo.altura / fator);
  const cor = new Float32Array(largura * altura * 3);
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      let r = 0; let g = 0; let b = 0;
      for (let dy = 0; dy < fator; dy += 1) {
        for (let dx = 0; dx < fator; dx += 1) {
          const indice = ((y * fator + dy) * alvo.largura + (x * fator + dx)) * 3;
          r += alvo.cor[indice]; g += alvo.cor[indice + 1]; b += alvo.cor[indice + 2];
        }
      }
      const total = fator * fator;
      const alvoIndice = (y * largura + x) * 3;
      cor[alvoIndice] = r / total;
      cor[alvoIndice + 1] = g / total;
      cor[alvoIndice + 2] = b / total;
    }
  }
  return { largura, altura, cor };
}

/* ------------------------------------------------------------------ */
/* PNG (RGB, sem filtro)                                               */
/* ------------------------------------------------------------------ */

function escreverPNG(arquivo, imagem) {
  const { largura, altura, cor } = imagem;
  const linhas = Buffer.alloc((largura * 3 + 1) * altura);
  for (let y = 0; y < altura; y += 1) {
    linhas[y * (largura * 3 + 1)] = 0;
    for (let x = 0; x < largura; x += 1) {
      const origem = (y * largura + x) * 3;
      const destinoLinha = y * (largura * 3 + 1) + 1 + x * 3;
      for (let canal = 0; canal < 3; canal += 1) {
        const valor = Math.max(0, Math.min(1, cor[origem + canal]));
        linhas[destinoLinha + canal] = Math.round(Math.pow(valor, 1 / 1.9) * 255);
      }
    }
  }

  const tabela = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  const crc32 = buffer => {
    let c = 0xffffffff;
    for (const byte of buffer) c = tabela[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (tipo, dados) => {
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(corpo));
    return Buffer.concat([tamanho, corpo, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(linhas, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]));
}

/* ------------------------------------------------------------------ */
/* Cena do app                                                         */
/* ------------------------------------------------------------------ */

const catalogo = JSON.parse(fs.readFileSync(path.join(raiz, "assets/3d/catalogo.json"), "utf8"));
const dadosPersonagem = catalogo.personagens[personagem];
const clipeInfo = catalogo.clipes.find(clipe => clipe.id === clipeId);
if (!dadosPersonagem) throw new Error("personagem não publicado: " + personagem);
if (!clipeInfo && !arquivoClipe) throw new Error("clipe não publicado: " + clipeId);

const gltfPersonagem = await carregarGLB(dadosPersonagem.arquivo);
/*
  `--arquivo` renderiza um clipe qualquer do disco (candidato ainda não
  publicado). É assim que um retarget é olhado antes de entrar no catálogo.
*/
const gltfClipe = await carregarGLB(arquivoClipe || clipeInfo.arquivo);

const raizPersonagem = gltfPersonagem.scene;
const clipe = cenaMod.reamarrarFaixas(gltfClipe.animations[0], raizPersonagem);

const mixer = new THREE.AnimationMixer(raizPersonagem);
const acao = mixer.clipAction(clipe);
acao.play();

const malhas = [];
raizPersonagem.traverse(objeto => {
  if (objeto.isSkinnedMesh) malhas.push(objeto);
});

const luzes = [
  { direcao: new THREE.Vector3(1.8, 3.2, 2.6).normalize(), cor: [1.0, 0.98, 0.94], forca: 0.62 },
  { direcao: new THREE.Vector3(-2.4, 1.6, -2.2).normalize(), cor: [0.72, 0.95, 0.55], forca: 0.34 }
];

/* ------------------------------------------------------------------ */
/* Passada 1: geometria deformada (skin) em cada fase                  */
/* ------------------------------------------------------------------ */

function capturarFase(tempo) {
  mixer.setTime(tempo);
  raizPersonagem.updateMatrixWorld(true);
  const pedacos = [];
  malhas.forEach(malha => {
    malha.updateMatrixWorld(true);
    const geometria = malha.geometry;
    const posicao = geometria.attributes.position;
    const indice = geometria.index;
    const material = malha.material || {};
    const cor = material.map
      ? [0.72, 0.52, 0.32]
      : material.color
        ? [material.color.r, material.color.g, material.color.b]
        : [0.8, 0.6, 0.35];

    const vertices = [];
    for (let i = 0; i < posicao.count; i += 1) {
      const ponto = new THREE.Vector3().fromBufferAttribute(posicao, i);
      malha.applyBoneTransform(i, ponto);
      ponto.applyMatrix4(malha.matrixWorld);
      vertices.push(ponto);
    }
    pedacos.push({ vertices, indice, cor, total: indice ? indice.count : posicao.count });
  });
  return pedacos;
}

const fasesCapturadas = [];
for (let indice = 0; indice < fases; indice += 1) {
  const fracao = fases === 1 ? tempoFracao : indice / fases;
  fasesCapturadas.push(capturarFase(clipe.duration * fracao));
}

/* Caixa de todos os quadros: a câmera enquadra o movimento, não a pose de
   repouso — o app faz o mesmo com `enquadrar()` ao carregar o clipe. */
const caixa = new THREE.Box3();
fasesCapturadas.forEach(pedacos => pedacos.forEach(pedaco => {
  pedaco.vertices.forEach(ponto => caixa.expandByPoint(ponto));
}));
const centro = caixa.getCenter(new THREE.Vector3());
if (process.env.FORJA_DEBUG) {
  console.log("[debug] caixa", JSON.stringify({
    min: caixa.min.toArray().map(v => +v.toFixed(2)),
    max: caixa.max.toArray().map(v => +v.toFixed(2))
  }));
}
const tamanho = caixa.getSize(new THREE.Vector3());
const alturaCorpo = Math.max(tamanho.y, 0.4);

const camera = new THREE.PerspectiveCamera(32, larguraCelula / alturaCelula, 0.05, 60);
const fovRad = (camera.fov * Math.PI) / 180;
const distanciaVertical = (Math.max(tamanho.y, tamanho.x * (alturaCelula / larguraCelula)) * 0.54) / Math.tan(fovRad / 2);
const distancia = Math.max(1.4, distanciaVertical + tamanho.z * 0.6);
const azimute = azimuteVista;
const elevacao = 0.12;
camera.position.set(
  centro.x + Math.sin(azimute) * Math.cos(elevacao) * distancia,
  centro.y + Math.sin(elevacao) * distancia,
  centro.z + Math.cos(azimute) * Math.cos(elevacao) * distancia
);
camera.lookAt(centro);
camera.updateMatrixWorld(true);
if (process.env.FORJA_DEBUG) {
  const ndc = new THREE.Box3();
  const v = new THREE.Vector3();
  fasesCapturadas.forEach(pedacos => pedacos.forEach(pedaco => pedaco.vertices.forEach(ponto => {
    v.copy(ponto).project(camera);
    ndc.expandByPoint(v);
  })));
  console.log("[debug] ndc", JSON.stringify({
    min: ndc.min.toArray().map(n => +n.toFixed(2)),
    max: ndc.max.toArray().map(n => +n.toFixed(2))
  }));
  console.log("[debug] camera", JSON.stringify({
    pos: camera.position.toArray().map(v => +v.toFixed(2)),
    centro: centro.toArray().map(v => +v.toFixed(2)),
    distancia: +distancia.toFixed(2)
  }));
}

/* ------------------------------------------------------------------ */
/* Passada 2: rasterização                                             */
/* ------------------------------------------------------------------ */

function renderizarFase(pedacos) {
  const largura = larguraCelula * escala;
  const altura = alturaCelula * escala;
  const alvoImagem = criarAlvo(largura, altura, [0.055, 0.062, 0.055]);
  const projetado = new THREE.Vector3();

  pedacos.forEach(pedaco => {
    const { vertices, indice, cor, total } = pedaco;
    for (let i = 0; i < total; i += 3) {
      const ia = indice ? indice.getX(i) : i;
      const ib = indice ? indice.getX(i + 1) : i + 1;
      const ic = indice ? indice.getX(i + 2) : i + 2;
      const a = vertices[ia]; const b = vertices[ib]; const c = vertices[ic];
      if (!a || !b || !c) continue;

      const normal = new THREE.Vector3()
        .subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      let brilho = 0.18;
      luzes.forEach(luz => {
        brilho += luz.forca * Math.max(0, normal.dot(luz.direcao)) * (luz.cor[1] * 0.6 + 0.4);
      });

      const pontos = [];
      let fora = false;
      [a, b, c].forEach(ponto => {
        projetado.copy(ponto).project(camera);
        if (projetado.z < -1 || projetado.z > 1) fora = true;
        pontos.push({
          x: (projetado.x * 0.5 + 0.5) * largura,
          y: (-projetado.y * 0.5 + 0.5) * altura,
          z: projetado.z
        });
      });
      if (fora) continue;
      desenharTriangulo(alvoImagem, pontos[0], pontos[1], pontos[2], cor, brilho);
    }
  });

  return reduzir(alvoImagem, escala);
}

const quadros = fasesCapturadas.map(renderizarFase);

/* Monta a tira de quadros (uma imagem só, lado a lado). */
const larguraFinal = larguraCelula * quadros.length;
const alturaFinal = alturaCelula;
const composta = { largura: larguraFinal, altura: alturaFinal, cor: new Float32Array(larguraFinal * alturaFinal * 3) };
quadros.forEach((quadro, indice) => {
  for (let y = 0; y < alturaFinal; y += 1) {
    for (let x = 0; x < larguraCelula; x += 1) {
      const origem = (y * larguraCelula + x) * 3;
      const destinoIndice = (y * larguraFinal + indice * larguraCelula + x) * 3;
      composta.cor[destinoIndice] = quadro.cor[origem];
      composta.cor[destinoIndice + 1] = quadro.cor[origem + 1];
      composta.cor[destinoIndice + 2] = quadro.cor[origem + 2];
    }
    /* divisória fina entre quadros */
    if (indice < quadros.length - 1) {
      const x = larguraCelula - 1;
      const destinoIndice = (y * larguraFinal + indice * larguraCelula + x) * 3;
      composta.cor[destinoIndice] = 0.12;
      composta.cor[destinoIndice + 1] = 0.14;
      composta.cor[destinoIndice + 2] = 0.12;
    }
  }
});

escreverPNG(destino, composta);

/* Números da validação, para o relatório. */
const alturaMedida = tamanho.y;
console.log(JSON.stringify({
  personagem,
  clipe: arquivoClipe ? path.basename(arquivoClipe) : clipeId,
  arquivo: path.relative(raiz, destino),
  quadros: fases,
  duracaoS: Number(clipe.duration.toFixed(2)),
  faixas: clipe.tracks.length,
  malhas: malhas.length,
  osos: (() => { let n = 0; raizPersonagem.traverse(o => { if (o.isBone) n += 1; }); return n; })(),
  alturaMedidaM: Number(alturaMedida.toFixed(3)),
  caixaM: {
    x: Number(tamanho.x.toFixed(3)),
    y: Number(tamanho.y.toFixed(3)),
    z: Number(tamanho.z.toFixed(3))
  }
}, null, 2));
