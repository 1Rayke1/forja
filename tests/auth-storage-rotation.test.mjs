/* Regressão da causa raiz do flash "Verificando sua sessão…".
   Uma rotação de access_token da MESMA conta entregue por um storage event
   deve ser uma revalidação SILENCIOSA: o gate (forjaAuth) permanece "ready"
   e a interface autenticada não volta a mostrar a tela de verificação,
   mesmo que isVerified() ainda esteja false no momento do evento (o token
   persistido já foi trocado, mas a conta verificada em memória é a mesma).
   Sem instrumentação de diagnóstico: apenas o estado público do gate/auth. */
import assert from 'node:assert/strict';
import { App, BASE, closeAllApps } from './helpers/harness.mjs';
import { AuthFixture, USERS, PROFILE, AUTH_STORAGE_KEY } from './helpers/auth-fixture.mjs';

const tick = ms => new Promise(r => setTimeout(r, ms));
const P = 'forja-perfil-v1';
const sleepUntil = async (cond, msg, timeout = 6000) => {
  const deadline = Date.now() + timeout;
  while (!cond()) { if (Date.now() > deadline) throw new Error(msg); await tick(15); }
};

let passed = 0, failed = 0;
async function test(name, task) {
  try { await task(); passed++; console.log('✅ ' + name); }
  catch (e) { failed++; console.error('❌ ' + name + '\n   ' + (e && e.message)); }
  finally { await closeAllApps(); }
}

await test('Rotação de token da mesma conta via storage event não bloqueia o gate', async () => {
  const fixture = new AuthFixture();
  const app = new App({ fixture, locks: true });
  await app.load(BASE + 'index.html', { local: fixture.seed(USERS.A, { [P]: PROFILE }) });
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'ready', 'não ficou ready');
  await sleepUntil(() => app.F.authData?.userId, 'dados não vinculados');

  // Rotação de token da MESMA conta (outra aba/documento): novo access_token,
  // mesmo usuário. Deve ser revalidação SILENCIOSA.
  const refreshed = fixture.issue(USERS.A);
  const old = app.w.localStorage.getItem(AUTH_STORAGE_KEY);
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(refreshed));

  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key: AUTH_STORAGE_KEY, oldValue: old, newValue: JSON.stringify(refreshed) }));

  // O flash "Verificando sua sessão…" é o defeito: o gate não deve sair do
  // estado "ready" com a sessão ainda válida da mesma conta.
  const immediateAttr = app.d.documentElement.dataset.forjaAuth;
  console.log('   gate imediatamente após storage event: forjaAuth=' + immediateAttr);
  assert.equal(immediateAttr, 'ready', 'gate não deve sair do ready no flash');

  // A sessão continua válida e volta a "ready" após a revalidação concluir.
  await sleepUntil(() => app.F.auth.isVerified() && app.d.documentElement.dataset.forjaAuth === 'ready' && app.F.authData?.userId === USERS.A, 'não recuperou');
  console.log('   recuperou ready: verified=' + app.F.auth.isVerified(), 'uid=' + app.F.auth.user?.id);
  app.close();
});

// Rotação de OUTRA conta (troca de usuário) deve travar o gate (fail closed):
// protege a interface contra uma sessão de conta diferente chegando.
await test('Rotação de conta diferente via storage event trava o gate (fail closed)', async () => {
  const fixture = new AuthFixture();
  const app = new App({ fixture, locks: true });
  await app.load(BASE + 'index.html', { local: fixture.seed(USERS.A, { [P]: PROFILE }) });
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'ready', 'não ficou ready');

  const other = fixture.issue(USERS.B);
  const old = app.w.localStorage.getItem(AUTH_STORAGE_KEY);
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(other));
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key: AUTH_STORAGE_KEY, oldValue: old, newValue: JSON.stringify(other) }));

  const immediateAttr = app.d.documentElement.dataset.forjaAuth;
  console.log('   gate após troca de conta: forjaAuth=' + immediateAttr);
  assert.equal(immediateAttr, 'locked', 'troca de conta deve travar o gate');
  app.close();
});

console.log('\nREGRESSÃO (rotação via storage): ' + passed + ' passaram, ' + failed + ' falharam');
if (failed) process.exitCode = 1;
