/*
  FORJA — identificação da página de uma fotografia a partir do hash do arquivo.

  Algumas fotografias foram baixadas de URLs conhecidas (images.unsplash.com)
  sem a página individual registrada. Este script percorre uma página de busca
  do Unsplash e casa o hash do arquivo (`photo-<timestamp>-<hash>`) com o link
  da foto correspondente, devolvendo id, slug e autor.

  Roda no CI (o acesso ao Unsplash depende de rede liberada).

  Uso: node tools/fotografias/identificar.mjs --hash photo-1772450014504-1914f8afe985 \
         --busca https://unsplash.com/s/photos/pull-up-bar --saida identificacao.json
*/

import fs from "node:fs";

const args = process.argv.slice(2);
const valor = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i !== -1 && args[i + 1] ? args[i + 1] : padrao;
};

const hash = valor("--hash");
const busca = valor("--busca", "https://unsplash.com/s/photos/pull-up-bar");
const saida = valor("--saida", "identificacao.json");

const UA = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
};

const resposta = await fetch(busca, { headers: UA, redirect: "follow" });
const html = await resposta.text();

/*
  Cada resultado aparece como um link para /photos/<slug>-<id> seguido pela
  imagem em images.unsplash.com/photo-<...>. Percorremos o HTML em ordem e
  guardamos o par mais próximo.
*/
const pares = [];
const regex = /href="\/photos\/([a-z0-9-]*?([A-Za-z0-9_-]{11}))"[^>]*>|images\.unsplash\.com\/(photo-[0-9]+-[a-z0-9]+)/g;
let atual = null;
let encontrado;
while ((encontrado = regex.exec(html)) !== null) {
  if (encontrado[1]) {
    atual = { slug: encontrado[1], id: encontrado[2], hash: null };
    pares.push(atual);
  } else if (atual && encontrado[3] && !atual.hash) {
    atual.hash = encontrado[3];
  }
}

const alvo = pares.find(par => par.hash === hash) || null;
const semHash = pares.slice(0, 5);

fs.writeFileSync(saida, JSON.stringify({
  busca,
  hashProcurado: hash,
  status: alvo ? "encontrado" : "nao-encontrado",
  alvo,
  amostra: semHash,
  totalPares: pares.length
}, null, 2) + "\n");

console.log(JSON.stringify({ status: alvo ? "encontrado" : "nao-encontrado", alvo, totalPares: pares.length }, null, 2));
