# Protótipo de alta fidelidade — o que foi entregue

O protótipo **não é imagem**: é HTML + CSS reais, executáveis, com os mesmos
nomes de classe do aplicativo. Ele existe para você avaliar como a interface
real pode ficar — não um mockup decorativo.

| | |
| --- | --- |
| Ponto de entrada | `design/prototipo/index.html` |
| Estilos | `design/prototipo/prototipo.css` + `design/tokens/forja.css` |
| Marca | `design/marca/index.html` + `design/marca/svg/*.svg` |
| Prova do ícone | `design/marca/icone.html` |
| Capturas | `design/capturas/*.png` (390 px e 1280 px; a prova do ícone só em 1280) |
| Gerador das capturas | `design/gerar-capturas.mjs` |

## Como abrir

```bash
# opção 1 — direto no sistema de arquivos
open design/prototipo/index.html          # macOS
xdg-open design/prototipo/index.html      # Linux

# opção 2 — servido (recomendado para a página de responsivo)
npm run serve
# http://127.0.0.1:8080/design/prototipo/
```

A página `responsivo.html` carrega as telas em `<iframe>`; em `file://` alguns
navegadores bloqueiam. Servindo por HTTP, funciona em todos.

---

## 1. Telas entregues

| Tela | Arquivo | O que cobre |
| --- | --- | --- |
| **Início** | `prototipo/inicio.html` | banner de sessão, saudação, próximo treino, semana, metas, último treino, calendário e missões |
| **Treino em execução** | `prototipo/execucao.html` | cabeçalho com cronômetro, foco do exercício, figura do atlas, pips de série, cronômetro da série, registro de série com correção, descanso isolado, pausa e o resumo pós-treino com o emblema duo de 40 px no canto do bloco de conclusão |
| **Rotinas** | `prototipo/rotinas.html` | hub de modalidade, 3 cartões de rotina (pronta, com dados, sem exercícios), rotação e editor com 4 seções, mais o estado vazio de seção |
| **Biblioteca** | `prototipo/biblioteca.html` | busca, 5 linhas de filtro com contagem (`section`, `measure`, `category`, `muscle`, `equipment`), 4 resultados com ícone de categoria, chip “Seu”, detalhe do exercício em modal com a prancha do atlas preservada, estado vazio |
| **Perfil** | `prototipo/perfil.html` | perfil de treino (5 campos), “Meu corpo” com estado vazio e nota de privacidade, painel de backup, preferências de descanso, armazenamento e privacidade |
| **Progresso e calendário** | `prototipo/progresso.html` | filtro, período, resumo (9 números), metas com anéis, comparação, heatmap de 12 semanas, colunas semanais, linha de evolução, recordes com critério, histórico com busca e status, formulário de metas |
| **Componentes e estados** | `prototipo/componentes.html` | 10 seções do sistema: cor, tipografia, espaço/forma/elevação, 26 ícones, botões e estados, campos, dados e gráficos, vazio/carregando/erro/sucesso/foco/desabilitado, diálogos, grafismos |
| **Responsivo** | `prototipo/responsivo.html` | as 7 telas carregadas de verdade em moldura de celular (320, 360, 390, 430, 768 px) e em janela de desktop (1280 px reduzida para caber), com os pontos de quebra explicados e 6 regras que valem em qualquer largura |

Todas usam **dados de exemplo digitados à mão** a partir dos fluxos reais
(nomes de rotina e exercícios tirados de `forja-biblioteca.js`: “Flexão de
braço”, “Barra fixa (pegada pronada)”, “Agachamento livre”, “Prancha frontal”;
seções reais: aquecimento, treino principal, abdômen, finalizador).

## 2. Por que isso prova o que precisa provar

| Pergunta | Como o protótipo responde |
| --- | --- |
| “A identidade cabe no app?” | O protótipo **não usa classes novas** para as telas: reescreve `.home-action-card`, `.routine-card`, `.history-item`, `.ui-stat`, `.ui-heatmap-cell`, `.bottom-nav`, `.modal-card`… |
| “A marca domina?” | Emblema óptico de 24 px no cabeçalho; no resumo, 40 px no canto, nunca acima das métricas. Em cada tela, o conteúdo ocupa o resto. |
| “Fica legível?” | Todos os contrastes estão medidos em `03-sistema-visual.md` §2.3. |
| “Aguenta 320 px?” | `responsivo.html` mostra 320/360/390/430/768 lado a lado; o protótipo foi capturado nessas larguras. |
| “Parece jogo?” | Nenhum grafismo temático: só 4 elementos (fio de brasa, fio de bronze, hachura e bigorna), todos em estado ou detalhe. |
| “A biblioteca e o perfil continuam reconhecíveis?” | As duas telas foram escritas sobre o HTML real (`catalog-root`, `ui-chips`, `ui-empty`, `backup-panel`): a marca entra no cabeçalho e nos estados, não nos filtros nem nos formulários. |

## 3. O que o protótipo **não** prova

Declarar isso é parte da entrega:

1. **Comportamento.** Nenhum botão executa fluxo real; não há `localStorage`,
   não há cálculo de métrica, não há cronômetro rodando. Isso continua no
   código atual, intocado.
2. **Fidelidade do atlas.** A prancha aparece como imagem de apoio na
   execução; não há destaque de região, porque `atlas.css` é protegida.
3. **Validação com usuários.** Nada foi testado com pessoas.
4. **Identidade aprovada.** O emblema de bigorna e chama é a proposta desta revisão 2 e depende da sua revisão.
5. **Tema claro.** Não existe no app e não foi proposto.
6. **Enquadramento perfeito na moldura de desktop.** A janela de 1280 px é
   reduzida por `transform: scale()` e tem altura fixa: a barra inferior
   aparece na base da janela, como aparece no app, e o conteúdo continua por
   baixo. Não é um artefato — é o comportamento real de uma barra `fixed`
   dentro de uma janela de 960 px de altura.

## 4. Estrutura dos arquivos do design

```
design/
├── tokens/
│   └── forja.css               camada de tokens proposta (fora de assets/)
├── fontes/
│   ├── archivo-variable-latin.woff2
│   ├── inter-variable-latin.woff2
│   ├── OFL-Archivo.txt
│   └── OFL-Inter.txt
├── marca/
│   ├── index.html              laboratório de marca
│   ├── gerar-lockups.py        gera os SVG com o nome contornado
│   └── svg/                    12 vetores de marca
├── prototipo/
│   ├── index.html              hub do protótipo
│   ├── prototipo.css           rascunho do futuro assets/css/marca.css
│   ├── inicio.html
│   ├── execucao.html
│   ├── rotinas.html
│   ├── progresso.html
│   ├── componentes.html
│   └── responsivo.html
├── capturas/                   12 PNGs de revisão
└── gerar-capturas.mjs
```

## 5. Reprodução das capturas

```bash
npm ci
node design/gerar-capturas.mjs
```

Em contêiner mínimo, o Chromium do `@sparticuz/chromium` precisa das
bibliotecas de `al2023.tar.br` no `LD_LIBRARY_PATH` — o script já cai para ele
quando não encontra Chrome no sistema.

## 6. Como revisar

Sugestão de roteiro, na ordem em que as decisões importam:

1. `design/marca/index.html` §2–§5 → **aprovar ou trocar a direção do símbolo**
   (é a decisão que destrava todo o resto).
2. `design/marca/index.html` §6–§8 → versões, mínimos e regras.
3. `design/prototipo/inicio.html` → a primeira impressão do produto.
4. `design/prototipo/execucao.html` → a tela de uso intenso.
5. `design/prototipo/progresso.html` → a densidade de dados.
6. `design/prototipo/componentes.html` → o sistema inteiro, estados inclusos.
7. `design/prototipo/responsivo.html` → comportamento em 320–1280 px.
8. `docs/rebranding/03-sistema-visual.md` §2.3 → contrastes, se quiser checar
   os números.
