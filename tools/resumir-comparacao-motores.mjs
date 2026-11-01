#!/usr/bin/env node
/**
 * FORJA — inspeção Meshopt e consolidação da comparação Cycles vs EEVEE.
 *
 * Opera em dois modos:
 *
 *   1) `--modo preparar-meshopt`:
 *      Inspeciona os anexos originais da release `modelos-3d-originais`
 *      (tamanho, SHA-256, cabeçalho binário real, chunk JSON do GLB, extensões
 *      `EXT_meshopt_compression`, `KHR_draco_mesh_compression`,
 *      `KHR_mesh_quantization`, `KHR_texture_basisu`), testa compatibilidade
 *      no `GLTFLoader` do app e prepara variantes decodificadas / sondas
 *      Meshopt para auditoria real no Blender 4.2.1.
 *
 *   2) `--modo resumir` (padrão):
 *      Lê os resultados brutos da auditoria e dos subprocessos isolados do
 *      Blender (Cycles e EEVEE), decodifica os PNGs gerados para medir
 *      integridade visual real (luminância, cobertura de silhueta, ausência de
 *      textura magenta, MAE, RMSE, PSNR e IoU de silhueta entre Cycles e EEVEE),
 *      monta pranchas lado a lado auxiliares e grava os relatórios finais em
 *      JSON e Markdown sem aprovar automaticamente nenhum motor.
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

import { mapearOssos } from "./lib/mapeamento-ossos.mjs";

const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const chave = token.slice(2);
    const prox = argv[i + 1];
    if (prox !== undefined && !prox.startsWith("--")) {
      args[chave] = prox;
      i += 1;
    } else {
      args[chave] = true;
    }
  }
  return args;
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256Arquivo(caminho) {
  return sha256Buffer(fs.readFileSync(caminho));
}

function formatarBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB (${bytes} B)`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB (${bytes} B)`;
  return `${bytes} B`;
}

function detectarFormatoBinario(buf) {
  const hex16 = buf.subarray(0, Math.min(16, buf.length)).toString("hex").match(/.{1,2}/g)?.join(" ") || "";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "glTF") {
    const versao = buf.readUInt32LE(4);
    const comprimentoHeader = buf.readUInt32LE(8);
    return { tipo: "GLB", descricao: `GLB binário (glTF v${versao}, header=${comprimentoHeader} B)`, hex16 };
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return { tipo: "ZIP", descricao: "Arquivo ZIP (PK\\x03\\x04)", hex16 };
  }
  if (buf.subarray(0, 20).toString("ascii").startsWith("Kaydara FBX Binary")) {
    return { tipo: "FBX", descricao: "FBX binário (Kaydara FBX Binary)", hex16 };
  }
  if (buf.subarray(0, 7).toString("ascii") === "BLENDER") {
    return { tipo: "BLEND", descricao: "Arquivo nativo Blender (.blend)", hex16 };
  }
  const inicioTxt = buf.subarray(0, 128).toString("utf8").trimStart();
  if (inicioTxt.startsWith("{") && inicioTxt.includes('"asset"')) {
    return { tipo: "GLTF", descricao: "glTF JSON textual", hex16 };
  }
  return { tipo: "DESCONHECIDO", descricao: "Binário não identificado pelo cabeçalho", hex16 };
}

function extrairResumoGlbJson(buf) {
  if (buf.length < 20 || buf.subarray(0, 4).toString("ascii") !== "glTF") return null;
  const chunkLen = buf.readUInt32LE(12);
  const chunkType = buf.readUInt32LE(16);
  if (chunkType !== 0x4e4f534a || 20 + chunkLen > buf.length) return null; // 'JSON'
  const jsonTexto = buf.subarray(20, 20 + chunkLen).toString("utf8");
  const gltf = JSON.parse(jsonTexto);

  const bvsMeshopt = (gltf.bufferViews || []).filter(
    bv => bv.extensions && bv.extensions.EXT_meshopt_compression
  );
  const modosMeshopt = {};
  const filtrosMeshopt = {};
  let bytesComprimidosMeshopt = 0;
  for (const bv of bvsMeshopt) {
    const ext = bv.extensions.EXT_meshopt_compression;
    const modo = ext.mode || "DESCONHECIDO";
    const filtro = ext.filter || "NONE";
    modosMeshopt[modo] = (modosMeshopt[modo] || 0) + 1;
    filtrosMeshopt[filtro] = (filtrosMeshopt[filtro] || 0) + 1;
    bytesComprimidosMeshopt += Number(ext.byteLength || bv.byteLength || 0);
  }

  let primsDraco = 0;
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.extensions && prim.extensions.KHR_draco_mesh_compression) primsDraco += 1;
    }
  }

  return {
    assetVersion: gltf.asset?.version || null,
    generator: gltf.asset?.generator || null,
    copyright: gltf.asset?.copyright || null,
    extensionsUsed: gltf.extensionsUsed || [],
    extensionsRequired: gltf.extensionsRequired || [],
    contagens: {
      scenes: (gltf.scenes || []).length,
      nodes: (gltf.nodes || []).length,
      meshes: (gltf.meshes || []).length,
      materials: (gltf.materials || []).length,
      textures: (gltf.textures || []).length,
      images: (gltf.images || []).length,
      skins: (gltf.skins || []).length,
      animations: (gltf.animations || []).length,
      accessors: (gltf.accessors || []).length,
      bufferViews: (gltf.bufferViews || []).length,
      bufferViewsMeshopt: bvsMeshopt.length,
      primitivasDraco: primsDraco,
    },
    meshoptDetalhes: {
      bufferViewsComprimidos: bvsMeshopt.length,
      bytesComprimidosDeclarados: bytesComprimidosMeshopt,
      modos: modosMeshopt,
      filtros: filtrosMeshopt,
    },
    nomes_cenas: (gltf.scenes || []).map(s => s.name).filter(Boolean),
    nomes_nos: (gltf.nodes || []).map(n => n.name).filter(Boolean).slice(0, 60),
    nomes_malhas: (gltf.meshes || []).map(m => m.name).filter(Boolean),
    nomes_materiais: (gltf.materials || []).map(m => m.name).filter(Boolean),
    nomes_imagens: (gltf.images || []).map(im => im.name || im.uri).filter(Boolean),
    nomes_skins: (gltf.skins || []).map(sk => sk.name).filter(Boolean),
    nomes_animacoes: (gltf.animations || []).map(an => an.name).filter(Boolean),
    mimeTypesImagens: [...new Set((gltf.images || []).map(im => im.mimeType).filter(Boolean))],
  };
}

async function carregarPacotesMeshopt(dirFerramentas) {
  const candidatos = [
    dirFerramentas,
    process.env.FORJA_MESHOPT_DIR,
    "/tmp/meshopt-tools",
    RAIZ_REPO,
  ].filter(Boolean);

  for (const base of candidatos) {
    const pkgJson = path.join(base, "package.json");
    if (!fs.existsSync(pkgJson)) continue;
    try {
      const req = createRequire(pkgJson);
      const coreUrl = pathToFileURL(req.resolve("@gltf-transform/core")).href;
      const extUrl = pathToFileURL(req.resolve("@gltf-transform/extensions")).href;
      const fnUrl = pathToFileURL(req.resolve("@gltf-transform/functions")).href;
      const meshoptUrl = pathToFileURL(req.resolve("meshoptimizer")).href;
      const core = await import(coreUrl);
      const extensions = await import(extUrl);
      const functions = await import(fnUrl);
      const meshoptPkg = await import(meshoptUrl);
      let draco3d = null;
      try {
        const dracoUrl = pathToFileURL(req.resolve("draco3dgltf")).href;
        const dracoMod = await import(dracoUrl);
        draco3d = dracoMod.default || dracoMod;
      } catch {
        draco3d = null;
      }
      const pkgLock = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
      return {
        disponivel: true,
        base,
        core,
        extensions,
        functions,
        MeshoptDecoder: meshoptPkg.MeshoptDecoder || meshoptPkg.default?.MeshoptDecoder,
        MeshoptEncoder: meshoptPkg.MeshoptEncoder || meshoptPkg.default?.MeshoptEncoder,
        draco3d,
        dependenciasDeclaradas: pkgLock.dependencies || pkgLock.devDependencies || {},
      };
    } catch {
      // tenta o próximo diretório candidato
    }
  }
  return { disponivel: false };
}

async function testarGltfLoaderThreeApp(buf) {
  try {
    globalThis.self = globalThis;
    globalThis.createImageBitmap =
      globalThis.createImageBitmap || (async () => ({ width: 2, height: 2, close() {} }));
    if (typeof globalThis.URL.createObjectURL !== "function") {
      globalThis.URL.createObjectURL = () => "blob:teste";
      globalThis.URL.revokeObjectURL = () => {};
    }
    const { GLTFLoader } = await import(
      pathToFileURL(path.join(RAIZ_REPO, "assets/vendor/three/addons/loaders/GLTFLoader.js")).href
    );
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    await new Promise((resolve, reject) => {
      new GLTFLoader().parse(ab, "", resolve, reject);
    });
    return { sucesso_sem_decoder_meshopt: true, erro: null };
  } catch (err) {
    return {
      sucesso_sem_decoder_meshopt: false,
      erro: err instanceof Error ? err.message : String(err),
    };
  }
}

function converterKtx2ParaPng(bytesKtx2, pastaTemp, indice) {
  const entrada = path.join(pastaTemp, `tex_${indice}.ktx2`);
  const saida = path.join(pastaTemp, `tex_${indice}.png`);
  fs.writeFileSync(entrada, bytesKtx2);
  try {
    execFileSync("ktx", ["extract", "--transcode", "rgba8", entrada, saida], { stdio: "pipe" });
  } catch {
    execFileSync("ktx", ["extract", entrada, saida], { stdio: "pipe" });
  }
  return fs.readFileSync(saida);
}

async function executarPrepararMeshopt(args) {
  const originaisDir = path.resolve(args["originais-dir"] || "/tmp/comparacao-3d/originais");
  const trabalhoDir = path.resolve(args["trabalho-dir"] || "/tmp/comparacao-3d/preparados");
  const saidaJson = path.resolve(args["saida-json"] || "/tmp/comparacao-3d/preparacao-modelos.json");
  const logCaminho = args.log ? path.resolve(args.log) : null;
  const releaseJsonCaminho = args["release-json"] ? path.resolve(args["release-json"]) : null;

  fs.mkdirSync(trabalhoDir, { recursive: true });
  const logs = [];
  const registrar = linha => {
    logs.push(linha);
    console.log(linha);
  };

  let mapaDigestsRelease = {};
  if (releaseJsonCaminho && fs.existsSync(releaseJsonCaminho)) {
    const rel = JSON.parse(fs.readFileSync(releaseJsonCaminho, "utf8"));
    for (const asset of rel.assets || []) {
      mapaDigestsRelease[asset.name] = {
        size: asset.size,
        digest: typeof asset.digest === "string" ? asset.digest.replace(/^sha256:/, "") : null,
      };
    }
  }

  const ferramentas = await carregarPacotesMeshopt(args["meshopt-dir"]);
  registrar(`=== AUDITORIA BINÁRIA E TESTE REAL DE MESHOPT ===`);
  registrar(`Data UTC: ${new Date().toISOString()}`);
  registrar(`Ferramentas Meshopt carregadas: ${ferramentas.disponivel ? `SIM (${ferramentas.base})` : "NÃO"}`);

  const nomesArquivos = fs.existsSync(originaisDir)
    ? fs.readdirSync(originaisDir).filter(f => fs.statSync(path.join(originaisDir, f)).isFile()).sort()
    : [];

  const resultadosArquivos = [];

  for (const nomeArquivo of nomesArquivos) {
    const caminhoOriginal = path.join(originaisDir, nomeArquivo);
    const bufOriginal = fs.readFileSync(caminhoOriginal);
    const sha256 = sha256Buffer(bufOriginal);
    const bytes = bufOriginal.length;
    const formato = detectarFormatoBinario(bufOriginal);
    const stem = path.basename(nomeArquivo, path.extname(nomeArquivo));

    const metaRel = mapaDigestsRelease[nomeArquivo] || null;
    const sha256ConfereRelease = metaRel?.digest ? metaRel.digest === sha256 : null;

    registrar("");
    registrar(`--- Arquivo: ${nomeArquivo} ---`);
    registrar(`Bytes: ${formatarBytes(bytes)}`);
    registrar(`SHA-256 medido: ${sha256}`);
    if (metaRel?.digest) {
      registrar(`SHA-256 esperado na release: ${metaRel.digest} (confere=${sha256ConfereRelease})`);
    }
    registrar(`Cabeçalho (16B): ${formato.hex16} → ${formato.descricao}`);

    const registro = {
      nome_arquivo: nomeArquivo,
      caminho_original: caminhoOriginal,
      bytes,
      sha256,
      sha256_esperado_release: metaRel?.digest || null,
      sha256_confere_release: sha256ConfereRelease,
      formato_detectado: formato.tipo,
      descricao_formato: formato.descricao,
      primeiros_16_bytes_hex: formato.hex16,
      glb_json_resumo: null,
      usa_meshopt_original: false,
      requer_meshopt_original: false,
      usa_draco_original: false,
      usa_ktx2_original: false,
      usa_quantizacao_original: false,
      teste_three_gltfloader_sem_meshopt: null,
      caminho_glb_intacto: null,
      caminho_sem_meshopt: null,
      caminho_desquantizado: null,
      caminho_sonda_meshopt: null,
      caminho_extraido: null,
      operacao_meshopt: null,
    };

    let bufGlbAlvo = null;
    if (formato.tipo === "GLB") {
      bufGlbAlvo = bufOriginal;
      const caminhoGlbIntacto = path.join(trabalhoDir, `${stem}.original.glb`);
      fs.writeFileSync(caminhoGlbIntacto, bufOriginal);
      registro.caminho_glb_intacto = caminhoGlbIntacto;
    } else if (formato.tipo === "ZIP") {
      const pastaUnzip = path.join(trabalhoDir, `${stem}_unzip`);
      fs.mkdirSync(pastaUnzip, { recursive: true });
      execFileSync("unzip", ["-q", "-o", caminhoOriginal, "-d", pastaUnzip]);
      const todos = [];
      const varrer = dir => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) varrer(p);
          else todos.push(p);
        }
      };
      varrer(pastaUnzip);
      const candidato3d = todos.find(p => /\.(glb|gltf|fbx|blend|obj)$/i.test(p));
      if (candidato3d) {
        registro.caminho_extraido = candidato3d;
        registrar(`Extraído de ZIP: ${path.basename(candidato3d)}`);
        const b = fs.readFileSync(candidato3d);
        if (detectarFormatoBinario(b).tipo === "GLB") {
          bufGlbAlvo = b;
          registro.caminho_glb_intacto = candidato3d;
        }
      }
    } else if (formato.tipo === "FBX" || formato.tipo === "BLEND") {
      const extReal = formato.tipo === "FBX" ? ".fbx" : ".blend";
      const copia = path.join(trabalhoDir, `${stem}${extReal}`);
      fs.writeFileSync(copia, bufOriginal);
      registro.caminho_extraido = copia;
    }

    if (bufGlbAlvo) {
      const glbResumo = extrairResumoGlbJson(bufGlbAlvo);
      registro.glb_json_resumo = glbResumo;
      const usadas = glbResumo?.extensionsUsed || [];
      const obrigatorias = glbResumo?.extensionsRequired || [];
      registro.usa_meshopt_original = usadas.includes("EXT_meshopt_compression") || obrigatorias.includes("EXT_meshopt_compression");
      registro.requer_meshopt_original = obrigatorias.includes("EXT_meshopt_compression");
      registro.usa_draco_original = usadas.includes("KHR_draco_mesh_compression") || obrigatorias.includes("KHR_draco_mesh_compression");
      registro.usa_ktx2_original = usadas.includes("KHR_texture_basisu") || obrigatorias.includes("KHR_texture_basisu");
      registro.usa_quantizacao_original = usadas.includes("KHR_mesh_quantization") || obrigatorias.includes("KHR_mesh_quantization");

      registrar(`GLB generator: ${glbResumo?.generator || "(não declarado)"}`);
      registrar(`extensionsUsed: ${usadas.length ? usadas.join(", ") : "(nenhuma)"}`);
      registrar(`extensionsRequired: ${obrigatorias.length ? obrigatorias.join(", ") : "(nenhuma)"}`);
      registrar(
        `Contagens GLB: malhas=${glbResumo?.contagens.meshes}, skins=${glbResumo?.contagens.skins}, ` +
        `materiais=${glbResumo?.contagens.materials}, imagens=${glbResumo?.contagens.images}, ` +
        `animações=${glbResumo?.contagens.animations}, bufferViewsMeshopt=${glbResumo?.contagens.bufferViewsMeshopt}`
      );

      registro.teste_three_gltfloader_sem_meshopt = await testarGltfLoaderThreeApp(bufGlbAlvo);
      registrar(
        `Teste GLTFLoader atual do app (sem setMeshoptDecoder): ` +
        `sucesso=${registro.teste_three_gltfloader_sem_meshopt.sucesso_sem_decoder_meshopt}` +
        (registro.teste_three_gltfloader_sem_meshopt.erro
          ? ` | erro="${registro.teste_three_gltfloader_sem_meshopt.erro}"`
          : "")
      );

      if (ferramentas.disponivel) {
        const { core, extensions, functions, MeshoptDecoder, MeshoptEncoder, draco3d } = ferramentas;
        await MeshoptDecoder.ready;
        if (MeshoptEncoder) await MeshoptEncoder.ready;

        const deps = { "meshopt.decoder": MeshoptDecoder };
        if (MeshoptEncoder) deps["meshopt.encoder"] = MeshoptEncoder;
        if (draco3d) {
          deps["draco3d.decoder"] = await draco3d.createDecoderModule();
        }
        const io = new core.NodeIO().registerExtensions(extensions.ALL_EXTENSIONS).registerDependencies(deps);

        if (registro.usa_meshopt_original || registro.usa_draco_original || registro.usa_ktx2_original) {
          const t0 = performance.now();
          try {
            const doc = await io.readBinary(new Uint8Array(bufGlbAlvo));
            let texturasKtx2Convertidas = 0;

            if (registro.usa_ktx2_original) {
              const pastaKtx = path.join(trabalhoDir, `${stem}_ktx2`);
              fs.mkdirSync(pastaKtx, { recursive: true });
              let idxTex = 0;
              for (const tex of doc.getRoot().listTextures()) {
                if (tex.getMimeType() === "image/ktx2" && tex.getImage()) {
                  const pngBytes = converterKtx2ParaPng(Buffer.from(tex.getImage()), pastaKtx, idxTex);
                  tex.setImage(new Uint8Array(pngBytes)).setMimeType("image/png");
                  texturasKtx2Convertidas += 1;
                  idxTex += 1;
                }
              }
            }

            for (const ext of doc.getRoot().listExtensionsUsed()) {
              if (
                ext.extensionName === "EXT_meshopt_compression" ||
                ext.extensionName === "KHR_draco_mesh_compression" ||
                (ext.extensionName === "KHR_texture_basisu" && texturasKtx2Convertidas > 0)
              ) {
                ext.dispose();
              }
            }

            const bytesDecodificado = Buffer.from(await io.writeBinary(doc));
            const caminhoSemMeshopt = path.join(trabalhoDir, `${stem}.sem-meshopt.glb`);
            fs.writeFileSync(caminhoSemMeshopt, bytesDecodificado);
            registro.caminho_sem_meshopt = caminhoSemMeshopt;

            let bytesDesquant = null;
            if (registro.usa_quantizacao_original && functions.dequantize) {
              await doc.transform(functions.dequantize());
              bytesDesquant = Buffer.from(await io.writeBinary(doc));
              const caminhoDesquant = path.join(trabalhoDir, `${stem}.desquantizado.glb`);
              fs.writeFileSync(caminhoDesquant, bytesDesquant);
              registro.caminho_desquantizado = caminhoDesquant;
            }

            const durMs = Math.round(performance.now() - t0);
            registro.operacao_meshopt = {
              modo: "decodificacao_original",
              sucesso: true,
              tempo_ms: durMs,
              bytes_antes: bufGlbAlvo.length,
              bytes_depois_sem_meshopt: bytesDecodificado.length,
              bytes_depois_desquantizado: bytesDesquant ? bytesDesquant.length : null,
              texturas_ktx2_convertidas_png: texturasKtx2Convertidas,
              extensoes_restantes: doc.getRoot().listExtensionsUsed().map(e => e.extensionName),
            };
            registrar(
              `Decodificação Meshopt concluída em ${durMs} ms: ` +
              `${formatarBytes(bufGlbAlvo.length)} → ${formatarBytes(bytesDecodificado.length)} ` +
              `(KTX2→PNG=${texturasKtx2Convertidas})`
            );
          } catch (err) {
            registro.operacao_meshopt = {
              modo: "decodificacao_original",
              sucesso: false,
              erro: err instanceof Error ? err.message : String(err),
            };
            registrar(`ERRO na decodificação Meshopt: ${registro.operacao_meshopt.erro}`);
          }
        } else if (MeshoptEncoder) {
          // O modelo original não veio com EXT_meshopt_compression: geramos uma sonda real
          // comprimida com Meshopt para testar empiricamente a compatibilidade do Blender 4.2.1.
          const t0 = performance.now();
          try {
            const doc = await io.readBinary(new Uint8Array(bufGlbAlvo));
            doc.createExtension(extensions.EXTMeshoptCompression).setRequired(true);
            const bytesSonda = Buffer.from(await io.writeBinary(doc));
            const caminhoSonda = path.join(trabalhoDir, `${stem}.sonda-meshopt.glb`);
            fs.writeFileSync(caminhoSonda, bytesSonda);
            registro.caminho_sonda_meshopt = caminhoSonda;

            const docRoundtrip = await io.readBinary(new Uint8Array(bytesSonda));
            for (const ext of docRoundtrip.getRoot().listExtensionsUsed()) {
              if (ext.extensionName === "EXT_meshopt_compression") ext.dispose();
            }
            const bytesRoundtrip = Buffer.from(await io.writeBinary(docRoundtrip));
            const durMs = Math.round(performance.now() - t0);

            registro.operacao_meshopt = {
              modo: "sonda_compatibilidade_meshopt",
              sucesso: true,
              tempo_ms: durMs,
              bytes_original: bufGlbAlvo.length,
              bytes_comprimido_meshopt: bytesSonda.length,
              reducao_pct: Number(((1 - bytesSonda.length / bufGlbAlvo.length) * 100).toFixed(2)),
              bytes_roundtrip_decodificado: bytesRoundtrip.length,
            };
            registrar(
              `Sonda Meshopt gerada em ${durMs} ms: ${formatarBytes(bufGlbAlvo.length)} → ` +
              `${formatarBytes(bytesSonda.length)} (${registro.operacao_meshopt.reducao_pct}% menor) ` +
              `para teste real de importação no Blender 4.2.1.`
            );
          } catch (err) {
            registro.operacao_meshopt = {
              modo: "sonda_compatibilidade_meshopt",
              sucesso: false,
              erro: err instanceof Error ? err.message : String(err),
            };
            registrar(`ERRO ao gerar sonda Meshopt: ${registro.operacao_meshopt.erro}`);
          }
        }
      }
    }

    resultadosArquivos.push(registro);
  }

  const saida = {
    gerado_em_utc: new Date().toISOString(),
    ferramentas_meshopt: {
      disponivel: ferramentas.disponivel,
      diretorio: ferramentas.base || null,
      dependencias: ferramentas.dependenciasDeclaradas || {},
    },
    arquivos: resultadosArquivos,
  };

  fs.mkdirSync(path.dirname(saidaJson), { recursive: true });
  fs.writeFileSync(saidaJson, JSON.stringify(saida, null, 2), "utf8");
  if (logCaminho) {
    fs.mkdirSync(path.dirname(logCaminho), { recursive: true });
    fs.writeFileSync(logCaminho, logs.join("\n") + "\n", "utf8");
  }
}

/* -------------------------------------------------------------------------- */
/* Decodificador e codificador PNG puro (Node zlib) para análise de pixels    */
/* -------------------------------------------------------------------------- */

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodificarPngRgba(caminho) {
  const buf = fs.readFileSync(caminho);
  const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(assinatura)) {
    throw new Error(`Assinatura PNG inválida em ${caminho}`);
  }

  let largura = 0;
  let altura = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idats = [];
  let offset = 8;

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      largura = data.readUInt32BE(0);
      altura = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Formato PNG não suportado pelo analisador (${bitDepth}-bit, colorType=${colorType})`);
  }

  const canais = colorType === 6 ? 4 : 3;
  const stride = largura * canais;
  const inflado = zlib.inflateSync(Buffer.concat(idats));
  if (inflado.length < altura * (1 + stride)) {
    throw new Error(`Buffer PNG truncado em ${caminho}`);
  }

  const rgba = new Uint8Array(largura * altura * 4);
  const linhaAnt = new Uint8Array(stride);
  const linhaAtual = new Uint8Array(stride);

  for (let y = 0; y < altura; y += 1) {
    const base = y * (1 + stride);
    const filtro = inflado[base];
    for (let i = 0; i < stride; i += 1) {
      const raw = inflado[base + 1 + i];
      const esq = i >= canais ? linhaAtual[i - canais] : 0;
      const cima = linhaAnt[i];
      const diag = i >= canais ? linhaAnt[i - canais] : 0;
      let val = raw;
      if (filtro === 1) val = (raw + esq) & 0xff;
      else if (filtro === 2) val = (raw + cima) & 0xff;
      else if (filtro === 3) val = (raw + ((esq + cima) >> 1)) & 0xff;
      else if (filtro === 4) val = (raw + paethPredictor(esq, cima, diag)) & 0xff;
      linhaAtual[i] = val;
    }

    for (let x = 0; x < largura; x += 1) {
      const orig = x * canais;
      const dest = (y * largura + x) * 4;
      rgba[dest] = linhaAtual[orig];
      rgba[dest + 1] = linhaAtual[orig + 1];
      rgba[dest + 2] = linhaAtual[orig + 2];
      rgba[dest + 3] = canais === 4 ? linhaAtual[orig + 3] : 255;
    }
    linhaAnt.set(linhaAtual);
  }

  return {
    largura,
    altura,
    bytes: buf.length,
    sha256: sha256Buffer(buf),
    colorType,
    rgba,
  };
}

function codificarPngRgb(largura, altura, rgbBytes) {
  const linhas = Buffer.alloc((largura * 3 + 1) * altura);
  for (let y = 0; y < altura; y += 1) {
    const offLinha = y * (largura * 3 + 1);
    linhas[offLinha] = 0;
    rgbBytes.copy(linhas, offLinha + 1, y * largura * 3, (y + 1) * largura * 3);
  }

  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  const crc32 = buffer => {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i += 1) c = tabela[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (tipo, dados) => {
    const tam = Buffer.alloc(4);
    tam.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(corpo));
    return Buffer.concat([tam, corpo, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(linhas, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function estatisticasImagem(img) {
  const totalPx = img.largura * img.altura;
  const histLum = new Uint32Array(256);
  let somaLum = 0;
  let somaQuadLum = 0;
  let pixelsMagenta = 0;

  // Estima cor de fundo usando os cantos superiores da imagem
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let nCantos = 0;
  for (const [cx, cy] of [[4, 4], [img.largura - 5, 4], [12, 12], [img.largura - 13, 12]]) {
    if (cx >= 0 && cx < img.largura && cy >= 0 && cy < img.altura) {
      const idx = (cy * img.largura + cx) * 4;
      bgR += img.rgba[idx];
      bgG += img.rgba[idx + 1];
      bgB += img.rgba[idx + 2];
      nCantos += 1;
    }
  }
  bgR /= Math.max(1, nCantos);
  bgG /= Math.max(1, nCantos);
  bgB /= Math.max(1, nCantos);

  // Ignora os 18% inferiores na máscara de silhueta para separar personagem do piso
  const limiteYPiso = Math.floor(img.altura * 0.86);
  const mascaraSilhueta = new Uint8Array(totalPx);
  let pixelsSilhueta = 0;

  for (let i = 0; i < totalPx; i += 1) {
    const r = img.rgba[i * 4];
    const g = img.rgba[i * 4 + 1];
    const b = img.rgba[i * 4 + 2];
    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    histLum[Math.min(255, Math.max(0, lum))] += 1;
    somaLum += lum;
    somaQuadLum += lum * lum;

    if (r > 210 && g < 25 && b > 210) pixelsMagenta += 1;

    const y = Math.floor(i / img.largura);
    const distBg = Math.hypot(r - bgR, g - bgG, b - bgB);
    if (y < limiteYPiso && distBg > 22) {
      mascaraSilhueta[i] = 1;
      pixelsSilhueta += 1;
    }
  }

  const percentil = frac => {
    const alvo = totalPx * frac;
    let acum = 0;
    for (let v = 0; v < 256; v += 1) {
      acum += histLum[v];
      if (acum >= alvo) return v;
    }
    return 255;
  };

  const media = somaLum / totalPx;
  const variancia = Math.max(0, somaQuadLum / totalPx - media * media);

  return {
    largura: img.largura,
    altura: img.altura,
    bytes: img.bytes,
    sha256: img.sha256,
    luminancia_media_0_255: Number(media.toFixed(2)),
    luminancia_desvio_0_255: Number(Math.sqrt(variancia).toFixed(2)),
    luminancia_p01: percentil(0.01),
    luminancia_p50: percentil(0.50),
    luminancia_p99: percentil(0.99),
    cobertura_silhueta_pct: Number(((pixelsSilhueta / totalPx) * 100).toFixed(2)),
    pixels_magenta_textura_ausente: pixelsMagenta,
    _mascaraSilhueta: mascaraSilhueta,
  };
}

function compararParImagens(imgCycles, stCycles, imgEevee, stEevee, caminhoLadoALado) {
  if (imgCycles.largura !== imgEevee.largura || imgCycles.altura !== imgEevee.altura) {
    return { erro: "Resoluções divergentes entre Cycles e EEVEE" };
  }
  const totalPx = imgCycles.largura * imgCycles.altura;
  let somaAbs = 0;
  let somaQuad = 0;
  let somaAbsRoi = 0;
  let somaQuadRoi = 0;
  let nRoi = 0;
  let interSilhueta = 0;
  let uniaoSilhueta = 0;

  const xIniRoi = Math.floor(imgCycles.largura * 0.18);
  const xFimRoi = Math.ceil(imgCycles.largura * 0.82);
  const yIniRoi = Math.floor(imgCycles.altura * 0.06);
  const yFimRoi = Math.ceil(imgCycles.altura * 0.94);

  for (let i = 0; i < totalPx; i += 1) {
    const dr = imgEevee.rgba[i * 4] - imgCycles.rgba[i * 4];
    const dg = imgEevee.rgba[i * 4 + 1] - imgCycles.rgba[i * 4 + 1];
    const db = imgEevee.rgba[i * 4 + 2] - imgCycles.rgba[i * 4 + 2];
    const absPx = (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / 3.0;
    const quadPx = (dr * dr + dg * dg + db * db) / 3.0;
    somaAbs += absPx;
    somaQuad += quadPx;

    const x = i % imgCycles.largura;
    const y = Math.floor(i / imgCycles.largura);
    if (x >= xIniRoi && x < xFimRoi && y >= yIniRoi && y < yFimRoi) {
      somaAbsRoi += absPx;
      somaQuadRoi += quadPx;
      nRoi += 1;
    }

    const mc = stCycles._mascaraSilhueta[i];
    const me = stEevee._mascaraSilhueta[i];
    if (mc && me) interSilhueta += 1;
    if (mc || me) uniaoSilhueta += 1;
  }

  const mae = somaAbs / totalPx;
  const mse = somaQuad / totalPx;
  const rmse = Math.sqrt(mse);
  const psnr = mse > 1e-9 ? 10 * Math.log10((255 * 255) / mse) : 99.0;
  const maeRoi = nRoi > 0 ? somaAbsRoi / nRoi : mae;
  const mseRoi = nRoi > 0 ? somaQuadRoi / nRoi : mse;
  const psnrRoi = mseRoi > 1e-9 ? 10 * Math.log10((255 * 255) / mseRoi) : 99.0;
  const iou = uniaoSilhueta > 0 ? interSilhueta / uniaoSilhueta : 0;

  if (caminhoLadoALado) {
    const largDiv = 4;
    const W = imgCycles.largura;
    const largTotal = W * 3 + largDiv * 2;
    const altTotal = imgCycles.altura;
    const rgbComp = Buffer.alloc(largTotal * altTotal * 3);
    for (let y = 0; y < altTotal; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const orig = (y * W + x) * 4;
        const rc = imgCycles.rgba[orig];
        const gc = imgCycles.rgba[orig + 1];
        const bc = imgCycles.rgba[orig + 2];
        const re = imgEevee.rgba[orig];
        const ge = imgEevee.rgba[orig + 1];
        const be = imgEevee.rgba[orig + 2];

        const dEsq = (y * largTotal + x) * 3;
        rgbComp[dEsq] = rc;
        rgbComp[dEsq + 1] = gc;
        rgbComp[dEsq + 2] = bc;

        const dMeioImg = (y * largTotal + W + largDiv + x) * 3;
        rgbComp[dMeioImg] = re;
        rgbComp[dMeioImg + 1] = ge;
        rgbComp[dMeioImg + 2] = be;

        const dDif = (y * largTotal + (W + largDiv) * 2 + x) * 3;
        rgbComp[dDif] = Math.min(255, Math.abs(re - rc) * 4);
        rgbComp[dDif + 1] = Math.min(255, Math.abs(ge - gc) * 4);
        rgbComp[dDif + 2] = Math.min(255, Math.abs(be - bc) * 4);
      }
      for (let dx = 0; dx < largDiv; dx += 1) {
        for (const baseX of [W + dx, W * 2 + largDiv + dx]) {
          const dDiv = (y * largTotal + baseX) * 3;
          rgbComp[dDiv] = 196;
          rgbComp[dDiv + 1] = 148;
          rgbComp[dDiv + 2] = 88;
        }
      }
    }
    fs.writeFileSync(caminhoLadoALado, codificarPngRgb(largTotal, altTotal, rgbComp));
  }

  return {
    mae_rgb_0_255: Number(mae.toFixed(2)),
    mae_pct: Number(((mae / 255) * 100).toFixed(2)),
    rmse_rgb_0_255: Number(rmse.toFixed(2)),
    psnr_db: Number(psnr.toFixed(2)),
    mae_roi_personagem_0_255: Number(maeRoi.toFixed(2)),
    mae_roi_personagem_pct: Number(((maeRoi / 255) * 100).toFixed(2)),
    psnr_roi_personagem_db: Number(psnrRoi.toFixed(2)),
    iou_silhueta: Number(iou.toFixed(4)),
    delta_luminancia_media_eevee_menos_cycles: Number(
      (stEevee.luminancia_media_0_255 - stCycles.luminancia_media_0_255).toFixed(2)
    ),
    prancha_lado_a_lado: caminhoLadoALado ? path.basename(caminhoLadoALado) : null,
  };
}

function removerCamposInternos(st) {
  if (!st) return null;
  const copia = { ...st };
  delete copia._mascaraSilhueta;
  return copia;
}

function gerarMarkdownRelatorio(rel) {
  const linhas = [];
  linhas.push("# Relatório Técnico — Comparação de Motores 3D (Cycles vs EEVEE)");
  linhas.push("");
  linhas.push(`- **Gerado em (UTC):** \`${rel.gerado_em_utc}\``);
  linhas.push(`- **Blender:** \`${rel.ambiente?.blender?.versao || "?"}\` (motores: \`${(rel.ambiente?.blender?.motores_disponiveis || []).join(", ")}\`)`);
  linhas.push(`- **Sistema / CPU / RAM:** \`${rel.ambiente?.sistema?.os || "?"}\` · \`${rel.ambiente?.sistema?.cpu || "?"}\` (${rel.ambiente?.sistema?.vcpus || "?"} vCPUs) · \`${rel.ambiente?.sistema?.ram_total_mb || "?"} MiB\``);
  linhas.push(`- **Contexto OpenGL Headless:** \`${rel.opengl?.resumo_contexto || "não identificado"}\``);
  linhas.push(`- **Resolução e Amostragem:** \`${rel.parametros_comparacao.largura_px}×${rel.parametros_comparacao.altura_px} px\` · Cycles \`${rel.parametros_comparacao.amostras_cycles}\` amostras · EEVEE \`${rel.parametros_comparacao.amostras_eevee}\` amostras`);
  linhas.push(`- **Status de decisão:** \`${rel.decisao_motor}\` *(nenhum motor foi aprovado automaticamente)*`);
  linhas.push("");

  linhas.push("## 1. Auditoria dos Modelos Originais (`modelos-3d-originais`)");
  linhas.push("");
  linhas.push("| Personagem | Anexo original | Bytes | SHA-256 | Confere Release | Formato real | Meshopt no original | Vértices | Triângulos | Materiais | Ossos |");
  linhas.push("| --- | --- | ---: | --- | :---: | --- | :---: | ---: | ---: | ---: | ---: |");
  for (const m of rel.modelos_auditados) {
    const tot = m.totais_cena || {};
    linhas.push(
      `| **${m.personagem}** | \`${m.nome_arquivo_original}\` | ${m.bytes_original} | \`${m.sha256_original}\` | ` +
      `${m.sha256_confere_release === true ? "SIM" : m.sha256_confere_release === false ? "NÃO" : "—"} | ` +
      `${m.formato_binario_detectado} | ${m.usa_meshopt_no_original ? "SIM" : "NÃO"} | ` +
      `${tot.vertices ?? "—"} | ${tot.triangulos ?? "—"} | ${tot.materiais ?? "—"} | ${tot.ossos ?? "—"} |`
    );
  }
  linhas.push("");
  linhas.push(`- **Critério de classificação dos personagens:** ${rel.criterio_classificacao_personagens}`);
  linhas.push("");

  linhas.push("## 2. Compatibilidade com Blender 4.2.1 e Meshopt");
  linhas.push("");
  linhas.push("| Anexo original | Extensões glTF (`extensionsUsed`) | Importação direta `.bin` | Importação direta `.glb` intacto | Teste Meshopt (`EXT_meshopt_compression`) | Variante usada no render |");
  linhas.push("| --- | --- | --- | --- | --- | --- |");
  for (const m of rel.modelos_auditados) {
    const extTxt = m.extensoes_gltf_usadas.length ? m.extensoes_gltf_usadas.map(e => `\`${e}\``).join(", ") : "nenhuma";
    const tBin = m.compatibilidade_importacao.bin_direto;
    const tGlb = m.compatibilidade_importacao.glb_intacto_direto;
    const tSonda = m.compatibilidade_importacao.sonda_meshopt_blender_4_2_1;
    const binStr = tBin?.sucesso ? "OK" : `FALHOU (${tBin?.erro || "erro"})`;
    const glbStr = tGlb ? (tGlb.sucesso ? "OK" : `FALHOU (${tGlb.erro || "erro"})`) : "—";
    let meshoptStr = "—";
    if (m.usa_meshopt_no_original) {
      meshoptStr = m.meshopt_operacao?.sucesso
        ? `Original usa Meshopt; decodificado via meshoptimizer (${m.meshopt_operacao.bytes_antes} → ${m.meshopt_operacao.bytes_depois_sem_meshopt} B)`
        : `Falha ao decodificar Meshopt (${m.meshopt_operacao?.erro || "erro"})`;
    } else if (tSonda) {
      meshoptStr = tSonda.sucesso
        ? "Sonda Meshopt importou no Blender 4.2.1"
        : `Sonda Meshopt rejeitada pelo Blender 4.2.1 (${tSonda.erro}); round-trip via meshoptimizer OK`;
    }
    linhas.push(`| \`${m.nome_arquivo_original}\` | ${extTxt} | ${binStr} | ${glbStr} | ${meshoptStr} | \`${m.origem_modelo_render || "nenhuma"}\` |`);
  }
  linhas.push("");

  linhas.push("## 3. Auditoria de Esqueleto e Pose");
  linhas.push("");
  for (const m of rel.modelos_auditados) {
    const p = m.pose_compatibilidade || {};
    linhas.push(`### ${m.personagem} (\`${m.nome_arquivo_original}\`)`);
    linhas.push(`- **Possui armadura (` + "`ARMATURE`" + `):** ${p.tem_armadura ? "SIM" : "NÃO"} (${m.totais_cena?.ossos ?? 0} ossos)`);
    linhas.push(`- **Possui skinning ativo na malha:** ${p.tem_skin_ativo ? "SIM" : "NÃO"}`);
    linhas.push(`- **Compatível diretamente com os clipes de 16 ossos atuais do FORJA:** ${p.compativel_direto_forja_16_ossos ? "SIM" : "NÃO"} (${(p.ossos_forja_exatos || []).length}/16 nomes exatos; ${Object.keys(p.ossos_humanoides_mapeaveis || {}).length}/15 ossos humanoides mapeáveis)`);
    if (p.mapeamento_biblioteca_forja) {
      const mb = p.mapeamento_biblioteca_forja;
      linhas.push(
        `- **Mapeador oficial \`tools/lib/mapeamento-ossos.mjs\`:** \`${Object.keys(mb.mapa || {}).length}/15\` ossos casados ` +
        `(exatos: \`${mb.passadas?.exata ?? 0}\`, normalizados: \`${mb.passadas?.normalizada ?? 0}\`, faltando: \`${(mb.faltando || []).join(", ") || "nenhum"}\`)`
      );
    }
    if (p.teste_deformacao_skin) {
      const td = p.teste_deformacao_skin;
      linhas.push(`- **Teste reversível de deformação de skin:** osso \`${td.osso_testado}\` moveu \`${td.vertices_movidos}/${td.amostras_comparadas}\` vértices amostrados (deslocamento máx. \`${td.deslocamento_max_m} m\`)`);
    }
    if (p.erros_pose?.length) {
      for (const ep of p.erros_pose) linhas.push(`- **Observação/Erro real de pose:** ${ep}`);
    }
    linhas.push("");
  }

  linhas.push("## 4. Tempo de Renderização e Memória Medidos (Processos Isolados)");
  linhas.push("");
  linhas.push("| Personagem | Motor (`engine_id`) | Status | Importação (s) | Prep. Cena (s) | Render Frio — 1º quadro (s) | Render Quente — 2º quadro (s) | CPU Frio (s) | RSS Pós-Render (MiB) | Pico RSS Kernel `VmHWM` (MiB) | PNG Gerado |");
  linhas.push("| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const ex of rel.execucoes_render) {
    const t = ex.tempos_s || {};
    const mem = ex.memoria_mb || {};
    linhas.push(
      `| **${ex.personagem}** | \`${ex.engine_id_blender || ex.motor}\` | ${ex.sucesso ? "OK" : "FALHA"} | ` +
      `${t.importacao ?? "—"} | ${t.preparacao_cena ?? "—"} | **${t.render_frio ?? "—"}** | **${t.render_quente ?? "—"}** | ` +
      `${t.cpu_frio_total ?? "—"} | ${mem.rss_pos_render_frio ?? "—"} | **${mem.pico_rss_hwm_processo ?? "—"}** | ` +
      `\`${ex.arquivo_png || "—"}\` (${ex.png_bytes ? `${(ex.png_bytes / 1024).toFixed(1)} KiB` : "—"}) |`
    );
  }
  linhas.push("");

  linhas.push("## 5. Comparação Quantitativa e Visual (Pixels Reais Cycles vs EEVEE)");
  linhas.push("");
  linhas.push("| Personagem | Luminância Média (Cycles / EEVEE) | Cobertura Silhueta % (Cycles / EEVEE) | Pixels Magenta (Textura Ausente) | IoU de Silhueta | MAE Quadro (0–255) | MAE Região Personagem | PSNR Quadro / ROI (dB) | Razão Tempo Frio / Quente (Cycles÷EEVEE) |");
  linhas.push("| --- | :---: | :---: | :---: | ---: | ---: | ---: | ---: | ---: |");
  for (const comp of rel.comparativo_por_personagem) {
    const sc = comp.metricas_imagem_cycles;
    const se = comp.metricas_imagem_eevee;
    const px = comp.diferenca_pixels || {};
    linhas.push(
      `| **${comp.personagem}** | ${sc?.luminancia_media_0_255 ?? "—"} / ${se?.luminancia_media_0_255 ?? "—"} | ` +
      `${sc?.cobertura_silhueta_pct ?? "—"}% / ${se?.cobertura_silhueta_pct ?? "—"}% | ` +
      `${sc?.pixels_magenta_textura_ausente ?? "—"} / ${se?.pixels_magenta_textura_ausente ?? "—"} | ` +
      `${px.iou_silhueta ?? "—"} | ${px.mae_rgb_0_255 ?? "—"} (${px.mae_pct ?? "—"}%) | ` +
      `${px.mae_roi_personagem_0_255 ?? "—"} (${px.mae_roi_personagem_pct ?? "—"}%) | ` +
      `${px.psnr_db ?? "—"} / ${px.psnr_roi_personagem_db ?? "—"} | ` +
      `${comp.razao_tempo_frio_cycles_sobre_eevee ?? "—"}× / ${comp.razao_tempo_quente_cycles_sobre_eevee ?? "—"}× |`
    );
  }
  linhas.push("");

  linhas.push("## 6. Erros Reais, Limitações e Pontos de Atenção");
  linhas.push("");
  if (rel.erros_e_limitacoes.length === 0) {
    linhas.push("- Nenhuma falha registrada.");
  } else {
    for (const item of rel.erros_e_limitacoes) {
      linhas.push(`- **[${item.categoria}]** ${item.mensagem}`);
    }
  }
  linhas.push("");

  linhas.push("## 7. Próximo Passo");
  linhas.push("");
  linhas.push(
    "Nenhum motor foi aprovado automaticamente nesta etapa. Os PNGs individuais, pranchas comparativas, " +
    "logs completos (`importacao.log`, `meshopt.log`, `opengl.log` e logs por motor) e este relatório " +
    "estão prontos para revisão e decisão humana antes de qualquer produção de vídeos ou publicação no app."
  );
  linhas.push("");

  return linhas.join("\n");
}

function executarResumir(args) {
  const entradaCaminho = path.resolve(args.entrada);
  const bruto = JSON.parse(fs.readFileSync(entradaCaminho, "utf8"));
  const prep = args.preparacao && fs.existsSync(args.preparacao)
    ? JSON.parse(fs.readFileSync(path.resolve(args.preparacao), "utf8"))
    : null;
  const openglAmb = args["opengl-json"] && fs.existsSync(args["opengl-json"])
    ? JSON.parse(fs.readFileSync(path.resolve(args["opengl-json"]), "utf8"))
    : null;
  const sistemaAmb = args["ambiente-json"] && fs.existsSync(args["ambiente-json"])
    ? JSON.parse(fs.readFileSync(path.resolve(args["ambiente-json"]), "utf8"))
    : null;

  const saidaDir = path.dirname(path.resolve(args["saida-json"]));
  fs.mkdirSync(saidaDir, { recursive: true });

  const mapaPrepPorNome = {};
  for (const arq of prep?.arquivos || []) {
    mapaPrepPorNome[arq.nome_arquivo] = arq;
  }

  const errosELimitacoes = [];

  const modelosAuditados = (bruto.auditoria?.modelos || []).map(m => {
    const pItem = mapaPrepPorNome[m.nome_arquivo_original] || {};
    const tImp = m.testes_importacao_blender || {};

    if (tImp.bin_direto && !tImp.bin_direto.sucesso) {
      errosELimitacoes.push({
        categoria: "importacao_bin_direta",
        personagem: m.personagem,
        arquivo: m.nome_arquivo_original,
        mensagem: `Importação direta de '${m.nome_arquivo_original}' falhou no Blender 4.2.1: ${tImp.bin_direto.erro}`,
      });
    }
    if (tImp.glb_intacto_direto && !tImp.glb_intacto_direto.sucesso) {
      errosELimitacoes.push({
        categoria: "importacao_glb_direta",
        personagem: m.personagem,
        arquivo: m.nome_arquivo_original,
        mensagem: `Importação direta do GLB original no Blender 4.2.1 falhou sem pré-decodificação: ${tImp.glb_intacto_direto.erro}`,
      });
    }
    if (tImp.sonda_meshopt_blender_4_2_1 && !tImp.sonda_meshopt_blender_4_2_1.sucesso) {
      errosELimitacoes.push({
        categoria: "meshopt_blender_4_2_1",
        personagem: m.personagem,
        arquivo: m.nome_arquivo_original,
        mensagem: `Blender 4.2.1 rejeitou diretamente EXT_meshopt_compression na sonda real: ${tImp.sonda_meshopt_blender_4_2_1.erro}`,
      });
    }
    if (pItem.teste_three_gltfloader_sem_meshopt && !pItem.teste_three_gltfloader_sem_meshopt.sucesso_sem_decoder_meshopt) {
      errosELimitacoes.push({
        categoria: "three_gltfloader_meshopt",
        personagem: m.personagem,
        arquivo: m.nome_arquivo_original,
        mensagem: `GLTFLoader atual do app sem MeshoptDecoder rejeitou o arquivo original: ${pItem.teste_three_gltfloader_sem_meshopt.erro}`,
      });
    }
    for (const ep of m.inspecao_cena?.pose_compatibilidade?.erros_pose || []) {
      errosELimitacoes.push({
        categoria: "pose_esqueleto",
        personagem: m.personagem,
        arquivo: m.nome_arquivo_original,
        mensagem: ep,
      });
    }

    const poseCompBase = m.inspecao_cena?.pose_compatibilidade
      ? { ...m.inspecao_cena.pose_compatibilidade }
      : null;
    const todosOssos = m.inspecao_cena?.armaduras?.[0]?.todos_ossos || [];
    if (poseCompBase && todosOssos.length > 0) {
      poseCompBase.mapeamento_biblioteca_forja = mapearOssos(todosOssos);
    }

    return {
      personagem: m.personagem,
      criterio_classificacao: m.criterio_classificacao,
      nome_arquivo_original: m.nome_arquivo_original,
      bytes_original: m.bytes_original,
      sha256_original: m.sha256_original,
      sha256_confere_release: m.sha256_confere_release,
      formato_binario_detectado: m.formato_binario_detectado,
      usa_meshopt_no_original: m.usa_meshopt_no_original,
      extensoes_gltf_usadas: m.extensoes_gltf_usadas || [],
      extensoes_gltf_obrigatorias: m.extensoes_gltf_obrigatorias || [],
      glb_json_resumo: pItem.glb_json_resumo || null,
      meshopt_operacao: pItem.operacao_meshopt || null,
      teste_three_gltfloader_sem_meshopt: pItem.teste_three_gltfloader_sem_meshopt || null,
      compatibilidade_importacao: {
        bin_direto: tImp.bin_direto
          ? { sucesso: tImp.bin_direto.sucesso, tempo_s: tImp.bin_direto.tempo_s, erro: tImp.bin_direto.erro }
          : null,
        glb_intacto_direto: tImp.glb_intacto_direto
          ? { sucesso: tImp.glb_intacto_direto.sucesso, tempo_s: tImp.glb_intacto_direto.tempo_s, erro: tImp.glb_intacto_direto.erro }
          : null,
        sonda_meshopt_blender_4_2_1: tImp.sonda_meshopt_blender_4_2_1
          ? { sucesso: tImp.sonda_meshopt_blender_4_2_1.sucesso, erro: tImp.sonda_meshopt_blender_4_2_1.erro }
          : null,
        modelo_preparado_render: tImp.modelo_preparado_render
          ? { sucesso: tImp.modelo_preparado_render.sucesso, tempo_s: tImp.modelo_preparado_render.tempo_s, erro: tImp.modelo_preparado_render.erro }
          : null,
      },
      origem_modelo_render: m.origem_modelo_render,
      geometria_mundo: m.inspecao_cena?.geometria_mundo || null,
      totais_cena: m.inspecao_cena?.totais || null,
      materiais: m.inspecao_cena?.materiais || [],
      armaduras: (m.inspecao_cena?.armaduras || []).map(a => ({
        nome: a.nome,
        ossos: a.ossos,
        raizes: a.raizes,
        amostra_ossos: a.amostra_ossos,
        vao_ombros_m: a.vao_ombros_m,
        vao_quadril_m: a.vao_quadril_m,
        razao_ombro_quadril_ossos: a.razao_ombro_quadril_ossos,
      })),
      acoes: m.inspecao_cena?.acoes || [],
      pose_compatibilidade: poseCompBase,
      evidencias_genero: m.evidencias_genero || null,
    };
  });

  const imagensDecodificadas = {};
  const estatisticasPorChave = {};

  const execucoesLimpa = (bruto.execucoes || []).map(ex => {
    const chave = `${ex.personagem}:${ex.motor}`;
    let stImg = null;
    if (ex.sucesso && ex.saida_png && fs.existsSync(ex.saida_png)) {
      try {
        const dec = decodificarPngRgba(ex.saida_png);
        imagensDecodificadas[chave] = dec;
        stImg = estatisticasImagem(dec);
        estatisticasPorChave[chave] = stImg;
        if (stImg.pixels_magenta_textura_ausente > 0) {
          errosELimitacoes.push({
            categoria: "textura_ausente_magenta",
            personagem: ex.personagem,
            motor: ex.motor,
            mensagem: `Foram detectados ${stImg.pixels_magenta_textura_ausente} pixels magenta em ${path.basename(ex.saida_png)} (possível textura ausente).`,
          });
        }
      } catch (err) {
        errosELimitacoes.push({
          categoria: "leitura_png",
          personagem: ex.personagem,
          motor: ex.motor,
          mensagem: `Falha ao decodificar PNG de ${chave}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else if (!ex.sucesso) {
      errosELimitacoes.push({
        categoria: "renderizacao",
        personagem: ex.personagem,
        motor: ex.motor,
        mensagem: `Renderização ${ex.personagem} × ${ex.motor} falhou: ${ex.erro || "erro desconhecido"}`,
      });
    }

    return {
      personagem: ex.personagem,
      motor: ex.motor,
      engine_id_blender: ex.configuracao_motor?.engine_id_blender || null,
      sucesso: Boolean(ex.sucesso),
      arquivo_png: ex.saida_png ? path.basename(ex.saida_png) : null,
      png_bytes: ex.png_bytes || null,
      arquivo_log: ex.arquivo_log || null,
      tempos_s: ex.tempos_s || null,
      tempo_parede_subprocesso_s: ex.tempo_parede_subprocesso_s || null,
      memoria_mb: ex.memoria_mb || null,
      configuracao_motor: ex.configuracao_motor || null,
      cena: ex.cena || null,
      gpu_opengl: ex.gpu_opengl || null,
      metricas_imagem: removerCamposInternos(stImg),
      avisos_render: ex.avisos_render || [],
      erro: ex.erro || null,
    };
  });

  // Limitações estruturais de ambiente (ex.: renderização EEVEE via software rasterizer llvmpipe em CI sem GPU física)
  const gpuEevee = execucoesLimpa.find(e => e.motor === "EEVEE" && e.gpu_opengl?.disponivel)?.gpu_opengl;
  if (gpuEevee && /llvmpipe|softpipe|swrast/i.test(String(gpuEevee.renderer || ""))) {
    errosELimitacoes.push({
      categoria: "ambiente_opengl_software",
      mensagem:
        `No runner GitHub Actions sem GPU dedicada, o EEVEE (${gpuEevee.version}) executou sobre rasterizador OpenGL por software ` +
        `(${gpuEevee.renderer}). Em hardware com GPU física dedicada, o tempo do EEVEE tende a cair significativamente, enquanto ` +
        `artefatos de sombra/iluminação indireta permanecem característicos do motor.`,
    });
  }

  const personagensUnicos = [...new Set(modelosAuditados.map(m => m.personagem))];
  const comparativoPorPersonagem = personagensUnicos.map(personagem => {
    const exC = execucoesLimpa.find(e => e.personagem === personagem && e.motor === "CYCLES");
    const exE = execucoesLimpa.find(e => e.personagem === personagem && e.motor === "EEVEE");
    const imgC = imagensDecodificadas[`${personagem}:CYCLES`];
    const imgE = imagensDecodificadas[`${personagem}:EEVEE`];
    const stC = estatisticasPorChave[`${personagem}:CYCLES`];
    const stE = estatisticasPorChave[`${personagem}:EEVEE`];

    let difPixels = null;
    if (imgC && imgE && stC && stE) {
      const prancha = path.join(saidaDir, `comparativo-${personagem}-cycles-vs-eevee.png`);
      difPixels = compararParImagens(imgC, stC, imgE, stE, prancha);
    }

    const tFrioC = exC?.tempos_s?.render_frio;
    const tFrioE = exE?.tempos_s?.render_frio;
    const tQuenteC = exC?.tempos_s?.render_quente;
    const tQuenteE = exE?.tempos_s?.render_quente;
    const memC = exC?.memoria_mb?.pico_rss_hwm_processo;
    const memE = exE?.memoria_mb?.pico_rss_hwm_processo;

    return {
      personagem,
      paridade_cena_verificada: Boolean(
        exC?.cena && exE?.cena &&
        JSON.stringify(exC.cena.camera) === JSON.stringify(exE.cena.camera) &&
        JSON.stringify(exC.cena.resolucao_px) === JSON.stringify(exE.cena.resolucao_px) &&
        JSON.stringify(exC.cena.luzes) === JSON.stringify(exE.cena.luzes)
      ),
      razao_tempo_frio_cycles_sobre_eevee:
        tFrioC && tFrioE ? Number((tFrioC / tFrioE).toFixed(2)) : null,
      razao_tempo_quente_cycles_sobre_eevee:
        tQuenteC && tQuenteE ? Number((tQuenteC / tQuenteE).toFixed(2)) : null,
      razao_memoria_pico_cycles_sobre_eevee:
        memC && memE ? Number((memC / memE).toFixed(2)) : null,
      metricas_imagem_cycles: removerCamposInternos(stC),
      metricas_imagem_eevee: removerCamposInternos(stE),
      diferenca_pixels: difPixels,
    };
  });

  const resumoContextoGl = gpuEevee
    ? `${gpuEevee.vendor} | ${gpuEevee.renderer} | ${gpuEevee.version} (${gpuEevee.backend || "OPENGL"})`
    : (openglAmb?.resumo || "não disponível");

  const relatorioFinal = {
    gerado_em_utc: new Date().toISOString(),
    decisao_motor: "aguardando_aprovacao_humana",
    nota_governanca:
      "Comparação concluída sem aprovação automática de motor, sem alteração nos recursos publicados do aplicativo e sem avanço para produção de vídeos.",
    parametros_comparacao: bruto.parametros_comparacao,
    ambiente: {
      sistema: sistemaAmb,
      blender: bruto.auditoria?.blender || null,
      ferramentas_meshopt: prep?.ferramentas_meshopt || null,
    },
    opengl: {
      resumo_contexto: resumoContextoGl,
      detalhes_ambiente: openglAmb,
      gpu_blender_eevee: gpuEevee || null,
    },
    criterio_classificacao_personagens: bruto.auditoria?.criterio_classificacao_personagens || null,
    modelos_auditados: modelosAuditados,
    execucoes_render: execucoesLimpa,
    comparativo_por_personagem: comparativoPorPersonagem,
    erros_e_limitacoes: errosELimitacoes,
  };

  const saidaJson = path.resolve(args["saida-json"]);
  fs.writeFileSync(saidaJson, JSON.stringify(relatorioFinal, null, 2), "utf8");

  if (args["saida-md"]) {
    const md = gerarMarkdownRelatorio(relatorioFinal);
    fs.writeFileSync(path.resolve(args["saida-md"]), md, "utf8");
  }

  console.log("[resumir] concluído:", JSON.stringify({
    saida_json: path.relative(RAIZ_REPO, saidaJson),
    saida_md: args["saida-md"] ? path.relative(RAIZ_REPO, path.resolve(args["saida-md"])) : null,
    execucoes_ok: execucoesLimpa.filter(e => e.sucesso).length,
    execucoes_total: execucoesLimpa.length,
    erros_e_limitacoes: errosELimitacoes.length,
  }));
}

const args = parseArgs(process.argv.slice(2));
const modo = args.modo || (args["originais-dir"] ? "preparar-meshopt" : "resumir");

if (modo === "preparar-meshopt") {
  await executarPrepararMeshopt(args);
} else if (modo === "resumir") {
  if (!args.entrada || !args["saida-json"]) {
    console.error(
      "Uso: node tools/resumir-comparacao-motores.mjs --entrada <comparacao-bruta.json> --saida-json <relatorio.json> [--saida-md <relatorio.md>]"
    );
    process.exit(2);
  }
  executarResumir(args);
} else {
  console.error(`Modo desconhecido: ${modo}`);
  process.exit(2);
}
