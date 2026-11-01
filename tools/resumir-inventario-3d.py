#!/usr/bin/env python3
"""
Resume os inventários JSON gerados por tools/inspecionar-3d-blender.py em
markdown, para entrar no relatório de auditoria.

Uso:
    python3 tools/resumir-inventario-3d.py docs/assets-3d/inventario-mocap.json [...]
"""
import json
import sys


def linha_armadura(item):
    return [
        "%s (ossos=%d, raízes=%s, escala=%s)"
        % (a["nome"], a["ossos"], ",".join(a["ossos_raiz"]), a["escala"])
        for a in item.get("armaduras", [])
    ]


def linha_malha(item):
    return [
        "%s (v=%d, p=%d, materiais=%s, pele=%s)"
        % (
            m["nome"],
            m["vertices"],
            m["poligonos"],
            ",".join(m["materiais"]) or "-",
            "sim" if m["armature_modifier"] else "não",
        )
        for m in item.get("malhas", [])
    ]


def linha_acao(item, fps):
    saida = []
    for a in item.get("acoes", []):
        quadros = a["quadro_final"] - a["quadro_inicial"]
        segundos = quadros / fps if fps else 0
        saida.append(
            "%s [%s→%s quadro, %.2fs, %d curvas, %d grupos]"
            % (a["nome"], a["quadro_inicial"], a["quadro_final"], segundos,
               a["curvas"], a["ossos_animados"])
        )
    return saida


def main(caminhos):
    for caminho in caminhos:
        with open(caminho, encoding="utf-8") as fh:
            dados = json.load(fh)
        print("#### %s" % caminho)
        print()
        if not dados:
            print("_(sem arquivos analisados)_")
            print()
            continue
        for item in dados:
            print("- **%s** (%d bytes)" % (item.get("arquivo"), item.get("bytes", 0)))
            if item.get("erro"):
                print("  - ERRO: %s" % item["erro"])
                continue
            print("  - fps: %s" % item.get("fps"))
            print("  - armaduras: %s" % ("; ".join(linha_armadura(item)) or "nenhuma"))
            print("  - malhas: %s" % ("; ".join(linha_malha(item)) or "nenhuma"))
            print("  - ações: %s" % ("; ".join(linha_acao(item, item.get("fps"))) or "nenhuma"))
        print()


if __name__ == "__main__":
    main(sys.argv[1:])
