import assert from "node:assert/strict";
import { boot, closeAllApps, wait } from "./helpers/harness.mjs";

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(name); console.log("✅ " + name); }
  catch (error) { console.error("❌ " + name + "\n", error); process.exitCode = 1; }
}

const approvedFixture = {
  exerciseId: "cal-flexao", videoId: "abc123def45", youtubeUrl: "https://www.youtube.com/watch?v=abc123def45",
  title: "Flexão — demonstração de teste", channelTitle: "Canal de teste", durationSeconds: 45,
  visibility: "public", embeddable: true, orientation: "horizontal", aspectRatio: "16:9",
  status: "validated", reviewedAt: "2026-11-06T18:00:00.000Z", updatedAt: "2026-11-06T18:00:00.000Z"
};
const emptyReport = { total: 165, approved: 0, pending: 165, review: 0, rejected: 0, unavailable: 0, coveragePercent: 0, withoutVideo: [], inconsistencies: [] };
const json = payload => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

await test("YF01. Sem associação aprovada, a biblioteca mantém a imagem de referência", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  app.w.fetch = async () => json({ associations: [], report: emptyReport });
  const row = app.$$("#catalog-list .ui-exercise-row").find(node => node.querySelector(".ui-exercise-name")?.textContent === "Flexão de braço");
  row.querySelector(".ui-exercise-actions button").click();
  await wait(40);
  assert.ok(app.$(".modal-backdrop")); assert.equal(app.$(".youtube-player"), null);
  assert.ok(app.$(".modal-details .demo-media")); assert.equal(app.$(".modal-details .demo-media").hidden, false);
  assert.deepEqual(app.storageWrites, []); app.close();
});

await test("YF02. Vídeo aprovado cria player nocookie 16:9, mudo, sem autoplay e com controles", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  app.w.fetch = async () => json({ associations: [approvedFixture], report: { ...emptyReport, approved: 1, pending: 164 } });
  const row = app.$$("#catalog-list .ui-exercise-row").find(node => node.querySelector(".ui-exercise-name")?.textContent === "Flexão de braço");
  row.querySelector(".ui-exercise-actions button").click(); await wait(40);
  const iframe = app.$(".youtube-player"); assert.ok(iframe);
  const url = new URL(iframe.src);
  assert.equal(url.hostname, "www.youtube-nocookie.com"); assert.equal(url.pathname, "/embed/abc123def45");
  assert.equal(url.searchParams.get("autoplay"), "0"); assert.equal(url.searchParams.get("mute"), "1");
  assert.equal(url.searchParams.get("controls"), "1"); assert.equal(url.searchParams.get("playsinline"), "1");
  assert.equal(iframe.width, "1280"); assert.equal(iframe.height, "720");
  assert.equal(iframe.closest(".youtube-media").dataset.exerciseId, "cal-flexao");
  assert.equal(app.$(".modal-details .demo-media").hidden, true);
  assert.deepEqual(app.storageWrites, []); app.close();
});

await test("YF03. Falha do player restaura a imagem e sinaliza revisão administrativa", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  app.w.fetch = async () => json({ associations: [approvedFixture], report: emptyReport });
  const row = app.$$("#catalog-list .ui-exercise-row").find(node => node.querySelector(".ui-exercise-name")?.textContent === "Flexão de braço");
  row.querySelector(".ui-exercise-actions button").click(); await wait(40);
  app.$(".youtube-player").dispatchEvent(new app.w.Event("error")); await wait(10);
  assert.match(app.text(".youtube-unavailable"), /revisão administrativa/i);
  assert.equal(app.$(".modal-details .demo-media").hidden, false); app.close();
});

await test("YF04. Falha do endpoint não remove o fallback nem grava dados", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  app.w.fetch = async () => { throw new Error("offline"); };
  const row = app.$$("#catalog-list .ui-exercise-row").find(node => node.querySelector(".ui-exercise-name")?.textContent === "Flexão de braço");
  row.querySelector(".ui-exercise-actions button").click(); await wait(40);
  assert.equal(app.$(".youtube-player"), null); assert.ok(app.$(".modal-details .demo-media"));
  assert.deepEqual(app.storageWrites, []); app.close();
});

await test("YF05. Exercício personalizado nunca recebe vídeo por semelhança de nome", async () => {
  const app = await boot({ "forja-treino-biblioteca-v1": { calisthenics: [{ id: "custom-flexao", name: "Flexão de braço", mode: "calisthenics", section: "main", type: "reps", sets: 3, reps: "10", rest: 60 }], weights: [] } }, "treino/biblioteca.html");
  app.w.fetch = async () => json({ associations: [approvedFixture], report: emptyReport });
  /* O cartão do usuário é identificado pelo dado, não por semelhança de nome. */
  const row = app.$('#catalog-list .ui-exercise-row[data-origin="pessoal"]');
  assert.ok(row, "Exercício personalizado não apareceu na biblioteca");
  assert.match(row.textContent, /Seu exercício/, "O cartão do usuário precisa se identificar como dele");
  row.querySelector("button").click(); await wait(30);
  assert.equal(app.$(".youtube-player"), null); app.close();
});

await test("YF06. Painel mantém credencial fora do storage e envia Authorization ao backend", async () => {
  const app = await boot({}, "admin/exercicios.html");
  let authorization = null;
  app.w.fetch = async (url, options) => { authorization = options.headers.authorization; return json({ associations: [], report: emptyReport }); };
  app.$("#admin-credential").value = "credential-only-in-memory";
  app.$("#auth-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true })); await wait(30);
  assert.equal(authorization, "Bearer credential-only-in-memory");
  assert.equal(app.$("#admin-credential").value, "");
  assert.equal(app.raw("FORJA_ADMIN_CREDENTIAL"), null);
  assert.deepEqual(app.w.sessionStorage.length, 0); assert.deepEqual(app.storageWrites, []);
  assert.match(app.text("#report"), /165/); app.close();
});

await test("YF07. Painel pesquisa por exerciseId e seleciona vídeo para revisão manual", async () => {
  const app = await boot({}, "admin/exercicios.html");
  let searchBody = null;
  app.w.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.action === "dashboard") return json({ associations: [], report: emptyReport });
    if (body.action === "search") {
      searchBody = body;
      return json({ cached: false, items: [{ ...approvedFixture, thumbnailUrl: "https://i.ytimg.com/vi/abc123def45/hqdefault.jpg", eligible: true, rejectionReasons: [] }] });
    }
    throw new Error("unexpected");
  };
  app.$("#admin-credential").value = "admin"; app.$("#auth-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true })); await wait(20);
  app.$("#exercise-search").value = "cal-flexao"; app.$("#exercise-search").dispatchEvent(new app.w.Event("input", { bubbles: true }));
  app.$$(".exercise-item").find(node => node.textContent.includes("cal-flexao") && !node.textContent.includes("argolas")).click();
  assert.match(app.$("#video-query").value, /Flexão de braço/);
  app.$("#video-search-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true })); await wait(30);
  assert.equal(searchBody.exerciseId, "cal-flexao"); assert.ok(searchBody.query.includes("Flexão"));
  const buttons = app.$$(".video-card button"); buttons[1].click();
  assert.equal(app.$("#review-form").hidden, false); assert.equal(app.$("#approve-video").disabled, false);
  assert.equal(app.$("#review-form input[name=notShorts]").checked, false); app.close();
});

await test("YF08. Aprovação no painel envia ID estável e todas as confirmações visuais", async () => {
  const app = await boot({}, "admin/exercicios.html");
  let saveBody = null; let approved = false;
  app.w.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.action === "dashboard") return json({ associations: approved ? [approvedFixture] : [], report: approved ? { ...emptyReport, approved: 1, pending: 164, coveragePercent: 0.61 } : emptyReport });
    if (body.action === "search") return json({ items: [{ ...approvedFixture, thumbnailUrl: "https://i.ytimg.com/vi/abc123def45/hqdefault.jpg", eligible: true, rejectionReasons: [] }] });
    if (body.action === "save") { saveBody = body; approved = true; return json({ association: approvedFixture }); }
    throw new Error("unexpected");
  };
  app.$("#admin-credential").value = "admin"; app.$("#auth-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true })); await wait(20);
  app.$("#exercise-search").value = "cal-flexao"; app.$("#exercise-search").dispatchEvent(new app.w.Event("input", { bubbles: true }));
  app.$$(".exercise-item").find(node => node.textContent.includes("cal-flexao") && !node.textContent.includes("argolas")).click();
  app.$("#video-search-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true })); await wait(20);
  app.$$(".video-card button")[1].click();
  app.$$("#review-form input[type=checkbox]").forEach(input => { input.checked = true; });
  app.$("#review-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true })); await wait(30);
  assert.equal(saveBody.exerciseId, "cal-flexao"); assert.equal(saveBody.videoId, "abc123def45"); assert.equal(saveBody.status, "validated");
  assert.ok(Object.values(saveBody.review).every(Boolean)); assert.match(app.text("#operation-status"), /persistida/); app.close();
});

closeAllApps();
console.log("\n============================================================");
console.log("YOUTUBE FRONTEND — " + results.length + "/8 testes aprovados");
console.log("============================================================");
