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
      "$ROOT/configuracoes" "$ROOT/explorar" "$ROOT/exercicio" "$ROOT/onboarding" \
      "$ROOT/perfil" "$ROOT/progresso" "$ROOT/treino" \
      "$ROOT/assets" "$OUT/"

# Entradas do gerador e livro de revisões: ficam no repositório para auditoria,
# mas não são recursos do app publicado. O manifesto com SHA-256 fica (é link
# visível na tela de créditos), assim como LICENSE-DATA.md, NOTICE.md e
# ATTRIBUTION.md.
rm -f "$OUT/assets/demonstracoes/mapeamento.json" \
      "$OUT/assets/demonstracoes/rotulos.json" \
      "$OUT/assets/demonstracoes/creditos.json"

# Vídeos de demonstração: o manifesto é a única fonte da verdade.
#
# O site leva somente os MP4 listados em assets/videos/exercicios/manifest.json
# (vídeos horizontais de pessoas reais, até 60 s). Qualquer arquivo de vídeo na
# pasta que não esteja no manifesto é recusado: é assim que um render antigo
# feito a partir do personagem 3D — ou qualquer vídeo novo não aprovado — fica
# de fora do app publicado, em vez de viajar silenciosamente no artefato.
VIDEOS_DIR="assets/videos/exercicios"
VIDEOS_MANIFESTO="$ROOT/$VIDEOS_DIR/manifest.json"
if [ ! -f "$VIDEOS_MANIFESTO" ]; then
  echo "ERRO: manifesto de vídeos ausente: $VIDEOS_DIR/manifest.json" >&2
  exit 1
fi

python3 - "$ROOT" "$OUT" <<'PY'
import json, pathlib, shutil, sys

raiz = pathlib.Path(sys.argv[1])
site = pathlib.Path(sys.argv[2])
rel_dir = pathlib.Path("assets/videos/exercicios")
manifesto = json.loads((raiz / rel_dir / "manifest.json").read_text(encoding="utf-8"))

if manifesto.get("formato") != "forja-videos-exercicios":
    sys.exit("ERRO: manifesto de vídeos com formato inesperado")

permitidos = set()
for item in manifesto.get("exercicios", []):
    arquivo = item.get("video", "")
    if not arquivo.startswith("assets/videos/exercicios/") or not arquivo.endswith(".mp4"):
        sys.exit("ERRO: caminho de vídeo inválido no manifesto: " + arquivo)
    if not (raiz / arquivo).is_file():
        sys.exit("ERRO: o manifesto lista vídeo inexistente: " + arquivo)
    if item.get("duracaoS") and float(item["duracaoS"]) > 60:
        sys.exit("ERRO: vídeo acima de 60 s no manifesto: " + arquivo)
    permitidos.add(pathlib.Path(arquivo).name)

# Recusa qualquer vídeo na pasta que não esteja aprovado no manifesto.
extensoes = {".mp4", ".webm", ".mov", ".m4v", ".ogv"}
orfaos = sorted(
    p.name for p in (raiz / rel_dir).iterdir()
    if p.is_file() and p.suffix.lower() in extensoes and p.name not in permitidos
)
if orfaos:
    sys.exit("ERRO: vídeo não aprovado em " + str(rel_dir) + ": " + ", ".join(orfaos))

# O artefato recebe apenas manifesto, documentação e os vídeos aprovados.
destino = site / rel_dir
destino.mkdir(parents=True, exist_ok=True)
for nome in ("README.md", "manifest.json"):
    if (raiz / rel_dir / nome).is_file():
        shutil.copy2(raiz / rel_dir / nome, destino / nome)
for nome in sorted(permitidos):
    shutil.copy2(raiz / rel_dir / nome, destino / nome)

if not permitidos:
    for p in destino.iterdir():
        if p.suffix.lower() in extensoes:
            p.unlink()

print("Vídeos aprovados no artefato: %d." % len(permitidos))
PY

# Nenhum arquivo de desenvolvimento no artefato.
for p in tools tests docs design artifacts .github .git node_modules \
         README.md package.json package-lock.json \
         assets/3d assets/vendor/three assets/js/forja-personagens.js \
         assets/css/personagens-3d.css avaliacao-piloto-3d; do
  if [ -e "$OUT/$p" ]; then
    echo "ERRO: arquivo de desenvolvimento no artefato: $p" >&2
    exit 1
  fi
done

# Recursos obrigatórios do app e dos créditos.
for p in index.html \
         exercicio/index.html \
         assets/css/exercicio.css \
         assets/js/forja-exercicio.js \
         assets/videos/exercicios/manifest.json \
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

# Nenhum link publicado pode apontar para um arquivo que ficou de fora.
python3 - "$OUT" <<'PY'
import pathlib, re, sys, urllib.parse
root = pathlib.Path(sys.argv[1])
attr = re.compile(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', re.I)
md = re.compile(r'\[[^\]]*\]\(([^)]+)\)')
css = re.compile(r'url\(["\']?([^)"\']+)')
broken = []
for p in root.rglob('*'):
    if not p.is_file() or p.suffix.lower() not in ('.html', '.md', '.css', '.js'):
        continue
    text = p.read_text(encoding='utf-8', errors='replace')
    refs = md.findall(text) if p.suffix.lower() == '.md' else []
    if p.suffix.lower() in ('.html', '.js'):
        refs += attr.findall(text)
    if p.suffix.lower() == '.css':
        refs += css.findall(text)
    for ref in refs:
        ref = ref.strip()
        if not ref or ref.startswith(('#', 'data:', 'mailto:', 'http://', 'https://',
                                      '//', 'javascript:', 'blob:')):
            continue
        clean = urllib.parse.unquote(ref.split('#')[0].split('?')[0])
        if not (p.parent / clean).resolve().exists():
            broken.append(f'{p.relative_to(root)} -> {ref}')
if broken:
    print('ERRO: links quebrados no artefato:', file=sys.stderr)
    for item in broken:
        print('  ' + item, file=sys.stderr)
    sys.exit(1)
print('Links relativos do artefato: OK.')
PY

total="$(find "$OUT" -type f | wc -l)"
echo "Artefato pronto em $OUT: $total arquivos, $webp imagens WebP."
