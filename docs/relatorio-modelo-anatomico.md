# Modelo anatômico oficial — relatório de entrega

Branch `arena/2054f55e-forja`, base `0f24e7d`. Nada foi commitado, enviado,
aberto em PR ou mergeado: a entrega fica na árvore de trabalho para revisão.

## 1. A imagem

| Item | Valor |
| --- | --- |
| Arquivo | `assets/anatomia/fontes/forja-modelo-anatomico.png` |
| Origem | imagem anexada pelo usuário nesta revisão; copiada **byte a byte** |
| Procedência | **gerada por IA** (manifesto C2PA da OpenAI, verificado — §8) |
| Dimensões / formato | 1536 × 1024 · PNG RGBA, fundo transparente |
| SHA-256 | `2e1c9a0adb25b70106e6dd23744f30d7ec98ade325b101a109a0622014765cbf` |
| Bytes | 1 631 083 |

Nenhum personagem novo, nenhum redesenho, nenhuma arte genérica. O corpo
exibido no app é esse arquivo. As duas vistas são **janelas** do mesmo arquivo
(`x = 239` e `x = 842`, `y = -3`, 460 × 1024 cada), então o navegador baixa uma
imagem só e as vistas nunca ficam em escalas diferentes.

## 2. Onde o modelo antigo foi substituído

| Superfície | Como chega a figura |
| --- | --- |
| Atlas (`explorar/atlas.html`) | `F.figura.render` — vista anterior e posterior, exercício escolhido, grupo em foco |
| Detalhe na biblioteca / execução (`treino/biblioteca.html`, `treino/executar.html`) | `F.atlas.figurePair` e `attachToExecution` (mesmo módulo) |
| Modal "Músculos trabalhados" | `F.atlas.figurePair` |
| **Evolução/Progresso** (`progresso/index.html`) | aba "Músculos" — `#ev-muscles-figure` recebe `F.figura.render` (duas `.figura-svg`), com legenda e período próprios |

As fotografias e ilustrações de exercício (RepDB) **não** foram tocadas.

A prancha anterior (`fontes/referencia-muscular.png`, linhas brancas sobre
fundo preto) não é carregada por nenhuma página: uma busca por
`referencia-muscular` só encontra menções históricas em documentação.

## 3. O que mudou no código

- `assets/js/forja-figura.js` — reescrito para a prancha nova: `VIEWBOX`
  460 × 1024, `CROPS`, `AXES` (230), 16 regiões retraçadas sobre o corpo real
  (espelhadas em torno do eixo medido). API pública inalterada
  (`VIEWS, VIEWBOX, REFERENCE, MASK, INK, CROPS, AXES, ROLE_NAMES, REGIONS,
  render, describe, regionsInView, shapesFor`).
- `tools/gerar-anatomia-referencia.mjs` — mede o corpo de cada vista, acha o
  eixo por espelhamento, monta a janela e a escala **1:1**, deriva
  `mascara.png` (alfa > 140) e `tinta.png` (sombra, 4 degraus) e escreve o
  `manifest.json`.
- `assets/js/forja-progresso.js`, `assets/js/forja-evolucao.js`,
  `assets/css/atlas.css`, `progresso/index.html`, `explorar/*` — **sem
  alteração nesta branch**. Durante o rebase ficou claro que a `main` já havia
  entregado essas peças (aba "Músculos" com a figura, catálogo na Biblioteca,
  `atlas.css` carregado no Progresso). Minhas versões paralelas foram
  descartadas em vez de duplicar a funcionalidade — ver §5.1.
- `docs/modelo-anatomico.md`, `docs/atlas-anatomico.md`,
  `assets/anatomia/NOTICE.md` — janelas, escala, máscaras, regra do tecido,
  licença.
- `tools/verificar-procedencia.py` — **novo**: lê o manifesto C2PA da prancha e
  imprime hash, signatário, ações e tipo de origem (§8).
- `tests/atlas.test.mjs` — novo ATLAS 15 (procedência documentada × arquivo
  exibido).
- `.gitignore` — ignora o `.arena-chromium-howto.txt` (bootstrap do sandbox).

### A regra do short

O short é quase preto, então com o degradê normal ele recebia cor cheia e
virava mancha verde. Mas ele cobre a pelve, e **Glúteos** e **Quadril** vivem
ali. Em vez de apagar as regiões, a tinta sobre o tecido tem teto de alfa
próprio (`FABRIC_ALPHA = 78` contra 255 no resto do corpo): o destaque é um véu
translúcido, a peça continua preta e nenhum músculo é inventado sob o tecido.
A faixa é reconhecida pela própria imagem (massa escura abaixo de 42 % da
altura), não por coordenada digitada à mão; o manifesto registra
`ink.fabric.{ramp,alphaCeiling,pixels}`.

## 4. Compatibilidade preservada

- 16 IDs de grupo e a ordem de `regionsInView("front")` idênticos;
- `record.roles` (`primary` / `secondary` / `stabilizers`) do catálogo é a
  única fonte de papel — o Progresso lê `F.atlas.roleLabel`/`whereLabel` em
  vez de duplicar rótulos;
- exercício↔grupo, filtros, rankings, rotas e armazenamento intactos;
- um único sistema anatômico: nenhuma segunda figura foi criada.

## 5. Testes executados (resultados reais)

| Comando | Resultado |
| --- | --- |
| `node tests/atlas.test.mjs` | **15/15** aprovados |
| `npm test` | **387/387** aprovados, em 17 suítes (o total cresceu com as suítes que a `main` ganhou desde a base) |
| `npm run test:e2e` | **41/45** neste contêiner — as 4 falhas são de rede (CORS para `*.netlify.app`), idênticas na `main` sem esta mudança (ver §5.2) |
| `python3 tools/verificar-procedencia.py` | manifesto C2PA válido, hash confere (§8) |

Nenhuma falha, nenhum teste desativado.

### 5.1 "Catálogo inline ausente" — investigado, e a `main` já resolveu por outro caminho

O e2e antigo acusava **"Explorar — busca e resultados inline, filtros recolhidos
e atlas em acesso único" → "Catálogo inline ausente"**. Não foi tratado como
pré-existente: `git log -S "catalog-root"` mostrou que `forja-explorar.js` e
`forja-catalogo.js` registravam `F.pages.explorar`, e o último script a rodar
vencia, então `#catalog-root` nunca era criado.

Durante o rebase ficou claro que a `main` resolveu o mesmo problema por outro
caminho, mais estrutural: a busca do catálogo passou para a **Biblioteca**, a
inicialização saiu de `forja-catalogo.js` para `forja-biblioteca-visual.js` e o
e2e atual verifica `#catalog-root` na Biblioteca. Minha correção (`F.catalogoInline`)
ficou obsoleta nesse desenho — **foi descartada no rebase**, em vez de manter
duas formas concorrentes de montar a mesma tela.

### 5.2 As 4 falhas de e2e neste contêiner são ambientais (provado)

`npm run test:e2e` dá **41/45** aqui. As 4 falhas envolvem chamadas a
`https://prismatic-parfait-be3644.netlify.app/.netlify/functions/youtube-videos`.

Prova de que não é regressão desta entrega: clonei a `main` sem nenhuma mudança
minha (`d1083dc`), instalei e rodei o mesmo e2e — **as mesmas 4 falhas, 41/45**.
E o host nem responde deste sandbox (`curl` devolve `000`, a política de rede
bloqueia). Ou seja: as falhas são do ambiente, não do código. Não as "consertei"
afrouxando teste; elas passam onde o host é acessível.

Três limites de teste foram reajustados por serem específicos da prancha
antiga: cobertura de tinta por região ≥ 15 % (a deste desenho pinta fissuras,
não ventres claros), tinta total > 100 000 px e o "destaque pequeno demais"
passa a olhar a **maior** região da vista (a primeira podia ser uma faixa
estreita de abdômen).

## 6. Capturas (390 px e 1280 px)

Em `artifacts/forja-visual/`:

- `atlas-anatomico-390.png` / `atlas-anatomico-1280.png` — Flexão de braço
- `atlas-grupo-peito-390.png` / `-1280.png` — grupo Peitoral em foco
- `atlas-grupo-gluteos-390.png` / `-1280.png` — grupo Glúteos (véu sobre o short)
- `progresso-musculos-390.png` / `-1280.png` — aba "Músculos" do Progresso,
  com treinos reais semeados (figura, destaques por papel e percentuais)
- `ficha-exercicio-390.png` / `-1280.png` — ficha do exercício aberta na
  biblioteca (mesma prancha, destaques do exercício)
- `atlas-320/360/390/430/768/1280.png`, `execucao-*`, `biblioteca-*` — gerados
  por `node tools/capturas-atlas.mjs`

Medições do gerador de capturas: rolagem horizontal **0** em 320, 360, 390,
430, 768 e 1280 px em todos os estados; figuras de 131 px (320) a 250 px
(1280); destaques sempre dentro do quadro. Nas telas de conteúdo (Atlas,
grupo, ficha, Progresso): **overflow horizontal 0** em 390 e 1280 px.

Estado com exercício e estado sem exercício foram conferidos separadamente:
sem exercício o Atlas não pinta **nenhuma** região (0 de 42 caminhos); com
exercício pinta só as regiões classificadas daquele exercício (ex.: Flexão →
`peito:primary`, `ombros:secondary` ×2, `triceps:secondary`,
`abdomem:stabilizer`). As duas vistas usam **um único** arquivo de prancha
(`image href` idêntico em `front` e `back`).

Verificação visual: prancha centralizada, sem distorção, cabeça/mãos/pés
inteiros nas duas vistas; verde apenas nas regiões escolhidas; âmbar para
secundárias e azul para estabilizadoras; o resto do corpo permanece cinza.

## 7. Auditoria das regiões (medida, não a olho)

Três verificações objetivas, todas rodadas no navegador sobre a prancha real:

| Verificação | Método | Resultado |
| --- | --- | --- |
| Contenção na silhueta | 200 pontos amostrados por caminho, testados contra `mascara.png` com tolerância de 3 px (metade da espessura do traço) | **0 de 42** caminhos com mais de 2 % dos pontos fora do corpo; 1 amostra solta em 8 400 (0,01 %) |
| Densidade de tinta por região | média de alfa de `tinta.png` dentro de cada caminho, com cobertura e caixa | 18 regiões plausíveis (cobertura 0,25–0,98) |
| Posição de cada região | contorno desenhado individualmente sobre a prancha e inspecionado em recorte ampliado | todas sobre o músculo nomeado |

**Sobre a tolerância:** sem ela, 5 caminhos (`ombros`, `antebracos` nas duas
vistas) acusam de 3 a 30 % dos pontos "fora". A causa é geométrica, não de
posicionamento: a amostragem percorre a linha do contorno, e metade da espessura
do traço cai fora da silhueta por construção. O teste e2e usa exatamente essa
tolerância de ±3 px desde antes desta revisão. Reportar "0 %" sem citar a
tolerância daria a impressão de um rigor que a medição não tem — por isso o
número aparece com o critério ao lado.

A densidade sozinha engana: `b gluteos` dá 98 % de cobertura e ainda assim alfa
médio 36, porque o glúteo está sob o short. É o valor **esperado** pela regra do
tecido (§3), não um erro — mas foi justamente a porcentagem alta que escondeu,
numa rodada anterior, um `gluteos` traçado fora do lugar. Por isso a
conferência final foi feita em imagem ampliada, região por região, e não por
tabela.

Regiões retraçadas nesta revisão: **`gluteos`** (o polígono antigo subia para a
lombar e não cobria a massa glútea) e **`triceps`** (invadia o ombro). Nenhuma
outra foi alterada, e por isso os IDs, a ordem de `regionsInView` e os papéis do
catálogo continuam idênticos.

O que a auditoria **não** prova: precisão anatômica de dissecação. Os contornos
são projeções funcionais das regiões superficiais visíveis, não segmentação
clínica. Isso está dito na legenda da própria tela.

## 8. Procedência da imagem — o que foi apurado

A pergunta original era "de onde vem esta imagem e podemos usá-la". As duas
partes têm respostas diferentes, e a diferença importa.

**Procedência: verificada.** O PNG carrega um manifesto **C2PA** assinado,
lido com a biblioteca oficial do padrão (`pip install c2pa-python`), não por
inspeção de texto. Reproduzível com:

```bash
python3 tools/verificar-procedencia.py
```

| Campo | Valor |
| --- | --- |
| Estado da validação | `Valid` (assinatura da claim e timestamp conferem) |
| Signatário | `OpenAI OpCo, LLC` / `OpenAI Media Service` (Ps256) |
| Ação registrada | `c2pa.created` por `ChatGPT` (`gpt-image`) em 2026-11-10T14:47:18Z |
| Tipo de origem | `trainedAlgorithmicMedia` — **mídia gerada por IA** |
| Integridade | `assertion.dataHash.match` — os bytes exibidos são os assinados |

Ou seja: a prancha é **arte sintética**, gerada por IA, e não uma foto, um
modelo real ou um desenho de ilustrador humano. A prancha antiga
(`fontes/referencia-muscular.png`, linhas brancas) tem manifesto do mesmo tipo,
de 2026-10-30 — a origem por IA não nasceu nesta revisão; o que muda é passar a
documentá-la em vez de deixá-la como "origem não localizada". O único aviso é
`signingCredential.untrusted`: o certificado do signatário não está na lista de
confiança desta máquina. Isso não indica adulteração — hash e assinatura
passaram.

**Licença: continua não verificada.** O arquivo não declara licença, cessão de
direitos nem autorização de redistribuição. Procedência responde *como* o
arquivo foi produzido; não responde *o que se pode fazer* com ele. Portanto:

- nenhuma licença foi atribuída a esta imagem, e a antiga declaração CC BY-SA 4.0
  segue removida;
- nenhum projeto de terceiros (BodyParts3D, Z-Anatomy, Open Muscle Map) é
  apresentado como origem;
- a documentação do app passou a dizer que a prancha é gerada por IA, em vez de
  sugerir outra coisa (`assets/anatomia/NOTICE.md` §1–2,
  `docs/atlas-anatomico.md`);
- o teste **ATLAS 15** amarra o texto à evidência: falha se a imagem exibida
  deixar de ser a registrada no manifesto, se o manifesto perder a declaração de
  IA, ou se o NOTICE voltar a afirmar licença verificada.

Isso é deliberadamente desconfortável: a entrega fica com uma pendência aberta
que eu não tenho como fechar, e prefiro deixá-la visível a inventar uma licença.

## 9. Pendências para quem revisar

1. **Licença da imagem (bloqueia publicação)** — procedência verificada (§8),
   mas **não há licença nem autorização de redistribuição** no arquivo. Precisa
   de decisão explícita de quem publica antes de merge/release, incluindo se o
   conteúdo gerado por IA será identificado ao usuário final
   (`assets/anatomia/NOTICE.md` §2.2). Não há merge nem publicação nesta
   entrega.
2. **Prancha feminina** — não existe versão feminina deste desenho; o campo
   `sexo` do perfil continua escolhendo apenas o personagem das demonstrações.
3. ~~"Catálogo inline ausente" no e2e~~ — resolvido na `main` por outro caminho
   (§5.1); a correção paralela desta branch foi descartada para não duplicar.
4. **4 falhas de e2e por CORS/Netlify** — ambientais, reproduzidas na `main`
   limpa (§5.2). Rodam normalmente onde o host é acessível.
