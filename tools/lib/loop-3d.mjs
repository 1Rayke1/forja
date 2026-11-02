/*
  FORJA — auditoria de continuidade de loop dos clipes 3D.

  O atributo `loop` do <video> e o `LoopRepeat` do AnimationMixer não provam
  nada sobre o conteúdo: se o último quadro não coincidir com o primeiro, o
  usuário vê um salto a cada repetição. Esta biblioteca lê o GLB publicado e
  compara, trilha por trilha, a costura (última → primeira amostra) com o maior
  passo natural entre quadros consecutivos.

  Critério (o mesmo usado no relatório do piloto abdominal):
    razão = passo da costura / maior passo natural da trilha

  Uma razão baixa significa que a volta ao início anda menos do que o próprio
  movimento já anda entre dois quadros — a repetição é matematicamente
  contínua. Isso NÃO prova continuidade visual no vídeo renderizado; a
  inspeção quadro a quadro é uma etapa posterior.

  O status NÃO altera o clipe: apenas informa. Nenhum movimento é corrigido,
  suavizado ou substituído. A `caminhada` é uma exceção conhecida: o quadril
  (`hips`) tem ~2,1 mm de deslocamento residual na costura. O clipe original é
  preservado e a exceção fica registrada, sem correção automática.

  Uso:
    import { auditarClipe, auditarDiretorio } from "./lib/loop-3d.mjs";
*/

import fs from "node:fs";
import path from "node:path";

const COMPONENTES = {
  5120: { Ctor: Int8Array, bytes: 1 },
  5121: { Ctor: Uint8Array, bytes: 1 },
  5122: { Ctor: Int16Array, bytes: 2 },
  5123: { Ctor: Uint16Array, bytes: 2 },
  5125: { Ctor: Uint32Array, bytes: 4 },
  5126: { Ctor: Float32Array, bytes: 4 }
};

const TIPOS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/*
  Exceções conhecidas e deliberadamente preservadas. Elas continuam sendo
  auditadas; só deixam de ser classificadas como "fechado" para não esconder
  uma limitação real atrás de uma tolerância numérica.
*/
export const EXCECOES_CONHECIDAS = Object.freeze({
  "caminhada.glb": Object.freeze({
    motivo: "Deslocamento residual de ~2 mm na raiz (hips), preservado sem correção; continuidade visual a validar no vídeo renderizado.",
    noRaiz: "hips"
  })
});

const TOLERANCIA = Object.freeze({
  /* Um passo de costura até metade do maior passo natural é imperceptível. */
  razaoFechado: 0.5,
  razaoAtencao: 1,
  /* Limites absolutos de segurança, mesmo quando a razão é boa. */
  angularFechadoGraus: 4,
  angularAtencaoGraus: 8,
  linearFechadoM: 0.004,
  linearAtencaoM: 0.008,
  /* Trilhas praticamente paradas não entram na razão. */
  movimentoMinimoAngularGraus: 0.05,
  movimentoMinimoLinearM: 0.0001
});

function lerScalar(bin, offset, Ctor) {
  const view = new DataView(bin.buffer, bin.byteOffset + offset, Ctor.BYTES_PER_ELEMENT);
  switch (Ctor) {
    case Int8Array: return view.getInt8(0);
    case Uint8Array: return view.getUint8(0);
    case Int16Array: return view.getInt16(0, true);
    case Uint16Array: return view.getUint16(0, true);
    case Uint32Array: return view.getUint32(0, true);
    case Float32Array: return view.getFloat32(0, true);
    default: throw new Error("componentType sem leitura");
  }
}

export function lerGLB(arquivo) {
  const buf = fs.readFileSync(arquivo);
  if (buf.toString("utf8", 0, 4) !== "glTF") {
    throw new Error(path.basename(arquivo) + ": não é um arquivo GLB");
  }
  const versao = buf.readUInt32LE(4);
  const tamanho = buf.readUInt32LE(8);
  if (versao !== 2 || tamanho !== buf.length) {
    throw new Error(path.basename(arquivo) + ": GLB 2.0 inválido ou truncado");
  }

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buf.length) {
    const n = buf.readUInt32LE(offset);
    const tipo = buf.toString("utf8", offset + 4, offset + 8);
    const dados = buf.subarray(offset + 8, offset + 8 + n);
    if (tipo === "JSON") {
      json = JSON.parse(dados.toString("utf8").replace(/\0+$/g, ""));
    } else if (tipo === "BIN\0") {
      bin = dados;
    }
    offset += 8 + n;
  }

  if (!json) throw new Error(path.basename(arquivo) + ": chunk JSON ausente");
  return { json, bin };
}

export function lerAccessor(gltf, bin, indice) {
  const acessor = gltf.accessors && gltf.accessors[indice];
  if (!acessor) throw new Error("accessor " + indice + " ausente");
  const meta = COMPONENTES[acessor.componentType];
  const nc = TIPOS[acessor.type];
  if (!meta || !nc) throw new Error("accessor " + indice + " com tipo não suportado");

  const out = new Float64Array(acessor.count * nc);
  if (acessor.bufferView === undefined || !bin) return out;

  const view = gltf.bufferViews[acessor.bufferView];
  const base = (view.byteOffset || 0) + (acessor.byteOffset || 0);
  const stride = acessor.byteStride || meta.bytes * nc;

  for (let i = 0; i < acessor.count; i += 1) {
    for (let c = 0; c < nc; c += 1) {
      out[i * nc + c] = lerScalar(bin, base + i * stride + c * meta.bytes, meta.Ctor);
    }
  }
  return out;
}

function diferenca(valorA, valorB, caminho) {
  if (caminho === "rotation") {
    /* quatérnios são xyzw; q e -q representam a mesma rotação */
    let ponto = 0;
    for (let i = 0; i < 4; i += 1) ponto += valorA[i] * valorB[i];
    return (2 * Math.acos(Math.min(1, Math.abs(ponto))) * 180) / Math.PI;
  }

  let delta = 0;
  for (let i = 0; i < valorA.length; i += 1) {
    delta = Math.max(delta, Math.abs(valorA[i] - valorB[i]));
  }
  return delta;
}

function classificar(razao, absoluto, angular) {
  const fechadoAbsoluto = angular
    ? absoluto <= TOLERANCIA.angularFechadoGraus
    : absoluto <= TOLERANCIA.linearFechadoM;
  const atencaoAbsoluto = angular
    ? absoluto <= TOLERANCIA.angularAtencaoGraus
    : absoluto <= TOLERANCIA.linearAtencaoM;

  /* O limite absoluto evita falso positivo de razão em trilhas quase paradas.
     A caminhada tem 2,1 mm de raiz e seria "fechada" por este limite, mas é
     uma exceção conhecida: `auditarDiretorio` a reclassifica como "atencao". */
  if (fechadoAbsoluto) return "fechado";
  if (razao <= TOLERANCIA.razaoFechado && atencaoAbsoluto) return "fechado";
  if (razao <= TOLERANCIA.razaoAtencao + 0.05 && atencaoAbsoluto) return "atencao";
  return "falha";
}

export function auditarClipe(arquivo) {
  const { json, bin } = lerGLB(arquivo);
  const animacoes = json.animations || [];
  let trilhas = 0;
  let duracao = 0;
  let inicio = Infinity;
  let fim = -Infinity;
  let maxAngularGraus = 0;
  let maxLinear = 0;
  let maxRazao = 0;
  let piorTrilha = null;
  const porTrilha = [];

  animacoes.forEach((animacao, indiceAnimacao) => {
    (animacao.channels || []).forEach(canal => {
      const sampler = animacao.samplers && animacao.samplers[canal.sampler];
      if (!sampler) return;
      const tempos = lerAccessor(json, bin, sampler.input);
      const valores = lerAccessor(json, bin, sampler.output);
      const nc = TIPOS[json.accessors[sampler.output].type];
      const quadros = tempos.length;
      if (!quadros || !nc) return;

      const caminho = (canal.target && canal.target.path) || "";
      const angular = caminho === "rotation";
      const delta = (a, b) => diferenca(a, b, caminho);
      const lerQuadro = i => valores.subarray(i * nc, i * nc + nc);

      let maiorPasso = 0;
      for (let i = 1; i < quadros; i += 1) {
        maiorPasso = Math.max(maiorPasso, delta(lerQuadro(i - 1), lerQuadro(i)));
      }
      const costura = quadros > 1 ? delta(lerQuadro(quadros - 1), lerQuadro(0)) : 0;

      inicio = Math.min(inicio, tempos[0]);
      fim = Math.max(fim, tempos[quadros - 1]);
      duracao = Math.max(duracao, tempos[quadros - 1] - tempos[0]);
      trilhas += 1;

      if (angular) maxAngularGraus = Math.max(maxAngularGraus, costura);
      else maxLinear = Math.max(maxLinear, costura);

      const movimentoMinimo = angular
        ? TOLERANCIA.movimentoMinimoAngularGraus
        : TOLERANCIA.movimentoMinimoLinearM;
      const razao = maiorPasso > movimentoMinimo ? costura / maiorPasso : 0;

      if (razao > maxRazao) {
        maxRazao = razao;
        const no = canal.target && canal.target.node;
        piorTrilha = {
          animacao: indiceAnimacao,
          caminho,
          no,
          noNome: json.nodes && json.nodes[no] ? json.nodes[no].name || null : null,
          costura: Number(costura.toFixed(4)),
          maiorPasso: Number(maiorPasso.toFixed(4)),
          razao: Number(razao.toFixed(4))
        };
      }

      if (razao > TOLERANCIA.razaoFechado || (!angular && costura > TOLERANCIA.linearFechadoM)) {
        porTrilha.push({
          animacao: indiceAnimacao,
          caminho,
          no: canal.target && canal.target.node,
          costura: Number(costura.toFixed(4)),
          maiorPasso: Number(maiorPasso.toFixed(4)),
          razao: Number(razao.toFixed(4))
        });
      }
    });
  });

  /* A classificação final usa o pior dos dois critérios (angular e linear). */
  const statusAngular = classificar(maxRazao, maxAngularGraus, true);
  const statusLinear = classificar(maxRazao, maxLinear, false);
  const ordem = { fechado: 0, atencao: 1, falha: 2 };
  const statusFinal = ordem[statusAngular] >= ordem[statusLinear] ? statusAngular : statusLinear;

  return {
    arquivo: path.basename(arquivo),
    animacoes: animacoes.length,
    trilhas,
    duracaoS: Number(duracao.toFixed(4)),
    inicioS: Number.isFinite(inicio) ? Number(inicio.toFixed(4)) : null,
    fimS: Number.isFinite(fim) ? Number(fim.toFixed(4)) : null,
    maxAngularGraus: Number(maxAngularGraus.toFixed(4)),
    maxLinear: Number(maxLinear.toFixed(6)),
    maxRazaoCostura: Number(maxRazao.toFixed(4)),
    piorTrilha,
    status: statusFinal,
    trilhasComDelta: porTrilha.slice(0, 8)
  };
}

export function auditarDiretorio(diretorio, opcoes = {}) {
  const arquivos = fs
    .readdirSync(diretorio)
    .filter(nome => nome.toLowerCase().endsWith(".glb"))
    .sort();
  const excecoes = opcoes.excecoes || EXCECOES_CONHECIDAS;
  const aplicadas = [];

  const porArquivo = {};
  arquivos.forEach(nome => {
    const item = auditarClipe(path.join(diretorio, nome));
    const excecao = excecoes[nome];
    if (excecao) {
      item.statusOriginal = item.status;
      if (item.status === "fechado") item.status = "atencao";
      item.excecao = {
        motivo: excecao.motivo,
        residualRaizM: item.piorTrilha && item.piorTrilha.caminho === "translation"
          ? item.piorTrilha.costura
          : null,
        noRaiz: (item.piorTrilha && item.piorTrilha.noNome) || excecao.noRaiz || null
      };
      aplicadas.push({ arquivo: nome, status: item.status, ...item.excecao });
    }
    porArquivo[nome] = item;
  });

  const resumo = {
    total: arquivos.length,
    fechados: 0,
    atencao: 0,
    falhas: 0
  };
  Object.values(porArquivo).forEach(item => {
    if (item.status === "fechado") resumo.fechados += 1;
    else if (item.status === "atencao") resumo.atencao += 1;
    else resumo.falhas += 1;
  });

  return { tolerancia: TOLERANCIA, resumo, excecoes: aplicadas, arquivos: porArquivo };
}
