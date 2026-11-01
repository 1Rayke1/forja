#!/usr/bin/env node
/*
  FORJA — folha de imagens de um clipe 3D.

  Gera um PNG com duas linhas (frente e perfil) e N colunas de fases do clipe,
  para olhar o movimento inteiro de uma vez — do primeiro ao último quadro.

  Usa o mesmo caminho do app: three.js vendorizado, GLTFLoader, `reamarrarFaixas`
  e AnimationMixer. O desenho é rasterizado na CPU (sem WebGL), igual ao
  `tools/renderizar-3d.mjs`; aqui a diferença é o layout em grade.

  Uso:
    node tools/folha-imagens-3d.mjs --clipe prancha --saida docs/validacao-3d/fase2/antes/prancha.png
    node tools/folha-imagens-3d.mjs --arquivo docs/.../candidatos/x.glb --clipe x --saida .../depois/x.png
    [--personagem masculino|feminino] [--fases 6] [--largura 240]
    [--enquadrar clipe]   emoldura o movimento inteiro (não só o repouso)
    [--chao]              desenha a linha do chão (y=0) e o eixo do personagem
    [--tempos 0,0.6,1.2]  fases em segundos (senão divide a duração em partes iguais)
*/
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { THREE, carregarGLB, catalogo3D, raiz } from "./lib/clipe-3d.mjs";

const argumentos = lista => {
  const saida = {};
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i];
    if (!item.startsWith("--")) continue;
    const chave = item.slice(2);
    const proximo = lista[i + 1];
    if (proximo && !proximo.startsWith("--")) {
      saida[chave] = proximo;
      i += 1;
    } else {
      saida[chave] = true;
    }
  }
  return saida;
};

const opcoes = argumentos(process.argv.slice(2));
const PERSONAGEM = opcoes.personagem || "masculino";
const FASES = Number(opcoes.fases || 6);
const TEMPOS = typeof opcoes.tempos === "string"
  ? opcoes.tempos.split(",").map(Number).filter(n => Number.isFinite(n))
  : null;
const LARGURA = Number(opcoes.largura || 240);
const ALTURA = Math.round(Number(opcoes.altura || 0) || LARGURA * 1.35);
const ESCALA = 2;
const fundo = [30, 38, 34];
const luzCor = [0.95, 0.92, 0.86];

const catalogo = catalogo3D();
const gltfPersonagem = await carregarGLB(catalogo.personagens[PERSONAGEM].arquivo);
const cena = gltfPersonagem.scene;

const clipeInformado = opcoes.clipe || path.basename(String(opcoes.saida || "clipe"), ".png");
const info = catalogo.clipes.find(clipe => clipe.id === clipeInformado);
const gltfClipe = await carregarGLB(opcoes.arquivo || (info && info.arquivo) || "");
const clipe = gltfClipe.animations && gltfClipe.animations[0];
if (!clipe) throw new Error("clipe sem animação");

/* mesmo caminho do app para casar faixas com ossos */
const cenaMod = await import(path.join(raiz, "assets/js/forja-3d-cena.js"));
const clipeCasado = cenaMod.reamarrarFaixas(clipe, cena);
const mixer = new THREE.AnimationMixer(cena);
const acao = mixer.clipAction(clipeCasado);
acao.play();

const ENQUADRAR = opcoes.enquadrar === "clipe" || opcoes.enquadrar === true;
const DESENHAR_CHAO = Boolean(opcoes.chao);

/* câmera: emoldura o personagem inteiro, com margem */
const caixa = new THREE.Box3();
cena.updateMatrixWorld(true);
cena.traverse(objeto => {
  if (!objeto.isSkinnedMesh || ENQUADRAR) return; /* enquadrar o clipe: repouso atrapalha */
  objeto.skeleton.bones.forEach(osso => caixa.expandByPoint(osso.getWorldPosition(new THREE.Vector3())));
  const posicao = objeto.geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < posicao.count; i += 1) {
    v.fromBufferAttribute(posicao, i);
    caixa.expandByPoint(objeto.localToWorld(v.clone()));
  }
});
/* com `--enquadrar clipe` a caixa cresce por todo o movimento (deitado, em pé,
   prancha), senão um clipe no chão sai fora do quadro */
if (ENQUADRAR) {
  const caixaMovimento = new THREE.Box3();
  const centroX = caixa.getCenter(new THREE.Vector3()).x;
  const centroZ = caixa.getCenter(new THREE.Vector3()).z;
  for (let i = 0; i < 16; i += 1) {
    mixer.setTime((clipe.duration * i) / 16);
    cena.updateMatrixWorld(true);
    cena.traverse(objeto => {
      if (!objeto.isBone) return;
      caixaMovimento.expandByPoint(objeto.getWorldPosition(new THREE.Vector3()));
    });
  }
  /* +0,26 cobre cabeça e mãos, que passam dos ossos; inclui o chão (y=0) */
  caixaMovimento.expandByScalar(0.26);
  caixaMovimento.expandByPoint(new THREE.Vector3(centroX, 0, centroZ));
  caixa.copy(caixaMovimento);
  mixer.setTime(0);
  cena.updateMatrixWorld(true);
}
const centro = caixa.getCenter(new THREE.Vector3());
const tamanho = caixa.getSize(new THREE.Vector3());
/* margem extra: o clipe pode erguer braços/pernas além da pose de repouso */
const raio = ENQUADRAR
  ? Math.max(tamanho.x, tamanho.y, tamanho.z) * 0.5
  : Math.max(tamanho.y * 0.62, tamanho.x * 0.6);

/* ------------------------------------------------------------------ */
/* Rasterizador simples (CPU)                                          */
/* ------------------------------------------------------------------ */

const alvo = (largura, altura, cor) => {
  const px = new Float32Array(largura * altura * 3);
  for (let i = 0; i < largura * altura; i += 1) {
    px[i * 3] = cor[0] / 255;
    px[i * 3 + 1] = cor[1] / 255;
    px[i * 3 + 2] = cor[2] / 255;
  }
  return { largura, altura, px, z: new Float32Array(largura * altura).fill(Infinity) };
};

function desenharTriangulo(img, a, b, c, cor, zbuf) {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(img.largura - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(img.altura - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const w0 = ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / area;
      const w1 = ((c.x - b.x) * (y - b.y) - (c.y - b.y) * (x - b.x)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = a.z * w2 + b.z * w1 + c.z * w0;
      const idx = y * img.largura + x;
      if (z >= zbuf[idx]) continue;
      zbuf[idx] = z;
      img.px[idx * 3] = cor[0];
      img.px[idx * 3 + 1] = cor[1];
      img.px[idx * 3 + 2] = cor[2];
    }
  }
}

function renderizarFase(azimute) {
  const img = alvo(LARGURA * ESCALA, ALTURA * ESCALA, fundo);
  const zbuf = img.z;
  const camera = new THREE.PerspectiveCamera(32, LARGURA / ALTURA, 0.05, 60);
  const fovV = (camera.fov * Math.PI) / 180;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * (LARGURA / ALTURA));
  const fovEfetivo = Math.min(fovV, fovH);
  /* enquadra a esfera envolvente: nada de cortar cabeça ou pé.
     Com `--enquadrar clipe` o encaixe é justo na caixa do movimento, medido na
     direção da câmera (senão um clipe deitado fica minúsculo no quadro). */
  let distancia;
  if (ENQUADRAR) {
    const direita = new THREE.Vector3(Math.cos(azimute), 0, -Math.sin(azimute));
    const meiaLargura = 0.5 * (
      tamanho.x * Math.abs(direita.x) + tamanho.z * Math.abs(direita.z)
    );
    const meiaAltura = 0.5 * tamanho.y;
    distancia = Math.max(
      meiaAltura / Math.tan(fovV / 2),
      meiaLargura / Math.tan(fovH / 2)
    ) * 1.10 + Math.max(meiaLargura, meiaAltura) * 0.5;
  } else {
    distancia = raio / Math.sin(fovEfetivo / 2) + tamanho.z * 0.5;
  }
  camera.position.set(
    centro.x + Math.sin(azimute) * distancia,
    centro.y + 0.03 * distancia,
    centro.z + Math.cos(azimute) * distancia
  );
  camera.lookAt(centro);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  cena.updateMatrixWorld(true);
  /* luz presa à câmera (headlight) + preenchimento de cima: as duas linhas
     ficam legíveis, sem uma vista escura */
  const luz = camera.position.clone().sub(centro).normalize().add(new THREE.Vector3(0, 0.8, 0)).normalize();
  cena.traverse(objeto => {
    if (!objeto.isSkinnedMesh) return;
    const malha = objeto;
    const posicao = malha.geometry.attributes.position;
    const normal = malha.geometry.attributes.normal;
    const indice = malha.geometry.index;
    const pontos = new Array(posicao.count);
    const normais = new Array(posicao.count);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < posicao.count; i += 1) {
      v.fromBufferAttribute(posicao, i);
      malha.applyBoneTransform(i, v);
      v.applyMatrix4(malha.matrixWorld);
      const p = v.clone().project(camera);
      pontos[i] = {
        x: ((p.x + 1) / 2) * img.largura,
        y: ((1 - p.y) / 2) * img.altura,
        z: p.z
      };
      if (normal) {
        n.fromBufferAttribute(normal, i).normalize();
        normais[i] = n.clone();
      }
    }
    const total = indice ? indice.count : posicao.count;
    for (let i = 0; i < total; i += 3) {
      const ia = indice ? indice.getX(i) : i;
      const ib = indice ? indice.getX(i + 1) : i + 1;
      const ic = indice ? indice.getX(i + 2) : i + 2;
      let sombra = 0.75;
      if (normais[ia]) {
        sombra = Math.max(0.42, normais[ia].dot(luz) * 0.45 + 0.62);
      }
      const cor = [luzCor[0] * sombra, luzCor[1] * sombra, luzCor[2] * sombra];
      desenharTriangulo(img, pontos[ia], pontos[ib], pontos[ic], cor, zbuf);
    }
  });

  /* linha do chão: sem ela não dá para julgar contato de pé e mão */
  if (DESENHAR_CHAO) {
    const projetar = p => {
      const q = p.clone().project(camera);
      return { x: ((q.x + 1) / 2) * img.largura, y: ((1 - q.y) / 2) * img.altura };
    };
    const traço = (a, b, cor) => {
      const n = 900;
      for (let i = 0; i <= n; i += 1) {
        const t = i / n;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        for (let dy = 0; dy < 3; dy += 1) {
          for (let dx = 0; dx < 3; dx += 1) {
            const px = Math.round(x) + dx - 1;
            const py = Math.round(y) + dy - 1;
            if (px < 0 || py < 0 || px >= img.largura || py >= img.altura) continue;
            const idx = (py * img.largura + px) * 3;
            img.px[idx] = cor[0];
            img.px[idx + 1] = cor[1];
            img.px[idx + 2] = cor[2];
          }
        }
      }
    };
    const cinza = [0.55, 0.62, 0.58];
    const escuro = [0.30, 0.36, 0.33];
    /* z=0 é o plano onde o personagem está em pé; x=0 é o eixo lateral */
    traço(projetar(new THREE.Vector3(-2.4, 0, 0)), projetar(new THREE.Vector3(2.4, 0, 0)), cinza);
    traço(projetar(new THREE.Vector3(0, 0, -2.4)), projetar(new THREE.Vector3(0, 0, 2.4)), escuro);
  }
  return img;
}

/* ------------------------------------------------------------------ */
/* PNG                                                                 */
/* ------------------------------------------------------------------ */

function escreverPNG(arquivo, largura, altura, cor) {
  const crcTabela = (() => {
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
    for (const b of buf) c = crcTabela[(c ^ b) & 0xff] ^ (c >>> 8);
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

/* ------------------------------------------------------------------ */
/* Composição da folha                                                 */
/* ------------------------------------------------------------------ */

const larguraFinal = LARGURA * (TEMPOS ? TEMPOS.length : FASES);
const alturaFinal = ALTURA * 2;
const folha = new Float32Array(larguraFinal * alturaFinal * 3).fill(0.12);

const totalColunas = TEMPOS ? TEMPOS.length : FASES;
for (const [linha, azimute] of [[0, Math.PI / 2], [1, opcoes.vista === "costas" ? Math.PI : 0]]) {
  for (let fase = 0; fase < totalColunas; fase += 1) {
    const t = TEMPOS ? TEMPOS[fase] : (clipe.duration * fase) / FASES;
    mixer.setTime(t);
    cena.updateMatrixWorld(true);
    const celula = renderizarFase(azimute);
    /* reduz 2× (supersampling) e cola na folha */
    for (let y = 0; y < ALTURA; y += 1) {
      for (let x = 0; x < LARGURA; x += 1) {
        const soma = [0, 0, 0];
        for (let dy = 0; dy < ESCALA; dy += 1) {
          for (let dx = 0; dx < ESCALA; dx += 1) {
            const i = ((y * ESCALA + dy) * celula.largura + (x * ESCALA + dx)) * 3;
            soma[0] += celula.px[i];
            soma[1] += celula.px[i + 1];
            soma[2] += celula.px[i + 2];
          }
        }
        const destino = ((linha * ALTURA + y) * larguraFinal + (fase * LARGURA + x)) * 3;
        folha[destino] = soma[0] / (ESCALA * ESCALA);
        folha[destino + 1] = soma[1] / (ESCALA * ESCALA);
        folha[destino + 2] = soma[2] / (ESCALA * ESCALA);
      }
    }
  }
}

const destino = opcoes.saida || path.join(raiz, "docs/validacao-3d/fase2/folhas", clipeInformado + ".png");
escreverPNG(destino, larguraFinal, alturaFinal, folha);
console.log("[folha]", JSON.stringify({
  clipe: clipeInformado,
  arquivo: opcoes.arquivo || (info && info.arquivo),
  personagem: PERSONAGEM,
  fases: totalColunas,
  tempos: TEMPOS || undefined,
  linhas: ["perfil", opcoes.vista === "costas" ? "costas" : "frente"],
  enquadrar: ENQUADRAR ? "clipe" : "repouso",
  chao: DESENHAR_CHAO,
  duracao: +clipe.duration.toFixed(2),
  png: path.relative(raiz, path.resolve(destino))
}));
