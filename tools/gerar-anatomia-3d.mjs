#!/usr/bin/env node
/*
  FORJA — Gerador offline das pranchas anatômicas 3D e contornos SVG projetados
  (BodyParts3D + Z-Anatomy, CC BY-SA 2.1 JP / CC BY-SA 4.0).

  Este utilitário de desenvolvimento (não carregado pelo cliente em produção)
  reproduz integralmente:
    1. A extração e o alinhamento da casca craniofacial externa (`FMA7163.stl`
       do BodyParts3D → `bp3d/head_outer.bin`) sobre os sistemas muscular
       (`kas.glb`), esquelético (`iskelet.glb`) e articular (`eklem.glb`) do
       Z-Anatomy.
    2. A renderização ortográfica simétrica em 480 × 1040 px (2× Retina sobre
       `viewBox="0 0 240 520"`), comprimida em PNG indexado de 8 bits com
       transparência limpa (`assets/anatomia/anterior.png` e `posterior.png`).
    3. A extração automática dos contornos SVG das 16 regiões musculares do
       catálogo (buffer de profundidade WebGL + Marching Squares orientado +
       simplificação Ramer-Douglas-Peucker + curvas de Bézier cúbicas fechadas),
       atualizando `assets/js/forja-figura.js` quando executado com `--contornos`.

  Fontes esperadas em ANATOMY_SRC_DIR (padrão: /tmp/anatomy_src):
    - zanatomy/systems/{kas.glb, iskelet.glb, eklem.glb}  (Z-Anatomy, CC BY-SA 4.0)
    - zanatomy/vendor/three/                              (Three.js r185 local)
    - bp3d/FMA7163.stl ou bp3d/head_outer.bin             (BodyParts3D, CC BY-SA 2.1 JP)

  Uso:
    ANATOMY_SRC_DIR=/caminho/fontes node tools/gerar-anatomia-3d.mjs
    ANATOMY_SRC_DIR=/caminho/fontes node tools/gerar-anatomia-3d.mjs --contornos
*/

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const srcDir = process.env.ANATOMY_SRC_DIR || "/tmp/anatomy_src";
const updateContours = process.argv.includes("--contornos");

const W = 480;
const H = 1040;
const SCALE_X = 240 / W;
const SCALE_Y = 520 / H;

const META = [
  ["ombros", "Ombros", ["front", "back"]],
  ["peito", "Peitoral", ["front"]],
  ["biceps", "Bíceps", ["front"]],
  ["antebracos", "Antebraços", ["front", "back"]],
  ["abdomem", "Abdômen", ["front"]],
  ["obliquos", "Oblíquos", ["front"]],
  ["quadril", "Quadril", ["front"]],
  ["quadriceps", "Quadríceps", ["front"]],
  ["pernas", "Pernas", ["front", "back"]],
  ["costas", "Costas", ["back"]],
  ["dorsais", "Dorsais", ["back"]],
  ["triceps", "Tríceps", ["back"]],
  ["lombar", "Lombar", ["back"]],
  ["gluteos", "Glúteos", ["back"]],
  ["posterior-coxa", "Posterior de coxa", ["back"]],
  ["panturrilha", "Panturrilha", ["back"]]
];

function ensureHeadOuterBin(baseDir) {
  const headBinPath = path.join(baseDir, "bp3d", "head_outer.bin");
  if (fs.existsSync(headBinPath)) return headBinPath;

  const stlPath = path.join(baseDir, "bp3d", "FMA7163.stl");
  if (!fs.existsSync(stlPath)) {
    throw new Error("Ausente bp3d/FMA7163.stl (BodyParts3D envelope cutâneo) ou bp3d/head_outer.bin em " + baseDir);
  }

  console.log("Extraindo casca craniofacial externa de FMA7163.stl...");
  const buf = fs.readFileSync(stlPath);
  const triCount = buf.readUInt32LE(80);
  const vMap = new Map();
  const sPosArr = [];
  const sIdx = new Uint32Array(triCount * 3);

  for (let t = 0; t < triCount; t++) {
    const off = 84 + t * 50;
    for (let k = 0; k < 3; k++) {
      const vo = off + 12 + k * 12;
      const bx = buf.readFloatLE(vo);
      const by = buf.readFloatLE(vo + 4);
      const bz = buf.readFloatLE(vo + 8);
      // Coordenadas BodyParts3D (mm, Z-up) -> sistema glTF Z-Anatomy (m, Y-up)
      const gx = bx * 0.001;
      const gy = (bz + 75.0) * 0.001;
      const gz = (-by - 103.5) * 0.001;
      const key = `${Math.round(gx * 20000)},${Math.round(gy * 20000)},${Math.round(gz * 20000)}`;
      let vi = vMap.get(key);
      if (vi === undefined) {
        vi = sPosArr.length / 3;
        vMap.set(key, vi);
        sPosArr.push(gx, gy, gz);
      }
      sIdx[t * 3 + k] = vi;
    }
  }

  const svCount = sPosArr.length / 3;
  const sPos = Float32Array.from(sPosArr);
  const sNrm = new Float32Array(svCount * 3);
  for (let i = 0; i < sIdx.length; i += 3) {
    const a = sIdx[i] * 3, b = sIdx[i + 1] * 3, c = sIdx[i + 2] * 3;
    const ux = sPos[b] - sPos[a], uy = sPos[b + 1] - sPos[a + 1], uz = sPos[b + 2] - sPos[a + 2];
    const vx = sPos[c] - sPos[a], vy = sPos[c + 1] - sPos[a + 1], vz = sPos[c + 2] - sPos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    sNrm[a] += nx; sNrm[a + 1] += ny; sNrm[a + 2] += nz;
    sNrm[b] += nx; sNrm[b + 1] += ny; sNrm[b + 2] += nz;
    sNrm[c] += nx; sNrm[c + 1] += ny; sNrm[c + 2] += nz;
  }
  for (let i = 0; i < sNrm.length; i += 3) {
    const l = Math.hypot(sNrm[i], sNrm[i + 1], sNrm[i + 2]) || 1;
    sNrm[i] /= l; sNrm[i + 1] /= l; sNrm[i + 2] /= l;
  }

  const headVertMap = new Map();
  const hPos = [], hNrm = [], hIdx = [];
  for (let i = 0; i < sIdx.length; i += 3) {
    const ia = sIdx[i], ib = sIdx[i + 1], ic = sIdx[i + 2];
    const ym = (sPos[ia * 3 + 1] + sPos[ib * 3 + 1] + sPos[ic * 3 + 1]) / 3;
    if (ym < 1.44) continue;
    const xm = (sPos[ia * 3] + sPos[ib * 3] + sPos[ic * 3]) / 3;
    const zm = (sPos[ia * 3 + 2] + sPos[ib * 3 + 2] + sPos[ic * 3 + 2]) / 3;
    const rx = xm, ry = (ym - 1.56) * 0.5, rz = zm + 0.005;
    const rl = Math.hypot(rx, ry, rz) || 1;
    const nx = (sNrm[ia * 3] + sNrm[ib * 3] + sNrm[ic * 3]) / 3;
    const ny = (sNrm[ia * 3 + 1] + sNrm[ib * 3 + 1] + sNrm[ic * 3 + 1]) / 3;
    const nz = (sNrm[ia * 3 + 2] + sNrm[ib * 3 + 2] + sNrm[ic * 3 + 2]) / 3;
    if ((rx * nx + ry * ny + rz * nz) / rl < 0.10) continue;

    for (const vi of [ia, ib, ic]) {
      let ni = headVertMap.get(vi);
      if (ni === undefined) {
        ni = hPos.length / 3;
        headVertMap.set(vi, ni);
        const bz = sPos[vi * 3 + 1] * 1000 - 75.0;
        const gyTrue = 0.0064 + (bz + 13.48) * (1.7001 / 1655.02);
        const expand = gyTrue > 1.50 ? 1.022 : 1.0;
        hPos.push(sPos[vi * 3] * expand, gyTrue, (sPos[vi * 3 + 2] - 0.003) * expand);
        hNrm.push(sNrm[vi * 3], sNrm[vi * 3 + 1], sNrm[vi * 3 + 2]);
      }
      hIdx.push(ni);
    }
  }

  const hvCount = hPos.length / 3, hiCount = hIdx.length;
  const out = Buffer.allocUnsafe(8 + hvCount * 24 + hiCount * 4);
  out.writeUInt32LE(hvCount, 0);
  out.writeUInt32LE(hiCount, 4);
  new Float32Array(out.buffer, out.byteOffset + 8, hvCount * 3).set(hPos);
  new Float32Array(out.buffer, out.byteOffset + 8 + hvCount * 12, hvCount * 3).set(hNrm);
  new Uint32Array(out.buffer, out.byteOffset + 8 + hvCount * 24, hiCount).set(hIdx);
  fs.mkdirSync(path.dirname(headBinPath), { recursive: true });
  fs.writeFileSync(headBinPath, out);
  return headBinPath;
}

const CLIENT_JS = `import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const W = 480, H = 1040;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);

async function loadBinMesh(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  const vCount = dv.getUint32(0, true);
  const iCount = dv.getUint32(4, true);
  const pos = new Float32Array(buf, 8, vCount * 3);
  const nrm = new Float32Array(buf, 8 + vCount * 12, vCount * 3);
  const idx = new Uint32Array(buf, 8 + vCount * 24, iCount);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geom.setIndex(new THREE.BufferAttribute(idx, 1));
  return geom;
}

function makeStudioLights(scene, dirSign) {
  scene.add(new THREE.HemisphereLight(0xe4ece6, 0x1a201c, 0.84));
  const key = new THREE.DirectionalLight(0xf7fbf5, 1.52);
  key.position.set(dirSign * 1.35, 2.3, dirSign * 2.9);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb2c0b7, 0.68);
  fill.position.set(-dirSign * 1.9, 1.0, dirSign * 2.1);
  scene.add(fill);
  const rimL = new THREE.DirectionalLight(0xd2e2d7, 0.60);
  rimL.position.set(2.6, 1.4, -dirSign * 1.8);
  scene.add(rimL);
  const rimR = new THREE.DirectionalLight(0xd2e2d7, 0.60);
  rimR.position.set(-2.6, 1.4, -dirSign * 1.8);
  scene.add(rimR);
  const under = new THREE.DirectionalLight(0x6e7c74, 0.28);
  under.position.set(0, -1.6, dirSign * 1.4);
  scene.add(under);
}

function makeOrthoCam(minY, maxY, minHalfWidth, view) {
  const padY = 0.038;
  const bottom = minY - padY, top = maxY + padY;
  const midY = (top + bottom) / 2;
  let hh = (top - bottom) / 2;
  let hw = hh * (W / H);
  if (hw < minHalfWidth) { hw = minHalfWidth; hh = hw * (H / W); }
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.05, 10);
  cam.position.set(0, midY, view === "front" ? 3.0 : -3.0);
  cam.lookAt(0, midY, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

function readRedMask() {
  const gl = renderer.getContext();
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const srcRow = (H - 1 - y) * W * 4, dstRow = y * W;
    for (let x = 0; x < W; x++) out[dstRow + x] = px[srcRow + x * 4];
  }
  return Array.from(out);
}

function getFullAncestryName(obj) {
  const parts = [];
  for (let cur = obj; cur; cur = cur.parent) {
    if (cur.name) parts.push(cur.name.replace(/_/g, " "));
  }
  return parts.join(" | ");
}

const loader = new GLTFLoader();
const loadGLB = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));

window.buildBP3D = async () => {
  const [kasGltf, skelGltf, eklemGltf, headGeom] = await Promise.all([
    loadGLB("/zanatomy/systems/kas.glb"),
    loadGLB("/zanatomy/systems/iskelet.glb"),
    loadGLB("/zanatomy/systems/eklem.glb"),
    loadBinMesh("/bp3d/head_outer.bin")
  ]);

  const KEEP_SPECIAL = /posterior layer of thoracolumbar fascia|linea alba|calcaneal tendon|iliotibial tract/i;
  const HIDE_MUSCLE = /fascia|aponeuros|retinacul|bursa|septum|sheath|platysma|diaphragm|perine|sphincter|coccyge|pubo|levator ani/i;
  const TENDON_RE = /tendon|linea alba|iliotibial|posterior layer of thoracolumbar fascia/i;
  const HEAD_MUSCLE_RE = /frontalis|temporalis|occipitalis|orbicularis|zygomatic|masseter|pterygoid|bucinator|risorius|nasalis|procerus|corrugator|depressor|levator labii|levator anguli|levator nasolab|levator palpeb|mentalis|(superior|inferior|medial|lateral) rectus muscle|(superior|inferior) oblique muscle|trochlea of superior|tarsus/i;

  const muscleMat = new THREE.MeshStandardMaterial({ color: 0x7a857e, roughness: 0.60, metalness: 0.06, side: THREE.DoubleSide });
  const tendonMat = new THREE.MeshStandardMaterial({ color: 0x939f97, roughness: 0.54, metalness: 0.05, side: THREE.DoubleSide });
  const boneMat = new THREE.MeshStandardMaterial({ color: 0x626b65, roughness: 0.70, metalness: 0.04 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x6c7670, roughness: 0.65, metalness: 0.04 });

  const headLinear = new THREE.Color(0x78837c);
  const hp = headGeom.getAttribute("position");
  const hc = new Float32Array(hp.count * 4);
  for (let i = 0; i < hp.count; i++) {
    let x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
    if (y < 1.525) {
      const neckT = Math.max(0, Math.min(1, (1.525 - y) / 0.065));
      x *= 1 - 0.16 * neckT;
      z *= 1 - 0.10 * neckT;
      hp.setXYZ(i, x, y, z);
    }
    const cutLow = z < -0.01 ? 1.500 : 1.472;
    const cutHigh = z < -0.01 ? 1.535 : 1.508;
    const t = Math.max(0, Math.min(1, (y - cutLow) / (cutHigh - cutLow)));
    const a = t * t * (3 - 2 * t);
    hc[i * 4] = headLinear.r; hc[i * 4 + 1] = headLinear.g; hc[i * 4 + 2] = headLinear.b; hc[i * 4 + 3] = a;
  }
  headGeom.computeVertexNormals();
  headGeom.setAttribute("color", new THREE.BufferAttribute(hc, 4));
  const headMesh = new THREE.Mesh(headGeom, new THREE.MeshStandardMaterial({
    vertexColors: true, transparent: true, roughness: 0.62, metalness: 0.05
  }));

  const visibleMeshes = [];
  const kasMeshes = [];

  kasGltf.scene.traverse(obj => {
    if (!obj.isMesh) return;
    const fullName = getFullAncestryName(obj);
    if (HEAD_MUSCLE_RE.test(fullName) || (!KEEP_SPECIAL.test(fullName) && HIDE_MUSCLE.test(fullName))) {
      obj.visible = false; return;
    }
    obj.geometry.computeVertexNormals();
    const studioMat = TENDON_RE.test(fullName) ? tendonMat : muscleMat;
    obj.material = studioMat;
    kasMeshes.push({ obj, fullName, studioMat });
    visibleMeshes.push({ obj, studioMat });
  });

  skelGltf.scene.traverse(obj => {
    if (!obj.isMesh) return;
    const nm = getFullAncestryName(obj);
    if (/tooth|teeth|mandible|maxilla|nasal|frontal|parietal|temporal|occipital|sphenoid|ethmoid|zygomatic|lacrimal|vomer|hyoid|incus|malleus|stapes|concha|palatine/i.test(nm)) {
      obj.visible = false; return;
    }
    obj.geometry.computeVertexNormals();
    obj.material = boneMat;
    visibleMeshes.push({ obj, studioMat: boneMat });
  });

  eklemGltf.scene.traverse(obj => {
    if (!obj.isMesh) return;
    const nm = getFullAncestryName(obj);
    if (/temporomandib|alar|nasal|septal|laryng|cricoid|thyroid|arytenoid|epiglott|stylohyoid|sphenomandib/i.test(nm)) {
      obj.visible = false; return;
    }
    obj.geometry.computeVertexNormals();
    obj.material = jointMat;
    visibleMeshes.push({ obj, studioMat: jointMat });
  });

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  const images = {};
  for (const view of ["front", "back"]) {
    const scene = new THREE.Scene();
    makeStudioLights(scene, view === "front" ? 1 : -1);
    scene.add(skelGltf.scene, eklemGltf.scene, kasGltf.scene, headMesh);
    const cam = makeOrthoCam(0.005, 1.71, 0.365, view);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    images[view] = renderer.domElement.toDataURL("image/png");
  }

  renderer.toneMapping = THREE.NoToneMapping;
  const blackMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  const whiteMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
  });

  function makeRuleMaterial(rule, sideSign = 0) {
    const planes = [];
    if (rule.yMin !== undefined) planes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -rule.yMin));
    if (rule.yMax !== undefined) planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), rule.yMax));
    if (rule.maxAbsX !== undefined) {
      planes.push(new THREE.Plane(new THREE.Vector3(1, 0, 0), rule.maxAbsX));
      planes.push(new THREE.Plane(new THREE.Vector3(-1, 0, 0), rule.maxAbsX));
    }
    if (rule.minAbsX !== undefined && sideSign !== 0) {
      planes.push(new THREE.Plane(new THREE.Vector3(sideSign, 0, 0), -rule.minAbsX));
    }
    if (rule.latBellyClip && sideSign !== 0) {
      const n = new THREE.Vector3(sideSign * 1.45, 1, 0).normalize();
      planes.push(new THREE.Plane(n, -1.155 / Math.hypot(1.45, 1)));
    }
    return new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.DoubleSide, clippingPlanes: planes,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    });
  }

  const REGION_RULES = {
    front: {
      ombros: { re: /clavicular part of deltoid|acromial part of deltoid/i },
      peito: { re: /pectoralis major/i },
      biceps: { re: /biceps brachii|brachialis muscle|coracobrachialis/i },
      antebracos: { re: /brachioradialis|flexor carpi|palmaris longus|pronator teres|flexor digitorum superficialis|flexor digitorum profundus|flexor pollicis longus/i, yMin: 0.855, maxAbsX: 0.255 },
      abdomem: { re: /rectus abdominis|pyramidalis muscle|linea alba/i, hideOccluders: /external abdominal oblique|internal abdominal oblique/i, yMin: 0.875, yMax: 1.245 },
      obliquos: { re: /external abdominal oblique/i, exclude: /inguinal ligament/i, minAbsX: 0.056, yMin: 0.88, yMax: 1.23 },
      quadril: { re: /tensor fasciae latae|iliacus|psoas major|pectineus|adductor brevis|adductor longus/i, yMin: 0.73, yMax: 1.00 },
      quadriceps: { re: /rectus femoris|vastus lateralis|vastus medialis|vastus intermedius/i },
      pernas: { re: /rectus femoris|vastus lateralis|vastus medialis|sartorius|tensor fasciae latae|pectineus|adductor longus|gracilis|tibialis anterior|extensor digitorum longus|fibularis longus|fibularis brevis|gastrocnemius|soleus/i, yMin: 0.088 }
    },
    back: {
      ombros: { re: /spinal part of deltoid|acromial part of deltoid/i },
      costas: { re: /trapezius|rhomboid|infraspinatus|teres minor|levator scapulae/i, yMax: 1.488 },
      dorsais: { re: /latissimus dorsi|teres major/i, latBellyClip: true },
      lombar: { re: /posterior layer of thoracolumbar fascia|iliocostalis lumborum|longissimus thoracis|multifidus lumborum|quadratus lumborum/i, hideOccluders: /latissimus dorsi|trapezius|serratus posterior inferior/i, yMin: 0.965, yMax: 1.165, maxAbsX: 0.082 },
      triceps: { re: /triceps brachii|anconeus/i },
      antebracos: { re: /brachioradialis|extensor carpi|extensor digitorum|extensor digiti minimi|abductor pollicis longus|extensor pollicis/i, exclude: /extensor digitorum longus|extensor digitorum brevis/i, yMin: 0.855, maxAbsX: 0.255 },
      gluteos: { re: /gluteus maximus|gluteus medius|gluteus minimus/i },
      "posterior-coxa": { re: /biceps femoris|semitendinosus|semimembranosus/i },
      panturrilha: { re: /gastrocnemius|soleus|plantaris muscle|calcaneal tendon/i, yMin: 0.095 },
      pernas: { re: /biceps femoris|semitendinosus|semimembranosus|gracilis|adductor magnus|iliotibial tract|gastrocnemius|soleus|plantaris muscle|calcaneal tendon|fibularis longus|fibularis brevis|tibialis posterior|popliteus/i, yMin: 0.088 }
    }
  };

  const masks = { front: {}, back: {}, silhouette: {} };
  for (const view of ["front", "back"]) {
    const scene = new THREE.Scene();
    scene.add(skelGltf.scene, eklemGltf.scene, kasGltf.scene, headMesh);
    const cam = makeOrthoCam(0.005, 1.71, 0.365, view);
    renderer.setClearColor(0x000000, 1);

    visibleMeshes.forEach(m => { m.obj.visible = true; m.obj.material = whiteMat; });
    headMesh.visible = true;
    headMesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, alphaTest: 0.45 });
    renderer.render(scene, cam);
    masks.silhouette[view] = readRedMask();

    for (const [regionId, rule] of Object.entries(REGION_RULES[view])) {
      visibleMeshes.forEach(m => { m.obj.visible = true; m.obj.material = blackMat; });
      headMesh.visible = true;
      headMesh.material = blackMat;
      if (rule.hideOccluders) {
        for (const km of kasMeshes) {
          if (rule.hideOccluders.test(km.fullName) && !rule.re.test(km.fullName)) km.obj.visible = false;
        }
      }
      if (rule.minAbsX !== undefined || rule.latBellyClip) {
        const combined = new Uint8Array(W * H);
        for (const sideSign of [-1, 1]) {
          const mat = makeRuleMaterial(rule, sideSign);
          for (const km of kasMeshes) {
            if (rule.re.test(km.fullName) && (!rule.exclude || !rule.exclude.test(km.fullName))) km.obj.material = mat;
          }
          renderer.render(scene, cam);
          const half = readRedMask();
          for (let i = 0; i < combined.length; i++) if (half[i] > combined[i]) combined[i] = half[i];
        }
        masks[view][regionId] = Array.from(combined);
      } else {
        const activeMat = makeRuleMaterial(rule, 0);
        for (const km of kasMeshes) {
          if (rule.re.test(km.fullName) && (!rule.exclude || !rule.exclude.test(km.fullName))) km.obj.material = activeMat;
        }
        renderer.render(scene, cam);
        masks[view][regionId] = readRedMask();
      }
      visibleMeshes.forEach(m => { m.obj.visible = true; });
    }
  }
  return { images, masks };
};
`;

function blurMask(src, w, h, radius = 2) {
  if (radius <= 0) return Float32Array.from(src);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const diam = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += src[row + Math.max(0, Math.min(w - 1, x + k))];
      tmp[row + x] = s / diam;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += tmp[Math.max(0, Math.min(h - 1, y + k)) * w + x];
      out[y * w + x] = s / diam;
    }
  }
  return out;
}

function marchingSquares(field, w, h, threshold = 110) {
  const f = Float32Array.from(field);
  for (let x = 0; x < w; x++) { f[x] = 0; f[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { f[y * w] = 0; f[y * w + (w - 1)] = 0; }

  const segs = [];
  const interp = (v1, v2) => {
    const d = v2 - v1;
    return Math.abs(d) < 1e-5 ? 0.5 : Math.max(0.02, Math.min(0.98, (threshold - v1) / d));
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v0 = f[y * w + x], v1 = f[y * w + x + 1], v2 = f[(y + 1) * w + x + 1], v3 = f[(y + 1) * w + x];
      const c = (v0 >= threshold ? 8 : 0) | (v1 >= threshold ? 4 : 0) | (v2 >= threshold ? 2 : 0) | (v3 >= threshold ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const top = [x + interp(v0, v1), y], right = [x + 1, y + interp(v1, v2)];
      const bottom = [x + interp(v3, v2), y + 1], left = [x, y + interp(v0, v3)];
      const center = (v0 + v1 + v2 + v3) * 0.25 >= threshold;
      switch (c) {
        case 1:  segs.push([left, bottom]); break;
        case 2:  segs.push([bottom, right]); break;
        case 3:  segs.push([left, right]); break;
        case 4:  segs.push([right, top]); break;
        case 5:  if (center) { segs.push([left, top], [bottom, right]); } else { segs.push([left, bottom], [right, top]); } break;
        case 6:  segs.push([bottom, top]); break;
        case 7:  segs.push([left, top]); break;
        case 8:  segs.push([top, left]); break;
        case 9:  segs.push([top, bottom]); break;
        case 10: if (center) { segs.push([top, right], [bottom, left]); } else { segs.push([top, left], [bottom, right]); } break;
        case 11: segs.push([top, right]); break;
        case 12: segs.push([right, left]); break;
        case 13: segs.push([right, bottom]); break;
        case 14: segs.push([bottom, left]); break;
      }
    }
  }
  const key = p => `${Math.round(p[0] * 64)},${Math.round(p[1] * 64)}`;
  const startMap = new Map();
  segs.forEach((s, idx) => {
    const k = key(s[0]);
    if (!startMap.has(k)) startMap.set(k, []);
    startMap.get(k).push(idx);
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const poly = [segs[i][0], segs[i][1]];
    while (true) {
      const list = startMap.get(key(poly[poly.length - 1]));
      if (!list) break;
      let nextIdx = -1;
      for (const cand of list) { if (!used[cand]) { nextIdx = cand; break; } }
      if (nextIdx === -1) break;
      used[nextIdx] = 1;
      poly.push(segs[nextIdx][1]);
    }
    if (poly.length > 4) loops.push(poly);
  }
  return loops;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a * 0.5;
}

function simplifyRDP(pts, eps) {
  if (pts.length <= 3) return pts;
  let maxDist = 0, idx = 0;
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const t = len2 > 1e-8 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
    const dist = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    if (dist > maxDist) { maxDist = dist; idx = i; }
  }
  if (maxDist > eps) {
    return simplifyRDP(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplifyRDP(pts.slice(idx), eps));
  }
  return [pts[0], pts[pts.length - 1]];
}

function simplifyClosedLoop(loop, eps = 1.05) {
  const pts = loop.slice(0, -1);
  if (pts.length < 6) return pts;
  let farIdx = 1, maxD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > maxD) { maxD = d; farIdx = i; }
  }
  const h1 = simplifyRDP(pts.slice(0, farIdx + 1), eps);
  const h2 = simplifyRDP(pts.slice(farIdx).concat([pts[0]]), eps);
  return h1.slice(0, -1).concat(h2.slice(0, -1));
}

function closedBezierPath(loops, tension = 0.19) {
  const parts = [];
  const f = v => Number(v.toFixed(1));
  for (const pts of loops) {
    const n = pts.length;
    if (n < 3) continue;
    const sp = pts.map(([x, y]) => [x * SCALE_X, y * SCALE_Y]);
    let d = `M${f(sp[0][0])} ${f(sp[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = sp[(i - 1 + n) % n], p1 = sp[i], p2 = sp[(i + 1) % n], p3 = sp[(i + 2) % n];
      d += `C${f(p1[0] + (p2[0] - p0[0]) * tension)} ${f(p1[1] + (p2[1] - p0[1]) * tension)} ` +
           `${f(p2[0] - (p3[0] - p1[0]) * tension)} ${f(p2[1] - (p3[1] - p1[1]) * tension)} ` +
           `${f(p2[0])} ${f(p2[1])}`;
    }
    parts.push(d + "Z");
  }
  return parts.join("");
}

export function maskToSvgPath(maskBytes, opts = {}) {
  const { blurRadius = 2, threshold = 96, minArea = 18, rdpEps = 1.05 } = opts;
  const blurred = blurMask(maskBytes, W, H, blurRadius);
  const cleanLoops = [];
  for (const loop of marchingSquares(blurred, W, H, threshold)) {
    if (Math.abs(polyArea(loop)) < minArea) continue;
    const simp = simplifyClosedLoop(loop, rdpEps);
    if (simp.length >= 3) cleanLoops.push(simp);
  }
  return closedBezierPath(cleanLoops, 0.19);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}

function decodeRgbaPng(buf) {
  let off = 8, w = 0, h = 0;
  const idats = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString("ascii");
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === "IDAT") idats.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const rgba = new Uint8Array(w * h * 4);
  const stride = w * 4;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
  };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= 4 ? rgba[dst + x - 4] : 0;
      const b = y > 0 ? rgba[dst - stride + x] : 0;
      const c = (x >= 4 && y > 0) ? rgba[dst - stride + x - 4] : 0;
      rgba[dst + x] = f === 1 ? (v + a) & 255 : f === 2 ? (v + b) & 255 : f === 3 ? (v + ((a + b) >> 1)) & 255 : f === 4 ? (v + paeth(a, b, c)) & 255 : v;
    }
  }
  return { w, h, rgba };
}

function encodeIndexedStudioPng(pngBuf) {
  const { w, h, rgba } = decodeRgbaPng(pngBuf);
  const cleanA = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    cleanA[p] = Math.round(Math.max(0, Math.min(1, (rgba[p * 4 + 3] - 122) / 133)) * 255);
  }
  const sums = Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
  let minG = 255, maxG = 0;
  for (let p = 0; p < w * h; p++) {
    if (cleanA[p] >= 245) {
      const g = rgba[p * 4 + 1];
      sums[g].r += rgba[p * 4]; sums[g].g += g; sums[g].b += rgba[p * 4 + 2]; sums[g].n++;
      if (g < minG) minG = g;
      if (g > maxG) maxG = g;
    }
  }
  for (let g = 0; g < 256; g++) {
    if (sums[g].n === 0) { sums[g].r = Math.round(g * 0.915); sums[g].g = g; sums[g].b = Math.round(g * 0.942); }
    else { sums[g].r = Math.round(sums[g].r / sums[g].n); sums[g].g = g; sums[g].b = Math.round(sums[g].b / sums[g].n); }
  }
  minG = Math.max(0, minG - 1);
  maxG = Math.min(255, maxG + 1);
  const plte = Buffer.alloc(256 * 3);
  const trns = Buffer.alloc(24);
  trns[0] = 0;
  for (let k = 1; k <= 23; k++) {
    trns[k] = Math.round((k / 24) * 255);
    plte[k * 3] = sums[104].r; plte[k * 3 + 1] = 104; plte[k * 3 + 2] = sums[104].b;
  }
  for (let k = 24; k < 256; k++) {
    const g = Math.round(minG + ((k - 24) / 231) * (maxG - minG));
    plte[k * 3] = sums[g].r; plte[k * 3 + 1] = sums[g].g; plte[k * 3 + 2] = sums[g].b;
  }
  const idxPixels = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const a = cleanA[p];
    if (a < 6) idxPixels[p] = 0;
    else if (a < 250) idxPixels[p] = Math.max(1, Math.min(23, Math.round((a / 255) * 24)));
    else idxPixels[p] = 24 + Math.max(0, Math.min(231, Math.round(((rgba[p * 4 + 1] - minG) / Math.max(1, maxG - minG)) * 231)));
  }
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) {
    let bestF = 0, bestScore = Infinity, bestRow = null;
    for (const f of [0, 1, 2]) {
      const cand = new Uint8Array(w);
      let sc = 0;
      for (let x = 0; x < w; x++) {
        const v = idxPixels[y * w + x];
        const left = x > 0 ? idxPixels[y * w + x - 1] : 0;
        const up = y > 0 ? idxPixels[(y - 1) * w + x] : 0;
        const d = f === 0 ? v : f === 1 ? (v - left) & 255 : (v - up) & 255;
        cand[x] = d;
        sc += d < 128 ? d : 256 - d;
      }
      if (sc < bestScore) { bestScore = sc; bestF = f; bestRow = cand; }
    }
    raw[y * (w + 1)] = bestF;
    Buffer.from(bestRow).copy(raw, y * (w + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 3;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", plte),
    pngChunk("tRNS", trns),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

async function main() {
  if (!fs.existsSync(path.join(srcDir, "zanatomy/systems/kas.glb"))) {
    console.error(
      "Diretório de malhas fonte não encontrado em " + srcDir + ".\n" +
      "Consulte assets/anatomia/NOTICE.md para os pacotes Z-Anatomy (kas.glb, iskelet.glb, eklem.glb) e BodyParts3D (FMA7163.stl)."
    );
    process.exit(1);
  }
  ensureHeadOuterBin(srcDir);

  const html = `<!doctype html><html><head><style>body{margin:0;background:transparent;overflow:hidden}</style>
  <script type="importmap">{"imports":{"three":"/zanatomy/vendor/three/three.module.min.js","three/addons/":"/zanatomy/vendor/three/addons/"}}</script>
  </head><body><script type="module" src="/__forja_renderer.js"></script></body></html>`;

  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    if (u === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(html); }
    if (u === "/__forja_renderer.js") { res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }); return res.end(CLIENT_JS); }
    const fp = path.join(srcDir, u);
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    const types = { ".js": "text/javascript", ".glb": "model/gltf-binary", ".bin": "application/octet-stream" };
    res.writeHead(200, { "Content-Type": types[path.extname(fp)] || "application/octet-stream" });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));

  const execPath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: true,
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox", "--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "networkidle0", timeout: 60000 });

  const bp3d = await page.evaluate(() => window.buildBP3D());
  const outAnatomia = path.join(repoRoot, "assets", "anatomia");
  fs.mkdirSync(outAnatomia, { recursive: true });

  for (const [view, file] of [["front", "anterior.png"], ["back", "posterior.png"]]) {
    const rawBuf = Buffer.from(bp3d.images[view].replace(/^data:image\/png;base64,/, ""), "base64");
    const optBuf = encodeIndexedStudioPng(rawBuf);
    fs.writeFileSync(path.join(outAnatomia, file), optBuf);
    console.log(`Gerado assets/anatomia/${file} (${optBuf.length} bytes / ${(optBuf.length / 1024).toFixed(1)} KiB)`);
  }

  if (updateContours) {
    const silhouettes = {};
    const regionsObj = {};
    for (const view of ["front", "back"]) {
      silhouettes[view] = maskToSvgPath(bp3d.masks.silhouette[view], { blurRadius: 1, threshold: 90, minArea: 40, rdpEps: 0.95 });
    }
    for (const [id, label, views] of META) {
      const entry = { label };
      for (const v of views) {
        entry[v] = [maskToSvgPath(bp3d.masks[v][id], { blurRadius: id === "abdomem" ? 1 : 2, threshold: 96, minArea: 18, rdpEps: 1.05 })];
      }
      regionsObj[id] = entry;
    }
    const figPath = path.join(repoRoot, "assets", "js", "forja-figura.js");
    let figCode = fs.readFileSync(figPath, "utf8");
    figCode = figCode.replace(
      /const SILHOUETTES = Object\.freeze\(\{[\s\S]*?\}\);/,
      `const SILHOUETTES = Object.freeze(${JSON.stringify(silhouettes, null, 4).replace(/\n/g, "\n  ")});`
    );
    figCode = figCode.replace(
      /const REGIONS = \{[\s\S]*?\n  \};/,
      `const REGIONS = ${JSON.stringify(regionsObj, null, 4).replace(/\n/g, "\n  ")};`
    );
    fs.writeFileSync(figPath, figCode);
    console.log("Contornos atualizados em assets/js/forja-figura.js");
  }

  await browser.close();
  server.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
