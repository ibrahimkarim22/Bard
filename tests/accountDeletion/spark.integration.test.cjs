const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  EmailAuthProvider, reauthenticateWithCredential, deleteUser } = require('firebase/auth');
const sdk = require('firebase/firestore');
const { createSparkDeletionController } = require('../../account/sparkDeletionController');
const { createSparkDeletionCloud } = require('../../account/sparkDeletionCloud');
const { createDeletionStorage } = require('../../account/deletionStorage');
const { runAuthMutation } = require('../../account/authMutationGate');
const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
const { cloudKeyFor, planServerMutation } = require('../../reader/highlightSyncProtocol');

const projectId = 'demo-bard-spark-deletion';
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Use the fixed Spark deletion emulator runner');
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, projectId);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8181');
const resource = 'projects/' + projectId + '/databases/(default)/documents';
const base = 'http://127.0.0.1:8181/v1/' + resource;
const authBase = 'http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/projects/' + projectId;
const run = Date.now().toString(36) + '-' + randomBytes(4).toString('hex');
const password = 'emulator-only-password-17';
const clients = [], controllers = [];

// The owner bearer is accepted only by this guarded demo emulator. It seeds,
// verifies and removes exact synthetic fixtures; application operations below
// always use the actual signed-in Firebase user's SDK credentials.
async function administrativeRequest(url, method, body) {
  const response = await fetch(url, { method, headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
const documentUrl = recordPath => base + '/' + recordPath.split('/').map(encodeURIComponent).join('/');
async function inspect(recordPath) {
  const result = await administrativeRequest(documentUrl(recordPath), 'GET');
  return { exists: result.status === 200, status: result.status, fields: result.body.fields };
}
async function authExists(uid) {
  const result = await administrativeRequest(authBase + '/accounts:lookup', 'POST', { localId: [uid] });
  assert.equal(result.status, 200, 'Synthetic account lookup failed');
  return (result.body.users || []).some(user => user.localId === uid);
}
async function owner(label) {
  const app = initializeApp({ projectId, apiKey: 'demo-spark-deletion-key' }, label + '-' + run);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9198', { disableWarnings: true });
  const db = sdk.getFirestore(app);
  sdk.connectFirestoreEmulator(db, '127.0.0.1', 8181);
  const email = label + '-' + run + '@example.test';
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  const client = { app, auth, db, user, uid: user.uid, email, paths: new Set() };
  clients.push(client);
  const root = 'users/' + user.uid;
  await sdk.setDoc(sdk.doc(db, root), { userId: user.uid, completedLevel: 1, profileImage: 'fixture-profile' });
  client.paths.add(root);
  return client;
}
async function seed(client, suffixes) {
  const recordPaths = suffixes.map(suffix => 'users/' + client.uid + '/' + suffix);
  const response = await administrativeRequest(base + ':commit', 'POST', { writes: recordPaths.map(recordPath => ({
    update: { name: resource + '/' + recordPath, fields: { fixture: { stringValue: 'synthetic retained value' } } },
  })) });
  assert.equal(response.status, 200, 'Synthetic record seed failed');
  for (const recordPath of recordPaths) client.paths.add(recordPath);
  return recordPaths;
}
async function seedHighlight(client) {
  const canonical = buildCanonicalDocument({
    play: { id: 'hamlet', contentVersion: 'a'.repeat(64), canonicalTextVersion: '1', sections: [{ id: 'scene' }] },
    sections: [{ work: { id: 'hamlet' }, contentVersion: 'a'.repeat(64), canonicalTextVersion: '1',
      section: { id: 'scene' }, content: [{ id: 'paragraph', text: 'Alpha beta gamma delta', separatorAfter: '' }] }],
  });
  const selectionRef = createSelection(canonical, 0, 5);
  const operation = { schemaVersion: 1, operationId: 'fixture-initial', uid: client.uid, workId: 'hamlet',
    cloudKey: cloudKeyFor(selectionRef), kind: 'create', selectionRef, colorId: 'sage', generation: 1, baseRevision: 0 };
  const plan = planServerMutation({ operation, serverTimestamp: sdk.serverTimestamp() });
  const root = 'users/' + client.uid + '/highlightWorks/hamlet';
  const values = [[root, plan.metadata], [root + '/highlights/' + operation.cloudKey, plan.cloud],
    [root + '/operations/' + operation.operationId, plan.receipt]];
  const batch = sdk.writeBatch(client.db);
  for (const [recordPath, value] of values) { batch.set(sdk.doc(client.db, recordPath), value); client.paths.add(recordPath); }
  await batch.commit();
}
function localState(client, other) {
  const originalKey = '@bard/reader-highlights-sync:account-v2/v2/' + encodeURIComponent(client.uid) + '/hamlet/original';
  const otherKey = '@bard/reader-highlights-sync:account-v2/v2/' + encodeURIComponent(other?.uid || 'unrelated-fixture-owner') + '/hamlet/original';
  const data = new Map([[originalKey, 'original local quotation'], [otherKey, 'other local quotation']]);
  const secure = new Map([['userinfo', JSON.stringify({ uid: client.uid, email: client.email, password })]]);
  const purged = [], blocked = [];
  const runtime = {
    blockAccount(uid) { blocked.push(uid); },
    async purgeAccount(uid) {
      purged.push(uid);
      const prefix = '@bard/reader-highlights-sync:account-v2/v2/' + encodeURIComponent(uid) + '/';
      for (const key of data.keys()) if (key.startsWith(prefix)) data.delete(key);
    },
  };
  const storage = { async getAllKeys() { return [...data.keys()]; } };
  const secureStore = {
    async getItemAsync(key) { return secure.get(key) ?? null; },
    async setItemAsync(key, value) { secure.set(key, value); },
    async deleteItemAsync(key) { secure.delete(key); },
  };
  return { data, secure, runtime, storage, secureStore, purged, blocked, originalKey, otherKey };
}
function device(client, { local = localState(client), afterCommit, deleteAuth, cloudChanges } = {}) {
  const calls = [];
  const storage = createDeletionStorage({ ...local, mode: 'spark' });
  let controller, commits = 0;
  const fixtureSdk = afterCommit ? { ...sdk, writeBatch(db) {
    const actual = sdk.writeBatch(db);
    return { delete(ref) { actual.delete(ref); return this; }, async commit() {
      await actual.commit(); await afterCommit({ count: ++commits, controller });
    } };
  } } : sdk;
  const actualCloud = createSparkDeletionCloud({ db: client.db, sdk: fixtureSdk, projectId,
    baseUrl: 'http://127.0.0.1:8181/v1', getUser: () => client.auth.currentUser });
  const timers = new Set();
  controller = createSparkDeletionController({
    enabled: true, getUser: () => client.auth.currentUser, storage, runtime: local.runtime,
    cloud: { ...actualCloud, ...cloudChanges }, generateTicket: () => randomBytes(32).toString('hex'),
    async reauthenticate(user, secret) {
      calls.push(['reauth', user.uid]);
      const response = await runAuthMutation(() => reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, secret)));
      return { uid: response.user.uid };
    },
    async deleteAuth(user) {
      calls.push(['auth-delete', user.uid]);
      await runAuthMutation(async () => {
        if (client.auth.currentUser !== user) throw Object.assign(Error(), { code: 'ACCOUNT_DELETION_OTHER_ACCOUNT' });
        if (deleteAuth) await deleteAuth(user);
        else await deleteUser(user);
      });
    },
    schedule(callback) { timers.add(callback); return callback; }, unschedule(callback) { timers.delete(callback); },
  });
  controllers.push(controller);
  return { controller, local, storage, cloud: actualCloud, calls, timers };
}
async function assertRecordsAbsent(client) {
  for (const recordPath of client.paths) assert.equal((await inspect(recordPath)).status, 404, 'A synthetic owner record remains');
}
async function marker(client) { return inspect('accountDeletions/' + client.uid); }

test.after(async () => {
  for (const controller of controllers) controller.background();
  for (const client of clients) {
    for (const recordPath of [...client.paths, 'accountDeletions/' + client.uid]) {
      const result = await administrativeRequest(documentUrl(recordPath), 'DELETE');
      assert.ok([200, 404].includes(result.status), 'Synthetic document cleanup failed');
    }
    const result = await administrativeRequest(authBase + '/accounts:delete', 'POST', { localId: client.uid });
    assert.ok(result.status === 200 || result.body.error?.message === 'USER_NOT_FOUND', 'Synthetic Auth cleanup failed');
    await sdk.terminate(client.db);
    await deleteApp(client.app);
  }
});

test('Spark cleanup removes real owner data and Auth after verification, including orphan receipts, while preserving another owner', async t => {
  const client = await owner('complete');
  const other = await owner('complete-other');
  await seedHighlight(client); await seedHighlight(other);
  await sdk.setDoc(sdk.doc(client.db, 'users', client.uid, 'quizzes', '1'), { completed: true });
  client.paths.add('users/' + client.uid + '/quizzes/1');
  await seed(client, ['highlightWorks/archived-work-without-metadata/highlights/orphan',
    ...Array.from({ length: 103 }, (_, index) => 'highlightWorks/archived-work-without-metadata/operations/receipt-' + String(index).padStart(3, '0'))]);
  const beforeOther = await Promise.all([...other.paths].map(inspect));
  const d = device(client, { local: localState(client, other) });
  await d.controller.confirm(password);
  assert.equal(d.controller.getSnapshot().status, 'complete');
  assert.equal(client.auth.currentUser, null);
  assert.equal(await authExists(client.uid), false);
  assert.equal(await authExists(other.uid), true);
  await assertRecordsAbsent(client);
  assert.deepEqual(await Promise.all([...other.paths].map(inspect)), beforeOther);
  assert.deepEqual(d.local.purged, [client.uid]);
  assert.equal(d.local.data.has(d.local.originalKey), false);
  assert.equal(d.local.data.get(d.local.otherKey), 'other local quotation');
  assert.equal(await d.storage.loadIntent(), null);
  assert.equal(d.local.secure.has('userinfo'), false);
  const retained = await marker(client);
  assert.equal(retained.exists, true);
  assert.deepEqual(Object.keys(retained.fields).sort(), ['schemaVersion', 'startedAt', 'status']);
  assert.deepEqual(d.calls.filter(([kind]) => kind === 'auth-delete'), [['auth-delete', client.uid]]);
  t.diagnostic('Completed cleanup included 104 immutable receipts and two highlight records across a missing metadata parent.');
});

test('interrupted cleanup retains the same secure journal and local originals, then a fresh controller resumes without another marker', async () => {
  const client = await owner('interrupted');
  await seed(client, Array.from({ length: 103 }, (_, index) => 'highlightWorks/orphan-work/operations/receipt-' + String(index).padStart(3, '0')));
  const first = device(client, { afterCommit: ({ count, controller }) => { if (count === 1) controller.background(); } });
  await first.controller.confirm(password);
  assert.equal(first.controller.getSnapshot().status, 'paused');
  const intent = await first.storage.loadIntent();
  assert.equal(intent.phase, 'accepted');
  assert.equal(await authExists(client.uid), true);
  assert.equal(first.local.data.get(first.local.originalKey), 'original local quotation');
  assert.deepEqual(first.local.purged, []);
  assert.equal(first.calls.some(([kind]) => kind === 'auth-delete'), false);
  const remaining = await administrativeRequest(base + '/users/' + client.uid + '/highlightWorks/orphan-work/operations?pageSize=1000', 'GET');
  assert.equal(remaining.status, 200);
  assert.equal(remaining.body.documents.length, 3);
  const originalMarker = await marker(client);
  const second = device(client, { local: first.local });
  await second.controller.initialize();
  assert.equal(second.controller.getSnapshot().status, 'complete');
  assert.equal(second.calls.some(([kind]) => kind === 'reauth'), false);
  assert.deepEqual(await marker(client), originalMarker);
  assert.equal(await authExists(client.uid), false);
  await assertRecordsAbsent(client);
  assert.equal(await second.storage.loadIntent(), null);
});

test('switching the active Auth account during cleanup stops destructive work and preserves both local owners', async () => {
  const client = await owner('switch-source');
  const other = await owner('switch-target');
  await seedHighlight(other);
  await seed(client, Array.from({ length: 103 }, (_, index) => 'highlightWorks/orphan-work/operations/receipt-' + String(index).padStart(3, '0')));
  const beforeOther = await Promise.all([...other.paths].map(inspect));
  const local = localState(client, other);
  const d = device(client, { local, async afterCommit({ count }) {
    if (count === 1) await runAuthMutation(() => signInWithEmailAndPassword(client.auth, other.email, password));
  } });
  await d.controller.confirm(password);
  assert.equal(client.auth.currentUser.uid, other.uid);
  assert.equal(d.controller.getSnapshot().error, 'ACCOUNT_DELETION_OTHER_ACCOUNT');
  assert.equal((await d.storage.loadIntent()).uid, client.uid);
  assert.equal(d.calls.some(([kind]) => kind === 'auth-delete'), false);
  assert.deepEqual(local.purged, []);
  assert.equal(local.data.size, 2);
  assert.equal(await authExists(client.uid), true);
  assert.equal(await authExists(other.uid), true);
  assert.deepEqual(await Promise.all([...other.paths].map(inspect)), beforeOther);
});

test('a lost successful Auth response remains unconfirmed and retains local originals instead of inferring success from sign-out', async () => {
  const client = await owner('lost-auth-response');
  await seedHighlight(client);
  const d = device(client, { async deleteAuth(user) { await deleteUser(user); throw Object.assign(Error(), { code: 'unavailable' }); } });
  await d.controller.confirm(password);
  assert.equal(await authExists(client.uid), false);
  await assertRecordsAbsent(client);
  assert.equal(client.auth.currentUser, null);
  assert.equal(d.controller.getSnapshot().status, 'retry-needed');
  assert.equal(d.controller.getSnapshot().error, 'ACCOUNT_DELETION_AUTH_UNCONFIRMED');
  assert.equal((await d.storage.loadIntent()).phase, 'auth-pending');
  assert.equal(d.local.data.get(d.local.originalKey), 'original local quotation');
  assert.deepEqual(d.local.purged, []);
  await d.controller.retry();
  assert.notEqual(d.controller.getSnapshot().status, 'complete');
  assert.equal((await d.storage.loadIntent()).phase, 'auth-pending');
  assert.equal(d.calls.filter(([kind]) => kind === 'auth-delete').length, 1);
});

test('actual SDK password reauthentication fails before any marker, cloud cleanup or Auth deletion when the password is wrong', async () => {
  const client = await owner('wrong-password');
  await seedHighlight(client);
  const original = await Promise.all([...client.paths].map(inspect));
  const d = device(client);
  await d.controller.confirm('incorrect-emulator-password');
  assert.equal(d.controller.getSnapshot().error, 'ACCOUNT_DELETION_REAUTH_FAILED');
  assert.equal(d.controller.getSnapshot().requiresPassword, true);
  assert.equal(await d.storage.loadIntent(), null);
  assert.equal((await marker(client)).exists, false);
  assert.equal(await authExists(client.uid), true);
  assert.deepEqual(await Promise.all([...client.paths].map(inspect)), original);
  assert.equal(d.calls.some(([kind]) => kind === 'auth-delete'), false);
  assert.equal(d.local.data.get(d.local.originalKey), 'original local quotation');
});

test('unexpected descendant shapes stop cleanup before Auth or local deletion', async () => {
  const client = await owner('unexpected-shape');
  const [unexpected] = await seed(client, ['unrelated/missing-parent/highlights/unexpected']);
  const d = device(client);
  await d.controller.confirm(password);
  assert.equal(d.controller.getSnapshot().error, 'ACCOUNT_DELETION_SCHEMA_UNSUPPORTED');
  assert.equal(await authExists(client.uid), true);
  assert.equal((await inspect(unexpected)).exists, true);
  assert.equal(d.calls.some(([kind]) => kind === 'auth-delete'), false);
  assert.deepEqual(d.local.purged, []);
  assert.equal(d.local.data.get(d.local.originalKey), 'original local quotation');
});

test('REST data pages contain only bounded document entries and empty pages retain a read-time envelope', async t => {
  const client = await owner('page-envelope');
  await seed(client, Array.from({ length: 101 }, (_, index) => 'highlightWorks/orphan-work/operations/receipt-' + String(index).padStart(3, '0')));
  const cloud = createSparkDeletionCloud({ db: client.db, sdk, projectId, getUser: () => client.auth.currentUser,
    baseUrl: 'http://127.0.0.1:8181/v1' });
  await cloud.ensureMarker(client.user);
  const token = await client.user.getIdToken();
  const request = async collectionId => {
    const response = await fetch(base + '/users/' + client.uid + ':runQuery', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: true }],
        select: { fields: [{ fieldPath: '__name__' }] }, limit: 100 } }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const nonempty = await request('operations');
  const empty = await request('highlights');
  const documentCount = nonempty.filter(row => row.document).length;
  assert.equal(documentCount, 100);
  assert.equal(nonempty.length, 100);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].document, undefined);
  assert.equal(typeof empty[0].readTime, 'string');
  t.diagnostic('100-document page: ' + nonempty.length + ' entries; empty page: ' + empty.length + ' read-time-only entry.');
});
