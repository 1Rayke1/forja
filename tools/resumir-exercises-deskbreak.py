#!/usr/bin/env python3
"""
Resume o arquivo `library/exercises.json` extraído do app DeskBreak (release
assets-3d-v1) para descobrir quais animações de exercício existem e em que rig.

Uso:
    python3 tools/resumir-exercises-deskbreak.py <exercises.json>
"""
import json
import sys


def main(path):
    with open(path, encoding="utf-8") as fh:
        dados = json.load(fh)
    print("tipo raiz:", type(dados).__name__)
    if isinstance(dados, dict):
        print("chaves:", list(dados)[:30])
        for chave, valor in list(dados.items())[:5]:
            print("-", chave, "->", str(valor)[:800])
    elif isinstance(dados, list):
        print("itens:", len(dados))
        for valor in dados[:5]:
            print("-", str(valor)[:800])


if __name__ == "__main__":
    main(sys.argv[1])
