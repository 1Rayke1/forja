/*
  FORJA — camada de persistência.

  Três responsabilidades, e só estas:

  1. `F.store`  — acesso ao meio de persistência por trás de um driver
     plugável (localStorage hoje; um adaptador de sincronização pode ser
     injetado com `F.store.useDriver(...)` sem tocar em nenhuma página).
     Cuida de leitura com parse seguro, escrita serializada, listagem por
     prefixo e transações de substituição com verificação e reversão.

  2. `F.registry` — registro das chaves do app. Cada chave declara como
     criar o vazio, como normalizar o que veio do disco e como validar o que
     chega de um backup. É a fonte única dessas regras: boot e importação
     usam exatamente o mesmo validador.

  3. `F.schema` — versão do formato de dados e execução das migrações
     pendentes. As políticas de cada migração são fornecidas pelo módulo de
     modelos (`forja-dados.js`); o runner decide o que precisa rodar, na
     ordem, e registra o resultado de forma auditável.

  Nada aqui toca em DOM além de `document.body[data-root]` (que nem é usado)
  e nada aqui conhece páginas específicas. Regras de negócio, cálculos e
  interface permanecem em seus próprios módulos.
*/
(function (global) {
  "use strict";

  const F = global.Forja;

  const STORAGE_PREFIX = "forja-";
  const MISSION_KEY_PATTERN = /^forja-missoes-\d{4}-\d{2}-\d{2}$/;

  /* ------------------------------------------------------------------ */
  /* Drivers                                                             */
  /* ------------------------------------------------------------------ */

  /*
    Driver padrão: localStorage do navegador. Toda falha do meio (modo
    privado, cota esgotada, storage desabilitado) é devolvida como resultado,
    nunca como exceção — quem chama decide como avisar o usuário.
  */
  function createLocalStorageDriver() {
    function backend() {
      try {
        return global.localStorage || null;
      } catch (error) {
        return null;
      }
    }

    return {
      id: "local-storage",
      available() {
        const storage = backend();
        return Boolean(storage) && typeof storage.getItem === "function";
      },
      getItem(key) {
        const storage = backend();
        if (!storage) throw new Error("Armazenamento do navegador indisponível.");
        return storage.getItem(key);
      },
      setItem(key, value) {
        const storage = backend();
        if (!storage) throw new Error("Armazenamento do navegador indisponível.");
        storage.setItem(key, value);
      },
      removeItem(key) {
        const storage = backend();
        if (!storage) throw new Error("Armazenamento do navegador indisponível.");
        storage.removeItem(key);
      },
      keys() {
        const storage = backend();
        const list = [];
        if (!storage) return list;

        try {
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (typeof key === "string") list.push(key);
          }
        } catch (error) {
          // Storage ilegível: a lista vazia é tratada como "sem dados".
        }

        return list;
      }
    };
  }

  /*
    Driver em memória, com a mesma interface. Usado pelos testes unitários e
    por qualquer ambiente sem localStorage. Serve também de referência para um
    futuro adaptador remoto: o contrato é apenas este.
  */
  function createMemoryDriver(initial) {
    const data = new Map();

    if (initial && typeof initial === "object") {
      Object.keys(initial).forEach(key => data.set(key, String(initial[key])));
    }

    return {
      id: "memory",
      available() { return true; },
      getItem(key) { return data.has(key) ? data.get(key) : null; },
      setItem(key, value) { data.set(key, String(value)); },
      removeItem(key) { data.delete(key); },
      keys() { return Array.from(data.keys()); }
    };
  }

  /* ------------------------------------------------------------------ */
  /* F.store                                                             */
  /* ------------------------------------------------------------------ */

  let activeDriver = null;
  const storeListeners = [];

  function driver() {
    if (!activeDriver) activeDriver = createLocalStorageDriver();
    return activeDriver;
  }

  function isQuotaError(error) {
    if (!error) return false;
    const name = String(error.name || "");
    return /quota/i.test(name) || /QuotaExceeded|NS_ERROR_DOM_QUOTA/i.test(String(error.message || ""));
  }

  function describeError(error, fallback) {
    if (!error) return fallback;
    if (isQuotaError(error)) return "O espaço de armazenamento do navegador está cheio.";
    return String(error.message || error).slice(0, 300) || fallback;
  }

  const store = F.store = {
    createLocalStorageDriver,
    createMemoryDriver,

    driver,
    useDriver(next) {
      activeDriver = next;
      return store;
    },
    /* Anúncio de escrita/remoção: usado pelas páginas para redesenhar sem
       depender de um segundo ciclo de atualização. */
    onChange(listener) {
      if (typeof listener === "function") storeListeners.push(listener);
      return () => {
        const index = storeListeners.indexOf(listener);
        if (index >= 0) storeListeners.splice(index, 1);
      };
    },
    notifyChanged(key) {
      storeListeners.forEach(listener => {
        try {
          listener(key);
        } catch (error) {
          console.error("Falha em ouvinte de armazenamento:", error);
        }
      });
    },

    available() {
      return driver().available();
    },

    /* Leitura crua + parse. `error` significa "existe, mas não é JSON". */
    read(key) {
      let raw = null;

      try {
        raw = driver().getItem(key);
      } catch (error) {
        return { exists: false, raw: null, value: null, error };
      }

      if (raw === null || raw === undefined) {
        return { exists: false, raw: null, value: null, error: null };
      }

      if (typeof raw !== "string") {
        return { exists: true, raw: "", value: null, error: new Error("Conteúdo não é texto.") };
      }

      try {
        return { exists: true, raw, value: JSON.parse(raw), error: null };
      } catch (error) {
        return { exists: true, raw, value: null, error };
      }
    },

    readRaw(key) {
      try {
        const value = driver().getItem(key);
        return typeof value === "string" ? value : null;
      } catch (error) {
        return null;
      }
    },

    writeRaw(key, raw) {
      try {
        driver().setItem(key, raw);
        store.notifyChanged(key);
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: describeError(error, "Falha ao gravar os dados.") };
      }
    },

    write(key, value) {
      let raw;

      try {
        raw = JSON.stringify(value);
      } catch (error) {
        return { ok: false, error: "Os dados não puderam ser serializados." };
      }

      if (typeof raw !== "string") {
        return { ok: false, error: "Os dados não puderam ser serializados." };
      }

      return store.writeRaw(key, raw);
    },

    remove(key) {
      try {
        driver().removeItem(key);
        store.notifyChanged(key);
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: describeError(error, "Falha ao atualizar o armazenamento.") };
      }
    },

    keys(prefix = STORAGE_PREFIX) {
      return driver().keys().filter(key => key.indexOf(prefix) === 0).sort();
    },

    /* Cópia textual (string por string) de todas as chaves do FORJA. */
    snapshot(options = {}) {
      const out = {};

      store.keys().forEach(key => {
        if (!options.includeSafety && key === F.KEYS.safety) return;
        const raw = store.readRaw(key);
        if (raw !== null) out[key] = raw;
      });

      return out;
    },

    /* Tamanho aproximado em uso, por chave, para a auditoria em Configurações. */
    usage() {
      const rows = [];
      let total = 0;

      store.keys().forEach(key => {
        const raw = store.readRaw(key);
        if (raw === null) return;
        const bytes = raw.length;
        total += bytes;
        rows.push({ key, bytes });
      });

      rows.sort((a, b) => b.bytes - a.bytes);
      return { rows, total };
    },

    /*
      Transação de substituição: grava o conjunto informado, remove as demais
      chaves do FORJA (exceto as protegidas) e confere o resultado lendo de
      volta. Em qualquer falha, reverte para o instantâneo entregue e devolve
      as chaves que não puderam ser revertidas.
    */
    applySet(keys, options = {}) {
      const protectedKeys = new Set(options.protect || []);
      const backup = store.snapshot({ includeSafety: true });
      const problems = [];
      const broken = new Set();

      Object.keys(keys).forEach(key => {
        if (protectedKeys.has(key)) return;

        try {
          driver().setItem(key, JSON.stringify(keys[key]));
        } catch (error) {
          broken.add(key);
          problems.push('Falha ao gravar "' + key + '": ' +
            describeError(error, "o navegador recusou a escrita."));
        }
      });

      /*
        Só há remoções depois de todas as gravações terem sido aceitas: assim
        uma cota esgotada no meio do caminho não deixa o usuário com metade dos
        dados apagados.
      */
      if (broken.size === 0) {
        store.keys().forEach(key => {
          if (protectedKeys.has(key)) return;
          if (Object.prototype.hasOwnProperty.call(keys, key)) return;

          try {
            driver().removeItem(key);
          } catch (error) {
            problems.push('Falha ao remover "' + key + '": ' +
              describeError(error, "o navegador recusou a remoção."));
          }
        });
      }

      /* Verificação: o que foi gravado precisa voltar parseável. */
      Object.keys(keys).forEach(key => {
        if (protectedKeys.has(key) || broken.has(key)) return;
        const after = store.read(key);

        if (!after.exists) {
          problems.push('A chave "' + key + '" não estava presente após a gravação.');
          return;
        }

        if (after.error) {
          problems.push('O conteúdo de "' + key + '" ficou ilegível após a gravação.');
        }
      });

      const written = Object.keys(keys).filter(key => !protectedKeys.has(key)).length;

      if (problems.length === 0) {
        store.notifyChanged(null);
        return { ok: true, failed: [], written, backup };
      }

      const rollback = restoreRaw(backup, protectedKeys);

      return {
        ok: false,
        failed: rollback.failedKeys,
        problems,
        backup,
        rollback,
        error: problems.join(" ")
      };
    },

    /* Restaura um instantâneo textual (usado no rollback e no "desfazer"). */
    restoreRaw(map, options = {}) {
      return restoreRaw(map, new Set(options.protect || []));
    }
  };

  function restoreRaw(map, protectedKeys) {
    const failedKeys = [];

    store.keys().forEach(key => {
      if (protectedKeys.has(key)) return;
      try {
        driver().removeItem(key);
      } catch (error) {
        failedKeys.push(key);
      }
    });

    Object.keys(map || {}).forEach(key => {
      if (protectedKeys.has(key)) return;
      try {
        driver().setItem(key, map[key]);
      } catch (error) {
        failedKeys.push(key);
      }
    });

    store.notifyChanged(null);
    return { ok: failedKeys.length === 0, failedKeys };
  }

  /* ------------------------------------------------------------------ */
  /* Primitivas usadas pelo resto do app (fachadas sobre F.store)        */
  /* ------------------------------------------------------------------ */

  F.parseStorageValue = function parseStorageValue(key) {
    return store.read(key);
  };

  F.saveJSON = function saveJSON(key, value) {
    const result = store.write(key, value);

    if (!result.ok) {
      F.showToast(
        "Não foi possível salvar. " + result.error + " Verifique o espaço disponível no navegador.",
        "error",
        5000
      );
      return false;
    }

    return true;
  };

  F.removeStorageKey = function removeStorageKey(key) {
    const result = store.remove(key);

    if (!result.ok) {
      F.showToast("Não foi possível atualizar o armazenamento do navegador.", "error");
      return false;
    }

    return true;
  };

  /*
    Guarda uma cópia de conteúdo ilegível ou não reconhecido antes de qualquer
    normalização. Itens idênticos (chave + conteúdo) não são arquivados duas
    vezes; a lista é limitada para não crescer sem controle.
  */
  const PRESERVED_LIMIT = 40;

  F.archivePreservedValue = function archivePreservedValue(key, raw, reason) {
    const stored = store.read(F.KEYS.preserved);
    const list = stored.exists && Array.isArray(stored.value) ? stored.value.slice() : [];
    const rawString = typeof raw === "string" ? raw : JSON.stringify(raw);

    const existingIndex = list.findIndex(item => {
      return F.isPlainObject(item) && item.key === key && item.raw === rawString;
    });

    if (existingIndex >= 0) list.splice(existingIndex, 1);

    list.unshift({
      archivedAt: new Date().toISOString(),
      key,
      reason,
      raw: rawString
    });

    const result = store.write(F.KEYS.preserved, list.slice(0, PRESERVED_LIMIT));

    if (!result.ok) {
      F.showToast("Não foi possível preservar o conteúdo ilegível: " + result.error, "error", 6000);
    }

    return result.ok;
  };

  F.readPreservedValues = function readPreservedValues() {
    const stored = store.read(F.KEYS.preserved);

    if (!stored.exists || stored.error || !Array.isArray(stored.value)) return [];

    return stored.value.filter(F.isPlainObject);
  };

  F.recordMigration = function recordMigration(details) {
    const stored = store.read(F.KEYS.migration);
    const current = stored.exists && F.isPlainObject(stored.value) ? stored.value : {};

    const next = {
      ...current,
      version: F.DATA_VERSION,
      dataVersion: F.DATA_VERSION,
      updatedAt: new Date().toISOString(),
      ...details
    };

    const result = store.write(F.KEYS.migration, next);
    return result.ok;
  };

  F.readMigrationRecord = function readMigrationRecord() {
    const stored = store.read(F.KEYS.migration);

    if (!stored.exists || stored.error || !F.isPlainObject(stored.value)) return null;
    return stored.value;
  };

  /* ------------------------------------------------------------------ */
  /* F.registry — uma descrição por chave                                */
  /* ------------------------------------------------------------------ */

  const descriptors = new Map();
  const ordered = [];

  F.registry = {
    /*
      id        nome estável (ex.: "rotinas")
      key       chave de armazenamento
      empty()   valor vazio usado quando não há dados
      load(raw, ctx)  -> { value, notices, archive }  normalização no boot
      validate(value) -> true ou lança Error          usado pelo backup
      summarize(value, ctx) -> { label, detail }       usado pelo preview do backup
    */
    register(definition) {
      if (!definition || !definition.id || !definition.key) {
        throw new Error("Descrição de chave sem id ou key.");
      }

      if (!descriptors.has(definition.id)) ordered.push(definition.id);
      descriptors.set(definition.id, definition);
      return definition;
    },
    get(id) {
      return descriptors.get(id) || null;
    },
    list() {
      return ordered.map(id => descriptors.get(id));
    },
    byKey(key) {
      return ordered.reduce((found, id) => {
        if (found) return found;
        return descriptors.get(id).key === key ? descriptors.get(id) : null;
      }, null);
    },
    /* Toda chave conhecida, incluindo as de missão (padrão, não registradas). */
    isKnownKey(key) {
      if (MISSION_KEY_PATTERN.test(key)) return true;
      return ordered.some(id => descriptors.get(id).key === key);
    },
    /*
      Validação usada pela importação de backup. Chave desconhecida com o
      prefixo do app não é rejeitada: o comportamento histórico é preservar o
      conteúdo tal como veio (ele só não tem efeito visual). Chave conhecida é
      validada pela mesma regra que o boot usa.
    */
    validateKey(key, value) {
      if (MISSION_KEY_PATTERN.test(key)) {
        return F.validateMissionList ? F.validateMissionList(key, value) : true;
      }

      const spec = F.registry.byKey(key);

      if (!spec) return true;
      if (typeof spec.validate !== "function") return true;
      return spec.validate(value);
    },
    summarizeKey(key, value, ctx) {
      if (MISSION_KEY_PATTERN.test(key)) {
        return F.summarizeMissionList ? F.summarizeMissionList(key, value) : null;
      }

      const spec = F.registry.byKey(key);
      if (!spec || typeof spec.summarize !== "function") return null;
      return spec.summarize(value, ctx);
    }
  };

  F.STORAGE_PREFIX = STORAGE_PREFIX;
  F.MISSION_KEY_PATTERN = MISSION_KEY_PATTERN;

  /* ------------------------------------------------------------------ */
  /* F.schema — versão e migrações                                       */
  /* ------------------------------------------------------------------ */

  /*
    Versões do formato de dados:

      1  exercícios por modalidade em `forja-treino-exercicios-v1`
      2  rotinas por modalidade + sessão `version: 2` + histórico estendido
      3  modelo de exercício com medição (carga/duração/distância), metadados
         de catálogo, metas semanais e sessão com `revision: 3` (aditivo)

    Uma instalação no versão 3 é retrocompatível com a 2 porque os campos
    novos são opcionais e têm padrão na leitura.
  */
  F.DATA_VERSION = 3;

  const migrations = [];

  F.schema = {
    register(definition) {
      if (!definition || !definition.from || !definition.to || typeof definition.apply !== "function") {
        throw new Error("Migração sem from/to/apply.");
      }

      migrations.push(definition);
      migrations.sort((a, b) => a.from - b.from || a.to - b.to);
      return definition;
    },
    list() {
      return migrations.slice();
    },
    /*
      Detecta a versão real do armazenamento. O registro de migração é a
      autoridade quando existe; sem ele, a presença/ausência das chaves
      antigas define o ponto de partida. Retorna `null` quando não há nada
      do FORJA para migrar (evita escrever em uma instalação vazia).
    */
    detect(context) {
      const record = F.readMigrationRecord();

      if (record) {
        const version = Number(record.dataVersion || record.version) || 1;
        return Math.max(1, Math.min(version, F.DATA_VERSION));
      }

      /*
        Sem registro de migração, a versão é inferida pelo que existe no
        armazenamento — e sempre pelo piso: dados antigos ainda presentes
        significam que alguma promoção continua pendente, mesmo que outras
        chaves já estejam no formato novo.
      */
      if (context.has(F.KEYS.routines)) return 2;
      if (context.has(F.KEYS.legacyExercises)) return 1;
      if (context.has(F.KEYS.history)) return 2;

      return F.DATA_VERSION;
    },
    pending(version) {
      if (!Number.isFinite(version)) return [];
      return migrations.filter(migration => migration.from >= version);
    },
    /*
      Executa, em ordem, as migrações com `from >= version`. Cada migração
      devolve { dirty: [ids gravados], notes: [avisos], record: {...} } e é
      responsável por não destruir nada: o que não reconhecer é arquivado.
    */
    run(context) {
      const detected = F.schema.detect(context);
      const notices = [];
      const applied = [];
      let dirty = [];
      let recordPatch = {};
      let blocked = null;

      migrations.forEach(migration => {
        if (blocked) return;
        if (migration.from < detected) return;
        if (typeof migration.applies === "function" && !migration.applies(context)) return;

        let outcome = null;

        try {
          outcome = migration.apply(context) || {};
        } catch (error) {
          blocked = describeError(error, "A migração não pôde ser concluída.");
          return;
        }

        if (outcome.notices && outcome.notices.length) notices.push(...outcome.notices);
        if (outcome.dirty && outcome.dirty.length) dirty = dirty.concat(outcome.dirty);
        if (outcome.record) recordPatch = { ...recordPatch, ...outcome.record };
        applied.push({ id: migration.id, from: migration.from, to: migration.to });
      });

      return {
        from: detected,
        to: F.DATA_VERSION,
        applied,
        dirty: Array.from(new Set(dirty)),
        notices,
        recordPatch,
        blocked
      };
    }
  };

  /* Utilitário usado pelas migrações e pelo repositório. */
  F.storeHas = function storeHas(key) {
    return store.read(key).exists;
  };
})(window);
