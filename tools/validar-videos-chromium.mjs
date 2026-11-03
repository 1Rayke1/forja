#!/usr/bin/env node
/*
  FORJA — validação dos 28 MP4 em Chromium REAL (não em jsdom, não por
  metadados). Reproduz cada vídeo, conta quadros por requestVideoFrameCallback,
  captura quadros em canvas e mede: resolução, FPS efetivo, reprodução,
  movimento, enquadramento e cor do personagem.

  Também gera as REFERÊNCIAS OFICIAIS em WebGL: o mesmo GLB publicado em
  assets/3d/personagens/, renderizado pela própria cena do app
  (assets/js/forja-3d-cena.js, modoApresentacao) com as luzes e a câmera
  originais — sem alterar modelo, material, luz ou animação.

  Uso: node tools/validar-videos-chromium.mjs
  Saída: docs/validacao-3d/correcao-videos-28/validacao-chromium.json
         docs/validacao-3d/correcao-videos-28/quadros/referencia-webgl-*.png
*/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import jpeg from "jpeg-js";
import { lerMP4 } from "./lib/probe-mp4.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(raiz, "docs", "validacao-3d", "correcao-videos-28");
const DIR_QUADROS = path.join(DIR, "quadros");
fs.mkdirSync(DIR_QUADROS, { recursive: true });

/* Bibliotecas Amazon Linux que o Chromium empacotado precisa (igual ao e2e). */
const modulePath = fileURLToPath(import.meta.resolve("@sparticuz/chromium"));
const packageRoot = path.resolve(path.dirname(modulePath), "../..");
const libRoot = path.join(os.tmpdir(), "forja-e2e-al2023");
const nspr = path.join(libRoot, "lib", "libnspr4.so");
if (!fs.existsSync(nspr)) {
  fs.mkdirSync(libRoot, { recursive: true });
  const tar = path.join(os.tmpdir(), "forja-e2e-al2023.tar");
  fs.writeFileSync(tar, brotliDecompressSync(fs.readFileSync(path.join(packageRoot, "bin", "al2023.tar.br"))));
  execFileSync("tar", ["-xf", tar, "-C", libRoot]);
  fs.unlinkSync(tar);
}
process.env.LD_LIBRARY_PATH = path.join(libRoot, "lib");

/* A madeira bege é a textura JPEG embutida no GLB de CADA personagem.
   A tarefa cita ~RGB(170,143,101): é a madeira do masculino. O GLB feminino
   usa madeira mais clara (textura ~253/219/157), como confirmam as referências
   WebGL oficiais geradas abaixo. Comparar os dois personagens com um único
   valor fixo acusaria como defeito uma cor que é parte do modelo oficial. */
function corDaTexturaOficial(personagem) {
  const glb = fs.readFileSync(path.join(raiz, "assets", "3d", "personagens", `${personagem}.glb`));
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
  const decodificada = jpeg.decode(new Uint8Array(bin.subarray(vista.byteOffset, vista.byteOffset + vista.byteLength)));
  const soma = [0, 0, 0];
  let n = 0;
  for (let i = 0; i + 3 < decodificada.data.length; i += 4) {
    soma[0] += decodificada.data[i]; soma[1] += decodificada.data[i + 1]; soma[2] += decodificada.data[i + 2]; n += 1;
  }
  return soma.map(v => Number((v / n).toFixed(1)));
}
const COR_TEXTURA = {
  masculino: corDaTexturaOficial("masculino"),
  feminino: corDaTexturaOficial("feminino"),
};
const COR_BEGE_REFERENCIA = [170, 143, 101];
/* A própria referência WebGL oficial (mesmo GLB, luzes e câmera do app) mede
   ~128/96/57 no masculino e ~191/170/113 no feminino, ou seja, fica a 52–90
   de distância RGB da textura crua por causa de iluminação, gamma e pose.
   O brilho absoluto NÃO é um critério de fidelidade; o MATIZ (cromaticidade)
   é. Mantemos um limite absoluto frouxo apenas como rede de segurança e
   usamos a distância de cromaticidade como critério principal. */
const TOLERANCIA_COR = 70;
const TOLERANCIA_CROMATICIDADE = 0.08;
const cromaticidade = cor => { const soma = cor[0] + cor[1] + cor[2]; return cor.map(v => v / soma); };
const distanciaCromaticidade = (a, b) => {
  const ca = cromaticidade(a), cb = cromaticidade(b);
  return Number(Math.sqrt(ca.reduce((s, v, i) => s + (v - cb[i]) ** 2, 0)).toFixed(4));
};
const TOLERANCIA_FPS = 2;
const LIMIAR_MOVIMENTO = 0.05; /* prancha é isométrica: movimento pequeno, porém > 0 */

const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, "assets/3d/apresentacao-exercicios.json"), "utf8"));
const esperados = [];
for (const exercicio of manifesto.exercicios) {
  if (exercicio.modo !== "video") continue;
  for (const personagem of ["masculino", "feminino"]) {
    const entrada = exercicio.video && exercicio.video[personagem];
    if (entrada && entrada.arquivo) esperados.push({ exercicioId: exercicio.id, personagem, arquivo: entrada.arquivo });
  }
}

const HTML_REFERENCIA = personagem => `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#121010}#palco{width:1280px;height:720px}</style></head><body>
<div id="palco"></div><script type="module">
import { criarCena } from '/assets/js/forja-3d-cena.js';
window.__erro=null;
try {
  window.__api = await criarCena(document.getElementById('palco'), {
    personagemUrl: '/assets/3d/personagens/${personagem}.glb',
    modoApresentacao: true,
    aoErro: e => { window.__erro = String(e.erro || e); }
  });
  window.__pronto = true;
} catch (e) { window.__erro = String(e); }
</script></body></html>`;

const HTML_VIDEO = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body style=\"margin:0;background:#121010\"></body></html>";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".glb": "model/gltf-binary", ".json": "application/json", ".mp4": "video/mp4",
  ".png": "image/png", ".css": "text/css", ".jpg": "image/jpeg",
};

const paginas = new Map();
const server = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  if (paginas.has(u)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(paginas.get(u));
    return;
  }
  const arquivo = path.join(raiz, decodeURIComponent(u));
  if (!arquivo.startsWith(raiz) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(arquivo)] || "application/octet-stream" });
  fs.createReadStream(arquivo).pipe(res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
  executablePath: await chromium.executablePath(),
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

/* ---------------- Referências oficiais em WebGL ---------------- */
const referenciasWebGL = [];
for (const personagem of ["masculino", "feminino"]) {
  const rota = `/referencia-${personagem}.html`;
  paginas.set(rota, HTML_REFERENCIA(personagem));
  await page.goto(base + rota, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__pronto === true || window.__erro !== null", { timeout: 30000 });
  const estado = await page.evaluate(() => ({ pronto: window.__pronto, erro: window.__erro, canvas: Boolean(document.querySelector("canvas")) }));
  if (!estado.pronto || !estado.canvas) throw new Error(`referência WebGL ${personagem} falhou: ${JSON.stringify(estado)}`);
  await new Promise(r => setTimeout(r, 700));
  const elemento = await page.$("#palco");
  const png = await elemento.screenshot();
  const destino = path.join(DIR_QUADROS, `referencia-webgl-${personagem}.png`);
  fs.writeFileSync(destino, png);
  referenciasWebGL.push({ personagem, arquivo: path.relative(raiz, destino), bytes: png.length, estado });
  console.log(`Referência WebGL ${personagem}: ${png.length} bytes`);
}

/* ---------------- Validação dos 28 MP4 ---------------- */
async function medirNoNavegador(urlRelativa) {
  return page.evaluate(async url => {
    const v = document.createElement("video");
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto";
    v.setAttribute("playsinline", "");
    v.src = url;
    document.body.appendChild(v);
    const esperar = (evento, ms = 12000) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout " + evento)), ms);
      v.addEventListener(evento, () => { clearTimeout(t); resolve(); }, { once: true });
      v.addEventListener("error", () => { clearTimeout(t); reject(new Error("erro de mídia " + (v.error && v.error.code))); }, { once: true });
    });
    await esperar("loadeddata");

    const W = 160, H = 90;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const alvos = [0.03, 0.35, 0.7];
    const capturas = [];
    const tempos = [];
    let quadros = 0;

    const quadrosAntes = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : null;
    const inicioMs = performance.now();
    await new Promise(resolve => {
      const callback = (agora, meta) => {
        quadros += 1;
        tempos.push(meta.mediaTime);
        if (capturas.length < alvos.length && meta.mediaTime >= v.duration * alvos[capturas.length]) {
          ctx.drawImage(v, 0, 0, W, H);
          capturas.push({ t: meta.mediaTime, dados: ctx.getImageData(0, 0, W, H).data.slice() });
        }
        if (meta.mediaTime < v.duration - 0.05 && quadros < 600) v.requestVideoFrameCallback(callback);
        else resolve();
      };
      v.requestVideoFrameCallback(callback);
      v.play().catch(() => {});
    });
    const fimMs = performance.now();

    const qualidade = v.getVideoPlaybackQuality
      ? { total: v.getVideoPlaybackQuality().totalVideoFrames, perdidos: v.getVideoPlaybackQuality().droppedVideoFrames }
      : null;
    const fps = quadros > 1 && tempos.at(-1) > tempos[0]
      ? Number(((quadros - 1) / (tempos.at(-1) - tempos[0])).toFixed(2)) : null;
    /* Segunda medição independente: quadros efetivamente APRESENTADOS pelo
       elemento <video> por segundo de tempo real. requestVideoFrameCallback
       pode perder callbacks em clipes curtos no Chromium headless, enquanto
       getVideoPlaybackQuality conta os quadros apresentados de fato. */
    const quadrosDepois = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : null;
    const fpsApresentados = quadrosAntes !== null && quadrosDepois !== null && fimMs > inicioMs
      ? Number(((quadrosDepois - quadrosAntes) / ((fimMs - inicioMs) / 1000)).toFixed(2)) : null;

    const mad = (a, b) => {
      let soma = 0, n = 0;
      for (let i = 0; i < a.length; i += 4) {
        soma += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        n += 3;
      }
      return Number((soma / n).toFixed(3));
    };

    const primeiro = capturas[0] ? capturas[0].dados : null;
    let fundo = null, cor = null, bbox = null, pixels = 0;
    if (primeiro) {
      const somaFundo = [0, 0, 0];
      let nf = 0;
      for (const y of [0, 1, 2, H - 3, H - 2, H - 1]) {
        for (const x of [0, 1, 2, W - 3, W - 2, W - 1]) {
          const i = (y * W + x) * 4;
          somaFundo[0] += primeiro[i]; somaFundo[1] += primeiro[i + 1]; somaFundo[2] += primeiro[i + 2]; nf += 1;
        }
      }
      fundo = somaFundo.map(valor => Number((valor / nf).toFixed(1)));
      const soma = [0, 0, 0];
      let minx = W, maxx = 0, miny = H, maxy = 0;
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const i = (y * W + x) * 4;
          const d = Math.abs(primeiro[i] - fundo[0]) + Math.abs(primeiro[i + 1] - fundo[1]) + Math.abs(primeiro[i + 2] - fundo[2]);
          if (d > 60) {
            soma[0] += primeiro[i]; soma[1] += primeiro[i + 1]; soma[2] += primeiro[i + 2];
            pixels += 1;
            if (x < minx) minx = x; if (x > maxx) maxx = x;
            if (y < miny) miny = y; if (y > maxy) maxy = y;
          }
        }
      }
      cor = pixels ? soma.map(valor => Number((valor / pixels).toFixed(1))) : null;
      bbox = pixels ? [minx, miny, maxx, maxy] : null;
    }

    const resultado = {
      largura: v.videoWidth,
      altura: v.videoHeight,
      duracao: Number(v.duration.toFixed(4)),
      canPlayH264: v.canPlayType('video/mp4; codecs="avc1.42E01E"'),
      reproducao: {
        pausado: v.paused,
        tempoAtual: Number(v.currentTime.toFixed(4)),
        readyState: v.readyState,
        erro: v.error ? v.error.code : null,
        loop: v.loop, mudo: v.muted, inline: v.playsInline,
      },
      quadrosApresentados: quadros,
      quadrosQualidade: qualidade,
      fpsEfetivo: fps,
      fpsApresentados,
      tempoQuadros: capturas.map(c => Number(c.t.toFixed(3))),
      fundoMedido: fundo,
      corPersonagem: cor,
      pixelsPersonagem: pixels,
      bbox: bbox,
      movimento: capturas.length >= 3
        ? { inicioMeio: mad(capturas[0].dados, capturas[1].dados), inicioFim: mad(capturas[0].dados, capturas[2].dados) }
        : null,
    };
    v.pause();
    v.remove();
    return resultado;
  }, urlRelativa);
}

paginas.set("/valida.html", HTML_VIDEO);
const problemas = [];
const videos = [];
for (const esperado of esperados) {
  const relativo = "/" + esperado.arquivo.replace(/\\/g, "/");
  const fpsDeclarado = lerMP4(path.join(raiz, esperado.arquivo)).fps;
  await page.goto(base + "/valida.html", { waitUntil: "domcontentloaded" });
  let medido;
  try {
    medido = await medirNoNavegador(relativo);
  } catch (erro) {
    problemas.push(`${esperado.arquivo}: ${erro.message}`);
    videos.push({ ...esperado, erro: erro.message });
    continue;
  }
  const corEsperada = COR_TEXTURA[esperado.personagem];
  const distancia = medido.corPersonagem
    ? Number(Math.sqrt(medido.corPersonagem.reduce((s, c, i) => s + (c - corEsperada[i]) ** 2, 0)).toFixed(1)) : null;
  const checagens = {
    resolucao: medido.largura === 1280 && medido.altura === 720,
    codec: medido.canPlayH264 === "probably" && medido.reproducao.erro === null,
    /* O estado é amostrado depois do laço: em 2 vídeos o `readyState` voltou
       a 1 exatamente no instante do loop. A prova de reprodução são os quadros
       apresentados e o mediaTime percorrido, não esse instantâneo. */
    reproducao: !medido.reproducao.pausado && medido.quadrosApresentados > 20 &&
      Math.max(...medido.tempoQuadros) > 0.5 && medido.reproducao.erro === null,
    /* O arquivo é 30 fps CFR (stts do MP4). No navegador, três evidências
       independentes: taxa do rVFC, taxa de quadros apresentados por segundo
       real e — a mais direta — o TOTAL de quadros apresentados no clipe, que
       deve ser duração × 30. Em clipes curtos o Chromium headless atrasa
       callbacks/tempo real, mas apresenta todos os quadros. */
    fpsArquivo: fpsDeclarado === 30,
    fps: fpsDeclarado === 30 && (
      (medido.fpsEfetivo !== null && Math.abs(medido.fpsEfetivo - 30) <= TOLERANCIA_FPS) ||
      (medido.fpsApresentados !== null && Math.abs(medido.fpsApresentados - 30) <= TOLERANCIA_FPS) ||
      (medido.quadrosQualidade && Math.abs(medido.quadrosQualidade.total - Math.round(medido.duracao * 30)) <= 2)),
    movimento: Boolean(medido.movimento) && Math.max(medido.movimento.inicioMeio, medido.movimento.inicioFim) > LIMIAR_MOVIMENTO,
    enquadramento: Boolean(medido.bbox) && medido.bbox[0] > 0 && medido.bbox[1] > 0 &&
      medido.bbox[2] < 159 && medido.bbox[3] < 89 && medido.pixelsPersonagem > 100,
    corAbsoluta: Boolean(medido.corPersonagem) && distancia !== null && distancia <= TOLERANCIA_COR,
    cromaticidadeDaMadeira: Boolean(medido.corPersonagem) &&
      distanciaCromaticidade(medido.corPersonagem, corEsperada) <= TOLERANCIA_CROMATICIDADE,
    matizBege: Boolean(medido.corPersonagem) &&
      medido.corPersonagem[0] > medido.corPersonagem[1] &&
      medido.corPersonagem[1] > medido.corPersonagem[2] &&
      medido.corPersonagem[0] - medido.corPersonagem[2] >= 25 &&
      medido.corPersonagem[0] - medido.corPersonagem[2] <= 140,
  };
  for (const [nome, ok] of Object.entries(checagens)) {
    if (!ok) problemas.push(`${esperado.arquivo}: ${nome} falhou`);
  }
  videos.push({
    ...esperado,
    fpsDeclaradoNoArquivo: fpsDeclarado,
    corTexturaOficial: corEsperada,
    distanciaCorOficial: distancia,
    distanciaCromaticidade: medido.corPersonagem ? distanciaCromaticidade(medido.corPersonagem, corEsperada) : null,
    checagens,
    medido,
  });
  console.log(`${esperado.exercicioId}/${esperado.personagem}: ${medido.largura}x${medido.altura} ${medido.fpsEfetivo} fps | cor ${medido.corPersonagem && medido.corPersonagem.join("/")} (d=${distancia}) | movimento ${medido.movimento && medido.movimento.inicioMeio} | ${Object.values(checagens).every(Boolean) ? "OK" : "FALHA"}`);
}

const relatorio = {
  geradoEm: new Date().toISOString(),
  navegador: "Chromium headless (@sparticuz/chromium, SwiftShader)",
  userAgent: await browser.userAgent(),
  corBegeDeReferenciaDaTarefa: COR_BEGE_REFERENCIA,
  corDaTexturaOficialPorPersonagem: COR_TEXTURA,
  parametros: {
    TOLERANCIA_COR, TOLERANCIA_CROMATICIDADE, TOLERANCIA_FPS, LIMIAR_MOVIMENTO,
    amostra: "canvas 160x90 em 3 instantes da reprodução",
    observacao: "brilho absoluto varia com iluminação/gamma/pose; o critério de fidelidade é o matiz (cromaticidade) e r>g>b",
  },
  referenciasWebGL,
  videos,
  problemas,
  resultado: {
    analisados: videos.length,
    aprovados: videos.filter(v => v.checagens && Object.values(v.checagens).every(Boolean)).length,
    totalProblemas: problemas.length,
  },
};
fs.writeFileSync(path.join(DIR, "validacao-chromium.json"), JSON.stringify(relatorio, null, 2) + "\n");
console.log(`\nChromium: ${relatorio.resultado.aprovados}/${relatorio.resultado.analisados} aprovados, ${problemas.length} problemas.`);
problemas.forEach(p => console.log("  - " + p));

await browser.close();
server.close();
process.exit(problemas.length ? 1 : 0);
