# FORJA

Aplicativo estático de treinos, calendário e missões. Funciona sem build,
sem backend e sem conta: os dados ficam no `localStorage` do navegador.
Publicável diretamente no GitHub Pages (inclusive sob `/forja/`). O perfil guiado é obrigatório para entrar nas páginas do app; o onboarding e o plano local não exigem backend. As integrações opcionais de IA real e da busca de vídeos do YouTube usam as Netlify Functions (veja `docs/planejamento-inteligente.md`, `docs/videos-youtube.md` e `docs/backend-e-cors.md`): em produção o frontend resolve automaticamente os endpoints da Netlify, tanto no site dela quanto no GitHub Pages.

## Executar

```sh
npm install
npm run serve          # http://127.0.0.1:8080/
npm test               # métricas, forja, onboarding, atlas, paridade, demonstrações, vídeos e proxy YouTube
npm run test:e2e       # Chromium real, servindo o repo sob /forja/
```

A pesquisa de vídeos por API exige backend (Netlify Functions) e a variável
`YOUTUBE_API_KEY` no ambiente privado — veja `.env.example` e
[`docs/videos-youtube.md`](docs/videos-youtube.md). Sem backend, o app continua
funcionando com os vídeos oficiais e as ilustrações de referência.

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
nem dependência 3D no repositório.

As demonstrações reais de execução funcionam por incorporação oficial do YouTube
no modo de privacidade aprimorada (`youtube-nocookie.com`), em container `16:9`
horizontal, sem reprodução automática, com controles visíveis e **sempre sem
áudio** (`mute=1`):

- **Vídeos oficiais**: 26 tutoriais curtos (até 60 s, `16:9`, enquadramento
  original) mapeados em `assets/js/forja-videos-dados.js`. Não são substituídos
  pela pesquisa.
- **Treinos personalizados**: no editor de rotinas (`treino/rotina.html`), o
  botão **"Procurar vídeo"** abre um modal com o exercício identificado, campo de
  pesquisa por nome/termo relacionado, resultados com título, miniatura, canal e
  duração, prévia `16:9` silenciosa e os botões **Visualizar**, **Cancelar** e
  **Confirmar vídeo**. A escolha vale somente para aquele treino.
- **Pesquisa via YouTube Data API v3**: feita exclusivamente pelo proxy
  `netlify/functions/youtube-search.mjs` (rota `/api/youtube-search`), que guarda
  `YOUTUBE_API_KEY` no ambiente do backend, aplica cache, controla a quota diária
  e trata erros. Nenhuma chave existe no JavaScript público. Detalhes,
  configuração externa pendente e limitações em
  [`docs/videos-youtube.md`](docs/videos-youtube.md).
- **Somente vídeos convencionais horizontais**: YouTube Shorts **não** são
  aceitos — nem nos resultados, nem por link colado — e o antigo ajuste de "zoom
  e corte 16:9" foi removido. Um vídeo cuja orientação horizontal não puder ser
  confirmada não é oferecido para seleção.
- **Fallback automático**: quando um exercício ainda não possui vídeo ou o
  vídeo está indisponível/removido, o FORJA exibe automaticamente a ilustração
  de referência da RepDB com aviso discreto (`"Vídeo de demonstração ainda não
  disponível"`). Nenhum vídeo do YouTube é baixado ou salvo no repositório.

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

- `docs/videos-youtube.md` — vídeos de demonstração, pesquisa via YouTube Data API v3, segurança da chave, exclusão de Shorts e quota.
- `docs/forja-rotinas-e-backup.md` — formato de dados, migração e backup JSON.
- `docs/catalogo-exercicios.md` — catálogo central, critérios editoriais, distribuição e compatibilidade de IDs.
- `docs/youtube-exercicios.md` — administração segura, Netlify Blobs, revisão e player de demonstrações YouTube.
- `docs/fotografias-exercicios.md` — contrato de fotos do catálogo (nenhuma publicada).
- `docs/fotografias-explorar.md` — fotografias reais da tela Explorar: procedência, licença, contrato e validação.
- `docs/atlas-anatomico.md` — classificação muscular e figuras.
- `docs/testes-paridade.md` — suíte de paridade.
