#!/usr/bin/env python3
"""
Gera os lockups da marca FORJA em SVG com o nome convertido em contornos.

Por que contornar: o wordmark precisa viajar sem depender de arquivo de fonte
instalado (favicon, ícone de app, imagem de compartilhamento, impressão). O SVG
final não referencia nenhuma fonte.

Uso:
    /tmp/venv/bin/python design/marca/gerar-lockups.py

Requisitos: fonttools + brotli (para ler woff2). Não é dependência do app.
"""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONTES = os.path.join(RAIZ, "design", "fontes")
SAIDA = os.path.join(RAIZ, "design", "marca", "svg")

BRASA = "#e4693a"
OSSO = "#f2ede7"
PRETO = "#17130f"
BRONZE = "#c08b4e"
ACO = "#a6a29b"

# Geometria do emblema (grade 64 x 64). O anel é traço; o resto é massa.
CHAMA = "M32 9C37 15 39.5 20 39.5 25.5C39.5 30 36 33 32 33C28 33 24.5 30 24.5 25.5C24.5 20.5 26.5 17.5 28.5 14.5C28.5 18.5 30 20.5 31.5 20.5C31.5 16.5 31.5 13 32 9Z"
FACE = "M13 33H51L47 40H17Z"
CINTURA = "M26 40H38L41 46H23Z"
BASE = "M17 46H47L49 52H15Z"


def carregar(nome, eixos):
    fonte = TTFont(os.path.join(FONTES, nome))
    if "fvar" in fonte:
        instantiateVariableFont(fonte, eixos, inplace=True)
    return fonte


def contornar(fonte, texto, tamanho, tracking_em, escala_wdth=1.0):
    """Devolve (svg_path_d, largura_total_em_px, caminho_do_glyph)."""
    upem = fonte["head"].unitsPerEm
    cmap = fonte.getBestCmap()
    glifos = fonte.getGlyphSet()
    hmtx = fonte["hmtx"]
    escala = tamanho / upem
    x = 0.0
    partes = []
    for char in texto:
        nome = cmap.get(ord(char))
        if nome is None:
            continue
        pen = SVGPathPen(glifos, ntos=lambda v: f"{v:.2f}")
        glifos[nome].draw(pen)
        d = pen.getCommands()
        if d:
            # escala Y negativa: o eixo do SVG cresce para baixo.
            partes.append(
                f'<path transform="translate({x:.2f} 0) scale({escala:.5f} {-escala:.5f})" d="{d}"/>'
            )
        avanca = hmtx[nome][0] * escala * escala_wdth
        x += avanca + tracking_em * tamanho
    largura = x - tracking_em * tamanho if texto else 0
    return "".join(partes), largura


def lockup_horizontal(nome_arquivo, cor_emblema, cor_texto, cor_tag, fundo=None, cor_chama=None):
    """Emblema à esquerda, wordmark à direita. A tagline vive fora deste lockup."""
    cor_chama = cor_chama or cor_emblema
    archivo = carregar("archivo-variable-latin.woff2", {"wght": 750, "wdth": 108})

    alt_emblema = 42.0
    tamanho_nome = 34.0
    caminho_nome, largura_nome = contornar(archivo, "FORJA", tamanho_nome, 0.06)

    respiro = 16.0
    margem = 20.0
    x_texto = margem + alt_emblema + respiro
    altura_nome = tamanho_nome * 0.72          # altura de caixa-alta
    bloco_texto = altura_nome
    largura_total = x_texto + largura_nome + margem
    altura_total = margem * 2 + max(alt_emblema, bloco_texto) - 8

    escala_emblema = alt_emblema / 64.0
    y_emblema = (margem - 4) + (max(alt_emblema, bloco_texto) - alt_emblema) / 2
    y_nome = (margem - 4) + (max(alt_emblema, bloco_texto) - bloco_texto) / 2 + altura_nome

    fundo_svg = (
        f'<rect width="{largura_total:.2f}" height="{altura_total:.2f}" fill="{fundo}"/>'
        if fundo else ""
    )
    tag_svg = ""

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {largura_total:.2f} {altura_total:.2f}"
     width="{largura_total:.2f}" height="{altura_total:.2f}" role="img"
     aria-label="FORJA — assinatura horizontal">
  <title>FORJA — assinatura horizontal</title>
  {fundo_svg}
  <g transform="translate({margem:.2f} {y_emblema:.2f}) scale({escala_emblema:.6f})">
    <circle cx="32" cy="32" r="28.5" fill="none" stroke="{cor_emblema}" stroke-width="{3 / escala_emblema:.2f}"/>
    <path fill="{cor_chama}" d="{CHAMA}"/>
    <g fill="{cor_emblema}">
      <path d="{FACE}"/>
      <path d="{CINTURA}"/>
      <path d="{BASE}"/>
    </g>
  </g>
  <g fill="{cor_texto}" transform="translate({x_texto:.2f} {y_nome:.2f})">{caminho_nome}</g>
  {tag_svg}
</svg>
'''
    with open(os.path.join(SAIDA, nome_arquivo), "w", encoding="utf-8") as handle:
        handle.write(svg)
    return largura_total, altura_total


def lockup_vertical(nome_arquivo, cor_emblema, cor_texto, cor_tag, fundo=None, cor_chama=None):
    cor_chama = cor_chama or cor_emblema
    archivo = carregar("archivo-variable-latin.woff2", {"wght": 750, "wdth": 108})
    inter = carregar("inter-variable-latin.woff2", {"wght": 600})

    tamanho_emblema = 58.0
    tamanho_nome = 27.0
    caminho_nome, largura_nome = contornar(archivo, "FORJA", tamanho_nome, 0.12)
    caminho_tag, largura_tag = contornar(inter, "DISCIPLINA • EVOLUÇÃO • CONSISTÊNCIA", 6.2, 0.16)

    margem = 18.0
    largura_total = max(tamanho_emblema, largura_nome, largura_tag) + margem * 2
    centro = largura_total / 2
    y_emblema = margem
    y_nome = y_emblema + tamanho_emblema + 10 + tamanho_nome * 0.72
    y_tag = y_nome + 10.5
    altura_total = y_tag + 8

    fundo_svg = (
        f'<rect width="{largura_total:.2f}" height="{altura_total:.2f}" fill="{fundo}"/>'
        if fundo else ""
    )

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {largura_total:.2f} {altura_total:.2f}"
     width="{largura_total:.2f}" height="{altura_total:.2f}" role="img"
     aria-label="FORJA — assinatura vertical">
  <title>FORJA — assinatura vertical</title>
  {fundo_svg}
  <g transform="translate({centro - tamanho_emblema / 2:.2f} {y_emblema:.2f}) scale({tamanho_emblema / 64.0:.6f})">
    <circle cx="32" cy="32" r="28.5" fill="none" stroke="{cor_emblema}" stroke-width="{3 / (tamanho_emblema / 64.0):.2f}"/>
    <path fill="{cor_chama}" d="{CHAMA}"/>
    <g fill="{cor_emblema}">
      <path d="{FACE}"/>
      <path d="{CINTURA}"/>
      <path d="{BASE}"/>
    </g>
  </g>
  <g fill="{cor_texto}" transform="translate({centro - largura_nome / 2:.2f} {y_nome:.2f})">{caminho_nome}</g>
  <g fill="{cor_tag}" transform="translate({centro - largura_tag / 2:.2f} {y_tag:.2f})">{caminho_tag}</g>
</svg>
'''
    with open(os.path.join(SAIDA, nome_arquivo), "w", encoding="utf-8") as handle:
        handle.write(svg)
    return largura_total, altura_total


if __name__ == "__main__":
    os.makedirs(SAIDA, exist_ok=True)
    print("horizontal escuro ", lockup_horizontal("logo-horizontal-escuro.svg", BRASA, OSSO, ACO))
    print("horizontal claro  ", lockup_horizontal("logo-horizontal-claro.svg", PRETO, PRETO, "#6b6156", fundo="#efe9e2"))
    print("horizontal mono   ", lockup_horizontal("logo-horizontal-monocromatico.svg", PRETO, PRETO, PRETO))
    print("horizontal bronze ", lockup_horizontal("logo-horizontal-bronze.svg", BRONZE, OSSO, "#d8c9b4"))
    print("horizontal duo    ", lockup_horizontal("logo-horizontal-duo.svg", BRONZE, OSSO, "#d8c9b4", cor_chama=BRASA))
    print("vertical escuro   ", lockup_vertical("logo-vertical-escuro.svg", BRASA, OSSO, ACO))
    print("vertical claro    ", lockup_vertical("logo-vertical-claro.svg", PRETO, PRETO, "#6b6156", fundo="#efe9e2"))
    print("vertical duo      ", lockup_vertical("logo-vertical-duo.svg", BRONZE, OSSO, ACO, cor_chama=BRASA))
