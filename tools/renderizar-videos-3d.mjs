#!/usr/bin/env node
/*
  FORJA — renderiza vídeos das demonstrações de exercício (16:9, 1280×720,
  30 FPS, sem áudio, loop infinito) a partir dos personagens 3D oficiais e
  dos clipes de animação publicados em assets/3d/.

  Pipeline (sem Blender, sem binário ffmpeg):
    1. Carrega o GLB do personagem e o GLB do clipe com o mesmo GLTFLoader
       vendorizado do app (assets/vendor/three).
    2. Casa as faixas do clipe com o rig de 16 ossos (reamarrarFaixas) e
       amostra a animação no AnimationMixer, quadro a quadro.
    3. Rasteriza cada quadro na CPU (mesmo modelo de luzes da cena de
       apresentação do app: hemisfério + 2 luzes direcionais) com a textura
       de madeira embutida no GLB, enquadramento 3/4 fixo (azimute -58°,
       elevação 22°, FOV 32°, corpo inteiro com margem de 9%) calculado sobre
       a malha deformada — igual ao modo apresentação de forja-3d-cena.js.
    4. Codifica com ffmpeg.wasm (@ffmpeg/core, WASM em memória): H.264
       yuv420p, 30 FPS CFR, +faststart, sem áudio.
    5. Verifica o MP4 com tools/lib/probe-mp4.mjs (1280×720, 30 FPS, 16:9,
       sem áudio).

  Uso:
    node tools/renderizar-videos-3d.mjs --personagem masculino --clipe flexao \
      --saida assets/videos/exercicios/cal-flexao-masculino-horizontal-16x9.mp4

    --personagem masculino|feminino
    --clipe <id do catalogo>        (ou --arquivo <caminho glb do clipe>)
    --saida <caminho mp4>
    --fps 30
    --duracao <s>                   (padrão: duracao do clipe)
    --sem-textura                   (desativa a textura: cor solida)
*/

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { bmpDeFrame } from "./lib/bmp-frame.mjs";
import { uvDoVertice } from "./lib/amostra-uv.mjs";
import { criarCalculadoraNormais } from "./lib/normais-vertice.mjs";

/* Stub de APIs de navegador que o GLTFLoader usa apenas para textura. */
globalThis.self = globalThis;
globalThis.createImageBitmap = globalThis.createImageBitmap || (async () => ({ width: 2, height: 2, close() {} }));
if (typeof globalThis.URL.createObjectURL !== "function") {
  globalThis.URL.createObjectURL = () => "blob:render";
  globalThis.URL.revokeObjectURL = () => {};
}

const require = createRequire(import.meta.url);
const createFFmpegCore = require("@ffmpeg/core");

const raiz = path.resolve(".");
const lerJSON = arquivo => JSON.parse(fs.readFileSync(arquivo, "utf8"));

const argumentos = lista => {
  const saida = {};
  /* Aceita tanto --sem-textura quanto --semTextura: as opções são lidas em
     camelCase no código, mas a documentação usa kebab-case. Mantemos as duas
     chaves para não quebrar --salvar-quadros, que é lido com o hífen. */
  const emCamel = chave => chave.replace(/-([a-z])/g, (_, letra) => letra.toUpperCase());
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i];
    if (!item.startsWith("--")) continue;
    const chave = item.slice(2);
    const proximo = lista[i + 1];
    const valor = proximo && !proximo.startsWith("--") ? proximo : true;
    if (valor !== true) i += 1;
    saida[chave] = valor;
    const camel = emCamel(chave);
    if (camel !== chave) saida[camel] = valor;
  }
  return saida;
};

const opcoes = argumentos(process.argv.slice(2));
const PERSONAGEM_ID = opcoes.personagem || "masculino";
const CLIPE_ID = opcoes.clipe || "flexao";
const ARQUIVO_CLIPE = typeof opcoes.arquivo === "string" ? opcoes.arquivo : null;
const SAIDA = opcoes.saida || path.join(raiz, "assets", "videos", "exercicios", `${CLIPE_ID}-${PERSONAGEM_ID}-horizontal-16x9.mp4`);
const FPS = Number(opcoes.fps || 30);
const DURACAO_FORCADA = typeof opcoes.duracao === "string" ? Number(opcoes.duracao) : null;
const SEM_TEXTURA = Boolean(opcoes.semTextura);
const LARGURA = 1280;
const ALTURA = 720;

if (!["masculino", "feminino"].includes(PERSONAGEM_ID)) {
  throw new Error("--personagem deve ser masculino ou feminino");
}

const catalogo = lerJSON(path.join(raiz, "assets", "3d", "catalogo.json"));
const dadosPersonagem = catalogo.personagens[PERSONAGEM_ID];
if (!dadosPersonagem) throw new Error("personagem nao publicado: " + PERSONAGEM_ID);

let clipeInfo = catalogo.clipes.find(c => c.id === CLIPE_ID);
const arquivoClipe = ARQUIVO_CLIPE || (clipeInfo && clipeInfo.arquivo) || "";
if (!clipeInfo && !ARQUIVO_CLIPE) throw new Error("clipe nao publicado: " + CLIPE_ID);

const THREE = await import(path.join(raiz, "assets/vendor/three/three.module.min.js"));
const { GLTFLoader } = await import(path.join(raiz, "assets/vendor/three/addons/loaders/GLTFLoader.js"));
const cenaMod = await import(path.join(raiz, "assets/js/forja-3d-cena.js"));
const { lerMP4 } = await import(path.join(raiz, "tools", "lib", "probe-mp4.mjs"));
const jpeg = await import(path.join(raiz, "node_modules", "jpeg-js", "index.js"));

function carregarGLB(relativo) {
  return new Promise((resolve, reject) => {
    const buffer = fs.readFileSync(path.join(raiz, relativo));
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    new GLTFLoader().parse(bytes, "", resolve, reject);
  });
}

/* ------------------------------------------------------------------ */
/* Texturas embutidas no GLB (uma JPEG da madeira por personagem)      */
/* ------------------------------------------------------------------ */

function extrairTexturas(gltf, bin) {
  const texturas = {};
  const imagens = gltf.images || [];
  for (const imagem of imagens) {
    if (imagem.bufferView === undefined) continue;
    const vista = gltf.bufferViews[imagem.bufferView];
    const bytes = bin.subarray(vista.byteOffset, vista.byteOffset + vista.byteLength);
    let imagemDecodificada;
    try {
      imagemDecodificada = jpeg.decode(new Uint8Array(bytes));
    } catch (erro) {
      continue;
    }
    texturas[imagem.bufferView] = {
      largura: imagemDecodificada.width,
      altura: imagemDecodificada.height,
      dados: imagemDecodificada.data, // RGBA, uint8
    };
  }
  return texturas;
}

function amostraTextura(textura, u, v) {
  if (!textura) return null;
  let uu = u % 1; if (uu < 0) uu += 1;
  let vv = v % 1; if (vv < 0) vv += 1;
  /* GLTF v: 0 em cima; inverter para imagem (0 em baixo). */
  const x = uu * (textura.largura - 1);
  const y = (1 - vv) * (textura.altura - 1);
  const x0 = Math.min(Math.floor(x), textura.largura - 1);
  const x1 = Math.min(x0 + 1, textura.largura - 1);
  const y0 = Math.min(Math.floor(y), textura.altura - 1);
  const y1 = Math.min(y0 + 1, textura.altura - 1);
  const wx = x - x0;
  const wy = y - y0;
  const dados = textura.dados;
  const idx = (a, b) => (b * textura.largura + a) * 4;
  const c00 = dados.slice(idx(x0, y0), idx(x0, y0) + 4);
  const c10 = dados.slice(idx(x1, y0), idx(x1, y0) + 4);
  const c01 = dados.slice(idx(x0, y1), idx(x0, y1) + 4);
  const c11 = dados.slice(idx(x1, y1), idx(x1, y1) + 4);
  const out = [];
  for (let c = 0; c < 3; c += 1) {
    const valor =
      c00[c] * (1 - wx) * (1 - wy) +
      c10[c] * wx * (1 - wy) +
      c01[c] * (1 - wx) * wy +
      c11[c] * wx * wy;
    out.push(valor / 255);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Carregamento do personagem e do clipe                               */
/* ------------------------------------------------------------------ */

const gltfPersonagem = await carregarGLB(dadosPersonagem.arquivo);
const gltfClipe = await carregarGLB(arquivoClipe);
const raizPersonagem = gltfPersonagem.scene;
const origem = gltfClipe.animations && gltfClipe.animations[0];
if (!origem) throw new Error("clipe sem animacao: " + arquivoClipe);
const clipe = cenaMod.reamarrarFaixas(origem, raizPersonagem);
const duracao = DURACAO_FORCADA || clipe.duration;
const totalFrames = Math.max(1, Math.round(duracao * FPS));
console.log("clipe", arquivoClipe, "duracao", duracao, "s ->", totalFrames, "quadros @" + FPS + " fps");

const malhas = [];
raizPersonagem.traverse(objeto => { if (objeto.isSkinnedMesh) malhas.push(objeto); });

/* Ler o GLB cru para acessar o JSON, o bin e as imagens embutidas. */
const bufferCru = fs.readFileSync(path.join(raiz, dadosPersonagem.arquivo));
let jsonGlb = null; let binGlb = null;
let off = 12;
while (off < bufferCru.length) {
  const tamanho = bufferCru.readUInt32LE(off);
  const tipo = bufferCru.toString("latin1", off + 4, off + 8);
  const dados = bufferCru.subarray(off + 8, off + 8 + tamanho);
  if (tipo === "JSON") jsonGlb = JSON.parse(dados.toString("utf8").replace(/\0+$/g, ""));
  else if (tipo.startsWith("BIN")) binGlb = dados;
  off += 8 + tamanho;
}
const texturasGlb = extrairTexturas(jsonGlb, binGlb);
console.log("texturas decodificadas:", Object.keys(texturasGlb).length);

/* Material por malha (nome do material do personagem). */
const materiaisPorNome = {};
(jsonGlb.materials || []).forEach(m => {
  materiaisPorNome[m.name] = m;
});
const texturaDeIndice = {};
(jsonGlb.textures || []).forEach((t, i) => {
  const imagem = jsonGlb.images[t.source];
  if (imagem && imagem.bufferView !== undefined) texturaDeIndice[i] = texturasGlb[imagem.bufferView] || null;
});

function materialDaMalha(malha) {
  const nome = malha.material && malha.material.name ? malha.material.name : "";
  const material = materiaisPorNome[nome] || {};
  const pbr = material.pbrMetallicRoughness || {};
  let textura = null;
  if (pbr.baseColorTexture && pbr.baseColorTexture.index !== undefined) {
    textura = texturaDeIndice[pbr.baseColorTexture.index] || null;
  }
  const fator = pbr.baseColorFactor || [0.8, 0.6, 0.35, 1];
  return { textura, fator: [fator[0], fator[1], fator[2]], metal: pbr.metallicFactor || 0, rugosidade: pbr.roughnessFactor || 0.5 };
}

/* Dados de atributos por malha (lidos uma vez, em repouso). */
const atributosPorMalha = new Map();
malhas.forEach(malha => {
  const g = malha.geometry;
  const pos = g.attributes.position;
  const normal = g.attributes.normal;
  const uv = g.attributes.uv;
  const indice = g.index;
  const juntas = g.attributes["JOINTS_0"];
  const pesos = g.attributes["WEIGHTS_0"];
  atributosPorMalha.set(malha, { pos, normal, uv, indice, juntas, pesos, total: indice ? indice.count : pos.count });
});

const mixer = new THREE.AnimationMixer(raizPersonagem);
const acao = mixer.clipAction(clipe);
acao.play();

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const normaisDeformadas = criarCalculadoraNormais(THREE);

function capturarFase(tempo, comNormais = false) {
  mixer.setTime(tempo);
  raizPersonagem.updateMatrixWorld(true);
  const pedacos = [];
  malhas.forEach(malha => {
    malha.updateMatrixWorld(true);
    const g = malha.geometry;
    const pos = g.attributes.position;
    const verts = [];
    for (let i = 0; i < pos.count; i += 1) {
      tmpV.fromBufferAttribute(pos, i);
      malha.applyBoneTransform(i, tmpV);
      tmpV.applyMatrix4(malha.matrixWorld);
      verts.push(tmpV.x, tmpV.y, tmpV.z);
    }
    /* Normais suaves do GLB, deformadas pelo mesmo skinning das posições.
       Só são necessárias na rasterização, não na medição de enquadramento. */
    const normais = comNormais ? normaisDeformadas(malha) : null;
    pedacos.push({ malha, verts, normais, total: pos.count });
  });
  return pedacos;
}

/* ------------------------------------------------------------------ */
/* Enquadramento: mesmo modelo do modo apresentacao do app            */
/* ------------------------------------------------------------------ */

const AZIMUTE = (-58 * Math.PI) / 180;
const ELEVACAO = (22 * Math.PI) / 180;
const FOV = 32;
const MARGEM = 0.09;
const ALVO_BASE = new THREE.Vector3(0, 0.95, 0);

function caixaDeformada(pedacos) {
  const caixa = new THREE.Box3();
  const pontos = [];
  const passo = 4000;
  pedacos.forEach(pedaco => {
    const { verts } = pedaco;
    for (let i = 0; i < verts.length; i += 3 * passo) {
      const x = verts[i], y = verts[i + 1], z = verts[i + 2];
      caixa.expandByPoint(new THREE.Vector3(x, y, z));
      pontos.push(new THREE.Vector3(x, y, z));
    }
  });
  return { caixa, pontos };
}

function cameraPosicao(centro, distancia) {
  return new THREE.Vector3(
    centro.x + Math.sin(AZIMUTE) * Math.cos(ELEVACAO) * distancia,
    centro.y + Math.sin(ELEVACAO) * distancia,
    centro.z + Math.cos(AZIMUTE) * Math.cos(ELEVACAO) * distancia);
}

/* Transforma um ponto do mundo para o espaco da camera (sem depender de
   matrixWorldInverse, indisponível neste build minificado do three). */
const camWorldTmp = new THREE.Vector3();
function mundoParaCamera(p, camera, out) {
  const m = camera.matrixWorld.elements;
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  /* colunas da matrix do mundo: base do camera expressa no mundo */
  const r0x = m[0], r0y = m[1], r0z = m[2];    // local +X
  const r1x = m[4], r1y = m[5], r1z = m[6];   // local +Y
  const r2x = m[8],  r2y = m[9],  r2z = m[10]; // local +Z
  const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
  out.set(
    dx * r0x + dy * r0y + dz * r0z,
    dx * r1x + dy * r1y + dz * r1z,
    dx * r2x + dy * r2y + dz * r2z);
  return out;
}

/* Mede a maior coordenada NDC absoluta (em modulo) de um conjunto de pontos
   mundo projetados com a camera dada. Retorna { maxNdc }. */
function medirNdc(pontos, camera) {
  const proj = new THREE.Vector3();
  const wc = new THREE.Vector3();
  let maxNdc = 0;
  for (const p of pontos) {
    mundoParaCamera(p, camera, wc);
    proj.copy(wc).applyMatrix4(camera.projectionMatrix);
    const ndcX = Math.abs(proj.x), ndcY = Math.abs(proj.y);
    if (ndcX > maxNdc) maxNdc = ndcX;
    if (ndcY > maxNdc) maxNdc = ndcY;
  }
  return { maxNdc };
}

/* Enquadramento empirico e autocoerente: coloca a camera a uma distancia
   inicial, mede o quanto o personagem ocupa da moldura (NDC) e afasta a
   camera ate o personagem caber com a margem aprovada (9% de borda, ou seja,
   o corpo ocupa no maximo 91% de cada eixo). Repete algumas vezes para
   convergir (a profundidade de cada ponto nao e linear na distancia). */
/* Coleta todos os vertices deformados (sem amostragem esparsa) nos instantes
   do clipe, para o enquadramento enxergar as extremidades verdadeiras
   (maos, pes, cabeca). */
const amostrasTempo = [0, 0.25, 0.5, 0.75, 0.95];
const pontosGeral = [];
for (const fracao of amostrasTempo) {
  const pedacos = capturarFase(duracao * fracao);
  pedacos.forEach(pedaco => {
    const { verts } = pedaco;
    for (let i = 0; i < verts.length; i += 3) {
      pontosGeral.push(new THREE.Vector3(verts[i], verts[i + 1], verts[i + 2]));
    }
  });
}
mixer.setTime(0);
acao.reset().play();

const caixaGeral = new THREE.Box3();
pontosGeral.forEach(p => caixaGeral.expandByPoint(p));
const centro = caixaGeral.getCenter(new THREE.Vector3());

const NDCLIMITE = 1 - MARGEM; /* 0.91: corpo dentro dos 91% centrais (9% de borda) */
/* Busca binaria na distancia para que o ponto mais externo do personagem
   fique exatamente no limite da margem (91% do quadro), nunca ultrapassando
   (garante corpo inteiro visível com a margem aprovada). maxNdc e monotonico
   decrescente com a distancia. */
function maxNdcParaDistancia(d) {
  const c = new THREE.PerspectiveCamera(FOV, LARGURA / ALTURA, 0.05, 60);
  c.position.copy(cameraPosicao(centro, d));
  c.lookAt(centro);
  c.updateMatrixWorld(true);
  return medirNdc(pontosGeral, c).maxNdc;
}
let distLo = 1.5, distHi = 12;
let distancia = 5.0;
let maxNdcMedido = 0;
for (let i = 0; i < 24; i += 1) {
  distancia = (distLo + distHi) / 2;
  maxNdcMedido = maxNdcParaDistancia(distancia);
  if (maxNdcMedido > NDCLIMITE) distLo = distancia; /* muito perto -> afasta */
  else distHi = distancia; /* cabe com margem -> aproxima para preencher */
  if (distHi - distLo < 0.005) break;
}
distancia = Math.min(Math.max(distHi, 1.5), 12); /* distHi garante maxNdc <= limite */
const camera = new THREE.PerspectiveCamera(FOV, LARGURA / ALTURA, 0.05, 60);
camera.position.copy(cameraPosicao(centro, distancia));
camera.lookAt(centro);
camera.updateMatrixWorld(true);
const medidaFinal = medirNdc(pontosGeral, camera);
console.log("enquadramento: centro", centro.toArray().map(v => +v.toFixed(2)),
  "distancia", +distancia.toFixed(2), "maxNdc", +medidaFinal.maxNdc.toFixed(3),
  "limite", NDCLIMITE);

/* ------------------------------------------------------------------ */
/* Luzes (mesmas do modo apresentacao de forja-3d-cena.js)            */
/* ------------------------------------------------------------------ */

const LUZES = [
  { direcao: new THREE.Vector3(1.8, 3.2, 2.6).normalize(), cor: [1.0, 1.0, 1.0], forca: 2.4 * 0.35 },
  { direcao: new THREE.Vector3(-2.4, 1.6, -2.2).normalize(), cor: [0.75, 0.95, 0.42], forca: 0.9 * 0.35 },
];
const AMBIENTE = [0.5, 0.46, 0.4]; /* hemisfereo ceu/terra, contribuição baixa */
const FUNDO = [0.071, 0.063, 0.063]; /* #121010 */

/* ------------------------------------------------------------------ */
/* Rasterizador de CPU                                                 */
/* ------------------------------------------------------------------ */

function criarAlvo(largura, altura) {
  const cor = new Uint8Array(largura * altura * 3);
  const profundidade = new Float32Array(largura * altura).fill(Infinity);
  const fundo = new Uint8Array(largura * altura * 3);
  for (let i = 0; i < largura * altura; i += 1) {
    cor[i * 3] = FUNDO[0] * 255;
    cor[i * 3 + 1] = FUNDO[1] * 255;
    cor[i * 3 + 2] = FUNDO[2] * 255;
    fundo[i * 3] = FUNDO[0] * 255;
    fundo[i * 3 + 1] = FUNDO[1] * 255;
    fundo[i * 3 + 2] = FUNDO[2] * 255;
  }
  return { largura, altura, cor, profundidade, fundo };
}

function gamma(v) {
  return Math.pow(Math.max(0, Math.min(1, v)), 1 / 1.9) * 255;
}

/* Iluminação por PIXEL (Phong difuso), como o WebGL oficial: interpola a
   normal suave e a cor base da textura, normaliza a normal e só então aplica
   as luzes. Interpolar cores JÁ iluminadas (Gouraud) produzia faixas em
   zigue-zague nas superfícies curvas de baixa malha do manequim. */
function desenharTriangulo(alvo, a, b, c, ca, cb, cc, normais, ia, ib, ic) {
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(area) < 1e-6) return;
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(alvo.largura - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(alvo.altura - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  const cor = alvo.cor;
  const profundidade = alvo.profundidade;
  const largura = alvo.largura;
  const na0 = normais[ia * 3], na1 = normais[ia * 3 + 1], na2 = normais[ia * 3 + 2];
  const nb0 = normais[ib * 3], nb1 = normais[ib * 3 + 1], nb2 = normais[ib * 3 + 2];
  const nc0 = normais[ic * 3], nc1 = normais[ic * 3 + 1], nc2 = normais[ic * 3 + 2];
  const numeroLuzes = LUZES.length;
  for (let y = minY; y <= maxY; y += 1) {
    const baseLinha = y * largura;
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const w0 = ((b.x - px) * (c.y - py) - (c.x - px) * (b.y - py)) / area;
      const w1 = ((c.x - px) * (a.y - py) - (a.x - px) * (c.y - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.0001 || w1 < -0.0001 || w2 < -0.0001) continue;
      const z = w0 * a.z + w1 * b.z + w2 * c.z;
      const indice = baseLinha + x;
      if (z >= profundidade[indice]) continue;
      profundidade[indice] = z;
      let nx = w0 * na0 + w1 * nb0 + w2 * nc0;
      let ny = w0 * na1 + w1 * nb1 + w2 * nc1;
      let nz = w0 * na2 + w1 * nb2 + w2 * nc2;
      const comprimento = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= comprimento; ny /= comprimento; nz /= comprimento;
      const r = w0 * ca[0] + w1 * cb[0] + w2 * cc[0];
      const g = w0 * ca[1] + w1 * cb[1] + w2 * cc[1];
      const bl = w0 * ca[2] + w1 * cb[2] + w2 * cc[2];
      let lr = r * AMBIENTE[0], lg = g * AMBIENTE[1], lb = bl * AMBIENTE[2];
      for (let li = 0; li < numeroLuzes; li += 1) {
        const luz = LUZES[li];
        const dif = Math.max(0, nx * luz.direcao.x + ny * luz.direcao.y + nz * luz.direcao.z);
        const k = luz.forca * dif;
        lr += r * luz.cor[0] * k;
        lg += g * luz.cor[1] * k;
        lb += bl * luz.cor[2] * k;
      }
      cor[indice * 3] = gamma(lr);
      cor[indice * 3 + 1] = gamma(lg);
      cor[indice * 3 + 2] = gamma(lb);
    }
  }
}

function renderizarFrame(pedacos, alvo) {
  /* Limpa COR e PROFUNDIDADE a cada quadro. Sem limpar a cor, os quadros
     anteriores ficam como rastro: a perna que varre um arco vira um "leque"
     e as bordas acumuladas viram zigue-zagues que não existem no WebGL. */
  alvo.cor.set(alvo.fundo);
  alvo.profundidade.fill(Infinity);
  const projetado = new THREE.Vector3();
  const pontoMundo = new THREE.Vector3();
  for (const pedaco of pedacos) {
    const { malha, verts, normais, total } = pedaco;
    const mat = materialDaMalha(malha);
    const atributos = atributosPorMalha.get(malha);
    const indice = atributos.indice;
    const uv = atributos.uv;
    const textura = mat.textura && !SEM_TEXTURA ? mat.textura : null;
    const fator = mat.fator;
    const projetados = [];
    /* projeta todos os vertices deformados desta malha */
    for (let i = 0; i < total; i += 1) {
      const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
      pontoMundo.set(x, y, z);
      mundoParaCamera(pontoMundo, camera, projetado);
      projetado.applyMatrix4(camera.projectionMatrix);
      projetados.push({
        x: (projetado.x * 0.5 + 0.5) * alvo.largura,
        y: (-projetado.y * 0.5 + 0.5) * alvo.altura,
        z: projetado.z,
      });
    }
    const totalIndexado = indice ? indice.count : total;
    for (let i = 0; i < totalIndexado; i += 3) {
      const ii = indice ? indice.getX(i) : i;
      const ij = indice ? indice.getX(i + 1) : i + 1;
      const ik = indice ? indice.getX(i + 2) : i + 2;
      const pa = projetados[ii]; const pb = projetados[ij]; const pc = projetados[ik];
      if (!pa || !pb || !pc) continue;
      if (pa.z < -1 || pa.z > 1 || pb.z < -1 || pb.z > 1 || pc.z < -1 || pc.z > 1) continue;
      /* Cores BASE (não iluminadas) por vértice: a iluminação é aplicada por
         pixel em desenharTriangulo, com a normal suave interpolada. */
      let corA, corB, corC;
      if (textura && uv) {
        /* UV por vertice (sem skinning de UV — malha nao se desfaz) */
        const lerUV = k => {
          const [u, v] = uvDoVertice(uv, k);
          return amostraTextura(textura, u, v) || fator;
        };
        corA = lerUV(ii);
        corB = lerUV(ij);
        corC = lerUV(ik);
      } else {
        corA = fator; corB = fator; corC = fator;
      }
      desenharTriangulo(alvo, pa, pb, pc, corA, corB, corC, normais, ii, ij, ik);
    }
  }
}

/* ------------------------------------------------------------------ */
/* PNG (RGB, sem filtro) para salvar quadros de inspecao               */
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
        linhas[destinoLinha + canal] = cor[origem + canal];
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

  const PASTA_QUADROS = typeof opcoes["salvar-quadros"] === "string" ? opcoes["salvar-quadros"] : null;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(linhas, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
  return PASTA_QUADROS;
}

/* ------------------------------------------------------------------ */
/* BMP: a conversão de quadro RGB -> BMP 24bpp (top-down, padding por   */
/* linha, ordem BGR) vive em tools/lib/bmp-frame.mjs e é testada em     */
/* tests/bmp-frame.test.mjs. Nenhuma cor é ajustada neste arquivo.      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* ffmpeg.wasm                                                         */
/* ------------------------------------------------------------------ */

const ffmpeg = await createFFmpegCore({
  print: mensagem => { if (mensagem) console.log("[ffmpeg]", String(mensagem).slice(0, 160)); },
  printErr: mensagem => { if (mensagem) console.log("[ffmpeg]", String(mensagem).slice(0, 160)); },
});

const alvo = criarAlvo(LARGURA, ALTURA);
const PASTA_QUADROS = typeof opcoes["salvar-quadros"] === "string" ? opcoes["salvar-quadros"] : null;
const t0 = performance.now();

for (let frame = 0; frame < totalFrames; frame += 1) {
  const tempo = (duracao * frame) / totalFrames;
  const pedacos = capturarFase(tempo, true);
  renderizarFrame(pedacos, alvo);
  const nome = `frame-${String(frame + 1).padStart(4, "0")}.bmp`;
  ffmpeg.FS.writeFile(nome, bmpDeFrame(alvo));
  if (PASTA_QUADROS && (frame === 0 || frame === Math.floor(totalFrames / 2) || frame === totalFrames - 1)) {
    escreverPNG(path.join(PASTA_QUADROS, `quadro-${String(frame + 1).padStart(4, "0")}.png`), { largura: LARGURA, altura: ALTURA, cor: new Uint8Array(alvo.cor) });
  }
  if ((frame + 1) % 30 === 0) {
    const ms = performance.now() - t0;
    console.log(`  quadro ${frame + 1}/${totalFrames} (${((frame + 1) / totalFrames * 100).toFixed(0)}%, ${(ms / 1000).toFixed(1)}s)`);
  }
}

const t1 = performance.now();
const argumento = [
  "-framerate", String(FPS),
  "-i", "frame-%04d.bmp",
  "-c:v", "libx264",
  "-preset", "ultrafast",
  "-crf", "24",
  "-pix_fmt", "yuv420p",
  "-r", String(FPS),
  "-movflags", "+faststart",
  "-an",
  "output.mp4",
];
const ret = ffmpeg.exec(...argumento);
console.log("ffmpeg ret:", ret, "encode em", (performance.now() - t1).toFixed(0), "ms");
if (ret !== 0) throw new Error("ffmpeg falhou com codigo " + ret);

const mp4 = ffmpeg.FS.readFile("output.mp4");
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, Buffer.from(mp4));
const meta = lerMP4(SAIDA);
const problemas = [];
if (meta.largura !== LARGURA || meta.altura !== ALTURA) problemas.push(`resolucao ${meta.largura}x${meta.altura}`);
if (meta.fps === null || Math.abs(meta.fps - FPS) > 0.05) problemas.push(`fps ${meta.fps}`);
if (meta.proporcao === null || Math.abs(meta.proporcao - 16 / 9) > 0.002) problemas.push(`proporcao ${meta.proporcao}`);
if (meta.temAudio) problemas.push("audio presente");
if (!meta.temVideo) problemas.push("sem video");
if (problemas.length) throw new Error("MP4 fora da especificacao: " + problemas.join("; "));

console.log("OK:", path.relative(raiz, SAIDA), JSON.stringify({
  bytes: mp4.length,
  largura: meta.largura,
  altura: meta.altura,
  fps: meta.fps,
  duracaoS: meta.duracaoS,
  codec: meta.codec,
  proporcao: meta.proporcao,
  renderMs: Math.round(performance.now() - t0),
  encodeMs: Math.round(performance.now() - t1),
}));
