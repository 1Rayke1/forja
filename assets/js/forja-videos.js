/*
  FORJA — demonstrações em vídeo (YouTube oficial + fallback de referência).

  Ordem de prioridade da demonstração:
  1. Vídeo personalizado associado ao exercício dentro da rotina específica.
  2. Vídeo oficial do exercício no catálogo (`FORJA_VIDEOS_DATA`).
  3. Imagem de referência correspondente do exercício (`F.demos`) acompanhada
     do aviso discreto "Vídeo de demonstração ainda não disponível".

  Garantias:
  - Reprodução somente via `youtube-nocookie.com/embed/...` em proporção 16:9,
    com controles visíveis (`controls=1`) e sem autoplay (`autoplay=0`).
  - Nenhum vídeo é baixado para o repositório; nenhum personagem 3D ou tela
    vazia/quebrada é exibido quando um vídeo não existe ou falha.
  - A busca via YouTube Data API v3 usa chave restrita configurável em
    `window.FORJA_YOUTUBE_CONFIG` (sem segredos hardcoded e sem resultados
    inventados quando ausente).
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  if (!F) return;

  const UNAVAILABLE_TEXT = "Vídeo de demonstração ainda não disponível";
  const EMBED_HOST = "https://www.youtube-nocookie.com";
  const activeStages = new Set();
  let customAvailabilityChecker = null;
  let customSearchFetcher = null;
  let messageListenerBound = false;

  function data() {
    const raw = global.FORJA_VIDEOS_DATA;
    return raw && F.isPlainObject(raw) ? raw : null;
  }

  function getConfig() {
    const cfg = global.FORJA_YOUTUBE_CONFIG;
    return F.isPlainObject(cfg) ? cfg : {};
  }

  function available() {
    const d = data();
    return Boolean(d && F.isPlainObject(d.exercicios));
  }

  function effectiveMode(record, mode) {
    if (mode === "calisthenics" || mode === "weights") return mode;
    if (record && (record.mode === "calisthenics" || record.mode === "weights")) {
      return record.mode;
    }
    return "calisthenics";
  }

  /*
    Identidade estrita por libraryId (ou id de item oficial da biblioteca).
    Exercícios personalizados sem libraryId nunca herdam vídeo oficial apenas
    por coincidência de nome.
  */
  function originIdFor(record, mode) {
    if (!record || !F.isPlainObject(record)) return null;
    if (typeof record.libraryId === "string" && record.libraryId) {
      return record.libraryId;
    }
    if (record.source === "biblioteca" && typeof record.id === "string" && record.id) {
      return record.id;
    }
    const m = effectiveMode(record, mode);
    const lib = F.EXERCISE_LIBRARY && Array.isArray(F.EXERCISE_LIBRARY[m])
      ? F.EXERCISE_LIBRARY[m]
      : [];
    if (typeof record.id === "string" && lib.some(item => item.id === record.id)) {
      return record.id;
    }
    return null;
  }

  function buildEmbedUrl(videoId) {
    if (!F.isValidYouTubeId(videoId)) return "";
    const clean = videoId.trim();
    return (
      EMBED_HOST +
      "/embed/" +
      encodeURIComponent(clean) +
      "?autoplay=0&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&mute=1"
    );
  }

  function buildWatchUrl(videoId) {
    if (!F.isValidYouTubeId(videoId)) return "";
    return "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId.trim());
  }

  function formatDuration(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return "";
    const total = Math.round(value);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return mins + ":" + String(secs).padStart(2, "0");
  }

  function officialFor(record, mode) {
    if (!available()) return null;
    const m = effectiveMode(record, mode);
    const origin = originIdFor(record, m);
    if (!origin) return null;
    const raw = data().exercicios[m + ":" + origin];
    if (!raw) return null;
    const normalized = F.normalizeYouTubeVideo(raw);
    if (!normalized) return null;
    /* Vídeos oficiais do FORJA mantêm sempre seu enquadramento original. */
    return Object.assign({}, normalized, {
      framing: "original",
      source: "official",
      embedUrl: buildEmbedUrl(normalized.videoId),
      watchUrl: buildWatchUrl(normalized.videoId)
    });
  }

  function resolve(record, mode) {
    if (!record || !F.isPlainObject(record)) return null;

    /* Prioridade 1: vídeo escolhido pelo usuário para este exercício na rotina. */
    const custom = F.normalizeYouTubeVideo(record.youtubeVideo);
    if (custom) {
      return Object.assign({}, custom, {
        title: custom.title || record.name || "Demonstração em vídeo",
        channelTitle: custom.channelTitle || "YouTube",
        framing: custom.framing === "zoom" ? "zoom" : "original",
        source: "custom",
        embedUrl: buildEmbedUrl(custom.videoId),
        watchUrl: buildWatchUrl(custom.videoId)
      });
    }

    /* Prioridade 2: vídeo oficial do exercício no catálogo do FORJA. */
    return officialFor(record, mode);
  }

  function isOnline() {
    if (!global.navigator || typeof global.navigator.onLine !== "boolean") {
      return true;
    }
    return global.navigator.onLine;
  }

  function isJsdomEnv() {
    const ua = global.navigator && global.navigator.userAgent ? global.navigator.userAgent : "";
    return /jsdom/i.test(ua);
  }

  /*
    Verifica se o vídeo público existe e possui miniatura válida (320x180).
    Vídeos removidos ou privados retornam HTTP 404 ou o placeholder 120x90 do
    YouTube, permitindo acionar o fallback para a imagem de referência sem
    deixar player quebrado na tela.
  */
  function probeAvailability(videoId) {
    if (!F.isValidYouTubeId(videoId)) return Promise.resolve(false);
    if (!isOnline()) return Promise.resolve(false);

    if (typeof customAvailabilityChecker === "function") {
      try {
        return Promise.resolve(customAvailabilityChecker(videoId)).then(Boolean, () => false);
      } catch (error) {
        return Promise.resolve(false);
      }
    }

    if (isJsdomEnv()) {
      return Promise.resolve(true);
    }

    return new Promise(resolveProbe => {
      if (typeof global.Image !== "function") {
        resolveProbe(true);
        return;
      }
      const img = new global.Image();
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveProbe(ok);
      };
      const timer = setTimeout(() => finish(true), 4500);
      img.onload = () => {
        if (img.naturalWidth > 0 && img.naturalWidth < 200) {
          finish(false);
          return;
        }
        finish(true);
      };
      img.onerror = () => finish(false);
      img.referrerPolicy = "no-referrer";
      img.src = "https://i.ytimg.com/vi/" + encodeURIComponent(videoId.trim()) + "/mqdefault.jpg";
    });
  }

  function parsePlayerMessage(raw) {
    if (!raw) return null;
    if (F.isPlainObject(raw)) return raw;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed[0] !== "{") return null;
    try {
      const parsed = JSON.parse(trimmed);
      return F.isPlainObject(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function ensureMessageListener() {
    if (messageListenerBound || typeof global.addEventListener !== "function") return;
    messageListenerBound = true;

    global.addEventListener("message", event => {
      const origin = typeof event.origin === "string" ? event.origin : "";
      const trustedOrigin =
        !origin ||
        origin === "null" ||
        /^https:\/\/([a-z0-9-]+\.)?(youtube-nocookie\.com|youtube\.com)$/i.test(origin) ||
        origin === (global.location && global.location.origin);
      if (!trustedOrigin) return;

      const payload = parsePlayerMessage(event.data);
      if (!payload || payload.event !== "onError") return;

      activeStages.forEach(entry => {
        if (!entry.stage.isConnected) {
          activeStages.delete(entry);
          return;
        }
        const matchesSource =
          entry.iframe &&
          event.source &&
          entry.iframe.contentWindow === event.source;
        const matchesVideoId =
          typeof payload.videoId === "string" && payload.videoId === entry.videoId;
        if (matchesSource || matchesVideoId || (!event.source && !payload.videoId)) {
          entry.fallback("player-error");
        }
      });
    });
  }

  function createVisualPlaceholder(record, mode) {
    const doc = global.document;
    const box = doc.createElement("div");
    box.className = "video-demo-visual-fallback";
    const m = effectiveMode(record, mode);
    const sectionLabel =
      record && record.section && F.SECTION_NAMES[record.section]
        ? F.SECTION_NAMES[record.section]
        : F.MODE_NAMES[m] || "Exercício";

    const badge = doc.createElement("span");
    badge.className = "video-demo-visual-tag";
    badge.textContent = "Referência · " + sectionLabel;

    const title = doc.createElement("strong");
    title.className = "video-demo-visual-title";
    title.textContent = (record && record.name) || "Exercício";

    const hint = doc.createElement("span");
    hint.className = "video-demo-visual-hint";
    hint.textContent =
      record && record.instructions
        ? record.instructions
        : "Siga a orientação de séries, cadência e amplitude planejadas para o movimento.";

    box.appendChild(badge);
    box.appendChild(title);
    box.appendChild(hint);
    return box;
  }

  function createUnavailableNotice() {
    const p = global.document.createElement("p");
    p.className = "video-demo-unavailable";
    p.textContent =
      (data() && data().unavailableMessage) || UNAVAILABLE_TEXT;
    return p;
  }

  function destroyStage(container) {
    if (!container) return;
    activeStages.forEach(entry => {
      if (entry.stage === container || container.contains(entry.stage)) {
        if (entry.iframe) {
          entry.iframe.removeAttribute("src");
          if (entry.iframe.parentNode) entry.iframe.parentNode.removeChild(entry.iframe);
        }
        activeStages.delete(entry);
      }
    });
  }

  /*
    Cria o bloco completo de demonstração para detalhes da biblioteca ou
    execução de treino:
    - Com vídeo disponível: player 16:9 sem autoplay + metadados discretos +
      imagem de referência recolhível (mantendo atribuição RepDB intacta).
    - Sem vídeo ou com vídeo indisponível/removido: imagem de referência do
      exercício (ou cartão visual neutro se não houver ilustração) + aviso
      discreto "Vídeo de demonstração ainda não disponível".
  */
  function createStage(record, mode, options = {}) {
    ensureMessageListener();
    const doc = global.document;
    const m = effectiveMode(record, mode);
    const stage = doc.createElement("div");
    stage.className = "video-demo" + (options.compact ? " is-compact" : "");

    const resolved = resolve(record, m);
    const hasRepDb = Boolean(
      F.demos && F.demos.available() && F.demos.resolve(record, m)
    );
    const repDbMedia = hasRepDb
      ? F.demos.createMedia(record, m, { eager: true })
      : null;
    const unavailableNote = createUnavailableNotice();

    function renderFallbackState(reason) {
      stage.dataset.videoState = reason || "unavailable";
      stage.dataset.videoSource = "reference";
      stage.removeAttribute("data-video-id");
      stage.removeAttribute("data-video-framing");
      while (stage.firstChild) stage.removeChild(stage.firstChild);

      if (repDbMedia && repDbMedia.node) {
        stage.appendChild(repDbMedia.node);
      } else {
        stage.appendChild(createVisualPlaceholder(record, m));
      }
      unavailableNote.hidden = false;
      stage.appendChild(unavailableNote);
    }

    if (!resolved || !isOnline()) {
      renderFallbackState(resolved ? "offline" : "none");
      return {
        node: stage,
        resolved,
        hasVideo: false,
        hasReferenceImage: hasRepDb
      };
    }

    const isZoomCrop = resolved.source === "custom" && resolved.framing === "zoom";
    stage.dataset.videoState = "ready";
    stage.dataset.videoSource = resolved.source;
    stage.dataset.videoId = resolved.videoId;
    stage.dataset.videoFraming = isZoomCrop ? "zoom" : "original";

    const playerWrap = doc.createElement("div");
    playerWrap.className = "video-demo-player" + (isZoomCrop ? " is-zoom-crop" : "");

    const iframe = doc.createElement("iframe");
    iframe.className = "video-demo-iframe";
    iframe.src = resolved.embedUrl;
    iframe.title = "Demonstração em vídeo: " + ((record && record.name) || resolved.title);
    iframe.setAttribute("allow", "accelerometer; encrypted-media; gyroscope; picture-in-picture");
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    iframe.setAttribute("allowfullscreen", "");
    playerWrap.appendChild(iframe);

    const meta = doc.createElement("div");
    meta.className = "video-demo-meta";

    const badge = doc.createElement("span");
    badge.className =
      "video-demo-badge" + (resolved.source === "custom" ? " is-custom" : "");
    badge.textContent =
      resolved.source === "custom"
        ? (isZoomCrop ? "Vídeo do treino · Zoom 16:9" : "Vídeo do treino")
        : "Vídeo demonstrativo";
    meta.appendChild(badge);

    const infoParts = [];
    if (resolved.channelTitle) infoParts.push(resolved.channelTitle);
    if (resolved.durationSeconds) infoParts.push(formatDuration(resolved.durationSeconds));
    if (infoParts.length) {
      const info = doc.createElement("span");
      info.className = "video-demo-info";
      info.textContent = infoParts.join(" · ");
      meta.appendChild(info);
    }

    const extLink = doc.createElement("a");
    extLink.className = "video-demo-link";
    extLink.href = resolved.watchUrl;
    extLink.target = "_blank";
    extLink.rel = "noopener noreferrer";
    extLink.textContent = "YouTube";
    extLink.setAttribute(
      "aria-label",
      "Abrir vídeo de " + ((record && record.name) || "exercício") + " no YouTube"
    );
    meta.appendChild(extLink);

    stage.appendChild(playerWrap);
    stage.appendChild(meta);

    if (repDbMedia && repDbMedia.node) {
      const refDetails = doc.createElement("details");
      refDetails.className = "video-demo-reference";
      const summary = doc.createElement("summary");
      summary.className = "video-demo-reference-summary";
      summary.textContent = "Imagem de referência";
      refDetails.appendChild(summary);
      refDetails.appendChild(repDbMedia.node);
      stage.appendChild(refDetails);
    }

    unavailableNote.hidden = true;
    stage.appendChild(unavailableNote);

    const stageEntry = {
      stage,
      iframe,
      videoId: resolved.videoId,
      fallback(reason) {
        activeStages.delete(stageEntry);
        if (iframe.parentNode) {
          iframe.removeAttribute("src");
        }
        renderFallbackState(reason || "unavailable");
      }
    };
    activeStages.add(stageEntry);

    probeAvailability(resolved.videoId).then(isAvailable => {
      if (!isAvailable && activeStages.has(stageEntry)) {
        stageEntry.fallback("unavailable");
      }
    });

    return {
      node: stage,
      resolved,
      hasVideo: true,
      hasReferenceImage: hasRepDb,
      fallback: stageEntry.fallback
    };
  }

  function renderStage(container, record, mode, options = {}) {
    if (!container) return null;
    destroyStage(container);
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!record) {
      container.hidden = true;
      return null;
    }
    const created = createStage(record, mode, options);
    container.appendChild(created.node);
    container.hidden = false;
    return created;
  }

  /* ------------------------------------------------------------------ */
  /* Busca de vídeos curtos (<= 60s) via YouTube Data API v3             */
  /* ------------------------------------------------------------------ */

  function hasSearchCredentials() {
    const cfg = getConfig();
    const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
    const endpoint = typeof cfg.endpoint === "string" ? cfg.endpoint.trim() : "";
    return Boolean(apiKey || endpoint);
  }

  function isLikelyVerticalResult(snippet) {
    if (!F.isPlainObject(snippet)) return false;
    const title = typeof snippet.title === "string" ? snippet.title : "";
    const desc = typeof snippet.description === "string" ? snippet.description : "";
    if (/(^|\s)#shorts?\b/i.test(title) || /(^|\s)#shorts?\b/i.test(desc)) {
      return true;
    }
    const thumbs = F.isPlainObject(snippet.thumbnails) ? snippet.thumbnails : {};
    const sample = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium;
    if (sample && Number(sample.width) > 0 && Number(sample.height) > Number(sample.width)) {
      return true;
    }
    return false;
  }

  async function searchYouTube(query) {
    const cleanQuery = typeof query === "string" ? query.trim().slice(0, 120) : "";
    if (!cleanQuery) {
      return {
        status: "empty-query",
        items: [],
        message: "Digite o nome do exercício para pesquisar vídeos."
      };
    }

    const cfg = getConfig();
    const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
    const endpoint = typeof cfg.endpoint === "string" ? cfg.endpoint.trim() : "";
    const maxDuration = F.YOUTUBE_MAX_DURATION || 60;

    if (!apiKey && !endpoint) {
      return {
        status: "unconfigured",
        items: [],
        message:
          "A busca integrada do YouTube ainda não possui chave configurada neste ambiente. " +
          "Para ativá-la no GitHub Pages, configure uma chave restrita por domínio e quota da " +
          "YouTube Data API v3 em window.FORJA_YOUTUBE_CONFIG.apiKey. Você também pode colar abaixo " +
          "o link direto de um vídeo curto (até 60s) do YouTube para inspecionar e usar no treino."
      };
    }

    const fetcher =
      typeof customSearchFetcher === "function"
        ? customSearchFetcher
        : typeof global.fetch === "function"
          ? global.fetch.bind(global)
          : null;

    if (!fetcher) {
      return {
        status: "error",
        items: [],
        message: "Este navegador não suporta requisições de busca no momento."
      };
    }

    try {
      if (endpoint) {
        const sep = endpoint.indexOf("?") === -1 ? "?" : "&";
        const res = await fetcher(endpoint + sep + "q=" + encodeURIComponent(cleanQuery));
        if (!res || !res.ok) {
          return {
            status: "error",
            items: [],
            message:
              "Não foi possível conectar ao serviço de busca de vídeos. Verifique sua conexão e tente novamente."
          };
        }
        const payload = await res.json();
        const rawItems = Array.isArray(payload && payload.items) ? payload.items : [];
        const normalized = rawItems
          .map(item => F.normalizeYouTubeVideo(item))
          .filter(Boolean);
        return {
          status: "ok",
          items: normalized,
          message: normalized.length
            ? ""
            : "Nenhum vídeo curto (até 60s) em formato horizontal foi encontrado para esta pesquisa."
        };
      }

      const searchUrl =
        "https://www.googleapis.com/youtube/v3/search" +
        "?part=snippet" +
        "&type=video" +
        "&videoEmbeddable=true" +
        "&videoDuration=short" +
        "&safeSearch=strict" +
        "&maxResults=12" +
        "&q=" +
        encodeURIComponent(cleanQuery) +
        "&key=" +
        encodeURIComponent(apiKey);

      const searchRes = await fetcher(searchUrl);
      if (!searchRes || !searchRes.ok) {
        return {
          status: "error",
          items: [],
          message:
            "Não foi possível consultar a YouTube Data API no momento. Verifique sua conexão ou a quota da chave."
        };
      }

      const searchJson = await searchRes.json();
      const rawSearchItems = Array.isArray(searchJson && searchJson.items)
        ? searchJson.items
        : [];
      const ids = [];
      rawSearchItems.forEach(item => {
        const vid = item && item.id && item.id.videoId;
        if (F.isValidYouTubeId(vid) && ids.indexOf(vid) === -1) {
          ids.push(vid);
        }
      });

      if (!ids.length) {
        return {
          status: "ok",
          items: [],
          message: "Nenhum vídeo curto (até 60s) foi encontrado para esta pesquisa."
        };
      }

      const videosUrl =
        "https://www.googleapis.com/youtube/v3/videos" +
        "?part=snippet,contentDetails,status" +
        "&id=" +
        encodeURIComponent(ids.join(",")) +
        "&key=" +
        encodeURIComponent(apiKey);

      const videosRes = await fetcher(videosUrl);
      if (!videosRes || !videosRes.ok) {
        return {
          status: "error",
          items: [],
          message:
            "Não foi possível validar a duração dos vídeos no YouTube. Tente novamente em instantes."
        };
      }

      const videosJson = await videosRes.json();
      const videoItems = Array.isArray(videosJson && videosJson.items)
        ? videosJson.items
        : [];

      const items = [];
      videoItems.forEach(video => {
        if (!F.isPlainObject(video) || !F.isValidYouTubeId(video.id)) return;
        const status = F.isPlainObject(video.status) ? video.status : {};
        if (status.embeddable === false || status.privacyStatus === "private") return;

        const snippet = F.isPlainObject(video.snippet) ? video.snippet : {};
        const verticalHint = isLikelyVerticalResult(snippet);

        const contentDetails = F.isPlainObject(video.contentDetails)
          ? video.contentDetails
          : {};
        const durationSeconds = F.parseIsoDurationSeconds(contentDetails.duration);
        if (!durationSeconds || durationSeconds < 1 || durationSeconds > maxDuration) {
          return;
        }

        const normalized = F.normalizeYouTubeVideo({
          videoId: video.id,
          title: snippet.title || "",
          channelTitle: snippet.channelTitle || "",
          durationSeconds,
          thumbnailUrl: "https://i.ytimg.com/vi/" + video.id + "/mqdefault.jpg",
          framing: "original"
        });
        if (normalized) {
          items.push(Object.assign({}, normalized, { isVerticalHint: verticalHint }));
        }
      });

      return {
        status: "ok",
        items,
        message: items.length
          ? ""
          : "Nenhum vídeo curto (até 60 segundos) foi encontrado para esta pesquisa."
      };
    } catch (error) {
      return {
        status: "error",
        items: [],
        message:
          "Falha de conexão ao pesquisar vídeos no YouTube. Verifique sua internet e tente novamente."
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Seletor modal "Procurar vídeo" para o editor de rotinas             */
  /* ------------------------------------------------------------------ */

  async function openPicker(options = {}) {
    const exercise = options.exercise || { name: "" };
    const doc = global.document;
    const currentCustom = F.normalizeYouTubeVideo(exercise.youtubeVideo);
    let selectedVideo = currentCustom ? Object.assign({}, currentCustom) : null;
    let selectedFraming =
      currentCustom && currentCustom.framing === "zoom" ? "zoom" : "original";
    let previewIframe = null;

    const root = doc.createElement("div");
    root.className = "video-picker";

    const intro = doc.createElement("p");
    intro.className = "video-picker-intro";
    intro.textContent =
      "Pesquise pelo nome do exercício, inspecione a prévia em 16:9 e configure o enquadramento. Para Shorts verticais, use 'Zoom e corte 16:9' para preencher o quadro sem bordas nem deformação. A escolha vale somente para este treino.";
    root.appendChild(intro);

    /* Barra de busca */
    const searchRow = doc.createElement("div");
    searchRow.className = "video-picker-search-row";

    const searchInput = doc.createElement("input");
    searchInput.type = "search";
    searchInput.className = "video-picker-query";
    searchInput.value = exercise.name || "";
    searchInput.placeholder = "Pesquisar exercício no YouTube";
    searchInput.setAttribute("aria-label", "Pesquisar vídeo pelo nome do exercício");

    const searchBtn = doc.createElement("button");
    searchBtn.type = "button";
    searchBtn.className = "secondary-button small-button video-picker-search-btn";
    searchBtn.textContent = "Pesquisar";

    searchRow.appendChild(searchInput);
    searchRow.appendChild(searchBtn);
    root.appendChild(searchRow);

    /* Pré-visualização 16:9 obrigatória + configuração de enquadramento */
    const previewWrap = doc.createElement("div");
    previewWrap.className = "video-picker-preview-panel";
    previewWrap.hidden = true;

    const previewHeader = doc.createElement("div");
    previewHeader.className = "video-picker-preview-head";
    const previewLabel = doc.createElement("strong");
    previewLabel.className = "video-picker-preview-title";
    const previewMeta = doc.createElement("span");
    previewMeta.className = "video-picker-preview-meta";
    previewHeader.appendChild(previewLabel);
    previewHeader.appendChild(previewMeta);

    const previewFrameBox = doc.createElement("div");
    previewFrameBox.className = "video-picker-preview-frame video-demo-player";

    const framingBox = doc.createElement("div");
    framingBox.className = "video-picker-framing";
    const framingLabel = doc.createElement("span");
    framingLabel.className = "video-picker-framing-label";
    framingLabel.textContent = "Enquadramento neste treino";

    const framingOptions = doc.createElement("div");
    framingOptions.className = "video-picker-framing-options";
    framingOptions.setAttribute("role", "group");
    framingOptions.setAttribute("aria-label", "Enquadramento do vídeo neste treino");

    const framingOriginalBtn = doc.createElement("button");
    framingOriginalBtn.type = "button";
    framingOriginalBtn.className = "secondary-button small-button video-picker-framing-btn";
    framingOriginalBtn.dataset.framingOption = "original";
    framingOriginalBtn.textContent = "Original";

    const framingZoomBtn = doc.createElement("button");
    framingZoomBtn.type = "button";
    framingZoomBtn.className = "secondary-button small-button video-picker-framing-btn";
    framingZoomBtn.dataset.framingOption = "zoom";
    framingZoomBtn.textContent = "Zoom e corte 16:9 (Short)";

    framingOptions.appendChild(framingOriginalBtn);
    framingOptions.appendChild(framingZoomBtn);
    framingBox.appendChild(framingLabel);
    framingBox.appendChild(framingOptions);

    const previewHint = doc.createElement("p");
    previewHint.className = "video-picker-preview-hint";
    const DEFAULT_PREVIEW_HINT =
      "Confira a prévia acima (até 60s). Se o vídeo for um Short vertical com faixas laterais, ative 'Zoom e corte 16:9 (Short)' para preencher toda a área horizontal sem esticar.";
    previewHint.textContent = DEFAULT_PREVIEW_HINT;

    previewWrap.appendChild(previewHeader);
    previewWrap.appendChild(previewFrameBox);
    previewWrap.appendChild(framingBox);
    previewWrap.appendChild(previewHint);
    root.appendChild(previewWrap);

    /* Status + lista de resultados */
    const statusBox = doc.createElement("p");
    statusBox.className = "video-picker-status";
    statusBox.hidden = true;
    root.appendChild(statusBox);

    const resultsList = doc.createElement("div");
    resultsList.className = "video-picker-results";
    resultsList.setAttribute("role", "listbox");
    resultsList.setAttribute("aria-label", "Resultados de vídeos do YouTube");
    root.appendChild(resultsList);

    /* Entrada opcional de link direto do YouTube (validado, incluindo Shorts) */
    const directBox = doc.createElement("div");
    directBox.className = "video-picker-direct";

    const directLabel = doc.createElement("label");
    directLabel.className = "video-picker-direct-label";
    directLabel.textContent = "Ou informe um link do YouTube ou YouTube Shorts (até 60s)";

    const directRow = doc.createElement("div");
    directRow.className = "video-picker-direct-row";

    const directInput = doc.createElement("input");
    directInput.type = "url";
    directInput.className = "video-picker-url-input";
    directInput.placeholder = "https://www.youtube.com/watch?v=... ou /shorts/...";
    directInput.setAttribute("aria-label", "Link de vídeo do YouTube");

    const directBtn = doc.createElement("button");
    directBtn.type = "button";
    directBtn.className = "secondary-button small-button video-picker-url-btn";
    directBtn.textContent = "Visualizar";

    directRow.appendChild(directInput);
    directRow.appendChild(directBtn);
    directBox.appendChild(directLabel);
    directBox.appendChild(directRow);
    root.appendChild(directBox);

    const validationMsg = doc.createElement("p");
    validationMsg.className = "video-picker-error";
    validationMsg.hidden = true;
    root.appendChild(validationMsg);

    function setValidationError(msg) {
      if (!msg) {
        validationMsg.textContent = "";
        validationMsg.hidden = true;
        return;
      }
      validationMsg.textContent = msg;
      validationMsg.hidden = false;
    }

    function setStatus(msg, modifier) {
      statusBox.className =
        "video-picker-status" + (modifier ? " is-" + modifier : "");
      if (!msg) {
        statusBox.textContent = "";
        statusBox.hidden = true;
        return;
      }
      statusBox.textContent = msg;
      statusBox.hidden = false;
    }

    function clearPreviewIframe() {
      if (previewIframe) {
        previewIframe.removeAttribute("src");
        if (previewIframe.parentNode) previewIframe.parentNode.removeChild(previewIframe);
        previewIframe = null;
      }
    }

    function syncSelectedCards() {
      const cards = resultsList.querySelectorAll(".video-result-card");
      cards.forEach(card => {
        const active =
          Boolean(selectedVideo) && card.dataset.videoId === selectedVideo.videoId;
        card.classList.toggle("is-selected", active);
        card.setAttribute("aria-selected", active ? "true" : "false");
      });
    }

    function applyFramingChoice(nextFraming) {
      selectedFraming = nextFraming === "zoom" ? "zoom" : "original";
      if (selectedVideo) {
        selectedVideo = Object.assign({}, selectedVideo, { framing: selectedFraming });
      }
      previewFrameBox.classList.toggle("is-zoom-crop", selectedFraming === "zoom");
      previewFrameBox.dataset.videoFraming = selectedFraming;
      [framingOriginalBtn, framingZoomBtn].forEach(btn => {
        const active = btn.dataset.framingOption === selectedFraming;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    framingOriginalBtn.addEventListener("click", () => applyFramingChoice("original"));
    framingZoomBtn.addEventListener("click", () => applyFramingChoice("zoom"));

    function mountPreview(video, metaFlags = {}) {
      const candidate = Object.assign({}, video, {
        framing:
          video && video.framing === "zoom"
            ? "zoom"
            : metaFlags.keepCurrentFraming
              ? selectedFraming
              : "original"
      });
      const normalized = F.normalizeYouTubeVideo(candidate);
      if (!normalized) {
        setValidationError(
          "Vídeo inválido. Escolha um vídeo curto (até 60s) com identificador válido do YouTube."
        );
        return;
      }
      selectedVideo = normalized;
      setValidationError("");
      clearPreviewIframe();

      previewLabel.textContent =
        normalized.title || exercise.name || "Pré-visualização do vídeo";
      const metaParts = [];
      if (normalized.channelTitle) metaParts.push(normalized.channelTitle);
      if (normalized.durationSeconds) {
        metaParts.push(formatDuration(normalized.durationSeconds));
      }
      if (metaFlags.isVertical) {
        metaParts.push("Short vertical");
      }
      previewMeta.textContent = metaParts.join(" · ");
      previewHint.textContent = metaFlags.isVertical
        ? "Short vertical identificado: use 'Zoom e corte 16:9 (Short)' para preencher o espaço horizontal 16:9 eliminando bordas, sem esticar o vídeo."
        : DEFAULT_PREVIEW_HINT;

      previewIframe = doc.createElement("iframe");
      previewIframe.className = "video-demo-iframe video-picker-preview-iframe";
      previewIframe.src = buildEmbedUrl(normalized.videoId);
      previewIframe.title =
        "Prévia do vídeo: " + (normalized.title || exercise.name || normalized.videoId);
      previewIframe.setAttribute(
        "allow",
        "accelerometer; encrypted-media; gyroscope; picture-in-picture"
      );
      previewIframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      previewIframe.setAttribute("allowfullscreen", "");
      previewFrameBox.appendChild(previewIframe);

      applyFramingChoice(normalized.framing);
      previewWrap.hidden = false;
      syncSelectedCards();
    }

    function renderResults(items) {
      while (resultsList.firstChild) resultsList.removeChild(resultsList.firstChild);

      items.forEach(item => {
        const card = doc.createElement("button");
        card.type = "button";
        card.className = "video-result-card";
        card.dataset.videoId = item.videoId;
        card.setAttribute("role", "option");
        card.setAttribute("aria-selected", "false");

        const thumbBox = doc.createElement("div");
        thumbBox.className = "video-result-thumb";

        const thumbImg = doc.createElement("img");
        thumbImg.src = item.thumbnailUrl;
        thumbImg.alt = "";
        thumbImg.loading = "lazy";
        thumbImg.referrerPolicy = "no-referrer";
        thumbBox.appendChild(thumbImg);

        if (item.durationSeconds) {
          const durationBadge = doc.createElement("span");
          durationBadge.className = "video-result-duration";
          durationBadge.textContent = formatDuration(item.durationSeconds);
          thumbBox.appendChild(durationBadge);
        }

        const body = doc.createElement("div");
        body.className = "video-result-body";

        const titleEl = doc.createElement("span");
        titleEl.className = "video-result-title";
        titleEl.textContent = item.title || "Vídeo " + item.videoId;

        const channelParts = [item.channelTitle || "YouTube"];
        if (item.durationSeconds) channelParts.push(item.durationSeconds + " s");
        if (item.isVerticalHint) channelParts.push("Short vertical");

        const channelEl = doc.createElement("span");
        channelEl.className = "video-result-channel";
        channelEl.textContent = channelParts.join(" · ");

        const previewAction = doc.createElement("span");
        previewAction.className = "video-result-cta";
        previewAction.textContent = "Inspecionar prévia 16:9";

        body.appendChild(titleEl);
        body.appendChild(channelEl);
        body.appendChild(previewAction);

        card.appendChild(thumbBox);
        card.appendChild(body);

        card.addEventListener("click", () => {
          mountPreview(
            Object.assign({}, item, {
              framing:
                selectedVideo && selectedVideo.videoId === item.videoId
                  ? selectedFraming
                  : "original"
            }),
            { isVertical: Boolean(item.isVerticalHint) }
          );
        });

        resultsList.appendChild(card);
      });

      syncSelectedCards();
    }

    async function executeSearch() {
      setValidationError("");
      setStatus("Pesquisando vídeos curtos no YouTube…", "loading");
      searchBtn.disabled = true;
      const response = await searchYouTube(searchInput.value);
      searchBtn.disabled = false;

      renderResults(response.items || []);
      if (response.status === "ok" && response.items.length > 0) {
        setStatus("", "");
      } else if (response.status === "ok") {
        setStatus(
          response.message ||
            "Nenhum vídeo curto (até 60s) encontrado para esta pesquisa.",
          "empty"
        );
      } else if (response.status === "unconfigured") {
        setStatus(response.message, "unconfigured");
      } else if (response.status === "empty-query") {
        setStatus(response.message, "empty");
      } else {
        setStatus(
          response.message ||
            "Falha ao conectar à busca do YouTube. Tente novamente.",
          "error"
        );
      }
    }

    searchBtn.addEventListener("click", () => {
      executeSearch();
    });
    searchInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        executeSearch();
      }
    });

    directBtn.addEventListener("click", () => {
      const parsed = F.parseYouTubeUrl(directInput.value);
      if (!parsed) {
        setValidationError(
          "URL ou ID do YouTube inválido. Informe um link válido de vídeo ou Short do YouTube."
        );
        return;
      }
      mountPreview(
        {
          videoId: parsed.videoId,
          title: exercise.name ? exercise.name + " (YouTube)" : "Vídeo selecionado",
          channelTitle: "YouTube",
          framing: parsed.isShort ? "zoom" : "original"
        },
        { isVertical: Boolean(parsed.isShort) }
      );
    });

    if (currentCustom) {
      mountPreview(currentCustom);
    }

    if (hasSearchCredentials() && searchInput.value.trim()) {
      executeSearch();
    } else if (!hasSearchCredentials()) {
      const info = await searchYouTube(searchInput.value || exercise.name || "exercicio");
      setStatus(info.message, "unconfigured");
    }

    const actions = [{ id: "cancel", label: "Cancelar", className: "secondary-button" }];
    if (currentCustom) {
      actions.push({
        id: "clear",
        label: "Usar vídeo padrão",
        className: "secondary-button"
      });
    }
    actions.push({
      id: "confirm",
      label: "Confirmar vídeo",
      className: "primary-button"
    });

    const modalResult = await F.showModal({
      title: "Procurar vídeo",
      message: "Demonstração para " + (exercise.name || "este exercício") + " neste treino.",
      details: root,
      fields: [],
      submitActions: ["confirm"],
      validate() {
        if (!selectedVideo || !F.isValidYouTubeVideoShape(selectedVideo)) {
          const msg =
            "Selecione e visualize um vídeo curto nos resultados (ou valide um link do YouTube) antes de confirmar.";
          setValidationError(msg);
          return { ok: false, message: msg };
        }
        return { ok: true };
      },
      actions
    });

    clearPreviewIframe();

    if (modalResult.action === "confirm" && selectedVideo) {
      const clean = F.normalizeYouTubeVideo(selectedVideo);
      if (clean && typeof options.onConfirm === "function") {
        options.onConfirm(clean);
      }
      return { action: "confirm", video: clean };
    }

    if (modalResult.action === "clear") {
      if (typeof options.onConfirm === "function") {
        options.onConfirm(null);
      }
      return { action: "clear", video: null };
    }

    return { action: "cancel", video: null };
  }

  F.videos = {
    UNAVAILABLE_TEXT,
    EMBED_HOST,
    available,
    officialFor,
    resolve,
    buildEmbedUrl,
    buildWatchUrl,
    formatDuration,
    probeAvailability,
    createStage,
    renderStage,
    destroyStage,
    hasSearchCredentials,
    searchYouTube,
    openPicker,
    setAvailabilityChecker(fn) {
      customAvailabilityChecker = typeof fn === "function" ? fn : null;
    },
    setSearchFetcher(fn) {
      customSearchFetcher = typeof fn === "function" ? fn : null;
    }
  };
})(window);
