# Relatório Técnico — Comparação de Motores 3D (Cycles vs EEVEE)

- **Gerado em (UTC):** `2026-11-01T19:10:49.026Z`
- **Blender:** `4.2.1 LTS` (motores: `BLENDER_EEVEE_NEXT`)
- **Sistema / CPU / RAM:** `Ubuntu 24.04.5 LTS` · `AMD EPYC 9V74 80-Core Processor` (4 vCPUs) · `15984 MiB`
- **Contexto OpenGL Headless:** `Mesa | llvmpipe (LLVM 20.1.2, 256 bits) | 4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4 (OPENGL)`
- **Resolução e Amostragem:** `720×960 px` · Cycles `64` amostras · EEVEE `64` amostras
- **Status de decisão:** `aguardando_aprovacao_humana` *(nenhum motor foi aprovado automaticamente)*

## 1. Auditoria dos Modelos Originais (`modelos-3d-originais`)

| Personagem | Anexo original | Bytes | SHA-256 | Confere Release | Formato real | Meshopt no original | Vértices | Triângulos | Materiais | Ossos |
| --- | --- | ---: | --- | :---: | --- | :---: | ---: | ---: | ---: | ---: |
| **masculino** | `DOC-20261031-WA0008.bin` | 20465552 | `ad3ac1c95ef9c3850d4780bbd4108008833dc6b4f18786e60bef213e533280d1` | SIM | GLB | SIM | 1014180 | 1983423 | 1 | 78 |
| **feminino** | `DOC-20261031-WA0009.bin` | 20650336 | `7f294533acd9a278cf53332170ffcdb4bbed26aacbee66a7d9b5ea3d67966077` | SIM | GLB | SIM | 1014882 | 1972907 | 1 | 78 |

- **Critério de classificação dos personagens:** razão geométrica cintura/quadril do tronco (0.5962 vs 0.5555)

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
- **Compatível diretamente com os clipes de 16 ossos atuais do FORJA:** NÃO (0/16 nomes exatos; 11/15 ossos humanoides mapeáveis)
- **Teste reversível de deformação de skin:** osso `L_Upperarm` moveu `305/2043` vértices amostrados (deslocamento máx. `0.1516 m`)
- **Observação/Erro real de pose:** Incompatibilidade direta com os clipes atuais de 16 ossos do FORJA: apenas 0/16 nomes exatos presentes (mapeáveis por normalização humanoide: 11/15).

### feminino (`DOC-20261031-WA0009.bin`)
- **Possui armadura (`ARMATURE`):** SIM (78 ossos)
- **Possui skinning ativo na malha:** SIM
- **Compatível diretamente com os clipes de 16 ossos atuais do FORJA:** NÃO (0/16 nomes exatos; 11/15 ossos humanoides mapeáveis)
- **Teste reversível de deformação de skin:** osso `L_Upperarm` moveu `247/2044` vértices amostrados (deslocamento máx. `0.153 m`)
- **Observação/Erro real de pose:** Incompatibilidade direta com os clipes atuais de 16 ossos do FORJA: apenas 0/16 nomes exatos presentes (mapeáveis por normalização humanoide: 11/15).

## 4. Tempo de Renderização e Memória Medidos (Processos Isolados)

| Personagem | Motor (`engine_id`) | Status | Importação (s) | Prep. Cena (s) | Render Frio — 1º quadro (s) | Render Quente — 2º quadro (s) | CPU Frio (s) | Pico RSS Kernel `VmHWM` (MiB) | Pico Interno Blender (MiB) | PNG Gerado |
| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| **masculino** | `CYCLES` | OK | 4.5196 | 0.504 | **20.1274** | **20.0454** | 78.126 | **1621.34** | — | `masculino-cycles.png` (659.8 KiB) |
| **masculino** | `BLENDER_EEVEE_NEXT` | OK | 4.4367 | 0.5111 | **77.0063** | **71.8243** | 185.9607 | **3070.55** | — | `masculino-eevee.png` (542.3 KiB) |
| **feminino** | `CYCLES` | OK | 4.5186 | 0.5094 | **20.2016** | **20.1424** | 78.1328 | **1624.95** | — | `feminino-cycles.png` (660.1 KiB) |
| **feminino** | `BLENDER_EEVEE_NEXT` | OK | 4.4949 | 0.5163 | **75.0713** | **71.8292** | 183.0062 | **2963.66** | — | `feminino-eevee.png` (542.6 KiB) |

## 5. Comparação Quantitativa e Visual (Pixels Reais Cycles vs EEVEE)

| Personagem | Luminância Média (Cycles / EEVEE) | Cobertura Silhueta % (Cycles / EEVEE) | Pixels Magenta (Textura Ausente) | IoU de Silhueta | MAE RGB (0–255) | PSNR (dB) | Razão de Tempo Frio (Cycles/EEVEE) | Razão de Tempo Quente (Cycles/EEVEE) |
| --- | :---: | :---: | :---: | ---: | ---: | ---: | ---: | ---: |
| **masculino** | 82.13 / 81.15 | 32.57% / 32.65% | 0 / 0 | 0.9796 | 1.45 (0.57%) | 39.7 | 0.26× | 0.28× |
| **feminino** | 82.13 / 81.15 | 32.53% / 32.63% | 0 / 0 | 0.9791 | 1.45 (0.57%) | 39.65 | 0.27× | 0.28× |

## 6. Erros Reais, Limitações e Pontos de Atenção

- **[importacao_bin_direta]** Importação direta de 'DOC-20261031-WA0008.bin' falhou no Blender 4.2.1: RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version

- **[importacao_glb_direta]** Importação direta do GLB original no Blender 4.2.1 falhou sem pré-decodificação: RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version

- **[three_gltfloader_meshopt]** GLTFLoader atual do app sem MeshoptDecoder rejeitou o arquivo original: THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files
- **[pose_esqueleto]** Incompatibilidade direta com os clipes atuais de 16 ossos do FORJA: apenas 0/16 nomes exatos presentes (mapeáveis por normalização humanoide: 11/15).
- **[importacao_bin_direta]** Importação direta de 'DOC-20261031-WA0009.bin' falhou no Blender 4.2.1: RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version

- **[importacao_glb_direta]** Importação direta do GLB original no Blender 4.2.1 falhou sem pré-decodificação: RuntimeError: Error: Extension EXT_meshopt_compression is not available on this addon version

- **[three_gltfloader_meshopt]** GLTFLoader atual do app sem MeshoptDecoder rejeitou o arquivo original: THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files
- **[pose_esqueleto]** Incompatibilidade direta com os clipes atuais de 16 ossos do FORJA: apenas 0/16 nomes exatos presentes (mapeáveis por normalização humanoide: 11/15).
- **[ambiente_opengl_software]** No runner GitHub Actions sem GPU dedicada, o EEVEE (4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4) executou sobre rasterizador OpenGL por software (llvmpipe (LLVM 20.1.2, 256 bits)). Em hardware com GPU física dedicada, o tempo do EEVEE tende a cair significativamente, enquanto artefatos de sombra/iluminação indireta permanecem característicos do motor.

## 7. Próximo Passo

Nenhum motor foi aprovado automaticamente nesta etapa. Os PNGs individuais, pranchas comparativas, logs completos (`importacao.log`, `meshopt.log`, `opengl.log` e logs por motor) e este relatório estão prontos para revisão e decisão humana antes de qualquer produção de vídeos ou publicação no app.
