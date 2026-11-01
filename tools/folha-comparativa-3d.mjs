#!/usr/bin/env node
/*
  FORJA — folha comparativa: fonte de mocap × resultado transferido.

  Duas coisas lado a lado, nas mesmas fases do movimento:

    linha 1 e 2 — a ORIGEM (esqueleto de origem, em palitos);
    linha 3 e 4 — o RESULTADO (mesmo rig de 15 ossos do FORJA, em palitos).

  Frente nas linhas ímpares, perfil nas pares, e a linha do chão (y = 0)
  desenhada nas quatro. É assim que se enxerga o que a métrica diz: pé no chão,
  joelho/cotovelo dobrando na mesma hora, personagem virado, membro invertido.

  Palitos, e não a malha, de propósito: a comparação é de ESQUELETO — a malha
  esconde articulação errada atrás de volume.

  Uso:
    node tools/folha-comparativa-3d.mjs --origem tools/fontes-3d/16_Barbell_Curl_iclone.fbx \
      --inicio 15 --duracao 6 --saida docs/validacao-3d/fase3/rosca.png
    [--modo direcao|mundo|local|legado] [--personagem masculino|feminino]
    [--fases 6] [--largura 210]
*/
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const argumentos = lista => {
  const saida = {};
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i];
    if (!item.startsWith("--")) continue;
    const chave = item.slice(2);
    const proximo = lista[i + 1];
    if (proximo && !proximo.startsWith("--")) { saida[chave] = proximo; i += 1; }
    else saida[chave] = true;
  }
  return saida;
};

const opcoes = argumentos(process.argv.slice(2));
if (!opcoes.origem || !opcoes.saida) {
  console.error("uso: --origem <fbx|glb> --saida <png> [--inicio s] [--duracao s] [--modo direcao] [--personagem masculino] [--fases 6]");
  process.exit(2);
}

const MODO = opcoes.modo || "direcao";
const PERSONAGEM = opcoes.personagem || "masculino";
const FASES = Number(opcoes.fases || 6);
const LARGURA = Number(opcoes.largura || 210);
const ALTURA = Math.round(LARGURA * 1.4);
const INICIO = Number(opcoes.inicio || 0);
const DURACAO = Number(opcoes.duracao || 4);

const { THREE, HIERARQUIA, carregarPersonagem } = await import(path.join(raiz, "tools/lib/clipe-3d.mjs"));
const { carregarOrigem, prepararContexto, transferirMovimento } =
  await import(path.join(raiz, "tools/lib/retarget-3d.mjs"));

const origem = await carregarOrigem(opcoes.origem);
if (!origem.clipes.length) throw new Error("origem sem animação");
const clipe = origem.clipes.reduce((a, b) => (a.duration >= b.duration ? a : b));
const alvo = await carregarPersonagem(PERSONAGEM);
const contexto = prepararContexto({ cenaOrigem: origem.cena, ossosOrigem: origem.ossos, alvo, modo: MODO });
const { mapa, escala } = contexto;

/* ------------------------------------------------------------------ */
/* Amostragem: origem e resultado nas mesmas fases                     */
/* ------------------------------------------------------------------ */

const dur = Math.min(DURACAO, Math.max(0.2, clipe.duration - INICIO));

const mixerFonte = new THREE.AnimationMixer(origem.cena);
mixerFonte.clipAction(clipe).play();

const fontePorFase = [];
for (let fase = 0; fase < FASES; fase += 1) {
  const t = Math.min(INICIO + (dur * fase) / FASES, clipe.duration);
  mixerFonte.setTime(t);
  origem.cena.updateMatrixWorld(true);
  const posicoes = {};
  for (const [nome] of HIERARQUIA) {
    const p = origem.ossos.get(mapa[nome]).getWorldPosition(new THREE.Vector3()).multiplyScalar(escala);
    posicoes[nome] = p;
  }
  /* normaliza a altura: quadril da origem vai para a altura do quadril do alvo */
  const quadril = contexto.rest.hips.posDestino.y;
  const deslocamento = posicoes.hips.clone().multiply(new THREE.Vector3(1, 0, 1));
  for (const [nome] of HIERARQUIA) {
    posicoes[nome] = posicoes[nome].clone().sub(deslocamento).setY(posicoes[nome].y - posicoes.hips.y + quadril);
  }
  fontePorFase.push({ t: +t.toFixed(3), posicoes });
}

const dados = transferirMovimento({
  cenaOrigem: origem.cena, ossosOrigem: origem.ossos, alvo, contexto, clipeOrigem: clipe,
  modo: MODO, inicio: INICIO, duracao: DURACAO, fps: 24, apoiar: true
});

/* reconstrói as posições do resultado a partir das trilhas gravadas */
const resultadoPorFase = [];
for (let fase = 0; fase < FASES; fase += 1) {
  const indice = Math.min(dados.tempos.length - 1, Math.round((dados.tempos.length - 1) * fase / FASES));
  const quats = {};
  const hipsPos = new THREE.Vector3();
  for (const [nome, pai] of HIERARQUIA) {
    const trilha = dados.trilhas.find(t => t.osso === nome && t.caminho === "rotation");
    const base = indice * 4;
    quats[nome] = new THREE.Quaternion(trilha.valores[base], trilha.valores[base + 1], trilha.valores[base + 2], trilha.valores[base + 3]);
    if (nome === "hips") {
      const tp = dados.trilhas.find(t => t.osso === nome && t.caminho === "translation");
      hipsPos.set(tp.valores[indice * 3], tp.valores[indice * 3 + 1], tp.valores[indice * 3 + 2]);
    }
  }
  const posicoes = { hips: hipsPos.clone() };
  for (const [nome, pai] of HIERARQUIA) {
    if (!pai) continue;
    const deslocamento = contexto.deslocamentoRepouso[nome].clone().applyQuaternion(quats[pai]);
    posicoes[nome] = posicoes[pai].clone().add(deslocamento);
  }
  resultadoPorFase.push({ t: dados.tempos[indice], posicoes });
}

/* ------------------------------------------------------------------ */
/* Desenho                                                             */
/* ------------------------------------------------------------------ */

const LARGURA_FINAL = LARGURA * FASES;
const ALTURA_FINAL = ALTURA * 4;
const imagem = new Float32Array(LARGURA_FINAL * ALTURA_FINAL * 3).fill(0.11);

const AREA = { alturaMetros: 2.2 };

function projetar(vetor, azimute, celula) {
  /* ortográfica: frente (azimute 0) e perfil (azimute −90°) */
  const cosseno = Math.cos(azimute);
  const seno = Math.sin(azimute);
  const x = vetor.x * cosseno - vetor.z * seno;
  const y = vetor.y;
  const escalaPx = (celula.altura * 0.9) / AREA.alturaMetros;
  return {
    x: celula.x + celula.largura / 2 + x * escalaPx,
    y: celula.y + celula.altura * 0.94 - y * escalaPx
  };
}

function escreverPixel(x, y, cor) {
  if (x < 0 || y < 0 || x >= LARGURA_FINAL || y >= ALTURA_FINAL) return;
  const i = (Math.floor(y) * LARGURA_FINAL + Math.floor(x)) * 3;
  imagem[i] = cor[0];
  imagem[i + 1] = cor[1];
  imagem[i + 2] = cor[2];
}

function linha(a, b, cor, raio = 1.6) {
  const passos = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
  for (let i = 0; i <= passos; i += 1) {
    const x = a.x + ((b.x - a.x) * i) / passos;
    const y = a.y + ((b.y - a.y) * i) / passos;
    for (let dx = -raio; dx <= raio; dx += 1) {
      for (let dy = -raio; dy <= raio; dy += 1) {
        if (dx * dx + dy * dy <= raio * raio) escreverPixel(x + dx, y + dy, cor);
      }
    }
  }
}

const CORES = {
  osso: [0.90, 0.88, 0.82],
  articulacao: [1.0, 0.72, 0.35],
  chao: [0.30, 0.55, 0.42],
  separador: [0.20, 0.24, 0.22]
};

function desenharEsqueleto(posicoes, azimute, celula) {
  /* chão */
  const y0 = projetar(new THREE.Vector3(0, 0, 0), azimute, celula).y;
  linha({ x: celula.x + 4, y: y0 }, { x: celula.x + celula.largura - 4, y: y0 }, CORES.chao, 1);
  for (const [nome, pai] of HIERARQUIA) {
    if (!pai) continue;
    linha(projetar(posicoes[pai], azimute, celula), projetar(posicoes[nome], azimute, celula), CORES.osso, 1.5);
  }
  for (const [nome] of HIERARQUIA) {
    const p = projetar(posicoes[nome], azimute, celula);
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        if (dx * dx + dy * dy <= 4) escreverPixel(p.x + dx, p.y + dy, CORES.articulacao);
      }
    }
  }
}

for (let linhaIndice = 0; linhaIndice < 4; linhaIndice += 1) {
  const ehFonte = linhaIndice < 2;
  const azimute = linhaIndice % 2 === 0 ? 0 : -Math.PI / 2;
  for (let fase = 0; fase < FASES; fase += 1) {
    const celula = {
      x: fase * LARGURA,
      y: linhaIndice * ALTURA,
      largura: LARGURA,
      altura: ALTURA
    };
    const serie = ehFonte ? fontePorFase : resultadoPorFase;
    desenharEsqueleto(serie[fase].posicoes, azimute, celula);
  }
}

/* separadores */
for (let linhaIndice = 1; linhaIndice < 4; linhaIndice += 1) {
  for (let x = 0; x < LARGURA_FINAL; x += 1) {
    for (let d = 0; d < 2; d += 1) escreverPixel(x, linhaIndice * ALTURA + d, CORES.separador);
  }
}
for (let fase = 1; fase < FASES; fase += 1) {
  for (let y = 0; y < ALTURA_FINAL; y += 1) {
    for (let d = 0; d < 1; d += 1) escreverPixel(fase * LARGURA + d, y, CORES.separador);
  }
}

/* ------------------------------------------------------------------ */
/* PNG                                                                 */
/* ------------------------------------------------------------------ */

function escreverPNG(arquivo, largura, altura, cor) {
  const tabela = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc = buf => {
    let c = -1;
    for (const b of buf) c = tabela[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const bloco = (tipo, dados) => {
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length, 0);
    const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
    const verificacao = Buffer.alloc(4);
    verificacao.writeUInt32BE(crc(corpo), 0);
    return Buffer.concat([tamanho, corpo, verificacao]);
  };
  const linhas = Buffer.alloc((largura * 3 + 1) * altura);
  for (let y = 0; y < altura; y += 1) {
    linhas[y * (largura * 3 + 1)] = 0;
    for (let x = 0; x < largura; x += 1) {
      const i = (y * largura + x) * 3;
      linhas[y * (largura * 3 + 1) + 1 + x * 3] = Math.max(0, Math.min(255, Math.round(cor[i] * 255)));
      linhas[y * (largura * 3 + 1) + 2 + x * 3] = Math.max(0, Math.min(255, Math.round(cor[i + 1] * 255)));
      linhas[y * (largura * 3 + 1) + 3 + x * 3] = Math.max(0, Math.min(255, Math.round(cor[i + 2] * 255)));
    }
  }
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", (() => {
      const b = Buffer.alloc(13);
      b.writeUInt32BE(largura, 0);
      b.writeUInt32BE(altura, 4);
      b[8] = 8;
      b[9] = 2;
      return b;
    })()),
    bloco("IDAT", zlib.deflateSync(linhas, { level: 9 })),
    bloco("IEND", Buffer.alloc(0))
  ]));
}

escreverPNG(opcoes.saida, LARGURA_FINAL, ALTURA_FINAL, imagem);
console.log("[comparar]", JSON.stringify({
  origem: path.basename(opcoes.origem),
  personagem: PERSONAGEM,
  modo: MODO,
  fases: FASES,
  janela: { inicio: INICIO, duracao: +dur.toFixed(2) },
  png: path.relative(raiz, path.resolve(opcoes.saida)),
  diagnostico: dados.diagnostico
}));
