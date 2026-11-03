/*
  FORJA — compositor mínimo de mosaicos PNG (sem dependências de imagem nativa).
  Fonte bitmap 5x7 própria, desenho de células com letterbox e codificação
  PNG RGB direta (zlib + CRC32). Usado pelos validadores dos 28 MP4.
*/

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/* ------------------------- fonte bitmap 5x7 ------------------------- */
export const FONTE = {
  "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  "C": [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  "G": [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "I": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  "N": ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ">": [".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

export function canvas(largura, altura, fundo = [18, 16, 16]) {
  const cor = new Uint8Array(largura * altura * 3);
  for (let i = 0; i < largura * altura; i += 1) {
    cor[i * 3] = fundo[0]; cor[i * 3 + 1] = fundo[1]; cor[i * 3 + 2] = fundo[2];
  }
  return { largura, altura, cor };
}

export function retangulo(img, x, y, w, h, cor) {
  for (let yy = Math.max(0, y); yy < Math.min(img.altura, y + h); yy += 1) {
    for (let xx = Math.max(0, x); xx < Math.min(img.largura, x + w); xx += 1) {
      const i = (yy * img.largura + xx) * 3;
      img.cor[i] = cor[0]; img.cor[i + 1] = cor[1]; img.cor[i + 2] = cor[2];
    }
  }
}

export function texto(img, conteudo, x, y, cor = [235, 230, 215], escala = 2) {
  let px = x;
  for (const letra of conteudo.toUpperCase()) {
    const glifo = FONTE[letra] || FONTE[" "];
    for (let linha = 0; linha < 7; linha += 1) {
      for (let coluna = 0; coluna < 5; coluna += 1) {
        if (glifo[linha][coluna] !== "#") continue;
        retangulo(img, px + coluna * escala, y + linha * escala, escala, escala, cor);
      }
    }
    px += 6 * escala;
  }
}

/* Desenha uma imagem RGB com ajuste de proporção (letterbox) dentro da célula. */
export function imagem(img, rgb, imgW, imgH, x, y, celulaW, celulaH) {
  const fator = Math.min(celulaW / imgW, celulaH / imgH);
  const w = Math.round(imgW * fator), h = Math.round(imgH * fator);
  const ox = x + Math.floor((celulaW - w) / 2), oy = y + Math.floor((celulaH - h) / 2);
  for (let yy = 0; yy < h; yy += 1) {
    const sy = Math.min(imgH - 1, Math.floor(yy / fator));
    for (let xx = 0; xx < w; xx += 1) {
      const sx = Math.min(imgW - 1, Math.floor(xx / fator));
      const origem = (sy * imgW + sx) * 3;
      const destino = ((oy + yy) * img.largura + (ox + xx)) * 3;
      img.cor[destino] = rgb[origem];
      img.cor[destino + 1] = rgb[origem + 1];
      img.cor[destino + 2] = rgb[origem + 2];
    }
  }
}

export function escreverPNG(arquivo, img) {
  const { largura, altura, cor } = img;
  const linhas = Buffer.alloc((largura * 3 + 1) * altura);
  for (let y = 0; y < altura; y += 1) {
    const destino = y * (largura * 3 + 1);
    for (let x = 0; x < largura; x += 1) {
      const i = (y * largura + x) * 3, d = destino + 1 + x * 3;
      linhas[d] = cor[i]; linhas[d + 1] = cor[i + 1]; linhas[d + 2] = cor[i + 2];
    }
  }
  const tabela = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  const crc32 = b => {
    let c = 0xffffffff;
    for (const byte of b) c = tabela[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (tipo, dados) => {
    const tamanho = Buffer.alloc(4); tamanho.writeUInt32BE(dados.length, 0);
    const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corpo), 0);
    return Buffer.concat([tamanho, corpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(linhas, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

