const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { deferred } = require('../reader/highlightSyncFixture.cjs');

const projectId = 'demo-bard-spark-deletion', baseUrl = 'http://127.0.0.1:8181/v1';
const prefix = 'projects/' + projectId + '/databases/(default)/documents/';
const marker = () => ({ schemaVersion: 1, status: 'deleting', startedAt: { toMillis: () => 1000 } });
function fixture(options = {}) {
  const data = new Map(Object.entries(options.records || {})), calls = [];
  const user = { uid: 'owner-one', async getIdToken() { calls.push(['token']); return 'dummy-token'; } };
  let current = user, observer, observerError, unsubscribed = 0;
  const stamp = {}, reference = (...parts) => ({ path: parts.join('/') });
  const snapshot = ref => ({ id: ref.path.split('/').at(-1), ref, exists: () => data.has(ref.path), data: () => data.get(ref.path),
    metadata: { fromCache: false, hasPendingWrites: false } });
  if (options.marker !== false) data.set('accountDeletions/owner-one', marker());
  const db = { app: { options: { projectId } } };
  const sdk = {
    doc(database, ...parts) { assert.equal(database, db); return reference(...parts); },
    collection(database, ...parts) { assert.equal(database, db); return reference(...parts); },
    query(ref, limit) { return { path: ref.path, limit: limit.limit }; }, limit: limit => ({ limit }),
    serverTimestamp: () => stamp,
    async getDocFromServer(ref) { calls.push(['get', ref.path]); return snapshot(ref); },
    async getDocsFromServer(query) {
      calls.push(['list', query.path, query.limit]);
      return { metadata: { fromCache: false, hasPendingWrites: false }, docs: [...data.keys()].filter(name => name.startsWith(query.path + '/')
        && !name.slice(query.path.length + 1).includes('/')).sort().slice(0, query.limit).map(name => snapshot(reference(name))) };
    },
    async runTransaction(database, callback) {
      assert.equal(database, db);
      const writes = [];
      await callback({ async get(ref) { calls.push(['transaction-get', ref.path]); return snapshot(ref); },
        set(ref, value) { writes.push([ref, { ...value, startedAt: value.startedAt === stamp ? marker().startedAt : value.startedAt }]); } });
      for (const [ref, value] of writes) { calls.push(['transaction-set', ref.path]); data.set(ref.path, value); }
    },
    writeBatch(database) {
      assert.equal(database, db); const paths = [];
      return { delete(ref) { paths.push(ref.path); }, async commit() {
        calls.push(['batch', [...paths]]); await options.beforeBatch?.(); for (const name of paths) data.delete(name);
      } };
    },
    async deleteDoc(ref) { calls.push(['delete', ref.path]); data.delete(ref.path); },
    onSnapshot(ref, settings, next, error) {
      assert.equal(ref.path, 'accountDeletions/owner-one'); assert.equal(settings.includeMetadataChanges, true);
      observer = next; observerError = error; return () => { unsubscribed++; };
    },
  };
  const h = { db, sdk, data, calls, user, getUser: () => current, setUser: value => { current = value; },
    observe(value, metadata = {}) { observer({ exists: () => value !== null, data: () => value,
      metadata: { fromCache: false, hasPendingWrites: false, ...metadata } }); },
    observeRaw(value) { observer(value); },
    failWatch(error) { observerError(error); }, get unsubscribed() { return unsubscribed; } };
  h.fetch = async (url, init) => {
    const query = JSON.parse(init.body).structuredQuery;
    assert.equal(url, baseUrl + '/' + prefix.slice(0, -1) + '/users/owner-one:runQuery');
    assert.equal(init.method, 'POST'); assert.equal(init.headers.Authorization, 'Bearer dummy-token');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(query.select, { fields: [{ fieldPath: '__name__' }] });
    assert.deepEqual(query.orderBy, [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }]);
    const selector = query.from[0]; assert.equal(selector.allDescendants, true);
    assert.ok(['highlights', 'operations'].includes(selector.collectionId));
    assert.ok([1, 100].includes(query.limit));
    calls.push(['query', selector.collectionId, query.limit]);
    if (options.fetch) return options.fetch(url, init, h);
    const paths = [...data.keys()].filter(name => name.startsWith('users/owner-one/') && name.split('/').at(-2) === selector.collectionId)
      .sort().slice(0, query.limit);
    return { ok: true, status: 200, json: async () => paths.length ? paths.map(name => ({ document: { name: prefix + name } })) : [{ readTime: 'fixture' }] };
  };
  h.create = changes => {
    const file = path.resolve(__dirname, '../../account/sparkDeletionCloud.js');
    assert.ok(fs.existsSync(file), 'Spark cleanup must have a cloud adapter');
    const { createSparkDeletionCloud } = require(file);
    return createSparkDeletionCloud({ db, sdk, projectId, baseUrl, getUser: h.getUser, fetchImpl: h.fetch, ...changes });
  };
  h.api = h.create(); return h;
}

test('cloud deletion rejects mismatched projects and every endpoint except its exact production or fixed-demo endpoint', () => {
  const h = fixture();
  for (const changes of [{ projectId: 'other-project' }, { baseUrl: 'https://firestore.googleapis.com/v1' },
    { baseUrl: baseUrl + '/' }, { baseUrl: 'http://localhost:8181/v1' }, { db: { app: { options: { projectId: 'other' } } } }]) {
    assert.throws(() => h.create(changes), { code: 'ACCOUNT_DELETION_UNAVAILABLE' });
  }
  const production = h.create({ projectId: 'shakespearenativeapp', baseUrl: 'https://firestore.googleapis.com/v1',
    db: { app: { options: { projectId: 'shakespearenativeapp' } } } });
  assert.equal(typeof production.cleanup, 'function');
  assert.deepEqual(h.calls, []);
});

test('marker creation is transactional and idempotent, then confirmed by a server-only reread', async () => {
  const h = fixture({ marker: false });
  assert.equal(await h.api.getMarker(h.user), null);
  await h.api.ensureMarker(h.user); await h.api.ensureMarker(h.user);
  assert.equal(h.calls.filter(([kind]) => kind === 'transaction-set').length, 1);
  assert.deepEqual(Object.keys(h.data.get('accountDeletions/owner-one')).sort(), ['schemaVersion', 'startedAt', 'status']);
  assert.equal((await h.api.getMarker(h.user)).status, 'deleting');
  assert.equal(h.calls.some(([kind]) => ['batch', 'delete', 'query'].includes(kind)), false);
});

test('marker reads reject corrupt shapes or unconfirmed SDK cache snapshots', async () => {
  const h = fixture();
  for (const value of [{ ...marker(), secret: 'dummy-private' }, { ...marker(), status: 'complete' },
    { ...marker(), startedAt: 1000 }, { ...marker(), schemaVersion: 2 }]) {
    h.data.set('accountDeletions/owner-one', value);
    await assert.rejects(h.api.getMarker(h.user), { code: 'ACCOUNT_DELETION_INVALID_MARKER' });
  }
  h.sdk.getDocFromServer = async () => ({ exists: () => true, data: marker, metadata: { fromCache: true, hasPendingWrites: false } });
  await assert.rejects(h.api.getMarker(h.user), { code: 'ACCOUNT_DELETION_UNAVAILABLE' });
  for (const metadata of [undefined, {}, { fromCache: false }, { hasPendingWrites: false }]) {
    h.sdk.getDocFromServer = async () => ({ exists: () => true, data: marker, metadata });
    await assert.rejects(h.api.getMarker(h.user), { code: 'ACCOUNT_DELETION_UNAVAILABLE' });
  }
});

test('cleanup pages orphan descendants before metadata and profile, preserves the deletion fence and another UID', async () => {
  const records = { 'users/owner-one': { completedLevel: 5 }, 'users/owner-one/quizzes/saved': { value: 1 },
    'users/owner-one/highlightWorks/hamlet': { activeCount: 120 }, 'users/other-owner': { retained: true },
    'users/other-owner/highlightWorks/hamlet/highlights/other': { retained: true } };
  for (let i = 0; i < 120; i++) records['users/owner-one/highlightWorks/hamlet/highlights/h' + i] = { original: i };
  for (let i = 0; i < 205; i++) records['users/owner-one/highlightWorks/non-catalogue-orphan/operations/op' + i] = { original: i };
  const h = fixture({ records }), phases = [];
  assert.equal(await h.api.cleanup(h.user, { isActive: () => true, onProgress: phase => phases.push(phase) }), true);
  assert.deepEqual([...h.data.keys()].sort(), ['accountDeletions/owner-one', 'users/other-owner', 'users/other-owner/highlightWorks/hamlet/highlights/other']);
  const batches = h.calls.filter(([kind]) => kind === 'batch').map(([, names]) => names);
  assert.ok(batches.length >= 7); assert.ok(batches.every(names => names.length <= 100));
  assert.equal(h.calls.filter(([kind]) => kind === 'delete').at(-1)[1], 'users/owner-one');
  assert.ok(phases.includes('verifying-data'));
  assert.equal(await h.api.verifyEmpty(h.user, { isActive: () => true }), true);
});

test('absent marker never permits data queries or deletion', async () => {
  const h = fixture({ marker: false, records: { 'users/owner-one': { keep: true } } });
  await assert.rejects(h.api.cleanup(h.user), { code: 'ACCOUNT_DELETION_INVALID_MARKER' });
  assert.equal(h.data.has('users/owner-one'), true);
  assert.equal(h.calls.some(([kind]) => ['batch', 'delete', 'query'].includes(kind)), false);
});

test('all response paths are validated before deleting any result from a page', async () => {
  for (const name of [prefix + 'users/other-owner/highlightWorks/hamlet/highlights/foreign',
    prefix + 'users/owner-one/unknown/hamlet/highlights/unknown',
    prefix + 'users/owner-one/highlightWorks/hamlet/operations/wrong-group',
    'projects/other/databases/(default)/documents/users/owner-one/highlightWorks/hamlet/highlights/wrong-project']) {
    const h = fixture({ fetch: async () => ({ ok: true, status: 200, json: async () => [
      { document: { name: prefix + 'users/owner-one/highlightWorks/hamlet/highlights/first' } }, { document: { name } },
    ] }) });
    await assert.rejects(h.api.cleanup(h.user), { code: 'ACCOUNT_DELETION_SCHEMA_UNSUPPORTED' });
    assert.equal(h.calls.some(([kind]) => ['batch', 'delete'].includes(kind)), false);
  }
});

test('a malformed empty query or embedded stream error cannot prove account data absent', async () => {
  for (const payload of [[], [{}], [{ error: { message: 'dummy-private stream failure' } }]]) {
    const h = fixture({ fetch: async () => ({ ok: true, status: 200, json: async () => payload }) });
    await assert.rejects(h.api.verifyEmpty(h.user), { code: 'ACCOUNT_DELETION_SCHEMA_UNSUPPORTED' });
    assert.equal(h.calls.some(([kind]) => ['batch', 'delete'].includes(kind)), false);
  }
});

test('a captured owner cannot be replaced during token acquisition or a pending query', async () => {
  for (const boundary of ['token', 'query']) {
    const wait = deferred(), h = fixture();
    if (boundary === 'token') h.user.getIdToken = async () => { await wait.promise; return 'dummy-token'; };
    const api = h.create(boundary === 'query' ? { fetchImpl: async () => { await wait.promise; return { ok: true, status: 200,
      json: async () => [{ document: { name: prefix + 'users/owner-one/highlightWorks/hamlet/highlights/one' } }] }; } } : {});
    const pending = api.cleanup(h.user); pending.catch(() => {});
    await new Promise(setImmediate); h.setUser({ uid: 'other-owner' }); wait.resolve();
    await assert.rejects(pending, { code: 'ACCOUNT_DELETION_OTHER_ACCOUNT' });
    assert.equal(h.calls.some(([kind]) => ['batch', 'delete'].includes(kind)), false);
  }
});

test('pause stops subsequent pages after an already authorized batch and preserves unremoved records', async () => {
  let active = true, pauseOnce = true;
  const records = {};
  for (let i = 0; i < 101; i++) records['users/owner-one/highlightWorks/hamlet/highlights/h' + i] = { value: i };
  const h = fixture({ records, beforeBatch: async () => { if (pauseOnce) { active = false; pauseOnce = false; } } });
  await assert.rejects(h.api.cleanup(h.user, { isActive: () => active }), { code: 'ACCOUNT_DELETION_PAUSED' });
  assert.equal(h.calls.filter(([kind]) => kind === 'batch').length, 1);
  assert.equal([...h.data.keys()].filter(name => name.includes('/highlights/')).length, 1);
  active = true; assert.equal(await h.api.cleanup(h.user, { isActive: () => active }), true);
});

test('quota, permission, expired authentication and network failures are sanitized without response-body dumps', async () => {
  for (const [status, code] of [[429, 'ACCOUNT_DELETION_QUOTA'], [403, 'ACCOUNT_DELETION_RULES_DENIED'],
    [401, 'ACCOUNT_DELETION_REAUTH_REQUIRED'], [503, 'ACCOUNT_DELETION_UNAVAILABLE']]) {
    const h = fixture({ fetch: async () => ({ ok: false, status, json() { throw Error('must not read dummy-private response'); } }) });
    await assert.rejects(h.api.cleanup(h.user), error => {
      assert.equal(error.code, code); assert.doesNotMatch(error.message, /dummy|private|token/); return true;
    });
    assert.equal(h.calls.some(([kind]) => ['batch', 'delete'].includes(kind)), false);
  }
  const h = fixture({ fetch: async () => { throw Error('dummy-token from network'); } });
  await assert.rejects(h.api.cleanup(h.user), { code: 'ACCOUNT_DELETION_UNAVAILABLE', message: 'Account data cleanup could not be completed.' });
});

test('verification is server-backed and returns false for any remaining profile, quiz, metadata or orphan document', async () => {
  for (const name of ['users/owner-one', 'users/owner-one/quizzes/one', 'users/owner-one/highlightWorks/one',
    'users/owner-one/highlightWorks/missing/highlights/one', 'users/owner-one/highlightWorks/missing/operations/one']) {
    const h = fixture({ records: { [name]: { retained: true } } });
    assert.equal(await h.api.verifyEmpty(h.user, { isActive: () => true }), false);
    assert.equal(h.data.has(name), true);
    assert.equal(h.calls.some(([kind]) => ['batch', 'delete'].includes(kind)), false);
  }
});

test('REST timeout cancels the request and preserves account data', async () => {
  const h = fixture({ fetch: async (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Error('private timeout body')), { once: true });
  }) });
  await assert.rejects(h.create({ timeoutMs: 5 }).cleanup(h.user), { code: 'ACCOUNT_DELETION_UNAVAILABLE' });
  assert.equal(h.calls.some(([kind]) => ['batch', 'delete'].includes(kind)), false);
});

test('SDK reads without explicit server-confirmed metadata cannot authorize profile deletion', async () => {
  const h = fixture({ records: { 'users/owner-one': { retained: true } } });
  h.sdk.getDocsFromServer = async () => ({ docs: [] });
  await assert.rejects(h.api.cleanup(h.user), { code: 'ACCOUNT_DELETION_UNAVAILABLE' });
  assert.equal(h.data.has('users/owner-one'), true);
  assert.equal(h.calls.some(([kind]) => kind === 'delete'), false);
});

test('a queued SDK deletion times out without false completion and a late commit stays owner-scoped', { timeout: 300 }, async () => {
  const release = deferred();
  const h = fixture({ records: {
    'users/owner-one': { retainedUntilVerified: true },
    'users/owner-one/highlightWorks/hamlet/highlights/one': { value: 1 },
    'users/other-owner': { retained: true },
  }, beforeBatch: () => release.promise });
  await assert.rejects(h.create({ timeoutMs: 5 }).cleanup(h.user), { code: 'ACCOUNT_DELETION_UNAVAILABLE' });
  assert.equal(h.data.has('users/owner-one/highlightWorks/hamlet/highlights/one'), true);
  assert.equal(h.data.has('users/owner-one'), true);
  const callsAtTimeout = h.calls.length;
  h.setUser({ uid: 'other-owner' }); release.resolve(); await new Promise(setImmediate);
  assert.equal(h.data.has('users/owner-one/highlightWorks/hamlet/highlights/one'), false, 'an authorized in-flight request may finish');
  assert.equal(h.data.has('users/owner-one'), true, 'timed-out work must not continue to profile or Authentication cleanup');
  assert.equal(h.data.has('users/other-owner'), true);
  assert.equal(h.calls.length, callsAtTimeout, 'late completion cannot start another query or mutation');
});

test('a never-settling SDK read has a bounded sanitized failure', { timeout: 300 }, async () => {
  const h = fixture(); h.sdk.getDocFromServer = () => new Promise(() => {});
  await assert.rejects(h.create({ timeoutMs: 5 }).getMarker(h.user), {
    code: 'ACCOUNT_DELETION_UNAVAILABLE', message: 'Account data cleanup could not be completed.',
  });
  assert.equal(h.calls.some(([kind]) => ['batch', 'delete', 'query'].includes(kind)), false);
});

test('a late SDK rejection is handled after the cleanup deadline', { timeout: 300 }, async () => {
  const release = deferred(), h = fixture();
  h.sdk.getDocFromServer = () => release.promise;
  await assert.rejects(h.create({ timeoutMs: 5 }).getMarker(h.user), { code: 'ACCOUNT_DELETION_UNAVAILABLE' });
  release.reject(Error('dummy-private late failure')); await new Promise(setImmediate);
  assert.equal(h.data.has('accountDeletions/owner-one'), true);
  assert.equal(h.calls.some(([kind]) => ['batch', 'delete', 'query'].includes(kind)), false);
});

test('a late transaction retry still checks the original owner before creating a marker', { timeout: 300 }, async () => {
  const release = deferred(), h = fixture({ marker: false }), original = h.sdk.runTransaction;
  h.sdk.runTransaction = async (...args) => { await release.promise; return original(...args); };
  await assert.rejects(h.create({ timeoutMs: 5 }).ensureMarker(h.user), { code: 'ACCOUNT_DELETION_UNAVAILABLE' });
  h.setUser({ uid: 'other-owner' }); release.resolve(); await new Promise(setImmediate);
  assert.equal(h.data.has('accountDeletions/owner-one'), false);
  assert.equal(h.calls.some(([kind]) => ['transaction-set', 'batch', 'delete'].includes(kind)), false);
});

test('marker observer ignores unconfirmed snapshots and cannot publish a previous owner after account change', () => {
  const h = fixture(), rows = [], errors = [];
  const stop = h.api.watchMarker(h.user, value => rows.push(value?.status || null), error => errors.push(error.code));
  h.observe(marker(), { fromCache: true }); h.observe(marker(), { hasPendingWrites: true });
  h.observeRaw({ exists: () => true, data: marker });
  assert.deepEqual(rows, []);
  h.observe(null); h.observe(marker()); assert.deepEqual(rows, [null, 'deleting']);
  h.observe({ ...marker(), status: 'invalid' }); assert.deepEqual(errors, ['ACCOUNT_DELETION_INVALID_MARKER']);
  h.setUser({ uid: 'other-owner' }); h.observe(marker()); h.failWatch({ code: 'permission-denied' });
  assert.deepEqual(rows, [null, 'deleting']); assert.deepEqual(errors, ['ACCOUNT_DELETION_INVALID_MARKER']);
  stop(); assert.equal(h.unsubscribed, 1);
});
