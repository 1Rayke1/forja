/*
  FORJA — tela de Configurações (hub, painéis, nome, aparência e integrações).
  Executa as páginas reais no jsdom, com o mesmo localStorage entre navegações.
  Uso: node tests/configuracoes.test.mjs (incluído em npm test).
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, boot, closeAllApps, assertNoErrors, wait } from "./helpers/harness.mjs";
import { installFailingStorage } from "./helpers/legacy-flows.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = "configuracoes/index.html";
const PROFILE_KEY = "forja-perfil-v1";
const PREFS_KEY = "forja-preferencias-v1";
const APPEARANCE_KEY = "forja-aparencia-v1";
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const plain = value => JSON.parse(JSON.stringify(value));
const profileSeed = extra => Object.assign({
  version: 3,
  updatedAt: "2026-01-02T03:04:05.000Z",
  objetivo: "hipertrofia",
  nivel: "intermediario",
  equipamento: "academia"
}, extra);

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("✅ " + name);
  } catch (error) {
    failures.push({ name, error });
    console.error("❌ " + name + "\n   " + (error.stack || error.message));
  } finally {
    closeAllApps();
  }
}
async function openPanel(app, hash) {
  app.w.location.hash = hash;
  await wait(60);
}
function submit(app, selector) {
  app.$(selector).dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
}
function change(app, selector) {
  app.$(selector).dispatchEvent(new app.w.Event("change", { bubbles: true }));
}

await test("C1. Hub fiel à referência: grupos, nove destinos reais e barra inferior preservada", async () => {
  const app = await boot({ [PROFILE_KEY]: profileSeed({ nomeExibicao: "Ravy", onboardingConcluidoEm: "2026-02-03T00:00:00.000Z" }) }, PAGE);
  assert.equal(app.text("#settings-title"), "Configurações");
  assert.deepEqual(app.$$(".settings-group-title").map(node => node.textContent), ["Perfil", "Aplicativo", "Suporte"]);
  assert.deepEqual(app.$$(".settings-row strong").map(node => node.textContent), [
    "Editar perfil", "Minhas metas", "Preferências de treino",
    "Notificações", "Aparência", "Privacidade e dados",
    "Central de ajuda", "Fale conosco", "Sobre o FORJA"
  ]);
  assert.equal(app.text("#settings-profile-name"), "Ravy");
  assert.equal(app.text("#settings-profile-since"), "Membro desde 2026");
  assert.equal(app.$$("#inicio .settings-row").length, 9);
  assert.equal(app.$$(".bottom-nav-link").length, 5);
  assert.equal(app.$('.bottom-nav-link[aria-current="page"]').dataset.nav, "perfil");
  assert.equal(app.$("#settings-exit").getAttribute("href"), "../index.html");
  assert.match(app.$("#settings-exit").textContent, /Sair das configurações/);
  assert.equal(app.$("#settings-goals-link").getAttribute("href"), "../progresso/index.html#progress-goals-heading");
  assert.equal(app.$("#settings-training-link").getAttribute("href"), "../treino/index.html#preferences-heading");
  assert.deepEqual(app.storageWrites, []);
  assertNoErrors(app, "hub");
});

await test("C2. Nome ausente/legado nunca vira demonstração; data de membro só vem do cadastro", async () => {
  const anonymous = await boot({ [PROFILE_KEY]: profileSeed() }, PAGE);
  assert.equal(anonymous.text("#settings-profile-name"), "Seu perfil");
  assert.equal(anonymous.text("#settings-profile-since"), "Perfil desde 2026");
  assert.equal(anonymous.$("#prof-nome").value, "");
  assertNoErrors(anonymous);
  anonymous.close();

  const legacy = await boot({ [PROFILE_KEY]: { version: 1, updatedAt: "2024-05-01T00:00:00.000Z", nomeExibicao: "  Ana   Maria  ", campoFuturo: { manter: true } } }, PAGE);
  assert.equal(legacy.text("#settings-profile-name"), "Ana");
  assert.equal(legacy.text("#settings-profile-since"), "Perfil desde 2024");
  assert.equal(legacy.$("#prof-nome").value, "Ana Maria");
  assert.deepEqual(legacy.data(PROFILE_KEY).campoFuturo, { manter: true });
  assertNoErrors(legacy);
});

await test("C3. Fragmentos abrem painéis, voltar retorna ao hub e links antigos de créditos continuam funcionando", async () => {
  const app = await boot({}, PAGE);
  for (const [hash, title] of [
    ["#editar-perfil", "Editar perfil"], ["#notificacoes", "Notificações"],
    ["#aparencia", "Aparência"], ["#privacidade", "Privacidade e dados"],
    ["#ajuda", "Central de ajuda"], ["#contato", "Fale conosco"], ["#sobre", "Sobre o FORJA"]
  ]) {
    await openPanel(app, hash);
    assert.equal(app.text("#settings-title"), title);
    assert.equal(app.$$(("[data-settings-panel]")).filter(node => !node.hidden).length, 1);
    assert.equal(app.$('[data-settings-panel="' + hash.slice(1) + '"]').hidden, false);
    assert.equal(app.$("#settings-back").getAttribute("href"), "#inicio");
  }
  await openPanel(app, "#creditos-imagens");
  assert.equal(app.$("#sobre").hidden, false);
  assert.equal(app.$("#creditos-imagens").open, true);
  await openPanel(app, "#backup-heading");
  assert.equal(app.$("#privacidade").hidden, false);
  await openPanel(app, "#inicio");
  assert.equal(app.text("#settings-title"), "Configurações");
  assert.equal(app.$("#settings-back").getAttribute("href"), "../index.html");
  await openPanel(app, "#rota-inexistente");
  assert.equal(app.$("#inicio").hidden, false);
  assert.deepEqual(app.storageWrites, []);
  assertNoErrors(app, "navegação por fragmentos");
});

await test("C4. Editar nome persiste no perfil existente, preserva campos e alimenta a Home", async () => {
  const app = await boot({
    [PROFILE_KEY]: profileSeed({ nomeExibicao: "Ravy", campoFuturo: "preservar" }),
    "forja-treino-metas-v1": { version: 1, weeklySessions: 4, weeklySets: 0, weeklyMinutes: 120, modality: "all" }
  }, PAGE + "#editar-perfil");
  app.$("#prof-nome").value = "  Nova   Pessoa  ";
  submit(app, "#profile-name-form");
  await wait(30);
  assert.equal(app.data(PROFILE_KEY).nomeExibicao, "Nova Pessoa");
  assert.equal(app.data(PROFILE_KEY).campoFuturo, "preservar");
  assert.equal(app.data(PROFILE_KEY).objetivo, "hipertrofia");
  assert.equal(app.data("forja-treino-metas-v1").weeklySessions, 4);
  assert.equal(app.text("#settings-profile-name"), "Nova");

  await app.reload();
  assert.equal(app.$("#prof-nome").value, "Nova Pessoa");
  await app.go(BASE + "index.html");
  assert.equal(app.text("#home-title"), "Olá, Nova Pessoa!");

  await app.go(BASE + PAGE + "#editar-perfil");
  const before = app.raw(PROFILE_KEY);
  app.$("#prof-nome").value = "123";
  submit(app, "#profile-name-form");
  assert.equal(app.$("#prof-nome-error").hidden, false);
  assert.equal(app.raw(PROFILE_KEY), before, "Nome inválido foi gravado");
  assertNoErrors(app, "nome");
});

await test("C5. Apagar nome pede confirmação; cancelar não grava e confirmar volta à saudação neutra", async () => {
  const app = await boot({ [PROFILE_KEY]: profileSeed({ nomeExibicao: "Ravy" }) }, PAGE + "#editar-perfil");
  const before = app.raw(PROFILE_KEY);
  app.click("#prof-nome-clear");
  await wait(30);
  assert.match(app.text("#modal-title"), /Apagar nome/);
  app.modalAction("cancel");
  await wait(30);
  assert.equal(app.raw(PROFILE_KEY), before);
  assert.equal(app.$("#prof-nome").value, "Ravy");

  app.click("#prof-nome-clear");
  await wait(30);
  app.modalAction("confirm");
  await wait(40);
  assert.equal(app.data(PROFILE_KEY).nomeExibicao, "");
  assert.equal(app.text("#settings-profile-name"), "Seu perfil");
  await app.go(BASE + "index.html");
  assert.equal(app.text("#home-title"), "Olá!");
  assertNoErrors(app, "apagar nome");
});

await test("C6. Som e vibração usam a chave existente, persistem e sobrevivem à navegação", async () => {
  const app = await boot({}, PAGE + "#notificacoes");
  assert.equal(app.raw(PREFS_KEY), null);
  assert.equal(app.$("#pref-sound").checked, true);
  app.$("#pref-sound").click();
  await wait(20);
  assert.deepEqual(app.data(PREFS_KEY), { soundOnRest: false, vibrateOnRest: true });
  await app.reload();
  assert.equal(app.$("#pref-sound").checked, false);
  await app.go(BASE + "configuracoes/index.html");
  assert.equal(app.$("#pref-sound").checked, false);
  app.$("#pref-vibrate").click();
  await wait(20);
  await app.go(BASE + PAGE + "#notificacoes");
  assert.deepEqual(app.data(PREFS_KEY), { soundOnRest: false, vibrateOnRest: false });
  assertNoErrors(app, "descanso");
});

await test("C7. Aparência: padrão não grava; tema e movimento persistem e acompanham outras abas", async () => {
  const app = await boot({}, PAGE + "#aparencia");
  assert.equal(app.raw(APPEARANCE_KEY), null);
  assert.equal(app.$('input[name="appearance-theme"][value="default"]').checked, true);
  app.$('input[name="appearance-theme"][value="contrast"]').checked = true;
  change(app, 'input[name="appearance-theme"][value="contrast"]');
  app.$("#pref-reduced-motion").click();
  await wait(20);
  assert.deepEqual(app.data(APPEARANCE_KEY), { theme: "contrast", reducedMotion: true });
  assert.equal(app.d.documentElement.dataset.forjaTheme, "contrast");
  assert.equal(app.d.documentElement.dataset.forjaMotion, "reduced");

  await app.reload();
  assert.equal(app.$('input[name="appearance-theme"][value="contrast"]').checked, true);
  assert.equal(app.$("#pref-reduced-motion").checked, true);
  await app.go(BASE + "index.html");
  assert.equal(app.d.documentElement.dataset.forjaTheme, "contrast");
  assert.equal(app.d.documentElement.dataset.forjaMotion, "reduced");

  app.set(APPEARANCE_KEY, { theme: "default", reducedMotion: false });
  app.w.dispatchEvent(new app.w.StorageEvent("storage", { key: APPEARANCE_KEY }));
  await wait(20);
  assert.equal(app.d.documentElement.dataset.forjaTheme, "default");
  assert.equal(app.d.documentElement.dataset.forjaMotion, "full");
  assertNoErrors(app, "aparência");
});

await test("C8. Aparência inválida cai no padrão sem gravar; falha de escrita mantém a escolha anterior", async () => {
  const invalid = await boot({ [APPEARANCE_KEY]: { theme: "rosa", reducedMotion: "sim" } }, PAGE + "#aparencia");
  assert.deepEqual(plain(invalid.F.state.appearance), { theme: "default", reducedMotion: false });
  assert.deepEqual(invalid.storageWrites, []);
  assertNoErrors(invalid);
  invalid.close();

  const app = await boot({}, PAGE + "#aparencia");
  const guard = installFailingStorage(app, { failOn: APPEARANCE_KEY, times: 1 });
  app.$('input[name="appearance-theme"][value="contrast"]').checked = true;
  change(app, 'input[name="appearance-theme"][value="contrast"]');
  assert.equal(app.raw(APPEARANCE_KEY), null);
  assert.equal(app.$('input[name="appearance-theme"][value="default"]').checked, true);
  assert.match(app.text("#appearance-status"), /Não foi possível salvar/);
  guard.restore();
  app.$('input[name="appearance-theme"][value="contrast"]').checked = true;
  change(app, 'input[name="appearance-theme"][value="contrast"]');
  assert.deepEqual(app.data(APPEARANCE_KEY), { theme: "contrast", reducedMotion: false });
  assertNoErrors(app, "falha de aparência");
});

await test("C9. Restaurar aparência exige confirmação e não altera perfil, metas ou histórico", async () => {
  const app = await boot({
    [PROFILE_KEY]: profileSeed({ nomeExibicao: "Ravy" }),
    [APPEARANCE_KEY]: { theme: "contrast", reducedMotion: true },
    "forja-treino-metas-v1": { version: 1, weeklySessions: 3, weeklySets: 0, weeklyMinutes: 90, modality: "all" }
  }, PAGE + "#aparencia");
  const profileBefore = app.raw(PROFILE_KEY);
  const goalsBefore = app.raw("forja-treino-metas-v1");
  app.click("#appearance-reset");
  await wait(30);
  app.modalAction("cancel");
  await wait(30);
  assert.deepEqual(app.data(APPEARANCE_KEY), { theme: "contrast", reducedMotion: true });
  app.click("#appearance-reset");
  await wait(30);
  app.modalAction("confirm");
  await wait(40);
  assert.deepEqual(app.data(APPEARANCE_KEY), { theme: "default", reducedMotion: false });
  assert.equal(app.raw(PROFILE_KEY), profileBefore);
  assert.equal(app.raw("forja-treino-metas-v1"), goalsBefore);
  assertNoErrors(app, "restaurar aparência");
});

await test("C10. Minhas metas abre o formulário existente em Evolução e salva na chave original", async () => {
  const app = await boot({}, PAGE);
  app.click("#settings-goals-link");
  await wait(120);
  assert.match(app.w.location.pathname, /progresso\/index.html$/);
  assert.equal(app.w.location.hash, "#progress-goals-heading");
  assert.equal(app.$("#progress-goals-heading").closest("details").open, true);
  app.$("#goal-sessions").value = "5";
  app.$("#goal-minutes").value = "150";
  submit(app, "#goals-form");
  await wait(30);
  assert.equal(app.data("forja-treino-metas-v1").weeklySessions, 5);
  assert.equal(app.data("forja-treino-metas-v1").weeklyMinutes, 150);
  assertNoErrors(app, "metas integradas");
});

await test("C11. Preferências de treino aponta para o planejador existente e mantém a persistência dele", async () => {
  const app = await boot({}, PAGE);
  app.click("#settings-training-link");
  await wait(120);
  assert.match(app.w.location.pathname, /treino\/index.html$/);
  assert.equal(app.w.location.hash, "#preferences-heading");
  const radio = app.$('input[name="pref-days"][value="5"]');
  radio.checked = true;
  change(app, 'input[name="pref-days"][value="5"]');
  await wait(30);
  assert.equal(app.data("forja-planejamento-preferencias-v1").days, 5);
  await app.reload();
  assert.equal(app.$('input[name="pref-days"][value="5"]').checked, true);
  assertNoErrors(app, "preferências integradas");
});

await test("C12. Privacidade mantém backup, auditoria sem conteúdo pessoal e aviso de armazenamento local", async () => {
  const app = await boot({ [PROFILE_KEY]: profileSeed({ nomeExibicao: "Nome Sensível" }) }, PAGE + "#privacidade");
  assert.match(app.text("#backup-status"), /permanecem apenas neste navegador/);
  assert.ok(app.$("#export-backup"));
  assert.ok(app.$("#import-backup-input"));
  app.$("#settings-storage-audit").open = true;
  await wait(60);
  assert.match(app.text("#storage-audit-content"), /Perfil/);
  assert.ok(!app.text("#storage-audit-content").includes("Nome Sensível"));
  app.click("#export-backup");
  await wait(30);
  assert.equal(app.downloads.length, 1);
  assertNoErrors(app, "privacidade");
});

await test("C13. Suporte tem canal oficial, diagnóstico sem dados pessoais e versão real do pacote", async () => {
  const app = await boot({ [PROFILE_KEY]: profileSeed({ nomeExibicao: "Nome Sensível" }) }, PAGE + "#contato");
  const link = app.$('a[href="https://github.com/1Rayke1/forja/issues/new"]');
  assert.ok(link);
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  assert.equal(link.getAttribute("data-external-support"), "forja");
  app.click("#support-copy-diagnostics");
  await wait(40);
  const diagnostic = app.$(".settings-diagnostic-text").value;
  assert.match(diagnostic, /FORJA 2\.0\.0/);
  assert.ok(!diagnostic.includes("Nome Sensível"));
  app.modalAction("close");
  await wait(30);
  await openPanel(app, "#sobre");
  assert.equal(app.text("#settings-version"), "Versão " + pkg.version);
  assert.equal(app.F.APP_VERSION, pkg.version);
  assert.ok(app.$("#creditos-imagens"));
  assert.ok(app.$("#creditos-fotografias"));
  assert.ok(app.$("#creditos-videos"));
  assertNoErrors(app, "suporte");
});

await test("C14. Aparência entra no backup/registry com a mesma validação do boot", async () => {
  const app = await boot({ [APPEARANCE_KEY]: { theme: "contrast", reducedMotion: true } }, PAGE);
  const backup = app.F.buildBackupObject();
  assert.deepEqual(plain(backup.keys[APPEARANCE_KEY]), { theme: "contrast", reducedMotion: true });
  assert.equal(app.F.registry.validateKey(APPEARANCE_KEY, { theme: "default", reducedMotion: false }), true);
  assert.throws(() => app.F.registry.validateKey(APPEARANCE_KEY, { theme: "rosa" }), /tema/);
  assert.throws(() => app.F.registry.validateKey(APPEARANCE_KEY, { reducedMotion: "sim" }), /movimento/);
  assertNoErrors(app, "backup aparência");
});

await test("C15. Abrir e navegar por todos os painéis não grava nada nem produz erro de console", async () => {
  const app = await boot({ [PROFILE_KEY]: profileSeed({ nomeExibicao: "Ravy" }) }, PAGE);
  for (const hash of ["#editar-perfil", "#notificacoes", "#aparencia", "#privacidade", "#ajuda", "#contato", "#sobre", "#inicio"]) {
    await openPanel(app, hash);
  }
  assert.deepEqual(app.storageWrites, []);
  assertNoErrors(app, "navegação completa");
});

await test("C16. Aba Perfil abre Configurações direto; perfil completo editável, sem página intermediária nem ciclo", async () => {
  /* A página intermediária foi removida: nada de tela só para encaminhar. */
  assert.ok(!fs.existsSync(path.join(repoRoot, "perfil", "index.html")), "perfil/index.html não deveria existir");

  const app = await boot({ [PROFILE_KEY]: profileSeed({ nomeExibicao: "Ravy" }) }, "index.html");
  app.click('.bottom-nav-link[data-nav="perfil"]');
  await wait(120);
  assert.match(app.w.location.pathname, /configuracoes\/index\.html$/, "Perfil não abriu Configurações direto");
  assert.equal(app.text("#settings-title"), "Configurações");
  assert.equal(app.$('.bottom-nav-link[aria-current="page"]').dataset.nav, "perfil");
  assert.equal(app.$("#profile-settings-link"), null, "O cartão intermediário de Configurações não deve existir");

  /* O formulário completo de perfil vive no painel Editar perfil. */
  for (const id of ["profile-form", "prof-objetivo", "prof-nivel", "prof-equipamento", "prof-sexo", "prof-modalidade", "prof-dias", "prof-duracao", "profile-save"]) {
    assert.ok(app.$("#" + id), "Campo de perfil ausente em Configurações: #" + id);
  }
  assert.deepEqual(app.storageWrites, [], "Navegar até Configurações gravou algo");

  await openPanel(app, "#editar-perfil");
  assert.equal(app.$("#settings-back").getAttribute("href"), "#inicio");
  app.$("#prof-sexo").value = "feminino";
  app.$("#prof-dias").value = "4";
  submit(app, "#profile-form");
  await wait(30);
  assert.equal(app.data(PROFILE_KEY).sexo, "feminino");
  assert.equal(app.data(PROFILE_KEY).diasPorSemana, 4);
  assert.equal(app.data(PROFILE_KEY).objetivo, "hipertrofia", "Campo não editado mudou");

  /* Refresh continua em Configurações com o valor salvo. */
  await app.reload();
  assert.match(app.w.location.pathname, /configuracoes\/index\.html$/);
  assert.equal(app.$("#prof-sexo").value, "feminino");

  /* Voltar do hub leva ao Início, sem ciclo de volta para uma página Perfil. */
  await openPanel(app, "#inicio");
  assert.equal(app.$("#settings-back").getAttribute("href"), "../index.html");
  assert.equal(app.$("#settings-exit").getAttribute("href"), "../index.html");
  assertNoErrors(app, "perfil direto em configurações");
});

console.log("\nCONFIGURAÇÕES — " + passed + "/" + (passed + failures.length) + " testes aprovados");
if (failures.length) process.exitCode = 1;
