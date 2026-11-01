# FORJA_ASSETS_3D

Pasta oficial dos modelos 3D do FORJA. Tudo aqui é versionado com **Git LFS**,
o que permite arquivos de até **2 GB** por modelo (no plano Free do GitHub) em
vez do limite de **25 MB** do envio pelo navegador.

## Formatos acompanhados pelo LFS

`.glb`, `.gltf`, `.fbx`, `.blend` (e as versões em maiúsculas). A regra fica em
[`/.gitattributes`](../.gitattributes) e vale para qualquer subpasta daqui.

## Como enviar (Android, sem programar)

O caminho recomendado é **Releases + importação automática**: você anexa os
modelos a uma release pelo navegador do celular (até 2 GB por arquivo) e o
GitHub Actions move tudo para esta pasta, já em LFS.

Passo a passo completo, limites, verificação e solução de problemas:
**[`docs/assets-3d-git-lfs.md`](../docs/assets-3d-git-lfs.md)**.

## Organização sugerida

```
FORJA_ASSETS_3D/
├── anatomia/           # modelos anatômicos (ex.: braço, tronco)
├── exercicios/         # modelos de exercícios
├── exemplo/            # arquivo de teste do LFS (pode apagar quando quiser)
└── README.md
```

## Se um arquivo entrou fora do LFS

Arquivo pequeno enviado direto pela pasta no navegador é gravado como Git comum.
Para consertar sem terminal: **Actions** → **"Normalizar assets 3D (fora do LFS
→ LFS)"** → **Run workflow**. O arquivo `exemplo/teste-recebimento.glb` (4 KB) é
o resultado do teste do pipeline e pode ser apagado quando quiser.

## Importante

- **Não apague nem mova** arquivos que já estão aqui: o histórico do Git guarda
  o ponteiro de cada versão.
- O GitHub Pages **não entrega** conteúdo de LFS. Estes arquivos ficam no
  repositório para download e uso por ferramentas, não para o app carregar em
  produção (veja a seção “Limites e avisos” da documentação).
- Clone com LFS para baixar o conteúdo real: `git lfs install && git clone ...`
  (sem isso você recebe apenas um arquivo de texto pequeno, o “ponteiro”).
