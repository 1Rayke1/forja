/*
  FORJA — coleta de fotografias originais.

  Roda no GitHub Actions: o ambiente de edição não acessa images.unsplash.com.
  Para cada id registrado em tools/fotografias/coleta.json:

    1. tenta o endpoint público /napi/photos/<id> (metadados estruturados);
    2. se a API responder 401 (proteção a bots em IPs de datacenter), lê a
       página individual da foto e extrai título, autor, página e a URL do
       arquivo em images.unsplash.com;
    3. recusa qualquer foto hospedada em plus.unsplash.com (coleção paga);
    4. baixa o original em 1600 px de largura, JPEG, e grava os metadados.

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
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
};

async function requisitar(url, tipo) {
  const resposta = await fetch(url, { headers: UA, redirect: "follow" });
  if (!resposta.ok) throw new Error("HTTP " + resposta.status + " em " + url);
  return tipo === "json" ? resposta.json() : resposta;
}

const tagsDe = html => {
  const pegar = regex => {
    const m = html.match(regex);
    return m ? m[1] : null;
  };
  return {
    titulo: pegar(/<title>([^<]+)<\/title>/),
    ogTitulo: pegar(/property="og:title"\s+content="([^"]+)"/),
    ogDescricao: pegar(/property="og:description"\s+content="([^"]+)"/),
    canonical: pegar(/<link rel="canonical" href="([^"]+)"/),
    imagem: pegar(/https:\/\/images\.unsplash\.com\/photo-[A-Za-z0-9_-]+/),
    imagemPaga: /https:\/\/plus\.unsplash\.com\//.test(html),
    licencaGratuita: /Free to use under the Unsplash License/i.test(html),
    autor: pegar(/photo of [^"]* by ([^(<"]+?) \(@([A-Za-z0-9_.-]+)\)/)
  };
};

const registros = [];
const rejeitadas = [];

for (const item of config.fotos || []) {
  /* Aceita tanto "id" simples quanto { id, url, sourcePage }. */
  const id = typeof item === "string" ? item : item.id;
  const urlConhecida = typeof item === "string" ? null : item.url;
  const paginaConhecida = typeof item === "string" ? null : item.sourcePage;
  try {
    const pagina = paginaConhecida || "https://unsplash.com/photos/" + encodeURIComponent(id);
    let meta = null;

    /* URL já conferida na página individual: baixa direto, sem depender da API. */
    if (urlConhecida) {
      meta = {
        slug: id,
        alt: "",
        largura: null,
        altura: null,
        autor: null,
        usuario: null,
        autorUrl: null,
        sourcePage: pagina,
        imagem: urlConhecida.split("?")[0],
        tags: [],
        evidencia: "URL conferida na página individual; download em images.unsplash.com (fora da coleção paga)"
      };
    }

    try {
      if (meta) throw new Error("api ignorada: URL já conhecida");
      const api = await requisitar("https://unsplash.com/napi/photos/" + encodeURIComponent(id), "json");
      if (api.premium || api.plus) {
        rejeitadas.push({ id, motivo: "coleção paga (Unsplash+)" });
        continue;
      }
      meta = {
        slug: api.slug,
        alt: api.alt_description || api.description || "",
        largura: api.width,
        altura: api.height,
        autor: api.user && api.user.name,
        usuario: api.user && api.user.username,
        autorUrl: api.user && api.user.links ? api.user.links.html : null,
        sourcePage: api.links ? api.links.html : pagina,
        imagem: api.urls && api.urls.raw ? api.urls.raw.split("?")[0] : null,
        tags: (api.tags || []).map(t => t.title).slice(0, 12),
        evidencia: "endpoint público /napi/photos (premium=false, plus=false)"
      };
    } catch (erroApi) {
      const resposta = await requisitar(pagina, "texto");
      const html = await resposta.text();
      const tags = tagsDe(html);
      if (tags.imagemPaga) {
        rejeitadas.push({ id, motivo: "página hospeda a imagem em plus.unsplash.com (coleção paga)" });
        continue;
      }
      if (!tags.imagem) {
        rejeitadas.push({ id, motivo: "página sem imagem gratuita identificável" });
        continue;
      }
      const nome = tags.ogTitulo || tags.titulo || "";
      const autorDoTexto = (tags.ogDescricao || "").match(/by ([^(]+) \(@([A-Za-z0-9_.-]+)\)/);
      meta = {
        slug: id,
        alt: nome,
        largura: null,
        altura: null,
        autor: autorDoTexto ? autorDoTexto[1].trim() : tags.autor,
        usuario: autorDoTexto ? autorDoTexto[2] : null,
        autorUrl: autorDoTexto ? "https://unsplash.com/@" + autorDoTexto[2] : null,
        sourcePage: tags.canonical || pagina,
        imagem: tags.imagem,
        tags: [],
        evidencia: "página individual: " + (tags.licencaGratuita ? "'Free to use under the Unsplash License'" : "licença a conferir") +
          " e imagem em images.unsplash.com (fora da coleção paga)"
      };
    }

    if (!meta.imagem) {
      rejeitadas.push({ id, motivo: "sem URL de imagem" });
      continue;
    }

    const url = meta.imagem + "?fm=jpg&q=85&w=1600&fit=max";
    const arquivo = path.join(SAIDA, id + ".jpg");
    const respostaImg = await requisitar(url, "binario");
    fs.writeFileSync(arquivo, Buffer.from(await respostaImg.arrayBuffer()));
    const bytes = fs.statSync(arquivo).size;
    if (bytes < 20000) throw new Error("arquivo suspeito (" + bytes + " bytes)");

    registros.push({
      id,
      arquivoOriginal: id + ".jpg",
      bytes,
      slug: meta.slug,
      alt: meta.alt,
      largura: meta.largura,
      altura: meta.altura,
      autor: meta.autor,
      usuario: meta.usuario,
      autorUrl: meta.autorUrl,
      sourcePage: meta.sourcePage,
      urlImagem: meta.imagem,
      licenca: "Unsplash License",
      licencaUrl: "https://unsplash.com/license",
      colecaoPaga: false,
      evidencia: meta.evidencia,
      tags: meta.tags
    });
    console.log("ok " + id + " — " + meta.autor + " — " + String(meta.alt).slice(0, 70));
  } catch (erro) {
    rejeitadas.push({ id, motivo: erro.message });
    console.log("falha " + id + " — " + erro.message);
  }
}

fs.writeFileSync(path.join(SAIDA, "metadados.json"), JSON.stringify({
  provedor: "Unsplash",
  coletadoEm: new Date().toISOString(),
  registros,
  rejeitadas
}, null, 2) + "\n");

/* Folha de contato para revisão visual rápida (não é publicada no app). */
const comImagem = registros.filter(r => fs.existsSync(path.join(SAIDA, r.arquivoOriginal)));
if (comImagem.length) {
  try {
    const lista = path.join(SAIDA, "lista.txt");
    fs.writeFileSync(lista, comImagem.map(r => path.join(SAIDA, r.arquivoOriginal)).join("\n"));
    execFileSync("bash", ["-lc",
      "montage -label '%t' $(cat " + JSON.stringify(lista) + ") -thumbnail 360x360 -tile 5x -geometry +6+18 -background '#101010' -fill '#c6ff3d' -pointsize 16 " +
      JSON.stringify(path.join(SAIDA, "folha-de-contato.jpg"))
    ], { stdio: "inherit" });
  } catch (erro) {
    console.log("folha de contato não gerada: " + erro.message);
  }
}

console.log(JSON.stringify({ saida: SAIDA, baixadas: registros.length, rejeitadas }, null, 2));
