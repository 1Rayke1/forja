#!/usr/bin/env python3
"""
  FORJA — verificação de procedência (C2PA) da prancha anatômica.

  Lê o manifesto de proveniência embutido no PNG exibido pelo app e imprime o
  que ele afirma, com o resultado da validação criptográfica. O objetivo é
  responder, com evidência e sem suposição, a duas perguntas:

    1. o arquivo exibido é exatamente o arquivo que foi assinado?
    2. quem assina e o que a assinatura afirma sobre a origem?

  O script NÃO declara licença nem autorização de uso. Ele só relata o que a
  imagem carrega. Licença é decisão de quem publica — ver
  `assets/anatomia/NOTICE.md`.

  Dependência opcional: `c2pa-python` (`pip install c2pa-python`). Sem ela o
  script explica como instalar e sai com código 2, sem quebrar nenhuma suíte —
  `npm test` não depende deste arquivo.

  Uso:
    python3 tools/verificar-procedencia.py
    python3 tools/verificar-procedencia.py caminho/da/imagem.png
"""
import hashlib
import json
import pathlib
import sys

PADRAO = "assets/anatomia/fontes/forja-modelo-anatomico.png"


def sha256(caminho):
    digest = hashlib.sha256()
    with open(caminho, "rb") as arquivo:
        for bloco in iter(lambda: arquivo.read(1 << 20), b""):
            digest.update(bloco)
    return digest.hexdigest()


def main():
    alvo = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else PADRAO)
    if not alvo.is_file():
        print("Imagem não encontrada: " + str(alvo))
        return 1

    print("Arquivo: " + str(alvo))
    print("SHA-256: " + sha256(alvo))
    print("")

    try:
        import c2pa
    except ImportError:
        print("c2pa-python não instalado. Rode: pip install c2pa-python")
        return 2

    leitor = c2pa.Reader(alvo, None, None, None)
    dados = json.loads(leitor.json())

    validacao = dados.get("validation_results", {}).get("activeManifest", {})
    estado = dados.get("validation_state", "desconhecido")
    manifesto = dados.get("manifests", {}).get(dados.get("active_manifest", ""), {})

    print("Estado da validação: " + estado)
    assinatura = manifesto.get("signature_info", {})
    for chave in ("issuer", "common_name", "time", "alg"):
        if assinatura.get(chave):
            print("  " + chave + ": " + str(assinatura[chave]))

    criador = manifesto.get("claim_generator_info", [{}])[0].get("name", "")
    if criador:
        print("Gerador: " + criador)

    for acao in manifesto.get("assertions", []):
        if acao.get("label") != "c2pa.actions.v2":
            continue
        for item in acao.get("data", {}).get("actions", []):
            linha = "  ação: " + str(item.get("action")) + " em " + str(item.get("when"))
            agente = item.get("softwareAgent")
            if agente:
                linha += " por " + str(agente.get("name")) + " (" + str(agente.get("version")) + ")"
            if item.get("digitalSourceType"):
                linha += "\n        tipo de origem: " + str(item["digitalSourceType"])
            print(linha)

    print("")
    print("Verificações que passaram:")
    for item in validacao.get("success", []):
        print("  ok   " + item.get("code", "") + " — " + item.get("explanation", ""))
    if validacao.get("failure"):
        print("Verificações que falharam:")
        for item in validacao.get("failure", []):
            print("  falha " + item.get("code", "") + " — " + item.get("explanation", ""))
    if validacao.get("informational"):
        print("Informações:")
        for item in validacao.get("informational", []):
            print("  info  " + item.get("code", "") + " — " + item.get("explanation", ""))

    print("")
    print(
        "Leitura: `assertion.dataHash.match` confirma que os bytes exibidos são os\n"
        "mesmos que foram assinados — nada foi alterado desde a geração. O aviso\n"
        "`signingCredential.untrusted` diz apenas que o certificado do signatário\n"
        "não está na lista de confiança DESTA máquina; não indica adulteração.\n"
        "Este relatório não concede nem presume licença de uso ou redistribuição."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
