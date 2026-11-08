/*
  FORJA — biblioteca visual de exercícios (Etapa 4).

  Esta é a tela `treino/biblioteca.html`. Ela NÃO é um segundo catálogo: toda a
  leitura vem do catálogo central (`forja-catalogo-central.js`, 165 exercícios)
  e a única escrita continua sendo `F.catalog.addToRoutine`, que insere o
  exercício em uma rotina existente. Os exercícios personalizados do usuário
  entram ao lado dos oficiais, marcados como "Seus", sem receber ranking nem
  classificação por suposição.

  Contrato da tela (é a tela da aba "Explorar" — F.ROUTES.explorar):
  - apresenta diretamente a Biblioteca de exercícios com busca, quatro pílulas
    de modalidade (Todos, Musculação, Calistenia, Sem equip.), sete cards de
    regiões musculares (porta para `treino/grupo.html`) e contador dinâmico;
  - busca por nome e por nome alternativo (sem acento, sem caixa), combinável
    com os filtros;
  - filtros ativos visíveis, removíveis um a um, e "limpar tudo";
  - cards horizontais nos resultados com a foto aprovada do próprio exercício
    (ou o espaço reservado), nome, grupo, modalidade, posição no ranking e selo
    de vídeo;
  - rankings de aproveitamento por grupo + modalidade preservados no catálogo e
    em `F.biblioteca.rankings` / `F.biblioteca.rankingPositions`, sem misturar
    categorias;
  - detalhe completo no painel único (`F.catalog.showDetail`);
  - carregamento progressivo de 12 em 12 nos resultados filtrados.

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
    Fundo da moldura: as ilustrações RepDB são quadradas e opacas, com fundo
    azul-claro próprio. Quando a imagem vem dessa família, a moldura usa a
    mesma cor para a ilustração inteira aparecer sem barras escuras.
  */
  function backdropFor(src) {
    return /(^|\/)demonstracoes\//.test(String(src || "")) ? "light" : "dark";
  }

  /*
    Imagem do exercício. Regras que valem aqui:

    1. A imagem vem do próprio registro central do exercício e é procurada
       pelo ID dele — nunca por semelhança de nome.
    2. Só entra imagem **aprovada** (`status: "validated"`). Uma associação
       pendente continua pendente: o card mostra o espaço reservado em vez de
       apresentar como definitiva uma imagem em revisão.
    3. Exercício do usuário só mostra imagem que ele mesmo escolheu
       (`demoId`); nenhuma ilustração é atribuída por suposição.
  */
  function approvedImage(central) {
    const media = central && central.media && central.media.image;
    if (!media || !media.src) return null;
    if (media.status !== "validated") return null;
    return {
      src: media.src,
      url: F.url(media.src),
      status: media.status,
      source: "catalogo",
      backdrop: backdropFor(media.src)
    };
  }

  /* Associação existente no catálogo que ainda está em revisão editorial. */
  function pendingImage(central) {
    const media = central && central.media && central.media.image;
    if (!media || !media.src || media.status === "validated") return null;
    return { src: media.src, status: media.status };
  }

  function imageFor(central, legacy) {
    const approved = approvedImage(central);
    if (approved) return approved;

    /* Exercício do usuário: só a demonstração que ele escolheu. */
    if (!central && legacy && F.demos && F.demos.available()) {
      const demo = F.demos.resolve(legacy, legacy.mode);
      if (demo && demo.explicit && demo.thumb && demo.thumb.url) {
        return {
          src: demo.thumb.file,
          url: demo.thumb.url,
          status: "escolhida",
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
      pendingImage: pendingImage(record),
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
      pendingImage: null,
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

  /* ------------------------------------------------------------------ */
  /* As sete regiões da tela                                              */
  /* ------------------------------------------------------------------ */

  /*
    Cada card da tela é uma porta de entrada para um ou mais dos 13 grupos
    oficiais do catálogo central — nenhum grupo fica de fora e nenhum exercício
    muda de classificação. O filtro do card é por músculo *principal*: somados,
    os sete cards cobrem os 165 exercícios exatamente uma vez.
  */
  const CATEGORIAS = Object.freeze([
    Object.freeze({
      id: "peitoral",
      rotulo: "Peitoral",
      descricao: "Exercícios para o peito",
      grupos: Object.freeze(["peitoral"]),
      figura: { view: "front", regioes: ["peito"] }
    }),
    Object.freeze({
      id: "costas",
      rotulo: "Costas",
      descricao: "Exercícios para as costas",
      grupos: Object.freeze(["costas"]),
      /* Dorso superior + grande dorsal: juntos dão a silhueta das costas. */
      figura: { view: "back", regioes: ["costas", "dorsais"] }
    }),
    Object.freeze({
      id: "ombros",
      rotulo: "Ombros",
      descricao: "Exercícios para os ombros",
      grupos: Object.freeze(["ombros", "trapezio"]),
      figura: { view: "front", regioes: ["ombros"] }
    }),
    Object.freeze({
      id: "bracos",
      rotulo: "Braços",
      descricao: "Exercícios para os braços",
      grupos: Object.freeze(["biceps", "triceps", "antebracos"]),
      figura: { view: "front", regioes: ["biceps", "antebracos"] }
    }),
    Object.freeze({
      id: "abdomen",
      rotulo: "Abdômen",
      descricao: "Exercícios para o abdômen",
      grupos: Object.freeze(["abdomen", "obliquos"]),
      /* Reto abdominal em lima; o oblíquo entra como subgrupo, não como borrão. */
      figura: { view: "front", regioes: ["abdomem"] }
    }),
    Object.freeze({
      id: "pernas",
      rotulo: "Pernas",
      descricao: "Exercícios para as pernas",
      grupos: Object.freeze(["quadriceps", "posteriores", "panturrilhas"]),
      figura: { view: "front", regioes: ["quadriceps"] }
    }),
    Object.freeze({
      id: "gluteos",
      rotulo: "Glúteos",
      descricao: "Exercícios para os glúteos",
      grupos: Object.freeze(["gluteos"]),
      figura: { view: "back", regioes: ["gluteos"] }
    })
  ]);

  function categoriaPorId(id) {
    if (!id) return null;
    return CATEGORIAS.find(categoria => categoria.id === id) || null;
  }

  /* ------------------------------------------------------------------ */
  /* Miniatura anatômica dos cards (mesma prancha e regiões do atlas)     */
  /* ------------------------------------------------------------------ */

  const PROPORCAO_FIGURA = 1.1;      /* largura / altura da área da imagem */
  const FOLGA_FIGURA = 0.06;         /* respiro proporcional à região */
  const MARGEM_FIGURA = 18;          /* respiro mínimo, em unidades da prancha */
  const ALTURA_MINIMA_FIGURA = 0.24; /* fração da prancha sempre visível */

  function figurasDisponiveis() {
    return Boolean(F.figura && typeof F.figura.render === "function" && F.figura.REGIONS);
  }

  function regioesVisiveis(categoria) {
    const view = categoria.figura.view;
    const regioes = categoria.figura.regioes || [];
    if (!F.figura.REGIONS) return [];
    return regioes.filter(id => Boolean(F.figura.shapesFor(id, view)));
  }

  /*
    Limites de um caminho autoral. Os caminhos de `forja-figura.js` só usam M/Q
    com pontos, então os números vêm em pares (x, y). Nada é desenhado aqui: os
    limites servem apenas para enquadrar a região na miniatura.
  */
  function limitesDoCaminho(d) {
    const numeros = String(d || "").match(/-?\d+(?:\.\d+)?/g);
    if (!numeros || numeros.length < 4) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i + 1 < numeros.length; i += 2) {
      const x = Number(numeros[i]);
      const y = Number(numeros[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }

  /* Caixas de cada caminho, na ordem em que o atlas desenha. */
  function caixasDosCaminhos(regioes, view) {
    const caixas = [];
    regioes.forEach(id => {
      (F.figura.shapesFor(id, view) || []).forEach(d => {
        const limites = limitesDoCaminho(d);
        if (limites) caixas.push(limites);
      });
    });
    return caixas;
  }

  function limitesDasRegioes(regioes, view) {
    let caixa = null;

    regioes.forEach(id => {
      const caminhos = F.figura.shapesFor(id, view) || [];
      caminhos.forEach(d => {
        const limites = limitesDoCaminho(d);
        if (!limites) return;
        if (!caixa) {
          caixa = Object.assign({}, limites);
          return;
        }
        caixa.minX = Math.min(caixa.minX, limites.minX);
        caixa.minY = Math.min(caixa.minY, limites.minY);
        caixa.maxX = Math.max(caixa.maxX, limites.maxX);
        caixa.maxY = Math.max(caixa.maxY, limites.maxY);
      });
    });

    return caixa;
  }

  function arredondar(value) {
    return Math.round(value * 10) / 10;
  }

  /*
    Janela de exibição da miniatura: envolve as regiões do card com folga,
    ajusta para a proporção da área da imagem e prende dentro da prancha.
  */
  /*
    `focoLado` enquadra um dos lados do corpo. Músculos que aparecem em pares
    afastados (bíceps, tríceps, antebraços) ficam ilegíveis no enquadramento
    que abraça os dois lados: o recorte mostraria o tronco inteiro. Nesses
    casos o desenho mira o caminho mais à esquerda, como um detalhe.
  */
  function limitesDoRecorte(pedido, view) {
    if (!pedido.focoLado) return limitesDasRegioes(pedido.figura.regioes, view);

    const caixas = caixasDosCaminhos(pedido.figura.regioes, view);
    if (caixas.length === 0) return null;

    return caixas.reduce((escolhida, atual) => (atual.minX < escolhida.minX ? atual : escolhida));
  }

  function enquadramentoDaCategoria(pedido) {
    const view = pedido.figura.view;
    const proporcao = pedido.proporcao || PROPORCAO_FIGURA;
    const caixa = limitesDoRecorte(pedido, view);
    const limite = F.figura.VIEWBOX || { width: 600, height: 1024 };
    if (!caixa) return null;

    const larguraRegiao = caixa.maxX - caixa.minX;
    const alturaRegiao = caixa.maxY - caixa.minY;
    const margem = Math.max(MARGEM_FIGURA, Math.max(larguraRegiao, alturaRegiao) * FOLGA_FIGURA);

    let largura = larguraRegiao + margem * 2;
    let altura = alturaRegiao + margem * 2;

    if (largura / altura < proporcao) largura = altura * proporcao;
    else altura = largura / proporcao;

    const alturaMinima = limite.height * ALTURA_MINIMA_FIGURA;
    if (altura < alturaMinima) {
      altura = alturaMinima;
      largura = altura * proporcao;
    }

    if (largura > limite.width) {
      largura = limite.width;
      altura = largura / proporcao;
    }
    if (altura > limite.height) {
      altura = limite.height;
      largura = altura * proporcao;
    }

    let x = (caixa.minX + caixa.maxX) / 2 - largura / 2;
    let y = (caixa.minY + caixa.maxY) / 2 - altura / 2;

    x = Math.max(0, Math.min(limite.width - largura, x));
    y = Math.max(0, Math.min(limite.height - altura, y));

    return [arredondar(x), arredondar(y), arredondar(largura), arredondar(altura)];
  }

  /*
    A prancha aprovada com um conjunto de regiões em lima, recortada para a
    área onde ela será desenhada. Serve aos cards da Biblioteca e ao cabeçalho
    da tela do grupo muscular — sempre a mesma prancha, nenhum arquivo novo.
  */
  function figuraAnatomica(pedido) {
    if (!figurasDisponiveis()) return null;

    const view = pedido.view === "back" ? "back" : "front";
    const regioes = (pedido.regioes || []).filter(id => Boolean(F.figura.shapesFor(id, view)));
    if (regioes.length === 0) return null;

    const destaques = Object.create(null);
    regioes.forEach(id => { destaques[id] = "primary"; });

    const figura = F.figura.render({ view, highlights: destaques });
    const svg = figura.querySelector("svg");
    const caixa = enquadramentoDaCategoria({
      figura: { view, regioes },
      proporcao: pedido.proporcao,
      focoLado: pedido.focoLado
    });

    if (svg && caixa) {
      svg.setAttribute("viewBox", caixa.join(" "));
      svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    }

    figura.classList.add("grupo-figura-anatomia");
    if (pedido.classe) figura.classList.add(pedido.classe);
    return figura;
  }

  function figuraDaCategoria(categoria) {
    return figuraAnatomica({
      view: categoria.figura.view,
      regioes: categoria.figura.regioes
    });
  }

  /* ------------------------------------------------------------------ */
  /* Estado da tela                                                       */
  /* ------------------------------------------------------------------ */

  const state = {
    query: "",
    muscle: null,
    modality: null,
    ranking: null,
    equipment: null,
    origin: null,
    /* "Envolve o grupo": qualquer papel muscular — vem da legenda do atlas. */
    involve: null,
    /* Região de onde o usuário veio (destaque do card), não é filtro. */
    categoria: null
  };

  let visible = PAGE_SIZE;
  let dom = null;

  function signature() {
    return JSON.stringify({
      query: state.query,
      categoria: state.categoria,
      muscle: state.muscle,
      modality: state.modality,
      ranking: state.ranking,
      equipment: state.equipment,
      origin: state.origin,
      involve: state.involve
    });
  }

  let lastSignature = signature();

  function shouldShowResults() {
    return Boolean(
      CATALOG.normalizeText(state.query) ||
      state.muscle || state.involve || state.equipment || state.origin
    );
  }

  function hasActiveFilters() {
    return Boolean(
      CATALOG.normalizeText(state.query) ||
      state.muscle || state.modality || state.ranking || state.equipment ||
      state.origin || state.involve
    );
  }

  function apply(patch) {
    const previousMuscle = state.muscle;
    const previousModality = state.modality;
    Object.assign(state, patch);

    /* Trocar de região zera o subgrupo: os chips são sempre os da região aberta. */
    if (patch.categoria !== undefined && patch.muscle === undefined) state.muscle = null;

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
    state.categoria = null;
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

  /*
    Mídia do card horizontal: a foto do exercício (ou o espaço reservado) à
    esquerda, com a posição no ranking e o selo de vídeo discretos.
  */
  function cardMedia(entry) {
    const media = el("div", "bl-card-media");
    media.setAttribute("data-media", entry.image ? entry.image.source : "fallback");
    media.setAttribute("data-backdrop", entry.image ? entry.image.backdrop : "dark");
    media.setAttribute("data-image", entry.image ? "ok" : (entry.pendingImage ? "review" : "missing"));

    const button = el("button", "bl-card-open");
    button.type = "button";
    button.setAttribute("aria-label", "Abrir detalhes de " + entry.name);
    button.addEventListener("click", () => openDetail(entry));

    if (entry.image) {
      const image = doc.createElement("img");
      image.className = "bl-card-image";
      image.src = entry.image.url;
      image.alt = "Imagem do exercício " + entry.name;
      image.width = 512;
      image.height = 512;
      image.loading = "lazy";
      image.decoding = "async";
      image.setAttribute("data-image-status", entry.image.status);
      /* Arquivo ausente no repositório não vira imagem quebrada. */
      image.addEventListener("error", () => {
        media.classList.add("is-fallback");
        media.setAttribute("data-media", "fallback");
        media.setAttribute("data-backdrop", "dark");
        media.setAttribute("data-image", "missing");
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

    if (entry.hasOfficialVideo || entry.hasApprovedVideo) {
      const badge = el("span", "bl-video-badge");
      badge.setAttribute("aria-label", "Demonstração em vídeo disponível");
      badge.title = "Demonstração em vídeo disponível";
      badge.appendChild(F.ui.icon("play"));
      media.appendChild(badge);
    }

    return media;
  }

  /*
    Espaço reservado do card. Quando existe associação de imagem ainda em
    revisão editorial, o texto diz isso: nada de apresentar como definitiva uma
    foto que ninguém validou, nem de esconder que ela existe.
  */
  function fallbackBody(entry) {
    const fallback = el("div", "bl-card-fallback");
    fallback.appendChild(el("span", "bl-card-fallback-initials", initials(entry.name)));
    fallback.appendChild(el("span", "bl-card-fallback-label",
      entry.pendingImage ? "Imagem em revisão" : "Imagem ainda não disponível"));
    return fallback;
  }

  /*
    Card horizontal da lista: foto de um lado; nome, grupo muscular, modalidade
    e posição no ranking do outro. Os dois botões continuam sendo Detalhes e
    Adicionar — os mesmos fluxos de antes, sem duplicar telas.
  */
  function card(entry) {
    const article = el("article", "ui-exercise-row bl-card");
    article.setAttribute("data-exercise-id", entry.id);
    article.setAttribute("data-origin", entry.origin);
    article.setAttribute("data-muscle", entry.muscleId || "");
    article.setAttribute("data-modality", entry.modalityId || "");
    article.setAttribute("data-ranking-position", entry.position === null ? "" : String(entry.position));
    article.setAttribute("data-has-video", entry.hasOfficialVideo || entry.hasApprovedVideo ? "true" : "false");
    article.setAttribute("data-has-image", entry.image ? "true" : (entry.pendingImage ? "review" : "false"));

    article.appendChild(cardMedia(entry));

    const body = el("div", "bl-card-body");

    const main = el("div", "ui-exercise-main");
    main.appendChild(el("h3", "ui-exercise-name", entry.name));

    /*
      Linha de metadados: grupo muscular e modalidade. Num exercício do
      usuário mostramos os músculos que ele mesmo declarou, como digitou.
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
      A posição no ranking já aparece na insígnia sobre a foto; aqui só entra o
      que é exclusivo do exercício do usuário, para não repetir informação.
    */
    const tags = el("div", "ui-exercise-tags");
    if (entry.origin === "pessoal") tags.appendChild(F.ui.chip("Seu exercício", "muted"));
    if (entry.categoryLabel && entry.origin === "pessoal") tags.appendChild(F.ui.chip(entry.categoryLabel, "muted"));
    if (tags.childNodes.length) main.appendChild(tags);

    body.appendChild(main);

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
    body.appendChild(actions);

    article.appendChild(body);

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

  /*
    Modalidades: exatamente três, sempre no mesmo nome do catálogo — Academia
    aparece como "Musculação" e "Peso corporal" como "Sem equipamentos".
    Não existe chip "Todas": para voltar à lista inteira basta tocar de novo no
    chip ativo ou usar "Limpar tudo". Isso evita um botão que filtra por nada.
  */
  /*
    Modalidades em pílulas com ícone, como na referência: "Todos" (sem filtro)
    mais as três modalidades do catálogo. A pílula ativa é lima; o estado vive
    em `aria-pressed`, não só na cor.
  */
  const ICONES_MODALIDADE = Object.freeze({
    todos: "dumbbell",
    academia: "barbell",
    calistenia: "corpo",
    "peso-corporal": "sem-equipamento"
  });

  const ICONES_EXTRA = Object.freeze({
    barbell: "M3 8v8M6 6.5v11M18 6.5v11M21 8v8M6 12h12",
    corpo: "M12 4.5a2 2 0 1 0 0-.001M12 7v6M12 9.5 8 7.5M12 9.5l4-2M12 13l-3 7M12 13l3 7",
    "sem-equipamento": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M6.5 6.5l11 11"
  });

  function iconeDaModalidade(chave, extraClass) {
    const nome = ICONES_MODALIDADE[chave] || "dumbbell";
    if (F.ui.ICON_PATHS && F.ui.ICON_PATHS[nome]) return F.ui.icon(nome, extraClass);

    const span = el("span", "modalidade-icone" + (extraClass ? " " + extraClass : ""));
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
    path.setAttribute("d", ICONES_EXTRA[nome] || ICONES_EXTRA["sem-equipamento"]);
    svg.appendChild(path);
    span.appendChild(svg);
    return span;
  }

  function modalidadePills() {
    const group = el("div", "catalog-filter bl-filter bl-filter-modalidade");
    group.setAttribute("data-filter-group", "modality");

    const head = el("div", "bl-filter-head");
    head.appendChild(el("span", "catalog-filter-label", "Modalidade"));
    group.appendChild(head);

    const linha = el("div", "modalidade-linha");
    linha.setAttribute("role", "group");
    linha.setAttribute("aria-label", "Modalidade");

    /* "Sem equipamentos" é o nome do catálogo; na pílula cabe "Sem equip.",
       igual à referência. O filtro continua sendo o mesmo id. */
    const opcoes = [{ id: null, label: "Todos" }].concat(
      CATALOG.modalities.map(mode => ({
        id: mode.id,
        label: mode.id === "peso-corporal" ? "Sem equip." : mode.name
      })));

    opcoes.forEach(opcao => {
      const ativo = opcao.id ? state.modality === opcao.id : !state.modality;
      const button = el("button", "modalidade-opcao");
      button.type = "button";
      button.setAttribute("data-value", opcao.id === null ? "" : String(opcao.id));
      button.setAttribute("aria-pressed", String(Boolean(ativo)));
      button.appendChild(iconeDaModalidade(opcao.id === null ? "todos" : opcao.id));
      button.appendChild(el("span", null, opcao.label));
      button.addEventListener("click", () => {
        apply({ modality: opcao.id, ranking: null });
      });
      linha.appendChild(button);
    });

    group.appendChild(linha);
    return group;
  }

  /*
    Endereço da tela do grupo muscular. A modalidade escolhida viaja junto:
    é o que define a etiqueta, os filtros de equipamento e os exercícios.
  */
  function urlDoGrupo(categoria) {
    const params = new URLSearchParams();
    if (state.modality) params.set("modalidade", state.modality);
    params.set("regiao", categoria.id);
    return "grupo.html?" + params.toString();
  }

  /*
    Cards das sete regiões: são a navegação principal da Biblioteca. Cada card
    é um link para a tela do grupo — nada de lista aparecendo abaixo da tela.
  */
  function grupoCards() {
    const wrap = el("div", "bl-grupos");
    wrap.setAttribute("role", "navigation");
    wrap.setAttribute("aria-label", "Regiões musculares");
    wrap.setAttribute("data-filter-group", "categoria");

    CATEGORIAS.forEach(categoria => {
      const link = el("a", "grupo-card");
      link.href = urlDoGrupo(categoria);
      link.setAttribute("data-value", categoria.id);
      link.setAttribute("data-categoria", categoria.id);
      link.setAttribute("aria-label", categoria.rotulo + " — " + categoria.descricao + ". Abrir os exercícios.");
      if (state.categoria === categoria.id) link.classList.add("is-atual");

      const figura = el("span", "grupo-figura");
      const desenho = figuraDaCategoria(categoria);
      if (desenho) figura.appendChild(desenho);
      else figura.appendChild(F.ui.icon("target", "grupo-figura-fallback"));

      const texto = el("span", "grupo-texto");
      texto.appendChild(el("span", "grupo-nome", categoria.rotulo));
      texto.appendChild(el("span", "grupo-descricao", categoria.descricao));

      const seta = el("span", "grupo-seta");
      seta.appendChild(F.ui.icon("chevron-right"));

      link.append(figura, texto, seta);
      wrap.appendChild(link);
    });

    return wrap;
  }

  /* Painel do contador: sempre calculado do catálogo e do filtro atual. */
  function rotuloDoContador(total) {
    const substantivo = total === 1 ? "exercício" : "exercícios";
    const partes = [];

    const query = state.query.trim();
    if (query) partes.push("para “" + query + "”");

    const categoria = categoriaPorId(state.categoria);
    if (categoria) partes.push("em " + categoria.rotulo);
    else if (state.muscle) partes.push("em " + CATALOG.muscleName(groupIdFrom(state.muscle)));

    if (state.modality) partes.push("em " + CATALOG.modalityName(modalityIdFrom(state.modality)));

    if (!partes.length) return substantivo + " disponíveis";
    return substantivo + " " + partes.join(" · ");
  }

  function counterNode(total) {
    const box = el("div", "bl-contador");
    box.id = "bl-contador";
    box.setAttribute("aria-live", "polite");

    box.appendChild(F.ui.icon("info"));

    const texto = el("p", "bl-contador-texto");
    texto.appendChild(el("strong", null, String(total)));
    texto.appendChild(doc.createTextNode(" " + rotuloDoContador(total)));

    if (hasActiveFilters()) {
      const catalogo = totalExercises();
      texto.appendChild(el("span", "bl-contador-complemento",
        " de " + catalogo + (catalogo === 1 ? " exercício" : " exercícios") + " no catálogo"));
    }

    box.appendChild(texto);
    return box;
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

    dom.controls.appendChild(modalidadePills());
    dom.controls.appendChild(grupoCards());
    dom.controls.appendChild(counterNode(found.length));

    if (dom.results) dom.results.hidden = !shouldShowResults();

    if (dom.searchClear) dom.searchClear.hidden = !state.query;

    dom.status.textContent = found.length === 0
      ? "Nenhum exercício com esses critérios"
      : found.length + (found.length === 1 ? " exercício" : " exercícios") +
        (hasActiveFilters() ? " com os filtros atuais" : " no catálogo");

    if (dom.resultsFilters) {
      while (dom.resultsFilters.firstChild) dom.resultsFilters.removeChild(dom.resultsFilters.firstChild);
      dom.activeFilters = activeFilterChips();
      dom.resultsFilters.appendChild(dom.activeFilters);
      dom.resultsFilters.appendChild(advancedFilters(counts));
    }

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
    input.placeholder = "Buscar exercício pelo nome…";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Buscar exercício pelo nome");
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

    dom = { root };

    /* Busca primeiro: é o caminho mais rápido para achar um exercício. */
    root.appendChild(buildSearch());

    dom.activeFilters = el("div", "bl-active-filters");
    dom.activeFilters.id = "bl-active-filters";
    dom.activeFilters.setAttribute("hidden", "");

    dom.controls = el("div", "catalog-controls bl-filters");
    dom.controls.id = "catalog-controls";
    root.appendChild(dom.controls);

    const results = el("div", "catalog-results bl-results");
    results.id = "catalog-results";
    dom.results = results;

    const status = el("p", "catalog-status");
    status.id = "catalog-status";
    status.setAttribute("aria-live", "polite");
    dom.status = status;
    results.appendChild(status);

    dom.resultsFilters = el("div", "bl-results-filters");
    results.appendChild(dom.resultsFilters);

    dom.list = el("div", "catalog-list");
    dom.list.id = "catalog-list";
    results.appendChild(dom.list);

    root.appendChild(results);

    if (F.state && F.state.activeWorkout) {
      root.appendChild(el("p", "ui-inline-note catalog-session-note",
        "Há uma sessão de treino em andamento. Adicionar um exercício aqui não muda a sessão já iniciada — ele vale para os próximos treinos."));
    }
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

    /* `regiao` abre uma das sete portas (e o card já aparece selecionado). */
    const regiao = categoriaPorId(params.get("regiao"));
    if (regiao) state.categoria = regiao.id;

    const resolvedModality = modalityIdFrom(params.get("modalidade"));
    if (resolvedModality) state.modality = resolvedModality;

    const ranking = Number(params.get("ranking"));
    if (Number.isInteger(ranking) && ranking > 0) state.ranking = ranking;

    const equipment = params.get("equipamento");
    if (equipment) state.equipment = equipment;

    const origin = params.get("origem");
    if (origin === "sugerido" || origin === "catalogo") state.origin = "sugerido";
    if (origin === "personalizado" || origin === "pessoal") state.origin = "personalizado";

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
    render();
  }

  function init() {
    const params = readParams();
    mount();
    if (!dom) return;

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
    apply,
    resetAll,
    categorias: CATEGORIAS,
    categoriaPorId,
    figuraAnatomica,
    chipRow,
    facets,
    rankings,
    rankingPositions,
    totalExercises,
    groupIdFrom,
    modalityIdFrom,
    init,
    state,
    /* Uso interno dos testes e de telas que só querem a contagem. */
    _resetCache: invalidate
  });

  F.pages.biblioteca = init;
})(window);
