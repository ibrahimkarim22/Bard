const assert = require('node:assert/strict');
const test = require('node:test');
const { canonical, ref, storageFixture, deferred } = require('../reader/highlightSyncFixture.cjs');
const { createNormalHighlightRuntime, ACCOUNT_NAMESPACE } = require('../../reader/normalHighlightRuntime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const legacy = uid => '@bard/reader-highlights:v1/' + encodeURIComponent(uid) + '/';
const owned = (key, uid) => [legacy(uid), ...['v2', 'legacy', 'retired', 'recovery'].map(kind => ACCOUNT_NAMESPACE + '/' + kind + '/' + encodeURIComponent(uid) + '/')].some(prefix => key.startsWith(prefix)) || key === ACCOUNT_NAMESPACE + '/catalogue/' + encodeURIComponent(uid);
function runtimeFor(storage, mode = 'durable-v2', extra = {}) {
  let next = 0;
  return createNormalHighlightRuntime({ storage, configuration: { enabled: false, storageMode: mode, migrationApproved: mode === 'durable-v2' },
    storeOptions: { makeId: () => 'local-' + ++next, now: () => 1000 }, ...extra });
}
function delayedWrites(fixture, matches) {
  const started = deferred(), release = deferred(), original = fixture.storage.setItem;
  fixture.storage.setItem = async (key, value) => { if (matches(key)) { started.resolve(); await release.promise; } return original(key, value); };
  return { started, release };
}

for (const mode of ['legacy-v1', 'durable-v2']) {
  test(mode + ' deletion waits for a delayed local write and fences queued and retired callbacks', async () => {
    const f = storageFixture({ [legacy('bob') + 'hamlet/other']: 'preserved', 'reader:preferences': 'global' });
    const runtime = runtimeFor(f.storage, mode);
    assert.equal(typeof runtime.blockAccount, 'function');
    await runtime.setOwner('alice');
    const work = runtime.manager.forWork({ uid: 'alice', canonical }); await work.hydrate();
    const gate = delayedWrites(f, key => owned(key, 'alice'));
    const first = work.create(ref(), 'yellow'); first.catch(() => {}); await gate.started.promise;
    const queued = work.create(ref(6, 10), 'blue'); queued.catch(() => {});
    runtime.blockAccount('alice');
    assert.equal(runtime.getSnapshot().uid, null, 'the owner retires synchronously');
    assert.equal(work.getSnapshot().records.length, 0, 'retired quotations are hidden immediately');
    let finished = false; const purge = runtime.purgeAccount('alice').then(() => { finished = true; });
    await tick(); assert.equal(finished, false, 'physical deletion must wait for in-flight storage');
    gate.release.resolve(); await Promise.allSettled([first, queued]); await purge;
    assert.equal([...f.data.keys()].some(key => owned(key, 'alice')), false);
    await assert.rejects(work.create(ref(), 'rose'));
    await assert.rejects(runtime.setOwner('alice'), { code: 'ACCOUNT_DELETION_BLOCKED' });
    await assert.rejects(runtime.unblockAccount('alice'), { code: 'ACCOUNT_DELETION_PERMANENT' });
    assert.equal(f.data.get(legacy('bob') + 'hamlet/other'), 'preserved');
    assert.equal(f.data.get('reader:preferences'), 'global'); runtime.dispose();
  });
}

test('purging another UID preserves the active owner and erases every exact target namespace', async () => {
  const target = 'a/b', data = {};
  for (const key of [legacy(target) + 'unknown/original', ...['v2', 'legacy', 'retired', 'recovery'].map(kind => ACCOUNT_NAMESPACE + '/' + kind + '/' + encodeURIComponent(target) + '/unknown/bytes'), ACCOUNT_NAMESPACE + '/catalogue/' + encodeURIComponent(target)]) data[key] = 'retained';
  data[legacy(target + '-other') + 'hamlet/keep'] = 'keep';
  data[ACCOUNT_NAMESPACE + '/catalogue/' + encodeURIComponent(target) + '-other'] = 'keep';
  data['firebase:authUser:fixture'] = 'auth';
  const f = storageFixture(data), runtime = runtimeFor(f.storage); await runtime.setOwner('bob');
  const before = runtime.getSnapshot().ownerGeneration;
  await runtime.purgeAccount(target);
  assert.equal(runtime.getSnapshot().uid, 'bob'); assert.equal(runtime.getSnapshot().ownerGeneration, before);
  assert.equal([...f.data.keys()].some(key => owned(key, target)), false);
  assert.equal(f.data.size, 3);
  const work = runtime.manager.forWork({ uid: 'bob', canonical }); await work.hydrate(); await work.create(ref(), 'sage');
  assert.equal(work.getSnapshot().records.length, 1); runtime.dispose();
});

test('unblocking an unaccepted request permits fresh stores but never revives old callbacks', async () => {
  const f = storageFixture(), runtime = runtimeFor(f.storage); await runtime.setOwner('alice');
  const old = runtime.manager.forWork({ uid: 'alice', canonical }); await old.hydrate(); await old.create(ref(), 'yellow');
  runtime.blockAccount('alice'); await runtime.unblockAccount('alice'); await runtime.setOwner('alice');
  await assert.rejects(old.create(ref(6, 10), 'blue'));
  const fresh = runtime.manager.forWork({ uid: 'alice', canonical }); await fresh.hydrate();
  assert.equal(fresh.getSnapshot().records.length, 1, 'preacceptance blocking does not erase saved data');
  await fresh.create(ref(6, 10), 'blue'); assert.equal(fresh.getSnapshot().records.length, 2); runtime.dispose();
});

test('purge waits for raw retirement markers and clears retained raw views', async () => {
  const key = legacy('alice') + 'unknown/broken', f = storageFixture({ [key]: '{bad JSON' });
  const runtime = runtimeFor(f.storage); await runtime.setOwner('alice');
  const raw = runtime.manager.forStoredWork({ uid: 'alice', workKey: 'unknown' }); await raw.hydrate();
  const id = raw.getSnapshot().entries[0].id, gate = delayedWrites(f, key => key.includes('/retired/alice/'));
  const removing = raw.remove(id); removing.catch(() => {}); await gate.started.promise;
  let finished = false; const purge = runtime.purgeAccount('alice').then(() => { finished = true; });
  await tick(); assert.equal(finished, false); gate.release.resolve(); await Promise.allSettled([removing]); await purge;
  assert.equal(raw.getSnapshot().entries.length, 0); assert.equal([...f.data.keys()].some(key => owned(key, 'alice')), false); runtime.dispose();
});

test('purge drains queued catalogue writes without awaiting an unresolved network commit', async () => {
  const f = storageFixture(), never = deferred(); let publishWorks;
  const runtime = runtimeFor(f.storage, 'durable-v2', {
    configuration: { enabled: true, storageMode: 'durable-v2', migrationApproved: true },
    resolveCanonical: () => canonical,
    createBackend: () => ({ commit: () => never.promise, listen: () => () => {}, listenWorks(uid, callback) { publishWorks = callback; return () => {}; } }),
    coordinatorOptions: { schedule: () => 1, cancelSchedule() {} },
  });
  await runtime.setOwner('alice'); await tick();
  const work = runtime.manager.forWork({ uid: 'alice', canonical }); await work.hydrate(); await work.create(ref(), 'yellow'); await tick();
  const gate = delayedWrites(f, key => key === ACCOUNT_NAMESPACE + '/catalogue/alice');
  const rows = revision => [{ workId: 'hamlet', metadata: { schemaVersion: 1, activeCount: 1, activeBytes: 100, revision, lastOperationId: 'remote-' + revision } }];
  publishWorks(rows(1)); await gate.started.promise; publishWorks(rows(2));
  let finished = false; const purge = runtime.purgeAccount('alice').then(() => { finished = true; });
  await tick(); assert.equal(finished, false); gate.release.resolve(); await purge;
  assert.equal(finished, true); assert.equal([...f.data.keys()].some(key => owned(key, 'alice')), false); runtime.dispose();
});

test('failed erasure remains blocked and a retry verifies physical absence', async () => {
  const f = storageFixture({ [legacy('alice') + 'hamlet/saved']: 'bytes' }), runtime = runtimeFor(f.storage);
  const remove = f.storage.removeItem; f.storage.removeItem = async () => {};
  await assert.rejects(runtime.purgeAccount('alice'), { code: 'ACCOUNT_DELETION_CLEANUP_FAILED' });
  await assert.rejects(runtime.setOwner('alice'), { code: 'ACCOUNT_DELETION_BLOCKED' });
  f.storage.removeItem = remove; await runtime.purgeAccount('alice'); assert.equal(f.data.size, 0); runtime.dispose();
});

test('runtime manager facades do not expose internal methods that could release a permanent fence', async () => {
  for (const mode of ['legacy-v1', 'durable-v2']) {
    const f = storageFixture(), runtime = runtimeFor(f.storage, mode);
    assert.deepEqual(Object.keys(runtime.manager).sort(), ['forAccount', 'forStoredWork', 'forWork']);
    await runtime.purgeAccount('alice');
    assert.throws(() => runtime.manager.forWork({ uid: 'alice', canonical }), { code: 'ACCOUNT_DELETION_BLOCKED' });
    runtime.dispose();
  }
});
