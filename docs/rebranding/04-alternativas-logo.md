# Alternativas de logo — revisão 2

Folha de decisão desta rodada. O conceito está em `02-conceito-e-marca.md`; aqui
está o que foi comparado, com que critério, e o que muda dependendo da escolha.

**Nada está aprovado.** A recomendação é uma proposta técnica.

| Onde ver | O que mostra |
| --- | --- |
| `design/marca/index.html` §1–§5 | as três alternativas renderizadas, a origem do desenho, os recortes ópticos e a construção |
| `design/capturas/marca-1280.png` | captura da página inteira, para revisão rápida |
| `design/marca/svg/*.svg` | os 16 vetores, abríveis isoladamente |
| `design/prototipo/inicio.html` | a alternativa A já aplicada no cabeçalho real |
| `design/prototipo/execucao.html` (fim) | a alternativa A no resumo pós-treino |

---

## 1. O que mudou desde a revisão 1

A revisão 1 propunha o **F em três chapas**. Foi descartada por decisão sua, e
substituída pelo emblema circular de **bigorna e chama** — a direção da
referência visual que você aprovou.

O que sobreviveu da revisão 1:

- a exigência de **originalidade** (nada de cópia, nada de ornamento);
- os **testes de tamanho** (16, 22, 32, 48, 96 px);
- a **regra dos quatro lugares** onde o grafismo pode aparecer;
- a **paleta** carvão, ferro, aço, osso, bronze e brasa `#E4693A`, sem
  alteração de um tom;
- a hierarquia de papéis: **uma marca**, um ícone de fachada, grafismos de
  apoio.

O que mudou: o símbolo, a ideia central dele (de “repetição do gesto” para
“a peça não se move, o fogo transforma”), a presença no resumo pós-treino e a
tagline.

---

## 2. O teste que a marca precisava passar

| # | Teste | Critério objetivo |
| --- | --- | --- |
| T1 | **16 px** | a forma ainda é reconhecível como emblema, sem virar mancha |
| T2 | **24 px** | é o tamanho do cabeçalho — precisa ser legível sem zoom |
| T3 | **Silhueta** | desfoque de 6 px: a mancha ainda identifica bigorna e chama |
| T4 | **Convivência** | ao lado de números, gráficos e da prancha do atlas, não rouba a leitura |
| T5 | **Significado** | quem não conhece o app descreve “bigorna e fogo”, não “escudo” ou “selo” |
| T6 | **Sistema** | a mesma geometria (aro, 45°, três massas) reaproveita em ícone, favicon e vazio |

T5 é o teste que separa **emblema** de **adesivo**: uma bigorna com chama é
reconhecível mesmo por quem nunca abriu o app — e a leitura que ela produz
(“oficina, trabalho, calor”) é exatamente a que o produto quer.

---

## 3. As três alternativas

### A — Aro + chama + bigorna, uma cor *(recomendada)*

```
aro    r 28,5 · traço 3
chama  y 9–33 · base 15 · ápice +1,5 à direita
face   x 13–51 · y 33–40   (flancos 45°)
cintura x 26–38 → 23–41 · y 40–46
base   x 15–49 · y 46–52
```

- **Ideia:** o corpo é a peça (bigorna), o treino é o fogo (chama), a
  constância é o que não se move (o aro que contém os dois).
- **Ponto forte:** é a única que se lê como **medalhão** — e a que menos
  compete com dados, porque tem pouca massa escura.
- **Ponto fraco:** abaixo de 28 px o aro fica fino; exige a versão óptica.

### B — Disco vazado

- **Ideia:** a mesma composição em negativo — disco de brasa, bigorna e chama
  em carvão.
- **Ponto forte:** presença máxima em 32 px e imunidade total às máscaras de
  sistema operacional (círculo, squircle, quadrado).
- **Ponto fraco:** em tamanho grande pesa mais que o produto; por isso não é a
  marca, é o ícone.

### C — Compacto sem aro

- **Ideia:** aro removido, miolo 20% maior.
- **Ponto forte:** sobrevive até 12 px; ideal para favicon e chips.
- **Ponto fraco:** sem o aro perde a leitura de emblema — é marca de serviço.

---

## 4. Resultado por teste

| Teste | A · Emblema | B · Disco | C · Compacto |
| --- | --- | --- | --- |
| T1 · 16 px | passa com a versão óptica/compacta | **passa direto** | **passa direto** |
| T2 · 24 px | **passa** (versão óptica desenhada para isso) | passa | passa, mas perde o aro |
| T3 · Silhueta 6 px | **passa** — bigorna sobre base é inconfundível | passa | passa |
| T4 · Convivência | **passa** — pouca massa, não compete | falha em tamanho grande | passa |
| T5 · Significado | **passa** — “bigorna e fogo” | passa | passa, com menos presença |
| T6 · Sistema | **passa** — 45° e três massas reaproveitam | passa | passa |
| **Total** | **6 / 6** | 5 / 6 | 5,5 / 6 |

Nesta rodada, ao contrário da anterior, **a marca passa em T5 sozinha** — e
essa é a razão principal da troca de direção. O F em três chapas precisava do
nome para significar; a bigorna com chama significa antes do nome.

---

## 5. Recomendação

> **Marca: A · Emblema.** Fachada: B · Disco (só ícone de app e favicon).
> Tamanho mínimo: C · Compacto (≤ 20 px).

Não é “escolher três logos”. É um sistema com donos claros:

| Papel | Peça | Onde | Frequência |
| --- | --- | --- | --- |
| Marca | Emblema + palavra | cabeçalho de todas as páginas | sempre |
| Momento | Emblema duo (bronze + brasa) | confirmação de treino | ao concluir |
| Fachada | Disco vazado | ícone de app, atalho, loja | fora do app |
| Mínimo | Compacto | favicon, chips | raro |
| Apoio | Bigorna isolada | estado vazio, onboarding | raro |
| Secundário | Cunha | marca d'água, material | ocasional |

Regra que impede proliferação: **fora dessas seis funções não existe símbolo
novo**. Nenhuma tela ganha emblema próprio.

### Por que não usar o disco em tudo

Porque em material impresso e em tela grande o disco pesa mais que o conteúdo,
e porque o disco depende de duas cores: em uma cor só (carimbo, gravação,
fax) ele não existe. O emblema com aro funciona em uma cor.

### Por que a Cunha não é o ícone de app

Porque o ícone precisa dizer “forja”, e o F em bloco diz apenas “F”. A Cunha
continua no sistema como elemento secundário — marca d'água, separador,
gravação — mas não representa o produto.

---

## 6. Estudos descartados (e qual teste matou cada um)

| Estudo | Como morreu |
| --- | --- |
| Chama em gota simétrica | T5: lê como vela ou folha; sem assimetria não é fogo |
| Chama facetada (triângulos) | T1: em 24 px virava pinheiro |
| Bigorna com chifre longo | T3: a assimetria puxava a leitura para “martelo” |
| Bigorna de face retangular com pernas | T5: virava mesa ou bancada; perdia a cintura |
| Aro duplo / aro com nós | T4: ornamento competia com o conteúdo |
| Runas, trançados, escudo, chifres | descartados na direção criativa |
| F em três chapas (revisão 1) | T5: precisava do nome para significar |

O padrão: **o ornamento morre, a estrutura fica**.

---

## 7. Se você escolher outra alternativa

| Escolha | O que muda | Esforço |
| --- | --- | --- |
| **A** (recomendada) | nada — é o que está desenhado | 0 |
| **B** como marca principal | inverter os 16 vetores e os lockups; o emblema com aro vira secundário; perde-se a versão de uma cor | ~2 h |
| **C** como marca principal | remover o aro de todos os vetores; perder presença em material grande | ~1 h |
| **Nenhuma** | volto ao estágio de estudos com os 6 testes como régua | ~1 dia |

Trocar de alternativa **não** invalida paleta, tipografia, sistema visual nem
protótipo: o símbolo é substituível por um `<svg>` de mesmo `viewBox` 64 × 64.

---

## 8. Decisões tomadas (24/10/2026)

| # | Pergunta | Resposta | Onde virou regra |
| --- | --- | --- | --- |
| 1 | Alternativa do símbolo | **A · Emblema** — aro + chama + bigorna de face trapezoidal | `02-conceito-e-marca.md` §2–§5; vetores em `design/marca/svg/` |
| 2 | Ícone de app em disco vazado | **Aprovado como direção, com condição**: provar legibilidade em claro e escuro nos tamanhos previstos | `design/marca/icone.html` (prova) · README §Decisões |
| 3 | Cabeçalho: 24 px + palavra de 19 px, tagline ≥ 720 px | **Aprovado** como corte | `03-sistema-visual.md` §3.4 · `05-prototipo.md` |
| 4 | Tagline “DISCIPLINA • EVOLUÇÃO • CONSISTÊNCIA” | **Aprovada**, sem compressão e nunca dentro de componente compacto | `03-sistema-visual.md` §3.5 |
| 5 | Resumo pós-treino com emblema duo | **Aprovado em 40 px** no canto do bloco de conclusão | `execucao.html` (bloco “Resumo pós-treino”) |

Consequências registradas:

- **Fim dos estudos de alternativa.** B e C deixam de ser candidatas a marca
  principal: o disco vazado fica restrito ao ícone de app e a versão compacta
  ao favicon e a usos ≤ 20 px.
- **A condição do ícone foi cumprida** e virou regra de uso: o ícone sempre
  leva a placa carvão; sobre claro a placa é a silhueta (15,33 : 1) e o disco
  de brasa é detalhe interno. Disco solto sobre claro e bronze sobre claro
  continuam reprovados (2,73 : 1 e 2,47 : 1).
- **Nenhuma decisão mexe em lógica.** Trocar o símbolo, a tagline ou o
  tamanho do emblema de resumo são alterações de HTML/CSS.

### O que ainda falta

O aval final da etapa 1: telas principais, biblioteca, perfil, prova do ícone,
auditoria de Git e plano técnico. **Enquanto ele não vier, nenhum arquivo do
aplicativo é alterado.**
