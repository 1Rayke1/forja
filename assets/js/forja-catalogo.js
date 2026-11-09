/*
  FORJA — catálogo de exercícios (leitura do catálogo e detalhe do exercício).

  Duas responsabilidades, separadas do módulo de treino:

  1. `F.catalog`: junta os itens sugeridos (`forja-biblioteca.js`) com os
     personalizados (`forja-treino-biblioteca-v1`), anexa os metadados de
     catálogo (categoria, grupos musculares, equipamento, execução) e oferece
     busca com normalização e contagem por faceta. Não grava nada sozinho.

  2. `F.catalog.showDetail`: o detalhe de um exercício em seções, usado pela
     biblioteca visual (`forja-biblioteca-visual.js`), pelo atlas, pelo editor
     de rotina e pela tela de execução. As seções editoriais vêm do catálogo
     central; um exercício personalizado mostra só o que o usuário informou.

  A tela da biblioteca (Etapa 4) vive em `forja-biblioteca-visual.js` e lê o
  catálogo central (`forja-catalogo-central.js`) como fonte única. A inserção
  em uma rotina continua aqui (`addToRoutine`), para existir um único caminho
  de escrita.

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
      /* O catálogo central pode declarar mais de seis papéis; não truncar
         secundários/estabilizadores na integração com o atlas e o plano. */
      muscles: muscles.slice(0, 12),
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

    /* normalizeLibraryItem preserva o contrato de armazenamento e, por isso,
       não carrega roles. Os registros oficiais trazem essa classificação do
       catálogo central; personalizados continuam sem papéis supostos. */
    const meta = metadataFor(Object.assign({}, normalized, {
      roles: source === "sugerido" ? raw.roles : null
    }));

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

  /* A identidade de uma cópia é libraryId, nunca o nome digitado. Dados da
     sessão/rotina têm precedência; só completamos metadados disponíveis. */
  function describeExercise(exercise, mode) {
    const origin = exercise.libraryId || exercise.id;
    const canonical = F.exerciseCatalog && F.exerciseCatalog.legacyIdMap[origin]
      ? F.exerciseCatalog.legacyIdMap[origin]
      : origin;
    const known = items().find(item => item.id === canonical);
    const merged = Object.assign({}, known || {}, exercise);
    if (known) {
      ["instructions", "category"].forEach(key => {
        if (!merged[key]) merged[key] = known[key];
      });
      ["muscles", "equipment"].forEach(key => {
        if (!merged[key] || !merged[key].length) merged[key] = known[key];
      });
    }
    const record = catalogRecord(merged, mode, "personalizado");
    // normalizeLibraryItem descreve uma origem, não uma cópia de rotina: a
    // referência precisa ser preservada explicitamente nesta visão de leitura.
    if (record) {
      record.libraryId = origin;
      record.roles = normalizeRoles(exercise.roles) || (known && known.roles) || null;
      const customVideo = F.normalizeYouTubeVideo(exercise.youtubeVideo);
      if (customVideo) record.youtubeVideo = customVideo;
    }
    return record;
  }

  // Reservado para um piloto aprovado separadamente. Nenhuma mídia publicada.
  // Contrato editorial e condições de aprovação: docs/fotografias-exercicios.md.
  /**
   * Entradas futuras, por `${mode}:${libraryId}`, sem dados pessoais:
   * { status: "approved", exerciseId, mode, src, alt, sourceUrl, author,
   *   license, licenseUrl, attribution, verifiedAt, evidence, reviewedBy,
   *   variant, modifications, modelPermission }
   * `evidence` registra a comprovação da licença e revisão técnica; a licença
   * do repositório de origem não substitui a permissão individual da foto.
   */
  const PHOTO_MANIFEST = Object.freeze({});
  function photoFor(record) {
    if (!record) return null;
    const origin = record.libraryId || record.id;
    const photo = PHOTO_MANIFEST[record.mode + ":" + origin];
    return photo && photo.status === "approved" && photo.exerciseId === origin && photo.mode === record.mode
      ? photo : null;
  }

  /*
    Gancho de redesenho da tela que exibe o catálogo. Fica nulo nas páginas que
    só consomem o catálogo (execução, editor, atlas).
  */
  let pageRefresh = null;

  function notifyPageRefresh() {
    if (typeof pageRefresh !== "function") return;
    try {
      pageRefresh();
    } catch (error) {
      console.error("Falha ao atualizar a biblioteca:", error);
    }
  }

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
    describeExercise,
    showDetail,
    renderRow: recordRow,
    addToRoutine,
    PHOTO_MANIFEST,
    photoFor,
    /* A página aberta registra aqui o próprio redesenho. */
    setPageRefresh(listener) {
      pageRefresh = typeof listener === "function" ? listener : null;
    },
    /* Categorias presentes no catálogo atual (para o formulário). */
    categories(mode) {
      const used = countBy(items(mode), record => [record.category]);
      const keys = Array.from(used.keys()).filter(Boolean);

      return keys.sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), "pt-BR"));
    }
  };

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

  function recordRow(record, options = {}) {
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
      onClick: () => showDetail(record, { readOnly: Boolean(options.readOnlyDetail) })
    }));
    actions.appendChild(F.ui.button({
      label: "Adicionar",
      icon: "plus",
      variant: options.onAdd ? "secondary-button" : "primary-button",
      className: "small-button",
      ariaLabel: "Adicionar " + record.name + " a uma rotina",
      onClick: options.onAdd || (() => addToRoutine(record))
    }));
    row.appendChild(actions);

    return row;
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

  /* ------------------------------------------------------------------ */
  /* Detalhe do exercício                                               */
  /* (biblioteca visual, atlas, editor de rotina e tela de execução)     */
  /* ------------------------------------------------------------------ */

  /*
    Registro central do exercício, quando existe. É a fonte editorial das
    seções do detalhe (ranking, músculos, equipamento, técnica). Um exercício
    personalizado não tem registro central: o detalhe mostra somente o que o
    usuário informou, sem inventar classificação.
  */
  /*
    Ponte entre os dois vocabulários de dados do app.

    - `F.MODES` / `record.mode` são strings históricas: "weights" e
      "calisthenics" (as rotinas, sessões e o histórico usam isso).
    - `F.exerciseCatalog` / `F.EXERCISE_LIBRARY` são registros com `modality`
      ("academia", "calistenia", "peso-corporal"), `primaryMuscle`, `equipment`
      e `media`.

    A identidade de um exercício é o `libraryId` (nunca o nome digitado); o
    `legacyIdMap` do catálogo resolve os IDs antigos. Este helper devolve o
    registro central correspondente a uma cópia de rotina/sessão, ou null para
    exercícios personalizados que não existem no catálogo.
  */
  function centralRecordFor(record) {
    if (!record || !F.exerciseCatalog) return null;
    const origin = record.libraryId || record.id;
    if (!origin) return null;
    return F.exerciseCatalog.byId(origin);
  }

  function detailSection(title, key) {
    const section = F.ui.el("section", "bl-detail-section");
    if (key) section.setAttribute("data-detail-section", key);

    section.appendChild(F.ui.el("h3", "bl-detail-heading", title));
    return section;
  }

  function detailText(text, className) {
    return F.ui.el("p", "modal-detail-line" + (className ? " " + className : ""), text);
  }

  function detailList(items, className) {
    const list = doc.createElement("ul");
    list.className = "bl-detail-list" + (className ? " " + className : "");

    items.forEach(item => {
      list.appendChild(F.ui.el("li", null, item));
    });

    return list;
  }

  function detailChips(values) {
    const row = F.ui.el("div", "ui-exercise-tags bl-detail-tags");
    values.forEach(value => row.appendChild(F.ui.chip(value, "muted")));
    return row;
  }

  /* Posição no ranking editorial da combinação (grupo + modalidade). */
  function rankingLine(central) {
    if (!central || !central.ranking) return null;

    const muscle = F.exerciseCatalog.groupById(central.primaryMuscle);
    const modality = F.exerciseCatalog.modalityById(central.modality);
    const position = central.ranking.position;

    return {
      position,
      label: position + "º lugar",
      context: (muscle ? muscle.name : "") + (modality ? " · " + modality.name : ""),
      editorial: central.ranking.type === "editorial",
      criteriaVersion: central.ranking.criteriaVersion || "1"
    };
  }

  function difficultyLabel(value) {
    if (value === "avancado") return "avançado";
    if (value === "intermediario") return "intermediário";
    if (value === "iniciante") return "iniciante";
    return String(value || "");
  }

  /*
    Seções do detalhe, montadas a partir do catálogo central quando houver
    registro oficial. Todo texto exibido vem de um campo existente: a seção
    não aparece quando o dado não existe.
  */
  function detailSections(record, central, options) {
    const wrap = F.ui.el("div", "bl-detail-sections");
    const mode = record.mode;
    const modeName = central
      ? (F.exerciseCatalog.modalityById(central.modality) || {}).name
      : F.MODE_NAMES[mode];

    /*
      A identificação (nome, grupo, modalidade, foto) fica no topo do detalhe,
      montada por `identificationBlock`. Aqui começam as informações
      complementares — nada de repetir o mesmo dado duas vezes na tela.
    */

    /* 2. Classificação no ranking, quando existente. */
    const ranking = rankingLine(central);
    if (ranking || options.alwaysShowRanking) {
      const section = detailSection("Classificação no ranking", "ranking");
      if (ranking) {
        section.appendChild(detailText(ranking.label + " — " + ranking.context + ".", "bl-detail-strong"));
        if (ranking.editorial) {
          section.appendChild(detailText("Classificação editorial do catálogo (critérios v" +
            ranking.criteriaVersion + "). Não representa percentual de ativação muscular."));
        }
      } else {
        section.appendChild(detailText("Este exercício não tem posição no ranking: ele é seu, e a classificação existe somente para o catálogo central."));
      }
      wrap.appendChild(section);
    }

    /* 3. Equipamento necessário. */
    if (central) {
      const section = detailSection("Equipamentos", "equipamento");
      if (central.equipment.length === 0) {
        section.appendChild(detailText("Sem equipamento: apenas o corpo e o espaço disponível."));
      } else {
        section.appendChild(detailChips(central.equipment.map(item => F.exerciseCatalog.equipmentLabel(item))));
      }
      wrap.appendChild(section);
    } else if (record.equipment && record.equipment.length) {
      const section = detailSection("Equipamentos", "equipamento");
      section.appendChild(detailChips(record.equipment));
      wrap.appendChild(section);
    }

    /*
      4. Execução, técnica e cuidados. Uma cópia de rotina/sessão carrega as
      instruções do próprio exercício: elas vêm do usuário e têm precedência
      sobre o texto editorial (ele pode ter ajustado o passo a passo).
    */
    const isCopy = Boolean(record.libraryId && record.id && record.id !== record.libraryId);

    if (central && !isCopy) {
      if (central.instructions.length) {
        const section = detailSection("Execução", "execucao");
        section.appendChild(detailList(central.instructions, "bl-detail-steps"));
        wrap.appendChild(section);
      }
      if (central.technique.length) {
        const section = detailSection("Técnica", "tecnica");
        section.appendChild(detailList(central.technique));
        wrap.appendChild(section);
      }
      if (central.cautions.length) {
        const section = detailSection("Cuidados", "cuidados");
        section.appendChild(detailList(central.cautions));
        wrap.appendChild(section);
      }
    } else {
      if (record.instructions) {
        const section = detailSection("Execução", "execucao");
        section.appendChild(detailText(record.instructions));
        wrap.appendChild(section);
      }
      if (central && central.technique.length) {
        const section = detailSection("Técnica", "tecnica");
        section.appendChild(detailList(central.technique));
        wrap.appendChild(section);
      }
      if (central && central.cautions.length) {
        const section = detailSection("Cuidados", "cuidados");
        section.appendChild(detailList(central.cautions));
        wrap.appendChild(section);
      }
    }

    /*
      5. Informações musculares do catálogo (papel de cada grupo). A frase de
      resumo usa o vocabulário antigo ("peito", "dorsais") — o mesmo da
      legenda do atlas e dos exercícios já salvos —, e a tabela abaixo mostra
      os nomes de exibição do catálogo.
    */
    const centralRoles = central
      ? {
        primary: [central.primaryMuscle],
        secondary: central.secondaryMuscles.slice(),
        stabilizers: central.stabilizers.slice()
      }
      : null;

    const greeting = id => (centralRoles
      ? F.exerciseCatalog.legacyMuscleName(id)
      : (F.exerciseCatalog.legacyMuscleName(id) || id));

    const legacyRoles = centralRoles
      ? {
        primary: centralRoles.primary.map(greeting),
        secondary: centralRoles.secondary.map(greeting),
        stabilizers: centralRoles.stabilizers.map(greeting)
      }
      : record.roles;

    const roles = centralRoles
      ? {
        primary: centralRoles.primary.map(id => F.exerciseCatalog.muscleName(id)),
        secondary: centralRoles.secondary.map(id => F.exerciseCatalog.muscleName(id)),
        stabilizers: centralRoles.stabilizers.map(id => F.exerciseCatalog.muscleName(id))
      }
      : record.roles;

    if (roles && (roles.primary.length || roles.secondary.length || roles.stabilizers.length)) {
      const section = detailSection("Músculos", "musculos");
      const parts = [];
      const summary = legacyRoles || roles;
      if (summary.primary.length) parts.push("principal: " + summary.primary.join(", "));
      if (summary.secondary.length) parts.push("secundários: " + summary.secondary.join(", "));
      if (summary.stabilizers.length) parts.push("estabilizadores: " + summary.stabilizers.join(", "));
      section.appendChild(detailText("Grupos musculares — " + parts.join(" · ") + ".", "bl-detail-strong"));

      const rows = [];
      if (roles.primary.length) rows.push(["Principal", roles.primary.join(", ")]);
      if (roles.secondary.length) rows.push(["Secundários", roles.secondary.join(", ")]);
      if (roles.stabilizers.length) rows.push(["Estabilizadores", roles.stabilizers.join(", ")]);

      const list = doc.createElement("dl");
      list.className = "bl-detail-roles";
      rows.forEach(pair => {
        list.appendChild(F.ui.el("dt", null, pair[0]));
        list.appendChild(F.ui.el("dd", null, pair[1]));
      });
      section.appendChild(list);
      wrap.appendChild(section);
    } else if (record.muscles && record.muscles.length) {
      const section = detailSection("Músculos", "musculos");
      section.appendChild(detailText("Grupos musculares informados: " + record.muscles.join(", ") + "."));
      wrap.appendChild(section);
    }

    /* 6. Observações e carga digitadas pelo usuário (nunca inventadas). */
    if (record.notes || (mode === "weights" && record.load)) {
      const section = detailSection("Suas observações", "observacoes");
      if (record.notes) section.appendChild(detailText("Observação salva: " + record.notes));
      if (mode === "weights" && record.load) section.appendChild(detailText("Carga de referência digitada: " + record.load));
      wrap.appendChild(section);
    }

    /* 7. Histórico real do navegador para este exercício. */
    if (!options.readOnly) {
      const section = detailSection("No seu histórico", "historico");
      section.appendChild(detailText(historyLine(record)));
      wrap.appendChild(section);
    }

    return wrap;
  }

  /*
    Foto do exercício no detalhe. Só entra imagem do próprio identificador:

    1. foto aprovada do manifesto editorial (`PHOTO_MANIFEST`), quando existir;
    2. imagem aprovada do catálogo central, buscada pelo ID do exercício;
    3. associação do catálogo ainda em revisão — exibida com o aviso explícito;
    4. ilustração que o usuário escolheu para o exercício personalizado.

    Sem nenhuma delas não existe foto inventada: o detalhe mostra o espaço
    reservado com "Imagem ainda não disponível".
  */
  function detailPhotoFor(record, central) {
    const approved = photoFor(record);
    if (approved && approved.src) {
      return {
        src: approved.src,
        url: F.url(approved.src),
        alt: approved.alt || ("Foto do exercício " + record.name),
        status: "approved",
        caption: null
      };
    }

    const media = central && central.media && central.media.image;
    if (media && media.src) {
      return {
        src: media.src,
        url: F.url(media.src),
        alt: "Foto do exercício " + record.name,
        status: media.status,
        caption: media.status === "validated"
          ? null
          : "Associação em revisão editorial: a foto é do mesmo movimento, mas ainda não foi validada."
      };
    }

    return null;
  }

  /*
    Escolha explícita de demonstração feita pelo usuário para este exercício.
    Vale mais que a imagem padrão do catálogo: é o dado dele.
  */
  function explicitDemoFor(record) {
    if (!F.demos || !F.demos.available()) return null;
    const demo = F.demos.resolve(record, record.mode);
    return demo && demo.explicit && demo.thumb && demo.thumb.url ? demo : null;
  }

  /*
    A foto é renderizada pelo mesmo componente de demonstração da Etapa 3
    quando a imagem aprovada é exatamente a ilustração daquele exercício — o
    arquivo é o mesmo, e assim o crédito obrigatório (RepDB) viaja junto.
  */
  function photoBlock(record, central) {
    const explicit = explicitDemoFor(record);
    const photo = explicit
      ? {
        src: explicit.thumb.file,
        url: explicit.thumb.url,
        alt: "Imagem escolhida para " + record.name,
        status: "escolhida",
        caption: null
      }
      : detailPhotoFor(record, central);
    const figure = doc.createElement("figure");
    figure.className = "bl-detail-photo";
    figure.setAttribute("data-photo", photo ? "ok" : "missing");

    let demoMedia = null;

    if (photo && F.demos && F.demos.available()) {
      const demo = F.demos.resolve(record, record.mode);
      /* `thumb.file` é o nome do arquivo; `media.image.src` traz o caminho. */
      const sameFile = value => String(value || "").split("/").pop();
      if (demo && demo.thumb && sameFile(demo.thumb.file) === sameFile(photo.src)) {
        demoMedia = F.demos.createMedia(record, record.mode, { eager: false });
      }
    }

    if (demoMedia && demoMedia.node) {
      figure.classList.add("has-demo-media");
      figure.appendChild(demoMedia.node);
    } else if (photo) {
      const image = doc.createElement("img");
      image.className = "bl-detail-photo-image";
      image.src = photo.url;
      image.alt = photo.alt;
      image.width = 512;
      image.height = 512;
      image.loading = "lazy";
      image.decoding = "async";
      image.setAttribute("data-image-status", photo.status);
      /* Arquivo ausente não deixa ícone de imagem quebrada na tela. */
      image.addEventListener("error", () => {
        figure.setAttribute("data-photo", "missing");
        image.remove();
        if (!figure.querySelector(".bl-detail-photo-missing")) {
          figure.insertBefore(photoMissing(record), figure.firstChild);
        }
      });
      figure.appendChild(image);
    } else {
      figure.appendChild(photoMissing(record));
    }

    if (photo) {
      const caption = doc.createElement("figcaption");
      caption.className = "bl-detail-photo-caption";
      caption.textContent = photo.caption || "";
      if (photo.caption) figure.appendChild(caption);
    } else {
      const caption = doc.createElement("figcaption");
      caption.className = "bl-detail-photo-caption";
      caption.textContent = "A foto só aparece quando existe uma imagem aprovada do próprio movimento.";
      figure.appendChild(caption);
    }

    return figure;
  }

  function photoMissing(record) {
    const box = F.ui.el("div", "bl-detail-photo-missing");
    box.appendChild(F.ui.el("strong", "bl-detail-photo-missing-title", "Imagem ainda não disponível"));
    box.appendChild(F.ui.el("span", "bl-detail-photo-missing-text",
      "Não há foto aprovada de " + record.name + "; a demonstração abaixo continua valendo."));
    return box;
  }

  /*
    Identificação: nome (já no título do diálogo), grupo muscular, modalidade,
    dificuldade, a foto do exercício e o resumo editorial do catálogo.
  */
  function identificationBlock(record, central) {
    const section = detailSection("Identificação", "identificacao");
    section.classList.add("bl-detail-ident");

    const group = central ? F.exerciseCatalog.groupById(central.primaryMuscle) : null;
    const modeName = central
      ? (F.exerciseCatalog.modalityById(central.modality) || {}).name
      : F.MODE_NAMES[record.mode];

    const chips = F.ui.el("div", "ui-exercise-tags bl-detail-tags bl-detail-ident-tags");
    if (central) chips.appendChild(F.ui.chip(group ? group.name : central.primaryMuscle, "accent"));
    chips.appendChild(F.ui.chip(modeName || "", "muted"));
    if (central && central.difficulty) chips.appendChild(F.ui.chip("dificuldade " + difficultyLabel(central.difficulty), "muted"));
    section.appendChild(chips);

    section.appendChild(photoBlock(record, central));

    if (central && central.description) {
      section.appendChild(detailText(central.description));
    } else if (!central && record.instructions) {
      section.appendChild(detailText(record.instructions));
    }

    return section;
  }

  /*
    Demonstração em vídeo. O palco é o mesmo da Etapa 3 (16:9, nocookie, sem
    autoplay, sem som inicial, controles visíveis). A foto já está logo acima,
    então o palco entra sem repetir a ilustração: quando não há vídeo ele diz,
    com todas as letras, que a demonstração em vídeo não existe.
  */
  function videoBlock(record) {
    const section = detailSection("Demonstração em vídeo", "video");
    section.classList.add("bl-detail-video");

    let stageHandle = null;
    if (F.videos) {
      stageHandle = F.videos.createStage(record, record.mode, { compact: false, reference: false });
      section.appendChild(stageHandle.node);
    } else if (F.demos) {
      const demoMedia = F.demos.createMedia(record, record.mode, { eager: false });
      section.appendChild(demoMedia.node);
    }

    /* Associação aprovada no administrativo tem prioridade sobre a mídia
       padrão (regra da Etapa 3); sem ela, o palco padrão permanece. */
    let youtubeHost = null;

    if (F.youtube && F.exerciseCatalog && F.exerciseCatalog.byId(record.libraryId || record.id)) {
      youtubeHost = doc.createElement("div");
      youtubeHost.className = "youtube-detail";
      section.appendChild(youtubeHost);
    }

    return { section, stageHandle, youtubeHost };
  }

  /* Botão principal do detalhe: leva ao fluxo de rotina já existente. */
  function addToTrainingBlock(record) {
    const wrap = F.ui.el("div", "bl-detail-cta");
    wrap.setAttribute("data-detail-section", "adicionar");

    const button = F.ui.button({
      label: "Adicionar ao treino",
      icon: "plus",
      variant: "primary-button",
      className: "full-width",
      ariaLabel: "Adicionar " + record.name + " ao treino",
      onClick() {
        /*
          Fecha o detalhe devolvendo a ação "add": o fluxo de rotina da Etapa 5
          continua sendo o único caminho de escrita, sem um segundo sistema.
        */
        F.closeOpenModal({ action: "add", values: {} });
      }
    });
    button.id = "detail-add-to-training";
    wrap.appendChild(button);

    wrap.appendChild(F.ui.el("p", "bl-detail-cta-hint",
      "Escolha a rotina e a seção na próxima etapa. O exercício entra no fim da seção e pode ser reordenado no editor."));

    return wrap;
  }

  /*
    Atlas anatômico: mesma peça do atlas, com o principal em destaque e os
    papéis secundários diferenciados por cor e por legenda escrita.
  */
  function atlasBlock(record) {
    if (!F.atlas || !F.atlas.figurePair) return null;

    const highlights = F.atlas.highlightsFor(record);
    if (Object.keys(highlights).length === 0) return null;

    const section = detailSection("Atlas anatômico", "atlas");
    section.classList.add("bl-detail-atlas");

    const figure = document.createElement("div");
    figure.className = "modal-figure";
    figure.appendChild(F.atlas.figurePair(highlights));
    figure.appendChild(F.atlas.legendNode(highlights, { compact: true }));
    section.appendChild(figure);

    /*
      A legenda escrita só lista os papéis que realmente aparecem na figura:
      nada de explicar "estabilizador" quando nenhum músculo tem esse papel.
    */
    const present = {};
    Object.keys(highlights).forEach(id => {
      present[highlights[id]] = (present[highlights[id]] || 0) + 1;
    });

    const key = F.ui.el("ul", "bl-detail-atlas-key");
    const items = [];
    if (present.primary) items.push(["is-primary", "Principal", "conduz o movimento"]);
    if (present.secondary) items.push(["is-secondary", "Secundário", "ajuda a executar o movimento"]);
    if (present.stabilizer) items.push(["is-stabilizer", "Estabilizador", "mantém a posição do corpo"]);
    if (present.informed) items.push(["is-informed", "Informado", "grupo citado na ficha, sem papel definido"]);

    items.forEach(item => {
      const li = F.ui.el("li", "bl-detail-atlas-key-item " + item[0]);
      li.setAttribute("data-atlas-role", item[0]);
      li.appendChild(F.ui.el("span", "bl-detail-atlas-dot"));
      li.appendChild(F.ui.el("strong", null, item[1]));
      li.appendChild(F.ui.el("span", "bl-detail-atlas-key-text", " — " + item[2]));
      key.appendChild(li);
    });

    section.appendChild(key);
    section.appendChild(F.ui.el("p", "bl-detail-note",
      "As cores vêm do Atlas do FORJA e descrevem o papel de cada músculo neste exercício, não a intensidade do trabalho."));

    return section;
  }

  async function showDetail(record, options = {}) {
    const central = centralRecordFor(record);
    const details = F.ui.el("div", "modal-details bl-detail");

    /*
      Uma única tela, sem abas e sem menu escondido:
      identificação e foto → demonstração em vídeo → adicionar ao treino →
      atlas anatômico → informações complementares.
    */
    details.appendChild(identificationBlock(record, central));

    const video = videoBlock(record);
    details.appendChild(video.section);

    if (!options.readOnly) details.appendChild(addToTrainingBlock(record));

    if (!options.readOnly) {
      const atlas = atlasBlock(record);
      if (atlas) details.appendChild(atlas);
    }

    details.appendChild(detailSections(record, central, options));

    const abertura = F.showModal({
      title: record.name,
      message: F.catalog.summary(record),
      details,
      fields: [],
      actions: [{ id: "cancel", label: "Fechar", className: "secondary-button" }]
    });

    if (video.youtubeHost) {
      setTimeout(() => {
        if (video.youtubeHost.isConnected) F.youtube.render(record, video.youtubeHost);
      }, 0);
    }

    const result = await abertura;

    if (video.stageHandle && F.videos) {
      F.videos.destroyStage(video.stageHandle.node);
    }

    if (result.action !== "add") return;

    await commitAdd(record, (result.values && result.values.section) || record.section);
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
        message: "A biblioteca não guarda treinos sozinha: o exercício precisa entrar em uma rotina. Crie uma rotina agora ou abra a modalidade.",
        actions: [
          { id: "cancel", label: "Fechar", className: "secondary-button" },
          { id: "create", label: "Criar rotina agora", className: "secondary-button" },
          { id: "open", label: "Abrir " + F.MODE_NAMES[record.mode], className: "primary-button" }
        ]
      });

      if (result.action === "create") {
        F.navigate(F.url("rotina", {
          modalidade: record.mode,
          exercicio: record.libraryId || record.id
        }));
      } else if (result.action === "open") {
        F.navigate(F.url(F.MODE_PAGES[record.mode] || "treino"));
      }
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

    /*
      Relê as rotinas gravadas antes de mutar (somente leitura): se outra aba
      mexeu nelas enquanto o modal estava aberto, a adição vale sobre o estado
      fresco — nunca sobre o snapshot que esta aba carregou.
    */
    if (typeof F.syncStateFromStorage === "function" && F.KEYS) {
      F.syncStateFromStorage(F.KEYS.routines);
    }

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

    /* Adicionar a uma rotina vazia a torna iniciável: a rotação acompanha. */
    if (typeof F.reconcileRotationAfterRoutineChange === "function") {
      F.reconcileRotationAfterRoutineChange();
    }

    F.ui.announce(record.name + " adicionado em " + routine.name + ", seção " + F.SECTION_NAMES[targetSection] + ".");
    F.showToast(record.name + " entrou em " + routine.name + " · " + F.SECTION_NAMES[targetSection] + ".");
    notifyPageRefresh();
  }

})(window);
