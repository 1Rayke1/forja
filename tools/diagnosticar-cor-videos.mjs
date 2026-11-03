#!/usr/bin/env node
/*
  FORJA — diagnóstico da divergência de cor encontrada na verificação dos
  28 MP4. Não corrige e não re-renderiza nada: apenas reproduz, com um quadro
  de referência já salvo, o caminho quadro → BMP → H.264 → decodificação.

  Hipótese testada: `bmpDeFrame()` em tools/renderizar-videos-3d.mjs alinha
  o padding ao offset ABSOLUTO do arquivo (`o % 4`), mas o cabeçalho tem 54
  bytes (não múltiplo de 4). Na primeira linha isso insere 2 bytes fantasmas;
  como o buffer já foi dimensionado sem padding, os 2 incrementos de `o` não
  escrevem nada e deslocam todas as linhas seguintes em 2 bytes. Como 2 não é
  múltiplo de 3, os canais BGR giram e a madeira bege vira verde-azulada.

  Uso:
    node tools/diagnosticar-cor-videos.mjs

  Saída:
    docs/validacao-3d/verificacao-28-videos/diagnostico-cor.json
    resumo no stdout; exit 1 se a cadeia causal não se confirmar.
*/

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const createFFmpegCore = require("@ffmpeg/core");
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(raiz, "docs", "validacao-3d", "verificacao-28-videos");
const W = 1280;
const H = 720;

const ffmpeg = await createFFmpegCore({ print: () => {}, printErr: () => {} });

function cabecalhoBMP(tamanho) {
  const bmp = new Uint8Array(tamanho);
  const dv = new DataView(bmp.buffer);
  bmp[0] = 0x42; bmp[1] = 0x4d;
  dv.setUint32(2, tamanho, true);
  dv.setUint32(10, 14 + 40, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, W, true);
  dv.setInt32(22, -H, true); /* topo primeiro */
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  return bmp;
}

/* Cópia exata de bmpDeFrame(), tools/renderizar-videos-3d.mjs. */
function bmpComoEscrito(cor) {
  const passoLinha = Math.ceil(W * 3 / 4) * 4;
  const tam = 14 + 40 + passoLinha * H;
  const saida = cabecalhoBMP(tam);
  let o = 14 + 40;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 3;
      saida[o++] = cor[i + 2]; // B
      saida[o++] = cor[i + 1]; // G
      saida[o++] = cor[i];     // R
    }
    while (o % 4 !== 0) saida[o++] = 0;
  }
  return saida;
}

/* Mesmo formato, com padding relativo ao início de cada linha. */
function bmpCorrigido(cor) {
  const passoLinha = Math.ceil(W * 3 / 4) * 4;
  const tam = 14 + 40 + passoLinha * H;
  const saida = cabecalhoBMP(tam);
  for (let y = 0; y < H; y += 1) {
    const inicioLinha = 14 + 40 + y * passoLinha;
    let o = inicioLinha;
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 3;
      saida[o++] = cor[i + 2];
      saida[o++] = cor[i + 1];
      saida[o++] = cor[i];
    }
    while (o - inicioLinha < passoLinha) saida[o++] = 0;
  }
  return saida;
}

function mediaClaros(buf) {
  const soma = [0, 0, 0];
  let n = 0;
  for (let i = 0; i + 2 < buf.length && i < W * H * 3; i += 3) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    if (r + g + b > 180) { soma[0] += r; soma[1] += g; soma[2] += b; n += 1; }
  }
  return { amostras: n, rgb: n ? soma.map(v => Number((v / n).toFixed(1))) : null };
}

function distancia(a, b) {
  return Number(Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0)).toFixed(1));
}

const ARGS_ENCODE = [
  "-framerate", "30", "-i", "quadro.bmp", "-frames:v", "1",
  "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24",
  "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", "-an", "saida.mp4",
];

function medirMP4(rotulo, mp4) {
  ffmpeg.FS.writeFile("v.mp4", mp4);
  const ret = ffmpeg.exec("-i", "v.mp4", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "v.raw");
  if (ret !== 0) throw new Error(`${rotulo}: decodificação falhou (${ret})`);
  const media = mediaClaros(ffmpeg.FS.readFile("v.raw"));
  for (const alvo of ["v.mp4", "v.raw"]) { try { ffmpeg.FS.unlink(alvo); } catch { /* já removido */ } }
  return media.rgb;
}

function codificar(rotulo, bmp) {
  ffmpeg.FS.writeFile("quadro.bmp", bmp);
  const ret = ffmpeg.exec(...ARGS_ENCODE);
  if (ret !== 0) throw new Error(`${rotulo}: codificação falhou (${ret})`);
  const mp4 = Buffer.from(ffmpeg.FS.readFile("saida.mp4"));
  for (const alvo of ["quadro.bmp", "saida.mp4"]) { try { ffmpeg.FS.unlink(alvo); } catch { /* já removido */ } }
  return medirMP4(rotulo, mp4);
}

/* 1. Quadro de referência salvo pelo próprio rasterizador (antes do BMP). */
const referenciaPNG = path.join(DIR, "quadros", "rasterizador-antes-do-encoder.png");
if (!fs.existsSync(referenciaPNG)) throw new Error("rode antes: node tools/verificar-videos-exercicios.mjs --reproduzir --quadros");
ffmpeg.FS.writeFile("ref.png", fs.readFileSync(referenciaPNG));
ffmpeg.exec("-i", "ref.png", "-pix_fmt", "rgb24", "-f", "rawvideo", "ref.raw");
const cor = ffmpeg.FS.readFile("ref.raw");
const corReferencia = mediaClaros(cor);
try { ffmpeg.FS.unlink("ref.png"); ffmpeg.FS.unlink("ref.raw"); } catch { /* já removido */ }

/* 2. As duas variantes do escritor de BMP. */
const escrito = bmpComoEscrito(cor);
const corrigido = bmpCorrigido(cor);
let primeiraDiferenca = -1;
for (let i = 0; i < escrito.length; i += 1) {
  if (escrito[i] !== corrigido[i]) { primeiraDiferenca = i; break; }
}
const linha0Identica = Buffer.from(escrito.slice(54, 54 + W * 3)).equals(
  Buffer.from(corrigido.slice(54, 54 + W * 3)),
);
const corEscrito = codificar("bmpComoEscrito", escrito);
const corCorrigido = codificar("bmpCorrigido", corrigido);

/* 3. MP4 efetivamente publicado. */
const publicado = path.join(raiz, "assets", "videos", "exercicios", "cal-agachamento-masculino-horizontal-16x9.mp4");
const corPublicado = medirMP4("publicado", fs.readFileSync(publicado));

const resultado = {
  geradoEm: new Date().toISOString(),
  quadroDeReferencia: path.relative(raiz, referenciaPNG),
  mp4Publicado: path.relative(raiz, publicado),
  corDosPixelsClaros: {
    rasterizador: corReferencia.rgb,
    bmpCorrigido: corCorrigido,
    bmpComoEscrito: corEscrito,
    mp4Publicado: corPublicado,
  },
  distancias: {
    publicadoVsRasterizador: distancia(corPublicado, corReferencia.rgb),
    publicadoVsBmpComoEscrito: distancia(corPublicado, corEscrito),
    publicadoVsBmpCorrigido: distancia(corPublicado, corCorrigido),
    rasterizadorVsBmpCorrigido: distancia(corReferencia.rgb, corCorrigido),
  },
  bmp: {
    bytes: escrito.length,
    primeiraDiferencaEntreWriters: primeiraDiferenca,
    offsetFimDaPrimeiraLinha: 14 + 40 + W * 3,
    linha0Identica,
    deslocamentoAposLinha0: 2,
  },
  conclusao: null,
};

const causalidadeConfirmada =
  Math.abs(primeiraDiferenca - (14 + 40 + W * 3)) <= 1 &&
  linha0Identica &&
  resultado.distancias.publicadoVsBmpComoEscrito < 10 &&
  resultado.distancias.publicadoVsRasterizador > 50 &&
  resultado.distancias.rasterizadorVsBmpCorrigido < 10;

resultado.conclusao = causalidadeConfirmada
  ? "CONFIRMADO: o deslocamento de 2 bytes em bmpDeFrame gira os canais BGR e explica a cor verde-azulada dos 28 MP4."
  : "NÃO CONFIRMADO: revise a hipótese antes de publicar este diagnóstico.";

fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, "diagnostico-cor.json"), JSON.stringify(resultado, null, 2) + "\n");

console.log("Cor média dos pixels claros (RGB):");
console.log("  rasterizador (referência) :", corReferencia.rgb.join(", "));
console.log("  BMP corrigido → MP4       :", corCorrigido.join(", "));
console.log("  BMP como escrito → MP4    :", corEscrito.join(", "));
console.log("  MP4 publicado             :", corPublicado.join(", "));
console.log("Primeira diferença entre os writers:", primeiraDiferenca, "| fim da linha 0:", 14 + 40 + W * 3);
console.log("Distância publicado↔como-escrito:", resultado.distancias.publicadoVsBmpComoEscrito);
console.log("Distância publicado↔rasterizador:", resultado.distancias.publicadoVsRasterizador);
console.log(resultado.conclusao);
process.exit(causalidadeConfirmada ? 0 : 1);
