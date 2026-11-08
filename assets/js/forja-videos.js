/*
  FORJA — demonstrações em vídeo (YouTube oficial + fallback de referência).

  Ordem de prioridade da demonstração:
  1. Vídeo personalizado associado ao exercício dentro da rotina específica.
  2. Vídeo oficial do exercício no catálogo (`FORJA_VIDEOS_DATA`).
  3. Imagem de referência correspondente do exercício (`F.demos`) acompanhada
     do aviso "Demonstração em vídeo ainda não disponível para este
     exercício.". No detalhe da biblioteca a foto fica no bloco de
     identificação, então o palco é criado com `reference: false` para não
     repetir a mesma ilustração.

  Garantias:
  - Reprodução somente via `youtube-nocookie.com/embed/...` em proporção 16:9,
    com controles visíveis (`controls=1`), sem autoplay (`autoplay=0`) e sempre
    silenciosa (`mute=1`) — no treino, na biblioteca, na prévia e no seletor.
  - Nenhum vídeo é baixado para o repositório; nenhum personagem 3D ou tela
    vazia/quebrada é exibido quando um vídeo não existe ou falha.
  - A pesquisa usa a YouTube Data API v3 SOMENTE através do proxy do backend
    (`/api/youtube-search`, implementado em `netlify/functions/youtube-search.mjs`).
    Nenhuma chave existe ou trafega no JavaScript público.
  - YouTube Shorts estão fora do produto: a pesquisa só devolve vídeos
    convencionais com orientação horizontal confirmada, links `/shorts/` são
    recusados e não existe mais zoom/corte para transformar vertical em 16:9.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  if (!F) return;

  const UNAVAILABLE_TEXT = "Demonstração em vídeo ainda não disponível para este exercício.";
  const EMBED_HOST = "https://www.youtube-nocookie.com";
  const DEFAULT_SEARCH_PATH = "api/youtube-search";
  function defaultSearchEndpoint() {
    // F.apiUrl resolve para /api/youtube-search na Netlify e para a URL
    // absoluta do backend quando o site roda no GitHub Pages, localhost etc.
    return (F && typeof F.apiUrl === "function")
      ? F.apiUrl(DEFAULT_SEARCH_PATH)
      : "/api/youtube-search";
  }
  const DEFAULT_CACHE_TTL_MS = 600000;
  const DEFAULT_MAX_RESULTS = 10;
  const CACHE_MAX_ENTRIES = 60;

  const activeStages = new Set();
  const searchCache = new Map();
  const searchInflight = new Map();
  let customAvailabilityChecker = null;
  let customSearchFetcher = null;
  let customOrientationProber = null;
  let messageListenerBound = false;

  const MESSAGES = {
    loading: "Pesquisando vídeos horizontais de até 60 segundos…",
    emptyQuery: "Digite o nome do exercício ou um termo relacionado para pesquisar.",
    empty:
      "Nenhum vídeo convencional horizontal (16:9) de até 60 segundos foi encontrado para esta pesquisa.",
    network: "Falha de conexão ao pesquisar vídeos. Verifique sua internet e tente novamente.",
    error: "Não foi possível consultar a busca de vídeos neste momento. Tente novamente em instantes.",
    noFetch: "Este navegador não suporta requisições de busca no momento.",
    unconfigured:
      "A busca de vídeos ainda não está ativa neste ambiente: o backend precisa da variável " +
      "YOUTUBE_API_KEY. Enquanto isso, você pode colar abaixo o link de um vídeo convencional " +
      "do YouTube (até 60 segundos).",
    unavailable:
      "A busca integrada não está disponível neste servidor (backend ausente). Você pode colar " +
      "abaixo o link de um vídeo convencional do YouTube (até 60 segundos).",
    quota:
      "O limite diário de consultas da YouTube Data API v3 foi atingido. Tente novamente mais " +
      "tarde ou cole abaixo o link de um vídeo convencional do YouTube.",
    rateLimited: "Muitas pesquisas em sequência. Aguarde alguns segundos e tente novamente.",
    shortsBlocked:
      "YouTube Shorts não são aceitos. Escolha um vídeo convencional do YouTube, em formato " +
      "horizontal (16:9) e com até 60 segundos.",
    unconfirmed:
      "Não foi possível confirmar que este vídeo é horizontal (16:9). Sem essa confirmação ele " +
      "não pode ser usado como demonstração.",
    tooLong: "Este vídeo tem mais de 60 segundos e não pode ser usado como demonstração.",
    notEmbeddable: "Este vídeo não permite incorporação e não pode ser exibido no FORJA.",
    notPublic: "Este vídeo não é público no YouTube.",
    notFound: "Este vídeo não está disponível publicamente no YouTube.",
    invalidUrl:
      "Link inválido. Use um endereço de vídeo convencional do YouTube (watch?v=…, youtu.be/… ou /embed/…).",
    selectFirst:
      "Selecione e visualize um vídeo horizontal (até 60 segundos) antes de confirmar."
  };

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

  /*
    Parâmetros de incorporação idênticos em TODAS as etapas (treino, biblioteca,
    prévia do seletor): sem autoplay, com controles e sempre sem áudio.
  */
  const EMBED_PARAMS = "autoplay=0&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&mute=1";

  function buildEmbedUrl(videoId) {
    if (!F.isValidYouTubeId(videoId)) return "";
    return EMBED_HOST + "/embed/" + encodeURIComponent(videoId.trim()) + "?" + EMBED_PARAMS;
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
      orientation: "horizontal",
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
        framing: "original",
        orientation: "horizontal",
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

  /*
    Confirmação local de orientação pela geometria da miniatura. É o último
    recurso quando o backend não está disponível (hospedagem puramente estática)
    e o usuário cola um link: sem confirmação, o vídeo não é liberado.
  */
  function probeOrientation(videoId) {
    if (!F.isValidYouTubeId(videoId)) return Promise.resolve("unknown");

    if (typeof customOrientationProber === "function") {
      try {
        return Promise.resolve(customOrientationProber(videoId)).then(
          value => (F.YOUTUBE_ORIENTATIONS.indexOf(value) === -1 ? "unknown" : value),
          () => "unknown"
        );
      } catch (error) {
        return Promise.resolve("unknown");
      }
    }

    if (!isOnline() || isJsdomEnv() || typeof global.Image !== "function") {
      return Promise.resolve("unknown");
    }

    return new Promise(resolveProbe => {
      const img = new global.Image();
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveProbe(value);
      };
      const timer = setTimeout(() => finish("unknown"), 4500);
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          finish("unknown");
          return;
        }
        const ratio = width / height;
        if (ratio >= 1.2) finish("horizontal");
        else if (ratio <= 0.85) finish("vertical");
        else finish("unknown");
      };
      img.onerror = () => finish("unknown");
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
    - Com vídeo disponível: player 16:9 sem autoplay e sem áudio + metadados
      discretos + imagem de referência recolhível (atribuição RepDB intacta).
    - Sem vídeo ou com vídeo indisponível/removido: imagem de referência do
      exercício (ou cartão visual neutro se não houver ilustração) + aviso
      "Demonstração em vídeo ainda não disponível para este exercício.".
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

      /*
        No detalhe da biblioteca a foto do exercício já aparece na
        identificação: com `reference: false` o palco não repete a ilustração e
        mostra apenas o aviso de que a demonstração em vídeo não existe.
      */
      if (options.reference !== false) {
        if (repDbMedia && repDbMedia.node) {
          stage.appendChild(repDbMedia.node);
        } else {
          stage.appendChild(createVisualPlaceholder(record, m));
        }
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

    stage.dataset.videoState = "ready";
    stage.dataset.videoSource = resolved.source;
    stage.dataset.videoId = resolved.videoId;
    /* Todo vídeo exibido é horizontal no seu enquadramento original. */
    stage.dataset.videoFraming = "original";

    const playerWrap = doc.createElement("div");
    playerWrap.className = "video-demo-player";

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
    badge.textContent = resolved.source === "custom" ? "Vídeo do treino" : "Vídeo demonstrativo";
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

    if (repDbMedia && repDbMedia.node && options.reference !== false) {
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
  /* Pesquisa de vídeos via proxy do backend (YouTube Data API v3)        */
  /* ------------------------------------------------------------------ */

  function resolveEndpoint(raw) {
    if (!raw) return "";
    // URL absoluta (http/https) — usar como está (desenvolvimento com Netlify
    // CLI, endpoint alternativo etc.).
    if (/^https?:\/\//i.test(raw)) return raw;
    // Demais casos: normaliza para "api/..." (sem barra inicial) e passa por
    // F.apiUrl, que decide se usa o mesmo host ou a Netlify de produção.
    const clean = raw.replace(/^\/+/, "");
    return (F && typeof F.apiUrl === "function") ? F.apiUrl(clean) : "/" + clean;
  }

  function searchSettings() {
    const cfg = getConfig();
    const rawEndpoint = typeof cfg.endpoint === "string" ? cfg.endpoint.trim() : "";
    const endpoint = cfg.disabled === true
      ? ""
      : resolveEndpoint(rawEndpoint) || defaultSearchEndpoint();

    const maxDuration = Number.isFinite(Number(cfg.maxDurationSeconds)) && Number(cfg.maxDurationSeconds) > 0
      ? Math.min(F.YOUTUBE_MAX_DURATION, Math.max(1, Math.round(Number(cfg.maxDurationSeconds))))
      : F.YOUTUBE_MAX_DURATION;

    const maxResults = Number.isFinite(Number(cfg.maxResults)) && Number(cfg.maxResults) > 0
      ? Math.min(12, Math.max(1, Math.round(Number(cfg.maxResults))))
      : DEFAULT_MAX_RESULTS;

    const cacheTtlMs = Number.isFinite(Number(cfg.cacheTtlMs)) && Number(cfg.cacheTtlMs) >= 0
      ? Math.min(86400000, Number(cfg.cacheTtlMs))
      : DEFAULT_CACHE_TTL_MS;

    return { endpoint, maxDuration, maxResults, cacheTtlMs };
  }

  function searchEndpoint() {
    return searchSettings().endpoint;
  }

  /*
    Mantido no API público com o sentido atual: existe um endpoint de proxy
    configurado? A chave de API nunca é verificada aqui — ela não existe no
    navegador.
  */
  function hasSearchCredentials() {
    return Boolean(searchSettings().endpoint);
  }

  function currentFetcher() {
    if (typeof customSearchFetcher === "function") return customSearchFetcher;
    return typeof global.fetch === "function" ? global.fetch.bind(global) : null;
  }

  function buildRequestUrl(endpoint, params) {
    const separator = endpoint.indexOf("?") === -1 ? "?" : "&";
    const query = Object.keys(params)
      .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== "")
      .map(key => encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])))
      .join("&");
    return query ? endpoint + separator + query : endpoint;
  }

  async function readPayload(response) {
    if (!response || typeof response.json !== "function") return null;
    try {
      const payload = await response.json();
      return F.isPlainObject(payload) ? payload : null;
    } catch (error) {
      return null;
    }
  }

  function cacheRead(key, ttlMs) {
    const entry = searchCache.get(key);
    if (!entry) return null;
    if (ttlMs <= 0 || Date.now() - entry.at > ttlMs) {
      searchCache.delete(key);
      return null;
    }
    return entry.result;
  }

  function cacheWrite(key, result, ttlMs) {
    if (ttlMs <= 0) return;
    if (searchCache.size >= CACHE_MAX_ENTRIES && !searchCache.has(key)) {
      const oldest = searchCache.keys().next().value;
      if (oldest !== undefined) searchCache.delete(oldest);
    }
    searchCache.set(key, { at: Date.now(), result });
  }

  function clearSearchCache() {
    searchCache.clear();
    searchInflight.clear();
  }

  function searchCacheStats() {
    return { entries: searchCache.size, inflight: searchInflight.size };
  }

  /* Somente campos conhecidos saem do backend para a interface. */
  function sanitizeMeta(meta) {
    if (!F.isPlainObject(meta)) return null;
    const quota = F.isPlainObject(meta.quota) ? meta.quota : null;
    const rejected = F.isPlainObject(meta.rejected) ? meta.rejected : null;
    const out = {
      source: typeof meta.source === "string" ? meta.source : "youtube-data-api-v3",
      cached: meta.cached === true,
      returned: Number.isFinite(Number(meta.returned)) ? Number(meta.returned) : null,
      candidates: Number.isFinite(Number(meta.candidates)) ? Number(meta.candidates) : null
    };
    if (quota) {
      out.quota = {
        unitsUsedToday: Number(quota.unitsUsedToday) || 0,
        dailyBudgetUnits: Number(quota.dailyBudgetUnits) || 0,
        remainingUnitsToday: Number(quota.remainingUnitsToday) || 0,
        cacheHitsToday: Number(quota.cacheHitsToday) || 0
      };
    }
    if (rejected) {
      out.rejected = {
        vertical: Number(rejected.vertical) || 0,
        duration: Number(rejected.duration) || 0,
        unconfirmed: Number(rejected.unconfirmed) || 0
      };
    }
    return out;
  }

  /*
    Defesa em profundidade: mesmo vindo do proxy, um item só entra na lista se
    chegar declarado como horizontal confirmado, com duração dentro do limite e
    identificador válido. Qualquer dúvida descarta o resultado.
  */
  function normalizeSearchItem(raw, settings) {
    if (!F.isPlainObject(raw)) return null;
    const videoId = typeof raw.videoId === "string" ? raw.videoId.trim() : "";
    if (!F.isValidYouTubeId(videoId)) return null;

    const durationSeconds = Number(raw.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > settings.maxDuration) {
      return null;
    }
    if (!F.isConfirmedHorizontalVideo(raw)) return null;

    const normalized = F.normalizeYouTubeVideo({
      videoId,
      title: raw.title,
      channelTitle: raw.channelTitle,
      durationSeconds,
      thumbnailUrl: raw.thumbnailUrl,
      framing: "original"
    });
    if (!normalized) return null;
    return Object.assign({}, normalized, { orientation: "horizontal", aspectRatio: "16:9" });
  }

  function transportFailure(httpStatus, payload) {
    const backendStatus = payload && typeof payload.status === "string" ? payload.status : "";
    const backendMessage = payload && typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : "";

    if (backendStatus === "quota" || (httpStatus === 429 && backendStatus === "quota")) {
      return { status: "quota", message: backendMessage || MESSAGES.quota };
    }
    if (backendStatus === "rate-limited") {
      return { status: "error", message: backendMessage || MESSAGES.rateLimited };
    }
    if (backendStatus === "unconfigured" || httpStatus === 503) {
      return { status: "unconfigured", message: backendMessage || MESSAGES.unconfigured };
    }
    /* Rota inexistente (hospedagem apenas estática) ou resposta não-JSON. */
    if (httpStatus === 404 || httpStatus === 405 || httpStatus === 501) {
      return { status: "unavailable", message: MESSAGES.unavailable };
    }
    if (httpStatus === 400) {
      return { status: "empty-query", message: backendMessage || MESSAGES.emptyQuery };
    }
    return { status: "error", message: backendMessage || MESSAGES.error };
  }

  const INSPECT_REASONS = {
    vertical: MESSAGES.shortsBlocked,
    unconfirmed: MESSAGES.unconfirmed,
    duration: MESSAGES.tooLong,
    "not-embeddable": MESSAGES.notEmbeddable,
    "not-public": MESSAGES.notPublic,
    "not-found": MESSAGES.notFound,
    invalid: MESSAGES.invalidUrl
  };

  async function requestBackend(params) {
    const settings = searchSettings();
    if (!settings.endpoint) {
      return { kind: "status", status: "unavailable", message: MESSAGES.unavailable };
    }
    const doFetch = currentFetcher();
    if (!doFetch) {
      return { kind: "status", status: "error", message: MESSAGES.noFetch };
    }

    let response;
    try {
      response = await doFetch(buildRequestUrl(settings.endpoint, params), {
        headers: { accept: "application/json" }
      });
    } catch (error) {
      return { kind: "status", status: "error", message: MESSAGES.network };
    }

    const payload = await readPayload(response);
    const httpStatus = response && Number.isFinite(Number(response.status))
      ? Number(response.status)
      : 0;
    const ok = Boolean(response && response.ok);

    if (!payload) {
      return Object.assign({ kind: "status" }, transportFailure(httpStatus, null));
    }
    return { kind: "payload", payload, httpStatus, ok, settings };
  }

  async function performSearch(query, settings, cacheKey) {
    const outcome = await requestBackend({ q: query, limit: settings.maxResults });
    if (outcome.kind === "status") {
      return { status: outcome.status, items: [], message: outcome.message, meta: null, cached: false };
    }

    const { payload, httpStatus, ok } = outcome;
    if (!ok || payload.status !== "ok") {
      const failure = transportFailure(httpStatus, payload);
      return { status: failure.status, items: [], message: failure.message, meta: null, cached: false };
    }

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items = [];
    let rejectedHere = 0;
    rawItems.forEach(raw => {
      const item = normalizeSearchItem(raw, settings);
      if (item) items.push(item);
      else rejectedHere += 1;
    });

    const meta = sanitizeMeta(payload.meta);
    const result = {
      status: "ok",
      items,
      message: items.length ? "" : MESSAGES.empty,
      meta,
      clientRejected: rejectedHere,
      cached: false
    };
    cacheWrite(cacheKey, result, settings.cacheTtlMs);
    return result;
  }

  /*
    Pesquisa de vídeos. Nunca lança: devolve sempre
    { status, items, message, meta, cached } com status em
    ok | empty-query | unconfigured | unavailable | quota | error.
    Repetições da mesma consulta saem do cache local (nenhuma chamada nova).
  */
  async function searchYouTube(query, options = {}) {
    const settings = searchSettings();
    const cleanQuery = typeof query === "string" ? query.replace(/\s+/g, " ").trim().slice(0, 120) : "";

    if (cleanQuery.length < 2) {
      return { status: "empty-query", items: [], message: MESSAGES.emptyQuery, meta: null, cached: false };
    }
    if (!settings.endpoint) {
      return { status: "unavailable", items: [], message: MESSAGES.unavailable, meta: null, cached: false };
    }

    const cacheKey = "q:" + cleanQuery.toLowerCase() + ":" + settings.maxResults;
    if (options.refresh !== true) {
      const cached = cacheRead(cacheKey, settings.cacheTtlMs);
      if (cached) return Object.assign({}, cached, { cached: true });
    }

    if (searchInflight.has(cacheKey)) {
      try {
        return Object.assign({}, await searchInflight.get(cacheKey), { cached: true });
      } catch (error) {
        /* A chamada compartilhada falhou: tenta uma nova abaixo. */
      }
    }

    const task = performSearch(cleanQuery, settings, cacheKey);
    searchInflight.set(cacheKey, task);
    try {
      return await task;
    } finally {
      if (searchInflight.get(cacheKey) === task) searchInflight.delete(cacheKey);
    }
  }

  /*
    Inspeção de um vídeo pelo id (usada quando o usuário cola um link).
    Devolve { status, video, message }: status "ok" só com orientação
    horizontal confirmada pelo backend.
  */
  async function inspectVideo(videoId, options = {}) {
    const settings = searchSettings();
    const cleanId = typeof videoId === "string" ? videoId.trim() : "";
    if (!F.isValidYouTubeId(cleanId)) {
      return { status: "invalid", video: null, message: MESSAGES.invalidUrl };
    }
    if (!settings.endpoint) {
      return { status: "unavailable", video: null, message: MESSAGES.unavailable };
    }

    const cacheKey = "id:" + cleanId;
    if (options.refresh !== true) {
      const cached = cacheRead(cacheKey, settings.cacheTtlMs);
      if (cached) return Object.assign({}, cached, { cached: true });
    }

    const outcome = await requestBackend({ id: cleanId });
    if (outcome.kind === "status") {
      return { status: outcome.status, video: null, message: outcome.message };
    }

    const { payload, httpStatus } = outcome;
    const backendStatus = typeof payload.status === "string" ? payload.status : "";

    if (backendStatus === "ok") {
      const video = normalizeSearchItem(payload.item, settings);
      if (!video) {
        return { status: "unconfirmed", video: null, message: MESSAGES.unconfirmed };
      }
      const result = {
        status: "ok",
        video,
        message: "",
        meta: sanitizeMeta(payload.meta),
        cached: false
      };
      cacheWrite(cacheKey, result, settings.cacheTtlMs);
      return result;
    }

    if (INSPECT_REASONS[backendStatus]) {
      const result = {
        status: backendStatus,
        video: null,
        message: typeof payload.error === "string" && payload.error.trim()
          ? payload.error.trim()
          : INSPECT_REASONS[backendStatus],
        cached: false
      };
      cacheWrite(cacheKey, result, Math.min(settings.cacheTtlMs, 120000));
      return result;
    }

    const failure = transportFailure(httpStatus, payload);
    return { status: failure.status, video: null, message: failure.message };
  }

  /* ------------------------------------------------------------------ */
  /* Seletor modal "Procurar vídeo" para o editor de rotinas             */
  /* ------------------------------------------------------------------ */

  async function openPicker(options = {}) {
    const exercise = options.exercise || { name: "" };
    const doc = global.document;
    const settings = searchSettings();
    const exerciseName = typeof exercise.name === "string" && exercise.name.trim()
      ? exercise.name.trim()
      : "este exercício";

    const currentCustom = F.normalizeYouTubeVideo(exercise.youtubeVideo);
    let selectedVideo = currentCustom ? Object.assign({}, currentCustom) : null;
    let previewIframe = null;
    let searching = false;

    const root = doc.createElement("div");
    root.className = "video-picker";

    /* Identificação do exercício selecionado. */
    const exerciseTag = doc.createElement("p");
    exerciseTag.className = "video-picker-exercise";
    const exerciseTagLabel = doc.createElement("span");
    exerciseTagLabel.className = "video-picker-exercise-label";
    exerciseTagLabel.textContent = "Exercício";
    const exerciseTagName = doc.createElement("strong");
    exerciseTagName.className = "video-picker-exercise-name";
    exerciseTagName.textContent = exerciseName;
    exerciseTag.append(exerciseTagLabel, exerciseTagName);
    if (exercise.mode === "weights" || exercise.mode === "calisthenics" ||
        options.mode === "weights" || options.mode === "calisthenics") {
      const modeKey = exercise.mode === "weights" || exercise.mode === "calisthenics"
        ? exercise.mode
        : options.mode;
      const exerciseTagMode = doc.createElement("span");
      exerciseTagMode.className = "video-picker-exercise-mode";
      exerciseTagMode.textContent = (F.MODE_NAMES && F.MODE_NAMES[modeKey]) || "";
      if (exerciseTagMode.textContent) exerciseTag.appendChild(exerciseTagMode);
    }
    root.appendChild(exerciseTag);

    const intro = doc.createElement("p");
    intro.className = "video-picker-intro";
    intro.textContent =
      "Pesquise pelo nome do exercício ou por um termo relacionado. São exibidos apenas vídeos " +
      "convencionais do YouTube em formato horizontal (16:9) com até 60 segundos. A escolha vale " +
      "somente para este treino personalizado.";
    root.appendChild(intro);

    /* Barra de busca */
    const searchRow = doc.createElement("div");
    searchRow.className = "video-picker-search-row";

    const searchInput = doc.createElement("input");
    searchInput.type = "search";
    searchInput.className = "video-picker-query";
    searchInput.value = exerciseName === "este exercício" ? "" : exerciseName;
    searchInput.placeholder = "Nome do exercício ou termo relacionado";
    searchInput.setAttribute("aria-label", "Pesquisar vídeo pelo nome do exercício ou termo relacionado");

    const searchBtn = doc.createElement("button");
    searchBtn.type = "button";
    searchBtn.className = "secondary-button small-button video-picker-search-btn";
    searchBtn.textContent = "Pesquisar";

    searchRow.appendChild(searchInput);
    searchRow.appendChild(searchBtn);
    root.appendChild(searchRow);

    /* Status + lista de resultados */
    const statusBox = doc.createElement("p");
    statusBox.className = "video-picker-status";
    statusBox.hidden = true;
    statusBox.setAttribute("role", "status");
    statusBox.setAttribute("aria-live", "polite");
    root.appendChild(statusBox);

    const resultsList = doc.createElement("div");
    resultsList.className = "video-picker-results";
    resultsList.setAttribute("role", "listbox");
    resultsList.setAttribute("aria-label", "Resultados de vídeos convencionais horizontais do YouTube");
    root.appendChild(resultsList);

    /* Pré-visualização 16:9 (silenciosa, sem autoplay, com controles) */
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
    previewFrameBox.dataset.videoFraming = "original";

    const previewHint = doc.createElement("p");
    previewHint.className = "video-picker-preview-hint";
    previewHint.textContent =
      "Prévia em 16:9, sem reprodução automática e sem áudio. Use os controles do player para " +
      "assistir e confirme em seguida.";

    previewWrap.appendChild(previewHeader);
    previewWrap.appendChild(previewFrameBox);
    previewWrap.appendChild(previewHint);
    root.appendChild(previewWrap);

    /* Entrada opcional de link direto (somente vídeos convencionais) */
    const directBox = doc.createElement("div");
    directBox.className = "video-picker-direct";

    const directLabel = doc.createElement("label");
    directLabel.className = "video-picker-direct-label";
    directLabel.textContent = "Ou informe o link de um vídeo convencional do YouTube (até 60 segundos)";

    const directRow = doc.createElement("div");
    directRow.className = "video-picker-direct-row";

    const directInput = doc.createElement("input");
    directInput.type = "url";
    directInput.className = "video-picker-url-input";
    directInput.placeholder = "https://www.youtube.com/watch?v=...";
    directInput.setAttribute("aria-label", "Link de vídeo convencional do YouTube");

    const directBtn = doc.createElement("button");
    directBtn.type = "button";
    directBtn.className = "secondary-button small-button video-picker-url-btn";
    directBtn.textContent = "Visualizar";

    directRow.appendChild(directInput);
    directRow.appendChild(directBtn);
    directBox.appendChild(directLabel);
    directBox.appendChild(directRow);

    const directNote = doc.createElement("p");
    directNote.className = "video-picker-direct-note";
    directNote.textContent = "Somente vídeos horizontais (16:9) com até 60 segundos são aceitos.";
    directBox.appendChild(directNote);
    root.appendChild(directBox);

    const validationMsg = doc.createElement("p");
    validationMsg.className = "video-picker-error";
    validationMsg.hidden = true;
    validationMsg.setAttribute("role", "alert");
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

    /* Estado de carregamento: entrada, botões e confirmação ficam bloqueados. */
    function setBusy(busy) {
      searching = Boolean(busy);
      searchBtn.disabled = searching;
      searchInput.disabled = searching;
      directBtn.disabled = searching;
      directInput.disabled = searching;
      searchBtn.textContent = searching ? "Pesquisando…" : "Pesquisar";
      directBtn.textContent = searching ? "Verificando…" : "Visualizar";
      resultsList.setAttribute("aria-busy", searching ? "true" : "false");
      root.classList.toggle("is-busy", searching);
      const confirmBtn = doc.querySelector('.modal-backdrop [data-modal-action="confirm"]');
      if (confirmBtn) confirmBtn.disabled = searching;
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

    function mountPreview(video) {
      /* Só chega aqui vídeo horizontal confirmado; a validação é repetida. */
      if (!video || !F.isConfirmedHorizontalVideo(video)) {
        setValidationError(MESSAGES.unconfirmed);
        return;
      }
      const normalized = F.normalizeYouTubeVideo(Object.assign({}, video, { framing: "original" }));
      if (!normalized) {
        setValidationError(
          "Vídeo inválido. Escolha um vídeo convencional horizontal de até 60 segundos."
        );
        return;
      }
      selectedVideo = Object.assign({}, normalized, { orientation: "horizontal" });
      setValidationError("");
      clearPreviewIframe();

      previewLabel.textContent = normalized.title || exerciseName;
      const metaParts = [];
      if (normalized.channelTitle) metaParts.push(normalized.channelTitle);
      if (normalized.durationSeconds) metaParts.push(formatDuration(normalized.durationSeconds));
      metaParts.push("Horizontal 16:9");
      previewMeta.textContent = metaParts.join(" · ");

      previewIframe = doc.createElement("iframe");
      previewIframe.className = "video-demo-iframe video-picker-preview-iframe";
      previewIframe.src = buildEmbedUrl(normalized.videoId);
      previewIframe.title =
        "Prévia do vídeo: " + (normalized.title || exerciseName);
      previewIframe.setAttribute(
        "allow",
        "accelerometer; encrypted-media; gyroscope; picture-in-picture"
      );
      previewIframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      previewIframe.setAttribute("allowfullscreen", "");
      previewFrameBox.appendChild(previewIframe);

      previewWrap.hidden = false;
      syncSelectedCards();
    }

    function resultCard(item) {
      const card = doc.createElement("button");
      card.type = "button";
      card.className = "video-result-card";
      card.dataset.videoId = item.videoId;
      card.dataset.videoOrientation = "horizontal";
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", "false");
      card.setAttribute(
        "aria-label",
        "Visualizar " + (item.title || "vídeo " + item.videoId) +
        " (" + formatDuration(item.durationSeconds) + ", horizontal 16:9)"
      );

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
      channelParts.push("Horizontal 16:9");

      const channelEl = doc.createElement("span");
      channelEl.className = "video-result-channel";
      channelEl.textContent = channelParts.join(" · ");

      const previewAction = doc.createElement("span");
      previewAction.className = "video-result-cta";
      previewAction.textContent = "Visualizar";

      body.appendChild(titleEl);
      body.appendChild(channelEl);
      body.appendChild(previewAction);

      card.appendChild(thumbBox);
      card.appendChild(body);

      card.addEventListener("click", () => mountPreview(item));
      return card;
    }

    function renderResults(items) {
      while (resultsList.firstChild) resultsList.removeChild(resultsList.firstChild);
      items.forEach(item => resultsList.appendChild(resultCard(item)));
      syncSelectedCards();
    }

    function renderEmptyResults(message) {
      while (resultsList.firstChild) resultsList.removeChild(resultsList.firstChild);
      const empty = doc.createElement("p");
      empty.className = "video-picker-empty";
      empty.textContent = message;
      resultsList.appendChild(empty);
    }

    function renderLoading(message) {
      while (resultsList.firstChild) resultsList.removeChild(resultsList.firstChild);
      const loading = doc.createElement("p");
      loading.className = "video-picker-loading";
      const spinner = doc.createElement("span");
      spinner.className = "video-picker-spinner";
      spinner.setAttribute("aria-hidden", "true");

      const label = doc.createElement("span");
      label.className = "video-picker-loading-text";
      label.textContent = message;

      loading.appendChild(spinner);
      loading.appendChild(label);
      resultsList.appendChild(loading);
    }

    async function executeSearch(forceRefresh) {
      const query = searchInput.value.trim();
      if (query.length < 2) {
        renderResults([]);
        setStatus(MESSAGES.emptyQuery, "empty");
        return;
      }

      setValidationError("");
      setStatus(MESSAGES.loading, "loading");
      renderLoading(MESSAGES.loading);
      setBusy(true);

      let response;
      try {
        response = await searchYouTube(query, { refresh: forceRefresh === true });
      } catch (error) {
        setBusy(false);
        renderResults([]);
        setStatus(MESSAGES.error, "error");
        return;
      }
      setBusy(false);

      if (response.status === "ok") {
        if (response.items.length) {
          renderResults(response.items);
          setStatus(
            response.cached
              ? "Resultados da pesquisa anterior (cache). Somente vídeos horizontais de até 60 segundos."
              : "",
            response.cached ? "cached" : ""
          );
        } else {
          renderEmptyResults(response.message || MESSAGES.empty);
          setStatus(response.message || MESSAGES.empty, "empty");
        }
        return;
      }

      renderResults([]);
      const modifier = response.status === "quota" || response.status === "unconfigured" ||
        response.status === "unavailable" || response.status === "empty-query"
        ? "unconfigured"
        : "error";
      setStatus(response.message || MESSAGES.error, modifier);
    }

    async function handleDirectLink() {
      const raw = directInput.value.trim();
      if (!raw) {
        setValidationError("Informe um link de vídeo convencional do YouTube para visualizar.");
        return;
      }

      /* Short identificado apenas pelo endereço: bloqueio imediato. */
      if (F.isYouTubeShortsUrl(raw)) {
        setValidationError(MESSAGES.shortsBlocked);
        return;
      }

      const parsed = F.parseYouTubeUrl(raw);
      if (!parsed) {
        setValidationError(MESSAGES.invalidUrl);
        return;
      }
      if (parsed.isShort) {
        setValidationError(MESSAGES.shortsBlocked);
        return;
      }

      setValidationError("");
      setStatus("Verificando o vídeo informado…", "loading");
      setBusy(true);

      let inspection;
      try {
        inspection = await inspectVideo(parsed.videoId);
      } catch (error) {
        inspection = { status: "error", video: null, message: MESSAGES.error };
      }

      if (inspection.status === "ok" && inspection.video) {
        setBusy(false);
        setStatus("", "");
        mountPreview(inspection.video);
        return;
      }

      if (inspection.status !== "unavailable" && inspection.status !== "unconfigured" &&
          inspection.status !== "error") {
        setBusy(false);
        setStatus("", "");
        setValidationError(
          inspection.message ||
          (inspection.status === "vertical" ? MESSAGES.shortsBlocked : MESSAGES.unconfirmed)
        );
        return;
      }

      /*
        Sem backend (ou backend indisponível): confirmação local pela geometria
        da miniatura. Se não der para confirmar que é horizontal, não libera.
      */
      let orientation = "unknown";
      try {
        orientation = await probeOrientation(parsed.videoId);
      } catch (error) {
        orientation = "unknown";
      }
      setBusy(false);
      setStatus("", "");

      if (orientation === "vertical") {
        setValidationError(MESSAGES.shortsBlocked);
        return;
      }
      if (orientation !== "horizontal") {
        setValidationError(MESSAGES.unconfirmed);
        return;
      }

      mountPreview({
        videoId: parsed.videoId,
        title: exerciseName === "este exercício" ? "Vídeo selecionado" : exerciseName + " (YouTube)",
        channelTitle: "YouTube",
        framing: "original",
        orientation: "horizontal"
      });
    }

    searchBtn.addEventListener("click", () => {
      executeSearch(false);
    });
    searchInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        executeSearch(false);
      }
    });
    directBtn.addEventListener("click", () => {
      handleDirectLink();
    });
    directInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleDirectLink();
      }
    });

    if (currentCustom) {
      mountPreview(Object.assign({}, currentCustom, { orientation: "horizontal" }));
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

    /* O modal abre imediatamente; a pesquisa roda com o estado de carregamento visível. */
    const modalPromise = F.showModal({
      title: "Procurar vídeo",
      message: "Demonstração em vídeo de " + exerciseName + " neste treino personalizado.",
      details: root,
      fields: [],
      submitActions: ["confirm"],
      validate() {
        const candidate = selectedVideo ? F.normalizeYouTubeVideo(selectedVideo) : null;
        if (!candidate || !F.isValidYouTubeVideoShape(candidate) ||
            !F.isConfirmedHorizontalVideo(selectedVideo)) {
          const msg = MESSAGES.selectFirst;
          setValidationError(msg);
          return { ok: false, message: msg };
        }
        return { ok: true };
      },
      actions
    });

    if (searchInput.value.trim().length >= 2 && hasSearchCredentials()) {
      executeSearch(false);
    } else if (!hasSearchCredentials()) {
      setStatus(MESSAGES.unavailable, "unconfigured");
    }

    const modalResult = await modalPromise;

    clearPreviewIframe();
    setBusy(false);

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
    EMBED_PARAMS,
    DEFAULT_SEARCH_ENDPOINT: defaultSearchEndpoint(),
    MESSAGES,
    available,
    officialFor,
    resolve,
    buildEmbedUrl,
    buildWatchUrl,
    formatDuration,
    probeAvailability,
    probeOrientation,
    createStage,
    renderStage,
    destroyStage,
    searchSettings,
    searchEndpoint,
    hasSearchCredentials,
    searchYouTube,
    inspectVideo,
    clearSearchCache,
    searchCacheStats,
    openPicker,
    setAvailabilityChecker(fn) {
      customAvailabilityChecker = typeof fn === "function" ? fn : null;
    },
    setSearchFetcher(fn) {
      customSearchFetcher = typeof fn === "function" ? fn : null;
      clearSearchCache();
    },
    setOrientationProber(fn) {
      customOrientationProber = typeof fn === "function" ? fn : null;
    }
  };
})(window);
