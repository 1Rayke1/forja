# FORJA

Aplicativo estático de treinos, calendário e missões. Funciona sem build,
sem backend e sem conta: os dados ficam no `localStorage` do navegador.
Publicável diretamente no GitHub Pages (inclusive sob `/forja/`). O perfil guiado é obrigatório para entrar nas páginas do app; o onboarding e o plano local não exigem backend. A integração de IA real é opcional e requer uma Function/backend configurado (veja `docs/planejamento-inteligente.md`).

## Executar

```sh
npm install
npm run serve          # http://127.0.0.1:8080/
npm test               # métricas, forja, onboarding, atlas, paridade, demonstrações
npm run test:e2e       # Chromium real, servindo o repo sob /forja/
```

## Ilustrações de exercícios

As demonstrações visuais usam um subconjunto do catálogo livre da RepDB.

> **Exercise data by [RepDB (repdb.co)](https://repdb.co)** — usado sob a
> [RepDB Free Tier License v1.0](assets/demonstracoes/LICENSE-DATA.md), com
> atribuição visível. © 2026 Sergei Argutin (RepDB).

- Procedência, restrições e hashes: [`assets/demonstracoes/NOTICE.md`](assets/demonstracoes/NOTICE.md)
  e [`assets/demonstracoes/manifest.json`](assets/demonstracoes/manifest.json).
- Mapeamento, status (`exact`/`review`/`none`) e revisões visuais:
  [`docs/demonstracoes-revisao.md`](docs/demonstracoes-revisao.md).
- Créditos completos: [`docs/creditos-repdb.md`](docs/creditos-repdb.md).

```sh
node tools/sincronizar-repdb.mjs --check   # valida hashes, tamanho e bundle
```

Ferramenta de revisão visual: `tools/revisao-demonstracoes.html` (abrir por
HTTP, não `file://`). Nenhuma imagem de `premium-samples/`, nenhuma fonte
externa e nenhum processamento por IA generativa foram usados. Observação de
procedência: o próprio RepDB declara que as ilustrações foram criadas com
ferramentas de IA sob encomenda; o FORJA apenas as copia, sem derivação
generativa.

A figura anatômica do atlas é um recurso separado, com aviso próprio em
`assets/anatomia/NOTICE.md`.

## Demonstrações dos exercícios

O FORJA **não tem personagens 3D**: não existe modelo, rig, clipe, visualizador
nem dependência 3D no repositório. A demonstração de cada exercício será um
**vídeo horizontal de uma pessoa real**, com no máximo 60 segundos, reproduzido
na tela de apresentação do exercício (`exercicio/`).

- Especificação, nome do arquivo, curadoria de origem e manifesto:
  [`assets/videos/exercicios/README.md`](assets/videos/exercicios/README.md).
- Enquanto um exercício não tiver vídeo aprovado, a tela mostra o estado de
  pendência — não há prévia 3D, não há movimento emprestado de outro exercício
  e nenhuma busca automática é feita.
- As ilustrações da RepDB continuam sendo a demonstração visual dentro do app
  (biblioteca, treino e histórico). A tela de execução do treino mostra só a
  ilustração e a figura anatômica; ela não tem player de vídeo.

### Proibido: vídeo renderizado a partir de personagem 3D

Nenhum vídeo gerado por Blender/Cycles, manequim, retarget de mocap ou
renderizador 3D pode entrar em `assets/videos/exercicios/`. A regra é verificada
automaticamente em três pontos:

| Verificação | Onde |
| --- | --- |
| Nenhum arquivo de vídeo (`mp4`, `webm`, `mov`, `m4v`, `ogv`) pode existir sem estar listado no manifesto | `tests/exercicio-apresentacao.test.mjs` |
| O pacote publicado é montado a partir do manifesto e recusa vídeo órfão | `tools/preparar-site.sh` |
| A pasta de vídeos deve conter apenas `README.md` e `manifest.json` enquanto não houver vídeo aprovado | `tests/exercicio-apresentacao.test.mjs` |

Na remoção do sistema 3D (2026-11) foram apagados **4 MP4** renderizados em
Blender/Cycles a partir do personagem 3D masculino — dois do piloto abdominal
(16:9 e 9:16) em `avaliacao-piloto-3d/midia/` e duas cópias idênticas em
`docs/validacao-3d/piloto-abdominal-masculino/`. O relatório completo está em
[`docs/remocao-sistema-3d.md`](docs/remocao-sistema-3d.md).

## Documentação

- `docs/forja-rotinas-e-backup.md` — formato de dados, migração e backup JSON.
- `docs/fotografias-exercicios.md` — contrato de fotos do catálogo (nenhuma publicada).
- `docs/fotografias-explorar.md` — fotografias reais da tela Explorar: procedência, licença, contrato e validação.
- `docs/atlas-anatomico.md` — classificação muscular e figuras.
- `docs/testes-paridade.md` — suíte de paridade.
