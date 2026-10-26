# FORJA — Onboarding e perfil de treino

Documento da etapa de cadastro inicial e personalização. Descreve o que foi
implementado, por que cada pergunta existe, como o perfil é gravado e o que as
respostas ainda **não** fazem.

- Página do fluxo: `onboarding/index.html` + `assets/js/forja-onboarding.js`
- Estilos: `assets/css/onboarding.css` (carregado só nessa página)
- Convite na Home: `assets/js/forja-inicio.js` (só duas ações, sem formulário)
- Modelo e validação: `assets/js/forja-dados.js` (chave `forja-perfil-v1`)
- Edição e backup: `perfil/index.html` + `assets/js/forja-backup.js`
- Testes: `tests/onboarding.test.mjs` (jsdom) e o bloco de onboarding em
  `tests/e2e.browser.mjs` (navegador real)

## 1. Sequência do fluxo

Nove telas, uma pergunta por tela, com indicador de progresso
("Etapa X de 7" nas perguntas + `role="progressbar"`), Voltar sempre que não
for a primeira tela, e a possibilidade de sair e continuar depois.

| # | Tela | Campo do perfil | Finalidade |
|---|------|-----------------|------------|
| 1 | Boas-vindas | — | Explica o que vem, o que fica no aparelho e que nada é enviado a servidores |
| 2 | Sexo que a pessoa informa | `sexo` | Escolher o personagem das demonstrações (etapa futura). Obrigatório responder — inclusive "Prefiro não informar" |
| 3 | Objetivo principal | `objetivo` | Rotular a intenção do treino; hoje é informativo e serve de contexto na edição do perfil |
| 4 | Experiência | `nivel` | Ponto de partida declarado pela pessoa; o app não prescreve carga |
| 5 | Dias por semana | `diasPorSemana` | Alimenta a sugestão de meta semanal |
| 6 | Duração da sessão | `duracaoMinutos` | Alimenta a sugestão de minutos semanais |
| 7 | Equipamento | `equipamento` | Contexto para o que faz sentido procurar na biblioteca |
| 8 | Modalidade preferida | `modalidadePreferida` | Vira o filtro inicial da lista de rotinas |
| 9 | Revisão | — | Mostra as 7 respostas, permite editar cada uma, oferece (opt-in) criar a meta semanal e conclui |

Regras de experiência:

- **Nada é gravado no armazenamento do FORJA antes da tela 9.** As respostas
  ficam em memória e num rascunho de `sessionStorage`
  (`forja-onboarding-rascunho-v1`), que morre com a aba e nunca entra em backup.
- **Retomada:** sair no meio (link "Sair e continuar depois" ou qualquer link da
  barra inferior) e voltar à página retoma no mesmo passo, com as respostas
  anteriores marcadas e nada gravado.
- **Confirmação:** ao concluir, a pessoa volta para a Home com um aviso
  ("Cadastro concluído…"), o convite desaparece e o perfil passa a ser lido em
  todas as páginas.
- **Dispensa do convite:** "Agora não" grava apenas uma marca de sessão
  (`forja-onboarding-dispensado` em `sessionStorage`). Não cria perfil, não
  entra em backup e volta a aparecer na próxima sessão do navegador.
- **Erro de gravação:** se o navegador recusar a escrita, a tela mostra o
  motivo, **mantém o rascunho** e libera nova tentativa. Nenhuma resposta é
  perdida em silêncio.
- **Acessibilidade:** grupos de rádio nativos (teclado e leitor de tela), título
  da etapa recebendo foco a cada troca, erro anunciado com `role="alert"`,
  alvos de 44 px, foco visível e `prefers-reduced-motion` respeitado.

## 2. O que **não** entrou, e por quê

O PDF de referência tem dezenas de telas (sono, estresse, hábitos alimentares,
eventos, peso/altura com IMC, dias da semana, contagem de flexões e pranchas,
"um profissional indicou", cartões de compromisso). Nada disso foi copiado
porque, no FORJA de hoje:

- **Não há funcionalidade que consuma esses dados.** O app não monta plano
  automático, não calcula IMC e não emite recomendação clínica. Coletar peso,
  altura, sono ou lesões sem uso real seria pedir dado pessoal sem finalidade.
  A seção "Meu corpo" continua como estava ("Medidas em breve").
- **Não há personagens 3D nesta etapa**, por decisão de escopo. O campo `sexo`
  existe para quando eles chegarem.
- **Marca, textos, imagens e elementos do app de referência não foram
  reproduzidos.** A identidade é a do FORJA (fundo escuro, detalhe verde,
  tipografia Archivo/Inter).
- **Nada de gamificação.** Sem níveis, avatares, recompensas ou contadores
  motivacionais.

## 3. Modelo de dados

A chave continua sendo `forja-perfil-v1`. O que mudou é o `version` **dentro**
do valor (não o nome da chave) e três campos aditivos.

```jsonc
{
  "version": 2,
  "updatedAt": "2026-10-26T12:00:00.000Z",
  "objetivo": "hipertrofia",       // "" | forca | hipertrofia | resistencia | calistenia | recuperacao
  "nivel": "iniciante",            // "" | iniciante | intermediario | avancado
  "equipamento": "academia",       // "" | nenhum | casa | academia | ambos
  "diasPorSemana": 4,              // 0..7   (0 = não definido)
  "duracaoMinutos": 45,            // 0..240 (0 = não definido)
  "sexo": "masculino",             // "" | masculino | feminino  (v2)
  "modalidadePreferida": "weights",// "" | calisthenics | weights (v2)
  "onboardingConcluidoEm": "2026-10-26T12:00:00.000Z" // null | ISO (v2)
}
```

### Compatibilidade e migração

- **v1 → v2 é leitura, não escrita.** `normalizeProfile` lê qualquer objeto e
  devolve o formato v2 com os campos novos vazios. O armazenamento **não** é
  reescrito no boot: a promoção acontece na próxima vez que a pessoa salvar
  (ou concluir o onboarding).
- **Perfis antigos contam como configurados.** `F.profileIsConfigured` aceita
  `updatedAt` ou `onboardingConcluidoEm`; portanto quem já tinha perfil não é
  obrigado a refazer o cadastro, e quem tem rotina/histórico nunca vê o convite.
  Para revisar as respostas existe "Refazer o cadastro guiado" em Perfil
  (`onboarding/index.html?refazer=1`).
- **Backup:** mesmo formato (`forja-backup` v1), mesma chave, mesma validação
  de importação. Perfis v1 (sem os campos novos) continuam aceitos; valores
  desconhecidos em `sexo`/`modalidadePreferida`/datas são recusados com
  mensagem clara, como já acontecia com `objetivo`/`nivel`/`equipamento`.
- **Campos desconhecidos são preservados.** Um campo que este módulo não conhece
  é ignorado na leitura e reescrito igual na gravação (`carryUnknownProfileKeys`).
- **Nada de dado duplicado.** Sexo, modalidade, dias e duração vivem só no
  perfil. Metas semanais continuam em `forja-treino-metas-v1`, preferências de
  descanso em `forja-preferencias-v1`. O onboarding não escreve nessas chaves,
  exceto quando a pessoa marca o opt-in da meta na revisão.

### Normalização e valores ausentes

- Valor ausente ou desconhecido vira vazio (`""`/`0`/`null`) — nunca um palpite.
- `diasPorSemana` é limitado a 0–7 e `duracaoMinutos` a 0–240; datas inválidas
  viram `null`.
- Ler nunca grava, nunca arquiva e nunca "corrige" o disco. Perfil ilegível é
  ignorado em memória com aviso, e o conteúdo original continua onde estava.

## 4. Sexo e personagens

- Valores com efeito: `masculino` e `feminino`.
- **"Prefiro não informar" grava `""`.** É uma escolha explícita, não um padrão.
  O app funciona normalmente e **nenhum personagem é exibido**.
- **Nada é inferido** por nome, aparência, objetivo, modalidade ou histórico.
- Contrato para a etapa 3D:

  ```js
  Forja.resolvePersonagem(Forja.state.profile)
  // → { id: "masculino", label: "Personagem masculino" }
  // → { id: "feminino",  label: "Personagem feminino"  }
  // → null  (não informado, valor desconhecido ou perfil ausente)
  ```

  Quem desenhar a demonstração **não deve renderizar nada** quando receber
  `null`. Nenhuma tela atual renderiza personagem.
- O campo **não** altera treino, carga, exercício, histórico ou objetivo.
- Edição posterior: em Perfil (`#prof-sexo`), a qualquer momento.

## 5. Integração com o que já existe

| Resposta | Efeito hoje |
|----------|-------------|
| `diasPorSemana` + `duracaoMinutos` | Botão "Usar meu perfil" em Progresso (metas semanais) preenche treinos/semana e minutos/semana **sem salvar**; o opt-in da revisão do onboarding cria a meta uma única vez, com os números à vista, e nunca sobrescreve metas existentes |
| `modalidadePreferida` | Filtro inicial da lista de rotinas em `treino/` (com aviso de que é preferência do perfil); a pessoa troca o filtro e a escolha dela vale na visita |
| `objetivo`, `nivel`, `equipamento` | **Ainda sem efeito funcional.** O app não monta plano automático, então essas respostas ficam registradas para uso futuro e aparecem na revisão e no formulário do Perfil |

Integrações propostas (não implementadas, para não fingir recomendação):

1. `equipamento` → filtro pré-selecionado na biblioteca de exercícios. Falta
   definir o mapeamento entre as categorias do perfil (`nenhum`, `casa`,
   `academia`, `ambos`) e os valores do catálogo (`peso corporal`, `barra`,
   `halteres`, `máquina`…), que hoje não é 1:1.
2. `nivel` + `objetivo` → sugestão de estrutura de rotina (seções/séries) na
   criação manual, sempre como sugestão editável.
3. `diasPorSemana` → destaque dos dias no calendário, sem criar missões
   automaticamente.

Nenhuma recomendação clínica é gerada: o onboarding não prescreve carga, volume
ou periodização.

## 6. Privacidade

Tudo permanece no `localStorage` do navegador. Não há sincronização em nuvem,
conta, rastreamento ou envio de dados — a página de onboarding diz isso na tela
de boas-vindas e no rodapé. Para levar os dados a outro aparelho, o caminho é o
backup JSON em Perfil.

## 7. Testes

```bash
npm test              # métricas, forja, onboarding, atlas e paridade (jsdom)
npm run test:onboarding
npm run test:e2e      # navegador real (Chromium) — precisa das libs do sistema
```

`tests/onboarding.test.mjs` cobre: primeiro acesso sem perfil; fluxo completo;
voltar/corrigir e edição pela revisão; reabertura sem repetir; perfil v1 sem
`sexo`; valores ausentes/inválidos; edição posterior em Perfil; persistência do
sexo entre páginas; "não informar" sem personagem; exportação/importação/
restauração (inclusive perfil v1 e recusa de valor inválido); preservação de
rotinas e histórico; estrutura de layout/acessibilidade (44 px, 320 px, foco,
movimento reduzido); retomada de rascunho; falha de gravação sem perda de
respostas; metas sugeridas; integração com hub e metas.

O bloco de e2e em navegador real percorre as 9 etapas em 320 px, valida
overflow, alvo de toque, erro sem escolha, ida e volta, conclusão e persistência
do perfil após recarregar.
