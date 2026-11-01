# Relatório do teste de recebimento (run 41258936700)

Gerado em 2026-11-01 00:56:39Z.

## Ambiente
```
git-lfs/3.8.1 (GitHub; linux amd64; go 1.27.3)
gh version 2.103.2 (2026-10-23)
```

## Modelos gerados
```
grande  : b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c (31457280 B)
pequeno : f7d733562e13e22cd9426ed573f80a11840545150645e7ff5a95608a3b147394 (4096 B)
```

## Ponteiro versionado do arquivo grande
```
```


## Log do Teste 2b (sanitizado)
```
+ importados=0
+ identicos=0
+ nome_em_uso=0
+ invalidos=0
+ validos=0
+ NOVOS=()
+ declare -a NOVOS
+ IFS=
+ read -r -d '' arquivo
++ find /tmp/tmp.s29Fu1vEVw/assets -maxdepth 1 -type f -print0
++ sort -z
+ nome=modelo-grande.glb
+ '[' -f /tmp/tmp.s29Fu1vEVw/assets/modelo-grande.glb ']'
+ ext=glb
+ '[' modelo-grande.glb = glb ']'
+ extensao_permitida glb
+ local e=glb permitida
+ for permitida in $EXT_OK
+ '[' glb = glb ']'
+ return 0
++ tamanho_de /tmp/tmp.s29Fu1vEVw/assets/modelo-grande.glb
++ wc -c
++ tr -d ' '
+ bytes=31457280
+ '[' 31457280 -eq 0 ']'
+ '[' 31457280 -gt 2147483648 ']'
+ validos=1
+ destino=/home/runner/work/forja/forja/FORJA_ASSETS_3D/exemplo/modelo-grande.glb
+ '[' -e /home/runner/work/forja/forja/FORJA_ASSETS_3D/exemplo/modelo-grande.glb ']'
++ hash_de /home/runner/work/forja/forja/FORJA_ASSETS_3D/exemplo/modelo-grande.glb
++ sha256sum /home/runner/work/forja/forja/FORJA_ASSETS_3D/exemplo/modelo-grande.glb
++ awk '{print $1}'
++ hash_de /tmp/tmp.s29Fu1vEVw/assets/modelo-grande.glb
++ sha256sum /tmp/tmp.s29Fu1vEVw/assets/modelo-grande.glb
++ awk '{print $1}'
+ '[' 43ef068ac6b4a2805112f87ce38d48832f35454567c00333666af7f09fb42712 = b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c ']'
+ echo '  IGNORADO modelo-grande.glb: já existe um arquivo com esse nome e conteúdo diferente'
  IGNORADO modelo-grande.glb: já existe um arquivo com esse nome e conteúdo diferente
+ echo '           (renomeie o anexo na release para importar esta versão)'
           (renomeie o anexo na release para importar esta versão)
+ nome_em_uso=1
+ continue
+ IFS=
+ read -r -d '' arquivo
+ '[' 0 -eq 1 ']'
+ rotulo='importado(s)'
+ printf '\nResumo: %d %s, %d já existente(s), %d ignorado(s) por nome, %d inválido(s)\n' 0 'importado(s)' 0 1 0

Resumo: 0 importado(s), 0 já existente(s), 1 ignorado(s) por nome, 0 inválido(s)
+ '[' 1 -eq 0 ']'
+ '[' 0 -eq 1 ']'
+ '[' 0 -eq 0 ']'
+ echo 'Nada novo para commitar.'
Nada novo para commitar.
+ exit 0
+ limpar
+ '[' -n /tmp/tmp.s29Fu1vEVw ']'
+ rm -rf /tmp/tmp.s29Fu1vEVw
+ return 0
status=0
```

## Estado da pasta FORJA_ASSETS_3D no branch da sessão
```
b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c - FORJA_ASSETS_3D/exemplo/modelo-grande.glb
f7d733562e13e22cd9426ed573f80a11840545150645e7ff5a95608a3b147394 - FORJA_ASSETS_3D/exemplo/teste-recebimento.glb
```
