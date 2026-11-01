#!/usr/bin/env bash
# Importa modelos 3D de uma release do GitHub (ou de uma pasta local, para
# teste) para FORJA_ASSETS_3D/, guardando tudo em Git LFS.
#
# É o motor do caminho "Android sem programar": você anexa os modelos a uma
# release pelo navegador do celular (até 2 GB por arquivo) e este script traz
# os arquivos para a pasta do repositório, já versionados pelo LFS.
#
# Uso:
#   bash tools/importar-assets-3d.sh <tag-da-release> [opções]
#
# Opções:
#   --repo <owner/repo>        repositório da release (padrão: $GITHUB_REPOSITORY)
#   --branch <nome>            branch de destino do commit (padrão: main)
#   --destino <pasta>          pasta de destino (padrão: FORJA_ASSETS_3D)
#   --origem-local <pasta>     usa uma pasta local em vez de baixar a release
#   --dry-run                  só mostra o que seria feito
#   --sem-push                 faz o commit, mas não envia ao GitHub
#
# Regras de segurança:
#   * nunca apaga nem sobrescreve arquivo existente;
#   * nome já usado com conteúdo diferente é ignorado com aviso;
#   * só aceita GLB, GLTF, FBX e BLEND, até 2 GB por arquivo.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASTA_DESTINO="FORJA_ASSETS_3D"
BRANCH="main"
REPO="${GITHUB_REPOSITORY:-}"
ORIGEM_LOCAL=""
DRY_RUN=0
PUSH=1
EXT_OK="glb gltf fbx blend"
LIMITE_BYTES=$((2 * 1024 * 1024 * 1024))   # 2 GB por arquivo (GitHub Free)

uso() {
  cat <<'TXT'
Uso: bash tools/importar-assets-3d.sh <tag-da-release> [opções]

  --repo <owner/repo>       repositório da release (padrão: $GITHUB_REPOSITORY)
  --branch <nome>           branch de destino do commit (padrão: main)
  --destino <pasta>         pasta de destino (padrão: FORJA_ASSETS_3D)
  --origem-local <pasta>    usa uma pasta local em vez de baixar a release
  --dry-run                 só mostra o que seria feito
  --sem-push                faz o commit, mas não envia ao GitHub
TXT
  exit "${1:-0}"
}

TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:?falta o valor de --repo}"; shift 2 ;;
    --branch) BRANCH="${2:?falta o valor de --branch}"; shift 2 ;;
    --destino) PASTA_DESTINO="${2:?falta o valor de --destino}"; shift 2 ;;
    --origem-local) ORIGEM_LOCAL="${2:?falta o valor de --origem-local}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --sem-push) PUSH=0; shift ;;
    -h|--help) uso 0 ;;
    -*) echo "Opção desconhecida: $1" >&2; uso 2 ;;
    *) TAG="$1"; shift ;;
  esac
done

if [ -z "$TAG" ] && [ -z "$ORIGEM_LOCAL" ]; then
  echo "ERRO: informe a tag da release (ou use --origem-local)." >&2
  uso 2
fi

echo "== Importação de modelos 3D para ${PASTA_DESTINO}/ =="
[ -n "$ORIGEM_LOCAL" ] && echo "Origem local: ${ORIGEM_LOCAL}" || echo "Release: ${TAG} (repo ${REPO:-?})"
echo "Destino: branch ${BRANCH}"

if [ ! -d "$ROOT/.git" ]; then
  echo "ERRO: ${ROOT} não é um repositório Git." >&2
  exit 1
fi

if ! command -v git-lfs >/dev/null 2>&1; then
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "AVISO: git-lfs não está instalado; em --dry-run nada é gravado, então segue."
    echo "       Para importar de verdade instale o Git LFS (git lfs install)."
  else
    echo "ERRO: git-lfs não está instalado (necessário para guardar os modelos no LFS)." >&2
    echo "      Instale com 'git lfs install' ou use --dry-run." >&2
    exit 1
  fi
fi

TMP=""
limpar() {
  if [ -n "${TMP:-}" ]; then rm -rf "$TMP"; fi
  return 0
}
trap limpar EXIT

if [ -n "$ORIGEM_LOCAL" ]; then
  ORIGEM="$ORIGEM_LOCAL"
  [ -d "$ORIGEM" ] || { echo "ERRO: pasta de origem inexistente: $ORIGEM" >&2; exit 1; }
else
  if [ -z "$REPO" ]; then
    echo "ERRO: repositório não informado (defina GITHUB_REPOSITORY ou use --repo)." >&2
    exit 1
  fi
  command -v gh >/dev/null 2>&1 || { echo "ERRO: gh (GitHub CLI) não está instalado." >&2; exit 1; }
  TMP="$(mktemp -d)"
  ORIGEM="$TMP/assets"
  mkdir -p "$ORIGEM"
  echo "Baixando anexos da release ${TAG}…"
  if ! gh release download "$TAG" --repo "$REPO" --dir "$ORIGEM" --clobber; then
    echo "ERRO: não foi possível baixar os anexos da release ${TAG}." >&2
    echo "      Confira se a release existe, se ela tem arquivos anexados e se o token tem 'contents: read'." >&2
    exit 1
  fi
fi

extensao_permitida() {
  local e="${1,,}" permitida
  for permitida in $EXT_OK; do
    [ "$e" = "$permitida" ] && return 0
  done
  return 1
}

mkdir -p "$ROOT/$PASTA_DESTINO"

importados=0
identicos=0
nome_em_uso=0
invalidos=0
validos=0
declare -a NOVOS=()

tamanho_de() { wc -c < "$1" | tr -d ' '; }
hash_de() { sha256sum "$1" | awk '{print $1}'; }

while IFS= read -r -d '' arquivo; do
  nome="${arquivo##*/}"
  [ -f "$arquivo" ] || continue
  ext="${nome##*.}"

  if [ "$nome" = "$ext" ] || ! extensao_permitida "$ext"; then
    echo "  IGNORADO ${nome}: formato não acompanhado (aceitos: ${EXT_OK// /, })"
    invalidos=$((invalidos + 1))
    continue
  fi

  bytes="$(tamanho_de "$arquivo")"
  if [ "$bytes" -eq 0 ]; then
    echo "  IGNORADO ${nome}: arquivo vazio"
    invalidos=$((invalidos + 1))
    continue
  fi
  if [ "$bytes" -gt "$LIMITE_BYTES" ]; then
    echo "  IGNORADO ${nome}: $((bytes / 1024 / 1024)) MB excede o limite de 2 GB do LFS"
    invalidos=$((invalidos + 1))
    continue
  fi

  validos=$((validos + 1))
  destino="$ROOT/$PASTA_DESTINO/$nome"

  if [ -e "$destino" ]; then
    if [ "$(hash_de "$destino")" = "$(hash_de "$arquivo")" ]; then
      echo "  JÁ EXISTE ${nome}: conteúdo idêntico, nada a fazer"
      identicos=$((identicos + 1))
    else
      echo "  IGNORADO ${nome}: já existe um arquivo com esse nome e conteúdo diferente"
      echo "           (renomeie o anexo na release para importar esta versão)"
      nome_em_uso=$((nome_em_uso + 1))
    fi
    continue
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  IMPORTARIA ${nome} (${bytes} B)"
  else
    cp -p "$arquivo" "$destino"
    echo "  IMPORTADO ${nome} (${bytes} B)"
  fi
  NOVOS+=("$PASTA_DESTINO/$nome")
  importados=$((importados + 1))
done < <(find "$ORIGEM" -maxdepth 1 -type f -print0 | sort -z)

if [ "$DRY_RUN" -eq 1 ]; then
  rotulo="seria(m) importado(s)"
else
  rotulo="importado(s)"
fi
printf '\nResumo: %d %s, %d já existente(s), %d ignorado(s) por nome, %d inválido(s)\n' \
  "$importados" "$rotulo" "$identicos" "$nome_em_uso" "$invalidos"

if [ "$validos" -eq 0 ]; then
  if [ "$invalidos" -eq 0 ]; then
    echo "ERRO: a release não tem nenhum arquivo anexado." >&2
  else
    echo "ERRO: nenhum anexo compatível (GLB/GLTF/FBX/BLEND) foi encontrado." >&2
  fi
  exit 1
fi

if [ "$DRY_RUN" -eq 1 ] || [ "${#NOVOS[@]}" -eq 0 ]; then
  echo "Nada novo para commitar."
  exit 0
fi

if ! git -C "$ROOT" config user.name >/dev/null 2>&1; then
  git -C "$ROOT" config user.name "forja-assets-3d[bot]"
  git -C "$ROOT" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
fi

git -C "$ROOT" lfs install --local >/dev/null 2>&1 || true
git -C "$ROOT" add -- "${NOVOS[@]}"

echo "Conferindo ponteiros do LFS…"
for rel in "${NOVOS[@]}"; do
  primeira="$(git -C "$ROOT" cat-file -p ":$rel" 2>/dev/null | head -n 1 || true)"
  if [ "$primeira" != "version https://git-lfs.github.com/spec/v1" ]; then
    echo "ERRO: ${rel} não entrou como ponteiro do LFS; importação abortada." >&2
    exit 1
  fi
done

titulo="Importa ${#NOVOS[@]} modelo(s) 3D para ${PASTA_DESTINO} (Git LFS)"
[ -n "$ORIGEM_LOCAL" ] && origem_legivel="$ORIGEM_LOCAL" || origem_legivel="release ${TAG}"
corpo="Origem: ${origem_legivel}"
git -C "$ROOT" commit -m "$titulo" -m "$corpo" >/dev/null
echo "Commit criado: $(git -C "$ROOT" log -1 --pretty='%h %s')"

if [ "$PUSH" -eq 1 ]; then
  ok=0
  for tentativa in 1 2 3; do
    if git -C "$ROOT" push origin "HEAD:refs/heads/${BRANCH}"; then ok=1; break; fi
    echo "Push recusado (tentativa ${tentativa}); atualizando com rebase…"
    git -C "$ROOT" pull --rebase --autostash origin "refs/heads/${BRANCH}" || true
  done
  if [ "$ok" -ne 1 ]; then
    echo "ERRO: não foi possível enviar o commit para ${BRANCH}." >&2
    exit 1
  fi
  echo "Enviado para ${BRANCH}."
else
  echo "Push desativado (--sem-push)."
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Modelos 3D importados"
    echo
    echo "Origem: ${origem_legivel}"
    echo
    echo "| Arquivo | Tamanho |"
    echo "| --- | --- |"
    for rel in "${NOVOS[@]}"; do
      printf '| `%s` | %s B |\n' "${rel#*/}" "$(git -C "$ROOT" cat-file -p ":$rel" | awk '/^size / {print $2}')"
    done
  } >> "$GITHUB_STEP_SUMMARY"
fi
