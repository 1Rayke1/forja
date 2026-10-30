#!/usr/bin/env node
/*
  FORJA — preparação do modelo anatômico de referência.

  A prancha exibida no Atlas é a imagem fornecida pelo usuário, mantida byte a
  byte (`assets/anatomia/fontes/referencia-muscular.png`). Este script NÃO
  redesenha, não vetoriza, não recorta e não recolore o corpo.

  O que ele faz:

  1. confere dimensões e hash da referência;
  2. deriva uma silhueta a partir da própria prancha (limiar de luminância +
     fechamento morfológico) e grava `assets/anatomia/mascara.png`;
  3. registra no `manifest.json` os recortes de cada vista e os limites do
     corpo, que são os mesmos usados por `assets/js/forja-figura.js`.

  A silhueta existe apenas para impedir que a tinta dos destaques apareça fora
  do corpo. Como o fundo da prancha é preto opaco, o canal alfa dela não serve
  como máscara; a silhueta derivada é a alternativa verificável: é calculada a
  partir dos mesmos pixels exibidos, sem desenho manual.

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
const REFERENCE_REL = 'fontes/referencia-muscular.png';
const REFERENCE = path.join(OUT_DIR, REFERENCE_REL);
const MASK_FILE = 'mascara.png';
const INK_FILE = 'tinta.png';

const REFERENCE_WIDTH = 1536;
const REFERENCE_HEIGHT = 1024;

/* Espaço de desenho da figura. As duas vistas usam o mesmo tamanho de janela,
   na mesma escala, para que anterior e posterior fiquem alinhadas. */
const CANVAS = Object.freeze({ width: 600, height: 1024 });
const CROPS = Object.freeze({
  front: Object.freeze({ x: 110, y: 0 }),
  back: Object.freeze({ x: 770, y: 0 })
});

/* Parâmetros da silhueta. O limiar baixo pega os fios mais escuros do desenho;
   o fechamento de raio 8 fecha as fissuras entre fibras musculares sem unir o
   braço ao tronco nem as duas pernas. */
const THRESHOLD = 12;
const CLOSE_RADIUS = 8;
const PAD = 2;
/* Rampa da tinta: a partir de qual luminância o destaque deixa de pintar.
   Serve para a cor aparecer nas fissuras e nos ventres escuros sem cobrir as
   linhas brancas do desenho. */
const INK_RAMP = 220;

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

if (!fs.existsSync(REFERENCE)) {
  throw new Error('Referência anatômica ausente: ' + REFERENCE);
}

const referenceBytes = fs.readFileSync(REFERENCE);
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  headless: true
});

const manifest = {
  reference: {
    file: REFERENCE_REL,
    sha256: sha256(referenceBytes),
    bytes: referenceBytes.length,
    width: REFERENCE_WIDTH,
    height: REFERENCE_HEIGHT,
    background: 'preto opaco (#000000)',
    views: 'anterior à esquerda, posterior à direita, no mesmo arquivo'
  },
  canvas: { width: CANVAS.width, height: CANVAS.height },
  method: 'Referência exibida sem alteração. Silhueta derivada por limiar de ' +
    'luminância e fechamento morfológico, apenas para limitar a tinta dos destaques. ' +
    'Sem vetorização, recorte, recolorização ou redesenho do corpo.',
  mask: {
    file: MASK_FILE,
    threshold: THRESHOLD,
    closeRadius: CLOSE_RADIUS,
    pad: PAD,
    interpretation: 'branco opaco = corpo; transparente = fora do corpo'
  },
  ink: {
    file: INK_FILE,
    ramp: INK_RAMP,
    interpretation: 'opaco onde a prancha é escura dentro do corpo; transparente nas linhas claras e fora do corpo'
  },
  views: {}
};

try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><title>mascara</title>');

  const result = await page.evaluate(async ({ base64, width, height, threshold, closeRadius, pad, inkRamp, crops, canvas }) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();

    if (image.naturalWidth !== width || image.naturalHeight !== height) {
      throw new Error('A referência deve preservar as dimensões originais.');
    }

    const canvasEl = document.createElement('canvas');
    canvasEl.width = width;
    canvasEl.height = height;
    const context = canvasEl.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const frame = context.getImageData(0, 0, width, height);
    const pixels = frame.data;
    const total = width * height;

    /* 1. Limiar de luminância: qualquer fio do desenho entra na silhueta. */
    const seed = new Uint8Array(total);
    for (let index = 0; index < total; index += 1) {
      const offset = index * 4;
      const luminance = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      seed[index] = luminance > threshold ? 1 : 0;
    }

    /* 2. Fechamento morfológico com núcleo quadrado, por imagens integrais:
          dilatação seguida de erosão com o mesmo raio. */
    const integral = source => {
      const stride = width + 1;
      const sum = new Float64Array(stride * (height + 1));
      for (let y = 0; y < height; y += 1) {
        let rowSum = 0;
        for (let x = 0; x < width; x += 1) {
          rowSum += source[y * width + x];
          sum[(y + 1) * stride + (x + 1)] = sum[y * stride + (x + 1)] + rowSum;
        }
      }
      return sum;
    };
    const windowSum = (sum, x0, y0, x1, y1) => {
      const stride = width + 1;
      return sum[y1 * stride + x1] - sum[y0 * stride + x1] - sum[y1 * stride + x0] + sum[y0 * stride + x0];
    };
    const boxFilter = source => {
      const sum = integral(source);
      const out = new Uint8Array(total);
      for (let y = 0; y < height; y += 1) {
        const y0 = Math.max(0, y - closeRadius);
        const y1 = Math.min(height, y + closeRadius + 1);
        for (let x = 0; x < width; x += 1) {
          const x0 = Math.max(0, x - closeRadius);
          const x1 = Math.min(width, x + closeRadius + 1);
          out[y * width + x] = windowSum(sum, x0, y0, x1, y1) > 0 ? 1 : 0;
        }
      }
      return out;
    };

    const dilated = boxFilter(seed);
    const inverted = new Uint8Array(total);
    for (let index = 0; index < total; index += 1) inverted[index] = dilated[index] ? 0 : 1;
    const erodedOutside = boxFilter(inverted);
    const closed = new Uint8Array(total);
    for (let index = 0; index < total; index += 1) closed[index] = erodedOutside[index] ? 0 : 1;

    /* 3. Margem de segurança de dois pixels: o destaque pode encostar na borda
          do corpo sem ser cortado pela máscara. */
    const padded = boxFilter(closed);

    /* 4. Tinta: a silhueta modulada pela escuridão da própria prancha. É o que
          permite pintar a região sem cobrir as linhas brancas e sem depender
          de mix-blend-mode (que, com máscara, pintava de forma intermitente). */
    const ink = new Uint8Array(total);
    let inkPixels = 0;
    for (let index = 0; index < total; index += 1) {
      if (!padded[index]) continue;
      const offset = index * 4;
      const luminance = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      const alpha = luminance < inkRamp ? 255 : 0;
      ink[index] = alpha;
      if (alpha) inkPixels += 1;
    }

    /* 5. Silhueta em branco opaco sobre transparente. */
    for (let index = 0; index < total; index += 1) {
      const offset = index * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = padded[index] ? 255 : 0;
    }
    context.putImageData(frame, 0, 0);
    const maskUrl = canvasEl.toDataURL('image/png');

    for (let index = 0; index < total; index += 1) pixels[index * 4 + 3] = ink[index];
    context.putImageData(frame, 0, 0);

    /* 6. Limites do corpo por vista (na referência), para o manifesto. */
    const views = {};
    for (const [view, crop] of Object.entries(crops)) {
      let left = canvas.width;
      let right = -1;
      let top = canvas.height;
      let bottom = -1;
      let coverage = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (!padded[(y + crop.y) * width + (x + crop.x)]) continue;
          coverage += 1;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
      views[view] = {
        crop: { x: crop.x, y: crop.y, width: canvas.width, height: canvas.height },
        body: { left, top, right, bottom, coverage }
      };
    }

    return {
      maskDataUrl: maskUrl,
      inkDataUrl: canvasEl.toDataURL('image/png'),
      views,
      inkPixels,
      bodyPixels: padded.reduce((acc, v) => acc + v, 0)
    };
  }, {
    base64: referenceBytes.toString('base64'),
    width: REFERENCE_WIDTH,
    height: REFERENCE_HEIGHT,
    threshold: THRESHOLD,
    closeRadius: CLOSE_RADIUS,
    pad: PAD,
    inkRamp: INK_RAMP,
    crops: CROPS,
    canvas: CANVAS
  });

  for (const [view, info] of Object.entries(result.views)) {
    const body = info.body;
    if (body.left < 2 || body.right > CANVAS.width - 3) {
      throw new Error('Mãos cortadas na vista ' + view + ': ' + JSON.stringify(body));
    }
    if (body.top < 2 || body.bottom > CANVAS.height - 3) {
      throw new Error('Cabeça ou pés cortados na vista ' + view + ': ' + JSON.stringify(body));
    }
  }

  const maskPng = Buffer.from(result.maskDataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT_DIR, MASK_FILE), maskPng);
  manifest.mask.sha256 = sha256(maskPng);
  manifest.mask.bytes = maskPng.length;
  manifest.mask.bodyPixels = result.bodyPixels;

  const inkPng = Buffer.from(result.inkDataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT_DIR, INK_FILE), inkPng);
  manifest.ink.sha256 = sha256(inkPng);
  manifest.ink.bytes = inkPng.length;
  manifest.ink.paintedPixels = result.inkPixels;

  manifest.views = result.views;

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  for (const [view, info] of Object.entries(result.views)) {
    console.log('[anatomia] ' + view + ': recorte ' + JSON.stringify(info.crop) +
      ', corpo ' + JSON.stringify(info.body));
  }
  console.log('[anatomia] ' + MASK_FILE + ': ' + maskPng.length + ' bytes, ' +
    result.bodyPixels + ' px de silhueta.');
  console.log('[anatomia] ' + INK_FILE + ': ' + inkPng.length + ' bytes, ' +
    result.inkPixels + ' px de tinta.');
  console.log('[anatomia] manifest.json atualizado; referência exibida sem alteração.');
} finally {
  await browser.close();
}
