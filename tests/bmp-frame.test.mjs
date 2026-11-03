/*
  Regressão do conversor RGB -> BMP 24bpp usado na renderização dos 28 MP4.

  O defeito corrigido: `bmpDeFrame()` alinhava o padding ao offset ABSOLUTO do
  arquivo (`o % 4`) com cabeçalho de 54 bytes. Isso deslocava as linhas 1..N em
  2 bytes e girava os canais BGR, transformando a madeira bege oficial em
  verde-azulado. Estes testes travam: alinhamento por linha, orientação
  top-down, ordem BGR/RGB, ida-e-volta de pixels e integridade do cabeçalho.

  Uso: node tests/bmp-frame.test.mjs  (também executado por `npm test`)
*/
import assert from "node:assert/strict";
import {
  CABECALHO_BMP,
  BITS_POR_PIXEL,
  ORIENTACAO_TOP_DOWN,
  passoLinhaBMP,
  bmpDeFrame,
  lerPixelBGR,
} from "../tools/lib/bmp-frame.mjs";

let testes = 0;
function verificar(nome, fn) {
  fn();
  testes += 1;
  console.log(`  ok ${testes} — ${nome}`);
}

/* Quadro sintético com cores assimétricas: qualquer rotação de canal aparece. */
function quadro(largura, altura) {
  const cor = new Uint8Array(largura * altura * 3);
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const i = (y * largura + x) * 3;
      cor[i] = (37 + x * 31 + y * 7) % 256;     // R
      cor[i + 1] = (91 + x * 13 + y * 29) % 256; // G
      cor[i + 2] = (173 + x * 5 + y * 17) % 256; // B
    }
  }
  return { largura, altura, cor };
}

function cabecalho(bmp, largura, altura) {
  const dv = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
  return {
    assinatura: String.fromCharCode(bmp[0], bmp[1]),
    tamanho: dv.getUint32(2, true),
    offsetDados: dv.getUint32(10, true),
    tamanhoDib: dv.getUint32(14, true),
    largura: dv.getInt32(18, true),
    altura: dv.getInt32(22, true),
    planos: dv.getUint16(26, true),
    bits: dv.getUint16(28, true),
    compressao: dv.getUint32(30, true),
    tamanhoImagem: dv.getUint32(34, true),
  };
}

/* Larguras com e sem padding (3 px -> 9 bytes -> 3 de padding; 5 px -> 15 -> 1). */
const casos = [
  { largura: 1280, altura: 720, padding: 0 }, /* o caso real dos 28 MP4 */
  { largura: 3, altura: 4, padding: 3 },
  { largura: 5, altura: 3, padding: 1 },
  { largura: 2, altura: 2, padding: 2 },
];

verificar("cabeçalho BMP: 54 bytes, top-down, 24bpp, sem compressão", () => {
  for (const c of casos) {
    const bmp = bmpDeFrame(quadro(c.largura, c.altura));
    const h = cabecalho(bmp, c.largura, c.altura);
    const passo = passoLinhaBMP(c.largura);
    assert.equal(h.assinatura, "BM");
    assert.equal(h.offsetDados, CABECALHO_BMP);
    assert.equal(CABECALHO_BMP, 54);
    assert.equal(h.tamanhoDib, 40);
    assert.equal(h.largura, c.largura);
    assert.equal(h.altura, c.altura * ORIENTACAO_TOP_DOWN, "linhas de cima para baixo");
    assert.equal(h.planos, 1);
    assert.equal(h.bits, BITS_POR_PIXEL);
    assert.equal(h.compressao, 0);
    assert.equal(h.tamanhoImagem, passo * c.altura);
    assert.equal(h.tamanho, CABECALHO_BMP + passo * c.altura);
    assert.equal(bmp.length, h.tamanho);
  }
});

verificar("padding é relativo ao início de CADA linha (não ao offset absoluto)", () => {
  for (const c of casos) {
    const bmp = bmpDeFrame(quadro(c.largura, c.altura));
    const passo = passoLinhaBMP(c.largura);
    for (let y = 0; y < c.altura; y += 1) {
      const inicio = CABECALHO_BMP + y * passo;
      assert.equal(inicio % 4, 54 % 4, "o início da linha NÃO é alinhado a 4 no arquivo");
      for (let p = c.largura * 3; p < passo; p += 1) {
        assert.equal(bmp[inicio + p], 0, `padding da linha ${y} deve ser zero`);
      }
    }
  }
});

verificar("conversão explícita R,G,B -> B,G,R e ida-e-volta em todos os pixels", () => {
  for (const c of casos) {
    const alvo = quadro(c.largura, c.altura);
    const copia = Uint8Array.from(alvo.cor);
    const bmp = bmpDeFrame(alvo);
    const passo = passoLinhaBMP(c.largura);
    for (let y = 0; y < c.altura; y += 1) {
      for (let x = 0; x < c.largura; x += 1) {
        const offset = CABECALHO_BMP + y * passo + x * 3;
        const i = (y * c.largura + x) * 3;
        assert.equal(bmp[offset], alvo.cor[i + 2], "byte B");
        assert.equal(bmp[offset + 1], alvo.cor[i + 1], "byte G");
        assert.equal(bmp[offset + 2], alvo.cor[i], "byte R");
        assert.deepEqual(lerPixelBGR(bmp, offset), [alvo.cor[i], alvo.cor[i + 1], alvo.cor[i + 2]]);
      }
    }
    assert.deepEqual(alvo.cor, copia, "o conversor não pode mutar o quadro de origem");
  }
});

verificar("pixel de referência #121010 e madeira bege preservam a ordem dos canais", () => {
  const alvo = { largura: 1, altura: 1, cor: new Uint8Array([170, 143, 101]) };
  const bmp = bmpDeFrame(alvo);
  assert.deepEqual(Array.from(bmp.slice(54, 57)), [101, 143, 170]);
  assert.deepEqual(lerPixelBGR(bmp, 54), [170, 143, 101]);

  const fundo = bmpDeFrame({ largura: 1, altura: 1, cor: new Uint8Array([18, 16, 16]) });
  assert.deepEqual(lerPixelBGR(fundo, 54), [18, 16, 16]);
});

verificar("regressão do deslocamento de 2 bytes: linha 1 começa exatamente em 54+passo", () => {
  const alvo = quadro(1280, 2);
  const bmp = bmpDeFrame(alvo);
  const passo = passoLinhaBMP(1280);
  const inicioLinha1 = CABECALHO_BMP + passo; /* 3894 — NÃO é múltiplo de 4 */
  assert.equal(inicioLinha1, 3894);
  assert.deepEqual(lerPixelBGR(bmp, inicioLinha1), [
    alvo.cor[1280 * 3], alvo.cor[1280 * 3 + 1], alvo.cor[1280 * 3 + 2],
  ], "primeiro pixel da linha 1 deve ser o pixel (0,1), sem rotação de canal");
  assert.equal(bmp.length, CABECALHO_BMP + passo * 2, "sem bytes fantasmas");
});

verificar("dimensões inválidas são rejeitadas", () => {
  assert.throws(() => bmpDeFrame({ largura: 0, altura: 1, cor: new Uint8Array(3) }));
  assert.throws(() => bmpDeFrame({ largura: 4, altura: 4, cor: new Uint8Array(3) }));
});

console.log(`\n${testes} testes do conversor BMP, todos verdes.`);
