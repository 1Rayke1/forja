#!/usr/bin/env node
/*
  FORJA — biblioteca de mapeamento de ossos (rig de origem → rig de 16 ossos).

  Por que existe: a transferência de mocap só funciona se cada osso do FORJA
  achar um osso na origem. Os pacotes de mocap em uso não têm um vocabulário só:

    - Rokoko (Mocap_Pack_06) ............ Hips, Spine4, LeftUpLeg, LeftArm
    - Mixamo (via iClone) ............... mixamorigHips, mixamorigLeftUpLeg
    - Mixamo (GLB padrão) ............... mixamorig:Hips, mixamorig:LeftUpLeg
    - iClone / UE5 ...................... pelvis, spine_01, thigh_l, upperarm_l
    - Blender Rigify / genérico ......... DEF-spine, upper_arm.L

  A primeira versão do mapa casava **nome exato** — e por isso reprovava o
  pacote inteiro de iClone (`16_Barbell_Curl_iclone.fbx`), cujos ossos são
  `mixamorigHips` (sem dois-pontos). O erro era "mapeamento incompleto,
  faltam: hips, spine, …": nenhum osso casava.

  Aqui o casamento tem duas passadas:

    1. nome exato — preserva o resultado já validado do Rokoko, sem mexer em
       nenhum clipe publicado;
    2. nome normalizado — tira prefixos de exportador (`mixamorig:`, `Armature|`,
       `BIP01`), separadores (`_ - . espaço`) e caixa alta.

  A ordem das opções em `MAPA_OSSOS` é a prioridade: `Spine2` antes de `Spine1`,
  `LeftUpLeg` antes de `LeftThigh`. Trocar essa ordem muda o resultado dos
  clipes existentes, então não troque sem re-medir os 40.
*/

/* Ordem de hierarquia do rig do FORJA (pai antes de filho). */
export const HIERARQUIA_FORJA = [
  ["hips", null],
  ["spine", "hips"],
  ["neck", "spine"],
  ["armL", "spine"], ["elbowL", "armL"], ["handL", "elbowL"],
  ["armR", "spine"], ["elbowR", "armR"], ["handR", "elbowR"],
  ["legL", "hips"], ["kneeL", "legL"], ["footL", "kneeL"],
  ["legR", "hips"], ["kneeR", "legR"], ["footR", "kneeR"]
];

export const NOMES_FORJA = HIERARQUIA_FORJA.map(([nome]) => nome);

/*
  Cada destino aceita vários nomes de origem, do mais fiel ao mais tolerante.
  Manter exatamente a ordem: o primeiro que existir na origem vence.
*/
export const MAPA_OSSOS = {
  hips: ["Hips", "mixamorig:Hips", "pelvis", "root", "Bip01_Pelvis"],
  spine: ["Spine2", "Spine1", "Spine", "mixamorig:Spine2", "mixamorig:Spine1", "mixamorig:Spine",
    "spine_03", "spine_02", "spine_01", "Chest", "chest"],
  neck: ["Neck", "mixamorig:Neck", "neck_01", "Head", "mixamorig:Head", "head"],
  armL: ["LeftArm", "mixamorig:LeftArm", "upperarm_l", "LeftShoulder",
    "clavicle_l", "shoulder_l", "upper_arm.L", "Bip01_L_UpperArm"],
  elbowL: ["LeftForeArm", "mixamorig:LeftForeArm", "lowerarm_l", "forearm_l",
    "lower_arm.L", "Bip01_L_Forearm"],
  handL: ["LeftHand", "mixamorig:LeftHand", "hand_l", "hand.L", "Bip01_L_Hand"],
  armR: ["RightArm", "mixamorig:RightArm", "upperarm_r", "RightShoulder",
    "clavicle_r", "shoulder_r", "upper_arm.R", "Bip01_R_UpperArm"],
  elbowR: ["RightForeArm", "mixamorig:RightForeArm", "lowerarm_r", "forearm_r",
    "lower_arm.R", "Bip01_R_Forearm"],
  handR: ["RightHand", "mixamorig:RightHand", "hand_r", "hand.R", "Bip01_R_Hand"],
  legL: ["LeftThigh", "LeftUpLeg", "mixamorig:LeftUpLeg", "thigh_l",
    "upperleg_l", "thigh.L", "Bip01_L_Thigh"],
  kneeL: ["LeftShin", "LeftLeg", "mixamorig:LeftLeg", "calf_l", "shin_l",
    "lowerleg_l", "shin.L", "Bip01_L_Calf"],
  footL: ["LeftFoot", "mixamorig:LeftFoot", "foot_l", "foot.L", "Bip01_L_Foot"],
  legR: ["RightThigh", "RightUpLeg", "mixamorig:RightUpLeg", "thigh_r",
    "upperleg_r", "thigh.R", "Bip01_R_Thigh"],
  kneeR: ["RightShin", "RightLeg", "mixamorig:RightLeg", "calf_r", "shin_r",
    "lowerleg_r", "shin.R", "Bip01_R_Calf"],
  footR: ["RightFoot", "mixamorig:RightFoot", "foot_r", "foot.R", "Bip01_R_Foot"]
};

/* Prefixos de exportador que não dizem nada sobre o osso. */
const PREFIXOS = [
  "mixamorig:", "mixamorig", "armature|", "armature", "bip001", "bip01",
  "def-", "org-", "mch-"
];

/*
  Normaliza um nome de osso: sem prefixo de exportador, sem separador, minúsculo.
  "mixamorigLeftUpLeg" → "leftupleg"; "upper_arm.L" → "upperarml";
  "DEF-spine.001" → "spine001".
*/
export function normalizarOsso(nome) {
  let texto = String(nome || "").trim().toLowerCase();
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const prefixo of PREFIXOS) {
      if (texto.startsWith(prefixo)) {
        texto = texto.slice(prefixo.length);
        mudou = true;
      }
    }
  }
  return texto.replace(/[^a-z0-9]/g, "");
}

/*
  Casa os ossos disponíveis na origem com o rig do FORJA.

  Recebe uma lista de nomes (ou um Set) e devolve:
    mapa      — { destino: nomeNaOrigem } apenas do que casou
    faltando  — destinos sem par (lista vazia = mapeamento completo)
    porPassada — quantos casaram no nome exato e quantos na normalização
*/
export function mapearOssos(nomesDisponiveis) {
  const nomes = nomesDisponiveis instanceof Set ? [...nomesDisponiveis] : [...nomesDisponiveis];
  const existe = new Map();
  for (const nome of nomes) {
    if (!existe.has(nome)) existe.set(nome, nome);
    const chave = normalizarOsso(nome);
    if (!existe.has("~" + chave)) existe.set("~" + chave, nome);
  }
  const mapa = {};
  const passadas = { exata: 0, normalizada: 0 };
  for (const [destino, candidatos] of Object.entries(MAPA_OSSOS)) {
    const exato = candidatos.find(nome => existe.has(nome));
    if (exato) {
      mapa[destino] = existe.get(exato);
      passadas.exata += 1;
      continue;
    }
    const normalizado = candidatos.find(nome => existe.has("~" + normalizarOsso(nome)));
    if (normalizado) {
      mapa[destino] = existe.get("~" + normalizarOsso(normalizado));
      passadas.normalizada += 1;
    }
  }
  const faltando = NOMES_FORJA.filter(nome => !mapa[nome]);
  return { mapa, faltando, passadas };
}
