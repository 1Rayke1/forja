# Correções de segurança do manifesto e testes — 26/10/2026

PR #30 continua parcial, aberto e em rascunho. **Nenhuma fotografia publicada.**
Esta etapa não conclui o piloto. Referência anterior: `fotografias-piloto-etapa2.md`.

## Inspecionado: identidade e variantes

O catálogo normaliza `notes` como texto; rotinas e sessões preservam cópias.
Instruções, nome e equipamentos também podem descrever variações. Não existe
um identificador estruturado de variante nos dados salvos. `libraryId` prova
origem, não equivalência da execução. Não alteramos essa estrutura.

Política fail-closed, apenas em memória:

- Só origens sugeridas reais e modalidade exata podem selecionar fotografia.
- Qualquer observação na cópia ou origem (inclusive texto neutro) oculta a foto.
  Não usar busca de palavras-chave nem inferência de linguagem natural.
- Nome, instruções e lista ordenada de equipamento devem coincidir exatamente
  com a origem e com `exerciseSignature` do manifesto. Dados ausentes/divergentes
  são rejeitados. Atualização da descrição da origem exige revisão editorial.
- Renomeações cosméticas e reordenações de equipamento podem ocultar a foto:
  falso negativo deliberado, preferível a uma associação indevida.
- Cópias intactas podem reutilizar a origem; personalizados sem origem sugerida
  exata nunca recebem imagem por nome. Ausência/rejeição não bloqueia o exercício.
- A consulta `describeExercise` já completa metadados ausentes por origem exata;
  observações não vazias são preservadas. A assinatura não detecta execução física
  diferente da registrada. Revisão humana continua obrigatória.

## Validação automatizada versus aprovação humana

`validPhoto` verifica objetos, tipos, textos não vazios e sem controles, IDs,
modalidades, status, caminho local, dimensões inteiras (até 640 × 960), URLs HTTPS
absolutas sem credenciais/porta e sem hosts locais/IPs ou sufixos de teste.
Isso é validação sintática: não faz DNS, não verifica reputação nem acessibilidade
da fonte e não afirma que o domínio realmente detém direitos.

`verifiedAt` deve ser data ISO YYYY-MM-DD real, com round-trip UTC, não futura.
`author` é obrigatório: texto não vazio ou `null` explícito quando não disponível.
A ausência de autor conhecido não é uma permissão de uso. Atribuição permanece
obrigatória e deve ser revisada conforme os termos reais.

Referências públicas opacas obrigatórias:

- `reviewedBy`: `reviewer:<identificador>`;
- `evidence`: `evidence:<identificador>`;
- `modelPermission`: `permission:<identificador>` ou `not-required:<identificador>`.

Identificadores usam letras minúsculas ASCII, números e hífens. Devem apontar
para registros controlados fora do Git; não publicar nomes pessoais privados,
assinaturas, contratos, documentos ou autorizações. Um prefixo válido NÃO prova
existência, autenticidade ou suficiência de autorização. `not-required` exige
justificativa humana documentada, nunca inferida pela aplicação.

Aprovação humana individual deve confirmar: arquivo original e integridade,
autoria/cadeia de direitos, licença e versão, atribuição, permissões de alteração,
direitos das pessoas retratadas ou justificativa aplicável, exercício/variante,
alt e revisão técnica. `status: approved` sozinho não autoriza nada. A revisão
deve confirmar que `variant` descreve a execução principal: instruções com
alternativas (como apoiar os joelhos) não aprovam automaticamente todas elas.

O manifesto distribuído permanece vazio e congelado. Fixtures sintéticas de
metadados em testes não são fotografias, fontes nem aprovações reais.

## Orçamento e interface

`node tools/verificar-fotografias.mjs` valida as entradas e mede arquivos locais.
O teste 83 incorpora os limites no `npm test`: até 8 entradas, até 100 KiB por
arquivo, até 800 KiB somados (contagem conservadora por entrada). Arquivo ausente,
vazio, caminho inadequado ou excesso reprova. Os limites não são métricas de
latência nem comprovação de desempenho. Testes de limite usam buffers em memória,
sem criar ou publicar imagens. As dimensões declaradas são validadas; o conteúdo
e dimensões decodificadas reais ainda exigirão conferência com o lote aprovado.

Sem foto, linhas não criam figuras ou espaços reservados. Fallback compacto
orienta usar **Detalhes**; o detalhe orienta consultar as instruções nele mesmo.
Créditos sobrevivem à falha. Não foram alteradas navegação ou marca.

## Estabilização dos testes preexistentes

As cinco falhas de métricas eram reproduzidas na base: o helper construía `Date`
no Node e o módulo executava no jsdom. A API usa `instanceof Date`, então ignorava
a data de outro contexto e usava o relógio real. O helper agora constrói
`dom.window.Date`, na mesma janela das funções sob teste, sem mudar produção ou
semântica de timezone. Não houve troca por strings UTC nem fixação do relógio real.

O teste FORJA 37 usava hoje/ontem como duas sessões da mesma semana. Isso falha
às segundas-feiras. Agora são duas sessões em horários diferentes no mesmo dia;
a terceira continua oito dias antes, para manter a comparação de períodos.
As asserções de metas, persistência, reload e comparação foram preservadas.

## Validação final

Suítes executadas após a última alteração de código e testes:

| Verificação | Resultado | Código de saída |
| --- | --- | --- |
| `npm test` | **179/179**: MÉTRICAS 18/18, FORJA 109/109, ATLAS 12/12, PARIDADE 40/40 | **0** |
| `LD_LIBRARY_PATH=/tmp/al2023/lib npm run test:e2e` | **33/33**, Chromium real, sem erros JS capturados | **0** |
| `git diff --check` | Sem erros | **0** |
| `node tools/verificar-fotografias.mjs` | **0 entradas, 0 bytes**, manifesto vazio | **0** |
| Métricas separadas com `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Pacific/Auckland` | **18/18 em cada fuso** | **0** em cada execução |
| Comparação binária com `a8809f44c3de9d013ab036b5eebd6fe574037252` | **12/12 protegidos idênticos** | Sem divergências |

Os 12 protegidos são calendário, forja-atlas.js, forja-figura.js, atlas.css,
explorar/atlas.html, docs/atlas-anatomico.md e os seis arquivos de assets/anatomia.
Somente este registro de resultados foi completado depois das suítes: nenhum
código ou teste foi alterado após as execuções finais.

O Chromium utilizou bibliotecas extraídas do pacote já existente para
`/tmp/al2023`, sem mudar dependências. A suíte global terminou com saída 0;
não se soma execução parcial para declarar sucesso global. A rodada anterior
de desenvolvimento FORJA também passou 109/109; métricas passou 18/18.

Testado: seleção/rejeição com fixtures, fallback sintético em jsdom e Chromium,
créditos/alt/dimensões, orçamento por buffers, manifesto vazio sem requisições de
fotografias, regressões dos fluxos de criação, edição, execução, histórico e backup.
Inspecionado: contratos de dados, chamadas compartilhadas e política editorial.
Aprovação de direitos e correspondência visual real NÃO foi automatizada.

Testes de seleção incluem observações com joelhos apoiados, unilateralidade, equipamento,
cópias, tipos inválidos, campos ausentes, URLs inadequadas, datas impossíveis,
dia bissexto válido, referências, assinatura divergente e fallback com créditos.

## Pendências e riscos

- Sem imagem real aprovada, não foram validados o download/decodificação real,
  falha HTTP real, rede lenta, bytes transferidos/latência, enquadramento,
  nitidez ou contraste dos créditos sobre conteúdo real em dispositivos físicos.
- Pendente validar imagens reais no catálogo, editor e consulta da execução,
  teclado, leitores de tela, Firefox/Safari e diferentes densidades de tela.
- E2E com evento de erro sintético não substitui falha de rede real.
- Fontes legítimas: produção própria com contrato do fotógrafo e autorização de
  imagem; ou página individual em acervo com cadeia de direitos verificável.
  Manter documentos sensíveis fora do Git e referências públicas no manifesto.
- `npm ci` informou **9 vulnerabilidades high** preexistentes na árvore de
  desenvolvimento. Alertas das dependências de desenvolvimento/Puppeteer exigem
  análise separada. Sem upgrades, novas dependências ou alteração do lockfile.
- Sem mudanças de armazenamento, backup, migrações ou limite do histórico;
  calendário e atlas protegidos devem permanecer byte a byte iguais à base.
- Sem merge, fechamento de PR ou deploy manual nesta etapa.
