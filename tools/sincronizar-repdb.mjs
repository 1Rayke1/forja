/*
  FORJA — sincronizador do subconjunto de ilustrações do RepDB (free tier).

  Ferramenta de desenvolvimento. NÃO roda no navegador e NÃO faz parte do app.

  Uso:
    node tools/sincronizar-repdb.mjs            # regenera assets a partir do commit fixado
    node tools/sincronizar-repdb.mjs --offline  # só recalcula hashes e o bundle (sem rede)
    node tools/sincronizar-repdb.mjs --check    # só valida os arquivos já commitados (offline)
    FORJA_REPDB_SRC=/caminho/para/src node tools/sincronizar-repdb.mjs

  O que ela faz:
    1. Lê mapeamento.json (status/candidatos/revisões), rotulos.json e creditos.json.
    2. Copia SOMENTE os WebP necessários do dataset fixado: par completo
       (start/peak ou main) para a imagem padrão de cada exercício e um still
       representativo para cada alternativa do seletor.
    3. Gera manifest.json com SHA-256, bytes e URL de origem de cada arquivo.
    4. Gera assets/js/forja-demonstracoes-dados.js, o bundle compacto e congelado
       que o app carrega como <script> — sem fetch, sem API, sem rede em runtime.
    5. Verifica o limite de 3,6 MiB aceito para o catálogo local.

  Regras de licença (LICENSE-DATA.md, termos 2, 3, 5 e 6):
    - atribuição visível obrigatória; uso apenas dentro do app;
    - nada de premium-samples; nada de IA generativa sobre as imagens;
    - este script apenas COPIA arquivos e monta uma galeria HTML local.
*/
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = path.join(repoRoot, 'assets', 'demonstracoes');
const bundlePath = path.join(repoRoot, 'assets', 'js', 'forja-demonstracoes-dados.js');
const COMMIT = 'b407c5951a027a27817fb2a5cee9ec9feffc4dc7';
const REPO = 'https://github.com/RepDB/exercise-dataset';
const TARBALL = 'https://codeload.github.com/RepDB/exercise-dataset/tar.gz/' + COMMIT;
const MAX_BYTES = Math.round(3.6 * 1024 * 1024);
const CHECK = process.argv.includes('--check');
const OFFLINE = process.argv.includes('--offline');

const readJson = rel => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

function fail(message) {
  console.error('ERRO: ' + message);
  process.exit(1);
}

function downloadSource() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-repdb-'));
  const archive = path.join(dest, 'dataset.tar.gz');
  const src = path.join(dest, 'src');
  fs.mkdirSync(src);

  return new Promise((resolve, reject) => {
    const request = https.get(TARBALL, { headers: { 'User-Agent': 'forja-build' } }, response => {
      if (response.statusCode !== 200) {
        reject(new Error('download HTTP ' + response.statusCode));
        return;
      }
      const file = fs.createWriteStream(archive);
      response.pipe(file);
      file.on('finish', () => file.close(() => {
        try {
          execFileSync('tar', ['-xzf', archive, '-C', src, '--strip-components=1'], { stdio: 'ignore' });
          resolve(src);
        } catch (error) {
          reject(error);
        }
      }));
    });
    request.on('error', reject);
    request.setTimeout(180000, () => request.destroy(new Error('timeout no download')));
  });
}

function upstreamMeta(srcDir) {
  const data = JSON.parse(fs.readFileSync(path.join(srcDir, 'exercises.json'), 'utf8'));
  const byId = new Map();
  data.exercises.forEach(exercise => byId.set(exercise.id, exercise));
  return byId;
}

/* Um still por alternativa; par completo para o padrão de cada exercício. */
function neededFiles(mapping, byId) {
  const defaults = new Set();
  Object.values(mapping.exercises).forEach(entry => {
    if (entry.defaultDemoId) defaults.add(entry.defaultDemoId);
  });

  const candidates = new Set();
  Object.values(mapping.exercises).forEach(entry => {
    entry.candidates.forEach(candidate => candidates.add(candidate.demoId));
  });

  const files = new Map();
  const demos = {};

  candidates.forEach(demoId => {
    const id = demoId.replace(/^repdb:/, '');
    const exercise = byId.get(id);
    if (!exercise) fail('id RepDB inexistente no mapeamento: ' + id);
    const poses = exercise.images.flat;
    const full = defaults.has(demoId);
    const chosen = [];
    if (poses.start && poses.peak) {
      if (full) chosen.push(['start', poses.start], ['peak', poses.peak]);
      else chosen.push(['peak', poses.peak]);
    } else if (poses.main) {
      chosen.push(['main', poses.main]);
    } else {
      fail('sem poses conhecidas para ' + id);
    }
    chosen.forEach(([, file]) => files.set(file.split('/').at(-1), file));
    demos[demoId] = {
      upstreamId: id,
      nameEn: exercise.name_en,
      poses: chosen.map(([kind, file]) => ({ kind, file: file.split('/').at(-1) })),
      thumb: chosen.at(-1)[1].split('/').at(-1),
      sourceUrl: REPO + '/blob/' + COMMIT + '/' + chosen.at(-1)[1]
    };
  });

  return { files, demos };
}

function buildManifest(mapping, labels, creditos, demos, files, srcDir) {
  const entries = {};
  let total = 0;
  Array.from(files.keys()).sort().forEach(name => {
    const upstreamPath = files.get(name);
    const buffer = fs.readFileSync(path.join(srcDir, upstreamPath));
    entries[name] = {
      sha256: sha256(buffer),
      bytes: buffer.length,
      upstreamPath,
      sourceUrl: REPO + '/blob/' + COMMIT + '/' + upstreamPath
    };
    total += buffer.length;
  });

  Object.entries(demos).forEach(([demoId, demo]) => {
    const id = demo.upstreamId;
    if (!labels[id]) fail('rótulo pt-BR ausente para ' + id);
    demo.label = labels[id];
    demo.creditId = 'repdb';
    demo.licenseId = 'repdb-free-v1.0';
    demo.labelVerified = true;
  });

  return {
    schemaVersion: 1,
    generatedAt: '2026-10-27',
    source: {
      name: 'RepDB exercise-dataset (free tier)',
      repository: REPO,
      commit: COMMIT,
      license: 'RepDB Free Tier License v1.0',
      licenseFile: 'LICENSE-DATA.md',
      attribution: creditos.repdb.attribution,
      attributionUrl: creditos.repdb.attributionUrl,
      restrictions: [
        'Uso apenas dentro do app; sem republicação como dataset/API.',
        'Sem premium-samples.',
        'Sem derivação por IA generativa.',
        'Atribuição visível obrigatória.'
      ]
    },
    totalBytes: total,
    totalFiles: Object.keys(entries).length,
    files: entries,
    demos
  };
}

/* Bundle de runtime: apenas o necessário para resolver e desenhar. Sem hashes. */
function buildBundle(mapping, manifest, creditos, labels) {
  const demos = {};
  Object.entries(manifest.demos).forEach(([demoId, demo]) => {
    demos[demoId] = {
      l: demo.label,
      n: demo.nameEn,
      c: demo.creditId,
      p: demo.poses.map(pose => [pose.kind, pose.file]),
      t: demo.thumb
    };
  });

  const exercicios = {};
  Object.entries(mapping.exercises).forEach(([key, entry]) => {
    exercicios[key] = {
      n: entry.name,
      s: entry.status,
      d: entry.defaultDemoId,
      c: entry.candidates.map(candidate => [candidate.demoId, candidate.status])
    };
  });

  const reviews = {};
  Object.entries(mapping.reviews).forEach(([demoId, review]) => {
    reviews[demoId] = review.visualCheck;
  });

  const payload = {
    source: {
      commit: COMMIT,
      license: creditos.repdb.license,
      attribution: creditos.repdb.attribution,
      attributionUrl: creditos.repdb.attributionUrl,
      licenseUrl: creditos.repdb.licenseUrl
    },
    creditos: {
      repdb: {
        label: creditos.repdb.label,
        attribution: creditos.repdb.attribution,
        attributionUrl: creditos.repdb.attributionUrl,
        author: creditos.repdb.author,
        license: creditos.repdb.license,
        licenseUrl: creditos.repdb.licenseUrl,
        sourceUrl: creditos.repdb.sourceUrl,
        notes: creditos.repdb.notes
      }
    },
    confirmationRule: 'exact+confirmed',
    demos,
    exercicios,
    reviews
  };

  return '/* Gerado por tools/sincronizar-repdb.mjs. Não editar à mão. */\n' +
    '(function (global) {\n  "use strict";\n  global.FORJA_DEMOS_DATA = Object.freeze(' +
    JSON.stringify(payload) + ');\n})(window);\n';
}

function assertConsistency(mapping, manifest, labels, bundleText) {
  const candidateIds = new Set();
  Object.values(mapping.exercises).forEach(entry => {
    if (entry.defaultDemoId && !manifest.demos[entry.defaultDemoId]) {
      fail('padrão sem arquivo: ' + entry.defaultDemoId);
    }
    entry.candidates.forEach(candidate => candidateIds.add(candidate.demoId));
  });
  Object.keys(manifest.demos).forEach(id => {
    if (!candidateIds.has(id)) fail('demo fora do mapeamento: ' + id);
  });
  Object.keys(manifest.files).forEach(name => {
    if (name.includes('..') || !/^[\w.-]+\.webp$/.test(name)) fail('nome de arquivo suspeito: ' + name);
  });
  if (manifest.totalBytes > MAX_BYTES) {
    fail('catálogo com ' + manifest.totalBytes + ' bytes excede o limite de ' + MAX_BYTES);
  }
  Object.values(manifest.files).forEach(meta => {
    if (meta.upstreamPath.includes('premium-samples') ||
        meta.sourceUrl.includes('premium-samples')) {
      fail('arquivo de premium-samples no catálogo: ' + meta.upstreamPath);
    }
  });
  if (/https?:\/\/(?!repdb\.co|github\.com|creativecommons\.org)/.test(
    JSON.stringify(manifest.demos))) {
    fail('URL de origem inesperada no manifesto');
  }
  if (/premium-samples/.test(bundleText.replace(/Sem premium-samples[^\"]*/g, ''))) {
    fail('bundle referencia premium-samples como origem de imagem');
  }
  Object.keys(labels).forEach(id => {
    if (!manifest.demos['repdb:' + id]) fail('rótulo órfão: ' + id);
  });
}

function verifyChecksums() {
  const manifest = readJson('assets/demonstracoes/manifest.json');
  Object.entries(manifest.files).forEach(([name, meta]) => {
    const full = path.join(demoDir, name);
    if (!fs.existsSync(full)) fail('arquivo ausente: ' + name);
    const buffer = fs.readFileSync(full);
    if (sha256(buffer) !== meta.sha256) fail('hash divergente: ' + name);
    if (buffer.length !== meta.bytes) fail('tamanho divergente: ' + name);
  });
  const bundle = fs.readFileSync(bundlePath, 'utf8');
  const mapping = readJson('assets/demonstracoes/mapeamento.json');
  const labels = readJson('assets/demonstracoes/rotulos.json');
  const creditos = readJson('assets/demonstracoes/creditos.json');
  const expected = buildBundle(mapping, manifest, creditos, labels);
  if (bundle !== expected) fail('bundle de runtime dessincronizado (rode o script sem --check)');
  assertConsistency(mapping, manifest, labels, bundle);
  console.log('OK — ' + manifest.totalFiles + ' arquivos, ' +
    manifest.totalBytes + ' bytes (' + (manifest.totalBytes / 1024 / 1024).toFixed(2) +
    ' MiB), bundle e hashes íntegros.');
}

async function main() {
  const mapping = readJson('assets/demonstracoes/mapeamento.json');
  const labels = readJson('assets/demonstracoes/rotulos.json');
  const creditos = readJson('assets/demonstracoes/creditos.json');

  if (CHECK) {
    verifyChecksums();
    return;
  }

  /*
    Depois de uma revisão visual (tools/revisao-demonstracoes.html) só mudam
    `reviews`/`defaultDemoId`. Não é preciso baixar o dataset de novo:
    recalculamos os hashes dos arquivos já presentes e o bundle de runtime.
  */
  if (OFFLINE) {
    const previous = readJson('assets/demonstracoes/manifest.json');
    const entries = {};
    let total = 0;
    Object.keys(previous.files).sort().forEach(name => {
      const full = path.join(demoDir, name);
      if (!fs.existsSync(full)) fail('arquivo ausente: ' + name);
      const buffer = fs.readFileSync(full);
      entries[name] = Object.assign({}, previous.files[name], {
        sha256: sha256(buffer), bytes: buffer.length
      });
      total += buffer.length;
    });
    const manifest = Object.assign({}, previous, {
      generatedAt: new Date().toISOString().slice(0, 10),
      totalBytes: total,
      totalFiles: Object.keys(entries).length,
      files: entries
    });
    const bundle = buildBundle(mapping, manifest, creditos, labels);
    assertConsistency(mapping, manifest, labels, bundle);
    fs.writeFileSync(path.join(demoDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(bundlePath, bundle);
    console.log('Offline: ' + manifest.totalFiles + ' arquivos, bundle e revisões atualizados.');
    return;
  }

  const srcDir = process.env.FORJA_REPDB_SRC || await downloadSource();
  const byId = upstreamMeta(srcDir);
  const { files, demos } = neededFiles(mapping, byId);
  const manifest = buildManifest(mapping, labels, creditos, demos, files, srcDir);
  const bundle = buildBundle(mapping, manifest, creditos, labels);

  assertConsistency(mapping, manifest, labels, bundle);

  fs.mkdirSync(demoDir, { recursive: true });
  Array.from(files.keys()).sort().forEach(name => {
    fs.copyFileSync(path.join(srcDir, files.get(name)), path.join(demoDir, name));
  });
  fs.writeFileSync(path.join(demoDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  fs.writeFileSync(bundlePath, bundle);

  console.log('Gerados ' + manifest.totalFiles + ' WebP, ' + manifest.totalBytes +
    ' bytes (' + (manifest.totalBytes / 1024 / 1024).toFixed(2) + ' MiB), ' +
    Object.keys(manifest.demos).length + ' demos.');
}

main().catch(error => fail(error.message));
