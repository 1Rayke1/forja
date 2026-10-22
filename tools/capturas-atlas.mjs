/*
  Capturas reais do Atlas anatômico (FORJA 3.1), geradas por navegador.

  Sobe o repositório num servidor local sob /forja/ (igual ao GitHub Pages),
  abre o Chromium disponível e percorre os estados do atlas de verdade:
  inicial, região selecionada com resultados, vista posterior, região sem
  exercícios, filtro de modalidade sem resultados e estado de erro.

  Para cada estado mede a rolagem horizontal e a largura do mapa/legenda em
  320, 360, 390, 430, 768 e 1280 px. Grava as imagens em
  artifacts/forja-visual (ou no diretório indicado em --out).

  Nada toca em dados reais: o perfil do navegador é temporário e o atlas não
  escreve no localStorage.

  Uso:
    npm install
    node tools/capturas-atlas.mjs
    node tools/capturas-atlas.mjs --out /tmp/capturas
    FORJA_URL=http://127.0.0.1:8080/forja/ node tools/capturas-atlas.mjs
    LD_LIBRARY_PATH=/caminho/das/libs PUPPETEER_EXECUTABLE_PATH=... node tools/capturas-atlas.mjs
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const WIDTHS = [320, 360, 390, 430, 768, 1280];

const outArg = process.argv.indexOf("--out");
const outDir = outArg >= 0 && process.argv[outArg + 1]
  ? path.resolve(process.argv[outArg + 1])
  : path.join(repoRoot, "artifacts", "forja-visual");
fs.mkdirSync(outDir, { recursive: true });

let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch (error) {
  console.error('puppeteer-core não está instalado. Rode "npm install" na raiz do projeto.');
  process.exit(1);
}

let chromium = null;
try {
  chromium = (await import("@sparticuz/chromium")).default;
} catch (error) {
  // Sem o binário empacotado; usa o navegador do sistema informado pela variável.
}

const systemCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);

let executablePath = systemCandidates.find(candidate => fs.existsSync(candidate));
let launchArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];

if (!executablePath && chromium) {
  executablePath = await chromium.executablePath();
  launchArgs = [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"];
}

if (!executablePath) {
  console.error("Nenhum navegador encontrado. Defina PUPPETEER_EXECUTABLE_PATH.");
  process.exit(1);
}

/* Servidor estático local, mesmo caminho do GitHub Pages. */
function startStaticServer(rootDir) {
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json"
  };
  const blocked = new Set(["node_modules", ".git", "artifacts", "tests", "docs", ".github"]);

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      if (!requestUrl.pathname.startsWith("/forja/")) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }
      let relative = decodeURIComponent(requestUrl.pathname.slice("/forja/".length));
      if (relative === "" || relative.endsWith("/")) relative += "index.html";
      const filePath = path.resolve(rootDir, relative);
      const first = path.relative(rootDir, filePath).split(path.sep)[0];

      if (!filePath.startsWith(rootDir + path.sep) || blocked.has(first) || first.startsWith(".")) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }

      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.statusCode = 404;
          response.end("not found");
          return;
        }
        response.setHeader("Content-Type", mime[path.extname(filePath)] || "application/octet-stream");
        response.end(data);
      });
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: "http://127.0.0.1:" + server.address().port + "/forja/" });
    });
  });
}

const localServer = process.env.FORJA_URL ? null : await startStaticServer(repoRoot);
const BASE = (process.env.FORJA_URL || localServer.url).replace(/\/?$/, "/");
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-atlas-capturas-"));

const browser = await puppeteer.launch({
  executablePath,
  args: launchArgs,
  headless: true,
  userDataDir: profileDir,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 }
});

const page = await browser.newPage();
const problems = [];
const measurements = [];

page.on("pageerror", error => problems.push("pageerror: " + error.message));
page.on("console", message => {
  if (message.type() === "error") problems.push("console: " + message.text());
});

const shot = name => page.screenshot({ path: path.join(outDir, name) });

async function setViewport(width, scale = 1) {
  await page.setViewport({ width, height: 844, deviceScaleFactor: scale });
  await sleep(220);
}

/* Rola até o centro antes de clicar: a barra inferior fixa pode cobrir o alvo. */
async function clickCentered(selector) {
  await page.$eval(selector, node => node.scrollIntoView({ block: "center" }));
  await sleep(120);
  await page.click(selector);
  await sleep(220);
}

async function measure(state) {
  for (const width of WIDTHS) {
    await setViewport(width);
    const result = await page.evaluate(() => {
      const doc = document.documentElement;
      const extra = doc.scrollWidth - doc.clientWidth;
      const wide = [];
      if (extra > 0) {
        document.querySelectorAll("body *").forEach(node => {
          const box = node.getBoundingClientRect();
          if (box.right > doc.clientWidth + 1 && box.width > 0) {
            wide.push(node.tagName.toLowerCase() + (node.id ? "#" + node.id : "." + String(node.className).split(" ")[0]));
          }
        });
      }
      const map = document.querySelector(".atlas-map-svg");
      const legend = document.querySelector(".atlas-legend");
      return {
        extra,
        wide: wide.slice(0, 4),
        mapWidth: map ? Math.round(map.getBoundingClientRect().width) : 0,
        legendWidth: legend ? Math.round(legend.getBoundingClientRect().width) : 0,
        regions: document.querySelectorAll(".atlas-region").length,
        rows: document.querySelectorAll(".atlas-exercise-row").length,
        empty: Boolean(document.querySelector(".atlas-exercises .ui-empty-title"))
      };
    });
    measurements.push({ state, width, ...result });
    if (result.extra > 0) {
      problems.push("overflow " + state + " @ " + width + "px: +" + result.extra + "px " + JSON.stringify(result.wide));
    }
  }
}

try {
  await page.goto(BASE + "explorar/atlas.html", { waitUntil: "networkidle0" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);

  /* 1. Estado inicial: mapa sem seleção. */
  await measure("inicial");
  await setViewport(390, 2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("atlas-inicial-390.png");

  /* 2. Região selecionada com resultados — captura em todas as larguras. */
  await clickCentered('.atlas-region[data-group="peito"]');
  await measure("selecionado-peitoral");

  for (const width of WIDTHS) {
    await setViewport(width);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(outDir, "atlas-" + width + ".png"), fullPage: true });
  }

  /* 3. Vista posterior com região selecionada. */
  await setViewport(390, 2);
  await clickCentered('#atlas-view [data-value="back"]');
  await clickCentered('.atlas-region[data-group="dorsais"]');
  await measure("posterior-dorsais");
  await setViewport(390, 2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("atlas-posterior-390.png");

  /* 4. Região sem exercícios no catálogo. */
  await clickCentered('.atlas-region[data-group="panturrilha"]');
  await measure("vazio-regiao");
  await setViewport(390, 2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("atlas-vazio-390.png");

  /* 5. Filtro por modalidade sem resultados. */
  await clickCentered('#atlas-view [data-value="front"]');
  await clickCentered('.atlas-region[data-group="antebracos"]');
  await clickCentered('#atlas-modes [data-value="calisthenics"]');
  await measure("vazio-filtro");
  await setViewport(390, 2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("atlas-filtro-vazio-390.png");

  /* 6. Estado de erro com retentativa. */
  await page.evaluate(() => {
    window.__forjaAtlasItems = window.Forja.catalog.items;
    window.Forja.catalog.items = () => { throw new Error("falha simulada para captura"); };
    window.Forja.pages.atlas.refresh();
  });
  await sleep(300);
  await measure("erro");
  await setViewport(390, 2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("atlas-erro-390.png");
  await page.evaluate(() => {
    window.Forja.catalog.items = window.__forjaAtlasItems;
    document.querySelector('[data-atlas-focus="retry"]').click();
  });
  await sleep(300);

  /* 7. Desktop com seleção e resultados. */
  await setViewport(1280);
  await clickCentered('.atlas-region[data-group="peito"]');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("atlas-selecionado-1280.png");

  console.log("atlas — medições por largura:");
  measurements.forEach(line => {
    console.log(
      "  " + line.state.padEnd(22) + String(line.width).padStart(4) + "px  mapa " +
      String(line.mapWidth).padStart(3) + "px  legenda " + String(line.legendWidth).padStart(3) +
      "px  regiões " + line.regions + "  linhas " + line.rows +
      (line.empty ? "  vazio" : "") + "  overflow +" + line.extra
    );
  });

  console.log("capturas gravadas em " + outDir);

  if (problems.length > 0) {
    console.log("PROBLEMAS:", problems.join(" | "));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  if (localServer) localServer.server.close();
  fs.rmSync(profileDir, { recursive: true, force: true });
}
