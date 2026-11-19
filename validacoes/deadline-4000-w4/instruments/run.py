from pathlib import Path
import subprocess, sys, os, json, hashlib, time, signal, datetime, re

W = Path(__file__).resolve().parent.parent
source = Path('/home/user/forja')
root = W / 'runtime/checkout'
cache = W / 'runtime/.cache'
base = json.loads((W / 'evidence/baseline-files.json').read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
utc = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
ALLOWED_ISOLATED_DELTA = {'tests/helpers/browser-interaction.mjs'}
EXCLUDED_DIRS = {
    '.arena', '.cache', '.local', '.mypy_cache', '.next', '.nox', '.npm',
    '.nuxt', '.output', '.parcel-cache', '.playwright-cli', '.pytest_cache',
    '.ruff_cache', '.svelte-kit', '.tox', '.turbo', '.venv', '.vite',
    '__pycache__', 'build', 'coverage', 'dist', 'node_modules', 'out', 'target', '.git'
}

def fingerprint(values):
    return sha(json.dumps(values, sort_keys=True, separators=(',', ':')).encode())

def hashes(at):
    return {p: sha((at / p).read_bytes()) if (at / p).is_file() else None for p in base}

def added_files(at):
    out = {}
    for p in sorted(at.rglob('*')):
        if not p.is_file():
            continue
        rel = p.relative_to(at).as_posix()
        if any(part in {'.git', 'node_modules', '.cache', 'validacoes'} for part in p.relative_to(at).parts):
            continue
        if rel not in base:
            out[rel] = sha(p.read_bytes())
    return out

def check_persistent_clean():
    for sub in ('source', 'tests', 'evidence', 'logs', 'environment', 'instruments'):
        d = W / sub
        for p in d.rglob('*'):
            if p.is_dir() and p.name in EXCLUDED_DIRS:
                raise AssertionError(f'Excluded dir {p.name} inside persistent tree {p}')

def environment(name, phase):
    env = {
        'PATH': os.environ['PATH'],
        'HOME': str(cache / 'home'),
        'TMPDIR': str(cache / 'tmp'),
        'XDG_CACHE_HOME': str(cache / 'xdg'),
        'LANG': 'C.UTF-8',
        'TZ': 'UTC',
        'PYTHONDONTWRITEBYTECODE': '1',
        'NODE_DISABLE_COMPILE_CACHE': '1',
        'NODE_OPTIONS': '--require=' + str(W / 'instruments/policy.cjs'),
        'FORJA_VALIDATION_PHASE': phase,
        'FORJA_POLICY_LOG': str(W / 'logs' / f'{name}.policy.jsonl'),
        'GIT_OPTIONAL_LOCKS': '0',
        'GIT_CONFIG_NOSYSTEM': '1',
        'GIT_CONFIG_GLOBAL': '/dev/null',
        'npm_config_cache': str(cache / 'npm'),
        'npm_config_prefix': str(cache / 'prefix'),
        'npm_config_userconfig': str(cache / 'npm-user.rc'),
        'npm_config_globalconfig': str(cache / 'npm-global.rc'),
        'npm_config_registry': 'https://registry.npmjs.org/',
        'npm_config_update_notifier': 'false',
        'npm_config_audit': 'false',
        'npm_config_fund': 'false',
        'npm_config_ignore_scripts': 'true',
        'npm_config_offline': 'true',
    }
    if 'FORJA_STATIC_OUT' in os.environ:
        env['FORJA_STATIC_OUT'] = os.environ['FORJA_STATIC_OUT']
    browser = W / 'environment/browser-environment.json'
    if browser.exists():
        values = json.loads(browser.read_text())
        env['PUPPETEER_EXECUTABLE_PATH'] = values['wrapper']
        env['LD_LIBRARY_PATH'] = values['libraryPath']
        env['FORJA_BROWSER_OBSERVER'] = str(W / 'logs' / f'{name}.browser.jsonl')
        env['NODE_OPTIONS'] += ' --import=' + str(W / 'instruments/browser-observer.mjs')
    return env

name, phase = sys.argv[1:3]
command = sys.argv[3:]
log = W / 'logs' / f'{name}.log'
metadata = W / 'logs' / f'{name}.json'
assert not log.exists() and not metadata.exists(), f'Refusing overwrite: {name}'

check_persistent_clean()
a = hashes(root)
s0 = hashes(source)
add0 = added_files(root)
assert s0 == base, 'Original checkout drifted from baseline!'
disallowed_iso = [p for p in base if a[p] != base[p] and p not in ALLOWED_ISOLATED_DELTA]
assert not disallowed_iso, f'Disallowed isolated delta before execution: {disallowed_iso}'

persistent_helper_sha = sha((W / 'source/tests/helpers/browser-interaction.mjs').read_bytes())
if phase.startswith('red'):
    assert a['tests/helpers/browser-interaction.mjs'] == base['tests/helpers/browser-interaction.mjs'], 'RED must execute baseline helper!'
elif not phase.startswith('setup'):
    assert a['tests/helpers/browser-interaction.mjs'] == persistent_helper_sha, 'GREEN/static must execute exact W4/source helper!'

for rel, h in add0.items():
    p_copy = W / rel
    assert p_copy.is_file() and sha(p_copy.read_bytes()) == h, f'Added test out of sync with persistent W4/tests/: {rel}'

env = environment(name, phase)
started = utc()
t = time.monotonic()
limit = 1200
timedout = False

print(json.dumps({
    'event': 'start',
    'name': name,
    'atUtc': started,
    'command': command,
    'cwd': str(root),
    'phase': phase,
    'isolatedHelperSha256': a['tests/helpers/browser-interaction.mjs'],
    'persistentSourceHelperSha256': persistent_helper_sha,
    'originalHelperSha256': s0['tests/helpers/browser-interaction.mjs'],
    'addedFiles': add0,
    'isolatedFingerprint': fingerprint(a)
}, ensure_ascii=False), flush=True)

with log.open('w') as stream:
    p = subprocess.Popen(command, cwd=root, env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        rc = p.wait(timeout=limit)
    except subprocess.TimeoutExpired:
        timedout = True
        os.killpg(p.pid, signal.SIGTERM)
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL)
            p.wait()
        rc = 124

elapsed = round(time.monotonic() - t, 6)
ended = utc()
with log.open('a') as stream:
    stream.write(f'\nVALIDATION RUN exit={rc} seconds={elapsed} watchdog={timedout}\n')

b = hashes(root)
s1 = hashes(source)
add1 = added_files(root)
text = log.read_text(errors='replace')
lines = text.splitlines()

policyPath = W / 'logs' / f'{name}.policy.jsonl'
policy = [json.loads(l) for l in policyPath.read_text().splitlines()] if policyPath.exists() else []
browserPath = W / 'logs' / f'{name}.browser.jsonl'
browserEvents = [json.loads(l) for l in browserPath.read_text().splitlines()] if browserPath.exists() else []

denied = [v for v in policy if any(k in v for k in ['deniedWrite', 'blockedNetwork', 'blockedCommand'])]
unsafeFlags = [v for v in policy + browserEvents if v.get('unsafe')]
changed = [p for p in base if a[p] != b[p]] + [k for k in set(add0) | set(add1) if add0.get(k) != add1.get(k)]
sourceChanged = [p for p in base if s0[p] != s1[p]]
critical = [l for l in lines if any(s in l for s in [
    'ERR_MODULE_NOT_FOUND', 'Failed to launch the browser',
    'error while loading shared libraries', 'Could not find Chrome', 'Browser was not found'
])]
failures = [l for l in lines if l.startswith(('❌', '✗', 'FAIL '))]
summaries = [l for l in lines if re.search(r'(?:—|Resultado|APROVAD|aprovad|passed|tests)\s*[:—-]?\s*\d+\s*/\s*\d+', l) or re.search(r'\d+ testes aprovados', l)]
passed = [l for l in lines if l.startswith(('✅', '✓'))]

blocked = timedout or bool(denied or unsafeFlags or changed or sourceChanged or critical)
r = {
    'name': name,
    'newExecution': True,
    'phase': phase,
    'command': command,
    'cwd': str(root),
    'startedAtUtc': started,
    'finishedAtUtc': ended,
    'elapsedSeconds': elapsed,
    'exitCode': rc,
    'timedOut': timedout,
    'blocked': blocked,
    'isolatedHelperSha256': a['tests/helpers/browser-interaction.mjs'],
    'persistentSourceHelperSha256': persistent_helper_sha,
    'originalHelperSha256': s0['tests/helpers/browser-interaction.mjs'],
    'addedFiles': add0,
    'isolatedFingerprintBefore': fingerprint(a),
    'isolatedFingerprintAfter': fingerprint(b),
    'isolatedChangedDuringRun': changed,
    'sourceChangedDuringRun': sourceChanged,
    'policyDenials': denied,
    'unsafeFlags': unsafeFlags,
    'browserSpawns': [e for e in browserEvents if e.get('event') == 'spawn'],
    'browserExits': [e for e in browserEvents if e.get('event') == 'exit'],
    'criticalErrors': critical,
    'passedCount': len(passed),
    'failureCount': len(failures),
    'summaries': summaries,
    'logSha256': sha(log.read_bytes()),
    'policyLogSha256': sha(policyPath.read_bytes()) if policyPath.exists() else None,
    'browserLogSha256': sha(browserPath.read_bytes()) if browserPath.exists() else None,
}
metadata.write_text(json.dumps(r, indent=2) + '\n')
print(json.dumps({
    'event': 'finish',
    'name': name,
    'exitCode': rc,
    'elapsedSeconds': elapsed,
    'blocked': blocked,
    'passedCount': len(passed),
    'failureCount': len(failures),
    'summaries': summaries,
    'spawns': len(r['browserSpawns']),
    'policyDenials': len(denied),
    'unsafeFlags': len(unsafeFlags),
    'logSha256': r['logSha256']
}, ensure_ascii=False))
assert not blocked, f'Blocked execution detected: {name}'
if not phase.startswith('red'):
    assert rc == 0, f'Expected exitCode 0 in {name}, got {rc}'
