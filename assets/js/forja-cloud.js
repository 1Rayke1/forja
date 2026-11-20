/* Durable outbox = difference between the scoped driver and the last acknowledged
   rows. Per-tab intents additionally protect overlapping local aggregate edits. */
(function (w) {
  'use strict';
  const F = w.Forja,
    C = F.cloudCodec,
    storage = w.localStorage;
  const settings = C.address('user_settings');
  const writer = w.crypto.randomUUID();
  let account,
    timer,
    status = 'pending',
    delay = 1000,
    work;
  const labels = {
    synced: 'Sincronizado',
    syncing: 'Sincronizando…',
    pending: 'Alterações pendentes',
    error: 'Não sincronizado. Os dados locais foram preservados.',
  };
  function announce(next) {
    status = next;
    const label = w.document.querySelector('[data-sync-status]'),
      retry = w.document.querySelector('[data-sync-retry], [data-sync-reload]');
    if (label) label.textContent = labels[next];
    if (retry) retry.hidden = next !== 'error';
    const conflicts = w.document.querySelector('[data-sync-conflicts]');
    if (conflicts && account && F.auth.isVerified(account.uid))
      conflicts.hidden = !storage.getItem(storageKey(account.uid, 'conflicts'));
  }
  function schedule(ms) {
    w.clearTimeout(timer);
    timer = w.setTimeout(flush, ms);
  }
  function changed(uid, key) {
    if (account?.uid !== uid || key === F.KEYS.safety) return;
    announce('pending');
    schedule(200);
  }
  function persist(key, value) {
    storage.setItem(key, JSON.stringify(value));
  }
  const storageKey = (uid, part) => `forja-auth-sync-v1:${uid}:${part}`;
  // A separate slot per writer/key keeps two tabs editing the same localStorage
  // aggregate from erasing each other's intent. Coalesce during long outages.
  function unpack(text) {
    if (text == null) return undefined;
    try {
      return { value: JSON.parse(text) };
    } catch {
      return { text };
    }
  }
  function pack(v) {
    return v === undefined ? null : (v.text ?? JSON.stringify(v.value));
  }
  function record(uid, key, before, after, actual, commit) {
    if (key === F.KEYS.safety) {
      commit(after);
      return after;
    }
    // The other tab may have already drained its queue before this stale form
    // saves. Merge against the bytes the caller last read, not just disk now.
    const value =
      before === actual
        ? after
        : pack(C.merge(unpack(before), unpack(after), unpack(actual), () => archive({ uid }, after, actual)));
    const slot = storageKey(uid, 'edit:' + writer + ':' + key),
      previous = storage.getItem(slot);
    const entry = {
      key,
      before: previous ? JSON.parse(previous).before : before,
      after,
      at: w.performance.timeOrigin + w.performance.now(),
      nonce: w.crypto.randomUUID(),
    };
    persist(slot, entry);
    try {
      commit(value);
    } catch (err) {
      if (previous === null) storage.removeItem(slot);
      else storage.setItem(slot, previous);
      throw err;
    }
    changed(uid, key);
    return value;
  }
  function readIntents(ctx, raw) {
    const prefix = storageKey(ctx.uid, 'edit:'),
      entries = [];
    for (const slot of Object.keys(storage))
      if (slot.startsWith(prefix)) {
        const bytes = storage.getItem(slot);
        if (bytes) entries.push({ slot, bytes, ...JSON.parse(bytes) });
      }
    const groups = new Map();
    for (const op of entries.sort((a, b) => a.at - b.at || a.nonce.localeCompare(b.nonce))) {
      if (!F.isAccountDataKey(op.key) || op.key === F.KEYS.safety) throw Error('Fila inválida.');
      if (!groups.has(op.key)) groups.set(op.key, []);
      groups.get(op.key).push(op);
    }
    const result = { ...raw };
    for (const [key, ops] of groups) {
      if (ops.length < 2) continue; // the driver already committed this tab's edits
      let current = unpack(ops[0].before);
      for (const op of ops)
        current = C.merge(unpack(op.before), current, unpack(op.after), () => archive(ctx, current, op));
      if (current === undefined) delete result[key];
      else result[key] = current.text ?? JSON.stringify(current.value);
    }
    return { result, entries };
  }
  async function pages(api, uid, table, check) {
    const order = table === 'user_data_imports' ? 'checksum' : C.single.has(table) ? 'user_id' : 'id';
    // Keyset pagination, including servers with a lower configured max-rows.
    const all = [];
    let last;
    for (;;) {
      let q = api.from(table).select('*').eq('user_id', uid).order(order).limit(250);
      if (last !== undefined) q = q.gt(order, last);
      const { data, error } = await q;
      check();
      if (error || !Array.isArray(data) || data.some((r) => r.user_id !== uid))
        throw Error('Leitura remota não confirmada.');
      if (!data.length) return all;
      all.push(...data);
      const end = data[data.length - 1][order];
      if (end === last || typeof end !== 'string') throw Error('Paginação inválida.');
      last = end;
      if (C.single.has(table)) return all;
    }
  }
  async function fetchRows(api, uid, check) {
    const rows = {},
      revisions = {};
    await Promise.all(
      C.tables.map(async (table) => {
        for (const row of await pages(api, uid, table, check)) {
          if (
            row.data?.format !== 1 ||
            typeof row.data.rev !== 'string' ||
            !row.data.payload ||
            typeof row.data.payload !== 'object' ||
            Array.isArray(row.data.payload) ||
            (table === 'goals' && row.id !== 'weekly')
          )
            throw Error('Formato remoto não reconhecido.');
          const addr = C.address(table, row.id);
          rows[addr] = row.data.payload;
          revisions[addr] = row.data.rev;
        }
      }),
    );
    return { rows, revisions };
  }
  function equivalent(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    try {
      return C.same(JSON.parse(a), JSON.parse(b));
    } catch {
      return false;
    }
  }
  function replay(ctx, job) {
    const now = ctx.read();
    for (const [key, before, after] of job.changes) {
      // Never replace a newer synchronous edit made after the work was staged.
      if ((now[key] ?? null) === before) ctx.apply(key, after);
    }
    persist(storageKey(ctx.uid, 'base'), job.base);
    storage.removeItem(storageKey(ctx.uid, 'hydrate'));
  }
  function archive(ctx, local, remote) {
    const key = storageKey(ctx.uid, 'conflicts'),
      list = JSON.parse(storage.getItem(key) || '[]');
    if (!list.some((v) => C.same(v.local, local) && C.same(v.remote, remote))) {
      list.push({ at: new Date().toISOString(), local, remote });
      persist(key, list);
    }
  }
  async function mutate(api, uid, addr, payload, rev, nextRev) {
    const [table, id] = JSON.parse(addr),
      data = { format: 1, rev: nextRev, payload };
    const body = { data };
    if (table === 'profiles')
      body.display_name = [...String(payload?.nomeExibicao || '')].slice(0, 100).join('');
    if (['activity_history', 'progress_entries'].includes(table)) {
      const time = Date.parse(payload?.record?.finishedAt || payload?.record?.date || payload?.date);
      if (Number.isFinite(time)) body.occurred_at = new Date(time).toISOString();
    } else body.updated_at = new Date().toISOString();
    let q;
    if (!rev) q = api.from(table).insert({ ...body, user_id: uid, ...(C.single.has(table) ? {} : { id }) });
    else {
      q = (payload === undefined ? api.from(table).delete() : api.from(table).update(body))
        .eq('user_id', uid)
        .eq('data->>rev', rev);
      if (!C.single.has(table)) q = q.eq('id', id);
    }
    const { error, data: result } = await q.select('user_id');
    if (error || result?.length !== 1 || result[0].user_id !== uid)
      throw Error('A gravação não foi confirmada.');
  }
  async function cycle(ctx, boot, { api, check }) {
    check();
    const { uid } = ctx;
    const baseKey = storageKey(uid, 'base'),
      wal = storageKey(uid, 'hydrate');
    if (storage.getItem(wal)) replay(ctx, JSON.parse(storage.getItem(wal)));
    const saved = storage.getItem(baseKey),
      base = JSON.parse(saved || '{}');
    const { rows, revisions } = await fetchRows(api, uid, check);
    check();
    // A server commit may outlive its HTTP response or page. Recognize our own
    // acknowledged version before comparing subsequent offline edits/deletes.
    const flightKey = storageKey(uid, 'flight'),
      flight = JSON.parse(storage.getItem(flightKey) || 'null');
    if (flight && (revisions[flight.key] === flight.nextRev || (flight.deleted && !(flight.key in rows)))) {
      if (flight.deleted) delete base[flight.key];
      else base[flight.key] = rows[flight.key];
      persist(baseKey, base);
      storage.removeItem(flightKey);
    }
    let imported = {},
      marker = !!(
        storage.getItem(storageKey(uid, 'imports')) ||
        base[settings]?.importsChecked ||
        rows[settings]?.importsChecked
      );
    if (!saved && !marker) {
      const copies = await pages(api, uid, 'user_data_imports', check);
      for (const copy of copies.sort((a, b) =>
        String(a.created_at || '').localeCompare(String(b.created_at || '')),
      )) {
        if (
          copy.format_version !== 1 ||
          !ctx.validRaw(copy.raw_by_key) ||
          (await ctx.digest(copy.raw_by_key)) !== copy.checksum
        )
          throw Error('Cópia inicial não confere.');
        check();
        if (copy.checksum !== ctx.original)
          imported = C.merge({}, imported, C.encode(copy.raw_by_key), () =>
            archive(ctx, imported, copy.raw_by_key),
          );
      }
      marker = copies.length > 0;
    }
    check();
    const raw = ctx.read(),
      intents = readIntents(ctx, raw),
      local = C.encode(intents.result);
    const withLegacy = C.merge({}, imported, local, () => archive(ctx, imported, local));
    if (marker || Object.keys(local).length || Object.keys(rows).length)
      (withLegacy[settings] ||= {}).importsChecked = true;
    const profile = C.address('profiles');
    if (
      withLegacy[profile] &&
      rows[profile] &&
      F.profileIsConfigured(rows[profile]) &&
      !F.profileIsConfigured(withLegacy[profile])
    ) {
      archive(ctx, withLegacy[profile], rows[profile]);
      withLegacy[profile] = rows[profile];
    }
    // Durable deletion markers also cover a pre-sync device: it has no common
    // ancestor and would otherwise import its old copy as a new record.
    const tombstones = { ...base[settings]?.removed, ...rows[settings]?.removed };
    for (const key of Object.keys(tombstones)) {
      if (!saved && !rows[key] && withLegacy[key]) {
        archive(ctx, withLegacy[key], null);
        delete withLegacy[key];
      }
    }
    for (const key of Object.keys(base)) if (key !== settings && !(key in withLegacy)) tombstones[key] = true;
    if (Object.keys(tombstones).length) (withLegacy[settings] ||= {}).removed = tombstones;
    const deletedPaths = { ...base[settings]?.deletedPaths, ...rows[settings]?.deletedPaths };
    for (const key of Object.keys(base))
      if (base[key] && withLegacy[key]) {
        if (key === settings) {
          for (const field of ['extras', 'collections'])
            C.removedPaths(base[key][field], withLegacy[key][field], [key, field], deletedPaths);
        } else C.removedPaths(base[key], withLegacy[key], [key], deletedPaths);
      }
    if (!saved)
      for (const path of Object.keys(deletedPaths))
        C.pruneMissing(withLegacy, rows, JSON.parse(path), (v) => archive(ctx, v, null));
    if (Object.keys(deletedPaths).length) (withLegacy[settings] ||= {}).deletedPaths = deletedPaths;
    const desired = C.merge(base, withLegacy, rows, () => archive(ctx, local, rows));
    const next = C.decode(desired);
    // Progress summaries are a projection; interrupted multi-row commits can
    // leave the summary missing or stale. Repair from the full training record.
    const projection = C.encode(next);
    // During the first import an opaque malformed legacy value may coexist with
    // a typed remote row for the same logical key. Keep the typed record, but
    // archive the other original before hydration (the rows have different PKs).
    for (const [key, opaque] of Object.entries(desired[settings]?.extras || {})) {
      if (!Object.hasOwn(projection[settings]?.extras || {}, key)) {
        archive(ctx, { [key]: opaque }, { [key]: next[key] });
        delete desired[settings].extras[key];
      }
    }
    const summary = (key) => {
      const [table, id] = JSON.parse(key);
      return table === 'progress_entries' && id !== '@active';
    };
    for (const key of Object.keys(desired)) if (summary(key) && !(key in projection)) delete desired[key];
    for (const key of Object.keys(projection)) if (summary(key)) desired[key] = projection[key];
    const changes = [...new Set([...Object.keys(raw), ...Object.keys(next)])]
      .filter((k) => !equivalent(raw[k], next[k]))
      .map((k) => [k, raw[k] ?? null, next[k] ?? null]);
    if (changes.length) {
      const job = { changes, base: rows };
      persist(wal, job);
      replay(ctx, job);
      if (!boot && F.auth.canWrite())
        for (const [key] of changes) w.dispatchEvent(new w.StorageEvent('storage', { key }));
    } else if (!saved || !C.same(base, rows)) persist(baseKey, rows);
    for (const op of intents.entries) if (storage.getItem(op.slot) === op.bytes) storage.removeItem(op.slot);
    const pending = [...new Set([...Object.keys(desired), ...Object.keys(rows)])].filter(
      (k) => !C.same(desired[k], rows[k]),
    );
    // Preserve an import marker even for an entirely empty recovered copy.
    if (marker && !rows[settings]?.importsChecked) persist(storageKey(uid, 'imports'), true);
    if (boot) {
      announce(pending.length ? 'pending' : 'synced');
      if (pending.length) schedule(200);
      return;
    }
    // Commit anti-resurrection metadata before physical row deletions.
    if (pending.includes(settings)) {
      pending.splice(pending.indexOf(settings), 1);
      if (pending.some((key) => desired[key] === undefined)) pending.unshift(settings);
      else pending.push(settings); // Publish the import marker after recovered domain rows.
    }
    const staged = ctx.read();
    for (const key of pending) {
      check();
      const nextRev = w.crypto.randomUUID();
      persist(flightKey, { key, nextRev, deleted: desired[key] === undefined });
      await mutate(api, uid, key, desired[key], revisions[key], nextRev);
      check();
      if (desired[key] === undefined) delete rows[key];
      else rows[key] = desired[key];
      persist(baseKey, rows);
      storage.removeItem(flightKey);
    }
    if (!C.same(staged, ctx.read())) {
      announce('pending');
      schedule(200);
    } else announce('synced');
    delay = 1000;
  }
  async function locked(ctx, boot) {
    const client = F.auth.dataClient(ctx.uid);
    return w.navigator.locks.request('forja:sync:' + ctx.uid, () => cycle(ctx, boot, client));
  }
  function flush() {
    const ctx = account;
    if (!ctx || !F.auth.isVerified(ctx.uid)) return Promise.resolve(false);
    if (work) return work;
    announce('syncing');
    work = locked(ctx, false)
      .then(() => true)
      .catch(() => {
        if (account === ctx) {
          announce('error');
          schedule(delay);
          delay = Math.min(60000, delay * 2);
        }
        return false;
      })
      .finally(() => {
        work = null;
      });
    return work;
  }
  async function recover(uid, adapter) {
    const ctx = { ...adapter, uid };
    account = null;
    w.clearTimeout(timer);
    announce('syncing');
    try {
      await locked(ctx, true);
      account = ctx;
      announce(status);
    } catch (e) {
      announce('error');
      if (!F.auth.isVerified(uid) || e.sessionChanged) throw Object.assign(Error(), { sessionChanged: true });
      throw Error(
        'Não foi possível recuperar os dados da conta. Nada local foi descartado. Confira a conexão e tente novamente.',
      );
    }
  }
  w.addEventListener('online', () => {
    if (account) schedule(0);
    else F.retryBoot?.();
  });
  w.addEventListener('forja:auth', (e) => {
    if (account && e.detail.state === 'authenticated' && account.uid === e.detail.userId) schedule(250);
  });
  w.document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-sync-retry]')) void flush();
  });
  w.document.addEventListener('click', (e) => {
    if (
      !e.target.closest?.('[data-sync-export]') ||
      !account ||
      !F.auth.canWrite() ||
      !F.auth.isVerified(account.uid)
    )
      return;
    const content = storage.getItem(storageKey(account.uid, 'conflicts'));
    if (!content) return;
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const a = w.document.createElement('a');
    a.href = url;
    a.download = 'forja-versoes-preservadas.json';
    a.click();
    w.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  F.cloud = Object.freeze({
    recover,
    record,
    pendingFromPeer(uid) { changed(uid); },
    flush,
    get status() {
      return status;
    },
  });
})(window);
