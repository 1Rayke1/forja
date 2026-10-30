# Origem, atribuição e situação de licença — recursos anatômicos

## 1. O que é exibido hoje

| Item | Valor |
| --- | --- |
| Arquivo exibido | `fontes/referencia-muscular.png` |
| Origem | Imagem anexada pelo usuário na conversa de revisão (30/10/2026) |
| Dimensões | 1536 × 1024 px |
| Formato | PNG RGB (sem canal alfa), fundo preto opaco `#000000` |
| Conteúdo | duas vistas do mesmo corpo: anterior à esquerda, posterior à direita |
| SHA-256 | `da1e8be99d0e0046d441debcee77e905cff7224e7aaf7fd8849ce6ba11c1988e` |
| Bytes | 1.691.723 |

O arquivo é exibido **byte a byte**, sem recorte, sem recoloração, sem remoção
de fundo e sem redesenho. O corpo mostrado no Atlas, na biblioteca e na
execução do treino é exatamente essa imagem. As duas vistas são janelas do
mesmo arquivo (ver `manifest.json` e `docs/modelo-anatomico.md`).

## 2. Licença: pendência real, sem presunção

**Situação da licença de redistribuição: não verificada.**

A inspeção do arquivo não encontrou autoria, URL de origem, licença ou
autorização de redistribuição. O fato de o usuário ter enviado o anexo não
comprova, por si só, o direito de publicar. Por isso:

- nenhuma licença Creative Commons é atribuída a esta imagem;
- a antiga declaração CC BY-SA 4.0 que existia em revisões anteriores foi
  removida e continua removida — ela nunca foi comprovada para estes arquivos;
- nenhum projeto de terceiros (BodyParts3D, Z-Anatomy, Open Muscle Map) é
  apresentado como origem desta prancha.

Antes de merge em `main`, release ou outra publicação, o responsável precisa:

1. informar a origem e o titular da imagem;
2. confirmar a licença ou a autorização de uso e redistribuição;
3. acrescentar aqui a atribuição exigida, se houver;
4. autorizar explicitamente a publicação.

Esta branch é trabalho de revisão. Não houve merge nem deploy.

## 3. O que é derivado da prancha

Dois arquivos, ambos calculados por máquina a partir da própria prancha, sem
traço manual:

| Arquivo | Papel | Cálculo |
| --- | --- | --- |
| `mascara.png` | silhueta do corpo | limiar de luminância (`> 12`), fechamento morfológico de raio 8, margem de 2 px |
| `tinta.png` | áreas escuras dentro do corpo | silhueta **e** luminância `< 220` |

`mascara.png` prende o contorno dos destaques ao corpo. `tinta.png` prende a
**cor** às fissuras e aos ventres escuros do desenho, para as linhas brancas
continuarem visíveis. Nenhum dos dois desenha anatomia: se a prancha mudar,
eles mudam junto. Os dois arquivos são regerados por
`node tools/gerar-anatomia-referencia.mjs`.

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

## 5. Seleção de sexo e a versão feminina

O FORJA já tinha o campo `sexo` no perfil e ele **continua com o mesmo papel**:
escolhe o personagem das demonstrações (`resolvePersonagem`). Ele nunca
selecionou a prancha anatômica, e esta revisão não mudou isso.

A imagem fornecida tem um único corpo e não existe versão feminina deste
desenho. **Nada foi inventado**: não há prancha feminina em estilo de linha,
nem mistura de dois desenhos diferentes na mesma vista. O que existe:

- `fontes/modelo-feminino-original.webp` (644 × 644, preservada sem alteração)
  é a referência feminina da revisão anterior, em outro estilo visual;
- ela permanece no repositório como base documentada, **desligada** da figura
  atual, para uma integração futura quando houver uma prancha feminina no mesmo
  desenho.

Limitação registrada para quem for revisar: enquanto não existir a prancha
feminina equivalente, a anatomia exibida é a da imagem fornecida para todos os
perfis.

## 6. Histórico

- `fontes/modelo-masculino-original.jpg` (740 × 740) é a referência da revisão
  anterior, sobre fundo branco. Ela não é mais exibida nem referenciada pelo
  app; fica no histórico do repositório apenas como procedência.
- As pranchas `anterior.png` e `posterior.png` geradas dela foram removidas,
  para não manter duas anatomias concorrentes no diretório.
- `tools/gerar-anatomia-3d.mjs` é pipeline experimental anterior, não participa
  da renderização atual e não é executado por nenhum teste.
