# Relatório do teste de recebimento (run 41259251448)

Gerado em 2026-11-01 01:01:07Z.

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


## Saída do validador de assets 3D
```
Validando FORJA_ASSETS_3D/ (Git LFS)…

Resumo: 2 modelo(s) validado(s), 0 erro(s), 0 aviso(s)
  .glb    2
Tamanho total no LFS: 30.00 MB
Validação concluída sem erros.
validar_status=Validação concluída sem erros.
```

## Log do Teste 2b (sanitizado)
```
Conferindo ponteiros do LFS…
+ for rel in "${NOVOS[@]}"
++ git -C /home/runner/work/forja/forja cat-file -p :FORJA_ASSETS_3D/exemplo/modelo-grande-41259251448.glb
++ head -n 1
+ primeira='version https://git-lfs.github.com/spec/v1'
+ '[' 'version https://git-lfs.github.com/spec/v1' '!=' 'version https://git-lfs.github.com/spec/v1' ']'
+ titulo='Importa 1 modelo(s) 3D para FORJA_ASSETS_3D/exemplo (Git LFS)'
+ '[' -n '' ']'
+ origem_legivel='release teste-lfs-41259251448'
+ corpo='Origem: release teste-lfs-41259251448'
+ git -C /home/runner/work/forja/forja commit -m 'Importa 1 modelo(s) 3D para FORJA_ASSETS_3D/exemplo (Git LFS)' -m 'Origem: release teste-lfs-41259251448'
++ git -C /home/runner/work/forja/forja log -1 '--pretty=%h %s'
+ echo 'Commit criado: 8d367f3 Importa 1 modelo(s) 3D para FORJA_ASSETS_3D/exemplo (Git LFS)'
Commit criado: 8d367f3 Importa 1 modelo(s) 3D para FORJA_ASSETS_3D/exemplo (Git LFS)
+ '[' 1 -eq 1 ']'
+ ok=0
+ for tentativa in 1 2 3
+ git -C /home/runner/work/forja/forja push origin HEAD:teste-lfs-41259251448
To https://github.com/1Rayke1/forja
 ! [rejected]        HEAD -> teste-lfs-41259251448 (already exists)
error: failed to push some refs to 'https://github.com/1Rayke1/forja'
hint: Updates were rejected because the tag already exists in the remote.
+ echo 'Push recusado (tentativa 1); atualizando com rebase…'
Push recusado (tentativa 1); atualizando com rebase…
+ git -C /home/runner/work/forja/forja pull --rebase --autostash origin teste-lfs-41259251448
From https://github.com/1Rayke1/forja
 * tag               teste-lfs-41259251448 -> FETCH_HEAD
Current branch arena/1c5f56b5-forja is up to date.
+ for tentativa in 1 2 3
+ git -C /home/runner/work/forja/forja push origin HEAD:teste-lfs-41259251448
To https://github.com/1Rayke1/forja
 ! [rejected]        HEAD -> teste-lfs-41259251448 (already exists)
error: failed to push some refs to 'https://github.com/1Rayke1/forja'
hint: Updates were rejected because the tag already exists in the remote.
+ echo 'Push recusado (tentativa 2); atualizando com rebase…'
Push recusado (tentativa 2); atualizando com rebase…
+ git -C /home/runner/work/forja/forja pull --rebase --autostash origin teste-lfs-41259251448
From https://github.com/1Rayke1/forja
 * tag               teste-lfs-41259251448 -> FETCH_HEAD
Current branch arena/1c5f56b5-forja is up to date.
+ for tentativa in 1 2 3
+ git -C /home/runner/work/forja/forja push origin HEAD:teste-lfs-41259251448
To https://github.com/1Rayke1/forja
 ! [rejected]        HEAD -> teste-lfs-41259251448 (already exists)
error: failed to push some refs to 'https://github.com/1Rayke1/forja'
hint: Updates were rejected because the tag already exists in the remote.
+ echo 'Push recusado (tentativa 3); atualizando com rebase…'
Push recusado (tentativa 3); atualizando com rebase…
+ git -C /home/runner/work/forja/forja pull --rebase --autostash origin teste-lfs-41259251448
From https://github.com/1Rayke1/forja
 * tag               teste-lfs-41259251448 -> FETCH_HEAD
Current branch arena/1c5f56b5-forja is up to date.
+ '[' 0 -ne 1 ']'
+ echo 'ERRO: não foi possível enviar o commit para teste-lfs-41259251448.'
ERRO: não foi possível enviar o commit para teste-lfs-41259251448.
+ exit 1
+ limpar
+ '[' -n /tmp/tmp.zlQvZImJyw ']'
+ rm -rf /tmp/tmp.zlQvZImJyw
+ return 0
```

## Estado da pasta FORJA_ASSETS_3D no branch da sessão
```
b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c * FORJA_ASSETS_3D/exemplo/modelo-grande-41259251448.glb
b939d617975706c3eeccc03a1a5aed00828041612adfb95b6ef08613a878d21c - FORJA_ASSETS_3D/exemplo/modelo-grande.glb
f7d733562e13e22cd9426ed573f80a11840545150645e7ff5a95608a3b147394 - FORJA_ASSETS_3D/exemplo/teste-recebimento.glb
```
