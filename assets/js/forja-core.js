/*
  FORJA — núcleo compartilhado.

  Carregado por todas as páginas. Define o espaço de nomes global `Forja`
  (um único objeto em `window`, sem escopos globais soltos), utilitários de
  formatação, navegação entre páginas, armazenamento seguro (localStorage),
  avisos (toast) e diálogos (modal).

  Não há bundler: os arquivos são scripts clássicos carregados em ordem
  por cada página HTML. Os caminhos são relativos, para funcionar tanto na
  raiz local quanto em https://1rayke1.github.io/forja/.
*/
(function (global) {
  "use strict";

  const F = global.Forja = global.Forja || {};
  const doc = global.document;

  /* Rotas (relativas à raiz do site; cada página informa seu data-root). */
  F.ROUTES = Object.freeze({
    inicio: "index.html",
    treino: "treino/index.html",
    calistenia: "treino/calistenia.html",
    musculacao: "treino/musculacao.html",
    rotina: "treino/rotina.html",
    executar: "treino/executar.html",
    progresso: "progresso/index.html",
    configuracoes: "configuracoes/index.html"
  });

  /* Chaves de armazenamento. Os nomes das chaves antigas são preservados. */
  F.KEYS = Object.freeze({
    legacyExercises: "forja-treino-exercicios-v1",
    history: "forja-treino-historico-v1",
    active: "forja-treino-sessao-ativa-v1",
    routines: "forja-treino-rotinas-v1",
    migration: "forja-treino-migracao-v1",
    legacyActiveArchive: "forja-treino-sessao-ativa-legada-v1",
    preserved: "forja-treino-dados-preservados-v1",
    safety: "forja-backup-seguranca-v1",
    library: "forja-treino-biblioteca-v1",
    preferences: "forja-preferencias-v1"
  });

  F.BACKUP_FORMAT = "forja-backup";
  F.BACKUP_VERSION = 1;
  F.MAX_BACKUP_BYTES = 5 * 1024 * 1024;
  F.HISTORY_LIMIT = 200;

  F.MODE_NAMES = Object.freeze({
    calisthenics: "Calistenia",
    weights: "Musculação"
  });

  F.MODE_DESCRIPTIONS = Object.freeze({
    calisthenics: "Treinos com peso corporal, barras e chão.",
    weights: "Treinos com cargas, halteres e máquinas."
  });

  F.MODE_PAGES = Object.freeze({
    calisthenics: "calistenia",
    weights: "musculacao"
  });

  F.SECTION_ORDER = Object.freeze(["warmup", "main", "abs", "finisher"]);

  F.SECTION_NAMES = Object.freeze({
    warmup: "Aquecimento",
    main: "Treino principal",
    abs: "Abdômen",
    finisher: "Finalizador"
  });

  /* Estado compartilhado entre módulos (dados carregados do armazenamento). */
  F.state = {
    legacyExercises: { calisthenics: [], weights: [] },
    legacyExercisesCorrupt: false,
    routines: { calisthenics: [], weights: [] },
    history: [],
    activeWorkout: null,
    library: { calisthenics: [], weights: [] },
    preferences: { soundOnRest: true, vibrateOnRest: true },
    bootNotices: [],
    lastExportAt: null
  };

  /* Utilitários gerais */

  F.isPlainObject = function isPlainObject(value) {
    return value !== null &&
      typeof value === "object" &&
      !Array.isArray(value);
  };

  F.cloneData = function cloneData(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  };

  F.createId = function createId(prefix = "id") {
    return prefix + "-" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 9);
  };

  F.clampInteger = function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  };

  F.escapeHtml = function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  F.byId = function byId(id) {
    return doc.getElementById(id);
  };

  /* Formata segundos como MM:SS (ou HH:MM:SS a partir de 1 hora). */
  F.formatClock = function formatClock(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;

    if (hours > 0) {
      return String(hours).padStart(2, "0") + ":" +
        String(minutes).padStart(2, "0") + ":" +
        String(remainder).padStart(2, "0");
    }

    return String(minutes).padStart(2, "0") + ":" +
      String(remainder).padStart(2, "0");
  };

  F.formatRest = function formatRest(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value === 0) return "Sem descanso";
    if (value < 60) return value + " s";

    const minutes = Math.floor(value / 60);
    const remainder = value % 60;
    return remainder
      ? minutes + " min " + remainder + " s"
      : minutes + " min";
  };

  F.formatRestValue = function formatRestValue(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    if (value < 60) return value + " s";
    const minutes = Math.floor(value / 60);
    const remainder = value % 60;
    return remainder ? minutes + "m " + remainder + "s" : minutes + "m";
  };

  F.formatPlanned = function formatPlanned(exercise) {
    if (!exercise) return "—";
    if (exercise.type === "duration") {
      return F.formatRestValue(Number(exercise.duration) || 0);
    }
    return exercise.reps || "—";
  };

  F.formatExerciseMeta = function formatExerciseMeta(exercise) {
    const amount = exercise.type === "duration"
      ? F.formatRestValue(exercise.duration)
      : (exercise.reps || "—") + " reps";
    return exercise.sets + " × " + amount;
  };

  F.formatDurationLong = function formatDurationLong(ms) {
    const totalSeconds = Math.floor((Number(ms) || 0) / 1000);
    return F.formatClock(totalSeconds);
  };

  F.dateKey = function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  F.formatDate = function formatDate(date, options = {}) {
    return date.toLocaleDateString("pt-BR", options);
  };

  F.parseDateKey = function parseDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    return new Date(
      Number(value.slice(0, 4)),
      Number(value.slice(5, 7)) - 1,
      Number(value.slice(8, 10))
    );
  };

  F.safeScrollIntoView = function safeScrollIntoView(element) {
    if (element && typeof element.scrollIntoView === "function") {
      try {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (error) {
        // Navegadores antigos podem não aceitar opções.
      }
    }
  };

  F.scrollPageToTop = function scrollPageToTop() {
    try {
      doc.documentElement.scrollTop = 0;
      doc.body.scrollTop = 0;
    } catch (error) {
      // Ambiente sem layout: nada a fazer.
    }
  };

  /* Rotas e navegação */

  /*
    Monta o caminho de uma página a partir da raiz do site. A página informa
    sua profundidade em <body data-root="../">, por isso os links funcionam
    tanto em /forja/ quanto em qualquer subpasta.
  */
  F.url = function url(name, params) {
    const root = (doc.body && doc.body.getAttribute("data-root")) || "";
    let target = root + (F.ROUTES[name] || name);

    if (params) {
      const query = new URLSearchParams(params).toString();
      if (query) target += "?" + query;
    }

    return target;
  };

  F.modalityUrl = function modalityUrl(modality) {
    return F.url(F.MODE_PAGES[modality] || "treino");
  };

  /*
    Navegação real entre páginas: um link programático, clicado pelo próprio
    navegador. Assim o comportamento é idêntico ao de um link comum.
  */
  F.navigate = function navigate(href) {
    const anchor = doc.createElement("a");
    anchor.href = href;
    anchor.hidden = true;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  /* Mensagens que sobrevivem à navegação para outra página (sessionStorage). */
  F.flash = function flash(message, tone = "info") {
    try {
      global.sessionStorage.setItem("forja-flash", JSON.stringify({
        message: String(message),
        tone
      }));
    } catch (error) {
      // Modo privado sem sessionStorage: o aviso simplesmente não aparece.
    }
  };

  F.consumeFlash = function consumeFlash() {
    let raw = null;

    try {
      raw = global.sessionStorage.getItem("forja-flash");
      global.sessionStorage.removeItem("forja-flash");
    } catch (error) {
      return null;
    }

    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      return F.isPlainObject(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  };

  /* Armazenamento: leitura segura e escrita com aviso */

  F.parseStorageValue = function parseStorageValue(key) {
    let raw = null;

    try {
      raw = global.localStorage.getItem(key);
    } catch (error) {
      return { exists: false, raw: null, value: null, error };
    }

    if (raw === null) {
      return { exists: false, raw: null, value: null, error: null };
    }

    try {
      return { exists: true, raw, value: JSON.parse(raw), error: null };
    } catch (error) {
      return { exists: true, raw, value: null, error };
    }
  };

  F.saveJSON = function saveJSON(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      F.showToast(
        "Não foi possível salvar. Verifique o espaço disponível no navegador.",
        "error",
        5000
      );
      return false;
    }
  };

  F.removeStorageKey = function removeStorageKey(key) {
    try {
      global.localStorage.removeItem(key);
      return true;
    } catch (error) {
      F.showToast("Não foi possível atualizar o armazenamento do navegador.", "error");
      return false;
    }
  };

  /*
    Guarda uma cópia de conteúdo ilegível ou não reconhecido. Itens idênticos
    não são arquivados duas vezes, e a lista é limitada a 20 entradas.
  */
  F.archivePreservedValue = function archivePreservedValue(key, raw, reason) {
    const stored = F.parseStorageValue(F.KEYS.preserved);
    const list = stored.exists && Array.isArray(stored.value)
      ? stored.value.slice()
      : [];
    const rawString = typeof raw === "string" ? raw : JSON.stringify(raw);

    const existingIndex = list.findIndex(item => {
      return F.isPlainObject(item) && item.key === key && item.raw === rawString;
    });

    if (existingIndex >= 0) list.splice(existingIndex, 1);

    list.unshift({
      archivedAt: new Date().toISOString(),
      key,
      reason,
      raw: rawString
    });

    F.saveJSON(F.KEYS.preserved, list.slice(0, 20));
  };

  F.recordMigration = function recordMigration(details) {
    const stored = F.parseStorageValue(F.KEYS.migration);
    const current = stored.exists && F.isPlainObject(stored.value)
      ? stored.value
      : {};

    F.saveJSON(F.KEYS.migration, {
      ...current,
      version: 2,
      updatedAt: new Date().toISOString(),
      ...details
    });
  };

  /* Avisos (toast) */

  let toastTimeoutId = null;

  F.showToast = function showToast(message, tone = "info", duration = 3400) {
    const toast = F.byId("toast");
    if (!toast) return;

    if (toastTimeoutId) {
      clearTimeout(toastTimeoutId);
      toastTimeoutId = null;
    }

    toast.textContent = message;
    toast.classList.toggle("error", tone === "error");
    toast.hidden = false;

    toastTimeoutId = global.setTimeout(() => {
      toast.hidden = true;
      toastTimeoutId = null;
    }, duration);
  };

  /* Diálogos modais (Promise com a ação escolhida) */

  let openModalState = null;

  function closeOpenModal(result) {
    if (!openModalState) return;

    const state = openModalState;
    openModalState = null;

    doc.removeEventListener("keydown", state.keyHandler);
    if (state.backdrop && state.backdrop.parentNode) {
      state.backdrop.parentNode.removeChild(state.backdrop);
    }
    doc.body.classList.remove("modal-open");

    if (state.lastFocused && typeof state.lastFocused.focus === "function") {
      try {
        state.lastFocused.focus();
      } catch (error) {
        // Elemento pode ter saído do documento.
      }
    }

    state.resolve(result);
  }

  F.closeOpenModal = closeOpenModal;

  function collectModalValues(backdrop, fields) {
    const values = {};
    fields.forEach(field => {
      const input = backdrop.querySelector('[data-modal-field="' + field.id + '"]');
      values[field.id] = input ? input.value : "";
    });
    return values;
  }

  F.showModal = function showModal(options) {
    if (openModalState) {
      closeOpenModal({ action: "cancel", values: {} });
    }

    const settings = {
      title: "Confirmar",
      message: "",
      details: null,
      fields: [],
      actions: [
        { id: "cancel", label: "Cancelar", className: "secondary-button" }
      ],
      dismissible: true,
      ...options
    };

    return new Promise(resolve => {
      const backdrop = doc.createElement("div");
      backdrop.className = "modal-backdrop";

      const card = doc.createElement("div");
      card.className = "modal-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.setAttribute("aria-labelledby", "modal-title");

      const title = doc.createElement("h2");
      title.id = "modal-title";
      title.textContent = settings.title;
      card.appendChild(title);

      if (settings.message) {
        const message = doc.createElement("p");
        message.className = "modal-message";
        message.textContent = settings.message;
        card.appendChild(message);
      }

      if (settings.details) {
        card.appendChild(settings.details);
      }

      const fieldInputs = [];
      settings.fields.forEach(field => {
        const wrapper = doc.createElement("div");
        wrapper.className = "modal-field";

        if (field.label) {
          const label = doc.createElement("label");
          label.className = "field-label";
          label.htmlFor = "modal-field-" + field.id;
          label.textContent = field.label;
          wrapper.appendChild(label);
        }

        const input = doc.createElement("input");
        input.type = field.type || "text";
        input.id = "modal-field-" + field.id;
        input.setAttribute("data-modal-field", field.id);
        input.value = field.value || "";
        input.maxLength = field.maxlength || 120;
        input.autocomplete = "off";
        wrapper.appendChild(input);
        card.appendChild(wrapper);
        fieldInputs.push(input);
      });

      const actions = doc.createElement("div");
      actions.className = "modal-actions";

      settings.actions.forEach(action => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = action.className || "secondary-button";
        button.textContent = action.label;
        button.setAttribute("data-modal-action", action.id);

        button.addEventListener("click", () => {
          closeOpenModal({
            action: action.id,
            values: collectModalValues(backdrop, settings.fields)
          });
        });

        actions.appendChild(button);
      });

      card.appendChild(actions);
      backdrop.appendChild(card);

      const keyHandler = event => {
        if (event.key === "Escape" && settings.dismissible) {
          event.preventDefault();
          closeOpenModal({ action: "cancel", values: collectModalValues(backdrop, settings.fields) });
          return;
        }

        if (event.key === "Tab") {
          const focusable = Array.from(card.querySelectorAll(
            "button, input, select, textarea, [tabindex]:not([tabindex='-1'])"
          )).filter(element => !element.disabled);

          if (focusable.length === 0) return;

          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (event.shiftKey && doc.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && doc.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      };

      if (settings.dismissible) {
        backdrop.addEventListener("mousedown", event => {
          if (event.target === backdrop) {
            closeOpenModal({ action: "cancel", values: collectModalValues(backdrop, settings.fields) });
          }
        });
      }

      openModalState = {
        backdrop,
        resolve,
        keyHandler,
        lastFocused: doc.activeElement
      };

      F.byId("modal-root").appendChild(backdrop);
      doc.body.classList.add("modal-open");
      doc.addEventListener("keydown", keyHandler);

      const preferredAction = settings.actions.find(action => action.id !== "cancel");
      const preferredButton = preferredAction
        ? actions.querySelector('[data-modal-action="' + preferredAction.id + '"]')
        : null;

      if (fieldInputs.length > 0) {
        fieldInputs[0].focus();
        fieldInputs[0].select();
      } else if (preferredButton) {
        preferredButton.focus();
      }
    });
  };

  /* Elemento de confirmação simples de uma ação destrutiva ou informativa. */
  F.showNotice = function showNotice(title, message) {
    return F.showModal({
      title,
      message,
      actions: [
        { id: "close", label: "Fechar", className: "secondary-button" }
      ]
    });
  };

  /* Registro das páginas: cada módulo adiciona a função de inicialização da sua. */
  F.pages = {};

  /* Um único ponto de entrada para ler o nome da página atual. */
  F.pageName = function pageName() {
    return (doc.body && doc.body.getAttribute("data-page")) || "";
  };
})(window);
