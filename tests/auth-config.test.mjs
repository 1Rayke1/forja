/* Build/configuração apenas com valores públicos fictícios; nenhum deploy ou SQL. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { AUTH_URL, AUTH_KEY } from './helpers/auth-fixture.mjs';
const root = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-auth-config-'));
const out = path.join(temporary, 'site');
const configSource = path.join(root, 'assets/js/forja-supabase-config.js');
const sourceHash = () => createHash('sha256').update(fs.readFileSync(configSource)).digest('hex');
const originalHash = sourceHash();
const environment = { ...process.env, FORJA_SUPABASE_URL: AUTH_URL, FORJA_SUPABASE_ANON_KEY: AUTH_KEY };
function run(command, args, env = environment) {
  return spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 60000 });
}
function configure(env = {}, destination = out) { return run(process.execPath, ['tools/configurar-auth.mjs', destination], { ...environment, ...env }); }
const jwt = payload => Buffer.from('{"alg":"HS256"}').toString('base64url') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.ZmljdGljaWE';
let passed = 0, failed = 0;
function test(name, task) {
  try { task(); passed++; console.log('✅ CONFIG ' + name); }
  catch (error) { failed++; console.error('❌ CONFIG ' + name + '\n' + error.stack); }
}
try {
  test('1. Build copia login/15 rotas/SDK e preserva as 148 imagens, sem dados internos', () => {
    const result = run('bash', ['tools/preparar-site.sh', out]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /148 imagens WebP/);
    assert.match(result.stdout, /Links relativos do artefato: OK/);
    for (const file of ['login.html', 'admin/exercicios.html', 'treino/grupo.html', 'assets/js/forja-auth.js', 'assets/js/forja-auth-data.js', 'assets/vendor/supabase/LICENSE']) assert.ok(fs.existsSync(path.join(out, file)), file);
    for (const file of ['tests', 'docs', 'supabase', '.env', '.github', '.cache', 'node_modules']) assert.equal(fs.existsSync(path.join(out, file)), false, file);
  });
  test('2. Somente o artefato recebe configuração; fonte permanece sem chave', () => {
    const context = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(out, 'assets/js/forja-supabase-config.js'), 'utf8'), context);
    assert.equal(context.window.FORJA_PUBLIC_CONFIG.url, AUTH_URL);
    assert.equal(context.window.FORJA_PUBLIC_CONFIG.anonKey, AUTH_KEY);
    assert.ok(fs.readFileSync(path.join(out, 'admin/exercicios.html'), 'utf8').includes(AUTH_URL));
    assert.equal(sourceHash(), originalHash);
    assert.match(fs.readFileSync(configSource, 'utf8'), /anonKey: ""/);
  });
  test('3. Variáveis ausentes interrompem o build, sem publicar app desconfigurado', () => {
    for (const env of [{ FORJA_SUPABASE_URL: '' }, { FORJA_SUPABASE_ANON_KEY: '' }]) assert.notEqual(configure(env).status, 0);
  });
  test('4. Chaves secretas e JWT service_role são recusados e nunca aparecem nos logs', () => {
    const secrets = ['sb_secret_APENAS_UMA_FIXTURE_PRIVADA', jwt({ role: 'service_role' }), 'GOCSPX-apenas-um-segredo-ficticio'];
    for (const key of secrets) {
      const result = configure({ FORJA_SUPABASE_ANON_KEY: key });
      assert.notEqual(result.status, 0);
      assert.equal((result.stdout + result.stderr).includes(key), false);
      assert.equal(fs.readFileSync(path.join(out, 'assets/js/forja-supabase-config.js'), 'utf8').includes(key), false);
    }
  });
  test('5. JWT público anon é aceito, mas ref de outro projeto é recusada', () => {
    const accepted = configure({ FORJA_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: 'forja-auth-tests' }) });
    assert.equal(accepted.status, 0);
    assert.notEqual(configure({ FORJA_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: 'outro-projeto' }) }).status, 0);
  });
  test('6. URL deve ser a origem HTTPS Supabase, sem credencial, caminho ou query', () => {
    for (const url of ['http://abundydxjclcgonctirx.supabase.co', 'https://supabase.co.evil.test', 'https://user:password@abundydxjclcgonctirx.supabase.co', AUTH_URL + '/auth/v1', AUTH_URL + '?x=1', AUTH_URL + '#hash']) assert.notEqual(configure({ FORJA_SUPABASE_URL: url }).status, 0, url);
  });
  test('7. Gerador recusa raiz/ancestral e artefato inválido', () => {
    for (const destination of [root, path.dirname(root), temporary]) assert.notEqual(configure({}, destination).status, 0);
    assert.equal(sourceHash(), originalHash);
  });
  test('8. Symlink não permite sobrescrever fonte por dentro de um artefato', () => {
    const symlinkSite = path.join(temporary, 'symlink-site');
    fs.mkdirSync(symlinkSite);
    fs.copyFileSync('login.html', path.join(symlinkSite, 'login.html'));
    fs.symlinkSync(path.join(root, 'assets'), path.join(symlinkSite, 'assets'), 'dir');
    assert.notEqual(configure({}, symlinkSite).status, 0);
    assert.equal(sourceHash(), originalHash);
  });
  test('9. Preparador recusa apagar o próprio checkout', () => {
    const result = run('bash', ['tools/preparar-site.sh', root]);
    assert.notEqual(result.status, 0); assert.ok(fs.existsSync(path.join(root, '.git')));
  });
  test('10. Workflow mantém Pages na main, usa Repository Variables e Node 22', () => {
    const workflow = fs.readFileSync('.github/workflows/static.yml', 'utf8');
    assert.match(workflow, /branches: \["main"\]/);
    assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /vars\.FORJA_SUPABASE_URL/);
    assert.match(workflow, /vars\.FORJA_SUPABASE_ANON_KEY/);
    assert.match(workflow, /node-version: '22'/);
    assert.doesNotMatch(workflow, /pull_request:|secrets\.FORJA_SUPABASE/);
    assert.match(workflow, /actions\/deploy-pages@v4/);
  });
  test('11. Vendor é byte a byte igual ao SDK/licença fixados no pacote oficial', () => {
    const result = run(process.execPath, ['tools/sincronizar-supabase.mjs', '--check']);
    assert.equal(result.status, 0, result.stderr);
  });
  test('12. Netlify mantém Functions/redirects e publica só o artefato configurado', () => {
    const config = fs.readFileSync('netlify.toml', 'utf8');
    assert.match(config, /publish = "\.site-publish"/);
    assert.match(config, /directory = "netlify\/functions"/);
    for (const endpoint of ['workout-plan', 'youtube-search', 'youtube-videos']) assert.ok(config.includes('/api/' + endpoint));
    assert.equal(sourceHash(), originalHash);
  });
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log(`\nCONFIG — ${passed}/${passed + failed} testes aprovados (zero deploy/SQL).`);
if (failed) process.exitCode = 1;
