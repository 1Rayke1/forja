/*
  FORJA — componentes compartilhados de interface.

  Um app multipágina sem build só fica consistente se as peças básicas vierem
  de um lugar só. Este módulo fornece fábricas de elementos (cartão, estado
  vazio, segmentado, chip, estatística, lista, tabela de dados), o conjunto de
  ícones, a região de anúncios para leitores de tela e utilitários de foco.

  Regras do módulo:
  - Não conhece chaves de armazenamento nem páginas específicas: recebe dados
    prontos e devolve elementos.
  - Todo texto entra por `textContent` (nunca HTML concatenado), então dados do
    usuário não viram marcação.
  - Interação por teclado primeiro: os controles usam `button` nativos,
    `aria-pressed`/`aria-current` e foco gerenciado por quem chama.
  - Nada de animação própria: as transições vêm de `system.css`, que respeita
    `prefers-reduced-motion`.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  /* ------------------------------------------------------------------ */
  /* Ícones (24×24, traço de 2, corrente com o texto)                    */
  /* ------------------------------------------------------------------ */

  const ICON_PATHS = {
    dumbbell: "M6 6.5v11M18 6.5v11M3 9.5v5M21 9.5v5M6 12h12",
    calendar: "M4 8h16M7 4v3M17 4v3M5 6h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM8 13h3M8 16h6",
    chart: "M4 19V9M10 19V5M16 19v-7M22 19H2",
    target: "M12 3v3M12 18v3M3 12h3M18 12h3M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z",
    clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    play: "M8 5.5v13l11-6.5-11-6.5Z",
    pause: "M9 5v14M15 5v14",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.5 15.5 21 21",
    "chevron-left": "M15 5l-7 7 7 7",
    "chevron-right": "M9 5l7 7-7 7",
    "arrow-right": "M4 12h15M13 6l6 6-6 6",
    check: "M4 12.5 9 18 20 6",
    close: "M6 6l12 12M18 6 6 18",
    edit: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM15 6l3 3",
    trash: "M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13M11 11v6M13 11v6",
    copy: "M9 9h10v10H9zM5 15V5h10",
    flag: "M6 21V4h11l-2 4 2 4H6",
    info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v6M12 7.5h.01",
    alert: "M12 3 2.5 20h19L12 3ZM12 10v4M12 17h.01",
    timer: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 9v4l2.5 1.5M9 2h6",
    ruler: "M3 15 15 3l6 6L9 21l-6-6ZM8 8l2 2M11 5l2 2M5 11l2 2",
    book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5ZM4 18.5A2.5 2.5 0 0 1 6.5 16H19",
    settings: "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM19.4 13a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2A1.6 1.6 0 0 0 6 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 1 13.6H1a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 2.6 6a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 8 1.6h.1A2 2 0 1 1 12 1.4v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20.6 8h.2a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.2.9Z",
    database: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3ZM4 9v6c0 1.7 3.6 3 8 3s8-1.3 8-3V9M4 15v3c0 1.7 3.6 3 8 3s8-1.3 8-3v-3",
    flame: "M12 22c3.9 0 6-2.5 6-5.5 0-4-4-5.5-3-9.5-3 1-4.5 3.5-4.5 6C10.5 10 9 9 9 7c-2 1.5-3 3.9-3 6.5C6 19.5 8.1 22 12 22Z",
    bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
    repeat: "M4 9V8a4 4 0 0 1 4-4h9m0 0-3-3m3 3-3 3M20 15v1a4 4 0 0 1-4 4H7m0 0 3 3m-3-3 3-3",
    layers: "M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 17l9 5 9-5",
    filter: "M4 5h16l-6 7v6l-4 2v-8L4 5Z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-3.3 3.6-5.5 8-5.5s8 2.2 8 5.5",
    history: "M12 7v5l3 2M3.5 12A8.5 8.5 0 1 1 12 20.5a8.5 8.5 0 0 1-6.4-2.9M4 4v4h4"
  };

  function classNames() {
    return Array.prototype.slice.call(arguments).filter(Boolean).join(" ");
  }

  function icon(name, extraClass) {
    const span = doc.createElement("span");
    span.className = "ui-icon" + (extraClass ? " " + extraClass : "");
    span.setAttribute("aria-hidden", "true");
    span.setAttribute("focusable", "false");

    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");

    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[name] || ICON_PATHS.info);
    svg.appendChild(path);
    span.appendChild(svg);

    return span;
  }

  /* ------------------------------------------------------------------ */
  /* Blocos básicos                                                       */
  /* ------------------------------------------------------------------ */

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /* `variant` usa as classes do próprio design system, para que botão e link
     de ação tenham exatamente a mesma aparência em toda a aplicação. */
  function button(options) {
    const node = el("button", classNames("ui-button", options.variant || "secondary-button", options.className));
    node.type = "button";
    node.textContent = options.label || "";

    if (options.icon) node.insertBefore(icon(options.icon), node.firstChild);
    if (options.disabled) node.disabled = true;
    if (options.ariaLabel) node.setAttribute("aria-label", options.ariaLabel);
    if (options.title) node.title = options.title;
    if (options.id) node.id = options.id;
    if (typeof options.onClick === "function") node.addEventListener("click", options.onClick);

    return node;
  }

  function linkButton(options) {
    const node = el("a", classNames("ui-button", options.variant || "secondary-button", options.className));
    node.href = options.href;
    node.textContent = options.label || "";
    if (options.icon) node.insertBefore(icon(options.icon), node.firstChild);
    if (options.ariaLabel) node.setAttribute("aria-label", options.ariaLabel);
    if (options.id) node.id = options.id;
    return node;
  }

  function chip(text, tone) {
    const node = el("span", "ui-chip" + (tone ? " ui-chip-" + tone : ""));
    node.textContent = String(text);
    return node;
  }

  function stat(options) {
    const wrap = el("div", "ui-stat" + (options.tone ? " is-" + options.tone : ""));
    const value = el("div", "ui-stat-value", options.value === undefined || options.value === null ? "—" : options.value);
    const label = el("div", "ui-stat-label", options.label);

    wrap.append(value, label);

    if (options.hint) wrap.appendChild(el("div", "ui-stat-hint", options.hint));

    return wrap;
  }

  function statRow(items, className) {
    const row = el("div", "ui-stats" + (className ? " " + className : ""));
    row.setAttribute("role", "list");
    items.forEach(item => {
      const node = stat(item);
      node.setAttribute("role", "listitem");
      row.appendChild(node);
    });
    return row;
  }

  /*
    Estado vazio útil: diz o que falta e oferece o caminho. Nunca é um
    placeholder decorativo com números falsos.
  */
  function empty(options) {
    const card = el("div", "ui-empty");

    if (options.icon) card.appendChild(icon(options.icon, "ui-empty-icon"));

    const body = el("div", "ui-empty-body");
    body.appendChild(el("strong", "ui-empty-title", options.title));
    if (options.text) body.appendChild(el("p", "ui-empty-text", options.text));

    if (Array.isArray(options.actions) && options.actions.length > 0) {
      const actions = el("div", "ui-empty-actions");
      options.actions.forEach(action => {
        actions.appendChild(action.href ? linkButton(action) : button(action));
      });
      body.appendChild(actions);
    }

    card.appendChild(body);
    return card;
  }

  function sectionHead(options) {
    const head = el("div", "ui-section-head");
    const text = el("div", "ui-section-text");

    /*
      `headingLevel` permite que o título principal de uma página criada por
      componente seja um h1 (Biblioteca), mantendo h2 como padrão nos blocos
      internos. A classe e o visual continuam os mesmos.
    */
    const level = options.headingLevel === "h1" ? "h1" : "h2";
    const title = el(level, "ui-section-title", options.title);
    if (options.id) title.id = options.id;
    text.appendChild(title);

    if (options.note) text.appendChild(el("p", "ui-section-note", options.note));
    head.appendChild(text);

    if (Array.isArray(options.actions) && options.actions.length > 0) {
      const actions = el("div", "ui-section-actions");
      options.actions.forEach(action => {
        actions.appendChild(action.href ? linkButton(action) : button(action));
      });
      head.appendChild(actions);
    }

    return head;
  }

  function card(options) {
    const node = el(options.as || "div", "ui-card" + (options.className ? " " + options.className : ""));

    if (options.labelledBy) node.setAttribute("aria-labelledby", options.labelledBy);

    if (options.title) {
      const head = el("div", "ui-card-head");
      head.appendChild(el(options.headingTag || "h3", "ui-card-title", options.title));
      if (options.subtitle) head.appendChild(el("p", "ui-card-subtitle", options.subtitle));
      if (options.action) {
        head.appendChild(options.action.href ? linkButton(options.action) : button(options.action));
      }
      node.appendChild(head);
    }

    const body = el("div", "ui-card-body");
    (options.children || []).forEach(child => {
      if (child) body.appendChild(child);
    });
    node.appendChild(body);

    return node;
  }

  /*
    Controle segmentado (filtros, abas). Renderiza botões com aria-pressed e
    navegação por setas, como um grupo de radio em termos de teclado.
  */
  function segmented(options) {
    const group = el("div", "ui-segmented");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", options.label || "Filtrar");
    if (options.id) group.id = options.id;

    const buttons = [];

    options.options.forEach(option => {
      const node = el("button", "ui-segment");
      node.type = "button";
      node.setAttribute("data-value", option.value);
      node.setAttribute("aria-pressed", String(option.value === options.value));

      const label = el("span", "ui-segment-label", option.label);
      node.appendChild(label);

      if (option.count !== undefined && option.count !== null) {
        node.appendChild(el("span", "ui-segment-count", option.count));
      }

      if (option.hint) node.title = option.hint;

      node.addEventListener("click", () => {
        if (typeof options.onChange === "function") options.onChange(option.value);
      });

      buttons.push(node);
      group.appendChild(node);
    });

    group.addEventListener("keydown", event => {
      const index = buttons.indexOf(doc.activeElement);
      if (index < 0) return;

      let next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = buttons[(index + 1) % buttons.length];
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = buttons[(index - 1 + buttons.length) % buttons.length];

      if (!next) return;
      event.preventDefault();
      next.focus();
      next.click();
    });

    return group;
  }

  /* Tabela acessível usada como leitura alternativa dos gráficos. */
  function table(options) {
    const node = el("table", "ui-table");
    const caption = el("caption", "ui-visually-hidden", options.caption || "Dados do gráfico");
    node.appendChild(caption);

    const head = doc.createElement("thead");
    const headRow = doc.createElement("tr");
    (options.columns || []).forEach(column => {
      const th = el("th", null, typeof column === "string" ? column : column.label);
      th.scope = "col";
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    node.appendChild(head);

    const body = doc.createElement("tbody");
    (options.rows || []).forEach(row => {
      const tr = doc.createElement("tr");
      row.forEach(cell => {
        const td = el("td", null, cell === null || cell === undefined ? "—" : cell);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    node.appendChild(body);

    return node;
  }

  function progressBar(percent, label) {
    const track = el("div", "ui-progress");
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));

    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuenow", String(value));
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    if (label) track.setAttribute("aria-label", label);

    const fill = el("div", "ui-progress-fill");
    fill.style.width = value + "%";
    track.appendChild(fill);

    if (label) {
      const caption = el("span", "ui-visually-hidden", label + ": " + value + "%");
      track.appendChild(caption);
    }

    return track;
  }

  function list(options) {
    const node = el("ul", "ui-list" + (options.className ? " " + options.className : ""));

    (options.items || []).forEach(item => {
      const li = doc.createElement("li");
      li.className = "ui-list-item" + (item.className ? " " + item.className : "");

      if (item.node) {
        li.appendChild(item.node);
      } else {
        const main = el("div", "ui-list-main");
        main.appendChild(el("strong", "ui-list-title", item.title));
        if (item.meta) main.appendChild(el("span", "ui-list-meta", item.meta));
        li.appendChild(main);
      }

      if (Array.isArray(item.actions) && item.actions.length > 0) {
        const actions = el("div", "ui-list-actions");
        item.actions.forEach(action => {
          actions.appendChild(action.href ? linkButton(action) : button(action));
        });
        li.appendChild(actions);
      }

      node.appendChild(li);
    });

    return node;
  }

  /* Chips de filtro com estado pressionado (categorias, grupos musculares). */
  function filterChips(options) {
    const wrap = el("div", "ui-chips");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", options.label || "Filtros");
    if (options.id) wrap.id = options.id;

    options.options.forEach(option => {
      const node = el("button", "ui-chip-toggle");
      node.type = "button";
      node.setAttribute("data-value", option.value);
      node.setAttribute("aria-pressed", String(Boolean(option.active)));
      node.textContent = option.count === undefined || option.count === null
        ? option.label
        : option.label + " (" + option.count + ")";

      node.addEventListener("click", () => {
        if (typeof options.onChange === "function") options.onChange(option.value, !option.active);
      });

      wrap.appendChild(node);
    });

    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Diálogo de dados da página (reforço sobre F.showModal)               */
  /* ------------------------------------------------------------------ */

  async function confirmDestructive(options) {
    const details = doc.createElement("div");
    details.className = "modal-details";
    (options.lines || []).forEach(line => {
      details.appendChild(el("div", null, line));
    });

    const result = await F.showModal({
      title: options.title,
      message: options.message,
      details: options.lines && options.lines.length ? details : null,
      actions: [
        { id: "cancel", label: options.cancelLabel || "Cancelar", className: "secondary-button" },
        {
          id: options.confirmId || "confirm",
          label: options.confirmLabel || "Confirmar",
          className: "secondary-button danger-button"
        }
      ]
    });

    return result.action === (options.confirmId || "confirm");
  }

  /* ------------------------------------------------------------------ */
  /* Acessibilidade                                                       */
  /* ------------------------------------------------------------------ */

  let liveRegion = null;

  function announce(message) {
    if (!message) return;

    if (!liveRegion) {
      liveRegion = el("div", "ui-visually-hidden");
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.id = "forja-live-region";
      doc.body.appendChild(liveRegion);
    }

    liveRegion.textContent = "";
    global.setTimeout(() => {
      liveRegion.textContent = String(message);
    }, 30);
  }

  function prefersReducedMotion() {
    if (typeof global.matchMedia !== "function") return false;
    try {
      return global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (error) {
      return false;
    }
  }

  function focusFirst(container, selector) {
    if (!container) return;

    const target = container.querySelector(selector ||
      "button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])");

    if (target && typeof target.focus === "function") target.focus();
  }

  /* Marca o item atual da navegação principal (uma origem, todas as páginas). */
  function markCurrentNav(pageName) {
    const map = {
      inicio: "inicio",
      treino: "treino",
      calistenia: "treino",
      musculacao: "treino",
      biblioteca: "explorar",
      atlas: "explorar",
      rotina: "treino",
      executar: "treino",
      progresso: "progresso",
      configuracoes: "perfil",
      explorar: "explorar",
      perfil: "perfil"
    };

    const current = map[pageName] || pageName;

    doc.querySelectorAll("[data-nav]").forEach(node => {
      const active = node.getAttribute("data-nav") === current;
      node.classList.toggle("is-active", active);

      if (active) node.setAttribute("aria-current", "page");
      else node.removeAttribute("aria-current");
    });
  }

  /*
    A navegação é marcada a partir da página declarada no <body>, então nenhuma
    página precisa manter o destaque sincronizado à mão. O HTML traz o mesmo
    estado estático (classe `is-active` + `aria-current="page"`, os dois
    seletores que `app.css` estiliza) para o destaque existir antes do
    JavaScript rodar; aqui ele é confirmado ou corrigido.
  */
  function initCurrentNav() {
    markCurrentNav(doc.body && doc.body.dataset ? doc.body.dataset.page : "");
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", initCurrentNav);
  else initCurrentNav();

  /* Título relativo no cabeçalho de página: "Terça, 20 de outubro". */
  function todayEyebrow() {
    const now = new Date();
    return F.formatDate(now, { weekday: "long", day: "numeric", month: "long" });
  }

  const ui = F.ui = {
    ICON_PATHS,
    el,
    icon,
    button,
    linkButton,
    chip,
    stat,
    statRow,
    empty,
    card,
    sectionHead,
    segmented,
    filterChips,
    list,
    table,
    progressBar,
    confirmDestructive,
    announce,
    prefersReducedMotion,
    focusFirst,
    markCurrentNav,
    todayEyebrow
  };

  F.formatPlannedValue = function formatPlannedValue(exercise) {
    if (!exercise) return "—";

    if (exercise.type === "duration") return F.formatRestValue(exercise.duration) + " por série";
    if (exercise.measure === "distance" && exercise.distance) {
      return F.formatDistance(exercise.distanceUnit === "km" ? exercise.distance * 1000 : exercise.distance);
    }
    return (exercise.reps || "—") + " repetições";
  };

  F.formatMeasure = function formatMeasure(exercise) {
    const measure = (exercise && exercise.measure) || "reps";
    return F.MEASURE_NAMES[measure] || F.MEASURE_NAMES.reps;
  };

  ui.markCurrentNav = markCurrentNav;
})(window);
