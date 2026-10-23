# Atlas anatômico — referência realista e destaques registrados

## 1. Decisão desta revisão

O Atlas usa as pranchas musculares realistas fornecidas pelo usuário. O corpo exibido é um recorte raster dessas referências, da cabeça aos pés, nas vistas anterior e posterior. Não é um boneco vetorial, uma silhueta abstrata nem uma reconstrução por polígonos.

A classificação muscular e os papéis do catálogo não foram alterados. A mudança fica restrita à base visual, ao registro dos destaques, à documentação e aos testes dessa integração.

### Por que o PR #12 foi reprovado

A inspeção do commit `28a97055c0dcb68fd5d27336d79378f7ce3733b3` mostrou:

- `anterior.svg` e `posterior.svg` desenhavam a anatomia com polígonos e curvas genéricas;
- os desenhos não possuíam as fibras, divisões e relações anatômicas das referências;
- os caminhos `SILHOUETTES` aplicados como recorte não coincidiam com esses desenhos;
- a composição entre prancha, recorte e regiões produzia vazios, membros fragmentados e contornos artificiais;
- os testes validavam dimensões e geometria, mas não a identidade visual nem a correspondência com a referência.

O commit foi preservado no histórico. A correção remove a abordagem rejeitada do resultado final sem reescrever o restante da aplicação.

## 2. Fonte e enquadramento

A referência masculina contém as duas vistas do mesmo modelo e na mesma escala. Os recortes são:

| Vista | Arquivo exibido | Recorte na referência de 740 × 740 | PNG final | Corpo opaco detectado |
| --- | --- | --- | --- | --- |
| Anterior | `assets/anatomia/anterior.png` | `x=40`, `y=16` | 350 × 690 RGBA | `x=11..303`, `y=12..673` |
| Posterior | `assets/anatomia/posterior.png` | `x=360`, `y=16` | 350 × 690 RGBA | `x=42..333`, `y=12..665` |

Assim, há margem transparente ao redor da cabeça, das mãos e dos pés. Não há corte no topo, na base ou nas laterais. `preserveAspectRatio="xMidYMid meet"` mantém as proporções em todas as telas.

A segunda referência, feminina, foi preservada sem alteração em `assets/anatomia/fontes/`, mas não é misturada com o modelo masculino. Não foi acrescentado seletor de modelo nem alterada a navegação.

## 3. Arquitetura visual

Cada figura contém:

1. um `<image class="figura-plate">` com o PNG de referência;
2. uma `<mask>` que referencia exatamente o mesmo PNG e usa seu canal alfa;
3. uma camada de destaques com os caminhos da região selecionada.

Não existe mais uma silhueta vetorial independente nem `clipPath` baseado em outro corpo. Isso elimina a possibilidade de a máscara e a prancha divergirem.

Os destaques usam `mix-blend-mode: color` e preenchimento translúcido. A cor muda sem apagar a luminância e os detalhes da musculatura:

| Papel | Cor | Preenchimento |
| --- | --- | --- |
| Principal | verde-limão `#b7f34a` | 0,62 |
| Secundária | âmbar `#f2b84b` | 0,56 |
| Estabilizadora | azul `#8cc0e0` | 0,54 |
| Informada por você | cinza `#b2bab1` | 0,45 |
| Grupo em foco | verde-limão | 0,58 |

A legenda textual e o nome do papel continuam disponíveis; a cor não é a única forma de identificação.

## 4. Mapa funcional e limitações

Os 16 IDs existentes foram preservados:

| ID | Vista(s) | Indicação superficial sobre a referência |
| --- | --- | --- |
| `peito` | anterior | peitorais visíveis |
| `ombros` | anterior e posterior | deltoides visíveis |
| `biceps` | anterior | ventre anterior do braço |
| `triceps` | posterior | ventre posterior do braço |
| `antebracos` | anterior e posterior | musculatura do antebraço, sem incluir a mão |
| `abdomem` | anterior | reto abdominal visível |
| `obliquos` | anterior | oblíquos externos laterais |
| `costas` | posterior | trapézio e região escapular superior visíveis |
| `dorsais` | posterior | grandes dorsais visíveis |
| `lombar` | posterior | projeção superficial da região lombar |
| `gluteos` | posterior | glúteos visíveis |
| `quadril` | anterior | projeção superficial da região inguinal/quadril |
| `quadriceps` | anterior | quadríceps, respeitando a região patelar |
| `posterior-coxa` | posterior | isquiotibiais até a fossa poplítea |
| `panturrilha` | posterior | ventres da panturrilha; o tendão calcâneo não é pintado como ventre muscular |
| `pernas` | anterior e posterior | composição das regiões gerais de coxa e perna já visíveis |

Esses destaques são **projeções funcionais aproximadas**, não segmentação clínica. Eles não afirmam delimitar músculos profundos. Essa limitação aparece na própria interface e no texto alternativo/documentação; nenhum contorno extra é inventado para estruturas que a imagem não permite distinguir.

## 5. Integração preservada

Continuam intactos:

- catálogo de exercícios e seus 37 registros sugeridos;
- papéis `primary`, `secondary` e `stabilizers` definidos no catálogo;
- aliases e os 16 IDs de grupos musculares;
- seleção por exercício e exploração por grupo;
- filtros por modalidade e estados vazios;
- detalhe na biblioteca e consulta durante a execução;
- armazenamento local, rotinas, sessões e histórico;
- navegação e demais páginas.

O Atlas continua apenas lendo a classificação. Não grava nem limpa dados do usuário.

## 6. Testes que verificam a imagem, não apenas o SVG

### `npm test`

Além dos fluxos existentes, o teste `ATLAS 3` verifica:

- assinatura e dimensões reais dos PNG;
- canal RGBA;
- hashes das pranchas e da referência no `manifest.json`;
- margens de enquadramento registradas;
- ausência da antiga silhueta e dos `clipPath` geométricos;
- uso do mesmo href, largura e altura na imagem e em sua máscara;
- interação por clique/teclado e regiões disponíveis por vista.

As outras suítes continuam cobrindo preservação de dados, catálogo, rotinas, métricas e paridade.

### `npm run test:e2e`

Uma verificação específica em Chromium:

1. decodifica a referência e as duas pranchas;
2. compara cada pixel opaco com o mesmo pixel do recorte original — diferença máxima permitida de 1/255 por canal, exclusivamente para arredondamento do decodificador;
3. mede os limites reais do canal alfa para detectar corte de cabeça, mãos ou pés;
4. percorre 24 pontos da borda de cada um dos 41 contornos e exige corpo opaco em um raio de 2 px;
5. verifica as três cores, a transparência e `mix-blend-mode: color` computados no navegador.

Esse teste falharia nas pranchas geométricas do PR #12 e também falha se um contorno sair da anatomia visível.

### Evidência visual

`tools/capturas-atlas.mjs` abre a aplicação de verdade e produz capturas em 320, 360, 390, 430, 768 e 1280 px. As evidências ficam em `artifacts/forja-visual/`, incluindo:

- `atlas-mobile-390.png`: flexão, anterior e posterior em celular;
- `atlas-desktop-1280.png`: o mesmo estado em desktop;
- `atlas-posterior-390.png`: dorsais na barra fixa;
- `atlas-vazio-390.png`: panturrilha em foco, com pés e pernas completos;
- `atlas-inicial-390.png`: modelo neutro, sem destaques inventados.

A captura complementar `atlas-regioes-auditoria.png`, também gerada em navegador durante esta revisão, reúne as 21 combinações de região/vista para inspeção visual conjunta.

## 7. Regeneração

Com as dependências instaladas:

```bash
npm ci
node tools/gerar-anatomia-referencia.mjs
```

Em contêineres mínimos, pode ser necessário apontar `LD_LIBRARY_PATH` para as bibliotecas de `al2023.tar.br`, conforme documentado nos testes do projeto.

O gerador não cria anatomia nem contornos musculares. Ele só recorta a referência, remove o fundo externo e grava o manifesto. Qualquer alteração manual de região precisa ser seguida pela auditoria E2E e por capturas reais.

## 8. Bloqueio de licença e publicação

Os anexos não fornecem autoria, origem ou licença verificável. Portanto, a antiga declaração CC BY-SA 4.0 foi removida: ela não era comprovada para estas imagens.

A situação está registrada como **não verificada** em `assets/anatomia/NOTICE.md`. Antes de `main` ou release, é necessário confirmar titular, licença/autorização e atribuição. Merge e publicação também dependem de autorização explícita do usuário.
