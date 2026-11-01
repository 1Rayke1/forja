# Pré-validação Biomecânica e de Retarget — Piloto Abdominal Masculino (Cycles)

- **Status global da auditoria pré-render:** INTERROMPIDO POR INCOMPATIBILIDADE
- **Blender:** 4.2.1 LTS | **Motor:** CYCLES (CPU) | **Denoiser:** OPENIMAGEDENOISE
- **Modelo original:** `masculino-original-decodificado.glb` (78 ossos, 1.014.138 vértices, 1.983.343 triângulos)
- **Clipe-fonte:** `assets/3d/animacoes/abdominal-supra.glb` (90 quadros @ 30 FPS = 3.00 s por repetição)

## Verificações Obrigatórias (Seção 3)

| Critério | Status | Medição Objetiva |
| --- | --- | --- |
| Correspondência dos 15 ossos anatômicos | OK | 15 cadeias mapeadas sobre os 78 ossos |
| Fechamento contínuo do loop | OK | erro t=0 vs t=3s = 0.00089 m; razão q90→q1 = 0.2155 |
| Amplitude biomecânica abdominal | FALHA | torácica máx 22°, cervical máx 20°, elevação ombro 4.79 cm (equiv. 1,75 m) |
| Pés plantados sem deslizamento | OK | desvio máx E=0 mm / D=0 mm |
| Contato dorsal/sacral com colchonete | OK | -2.8 mm .. -0.367 mm rel. ao topo |
| Contato plantar com colchonete | OK | E=[-0.583, -0.583] mm / D=[-0.583, -0.583] mm |
| Ausência de interpenetração mão/antebraço × corpo | FALHA | distância mínima KDTree = 0.22 mm (equiv. 1,75 m, q25) |
| Visibilidade integral câmera horizontal 16:9 | OK | NDC u=[0.09, 0.91], v=[0.145, 0.8353] |
| Visibilidade integral câmera vertical 9:16 | OK | NDC u=[0.1, 0.9], v=[0.3044, 0.6751] |

## Tempos Reais das Provas Cycles

| Arquivo | Formato | Quadro | Tempo Render (s) | Luminância Média | Fração Visível |
| --- | --- | --- | --- | --- | --- |
| `prova-horizontal-q0001.png` | horizontal | 1 (0s) | 37.78s | 0.36561 | 0.99671 |
| `prova-horizontal-q0023.png` | horizontal | 23 (0.7333s) | 37.634s | 0.36518 | 0.99591 |
| `prova-horizontal-q0046.png` | horizontal | 46 (1.5s) | 38.363s | 0.36407 | 0.99646 |
| `prova-vertical-q0001.png` | vertical | 1 (0s) | 31.558s | 0.31374 | 0.99965 |
| `prova-vertical-q0023.png` | vertical | 23 (0.7333s) | 31.85s | 0.31395 | 0.9998 |
| `prova-vertical-q0046.png` | vertical | 46 (1.5s) | 32.112s | 0.31354 | 0.9998 |

## Hashes SHA-256 dos Artefatos de Pré-validação

| Arquivo | Bytes | SHA-256 |
| --- | --- | --- |
| `diagnostico-retarget.json` | 30.856 | `e8731c823a6115c15ed5c87c90d14eddd7b8a74842cc890f15781800ed316d96` |
| `prova-horizontal-q0001.png` | 886.831 | `30017b3c3b9638d474bc6063dc39f685eb0c33d36dd5d86c186b2653843d8b3c` |
| `prova-horizontal-q0023.png` | 886.292 | `e1caa6d0a6a1ed393a1ff536a13a5e48a747e5ad3c5f61ee5469f3b4d022a09d` |
| `prova-horizontal-q0046.png` | 897.820 | `ccf746613260681eabc97cd46401f3ef45b18eed7af589572cd6615c55d2e5f9` |
| `prova-vertical-q0001.png` | 823.051 | `9813631c56821cd6f7e024ab105f85b21bcb30fe77107994fdc9af3e347c5640` |
| `prova-vertical-q0023.png` | 821.477 | `708fc557e96619d83f339a9bb0e77968b0aebad50502f4c8d571fff4df4ba907` |
| `prova-vertical-q0046.png` | 824.691 | `6aebd0301ff2ef2f5555693e7279c99345e041c7a4c114f02f5690b994aca442` |

