/*
  FORJA — tela de apresentação do exercício.

  Contrato da tela:
  - um título;
  - uma demonstração horizontal 16:9, 1280×720, 30 FPS, fundo #121010;
  - autoplay, mudo, inline, loop infinito, sem controles.

  A única demonstração aceita é o vídeo horizontal de uma pessoa real. Não
  existe prévia por personagem 3D, não há seletor de modelo e nenhum movimento
  é emprestado de outro exercício. Enquanto o MP4 de um exercício não existe, a
  tela informa a pendência com um estado explícito — nunca tela em branco.

  Os vídeos serão produzidos numa etapa futura (máximo de 60 s, 16:9). Esta
  tela não pesquisa nada, não baixa nada e não cria demonstração própria: só
  reproduz o arquivo local quando ele for aprovado.
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
    duracaoMaximaS: 60,
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
    modo: "carregando",
    exercicio: null,
    video: null,
    erro: null,
    especificacao: ESPECIFICACAO
  };

  let dom = null;
  let destruido = false;

  function consultar(seletor) {
    return document.querySelector(seletor);
  }

  function registrarEspecificacao() {
    const alvo = dom.stage;
    alvo.dataset.proporcao = ESPECIFICACAO.proporcao;
    alvo.dataset.largura = String(ESPECIFICACAO.largura);
    alvo.dataset.altura = String(ESPECIFICACAO.altura);
    alvo.dataset.fps = String(ESPECIFICACAO.fps);
    alvo.dataset.fundo = ESPECIFICACAO.fundo;
    alvo.dataset.duracaoMaxima = String(ESPECIFICACAO.duracaoMaximaS);
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
    dom.titulo.textContent = nome;
    document.title = nome + " · FORJA";
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
    try {
      return new URL(relativo, document.baseURI).href;
    } catch (erro) {
      return null;
    }
  }

  /*
    Manifesto opcional dos vídeos aprovados. Guarda só caminho e especificação
    de cada arquivo; sem ele, a tela usa apenas a biblioteca de exercícios e
    mostra a pendência. Nada aqui é gerado em tempo de execução.
  */
  async function carregarManifesto() {
    if (typeof fetch !== "function") return null;
    try {
      const resposta = await fetch(
        new URL("../assets/videos/exercicios/manifest.json", document.baseURI).href,
        { cache: "no-cache" }
      );
      if (!resposta || !resposta.ok) return null;
      const dados = await resposta.json();
      return dados && typeof dados === "object" ? dados : null;
    } catch (erro) {
      return null;
    }
  }

  function acharExercicio(manifesto, id) {
    if (!manifesto || !Array.isArray(manifesto.exercicios)) return null;
    return manifesto.exercicios.find(item => item && item.id === id) || null;
  }

  function entradaDaBiblioteca(id) {
    const biblioteca = (F.EXERCISE_LIBRARY || {});
    const modalidades = ["calisthenics", "weights"];

    for (const modalidade of modalidades) {
      const lista = Array.isArray(biblioteca[modalidade]) ? biblioteca[modalidade] : [];
      const achado = lista.find(item => item && item.id === id);
      if (achado) {
        return {
          id: achado.id,
          nome: achado.name,
          modalidade,
          video: null
        };
      }
    }

    /* Exercício personalizado: existe na biblioteca do usuário, não no catálogo. */
    const personalizados = (F.state && F.state.library) || {};
    const chaves = Object.keys(personalizados);
    for (const chave of chaves) {
      const lista = Array.isArray(personalizados[chave]) ? personalizados[chave] : [];
      const achado = lista.find(item => item && item.id === id);
      if (achado) {
        return {
          id: achado.id,
          nome: achado.name,
          modalidade: chave,
          video: null
        };
      }
    }

    return null;
  }

  function videoAprovado(exercicio) {
    const caminho = exercicio && exercicio.video;
    if (!caminho) return null;

    const duracao = Number(exercicio.duracaoS);
    if (Number.isFinite(duracao) && duracao > ESPECIFICACAO.duracaoMaximaS) {
      return null;
    }

    return caminhoAbsoluto(caminho);
  }

  function configurarVideo() {
    /* A reprodução é só do arquivo: sem controles, sem som, sem download. */
    dom.video.muted = true;
    dom.video.defaultMuted = true;
    dom.video.loop = true;
    dom.video.playsInline = true;
    dom.video.controls = false;
    dom.video.setAttribute("muted", "");
    dom.video.setAttribute("playsinline", "");

    dom.video.addEventListener("error", () => {
      if (destruido) return;
      mostrarErro("Não foi possível carregar a demonstração deste exercício.", "erro-video");
    });

    dom.video.addEventListener("playing", () => {
      if (destruido) return;
      dom.loading.hidden = true;
      definirModo("video");
    });
  }

  /* Um toque/clique não pausa a demonstração: o vídeo é leitura, não player. */
  function bloquearInteracao() {
    dom.video.addEventListener("click", evento => evento.preventDefault());
    dom.video.addEventListener("pause", () => {
      if (destruido || !dom.video.src) return;
      const promessa = dom.video.play();
      if (promessa && typeof promessa.catch === "function") promessa.catch(() => {});
    });
  }

  function tentarReproduzir() {
    const promessa = dom.video.play();
    if (promessa && typeof promessa.catch === "function") {
      promessa.catch(() => {
        if (destruido) return;
        mostrarErro("Toque na tela para iniciar a demonstração.", "autoplay");
      });
    }
  }

  function usarVideo(exercicio, url) {
    estado.video = url;
    definirModo("video");
    dom.error.hidden = true;
    dom.loading.hidden = false;
    dom.video.hidden = false;
    dom.video.src = url;
    dom.video.load();
    tentarReproduzir();
  }

  function mostrarPendencia(mensagem) {
    definirModo("pendente");
    dom.video.hidden = true;
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
      loading: consultar("#exercicio-loading"),
      error: consultar("#exercicio-error"),
      titulo: consultar("#exercicio-title"),
      voltar: consultar("#exercicio-voltar")
    };

    if (!dom.stage || !dom.video || !dom.loading || !dom.error || !dom.titulo) {
      return;
    }

    registrarEspecificacao();
    configurarVideo();
    bloquearInteracao();
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

    const url = videoAprovado(exercicio);
    if (url) {
      usarVideo(exercicio, url);
      return;
    }

    if (exercicio.video) {
      mostrarPendencia(
        "O vídeo deste exercício está fora da especificação (horizontal 16:9, até 60 segundos) e não é exibido."
      );
      return;
    }

    mostrarPendencia("Este exercício ainda não tem vídeo de demonstração.");
  }

  /* Gancho de leitura para validação automatizada. Não altera a tela. */
  Object.defineProperty(global, "__forjaExercicio", {
    configurable: true,
    get() {
      return {
        estado,
        especificacao: ESPECIFICACAO,
        video: dom ? dom.video : null,
        modo: estado.modo
      };
    }
  });

  global.addEventListener("pagehide", evento => {
    if (evento.persisted || destruido) return;
    destruido = true;
    if (dom && dom.video) {
      dom.video.pause();
      dom.video.removeAttribute("src");
      dom.video.load();
    }
  });

  F.pages.exercicio = iniciar;
})(window);
