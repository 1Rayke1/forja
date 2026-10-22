/*
  Testes do Atlas anatômico (explorar/atlas.html) e da integração com a
  biblioteca.

  Roda em jsdom sobre as páginas reais do repositório, com o mesmo harness
  multipágina de `forja.test.mjs`: clicar em um link troca de página e o
  localStorage é preservado, como no navegador.

  Cada teste cobre um requisito do pacote 3.1; a relação requisito → teste está
  em docs/atlas-anatomico.md.

  Uso: npm test (a suíte entra na cadeia) ou node tests/atlas.test.mjs
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertNoErrors,
  boot,
  closeAllApps,
  makeRoutine,
  repoRoot,
  routinesStore,
  wait
} from "./helpers/harness.mjs";

const results = [];

async function runTest(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("✅ " + name);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log("❌ " + name);
    console.log("   " + String(error && error.stack ? error.stack : error)
      .split("\n").slice(0, 12).join("\n   "));
  } finally {
    closeAllApps();
  }
}

async function until(predicate, label, ms = 3000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const value = predicate();
    if (value) return value;
    await wait(20);
  }
  assert.fail("Condição não atingida: " + label);
}

const ATLAS = "explorar/atlas.html";

function atlasSource() {
  return fs.readFileSync(path.join(repoRoot, "assets", "js", "forja-atlas.js"), "utf8");
}

function atlasCss() {
  return fs.readFileSync(path.join(repoRoot, "assets", "css", "atlas.css"), "utf8");
}

function rows(app) {
  return app.$$(".atlas-exercise-row").map(row => ({
    name: row.querySelector(".ui-exercise-name").textContent,
    text: row.textContent
  }));
}

function legendButton(app, groupId) {
  return app.$('.atlas-legend-button[data-group="' + groupId + '"]');
}

function region(app, groupId) {
  return app.$('.atlas-region[data-group="' + groupId + '"]');
}

function modeButton(app, value) {
  return app.$('#atlas-modes [data-value="' + value + '"]');
}

const customLibrary = {
  calisthenics: [
    {
      id: "custom-parede", name: "Flexão na parede", type: "reps", sets: 3, reps: "12",
      rest: 45, section: "main", category: "push", muscles: ["peito"],
      equipment: ["peso corporal"], instructions: "Em pé, mãos na parede, dobre os cotovelos e empurre."
    },
    {
      id: "custom-sem-meta", name: "Meu exercício sem metadados", type: "reps", sets: 2,
      reps: "8", rest: 30, section: "main"
    }
  ],
  weights: []
};

/* ------------------------------------------------------------------ */
/* 1. Estrutura da página                                             */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 1. Página carrega mapa, legenda, aviso de esquema e barra inferior", async () => {
  const app = await boot({}, ATLAS);
  await wait(20);

  assert.equal(app.d.body.dataset.page, "atlas");
  assert.ok(app.$("#atlas-root"), "Contêiner do atlas ausente");
  assert.equal(app.$("#atlas-root").hasAttribute("aria-busy"), false, "aria-busy ficou preso");

  assert.equal(app.$$(".atlas-region").length, 9, "Vista anterior deveria ter 9 regiões");
  assert.equal(app.$$(".atlas-legend-button").length, 9, "Legenda não listou as regiões");
  assert.equal(app.$$(".atlas-map-svg").length, 1, "Mapa SVG ausente");

  /* Cada região tem nome acessível, número e papel de botão. */
  const regions = app.$$(".atlas-region");
  regions.forEach(node => {
    assert.equal(node.getAttribute("role"), "button");
    assert.equal(node.getAttribute("tabindex"), "0");
    assert.match(node.getAttribute("aria-label"), /^[1-9]\. /, "Rótulo sem número: " + node.getAttribute("aria-label"));
    assert.equal(node.getAttribute("aria-pressed"), "false");
    assert.ok(node.querySelector(".atlas-region-number").textContent.trim(), "Número visível ausente");
  });

  /* Aviso honesto sobre o nível do desenho. */
  assert.match(app.text(".atlas-disclosure"), /Não é uma representação anatômica clínica/i);
  assert.match(app.text(".atlas-map-caption"), /Mapa esquemático/i);

  /* Navegação inferior: cinco destinos, Explorar atual. */
  const nav = app.$$(".bottom-nav-link");
  assert.equal(nav.length, 5, "A barra inferior precisa manter cinco destinos");
  assert.equal(app.$$('.bottom-nav-link[aria-current="page"]').length, 1);
  assert.match(app.$('.bottom-nav-link[aria-current="page"]').textContent, /Explorar/);
  assert.ok(fs.existsSync(path.join(repoRoot, "explorar/index.html")));
  assert.match(fs.readFileSync(path.join(repoRoot, "explorar/index.html"), "utf8"), /href="atlas\.html"/,
    "O hub Explorar precisa apontar para o atlas");

  assert.deepEqual(app.keys(), [], "Consultar o atlas não deve gravar dados");
  assertNoErrors(app, "atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 2. Seleção e limpeza                                               */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 2. Seleção e limpeza de grupos musculares", async () => {
  const app = await boot({}, ATLAS);
  await wait(20);

  assert.equal(app.text("#atlas-selection-title"), "Nenhuma região selecionada");
  assert.equal(app.$$('.atlas-region[aria-pressed="true"]').length, 0);

  app.click(legendButton(app, "peito"));
  await wait(20);

  assert.equal(region(app, "peito").getAttribute("aria-pressed"), "true", "Região não ficou pressionada");
  assert.equal(legendButton(app, "peito").getAttribute("aria-pressed"), "true", "Legenda não refletiu a seleção");
  assert.equal(app.text("#atlas-selection-title"), "Peitoral");
  assert.match(app.text("#atlas-selection-summary"), /4 exercícios relacionados/);
  assert.match(app.text(".atlas-selection-where"), /Frente do tórax/);
  assert.ok(app.$(".atlas-region.is-selected"), "Destaque visual ausente");
  assert.match(app.text(".atlas-legend-check"), /selecionado/i, "Legenda não marca o selecionado em texto");

  /* Selecionar pelo mapa troca a seleção. */
  app.click(region(app, "biceps"));
  await wait(20);
  assert.equal(app.text("#atlas-selection-title"), "Bíceps braquial");
  assert.equal(app.$$('.atlas-region[aria-pressed="true"]').length, 1, "Mais de uma região selecionada");

  /* O botão de limpar volta ao estado inicial. */
  app.click(".atlas-inline-reset");
  await wait(20);
  assert.equal(app.text("#atlas-selection-title"), "Nenhuma região selecionada");
  assert.equal(app.$$('.atlas-region[aria-pressed="true"]').length, 0);
  assert.equal(app.$$(".atlas-exercise-row").length, 0, "A lista continuou depois de limpar");
  assert.match(app.text(".atlas-exercises .atlas-card-note"), /A lista aparece depois/i);

  /* Sem seleção o botão fica desabilitado, mas continua no lugar. */
  assert.equal(app.$(".atlas-inline-reset").disabled, true);

  assertNoErrors(app, "seleção do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 3. Vistas                                                          */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 3. Alternância anterior/posterior e navegação por teclado", async () => {
  const app = await boot({}, ATLAS);
  await wait(20);

  const front = app.$$(".atlas-region").map(node => node.getAttribute("data-group"));
  assert.deepEqual(front.slice(0, 3), ["ombros", "peito", "biceps"]);
  assert.match(app.text(".atlas-map-caption"), /Vista anterior/);

  app.click(region(app, "peito"));
  await wait(15);

  app.click('#atlas-view [data-value="back"]');
  await wait(20);

  const back = app.$$(".atlas-region").map(node => node.getAttribute("data-group"));
  assert.ok(back.includes("dorsais") && back.includes("gluteos"), "Vista posterior sem dorsais/glúteos");
  assert.equal(back.length, 7, "Vista posterior deveria ter 7 regiões");
  assert.equal(region(app, "peito"), null, "Região anterior continuou na vista posterior");
  assert.equal(app.text("#atlas-selection-title"), "Nenhuma região selecionada",
    "Trocar de vista precisa limpar uma seleção que não existe naquela vista");
  assert.match(app.text(".atlas-map-caption"), /Vista posterior/);
  assert.equal(app.$$('.atlas-region[aria-pressed="true"]').length, 0);

  app.click('#atlas-view [data-value="front"]');
  await wait(20);
  assert.equal(app.$$(".atlas-region").length, 9);

  /* Teclado: Enter seleciona; setas movem o foco entre regiões da vista. */
  const target = region(app, "quadriceps");
  target.focus();
  target.dispatchEvent(new app.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await wait(20);
  assert.equal(app.text("#atlas-selection-title"), "Quadríceps", "Enter não selecionou a região");

  const focused = region(app, "quadriceps");
  focused.focus();
  focused.dispatchEvent(new app.w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await wait(10);
  assert.equal(app.d.activeElement.getAttribute("data-group"), "pernas", "Seta direita não avançou o foco");

  assertNoErrors(app, "vistas do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 4. Filtro por modalidade                                           */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 4. Filtro por modalidade e mensagem de vazio por filtro", async () => {
  const app = await boot({}, ATLAS);
  await wait(20);

  app.click(region(app, "antebracos"));
  await wait(20);

  assert.deepEqual(rows(app).map(row => row.name), ["Farmer walk", "Rosca direta", "Elevação de pernas na barra"]);
  assert.match(app.text("#atlas-modes"), /Calistenia0/);
  assert.match(app.text("#atlas-modes"), /Musculação3/);

  app.click(modeButton(app, "calisthenics"));
  await wait(20);

  assert.equal(rows(app).length, 0, "Filtro vazio ainda listou exercícios");
  assert.equal(app.text(".atlas-exercises .ui-empty-title"), "Nenhum exercício desta modalidade");
  assert.doesNotMatch(app.text(".atlas-exercises .ui-empty-text"), /inventa vínculos/,
    "Vazio por filtro não deve ser confundido com região sem exercícios");
  assert.match(app.text("#atlas-exercises-status"), /Nenhum exercício de calistenia/i);

  app.click(app.$(".atlas-exercises .ui-empty-actions .primary-button"));
  await wait(20);
  assert.equal(rows(app).length, 3, "Limpar o filtro não trouxe a lista");

  app.click(modeButton(app, "weights"));
  await wait(20);
  const weightsRows = rows(app);
  assert.equal(weightsRows.length, 3);
  weightsRows.forEach(row => {
    assert.match(row.text, /Musculação/, "Linha sem modalidade: " + row.name);
    assert.match(row.text, /Estabilizador|Principal|Secundário|Informado/, "Linha sem papel muscular");
  });
  assert.match(app.text("#atlas-exercises-status"), /Musculação/);

  assertNoErrors(app, "filtro do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 5. Relação grupo ↔ exercício e modelo de papéis                    */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 5. Relação entre grupos e exercícios com papéis explícitos", async () => {
  const app = await boot({}, ATLAS);
  await wait(20);

  const items = app.F.catalog.items();
  assert.equal(items.length, 37, "Catálogo sugerido incompleto");

  const groupIds = app.F.atlas.GROUPS.map(group => group.id);
  assert.equal(new Set(groupIds).size, groupIds.length, "Ids de grupo repetidos");

  items.forEach(record => {
    assert.ok(record.roles, "Exercício sugerido sem classificação muscular: " + record.name);
    const union = app.F.catalog.musclesFromRoles(record.roles);
    assert.deepEqual(
      Array.from(record.muscles),
      Array.from(union),
      "Lista plana divergiu dos papéis em " + record.name
    );

    assert.ok(record.roles.primary.length >= 1, "Exercício sem grupo principal: " + record.name);
    assert.ok(record.roles.primary.length <= 2, "Mais de dois grupos principais em " + record.name);
    assert.ok(record.roles.primary.length < record.muscles.length || record.muscles.length === 1,
      "Todos os músculos foram classificados como principais em " + record.name);

    ["primary", "secondary", "stabilizers"].forEach(level => {
      (record.roles[level] || []).forEach(muscle => {
        const group = app.F.atlas.groupForMuscleName(muscle);
        assert.ok(group, "Grupo desconhecido no catálogo (\"" + muscle + "\" em " + record.name + ")");
      });
    });
  });

  /* Peito: dois principais e dois secundários, sem virar "tudo principal". */
  app.click(region(app, "peito"));
  await wait(20);

  const peitoRows = rows(app);
  assert.equal(peitoRows.length, 4);
  const flexao = peitoRows.find(row => row.name === "Flexão de braço");
  assert.match(flexao.text, /Principal/);
  assert.match(flexao.text, /Calistenia/);
  assert.match(peitoRows.find(row => row.name === "Paralela (mergulho)").text, /Secundário/);
  assert.match(peitoRows.find(row => row.name === "Burpee").text, /Secundário/);
  assert.match(app.text("#atlas-selection-summary"), /2 principais · 2 secundários/);

  /* Teres/estabilizadores aparecem quando declarados: abdômen na flexão. */
  app.click(region(app, "abdomem"));
  await wait(20);
  const absRows = rows(app);
  assert.ok(absRows.some(row => row.name === "Flexão de braço" && /Estabilizador/.test(row.text)),
    "Estabilizador não foi identificado na lista");

  /* A fonte única é o catálogo: o atlas não recalcula papéis. */
  assert.equal(
    app.F.atlas.roleFor(items.find(item => item.id === "cal-flexao"), "peito"),
    "primary"
  );
  assert.equal(
    app.F.atlas.roleFor(items.find(item => item.id === "cal-flexao"), "panturrilha"),
    null
  );
  assert.equal(
    app.F.atlas.roleFor(items.find(item => item.id === "cal-flexao"), "abdomem"),
    "stabilizer"
  );

  assertNoErrors(app, "relação do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 6. Ausência de resultados                                          */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 6. Região sem exercícios mostra mensagem honesta", async () => {
  const app = await boot({}, ATLAS);
  await wait(20);

  app.click('#atlas-view [data-value="back"]');
  await wait(20);
  app.click(region(app, "panturrilha"));
  await wait(20);

  assert.equal(rows(app).length, 0, "Região sem metadados listou exercícios");
  assert.equal(app.text(".atlas-exercises .ui-empty-title"), "Nenhum exercício para esta região");
  assert.match(app.text(".atlas-exercises .ui-empty-text"), /não tem exercícios classificados/i);
  assert.match(app.text(".atlas-exercises .ui-empty-text"), /não inventa vínculos/i);
  assert.match(app.text("#atlas-exercises-status"), /Nenhum exercício no catálogo atual/i);
  assert.match(app.text("#atlas-selection-summary"), /Nenhum exercício do catálogo atual/i);
  assert.equal(region(app, "panturrilha").getAttribute("aria-label").includes("sem exercícios"), true);

  /* Nenhum dado falso é exibido para preencher a tela. */
  assert.doesNotMatch(app.text("#atlas-root"), /\b0 exercícios?\b/);

  assertNoErrors(app, "vazio do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 7. Abertura do exercício na biblioteca                             */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 7. Abrir o detalhe do exercício correspondente na biblioteca", async () => {
  const app = await boot({}, ATLAS);
  await wait(20);

  app.click(region(app, "peito"));
  await wait(20);

  const link = app.$('.atlas-exercise-row .ui-button');
  assert.equal(link.tagName, "A", "Abrir na biblioteca precisa ser um link real");
  assert.match(link.getAttribute("href"), /biblioteca\.html\?exercicio=cal-flexao&modalidade=calisthenics/);
  assert.match(link.getAttribute("aria-label"), /Flexão de braço/);

  const routine = makeRoutine("calisthenics", "Rotina preservada", [
    { id: "keep", name: "Exercício existente", section: "main", sets: 2, reps: "10", rest: 30 }
  ], "preservada");
  app.close();

  const seeded = await boot({ "forja-treino-rotinas-v1": routinesStore([routine], []) }, ATLAS);
  await wait(20);
  const before = seeded.raw("forja-treino-rotinas-v1");

  seeded.click(region(seeded, "peito"));
  await wait(20);
  seeded.click(".atlas-exercise-row .ui-button");
  await wait(250);

  assert.equal(seeded.d.body.dataset.page, "biblioteca", "O link não trocou para a biblioteca");
  assert.ok(seeded.$(".modal-backdrop"), "O detalhe não abriu na biblioteca");
  assert.equal(seeded.text("#modal-title"), "Flexão de braço");
  assert.match(seeded.text(".modal-details"), /Grupos musculares — principal: peito/);
  assert.match(seeded.text(".modal-details"), /cotovelos a cerca de 45°/);
  assert.equal(seeded.raw("forja-treino-rotinas-v1"), before, "Abrir o detalhe alterou a rotina");

  seeded.modalAction("cancel");
  await wait(20);
  assert.equal(seeded.$(".modal-backdrop"), null);

  assertNoErrors(seeded, "detalhe aberto pelo atlas");
  seeded.close();
});

/* ------------------------------------------------------------------ */
/* 8. Exercícios personalizados                                       */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 8. Exercício personalizado sem metadados não quebra nem é classificado", async () => {
  const app = await boot({ "forja-treino-biblioteca-v1": customLibrary }, ATLAS);
  await wait(20);

  assertNoErrors(app, "atlas com biblioteca personalizada");

  /* O item com "peito" digitado aparece como informado pelo usuário. */
  app.click(region(app, "peito"));
  await wait(20);
  const peitoRows = rows(app);
  const informado = peitoRows.find(row => row.name === "Flexão na parede");
  assert.ok(informado, "Exercício personalizado com músculo informado não apareceu");
  assert.match(informado.text, /Informado por você/);
  assert.doesNotMatch(informado.text, /Principal|Secundário|Estabilizador/);

  /* O item sem metadados não é inventado nem listado. */
  assert.equal(
    peitoRows.some(row => /sem metadados/i.test(row.name)),
    false,
    "Exercício sem metadados foi classificado por suposição"
  );

  /* Ele continua existindo normalmente na biblioteca. */
  app.click(app.$('.library-full-link[href="../treino/biblioteca.html"]'));
  await wait(200);
  assert.equal(app.d.body.dataset.page, "biblioteca");
  const search = app.$("#catalog-search");
  search.value = "sem metadados";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  await wait(20);
  const found = app.$$("#catalog-list .ui-exercise-row").map(row => row.textContent);
  assert.equal(found.length, 1, "Exercício personalizado sumiu da biblioteca");
  assert.match(found[0], /Meu exercício sem metadados/);

  assertNoErrors(app, "personalizado no atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 9. Link direto, e estados de erro                                 */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 9. Link direto (?grupo/vista) e estado de erro com retentativa", async () => {
  const direct = await boot({}, ATLAS + "?grupo=peito");
  await wait(20);
  assert.equal(direct.text("#atlas-selection-title"), "Peitoral", "Link direto não selecionou o grupo");
  assert.equal(region(direct, "peito").getAttribute("aria-pressed"), "true");
  direct.close();

  const back = await boot({}, ATLAS + "?grupo=posterior-coxa&vista=anterior");
  await wait(20);
  assert.match(back.text(".atlas-map-caption"), /Vista posterior/, "O grupo deve abrir na própria vista");
  assert.equal(back.text("#atlas-selection-title"), "Posterior de coxa");
  back.close();

  const invalid = await boot({}, ATLAS + "?grupo=nao-existe");
  await wait(20);
  assert.equal(invalid.text("#atlas-selection-title"), "Nenhuma região selecionada");
  assertNoErrors(invalid, "grupo inválido no link");
  invalid.close();

  /* Estado de erro: catálogo indisponível → alerta acessível + retentativa. */
  const app = await boot({}, ATLAS);
  await wait(20);
  const original = app.F.catalog.items;
  app.F.catalog.items = () => { throw new Error("falha simulada de catálogo"); };
  app.F.pages.atlas.refresh();
  await wait(20);

  const alert = app.$('[role="alert"]');
  assert.ok(alert, "Falha de dados não mostrou alerta");
  assert.match(alert.textContent, /Não foi possível montar o atlas agora/);
  assert.match(alert.textContent, /Nada foi gravado nem alterado/);
  assert.equal(app.$(".atlas-region"), null, "O mapa ficou em estado inconsistente");

  app.F.catalog.items = original;
  app.click('[data-atlas-focus="retry"]');
  await wait(30);
  assert.equal(app.$('[role="alert"]'), null, "Retentativa não limpou o erro");
  assert.equal(app.$$(".atlas-region").length, 9, "Retentativa não remontou o mapa");

  assert.deepEqual(app.keys(), [], "O estado de erro gravou dados");
  assertNoErrors(app, "erro e retentativa do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 10. Privacidade e preservação                                      */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 10. Preserva chaves, rotinas e histórico; não escreve nem limpa storage", async () => {
  const routineA = makeRoutine("calisthenics", "A", [
    { id: "a1", name: "Flexão", section: "main", sets: 3, reps: "10", rest: 40 }
  ], "ra");
  const routineB = makeRoutine("weights", "B", [
    { id: "b1", name: "Supino", section: "main", sets: 4, reps: "8", rest: 90, load: "60 kg" }
  ], "rb");

  const history = [{
    id: "h1", date: "2026-10-01", modality: "calisthenics", routineName: "A",
    durationMs: 60000, completedSets: 3, totalPlannedSets: 3, status: "completed",
    finishedAt: "2026-10-01T12:00:00.000Z",
    exercises: [{
      id: "a1", name: "Flexão", section: "main", plannedSets: 3, completedSets: 3,
      reps: "10", duration: 45, type: "reps", rest: 40, load: "", notes: "",
      logs: [{ set: 1, reps: "10", load: "" }]
    }]
  }];

  const seed = {
    "forja-treino-rotinas-v1": routinesStore([routineA], [routineB]),
    "forja-treino-historico-v1": history,
    "forja-treino-biblioteca-v1": customLibrary,
    "forja-preferencias-v1": { soundOnRest: false, vibrateOnRest: true }
  };

  const app = await boot(seed, ATLAS);
  await wait(20);

  const before = {};
  app.keys().forEach(key => { before[key] = app.raw(key); });
  assert.deepEqual(Object.keys(before).sort(), Object.keys(seed).sort(), "Boot do atlas criou chave nova");

  app.click(region(app, "peito"));
  await wait(15);
  app.click(modeButton(app, "calisthenics"));
  await wait(15);
  app.click('#atlas-view [data-value="back"]');
  await wait(15);
  app.click(region(app, "gluteos"));
  await wait(15);
  app.click(".atlas-inline-reset");
  await wait(15);

  const after = {};
  app.keys().forEach(key => { after[key] = app.raw(key); });
  assert.deepEqual(after, before, "O atlas alterou o armazenamento existente");

  /* Nada de localStorage.clear() e nenhuma escrita no módulo do atlas. */
  const source = atlasSource();
  assert.equal(source.includes("localStorage.clear("), false, "localStorage.clear() no atlas");
  assert.doesNotMatch(source, /localStorage|saveRoutines|saveLibrary|saveHistory|F\.store\.set/,
    "O atlas não deve escrever no armazenamento");
  assert.equal(
    fs.readFileSync(path.join(repoRoot, "assets", "js", "forja-catalogo.js"), "utf8").includes("localStorage.clear("),
    false
  );

  assertNoErrors(app, "preservação do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 11. Responsividade e acessibilidade no CSS                          */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 11. CSS responsivo (320–1280) e prefers-reduced-motion", async () => {
  const css = atlasCss();
  const html = fs.readFileSync(path.join(repoRoot, "explorar", "atlas.html"), "utf8");

  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
  assert.match(html, /atlas\.css/);
  assert.match(html, /data-page="atlas"/);
  assert.match(html, /role="status">Carregando o atlas/, "Estado de carregamento acessível ausente");

  assert.match(css, /@media \(max-width: 430px\)/, "Sem ajuste para telas de 320–430 px");
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(min-width: 760px\)/, "Sem layout de desktop");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, "Sem respeito a prefers-reduced-motion");
  assert.match(css, /\.atlas-region:focus-visible \.atlas-region-hit/, "Foco visível do mapa ausente");
  assert.match(css, /\.atlas-region\.is-selected \.atlas-region-shape/, "Destaque da região selecionada ausente");
  assert.match(css, /min-height: 44px/, "Alvo de toque mínimo ausente");
  assert.match(css, /grid-template-columns: minmax\(320px, 0\.9fr\)/, "Layout de duas colunas ausente");
  assert.match(css, /overflow-wrap: anywhere/, "Nomes longos podem estourar em 320 px");

  assertNoErrors({ errors: [] }, "css");
});

const failed = results.filter(result => !result.ok);

console.log("\n" + "=".repeat(66));
console.log("ATLAS — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
if (failed.length > 0) {
  console.log("Falhas: " + failed.map(item => item.name).join(" | "));
}
console.log("=".repeat(66));

process.exitCode = failed.length > 0 ? 1 : 0;
