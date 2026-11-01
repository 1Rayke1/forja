#!/usr/bin/env bash
# Valida os modelos 3D guardados em FORJA_ASSETS_3D/.
#
# Confere, para cada arquivo versionado na pasta:
#   1. formato permitido (GLB, GLTF, FBX, BLEND);
#   2. armazenamento em Git LFS (o que o Git guarda é um ponteiro, não o binário);
#   3. tamanho dentro do limite de 2 GB por arquivo do GitHub Free;
#   4. atributo de filtro LFS aplicado ao caminho.
#
# Uso:
#   bash tools/validar-assets-3d.sh
#
# Sai com código 1 se encontrar qualquer problema. Não baixa objetos do LFS e
# não toca no conteúdo dos arquivos: lê só o índice do Git.
#
# Roda no workflow "Validar assets 3D (LFS)" e também na máquina local.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASTA="FORJA_ASSETS_3D"
EXT_OK="glb gltf fbx blend"
LIMITE_BYTES=$((2 * 1024 * 1024 * 1024))   # 2 GB por arquivo (GitHub Free)
AVISO_BYTES=$((1024 * 1024 * 1024))        # avisa acima de 1 GB

if [ -t 1 ]; then
  VERMELHO=$'\033[31m'; AMARELO=$'\033[33m'; VERDE=$'\033[32m'; ZERO=$'\033[0m'
else
  VERMELHO=""; AMARELO=""; VERDE=""; ZERO=""
fi

erros=0
avisos=0
total=0
soma=0
declare -A por_ext=()

erro() { printf '%sERRO%s %s\n' "$VERMELHO" "$ZERO" "$*" >&2; erros=$((erros + 1)); }
aviso() { printf '%sAVISO%s %s\n' "$AMARELO" "$ZERO" "$*"; avisos=$((avisos + 1)); }

extensao_permitida() {
  local e="${1,,}"
  local permitida
  for permitida in $EXT_OK; do
    [ "$e" = "$permitida" ] && return 0
  done
  return 1
}

echo "Validando ${PASTA}/ (Git LFS)…"

if [ ! -d "$ROOT/$PASTA" ]; then
  erro "a pasta ${PASTA}/ não existe"
  exit 1
fi

# Arquivos versionados na pasta (lidos do índice, não do disco).
mapfile -d '' ARQUIVOS < <(git -C "$ROOT" ls-files -z -- "$PASTA")

if [ "${#ARQUIVOS[@]}" -eq 0 ]; then
  echo "Nenhum modelo versionado ainda — nada a validar."
  exit 0
fi

for caminho in "${ARQUIVOS[@]}"; do
  nome="${caminho##*/}"

  case "$caminho" in
    *.md|*.gitkeep|*.gitattributes|*.txt) continue ;;   # documentação da pasta
  esac

  total=$((total + 1))
  ext="${nome##*.}"
  ext_min="${ext,,}"
  por_ext[$ext_min]=$(( ${por_ext[$ext_min]:-0} + 1 ))

  if ! extensao_permitida "$ext_min"; then
    erro "${caminho}: formato não acompanhado (aceitos: ${EXT_OK// /, })"
    continue
  fi

  blob_bytes="$(git -C "$ROOT" cat-file -s ":$caminho" 2>/dev/null || echo "")"
  if [ -z "$blob_bytes" ]; then
    erro "${caminho}: não foi possível ler o objeto do índice"
    continue
  fi

  if [ "$blob_bytes" -gt 4096 ]; then
    erro "${caminho}: guardado como binário no Git (${blob_bytes} B), fora do LFS"
    continue
  fi

  primeira_linha="$(git -C "$ROOT" cat-file -p ":$caminho" 2>/dev/null | head -n 1)"
  if [ "$primeira_linha" != "version https://git-lfs.github.com/spec/v1" ]; then
    erro "${caminho}: não é ponteiro do Git LFS (arquivo entrou como Git comum)"
    continue
  fi

  ponteiro="$(git -C "$ROOT" cat-file -p ":$caminho" 2>/dev/null)"
  oid="$(printf '%s\n' "$ponteiro" | awk '/^oid sha256:/ {print $2}')"
  tamanho="$(printf '%s\n' "$ponteiro" | awk '/^size / {print $2}')"

  if ! printf '%s' "$oid" | grep -Eq '^[0-9a-f]{64}$'; then
    erro "${caminho}: ponteiro LFS com oid inválido"
    continue
  fi
  if ! printf '%s' "$tamanho" | grep -Eq '^[0-9]+$'; then
    erro "${caminho}: ponteiro LFS com size inválido"
    continue
  fi

  soma=$((soma + tamanho))

  if [ "$tamanho" -eq 0 ]; then
    erro "${caminho}: arquivo vazio"
  elif [ "$tamanho" -gt "$LIMITE_BYTES" ]; then
    erro "${caminho}: $(( tamanho / 1024 / 1024 )) MB excede o limite de 2 GB do GitHub LFS"
  elif [ "$tamanho" -gt "$AVISO_BYTES" ]; then
    aviso "${caminho}: $(( tamanho / 1024 / 1024 )) MB (acima de 1 GB, perto do limite)"
  fi

  filtro="$(git -C "$ROOT" check-attr filter -- "$caminho" | awk '{print $NF}')"
  if [ "$filtro" != "lfs" ]; then
    erro "${caminho}: .gitattributes não aplica filter=lfs (encontrado: ${filtro:-nenhum})"
  fi
done

if command -v git-lfs >/dev/null 2>&1; then
  if ! saida_fsck="$(git -C "$ROOT" lfs fsck --pointers 2>&1)"; then
    erro "git lfs fsck --pointers reprovou: ${saida_fsck}"
  fi
else
  aviso "git-lfs não está instalado nesta máquina; conferência de ponteiros foi a leitura manual acima"
fi

printf '\nResumo: %d modelo(s) validado(s), %d erro(s), %d aviso(s)\n' "$total" "$erros" "$avisos"
for e in "${!por_ext[@]}"; do
  printf '  .%-6s %d\n' "$e" "${por_ext[$e]}"
done
printf 'Tamanho total no LFS: %.2f MB\n' "$(awk -v b="$soma" 'BEGIN {printf "%.2f", b/1024/1024}')"

if [ "$erros" -gt 0 ]; then
  printf '%sValidação falhou.%s\n' "$VERMELHO" "$ZERO" >&2
  exit 1
fi
printf '%sValidação concluída sem erros.%s\n' "$VERDE" "$ZERO"
