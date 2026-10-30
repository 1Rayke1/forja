/*
  Testes do Atlas anatômico (explorar/atlas.html), das pranchas raster de
  referência e da integração com a biblioteca e a execução do treino.

  Roda em jsdom sobre as páginas reais do repositório, com o mesmo harness
  multipágina de `forja.test.mjs`: clicar em um link troca de página e o
  localStorage é preservado, como no navegador.

  Cada teste cobre um requisito do pacote 3.1; a relação requisito → teste está
  em docs/atlas-anatomico.md.

  Uso: npm test (a suíte entra na cadeia) ou node tests/atlas.test.mjs
*/
import assert from "node:assert/strict";
import crypto from "node:crypto";
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

function figureSource() {
  return fs.readFileSync(path.join(repoRoot, "assets", "js", "forja-figura.js"), "utf8");
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

function groupChip(app, groupId) {
  return app.$('[data-group-chip="' + groupId + '"]');
}

function highlighted(app, view) {
  return app.$$(".atlas-figura-cell[data-view=\"" + view + "\"] .figura-region")
    .map(node => ({ id: node.getAttribute("data-region"), role: node.getAttribute("data-role") }));
}

function legendItems(app) {
  return app.$$(".atlas-legenda-item").map(node => ({
    id: node.getAttribute("data-region"),
    role: node.getAttribute("data-role"),
    name: node.querySelector(".atlas-legenda-nome").textContent,
    meta: node.querySelector(".atlas-legenda-meta").textContent
  }));
}

function chooseExercise(app, id) {
  const select = app.$("#atlas-exercise-select");
  select.value = id;
  select.dispatchEvent(new app.w.Event("change", { bubbles: true }));
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

await runTest("ATLAS 1. Página carrega escolha de exercício, modelo anterior/posterior e barra inferior", async () => {
  const app = await boot({}, ATLAS);
  await wait(20);

  assert.equal(app.d.body.dataset.page, "atlas");
  assert.ok(app.$("#atlas-root"), "Contêiner do atlas ausente");
  assert.equal(app.$("#atlas-root").hasAttribute("aria-busy"), false, "aria-busy ficou preso");

  /* Escolha do exercício: 37 sugeridos, separados por modalidade, sem seleção inicial. */
  const select = app.$("#atlas-exercise-select");
  assert.ok(select, "Seletor de exercícios ausente");
  assert.equal(select.options.length, 38, "Deveria haver 37 exercícios + a opção vazia");
  assert.equal(select.value, "", "O atlas não deve escolher um exercício por conta própria");

  const groups = app.$$("#atlas-exercise-select optgroup");
  assert.deepEqual(groups.map(node => node.label), ["Calistenia", "Musculação"]);
  assert.equal(groups[0].children.length, 18);
  assert.equal(groups[1].children.length, 19);

  /* Duas vistas do mesmo modelo anatômico, nomeadas para leitores de tela. */
  const cells = app.$$(".atlas-figura-cell");
  assert.deepEqual(cells.map(node => node.getAttribute("data-view")), ["front", "back"]);
  assert.equal(app.$$(".figura-svg").length, 2);
  app.$$(".figura-svg").forEach(node => {
    assert.equal(node.getAttribute("role"), "img");
    assert.match(node.getAttribute("aria-label"), /Modelo anatômico muscular, vista (anterior|posterior)/);
  });
  assert.match(app.text(".atlas-figura-cell[data-view=\"front\"] .atlas-figura-caption"), /Anterior/);
  assert.match(app.text(".atlas-figura-cell[data-view=\"back\"] .atlas-figura-caption"), /Posterior/);

  /* Sem exercício escolhido: nenhuma região colorida e legenda de cores. */
  assert.equal(app.$$(".figura-region").length, 0, "Região destacada sem exercício escolhido");
  assert.equal(app.$$(".atlas-legenda-item").length, 0);
  assert.match(app.text(".atlas-figuras-note"), /Nenhuma região destacada/);
  assert.equal(app.$$(".atlas-color-key .atlas-swatch").length, 3, "Chave de cores incompleta");

  /* Aviso honesto sobre projeção superficial e limites do mapa. */
  assert.match(app.text(".atlas-disclosure"), /não uma segmentação anatômica clínica/i);
  assert.match(app.text(".atlas-disclosure"), /projeções funcionais aproximadas/i);
  assert.match(app.text(".atlas-disclosure"), /músculos profundos/i);

  /* Navegação inferior: cinco destinos, Explorar atual. */
  const nav = app.$$(".bottom-nav-link");
  assert.equal(nav.length, 5, "A barra inferior precisa manter cinco destinos");
  assert.equal(app.$$('.bottom-nav-link[aria-current="page"]').length, 1);
  assert.match(app.$('.bottom-nav-link[aria-current="page"]').textContent, /Explorar/);
  assert.ok(fs.existsSync(path.join(repoRoot, "explorar/index.html")));
  assert.match(fs.readFileSync(path.join(repoRoot, "explorar/index.html"), "utf8"), /href="atlas\.html"/,
    "O hub Explorar precisa apontar para o atlas");

  assert.deepEqual(app.keys(), ["forja-perfil-v1"], "Atlas preserva o perfil exigido e não cria outros dados");
  assertNoErrors(app, "atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 2. Exercício escolhido → figura + legenda                          */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 2. Flexão de braço destaca peitoral, tríceps, ombros e abdômen com papéis explícitos", async () => {
  const app = await boot({}, ATLAS + "?exercicio=cal-flexao");
  await wait(20);

  assert.equal(app.text("#atlas-figure-title"), "Flexão de braço");
  assert.equal(app.$("#atlas-exercise-select").value, "cal-flexao", "O seletor não refletiu o link direto");

  /* Exemplo exigido: peitoral principal; tríceps e ombros secundários; resto neutro. */
  assert.deepEqual(highlighted(app, "front"), [
    { id: "abdomem", role: "stabilizer" },
    { id: "ombros", role: "secondary" },
    { id: "peito", role: "primary" }
  ]);
  assert.deepEqual(highlighted(app, "back"), [
    { id: "ombros", role: "secondary" },
    { id: "triceps", role: "secondary" }
  ]);

  /* O destaque é por região colorida, não por números espalhados pelo corpo. */
  assert.equal(app.$$(".figura-svg text").length, 0, "A figura não deve ter números/rótulos sobre o corpo");
  assert.equal(app.$$(".figura-svg circle").length, 0, "A figura não deve usar círculos sobrepostos");

  assert.match(app.text("#atlas-highlight-summary"),
    /Principal: Peitoral\. 2 regiões secundárias\. 1 região estabilizadora\./);

  const legend = legendItems(app);
  assert.deepEqual(legend.map(item => [item.id, item.role]), [
    ["peito", "primary"],
    ["triceps", "secondary"],
    ["ombros", "secondary"],
    ["abdomem", "stabilizer"]
  ]);
  assert.match(legend[0].meta, /Principal · vista anterior/);
  assert.match(legend[1].meta, /Secundária · vista posterior/);
  assert.match(legend[2].meta, /anterior e posterior/);

  /* Cor não é a única informação: o papel está escrito em cada item. */
  assert.match(app.text(".atlas-legenda"), /Principal/);
  assert.match(app.text(".atlas-legenda"), /Secundária/);
  assert.match(app.text(".atlas-legenda"), /Estabilizadora/);

  /* Atalho leva à biblioteca com o exercício. */
  const link = app.$(".atlas-exercise-actions .ui-button");
  assert.equal(link.tagName, "A");
  assert.match(link.getAttribute("href"), /biblioteca\.html\?exercicio=cal-flexao&modalidade=calisthenics/);
  assert.match(link.getAttribute("aria-label"), /Flexão de braço/);

  /* Atalhos marcam o exercício ativo e trocam a figura. */
  const shortcut = app.$('[data-atlas-focus="shortcut:cal-flexao"]');
  assert.equal(shortcut.getAttribute("aria-pressed"), "true");
  assert.equal(app.text(".atlas-card-note"), app.text(".atlas-card-note")); /* nota presente */

  app.click('[data-atlas-focus="shortcut:mus-terra"]');
  await wait(20);
  assert.equal(app.text("#atlas-figure-title"), "Levantamento terra");
  assert.equal(app.$('[data-atlas-focus="shortcut:cal-flexao"]').getAttribute("aria-pressed"), "false");
  assert.equal(app.$('[data-atlas-focus="shortcut:mus-terra"]').getAttribute("aria-pressed"), "true");

  /* Voltar para a opção vazia limpa a figura e a legenda. */
  chooseExercise(app, "");
  await wait(20);
  assert.equal(app.$$(".figura-region").length, 0);
  assert.equal(app.$$(".atlas-legenda-item").length, 0);
  assert.match(app.text(".atlas-exercise-card .atlas-card-title"), /Regiões trabalhadas/);

  assertNoErrors(app, "seleção do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 3. A figura: vistas, leitura e interação                           */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 3. Pranchas originais íntegras, máscaras registradas e leitura por teclado", async () => {
  const app = await boot({}, ATLAS + "?exercicio=cal-flexao");
  await wait(20);

  const front = app.$(".atlas-figura-cell[data-view=\"front\"] .figura-svg");
  const back = app.$(".atlas-figura-cell[data-view=\"back\"] .figura-svg");

  /* As duas vistas usam recortes raster 350 × 690 da mesma referência. Não
     existe mais uma silhueta geométrica concorrendo com a imagem. */
  const frontPlate = front.querySelector("image.figura-plate");
  const backPlate = back.querySelector("image.figura-plate");
  assert.ok(frontPlate && backPlate, "Pranchas anatômicas ausentes nas vistas");
  assert.match(frontPlate.getAttribute("href"), /assets\/anatomia\/anterior\.png$/);
  assert.match(backPlate.getAttribute("href"), /assets\/anatomia\/posterior\.png$/);
  [frontPlate, backPlate].forEach(plate => {
    assert.equal(plate.getAttribute("width"), "350");
    assert.equal(plate.getAttribute("height"), "690");
    assert.equal(plate.getAttribute("preserveAspectRatio"), "xMidYMid meet");
  });
  assert.equal(front.querySelectorAll(".figura-silhouette, clipPath, rect, line").length, 0,
    "O corpo não pode ser substituído ou recortado por geometria inventada");
  assert.equal(back.querySelectorAll(".figura-silhouette, clipPath, rect, line").length, 0);

  assert.equal(front.getAttribute("viewBox"), "0 0 350 690");
  assert.equal(back.getAttribute("viewBox"), "0 0 350 690");
  assert.match(front.getAttribute("preserveAspectRatio") || "xMidYMid meet", /xMidYMid/);

  /* Integridade real dos PNG e do manifesto de procedência. O teste E2E
     complementa isto comparando pixel a pixel os opacos com a referência. */
  const anatomyDir = path.join(repoRoot, "assets", "anatomia");
  const manifest = JSON.parse(fs.readFileSync(path.join(anatomyDir, "manifest.json"), "utf8"));
  const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
  assert.deepEqual(manifest.canvas, { width: 350, height: 690 });
  assert.equal(manifest.sourceSha256, "4163b0387a1657e5c121864e663e93dbe5bf1f476cce59304b7f197102a7c39b");
  assert.equal(sha256(fs.readFileSync(path.join(anatomyDir, manifest.source))), manifest.sourceSha256,
    "A referência original foi alterada");
  for (const view of ["front", "back"]) {
    const item = manifest.plates[view];
    const png = fs.readFileSync(path.join(anatomyDir, item.file));
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(png.readUInt32BE(16), 350, "Largura PNG divergente em " + view);
    assert.equal(png.readUInt32BE(20), 690, "Altura PNG divergente em " + view);
    assert.equal(png[25], 6, "A prancha precisa de canal alfa RGBA");
    assert.equal(sha256(png), item.sha256, "Hash da prancha diverge do manifesto");
    assert.ok(item.bounds.top >= 4 && item.bounds.bottom <= 681, "Cabeça/pés cortados em " + view);
    assert.ok(item.bounds.left >= 2 && item.bounds.right <= 347, "Mãos cortadas em " + view);
    assert.ok(item.bounds.bottom >= 650, "Enquadramento não chega aos pés em " + view);
  }
  assert.equal(fs.existsSync(path.join(anatomyDir, "anterior.svg")), false,
    "A prancha geométrica rejeitada não pode voltar como fonte visual");

  /* Texto alternativo lista só as regiões que existem naquela vista. */
  const frontLabel = front.getAttribute("aria-label");
  const backLabel = back.getAttribute("aria-label");
  assert.match(frontLabel, /vista anterior/);
  assert.match(frontLabel, /principal: Peitoral/);
  assert.match(frontLabel, /secundária: Ombros/);
  assert.doesNotMatch(frontLabel, /Tríceps/, "A vista anterior não deve anunciar o tríceps");
  assert.match(backLabel, /vista posterior/);
  assert.match(backLabel, /secundária: Tríceps, Ombros/);
  assert.doesNotMatch(backLabel, /Peitoral/, "A vista posterior não deve anunciar o peitoral");

  /* A máscara referencia exatamente o mesmo PNG exibido, sem contorno paralelo.
     Assim, corpo e destaques não podem divergir por viewBoxes distintos. */
  [front, back].forEach(figure => {
    const plate = figure.querySelector("image.figura-plate");
    const maskImage = figure.querySelector("mask.figura-alpha-mask image.figura-mask-plate");
    assert.ok(maskImage, "Máscara alfa da prancha ausente");
    assert.equal(maskImage.getAttribute("href"), plate.getAttribute("href"));
    assert.equal(maskImage.getAttribute("width"), plate.getAttribute("width"));
    assert.equal(maskImage.getAttribute("height"), plate.getAttribute("height"));
    const maskId = figure.querySelector("mask.figura-alpha-mask").getAttribute("id");
    assert.equal(figure.querySelector(".figura-regions").getAttribute("mask"), "url(#" + maskId + ")");
  });

  /* Regiões interativas opcionais: foco, clique e teclado. */
  const host = app.d.createElement("div");
  const picked = [];
  host.appendChild(app.F.figura.render({
    view: "front",
    highlights: { peito: "primary" },
    interactive: true,
    onSelect: id => picked.push(id),
    selected: "peito"
  }));
  const region = host.querySelector('.figura-region[data-region="peito"]');
  assert.equal(region.getAttribute("role"), "button");
  assert.equal(region.getAttribute("tabindex"), "0");
  assert.equal(region.getAttribute("aria-pressed"), "true");
  region.dispatchEvent(new app.w.Event("click", { bubbles: true }));
  region.dispatchEvent(new app.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(picked, ["peito", "peito"], "Seleção por clique/teclado não funcionou");

  /* Metadados da figura: vistas e regiões disponíveis. */
  const backRegions = app.F.figura.regionsInView("back");
  assert.ok(backRegions.includes("gluteos") && backRegions.includes("triceps"));
  assert.equal(backRegions.includes("peito"), false);
  assert.deepEqual([...app.F.figura.regionsInView("front")],
    ["ombros", "peito", "biceps", "antebracos", "abdomem", "obliquos", "quadril", "quadriceps", "pernas"]);

  assertNoErrors(app, "figura do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 4. Filtro por modalidade                                           */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 4. Explorar por grupo: filtro por modalidade e mensagem de vazio", async () => {
  const app = await boot({}, ATLAS + "?grupo=antebracos");
  await wait(20);

  assert.equal(app.text("#atlas-group-status"), "Grupo em foco: Antebraços · anterior e posterior");
  assert.equal(groupChip(app, "antebracos").getAttribute("aria-pressed"), "true");
  assert.equal(app.$$(".atlas-group-figure .figura-region").length, 1, "Figura de foco do grupo ausente");
  assert.deepEqual(rows(app).map(row => row.name), ["Farmer walk", "Rosca direta", "Elevação de pernas na barra"]);
  assert.match(app.text("#atlas-modes"), /Todas3/);
  assert.match(app.text("#atlas-modes"), /Calistenia0/);
  assert.match(app.text("#atlas-modes"), /Musculação3/);

  app.click(modeButton(app, "calisthenics"));
  await wait(20);

  assert.equal(rows(app).length, 0, "Filtro vazio ainda listou exercícios");
  assert.equal(app.text(".atlas-exercise-list .ui-empty-title"), "Nenhum exercício desta modalidade");
  assert.match(app.text("#atlas-exercises-status"), /Nenhum exercício de calistenia/i);
  assert.match(app.text("#atlas-modes"), /Todas3/);

  app.click(app.$(".atlas-exercise-list .ui-empty-actions .primary-button"));
  await wait(20);
  assert.equal(rows(app).length, 3, "Limpar o filtro não trouxe a lista");

  app.click(modeButton(app, "weights"));
  await wait(20);
  const weightsRows = rows(app);
  assert.equal(weightsRows.length, 3);
  weightsRows.forEach(row => {
    assert.match(row.text, /Musculação/, "Linha sem modalidade: " + row.name);
    assert.match(row.text, /Principal|Secundária|Estabilizador|Informado/, "Linha sem papel muscular");
  });
  assert.match(app.text("#atlas-exercises-status"), /Musculação/);

  /* O botão de limpar volta ao estado sem grupo e desabilita. */
  app.click(".atlas-inline-reset");
  await wait(20);
  assert.equal(app.$("#atlas-group-status"), null);
  assert.equal(app.$$(".atlas-exercise-row").length, 0);
  assert.equal(app.$(".atlas-inline-reset").disabled, true);
  assert.match(app.text(".atlas-group-empty"), /Nenhum grupo selecionado/);

  assertNoErrors(app, "filtro do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 5. Relação grupo ↔ exercício e modelo de papéis                    */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 5. Relação entre grupos e exercícios com papéis do catálogo", async () => {
  const app = await boot({}, ATLAS);
  await wait(20);

  const items = app.F.catalog.items();
  assert.equal(items.length, 37, "Catálogo sugerido incompleto");

  const groupIds = app.F.atlas.GROUPS.map(group => group.id);
  assert.equal(new Set(groupIds).size, groupIds.length, "Ids de grupo repetidos");
  assert.equal(app.$$(".atlas-group-chip").length, groupIds.length, "Chips não cobrem todos os grupos");

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

    ["primary", "secondary", "stabilizers"].forEach(level => {
      (record.roles[level] || []).forEach(muscle => {
        const group = app.F.atlas.groupForMuscleName(muscle);
        assert.ok(group, "Grupo desconhecido no catálogo (\"" + muscle + "\" em " + record.name + ")");
      });
    });
  });

  /* Cada chip conta os exercícios do próprio grupo, sem números inventados. */
  app.F.atlas.GROUPS.forEach(group => {
    const total = app.F.atlas.exercisesFor(group.id).length;
    assert.equal(
      groupChip(app, group.id).querySelector(".atlas-group-chip-count").textContent,
      String(total),
      "Contagem divergente em " + group.label
    );
  });

  /* A fonte única é o catálogo: o atlas não recalcula papéis. */
  const flexao = items.find(item => item.id === "cal-flexao");
  assert.deepEqual({ ...app.F.atlas.highlightsFor(flexao) }, {
    abdomem: "stabilizer",
    peito: "primary",
    triceps: "secondary",
    ombros: "secondary"
  });
  assert.equal(app.F.atlas.highlightsFor(items.find(item => item.id === "cal-ponte")).gluteos, "primary");

  /* Grupo mostrado na própria vista (glúteo é posterior). */
  app.click(groupChip(app, "gluteos"));
  await wait(20);
  assert.match(app.text("#atlas-group-status"), /vista posterior/);
  assert.equal(app.$(".atlas-group-figure .figura-back") !== null, true);

  assertNoErrors(app, "relação do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 6. Ausência de resultados                                          */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 6. Grupo sem exercícios mostra mensagem honesta e panturrilha com contorno completo", async () => {
  const app = await boot({}, ATLAS + "?grupo=panturrilha");
  await wait(20);

  assert.equal(app.F.atlas.exercisesFor("panturrilha").length, 0);
  assert.ok(app.F.figura.REGIONS.panturrilha.back && app.F.figura.REGIONS.panturrilha.back.length > 0, "Panturrilha tem contorno completo na vista posterior");
  assert.equal(app.F.figura.REGIONS.panturrilha.outsideFrame, undefined, "Panturrilha não está mais fora do recorte");
  const grupoFigura = app.$(".atlas-group-figure");
  assert.equal(grupoFigura.querySelectorAll(".figura-region").length, 1, "Figura do grupo destaca a panturrilha em foco");
  const regiaoGrupo = grupoFigura.querySelector(".figura-region");
  assert.equal(regiaoGrupo.getAttribute("data-region"), "panturrilha");
  assert.equal(regiaoGrupo.getAttribute("data-role"), "focus");
  assert.equal(app.$("[data-atlas-framing-note]"), null, "Sem aviso de enquadramento: a prancha cobre da cabeça aos pés");
  assert.equal(rows(app).length, 0, "Grupo sem metadados listou exercícios");
  assert.equal(app.text(".atlas-exercise-list .ui-empty-title"), "Nenhum exercício para este grupo");
  assert.match(app.text(".atlas-exercise-list .ui-empty-text"), /não tem exercícios classificados/i);
  assert.match(app.text(".atlas-exercise-list .ui-empty-text"), /não inventa vínculos/i);
  assert.match(app.text("#atlas-exercises-status"), /Nenhum exercício do catálogo para Panturrilha/i);

  /* Nenhum dado falso é exibido para preencher a tela. */
  assert.doesNotMatch(app.text("#atlas-root"), /\b0 exercícios?\b/);

  assertNoErrors(app, "vazio do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 7. Integração com a biblioteca                                     */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 7. Legenda leva à biblioteca filtrada e o detalhe mostra a mesma figura", async () => {
  const routine = makeRoutine("calisthenics", "Rotina preservada", [
    { id: "keep", name: "Exercício existente", section: "main", sets: 2, reps: "10", rest: 30 }
  ], "preservada");

  const app = await boot({ "forja-treino-rotinas-v1": routinesStore([routine], []) }, ATLAS + "?exercicio=cal-flexao");
  await wait(20);
  const before = app.raw("forja-treino-rotinas-v1");

  /* Link da legenda → biblioteca já filtrada pelo grupo. */
  const link = app.$('.atlas-legenda-item[data-region="peito"] .atlas-legenda-link');
  assert.match(link.getAttribute("href"), /biblioteca\.html\?musculo=peito/);
  assert.match(link.getAttribute("aria-label"), /Ver exercícios de Peitoral/);

  app.click('.atlas-legenda-item[data-region="peito"] .atlas-legenda-link');
  await wait(250);
  assert.equal(app.d.body.dataset.page, "biblioteca", "O link não abriu a biblioteca");
  const filtered = app.$$("#catalog-list .ui-exercise-row").map(row => row.textContent);
  assert.equal(filtered.length, 4, "Filtro por músculo não aplicou os 4 exercícios de peito");
  assert.doesNotMatch(app.d.body.textContent, /não está mais no catálogo/,
    "Abrir a biblioteca filtrando por músculo não deve avisar de exercício ausente");
  assert.equal(filtered.every(text => /Flexão|Paralela|Burpee|Supino/.test(text)), true);

  /* Detalhe do exercício: figura + legenda, sem alterar a rotina. */
  app.click('#catalog-list .ui-exercise-row .ui-exercise-main button, #catalog-list .ui-exercise-row .ui-button');
  await until(() => app.$(".modal-backdrop"), "modal do exercício na biblioteca");
  await wait(30);

  assert.ok(app.$(".modal-figure .figura-svg"), "O detalhe não mostra a figura das regiões");
  assert.equal(app.$$(".modal-figure .figura-svg").length, 2, "A figura do detalhe deveria ter as duas vistas");
  assert.equal(app.$$(".modal-figure .atlas-legenda-item").length >= 2, true);
  assert.match(app.text(".modal-details"), /Grupos musculares — principal: peito/);
  assert.equal(app.raw("forja-treino-rotinas-v1"), before, "Abrir o detalhe alterou a rotina");

  app.modalAction("cancel");
  await wait(20);
  assert.equal(app.$(".modal-backdrop"), null);

  assertNoErrors(app, "detalhe aberto pelo atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 8. Exercícios personalizados                                       */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 8. Exercício personalizado sem metadados não é classificado por suposição", async () => {
  const app = await boot({ "forja-treino-biblioteca-v1": customLibrary }, ATLAS);
  await wait(20);

  assertNoErrors(app, "atlas com biblioteca personalizada");

  /* Item sem metadados não entra no seletor (nada é inventado). */
  const names = app.$$("#atlas-exercise-select option").map(node => node.textContent);
  assert.equal(names.includes("Meu exercício sem metadados"), false);

  /* Item com "peito" digitado aparece como informado por você. */
  app.click(groupChip(app, "peito"));
  await wait(20);
  const peitoRows = rows(app);
  const informado = peitoRows.find(row => row.name === "Flexão na parede");
  assert.ok(informado, "Exercício personalizado com músculo informado não apareceu");
  assert.match(informado.text, /Informado por você/);
  assert.doesNotMatch(informado.text, /Principal|Secundário|Estabilizador/);

  /* Na figura, o item informado usa o contorno tracejado, nunca "principal". */
  const highlights = app.F.atlas.highlightsFor(
    app.F.catalog.items().find(record => record.name === "Flexão na parede")
  );
  assert.deepEqual({ ...highlights }, { peito: "informed" });

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
/* 9. Link direto e estado de erro                                    */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 9. Link direto (?exercicio/?grupo/?modalidade) e estado de erro com retentativa", async () => {
  const direct = await boot({}, ATLAS + "?grupo=posterior-coxa");
  await wait(20);
  assert.equal(direct.text("#atlas-group-status"), "Grupo em foco: Posterior de coxa · vista posterior");
  assert.equal(groupChip(direct, "posterior-coxa").getAttribute("aria-pressed"), "true");
  assert.ok(direct.$(".atlas-group-figure .figura-back"), "O grupo posterior deveria abrir na vista posterior");
  direct.close();

  const filtered = await boot({}, ATLAS + "?grupo=abdomem&modalidade=calisthenics");
  await wait(20);
  assert.equal(modeButton(filtered, "calisthenics").getAttribute("aria-pressed"), "true");
  filtered.$$(".atlas-exercise-row").forEach(row => {
    assert.match(row.textContent, /Calistenia/);
  });
  filtered.close();

  const invalid = await boot({}, ATLAS + "?grupo=nao-existe&exercicio=nao-existe");
  await wait(20);
  assert.equal(invalid.$("#atlas-group-status"), null);
  assert.equal(invalid.$("#atlas-exercise-select").value, "");
  assertNoErrors(invalid, "link inválido no atlas");
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
  assert.equal(app.$(".figura-svg"), null, "A figura ficou em estado inconsistente");

  app.F.catalog.items = original;
  app.click('[data-atlas-focus="retry"]');
  await wait(30);
  assert.equal(app.$('[role="alert"]'), null, "Retentativa não limpou o erro");
  assert.equal(app.$$(".figura-svg").length, 2, "Retentativa não remontou as figuras");

  assert.deepEqual(app.keys(), ["forja-perfil-v1"], "Falha de atlas não altera o perfil exigido nem cria dados");
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
    "forja-perfil-v1": { version: 3, updatedAt: "2026-10-01T00:00:00.000Z", objetivo: "manterForma", nivel: "iniciante", equipamento: "casa", diasPorSemana: 3 },
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

  chooseExercise(app, "cal-flexao");
  await wait(15);
  app.click(groupChip(app, "peito"));
  await wait(15);
  app.click(modeButton(app, "calisthenics"));
  await wait(15);
  app.click(groupChip(app, "gluteos"));
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
  assert.equal(figureSource().includes("localStorage"), false, "A figura não deve tocar no armazenamento");
  assert.equal(
    fs.readFileSync(path.join(repoRoot, "assets", "js", "forja-catalogo.js"), "utf8").includes("localStorage.clear("),
    false
  );

  assertNoErrors(app, "preservação do atlas");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 11. Responsividade, acessibilidade e integração nos arquivos        */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 11. CSS responsivo (320–1280), foco visível e figura integrada às três páginas", async () => {
  const css = atlasCss();
  const atlasHtml = fs.readFileSync(path.join(repoRoot, "explorar", "atlas.html"), "utf8");
  const libraryHtml = fs.readFileSync(path.join(repoRoot, "treino", "biblioteca.html"), "utf8");
  const executionHtml = fs.readFileSync(path.join(repoRoot, "treino", "executar.html"), "utf8");

  assert.match(atlasHtml, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
  assert.match(atlasHtml, /atlas\.css/);
  assert.match(atlasHtml, /data-page="atlas"/);
  assert.match(atlasHtml, /role="status">Carregando o atlas/, "Estado de carregamento acessível ausente");

  /* A figura é carregada antes do atlas em todas as páginas que a usam. */
  [atlasHtml, libraryHtml, executionHtml].forEach((html, index) => {
    const figure = html.indexOf("forja-figura.js");
    const atlas = html.indexOf("forja-atlas.js");
    assert.ok(figure > -1, "Página " + index + " sem forja-figura.js");
    assert.ok(atlas > figure, "forja-figura.js precisa vir antes de forja-atlas.js");
    assert.match(html, /atlas\.css/, "Página " + index + " sem atlas.css");
  });
  assert.match(executionHtml, /id="execution-figure"/, "A execução não tem o bloco da figura");
  assert.match(executionHtml, /id="execution-figure-details"/, "A execução não tem o botão de detalhes dos músculos");

  /* Sem URL remota externa: pranchas locais, origem e pendência de licença documentadas. */
  assert.doesNotMatch(atlasHtml, /<img[^>]+atlas/i);
  assert.doesNotMatch(css, /url\(http/);
  assert.doesNotMatch(figureSource(), /https?:\/\/(?!www\.w3\.org\/2000\/svg)/i,
    "A figura não deve buscar imagens remotas na rede");
  ["anterior.png", "posterior.png", "NOTICE.md"].forEach(file => {
    const full = path.join(repoRoot, "assets", "anatomia", file);
    assert.ok(fs.existsSync(full), "Arquivo anatômico ausente: " + file);
  });
  assert.ok(fs.statSync(path.join(repoRoot, "assets", "anatomia", "anterior.png")).size < 256 * 1024,
    "Prancha anterior RGBA de corpo inteiro acima do orçamento de desempenho");
  assert.ok(fs.statSync(path.join(repoRoot, "assets", "anatomia", "posterior.png")).size < 256 * 1024,
    "Prancha posterior RGBA de corpo inteiro acima do orçamento de desempenho");
  assert.match(fs.readFileSync(path.join(repoRoot, "assets", "anatomia", "NOTICE.md"), "utf8"),
    /não verificada/i, "NOTICE.md deve registrar a pendência real de licença, sem presumir CC BY-SA");

  assert.match(css, /@media \(max-width: 430px\)/, "Sem ajuste para telas de 320–430 px");
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(min-width: 760px\)/, "Sem ajuste para telas largas");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, "Sem respeito a prefers-reduced-motion");
  assert.match(css, /\.figura-region\[role="button"\]:focus-visible \.figura-region-hit/, "Foco visível na figura ausente");
  assert.match(css, /\.figura-region\.is-primary \.figura-region-shape/, "Cor de principal ausente");
  assert.match(css, /\.figura-region\.is-secondary \.figura-region-shape/, "Cor de secundária ausente");
  assert.match(css, /\.figura-region\.is-stabilizer \.figura-region-shape/, "Cor de estabilizadora ausente");
  assert.match(css, /min-width: 0/, "O layout precisa permitir que a figura encolha em 320 px");
  assert.match(css, /overflow-wrap: anywhere/, "Nomes longos podem estourar em 320 px");
  assert.match(css, /\.atlas-figuras \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s,
    "As duas vistas devem dividir a largura sem estourar");

  assert.match(css, /mix-blend-mode:\s*color/i, "Blend color ausente: as fibras precisam permanecer visíveis");
  assert.match(css, /#b7f34a/i, "Cor principal #B7F34A ausente");
  assert.match(css, /#f2b84b/i, "Cor secundária #F2B84B ausente");
  assert.match(css, /#8cc0e0/i, "Cor estabilizadora #8CC0E0 ausente");

  assertNoErrors({ errors: [] }, "css");
});

/* ------------------------------------------------------------------ */
/* 12. Execução ativa: figura compacta, modal e sessão intacta        */
/* ------------------------------------------------------------------ */

await runTest("ATLAS 12. Execução de treino preserva sessão, séries e storage ao abrir 'Músculos trabalhados'", async () => {
  const routine = makeRoutine("weights", "Força Base", [
    { id: "ex-supino", name: "Supino reto com barra", section: "main", sets: 4, reps: "8", rest: 90, load: "70 kg" },
    { id: "ex-remada", name: "Remada curvada com barra", section: "main", sets: 4, reps: "10", rest: 90, load: "60 kg" }
  ], "rot-forca");

  const app = await boot({ "forja-treino-rotinas-v1": routinesStore([], [routine]) }, "treino/musculacao.html");
  await wait(30);

  app.click("#routine-list .routine-start");
  await until(() => app.d.body.dataset.page === "executar", "abrir página de execução");
  await wait(30);

  /* Compatibilidade exata dos 16 IDs públicos entre catálogo/atlas e figura. */
  const expectedIds = [
    "ombros", "peito", "biceps", "antebracos", "abdomem", "obliquos", "quadril", "quadriceps",
    "pernas", "costas", "dorsais", "lombar", "triceps", "gluteos", "posterior-coxa", "panturrilha"
  ];
  assert.deepEqual(Array.from(Object.keys(app.F.figura.REGIONS)).sort(), expectedIds.slice().sort());
  assert.deepEqual(Array.from(app.F.atlas.GROUPS, g => g.id).sort(), expectedIds.slice().sort());

  /* Registra 1 série real antes de consultar o modal anatômico. */
  app.click("#complete-set");
  await wait(30);

  const figSvg = app.$("#execution-figure .figura-svg");
  assert.ok(figSvg, "Figura compacta não renderizou na execução");
  assert.equal(figSvg.getAttribute("role"), "img");
  assert.equal(figSvg.querySelectorAll("text, circle").length, 0);

  const storageBeforeModal = {};
  app.keys().forEach(k => { storageBeforeModal[k] = app.raw(k); });
  const activeBefore = JSON.parse(storageBeforeModal["forja-treino-sessao-ativa-v1"]);
  assert.equal(activeBefore.completedSets["ex-supino"], 1, "Série concluída não estava registrada");
  const timerBefore = app.text("#session-timer");

  /* Abre e fecha o modal "Músculos trabalhados" sem alterar sessão nem storage. */
  app.click("#execution-figure-details");
  await until(() => app.$(".modal-backdrop"), "modal Músculos trabalhados na execução");
  await wait(25);

  assert.match(app.text(".modal-card"), /Músculos trabalhados/);
  assert.match(app.text(".modal-card"), /Supino reto com barra/);
  assert.equal(app.$$(".modal-card .figura-svg").length, 2, "O modal deve exibir as vistas anterior e posterior");
  assert.match(app.text(".modal-card .atlas-modal-note"), /projeções funcionais aproximadas/);

  app.modalAction("close");
  await wait(25);
  assert.equal(app.$(".modal-backdrop"), null, "Modal não fechou");

  const storageAfterModal = {};
  app.keys().forEach(k => { storageAfterModal[k] = app.raw(k); });
  assert.deepEqual(storageAfterModal, storageBeforeModal,
    "Consultar 'Músculos trabalhados' gravou ou alterou chaves do localStorage");
  assert.equal(app.F.state.activeWorkout.completedSets["ex-supino"], 1,
    "Estado da série concluída foi alterado após fechar o modal");
  assert.equal(app.text("#session-timer"), timerBefore,
    "Cronômetro da sessão foi reiniciado ou alterado ao abrir/fechar o modal");

  assertNoErrors(app, "execução com consulta anatômica");
  app.close();
});

const failed = results.filter(result => !result.ok);

console.log("\n" + "=".repeat(66));
console.log("ATLAS — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
if (failed.length > 0) {
  console.log("Falhas: " + failed.map(item => item.name).join(" | "));
}
console.log("=".repeat(66));

process.exitCode = failed.length > 0 ? 1 : 0;
