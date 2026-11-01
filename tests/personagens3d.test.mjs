/*
  Suíte das demonstrações 3D (personagens masculino e feminino).

  Cobre o contrato de produto, não o WebGL:
  1. páginas declaram o recurso uma única vez e só onde ele é usado;
  2. sem personagem escolhido não existe demonstração 3D — e nada é gravado;
  3. a escolha grava `sexo` no perfil existente e preserva todo o resto;
  4. trocar de personagem não apaga treino, histórico, rotinas nem biblioteca;
  5. o catálogo publicado não aponta para arquivo inexistente;
  6. exercício com clipe próprio resolve exato;
  7. exercício só com grupo muscular resolve aproximado (com selo);
  8. exercício sem nada resolve a pose base, ainda aproximada;
  9. sem WebGL/módulo o painel avisa e mantém a ilustração, sem exceção;
  10. catálogo quebrado degrada com mensagem, sem tela em branco;
  11. montar sem container é no-op e trocar de personagem remonta o painel;
  12. os dois personagens abrem com o mesmo rig de 16 ossos;
  13. TODOS os clipes publicados casam osso a osso com o rig (nada de pose errada);
  14. o AnimationMixer movimenta o esqueleto de verdade, faixa mixamorig inclusa;
  15. sanidade de pose em TODOS os clipes (sem colapso, sem explosão, com movimento);
  16. a tela de execução mostra o painel 3D do exercício da sessão;
  17. a escolha feita no Perfil é lida e reaproveitada pelo painel;
  18. o grafo de módulos não usa especificador nu (funciona sem bundler).

  Uso: npm install && node tests/personagens3d.test.mjs
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  boot,
  closeAllApps,
  makeRoutine,
  repoRoot,
  routinesStore,
  wait
} from "./helpers/harness.mjs";
import { startRoutine } from "./helpers/legacy-flows.mjs";

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
      .split("\n").slice(0, 10).join("\n   "));
  } finally {
    closeAllApps();
  }
}

const read = rel => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const catalogoReal = () => JSON.parse(read("assets/3d/catalogo.json"));
const contar = (texto, alvo) => texto.split(alvo).length - 1;

const PERFIL_BASE = {
  version: 3,
  updatedAt: "2026-10-01T00:00:00.000Z",
  objetivo: "hipertrofia",
  nivel: "intermediario",
  equipamento: "academia",
  diasPorSemana: 4,
  duracaoMinutos: 60
};

async function abrirBiblioteca(seed = {}) {
  const app = await boot(
    Object.assign({ "forja-perfil-v1": Object.assign({}, PERFIL_BASE, { sexo: "masculino" }) }, seed),
    "treino/biblioteca.html"
  );
  await wait(30);
  return app;
}

function palco(app, id = "teste-3d") {
  const container = app.d.createElement("div");
  container.id = id;
  app.d.body.appendChild(container);
  return container;
}

await runTest("1. páginas declaram CSS e script uma vez, só onde há 3D", async () => {
  const executar = read("treino/executar.html");
  assert.equal(contar(executar, "personagens-3d.css"), 1);
  assert.equal(contar(executar, "forja-personagens.js"), 1);
  assert.equal(contar(executar, 'id="execution-3d"'), 1);

  const biblioteca = read("treino/biblioteca.html");
  assert.equal(contar(biblioteca, "personagens-3d.css"), 1);
  assert.equal(contar(biblioteca, "forja-personagens.js"), 1);
  assert.ok(!biblioteca.includes('id="execution-3d"'), "container de execução não pertence à biblioteca");

  const configuracoes = read("configuracoes/index.html");
  assert.equal(contar(configuracoes, "personagens-3d.css"), 1);
  assert.equal(contar(configuracoes, "forja-personagens.js"), 1);
  assert.ok(configuracoes.includes('id="creditos-3d"'), "créditos 3D existem");
  assert.ok(configuracoes.includes("data-seletor-personagem"), "seletor de personagem existe");

  ["index.html", "perfil/index.html", "treino/index.html"].forEach(page => {
    assert.ok(!read(page).includes("forja-personagens.js"),
      page + " não deve carregar o 3D (peso desnecessário)");
  });

  ["executar", "biblioteca", "configuracoes"].forEach(nome => {
    const arquivo = path.join(repoRoot, "assets", "css", "personagens-3d.css");
    assert.ok(fs.existsSync(arquivo), "CSS do 3D existe");
    assert.ok(read("assets/css/personagens-3d.css").includes(".c3-palco"));
    void nome;
  });
});

await runTest("2. sem personagem escolhido: pergunta obrigatória, sem canvas, sem gravação", async () => {
  const seed = { "forja-perfil-v1": Object.assign({}, PERFIL_BASE, { sexo: "" }) };
  const app = await boot(seed, "treino/executar.html");
  await wait(30);
  app.F.personagens3d.definirCatalogo(catalogoReal());

  const container = palco(app);
  const antes = app.keys().map(key => [key, app.raw(key)]);

  await app.F.personagens3d.montar(container, { libraryId: "cal-flexao", name: "Flexão" });
  await wait(20);

  assert.ok(container.querySelector(".c3-escolha"), "pergunta de escolha aparece");
  assert.equal(container.querySelector(".c3-escolha-titulo").textContent,
    app.F.personagens3d.PERGUNTA);
  assert.equal(container.querySelectorAll("canvas").length, 0, "nenhum canvas antes da escolha");
  assert.equal(container.querySelectorAll(".c3-opcao.is-active").length, 0, "nada pré-marcado");
  container.querySelectorAll("[data-personagem-opcao]").forEach(botao => {
    assert.equal(botao.getAttribute("aria-pressed"), "false");
  });
  assert.deepEqual(app.keys().map(key => [key, app.raw(key)]), antes,
    "abrir o painel não pode gravar nada");
  assert.equal(app.F.resolvePersonagem(app.F.state.profile), null);

  /* Na tela de execução, sem personagem, o painel nem aparece: ninguém é
     interrompido no meio do treino para escolher boneco. */
  const execucao = await boot({ "forja-perfil-v1": Object.assign({}, PERFIL_BASE, { sexo: "" }) },
    "treino/executar.html");
  await wait(40);
  const palcoTreino = execucao.$("#execution-3d");
  execucao.F.personagens3d.montarEmExecucao({ libraryId: "cal-flexao" });
  await wait(30);
  assert.equal(palcoTreino.hidden, true, "sem personagem, o painel fica oculto na execução");
  assert.equal(palcoTreino.querySelectorAll(".c3-card").length, 0,
    "nada de pergunta de personagem no meio do treino");
});

await runTest("3. escolher personagem grava sexo e preserva o resto do perfil", async () => {
  const app = await boot({ "forja-perfil-v1": Object.assign({}, PERFIL_BASE, { sexo: "" }) },
    "treino/executar.html");
  await wait(30);
  const chavesAntes = app.keys();

  assert.equal(app.F.personagens3d.escolherPersonagem("masculino", { avisar: false }), true);

  const perfil = app.data("forja-perfil-v1");
  assert.equal(perfil.sexo, "masculino");
  assert.equal(perfil.objetivo, PERFIL_BASE.objetivo);
  assert.equal(perfil.nivel, PERFIL_BASE.nivel);
  assert.equal(perfil.equipamento, PERFIL_BASE.equipamento);
  assert.equal(perfil.diasPorSemana, PERFIL_BASE.diasPorSemana);
  assert.equal(perfil.duracaoMinutos, PERFIL_BASE.duracaoMinutos);
  assert.deepEqual(app.keys(), chavesAntes, "nenhuma chave nova no armazenamento");
  assert.equal(app.F.resolvePersonagem(app.F.state.profile).id, "masculino");

  assert.equal(app.F.personagens3d.escolherPersonagem("inexistente", { avisar: false }), false,
    "valor fora do contrato é recusado");
});

await runTest("4. trocar de personagem não apaga treino, rotinas nem histórico", async () => {
  const rotinas = routinesStore(
    [makeRoutine("calisthenics", "Corpo livre", [{ name: "Flexão", reps: "12" }], "rot-cal")],
    [makeRoutine("weights", "Força", [{ name: "Supino", reps: "8", load: "40 kg" }], "rot-peso")]
  );
  const historico = [{
    id: "sessao-1",
    start: "2026-10-20T10:00:00.000Z",
    end: "2026-10-20T10:40:00.000Z",
    modality: "weights",
    exercises: [{ name: "Supino", completedSets: 3, logs: [{ reps: "8", load: "40" }] }]
  }];
  const app = await abrirBiblioteca({
    "forja-treino-rotinas-v1": rotinas,
    "forja-treino-historico-v1": historico
  });

  const antes = {
    rotinas: app.raw("forja-treino-rotinas-v1"),
    historico: app.raw("forja-treino-historico-v1"),
    chaves: app.keys()
  };

  assert.equal(app.F.personagens3d.escolherPersonagem("feminino", { avisar: false }), true);

  assert.equal(app.data("forja-perfil-v1").sexo, "feminino");
  assert.equal(app.raw("forja-treino-rotinas-v1"), antes.rotinas, "rotinas intactas");
  assert.equal(app.raw("forja-treino-historico-v1"), antes.historico, "histórico intacto");
  assert.deepEqual(app.keys(), antes.chaves, "nenhuma chave criada ou removida");
});

await runTest("5. catálogo publicado não aponta para arquivo inexistente", async () => {
  const catalogo = catalogoReal();
  assert.equal(catalogo.formato, "forja-catalogo-3d");
  assert.deepEqual(Object.keys(catalogo.personagens).sort(), ["feminino", "masculino"]);

  Object.values(catalogo.personagens).forEach(personagem => {
    const arquivo = path.join(repoRoot, personagem.arquivo);
    assert.ok(fs.existsSync(arquivo), "GLB ausente: " + personagem.arquivo);
    assert.equal(fs.statSync(arquivo).size, personagem.bytes, "bytes divergentes em " + personagem.arquivo);
  });

  const ids = new Set(catalogo.clipes.map(clipe => clipe.id));
  catalogo.clipes.forEach(clipe => {
    const arquivo = path.join(repoRoot, clipe.arquivo);
    assert.ok(fs.existsSync(arquivo), "clipe anunciado sem arquivo: " + clipe.arquivo);
    assert.equal(fs.statSync(arquivo).size, clipe.bytes, "bytes divergentes em " + clipe.arquivo);
    assert.ok(clipe.duracaoS >= 0 && clipe.fps > 0);
  });

  catalogo.clipesIndisponiveis.forEach(item => {
    assert.ok(!ids.has(item.id), "clipe indisponível não pode estar publicado: " + item.id);
    assert.ok(!fs.existsSync(path.join(repoRoot, "assets/3d/animacoes", item.id + ".glb")));
  });

  Object.values(catalogo.exercicios).forEach(id => {
    assert.ok(ids.has(id), "exercício aponta para clipe inexistente: " + id);
  });
  Object.values(catalogo.fallbackPorGrupo).forEach(id => {
    assert.ok(ids.has(id), "fallback aponta para clipe inexistente: " + id);
  });
});

await runTest("6. exercício com clipe próprio resolve exato", async () => {
  const app = await abrirBiblioteca();
  app.F.personagens3d.definirCatalogo(catalogoReal());

  const resolvido = app.F.personagens3d.resolverClipe({ libraryId: "cal-flexao", name: "Flexão" });
  assert.ok(resolvido, "flexão tem animação");
  assert.equal(resolvido.clipe.id, "flexao");
  assert.equal(resolvido.aproximado, false);
  assert.equal(resolvido.motivo, null);

  const peso = app.F.personagens3d.resolverClipe({ libraryId: "mus-rosca-direta", name: "Rosca direta" });
  assert.equal(peso.clipe.id, "rosca-direta", "clipe retargetado também resolve");
});

await runTest("7. exercício sem clipe cai no grupo muscular como aproximado", async () => {
  const app = await abrirBiblioteca();
  app.F.personagens3d.definirCatalogo(catalogoReal());

  const original = app.F.atlas.findRecordFor;
  app.F.atlas.findRecordFor = () => ({ roles: { primary: ["peito"], secondary: [], stabilizers: [] } });
  try {
    const resolvido = app.F.personagens3d.resolverClipe({ libraryId: "mus-supino", name: "Supino" });
    assert.ok(resolvido);
    assert.equal(resolvido.clipe.id, "peck-deck", "peito usa o clipe do próprio grupo");
    assert.equal(resolvido.aproximado, true, "grupo muscular nunca é o movimento exato");
    assert.match(resolvido.motivo, /peito/);
  } finally {
    app.F.atlas.findRecordFor = original;
  }
});

await runTest("8. exercício sem classificação cai na pose base", async () => {
  const app = await abrirBiblioteca();
  app.F.personagens3d.definirCatalogo(catalogoReal());

  const original = app.F.atlas.findRecordFor;
  app.F.atlas.findRecordFor = () => null;
  try {
    const resolvido = app.F.personagens3d.resolverClipe({ libraryId: "sem-classificacao" });
    assert.equal(resolvido.clipe.id, "postura-base");
    assert.equal(resolvido.aproximado, true);
    assert.equal(resolvido.motivo, "movimento base");
  } finally {
    app.F.atlas.findRecordFor = original;
  }

  const catalogo = catalogoReal();
  catalogo.fallbackPorGrupo = {};
  app.F.personagens3d.definirCatalogo(catalogo);
  assert.equal(app.F.personagens3d.resolverClipe({ libraryId: "sem-classificacao" }), null,
    "sem pose base no catálogo, devolve null em vez de inventar");
});

await runTest("9. sem WebGL o painel avisa e não lança exceção", async () => {
  const app = await abrirBiblioteca();
  app.F.personagens3d.definirCatalogo(catalogoReal());

  const container = palco(app);
  let painel = null;
  try {
    painel = await app.F.personagens3d.montar(container, { libraryId: "cal-flexao", name: "Flexão" });
  } catch (erro) {
    assert.fail("montar não deve lançar: " + erro.message);
  }
  await wait(30);

  assert.ok(painel, "montar devolve o painel mesmo no fallback");
  assert.equal(container.querySelectorAll("canvas").length, 0, "sem WebGL não há canvas");
  const aviso = container.querySelector(".c3-aviso");
  assert.ok(aviso && !aviso.hidden, "aviso visível");
  assert.match(aviso.textContent, /3D/);
  assert.ok(container.querySelector(".c3-palco").getAttribute("data-estado") === "erro");
  app.F.personagens3d.descartar(container);
  assert.equal(container.querySelectorAll(".c3-card").length, 1, "descartar não deixa card órfão");

  assert.equal(await app.F.personagens3d.montar(null, { libraryId: "cal-flexao" }), null,
    "container nulo é no-op");
});

await runTest("10. catálogo incompleto degrada com mensagem", async () => {
  const app = await abrirBiblioteca();
  const catalogo = catalogoReal();
  catalogo.personagens = {};
  app.F.personagens3d.definirCatalogo(catalogo);

  const container = palco(app);
  await app.F.personagens3d.montar(container, { libraryId: "cal-flexao", name: "Flexão" });
  await wait(20);

  const aviso = container.querySelector(".c3-aviso");
  assert.ok(aviso && !aviso.hidden);
  assert.match(aviso.textContent, /personagem escolhido não está disponível/i);
  assert.equal(container.querySelectorAll("canvas").length, 0);
});

await runTest("11. troca de personagem remonta o painel aberto", async () => {
  const app = await abrirBiblioteca();
  app.F.personagens3d.definirCatalogo(catalogoReal());

  const container = palco(app);
  await app.F.personagens3d.montar(container, { libraryId: "cal-flexao", name: "Flexão" });
  await wait(20);

  const quem = () => container.querySelector(".c3-quem").textContent;
  assert.match(quem(), /masculino/i);

  app.F.personagens3d.escolherPersonagem("feminino", { avisar: false });
  await wait(60);

  assert.match(quem(), /feminino/i, "painel acompanha a nova escolha");
  assert.equal(container.querySelectorAll(".c3-card").length, 1, "não duplica o card");
  app.F.personagens3d.descartar(container);
});


/* ------------------------------------------------------------------ */
/* 3D de verdade: GLB reais carregados pelo mesmo three.js do app      */
/* ------------------------------------------------------------------ */

globalThis.self = globalThis;
if (typeof globalThis.createImageBitmap !== "function") {
  /* jsdom/node não decodificam imagem; o material não importa para a pose. */
  globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
}
if (typeof globalThis.URL.createObjectURL !== "function") {
  globalThis.URL.createObjectURL = () => "blob:forja-test";
  globalThis.URL.revokeObjectURL = () => {};
}

const threeMod = await import(path.join(repoRoot, "assets/vendor/three/three.module.min.js"));
const cenaMod = await import(path.join(repoRoot, "assets/js/forja-3d-cena.js"));
const GLTFLoader = (await import(
  path.join(repoRoot, "assets/vendor/three/addons/loaders/GLTFLoader.js")
)).GLTFLoader;

const carregarGLB = arquivo => new Promise((resolve, reject) => {
  const buffer = fs.readFileSync(path.join(repoRoot, arquivo));
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  new GLTFLoader().parse(bytes, "", resolve, reject);
});

const nomesDeOssos = raiz => {
  const nomes = new Set();
  raiz.traverse(objeto => { if (objeto.isBone) nomes.add(objeto.name); });
  return nomes;
};

await runTest("12. os dois personagens abrem com o mesmo rig de 16 ossos", async () => {
  const ossosPorPersonagem = {};
  for (const slug of ["masculino", "feminino"]) {
    const gltf = await carregarGLB("assets/3d/personagens/" + slug + ".glb");
    const ossos = nomesDeOssos(gltf.scene);
    assert.equal(ossos.size, 16, slug + " deve ter 16 ossos, encontrou " + ossos.size);
    ["hips", "spine", "neck", "armL", "armR", "legL", "legR"].forEach(nome => {
      assert.ok(ossos.has(nome), slug + " sem o osso " + nome);
    });
    let malhas = 0;
    gltf.scene.traverse(objeto => { if (objeto.isSkinnedMesh) malhas += 1; });
    assert.ok(malhas >= 1, slug + " precisa de malha com skin");
    ossosPorPersonagem[slug] = Array.from(ossos).sort();
  }
  assert.deepEqual(ossosPorPersonagem.masculino, ossosPorPersonagem.feminino,
    "os dois personagens compartilham o mesmo esqueleto — um conjunto de clipes serve aos dois");
});

await runTest("13. todos os clipes publicados casam osso a osso com o rig", async () => {
  const masculino = await carregarGLB("assets/3d/personagens/masculino.glb");
  const ossos = nomesDeOssos(masculino.scene);
  const catalogo = catalogoReal();

  const alvos = new Map();
  masculino.scene.traverse(objeto => alvos.set(objeto.name, objeto));
  const raiz = { traverse: fn => masculino.scene.traverse(fn) };

  for (const clipe of catalogo.clipes) {
    const gltf = await carregarGLB(clipe.arquivo);
    const origem = gltf.animations && gltf.animations[0];
    assert.ok(origem, clipe.id + ": o GLB não traz animação");
    assert.ok(origem.tracks.length > 0, clipe.id + ": animação sem faixas");

    const presos = cenaMod.reamarrarFaixas(origem, raiz);
    assert.ok(presos.tracks.length > 0, clipe.id + ": nenhuma faixa casou com o rig");
    presos.tracks.forEach(faixa => {
      const osso = faixa.name.split(".")[0];
      assert.ok(ossos.has(osso), clipe.id + ": faixa aponta para osso inexistente (" + faixa.name + ")");
    });
  }

  /* Faixa de outro rig é renomeada, nunca aplicada no osso errado. */
  const sintetico = new threeMod.AnimationClip("teste", 1, [
    new threeMod.VectorKeyframeTrack("mixamorig:hips.position", [0, 1], [0, 0, 0, 0, 1, 0])
  ]);
  const remapeado = cenaMod.reamarrarFaixas(sintetico, raiz);
  assert.equal(remapeado.tracks[0].name, "hips.position");

  const incompativel = new threeMod.AnimationClip("ruim", 1, [
    new threeMod.VectorKeyframeTrack("ossoQueNaoExiste.position", [0, 1], [0, 0, 0, 0, 1, 0])
  ]);
  assert.throws(() => cenaMod.reamarrarFaixas(incompativel, raiz),
    /não casa com nenhum osso/, "clipe incompatível precisa falhar em vez de deformar o boneco");
});

await runTest("14. o AnimationMixer movimenta o esqueleto de verdade", async () => {
  const masculino = await carregarGLB("assets/3d/personagens/masculino.glb");
  const ossos = {};
  masculino.scene.traverse(objeto => { if (objeto.isBone) ossos[objeto.name] = objeto; });
  assert.ok(ossos.armL && ossos.kneeL);

  const gltf = await carregarGLB("assets/3d/animacoes/flexao.glb");
  const clipe = cenaMod.reamarrarFaixas(gltf.animations[0], {
    traverse: fn => masculino.scene.traverse(fn)
  });

  const mixer = new threeMod.AnimationMixer(masculino.scene);
  const acao = mixer.clipAction(clipe);
  acao.play();

  const lerPose = () => {
    masculino.scene.updateMatrixWorld(true);
    const posicao = new threeMod.Vector3();
    ossos.armL.getWorldPosition(posicao);
    return { braco: posicao.clone(), cotovelo: ossos.armL.quaternion.clone() };
  };

  const inicio = lerPose();
  mixer.update(0.9);
  const meio = lerPose();
  mixer.update(0.9);
  const fim = lerPose();

  const deltaBraco = inicio.braco.distanceTo(meio.braco) + inicio.braco.distanceTo(fim.braco);
  const deltaRotacao = inicio.cotovelo.angleTo(meio.cotovelo) + inicio.cotovelo.angleTo(fim.cotovelo);

  assert.ok(deltaBraco > 0.01 || deltaRotacao > 0.05,
    "a flexão precisa mover o braço: os clipes não podem ser pose estática");
  assert.ok(clipe.duration > 0.3, "clipe curto demais para uma demonstração: " + clipe.duration);

  /* O personagem continua de pé: nenhum osso explode para longe do corpo. */
  masculino.scene.updateMatrixWorld(true);
  const cabeca = new threeMod.Vector3();
  ossos.neck.getWorldPosition(cabeca);
  assert.ok(Math.abs(cabeca.y) < 3 && cabeca.length() < 3, "pose absurda detectada");
});


await runTest("15. sanidade de pose em todos os clipes publicados", async () => {
  const masculino = await carregarGLB("assets/3d/personagens/masculino.glb");
  const ossos = {};
  masculino.scene.traverse(objeto => { if (objeto.isBone) ossos[objeto.name] = objeto; });
  const raiz = { traverse: fn => masculino.scene.traverse(fn) };
  const catalogo = catalogoReal();
  const vetor = new threeMod.Vector3();

  const problemas = [];
  for (const info of catalogo.clipes) {
    const gltf = await carregarGLB(info.arquivo);
    const clipe = cenaMod.reamarrarFaixas(gltf.animations[0], raiz);
    const mixer = new threeMod.AnimationMixer(masculino.scene);
    mixer.clipAction(clipe).play();

    const alturas = [];
    const deslocamentos = [];
    const amostras = 8;
    for (let i = 0; i < amostras; i += 1) {
      mixer.setTime((clipe.duration * i) / amostras);
      masculino.scene.updateMatrixWorld(true);
      const caixa = new threeMod.Box3();
      masculino.scene.traverse(objeto => {
        if (objeto.isBone) caixa.expandByPoint(objeto.getWorldPosition(vetor));
      });
      alturas.push(caixa.max.y - caixa.min.y);
      deslocamentos.push(ossos.hips.getWorldPosition(vetor).clone());
    }

    const referencia = alturas[0];
    const variacao = Math.max(...alturas) / Math.max(0.001, Math.min(...alturas));
    const movimento = Math.max(...deslocamentos.map((ponto, i) =>
      i === 0 ? 0 : ponto.distanceTo(deslocamentos[0])));

    if (Math.max(...alturas) > 2.6) problemas.push(info.id + ": esqueleto alto demais (" +
      Math.max(...alturas).toFixed(2) + " m)");
    if (variacao > 6) problemas.push(info.id + ": altura varia " + variacao.toFixed(1) + "× (colapso)");
    if (referencia < 0.25) problemas.push(info.id + ": personagem esmagado no chão");
    if (movimento > 3) problemas.push(info.id + ": quadril dispara " + movimento.toFixed(1) + " m");
    if (clipe.tracks.length < 10) problemas.push(info.id + ": só " + clipe.tracks.length + " faixas");
    if (!(clipe.duration > 0.2)) problemas.push(info.id + ": duração " + clipe.duration);
  }

  assert.deepEqual(problemas, [], "clipes com pose suspeita: " + problemas.join(" | "));
});

await runTest("16. a tela de execução mostra o painel 3D do exercício", async () => {
  const rotinas = routinesStore([makeRoutine("calisthenics", "Corpo livre", [
    { id: "cal-flexao", name: "Flexão de braço", reps: "12" }
  ], "rot-flexao")], []);

  const app = await boot({
    "forja-perfil-v1": Object.assign({}, PERFIL_BASE, { sexo: "masculino" }),
    "forja-treino-rotinas-v1": rotinas
  }, "treino/calistenia.html");
  await wait(220);
  await startRoutine(app, "Corpo livre");
  await wait(120);

  /* A página de execução é quem carrega o módulo 3D. */
  assert.ok(app.F.personagens3d, "executar.html carrega forja-personagens.js");
  const palco = app.$("#execution-3d");
  assert.ok(palco, "a tela de execução tem o container 3D");
  assert.ok(palco.querySelector(".c3-card"), "o painel foi montado pelo fluxo da sessão");

  /* Sem fetch no jsdom, o catálogo é injetado e o painel remontado pelo mesmo
     ponto de entrada que a sessão usa. */
  app.F.personagens3d.definirCatalogo(catalogoReal());
  app.F.personagens3d.montarEmExecucao({ libraryId: "cal-flexao", name: "Flexão de braço" });
  await wait(60);

  assert.equal(palco.hidden, false, "o container aparece quando há exercício");
  assert.match(palco.querySelector(".c3-quem").textContent, /masculino/i);
  assert.equal(palco.querySelector(".c3-selo"), null,
    "flexão tem clipe exato: nenhum selo de aproximação");
});

await runTest("17. a escolha feita no Perfil chega ao painel 3D", async () => {
  const app = await boot({ "forja-perfil-v1": Object.assign({}, PERFIL_BASE, { sexo: "" }) },
    "perfil/index.html");
  await wait(40);

  const select = app.$("#prof-sexo");
  assert.ok(select, "perfil tem o campo de sexo");
  assert.equal(select.value, "", "nenhum valor pré-selecionado");

  select.value = "feminino";
  app.$("#profile-form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(80);

  assert.equal(app.data("forja-perfil-v1").sexo, "feminino", "a escolha foi gravada");
  assert.equal(app.F.resolvePersonagem(app.F.state.profile).id, "feminino");

  /* Noutra página, o painel 3D lê a mesma escolha do perfil. */
  await app.go("../treino/biblioteca.html");
  await wait(60);
  app.F.personagens3d.definirCatalogo(catalogoReal());
  const container = palco(app, "perfil-3d");
  await app.F.personagens3d.montar(container, { libraryId: "cal-flexao" });
  await wait(20);
  assert.match(container.querySelector(".c3-quem").textContent, /feminino/i);
});

await runTest("18. o grafo de módulos funciona sem bundler", async () => {
  const cena = read("assets/js/forja-3d-cena.js");
  const imports = [...cena.matchAll(/from\s+"([^"]+)"/g)].map(m => m[1]);
  assert.ok(imports.length >= 2, "a cena importa three e o loader");
  imports.forEach(especificador => {
    assert.ok(especificador.startsWith("."), "especificador precisa ser relativo: " + especificador);
    const alvo = path.resolve(path.join(repoRoot, "assets/js"), especificador);
    assert.ok(fs.existsSync(alvo), "módulo importado não existe: " + especificador);
  });

  ["addons/loaders/GLTFLoader.js", "addons/utils/BufferGeometryUtils.js"].forEach(rel => {
    const fonte = read("assets/vendor/three/" + rel);
    assert.ok(!/from\s+["']three["']/.test(fonte),
      rel + " ainda importa \"three\" nu (quebraria no navegador sem import map)");
    assert.match(fonte, /from\s+['"]\.\.\/\.\.\/three\.module\.min\.js['"]/);
  });

  assert.ok(fs.existsSync(path.join(repoRoot, "assets/vendor/three/three.core.min.js")),
    "three.core.min.js precisa acompanhar o módulo");
  assert.ok(fs.existsSync(path.join(repoRoot, "assets/vendor/three/LICENSE")));
});

const falhas = results.filter(result => !result.ok);
console.log(`\n${results.length - falhas.length}/${results.length} testes de personagens 3D passaram`);
if (falhas.length) {
  falhas.forEach(falha => console.error("Falhou: " + falha.name));
  process.exit(1);
}
