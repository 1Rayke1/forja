#!/usr/bin/env node
/* Injeta somente Project URL + publishable/anon no ARTEFATO, sem imprimir valores. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
function fail(message) { console.error('Configuração de autenticação: ' + message); process.exit(1); }
const outArg = process.argv[2];
if (!outArg || !fs.existsSync(outArg)) fail('informe um artefato existente.');
const out = fs.realpathSync(path.resolve(outArg));
if (out === root || root.startsWith(out + path.sep)) fail('não é permitido escrever no fonte ou em seu ancestral.');
const configPath = path.join(out, 'assets/js/forja-supabase-config.js');
if (!fs.existsSync(configPath) || !fs.existsSync(path.join(out, 'login.html'))) fail('destino não é um artefato FORJA.');
// Recusa symlinks, inclusive nos diretórios intermediários.
for (const rel of ['assets', 'assets/js', 'assets/js/forja-supabase-config.js', 'login.html', 'admin', 'admin/exercicios.html']) {
  if (fs.existsSync(path.join(out, rel)) && fs.lstatSync(path.join(out, rel)).isSymbolicLink()) fail('symlink não é permitido no destino.');
}
const urlText = String(process.env.FORJA_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = String(process.env.FORJA_SUPABASE_ANON_KEY || '').trim();
let url;
try { url = new URL(urlText); } catch { fail('FORJA_SUPABASE_URL ausente ou inválida.'); }
if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
    url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  fail('Project URL deve ser a origem HTTPS do projeto Supabase.');
}
let publicKey = /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key);
if (!publicKey && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    publicKey = payload.role === 'anon';
    if (payload.ref && payload.ref !== url.hostname.split('.')[0]) fail('chave anon pertence a outro projeto.');
  } catch { publicKey = false; }
}
if (!publicKey || /sb_secret_|service_role/i.test(key)) fail('use somente publishable ou JWT anon, nunca uma chave privada.');
const script = '/* Gerado no artefato: apenas valores públicos. */\nwindow.FORJA_PUBLIC_CONFIG = Object.freeze(' +
  JSON.stringify({ url: url.origin, anonKey: key }).replace(/</g, '\\u003c') + ');\n';
const adminPath = path.join(out, 'admin/exercicios.html');
if (fs.existsSync(adminPath)) {
  // A CSP administrativa mantém uma origem exata, inclusive ao trocar o projeto
  // público pela variável. Nunca libera connect-src geral nem script inline.
  const admin = fs.readFileSync(adminPath, 'utf8').replace(
    /(<meta http-equiv="Content-Security-Policy" content=")([^"]+)(">)/,
    (_, before, policy, after) => before + policy.replace(/https:\/\/[a-z0-9-]+\.supabase\.co/g, url.origin) + after
  );
  fs.writeFileSync(adminPath, admin);
}
fs.writeFileSync(configPath, script);
console.log('Configuração pública de autenticação injetada no artefato (valores omitidos).');
