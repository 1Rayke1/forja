/* Real Chromium, real PKCE/SDK, simulated HTTP. No user credentials. */
import assert from 'node:assert/strict';
import { launchBrowser, startServer, waitReady, waitLogin } from './helpers/browser.mjs';
import { AuthFixture, USERS, PROFILE } from './helpers/auth-fixture.mjs';
import { installBrowserAuth } from './helpers/browser-auth.mjs';
const f = new AuthFixture(),
  server = await startServer(),
  browser = await launchBrowser();
const url = server.origin + '/forja/';
async function login(uid) {
  const context = await browser.createBrowserContext(),
    page = await context.newPage();
  await installBrowserAuth(page, f, server.origin, { local: {} });
  f.oauthUser = uid;
  await page.goto(url + 'login.html');
  await waitLogin(page);
  await page.click('#google-login');
  await page.waitForSelector('html[data-forja-auth="ready"]');
  await waitReady(page);
  return page;
}
try {
  const a = await login(USERS.A);
  assert.ok(a.url().includes('onboarding/'));
  await a.evaluate((profile) => {
    const F = window.Forja,
      k = F.KEYS;
    const writes = [
      [k.profile, profile],
      [k.goals, { weeklySessions: 4 }],
      [k.preferences, { sound: false }],
      [
        k.routines,
        {
          weights: [
            {
              id: 'rotina-A',
              name: 'Musculação',
              modality: 'weights',
              sections: { main: [{ id: 'ex-1', name: 'Remada', sets: 3 }] },
            },
          ],
          calisthenics: [],
        },
      ],
      [
        k.history,
        [
          {
            id: 'registro-A',
            modality: 'weights',
            date: '2026-11-20',
            completedSets: 3,
            totals: { volumeKg: 60 },
          },
        ],
      ],
      [k.appearance, { contrast: true }],
      ['forja-missoes-2026-11-20', [{ id: 'm-1', text: 'Treinar' }]],
    ];
    for (const [k, v] of writes) if (!F.store.write(k, v).ok) throw Error('write failed');
  }, PROFILE);
  // Automatic drain, not a manual flush on the happy path.
  await a.waitForFunction(() => Forja.cloud.status === 'synced');
  assert.equal(new Set([...f.rows.keys()].map((k) => JSON.parse(k)[0])).size, 7);
  const snapshot = (p) =>
    p.evaluate(() => Object.fromEntries(Forja.store.keys().map((k) => [k, Forja.store.read(k).value])));
  const expected = await snapshot(a);
  await a.reload();
  await waitReady(a);
  assert.deepEqual(await snapshot(a), expected);
  const second = await login(USERS.A);
  assert.deepEqual(await snapshot(second), expected);
  // Both tabs base their changes on the same earlier read. Even the loser's
  // localStorage.setItem must survive until the UID worker can reconcile it.
  const tab = await a.browserContext().newPage();
  await installBrowserAuth(tab, f, server.origin, { seed: false });
  await tab.goto(url);
  await waitReady(tab);
  const localKey = 'forja-duas-abas-v1';
  for (const page of [a, tab]) await page.evaluate((k) => Forja.store.read(k), localKey);
  await Promise.all([
    a.evaluate((k) => Forja.store.write(k, { a: 1 }), localKey),
    tab.evaluate((k) => Forja.store.write(k, { b: 2 }), localKey),
  ]);
  await tab.evaluate(() => Forja.cloud.flush());
  assert.deepEqual(await tab.evaluate((k) => Forja.store.read(k).value, localKey), { a: 1, b: 2 });
  await tab.evaluate((k) => Forja.store.remove(k), localKey);
  await tab.evaluate(() => Forja.cloud.flush());
  await tab.close();
  // Two devices read the same revision. Delay A's conditional write, commit B,
  // then require A to retry against B instead of updating a stale version.
  let entered, release;
  const paused = new Promise((r) => {
      entered = r;
    }),
    resume = new Promise((r) => {
      release = r;
    });
  const handle = f.handle.bind(f);
  let hold = true;
  f.handle = async (input, options) => {
    if (hold && options?.method === 'PATCH' && String(input).includes('/rest/v1/profiles')) {
      hold = false;
      entered();
      await resume;
    }
    return handle(input, options);
  };
  await a.evaluate(() =>
    Forja.store.write(Forja.KEYS.profile, {
      ...Forja.store.read(Forja.KEYS.profile).value,
      nomeExibicao: 'Dispositivo A',
    }),
  );
  const racing = a.evaluate(() => Forja.cloud.flush());
  await paused;
  await second.evaluate(() =>
    Forja.store.write(Forja.KEYS.profile, {
      ...Forja.store.read(Forja.KEYS.profile).value,
      diasPorSemana: 5,
    }),
  );
  assert.equal(await second.evaluate(() => Forja.cloud.flush()), true);
  release();
  assert.equal(await racing, false);
  assert.equal(await a.evaluate(() => Forja.cloud.flush()), true);
  f.handle = handle;
  expected['forja-perfil-v1'] = {
    ...expected['forja-perfil-v1'],
    nomeExibicao: 'Dispositivo A',
    diasPorSemana: 5,
  };
  assert.deepEqual(await snapshot(a), expected);
  const b = await login(USERS.B);
  assert.deepEqual(await snapshot(b), {});
  assert.deepEqual(
    await b.evaluate(async (uid) => {
      const api = Forja.auth.client,
        t = 'routines';
      const read = await api.from(t).select('*').eq('user_id', uid);
      const update = await api.from(t).update({ data: {} }).eq('user_id', uid).select();
      const del = await api.from(t).delete().eq('user_id', uid).select();
      const insert = await api.from(t).insert({ user_id: uid, id: 'denied', data: {} });
      return [read.data, update.data, del.data, insert.status];
    }, USERS.A),
    [[], [], [], 403],
  );
  f.failSync = true;
  await second.evaluate(() => Forja.store.remove(Forja.KEYS.goals));
  await second.waitForFunction(() => Forja.cloud.status === 'error');
  await second.evaluate(() => {
    void Forja.auth.signOut();
  });
  await waitLogin(second);
  f.failSync = false;
  f.oauthUser = USERS.A;
  await second.click('#google-login');
  await second.waitForSelector('html[data-forja-auth="ready"]');
  await second.waitForFunction(() => Forja.cloud.status === 'synced');
  const clean = await login(USERS.A);
  delete expected['forja-treino-metas-v1'];
  assert.deepEqual(await snapshot(clean), expected);
  assert.ok(![...f.rows.keys()].some((k) => JSON.parse(k)[0] === 'goals'));
  // Hold a successful A response past logout; a new B login in the very same
  // localStorage must not commit A's acknowledgement or replay A's next row.
  let committed, deliver;
  const serverCommitted = new Promise((r) => {
      committed = r;
    }),
    lateReply = new Promise((r) => {
      deliver = r;
    });
  f.handle = async (input, options) => {
    const response = await handle(input, options);
    if (options?.method === 'PATCH' && String(input).includes('/rest/v1/profiles')) {
      committed();
      await lateReply;
    }
    return response;
  };
  await clean.evaluate(() =>
    Forja.store.write(Forja.KEYS.profile, {
      ...Forja.store.read(Forja.KEYS.profile).value,
      nomeExibicao: 'Commit antes da saída',
    }),
  );
  await serverCommitted;
  await clean.evaluate(() => {
    void Forja.auth.signOut();
  });
  await waitLogin(clean);
  f.oauthUser = USERS.B;
  await clean.click('#google-login');
  await clean.waitForSelector('html[data-forja-auth="ready"]');
  deliver();
  f.handle = handle;
  assert.equal(await clean.evaluate(() => Forja.auth.user.id), USERS.B);
  assert.deepEqual(await snapshot(clean), {});
  expected['forja-perfil-v1'].nomeExibicao = 'Commit antes da saída';
  assert.deepEqual(await snapshot(await login(USERS.A)), expected);
  console.log(
    'Chromium: PKCE, gravação automática nas sete tabelas, reload, recuperação sem cache em outro contexto, RLS simulada A/B, fila após logout e exclusão OK.',
  );
} finally {
  await browser.close();
  await server.close();
}
