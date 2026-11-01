#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# FORJA — constrói TODOS os assets 3D publicados no site.
#
# Entradas (fontes reais, none inventada):
#   tools/fontes-3d/exercises.glb  manequim MIT + 435 animações (release assets-3d-v1)
#   FBX do Mocap_Pack_06           animações de academia (release assets-3d-v2)
#   tools/animacoes-mapa.json      mapa exercício → animação (curadoria)
#
# Saídas (Git comum, servidas pelo GitHub Pages):
#   assets/3d/personagens/{masculino,feminino}.glb
#   assets/3d/animacoes/<clipe>.glb   (1 arquivo por clipe, sob demanda)
#   assets/3d/catalogo.json           (catálogo que o app consome)
#   docs/capturas/3d/*.png            (validação visual dos movimentos)
#
# Uso:
#   bash tools/construir-assets-3d.sh [diretorio-de-trabalho]
#
# Requer Blender 4.2+ no PATH (`blender`) e Node 20+.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-/tmp/forja-assets-3d}"
FONTES="$ROOT/tools/fontes-3d"
MAPA="$ROOT/tools/animacoes-mapa.json"
SAIDA="$ROOT/assets/3d"
CAPTURAS="$ROOT/docs/capturas/3d"

mkdir -p "$WORK/deskbreak" "$WORK/mocap" "$WORK/render" "$SAIDA/personagens" "$SAIDA/animacoes" "$CAPTURAS"

echo "== 1/5 personagens (masculino e feminino)"
blender --background --factory-startup --python "$ROOT/tools/blender/construir-personagens.py" -- \
  "$FONTES/exercises.glb" "$SAIDA/personagens" 2>&1 | grep -E '^\[personagem\]' || true

echo "== 2/5 mapa → listas de exportação"
node "$ROOT/tools/preparar-mapa-animacoes.mjs" "$MAPA" "$WORK"

echo "== 3/5 clipes do manequim (rig idêntico ao dos personagens)"
blender --background --factory-startup --python "$ROOT/tools/blender/exportar-animacoes.py" -- \
  "$FONTES/exercises.glb" "$WORK/deskbreak" "$WORK/clipes-deskbreak.json" "$WORK/trabalho" \
  2>&1 | grep -E '^\[clipe\]' || true

echo "== 4/5 clipes de mocap (retargeting para o rig de 16 ossos)"
mkdir -p "$WORK/mocap"
while IFS=$'\t' read -r CLIP FBX QUADROS DESLOC; do
  [ -z "$CLIP" ] && continue
  echo "-- $CLIP ← $(basename "$FBX")"
  blender --background --factory-startup --python "$ROOT/tools/blender/retarget-mocap.py" -- \
    "$FONTES/exercises.glb" "$FBX" "$CLIP" "$WORK/mocap/$CLIP.glb" "$QUADROS" "$DESLOC" \
    2>&1 | grep -E '^\[retarget\] \{' || echo "   (falhou: $CLIP)"
done < "$WORK/fila-mocap.tsv"

cp "$WORK"/deskbreak/*.glb "$SAIDA/animacoes/"
cp "$WORK"/mocap/*.glb "$SAIDA/animacoes/"

echo "== 5/5 catálogo + validação visual"
node "$ROOT/tools/gerar-catalogo-3d.mjs" "$MAPA" "$WORK" "$SAIDA" "$ROOT"

# Folha de contato de alguns clipes nos DOIS personagens (evidência visual).
for clip in postura-base agachamento rosca-direta prancha polichinelo supino; do
  for personagem in masculino feminino; do
    arquivo="$WORK/render/$clip-$personagem.png"
    if [ -f "$SAIDA/animacoes/$clip.glb" ]; then
      blender --background --factory-startup --python "$ROOT/tools/blender/renderizar-validacao.py" -- \
        "$SAIDA/personagens/$personagem.glb" "$arquivo" "$SAIDA/animacoes/$clip.glb" 12 24 \
        2>&1 | grep -E '^\[render\]' || true
      [ -f "$arquivo" ] && cp "$arquivo" "$CAPTURAS/$clip-$personagem.png"
    fi
  done
done

echo "== pronto: $(find "$SAIDA" -name '*.glb' | wc -l) arquivos GLB em assets/3d"
