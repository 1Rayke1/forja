/*
  Suíte do cadastro guiado (onboarding) e do modelo de perfil (jsdom, páginas
  reais).

  Cobre o que a entrega pede: primeiro acesso, sequência completa de 24 telas,
  seleção única e múltipla, etapas numéricas com unidades e validação,
  obrigatoriedade e etapas opcionais, navegação para frente e para trás,
  preservação das respostas, retomada de rascunho, revisão com edição,
  gravação única na conclusão, compatibilidade com perfis antigos, preservação
  de rotinas/histórico e ausência de erros de JavaScript.

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
const DRAFT_KEY = "forja-onboarding-rascunho-v1";

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

/* Perfil no formato antigo (v1/v2), como quem já usava o FORJA antes. */
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

/* ------------------------------------------------------------------ */
/* Apoio de navegação no fluxo                                         */
/* ------------------------------------------------------------------ */

function passos(app) {
  return app.F.onboarding.PASSOS;
}

function passoAtual(app) {
  const id = app.$("#onboarding-shell").getAttribute("data-step");
  const passo = passos(app).find(item => item.id === id);
  assert.ok(passo, "Etapa atual desconhecida: " + id);
  return passo;
}

function indiceDoPasso(app, idOuCampo) {
  const indice = passos(app).findIndex(item => item.id === idOuCampo || item.campo === idOuCampo);
  assert.ok(indice >= 0, "Etapa não encontrada: " + idOuCampo);
  return indice;
}

function escolher(app, campo, valor) {
  const input = app.d.querySelector(
    'input[name="onboarding-' + campo + '"][value="' + String(valor) + '"]'
  );
  assert.ok(input, "Opção não encontrada: " + campo + "=" + String(valor));
  input.checked = true;
  input.dispatchEvent(new app.w.Event("change", { bubbles: true }));
  return input;
}

function desmarcar(app, campo, valor) {
  const input = app.d.querySelector(
    'input[name="onboarding-' + campo + '"][value="' + String(valor) + '"]'
  );
  assert.ok(input, "Opção não encontrada: " + campo + "=" + String(valor));
  input.checked = false;
  input.dispatchEvent(new app.w.Event("change", { bubbles: true }));
  return input;
}

function marcar(app, campo, valores) {
  (Array.isArray(valores) ? valores : [valores]).forEach(valor => escolher(app, campo, valor));
}

function digitar(app, valor, id = "onboarding-number") {
  const input = app.d.getElementById(id);
  assert.ok(input, "Campo numérico não encontrado: " + id);
  input.value = String(valor);
  input.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  return input;
}

function unidade(app, nome) {
  const botao = app.d.querySelector('.onboarding-unit[data-unit="' + nome + '"]');
  assert.ok(botao, "Seletor de unidade não encontrado: " + nome);
  app.click(botao);
  return botao;
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

const RESPOSTAS = {
  sexo: "masculino",
  focoArea: "corpo-todo",
  objetivo: "hipertrofia",
  motivacoes: ["saude", "forca"],
  alturaCm: 178,
  pesoKg: 80,
  pesoAlvoKg: 76,
  tipoCorpo: "intermediario",
  anoNascimento: 1994,
  rotinaDiaria: "sentado",
  localTreino: "academia",
  preferenciasTreino: ["musculacao"],
  diasPorSemana: 4,
  nivel: "iniciante",
  experienciaFisica: "basicos",
  consideracoes: ["baixo-impacto"],
  equipamentos: ["halteres", "maquinas"],
  flexoes: "6-10",
  mobilidade: "pernas",
  recuperacao: "algum-tempo",
  recompensa: "metas",
  progressoPercebido: "consistencia"
};

/* Responde a etapa atual com o valor do mapa e segue para a próxima. */
async function responderAtual(app, valores) {
  const passo = passoAtual(app);
  if (!passo.campo) {
    await avancar(app);
    return;
  }

  const valor = valores[passo.campo];

  if (passo.tipo === "numero") digitar(app, valor);
  else if (passo.tipo === "multipla") marcar(app, passo.campo, valor);
  else escolher(app, passo.campo, valor);

  await avancar(app);
}

/* Percorre o fluxo inteiro até a revisão, usando o mapa de respostas. */
async function responderTudo(app, respostas = {}) {
  const valores = Object.assign({}, RESPOSTAS, respostas);
  let voltas = 0;

  while (voltas < 60) {
    voltas += 1;
    const passo = passoAtual(app);
    if (passo.tipo === "revisao") return;
    await responderAtual(app, valores);
  }

  assert.fail("O fluxo não chegou à revisão");
}

/* Da etapa atual até a revisão, sem mudar nenhuma resposta. */
async function irAteRevisao(app) {
  let voltas = 0;
  while (voltas < 60) {
    voltas += 1;
    if (passoAtual(app).tipo === "revisao") return;
    await avancar(app);
  }
  assert.fail("A revisão não foi alcançada");
}

/* ------------------------------------------------------------------ */
/* 1. Primeiro acesso                                                  */
/* ------------------------------------------------------------------ */

await runTest("1. Primeiro acesso: convite na Home e etapa 1 sem gravar nada", async () => {
  const home = await boot({}, "index.html");
  assertNoErrors(home, "home nova");

  const painel = home.$("#onboarding-root .onboarding-panel");
  assert.ok(painel, "O convite ao onboarding deve aparecer para usuário novo");
  assert.equal(home.text("#home-onboarding-heading"), "Seu perfil de treino");
  assert.ok(home.$("#onboarding-start"), "Falta o link para o cadastro guiado");
  assert.deepEqual(home.storageWrites, [], "A Home não deve gravar nada: " + JSON.stringify(home.storageWrites));

  await irParaOnboarding(home);
  assertNoErrors(home, "onboarding");

  assert.equal(home.F.onboarding.TOTAL_PASSOS, 24, "O fluxo tem 24 telas (22 perguntas + revisão + preparação)");
  assert.equal(home.text("#onboarding-question"), "Vamos personalizar seu treino.");
  assert.equal(home.text("#onboarding-step-count"), "ETAPA 1 DE 24");
  assert.equal(home.$("#onboarding-progressbar").getAttribute("role"), "progressbar");
  assert.equal(home.$("#onboarding-progressbar").getAttribute("aria-valuenow"), "1");
  assert.equal(home.text("#onboarding-next"), "Continuar");
  assert.equal(home.$("#onboarding-back").hidden, true, "A primeira etapa não tem Voltar");
  assert.equal(home.$("#onboarding-skip-step").hidden, true, "A primeira etapa é obrigatória");
  assert.deepEqual(home.storageWrites, [], "Abrir o onboarding não deve gravar nada");
  assert.equal(home.raw(PROFILE_KEY), null);
});

/* ------------------------------------------------------------------ */
/* 2. Etapa 1 — imagens reais e seleção                                */
/* ------------------------------------------------------------------ */

await runTest("2. Sexo: cartões com as imagens reais, seleção única e avanço habilitado", async () => {
  const app = await boot({}, "onboarding/index.html");
  assertNoErrors(app, "etapa de sexo");

  const cartoes = app.$$(".onboarding-image-card");
  assert.equal(cartoes.length, 2, "Devem existir dois cartões: masculino e feminino");

  const imagens = app.$$(".onboarding-image-card img").map(img => img.getAttribute("src"));
  assert.deepEqual(imagens, [
    "../assets/imagens/onboarding/perfil-masculino.jpg",
    "../assets/imagens/onboarding/perfil-feminino.jpg"
  ], "Cada cartão deve usar a sua própria imagem");

  /* Os arquivos existem de fato no repositório. */
  imagens.forEach(src => {
    const file = path.resolve(repoRoot, "onboarding", src);
    assert.ok(fs.existsSync(file), "Imagem ausente no repositório: " + src);
  });

  /* Sem escolha não avança. */
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Vamos personalizar seu treino.");
  assert.equal(app.$("#onboarding-error").hidden, false, "O erro deve ser informado");
  assert.equal(app.raw(PROFILE_KEY), null);

  /* Escolha única: marcar feminino desmarca masculino. */
  escolher(app, "sexo", "feminino");
  await wait(10);
  assert.equal(app.$('input[name="onboarding-sexo"][value="feminino"]').checked, true);
  assert.equal(app.$('input[name="onboarding-sexo"][value="masculino"]').checked, false);
  assert.equal(app.$$(".onboarding-image-card.is-selected").length, 1, "Só um cartão selecionado");
  assert.equal(app.$(".onboarding-image-card.is-selected").getAttribute("data-value"), "feminino");

  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Qual área você quer priorizar?");
  assert.equal(app.text("#onboarding-step-count"), "ETAPA 2 DE 24");
  assert.equal(app.$("#onboarding-back").hidden, false, "A partir da etapa 2 existe Voltar");

  /* "Prefiro não informar" é uma escolha explícita e grava vazio. */
  await voltar(app);
  escolher(app, "sexo", "");
  await avancar(app);
  assert.equal(app.$("#onboarding-error").hidden, true);
});

/* ------------------------------------------------------------------ */
/* 3. Conclusão do fluxo                                               */
/* ------------------------------------------------------------------ */

await runTest("3. Conclusão: perfil v3 completo, meta semanal e retorno à Home", async () => {
  const app = await boot({}, "index.html");
  await irParaOnboarding(app);
  await responderTudo(app);

  assert.equal(passoAtual(app).tipo, "revisao");
  assert.equal(app.text("#onboarding-question"), "Revise seu perfil");
  assert.equal(app.text("#onboarding-step-count"), "ETAPA 23 DE 24");
  assert.equal(app.text("#onboarding-next"), "Continuar");
  assert.equal(app.raw(PROFILE_KEY), null, "A revisão ainda não grava o perfil");

  /* Só o que foi respondido aparece, com botão de edição por linha. */
  const linhas = app.$$(".onboarding-review-row");
  assert.equal(linhas.length, 22, "As 22 perguntas respondidas devem aparecer na revisão");
  assert.equal(app.$$(".onboarding-edit").length, linhas.length, "Cada linha tem Editar");
  assert.match(app.text(".onboarding-review"), /Hipertrofia|Ganhar massa muscular/);

  app.click("#onboarding-next");
  await wait(80);

  /* A preparação do plano aparece antes de entrar no app. */
  assert.equal(passoAtual(app).tipo, "final");
  assert.equal(app.text("#onboarding-question"), "Seu perfil está pronto para o próximo passo.");
  assert.equal(app.text("#onboarding-step-count"), "ETAPA 24 DE 24");
  assert.equal(app.text("#onboarding-next"), "Entrar no FORJA");
  assert.match(app.text(".onboarding-summary"), /Ganhar massa muscular/);
  assert.match(app.text(".onboarding-summary"), /Musculação/);

  const perfil = app.data(PROFILE_KEY);
  assert.ok(perfil, "O perfil deve ser gravado ao sair da revisão");
  assert.equal(perfil.version, 3, "O perfil gravado usa o modelo v3");
  assert.equal(perfil.sexo, "masculino");
  assert.equal(perfil.focoArea, "corpo-todo");
  assert.equal(perfil.objetivo, "hipertrofia");
  assert.deepEqual(perfil.motivacoes, ["forca", "saude"], "Listas são normalizadas na ordem do vocabulário");
  assert.equal(perfil.alturaCm, 178);
  assert.equal(perfil.pesoKg, 80);
  assert.equal(perfil.pesoAlvoKg, 76);
  assert.equal(perfil.tipoCorpo, "intermediario");
  assert.equal(perfil.anoNascimento, 1994);
  assert.equal(perfil.rotinaDiaria, "sentado");
  assert.equal(perfil.localTreino, "academia");
  assert.deepEqual(perfil.preferenciasTreino, ["musculacao"]);
  assert.equal(perfil.diasPorSemana, 4);
  assert.equal(perfil.nivel, "iniciante");
  assert.equal(perfil.experienciaFisica, "basicos");
  assert.deepEqual(perfil.consideracoes, ["baixo-impacto"]);
  assert.deepEqual(perfil.equipamentos, ["halteres", "maquinas"]);
  assert.equal(perfil.flexoes, "6-10");
  assert.equal(perfil.mobilidade, "pernas");
  assert.equal(perfil.recuperacao, "algum-tempo");
  assert.equal(perfil.recompensa, "metas");
  assert.equal(perfil.progressoPercebido, "consistencia");

  /* Traduções explícitas para os campos antigos. */
  assert.equal(perfil.equipamento, "ambos", "halteres (casa) + máquinas (academia) = ambos");
  assert.equal(perfil.modalidadePreferida, "weights", "Musculação vira modalidade weights");

  assert.ok(Date.parse(perfil.updatedAt), "updatedAt deve ser uma data ISO");
  assert.ok(Date.parse(perfil.onboardingConcluidoEm), "onboardingConcluidoEm deve ser registrada");

  /* Meta semanal criada só pelo opt-in (marcado por padrão), a partir dos dias. */
  const goals = app.data(GOALS_KEY);
  assert.ok(goals, "A meta sugerida deve ser gravada com a confirmação");
  assert.equal(goals.weeklySessions, 4);
  assert.equal(goals.modality, "weights");

  /* Entrar no FORJA leva à Home com confirmação e sem convite. */
  app.click("#onboarding-next");
  await until(() => app.d.body.dataset.page === "inicio", "retorno para a Home");
  await wait(60);

  assertNoErrors(app, "home após concluir");
  const toast = app.$("#toast");
  assert.ok(toast && !toast.hidden, "A confirmação de cadastro deve aparecer na Home");
  assert.equal(app.$("#onboarding-root").hidden, true, "O convite desaparece depois de concluir");
  assert.equal(app.F.state.profile.alturaCm, 178, "O perfil fica disponível para as outras páginas");
});

/* ------------------------------------------------------------------ */
/* 4. Voltar, preservar e editar pela revisão                          */
/* ------------------------------------------------------------------ */

await runTest("4. Voltar preserva as respostas e a revisão edita cada etapa", async () => {
  const app = await boot({}, "onboarding/index.html");

  await responderTudo(app, { objetivo: "forca", diasPorSemana: 3 });

  /* Volta da revisão para a última pergunta e confere o valor marcado. */
  await voltar(app);
  assert.equal(passoAtual(app).id, "progresso");
  assert.equal(app.$('input[name="onboarding-progressoPercebido"][value="consistencia"]').checked, true);

  /* Edita o objetivo pela revisão. */
  await irAteRevisao(app);
  const indiceObjetivo = indiceDoPasso(app, "objetivo");
  const editar = app.d.querySelector('.onboarding-edit[data-step="' + indiceObjetivo + '"]');
  assert.ok(editar, "A revisão deve oferecer edição da etapa de objetivo");
  app.click(editar);
  await wait(20);

  assert.equal(passoAtual(app).id, "objetivo");
  assert.equal(app.$('input[name="onboarding-objetivo"][value="forca"]').checked, true,
    "O valor anterior continua marcado");
  escolher(app, "objetivo", "emagrecimento");
  await irAteRevisao(app);
  assert.match(app.text(".onboarding-review"), /Perder peso/);

  await avancar(app); /* salva */
  await wait(60);
  app.click("#onboarding-next");
  await until(() => app.d.body.dataset.page === "inicio", "conclusão após edição");

  const perfil = app.data(PROFILE_KEY);
  assert.equal(perfil.objetivo, "emagrecimento", "A correção deve ser a resposta gravada");
  assert.equal(perfil.diasPorSemana, 3);
  assert.equal(perfil.alturaCm, 178, "As demais respostas continuam");
});

/* ------------------------------------------------------------------ */
/* 5. Reabertura                                                       */
/* ------------------------------------------------------------------ */

await runTest("5. Reabertura: com perfil abre na revisão; ?refazer=1 recomeça", async () => {
  const seed = { [PROFILE_KEY]: perfilV1({ sexo: "feminino" }) };

  const home = await boot(seed, "index.html");
  assert.equal(home.$("#onboarding-root").hidden, true, "Quem já tem perfil não vê o convite");
  assert.deepEqual(home.storageWrites, [], "A Home não deve regravar o perfil");
  home.close();

  const pagina = await boot(seed, "onboarding/index.html");
  assertNoErrors(pagina, "onboarding com perfil");
  assert.equal(passoAtual(pagina).tipo, "revisao", "Quem já tem perfil começa na revisão");
  assert.equal(pagina.text("#onboarding-step-count"), "ETAPA 23 DE 24");
  assert.deepEqual(pagina.storageWrites, [], "Abrir a página não regrava o perfil");
  pagina.close();

  const refazer = await boot(seed, "onboarding/index.html?refazer=1");
  assert.equal(passoAtual(refazer).id, "sexo", "Refazer recomeça na etapa 1");
  assert.equal(refazer.$('input[name="onboarding-sexo"][value="feminino"]').checked, true,
    "A resposta salva aparece pré-selecionada");
  refazer.close();
});

/* ------------------------------------------------------------------ */
/* 6. Compatibilidade com perfil antigo                                */
/* ------------------------------------------------------------------ */

await runTest("6. Perfil antigo (v1) é lido como v3, sem inventar e sem regravar", async () => {
  const seed = { [PROFILE_KEY]: perfilV1() };

  const perfil = await boot(seed, "perfil/index.html");
  assertNoErrors(perfil, "perfil v1");
  assert.equal(perfil.F.state.profile.version, 3, "O modelo lido é v3");
  assert.equal(perfil.F.state.profile.objetivo, "forca", "Os campos antigos continuam intactos");
  assert.equal(perfil.F.state.profile.diasPorSemana, 3);
  assert.equal(perfil.F.state.profile.duracaoMinutos, 45);
  assert.equal(perfil.F.state.profile.sexo, "", "Perfil antigo não ganha sexo inventado");
  assert.equal(perfil.F.state.profile.alturaCm, 0, "Campos novos começam vazios");
  assert.equal(perfil.F.state.profile.pesoKg, 0);
  assert.deepEqual(plain(perfil.F.state.profile.motivacoes), []);
  assert.equal(perfil.F.resolvePersonagem(perfil.F.state.profile), null,
    "Sem sexo, nenhum personagem é escolhido");
  assert.equal(perfil.d.getElementById("prof-dias").value, "3");
  assert.deepEqual(perfil.storageWrites, [], "Ler um perfil antigo não regrava nada");

  /* Refazer mantém as respostas antigas já marcadas e os campos novos vazios. */
  const app = await boot(seed, "onboarding/index.html?refazer=1");
  assert.equal(passoAtual(app).id, "sexo");
  assert.equal(app.$('input[name="onboarding-sexo"][value=""]').checked, true,
    "Perfil sem sexo abre em 'Prefiro não informar'");

  await responderTudo(app, { objetivo: "forca", nivel: "iniciante", diasPorSemana: 3 });
  assert.match(app.text(".onboarding-review"), /Aumentar a força/);
  assert.match(app.text(".onboarding-review"), /3 dias/);
  app.close();
});

/* ------------------------------------------------------------------ */
/* 7. Normalização e validação dos campos novos                        */
/* ------------------------------------------------------------------ */

await runTest("7. Normalização: valores ausentes, desconhecidos e fora de faixa", async () => {
  const app = await boot({}, "perfil/index.html");
  assertNoErrors(app);
  const F = app.F;

  const vazio = plain(F.normalizeProfile(null));
  assert.equal(vazio.version, 3);
  assert.equal(vazio.alturaCm, 0);
  assert.equal(vazio.pesoKg, 0);
  assert.equal(vazio.pesoAlvoKg, 0);
  assert.equal(vazio.anoNascimento, 0);
  assert.equal(vazio.focoArea, "");
  assert.deepEqual(vazio.motivacoes, []);
  assert.deepEqual(vazio.equipamentos, []);
  assert.equal(vazio.flexoes, "");

  const invalido = plain(F.normalizeProfile({
    alturaCm: 300,           /* fora da faixa: vira 0, não 250 */
    pesoKg: "muito",
    pesoAlvoKg: -12,
    anoNascimento: 2999,     /* futuro: vira 0 */
    focoArea: "biceps",
    motivacoes: ["saude", "saude", "inventado"],
    equipamentos: ["halteres", "piscina"],
    consideracoes: "desconfortos", /* tipo errado: vira lista vazia */
    flexoes: "muitas",
    objetivo: "voar",
    sexo: "outro"
  }));

  assert.equal(invalido.alturaCm, 0);
  assert.equal(invalido.pesoKg, 0);
  assert.equal(invalido.pesoAlvoKg, 0);
  assert.equal(invalido.anoNascimento, 0);
  assert.equal(invalido.focoArea, "");
  assert.deepEqual(invalido.motivacoes, ["saude"], "Sem repetição e sem valor desconhecido");
  assert.deepEqual(invalido.equipamentos, ["halteres"]);
  assert.deepEqual(invalido.consideracoes, []);
  assert.equal(invalido.flexoes, "");
  assert.equal(invalido.objetivo, "");
  assert.equal(invalido.sexo, "");

  /* Validação estrita no backup/importação. */
  assert.equal(F.validateProfileStore(perfilV1()), true, "Perfil v1 continua válido");
  assert.throws(() => F.validateProfileStore({ alturaCm: 300 }), /altura/i);
  assert.throws(() => F.validateProfileStore({ pesoKg: 999 }), /peso/i);
  assert.throws(() => F.validateProfileStore({ anoNascimento: 2999 }), /ano/i);
  assert.throws(() => F.validateProfileStore({ focoArea: "biceps" }), /foco|área/i);
  assert.throws(() => F.validateProfileStore({ equipamentos: ["piscina"] }), /equipamento/i);
  assert.equal(F.validateProfileStore({ alturaCm: 0, pesoAlvoKg: 0 }), true,
    "0 significa 'não informado' e é aceito");

  /* Traduções derivadas. */
  assert.equal(F.deriveEquipamento([]), "");
  assert.equal(F.deriveEquipamento(["nenhum"]), "nenhum");
  assert.equal(F.deriveEquipamento(["halteres"]), "casa");
  assert.equal(F.deriveEquipamento(["maquinas"]), "academia");
  assert.equal(F.deriveEquipamento(["elasticos", "academia-completa"]), "ambos");
  assert.equal(F.deriveModalidadePreferida(["musculacao"]), "weights");
  assert.equal(F.deriveModalidadePreferida(["calistenia"]), "calisthenics");
  assert.equal(F.deriveModalidadePreferida(["musculacao", "calistenia"]), "");
  assert.equal(F.deriveModalidadePreferida(["cardio"], "weights"), "weights",
    "Preferências sem modalidade única preservam o valor anterior");
});

/* ------------------------------------------------------------------ */
/* 8. Perfil: edição não apaga as respostas novas                      */
/* ------------------------------------------------------------------ */

await runTest("8. Perfil: edição comum preserva as respostas do cadastro guiado", async () => {
  const seed = {
    [PROFILE_KEY]: perfilV1({
      version: 3,
      sexo: "feminino",
      focoArea: "pernas",
      alturaCm: 165,
      pesoKg: 62.4,
      pesoAlvoKg: 0,
      anoNascimento: 1990,
      motivacoes: ["saude"],
      equipamentos: ["elasticos"],
      flexoes: "1-5",
      preferenciasTreino: ["calistenia"],
      diasPorSemana: 3
    })
  };

  const app = await boot(seed, "perfil/index.html");
  assertNoErrors(app, "perfil v3");

  /* Resumo somente leitura com as respostas do cadastro. */
  const painel = app.$("#perfil-cadastro-panel");
  assert.equal(painel.hidden, false, "O painel de respostas deve aparecer");
  assert.match(app.text("#profile-onboarding-summary"), /Pernas/);
  assert.match(app.text("#profile-onboarding-summary"), /165 cm/);
  assert.match(app.text("#profile-onboarding-summary"), /62,4 kg/);
  assert.match(app.text("#profile-onboarding-summary"), /Elásticos/);

  /* Salvar o formulário não zera nem inventa as respostas novas. */
  app.d.getElementById("prof-dias").value = "5";
  app.click("#profile-save");
  await wait(30);

  const perfil = app.data(PROFILE_KEY);
  assert.equal(perfil.diasPorSemana, 5, "O campo editado é gravado");
  assert.equal(perfil.alturaCm, 165, "A altura continua");
  assert.equal(perfil.pesoKg, 62.4);
  assert.equal(perfil.anoNascimento, 1990);
  assert.deepEqual(perfil.motivacoes, ["saude"]);
  assert.deepEqual(perfil.equipamentos, ["elasticos"]);
  assert.equal(perfil.focoArea, "pernas");
  assert.equal(perfil.flexoes, "1-5");
  assert.equal(perfil.sexo, "feminino");
});

/* ------------------------------------------------------------------ */
/* 9. Obrigatoriedade e etapas opcionais                               */
/* ------------------------------------------------------------------ */

await runTest("9. Etapas obrigatórias bloqueiam; opcionais têm 'Pular esta etapa'", async () => {
  const app = await boot({}, "onboarding/index.html");

  /* Área de foco é obrigatória. */
  escolher(app, "sexo", "masculino");
  await avancar(app);
  await avancar(app);
  assert.equal(passoAtual(app).id, "foco", "Sem escolha, a etapa não avança");
  assert.equal(app.$("#onboarding-error").hidden, false);

  escolher(app, "focoArea", "pernas");
  await avancar(app);
  assert.equal(passoAtual(app).id, "objetivo");
  escolher(app, "objetivo", "forca");
  await avancar(app);

  /* Motivação é opcional: o link de pular aparece. */
  assert.equal(passoAtual(app).id, "motivacao");
  assert.equal(app.$("#onboarding-skip-step").hidden, false, "Etapa opcional deve permitir pular");
  assert.equal(app.text("#onboarding-skip-step"), "Pular esta etapa");
  app.click("#onboarding-skip-step");
  await wait(20);
  assert.equal(passoAtual(app).id, "altura", "Pular avança sem responder");

  /* Altura é obrigatória (número). */
  await avancar(app);
  assert.equal(passoAtual(app).id, "altura", "Sem altura, não avança");
  assert.match(app.text("#onboarding-error"), /altura/i);
});

/* ------------------------------------------------------------------ */
/* 10. Altura: stepper, campo e unidades                               */
/* ------------------------------------------------------------------ */

await runTest("10. Altura: botões, digitação e conversão cm ↔ pés/polegadas", async () => {
  const app = await boot({}, "onboarding/index.html?refazer=1");
  escolher(app, "sexo", "feminino");
  await avancar(app);
  escolher(app, "focoArea", "corpo-todo");
  await avancar(app);
  escolher(app, "objetivo", "manutencao");
  await avancar(app);
  app.click("#onboarding-skip-step"); /* motivação */
  await wait(20);
  assert.equal(passoAtual(app).id, "altura");

  assert.equal(app.text("#onboarding-measure-value"), "—", "A altura começa vazia (nada é inventado)");

  /* Os botões partem de um valor plausível quando o campo está vazio. */
  app.click('.onboarding-step-button[aria-label^="Aumentar"]');
  await wait(10);
  assert.equal(app.text("#onboarding-measure-value"), "170", "Primeiro toque mostra o valor-base");
  app.click('.onboarding-step-button[aria-label^="Aumentar"]');
  await wait(10);
  assert.equal(app.text("#onboarding-measure-value"), "171");
  app.click('.onboarding-step-button[aria-label^="Diminuir"]');
  await wait(10);
  assert.equal(app.text("#onboarding-measure-value"), "170");

  /* Digitar direto no campo. */
  digitar(app, 178);
  assert.equal(app.text("#onboarding-measure-value"), "178");
  assert.equal(app.d.getElementById("onboarding-number").value, "178");

  /* Unidade imperial: dois campos, mesma medida. */
  unidade(app, "imperial");
  await wait(10);
  assert.equal(app.d.getElementById("onboarding-number").value, "5", "178 cm ≈ 5 pés");
  assert.equal(app.d.getElementById("onboarding-polegadas").value, "10", "…e 10 polegadas");
  assert.match(app.text("#onboarding-measure-value"), /5′ 10″/);

  /* 5 pés e 11 polegadas = 180 cm. */
  digitar(app, 11, "onboarding-polegadas");
  await wait(10);
  assert.equal(app.text("#onboarding-measure-value"), "5′ 11″");

  /* Voltar para cm mostra o valor convertido (180), sem perder precisão. */
  unidade(app, "cm");
  await wait(10);
  assert.equal(app.d.getElementById("onboarding-number").value, "180");

  /* Fora da faixa: bloqueia e explica. */
  digitar(app, 300);
  assert.equal(app.$("#onboarding-measure-feedback").hidden, false, "Faixa inválida deve avisar");
  await avancar(app);
  assert.equal(passoAtual(app).id, "altura", "Valor fora da faixa não avança");

  digitar(app, 180);
  await avancar(app);
  assert.equal(passoAtual(app).id, "peso");
});

/* ------------------------------------------------------------------ */
/* 11. Peso e peso-alvo                                                */
/* ------------------------------------------------------------------ */

await runTest("11. Peso: kg ↔ lb e peso-alvo com 'Ainda não defini'", async () => {
  const app = await boot({}, "onboarding/index.html");

  /* Vai direto até o peso. */
  escolher(app, "sexo", "masculino");
  await avancar(app);
  escolher(app, "focoArea", "corpo-todo");
  await avancar(app);
  escolher(app, "objetivo", "hipertrofia");
  await avancar(app);
  app.click("#onboarding-skip-step");
  await wait(20);
  digitar(app, 180);
  await avancar(app);

  assert.equal(passoAtual(app).id, "peso");
  assert.equal(app.text("#onboarding-measure-value"), "—");

  digitar(app, 80);
  assert.equal(app.text("#onboarding-measure-value"), "80");

  unidade(app, "lb");
  await wait(10);
  assert.equal(app.text("#onboarding-measure-value"), "176", "80 kg ≈ 176 lb");

  /* Digitar em libras grava kg com uma casa decimal. */
  digitar(app, 154);
  await wait(10);
  unidade(app, "kg");
  await wait(10);
  assert.equal(app.text("#onboarding-measure-value"), "69,9", "154 lb ≈ 69,9 kg");

  await avancar(app);
  assert.equal(passoAtual(app).id, "pesoAlvo");

  /* Peso-alvo é opcional e aceita "Ainda não defini". */
  const nula = app.$(".onboarding-measure-null .onboarding-inline-skip");
  assert.ok(nula, "O peso-alvo deve oferecer 'Ainda não defini'");
  app.click(nula);
  await wait(10);
  assert.equal(app.text("#onboarding-measure-value"), "—");
  assert.equal(nula.getAttribute("aria-pressed"), "true");

  /* Mas também aceita uma meta diferente do peso atual. */
  digitar(app, 75);
  await avancar(app);

  /* Confere o que foi gravado, avançando por uma resposta representativa. */
  assert.equal(passoAtual(app).id, "tipoCorpo");
  app.click("#onboarding-skip-step");
  await wait(20);
  digitar(app, 1994);
  await avancar(app);
  const fase = passoAtual(app).id;
  assert.equal(fase, "rotina");
});

/* ------------------------------------------------------------------ */
/* 12. Ano de nascimento                                               */
/* ------------------------------------------------------------------ */

await runTest("12. Ano de nascimento: validado, sem data futura e sem exibir idade", async () => {
  const app = await boot({}, "onboarding/index.html");
  const limite = new Date().getFullYear();

  /* Anda até o ano de nascimento. */
  escolher(app, "sexo", "masculino");
  await avancar(app);
  escolher(app, "focoArea", "corpo-todo");
  await avancar(app);
  escolher(app, "objetivo", "forca");
  await avancar(app);
  app.click("#onboarding-skip-step");
  await wait(20);
  digitar(app, 180);
  await avancar(app);
  digitar(app, 80);
  await avancar(app);
  digitar(app, 0);
  await avancar(app);           /* peso-alvo vazio é permitido */
  app.click("#onboarding-skip-step"); /* tipo de corpo */
  await wait(20);

  assert.equal(passoAtual(app).id, "anoNascimento");
  assert.ok(passoAtual(app).maximo === limite, "O limite é o ano corrente");

  digitar(app, limite + 1);
  await avancar(app);
  assert.equal(passoAtual(app).id, "anoNascimento", "Ano futuro não pode avançar");
  assert.match(app.text("#onboarding-measure-feedback"), /Entre/);

  digitar(app, 1899);
  await avancar(app);
  assert.equal(passoAtual(app).id, "anoNascimento", "Ano anterior a 1900 não pode avançar");

  digitar(app, 1990);
  await avancar(app);
  assert.equal(passoAtual(app).id, "rotina");
  assert.doesNotMatch(app.text("#onboarding-step"), /idade/i, "Nenhuma idade é exibida");
});

/* ------------------------------------------------------------------ */
/* 13. Seleção múltipla                                                */
/* ------------------------------------------------------------------ */

await runTest("13. Seleção múltipla: várias opções, exclusividade e desmarcar", async () => {
  const app = await boot({}, "onboarding/index.html?refazer=1");
  escolher(app, "sexo", "feminino");
  await avancar(app);
  escolher(app, "focoArea", "abdomen");
  await avancar(app);
  escolher(app, "objetivo", "resistencia");
  await avancar(app);

  /* Motivação: três escolhas convivem. */
  assert.equal(passoAtual(app).id, "motivacao");
  marcar(app, "motivacoes", ["aparencia", "saude", "energia"]);
  await wait(10);
  assert.equal(app.$$(".onboarding-option.is-selected").length, 3);
  desmarcar(app, "motivacoes", "aparencia");
  await wait(10);
  assert.equal(app.$$(".onboarding-option.is-selected").length, 2);
  await avancar(app);

  /* Preferência de treino é obrigatória (múltipla). */
  while (["altura", "peso", "pesoAlvo", "tipoCorpo", "anoNascimento"].indexOf(passoAtual(app).id) !== -1) {
    const id = passoAtual(app).id;
    if (id === "altura") digitar(app, 170);
    if (id === "peso") digitar(app, 70);
    if (id === "anoNascimento") digitar(app, 1998);
    if (id === "pesoAlvo") digitar(app, 0);
    if (id === "tipoCorpo") app.click("#onboarding-skip-step");
    await wait(20);
    if (id !== "tipoCorpo") await avancar(app);
  }

  while (["rotina", "local"].indexOf(passoAtual(app).id) !== -1) {
    const passo = passoAtual(app);
    escolher(app, passo.campo, passo.opcoes[0].valor);
    await avancar(app);
  }

  assert.equal(passoAtual(app).id, "preferencias");
  await avancar(app);
  assert.equal(passoAtual(app).id, "preferencias", "Sem marcar nada, não avança");
  assert.match(app.text("#onboarding-error"), /uma opção/i);

  marcar(app, "preferenciasTreino", ["musculacao", "calistenia"]);
  await wait(10);
  assert.equal(app.$$(".onboarding-option.is-selected").length, 2);

  /* "Quero descobrir" é exclusiva: limpa as demais. */
  escolher(app, "preferenciasTreino", "descobrir");
  await wait(10);
  const marcados = app.$$(".onboarding-option.is-selected").map(el => el.getAttribute("data-value"));
  assert.deepEqual(marcados, ["descobrir"]);
  await avancar(app);
  assert.equal(passoAtual(app).id, "dias");

  /* Equipamentos: "Nenhum equipamento" não convive com os outros. */
  while (passoAtual(app).id !== "equipamentos") {
    const passo = passoAtual(app);
    if (passo.tipo === "escolha") escolher(app, passo.campo, passo.opcoes[0].valor);
    if (passo.tipo === "numero") digitar(app, passo.id === "anoNascimento" ? 0 : 0);
    await avancar(app);
  }

  marcar(app, "equipamentos", ["halteres", "elasticos"]);
  await wait(10);
  assert.equal(app.$$(".onboarding-option.is-selected").length, 2);
  escolher(app, "equipamentos", "nenhum");
  await wait(10);
  const equipamentosMarcados = app.$$(".onboarding-option.is-selected").map(el => el.getAttribute("data-value"));
  assert.deepEqual(equipamentosMarcados, ["nenhum"]);
});

/* ------------------------------------------------------------------ */
/* 14. Retomada de rascunho                                            */
/* ------------------------------------------------------------------ */

await runTest("14. Retomada: rascunho em sessionStorage volta na mesma etapa", async () => {
  const rascunho = {
    passo: 4,
    respostas: { sexo: "feminino", focoArea: "peito", objetivo: "forca", motivacoes: ["saude"] },
    tocados: { sexo: true, focoArea: true, objetivo: true, motivacoes: true }
  };

  const app = await boot({}, "onboarding/index.html", {
    session: { [DRAFT_KEY]: JSON.stringify(rascunho) }
  });
  assertNoErrors(app, "retomada");

  assert.equal(passoAtual(app).id, "altura", "Retoma na etapa do rascunho");
  assert.equal(app.text("#onboarding-step-count"), "ETAPA 5 DE 24");
  assert.equal(app.raw(PROFILE_KEY), null, "Retomar não grava o perfil");
  assert.deepEqual(app.storageWrites, [], "Retomar não grava chave de perfil");

  /* Voltar mostra as respostas anteriores marcadas. */
  await voltar(app);
  assert.equal(passoAtual(app).id, "motivacao");
  assert.equal(app.$('input[name="onboarding-motivacoes"][value="saude"]').checked, true);

  /* O rascunho é apagado na conclusão. */
  await responderTudo(app);
  await avancar(app);
  await wait(60);
  assert.equal(app.w.sessionStorage.getItem(DRAFT_KEY), null, "Concluir apaga o rascunho");
  assert.ok(app.data(PROFILE_KEY), "Concluir grava o perfil");
});

/* ------------------------------------------------------------------ */
/* 15. Falha de gravação                                               */
/* ------------------------------------------------------------------ */

await runTest("15. Falha ao gravar: erro visível, rascunho mantido e novas tentativas", async () => {
  const app = await boot({}, "onboarding/index.html");
  await responderTudo(app);

  const failing = installFailingStorage(app, { failOn: PROFILE_KEY, times: 1 });
  app.click("#onboarding-next");
  await wait(40);
  failing.restore();

  assert.equal(passoAtual(app).tipo, "revisao", "Sem gravação, a revisão continua aberta");
  assert.equal(app.$("#onboarding-error").hidden, false, "O erro deve ser informado");
  assert.match(app.text("#onboarding-error"), /salvar/i);
  assert.equal(app.raw(PROFILE_KEY), null);
  assert.ok(app.w.sessionStorage.getItem(DRAFT_KEY), "O rascunho deve continuar na aba");

  /* Nova tentativa grava tudo. */
  app.click("#onboarding-next");
  await wait(60);
  assert.equal(passoAtual(app).tipo, "final");
  assert.ok(app.data(PROFILE_KEY), "A segunda tentativa grava o perfil");
  assert.equal(app.w.sessionStorage.getItem(DRAFT_KEY), null);
});

/* ------------------------------------------------------------------ */
/* 16. Preservação de rotinas e histórico                              */
/* ------------------------------------------------------------------ */

await runTest("16. Concluir não altera rotinas, histórico nem outras chaves", async () => {
  const rotina = makeRoutine("weights", "Força A", [
    { id: "o-1", name: "Supino", sets: 3, reps: "8", section: "main" }
  ], "rot-onboarding");
  const historico = [{
    id: "h-onboarding", date: "2026-01-05", modality: "weights", routineId: rotina.id,
    routineName: "Força A", durationMs: 1_800_000, completedSets: 3, totalPlannedSets: 3,
    status: "completed", finishedAt: "2026-01-05T10:00:00.000Z", exercises: []
  }];

  const seed = {
    [ROUTINES_KEY]: routinesStore([], [rotina]),
    [HISTORY_KEY]: historico
  };

  const app = await boot(seed, "onboarding/index.html?refazer=1");
  const antes = storageSnapshot(app);
  await responderTudo(app);
  await avancar(app);  /* salva */
  await wait(60);

  assert.equal(app.raw(ROUTINES_KEY), antes[ROUTINES_KEY], "Rotinas não podem mudar");
  assert.equal(app.raw(HISTORY_KEY), antes[HISTORY_KEY], "Histórico não pode mudar");

  const escritas = app.storageWrites.filter(item => item.method === "setItem").map(item => item.key);
  assert.deepEqual(escritas, [PROFILE_KEY, GOALS_KEY].filter(key => escritas.indexOf(key) !== -1),
    "Só o perfil (e a meta opt-in) podem ser gravados: " + JSON.stringify(escritas));
});

/* ------------------------------------------------------------------ */
/* 17. Estrutura, acessibilidade e ausência de erros                   */
/* ------------------------------------------------------------------ */

await runTest("17. Estrutura: uma pergunta por tela, progresso e sem perguntas futuras", async () => {
  const app = await boot({}, "onboarding/index.html");
  assertNoErrors(app, "estrutura");

  const css = fs.readFileSync(path.resolve(repoRoot, "assets/css/onboarding.css"), "utf8");
  assert.match(css, /min-height:\s*52px/, "Os controles principais têm alvo generoso");
  assert.match(css, /prefers-reduced-motion/, "A animação respeita movimento reduzido");
  assert.match(css, /aria|focus-visible/, "O foco é visível");

  /* A primeira tela não expõe nenhuma pergunta futura. */
  const texto = app.text("#onboarding-step");
  [
    "Qual área você quer priorizar",
    "Qual é o seu principal objetivo",
    "Qual é a sua altura",
    "Qual é o seu peso atual",
    "Em que ano você nasceu",
    "Quantas flexões"
  ].forEach(pergunta => {
    assert.ok(texto.indexOf(pergunta) === -1,
      "A etapa 1 não deve mostrar conteúdo de outra etapa: " + pergunta);
  });

  /* A etapa 1 tem exatamente um grupo de rádio e um título focável. */
  const grupo = app.$('.onboarding-cards[role="radiogroup"]');
  assert.ok(grupo, "Os cartões formam um grupo de rádio");
  const titulo = app.$("#onboarding-question");
  assert.equal(titulo.tagName, "H1");
  assert.equal(titulo.getAttribute("tabindex"), "-1");

  /* Cada etapa tem título próprio e o progresso acompanha. */
  escolher(app, "sexo", "masculino");
  await avancar(app);
  assert.equal(app.text("#onboarding-step-count"), "ETAPA 2 DE 24");
  assert.equal(app.$("#onboarding-progressbar").getAttribute("aria-valuenow"), "2");
  assert.equal(app.$$("#onboarding-step h1").length, 1, "Uma pergunta por tela");

  /* A ferramenta de progresso anuncia o texto da etapa. */
  assert.match(app.$("#onboarding-progressbar").getAttribute("aria-valuetext"), /Etapa 2 de 24/);
});

/* ------------------------------------------------------------------ */
/* Relatório                                                           */
/* ------------------------------------------------------------------ */

const failed = results.filter(item => !item.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " testes de onboarding passaram.");

if (failed.length > 0) {
  process.exitCode = 1;
}
