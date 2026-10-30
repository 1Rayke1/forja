# Atlas anatômico — prancha de referência e destaques registrados

## 1. Decisão desta revisão

O Atlas usa **a imagem fornecida pelo usuário nesta revisão** (duas vistas,
fundo preto, linhas brancas). Ela substitui a ilustração realista sobre fundo
branco da revisão anterior. O corpo exibido é essa imagem, da cabeça aos pés,
nas vistas anterior e posterior — sem redesenho, sem vetorização e sem
substituição por ilustração gerada.

A classificação muscular e os papéis do catálogo não mudaram. A mudança fica
restrita à base visual, ao registro dos destaques, à documentação e aos testes
dessa integração.

Detalhes da prancha, das máscaras derivadas e do mapa de regiões:
`docs/modelo-anatomico.md`. Origem, licença e limitações: `NOTICE.md` em
`assets/anatomia/`.

### Por que o PR #12 foi reprovado

A inspeção do commit `28a97055c0dcb68fd5d27336d79378f7ce3733b3` mostrou:

- `anterior.svg` e `posterior.svg` desenhavam a anatomia com polígonos e curvas
  genéricas;
- os desenhos não possuíam as fibras, divisões e relações anatômicas das
  referências;
- os caminhos `SILHOUETTES` aplicados como recorte não coincidiam com esses
  desenhos;
- os testes validavam dimensões e geometria, mas não a identidade visual nem a
  correspondência com a referência.

O commit continua no histórico. A correção não reintroduz nenhuma silhueta
desenhada por código e os testes atuais falhariam em uma prancha redesenhada.

### Situação do PR #9 (Open Muscle Map)

O PR #9 (`Figura anatômica: Open Muscle Map (MIT) substitui a silhueta
vetorial`) está **aberto, não integrado**. Ele traria um desenho vetorial de
terceiros (`assets/anatomia/*.svg`, `forja-figura-dados.js`, licença MIT do
Open Muscle Map). Nada disso existe em `main` nem nesta branch: o módulo
`forja-figura-dados.js` não faz parte deste repositório.

Esta revisão não depende do PR #9 e não reutiliza aquele desenho: a exigência
aqui é preservar **a imagem enviada**, o que um SVG vetorial de outra origem não
atenderia. Se o PR #9 for retomado, ele precisa ser reconciliado com esta base
(uma prancha raster por janela, máscaras derivadas e 16 IDs inalterados).

## 2. Fonte e enquadramento

Um único arquivo com as duas vistas:

| Vista | Janela na prancha | Canvas | Corpo detectado na janela |
| --- | --- | --- | --- |
| Anterior | `x = 110`, `y = 0` | 600 × 1024 | `x=20..579`, `y=2..1010` |
| Posterior | `x = 770`, `y = 0` | 600 × 1024 | `x=13..585`, `y=2..1009` |

Os limites vêm da silhueta derivada (`mascara.png`) e estão no
`manifest.json`. Há margem em todos os lados: nada de cabeça, mãos ou pés
cortados. `preserveAspectRatio="xMidYMid meet"` mantém a proporção em qualquer
largura e as duas janelas têm o mesmo tamanho, então as vistas ficam alinhadas.

## 3. Arquitetura visual

Cada figura contém:

1. um `<image class="figura-plate">` com a prancha de referência, deslocada
   para mostrar a janela da vista;
2. `<defs>` com duas máscaras derivadas: `mascara.png` (silhueta) e `tinta.png`
   (áreas escuras do desenho);
3. por região: `.figura-region-shape` (só cor, recortada pela tinta) e
   `.figura-region-outline` (só contorno, recortado pela silhueta), mais uma
   área de clique invisível quando a figura é interativa.

Não existe silhueta vetorial independente nem `clipPath` baseado em outro
corpo. Nenhuma camada usa `mix-blend-mode` — ver a seção 3 de
`docs/modelo-anatomico.md` para o motivo e para o defeito de composição do
Chromium que obrigou essa decisão.

| Papel | Cor | Preenchimento | Contorno |
| --- | --- | --- | --- |
| Principal | verde-lima `#b7f34a` | 0,92 | 1,6 px |
| Secundária | âmbar `#f2b84b` | 0,90 | 1,4 px |
| Estabilizadora | azul `#8cc0e0` | 0,88 | 1,4 px tracejado |
| Informada por você | cinza `#b2bab1` | 0,80 | 1,3 px tracejado |
| Grupo em foco | verde-lima | 0,85 | 1,8 px tracejado |

A cor **nunca** é a única informação: a legenda escreve o papel, cada região
tem `aria-label` com nome e papel, e o texto alternativo da figura repete a
classificação por extenso.

## 4. Mapa funcional e limitações

Os 16 IDs existentes foram preservados e cada um tem nota própria no código.
A tabela completa (ID → vista → o que a região representa) e as limitações
anatômicas estão em `docs/modelo-anatomico.md`, seção 4.

Resumo das limitações:

- os destaques são **projeções funcionais aproximadas**, não segmentação
  clínica;
- o desenho é superficial, então músculos profundos não são isolados;
- "Quadril" e "Lombar" indicam projeção de região;
- patela e tendão calcâneo ficam neutros;
- nada é preenchido por suposição: exercício sem classificação não recebe
  destaque.

## 5. Integração preservada

Continuam intactos:

- catálogo de exercícios e seus registros sugeridos;
- papéis `primary`, `secondary` e `stabilizers` definidos no catálogo;
- aliases e os 16 IDs de grupos musculares;
- seleção por exercício e exploração por grupo;
- filtros por modalidade e estados vazios;
- detalhe na biblioteca e consulta durante a execução;
- armazenamento local, rotinas, sessões e histórico;
- seleção de sexo no perfil, que continua escolhendo apenas o personagem das
  demonstrações (ver `NOTICE.md`, seção 5);
- navegação e demais páginas.

O Atlas continua apenas lendo a classificação. Não grava nem limpa dados do
usuário.

## 6. Testes que verificam a imagem, não apenas o SVG

### `npm test`

O teste `ATLAS 3` verifica:

- as duas vistas usam **o mesmo arquivo** e janelas diferentes;
- `x`, `y`, largura e altura da prancha e das duas máscaras coincidem;
- viewBox igual nas duas vistas e ausência de `rect`, `clipPath`, `line` ou
  `polygon` — nada de corpo desenhado;
- assinatura PNG e hash SHA-256 da referência, das máscaras e do manifesto;
- os recortes do manifesto são iguais aos da figura;
- todo caminho de região é fechado e cabe na viewBox;
- o texto alternativo lista só as regiões daquela vista;
- clique, Enter e Espaço selecionam a região e o `aria-label` traz nome e papel.

O teste `ATLAS 13` verifica que o sexo informado continua resolvendo o
personagem e **não** altera a prancha, e que a referência feminina anterior
segue preservada e inalterada.

O teste `ATLAS 11` guarda as regressões de pintura: exige
`.figura-svg { overflow: hidden }`, proíbe `mix-blend-mode` nas camadas de
destaque, exige cor e contorno em elementos separados e confere o orçamento de
bytes dos três arquivos de anatomia.

As demais suítes continuam cobrindo preservação de dados, catálogo, rotinas,
métricas, onboarding e paridade.

### `npm run test:e2e` (Chromium real)

Uma verificação específica:

1. baixa a prancha e confere o SHA-256 com `crypto.subtle`;
2. confere dimensões de prancha e máscaras;
3. confere que `tinta.png` é subconjunto de `mascara.png` (nenhum pixel de cor
   fora do corpo) e que não há tinta sobre as linhas claras;
4. confere a janela de cada vista e o corpo inteiro com margem;
5. percorre 40 pontos da borda de cada um dos 39 caminhos e exige silhueta a
   até 3 px;
6. exige 50% ou mais de tinta no interior de cada região — região sem cor
   visível falha;
7. confere as cores e a ausência de blend computadas no navegador;
8. redimensiona em 320, 360, 390, 430, 768 e 1280 px e exige que a posição e o
   tamanho relativos de cada destaque não mudem (nada de deslocamento) e que
   não haja rolagem horizontal.

### Evidência visual

`tools/capturas-atlas.mjs` abre a aplicação de verdade e produz capturas em
320, 360, 390, 430, 768 e 1280 px, medindo a rolagem horizontal em cada estado.
As imagens ficam em `artifacts/forja-visual/`:

- `atlas-mobile-390.png`, `atlas-desktop-1280.png` — flexão, anterior e
  posterior;
- `atlas-posterior-390.png` — dorsais na barra fixa;
- `atlas-inicial-390.png` — modelo neutro, sem destaques inventados;
- `execucao-figura-390.png`, `execucao-treino-mobile-390.png` — figura compacta
  durante o treino;
- `biblioteca-figura-390.png` — o mesmo modelo no detalhe da biblioteca.

## 7. Regeneração

```bash
npm ci
node tools/gerar-anatomia-referencia.mjs
node tools/capturas-atlas.mjs
```

Em contêineres mínimos, pode ser necessário apontar `LD_LIBRARY_PATH` para as
bibliotecas de `al2023.tar.br` e `PUPPETEER_EXECUTABLE_PATH` para o Chromium,
conforme documentado em `docs/forja-2.0-refresh.md`.

O gerador não cria anatomia nem contornos musculares. Ele só calcula as
máscaras, confere a prancha e grava o manifesto. Qualquer alteração manual de
região precisa ser seguida pela auditoria E2E e por capturas reais.

## 8. Bloqueio de licença e publicação

A imagem não traz autoria, origem ou licença verificável. Nenhuma licença
Creative Commons é atribuída a ela.

A situação está registrada como **não verificada** em
`assets/anatomia/NOTICE.md`. Antes de `main` ou release, é necessário confirmar
titular, licença/autorização e atribuição. Merge e publicação dependem de
autorização explícita do usuário.
