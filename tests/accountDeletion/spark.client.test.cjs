const assert = require('node:assert/strict');
const test = require('node:test');
const { createSparkDeletionController } = require('../../account/sparkDeletionController');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const saved = phase => ({ version: 1, uid: 'owner-a', email: 'a@example.test', ticket: 'a'.repeat(64), phase, createdAt: 1234 });
const tick = () => new Promise(setImmediate);
function host(options = {}) {
  let current = { uid: 'owner-a', email: 'a@example.test' }, intent = options.intent || null;
  let marker = options.marker || false, records = options.records ?? 4, watch;
  const calls = [], timers = new Set();
  const h = { calls, timers, get intent() { return intent; }, get records() { return records; }, get user() { return current; },
    setUser(user) { current = user; }, remoteMarker() { marker = true; watch?.(true); } };
  h.controller = createSparkDeletionController({
    enabled: options.enabled !== false, getUser: () => current,
    storage: {
      async loadIntent() { if (options.load) await options.load(); return intent; },
      async saveIntent(next) { calls.push(['save', next.phase]); await options.save?.(next); intent = { ...next }; },
      async removeIntent() { calls.push(['remove']); intent = null; },
      async clearAccountData(value) { calls.push(['local-cleanup', value.uid]); await options.clear?.(); },
    },
    runtime: { blockAccount(uid) { calls.push(['block', uid]); } }, generateTicket: () => 'a'.repeat(64), now: () => 1234,
    async reauthenticate(user, password) { calls.push(['reauth', user.uid]); assert.equal(password, 'dummy-password'); await options.reauth?.(); return { uid: user.uid }; },
    cloud: {
      async getMarker(user) { calls.push(['marker-read', user.uid]); if (options.markerRead) return options.markerRead(); return marker || null; },
      async ensureMarker(user) { calls.push(['marker-create', user.uid]); marker = true; await options.ensure?.(); return true; },
      async cleanup(user, context) { calls.push(['cloud-cleanup', user.uid]); await options.cleanup?.(context); if (!context.isActive()) throw Object.assign(Error(), { code: 'ACCOUNT_DELETION_PAUSED' }); records = 0; },
      async verifyEmpty(user) { calls.push(['verify-empty', user.uid]); return options.verify ? options.verify() : records === 0; },
      watchMarker(user, callback) { watch = callback; return () => { watch = null; }; },
    },
    async deleteAuth(user) { calls.push(['auth-delete', user.uid]); await options.deleteAuth?.(); if (current === user) current = null; },
    schedule(fn) { timers.add(fn); return fn; }, unschedule(fn) { timers.delete(fn); },
  });
  return h;
}
test('Spark deletion remains inert when disabled, including remote marker discovery', async () => {
  const h = host({ enabled: false }); await h.controller.initialize(); await h.controller.ownerChanged();
  await assert.rejects(h.controller.confirm('dummy-password'), { code: 'ACCOUNT_DELETION_NOT_ACTIVE' });
  assert.deepEqual(h.calls, []); assert.equal(h.records, 4);
});
test('password confirmation persists intent before marker, deletes verified cloud data before Auth, and clears device data last', async () => {
  const h = host(); await h.controller.confirm('dummy-password');
  const names = h.calls.map(row => row[0]);
  assert.ok(names.indexOf('reauth') < names.indexOf('marker-create'));
  assert.ok(names.indexOf('save') < names.indexOf('marker-create'));
  assert.ok(names.indexOf('cloud-cleanup') < names.indexOf('verify-empty'));
  assert.ok(names.indexOf('verify-empty') < names.indexOf('auth-delete'));
  assert.ok(names.indexOf('auth-delete') < names.indexOf('local-cleanup'));
  assert.equal(h.records, 0); assert.equal(h.user, null); assert.equal(h.intent, null);
  assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.doesNotMatch(JSON.stringify(h.controller.getSnapshot()), /dummy-password|example\.test|aaaaaa/);
});
test('wrong password cannot create a marker, clear highlights, or delete Auth', async () => {
  const h = host({ reauth: () => { throw Error('private credential diagnostic'); } }); await h.controller.confirm('dummy-password');
  assert.equal(h.intent, null); assert.equal(h.records, 4);
  assert.equal(h.controller.getSnapshot().error, 'ACCOUNT_DELETION_REAUTH_FAILED');
  assert.equal(h.calls.some(row => ['marker-create', 'cloud-cleanup', 'auth-delete', 'local-cleanup'].includes(row[0])), false);
});
test('unverified remaining data prevents Auth deletion and preserves local originals', async () => {
  const h = host({ verify: () => false }); await h.controller.confirm('dummy-password');
  assert.equal(h.controller.getSnapshot().error, 'ACCOUNT_DELETION_DATA_REMAINS');
  assert.ok(h.user); assert.equal(h.intent.phase, 'accepted');
  assert.equal(h.calls.some(row => ['auth-delete', 'local-cleanup'].includes(row[0])), false);
});
test('lost marker response is resolved from the server marker without a second confirmation', async () => {
  const h = host({ ensure: () => { throw Error('response lost'); } }); await h.controller.confirm('dummy-password');
  assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.equal(h.calls.filter(row => row[0] === 'marker-create').length, 1);
  assert.equal(h.calls.filter(row => row[0] === 'reauth').length, 1);
});
test('accepted cleanup resumes after restart without another marker or password', async () => {
  const h = host({ intent: saved('accepted'), marker: true }); await h.controller.initialize();
  assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.equal(h.calls.some(row => ['reauth', 'marker-create'].includes(row[0])), false);
});
test('backgrounding pauses before Auth deletion and foregrounding resumes the same intent', async () => {
  const wait = deferred(); let first = true;
  const h = host({ cleanup: async () => { if (first) { first = false; await wait.promise; } } });
  const operation = h.controller.confirm('dummy-password');
  while (!h.calls.some(row => row[0] === 'cloud-cleanup')) await tick();
  h.controller.background(); wait.resolve(); await operation;
  assert.ok(h.user); assert.equal(h.intent.phase, 'accepted'); assert.equal(h.timers.size, 0);
  assert.equal(h.calls.some(row => row[0] === 'auth-delete'), false);
  await h.controller.foreground(); assert.equal(h.controller.getSnapshot().status, 'complete');
});
test('account switch during password confirmation cannot persist or delete for either account', async () => {
  const wait = deferred(), h = host({ reauth: () => wait.promise });
  const pending = h.controller.confirm('dummy-password');
  while (!h.calls.some(row => row[0] === 'reauth')) await tick();
  const other = { uid: 'owner-b', email: 'b@example.test' }; h.setUser(other); wait.resolve(); await pending;
  assert.equal(h.user, other); assert.equal(h.intent, null); assert.equal(h.records, 4);
});
test('account switch during cleanup stops before Auth deletion and never clears the new owner', async () => {
  const wait = deferred(), h = host({ cleanup: () => wait.promise });
  const pending = h.controller.confirm('dummy-password');
  while (!h.calls.some(row => row[0] === 'cloud-cleanup')) await tick();
  const other = { uid: 'owner-b', email: 'b@example.test' }; h.setUser(other); wait.resolve(); await pending;
  assert.equal(h.user, other); assert.equal(h.intent.uid, 'owner-a');
  assert.equal(h.calls.some(row => ['auth-delete', 'local-cleanup'].includes(row[0])), false);
});
test('a lost Auth deletion response remains unconfirmed rather than treating sign-out as success', async () => {
  const h = host({ deleteAuth: () => { h.setUser(null); throw Error('response lost'); } });
  await h.controller.confirm('dummy-password');
  assert.equal(h.intent.phase, 'auth-pending');
  assert.equal(h.controller.getSnapshot().error, 'ACCOUNT_DELETION_AUTH_UNCONFIRMED');
  assert.equal(h.calls.some(row => row[0] === 'local-cleanup'), false);
  await h.controller.retry(); assert.equal(h.controller.getSnapshot().status, 'retry-needed');
});
test('Auth recent-login failure requests password again without repeating marker creation', async () => {
  let fail = true;
  const h = host({ deleteAuth: () => { if (fail) throw Object.assign(Error(), { code: 'auth/requires-recent-login' }); } });
  await h.controller.confirm('dummy-password'); assert.equal(h.controller.getSnapshot().requiresPassword, true);
  assert.equal(h.intent.phase, 'auth-pending'); fail = false;
  await h.controller.confirm('dummy-password'); assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.equal(h.calls.filter(row => row[0] === 'marker-create').length, 1);
});
test('status retry after a recent-login failure does not issue another Auth delete without password confirmation', async () => {
  const h = host({ deleteAuth: () => { throw Object.assign(Error(), { code: 'auth/requires-recent-login' }); } });
  await h.controller.confirm('dummy-password');
  await h.controller.retry();
  assert.equal(h.calls.filter(row => row[0] === 'auth-delete').length, 1);
  assert.equal(h.controller.getSnapshot().requiresPassword, true);
  assert.equal(h.timers.size, 0);
});
test('quota exhaustion preserves pending proof and originals without a tight automatic retry loop', async () => {
  const h = host({ cleanup: () => { throw Object.assign(Error(), { code: 'ACCOUNT_DELETION_QUOTA' }); } });
  await h.controller.confirm('dummy-password');
  assert.equal(h.controller.getSnapshot().error, 'ACCOUNT_DELETION_QUOTA');
  assert.equal(h.timers.size, 0); assert.equal(h.intent.phase, 'accepted'); assert.equal(h.records, 4);
  assert.equal(h.calls.some(row => ['auth-delete', 'local-cleanup'].includes(row[0])), false);
});
test('a confirmed Auth deletion followed by a failed journal write retries local cleanup without deleting Auth again', async () => {
  let fail = true;
  const h = host({ save: value => { if (value.phase === 'cleanup' && fail) throw Error('secure storage unavailable'); } });
  await h.controller.confirm('dummy-password'); assert.equal(h.intent.phase, 'auth-pending');
  assert.notEqual(h.controller.getSnapshot().status, 'complete'); fail = false;
  await h.controller.retry(); assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.equal(h.calls.filter(row => row[0] === 'auth-delete').length, 1);
});
test('confirmed local cleanup retries after restart without cloud or Auth operations and preserves another login', async () => {
  const h = host({ intent: saved('cleanup') }); const other = { uid: 'owner-b' }; h.setUser(other);
  await h.controller.initialize(); assert.equal(h.user, other); assert.equal(h.intent, null);
  assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.equal(h.calls.some(row => ['marker-read', 'cloud-cleanup', 'verify-empty', 'auth-delete'].includes(row[0])), false);
  assert.deepEqual(h.calls.find(row => row[0] === 'local-cleanup'), ['local-cleanup', 'owner-a']);
});
test('duplicate presses serialize password confirmation and destructive operations', async () => {
  const wait = deferred(), h = host({ reauth: () => wait.promise });
  const first = h.controller.confirm('dummy-password');
  while (!h.calls.some(row => row[0] === 'reauth')) await tick();
  await assert.rejects(h.controller.confirm('dummy-password'), { code: 'ACCOUNT_DELETION_BUSY' });
  wait.resolve(); await first; assert.equal(h.calls.filter(row => row[0] === 'auth-delete').length, 1);
});
test('another device marker is adopted only for the current signed-in owner and fences local sync', async () => {
  const h = host({ marker: true }); await h.controller.initialize();
  assert.equal(h.controller.getSnapshot().status, 'complete');
  assert.ok(h.calls.some(row => row[0] === 'block' && row[1] === 'owner-a'));
  assert.equal(h.calls.some(row => ['reauth', 'marker-create'].includes(row[0])), false);
});
test('a live remote marker triggers deletion recovery without needing Profile to stay open', async () => {
  const h = host(); await h.controller.initialize(); h.remoteMarker();
  for (let count = 0; count < 20 && h.controller.getSnapshot().status !== 'complete'; count++) await tick();
  assert.equal(h.controller.getSnapshot().status, 'complete'); assert.equal(h.intent, null);
});
test('legacy or corrupt journal errors fail closed without cloud discovery or overwriting proof', async () => {
  const h = host({ load: () => { throw Object.assign(Error(), { code: 'ACCOUNT_DELETION_LEGACY_PENDING' }); } });
  await h.controller.initialize();
  await assert.rejects(h.controller.confirm('dummy-password'), { code: 'ACCOUNT_DELETION_STORAGE_FAILED' });
  assert.deepEqual(h.calls, []); assert.equal(h.records, 4);
});
