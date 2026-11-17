const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { storageFixture, deferred } = require('../reader/highlightSyncFixture.cjs');
const KEY = 'bard.accountDeletion.intent.v1', NS = '@bard/reader-highlights-sync:account-v2';
const intent = changes => ({ version: 1, uid: 'alice', email: 'Alice@example.test', ticket: 'a'.repeat(64), phase: 'prepared', createdAt: 1000, ...changes });
function setup(initial = {}) {
  const file = require.resolve('../../reader/normalHighlightRuntime').replace(/reader[\\/]normalHighlightRuntime\.js$/, 'account/deletionStorage.js');
  assert.ok(fs.existsSync(file), 'the account deletion storage factory must exist');
  const { createDeletionStorage } = require(file), f = storageFixture(initial), secure = new Map(), calls = [];
  const secureStore = {
    async getItemAsync(key) { calls.push(['get', key]); return secure.get(key) ?? null; },
    async setItemAsync(key, value) { calls.push(['set', key]); secure.set(key, value); },
    async deleteItemAsync(key) { calls.push(['remove', key]); secure.delete(key); },
  };
  const runtime = { async purgeAccount(uid) { calls.push(['purge', uid]); for (const key of f.data.keys()) if (key.startsWith('@bard/reader-highlights:v1/' + encodeURIComponent(uid) + '/') || ['v2', 'legacy', 'retired', 'recovery'].some(kind => key.startsWith(NS + '/' + kind + '/' + encodeURIComponent(uid) + '/')) || key === NS + '/catalogue/' + encodeURIComponent(uid)) f.data.delete(key); } };
  return { ...f, secure, calls, secureStore, runtime, api: createDeletionStorage({ storage: f.storage, secureStore, runtime }) };
}

test('one encrypted journal stores and validates the exact deletion intent without AsyncStorage writes', async () => {
  const h = setup(); assert.equal(await h.api.loadIntent(), null);
  await h.api.saveIntent(intent()); assert.deepEqual(await h.api.loadIntent(), intent());
  assert.deepEqual([...h.secure.keys()], [KEY]); assert.equal(h.data.size, 0);
  await h.api.saveIntent(intent({ phase: 'accepted' })); await h.api.saveIntent(intent({ phase: 'cleanup' }));
  assert.equal((await h.api.loadIntent()).phase, 'cleanup');
});

test('corrupt and nonexact journal payloads fail closed without resetting the journal', async () => {
  const h = setup();
  for (const raw of ['{bad', JSON.stringify(intent({ password: 'never permitted' })), JSON.stringify(intent({ ticket: 'short' })), JSON.stringify(intent({ phase: 'done' })), JSON.stringify(intent({ createdAt: -1 }))]) {
    h.secure.set(KEY, raw); await assert.rejects(h.api.loadIntent(), { code: 'ACCOUNT_DELETION_INVALID_INTENT' }); assert.equal(h.secure.get(KEY), raw);
  }
  h.secure.delete(KEY); await assert.rejects(h.api.saveIntent(intent({ password: 'never permitted' })), { code: 'ACCOUNT_DELETION_INVALID_INTENT' }); assert.equal(h.secure.has(KEY), false);
});

test('another account or ticket cannot overwrite the retained journal and phases cannot regress', async () => {
  const h = setup(); await h.api.saveIntent(intent({ phase: 'accepted' }));
  for (const next of [intent({ uid: 'bob' }), intent({ ticket: 'b'.repeat(64) })]) await assert.rejects(h.api.saveIntent(next), { code: 'ACCOUNT_DELETION_BUSY' });
  await assert.rejects(h.api.saveIntent(intent()), { code: 'ACCOUNT_DELETION_INVALID_TRANSITION' });
  await assert.rejects(h.api.saveIntent(intent({ phase: 'cleanup', email: 'other@example.test' })), { code: 'ACCOUNT_DELETION_INVALID_TRANSITION' });
  assert.deepEqual(await h.api.loadIntent(), intent({ phase: 'accepted' }));
});

test('journal updates serialize delayed writes so a concurrent ticket cannot replace the first intent', async () => {
  const h = setup(), entered = deferred(), release = deferred(), original = h.secureStore.setItemAsync;
  h.secureStore.setItemAsync = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
  const first = h.api.saveIntent(intent()); await entered.promise;
  const second = h.api.saveIntent(intent({ ticket: 'b'.repeat(64) })); second.catch(() => {});
  release.resolve(); await first; await assert.rejects(second, { code: 'ACCOUNT_DELETION_BUSY' });
  assert.equal((await h.api.loadIntent()).ticket, 'a'.repeat(64));
});

test('separate factories sharing SecureStore serialize the one journal and surface secure write failure', async () => {
  const h = setup(), { createDeletionStorage } = require('../../account/deletionStorage');
  const other = createDeletionStorage({ storage: h.storage, secureStore: h.secureStore, runtime: h.runtime });
  const first = h.api.saveIntent(intent()), second = other.saveIntent(intent({ uid: 'bob' })); second.catch(() => {});
  await first; await assert.rejects(second, { code: 'ACCOUNT_DELETION_BUSY' });
  h.secureStore.setItemAsync = async () => { throw Error('fixture locked'); };
  await assert.rejects(h.api.saveIntent(intent({ phase: 'accepted' })), { code: 'ACCOUNT_DELETION_STORAGE_FAILED' });
  assert.equal((await h.api.loadIntent()).phase, 'prepared');
});

test('journal removal is conditional on both the UID and ticket', async () => {
  const h = setup(); await h.api.saveIntent(intent());
  await assert.rejects(h.api.removeIntent({ uid: 'bob', ticket: 'a'.repeat(64) }), { code: 'ACCOUNT_DELETION_BUSY' });
  await assert.rejects(h.api.removeIntent({ uid: 'alice', ticket: 'b'.repeat(64) }), { code: 'ACCOUNT_DELETION_BUSY' });
  await h.api.removeIntent({ uid: 'alice', ticket: 'a'.repeat(64) }); assert.equal(await h.api.loadIntent(), null);
});

test('cleanup calls the runtime purge and removes matching credentials while preserving other account and global bytes', async () => {
  const h = setup({ [NS + '/recovery/alice/retained']: 'bytes', '@bard/reader-highlights:v1/alice/hamlet/h1': 'original', [NS + '/catalogue/alice']: 'catalogue', [NS + '/v2/alice-other/hamlet/h1']: 'other', 'firebase:authUser:fixture': 'auth', 'reader:preferences': 'global' });
  h.secure.set('userinfo', JSON.stringify({ email: 'ALICE@example.test', password: 'fixture-only' }));
  await h.api.clearAccountData(intent({ phase: 'cleanup' }));
  assert.equal(h.calls.some(([name, uid]) => name === 'purge' && uid === 'alice'), true);
  assert.equal(h.secure.has('userinfo'), false); assert.equal(h.data.size, 3);
  assert.equal(h.data.get('firebase:authUser:fixture'), 'auth'); assert.equal(h.data.get('reader:preferences'), 'global');
});

test('cleanup preserves other or unidentifiable remembered credentials and respects an explicit saved UID', async () => {
  const h = setup();
  for (const raw of ['{bad', JSON.stringify({ email: 'bob@example.test', password: 'other' }), JSON.stringify({ uid: 'bob', email: 'alice@example.test', password: 'other' })]) {
    h.secure.set('userinfo', raw); await h.api.clearAccountData(intent({ phase: 'cleanup' })); assert.equal(h.secure.get('userinfo'), raw);
  }
  h.secure.set('userinfo', JSON.stringify({ uid: 'alice', email: 'old-address@example.test', password: 'fixture-only' }));
  await h.api.clearAccountData(intent({ phase: 'cleanup' })); assert.equal(h.secure.has('userinfo'), false);
});

test('cleanup verifies runtime erasure and retains the journal when any exact account prefix survives', async () => {
  const h = setup({ [NS + '/recovery/alice/pending']: 'bytes' }); await h.api.saveIntent(intent({ phase: 'cleanup' }));
  h.runtime.purgeAccount = async () => {};
  await assert.rejects(h.api.clearAccountData(intent({ phase: 'cleanup' })), { code: 'ACCOUNT_DELETION_CLEANUP_FAILED' });
  assert.equal((await h.api.loadIntent()).phase, 'cleanup');
});

test('cleanup does not delete remembered credentials replaced while the first secure read was pending', async () => {
  const h = setup(), read = h.secureStore.getItemAsync;
  const old = JSON.stringify({ email: 'alice@example.test', password: 'old' }), next = JSON.stringify({ email: 'bob@example.test', password: 'new' });
  h.secure.set('userinfo', old); let count = 0;
  h.secureStore.getItemAsync = async key => { if (key === 'userinfo' && ++count === 1) { h.secure.set(key, next); return old; } return read(key); };
  await h.api.clearAccountData(intent({ phase: 'cleanup' })); assert.equal(h.secure.get('userinfo'), next);
});

test('credential writes queued before and after cleanup keep the other account credentials', async () => {
  const file = require.resolve('../../reader/normalHighlightRuntime').replace(/reader[\\/]normalHighlightRuntime\.js$/, 'account/credentialGate.js');
  assert.ok(fs.existsSync(file), 'the credential mutation gate must exist');
  const { runCredentialMutation } = require(file);
  const h = setup(), bob = JSON.stringify({ uid: 'bob', email: 'bob@example.test', password: 'other' });
  const before = runCredentialMutation(() => h.secureStore.setItemAsync('userinfo', bob));
  await h.api.clearAccountData(intent({ phase: 'cleanup' })); await before; assert.equal(h.secure.get('userinfo'), bob);
  h.secure.set('userinfo', JSON.stringify({ uid: 'alice', email: 'alice@example.test', password: 'old' }));
  const entered = deferred(), release = deferred(), read = h.secureStore.getItemAsync; let delayed = false;
  h.secureStore.getItemAsync = async key => { if (key === 'userinfo' && !delayed) { delayed = true; entered.resolve(); await release.promise; } return read(key); };
  const cleaning = h.api.clearAccountData(intent({ phase: 'cleanup' })); await entered.promise;
  const after = runCredentialMutation(() => h.secureStore.setItemAsync('userinfo', bob));
  release.resolve(); await cleaning; await after; assert.equal(h.secure.get('userinfo'), bob);
});

test('a failed credential mutation does not prevent a later account credential write', async () => {
  const { runCredentialMutation } = require('../../account/credentialGate');
  const h = setup();
  await assert.rejects(runCredentialMutation(async () => { throw Error('fixture credential failure'); }), /fixture credential failure/);
  await runCredentialMutation(() => h.secureStore.setItemAsync('userinfo', JSON.stringify({ uid: 'bob' })));
  assert.equal(JSON.parse(h.secure.get('userinfo')).uid, 'bob');
});
