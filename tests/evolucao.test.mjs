/*
  Testes da tela de Evolução (progresso/index.html) em jsdom com as páginas
  reais do repositório.

  O que fica coberto aqui:

  - a interface nova existe na rota antiga (cabeçalho "Seu Progresso", abas,
    indicadores, filtro de período, grupos musculares, incentivo, barra);
  - as três abas são funcionais e trocam o painel visível;
  - indicadores de treinos, consistência e calorias usam apenas dados reais e
    dizem o que falta quando não há dado;
  - o filtro de 7/30/90/tudo muda o gráfico de verdade;
  - o cartão de grupos musculares usa o catálogo central e não inventa grupo
    para exercício desconhecido;
  - abrir a tela não grava nada;
  - o CSS novo existe, é o último a carregar e tem regras de 390 px e desktop.
*/
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { boot, assertNoErrors, repoRoot, wait } from "./helpers/harness.mjs";

const PAGE = "progresso/index.html";
let passed = 0;
const failures = [];

async function runTest(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("✅ " + name);
  } catch (error) {
    failures.push({ name, error });
    console.log("❌ " + name);
    console.log("   " + String(error && error.message ? error.message : error).split("\n").join("\n   "));
  }
}

/* ------------------------------------------------------------------ */
/* Dados de teste                                                      */
/* ------------------------------------------------------------------ */

function keyOf(date) {
  const two = value => String(value).padStart(2, "0");
  return date.getFullYear() + "-" + two(date.getMonth() + 1) + "-" + two(date.getDate());
}

function dayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function seedLog(extra = {}) {
  return Object.assign({ set: 1, reps: "", load: "", seconds: 0, distance: null, rpe: null, editedAt: null }, extra);
}

function seedExercise(libraryId, name, logs, extra = {}) {
  return Object.assign({
    id: "ex-" + name.toLowerCase().replace(/\s+/g, "-"),
    libraryId,
    name,
    section: "main",
    plannedSets: logs.length,
    completedSets: logs.length,
    reps: "10",
    duration: 45,
    type: "reps",
    rest: 60,
    load: "",
    notes: "",
    distance: null,
    distanceUnit: "m",
    logs,
    timedSeconds: logs.reduce((sum, entry) => sum + (Number(entry.seconds) || 0), 0)
  }, extra);
}

function seedRecord(date, exercises, extra = {}) {
  const completedSets = exercises.reduce((sum, exercise) => sum + exercise.completedSets, 0);

  return Object.assign({
    id: "seed-" + keyOf(date) + "-" + Math.random().toString(36).slice(2, 8),
    date: keyOf(date),
    finishedAt: date.toISOString(),
    modality: "weights",
    routineName: "Treino de teste",
    durationMs: 30 * 60000,
    completedSets,
    totalPlannedSets: completedSets,
    status: "completed",
    exercises,
    feedback: { rpe: null, note: "" }
  }, extra);
}

const PROFILE = {
  version: 3,
  updatedAt: "2026-10-01T00:00:00.000Z",
  objetivo: "manterForma",
  nivel: "iniciante",
  equipamento: "casa",
  diasPorSemana: 3,
  pesoKg: 80
};

function threeSessions() {
  return [
    seedRecord(dayOffset(-1), [seedExercise("mus-supino-reto", "Supino reto com barra", [seedLog({ reps: "10", load: "40 kg" })])]),
    seedRecord(dayOffset(-8), [seedExercise("mus-remada-curvada", "Remada curvada com barra", [seedLog({ reps: "10", load: "30 kg" })])]),
    seedRecord(dayOffset(-20), [seedExercise("mus-agachamento-barra", "Agachamento com barra", [seedLog({ reps: "12", load: "50 kg" })])])
  ];
}

/* ------------------------------------------------------------------ */
/* 1. Estrutura da tela nova                                           */
/* ------------------------------------------------------------------ */

await runTest("E1. A rota antiga mostra a interface nova de Evolução", async () => {
  const app = await boot({}, PAGE);
  await wait(30);

  assert.equal(app.d.body.dataset.page, "progresso", "data-page mudou");
  assert.match(app.text("h1"), /Seu Progresso/, "Cabeçalho 'Seu Progresso' ausente");
  assert.equal(app.d.querySelectorAll("h1").length, 1, "A tela deve ter um único h1");

  const tabs = app.$$(".ev-tab").map(button => button.textContent.trim());
  assert.equal(tabs.length, 3, "A tela precisa de três abas");
  assert.deepEqual(tabs, ["Visão Geral", "Músculos", "Histórico"], "Abas com nomes errados");

  const kpIs = app.$$("#ev-kpis .ev-kpi").map(card => card.getAttribute("data-kpi") || card.textContent);
  assert.equal(kpIs.length, 3, "A tela precisa de três indicadores");
  assert.ok(app.$("#ev-kpi-sessions"), "Indicador de treinos ausente");
  assert.ok(app.$("#ev-kpi-consistency"), "Indicador de consistência ausente");
  assert.ok(app.$("#ev-kpi-calories"), "Indicador de calorias ausente");

  const periods = app.$$("#ev-period [data-period]").map(button => button.getAttribute("data-period"));
  assert.deepEqual(periods, ["7", "30", "90", "all"], "Filtro de período incompleto");

  assert.ok(app.$("#ev-chart"), "Gráfico de evolução ausente");
  assert.ok(app.$("#ev-muscles"), "Cartão de grupos musculares ausente");
  assert.ok(app.$("#ev-muscle-list"), "Lista de grupos musculares ausente");
  assert.ok(app.$("#ev-nudge-title") && app.$("#ev-nudge-text"), "Mensagem de incentivo ausente");

  /* Barra inferior: cinco destinos, Evolução marcada. */
  const nav = app.$('.bottom-nav [data-nav="progresso"]');
  assert.ok(nav, "Barra inferior sem o item Evolução");
  assert.equal(nav.getAttribute("aria-current"), "page", "Evolução deveria estar marcada");
  assert.equal(app.$$(".bottom-nav .bottom-nav-link").length, 5, "A barra precisa manter cinco itens");

  /* Nenhuma seção antiga foi perdida de vista. */
  ["progress-sessions", "progress-frequency", "progress-weekly", "progress-compare", "progress-records",
    "progress-routines", "progress-exercises", "progress-history", "goals-form", "evolution-select",
    "period-control", "period-from", "period-to"].forEach(id => {
    assert.ok(app.$("#" + id), "Bloco antigo perdido: #" + id);
  });

  assertNoErrors(app, "tela nova");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 2. Abas funcionais                                                  */
/* ------------------------------------------------------------------ */

await runTest("E2. As três abas trocam o painel visível e sobrevivem na URL", async () => {
  const app = await boot({}, PAGE);
  await wait(30);

  const visible = name => {
    const panel = app.$("#ev-panel-" + name);
    return Boolean(panel) && !panel.hidden;
  };

  assert.ok(visible("overview"), "Visão Geral deveria abrir selecionada");
  assert.equal(visible("muscles"), false, "Músculos não deveria começar visível");
  assert.equal(app.$("#ev-tab-overview").getAttribute("aria-selected"), "true");

  app.$("#ev-tab-muscles").click();
  await wait(20);
  assert.ok(visible("muscles"), "Aba Músculos não abriu");
  assert.equal(visible("overview"), false, "Visão Geral deveria esconder ao trocar de aba");
  assert.equal(app.$("#ev-tab-muscles").getAttribute("aria-selected"), "true");
  assert.equal(app.$("#ev-tab-overview").getAttribute("aria-selected"), "false");
  assert.match(app.w.location.search, /aba=muscles/, "A aba não foi para a URL");

  app.$("#ev-tab-history").click();
  await wait(20);
  assert.ok(visible("history"), "Aba Histórico não abriu");
  assert.equal(app.w.location.search.includes("aba=history"), true);

  app.$("#ev-tab-overview").click();
  await wait(20);
  assert.ok(visible("overview"), "Não voltou para Visão Geral");
  assert.equal(app.w.location.search.includes("aba="), false, "A URL deveria ficar limpa na aba padrão");

  assertNoErrors(app, "abas");
  app.close();

  /* A aba pedida na URL abre direto. */
  const direct = await boot({}, PAGE + "?aba=muscles");
  await wait(30);
  assert.equal(direct.$("#ev-panel-muscles").hidden, false, "Aba da URL não abriu");
  assert.equal(direct.$("#ev-panel-overview").hidden, true);
  direct.close();
});

/* ------------------------------------------------------------------ */
/* 3. Indicadores                                                      */
/* ------------------------------------------------------------------ */

await runTest("E3. Indicadores usam treinos reais, consistência do perfil e calorias declaradas", async () => {
  const records = threeSessions();
  const app = await boot({ "forja-treino-historico-v1": records, "forja-perfil-v1": PROFILE }, PAGE);
  await wait(30);

  /* Período inicial é 30 dias: os três treinos caem dentro da janela. */
  assert.equal(app.$("#ev-period [data-period='30']").getAttribute("aria-pressed"), "true", "30 dias deveria ser o padrão");
  assert.equal(app.text("#ev-kpi-sessions"), "3", "Treinos do período errados");

  /*
    Consistência = dias treinados ÷ dias planejados. 3 dias por semana em 30
    dias são 12,86 dias previstos → 3/12,86 = 23%.
  */
  assert.equal(app.text("#ev-kpi-consistency"), "23%", "Consistência não segue dias planejados do perfil");
  assert.match(app.text("#ev-kpi-consistency-delta"), /3 de 13 dias planejados/);
  assert.match(app.text("#ev-kpi-note"), /dias planejados/i);

  /*
    Calorias: MET 5 × 3,5 × 80 kg / 200 × 90 min = 630. A conta é a mesma
    já publicada na home e o texto diz que é estimativa.
  */
  assert.equal(app.text("#ev-kpi-calories"), "630", "Calorias estimadas erradas");
  assert.match(app.text("#ev-kpi-calories-delta"), /MET 5 · 90 min/);
  assert.match(app.text("#ev-kpi-note"), /não mede calorias/i);

  assertNoErrors(app, "indicadores");
  app.close();
});

await runTest("E4. Sem peso no perfil, calorias mostram “—” e o motivo", async () => {
  const profile = Object.assign({}, PROFILE);
  delete profile.pesoKg;

  const app = await boot({ "forja-treino-historico-v1": threeSessions(), "forja-perfil-v1": profile }, PAGE);
  await wait(30);

  assert.equal(app.text("#ev-kpi-calories"), "—", "Sem peso não deveria existir número de calorias");
  assert.match(app.text("#ev-kpi-calories-delta"), /peso no perfil/i);

  app.close();
});

await runTest("E5. Sem dias por semana no perfil, consistência mostra “—” em vez de base inventada", async () => {
  const profile = Object.assign({}, PROFILE, { diasPorSemana: 0 });

  const app = await boot({ "forja-treino-historico-v1": threeSessions(), "forja-perfil-v1": profile }, PAGE);
  await wait(30);

  assert.equal(app.text("#ev-kpi-consistency"), "—", "Sem dias planejados não existe denominador");
  assert.match(app.text("#ev-kpi-consistency-delta"), /dias por semana/i);

  app.close();
});

await runTest("E6. Histórico vazio: indicadores zerados, estado vazio e incentivo de primeiro treino", async () => {
  const app = await boot({}, PAGE);
  await wait(30);

  assert.equal(app.text("#ev-kpi-sessions"), "0");
  assert.equal(app.text("#ev-kpi-consistency"), "0%");
  assert.equal(app.text("#ev-kpi-calories"), "—");
  assert.match(app.text("#ev-chart"), /Ainda sem treinos registrados/);
  assert.match(app.text("#ev-muscle-list"), /Nenhum grupo muscular/);
  assert.match(app.text("#ev-nudge-title"), /começa no primeiro treino/);
  assert.match(app.text("#ev-nudge-text"), /dados reais/);

  /* Nada de recordes inventados. */
  assert.match(app.text("#progress-records"), /Nenhum recorde medido ainda/i);

  assertNoErrors(app, "estado vazio");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 4. Gráfico com período                                              */
/* ------------------------------------------------------------------ */

await runTest("E7. Filtro de período muda o gráfico e o total mostrado", async () => {
  const records = [
    seedRecord(dayOffset(-2), [seedExercise("mus-supino-reto", "Supino reto com barra", [seedLog({ reps: "10", load: "40 kg" })])]),
    seedRecord(dayOffset(-20), [seedExercise("mus-supino-reto", "Supino reto com barra", [seedLog({ reps: "8", load: "35 kg" })])]),
    seedRecord(dayOffset(-70), [seedExercise("mus-supino-reto", "Supino reto com barra", [seedLog({ reps: "8", load: "30 kg" })])])
  ];

  const app = await boot({ "forja-treino-historico-v1": records }, PAGE);
  await wait(30);

  /* 30 dias: dois treinos. */
  assert.equal(app.text("#ev-chart-total"), "2 treinos", "Janela de 30 dias errada");
  assert.equal(app.$$("#ev-chart .ui-column").length, 10, "O gráfico de 30 dias deveria ter 10 colunas");

  app.$("#ev-period [data-period='7']").click();
  await wait(20);
  assert.equal(app.text("#ev-chart-total"), "1 treino", "Janela de 7 dias errada");
  assert.equal(app.$$("#ev-chart .ui-column").length, 7, "O gráfico de 7 dias deveria ter 7 colunas");
  assert.equal(app.$("#ev-period [data-period='7']").getAttribute("aria-pressed"), "true");
  assert.equal(app.$("#ev-period [data-period='30']").getAttribute("aria-pressed"), "false");

  app.$("#ev-period [data-period='90']").click();
  await wait(20);
  assert.equal(app.text("#ev-chart-total"), "3 treinos", "Janela de 90 dias errada");
  assert.equal(app.$$("#ev-chart .ui-column").length, 13, "O gráfico de 90 dias deveria ter 13 colunas");

  app.$("#ev-period [data-period='all']").click();
  await wait(20);
  assert.equal(app.text("#ev-chart-total"), "3 treinos", "Todo o histórico deveria somar os três treinos");
  assert.match(app.text("#ev-chart-note"), /Todo o histórico/i);

  /* O gráfico nunca desenha sem dado: as colunas zeradas continuam reais. */
  assert.ok(app.$$("#ev-chart .ui-column-value").every(node => /^\d+$/.test(node.textContent.trim())),
    "Colunas deveriam mostrar contagens inteiras");

  assertNoErrors(app, "período");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 5. Grupos musculares                                                */
/* ------------------------------------------------------------------ */

await runTest("E7b. O período é único: o controle compacto dos músculos acompanha o do gráfico", async () => {
  const records = [
    seedRecord(dayOffset(-2), [seedExercise("mus-supino-reto", "Supino reto com barra", [seedLog({ reps: "10", load: "40 kg" })])]),
    seedRecord(dayOffset(-60), [seedExercise("mus-remada-curvada", "Remada curvada com barra", [seedLog({ reps: "10", load: "30 kg" })])])
  ];

  const app = await boot({ "forja-treino-historico-v1": records }, PAGE);
  await wait(30);

  const compacto = () => app.$$("#ev-panel-muscles .ev-period [data-period]");
  assert.equal(compacto().length, 4, "A aba Músculos precisa do próprio seletor de período");

  /* Em 30 dias só o supino (peitoral) entra. */
  const grupos30 = app.$$("#ev-muscle-list .ev-muscle-name").map(node => node.textContent);
  assert.deepEqual(grupos30, ["Peitoral"]);

  const tudo = compacto().find(button => button.getAttribute("data-period") === "all");
  tudo.click();
  await wait(30);

  /* Com uma série cada, o desempate é alfabético: Costas antes de Peitoral. */
  const gruposTudo = app.$$("#ev-muscle-list .ev-muscle-name").map(node => node.textContent);
  assert.deepEqual(gruposTudo, ["Costas", "Peitoral"], "O período compacto não recalculou os grupos");
  assert.equal(tudo.getAttribute("aria-pressed"), "true", "O botão compacto não ficou marcado");
  assert.equal(app.$("#ev-period [data-period='all']").getAttribute("aria-pressed"), "true",
    "O controle do gráfico deveria refletir o mesmo período");
  assert.match(app.text("#ev-chart-note"), /Todo o histórico/i);

  app.close();
});

await runTest("E8. Grupos musculares vêm do catálogo, com percentual sobre séries reais", async () => {
  const records = [
    seedRecord(dayOffset(-1), [
      seedExercise("mus-supino-reto", "Supino reto com barra", [seedLog({ reps: "10", load: "40 kg" }), seedLog({ set: 2, reps: "10", load: "40 kg" })]),
      seedExercise("mus-remada-curvada", "Remada curvada com barra", [seedLog({ reps: "10", load: "30 kg" })])
    ])
  ];

  const app = await boot({ "forja-treino-historico-v1": records, "forja-perfil-v1": PROFILE }, PAGE);
  await wait(30);

  const rows = app.$$("#ev-muscle-list .ev-muscle-row");
  assert.equal(rows.length, 2, "Deveria listar peitoral e costas");

  const names = rows.map(row => row.querySelector(".ev-muscle-name").textContent);
  assert.deepEqual(names, ["Peitoral", "Costas"], "Grupos fora da ordem por volume: " + names.join(", "));

  /* 2 séries de supino (peitoral) + 1 de remada (costas) = 67% / 33%. */
  assert.equal(rows[0].querySelector(".ev-muscle-share").textContent, "67%");
  assert.equal(rows[1].querySelector(".ev-muscle-share").textContent, "33%");
  assert.match(app.text("#ev-muscles-total"), /3 séries/);
  assert.match(app.text("#ev-muscles-note"), /exercícios do catálogo/i);

  /* Ilustração anatômica: duas vistas, com destaque nas regiões certas. */
  const svgs = app.$$("#ev-muscles-figure svg.figura-svg");
  assert.equal(svgs.length, 2, "A ilustração precisa das duas vistas");
  assert.ok(app.$("#ev-muscles-figure .figura-region.is-primary"), "Nenhuma região destacada como principal");
  assert.ok(app.$("#ev-muscles-figure .atlas-figura-cell[data-view='back']"), "Vista posterior ausente");

  assertNoErrors(app, "grupos musculares");
  app.close();
});

await runTest("E9. Exercício fora do catálogo não vira grupo muscular inventado", async () => {
  const records = [
    seedRecord(dayOffset(-1), [
      seedExercise("", "Exercício personalizado do usuário", [seedLog({ reps: "10" })]),
      seedExercise("mus-rosca-direta", "Rosca direta", [seedLog({ reps: "12", load: "12 kg" })])
    ])
  ];

  const app = await boot({ "forja-treino-historico-v1": records }, PAGE);
  await wait(30);

  const names = app.$$("#ev-muscle-list .ev-muscle-name").map(node => node.textContent);
  assert.deepEqual(names, ["Bíceps"], "Só o exercício do catálogo deveria entrar: " + names.join(", "));
  assert.match(app.text("#ev-muscles-note"), /sem correspondência no catálogo/i);

  app.close();
});

/* ------------------------------------------------------------------ */
/* 6. Incentivo dinâmico                                               */
/* ------------------------------------------------------------------ */

await runTest("E10. Mensagem de incentivo acompanha a meta semanal salva", async () => {
  const today = dayOffset(0);
  const records = [
    seedRecord(today, [seedExercise("mus-supino-reto", "Supino reto com barra", [seedLog({ reps: "10", load: "40 kg" })])])
  ];

  /* Sem meta: convite para definir uma. */
  const semMeta = await boot({ "forja-treino-historico-v1": records }, PAGE);
  await wait(30);
  assert.match(semMeta.text("#ev-nudge-title"), /nesta semana|Último treino/i);
  semMeta.close();

  /* Com meta de 3 e 1 treino feito: faltam 2. */
  const comMeta = await boot({
    "forja-treino-historico-v1": records,
    "forja-treino-metas-v1": { weeklySessions: 3, weeklySets: 0, weeklyMinutes: 0, modality: "all", updatedAt: "2026-10-01T00:00:00.000Z" }
  }, PAGE);
  await wait(30);
  assert.match(comMeta.text("#ev-nudge-title"), /Faltam 2 treinos para a meta da semana/);
  assert.match(comMeta.text("#ev-nudge-text"), /1 de 3 treinos/);
  comMeta.close();

  /* Meta batida. */
  const batida = await boot({
    "forja-treino-historico-v1": records,
    "forja-treino-metas-v1": { weeklySessions: 1, weeklySets: 0, weeklyMinutes: 0, modality: "all", updatedAt: "2026-10-01T00:00:00.000Z" }
  }, PAGE);
  await wait(30);
  assert.match(batida.text("#ev-nudge-title"), /Meta da semana batida/);
  batida.close();
});

/* ------------------------------------------------------------------ */
/* 7. Nada é gravado e o filtro de modalidade continua valendo         */
/* ------------------------------------------------------------------ */

await runTest("E11. Abrir a tela e trocar de aba não grava nada no armazenamento", async () => {
  const app = await boot({ "forja-treino-historico-v1": threeSessions() }, PAGE);
  await wait(30);

  assert.deepEqual(app.storageWrites, [], "Abrir a Evolução gravou no storage");

  app.$("#ev-tab-muscles").click();
  await wait(20);
  app.$("#ev-period [data-period='all']").click();
  await wait(20);
  app.$("#ev-tab-history").click();
  await wait(20);

  assert.deepEqual(app.storageWrites, [], "Interagir com a Evolução gravou no storage");
  app.close();
});

await runTest("E12. Filtro de modalidade do resumo também vale para os indicadores novos", async () => {
  const records = [
    seedRecord(dayOffset(-1), [seedExercise("mus-supino-reto", "Supino reto com barra", [seedLog({ reps: "10", load: "40 kg" })])], { modality: "weights" }),
    seedRecord(dayOffset(-2), [seedExercise("cal-flexao", "Flexão de braço", [seedLog({ reps: "15" })])], { modality: "calisthenics" })
  ];

  const app = await boot({ "forja-treino-historico-v1": records }, PAGE);
  await wait(30);
  assert.equal(app.text("#ev-kpi-sessions"), "2", "Sem filtro deveriam existir dois treinos");

  app.$('[data-filter="weights"]').click();
  await wait(30);
  assert.equal(app.text("#ev-kpi-sessions"), "1", "O indicador não acompanhou o filtro de modalidade");
  assert.equal(app.text("#progress-sessions"), "1", "O resumo antigo deveria acompanhar o mesmo filtro");

  assertNoErrors(app, "filtro de modalidade");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 8. Folha de estilo nova                                             */
/* ------------------------------------------------------------------ */

await runTest("E13. A folha nova de Evolução carrega por último e cobre celular e desktop", async () => {
  const file = path.join(repoRoot, "assets", "css", "progresso-evolucao.css");
  assert.ok(fs.existsSync(file), "assets/css/progresso-evolucao.css não existe");

  const app = await boot({}, PAGE);
  await wait(20);

  const sheets = app.$$('link[rel="stylesheet"]').map(link => link.getAttribute("href"));
  assert.equal(sheets[sheets.length - 1], "../assets/css/progresso-evolucao.css",
    "A folha da Evolução precisa carregar depois das outras: " + sheets.join(", "));

  const css = fs.readFileSync(file, "utf8");
  assert.match(css, /@media \(min-width: 760px\)/, "Falta o ajuste de desktop");
  assert.match(css, /@media \(max-width: 360px\)/, "Falta o ajuste de tela pequena");
  assert.match(css, /body\[data-page="progresso"\]/, "As regras precisam ficar escopadas na página");
  assert.match(css, /prefers-reduced-motion/, "Falta respeitar redução de movimento");
  assert.doesNotMatch(css, /\bemoji\b/i, "Nada de emoji no CSS");

  app.close();
});

/* ------------------------------------------------------------------ */

console.log("\n==================================================================");
console.log("EVOLUÇÃO (TELA NOVA) — " + passed + "/" + (passed + failures.length) + " testes aprovados");
console.log("==================================================================");

if (failures.length > 0) {
  failures.forEach(failure => {
    console.log("❌ " + failure.name);
    console.log(failure.error && failure.error.stack ? failure.error.stack : failure.error);
  });
  process.exit(1);
}
