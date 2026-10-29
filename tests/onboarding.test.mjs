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

/* Avança (sem tocar nas respostas) até a pergunta pedida aparecer. */
async function avancarAte(app, titulo) {
  for (let tentativas = 0; tentativas < 30; tentativas += 1) {
    if (app.text("#onboarding-question") === titulo) return;
    await avancar(app);
  }
  assert.equal(app.text("#onboarding-question"), titulo, "Não chegou à etapa: " + titulo);
}

function digitarNumero(app, seletor, valor) {
  const input = app.$(seletor);
  assert.ok(input, "Campo numérico não encontrado: " + seletor);
  input.value = String(valor);
  input.dispatchEvent(new app.w.Event("input", { bubbles: true }));
  return input;
}

async function irParaOnboarding(app) {
  app.click("#onboarding-start");
  await until(() => app.d.body.dataset.page === "onboarding", "página de onboarding");
  await wait(30);
}

/* Respostas padrão das 22 perguntas, na ordem real das telas. */
const RESPOSTAS_PADRAO = {
  sexo: "masculino",
  areaFoco: "corpoTodo",
  objetivo: "hipertrofia",
  motivacoes: ["saude", "forca"],
  alturaCm: 178,
  pesoKg: "82,5",
  pesoAlvoKg: "indefinido",
  tipoCorpo: "intermediario",
  anoNascimento: 1996,
  rotinaDiaria: "sentado",
  localTreino: "academia",
  preferenciasTreino: ["musculacao"],
  dias: 4,
  nivel: "iniciante",
  experienciaAtual: "basicos",
  consideracoes: ["nenhuma"],
  equipamentos: ["academiaCompleta"],
  flexoes: "6a10",
  mobilidade: "pernas",
  recuperacaoEsforco: "algumTempo",
  celebracao: "evolucao",
  acompanhamento: "forca"
};

/* Responde a pergunta atual (sem avançar), conforme o id da etapa. */
async function responderPasso(app, id, valores) {
  switch (id) {
    case "sexo": escolher(app, "sexo", valores.sexo); break;
    case "area-foco": escolher(app, "areaFoco", valores.areaFoco); break;
    case "objetivo": escolher(app, "objetivo", valores.objetivo); break;
    case "motivacao":
      valores.motivacoes.forEach(item => escolher(app, "motivacoes", item));
      break;
    case "altura": digitarNumero(app, "#onboarding-alturaCm", valores.alturaCm); break;
    case "peso": digitarNumero(app, "#onboarding-pesoKg", valores.pesoKg); break;
    case "peso-alvo":
      if (valores.pesoAlvoKg === "indefinido") {
        app.click("#onboarding-indefinido");
        const caixa = app.$("#onboarding-indefinido");
        caixa.checked = true;
        caixa.dispatchEvent(new app.w.Event("change", { bubbles: true }));
      } else if (valores.pesoAlvoKg === "pular") {
        /* Avançar sem tocar pula a etapa opcional. */
      } else {
        digitarNumero(app, "#onboarding-pesoAlvoKg", valores.pesoAlvoKg);
      }
      break;
    case "tipo-corpo": escolher(app, "tipoCorpo", valores.tipoCorpo); break;
    case "ano-nascimento": digitarNumero(app, "#onboarding-anoNascimento", valores.anoNascimento); break;
    case "rotina-diaria": escolher(app, "rotinaDiaria", valores.rotinaDiaria); break;
    case "local-treino": escolher(app, "localTreino", valores.localTreino); break;
    case "preferencia-treino":
      valores.preferenciasTreino.forEach(item => escolher(app, "preferenciasTreino", item));
      break;
    case "dias": escolher(app, "dias", valores.dias); break;
    case "nivel": escolher(app, "nivel", valores.nivel); break;
    case "experiencia": escolher(app, "experienciaAtual", valores.experienciaAtual); break;
    case "consideracoes":
      valores.consideracoes.forEach(item => escolher(app, "consideracoes", item));
      break;
    case "equipamentos":
      if (valores.equipamentos !== "pular") {
        valores.equipamentos.forEach(item => escolher(app, "equipamentos", item));
      }
      break;
    case "flexoes":
      if (valores.flexoes !== "pular") escolher(app, "flexoes", valores.flexoes);
      else escolher(app, "flexoes", "");
      break;
    case "mobilidade":
      if (valores.mobilidade !== "pular") escolher(app, "mobilidade", valores.mobilidade);
      break;
    case "sensacao-esforco":
      if (valores.recuperacaoEsforco !== "pular") {
        escolher(app, "recuperacaoEsforco", valores.recuperacaoEsforco);
      }
      break;
    case "celebracao": escolher(app, "celebracao", valores.celebracao); break;
    case "acompanhamento": escolher(app, "acompanhamento", valores.acompanhamento); break;
    default: assert.fail("Etapa sem resposta no plano de teste: " + id);
  }
  await wait(10);
}

const ORDEM_PERGUNTAS = [
  "sexo", "area-foco", "objetivo", "motivacao", "altura", "peso", "peso-alvo",
  "tipo-corpo", "ano-nascimento", "rotina-diaria", "local-treino",
  "preferencia-treino", "dias", "nivel", "experiencia", "consideracoes",
  "equipamentos", "flexoes", "mobilidade", "sensacao-esforco", "celebracao",
  "acompanhamento"
];

/* Responde da etapa `idInicial` até a revisão (inclusive o avanço final). */
async function responderAPartirDe(app, idInicial, respostas = {}) {
  const valores = Object.assign({}, RESPOSTAS_PADRAO, respostas);
  const inicio = ORDEM_PERGUNTAS.indexOf(idInicial);
  assert.ok(inicio !== -1, "Etapa inicial desconhecida: " + idInicial);

  for (const id of ORDEM_PERGUNTAS.slice(inicio)) {
    if (id === "equipamentos" && valores.equipamentos === "pular") {
      app.click("#onboarding-skip-step");
      await wait(20);
      continue;
    }
    await responderPasso(app, id, valores);
    await avancar(app);
  }
}

/* Fluxo completo com respostas padrão; para na revisão. */
async function responderTudo(app, respostas = {}) {
  await responderAPartirDe(app, "sexo", respostas);
}

/* Da revisão: avança para a preparação e conclui ("Entrar no FORJA"). */
async function concluirDaRevisao(app) {
  assert.equal(app.text("#onboarding-question"), "Confira suas respostas");
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Seu perfil está pronto para o próximo passo.");
  assert.equal(app.text("#onboarding-next"), "Entrar no FORJA");
  app.click("#onboarding-next");
  await wait(20);
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

  /* A primeira tela já é a primeira pergunta, com as duas fotos reais. */
  assert.equal(home.text("#onboarding-question"), "Vamos personalizar seu treino.");
  assert.equal(home.$("#onboarding-progressbar").getAttribute("role"), "progressbar");
  assert.equal(home.text("#onboarding-step-count"), "Etapa 1 de 22");
  const fotoMasc = home.$('img[data-sexo="masculino"]');
  const fotoFem = home.$('img[data-sexo="feminino"]');
  assert.ok(fotoMasc, "Falta a imagem masculina no cartão Masculino");
  assert.ok(fotoFem, "Falta a imagem feminina no cartão Feminino");
  assert.match(fotoMasc.getAttribute("src"), /assets\/onboarding\/sexo-masculino\.png$/);
  assert.match(fotoFem.getAttribute("src"), /assets\/onboarding\/sexo-feminino\.jpg$/);
  assert.notEqual(fotoMasc.getAttribute("src"), fotoFem.getAttribute("src"),
    "Os dois cartões não podem usar a mesma imagem");
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
  assert.equal(app.text("#onboarding-next"), "Continuar");
  assert.equal(app.raw(PROFILE_KEY), null, "A revisão ainda não grava o perfil");

  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Seu perfil está pronto para o próximo passo.");
  assert.equal(app.text("#onboarding-next"), "Entrar no FORJA");
  assert.equal(app.raw(PROFILE_KEY), null, "A preparação ainda não grava o perfil");
  /* Resumo honesto: objetivo, modalidade e disponibilidade que a pessoa deu. */
  assert.match(app.text(".onboarding-summary"), /Ganhar massa muscular/);
  assert.match(app.text(".onboarding-summary"), /Musculação/);
  assert.match(app.text(".onboarding-summary"), /4 dias por semana/);

  app.click("#onboarding-next");
  await until(() => app.d.body.dataset.page === "inicio", "retorno para a Home");
  await wait(40);

  assertNoErrors(app, "home após concluir");

  const perfil = app.data(PROFILE_KEY);
  assert.ok(perfil, "O perfil deve ser gravado na conclusão");
  assert.deepEqual(perfil, {
    version: 3,
    updatedAt: perfil.updatedAt,
    objetivo: "hipertrofia",
    nivel: "iniciante",
    equipamento: "academia",
    diasPorSemana: 4,
    duracaoMinutos: 0,
    sexo: "masculino",
    modalidadePreferida: "weights",
    onboardingConcluidoEm: perfil.onboardingConcluidoEm,
    areaFoco: "corpoTodo",
    motivacoes: ["saude", "forca"],
    alturaCm: 178,
    pesoKg: 82.5,
    pesoAlvoKg: 0,
    tipoCorpo: "intermediario",
    anoNascimento: 1996,
    rotinaDiaria: "sentado",
    localTreino: "academia",
    preferenciasTreino: ["musculacao"],
    experienciaAtual: "basicos",
    consideracoes: ["nenhuma"],
    equipamentos: ["academiaCompleta"],
    flexoes: "6a10",
    mobilidade: "pernas",
    recuperacaoEsforco: "algumTempo",
    celebracao: "evolucao",
    acompanhamento: "forca"
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

  const valores = Object.assign({}, RESPOSTAS_PADRAO, { sexo: "feminino" });
  await responderPasso(app, "sexo", valores);
  await avancar(app);
  await responderPasso(app, "area-foco", Object.assign({}, valores, { areaFoco: "pernas" }));
  await avancar(app);
  await responderPasso(app, "objetivo", Object.assign({}, valores, { objetivo: "forca" }));
  await avancar(app);

  /* Volta duas etapas: as respostas anteriores continuam marcadas. */
  await voltar(app);
  assert.equal(app.text("#onboarding-question"), "Qual é o seu principal objetivo?");
  assert.equal(app.$('input[name="onboarding-objetivo"][value="forca"]').checked, true,
    "A resposta anterior deve continuar marcada");
  await voltar(app);
  assert.equal(app.text("#onboarding-question"), "Qual área você quer priorizar?");
  assert.equal(app.$('input[name="onboarding-areaFoco"][value="pernas"]').checked, true);
  await escolher(app, "areaFoco", "bracos");
  await avancar(app);
  await avancar(app);

  await responderAPartirDe(app, "motivacao", {
    sexo: "feminino", dias: 3, nivel: "avancado",
    preferenciasTreino: ["calistenia", "funcional"],
    equipamentos: ["halteres", "elasticos"]
  });

  assert.match(app.text(".onboarding-review"), /3 dias por semana/);
  assert.match(app.text(".onboarding-review"), /Braços/);

  /* "Editar" na revisão salta direto para a etapa escolhida (dias). */
  const indiceDias = String(app.F.onboarding.PASSOS.findIndex(item => item.id === "dias"));
  const editar = app.$$(".onboarding-edit").find(button => button.getAttribute("data-step") === indiceDias);
  assert.ok(editar, "A revisão deve oferecer edição de cada resposta");
  editar.dispatchEvent(new app.w.MouseEvent("click", { bubbles: true, cancelable: true }));
  await wait(20);
  assert.equal(app.text("#onboarding-question"), "Quantos dias por semana você quer treinar?");
  assert.equal(app.$('input[name="onboarding-diasPorSemana"][value="3"]').checked, true);
  await escolher(app, "dias", 5);
  await avancarAte(app, "Confira suas respostas");
  assert.match(app.text(".onboarding-review"), /5 dias por semana/);

  await concluirDaRevisao(app);
  await until(() => app.d.body.dataset.page === "inicio", "conclusão após correção");

  const perfil = app.data(PROFILE_KEY);
  assert.equal(perfil.sexo, "feminino");
  assert.equal(perfil.areaFoco, "bracos", "A correção ao voltar deve ser a resposta gravada");
  assert.equal(perfil.objetivo, "forca");
  assert.equal(perfil.nivel, "avancado");
  assert.equal(perfil.diasPorSemana, 5, "A edição pela revisão deve ser a resposta gravada");
  assert.equal(perfil.duracaoMinutos, 0, "Sem pergunta de duração neste fluxo: fica não definida");
  assert.equal(perfil.equipamento, "casa", "Halteres+elásticos resumem em 'casa' no campo clássico");
  assert.equal(perfil.modalidadePreferida, "calisthenics");
  assert.deepEqual(perfil.equipamentos, ["halteres", "elasticos"]);
  assert.deepEqual(perfil.preferenciasTreino, ["calistenia", "funcional"]);
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
  assert.equal(pagina.text("#onboarding-next"), "Continuar");
  assert.match(pagina.text(".onboarding-review"), /Feminino/);
  /* A resposta clássica de equipamento aparece semeada na pergunta detalhada. */
  assert.match(pagina.text(".onboarding-review"), /Equipamentos de academia completos/);
  assert.deepEqual(pagina.storageWrites, [], "Abrir a página não deve regravar o perfil");
  pagina.close();

  /* Quem pede explicitamente para refazer começa do começo. */
  const refazer = await boot(seed, "onboarding/index.html?refazer=1");
  assert.equal(refazer.text("#onboarding-question"), "Vamos personalizar seu treino.", "Refazer deve recomeçar");
  refazer.close();
});

/* ------------------------------------------------------------------ */
/* 5. Perfil antigo sem o campo novo                                   */
/* ------------------------------------------------------------------ */

await runTest("5. Perfil antigo (v1) sem sexo carrega sem erro, sem personagem e sem regravar", async () => {
  const seed = { [PROFILE_KEY]: perfilV1() };

  const perfil = await boot(seed, "perfil/index.html");
  assertNoErrors(perfil, "perfil v1");
  assert.equal(perfil.F.state.profile.version, 3, "O modelo lido é v3 (aditivo)");
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
    version: 3, updatedAt: null, objetivo: "", nivel: "", equipamento: "",
    diasPorSemana: 0, duracaoMinutos: 0,
    sexo: "", modalidadePreferida: "", onboardingConcluidoEm: null,
    areaFoco: "", motivacoes: [], alturaCm: 0, pesoKg: 0, pesoAlvoKg: 0,
    tipoCorpo: "", anoNascimento: 0, rotinaDiaria: "", localTreino: "",
    preferenciasTreino: [], experienciaAtual: "", consideracoes: [],
    equipamentos: [], flexoes: "", mobilidade: "", recuperacaoEsforco: "",
    celebracao: "", acompanhamento: ""
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
    onboardingConcluidoEm: 12,
    areaFoco: "ombros",
    motivacoes: ["saude", "voar", "saude"],
    alturaCm: 999,
    pesoKg: "muito",
    pesoAlvoKg: -10,
    tipoCorpo: "forte",
    anoNascimento: 3000,
    preferenciasTreino: "musculacao",
    equipamentos: ["halteres", "piscina"],
    flexoes: "100"
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
  assert.equal(invalido.areaFoco, "", "Área fora do vocabulário vira vazia");
  assert.deepEqual(invalido.motivacoes, ["saude"], "Listas filtram desconhecidos e repetidos");
  assert.equal(invalido.alturaCm, 250, "Altura absurda é limitada à faixa na leitura");
  assert.equal(invalido.pesoKg, 0, "Peso não numérico volta para não informado");
  assert.equal(invalido.pesoAlvoKg, 0);
  assert.equal(invalido.tipoCorpo, "");
  assert.equal(invalido.anoNascimento, new Date().getFullYear(), "Ano futuro é limitado ao ano atual na leitura");
  assert.deepEqual(invalido.preferenciasTreino, [], "Lista precisa ser lista");
  assert.deepEqual(invalido.equipamentos, ["halteres"]);
  assert.equal(invalido.flexoes, "");

  /* Novos valores legítimos sobrevivem à normalização. */
  const legitimo = plain(F.normalizeProfile({
    objetivo: "perderPeso", nivel: "retornando", alturaCm: 172, pesoKg: 70.55,
    anoNascimento: 1990, equipamentos: ["elasticos"], celebracao: "pequenas"
  }));
  assert.equal(legitimo.objetivo, "perderPeso");
  assert.equal(legitimo.nivel, "retornando");
  assert.equal(legitimo.pesoKg, 70.6, "Peso é guardado com uma casa decimal");
  assert.deepEqual(legitimo.equipamentos, ["elasticos"]);

  /* Validação de backup é estrita nos campos novos. */
  assert.equal(F.validateProfileStore(perfilV1({ sexo: "feminino" })), true);
  assert.throws(() => F.validateProfileStore({ sexo: "outro" }), /sexo/i);
  assert.throws(() => F.validateProfileStore({ modalidadePreferida: "crossfit" }), /modalidade/i);
  assert.throws(() => F.validateProfileStore({ onboardingConcluidoEm: "ontem" }), /data/i);
  assert.throws(() => F.validateProfileStore({ areaFoco: "ombros" }), /área de foco/i);
  assert.throws(() => F.validateProfileStore({ motivacoes: ["voar"] }), /motivações/i);
  assert.throws(() => F.validateProfileStore({ equipamentos: "halteres" }), /equipamentos/i);
  assert.throws(() => F.validateProfileStore({ alturaCm: 300 }), /altura/i);
  assert.throws(() => F.validateProfileStore({ alturaCm: 40 }), /altura/i);
  assert.throws(() => F.validateProfileStore({ pesoKg: 999 }), /peso atual/i);
  assert.throws(() => F.validateProfileStore({ anoNascimento: new Date().getFullYear() + 1 }), /ano de nascimento/i);
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
    [PROFILE_KEY]: perfilV1({
      objetivo: "perderPeso", areaFoco: "peito", alturaCm: 180, pesoKg: 90,
      motivacoes: ["saude"], equipamentos: ["halteres"]
    }),
    [ROUTINES_KEY]: routinesStore([], [rotina]),
    [HISTORY_KEY]: historico
  }, "perfil/index.html");
  assertNoErrors(app, "perfil com histórico");
  assert.equal(app.d.getElementById("prof-objetivo").value, "perderPeso",
    "O formulário de Perfil reconhece os objetivos novos do onboarding");

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
  assert.equal(perfil.objetivo, "perderPeso", "Campos não editados permanecem");
  assert.equal(perfil.areaFoco, "peito", "Respostas novas não são apagadas ao salvar em Perfil");
  assert.equal(perfil.alturaCm, 180);
  assert.equal(perfil.pesoKg, 90);
  assert.deepEqual(perfil.motivacoes, ["saude"]);
  assert.deepEqual(perfil.equipamentos, ["halteres"]);
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

  /* A primeira etapa exige uma escolha: avançar sem tocar é bloqueado. */
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Vamos personalizar seu treino.");
  assert.equal(app.$("#onboarding-error").hidden, false);
  assert.equal(app.raw(PROFILE_KEY), null);

  await responderTudo(app, {
    sexo: "", objetivo: "manterForma", nivel: "", dias: 0,
    preferenciasTreino: ["descobrir"], equipamentos: ["nenhum"]
  });
  assert.equal(app.$("#onboarding-goals"), null,
    "O opt-in de meta vive na preparação, não na revisão");

  await concluirDaRevisao(app);
  await until(() => app.d.body.dataset.page === "inicio", "conclusão sem sexo");

  const perfil = app.data(PROFILE_KEY);
  assert.equal(perfil.sexo, "", "Não informar grava vazio, não um palpite");
  assert.equal(perfil.objetivo, "manterForma");
  assert.equal(perfil.diasPorSemana, 0);
  assert.equal(perfil.equipamento, "nenhum");
  assert.equal(perfil.modalidadePreferida, "", "'Quero descobrir' não vira modalidade inventada");
  assert.equal(app.raw(GOALS_KEY), null, "Sem dias/duração não há meta sugerida");
  assert.equal(app.F.resolvePersonagem(app.F.state.profile), null);
  assertNoErrors(app, "home sem sexo");
  assert.ok(app.$("#home-primary-button"), "A Home continua funcional sem personagem");
});

/* ------------------------------------------------------------------ */
/* 10. Backup                                                          */
/* ------------------------------------------------------------------ */

await runTest("10. Backup: exporta, importa e restaura perfil v3 e aceita perfil v1", async () => {
  const origem = await boot({
    [PROFILE_KEY]: perfilV1({
      sexo: "masculino", modalidadePreferida: "weights",
      areaFoco: "pernas", alturaCm: 181, equipamentos: ["barraAnilhas"]
    })
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
  assert.equal(destino.F.state.profile.areaFoco, "pernas", "Importação restaura as respostas novas");
  assert.equal(destino.F.state.profile.alturaCm, 181);
  assert.deepEqual(plain(destino.F.state.profile.equipamentos), ["barraAnilhas"]);
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
  await concluirDaRevisao(app);
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

  assert.match(css, /\.onboarding-photo-grid \{/, "Falta a grade das fotos da primeira etapa");
  assert.match(css, /\.onboarding-photo-media \{[^}]*aspect-ratio: 2 \/ 3/s, "As fotos devem manter a proporção 2:3, sem corte");
  assert.match(css, /\.onboarding-number-input \{[^}]*min-height: 52px/s, "Campo numérico precisa ser grande");
  assert.match(css, /\.onboarding-stepper \{[^}]*min-height: 64px/s, "Botões +/− abaixo do alvo de toque");
  assert.match(css, /\.onboarding-skip-step \{[^}]*min-height: 48px/s, "Botão de pular abaixo de 44px");

  /* Estrutura: 22 perguntas + revisão + preparação, um título por tela. */
  const app = await boot({}, "onboarding/index.html");
  const passos = app.F.onboarding.PASSOS;
  assert.equal(passos.length, 24, "O fluxo deve ter 22 perguntas + revisão + preparação");
  assert.equal(passos[22].tipo, "revisao");
  assert.equal(passos[23].tipo, "preparacao");

  const perguntas = passos.filter(passo =>
    ["foto", "escolha", "multipla", "numero"].indexOf(passo.tipo) !== -1);
  assert.equal(perguntas.length, 22);
  assert.equal(perguntas[0].campo, "sexo");
  assert.equal(perguntas[0].tipo, "foto");
  assert.ok(perguntas[0].opcoes.some(opcao => opcao.valor === ""), "Deve existir 'Prefiro não informar'");
  const fotoMasc = perguntas[0].opcoes.find(opcao => opcao.valor === "masculino");
  const fotoFem = perguntas[0].opcoes.find(opcao => opcao.valor === "feminino");
  assert.match(fotoMasc.imagem, /sexo-masculino\.png$/);
  assert.match(fotoFem.imagem, /sexo-feminino\.jpg$/);
  assert.ok(fs.existsSync(path.join(repoRoot, fotoMasc.imagem)), "O arquivo masculino deve existir");
  assert.ok(fs.existsSync(path.join(repoRoot, fotoFem.imagem)), "O arquivo feminino deve existir");
  assert.ok(fs.statSync(path.join(repoRoot, fotoMasc.imagem)).size > 0);
  assert.ok(fs.statSync(path.join(repoRoot, fotoFem.imagem)).size > 0);

  /* Toda opção de toda pergunta precisa sobreviver à normalização do perfil:
     é a garantia de que nada que a tela oferece é descartado ao gravar. */
  perguntas.forEach(passo => {
    (passo.opcoes || []).forEach(opcao => {
      if (passo.tipo === "numero" || opcao.valor === "" || opcao.pular) return;
      const patch = { [passo.campo]: passo.tipo === "multipla" ? [opcao.valor] : opcao.valor };
      const normalizado = app.F.normalizeProfile(patch);
      assert.deepEqual(
        plain(normalizado[passo.campo]),
        plain(passo.tipo === "multipla" ? [opcao.valor] : opcao.valor),
        "Valor descartado pela normalização: " + passo.id + "=" + opcao.valor
      );
    });
  });

  /* A primeira tela já é a seleção de sexo, com grupo de rádios rotulado. */
  const grupo = app.$('#onboarding-step [role="radiogroup"]');
  assert.ok(grupo, "A seleção de sexo deve usar grupo de rádios");
  assert.equal(grupo.getAttribute("aria-labelledby"), "onboarding-question");
  const radios = app.$$('#onboarding-step input[type="radio"]');
  assert.equal(radios.length, 3, "Duas fotos + 'Prefiro não informar'");
  radios.forEach(radio => {
    const label = radio.closest("label");
    assert.ok(label, "Cada rádio deve estar dentro do seu rótulo");
    assert.ok(label.textContent.trim().length > 0, "Rótulo vazio");
  });

  const barra = app.$("#onboarding-progressbar");
  assert.equal(barra.getAttribute("aria-valuemax"), "23");
  assert.equal(barra.getAttribute("aria-valuenow"), "0");
  assert.match(barra.getAttribute("aria-valuetext"), /Passo 1 de 24: Vamos personalizar seu treino\./);
  assert.equal(app.$("#onboarding-question").tagName.toLowerCase(), "h1");
  assertNoErrors(app, "estrutura do onboarding");
});

/* ------------------------------------------------------------------ */
/* 13. Retomada do fluxo interrompido                                  */
/* ------------------------------------------------------------------ */

await runTest("13. Fluxo interrompido retoma no mesmo passo sem gravar perfil", async () => {
  const app = await boot({}, "index.html");
  await irParaOnboarding(app);

  const inicio = Object.assign({}, RESPOSTAS_PADRAO, { sexo: "feminino" });
  await responderPasso(app, "sexo", inicio);
  await avancar(app);
  await responderPasso(app, "area-foco", Object.assign({}, inicio, { areaFoco: "bracos" }));
  await avancar(app);
  await responderPasso(app, "objetivo", Object.assign({}, inicio, { objetivo: "resistencia" }));
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "O que mais motiva você?");

  /* Sai pela barra inferior (sem concluir) e volta. */
  await app.go(BASE + "treino/index.html");
  assert.equal(app.raw(PROFILE_KEY), null, "Sair no meio não grava perfil");

  await app.go(BASE + "onboarding/index.html");
  await wait(30);
  assert.equal(app.text("#onboarding-question"), "O que mais motiva você?",
    "O fluxo deve retomar no passo onde parou");
  assert.equal(app.raw(PROFILE_KEY), null, "Retomar não grava perfil");

  /* As respostas anteriores continuam guardadas (basta voltar). */
  await voltar(app);
  assert.equal(app.text("#onboarding-question"), "Qual é o seu principal objetivo?");
  assert.equal(app.$('input[name="onboarding-objetivo"][value="resistencia"]').checked, true);
  await voltar(app);
  assert.equal(app.$('input[name="onboarding-areaFoco"][value="bracos"]').checked, true);
  await voltar(app);
  assert.equal(app.$('input[name="onboarding-sexo"][value="feminino"]').checked, true);
  await avancar(app);
  await avancar(app);
  await avancar(app);

  /* Conclui o restante e o rascunho é descartado. */
  await responderAPartirDe(app, "motivacao", {
    sexo: "feminino", nivel: "intermediario", dias: 2,
    equipamentos: ["nenhum"], preferenciasTreino: ["calistenia"]
  });
  await concluirDaRevisao(app);
  await until(() => app.d.body.dataset.page === "inicio", "conclusão após retomada");

  assert.equal(app.data(PROFILE_KEY).sexo, "feminino");
  assert.equal(app.data(PROFILE_KEY).objetivo, "resistencia", "A resposta retomada é a gravada");
  assert.equal(app.data(PROFILE_KEY).duracaoMinutos, 0);
  assert.equal(app.w.sessionStorage.getItem("forja-onboarding-rascunho-v1"), null,
    "O rascunho deve ser apagado ao concluir");
});

/* ------------------------------------------------------------------ */
/* 14. Falha de armazenamento                                          */
/* ------------------------------------------------------------------ */

await runTest("14. Falha ao gravar mantém as respostas e avisa, sem perder o rascunho", async () => {
  const app = await boot({}, "onboarding/index.html");
  await responderTudo(app);
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Seu perfil está pronto para o próximo passo.");
  assert.equal(app.raw(PROFILE_KEY), null, "Nada é gravado antes de 'Entrar no FORJA'");

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
  await avancar(app);

  const optin = app.$("#onboarding-goals");
  assert.ok(optin, "A preparação deve oferecer a meta sugerida");
  assert.equal(optin.checked, true);
  assert.match(app.text(".onboarding-optin"), /4 treinos/);
  assert.doesNotMatch(app.text(".onboarding-optin"), /minutos/,
    "Sem duração respondida neste fluxo, nenhum minuto é inventado");
  app.click("#onboarding-next");
  await until(() => app.d.body.dataset.page === "inicio", "conclusão com meta");
  assert.equal(app.data(GOALS_KEY).weeklySessions, 4);
  assert.equal(app.data(GOALS_KEY).weeklyMinutes, 0);
  app.close();

  const semMeta = await boot({}, "onboarding/index.html");
  await responderTudo(semMeta);
  await avancar(semMeta);
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
  await avancar(comMetas);
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
/* 18. Unidades e validação numérica                                   */
/* ------------------------------------------------------------------ */

await runTest("18. Altura, peso e ano: conversão cm↔pés/pol e kg↔lb, faixas que bloqueiam e ano sem futuro", async () => {
  const app = await boot({}, "onboarding/index.html");
  assertNoErrors(app, "onboarding");

  /* As conversões puras, com armazenamento canônico em cm e kg. */
  const conv = app.F.onboarding.conversoes;
  assert.deepEqual(plain(conv.cmParaPesPolegadas(180)), { pes: 5, polegadas: 11 });
  assert.equal(conv.pesPolegadasParaCm(5, 11), 180, "5 pés e 11 pol viram 180 cm");
  assert.equal(conv.kgParaLb(82.5), 181.9);
  assert.equal(conv.lbParaKg(180), 81.6);
  assert.equal(conv.lbParaKg(conv.kgParaLb(70)), 70, "Ida e volta em kg não pode perder o valor");

  for (const id of ["sexo", "area-foco", "objetivo", "motivacao"]) {
    await responderPasso(app, id, RESPOSTAS_PADRAO);
    await avancar(app);
  }

  /* Altura: vazia e fora da faixa não avançam; a tela explica o porquê. */
  assert.equal(app.text("#onboarding-question"), "Qual é a sua altura?");
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Qual é a sua altura?", "Sem altura não avança");
  assert.match(app.text("#onboarding-error"), /Informe sua altura para continuar/);

  digitarNumero(app, "#onboarding-alturaCm", 79);
  assert.match(app.text("#onboarding-number-hint"), /Fora da faixa esperada/);
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Qual é a sua altura?");
  assert.match(app.text("#onboarding-error"), /Use uma altura entre 80 e 250 cm/);

  digitarNumero(app, "#onboarding-alturaCm", 251);
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Qual é a sua altura?", "Acima do teto também não avança");

  /* cm → pés/pol mostra o equivalente; editar em pés/pol volta para cm. */
  digitarNumero(app, "#onboarding-alturaCm", 178);
  assert.match(app.text("#onboarding-number-hint"), /= 5 pés e 10 pol/);
  escolher(app, "unidade-altura", "ftin");
  assert.equal(app.$("#onboarding-alturaCm-pes").value, "5");
  assert.equal(app.$("#onboarding-alturaCm-pol").value, "10");
  assert.match(app.text("#onboarding-number-hint"), /= 178 cm/);
  digitarNumero(app, "#onboarding-alturaCm-pol", 11);
  assert.match(app.text("#onboarding-number-hint"), /= 180 cm/, "5'11\" é guardado como 180 cm");
  escolher(app, "unidade-altura", "cm");
  assert.equal(app.$("#onboarding-alturaCm").value, "180");
  await avancar(app);

  /* Peso: as mesmas travas, com vírgula decimal e conversão nos dois sentidos. */
  assert.equal(app.text("#onboarding-question"), "Qual é o seu peso atual?");
  await avancar(app);
  assert.match(app.text("#onboarding-error"), /Informe seu peso atual para continuar/);
  digitarNumero(app, "#onboarding-pesoKg", 24);
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Qual é o seu peso atual?");
  assert.match(app.text("#onboarding-error"), /Use um peso entre 25 e 350 kg/);

  digitarNumero(app, "#onboarding-pesoKg", "82,5");
  assert.match(app.text("#onboarding-number-hint"), /= 181,9 lb/);
  escolher(app, "unidade-peso", "lb");
  assert.equal(app.$("#onboarding-pesoKg").value, "181,9", "O campo passa a mostrar libras");
  digitarNumero(app, "#onboarding-pesoKg", 180);
  assert.match(app.text("#onboarding-number-hint"), /= 81,6 kg/, "180 lb é guardado como 81,6 kg");
  escolher(app, "unidade-peso", "kg");
  assert.equal(app.$("#onboarding-pesoKg").value, "81,6");
  await avancar(app);

  /* Peso-alvo: fora da faixa bloqueia, mas "Ainda não defini" libera. */
  assert.equal(app.text("#onboarding-question"), "Qual peso você deseja alcançar?");
  digitarNumero(app, "#onboarding-pesoAlvoKg", 400);
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Qual peso você deseja alcançar?");
  assert.match(app.text("#onboarding-error"), /ou escolha "Ainda não defini"/);
  await responderPasso(app, "peso-alvo", RESPOSTAS_PADRAO);
  assert.equal(app.$("#onboarding-pesoAlvoKg").disabled, true,
    "Com a meta indefinida o número fica desabilitado");
  await avancar(app);

  /* Ano de nascimento: futuro e fora da faixa não passam. */
  await responderPasso(app, "tipo-corpo", RESPOSTAS_PADRAO);
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Em que ano você nasceu?");
  await avancar(app);
  assert.match(app.text("#onboarding-error"), /Informe o ano em que você nasceu/);
  digitarNumero(app, "#onboarding-anoNascimento", new Date().getFullYear() + 1);
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Em que ano você nasceu?");
  assert.match(app.text("#onboarding-error"), /não pode estar no futuro/);
  digitarNumero(app, "#onboarding-anoNascimento", 1899);
  await avancar(app);
  assert.match(app.text("#onboarding-error"), /Use um ano entre 1900 e/);
  digitarNumero(app, "#onboarding-anoNascimento", 1996);
  await avancar(app);
  assert.equal(app.text("#onboarding-question"), "Como é sua rotina diária?");
  assert.equal(app.raw(PROFILE_KEY), null, "No meio do fluxo nada foi gravado");
});

/* ------------------------------------------------------------------ */
/* 19. Etapas opcionais puladas                                         */
/* ------------------------------------------------------------------ */

await runTest("19. Todas as opcionais puladas: fora da revisão, contadas na nota e gravadas como ausência", async () => {
  const app = await boot({}, "onboarding/index.html");
  assertNoErrors(app, "onboarding");

  await responderTudo(app, {
    pesoAlvoKg: "pular",
    equipamentos: "pular",
    flexoes: "pular",
    mobilidade: "pular",
    recuperacaoEsforco: "pular"
  });
  assert.equal(app.text("#onboarding-question"), "Confira suas respostas");

  /* A revisão só lista o que foi respondido: as puladas não aparecem. */
  const termos = app.$$(".onboarding-review-term").map(item => item.textContent.trim());
  for (const ausente of ["Peso-alvo", "Equipamentos", "Flexões seguidas", "Mobilidade", "Após o esforço"]) {
    assert.equal(termos.includes(ausente), false, "Etapa pulada não pode aparecer na revisão: " + ausente);
  }
  assert.equal(termos.includes("Altura"), true);
  assert.equal(termos.includes("Peso atual"), true);
  assert.equal(app.$$(".onboarding-review-row").length, termos.length);
  assert.match(app.text("#onboarding-step"), /5 perguntas opcionais foram puladas/);

  await concluirDaRevisao(app);
  await until(() => app.d.body.dataset.page === "inicio", "conclusão com opcionais puladas");

  const perfil = app.data(PROFILE_KEY);
  assert.equal(perfil.pesoAlvoKg, 0, "Peso-alvo pulado fica sem meta, não um número chutado");
  assert.deepEqual(perfil.equipamentos, [], "Equipamentos pulados ficam indefinidos");
  assert.equal(perfil.flexoes, "");
  assert.equal(perfil.mobilidade, "");
  assert.equal(perfil.recuperacaoEsforco, "");
  assert.equal(perfil.equipamento, "", "Sem tocar em equipamentos, nenhum resumo é inventado");
  assert.equal(perfil.modalidadePreferida, "weights", "A preferência respondida continua valendo");
  assert.equal(perfil.version, 3);
});

/* ------------------------------------------------------------------ */
/* 20. Derivações e preservação do perfil antigo                        */
/* ------------------------------------------------------------------ */

await runTest("20. Derivações clássicas e refazer: derivados só do que foi tocado, duração e puladas preservam o salvo", async () => {
  const api = await boot({}, "onboarding/index.html");
  const { derivarModalidade, derivarEquipamento } = api.F.onboarding;

  /* Modalidade: só musculação → pesos, só calistenia → calistenia, resto → nenhuma. */
  assert.equal(derivarModalidade(["musculacao"]), "weights");
  assert.equal(derivarModalidade(["musculacao", "cardio"]), "weights");
  assert.equal(derivarModalidade(["calistenia"]), "calisthenics");
  assert.equal(derivarModalidade(["musculacao", "calistenia"]), "");
  assert.equal(derivarModalidade(["combinacao"]), "");
  assert.equal(derivarModalidade(["descobrir"]), "");
  assert.equal(derivarModalidade([]), "");
  assert.equal(derivarModalidade(null), "");

  /* Equipamento: nenhum vence; academia + casa = ambos. */
  assert.equal(derivarEquipamento(["nenhum"]), "nenhum");
  assert.equal(derivarEquipamento(["nenhum", "halteres"]), "nenhum");
  assert.equal(derivarEquipamento(["academiaCompleta"]), "academia");
  assert.equal(derivarEquipamento(["maquinas"]), "academia");
  assert.equal(derivarEquipamento(["halteres", "elasticos"]), "casa");
  assert.equal(derivarEquipamento(["outros"]), "casa");
  assert.equal(derivarEquipamento(["halteres", "maquinas"]), "ambos");
  assert.equal(derivarEquipamento([]), "");
  api.close();

  /* Refazer pulando opcionais: o que já estava salvo sobrevive, a duração
     (sem pergunta neste fluxo) continua e só o derivado tocado muda. */
  const seed = {
    [PROFILE_KEY]: perfilV1({
      sexo: "feminino",
      modalidadePreferida: "weights",
      equipamento: "academia",
      duracaoMinutos: 45,
      pesoAlvoKg: 70,
      flexoes: "11a20",
      mobilidade: "pes",
      recuperacaoEsforco: "rapida",
      equipamentos: ["academiaCompleta"]
    })
  };
  const app = await boot(seed, "onboarding/index.html?refazer=1");
  assert.equal(app.text("#onboarding-question"), "Vamos personalizar seu treino.");

  await responderTudo(app, {
    sexo: "feminino",
    pesoAlvoKg: "pular",
    equipamentos: "pular",
    flexoes: "pular",
    mobilidade: "pular",
    recuperacaoEsforco: "pular",
    preferenciasTreino: ["musculacao", "calistenia"]
  });
  await concluirDaRevisao(app);
  await until(() => app.d.body.dataset.page === "inicio", "conclusão do refazer");

  const perfil = app.data(PROFILE_KEY);
  assert.equal(perfil.version, 3);
  assert.equal(perfil.duracaoMinutos, 45, "O onboarding nunca apaga a duração antiga");
  assert.equal(perfil.pesoAlvoKg, 70, "Pular o peso-alvo preserva a meta já salva");
  assert.equal(perfil.flexoes, "11a20", "Pular preserva a resposta anterior");
  assert.equal(perfil.mobilidade, "pes");
  assert.equal(perfil.recuperacaoEsforco, "rapida");
  assert.deepEqual(perfil.equipamentos, ["academiaCompleta"],
    "\"Continuar sem equipamentos definidos\" não apaga a lista salva");
  assert.equal(perfil.equipamento, "academia", "Derivado não tocado fica como estava");
  assert.deepEqual(perfil.preferenciasTreino, ["musculacao", "calistenia"]);
  assert.equal(perfil.modalidadePreferida, "",
    "Musculação + calistenia rederivam para 'sem preferência' porque a pergunta foi tocada");
  assert.equal(perfil.objetivo, "hipertrofia", "As respostas novas entram normalmente");
  assert.equal(perfil.diasPorSemana, 4);
  app.close();

  /* Refazer sem tocar em nada: as respostas salvas valem como estão e
     nenhum campo clássico é rederivado por cima delas. */
  const intacto = await boot({
    [PROFILE_KEY]: perfilV1({
      sexo: "masculino",
      modalidadePreferida: "calisthenics",
      duracaoMinutos: 45,
      areaFoco: "corpoTodo",
      motivacoes: ["saude"],
      alturaCm: 170,
      pesoKg: 70,
      tipoCorpo: "intermediario",
      anoNascimento: 1990,
      rotinaDiaria: "sentado",
      localTreino: "academia",
      experienciaAtual: "basicos",
      consideracoes: ["nenhuma"],
      celebracao: "evolucao",
      acompanhamento: "forca"
    })
  }, "onboarding/index.html?refazer=1");

  await avancarAte(intacto, "Confira suas respostas");
  await concluirDaRevisao(intacto);
  await until(() => intacto.d.body.dataset.page === "inicio", "conclusão sem tocar em nada");

  const mantido = intacto.data(PROFILE_KEY);
  assert.equal(mantido.modalidadePreferida, "calisthenics", "Sem tocar, a preferência antiga fica");
  assert.equal(mantido.equipamento, "academia");
  assert.equal(mantido.duracaoMinutos, 45);
  assert.equal(mantido.version, 3);
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
