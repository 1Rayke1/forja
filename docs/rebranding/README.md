# Rebranding FORJA — etapa 1, revisão 2 (aprovada em direção · aguardando aval final)

> “Assim como uma espada é moldada a cada martelada, um físico é construído
> treino após treino.”

> **Atualização de 25/10/2026 — direção revisada.** Ficam as cores, o fundo e
> o padrão visual atuais do app (acento limão sobre carvão). A proposta de
> tema nórdico e a estética de forja — brasa, bronze, emblema, hachura,
> bigorna e tagline — foram abandonadas. A etapa 4 (componentes e estados)
> foi feita na paleta atual. Andamento, pendências e o que vale daqui em
> diante: [`07-plano-por-etapas.md`](07-plano-por-etapas.md), seção
> “Andamento e mudança de direção”. O restante deste documento descreve a
> proposta original e fica como registro.

Esta pasta reúne o **projeto de identidade visual** da FORJA, etapa 1:
conceito, sistema visual e protótipo de alta fidelidade. **Nenhum arquivo do
aplicativo foi alterado.** O app continua exatamente como está na `main`
(`17a9157`), com os 162 testes e as 25 verificações de navegador passando.

**Revisão 2.** O símbolo passou a ser o **emblema circular de bigorna e
chama**, na direção da referência que você aprovou; a tagline virou
**DISCIPLINA • EVOLUÇÃO • CONSISTÊNCIA**; o emblema entrou, discreto, na
confirmação de treino. A paleta não mudou — nem um tom.

**Status: revisão 2 aprovada em direção, em 24/10/2026.** As cinco decisões
estão registradas abaixo. Nada foi implementado: a etapa 2 só começa com o seu
aval final sobre esta rodada (telas principais, prova do ícone e plano técnico).

---

## O que ler, na ordem

| # | Documento | Entrega | Tempo de leitura |
| --- | --- | --- | --- |
| 0 | [`10-revisao-final.md`](10-revisao-final.md) | **comece por aqui**: o que aprovar agora — telas, prova do ícone, auditoria de Git e plano | 8 min |
| 1 | [`00-auditoria.md`](00-auditoria.md) | resumo da arquitetura, commit-base, testes, o que pode e o que não pode mudar | 12 min |
| 2 | [`01-inventario.md`](01-inventario.md) | todas as telas, componentes, modais e estados que existem hoje | 10 min |
| 3 | [`02-conceito-e-marca.md`](02-conceito-e-marca.md) | conceito, origem do emblema, construção, logotipo, tagline, versões e regras de uso | 12 min |
| 4 | [`04-alternativas-logo.md`](04-alternativas-logo.md) | comparação das três alternativas do emblema, recomendação e o registro das 5 decisões aprovadas | 8 min |
| 5 | [`03-sistema-visual.md`](03-sistema-visual.md) | paleta com contraste medido, tipografia, espaço, ícones, componentes, estados, responsividade | 15 min |
| 6 | [`05-prototipo.md`](05-prototipo.md) | o que o protótipo cobre, como abrir, o que ele **não** prova | 5 min |
| 7 | [`06-estrategia-aplicacao.md`](06-estrategia-aplicacao.md) | o que muda em cada uma das 11 áreas, e o que não muda | 12 min |
| 8 | [`07-plano-por-etapas.md`](07-plano-por-etapas.md) | 10 etapas de implementação, com risco, verificação e reversão | 10 min |
| 9 | [`08-arquivos.md`](08-arquivos.md) | lista exata de arquivos novos, alterados e intocados | 6 min |
| 10 | [`09-validacao.md`](09-validacao.md) | critérios numéricos de aceite, protocolo de regressão e prova de preservação de dados | 10 min |

Se você só tiver cinco minutos: abra `design/prototipo/inicio.html`, depois
`design/marca/icone.html` (a prova do ícone em claro e escuro) e leia
“Decisões já aprovadas” no fim de `04-alternativas-logo.md`.

---

## Ver a marca e o protótipo

```bash
# abrir direto (funciona sem servidor)
xdg-open design/marca/index.html          # macOS: open
xdg-open design/prototipo/index.html

# ou servir (necessário para a página de responsivo)
npm run serve
# http://127.0.0.1:8080/design/marca/
# http://127.0.0.1:8080/design/prototipo/
```

| Página | O que mostra |
| --- | --- |
| `design/marca/index.html` | ideia central, da referência ao desenho, três recortes ópticos, ícone de app, construção em grade 64 × 64, lockups, tagline e regras de uso |
| `design/marca/icone.html` | **prova do ícone**: 512, 192 e 180 px em tamanho real sobre `#EFE9E2` e `#121010`, escada até 16 px, máscaras do sistema e contrastes medidos |
| `design/prototipo/index.html` | hub com as 7 telas de aplicação + componentes, responsivo e as duas páginas de marca |
| `design/prototipo/inicio.html` | a marca aplicada na home |
| `design/prototipo/execucao.html` | treino em andamento (a tela de uso intenso) |
| `design/prototipo/rotinas.html` | rotinas, rotação e editor de seções |
| `design/prototipo/biblioteca.html` | biblioteca: busca, cinco linhas de filtro com contagem, resultados, detalhe do exercício e estado vazio |
| `design/prototipo/progresso.html` | progresso, gráficos e histórico |
| `design/prototipo/perfil.html` | perfil: perfil de treino, “Meu corpo”, backup, preferências de descanso, armazenamento e privacidade |
| `design/prototipo/componentes.html` | o sistema inteiro, com todos os estados |
| `design/prototipo/responsivo.html` | 320–768 px e 1280 px lado a lado |
| `design/capturas/*.png` | 17 capturas de revisão, se preferir ver sem abrir o navegador |

---

## A recomendação, em uma tela

- **Símbolo:** o **emblema de bigorna e chama** dentro de um aro — a bigorna
  não se move (constância), a chama transforma (repetição), o aro contém os
  dois (marca). Uma cor, sem ornamento, em três recortes ópticos: emblema
  (≥ 28 px), óptico (24 px no cabeçalho) e compacto (≤ 20 px).
- **Ícone de app:** o mesmo desenho invertido — **disco vazado**, que sobrevive
  a qualquer máscara de sistema.
- **Grafismos de apoio:** bigorna isolada (só em vazio) e Cunha (só material).
- **Tagline:** DISCIPLINA • EVOLUÇÃO • CONSISTÊNCIA — aparece a partir de
  720 px; no celular, simplesmente não aparece.
- **Paleta:** carvão `#121010`, ferro `#1A1717`, aço `#A6A29B`, osso `#F2EDE7`,
  bronze `#C08B4E` e **brasa `#E4693A` como cor de ação** (5,76 : 1 sobre
  carvão). O limão `#B7F34A` de hoje sai do produto e permanece só no atlas,
  onde é informação funcional.
- **Tipografia:** Archivo (títulos, métricas, botões) + Inter (corpo),
  auto-hospedadas, variáveis, 135 KB no total.
- **A marca não domina:** aparece em quatro lugares — cabeçalho, emblema
  discreto (34–40 px) na confirmação de treino, fio de bronze nos títulos e a
  hachura/bigorna de vazio. Fora deles, a interface é só treino.

---

## Decisões já aprovadas (24/10/2026)

1. **Símbolo A · Emblema** — a bigorna de face trapezoidal com a chama vazada
   dentro do aro circular é a identidade principal. Estudos de alternativa
   encerrados.
2. **Ícone de app em disco vazado** — aprovado **como direção, com condição**:
   provar legibilidade em claro e escuro nos tamanhos previstos. A prova está
   em `design/marca/icone.html`; o ícone sempre leva a placa carvão, porque
   brasa sobre claro dá 2,73 : 1 e bronze dá 2,47 : 1.
3. **Tagline** — “DISCIPLINA • EVOLUÇÃO • CONSISTÊNCIA”, oculta abaixo de
   720 px, com `white-space: nowrap`, nunca comprimida e nunca dentro de
   componentes compactos.
4. **Cabeçalho** — emblema de 24 px + palavra “Forja” de 19 px, validado em
   320 px.
5. **Resumo pós-treino** — emblema duo de **40 px** no canto do bloco de
   conclusão, sem competir com as métricas.

**O que ainda depende de você:** o aval final desta rodada — telas principais,
páginas de biblioteca e perfil, prova do ícone, auditoria de Git e plano
técnico. Só depois disso a etapa 2 (aplicação em `assets/`) começa.

---

## O que está protegido nesta entrega

- `assets/` não foi tocado (nem CSS, nem JS, nem as pranchas do atlas).
- Nenhuma página HTML do app foi alterada.
- Nenhum commit, nenhum deploy, nenhuma publicação.
- Nenhuma dependência nova, nenhum lockfile alterado, nenhum workflow
  alterado.
- Nenhuma chave, formato ou migração de `localStorage` foi tocada.
- `forja-calendario.js` continua com o hash
  `30a825330793e156adc357ae714f022c853033c1016ee66ffeaec1ab705928c5`.

Os únicos arquivos novos são `docs/rebranding/` (esta pasta) e `design/`
(laboratório de marca, protótipo, fontes e capturas). Nenhum dos dois é
carregado pelo aplicativo.
