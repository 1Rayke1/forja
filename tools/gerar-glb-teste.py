#!/usr/bin/env python3
"""Gera um arquivo GLB válido (glTF 2.0 binário) de tamanho controlado.

Usado pelos testes de recebimento do Git LFS para criar modelos grandes de
verdade (inclusive acima do limite de 25 MB do envio pelo navegador). O arquivo
tem um triângulo mínimo e o resto do buffer é preenchimento válido, então abre
em qualquer visualizador glTF.

Uso:
    python3 tools/gerar-glb-teste.py saida.glb --tamanho 31457280
"""

import argparse
import json
import struct
import sys

MAGIC = 0x46546C67  # 'glTF'
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
TRIANGULO_BYTES = 36  # 3 vértices VEC3 float32


def _json_chunk(tamanho_buffer: int) -> bytes:
    gltf = {
        "asset": {"version": "2.0", "generator": "FORJA teste LFS"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "triangulo"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": 3,
                "type": "VEC3",
                "min": [0.0, 0.0, 0.0],
                "max": [1.0, 1.0, 0.0],
            }
        ],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": TRIANGULO_BYTES}],
        "buffers": [{"byteLength": tamanho_buffer}],
    }
    bruto = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    return bruto + b" " * (-len(bruto) % 4)


def gerar(destino: str, tamanho: int) -> int:
    if tamanho < 1024:
        raise SystemExit("--tamanho precisa ser >= 1024 bytes")

    # Ajusta o buffer até o arquivo final fechar no tamanho pedido.
    buffer_len = tamanho - 12 - 8 - 8 - 4096
    buffer_len = max(TRIANGULO_BYTES, buffer_len - (buffer_len - TRIANGULO_BYTES) % 4)
    for _ in range(16):
        json_chunk = _json_chunk(buffer_len)
        total = 12 + 8 + len(json_chunk) + 8 + buffer_len
        if total == tamanho:
            break
        buffer_len -= total - tamanho
        buffer_len = max(TRIANGULO_BYTES, buffer_len - (buffer_len - TRIANGULO_BYTES) % 4)
    json_chunk = _json_chunk(buffer_len)
    total = 12 + 8 + len(json_chunk) + 8 + buffer_len
    if total != tamanho:
        raise SystemExit(f"não foi possível fechar o tamanho: gerado {total}, pedido {tamanho}")

    bin_chunk = struct.pack("<9f", 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0)
    bin_chunk += b"\x00" * (buffer_len - len(bin_chunk))

    with open(destino, "wb") as fh:
        fh.write(struct.pack("<III", MAGIC, 2, total))
        fh.write(struct.pack("<II", len(json_chunk), CHUNK_JSON))
        fh.write(json_chunk)
        fh.write(struct.pack("<II", len(bin_chunk), CHUNK_BIN))
        fh.write(bin_chunk)
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description="Gera um GLB válido de tamanho controlado.")
    parser.add_argument("destino", help="caminho do .glb a criar")
    parser.add_argument(
        "--tamanho",
        type=int,
        default=30 * 1024 * 1024,
        help="tamanho final em bytes (padrão: 30 MiB, acima do limite de 25 MB do navegador)",
    )
    args = parser.parse_args()
    total = gerar(args.destino, args.tamanho)
    print(f"{args.destino}: GLB válido com {total} bytes ({total / 1024 / 1024:.2f} MiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
