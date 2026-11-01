# Pré-validação Biomecânica e de Retarget — Piloto Abdominal Masculino (Cycles)

- **Status global da auditoria pré-render:** INTERROMPIDO POR INCOMPATIBILIDADE
- **Blender:** 4.2.1 LTS | **Motor:** CYCLES (CPU) | **Denoiser:** OPENIMAGEDENOISE
- **Modelo original:** `masculino-original-decodificado.glb` (78 ossos, 1.014.138 vértices, 1.983.343 triângulos)
- **Clipe-fonte:** `assets/3d/animacoes/abdominal-supra.glb` (90 quadros @ 30 FPS = 3.00 s por repetição)

## Verificações Obrigatórias (Seção 3)

| Critério | Status | Medição Objetiva |
| --- | --- | --- |
| Correspondência dos 15 ossos anatômicos | OK | 15 cadeias mapeadas sobre os 78 ossos |
| Fechamento contínuo do loop | OK | erro t=0 vs t=3s = 0.00089 m; razão q90→q1 = 0.1948 |
| Amplitude biomecânica abdominal | FALHA | torácica máx 22°, cervical máx 20°, elevação ombro 8.7 cm (equiv. 1,75 m) |
| Pés plantados sem deslizamento | OK | desvio máx E=0 mm / D=0 mm |
| Contato dorsal/sacral com colchonete | OK | -3.278 mm .. -1.011 mm rel. ao topo |
| Contato plantar com colchonete | OK | E=[-0.583, -0.583] mm / D=[-0.583, -0.583] mm |
| Ausência de interpenetração mão/antebraço × corpo | OK | distância mínima KDTree = 34.82 mm (equiv. 1,75 m, q10) |
| Visibilidade integral câmera horizontal 16:9 | OK | NDC u=[0.09, 0.91], v=[0.1256, 0.8546] |
| Visibilidade integral câmera vertical 9:16 | OK | NDC u=[0.07, 0.93], v=[0.2239, 0.7557] |

## Tempos Reais das Provas Cycles

| Arquivo | Formato | Quadro | Tempo Render (s) | Luminância Média | Fração Visível |
| --- | --- | --- | --- | --- | --- |
| `prova-horizontal-q0001.png` | horizontal | 1 (0s) | 36.502s | 0.22548 | 0.99666 |
| `prova-horizontal-q0023.png` | horizontal | 23 (0.7333s) | 36.716s | 0.22687 | 0.99266 |
| `prova-horizontal-q0046.png` | horizontal | 46 (1.5s) | 37.068s | 0.22804 | 0.99376 |
| `prova-vertical-q0001.png` | vertical | 1 (0s) | 34.474s | 0.20711 | 0.99785 |
| `prova-vertical-q0023.png` | vertical | 23 (0.7333s) | 34.784s | 0.20841 | 0.9978 |
| `prova-vertical-q0046.png` | vertical | 46 (1.5s) | 34.896s | 0.20816 | 0.99815 |

## Hashes SHA-256 dos Artefatos de Pré-validação

| Arquivo | Bytes | SHA-256 |
| --- | --- | --- |
| `diagnostico-retarget.json` | 30.884 | `c19d595bd37a8b976fda29f75be19c179d753da64f2498786c9037892f861ed0` |
| `prova-horizontal-q0001.png` | 874.468 | `f2ce218e16e7847992e6d7d7ff613c8b0d92abbe13778f02ac29bb686ba93b5a` |
| `prova-horizontal-q0023.png` | 876.453 | `4e6919bcf9737baa118c110077f89734c2e2f7c7d752d95a10f8f1295707236b` |
| `prova-horizontal-q0046.png` | 885.778 | `ec814eb54e437597b335b4cb76131d409b4a8935afd58d46fcc9309d245a7bbc` |
| `prova-vertical-q0001.png` | 839.917 | `cb7a77a4554931fa2c976486461f7cd2dbb318a58920b35c82b6bb883b832332` |
| `prova-vertical-q0023.png` | 842.410 | `254aa30ae03db0acdb8172fa544782f62c8e68aa27757ed3c8a8b3acf94df0a5` |
| `prova-vertical-q0046.png` | 842.574 | `eb722d763011fc5ebcece5f9bf1d77f0d06d95bb130782455e543442720d7df6` |
| `resumo-prevalidacao.md` | 3.014 | `5d3d596feb0ae61cb20f318e4c341bb12d0614c9780afd6a9fa7e5444c5b1a45` |

