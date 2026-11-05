/*
  Suíte do sistema de vídeos de demonstração (YouTube + fallback de referência).

  Cobre:
  - Catálogo oficial, ausência total do antigo sistema 3D e zero chaves públicas
  - Validação de URLs/IDs do YouTube (incluindo Shorts), duração <= 60s e enquadramento
  - Exercício com vídeo oficial (youtube-nocookie.com, sem autoplay, com controles, enquadramento original)
  - Exercício sem vídeo exibindo imagem de referência + "Vídeo de demonstração ainda não disponível"
  - Fluxo "Procurar vídeo" no editor de rotinas (busca, prévia 16:9, confirmação)
  - Opção de zoom e corte 16:9 sem deformação para Shorts verticais exclusiva em treinos personalizados
  - Dois treinos personalizados com vídeos e enquadramentos diferentes para o mesmo exercício
  - Persistência após recarregar a página (rotina e sessão ativa)
  - Exportação, validação, restauração e desfazer de backup JSON
  - Fallback automático para vídeo removido, privado ou indisponível
  - Busca sem resultados, falha de conexão com a API e ausência de chave sem inventar dados
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
  todayKey,
  wait
} from "./helpers/harness.mjs";

const results = [];
const pages = [
  "index.html",
  "treino/index.html",
  "treino/calistenia.html",
  "treino/musculacao.html",
  "treino/rotina.html",
  "treino/executar.html",
  "treino/biblioteca.html",
  "progresso/index.html",
  "perfil/index.html",
  "configuracoes/index.html",
  "explorar/index.html",
  "explorar/atlas.html",
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
    console.log(
      "   " +
        String(error && error.stack ? error.stack : error)
          .split("\n")
          .slice(0, 12)
          .join("\n   ")
    );
  } finally {
    closeAllApps();
  }
}

function routineForExercise(id, name, exerciseOverrides = {}) {
  const routine = makeRoutine(
    "calisthenics",
    name,
    [
      Object.assign(
        {
          id: id + "-ex1",
          name: "Flexão de braço",
          section: "main",
          sets: 3,
          reps: "10",
          rest: 30
        },
        exerciseOverrides
      )
    ],
    id
  );
  routine.sections.main[0].libraryId =
    exerciseOverrides.libraryId === undefined
      ? "cal-flexao"
      : exerciseOverrides.libraryId;
  if (exerciseOverrides.youtubeVideo !== undefined) {
    routine.sections.main[0].youtubeVideo = exerciseOverrides.youtubeVideo;
  }
  return routine;
}

function mockYouTubeApiFetcher(searchResults, videosDetails) {
  return async url => {
    const u = String(url);
    if (u.includes("/youtube/v3/search")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { items: searchResults };
        }
      };
    }
    if (u.includes("/youtube/v3/videos")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { items: videosDetails };
        }
      };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
}

await runTest("V1. Catálogo cobre os 37 exercícios, sem vídeos locais, sem 3D e sem segredos", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const V = app.w.FORJA_VIDEOS_DATA;
  const cfg = app.w.FORJA_YOUTUBE_CONFIG;

  assert.ok(V && V.exercicios, "FORJA_VIDEOS_DATA ausente");
  assert.equal(cfg.apiKey, "", "chave de API não deve estar hardcoded no código público");
  assert.equal(cfg.endpoint, "", "endpoint intermediário não deve vir ativado por padrão");

  const allExercises = app.F.catalog
    .items("calisthenics")
    .concat(app.F.catalog.items("weights"));
  assert.equal(allExercises.length, 37);
  assert.equal(Object.keys(V.exercicios).length, 37);

  let withVideo = 0;
  let withoutVideo = 0;
  allExercises.forEach(item => {
    const key = item.mode + ":" + item.id;
    assert.ok(Object.prototype.hasOwnProperty.call(V.exercicios, key), "chave ausente: " + key);
    const entry = V.exercicios[key];
    if (entry === null) {
      withoutVideo += 1;
      assert.ok(
        app.F.demos.resolve(item, item.mode),
        "exercício sem vídeo oficial precisa ter imagem de referência: " + key
      );
    } else {
      withVideo += 1;
      assert.ok(app.F.isValidYouTubeId(entry.videoId), "ID inválido em " + key);
      assert.ok(entry.durationSeconds >= 1 && entry.durationSeconds <= 60, "duração fora de 1..60s em " + key);
      const resolved = app.F.videos.officialFor(item, item.mode);
      assert.equal(resolved.framing, "original", "vídeo oficial deve manter enquadramento original");
    }
  });
  assert.ok(withVideo >= 20 && withoutVideo >= 5);

  /* Nenhum componente do antigo sistema 3D existe no projeto ou no runtime. */
  assert.equal(app.F.personagens3d, undefined);
  assert.equal(fs.existsSync(path.join(repoRoot, "assets/3d")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "assets/vendor/three")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "assets/js/forja-personagens.js")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "assets/js/forja-exercicio-3d.js")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "assets/css/exercicio-3d.css")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "avaliacao-piloto-3d")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "FORJA_ASSETS_3D")), false);

  /* Nenhum vídeo do YouTube baixado no repositório. */
  const walk = dir => {
    let found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found = found.concat(walk(full));
      else if (/\.(mp4|webm|mkv|mov|glb)$/i.test(entry.name)) found.push(full);
    }
    return found;
  };
  assert.deepEqual(walk(path.join(repoRoot, "assets")), []);

  /* Todas as 13 páginas carregam os módulos de vídeo sem gravar nada no boot. */
  for (const page of pages) {
    const pApp = await boot({}, page);
    assert.ok(pApp.F.videos && pApp.F.videos.available(), "F.videos ausente em " + page);
    assert.deepEqual(
      pApp.storageWrites.filter(w => w.method === "setItem"),
      [],
      "escrita indevida ao abrir " + page
    );
    assertNoErrors(pApp, page);
    pApp.close();
  }
});

await runTest("V2. Validação de URLs, IDs, Shorts, duração <= 60s e enquadramento", async () => {
  const app = await boot({}, "index.html");
  const F = app.F;

  const plain = value => JSON.parse(JSON.stringify(value));

  assert.deepEqual(plain(F.parseYouTubeUrl("xBrI-N44QLc")), {
    videoId: "xBrI-N44QLc",
    isShort: false
  });
  assert.deepEqual(plain(F.parseYouTubeUrl("https://www.youtube.com/watch?v=xBrI-N44QLc&t=5s")), {
    videoId: "xBrI-N44QLc",
    isShort: false
  });
  assert.deepEqual(plain(F.parseYouTubeUrl("https://youtu.be/vkwdKKJBJXA")), {
    videoId: "vkwdKKJBJXA",
    isShort: false
  });
  assert.deepEqual(
    plain(F.parseYouTubeUrl("https://www.youtube-nocookie.com/embed/9A6NPVPzkqQ")),
    {
      videoId: "9A6NPVPzkqQ",
      isShort: false
    }
  );
  assert.deepEqual(plain(F.parseYouTubeUrl("https://www.youtube.com/shorts/mwlp75MS6Rg")), {
    videoId: "mwlp75MS6Rg",
    isShort: true
  });

  /* Rejeita domínios externos, protocolos perigosos, lives/playlists e IDs curtos/longos. */
  assert.equal(F.parseYouTubeUrl("javascript:alert(1)"), null);
  assert.equal(F.parseYouTubeUrl("https://evil.example.com/watch?v=xBrI-N44QLc"), null);
  assert.equal(F.parseYouTubeUrl("https://www.youtube.com/playlist?list=PL1234567890"), null);
  assert.equal(F.parseYouTubeUrl("https://www.youtube.com/live/xBrI-N44QLc"), null);
  assert.equal(F.parseYouTubeUrl("curto"), null);

  assert.equal(F.parseIsoDurationSeconds("PT42S"), 42);
  assert.equal(F.parseIsoDurationSeconds("PT1M"), 60);
  assert.equal(F.parseIsoDurationSeconds("PT1M1S"), 61);

  assert.equal(
    F.normalizeYouTubeVideo({ videoId: "xBrI-N44QLc", durationSeconds: 61 }),
    null,
    "deve rejeitar vídeos acima de 60s"
  );
  assert.equal(
    F.isValidYouTubeVideoShape({ videoId: "xBrI-N44QLc", framing: "stretch" }),
    false,
    "deve rejeitar enquadramento deformado"
  );
  assert.equal(
    F.isValidYouTubeVideoShape({
      videoId: "xBrI-N44QLc",
      title: "Push-Up",
      channelTitle: "FIT.nl",
      durationSeconds: 22,
      framing: "zoom"
    }),
    true
  );
});

await runTest("V3. Exercício com vídeo oficial usa youtube-nocookie, sem autoplay, controles e enquadramento original", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const flexao = app.F.catalog.items("calisthenics").find(i => i.id === "cal-flexao");

  app.F.catalog.showDetail(flexao, { readOnly: true });
  await wait(30);

  const stage = app.$(".modal-details .video-demo");
  assert.ok(stage, "bloco .video-demo ausente");
  assert.equal(stage.dataset.videoState, "ready");
  assert.equal(stage.dataset.videoSource, "official");
  assert.equal(stage.dataset.videoId, "xBrI-N44QLc");
  assert.equal(stage.dataset.videoFraming, "original");

  const player = app.$(".modal-details .video-demo-player");
  assert.equal(player.classList.contains("is-zoom-crop"), false, "vídeo oficial nunca deve receber zoom/corte");
  assert.equal(app.$(".video-picker-framing"), null, "biblioteca oficial não expõe controle de corte");

  const iframe = app.$(".modal-details .video-demo-iframe");
  assert.ok(iframe, "iframe do YouTube ausente");
  assert.match(iframe.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/xBrI-N44QLc\?/);
  assert.match(iframe.src, /autoplay=0/);
  assert.match(iframe.src, /controls=1/);
  assert.match(iframe.src, /[?&]mute=1(?:&|$)/);
  assert.equal(app.$(".modal-details .video-demo-unavailable").hidden, true);
  assert.equal(app.$(".modal-3d"), null, "nenhum palco 3D pode existir");

  app.modalAction("cancel");
  await wait(25);
  assertNoErrors(app, "detalhe com vídeo oficial");
});

await runTest("V4. Exercício sem vídeo exibe imagem de referência correspondente + mensagem discreta", async () => {
  const routine = routineForExercise("r-sem-video", "Treino Polichinelo", {
    name: "Polichinelo",
    libraryId: "cal-polichinelo"
  });
  const ex = routine.sections.main[0];
  const session = {
    version: 2,
    id: "sess-polichinelo",
    date: todayKey(),
    modality: "calisthenics",
    routineId: routine.id,
    routineName: routine.name,
    startedAt: 1000,
    elapsedMs: 0,
    running: true,
    currentIndex: 0,
    completedSets: { [ex.id]: 0 },
    totalPlannedSets: ex.sets,
    queue: [Object.assign({}, ex)],
    status: "active",
    restEndAt: null,
    restRemainingMs: 0,
    restPaused: false,
    pendingAdvance: false,
    restPlannedSeconds: 0,
    setTimer: null,
    setLogs: {},
    logDraft: {}
  };

  const app = await boot(
    {
      "forja-treino-rotinas-v1": routinesStore([routine], []),
      "forja-treino-sessao-ativa-v1": session
    },
    "treino/executar.html",
    { now: 1000 }
  );

  const stage = app.$("#execution-demo .video-demo");
  assert.ok(stage, "área de demonstração ausente na execução");
  assert.equal(stage.dataset.videoState, "none");
  assert.equal(app.$("#execution-demo .video-demo-iframe"), null, "não deve criar iframe sem vídeo");

  const media = app.$("#execution-demo .demo-media");
  assert.ok(media, "imagem de referência correspondente ausente");
  assert.equal(media.getAttribute("data-demo-id"), "repdb:jumping-jacks");

  const note = app.$("#execution-demo .video-demo-unavailable");
  assert.ok(note && !note.hidden, "aviso discreto ausente");
  assert.equal(note.textContent, "Vídeo de demonstração ainda não disponível");
  assertNoErrors(app, "exercício sem vídeo na execução");
});

await runTest("V5. Fluxo 'Procurar vídeo' no editor: busca, prévia 16:9, confirmação e edição preservada", async () => {
  const routine = routineForExercise("r-busca", "Treino Busca");
  const app = await boot(
    { "forja-treino-rotinas-v1": routinesStore([routine], []) },
    "treino/rotina.html?id=r-busca&modalidade=calisthenics"
  );

  app.w.FORJA_YOUTUBE_CONFIG.apiKey = "TEST_RESTRICTED_KEY";
  app.F.videos.setSearchFetcher(
    mockYouTubeApiFetcher(
      [
        { id: { videoId: "CustVideo01" } },
        { id: { videoId: "TooLongVid9" } }
      ],
      [
        {
          id: "CustVideo01",
          status: { embeddable: true, privacyStatus: "public" },
          contentDetails: { duration: "PT28S" },
          snippet: {
            title: "Push-Up Clean Form Tutorial",
            channelTitle: "Coach Lab",
            description: "Horizontal form tutorial",
            thumbnails: { medium: { width: 320, height: 180 } }
          }
        },
        {
          id: "TooLongVid9",
          status: { embeddable: true, privacyStatus: "public" },
          contentDetails: { duration: "PT2M15S" },
          snippet: {
            title: "Long Lecture",
            channelTitle: "Coach Lab",
            thumbnails: { medium: { width: 320, height: 180 } }
          }
        }
      ]
    )
  );

  app.click(".editor-exercise .video-row-button");
  await wait(40);

  assert.ok(app.$(".video-picker"), "modal Procurar vídeo não abriu");
  assert.equal(app.$(".video-picker-query").value, "Flexão de braço");
  const cards = app.$$(".video-result-card");
  assert.equal(cards.length, 1, "deve listar apenas vídeos <= 60s");
  assert.equal(cards[0].dataset.videoId, "CustVideo01");
  assert.match(cards[0].textContent, /Push-Up Clean Form Tutorial/);
  assert.match(cards[0].textContent, /Coach Lab/);
  assert.match(cards[0].textContent, /0:28/);

  /* Confirmar antes de inspecionar/selecionar é bloqueado. */
  app.modalAction("confirm");
  await wait(20);
  assert.ok(app.$(".modal-backdrop"), "não deve confirmar sem vídeo selecionado");

  /* Seleciona resultado e inspeciona prévia 16:9 antes de confirmar. */
  app.click('.video-result-card[data-video-id="CustVideo01"]');
  await wait(20);
  const previewIframe = app.$(".video-picker-preview-iframe");
  assert.ok(previewIframe, "prévia do vídeo não apareceu antes de confirmar");
  assert.match(previewIframe.src, /youtube-nocookie\.com\/embed\/CustVideo01/);
  assert.match(previewIframe.src, /autoplay=0/);
  assert.match(previewIframe.src, /controls=1/);
  assert.match(previewIframe.src, /[?&]mute=1(?:&|$)/);

  app.modalAction("confirm");
  await wait(30);
  assert.equal(app.$(".modal-backdrop"), null, "modal não fechou após confirmar");

  app.click("#save-routine-top");
  await wait(40);

  const saved = app.data(app.F.KEYS.routines).calisthenics[0].sections.main[0];
  assert.equal(saved.youtubeVideo.videoId, "CustVideo01");
  assert.equal(saved.youtubeVideo.channelTitle, "Coach Lab");
  assert.equal(saved.youtubeVideo.durationSeconds, 28);
  assert.equal(saved.youtubeVideo.framing, "original");

  /* Editar séries/repetições do exercício preserva youtubeVideo. */
  app.click('.editor-exercise .exercise-tools button[aria-label^="Editar"]');
  app.$("#exercise-sets").value = "5";
  app.$("#exercise-form").dispatchEvent(
    new app.w.Event("submit", { bubbles: true, cancelable: true })
  );
  await wait(20);
  app.click("#save-routine-top");
  await wait(40);

  const afterEdit = app.data(app.F.KEYS.routines).calisthenics[0].sections.main[0];
  assert.equal(afterEdit.sets, 5);
  assert.equal(afterEdit.youtubeVideo.videoId, "CustVideo01");
  assertNoErrors(app, "fluxo procurar vídeo");
});

await runTest("V6. Short vertical em treino personalizado: opção de zoom e corte 16:9 sem deformar e isolada", async () => {
  const routine = routineForExercise("r-short", "Treino Short");
  const app = await boot(
    { "forja-treino-rotinas-v1": routinesStore([routine], []) },
    "treino/rotina.html?id=r-short&modalidade=calisthenics"
  );

  app.w.FORJA_YOUTUBE_CONFIG.apiKey = "TEST_RESTRICTED_KEY";
  app.F.videos.setSearchFetcher(
    mockYouTubeApiFetcher(
      [{ id: { videoId: "ShortVert01" } }],
      [
        {
          id: "ShortVert01",
          status: { embeddable: true, privacyStatus: "public" },
          contentDetails: { duration: "PT19S" },
          snippet: {
            title: "Push-Up Quick Cue #shorts",
            channelTitle: "Calisthenics Lab",
            description: "#shorts",
            thumbnails: { high: { width: 480, height: 640 } }
          }
        }
      ]
    )
  );

  app.click(".editor-exercise .video-row-button");
  await wait(40);

  const card = app.$('.video-result-card[data-video-id="ShortVert01"]');
  assert.ok(card, "Short vertical <= 60s deve poder ser selecionado no treino personalizado");
  assert.match(card.textContent, /Short vertical/);

  app.click('.video-result-card[data-video-id="ShortVert01"]');
  await wait(20);

  const previewBox = app.$(".video-picker-preview-frame");
  assert.equal(previewBox.classList.contains("is-zoom-crop"), false);

  /* A prévia inicia silenciosa, sem autoplay e com controles. */
  const previewIframe = app.$(".video-picker-preview-iframe");
  assert.ok(previewIframe, "prévia do vídeo personalizado ausente");
  assert.match(previewIframe.src, /[?&]mute=1(?:&|$)/);
  assert.match(previewIframe.src, /[?&]autoplay=0(?:&|$)/);
  assert.match(previewIframe.src, /[?&]controls=1(?:&|$)/);

  /* Ativa zoom e corte 16:9 e verifica atualização imediata na prévia. */
  app.click('[data-framing-option="zoom"]');
  await wait(15);
  assert.equal(previewBox.classList.contains("is-zoom-crop"), true);
  assert.equal(
    app.$('[data-framing-option="zoom"]').getAttribute("aria-pressed"),
    "true"
  );

  app.modalAction("confirm");
  await wait(30);
  app.click("#save-routine-top");
  await wait(40);

  const saved = app.data(app.F.KEYS.routines).calisthenics[0].sections.main[0];
  assert.equal(saved.youtubeVideo.videoId, "ShortVert01");
  assert.equal(saved.youtubeVideo.framing, "zoom");
  assert.match(app.text(".editor-exercise-meta"), /zoom 16:9/i);

  /* Verifica renderização do palco no treino vs vídeo oficial intacto na biblioteca. */
  const customStage = app.F.videos.createStage(saved, "calisthenics");
  assert.equal(customStage.node.dataset.videoFraming, "zoom");
  assert.equal(
    customStage.node.querySelector(".video-demo-player").classList.contains("is-zoom-crop"),
    true
  );

  /* O vídeo personalizado confirmado mantém as mesmas garantias de reprodução. */
  const customIframe = customStage.node.querySelector(".video-demo-iframe");
  assert.ok(customIframe, "iframe do vídeo personalizado ausente");
  assert.match(customIframe.src, /[?&]mute=1(?:&|$)/);
  assert.match(customIframe.src, /[?&]autoplay=0(?:&|$)/);
  assert.match(customIframe.src, /[?&]controls=1(?:&|$)/);

  const officialRecord = app.F.catalog.items("calisthenics").find(i => i.id === "cal-flexao");
  const officialStage = app.F.videos.createStage(officialRecord, "calisthenics");
  assert.equal(officialStage.node.dataset.videoId, "xBrI-N44QLc");
  assert.equal(officialStage.node.dataset.videoFraming, "original");
  assert.equal(
    officialStage.node.querySelector(".video-demo-player").classList.contains("is-zoom-crop"),
    false,
    "zoom/corte jamais pode afetar o vídeo oficial"
  );
  assertNoErrors(app, "short vertical com zoom e corte");
});

await runTest("V7. Dois treinos personalizados com vídeos diferentes para o mesmo exercício", async () => {
  const routineA = routineForExercise("rotina-a", "Treino A", {
    youtubeVideo: {
      videoId: "VideoTreinA",
      title: "Flexão Treino A",
      channelTitle: "Canal A",
      durationSeconds: 25,
      framing: "original"
    }
  });
  const routineB = routineForExercise("rotina-b", "Treino B", {
    youtubeVideo: {
      videoId: "VideoTreinB",
      title: "Flexão Short Treino B",
      channelTitle: "Canal B",
      durationSeconds: 18,
      framing: "zoom"
    }
  });
  const routineC = routineForExercise("rotina-c", "Treino Oficial Sem Override");

  const app = await boot(
    { "forja-treino-rotinas-v1": routinesStore([routineA, routineB, routineC], []) },
    "treino/calistenia.html"
  );

  const exA = app.F.state.routines.calisthenics[0].sections.main[0];
  const exB = app.F.state.routines.calisthenics[1].sections.main[0];
  const exC = app.F.state.routines.calisthenics[2].sections.main[0];

  const resA = app.F.videos.resolve(exA, "calisthenics");
  const resB = app.F.videos.resolve(exB, "calisthenics");
  const resC = app.F.videos.resolve(exC, "calisthenics");

  assert.equal(resA.videoId, "VideoTreinA");
  assert.equal(resA.source, "custom");
  assert.equal(resA.framing, "original");

  assert.equal(resB.videoId, "VideoTreinB");
  assert.equal(resB.source, "custom");
  assert.equal(resB.framing, "zoom");

  assert.equal(resC.videoId, "xBrI-N44QLc");
  assert.equal(resC.source, "official");
  assert.equal(resC.framing, "original");
  assertNoErrors(app, "independência entre rotinas");
});

await runTest("V8. Persistência após recarregar a página (rotina e execução ativa)", async () => {
  const routine = routineForExercise("r-reload", "Treino Reload", {
    youtubeVideo: {
      videoId: "PersistVd01",
      title: "Push-Up Persist",
      channelTitle: "Strength Channel",
      durationSeconds: 32,
      framing: "zoom"
    }
  });
  const ex = routine.sections.main[0];
  const session = {
    version: 2,
    id: "sess-reload",
    date: todayKey(),
    modality: "calisthenics",
    routineId: routine.id,
    routineName: routine.name,
    startedAt: 1000,
    elapsedMs: 0,
    running: true,
    currentIndex: 0,
    completedSets: { [ex.id]: 0 },
    totalPlannedSets: ex.sets,
    queue: [Object.assign({}, ex)],
    status: "active",
    restEndAt: null,
    restRemainingMs: 0,
    restPaused: false,
    pendingAdvance: false,
    restPlannedSeconds: 0,
    setTimer: null,
    setLogs: {},
    logDraft: {}
  };

  const app = await boot(
    {
      "forja-treino-rotinas-v1": routinesStore([routine], []),
      "forja-treino-sessao-ativa-v1": session
    },
    "treino/executar.html",
    { now: 1000 }
  );

  assert.equal(app.$("#execution-demo .video-demo").dataset.videoId, "PersistVd01");
  assert.equal(app.$("#execution-demo .video-demo").dataset.videoFraming, "zoom");
  assert.equal(
    app.$("#execution-demo .video-demo-player").classList.contains("is-zoom-crop"),
    true
  );

  await app.reload();

  assert.equal(
    app.F.state.routines.calisthenics[0].sections.main[0].youtubeVideo.videoId,
    "PersistVd01"
  );
  assert.equal(
    app.F.state.routines.calisthenics[0].sections.main[0].youtubeVideo.framing,
    "zoom"
  );
  assert.equal(app.$("#execution-demo .video-demo").dataset.videoId, "PersistVd01");
  assert.equal(app.$("#execution-demo .video-demo").dataset.videoFraming, "zoom");
  assertNoErrors(app, "persistência após reload");
});

await runTest("V9. Exportação, validação e restauração de backup das escolhas de vídeo", async () => {
  const routine = routineForExercise("r-bkp", "Treino Backup", {
    youtubeVideo: {
      videoId: "BackupVid01",
      title: "Backup Push-Up",
      channelTitle: "Canal Backup",
      durationSeconds: 35,
      framing: "zoom"
    }
  });

  const app = await boot(
    { "forja-treino-rotinas-v1": routinesStore([routine], []) },
    "configuracoes/index.html"
  );

  const backup = app.F.buildBackupObject();
  assert.equal(
    backup.keys["forja-treino-rotinas-v1"].calisthenics[0].sections.main[0].youtubeVideo.videoId,
    "BackupVid01"
  );
  assert.equal(
    backup.keys["forja-treino-rotinas-v1"].calisthenics[0].sections.main[0].youtubeVideo.framing,
    "zoom"
  );

  /* Limpa rotinas e restaura pelo backup. */
  app.set("forja-treino-rotinas-v1", routinesStore([], []));
  await app.importFile(backup);
  app.modalAction("restore");
  await wait(220);

  const restored = app.F.state.routines.calisthenics[0].sections.main[0].youtubeVideo;
  assert.equal(restored.videoId, "BackupVid01");
  assert.equal(restored.framing, "zoom");

  /* Backup com youtubeVideo malformado (ID inválido ou >60s) deve ser rejeitado. */
  const invalidRoutine = routineForExercise("r-bad", "Ruim", {
    youtubeVideo: { videoId: "http://evil", durationSeconds: 180 }
  });
  const badBackup = {
    app: "FORJA",
    format: "forja-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    keys: { "forja-treino-rotinas-v1": routinesStore([invalidRoutine], []) }
  };
  await app.importFile(badBackup);
  await wait(120);
  assert.equal(
    app.F.state.routines.calisthenics[0].sections.main[0].youtubeVideo.videoId,
    "BackupVid01",
    "backup inválido não pode sobrescrever dados válidos"
  );
  assertNoErrors(app, "backup de vídeos");
});

await runTest("V10. Vídeo removido, privado ou com erro cai automaticamente na imagem de referência", async () => {
  const routine = routineForExercise("r-dead", "Treino Removido", {
    youtubeVideo: {
      videoId: "RemovedVd00",
      title: "Vídeo Removido",
      channelTitle: "Canal",
      durationSeconds: 20,
      framing: "original"
    }
  });
  const ex = routine.sections.main[0];

  const app = await boot(
    { "forja-treino-rotinas-v1": routinesStore([routine], []) },
    "treino/biblioteca.html"
  );

  /* Caso 1: probeAvailability detecta vídeo removido/privado (404 ou placeholder). */
  app.F.videos.setAvailabilityChecker(videoId => videoId !== "RemovedVd00");
  const record = app.F.catalog.describeExercise(ex, "calisthenics");
  const stage = app.F.videos.createStage(record, "calisthenics");
  app.d.body.appendChild(stage.node);
  await wait(30);

  assert.equal(stage.node.dataset.videoState, "unavailable");
  assert.equal(stage.node.querySelector(".video-demo-iframe"), null);
  assert.ok(stage.node.querySelector(".demo-media"), "deve exibir a imagem de referência do exercício");
  assert.equal(
    stage.node.querySelector(".demo-media").getAttribute("data-demo-id"),
    "repdb:push-up"
  );
  assert.equal(
    stage.node.querySelector(".video-demo-unavailable").textContent,
    "Vídeo de demonstração ainda não disponível"
  );
  stage.node.remove();

  /* Caso 2: player do YouTube emite postMessage onError (ex.: incorporação desativada). */
  app.F.videos.setAvailabilityChecker(() => true);
  const stage2 = app.F.videos.createStage(record, "calisthenics");
  app.d.body.appendChild(stage2.node);
  assert.equal(stage2.node.dataset.videoState, "ready");

  app.w.dispatchEvent(
    new app.w.MessageEvent("message", {
      origin: "https://www.youtube-nocookie.com",
      data: JSON.stringify({ event: "onError", info: 101, videoId: "RemovedVd00" })
    })
  );
  await wait(20);
  assert.equal(stage2.node.dataset.videoState, "player-error");
  assert.equal(stage2.node.querySelector(".video-demo-iframe"), null);
  assert.ok(stage2.node.querySelector(".demo-media"));
  stage2.node.remove();
  assertNoErrors(app, "fallback de vídeo indisponível");
});

await runTest("V11. Busca sem resultados, falha de conexão com a API e ausência de chave", async () => {
  const routine = routineForExercise("r-erros", "Treino Erros");
  const app = await boot(
    { "forja-treino-rotinas-v1": routinesStore([routine], []) },
    "treino/rotina.html?id=r-erros&modalidade=calisthenics"
  );
  const initialWrites = app.storageWrites.length;

  /* 1. Sem chave configurada: não inventa resultados. */
  app.w.FORJA_YOUTUBE_CONFIG.apiKey = "";
  const unconfigured = await app.F.videos.searchYouTube("Flexão de braço");
  assert.equal(unconfigured.status, "unconfigured");
  assert.equal(unconfigured.items.length, 0);
  assert.match(unconfigured.message, /YouTube Data API v3/);

  /* 2. Busca sem resultados. */
  app.w.FORJA_YOUTUBE_CONFIG.apiKey = "TEST_RESTRICTED_KEY";
  app.F.videos.setSearchFetcher(mockYouTubeApiFetcher([], []));
  app.click(".editor-exercise .video-row-button");
  await wait(40);
  assert.equal(app.$$(".video-result-card").length, 0);
  assert.match(app.text(".video-picker-status"), /Nenhum vídeo curto/i);

  /* 3. Falha de conexão / erro HTTP na API. */
  app.F.videos.setSearchFetcher(async () => {
    throw new Error("Network unreachable");
  });
  app.click(".video-picker-search-btn");
  await wait(40);
  assert.equal(app.$$(".video-result-card").length, 0);
  assert.ok(app.$(".video-picker-status.is-error"), "estado de erro não exibido");
  assert.match(app.text(".video-picker-status"), /Falha de conexão/i);

  app.modalAction("cancel");
  await wait(25);
  assert.equal(app.storageWrites.length, initialWrites, "erros de busca não devem gravar no storage");
  assertNoErrors(app, "estados de busca vazia e erro de API");
});

const failed = results.filter(result => !result.ok);
console.log("\n" + "=".repeat(66));
console.log(
  "VÍDEOS YOUTUBE — " +
    (results.length - failed.length) +
    "/" +
    results.length +
    " testes aprovados"
);
if (failed.length > 0) {
  console.log("Falhas: " + failed.map(item => item.name).join(" | "));
}
console.log("=".repeat(66));
process.exitCode = failed.length > 0 ? 1 : 0;
