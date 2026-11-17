const assert = require('node:assert/strict');
const test = require('node:test');
const { createAccountDeletionController } = require('../../account/deletionController');
const ticket = 'a'.repeat(64);
const pending = phase => ({ status: 'pending', phase: phase || 'queued' });
const complete = { status: 'complete', phase: 'complete' };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function host(options = {}) {
  const calls = [], timers = [];
  let user = { uid: 'owner-one', email: 'one@example.test' }, stored = options.intent || null;
  const storage = {
    async loadIntent() { return options.load ? options.load() : stored; },
    async saveIntent(value) { calls.push(['save', value.phase]); stored = { ...value }; await options.save?.(value); },
    async removeIntent(value) { assert.equal(value.uid, stored.uid); assert.equal(value.ticket, stored.ticket); stored = null; calls.push(['remove']); },
    async clearAccountData(value) { calls.push(['clear', value.uid]); await options.clear?.(value); },
  };
  const h = { calls, timers, get intent() { return stored; }, setUser(value) { user = value; } };
  h.controller = createAccountDeletionController({
    enabled: options.enabled !== false, getUser: () => user, storage,
    runtime: { blockAccount(uid) { calls.push(['block', uid]); } },
    async reauthenticate(owner, password) {
      calls.push(['reauth', owner.uid]); assert.equal(password, 'dummy-password');
      await options.reauth?.(); return { uid: owner.uid, idToken: 'dummy-owner-token' };
    }, generateTicket: () => ticket,
    transport: {
      async request(value) { calls.push(['request', value]); return options.request ? options.request(value) : complete; },
      async status(uid, value) { calls.push(['status', uid]); assert.equal(value, ticket); return options.status ? options.status(uid) : complete; },
      async acknowledge(uid, value) { calls.push(['acknowledge', uid]); assert.equal(value, ticket); return options.acknowledge ? options.acknowledge(uid) : complete; },
    },
    async signOut(uid) { assert.equal(user?.uid, uid); calls.push(['signOut', uid]); user = null; },
    onComplete: uid => { calls.push(['complete', uid]); options.onComplete?.(); },
    schedule(fn) { timers.push(fn); return fn; }, unschedule(fn) { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); }, now: () => 1234,
  });
  return h;
}
const intent = phase => ({ version: 1, uid: 'owner-one', email: 'one@example.test', ticket, phase, createdAt: 1234 });

test('inactive production deletion cannot authenticate or write a request', async () => {
  const h = host({ enabled: false });
  await assert.rejects(h.controller.confirm('dummy-password'), { code: 'ACCOUNT_DELETION_NOT_ACTIVE' });
  assert.deepEqual(h.calls, []);
});

test('confirmed deletion persists its ticket before the bound-token request and verifies local cleanup', async () => {
  const h = host(); await h.controller.initialize(); await h.controller.confirm('dummy-password');
  assert.deepEqual(h.calls.map(c => c[0]), ['reauth', 'save', 'block', 'request', 'save', 'clear', 'signOut', 'acknowledge', 'remove', 'complete']);
  const request = h.calls.find(c => c[0] === 'request')[1];
  assert.deepEqual(request, { ticket, idToken: 'dummy-owner-token' });
  assert.equal(h.intent, null);
  assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.doesNotMatch(JSON.stringify(h.controller.getSnapshot()), /dummy-password|dummy-owner-token|aaaaaa|example\.test/);
});

test('rejected password leaves both local data and cloud account untouched', async () => {
  const h = host({ reauth: async () => { throw Error('rejected'); } });
  await h.controller.confirm('dummy-password');
  assert.deepEqual(h.calls.map(c => c[0]), ['reauth']);
  assert.equal(h.controller.getSnapshot().error, 'ACCOUNT_DELETION_REAUTH_FAILED');
});

test('lost response uses the existing ticket without another deletion request', async () => {
  const h = host({ request: async () => { throw Error('connection interrupted'); } });
  await h.controller.confirm('dummy-password');
  assert.equal(h.calls.filter(c => c[0] === 'request').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'status').length, 1);
  assert.equal(h.controller.getSnapshot().status, 'complete');
});

test('pending deletion polls the same job and never reports completion early', async () => {
  const h = host({ request: () => pending() });
  await h.controller.confirm('dummy-password');
  assert.equal(h.controller.getSnapshot().status, 'deleting');
  assert.equal(h.intent.phase, 'accepted');
  assert.equal(h.calls.some(c => c[0] === 'clear'), false);
  h.timers.shift()(); await new Promise(setImmediate);
  assert.equal(h.controller.getSnapshot().status, 'complete');
});

test('restart resumes confirmed cleanup without another deletion request or signing out another account', async () => {
  const h = host({ intent: intent('cleanup') }); h.setUser({ uid: 'other-owner', email: 'other@example.test' });
  await h.controller.initialize();
  assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.equal(h.calls.some(c => ['reauth', 'request', 'status', 'signOut'].includes(c[0])), false);
  assert.deepEqual(h.calls.find(c => c[0] === 'clear'), ['clear', 'owner-one']);
});

test('account switch during reauthentication cannot request deletion for the new account', async () => {
  const wait = deferred(), h = host({ reauth: () => wait.promise });
  const result = h.controller.confirm('dummy-password');
  h.setUser({ uid: 'other-owner', email: 'other@example.test' }); wait.resolve(); await result;
  assert.equal(h.intent, null);
  assert.equal(h.calls.some(c => c[0] === 'request'), false);
});

test('interrupted local cleanup retains its receipt and retries only local cleanup', async () => {
  let fail = true;
  const h = host({ clear: async () => { if (fail) throw Error('storage failed'); } });
  await h.controller.confirm('dummy-password');
  assert.equal(h.controller.getSnapshot().error, 'ACCOUNT_DELETION_LOCAL_CLEANUP_FAILED');
  assert.equal(h.intent.phase, 'cleanup'); fail = false;
  await h.controller.check();
  assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.equal(h.calls.filter(c => c[0] === 'request').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'status').length, 0);
});

test('duplicate submissions cannot create duplicate authentication or deletion requests', async () => {
  const wait = deferred(), h = host({ reauth: () => wait.promise });
  const first = h.controller.confirm('dummy-password');
  await assert.rejects(h.controller.confirm('dummy-password'), { code: 'ACCOUNT_DELETION_BUSY' });
  wait.resolve(); await first;
  assert.equal(h.calls.filter(c => c[0] === 'reauth').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'request').length, 1);
});

test('presentation callback failures cannot relabel verified completion as failure', async () => {
  const h = host({ onComplete: () => { throw Error('view was removed'); } });
  await h.controller.confirm('dummy-password');
  assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.equal(h.intent, null);
});

test('unavailable service retains intent and originals without claiming anything was deleted', async () => {
  const h = host({ request: async () => { throw Error('offline'); }, status: async () => { throw Error('offline'); } });
  await h.controller.confirm('dummy-password');
  assert.equal(h.controller.getSnapshot().status, 'retry-needed');
  assert.equal(h.intent.phase, 'prepared');
  assert.equal(h.calls.some(c => ['clear', 'remove', 'signOut'].includes(c[0])), false);
});

test('initialization is shared and cannot overwrite a concurrent confirmation with stale empty state', async () => {
  const load = deferred(); let loads = 0;
  const h = host({ load: () => { loads++; return load.promise; } });
  const startup = h.controller.initialize();
  const confirmation = h.controller.confirm('dummy-password');
  assert.equal(h.calls.length, 0, 'confirmation waits for durable state');
  load.resolve(null); await startup; await confirmation;
  assert.equal(loads, 1);
  assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.equal(h.intent, null);
});

test('already accepted jobs resume and poll even when creation activation is disabled', async () => {
  const h = host({ enabled: false, intent: intent('accepted'), status: async () => pending() });
  await h.controller.initialize();
  assert.equal(h.controller.getSnapshot().status, 'deleting');
  assert.equal(h.timers.length, 1);
  assert.equal(h.calls.some(c => c[0] === 'request' || c[0] === 'reauth'), false);
  h.controller.background(); assert.equal(h.timers.length, 0);
});

test('an inconsistent complete response cannot erase local originals', async () => {
  const h = host({ request: async () => ({ status: 'complete', phase: 'queued' }) });
  await h.controller.confirm('dummy-password');
  assert.equal(h.controller.getSnapshot().error, 'ACCOUNT_DELETION_STATUS_FAILED');
  assert.equal(h.calls.some(c => ['clear', 'signOut', 'remove'].includes(c[0])), false);
});

test('lost cleanup acknowledgment retains proof for restart and does not issue another deletion', async () => {
  let offline = true;
  const h = host({ acknowledge: async () => { if (offline) throw Error('offline'); return complete; } });
  await h.controller.confirm('dummy-password');
  assert.equal(h.intent.phase, 'cleanup');
  assert.equal(h.controller.getSnapshot().error, 'ACCOUNT_DELETION_LOCAL_CLEANUP_FAILED');
  offline = false; await h.controller.check();
  assert.equal(h.intent, null); assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.equal(h.calls.filter(c => c[0] === 'request').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'acknowledge').length, 2);
});

test('a temporary secure-journal read failure can retry without authenticating or overwriting it', async () => {
  let unavailable = true;
  const h = host({ load: async () => { if (unavailable) throw Error('secure storage unavailable'); return null; } });
  await h.controller.initialize();
  await assert.rejects(h.controller.confirm('dummy-password'), { code: 'ACCOUNT_DELETION_STORAGE_FAILED' });
  assert.deepEqual(h.calls, []);
  unavailable = false; await h.controller.retry();
  assert.equal(h.controller.getSnapshot().status, 'idle');
  await h.controller.confirm('dummy-password');
  assert.equal(h.controller.getSnapshot().status, 'complete');
});

test('an expired receipt permits cleanup only with durable proof of already confirmed server deletion', async () => {
  const absent = () => { throw Object.assign(Error('not found'), { code: 'ACCOUNT_DELETION_RECEIPT_NOT_FOUND' }); };
  const completed = host({ intent: intent('cleanup'), acknowledge: absent });
  await completed.controller.initialize();
  assert.equal(completed.controller.getSnapshot().status, 'complete');
  assert.equal(completed.intent, null);
  for (const phase of ['prepared', 'accepted']) {
    const uncertain = host({ intent: intent(phase), status: absent });
    await uncertain.controller.initialize();
    assert.equal(uncertain.controller.getSnapshot().status, 'retry-needed');
    assert.equal(uncertain.calls.some(c => ['clear', 'signOut', 'remove'].includes(c[0])), false);
    uncertain.controller.background();
  }
});

test('retry checks a possibly accepted request before reauthenticating an already deleted sign-in', async () => {
  let online = false;
  const h = host({
    request: async () => { throw Error('response lost'); },
    status: async () => { if (!online) throw Error('offline'); return complete; },
  });
  await h.controller.confirm('dummy-password');
  assert.equal(h.intent.phase, 'prepared');
  online = true;
  await h.controller.retry('dummy-password');
  assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.equal(h.calls.filter(c => c[0] === 'reauth').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'request').length, 1);
});

test('unresolved prepared requests allow status-only retry without another password or delete request', async () => {
  const h = host({ request: async () => { throw Error('response lost'); }, status: async () => { throw Error('offline'); } });
  await h.controller.confirm('dummy-password');
  await h.controller.retry();
  await h.controller.retry('dummy-password');
  assert.equal(h.intent.phase, 'prepared');
  assert.equal(h.calls.filter(c => c[0] === 'reauth').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'request').length, 1);
});
