/*
  Regressão do RASTRO entre quadros no rasterizador CPU dos 28 MP4.

  Defeito: `renderizarFrame` zerava apenas o buffer de PROFUNDIDADE. O buffer
  de COR era preenchido uma única vez em `criarAlvo` e nunca limpo, então cada
  quadro desenhava sobre o anterior. A perna que varre um arco durante o
  exercício virava um grande "leque" com nervuras radiais; as bordas dos
  quadros acumuladas viravam zigue-zagues. Nada disso existe no WebGL oficial.

  A correção limpa cor e profundidade no início de cada quadro.

  O teste comportamental abaixo decodifica UM quadro real de um dos 28 MP4 e
  verifica que pontos que ficavam dentro do rastro agora são fundo, enquanto o
  personagem continua presente. Com o defeito, esses pontos são madeira bege.

  Uso: node tests/limpeza-frame.test.mjs  (também executado por `npm test`)
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const createFFmpegCore = require("@ffmpeg/core");
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let testes = 0;
const verificar = (nome, fn) => { fn(); testes += 1; console.log(`  ok ${testes} — ${nome}`); };

const codigo = fs.readFileSync(path.join(raiz, "tools/renderizar-videos-3d.mjs"), "utf8");
verificar("rasterizador limpa a COR e a PROFUNDIDADE a cada quadro", () => {
  assert.match(codigo, /alvo\.cor\.set\(alvo\.fundo\)/);
  assert.match(codigo, /alvo\.profundidade\.fill\(Infinity\)/);
  assert.match(codigo, /const fundo = new Uint8Array\(largura \* altura \* 3\)/);
  /* A limpeza tem de estar dentro de renderizarFrame, não só em criarAlvo. */
  const inicio = codigo.indexOf("function renderizarFrame");
  const fim = codigo.indexOf("function escreverPNG");
  assert.ok(inicio > 0 && fim > inicio);
  assert.match(codigo.slice(inicio, fim), /alvo\.cor\.set\(alvo\.fundo\)/);
});

const MP4 = path.join(raiz, "assets/videos/exercicios/cal-elevacao-pernas-masculino-horizontal-16x9.mp4");
const QUADRO = 40; /* instante do leque: ~1,33 s de 2,7 s */
const PONTOS_DO_RASTRO = [[760, 560], [820, 600], [900, 620], [1000, 400], [1050, 600], [800, 500]];

const ffmpeg = await createFFmpegCore({ print: () => {}, printErr: () => {} });
ffmpeg.FS.writeFile("quadro.mp4", fs.readFileSync(MP4));
const ret = ffmpeg.exec(
  "-i", "quadro.mp4",
  "-vf", `select=eq(n\\,${QUADRO})`,
  "-vsync", "0", "-frames:v", "1",
  "-pix_fmt", "rgb24", "-f", "rawvideo", "quadro.raw");
assert.equal(ret, 0, "ffmpeg.wasm não conseguiu decodificar o quadro");
const bruto = Buffer.from(ffmpeg.FS.readFile("quadro.raw"));
const W = 1280, H = 720;
assert.equal(bruto.length, W * H * 3, "quadro com tamanho inesperado");
const pixel = (x, y) => {
  const i = (y * W + x) * 3;
  return [bruto[i], bruto[i + 1], bruto[i + 2]];
};

verificar("quadro 40 não contém rastro nos pontos antes ocupados pelo leque", () => {
  for (const [x, y] of PONTOS_DO_RASTRO) {
    const [r, g, b] = pixel(x, y);
    assert.ok(r < 40 && g < 40 && b < 40,
      `rastro em (${x},${y}): RGB(${r},${g},${b}) — o buffer de cor não foi limpo`);
  }
});

/* Prova de que o teste REALMENTE detecta o defeito antigo: o quadro
   arquivado da renderização sem limpeza tem madeira bege nesses mesmos
   pontos. Se esta asserção deixar de ser verdadeira, o teste perdeu o poder
   de discriminar e não deve ser considerado uma regressão válida. */
const ARQUIVO_ANTIGO = path.join(raiz,
  "docs/validacao-3d/correcao-videos-28/quadros/antes-limpeza-elevacao-pernas.png");
verificar("o quadro ARQUIVADO com rastro é reprovado pelos mesmos pontos", () => {
  ffmpeg.FS.writeFile("antigo.png", fs.readFileSync(ARQUIVO_ANTIGO));
  assert.equal(ffmpeg.exec("-i", "antigo.png", "-pix_fmt", "rgb24", "-f", "rawvideo", "antigo.raw"), 0);
  const velho = Buffer.from(ffmpeg.FS.readFile("antigo.raw"));
  let bege = 0;
  for (const [x, y] of PONTOS_DO_RASTRO) {
    const i = (y * W + x) * 3;
    if (velho[i] > 90 && velho[i + 1] > 70) bege += 1;
  }
  assert.ok(bege >= 5, `o quadro arquivado deveria conter rastro em >=5 pontos, contém ${bege}`);
});

verificar("o personagem continua visível no mesmo quadro (não é um quadro vazio)", () => {
  let corpo = 0;
  for (let i = 0; i < bruto.length; i += 3 * 7) {
    if (bruto[i] > 90 || bruto[i + 1] > 90 || bruto[i + 2] > 90) corpo += 1;
  }
  assert.ok(corpo > 1000, `poucos pixels de personagem: ${corpo}`);
});

verificar("o fundo é o #121010 oficial", () => {
  const [r, g, b] = pixel(20, 20);
  assert.ok(Math.abs(r - 18) < 8 && Math.abs(g - 16) < 8 && Math.abs(b - 16) < 8,
    `fundo inesperado RGB(${r},${g},${b})`);
});

console.log(`\n${testes} testes de limpeza de quadro, todos verdes.`);
