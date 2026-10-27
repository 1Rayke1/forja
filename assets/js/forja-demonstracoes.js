/*
  FORJA — demonstrações visuais de exercícios (RepDB, free tier).

  Carregado depois de `forja-demonstracoes-dados.js` e de `forja-ui.js`.
  Não grava nada, não faz requisições e não cria timers: todas as imagens
  são arquivos locais resolvidos por F.url() (compatível com /forja/).

  Regras de produto (docs/demonstracoes-revisao.md):
  - Um candidato só é "confirmado" quando status=exact E a revisão visual
    documentada em mapeamento.json é "confirmed".
  - status=review, revisão pendente/aproximada, exercício personalizado ou
    escolha manual recebem SEMPRE o selo "Precisa de revisão".
  - Exercício personalizado nunca recebe correspondência automática por nome:
    o seletor mostra o catálogo para escolha manual.
  - Um demoId que deixou de existir volta ao padrão; nunca imagem quebrada.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;
  const DATA = global.FORJA_DEMOS_DATA || null;

  const REVIEW_LABEL = "Precisa de revisão";
  const FALLBACK_TEXT = "Demonstração visual ainda não disponível.";
  const NONE_TEXT = "Sem demonstração para este exercício.";
  const NO_RESULTS_TEXT = "Nenhuma imagem encontrada para este exercício. A demonstração atual foi mantida.";

  function available() {
    return Boolean(DATA && DATA.demos && DATA.exercicios);
  }

  function source() {
    return DATA ? DATA.source : null;
  }

  function credit(creditId) {
    return DATA && DATA.creditos ? DATA.creditos[creditId || "repdb"] || null : null;
  }

  function creditsUrl() {
    return F.url("configuracoes") + "#creditos-imagens";
  }

  function assetUrl(file) {
    return F.url("assets/demonstracoes/" + file);
  }

  function normalizeText(value) {
    return String(value === undefined || value === null ? "" : value)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function get(demoId) {
    if (!available()) return null;
    const raw = DATA.demos[demoId];
    if (!raw) return null;
    return {
      demoId,
      label: raw.l,
      nameEn: raw.n,
      creditId: raw.c,
      thumb: { file: raw.t, url: assetUrl(raw.t) },
      poses: (raw.p || []).map(pose => ({ kind: pose[0], file: pose[1], url: assetUrl(pose[1]) }))
    };
  }

  function reviewOf(demoId) {
    return available() && DATA.reviews ? (DATA.reviews[demoId] || "pending") : "pending";
  }

  function entryFor(record, mode) {
    if (!available() || !record) return null;
    const origin = record.libraryId || record.id;
    if (!origin) return null;
    const key = (mode || record.mode || "") + ":" + origin;
    const entry = DATA.exercicios[key];
    return entry ? Object.assign({ key }, entry) : null;
  }

  function statusFor(entry, demoId) {
    if (!entry) return "review";
    const found = (entry.c || []).find(candidate => candidate[0] === demoId);
    return found ? found[1] : "review";
  }

  function confirmationFor(status, demoId) {
    return status === "exact" && reviewOf(demoId) === "confirmed" ? "confirmed" : "review";
  }

  /*
    Resolve a demonstração a mostrar.
    Ordem: escolha explícita -> padrão do catálogo -> nenhuma.
    Uma escolha explícita inválida é ignorada (stale) sem quebrar a imagem.
  */
  function resolve(record, mode) {
    if (!available() || !record) return null;

    const entry = entryFor(record, mode);
    const explicit = F.normalizeDemoId(record.demoId);
    if (explicit === F.DEMO_NONE) return null;

    let demoId = null;
    let stale = false;

    if (explicit && get(explicit)) {
      demoId = explicit;
    } else if (explicit) {
      stale = true;
    }

    if (!demoId && entry && entry.d && get(entry.d)) demoId = entry.d;
    if (!demoId) return null;

    const demo = get(demoId);
    const status = statusFor(entry, demoId);
    const info = credit(demo.creditId);

    return Object.assign({}, demo, {
      status,
      confirmation: confirmationFor(status, demoId),
      review: reviewOf(demoId),
      explicit: Boolean(explicit),
      stale,
      entryKey: entry ? entry.key : null,
      credit: info
    });
  }

  function fallbackText(record) {
    return record && F.normalizeDemoId(record.demoId) === F.DEMO_NONE ? NONE_TEXT : FALLBACK_TEXT;
  }

  /* Lista de candidatos para o seletor. Sem correspondência por nome. */
  function candidatesFor(record, mode) {
    if (!available()) return [];
    const entry = entryFor(record, mode);
    let list;

    if (entry) {
      list = (entry.c || []).map(candidate => ({
        demoId: candidate[0], status: candidate[1]
      }));
    } else {
      /* Exercício personalizado: navegação manual pelo catálogo inteiro. */
      list = Object.keys(DATA.demos).map(demoId => ({ demoId, status: "review" }));
    }

    const rank = { confirmed: 0, exact: 0, approximate: 1, pending: 2, rejected: 3 };
    return list
      .filter(item => reviewOf(item.demoId) !== "rejected" && get(item.demoId))
      .map(item => {
        const demo = get(item.demoId);
        return {
          demoId: item.demoId,
          label: demo.label,
          nameEn: demo.nameEn,
          thumb: demo.thumb,
          status: item.status,
          confirmation: confirmationFor(item.status, item.demoId),
          review: reviewOf(item.demoId),
          creditId: demo.creditId
        };
      })
      .sort((a, b) => {
        const byStatus = (a.status === "exact" ? 0 : 1) - (b.status === "exact" ? 0 : 1);
        if (byStatus) return byStatus;
        const byReview = (rank[a.review] || 2) - (rank[b.review] || 2);
        if (byReview) return byReview;
        return a.label.localeCompare(b.label, "pt-BR");
      });
  }

  /* ------------------------------------------------------------------ */
  /* Renderização                                                        */
  /* ------------------------------------------------------------------ */

  function creditNode(demo) {
    const wrap = F.ui.el("span", "demo-credit");
    const info = demo.credit || credit(demo.creditId);
    if (!info) return wrap;
    wrap.appendChild(F.ui.el("span", "demo-credit-label", "Ilustração: " + demo.label + " · "));

    const link = doc.createElement("a");
    link.href = info.attributionUrl;
    link.textContent = info.attribution;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("data-external-credit", "repdb");
    wrap.appendChild(link);

    wrap.appendChild(F.ui.el("span", "demo-credit-sep", " · "));
    const local = doc.createElement("a");
    local.href = creditsUrl();
    local.textContent = "Créditos e licença";
    local.className = "demo-credit-local";
    wrap.appendChild(local);
    return wrap;
  }

  function brokenNode(text) {
    return F.ui.el("div", "demo-fallback", text || FALLBACK_TEXT);
  }

  function createMedia(record, mode, options) {
    const settings = options || {};
    const demo = resolve(record, mode);
    if (!demo) return { node: brokenNode(fallbackText(record)), demo: null };

    const figure = F.ui.el("figure", "demo-media");
    figure.setAttribute("data-demo-id", demo.demoId);
    figure.setAttribute("data-confirmation", demo.confirmation);
    figure.setAttribute("data-demo-status", demo.status);

    const frame = F.ui.el("div", "demo-frame");
    const img = doc.createElement("img");
    img.className = "demo-image";
    img.alt = "Ilustração de " + demo.label + " (" + demo.nameEn + ") — RepDB";
    img.width = 512;
    img.height = 512;
    img.loading = settings.eager ? "eager" : "lazy";
    img.decoding = "async";

    const poses = demo.poses.length ? demo.poses : [demo.thumb];
    let active = 0;

    function showBroken() {
      frame.classList.add("is-broken");
      img.hidden = true;
      if (!frame.querySelector(".demo-frame-error")) {
        frame.appendChild(F.ui.el("span", "demo-frame-error", FALLBACK_TEXT));
      }
    }

    img.addEventListener("error", showBroken);
    img.src = poses[0].url;
    frame.appendChild(img);
    figure.appendChild(frame);

    if (poses.length > 1) {
      const controls = F.ui.el("div", "demo-poses");
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Posições da ilustração (alternância manual, sem animação)");
      const buttons = poses.map((pose, index) => {
        const button = F.ui.el("button", "demo-pose-button",
          pose.kind === "start" ? "Início" : pose.kind === "peak" ? "Pico" : "Posição");
        button.type = "button";
        button.setAttribute("aria-pressed", String(index === 0));
        button.addEventListener("click", () => {
          active = index;
          frame.classList.remove("is-broken");
          img.hidden = false;
          const error = frame.querySelector(".demo-frame-error");
          if (error) error.remove();
          img.src = pose.url;
          buttons.forEach((other, otherIndex) =>
            other.setAttribute("aria-pressed", String(otherIndex === active)));
        });
        controls.appendChild(button);
        return button;
      });
      figure.appendChild(controls);
    }

    const caption = F.ui.el("figcaption", "demo-caption");
    if (demo.confirmation !== "confirmed") {
      caption.appendChild(F.ui.el("span", "demo-badge", REVIEW_LABEL));
      caption.appendChild(F.ui.el("span", "demo-note",
        "Ilustração aproximada — confirme se corresponde ao movimento."));
    }
    caption.appendChild(creditNode(demo));
    if (demo.stale) {
      caption.appendChild(F.ui.el("span", "demo-note",
        " A imagem personalizada anterior não está mais disponível; o padrão foi mantido."));
    }
    figure.appendChild(caption);
    return { node: figure, demo };
  }

  function renderMedia(container, record, mode, options) {
    if (!container) return null;
    while (container.firstChild) container.removeChild(container.firstChild);
    const result = createMedia(record, mode, options);
    container.appendChild(result.node);
    container.hidden = false;
    return result.demo;
  }

  /* ------------------------------------------------------------------ */
  /* Seletor "Buscar outra imagem"                                       */
  /* ------------------------------------------------------------------ */

  const PAGE_SIZE = 12;

  function openPicker(options) {
    const settings = options || {};
    const record = settings.exercise || {};
    const mode = settings.mode || record.mode;
    /* Via F.demos para permitir stub determinístico nos testes. */
    const candidates = F.demos.candidatesFor(record, mode);
    const current = F.normalizeDemoId(record.demoId);

    if (!available() || candidates.length === 0) {
      const emptyDetails = F.ui.el("div", "demo-picker-empty");
      emptyDetails.appendChild(F.ui.el("p", "modal-detail-line", NO_RESULTS_TEXT));
      return F.showModal({
        title: "Buscar outra imagem",
        message: "Catálogo local de demonstrações",
        details: emptyDetails,
        fields: [],
        actions: [{ id: "cancel", label: "Fechar", className: "secondary-button" }]
      }).then(() => null);
    }

    let selected = current && get(current) ? current : null;
    let visible = PAGE_SIZE;
    let query = "";

    const details = F.ui.el("div", "demo-picker");
    const searchWrap = F.ui.el("div", "demo-picker-search");
    const search = doc.createElement("input");
    search.type = "search";
    search.className = "demo-picker-input";
    search.placeholder = "Buscar por nome, equipamento ou movimento";
    search.setAttribute("aria-label", "Buscar imagem de exercício");
    searchWrap.appendChild(search);
    details.appendChild(searchWrap);

    const preview = F.ui.el("div", "demo-picker-preview");
    details.appendChild(preview);

    const grid = F.ui.el("div", "demo-picker-grid");
    details.appendChild(grid);
    const more = F.ui.el("button", "secondary-button demo-picker-more", "Mostrar mais");
    more.type = "button";
    more.hidden = true;
    details.appendChild(more);

    const notice = F.ui.el("p", "demo-picker-notice",
      "Alternativas marcadas com “" + REVIEW_LABEL +
      "” mostram movimento diferente ou ainda não verificado. Confirme visualmente antes de usar como referência.");
    details.appendChild(notice);

    function filtered() {
      const needle = normalizeText(query);
      if (!needle) return candidates;
      return candidates.filter(item =>
        normalizeText(item.label + " " + item.nameEn).indexOf(needle) !== -1);
    }

    function renderPreview() {
      while (preview.firstChild) preview.removeChild(preview.firstChild);
      if (!selected) {
        preview.appendChild(F.ui.el("span", "demo-picker-preview-empty",
          "Selecione uma imagem para ver a prévia."));
        return;
      }
      const demo = get(selected);
      const frame = F.ui.el("div", "demo-picker-preview-frame");
      const img = doc.createElement("img");
      img.src = demo.thumb.url;
      img.alt = "Prévia: " + demo.label;
      img.width = 160;
      img.height = 160;
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => {
        frame.classList.add("is-broken");
        img.hidden = true;
        frame.appendChild(F.ui.el("span", "demo-frame-error", FALLBACK_TEXT));
      });
      frame.appendChild(img);
      preview.appendChild(frame);
      const info = F.ui.el("div", "demo-picker-preview-info");
      info.appendChild(F.ui.el("strong", "demo-picker-preview-label", demo.label));
      if (confirmationFor(statusFor(entryFor(record, mode), selected), selected) !== "confirmed") {
        info.appendChild(F.ui.el("span", "demo-badge", REVIEW_LABEL));
      }
      info.appendChild(creditNode(Object.assign({}, demo, {
        credit: credit(demo.creditId), confirmation: "review"
      })));
      preview.appendChild(info);
    }

    function renderGrid() {
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      const list = filtered();
      const shown = list.slice(0, visible);
      const cards = [];

      shown.forEach(item => {
        const card = doc.createElement("button");
        card.type = "button";
        card.className = "demo-card";
        card.setAttribute("data-demo-id", item.demoId);
        card.setAttribute("aria-pressed", String(item.demoId === selected));

        const thumb = F.ui.el("span", "demo-card-thumb");
        const img = doc.createElement("img");
        img.src = item.thumb.url;
        img.alt = "";
        img.width = 120;
        img.height = 120;
        img.loading = "lazy";
        img.decoding = "async";
        img.addEventListener("error", () => {
          card.disabled = true;
          card.setAttribute("data-broken", "true");
          thumb.classList.add("is-broken");
          img.hidden = true;
          thumb.appendChild(F.ui.el("span", "demo-frame-error", "Indisponível"));
          if (selected === item.demoId) {
            selected = null;
            cards.forEach(other => other.setAttribute("aria-pressed", "false"));
            renderPreview();
          }
        });
        thumb.appendChild(img);
        card.appendChild(thumb);
        card.appendChild(F.ui.el("span", "demo-card-label", item.label));
        card.appendChild(F.ui.el("span", "demo-card-en", item.nameEn));
        card.appendChild(F.ui.el("span", item.confirmation === "confirmed"
          ? "demo-card-status is-exact" : "demo-card-status is-review",
          item.confirmation === "confirmed" ? "Correspondência confirmada" : REVIEW_LABEL));
        const sourceLabel = credit(item.creditId);
        card.appendChild(F.ui.el("span", "demo-card-source",
          sourceLabel ? sourceLabel.label : "RepDB"));

        card.addEventListener("click", () => {
          selected = item.demoId;
          cards.forEach(other => other.setAttribute("aria-pressed",
            String(other.getAttribute("data-demo-id") === selected)));
          renderPreview();
        });
        cards.push(card);
        grid.appendChild(card);
      });

      if (shown.length === 0) {
        grid.appendChild(F.ui.el("p", "demo-picker-empty-list",
          "Nenhuma imagem encontrada para esta busca."));
      }
      more.hidden = list.length <= visible;
      more.textContent = "Mostrar mais (" + Math.max(0, list.length - visible) + ")";
    }

    search.addEventListener("input", () => {
      query = search.value;
      visible = PAGE_SIZE;
      renderGrid();
    });
    more.addEventListener("click", () => {
      visible += PAGE_SIZE;
      renderGrid();
    });

    renderPreview();
    renderGrid();

    return F.showModal({
      title: "Buscar outra imagem",
      message: "Escolha uma ilustração para " + (record.name || "este exercício") + ".",
      details,
      fields: [],
      submitActions: ["confirm"],
      validate() {
        if (!selected) {
          return { ok: false, message: "Selecione uma imagem antes de confirmar." };
        }
        return { ok: true };
      },
      actions: [
        { id: "cancel", label: "Cancelar", className: "secondary-button" },
        { id: "confirm", label: "Confirmar", className: "primary-button" },
        { id: "remove", label: "Remover escolha", className: "secondary-button" },
        { id: "none", label: "Sem demonstração", className: "secondary-button" }
      ]
    }).then(result => {
      if (result.action === "confirm" && selected) {
        if (typeof settings.onConfirm === "function") settings.onConfirm(selected);
        return selected;
      }
      if (result.action === "remove") {
        if (typeof settings.onConfirm === "function") settings.onConfirm(null);
        return null;
      }
      if (result.action === "none") {
        if (typeof settings.onConfirm === "function") settings.onConfirm(F.DEMO_NONE);
        return F.DEMO_NONE;
      }
      return undefined;
    });
  }

  F.demos = {
    available,
    source,
    credit,
    creditsUrl,
    assetUrl,
    get,
    reviewOf,
    entryFor,
    statusFor,
    confirmationFor,
    resolve,
    fallbackText,
    candidatesFor,
    createMedia,
    renderMedia,
    openPicker,
    normalizeDemoId: F.normalizeDemoId,
    REVIEW_LABEL,
    FALLBACK_TEXT,
    NONE_TEXT,
    NO_RESULTS_TEXT
  };
})(window);
