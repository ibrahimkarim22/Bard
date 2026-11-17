const { createHighlightStoreManager } = require('./readerHighlightStore');
const { prefixFor, utf8Length } = require('./readerHighlights');
const DEFAULT_CONFIGURATION = Object.freeze({ enabled: false, storageMode: 'legacy-v1', migrationApproved: false });
const ACCOUNT_NAMESPACE = '@bard/reader-highlights-sync:account-v2';
const fail = code => Object.assign(new Error(code), { code });
const frozen = value => Object.freeze(value);
const emptyAccount = () => frozen({ hydrated: false, loading: false, error: null, works: frozen([]) });
const emptyRaw = () => frozen({ hydrated: false, loading: false, saving: false, error: null, readError: null, writeBlocked: false, entries: frozen([]), count: 0 });
const EMPTY_WORK = frozen({ hydrated: false, loading: false, saving: false, error: null, readError: null, writeBlocked: false,
  records: frozen([]), unresolved: frozen([]), unreadable: frozen([]), conflicts: frozen([]), tombstones: frozen([]), syncById: frozen({}), syncSummary: frozen({}) });
const errorState = error => frozen({ code: error?.code || 'READ_FAILED', message: 'Highlights could not be loaded. Saved data is retained.', retryable: true });

// This is the normal application's adapter, shared by the reader and drawer.
// Backend injection is for isolated integration tests; the application singleton
// supplies the separately branded production factory, never the demo factory.
function createNormalHighlightRuntime({ storage, configuration = DEFAULT_CONFIGURATION, createBackend, resolveCanonical,
  storeOptions = {}, coordinatorOptions = {} } = {}) {
  if (!configuration || typeof configuration.enabled !== 'boolean' || typeof configuration.migrationApproved !== 'boolean'
      || !['legacy-v1', 'durable-v2'].includes(configuration.storageMode)
      || configuration.storageMode === 'legacy-v1' && (configuration.enabled || configuration.migrationApproved)) throw fail('SYNC_ACTIVATION_REQUIRED');
  const storageMode = configuration.storageMode, enabled = configuration.enabled;
  const listeners = new Set(), accounts = new Map(), rawViews = new Map(), workViews = new Map();
  const blockedAccounts = new Set(), permanentlyBlockedAccounts = new Set(), purges = new Map();
  let uid = null, generation = 0, disposed = false, coordinator = null, manager, backendPromise = null;
  let snapshot = frozen({ uid, ownerGeneration: generation, storageMode, enabled, running: false, pending: 0, error: null, discoveryLoading: false, discoveryError: null, works: frozen([]) });
  function publish() {
    const state = coordinator?.getSnapshot() || {};
    snapshot = frozen({ ...snapshot, ...state, uid, ownerGeneration: generation, storageMode, enabled });
    for (const listener of listeners) { try { listener(); } catch (_) {} }
  }
  const currentOwner = (owner, epoch) => !disposed && !blockedAccounts.has(owner) && uid === owner && generation === epoch;
  function guardFor(owner, options) {
    const epoch = generation;
    return () => currentOwner(owner, epoch) && (!options?.isCurrent || options.isCurrent());
  }
  const check = guard => { if (!guard()) throw fail('CANCELLED'); };
  function getBackend() {
    if (!enabled) return Promise.reject(fail('SYNC_PRODUCTION_DISABLED'));
    if (!backendPromise) {
      backendPromise = Promise.resolve().then(() => {
        if (disposed || typeof createBackend !== 'function') throw fail('SYNC_BACKEND_UNAVAILABLE');
        return createBackend();
      }).then(backend => {
        if (!backend || typeof (backend.commit || backend.submit) !== 'function' || typeof backend.listen !== 'function' || typeof backend.listenWorks !== 'function') throw fail('SYNC_BACKEND_UNAVAILABLE');
        return backend;
      }).catch(error => { backendPromise = null; throw error; });
    }
    return backendPromise;
  }
  function lazyListen(method, args) {
    let closed = false, unsubscribe = null;
    const onError = args[method === 'listenWorks' ? 2 : 3];
    getBackend().then(backend => { if (!closed && !disposed) unsubscribe = backend[method](...args); }, error => { if (!closed && !disposed) onError?.(error); });
    return () => { closed = true; unsubscribe?.(); };
  }
  let core;
  if (storageMode === 'legacy-v1') {
    // In this branch no sync store, coordinator, Firebase, or migration module
    // is initialized. Existing normal v1 bytes/behavior remain authoritative.
    core = createHighlightStoreManager(storage, storeOptions);
    manager = { forWork: core.forWork, forAccount: core.forAccount, forStoredWork: core.forStoredWork };
  } else {
    core = require('./highlightSyncStore').createHighlightSyncStoreManagerForNamespace(storage, {
      ...storeOptions, namespace: ACCOUNT_NAMESPACE, legacyPrefixFor: prefixFor, migrateLegacy: configuration.migrationApproved,
    });
    if (enabled) {
      const transport = {
        async commit(operation, options) {
          if (options?.isCurrent && !options.isCurrent()) throw fail('CANCELLED');
          const backend = await getBackend();
          if (options?.isCurrent && !options.isCurrent()) throw fail('CANCELLED');
          return (backend.commit || backend.submit).call(backend, operation, options);
        },
        listen: (...args) => lazyListen('listen', args),
        listenWorks: (...args) => lazyListen('listenWorks', args),
      };
      coordinator = require('./highlightSyncCoordinator').createHighlightSyncCoordinator({
        ...coordinatorOptions, manager: core, transport, resolveCanonical: async workId => {
          if (typeof resolveCanonical !== 'function') throw fail('SYNC_INVALID_STATE');
          return resolveCanonical(workId);
        },
      });
      coordinator.subscribe(() => {
        publish();
        for (const account of accounts.values()) account.schedule();
      });
    }
    function forAccount({ uid: owner }) {
      prefixFor(owner, 'x');
      if (blockedAccounts.has(owner)) throw fail('ACCOUNT_DELETION_BLOCKED');
      if (accounts.has(owner)) return accounts.get(owner).store;
      const view = { owner, snapshot: emptyAccount(), listeners: new Set(), tail: Promise.resolve(), scheduled: false, store: null };
      const publishView = () => { for (const listener of view.listeners) { try { listener(); } catch (_) {} } };
      const enqueue = run => { const task = view.tail.then(run); view.tail = task.catch(() => {}); return task; };
      async function refresh(options) {
        const guard = guardFor(owner, options); check(guard);
        view.snapshot = frozen({ ...view.snapshot, loading: true }); publishView();
        try {
          const local = await core.readLocalWorkCatalogue(owner, { isCurrent: guard }); check(guard);
          const cached = await core.readWorkCatalogue(owner, { isCurrent: guard }); check(guard);
          const remoteState = coordinator?.getSnapshot();
          const remote = remoteState?.uid === owner && !remoteState.discoveryLoading ? remoteState.works : cached;
          const rows = new Map(local.map(row => [row.workKey, { ...row, localCount: row.count, remoteCount: null }]));
          for (const remoteWork of remote || []) {
            const workKey = encodeURIComponent(remoteWork.workId);
            const localWork = rows.get(workKey);
            rows.set(workKey, { ...(localWork || { workId: remoteWork.workId, workKey, count: 0, localCount: 0, pendingCount: 0, unavailableCount: 0, localOnlyCount: 0 }),
              remoteCount: remoteWork.metadata.activeCount });
          }
          const works = [...rows.values()].map(row => {
            // A partially cached work and a delayed own listener echo cannot be
            // summed accurately. Expose both measured counts while pending.
            const pending = row.pendingCount > 0 || row.localOnlyCount > row.unavailableCount;
            const count = row.remoteCount === null ? row.localCount : pending ? Math.max(row.localCount, row.remoteCount) : row.remoteCount + row.unavailableCount;
            const countDescription = row.remoteCount !== null && pending
              ? row.localCount + ' on this device \u00b7 ' + row.remoteCount + ' last confirmed remotely'
              : row.remoteCount !== null && row.unavailableCount > 0
                ? row.remoteCount + ' last confirmed remotely \u00b7 ' + row.unavailableCount + ' unavailable on this device' : undefined;
            return frozen({ ...row, count, countDescription });
          }).filter(row => row.count > 0).sort((a,b) => a.workKey.localeCompare(b.workKey));
          view.snapshot = frozen({ hydrated: true, loading: false, error: null, works: frozen(works) });
          publishView(); return view.snapshot;
        } catch (error) {
          if (guard()) { view.snapshot = frozen({ ...view.snapshot, loading: false, error: errorState(error) }); publishView(); }
          throw error;
        }
      }
      view.schedule = () => {
        if (view.scheduled || uid !== owner || disposed) return;
        view.scheduled = true;
        queueMicrotask(() => { view.scheduled = false; if (uid === owner && !disposed) view.store.refreshReadOnly().catch(() => {}); });
      };
      core.subscribeCatalogue(owner, view.schedule);
      view.store = {
        getSnapshot: () => view.snapshot,
        subscribe(listener) { view.listeners.add(listener); return () => view.listeners.delete(listener); },
        hydrate: options => enqueue(() => refresh(options)),
        refreshReadOnly: options => enqueue(() => refresh(options)),
      };
      view.clear = () => { view.snapshot = emptyAccount(); publishView(); };
      accounts.set(owner, view);
      return view.store;
    }
    function forStoredWork({ uid: owner, workKey }) {
      prefixFor(owner, 'x');
      if (blockedAccounts.has(owner)) throw fail('ACCOUNT_DELETION_BLOCKED');
      if (typeof workKey !== 'string' || workKey.includes('/')) throw fail('INVALID_HIGHLIGHT');
      const scopeKey = JSON.stringify([owner, workKey]);
      if (rawViews.has(scopeKey)) return rawViews.get(scopeKey).store;
      const view = { owner, snapshot: emptyRaw(), raw: new Map(), listeners: new Set(), tail: Promise.resolve(), scheduled: false };
      const publishView = () => { for (const listener of view.listeners) { try { listener(); } catch (_) {} } };
      const enqueue = run => { const task = view.tail.then(run); view.tail = task.catch(() => {}); return task; };
      async function refresh(options) {
        const guard = guardFor(owner, options); check(guard);
        view.snapshot = frozen({ ...view.snapshot, loading: true }); publishView();
        try {
          const source = await core.readRawWork({ uid: owner, workKey }, { isCurrent: guard }); check(guard);
          view.raw = new Map(source.entries.map(entry => [('unavailable-entry:'.padEnd(129, '!') + entry.key), entry]));
          const entries = [...view.raw].map(([id, entry]) => frozen({ id, key: entry.key, bytes: utf8Length(entry.raw), code: 'INVALID_HIGHLIGHT' }));
          view.snapshot = frozen({ ...source, entries: frozen(entries), hydrated: true, loading: false, count: entries.length });
          publishView(); return view.snapshot;
        } catch (error) {
          if (guard()) { view.snapshot = frozen({ ...view.snapshot, loading: false, readError: errorState(error) }); publishView(); }
          throw error;
        }
      }
      view.store = {
        getSnapshot: () => view.snapshot,
        subscribe(listener) { view.listeners.add(listener); return () => view.listeners.delete(listener); },
        hydrate: options => enqueue(() => refresh(options)),
        refreshReadOnly: options => enqueue(() => refresh(options)),
        remove: (id, options) => enqueue(async () => {
          const guard = guardFor(owner, options); check(guard);
          const entry = view.raw.get(id); if (!entry) throw fail('NOT_FOUND');
          try { await core.retireRawEntry({ uid: owner, workKey, key: entry.key, raw: entry.raw }, { isCurrent: guard }); }
          finally { if (guard()) await refresh(options); }
          check(guard); return true;
        }),
        retry: options => enqueue(async () => {
          const guard = guardFor(owner, options); check(guard);
          await core.retryRawWork({ uid: owner, workKey }, { isCurrent: guard }); return refresh(options);
        }),
        abandonPendingIntent() { check(guardFor(owner)); core.abandonRawIntent({ uid: owner, workKey }); },
        flush: () => view.tail,
      };
      core.subscribeCatalogue(owner, () => {
        if (view.scheduled || uid !== owner || disposed) return;
        view.scheduled = true; queueMicrotask(() => { view.scheduled = false; if (uid === owner && !disposed) view.store.refreshReadOnly().catch(() => {}); });
      });
      view.clear = () => { view.raw.clear(); view.snapshot = emptyRaw(); publishView(); };
      rawViews.set(scopeKey, view); return view.store;
    }
    function forWork(scope) {
      const source = core.forWork(scope), owner = scope.uid, epoch = generation;
      const key = JSON.stringify([owner, epoch, scope.canonical.workId, scope.canonical.contentVersion, scope.canonical.canonicalTextVersion]);
      if (workViews.has(key)) return workViews.get(key);
      const owns = () => currentOwner(owner, epoch);
      const view = {
        getSnapshot: () => owns() ? source.getSnapshot() : EMPTY_WORK,
        pendingOperations: () => owns() ? source.pendingOperations() : [],
        subscribe(listener) { const unsubscribe = source.subscribe(listener); listeners.add(listener); return () => { unsubscribe(); listeners.delete(listener); }; },
        abandonPendingIntent() { check(owns); source.abandonPendingIntent(); },
        flush: () => source.flush(),
      };
      const optionPosition = { hydrate: 0, refreshReadOnly: 0, retry: 0, create: 2, recolor: 2, remove: 1, resolveConflict: 2, recreate: 2 };
      for (const [method, position] of Object.entries(optionPosition)) view[method] = async (...args) => {
        const previous = args[position], guard = () => owns() && (!previous?.isCurrent || previous.isCurrent());
        check(guard); args[position] = { ...previous, isCurrent: guard };
        const result = await source[method](...args); check(guard); return result;
      };
      workViews.set(key, view); return view;
    }
    manager = { forWork, forAccount, forStoredWork };
  }
  async function setOwner(next) {
    if (disposed) throw fail('CANCELLED');
    if (next !== null) prefixFor(next, 'x');
    if (blockedAccounts.has(next)) throw fail('ACCOUNT_DELETION_BLOCKED');
    if (uid === next) return coordinator?.setOwner(next);
    uid = next; generation++;
    for (const view of [...accounts.values(), ...rawViews.values()]) view.clear();
    publish();
    await coordinator?.setOwner(next);
  }
  async function openWork(canonical) {
    if (disposed || !uid) throw fail('CANCELLED');
    const owner = uid, guard = guardFor(owner);
    if (coordinator) await coordinator.openWork(canonical);
    check(guard);
    const store = manager.forWork({ uid: owner, canonical });
    if (storageMode === 'durable-v2') await store.hydrate();
    check(guard);
    return store;
  }
  function blockAccount(owner) {
    prefixFor(owner, 'x');
    if (blockedAccounts.has(owner)) return;
    blockedAccounts.add(owner);
    if (uid === owner) {
      uid = null; generation++;
      // setOwner retires listeners and local acknowledgements synchronously;
      // deletion never waits for an outstanding network submission to settle.
      coordinator?.setOwner(null)?.catch(() => {});
    }
    for (const view of [...accounts.values(), ...rawViews.values()]) if (view.owner === owner) view.clear();
    (core || manager).blockAccount(owner);
    publish();
  }
  async function drainLocalAccount(owner) {
    await Promise.all([(core || manager).drainAccount(owner),
      ...[...accounts.values(), ...rawViews.values()].filter(view => view.owner === owner).map(view => view.tail)]);
  }
  function clearAccountViews(owner) {
    for (const map of [accounts, rawViews]) for (const [key, view] of map) if (view.owner === owner) { view.clear(); map.delete(key); }
    for (const key of workViews.keys()) if (JSON.parse(key)[0] === owner) workViews.delete(key);
  }
  function accountKey(key, owner) {
    const encoded = encodeURIComponent(owner);
    return key.startsWith('@bard/reader-highlights:v1/' + encoded + '/')
      || ['v2', 'legacy', 'retired', 'recovery'].some(kind => key.startsWith(ACCOUNT_NAMESPACE + '/' + kind + '/' + encoded + '/'))
      || key === ACCOUNT_NAMESPACE + '/catalogue/' + encoded;
  }
  async function purgeAccount(owner) {
    blockAccount(owner); permanentlyBlockedAccounts.add(owner);
    if (purges.has(owner)) return purges.get(owner);
    const task = (async () => {
      await drainLocalAccount(owner);
      (core || manager).clearAccount(owner); clearAccountViews(owner);
      if (!storage || typeof storage.getAllKeys !== 'function' || typeof storage.removeItem !== 'function') throw fail('ACCOUNT_DELETION_CLEANUP_FAILED');
      const keys = await storage.getAllKeys();
      if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw fail('ACCOUNT_DELETION_CLEANUP_FAILED');
      for (const key of new Set(keys)) if (accountKey(key, owner)) await storage.removeItem(key);
      const remaining = await storage.getAllKeys();
      if (!Array.isArray(remaining) || remaining.some(key => typeof key !== 'string' || accountKey(key, owner))) throw fail('ACCOUNT_DELETION_CLEANUP_FAILED');
      return true;
    })().catch(error => { if (error.code === 'ACCOUNT_DELETION_CLEANUP_FAILED') throw error; throw Object.assign(fail('ACCOUNT_DELETION_CLEANUP_FAILED'), { cause: error }); });
    purges.set(owner, task);
    try { return await task; } finally { if (purges.get(owner) === task) purges.delete(owner); }
  }
  async function unblockAccount(owner) {
    prefixFor(owner, 'x');
    if (permanentlyBlockedAccounts.has(owner)) throw fail('ACCOUNT_DELETION_PERMANENT');
    if (!blockedAccounts.has(owner)) return;
    await drainLocalAccount(owner);
    await (core || manager).unblockAccount(owner, () => !permanentlyBlockedAccounts.has(owner));
    if (permanentlyBlockedAccounts.has(owner)) throw fail('ACCOUNT_DELETION_PERMANENT');
    clearAccountViews(owner); blockedAccounts.delete(owner);
  }
  function dispose() { if (disposed) return; disposed = true; uid = null; generation++; coordinator?.dispose(); for (const view of [...accounts.values(), ...rawViews.values()]) view.clear(); publish(); listeners.clear(); }
  return { manager, coordinator, storageMode, enabled, setOwner, openWork, blockAccount, purgeAccount, unblockAccount,
    refreshReadOnly: () => coordinator?.refreshReadOnly?.() || Promise.resolve(),
    retry: () => coordinator?.retry() || Promise.resolve(),
    foreground: () => coordinator?.foreground() || Promise.resolve(),
    flush: () => coordinator?.flush() || Promise.resolve(),
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose };
}

module.exports = { createNormalHighlightRuntime, DEFAULT_CONFIGURATION, ACCOUNT_NAMESPACE };
