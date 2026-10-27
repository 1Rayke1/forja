#!/usr/bin/env bash
# Monta o diretório que será publicado no GitHub Pages.
#
# O repositório guarda testes, ferramentas, documentação interna, protótipos,
# capturas e os dados de geração das demonstrações. Nada disso é necessário em
# runtime, então o site publicado contém somente as páginas do app, os recursos
# em assets/ e os arquivos de licença/atribuição exigidos pela RepDB.
#
# Uso (de preferência com um diretório fora do repositório):
#   bash tools/preparar-site.sh /tmp/forja-site
#
# O workflow chama este mesmo script, garantindo que o artefato testado
# localmente é idêntico ao que vai para o Pages.

set -euo pipefail

OUT="${1:?uso: preparar-site.sh <diretorio-de-saida>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rm -rf "$OUT"
mkdir -p "$OUT"

# Caminhos relativos idênticos aos do repositório: preserva data-root, F.url(),
# navegação e imagens quando o site é servido sob /forja/.
cp -R "$ROOT/index.html" \
      "$ROOT/configuracoes" "$ROOT/explorar" "$ROOT/onboarding" \
      "$ROOT/perfil" "$ROOT/progresso" "$ROOT/treino" \
      "$ROOT/assets" "$OUT/"

# Entradas do gerador e livro de revisões: ficam no repositório para auditoria,
# mas não são recursos do app publicado. O manifesto com SHA-256 fica (é link
# visível na tela de créditos), assim como LICENSE-DATA.md, NOTICE.md e
# ATTRIBUTION.md.
rm -f "$OUT/assets/demonstracoes/mapeamento.json" \
      "$OUT/assets/demonstracoes/rotulos.json" \
      "$OUT/assets/demonstracoes/creditos.json"

# Nenhum arquivo de desenvolvimento no artefato.
for p in tools tests docs design artifacts .github .git node_modules \
         README.md package.json package-lock.json; do
  if [ -e "$OUT/$p" ]; then
    echo "ERRO: arquivo de desenvolvimento no artefato: $p" >&2
    exit 1
  fi
done

# Recursos obrigatórios do app e dos créditos.
for p in index.html \
         configuracoes/index.html explorar/index.html explorar/atlas.html \
         onboarding/index.html perfil/index.html progresso/index.html \
         treino/index.html treino/rotina.html treino/executar.html \
         treino/biblioteca.html treino/calistenia.html treino/musculacao.html \
         assets/js/forja-app.js assets/js/forja-demonstracoes.js \
         assets/js/forja-demonstracoes-dados.js \
         assets/css/demonstracoes.css \
         assets/demonstracoes/LICENSE-DATA.md \
         assets/demonstracoes/ATTRIBUTION.md \
         assets/demonstracoes/NOTICE.md \
         assets/demonstracoes/manifest.json; do
  if [ ! -f "$OUT/$p" ]; then
    echo "ERRO: recurso obrigatório ausente: $p" >&2
    exit 1
  fi
done

webp="$(find "$OUT/assets/demonstracoes" -name '*.webp' -type f | wc -l)"
if [ "$webp" -ne 148 ]; then
  echo "ERRO: esperadas 148 imagens WebP, encontradas $webp" >&2
  exit 1
fi

total="$(find "$OUT" -type f | wc -l)"
echo "Artefato pronto em $OUT: $total arquivos, $webp imagens WebP."
