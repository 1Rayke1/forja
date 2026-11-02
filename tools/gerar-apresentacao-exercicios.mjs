#!/usr/bin/env node
/*
  FORJA — gera o manifesto da tela de apresentação dos exercícios.

  Fonte única (nenhum dado duplicado à mão):
    - assets/js/forja-biblioteca.js  → exercícios sugeridos (nome, modalidade, seção)
    - assets/3d/catalogo.json        → clipes, arquivos por personagem, mapeamento exato
    - assets/3d/animacoes/*.glb      → auditoria real de fechamento do loop
    - assets/videos/exercicios/       → vídeos horizontais 16:9 já entregues (se houver)

  Regra de mapeamento:
    Só usa correspondência EXATA exercício → clipe. O fallback por grupo muscular
    do painel interativo NÃO é usado aqui: mostrar o abdominal em outro exercício
    seria reutilizar o movimento errado, justamente o que a etapa proíbe.

  Saída:
    assets/3d/apresentacao-exercicios.json

  Uso:
    node tools/gerar-apresentacao-exercicios.mjs
    node tools/gerar-apresentacao-exercicios.mjs --check
*/

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { auditarDiretorio } from "./lib/loop-3d.mjs";
import { lerMP4 } from "./lib/probe-mp4.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAMINHO_SAIDA = path.join(raiz, "assets", "3d", "apresentacao-exercicios.json");
const DIR_VIDEOS = path.join(raiz, "assets", "videos", "exercicios");
const CAMINHO_CATALOGO = path.join(raiz, "assets", "3d", "catalogo.json");
const DIR_ANIMACOES = path.join(raiz, "assets", "3d", "animacoes");
const CAMINHO_BIBLIOTECA = path.join(raiz, "assets", "js", "forja-biblioteca.js");

const ESPECIFICACAO = Object.freeze({
  proporcao: "16:9",
  largura: 1280,
  altura: 720,
  fps: 30,
  fundo: "#121010",
  orientacao: "horizontal",
  camera: {
    perspectiva: "3/4",
    angulo: "próximo da lateral",
    azimuteGraus: -58,
    elevacaoGraus: 22,
    campoVisaoVerticalGraus: 32,
    margemEnquadramento: 0.09
  },
  loop: "infinito",
  audio: false,
  controles: false,
  autoplay: true,
  reproduzirInline: true
});

function lerBiblioteca() {
  const codigo = fs.readFileSync(CAMINHO_BIBLIOTECA, "utf8");
  const sandbox = { window: { Forja: {} }, Object, console };
  vm.runInNewContext(codigo, sandbox, { filename: CAMINHO_BIBLIOTECA });
  const biblioteca = sandbox.window.Forja.EXERCISE_LIBRARY;
  if (!biblioteca) throw new Error("forja-biblioteca.js não definiu EXERCISE_LIBRARY");
  return biblioteca;
}

function modalidadeDe(secao) {
  return secao === "weights" ? "musculacao" : "calistenia";
}

function arquivoDoClipe(clipe, personagem) {
  const variante = clipe.arquivos && clipe.arquivos[personagem];
  return (variante && variante.arquivo) || clipe.arquivo || "";
}

function verificarVideo(relativo) {
  const absoluto = path.join(raiz, relativo);
  if (!fs.existsSync(absoluto)) return null;

  let meta;
  try {
    meta = lerMP4(absoluto);
    /* O manifesto é publicado e verificado em qualquer worktree. O caminho
       absoluto do ambiente de geração não pode entrar no JSON, senão um
       `--check` em outra árvore acusa diferença sem nenhuma mudança real. */
    meta.arquivo = relativo;
  } catch (erro) {
    return {
      arquivo: relativo,
      status: "invalido",
      motivo: "MP4 ilegível: " + erro.message,
      meta: null
    };
  }

  const motivos = [];
  if (!meta.temVideo) motivos.push("sem trilha de vídeo");
  if (meta.largura !== ESPECIFICACAO.largura || meta.altura !== ESPECIFICACAO.altura) {
    motivos.push("resolução " + meta.largura + "×" + meta.altura);
  }
  if (meta.fps === null || Math.abs(meta.fps - ESPECIFICACAO.fps) > 0.05) {
    motivos.push("FPS " + meta.fps);
  }
  if (meta.proporcao === null || Math.abs(meta.proporcao - 16 / 9) > 0.002) {
    motivos.push("proporção " + meta.proporcao);
  }
  if (meta.temAudio) motivos.push("trilha de áudio presente");

  return {
    arquivo: relativo,
    status: motivos.length ? "incompativel" : "pronto",
    motivo: motivos.length ? motivos.join("; ") : null,
    meta
  };
}

function candidatosDeVideo(exercicioId, personagem) {
  const lista = [];
  const principal = path.join("assets", "videos", "exercicios",
    exercicioId + "-" + personagem + "-horizontal-16x9.mp4");
  lista.push(principal.replaceAll(path.sep, "/"));
  return lista;
}

function videosLegados(exercicioId, personagem) {
  const lista = [];
  if (exercicioId === "cal-abdominal-supra" && personagem === "masculino") {
    lista.push("avaliacao-piloto-3d/midia/abdominal-masculino-horizontal-16x9.mp4");
    lista.push("docs/validacao-3d/piloto-abdominal-masculino/abdominal-masculino-horizontal-16x9.mp4");
  }
  return lista;
}

function montar() {
  const biblioteca = lerBiblioteca();
  const catalogo = JSON.parse(fs.readFileSync(CAMINHO_CATALOGO, "utf8"));
  const auditoriaLoop = auditarDiretorio(DIR_ANIMACOES);

  const porId = new Map(catalogo.clipes.map(clipe => [clipe.id, clipe]));

  /*
    Um clipe atende no máximo UM exercício. O catálogo pode listar o mesmo
    clipe em mais de um exercício (ex.: prancha, elevação de pernas, caminhada),
    mas a apresentação não reutiliza movimento: o primeiro exercício da lista
    do catálogo fica com o clipe e os demais entram como pendência explícita.
  */
  const mapeados = new Map();
  const clipeUsadoPor = new Map();
  const conflitos = new Map();
  catalogo.clipes.forEach(clipe => {
    (clipe.exercicios || []).forEach(exercicioId => {
      if (mapeados.has(exercicioId)) return;
      if (clipeUsadoPor.has(clipe.id)) {
        if (!conflitos.has(exercicioId)) {
          conflitos.set(exercicioId, {
            clipeId: clipe.id,
            clipeNome: clipe.nome,
            usadoPor: clipeUsadoPor.get(clipe.id)
          });
        }
        return;
      }
      mapeados.set(exercicioId, clipe.id);
      clipeUsadoPor.set(clipe.id, exercicioId);
    });
  });

  const exercicios = [];

  ["calisthenics", "weights"].forEach(modalidade => {
    (biblioteca[modalidade] || []).forEach(item => {
      const clipeId = mapeados.get(item.id) || null;
      const clipeMapeado = clipeId ? porId.get(clipeId) : null;
      /*
        `status: "review"` é um clipe do catálogo que ainda precisa de revisão
        técnica — pode ser outro movimento (ex.: step jack para polichinelo).
        Ele NÃO vira demonstração final: entra como pendência explícita, para
        não apresentar biomecânica trocada como se fosse a do exercício.
      */
      const clipe = clipeMapeado && clipeMapeado.status === "exact" ? clipeMapeado : null;
      const clipeRevisao = clipeMapeado && clipeMapeado.status !== "exact" ? clipeMapeado : null;
      const conflito = conflitos.get(item.id) || null;
      const pendencias = [];
      const videos = { masculino: null, feminino: null };
      const videosLegadosPorPersonagem = { masculino: [], feminino: [] };
      const personagens = {};

      Object.keys(catalogo.personagens || {}).forEach(personagemId => {
        const dadosPersonagem = catalogo.personagens[personagemId];
        if (!clipe) {
          personagens[personagemId] = null;
          return;
        }
        const arquivoClipe = arquivoDoClipe(clipe, personagemId);
        personagens[personagemId] = {
          id: personagemId,
          modelo: dadosPersonagem.arquivo,
          clipe: arquivoClipe
        };

        const candidatos = candidatosDeVideo(item.id, personagemId);
        const encontrados = candidatos.map(verificarVideo).filter(Boolean);
        const pronto = encontrados.find(v => v.status === "pronto") || null;
        videos[personagemId] = pronto;
        if (!pronto && encontrados.length) {
          pendencias.push(
            "Vídeo " + personagemId + " incompatível: " +
            encontrados.map(v => v.arquivo + " (" + v.motivo + ")").join("; ")
          );
        }

        videosLegadosPorPersonagem[personagemId] = videosLegados(item.id, personagemId)
          .map(verificarVideo)
          .filter(Boolean);
      });

      if (clipeRevisao) {
        pendencias.push(
          "Clipe \"" + clipeRevisao.nome + "\" (" + clipeRevisao.id +
          ") está em revisão técnica (status review) e não é usado como demonstração final."
        );
      } else if (!clipe) {
        if (conflito) {
          pendencias.push(
            "O clipe \"" + conflito.clipeNome + "\" (" + conflito.clipeId +
            ") já é usado por outro exercício e não é reutilizado aqui."
          );
        } else {
          pendencias.push("Sem clipe 3D próprio mapeado neste exercício.");
        }
      }

      let modo = "pendente-animacao";
      if (clipe) modo = "previa-3d";
      const algumVideo = Object.values(videos).some(Boolean);
      if (algumVideo) modo = "video";

      const loopClipe = clipe ? auditoriaLoop.arquivos[path.basename(clipe.arquivo)] || null : null;

      exercicios.push({
        id: item.id,
        nome: item.name,
        modalidade,
        modalidadeRotulo: modalidade === "weights" ? "Musculação" : "Calistenia",
        secao: item.section,
        tipo: item.type,
        series: item.sets,
        repeticoes: item.reps || null,
        duracao: item.duration || null,
        clipeId: clipe ? clipe.id : null,
        clipeNome: clipe ? clipe.nome : null,
        clipeGrupo: clipe ? clipe.grupo : null,
        clipeQualidade: clipe ? clipe.status : null,
        clipeArquivo: clipe ? clipe.arquivo : null,
        duracaoClipeS: clipe ? clipe.duracaoS : null,
        fpsClipe: clipe ? clipe.fps : null,
        clipeRevisao: clipeRevisao
          ? {
              id: clipeRevisao.id,
              nome: clipeRevisao.nome,
              grupo: clipeRevisao.grupo,
              status: clipeRevisao.status,
              arquivo: clipeRevisao.arquivo,
              duracaoS: clipeRevisao.duracaoS,
              fps: clipeRevisao.fps,
              referencia: clipeRevisao.referencia || null,
              loop: auditoriaLoop.arquivos[path.basename(clipeRevisao.arquivo)]
                ? {
                    status: auditoriaLoop.arquivos[path.basename(clipeRevisao.arquivo)].status,
                    maxAngularGraus: auditoriaLoop.arquivos[path.basename(clipeRevisao.arquivo)].maxAngularGraus,
                    maxLinear: auditoriaLoop.arquivos[path.basename(clipeRevisao.arquivo)].maxLinear,
                    excecao: auditoriaLoop.arquivos[path.basename(clipeRevisao.arquivo)].excecao || null
                  }
                : null,
              motivo: "Clipe do catálogo em revisão técnica; não é a demonstração final do exercício."
            }
          : null,
        loop: loopClipe
          ? {
              status: loopClipe.status,
              maxAngularGraus: loopClipe.maxAngularGraus,
              maxLinear: loopClipe.maxLinear,
              excecao: loopClipe.excecao || null
            }
          : null,
        personagens,
        video: videos,
        videosLegados: videosLegadosPorPersonagem,
        modo,
        pendencias
      });
    });
  });

  const idsMapeados = new Set(exercicios.map(item => item.id));
  const clipesSemExercicio = catalogo.clipes
    .filter(clipe => !(clipe.exercicios || []).some(id => idsMapeados.has(id)))
    .map(clipe => ({
      id: clipe.id,
      nome: clipe.nome,
      grupo: clipe.grupo,
      status: clipe.status,
      arquivo: clipe.arquivo,
      duracaoS: clipe.duracaoS,
      loop: auditoriaLoop.arquivos[path.basename(clipe.arquivo)] || null
    }));

  /*
    Trava de segurança: se um clipe aparecer em dois exercícios (exato ou
    revisão), o gerador falha em vez de publicar reutilização silenciosa.
  */
  const usoPorClipe = new Map();
  exercicios.forEach(item => {
    [["clipeId", item.clipeId], ["clipeRevisao", item.clipeRevisao && item.clipeRevisao.id]].forEach(([campo, clipeId]) => {
      if (!clipeId) return;
      if (usoPorClipe.has(clipeId)) {
        throw new Error(
          "Clipe reutilizado: " + clipeId + " em " + usoPorClipe.get(clipeId) +
          " e " + item.id + " (" + campo + ")"
        );
      }
      usoPorClipe.set(clipeId, item.id);
    });
  });

  const conflitosDeClipe = [];
  conflitos.forEach((conflito, exercicioId) => {
    if (!idsMapeados.has(exercicioId)) return;
    conflitosDeClipe.push({
      exercicioId,
      clipeId: conflito.clipeId,
      clipeNome: conflito.clipeNome,
      usadoPor: conflito.usadoPor,
      motivo: "Movimento já usado por outro exercício; não é reutilizado."
    });
  });

  const resumo = {
    totalExercicios: exercicios.length,
    comClipe3d: exercicios.filter(item => Boolean(item.clipeId)).length,
    comClipeEmRevisao: exercicios.filter(item => Boolean(item.clipeRevisao)).length,
    semClipe3d: exercicios.filter(item => !item.clipeId).length,
    comVideoPronto: exercicios.filter(item => item.modo === "video").length,
    emPrevia3d: exercicios.filter(item => item.modo === "previa-3d").length,
    pendentesDeAnimacao: exercicios.filter(item => item.modo === "pendente-animacao").length,
    pendentesSemClipe: exercicios.filter(item => item.modo === "pendente-animacao" && !item.clipeRevisao).length,
    pendentesComClipeEmRevisao: exercicios.filter(item => item.modo === "pendente-animacao" && item.clipeRevisao).length,
    totalClipesAuditados: auditoriaLoop.resumo.total,
    clipesComLoopFechado: auditoriaLoop.resumo.fechados,
    clipesComAtencaoDeLoop: auditoriaLoop.resumo.atencao,
    clipesComFalhaDeLoop: auditoriaLoop.resumo.falhas,
    clipesSemExercicio: clipesSemExercicio.length
  };

  return {
    formato: "forja-apresentacao-exercicios",
    versao: 1,
    geradoEm: new Date().toISOString(),
    especificacao: ESPECIFICACAO,
    fontes: {
      catalogo: "assets/3d/catalogo.json",
      catalogoGeradoEm: catalogo.geradoEm || null,
      biblioteca: "assets/js/forja-biblioteca.js",
      animacoes: "assets/3d/animacoes/",
      videos: "assets/videos/exercicios/",
      auditoriaLoop
    },
    personagens: catalogo.personagens,
    mapeamento: {
      regra: "Cada clipe atende no máximo um exercício; nenhum movimento é reutilizado.",
      conflitos: conflitosDeClipe
    },
    exercicios,
    clipesSemExercicio,
    resumo
  };
}

const manifesto = montar();
const json = JSON.stringify(manifesto, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const atual = fs.existsSync(CAMINHO_SAIDA) ? fs.readFileSync(CAMINHO_SAIDA, "utf8") : "";
  const semData = texto => texto.replace(/"geradoEm": "[^"]+"/, '"geradoEm": ""');
  if (semData(atual) !== semData(json)) {
    console.error("Manifesto desatualizado. Rode: node tools/gerar-apresentacao-exercicios.mjs");
    process.exit(1);
  }
  console.log("Manifesto atualizado: " + manifesto.resumo.totalExercicios + " exercícios.");
} else {
  fs.mkdirSync(path.dirname(CAMINHO_SAIDA), { recursive: true });
  fs.writeFileSync(CAMINHO_SAIDA, json);
  console.log(
    "Gerado " + path.relative(raiz, CAMINHO_SAIDA) +
    ": " + manifesto.resumo.totalExercicios + " exercícios, " +
    manifesto.resumo.comClipe3d + " com clipe, " +
    manifesto.resumo.semClipe3d + " sem clipe."
  );
}
