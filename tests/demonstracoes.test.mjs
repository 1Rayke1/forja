/*
  Suíte das demonstrações visuais (RepDB local).

  Cobre: integridade do registro/manifesto/licença, resolvedor, seletor,
  persistência do campo opcional `demoId`, compatibilidade de backup e
  ausência de escrita indevida. Usa o mesmo harness jsdom das outras suítes.

  Uso: npm install && node tests/demonstracoes.test.mjs
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  boot,
  closeAllApps,
  makeRoutine,
  repoRoot,
  routinesStore,
  todayKey,
  wait
} from "./helpers/harness.mjs";

const results = [];
const demoDir = path.join(repoRoot, "assets", "demonstracoes");
const pages = [
  "index.html", "treino/index.html", "treino/calistenia.html",
  "treino/musculacao.html", "treino/rotina.html", "treino/executar.html",
  "treino/biblioteca.html", "progresso/index.html", "perfil/index.html",
  "configuracoes/index.html", "explorar/index.html", "explorar/atlas.html",
  "onboarding/index.html"
];

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

const readJson = rel => JSON.parse(fs.readFileSync(path.join(demoDir, rel), "utf8"));
const sha256 = buffer => createHash("sha256").update(buffer).digest("hex");

/* Igual ao helper de paridade: a cópia de segurança é mecanismo, não dado. */
function parsedStorage(app) {
  const out = {};
  app.keys().forEach(key => {
    if (key === "forja-backup-seguranca-v1") return;
    out[key] = app.data(key);
  });
  return out;
}

function routineWithDemo(extra = {}) {
  const routine = makeRoutine("calisthenics", "Treino A", [
    { id: "m1", name: "Flexão de braço", section: "main", sets: 2, reps: "10", rest: 10 }
  ], "r1");
  routine.sections.main[0].libraryId = "cal-flexao";
  Object.assign(routine.sections.main[0], extra);
  return routine;
}

function editorSeed(routine) {
  return { "forja-treino-rotinas-v1": routinesStore([routine], []) };
}

function editorUrl(routine) {
  return "treino/rotina.html?id=" + encodeURIComponent(routine.id) + "&modalidade=calisthenics";
}

async function openPicker(app, selector) {
  app.click(selector);
  await wait(20);
  assert.ok(app.$(".modal-backdrop"), "Seletor não abriu: " + selector);
}

async function chooseAction(app, action, cardSelector) {
  if (cardSelector) app.click(cardSelector);
  app.modalAction(action);
  await wait(50);
}

function savedExercise(app, id) {
  return app.data(app.F.KEYS.routines).calisthenics[0].sections.main.find(item => item.id === id);
}

/* ------------------------------------------------------------------ */
/* 1. Dados, licença e procedência                                     */
/* ------------------------------------------------------------------ */

await runTest("D1. Registro cobre os 37 exercícios com status e candidatos válidos", async () => {
  const mapping = readJson("mapeamento.json");
  const manifest = readJson("manifest.json");
  const labels = readJson("rotulos.json");
  const credits = readJson("creditos.json");

  assert.equal(Object.keys(mapping.exercises).length, 37);
  assert.equal(mapping.source.commit, "b407c5951a027a27817fb2a5cee9ec9feffc4dc7");
  assert.equal(credits.repdb.attribution, "Exercise data by RepDB (repdb.co)");
  assert.equal(credits.repdb.attributionUrl, "https://repdb.co");

  const counts = { exact: 0, review: 0, none: 0 };
  const ids = new Set();
  Object.entries(mapping.exercises).forEach(([key, entry]) => {
    assert.ok(["exact", "review", "none"].includes(entry.status), key);
    counts[entry.status] += 1;
    assert.ok(entry.candidates.length > 0, "sem candidatos: " + key);
    if (entry.status === "none") assert.equal(entry.defaultDemoId, null);
    else assert.ok(entry.defaultDemoId, "sem padrão: " + key);
    if (entry.defaultDemoId) {
      assert.ok(manifest.demos[entry.defaultDemoId], "padrão inexistente: " + key);
    }
    const local = entry.candidates.find(item => item.demoId === entry.defaultDemoId);
    if (entry.status !== "none") {
      assert.equal(local.status, entry.status, "status do padrão divergente: " + key);
    } else {
      assert.ok(entry.candidates.every(item => item.status === "review"),
        "candidato de exercício none precisa ser review: " + key);
    }
    entry.candidates.forEach(item => {
      assert.ok(manifest.demos[item.demoId], "candidato inexistente: " + item.demoId);
      assert.ok(labels[item.demoId.slice(6)], "rótulo ausente: " + item.demoId);
      assert.ok(mapping.reviews[item.demoId], "revisão ausente: " + item.demoId);
      ids.add(item.demoId);
    });
  });

  assert.deepEqual(counts, { exact: 29, review: 5, none: 3 });
  assert.equal(ids.size, 121);
  assert.equal(Object.keys(manifest.demos).length, 121);
});

await runTest("D2. Manifesto: hashes, tamanho real, licença e bundle sincronizados", async () => {
  const manifest = readJson("manifest.json");
  const mapping = readJson("mapeamento.json");
  const labels = readJson("rotulos.json");
  const credits = readJson("creditos.json");
  const bundle = fs.readFileSync(path.join(repoRoot, "assets/js/forja-demonstracoes-dados.js"), "utf8");

  let total = 0;
  Object.entries(manifest.files).forEach(([name, meta]) => {
    assert.match(name, /^[\w.-]+\.webp$/);
    assert.ok(!meta.upstreamPath.includes("premium-samples"));
    assert.match(meta.sourceUrl, /^https:\/\/github\.com\/RepDB\/exercise-dataset\/blob\/b407c59/);
    const buffer = fs.readFileSync(path.join(demoDir, name));
    assert.equal(sha256(buffer), meta.sha256, "hash divergente: " + name);
    assert.equal(buffer.length, meta.bytes, "tamanho divergente: " + name);
    assert.equal(buffer.subarray(0, 4).toString(), "RIFF", "não é WebP: " + name);
    total += buffer.length;
  });

  assert.equal(total, manifest.totalBytes);
  assert.equal(Object.keys(manifest.files).length, manifest.totalFiles);
  assert.ok(total <= 3.6 * 1024 * 1024, "catálogo acima de 3,6 MiB");
  assert.ok(total > 0);

  Object.values(manifest.demos).forEach(demo => {
    assert.equal(demo.creditId, "repdb");
    assert.ok(manifest.files[demo.thumb], "thumb ausente: " + demo.thumb);
    assert.match(demo.sourceUrl, /^https:\/\/github\.com\/RepDB\/exercise-dataset\/blob\/b407c59/);
    demo.poses.forEach(pose => assert.ok(manifest.files[pose.file], "arquivo ausente: " + pose.file));
  });

  assert.ok(fs.existsSync(path.join(demoDir, "LICENSE-DATA.md")));
  assert.ok(fs.existsSync(path.join(demoDir, "ATTRIBUTION.md")));
  assert.ok(fs.existsSync(path.join(demoDir, "NOTICE.md")));
  const license = fs.readFileSync(path.join(demoDir, "LICENSE-DATA.md"), "utf8");
  assert.match(license, /No generative-AI derivation/);
  assert.match(license, /Attribution required/);

  const dataMatch = bundle.match(/FORJA_DEMOS_DATA = Object\.freeze\((.*)\);\s*\}\)\(window\);/s);
  assert.ok(dataMatch, "bundle sem payload congelado");
  const payload = JSON.parse(dataMatch[1]);
  assert.equal(payload.source.commit, mapping.source.commit);
  assert.equal(Object.keys(payload.demos).length, 121);
  assert.equal(Object.keys(payload.exercicios).length, 37);
  assert.equal(payload.creditos.repdb.attribution, credits.repdb.attribution);
  Object.keys(labels).forEach(id => assert.ok(payload.demos["repdb:" + id], "rótulo órfão: " + id));
  Object.values(payload.demos).forEach(demo => {
    assert.ok(demo.l && demo.n && demo.c && demo.t && demo.p.length);
    demo.p.forEach(pose => assert.ok(manifest.files[pose[1]], "arquivo ausente: " + pose[1]));
  });
  assert.ok(!/premium-samples/.test(JSON.stringify(manifest.files)));
});

await runTest("D3. Confirmações documentadas, sem revisão atribuída ao usuário", async () => {
  const mapping = readJson("mapeamento.json");
  const checks = { confirmed: 0, approximate: 0, pending: 0, rejected: 0 };
  Object.entries(mapping.reviews).forEach(([demoId, review]) => {
    assert.ok(["confirmed", "approximate", "pending", "rejected"].includes(review.visualCheck));
    checks[review.visualCheck] += 1;
    if (review.visualCheck === "pending") {
      assert.equal(review.reviewedBy, null);
    } else {
      assert.ok(review.reviewedBy, "revisor ausente: " + demoId);
      assert.ok(review.method, "método ausente: " + demoId);
      assert.ok(review.evidenceFiles.length > 0, "evidência ausente: " + demoId);
      assert.ok(!/usu[aá]rio do FORJA/i.test(review.reviewedBy),
        "revisão atribuída ao usuário: " + demoId);
    }
  });
  assert.equal(checks.confirmed, 28);
  assert.equal(checks.approximate, 19);
  assert.equal(checks.pending, 74);
  assert.equal(checks.rejected, 0);
  assert.match(mapping.policy.reviewerNote, /não.*usuário/i);
  assert.match(mapping.policy.confirmationRule, /exact/);
  assert.match(mapping.policy.confirmationRule, /confirmed/);
});

await runTest("D4. Atribuição visível nas 13 páginas e na tela de créditos", async () => {
  pages.forEach(page => {
    const html = fs.readFileSync(path.join(repoRoot, page), "utf8");
    assert.match(html, /Exercise data by/, "sem atribuição em " + page);
    assert.match(html, /href="https:\/\/repdb\.co"/, "sem link repdb.co em " + page);
    assert.match(html, /data-external-credit="repdb"/, "link externo sem marcação em " + page);
    assert.match(html, /rel="noopener noreferrer"/, "sem rel=noopener em " + page);
    assert.match(html, /demonstracoes\.css/, "sem CSS em " + page);
    assert.match(html, /forja-demonstracoes-dados\.js/, "sem bundle em " + page);
    assert.match(html, /forja-demonstracoes\.js/, "sem módulo em " + page);
    assert.ok(html.indexOf("forja-demonstracoes-dados.js") < html.indexOf("forja-demonstracoes.js"),
      "ordem dos scripts em " + page);
    assert.ok(html.indexOf("forja-demonstracoes.js") < html.indexOf("forja-app.js"),
      "boot antes do módulo em " + page);
  });
  const config = fs.readFileSync(path.join(repoRoot, "configuracoes/index.html"), "utf8");
  assert.match(config, /id="creditos-imagens"/);
  assert.match(config, /LICENSE-DATA\.md/);
  assert.match(config, /manifest\.json/);
  assert.match(config, /SHA-256/);
  assert.match(fs.readFileSync(path.join(repoRoot, "README.md"), "utf8"), /Exercise data by/);
});

/* ------------------------------------------------------------------ */
/* 2. Resolvedor e validação                                            */
/* ------------------------------------------------------------------ */

await runTest("D5. normalizeDemoId aceita ids curtos e 'none', rejeita lixo", async () => {
  const app = await boot({}, "index.html");
  assert.equal(app.F.normalizeDemoId("repdb:push-up"), "repdb:push-up");
  assert.equal(app.F.normalizeDemoId("none"), "none");
  assert.equal(app.F.normalizeDemoId(null), null);
  assert.equal(app.F.normalizeDemoId(42), null);
  assert.equal(app.F.normalizeDemoId("repdb:push up"), null);
  assert.equal(app.F.normalizeDemoId("http://evil.example/x"), null);
  assert.equal(app.F.normalizeDemoId("x".repeat(90)), null);
  assert.equal(app.F.BACKUP_VERSION, 1);
  assert.equal(app.F.DATA_VERSION, 3);
  assert.equal(app.F.KEYS.demos, undefined, "criou chave nova de storage");
  app.close();
});

await runTest("D6. Resolvedor: exact confirmado, review com selo, none e stale", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const D = app.F.demos;

  const exact = D.resolve({ libraryId: "cal-flexao", id: "c1" }, "calisthenics");
  assert.equal(exact.demoId, "repdb:push-up");
  assert.equal(exact.status, "exact");
  assert.equal(exact.confirmation, "confirmed");
  assert.equal(exact.credit.label, "RepDB");

  const approximate = D.resolve({ libraryId: "mus-esteira", id: "c2" }, "weights");
  assert.equal(approximate.status, "review");
  assert.equal(approximate.confirmation, "review");

  assert.equal(D.resolve({ libraryId: "cal-rotacao-ombros", id: "c3" }, "calisthenics"), null);
  assert.match(D.fallbackText({ libraryId: "cal-rotacao-ombros" }), /Demonstração visual ainda não disponível/);

  const custom = { id: "custom-1", name: "Flexão de braço", sets: 3 };
  assert.equal(D.resolve(custom, "calisthenics"), null, "nome igual não autoriza imagem");
  assert.equal(D.entryFor(custom, "calisthenics"), null);

  const stale = D.resolve({ libraryId: "cal-flexao", id: "c4", demoId: "repdb:nao-existe" }, "calisthenics");
  assert.equal(stale.stale, true);
  assert.equal(stale.demoId, "repdb:push-up", "id morto deve voltar ao padrão");

  assert.equal(D.resolve({ libraryId: "cal-flexao", id: "c5", demoId: "none" }, "calisthenics"), null);
  assert.match(D.fallbackText({ demoId: "none" }), /Sem demonstração/);

  const chosen = D.resolve({ libraryId: "cal-flexao", id: "c6", demoId: "repdb:plyo-push-up" }, "calisthenics");
  assert.equal(chosen.explicit, true);
  assert.equal(chosen.confirmation, "review");

  const manual = D.resolve({ id: "custom-1", name: "Meu exercício", demoId: "repdb:push-up" }, "calisthenics");
  assert.equal(manual.confirmation, "review", "escolha manual nunca é confirmação automática");
  app.close();
});

await runTest("D7. Candidatos: ordenação, selos e catálogo manual para personalizado", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const D = app.F.demos;
  const list = D.candidatesFor({ libraryId: "cal-flexao" }, "calisthenics");
  assert.ok(list.length >= 4);
  assert.equal(list[0].demoId, "repdb:push-up");
  assert.equal(list[0].confirmation, "confirmed");
  assert.ok(list.slice(1).every(item => item.confirmation === "review"));

  const custom = D.candidatesFor({ id: "custom-1", name: "Flexão de braço" }, "calisthenics");
  assert.equal(custom.length, 121, "personalizado deve navegar por todo o catálogo");
  assert.ok(custom.every(item => item.confirmation === "review"),
    "escolha manual nunca é confirmação automática");
  app.close();
});

/* ------------------------------------------------------------------ */
/* 3. Interface                                                         */
/* ------------------------------------------------------------------ */

await runTest("D8. Detalhe do catálogo mostra ilustração, créditos e fallback", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const items = app.F.catalog.items("calisthenics");
  const flexao = items.find(item => item.id === "cal-flexao");
  const none = items.find(item => item.id === "cal-rotacao-ombros");

  app.F.catalog.showDetail(flexao, { readOnly: true });
  await wait(20);
  assert.ok(app.$(".modal-details .demo-media"), "sem ilustração");
  assert.equal(app.$(".demo-media").getAttribute("data-demo-id"), "repdb:push-up");
  assert.equal(app.$(".demo-media").getAttribute("data-confirmation"), "confirmed");
  assert.match(app.text(".demo-credit"), /RepDB/);
  assert.ok(!app.text(".modal-details").includes("Demonstração visual ainda não disponível"));
  app.modalAction("cancel");
  await wait(25);

  app.F.catalog.showDetail(none, { readOnly: true });
  await wait(20);
  assert.equal(app.$(".modal-details .demo-media"), null);
  assert.match(app.text(".modal-details"), /Demonstração visual ainda não disponível/);
  app.modalAction("cancel");
  await wait(25);
  app.close();
});

await runTest("D9. Seletor na linha: busca, selo, confirmar, Sem demonstração e remover", async () => {
  const routine = routineWithDemo();
  const app = await boot(editorSeed(routine), editorUrl(routine));

  await openPicker(app, '.editor-exercise .demo-row-button');
  assert.ok(app.$(".demo-picker"), "sem painel do seletor");
  assert.ok(app.$$(".demo-card").length >= 4);
  assert.match(app.text(".demo-picker-notice"), /Precisa de revisão/);
  assert.ok(app.$(".demo-card-status.is-review"), "sem selo de revisão");

  const search = app.$(".demo-picker-input");
  search.value = "aranha";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  assert.ok(app.$$(".demo-card").length >= 1);
  assert.ok(app.$$(".demo-card").every(card => /aranha/i.test(card.textContent)));
  search.value = "zzzzzzz-nao-existe";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  assert.match(app.text(".demo-picker-empty-list"), /Nenhuma imagem encontrada/);
  search.value = "";
  search.dispatchEvent(new app.w.Event("input", { bubbles: true }));

  /* Confirmar sem seleção é bloqueado pelo validate. */
  await chooseAction(app, "confirm");
  assert.ok(app.$(".modal-backdrop"), "confirmar sem seleção fechou o modal");
  await chooseAction(app, "confirm", '.demo-card[data-demo-id="repdb:spiderman-push-up"]');
  assert.equal(app.$(".modal-backdrop"), null, "modal não fechou após confirmar");
  assert.equal(app.F.hasUnsavedRoutine(), true);

  app.click("#save-routine-top");
  await wait(40);
  assert.equal(savedExercise(app, "m1").demoId, "repdb:spiderman-push-up");

  app.click('.editor-exercise[data-exercise-id="m1"] .exercise-tools button');
  await wait(20);
  assert.equal(app.$(".demo-media").getAttribute("data-demo-id"), "repdb:spiderman-push-up");
  assert.equal(app.$(".demo-media").getAttribute("data-confirmation"), "review");
  assert.match(app.text(".demo-badge"), /Precisa de revisão/);
  app.modalAction("cancel");
  await wait(25);

  await openPicker(app, '.editor-exercise .demo-row-button');
  await chooseAction(app, "none");
  app.click("#save-routine-top");
  await wait(40);
  assert.equal(savedExercise(app, "m1").demoId, "none");

  await openPicker(app, '.editor-exercise .demo-row-button');
  await chooseAction(app, "remove");
  app.click("#save-routine-top");
  await wait(40);
  assert.equal(savedExercise(app, "m1").demoId, undefined);
  app.close();
});

await runTest("D10. Seletor no formulário: escolha pendente e cancelar não grava", async () => {
  const routine = routineWithDemo();
  const app = await boot(editorSeed(routine), editorUrl(routine));
  const before = app.raw(app.F.KEYS.routines);
  const writes = app.storageWrites.length;

  await openPicker(app, "#exercise-demo-button");
  assert.ok(app.$(".demo-picker"));
  /* Formulário novo = navegação manual paginada; usa a busca para achar o card. */
  const formSearch = app.$(".demo-picker-input");
  formSearch.value = "pliométrica";
  formSearch.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  await chooseAction(app, "confirm", '.demo-card[data-demo-id="repdb:plyo-push-up"]');
  assert.equal(app.raw(app.F.KEYS.routines), before, "escolha pendente gravou no storage");
  assert.equal(app.storageWrites.length, writes, "escolha pendente gravou algo");

  app.$("#exercise-name").value = "Flexão pliométrica nova";
  app.$("#exercise-reps").value = "8";
  app.$("#exercise-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);
  assert.equal(app.$$(".editor-exercise").length, 2);
  app.click("#save-routine-top");
  await wait(40);
  const added = app.data(app.F.KEYS.routines).calisthenics[0].sections.main
    .find(item => item.name === "Flexão pliométrica nova");
  assert.ok(added, "exercício não foi adicionado");
  assert.equal(added.demoId, "repdb:plyo-push-up");

  /* Escolha pendente cancelada pela edição não entra em m1. */
  app.click('.editor-exercise[data-exercise-id="m1"] .exercise-tools button[aria-label^="Editar"]');
  await openPicker(app, "#exercise-demo-button");
  await chooseAction(app, "confirm", '.demo-card[data-demo-id="repdb:spiderman-push-up"]');
  app.click("#cancel-exercise-edit");
  await wait(20);
  app.click("#save-routine-top");
  await wait(40);
  assert.equal(savedExercise(app, "m1").demoId, undefined,
    "cancelar edição gravou escolha não confirmada");
  app.close();
});

await runTest("D11. Sem alternativas válidas: mensagem, fallback mantido e zero escrita", async () => {
  const routine = routineWithDemo();
  const app = await boot(editorSeed(routine), editorUrl(routine));
  const before = app.raw(app.F.KEYS.routines);
  const writes = app.storageWrites.length;
  app.F.demos.candidatesFor = () => [];

  await openPicker(app, '.editor-exercise .demo-row-button');
  assert.equal(app.$(".demo-picker"), null);
  assert.match(app.text(".demo-picker-empty"), /Nenhuma imagem encontrada/);
  assert.match(app.text(".demo-picker-empty"), /mantida/);
  await chooseAction(app, "cancel");
  assert.equal(app.raw(app.F.KEYS.routines), before);
  assert.equal(app.storageWrites.length, writes);
  assert.equal(app.F.state.routines.calisthenics[0].sections.main[0].demoId, undefined);
  app.close();
});

await runTest("D12. Exercício personalizado não ganha imagem por nome", async () => {
  const routine = makeRoutine("calisthenics", "Treino custom", [
    { id: "x1", name: "Flexão de braço", section: "main", sets: 3, reps: "10", rest: 10 }
  ], "r2");
  const app = await boot(editorSeed(routine), editorUrl(routine));
  const record = app.F.catalog.describeExercise(routine.sections.main[0], "calisthenics");
  assert.equal(app.F.demos.resolve(record, "calisthenics"), null);
  assert.equal(app.F.demos.entryFor(record, "calisthenics"), null);

  await openPicker(app, '.editor-exercise .demo-row-button');
  assert.equal(app.$$(".demo-card").length, 12, "deve paginar o catálogo manual");
  assert.ok(app.$(".demo-picker-more"), "sem Mostrar mais");
  app.click(".demo-picker-more");
  assert.ok(app.$$(".demo-card").length > 12);
  await chooseAction(app, "cancel");
  assert.equal(app.F.state.routines.calisthenics[0].sections.main[0].demoId, undefined);
  app.close();
});

/* ------------------------------------------------------------------ */
/* 4. Persistência, backup e sessão                                     */
/* ------------------------------------------------------------------ */

await runTest("D13. Salvar e reabrir preserva demoId; editar séries não apaga", async () => {
  const routine = routineWithDemo({ demoId: "repdb:spiderman-push-up" });
  const app = await boot(editorSeed(routine), editorUrl(routine));
  assert.equal(app.F.state.routines.calisthenics[0].sections.main[0].demoId,
    "repdb:spiderman-push-up");

  const editButton = app.$('.editor-exercise[data-exercise-id="m1"] .exercise-tools button[aria-label^="Editar"]');
  app.click(editButton);
  app.$("#exercise-sets").value = "5";
  app.$("#exercise-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(20);
  app.click("#save-routine-top");
  await wait(40);

  const saved = savedExercise(app, "m1");
  assert.equal(saved.sets, 5);
  assert.equal(saved.demoId, "repdb:spiderman-push-up", "editar apagou a imagem");

  await app.reload();
  assert.equal(app.F.state.routines.calisthenics[0].sections.main[0].demoId,
    "repdb:spiderman-push-up", "reabrir perdeu a imagem");
  app.close();
});

await runTest("D14. Backup antigo importa; backup novo preserva demoId", async () => {
  const routine = routineWithDemo({ demoId: "repdb:plyo-push-up" });
  const seed = editorSeed(routine);
  seed["forja-missoes-" + todayKey()] = [{ id: "q1", text: "Missão", done: false }];
  const app = await boot(seed, "configuracoes/index.html");
  const original = parsedStorage(app);
  const backup = app.F.buildBackupObject();
  assert.equal(backup.version, 1);
  assert.equal(backup.keys["forja-treino-rotinas-v1"].calisthenics[0].sections.main[0].demoId,
    "repdb:plyo-push-up");

  app.set("forja-treino-rotinas-v1", routinesStore([], []));
  const mutated = parsedStorage(app);
  await app.importFile(backup);
  app.modalAction("restore");
  await wait(220);
  assert.deepEqual(parsedStorage(app), original, "restauração alterou chaves");
  assert.equal(app.F.state.routines.calisthenics[0].sections.main[0].demoId,
    "repdb:plyo-push-up");

  /* Desfazer volta ao estado anterior (sem demoId); refazer devolve o campo. */
  app.click("#restore-safety-backup");
  await wait(40);
  app.modalAction("restore");
  await wait(220);
  assert.deepEqual(parsedStorage(app), mutated, "desfazer não restaurou o anterior");
  await app.importFile(backup);
  app.modalAction("restore");
  await wait(220);
  assert.equal(app.F.state.routines.calisthenics[0].sections.main[0].demoId,
    "repdb:plyo-push-up", "refazer perdeu o demoId");

  const oldRoutine = routineWithDemo();
  delete oldRoutine.sections.main[0].demoId;
  const oldBackup = {
    app: "FORJA", format: "forja-backup", version: 1,
    exportedAt: new Date().toISOString(),
    keys: { "forja-treino-rotinas-v1": routinesStore([oldRoutine], []) }
  };
  await app.importFile(oldBackup);
  app.modalAction("restore");
  await wait(220);
  assert.equal(app.F.state.routines.calisthenics[0].sections.main[0].demoId, undefined);
  assert.equal(app.F.demos.resolve(
    app.F.state.routines.calisthenics[0].sections.main[0], "calisthenics").demoId,
    "repdb:push-up", "sem demoId deve usar o padrão");
  app.close();
});

await runTest("D15. demoId malformado é rejeitado no backup e descartado no boot", async () => {
  const routine = routineWithDemo({ demoId: "repdb:valor com espaço" });
  const app = await boot({}, "configuracoes/index.html");
  const badBackup = {
    app: "FORJA", format: "forja-backup", version: 1,
    keys: { "forja-treino-rotinas-v1": routinesStore([routine], []) }
  };
  await app.importFile(badBackup);
  await wait(120);
  assert.equal(app.raw("forja-treino-rotinas-v1"), null, "backup inválido foi importado");
  app.close();

  const app2 = await boot(editorSeed(routineWithDemo({ demoId: "http://evil" })),
    "treino/rotina.html?id=r1&modalidade=calisthenics");
  assert.equal(app2.F.state.routines.calisthenics[0].sections.main[0].demoId, undefined);
  app2.close();
});

await runTest("D16. Sessão e execução preservam a imagem personalizada", async () => {
  const routine = routineWithDemo({ demoId: "repdb:plyo-push-up" });
  const exercise = routine.sections.main[0];
  const active = {
    version: 2, id: "session-demo", date: todayKey(),
    modality: "calisthenics", routineId: routine.id, routineName: routine.name,
    startedAt: 1000, elapsedMs: 0, running: true, currentIndex: 0,
    completedSets: { m1: 0 }, totalPlannedSets: exercise.sets,
    queue: [Object.assign({}, exercise, { section: "main" })],
    status: "active", restEndAt: null, restRemainingMs: 0, restPaused: false,
    pendingAdvance: false, restPlannedSeconds: 0, setTimer: null,
    setLogs: {}, logDraft: {}
  };
  const seed = editorSeed(routine);
  seed["forja-treino-sessao-ativa-v1"] = active;
  const app = await boot(seed, "treino/executar.html", { now: 1000 });
  assert.equal(app.F.state.activeWorkout.queue[0].demoId, "repdb:plyo-push-up");
  assert.ok(app.$("#execution-demo .demo-media"), "sem ilustração na execução");
  assert.equal(app.$("#execution-demo .demo-media").getAttribute("data-demo-id"),
    "repdb:plyo-push-up");
  assert.match(app.text("#execution-demo .demo-credit"), /RepDB/);
  assert.ok(app.$("#execution-figure"), "figura do atlas continua presente");

  app.click("#execution-instructions");
  await wait(20);
  assert.equal(app.$(".modal-details .demo-media").getAttribute("data-demo-id"),
    "repdb:plyo-push-up", "modal readOnly perdeu a escolha");
  app.modalAction("cancel");
  await wait(25);
  app.close();
});

await runTest("D17. Abrir páginas e cancelar seletor não gravam nada nem criam chave", async () => {
  for (const page of pages) {
    const app = await boot({}, page);
    assert.deepEqual(app.storageWrites.filter(item => item.method === "setItem"), [],
      "escrita ao abrir " + page);
    assert.equal(app.keys().some(key => key.includes("demos")), false,
      "chave nova criada em " + page);
    app.close();
  }

  const routine = routineWithDemo();
  const app = await boot(editorSeed(routine), editorUrl(routine));
  const writes = app.storageWrites.length;
  await openPicker(app, '.editor-exercise .demo-row-button');
  await chooseAction(app, "cancel", '.demo-card[data-demo-id="repdb:spiderman-push-up"]');
  assert.equal(app.storageWrites.length, writes, "cancelar gravou no storage");
  assert.equal(app.F.state.routines.calisthenics[0].sections.main[0].demoId, undefined);
  app.close();
});

const failed = results.filter(result => !result.ok);
console.log("\n" + "=".repeat(66));
console.log("DEMONSTRAÇÕES — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
if (failed.length > 0) {
  console.log("Falhas: " + failed.map(item => item.name).join(" | "));
}
console.log("=".repeat(66));
process.exitCode = failed.length > 0 ? 1 : 0;
