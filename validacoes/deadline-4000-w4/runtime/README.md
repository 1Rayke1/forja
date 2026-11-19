Área de execução temporária W4 (`runtime/checkout/`, `runtime/.cache/`, `node_modules/`, binário Chromium descompactado — ~690 MB no total).
Removida após a conclusão da suíte integral e `28-static-final` para garantir que a persistência dos artefatos W4 (~3.1 MB) permaneça muito abaixo do limite de snapshot e sem diretórios excluídos (`.git`, `node_modules`, `.cache`).
A recuperação e reprodução independentes não dependem de `runtime/`: partem apenas de `/home/user/forja` (825 arquivos originais) + `source/` + `tests/` + `evidence/helper-w4.diff` + `instruments/` + `environment/`.
