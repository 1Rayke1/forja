/* Testes SOMENTE: SDK real; Auth/PostgREST/Google são servidores HTTP simulados.
   JWTs abaixo não têm assinatura real e não são credenciais de nenhum projeto. */
import { createHash, webcrypto } from 'node:crypto';
export const AUTH_URL = 'https://forja-auth-tests.supabase.co';
export const AUTH_KEY = 'sb_publishable_only_a_public_test_fixture_00000000';
export const AUTH_STORAGE_KEY = 'sb-forja-auth-tests-auth-token';
export const USERS = Object.freeze({
  A: '11111111-1111-4111-8111-111111111111',
  B: '22222222-2222-4222-8222-222222222222',
  C: '33333333-3333-4333-8333-333333333333'
});
export const DATA_PREFIX = uid => 'forja-auth-data-v1:' + uid + ':';
export const TAB_PREFIX = uid => 'forja-auth-tab-v1:' + uid + ':';
export const COPY_KEY = uid => 'forja-auth-copy-v1:' + uid;
export const canonical = map => JSON.stringify(Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'en'))));
export const checksum = map => createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(map).sort().map(k => [k, map[k]])))).digest('hex');
export const CONFIG_SCRIPT = 'window.FORJA_PUBLIC_CONFIG = Object.freeze(' + JSON.stringify({ url: AUTH_URL, anonKey: AUTH_KEY }) + ');';
export const PROFILE = { version: 3, updatedAt: '2026-10-01T00:00:00.000Z', objetivo: 'manterForma', nivel: 'iniciante', equipamento: 'casa', diasPorSemana: 3 };
const b64 = obj => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
const json = (data, status = 200, headers = {}) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
export function completedJournal(uid) {
  return JSON.stringify({ version: 1, userId: uid, source: 'account', phase: 'confirmed', checksum: checksum({}), rawByKey: {}, rawSessionByKey: {} });
}
export class TestLocks {
  constructor() { this.queues = new Map(); this.active = new Set(); }
  request(name, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (options?.ifAvailable && this.active.has(name)) return Promise.resolve(callback(null));
    const previous = this.queues.get(name) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => {
      if (options?.signal?.aborted) throw options.signal.reason;
      this.active.add(name);
      return callback({ name, mode: 'exclusive' });
    }).finally(() => { this.active.delete(name); if (this.queues.get(name) === run) this.queues.delete(name); });
    this.queues.set(name, run);
    return run;
  }
}
export class AuthFixture {
  constructor() {
    this.sessions = new Map(); this.refreshes = new Map(); this.codes = new Map(); this.imports = new Map();
    this.requests = []; this.sequence = 0; this.userDelay = 0; this.restDelay = 0;
    this.userErrors = new Map();
    this.offline = false; this.failRest = false; this.failLogout = false; this.badReadback = false;
    this.oauthMode = 'allow'; this.oauthUser = USERS.A; this.configured = true;
    this.defaultSession = this.issue(USERS.A);
  }
  user(uid, provider = 'google') {
    return { id: uid, aud: 'authenticated', role: 'authenticated', email: (uid === USERS.A ? 'conta-a' : uid === USERS.B ? 'conta-b' : 'conta-c') + '@example.test',
      app_metadata: { provider, providers: [provider] }, user_metadata: { full_name: 'Fixture Google' },
      is_anonymous: false, identities: [{ id: uid, user_id: uid, provider, identity_data: { sub: uid } }], created_at: '2026-01-01T00:00:00Z' };
  }
  issue(uid, { expiresAt = 4102444800, provider = 'google', anonymous = false,
    sessionId = '00000000-0000-4000-8000-' + String(this.sequence + 1).padStart(12, '0') } = {}) {
    const actual = this.user(uid, provider); actual.is_anonymous = anonymous;
    // O Auth real mantém session_id na rotação e cria outro id a cada login.
    // É somente metadado fictício; a assinatura continua deliberadamente inválida.
    const access_token = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: uid, session_id: sessionId, role: 'authenticated', aud: 'authenticated', iss: AUTH_URL + '/auth/v1', iat: Math.floor(Date.now() / 1000), exp: expiresAt, jti: ++this.sequence, email: actual.email, app_metadata: actual.app_metadata }) + '.' + b64('not-a-real-signature');
    const refresh_token = 'not-a-real-refresh-' + this.sequence;
    const session = { access_token, refresh_token, expires_at: expiresAt, expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)), token_type: 'bearer', user: actual };
    this.sessions.set(access_token, structuredClone(session)); this.refreshes.set(refresh_token, { uid, provider, anonymous, sessionId });
    return session;
  }
  seed(uid = USERS.A, data = {}, { completed = true, session = null } = {}) {
    const active = session || (uid === USERS.A ? this.defaultSession : this.issue(uid));
    const out = { [AUTH_STORAGE_KEY]: JSON.stringify(active) };
    for (const [key, value] of Object.entries(data)) out[key.startsWith('forja-') ? DATA_PREFIX(uid) + key : key] = typeof value === 'string' ? value : JSON.stringify(value);
    if (completed) out[COPY_KEY(uid)] = completedJournal(uid);
    return out;
  }
  code(uid, challenge) {
    const value = 'not-a-real-code-' + (++this.sequence);
    this.codes.set(value, { uid, challenge }); return value;
  }
  async handle(input, options = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== AUTH_URL) return null;
    if (this.offline) throw new TypeError('Network fixture offline');
    const headers = new Headers(options.headers || (typeof input === 'object' ? input.headers : undefined));
    const method = (options.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const token = (headers.get('authorization') || '').replace(/^Bearer /i, '');
    const known = this.sessions.get(token);
    const userError = this.userErrors.get(token);
    const body = options.body ? JSON.parse(options.body) : null;
    this.requests.push({ url: url.href, method, body, headers: Object.fromEntries(headers) });
    const delay = url.pathname === '/auth/v1/user' ? (userError?.delay ?? this.userDelay) : url.pathname.startsWith('/rest/') ? this.restDelay : 0;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (url.pathname === '/auth/v1/authorize') {
      const redirect = new URL(url.searchParams.get('redirect_to'));
      if (this.oauthMode === 'cancel') redirect.searchParams.set('error', 'access_denied');
      else if (this.oauthMode === 'fail') return json({ error: 'provider unavailable' }, 503);
      else redirect.searchParams.set('code', this.code(this.oauthUser, url.searchParams.get('code_challenge')));
      return new Response('', { status: 302, headers: { location: redirect.href } });
    }
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'pkce') {
        const pending = this.codes.get(body.auth_code); this.codes.delete(body.auth_code);
        if (!pending || !body.code_verifier) return json({ code: 'bad_code_verifier', message: 'invalid code/verifier' }, 400);
        const actualChallenge = createHash('sha256').update(body.code_verifier).digest('base64url');
        if (pending.challenge && pending.challenge !== actualChallenge) return json({ message: 'PKCE challenge mismatch' }, 400);
        return json(this.issue(pending.uid));
      }
      const refresh = this.refreshes.get(body.refresh_token);
      if (!refresh) return json({ code: 'refresh_token_not_found', message: 'refresh revoked' }, 400);
      this.refreshes.delete(body.refresh_token);
      return json(this.issue(refresh.uid, { provider: refresh.provider, anonymous: refresh.anonymous, sessionId: refresh.sessionId }));
    }
    if (url.pathname === '/auth/v1/logout') {
      if (this.failLogout) return json({ message: 'logout unavailable' }, 503);
      if (known) this.refreshes.delete(known.refresh_token);
      return json({}, 200);
    }
    if (url.pathname === '/auth/v1/user') {
      if (userError) return json({ code: userError.code, message: 'Auth fixture error' }, userError.status, { 'x-supabase-api-version': '2024-01-01' });
      if (!known || known.expires_at <= Date.now() / 1000) return json({ code: 'bad_jwt', message: 'invalid JWT' }, 401);
      return json(known.user);
    }
    if (url.pathname === '/rest/v1/user_data_imports') {
      if (this.failRest) return json({ code: 'fixture_unavailable', message: 'unavailable' }, 503);
      if (!known || known.user.is_anonymous || known.user.app_metadata.provider !== 'google') return json({ code: '42501', message: 'RLS' }, 403);
      const uid = known.user.id;
      if (method === 'PATCH' || method === 'PUT') return json({ code: '42501', message: 'UPDATE denied' }, 403);
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        for (const row of rows) {
          if (row.user_id !== uid) return json({ code: '42501', message: 'RLS WITH CHECK' }, 403);
          if (row.format_version !== 1 || !/^[a-f0-9]{64}$/.test(row.checksum) || !row.raw_by_key || Object.entries(row.raw_by_key).some(([k, v]) => !k.startsWith('forja-') || /^forja-(?:auth-|arquivo-)/.test(k) || k === 'forja-backup-seguranca-v1' || typeof v !== 'string')) return json({ code: '23514', message: 'CHECK' }, 400);
          const key = uid + ':' + row.checksum;
          if (this.imports.has(key) && !headers.get('prefer')?.includes('resolution=ignore-duplicates')) return json({ code: '23505', message: 'duplicate' }, 409);
          if (!this.imports.has(key)) this.imports.set(key, structuredClone(row));
        }
        return json(null, 201);
      }
      const requestedUid = url.searchParams.get('user_id')?.replace(/^eq\./, '');
      const requestedHash = url.searchParams.get('checksum')?.replace(/^eq\./, '');
      let rows = [...this.imports.values()].filter(row => row.user_id === uid && (!requestedUid || row.user_id === requestedUid) && (!requestedHash || row.checksum === requestedHash)).map(row => structuredClone(row));
      if (method === 'DELETE') {
        for (const row of rows) this.imports.delete(row.user_id + ':' + row.checksum);
        return json(rows);
      }
      if (this.badReadback && rows[0]) rows[0].raw_by_key = { 'forja-adulterado': '"não é a cópia original"' };
      if (headers.get('accept')?.includes('vnd.pgrst.object')) return rows.length === 1 ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406);
      return json(rows);
    }
    return json({ message: 'fixture endpoint not implemented' }, 404);
  }
}
export function installJsdomAuth(window, fixture, local, session, { locks = true } = {}) {
  Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
  window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
  window.Request = Request; window.Response = Response; window.Headers = Headers; window.AbortController = AbortController;
  if (locks) Object.defineProperty(window.navigator, 'locks', { value: new TestLocks(), configurable: true });
  window.fetch = async (input, options) => {
    const response = await fixture.handle(input, options);
    return response || new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };
  for (const [key, value] of Object.entries(local || {})) window.localStorage.setItem(key, value);
  for (const [key, value] of Object.entries(session || {})) window.sessionStorage.setItem(key, value);
}
