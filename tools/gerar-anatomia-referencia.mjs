#!/usr/bin/env node
/*
  FORJA — recorte fiel das pranchas anatômicas fornecidas pelo usuário.

  Não desenha, reconstrói nem estiliza a anatomia. O script apenas:
  1. recorta as vistas anterior/posterior da mesma prancha e na mesma escala;
  2. remove por flood-fill somente o fundo branco conectado às bordas;
  3. suaviza um pixel da borda externa sem apagar fáscias/tendões internos;
  4. grava PNG RGBA e um manifesto com origem, recorte, dimensões e hashes.

  Os contornos funcionais ficam em assets/js/forja-figura.js, no mesmo espaço
  350 × 690 das imagens. Eles não participam da geração da anatomia.

  Uso: npm ci && node tools/gerar-anatomia-referencia.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'anatomia');
const SOURCE_REL = 'fontes/modelo-masculino-original.jpg';
const SOURCE = path.join(OUT_DIR, SOURCE_REL);
const WIDTH = 350;
const HEIGHT = 690;
const CROPS = Object.freeze({
  front: Object.freeze({ file: 'anterior.png', x: 40, y: 16 }),
  back: Object.freeze({ file: 'posterior.png', x: 360, y: 16 })
});

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

if (!fs.existsSync(SOURCE)) {
  throw new Error('Referência anatômica original ausente: ' + SOURCE);
}

const sourceBytes = fs.readFileSync(SOURCE);
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  /* Usa o mesmo pipeline gráfico dos testes E2E para que a conversão de cor
     JPEG → canvas → PNG seja reproduzível entre geração e auditoria. */
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  headless: true
});

const manifest = {
  source: SOURCE_REL,
  sourceSha256: sha256(sourceBytes),
  canvas: { width: WIDTH, height: HEIGHT },
  method: 'Recorte raster direto; flood-fill apenas do fundo externo; sem vetorização ou redesenho.',
  plates: {}
};

try {
  const page = await browser.newPage();

  for (const [view, crop] of Object.entries(CROPS)) {
    const result = await page.evaluate(async ({ base64, crop, width, height }) => {
      const image = new Image();
      image.src = 'data:image/jpeg;base64,' + base64;
      await image.decode();

      if (image.naturalWidth !== 740 || image.naturalHeight !== 740) {
        throw new Error('A referência masculina deve preservar os 740 × 740 px originais.');
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, crop.x, crop.y, width, height, 0, 0, width, height);

      const frame = context.getImageData(0, 0, width, height);
      const pixels = frame.data;
      const total = width * height;
      const background = new Uint8Array(total);
      const queue = new Int32Array(total);
      let first = 0;
      let last = 0;

      /* Equivalente visual a um fuzz pequeno: só branco quase puro entra no
         flood-fill. Como a propagação começa nas bordas, fáscias brancas
         internas não são apagadas indiscriminadamente. */
      const isBackground = offset => (
        pixels[offset] >= 237 && pixels[offset + 1] >= 237 && pixels[offset + 2] >= 237
      );
      const enqueue = index => {
        if (background[index]) return;
        const offset = index * 4;
        if (!isBackground(offset)) return;
        background[index] = 1;
        queue[last++] = index;
      };

      for (let x = 0; x < width; x += 1) {
        enqueue(x);
        enqueue((height - 1) * width + x);
      }
      for (let y = 0; y < height; y += 1) {
        enqueue(y * width);
        enqueue(y * width + width - 1);
      }

      while (first < last) {
        const index = queue[first++];
        const x = index % width;
        const y = Math.floor(index / width);
        if (x > 0) enqueue(index - 1);
        if (x + 1 < width) enqueue(index + 1);
        if (y > 0) enqueue(index - width);
        if (y + 1 < height) enqueue(index + width);
      }

      for (let index = 0; index < total; index += 1) {
        if (background[index]) pixels[index * 4 + 3] = 0;
      }

      /* Feather de um pixel apenas na fronteira externa. Os RGB nunca são
         alterados; pixels internos opacos continuam idênticos à referência. */
      const alpha = new Uint8Array(total);
      for (let index = 0; index < total; index += 1) alpha[index] = pixels[index * 4 + 3];
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          if (!alpha[index]) continue;
          const touchesBackground = !alpha[index - 1] || !alpha[index + 1] ||
            !alpha[index - width] || !alpha[index + width];
          if (!touchesBackground) continue;
          const offset = index * 4;
          const lightestChannel = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
          if (lightestChannel > 218) {
            pixels[offset + 3] = Math.min(alpha[index], Math.max(64, Math.round((247 - lightestChannel) * 9)));
          }
        }
      }

      context.putImageData(frame, 0, 0);

      let top = height;
      let left = width;
      let right = -1;
      let bottom = -1;
      let opaque = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (pixels[(y * width + x) * 4 + 3] < 128) continue;
          opaque += 1;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }

      return {
        dataUrl: canvas.toDataURL('image/png'),
        bounds: { left, top, right, bottom },
        opaque
      };
    }, {
      base64: sourceBytes.toString('base64'),
      crop,
      width: WIDTH,
      height: HEIGHT
    });

    if (result.bounds.top < 4 || result.bounds.bottom > HEIGHT - 5 ||
        result.bounds.left < 2 || result.bounds.right > WIDTH - 3 || result.opaque < 40000) {
      throw new Error('Enquadramento ou extração inesperada na vista ' + view + ': ' + JSON.stringify(result.bounds));
    }

    const png = Buffer.from(result.dataUrl.split(',')[1], 'base64');
    const destination = path.join(OUT_DIR, crop.file);
    fs.writeFileSync(destination, png);
    manifest.plates[view] = {
      file: crop.file,
      crop: { x: crop.x, y: crop.y, width: WIDTH, height: HEIGHT },
      sha256: sha256(png),
      bytes: png.length,
      bounds: result.bounds
    };
    console.log('[anatomia] ' + crop.file + ': ' + WIDTH + '×' + HEIGHT + ', ' +
      png.length + ' bytes, corpo ' + JSON.stringify(result.bounds));
  }

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('[anatomia] manifest.json atualizado; RGB de origem preservado.');
} finally {
  await browser.close();
}
