/*
  FORJA — conversor de quadro RGB (buffer interno do rasterizador) para BMP
  24bpp usado como entrada do image2 do ffmpeg.wasm.

  Regras que este módulo garante:

  1. O cabeçalho BMP tem 54 bytes (14 de BITMAPFILEHEADER + 40 de
     BITMAPINFOHEADER). 54 NÃO é múltiplo de 4. O padding de cada linha deve
     ser calculado em relação ao INÍCIO DA LINHA, nunca em relação ao offset
     absoluto do arquivo (`o % 4`). A versão anterior fazia `o % 4`, o que
     inseria 2 bytes fantasmas logo após a primeira linha; como o buffer já
     estava dimensionado sem padding, esses 2 incrementos não escreviam nada e
     deslocavam todas as linhas seguintes. Sendo 2 ≠ múltiplo de 3, os canais
     BGR giravam e a madeira bege virava verde-azulada nos MP4 publicados.
  2. `altura` é gravada como valor NEGATIVO: linhas vêm de cima para baixo
     (top-down), exatamente como o rasterizador preenche `cor`. Cada linha y
     começa em `54 + y * passoLinha`, sem reordenação.
  3. O BMP 24bpp armazena B, G, R nessa ordem; o buffer interno é R, G, B.
     A conversão é explícita em `escreverPixelBGR` e coberta por teste de
     ida-e-volta em tests/bmp-frame.test.mjs.

  Nenhuma cor, luz, material ou animação é alterada aqui: este módulo só
  transporta os bytes do quadro já renderizado.
*/

export const CABECALHO_BMP = 14 + 40; /* 54 bytes */
export const BITS_POR_PIXEL = 24;
export const ORIENTACAO_TOP_DOWN = -1; /* altura negativa no BITMAPINFOHEADER */

export function passoLinhaBMP(largura) {
  return Math.ceil((largura * 3) / 4) * 4;
}

/* Converte UM pixel RGB do buffer interno para a tríade BGR do BMP. */
export function escreverPixelBGR(saida, offset, cor, indiceCor) {
  saida[offset] = cor[indiceCor + 2];     // B
  saida[offset + 1] = cor[indiceCor + 1]; // G
  saida[offset + 2] = cor[indiceCor];     // R
}

/* Inverso de escreverPixelBGR, usado pelos testes e pelo diagnóstico. */
export function lerPixelBGR(bmp, offset) {
  return [bmp[offset + 2], bmp[offset + 1], bmp[offset]]; // R, G, B
}

export function bmpDeFrame(alvo) {
  const { largura, altura, cor } = alvo;
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura <= 0 || altura <= 0) {
    throw new Error("dimensões inválidas para BMP");
  }
  if (cor.length < largura * altura * 3) {
    throw new Error("buffer RGB menor que o quadro");
  }

  const bytesPorLinha = largura * 3;
  const passoLinha = passoLinhaBMP(largura);
  const padding = passoLinha - bytesPorLinha;
  const tamanhoImagem = passoLinha * altura;
  const tamanho = CABECALHO_BMP + tamanhoImagem;
  const saida = new Uint8Array(tamanho);
  const dv = new DataView(saida.buffer);

  /* BITMAPFILEHEADER (14 bytes) */
  saida[0] = 0x42; saida[1] = 0x4d;                 // 'BM'
  dv.setUint32(2, tamanho, true);                    // bfSize
  dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
  dv.setUint32(10, CABECALHO_BMP, true);            // bfOffBits = 54

  /* BITMAPINFOHEADER (40 bytes) */
  dv.setUint32(14, 40, true);                       // biSize
  dv.setInt32(18, largura, true);                   // biWidth
  dv.setInt32(22, altura * ORIENTACAO_TOP_DOWN, true); // top-down
  dv.setUint16(26, 1, true);                        // biPlanes
  dv.setUint16(28, BITS_POR_PIXEL, true);           // biBitCount
  dv.setUint32(30, 0, true);                        // BI_RGB, sem compressão
  dv.setUint32(34, tamanhoImagem, true);            // biSizeImage
  dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
  dv.setUint32(46, 0, true); dv.setUint32(50, 0, true);

  for (let y = 0; y < altura; y += 1) {
    const inicioLinha = CABECALHO_BMP + y * passoLinha;
    let o = inicioLinha;
    for (let x = 0; x < largura; x += 1) {
      escreverPixelBGR(saida, o, cor, (y * largura + x) * 3);
      o += 3;
    }
    for (let p = 0; p < padding; p += 1) saida[o++] = 0;
    /* Trava explícita: se o alinhamento voltar a ser absoluto, isto falha. */
    if (o - inicioLinha !== passoLinha) {
      throw new Error(`alinhamento de linha BMP inválido na linha ${y}`);
    }
  }
  return saida;
}
