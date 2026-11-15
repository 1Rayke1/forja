#!/usr/bin/env node
/* Copia a distribuição UMD oficial, sem CDN, transpile ou código Auth alternativo. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules/@supabase/supabase-js');
const target = path.join(root, 'assets/vendor/supabase');
const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
if (pkg.version !== '2.119.0') throw new Error('SDK diferente da versão fixada.');
const files = new Map([
  ['supabase.js', fs.readFileSync(path.join(source, 'dist/umd/supabase.js'))],
  ['LICENSE', fs.readFileSync(path.join(source, 'LICENSE'))]
]);
const sha = createHash('sha256').update(files.get('supabase.js')).digest('hex');
files.set('README.md', Buffer.from(`# Supabase JS oficial\n\nVersão: **${pkg.version}**. Licença: MIT, em LICENSE.\n\nFonte: pacote npm @supabase/supabase-js, dist/umd/supabase.js.\nNenhuma alteração ao SDK. Atualização: npm ci && npm run vendor:supabase.\nVerificação: npm run vendor:supabase -- --check.\n\nSHA-256 de supabase.js: \`${sha}\`.\n`));
if (!process.argv.includes('--check')) fs.mkdirSync(target, { recursive: true });
for (const [name, bytes] of files) {
  const file = path.join(target, name);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) throw new Error('Vendor divergente: ' + name);
  } else fs.writeFileSync(file, bytes);
}
console.log(`Supabase JS ${pkg.version}: distribuição, licença e SHA-256 OK.`);
