/*
  FORJA — tela de apresentação do exercício.

  Contrato da tela (o mesmo da primeira etapa aprovada):
  - um título;
  - uma demonstração horizontal 16:9, 1280×720, 30 FPS, fundo #121010;
  - autoplay, mudo, inline, loop infinito, sem controles.

  O vídeo MP4 é a entrega final. Enquanto ele não existe para um exercício, a
  mesma área mostra a prévia 3D do clipe próprio — nunca um clipe de outro
  exercício e nunca um movimento inventado. Sem clipe próprio, a tela informa
  a pendência; não há botão de play, barra de progresso nem seletor vertical.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  if (!F) return;

  /*
    Esta tela não tem banner de sessão ativa nem cronômetro de treino. O módulo
    comum (`forja-app.js`) chama `updateActiveBanner` e cria um intervalo de
    `workoutTick` em toda página; aqui os dois são no-ops locais, para a tela
    não depender do módulo de sessão nem carregar lógica que não usa.
  */
  if (typeof F.updateActiveBanner !== "function") {
    F.updateActiveBanner = function updateActiveBanner() {};
  }
  if (typeof F.workoutTick !== "function") {
    F.workoutTick = function workoutTick() {};
  }

  const ESPECIFICACAO = Object.freeze({
    proporcao: "16:9",
    largura: 1280,
    altura: 720,
    fps: 30,
    fundo: "#121010",
    camera: Object.freeze({
      azimuteGraus: -58,
      elevacaoGraus: 22,
      campoVisaoVerticalGraus: 32
    }),
    loop: "infinito",
    audio: false,
    controles: false
  });

  const PARAMETROS = new URLSearchParams(global.location.search);
  const ID = String(
    PARAMETROS.get("exercicio") || PARAMETROS.get("ex") || ""
  ).trim();

  const estado = {
    id: ID,
    nome: null,
    personagem: null,
    modo: "carregando",
    exercicio: null,
    video: null,
    cena: null,
    erro: null,
    especificacao: ESPECIFICACAO
  };

  let dom = null;
  let destruido = false;
  let previaEmAndamento = false;

  function consultar(seletor) {
    return document.querySelector(seletor);
  }

  function personagemInicial() {
    const daUrl = String(PARAMETROS.get("personagem") || "").toLowerCase();
    if (daUrl === "masculino" || daUrl === "feminino") return daUrl;

    const doPerfil = typeof F.resolvePersonagem === "function"
      ? F.resolvePersonagem(F.state && F.state.profile)
      : null;
    if (doPerfil && (doPerfil.id === "masculino" || doPerfil.id === "feminino")) {
      return doPerfil.id;
    }
    /* A URL direta pode ser aberta sem perfil; o padrão é o do piloto. */
    return "masculino";
  }

  function rotuloPersonagem(id) {
    return id === "feminino" ? "feminino" : "masculino";
  }

  function tituloDe(nome) {
    return nome + " — modelo " + rotuloPersonagem(estado.personagem);
  }

  function registrarEspecificacao() {
    const alvo = dom.stage;
    alvo.dataset.proporcao = ESPECIFICACAO.proporcao;
    alvo.dataset.largura = String(ESPECIFICACAO.largura);
    alvo.dataset.altura = String(ESPECIFICACAO.altura);
    alvo.dataset.fps = String(ESPECIFICACAO.fps);
    alvo.dataset.fundo = ESPECIFICACAO.fundo;
    alvo.dataset.cameraAzimute = String(ESPECIFICACAO.camera.azimuteGraus);
    alvo.dataset.cameraElevacao = String(ESPECIFICACAO.camera.elevacaoGraus);
    alvo.dataset.cameraFov = String(ESPECIFICACAO.camera.campoVisaoVerticalGraus);
    alvo.dataset.loop = ESPECIFICACAO.loop;
    alvo.dataset.audio = "false";
    alvo.dataset.controles = "false";
  }

  function definirModo(modo) {
    estado.modo = modo;
    if (dom && dom.stage) dom.stage.dataset.modo = modo;
  }

  function publicarTitulo(nome) {
    estado.nome = nome;
    const texto = tituloDe(nome);
    dom.titulo.textContent = texto;
    document.title = texto + " · FORJA";
    dom.video.setAttribute(
      "aria-label",
      "Demonstração de " + nome + " em vídeo horizontal, em loop"
    );
  }

  function ajustarVoltar(exercicio) {
    const parametros = new URLSearchParams();
    if (estado.id) parametros.set("exercicio", estado.id);
    if (exercicio && exercicio.modalidade) {
      parametros.set("modalidade", exercicio.modalidade);
    }
    const busca = parametros.toString();
    const raiz = (document.body && document.body.getAttribute("data-root")) || "";
    const rota = (F.ROUTES && F.ROUTES.biblioteca) || "treino/biblioteca.html";
    dom.voltar.href = raiz + rota + (busca ? "?" + busca : "");
  }

  function caminhoAbsoluto(relativo) {
    if (!relativo) return null;
    if (/^https?:\/\//i.test(relativo)) return relativo;
    return new URL(
      String(relativo).replace(/^\/+/, ""),
      new URL("../", global.location.href)
    ).href;
  }

  async function carregarManifesto() {
    if (typeof global.fetch !== "function") return null;
    try {
      const resposta = await global.fetch(
        new URL("../assets/3d/apresentacao-exercicios.json", global.location.href).href,
        { cache: "no-cache" }
      );
      if (!resposta.ok) throw new Error("HTTP " + resposta.status);
      return await resposta.json();
    } catch (erro) {
      /* Sem manifesto, a tela ainda tenta o catálogo 3D e a biblioteca. */
      if (global.console && console.warn) {
        console.warn("[FORJA] manifesto de apresentação indisponível:", erro.message);
      }
      return null;
    }
  }

  function acharExercicio(manifesto, id) {
    if (!manifesto || !Array.isArray(manifesto.exercicios)) return null;
    return manifesto.exercicios.find(item => item && item.id === id) || null;
  }

  function entradaDaBiblioteca(id) {
    const biblioteca = F.EXERCISE_LIBRARY || {};
    const modalidades = Object.keys(biblioteca);
    for (let i = 0; i < modalidades.length; i += 1) {
      const modalidade = modalidades[i];
      const itens = biblioteca[modalidade] || [];
      const item = itens.find(candidato => candidato && candidato.id === id);
      if (item) {
        return {
          id: item.id,
          nome: item.name,
          modalidade,
          video: { masculino: null, feminino: null },
          personagens: null,
          clipeId: null
        };
      }
    }
    return null;
  }

  function videoPronto(exercicio, personagem) {
    const video = exercicio && exercicio.video && exercicio.video[personagem];
    return video && video.status === "pronto" ? video : null;
  }

  function configurarVideo() {
    const video = dom.video;

    /* Nenhum caminho de código adiciona `controls`; os atributos abaixo
       reforçam o contrato mesmo se uma extensão tentar reativá-lo. */
    video.controls = false;
    video.removeAttribute("controls");
    video.autoplay = true;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("preload", "auto");
    video.setAttribute("disablepictureinpicture", "");
    video.setAttribute("controlslist", "nodownload nofullscreen noremoteplayback");
    video.tabIndex = -1;

    video.addEventListener("contextmenu", evento => evento.preventDefault());
    video.addEventListener("loadedmetadata", aoMetadadosDoVideo);
    video.addEventListener("canplay", aoPoderTocar);
    video.addEventListener("playing", aoComecarVideo);
    video.addEventListener("pause", aoPausarVideo);
    video.addEventListener("error", aoFalharVideo);
  }

  function tentarTocar() {
    if (destruido || !dom || dom.video.hidden) return;
    const promessa = dom.video.play();
    if (promessa && typeof promessa.catch === "function") {
      /* Autoplay bloqueado: silencioso e mudo, mas alguns navegadores ainda
         exigem um gesto. A retomada é invisível — não há botão de play. */
      promessa.catch(() => {});
    }
  }

  function instalarRetomadaInvisivel() {
    const retomar = () => {
      if (!destruido && estado.modo === "video") tentarTocar();
    };
    document.addEventListener("pointerdown", retomar, { passive: true });
    document.addEventListener("keydown", retomar);
    document.addEventListener("touchstart", retomar, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) retomar();
    });
    global.addEventListener("pageshow", evento => {
      if (evento.persisted) {
        if (estado.cena) estado.cena.play();
        retomar();
      }
    });
  }

  function aoMetadadosDoVideo() {
    if (destruido || dom.video.hidden) return;

    const largura = dom.video.videoWidth;
    const altura = dom.video.videoHeight;
    const proporcao = altura ? largura / altura : 0;

    /* Defesa em profundidade: o gerador só marca `pronto` para 1280×720,
       16:9 e 30 FPS. Se um arquivo fora disso chegar ao navegador, ele não
       é exibido — a prévia 3D assume. */
    if (
      largura !== ESPECIFICACAO.largura ||
      altura !== ESPECIFICACAO.altura ||
      Math.abs(proporcao - 16 / 9) > 0.002
    ) {
      if (global.console && console.warn) {
        console.warn("[FORJA] vídeo fora da especificação:", largura + "×" + altura, dom.video.currentSrc);
      }
      usarPrevia3D(estado.exercicio, "video-fora-da-especificacao");
      return;
    }

    dom.stage.dataset.videoLargura = String(largura);
    dom.stage.dataset.videoAltura = String(altura);
    dom.stage.dataset.videoProporcao = (largura / altura).toFixed(6);
  }

  function aoPoderTocar() {
    if (destruido || dom.video.hidden) return;
    tentarTocar();
  }

  function aoComecarVideo() {
    if (destruido || dom.video.hidden) return;
    estado.video = estado.exercicio && estado.exercicio.video
      ? estado.exercicio.video[estado.personagem]
      : null;
    estado.erro = null;
    dom.loading.hidden = true;
    dom.error.hidden = true;
    definirModo("video");

    if (estado.video && estado.video.meta) {
      dom.stage.dataset.videoFps = String(estado.video.meta.fps);
      dom.stage.dataset.videoDuracao = String(estado.video.meta.duracaoS);
    }
  }

  function aoPausarVideo() {
    if (destruido || document.hidden || estado.modo !== "video") return;
    /* Pausa externa (tecla de mídia, troca de aba) não vira controle:
       retoma sozinho no próximo ciclo. */
    global.setTimeout(tentarTocar, 0);
  }

  function aoFalharVideo() {
    if (destruido) return;
    if (estado.modo !== "video" && estado.modo !== "video-carregando") return;
    if (global.console && console.warn) {
      console.warn("[FORJA] falha ao carregar o MP4; usando a prévia 3D.");
    }
    usarPrevia3D(estado.exercicio, "erro-video");
  }

  function usarVideo(exercicio, pronto) {
    const url = caminhoAbsoluto(pronto.arquivo);
    if (!url) {
      usarPrevia3D(exercicio, "video-sem-caminho");
      return;
    }

    if (estado.cena) {
      estado.cena.destruir();
      estado.cena = null;
    }

    estado.video = pronto;
    estado.erro = null;
    dom.palco.hidden = true;
    dom.video.hidden = false;
    dom.loading.hidden = false;
    dom.error.hidden = true;
    definirModo("video-carregando");

    dom.video.src = url;
    dom.video.load();
    tentarTocar();
  }

  function usarPrevia3D(exercicio, motivo) {
    if (destruido || !exercicio) return;
    if (previaEmAndamento || estado.modo === "3d" || estado.modo === "3d-carregando") return;
    previaEmAndamento = true;
    if (!F.exercicio3d || typeof F.exercicio3d.montar !== "function") {
      previaEmAndamento = false;
      mostrarErro("Prévia 3D indisponível neste navegador.", "sem-3d");
      return;
    }

    if (estado.cena) {
      estado.cena.destruir();
      estado.cena = null;
    }

    const personagem = estado.personagem;
    const dados = exercicio.personagens && exercicio.personagens[personagem]
      ? exercicio.personagens[personagem]
      : null;

    const video = dom.video;
    video.pause();
    video.hidden = true;
    video.removeAttribute("src");
    video.load();

    estado.video = null;
    dom.palco.hidden = false;
    dom.loading.hidden = false;
    dom.error.hidden = true;
    definirModo("3d-carregando");

    F.exercicio3d.montar(dom.palco, {
      personagem,
      modelo: dados ? caminhoAbsoluto(dados.modelo) : null,
      clipeArquivo: dados ? caminhoAbsoluto(dados.clipe) : null,
      clipeId: exercicio.clipeId || null,
      aoErro: evento => {
        if (global.console && console.warn) {
          console.warn("[FORJA] prévia 3D:", evento.fase, evento.erro && evento.erro.message);
        }
      }
    }).then(api => {
      previaEmAndamento = false;
      if (destruido) {
        if (api) api.destruir();
        return;
      }
      if (!api) {
        mostrarErro("Não foi possível carregar a demonstração 3D.", "sem-cena");
        return;
      }
      if (api.estado && api.estado.erro) {
        mostrarErro("Não foi possível carregar a demonstração 3D.", "erro-3d");
        return;
      }

      estado.cena = api;
      estado.erro = null;

      const especificacao = api.especificacao;
      if (especificacao && especificacao.camera) {
        dom.stage.dataset.cameraAzimute = String(especificacao.camera.azimuteGraus);
        dom.stage.dataset.cameraElevacao = String(especificacao.camera.elevacaoGraus);
        dom.stage.dataset.cameraFov = String(especificacao.camera.campoVisaoVerticalGraus);
      }

      dom.loading.hidden = true;
      dom.error.hidden = true;
      definirModo("3d");
    }).catch(erro => {
      previaEmAndamento = false;
      if (destruido) return;
      if (erro && erro.codigo === "sem-clipe") {
        mostrarPendencia("A animação 3D deste exercício ainda não está disponível.");
        return;
      }
      if (global.console && console.error) {
        console.error("[FORJA] prévia 3D falhou:", erro, motivo);
      }
      mostrarErro("Não foi possível carregar a demonstração 3D.", "erro-3d");
    });
  }

  function mostrarPendencia(mensagem) {
    definirModo("pendente");
    dom.loading.hidden = true;
    dom.error.hidden = false;
    dom.error.textContent = mensagem;
  }

  function mostrarErro(mensagem, codigo) {
    estado.erro = codigo || "erro";
    definirModo("erro");
    dom.loading.hidden = true;
    dom.error.hidden = false;
    dom.error.textContent = mensagem;
  }

  async function iniciar() {
    dom = {
      stage: consultar("#exercicio-stage"),
      video: consultar("#exercicio-video"),
      palco: consultar("#exercicio-3d"),
      loading: consultar("#exercicio-loading"),
      error: consultar("#exercicio-error"),
      titulo: consultar("#exercicio-title"),
      voltar: consultar("#exercicio-voltar")
    };

    if (!dom.stage || !dom.video || !dom.palco || !dom.loading || !dom.error || !dom.titulo) {
      return;
    }

    estado.personagem = personagemInicial();
    registrarEspecificacao();
    configurarVideo();
    instalarRetomadaInvisivel();
    publicarTitulo("Exercício");
    ajustarVoltar(null);

    if (!ID) {
      mostrarErro("Escolha um exercício na biblioteca para ver a demonstração.", "sem-id");
      return;
    }

    const manifesto = await carregarManifesto();
    const exercicio = acharExercicio(manifesto, ID) || entradaDaBiblioteca(ID);

    if (!exercicio) {
      mostrarErro("Exercício não encontrado na biblioteca.", "nao-encontrado");
      return;
    }

    estado.exercicio = exercicio;
    publicarTitulo(exercicio.nome || "Exercício");
    ajustarVoltar(exercicio);

    const pronto = videoPronto(exercicio, estado.personagem);
    if (pronto) {
      usarVideo(exercicio, pronto);
      return;
    }

    const temClipe = Boolean(
      exercicio.clipeId ||
      (exercicio.personagens && exercicio.personagens[estado.personagem])
    );
    if (temClipe) {
      usarPrevia3D(exercicio, "sem-video");
      return;
    }

    if (exercicio.clipeRevisao) {
      mostrarPendencia("Este exercício tem um clipe em revisão técnica; a demonstração final ainda não está disponível.");
      return;
    }

    /* Pendência específica do manifesto (ex.: clipe já usado por outro
       exercício). A tela não reutiliza o movimento e diz por quê. */
    const pendenciaDeReuso = (exercicio.pendencias || [])
      .find(texto => /já é usado por outro exercício/.test(texto));
    if (pendenciaDeReuso) {
      mostrarPendencia(pendenciaDeReuso);
      return;
    }
    mostrarPendencia("Este exercício ainda não tem animação 3D própria.");
  }

  /* Gancho de leitura para validação automatizada. Não altera a tela. */
  Object.defineProperty(global, "__forjaExercicio", {
    configurable: true,
    get() {
      return {
        estado,
        especificacao: ESPECIFICACAO,
        video: dom ? dom.video : null,
        palco: dom ? dom.palco : null,
        cena: estado.cena,
        modo: estado.modo,
        personagem: estado.personagem
      };
    }
  });

  global.addEventListener("pagehide", evento => {
    if (evento.persisted || destruido) return;
    destruido = true;
    if (estado.cena) {
      estado.cena.destruir();
      estado.cena = null;
    }
    if (dom && dom.video) {
      dom.video.pause();
      dom.video.removeAttribute("src");
      dom.video.load();
    }
  });

  F.pages.exercicio = iniciar;
})(window);
