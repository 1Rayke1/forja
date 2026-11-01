/*
  Suíte do mapeamento de ossos (mocap → rig de 15 ossos do FORJA).

  O que ela protege, e por quê: a transferência de movimento silenciosamente
  erra quando o mapa de ossos não casa. Antes desta biblioteca, o mapa casava
  apenas nome exato e reprovava o pacote de iClone inteiro — os ossos dele são
  `mixamorigHips` (sem dois-pontos), e nenhum candidato casava. O sintoma era
  um erro de "mapeamento incompleto" em 100% dos arquivos daquele pacote.

  1. os três vocabulários em uso (Rokoko, Mixamo com e sem dois-pontos,
     iClone/UE5) mapeiam o rig inteiro, sem faltar osso;
  2. o nome exato continua com prioridade — nenhum clipe já publicado muda de
     osso por causa da normalização;
  3. a normalização não cria par falso (braço não cai em antebraço);
  4. rig sem pernas (ou vazio) é reprovado com a lista do que falta;
  5. todo destino mapeado aponta para um osso que existe na origem;
  6. o rig do FORJA tem 15 ossos de corpo + `prop`, e o mapa não exige `prop`.

  Uso: node tests/mapeamento3d.test.mjs
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HIERARQUIA_FORJA,
  MAPA_OSSOS,
  NOMES_FORJA,
  mapearOssos,
  normalizarOsso
} from "../tools/lib/mapeamento-ossos.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let testes = 0;
const ok = (nome, funcao) => {
  funcao();
  testes += 1;
  console.log("  ok " + testes + " — " + nome);
};

/* --------------------------------------------------------------- */
/* Vocabulários reais                                              */
/* --------------------------------------------------------------- */

const inventarioMocap = JSON.parse(fs.readFileSync(path.join(raiz, "docs/assets-3d/inventario-mocap.json"), "utf8"));

/* Rokoko: pega os nomes de osso de um arquivo real do inventário */
const vocabularioRokoko = inventarioMocap
  .flatMap(arquivo => arquivo.armaduras.map(armadura => armadura.nomes_de_ossos))
  .find(nomes => nomes.includes("LeftThigh") && nomes.includes("Spine4") && !nomes.some(nome => nome.includes("mixamorig")));

/* Mixamo no formato GLB padrão */
const vocabularioMixamo = [
  "mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2",
  "mixamorig:Neck", "mixamorig:Head",
  "mixamorig:LeftShoulder", "mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand",
  "mixamorig:RightShoulder", "mixamorig:RightArm", "mixamorig:RightForeArm", "mixamorig:RightHand",
  "mixamorig:LeftUpLeg", "mixamorig:LeftLeg", "mixamorig:LeftFoot",
  "mixamorig:RightUpLeg", "mixamorig:RightLeg", "mixamorig:RightFoot"
].map(nome => nome.replace(":", ""));

/* iClone: Mixamo exportado sem o prefixo separado (é o que está em
   tools/fontes-3d/16_Barbell_Curl_iclone.fbx) */
const vocabularioIclone = vocabularioMixamo;

/* iClone / UE5 canônico */
const vocabularioUE5 = [
  "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head",
  "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
  "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
  "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r"
];

/* --------------------------------------------------------------- */
/* 1..6                                                            */
/* --------------------------------------------------------------- */

console.log("mapeamento de ossos — mocap → FORJA");

ok("o rig do FORJA tem 15 ossos de corpo, sem osso de cabeça e sem exigir `prop`", () => {
  assert.equal(NOMES_FORJA.length, 15);
  assert.deepEqual(NOMES_FORJA, ["hips", "spine", "neck", "armL", "elbowL", "handL", "armR",
    "elbowR", "handR", "legL", "kneeL", "footL", "legR", "kneeR", "footR"]);
  assert.ok(!NOMES_FORJA.includes("prop"), "prop é do exercício, não do mocap");
  assert.equal(MAPA_OSSOS.prop, undefined);
  /* hierarquia: pai sempre declarado antes do filho */
  const vistos = new Set();
  for (const [nome, pai] of HIERARQUIA_FORJA) {
    if (pai) assert.ok(vistos.has(pai), nome + " antes do pai " + pai);
    vistos.add(nome);
  }
});

ok("Rokoko (Mocap_Pack_06) mapeia os 15 ossos no nome exato", () => {
  assert.ok(vocabularioRokoko, "inventário sem vocabulário Rokoko");
  const { mapa, faltando, passadas } = mapearOssos(vocabularioRokoko);
  assert.deepEqual(faltando, []);
  assert.equal(passadas.normalizada, 0, "Rokoko não deve precisar de normalização");
  assert.equal(mapa.spine, "Spine2", "prioridade histórica: Spine2 (peito), não Spine4");
  assert.equal(mapa.legL, "LeftThigh");
  assert.equal(mapa.kneeL, "LeftShin");
  assert.equal(mapa.armR, "RightArm");
});

ok("Mixamo (mixamorig:Hips) mapeia os 15 ossos no nome exato", () => {
  const { mapa, faltando, passadas } = mapearOssos(vocabularioMixamo.map(nome => "mixamorig:" + nome.slice("mixamorig".length)));
  assert.deepEqual(faltando, []);
  assert.equal(passadas.normalizada, 0);
  assert.equal(mapa.hips, "mixamorig:Hips");
  assert.equal(mapa.spine, "mixamorig:Spine2");
});

ok("iClone sem dois-pontos (mixamorigHips) mapeia os 15 ossos pela normalização", () => {
  assert.ok(vocabularioIclone.includes("mixamorigHips"));
  const { mapa, faltando, passadas } = mapearOssos(vocabularioIclone);
  assert.deepEqual(faltando, [], "o pacote de iClone não pode reprovar");
  assert.equal(passadas.exata, 0);
  assert.equal(passadas.normalizada, 15);
  assert.equal(mapa.hips, "mixamorigHips");
  assert.equal(mapa.elbowL, "mixamorigLeftForeArm", "antebraço, não ombro");
  assert.equal(mapa.armL, "mixamorigLeftArm", "braço, não ombro");
});

ok("iClone/UE5 canônico (pelvis, thigh_l) mapeia os 15 ossos", () => {
  const { mapa, faltando } = mapearOssos(vocabularioUE5);
  assert.deepEqual(faltando, []);
  assert.equal(mapa.hips, "pelvis");
  assert.equal(mapa.spine, "spine_03", "spine_03 é o peito no UE5");
  assert.equal(mapa.kneeR, "calf_r");
  assert.equal(mapa.footL, "foot_l");
});

ok("a normalização não confunde braço com antebraço nem coxa com canela", () => {
  assert.notEqual(normalizarOsso("LeftArm"), normalizarOsso("LeftForeArm"));
  assert.notEqual(normalizarOsso("LeftUpLeg"), normalizarOsso("LeftLeg"));
  assert.notEqual(normalizarOsso("RightArm"), normalizarOsso("RightShoulder"));
  assert.equal(normalizarOsso("mixamorig:LeftUpLeg"), normalizarOsso("mixamorigLeftUpLeg"));
  assert.equal(normalizarOsso("Armature|Hips"), "hips");
  assert.equal(normalizarOsso("upper_arm.L"), "upperarml");
  assert.equal(normalizarOsso("Bip01_L_Thigh"), "lthigh");
});

ok("todo destino mapeado aponta para um osso que existe na origem", () => {
  for (const vocabulario of [vocabularioRokoko, vocabularioIclone, vocabularioUE5]) {
    const { mapa } = mapearOssos(vocabulario);
    for (const [destino, origem] of Object.entries(mapa)) {
      assert.ok(vocabulario.includes(origem), destino + " aponta para " + origem + ", ausente");
      assert.equal(new Set(Object.values(mapa)).size, Object.keys(mapa).length,
        "dois destinos no mesmo osso de origem");
    }
  }
});

ok("rig sem pernas reprova e diz o que falta", () => {
  const { mapa, faltando } = mapearOssos(["Hips", "Spine2", "Neck",
    "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"]);
  assert.equal(mapa.hips, "Hips");
  assert.deepEqual(faltando, ["legL", "kneeL", "footL", "legR", "kneeR", "footR"]);
});

ok("lista vazia reprova com os 15 ossos faltando", () => {
  const { mapa, faltando } = mapearOssos([]);
  assert.deepEqual(mapa, {});
  assert.equal(faltando.length, 15);
  assert.deepEqual(faltando, NOMES_FORJA);
});

console.log("\n" + testes + " testes de mapeamento de ossos, todos verdes.");
