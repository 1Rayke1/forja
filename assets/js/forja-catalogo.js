/*
  FORJA — catálogo de exercícios (dados de referência e a tela Biblioteca).

  Duas responsabilidades, separadas do módulo de treino:

  1. `F.catalog`: junta os itens sugeridos (`forja-biblioteca.js`) com os
     personalizados (`forja-treino-biblioteca-v1`), anexa os metadados de
     catálogo (categoria, grupos musculares, equipamento, execução) e oferece
     busca com normalização e contagem por faceta. Não grava nada sozinho.

  2. `F.pages.biblioteca`: a tela completa — busca, filtros, detalhe com
     instruções e ação real de adicionar o exercício a uma rotina existente.

  Os metadados abaixo são conteúdo do app (não estatística do usuário): eles
  descrevem o exercício sugerido. Um item personalizado sem metadados aparece
  com o que o usuário digitou — nada é preenchido por suposição.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const MODES = ["calisthenics", "weights"];
  const SECTIONS = F.SECTION_ORDER;

  const CATEGORY_NAMES = Object.freeze({
    push: "Empurrar",
    pull: "Puxar",
    legs: "Pernas",
    core: "Core",
    cardio: "Cardio",
    mobility: "Mobilidade"
  });

  const BODY_WEIGHT = "peso corporal";

  /*
    Metadados dos itens sugeridos, por id de `forja-biblioteca.js`.
    `muscles` são os grupos mais exigidos no movimento, não uma lista fechada.
  */
  /*
    Metadados dos itens sugeridos, por id de `forja-biblioteca.js`.

    `roles` é a fonte única da classificação muscular: diz, para cada exercício,
    quais grupos são principais, quais são secundários e quais estabilizam o
    movimento. A lista plana `muscles` do catálogo é derivada dessa estrutura
    (ver `metadataFor`), então a biblioteca, a busca e o atlas nunca divergem.

    Regras seguidas ao revisar os dados (detalhadas em
    docs/atlas-anatomico.md):

    - `primary` é o grupo que produz a maior parte do movimento, não "todos os
      músculos que se mexem". Nenhum item tem mais de dois grupos principais.
    - `secondary` e `stabilizers` só aparecem quando a participação é clara no
      movimento descrito; na dúvida, o campo é omitido.
    - Exercícios de mobilidade e de condicionamento usam a região geral
      ("ombros", "pernas") em vez de inventar um grupo específico.
    - Um item personalizado não recebe `roles`: o usuário informa só os grupos
      que quiser, e o atlas não inventa classificação para ele.
  */
  const SUGGESTED_META = Object.freeze({
    "cal-rotacao-ombros": {
      category: "mobility", roles: { primary: ["ombros"] }, equipment: [BODY_WEIGHT],
      instructions: "Em pé, gire os ombros para trás e para frente em círculos amplos e lentos. Amplitude confortável, sem prender a respiração."
    },
    "cal-mobilidade-quadril": {
      category: "mobility", roles: { primary: ["quadril"], secondary: ["glúteos"] }, equipment: [BODY_WEIGHT],
      instructions: "Deitado ou em pé, leve o joelho ao peito e abra a perna para o lado, controlando o movimento. Troque de lado a cada série."
    },
    "cal-polichinelo": {
      category: "cardio", roles: { primary: ["pernas"], secondary: ["ombros"] }, equipment: [BODY_WEIGHT],
      instructions: "Abra pernas e braços ao saltar, feche na volta. Mantenha o abdômen ativo para amortecer a chegada."
    },
    "cal-flexao": {
      category: "push", roles: { primary: ["peito"], secondary: ["tríceps", "ombros"], stabilizers: ["abdômen"] }, equipment: [BODY_WEIGHT],
      instructions: "Corpo em prancha, cotovelos a cerca de 45° do tronco, desça até o peito ficar perto do chão. Para reduzir dificuldade, apoie os joelhos."
    },
    "cal-agachamento": {
      category: "legs", roles: { primary: ["quadríceps"], secondary: ["glúteos"], stabilizers: ["abdômen"] }, equipment: [BODY_WEIGHT],
      instructions: "Pés na largura dos ombros, desça o quadril para trás mantendo o peito aberto e os calcanhares no chão."
    },
    "cal-barra-fixa": {
      category: "pull", roles: { primary: ["dorsais"], secondary: ["bíceps"], stabilizers: ["abdômen"] }, equipment: ["barra fixa"],
      instructions: "Pegada pronada, puxe até o queixo passar da barra controlando a descida. Se não conseguir a amplitude completa, use elástico ou faça negativas."
    },
    "cal-remada-invertida": {
      category: "pull", roles: { primary: ["dorsais"], secondary: ["costas"], stabilizers: ["abdômen"] }, equipment: ["barra fixa", "argolas"],
      instructions: "Sob a barra ou argolas, corpo reto, puxe o peito em direção ao apoio e segure um instante em cima."
    },
    "cal-mergulho": {
      category: "push", roles: { primary: ["tríceps"], secondary: ["peito", "ombros"], stabilizers: ["abdômen"] }, equipment: ["paralelas"],
      instructions: "Nos apoios, desça o quadril dobrando os cotovelos para trás e empurre de volta. Amplitude conforme o ombro permitir."
    },
    "cal-afundo": {
      category: "legs", roles: { primary: ["quadríceps"], secondary: ["glúteos"], stabilizers: ["abdômen"] }, equipment: [BODY_WEIGHT],
      instructions: "Passe uma perna à frente e desça até o joelho de trás quase tocar o chão. Alterne as pernas a cada repetição."
    },
    "cal-ponte": {
      category: "legs", roles: { primary: ["glúteos"], secondary: ["posterior de coxa"], stabilizers: ["abdômen"] }, equipment: [BODY_WEIGHT],
      instructions: "Deitado, pés no chão, eleve o quadril apertando os glúteos e segure dois segundos no topo."
    },
    "cal-prancha-frontal": {
      category: "core", roles: { primary: ["abdômen"], secondary: ["lombar"], stabilizers: ["ombros", "glúteos"] }, equipment: [BODY_WEIGHT],
      instructions: "Antebraços no chão, corpo em linha reta, glúteos contraídos. Não deixe o quadril cair nem subir."
    },
    "cal-prancha-lateral": {
      category: "core", roles: { primary: ["oblíquos"], secondary: ["abdômen"], stabilizers: ["ombros"] }, equipment: [BODY_WEIGHT],
      instructions: "Apoie um antebraço, eleve o quadril e alinhe o corpo. Faça o mesmo tempo dos dois lados."
    },
    "cal-abdominal-supra": {
      category: "core", roles: { primary: ["abdômen"] }, equipment: [BODY_WEIGHT],
      instructions: "Joelhos dobrados, tire apenas as escápulas do chão contraindo o abdômen, sem puxar o pescoço."
    },
    "cal-elevacao-pernas": {
      category: "core", roles: { primary: ["abdômen"], secondary: ["quadril"], stabilizers: ["lombar"] }, equipment: [BODY_WEIGHT],
      instructions: "Deitado, pernas estendidas, suba até cerca de 90° e desça devagar sem deixar a lombar descolar do chão."
    },
    "cal-abdominal-infra": {
      category: "core", roles: { primary: ["abdômen"], secondary: ["quadril"] }, equipment: [BODY_WEIGHT],
      instructions: "Mãos ao lado do corpo, eleve e baixe as pernas mantendo a lombar apoiada; reduza a amplitude se sentir dor nas costas."
    },
    "cal-burpee": {
      category: "cardio", roles: { primary: ["pernas"], secondary: ["peito"], stabilizers: ["abdômen"] }, equipment: [BODY_WEIGHT],
      instructions: "Agache, jogue os pés para a prancha, volte e salte. Priorize ritmo constante em vez de amplitude máxima."
    },
    "cal-mountain-climber": {
      category: "cardio", roles: { primary: ["abdômen"], secondary: ["quadril"], stabilizers: ["ombros"] }, equipment: [BODY_WEIGHT],
      instructions: "Na prancha, traga os joelhos ao peito alternando as pernas sem deixar o quadril subir."
    },
    "cal-corrida-estacionaria": {
      category: "cardio", roles: { primary: ["pernas"] }, equipment: [BODY_WEIGHT],
      instructions: "Corra no lugar com passada leve e joelhos à altura confortável. Serve para elevar a frequência cardíaca entre blocos."
    },
    "mus-esteira": {
      category: "cardio", roles: { primary: ["pernas"] }, equipment: ["esteira"],
      instructions: "Ritmo leve, respiração controlada, ainda conseguindo conversar. Ajuste a velocidade em vez de inclinar o tronco."
    },
    "mus-mobilidade-ombro": {
      category: "mobility", roles: { primary: ["ombros"] }, equipment: ["elástico"],
      instructions: "Com o elástico à frente, abra os braços mantendo os ombros longe das orelhas. Movimento lento e simétrico."
    },
    "mus-supino-reto": {
      category: "push", roles: { primary: ["peito"], secondary: ["tríceps", "ombros"], stabilizers: ["abdômen"] }, equipment: ["barra", "banco"],
      instructions: "Escápulas retraídas, pés no chão, desça a barra até a linha do peito e empurre sem tirar o quadril do banco."
    },
    "mus-agachamento-barra": {
      category: "legs", roles: { primary: ["quadríceps"], secondary: ["glúteos"], stabilizers: ["abdômen", "lombar"] }, equipment: ["barra", "rack"],
      instructions: "Barra sobre o trapézio, desça o quadril para trás mantendo o tronco firme e os pés inteiros no chão."
    },
    "mus-terra": {
      category: "pull", roles: { primary: ["glúteos"], secondary: ["posterior de coxa", "lombar"], stabilizers: ["abdômen", "dorsais"] }, equipment: ["barra"],
      instructions: "Barra sobre o meio do pé, coluna neutra, empurre o chão com as pernas e termine com ombros e quadril alinhados."
    },
    "mus-puxada-frontal": {
      category: "pull", roles: { primary: ["dorsais"], secondary: ["bíceps"], stabilizers: ["abdômen"] }, equipment: ["polia"],
      instructions: "Puxe a barra até a clavícula levando os cotovelos para baixo e para trás, sem jogar o tronco."
    },
    "mus-desenvolvimento": {
      category: "push", roles: { primary: ["ombros"], secondary: ["tríceps"], stabilizers: ["abdômen"] }, equipment: ["halteres"],
      instructions: "Halteres na altura das orelhas, empurre para cima sem estender totalmente o cotovelo. Abdômen contraído para não arquear a lombar."
    },
    "mus-remada-curvada": {
      category: "pull", roles: { primary: ["dorsais"], secondary: ["costas", "bíceps"], stabilizers: ["lombar"] }, equipment: ["barra"],
      instructions: "Tronco inclinado e estável, puxe a barra em direção ao umbigo e desça controlando o peso."
    },
    "mus-leg-press": {
      category: "legs", roles: { primary: ["quadríceps"], secondary: ["glúteos"] }, equipment: ["máquina"],
      instructions: "Pés no meio da plataforma, desça até cerca de 90° sem descolar o quadril do encosto. Não trave os joelhos no fim."
    },
    "mus-rosca-direta": {
      category: "pull", roles: { primary: ["bíceps"], secondary: ["antebraços"] }, equipment: ["barra", "halteres"],
      instructions: "Cotovelos fixos na lateral do corpo, suba o peso sem balançar o tronco."
    },
    "mus-triceps-polia": {
      category: "push", roles: { primary: ["tríceps"] }, equipment: ["polia"],
      instructions: "Cotovelos colados ao corpo, estenda os braços e volte devagar até a altura do peito."
    },
    "mus-extensora": {
      category: "legs", roles: { primary: ["quadríceps"] }, equipment: ["máquina"],
      instructions: "Estenda as pernas até alinhar com o assento, segure um instante e resista na volta."
    },
    "mus-flexora": {
      category: "legs", roles: { primary: ["posterior de coxa"] }, equipment: ["máquina"],
      instructions: "Dobre os joelhos trazendo o peso na direção dos glúteos e volte devagar, sem usar impulso."
    },
    "mus-elevacao-lateral": {
      category: "push", roles: { primary: ["ombros"] }, equipment: ["halteres"],
      instructions: "Suba os halteres até a linha dos ombros com os cotovelos levemente dobrados; carga moderada vale mais que amplitude forçada."
    },
    "mus-abdominal-polia": {
      category: "core", roles: { primary: ["abdômen"] }, equipment: ["polia"],
      instructions: "Ajoelhado, segure a corda junto à cabeça e flexione o tronco contraindo o abdômen, não os quadris."
    },
    "mus-prancha": {
      category: "core", roles: { primary: ["abdômen"], secondary: ["lombar"], stabilizers: ["ombros"] }, equipment: [BODY_WEIGHT],
      instructions: "Antebraços no chão e corpo em linha reta; respire normalmente durante todo o tempo."
    },
    "mus-elevacao-barra": {
      category: "core", roles: { primary: ["abdômen"], secondary: ["quadril"], stabilizers: ["antebraços"] }, equipment: ["barra fixa"],
      instructions: "Pendurado na barra, suba as pernas até o quadril enrolar levemente. Desça sem balançar."
    },
    "mus-bicicleta": {
      category: "cardio", roles: { primary: ["pernas"] }, equipment: ["bike"],
      instructions: "Cadência confortável com resistência leve; serve para soltar as pernas depois do bloco principal."
    },
    "mus-farmer": {
      category: "carry", roles: { primary: ["antebraços"], secondary: ["ombros"], stabilizers: ["abdômen"] }, equipment: ["halteres", "kettlebell"],
      instructions: "Segure cargas pesadas ao lado do corpo, ombros encaixados, e caminhe em linha reta pelo tempo indicado."
    }
  });

  const EXTRA_CATEGORIES = Object.freeze({ carry: "Carregamento" });

  function categoryLabel(value) {
    if (!value) return null;
    return CATEGORY_NAMES[value] || EXTRA_CATEGORIES[value] || value;
  }

  function normalizeText(value) {
    return String(value === undefined || value === null ? "" : value)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  }

  function uniqueList(values) {
    const out = [];
    const seen = Object.create(null);

    (values || []).forEach(value => {
      const key = normalizeText(value);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(String(value));
    });

    return out;
  }

  /*
    Metadados de catálogo de qualquer item (sugerido ou personalizado). Para um
    item personalizado sem metadados, devolve listas vazias — nada é inventado.
  */
  /*
    Normaliza a classificação muscular. A ordem é sempre principal →
    secundário → estabilizador, e um grupo aparece em um único nível. Valores
    vazios ou repetidos são descartados; se nada sobrar, a classificação é
    `null` (nada é inventado).
  */
  function normalizeRoles(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

    const primary = uniqueList(raw.primary).filter(Boolean);
    const secondary = uniqueList(raw.secondary)
      .filter(muscle => muscle && primary.indexOf(muscle) === -1);
    const stabilizers = uniqueList(raw.stabilizers)
      .filter(muscle => muscle && primary.indexOf(muscle) === -1 && secondary.indexOf(muscle) === -1);

    if (primary.length === 0 && secondary.length === 0 && stabilizers.length === 0) return null;

    return { primary, secondary, stabilizers };
  }

  /* Lista plana de grupos: derivada dos níveis, na ordem principal → estabilizador. */
  function musclesFromRoles(roles) {
    if (!roles) return [];
    return uniqueList([].concat(roles.primary, roles.secondary, roles.stabilizers));
  }

  /*
    Metadados de catálogo de qualquer item (sugerido ou personalizado).

    Para um item sugerido, `roles` vem do catálogo e a lista plana `muscles` é
    derivada dela. Para um item personalizado sem metadados, `roles` é `null` e
    as listas vazias — nada é inventado. Se o usuário digitou grupos no item
    personalizado, eles continuam valendo como lista plana e o atlas os trata
    como "informado por você", sem alegar papel principal/secundário.
  */
  function metadataFor(item) {
    if (!item) return null;

    const meta = SUGGESTED_META[item.id];
    const category = item.category || (meta && meta.category) || "";
    const roles = normalizeRoles(item.roles) || normalizeRoles(meta && meta.roles);
    const declaredMuscles = Array.isArray(item.muscles) && item.muscles.length ? item.muscles : [];
    const muscles = roles ? musclesFromRoles(roles) : declaredMuscles;
    const equipment = Array.isArray(item.equipment) && item.equipment.length
      ? item.equipment
      : (meta && meta.equipment) || [];

    return {
      category,
      label: categoryLabel(category),
      roles,
      muscles: muscles.slice(0, 6),
      equipment: equipment.slice(0, 6),
      instructions: item.instructions || (meta && meta.instructions) || ""
    };
  }

  /*
    Registro canônico do catálogo: o que a biblioteca tem de comum entre um
    item sugerido e um personalizado. `measure` vem do normalizador, que
    deriva de `type`/`load` quando o campo não foi salvo.
  */
  function catalogRecord(raw, mode, source) {
    const normalized = F.normalizeLibraryItem(raw, mode);
    if (!normalized) return null;

    const meta = metadataFor(normalized);

    return Object.assign(normalized, {
      mode,
      source,
      libraryId: source === "sugerido" ? normalized.id : (normalized.libraryId || normalized.id),
      category: meta.category,
      roles: meta.roles,
      muscles: meta.muscles,
      equipment: meta.equipment,
      instructions: meta.instructions,
      suggested: source === "sugerido"
    });
  }

  function items(mode) {
    const modes = mode && MODES.indexOf(mode) !== -1 ? [mode] : MODES;
    const out = [];

    modes.forEach(currentMode => {
      const custom = (F.state.library && F.state.library[currentMode]) || [];
      const suggested = (F.EXERCISE_LIBRARY && F.EXERCISE_LIBRARY[currentMode]) || [];

      custom.forEach(item => {
        const record = catalogRecord(item, currentMode, "personalizado");
        if (record) out.push(record);
      });

      suggested.forEach(item => {
        const record = catalogRecord(item, currentMode, "sugerido");
        if (record) out.push(record);
      });
    });

    return out;
  }

  /* O item da biblioteca de rotina é o exercício copiado, com id novo. */
  function toExercise(record, section) {
    const copy = F.normalizeExercise(Object.assign({}, record, {
      id: F.createId("exercise"),
      libraryId: record.libraryId || record.id,
      section: SECTIONS.indexOf(section) !== -1 ? section : record.section,
      load: record.mode === "weights" ? record.load || "" : ""
    }), record.section);

    if (copy && !copy.instructions) copy.instructions = record.instructions || "";

    return copy;
  }

  /* Busca textual: nome, categoria, grupos musculares e equipamento. */
  function matches(record, query) {
    if (!query) return true;

    const haystack = [
      record.name,
      categoryLabel(record.category),
      F.MODE_NAMES[record.mode],
      F.SECTION_NAMES[record.section],
      record.muscles.join(" "),
      record.equipment.join(" "),
      record.reps,
      record.load
    ].map(normalizeText).join(" · ");

    return query.split(/\s+/).filter(Boolean).every(term => haystack.includes(term));
  }

  function filter(options) {
    const query = normalizeText(options.query);
    const state = options;

    return items(state.mode).filter(record => {
      if (state.section && record.section !== state.section) return false;
      if (state.measure && record.measure !== state.measure) return false;
      if (state.category && record.category !== state.category) return false;
      if (state.source && record.source !== state.source) return false;
      if (state.muscle && !record.muscles.some(item => normalizeText(item) === normalizeText(state.muscle))) return false;
      if (state.equipment && !record.equipment.some(item => normalizeText(item) === normalizeText(state.equipment))) return false;

      return matches(record, query);
    });
  }

  function countBy(list, extractor) {
    const counts = new Map();

    list.forEach(record => {
      const keys = uniqueList(extractor(record) || []).filter(Boolean);
      keys.forEach(key => {
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });

    return counts;
  }

  /*
    Total por faceta sobre o catálogo já reduzido pela busca e pelos outros
    filtros. Os chips mostram quanto cada valor tem, então o usuário nunca clica
    em um filtro que devolveria lista vazia sem aviso.
  */
  function facets(options = {}) {
    const base = filter(Object.assign({}, options, {
      section: null,
      measure: null,
      category: null,
      muscle: null,
      equipment: null,
      source: null
    }));

    const list = base.filter(record => {
      if (options.section && record.section !== options.section) return false;
      if (options.measure && record.measure !== options.measure) return false;
      if (options.category && record.category !== options.category) return false;
      if (options.source && record.source !== options.source) return false;

      return true;
    });

    return {
      total: list.length,
      sections: countBy(list, record => [F.SECTION_NAMES[record.section]]),
      sectionValues: countBy(list, record => [record.section]),
      measures: countBy(list, record => [F.MEASURE_NAMES[record.measure]]),
      measureValues: countBy(list, record => [record.measure]),
      categories: countBy(list, record => [categoryLabel(record.category)]),
      categoryValues: countBy(list, record => [record.category]),
      muscles: countBy(list, record => record.muscles),
      equipment: countBy(list, record => record.equipment),
      sources: countBy(list, record => [record.source])
    };
  }

  /* Resumo de uma linha da lista (sem inventar nada quando falta campo). */
  function summary(record) {
    const parts = [
      record.sets + (record.sets === 1 ? " série" : " séries"),
      F.formatPlannedValue(record),
      "descanso " + F.formatRestValue(record.rest)
    ];

    if (record.mode === "weights" && record.load) parts.push("carga " + record.load);
    parts.push(record.source === "personalizado" ? "seu exercício" : "sugerido");

    return parts.join(" · ");
  }

  /* ------------------------------------------------------------------ */
  /* API pública                                                         */
  /* ------------------------------------------------------------------ */

  F.catalog = {
    CATEGORY_NAMES: Object.assign({}, CATEGORY_NAMES, EXTRA_CATEGORIES),
    categoryLabel,
    normalizeText,
    items,
    filter,
    facets,
    summary,
    metadataFor,
    normalizeRoles,
    musclesFromRoles,
    toExercise,
    /* Categorias presentes no catálogo atual (para o formulário). */
    categories(mode) {
      const used = countBy(items(mode), record => [record.category]);
      const keys = Array.from(used.keys()).filter(Boolean);

      return keys.sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), "pt-BR"));
    }
  };

  /* ------------------------------------------------------------------ */
  /* Página: treino/biblioteca.html                                       */
  /* ------------------------------------------------------------------ */

  const state = {
    query: "",
    mode: null,
    section: null,
    measure: null,
    category: null,
    muscle: null,
    equipment: null,
    source: null
  };

  /*
    Divulgação progressiva: a tela cabe no bolso antes de rolar 37 cartões.
    O limite é do desenho, não dos dados — "Mostrar mais" revela o resto e o
    contador diz exatamente quantos faltam.
  */
  const PAGE_SIZE = 12;
  let visible = PAGE_SIZE;
  let lastSignature = "";

  function signature() {
    return JSON.stringify(state);
  }

  function applyFilters(patch) {
    Object.assign(state, patch);
    if (signature() !== lastSignature) visible = PAGE_SIZE;
    update();
  }

  const FILTER_KEYS = ["section", "measure", "category", "muscle", "equipment", "source"];

  let host = null;
  let controls = null;
  let status = null;
  let list = null;
  let search = null;

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function activeFilterCount() {
    return FILTER_KEYS.filter(key => state[key]).length +
      (state.mode ? 1 : 0) +
      (F.catalog.normalizeText(state.query) ? 1 : 0);
  }

  function resetFilters() {
    state.query = "";
    state.mode = null;
    FILTER_KEYS.forEach(key => { state[key] = null; });
    if (search) search.value = "";
    visible = PAGE_SIZE;
    update();
    if (search) search.focus();
  }

  /*
    Fábrica de linha de filtro. O wrapper guarda a chave do filtro para que,
    depois de redesenhar, o foco volte ao mesmo botão (importante no teclado).
  */
  function filterRow(key, label, entries, hint) {
    if (entries.length === 0) return null;

    const wrap = F.ui.el("div", "catalog-filter");
    wrap.setAttribute("data-filter-group", key);
    wrap.appendChild(F.ui.el("span", "catalog-filter-label", label));
    wrap.appendChild(F.ui.filterChips({
      label: label + (hint ? " — " + hint : ""),
      options: [{ label: "Todos", value: null, active: !state[key] }].concat(entries.map(entry => ({
        label: entry.label,
        value: entry.value,
        count: entry.count,
        active: entry.value === state[key]
      }))),
      onChange(value) {
        applyFilters({ [key]: state[key] === value ? null : value });
      }
    }));

    return wrap;
  }

  function rememberFocus() {
    const node = doc.activeElement;
    if (!node || !node.closest || !controls) return null;

    const group = node.closest("[data-filter-group]");
    if (!group || !controls.contains(group)) return null;

    return {
      group: group.getAttribute("data-filter-group"),
      value: node.getAttribute("data-value")
    };
  }

  function restoreFocus(target) {
    if (!target || !controls) return;

    const group = controls.querySelector('[data-filter-group="' + target.group + '"]');
    if (!group) return;

    const match = Array.prototype.slice.call(group.querySelectorAll("[data-value]"))
      .find(node => node.getAttribute("data-value") === target.value);

    if (match && typeof match.focus === "function") match.focus();
  }

  /*
    Etiquetas da linha. Na tela do bolso o que identifica o exercício precisa
    aparecer sem rolagem extra: mostramos as quatro primeiras e o resto fica no
    `+N` (com o texto completo no título), nunca escondido sem aviso. O tipo de
    medição não repete aqui — a linha de cima já diz "10 repetições" ou
    "30 s por série".
  */
  const TAG_LIMIT = 4;

  function tagRow(record) {
    const tags = [
      { text: F.SECTION_NAMES[record.section] },
      { text: F.MODE_NAMES[record.mode], tone: record.mode === "weights" ? "accent" : null }
    ];

    if (record.category) tags.push({ text: F.catalog.categoryLabel(record.category), tone: "accent" });
    record.muscles.forEach(muscle => tags.push({ text: muscle, tone: "muted" }));
    record.equipment.forEach(equipment => tags.push({ text: equipment, tone: "muted" }));

    const row = F.ui.el("div", "ui-exercise-tags");
    tags.slice(0, TAG_LIMIT).forEach(tag => row.appendChild(F.ui.chip(tag.text, tag.tone)));

    if (tags.length > TAG_LIMIT) {
      const hidden = tags.slice(TAG_LIMIT).map(tag => tag.text).join(", ");
      const more = F.ui.chip("+" + (tags.length - TAG_LIMIT), "muted");
      more.title = hidden;
      row.appendChild(more);
    }

    return row;
  }

  function recordRow(record) {
    const row = F.ui.el("div", "ui-exercise-row");
    const main = F.ui.el("div", "ui-exercise-main");

    main.appendChild(F.ui.el("h3", "ui-exercise-name", record.name));
    main.appendChild(F.ui.el("p", "ui-exercise-meta", F.catalog.summary(record)));

    main.appendChild(tagRow(record));
    row.appendChild(main);

    const actions = F.ui.el("div", "ui-exercise-actions");
    actions.appendChild(F.ui.button({
      label: "Detalhes",
      icon: "info",
      variant: "secondary-button",
      className: "small-button",
      ariaLabel: "Ver detalhes de " + record.name,
      onClick: () => showDetail(record)
    }));
    actions.appendChild(F.ui.button({
      label: "Adicionar",
      icon: "plus",
      variant: "primary-button",
      className: "small-button",
      ariaLabel: "Adicionar " + record.name + " a uma rotina",
      onClick: () => addToRoutine(record)
    }));
    row.appendChild(actions);

    return row;
  }

  function linesNode(lines, fallback) {
    const details = F.ui.el("div", "modal-details");

    if (lines.length === 0) {
      details.appendChild(F.ui.el("p", "modal-detail-line", fallback));
      return details;
    }

    lines.forEach(line => details.appendChild(F.ui.el("p", "modal-detail-line", line)));
    return details;
  }

  /* Leitura dos níveis musculares no detalhe da biblioteca (fonte: catálogo). */
  function roleSummary(roles) {
    if (!roles) return "";

    const parts = [];
    if (roles.primary.length) parts.push("principal: " + roles.primary.join(", "));
    if (roles.secondary.length) parts.push("secundários: " + roles.secondary.join(", "));
    if (roles.stabilizers.length) parts.push("estabilizadores: " + roles.stabilizers.join(", "));

    return parts.join(" · ");
  }

  async function showDetail(record) {
    const lines = [];

    if (record.instructions) lines.push(record.instructions);
    if (record.roles) lines.push("Grupos musculares — " + roleSummary(record.roles) + ".");
    if (record.notes) lines.push("Observação salva: " + record.notes);
    if (record.mode === "weights" && record.load) lines.push("Carga de referência digitada: " + record.load);
    lines.push(historyLine(record));

    const details = linesNode(lines,
      "Nenhuma instrução salva para este exercício. Ao criar um item personalizado você pode escrever o passo a passo e ele aparece aqui.");

    /*
      Figura das regiões trabalhadas (mesma peça do atlas). Só entra quando o
      módulo do atlas está carregado e o exercício tem classificação — nada é
      desenhado por suposição.
    */
    if (F.atlas && F.atlas.figurePair) {
      const highlights = F.atlas.highlightsFor(record);

      if (Object.keys(highlights).length > 0) {
        const figure = document.createElement("div");
        figure.className = "modal-figure";
        figure.appendChild(F.atlas.figurePair(highlights));
        figure.appendChild(F.atlas.legendNode(highlights, { compact: true }));
        details.insertBefore(figure, details.firstChild);
      }
    }

    const result = await F.showModal({
      title: record.name,
      message: F.catalog.summary(record),
      details,
      fields: [{
        id: "section",
        label: "Adicionar na seção",
        type: "select",
        value: record.section,
        options: SECTIONS.map(section => ({ value: section, label: F.SECTION_NAMES[section] }))
      }],
      actions: [
        { id: "cancel", label: "Fechar", className: "secondary-button" },
        { id: "add", label: "Adicionar à rotina", className: "primary-button" }
      ]
    });

    if (result.action !== "add") return;

    await commitAdd(record, result.values.section || record.section);
  }

  /*
    frase de histórico calculada apenas sobre o histórico real do navegador.
    Sem registros do exercício, diz isso em vez de mostrar zero como se fosse
    um resultado medido.
  */
  function historyLine(record) {
    const stats = exerciseStats(record);

    if (!stats.sessions) {
      return "Ainda sem registros no seu histórico: adicione o exercício a uma rotina e treine para ver a evolução dele.";
    }

    const parts = [
      stats.sessions + (stats.sessions === 1 ? " treino registrado" : " treinos registrados"),
      stats.sets + (stats.sets === 1 ? " série concluída" : " séries concluídas")
    ];

    if (stats.lastDate) parts.push("último em " + stats.lastDate);
    if (stats.bestLoad !== null) parts.push("maior carga " + F.formatKg(stats.bestLoad));
    if (stats.maxReps !== null) parts.push("máximo de " + stats.maxReps + " repetições em uma série");
    if (stats.longestSeconds) parts.push("maior tempo " + F.formatRestValue(stats.longestSeconds));

    return "No seu histórico: " + parts.join(" · ") + ".";
  }

  function exerciseStats(record) {
    const name = F.catalog.normalizeText(record.name);
    const stats = { sessions: 0, sets: 0, bestLoad: null, maxReps: null, longestSeconds: 0, lastDate: null };
    const history = Array.isArray(F.state.history) ? F.state.history : [];

    history.forEach(entry => {
      if (!F.isPlainObject(entry) || !Array.isArray(entry.exercises)) return;
      if (entry.modality && record.mode && entry.modality !== record.mode) return;

      let matchedSets = 0;
      let matched = false;

      entry.exercises.forEach(item => {
        if (!F.isPlainObject(item) || F.catalog.normalizeText(item.name) !== name) return;

        matched = true;
        matchedSets += Number(item.completedSets) || 0;

        (Array.isArray(item.logs) ? item.logs : []).forEach(log => {
          const load = F.parseLoadKg(log.load);
          if (load !== null && (stats.bestLoad === null || load > stats.bestLoad)) stats.bestLoad = load;

          const reps = F.parseMaxReps(log.reps);
          if (reps !== null && (stats.maxReps === null || reps > stats.maxReps)) stats.maxReps = reps;

          const seconds = Number(log.seconds) || 0;
          if (seconds > stats.longestSeconds) stats.longestSeconds = seconds;
        });

        if (Number(item.duration) > stats.longestSeconds && matchedSets > 0) {
          stats.longestSeconds = Number(item.duration);
        }
      });

      if (!matched) return;

      stats.sessions += 1;
      stats.sets += matchedSets;

      if (!stats.lastDate && entry.date) stats.lastDate = entry.date;
    });

    if (stats.lastDate) {
      const parsed = new Date(stats.lastDate + "T12:00:00");
      stats.lastDate = Number.isNaN(parsed.getTime())
        ? stats.lastDate
        : F.formatDate(parsed, { day: "2-digit", month: "short" });
    }

    return stats;
  }

  function routineChoices(mode) {
    return (F.state.routines[mode] || []).map(routine => ({
      value: routine.id,
      label: routine.name
    }));
  }

  async function addToRoutine(record) {
    const choices = routineChoices(record.mode);

    if (choices.length === 0) {
      const result = await F.showModal({
        title: "Nenhuma rotina de " + F.MODE_NAMES[record.mode],
        message: "A biblioteca não guarda treinos sozinha: o exercício precisa entrar em uma rotina. Crie uma e volte aqui para adicionar.",
        actions: [
          { id: "cancel", label: "Fechar", className: "secondary-button" },
          { id: "open", label: "Abrir " + F.MODE_NAMES[record.mode], className: "primary-button" }
        ]
      });

      if (result.action === "open") F.navigate(F.url(F.MODE_PAGES[record.mode] || "treino"));
      return;
    }

    await commitAdd(record, record.section, choices);
  }

  async function commitAdd(record, section, choices) {
    const routines = choices || routineChoices(record.mode);

    const result = await F.showModal({
      title: "Adicionar " + record.name,
      message: "Escolha a rotina e a seção. O exercício entra no fim da seção; reordenar é no editor da rotina.",
      fields: [{
        id: "routine",
        label: "Rotina",
        type: "select",
        value: routines[0].value,
        options: routines
      }, {
        id: "section",
        label: "Seção",
        type: "select",
        value: SECTIONS.indexOf(section) !== -1 ? section : "main",
        options: SECTIONS.map(value => ({ value, label: F.SECTION_NAMES[value] }))
      }],
      actions: [
        { id: "cancel", label: "Cancelar", className: "secondary-button" },
        { id: "add", label: "Adicionar", className: "primary-button" }
      ]
    });

    if (result.action !== "add") return;

    const routine = (F.state.routines[record.mode] || []).find(item => item.id === result.values.routine);

    if (!routine) {
      F.showToast("A rotina escolhida não existe mais. Atualize a página e tente de novo.", "error", 5200);
      return;
    }

    const targetSection = SECTIONS.indexOf(result.values.section) !== -1 ? result.values.section : "main";
    const exercise = F.catalog.toExercise(record, targetSection);

    if (!exercise) {
      F.showToast("Não foi possível montar o exercício a partir da biblioteca.", "error", 5200);
      return;
    }

    const previous = F.cloneData(F.state.routines);
    const list2 = Array.isArray(routine.sections[targetSection]) ? routine.sections[targetSection] : [];

    routine.sections[targetSection] = list2.concat([exercise]);
    routine.updatedAt = Date.now();

    if (!F.saveRoutines()) {
      F.state.routines = previous;
      F.showToast("O navegador recusou a gravação. Nenhuma rotina foi alterada.", "error", 6000);
      return;
    }

    F.ui.announce(record.name + " adicionado em " + routine.name + ", seção " + F.SECTION_NAMES[targetSection] + ".");
    F.showToast(record.name + " entrou em " + routine.name + " · " + F.SECTION_NAMES[targetSection] + ".");
    update();
  }

  function update() {
    if (!host) return;

    const found = F.catalog.filter(state);
    const counts = F.catalog.facets(state);
    const focus = rememberFocus();

    clear(controls);

    controls.appendChild(F.ui.segmented({
      label: "Modalidade dos exercícios",
      value: state.mode,
      options: [{ value: null, label: "Todas", count: F.catalog.items().length }].concat(MODES.map(mode => ({
        value: mode,
        label: F.MODE_NAMES[mode],
        count: F.catalog.items(mode).length
      }))),
      onChange(value) {
        applyFilters({ mode: state.mode === value ? null : value });
      }
    }));

    [
      filterRow("section", "Seção", SECTIONS
        .filter(section => counts.sectionValues.get(section))
        .map(section => ({ value: section, label: F.SECTION_NAMES[section], count: counts.sectionValues.get(section) }))),
      filterRow("measure", "Medição", Object.keys(F.MEASURE_NAMES)
        .filter(measure => counts.measureValues.get(measure))
        .map(measure => ({ value: measure, label: F.MEASURE_NAMES[measure], count: counts.measureValues.get(measure) }))),
      filterRow("category", "Categoria", counts.categoryValues.size
        ? Array.from(counts.categoryValues.keys())
          .sort((a, b) => F.catalog.categoryLabel(a).localeCompare(F.catalog.categoryLabel(b), "pt-BR"))
          .map(value => ({ value, label: F.catalog.categoryLabel(value), count: counts.categoryValues.get(value) }))
        : []),
      filterRow("muscle", "Grupo muscular", Array.from(counts.muscles.keys())
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .map(value => ({ value, label: value, count: counts.muscles.get(value) })), "filtre para reduzir a lista"),
      filterRow("equipment", "Equipamento", Array.from(counts.equipment.keys())
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .map(value => ({ value, label: value, count: counts.equipment.get(value) })), "filtre para reduzir a lista"),
      filterRow("source", "Origem", [
        { value: "sugerido", label: "Sugerido", count: counts.sources.get("sugerido") || 0 },
        { value: "personalizado", label: "Seus", count: counts.sources.get("personalizado") || 0 }
      ].filter(entry => entry.count > 0))
    ].forEach(row => { if (row) controls.appendChild(row); });

    if (activeFilterCount() > 0) {
      const tools = F.ui.el("div", "catalog-tools");
      tools.appendChild(F.ui.button({
        label: "Limpar filtros",
        icon: "close",
        variant: "secondary-button",
        className: "small-button",
        onClick: resetFilters
      }));
      controls.appendChild(tools);
    }

    status.textContent = found.length === 0
      ? "Nenhum exercício com esses critérios"
      : found.length + (found.length === 1 ? " exercício" : " exercícios") +
        (activeFilterCount() > 0 ? " com os filtros atuais" : " no catálogo");

    clear(list);
    lastSignature = signature();
    const shown = found.slice(0, visible);

    if (found.length === 0) {
      list.appendChild(F.ui.empty({
        icon: "search",
        title: "Nenhum exercício com esses critérios",
        text: "Limpe a busca ou troque um filtro. Se o movimento que você faz não estiver na lista, crie-o no editor de rotina: ele entra na sua biblioteca pessoal e passa a aparecer aqui.",
        actions: [
          { label: "Limpar filtros", variant: "primary-button", icon: "close", onClick: resetFilters },
          {
            label: "Abrir editor de rotina",
            href: F.url("rotina", { modalidade: state.mode || "calisthenics" }),
            variant: "secondary-button",
            icon: "edit"
          }
        ]
      }));
      restoreFocus(focus);
      return;
    }

    shown.forEach(record => list.appendChild(recordRow(record)));

    const remaining = found.length - shown.length;

    if (remaining > 0) {
      const more = F.ui.el("div", "catalog-more");
      more.appendChild(F.ui.button({
        label: "Mostrar mais " + Math.min(PAGE_SIZE, remaining) + " de " + remaining,
        icon: "chevron-right",
        variant: "secondary-button",
        className: "full-width",
        onClick() {
          visible += PAGE_SIZE;
          update();
          /* Mantém o novo bloco à vista quando o ambiente tem layout. */
          if (list && typeof list.scrollIntoView === "function") list.scrollIntoView({ block: "nearest" });
        }
      }));
      list.appendChild(more);
    }

    restoreFocus(focus);
  }

  function mount() {
    host = doc.getElementById("catalog-root");
    if (!host) return;

    clear(host);

    host.appendChild(F.ui.sectionHead({
      id: "catalog-heading",
      title: "Biblioteca de exercícios",
      note: "Lista os exercícios sugeridos e os seus, com instruções, grupos musculares e equipamento. Consultar não altera nada: o único botão que muda uma rotina é Adicionar."
    }));

    search = doc.createElement("input");
    search.type = "search";
    search.id = "catalog-search";
    search.className = "catalog-search";
    search.placeholder = "Ex.: flexão, dorsais, barra";
    search.autocomplete = "off";
    search.setAttribute("aria-label", "Buscar exercícios por nome, músculo, categoria ou equipamento");
    search.value = state.query;
    search.addEventListener("input", () => {
      state.query = search.value;
      applyFilters({});
    });

    const searchWrap = F.ui.el("div", "ui-search-field catalog-search-wrap");
    searchWrap.appendChild(F.ui.icon("search"));
    searchWrap.appendChild(search);
    host.appendChild(searchWrap);

    controls = F.ui.el("div", "catalog-controls");
    controls.id = "catalog-controls";
    host.appendChild(controls);

    status = F.ui.el("p", "catalog-status");
    status.id = "catalog-status";
    status.setAttribute("aria-live", "polite");
    host.appendChild(status);

    list = F.ui.el("div", "catalog-list");
    list.id = "catalog-list";
    host.appendChild(list);

    if (F.state.activeWorkout) {
      host.appendChild(F.ui.el("p", "ui-inline-note catalog-session-note",
        "Há uma sessão de treino em andamento. Adicionar um exercício aqui não muda a sessão já iniciada — ele vale para os próximos treinos."));
    }
  }

  /*
    Link direto para o detalhe de um exercício (usado pelo atlas). Procura pelo
    id de catálogo e, se não achar, pelo id do próprio item. Se o link estiver
    velho, avisa sem erro e deixa a biblioteca normal na tela — nada é criado.
  */
  function findRecord(id) {
    if (!id) return null;

    return F.catalog.items().find(record => record.libraryId === id || record.id === id) || null;
  }

  async function openRequestedExercise(id) {
    if (!id) return;

    const record = findRecord(id);

    if (!record) {
      F.showToast("O exercício do link não está mais no catálogo. A biblioteca foi aberta completa.", "info", 6000);
      return;
    }

    await showDetail(record);
  }

  F.pages.biblioteca = function initBiblioteca() {
    const params = new URLSearchParams(global.location.search);
    const mode = params.get("modalidade");

    if (MODES.indexOf(mode) !== -1) state.mode = mode;

    /* `?musculo=peito` chega dos links do atlas (legenda de regiões). */
    const muscle = params.get("musculo");
    if (muscle) {
      const known = F.catalog.items().some(record =>
        record.muscles.some(name => normalizeText(name) === normalizeText(muscle)));
      if (known) state.muscle = muscle;
    }

    mount();
    update();
    F.onDataChanged(() => update());

    /* `?exercicio=<id>` abre o detalhe depois que a lista está montada.
       Sem esse parâmetro (ex.: `?musculo=peito` vindo do atlas), nada abre. */
    const requested = params.get("exercicio");
    if (requested) openRequestedExercise(requested);
  };
})(window);
