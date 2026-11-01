#!/usr/bin/env node
/*
  FORJA — autora exercícios que mocap não cobre (flexão, prancha, mountain
  climber) por geometria, usando o rig de 15 ossos + `prop`.

  A matemática vive em `tools/lib/pose-autoral-3d.mjs` (importada pelo teste
  `tests/pose-autoral3d.test.mjs`). Este arquivo é só a linha de comando.

  Uso:
    node tools/autorar-exercicios-3d.mjs --exercicio flexao \
      --personagem masculino --saida docs/validacao-3d/fase4/candidatos/flexao-masculino.glb

  O clipe gerado NÃO entra no catálogo: candidatos ficam em
  `docs/validacao-3d/fase4/` até a validação (medida + folha + aprovação).
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
const EXERCICIO = opcoes.exercicio;
if (!EXERCICIO) {
  console.error("uso: --exercicio flexao|prancha|mountain-climber --personagem masculino|feminino --saida arquivo.glb [--duracao s] [--fps 24]");
  process.exit(2);
}

const PERSONAGEM = opcoes.personagem || "masculino";
const SAIDA = opcoes.saida || path.join(raiz, `docs/validacao-3d/fase4/candidatos/${EXERCICIO}-${PERSONAGEM}.glb`);

const { carregarPersonagem, escreverClipeGLB } = await import(path.join(raiz, "tools/lib/clipe-3d.mjs"));
const { medirRig, autorarExercicio } = await import(path.join(raiz, "tools/lib/pose-autoral-3d.mjs"));

const alvo = await carregarPersonagem(PERSONAGEM);
const rig = medirRig(alvo);

const ajustes = {};
if (opcoes.duracao) ajustes.duracao = Number(opcoes.duracao);
if (opcoes.fps) ajustes.fps = Number(opcoes.fps);
if (opcoes.profundidade) ajustes.profundidade = Number(opcoes.profundidade);

const autoral = autorarExercicio(rig, EXERCICIO, ajustes);
const { cfg, tempos, valoresRot, valoresPos, amostras } = autoral;

const trilhas = [];
for (const nome of Object.keys(valoresRot)) {
  trilhas.push({ osso: nome, caminho: "rotation", valores: valoresRot[nome], componentes: 4 });
}
trilhas.push({ osso: "hips", caminho: "translation", valores: valoresPos.hips, componentes: 3 });

const ossosDestino = Object.fromEntries(
  Array.from(alvo.ossos.entries()).map(([nome, osso]) => [nome, {
    pai: osso.parent && osso.parent.isBone ? osso.parent.name : null,
    posicao: osso.position.toArray().map(v => +v.toFixed(6)),
    rotacao: osso.quaternion.toArray().map(v => +v.toFixed(6)),
    escala: osso.scale.toArray().map(v => +v.toFixed(6))
  }])
);

const dados = {
  tempos,
  trilhas,
  duracao: cfg.duracao,
  fps: cfg.fps,
  /* nome interno do clipe = exercício (o arquivo é que diz o personagem:
     `flexao-masculino.glb`). Assim o mesmo gerador produz bytes idênticos na
     CLI e no teste, que é o que garante "candidato = saída do gerador". */
  clipe: EXERCICIO,
  ossosDestino
};

const bytes = escreverClipeGLB(dados, SAIDA);

/* ---------------- medição do que saiu de fato ---------------- */
const graus = rad => (rad * 180) / Math.PI;
const angulo = (a, b, c) => {
  const u = a.clone().sub(b);
  const v = c.clone().sub(b);
  return graus(Math.acos(Math.max(-1, Math.min(1, u.normalize().dot(v.normalize())))));
};
const faixa = valores => [Math.min(...valores), Math.max(...valores)];

const coletor = { pe: [], mao: [], quadril: [], cotovelo: [], joelho: [], ombro: [], tronco: [] };
for (const { montada } of amostras) {
  const p = montada.posicoes;
  coletor.pe.push(p.footL.y, p.footR.y);
  coletor.mao.push(p.handL.y, p.handR.y);
  coletor.quadril.push(p.hips.y);
  coletor.cotovelo.push(angulo(p.armL, p.elbowL, p.handL), angulo(p.armR, p.elbowR, p.handR));
  coletor.joelho.push(angulo(p.legL, p.kneeL, p.footL), angulo(p.legR, p.kneeR, p.footR));
  coletor.ombro.push(angulo(p.elbowL, p.armL, p.hips), angulo(p.elbowR, p.armR, p.hips));
  /* alinhamento: ângulo entre a linha quadril→ombro e a linha quadril→tornozelo */
  const ombro = p.armL.clone().add(p.armR).multiplyScalar(0.5);
  const tornozelo = p.footL.clone().add(p.footR).multiplyScalar(0.5);
  coletor.tronco.push(angulo(ombro, p.hips, tornozelo));
}

console.log("[autorar]", JSON.stringify({
  clipe: dados.clipe,
  personagem: PERSONAGEM,
  exercicio: EXERCICIO,
  duracao: cfg.duracao,
  fps: cfg.fps,
  quadros: tempos.length,
  bytes,
  arquivo: path.relative(raiz, SAIDA),
  medida: Object.fromEntries(Object.entries(coletor).map(([k, v]) => [k, {
    min: +faixa(v)[0].toFixed(4),
    max: +faixa(v)[1].toFixed(4)
  }])),
  geometria: {
    corpo: +rig.corpo.toFixed(4),
    coxa: +rig.comprimento.coxa.toFixed(4),
    canela: +rig.comprimento.canela.toFixed(4),
    braco: +rig.comprimento.braco.toFixed(4),
    antebraco: +rig.comprimento.antebraco.toFixed(4),
    tornozeloY: +rig.pe.tornozelo.toFixed(4)
  }
}));
