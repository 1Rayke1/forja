/* Demonstrações YouTube aprovadas. Nenhuma credencial ou dado administrativo
   chega a este módulo público; o catálogo editorial permanece imutável. */
(function (global) {
  "use strict";
  const F = global.Forja;
  const doc = global.document;
  if (!F || !doc) return;

  const API_URL = /(^|\.)netlify\.app$/.test(global.location.hostname)
    ? "/.netlify/functions/youtube-videos"
    : "https://prismatic-parfait-be3644.netlify.app/.netlify/functions/youtube-videos";
  let pendingRequest = null;
  let associations = new Map();

  function canonicalId(record) {
    const id = record && (record.libraryId || record.id);
    return F.exerciseCatalog?.legacyIdMap?.[id] || id;
  }

  async function loadApproved(force) {
    if (typeof global.fetch !== "function") return associations;
    if (force) { pendingRequest = null; associations = new Map(); }
    if (pendingRequest) return pendingRequest;
    pendingRequest = global.fetch(API_URL, {
      method: "GET", headers: { accept: "application/json" }, credentials: "omit",
      referrerPolicy: "no-referrer"
    }).then(response => {
      if (!response.ok) throw new Error("videos-unavailable");
      return response.json();
    }).then(payload => {
      const next = new Map();
      (Array.isArray(payload.associations) ? payload.associations : []).forEach(item => {
        if (item && item.status === "validated" && F.exerciseCatalog?.byId(item.exerciseId) &&
            /^[A-Za-z0-9_-]{11}$/.test(item.videoId || "") &&
            item.youtubeUrl === "https://www.youtube.com/watch?v=" + item.videoId &&
            item.durationSeconds >= 1 && item.durationSeconds <= 60 && item.visibility === "public" &&
            item.embeddable === true && item.orientation === "horizontal" && item.aspectRatio === "16:9") {
          next.set(item.exerciseId, item);
        }
      });
      associations = next;
      return associations;
    }).catch(() => associations);
    return pendingRequest;
  }

  function unavailable(host, record) {
    host.replaceChildren();
    const note = F.ui.el("p", "youtube-unavailable",
      "Demonstração indisponível. A imagem de referência foi mantida e a revisão administrativa é necessária.");
    host.appendChild(note);
    const modal = host.closest(".modal-details");
    modal?.querySelectorAll(".demo-media, .demo-fallback").forEach(node => { node.hidden = false; });
  }

  function playerNode(record, association, host) {
    const figure = F.ui.el("figure", "youtube-media");
    figure.dataset.exerciseId = association.exerciseId;
    figure.dataset.videoId = association.videoId;
    const frame = F.ui.el("div", "youtube-frame");
    const iframe = doc.createElement("iframe");
    iframe.className = "youtube-player";
    iframe.width = "1280";
    iframe.height = "720";
    iframe.title = "Demonstração em vídeo de " + record.name;
    iframe.src = "https://www.youtube-nocookie.com/embed/" + association.videoId +
      "?autoplay=0&mute=1&controls=1&playsinline=1&rel=0";
    iframe.loading = "lazy";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allowFullscreen = true;
    iframe.addEventListener("error", () => unavailable(host, record), { once: true });
    frame.appendChild(iframe);
    figure.appendChild(frame);
    const caption = F.ui.el("figcaption", "youtube-caption");
    caption.appendChild(F.ui.el("span", "", association.channelTitle || "YouTube"));
    const link = doc.createElement("a");
    link.href = association.youtubeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Abrir no YouTube";
    caption.appendChild(link);
    figure.appendChild(caption);
    return figure;
  }

  async function render(record, host) {
    if (!record || !host || !F.exerciseCatalog?.byId(canonicalId(record))) return;
    const loaded = await loadApproved(false);
    /* O modal pode ser anexado no próximo animation frame. Não descartar uma
       resposta rápida (cache/CDN) só porque ela chegou antes dessa montagem. */
    for (let attempt = 0; !host.isConnected && attempt < 10; attempt += 1) {
      await new Promise(resolve => global.requestAnimationFrame ? global.requestAnimationFrame(resolve) : setTimeout(resolve, 0));
    }
    if (!host.isConnected) return;
    const association = loaded.get(canonicalId(record));
    if (!association) { host.replaceChildren(); return; }
    host.replaceChildren(playerNode(record, association, host));
    const modal = host.closest(".modal-details");
    modal?.querySelectorAll(".demo-media, .demo-fallback").forEach(node => { node.hidden = true; });
  }

  F.youtube = Object.freeze({
    API_URL,
    loadApproved,
    approvedFor: record => associations.get(canonicalId(record)) || null,
    render,
    _resetForTests() { pendingRequest = null; associations = new Map(); }
  });
})(window);
