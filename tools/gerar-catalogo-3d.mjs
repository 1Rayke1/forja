#!/usr/bin/env node
/*
  FORJA — gera `assets/3d/catalogo.json`, a única fonte de verdade do app sobre
  os personagens 3D e as animações publicadas.

  Só entra no catálogo o que foi realmente construído: cada clipe é conferido no
  disco, com tamanho e duração lidos do arquivo final. Se um clipe do mapa não
  foi gerado, o catálogo o registra como indisponível — não inventa movimento.

  Uso:
    node tools/gerar-catalogo-3d.mjs <mapa.json> <dir-de-trabalho> <assets/3d> <raiz>
*/
import fs from "node:fs";
import path from "node:path";

const [mapaPath, workDir, assetsDir, root] = process.argv.slice(2);
if (!mapaPath || !workDir || !assetsDir || !root) {
  console.error("uso: gerar-catalogo-3d.mjs <mapa.json> <trabalho> <assets/3d> <raiz>");
  process.exit(2);
}

const mapa = JSON.parse(fs.readFileSync(mapaPath, "utf8"));
const fontes = path.join(root, "tools", "fontes-3d");

const lerJson = (arquivo, padrao) => {
  try { return JSON.parse(fs.readFileSync(arquivo, "utf8")); } catch { return padrao; }
};

const personagensJson = lerJson(path.join(assetsDir, "personagens", "personagens.json"), {});
const clipesDeskbreak = lerJson(path.join(workDir, "deskbreak", "clipes.json"), []);
const porIdDeskbreak = new Map(clipesDeskbreak.map(c => [c.id, c]));
const metaDeskbreak = lerJson(path.join(fontes, "exercises.json"), { exercises: [] });
const metaPorId = new Map((metaDeskbreak.exercises || []).map(e => [e.id, e]));

const ID_PERSONAGENS = ["masculino", "feminino"];

function medirPersonagem(slug) {
  const relativo = `assets/3d/personagens/${slug}.glb`;
  const absoluto = path.join(assetsDir, "personagens", `${slug}.glb`);
  if (!fs.existsSync(absoluto)) return null;
  const info = personagensJson[slug === "masculino" ? "Personagem masculino" : "Personagem feminino"] || {};
  return {
    id: slug,
    arquivo: relativo,
    bytes: fs.statSync(absoluto).size,
    rig: info.rig || "rig-16-ossos",
    ossos: info.ossos || 16,
    vertices: info.vertices || null,
    poligonos: info.poligonos || null,
    alturaM: info.altura_m || null,
    larguraOmbrosM: info.largura_ombros_m || null,
    materiais: info.materiais || []
  };
}

const personagens = {};
for (const slug of ID_PERSONAGENS) {
  const dados = medirPersonagem(slug);
  if (dados) personagens[slug] = dados;
}

const clipes = [];
const exercicioParaClipe = {};
const indisponiveis = [];

for (const entrada of mapa.clipes) {
  const arquivo = path.join(assetsDir, "animacoes", `${entrada.id}.glb`);
  if (!fs.existsSync(arquivo)) {
    indisponiveis.push({ id: entrada.id, motivo: "arquivo não gerado no build" });
    continue;
  }
  const bytes = fs.statSync(arquivo).size;
  const meta = porIdDeskbreak.get(entrada.id);
  const fonte = entrada.fonte === "mocap"
    ? {
        pacote: "Mocap_Pack_06_Fitness_and_Workout",
        release: "assets-3d-v2",
        arquivo: entrada.fbx,
        rig: "rokoko/iclone/ue5 (por variante)",
        retarget: true
      }
    : {
        pacote: "DeskBreak — library/exercises.glb",
        release: "assets-3d-v1",
        arquivo: `library/exercises.glb#${entrada.acao}`,
        rig: "manequim 16 ossos",
        retarget: false
      };

  const quadros = entrada.fonte === "mocap"
    ? Number(entrada.quadros || 144)
    : (meta ? meta.quadros : 0);
  const fps = 24;
  const duracaoS = meta ? meta.duracao_s : Number((quadros / fps).toFixed(2));
  const referencia = entrada.fonte === "deskbreak" ? metaPorId.get(entrada.acao.replace(/_rig$/, "")) : null;

  const clipe = {
    id: entrada.id,
    nome: entrada.nome,
    grupo: entrada.grupo,
    status: entrada.status,
    arquivo: `assets/3d/animacoes/${entrada.id}.glb`,
    bytes,
    quadros,
    fps,
    duracaoS,
    loop: true,
    movimentoCompleto: entrada.fonte === "deskbreak",
    personagens: Object.keys(personagens),
    rigOrigem: fonte.rig,
    rigDestino: "rig-16-ossos",
    retarget: fonte.retarget,
    fonte,
    exercicios: entrada.exercicios || []
  };
  if (referencia) {
    clipe.referencia = {
      nomeEn: referencia.en || null,
      categoria: referencia.category || null,
      vista: referencia.view || null
    };
  }
  clipes.push(clipe);
  for (const exercicio of entrada.exercicios || []) {
    if (!exercicioParaClipe[exercicio]) exercicioParaClipe[exercicio] = entrada.id;
  }
}

/*
  Fallback por grupo muscular: o mapa aponta o clipe "ideal" de cada grupo. Se
  esse clipe não foi gerado (source ausente), o catálogo promove o primeiro
  clipe DISPONÍVEL do mesmo grupo — nunca aponta para um arquivo que não existe,
  o que faria o app pedir um 404. Sem nada no grupo, cai em "corpo inteiro".
*/
const disponiveis = new Set(clipes.map(clipe => clipe.id));
const primeiroDoGrupo = new Map();
clipes.forEach(clipe => {
  if (!primeiroDoGrupo.has(clipe.grupo)) primeiroDoGrupo.set(clipe.grupo, clipe.id);
});
const fallbackPorGrupo = {};
for (const [grupo, id] of Object.entries(mapa.fallbackPorGrupo || {})) {
  if (disponiveis.has(id)) {
    fallbackPorGrupo[grupo] = id;
    continue;
  }
  const alternativa = primeiroDoGrupo.get(grupo) ||
    primeiroDoGrupo.get("corpo inteiro") ||
    (clipes[0] && clipes[0].id);
  if (alternativa) {
    fallbackPorGrupo[grupo] = alternativa;
    console.log(`[catálogo] fallback ${grupo}: ${id} indisponível → ${alternativa}`);
  }
}

const catalogo = {
  formato: "forja-catalogo-3d",
  versao: 1,
  geradoEm: new Date().toISOString(),
  personagens,
  clipes,
  clipesIndisponiveis: indisponiveis,
  exercicios: exercicioParaClipe,
  fallbackPorGrupo,
  creditos: {
    manequim: {
      nome: "DeskBreak — wooden mannequin exercise library",
      autor: "Shlomy Reshef",
      licenca: "MIT",
      origem: "https://github.com/shlomorsh/desk-break",
      uso: "malha base, textura e animações do rig de 16 ossos"
    },
    mocap: {
      nome: "Mocap Pack 06 — Fitness and Workout",
      autor: "não declarado no pacote",
      licenca: "não verificada",
      uso: "animações retargetadas; publicação condicionada à licença do titular"
    },
    three: { nome: "three.js", licenca: "MIT" }
  }
};

const destino = path.join(assetsDir, "catalogo.json");
fs.writeFileSync(destino, JSON.stringify(catalogo, null, 2) + "\n");

const total = clipes.reduce((soma, c) => soma + c.bytes, 0);
console.log(`[catálogo] ${clipes.length} clipes, ${Object.keys(personagens).length} personagens, ` +
  `${(total / 1024).toFixed(0)} KB de animações, ${indisponiveis.length} indisponíveis`);
for (const faltando of indisponiveis) console.log(`[catálogo] INDISPONÍVEL ${faltando.id} (${faltando.motivo})`);
