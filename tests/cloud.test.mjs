import assert from 'node:assert/strict';
import { boot, closeAllApps, makeRoutine } from './helpers/harness.mjs';
import { AuthFixture, USERS, PROFILE, checksum } from './helpers/auth-fixture.mjs';
const f = new AuthFixture(),
  device = async (local = {}, opts = {}) => {
    const a = await boot(local, 'onboarding/index.html', { fixture: f, noProfile: true, ...opts });
    await a.F.ready;
    return a;
  };
const snapshot = (a) =>
  JSON.parse(JSON.stringify(Object.fromEntries(a.keys().map((k) => [k, JSON.parse(a.raw(k))]))));
const flush = async (a) => {
  assert.equal(await a.F.cloud.flush(), true);
};
try {
  const a = await device();
  const K = a.F.KEYS;
  const sample = {
    [K.profile]: PROFILE,
    [K.routines]: {
      weights: [makeRoutine('weights', 'Teste', [{ name: 'Remada' }], 'r1')],
      calisthenics: [],
    },
    [K.history]: [
      {
        id: 's1',
        modality: 'weights',
        date: '2026-10-12',
        completedSets: 1,
        totals: { volumeKg: 40 },
        exercises: [{ id: 'ex1' }],
      },
    ],
    [K.goals]: { weeklySessions: 3 },
    [K.preferences]: { sound: true },
    [K.appearance]: { contrast: true },
    [K.library]: { weights: [], calisthenics: [] },
    'forja-plano-semanal-v1': { sessions: [{ id: 's1' }] },
    'forja-missoes-2026-11-20': [{ id: 'm1', text: 'Treinar', done: true }],
  };
  for (const [k, v] of Object.entries(sample)) a.set(k, v);
  await flush(a);
  assert.equal(new Set([...f.rows.keys()].map((k) => JSON.parse(k)[0])).size, 7);
  const count = f.rows.size;
  await flush(a);
  assert.equal(count, f.rows.size);
  const b = await device();
  assert.deepEqual(snapshot(b), sample);
  await b.reload();
  await b.F.ready;
  assert.deepEqual(snapshot(b), sample);
  const other = await device({}, { uid: USERS.B });
  assert.deepEqual(snapshot(other), {});
  assert.equal(other.F.authData.userId, USERS.B);
  other.set(K.profile, { ...PROFILE, nomeExibicao: 'Outra' });
  await flush(other);
  a.set(K.profile, { ...PROFILE, nomeExibicao: 'Primeira', diasPorSemana: 5 });
  b.set(K.profile, { ...PROFILE, nomeExibicao: 'Segunda', equipamento: 'academia' });
  await flush(a);
  await flush(b);
  assert.equal(b.data(K.profile).nomeExibicao, 'Primeira');
  assert.equal(b.data(K.profile).equipamento, 'academia');
  assert.equal(b.data(K.profile).diasPorSemana, 5);
  assert.ok(b.w.localStorage.getItem('forja-auth-sync-v1:' + USERS.A + ':conflicts').includes('Segunda'));
  f.failSync = true;
  a.F.store.remove(K.routines);
  assert.equal(await a.F.cloud.flush(), false);
  assert.equal(a.F.cloud.status, 'error');
  // Reload while writes are pending. Authoritative fetch must precede onboarding.
  await a.reload();
  assert.equal(a.d.documentElement.dataset.forjaAuth, 'locked');
  f.failSync = false;
  await a.F.retryBoot();
  await a.F.ready;
  await flush(a);
  await flush(b);
  assert.equal(b.raw(K.routines), null);
  assert.ok(![...f.rows.keys()].some((k) => JSON.parse(k)[0] === 'routines'));
  await flush(other);
  assert.equal(other.data(K.profile).nomeExibicao, 'Outra');
  const old = { 'forja-perfil-v1': JSON.stringify(PROFILE), 'forja-antigo-v1': '"preservado"' };
  const hash = checksum(old);
  f.imports.set(USERS.C + ':' + hash, {
    user_id: USERS.C,
    checksum: hash,
    format_version: 1,
    raw_by_key: old,
  });
  const c = await device({}, { uid: USERS.C });
  assert.equal(c.data('forja-antigo-v1'), 'preservado');
  await flush(c);
  c.F.store.remove('forja-antigo-v1');
  await flush(c);
  const clean = await device({}, { uid: USERS.C });
  assert.equal(clean.raw('forja-antigo-v1'), null);
  console.log(
    'Persistência: sete tabelas, cache independente, reload, isolamento, reconciliação, migração idempotente, erro/retry e exclusões OK (HTTP simulado).',
  );
} finally {
  closeAllApps();
}
