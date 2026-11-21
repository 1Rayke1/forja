/* Eliminação da mensagem repetitiva "Verificando sua sessão…" nas navegações.

   A arquitetura é multipágina (não SPA): cada botão/link que abre outra página
   HTML carrega um novo documento, que reexecuta o guard de autenticação. A
   causa do gate repetitivo era que TODA página iniciava em "locked" e só
   liberava depois do getUser.

   A fix: o módulo auth grava um marcador de sessão já verificada após o
   getUser concluir; o guard, carregado no <head> antes da primeira pintura,
   libera a página IMEDIATAMENTE ("warm") quando o marcador existe e não há
   saída/troca. A segurança não muda: sem o marcador a página continua
   "locked"; a revalidação (getUser) ocorre em segundo plano e retrava a
   página (gate) se a sessão estiver expirada/inválida/alterada; os dados
   permanecem bloqueados (driver auth-locked) até o bind após a verificação.

   Estes testes provam, sem instrumentação, o estado público do gate/auth
   através do histórico de transições do atributo data-forja-auth. */
import assert from 'node:assert/strict';
import { App, BASE, closeAllApps, boot } from './helpers/harness.mjs';
import { AuthFixture, USERS, PROFILE, AUTH_STORAGE_KEY } from './helpers/auth-fixture.mjs';

const tick = ms => new Promise(r => setTimeout(r, ms));
const P = 'forja-perfil-v1';
const READY_MARKER = 'forja-auth-ready-v1';
const sleepUntil = async (cond, msg, timeout = 6000) => {
  const deadline = Date.now() + timeout;
  while (!cond()) { if (Date.now() > deadline) throw new Error(msg); await tick(15); }
};

let passed = 0, failed = 0;
async function test(name, task) {
  try { await task(); passed++; console.log('✅ ' + name); }
  catch (e) { failed++; console.error('❌ ' + name + '\n   ' + (e && e.stack || e)); }
  finally { await closeAllApps(); }
}

// 1. Navegação com sessão válida não reinicia a tela de verificação.
await test('Navegação para outra página com sessão válida passa por "warm" (sem "Verificando…")', async () => {
  const fixture = new AuthFixture();
  const app = await boot({ fixture, uid: USERS.A }, 'index.html');
  // Primeiro acesso (sem marcador): cold start, sem "warm".
  assert.ok(!app.forjaAuthHistory.includes('warm'), 'primeiro acesso sem marcador não deve passar por warm');
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'ready', 'não ficou ready');
  assert.ok(app.w.localStorage.getItem(READY_MARKER), 'marcador deve existir após ready');

  // Navega para outra página HTML (novo documento).
  await app.go('treino/index.html');
  const history = app.forjaAuthHistory;
  console.log('   histórico do gate na navegação: ' + JSON.stringify(history));
  assert.ok(history.includes('warm'), 'navegação com sessão verificada deve passar por warm');
  assert.ok(history.indexOf('warm') < history.indexOf('ready'), 'warm deve ocorrer antes do ready');
  assert.ok(!history.slice(0, history.indexOf('warm')).includes('locked') || history.indexOf('warm') === 0,
    'não deve haver gate bloqueante antes do warm na navegação');

  // Revalidação conclui com a mesma conta.
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'ready' && app.F.auth.isVerified(), 'não ficou ready');
  assert.equal(app.F.auth.user?.id, USERS.A);
  app.close();
});

// 2. Login inicial continua funcionando: cold start sem marcador.
await test('Login/primeiro acesso continua verificando normalmente (sem warm)', async () => {
  const fixture = new AuthFixture();
  const app = await boot({ fixture, uid: USERS.A }, 'index.html');
  assert.ok(!app.forjaAuthHistory.includes('warm'), 'sem marcador não deve passar por warm');
  assert.notEqual(app.forjaAuthHistory[0], 'warm', 'não deve começar em warm');
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'ready', 'não ficou ready');
  assert.equal(app.F.auth.isVerified(), true);
  assert.equal(app.F.auth.user?.id, USERS.A);
  app.close();
});

// 3. Logout limpa o marcador.
await test('Logout remove o marcador de sessão verificada', async () => {
  const fixture = new AuthFixture();
  const app = await boot({ fixture, uid: USERS.A }, 'index.html');
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'ready', 'não ficou ready');
  assert.ok(app.w.localStorage.getItem(READY_MARKER), 'marcador presente antes do logout');
  void app.F.auth.signOut();
  await sleepUntil(() => app.d.body.dataset.page === 'login', 'não voltou ao login');
  assert.equal(app.w.localStorage.getItem(READY_MARKER), null, 'marcador deve ser removido no logout');
  app.close();
});

// 4. Troca de conta remove o marcador (fail closed).
await test('Troca de conta remove o marcador (fail closed)', async () => {
  const fixture = new AuthFixture();
  const app = await boot({ fixture, uid: USERS.A }, 'index.html');
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'ready', 'não ficou ready');
  assert.ok(app.w.localStorage.getItem(READY_MARKER), 'marcador de A presente');
  const other = fixture.issue(USERS.B);
  const old = app.w.localStorage.getItem(AUTH_STORAGE_KEY);
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(other));
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key: AUTH_STORAGE_KEY, oldValue: old, newValue: JSON.stringify(other) }));
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'locked', 'troca de conta não travou o gate');
  assert.equal(app.w.localStorage.getItem(READY_MARKER), null, 'marcador deve ser removido na troca de conta');
  app.close();
});

// 5. Rotação de token da mesma conta preserva o marcador e o gate (PR #75).
await test('Rotação de token da mesma conta preserva o marcador e o gate', async () => {
  const fixture = new AuthFixture();
  const app = new App({ fixture, locks: true });
  await app.load(BASE + 'index.html', { local: fixture.seed(USERS.A, { [P]: PROFILE }) });
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'ready', 'não ficou ready');
  const refreshed = fixture.issue(USERS.A);
  const old = app.w.localStorage.getItem(AUTH_STORAGE_KEY);
  app.w.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(refreshed));
  app.w.dispatchEvent(new app.w.StorageEvent('storage', { key: AUTH_STORAGE_KEY, oldValue: old, newValue: JSON.stringify(refreshed) }));
  assert.equal(app.d.documentElement.dataset.forjaAuth, 'ready', 'rotação da mesma conta não deve sair do ready');
  assert.ok(app.w.localStorage.getItem(READY_MARKER), 'marcador deve permanecer na rotação da mesma conta');
  await sleepUntil(() => app.F.auth.isVerified() && app.d.documentElement.dataset.forjaAuth === 'ready', 'não recuperou');
  app.close();
});

// 6. Acesso direto a página protegida diferente do login (com marcador).
await test('Acesso direto a página protegida diferente do login libera em warm', async () => {
  const fixture = new AuthFixture();
  const local = fixture.seed(USERS.A, { [P]: PROFILE });
  local[READY_MARKER] = JSON.stringify({ uid: USERS.A, at: Date.now() });
  const app = new App({ fixture });
  await app.load(BASE + 'progresso/index.html', { local });
  assert.ok(app.forjaAuthHistory.includes('warm'), 'acesso direto com marcador deve passar por warm');
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'ready' && app.F.auth.isVerified(), 'não ficou ready');
  assert.equal(app.F.auth.user?.id, USERS.A);
  app.close();
});

// 7. Marcador ilegível/ausente nunca libera antecipadamente (fail closed).
await test('Marcador inválido não libera a página antecipadamente', async () => {
  const fixture = new AuthFixture();
  const local = fixture.seed(USERS.A, { [P]: PROFILE });
  local[READY_MARKER] = JSON.stringify({ uid: 'não-é-uuid', at: Date.now() });
  const app = new App({ fixture });
  await app.load(BASE + 'index.html', { local });
  assert.ok(!app.forjaAuthHistory.includes('warm'), 'marcador inválido deve ser ignorado (sem warm)');
  await sleepUntil(() => app.d.documentElement.dataset.forjaAuth === 'ready', 'não ficou ready');
  assert.equal(app.F.auth.isVerified(), true);
  app.close();
});

console.log('\nWARM NAVIGATION — ' + passed + ' passaram, ' + failed + ' falharam');
if (failed) process.exitCode = 1;
