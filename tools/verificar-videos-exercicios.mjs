#!/usr/bin/env node
/*
  FORJA — verificação independente dos 28 MP4 de apresentação dos exercícios.

  Não renderiza, não reescreve e não publica nada. Apenas lê o que está
  commitado e mede, arquivo por arquivo:

    1. Inventário: 14 exercícios × 2 personagens, sem arquivos órfãos.
    2. Manifesto: cada referência existe e os metadados gravados conferem
       com a medição atual (bytes, resolução, FPS, duração, codec, áudio).
    3. Especificação: 1280×720, 16:9, 30 FPS, H.264/avc1, sem áudio,
       com trilha de vídeo e `moov` antes de `mdat` (+faststart).
    4. Integridade: SHA-256 do arquivo e igualdade com o blob do Git.
    5. Decodificação real via ffmpeg.wasm (@ffmpeg/core, já dependência do
       projeto): contagem de quadros, FPS empírico, cor de fundo medida nos
       cantos, cor média do personagem e continuidade da emenda do loop.
    6. Opcionalmente (`--reproduzir`), renderiza UM vídeo com o pipeline
       commitado e compara byte a byte com o MP4 publicado.

  Uso:
    node tools/verificar-videos-exercicios.mjs
    node tools/verificar-videos-exercicios.mjs --reproduzir --quadros

  Saída:
    docs/validacao-3d/verificacao-28-videos/evidencias.json
    resumo no stdout; exit 1 se alguma verificação técnica dura falhar.
*/

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { lerMP4 } from "./lib/probe-mp4.mjs";
import jpeg from "jpeg-js";

const require = createRequire(import.meta.url);
const createFFmpegCore = require("@ffmpeg/core");
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR_VIDEOS = path.join(raiz, "assets", "videos", "exercicios");
const CAMINHO_MANIFESTO = path.join(raiz, "assets", "3d", "apresentacao-exercicios.json");
const DIR_EVIDENCIAS = path.join(raiz, "docs", "validacao-3d", "verificacao-28-videos");
const REPRODUZIR = process.argv.includes("--reproduzir");
const SALVAR_QUADROS = process.argv.includes("--quadros");

const W = 1280;
const H = 720;
const PEQUENO_W = 64;
const PEQUENO_H = 36;
const BYTES_QUADRO_PEQUENO = PEQUENO_W * PEQUENO_H * 3;
const FUNDO_ESPERADO = [0.071, 0.063, 0.063].map(v => Math.round(v * 255)); /* #121010 */
const TOLERANCIA_FUNDO = 8; /* round-trip YUV 4:2:0 + CRF 24 */
const TOLERANCIA_COR = 60; /* distância RGB até a textura oficial de madeira */

const sha256 = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
const arredondar = (v, casas = 3) => Number(v.toFixed(casas));

function caixasTopo(buf) {
  const lista = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    let tamanho = buf.readUInt32BE(off);
    const tipo = buf.toString("latin1", off + 4, off + 8);
    let cabecalho = 8;
    if (tamanho === 1) {
      if (off + 16 > buf.length) break;
      tamanho = buf.readUInt32BE(off + 8) * 2 ** 32 + buf.readUInt32BE(off + 12);
      cabecalho = 16;
    } else if (tamanho === 0) {
      tamanho = buf.length - off;
    }
    if (tamanho < cabecalho || off + tamanho > buf.length) break;
    lista.push({ tipo, inicio: off });
    off += tamanho;
  }
  return lista;
}

function mediaCantos(rgb) {
  /* 4 manchas 8×8 nos cantos do primeiro quadro em resolução cheia. */
  const manchas = [[2, 2], [W - 10, 2], [2, H - 10], [W - 10, H - 10]];
  const soma = [0, 0, 0];
  let n = 0;
  for (const [x, y] of manchas) {
    for (let dy = 0; dy < 8; dy += 1) {
      for (let dx = 0; dx < 8; dx += 1) {
        const i = ((y + dy) * W + (x + dx)) * 3;
        soma[0] += rgb[i]; soma[1] += rgb[i + 1]; soma[2] += rgb[i + 2];
        n += 1;
      }
    }
  }
  return soma.map(v => arredondar(v / n, 2));
}

function mediaPixelsClaros(rgb, largura = W, altura = H) {
  const soma = [0, 0, 0];
  let n = 0;
  for (let i = 0; i + 2 < rgb.length && i < largura * altura * 3; i += 3) {
    const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    if (r + g + b > 180) { soma[0] += r; soma[1] += g; soma[2] += b; n += 1; }
  }
  return n ? { amostras: n, rgb: soma.map(v => arredondar(v / n, 1)) } : { amostras: 0, rgb: null };
}

function mad(a, b) {
  let soma = 0;
  for (let i = 0; i < a.length; i += 1) soma += Math.abs(a[i] - b[i]);
  return arredondar(soma / a.length);
}

function referenciaTexturaOficial() {
  /* Cor média da textura JPEG de madeira embutida no GLB do personagem. */
  const glb = fs.readFileSync(path.join(raiz, "assets", "3d", "personagens", "masculino.glb"));
  let off = 12, json = null, bin = null;
  while (off < glb.length) {
    const tamanho = glb.readUInt32LE(off);
    const tipo = glb.toString("latin1", off + 4, off + 8);
    const dados = glb.subarray(off + 8, off + 8 + tamanho);
    if (tipo === "JSON") json = JSON.parse(dados.toString("utf8").replace(/\0+$/g, ""));
    else if (tipo.startsWith("BIN")) bin = dados;
    off += 8 + tamanho;
  }
  const imagem = json.images[0];
  const vista = json.bufferViews[imagem.bufferView];
  const bytes = bin.subarray(vista.byteOffset, vista.byteOffset + vista.byteLength);
  const decodificada = jpeg.decode(new Uint8Array(bytes));
  const soma = [0, 0, 0];
  let n = 0;
  for (let i = 0; i + 3 < decodificada.data.length; i += 4) {
    soma[0] += decodificada.data[i];
    soma[1] += decodificada.data[i + 1];
    soma[2] += decodificada.data[i + 2];
    n += 1;
  }
  return { arquivo: "assets/3d/personagens/masculino.glb", imagem: imagem.name, rgb: soma.map(v => arredondar(v / n, 1)) };
}

function distancia(a, b) {
  return arredondar(Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0)), 1);
}

/* Lê o SPS dentro da caixa avcC para provar o formato de croma do H.264.
   Perfis Baseline/Main não gravam chroma_format_idc: o valor é 1 (4:2:0)
   por definição. Perfis High gravam Exp-Golomb ue(v). */
class LeitorBits {
  constructor(dados) { this.dados = dados; this.pos = 0; }
  u(quantos) {
    let valor = 0;
    for (let j = 0; j < quantos; j += 1) {
      const byte = this.dados[this.pos >> 3] || 0;
      valor = (valor << 1) | ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos += 1;
    }
    return valor;
  }
  ue() {
    let zeros = 0;
    while (this.u(1) === 0) zeros += 1;
    return (1 << zeros) - 1 + (zeros ? this.u(zeros) : 0);
  }
}

function formatoDePixel(buf) {
  const posicao = buf.indexOf(Buffer.from("avcC"));
  if (posicao < 0 || posicao + 12 > buf.length) return { determinado: false };
  const caixa = buf.subarray(posicao + 4);
  const perfil = caixa[1];
  const nivel = caixa[3];
  const quantidadeSPS = caixa[5] & 0x1f;
  if (!quantidadeSPS) return { determinado: false };
  const tamanhoSPS = caixa.readUInt16BE(6);
  const sps = caixa.subarray(8, 8 + tamanhoSPS);
  if (sps.length < 4) return { determinado: false };
  const bits = new LeitorBits(sps);
  bits.u(8); /* cabeçalho NAL */
  const perfilSPS = bits.u(8);
  bits.u(8); /* constraint flags */
  bits.u(8); /* level_idc */
  bits.ue(); /* seq_parameter_set_id */
  const perfisComCromaExplicito = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];
  const chroma = perfisComCromaExplicito.includes(perfilSPS) ? bits.ue() : 1;
  return {
    determinado: true,
    perfil,
    perfilSPS,
    nivel,
    chromaFormatIdc: chroma,
    yuv420p: chroma === 1,
  };
}

/* ------------------------------------------------------------------ */

const manifesto = JSON.parse(fs.readFileSync(CAMINHO_MANIFESTO, "utf8"));
const referencia = referenciaTexturaOficial();
const arquivosNoDisco = fs.readdirSync(DIR_VIDEOS).filter(n => n.toLowerCase().endsWith(".mp4")).sort();

const esperados = [];
for (const exercicio of manifesto.exercicios) {
  if (exercicio.modo !== "video") continue;
  for (const personagem of ["masculino", "feminino"]) {
    const entrada = exercicio.video && exercicio.video[personagem];
    if (!entrada || !entrada.arquivo) continue;
    esperados.push({
      exercicioId: exercicio.id,
      personagem,
      arquivo: entrada.arquivo,
      statusManifesto: entrada.status,
      metaManifesto: entrada.meta || null,
    });
  }
}

const problemas = [];
const achados = [];
const videos = [];

const mensagensFFmpeg = [];
const ffmpeg = await createFFmpegCore({
  print: () => {},
  printErr: mensagem => { if (mensagem) mensagensFFmpeg.push(String(mensagem)); },
});

for (const [indice, esperado] of esperados.entries()) {
  const absoluto = path.join(raiz, esperado.arquivo);
  const nome = path.basename(esperado.arquivo);
  const registro = { ...esperado, nome, especificacao: [], conforme: true, corPersonagem: null };

  if (!fs.existsSync(absoluto)) {
    problemas.push(`${esperado.arquivo}: arquivo ausente`);
    registro.conforme = false;
    videos.push(registro);
    continue;
  }
  const bytes = fs.readFileSync(absoluto);
  registro.bytes = bytes.length;
  registro.sha256 = sha256(bytes);

  /* Integridade contra o blob commitado. */
  const hashGit = execFileSync("git", ["hash-object", esperado.arquivo], { cwd: raiz }).toString().trim();
  const linhaArvore = execFileSync("git", ["ls-tree", "HEAD", "--", esperado.arquivo], { cwd: raiz }).toString().trim();
  const blobCommitado = linhaArvore.split(/\s+/)[2] || "";
  registro.git = { hashLocal: hashGit, blobCommitado, integro: hashGit === blobCommitado };
  if (!registro.git.integro) problemas.push(`${nome}: diverge do blob commitado`);

  /* Faststart: moov antes de mdat. */
  const caixas = caixasTopo(bytes);
  const moov = caixas.find(c => c.tipo === "moov");
  const mdat = caixas.find(c => c.tipo === "mdat");
  registro.faststart = Boolean(moov && mdat && moov.inicio < mdat.inicio);
  if (!registro.faststart) problemas.push(`${nome}: moov nao precede mdat`);
  registro.formatoDePixel = formatoDePixel(bytes);

  /* Metadados ISO-BMFF. */
  let meta;
  try {
    meta = lerMP4(absoluto);
  } catch (erro) {
    problemas.push(`${nome}: MP4 ilegível (${erro.message})`);
    registro.conforme = false;
    videos.push(registro);
    continue;
  }
  registro.medido = { ...meta, arquivo: esperado.arquivo };

  const checar = (nomeChecagem, ok, esperadoValor, obtido) => {
    registro.especificacao.push({ verificacao: nomeChecagem, ok, esperado: esperadoValor, obtido });
    if (!ok) problemas.push(`${nome}: ${nomeChecagem} (esperado ${esperadoValor}, obtido ${obtido})`);
  };
  checar("resolução 1280×720", meta.largura === W && meta.altura === H, "1280x720", `${meta.largura}x${meta.altura}`);
  checar("proporção 16:9", meta.proporcao !== null && Math.abs(meta.proporcao - 16 / 9) <= 0.002, 1.7778, meta.proporcao);
  checar("30 FPS", meta.fps !== null && Math.abs(meta.fps - 30) <= 0.05, 30, meta.fps);
  checar("H.264 (avc1)", meta.codec === "avc1", "avc1", meta.codec);
  checar("trilha de vídeo", meta.temVideo === true, true, meta.temVideo);
  checar("sem áudio", meta.temAudio === false, false, meta.temAudio);
  checar("moov antes de mdat", registro.faststart, true, registro.faststart);

  /* Manifesto: todos os metadados gravados precisam bater com a medição. */
  const campos = ["bytes", "largura", "altura", "fps", "duracaoS", "codec", "temVideo", "temAudio", "proporcao"];
  const divergencias = [];
  for (const campo of campos) {
    const gravado = esperado.metaManifesto ? esperado.metaManifesto[campo] : undefined;
    if (gravado !== meta[campo]) divergencias.push({ campo, gravado, medido: meta[campo] });
  }
  registro.manifesto = {
    status: esperado.statusManifesto,
    arquivoBate: esperado.metaManifesto ? esperado.metaManifesto.arquivo === esperado.arquivo : false,
    divergencias,
    conforme: esperado.statusManifesto === "pronto" && divergencias.length === 0,
  };
  if (!registro.manifesto.conforme) problemas.push(`${nome}: manifesto divergente (${JSON.stringify(divergencias)})`);

  /* Decodificação real. */
  mensagensFFmpeg.length = 0;
  const entrada = `v${indice}.mp4`;
  const pequeno = `p${indice}.raw`;
  const grande = `g${indice}.raw`;
  ffmpeg.FS.writeFile(entrada, bytes);
  const retPequeno = ffmpeg.exec(
    "-i", entrada, "-vf", `scale=${PEQUENO_W}:${PEQUENO_H}`,
    "-pix_fmt", "rgb24", "-f", "rawvideo", pequeno,
  );
  const retGrande = ffmpeg.exec(
    "-i", entrada, "-frames:v", "1",
    "-pix_fmt", "rgb24", "-f", "rawvideo", grande,
  );
  if (retPequeno !== 0 || retGrande !== 0) {
    problemas.push(`${nome}: ffmpeg.wasm falhou ao decodificar (${retPequeno}/${retGrande})`);
    registro.conforme = false;
    videos.push(registro);
    continue;
  }
  const bufPequeno = ffmpeg.FS.readFile(pequeno);
  const bufGrande = ffmpeg.FS.readFile(grande);
  const quadros = bufPequeno.length / BYTES_QUADRO_PEQUENO;
  const primeiro = bufPequeno.subarray(0, BYTES_QUADRO_PEQUENO);
  const segundo = bufPequeno.subarray(BYTES_QUADRO_PEQUENO, 2 * BYTES_QUADRO_PEQUENO);
  const meio = bufPequeno.subarray(Math.floor(quadros / 2) * BYTES_QUADRO_PEQUENO, (Math.floor(quadros / 2) + 1) * BYTES_QUADRO_PEQUENO);
  const ultimo = bufPequeno.subarray((quadros - 1) * BYTES_QUADRO_PEQUENO, quadros * BYTES_QUADRO_PEQUENO);
  const fundo = mediaCantos(bufGrande);
  const corPersonagem = mediaPixelsClaros(bufGrande);
  const fluxo = mensagensFFmpeg.filter(m => /Stream #|yuv420p/.test(m)).join(" | ");
  /* O core ffmpeg.wasm deste projeto suprime os logs de fluxo; o formato de
     croma é lido diretamente do SPS (caixa avcC), não de uma mensagem. */
  const yuv420p = registro.formatoDePixel.determinado && registro.formatoDePixel.yuv420p;

  registro.decodificado = {
    quadros,
    duracaoS: meta.duracaoS,
    fpsEmpirico: arredondar(quadros / meta.duracaoS, 3),
    fundoMedido: fundo,
    fundoEsperado: FUNDO_ESPERADO,
    fundoConforme: fundo.every((v, i) => Math.abs(v - FUNDO_ESPERADO[i]) <= TOLERANCIA_FUNDO),
    corPersonagem: corPersonagem.rgb,
    distanciaAteTexturaOficial: corPersonagem.rgb ? distancia(corPersonagem.rgb, referencia.rgb) : null,
    corConforme: corPersonagem.rgb ? distancia(corPersonagem.rgb, referencia.rgb) <= TOLERANCIA_COR : false,
    emendaLoop: {
      diferencaPrimeiroUltimo: mad(primeiro, ultimo),
      diferencaPrimeiroSegundo: mad(primeiro, segundo),
      diferencaPrimeiroMeio: mad(primeiro, meio),
    },
    fluxoFFmpeg: fluxo || "(sem linha de fluxo emitida)",
    yuv420p,
  };
  checar("quadros = duração × 30", Math.abs(quadros - meta.duracaoS * 30) <= 1, Math.round(meta.duracaoS * 30), quadros);
  checar("pixel yuv420p", yuv420p, true, yuv420p);
  if (!registro.decodificado.fundoConforme) {
    problemas.push(`${nome}: cor de fundo ${fundo.join(",")} fora de ±${TOLERANCIA_FUNDO} de ${FUNDO_ESPERADO.join(",")}`);
  }
  if (!registro.decodificado.corConforme) {
    achados.push({
      tipo: "cor do personagem divergente da textura oficial",
      arquivo: esperado.arquivo,
      corMedida: corPersonagem.rgb,
      referencia: referencia.rgb,
      distancia: registro.decodificado.distanciaAteTexturaOficial,
      limite: TOLERANCIA_COR,
    });
  }
  registro.conforme = registro.especificacao.every(c => c.ok) &&
    registro.manifesto.conforme && registro.git.integro && registro.decodificado.fundoConforme;
  videos.push(registro);

  /* Libera os buffers do FS em memória. */
  for (const alvo of [entrada, pequeno, grande]) {
    try { ffmpeg.FS.unlink(alvo); } catch { /* já removido */ }
  }
}

/* Arquivos órfãos. */
const relativosEsperados = new Set(esperados.map(e => path.basename(e.arquivo)));
const orfaos = arquivosNoDisco.filter(n => !relativosEsperados.has(n));
if (orfaos.length) problemas.push(`MP4 órfãos sem referência no manifesto: ${orfaos.join(", ")}`);

/* Quadros de evidência visual: primeiro quadro de um vídeo de cada
   personagem, extraído do MP4 publicado pelo próprio decodificador. */
const quadrosSalvos = [];
if (SALVAR_QUADROS) {
  const dirQuadros = path.join(DIR_EVIDENCIAS, "quadros");
  fs.mkdirSync(dirQuadros, { recursive: true });
  for (const personagem of ["masculino", "feminino"]) {
    const alvo = esperados.find(e => e.exercicioId === "cal-agachamento" && e.personagem === personagem);
    if (!alvo) continue;
    const entrada = `quadro-${personagem}.mp4`;
    const saida = `quadro-${personagem}.png`;
    ffmpeg.FS.writeFile(entrada, fs.readFileSync(path.join(raiz, alvo.arquivo)));
    const ret = ffmpeg.exec(
      "-i", entrada, "-frames:v", "1", "-vf", "scale=640:360",
      "-f", "image2", saida,
    );
    if (ret === 0) {
      const png = Buffer.from(ffmpeg.FS.readFile(saida));
      const destino = path.join(dirQuadros, `primeiro-quadro-${personagem}.png`);
      fs.writeFileSync(destino, png);
      quadrosSalvos.push({ arquivo: path.relative(raiz, destino), origem: alvo.arquivo, bytes: png.length });
    }
    for (const temporario of [entrada, saida]) {
      try { ffmpeg.FS.unlink(temporario); } catch { /* já removido */ }
    }
  }
}

/* Reproduzibilidade byte a byte (opcional). Um quadro salvo pelo próprio
   rasterizador (antes do BMP/encoder) serve de referência de cor. */
let reproducibilidade = null;
if (REPRODUZIR) {
  const alvo = esperados.find(e => e.exercicioId === "cal-agachamento" && e.personagem === "masculino");
  const clipe = manifesto.exercicios.find(e => e.id === alvo.exercicioId).clipeId;
  const saida = path.join("/tmp", `forja-reproducibilidade-${process.pid}.mp4`);
  const dirQuadrosRender = path.join("/tmp", `forja-quadros-${process.pid}`);
  const log = execFileSync(process.execPath, [
    path.join(raiz, "tools", "renderizar-videos-3d.mjs"),
    "--personagem", "masculino", "--clipe", clipe,
    "--saida", saida, "--salvar-quadros", dirQuadrosRender,
  ], { cwd: raiz, encoding: "utf8", timeout: 600000 });
  const novo = fs.readFileSync(saida);
  const publicado = fs.readFileSync(path.join(raiz, alvo.arquivo));
  const quadroRasterizador = path.join(dirQuadrosRender, "quadro-0001.png");
  let referenciaRasterizador = null;
  if (fs.existsSync(quadroRasterizador)) {
    const destino = path.join(DIR_EVIDENCIAS, "quadros", "rasterizador-antes-do-encoder.png");
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(quadroRasterizador, destino);
    referenciaRasterizador = path.relative(raiz, destino);
  }
  reproducibilidade = {
    arquivo: alvo.arquivo,
    comando: `node tools/renderizar-videos-3d.mjs --personagem masculino --clipe ${clipe} --saida <tmp> --salvar-quadros <tmp>`,
    sha256Regerado: sha256(novo),
    sha256Publicado: sha256(publicado),
    identico: novo.equals(publicado),
    bytes: novo.length,
    quadroDeReferencia: referenciaRasterizador,
    ultimaLinha: log.trim().split("\n").at(-1),
  };
  fs.rmSync(saida, { force: true });
  fs.rmSync(dirQuadrosRender, { recursive: true, force: true });
  if (!reproducibilidade.identico) problemas.push("re-renderização não produziu o mesmo MP4");
}

/* ------------------------------------------------------------------ */

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: raiz }).toString().trim();
const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: raiz }).toString().trim();
const relatorio = {
  geradoEm: new Date().toISOString(),
  ferramenta: "tools/verificar-videos-exercicios.mjs",
  branch,
  commit,
  node: process.version,
  manifesto: {
    arquivo: "assets/3d/apresentacao-exercicios.json",
    resumo: manifesto.resumo,
    exerciciosEmModoVideo: manifesto.exercicios.filter(e => e.modo === "video").length,
  },
  referenciaTexturaOficial: referencia,
  parametros: { W, H, TOLERANCIA_FUNDO, TOLERANCIA_COR, decodificador: "@ffmpeg/core (ffmpeg.wasm)" },
  inventario: {
    mp4NoDisco: arquivosNoDisco.length,
    referenciasNoManifesto: esperados.length,
    orfaos,
  },
  reproducibilidade,
  quadrosSalvos,
  videos,
  problemasTecnicos: problemas,
  achadosVisuais: achados,
  resultado: {
    verificacoesTecnicas: problemas.length === 0 ? "APROVADO" : "REPROVADO",
    totalProblemasTecnicos: problemas.length,
    totalAchadosVisuais: achados.length,
    videosConformes: videos.filter(v => v.conforme).length,
    videosAnalisados: videos.length,
  },
};

fs.mkdirSync(DIR_EVIDENCIAS, { recursive: true });
fs.writeFileSync(
  path.join(DIR_EVIDENCIAS, "evidencias.json"),
  JSON.stringify(relatorio, null, 2) + "\n",
);

console.log(`MP4 no disco: ${arquivosNoDisco.length} | referências no manifesto: ${esperados.length} | órfãos: ${orfaos.length}`);
console.log(`Vídeos conformes: ${relatorio.resultado.videosConformes}/${relatorio.resultado.videosAnalisados}`);
console.log(`Cor de referência da textura oficial: RGB(${referencia.rgb.join(", ")})`);
if (reproducibilidade) {
  console.log(`Reproduzibilidade byte a byte: ${reproducibilidade.identico ? "IDÊNTICO" : "DIVERGENTE"} (${reproducibilidade.sha256Publicado})`);
}
console.log(`Problemas técnicos: ${problemas.length}`);
problemas.forEach(p => console.log("  - " + p));
console.log(`Achados visuais (cor do personagem): ${achados.length}`);
if (achados.length) {
  const exemplo = achados[0];
  console.log(`  Exemplo: ${exemplo.arquivo} → RGB(${exemplo.corMedida.join(", ")}), distância ${exemplo.distancia} (limite ${exemplo.limite})`);
}
console.log(`Evidências: ${path.relative(raiz, path.join(DIR_EVIDENCIAS, "evidencias.json"))}`);
process.exit(problemas.length ? 1 : 0);
