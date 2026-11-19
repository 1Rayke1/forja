# FORJA — correções finais do helper E2E, somente locais

**Resultado desta etapa: os quatro achados foram corrigidos e as verificações locais exigidas passaram.** A matriz nova passou **30/30 (15 casos × ScrollEndEvents ON/OFF)**; a matriz anterior continua **10/10**. As suítes completas e **cinco novas rodadas consecutivas de concorrência** foram realmente executadas, sem alterar Auth nem aumentar o limite de **4.000 ms**.

**Isto não certifica o RED→GREEN histórico de Auth:** o runtime de hash `141f2961b3fedc08ab4abdfe320b7ddaaf3b9001c1b7b1e7ce783aeae03cc201` continua **NÃO VERIFICADO**. O GREEN atual de Auth não substitui esse baseline ausente.

Referência da sessão: **2026-11-15**. Branch `arena/468b7e01-forja`; HEAD/base local `99cffc9147d72cc4eedd2eaf47310fc135815c3b`. Este relatório substitui os resultados correntes do relatório anterior; a versão de entrada foi preservada no pacote de evidências como **histórica**, não como execução nova.

## 1. Escopo e isolamento

- Alterações limitadas ao helper de interação, seus testes e estes documentos/evidências. **Nenhuma alteração** em `forja-auth.js`, `forja-login.js`, `forja-auth-data.js`, guards, SDK, configuração, design ou arquitetura externa.
- Suítes executadas em cópia isolada, com HOME/TMP/cache próprios e uma guarda contra escrita no checkout original, comandos mutantes e rede externa dos processos Node. O Chromium usou DNS/proxy limitados a loopback, sem relaxar SOP/CORS.
- Única exceção remota autorizada e utilizada: **169 dependências fixadas no lockfile**, de `registry.npmjs.org`, na cópia isolada, com `npm ci --ignore-scripts --no-audit --no-fund` (exit 0; 6,289 s). A tentativa offline anterior falhou com `ENOTCACHED`; foi registrada, não contornada por download não autorizado. Execuções posteriores usaram npm offline. Nenhum `node_modules` foi criado no checkout original.
- **Sem stage, commit, push, merge, modificação de PR, deploy/retry, workflow, SQL, painel, conta ou credencial real.** Nenhuma consulta nova a GitHub/main/PR, Google, Drive ou Supabase nesta etapa. O último estado remoto relatado não foi reconfirmado.

Ambiente: Node **22.22.3**, npm **10.9.8**, Chromium **138.0.7204.0**, SDK oficial Supabase **2.119.0**. Chromium/SDK são reais; Google/Auth/PostgREST/RLS dos testes são **simulados**.

## 2. Veredito independente dos quatro achados

### A. Destino efetivo: `scroll-margin` e `scroll-padding` — corrigido

A entrada calculava manualmente apenas o destino vertical centralizado. Nas fixtures verticais com margem/padding de 120 px, esperava **495**, mas o navegador parava corretamente em **435**; o helper expirava mesmo com alvo livre e evento nativo entregue. No eixo horizontal, o destino com margem/padding é **830**, não o alinhamento da caixa sem essas propriedades em **710**.

O novo helper delega a escolha ao **CSSOM nativo**: cria uma referência geométrica em iframe fixo, inerte, sem scripts, URLs ou dados do app; reproduz viewport/extensão, caixa, margens/paddings e propriedades relevantes; executa `scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })` **nessa referência**. Não reimplementa a fórmula de center/nearest/clamp e não teletransporta a página real. O pedido real preserva o comportamento de rolagem da página.

`nearest` depende da origem do pedido: o destino não é recalculado a partir de cada pausa intermediária. A prova esperada dos testes é independente: **outra página com o DOM real da fixture**, submetida diretamente ao algoritmo nativo, não a referência do helper. Casos **1–4**, pausas parciais/completas e contrafactual de margem omitida verificam essa distinção.

### B. Geometria e limites dinâmicos — corrigido

O helper reamostra posição/tamanho do alvo, viewport e extensão/limites do documento. Mudança relevante invalida estabilidade/destino; quando necessário, emite novo pedido **nativo** com a geometria atual. Não fica esperando para sempre um destino inicial inalcançável nem aceita uma pausa no destino antigo.

- Caso **5**: o limite vertical cai de **1.190 para 390**; o destino antigo **795** torna-se inalcançável. O resultado final é **390**, com alvo inteiro no viewport, não timeout de sucesso.
- Caso **6**: top do alvo passa de 900 para **1.100**, largura de 100 para **140**, e o documento muda de tamanho durante a animação. O destino muda de **495 para 695**; os testes exigem **pelo menos dois pedidos nativos**.
- Caso **14**: pausa explícita em **495**, alvo já visível/livre, mas novo destino **695**. Não libera nessa pausa, mesmo após entregar o evento intermediário em ON.

Destino atingido não basta: posição real em **X e Y**, caixa e dimensões do documento precisam coincidir em **três amostras rAF / dois intervalos estáveis**. Um pulso de um frame no destino é rejeitado no caso 12.

### C. Visibilidade e identidade do elemento — corrigido/preservado

O helper mantém a identidade do elemento original e exige DOM conectado, elemento habilitado/não inerte, opacidade própria **e dos ancestrais**, display/visibility, caixa não vazia, viewport completo e hit-test no centro. `isTrusted=true` comprova origem do input/evento, **não visibilidade**.

- Caso **7**: ancestral com `opacity:0`, alvo com opacidade própria **1** e hit `BUTTON`: continua bloqueado. Liberar só a opacidade permite terminar a mesma operação e receber clique real.
- Caso **8**: ancestral `visibility:hidden`: bloqueia e recupera ao revelar. **Essa proteção já funcionava na entrada**; não é vendida como defeito novo.
- Caso **9**: ancestral `display:none`: caixa zero e nenhum avanço nativo enquanto oculto; ao revelar, o helper retargeta e conclui. A entrada já bloqueava enquanto oculto, mas **não recuperava** após o primeiro pedido sem efeito.
- Caso **10**: remove o original durante a rolagem e insere um clone com o mesmo seletor. Não aceita o clone como continuação; termina com `TimeoutError` de 4.000 ms e diagnóstico **`detached`**, original desconectado e nenhum clique.
- Caso **11**: obstrução no destino, alvo visível/inteiro e evento já entregue em ON, mas hit **`ASIDE`**: continua bloqueado; remover somente a cobertura libera. **O bloqueio por cobertura já funcionava na entrada.**

Nos bloqueios visuais recuperáveis, pedido, posição, evento entregue e propriedade visual são observados separadamente; falta de evento não mascara a causa visual. Verificações suplementares também cobriram opacidade própria zero, alvo maior que o viewport, disabled e pointer-events.

### D. Movimento horizontal/diagonal e evento nativo — corrigido

A condição sem deslocamento considera **`scrollX` e `scrollY`**. No caso horizontal, Y já estar pronto não autoriza concluir sem o `scrollend` final de X. No diagonal, estar em Y=495 com X=710 não satisfaz o destino **[830, 495]**.

A capacidade real é detectada por `'onscrollend' in document` e afirmada em cada fixture:

- **ON:** listener antes do pedido; aceita apenas evento nativo/trusted do documento/root, posterior ao pedido/último scroll, na posição final correspondente. Destino + estabilidade + visibilidade continuam obrigatórios. A barreira retém o evento final depois de chegar ao destino para provar que ele ainda é necessário.
- **OFF:** nenhum evento é inventado; exige destino nos dois eixos + estabilidade + verificações visuais/identidade.
- Sem movimento realmente necessário, não espera um evento que o navegador não precisa emitir. Isso foi revalidado também em uma página sem rolagem.

O timeout continua literalmente **`4000`** no helper. Não foi adicionado sleep, clique DOM ou evento sintético. Os seis frames das fixtures são oportunidades de renderização **com uma barreira explícita ainda fechada**, não uma duração presumida da animação nem critério de aprovação. Listener, handle e referência são limpos em sucesso, timeout e erro síncrono.

## 3. Matriz nova e causalidade RED→GREEN por caso

**Baseline exato desta etapa:** helper de **3.527 bytes**, SHA-256 `e49c03e4680ab2b5930fc86c2bcba04d8700d87c4bceb184e3da6a52abb712fb`. Não é o helper histórico de 2.264 bytes/e529… do relatório antigo, nem o baseline histórico de Auth.

Os corpos **finais** dos testes são byte a byte idênticos nas quatro cópias: entrada exata, corrigida e dois contrafactuais sintéticos. Hash da matriz: `156c3967997bb25502620a28be9c0425974fe0a06bfec313abce3f7159356e1d`.

Legenda: **R** = teste falhou com o helper de entrada; **G** = já passou na entrada. **Rᴅ** = a entrada bloqueou corretamente, mas não forneceu o diagnóstico causal exigido. Todos os 30 resultados finais foram **GREEN**.

| # | Caso | Entrada ON / OFF | Evidência decisiva no GREEN; RED adicional quando necessário |
|---:|---|---|---|
| 1 | margin vertical | R / R | Controle nativo e posição final **[0,435]**; alvo inteiro/livre, estável, clique trusted |
| 2 | padding vertical | R / R | Mesmo destino **[0,435]**, não a fórmula antiga em 495 |
| 3 | margin horizontal | R / G | Pausa em **[650,0]** com borda parcialmente fora; final **[830,0]**. Em OFF, mutação sintética que omite a margem produz RED |
| 4 | padding horizontal | R / R | Pausa **[710,0]**, alvo já inteiro/livre, ainda bloqueado; final **[830,0]** |
| 5 | redução do máximo | R / R | Mudança durante scroll; máximo/final **390**, não o antigo 795 |
| 6 | mudança de geometria | R / R | Largura **140**, novo destino **695**, novo pedido nativo |
| 7 | opacity do ancestral | R / R | Própria **1**, ancestral **0**, hit BUTTON; bloqueio seguido de recuperação |
| 8 | visibility hidden | G / G | Oculto bloqueia e revelar recupera; mutação sintética dos gates visuais produz RED ON/OFF |
| 9 | display none | R / R | Caixa zero bloqueia; revelar provoca pedido atualizado e recuperação, ausente na entrada |
| 10 | original removido | R / R | Clone não substitui identidade; causa **detached**, timeout original, zero clique e cleanup |
| 11 | obstrução | G / G | Destino/evento presentes, hit ASIDE; remover cobertura recupera. Mutação visual produz RED ON/OFF |
| 12 | horizontal/estabilidade | R / G | Pulso de um frame não conclui; final **[710,0]**, evento final obrigatório em ON. Mutação de estabilidade produz RED em OFF |
| 13 | diagonal | R / R | Pausa **[710,495]** não libera; final **[830,495]** |
| 14 | pausa antes do novo destino | R / R | Pausa visível/livre em **495**, final atualizado **695**, estabilidade final |
| 15 | ausência de progresso | Rᴅ / Rᴅ | Pedido retido, **0** pedidos nativos/movimentos, alvo livre; causa **destination**, [0,0] ≠ [0,245]; depois recuperação |

**Resultados finais dos contrafactuais:** entrada exata **6/30**, exit 1, 63,404 s → helper corrigido **30/30**, exit 0, 42,480 s. Não significa que a entrada violava todos os 24 comportamentos: o caso 15 falha especificamente por ausência de prova diagnóstica, e os seis resultados G são identificados acima.

Os dois helpers deliberadamente defeituosos existem **somente no pacote/cópias isoladas**, nunca no checkout aplicado:

1. Remover gates visuais/estabilidade do helper corrigido: **21/30**, exit 1, 39,074 s. Detecta opacity/visibility/display/cobertura e o pulso instável em OFF.
2. Omitir somente `scroll-margin` na referência nativa: **26/30**, exit 1, 54,878 s. Detecta margin vertical/horizontal nos dois modos, incluindo OFF 3 que já passava na entrada.

São **mutações sintéticas de sensibilidade dos testes**, não baselines históricos, não prova de um defeito que já estivesse corrigido e não um RED→GREEN de Auth. `evidence/counterfactual-per-case.json` e `evidence/red-failure-causes.json` no pacote guardam aprovação/falha, causa e estado por resultado individual.

## 4. Falhas intermediárias — mantidas, não ocultadas

| Rodada da matriz nova | Entrada exata | Candidato GREEN | Observação |
|---|---:|---:|---|
| v1 | 5/30, exit 1, 74,588 s | **27/30, exit 1, 52,206 s** | ON 7/8/11: observador da fixture exigia callback pendente **depois de já tê-lo entregue** |
| v2 | 7/30, exit 1, 63,385 s | 30/30, exit 0, 41,015 s | Corrigida a observação: nos casos visuais exige evento real **e entregue**, não callback ainda retido |
| v3, pausas horizontais reforçadas | 5/30, exit 1, 61,779 s | **28/30, exit 1, 48,346 s** | ON/OFF 3: pausa em 710 já deixava a borda inteira visível; retomar `nearest` dali podia legitimamente não mover |
| Corpos finais congelados | 6/30, exit 1, 63,404 s | **30/30, exit 0, 42,480 s** | Caso 3 pausa em 650 e afirma explicitamente visibilidade apenas parcial; destino nativo 830 continua obrigatório |

A segunda correção foi na **semântica da fixture**, não uma atribuição genérica à infraestrutura: o pedido real estava retido e era executado de uma origem diferente daquela do controle. O checkpoint do novo caso 3 foi revisto para exigir a condição parcial correta; as pausas com alvo **inteiro e livre** dos casos 4/13/14 permanecem. A mutação que omite margem também falha em OFF 3, verificando que não se trocou a prova de margem por mera visibilidade.

**O GREEN v2 não foi usado para aprovar a v3 falha.** O helper permaneceu com o mesmo hash durante essas correções de observação. Também ficou preservada a execução sintética v3 de **19/30**, exit 1, 45,219 s. Logs/metadados de todas as tentativas, inclusive falhas, estão no pacote; os números não são substituídos pelos da rodada final.

## 5. Suítes realmente executadas nesta etapa

| Comando / verificação | Resultado | Exit | Duração |
|---|---|---:|---:|
| `npm test` | **498/498**, 21 grupos | 0 | 459,839 s |
| `npm run test:auth:e2e` | **71/71** = 29 + 19 + 23 | 0 | 166,033 s |
| `npm run test:e2e` | **10/10 anteriores + 30/30 novos + 46/46 gerais** | 0 | 468,121 s |
| Matriz completa, reexecução `node tests/browser-interaction.browser.mjs` | **40/40**, ambos os modos reais | 0 | 59,624 s |
| Fluxo geral adicional com wrapper ScrollEndEvents **OFF** | **46/46**, mesmos bytes dos testes gerais | 0 | 344,468 s |
| Verificações suplementares ON/OFF | **12/12** | 0 | 33,577 s |
| Sintaxe JS/MJS/CJS + AST e preservação | **97/97**, 589 asserts / 46 cenários gerais | 0 | 10,044 s |
| `npm run vendor:supabase -- --check` | SDK **2.119.0**, distribuição/licença/hash corretos | 0 | 0,329 s |
| Observação SOP/CORS/capacidade ON/OFF | bloqueios esperados, flags inseguras **0** | 0 | 1,531 s |
| Probe do mesmo wrapper usado no geral OFF | capacidade real **false**, flag confirmada por CDP | 0 | 0,469 s |
| `git diff --check` e `git diff --cached --check` | sem erros; textos novos também inspecionados | 0 | — |

Não houve falha inesperada nessas suítes finais. Os REDs intencionais e as duas falhas intermediárias da fixture estão discriminados acima. As suítes completas independentes foram executadas em paralelo; durações não são benchmark. O `youtube-search upstream 500` é resposta simulada esperada do teste negativo, não homologação de YouTube real.

A análise AST confirmou **589 chamadas de assert e 46 cenários**, mesmos textos e ordem, nenhum novo skip/only e arquivo geral byte a byte preservado. A matriz original mantém todos os **38 asserts** e seus bytes como prefixo; só foi acrescentado o import da matriz nova ao final. `package.json` e lockfile não mudaram.

### Cinco rodadas novas e consecutivas de `npm run test:auth:concurrency`

| Rodada | Unitários | Chromium | Exit | Duração |
|---:|---:|---:|---:|---:|
| 1 | 18/18 | 23/23 | 0 | 36,028 s |
| 2 | 18/18 | 23/23 | 0 | 36,582 s |
| 3 | 18/18 | 23/23 | 0 | 35,876 s |
| 4 | 18/18 | 23/23 | 0 | 35,763 s |
| 5 | 18/18 | 23/23 | 0 | 34,585 s |

Nenhuma rodada histórica foi reaproveitada. Execução serial confirmada por início/fim monotônicos; mesmos hashes antes/depois de cada rodada e nenhuma edição entre elas. Permaneceram verdes refresh/cleanup sob lock, proteção contra logout antigo, nova sessão do mesmo UID, BroadcastChannel/OAuth, PKCE, persistência/isolamento por UID e limites de storage/revogação 503.

### Segurança observada, sem exagerar a conclusão

ON/OFF foram alterados no **Blink real**, não apenas simulados por propriedade JavaScript. Em ambos: acesso DOM entre duas origens locais resultou em **SecurityError**, e fetch sem CORS em **TypeError**. As matrizes afirmaram **zero erros de console/página**; os erros de console de negação CORS pertencem somente ao probe deliberado de negação, documentado separadamente.

Os observadores registraram **48 lançamentos** do Chromium, flags inseguras **0**, sem comando mutante/escrita no original/requisição externa Node recusada. O wrapper bloqueia saída externa do navegador. Isso não é captura de todos os pacotes de rede, nem certificação de todo o isolamento. O pacote headless usa `--no-sandbox`: **não é certificado de sandbox do SO**.

## 6. Arquivos e hashes desta etapa

**Quatro arquivos existentes na entrada alterados + dois novos; nenhum removido:**

1. `tests/helpers/browser-interaction.mjs` — correções dos quatro achados, diagnóstico causal e cleanup.
2. `tests/browser-interaction.browser.mjs` — somente import da matriz nova, após os testes originais intactos.
3. **Novo** `tests/browser-interaction-regressions.browser.mjs` — 15 casos × ON/OFF, controle nativo independente e barreiras/recuperação/causas.
4. `docs/correcao-helper-scroll-e2e.md` — este relatório atualizado após os resultados reais.
5. `docs/evidencias-helper-scroll-e2e.json` — resultados estruturados e hashes.
6. **Novo** `docs/evidencias-helper-scroll-e2e.zip` — fontes/testes dos contrafactuais, logs brutos, instrumentos e manifests, sem dependências, `.git`, screenshots ou dados reais. Preserva as evidências fora de `/tmp`.

| Código/testes | SHA-256 antes | SHA-256 depois |
|---|---|---|
| Helper | `e49c03e4680ab2b5930fc86c2bcba04d8700d87c4bceb184e3da6a52abb712fb` | `251191203b1462c01d3b6108fa4b6d15b36e86eae162ba99339c75adcda7ef62` |
| Matriz anterior + integração | `396a240fc8420cd381d5bbbf1df81a8f23055574d3b039712917d26a6fc63a85` | `511e0f9161476f90d3cfad0c5894f75188e2b3b902fd45cbe9ed92a3d8d21e96` |
| Matriz nova | ausente | `156c3967997bb25502620a28be9c0425974fe0a06bfec313abce3f7159356e1d` |

**Auth: hashes antes = depois:**

```text
assets/js/forja-auth.js
  ebc0716a7dfaec4266113460ded8764402652b4a048df41710f139f8a1843ef8
assets/js/forja-login.js
  cf5b24dc550f4a97db802ff623a43eb949097d3efa543a0e9938e571362a35f5
assets/js/forja-auth-data.js
  02629a1689e06449175152431d7c4b31f219edf6a809826edc3838d6875226cb
```

Launcher `tests/helpers/browser.mjs` preservado: `7e24e50a79451187f32ce0b50c1ce527ebe3860d7d8feed1839671379b4e9fcb`.
E2E geral preservado: `b893e002f3a5a4922f62985b002959073271fbe9c38ce7f958dc4fd976f6ae4f`.
SDK preservado: `a867edbcfb029370aeec7223dd6180b560b621fbe3bc64c6584fb0369d1b7bce`.

## 7. Integridade e como ler as evidências

Entrada: **811 arquivos**, **43 modificados rastreados + 38 não rastreados**, stage vazio. Final: **813 arquivos**, os mesmos **43 modificados rastreados + 40 não rastreados**. Dos 811 originais, **807 são idênticos**; somente os quatro existentes listados acima mudaram. Todos os demais bytes preexistentes foram preservados.

```text
Fingerprint da entrada (811 arquivos):
4b0d55a32ce66eb3dd7c9339a0263179e542fd3e9232b0896d3b4e436463d2ee
Fingerprint da cópia executada (812 arquivos, antes de atualizar relatórios):
2843b4484db26504934630f2655027eee96908f4432daeee9d5e784c8cde922d
Fingerprint final não autorreferente (810 arquivos; exclui estes 3 artefatos de relatório):
be4c5dfc792bd63ef8d7908e985ddd5703fbc1bc10fe092bbc6fdc56c24457a0
Índice Git antes = depois:
0654e32d671b0886fa25a2a879062fa519e451b18f31c8cff1771e51c00c775a
```

O manifesto usa SHA-256 de um JSON canônico dos pares caminho/hash. Os bytes de código aplicados e de **todos os arquivos não autorreferentes** são os mesmos da cópia executada. HEAD, branch, reflog, índice/entradas staged, diff tracked e cached permaneceram idênticos à entrada. Como os arquivos alterados já eram não rastreados, `git diff` sozinho não mostra este delta; os manifests e a verificação explícita dos arquivos novos o complementam.

O JSON principal contém hashes antes/depois, resultados individuais, baseline exato do helper em base64, classificação dos REDs e catálogo dos runs. O ZIP contém:

- `before/` — entrada exata e relatórios anteriores, marcados históricos;
- `current/` — helper/testes corrigidos, únicos aplicados;
- `red-entry/` e `mutant-*/` — versões **não aplicáveis**, para contrafactuais identificados;
- `logs/` — saída bruta, metadados antes/depois e observadores, inclusive falhas intermediárias;
- `evidence/` — manifests, causalidade por caso, cinco rodadas, integridade final e observações;
- `instruments/` — runners/guardas/probes locais realmente usados;
- `deliverables/` e `MANIFEST.json` — relatório/JSON finais e hashes de cada payload do pacote.

Não há hash de si próprio dentro do ZIP. Hashes finais dos relatórios ficam em seu `MANIFEST.json`; o hash externo do arquivo é calculado após empacotar, evitando alegação autorreferente. Caminhos `/tmp/forja-scroll-fixes-qj3exew1` nos logs são os caminhos realmente executados; o pacote os preserva sem depender de sua permanência. Não executar contrafactuais no checkout original nem fazer novo download sem autorização.

## 8. Limites preservados e conclusão

- **RED→GREEN histórico de Auth 141f2961…: NÃO VERIFICADO.** Não foi baixado/reconstruído/inventado um substituto. O baseline e49c03… usado aqui é somente do helper de scroll.
- Não houve homologação de Google/Supabase/RLS reais. Mobile emulado não é aparelho real nem Safari. Nenhum SQL ou segredo privilegiado foi utilizado.
- **Falha total dos dois storages + revogação 503 não garante logout durável após reload.** Bloqueio em memória não equivale a logout persistido; 503 não confirma revogação. A documentação e os testes dessa limitação foram preservados; não se declara resolvida.
- A validação cobre rolagem do **documento** nas fixtures e fluxos atuais. Não certifica todos os scrollers aninhados, scroll-snap, transformações/layouts possíveis, iframes de aplicação, engines ou condições futuras. O helper falha fechado no prazo original se destino/estabilidade/evento/visibilidade não forem comprovados.
- Achados backend fora do escopo não foram corrigidos/aprovados. O log/causa do deploy falho anterior continua pendente; não houve retry nem atribuição de causa sem prova.

**Conclusão:** correções e regressões locais concluídas, com quatro achados tratados, suítes exigidas verdes e evidências preservadas. Não é autorização para enviar, aprovar ou publicar. **Aguardar autorização; nada foi enviado ao PR.**
