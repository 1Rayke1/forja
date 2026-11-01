#!/usr/bin/env node
/*
  FORJA — transferência de mocap para o rig de 15 ossos + `prop`.

  A matemática vive em `tools/lib/retarget-3d.mjs` (importada pelo teste
  `tests/transferencia3d.test.mjs`). Este arquivo é só a linha de comando:
  lê a origem, prepara o contexto, transfere, grava o GLB e imprime a medição.

  Modos (`--modo`):
    mundo  (padrão) — rotação de mundo relativa ao repouso. Independe do eixo,
                      do roll e da pose de repouso do rig de origem. É o modo
                      que corrige o iClone/Mixamo (antes saía de cabeça para
                      baixo) e mantém o Rokoko como estava.
    local           — delta local por osso com correção constante entre pais.
    legado          — a conta antiga, com eixo fixo +Y. Só para comparar.

  Uso:
    node tools/retransferir-mocap.mjs --origem tools/fontes-3d/16_Barbell_Curl_iclone.fbx \
      --clipe rosca --saida /tmp/rosca.glb [--inicio 10] [--duracao 4] [--fps 24] \
      [--personagem masculino] [--modo mundo] [--sem-apoio]

  O clipe gerado NÃO é publicado: publicar é decisão de validação (medida +
  folha de imagens + aprovação).
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
if (!opcoes.origem || !opcoes.saida) {
  console.error("uso: --origem <fbx|glb> --saida <arquivo.glb> [--clipe id] [--inicio s] [--duracao s] [--fps 24] [--personagem masculino] [--modo mundo|local|legado] [--sem-apoio]");
  process.exit(2);
}

const FPS = Number(opcoes.fps || 24);
const INICIO = Number(opcoes.inicio || 0);
const DURACAO = Number(opcoes.duracao || 4);
const PERSONAGEM = opcoes.personagem || "masculino";
const CLIPE = opcoes.clipe || path.basename(opcoes.saida, ".glb");
const MODO = opcoes.modo || "mundo";
const APOIAR = !opcoes["sem-apoio"];

const { carregarPersonagem, escreverClipeGLB } = await import(path.join(raiz, "tools/lib/clipe-3d.mjs"));
const { carregarOrigem, prepararContexto, transferirMovimento, medirFonte } =
  await import(path.join(raiz, "tools/lib/retarget-3d.mjs"));

const origem = await carregarOrigem(opcoes.origem);
if (!origem.clipes.length) throw new Error("origem sem animação");
const clipeOrigem = origem.clipes.reduce((a, b) => (a.duration >= b.duration ? a : b));
const alvo = await carregarPersonagem(PERSONAGEM);

const contexto = prepararContexto({ cenaOrigem: origem.cena, ossosOrigem: origem.ossos, alvo, modo: MODO });

const fonte = medirFonte({
  cenaOrigem: origem.cena,
  ossosOrigem: origem.ossos,
  clipeOrigem,
  mapa: contexto.mapa,
  escala: contexto.escala,
  fps: FPS,
  inicio: INICIO,
  duracao: DURACAO
});

const dados = transferirMovimento({
  cenaOrigem: origem.cena,
  ossosOrigem: origem.ossos,
  alvo,
  contexto,
  clipeOrigem,
  modo: MODO,
  inicio: INICIO,
  duracao: DURACAO,
  fps: FPS,
  apoiar: APOIAR
});

const bytes = escreverClipeGLB({ ...dados, clipe: CLIPE }, opcoes.saida);

console.log("[retransferir]", JSON.stringify({
  clipe: CLIPE,
  origem: path.basename(opcoes.origem),
  personagem: PERSONAGEM,
  modo: MODO,
  duracao: +dados.duracao.toFixed(3),
  fps: FPS,
  amostras: dados.diagnostico.quadros,
  mapeados: Object.keys(contexto.mapa).length,
  passadasDoMapa: contexto.passadas,
  guinadaGraus: dados.diagnostico.guinadaGraus,
  escalaAltura: dados.diagnostico.escalaAltura,
  bytes,
  arquivo: opcoes.saida,
  fonte,
  destino: dados.diagnostico
}));
