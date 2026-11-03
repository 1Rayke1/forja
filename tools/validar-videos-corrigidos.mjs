#!/usr/bin/env node
/*
  FORJA — validação offline dos 28 MP4 re-renderizados + mosaicos de
  comparação com as referências oficiais dos personagens.

  O que faz (sem re-renderizar, sem publicar, sem alterar modelos):
    1. Confere o manifesto contra TODOS os arquivos (caminhos, status e os 9
       metadados gravados por vídeo) e procura MP4 órfãos.
    2. Mede cada MP4 (probe ISO-BMFF), confere SHA-256 e prova que os 28
       mudaram em relação ao estado anterior (hashes-antes.json).
    3. Decodifica o primeiro quadro com ffmpeg.wasm e mede fundo, cor média
       do personagem, cromaticidade da madeira e enquadramento (bbox).
    4. Gera mosaicos PNG com as referências oficiais (PNGs de frente/perfil e
       referências WebGL do próprio app), os quadros ANTES (verde-azulado) e
       os 28 quadros DEPOIS (corrigidos), com rótulos desenhados em bitmap.

  Uso: node tools/validar-videos-corrigidos.mjs
*/

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { lerMP4 } from "./lib/probe-mp4.mjs";
import { canvas, retangulo, texto, imagem, escreverPNG } from "./lib/mosaico.mjs";
import jpeg from "jpeg-js";

const require = createRequire(import.meta.url);
const createFFmpegCore = require("@ffmpeg/core");
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(raiz, "docs", "validacao-3d", "correcao-videos-28");
const DIR_QUADROS = path.join(DIR, "quadros");
const DIR_MOSAICOS = path.join(DIR, "mosaicos");
fs.mkdirSync(DIR_MOSAICOS, { recursive: true });

const ffmpeg = await createFFmpegCore({ print: () => {}, printErr: () => {} });
const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");
const arredondar = (v, n = 2) => Number(v.toFixed(n));

/* -------------------- decodificação via ffmpeg.wasm -------------------- */
let contador = 0;
function decodificarPNGRGB(arquivoOuBuffer) {
  const nome = `p${contador++}.png`, bruto = `p${contador++}.raw`;
  ffmpeg.FS.writeFile(nome, Buffer.isBuffer(arquivoOuBuffer) ? arquivoOuBuffer : fs.readFileSync(arquivoOuBuffer));
  const buf = Buffer.from(ffmpeg.FS.readFile(nome));
  const W = buf.readUInt32BE(16), H = buf.readUInt32BE(20);
  const ret = ffmpeg.exec("-i", nome, "-pix_fmt", "rgb24", "-f", "rawvideo", bruto);
  if (ret !== 0) throw new Error(`falha ao decodificar PNG (${ret})`);
  const rgb = ffmpeg.FS.readFile(bruto);
  for (const alvo of [nome, bruto]) { try { ffmpeg.FS.unlink(alvo); } catch { /* ok */ } }
  return { rgb, W, H };
}

function quadroEm(mp4, instanteS = 0, escala = null) {
  const entrada = `v${contador++}.mp4`, saida = `v${contador++}.raw`;
  ffmpeg.FS.writeFile(entrada, fs.readFileSync(mp4));
  const args = [];
  if (instanteS > 0) args.push("-ss", instanteS.toFixed(3));
  args.push("-i", entrada, "-frames:v", "1");
  if (escala) args.push("-vf", `scale=${escala[0]}:${escala[1]}`);
  args.push("-pix_fmt", "rgb24", "-f", "rawvideo", saida);
  const ret = ffmpeg.exec(...args);
  if (ret !== 0) throw new Error(`falha ao decodificar ${mp4} (${ret})`);
  const W = escala ? escala[0] : 1280, H = escala ? escala[1] : 720;
  const lido = ffmpeg.FS.readFile(saida);
  const rgb = new Uint8Array(W * H * 3);
  rgb.set(lido.subarray(0, Math.min(lido.length, rgb.length)));
  for (const alvo of [entrada, saida]) { try { ffmpeg.FS.unlink(alvo); } catch { /* ok */ } }
  return { rgb, W, H };
}
const primeiroQuadro = (mp4, escala = null) => quadroEm(mp4, 0, escala);

function medidaDeCor(rgb, W, H) {
  const canto = [rgb[0], rgb[1], rgb[2]];
  let fundo = [0, 0, 0], nf = 0;
  for (const [x, y] of [[2, 2], [W - 10, 2], [2, H - 10], [W - 10, H - 10]]) {
    for (let dy = 0; dy < 8; dy += 1) for (let dx = 0; dx < 8; dx += 1) {
      const i = ((y + dy) * W + (x + dx)) * 3;
      fundo[0] += rgb[i]; fundo[1] += rgb[i + 1]; fundo[2] += rgb[i + 2]; nf += 1;
    }
  }
  fundo = fundo.map(v => arredondar(v / nf, 1));
  let soma = [0, 0, 0], n = 0, minx = W, maxx = 0, miny = H, maxy = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 3;
    const d = Math.abs(rgb[i] - fundo[0]) + Math.abs(rgb[i + 1] - fundo[1]) + Math.abs(rgb[i + 2] - fundo[2]);
    if (d > 60) {
      soma[0] += rgb[i]; soma[1] += rgb[i + 1]; soma[2] += rgb[i + 2]; n += 1;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
  }
  return {
    fundo,
    corPersonagem: n ? soma.map(v => arredondar(v / n, 1)) : null,
    pixelsPersonagem: n,
    bbox: n ? [minx, miny, maxx, maxy] : null,
  };
}

function corTextura(personagem) {
  const glb = fs.readFileSync(path.join(raiz, "assets", "3d", "personagens", `${personagem}.glb`));
  let off = 12, json = null, bin = null;
  while (off < glb.length) {
    const t = glb.readUInt32LE(off), tipo = glb.toString("latin1", off + 4, off + 8);
    const d = glb.subarray(off + 8, off + 8 + t);
    if (tipo === "JSON") json = JSON.parse(d.toString("utf8").replace(/\0+$/g, ""));
    else if (tipo.startsWith("BIN")) bin = d;
    off += 8 + t;
  }
  const im = json.images[0], v = json.bufferViews[im.bufferView];
  const dec = jpeg.decode(new Uint8Array(bin.subarray(v.byteOffset, v.byteOffset + v.byteLength)));
  const soma = [0, 0, 0]; let n = 0;
  for (let i = 0; i + 3 < dec.data.length; i += 4) { soma[0] += dec.data[i]; soma[1] += dec.data[i + 1]; soma[2] += dec.data[i + 2]; n += 1; }
  return soma.map(x => arredondar(x / n, 1));
}
const TEXTURA = { masculino: corTextura("masculino"), feminino: corTextura("feminino") };
const cromaticidade = c => { const s = c[0] + c[1] + c[2]; return c.map(v => v / s); };
const distCrom = (a, b) => {
  const ca = cromaticidade(a), cb = cromaticidade(b);
  return arredondar(Math.sqrt(ca.reduce((s, v, i) => s + (v - cb[i]) ** 2, 0)), 4);
};

/* ----------------------------- validação ----------------------------- */
const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, "assets/3d/apresentacao-exercicios.json"), "utf8"));
const antes = JSON.parse(fs.readFileSync(path.join(DIR, "hashes-antes.json"), "utf8")).arquivos;
const intermediarios = JSON.parse(fs.readFileSync(path.join(DIR, "hashes-intermediarios.json"), "utf8")).arquivos;
const semLimpeza = JSON.parse(fs.readFileSync(path.join(DIR, "hashes-sem-limpeza.json"), "utf8")).arquivos;
const noDisco = fs.readdirSync(path.join(raiz, "assets/videos/exercicios")).filter(n => n.endsWith(".mp4")).sort();
const esperados = [];
for (const exercicio of manifesto.exercicios) {
  if (exercicio.modo !== "video") continue;
  for (const personagem of ["masculino", "feminino"]) {
    const entrada = exercicio.video && exercicio.video[personagem];
    if (entrada && entrada.arquivo) esperados.push({ exercicioId: exercicio.id, personagem, arquivo: entrada.arquivo, entrada });
  }
}

/* Auditoria explícita da grade 14 exercícios × 2 personagens. */
const emModoVideo = manifesto.exercicios.filter(e => e.modo === "video");
const grade14x2 = emModoVideo.map(exercicio => {
  const generos = ["masculino", "feminino"].map(g => ({
    personagem: g,
    status: exercicio.video && exercicio.video[g] ? exercicio.video[g].status : null,
    arquivo: exercicio.video && exercicio.video[g] ? exercicio.video[g].arquivo : null,
    existe: Boolean(exercicio.video && exercicio.video[g] && exercicio.video[g].arquivo &&
      fs.existsSync(path.join(raiz, exercicio.video[g].arquivo))),
  }));
  return { exercicioId: exercicio.id, clipeId: exercicio.clipeId, generos,
    completo: generos.every(g => g.status === "pronto" && g.existe) };
});

const problemas = [];
const videos = [];
const quadros = {};
const quadrosMeio = {};
const quadrosFim = {};
for (const esperado of esperados) {
  const absoluto = path.join(raiz, esperado.arquivo);
  const nome = path.basename(esperado.arquivo);
  const bytes = fs.readFileSync(absoluto);
  const hash = sha256(bytes);
  const meta = lerMP4(absoluto);
  const campos = ["bytes", "largura", "altura", "fps", "duracaoS", "codec", "temVideo", "temAudio", "proporcao"];
  const divergencias = campos.filter(c => esperado.entrada.meta[c] !== meta[c]);
  const checagens = {
    manifesto: esperado.entrada.status === "pronto" && esperado.entrada.meta.arquivo === esperado.arquivo && divergencias.length === 0,
    especificacao: meta.largura === 1280 && meta.altura === 720 && meta.fps === 30 && meta.codec === "avc1" &&
      meta.temVideo === true && meta.temAudio === false && Math.abs(meta.proporcao - 16 / 9) <= 0.002,
    rerenderizado: antes[nome] ? antes[nome].sha256 !== hash : false,
    sombreamentoAplicado: intermediarios[nome] ? intermediarios[nome].sha256 !== hash : false,
    limpezaDeQuadroAplicada: semLimpeza[nome] ? semLimpeza[nome].sha256 !== hash : false,
  };
  const completo = primeiroQuadro(absoluto);
  const medida = medidaDeCor(completo.rgb, completo.W, completo.H);
  const cor = medida.corPersonagem;
  const crom = cor ? distCrom(cor, TEXTURA[esperado.personagem]) : null;
  checagens.corMadeira = Boolean(cor) && crom !== null && crom <= 0.08 && cor[0] > cor[1] && cor[1] > cor[2];
  checagens.fundo = medida.fundo.every((v, i) => Math.abs(v - [18, 16, 16][i]) <= 8);
  checagens.enquadramento = Boolean(medida.bbox) && medida.bbox[0] > 0 && medida.bbox[1] > 0 &&
    medida.bbox[2] < 1279 && medida.bbox[3] < 719 && medida.pixelsPersonagem > 1000;

  const pequeno = primeiroQuadro(absoluto, [320, 180]);
  quadros[nome] = pequeno;
  /* Mais dois instantes por vídeo: a correção de UV precisa valer durante a
     animação inteira, não só no primeiro quadro. */
  const meio = quadroEm(absoluto, meta.duracaoS * 0.5, [320, 180]);
  const fim = quadroEm(absoluto, meta.duracaoS * 0.85, [320, 180]);
  quadrosMeio[nome] = meio;
  quadrosFim[nome] = fim;
  const medidasExtras = [meio, fim].map(q => {
    const m = medidaDeCor(q.rgb, q.W, q.H);
    return {
      corPersonagem: m.corPersonagem, pixelsPersonagem: m.pixelsPersonagem, bbox: m.bbox,
      distanciaCromaticidade: m.corPersonagem ? distCrom(m.corPersonagem, TEXTURA[esperado.personagem]) : null,
    };
  });
  checagens.corEmTodosOsInstantes = medidasExtras.every(m =>
    Boolean(m.corPersonagem) && m.distanciaCromaticidade !== null && m.distanciaCromaticidade <= 0.08 &&
    m.corPersonagem[0] > m.corPersonagem[1] && m.corPersonagem[1] > m.corPersonagem[2] &&
    m.pixelsPersonagem > 100 && Boolean(m.bbox) && m.bbox[0] > 0 && m.bbox[2] < 319);
  for (const [chave, ok] of Object.entries(checagens)) if (!ok) problemas.push(`${nome}: ${chave}`);

  videos.push({
    ...esperado, nome, bytes: bytes.length, sha256: hash,
    sha256Anterior: antes[nome] ? antes[nome].sha256 : null,
    sha256Intermediario: intermediarios[nome] ? intermediarios[nome].sha256 : null,
    sha256SemLimpeza: semLimpeza[nome] ? semLimpeza[nome].sha256 : null,
    medido: meta, divergenciasDoManifesto: divergencias,
    corTexturaOficial: TEXTURA[esperado.personagem],
    distanciaCromaticidade: crom,
    quadro: medida,
    instantes: [
      { tempoS: 0, corPersonagem: medida.corPersonagem, distanciaCromaticidade: crom },
      { tempoS: arredondar(meta.duracaoS * 0.5, 3), ...medidasExtras[0] },
      { tempoS: arredondar(meta.duracaoS * 0.85, 3), ...medidasExtras[1] },
    ],
    checagens,
  });
}
const referencias = new Set(esperados.map(e => path.basename(e.arquivo)));
const orfaos = noDisco.filter(n => !referencias.has(n));
if (orfaos.length) problemas.push(`MP4 órfãos: ${orfaos.join(", ")}`);
if (emModoVideo.length !== 14) problemas.push(`esperados 14 exercícios em modo vídeo, há ${emModoVideo.length}`);
if (manifesto.resumo && manifesto.resumo.comVideoPronto !== 14) {
  problemas.push(`resumo.comVideoPronto = ${manifesto.resumo.comVideoPronto}, esperado 14`);
}
for (const linha of grade14x2) {
  if (!linha.completo) problemas.push(`grade 14x2 incompleta: ${linha.exercicioId}`);
}

/* ------------------------------ mosaicos ------------------------------ */
const CELULA_W = 320, CELULA_H = 180, BARRA = 26;
function grade(colunas, linhas, titulo) {
  const img = canvas(colunas * CELULA_W, linhas * (CELULA_H + BARRA) + 40);
  retangulo(img, 0, 0, img.largura, 34, [32, 28, 26]);
  texto(img, titulo, 10, 8, [245, 235, 210], 2);
  return img;
}
function celula(img, coluna, linha, rgb, W, H, rotulo, corRotulo = [235, 230, 215]) {
  const x = coluna * CELULA_W, y = 40 + linha * (CELULA_H + BARRA);
  retangulo(img, x, y, CELULA_W, CELULA_H, [18, 16, 16]);
  imagem(img, rgb, W, H, x, y, CELULA_W, CELULA_H);
  retangulo(img, x, y + CELULA_H, CELULA_W, BARRA, [30, 27, 25]);
  texto(img, rotulo, x + 6, y + CELULA_H + 5, corRotulo, 2);
}

/* Mosaico 1: referências oficiais x ANTES x DEPOIS. */
const refPNG = {};
for (const [chave, arquivo] of Object.entries({
  "REF MASC FRENTE": "personagem-masculino-frente.png",
  "REF MASC PERFIL": "personagem-masculino-perfil.png",
  "REF FEM FRENTE": "personagem-feminino-frente.png",
  "REF FEM PERFIL": "personagem-feminino-perfil.png",
})) refPNG[chave] = decodificarPNGRGB(path.join(raiz, "docs/validacao-3d/fase2", arquivo));
const refWebGL = {};
for (const p of ["masculino", "feminino"]) {
  refWebGL[p] = decodificarPNGRGB(path.join(DIR_QUADROS, `referencia-webgl-${p}.png`));
}
const antesM = decodificarPNGRGB(path.join(DIR_QUADROS, "antes-masculino.png"));
const antesF = decodificarPNGRGB(path.join(DIR_QUADROS, "antes-feminino.png"));
const raster = decodificarPNGRGB(path.join(DIR_QUADROS, "referencia-rasterizador-bege.png"));
const depoisM = quadros["cal-agachamento-masculino-horizontal-16x9.mp4"];
const depoisF = quadros["cal-agachamento-feminino-horizontal-16x9.mp4"];

const m1 = grade(4, 3, "COMPARACAO: REFERENCIAS OFICIAIS / ANTES (VERDE) / DEPOIS (CORRIGIDO)");
const linhaA = [
  ["REF MASC FRENTE", refPNG["REF MASC FRENTE"]], ["REF MASC PERFIL", refPNG["REF MASC PERFIL"]],
  ["REF FEM FRENTE", refPNG["REF FEM FRENTE"]], ["REF FEM PERFIL", refPNG["REF FEM PERFIL"]],
];
const linhaB = [
  ["REF WEBGL MASC", refWebGL.masculino], ["REF WEBGL FEM", refWebGL.feminino],
  ["ANTES MASC VERDE", antesM], ["ANTES FEM VERDE", antesF],
];
const linhaC = [
  ["DEPOIS MASC BEGE", depoisM], ["DEPOIS FEM BEGE", depoisF],
  ["RASTERIZADOR BEGE", raster], ["COR MASC / FEM", null],
];
[linhaA, linhaB, linhaC].forEach((linha, l) => linha.forEach(([rotulo, dado], c) => {
  if (dado) celula(m1, c, l, dado.rgb, dado.W, dado.H, rotulo,
    rotulo.startsWith("ANTES") ? [120, 235, 190] : [235, 230, 215]);
  else {
    const x = c * CELULA_W, y = 40 + l * (CELULA_H + BARRA);
    retangulo(m1, x, y, CELULA_W, CELULA_H, [24, 21, 19]);
    retangulo(m1, x + 20, y + 30, 120, 100, TEXTURA.masculino.map(Math.round));
    retangulo(m1, x + 180, y + 30, 120, 100, TEXTURA.feminino.map(Math.round));
    texto(m1, "MASC", x + 24, y + 140, [20, 18, 16], 2);
    texto(m1, "FEM", x + 184, y + 140, [20, 18, 16], 2);
    retangulo(m1, x, y + CELULA_H, CELULA_W, BARRA, [30, 27, 25]);
    texto(m1, rotulo, x + 6, y + CELULA_H + 5, [235, 230, 215], 2);
  }
}));
escreverPNG(path.join(DIR_MOSAICOS, "mosaico-01-comparativo.png"), m1);

/* Mosaicos 2 e 3: todos os 28 quadros corrigidos, por personagem. */
const legenda = {};
for (const personagem of ["masculino", "feminino"]) {
  const lista = videos.filter(v => v.personagem === personagem);
  const m = grade(4, 4, `QUADRO INICIAL - ${personagem.toUpperCase()} - ${lista.length}/14 VIDEOS CORRIGIDOS`);
  lista.forEach((v, i) => {
    const q = quadros[v.nome];
    const rotulo = `${String(i + 1).padStart(2, "0")} ${v.exercicioId.toUpperCase()}`;
    celula(m, i % 4, Math.floor(i / 4), q.rgb, q.W, q.H, rotulo);
  });
  const arquivo = `mosaico-0${personagem === "masculino" ? 2 : 3}-corrigidos-${personagem}.png`;
  escreverPNG(path.join(DIR_MOSAICOS, arquivo), m);
  legenda[personagem] = { arquivo: path.join("mosaicos", arquivo), ordem: lista.map((v, i) => ({ posicao: i + 1, exercicioId: v.exercicioId, mp4: v.arquivo })) };
}

/* Mosaicos 4 e 5: 3 instantes por vídeo (0%, 50%, 85%), cobrindo a aparência
   do personagem durante a animação em TODOS os 28 clipes. */
const COLUNAS = ["INICIO", "MEIO", "FIM"];
for (const personagem of ["masculino", "feminino"]) {
  const lista = videos.filter(v => v.personagem === personagem);
  const m = grade(3, lista.length, `${personagem.toUpperCase()} - INICIO / MEIO / FIM - ${lista.length} VIDEOS`);
  lista.forEach((v, i) => {
    const conjuntos = [quadros[v.nome], quadrosMeio[v.nome], quadrosFim[v.nome]];
    conjuntos.forEach((q, c) => {
      const x = c * CELULA_W, y = 40 + i * (CELULA_H + BARRA);
      retangulo(m, x, y, CELULA_W, CELULA_H, [18, 16, 16]);
      imagem(m, q.rgb, q.W, q.H, x, y, CELULA_W, CELULA_H);
      retangulo(m, x, y + CELULA_H, CELULA_W, BARRA, [30, 27, 25]);
      texto(m, `${String(i + 1).padStart(2, "0")} ${COLUNAS[c]}`, x + 6, y + CELULA_H + 5, [235, 230, 215], 2);
    });
  });
  const arquivo = `mosaico-0${personagem === "masculino" ? 4 : 5}-evolucao-${personagem}.png`;
  escreverPNG(path.join(DIR_MOSAICOS, arquivo), m);
  legenda[personagem].evolucao = path.join("mosaicos", arquivo);
}

/* ------------------------------ relatório ------------------------------ */
const relatorio = {
  geradoEm: new Date().toISOString(),
  ferramenta: "tools/validar-videos-corrigidos.mjs",
  branch: execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: raiz }).toString().trim(),
  commitAntesDoPush: execFileSync("git", ["rev-parse", "HEAD"], { cwd: raiz }).toString().trim(),
  manifesto: {
    arquivo: "assets/3d/apresentacao-exercicios.json",
    resumo: manifesto.resumo,
    exerciciosEmModoVideo: emModoVideo.length,
    grade14x2,
    todasAsLinhasCompletas: grade14x2.every(l => l.completo),
  },
  texturasOficiais: TEXTURA,
  inventario: {
    mp4NoDisco: noDisco.length,
    referenciasNoManifesto: esperados.length,
    orfaos,
    todosForamRerenderizados: videos.every(v => v.checagens.rerenderizado),
    todosReceberamSombreamentoSuave: videos.every(v => v.checagens.sombreamentoAplicado),
    todosSemRastroEntreQuadros: videos.every(v => v.checagens.limpezaDeQuadroAplicada),
  },
  videos,
  mosaicos: {
    comparativo: "mosaicos/mosaico-01-comparativo.png",
    porPersonagem: legenda,
  },
  problemas,
  resultado: {
    analisados: videos.length,
    aprovados: videos.filter(v => Object.values(v.checagens).every(Boolean)).length,
    totalProblemas: problemas.length,
  },
};
fs.writeFileSync(path.join(DIR, "validacao-offline.json"), JSON.stringify(relatorio, null, 2) + "\n");
console.log(`Manifesto: ${esperados.length} referências | MP4 no disco: ${noDisco.length} | órfãos: ${orfaos.length}`);
console.log(`Re-renderizados: ${videos.filter(v => v.checagens.rerenderizado).length}/28`);
console.log(`Aprovados: ${relatorio.resultado.aprovados}/28 | problemas: ${problemas.length}`);
problemas.forEach(p => console.log("  - " + p));
console.log("Mosaicos:", fs.readdirSync(DIR_MOSAICOS).join(", "));
process.exit(problemas.length ? 1 : 0);
