const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const acorn = require('internal/deps/acorn/acorn/dist/acorn');

const W = path.resolve(__dirname, '..');
const root = process.cwd();
const originalRoot = '/home/user/forja';
const base = JSON.parse(fs.readFileSync(path.join(W, 'evidence/baseline-files.json'), 'utf8'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    ['.git', 'node_modules', '.cache', 'validacoes'].includes(d.name)
      ? []
      : d.isDirectory()
        ? walk(path.join(dir, d.name))
        : [path.join(dir, d.name)]
  );
}

const allIsolated = walk(root);
const selected = allIsolated.filter(p => /\.(?:js|mjs|cjs)$/.test(p));
const syntaxFailures = [];
for (const p of selected) {
  const r = cp.spawnSync(process.execPath, ['--check', p], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) syntaxFailures.push({ file: path.relative(root, p), exit: r.status, stderr: r.stderr });
}

function details(file) {
  const text = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  const assertions = [], scenarios = [], skipOnly = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') {
      const c = node.callee;
      if ((c?.type === 'Identifier' && c.name === 'assert') || (c?.type === 'MemberExpression' && c.object?.name === 'assert')) {
        assertions.push(text.slice(node.start, node.end));
      }
      if (c?.type === 'Identifier' && c.name === 'check' && node.arguments[0]?.type === 'Literal') {
        scenarios.push(node.arguments[0].value);
      }
      if (c?.type === 'MemberExpression' && ['skip', 'only'].includes(c.property?.name)) {
        skipOnly.push(text.slice(node.start, node.end));
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (!['start', 'end'].includes(k)) {
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === 'object') visit(v);
      }
    }
  }
  visit(ast);
  return { assertions, scenarios, skipOnly };
}

const identicalBetween = p => {
  const isoBytes = fs.readFileSync(path.join(root, p));
  const origBytes = fs.readFileSync(path.join(originalRoot, p));
  const h = sha(isoBytes);
  return isoBytes.equals(origBytes) && h === base[p];
};

const generalIso = details(path.join(root, 'tests/e2e.browser.mjs'));
const generalOrig = details(path.join(originalRoot, 'tests/e2e.browser.mjs'));

const protectedPrefixesOrExact = Object.keys(base).filter(p =>
  /^assets\/js\/forja-(?:auth|login)/.test(p) ||
  /^tests\/(?:auth|helpers\/(?:auth|browser-auth))/.test(p) ||
  [
    'package.json',
    'package-lock.json',
    'tests/helpers/browser.mjs',
    'tests/helpers/scrollend-off.mjs',
    'tests/e2e.browser.mjs',
    'tests/browser-interaction.browser.mjs',
    'tests/browser-interaction-regressions.browser.mjs',
    'tests/browser-interaction-nested.browser.mjs',
    'tests/browser-interaction-protocol.browser.mjs',
    'tests/browser-interaction-expanded.browser.mjs',
    'tests/browser-interaction-chain.test.mjs',
    'tests/browser-interaction-deadline.test.mjs',
    'tests/browser-interaction-late-protocol.test.mjs',
    'tests/helpers/scroll-dom-model.mjs',
    'assets/vendor/supabase/supabase.js',
    'docs/correcao-helper-scroll-e2e.md',
    'docs/evidencias-helper-scroll-e2e.json',
    'docs/evidencias-helper-scroll-e2e.zip',
    'docs/correcao-helper-scroll-aninhados-deadline.md',
    'docs/evidencias-helper-scroll-aninhados-deadline.json',
    'docs/evidencias-helper-scroll-aninhados-deadline.zip',
    'docs/evidencias-helper-scroll-aninhados-deadline.sha256'
  ].includes(p)
);

const protectedStatus = {};
for (const p of protectedPrefixesOrExact) {
  protectedStatus[p] = {
    matchesOriginalAndBaseline: identicalBetween(p),
    sha256: sha(fs.readFileSync(path.join(root, p)))
  };
}

const baselineCheck = { total: Object.keys(base).length, isolatedMismatch: [], originalMismatch: [] };
for (const [p, expectedSha] of Object.entries(base)) {
  const isoPath = path.join(root, p);
  const origPath = path.join(originalRoot, p);
  if (!fs.existsSync(isoPath) || sha(fs.readFileSync(isoPath)) !== expectedSha) baselineCheck.isolatedMismatch.push(p);
  if (!fs.existsSync(origPath) || sha(fs.readFileSync(origPath)) !== expectedSha) baselineCheck.originalMismatch.push(p);
}

const allowedNewPattern = /^tests\/browser-interaction-w3-[a-z0-9-]+\.(?:test|browser)\.mjs$/;
const addedFiles = {};
const disallowedAdded = [];
for (const abs of allIsolated) {
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  if (!(rel in base)) {
    const d = rel.endsWith('.mjs') || rel.endsWith('.js') ? details(abs) : { assertions: [], skipOnly: [] };
    addedFiles[rel] = {
      sha256: sha(fs.readFileSync(abs)),
      bytes: fs.statSync(abs).size,
      assertions: d.assertions.length,
      skipOnlyCount: d.skipOnly.length,
      allowed: allowedNewPattern.test(rel) && d.skipOnly.length === 0
    };
    if (!addedFiles[rel].allowed) disallowedAdded.push(rel);
  }
}

const helperPath = 'tests/helpers/browser-interaction.mjs';
const helperIsoSha = sha(fs.readFileSync(path.join(root, helperPath)));
const helperOrigSha = sha(fs.readFileSync(path.join(originalRoot, helperPath)));

const result = {
  syntax: { files: selected.length, passed: selected.length - syntaxFailures.length, failures: syntaxFailures },
  generalE2E: {
    asserts: generalIso.assertions.length,
    scenarios: generalIso.scenarios.length,
    bytesIdentical: identicalBetween('tests/e2e.browser.mjs'),
    assertionTextAndOrderIdentical: JSON.stringify(generalIso.assertions) === JSON.stringify(generalOrig.assertions),
    scenarioTextAndOrderIdentical: JSON.stringify(generalIso.scenarios) === JSON.stringify(generalOrig.scenarios),
    skipOnlyCount: generalIso.skipOnly.length
  },
  baselineCheck,
  isolatedAllowedDeltaOnly: baselineCheck.isolatedMismatch.every(p => p === helperPath),
  addedFiles,
  disallowedAdded,
  helperStatus: {
    isolatedSha256: helperIsoSha,
    originalSha256: helperOrigSha,
    originalUntouched: helperOrigSha === base[helperPath]
  },
  protectedStatus
};

result.ok =
  syntaxFailures.length === 0 &&
  generalIso.assertions.length === 589 &&
  generalIso.scenarios.length === 46 &&
  result.generalE2E.bytesIdentical &&
  result.generalE2E.assertionTextAndOrderIdentical &&
  result.generalE2E.scenarioTextAndOrderIdentical &&
  result.generalE2E.skipOnlyCount === 0 &&
  baselineCheck.originalMismatch.length === 0 &&
  result.isolatedAllowedDeltaOnly &&
  disallowedAdded.length === 0 &&
  result.helperStatus.originalUntouched &&
  Object.values(protectedStatus).every(x => x.matchesOriginalAndBaseline);

const outName = process.env.FORJA_STATIC_OUT || 'evidence/static-integrity.json';
fs.writeFileSync(path.join(W, outName), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({
  syntax: result.syntax,
  generalE2E: result.generalE2E,
  baselineCheck,
  addedFiles: result.addedFiles,
  disallowedAdded: result.disallowedAdded,
  helperStatus: result.helperStatus,
  protectedCount: Object.keys(protectedStatus).length,
  ok: result.ok
}, null, 2));
assert.equal(result.ok, true);
