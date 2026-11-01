# Relatório do teste de recebimento (run 41259392768)

Gerado em 2026-11-01 01:03:18Z.

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
version https://git-lfs.github.com/spec/v1
oid sha256:b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c
size 31457280
```

## Teste 2c — recebimento do arquivo grande

- ponteiro LFS: OK
- sha256 recebido: b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c
- sha256 original: b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c
- bytes: 31457280
- conferência: IGUAL

```
b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c * FORJA_ASSETS_3D/exemplo/modelo-grande-41259251448.glb
b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c * FORJA_ASSETS_3D/exemplo/modelo-grande-41259392768.glb
b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c * FORJA_ASSETS_3D/exemplo/modelo-grande.glb
f7d733562e13e22cd9426ed573f80a11840545150645e7ff5a95608a3b147394 * FORJA_ASSETS_3D/exemplo/teste-recebimento.glb
```

## Saída do validador de assets 3D
```
Validando FORJA_ASSETS_3D/ (Git LFS)…

Resumo: 3 modelo(s) validado(s), 0 erro(s), 0 aviso(s)
  .glb    3
Tamanho total no LFS: 60.00 MB
Validação concluída sem erros.
validar_status=Validação concluída sem erros.
```

## Log do Teste 2b (sanitizado)
```
+ importados=1
+ IFS=
+ read -r -d '' arquivo
+ '[' 0 -eq 1 ']'
+ rotulo='importado(s)'
+ printf '\nResumo: %d %s, %d já existente(s), %d ignorado(s) por nome, %d inválido(s)\n' 1 'importado(s)' 0 0 0

Resumo: 1 importado(s), 0 já existente(s), 0 ignorado(s) por nome, 0 inválido(s)
+ '[' 1 -eq 0 ']'
+ '[' 0 -eq 1 ']'
+ '[' 1 -eq 0 ']'
+ git -C /home/runner/work/forja/forja config user.name
+ git -C /home/runner/work/forja/forja lfs install --local
+ git -C /home/runner/work/forja/forja add -- FORJA_ASSETS_3D/exemplo/modelo-grande-41259392768.glb
+ echo 'Conferindo ponteiros do LFS…'
Conferindo ponteiros do LFS…
+ for rel in "${NOVOS[@]}"
++ git -C /home/runner/work/forja/forja cat-file -p :FORJA_ASSETS_3D/exemplo/modelo-grande-41259392768.glb
++ head -n 1
+ primeira='version https://git-lfs.github.com/spec/v1'
+ '[' 'version https://git-lfs.github.com/spec/v1' '!=' 'version https://git-lfs.github.com/spec/v1' ']'
+ titulo='Importa 1 modelo(s) 3D para FORJA_ASSETS_3D/exemplo (Git LFS)'
+ '[' -n '' ']'
+ origem_legivel='release teste-lfs-41259392768'
+ corpo='Origem: release teste-lfs-41259392768'
+ git -C /home/runner/work/forja/forja commit -m 'Importa 1 modelo(s) 3D para FORJA_ASSETS_3D/exemplo (Git LFS)' -m 'Origem: release teste-lfs-41259392768'
++ git -C /home/runner/work/forja/forja log -1 '--pretty=%h %s'
+ echo 'Commit criado: b179fbf Importa 1 modelo(s) 3D para FORJA_ASSETS_3D/exemplo (Git LFS)'
Commit criado: b179fbf Importa 1 modelo(s) 3D para FORJA_ASSETS_3D/exemplo (Git LFS)
+ '[' 1 -eq 1 ']'
+ ok=0
+ for tentativa in 1 2 3
+ git -C /home/runner/work/forja/forja push origin HEAD:refs/heads/teste-branch-lfs-41259392768
remote: 
remote: Create a pull request for 'teste-branch-lfs-41259392768' on GitHub by visiting:        
remote:      https://github.com/1Rayke1/forja/pull/new/teste-branch-lfs-41259392768        
remote: 
To https://github.com/1Rayke1/forja
 * [new branch]      HEAD -> teste-branch-lfs-41259392768
+ ok=1
+ break
+ '[' 1 -ne 1 ']'
+ echo 'Enviado para teste-branch-lfs-41259392768.'
Enviado para teste-branch-lfs-41259392768.
+ '[' -n /home/runner/work/_temp/_runner_file_commands/step_summary_b18f1089-cadf-44de-9351-d2f274fcb37c ']'
+ echo '## Modelos 3D importados'
+ echo
+ echo 'Origem: release teste-lfs-41259392768'
+ echo
+ echo '| Arquivo | Tamanho |'
+ echo '| --- | --- |'
+ for rel in "${NOVOS[@]}"
++ git -C /home/runner/work/forja/forja cat-file -p :FORJA_ASSETS_3D/exemplo/modelo-grande-41259392768.glb
++ awk '/^size / {print $2}'
+ printf '| `%s` | %s B |\n' exemplo/modelo-grande-41259392768.glb 31457280
+ limpar
+ '[' -n /tmp/tmp.JwGVVtkBGe ']'
+ rm -rf /tmp/tmp.JwGVVtkBGe
+ return 0
status=0
```

## Estado da pasta FORJA_ASSETS_3D no branch da sessão
```
b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c - FORJA_ASSETS_3D/exemplo/modelo-grande-41259251448.glb
b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c * FORJA_ASSETS_3D/exemplo/modelo-grande-41259392768.glb
b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c - FORJA_ASSETS_3D/exemplo/modelo-grande.glb
f7d733562e13e22cd9426ed573f80a11840545150645e7ff5a95608a3b147394 - FORJA_ASSETS_3D/exemplo/teste-recebimento.glb
```
