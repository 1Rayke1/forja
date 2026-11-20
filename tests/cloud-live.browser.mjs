/* Opt-in acceptance test. No interception, seed, tokens in env or admin client.
   Operator performs normal Google login and workout creation in a visible Chrome. */
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';
import puppeteer from 'puppeteer-core';
const url = process.env.FORJA_HOMOLOGACAO_URL,
  executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
if (!url || !executablePath || !process.stdin.isTTY)
  throw Error(
    'Requer terminal interativo, Chrome visível, URL autorizada e duas contas Google descartáveis. Consulte docs/persistencia.md.',
  );
const cli = createInterface({ input: process.stdin, output: process.stdout });
const browser = await puppeteer.launch({ executablePath, headless: false });
const step = (message) => cli.question(message + ' Depois pressione Enter (não informe credenciais aqui).\n');
async function start() {
  const ctx = await browser.createBrowserContext(),
    page = await ctx.newPage();
  await page.goto(new URL('login.html', url.endsWith('/') ? url : url + '/').href);
  return { ctx, page };
}
async function observe(page) {
  return page.evaluate(async () => {
    const F = window.Forja,
      uid = F.auth.user?.id;
    if (!uid || !F.auth.canWrite()) throw Error('Sessão Google não verificada.');
    if (!(await F.cloud.flush()) || F.cloud.status !== 'synced') throw Error('Há alterações pendentes.');
    const raw = Object.fromEntries(
      F.store
        .keys()
        .filter((k) => k !== F.KEYS.safety)
        .map((k) => [k, F.store.readRaw(k)]),
    );
    const projection = F.cloudCodec.encode(raw),
      api = F.auth.dataClient(uid).api;
    // Compare each row with actual PostgREST readback, not a status badge.
    for (const [key, payload] of Object.entries(projection)) {
      const [table, id] = JSON.parse(key);
      let q = api.from(table).select('data').eq('user_id', uid);
      if (!F.cloudCodec.single.has(table)) q = q.eq('id', id);
      const result = await q.single();
      if (result.error) throw Error('Falha na releitura: ' + table);
      const remote = { ...result.data.data.payload };
      if (table === 'user_settings') {
        delete remote.importsChecked;
        delete remote.removed;
        delete remote.deletedPaths;
      }
      if (!F.cloudCodec.same(remote, payload)) throw Error('Conteúdo divergente: ' + table);
    }
    return {
      uid,
      signature: F.cloudCodec.stable(projection),
      tables: [...new Set(Object.keys(projection).map((k) => JSON.parse(k)[0]))],
    };
  });
}
try {
  const a = await start();
  await step(
    'Entre com a conta de TESTE A. Crie o perfil, uma rotina com exercícios, metas, conclua um treino, altere som, aparência, plano e missões. Aguarde Sincronizado',
  );
  // Restrict cross-account mutation probes to a unique, disposable canary.
  const canary = await a.page.evaluate(() => {
    const F = window.Forja,
      id = 'homologacao-' + crypto.randomUUID();
    const routines = F.store.read(F.KEYS.routines).value;
    if (!Array.isArray(routines?.weights)) throw Error('Crie uma rotina antes do teste.');
    routines.weights.push({
      id,
      modality: 'weights',
      name: 'Canário de isolamento',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sections: { main: [], warmup: [], abs: [], finisher: [] },
    });
    if (!F.store.write(F.KEYS.routines, routines).ok)
      throw Error('Falha ao preparar o registro descartável.');
    return id;
  });
  const before = await observe(a.page);
  assert.equal(before.tables.length, 7, 'Prepare dados nas sete tabelas');
  // Do not print snapshots, JWTs, UID or profile in assertion errors.
  await a.page.reload();
  await a.page.waitForSelector('html[data-forja-auth="ready"]');
  assert.ok((await observe(a.page)).signature === before.signature, 'Reload divergente');
  await a.page.evaluate(() => {
    void Forja.auth.signOut();
  });
  await a.page.waitForSelector('#google-login');
  await a.ctx.close();
  const b = await start();
  await step('Entre com a conta de TESTE B (diferente de A) e permaneça no FORJA');
  const isolated = await b.page.evaluate(
    async (other, id) => {
      const F = window.Forja;
      if (!F.auth.canWrite() || F.auth.user.id === other) return false;
      for (const table of F.cloudCodec.tables) {
        const r = await F.auth.client.from(table).select('user_id').eq('user_id', other);
        if (r.error || r.data.length) return false;
      }
      const scoped = (q) => q.eq('user_id', other).eq('id', id).select('id');
      const patched = await scoped(
        F.auth.client.from('routines').update({ updated_at: new Date().toISOString() }),
      );
      const removed = await scoped(F.auth.client.from('routines').delete());
      return !patched.error && !removed.error && !patched.data.length && !removed.data.length;
    },
    before.uid,
    canary,
  );
  assert.ok(isolated, 'Isolamento RLS não confirmado');
  await b.ctx.close();
  const clean = await start();
  await step('No terceiro contexto, sem cache nem cookies de A, entre novamente com a conta A');
  const restored = await observe(clean.page);
  assert.ok(restored.uid === before.uid && restored.signature === before.signature, 'Recuperação divergente');
  console.log(
    'Homologação real: sete tabelas, readback, reload, logout, isolamento de leitura/escrita/exclusão e recuperação integral de A em novo contexto: OK.',
  );
} finally {
  cli.close();
  await browser.close();
}
