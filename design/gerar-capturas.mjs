#!/usr/bin/env node
/*
  FORJA — capturas do protótipo de rebranding (etapa 1).

  Gera PNGs de revisão das telas do protótipo em 390 px (celular) e 1280 px
  (desktop). Não toca em nenhuma página do aplicativo, não escreve no
  armazenamento e não precisa de servidor: abre os arquivos por file://.

  Uso:
    npm ci
    node design/gerar-capturas.mjs

  Em contêineres mínimos (Amazon Linux), o Chromium do @sparticuz/chromium
  precisa das bibliotecas extras:
    node -e "require('zlib').brotliDecompressSync(require('fs').readFileSync('node_modules/@sparticuz/chromium/bin/al2023.tar.br')).length" >/dev/null
    # extraia al2023.tar e exporte LD_LIBRARY_PATH=<pasta>/lib
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(here, 'capturas');

// O terceiro item, opcional, limita as larguras: a prova do ícone só faz
// sentido no desktop, onde os 512 px aparecem em tamanho real.
const SCREENS = [
  ['inicio', 'prototipo/inicio.html'],
  ['execucao', 'prototipo/execucao.html'],
  ['rotinas', 'prototipo/rotinas.html'],
  ['biblioteca', 'prototipo/biblioteca.html'],
  ['progresso', 'prototipo/progresso.html'],
  ['perfil', 'prototipo/perfil.html'],
  ['componentes', 'prototipo/componentes.html'],
  ['marca', 'marca/index.html'],
  ['icone', 'marca/icone.html', ['1280']]
];

const VIEWPORTS = [
  [390, 844, '390'],
  [1280, 900, '1280']
];

const systemBrowsers = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

let executablePath = systemBrowsers.find(candidate => fs.existsSync(candidate));
let args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

if (!executablePath) {
  executablePath = await chromium.executablePath();
  args = [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'];
}

fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath, args, headless: true });

for (const [name, relative, only] of SCREENS) {
  const viewports = only ? VIEWPORTS.filter(([, , suffix]) => only.includes(suffix)) : VIEWPORTS;
  for (const [width, height, suffix] of viewports) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(here, relative)).href, { waitUntil: 'networkidle0' });
    // A barra inferior fixa ficaria repetida no meio da captura longa.
    await page.addStyleTag({
      content: '.bottom-nav,.execution-footer{position:static!important}'
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    const file = path.join(outDir, name + '-' + suffix + '.png');
    await page.screenshot({ path: file, fullPage: true });
    const size = fs.statSync(file).size;
    console.log('  ' + path.relative(root, file) + ' · ' + Math.round(size / 1024) + ' KB');
    await page.close();
  }
}

await browser.close();
console.log('\nCapturas em design/capturas/');
