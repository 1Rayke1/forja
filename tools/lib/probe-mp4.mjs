/*
  FORJA — leitura dos metadados essenciais de um MP4 sem depender de ffprobe.

  O ambiente de publicação não tem ffmpeg/ffprobe, mas a entrega exige provar
  que cada vídeo é horizontal 16:9, 1280 × 720 e 30 FPS. Este leitor percorre
  as caixas ISO-BMFF (moov/trak/mdia/minf/stbl) e devolve:

    largura, altura, fps, duracaoS, temVideo, temAudio, codec

  Ele NÃO decodifica imagem nem áudio: cor de fundo e continuidade visual
  continuam exigindo um decodificador real (ffmpeg) e são reportadas à parte.
*/

import fs from "node:fs";

function lerCaixas(buf, inicio, fim, visitar) {
  let offset = inicio;
  while (offset + 8 <= fim) {
    let tamanho = buf.readUInt32BE(offset);
    const tipo = buf.toString("latin1", offset + 4, offset + 8);
    let cabecalho = 8;
    if (tamanho === 1) {
      if (offset + 16 > fim) break;
      const alto = buf.readUInt32BE(offset + 8);
      const baixo = buf.readUInt32BE(offset + 12);
      tamanho = alto * 2 ** 32 + baixo;
      cabecalho = 16;
    } else if (tamanho === 0) {
      tamanho = fim - offset;
    }
    if (tamanho < cabecalho || offset + tamanho > fim) break;
    visitar(tipo, offset + cabecalho, offset + tamanho, offset);
    offset += tamanho;
  }
}

function caixa(buf, inicio, fim, alvo) {
  let achada = null;
  lerCaixas(buf, inicio, fim, (tipo, corpo, limite) => {
    if (!achada && tipo === alvo) achada = { inicio: corpo, fim: limite };
  });
  return achada;
}

function lerTkhd(buf, inicio, fim) {
  const versao = buf[inicio];
  const offset = versao === 1 ? 88 : 76;
  if (inicio + offset + 8 > fim) return null;
  return {
    largura: buf.readUInt32BE(inicio + offset) / 65536,
    altura: buf.readUInt32BE(inicio + offset + 4) / 65536
  };
}

function lerMdhd(buf, inicio, fim) {
  const versao = buf[inicio];
  if (versao === 1) {
    if (inicio + 32 > fim) return null;
    return {
      timescale: buf.readUInt32BE(inicio + 20),
      duracao: Number(buf.readBigUInt64BE(inicio + 24))
    };
  }
  if (inicio + 24 > fim) return null;
  return {
    timescale: buf.readUInt32BE(inicio + 12),
    duracao: buf.readUInt32BE(inicio + 16)
  };
}

function lerHdlr(buf, inicio, fim) {
  /* version/flags (4) + pre_defined (4) + handler_type (4) */
  if (inicio + 12 > fim) return null;
  return buf.toString("latin1", inicio + 8, inicio + 12);
}

function lerStsd(buf, inicio, fim) {
  if (inicio + 16 > fim) return null;
  const entradas = buf.readUInt32BE(inicio + 4);
  if (!entradas) return null;
  let offset = inicio + 8;
  const tamanho = buf.readUInt32BE(offset);
  const formato = buf.toString("latin1", offset + 4, offset + 8);
  if (offset + 36 > fim) return { formato, largura: null, altura: null };
  return {
    formato,
    largura: buf.readUInt16BE(offset + 32),
    altura: buf.readUInt16BE(offset + 34)
  };
}

function lerStts(buf, inicio, fim) {
  if (inicio + 8 > fim) return null;
  const entradas = buf.readUInt32BE(inicio + 4);
  let offset = inicio + 8;
  let amostras = 0;
  let duracao = 0;
  for (let i = 0; i < entradas && offset + 8 <= fim; i += 1) {
    const quantidade = buf.readUInt32BE(offset);
    const delta = buf.readUInt32BE(offset + 4);
    amostras += quantidade;
    duracao += quantidade * delta;
    offset += 8;
  }
  return { amostras, duracao };
}

export function lerMP4(arquivo) {
  const buf = fs.readFileSync(arquivo);
  if (buf.length < 12) throw new Error("MP4 vazio ou truncado");

  let moov = null;
  lerCaixas(buf, 0, buf.length, (tipo, inicio, fim) => {
    if (tipo === "moov") moov = { inicio, fim };
  });
  if (!moov) throw new Error("caixa moov ausente");

  const trilhas = [];
  lerCaixas(buf, moov.inicio, moov.fim, (tipo, inicio, fim) => {
    if (tipo !== "trak") return;
    const tkhd = caixa(buf, inicio, fim, "tkhd");
    const mdia = caixa(buf, inicio, fim, "mdia");
    if (!mdia) return;

    const hdlr = caixa(buf, mdia.inicio, mdia.fim, "hdlr");
    const mdhd = caixa(buf, mdia.inicio, mdia.fim, "mdhd");
    const minf = caixa(buf, mdia.inicio, mdia.fim, "minf");
    let stsd = null;
    let stts = null;
    if (minf) {
      const stbl = caixa(buf, minf.inicio, minf.fim, "stbl");
      if (stbl) {
        const caixaStsd = caixa(buf, stbl.inicio, stbl.fim, "stsd");
        const caixaStts = caixa(buf, stbl.inicio, stbl.fim, "stts");
        if (caixaStsd) stsd = lerStsd(buf, caixaStsd.inicio, caixaStsd.fim);
        if (caixaStts) stts = lerStts(buf, caixaStts.inicio, caixaStts.fim);
      }
    }

    const meta = {
      handler: hdlr ? lerHdlr(buf, hdlr.inicio, hdlr.fim) : null,
      dimensoesTkhd: tkhd ? lerTkhd(buf, tkhd.inicio, tkhd.fim) : null,
      dimensoesAmostra: stsd ? { largura: stsd.largura, altura: stsd.altura } : null,
      codec: stsd ? stsd.formato : null,
      mdhd: mdhd ? lerMdhd(buf, mdhd.inicio, mdhd.fim) : null,
      stts
    };
    trilhas.push(meta);
  });

  const video = trilhas.find(t => t.handler === "vide") || null;
  const audio = trilhas.find(t => t.handler === "soun") || null;

  let largura = null;
  let altura = null;
  if (video) {
    largura = (video.dimensoesAmostra && video.dimensoesAmostra.largura) ||
      (video.dimensoesTkhd && Math.round(video.dimensoesTkhd.largura)) || null;
    altura = (video.dimensoesAmostra && video.dimensoesAmostra.altura) ||
      (video.dimensoesTkhd && Math.round(video.dimensoesTkhd.altura)) || null;
  }

  let fps = null;
  let duracaoS = null;
  if (video && video.mdhd && video.mdhd.timescale > 0) {
    duracaoS = video.mdhd.duracao / video.mdhd.timescale;
    if (video.stts && video.stts.amostras > 0) {
      const duracaoAmostras = video.stts.duracao / video.mdhd.timescale;
      fps = duracaoAmostras > 0 ? video.stts.amostras / duracaoAmostras : null;
    }
  }

  return {
    arquivo,
    bytes: buf.length,
    largura,
    altura,
    fps: fps === null ? null : Number(fps.toFixed(3)),
    duracaoS: duracaoS === null ? null : Number(duracaoS.toFixed(4)),
    codec: video ? video.codec : null,
    temVideo: Boolean(video),
    temAudio: Boolean(audio),
    proporcao:
      largura && altura
        ? Number((largura / altura).toFixed(4))
        : null
  };
}
