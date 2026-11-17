const assert = require('node:assert/strict');
const test = require('node:test');
const { createDeletionStorage } = require('../../account/deletionStorage');
const { storageFixture, deferred } = require('../reader/highlightSyncFixture.cjs');

const KEY = 'bard.accountDeletion.spark.intent.v1';
const SERVER_KEY = 'bard.accountDeletion.intent.v1';
const intent = changes => ({ version: 1, uid: 'alice', email: 'alice@example.test', ticket: 'a'.repeat(64),
  phase: 'prepared', createdAt: 1000, ...changes });
function setup() {
  const secure = new Map(), f = storageFixture(), calls = [];
  const secureStore = {
    async getItemAsync(key) { calls.push(['get', key]); return secure.get(key) ?? null; },
    async setItemAsync(key, value) { calls.push(['set', key]); secure.set(key, value); },
    async deleteItemAsync(key) { calls.push(['remove', key]); secure.delete(key); },
  };
  const runtime = { async purgeAccount(uid) { calls.push(['purge', uid]); } };
  const options = { storage: f.storage, secureStore, runtime, mode: 'spark' };
  return { ...f, secure, secureStore, runtime, options, calls, api: createDeletionStorage(options) };
}

test('Spark journals use their own key and retain the Auth-pending phase across restart', async () => {
  const h = setup();
  assert.equal(await h.api.loadIntent(), null);
  for (const phase of ['prepared', 'accepted', 'auth-pending']) await h.api.saveIntent(intent({ phase }));
  const restarted = createDeletionStorage(h.options);
  assert.deepEqual(await restarted.loadIntent(), intent({ phase: 'auth-pending' }));
  assert.deepEqual([...h.secure.keys()], [KEY]);
  assert.equal(h.data.size, 0, 'the deletion intent must not enter ordinary AsyncStorage');
  await restarted.saveIntent(intent({ phase: 'cleanup' }));
  assert.equal((await h.api.loadIntent()).phase, 'cleanup');
});

test('Spark journals reject phase regression, owner substitution and changed immutable fields', async () => {
  const h = setup(); await h.api.saveIntent(intent({ phase: 'auth-pending' }));
  await assert.rejects(h.api.saveIntent(intent({ phase: 'accepted' })), { code: 'ACCOUNT_DELETION_INVALID_TRANSITION' });
  await assert.rejects(h.api.saveIntent(intent({ phase: 'cleanup', uid: 'bob' })), { code: 'ACCOUNT_DELETION_BUSY' });
  await assert.rejects(h.api.saveIntent(intent({ phase: 'cleanup', ticket: 'b'.repeat(64) })), { code: 'ACCOUNT_DELETION_BUSY' });
  for (const changes of [{ email: 'other@example.test' }, { createdAt: 1001 }]) {
    await assert.rejects(h.api.saveIntent(intent({ phase: 'cleanup', ...changes })), { code: 'ACCOUNT_DELETION_INVALID_TRANSITION' });
  }
  assert.deepEqual(await h.api.loadIntent(), intent({ phase: 'auth-pending' }));
});

test('an existing server journal blocks Spark without being interpreted, migrated or removed', async () => {
  const h = setup();
  for (const raw of [JSON.stringify(intent({ phase: 'accepted' })), '{invalid legacy bytes']) {
    h.secure.set(SERVER_KEY, raw);
    const before = h.calls.length;
    await assert.rejects(h.api.loadIntent(), { code: 'ACCOUNT_DELETION_LEGACY_PENDING' });
    await assert.rejects(h.api.saveIntent(intent()), { code: 'ACCOUNT_DELETION_LEGACY_PENDING' });
    await assert.rejects(h.api.removeIntent({ uid: 'alice', ticket: 'a'.repeat(64) }), { code: 'ACCOUNT_DELETION_LEGACY_PENDING' });
    assert.equal(h.secure.get(SERVER_KEY), raw);
    assert.equal(h.secure.has(KEY), false);
    assert.equal(h.calls.slice(before).some(([kind]) => ['set', 'remove', 'purge'].includes(kind)), false);
  }
});

test('Spark validation rejects malformed journals and credentials without destroying retained bytes', async () => {
  const h = setup();
  for (const raw of ['{bad', JSON.stringify(intent({ password: 'dummy-credential' })), JSON.stringify(intent({ phase: 'finished' })),
    JSON.stringify(intent({ ticket: 'short' })), JSON.stringify(intent({ createdAt: -1 }))]) {
    h.secure.set(KEY, raw);
    await assert.rejects(h.api.loadIntent(), { code: 'ACCOUNT_DELETION_INVALID_INTENT' });
    assert.equal(h.secure.get(KEY), raw);
  }
  h.secure.delete(KEY);
  await assert.rejects(h.api.saveIntent(intent({ idToken: 'dummy-token' })), { code: 'ACCOUNT_DELETION_INVALID_INTENT' });
  assert.equal(h.secure.has(KEY), false);
});

test('Spark cleanup is unavailable before confirmed cleanup and retains another account credentials', async () => {
  const h = setup();
  const other = JSON.stringify({ uid: 'bob', email: 'bob@example.test', password: 'dummy-other' });
  h.secure.set('userinfo', other);
  for (const phase of ['prepared', 'accepted', 'auth-pending']) {
    await assert.rejects(h.api.clearAccountData(intent({ phase })), { code: 'ACCOUNT_DELETION_INVALID_TRANSITION' });
  }
  assert.equal(h.calls.some(([kind]) => kind === 'purge'), false);
  await h.api.clearAccountData(intent({ phase: 'cleanup' }));
  assert.deepEqual(h.calls.filter(([kind]) => kind === 'purge'), [['purge', 'alice']]);
  assert.equal(h.secure.get('userinfo'), other);
});

test('concurrent Spark factories preserve the first ticket and removal requires the matching owner', async () => {
  const h = setup(), entered = deferred(), release = deferred();
  const original = h.secureStore.setItemAsync;
  h.secureStore.setItemAsync = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
  const other = createDeletionStorage(h.options);
  const first = h.api.saveIntent(intent()); await entered.promise;
  const second = other.saveIntent(intent({ ticket: 'b'.repeat(64) })); second.catch(() => {});
  release.resolve(); await first;
  await assert.rejects(second, { code: 'ACCOUNT_DELETION_BUSY' });
  await assert.rejects(other.removeIntent({ uid: 'bob', ticket: 'a'.repeat(64) }), { code: 'ACCOUNT_DELETION_BUSY' });
  await other.removeIntent({ uid: 'alice', ticket: 'a'.repeat(64) });
  assert.equal(await h.api.loadIntent(), null);
});

test('unsupported storage modes are rejected and default server mode retains its original phase contract', async () => {
  const h = setup();
  assert.throws(() => createDeletionStorage({ ...h.options, mode: 'unknown' }), { code: 'ACCOUNT_DELETION_INVALID_MODE' });
  const server = createDeletionStorage({ storage: h.storage, secureStore: h.secureStore, runtime: h.runtime });
  await assert.rejects(server.saveIntent(intent({ phase: 'auth-pending' })), { code: 'ACCOUNT_DELETION_INVALID_INTENT' });
  await server.saveIntent(intent({ phase: 'accepted' }));
  assert.deepEqual([...h.secure.keys()], [SERVER_KEY]);
});
