# Relatório Técnico — Comparação de Motores 3D (Cycles vs EEVEE)

- **Gerado em (UTC):** `2026-11-01T19:37:41.692Z`
- **Blender:** `4.2.1 LTS` (motores: `BLENDER_EEVEE_NEXT, CYCLES`)
- **Sistema / CPU / RAM:** `Ubuntu 24.04.5 LTS` · `AMD EPYC 7763 64-Core Processor` (4 vCPUs) · `15984 MiB`
- **Contexto OpenGL Headless:** `Mesa | llvmpipe (LLVM 20.1.2, 256 bits) | 4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4 (OPENGL)`
- **Resolução e Amostragem:** `720×960 px` · Cycles `64` amostras · EEVEE `64` amostras
- **Status de decisão:** `aguardando_aprovacao_humana` *(nenhum motor foi aprovado automaticamente)*

## 1. Auditoria dos Modelos Originais (`modelos-3d-originais`)

| Personagem | Anexo original | Bytes | SHA-256 | Confere Release | Formato real | Meshopt no original | Vértices | Triângulos | Materiais | Ossos |
| --- | --- | ---: | --- | :---: | --- | :---: | ---: | ---: | ---: | ---: |
| **masculino** | `DOC-20261031-WA0008.bin` | 20465552 | `ad3ac1c95ef9c3850d4780bbd4108008833dc6b4f18786e60bef213e533280d1` | SIM | GLB | SIM | 1014138 | 1983343 | 1 | 78 |
| **feminino** | `DOC-20261031-WA0009.bin` | 20650336 | `7f294533acd9a278cf53332170ffcdb4bbed26aacbee66a7d9b5ea3d67966077` | SIM | GLB | SIM | 1014840 | 1972827 | 1 | 78 |

- **Critério de classificação dos personagens:** razão articular ombro/quadril do esqueleto (1.7428 vs 1.2774)

## 2. Compatibilidade com Blender 4.2.1 e Meshopt

| Anexo original | Extensões glTF (`extensionsUsed`) | Importação direta `.bin` | Importação direta `.glb` intacto | Teste Meshopt (`EXT_meshopt_compression`) | Variante usada no render |
| --- | --- | --- | --- | --- | --- |
| `DOC-20261031-WA0008.bin` | `KHR_mesh_quantization`, `EXT_meshopt_compression` | FALHOU (RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version
) | FALHOU (RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version
) | Original usa Meshopt; decodificado via meshoptimizer (20465552 → 65294796 B) | `glb_meshopt_decodificado` |
| `DOC-20261031-WA0009.bin` | `KHR_mesh_quantization`, `EXT_meshopt_compression` | FALHOU (RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version
) | FALHOU (RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version
) | Original usa Meshopt; decodificado via meshoptimizer (20650336 → 65208348 B) | `glb_meshopt_decodificado` |

## 3. Auditoria de Esqueleto e Pose

### masculino (`DOC-20261031-WA0008.bin`)
- **Possui armadura (`ARMATURE`):** SIM (78 ossos)
- **Possui skinning ativo na malha:** SIM
- **Compatível diretamente com os clipes de 16 ossos atuais do FORJA:** NÃO (0/16 nomes exatos; 15/15 ossos humanoides mapeáveis)
- **Mapeador oficial `tools/lib/mapeamento-ossos.mjs`:** `15/15` ossos casados (exatos: `1`, normalizados: `14`, faltando: `nenhum`)
- **Teste reversível de deformação de skin:** osso `L_Upperarm` moveu `305/2001` vértices amostrados (deslocamento máx. `0.1516 m`)
- **Observação/Erro real de pose:** Incompatibilidade direta com os clipes atuais de 16 ossos do FORJA: apenas 0/16 nomes exatos presentes (mapeáveis por normalização humanoide: 15/15).

### feminino (`DOC-20261031-WA0009.bin`)
- **Possui armadura (`ARMATURE`):** SIM (78 ossos)
- **Possui skinning ativo na malha:** SIM
- **Compatível diretamente com os clipes de 16 ossos atuais do FORJA:** NÃO (0/16 nomes exatos; 15/15 ossos humanoides mapeáveis)
- **Mapeador oficial `tools/lib/mapeamento-ossos.mjs`:** `15/15` ossos casados (exatos: `1`, normalizados: `14`, faltando: `nenhum`)
- **Teste reversível de deformação de skin:** osso `L_Upperarm` moveu `247/2002` vértices amostrados (deslocamento máx. `0.153 m`)
- **Observação/Erro real de pose:** Incompatibilidade direta com os clipes atuais de 16 ossos do FORJA: apenas 0/16 nomes exatos presentes (mapeáveis por normalização humanoide: 15/15).

## 4. Tempo de Renderização e Memória Medidos (Processos Isolados)

| Personagem | Motor (`engine_id`) | Status | Importação (s) | Prep. Cena (s) | Render Frio — 1º quadro (s) | Render Quente — 2º quadro (s) | CPU Frio (s) | RSS Pós-Render (MiB) | Pico RSS Kernel `VmHWM` (MiB) | PNG Gerado |
| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| **masculino** | `CYCLES` | OK | 5.5611 | 0.995 | **67.7624** | **67.7415** | 267.3232 | 707.89 | **1621.56** | `masculino-cycles.png` (847.9 KiB) |
| **masculino** | `BLENDER_EEVEE_NEXT` | OK | 5.594 | 1.0343 | **123.9143** | **115.5173** | 334.2751 | 1850.45 | **3080.79** | `masculino-eevee.png` (698.5 KiB) |
| **feminino** | `CYCLES` | OK | 5.7405 | 1.0254 | **67.2802** | **67.201** | 265.6098 | 708.62 | **1613.47** | `feminino-cycles.png` (829.0 KiB) |
| **feminino** | `BLENDER_EEVEE_NEXT` | OK | 5.6763 | 1.0256 | **118.9556** | **117.2069** | 325.8498 | 1714.63 | **2939.98** | `feminino-eevee.png` (683.2 KiB) |

## 5. Comparação Quantitativa e Visual (Pixels Reais Cycles vs EEVEE)

| Personagem | Luminância Média (Cycles / EEVEE) | Cobertura Silhueta % (Cycles / EEVEE) | Pixels Magenta (Textura Ausente) | IoU de Silhueta | MAE Quadro (0–255) | MAE Região Personagem | PSNR Quadro / ROI (dB) | Razão Tempo Frio / Quente (Cycles÷EEVEE) |
| --- | :---: | :---: | :---: | ---: | ---: | ---: | ---: | ---: |
| **masculino** | 89.81 / 86.6 | 55.53% / 54.67% | 0 / 0 | 0.9674 | 4.77 (1.87%) | 5.17 (2.03%) | 32.2 / 31.1 | 0.55× / 0.59× |
| **feminino** | 89.54 / 86.48 | 54.55% / 53.38% | 0 / 0 | 0.9639 | 4.76 (1.86%) | 5.13 (2.01%) | 31.95 / 30.84 | 0.57× / 0.57× |

## 6. Erros Reais, Limitações e Pontos de Atenção

- **[importacao_bin_direta]** Importação direta de 'DOC-20261031-WA0008.bin' falhou no Blender 4.2.1: RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version

- **[importacao_glb_direta]** Importação direta do GLB original no Blender 4.2.1 falhou sem pré-decodificação: RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version

- **[three_gltfloader_meshopt]** GLTFLoader atual do app sem MeshoptDecoder rejeitou o arquivo original: THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files
- **[pose_esqueleto]** Incompatibilidade direta com os clipes atuais de 16 ossos do FORJA: apenas 0/16 nomes exatos presentes (mapeáveis por normalização humanoide: 15/15).
- **[importacao_bin_direta]** Importação direta de 'DOC-20261031-WA0009.bin' falhou no Blender 4.2.1: RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version

- **[importacao_glb_direta]** Importação direta do GLB original no Blender 4.2.1 falhou sem pré-decodificação: RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version

- **[three_gltfloader_meshopt]** GLTFLoader atual do app sem MeshoptDecoder rejeitou o arquivo original: THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files
- **[pose_esqueleto]** Incompatibilidade direta com os clipes atuais de 16 ossos do FORJA: apenas 0/16 nomes exatos presentes (mapeáveis por normalização humanoide: 15/15).
- **[ambiente_opengl_software]** No runner GitHub Actions sem GPU dedicada, o EEVEE (4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4) executou sobre rasterizador OpenGL por software (llvmpipe (LLVM 20.1.2, 256 bits)). Em hardware com GPU física dedicada, o tempo do EEVEE tende a cair significativamente, enquanto artefatos de sombra/iluminação indireta permanecem característicos do motor.

## 7. Próximo Passo

Nenhum motor foi aprovado automaticamente nesta etapa. Os PNGs individuais, pranchas comparativas, logs completos (`importacao.log`, `meshopt.log`, `opengl.log` e logs por motor) e este relatório estão prontos para revisão e decisão humana antes de qualquer produção de vídeos ou publicação no app.
