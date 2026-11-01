# Modelos 3D no FORJA — Git LFS e envio pelo Android

Este documento responde a uma pergunta prática: **como enviar modelos 3D
maiores que 25 MB para a pasta `FORJA_ASSETS_3D/` usando só o navegador do
Android, sem programar.**

Resumo em uma linha: os modelos vão como **anexos de uma release** (até 2 GB por
arquivo) e um workflow do GitHub Actions move tudo para a pasta, já guardado no
**Git LFS**.

---

## 1. Por que o erro de 25 MB acontece

O limite não vem do tipo do arquivo, vem do caminho de envio:

| Caminho | Limite por arquivo |
| --- | --- |
| Upload pelo navegador (arrastar/selecionar em "Add file") | **25 MiB** |
| `git push` normal | aviso acima de 50 MiB, **bloqueio acima de 100 MiB** |
| Git LFS (`git push` com LFS) | **2 GB** (plano Free) |
| Anexo de release (pelo navegador) | **2 GB** (mesmo teto do LFS do plano) |

O ponto que confunde: **configurar LFS não aumenta o limite do upload pelo
navegador**. O GitHub documenta que arquivos enviados pelo navegador não podem
passar de 25 MiB, e o Git LFS não é aplicado nesse caminho — o GitHub grava o
binário como arquivo comum do Git, ignorando o `.gitattributes`.

Fontes:

- "If you add a file to a repository via a browser, the file can be no larger
  than 25 MiB" —
  [About large files on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- Teto de 2 GB por arquivo no Git LFS (Free/Pro) e o aviso "Git LFS cannot be
  used with GitHub Pages sites" —
  [About Git Large File Storage](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)

Esse segundo comportamento foi confirmado neste repositório: um `.glb` de 2 KB
enviado pela API do GitHub **entrou como binário comum**, não como ponteiro do
LFS (ver seção 7).

---

## 2. O que está configurado no repositório

| Arquivo | Papel |
| --- | --- |
| `.gitattributes` | Marca `FORJA_ASSETS_3D/**/*.{glb,gltf,fbx,blend}` como LFS (e as variantes em maiúsculas) |
| `FORJA_ASSETS_3D/README.md` | Explica a pasta para quem chega nela pelo GitHub |
| `.github/workflows/importar-assets-3d.yml` | **Release → pasta**: baixa os anexos e commita em `FORJA_ASSETS_3D/` via LFS |
| `.github/workflows/validar-assets-3d.yml` | Confere a pasta a cada push (formato, ponteiro, tamanho) |
| `.github/workflows/normalizar-assets-3d.yml` | Conserta arquivos que entraram fora do LFS (botão "Run workflow") |
| `.github/workflows/teste-recebimento-lfs.yml` | Teste ponta a ponta do caminho do Android (botão "Run workflow") |
| `tools/importar-assets-3d.sh` | Motor da importação (também roda na máquina local) |
| `tools/validar-assets-3d.sh` | Motor da validação |
| `tools/normalizar-assets-3d.sh` | Motor da normalização |
| `tools/gerar-glb-teste.py` | Gera GLB válido de tamanho controlado para os testes |

Dois detalhes de projeto, para o app não mudar em nada:

1. **O LFS vale só dentro de `FORJA_ASSETS_3D/`.** Os binários do site
   (`assets/`, `docs/`) continuam em Git normal, porque o **GitHub Pages não
   entrega conteúdo de LFS**.
2. **A pasta não entra no artefato publicado.** `tools/preparar-site.sh` monta o
   site só com as páginas e `assets/`; `FORJA_ASSETS_3D/` fica de fora. O
   workflow de deploy não foi alterado, então o app publicado continua idêntico.

---

## 3. Enviar pelo Android sem programar (caminho recomendado)

Isso funciona no Chrome/Firefox do celular. Não precisa de app, token nem
terminal.

1. Abra `github.com/1Rayke1/forja` no navegador do celular e entre na sua conta.
2. Toque no menu **☰** → **Releases** (ou vá direto em
   `github.com/1Rayke1/forja/releases`).
3. Toque em **Draft a new release**.
4. Em **Choose a tag**, digite um nome novo e toque em **Create new tag** —
   por exemplo `modelos-2026-11`.
5. Dê um **Release title** (ex.: `Modelos 3D — novembro`).
6. Em **Attach binaries by dropping them here or selecting them**, toque em
   **selecting them** e escolha os modelos no armazenamento do celular
   (`.glb`, `.gltf`, `.fbx`, `.blend`). Pode anexar vários; **até 2 GB cada**.
   Espere cada arquivo terminar de subir antes de anexar o próximo.
7. Toque em **Publish release**.

O que acontece depois: o workflow **"Importar assets 3D (Release → LFS)"** roda
sozinho, baixa os anexos, confere formato e tamanho, copia para
`FORJA_ASSETS_3D/` e faz o commit com LFS. Leva menos de um minuto para arquivos
pequenos.

> **Importante:** o gatilho de release só dispara a partir do branch padrão.
> Ele passa a funcionar depois que estes arquivos estiverem na `main`. Se você
> criar a release antes disso, rode a importação à mão depois: **Actions** →
> **"Importar assets 3D (Release → LFS)"** → **Run workflow** → informe a tag.

### Regras de segurança da importação

- **Nada é apagado nem sobrescrito.** Se já existe um arquivo com o mesmo nome e
  conteúdo diferente, o anexo é ignorado com aviso — renomeie o arquivo na
  release (ex.: `braco-v2.glb`) e importe de novo.
- Só entram `glb`, `gltf`, `fbx` e `blend` (maiúsculas ou minúsculas). Outros
  anexos são listados como "ignorado" e não quebram a importação.
- A release **não** é apagada pelo workflow: ela fica como cópia extra.
- Use Wi-Fi: são arquivos grandes e o consumo de dados é do seu plano móvel.

### Dicas de Android

- Se a página aparecer na versão mobile sem o campo de anexos, ative **"Site
  para computador"** no menu do Chrome; o formulário de release é o mesmo.
- Se o envio cair no meio, o GitHub mantém o rascunho ("Draft"). Basta reabrir o
  rascunho e reenviar o arquivo que faltou.
- Se o repositório tiver **releases imutáveis** habilitadas, anexe todos os
  arquivos **antes** de publicar (o fluxo acima já faz isso: rascunho → anexos →
  publicar).

---

## 4. Arquivos pequenos (até 25 MB) direto na pasta

O caminho antigo continua existindo: **Add file → Upload files** em
`FORJA_ASSETS_3D/`. Ele funciona para arquivos até 25 MiB, **mas o arquivo entra
como Git comum, fora do LFS** (testado, ver seção 7). Consequências:

- o GitHub Actions **"Validar assets 3D (LFS)"** fica vermelho, avisando que
  aquele binário está no histórico do Git;
- cada versão desse arquivo engorda o `.git` e o clone.

Conserto em um clique (sem terminal): **Actions** → **"Normalizar assets 3D
(fora do LFS → LFS)"** → **Run workflow**. O workflow troca o binário pelo
ponteiro do LFS em um commit novo, **sem reescrever histórico e sem
force-push**, e roda a validação no final.

Se preferir o caminho mais simples e uniforme, use sempre a release (seção 3),
mesmo para arquivos pequenos.

---

## 5. Conferir que o arquivo chegou

1. **Aba Actions**: o run **"Importar assets 3D (Release → LFS)"** verde. O
   resumo do run lista arquivo e tamanho.
2. **Pasta `FORJA_ASSETS_3D/`**: o arquivo aparece com a etiqueta **"Stored with
   Git LFS"**. Abrindo o arquivo, você vê três linhas:

   ```text
   version https://git-lfs.github.com/spec/v1
   oid sha256:...
   size ...
   ```

   Isso é o **ponteiro** — o conteúdo real fica no armazenamento LFS do GitHub.
3. **Workflow "Validar assets 3D (LFS)"**: verde, com contagem de modelos e
   tamanho total.
4. **Na máquina local** (opcional):

   ```sh
   bash tools/validar-assets-3d.sh        # confere ponteiros, formato e tamanho
   git lfs install && git clone https://github.com/1Rayke1/forja.git
   cd forja && git lfs pull               # baixa o conteúdo real dos modelos
   ```

   Sem `git lfs install`/`git lfs pull`, você recebe só o arquivo de texto do
   ponteiro.

5. **Botão de teste ponta a ponta**: **Actions** → **"Teste de recebimento
   (LFS)"** → **Run workflow**. Ele gera um GLB de 30 MB, publica uma release
   temporária, importa pela mesma via do celular, clona o repositório do zero,
   compara o SHA-256 e apaga release e branch temporários no fim.

---

## 6. Limites e cotas que importam

| Item | Valor no plano Free | O que fazer |
| --- | --- | --- |
| Armazenamento LFS | **1 GB** | cada modelo ocupa cota; versões antigas também |
| Banda LFS | **1 GB/mês** | cada clone/`git lfs pull` consome |
| Arquivo único no LFS | 2 GB | acima disso, divida o modelo |
| Anexo de release | 2 GB por arquivo, **sem cota** de armazenamento/banda | alternativa para bibliotecas grandes |
| GitHub Pages | **não entrega LFS** | estes modelos não são servidos pelo app publicado |

Acompanhe o consumo em `github.com/settings/billing` (seção **Git LFS**).

Se a cota de 1 GB ficar pequena, há dois caminhos:

- manter as bibliotecas grandes **só como anexos de release** (download ilimitado,
  sem consumir LFS) e importar para a pasta apenas o que precisa ficar versionado;
- assinar GitHub Pro/data pack para ampliar armazenamento e banda de LFS.

---

## 7. Testes de recebimento já executados

Tudo abaixo rodou no GitHub Actions com `git-lfs 3.8.1` real, em 2026-11-01.

### 7.1 Caminho do Android (release → LFS → clone novo)

Run [`41259392768`](https://github.com/1Rayke1/forja/actions/runs/41259392768) —
todas as etapas verdes:

| Etapa | Resultado |
| --- | --- |
| GLB válido gerado | 31.457.280 bytes (30 MiB — **acima** do limite de 25 MB do navegador) |
| SHA-256 original | `b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c` |
| Release temporária com o anexo | criada |
| Importação para `FORJA_ASSETS_3D/` | ponteiro do LFS |
| Clone do zero + `git lfs pull` | 31.457.280 bytes |
| SHA-256 recebido | `b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c` → **IGUAL** |

O ponteiro versionado foi exatamente:

```text
version https://git-lfs.github.com/spec/v1
oid sha256:b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c
size 31457280
```

O objeto também foi conferido direto na API LFS do GitHub (`git-lfs batch`,
operação `download`): existe no armazenamento e devolve URL de download válida.

### 7.2 Envio pelo navegador (até 25 MB) e normalização

Run [`41259578580`](https://github.com/1Rayke1/forja/actions/runs/41259578580) —
todas as etapas verdes:

| Etapa | Resultado |
| --- | --- |
| `.glb` de 8.192 bytes commitado **sem** LFS (simula "Upload files") | binário no Git (`glTF…`) |
| `tools/normalizar-assets-3d.sh` | trocou por ponteiro do LFS |
| Upload do objeto | `Uploading LFS objects: 100% (1/1), 8.2 KB` |
| Clone do zero + `git lfs pull` | SHA-256 `7a49941e…b5aece29` **igual** ao original |

### 7.3 Validação

Run [`41259578776`](https://github.com/1Rayke1/forja/actions/runs/41259578776) —
verde: `4 modelo(s) validado(s), 0 erro(s)`.

### 7.4 Regressão do app

- `npm test` neste branch: **108/110**, exatamente o mesmo resultado do commit
  base `b38b875` da `main` (as duas falhas — testes 04 e 70 — já existiam e não
  têm relação com estes arquivos).
- `tools/preparar-site.sh` continua montando o site sem `FORJA_ASSETS_3D/`, e
  `static.yml` não foi alterado.

### 7.5 Resíduo dos testes

O objeto de teste de 30 MiB fica na cota de LFS enquanto algum commit o
referenciar. Os arquivos de teste foram removidos do branch; o objeto tende a ser
coletado pelo GitHub quando deixa de ser referenciado. O exemplo pequeno
(`FORJA_ASSETS_3D/exemplo/teste-recebimento.glb`, 4 KB) foi mantido como prova
viva do pipeline — pode ser apagado quando quiser.

---

## 8. Diagnóstico rápido

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| "Yowza, that's a big file" no navegador | upload direto > 25 MiB | use o caminho da release (seção 3) |
| Release publicada, nada na pasta | workflow não rodou (ainda não está na `main`) | faça o merge ou rode "Importar assets 3D" à mão com a tag |
| Importação ignorou o arquivo | mesmo nome com conteúdo diferente | renomeie o anexo e importe de novo |
| "Validar assets 3D" vermelho | arquivo entrou fora do LFS | rode "Normalizar assets 3D" |
| Clone com erro de *smudge*/objeto ausente | o objeto LFS não subiu | rode a normalização; se persistir, reenvie pela release |
| Push recusado por cota | 1 GB de LFS estourado | veja `settings/billing`; remova versões antigas |
| Arquivo maior que 2 GB | teto do LFS do plano | divida o modelo ou use outro armazenamento |

---

## 9. Referência para quem usa terminal

```sh
# preparar o repositório uma vez
git lfs install

# conferir se um caminho está marcado para o LFS
git check-attr filter -- FORJA_ASSETS_3D/meu-modelo.glb

# acompanhar um formato novo (ex.: .usdz)
git lfs track "FORJA_ASSETS_3D/**/*.usdz"
git add .gitattributes && git commit -m "LFS: acompanhar .usdz"

# importar uma release já publicada (também aceita --dry-run)
bash tools/importar-assets-3d.sh modelos-2026-11 --branch main

# importar de uma pasta local (teste)
bash tools/importar-assets-3d.sh teste --origem-local ~/Downloads/modelos --dry-run

# validar e normalizar
bash tools/validar-assets-3d.sh
bash tools/normalizar-assets-3d.sh --dry-run

# copiar arquivos para o LFS fora da pasta (use com cuidado)
git lfs migrate info --everything
```

Clone sem baixar os modelos (útil para trabalhar só no app):

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/1Rayke1/forja.git
```
