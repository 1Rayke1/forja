# FORJA — Demonstrações YouTube por exercício

## Arquitetura

- **Catálogo:** `assets/js/forja-exercicios-dados.js` continua sendo a fonte dos
  165 IDs. Nenhuma associação é gravada no arquivo editorial.
- **Backend:** `netlify/functions/youtube-videos.mjs`, exclusivamente no
  domínio `https://prismatic-parfait-be3644.netlify.app`.
- **Persistência:** Netlify Blobs, store `forja-exercise-videos`, com consistência
  forte. Cada entrada fica em `associations/<exerciseId>.json`.
- **Administração:** `admin/exercicios.html`; no GitHub Pages,
  `/forja/admin/exercicios.html`. Não há link na navegação pública.
- **Biblioteca:** `assets/js/forja-youtube.js` consulta somente associações
  aprovadas e acrescenta o player ao detalhe já existente.

A publicação no GitHub Pages não recebe funções, variáveis de ambiente ou
segredos. As chamadas do Pages ao Netlify usam HTTPS e CORS com origens
explícitas. No domínio Netlify, o cliente usa o caminho relativo da Function.

## Configuração externa obrigatória

Cadastrar somente em **Netlify → Site configuration → Environment variables**:

| Variável | Uso |
| --- | --- |
| `YOUTUBE_API_KEY` | Chave privada para YouTube Data API v3 |
| `FORJA_ADMIN_CREDENTIAL` | Credencial administrativa longa e exclusiva |
| `YOUTUBE_DAILY_SEARCH_LIMIT` | Opcional; 1–80 pesquisas/dia, padrão 80 |

Usar uma credencial administrativa gerada por gerenciador de senhas, com alta
entropia. Não colocá-la em HTML, JavaScript, `.env` versionado ou no painel do
catálogo. A chave do Google deve ser restrita à **YouTube Data API v3** no
Google Cloud; a restrição de quota do projeto também deve ser configurada lá.

O store Netlify Blobs usa o contexto seguro do site Netlify em produção. Para
desenvolvimento local, usar `netlify dev` vinculado ao site e as mesmas
variáveis privadas no ambiente local não versionado. Este repositório não traz
credenciais nem uma instância Blobs de desenvolvimento.

## Endpoints

### `GET /.netlify/functions/youtube-videos`

Também disponível como `/api/youtube-videos` no Netlify. Não exige credencial e
retorna somente registros `validated` que passam por todas as verificações de
integridade, além do relatório agregado. Cache HTTP curto; nenhum dado de
revisão pendente é usado pelo player.

### `POST /.netlify/functions/youtube-videos`

Exige `Authorization: Bearer <FORJA_ADMIN_CREDENTIAL>` e corpo JSON pequeno.

| `action` | Operação |
| --- | --- |
| `dashboard` | Ler associações e relatório persistidos |
| `search` | Pesquisar com `search.list` e enriquecer com `videos.list` |
| `save` | Salvar `review`, `validated`, `rejected` ou `unavailable` |
| `refresh` | Verificar novamente e marcar vídeo indisponível |
| `remove` | Remover a entrada do exercício, voltando a `pending` |

`exerciseId` precisa pertencer ao mesmo arquivo editorial usado pelo frontend;
`videoId` precisa ter o formato oficial de 11 caracteres. Título, canal,
duração, visibilidade e incorporação são obtidos novamente do YouTube no
momento da gravação, não aceitos do navegador.

## Proteção administrativa e cota

A credencial digitada fica apenas em uma variável da aba. Ela é removida do
campo, não vai para cookies, `localStorage` ou `sessionStorage`, e é apagada em
`pagehide`. O backend usa comparação de tempo constante e limita cinco falhas
por identidade em 15 minutos. Operações autenticadas não consomem esse limite.

**Limitação:** a limitação de tentativas é por instância da Function e não
substitui WAF/Netlify Identity em uma evolução futura. A cota diária de buscas
é persistida no Blobs. Resultados idênticos ficam em cache por 12 horas. Cada
busca nova usa no máximo oito resultados e uma chamada `videos.list`.

## Validação editorial

A API rejeita automaticamente vídeos:

- com duração inválida, ausente ou superior a 60 segundos;
- privados ou não públicos;
- sem incorporação;
- com metadados insuficientes;
- transmissões/estreias que não sejam um vídeo comum.

A API não comprova enquadramento, conteúdo ou Shorts. Para `validated`, o
administrador precisa confirmar todos estes pontos após assistir à prévia:

1. movimento e variação correspondem ao exercício;
2. equipamento e modalidade são compatíveis;
3. execução está visível e compreensível;
4. vídeo horizontal, sem crop/zoom corretivo;
5. proporção visual 16:9;
6. não é YouTube Shorts nem vídeo vertical.

O backend torna essas confirmações obrigatórias. Salvar `review` não aprova.
Rejeitar é uma decisão manual persistida. Um título semelhante nunca basta.

## Registro persistido

```text
exerciseId, videoId, youtubeUrl, title, channelTitle,
durationSeconds, visibility, embeddable, orientation, aspectRatio,
status, reviewedAt, updatedAt, createdAt, manualReview
```

Estados: `pending` (ausência de registro), `review`, `validated`, `rejected` e
`unavailable`. Uma nova seleção para o mesmo exercício substitui a associação
anterior sem alterar o ID do exercício. Remover não apaga treinos nem mídia do
catálogo.

## Player público

Somente uma associação validada e íntegra cria o iframe:

```text
https://www.youtube-nocookie.com/embed/<videoId>
  ?autoplay=0&mute=1&controls=1&playsinline=1&rel=0
```

O quadro é horizontal 16:9, sem crop ou zoom. Sem vídeo aprovado, em falha de
rede ou no evento de erro do iframe, a ilustração local continua visível. A
mensagem de falha informa que é necessária revisão administrativa. O painel
oferece **Verificar disponibilidade** para consultar o YouTube e persistir
`unavailable`; o visitante nunca recebe permissão de escrita.

## Relatório e estado atual

O painel calcula total, aprovados, pendentes, em análise, rejeitados,
indisponíveis, cobertura real, IDs sem demonstração e inconsistências a partir
do Blobs. Não há dados fictícios no relatório.

**Nesta execução:** nenhuma credencial, API real ou instância externa foi
utilizada. **0 de 165 exercícios têm vídeos realmente aprovados; 165 permanecem
pendentes.** Testes usam respostas simuladas e armazenamento em memória,
inclusive ao recriar o handler para verificar recuperação.

## Comandos

```sh
npm run test:youtube
node tests/youtube-videos.test.mjs
node tests/youtube-frontend.test.mjs
bash tools/preparar-site.sh /tmp/forja-site
```
