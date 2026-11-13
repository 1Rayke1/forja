# Origem, atribuição e situação de licença — recursos anatômicos

## 1. O que é exibido hoje

| Item | Valor |
| --- | --- |
| Arquivo exibido | `fontes/forja-modelo-anatomico.png` |
| Origem | Imagem anexada pelo usuário na conversa de revisão (11/11/2026) |
| Natureza | **conteúdo gerado por IA** — declarado pelo manifesto C2PA (ver §2.1) |
| Dimensões | 1536 × 1024 px |
| Formato | PNG RGBA (fundo transparente; o preto do tema é pintado pela página) |
| Conteúdo | duas vistas do mesmo modelo: anterior à esquerda, posterior à direita |
| SHA-256 | `2e1c9a0adb25b70106e6dd23744f30d7ec98ade325b101a109a0622014765cbf` |
| Bytes | 1.631.083 |

O arquivo é exibido **byte a byte**, sem recorte em arquivo separado, sem
recoloração e sem redesenho. O corpo mostrado no Atlas, na biblioteca, na
execução do treino e no Progresso é exatamente essa imagem. As duas vistas são
janelas do mesmo arquivo (ver `manifest.json` e `docs/modelo-anatomico.md`).

A imagem traz o modelo com short preto e o símbolo verde do FORJA; a paleta
predominante é cinza, com contorno verde discreto. É a referência visual
oficial: nenhum outro personagem é desenhado ou usado no lugar dela.

## 2. Procedência: verificada. Licença: ainda pendente

Esta seção separa duas perguntas diferentes, que antes estavam juntas:

- **De onde a imagem vem e como foi feita** → agora há evidência verificável;
- **Podemos publicá-la** → continua sem resposta, e isso é uma pendência real.

### 2.1 O que a própria imagem declara (verificado)

O PNG carrega um manifesto **C2PA** assinado. Ele foi lido com a biblioteca
oficial do padrão, não com inspeção de texto:

```bash
pip install c2pa-python
python3 tools/verificar-procedencia.py
```

Resultado desta prancha (`fontes/forja-modelo-anatomico.png`):

| Campo | Valor verificado |
| --- | --- |
| Estado da validação | `Valid` |
| Signatário | `OpenAI OpCo, LLC` / `OpenAI Media Service` (Ps256) |
| Gerador declarado | `OpenAI Media Service API` |
| Ação registrada | `c2pa.created` por `ChatGPT` versão `gpt-image` |
| Tipo de origem (IPTC) | `trainedAlgorithmicMedia` — **mídia gerada por IA** |
| Data declarada | 2026-11-10T14:47:18Z |
| Integridade | `assertion.dataHash.match` — os bytes exibidos são os assinados |

Consequências diretas, sem rodeio:

- a prancha é **conteúdo gerado por IA** (imagem sintética). Tutoriais e
  documentação do app não devem apresentá-la como fotografia, modelo real ou
  trabalho de um ilustrador humano;
- o arquivo **não foi alterado** desde a geração — o hash do manifesto bate com
  os bytes que o app exibe. As máscaras e a figura são derivadas dele em tempo
  de build, não por edição manual da imagem;
- o aviso `signingCredential.untrusted` significa apenas que o certificado do
  signatário não está na lista de confiança **desta máquina**. Ele não indica
  adulteração: as verificações de hash e de assinatura passaram.

A prancha anterior (`fontes/referencia-muscular.png`, linhas brancas) carrega
manifesto do mesmo tipo, gerado em 2026-10-30. Ou seja: a origem por IA não é
uma mudança introduzida nesta revisão — o que muda aqui é passar a **registrar**
essa origem em vez de deixá-la como "não verificada".

### 2.2 O que NÃO está resolvido: licença de redistribuição

**A imagem não traz licença, termo de uso ou autorização de redistribuição.**

Metadados de procedência dizem *como* um arquivo foi produzido; não dizem *o que
se pode fazer* com ele. Não há, nesta prancha, nenhuma declaração de licença
Creative Commons, domínio público ou cessão de direitos. Portanto:

- nenhuma licença é atribuída a esta imagem — nem CC BY-SA, nem outra;
- a antiga declaração CC BY-SA 4.0 de revisões anteriores continua removida;
- nenhum projeto de terceiros (BodyParts3D, Z-Anatomy, Open Muscle Map) é
  apresentado como origem desta prancha;
- a procedência por IA está documentada, mas **ela não concede** permissão de
  uso comercial nem de redistribuição.

Antes de merge em `main`, release ou qualquer publicação, o responsável precisa:

1. confirmar sob quais termos a imagem pode ser usada e redistribuída (política
   do provedor do gerador + decisão de quem publica);
2. registrar aqui a decisão, com a atribuição que ela exigir;
3. declarar se o conteúdo gerado por IA será identificado ao usuário final;
4. autorizar explicitamente a publicação.

Enquanto isso não acontecer, a situação registrada é: **procedência conhecida,
licença não verificada**. Esta branch é trabalho de revisão; não houve merge nem
deploy.

## 3. O que é derivado da prancha

Dois arquivos, ambos calculados por máquina a partir da própria prancha, sem
traço manual:

| Arquivo | Papel | Cálculo |
| --- | --- | --- |
| `mascara.png` | silhueta do corpo | alfa `> 140` (o corpo tem alfa ≈ 250; o halo do fundo fica abaixo de 90), fechamento morfológico de raio 6, margem de 2 px |
| `tinta.png` | sombra dentro do corpo | silhueta **e** luminância `< 176`, com alfa proporcional à escuridão (4 degraus) |

`mascara.png` prende o contorno dos destaques ao corpo. `tinta.png` dosa a
**cor** pela sombra do desenho: forte nas fissuras e inserções, fraca no
meio-tom, transparente nos realces claros. É isso que impede o corpo inteiro de
ficar chapado de verde — o realce acompanha o músculo. Nenhum dos dois desenha
anatomia: se a prancha mudar, eles mudam junto. Os dois arquivos são regerados
por `node tools/gerar-anatomia-referencia.mjs`.

## 4. Destaques funcionais

Os caminhos de `assets/js/forja-figura.js` não criam o corpo. Eles apenas
indicam as regiões musculares do catálogo sobre a prancha:

- principal: verde-lima `#b7f34a`;
- secundária: âmbar `#f2b84b`;
- estabilizadora: azul `#8cc0e0`;
- informada por você: cinza `#b2bab1`;
- grupo em foco: lima tracejado.

Os contornos são **projeções funcionais aproximadas** de estruturas
superficiais que o desenho permite distinguir. Não são segmentação clínica nem
afirmam mapear limites de músculos profundos. "Quadril" e "Lombar" indicam
projeção de região, não reconstrução de iliopsoas ou de cada estabilizador
profundo. A tabela de regiões e essas limitações estão em
`docs/modelo-anatomico.md`.

O short cobre a pelve nas duas vistas: a região "Glúteos" indica o glúteo sob a
peça, e a legenda diz isso — nenhum contorno de músculo é inventado por baixo do
tecido. O destaque sobre o tecido usa um teto de alfa baixo (`tinta.png`): fica
um véu translúcido, não uma mancha verde de músculo e não a peça apagada.

## 5. Seleção de sexo e a versão feminina

O FORJA já tinha o campo `sexo` no perfil e ele **nunca** selecionou a prancha
anatômica. O campo continua existindo como informação declarada do perfil, mas
não escolhe mais nada: o app não tem personagem de demonstração.

A imagem fornecida tem um único corpo e não existe versão feminina deste
desenho. **Nada foi inventado**: não há prancha feminina no mesmo estilo. O que
existe:

- `fontes/modelo-feminino-original.webp` (644 × 644, preservada sem alteração)
  é a referência feminina de uma revisão anterior, em outro estilo visual;
- `fontes/modelo-masculino-original.jpg` (740 × 740) é a referência masculina
  daquela mesma revisão, sobre fundo branco;
- `fontes/referencia-muscular.png` (1536 × 1024) é a prancha de linhas brancas
  sobre fundo preto substituída por esta.

As três ficam no repositório **apenas como procedência histórica**, desligadas
da figura atual. Nenhuma tela as exibe.

Limitação registrada para quem for revisar: enquanto não existir a prancha
feminina equivalente, a anatomia exibida é a da imagem fornecida para todos os
perfis.

## 6. Histórico

- A prancha de linhas brancas (`fontes/referencia-muscular.png`, fundo preto) e
  as máscaras derivadas dela foram substituídas nesta revisão pela imagem
  oficial em escala de cinza com short preto (`fontes/forja-modelo-anatomico.png`).
- `fontes/modelo-masculino-original.jpg` (740 × 740) é a referência da revisão
  anterior, sobre fundo branco. Ela não é mais exibida nem referenciada pelo
  app; fica no histórico do repositório apenas como procedência.
- As pranchas `anterior.png` e `posterior.png` de revisões antigas foram
  removidas, para não manter duas anatomias concorrentes no diretório.
- O pipeline experimental anterior de pranchas (`tools/gerar-anatomia-3d.mjs`)
  foi removido do repositório junto com os demais utilitários 3D. A prancha
  exibida pelo app é a imagem fornecida pelo usuário, mantida byte a byte.
