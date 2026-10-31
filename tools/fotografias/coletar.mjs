/*
  FORJA — coleta de fotografias originais.

  Este script roda no GitHub Actions (ou em qualquer máquina com acesso ao
  Unsplash). O ambiente onde o repositório é editado não acessa
  images.unsplash.com, então o download dos originais acontece no CI e o
  resultado volta como artefato.

  O que ele faz, por foto:
    1. consulta o endpoint público https://unsplash.com/napi/photos/<id>;
    2. grava id, slug, descrição, dimensões, autor, página e as marcas
       `premium`/`plus` (fotos da coleção paga são rejeitadas);
    3. baixa o original em largura 1600 px (JPEG) para a pasta de saída.

  Também monta uma folha de contato (ImageMagick) para revisão visual rápida.

  Uso: node tools/fotografias/coletar.mjs --saida /tmp/fotos
*/

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const valor = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i !== -1 && args[i + 1] ? args[i + 1] : padrao;
};

const SAIDA = path.resolve(valor("--saida", "/tmp/fotos"));
const CONFIG = path.resolve(valor("--config", path.join("tools/fotografias/coleta.json")));
const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));

fs.mkdirSync(SAIDA, { recursive: true });

const UA = {
  "User-Agent": "Mozilla/5.0 (compatible; FORJA-fotografias/1.0; +https://github.com/1Rayke1/forja)"
};

async function json(url) {
  const resposta = await fetch(url, { headers: UA });
  if (!resposta.ok) throw new Error("HTTP " + resposta.status + " em " + url);
  return resposta.json();
}

async function binario(url) {
  const resposta = await fetch(url, { headers: UA });
  if (!resposta.ok) throw new Error("HTTP " + resposta.status + " em " + url);
  return Buffer.from(await resposta.arrayBuffer());
}

const registros = [];
const rejeitadas = [];

for (const id of config.fotos || []) {
  try {
    const meta = await json("https://unsplash.com/napi/photos/" + encodeURIComponent(id));
    if (meta.premium || meta.plus) {
      rejeitadas.push({ id, motivo: "fotografia da coleção paga (Unsplash+)" });
      continue;
    }
    if (!meta.urls || !meta.urls.raw) {
      rejeitadas.push({ id, motivo: "sem URL de download" });
      continue;
    }
    const url = meta.urls.raw.split("?")[0] + "?fm=jpg&q=85&w=1600&fit=max";
    const arquivo = path.join(SAIDA, id + ".jpg");
    fs.writeFileSync(arquivo, await binario(url));
    registros.push({
      id,
      arquivoOriginal: id + ".jpg",
      slug: meta.slug,
      alt: meta.alt_description || "",
      descricao: meta.description || "",
      largura: meta.width,
      altura: meta.height,
      premium: Boolean(meta.premium),
      plus: Boolean(meta.plus),
      publicDomain: Boolean(meta.public_domain),
      autor: meta.user && meta.user.name,
      usuario: meta.user && meta.user.username,
      autorUrl: meta.user && meta.user.links ? meta.user.links.html : null,
      sourcePage: meta.links ? meta.links.html : null,
      urlOriginal: url,
      licenca: "Unsplash License",
      licencaUrl: "https://unsplash.com/license",
      criadaEm: meta.created_at,
      tags: (meta.tags || []).map(t => t.title).slice(0, 12)
    });
    console.log("ok " + id + " — " + (meta.user && meta.user.name) + " — " + (meta.alt_description || ""));
  } catch (erro) {
    rejeitadas.push({ id, motivo: erro.message });
    console.log("falha " + id + " — " + erro.message);
  }
}

fs.writeFileSync(path.join(SAIDA, "metadados.json"), JSON.stringify({ provedor: "Unsplash", coletadoEm: new Date().toISOString(), registros, rejeitadas }, null, 2) + "\n");

/* Folha de contato para revisão visual (não é publicada no app). */
const comImagem = registros.filter(r => fs.existsSync(path.join(SAIDA, r.arquivoOriginal)));
if (comImagem.length) {
  try {
    execFileSync("montage", [
      ...comImagem.map(r => path.join(SAIDA, r.arquivoOriginal)),
      "-thumbnail", "420x420",
      "-tile", "4x",
      "-geometry", "+8+8",
      "-background", "#101010",
      "-fill", "#c6ff3d",
      "-pointsize", "18",
      "-label", "%t",
      path.join(SAIDA, "folha-de-contato.jpg")
    ], { stdio: "inherit" });
  } catch (erro) {
    console.log("folha de contato não gerada: " + erro.message);
  }
}

console.log(JSON.stringify({ saida: SAIDA, baixadas: registros.length, rejeitadas }, null, 2));
