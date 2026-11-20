import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const F = {
  KEYS: {
    profile: 'forja-profile',
    history: 'forja-history',
    routines: 'forja-routines',
    goals: 'forja-goals',
    preferences: 'forja-prefs',
    active: 'forja-active',
    safety: 'forja-safety',
  },
  isAccountDataKey: (k) => k.startsWith('forja-') && !k.startsWith('forja-auth-'),
};
runInNewContext(readFileSync(new URL('../assets/js/forja-cloud-codec.js', import.meta.url), 'utf8'), {
  window: { Forja: F },
});
const C = F.cloudCodec,
  K = F.KEYS;
const raw = {
  [K.profile]: '{"nomeExibicao":"Teste"}',
  [K.history]: '[{"date":"2025-01-02","modality":"weights"}]',
  [K.routines]: '{"weights":[{"id":"r2"},{"id":"r1"}],"calisthenics":[]}',
  [K.goals]: '{"weeklySets":5}',
  [K.preferences]: '{"sound":false}',
  [K.active]: '{"id":"session-a"}',
  'forja-legacy': '{not-json',
  'forja-empty': 'null',
};
const rows = C.encode({ ...raw, [K.safety]: '"local"', 'forja-auth-private': '"private"' });
assert.ok(C.same(C.encode(C.decode(rows)), rows));
for (const [k, text] of Object.entries(raw)) {
  const decoded = C.decode(rows)[k];
  if (k === 'forja-legacy') assert.equal(decoded, text);
  else assert.deepEqual(JSON.parse(decoded), JSON.parse(text));
}
assert.equal(Object.keys(C.encode({})).length, 0);
assert.ok(!JSON.stringify(rows).includes('private'));
assert.ok(!JSON.stringify(rows).includes('forja-safety'));
assert.equal(Object.keys(rows).filter((k) => JSON.parse(k)[0] === 'activity_history').length, 1);
let conflicts = 0;
const record = () => conflicts++;
assert.ok(C.same(C.merge({ v: 1 }, { v: 2, x: 3 }, { v: 3, y: 4 }, record), { v: 3, x: 3, y: 4 }));
assert.equal(conflicts, 1);
assert.ok(
  C.same(
    C.merge([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }], [{ id: 'a' }, { id: 'b', edited: true }], record),
    [{ id: 'a' }],
  ),
);
assert.equal(conflicts, 2);
const before = { items: [{ id: 'a' }, { id: 'b' }], sound: true },
  after = { items: [{ id: 'b' }] },
  legacy = structuredClone(before),
  paths = {};
C.removedPaths(before, after, [], paths);
for (const path of Object.keys(paths)) C.pruneMissing(legacy, after, JSON.parse(path), record);
assert.deepEqual(legacy, after);
console.log(
  'Codec: round trip das sete tabelas, ordem e identidade legadas, chaves privadas, merge de três vias e exclusão por ID OK.',
);
