/*
  FORJA — gera os derivados das fotografias dos cartões da tela Explorar.

  Entrada:
    tools/fotografias/fontes.json   procedência, autoria, licença e foco de corte
    tools/fotografias/cartoes.json  ligação cartão → fotografia
    pasta local com os arquivos originais (padrão: --origem <dir> ou FORJA_FOTOS_ORIGEM)

  Saída (versionada no repositório):
    assets/fotografias/<id>-960.webp
    assets/fotografias/<id>-480.webp
    assets/fotografias/manifest.json
    assets/js/forja-fotografias-dados.js

  Uso:
    node tools/gerar-fotografias.mjs --origem ./originais
    node tools/gerar-fotografias.mjs --check        # só valida o que já está no repo

  Requer ImageMagick (`convert`). As imagens originais não são publicadas: só os
  derivados 16:10 em WebP entram no aplicativo.
*/
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONTES_FILES = path.join(ROOT, "tools/fotografias/fontes.json");
const CARTOES_FILE = path.join(ROOT, "tools/fotografias/cartoes.json");
const OUT_DIR = path.join(ROOT, "assets/fotografias");
const DATA_FILE = path.join(ROOT, "assets/js/forja-fotografias-dados.js");
const MANIFEST_FILE = path.join(OUT_DIR, "manifest.json");

const LARGURAS = [960, 480];
const PROPORCAO = 0.625; /* 16:10 */

const check = process.argv.includes("--check");
const origemArg = process.argv.indexOf("--origem");
const origemDir = path.resolve(
  origemArg !== -1 && process.argv[origemArg + 1]
    ? process.argv[origemArg + 1]
    : process.env.FORJA_FOTOS_ORIGEM || path.join(ROOT, "fotografias-originais")
);

const fontes = JSON.parse(fs.readFileSync(FONTES_FILES, "utf8"));
const cartoes = JSON.parse(fs.readFileSync(CARTOES_FILE, "utf8"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function bytes(file) {
  return fs.statSync(file).size;
}

function run(args) {
  execFileSync("convert", args, { stdio: ["ignore", "ignore", "pipe"] });
}

/*
  Recorte 16:10 com gravidade configurável. `-resize ...^` cobre o quadro e o
  `-extent` corta o excedente no centro da gravidade — o mesmo enquadramento em
  todas as fotos, sem deformar.
*/
function gerarDerivados(origem, destinoBase, gravidade) {
  const arquivos = [];
  for (const largura of LARGURAS) {
    const altura = Math.round(largura * PROPORCAO);
    const destino = `${destinoBase}-${largura}.webp`;
    run([
      origem, "-auto-orient", "-strip",
      "-resize", `${largura}x${altura}^`,
      "-gravity", gravidade || "center",
      "-extent", `${largura}x${altura}`,
      "-colorspace", "sRGB",
      "-quality", "80",
      destino
    ]);
    arquivos.push({ largura, altura, arquivo: path.basename(destino), bytes: bytes(destino), sha256: sha256(destino) });
  }
  return arquivos;
}

if (!check && !fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const fotos = [];
for (const fonte of fontes.fotografias) {
  const destinoBase = path.join(OUT_DIR, fonte.id);
  let variantes;

  if (check) {
    variantes = LARGURAS.map(largura => {
      const arquivo = `${fonte.id}-${largura}.webp`;
      const caminho = path.join(OUT_DIR, arquivo);
      if (!fs.existsSync(caminho)) throw new Error(`arquivo ausente: assets/fotografias/${arquivo}`);
      return { largura, altura: Math.round(largura * PROPORCAO), arquivo, bytes: bytes(caminho), sha256: sha256(caminho) };
    });
  } else {
    const origem = path.join(origemDir, fonte.arquivo);
    if (!fs.existsSync(origem)) throw new Error(`original ausente para ${fonte.id}: ${origem} (use --origem <pasta>)`);
    variantes = gerarDerivados(origem, destinoBase, fonte.foco);
  }

  fotos.push({
    /* Campos do contrato de FOTOS em docs/fotografias-exercicios.md. */
    id: fonte.id,
    status: "approved",
    variante: fonte.variante,
    tipo: fonte.tipo,
    alt: fonte.alt,
    titulo: fonte.titulo,
    foco: fonte.foco || "center",
    formato: "webp",
    proporcao: "16:10",
    variantes,
    autor: fonte.autor,
    autorUrl: fonte.autorUrl,
    sourcePage: fonte.sourcePage,
    origemId: fonte.arquivoBase,
    original: fonte.arquivo,
    licenca: fontes.provedor.licenca,
    licencaUrl: fontes.provedor.licencaUrl,
    provedor: fontes.provedor.nome,
    verificadoEm: fontes.provedor.verificadoEm,
    evidencia: fonte.evidencia,
    attribution: `${fonte.autor} / ${fontes.provedor.nome} — ${fontes.provedor.licenca}`,
    modificacoes: "recorte 16:10 com gravidade " + (fonte.foco || "center") +
      ", redimensionamento para " + LARGURAS.join("/") + " px e compressão WebP (qualidade 80)",
    revisao: {
      por: "revisão visual desta entrega",
      em: fontes.provedor.verificadoEm,
      criterio: "correspondência entre a fotografia e o cartão, legibilidade a 300 px e 60 px, nitidez e ausência de distorção"
    },
    modelPermission: "Sem liberação individual de imagem documentada; uso amparado pela " + fontes.provedor.licenca
  });
}

/* Grupos de cartões publicados no manifesto (a nota do JSON não é dado). */
const GRUPOS_CARTOES = ["categorias", "exercicios", "recursos", "direcionado", "seteDias", "porModalidade"];
const cartoesPublicados = {};
for (const grupo of GRUPOS_CARTOES) {
  cartoesPublicados[grupo] = cartoes[grupo] || {};
}

/* Toda referência de cartão precisa existir entre as fotos registradas. */
const idsDeFoto = new Set(fontes.fotografias.map(fonte => fonte.id));
for (const grupo of GRUPOS_CARTOES) {
  for (const [chave, item] of Object.entries(cartoesPublicados[grupo] || {})) {
    if (!item || !idsDeFoto.has(item.foto)) {
      throw new Error(`cartão ${grupo}/${chave} aponta para foto inexistente: ${item && item.foto}`);
    }
    if (item.tipo !== "exato" && item.tipo !== "contexto") {
      throw new Error(`cartão ${grupo}/${chave} tem tipo inválido: ${item.tipo}`);
    }
  }
}

const manifest = {
  version: 1,
  geradoEm: new Date().toISOString().slice(0, 10),
  escopo: "Fotografias dos cartões da tela Explorar. Não substitui o contrato de demonstrações (F.demos) nem a figura anatômica do Atlas.",
  provedor: fontes.provedor,
  diretorio: "assets/fotografias",
  larguras: LARGURAS,
  fotos,
  cartoes: cartoesPublicados
};

fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");

/*
  Módulo de dados: o app é estático e funciona por file:// em testes, então o
  manifesto também é publicado como JavaScript (sem fetch, sem rede).
*/
const dados = `/*
  FORJA — dados das fotografias dos cartões (gerado por tools/gerar-fotografias.mjs).

  NÃO EDITE À MÃO. A fonte é tools/fotografias/fontes.json + cartoes.json; o
  manifesto completo fica em assets/fotografias/manifest.json e a atribuição em
  assets/fotografias/NOTICE.md.
*/
(function (global) {
  "use strict";
  global.FORJA_FOTOS_DATA = ${JSON.stringify({
    version: manifest.version,
    geradoEm: manifest.geradoEm,
    diretorio: manifest.diretorio,
    larguras: manifest.larguras,
    provedor: manifest.provedor,
    fotos: Object.fromEntries(fotos.map(f => [f.id, {
      a: f.alt, t: f.tipo, v: f.variantes.map(x => x.arquivo), l: f.variantes.map(x => x.largura),
      h: f.variantes[0].altura, au: f.autor, ap: f.autorUrl, so: f.sourcePage,
      li: f.licenca, lu: f.licencaUrl, p: f.provedor, fo: f.foco
    }])),
    cartoes: manifest.cartoes
  }, null, 1)};
})(window);
`;
fs.writeFileSync(DATA_FILE, dados);

/*
  NOTICE de procedência: autor, licença e página de cada fotografia. Fica ao
  lado dos derivados para que a atribuição viaje junto com os arquivos.
*/
const notice = [
  "# Fotografias dos cartões da tela Explorar",
  "",
  "Provedor: " + fontes.provedor.nome + " (" + fontes.provedor.site + ")",
  "Licença: " + fontes.provedor.licenca + " — " + fontes.provedor.licencaUrl,
  "",
  fontes.provedor.resumo,
  "Licença verificada em " + fontes.provedor.verificadoEm + ". " + fontes.provedor.evidencia,
  "",
  "Nenhuma imagem da coleção paga (Unsplash+) foi baixada ou usada. Nenhuma",
  "fotografia passou por geração artificial. Os arquivos originais não são",
  "publicados: este diretório contém apenas derivados WebP em " + LARGURAS.join(" e ") + " px",
  "(corte 16:10) gerados por `tools/gerar-fotografias.mjs`.",
  "",
  "| ID | Autor | Título | Licença | Origem |",
  "| --- | --- | --- | --- | --- |",
  ...fotos.map(f => `| \`${f.id}\` | [${f.autor}](${f.autorUrl}) | ${f.titulo} | ${f.licenca} | [página da foto](${f.sourcePage}) |`),
  "",
  "O vínculo entre fotografia e cartão está em `tools/fotografias/cartoes.json`;",
  "a procedência fica em `tools/fotografias/fontes.json`. O manifesto com SHA-256",
  "dos derivados é `assets/fotografias/manifest.json`.",
  ""
].join("\n");
fs.writeFileSync(path.join(OUT_DIR, "NOTICE.md"), notice);

const totalBytes = fotos.reduce((soma, foto) => soma + foto.variantes.reduce((s, v) => s + v.bytes, 0), 0);
console.log(JSON.stringify({
  modo: check ? "check" : "gerado",
  fotos: fotos.length,
  variantes: fotos.length * LARGURAS.length,
  bytes: totalBytes,
  manifesto: path.relative(ROOT, MANIFEST_FILE),
  dados: path.relative(ROOT, DATA_FILE)
}, null, 2));
