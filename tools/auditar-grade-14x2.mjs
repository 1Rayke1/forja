#!/usr/bin/env node
/*
  FORJA — auditoria final da grade 14 exercícios × 2 personagens.

  Cruza, para cada uma das 28 células da grade:
    - manifesto (assets/3d/apresentacao-exercicios.json)
    - hashes finais dos MP4 (docs/.../hashes-finais.json)
    - validador offline (validacao-offline.json)
    - decodificação/reprodução em Chromium real (validacao-chromium.json)
    - comparação com o WebGL oficial nos mesmos instantes (comparacao-webgl.json)

  Não altera nenhum vídeo, modelo, material, luz, animação ou normal.

  Uso: node tools/auditar-grade-14x2.mjs
  Saída: docs/.../auditoria-grade-14x2.json e .md
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(raiz, "docs", "validacao-3d", "correcao-videos-28");
const ler = arquivo => JSON.parse(fs.readFileSync(path.join(DIR, arquivo), "utf8"));
const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, "assets/3d/apresentacao-exercicios.json"), "utf8"));
const hashes = ler("hashes-finais.json");
const offline = ler("validacao-offline.json");
const chromium = ler("validacao-chromium.json");
const webgl = ler("comparacao-webgl.json");

const porChave = (lista) => new Map(lista.map(v => [`${v.exercicioId}/${v.personagem}`, v]));
const vidOffline = porChave(offline.videos);
const vidChromium = porChave(chromium.videos);
const cmpWebGL = porChave(webgl.resultados);

const soChecagens = v => Object.values(v.checagens || {}).every(Boolean);
const linhas = [];
for (const exercicio of manifesto.exercicios.filter(e => e.modo === "video")) {
  const celulas = [];
  for (const personagem of ["masculino", "feminino"]) {
    const arquivo = exercicio.video[personagem].arquivo;
    const chave = `${exercicio.id}/${personagem}`;
    const of = vidOffline.get(chave), cr = vidChromium.get(chave), gl = cmpWebGL.get(chave);
    const final = hashes.arquivos[arquivo];
    const meta = of?.entrada?.meta || {};
    const ious = gl?.instantes.map(i => i.iouSilhueta) || [];
    celulas.push({
      personagem, arquivo,
      sha256Final: final?.sha256 || null,
      bytes: final?.bytes || meta.bytes || null,
      resolucao: `${meta.largura || "?"}x${meta.altura || "?"}`,
      fps: meta.fps ?? cr?.fpsDeclaradoNoArquivo ?? null,
      duracaoS: meta.duracaoS ?? cr?.medido?.duracao ?? null,
      codec: meta.codec || null,
      semAudio: meta.temAudio === false,
      mudouAposCorrecao: final?.mudouAposCorrecao ?? null,
      offlineAprovado: !!of && soChecagens(of),
      chromiumAprovado: !!cr && soChecagens(cr),
      quadrosApresentados: cr?.medido?.quadrosQualidade?.total ?? null,
      desvioQuadrosVsDuracao: (cr?.medido?.quadrosQualidade?.total != null && cr?.medido?.duracao != null)
        ? Math.abs(cr.medido.quadrosQualidade.total - Math.round(cr.medido.duracao * 30)) : null,
      iouWebGL: ious,
      iouMedioWebGL: ious.length ? Number((ious.reduce((a, b) => a + b, 0) / ious.length).toFixed(3)) : null,
    });
  }
  linhas.push({
    exercicioId: exercicio.id,
    clipeId: exercicio.clipeId,
    completo: celulas.every(c => c.sha256Final && c.offlineAprovado && c.chromiumAprovado && c.mudouAposCorrecao === true),
    celulas,
  });
}

const todos = linhas.flatMap(l => l.celulas);
const resumo = {
  exercicios: linhas.length,
  personagens: 2,
  celulas: todos.length,
  linhasCompletas: linhas.filter(l => l.completo).length,
  todasAsLinhasCompletas: linhas.every(l => l.completo),
  todosForamRerenderizados: todos.every(c => c.mudouAposCorrecao === true),
  todosAprovadosOffline: todos.every(c => c.offlineAprovado),
  todosAprovadosChromium: todos.every(c => c.chromiumAprovado),
  todosSemAudio: todos.every(c => c.semAudio),
  todos1280x720a30: todos.every(c => c.resolucao === "1280x720" && c.fps === 30),
  desvioMaximoQuadros: Math.max(...todos.map(c => c.desvioQuadrosVsDuracao ?? 0)),
  iouMedioGeral: Number((todos.reduce((s, c) => s + (c.iouMedioWebGL || 0), 0) / todos.length).toFixed(3)),
  manifesto: { totalExercicios: manifesto.resumo.totalExercicios, comVideoPronto: manifesto.resumo.comVideoPronto },
};
const auditoria = {
  geradoEm: new Date().toISOString(),
  fontes: [
    "assets/3d/apresentacao-exercicios.json", "hashes-finais.json",
    "validacao-offline.json", "validacao-chromium.json", "comparacao-webgl.json",
  ],
  resumo,
  linhas,
};
fs.writeFileSync(path.join(DIR, "auditoria-grade-14x2.json"), JSON.stringify(auditoria, null, 2) + "\n");

const md = [
  "# Auditoria final — grade 14 exercícios × 2 personagens",
  "",
  `Gerado em ${auditoria.geradoEm}.`,
  "",
  `**${resumo.celulas} células / ${resumo.linhasCompletas} linhas completas** — manifesto: ${resumo.manifesto.totalExercicios} exercícios, ${resumo.manifesto.comVideoPronto} com vídeo pronto.`,
  "",
  "| # | Exercício | Personagem | MP4 | sha256 (8) | Bytes | Resolução | FPS | Duração | Re-render | Offline | Chromium | IoU WebGL (I/M/F) |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
];
linhas.forEach((l, i) => l.celulas.forEach(c => md.push(
  `| ${String(i + 1).padStart(2, "0")} | ${l.exercicioId} | ${c.personagem} | \`${path.basename(c.arquivo)}\` | \`${(c.sha256Final || "").slice(0, 8)}\` | ${c.bytes} | ${c.resolucao} | ${c.fps} | ${c.duracaoS} | ${c.mudouAposCorrecao ? "sim" : "NÃO"} | ${c.offlineAprovado ? "OK" : "FALHA"} | ${c.chromiumAprovado ? "OK" : "FALHA"} | ${c.iouWebGL.join(" / ")} |`
)));
md.push("", "## Resumo", "", "```json", JSON.stringify(resumo, null, 2), "```", "");
fs.writeFileSync(path.join(DIR, "auditoria-grade-14x2.md"), md.join("\n"));
console.log(JSON.stringify(resumo, null, 2));
