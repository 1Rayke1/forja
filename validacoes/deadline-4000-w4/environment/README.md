# Ambiente e Rastreabilidade — Rodada Experimental W4

## Estrutura persistente (fora de `.git`, `node_modules` e `.cache`)

- `source/`: cópia completa do código experimental (`tests/helpers/browser-interaction.mjs`), livre de `.git`, `node_modules` ou diretórios excluídos de snapshot.
- `tests/`: cópia completa da pasta `tests/` do repositório + suítes experimentais W4 (`browser-interaction-w4-regressions.test.mjs`, `browser-interaction-w4-regressions.browser.mjs`), livre de `.git`, `node_modules` ou diretórios excluídos de snapshot.
- `evidence/`: prova de persistência, baseline (`baseline-files.json`, `baseline-browser-interaction.mjs`, `git-before.json`), diff real (`helper-w4.diff`), manifestos SHA-256 (`phase0-manifest.json`, `experimental-manifest.json`), probe de segurança (`security-capability-probe.json`), integridade estática (`static-integrity.json`) e resumo consolidado (`validation-summary.json`).
- `logs/`: logs `.log`, manifestos `.json`, trilhas `.policy.jsonl` e `.browser.jsonl` de todas as execuções.
- `environment/`: documentação do ambiente (`README.md`, `metrics-contract.md`, `environment.json`, `browser-environment.json`).
- `instruments/`: scripts de execução isolada, política loopback-only, observador de browser e checagem estática.
- `runtime/`: espaço descartável de execução (`runtime/checkout/` com `node_modules/` e `.git/` auxiliar para `tests/auth-config.test.mjs`, mais `runtime/.cache/` para binário Chromium). Mesmo se `runtime/`, `checkout/`, `.cache/` ou `node_modules/` forem descartados pelo mecanismo de snapshot, 100% do código, testes, diffs, manifestos e logs da W4 permanecem preservados nas pastas persistentes acima.
