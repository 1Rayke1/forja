#!/usr/bin/env node
/*
  FORJA — preparação do modelo anatômico de referência.

  A prancha exibida no Atlas é a imagem fornecida pelo usuário, mantida byte a
  byte (`assets/anatomia/fontes/forja-modelo-anatomico.png`). Este script NÃO
  redesenha, não vetoriza, não recorta em arquivos separados e não recolore o
  corpo.

  O que ele faz:

  1. confere dimensões e hash da referência;
  2. deriva a silhueta a partir do próprio canal alfa da prancha (a imagem tem
     fundo transparente) e grava `assets/anatomia/mascara.png`;
  3. deriva a tinta — as áreas escuras dentro do corpo — e grava
     `assets/anatomia/tinta.png`;
  4. calcula a janela de cada vista (mesmo tamanho, mesma escala) alinhando os
     dois corpos pelo topo da cabeça e pela planta dos pés, e registra tudo no
     `manifest.json`, que é a fonte dos números usados por
     `assets/js/forja-figura.js`.

  A silhueta existe apenas para impedir que a tinta dos destaques apareça fora
  do corpo. Como o fundo é transparente, o alfa também serve de máscara; a
  silhueta é um alfa "fechado" — dilatação seguida de erosão com o mesmo raio —
  que preenche as frestas entre fibras musculares sem unir braço ao tronco nem
  as duas pernas.

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
const REFERENCE_REL = 'fontes/forja-modelo-anatomico.png';
const REFERENCE = path.join(OUT_DIR, REFERENCE_REL);
const MASK_FILE = 'mascara.png';
const INK_FILE = 'tinta.png';

const REFERENCE_WIDTH = 1536;
const REFERENCE_HEIGHT = 1024;

/* Espaço de desenho da figura. As duas vistas usam o mesmo tamanho de janela,
   na mesma escala, para que anterior e posterior fiquem alinhadas. */
const CANVAS = Object.freeze({ width: 460, height: 1024 });

/* Meia-largura da janela em torno do eixo de simetria de cada corpo. O ponto
   mais largo desta prancha é a distância entre as duas mãos (212 px do eixo);
   230 px deixa margem para os dedos sem sobrar preto à toa. */
const HALF_WIDTH = 230;
/* Margem vertical acima do topo da cabeça e abaixo da planta dos pés. */
const TOP_MARGIN = 4;
const BOTTOM_MARGIN = 6;

/* Parâmetros da silhueta. A prancha tem alfa de verdade no corpo (≈ 250) e um
   halo residual no fundo (alfa < 90): o limiar em 140 fica entre os dois. O
   fechamento de raio 6 fecha as frestas entre fibras sem unir o braço ao
   tronco nem as duas pernas. */
const ALPHA_THRESHOLD = 140;
const CLOSE_RADIUS = 6;
const PAD = 2;
/* Rampa da tinta: a partir de qual luminância o destaque deixa de pintar, e
   abaixo de qual ele pinta por inteiro. Entre as duas, o alfa é proporcional —
   é o que faz a cor seguir o sombreado do desenho em vez de cobrir o corpo com
   um bloco chapado. Os realces claros (peitoral, deltoide, quadríceps) ficam
   sem cor, como as linhas brancas da prancha anterior. */
const INK_RAMP = 176;
const INK_FLOOR = 24;
/* O short é quase preto (luminância mediana ≈ 30). Com o degradê normal ele
   recebia cor cheia e a peça virava uma mancha verde — mas o tecido cobre a
   pelve, e "Glúteos" e "Quadril" são regiões que existem justamente ali. Em
   vez de apagar essas regiões, a tinta sobre o tecido é limitada a um teto
   baixo: o destaque aparece como tinta translúcida sobre o tecido, sem
   transformar o short em músculo. A faixa é reconhecida pela própria imagem
   (a peça é a massa escura contínua nessa altura), sem coordenada à mão. */
const SHORTS_RAMP = 78;
const FABRIC_ALPHA = 78;
/* Níveis de alfa da tinta. Oito degraus bastam para o degradê e mantêm o PNG
   pequeno (uma rampa contínua dava 540 KB; oito degraus ficam abaixo de 100 KB,
   que é o orçamento de um arquivo de máscara no projeto). */
const INK_LEVELS = 4;

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

try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><title>mascara</title>');

  const result = await page.evaluate(async ({ base64, width, height, alphaThreshold, closeRadius, pad, inkRamp, inkFloor, inkLevels, shortsRamp, fabricAlpha, canvas, halfWidth, topMargin, bottomMargin }) => {
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

    /* 1. Semente da silhueta: alfa acima do limiar. Pega o corpo e o contorno
          verde; deixa de fora o brilho residual do fundo (alfa < 40). */
    const seed = new Uint8Array(total);
    let seedPixels = 0;
    for (let index = 0; index < total; index += 1) {
      const alpha = pixels[index * 4 + 3];
      seed[index] = alpha > alphaThreshold ? 1 : 0;
      if (seed[index]) seedPixels += 1;
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

    /* 3b. Faixa do tecido (o short). A peça é a única região em que quase todo
           o corpo é escuro: medida linha a linha, a fração de pixels escuros
           salta de ~0,1 no tronco para ~0,75 na pelve e volta a ~0,25 nas
           pernas. A faixa é o trecho contínuo acima de 0,55 — vem da própria
           imagem, não de coordenada digitada, e acompanha outra prancha. */
    const rowDarkness = new Float64Array(height);
    for (let y = 0; y < height; y += 1) {
      let body = 0;
      let dark = 0;
      for (let x = 0; x < width; x += 2) {
        const index = y * width + x;
        if (!padded[index]) continue;
        body += 1;
        const offset = index * 4;
        if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < shortsRamp) dark += 1;
      }
      rowDarkness[y] = body > 20 ? dark / body : 0;
    }
    /* Trechos contínuos acima de 0,55 e fica com o mais longo: o cabelo
       também é escuro, mas ocupa poucas linhas; o short ocupa a pelve inteira. */
    const runs = [];
    let open = null;
    for (let y = 0; y < height; y += 1) {
      if (rowDarkness[y] >= 0.55) {
        if (!open) open = { top: y, bottom: y };
        else open.bottom = y;
      } else if (open) {
        if (open.bottom - open.top >= 12) runs.push(open);
        open = null;
      }
    }
    if (open && open.bottom - open.top >= 12) runs.push(open);
    if (!runs.length) {
      throw new Error('Não encontrei a faixa do tecido (short) nesta prancha.');
    }
    const run = runs.reduce((best, item) => (item.bottom - item.top > best.bottom - best.top ? item : best));
    const fabricTop = run.top;
    const fabricBottom = run.bottom;

    /* 4. Tinta: a silhueta modulada pela escuridão da própria prancha. É o que
          permite pintar a região sem cobrir os realces claros e sem depender
          de mix-blend-mode (que, com máscara, pintava de forma intermitente). */
    const ink = new Uint8Array(total);
    let inkPixels = 0;
    let inkAlphaSum = 0;
    let shortsPixels = 0;
    for (let index = 0; index < total; index += 1) {
      if (!padded[index]) continue;
      const offset = index * 4;
      const luminance = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      let alpha = 0;
      if (luminance < inkRamp) {
        const ramp = Math.min(1, Math.max(0, (inkRamp - luminance) / (inkRamp - inkFloor)));
        /* Curva quadrática: o miolo do músculo (meio-tom) recebe pouco, e a
           cor se concentra onde o desenho já marca sombra — fissura e
           inserção. Sem isso o corpo inteiro ficava chapado de verde. */
        alpha = Math.round(255 * ramp * ramp);
        /* Quantiza para INK_LEVELS degraus: o degradê continua suave aos olhos
           e o PNG comprime muito melhor. */
        const step = 255 / (inkLevels - 1);
        alpha = Math.round(Math.round(alpha / step) * step);
      }
      /* Tecido: rampa própria, mais baixa e proporcional às dobras da peça.
         O short cobre a pelve, e "Glúteos"/"Quadril" existem ali; com o degradê
         normal a peça preta recebia cor cheia e virava mancha verde de músculo.
         Um teto fixo resolveria a cor, mas deixaria um oval chapado. Aqui a
         tinta sobre o tecido é proporcional à escuridão DENTRO da faixa do
         tecido: as dobras do short continuam visíveis e o realce lê como
         marcação sobre a peça, não como músculo pintado.
         Só a parte baixa do corpo entra na conta, para que sombras igualmente
         escuras do tronco (axila, fissura) continuem recebendo cor cheia. */
      const row = (index / width) | 0;
      if (row >= fabricTop && row <= fabricBottom + 4 && luminance < shortsRamp) {
        shortsPixels += 1;
        /* O tecido tem faixa estreita (0..fabricAlpha): quantizar com o mesmo
           degrau do corpo (255/3 ≈ 85) apagaria quase todo o meio-tom e a
           dobra viraria um buraco de borda serrilhada. Degrau próprio, fino.
           A rampa é quadrática para o véu concentrar cor no vinco e dissolver
           nas partes iluminadas — assim ele lê como marcação sobre o tecido,
           não como um oval chapado de tinta. */
        const fold = Math.min(1, Math.max(0, (shortsRamp - luminance) / shortsRamp));
        alpha = Math.round((fabricAlpha * fold * fold * 1.35) / 6) * 6;
        alpha = Math.min(fabricAlpha, alpha);
      }
      ink[index] = alpha;
      if (alpha) { inkPixels += 1; inkAlphaSum += alpha; }
    }

    /* 5. Duas massas independentes (vista anterior e posterior). A separação
          sai do próprio desenho: a coluna vazia entre os dois corpos. */
    const columnFilled = new Uint16Array(width);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (padded[y * width + x]) columnFilled[x] += 1;
      }
    }
    const masses = [];
    let current = null;
    for (let x = 0; x < width; x += 1) {
      if (columnFilled[x] > 2) {
        if (!current) current = { left: x, right: x, pixels: 0 };
        current.right = x;
      } else if (current) {
        masses.push(current);
        current = null;
      }
    }
    if (current) masses.push(current);
    for (const mass of masses) {
      let count = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = mass.left; x <= mass.right; x += 1) {
          if (padded[y * width + x]) count += 1;
        }
      }
      mass.pixels = count;
    }
    const bodies = masses.filter(mass => mass.pixels > 20000).slice(0, 2);
    if (bodies.length !== 2) {
      throw new Error('A referência precisa ter exatamente duas vistas de corpo; encontrei ' + bodies.length + '.');
    }

    /* 6. Eixo de simetria e limites verticais de cada massa. O eixo é obtido
          espelhando a massa em torno de cada coluna candidata e escolhendo a
          coluna que menos diverge — é o eixo de simetria real do desenho. */
    const boundsOf = (mass) => {
      let top = height;
      let bottom = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = mass.left; x <= mass.right; x += 1) {
          if (!padded[y * width + x]) continue;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          break;
        }
      }
      return { top, bottom };
    };

    const axisOf = (mass, top, bottom) => {
      let best = null;
      const span = Math.floor((mass.right - mass.left) / 2) + 30;
      for (let axis = mass.left + 40; axis <= mass.right - 40; axis += 1) {
        let diff = 0;
        let compared = 0;
        for (let y = top; y <= bottom; y += 4) {
          for (let dx = 0; dx < span; dx += 1) {
            const leftX = axis - dx;
            const rightX = axis + dx;
            if (leftX < 0 || rightX >= width) break;
            const left = padded[y * width + leftX];
            const right = padded[y * width + rightX];
            compared += 1;
            if (left !== right) diff += 1;
          }
        }
        /* Prefere o eixo mais central: empate no espelhamento, ganha o meio. */
        const centre = (mass.left + mass.right) / 2;
        const score = diff * 4 + Math.abs(axis - centre);
        if (!best || score < best.score) best = { axis, diff, compared, score };
      }
      return best;
    };

    const views = {};
    const names = ['front', 'back'];
    bodies.forEach((mass, index) => {
      const name = names[index];
      const limits = boundsOf(mass);
      const symmetry = axisOf(mass, limits.top, limits.bottom);
      views[name] = {
        name,
        mass: { left: mass.left, right: mass.right, pixels: mass.pixels },
        top: limits.top,
        bottom: limits.bottom,
        axis: symmetry.axis,
        symmetryDiff: symmetry.diff,
        symmetrySamples: symmetry.compared
      };
    });

    /* 7. Escala comum: as duas vistas usam a mesma razão pixels→unidades da
          viewBox. A prancha é exibida em tamanho natural dentro da janela
          (1 px da prancha = 1 unidade da viewBox), então a razão é 1:1 e não há
          ampliação nem redução — nada esticado, nada borrado. A janela tem o
          mesmo tamanho nas duas vistas, e o corpo mais alto precisa caber. */
    const heights = ['front', 'back'].map(name => views[name].bottom - views[name].top + 1);
    const tallest = Math.max(...heights);
    const usableHeight = canvas.height - topMargin - bottomMargin;
    if (tallest > usableHeight) {
      throw new Error('Corpo mais alto que a janela: ' + tallest + ' px para ' + usableHeight + ' px.');
    }
    const scale = 1;

    for (const name of ['front', 'back']) {
      const view = views[name];
      const axis = view.axis;
      /* O corpo precisa caber inteiro na janela: largura e altura medidas. */
      const halfNeeded = Math.max(axis - view.mass.left, view.mass.right - axis) + 2;
      if (halfNeeded > halfWidth) {
        throw new Error('Corpo mais largo que a janela em ' + name + ': ' + halfNeeded + ' px.');
      }
      view.crop = {
        x: Math.round(axis - halfWidth),
        y: Math.round(view.top - topMargin)
      };
      view.crop.width = canvas.width;
      view.crop.height = canvas.height;
      view.scale = scale;
      view.body = {
        left: Math.round((view.mass.left - view.crop.x) * scale),
        right: Math.round((view.mass.right - view.crop.x) * scale),
        top: Math.round((view.top - view.crop.y) * scale),
        bottom: Math.round((view.bottom - view.crop.y) * scale),
        coverage: Math.round(view.mass.pixels * scale * scale)
      };
      view.axisInView = Math.round((axis - view.crop.x) * scale);
    }

    /* 8. Silhueta em branco opaco sobre transparente. */
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
    const inkUrl = canvasEl.toDataURL('image/png');

    return {
      maskDataUrl: maskUrl,
      inkDataUrl: inkUrl,
      views,
      scale,
      seedPixels,
      inkPixels,
      inkAlphaSum,
      shortsPixels,
      fabricBand: { top: fabricTop, bottom: fabricBottom },
      bodyPixels: padded.reduce((acc, v) => acc + v, 0),
      masses: masses.map(mass => ({ left: mass.left, right: mass.right, pixels: mass.pixels }))
    };
  }, {
    base64: referenceBytes.toString('base64'),
    width: REFERENCE_WIDTH,
    height: REFERENCE_HEIGHT,
    alphaThreshold: ALPHA_THRESHOLD,
    closeRadius: CLOSE_RADIUS,
    pad: PAD,
    inkRamp: INK_RAMP,
    inkFloor: INK_FLOOR,
    inkLevels: INK_LEVELS,
    shortsRamp: SHORTS_RAMP,
    fabricAlpha: FABRIC_ALPHA,
    canvas: CANVAS,
    halfWidth: HALF_WIDTH,
    topMargin: TOP_MARGIN,
    bottomMargin: BOTTOM_MARGIN
  });

  const { front, back } = result.views;
  if (front.mass.pixels < back.mass.pixels || front.axis > back.axis) {
    throw new Error('As vistas não foram reconhecidas na ordem esperada (anterior à esquerda).');
  }

  /* O corpo precisa estar inteiro dentro da janela, com margem dos dois lados:
     nada de cabeça, mão, perna ou pé cortado. */
  for (const [name, view] of Object.entries(result.views)) {
    const { body } = view;
    if (body.left < 3 || body.right > CANVAS.width - 4) {
      throw new Error('Mãos cortadas na vista ' + name + ': ' + JSON.stringify(body));
    }
    if (body.top < 3 || body.bottom > CANVAS.height - 4) {
      throw new Error('Cabeça ou pés cortados na vista ' + name + ': ' + JSON.stringify(body));
    }
    if (view.symmetryDiff / view.symmetrySamples > 0.12) {
      throw new Error('Eixo de simetria pouco confiável em ' + name + ': ' +
        view.symmetryDiff + '/' + view.symmetrySamples);
    }
  }

  const manifest = {
    reference: {
      file: REFERENCE_REL,
      sha256: sha256(referenceBytes),
      bytes: referenceBytes.length,
      width: REFERENCE_WIDTH,
      height: REFERENCE_HEIGHT,
      format: 'PNG RGBA (fundo transparente)',
      background: 'transparente; o app pinta o preto do tema por baixo',
      views: 'anterior à esquerda, posterior à direita, no mesmo arquivo',
      source: 'Imagem de referência enviada pelo usuário na revisão de 11/11/2026'
    },
    canvas: { width: CANVAS.width, height: CANVAS.height },
    method: 'Referência exibida sem alteração. Silhueta e tinta derivadas por máquina ' +
      'do próprio alfa e da própria luminância da prancha, apenas para limitar os destaques. ' +
      'Sem vetorização, recorte em arquivo separado, recoloração ou redesenho do corpo.',
    mask: {
      file: MASK_FILE,
      alphaThreshold: ALPHA_THRESHOLD,
      closeRadius: CLOSE_RADIUS,
      pad: PAD,
      interpretation: 'branco opaco = corpo; transparente = fora do corpo'
    },
    ink: {
      file: INK_FILE,
      ramp: INK_RAMP,
      floor: INK_FLOOR,
      levels: INK_LEVELS,
      /* Tecido: a tinta sobre o short tem teto próprio, para que as regiões
         cobertas pela peça (glúteos, quadril) continuem visíveis sem que o
         short vire músculo. */
      fabric: {
        ramp: SHORTS_RAMP,
        alphaCeiling: FABRIC_ALPHA,
        rows: 'y ' + result.fabricBand.top + '..' + result.fabricBand.bottom + ' (medido na prancha)',
        pixels: result.shortsPixels
      },
      interpretation: 'alfa proporcional à escuridão dentro do corpo: forte nas fissuras, fraco nos meios-tons, transparente nos realces claros e fora do corpo'
    },
    views: {}
  };

  for (const name of ['front', 'back']) {
    const view = result.views[name];
    manifest.views[name] = {
      crop: view.crop,
      axis: view.axisInView,
      axisInReference: view.axis,
      scale: Number(view.scale.toFixed(6)),
      source: {
        left: view.mass.left,
        right: view.mass.right,
        top: view.top,
        bottom: view.bottom,
        pixels: view.mass.pixels
      },
      body: view.body
    };
  }
  manifest.scale = Number(result.scale.toFixed(6));
  manifest.masses = result.masses;

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
  manifest.ink.averageAlpha = Math.round(result.inkAlphaSum / Math.max(1, result.inkPixels));
  manifest.ink.coverage = Number((result.inkPixels / result.bodyPixels).toFixed(3));

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  for (const name of ['front', 'back']) {
    const view = manifest.views[name];
    console.log('[anatomia] ' + name + ': eixo ' + view.axis + ' (referência x=' +
      view.axisInReference + '), recorte ' + JSON.stringify(view.crop) +
      ', corpo ' + JSON.stringify(view.body));
  }
  console.log('[anatomia] escala comum ' + manifest.scale + ' px → unidade da viewBox ' +
    manifest.canvas.width + '×' + manifest.canvas.height + '.');
  console.log('[anatomia] ' + MASK_FILE + ': ' + maskPng.length + ' bytes, ' +
    result.bodyPixels + ' px de silhueta.');
  console.log('[anatomia] ' + INK_FILE + ': ' + inkPng.length + ' bytes, ' +
    result.inkPixels + ' px de tinta.');
  console.log('[anatomia] manifest.json atualizado; referência exibida sem alteração.');
} finally {
  await browser.close();
}
