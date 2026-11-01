#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Auditoria dos anexos das releases "assets-3d-v1" e "assets-3d-v2".
#
# Não presume nada sobre o conteúdo: abre cada anexo, lista o que existe,
# identifica o formato real (cabeçalho, não extensão) e registra tamanho,
# hash e presença de esqueleto/animação.
#
# Uso:
#   bash tools/auditar-assets-3d-releases.sh <diretorio-com-os-anexos> [saida.md]
#
# O script é somente leitura: não move, não apaga e não renomeia nada.
# ---------------------------------------------------------------------------
set -uo pipefail

SRC="${1:?uso: auditar-assets-3d-releases.sh <diretorio-com-os-anexos> [saida.md]}"
OUT="${2:-}"

exec 3>&1
if [ -n "$OUT" ]; then exec 1>"$OUT"; fi

say() { printf '%s\n' "$*"; }
h() { printf '\n## %s\n\n' "$*"; }
human() { numfmt --to=iec-i --suffix=B "$1" 2>/dev/null || printf '%s bytes' "$1"; }

magic() {
  # primeiros 16 bytes em hex + repr ASCII legível
  local f="$1"
  head -c 16 "$f" 2>/dev/null | od -An -tx1 -v | tr -s ' ' | sed 's/^ //' | head -1
}

kind_of() {
  # Classificação pelo conteúdo, nunca pela extensão.
  local f="$1"
  local m
  m="$(head -c 64 "$f" 2>/dev/null | od -An -c -v | head -2 | tr -d '\n')"
  case "$m" in
    *"K a y d a r a"*) echo "FBX binário (Kaydara FBX Binary)"; return;;
    *"PK"*) echo "ZIP/container (PK\\x03\\x04)"; return;;
    *"M Z"*) echo "PE/Windows (MZ)"; return;;
    *"glTF"*) echo "GLB (glTF binário)"; return;;
    *"{"*"asset"*) echo "glTF JSON"; return;;
    *"B l e n d e r"*) echo "Blender .blend"; return;;
    *"# "*) echo "texto"; return;;
  esac
  file -b "$f" 2>/dev/null | head -1
}

# Diretório temporário de trabalho (nada é escrito dentro do repositório).
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say "# Auditoria dos anexos 3D das releases"
say ""
say "Gerado por \`tools/auditar-assets-3d-releases.sh\` em $(date -u '+%Y-%m-%d %H:%M UTC')."
say "Diretório auditado: \`$(basename "$SRC")\`. Nenhum arquivo foi alterado."
say ""
say "| Arquivo | Tamanho | Formato real (cabeçalho) | SHA-256 |"
say "| --- | --- | --- | --- |"
for f in "$SRC"/*; do
  [ -f "$f" ] || continue
  size=$(stat -c%s "$f")
  say "| \`$(basename "$f")\` | $(human "$size") ($size bytes) | $(kind_of "$f") | \`$(sha256sum "$f" | cut -c1-16)…\` |"
done

for f in "$SRC"/*; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  size=$(stat -c%s "$f")
  h "1. $name"

  say "- Tamanho: **$(human "$size")** ($size bytes)"
  say "- Formato detectado pelo conteúdo: **$(kind_of "$f")**"
  say "- Primeiros 16 bytes (hex): \`$(magic "$f")\`"
  say "- \`file\`: \`$(file -b "$f" 2>/dev/null | head -1)\`"

  # ---- ZIP (direto ou escondido dentro de um instalador) -------------------
  if unzip -l "$f" >/dev/null 2>&1; then
    say ""
    say "### Conteúdo do ZIP"
    say ""
    total=$(unzip -l "$f" 2>/dev/null | tail -1 | awk '{print $2}')
    files=$(unzip -Z1 "$f" 2>/dev/null | grep -vc '/$' || true)
    say "Arquivos: **${files:-?}**; itens listados pelo ZIP: ${total:-?}."
    say ""
    say "Extensões encontradas:"
    say ""
    say "| Extensão | Quantidade | Soma dos tamanhos |"
    say "| --- | ---: | ---: |"
    unzip -l "$f" 2>/dev/null | awk 'NF>=4 && $1 ~ /^[0-9]+$/ {n=$NF; ext="(sem extensão)"; if (n ~ /\./) {sub(/.*\./,"",n); ext=tolower(n)} size[$0]=$1; cnt[ext]++; sum[ext]+=$1} END {for (e in cnt) printf "| .%s | %d | %d |\n", e, cnt[e], sum[e]}' | sort
    say ""
    say "<details><summary>Lista completa (até 400 entradas)</summary>"
    say ""
    say '```'
    unzip -l "$f" 2>/dev/null | head -420
    say '```'
    say ""
    say "</details>"
    say ""
    say "### Arquivos 3D/animação dentro do ZIP"
    say ""
    unzip -Z1 "$f" 2>/dev/null | grep -Ei '\.(fbx|glb|gltf|blend|bvh|bip|obj|c4d|dae|3ds|abc|usd|usdz|anim|skel|bin)$' \
      | sed 's/^/- `/; s/$/`/' | head -300
    say ""
    unzip -Z1 "$f" 2>/dev/null | grep -Ei 'readme|licen|licen[cs]e|credit|autor|author|\.txt$|\.pdf$|\.md$|\.url$' \
      | sed 's/^/- `/; s/$/`/' | head -40
  fi

  # ---- PE / instalador -----------------------------------------------------
  if [ "$(head -c 2 "$f")" = "MZ" ]; then
    say ""
    say "### Instalador Windows (PE)"
    if command -v 7z >/dev/null 2>&1; then
      say ""
      say '```'
      7z l "$f" 2>/dev/null | head -120 || echo "7z não conseguiu listar"
      say '```'
      say ""
      say "Extensões dentro do instalador:"
      say ""
      7z l "$f" 2>/dev/null | awk 'NF>=6 && $NF ~ /\./ {n=$NF; sub(/.*\./,"",n); print tolower(n)}' \
        | sort | uniq -c | sort -rn | head -30 | sed 's/^/    /'
    else
      say "7z não disponível na máquina."
    fi
    say ""
    say "Strings com nomes de formatos 3D:"
    say ""
    say '```'
    strings -n 6 "$f" 2>/dev/null | grep -Ei '\.(fbx|glb|gltf|blend|bvh|obj)$' | sort -u | head -40
    say '```'
  fi

  # ---- FBX direto ----------------------------------------------------------
  case "$(head -c 20 "$f" 2>/dev/null | tr -d '\000')" in
    KaydaraFBXBinary*)
      say ""
      say "### FBX binário"
      say ""
      say "- Versão do cabeçalho: $(strings -n 4 "$f" | grep -m1 -o '[0-9]\{4\}' )"
      say "- Ocorrências de \`AnimStack\`: $(strings "$f" | grep -c 'AnimStack' || true)"
      say "- Ocorrências de \`AnimationCurveNode\`: $(strings "$f" | grep -c 'AnimationCurveNode' || true)"
      say "- Ocorrências de \`Deformer\`: $(strings "$f" | grep -c 'Deformer' || true)"
      say "- Ocorrências de \`LimbNode\`/\`Cluster\`: $(strings "$f" | grep -Ec 'LimbNode|Cluster' || true)"
      ;;
  esac
done

h "Resumo"
say "- Anexos auditados: $(find "$SRC" -maxdepth 1 -type f | wc -l)"
say "- Ferramentas: \`$(unzip -v 2>/dev/null | head -1 | cut -c1-40)\`, \`7z\`: $(command -v 7z >/dev/null && echo sim || echo não), \`blender\`: $(command -v blender >/dev/null && blender --version 2>/dev/null | head -1 || echo não)."

exec 1>&3
if [ -n "$OUT" ]; then say "Relatório escrito em $OUT"; fi
