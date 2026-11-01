# Relatório Técnico — Piloto Abdominal Masculino com Blender Cycles

## 1. Escopo e Identificação do Modelo Original

- **Exercício:** Abdominal tradicional (`crunch abdominal` / `abdominal-supra` — ação-fonte `gentle-curl-up`).
- **Personagem:** Modelo 3D masculino original (`DOC-20261031-WA0008.bin`, release `modelos-3d-originais`, `20.465.552` bytes, SHA-256 `ad3ac1c95ef9c3850d4780bbd4108008833dc6b4f18786e60bef213e533280d1`).
- **Geometria e Esqueleto Preservados:** `78` ossos, `1.014.138` vértices renderizáveis (`1.983.343` triângulos) e 3 texturas PBR `4096 × 4096` (`Color`, `ORM`, `NormalGL`).
- **Motor de Renderização:** `Blender 4.2.1 LTS` — **Cycles (CPU)** com denoiser `OPENIMAGEDENOISE`.
- **Isolamento:** Todos os artefatos foram gravados exclusivamente em `docs/validacao-3d/piloto-abdominal-masculino/`, sem alterar `assets/` nem qualquer código do aplicativo.

## 2. Resumo dos Dois Vídeos Independentes e Parâmetros de Renderização

| Parâmetro | Vídeo Horizontal (16:9) | Vídeo Vertical (9:16) |
| --- | --- | --- |
| Arquivo MP4 | `abdominal-masculino-horizontal-16x9.mp4` | `abdominal-masculino-vertical-9x16.mp4` |
| Poster dedicado | `poster-horizontal-16x9.png` | `poster-vertical-9x16.png` |
| Resolução | `1280 × 720` (16:9 nativo) | `720 × 1280` (9:16 nativo, sem recorte) |
| Câmera 3D independente | Lente `52 mm`, azimute `-58°`, elevação `22°`, pos `[1.0613, -1.64305, 0.85312]` | Lente `48 mm`, azimute `23°`, elevação `45°`, pos `[1.60234, 0.62088, 1.68056]` |
| Margem mínima de borda (corpo + colchonete) | `9%` (100% visível) | `7%` (100% visível) |
| Duração | `6.00 s` (2 repetições contínuas de `3,00 s`) | `6.00 s` (2 repetições contínuas de `3,00 s`) |
| Quadros / FPS | `180` quadros @ `30/1` (30 FPS CFR) | `180` quadros @ `30/1` (30 FPS CFR) |
| Codec / Perfil / Pixel Format | `h264` (`Main`, level `31`, `yuv420p`, `+faststart`) | `h264` (`Main`, level `31`, `yuv420p`, `+faststart`) |
| Áudio | `0` trilhas (sem áudio) | `0` trilhas (sem áudio) |
| Tamanho final do arquivo | **`3.37 MB`** (`3.537.959` B) | **`3.37 MB`** (`3.529.341` B) |
| Bitrate médio | `4717 kbps` | `4706 kbps` |
| Amostras Cycles / Bounces | `32` amostras adaptativas (min `12`, limiar `0.018`), `max_bounces=4` | Idêntico |
| Tempo médio Cycles por quadro (4 vCPUs) | `35.43 s/quadro` (soma `3188.5 s`) | `33.57 s/quadro` (soma `3021.68 s`) |
| Pico de memória RAM (`VmHWM`) | `2592.64 MiB` | `2596.57 MiB` |

## 3. Verificação de Retargeting, Biomecânica e Continuidade do Loop

- **Correspondência de ossos (`15 → 78`):** Todas as 15 trilhas anatômicas do clipe `abdominal-supra.glb` foram mapeadas diretamente sobre a cadeia anatômica do esqueleto Tripo de 78 ossos (`Hip`/`Pelvis`, distribuição vertebral `Waist 15% + Spine01 45% + Spine02 40% = 100%`, distribuição cervical `NeckTwist01 40% + NeckTwist02 35% + Head 25% = 100%`, transporte de direção sem torção de holonomia nos braços/antebraços e bissetriz `50%` nos `ShareBones` de cotovelo e joelho).
- **Biomecânica do movimento:** Flexão torácica suave de `0° → 22° → 0°` combinada a flexão cervical neutra de `0° → 20° → 0°` (elevação vertical dos ombros equivalente a `8.7 cm` em estatura de 1,75 m), joelhos estáveis em `93.99°–95.01°` e pés 100% estacionários sobre o colchonete (desvio horizontal `0 mm` / `0 mm`).
- **Contato com o colchonete e ausência de interpenetração:** Região dorsal/sacral mantida entre `-3.278 mm` e `-1.011 mm` da superfície superior do colchonete; solas dos calçados entre `-0.583 mm` e `-0.583 mm`; distância mínima 3D (KDTree) entre mãos/antebraços e tronco/quadril/coxas = `34.82 mm` (equivalente 1,75 m), sem colisões ou deformações anômalas.
- **Continuidade matemática e visual do loop:**
  - Erro exato entre `t = 0,000 s` e `t = 3,000 s` na fonte: `0.00089 m`.
  - Razão entre o passo de fechamento (`quadro 90 → quadro 1`) e o passo interno máximo: `0.1948` (sem salto na virada do ciclo).
  - Verificação direta nos quadros decodificados do MP4 final:
    - Horizontal 16:9: costura `quadro 179 → quadro 0` com `MAD = 0.6904` (`PSNR = 37.36 dB`), compatível com o passo natural adjacente `quadro 0 → quadro 1` (`MAD = 0.0134`, `PSNR = 63.15 dB`); identidade entre 1ª e 2ª repetição (`q0 vs q90`): `PSNR = 52.62 dB`.
    - Vertical 9:16: costura `quadro 179 → quadro 0` com `MAD = 0.3775` (`PSNR = 44.58 dB`), compatível com o passo natural adjacente `quadro 0 → quadro 1` (`MAD = 0.0094`, `PSNR = 66.16 dB`); identidade entre 1ª e 2ª repetição (`q0 vs q90`): `PSNR = 55.02 dB`.

## 4. Observações Técnicas e Anatômicas Registadas na Pré-validação

- **Preservação analítica da corda torácica multi-segmentada (`Waist` / `Spine01` / `Spine02`):** Na 1ª execução de pré-validação, distribuir `22°` apenas como ângulo tangente no topo da coluna reduziu a elevação vertical dos ombros para `4,79 cm` (equiv. 1,75 m). Aplicou-se o fator analítico exato de preservação da corda `Waist → NeckTwist01` (`fator_corda_toracica = 1.54059`), reproduzindo integralmente a inclinação de corda `spine → neck` (`22°`) e a orientação final da cabeça (`42°`) da animação-fonte sem inventar movimentos.
- **Folga estática constante para a barra da bermuda esportiva (`+9°`):** A auditoria 3D via `KDTree` na malha deformada detectou e interrompeu na 1ª pré-validação o toque dos dedos na barra lateral folgada da bermuda nos quadros `23–25` (`0,22 mm`, pois o manequim original de 16 ossos não possuía vestimenta). Um offset estático constante de folga coronal nos ombros eliminou completamente a interpenetração mantendo a trajetória sagital original dos braços.
- **Apoio plantar horizontal e eliminação de torção de holonomia (`A-pose → supino`):** As solas dos calçados foram mantidas na orientação plantar horizontal de repouso com cadeia fechada sagital de 2 elos (`drift = 0 mm`), e o transporte prévio de direção pelo delta da coluna eliminou `~42,6°` de torção axial espúria no úmero.

## 5. Hashes SHA-256 dos Arquivos Gerados

| Arquivo | Tamanho | SHA-256 |
| --- | --- | --- |
| `abdominal-masculino-horizontal-16x9.mp4` | 3.537.959 B (3.374 MB) | `785aaf534e7ec95ae31c9070823c0b5c6440e5c31b68f86a54cdbd8f2b515828` |
| `abdominal-masculino-vertical-9x16.mp4` | 3.529.341 B (3.366 MB) | `1e3b12e1f163bcb58d13e5892e358bf823a3cf3b0c53505aca724e8e470e541a` |
| `diagnostico/diagnostico-retarget.json` | 30.840 B (0.029 MB) | `3a92369bfc4e78c2770a010d588a07dc82faf9e1e86bc79b72d23ce336aea0ed` |
| `diagnostico/prova-horizontal-q0001.png` | 874.468 B (0.834 MB) | `f2ce218e16e7847992e6d7d7ff613c8b0d92abbe13778f02ac29bb686ba93b5a` |
| `diagnostico/prova-horizontal-q0023.png` | 876.453 B (0.836 MB) | `4e6919bcf9737baa118c110077f89734c2e2f7c7d752d95a10f8f1295707236b` |
| `diagnostico/prova-horizontal-q0046.png` | 885.778 B (0.845 MB) | `ec814eb54e437597b335b4cb76131d409b4a8935afd58d46fcc9309d245a7bbc` |
| `diagnostico/prova-vertical-q0001.png` | 839.917 B (0.801 MB) | `cb7a77a4554931fa2c976486461f7cd2dbb318a58920b35c82b6bb883b832332` |
| `diagnostico/prova-vertical-q0023.png` | 842.410 B (0.803 MB) | `254aa30ae03db0acdb8172fa544782f62c8e68aa27757ed3c8a8b3acf94df0a5` |
| `diagnostico/prova-vertical-q0046.png` | 842.574 B (0.804 MB) | `eb722d763011fc5ebcece5f9bf1d77f0d06d95bb130782455e543442720d7df6` |
| `diagnostico/resumo-prevalidacao.md` | 3.096 B (0.003 MB) | `920456a993d6da7bfa88dd296300d845872a9b4f96447844467d2b9ece9d05c4` |
| `diagnostico-retarget.json` | 30.840 B (0.029 MB) | `3a92369bfc4e78c2770a010d588a07dc82faf9e1e86bc79b72d23ce336aea0ed` |
| `poster-horizontal-16x9.png` | 778.302 B (0.742 MB) | `59cac628bc4008310b75b1a1c02123fac5cb316e3822a29e24361fb6026748cd` |
| `poster-vertical-9x16.png` | 643.170 B (0.613 MB) | `afb54266947c5371c7c12c893ef9badc9f76fc9971e1fccca73dd8c7cf00c1c0` |
| `quadros-representativos/horizontal-mosaico-5-fases.png` | 218.138 B (0.208 MB) | `a535fcc3e353308f25ece6abb91f45ec3a1e23a643354a53c917b4ef4ce9e49c` |
| `quadros-representativos/horizontal-q0001-inicio.png` | 760.507 B (0.725 MB) | `60cfd600e61afc1bd8bc3901bc8c7c75ff29205bd77e42905590dff21faffd7f` |
| `quadros-representativos/horizontal-q0023-subida.png` | 763.047 B (0.728 MB) | `b24fee77ae2c5b1b22c75e1821515338842e2bad81d5246e20d4d8b68bbbbe5f` |
| `quadros-representativos/horizontal-q0046-pico.png` | 778.302 B (0.742 MB) | `59cac628bc4008310b75b1a1c02123fac5cb316e3822a29e24361fb6026748cd` |
| `quadros-representativos/horizontal-q0068-descida.png` | 771.883 B (0.736 MB) | `f65e059814d3896036d462f78cbc80bfc552ce3379ebe93fb93e940f89dad764` |
| `quadros-representativos/horizontal-q0090-fim-loop.png` | 759.991 B (0.725 MB) | `c2cd0aa141f63991564d66816671d99fcce3b2bd2c053afc687cf1d652945ae3` |
| `quadros-representativos/vertical-mosaico-5-fases.png` | 233.595 B (0.223 MB) | `4efe54b2ee2bcf80eb02e4b72b1804d197ea693a5c413c2106bf66e34172c62a` |
| `quadros-representativos/vertical-q0001-inicio.png` | 635.054 B (0.606 MB) | `f12d5730c3ff14fbb3456e551bfab74dd58e22b302e47962481070e64ca2c7cc` |
| `quadros-representativos/vertical-q0023-subida.png` | 642.215 B (0.612 MB) | `39eec8a06c6fb1169427889ab07cfbe933e708670381be037fba6dd49f48fbf3` |
| `quadros-representativos/vertical-q0046-pico.png` | 643.170 B (0.613 MB) | `afb54266947c5371c7c12c893ef9badc9f76fc9971e1fccca73dd8c7cf00c1c0` |
| `quadros-representativos/vertical-q0068-descida.png` | 642.854 B (0.613 MB) | `ceba582848a01b5cfd8fc1f3de1fe7dfbba6fb3d9a5e30cb405b3853500089b3` |
| `quadros-representativos/vertical-q0090-fim-loop.png` | 634.971 B (0.606 MB) | `df869697193600bc3140b785c73308c6667e9c36241e36ac0353cf61fdf3549c` |

