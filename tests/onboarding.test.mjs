/*
  Suíte do onboarding e do modelo de perfil (jsdom, páginas reais).

  Cobre os requisitos da entrega do onboarding: primeiro acesso, fluxo
  completo, navegação para trás, retomada, perfil antigo sem sexo, valores
  inválidos, edição posterior, persistência do sexo, ausência de personagem
  quando o dado não existe, backup, preservação de treinos e histórico,
  estrutura de layout/acessibilidade e ausência de erros de JavaScript.

  Uso: npm run test:onboarding (ou npm test, que roda esta suíte junto).
*/

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BASE,
  assertNoErrors,
  boot,
  closeAllApps,
  makeRoutine,
  repoRoot,
  routinesStore,
  wait
} from "./helpers/harness.mjs";
import { installFailingStorage } from "./helpers/legacy-flows.mjs";

const PROFILE_KEY = "forja-perfil-v1";
const GOALS_KEY = "forja-treino-metas-v1";
const ROUTINES_KEY = "forja-treino-rotinas-v1";
const HISTORY_KEY = "forja-treino-historico-v1";

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

async function until(predicate, label, ms = 4000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const value = predicate();
    if (value) return value;
    await wait(20);
  }
  assert.fail("Condição não atingida: " + label);
}

/* Perfil no formato antigo (v1), como quem já usava o FORJA antes. */
const perfilV1 = (extra = {}) => Object.assign({
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  objetivo: "forca",
  nivel: "iniciante",
  equipamento: "academia",
  diasPorSemana: 3,
  duracaoMinutos: 45
}, extra);

const plain = value => JSON.parse(JSON.stringify(value));

function storageSnapshot(app) {
  return Object.fromEntries(app.keys().map(key => [key, app.raw(key)]));
}

function botao(app, label, selector = "button") {
  const found = app.$$(selector).find(item => item.textContent.trim() === label);
  assert.ok(found, "Controle não encontrado: " + label);
  return found;
}

const CAMPO_DO_PASSO = {
  sexo: "sexo",
  objetivo: "objetivo",
  nivel: "nivel",
  dias: "diasPorSemana",
  duracao: "duracaoMinutos",
  equipamento: "equipamento",
  modalidade: "modalidadePreferida"
};

function escolher(app, campo, valor) {
  const nome = CAMPO_DO_PASSO[campo] || campo;
  const input = app.d.querySelector(
    'input[name="onboarding-' + nome + '"][value="' + String(valor) + '"]'
  );
  assert.ok(input, "Opção não encontrada: " + campo + "=" + valor);
  input.checked = true;
  input.dispatchEvent(new app.w.Event("change", { bubbles: true }));
  return input;
}

async function avancar(app) {
  app.click("#onboarding-next");
  await wait(20);
}

async function voltar(app) {
  app.click("#onboarding-back");
  await wait(20);
}

async function irParaOnboarding(app) {
  app.click("#onboarding-start");
  await until(() => app.d.body.dataset.page === "onboarding", "página de onboarding");
  await wait(30);
}

/* Fluxo completo com respostas padrão; para na revisão. */
async function responderTudo(app, respostas = {}) {
  const valores = Object.assign({
    sexo: "masculino",
    objetivo: "hipertrofia",
    nivel: "iniciante",
    dias: 4,
    duracao: 45,
    equipamento: "academia",
    modalidade: "weights"
  }, respostas);

  await avancar(app); /* apresentação */
  await escolher(app, "sexo", valores.sexo);
  await avancar(app);
  await escolher(app, "objetivo", valores.objetivo);
  await avancar(app);
  await escolher(app, "nivel", valores.nivel);
  await avancar(app);
  await escolher(app, "dias", valores.dias);
  await avancar(app);
  await escolher(app, "duracao", valores.duracao);
  await avancar(app);
  await escolher(app, "equipamento", valores.equipamento);
  await avancar(app);
  await escolher(app, "modalidade", valores.modalidade);
  await avancar(app);
}

/* ------------------------------------------------------------------ */
/* 1. Primeiro acesso                                                  */
/* ------------------------------------------------------------------ */

await runTest("1. Primeiro acesso sem perfil: convite na Home e onboarding sem gravar nada", async () => {
  const home = await boot({}, "index.html");
  assertNoErrors(home, "home nova");

  const painel = home.$("#onboarding-root .onboarding-panel");
  assert.ok(painel, "O convite ao onboarding deve aparecer para usuário novo");
  assert.equal(home.text("#home-onboarding-heading"), "Seu perfil de treino");
  assert.ok(home.$("#onboarding-start"), "Falta o link para o cadastro guiado");
  assert.equal(home.$$("#onboarding-root input, #onboarding-root select").length, 0,
    "A Home não deve coletar respostas");
  assert.deepEqual(home.storageWrites, [], "A Home não deve gravar nada: " + JSON.stringify(home.storageWrites));
  assert.equal(home.raw(PROFILE_KEY), null);

  await irParaOnboarding(home);
  assertNoErrors(home, "onboarding");

  assert.equal(home.text("#onboarding-question"), "Bem-vindo à FORJA");
  assert.equal(home.$("#onboarding-progressbar").getAttribute("role"), "progressbar");
  assert.equal(home.text("#onboarding-step-count"), "Comece por aqui");
  assert.deepEqual(home.storageWrites, [], "Abrir o onboarding não deve gravar nada");
  assert.equal(home.raw(PROFILE_KEY), null);
});

/* ------------------------------------------------------------------ */
/* 2. Conclusão de todas as etapas                                     */
/* ------------------------------------------------------------------ */

await runTest("2. Conclusão de todas as etapas: confirmação, perfil completo e retorno à Home", async () => {
  const app = await boot({}, "index.html");
  await irParaOnboarding(app);
  await responderTudo(app);

  assert.equal(app.text("#onboarding-question"), "Confira suas respostas");
  assert.equal(app.text("#onboarding-next"), "Concluir cadastro");
  assert.equal(app.raw(PROFILE_KEY), null, "A revisão ainda não grava o perfil");

  app.click("#onboarding-next");
  await until(() => app.d.body.dataset.page === "inicio", "retorno para a Home");
  await wait(40);

  assertNoErrors(app, "home após concluir");

  const perfil = app.data(PROFILE_KEY);
  assert.ok(perfil, "O perfil deve ser gravado na conclusão");
  assert.deepEqual(perfil, {
    version: 2,
    updatedAt: perfil.updatedAt,
    objetivo: "hipertrofia",
    nivel: "iniciante",
    equipamento: "academia",
    diasPorSemana: 4,
    duracaoMinutos: 45,
    sexo: "masculino",
    modalidadePreferida: "weights",
    onboardingConcluidoEm: perfil.onboardingConcluidoEm
  });
  assert.ok(Date.parse(perfil.updatedAt), "updatedAt deve ser uma data ISO");
  assert.ok(Date.parse(perfil.onboardingConcluidoEm), "onboardingConcluidoEm deve ser uma data ISO");
  assert.equal(app.F.state.profile.sexo, "masculino", "F.state reflete o perfil gravado");

  /* Confirmação visível ao voltar para a Home. */
  const toast = app.$("#toast");
  assert.ok(toast && !toast.hidden, "A confirmação deve aparecer na Home");
  assert.match(toast.textContent, /Cadastro concluído/);

  /* O convite não volta e a Home segue operacional. */
  assert.equal(app.$("#onboarding-root").hidden, true);
  assert.ok(app.$("#home-primary-button"), "A ação principal da Home continua disponível");
});

/* ------------------------------------------------------------------ */
/* 3. Voltar e corrigir                                                */
/* ------------------------------------------------------------------ */

await runTest("3. Navegação para trás corrige a resposta e a revisão acompanha", async () => {
  const app = await boot({}, "onboarding/index.html");
  assertNoErrors(app, "onboarding");

  await avancar(app);
  await escolher(app, "sexo", "feminino");
  await avancar(app);
  await escolher(app, "objetivo", "forca");
  await avancar(app);
  await escolher(app, "nivel", "avancado");
  await avancar(app);
  await escolher(app, "dias", 3);
  await avancar(app);

  /* Volta duas etapas e corrige os dias. */
  await voltar(app);
  assert.equal(app.text("#onboarding-question"), "Quantos dias por semana você consegue treinar?");
  assert.equal(app.$('input[name="onboarding-diasPorSemana"][value="3"]').checked, true,
    "A resposta anterior deve continuar marcada");
  await voltar(app);
  assert.equal(app.text("#onboarding-question"), "Qual é a sua experiência com treino?");

  await avancar(app);
  await escolher(app, "dias", 5);
  await avancar(app);
  await escolher(app, "duracao", 60);
  await avancar(app);
  await escolher(app, "equipamento", "casa");
  await avancar(app);
  await escolher(app, "modalidade", "calisthenics");
  await avancar(app);

  assert.match(app.text(".onboarding-review"), /5 dias por semana/);
  assert.match(app.text(".onboarding-review"), /60 min por sessão/);

  /* "Editar" na revisão salta direto para a etapa escolhida. */
  const editar = app.$$(".onboarding-edit").find(button => button.getAttribute("data-step") === "2");
  assert.ok(editar, "A revisão deve oferecer edição de cada resposta");
  editar.dispatchEvent(new app.w.MouseEvent("click", { bubbles: true, cancelable: true }));
  await wait(20);
  assert.equal(app.text("#onboarding-question"), "Qual é o seu objetivo principal?");
  assert.equal(app.$('input[name="onboarding-objetivo"][value="forca"]').checked, true);
  await escolher(app, "objetivo", "calistenia");
  for (let etapa = 0; etapa < 6; etapa += 1) await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Confira suas respostas");

  app.click("#onboarding-next");
  await until(() => app.d.body.dataset.page === "inicio", "conclusão após correção");

  const perfil = app.data(PROFILE_KEY);
  assert.equal(perfil.sexo, "feminino");
  assert.equal(perfil.objetivo, "calistenia");
  assert.equal(perfil.nivel, "avancado");
  assert.equal(perfil.diasPorSemana, 5, "A correção deve ser a resposta gravada");
  assert.equal(perfil.duracaoMinutos, 60);
  assert.equal(perfil.equipamento, "casa");
  assert.equal(perfil.modalidadePreferida, "calisthenics");
});

/* ------------------------------------------------------------------ */
/* 4. Reabertura com perfil salvo                                      */
/* ------------------------------------------------------------------ */

await runTest("4. Reabertura: perfil salvo não repete o onboarding e a página abre na revisão", async () => {
  const seed = { [PROFILE_KEY]: perfilV1({ sexo: "feminino" }) };

  const home = await boot(seed, "index.html");
  assertNoErrors(home, "home com perfil");
  assert.equal(home.$("#onboarding-root").hidden, true, "Quem já tem perfil não vê o convite");
  assert.equal(home.$(".onboarding-panel"), null);
  assert.deepEqual(home.storageWrites, [], "A Home não deve regravar o perfil");
  home.close();

  const pagina = await boot(seed, "onboarding/index.html");
  assertNoErrors(pagina, "onboarding com perfil");
  assert.equal(pagina.text("#onboarding-question"), "Confira suas respostas",
    "Quem já tem perfil começa na revisão, sem repetir as perguntas");
  assert.equal(pagina.text("#onboarding-next"), "Concluir cadastro");
  assert.match(pagina.text(".onboarding-review"), /Feminino/);
  assert.deepEqual(pagina.storageWrites, [], "Abrir a página não deve regravar o perfil");
  pagina.close();

  /* Quem pede explicitamente para refazer começa do começo. */
  const refazer = await boot(seed, "onboarding/index.html?refazer=1");
  assert.equal(refazer.text("#onboarding-question"), "Bem-vindo à FORJA", "Refazer deve recomeçar");
  refazer.close();
});

/* ------------------------------------------------------------------ */
/* 5. Perfil antigo sem o campo novo                                   */
/* ------------------------------------------------------------------ */

await runTest("5. Perfil antigo (v1) sem sexo carrega sem erro, sem personagem e sem regravar", async () => {
  const seed = { [PROFILE_KEY]: perfilV1() };

  const perfil = await boot(seed, "perfil/index.html");
  assertNoErrors(perfil, "perfil v1");
  assert.equal(perfil.F.state.profile.version, 2, "O modelo lido é v2");
  assert.equal(perfil.F.state.profile.sexo, "", "Perfil antigo não ganha sexo inventado");
  assert.equal(perfil.F.state.profile.objetivo, "forca", "Os campos antigos continuam intactos");
  assert.equal(perfil.F.resolvePersonagem(perfil.F.state.profile), null,
    "Sem sexo, nenhum personagem é escolhido");
  assert.equal(perfil.d.getElementById("prof-sexo").value, "", "O formulário mostra 'Não informado'");
  assert.equal(perfil.d.getElementById("prof-dias").value, "3");
  assert.deepEqual(perfil.storageWrites, [], "Ler um perfil antigo não deve regravar nada");

  const home = await boot(seed, "index.html");
  assert.equal(home.$("#onboarding-root").hidden, true, "Perfil antigo conta como configurado");
  home.close();
});

/* ------------------------------------------------------------------ */
/* 6. Valores ausentes ou inválidos                                    */
/* ------------------------------------------------------------------ */

await runTest("6. Normalização: valores ausentes, desconhecidos e fora de faixa não quebram nada", async () => {
  const app = await boot({}, "perfil/index.html");
  assertNoErrors(app);
  const F = app.F;

  const vazio = plain(F.normalizeProfile(null));
  assert.deepEqual(vazio, {
    version: 2, updatedAt: null, objetivo: "", nivel: "", equipamento: "",
    diasPorSemana: 0, duracaoMinutos: 0,
    sexo: "", modalidadePreferida: "", onboardingConcluidoEm: null
  });

  const invalido = plain(F.normalizeProfile({
    objetivo: "voar",
    nivel: 42,
    equipamento: "piscina",
    diasPorSemana: 99,
    duracaoMinutos: "muito",
    sexo: "outro",
    modalidadePreferida: "crossfit",
    updatedAt: "não é data",
    onboardingConcluidoEm: 12
  }));

  assert.equal(invalido.objetivo, "");
  assert.equal(invalido.nivel, "");
  assert.equal(invalido.equipamento, "");
  assert.equal(invalido.diasPorSemana, 7, "Dias acima do teto são limitados, não gravados como 99");
  assert.equal(invalido.duracaoMinutos, 0, "Duração não numérica volta para 0");
  assert.equal(invalido.sexo, "", "Sexo desconhecido vira 'não informado'");
  assert.equal(invalido.modalidadePreferida, "");
  assert.equal(invalido.updatedAt, null);
  assert.equal(invalido.onboardingConcluidoEm, null);

  /* Validação de backup é estrita nos campos novos. */
  assert.equal(F.validateProfileStore(perfilV1({ sexo: "feminino" })), true);
  assert.throws(() => F.validateProfileStore({ sexo: "outro" }), /sexo/i);
  assert.throws(() => F.validateProfileStore({ modalidadePreferida: "crossfit" }), /modalidade/i);
  assert.throws(() => F.validateProfileStore({ onboardingConcluidoEm: "ontem" }), /data/i);
  assert.equal(F.validateProfileStore(perfilV1()), true, "Perfil v1 sem os campos novos continua válido");

  /* Valores parciais no armazenamento: leitura nunca grava nem corrige no disco. */
  const parcial = await boot({
    [PROFILE_KEY]: { objetivo: "forca", sexo: "outro", diasPorSemana: "3" }
  }, "index.html");
  assertNoErrors(parcial, "perfil parcial");
  assert.equal(parcial.F.state.profile.sexo, "");
  assert.equal(parcial.F.state.profile.diasPorSemana, 3);
  assert.deepEqual(parcial.storageWrites, [], "O boot não deve reescrever o perfil");
});

/* ------------------------------------------------------------------ */
/* 7. Edição posterior                                                 */
/* ------------------------------------------------------------------ */

await runTest("7. Edição posterior em Perfil grava o sexo e preserva o restante", async () => {
  const rotina = makeRoutine("weights", "Força A", [
    { id: "e-1", name: "Supino", sets: 3, reps: "8", section: "main" }
  ], "rot-edicao");
  const historico = [{
    id: "h-edicao", date: "2026-01-05", modality: "weights", routineId: rotina.id, routineName: "Força A",
    durationMs: 1_800_000, completedSets: 3, totalPlannedSets: 3, status: "completed",
    finishedAt: "2026-01-05T10:00:00.000Z", exercises: []
  }];

  const app = await boot({
    [PROFILE_KEY]: perfilV1(),
    [ROUTINES_KEY]: routinesStore([], [rotina]),
    [HISTORY_KEY]: historico
  }, "perfil/index.html");
  assertNoErrors(app, "perfil com histórico");

  const antes = storageSnapshot(app);

  app.d.getElementById("prof-sexo").value = "masculino";
  app.d.getElementById("prof-modalidade").value = "weights";
  app.d.getElementById("prof-nivel").value = "avancado";
  app.click("#profile-save");
  await wait(30);

  const perfil = app.data(PROFILE_KEY);
  assert.equal(perfil.sexo, "masculino", "O sexo editado deve ser gravado");
  assert.equal(perfil.modalidadePreferida, "weights");
  assert.equal(perfil.nivel, "avancado");
  assert.equal(perfil.objetivo, "forca", "Campos não editados permanecem");
  assert.equal(perfil.diasPorSemana, 3);
  assert.notEqual(perfil.updatedAt, "2026-01-01T00:00:00.000Z", "updatedAt é renovado");

  assert.equal(app.raw(ROUTINES_KEY), antes[ROUTINES_KEY], "Rotinas não podem mudar");
  assert.equal(app.raw(HISTORY_KEY), antes[HISTORY_KEY], "Histórico não pode mudar");
  assert.deepEqual(app.storageWrites.filter(item => item.key === PROFILE_KEY).length, 1,
    "A edição grava só a chave do perfil");

  /* Recarrega: o valor persiste. */
  await app.reload();
  assert.equal(app.d.getElementById("prof-sexo").value, "masculino");
  assert.equal(app.F.state.profile.sexo, "masculino");
});

/* ------------------------------------------------------------------ */
/* 8. Persistência do sexo e resolução do personagem                    */
/* ------------------------------------------------------------------ */

await runTest("8. Sexo persiste entre páginas e resolve o personagem só quando reconhecido", async () => {
  const app = await boot({ [PROFILE_KEY]: perfilV1({ sexo: "feminino" }) }, "index.html");
  assertNoErrors(app);

  const personagem = app.F.resolvePersonagem(app.F.state.profile);
  assert.deepEqual(plain(personagem), { id: "feminino", label: "Personagem feminino" });
  assert.deepEqual(plain(app.F.resolvePersonagem({ sexo: "masculino" })), { id: "masculino", label: "Personagem masculino" });

  /* Nada é inferido de outros campos. */
  assert.equal(app.F.resolvePersonagem({ objetivo: "hipertrofia", nivel: "avancado" }), null);
  assert.equal(app.F.resolvePersonagem({ sexo: "outro" }), null);
  assert.equal(app.F.resolvePersonagem(null), null);

  await app.go(BASE + "perfil/index.html");
  assert.equal(app.d.getElementById("prof-sexo").value, "feminino");
  assert.equal(app.F.state.profile.sexo, "feminino", "O sexo acompanha a navegação");

  await app.go(BASE + "progresso/index.html");
  assert.equal(app.F.state.profile.sexo, "feminino");
  assert.equal(app.d.querySelectorAll("[data-personagem]").length, 0,
    "Nenhum personagem deve ser renderizado nesta etapa");
});

/* ------------------------------------------------------------------ */
/* 9. Sexo não informado                                               */
/* ------------------------------------------------------------------ */

await runTest("9. 'Prefiro não informar' não seleciona personagem e o app funciona sem ele", async () => {
  const app = await boot({}, "index.html");
  await irParaOnboarding(app);

  /* A etapa exige uma escolha: avançar sem tocar em nada é bloqueado. */
  await avancar(app);
  await avancar(app);
  assert.equal(app.$("#onboarding-error").hidden, false);
  assert.equal(app.raw(PROFILE_KEY), null);

  await escolher(app, "sexo", "");
  await avancar(app);
  await escolher(app, "objetivo", "recuperacao");
  await avancar(app);
  await escolher(app, "nivel", "");
  await avancar(app);
  await escolher(app, "dias", 0);
  await avancar(app);
  await escolher(app, "duracao", 0);
  await avancar(app);
  await escolher(app, "equipamento", "");
  await avancar(app);
  await escolher(app, "modalidade", "");
  await avancar(app);

  app.click("#onboarding-next");
  await until(() => app.d.body.dataset.page === "inicio", "conclusão sem sexo");

  const perfil = app.data(PROFILE_KEY);
  assert.equal(perfil.sexo, "", "Não informar grava vazio, não um palpite");
  assert.equal(perfil.objetivo, "recuperacao");
  assert.equal(perfil.diasPorSemana, 0);
  assert.equal(app.raw(GOALS_KEY), null, "Sem dias/duração não há meta sugerida");
  assert.equal(app.F.resolvePersonagem(app.F.state.profile), null);
  assertNoErrors(app, "home sem sexo");
  assert.ok(app.$("#home-primary-button"), "A Home continua funcional sem personagem");
});

/* ------------------------------------------------------------------ */
/* 10. Backup                                                          */
/* ------------------------------------------------------------------ */

await runTest("10. Backup: exporta, importa e restaura perfil v2 e aceita perfil v1", async () => {
  const origem = await boot({
    [PROFILE_KEY]: perfilV1({ sexo: "masculino", modalidadePreferida: "weights" })
  }, "perfil/index.html");
  assertNoErrors(origem);

  const backup = plain(origem.F.buildBackupObject());
  assert.ok(Object.prototype.hasOwnProperty.call(backup.keys, PROFILE_KEY), "O perfil deve entrar no backup");
  assert.equal(backup.keys[PROFILE_KEY].sexo, "masculino");
  assert.equal(backup.format, "forja-backup");
  origem.close();

  /* O destino começa com um histórico: assim a cópia de segurança do "desfazer"
     também tem conteúdo e o teste cobre a ida e a volta. */
  const destino = await boot({
    [HISTORY_KEY]: [{
      id: "h-backup", date: "2026-01-06", modality: "calisthenics", routineName: "Base",
      durationMs: 600_000, completedSets: 1, totalPlannedSets: 1, status: "completed",
      finishedAt: "2026-01-06T10:00:00.000Z", exercises: []
    }]
  }, "perfil/index.html");
  assertNoErrors(destino);

  await destino.importFile(backup);
  await destino.modal("restore");
  await wait(60);

  assert.equal(destino.data(PROFILE_KEY).sexo, "masculino", "Importação restaura o sexo");
  assert.equal(destino.d.getElementById("prof-sexo").value, "masculino",
    "O formulário reflete o perfil importado");

  /* Desfazer a importação volta ao estado anterior (sem perfil). */
  const desfazer = destino.$("#restore-safety-backup");
  assert.ok(desfazer && !desfazer.hidden, "A cópia de segurança deve estar disponível");
  destino.click("#restore-safety-backup");
  await destino.modal("restore");
  await wait(80);
  assert.equal(destino.raw(PROFILE_KEY), null, "Desfazer remove o perfil importado");

  /* Backup antigo (v1, sem sexo) continua aceito. */
  const antigo = await boot({}, "perfil/index.html");
  await antigo.importFile({
    app: "FORJA",
    format: "forja-backup",
    version: 1,
    exportedAt: "2026-01-02T00:00:00.000Z",
    keys: { [PROFILE_KEY]: perfilV1() }
  });
  await antigo.modal("restore");
  await wait(60);
  assert.equal(antigo.F.state.profile.sexo, "");
  assert.equal(antigo.F.state.profile.objetivo, "forca");
  assertNoErrors(antigo, "importação de perfil v1");

  /* Backup com sexo inválido é recusado sem tocar nos dados. */
  const invalido = await boot({}, "perfil/index.html");
  await invalido.importFile({
    app: "FORJA",
    format: "forja-backup",
    version: 1,
    exportedAt: "2026-01-02T00:00:00.000Z",
    keys: { [PROFILE_KEY]: perfilV1({ sexo: "outro" }) }
  });
  await wait(60);
  assert.ok(invalido.$(".modal-backdrop"), "O backup inválido deve abrir um aviso");
  assert.equal(invalido.raw(PROFILE_KEY), null, "Nada pode ser aplicado de um backup inválido");
  invalido.modalAction("close");
  await wait(20);
});

/* ------------------------------------------------------------------ */
/* 11. Treinos e histórico preservados                                 */
/* ------------------------------------------------------------------ */

await runTest("11. Concluir o onboarding preserva rotinas, histórico e sessão ativa", async () => {
  const rotina = makeRoutine("calisthenics", "Base", [
    { id: "b-1", name: "Flexão", sets: 3, reps: "10", section: "main" }
  ], "rot-preserva");
  const historico = [{
    id: "h-preserva", date: "2026-01-04", modality: "calisthenics", routineId: rotina.id, routineName: "Base",
    durationMs: 900_000, completedSets: 3, totalPlannedSets: 3, status: "completed",
    finishedAt: "2026-01-04T10:00:00.000Z", exercises: []
  }];

  const app = await boot({
    [ROUTINES_KEY]: routinesStore([rotina], []),
    [HISTORY_KEY]: historico
  }, "onboarding/index.html");
  assertNoErrors(app, "onboarding com dados");

  const antes = storageSnapshot(app);
  await responderTudo(app);
  app.click("#onboarding-next");
  await until(() => app.d.body.dataset.page === "inicio", "retorno à Home");

  assert.equal(app.raw(ROUTINES_KEY), antes[ROUTINES_KEY], "Rotinas alteradas pelo onboarding");
  assert.equal(app.raw(HISTORY_KEY), antes[HISTORY_KEY], "Histórico alterado pelo onboarding");
  assert.ok(app.data(PROFILE_KEY).onboardingConcluidoEm, "O perfil foi criado ao lado dos dados existentes");
  assert.match(app.text("#home-primary-button"), /Iniciar/);
});

/* ------------------------------------------------------------------ */
/* 12. Estrutura de layout e acessibilidade                            */
/* ------------------------------------------------------------------ */

await runTest("12. Layout e acessibilidade: alvos de 44px, 320px, foco visível e movimento reduzido", async () => {
  const css = fs.readFileSync(path.join(repoRoot, "assets/css/onboarding.css"), "utf8");

  assert.match(css, /@media \(max-width: 359px\)/, "Falta o ajuste para 320px");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, "Falta respeitar prefers-reduced-motion");
  assert.match(css, /:focus-visible/, "Falta estado de foco visível");
  assert.match(css, /\.onboarding-option \{[^}]*min-height: 56px/s, "Opções abaixo de 44px");
  assert.match(css, /\.onboarding-nav button \{[^}]*min-height: 48px/s, "Botões de navegação abaixo de 44px");
  assert.match(css, /\.onboarding-edit \{[^}]*min-height: 44px/s, "Botão Editar abaixo de 44px");
  assert.match(css, /overflow-wrap: anywhere/, "Textos longos podem estourar em 320px");
  const largurasFixas = css
    .split("\n")
    .filter(linha => !/^\s*@media/.test(linha))
    .join("\n")
    .match(/min-width:\s*(\d+)px/g) || [];
  largurasFixas.forEach(declaracao => {
    const valor = Number(declaracao.replace(/[^0-9]/g, ""));
    assert.ok(valor <= 320, "Largura mínima fixa acima de 320px: " + declaracao);
  });

  /* Estrutura de cada etapa: um título, opções rotuladas e alvos nativos. */
  const app = await boot({}, "onboarding/index.html");
  const passos = app.F.onboarding.PASSOS;
  assert.equal(passos.length, 9, "O fluxo deve ter apresentação + 7 perguntas + revisão");

  const perguntas = passos.filter(passo => passo.tipo === "escolha");
  assert.equal(perguntas.length, 7);
  assert.equal(perguntas[0].campo, "sexo");
  assert.ok(perguntas[0].opcoes.some(opcao => opcao.valor === ""));
  assert.ok(perguntas[0].opcoes.some(opcao => opcao.valor === "masculino"));
  assert.ok(perguntas[0].opcoes.some(opcao => opcao.valor === "feminino"));

  await avancar(app);
  const grupo = app.$('#onboarding-step [role="radiogroup"]');
  assert.ok(grupo, "As perguntas devem usar grupo de rádios");
  assert.equal(grupo.getAttribute("aria-labelledby"), "onboarding-question");
  const radios = app.$$('#onboarding-step input[type="radio"]');
  assert.equal(radios.length, 3);
  radios.forEach(radio => {
    const label = radio.closest("label");
    assert.ok(label, "Cada rádio deve estar dentro do seu rótulo");
    assert.ok(label.textContent.trim().length > 0, "Rótulo vazio");
  });

  const barra = app.$("#onboarding-progressbar");
  assert.equal(barra.getAttribute("aria-valuemax"), "8");
  assert.equal(barra.getAttribute("aria-valuenow"), "1");
  assert.match(barra.getAttribute("aria-valuetext"), /Passo 2 de 9: Qual sexo você informa\?/);
  assert.equal(app.$("#onboarding-question").tagName.toLowerCase(), "h1");
  assertNoErrors(app, "estrutura do onboarding");
});

/* ------------------------------------------------------------------ */
/* 13. Retomada do fluxo interrompido                                  */
/* ------------------------------------------------------------------ */

await runTest("13. Fluxo interrompido retoma no mesmo passo sem gravar perfil", async () => {
  const app = await boot({}, "index.html");
  await irParaOnboarding(app);

  await avancar(app);
  await escolher(app, "sexo", "feminino");
  await avancar(app);
  await escolher(app, "objetivo", "resistencia");
  await avancar(app);

  /* Sai pela barra inferior (sem concluir) e volta. */
  await app.go(BASE + "treino/index.html");
  assert.equal(app.raw(PROFILE_KEY), null, "Sair no meio não grava perfil");

  await app.go(BASE + "onboarding/index.html");
  await wait(30);
  assert.equal(app.text("#onboarding-question"), "Qual é a sua experiência com treino?",
    "O fluxo deve retomar no passo onde parou");
  assert.equal(app.raw(PROFILE_KEY), null, "Retomar não grava perfil");

  /* As respostas anteriores continuam guardadas (basta voltar). */
  await voltar(app);
  assert.equal(app.text("#onboarding-question"), "Qual é o seu objetivo principal?");
  assert.equal(app.$('input[name="onboarding-objetivo"][value="resistencia"]').checked, true);
  await voltar(app);
  assert.equal(app.$('input[name="onboarding-sexo"][value="feminino"]').checked, true);
  await avancar(app);
  await avancar(app);

  /* Conclui e o rascunho é descartado. */
  await escolher(app, "nivel", "intermediario");
  await avancar(app);
  await escolher(app, "dias", 2);
  await avancar(app);
  await escolher(app, "duracao", 30);
  await avancar(app);
  await escolher(app, "equipamento", "nenhum");
  await avancar(app);
  await escolher(app, "modalidade", "calisthenics");
  await avancar(app);
  app.click("#onboarding-next");
  await until(() => app.d.body.dataset.page === "inicio", "conclusão após retomada");

  assert.equal(app.data(PROFILE_KEY).sexo, "feminino");
  assert.equal(app.data(PROFILE_KEY).duracaoMinutos, 30);
  assert.equal(app.w.sessionStorage.getItem("forja-onboarding-rascunho-v1"), null,
    "O rascunho deve ser apagado ao concluir");
});

/* ------------------------------------------------------------------ */
/* 14. Falha de armazenamento                                          */
/* ------------------------------------------------------------------ */

await runTest("14. Falha ao gravar mantém as respostas e avisa, sem perder o rascunho", async () => {
  const app = await boot({}, "onboarding/index.html");
  await responderTudo(app);

  const failing = installFailingStorage(app, { failOn: PROFILE_KEY, times: 1 });
  app.click("#onboarding-next");
  await wait(40);
  failing.restore();

  assert.equal(app.raw(PROFILE_KEY), null, "A gravação falhou: nada pode ir para o disco");
  assert.equal(app.d.body.dataset.page, "onboarding", "A página não deve sair em caso de erro");
  const erro = app.$("#onboarding-error");
  assert.equal(erro.hidden, false, "O erro precisa ser visível");
  assert.match(erro.textContent, /Não foi possível salvar/);

  const rascunho = JSON.parse(app.w.sessionStorage.getItem(app.F.onboarding.DRAFT_KEY));
  assert.ok(rascunho, "O rascunho deve continuar existindo");
  assert.equal(rascunho.respostas.objetivo, "hipertrofia", "As respostas ficam guardadas");

  /* Tentar de novo (já com o armazenamento funcionando) conclui. */
  app.click("#onboarding-next");
  await until(() => app.d.body.dataset.page === "inicio", "conclusão após nova tentativa");
  assert.equal(app.data(PROFILE_KEY).objetivo, "hipertrofia");
});

/* ------------------------------------------------------------------ */
/* 15. Metas semanais sugeridas                                        */
/* ------------------------------------------------------------------ */

await runTest("15. Metas: opt-in cria a meta do perfil; desmarcado ou já existente não mexe em nada", async () => {
  const app = await boot({}, "onboarding/index.html");
  await responderTudo(app);

  const optin = app.$("#onboarding-goals");
  assert.ok(optin, "A revisão deve oferecer a meta sugerida");
  assert.equal(optin.checked, true);
  assert.match(app.text(".onboarding-optin"), /4 treinos/);
  assert.match(app.text(".onboarding-optin"), /180 minutos/);
  app.click("#onboarding-next");
  await until(() => app.d.body.dataset.page === "inicio", "conclusão com meta");
  assert.equal(app.data(GOALS_KEY).weeklySessions, 4);
  assert.equal(app.data(GOALS_KEY).weeklyMinutes, 180);
  app.close();

  const semMeta = await boot({}, "onboarding/index.html");
  await responderTudo(semMeta);
  semMeta.d.getElementById("onboarding-goals").checked = false;
  semMeta.click("#onboarding-next");
  await until(() => semMeta.d.body.dataset.page === "inicio", "conclusão sem meta");
  assert.equal(semMeta.raw(GOALS_KEY), null, "Sem opt-in nenhuma meta é criada");
  semMeta.close();

  /* Metas já existentes não são sobrescritas nem sugeridas de novo. */
  const comMetas = await boot({
    [GOALS_KEY]: { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", modality: "all", weeklySessions: 2, weeklySets: 6, weeklyMinutes: 40 }
  }, "onboarding/index.html");
  await responderTudo(comMetas);
  assert.equal(comMetas.$("#onboarding-goals"), null, "Metas existentes não devem ser oferecidas de novo");
  comMetas.click("#onboarding-next");
  await until(() => comMetas.d.body.dataset.page === "inicio", "conclusão com metas antigas");
  assert.equal(comMetas.data(GOALS_KEY).weeklySessions, 2, "As metas anteriores ficam intactas");
});

/* ------------------------------------------------------------------ */
/* 16. Integração com a montagem de treinos                            */
/* ------------------------------------------------------------------ */

await runTest("16. Integração: preferência filtra o hub, sugestão preenche metas e nada é automático", async () => {
  const perfil = perfilV1({
    sexo: "masculino",
    modalidadePreferida: "calisthenics",
    diasPorSemana: 3,
    duracaoMinutos: 40
  });

  const hub = await boot({ [PROFILE_KEY]: perfil }, "treino/index.html");
  assertNoErrors(hub, "hub com preferência");
  assert.equal(hub.d.getElementById("hub-modality").value, "calisthenics", "O filtro inicia na preferência");
  assert.equal(hub.$("#hub-modality-hint").hidden, false, "O usuário precisa saber por que o filtro mudou");
  assert.deepEqual(hub.storageWrites, [], "Abrir o hub não deve gravar nada");
  hub.close();

  const hubSem = await boot({ [PROFILE_KEY]: perfilV1({ modalidadePreferida: "" }) }, "treino/index.html");
  assert.equal(hubSem.d.getElementById("hub-modality").value, "", "Sem preferência o filtro continua 'Todas'");
  assert.equal(hubSem.$("#hub-modality-hint").hidden, true);
  hubSem.close();

  /* Progresso: botão preenche, mas não salva por conta própria. */
  const progresso = await boot({ [PROFILE_KEY]: perfil }, "progresso/index.html");
  assertNoErrors(progresso, "progresso com perfil");

  const botaoPerfil = progresso.$("#goals-use-profile");
  assert.ok(botaoPerfil && !botaoPerfil.hidden, "O botão de sugestão deve aparecer");
  progresso.click("#goals-use-profile");
  await wait(20);

  assert.equal(progresso.d.getElementById("goal-sessions").value, "3");
  assert.equal(progresso.d.getElementById("goal-minutes").value, "120");
  assert.equal(progresso.d.getElementById("goal-modality").value, "calisthenics");
  assert.equal(progresso.raw(GOALS_KEY), null, "Preencher a sugestão não pode gravar metas");
  progresso.close();
});

/* ------------------------------------------------------------------ */
/* 17. Nada é duplicado no armazenamento                               */
/* ------------------------------------------------------------------ */

await runTest("17. Gravação preserva campos desconhecidos e não duplica fontes oficiais", async () => {
  const app = await boot({
    [PROFILE_KEY]: Object.assign(perfilV1(), { anotacaoDeOutraVersao: { manter: true } })
  }, "perfil/index.html");

  app.d.getElementById("prof-sexo").value = "feminino";
  app.click("#profile-save");
  await wait(30);

  const perfil = app.data(PROFILE_KEY);
  assert.equal(perfil.sexo, "feminino");
  assert.deepEqual(perfil.anotacaoDeOutraVersao, { manter: true },
    "Campo desconhecido não pode ser apagado na gravação");
  assert.equal(perfil.updatedAt !== "2026-01-01T00:00:00.000Z", true);
});

/* ------------------------------------------------------------------ */

console.log("\n============================================================");
const failed = results.filter(item => !item.ok);
console.log("ONBOARDING — " + (results.length - failed.length) + "/" + results.length + " testes aprovados");
if (failed.length > 0) {
  console.log("Falhas: " + failed.map(item => item.name).join(" | "));
  process.exitCode = 1;
}
console.log("============================================================");
