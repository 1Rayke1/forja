/* ==========================================================================
   FORJA — Controlador Isolado da Tela Temporária: AVALIAÇÃO DO PILOTO 3D
   - Carrega apenas o vídeo horizontal.
   - Trata carregamento, ausência de arquivo e falha de decodificação/reprodução.
   - Libera todos os recursos de mídia ao sair da tela.
   ========================================================================== */
(function (global) {
  "use strict";

  const doc = global.document;
  const DURACAO_PADRAO_S = 6.0;
  const FPS_PADRAO = 30;
  const TOTAL_QUADROS_PADRAO = 180;
  const VELOCIDADES_PERMITIDAS = [0.25, 0.5, 1];

  const estado = {
    ativo: null,
    recursosLiberados: false,
    rafId: 0,
    abortVerificacao: null,
    cartoes: {}
  };

  // Exposto apenas para inspeção diagnóstica e suíte automatizada de testes
  global.__forjaPiloto3d = {
    estado,
    liberarTodosOsRecursos,
    liberarCard
  };

  function formatarSegundos(seg) {
    const v = Number.isFinite(seg) && seg >= 0 ? seg : 0;
    return v.toFixed(2).replace(".", ",") + " s";
  }

  function rotuloVelocidade(vel) {
    if (vel === 0.25) return "0,25×";
    if (vel === 0.5) return "0,5×";
    return "1×";
  }

  function formatarBytesMiB(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "";
    return (n / (1024 * 1024)).toFixed(2).replace(".", ",") + " MiB";
  }

  function atualizarStatus(cardState, texto, tom) {
    if (!cardState.elStatus) return;
    cardState.elStatus.textContent = texto;
    cardState.elStatus.setAttribute("data-tone", tom || "idle");
  }

  function atualizarIndicadorProgresso(cardState, tempoForcado) {
    const video = cardState.video;
    const dur =
      video && Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : cardState.duracaoConhecida || DURACAO_PADRAO_S;
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      cardState.duracaoConhecida = video.duration;
    }

    const cur =
      typeof tempoForcado === "number"
        ? tempoForcado
        : cardState.carregado && video
        ? video.currentTime || 0
        : 0;

    const frac = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
    const pct = Math.round(frac * 100);
    const totalQuadros = Math.max(1, Math.round(dur * FPS_PADRAO) || TOTAL_QUADROS_PADRAO);
    const quadroAtual = Math.min(totalQuadros, Math.max(1, Math.floor(cur * FPS_PADRAO) + 1));

    const textoTempo = formatarSegundos(cur) + " / " + formatarSegundos(dur);
    if (cardState.elTime) cardState.elTime.textContent = textoTempo;
    if (cardState.elFsTime) cardState.elFsTime.textContent = textoTempo;
    if (cardState.elMeta) {
      cardState.elMeta.textContent = pct + "% · Quadro " + quadroAtual + " / " + totalQuadros;
    }
    if (cardState.elRange && !cardState.arrastandoBarra) {
      cardState.elRange.value = String(Math.round(frac * 1000));
    }
  }

  function atualizarBotoesCard(cardState) {
    const tocando = Boolean(
      cardState.carregado &&
      cardState.video &&
      !cardState.video.paused &&
      !cardState.video.ended
    );
    cardState.botoesPlay.forEach(function (btn) {
      btn.disabled = tocando || cardState.carregando;
    });
    cardState.botoesPause.forEach(function (btn) {
      btn.disabled = !tocando;
    });
    cardState.botoesSpeed.forEach(function (btn) {
      const v = parseFloat(btn.getAttribute("data-speed") || "1");
      const ativo = Math.abs(v - cardState.velocidade) < 0.001;
      btn.setAttribute("aria-pressed", ativo ? "true" : "false");
    });
  }

  function mostrarErro(cardState, titulo, detalhe) {
    cardState.carregando = false;
    cardState.erro = titulo;
    if (cardState.elLoading) cardState.elLoading.hidden = true;
    if (cardState.elErrorTitle) cardState.elErrorTitle.textContent = titulo;
    if (cardState.elErrorDetail) cardState.elErrorDetail.textContent = detalhe || "";
    if (cardState.elError) cardState.elError.hidden = false;
    atualizarStatus(cardState, "Falha no vídeo", "error");
    atualizarBotoesCard(cardState);
  }

  function ocultarErro(cardState) {
    cardState.erro = null;
    if (cardState.elError) cardState.elError.hidden = true;
  }

  function liberarCard(chave, opcoes) {
    const opts = opcoes || {};
    const cardState = estado.cartoes[chave];
    if (!cardState || !cardState.video) return;

    const video = cardState.video;
    cardState.tokenCarga += 1;
    cardState.carregando = false;
    cardState.carregado = false;
    cardState.prontoParaExibir = false;

    try {
      video.pause();
    } catch (_) {}

    if (video.hasAttribute("src")) {
      video.removeAttribute("src");
      while (video.firstChild) {
        video.removeChild(video.firstChild);
      }
      try {
        video.load();
      } catch (_) {}
    }

    if (!opts.preservarVelocidade) {
      cardState.velocidade = 1;
    }

    if (cardState.elLoading) cardState.elLoading.hidden = true;

    if (estado.ativo === chave) {
      estado.ativo = null;
    }

    if (!cardState.erro) {
      const sufixo = cardState.tamanhoTexto ? " · " + cardState.tamanhoTexto : "";
      atualizarStatus(
        cardState,
        cardState.arquivoVerificado ? "Pronto" + sufixo : "Pronto para reproduzir",
        cardState.arquivoVerificado ? "ready" : "idle"
      );
    }

    atualizarIndicadorProgresso(cardState, 0);
    atualizarBotoesCard(cardState);
  }

  function liberarOutrosCartoes(chaveAtiva) {
    Object.keys(estado.cartoes).forEach(function (outra) {
      if (outra !== chaveAtiva) {
        const outroEstado = estado.cartoes[outra];
        if (
          outroEstado &&
          (outroEstado.carregado ||
            outroEstado.carregando ||
            (outroEstado.video && outroEstado.video.hasAttribute("src")))
        ) {
          liberarCard(outra, { preservarVelocidade: true });
        }
      }
    });
  }

  function carregarExclusivo(chave) {
    const cardState = estado.cartoes[chave];
    if (!cardState || !cardState.video) {
      return Promise.reject(new Error("Cartão inválido"));
    }

    ocultarErro(cardState);
    liberarOutrosCartoes(chave);

    const video = cardState.video;
    if (cardState.carregado && cardState.prontoParaExibir && video.hasAttribute("src")) {
      estado.ativo = chave;
      video.defaultPlaybackRate = cardState.velocidade;
      video.playbackRate = cardState.velocidade;
      return Promise.resolve(video);
    }

    const meuToken = ++cardState.tokenCarga;
    cardState.carregando = true;
    cardState.carregado = false;
    cardState.prontoParaExibir = false;
    estado.ativo = chave;
    estado.recursosLiberados = false;

    if (cardState.elLoading) {
      cardState.elLoading.hidden = false;
    }
    atualizarStatus(cardState, "Carregando vídeo…", "loading");
    atualizarBotoesCard(cardState);

    return new Promise(function (resolve, reject) {
      let concluido = false;

      function limparOuvintes() {
        video.removeEventListener("loadeddata", aoPronto);
        video.removeEventListener("canplay", aoPronto);
        video.removeEventListener("error", aoErro);
      }

      function aoPronto() {
        if (concluido) return;
        if (meuToken !== cardState.tokenCarga) {
          limparOuvintes();
          reject(new Error("Carga substituída"));
          return;
        }
        if (video.readyState < 2 || video.videoWidth <= 0) return;

        concluido = true;
        limparOuvintes();
        cardState.carregando = false;
        cardState.carregado = true;
        cardState.prontoParaExibir = true;
        video.defaultPlaybackRate = cardState.velocidade;
        video.playbackRate = cardState.velocidade;

        if (cardState.elLoading) cardState.elLoading.hidden = true;
        atualizarIndicadorProgresso(cardState);
        atualizarBotoesCard(cardState);
        resolve(video);
      }

      function aoErro() {
        if (concluido) return;
        concluido = true;
        limparOuvintes();
        if (meuToken !== cardState.tokenCarga) {
          reject(new Error("Carga cancelada"));
          return;
        }
        const mediaErr = video.error;
        const codigo = mediaErr ? " (código " + mediaErr.code + ")" : "";
        mostrarErro(
          cardState,
          "Não foi possível carregar ou decodificar este vídeo" + codigo + ".",
          "Verifique se o arquivo " + cardState.src + " está disponível no aplicativo."
        );
        reject(new Error("Falha ao carregar vídeo " + chave));
      }

      video.addEventListener("loadeddata", aoPronto);
      video.addEventListener("canplay", aoPronto);
      video.addEventListener("error", aoErro);

      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.defaultPlaybackRate = cardState.velocidade;
      video.playbackRate = cardState.velocidade;
      if (!video.hasAttribute("src")) {
        video.setAttribute("src", cardState.src);
        try {
          video.load();
        } catch (err) {
          aoErro();
        }
      } else if (video.error) {
        // O preload pode ter falhado antes de o usuário tocar em Reproduzir.
        aoErro();
      } else if (video.readyState >= 2) {
        aoPronto();
      }
    });
  }

  async function reproduzirCard(chave) {
    const cardState = estado.cartoes[chave];
    if (!cardState) return;
    if (cardState.arquivoAusenteConfirmado) {
      mostrarErro(
        cardState,
        "Arquivo de vídeo ausente.",
        "Não foi encontrado: " + cardState.src
      );
      return;
    }

    try {
      const video = await carregarExclusivo(chave);
      video.defaultPlaybackRate = cardState.velocidade;
      video.playbackRate = cardState.velocidade;
      await video.play();
      atualizarStatus(
        cardState,
        "Reproduzindo (" + rotuloVelocidade(cardState.velocidade) + ")",
        "playing"
      );
      atualizarBotoesCard(cardState);
      iniciarLoopProgresso();
    } catch (err) {
      if (cardState && !cardState.erro && cardState.carregado) {
        mostrarErro(
          cardState,
          "O navegador bloqueou ou interrompeu a reprodução deste vídeo.",
          "Toque em “Tentar novamente” para recarregar o arquivo."
        );
      }
    }
  }

  function pausarCard(chave) {
    const cardState = estado.cartoes[chave];
    if (!cardState || !cardState.video || !cardState.carregado) return;
    try {
      cardState.video.pause();
    } catch (_) {}
    atualizarStatus(
      cardState,
      "Pausado (" + rotuloVelocidade(cardState.velocidade) + ")",
      "ready"
    );
    atualizarIndicadorProgresso(cardState);
    atualizarBotoesCard(cardState);
  }

  async function reiniciarCard(chave) {
    const cardState = estado.cartoes[chave];
    if (!cardState || !cardState.video) return;
    if (!cardState.carregado) {
      atualizarIndicadorProgresso(cardState, 0);
      return;
    }
    const estavaTocando = !cardState.video.paused;
    cardState.video.currentTime = 0;
    cardState.video.playbackRate = cardState.velocidade;
    atualizarIndicadorProgresso(cardState, 0);
    if (estavaTocando) {
      try {
        await cardState.video.play();
      } catch (_) {}
    }
  }

  function definirVelocidadeCard(chave, novaVel) {
    const cardState = estado.cartoes[chave];
    if (!cardState || !VELOCIDADES_PERMITIDAS.includes(novaVel)) return;
    cardState.velocidade = novaVel;
    if (cardState.video) {
      cardState.video.defaultPlaybackRate = novaVel;
      cardState.video.playbackRate = novaVel;
    }
    if (cardState.carregado && cardState.video && !cardState.video.paused) {
      atualizarStatus(
        cardState,
        "Reproduzindo (" + rotuloVelocidade(novaVel) + ")",
        "playing"
      );
    } else if (cardState.carregado) {
      atualizarStatus(
        cardState,
        "Pausado (" + rotuloVelocidade(novaVel) + ")",
        "ready"
      );
    }
    atualizarBotoesCard(cardState);
  }

  function estaEmTelaCheia(stage) {
    return (
      doc.fullscreenElement === stage ||
      doc.webkitFullscreenElement === stage ||
      stage.classList.contains("is-pseudo-fullscreen")
    );
  }

  async function alternarTelaCheia(chave) {
    const cardState = estado.cartoes[chave];
    if (!cardState || !cardState.stage) return;
    const stage = cardState.stage;

    if (estaEmTelaCheia(stage)) {
      sairDeQualquerTelaCheia();
      return;
    }

    sairDeQualquerTelaCheia();

    try {
      if (typeof stage.requestFullscreen === "function") {
        await stage.requestFullscreen();
        return;
      }
      if (typeof stage.webkitRequestFullscreen === "function") {
        stage.webkitRequestFullscreen();
        return;
      }
      if (cardState.video && typeof cardState.video.webkitEnterFullscreen === "function") {
        if (!cardState.carregado) {
          await carregarExclusivo(chave);
        }
        cardState.video.webkitEnterFullscreen();
        return;
      }
    } catch (_) {
      // Fallback para WebViews Android / iframes sem permissão nativa de fullscreen
    }

    stage.classList.add("is-pseudo-fullscreen");
    cardState.botoesFullscreen.forEach(function (btn) {
      btn.setAttribute("aria-pressed", "true");
    });
  }

  function sairDeQualquerTelaCheia() {
    if (doc.fullscreenElement && typeof doc.exitFullscreen === "function") {
      doc.exitFullscreen().catch(function () {});
    } else if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === "function") {
      try {
        doc.webkitExitFullscreen();
      } catch (_) {}
    }
    Object.values(estado.cartoes).forEach(function (cs) {
      if (cs.stage) cs.stage.classList.remove("is-pseudo-fullscreen");
      cs.botoesFullscreen.forEach(function (btn) {
        btn.setAttribute("aria-pressed", "false");
      });
    });
  }

  function cicloProgresso() {
    estado.rafId = 0;
    const chave = estado.ativo;
    if (!chave) return;
    const cs = estado.cartoes[chave];
    if (!cs || !cs.carregado || !cs.video || cs.video.paused) return;
    atualizarIndicadorProgresso(cs);
    estado.rafId = global.requestAnimationFrame(cicloProgresso);
  }

  function iniciarLoopProgresso() {
    if (!estado.rafId) {
      estado.rafId = global.requestAnimationFrame(cicloProgresso);
    }
  }

  async function verificarArquivoUnico(cardState, signal) {
    if (typeof global.fetch !== "function") return;
    try {
      let res = await global.fetch(cardState.src, {
        method: "HEAD",
        cache: "no-store",
        signal: signal
      });

      // Alguns servidores estáticos simples não implementam HEAD (405/501)
      if (res.status === 405 || res.status === 501) {
        const ctrlCurto = new AbortController();
        const abortarPai = function () { ctrlCurto.abort(); };
        if (signal) signal.addEventListener("abort", abortarPai, { once: true });
        res = await global.fetch(cardState.src, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          signal: ctrlCurto.signal
        });
        const ok = res.ok || res.status === 206;
        ctrlCurto.abort();
        if (signal) signal.removeEventListener("abort", abortarPai);
        if (!ok) {
          cardState.arquivoAusenteConfirmado = true;
          mostrarErro(
            cardState,
            "Arquivo de vídeo não encontrado (HTTP " + res.status + ").",
            "Caminho esperado: " + cardState.src
          );
          return;
        }
        cardState.arquivoVerificado = true;
        atualizarStatus(cardState, "Pronto", "ready");
        return;
      }

      if (!res.ok && res.status !== 206) {
        cardState.arquivoAusenteConfirmado = true;
        mostrarErro(
          cardState,
          "Arquivo de vídeo não encontrado (HTTP " + res.status + ").",
          "Caminho esperado: " + cardState.src
        );
        return;
      }

      cardState.arquivoAusenteConfirmado = false;
      cardState.arquivoVerificado = true;
      const len = res.headers.get("content-length");
      cardState.tamanhoTexto = formatarBytesMiB(len);
      if (!cardState.carregado && !cardState.carregando) {
        const sufixo = cardState.tamanhoTexto ? " · " + cardState.tamanhoTexto : "";
        atualizarStatus(cardState, "Pronto" + sufixo, "ready");
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
      mostrarErro(
        cardState,
        "Não foi possível verificar o arquivo de vídeo.",
        "Caminho esperado: " + cardState.src
      );
    }
  }

  async function verificarArquivosSequencialmente() {
    if (estado.abortVerificacao) estado.abortVerificacao.abort();
    const ctrl = new AbortController();
    estado.abortVerificacao = ctrl;

    const chaves = ["horizontal"];
    for (let i = 0; i < chaves.length; i += 1) {
      if (ctrl.signal.aborted) return;
      const cs = estado.cartoes[chaves[i]];
      if (cs) {
        await verificarArquivoUnico(cs, ctrl.signal);
      }
    }
  }

  function liberarTodosOsRecursos() {
    if (estado.abortVerificacao) {
      estado.abortVerificacao.abort();
      estado.abortVerificacao = null;
    }
    if (estado.rafId) {
      global.cancelAnimationFrame(estado.rafId);
      estado.rafId = 0;
    }
    sairDeQualquerTelaCheia();
    Object.keys(estado.cartoes).forEach(function (chave) {
      liberarCard(chave, { preservarVelocidade: false });
    });
    estado.ativo = null;
    estado.recursosLiberados = true;
  }

  function configurarCard(chave) {
    const card = doc.querySelector('[data-piloto-card="' + chave + '"]');
    if (!card) return;

    const video = card.querySelector("[data-piloto-video]");
    const stage = card.querySelector("[data-piloto-stage]");
    const elLoading = card.querySelector("[data-piloto-loading]");
    const elError = card.querySelector("[data-piloto-error]");
    const elErrorTitle = card.querySelector("[data-piloto-error-title]");
    const elErrorDetail = card.querySelector("[data-piloto-error-detail]");
    const elRetry = card.querySelector("[data-piloto-retry]");
    const elStatus = card.querySelector("[data-piloto-status]");
    const elTime = card.querySelector("[data-piloto-time]");
    const elFsTime = card.querySelector("[data-piloto-fs-time]");
    const elMeta = card.querySelector("[data-piloto-meta]");
    const elRange = card.querySelector("[data-piloto-range]");

    const cardState = {
      chave: chave,
      card: card,
      video: video,
      stage: stage,
      src: video.getAttribute("data-video-src") || "",
      elLoading: elLoading,
      elError: elError,
      elErrorTitle: elErrorTitle,
      elErrorDetail: elErrorDetail,
      elStatus: elStatus,
      elTime: elTime,
      elFsTime: elFsTime,
      elMeta: elMeta,
      elRange: elRange,
      botoesPlay: Array.from(card.querySelectorAll('[data-action="play"]')),
      botoesPause: Array.from(card.querySelectorAll('[data-action="pause"]')),
      botoesRestart: Array.from(card.querySelectorAll('[data-action="restart"]')),
      botoesFullscreen: Array.from(card.querySelectorAll('[data-action="fullscreen"]')),
      botoesExitFs: Array.from(card.querySelectorAll('[data-action="exit-fullscreen"]')),
      botoesSpeed: Array.from(card.querySelectorAll("[data-speed]")),
      velocidade: 1,
      duracaoConhecida: DURACAO_PADRAO_S,
      carregando: false,
      carregado: false,
      prontoParaExibir: false,
      arquivoVerificado: false,
      arquivoAusenteConfirmado: false,
      tamanhoTexto: "",
      arrastandoBarra: false,
      erro: null,
      tokenCarga: 0
    };

    estado.cartoes[chave] = cardState;

    video.addEventListener("click", function () {
      if (!cardState.carregado) {
        reproduzirCard(chave);
      } else if (video.paused) {
        reproduzirCard(chave);
      } else {
        pausarCard(chave);
      }
    });

    ["timeupdate", "loadedmetadata", "durationchange", "seeked"].forEach(function (ev) {
      video.addEventListener(ev, function () {
        if (cardState.carregado) atualizarIndicadorProgresso(cardState);
      });
    });

    video.addEventListener("waiting", function () {
      if (cardState.carregado && elLoading) {
        elLoading.hidden = false;
      }
    });

    video.addEventListener("playing", function () {
      if (elLoading) elLoading.hidden = true;
      if (Math.abs(video.playbackRate - cardState.velocidade) > 0.001) {
        video.playbackRate = cardState.velocidade;
      }
      atualizarStatus(
        cardState,
        "Reproduzindo (" + rotuloVelocidade(cardState.velocidade) + ")",
        "playing"
      );
      atualizarBotoesCard(cardState);
      iniciarLoopProgresso();
    });

    video.addEventListener("pause", function () {
      if (!cardState.carregado) return;
      if (elLoading) elLoading.hidden = true;
      atualizarStatus(
        cardState,
        "Pausado (" + rotuloVelocidade(cardState.velocidade) + ")",
        "ready"
      );
      atualizarIndicadorProgresso(cardState);
      atualizarBotoesCard(cardState);
    });

    cardState.botoesPlay.forEach(function (btn) {
      btn.addEventListener("click", function () {
        reproduzirCard(chave);
      });
    });

    cardState.botoesPause.forEach(function (btn) {
      btn.addEventListener("click", function () {
        pausarCard(chave);
      });
    });

    cardState.botoesRestart.forEach(function (btn) {
      btn.addEventListener("click", function () {
        reiniciarCard(chave);
      });
    });

    cardState.botoesFullscreen.forEach(function (btn) {
      btn.addEventListener("click", function () {
        alternarTelaCheia(chave);
      });
    });

    cardState.botoesExitFs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        sairDeQualquerTelaCheia();
      });
    });

    cardState.botoesSpeed.forEach(function (btn) {
      btn.addEventListener("click", function () {
        const vel = parseFloat(btn.getAttribute("data-speed") || "1");
        definirVelocidadeCard(chave, vel);
      });
    });

    if (elRetry) {
      elRetry.addEventListener("click", function () {
        cardState.arquivoAusenteConfirmado = false;
        ocultarErro(cardState);
        reproduzirCard(chave);
      });
    }

    if (elRange) {
      elRange.addEventListener("pointerdown", function () {
        cardState.arrastandoBarra = true;
      });
      elRange.addEventListener("pointerup", function () {
        cardState.arrastandoBarra = false;
      });
      elRange.addEventListener("input", async function () {
        const frac = Math.min(1, Math.max(0, Number(elRange.value || 0) / 1000));
        try {
          const v = await carregarExclusivo(chave);
          const dur =
            Number.isFinite(v.duration) && v.duration > 0
              ? v.duration
              : cardState.duracaoConhecida || DURACAO_PADRAO_S;
          v.currentTime = frac * dur;
          cardState.arrastandoBarra = false;
          atualizarIndicadorProgresso(cardState, v.currentTime);
        } catch (_) {
          cardState.arrastandoBarra = false;
        }
      });
    }

    atualizarIndicadorProgresso(cardState, 0);
    atualizarBotoesCard(cardState);
  }

  function configurarBannerSessaoLeituraSomente() {
    // Leitura estritamente passiva caso exista treino em andamento (sem escrever em localStorage)
    try {
      const bruto = global.localStorage && global.localStorage.getItem("forja-treino-sessao-ativa-v1");
      if (!bruto) return;
      const sessao = JSON.parse(bruto);
      if (!sessao || typeof sessao !== "object" || !sessao.id) return;
      const banner = doc.getElementById("active-session-banner");
      const resumo = doc.getElementById("active-session-summary");
      if (banner && resumo) {
        resumo.textContent = sessao.routineName ? String(sessao.routineName) : "Sessão pausada em segundo plano";
        banner.hidden = false;
      }
    } catch (_) {}
  }

  function configurarCicloDeVida() {
    doc.addEventListener("fullscreenchange", function () {
      const elem = doc.fullscreenElement;
      Object.values(estado.cartoes).forEach(function (cs) {
        const ativo = elem === cs.stage;
        cs.botoesFullscreen.forEach(function (btn) {
          btn.setAttribute("aria-pressed", ativo ? "true" : "false");
        });
      });
    });

    doc.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        sairDeQualquerTelaCheia();
      }
    });

    doc.addEventListener("visibilitychange", function () {
      if (doc.hidden && estado.ativo) {
        pausarCard(estado.ativo);
      }
    });

    // Liberação garantida ao sair da tela por links internos, voltar ou fechamento
    doc.querySelectorAll("a[href]").forEach(function (link) {
      link.addEventListener("click", function (ev) {
        const href = link.getAttribute("href") || "";
        if (!href || href.startsWith("#")) return;
        if (ev.defaultPrevented || link.target === "_blank") return;
        liberarTodosOsRecursos();
      });
    });

    global.addEventListener("pagehide", liberarTodosOsRecursos);
    global.addEventListener("beforeunload", liberarTodosOsRecursos);
    global.addEventListener("pageshow", function (ev) {
      if (ev.persisted) {
        estado.recursosLiberados = false;
        verificarArquivosSequencialmente();
      }
    });
  }

  function iniciar() {
    const main = doc.getElementById("conteudo");
    if (main && !main.hasAttribute("tabindex")) {
      main.setAttribute("tabindex", "-1");
    }

    configurarCard("horizontal");
    configurarBannerSessaoLeituraSomente();
    configurarCicloDeVida();
    verificarArquivosSequencialmente();
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})(window);
