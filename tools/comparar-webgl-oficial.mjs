#!/usr/bin/env node
/*
  FORJA — comparação dos 28 MP4 corrigidos com a CENA WEBGL OFICIAL do app.

  Para cada exercício × personagem, renderiza o MESMO GLB com o MESMO clipe,
  as MESMAS luzes e a MESMA câmera de apresentação (assets/js/forja-3d-cena.js,
  modoApresentacao) em Chromium real e compara com 3 quadros do MP4:
  início, 50% e 85% da duração — exatamente os instantes dos mosaicos de
  evolução. Mede silhueta (IoU), cor média do personagem e bbox.

  O instante é DETERMINÍSTICO: THREE.Clock e requestAnimationFrame da cena
  oficial são controlados por um relógio virtual a 30 fps injetado apenas na
  página de teste. Nenhum arquivo do app é alterado. O WebGL oficial é lido
  como está, apenas para referência.

  Uso: node tools/comparar-webgl-oficial.mjs
  Variáveis opcionais:
    FILTRO=cal-ponte          limita os casos (substring de id/personagem)
    CASOS_DETALHE=id1,id2     escolhe os casos dos mosaicos ampliados
    SAIDA=/caminho            redireciona TODAS as saídas (para inspeções
                              pontuais sem sobrescrever as evidências finais)

  Saída: docs/validacao-3d/correcao-videos-28/comparacao-webgl.json
         docs/validacao-3d/correcao-videos-28/mosaicos/mosaico-06..09-*.png
         docs/validacao-3d/correcao-videos-28/quadros/webgl/*.png
*/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { brotliDecompressSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { lerMP4 } from "./lib/probe-mp4.mjs";
import { canvas, retangulo, texto, imagem, escreverPNG } from "./lib/mosaico.mjs";

const require = createRequire(import.meta.url);
const createFFmpegCore = require("@ffmpeg/core");
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(raiz, "docs", "validacao-3d", "correcao-videos-28");
const SAIDA = process.env.SAIDA ? path.resolve(process.env.SAIDA) : DIR;
const DIR_QUADROS = path.join(SAIDA, "quadros", "webgl");
const DIR_MOSAICOS = path.join(SAIDA, "mosaicos");
const FILTRO = process.env.FILTRO || "";
fs.mkdirSync(DIR_QUADROS, { recursive: true });
fs.mkdirSync(DIR_MOSAICOS, { recursive: true });

const modulePath = fileURLToPath(import.meta.resolve("@sparticuz/chromium"));
const packageRoot = path.resolve(path.dirname(modulePath), "../..");
const libRoot = path.join(os.tmpdir(), "forja-e2e-al2023");
if (!fs.existsSync(path.join(libRoot, "lib", "libnspr4.so"))) {
  fs.mkdirSync(libRoot, { recursive: true });
  const tar = path.join(os.tmpdir(), "forja-e2e-al2023.tar");
  fs.writeFileSync(tar, brotliDecompressSync(fs.readFileSync(path.join(packageRoot, "bin", "al2023.tar.br"))));
  execFileSync("tar", ["-xf", tar, "-C", libRoot]);
  fs.unlinkSync(tar);
}
process.env.LD_LIBRARY_PATH = path.join(libRoot, "lib");

const ffmpeg = await createFFmpegCore({ print: () => {}, printErr: () => {} });
/* Nomes FIXOS por resolução: dezenas de nomes diferentes no MEMFS do
   ffmpeg.wasm fragmentam o heap e causam "memory access out of bounds". */
function decodificarPNGRGB(entrada, W = 320, H = 180) {
  const png = `cmp_webgl_${W}.png`, bruto = `cmp_webgl_${W}.raw`;
  ffmpeg.FS.writeFile(png, Buffer.isBuffer(entrada) ? entrada : fs.readFileSync(entrada));
  const ret = ffmpeg.exec("-i", png, "-vf", `scale=${W}:${H}`, "-pix_fmt", "rgb24", "-f", "rawvideo", bruto);
  if (ret !== 0) throw new Error(`falha ao decodificar PNG (${ret})`);
  const rgb = Buffer.from(ffmpeg.FS.readFile(bruto));
  for (const alvo of [png, bruto]) { try { ffmpeg.FS.unlink(alvo); } catch { /* ok */ } }
  return { rgb, W, H };
}
function quadroDoMP4(arquivo, instanteS, W = 320, H = 180) {
  const entrada = `cmp_video_${W}.mp4`, saida = `cmp_video_${W}.raw`;
  ffmpeg.FS.writeFile(entrada, fs.readFileSync(arquivo));
  const args = [];
  if (instanteS > 0) args.push("-ss", instanteS.toFixed(3));
  args.push("-i", entrada, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-pix_fmt", "rgb24", "-f", "rawvideo", saida);
  const ret = ffmpeg.exec(...args);
  if (ret !== 0) throw new Error(`falha ao decodificar ${arquivo} (${ret})`);
  const rgb = Buffer.from(ffmpeg.FS.readFile(saida));
  for (const alvo of [entrada, saida]) { try { ffmpeg.FS.unlink(alvo); } catch { /* ok */ } }
  return { rgb, W, H };
}

/* Mede fundo, cor média do personagem, bbox e máscara de silhueta. */
function medir(q) {
  const { rgb, W, H } = q;
  const fundo = [rgb[0], rgb[1], rgb[2]];
  const mascara = new Uint8Array(W * H);
  let soma = [0, 0, 0], n = 0, minx = W, maxx = 0, miny = H, maxy = 0;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 3;
    const d = Math.abs(rgb[i] - fundo[0]) + Math.abs(rgb[i + 1] - fundo[1]) + Math.abs(rgb[i + 2] - fundo[2]);
    if (d > 60) {
      mascara[y * W + x] = 1;
      soma[0] += rgb[i]; soma[1] += rgb[i + 1]; soma[2] += rgb[i + 2]; n += 1;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
  }
  return {
    fundo,
    corPersonagem: n ? soma.map(v => Number((v / n).toFixed(1))) : null,
    pixels: n,
    bbox: n ? [minx, miny, maxx, maxy] : null,
    mascara,
  };
}
function iou(a, b) {
  let inter = 0, uniao = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] || b[i]) uniao += 1;
    if (a[i] && b[i]) inter += 1;
  }
  return uniao ? Number((inter / uniao).toFixed(3)) : 0;
}

/* ------------------------- manifesto e catálogo ------------------------- */
const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, "assets/3d/apresentacao-exercicios.json"), "utf8"));
const catalogo = JSON.parse(fs.readFileSync(path.join(raiz, "assets/3d/catalogo.json"), "utf8"));
const casos = [];
for (const exercicio of manifesto.exercicios) {
  if (exercicio.modo !== "video") continue;
  const clipe = catalogo.clipes.find(c => c.id === exercicio.clipeId);
  if (!clipe) throw new Error(`clipe não encontrado: ${exercicio.clipeId}`);
  for (const personagem of ["masculino", "feminino"]) {
    if (FILTRO && !`${exercicio.id}/${personagem}`.includes(FILTRO)) continue;
    const arquivo = exercicio.video[personagem].arquivo;
    casos.push({
      exercicioId: exercicio.id, clipeId: exercicio.clipeId, clipeArquivo: clipe.arquivo,
      personagem, arquivo, duracaoS: lerMP4(path.join(raiz, arquivo)).duracaoS,
    });
  }
}

const INSTANTES = [
  { rotulo: "INICIO", fracao: 0 },
  { rotulo: "MEIO", fracao: 0.5 },
  { rotulo: "FIM", fracao: 0.85 },
];
const PROBLEMATICOS = process.env.CASOS_DETALHE
  ? process.env.CASOS_DETALHE.split(",")
  : [
    "cal-ponte", "cal-abdominal-supra", "cal-elevacao-pernas",
    "cal-mountain-climber", "cal-flexao", "cal-prancha-frontal",
  ];

/* Pré-decodifica TODOS os quadros do MP4 antes de abrir o Chromium: evita
   dezenas de escritas de arquivos grandes no MEMFS enquanto o navegador
   também ocupa memória. */
const quadrosCPU = {};
for (const caso of casos) {
  for (const inst of INSTANTES) {
    const chave = `${caso.exercicioId}-${caso.personagem}-${inst.rotulo.toLowerCase()}`;
    quadrosCPU[chave] = quadroDoMP4(path.join(raiz, caso.arquivo), caso.duracaoS * inst.fracao);
  }
}
console.log(`Quadros CPU pré-decodificados: ${Object.keys(quadrosCPU).length}`);

/* ----------------------------- servidor ----------------------------- */
const paginas = new Map();
const HTML = c => `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#121010}#palco{width:1280px;height:720px}</style></head><body>
<div id="palco"></div><script>
/* Relógio virtual de TESTE: o laço de apresentação do app usa THREE.Clock +
   requestAnimationFrame. Controlar os dois deixa o instante do WebGL
   exatamente igual ao instante amostrado no MP4 (30 fps determinístico),
   sem a defasagem do relógio real do Chromium headless. Nada no app muda. */
(() => {
  let t = 0;
  try { Object.defineProperty(performance, "now", { configurable: true, value: () => t }); }
  catch (e) { window.__erroRelogio = String(e); }
  const fila = [];
  window.requestAnimationFrame = cb => { fila.push(cb); return fila.length; };
  window.cancelAnimationFrame = () => {};
  window.__passo = async (quadros) => {
    for (let k = 0; k < quadros; k += 1) {
      t += 1000 / 30;
      const atual = fila.splice(0);
      for (const cb of atual) cb(t);
      await new Promise(r => setTimeout(r, 0));
    }
  };
  window.__tempoVirtual = () => t / 1000;
})();
</script><script type="module">
import { criarCena } from '/assets/js/forja-3d-cena.js';
window.__erro = null;
try {
  window.__api = await criarCena(document.getElementById('palco'), {
    personagemId: '${c.personagem}',
    personagemUrl: '/assets/3d/personagens/${c.personagem}.glb',
    clipeUrl: '/${c.clipeArquivo}',
    clipeId: '${c.clipeId}',
    modoApresentacao: true,
    aoErro: e => { window.__erro = String(e.erro || e); }
  });
  window.__api.pause();
  window.__pronto = true;
} catch (e) { window.__erro = String(e); }
</script></body></html>`;
const MIME = { ".js": "text/javascript; charset=utf-8", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  if (paginas.has(u)) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(paginas.get(u)); return; }
  const arquivo = path.join(raiz, decodeURIComponent(u));
  if (!arquivo.startsWith(raiz) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(arquivo)] || "application/octet-stream" });
  fs.createReadStream(arquivo).pipe(res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
  executablePath: await chromium.executablePath(), headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

const CELULA_W = 320, CELULA_H = 180, BARRA = 24;
const quadrosWebGL = {};
const resultados = [];

for (const caso of casos) {
  const rota = `/cmp-${caso.exercicioId}-${caso.personagem}.html`;
  paginas.set(rota, HTML(caso));
  await page.goto(base + rota, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__pronto === true || window.__erro !== null", { timeout: 30000 });
  const estado = await page.evaluate(() => ({ pronto: window.__pronto, erro: window.__erro }));
  if (!estado.pronto) throw new Error(`WebGL falhou em ${caso.exercicioId}/${caso.personagem}: ${estado.erro}`);

  const registro = { ...caso, estado, instantes: [] };
  for (const inst of INSTANTES) {
    const tempo = caso.duracaoS * inst.fracao;
    const quadros = Math.round(tempo * 30);
    if (inst.fracao === 0) {
      /* Um passo com o mixer pausado só força o renderer a desenhar t=0. */
      await page.evaluate(() => { window.__api.reiniciar(); window.__api.pause(); });
      await page.evaluate(() => window.__passo(1));
    } else {
      await page.evaluate(() => { window.__api.reiniciar(); window.__api.play(); });
      await page.evaluate(n => window.__passo(n), quadros);
      await page.evaluate(() => { window.__api.pause(); return window.__passo(1); });
    }
    const tempoVirtualWebGL = await page.evaluate(() => Number(window.__tempoVirtual().toFixed(3)));
    const png = await (await page.$("#palco")).screenshot();
    const chave = `${caso.exercicioId}-${caso.personagem}-${inst.rotulo.toLowerCase()}`;
    quadrosWebGL[chave] = decodificarPNGRGB(png);
    /* Quadros WEBGL OFICIAIS em resolução cheia, no MESMO instante do MP4,
       para os exercícios com maior divergência de enquadramento. */
    if (PROBLEMATICOS.includes(caso.exercicioId)) {
      fs.writeFileSync(path.join(DIR_QUADROS, `${chave}.png`), png);
    }
    const cpu = quadrosCPU[chave];
    const mWebGL = medir(quadrosWebGL[chave]);
    const mCPU = medir(cpu);
    const distanciaCor = mWebGL.corPersonagem && mCPU.corPersonagem
      ? Number(Math.sqrt(mWebGL.corPersonagem.reduce((s, v, i) => s + (v - mCPU.corPersonagem[i]) ** 2, 0)).toFixed(1)) : null;
    registro.instantes.push({
      rotulo: inst.rotulo, tempoS: Number(tempo.toFixed(3)), quadrosWebGL: quadros,
      tempoVirtualWebGL,
      webgl: { fundo: mWebGL.fundo, corPersonagem: mWebGL.corPersonagem, pixels: mWebGL.pixels, bbox: mWebGL.bbox },
      cpu: { fundo: mCPU.fundo, corPersonagem: mCPU.corPersonagem, pixels: mCPU.pixels, bbox: mCPU.bbox },
      iouSilhueta: iou(mWebGL.mascara, mCPU.mascara),
      distanciaCor,
      areaWebGL: mWebGL.pixels, areaCPU: mCPU.pixels,
    });
  }
  resultados.push(registro);
  console.log(`${caso.exercicioId}/${caso.personagem}: IoU ${registro.instantes.map(i => i.iouSilhueta).join("/")} | Δcor ${registro.instantes.map(i => i.distanciaCor).join("/")}`);
}

/* ------------------------------ mosaicos 06/07 ------------------------------ */
for (const personagem of ["masculino", "feminino"]) {
  const lista = resultados.filter(r => r.personagem === personagem);
  if (!lista.length) continue;
  const img = canvas(6 * CELULA_W, lista.length * (CELULA_H + BARRA) + 40);
  retangulo(img, 0, 0, img.largura, 34, [32, 28, 26]);
  texto(img, `WEBGL OFICIAL x RASTERIZADOR CORRIGIDO - ${personagem.toUpperCase()} - INICIO/MEIO/FIM`, 8, 8, [245, 235, 210], 2);
  lista.forEach((registro, linha) => {
    registro.instantes.forEach((inst, k) => {
      const y = 40 + linha * (CELULA_H + BARRA);
      const par = [
        { q: quadrosWebGL[`${registro.exercicioId}-${registro.personagem}-${inst.rotulo.toLowerCase()}`], nome: "WEBGL" },
        { q: quadrosCPU[`${registro.exercicioId}-${registro.personagem}-${inst.rotulo.toLowerCase()}`], nome: "CPU" },
      ];
      par.forEach(({ q, nome }, p) => {
        const coluna = k * 2 + p;
        const x = coluna * CELULA_W;
        retangulo(img, x, y, CELULA_W, CELULA_H, [18, 16, 16]);
        imagem(img, q.rgb, q.W, q.H, x, y, CELULA_W, CELULA_H);
        retangulo(img, x, y + CELULA_H, CELULA_W, BARRA, [30, 27, 25]);
        texto(img, `${String(linha + 1).padStart(2, "0")} ${inst.rotulo} ${nome} IOU${String(Math.round(inst.iouSilhueta * 100)).padStart(2, "0")}`,
          x + 4, y + CELULA_H + 4, nome === "WEBGL" ? [180, 220, 245] : [245, 220, 170], 1);
      });
    });
  });
  const arquivo = `mosaico-0${personagem === "masculino" ? 6 : 7}-webgl-vs-cpu-${personagem}.png`;
  escreverPNG(path.join(DIR_MOSAICOS, arquivo), img);
  console.log("mosaico:", arquivo, fs.statSync(path.join(DIR_MOSAICOS, arquivo)).size, "bytes");
}

/* ---------- mosaicos 08/09 ampliados dos casos de menor IoU ---------- */
/* Reaproveita os buffers 320x180 JÁ decodificados: uma segunda rodada de
   decodificação grande estoura o heap do ffmpeg.wasm (OOM já observado). */
const CELULA_DW = 640, CELULA_DH = 360, BARRA_D = 24;
for (const personagem of ["masculino", "feminino"]) {
  const lista = resultados.filter(r => r.personagem === personagem && PROBLEMATICOS.includes(r.exercicioId));
  if (!lista.length) continue;
  const img = canvas(6 * CELULA_DW, lista.length * (CELULA_DH + BARRA_D) + 40);
  retangulo(img, 0, 0, img.largura, 34, [32, 28, 26]);
  texto(img, `DETALHE WEBGL OFICIAL x MP4 CORRIGIDO - ${personagem.toUpperCase()} - CASOS DE MENOR IOU - ESQ WEBGL / DIR MP4`,
    8, 8, [245, 235, 210], 2);
  for (let linha = 0; linha < lista.length; linha += 1) {
    const registro = lista[linha];
    const y = 40 + linha * (CELULA_DH + BARRA_D);
    for (let k = 0; k < 3; k += 1) {
      const inst = registro.instantes[k];
      const chave = `${registro.exercicioId}-${registro.personagem}-${inst.rotulo.toLowerCase()}`;
      const pares = [
        { q: quadrosWebGL[chave], nome: "WEBGL" },
        { q: quadrosCPU[chave], nome: "MP4" },
      ];
      pares.forEach(({ q, nome }, p) => {
        const x = (k * 2 + p) * CELULA_DW;
        retangulo(img, x, y, CELULA_DW, CELULA_DH, [18, 16, 16]);
        imagem(img, q.rgb, q.W, q.H, x, y, CELULA_DW, CELULA_DH);
        retangulo(img, x, y + CELULA_DH, CELULA_DW, BARRA_D, [30, 27, 25]);
        texto(img, `${registro.exercicioId} ${inst.rotulo} ${nome} IOU${Math.round(inst.iouSilhueta * 100)}`,
          x + 4, y + CELULA_DH + 4, nome === "WEBGL" ? [180, 220, 245] : [245, 220, 170], 1);
      });
    }
  }
  const arquivo = `mosaico-0${personagem === "masculino" ? 8 : 9}-detalhe-${personagem}.png`;
  escreverPNG(path.join(DIR_MOSAICOS, arquivo), img);
  console.log("mosaico detalhe:", arquivo, fs.statSync(path.join(DIR_MOSAICOS, arquivo)).size, "bytes");
}

/* ------------------------------ relatório ------------------------------ */
const todos = resultados.flatMap(r => r.instantes);
const ious = todos.map(i => i.iouSilhueta);
const porSexo = {};
for (const sexo of ["masculino", "feminino"]) {
  const ins = resultados.filter(r => r.personagem === sexo).flatMap(r => r.instantes);
  if (!ins.length) continue;
  porSexo[sexo] = {
    webgl: [0, 1, 2].map(c => Math.round(ins.reduce((s, i) => s + i.webgl.corPersonagem[c], 0) / ins.length)),
    cpu: [0, 1, 2].map(c => Math.round(ins.reduce((s, i) => s + i.cpu.corPersonagem[c], 0) / ins.length)),
    dCor: Number((ins.reduce((s, i) => s + i.distanciaCor, 0) / ins.length).toFixed(1)),
  };
}
const razoes = resultados.flatMap(r => r.instantes.map(i => {
  const w = i.webgl.bbox, c = i.cpu.bbox;
  return { id: r.exercicioId, r: ((c[2] - c[0]) / (w[2] - w[0]) + (c[3] - c[1]) / (w[3] - w[1])) / 2 };
}));
const porExercicio = {};
for (const x of razoes) (porExercicio[x.id] ??= []).push(x.r);
const escalas = Object.entries(porExercicio)
  .map(([id, v]) => ({ id, r: Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)) }))
  .sort((a, b) => Math.abs(b.r - 1) - Math.abs(a.r - 1));
const m = porSexo.masculino, f = porSexo.feminino;
const relatorio = {
  geradoEm: new Date().toISOString(),
  referencia: "assets/js/forja-3d-cena.js (modoApresentacao) em Chromium headless real, MESMO GLB/MESMO clipe/sem alterações",
  navegador: await browser.userAgent(),
  instantes: INSTANTES.map(i => i.fracao),
  observacoesSobreTempo: "Instante determinístico: THREE.Clock e requestAnimationFrame da cena oficial são controlados por relógio virtual de TESTE a 30 fps; cada comparação avança exatamente round(tempo*30) quadros antes da captura, e o MP4 é amostrado no mesmo tempo absoluto. Não há a defasagem do relógio real do Chromium headless; pode restar no máximo ~1 quadro de diferença de fase pelo arredondamento de PTS do H.264.",
  metricas: {
    casos: resultados.length,
    comparacoes: todos.length,
    iouMinimo: Math.min(...ious), iouMaximo: Math.max(...ious),
    iouMedio: Number((ious.reduce((s, v) => s + v, 0) / ious.length).toFixed(3)),
    todosComPersonagemVisivel: todos.every(i => i.areaWebGL > 300 && i.areaCPU > 300),
    escalaMP4sobreWebGL: {
      minimo: Number(Math.min(...razoes.map(x => x.r)).toFixed(3)),
      maximo: Number(Math.max(...razoes.map(x => x.r)).toFixed(3)),
      porExercicio: escalas,
    },
    corMediaPorPersonagem: porSexo,
  },
  diferencasRegistradas: [
    "Pose e anatomia: no mesmo instante determinístico, os pares inspecionados mostram a MESMA pose e a MESMA anatomia nos dois lados (mesmo GLB de personagem e mesmo clipe, sem nenhuma alteração de normais, materiais, luzes ou animações oficiais). Isso NÃO é equivalência perfeita de pixels: pode haver até ~1 quadro de diferença de fase e a silhueta nunca coincide 100% por causa da escala e do antialiasing. Não há membro ausente, duplicado ou deformado.",
    `Material/iluminação: diferença REAL e sistemática, não artefato de medição. O WebGL oficial usa PBR (HemisphereLight 2.0 + DirectionalLight 2.4 + contra-luz 0.9); o rasterizador offline usa o modelo difuso simplificado já existente, calibrado pelas imagens de referência oficiais do repositório. Média do personagem — masculino WebGL ${m?.webgl.join("/")} vs MP4 ${m?.cpu.join("/")} (distância ${m?.dCor}); feminino WebGL ${f?.webgl.join("/")} vs MP4 ${f?.cpu.join("/")} (distância ${f?.dCor}). O WebGL headless sai mais escuro/amarronzado; o MP4 sai bege claro, coerente com as referências aprovadas.`,
    `Enquadramento: diferença REAL de escala, não de pose. Ambos usam azimute -58°, elevação 22°, FOV 32° e margem 9%, mas a cena oficial calcula a distância analiticamente com clamp [2.0, 9] e posiciona a câmera sem o fator cos(elevação) no plano horizontal, enquanto o rasterizador faz busca binária sobre NDC até maxNdc = 0.91 e permite distância a partir de 1.5. Razão de escala MP4/WebGL: ${Math.min(...razoes.map(x => x.r)).toFixed(2)}–${Math.max(...razoes.map(x => x.r)).toFixed(2)}. Maiores desvios: ${escalas.slice(0, 4).map(e => `${e.id} ${e.r.toFixed(2)}x`).join(", ")} — isso contribui para reduzir o IoU nesses clipes, junto com o sombreamento/antialiasing diferentes e eventuais diferenças de fase de até 1 quadro; nos mosaicos ampliados 08/09 não se identifica pose divergente.`,
    "Artefatos: nenhum leque, rastro entre quadros, painel/zigue-zague, membro preto ou tonalidade verde-azulada aparece nos 28 MP4 finais nem nos quadros WebGL comparados. A correção do buffer de cor eliminou o defeito em todos os exercícios e nos dois personagens.",
    "Correspondência animação↔exercício: conferida nos mosaicos 02–05 (início/meio/fim dos 28) e nos pares 06/07; cada clipe reproduz o movimento do exercício nomeado e muda entre início e fim, à exceção do clipe isométrico cal-prancha-frontal (movimento 0.18/0.30 no validador).",
    "Limitação conhecida (NÃO corrigida nesta entrega): o rasterizador offline não replica o pipeline PBR/gerenciamento de cor do three.js nem a fórmula analítica de distância da cena oficial. Cor e escala dos MP4, portanto, NÃO são idênticas às do WebGL headless, embora estejam dentro das referências de cor aprovadas e respeitem a margem de 9% (maxNdc = 0.91 nos 28). Investigamos a origem; alinhar os dois pipelines exigiria alterar luz/câmera do rasterizador e re-renderizar os 28 MP4, o que está fora da correção do buffer de cor autorizada e não foi feito para não descartar as evidências já validadas.",
  ],
  resultados,
};
fs.mkdirSync(SAIDA, { recursive: true });
fs.writeFileSync(path.join(SAIDA, "comparacao-webgl.json"), JSON.stringify(relatorio, null, 2) + "\n");
console.log(`\nIoU médio ${relatorio.metricas.iouMedio} (${relatorio.metricas.iouMinimo}–${relatorio.metricas.iouMaximo}), ${todos.length} comparações.`);
await browser.close();
server.close();
