#!/usr/bin/env node
/*
  FORJA — inspeção da FONTE de mocap, antes de transferir.

  Serve para separar dois problemas que parecem iguais no resultado final:

    - defeito da transferência (o clipe sai torto mesmo com fonte boa);
    - defeito da FONTE (o mocap pula, some, teleporta).

  O segundo não se conserta — se esconde, e vira clipe publicado com salto. Este
  script mede a fonte sozinha e aponta os quadros ruins, para escolher uma janela
  limpa (`--inicio`) ou rejeitar o arquivo.

  Mede, em metros do destino:
    - maior salto de qualquer osso entre dois quadros (e em que tempo);
    - quantos quadros passam de um limite de salto;
    - amplitude de joelho, cotovelo e punho;
    - altura de pés e quadril.

  Uso:
    node tools/inspecionar-fonte-3d.mjs --origem tools/fontes-3d/16_Barbell_Curl_iclone.fbx
    node tools/inspecionar-fonte-3d.mjs --origem <fbx> --inicio 10 --duracao 6 --limite 0.15
*/
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
    if (proximo && !proximo.startsWith("--")) { saida[chave] = proximo; i += 1; }
    else saida[chave] = true;
  }
  return saida;
};

const opcoes = argumentos(process.argv.slice(2));
if (!opcoes.origem) {
  console.error("uso: --origem <fbx|glb> [--inicio s] [--duracao s] [--fps 24] [--limite 0.15]");
  process.exit(2);
}

const FPS = Number(opcoes.fps || 24);
const INICIO = Number(opcoes.inicio || 0);
const LIMITE = Number(opcoes.limite || 0.15);

const { THREE, HIERARQUIA, carregarPersonagem } = await import(path.join(raiz, "tools/lib/clipe-3d.mjs"));
const { carregarOrigem, prepararContexto } = await import(path.join(raiz, "tools/lib/retarget-3d.mjs"));

const origem = await carregarOrigem(opcoes.origem);
if (!origem.clipes.length) throw new Error("origem sem animação");
const clipe = origem.clipes.reduce((a, b) => (a.duration >= b.duration ? a : b));
const alvo = await carregarPersonagem(opcoes.personagem || "masculino");
const contexto = prepararContexto({ cenaOrigem: origem.cena, ossosOrigem: origem.ossos, alvo, modo: "mundo" });
const { mapa, escala } = contexto;

const dur = Math.min(Number(opcoes.duracao || clipe.duration), Math.max(0.2, clipe.duration - INICIO));
const total = Math.max(2, Math.round(dur * FPS) + 1);

const mixer = new THREE.AnimationMixer(origem.cena);
mixer.clipAction(clipe).play();

const amostras = [];
for (let i = 0; i < total; i += 1) {
  const t = Math.min(INICIO + i / FPS, clipe.duration);
  mixer.setTime(t);
  origem.cena.updateMatrixWorld(true);
  const posicoes = {};
  for (const [nome] of HIERARQUIA) {
    posicoes[nome] = origem.ossos.get(mapa[nome]).getWorldPosition(new THREE.Vector3()).multiplyScalar(escala);
  }
  amostras.push({ t: +t.toFixed(3), posicoes });
}

const graus = rad => (rad * 180) / Math.PI;
const angulo = (a, b, c) => graus(new THREE.Vector3().subVectors(a, b).angleTo(new THREE.Vector3().subVectors(c, b)));

const saltos = [];
for (let i = 1; i < amostras.length; i += 1) {
  let maior = 0;
  let ossos = [];
  for (const [nome] of HIERARQUIA) {
    const d = amostras[i].posicoes[nome].distanceTo(amostras[i - 1].posicoes[nome]);
    if (d > maior) { maior = d; ossos = [nome]; }
    else if (d > 0.001) ossos.push(nome);
  }
  saltos.push({ t: amostras[i].t, salto: +maior.toFixed(4) });
}
saltos.sort((a, b) => b.salto - a.salto);

const faixa = valores => ({ min: +Math.min(...valores).toFixed(3), max: +Math.max(...valores).toFixed(3) });
const joelhos = amostras.map(a => Math.min(
  angulo(a.posicoes.legL, a.posicoes.kneeL, a.posicoes.footL),
  angulo(a.posicoes.legR, a.posicoes.kneeR, a.posicoes.footR)));
const cotovelos = amostras.map(a => Math.min(
  angulo(a.posicoes.armL, a.posicoes.elbowL, a.posicoes.handL),
  angulo(a.posicoes.armR, a.posicoes.elbowR, a.posicoes.handR)));

const quadrosRuins = saltos.filter(s => s.salto > LIMITE);
/* perfil por segundo, para achar a janela onde o exercício realmente acontece */
const porSegundo = [];
for (let i = 0; i < amostras.length; i += 1) {
  const segundo = Math.floor(amostras[i].t);
  if (!porSegundo[segundo]) porSegundo[segundo] = { segundo, cotoveloMin: 999, joelhoMin: 999, punhoYMax: -999, peYMin: 999 };
  const atual = porSegundo[segundo];
  atual.cotoveloMin = Math.min(atual.cotoveloMin, +cotovelos[i].toFixed(1));
  atual.joelhoMin = Math.min(atual.joelhoMin, +joelhos[i].toFixed(1));
  atual.punhoYMax = Math.max(atual.punhoYMax, +Math.max(amostras[i].posicoes.handL.y, amostras[i].posicoes.handR.y).toFixed(3));
  atual.peYMin = Math.min(atual.peYMin, +Math.min(amostras[i].posicoes.footL.y, amostras[i].posicoes.footR.y).toFixed(3));
}

const resultado = {
  origem: path.basename(opcoes.origem),
  ossosNaOrigem: origem.ossos.size,
  clipeDuracao: +clipe.duration.toFixed(2),
  janela: { inicio: INICIO, duracao: +dur.toFixed(2), quadros: total },
  escalaAltura: +escala.toFixed(4),
  maiorSaltoQuadro: saltos[0] ? saltos[0].salto : 0,
  quadrosAcimaDoLimite: quadrosRuins.length,
  limite: LIMITE,
  pioresQuadros: saltos.slice(0, 8),
  joelhoGraus: faixa(joelhos),
  cotoveloGraus: faixa(cotovelos),
  quadrilY: faixa(amostras.map(a => a.posicoes.hips.y)),
  peY: faixa(amostras.flatMap(a => [a.posicoes.footL.y, a.posicoes.footR.y])),
  punhoY: faixa(amostras.flatMap(a => [a.posicoes.handL.y, a.posicoes.handR.y])),
  veredito: saltos[0] && saltos[0].salto > LIMITE ? "fonte com salto — escolher outra janela ou rejeitar" : "fonte contínua"
};
if (opcoes.perfil) resultado.porSegundo = porSegundo.filter(Boolean);

console.log("[fonte]", JSON.stringify(resultado));
