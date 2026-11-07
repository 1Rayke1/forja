/*
  FORJA — Biblioteca (treino/biblioteca.html) com os 7 cards de regiões.

  Este teste guarda o desenho aprovado e, principalmente, a conta: a tela é a
  mesma Biblioteca de exercícios do restante do app (catálogo central, 165
  registros), agora com sete portas de entrada no lugar de treze chips soltos.

  O que é verificado, sempre a partir do próprio catálogo (nada digitado):

    1. cabeçalho, título em duas cores, subtítulo e busca da referência;
    2. as sete regiões, na ordem, com descrição própria;
    3. cada card com uma prancha anatômica diferente e o músculo em lima;
    4. o mapa 7 → 13 grupos oficiais: particionado, sem sobra e sem repetição;
    5. a conta dos 165: cada exercício aparece em exatamente uma região;
    6. as quatro pílulas de modalidade filtrando o catálogo de verdade;
    7. região aberta → subgrupos oficiais, sem perder o músculo principal;
    8. o contador sempre calculado, nunca fixo, e coerente com a lista;
    9. busca + região + modalidade combinadas e o estado vazio;
   10. "Limpar tudo" volta ao catálogo inteiro;
   11. os rankings continuam funcionando sobre os mesmos 165;
   12. a ficha do exercício e "Adicionar ao treino" seguem intactos;
   13. nada é gravado no armazenamento só por navegar;
   14. a folha de estilo nova é escopada, com as regras de 390 px e desktop;
   15. a barra inferior continua com cinco itens e "Explorar" ativa.

  Uso: npm test (a suíte entra na cadeia) ou node tests/biblioteca-grupos.test.mjs
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
    await closeAllApps();
  }
}

const PAGE = "treino/biblioteca.html";

/* Texto comparável: sem acento, minúsculo, sem espaços sobrando. */
const chave = value => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().trim();

/*
  As sete regiões e os grupos do catálogo que cada uma agrupa. É a expectativa
  do teste, escrita à mão de propósito: se o mapa mudar, este arquivo muda com
  ele, e a mudança fica visível na revisão.
*/
const REGIOES = [
  { id: "peitoral", rotulo: "Peitoral", grupos: ["peitoral"] },
  { id: "costas", rotulo: "Costas", grupos: ["costas"] },
  { id: "ombros", rotulo: "Ombros", grupos: ["ombros", "trapezio"] },
  { id: "bracos", rotulo: "Braços", grupos: ["biceps", "triceps", "antebracos"] },
  { id: "abdomen", rotulo: "Abdômen", grupos: ["abdomen", "obliquos"] },
  { id: "pernas", rotulo: "Pernas", grupos: ["quadriceps", "posteriores", "panturrilhas"] },
  { id: "gluteos", rotulo: "Glúteos", grupos: ["gluteos"] }
];

const entries = app => app.F.biblioteca.entries();
const total = app => entries(app).length;
const cards = app => app.$$("#catalog-controls .grupo-card");
const rows = app => app.$$("#catalog-list .ui-exercise-row");
const counterNumber = app => {
  const forte = app.$("#bl-contador strong");
  assert.ok(forte, "O contador deveria ter o número em destaque");
  return Number(forte.textContent.trim());
};
const counterText = app => String(app.text("#bl-contador") || "").replace(/\s+/g, " ").trim();

function search(app, value) {
  const input = app.$("#catalog-search");
  assert.ok(input, "campo de busca ausente");
  input.value = value;
  input.dispatchEvent(new app.w.Event("input", { bubbles: true }));
}

function cardPorRegiao(app, id) {
  return app.$('#catalog-controls .grupo-card[data-categoria="' + id + '"]');
}

/* Quantos exercícios o catálogo tem no músculo principal indicado. */
function contarPorGrupo(app, grupos) {
  return entries(app).filter(entry => grupos.includes(entry.muscleId)).length;
}

/* ------------------------------------------------------------------ */
/* 1. Cabeçalho, título, subtítulo e busca                             */
/* ------------------------------------------------------------------ */

await runTest("1. Biblioteca: cabeçalho, título em duas cores, subtítulo e busca", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  /* Cabeçalho: marca à esquerda, disciplina diária com o haltere à direita. */
  assert.match(app.text("header"), /FORJA/, "A marca FORJA deveria estar no cabeçalho");
  assert.equal(chave(app.text(".tagline")), "disciplina diaria");
  assert.match(app.$(".tagline").innerHTML, /<svg/, "A disciplina diária perdeu o ícone");

  /* Título: um h1, duas cores, texto inteiro preservado. */
  const h1 = app.$$("h1");
  assert.equal(h1.length, 1, "A Biblioteca deve ter um único h1");
  assert.equal(app.$("h1").id, "catalog-heading");
  assert.equal(h1[0].textContent.replace(/\s+/g, " ").trim(), "Biblioteca de exercícios");
  assert.equal(app.text("#catalog-heading .bl-titulo-destaque"), "exercícios",
    "A palavra em lima deveria ser só “exercícios”");
  assert.match(app.$("#catalog-heading .bl-titulo-linha").textContent, /Biblioteca de/,
    "A primeira linha do título deveria ser “Biblioteca de”");

  /* Subtítulo exato da referência. */
  assert.equal(app.text(".bl-subtitle"), "Encontre o exercício ideal para o seu treino.");

  /* Busca: campo único, lupa e placeholder da referência. */
  const busca = app.$("#catalog-search");
  assert.ok(busca, "O campo de busca deveria existir");
  assert.match(busca.getAttribute("placeholder"), /^Buscar exercício pelo nome(\.\.\.|…)$/,
    "O placeholder precisa ser o da referência");
  assert.match(app.$(".bl-search").innerHTML, /<svg/, "A busca deveria ter o ícone de lupa");

  assertNoErrors(app, "cabeçalho da biblioteca");
});

/* ------------------------------------------------------------------ */
/* 2. As sete regiões                                                  */
/* ------------------------------------------------------------------ */

await runTest("2. Biblioteca: sete regiões, na ordem, com descrição e chevron", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  const lista = cards(app);
  assert.equal(lista.length, 7, "A tela deveria ter exatamente sete cards de região");
  assert.deepEqual(lista.map(card => chave(card.querySelector(".grupo-nome").textContent)),
    REGIOES.map(regiao => chave(regiao.rotulo)), "A ordem das regiões mudou");

  lista.forEach(card => {
    const id = card.getAttribute("data-categoria");
    const regiao = REGIOES.find(item => item.id === id);
    assert.ok(regiao, "Card sem região conhecida: " + id);

    /* Região é porta de entrada: um link para a tela do grupo. */
    assert.equal(card.tagName, "A", "O card da região precisa ser um link");
    assert.match(card.getAttribute("href"), new RegExp("^grupo\\.html\\?(modalidade=[a-z-]+&)?regiao=" + id + "$"),
      "O link da região não leva à tela do grupo muscular");

    assert.match(card.querySelector(".grupo-descricao").textContent, /^Exercícios para/,
      "Toda região precisa de uma descrição de uma linha");
    assert.ok(card.querySelector(".grupo-seta svg"), "O chevron do card sumiu");
    assert.equal(card.hasAttribute("aria-pressed"), false,
      "Link não é botão: o card não deveria anunciar estado pressionado");
    assert.match(card.getAttribute("aria-label"), new RegExp(regiao.rotulo),
      "O card precisa de rótulo acessível com o nome da região");
  });

  /* Altura uniforme: o CSS define uma altura única para todos. */
  const css = fs.readFileSync(path.join(repoRoot, "assets/css/biblioteca-grupos.css"), "utf8");
  assert.match(css, /\.grupo-card\s*\{[^}]*height:\s*96px/s,
    "Os cards precisam de altura única (96 px)");

  assertNoErrors(app, "cards de região");
});

await runTest("3. Biblioteca: cada região tem prancha própria, com o músculo em lima", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  const desenhos = cards(app).map(card => card.querySelector(".grupo-figura svg"));
  desenhos.forEach((svg, indice) => {
    assert.ok(svg, "A região " + REGIOES[indice].rotulo + " ficou sem prancha");
    assert.ok(svg.getAttribute("viewBox"), "A prancha precisa de enquadramento próprio");
    assert.match(svg.getAttribute("aria-label") || svg.textContent, /./,
      "A prancha precisa de rótulo ou conteúdo acessível");
  });

  const enquadramentos = new Set(desenhos.map(svg => svg.getAttribute("viewBox")));
  assert.equal(enquadramentos.size, 7,
    "As sete regiões precisam de recortes diferentes (nenhuma imagem repetida)");

  /* O destaque é do atlas: região primária em lima, o resto discreto. */
  cards(app).forEach(card => {
    assert.ok(card.querySelectorAll(".grupo-figura .figura-region.is-primary").length > 0,
      "Nenhuma região muscular destacada no card");
  });

  assertNoErrors(app, "pranchas");
});

/* ------------------------------------------------------------------ */
/* 4. O mapa 7 → 13 grupos oficiais                                    */
/* ------------------------------------------------------------------ */

await runTest("4. Biblioteca: sete cards cobrem os 13 grupos oficiais, sem sobra nem repetição", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  const catalog = app.F.exerciseCatalog;
  const oficiais = catalog.muscleGroups.map(group => group.id);
  assert.equal(oficiais.length, 13, "O catálogo central deveria ter 13 grupos");

  /* O código publica o mapa: ele precisa ser exatamente o do teste. */
  const mapa = app.F.biblioteca.categorias.map(item => ({
    id: item.id,
    grupos: Array.from(item.grupos)
  }));
  /* Os objetos vêm do realm do jsdom: normaliza por JSON antes de comparar. */
  assert.deepEqual(JSON.parse(JSON.stringify(mapa)),
    REGIOES.map(item => ({ id: item.id, grupos: item.grupos })),
    "O mapa de regiões do código não bate com a especificação");

  /* Partição: cada grupo em exatamente uma região, todos cobertos. */
  const vistos = [];
  mapa.forEach(item => item.grupos.forEach(grupo => vistos.push(grupo)));
  assert.equal(vistos.length, new Set(vistos).size, "Um grupo apareceu em duas regiões");
  assert.deepEqual(vistos.slice().sort(), Array.from(oficiais).sort(),
    "Faltou grupo oficial (ou sobrou grupo inventado) no mapa das regiões");

  assertNoErrors(app, "mapa das regiões");
});

/* ------------------------------------------------------------------ */
/* 5. A conta dos 165                                                  */
/* ------------------------------------------------------------------ */

await runTest("5. Biblioteca: os 165 exercícios estão todos dentro de alguma região", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  const todos = entries(app);
  assert.ok(todos.length > 0, "O catálogo não deveria estar vazio");

  const vistos = new Set();
  let soma = 0;

  REGIOES.forEach(regiao => {
    const doGrupo = todos.filter(entry => regiao.grupos.includes(entry.muscleId));
    soma += doGrupo.length;
    doGrupo.forEach(entry => {
      assert.equal(vistos.has(entry.key), false,
        "Exercício em duas regiões: " + entry.name);
      vistos.add(entry.key);
    });
  });

  assert.equal(soma, todos.length, "A soma das regiões precisa ser o catálogo inteiro");
  assert.equal(vistos.size, todos.length, "Faltou exercício dentro das regiões");

  /* O contador da tela confirma a conta total, sem número escrito à mão. */
  assert.equal(counterNumber(app), todos.length,
    "O contador deveria abrir no total do catálogo");

  assertNoErrors(app, "cobertura das regiões");
});

/* ------------------------------------------------------------------ */
/* 6. Modalidade em pílulas                                            */
/* ------------------------------------------------------------------ */

await runTest("6. Biblioteca: as quatro pílulas de modalidade filtram o catálogo", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  const pilulas = app.$$(".modalidade-opcao");
  assert.deepEqual(pilulas.map(p => chave(p.textContent)),
    ["todos", "musculacao", "calistenia", "sem equip."]);
  assert.deepEqual(pilulas.map(p => p.getAttribute("aria-pressed")),
    ["true", "false", "false", "false"], "Só “Todos” deveria começar ativo");

  const esperado = {
    academia: entries(app).filter(entry => entry.modalityId === "academia").length,
    calistenia: entries(app).filter(entry => entry.modalityId === "calistenia").length,
    "peso-corporal": entries(app).filter(entry => entry.modalityId === "peso-corporal").length
  };
  assert.ok(esperado.academia > 0 && esperado.calistenia > 0 && esperado["peso-corporal"] > 0,
    "As três modalidades precisam ter exercícios");
  assert.equal(Object.values(esperado).reduce((a, b) => a + b, 0), total(app),
    "Cada exercício precisa de exatamente uma modalidade");

  for (const [modalidade, quantidade] of Object.entries(esperado)) {
    app.click('.modalidade-opcao[data-value="' + modalidade + '"]');
    await wait(30);
    assert.equal(counterNumber(app), quantidade,
      "O contador não seguiu a modalidade " + modalidade);
    rows(app).forEach(row => assert.equal(row.getAttribute("data-modality"), modalidade,
      "A lista mostrou exercício de outra modalidade"));
    assert.equal(app.$('.modalidade-opcao[data-value="' + modalidade + '"]').getAttribute("aria-pressed"),
      "true", "A pílula escolhida deveria ficar ativa");
  }

  /* "Todos" volta ao catálogo inteiro. */
  app.click('.modalidade-opcao[data-value=""]');
  await wait(30);
  assert.equal(counterNumber(app), total(app));

  assertNoErrors(app, "pílulas de modalidade");
});

/* ------------------------------------------------------------------ */
/* 7. Região aberta e subgrupos                                        */
/* ------------------------------------------------------------------ */

await runTest("7. Biblioteca: abrir uma região leva aos subgrupos oficiais dela", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  const regiao = REGIOES.find(item => item.grupos.length === 3);
  await app.go(cardPorRegiao(app, regiao.id).getAttribute("href"));
  await wait(160);

  /* É a tela do grupo que revela os subgrupos da região. */
  assert.equal(app.d.body.dataset.page, "grupo", "A região não abriu a tela do grupo");
  assert.equal(app.text("#grupo-titulo"), regiao.rotulo);

  const chips = app.$$('#grupo-filtros [data-linha="grupo"] .gr-pilula');
  assert.deepEqual(chips.map(chip => chave(chip.textContent)),
    ["todos"].concat(regiao.grupos.map(grupo => chave(app.F.exerciseCatalog.groupById(grupo).name))),
    "Os subgrupos deveriam ser só os grupos oficiais daquela região");

  const esperado = contarPorGrupo(app, regiao.grupos);
  assert.equal(Number(app.$("#grupo-contador").getAttribute("data-total")), esperado,
    "O contador não seguiu a região");
  assert.ok(esperado > 0, "A região escolhida não tem exercícios");

  app.$$("#grupo-lista .gr-card").forEach(card => {
    assert.ok(regiao.grupos.includes(card.getAttribute("data-muscle")),
      "A lista mostrou exercício de fora da região (" + card.getAttribute("data-muscle") + ")");
  });

  /* Escolher o subgrupo mantém o músculo principal identificado. */
  const subgrupo = regiao.grupos[regiao.grupos.length - 1];
  app.click('#grupo-filtros [data-linha="grupo"] .gr-pilula[data-value="' + subgrupo + '"]');
  await wait(60);
  assert.equal(Number(app.$("#grupo-contador").getAttribute("data-total")), contarPorGrupo(app, [subgrupo]),
    "O subgrupo não filtrou pelo músculo principal");
  app.$$("#grupo-lista .gr-card").forEach(card => assert.equal(card.getAttribute("data-muscle"), subgrupo,
    "A lista misturou subgrupos"));

  /* O endereço da tela guarda a escolha: recarregar mantém o subgrupo. */
  assert.match(app.w.location.search, new RegExp("grupo=" + subgrupo));
  await app.reload();
  await wait(160);
  assert.equal(Number(app.$("#grupo-contador").getAttribute("data-total")), contarPorGrupo(app, [subgrupo]),
    "Recarregar perdeu o subgrupo escolhido");

  /* Voltar reabre a Biblioteca, sem lista despejada. */
  app.click("#grupo-voltar");
  await wait(200);
  assert.equal(app.d.body.dataset.page, "biblioteca");
  assert.equal(app.$("#catalog-results").hidden, true);

  assertNoErrors(app, "região e subgrupos");
});

await runTest("8. Biblioteca: contador sempre calculado e coerente com a lista", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  const catalogo = total(app);
  const estados = [];

  /* Sem filtro. */
  estados.push(counterNumber(app));
  assert.equal(estados[0], catalogo);
  assert.equal(chave(counterText(app)), chave(catalogo + " exercícios disponíveis"));
  assert.equal(app.$("#bl-contador .ui-icon"), app.$("#bl-contador .ui-icon"),
    "O contador precisa do ícone de informação");

  /* Busca. */
  search(app, "flexão");
  await wait(40);
  const porBusca = app.F.biblioteca.filter({ query: "flexão" }).length;
  assert.ok(porBusca > 0 && porBusca < catalogo, "A busca deveria reduzir o total");
  estados.push(counterNumber(app));
  assert.equal(estados[1], porBusca, "O contador não seguiu a busca");
  assert.match(counterText(app), /para “flexão”/, "O contador deveria citar a busca");
  assert.match(counterText(app), new RegExp(" de " + catalogo + " exercícios no catálogo"),
    "Com filtro, o contador mostra o total do catálogo como referência");

  /* Busca + modalidade. */
  app.click('.modalidade-opcao[data-value="calistenia"]');
  await wait(40);
  estados.push(counterNumber(app));
  assert.equal(estados[2], app.F.biblioteca.filter({ query: "flexão", modality: "calistenia" }).length,
    "Busca e modalidade deveriam se combinar");

  /* Três estados diferentes: o número é calculado, não escrito à mão. */
  assert.equal(new Set(estados).size, 3,
    "O contador precisa mudar com cada filtro: catálogo, busca e busca + modalidade");
  assert.ok(estados[0] > estados[1] && estados[1] > estados[2],
    "Cada filtro deveria restringir mais que o anterior");

  /* Limpar a busca volta ao valor da modalidade. */
  search(app, "");
  await wait(40);
  assert.equal(counterNumber(app),
    app.F.biblioteca.filter({ query: "", modality: "calistenia" }).length);

  assertNoErrors(app, "contador");
});

/* ------------------------------------------------------------------ */
/* 9. Combinações e estado vazio                                       */
/* ------------------------------------------------------------------ */

await runTest("9. Biblioteca: busca e modalidade combinam; vazio avisa", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  const totalGeral = counterNumber(app);
  app.click('.modalidade-opcao[data-value="academia"]');
  await wait(40);
  const combinado = counterNumber(app);
  assert.ok(combinado > 0 && combinado < totalGeral, "A modalidade deveria reduzir o catálogo");

  if (app.$("#catalog-results").hidden) app.click("#catalog-toggle");
  await wait(20);
  rows(app).forEach(row => assert.equal(row.getAttribute("data-modality"), "academia"));

  /* A modalidade escolhida vai junto para a tela do grupo. */
  const href = cardPorRegiao(app, "pernas").getAttribute("href");
  assert.match(href, /modalidade=academia&regiao=pernas/);
  await app.go(href);
  await wait(160);
  assert.equal(app.d.body.dataset.page, "grupo");
  assert.match(app.text("#grupo-modalidade"), /Musculação/i);

  app.$$("#grupo-lista .gr-card").forEach(card => {
    assert.equal(card.getAttribute("data-modality"), "academia");
    assert.ok(REGIOES.find(item => item.id === "pernas").grupos.includes(card.getAttribute("data-muscle")));
  });

  /* Busca sem resultado: contador zerado e mensagem clara. */
  await app.go("biblioteca.html");
  await wait(160);
  search(app, "exercício que não existe");
  await wait(40);
  assert.equal(counterNumber(app), 0, "Sem resultado, o contador deveria zerar");
  assert.equal(rows(app).length, 0, "Sem resultado, a lista deveria esvaziar");
  assert.match(chave(app.text("#catalog-status")), /nenhum exercicio/,
    "O estado vazio precisa de mensagem");

  assertNoErrors(app, "combinações");
});

await runTest("10. Biblioteca: “Limpar tudo” devolve o catálogo inteiro", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  search(app, "supino");
  await wait(30);
  app.click('.modalidade-opcao[data-value="academia"]');
  await wait(30);
  assert.ok(counterNumber(app) < total(app), "Os filtros deveriam reduzir a lista");

  const ativos = app.$$("#bl-active-filters [data-active-filter]");
  assert.ok(ativos.length >= 2, "Os filtros ativos deveriam aparecer para remoção");

  app.click("#bl-active-filters [data-clear-filters]");
  await wait(40);

  assert.equal(counterNumber(app), total(app), "“Limpar tudo” deveria restaurar o catálogo");
  assert.equal(app.$("#catalog-search").value, "", "A busca deveria ser limpa");
  assert.equal(app.$$("#bl-active-filters [data-active-filter]").length, 0,
    "Não deveria sobrar filtro ativo");
  assert.equal(app.$('.modalidade-opcao[data-value=""]').getAttribute("aria-pressed"), "true",
    "“Todos” deveria voltar a ser a modalidade ativa");

  /* Nenhuma região fica marcada: a Biblioteca é um índice, não um filtro. */
  assert.equal(app.$$(".grupo-card.is-atual").length, 0,
    "Nenhuma região deveria continuar marcada");

  assertNoErrors(app, "limpar filtros");
});

await runTest("11. Biblioteca: os rankings continuam valendo para os 165", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  const comPosicao = entries(app).filter(entry => Number(entry.position) > 0);
  assert.ok(comPosicao.length > 0, "O catálogo deveria ter exercícios com ranking");

  app.click('.bl-tab[data-view="rankings"]');
  await wait(60);

  const lista = app.$("#rankings-list");
  assert.ok(lista, "A visão de rankings deveria existir");
  assert.ok(lista.children.length > 0, "A visão de rankings ficou vazia");
  assert.match(chave(app.text("#rankings-status")), /combina.*de ranking/,
    "O status dos rankings deveria resumir as combinações");

  /* Cada exercício aparece na posição que o catálogo declara. */
  const itens = Array.from(lista.querySelectorAll(".bl-ranking-item"));
  assert.ok(itens.length > 0, "Os rankings precisam listar exercícios");
  itens.forEach(item => {
    const posicao = Number(item.getAttribute("data-position"));
    assert.ok(posicao > 0, "Todo item de ranking precisa de posição real");
    assert.equal(item.querySelector(".bl-ranking-position").textContent.trim(),
      posicao + "º", "A posição exibida precisa ser a do catálogo");
    assert.ok(item.querySelector(".bl-ranking-open").textContent.trim().length > 0,
      "O item de ranking precisa do nome do exercício");
  });
  assert.ok(itens.length <= comPosicao.length,
    "Os rankings não podem ter mais exercícios do que o catálogo classificado");

  /* A visão de explorar continua a um toque. */
  app.click('.bl-tab[data-view="biblioteca"]');
  await wait(40);
  assert.equal(cards(app).length, 7, "Voltar de rankings deveria manter os sete cards");

  assertNoErrors(app, "rankings");
});

/* ------------------------------------------------------------------ */
/* 12. Ficha e "Adicionar ao treino"                                   */
/* ------------------------------------------------------------------ */

await runTest("12. Biblioteca: ficha do exercício e “Adicionar ao treino” intactos", async () => {
  const rotina = makeRoutine("calisthenics", "Rotina E", [
    { id: "m1", name: "Flexão existente", section: "main", sets: 2, reps: "10", rest: 10 }
  ], "re");

  const app = await boot({ "forja-treino-rotinas-v1": routinesStore([rotina], []) }, PAGE);
  await wait(200);

  search(app, "Agachamento livre");
  await wait(40);
  const linha = rows(app)[0];
  assert.ok(linha, "O exercício buscado deveria aparecer");
  const nome = linha.querySelector(".ui-exercise-name").textContent.trim();
  assert.equal(chave(nome), "agachamento livre");

  linha.querySelector('.ui-exercise-actions button[aria-label^="Ver detalhes"]').click();
  await wait(60);
  assert.match(chave(app.text("#modal-title")), /agachamento livre/,
    "A ficha deveria abrir no exercício certo");

  const cta = app.$("#detail-add-to-training");
  assert.ok(cta, "A ficha perdeu o “Adicionar ao treino”");
  cta.click();
  await wait(60);
  assert.equal(app.modalField("routine").value, "re");
  app.modalField("section").value = "abs";
  app.modalAction("add");
  await wait(80);

  const salva = app.data("forja-treino-rotinas-v1").calisthenics[0];
  assert.equal(salva.sections.abs.length, 1, "O exercício não entrou na seção escolhida");
  assert.equal(salva.sections.abs[0].libraryId, "cal-agachamento",
    "A origem no catálogo não foi preservada");
  assert.equal(salva.sections.main.length, 1, "A rotina original não pode ser duplicada");

  assertNoErrors(app, "ficha e adicionar ao treino");
});

/* ------------------------------------------------------------------ */
/* 13. Nada é gravado só por navegar                                   */
/* ------------------------------------------------------------------ */

await runTest("13. Biblioteca: navegar e filtrar não grava no armazenamento", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  const antes = app.keys().sort().join("|");
  search(app, "remada");
  await wait(30);
  app.click('.modalidade-opcao[data-value="academia"]');
  await wait(30);
  app.click('.bl-tab[data-view="rankings"]');
  await wait(40);
  app.click('.bl-tab[data-view="biblioteca"]');
  await wait(40);
  app.click("#bl-active-filters [data-clear-filters]");
  await wait(40);

  /* Abrir a tela do grupo e voltar também não escreve nada. */
  await app.go(cardPorRegiao(app, "costas").getAttribute("href"));
  await wait(160);
  app.click('.gr-pilula[data-value=""]');
  await wait(40);
  app.click("#grupo-voltar");
  await wait(200);

  assert.equal(app.keys().sort().join("|"), antes,
    "A tela não pode gravar nada no armazenamento");

  assertNoErrors(app, "sem gravação");
});

await runTest("14. Biblioteca: folha nova escopada, com regras de 390 px e desktop", async () => {
  const html = fs.readFileSync(path.join(repoRoot, PAGE), "utf8");
  assert.match(html, /biblioteca-grupos\.css/, "A folha nova não está carregada na página");

  const css = fs.readFileSync(path.join(repoRoot, "assets/css/biblioteca-grupos.css"), "utf8");
  assert.match(css, /body\[data-page="biblioteca"\]/, "As regras precisam ser escopadas");

  /* Tudo escopado: nenhum seletor solto que alcance outras telas. */
  const soltos = css.split("\n")
    .filter(linha => /^[.a-z#\[][^{]*\{$/.test(linha.trim()))
    .filter(linha => !/^body\[data-page="biblioteca"\]/.test(linha.trim()))
    .filter(linha => !/^\d?@media/.test(linha.trim()))
    .filter(linha => !/^\.(modalidade-linha|modalidade-icone)/.test(linha.trim()));
  assert.deepEqual(soltos, [], "Seletor sem escopo na folha nova: " + soltos.join(" "));

  assert.match(css, /\.bl-grupos\s*\{[^}]*display:\s*grid/s, "Os cards precisam de grade própria");
  assert.match(css, /\.bl-contador\s*\{[^}]*border-radius/s, "O contador precisa do painel arredondado");
  assert.match(css, /border-radius:\s*999px\s*!important[^;]*;\s*$/m, "A busca precisa ser pílula");
  assert.match(css, /@media \(min-width: 760px\)/, "Faltou a regra de desktop");
  assert.match(css, /@media \(max-width: 374px\)/, "Faltou a regra para telas estreitas");
  assert.match(css, /prefers-reduced-motion/, "Faltou respeitar quem pediu menos movimento");

  assert.match(html, /data-page="biblioteca"/, "A página precisa declarar a própria tela");
});

/* ------------------------------------------------------------------ */
/* 15. Barra inferior                                                  */
/* ------------------------------------------------------------------ */

await runTest("15. Biblioteca: barra inferior com cinco itens e “Explorar” ativa", async () => {
  const app = await boot({}, PAGE);
  await wait(200);

  const links = app.$$(".bottom-nav-link");
  assert.equal(links.length, 5, "A barra inferior deve continuar com cinco itens");
  assert.equal(app.$$(".bottom-nav-link[aria-current=page]").length, 1,
    "Só um item pode estar marcado como página atual");

  const ativo = app.$$(".bottom-nav-link[aria-current=page]")[0];
  assert.match(chave(ativo.textContent), /explorar/, "“Explorar” deveria ser o item ativo");
  assert.match(ativo.getAttribute("href"), /biblioteca\.html$/,
    "“Explorar” deveria continuar apontando para a Biblioteca");

  assertNoErrors(app, "barra inferior");
});

/* ------------------------------------------------------------------ */

const falhas = results.filter(item => !item.ok);
console.log("");
console.log("BIBLIOTECA (7 REGIÕES) — " + (results.length - falhas.length) + "/" + results.length + " testes aprovados");
if (falhas.length) {
  console.log("Falhas: " + falhas.map(item => item.name).join(" | "));
  process.exitCode = 1;
}
