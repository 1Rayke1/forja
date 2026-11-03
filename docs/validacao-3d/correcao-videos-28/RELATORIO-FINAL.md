# Correção dos 28 vídeos 3D — relatório final de validação

Data: 2026-11-03 · Branch: `arena/4cf65613-forja` · PR: https://github.com/1Rayke1/forja/pull/52 (OPEN, não mesclado)

> Escopo respeitado: **nenhum** modelo, material, iluminação, animação ou normal oficial foi alterado.
> Não houve merge, publicação, release nem alteração na `main`.

---

## 1. Causa raiz e correção

`renderizarFrame()` em `tools/renderizar-videos-3d.mjs` zerava apenas o buffer de **profundidade**. O buffer de **cor** era preenchido uma vez em `criarAlvo()` e nunca limpo: cada quadro desenhava sobre o anterior. A perna que varre um arco virava um leque com nervuras radiais; as bordas acumuladas viravam zigue-zagues.

Correção (sem tocar no GLB): `criarAlvo()` passa a guardar `fundo`; todo quadro executa `alvo.cor.set(alvo.fundo)` e `alvo.profundidade.fill(Infinity)`.

Investigações anteriores (BMP, UV, normais/sombreamento) foram mantidas — BMP e UV eram defeitos reais já corrigidos e testados. A hipótese antiga de "skinning/normais do GLB" foi **descartada**: o WebGL oficial com o mesmo GLB sempre esteve limpo.

Evidência do rastro: `quadros/antes-limpeza-{elevacao-pernas,ponte}.png`; medição em `logs/final/26-controle-negativo.txt` (`(760,560)=[139,115,82]`, `(820,600)=[159,137,91]`, `(900,620)=[153,131,90]`) contra fundo limpo `[15,16,13]`.

---

## 2. Resultado final de todos os testes

| # | Verificação | Resultado | Log |
|---|---|---|---|
| 1 | Re-render dos 28 MP4 **após** a correção | 28 OK / 0 falhas; 1280×720 @30 fps, 16:9, sem áudio | `logs/final/13-rerender-definitivo-28.txt` |
| 2 | Manifesto regenerado | 37 exercícios, 14 com clipe / 14 com vídeo pronto, 23 sem | `logs/final/14-gerar-manifesto.txt` |
| 3 | `gerar-apresentacao-exercicios.mjs --check` | EXIT=0 | `logs/final/15`, `22` |
| 4 | `npm test` (16 suítes) | **EXIT=0, todas verdes** — incl. 5 limpeza, 10 normais, 7 UV, 6 BMP | `logs/final/16`, `20` |
| 5 | `npm run test:e2e` (Chromium real) | **35/36** — 1 falha pré-existente, fora do escopo | `logs/final/21-e2e-final.txt` |
| 6 | Validador offline | 28/28 aprovados, 0 problemas; 28 referências, 28 MP4, 0 órfãos | `logs/final/17`, `23` |
| 7 | Decodificação/reprodução em Chromium real | 28/28 aprovados, 0 problemas | `logs/final/18`, `24` |
| 8 | Comparação WebGL oficial × MP4 | 28 casos / 84 comparações, EXIT=0 | `logs/final/19-comparacao-webgl.txt` |
| 9 | Regressão do buffer de cor | 5 testes verdes + controle negativo | `logs/final/25`, `26` |
| 10 | Auditoria da grade 14×2 | 28 células, 14 linhas completas | `auditoria-grade-14x2.{json,md}` |

**Falha E2E (não ocultada):** `Explorar — busca e resultados inline, filtros recolhidos e atlas em acesso único` → `Catálogo inline ausente`. Já existia antes desta correção, não envolve os 28 MP4, o rasterizador ou a cena 3D. Não foi mexida para não inflar o escopo.

**Sobre FPS no Chromium headless:** `requestVideoFrameCallback` mede 27.95–29.66 fps e `fpsApresentados` 28.26–29.52 em clipes curtos, mas `getVideoPlaybackQuality().totalVideoFrames` confere com `round(duração×30)` em todos os 28 — **desvio máximo 0**. O `fpsDeclaradoNoArquivo` é 30 em todos. Isso é limitação de temporização do headless, não perda de quadros.

---

## 3. Confirmação dos 28 MP4 finais

- Re-render executado **depois** da correção do buffer de cor: `logs/final/13-rerender-definitivo-28.txt`.
- `hashes-finais.json`: **28/28** sha256 diferentes do estado sem limpeza (`hashes-sem-limpeza.json`), 0 iguais, 0 sem referência.
- `validacao-offline.json` → `inventario.todosForamRerenderizados: true`, `todosSemRastroEntreQuadros: true`, `todosReceberamSombreamentoSuave: true`.
- `auditoria-grade-14x2.json` → `todosForamRerenderizados`, `todosAprovadosOffline`, `todosAprovadosChromium`, `todos1280x720a30`, `todosSemAudio`: **todos true**; `desvioMaximoQuadros: 0`.

---

## 4. Regressão: detecta o defeito antigo e aprova o corrigido

`tests/limpeza-frame.test.mjs`:

1. exige a limpeza de cor **e** profundidade dentro de `renderizarFrame`;
2. decodifica o quadro 40 do MP4 final e exige fundo nos 6 pontos que antes continham rastro (primeira execução, no MP4 antigo, **falhou** com `rastro em (760,560): RGB(139,115,82)`);
3. aplica **os mesmos pontos** ao quadro arquivado `antes-limpeza-elevacao-pernas.png` e exige ≥5 pontos bege — medido **6 de 6** (`logs/final/26`);
4. exige personagem visível (quadro não vazio);
5. exige fundo `#121010`.

Ou seja: o validador **reprova** o arquivo com rastro e **aprova** os 28 corrigidos.

---

## 5. Mosaicos finais (todos gerados nesta rodada, a partir dos MP4 finais)

| Arquivo | Conteúdo |
|---|---|
| `mosaicos/mosaico-01-comparativo.png` | Referências oficiais de cor × estágio verde × bege corrigido |
| `mosaicos/mosaico-02-corrigidos-masculino.png` | Quadro inicial dos 14 vídeos masculinos |
| `mosaicos/mosaico-03-corrigidos-feminino.png` | Quadro inicial dos 14 vídeos femininos |
| `mosaicos/mosaico-04-evolucao-masculino.png` | **Início / meio / fim** dos 14 masculinos |
| `mosaicos/mosaico-05-evolucao-feminino.png` | **Início / meio / fim** dos 14 femininos |
| `mosaicos/mosaico-06-webgl-vs-cpu-masculino.png` | WebGL oficial × MP4, 14 × 3 instantes, masculino |
| `mosaicos/mosaico-07-webgl-vs-cpu-feminino.png` | WebGL oficial × MP4, 14 × 3 instantes, feminino |
| `mosaicos/mosaico-08-detalhe-masculino.png` | **640×360**, 6 casos de menor IoU × 3 instantes, WebGL/MP4 |
| `mosaicos/mosaico-09-detalhe-feminino.png` | **640×360**, 6 casos de menor IoU × 3 instantes, WebGL/MP4 |

Mosaicos 08/09 e as comparações **reaproveitam os buffers 320×180 já decodificados** — uma segunda rodada de decodificação grande estourou o heap do `ffmpeg.wasm` (`RuntimeError: memory access out of bounds`); a correção foi usar nomes fixos no MEMFS, pré-decodificar os 84 quadros antes de abrir o Chromium e não decodificar novamente.

`inspecao-bracos/` guarda os mosaicos ampliados e o `comparacao-webgl.json` da inspeção pontual dos dois pares suspeitos.

**Inspeção visual realizada** em 01, 04, 05, 06, 07, 08, 09 (02/03 são os quadros iniciais já contidos em 04/05): nenhum leque, rastro, painel, zigue-zague, membro preto ou tonalidade verde-azulada; personagens íntegros, bege claro, poses coerentes com o exercício nomeado e movimento entre início/meio/fim. Exceção esperada: `cal-prancha-frontal` é isométrico (movimento 0.18/0.30), com os três instantes praticamente iguais.

---

## 6. Comparação WebGL oficial × rasterizador (relógio determinístico)

A cena oficial `assets/js/forja-3d-cena.js` (`modoApresentacao`) foi carregada **sem alterações** em Chromium headless real, com o mesmo GLB, mesmo clipe, mesmas luzes e mesma câmera. Para eliminar a defasagem do relógio real, `THREE.Clock` e `requestAnimationFrame` são controlados por um **relógio virtual de teste a 30 fps** injetado apenas na página: cada comparação avança exatamente `round(tempo×30)` quadros antes da captura, nos instantes 0 / 50% / 85% da duração. O MP4 é amostrado no mesmo tempo absoluto. Pode restar ~1 quadro de diferença de fase pelo arredondamento de PTS do H.264.

`comparacao-webgl.json`: **28 casos, 84 comparações, IoU médio 0.800 (mín. 0.450, máx. 0.933)**, personagem visível em todos os pares.

### Diferenças medidas (não foi alegada equivalência perfeita)

| Dimensão | O que foi medido |
|---|---|
| **Pose / anatomia** | Mesmo GLB e mesmo clipe. Nos mosaicos ampliados 08/09 e na inspeção pontual, **a mesma pose** nos dois lados; sem membro ausente, duplicado ou deformado. A silhueta não coincide 100% (escala, sombreamento, antialiasing, até 1 quadro de fase). |
| **Material / iluminação** | **Diferença real e sistemática.** WebGL PBR (`HemisphereLight 2.0` + `DirectionalLight 2.4` + contra-luz `0.9`) sai mais escuro/amarronzado; o rasterizador usa o difuso simplificado calibrado pelas referências oficiais e sai bege claro. Média do personagem: masculino WebGL `129/97/57` × MP4 `169/145/102` (distância 76.7); feminino WebGL `185/166/108` × MP4 `204/193/146` (distância 50.6). O bege do MP4 é o das imagens de referência aprovadas no repositório (mosaico 01); o snapshot WebGL headless é o mais escuro. |
| **Enquadramento** | **Diferença real de escala.** Mesmo azimute −58°, elevação 22°, FOV 32°, margem 9%; mas a cena oficial calcula a distância analiticamente com clamp `[2.0, 9]` e posiciona a câmera sem `cos(elevação)` no plano horizontal, enquanto o rasterizador faz busca binária em NDC até `maxNdc = 0.91` e permite distância desde 1.5. Razão MP4/WebGL: **0.92×–1.24×**. Maiores desvios: `cal-ponte` 1.24×, `cal-abdominal-supra` 1.16×, `cal-mountain-climber` 0.93×, `cal-flexao` 0.93×. |
| **Artefatos** | Nenhum leque/rastro/painel/membro preto/tonalização verde-azulada em nenhum dos lados. |

### Casos de menor similaridade (mosaicos 08/09, 640×360)

| Exercício | IoU (I/M/F) masc. | IoU (I/M/F) fem. | Causa identificada |
|---|---|---|---|
| `cal-ponte` | 0.527 / 0.466 / 0.480 | 0.523 / 0.450 / 0.475 | MP4 ~1.24× maior (câmera mais próxima) |
| `cal-abdominal-supra` | 0.587 / 0.564 / 0.587 | 0.581 / 0.551 / 0.576 | MP4 ~1.16× maior |
| `cal-flexao` | 0.708 / 0.708 / 0.779 | 0.672 / 0.673 / 0.752 | MP4 ~0.93× + sombreamento |
| `cal-elevacao-pernas` | 0.687 / 0.696 / 0.722 | 0.672 / 0.684 / 0.709 | MP4 ~0.93× |
| `cal-mountain-climber` | 0.731 / 0.729 / 0.727 | 0.704 / 0.702 / 0.694 | MP4 ~0.93× |
| `cal-prancha-frontal` | 0.721 / 0.722 / 0.721 | 0.888 / 0.888 / 0.887 | escala ~0.98× + limiar de silhueta |

Em todos esses pares, a **pose é a mesma**; o que reduz o IoU é a escala, o sombreamento/antialiasing diferente e eventual fase de 1 quadro. **Não foi encontrada divergência de anatomia nem exercício trocado.**

### Inspeção dos dois pares com suspeita de ângulo de braço

Nos mosaicos 06/07 (células 320×180), os instantes FIM de `mus-mobilidade-ombro` e `mus-flexora` pareciam ter braço/perna em ângulo diferente. Foi feita uma comparação pontual com mosaicos **640×360** (`inspecao-bracos/mosaicos/mosaico-08-detalhe-masculino.png` e `mosaico-09-detalhe-feminino.png`), mesmo relógio virtual: **a suspeita não se confirmou**. Em todos os 6 pares × 2 personagens os ângulos conferem; era perda de membros finos na redução para 320×180. IoU medido: `mus-mobilidade-ombro` 0.860–0.872, `mus-flexora` 0.904–0.915. Conclusão em `inspecao-bracos/conclusao.json`.

### Aceitabilidade

- **Aceitável para aprovação:** ausência de artefatos, integridade dos personagens, correspondência animação↔exercício, poses no instante correto, cores coerentes com as referências oficiais, movimento e enquadramento dentro da margem de 9% (`maxNdc = 0.91` nos 28).
- **Diferenças reais, registradas como limitação conhecida:** cor e escala **não** são idênticas às do WebGL headless. O rasterizador offline não replica o PBR/gerenciamento de cor do three.js nem a fórmula analítica de distância da cena oficial. Alinhar os pipelines exigiria alterar luz/câmera do rasterizador e **re-renderizar os 28 MP4** — fora da correção do buffer de cor autorizada e não feito para não descartar as evidências já validadas. **Não afirmo que os vídeos são pixel-perfect iguais ao WebGL.**

---

## 7. Auditoria da grade 14 × 2

`auditoria-grade-14x2.md` traz a tabela completa (exercício, personagem, MP4, sha256, bytes, resolução, FPS, duração, re-render, aprovação offline/Chromium, IoU nos 3 instantes).

Resumo: `14 exercícios × 2 personagens = 28 células`, **14 linhas completas**, manifesto com `comVideoPronto = 14`, 0 órfãos, `desvioMaximoQuadros = 0`, `iouMedioGeral = 0.800`.

---

## 8. Arquivos modificados / criados

**Modificados (31):** 28 MP4 em `assets/videos/exercicios/`, `assets/3d/apresentacao-exercicios.json`, `package.json` (suítes de teste), `tools/renderizar-videos-3d.mjs` (limpeza de cor + BMP/UV/normais).

**Criados:**
- `tools/lib/{bmp-frame,amostra-uv,normais-vertice,mosaico}.mjs`
- `tests/{bmp-frame,uv-frame,normais-frame,limpeza-frame}.test.mjs`
- `tools/{validar-videos-corrigidos,validar-videos-chromium,comparar-webgl-oficial,auditar-grade-14x2}.mjs`
- `docs/validacao-3d/correcao-videos-28/`: `RELATORIO-FINAL.md`, `hashes-{antes,intermediarios,sem-limpeza,finais}.json`, `validacao-{offline,chromium}.json`, `comparacao-webgl.json`, `auditoria-grade-14x2.{json,md}`, `mosaicos/mosaico-01..09*.png`, `quadros/` (antes/flat/webgl), `inspecao-bracos/`, `logs/01..26`.

Todos os rascunhos `scratch-*.mjs` de diagnóstico foram **removidos**.

---

## 9. Problemas restantes e limitações conhecidas

1. **Cor e escala divergem do WebGL headless** (detalhado na seção 6). São diferenças de pipeline, não artefatos; corrigi-las exigiria re-render autorizado dos 28 MP4.
2. **`npm run test:e2e` 35/36**: falha pré-existente em `Explorar — busca e resultados inline...` (`Catálogo inline ausente`), sem relação com os vídeos.
3. **Chromium headless** atrasa `requestVideoFrameCallback` em clipes curtos; todos os quadros são apresentados (`totalVideoFrames` confere, desvio 0).
4. **`cal-prancha-frontal`** é um clipe isométrico: início/meio/fim praticamente iguais. É o comportamento do clipe oficial, não falha de renderização.
5. **`ffmpeg.wasm`** emite `warning: unsupported syscall: __syscall_getrusage` (não fatal) e exige nomes fixos no MEMFS para não estourar o heap em lotes longos.
6. **PR:** o GitHub não permite dois PRs abertos com o mesmo `head → base` (`arena/4cf65613-forja → main`): `gh pr create` respondeu `a pull request ... already exists: #52`. Como esta sessão está vinculada a uma única branch e não pode criar/empurrar outra, a correção foi preservada como **commit separado `f9a938d`** dentro do PR #52, que segue **OPEN e não mesclado**. Nenhum merge, publicação ou alteração na `main`.

---

## 10. Links

- **PR atualizado:** https://github.com/1Rayke1/forja/pull/52 (3 commits, 100 arquivos, OPEN, base `main`)
- Relatório: `docs/validacao-3d/correcao-videos-28/RELATORIO-FINAL.md`
- Mosaicos: `docs/validacao-3d/correcao-videos-28/mosaicos/`
- Comparação WebGL: `docs/validacao-3d/correcao-videos-28/comparacao-webgl.json`
- Auditoria 14×2: `docs/validacao-3d/correcao-videos-28/auditoria-grade-14x2.md`
