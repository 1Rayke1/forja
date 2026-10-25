# Critérios de validação, testes e preservação de dados

Este documento define **como se prova** que o rebranding não quebrou nada — e
como o trabalho será aprovado. Aplica-se tanto ao que já foi entregue na etapa
1 (conceito, sistema, protótipo) quanto à implementação futura.

---

## 1. Ponto de partida verificado

Medido neste repositório, no commit `17a9157`, com `npm ci` limpo:

| Suíte | Comando | Resultado | Tempo |
| --- | --- | --- | --- |
| Métricas | `npm test` | 18 / 18 | — |
| Núcleo | `npm test` | 92 / 92 | — |
| Atlas | `npm test` | 12 / 12 | — |
| Paridade com a `main` | `npm test` | 40 / 40 | — |
| **Total** | | **162 / 162** | ~90 s |
| **Ponta a ponta** | `npm run test:e2e` | **25 / 25** | ~170 s |

Nenhuma falha, nenhum teste pulado, nenhum *flaky* observado em execuções
repetidas. Esse é o piso: qualquer etapa futura tem de voltar a este placar.

> Comandos reais: `npm ci` → `npm test` → `npm run test:e2e`. O E2E sobe um
> servidor estático próprio e usa Chromium headless; não precisa de rede.

---

## 2. Critério de aceite por entrega

As dez entregas combinadas, com o que precisa ser verdade para cada uma ser
considerada pronta.

| # | Entrega | Arquivo | Critério de aceite |
| --- | --- | --- | --- |
| 1 | Resumo da arquitetura | `00-auditoria.md` | commit-base identificado; 12 páginas, 9 CSS, 17 JS mapeados; comandos de teste verificados na hora, não copiados de relatório antigo |
| 2 | Inventário de telas e componentes | `01-inventario.md` | toda tela e modal existente listado com classes reais; estados transversais (vazio, erro, carregando, foco, desabilitado) cobertos |
| 3 | Conceito da marca | `02-conceito-e-marca.md` | ideia central, o que a marca **não** é, e os 4 lugares onde o grafismo pode aparecer |
| 4 | Alternativas de logo + recomendação | `04-alternativas-logo.md` | ≥ 3 direções comparadas por critério explícito; recomendação justificada; decisão final reservada a você |
| 5 | Sistema visual | `03-sistema-visual.md` | paleta com contraste calculado; tipografia com escala e pesos; espaçamento, raios, elevação, ícones, componentes e estados |
| 6 | Protótipo de alta fidelidade | `05-prototipo.md` + `design/prototipo/` | 5 telas reais navegáveis a partir de HTML, com dados reais do projeto, em 390 e 1280 px, usando as classes do app; cabeçalho com o emblema e a tagline, e resumo pós-treino com o emblema duo |
| 7 | Estratégia de aplicação | `06-estrategia-aplicacao.md` | uma seção por área existente, dizendo o que muda e o que **não** muda |
| 8 | Plano por etapas | `07-plano-por-etapas.md` | etapas pequenas, cada uma com verificação, risco e forma de reverter |
| 9 | Lista prevista de arquivos | `08-arquivos.md` | novos / alterados / intocados, com contagem e justificativa |
| 10 | Validação | este arquivo | comandos, critérios numéricos e prova de preservação de dados |

### O que **não** é critério de aceite

- “Parece bonito.” A avaliação estética é sua; a validação técnica é
  objetiva.
- “Segue a tendência.” Não há critério de moda no projeto.
- “Tem mais elementos de marca.” A marca é discreta por decisão.

---

## 3. Critérios numéricos do sistema visual

Verificáveis com script, não com opinião:

| Critério | Alvo | Como se mede |
| --- | --- | --- |
| Contraste do emblema no cabeçalho (24 px) | ≥ 3 : 1 | brasa sobre carvão = 5,76 : 1 |
| Contraste da tagline (9 px) | ≥ 4,5 : 1 | aço `#a6a29b` sobre carvão = 7,46 : 1 |
| Contraste de texto normal | ≥ 4,5 : 1 | fórmula WCAG 2.1; tabela em `03-sistema-visual.md` §2.3 |
| Contraste de texto grande (≥ 18,66 px negrito ou 24 px) | ≥ 3 : 1 | idem |
| Contraste de elemento não textual (borda de campo, foco, gráfico) | ≥ 3 : 1 | idem |
| Marca pequena (emblema 24 px) | ≥ 3 : 1 | brasa sobre carvão = 5,76 : 1 |
| Alvo de toque | ≥ 44 × 44 px | E2E já mede nos “Alvos de toque principais” |
| Rolagem horizontal | 0 px em 320, 360, 390, 430, 768, 1280 | E2E “Sem rolagem horizontal…” |
| Tamanho mínimo de texto auxiliar | 10 px (caixa alta com tracking) e 11 px (corrido) | leitura do CSS |
| Foco visível | contorno de 2 px, nunca `outline: none` sem substituto | revisão + `:focus-visible` no CSS |
| Respeito a `prefers-reduced-motion` | presente em `performance.css`/`app.css` | teste 24 já exige |
| Orçamento de CSS novo | ≤ 35 KB | `wc -c assets/css/marca.css` |
| Peso de fonte | ≤ 150 KB no total das duas famílias | `du -ch assets/fontes/*.woff2` |

**Armadilha registrada:** brasa `#E4693A` tem 2,73 : 1 sobre claro `#EFE9E2` e
bronze `#C08B4E` tem 2,47 : 1. Os dois **falham** em fundo claro. Por isso a
regra é explícita: em superfície clara, texto e marca usam preto quente,
bronze escuro `#8A5A2B` (4,87 : 1) e vermelho `#B3453F` (4,54 : 1). Quem aplicar
a marca em material impresso claro precisa respeitar isso.

---

## 4. Protocolo de regressão por etapa

Nenhuma etapa é dada por concluída sem os quatro passos abaixo.

1. **Automático**
   ```bash
   npm test            # 162 asserções
   npm run test:e2e    # 25 verificações
   ```
   Precisa dar exatamente o mesmo placar. Asserção ajustada só vale se estiver
   listada em `08-arquivos.md` §6.
2. **Visual em 6 larguras** (320, 360, 390, 430, 768, 1280) nas páginas que a
   etapa tocou. O gerador de capturas roda em `tools/capturas.mjs`; o protótipo
   tem o seu em `design/gerar-capturas.mjs`.
3. **Comparação com o protótipo** da mesma tela, lado a lado. Divergência
   aceita: apenas a que decorre de dado real diferente do dado de exemplo.
4. **`git diff` revisado por arquivo**, com atenção a: `id`, `data-*`, `href`,
   `aria-*`, texto visível e ordem dos `<script>`. Qualquer alteração nesses
   campos é **rejeitada**, não discutida.

---

## 5. Preservação de dados — a prova

Esta é a exigência mais séria do projeto. A prova é feita em quatro frentes.

### 5.1 Nenhuma chave é renomeada

As 13 chaves de `localStorage` em uso hoje continuam exatamente iguais:

```
forja-backup-seguranca-v1        forja-treino-historico-v1
forja-perfil-v1                  forja-treino-metas-v1
forja-preferencias-v1            forja-treino-migracao-v1
forja-treino-biblioteca-v1       forja-treino-rotacao-v1
forja-treino-dados-preservados-v1  forja-treino-rotinas-v1
forja-treino-exercicios-v1       forja-treino-sessao-ativa-v1
                                 forja-treino-sessao-ativa-legada-v1
```

`tests/paridade.test.mjs` (40 asserções) confere a paridade com a `main` — ele
é o cão de guarda. Se alguém “melhorar” um nome de chave no meio do
rebranding, esse teste acusa.

### 5.2 Backup continua compatível nos dois sentidos

- **Exportar antes, exportar depois, comparar:** os dois JSON precisam ser
  idênticos campo a campo (mesmas chaves, mesma forma, mesmos tipos).
- **Importar um backup gerado antes da mudança:** precisa funcionar e
  restaurar tudo. O E2E “Configurações: exportar, rejeitar importação inválida,
  importar com confirmação e desfazer” cobre o fluxo, mas a comparação de
  arquivo é manual e obrigatória na etapa 9.

### 5.3 Nada é gravado sem ação do usuário

O E2E “Perfil: inicializa, checkboxes refletem o armazenado e abrir a página
não grava nada” faz exatamente esta verificação: abre a página, não toca em
nada, e confere que o `localStorage` não mudou. Esse teste precisa continuar
verde em **todas** as etapas — ele é o que impede alguém de “carregar a
preferência de tema no boot”.

Ressalva honesta: existe **uma** escrita no boot hoje — a migração de esquema
em `F.bootData` (`forja-dados.js`), que grava `forja-treino-migracao-v1`
quando há dados em formato antigo. Ela é pré-existente, roda igual, e o plano
não a altera. “Nada é gravado no boot” significa, neste projeto: nada **novo**
é gravado ao abrir.

### 5.4 Migração continua funcionando

`forja-treino-migracao-v1` e `forja-treino-dados-preservados-v1` existem para
não perder dados de versões antigas. A etapa 10 inclui um teste manual:
semear um backup de formato antigo, abrir, e conferir que os dados aparecem.

### 5.5 O arquivo protegido continua byte a byte

```bash
python3 - <<'EOF'
from hashlib import sha256
s=open('assets/js/forja-calendario.js').read().strip()
print(sha256(s.encode()).hexdigest())
# esperado: 30a825330793e156adc357ae714f022c853033c1016ee66ffeaec1ab705928c5
EOF
```

Esse hash é verificado por dois testes independentes (`forja.test.mjs` e
`paridade.test.mjs`). Não há como “esquecer”.

---

## 6. Acessibilidade — o que é testado e o que é revisado

| Item | Situação | Onde |
| --- | --- | --- |
| `skip-link` presente | já existe | 12 páginas |
| `aria-current` na navegação | testado | `forja.test.mjs` (1 por página) |
| `aria-live` no banner de sessão e nos toasts | já existe | markup |
| Foco visível em todos os controles | revisão manual etapa 4 | `:focus-visible` |
| Alvos ≥ 44 px | testado | E2E |
| Contraste | calculado | `03-sistema-visual.md` §2.3 |
| Hierarquia de títulos `h1` único | revisão | 12 páginas |
| Nenhum estado comunicado **só** por cor | revisão | chips e deltas levam texto/sinal |
| `prefers-reduced-motion` | testado | teste 24 |

Regra nova que a identidade impõe: **o fio de brasa e o fio de bronze são
decoração**, nunca a única indicação de estado. Onde houver brasa indicando
“ação”, há também texto.

---

## 7. O que bloqueia a aprovação

Uma etapa é **reprovada** — e volta — se qualquer destes acontecer:

1. Qualquer um dos 162 testes ou das 25 verificações falhar por motivo não
   previsto em `08-arquivos.md` §6.
2. `git diff` mostrar mudança em `id`, `data-*`, `href`, `aria-*` ou ordem de
   `<script>`.
3. Aparência de rolagem horizontal em qualquer largura.
4. Contraste abaixo do alvo em qualquer combinação usada.
5. Export de backup diferente do anterior.
6. Toque em arquivo protegido (hash, atlas, figura).
7. Qualquer `setInterval` novo, qualquer escrita em `localStorage` no boot.
8. Fonte não carregar em `file://` ou offline.

E é **aprovada** quando: placar idêntico, diff limpo, capturas conferidas nas 6
larguras, e nenhum dos oito itens acima.

---

## 8. Validação desta etapa (entrega atual)

O que **já** foi verificado nesta etapa 1:

- [x] `npm test` → 162 / 162 no commit `17a9157`.
- [x] `npm run test:e2e` → 25 / 25, duas vezes (antes e depois do protótipo).
- [x] `git status` mostra apenas `design/` e `docs/rebranding/` como novos;
      nenhum arquivo de `assets/`, `treino/`, `progresso/`, `perfil/`,
      `configuracoes/`, `explorar/` foi modificado.
- [x] Hash de `forja-calendario.js` recalculado e conferido.
- [x] Protótipo renderizado em 390 e 1280 px; **17 capturas** geradas (8 telas
      × 2 larguras, mais a prova do ícone só no desktop); defeitos de quebra de
      linha nos blocos de estatística encontrados **e corrigidos** nessa rodada.
- [x] **Biblioteca e Perfil** prototipados a partir da implementação real
      (`treino/biblioteca.html` e `perfil/index.html`), com as classes que o
      app já usa (`catalog-root`, `ui-chips`, `ui-chip-toggle`, `ui-empty`,
      `backup-panel`, `preferences-panel`).
- [x] Todos os pares de cor da paleta medida com a fórmula WCAG, não por
      impressão.

### 8.1 Verificações da revisão 2 (emblema, tagline e resumo)

| Verificação | Método | Resultado |
| --- | --- | --- |
| Emblema legível a 16 px | render em 12, 16, 20, 24, 32, 48, 64 e 96 px, cada degrau com a versão desenhada para ele | aprovado — o compacto mantém bigorna e chama; nenhum degrau usa a versão errada |
| Cabeçalho a 320 px | medido no protótipo (`inicio.html`, 320 px, dsf 3) | logo com 111 px de largura, cabeçalho de 56 px de altura, tagline oculta, **0 px** de rolagem horizontal |
| Cabeçalho a 768 px | mesma página, 768 px | tagline visível, em uma linha, sem quebra |
| Sem rolagem horizontal | 8 páginas de `design/` × 320, 390, 768 e 1280 px | 0 px em todas (duas correções aplicadas: tabelas da folha de marca e caminhos `<code>` no hub) |
| Tagline nunca comprimida | CSS `white-space: nowrap` + `display: none` abaixo de 720 px | aprovado — ela desaparece em vez de quebrar |
| Emblema no resumo | `execucao.html` a 390 px | 40 px no canto, alinhado ao título; não desloca a grade de métricas |
| Erros de console | 10 páginas, 6 larguras | nenhum |
| Ícone do app em claro | `icone.html`, 512 / 192 / 180 px em tamanho real sobre `#EFE9E2` | aprovado — a placa carvão dá 15,33 : 1 de borda; disco de brasa é detalhe interno |
| Ícone do app em escuro | mesma página, sobre `#121010` | aprovado — disco × carvão 5,76 : 1; placa funde-se ao fundo de propósito |
| Ícone até 16 px | escada 96 → 16 px nos dois fundos | 32 px é o limite do desenho completo; em 16 px lê-se “disco de brasa”, aceitável só em aba/favicon |
| Máscaras de sistema | círculo, squircle e quadrado a 96 px, nos dois fundos | nenhuma morde a bigorna (folga de 3 unidades); no circular sobre claro sobra disco de brasa — documentado como exceção |
| Tabela em 320 px | `icone.html` a 320 px | tabela de 4 colunas reprovada como tabela e convertida em blocos rotulados (`data-th`); 0 px de rolagem |

### 8.2 Pendência que não pode ser fechada nesta etapa

- **Ícone em tela inicial real.** A prova usa os fundos da marca (`#EFE9E2` e
  `#121010`), não capturas de iOS/Android com papel de parede, sombra e
  redução do sistema. Se você quiser essa confirmação, ela exige instalar um
  PWA de teste na etapa 2 — não dá para simular fielmente em página.

O que **não** foi verificado, porque não existe ainda: implementação no app,
comportamento da fonte no app real, e desempenho de render com as fontes
variáveis. Tudo isso está previsto nas etapas 2 e 3.
