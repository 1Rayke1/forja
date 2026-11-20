/* Codec v1. Only persisted domain keys enter here (never SDK storage or drafts).
   Rows are compared without transport revisions; JSONB object order is immaterial. */
(function (F) {
  'use strict';
  const K = F.KEYS,
    modes = ['calisthenics', 'weights'];
  const single = new Set(['profiles', 'user_settings', 'user_preferences']);
  const tables = [...single, 'goals', 'routines', 'activity_history', 'progress_entries'];
  const obj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const stable = (x) =>
    JSON.stringify(x, (_, v) =>
      obj(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, v[k]]),
          )
        : v,
    );
  const same = (a, b) => a === b || stable(a) === stable(b);
  const address = (table, id = '') => JSON.stringify([table, id]);
  // Legacy history had no mandatory id. Keep its bytes/model intact and use a
  // repeatable storage identity; a collision falls back to the intact collection.
  function recordId(record) {
    if (record.id != null) return record.id;
    let a = 2166136261,
      b = 5381;
    for (const char of stable(record)) {
      a = Math.imul(a ^ char.codePointAt(0), 16777619);
      b = Math.imul(b, 33) ^ char.codePointAt(0);
    }
    return `legacy-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
  }
  function encode(raw) {
    const rows = {},
      extras = {},
      preferences = {},
      collections = {};
    for (const [key, text] of Object.entries(raw)) {
      if (!F.isAccountDataKey(key) || key === K.safety) continue;
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        extras[key] = { text };
        continue;
      }
      const put = (table, id, data) => {
        rows[address(table, id)] = data;
      };
      if (key === K.profile && obj(value)) put('profiles', '', value);
      else if (key === K.goals && obj(value)) put('goals', 'weekly', value);
      else if (key === K.active && obj(value)) put('progress_entries', '@active', { value });
      else if ([K.preferences, 'forja-planejamento-preferencias-v1'].includes(key)) preferences[key] = value;
      else if (key === K.history || key === K.routines) {
        const history = key === K.history;
        const lists = history ? [[null, value]] : modes.map((m) => [m, value?.[m]]);
        const ids = new Set();
        // Malformed/older collection shapes still round-trip as an opaque original.
        if (
          (!history && Object.keys(value || {}).some((k) => !modes.includes(k))) ||
          !lists.every(
            ([, list]) =>
              Array.isArray(list) &&
              list.every((r) => {
                if (!obj(r)) return false;
                const id = recordId(r);
                if (
                  typeof id !== 'string' ||
                  !id.length ||
                  id === '@active' ||
                  [...id].length > 160 ||
                  ids.has(id)
                )
                  return false;
                ids.add(id);
                return true;
              }),
          )
        ) {
          extras[key] = { text };
          continue;
        }
        collections[key] = true;
        lists.forEach(([mode, list]) =>
          list.forEach((record, index) => {
            put(history ? 'activity_history' : 'routines', recordId(record), { record, mode, index });
            // History remains self-contained after a partially acknowledged batch.
            if (history)
              put('progress_entries', recordId(record), {
                metrics: record.totals || {},
                completedSets: record.completedSets ?? 0,
                date: record.finishedAt || record.date || null,
              });
          }),
        );
      } else extras[key] = { value };
    }
    if (Object.keys(preferences).length) rows[address('user_preferences')] = preferences;
    if (Object.keys(extras).length || Object.keys(collections).length)
      rows[address('user_settings')] = { extras, collections };
    return rows;
  }
  function decode(rows) {
    const raw = {},
      routines = { calisthenics: [], weights: [] },
      history = [];
    const settings = rows[address('user_settings')] || {};
    const allowed = (k) => F.isAccountDataKey(k) && k !== K.safety;
    for (const [k, v] of Object.entries(settings.extras || {})) {
      if (!allowed(k)) throw Error('Chave remota inválida.');
      raw[k] = typeof v.text === 'string' ? v.text : JSON.stringify(v.value);
    }
    for (const [k, v] of Object.entries(rows[address('user_preferences')] || {})) {
      if (!allowed(k)) throw Error('Preferência inválida.');
      raw[k] = JSON.stringify(v);
    }
    for (const [key, data] of Object.entries(rows)) {
      const [table, id] = JSON.parse(key);
      if (table === 'profiles') raw[K.profile] = JSON.stringify(data);
      if (table === 'goals' && id === 'weekly') raw[K.goals] = JSON.stringify(data);
      if (table === 'progress_entries' && id === '@active' && 'value' in data)
        raw[K.active] = JSON.stringify(data.value);
      if (table === 'routines') routines[data.mode].push(data);
      if (table === 'activity_history') history.push(data);
    }
    const ordered = (arr) =>
      arr
        .sort((a, b) => a.index - b.index || recordId(a.record).localeCompare(recordId(b.record)))
        .map((x) => x.record);
    if (history.length || settings.collections?.[K.history])
      raw[K.history] = JSON.stringify(ordered(history));
    if (modes.some((m) => routines[m].length) || settings.collections?.[K.routines])
      raw[K.routines] = JSON.stringify(Object.fromEntries(modes.map((m) => [m, ordered(routines[m])])));
    return raw;
  }
  // Three-way merge. Missing is a deletion only when there is a common ancestor.
  // Divergent leaves keep the server value; the caller archives both alternatives.
  function merge(base, local, remote, conflict) {
    if (same(local, remote) || same(remote, base)) return local;
    if (same(local, base)) return remote;
    if (obj(local) && obj(remote) && (base === undefined || obj(base))) {
      const out = Object.create(null);
      for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
        const own = (o) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
        const v = merge(own(base), own(local), own(remote), conflict);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    if (
      Array.isArray(local) &&
      Array.isArray(remote) &&
      (base === undefined || Array.isArray(base)) &&
      [local, remote, base || []].every(
        (a) =>
          a.every((x) => obj(x) && typeof x.id === 'string') && new Set(a.map((x) => x.id)).size === a.length,
      )
    ) {
      const map = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
      return Object.values(merge(map(base || []), map(local), map(remote), conflict));
    }
    conflict();
    // Deletion against an edit: preserve alternatives in the conflict archive,
    // but do not resurrect the item in the active collection.
    return base !== undefined && (local === undefined || remote === undefined) ? undefined : remote;
  }
  // Record IDs/field names only, never deleted payloads. For a pre-v1 cache
  // with no ancestor these paths distinguish old data from a new local item.
  function children(node) {
    if (obj(node)) return Object.entries(node);
    if (Array.isArray(node) && node.every((v) => obj(v) && typeof v.id === 'string'))
      return node.map((v) => [v.id, v]);
    return [];
  }
  function removedPaths(before, after, path, out) {
    if (same(before, after)) return;
    const next = new Map(children(after));
    for (const [key, value] of children(before)) {
      const p = [...path, key];
      if (!next.has(key)) out[JSON.stringify(p)] = true;
      else removedPaths(value, next.get(key), p, out);
    }
  }
  function pruneMissing(local, remote, path, archive) {
    let value = local,
      server = remote;
    for (const [index, key] of path.entries()) {
      const child = (o, k) =>
        Array.isArray(o) ? o.find((v) => v?.id === k) : obj(o) && Object.hasOwn(o, k) ? o[k] : undefined;
      const found = child(value, key);
      if (found === undefined) return;
      server = child(server, key);
      if (index === path.length - 1 && server === undefined) {
        archive(found);
        if (Array.isArray(value)) value.splice(value.indexOf(found), 1);
        else delete value[key];
      } else value = found;
    }
  }
  F.cloudCodec = Object.freeze({
    encode,
    decode,
    merge,
    same,
    stable,
    address,
    single,
    tables,
    removedPaths,
    pruneMissing,
  });
})(window.Forja);
