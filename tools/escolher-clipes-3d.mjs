#!/usr/bin/env node
/*
  FORJA — escolhe, por medição, qual animação da biblioteca DeskBreak serve cada
  exercício que hoje está divergente.

  Por que assim: o catálogo já foi construído "no olho" e 11 clipes ficaram com
  movimento que não corresponde ao exercício. Em vez de escolher de novo no olho,
  este script mede as 435 animações da biblioteca no rig do FORJA e compara cada
  uma com a assinatura do exercício (a mesma do analisador). O resultado é uma
  lista ordenada — e o clipe final ainda passa por imagem antes de publicar.

  Uso:
    node tools/escolher-clipes-3d.mjs [--saida docs/assets-3d/candidatos-clipes.json]
                                      [--top 5] [--alvo prancha]
*/
import fs from "node:fs";
import path from "node:path";

import { carregarPersonagem, carregarGLB, raiz } from "./lib/clipe-3d.mjs";
import { medir } from "./analisar-movimentos-3d.mjs";

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

/*
  Assinaturas dos 11 clipes divergentes (ids do catálogo). Cada regra tem nome,
  teste e texto — o mesmo formato do analisador, para o relatório falar a mesma
  língua. `deriva` entra onde o exercício é parado no lugar.
*/
const ALVOS = {
  /*
    Cada alvo é a assinatura do EXERCÍCIO, não do movimento. Regras de "parado",
    "no chão", "em pé" e "pernas alternando" existem porque sem elas a busca
    escolhia coisas absurdas como `chair-neck-turn` para mountain climber.
  */
  polichinelo: [
    ["punhoY", m => m.punhoY.max >= 1.65, "mãos acima da cabeça"],
    ["aberturaPes", m => m.aberturaPes.amp >= 0.25, "pernas abrem de lado"],
    ["quadrilY", m => m.quadrilY.min >= 0.8, "em pé"],
    ["movimentoGraus", m => m.movimentoGraus >= 120, "movimento amplo o suficiente"],
    ["derivaXZ", m => m.derivaXZ <= 0.25, "parado no lugar"]
  ],
  flexao: [
    ["cotovelo", m => m.cotovelo.min <= 110, "cotovelo dobra"],
    ["quadrilY", m => m.quadrilY.max <= 0.6, "corpo no chão"],
    ["punhoY", m => m.punhoY.max <= 0.45, "mãos no chão"],
    ["quadrilFlex", m => m.quadrilFlex.min >= 155, "corpo alinhado (prancha, não cachorro)"],
    ["derivaXZ", m => m.derivaXZ <= 0.25, "parado no lugar"]
  ],
  supino: [
    ["cotovelo", m => m.cotovelo.min <= 110, "cotovelo dobra"],
    ["quadrilY", m => m.quadrilY.max <= 0.6, "corpo deitado"],
    ["movimentoGraus", m => m.movimentoGraus >= 70, "movimento de empurrar"],
    ["derivaXZ", m => m.derivaXZ <= 0.25, "parado no lugar"]
  ],
  afundo: [
    ["joelho", m => m.joelho.min <= 115, "joelho dobra"],
    ["quadrilY", m => m.quadrilY.amp >= 0.08, "quadril desce"],
    ["assimetriaJoelho", m => m.assimetriaJoelho.max >= 20, "uma perna à frente da outra"],
    ["quadrilY", m => m.quadrilY.min >= 0.6, "em pé, não no chão"]
  ],
  prancha: [
    ["quadrilY", m => m.quadrilY.max <= 0.45, "corpo baixo, alinhado"],
    ["quadrilY", m => m.quadrilY.amp <= 0.08, "isométrica"],
    ["quadrilFlex", m => m.quadrilFlex.min >= 155, "corpo reto"],
    ["punhoY", m => m.punhoY.max <= 0.4, "mãos no chão"],
    ["derivaXZ", m => m.derivaXZ <= 0.2, "parado no lugar"]
  ],
  "mountain-climber": [
    ["joelho", m => m.joelho.min <= 100, "joelho vem ao peito"],
    ["quadrilY", m => m.quadrilY.max <= 0.65, "corpo apoiado, baixo"],
    ["punhoY", m => m.punhoY.max <= 0.45, "mãos no chão"],
    ["assimetriaJoelho", m => m.assimetriaJoelho.max >= 20, "pernas alternando"],
    ["derivaXZ", m => m.derivaXZ <= 0.25, "parado no lugar"]
  ],
  "corrida-estacionaria": [
    ["joelho", m => m.joelho.min <= 120, "joelho sobe"],
    ["assimetriaJoelho", m => m.assimetriaJoelho.max >= 15, "pernas alternando"],
    ["quadrilY", m => m.quadrilY.min >= 0.8, "em pé"],
    ["movimentoGraus", m => m.movimentoGraus >= 60, "passada de verdade"],
    ["derivaXZ", m => m.derivaXZ <= 0.25, "corre no lugar"]
  ],
  "agachamento-halteres": [
    ["joelho", m => m.joelho.min <= 115, "joelho dobra"],
    ["quadrilY", m => m.quadrilY.amp >= 0.10, "quadril desce"],
    ["quadrilY", m => m.quadrilY.min >= 0.6, "em pé, não no chão"],
    ["derivaXZ", m => m.derivaXZ <= 0.25, "parado no lugar"]
  ],
  puxada: [
    ["cotovelo", m => m.cotovelo.min <= 100, "cotovelo dobra"],
    ["punhoY", m => m.punhoY.max >= 1.4, "mãos sobem acima do ombro"],
    ["quadrilY", m => m.quadrilY.min >= 0.8, "em pé"],
    ["derivaXZ", m => m.derivaXZ <= 0.25, "parado no lugar"]
  ],
  desenvolvimento: [
    ["punhoY", m => m.punhoY.max >= 1.7, "mãos acima da cabeça"],
    ["quadrilY", m => m.quadrilY.min >= 0.8, "em pé"],
    ["cotovelo", m => m.cotovelo.min <= 130, "cotovelo dobra"],
    ["movimentoGraus", m => m.movimentoGraus >= 60, "empurra de verdade"],
    ["derivaXZ", m => m.derivaXZ <= 0.25, "parado no lugar"]
  ],
  "remada-alta": [
    ["cotovelo", m => m.cotovelo.min <= 120, "cotovelo dobra"],
    ["punhoY", m => m.punhoY.max >= 1.35, "mãos na linha do ombro"],
    ["quadrilY", m => m.quadrilY.min >= 0.8, "em pé"],
    ["derivaXZ", m => m.derivaXZ <= 0.25, "parado no lugar"]
  ]
};

const opcoes = argumentos(process.argv.slice(2));
const TOP = Number(opcoes.top || 5);
const alvos = opcoes.alvo ? { [opcoes.alvo]: ALVOS[opcoes.alvo] } : ALVOS;

const alvo = await carregarPersonagem("masculino");
const gltf = await carregarGLB(path.join(raiz, "tools/fontes-3d/exercises.glb"));
const animacoes = gltf.animations || [];
console.log(`[escolher] medindo ${animacoes.length} animações da biblioteca no rig do FORJA…`);

const medidas = [];
for (const [indice, clipe] of animacoes.entries()) {
  if (!clipe) continue;
  try {
    const medido = medir(clipe, alvo.cena, alvo.ossos, 32);
    medidas.push({ nome: clipe.name, duracao: +clipe.duration.toFixed(2), medido });
  } catch (erro) {
    medidas.push({ nome: clipe.name, erro: String(erro.message || erro) });
  }
  if ((indice + 1) % 100 === 0) console.log(`  ${indice + 1}/${animacoes.length}…`);
}

const relatorio = { geradoEm: new Date().toISOString(), animacoesMedidas: medidas.length, alvos: {} };
for (const [id, regras] of Object.entries(alvos)) {
  const rankeados = [];
  for (const item of medidas) {
    if (!item.medido) continue;
    const m = item.medido;
    const falhas = regras.filter(([, teste]) => !teste(m));
    /* pontuação: primeiro quantas regras falham, depois quanto "perto" ficou.
       Perto = soma normalizada do quanto cada regra deixou a desejar. */
    const distancia = regras.reduce((total, [chave, teste]) => total + (teste(m) ? 0 : 1), 0);
    rankeados.push({
      nome: item.nome,
      duracao: item.duracao,
      falhas: falhas.length,
      regrasQueFalharam: falhas.map(([chave, , texto]) => texto || chave),
      medido: {
        quadrilY: m.quadrilY,
        joelho: m.joelho,
        cotovelo: m.cotovelo,
        punhoY: m.punhoY,
        aberturaPes: m.aberturaPes,
        derivaXZ: m.derivaXZ,
        saltoMax: m.saltoMax
      },
      /* desempate: menos falhas, menos deslocamento, menos salto entre quadros */
      pontuacao: falhas.length * 100 + Math.min(9, m.derivaXZ * 10) + Math.min(9, m.saltoMax * 10) + Math.min(9, (m.duracaoSecundaria || 0))
    });
  }
  rankeados.sort((a, b) => a.pontuacao - b.pontuacao);
  relatorio.alvos[id] = rankeados.slice(0, TOP);
  console.log(`\n== ${id} (${regras.length} regras)`);
  for (const item of rankeados.slice(0, TOP)) {
    const m = item.medido;
    console.log(`   ${String(item.falhas).padStart(2)} falha(s) · ${item.nome.padEnd(34)} ` +
      `quadril ${m.quadrilY.min}–${m.quadrilY.max} m · joelho ${m.joelho.min}° · ` +
      `cotovelo ${m.cotovelo.min}° · punho ${m.punhoY.max} m · pés ${m.aberturaPes.amp} m · deriva ${m.derivaXZ} m`);
  }
}

const destino = opcoes.saida || path.join(raiz, "docs/assets-3d/candidatos-clipes.json");
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(relatorio, null, 1) + "\n");
console.log(`\n[escolher] relatório: ${path.relative(raiz, destino)}`);
