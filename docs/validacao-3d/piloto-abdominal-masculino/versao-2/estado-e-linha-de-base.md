# Piloto abdominal masculino — versão 2: linha de base

**Estado: incompleto.** Este documento registra apenas a análise inicial; não existe ainda um vídeo, poster ou avaliação da versão 2. Não deve ser interpretado como aprovação visual ou biomecânica.

## Preservação e referência

- Repositório: `1Rayke1/forja`; referência: `73a93134f341214ed50e789bc6cefc03c355e16b`.
- Os 27 arquivos listados no manifesto `../SHA256SUMS.txt` passaram em `sha256sum -c`, incluindo os vídeos horizontal e vertical, o poster e as capturas da versão 1.
- Vídeo horizontal v1: SHA-256 `785aaf534e7ec95ae31c9070823c0b5c6440e5c31b68f86a54cdbd8f2b515828`.
- O roteiro original de renderização está em `tools/blender/piloto-abdominal-cycles.py`; ele cria o personagem e o colchonete a partir do modelo e da cena existentes. A v2 não deve alterar esse roteiro ou os assets originais; qualquer adaptação deve ser independente.

## Fundo da versão 1

Amostras RGB extraídas do PNG `../quadros-representativos/horizontal-q0001-inicio.png` (1280 × 720), sem conversão de cor adicional além de leitura RGB:

| Posição (x, y) | RGB |
| --- | --- |
| (0, 0) | (17, 18, 18) |
| (1279, 0) | (19, 19, 20) |
| (0, 719) | (47, 46, 47) |
| (1279, 719) | (45, 47, 48) |
| (100, 100) | (42, 41, 42) |
| (640, 30) | (34, 34, 35) |

Essas amostras da v1 variam e não correspondem uniformemente a `#121010` / RGB (18, 16, 16). São medições do PNG, não do vídeo decodificado. O roteiro v1 utiliza um piso iluminado; apenas mudar a cor do mundo não garante um fundo uniforme. Para a v2 será necessário separar o fundo visível da iluminação e confirmar também os pixels após a codificação e decodificação do vídeo, preservando a iluminação e aparência do personagem e do tapete.

## Biomecânica da referência

O relatório v1 `../relatorio-piloto-abdominal.md` registra flexão de tronco de aproximadamente 22°, joelhos entre 93,99° e 95,01° e desvio horizontal dos pés de 0 mm. Esses valores são informações da auditoria anterior, não uma avaliação da v2 nem uma confirmação clínica. A alteração de movimento e sua verificação visual ainda precisam ser realizadas.

## Pendente para entrega

- Construir e renderizar a animação v2 horizontal, sem modificar o modelo ou o tapete, com fundo uniforme `#121010`.
- Produzir vídeo, poster, capturas das fases e comparação visual real entre versões.
- Avaliar o movimento e a preservação visual quadro a quadro, incluindo estabilidade de pelve e pés e ausência de cortes.
- Validar reprodução, dimensões, FPS, duração, cor do fundo no vídeo decodificado e hash SHA-256 da v2.
- Registrar relatórios visuais e biomecânicos específicos da v2. Não integrar nem publicar antes da aprovação.
