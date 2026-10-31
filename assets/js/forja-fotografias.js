/*
  FORJA — fotografias dos cartões (tela Explorar).

  Camada somente-leitura e sem rede: todas as imagens são arquivos locais em
  assets/fotografias/ (dois tamanhos, WebP, 16:10) apontados por
  assets/js/forja-fotografias-dados.js. Nada aqui grava, altera rotinas,
  sessões, histórico, armazenamento ou o Atlas muscular.

  Regras:
  - `exato` só é usado quando a foto mostra o próprio exercício. Fora isso a
    foto é tratada como `contexto` (categoria/equipamento) e nunca é anunciada
    como execução do movimento.
  - Um cartão sem correspondência recebe uma fotografia de contexto da mesma
    categoria; se nem isso existir, recebe o marcador neutro de marca — nunca
    um emoji e nunca um ícone vendido como fotografia.
  - Se uma variante falhar ao carregar, a imagem some e o cartão mantém o fundo
    de marca tratado em CSS (nenhuma imagem quebrada fica na tela).
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const DATA = global.FORJA_FOTOS_DATA || null;
  const doc = global.document;

  if (!F || !doc) return;

  const FALLBACK_CATEGORIA = {
    "corpo-todo": "sala-musculacao",
    "abdomen-core": "abdominal-supra",
    "braços": "halteres-feminino",
    "peito": "supino-barra",
    "costas": "puxada-frontal",
    "ombros": "prateleira-halteres",
    "pernas": "leg-press",
    "mobilidade": "mobilidade",
    "condicionamento": "funcional"
  };

  function available() {
    return Boolean(DATA && DATA.fotos && DATA.cartoes);
  }

  function provider() {
    return DATA ? DATA.provedor : null;
  }

  function normalizeId(value) {
    return F.catalog && typeof F.catalog.normalizeText === "function"
      ? F.catalog.normalizeText(value || "")
      : String(value || "").toLowerCase().trim();
  }

  /* Uma foto do registro, com URLs das variantes já resolvidas. */
  function foto(id) {
    if (!available() || !id) return null;
    const raw = DATA.fotos[id];
    if (!raw) return null;
    return {
      id,
      alt: raw.a,
      tipo: raw.t,
      proporcao: "16:10",
      largura: raw.l[0],
      altura: raw.h,
      autor: raw.au,
      autorUrl: raw.ap,
      sourcePage: raw.so,
      licenca: raw.li,
      licencaUrl: raw.lu,
      provedor: raw.p,
      foco: raw.fo,
      fontes: raw.v.map((arquivo, indice) => ({
        url: F.url("assets/fotografias/" + arquivo),
        largura: raw.l[indice]
      }))
    };
  }

  function entrada(grupo, chave) {
    if (!available()) return null;
    const tabela = DATA.cartoes[grupo];
    return tabela && chave ? tabela[chave] || null : null;
  }

  /* Correspondência por exercício: só por `mode:libraryId` (nunca por nome). */
  function exerciseKey(record, mode) {
    if (!record) return null;
    const origem = record.libraryId || record.id;
    if (!origem) return null;
    return (mode || record.mode || "") + ":" + origem;
  }

  function forExercise(record, mode) {
    const chave = exerciseKey(record, mode);
    const item = entrada("exercicios", chave);
    return item ? foto(item.foto) : null;
  }

  function forCategoria(id) {
    const item = entrada("categorias", id);
    const found = item ? foto(item.foto) : null;
    return found || foto(FALLBACK_CATEGORIA[id]) || null;
  }

  function forRecurso(id) {
    const item = entrada("recursos", id);
    return item ? foto(item.foto) : null;
  }

  function forDirecionado(id) {
    const item = entrada("direcionado", id);
    return item ? foto(item.foto) : null;
  }

  function forSeteDias(id) {
    const item = entrada("seteDias", id);
    return item ? foto(item.foto) : null;
  }

  function forModality(mode) {
    const item = entrada("porModalidade", mode);
    return item ? foto(item.foto) : null;
  }

  /*
    Grupo muscular/categoria do próprio exercício, usado só para escolher a foto
    de contexto. A fonte é o dado que já existe no catálogo (`roles` e
    `category`); nada de músculo ou exercício é inferido aqui.
  */
  /* Chaves sem acento: a comparação usa o mesmo normalizador do catálogo. */
  const MUSCULO_CATEGORIA = Object.freeze({
    "abdomen": "abdomen-core",
    "oblicuos": "abdomen-core",
    "lombar": "abdomen-core",
    "biceps": "braços",
    "triceps": "braços",
    "antebracos": "braços",
    "peito": "peito",
    "dorsais": "costas",
    "costas": "costas",
    "ombros": "ombros",
    "quadriceps": "pernas",
    "posterior de coxa": "pernas",
    "gluteos": "pernas",
    "pernas": "pernas",
    "quadril": "pernas"
  });

  const CATEGORIA_CATALOGO = Object.freeze({
    core: "abdomen-core",
    mobility: "mobilidade",
    cardio: "condicionamento",
    push: "peito",
    pull: "costas",
    legs: "pernas"
  });

  function categoriaDoExercicio(record) {
    if (!record) return null;
    const roles = record.roles || {};

    /* Primário decide primeiro; secundário só entra se o primário não ajudar. */
    const grupos = []
      .concat(Array.isArray(roles.primary) ? roles.primary : [])
      .concat(Array.isArray(roles.secondary) ? roles.secondary : [])
      .concat(Array.isArray(record.muscles) ? record.muscles : []);

    for (const grupo of grupos) {
      const alvo = MUSCULO_CATEGORIA[normalizeId(grupo)];
      if (alvo) return alvo;
    }

    return CATEGORIA_CATALOGO[record.category] || null;
  }

  /*
    Escolha da foto de um cartão de exercício:
    1. correspondência do próprio exercício (exata ou de contexto);
    2. foto de contexto do grupo muscular do exercício;
    3. foto da modalidade;
    4. nada (marcador neutro do cartão).
  */
  function forCard(record, mode, categoriaId) {
    const direta = forExercise(record, mode);
    if (direta) return direta;
    const doExercicio = categoriaDoExercicio(record) || categoriaId;
    const daCategoria = doExercicio ? forCategoria(doExercicio) : null;
    if (daCategoria) return daCategoria;
    return forModality(mode) || null;
  }

  /* Texto alternativo: descritivo, sem afirmar execução quando é contexto. */
  function altText(photo, nomeDoCartao) {
    if (!photo) return "";
    if (photo.tipo === "exato" && nomeDoCartao) return photo.alt;
    return photo.alt;
  }

  /* Crédito curto para o rodapé do cartão. */
  function creditLine(photo) {
    if (!photo) return "";
    return "Foto: " + photo.autor + " / " + photo.provedor;
  }

  function buildPicture(photo, options) {
    const opts = options || {};
    if (!photo) return null;

    const picture = doc.createElement("picture");
    picture.className = opts.className || "cartao-foto";

    const srcset = photo.fontes.map(fonte => fonte.url + " " + fonte.largura + "w").join(", ");
    const source = doc.createElement("source");
    source.type = "image/webp";
    source.srcset = srcset;
    source.sizes = opts.sizes || "100vw";
    picture.appendChild(source);

    const img = doc.createElement("img");
    img.className = opts.imgClass || "";
    img.src = photo.fontes[photo.fontes.length - 1].url;
    img.srcset = srcset;
    img.sizes = opts.sizes || "100vw";
    img.alt = opts.alt !== undefined ? opts.alt : photo.alt;
    img.width = photo.largura;
    img.height = photo.altura;
    img.setAttribute("loading", opts.eager ? "eager" : "lazy");
    img.setAttribute("decoding", "async");
    if (opts.eager) img.setAttribute("fetchpriority", "high");
    img.style.objectPosition = photo.foco === "top" ? "center top" : photo.foco === "bottom" ? "center bottom" : "center center";
    img.addEventListener("error", () => {
      /* Variante ausente: remove a imagem; o cartão fica com o fundo de marca. */
      picture.classList.add("is-indisponivel");
      if (img.parentNode) img.parentNode.removeChild(img);
      const host = picture.parentNode;
      if (host && host.classList) host.classList.add("sem-foto");
    });
    picture.appendChild(img);
    return picture;
  }

  /* Lista de créditos para a tela de Configurações. */
  function credits() {
    if (!available()) return [];
    return Object.keys(DATA.fotos).map(id => foto(id)).filter(Boolean).sort((a, b) => {
      const autor = a.autor.localeCompare(b.autor, "pt-BR");
      return autor !== 0 ? autor : a.id.localeCompare(b.id);
    });
  }

  F.fotos = {
    available,
    provider,
    normalizeId,
    foto,
    forExercise,
    forCategoria,
    forRecurso,
    forDirecionado,
    forSeteDias,
    forModality,
    forCard,
    categoriaDoExercicio,
    altText,
    creditLine,
    buildPicture,
    credits
  };
})(window);
