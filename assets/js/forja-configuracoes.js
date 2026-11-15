/*
  FORJA — tela de Configurações e aplicação da aparência.

  A rota antiga configuracoes/index.html continua única. Seus painéis são
  endereçados por fragmentos (#notificacoes, #privacidade etc.), sem criar
  um segundo app ou duplicar formulários. Nome, metas, treino e backup usam
  os mesmos controladores e chaves já existentes.

  Este módulo também é carregado pelas demais páginas do app: assim o tema
  e a preferência de movimento sobrevivem à navegação, não só à tela onde
  foram escolhidos. Nenhuma preferência é gravada durante a abertura.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;
  const byId = F.byId;

  const PANELS = {
    inicio: { title: "Configurações", subtitle: "Personalize sua experiência no FORJA", icon: "settings" },
    "editar-perfil": { title: "Editar perfil", subtitle: "Altere seu nome e suas informações", icon: "user" },
    notificacoes: { title: "Notificações", subtitle: "Gerencie os avisos durante o treino", icon: "bell" },
    aparencia: { title: "Aparência", subtitle: "Escolha o tema e o movimento do app", icon: "palette" },
    privacidade: { title: "Privacidade e dados", subtitle: "Seus dados ficam neste navegador", icon: "shield-check" },
    ajuda: { title: "Central de ajuda", subtitle: "Respostas para usar o FORJA com tranquilidade", icon: "help-circle" },
    contato: { title: "Fale conosco", subtitle: "Canal oficial do projeto no GitHub", icon: "mail" },
    sobre: { title: "Sobre o FORJA", subtitle: "Disciplina diária, sem promessas vazias", icon: "info" }
  };

  /* Links antigos continuam abrindo o conteúdo certo dentro da nova tela. */
  const LEGACY_TARGETS = {
    "nome-exibicao": "editar-perfil",
    "profile-name-form": "editar-perfil",
    "profile-form": "editar-perfil",
    "profile-onboarding-link": "editar-perfil",
    "perfil-treino-heading": "editar-perfil",
    "preferences-heading": "notificacoes",
    "backup-heading": "privacidade",
    "profile-data-heading": "privacidade",
    "storage-heading": "privacidade",
    "creditos-imagens": "sobre",
    "creditos-fotografias": "sobre",
    "creditos-videos": "sobre"
  };

  function hydrateIcons(root) {
    if (!F.ui) return;
    (root || doc).querySelectorAll("[data-icon]").forEach(node => {
      if (node.querySelector("svg")) return;
      const drawn = F.ui.icon(node.getAttribute("data-icon"));
      node.appendChild(drawn.querySelector("svg"));
      node.removeAttribute("data-icon");
    });
  }

  /* ------------------------------------------------------------------ */
  /* Aparência compartilhada                                             */
  /* ------------------------------------------------------------------ */

  function applyAppearance() {
    const appearance = F.normalizeAppearance(F.state.appearance);
    doc.documentElement.setAttribute("data-forja-theme", appearance.theme);
    doc.documentElement.setAttribute("data-forja-motion", appearance.reducedMotion ? "reduced" : "full");
    return appearance;
  }

  function renderAppearance() {
    const appearance = applyAppearance();
    doc.querySelectorAll('input[name="appearance-theme"]').forEach(input => {
      input.checked = input.value === appearance.theme;
    });
    const motion = byId("pref-reduced-motion");
    if (motion) motion.checked = appearance.reducedMotion;
    return appearance;
  }

  function appearanceStatus(message, error) {
    const status = byId("appearance-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("field-error", Boolean(error));
  }

  function changeAppearance(patch, message) {
    if (!F.saveAppearance(patch)) {
      renderAppearance();
      appearanceStatus("Não foi possível salvar. A preferência anterior foi mantida.", true);
      return false;
    }
    renderAppearance();
    appearanceStatus("Preferência salva neste navegador.");
    F.ui.announce(message);
    return true;
  }

  F.applyAppearance = applyAppearance;

  /* ------------------------------------------------------------------ */
  /* Resumo real do perfil (nunca um nome de demonstração)               */
  /* ------------------------------------------------------------------ */

  function renderProfileSummary() {
    const profile = F.state.profile || {};
    const name = F.displayNameOf(profile);
    const firstName = name ? name.split(" ")[0] : "";
    const nameNode = byId("settings-profile-name");
    const sinceNode = byId("settings-profile-since");

    if (nameNode) nameNode.textContent = firstName || "Seu perfil";
    if (sinceNode) {
      const registeredAt = profile.onboardingConcluidoEm;
      const updatedAt = profile.updatedAt;
      const date = registeredAt || updatedAt;
      const parsed = date ? new Date(date) : null;
      sinceNode.textContent = parsed && !Number.isNaN(parsed.getTime())
        ? (registeredAt ? "Membro desde " : "Perfil desde ") + F.formatDate(parsed, { year: "numeric" })
        : "Personalize como o FORJA chama você";
    }
  }

  /* ------------------------------------------------------------------ */
  /* Privacidade: auditoria sem expor o conteúdo dos treinos             */
  /* ------------------------------------------------------------------ */

  function renderStorageAudit() {
    const host = byId("storage-audit-content");
    if (!host) return;
    const audit = F.repo.audit();
    host.innerHTML = "";
    if (!audit.available) {
      host.appendChild(F.ui.el("p", "field-error", "O armazenamento do navegador está indisponível."));
      return;
    }
    if (audit.rows.length === 0) {
      host.appendChild(F.ui.el("p", "field-hint", "Nenhum dado do FORJA foi gravado neste navegador ainda."));
      return;
    }
    host.appendChild(F.ui.el("p", "field-hint",
      audit.rows.length + " registro(s) · " + F.formatNumber(audit.totalBytes) +
      " caracteres armazenados (tamanho aproximado). Nenhum conteúdo é enviado a servidores."));
    const table = F.ui.table({
      caption: "Dados do FORJA armazenados neste navegador",
      columns: ["Dado", "Caracteres"],
      rows: audit.rows.map(row => [row.label + (row.readable ? "" : " (ilegível, preservado)"), F.formatNumber(row.bytes)])
    });
    const wrap = F.ui.el("div", "settings-table-wrap");
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /* ------------------------------------------------------------------ */
  /* Suporte: canal oficial e diagnóstico sem dados pessoais             */
  /* ------------------------------------------------------------------ */

  function diagnosticText() {
    const appearance = F.normalizeAppearance(F.state.appearance);
    return [
      "FORJA " + F.APP_VERSION,
      "Tema: " + (appearance.theme === "contrast" ? "alto contraste" : "padrão"),
      "Movimento reduzido: " + (appearance.reducedMotion ? "sim" : "não"),
      "Armazenamento local: " + (F.store.available() ? "disponível" : "indisponível")
    ].join("\n");
  }

  async function copyDiagnostics() {
    const text = diagnosticText();
    const status = byId("support-copy-status");
    try {
      if (!global.navigator.clipboard || typeof global.navigator.clipboard.writeText !== "function") {
        throw new Error("clipboard-indisponivel");
      }
      await global.navigator.clipboard.writeText(text);
      if (status) status.textContent = "Diagnóstico copiado. Nenhum nome, treino ou histórico foi incluído.";
      F.ui.announce("Diagnóstico copiado.");
    } catch (error) {
      if (status) status.textContent = "A cópia automática não está disponível. Você pode copiar o texto na janela.";
      const field = F.ui.el("textarea", "settings-diagnostic-text", text);
      field.rows = 4;
      field.readOnly = true;
      field.setAttribute("aria-label", "Diagnóstico para copiar manualmente");
      await F.showModal({
        title: "Diagnóstico do aplicativo",
        message: "Selecione e copie o texto abaixo. Ele não contém dados pessoais.",
        details: field,
        actions: [{ id: "close", label: "Fechar", className: "secondary-button" }]
      });
      field.focus();
      field.select();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Navegação por fragmentos, com histórico e links antigos preservados */
  /* ------------------------------------------------------------------ */

  function hashTarget() {
    let hash = "";
    try { hash = decodeURIComponent(global.location.hash.slice(1)); }
    catch (error) { hash = global.location.hash.slice(1); }
    if (hash === "conteudo") return null;
    return {
      panel: PANELS[hash] ? hash : (LEGACY_TARGETS[hash] || "inicio"),
      anchor: PANELS[hash] || LEGACY_TARGETS[hash] ? hash : null
    };
  }

  function showPanel(options) {
    const settings = options || {};
    const target = hashTarget();
    if (!target) return;
    const meta = PANELS[target.panel];

    doc.querySelectorAll("[data-settings-panel]").forEach(panel => {
      panel.hidden = panel.getAttribute("data-settings-panel") !== target.panel;
    });

    const title = byId("settings-title");
    const subtitle = byId("settings-subtitle");
    const icon = byId("settings-title-icon");
    const back = byId("settings-back");
    if (title) {
      title.textContent = meta.title;
      title.setAttribute("tabindex", "-1");
    }
    if (subtitle) subtitle.textContent = meta.subtitle;
    if (icon) {
      icon.innerHTML = "";
      icon.appendChild(F.ui.icon(meta.icon).querySelector("svg"));
    }
    if (back) {
      back.href = target.panel === "inicio" ? F.url("inicio") : "#inicio";
      back.setAttribute("aria-label", target.panel === "inicio" ? "Voltar ao início" : "Voltar às configurações");
    }
    doc.title = meta.title + " · FORJA";
    doc.body.setAttribute("data-settings-view", target.panel);

    if (target.panel === "inicio") renderProfileSummary();
    if (target.panel === "aparencia") renderAppearance();
    if (target.panel === "sobre") {
      const version = byId("settings-version");
      if (version) version.textContent = "Versão " + F.APP_VERSION;
    }

    const anchor = target.anchor ? byId(target.anchor) : null;
    if (anchor && anchor.tagName === "DETAILS") anchor.open = true;
    const audit = byId("settings-storage-audit");
    if (target.panel === "privacidade" && audit && audit.open) renderStorageAudit();

    if (settings.focus) {
      if (title) title.focus({ preventScroll: true });
      F.scrollPageToTop();
    }
    if (anchor && anchor.id !== target.panel) {
      F.safeScrollIntoView(anchor, { block: "start", behavior: "auto" });
    } else if (settings.initial && target.panel !== "inicio") {
      F.scrollPageToTop();
    }
  }

  let initialized = false;

  function initSettings() {
    if (initialized) return;
    initialized = true;
    hydrateIcons(doc);
    renderProfileSummary();
    renderAppearance();

    doc.querySelectorAll('input[name="appearance-theme"]').forEach(input => {
      input.addEventListener("change", () => {
        if (input.checked) changeAppearance({ theme: input.value }, "Tema salvo.");
      });
    });
    const motion = byId("pref-reduced-motion");
    if (motion) motion.addEventListener("change", () => {
      changeAppearance({ reducedMotion: motion.checked }, "Preferência de movimento salva.");
    });
    const reset = byId("appearance-reset");
    if (reset) reset.addEventListener("click", async () => {
      const confirmed = await F.ui.confirmDestructive({
        title: "Restaurar aparência padrão?",
        message: "O tema FORJA e as animações padrão serão restaurados. Seus treinos, perfil e histórico não serão alterados.",
        confirmLabel: "Restaurar aparência"
      });
      if (confirmed) changeAppearance({ theme: "default", reducedMotion: false }, "Aparência padrão restaurada.");
    });

    const audit = byId("settings-storage-audit");
    if (audit) audit.addEventListener("toggle", () => { if (audit.open) renderStorageAudit(); });
    const copy = byId("support-copy-diagnostics");
    if (copy) copy.addEventListener("click", copyDiagnostics);

    global.addEventListener("hashchange", () => showPanel({ focus: true }));
    showPanel({ initial: true });
  }

  F.initSettings = initSettings;

  /* A aparência acompanha gravações locais, importações e outras abas. */
  F.store.onChange(key => {
    if (key === null || key === F.KEYS.appearance) renderAppearance();
    if (key === null || key === F.KEYS.profile) renderProfileSummary();
    const audit = byId("settings-storage-audit");
    if (audit && audit.open) renderStorageAudit();
  });
  global.addEventListener("storage", event => {
    if (event.key !== null && event.key !== F.KEYS.appearance) return;
    F.syncStateFromStorage(event.key);
    renderAppearance();
  });
  global.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    F.syncStateFromStorage(null);
    renderAppearance();
    if (doc.body.dataset.page === "configuracoes") showPanel({ initial: true });
  });
})(window);
