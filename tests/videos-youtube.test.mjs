/*
  Suíte do sistema de vídeos de demonstração (YouTube + fallback de referência).

  Cobre:
  - Catálogo oficial, ausência total do antigo sistema 3D e zero chaves no repositório
  - Validação de URLs/IDs, detecção de Shorts, duração <= 60s e orientação confirmada
  - Exercício com vídeo oficial (youtube-nocookie.com, sem autoplay, controles, silencioso)
  - Exercício sem vídeo exibindo imagem de referência + "Vídeo de demonstração ainda não disponível"
  - Fluxo "Procurar vídeo" no editor de rotinas (nomenclatura, busca via proxy,
    carregamento, prévia 16:9, confirmação e persistência)
  - Shorts fora da seleção: pesquisa, link colado e orientação não confirmada
  - Cache local de pesquisas repetidas
  - Dois treinos personalizados com vídeos diferentes para o mesmo exercício
  - Dados antigos com framing "zoom" seguem válidos e são normalizados sem zoom
  - Persistência após recarregar a página (rotina e sessão ativa)
  - Exportação, validação, restauração e desfazer de backup JSON
  - Fallback automático para vídeo removido, privado ou com erro de player
  - Erros: backend sem chave, quota esgotada, backend ausente, rede e busca vazia
  - Modo silencioso (mute=1) em todas as etapas
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

function sessionFor(exercise, routine, id) {
  return {
    version: 2,
    id,
    date: todayKey(),
    modality: "calisthenics",
    routineId: routine.id,
    routineName: routine.name,
    startedAt: 1000,
    elapsedMs: 0,
    running: true,
    currentIndex: 0,
    completedSets: { [exercise.id]: 0 },
    totalPlannedSets: exercise.sets,
    queue: [Object.assign({}, exercise)],
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
}

/* ---------------------- resposta do proxy backend ---------------------- */

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

function horizontalItem(videoId, overrides = {}) {
  return Object.assign(
    {
      videoId,
      title: "Flexão de braço — execução correta",
      channelTitle: "Canal de Treino",
      durationSeconds: 28,
      thumbnailUrl: "https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg",
      orientation: "horizontal",
      aspectRatio: "16:9"
    },
    overrides
  );
}

function searchOk(items, metaOverrides = {}) {
  return {
    status: "ok",
    items,
    meta: Object.assign(
      {
        source: "youtube-data-api-v3",
        transport: "netlify-function",
        maxDurationSeconds: 60,
        orientationPolicy: "horizontal-confirmado",
        cached: false,
        returned: items.length,
        candidates: items.length,
        rejected: { vertical: 0, duration: 0, unconfirmed: 0 },
        quota: {
          unitsUsedToday: 101,
          dailyBudgetUnits: 3000,
          remainingUnitsToday: 2899,
          cacheHitsToday: 0
        }
      },
      metaOverrides
    )
  };
}

/*
  Simula o proxy `/api/youtube-search` (netlify/functions/youtube-search.mjs).
  Nenhuma chave é aceita ou enviada pelo cliente: só o endpoint do próprio domínio.
*/
function mockProxy(options = {}) {
  const calls = [];
  const fetcher = async url => {
    const target = String(url);
    calls.push(target);

    if (options.networkError) throw new Error("Network unreachable");

    /* Hospedagem somente estática: a rota não existe e devolve HTML. */
    if (options.noBackend) {
      return {
        ok: false,
        status: 404,
        async json() {
          throw new Error("Unexpected token '<'");
        }
      };
    }

    if (/[?&]id=/.test(target)) {
      if (!options.inspect) return jsonResponse({ status: "not-found", item: null }, 404);
      return jsonResponse(options.inspect, options.inspectStatus || 200);
    }

    return jsonResponse(options.search || searchOk([]), options.searchStatus || 200);
  };
  fetcher.calls = calls;
  return fetcher;
}

function assertSilentEmbed(src, label) {
  assert.match(src, /^https:\/\/www\.youtube-nocookie\.com\/embed\//, label + ": host de incorporação");
  assert.match(src, /[?&]autoplay=0(?:&|$)/, label + ": autoplay precisa estar desligado");
  assert.match(src, /[?&]controls=1(?:&|$)/, label + ": controles precisam estar visíveis");
  assert.match(src, /[?&]mute=1(?:&|$)/, label + ": vídeo precisa iniciar sem áudio");
}

/* ------------------------------ testes ------------------------------ */

await runTest("V1. Catálogo oficial, sem 3D, sem vídeos locais e sem chave no repositório", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const V = app.w.FORJA_VIDEOS_DATA;
  const cfg = app.w.FORJA_YOUTUBE_CONFIG;

  assert.ok(V && V.exercicios, "FORJA_VIDEOS_DATA ausente");
  assert.equal(V.maxDurationSeconds, 60);
  assert.equal(V.embedHost, "https://www.youtube-nocookie.com");

  /* A chave nunca existe no JavaScript público: só o endpoint do próprio domínio. */
  assert.equal(cfg.apiKey, undefined, "nenhuma chave de API pode existir na configuração pública");
  assert.equal(cfg.endpoint, "/api/youtube-search", "endpoint padrão do proxy backend");
  assert.equal(app.F.videos.searchEndpoint(), "/api/youtube-search");
  assert.equal(app.F.videos.hasSearchCredentials(), true);
  assert.equal(app.F.videos.DEFAULT_SEARCH_ENDPOINT, "/api/youtube-search");

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
      assert.equal(entry.aspectRatio, "16:9", "vídeo oficial precisa ser 16:9 em " + key);
      const resolved = app.F.videos.officialFor(item, item.mode);
      assert.equal(resolved.framing, "original", "vídeo oficial deve manter enquadramento original");
      assert.equal(resolved.orientation, "horizontal");
    }
  });
  assert.ok(withVideo >= 20 && withoutVideo >= 5);
  app.close();

  /* Nenhum componente do antigo sistema 3D existe no projeto. */
  assert.equal(fs.existsSync(path.join(repoRoot, "assets/3d")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "assets/vendor/three")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "assets/js/forja-personagens.js")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "avaliacao-piloto-3d")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "FORJA_ASSETS_3D")), false);

  /* Nenhum vídeo baixado no repositório. */
  const walkBinary = dir => {
    let found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found = found.concat(walkBinary(full));
      else if (/\.(mp4|webm|mkv|mov|glb)$/i.test(entry.name)) found.push(full);
    }
    return found;
  };
  assert.deepEqual(walkBinary(path.join(repoRoot, "assets")), []);

  /*
    Varredura de segredos: nenhuma chave no formato do Google em qualquer arquivo
    de texto versionável (`.env*`, que é ignorado pelo Git, fica de fora).
  */
  const KEY_PATTERN = /AIza[0-9A-Za-z_-]{35}/;
  const TEXT_EXTENSIONS = /\.(js|mjs|cjs|html|css|json|md|toml|ya?ml|txt|svg|webmanifest)$/i;
  const offenders = [];
  const walkText = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkText(full);
      else if (TEXT_EXTENSIONS.test(entry.name) && !/(^|\/)\.env/.test(full)) {
        const content = fs.readFileSync(full, "utf8");
        if (KEY_PATTERN.test(content)) offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  walkText(repoRoot);
  assert.deepEqual(offenders, [], "chave de API encontrada em arquivos do repositório");

  /* A chave só pode vir do ambiente do backend, e `.env` nunca é versionado. */
  const fnSource = fs.readFileSync(
    path.join(repoRoot, "netlify/functions/youtube-search.mjs"),
    "utf8"
  );
  assert.match(fnSource, /readConfig\(env = process\.env\)/, "a Function precisa ler o ambiente do servidor");
  assert.match(fnSource, /env\.YOUTUBE_API_KEY/, "a chave vem de YOUTUBE_API_KEY");
  assert.equal(KEY_PATTERN.test(fnSource), false, "nenhuma chave literal na Function");

  const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.env$/m, ".gitignore precisa ignorar .env");
  assert.match(gitignore, /^\.env\.\*$/m, ".gitignore precisa ignorar .env.*");
  assert.match(gitignore, /^!\.env\.example$/m, "modelo sem valores continua versionado");
  assert.ok(fs.existsSync(path.join(repoRoot, ".env.example")), ".env.example ausente");
  assert.equal(
    KEY_PATTERN.test(fs.readFileSync(path.join(repoRoot, ".env.example"), "utf8")),
    false,
    ".env.example não pode conter chave real"
  );

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

await runTest("V2. URLs, IDs, Shorts bloqueados, duração <= 60s e orientação confirmada", async () => {
  const app = await boot({}, "index.html");
  const F = app.F;

  const plain = value => JSON.parse(JSON.stringify(value));

  assert.deepEqual(plain(F.parseYouTubeUrl("xBrI-N44QLc")), { videoId: "xBrI-N44QLc", isShort: false });
  assert.deepEqual(plain(F.parseYouTubeUrl("https://www.youtube.com/watch?v=xBrI-N44QLc&t=5s")), {
    videoId: "xBrI-N44QLc",
    isShort: false
  });
  assert.deepEqual(plain(F.parseYouTubeUrl("https://youtu.be/vkwdKKJBJXA")), {
    videoId: "vkwdKKJBJXA",
    isShort: false
  });
  assert.deepEqual(plain(F.parseYouTubeUrl("https://www.youtube-nocookie.com/embed/9A6NPVPzkqQ")), {
    videoId: "9A6NPVPzkqQ",
    isShort: false
  });

  /* Shorts são reconhecidos pelo endereço e ficam bloqueados na seleção. */
  assert.deepEqual(plain(F.parseYouTubeUrl("https://www.youtube.com/shorts/mwlp75MS6Rg")), {
    videoId: "mwlp75MS6Rg",
    isShort: true
  });
  assert.equal(F.isYouTubeShortsUrl("https://www.youtube.com/shorts/mwlp75MS6Rg"), true);
  assert.equal(F.isYouTubeShortsUrl("https://m.youtube.com/shorts/mwlp75MS6Rg?feature=share"), true);
  assert.equal(F.isYouTubeShortsUrl("https://www.youtube.com/watch?v=mwlp75MS6Rg"), false);
  assert.equal(F.isYouTubeShortsUrl("texto qualquer"), false);

  assert.equal(F.parseYouTubeUrl("javascript:alert(1)"), null);
  assert.equal(F.parseYouTubeUrl("https://evil.example.com/watch?v=xBrI-N44QLc"), null);
  assert.equal(F.parseYouTubeUrl("https://www.youtube.com/playlist?list=PL1234567890"), null);
  assert.equal(F.parseYouTubeUrl("https://www.youtube.com/live/xBrI-N44QLc"), null);
  assert.equal(F.parseYouTubeUrl("curto"), null);

  assert.equal(F.parseIsoDurationSeconds("PT42S"), 42);
  assert.equal(F.parseIsoDurationSeconds("PT1M"), 60);
  assert.equal(F.parseIsoDurationSeconds("PT1M1S"), 61);

  assert.equal(F.normalizeYouTubeVideo({ videoId: "xBrI-N44QLc", durationSeconds: 61 }), null,
    "deve rejeitar vídeos acima de 60s");
  assert.equal(F.normalizeYouTubeVideo({ videoId: "xBrI-N44QLc", durationSeconds: 60 }).durationSeconds, 60,
    "60 segundos continuam aceitos");
  assert.equal(F.isValidYouTubeVideoShape({ videoId: "xBrI-N44QLc", framing: "stretch" }), false,
    "deve rejeitar enquadramento deformado");
  assert.deepEqual(Array.from(F.YOUTUBE_FRAMING_VALUES), ["original"], "único enquadramento produzido é o original");

  /* Legado: "zoom" continua aceito na leitura, mas nunca é reproduzido. */
  assert.equal(F.isValidYouTubeVideoShape({ videoId: "xBrI-N44QLc", framing: "zoom" }), true,
    "dados antigos com zoom não podem invalidar a rotina");
  assert.equal(F.normalizeYouTubeVideo({ videoId: "xBrI-N44QLc", framing: "zoom" }).framing, "original",
    "zoom legado é normalizado para o enquadramento original");
  assert.equal(F.isValidYouTubeVideoShape({ videoId: "xBrI-N44QLc", orientation: "horizontal" }), false,
    "campo de orientação não faz parte do dado persistido");

  /* Orientação horizontal confirmada é obrigatória para oferecer um resultado. */
  assert.equal(F.isConfirmedHorizontalVideo(horizontalItem("HorizVid001")), true);
  assert.equal(F.isConfirmedHorizontalVideo(Object.assign(horizontalItem("HorizVid002"), { orientation: "vertical" })), false);
  assert.equal(F.isConfirmedHorizontalVideo(Object.assign(horizontalItem("HorizVid003"), { orientation: "unknown" })), false);
  assert.equal(F.isConfirmedHorizontalVideo({ videoId: "HorizVid004", durationSeconds: 20 }), false,
    "sem declaração de orientação não há confirmação");
  assert.equal(
    F.isConfirmedHorizontalVideo(Object.assign(horizontalItem("HorizVid005"), {
      thumbnails: { high: { width: 480, height: 640 } }
    })),
    false,
    "miniatura vertical derruba a confirmação"
  );
  assert.equal(
    F.isConfirmedHorizontalVideo(Object.assign(horizontalItem("HorizVid006"), { title: "Dica #shorts" })),
    false,
    "marcador de Short derruba a confirmação"
  );
  assert.equal(F.hasYouTubeShortsMarker("Olha o #shorts", ""), true);
  assert.equal(F.hasYouTubeShortsMarker("https://www.youtube.com/shorts/abc"), true);
  assert.equal(F.hasYouTubeShortsMarker("Treino de flexão completo"), false);
  assertNoErrors(app, "validação de vídeos");
});

await runTest("V3. Vídeo oficial: youtube-nocookie, sem autoplay, controles, silencioso e enquadramento original", async () => {
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
  assert.equal(player.classList.contains("is-zoom-crop"), false, "nenhum zoom/corte pode existir");
  assert.equal(app.$(".video-picker-framing"), null, "controle de enquadramento removido");
  assert.equal(app.$('[data-framing-option="zoom"]'), null, "opção de zoom removida");

  const iframe = app.$(".modal-details .video-demo-iframe");
  assert.ok(iframe, "iframe do YouTube ausente");
  assertSilentEmbed(iframe.src, "vídeo oficial na biblioteca");
  assert.equal(app.$(".modal-details .video-demo-unavailable").hidden, true);
  assert.match(app.text(".modal-details .video-demo-badge"), /Vídeo demonstrativo/);

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
  const app = await boot(
    {
      "forja-treino-rotinas-v1": routinesStore([routine], []),
      "forja-treino-sessao-ativa-v1": sessionFor(ex, routine, "sess-polichinelo")
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

await runTest("V5. 'Procurar vídeo': nomenclatura, identificação, busca, carregamento, prévia e confirmação", async () => {
  const routine = routineForExercise("r-busca", "Treino Busca");
  const app = await boot(
    { "forja-treino-rotinas-v1": routinesStore([routine], []) },
    "treino/rotina.html?id=r-busca&modalidade=calisthenics"
  );

  const proxy = mockProxy({
    search: searchOk([
      horizontalItem("CustVideo01", { title: "Push-Up Clean Form Tutorial", channelTitle: "Coach Lab", durationSeconds: 28 }),
      horizontalItem("CustVideo02", { title: "Flexão em 45 segundos", channelTitle: "Canal Curto", durationSeconds: 45 })
    ])
  });
  app.F.videos.setSearchFetcher(proxy);

  app.click(".editor-exercise .video-row-button");
  await wait(50);

  /* Nomenclatura padronizada e identificação do exercício selecionado. */
  assert.ok(app.$(".video-picker"), "modal Procurar vídeo não abriu");
  assert.equal(app.text("#modal-title"), "Procurar vídeo");
  assert.equal(app.text(".video-picker-exercise-name"), "Flexão de braço");
  assert.match(app.text(".modal-message"), /Flexão de braço/);
  assert.match(app.text(".modal-message"), /treino personalizado/);
  assert.equal(app.$(".video-picker-query").value, "Flexão de braço");
  assert.match(app.text(".video-picker-intro"), /horizontal \(16:9\)/);
  assert.match(app.text(".video-picker-intro"), /60 segundos/);
  assert.match(app.text(".video-picker-intro"), /somente para este treino personalizado/);
  assert.equal(app.text('[data-modal-action="cancel"]'), "Cancelar");
  assert.equal(app.text('[data-modal-action="confirm"]'), "Confirmar vídeo");
  assert.equal(app.$('[data-modal-action="clear"]'), null, "'Usar vídeo padrão' só com vídeo atual");

  /* A pesquisa foi feita pelo proxy do próprio domínio, sem chave no cliente. */
  assert.equal(proxy.calls.length, 1);
  assert.match(proxy.calls[0], /^\/api\/youtube-search\?/);
  assert.match(proxy.calls[0], /q=Flex%C3%A3o%20de%20bra%C3%A7o/);
  assert.equal(/key=|apiKey=/i.test(proxy.calls[0]), false, "cliente não envia chave nenhuma");

  const cards = app.$$(".video-result-card");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].dataset.videoId, "CustVideo01");
  assert.equal(cards[0].dataset.videoOrientation, "horizontal");
  assert.match(cards[0].textContent, /Push-Up Clean Form Tutorial/);
  assert.match(cards[0].textContent, /Coach Lab/);
  assert.match(cards[0].textContent, /0:28/);
  assert.match(cards[0].textContent, /Horizontal 16:9/);
  assert.match(cards[0].textContent, /Visualizar/, "cada resultado oferece o botão Visualizar");

  /* Confirmar antes de visualizar é bloqueado. */
  app.modalAction("confirm");
  await wait(20);
  assert.ok(app.$(".modal-backdrop"), "não deve confirmar sem vídeo selecionado");
  assert.match(app.text(".video-picker-error"), /Selecione e visualize/);

  /* Visualizar abre a prévia 16:9 silenciosa antes de confirmar. */
  app.click('.video-result-card[data-video-id="CustVideo01"]');
  await wait(20);
  const previewIframe = app.$(".video-picker-preview-iframe");
  assert.ok(previewIframe, "prévia do vídeo não apareceu antes de confirmar");
  assertSilentEmbed(previewIframe.src, "prévia no seletor");
  assert.match(app.text(".video-picker-preview-meta"), /Coach Lab/);
  assert.match(app.text(".video-picker-preview-meta"), /0:28/);
  assert.match(app.text(".video-picker-preview-meta"), /Horizontal 16:9/);
  assert.equal(app.$(".video-picker-framing"), null, "nenhum controle de enquadramento no seletor");
  assert.equal(cards[0].getAttribute("aria-selected"), "true");

  app.modalAction("confirm");
  await wait(30);
  assert.equal(app.$(".modal-backdrop"), null, "modal não fechou após confirmar");

  app.click("#save-routine-top");
  await wait(40);

  const saved = app.data(app.F.KEYS.routines).calisthenics[0].sections.main[0];
  assert.equal(saved.youtubeVideo.videoId, "CustVideo01");
  assert.equal(saved.youtubeVideo.title, "Push-Up Clean Form Tutorial");
  assert.equal(saved.youtubeVideo.channelTitle, "Coach Lab");
  assert.equal(saved.youtubeVideo.durationSeconds, 28);
  assert.equal(saved.youtubeVideo.framing, "original");
  assert.equal(saved.youtubeVideo.orientation, undefined, "orientação não é persistida");
  assert.match(app.text(".editor-exercise-meta"), /Vídeo personalizado/);
  assert.equal(/zoom/i.test(app.text(".editor-exercise-meta")), false, "meta não menciona zoom");

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

await runTest("V6. Shorts fora da seleção: pesquisa, link colado e orientação não confirmada", async () => {
  const routine = routineForExercise("r-shorts", "Treino Sem Shorts");
  const app = await boot(
    { "forja-treino-rotinas-v1": routinesStore([routine], []) },
    "treino/rotina.html?id=r-shorts&modalidade=calisthenics"
  );

  /* 1. O proxy já não devolve verticais; e o cliente recusa o que não for confirmado. */
  const proxy = mockProxy({
    search: searchOk(
      [horizontalItem("HorizVid001", { title: "Flexão horizontal", durationSeconds: 24 })],
      { rejected: { vertical: 2, duration: 1, unconfirmed: 1 }, candidates: 5, returned: 1 }
    )
  });
  app.F.videos.setSearchFetcher(proxy);

  app.click(".editor-exercise .video-row-button");
  await wait(50);

  const cards = app.$$(".video-result-card");
  assert.equal(cards.length, 1, "somente o vídeo horizontal confirmado entra na lista");
  assert.equal(cards[0].dataset.videoId, "HorizVid001");
  assert.equal(/Short/i.test(app.text(".video-picker-results")), false,
    "lista de resultados não anuncia Shorts");

  /* Itens verticais ou não confirmados que chegassem do backend são descartados. */
  const vertical = await app.F.videos.searchYouTube("flexao vertical", {});
  assert.equal(vertical.status, "ok");
  app.F.videos.setSearchFetcher(
    mockProxy({
      search: {
        status: "ok",
        items: [
          Object.assign(horizontalItem("ShortVert01"), { orientation: "vertical" }),
          Object.assign(horizontalItem("UnknownVid1"), { orientation: "unknown" }),
          { videoId: "NoOrient001", title: "Sem orientação", durationSeconds: 20 },
          Object.assign(horizontalItem("LongVid0001"), { durationSeconds: 120 }),
          horizontalItem("AprovadoVd1")
        ],
        meta: { source: "youtube-data-api-v3" }
      }
    })
  );
  const filtered = await app.F.videos.searchYouTube("flexao filtrada");
  assert.deepEqual(Array.from(filtered.items).map(item => item.videoId), ["AprovadoVd1"],
    "vertical, não confirmado, sem orientação e acima de 60s devem ser descartados");

  /* 2. Link de Short colado: bloqueado sem chamar o backend. */
  const callsBefore = proxy.calls.length;
  app.$(".video-picker-url-input").value = "https://www.youtube.com/shorts/mwlp75MS6Rg";
  app.click(".video-picker-url-btn");
  await wait(30);
  assert.match(app.text(".video-picker-error"), /YouTube Shorts não são aceitos/);
  assert.equal(app.$(".video-picker-preview-iframe"), null, "Short não pode ganhar prévia");
  app.modalAction("confirm");
  await wait(20);
  assert.ok(app.$(".modal-backdrop"), "não pode confirmar um Short");

  /* 3. Link convencional aprovado pela inspeção do backend. */
  app.F.videos.setSearchFetcher(
    mockProxy({ inspect: { status: "ok", item: horizontalItem("LinkColad01", { title: "Flexão colada" }) } })
  );
  app.$(".video-picker-url-input").value = "https://www.youtube.com/watch?v=LinkColad01";
  app.click(".video-picker-url-btn");
  await wait(30);
  assert.equal(app.$(".video-picker-error").hidden, true);
  const pastedPreview = app.$(".video-picker-preview-iframe");
  assert.ok(pastedPreview, "vídeo convencional colado deve ganhar prévia");
  assertSilentEmbed(pastedPreview.src, "prévia de link colado");

  /* 4. Short disfarçado de link watch?v= : o backend identifica e o cliente bloqueia. */
  app.F.videos.setSearchFetcher(mockProxy({ inspect: { status: "vertical", item: null } }));
  app.$(".video-picker-url-input").value = "https://www.youtube.com/watch?v=ShortVert01";
  app.click(".video-picker-url-btn");
  await wait(30);
  assert.match(app.text(".video-picker-error"), /YouTube Shorts não são aceitos/);

  /* 5. Orientação não confirmada também não é liberada. */
  app.F.videos.setSearchFetcher(mockProxy({ inspect: { status: "unconfirmed", item: null } }));
  app.$(".video-picker-url-input").value = "https://youtu.be/UnknownVid1";
  app.click(".video-picker-url-btn");
  await wait(30);
  assert.match(app.text(".video-picker-error"), /Não foi possível confirmar que este vídeo é horizontal/);

  /* 6. Vídeo longo é recusado. */
  app.F.videos.setSearchFetcher(mockProxy({ inspect: { status: "duration", item: null } }));
  app.$(".video-picker-url-input").value = "https://youtu.be/LongVid0001";
  app.click(".video-picker-url-btn");
  await wait(30);
  assert.match(app.text(".video-picker-error"), /mais de 60 segundos/);

  /* 7. Sem backend: só a confirmação local de geometria libera o vídeo. */
  app.F.videos.setSearchFetcher(mockProxy({ noBackend: true }));
  app.F.videos.setOrientationProber(() => "unknown");
  app.$(".video-picker-url-input").value = "https://youtu.be/SemConfirm1";
  app.click(".video-picker-url-btn");
  await wait(30);
  assert.match(app.text(".video-picker-error"), /Não foi possível confirmar/);

  app.F.videos.setOrientationProber(() => "vertical");
  app.$(".video-picker-url-input").value = "https://youtu.be/VerticalPr1";
  app.click(".video-picker-url-btn");
  await wait(30);
  assert.match(app.text(".video-picker-error"), /YouTube Shorts não são aceitos/);

  app.F.videos.setOrientationProber(() => "horizontal");
  app.$(".video-picker-url-input").value = "https://youtu.be/HorizLocal1";
  app.click(".video-picker-url-btn");
  await wait(30);
  assert.ok(app.$(".video-picker-preview-iframe"), "vídeo horizontal confirmado localmente é liberado");

  /* 8. Link inválido continua recusado. */
  app.$(".video-picker-url-input").value = "https://vimeo.com/12345678";
  app.click(".video-picker-url-btn");
  await wait(30);
  assert.match(app.text(".video-picker-error"), /Link inválido/);
  assert.ok(callsBefore >= 0);

  app.modalAction("cancel");
  await wait(25);
  assert.equal(app.data(app.F.KEYS.routines).calisthenics[0].sections.main[0].youtubeVideo, undefined,
    "cancelar não grava vídeo");
  assertNoErrors(app, "shorts bloqueados");
});

await runTest("V7. Cache local: pesquisa repetida não consulta o backend de novo", async () => {
  const app = await boot({}, "treino/biblioteca.html");
  const proxy = mockProxy({
    search: searchOk([horizontalItem("Cacheado001", { title: "Flexão cacheada" })])
  });
  app.F.videos.setSearchFetcher(proxy);

  const first = await app.F.videos.searchYouTube("flexão de braço");
  assert.equal(first.status, "ok");
  assert.equal(first.cached, false);
  assert.equal(proxy.calls.length, 1);

  const second = await app.F.videos.searchYouTube("Flexão de Braço");
  assert.equal(second.cached, true, "mesma consulta (normalizada) sai do cache");
  assert.equal(proxy.calls.length, 1, "consulta repetida não pode gerar nova requisição");
  assert.deepEqual(Array.from(second.items).map(i => i.videoId), ["Cacheado001"]);

  const third = await app.F.videos.searchYouTube("flexão de braço", { refresh: true });
  assert.equal(third.cached, false);
  assert.equal(proxy.calls.length, 2, "refresh força nova consulta");

  const other = await app.F.videos.searchYouTube("agachamento livre");
  assert.equal(other.cached, false);
  assert.equal(proxy.calls.length, 3, "termo diferente consulta de novo");

  /* Consultas simultâneas iguais compartilham uma única requisição. */
  app.F.videos.clearSearchCache();
  const before = proxy.calls.length;
  const [a, b] = await Promise.all([
    app.F.videos.searchYouTube("prancha frontal"),
    app.F.videos.searchYouTube("prancha frontal")
  ]);
  assert.equal(proxy.calls.length - before, 1, "pesquisas simultâneas iguais são deduplicadas");
  assert.equal(a.items.length, 1);
  assert.deepEqual(b.items, a.items);

  assert.equal(app.F.videos.searchCacheStats().entries > 0, true);
  app.F.videos.clearSearchCache();
  assert.equal(app.F.videos.searchCacheStats().entries, 0);

  /* Consulta vazia não gera requisição. */
  const empty = await app.F.videos.searchYouTube("   ");
  assert.equal(empty.status, "empty-query");
  assert.equal(empty.items.length, 0);
  assertNoErrors(app, "cache de pesquisas");
});

await runTest("V8. Dois treinos personalizados com vídeos diferentes para o mesmo exercício", async () => {
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
      title: "Flexão Treino B",
      channelTitle: "Canal B",
      durationSeconds: 18,
      framing: "original"
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
  assert.equal(resB.framing, "original");

  assert.equal(resC.videoId, "xBrI-N44QLc");
  assert.equal(resC.source, "official");
  assert.equal(resC.framing, "original");
  assertNoErrors(app, "independência entre rotinas");
});

await runTest("V9. Dados antigos com framing 'zoom' continuam válidos e tocam sem zoom/corte", async () => {
  const routine = routineForExercise("r-legado", "Treino Legado", {
    youtubeVideo: {
      videoId: "LegadoZoom1",
      title: "Vídeo antigo com zoom",
      channelTitle: "Canal Antigo",
      durationSeconds: 18,
      framing: "zoom"
    }
  });
  const ex = routine.sections.main[0];

  const app = await boot(
    {
      "forja-treino-rotinas-v1": routinesStore([routine], []),
      "forja-treino-sessao-ativa-v1": sessionFor(ex, routine, "sess-legado")
    },
    "treino/executar.html",
    { now: 1000 }
  );

  /* A rotina antiga não é descartada: o vídeo continua lá, sem o recurso removido. */
  const loaded = app.F.state.routines.calisthenics[0].sections.main[0];
  assert.equal(loaded.youtubeVideo.videoId, "LegadoZoom1");
  assert.equal(loaded.youtubeVideo.framing, "original", "zoom legado é normalizado");

  const stage = app.$("#execution-demo .video-demo");
  assert.equal(stage.dataset.videoState, "ready");
  assert.equal(stage.dataset.videoId, "LegadoZoom1");
  assert.equal(stage.dataset.videoFraming, "original");
  assert.equal(app.$("#execution-demo .video-demo-player").classList.contains("is-zoom-crop"), false);
  assertSilentEmbed(app.$("#execution-demo .video-demo-iframe").src, "vídeo legado na execução");
  assert.match(app.text("#execution-demo .video-demo-badge"), /Vídeo do treino/);

  /* O seletor abre com o vídeo legado já selecionado e sem opção de zoom. */
  await app.go("/forja/treino/rotina.html?id=r-legado&modalidade=calisthenics");
  app.click(".editor-exercise .video-row-button");
  await wait(30);
  assert.ok(app.$(".video-picker-preview-iframe"), "prévia do vídeo legado ausente");
  assert.equal(app.$('[data-framing-option="zoom"]'), null);
  assert.equal(app.text('[data-modal-action="clear"]'), "Usar vídeo padrão");
  assertSilentEmbed(app.$(".video-picker-preview-iframe").src, "prévia do vídeo legado");

  /* "Usar vídeo padrão" devolve o vídeo oficial do exercício. */
  app.modalAction("clear");
  await wait(30);
  app.click("#save-routine-top");
  await wait(40);
  assert.equal(
    app.data(app.F.KEYS.routines).calisthenics[0].sections.main[0].youtubeVideo,
    undefined,
    "vídeo personalizado removido volta ao oficial do catálogo"
  );
  assertNoErrors(app, "legado com zoom");
});

await runTest("V10. Persistência após recarregar a página (rotina e execução ativa)", async () => {
  const routine = routineForExercise("r-reload", "Treino Reload", {
    youtubeVideo: {
      videoId: "PersistVd01",
      title: "Push-Up Persist",
      channelTitle: "Strength Channel",
      durationSeconds: 32,
      framing: "original"
    }
  });
  const ex = routine.sections.main[0];

  const app = await boot(
    {
      "forja-treino-rotinas-v1": routinesStore([routine], []),
      "forja-treino-sessao-ativa-v1": sessionFor(ex, routine, "sess-reload")
    },
    "treino/executar.html",
    { now: 1000 }
  );

  assert.equal(app.$("#execution-demo .video-demo").dataset.videoId, "PersistVd01");
  assert.equal(app.$("#execution-demo .video-demo").dataset.videoFraming, "original");
  assert.equal(app.$("#execution-demo .video-demo").dataset.videoSource, "custom");

  await app.reload();

  assert.equal(
    app.F.state.routines.calisthenics[0].sections.main[0].youtubeVideo.videoId,
    "PersistVd01"
  );
  assert.equal(app.$("#execution-demo .video-demo").dataset.videoId, "PersistVd01");
  assertSilentEmbed(app.$("#execution-demo .video-demo-iframe").src, "vídeo personalizado após reload");
  assertNoErrors(app, "persistência após reload");
});

await runTest("V11. Exportação, validação e restauração de backup das escolhas de vídeo", async () => {
  const routine = routineForExercise("r-bkp", "Treino Backup", {
    youtubeVideo: {
      videoId: "BackupVid01",
      title: "Backup Push-Up",
      channelTitle: "Canal Backup",
      durationSeconds: 35,
      framing: "original"
    }
  });
  const legacy = routineForExercise("r-bkp-legado", "Treino Backup Legado", {
    youtubeVideo: {
      videoId: "LegacyBkp01",
      title: "Backup antigo",
      channelTitle: "Canal Antigo",
      durationSeconds: 20,
      framing: "zoom"
    }
  });

  const app = await boot(
    { "forja-treino-rotinas-v1": routinesStore([routine, legacy], []) },
    "configuracoes/index.html"
  );

  const backup = app.F.buildBackupObject();
  assert.equal(
    backup.keys["forja-treino-rotinas-v1"].calisthenics[0].sections.main[0].youtubeVideo.videoId,
    "BackupVid01"
  );
  assert.equal(
    backup.keys["forja-treino-rotinas-v1"].calisthenics[1].sections.main[0].youtubeVideo.videoId,
    "LegacyBkp01",
    "backup de rotina antiga com zoom continua exportando"
  );

  app.set("forja-treino-rotinas-v1", routinesStore([], []));
  await app.importFile(backup);
  app.modalAction("restore");
  await wait(220);

  const restored = app.F.state.routines.calisthenics[0].sections.main[0].youtubeVideo;
  assert.equal(restored.videoId, "BackupVid01");
  assert.equal(restored.framing, "original");
  const restoredLegacy = app.F.state.routines.calisthenics[1].sections.main[0].youtubeVideo;
  assert.equal(restoredLegacy.videoId, "LegacyBkp01", "rotina antiga não pode ser perdida");
  assert.equal(restoredLegacy.framing, "original", "zoom legado normalizado na restauração");

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
  await wait(140);
  assert.equal(
    app.F.state.routines.calisthenics[0].sections.main[0].youtubeVideo.videoId,
    "BackupVid01",
    "backup inválido não pode sobrescrever dados válidos"
  );
  assertNoErrors(app, "backup de vídeos");
});

await runTest("V12. Vídeo removido, privado ou com erro cai automaticamente na imagem de referência", async () => {
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
  assert.equal(stage.node.querySelector(".demo-media").getAttribute("data-demo-id"), "repdb:push-up");
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

await runTest("V13. Erros da busca: sem chave no backend, quota, backend ausente, rede e sem resultados", async () => {
  const routine = routineForExercise("r-erros", "Treino Erros");
  const app = await boot(
    { "forja-treino-rotinas-v1": routinesStore([routine], []) },
    "treino/rotina.html?id=r-erros&modalidade=calisthenics"
  );
  const initialWrites = app.storageWrites.length;

  /* 1. Backend sem YOUTUBE_API_KEY: nada é inventado. */
  app.F.videos.setSearchFetcher(
    mockProxy({
      search: { status: "unconfigured", error: "A busca de vídeos não está configurada neste ambiente: defina YOUTUBE_API_KEY no backend." },
      searchStatus: 503
    })
  );
  const unconfigured = await app.F.videos.searchYouTube("Flexão de braço");
  assert.equal(unconfigured.status, "unconfigured");
  assert.equal(unconfigured.items.length, 0);
  assert.match(unconfigured.message, /YOUTUBE_API_KEY/);

  /* 2. Quota diária esgotada. */
  app.F.videos.setSearchFetcher(
    mockProxy({ search: { status: "quota", error: "Orçamento diário atingido." }, searchStatus: 429 })
  );
  const quota = await app.F.videos.searchYouTube("agachamento livre");
  assert.equal(quota.status, "quota");
  assert.match(quota.message, /Orçamento diário/);

  /* 3. Falha de rede. */
  app.F.videos.setSearchFetcher(mockProxy({ networkError: true }));
  const offline = await app.F.videos.searchYouTube("remada curvada");
  assert.equal(offline.status, "error");
  assert.match(offline.message, /Falha de conexão/);

  /* 4. Backend inexistente (hospedagem somente estática). */
  app.F.videos.setSearchFetcher(mockProxy({ noBackend: true }));
  const noBackend = await app.F.videos.searchYouTube("desenvolvimento ombros");
  assert.equal(noBackend.status, "unavailable");
  assert.match(noBackend.message, /backend ausente/);

  /* 5. Busca sem resultados na interface. */
  app.F.videos.setSearchFetcher(mockProxy({ search: searchOk([], { returned: 0, candidates: 3 }) }));
  app.click(".editor-exercise .video-row-button");
  await wait(50);
  assert.equal(app.$$(".video-result-card").length, 0);
  assert.ok(app.$(".video-picker-status.is-empty"), "estado vazio não exibido");
  assert.match(app.text(".video-picker-status"), /Nenhum vídeo convencional horizontal/i);
  assert.match(app.text(".video-picker-empty"), /60 segundos/i);

  /* 6. Erro HTTP na busca, com o estado visível no modal. */
  app.F.videos.setSearchFetcher(mockProxy({ networkError: true }));
  app.$(".video-picker-query").value = "burpee completo";
  app.click(".video-picker-search-btn");
  await wait(40);
  assert.equal(app.$$(".video-result-card").length, 0);
  assert.ok(app.$(".video-picker-status.is-error"), "estado de erro não exibido");
  assert.match(app.text(".video-picker-status"), /Falha de conexão/i);

  app.modalAction("cancel");
  await wait(25);
  assert.equal(app.storageWrites.length, initialWrites, "erros de busca não devem gravar no storage");
  assertNoErrors(app, "estados de busca vazia e erro");
});

await runTest("V14. Modo silencioso em todas as etapas (mute=1, autoplay=0, controles visíveis)", async () => {
  const routine = routineForExercise("r-mudo", "Treino Mudo", {
    youtubeVideo: {
      videoId: "MudoCustom1",
      title: "Vídeo personalizado",
      channelTitle: "Canal",
      durationSeconds: 22,
      framing: "original"
    }
  });
  const ex = routine.sections.main[0];

  /* Execução do treino com vídeo personalizado. */
  const app = await boot(
    {
      "forja-treino-rotinas-v1": routinesStore([routine], []),
      "forja-treino-sessao-ativa-v1": sessionFor(ex, routine, "sess-mudo")
    },
    "treino/executar.html",
    { now: 1000 }
  );
  assertSilentEmbed(app.$("#execution-demo .video-demo-iframe").src, "execução do treino");
  app.close();

  /* Biblioteca: vídeo oficial. */
  const lib = await boot({}, "treino/biblioteca.html");
  const flexao = lib.F.catalog.items("calisthenics").find(i => i.id === "cal-flexao");
  lib.F.catalog.showDetail(flexao, { readOnly: true });
  await wait(30);
  assertSilentEmbed(lib.$(".modal-details .video-demo-iframe").src, "detalhe da biblioteca");
  lib.modalAction("cancel");
  await wait(20);
  assert.equal(
    lib.F.videos.buildEmbedUrl("xBrI-N44QLc"),
    "https://www.youtube-nocookie.com/embed/xBrI-N44QLc" +
      "?autoplay=0&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&mute=1"
  );
  lib.close();

  /* Seletor: prévia antes da confirmação. */
  const picker = await boot(
    { "forja-treino-rotinas-v1": routinesStore([routine], []) },
    "treino/rotina.html?id=r-mudo&modalidade=calisthenics"
  );
  picker.F.videos.setSearchFetcher(
    mockProxy({ search: searchOk([horizontalItem("MudoBusca01", { title: "Flexão silenciosa" })]) })
  );
  picker.click(".editor-exercise .video-row-button");
  await wait(50);
  picker.click('.video-result-card[data-video-id="MudoBusca01"]');
  await wait(20);
  assertSilentEmbed(picker.$(".video-picker-preview-iframe").src, "prévia da pesquisa");
  assert.match(picker.text(".video-picker-preview-hint"), /sem áudio/);
  assert.match(picker.text(".video-picker-preview-hint"), /sem reprodução automática/);

  /* Nenhum <video> ou <audio> com som é criado em nenhum ponto. */
  assert.equal(picker.$$("video").length, 0);
  assert.equal(picker.$$("audio").length, 0);
  picker.modalAction("cancel");
  await wait(20);
  assertNoErrors(picker, "modo silencioso");
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
