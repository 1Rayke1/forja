#!/usr/bin/env node
/*
  FORJA — extrai um clipe de uma biblioteca de origem para o formato publicado.

  Duas origens suportadas:

    --fonte deskbreak --animacao "<nome>"   pega uma animação de
        `tools/fontes-3d/exercises.glb` (rig de 16 ossos igual ao nosso)

    --fonte mocap --arquivo <fbx|glb>       usa um clipe já transferido para o
        rig do FORJA (ver tools/retransferir-mocap.mjs)

  O clipe é reamostrado a 24 fps no próprio rig do personagem e gravado em GLB,
  com a mesma estrutura dos 40 arquivos publicados. O destino padrão é uma pasta
  de CANDIDATOS: nada aqui substitui o catálogo.

  Uso:
    node tools/extrair-clipe-3d.mjs --fonte deskbreak --animacao plank-on-knees \
      --clipe prancha-v2 --saida docs/validacao-3d/fase2/candidatos/prancha-v2.glb \
      [--inicio 0] [--duracao 3] [--fps 24] [--personagem masculino] [--loop]
*/
import fs from "node:fs";
import path from "node:path";

import {
  carregarPersonagem, carregarGLB, escreverClipeGLB, amostrarParaClipe, raiz
} from "./lib/clipe-3d.mjs";

const argumentos = lista => {
  const saida = {};
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i];
    if (!item.startsWith("--")) continue;
    const chave = item.slice(2);
    const proximo = lista[i + 1];
    if (proximo && !proximo.startsWith("--")) {
      saida[chave] = proximo;
      i += 1;
    } else {
      saida[chave] = true;
    }
  }
  return saida;
};

const opcoes = argumentos(process.argv.slice(2));
const FONTE = opcoes.fonte || "deskbreak";
const FPS = Number(opcoes.fps || 24);
const PERSONAGEM = opcoes.personagem || "masculino";
const SAIDA = opcoes.saida || path.join(raiz, "docs/validacao-3d/fase2/candidatos", (opcoes.clipe || "clipe") + ".glb");
if (!opcoes.clipe || !opcoes.saida) {
  console.error("uso: --fonte deskbreak|mocap --clipe <id> --saida <arquivo.glb> [--animacao nome] [--arquivo fbx] [--inicio s] [--duracao s]");
  process.exit(2);
}

const alvo = await carregarPersonagem(PERSONAGEM);

let clipe;
let origemTexto;
if (FONTE === "deskbreak") {
  if (!opcoes.animacao) {
    console.error("--fonte deskbreak exige --animacao <nome>");
    process.exit(2);
  }
  const gltf = await carregarGLB(path.join(raiz, "tools/fontes-3d/exercises.glb"));
  clipe = (gltf.animations || []).find(animacao => animacao.name === opcoes.animacao);
  if (!clipe) {
    const parecidos = (gltf.animations || [])
      .map(animacao => animacao.name)
      .filter(nome => nome.includes(opcoes.animacao.split("-")[0]))
      .slice(0, 8);
    console.error("animação não encontrada:", opcoes.animacao, "| parecidas:", parecidos.join(", "));
    process.exit(3);
  }
  origemTexto = "deskbreak:" + clipe.name;
} else {
  if (!opcoes.arquivo) {
    console.error("--fonte mocap exige --arquivo <fbx|glb>");
    process.exit(2);
  }
  const gltf = await carregarGLB(opcoes.arquivo);
  clipe = (gltf.animations || [])[0];
  if (!clipe) {
    console.error("arquivo sem animação:", opcoes.arquivo);
    process.exit(3);
  }
  origemTexto = "mocap:" + path.basename(opcoes.arquivo);
}

const dados = amostrarParaClipe({
  cena: alvo.cena,
  ossos: alvo.ossos,
  clipe,
  fps: FPS,
  duracao: opcoes.duracao ? Number(opcoes.duracao) : undefined,
  inicio: opcoes.inicio ? Number(opcoes.inicio) : 0
});

const ossosDestino = {};
for (const [nome, osso] of alvo.ossos) {
  ossosDestino[nome] = {
    pai: osso.parent && osso.parent.isBone ? osso.parent.name : null,
    posicao: osso.position.toArray().map(v => +v.toFixed(6)),
    rotacao: osso.quaternion.toArray().map(v => +v.toFixed(6)),
    escala: osso.scale.toArray().map(v => +v.toFixed(6))
  };
}

const bytes = escreverClipeGLB({
  clipe: opcoes.clipe,
  ossosDestino,
  tempos: dados.tempos,
  trilhas: dados.trilhas
}, SAIDA);

console.log("[extrair]", JSON.stringify({
  clipe: opcoes.clipe,
  fonte: origemTexto,
  personagem: PERSONAGEM,
  duracao: +dados.duracao.toFixed(2),
  fps: FPS,
  amostras: dados.tempos.length,
  bytes,
  arquivo: path.relative(raiz, path.resolve(SAIDA))
}));
