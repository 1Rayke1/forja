/*
  FORJA — cena 3D compartilhada pelos dois personagens.

  Módulo ES (a única parte do app que usa módulos, porque o three.js moderno só
  é distribuído assim). O resto do FORJA segue script clássico + window.Forja;
  este arquivo é carregado sob demanda por `forja-personagens.js`, que usa as
  exportações abaixo — não há estado global.

  Um único controlador atende masculino e feminino: ele recebe a URL do modelo e
  a URL do clipe. Não há duas cópias da lógica de reprodução.

  Decisões de desempenho (Android intermediário):
  - o modelo do personagem (~0,9 MB) é carregado uma vez e reaproveitado;
  - cada clipe (~20-60 KB) é baixado só quando o exercício aparece;
  - pixelRatio limitado, sem sombras, sem pós-processamento, sem texturas extras;
  - o laço de render para quando a cena sai da tela ou a aba fica oculta;
  - se WebGL não existir ou um arquivo falhar, quem chamou recebe o erro e mostra
    o fallback (nunca tela em branco).
*/
import * as THREE from "../vendor/three/three.module.min.js";
import { GLTFLoader } from "../vendor/three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

/* Cache de modelos por URL: dois painéis na mesma página compartilham o GLB. */
const cachePersonagens = new Map();
const cacheClipes = new Map();

function carregarGLTF(url, aoProgresso) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      gltf => resolve(gltf),
      evento => {
        if (aoProgresso && evento.lengthComputable && evento.total) {
          aoProgresso(evento.loaded / evento.total);
        }
      },
      erro => reject(erro instanceof Error ? erro : new Error("falha ao carregar " + url))
    );
  });
}

export function modeloCarregado(url, aoProgresso) {
  if (!cachePersonagens.has(url)) {
    const promessa = carregarGLTF(url, aoProgresso).catch(erro => {
      cachePersonagens.delete(url);
      throw erro;
    });
    cachePersonagens.set(url, promessa);
  }
  return cachePersonagens.get(url);
}

export function clipeCarregado(url) {
  if (!cacheClipes.has(url)) {
    const promessa = carregarGLTF(url).catch(erro => {
      cacheClipes.delete(url);
      throw erro;
    });
    cacheClipes.set(url, promessa);
  }
  return cacheClipes.get(url);
}

export function webglDisponivel() {
  try {
    if (!window.WebGLRenderingContext) return false;
    const canvas = document.createElement("canvas");
    const contexto = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!contexto) return false;
    /* libera o contexto de teste: navegadores limitam quantos existem por página */
    const perder = contexto.getExtension("WEBGL_lose_context");
    if (perder) perder.loseContext();
    return true;
  } catch (erro) {
    return false;
  }
}

/*
  Nomes de faixa: o clipe foi exportado de outro arquivo, então as faixas vêm
  como "hips.quaternion". Se o esqueleto do personagem usar outro nome para o
  mesmo osso, reescrevemos a faixa pelo nome do osso encontrado — e falhamos de
  forma explícita se nenhum osso casar (melhor erro claro que pose errada).
*/
export function reamarrarFaixas(clipe, raiz) {
  const ossos = new Set();
  raiz.traverse(objeto => {
    if (objeto.isBone || objeto.isObject3D) ossos.add(objeto.name);
  });

  let amarradas = 0;
  const faixas = [];
  for (const faixa of clipe.tracks) {
    const ponto = faixa.name.indexOf(".");
    const alvo = ponto === -1 ? faixa.name : faixa.name.slice(0, ponto);
    const propriedade = ponto === -1 ? "" : faixa.name.slice(ponto);
    if (ossos.has(alvo)) {
      faixas.push(faixa);
      amarradas += 1;
      continue;
    }
    /* tenta casar ignorando prefixos (ex.: mixamorig:hips) */
    const curto = alvo.split(":").pop().split("_").pop();
    let substituto = null;
    ossos.forEach(nome => {
      if (!substituto && nome.split(":").pop().split("_").pop() === curto) substituto = nome;
    });
    if (substituto) {
      faixas.push(new faixa.constructor(substituto + propriedade, faixa.times, faixa.values));
      amarradas += 1;
    }
  }
  if (!amarradas) throw new Error("A animação não casa com nenhum osso do personagem.");
  /* clipe vazio (só pose estática) ainda é válido para o mixer. */
  return new THREE.AnimationClip(clipe.name || "pose", clipe.duration, faixas);
}

const VELOCIDADES = [0.5, 1, 1.5];

export async function criarCena(container, opcoes) {
  const config = Object.assign(
    { personagemUrl: "", clipeUrl: "", aoErro: null, aoEstado: null, aoCarregar: null },
    opcoes || {}
  );

  if (!webglDisponivel()) throw new Error("WebGL indisponível neste navegador.");

  const larguraInicial = Math.max(1, container.clientWidth || 320);
  const alturaInicial = Math.max(1, container.clientHeight || 260);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio <= 1.5,
      alpha: true,
      powerPreference: "low-power"
    });
  } catch (erro) {
    throw new Error("Não foi possível iniciar o WebGL.");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(larguraInicial, alturaInicial, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "c3-canvas";
  renderer.domElement.setAttribute("role", "img");
  container.appendChild(renderer.domElement);

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, larguraInicial / alturaInicial, 0.1, 40);

  cena.add(new THREE.HemisphereLight(0xfff6ea, 0x2b2f26, 2.0));
  const sol = new THREE.DirectionalLight(0xffffff, 2.4);
  sol.position.set(1.8, 3.2, 2.6);
  cena.add(sol);
  const contra = new THREE.DirectionalLight(0xbff26a, 0.9);
  contra.position.set(-2.4, 1.6, -2.2);
  cena.add(contra);

  const piso = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 40),
    new THREE.MeshBasicMaterial({ color: 0x1b2018, transparent: true, opacity: 0.55 })
  );
  piso.rotation.x = -Math.PI / 2;
  piso.position.y = 0.001;
  cena.add(piso);

  const grupo = new THREE.Group();
  cena.add(grupo);

  const estado = {
    carregado: false,
    erro: null,
    tocando: true,
    velocidade: 1,
    clipeId: null
  };

  let mixer = null;
  let acaoAtual = null;
  let personagem = null;
  let requisicao = 0;
  const alvo = new THREE.Vector3(0, 0.95, 0);
  const orbita = { azimute: 0.28, elevacao: 0.06, distancia: 4.1 };

  function enquadrar() {
    camera.position.set(
      alvo.x + Math.sin(orbita.azimute) * orbita.distancia,
      alvo.y + Math.sin(orbita.elevacao) * orbita.distancia + 0.15,
      alvo.z + Math.cos(orbita.azimute) * orbita.distancia
    );
    camera.lookAt(alvo);
  }
  enquadrar();

  function aplicarVelocidade() {
    if (mixer) mixer.timeScale = estado.velocidade;
  }

  async function usarPersonagem(url) {
    const gltf = await modeloCarregado(url, progresso => {
      if (config.aoCarregar) config.aoCarregar({ fase: "personagem", progresso });
    });
    /*
      O GLB fica em cache e é compartilhado. Um Object3D só pode ter um pai, então
      reaproveitar a mesma cena em dois painéis ao mesmo tempo quebraria o
      primeiro: falhamos de forma explícita em vez de exibir um boneco invisível.
    */
    if (gltf.scene === personagem) return;
    if (gltf.scene.parent && gltf.scene.parent !== grupo) {
      throw new Error("O modelo do personagem já está em uso em outra cena 3D.");
    }
    if (personagem) {
      grupo.remove(personagem);
    }
    personagem = gltf.scene;
    personagem.traverse(objeto => {
      if (objeto.isMesh) {
        objeto.frustumCulled = false;
        if (objeto.material) {
          objeto.material.side = THREE.FrontSide;
          objeto.material.roughness = 0.82;
          objeto.material.metalness = 0.04;
        }
      }
    });
    grupo.add(personagem);
    estado.carregado = true;
    if (mixer) {
      mixer.stopAllAction();
      mixer = null;
      acaoAtual = null;
    }
  }

  async function usarClipe(url, clipeId) {
    if (!personagem) return;
    let gltf;
    try {
      gltf = await clipeCarregado(url);
    } catch (erro) {
      estado.erro = "clipe";
      if (config.aoErro) config.aoErro({ fase: "clipe", erro });
      return;
    }
    const origem = gltf.animations && gltf.animations[0];
    if (!origem) {
      estado.erro = "clipe";
      if (config.aoErro) config.aoErro({ fase: "clipe", erro: new Error("clipe vazio") });
      return;
    }
    let clipe;
    try {
      clipe = reamarrarFaixas(origem, personagem);
    } catch (erro) {
      estado.erro = "compatibilidade";
      if (config.aoErro) config.aoErro({ fase: "compatibilidade", erro });
      return;
    }

    if (!mixer) mixer = new THREE.AnimationMixer(personagem);
    const nova = mixer.clipAction(clipe);
    nova.setLoop(THREE.LoopRepeat, Infinity);
    nova.clampWhenFinished = false;
    nova.enabled = true;
    nova.setEffectiveTimeScale(1);
    nova.setEffectiveWeight(1);

    if (acaoAtual && acaoAtual !== nova) {
      /* transição suave entre animações (0,28 s) */
      nova.reset().play();
      acaoAtual.crossFadeTo(nova, 0.28, false);
    } else {
      nova.reset().play();
    }
    acaoAtual = nova;
    estado.clipeId = clipeId || null;
    estado.erro = null;
    aplicarVelocidade();
    if (!estado.tocando) nova.paused = true;
    renderer.domElement.setAttribute(
      "aria-label",
      "Demonstração 3D em movimento do personagem " + (config.personagemId || "") + "."
    );
  }

  let visivel = true;
  let ativo = true;
  const relogio = new THREE.Clock();
  let quadro = 0;

  function laco() {
    if (ativo) {
      /*
        Rede de segurança de ciclo de vida: se o painel saiu do documento (modal
        fechado, exercício trocado, página reconstruída) sem chamar `destruir()`,
        o laço para sozinho em vez de renderizar uma cena invisível para sempre.
      */
      if (container.isConnected === false) {
        ativo = false;
        return;
      }
      quadro = requestAnimationFrame(laco);
      const delta = Math.min(relogio.getDelta(), 0.1);
      if (mixer && estado.tocando && visivel && !document.hidden) {
        mixer.update(delta);
      }
      renderer.render(cena, camera);
    }
  }
  laco();

  function redimensionar() {
    const largura = Math.max(1, container.clientWidth || 320);
    const altura = Math.max(1, container.clientHeight || 260);
    renderer.setSize(largura, altura, false);
    camera.aspect = largura / altura;
    camera.updateProjectionMatrix();
  }

  const observadorTamanho = typeof ResizeObserver === "function"
    ? new ResizeObserver(redimensionar)
    : null;
  if (observadorTamanho) observadorTamanho.observe(container);

  const observadorVisivel = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(entradas => {
        visivel = entradas.some(entrada => entrada.isIntersecting);
        if (!visivel) relogio.getDelta();
      }, { threshold: 0.05 })
    : null;
  if (observadorVisivel) observadorVisivel.observe(container);

  function aoOcultar() {
    if (document.hidden) relogio.getDelta();
  }
  document.addEventListener("visibilitychange", aoOcultar);

  /* ---- controles de câmera: arrastar gira, roda/pinça aproxima ---- */
  const ponteiros = new Map();
  let ultimo = null;
  let distanciaInicial = 0;

  function aoPressionar(evento) {
    ponteiros.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    ultimo = { x: evento.clientX, y: evento.clientY };
    if (ponteiros.size === 2) {
      const [a, b] = Array.from(ponteiros.values());
      distanciaInicial = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  function aoMover(evento) {
    if (!ponteiros.has(evento.pointerId)) return;
    ponteiros.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    if (ponteiros.size >= 2 && distanciaInicial) {
      const [a, b] = Array.from(ponteiros.values());
      const distancia = Math.hypot(a.x - b.x, a.y - b.y);
      const fator = distanciaInicial / Math.max(1, distancia);
      orbita.distancia = THREE.MathUtils.clamp(orbita.distancia * fator, 1.9, 7.5);
      distanciaInicial = distancia;
      enquadrar();
      return;
    }
    if (!ultimo) return;
    const dx = evento.clientX - ultimo.x;
    const dy = evento.clientY - ultimo.y;
    ultimo = { x: evento.clientX, y: evento.clientY };
    orbita.azimute -= dx * 0.007;
    orbita.elevacao = THREE.MathUtils.clamp(orbita.elevacao + dy * 0.004, -0.25, 0.6);
    enquadrar();
  }
  function aoSoltar(evento) {
    ponteiros.delete(evento.pointerId);
    if (ponteiros.size < 2) distanciaInicial = 0;
    if (ponteiros.size === 0) ultimo = null;
  }
  function aoRoda(evento) {
    evento.preventDefault();
    orbita.distancia = THREE.MathUtils.clamp(orbita.distancia + evento.deltaY * 0.0016, 1.9, 7.5);
    enquadrar();
  }

  const elemento = renderer.domElement;
  elemento.style.touchAction = "none";
  elemento.addEventListener("pointerdown", aoPressionar);
  elemento.addEventListener("pointermove", aoMover);
  elemento.addEventListener("pointerup", aoSoltar);
  elemento.addEventListener("pointercancel", aoSoltar);
  elemento.addEventListener("wheel", aoRoda, { passive: false });

  const api = {
    estado,
    async carregarPersonagem(url) {
      const meu = ++requisicao;
      try {
        await usarPersonagem(url);
        if (meu !== requisicao) return false;
        if (config.clipeUrl) await usarClipe(config.clipeUrl, config.clipeId);
        return true;
      } catch (erro) {
        estado.erro = "personagem";
        if (config.aoErro) config.aoErro({ fase: "personagem", erro });
        return false;
      }
    },
    async trocarPersonagem(url) {
      const meu = ++requisicao;
      try {
        await usarPersonagem(url);
        if (meu !== requisicao) return;
        if (estado.clipeId && config.clipeUrl) await usarClipe(config.clipeUrl, estado.clipeId);
      } catch (erro) {
        estado.erro = "personagem";
        if (config.aoErro) config.aoErro({ fase: "personagem", erro });
      }
    },
    async trocarClipe(url, clipeId) {
      config.clipeUrl = url;
      await usarClipe(url, clipeId);
    },
    play() {
      estado.tocando = true;
      if (acaoAtual) acaoAtual.paused = false;
    },
    pause() {
      estado.tocando = false;
      if (acaoAtual) acaoAtual.paused = true;
    },
    alternar() {
      if (estado.tocando) api.pause(); else api.play();
      return estado.tocando;
    },
    reiniciar() {
      if (acaoAtual) {
        acaoAtual.reset();
        acaoAtual.paused = !estado.tocando;
        acaoAtual.play();
      }
      if (mixer) mixer.setTime(0);
    },
    velocidade(valor) {
      const numero = Number(valor);
      estado.velocidade = VELOCIDADES.indexOf(numero) === -1 ? 1 : numero;
      aplicarVelocidade();
      return estado.velocidade;
    },
    enquadrar() {
      orbita.azimute = 0.28;
      orbita.elevacao = 0.06;
      orbita.distancia = 4.1;
      enquadrar();
    },
    destruir() {
      ativo = false;
      cancelAnimationFrame(quadro);
      document.removeEventListener("visibilitychange", aoOcultar);
      if (observadorTamanho) observadorTamanho.disconnect();
      if (observadorVisivel) observadorVisivel.disconnect();
      elemento.removeEventListener("pointerdown", aoPressionar);
      elemento.removeEventListener("pointermove", aoMover);
      elemento.removeEventListener("pointerup", aoSoltar);
      elemento.removeEventListener("pointercancel", aoSoltar);
      elemento.removeEventListener("wheel", aoRoda);
      if (mixer) {
        mixer.stopAllAction();
        mixer = null;
      }
      /*
        Geometria e material do personagem NÃO são descartados: vêm do cache
        compartilhado por URL e podem ser reaproveitados por outro painel. Só o
        que é exclusivo desta cena (piso, luzes, renderer) é liberado.
      */
      if (personagem) {
        personagem.traverse(objeto => {
          if (objeto.isMesh) objeto.frustumCulled = true;
        });
      }
      piso.geometry.dispose();
      piso.material.dispose();
      renderer.dispose();
      if (elemento.parentNode) elemento.parentNode.removeChild(elemento);
    }
  };

  await api.carregarPersonagem(config.personagemUrl);
  return api;
}

export const VELOCIDADES_DISPONIVEIS = VELOCIDADES;
