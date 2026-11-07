/*
  FORJA — biblioteca visual de exercícios (Etapa 4).

  Esta é a tela `treino/biblioteca.html`. Ela NÃO é um segundo catálogo: toda a
  leitura vem do catálogo central (`forja-catalogo-central.js`, 165 exercícios)
  e a única escrita continua sendo `F.catalog.addToRoutine`, que insere o
  exercício em uma rotina existente. Os exercícios personalizados do usuário
  entram ao lado dos oficiais, marcados como "Seus", sem receber ranking nem
  classificação por suposição.

  Contrato da tela:
  - busca por nome (sem acento, sem caixa) combinável com os filtros;
  - três filtros independentes: grupo muscular (os 13 oficiais), modalidade
    (Academia, Calistenia, Peso corporal) e classificação no ranking;
  - filtros ativos visíveis, removíveis um a um, e "limpar tudo";
  - cards com imagem de referência ou estado de fallback, nome, grupo,
    modalidade, posição no ranking e indicador de demonstração em vídeo;
  - rankings de aproveitamento por grupo + modalidade, sem misturar categorias;
  - detalhe completo no painel único (`F.catalog.showDetail`);
  - carregamento progressivo de 12 em 12, como antes.

  Regras da Etapa 3 que continuam valendo no detalhe: a associação
  administrativa aprovada tem prioridade sobre o vídeo oficial, existe um único
  player 16:9 (youtube-nocookie, sem autoplay, mudo, com controles) e, sem vídeo
  válido, aparece a imagem de referência disponível.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;
  if (!F || !doc || !F.exerciseCatalog || !F.ui) return;

  const CATALOG = F.exerciseCatalog;
  const PAGE_SIZE = 12;

  /* ------------------------------------------------------------------ */
  /* Compatibilidade de nomes antigos                                     */
  /* ------------------------------------------------------------------ */

  /*
    Nomes de grupo usados antes do catálogo central (legenda do atlas, links
    antigos, exercícios personalizados). Servem só para traduzir a entrada; o
    filtro em si sempre usa o id oficial do catálogo.
  */
  const LEGACY_MUSCLE_GROUPS = Object.freeze({
    "bíceps": "biceps",
    "biceps": "biceps",
    "tríceps": "triceps",
    "triceps": "triceps",
    "peito": "peitoral",
    "peitoral": "peitoral",
    "dorsais": "costas",
    "costas": "costas",
    "ombros": "ombros",
    "trapézio": "trapezio",
    "trapezio": "trapezio",
    "abdômen": "abdomen",
    "abdomen": "abdomen",
    "oblíquos": "obliquos",
    "obliquos": "obliquos",
    "quadríceps": "quadriceps",
    "quadriceps": "quadriceps",
    "posterior de coxa": "posteriores",
    "posteriores": "posteriores",
    "glúteos": "gluteos",
    "gluteos": "gluteos",
    "panturrilha": "panturrilhas",
    "panturrilhas": "panturrilhas",
    "antebraços": "antebracos",
    "antebracos": "antebracos"
  });

  const LEGACY_MODALITIES = Object.freeze({
    weights: "academia",
    academia: "academia",
    calisthenics: "calistenia",
    calistenia: "calistenia",
    "peso corporal": "peso-corporal",
    "peso-corporal": "peso-corporal"
  });

  function groupIdFrom(value) {
    if (!value) return null;
    const key = String(value).trim().toLowerCase();
    const fromLegacy = LEGACY_MUSCLE_GROUPS[key];
    if (fromLegacy) return fromLegacy;
    const wanted = CATALOG.normalizeText(key);
    const group = CATALOG.muscleGroups.find(item =>
      item.id === key || CATALOG.normalizeText(item.name) === wanted);
    return group ? group.id : null;
  }

  function modalityIdFrom(value) {
    if (!value) return null;
    const key = String(value).trim().toLowerCase();
    return LEGACY_MODALITIES[key] || null;
  }

  /* ------------------------------------------------------------------ */
  /* Modelo de exibição                                                   */
  /* ------------------------------------------------------------------ */

  function legacyRecordsById() {
    const map = new Map();
    (typeof F.catalog.items === "function" ? F.catalog.items() : []).forEach(record => {
      if (record && record.id && !map.has(record.id)) map.set(record.id, record);
    });
    return map;
  }

  /*
    Imagem de referência, sempre de um arquivo do repositório:
    1. imagem aprovada/associada no catálogo central;
    2. ilustração do sistema de demonstrações (F.demos), por identidade;
    3. nenhuma — o card usa o estado de fallback.
  */
  /*
    Fundo da moldura: as ilustrações RepDB são quadradas e opacas, com fundo
    azul-claro próprio. Quando a imagem vem dessa família, a moldura usa a
    mesma cor para a ilustração inteira aparecer sem barras escuras.
  */
  function backdropFor(src) {
    return /(^|\/)demonstracoes\//.test(String(src || "")) ? "light" : "dark";
  }

  function imageFor(central, legacy) {
    if (central && central.media && central.media.image && central.media.image.src) {
      const media = central.media.image;
      return {
        src: media.src,
        url: F.url(media.src),
        status: media.status,
        source: "catalogo",
        backdrop: backdropFor(media.src)
      };
    }

    if (legacy) {
      const demo = F.demos && F.demos.available() ? F.demos.resolve(legacy, legacy.mode) : null;
      if (demo && demo.thumb && demo.thumb.url) {
        return {
          src: demo.thumb.file,
          url: demo.thumb.url,
          status: "demo",
          source: "demo",
          backdrop: "light"
        };
      }
    }

    return null;
  }

  function officialVideoFor(legacy) {
    if (!F.videos || !legacy) return null;
    return F.videos.officialFor(legacy, legacy.mode);
  }

  function centralEntry(record, legacy) {
    const group = CATALOG.groupById(record.primaryMuscle);
    const modality = CATALOG.modalityById(record.modality);

    return {
      key: "catalogo:" + record.id,
      categoryLabel: "",
      origin: "catalogo",
      id: record.id,
      name: record.name,
      nameKey: CATALOG.normalizeText(record.name),
      aliases: record.aliases.slice(),
      central: record,
      legacy: legacy || null,
      muscleId: record.primaryMuscle,
      muscleIds: [record.primaryMuscle].concat(record.secondaryMuscles, record.stabilizers),
      muscleName: group ? group.name : record.primaryMuscle,
      modalityId: record.modality,
      modalityName: modality ? modality.name : record.modality,
      position: record.ranking.position,
      equipmentIds: record.equipment.slice(),
      equipment: record.equipment.map(item => CATALOG.equipmentLabel(item)),
      image: imageFor(record, legacy),
      hasOfficialVideo: Boolean(officialVideoFor(legacy)),
      hasApprovedVideo: false,
      section: legacy ? legacy.section : "main"
    };
  }

  /*
    Exercício personalizado. Nada de classificação por suposição: o grupo vem
    do que o usuário declarou e a modalidade é a do lugar onde ele criou o
    exercício (a rotina de Academia ou de Calistenia). A modalidade "Peso
    corporal" é conceito do catálogo oficial — aplicá-la a um item do usuário
    exigiria adivinhar, então ela fica só para os exercícios do catálogo.
  */
  function derivedModalityForCustom(legacy) {
    if (!legacy) return null;
    return legacy.mode === "weights" ? "academia" : "calistenia";
  }

  /* Rótulo da categoria declarada pelo usuário (a tabela é a do catálogo). */
  function categoryLabelFor(category) {
    if (!category) return "";
    const names = (F.catalog && F.catalog.CATEGORY_NAMES) || F.CATEGORY_NAMES || {};
    return names[category] || category;
  }

  /* Músculos que o usuário declarou no exercício personalizado. */
  function declaredMusclesFor(legacy) {
    const roles = legacy && legacy.roles;
    if (roles) {
      return (roles.primary || []).concat(roles.secondary || [], roles.stabilizers || []);
    }
    return legacy && Array.isArray(legacy.muscles) ? legacy.muscles : [];
  }

  function customEntry(legacy) {
    const declaredList = declaredMusclesFor(legacy);
    const declared = declaredList.length ? declaredList[0] : null;
    const muscleId = groupIdFrom(declared);
    const modalityId = derivedModalityForCustom(legacy);

    return {
      key: "pessoal:" + legacy.id,
      categoryLabel: categoryLabelFor(legacy.category),
      origin: "pessoal",
      id: legacy.id,
      name: legacy.name,
      nameKey: CATALOG.normalizeText(legacy.name),
      aliases: [],
      central: null,
      legacy,
      muscleId,
      muscleIds: declaredMusclesFor(legacy).map(groupIdFrom).filter(Boolean),
      muscleName: muscleId ? CATALOG.muscleName(muscleId) : (declared || null),
      modalityId,
      modalityName: modalityId ? CATALOG.modalityName(modalityId) : null,
      position: null,
      equipmentIds: [],
      equipment: Array.isArray(legacy.equipment) ? legacy.equipment.slice() : [],
      image: imageFor(null, legacy),
      hasOfficialVideo: Boolean(officialVideoFor(legacy)),
      hasApprovedVideo: false,
      section: legacy.section || "main"
    };
  }

  /*
    Lista unificada. Os oficiais vêm do catálogo central, na ordem do próprio
    catálogo; os personalizados entram depois, com o id salvo pelo usuário.
  */
  let cache = null;

  function invalidate() {
    cache = null;
  }

  /*
    Ordem da lista: os exercícios do usuário abrem a biblioteca (são o que ele
    criou e vai procurar primeiro, como na tela antiga), depois vêm os
    sugeridos na ordem já conhecida do app e, por fim, o resto do catálogo
    central na ordem do próprio catálogo. A ordem só muda quando o filtro de
    ranking está ativo.
  */
  function entries() {
    if (cache) return cache;

    const legacyById = legacyRecordsById();
    const centralById = new Map(CATALOG.exercises.map(record => [record.id, record]));
    const all = typeof F.catalog.items === "function" ? F.catalog.items() : [];
    const used = new Set();
    const list = [];

    all.forEach(record => {
      if (!record || record.source !== "personalizado") return;
      list.push(customEntry(record));
    });

    all.forEach(record => {
      if (!record || record.source === "personalizado") return;
      const canonical = CATALOG.legacyIdMap[record.id] || record.id;
      const central = centralById.get(canonical) || centralById.get(record.id);
      if (!central || used.has(central.id)) return;
      used.add(central.id);
      list.push(centralEntry(central, record));
    });

    CATALOG.exercises.forEach(record => {
      if (used.has(record.id)) return;
      used.add(record.id);
      list.push(centralEntry(record, legacyById.get(record.id) || null));
    });

    cache = list;
    return list;
  }

  /*
    Com grupo + modalidade escolhidos a lista vira o ranking daquela
    combinação (posição crescente). Em qualquer outro caso a ordem natural da
    biblioteca é mantida: quem já conhece o app reencontra o exercício onde
    estava. Ordenar por nome só quando existe busca — aí a ordem alfabética
    ajuda a ler o resultado.
  */
  function sorted(list, state) {
    const ranked = Boolean(state && state.muscle && state.modality);
    const alphabetical = Boolean(state && state.query);

    return list.slice().sort((a, b) => {
      if (ranked) {
        const pa = a.position === null ? Number.POSITIVE_INFINITY : a.position;
        const pb = b.position === null ? Number.POSITIVE_INFINITY : b.position;
        if (pa !== pb) return pa - pb;
        return 0;
      }
      if (alphabetical) return a.name.localeCompare(b.name, "pt-BR");
      return 0;
    });
  }

  /*
    Busca textual — sem acento e sem diferenciar maiúsculas. Procura no nome e
    nos aliases oficiais e também no que o cartão mostra: grupo muscular,
    modalidade, categoria declarada e equipamento. Assim "peito" e "barra"
    encontram itens mesmo sem estarem no nome.
  */
  function matchesQuery(entry, query) {
    if (!query) return true;
    const haystack = CATALOG.normalizeText([
      entry.name,
      entry.aliases.join(" "),
      entry.muscleName || "",
      entry.modalityName || "",
      entry.categoryLabel || "",
      entry.equipment.join(" ")
    ].join(" · "));

    return query.split(/\s+/).filter(Boolean).every(term => haystack.includes(term));
  }

  /*
    Consulta da biblioteca. Todos os filtros são independentes e combináveis; a
    classificação só vale junto de um grupo e de uma modalidade, porque o
    ranking é próprio de cada combinação (nunca mistura categorias).
  */
  function filter(state = {}) {
    const query = CATALOG.normalizeText(state.query);
    const muscle = groupIdFrom(state.muscle);
    const modality = modalityIdFrom(state.modality);
    const ranking = state.ranking === null || state.ranking === undefined || state.ranking === ""
      ? null
      : Number(state.ranking);
    const equipment = state.equipment || null;
    const involve = groupIdFrom(state.involve);
    const origin = state.origin === "sugerido"
      ? "catalogo"
      : state.origin === "personalizado" ? "pessoal" : null;

    const list = entries().filter(entry => {
      if (origin && entry.origin !== origin) return false;
      if (muscle && entry.muscleId !== muscle) return false;
      /* Envolvimento vem da legenda do atlas: qualquer papel muscular conta,
         inclusive secundários e estabilizadores. */
      if (involve && (entry.muscleIds || []).indexOf(involve) === -1) return false;
      if (modality && entry.modalityId !== modality) return false;
      if (equipment && entry.equipmentIds.indexOf(equipment) === -1) return false;

      if (ranking !== null) {
        if (!muscle || !modality) return false;
        if (entry.origin !== "catalogo" || entry.position !== ranking) return false;
      }

      return matchesQuery(entry, query);
    });

    return sorted(list, { muscle, modality, query });
  }

  /* Posições reais da combinação selecionada (nunca inventadas). */
  function rankingPositions(state = {}) {
    const muscle = groupIdFrom(state.muscle);
    const modality = modalityIdFrom(state.modality);
    if (!muscle || !modality) return [];
    return CATALOG.rankingPositions(muscle, modality);
  }

  /* Contagem por faceta para os chips (sempre sobre o resultado atual). */
  function facets(state = {}) {
    const base = Object.assign({}, state, {
      muscle: null,
      modality: null,
      ranking: null
    });
    const visible = filter(base);

    const count = extractor => {
      const map = new Map();
      visible.forEach(entry => {
        const values = extractor(entry) || [];
        values.forEach(value => {
          if (!value) return;
          map.set(value, (map.get(value) || 0) + 1);
        });
      });
      return map;
    };

    return {
      total: visible.length,
      muscles: count(entry => [entry.muscleId]),
      modalities: count(entry => [entry.modalityId]),
      equipment: count(entry => entry.equipmentIds),
      origins: count(entry => [entry.origin])
    };
  }

  /* Rankings por combinação — 38 no catálogo, cada um com suas posições. */
  function rankings(options = {}) {
    return CATALOG.rankings({
      muscle: groupIdFrom(options.muscle) || undefined,
      modality: modalityIdFrom(options.modality) || undefined
    }).map(group => Object.assign({}, group, {
      entries: group.entries.map(record => ({
        id: record.id,
        name: record.name,
        position: record.ranking.position,
        modalityId: record.modality,
        modalityName: CATALOG.modalityName(record.modality),
        muscleId: record.primaryMuscle,
        muscleName: CATALOG.muscleName(record.primaryMuscle),
        image: imageFor(record, null)
      }))
    }));
  }

  function totalExercises() {
    return CATALOG.exercises.length;
  }

  function officialVideoCount() {
    return entries().filter(entry => entry.origin === "catalogo" && entry.hasOfficialVideo).length;
  }

  /* ------------------------------------------------------------------ */
  /* Estado da tela                                                       */
  /* ------------------------------------------------------------------ */

  const state = {
    view: "biblioteca",
    query: "",
    muscle: null,
    modality: null,
    ranking: null,
    equipment: null,
    origin: null,
    /* "Envolve o grupo": qualquer papel muscular — vem da legenda do atlas. */
    involve: null
  };

  let visible = PAGE_SIZE;
  let dom = null;

  function signature() {
    return JSON.stringify({
      query: state.query,
      muscle: state.muscle,
      modality: state.modality,
      ranking: state.ranking,
      equipment: state.equipment,
      origin: state.origin,
      involve: state.involve,
      view: state.view
    });
  }

  let lastSignature = signature();

  function hasActiveFilters() {
    return Boolean(
      CATALOG.normalizeText(state.query) ||
      state.muscle || state.modality || state.ranking || state.equipment || state.origin ||
      state.involve
    );
  }

  function apply(patch) {
    const previousMuscle = state.muscle;
    const previousModality = state.modality;
    Object.assign(state, patch);

    /* A classificação pertence a uma combinação: se o grupo ou a modalidade
       mudou, a posição escolhida deixa de existir e é removida. */
    if (state.ranking !== null) {
      const positions = rankingPositions(state);
      const changed = previousMuscle !== state.muscle || previousModality !== state.modality;
      if (changed && positions.indexOf(Number(state.ranking)) === -1) state.ranking = null;
    }

    if (signature() !== lastSignature) visible = PAGE_SIZE;
    render();
  }

  function resetAll() {
    state.query = "";
    state.muscle = null;
    state.modality = null;
    state.ranking = null;
    state.equipment = null;
    state.origin = null;
    state.involve = null;
    visible = PAGE_SIZE;
    if (dom && dom.search) dom.search.value = "";
    render();
    if (dom && dom.search && typeof dom.search.focus === "function") dom.search.focus();
  }

  /* ------------------------------------------------------------------ */
  /* Peças visuais                                                        */
  /* ------------------------------------------------------------------ */

  function el(tag, className, text) {
    return F.ui.el(tag, className, text);
  }

  function positionLabel(position) {
    return position + "º";
  }

  function rankTone(position) {
    if (position === 1) return "is-first";
    if (position === 2) return "is-second";
    if (position === 3) return "is-third";
    return "is-other";
  }

  function initials(name) {
    const words = String(name || "").split(/\s+/).filter(word => word.length > 2);
    if (!words.length) return "FX";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function videoBadge() {
    const badge = el("span", "bl-video-badge");
    badge.setAttribute("aria-label", "Demonstração em vídeo disponível");
    badge.title = "Demonstração em vídeo disponível";
    badge.appendChild(F.ui.icon("play"));
    badge.appendChild(el("span", "bl-video-label", "Vídeo"));
    return badge;
  }

  function cardMedia(entry) {
    const media = el("div", "bl-card-media");
    media.setAttribute("data-media", entry.image ? entry.image.source : "fallback");
    media.setAttribute("data-backdrop", entry.image ? entry.image.backdrop : "dark");

    const button = el("button", "bl-card-open");
    button.type = "button";
    button.setAttribute("aria-label", "Abrir detalhes de " + entry.name);
    button.addEventListener("click", () => openDetail(entry));

    if (entry.image) {
      const image = doc.createElement("img");
      image.className = "bl-card-image";
      image.src = entry.image.url;
      image.alt = "Imagem de referência de " + entry.name;
      image.loading = "lazy";
      image.decoding = "async";
      image.setAttribute("data-image-status", entry.image.status);
      image.addEventListener("error", () => {
        media.classList.add("is-fallback");
        media.setAttribute("data-media", "fallback");
        media.setAttribute("data-backdrop", "dark");
        if (image.parentNode) image.parentNode.removeChild(image);
        if (!button.querySelector(".bl-card-fallback")) button.appendChild(fallbackBody(entry));
      });
      button.appendChild(image);
    } else {
      media.classList.add("is-fallback");
      button.appendChild(fallbackBody(entry));
    }

    media.appendChild(button);

    if (entry.position !== null) {
      const badge = el("span", "bl-rank-badge " + rankTone(entry.position), positionLabel(entry.position));
      badge.setAttribute("aria-label", "Posição " + entry.position + " no ranking de " +
        entry.muscleName + " em " + entry.modalityName);
      media.appendChild(badge);
    }

    if (entry.origin === "pessoal" && entry.position === null) {
      media.appendChild(el("span", "bl-origin-badge", "Seu exercício"));
    }

    if (entry.hasOfficialVideo || entry.hasApprovedVideo) media.appendChild(videoBadge());

    return media;
  }

  function fallbackBody(entry) {
    const fallback = el("div", "bl-card-fallback");
    fallback.appendChild(el("span", "bl-card-fallback-initials", initials(entry.name)));
    fallback.appendChild(el("span", "bl-card-fallback-label", "Sem imagem de referência"));
    return fallback;
  }

  function card(entry) {
    const article = el("article", "ui-exercise-row bl-card");
    article.setAttribute("data-exercise-id", entry.id);
    article.setAttribute("data-origin", entry.origin);
    article.setAttribute("data-muscle", entry.muscleId || "");
    article.setAttribute("data-modality", entry.modalityId || "");
    article.setAttribute("data-ranking-position", entry.position === null ? "" : String(entry.position));
    article.setAttribute("data-has-video", entry.hasOfficialVideo || entry.hasApprovedVideo ? "true" : "false");

    article.appendChild(cardMedia(entry));

    const main = el("div", "ui-exercise-main");
    main.appendChild(el("h3", "ui-exercise-name", entry.name));

    /*
      Linha de metadados. Num exercício do usuário mostramos os músculos que
      ele mesmo declarou, como digitou: é o dado dele, não uma tradução nossa.
    */
    const meta = [];
    const declared = entry.origin === "pessoal" && entry.legacy && Array.isArray(entry.legacy.muscles)
      ? entry.legacy.muscles.filter(Boolean)
      : [];

    if (declared.length) meta.push(declared.join(", "));
    else if (entry.muscleName) meta.push(entry.muscleName);

    if (entry.modalityName) meta.push(entry.modalityName);
    if (!meta.length) meta.push("Sem classificação no catálogo");
    main.appendChild(el("p", "ui-exercise-meta", meta.join(" · ")));

    /*
      Etiquetas: categoria, posição no ranking e os músculos declarados pelo
      usuário. Grupo e modalidade já estão na linha de metadados logo acima —
      repetir aqui gastaria espaço sem informar nada.
    */
    const tags = el("div", "ui-exercise-tags");
    if (entry.categoryLabel) tags.appendChild(F.ui.chip(entry.categoryLabel, "muted"));
    if (entry.position !== null) tags.appendChild(F.ui.chip(positionLabel(entry.position) + " lugar", "accent"));

    if (tags.childNodes.length) main.appendChild(tags);

    article.appendChild(main);

    const actions = el("div", "ui-exercise-actions");
    actions.appendChild(F.ui.button({
      label: "Detalhes",
      icon: "info",
      variant: "secondary-button",
      className: "small-button",
      ariaLabel: "Ver detalhes de " + entry.name,
      onClick: () => openDetail(entry)
    }));
    actions.appendChild(F.ui.button({
      label: "Adicionar",
      icon: "plus",
      variant: "primary-button",
      className: "small-button",
      ariaLabel: "Adicionar " + entry.name + " a uma rotina",
      onClick: () => addEntry(entry)
    }));
    article.appendChild(actions);

    return article;
  }

  function openDetail(entry) {
    if (!entry) return;
    if (!entry.legacy) {
      F.showToast("Este exercício não pôde ser lido do catálogo. Recarregue a página e tente de novo.", "error", 6000);
      return;
    }
    return F.catalog.showDetail(entry.legacy);
  }

  function addEntry(entry) {
    if (!entry || !entry.legacy) return;
    F.catalog.addToRoutine(entry.legacy, { onDone: () => render() });
  }

  /* ------------------------------------------------------------------ */
  /* Filtros                                                              */
  /* ------------------------------------------------------------------ */

  function chipRow(options) {
    const wrap = el("div", "ui-chips bl-chips");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", options.label);

    options.items.forEach(item => {
      const button = el("button", "ui-chip-toggle" + (item.active ? " is-active" : ""));
      button.type = "button";
      button.setAttribute("data-value", item.value === null ? "" : String(item.value));
      button.setAttribute("aria-pressed", String(Boolean(item.active)));
      if (item.count !== undefined && item.count !== null) {
        button.appendChild(el("span", "bl-chip-label", item.label));
        button.appendChild(el("span", "bl-chip-count", String(item.count)));
      } else {
        button.textContent = item.label;
      }
      if (item.title) button.title = item.title;
      button.addEventListener("click", () => options.onPick(item.value));
      wrap.appendChild(button);
    });

    return wrap;
  }

  function filterGroup(key, label, items, onPick, hint) {
    const group = el("div", "catalog-filter bl-filter");
    group.setAttribute("data-filter-group", key);

    const head = el("div", "bl-filter-head");
    head.appendChild(el("span", "catalog-filter-label", label));
    if (hint) head.appendChild(el("span", "bl-filter-hint", hint));
    group.appendChild(head);
    group.appendChild(chipRow({ label, items, onPick }));

    return group;
  }

  function muscleFilter(counts) {
    const items = [{ value: null, label: "Todos", active: !state.muscle }];

    CATALOG.muscleGroups.forEach(group => {
      items.push({
        value: group.id,
        label: group.name,
        count: counts.muscles.get(group.id) || 0,
        active: state.muscle === group.id
      });
    });

    return filterGroup("muscle", "Grupo muscular", items, value => {
      apply({ muscle: state.muscle === value ? null : value });
    });
  }

  function modalityFilter(counts) {
    const items = [{ value: null, label: "Todas", active: !state.modality }];

    CATALOG.modalities.forEach(mode => {
      items.push({
        value: mode.id,
        label: mode.name,
        count: counts.modalities.get(mode.id) || 0,
        active: state.modality === mode.id
      });
    });

    return filterGroup("modality", "Modalidade", items, value => {
      apply({ modality: state.modality === value ? null : value });
    }, "Peso corporal só aceita exercícios sem equipamento");
  }

  function rankingFilter() {
    const positions = rankingPositions(state);
    const ready = Boolean(state.muscle && state.modality);

    if (!ready || positions.length === 0) {
      const hint = !state.muscle || !state.modality
        ? "Escolha grupo muscular e modalidade para filtrar pelo ranking"
        : "Esta combinação não tem ranking no catálogo";
      const group = filterGroup("ranking", "Classificação", [
        { value: null, label: "Todos", active: true }
      ], () => {}, hint);
      group.classList.add("is-disabled");
      Array.prototype.forEach.call(group.querySelectorAll("button"), button => { button.disabled = true; });
      return group;
    }

    const items = [{ value: null, label: "Todas", active: state.ranking === null }];

    positions.forEach(position => {
      items.push({
        value: position,
        label: positionLabel(position) + " lugar",
        count: null,
        active: Number(state.ranking) === position
      });
    });

    return filterGroup("ranking", "Classificação", items, value => {
      apply({ ranking: value === null ? null : Number(value) });
    }, CATALOG.muscleName(groupIdFrom(state.muscle)) + " · " + CATALOG.modalityName(modalityIdFrom(state.modality)));
  }

  function advancedFilters(counts) {
    const details = doc.createElement("details");
    details.className = "bl-advanced";
    const summary = doc.createElement("summary");
    summary.textContent = "Mais filtros";
    details.appendChild(summary);

    const body = el("div", "bl-advanced-body");

    const equipmentIds = Array.from(counts.equipment.keys())
      .sort((a, b) => CATALOG.equipmentLabel(a).localeCompare(CATALOG.equipmentLabel(b), "pt-BR"));

    if (equipmentIds.length) {
      body.appendChild(filterGroup("equipment", "Equipamento", [
        { value: null, label: "Todos", active: !state.equipment }
      ].concat(equipmentIds.map(id => ({
        value: id,
        label: CATALOG.equipmentLabel(id),
        count: counts.equipment.get(id),
        active: state.equipment === id
      }))), value => {
        apply({ equipment: state.equipment === value ? null : value });
      }));
    }

    if ((counts.origins.get("pessoal") || 0) > 0) {
      body.appendChild(filterGroup("source", "Origem", [
        { value: null, label: "Todo o catálogo", active: !state.origin },
        { value: "sugerido", label: "Sugeridos", count: counts.origins.get("catalogo") || 0, active: state.origin === "sugerido" },
        { value: "personalizado", label: "Seus", count: counts.origins.get("pessoal") || 0, active: state.origin === "personalizado" }
      ], value => {
        apply({ origin: state.origin === value ? null : value });
      }));
    }

    details.appendChild(body);

    if (state.equipment || state.origin) details.open = true;
    return details;
  }

  /* Filtros ativos: cada um pode ser removido sozinho. */
  function activeFilterChips() {
    const chips = [];
    const query = state.query.trim();
    if (query) chips.push({ key: "query", label: "Busca: " + query, patch: { query: "" } });
    if (state.involve) chips.push({ key: "involve", label: "Envolve: " + CATALOG.muscleName(groupIdFrom(state.involve)), patch: { involve: null } });
    if (state.muscle) chips.push({ key: "muscle", label: "Grupo: " + CATALOG.muscleName(groupIdFrom(state.muscle)), patch: { muscle: null, ranking: null } });
    if (state.modality) chips.push({ key: "modality", label: "Modalidade: " + CATALOG.modalityName(modalityIdFrom(state.modality)), patch: { modality: null, ranking: null } });
    if (state.ranking !== null) chips.push({ key: "ranking", label: "Classificação: " + positionLabel(Number(state.ranking)) + " lugar", patch: { ranking: null } });
    if (state.equipment) chips.push({ key: "equipment", label: "Equipamento: " + CATALOG.equipmentLabel(state.equipment), patch: { equipment: null } });
    if (state.origin) chips.push({ key: "source", label: state.origin === "personalizado" ? "Origem: seus exercícios" : "Origem: sugeridos", patch: { origin: null } });

    const wrap = el("div", "bl-active-filters");
    wrap.id = "bl-active-filters";
    if (!chips.length) {
      wrap.setAttribute("hidden", "");
      return wrap;
    }

    wrap.setAttribute("aria-label", "Filtros ativos");
    wrap.appendChild(el("span", "bl-active-label", "Filtros ativos"));

    chips.forEach(chip => {
      const button = el("button", "bl-active-chip");
      button.type = "button";
      button.setAttribute("data-active-filter", chip.key);
      button.setAttribute("aria-label", "Remover filtro " + chip.label);
      button.appendChild(el("span", null, chip.label));
      button.appendChild(F.ui.icon("close"));
      button.addEventListener("click", () => {
        if (chip.key === "query" && dom && dom.search) dom.search.value = "";
        apply(Object.assign({}, chip.patch));
      });
      wrap.appendChild(button);
    });

    const clear = el("button", "bl-clear-all");
    clear.type = "button";
    clear.setAttribute("data-clear-filters", "");
    clear.textContent = "Limpar tudo";
    clear.addEventListener("click", resetAll);
    wrap.appendChild(clear);

    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Lista e rankings                                                     */
  /* ------------------------------------------------------------------ */

  function renderList(list) {
    const container = dom.list;
    while (container.firstChild) container.removeChild(container.firstChild);

    if (list.length === 0) {
      container.appendChild(F.ui.empty({
        icon: "search",
        title: "Nenhum exercício com esses critérios",
        text: "Confira a grafia da busca ou remova um filtro. O catálogo tem " +
          totalExercises() + " exercícios em " + CATALOG.muscleGroups.length +
          " grupos musculares e " + CATALOG.modalities.length + " modalidades.",
        actions: [
          { label: "Limpar filtros", variant: "primary-button", icon: "close", onClick: resetAll }
        ]
      }));
      return;
    }

    const shown = list.slice(0, visible);
    shown.forEach(entry => container.appendChild(card(entry)));

    const remaining = list.length - shown.length;
    if (remaining > 0) {
      const more = el("div", "catalog-more");
      more.appendChild(F.ui.button({
        label: "Mostrar mais " + Math.min(PAGE_SIZE, remaining) + " de " + remaining,
        icon: "chevron-right",
        variant: "secondary-button",
        className: "full-width",
        onClick() {
          visible += PAGE_SIZE;
          render();
        }
      }));
      container.appendChild(more);
    }
  }

  function openCentral(id) {
    const entry = entries().find(item => item.id === id && item.origin === "catalogo");
    if (entry) openDetail(entry);
  }

  function rankingCard(group) {
    const article = el("article", "bl-ranking-card");
    article.setAttribute("data-combo", group.muscleId + "|" + group.modalityId);

    const head = el("header", "bl-ranking-head");
    head.appendChild(el("h3", "bl-ranking-title", group.muscleName));
    head.appendChild(el("span", "bl-ranking-modality", group.modalityName));
    head.appendChild(el("span", "bl-ranking-count",
      group.entries.length + (group.entries.length === 1 ? " exercício" : " exercícios")));
    article.appendChild(head);

    const list = doc.createElement("ol");
    list.className = "bl-ranking-list";

    group.entries.forEach(record => {
      const item = doc.createElement("li");
      item.className = "bl-ranking-item " + rankTone(record.position);
      item.setAttribute("data-position", String(record.position));

      item.appendChild(el("span", "bl-ranking-position", positionLabel(record.position)));

      const button = el("button", "bl-ranking-open", record.name);
      button.type = "button";
      button.setAttribute("aria-label", "Ver detalhes de " + record.name + " (" +
        record.position + "º lugar em " + group.muscleName + " · " + group.modalityName + ")");
      button.addEventListener("click", () => openCentral(record.id));
      item.appendChild(button);

      list.appendChild(item);
    });

    article.appendChild(list);

    const actions = el("div", "bl-ranking-actions");
    actions.appendChild(F.ui.button({
      label: "Ver na biblioteca",
      icon: "search",
      variant: "secondary-button",
      className: "small-button",
      ariaLabel: "Ver exercícios de " + group.muscleName + " em " + group.modalityName + " na biblioteca",
      onClick() {
        switchView("biblioteca");
        apply({ muscle: group.muscleId, modality: group.modalityId, ranking: null, query: "" });
      }
    }));
    article.appendChild(actions);

    return article;
  }

  function resetRankingFilters() {
    dom.rankingMuscle = null;
    dom.rankingModality = null;
    renderRankingFilters();
    renderRankings();
  }

  function renderRankings() {
    const container = dom.rankingsList;
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    const groups = rankings({ muscle: dom.rankingMuscle, modality: dom.rankingModality });

    if (dom.rankingsStatus) {
      dom.rankingsStatus.textContent = groups.length === 0
        ? "Nenhum ranking nesta combinação de filtros"
        : groups.length + (groups.length === 1 ? " combinação de ranking" : " combinações de ranking") +
          " · " + groups.reduce((total, group) => total + group.entries.length, 0) + " exercícios classificados";
    }

    if (groups.length === 0) {
      container.appendChild(F.ui.empty({
        icon: "target",
        title: "Nenhum ranking nesta combinação",
        text: "O catálogo só exibe posições realmente existentes. Troque o grupo muscular ou a modalidade.",
        actions: [{ label: "Limpar filtros do ranking", variant: "primary-button", icon: "close", onClick: resetRankingFilters }]
      }));
      return;
    }

    groups.forEach(group => container.appendChild(rankingCard(group)));
  }

  function renderRankingFilters() {
    if (!dom.rankingsFilters) return;
    const container = dom.rankingsFilters;
    while (container.firstChild) container.removeChild(container.firstChild);

    container.appendChild(filterGroup("ranking-muscle", "Grupo muscular",
      [{ value: null, label: "Todos", active: !dom.rankingMuscle }].concat(
        CATALOG.muscleGroups.map(group => ({
          value: group.id,
          label: group.name,
          active: dom.rankingMuscle === group.id
        }))),
      value => {
        dom.rankingMuscle = value;
        renderRankingFilters();
        renderRankings();
      }));

    container.appendChild(filterGroup("ranking-modality", "Modalidade",
      [{ value: null, label: "Todas", active: !dom.rankingModality }].concat(
        CATALOG.modalities.map(mode => ({
          value: mode.id,
          label: mode.name,
          active: dom.rankingModality === mode.id
        }))),
      value => {
        dom.rankingModality = value;
        renderRankingFilters();
        renderRankings();
      }));
  }

  /* ------------------------------------------------------------------ */
  /* Cabeçalho e navegação entre as visões                                */
  /* ------------------------------------------------------------------ */

  function renderHero() {
    if (!dom || !dom.hero) return;
    const container = dom.hero;
    while (container.firstChild) container.removeChild(container.firstChild);

    const userCount = entries().filter(entry => entry.origin === "pessoal").length;
    const videos = officialVideoCount();
    const stats = [
      { value: totalExercises(), label: totalExercises() === 1 ? "exercício no catálogo" : "exercícios no catálogo" },
      { value: CATALOG.muscleGroups.length, label: "grupos musculares" },
      { value: CATALOG.modalities.length, label: CATALOG.modalities.length === 1 ? "modalidade" : "modalidades" },
      { value: videos, label: videos === 1 ? "com demonstração oficial" : "com demonstração oficial" }
    ];

    if (userCount > 0) {
      stats.push({ value: userCount, label: userCount === 1 ? "seu exercício" : "seus exercícios" });
    }

    stats.forEach(stat => {
      const box = el("div", "bl-stat");
      box.appendChild(el("span", "bl-stat-value", String(stat.value)));
      box.appendChild(el("span", "bl-stat-label", stat.label));
      container.appendChild(box);
    });
  }

  function switchView(view) {
    state.view = view === "rankings" ? "rankings" : "biblioteca";
    if (dom && dom.views) {
      dom.views.biblioteca.hidden = state.view !== "biblioteca";
      dom.views.rankings.hidden = state.view !== "rankings";
    }
    if (dom && dom.tabs) {
      Array.prototype.forEach.call(dom.tabs.querySelectorAll("[data-view]"), button => {
        const active = button.getAttribute("data-view") === state.view;
        button.setAttribute("aria-pressed", String(active));
        button.classList.toggle("is-active", active);
      });
    }
    if (state.view === "rankings") {
      renderRankingFilters();
      renderRankings();
    }
  }

  function buildTabs() {
    const group = el("div", "bl-tabs");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Visões da biblioteca");

    [
      { view: "biblioteca", label: "Explorar exercícios" },
      { view: "rankings", label: "Rankings" }
    ].forEach(item => {
      const button = el("button", "bl-tab", item.label);
      button.type = "button";
      button.setAttribute("data-view", item.view);
      button.setAttribute("aria-pressed", String(state.view === item.view));
      if (state.view === item.view) button.classList.add("is-active");
      button.addEventListener("click", () => switchView(item.view));
      group.appendChild(button);
    });

    return group;
  }

  /* ------------------------------------------------------------------ */
  /* Render principal                                                     */
  /* ------------------------------------------------------------------ */

  function rememberFocus() {
    const node = doc.activeElement;
    if (!node || !node.closest || !dom || !dom.controls) return null;
    const group = node.closest("[data-filter-group]");
    if (!group || !dom.controls.contains(group)) return null;
    return {
      group: group.getAttribute("data-filter-group"),
      value: node.getAttribute("data-value")
    };
  }

  function restoreFocus(target) {
    if (!target || !dom || !dom.controls) return;
    const group = dom.controls.querySelector('[data-filter-group="' + target.group + '"]');
    if (!group) return;
    const match = Array.prototype.slice.call(group.querySelectorAll("[data-value]"))
      .find(node => node.getAttribute("data-value") === target.value);
    if (match && typeof match.focus === "function") match.focus();
  }

  function render() {
    if (!dom) return;

    const focus = rememberFocus();

    /* A classificação só existe dentro de um grupo e de uma modalidade. */
    if (state.ranking !== null && (!state.muscle || !state.modality)) state.ranking = null;

    const found = filter(state);
    const counts = facets(state);

    while (dom.controls.firstChild) dom.controls.removeChild(dom.controls.firstChild);

    dom.controls.appendChild(muscleFilter(counts));
    dom.controls.appendChild(modalityFilter(counts));
    dom.controls.appendChild(rankingFilter());
    dom.controls.appendChild(advancedFilters(counts));

    const activeWrap = activeFilterChips();
    if (dom.activeFilters.parentNode) {
      dom.activeFilters.parentNode.replaceChild(activeWrap, dom.activeFilters);
    }
    dom.activeFilters = activeWrap;

    if (dom.searchClear) dom.searchClear.hidden = !state.query;

    dom.status.textContent = found.length === 0
      ? "Nenhum exercício com esses critérios"
      : found.length + (found.length === 1 ? " exercício" : " exercícios") +
        (hasActiveFilters() ? " com os filtros atuais" : " no catálogo");

    renderList(found);

    lastSignature = signature();
    restoreFocus(focus);
  }

  /* ------------------------------------------------------------------ */
  /* Montagem da página                                                   */
  /* ------------------------------------------------------------------ */

  function buildSearch() {
    const wrap = el("div", "ui-search-field catalog-search-wrap bl-search");

    const input = doc.createElement("input");
    input.type = "search";
    input.id = "catalog-search";
    input.className = "catalog-search";
    input.placeholder = "Buscar exercício por nome";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Buscar exercício por nome");
    input.setAttribute("aria-describedby", "catalog-status");
    input.value = state.query;

    input.addEventListener("input", () => {
      apply({ query: input.value });
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Escape" && input.value) {
        event.preventDefault();
        input.value = "";
        apply({ query: "" });
      }
    });

    wrap.appendChild(F.ui.icon("search"));
    wrap.appendChild(input);

    const clear = el("button", "bl-search-clear");
    clear.type = "button";
    clear.setAttribute("data-clear-search", "");
    clear.setAttribute("aria-label", "Limpar a busca");
    clear.appendChild(F.ui.icon("close"));
    clear.hidden = !state.query;
    clear.addEventListener("click", () => {
      input.value = "";
      apply({ query: "" });
      input.focus();
    });
    wrap.appendChild(clear);

    dom.search = input;
    dom.searchClear = clear;
    return wrap;
  }

  function mount() {
    const root = doc.getElementById("catalog-root");
    if (!root) return;

    while (root.firstChild) root.removeChild(root.firstChild);

    dom = {
      root,
      hero: doc.getElementById("bl-hero-stats"),
      tabs: doc.getElementById("bl-tabs"),
      views: {
        biblioteca: doc.getElementById("bl-view-biblioteca"),
        rankings: doc.getElementById("bl-view-rankings")
      },
      rankingsFilters: doc.getElementById("rankings-filters"),
      rankingsList: doc.getElementById("rankings-list"),
      rankingsStatus: doc.getElementById("rankings-status"),
      rankingMuscle: null,
      rankingModality: null
    };

    root.appendChild(buildSearch());

    dom.activeFilters = el("div", "bl-active-filters");
    dom.activeFilters.id = "bl-active-filters";
    dom.activeFilters.setAttribute("hidden", "");
    root.appendChild(dom.activeFilters);

    dom.controls = el("div", "catalog-controls bl-filters");
    dom.controls.id = "catalog-controls";
    root.appendChild(dom.controls);

    const status = el("p", "catalog-status");
    status.id = "catalog-status";
    status.setAttribute("aria-live", "polite");
    dom.status = status;
    root.appendChild(status);

    dom.list = el("div", "catalog-list");
    dom.list.id = "catalog-list";
    root.appendChild(dom.list);

    if (F.state && F.state.activeWorkout) {
      root.appendChild(el("p", "ui-inline-note catalog-session-note",
        "Há uma sessão de treino em andamento. Adicionar um exercício aqui não muda a sessão já iniciada — ele vale para os próximos treinos."));
    }

    if (dom.tabs) {
      dom.tabs.replaceChildren(buildTabs());
    }

    renderHero();
  }

  /*
    O selo "Vídeo" do cartão vem apenas do catálogo oficial (`F.videos`), que é
    conteúdo local. A associação aprovada no painel administrativo é buscada só
    quando o detalhe abre (`F.youtube.render`) — a listagem não faz nenhuma
    requisição de rede: abrir e filtrar a biblioteca continua sem tráfego e sem
    escrita.
  */

  /* ------------------------------------------------------------------ */
  /* Parâmetros de URL (links do atlas, do detalhe e de filtros)          */
  /* ------------------------------------------------------------------ */

  function readParams() {
    let params;
    try {
      params = new URLSearchParams(global.location.search);
    } catch (error) {
      return new URLSearchParams("");
    }

    const query = params.get("busca") || params.get("q");
    if (query) state.query = query;

    /*
      Dois parâmetros de músculo, com significados diferentes:
      - `musculo` vem da legenda do atlas e significa "envolve este grupo" em
        qualquer papel (principal, secundário ou estabilizador);
      - `grupo` é o filtro de grupo muscular principal do próprio painel.
    */
    const involve = groupIdFrom(params.get("musculo"));
    if (involve) state.involve = involve;

    const muscle = groupIdFrom(params.get("grupo"));
    if (muscle) state.muscle = muscle;

    const resolvedModality = modalityIdFrom(params.get("modalidade"));
    if (resolvedModality) state.modality = resolvedModality;

    const ranking = Number(params.get("ranking"));
    if (Number.isInteger(ranking) && ranking > 0) state.ranking = ranking;

    const equipment = params.get("equipamento");
    if (equipment) state.equipment = equipment;

    const origin = params.get("origem");
    if (origin === "sugerido" || origin === "catalogo") state.origin = "sugerido";
    if (origin === "personalizado" || origin === "pessoal") state.origin = "personalizado";

    if (params.get("visao") === "rankings" || global.location.hash === "#rankings") {
      state.view = "rankings";
    }

    return params;
  }

  function openRequestedExercise(id) {
    if (!id) return;
    const canonical = CATALOG.legacyIdMap[id] || id;
    const entry = entries().find(item => item.origin === "catalogo" && item.id === canonical)
      || entries().find(item => item.id === id);

    if (!entry) {
      F.showToast("O exercício do link não está no catálogo. A biblioteca foi aberta completa.", "info", 6000);
      return;
    }

    openDetail(entry);
  }

  function refresh() {
    invalidate();
    renderHero();
    render();
    if (state.view === "rankings") renderRankings();
  }

  function init() {
    const params = readParams();
    mount();
    if (!dom) return;

    switchView(state.view);
    render();

    F.catalog.setPageRefresh(refresh);

    if (typeof F.onDataChanged === "function") F.onDataChanged(refresh);

    /*
      Outra aba pode criar um exercício personalizado: relê a memória (sem
      gravar nada) e redesenha com os dados frescos.
    */
    const watchedKeys = F.KEYS
      ? [F.KEYS.library, F.KEYS.routines, F.KEYS.legacyExercises]
      : [];
    global.addEventListener("storage", event => {
      if (!event) return;
      if (event.key !== null && watchedKeys.indexOf(event.key) === -1) return;
      if (typeof F.syncStateFromStorage === "function") F.syncStateFromStorage(event.key);
      refresh();
    });
    global.addEventListener("pageshow", event => {
      if (!event || !event.persisted) return;
      if (typeof F.syncStateFromStorage === "function") F.syncStateFromStorage(null);
      refresh();
    });

    if (params.get("exercicio")) openRequestedExercise(params.get("exercicio"));
  }

  F.biblioteca = Object.freeze({
    entries,
    filter,
    facets,
    rankings,
    rankingPositions,
    totalExercises,
    officialVideoCount,
    groupIdFrom,
    modalityIdFrom,
    init,
    state,
    /* Uso interno dos testes e de telas que só querem a contagem. */
    _resetCache: invalidate
  });

  F.pages.biblioteca = init;
})(window);
