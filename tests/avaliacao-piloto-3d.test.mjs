/*
  Testes automatizados em Chromium real (simulando viewport e toque Android)
  para a tela temporária isolada AVALIAÇÃO DO PILOTO 3D.

  Cobre os 7 itens obrigatórios:
    1. Confirmação de que os dois vídeos e os dois posters são encontrados.
    2. Reprodução, pausa, reinício e exclusividade (sem carga simultânea).
    3. Velocidades reduzidas (0,25×, 0,5× e 1×).
    4. Tela cheia (entrada, controles e saída).
    5. Orientações vertical (retrato Android 412×915) e horizontal (paisagem 915×412).
    6. Ausência de tela preta/erro de carregamento + tratamento de arquivo ausente + liberação ao sair.
    7. Integridade da navegação e não-interferência no restante do FORJA.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { brotliDecompressSync } from "node:zlib";
import puppeteer from "puppeteer-core";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirCapturas =
  process.env.ATUALIZAR_CAPTURAS === "1"
    ? path.join(repoRoot, "docs", "validacao-3d", "piloto-abdominal-masculino", "capturas-app")
    : fs.mkdtempSync(path.join(os.tmpdir(), "forja-piloto-capturas-"));
fs.mkdirSync(dirCapturas, { recursive: true });

let chromium = null;
try {
  chromium = (await import("@sparticuz/chromium")).default;
} catch (_) {}

const candidatos = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);

let executablePath = candidatos.find(c => fs.existsSync(c));
let launchArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];

if (!executablePath && chromium) {
  executablePath = await chromium.executablePath();
  launchArgs = [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"];
}

if (process.platform === "linux" && chromium && !process.env.LD_LIBRARY_PATH && executablePath.includes("/tmp/")) {
  const modulePath = fileURLToPath(import.meta.resolve("@sparticuz/chromium"));
  const packageRoot = path.resolve(path.dirname(modulePath), "../..");
  const archive = path.join(packageRoot, "bin", "al2023.tar.br");
  const libRoot = path.join(os.tmpdir(), "forja-e2e-al2023");
  if (!fs.existsSync(path.join(libRoot, "lib", "libnspr4.so"))) {
    fs.mkdirSync(libRoot, { recursive: true });
    const unpacked = path.join(os.tmpdir(), "forja-e2e-al2023.tar");
    fs.writeFileSync(unpacked, brotliDecompressSync(fs.readFileSync(archive)));
    execFileSync("tar", ["-xf", unpacked, "-C", libRoot]);
    fs.unlinkSync(unpacked);
  }
  process.env.LD_LIBRARY_PATH = path.join(libRoot, "lib");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

function iniciarServidorLocal() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname.includes("/arquivo-inexistente-teste.mp4")) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      let rel = decodeURIComponent(u.pathname);
      if (rel.startsWith("/forja/")) rel = rel.slice("/forja".length);
      else if (rel === "/forja") rel = "/";
      if (rel === "" || rel.endsWith("/")) rel += "index.html";

      const full = path.resolve(repoRoot, "." + rel);
      if (!full.startsWith(repoRoot + path.sep) && full !== path.join(repoRoot, "index.html")) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }

      const stat = fs.statSync(full);
      const ext = path.extname(full).toLowerCase();
      const headers = {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache"
      };

      const range = req.headers.range;
      if (range && /^bytes=\d*-\d*$/.test(range)) {
        const [sStr, eStr] = range.replace("bytes=", "").split("-");
        const start = sStr ? parseInt(sStr, 10) : 0;
        const end = eStr ? Math.min(stat.size - 1, parseInt(eStr, 10)) : stat.size - 1;
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
        headers["Content-Length"] = String(end - start + 1);
        res.writeHead(206, headers);
        if (req.method === "HEAD") { res.end(); return; }
        fs.createReadStream(full, { start, end }).pipe(res);
        return;
      }

      headers["Content-Length"] = String(stat.size);
      res.writeHead(200, headers);
      if (req.method === "HEAD") { res.end(); return; }
      fs.createReadStream(full).pipe(res);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}/forja/` });
    });
  });
}

const { server, baseUrl } = await iniciarServidorLocal();
const browser = await puppeteer.launch({ executablePath, args: launchArgs });

const ANDROID_PORTRAIT = { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const ANDROID_LANDSCAPE = { width: 915, height: 412, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true };

try {
  const page = await browser.newPage();
  const errosPagina = [];
  page.on("pageerror", err => errosPagina.push(String(err)));

  await page.setUserAgent(
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36"
  );
  await page.setViewport(ANDROID_PORTRAIT);

  // Semeia perfil válido para testar acesso a partir da aba Perfil do FORJA
  await page.evaluateOnNewDocument(() => {
    if (!localStorage.getItem("forja-perfil-v1")) {
      localStorage.setItem(
        "forja-perfil-v1",
        JSON.stringify({
          version: 3,
          updatedAt: "2026-11-01T00:00:00.000Z",
          objetivo: "hipertrofia",
          nivel: "intermediario",
          equipamento: "casa",
          sexo: "masculino",
          modalidade: "calisthenics",
          diasPorSemana: 4,
          duracaoMinutos: 45
        })
      );
    }
  });

  // 1. Navegar pela aba Perfil do FORJA até AVALIAÇÃO DO PILOTO 3D
  await page.goto(new URL("perfil/index.html", baseUrl).href, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(dirCapturas, "captura-01-acesso-perfil-android.png") });

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click("#open-avaliacao-piloto-3d-top")
  ]);

  assert.match(page.url(), /\/forja\/avaliacao-piloto-3d\/index\.html$/);

  // Aguarda verificação sequencial HEAD dos dois vídeos
  await page.waitForFunction(() => {
    const st = window.__forjaPiloto3d && window.__forjaPiloto3d.estado;
    return st && st.cartoes.horizontal.arquivoVerificado && st.cartoes.vertical.arquivoVerificado;
  }, { timeout: 6000 });

  const estadoInicial = await page.evaluate(() => {
    const vH = document.getElementById("piloto-video-horizontal");
    const vV = document.getElementById("piloto-video-vertical");
    const pH = document.querySelector('#card-horizontal [data-piloto-poster-img]');
    const pV = document.querySelector('#card-vertical [data-piloto-poster-img]');
    return {
      tituloTela: document.getElementById("piloto-screen-title").textContent.trim(),
      tituloExercicio: document.getElementById("piloto-exercise-title").textContent.trim(),
      videosComSrcNoBoot: document.querySelectorAll("video[src]").length,
      posterHorizontalOk: pH.complete && pH.naturalWidth === 1280 && pH.naturalHeight === 720,
      posterVerticalOk: pV.complete && pV.naturalWidth === 720 && pV.naturalHeight === 1280,
      statusH: document.querySelector('#card-horizontal [data-piloto-status]').textContent.trim(),
      statusV: document.querySelector('#card-vertical [data-piloto-status]').textContent.trim(),
      semOverflowRetrato: document.documentElement.scrollWidth <= window.innerWidth,
      srcConfigH: vH.getAttribute("data-video-src"),
      srcConfigV: vV.getAttribute("data-video-src")
    };
  });

  assert.equal(estadoInicial.tituloTela, "AVALIAÇÃO DO PILOTO 3D");
  assert.equal(estadoInicial.tituloExercicio, "Abdominal tradicional — Modelo masculino");
  assert.equal(estadoInicial.videosComSrcNoBoot, 0, "Nenhum vídeo deve carregar automaticamente no boot");
  assert.equal(estadoInicial.posterHorizontalOk, true, "Poster horizontal 1280×720 deve estar visível antes da reprodução");
  assert.equal(estadoInicial.posterVerticalOk, true, "Poster vertical 720×1280 deve estar visível antes da reprodução");
  assert.match(estadoInicial.statusH, /Pronto · 3,37 MiB/);
  assert.match(estadoInicial.statusV, /Pronto · 3,37 MiB/);
  assert.equal(estadoInicial.semOverflowRetrato, true, "Sem rolagem horizontal indevida em retrato Android");
  console.log("✅ Teste 1: Dois vídeos e dois posters encontrados; zero carregamento simultâneo no boot.");

  await page.screenshot({ path: path.join(dirCapturas, "captura-02-tela-avaliacao-posters-retrato.png"), fullPage: true });

  // 2. Testar Reprodução, Pausa, Reinício e ausência de tela preta no vídeo Horizontal (16:9)
  await page.click("#btn-play-horizontal");
  await page.waitForFunction(() => {
    const v = document.getElementById("piloto-video-horizontal");
    return v && v.readyState >= 2 && !v.paused && v.currentTime > 0.25;
  }, { timeout: 8000 });

  const metricasHorizontal = await page.evaluate(() => {
    const v = document.getElementById("piloto-video-horizontal");
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let somaLuma = 0;
    let pixelsNaoPretos = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      somaLuma += luma;
      if (luma > 8) pixelsNaoPretos += 1;
    }
    return {
      largura: v.videoWidth,
      altura: v.videoHeight,
      duracao: v.duration,
      tempoAtual: v.currentTime,
      videosComSrc: document.querySelectorAll("video[src]").length,
      lumaMedia: somaLuma / (c.width * c.height),
      pixelsNaoPretos,
      textoTempo: document.querySelector('#card-horizontal [data-piloto-time]').textContent.trim()
    };
  });

  assert.equal(metricasHorizontal.largura, 1280);
  assert.equal(metricasHorizontal.altura, 720);
  assert.ok(Math.abs(metricasHorizontal.duracao - 6.0) < 0.15, "Duração esperada de ~6,00 s");
  assert.equal(metricasHorizontal.videosComSrc, 1, "Apenas o vídeo horizontal deve estar carregado");
  assert.ok(metricasHorizontal.pixelsNaoPretos > 2000 && metricasHorizontal.lumaMedia > 15, "Quadro decodificado real (sem tela preta)");

  await page.screenshot({ path: path.join(dirCapturas, "captura-03-reproducao-horizontal-android.png") });

  // Pausar e Reiniciar
  await page.click("#btn-pause-horizontal");
  const pausadoH = await page.evaluate(() => document.getElementById("piloto-video-horizontal").paused);
  assert.equal(pausadoH, true, "Vídeo horizontal deve pausar");

  await page.click("#btn-restart-horizontal");
  const reiniciadoH = await page.evaluate(() => ({
    t: document.getElementById("piloto-video-horizontal").currentTime,
    txt: document.querySelector('#card-horizontal [data-piloto-time]').textContent.trim()
  }));
  assert.equal(reiniciadoH.t, 0, "Reiniciar deve voltar para 0,00 s");
  assert.match(reiniciadoH.txt, /^0,00 s \/ 6,00 s$/);
  console.log("✅ Teste 2: Reprodução, pausa, reinício e renderização real sem tela preta no Horizontal (16:9).");

  // 3. Testar velocidades reduzidas (0,25×, 0,5× e 1×)
  await page.click("#btn-play-horizontal");
  await sleep(120);

  for (const [idBtn, velEsperada] of [["#speed-h-025", 0.25], ["#speed-h-050", 0.5], ["#speed-h-100", 1]]) {
    await page.click(idBtn);
    const t0 = await page.evaluate(() => document.getElementById("piloto-video-horizontal").currentTime);
    await sleep(360);
    const infoVel = await page.evaluate((sel) => {
      const v = document.getElementById("piloto-video-horizontal");
      return {
        rate: v.playbackRate,
        pressed: document.querySelector(sel).getAttribute("aria-pressed"),
        t1: v.currentTime
      };
    }, idBtn);
    assert.equal(infoVel.rate, velEsperada, `playbackRate deve ser ${velEsperada}`);
    assert.equal(infoVel.pressed, "true", `Botão ${idBtn} deve indicar aria-pressed=true`);
    assert.ok(infoVel.t1 > t0, `Vídeo deve avançar na velocidade ${velEsperada}x`);
  }
  console.log("✅ Teste 3: Controle de velocidades 0,25×, 0,5× e 1× verificado.");

  // Testar troca exclusiva para o vídeo Vertical (9:16)
  await page.evaluate(() => document.getElementById("btn-play-vertical").scrollIntoView({ behavior: "instant", block: "center" }));
  await sleep(80);
  await page.click("#btn-play-vertical");
  await page.waitForFunction(() => {
    const v = document.getElementById("piloto-video-vertical");
    return v && v.readyState >= 2 && !v.paused && v.currentTime > 0.25;
  }, { timeout: 8000 });

  const metricasVertical = await page.evaluate(() => {
    const vH = document.getElementById("piloto-video-horizontal");
    const vV = document.getElementById("piloto-video-vertical");
    const c = document.createElement("canvas");
    c.width = 90;
    c.height = 160;
    const ctx = c.getContext("2d");
    ctx.drawImage(vV, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let pixelsNaoPretos = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 24) pixelsNaoPretos += 1;
    }
    return {
      horizontalLiberado: !vH.hasAttribute("src") && vH.paused,
      videosComSrc: document.querySelectorAll("video[src]").length,
      largura: vV.videoWidth,
      altura: vV.videoHeight,
      pixelsNaoPretos
    };
  });

  assert.equal(metricasVertical.horizontalLiberado, true, "Ao ativar o Vertical, o Horizontal deve ser liberado para evitar simultaneidade");
  assert.equal(metricasVertical.videosComSrc, 1, "Exatamente 1 vídeo carregado por vez");
  assert.equal(metricasVertical.largura, 720);
  assert.equal(metricasVertical.altura, 1280);
  assert.ok(metricasVertical.pixelsNaoPretos > 2000, "Vídeo vertical renderizado sem tela preta");

  await page.evaluate(() => {
    const headerH = document.querySelector(".site-header")?.offsetHeight || 70;
    const rect = document.getElementById("card-vertical").getBoundingClientRect();
    window.scrollBy({ top: rect.top - headerH - 8, behavior: "instant" });
  });
  await sleep(60);
  await page.screenshot({ path: path.join(dirCapturas, "captura-04-reproducao-vertical-android.png") });
  console.log("✅ Exclusividade confirmada: Vertical (9:16, 720×1280) decodificado sem carga simultânea.");

  // 4. Testar Tela Cheia (entrada, controles em tela cheia e saída)
  await page.evaluate(() => document.getElementById("btn-fs-vertical").scrollIntoView({ behavior: "instant", block: "center" }));
  await sleep(60);
  await page.click("#btn-fs-vertical");
  await sleep(150);
  const estadoTelaCheia = await page.evaluate(() => {
    const stage = document.querySelector('#card-vertical [data-piloto-stage]');
    const rect = stage.getBoundingClientRect();
    const fsAtivo = document.fullscreenElement === stage || stage.classList.contains("is-pseudo-fullscreen");
    const barraVisivel = getComputedStyle(stage.querySelector(".piloto-fs-toolbar")).display !== "none";
    return { fsAtivo, barraVisivel, w: Math.round(rect.width), h: Math.round(rect.height) };
  });
  assert.equal(estadoTelaCheia.fsAtivo, true, "Modo tela cheia deve ativar");
  assert.equal(estadoTelaCheia.barraVisivel, true, "Controles de tela cheia devem ficar visíveis");
  assert.equal(estadoTelaCheia.w, ANDROID_PORTRAIT.width);
  assert.equal(estadoTelaCheia.h, ANDROID_PORTRAIT.height);

  await page.screenshot({ path: path.join(dirCapturas, "captura-05-tela-cheia-vertical-android.png") });

  await page.click('#card-vertical [data-action="exit-fullscreen"]');
  await sleep(120);
  const saiuFs = await page.evaluate(() => {
    const stage = document.querySelector('#card-vertical [data-piloto-stage]');
    return document.fullscreenElement === null && !stage.classList.contains("is-pseudo-fullscreen");
  });
  assert.equal(saiuFs, true, "Deve sair da tela cheia limpamente");
  console.log("✅ Teste 4: Controle de tela cheia (entrada, barra de controles e saída) verificado.");

  // 5. Testar orientação Horizontal (Paisagem Android 915×412)
  await page.setViewport(ANDROID_LANDSCAPE);
  await page.evaluate(() => {
    const headerH = document.querySelector(".site-header")?.offsetHeight || 70;
    const rect = document.getElementById("piloto-cards-grid").getBoundingClientRect();
    window.scrollBy({ top: rect.top - headerH - 6, behavior: "instant" });
  });
  await sleep(150);
  const layoutPaisagem = await page.evaluate(() => {
    const grid = document.getElementById("piloto-cards-grid");
    const cols = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
    return {
      colunas: cols,
      semOverflowPaisagem: document.documentElement.scrollWidth <= window.innerWidth
    };
  });
  assert.equal(layoutPaisagem.colunas, 2, "Em paisagem Android (915×412) os dois cartões devem ficar lado a lado");
  assert.equal(layoutPaisagem.semOverflowPaisagem, true, "Sem overflow horizontal em paisagem");

  await page.screenshot({ path: path.join(dirCapturas, "captura-06-orientacao-paisagem-android.png") });
  console.log("✅ Teste 5: Orientações retrato (412×915) e paisagem (915×412) verificadas.");

  // 6a. Testar liberação de recursos ao sair da tela e retorno ao FORJA sem gravar em localStorage
  await page.setViewport(ANDROID_PORTRAIT);
  const chavesAntes = await page.evaluate(() => Object.keys(localStorage).sort());
  const liberacaoAntesNav = await page.evaluate(() => {
    window.__forjaPiloto3d.liberarTodosOsRecursos();
    return {
      liberados: window.__forjaPiloto3d.estado.recursosLiberados,
      videosComSrc: document.querySelectorAll("video[src]").length
    };
  });
  assert.equal(liberacaoAntesNav.liberados, true);
  assert.equal(liberacaoAntesNav.videosComSrc, 0, "Todos os recursos <video> liberados");

  await page.evaluate(() => document.getElementById("piloto-voltar-perfil").scrollIntoView({ behavior: "instant", block: "center" }));
  await sleep(60);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click("#piloto-voltar-perfil")
  ]);
  assert.match(page.url(), /\/forja\/perfil\/index\.html$/);
  const chavesDepois = await page.evaluate(() => Object.keys(localStorage).sort());
  assert.deepEqual(chavesDepois, chavesAntes, "A tela temporária não deve criar chaves no localStorage do FORJA");

  // 6b. Testar tratamento explícito de ausência/erro de arquivo (sem tela preta e sem exceções)
  const pageErro = await browser.newPage();
  await pageErro.setViewport(ANDROID_PORTRAIT);
  await pageErro.goto(new URL("avaliacao-piloto-3d/index.html", baseUrl).href, { waitUntil: "networkidle0" });
  const resultadoAusente = await pageErro.evaluate(async () => {
    const cs = window.__forjaPiloto3d.estado.cartoes.horizontal;
    cs.src = "./arquivo-inexistente-teste.mp4";
    cs.video.setAttribute("data-video-src", cs.src);
    document.getElementById("btn-play-horizontal").click();
    await new Promise(r => setTimeout(r, 400));
    const errBox = document.querySelector('#card-horizontal [data-piloto-error]');
    return {
      erroVisivel: errBox && !errBox.hidden,
      mensagem: document.querySelector('#card-horizontal [data-piloto-error-title]').textContent.trim(),
      status: document.querySelector('#card-horizontal [data-piloto-status]').textContent.trim()
    };
  });
  assert.equal(resultadoAusente.erroVisivel, true, "Deve exibir painel claro de erro quando o arquivo falha/ausenta");
  assert.match(resultadoAusente.mensagem, /Não foi possível carregar/i);
  assert.equal(resultadoAusente.status, "Falha no vídeo");
  await pageErro.close();

  assert.deepEqual(errosPagina, [], "Nenhum erro de JS na página: " + errosPagina.join("; "));
  console.log("✅ Teste 6: Sem tela preta, erro de arquivo tratado graciosamente e recursos liberados ao sair.");
} finally {
  await browser.close();
  server.close();
}
