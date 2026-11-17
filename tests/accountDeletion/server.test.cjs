const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = path.resolve(__dirname, '../../functions/accountDeletion.js');
const ticket = 'a'.repeat(64);
const otherTicket = 'b'.repeat(64);

function fixture(options = {}) {
  assert.ok(fs.existsSync(source), 'the durable account deletion service exists');
  const { createAccountDeletionService } = require(source);
  const records = new Map();
  const users = new Set(['reader-one', 'reader-two']);
  const calls = [];
  let time = 1800000000000;
  let tail = Promise.resolve();
  const snapshot = ref => ({ exists: records.has(ref.path), id: ref.id,
    data: () => structuredClone(records.get(ref.path)), ref });
  const collection = collectionPath => ({
    path: collectionPath,
    async listDocuments() {
      const prefix = collectionPath + '/';
      const ids = new Set([...records.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length).split('/')[0]));
      return [...ids].map(id => document(prefix + id));
    },
    where(field, operator, value) {
      assert.equal(operator, '<=');
      return { orderBy(order) { assert.equal(order, field); return { limit(count) { return {
        async get() {
          const docs = [...records.entries()].filter(([key, data]) => key.startsWith(collectionPath + '/')
            && key.split('/').length === collectionPath.split('/').length + 1 && data[field] <= value)
            .sort((a, b) => a[1][field] - b[1][field]).slice(0, count).map(([key]) => snapshot(document(key)));
          return { docs };
        },
      }; } }; } };
    },
  });
  const document = documentPath => ({
    path: documentPath, id: documentPath.split('/').at(-1),
    async get() { return snapshot(this); },
    async listCollections() {
      const prefix = documentPath + '/';
      const ids = new Set([...records.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length).split('/')[0]));
      return [...ids].map(id => collection(prefix + id));
    },
  });
  const db = {
    doc: document, collection,
    runTransaction(run) {
      const result = tail.then(() => run({
        get: async ref => snapshot(ref),
        set: (ref, value) => records.set(ref.path, structuredClone(value)),
        delete: ref => records.delete(ref.path),
      }));
      tail = result.catch(() => {});
      return result;
    },
    async recursiveDelete(ref) {
      calls.push(['delete-data', ref.path]);
      if (options.deleteData) return options.deleteData({ records, ref, calls });
      for (const key of records.keys()) if (key === ref.path || key.startsWith(ref.path + '/')) records.delete(key);
    },
  };
  const missing = () => Object.assign(Error('missing'), { code: 'auth/user-not-found' });
  const auth = {
    async getUser(uid) { calls.push(['get-user', uid]); if (!users.has(uid)) throw missing(); return { uid }; },
    async revokeRefreshTokens(uid) { calls.push(['revoke', uid]); if (!users.has(uid)) throw missing(); },
    async deleteUser(uid) {
      calls.push(['delete-auth', uid]);
      if (options.deleteAuth) return options.deleteAuth({ users, uid, calls });
      if (!users.delete(uid)) throw missing();
    },
  };
  const service = createAccountDeletionService({ db, auth, now: () => time });
  return { service, records, users, calls, db, auth,
    request: (data = { ticket }, authContext = { uid: 'reader-one', token: { auth_time: time / 1000 } }) => service.request({ data, auth: authContext }),
    advance(ms) { time += ms; },
    job: () => records.get('accountDeletionJobs/reader-one'),
    seed() {
      records.set('users/reader-one', { displayName: 'private', completedLevel: 3 });
      records.set('users/reader-one/quizzes/legacy', { answers: 'private' });
      records.set('users/reader-one/highlightWorks/missing/highlights/orphan', { exact: 'private' });
      records.set('users/reader-one/highlightWorks/missing/operations/receipt', { exact: 'private' });
      records.set('users/reader-two', { preserved: true });
    },
  };
}

test('recent authenticated deletion gates data first, removes descendants and Auth, and retains a minimal completion receipt', async () => {
  const h = fixture(); h.seed();
  const result = await h.request();
  assert.deepEqual(result, { status: 'complete', phase: 'complete' });
  assert.equal(h.users.has('reader-one'), false);
  assert.equal(h.users.has('reader-two'), true);
  assert.deepEqual(h.records.get('users/reader-two'), { preserved: true });
  assert.equal([...h.records.keys()].some(key => key.startsWith('users/reader-one')), false);
  const job = h.job();
  assert.equal(job.status, 'complete');
  assert.match(job.ticketHash, /^[a-f0-9]{64}$/);
  assert.notEqual(job.ticketHash, ticket);
  assert.equal(JSON.stringify(job).includes('private'), false);
  assert.equal(JSON.stringify(job).includes(ticket), false);
  assert.equal(job.expiresAt, undefined, 'completion remains recoverable until local cleanup is acknowledged');
  assert.ok(h.calls.findIndex(call => call[0] === 'delete-data') < h.calls.findIndex(call => call[0] === 'delete-auth'));
  assert.deepEqual(await h.service.status({ uid: 'reader-one', ticket }), result);
  assert.deepEqual(await h.service.status({ uid: 'reader-one', ticket, acknowledge: true }), result);
  assert.equal(h.job().expiresAt.getTime() - h.job().acknowledgedAt, 7 * 24 * 60 * 60 * 1000);
});

test('missing authentication, old auth_time, arbitrary UID and malformed tickets cannot create a deletion gate', async () => {
  const h = fixture();
  for (const [data, auth, code] of [
    [{ ticket }, null, 'unauthenticated'],
    [{ ticket }, { uid: 'reader-one', token: { auth_time: 1 } }, 'failed-precondition'],
    [{ ticket, uid: 'reader-two' }, undefined, 'invalid-argument'],
    [{ ticket: 'A'.repeat(64) }, undefined, 'invalid-argument'],
  ]) await assert.rejects(h.request(data, auth), { code });
  assert.equal(h.records.size, 0);
});

test('the same ticket is idempotent after Auth disappears and a different ticket cannot replace it', async () => {
  const h = fixture(); h.seed();
  await h.request();
  const first = structuredClone(h.job());
  assert.equal((await h.request()).status, 'complete');
  assert.deepEqual(h.job(), first);
  await assert.rejects(h.request({ ticket: otherTicket }), { code: 'already-exists' });
  assert.deepEqual(h.job(), first);
  for (const input of [{ uid: 'reader-one', ticket: otherTicket }, { uid: 'missing', ticket }, { uid: '../users', ticket }]) {
    assert.equal(await h.service.status(input), null);
  }
});

test('inconsistent persisted completion states cannot report a completed deletion', async () => {
  const h = fixture(); h.seed(); await h.request();
  h.job().phase = 'queued';
  await assert.rejects(h.service.status({ uid: 'reader-one', ticket }), { code: 'unavailable' });
  await assert.rejects(h.request(), { code: 'unavailable' });
  h.job().status = 'retry-needed'; h.job().phase = 'complete';
  await assert.rejects(h.service.status({ uid: 'reader-one', ticket }), { code: 'unavailable' });
});

test('a partial recursive delete retains the marker and retries without deleting Auth', async () => {
  let fail = true;
  const h = fixture({ deleteData({ records, ref }) {
    assert.ok(records.has('accountDeletionJobs/reader-one'), 'the write gate precedes cleanup');
    records.delete(ref.path);
    if (fail) throw Error('sensitive path must not be retained');
    for (const key of records.keys()) if (key.startsWith(ref.path + '/')) records.delete(key);
  } });
  h.seed();
  assert.equal((await h.request()).status, 'retry-needed');
  assert.equal(h.users.has('reader-one'), true);
  assert.equal(h.job().expiresAt, undefined);
  assert.equal(JSON.stringify(h.job()).includes('sensitive'), false);
  fail = false; h.advance(60001);
  await h.service.resume();
  assert.equal(h.job().status, 'complete');
});

test('verification catches descendants beneath a missing root even when recursiveDelete resolves', async () => {
  const h = fixture({ deleteData({ records, ref }) { records.delete(ref.path); } });
  h.seed();
  assert.equal((await h.request()).status, 'retry-needed');
  assert.equal(h.job().phase, 'verifying-data');
  assert.equal(h.users.has('reader-one'), true);
});

test('Auth deletion failures retry and already absent Auth is an idempotent completion', async () => {
  let fail = true;
  const h = fixture({ deleteAuth({ users, uid }) {
    if (fail) throw Error('temporary');
    users.delete(uid);
    throw Object.assign(Error('absent'), { code: 'auth/user-not-found' });
  } });
  h.seed();
  assert.equal((await h.request()).status, 'retry-needed');
  assert.equal(h.job().phase, 'deleting-auth');
  fail = false; h.advance(60001); await h.service.resume();
  assert.equal(h.job().status, 'complete');
});

test('concurrent requests share one live lease and an expired lease resumes after a crash', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ async deleteData({ records, ref }) {
    await pending;
    for (const key of records.keys()) if (key === ref.path || key.startsWith(ref.path + '/')) records.delete(key);
  } });
  h.seed();
  const first = h.request();
  await new Promise(setImmediate);
  assert.equal((await h.request()).status, 'deleting');
  assert.equal(h.calls.filter(call => call[0] === 'delete-data').length, 1);
  release(); await first;
  assert.equal(h.job().status, 'complete');
  const crashed = fixture(); crashed.seed();
  crashed.records.set('accountDeletionJobs/reader-one', { status: 'deleting', phase: 'deleting-data',
    ticketHash: h.job().ticketHash, attempts: 1, createdAt: 1, updatedAt: 1, leaseUntil: 1, leaseToken: 'old', nextAttemptAt: 1 });
  await crashed.service.resume();
  assert.equal(crashed.job().status, 'complete');
});

test('reconciliation prunes only verified completed receipts after seven days and keeps pending gates', async () => {
  const h = fixture(); h.seed(); await h.request();
  await h.service.status({ uid: 'reader-one', ticket, acknowledge: true });
  h.records.set('accountDeletionJobs/reader-two', { status: 'pending', phase: 'queued', ticketHash: h.job().ticketHash,
    nextAttemptAt: Number.MAX_SAFE_INTEGER, expiresAt: new Date(1), createdAt: 1, updatedAt: 1, attempts: 0 });
  h.advance(60 * 60 * 1000); await h.service.resume();
  assert.ok(h.job(), 'the gate survives cached ID token validity');
  h.advance(7 * 24 * 60 * 60 * 1000); await h.service.resume();
  assert.equal(h.job(), undefined);
  assert.ok(h.records.has('accountDeletionJobs/reader-two'), 'pending jobs never expire');
});

test('receipt pruning preserves the gate if Auth or descendants reappear', async () => {
  for (const reappeared of ['auth', 'data']) {
    const h = fixture(); h.seed(); await h.request();
    await h.service.status({ uid: 'reader-one', ticket, acknowledge: true });
    if (reappeared === 'auth') h.users.add('reader-one');
    else h.records.set('users/reader-one/other/missing/children/orphan', { retained: true });
    h.advance(8 * 24 * 60 * 60 * 1000); await h.service.resume();
    assert.ok(h.job());
  }
});

test('pruning rechecks a changed expiry inside its transaction', async () => {
  const h = fixture(); h.seed(); await h.request();
  await h.service.status({ uid: 'reader-one', ticket, acknowledge: true });
  h.advance(8 * 24 * 60 * 60 * 1000);
  const getUser = h.auth.getUser;
  h.auth.getUser = async uid => {
    if (uid === 'reader-one') h.job().expiresAt = new Date(1900000000000);
    return getUser(uid);
  };
  await h.service.resume();
  assert.ok(h.job(), 'a concurrently extended receipt remains retained');
});

test('offline clients retain completion proof until an idempotent cleanup acknowledgment starts retention', async () => {
  const h = fixture(); h.seed(); await h.request();
  h.advance(30 * 24 * 60 * 60 * 1000); await h.service.resume();
  assert.equal(h.job().status, 'complete');
  assert.equal(h.job().expiresAt, undefined);
  assert.equal(h.job().acknowledgedAt, undefined);
  assert.equal((await h.service.status({ uid: 'reader-one', ticket, acknowledge: true })).status, 'complete');
  const acknowledged = structuredClone(h.job());
  h.advance(60 * 60 * 1000);
  assert.equal((await h.service.status({ uid: 'reader-one', ticket, acknowledge: true })).status, 'complete');
  assert.deepEqual(h.job(), acknowledged, 'repeated acknowledgments do not extend the retention clock');
  h.advance(7 * 24 * 60 * 60 * 1000); await h.service.resume();
  assert.equal(h.job(), undefined);
});

test('only an exact completed capability can acknowledge cleanup', async () => {
  const h = fixture({ deleteData() { throw Error('temporary'); } }); h.seed(); await h.request();
  assert.equal(await h.service.status({ uid: 'reader-one', ticket, acknowledge: true }), null);
  assert.equal(h.job().acknowledgedAt, undefined);
  const completed = fixture(); completed.seed(); await completed.request();
  for (const input of [
    { uid: 'reader-one', ticket, acknowledge: false },
    { uid: 'reader-one', ticket, acknowledge: 'true' },
    { uid: 'reader-one', ticket: otherTicket, acknowledge: true },
    { uid: 'reader-one', ticket, acknowledge: true, path: 'users/reader-two' },
  ]) assert.equal(await completed.service.status(input), null);
  assert.equal(completed.job().acknowledgedAt, undefined);
  assert.equal(completed.job().expiresAt, undefined);
});
