# FORJA_ASSETS_3D

Pasta exclusiva para os recursos 3D do FORJA: personagem humanoide, rig,
animações de exercícios, texturas, materiais e recursos relacionados.

## Situação atual

**Estrutura criada, nenhum arquivo de arte enviado ainda.** Este diretório está
**desligado do aplicativo**: nada aqui é carregado por `index.html`, JavaScript,
CSS ou pelos testes. O personagem atual do app não foi alterado.

Também fica fora do site publicado: `tools/preparar-site.sh` copia apenas as
páginas do app e `assets/`, então `FORJA_ASSETS_3D/` permanece no repositório
como acervo, não como recurso de runtime.

## Estrutura

```
FORJA_ASSETS_3D/
├── personagem/
│   ├── modelo/         malha do personagem (GLB, FBX, OBJ, BLEND…)
│   ├── rig/            esqueleto, controles, pesos de skin
│   └── referencias/    imagens de apoio, medidas, proporções
├── animacoes/
│   ├── exercicios/     animações por exercício (uma ação por exercício)
│   └── bases/          idle, respiração, transições e poses base
├── texturas/
│   ├── personagem/     pele, tecido, cabelo (albedo, normal, roughness…)
│   ├── equipamentos/   texturas de halteres, barras, cordas, colchonetes
│   └── ambiente/       piso, paredes, espelhos
├── materiais/          definições de material (MTL, JSON, .blend de material)
├── equipamentos/       malhas 3D dos equipamentos de treino
├── ambiente/           cenário, iluminação, HDRI, skybox
├── fontes/             arquivos originais editáveis (.blend, .psd, .zbr)
└── exportados/         versões finais otimizadas para o app (GLB/Draco/KTX2)
```

Cada subpasta contém um `.gitkeep` apenas para o Git preservar a estrutura
enquanto está vazia.

## Convenção de nomes

- **minúsculas, sem acentos, separadas por hífen** — igual ao resto do projeto:
  `supino-reto-barbell.glb`, `agachamento-livre-start.fbx`.
- Animações de exercício: `<slug-do-exercicio>-<variante>.<ext>`, usando o
  mesmo slug já existente no catálogo de exercícios do app.
- Texturas: `<material>-<mapa>.<ext>` (`pele-albedo.png`,
  `pele-normal.png`, `haltere-metal-roughness.png`).
- Origens permanecem em `fontes/`; só o que vai para o app entra em
  `exportados/`, com o mesmo nome base da origem.
- Um arquivo por recurso. Sem cópias duplicadas entre pastas.

## O que enviar e onde

| Recurso | Destino |
| --- | --- |
| Personagem humanoide 3D | `personagem/modelo/` |
| Esqueleto / rig | `personagem/rig/` |
| Animações de exercícios | `animacoes/exercicios/` |
| Animações de base e transição | `animacoes/bases/` |
| Texturas do personagem | `texturas/personagem/` |
| Texturas de equipamentos | `texturas/equipamentos/` |
| Texturas de ambiente | `texturas/ambiente/` |
| Materiais | `materiais/` |
| Malhas de equipamentos | `equipamentos/` |
| Cenário, luz, HDRI | `ambiente/` |
| Arquivos originais editáveis | `fontes/` |
| Build final otimizado | `exportados/` |

## Observações técnicas

- **Tamanho:** o GitHub recusa arquivos acima de 100 MB. Para `.blend`,
  `.psd`, `.zbr` ou pacotes de textura pesados, avise antes do envio para
  combinarmos Git LFS ou armazenamento externo.
- **Licença:** ao enviar, indique origem e licença de cada recurso. Quando os
  primeiros arquivos chegarem, a procedência será registrada em um `NOTICE.md`
  nesta pasta, seguindo o padrão de `assets/anatomia/NOTICE.md`.
- **Formatos recomendados:** GLB (malha + rig + animação), PNG/WebP (texturas),
  HDRI `.hdr`; `.blend`/`.fbx` como origem em `fontes/`.
- **Integração:** nenhuma. Qualquer uso no app será uma etapa posterior,
  aprovada separadamente.
