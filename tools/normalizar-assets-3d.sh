#!/usr/bin/env bash
# Coloca no Git LFS os modelos de FORJA_ASSETS_3D/ que entraram como Git comum.
#
# Acontece quando alguém envia um arquivo pequeno (até 25 MB) direto pela pasta
# no navegador: o GitHub grava o binário no Git, ignorando o .gitattributes.
# Este script troca o binário pelo ponteiro do LFS em um commit novo — sem
# reescrever o histórico e sem force-push.
#
# Uso:
#   bash tools/normalizar-assets-3d.sh [--branch main] [--dry-run] [--sem-push]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASTA_DESTINO="FORJA_ASSETS_3D"
BRANCH="main"
DRY_RUN=0
PUSH=1
EXT_OK="glb gltf fbx blend"

uso() {
  cat <<'TXT'
Uso: bash tools/normalizar-assets-3d.sh [opções]

  --branch <nome>    branch de destino do commit (padrão: main)
  --destino <pasta>  pasta de destino (padrão: FORJA_ASSETS_3D)
  --dry-run          só lista o que seria normalizado
  --sem-push         faz o commit, mas não envia ao GitHub
TXT
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:?falta o valor de --branch}"; shift 2 ;;
    --destino) PASTA_DESTINO="${2:?falta o valor de --destino}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --sem-push) PUSH=0; shift ;;
    -h|--help) uso 0 ;;
    *) echo "Opção desconhecida: $1" >&2; uso 2 ;;
  esac
done

echo "== Normalização de ${PASTA_DESTINO}/ para Git LFS =="

command -v git-lfs >/dev/null 2>&1 || {
  echo "ERRO: git-lfs não está instalado (git lfs install)." >&2; exit 1; }

extensao_permitida() {
  local e="${1,,}" permitida
  for permitida in $EXT_OK; do
    [ "$e" = "$permitida" ] && return 0
  done
  return 1
}

declare -a PENDENTES=()
mapfile -d '' ARQUIVOS < <(git -C "$ROOT" ls-files -z -- "$PASTA_DESTINO")

for caminho in "${ARQUIVOS[@]}"; do
  nome="${caminho##*/}"
  case "$caminho" in
    *.md|*.gitkeep|*.gitattributes|*.txt) continue ;;
  esac
  extensao_permitida "${nome##*.}" || continue
  bytes="$(git -C "$ROOT" cat-file -s ":$caminho")"
  if [ "$bytes" -le 4096 ]; then
    primeira="$(git -C "$ROOT" cat-file -p ":$caminho" | head -n 1)"
    [ "$primeira" = "version https://git-lfs.github.com/spec/v1" ] && continue
  fi
  PENDENTES+=("$caminho")
done

if [ "${#PENDENTES[@]}" -eq 0 ]; then
  echo "Nenhum modelo fora do LFS — nada a fazer."
  exit 0
fi

echo "Modelos fora do LFS (${#PENDENTES[@]}):"
for c in "${PENDENTES[@]}"; do
  printf '  %s (%s B)\n' "$c" "$(git -C "$ROOT" cat-file -s ":$c")"
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Simulação: nada foi alterado."
  exit 0
fi

if ! git -C "$ROOT" config user.name >/dev/null 2>&1; then
  git -C "$ROOT" config user.name "forja-assets-3d[bot]"
  git -C "$ROOT" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
fi
git -C "$ROOT" lfs install --local >/dev/null 2>&1 || true

for c in "${PENDENTES[@]}"; do
  # Recupera o conteúdo real do commit e o regrava; o filtro clean do LFS
  # transforma o arquivo em ponteiro no índice.
  tmp="$(mktemp)"
  git -C "$ROOT" cat-file -p "HEAD:$c" > "$tmp"
  cp "$tmp" "$ROOT/$c"
  rm -f "$tmp"
  git -C "$ROOT" add -- "$c"
  primeira="$(git -C "$ROOT" cat-file -p ":$c" | head -n 1)"
  if [ "$primeira" != "version https://git-lfs.github.com/spec/v1" ]; then
    echo "ERRO: ${c} continua fora do LFS; nada foi commitado." >&2
    git -C "$ROOT" checkout -- "$c" 2>/dev/null || true
    exit 1
  fi
  echo "  normalizado: ${c}"
done

if git -C "$ROOT" diff --cached --quiet; then
  echo "Nenhuma mudança a commitar."
  exit 0
fi

git -C "$ROOT" commit -m "Assets 3D: mover ${#PENDENTES[@]} modelo(s) para o Git LFS" \
  -m "Arquivos que entraram como Git comum (envio direto pelo navegador) passam a usar LFS."
echo "Commit criado: $(git -C "$ROOT" log -1 --pretty='%h %s')"

if [ "$PUSH" -eq 1 ]; then
  ok=0
  for tentativa in 1 2 3; do
    if git -C "$ROOT" push origin "HEAD:refs/heads/${BRANCH}"; then ok=1; break; fi
    echo "Push recusado (tentativa ${tentativa}); atualizando com rebase…"
    git -C "$ROOT" pull --rebase --autostash origin "refs/heads/${BRANCH}" || true
  done
  [ "$ok" -eq 1 ] || { echo "ERRO: não foi possível enviar para ${BRANCH}." >&2; exit 1; }
  echo "Enviado para ${BRANCH}."
else
  echo "Push desativado (--sem-push)."
fi
