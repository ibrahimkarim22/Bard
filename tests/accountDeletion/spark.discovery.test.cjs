const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, deleteUser } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, collection, query, limit, getDocsFromServer,
  doc, setDoc, serverTimestamp, terminate } = require('firebase/firestore');

const projectId = 'demo-bard-spark-deletion';
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Use the fixed Spark deletion emulator runner');
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, projectId);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8181');
const base = 'http://127.0.0.1:8181/v1/projects/' + projectId + '/databases/(default)/documents';
const run = Date.now().toString(36) + '-' + randomBytes(4).toString('hex');
const clients = [];

async function owner(label) {
  const app = initializeApp({ projectId, apiKey: 'demo-spark-deletion-key' }, label + '-' + run);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9198', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8181);
  const { user } = await createUserWithEmailAndPassword(auth, label + '-' + run + '@example.test', 'emulator-only-password-17');
  const client = { app, auth, db, user, uid: user.uid, seeded: [] };
  clients.push(client);
  await setDoc(doc(db, 'users', user.uid), { userId: user.uid, completedLevel: 0, profileImage: 'fixture' });
  return client;
}
async function request(path, token, { method = 'GET', body } = {}) {
  const result = await fetch(base + path, { method,
    headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: result.status, body: await result.json() };
}
async function seed(client, suffix) {
  const name = '/users/' + client.uid + '/' + suffix;
  const response = await request(name, 'owner', { method: 'PATCH', body: { fields: { fixture: { booleanValue: true } } } });
  assert.equal(response.status, 200, 'Owned emulator fixture seed failed');
  client.seeded.push(name);
  return 'projects/' + projectId + '/databases/(default)/documents' + name;
}
async function group(client, targetUid, collectionId, pageSize = 100, after) {
  return request((targetUid ? '/users/' + targetUid : '') + ':runQuery', await client.user.getIdToken(), {
    method: 'POST', body: { structuredQuery: { from: [{ collectionId, allDescendants: true }], limit: pageSize,
      select: { fields: [{ fieldPath: '__name__' }] },
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      ...(after ? { startAt: { values: [{ referenceValue: after }], before: false } } : {}) } },
  });
}

test.after(async () => {
  for (const client of clients) {
    for (const suffix of [...client.seeded, '/users/' + client.uid, '/accountDeletions/' + client.uid]) {
      const response = await fetch(base + suffix, { method: 'DELETE', headers: { authorization: 'Bearer owner' } });
      assert.ok(response.status === 200 || response.status === 404, 'Owned emulator fixture cleanup failed');
    }
    await deleteUser(client.user);
    await terminate(client.db);
    await deleteApp(client.app);
  }
});

test('ordinary metadata queries cannot discover a missing-parent historical work', async () => {
  const client = await owner('missing-parent');
  await seed(client, 'highlightWorks/historical-work-without-parent/highlights/fixture');
  const metadata = await getDocsFromServer(query(collection(client.db, 'users', client.uid, 'highlightWorks'), limit(100)));
  assert.equal(metadata.size, 0);
});

// Characterize this fixed emulator's metadata authorization separately from the
// supported ancestor-scoped data query used by account cleanup.
test('the fixed emulator rejects collection metadata discovery with a Firebase user token', async () => {
  const client = await owner('metadata-api');
  await seed(client, 'highlightWorks/orphan-work/highlights/fixture');
  const token = await client.user.getIdToken();
  const collectionIds = await request('/users/' + client.uid + ':listCollectionIds', token, { method: 'POST', body: { pageSize: 100 } });
  const missing = await request('/users/' + client.uid + '/highlightWorks?pageSize=100&showMissing=true', token);
  assert.equal(collectionIds.status, 403, 'Collection discovery must not rely on admin-only metadata access');
  assert.equal(missing.status, 403, 'Missing-parent listing must not rely on admin-only metadata access');
  assert.match(collectionIds.body.error?.message || '', /metadata operations require admin authentication/i);
  assert.match(missing.body.error?.message || '', /metadata operations require admin authentication/i);
});

test('scoped descendant queries discover orphan highlight and receipt paths only for the deleting owner', async () => {
  const client = await owner('scoped-groups');
  const other = await owner('scoped-other');
  const highlight = await seed(client, 'highlightWorks/unknown-historical-work/highlights/orphan');
  const operation = await seed(client, 'highlightWorks/unknown-historical-work/operations/receipt');
  await seed(other, 'highlightWorks/other-work/highlights/other');
  assert.equal((await group(client, client.uid, 'highlights')).status, 403, 'Cleanup discovery is unavailable before deletion begins');
  await setDoc(doc(client.db, 'accountDeletions', client.uid), { schemaVersion: 1, status: 'deleting', startedAt: serverTimestamp() });
  const highlights = await group(client, client.uid, 'highlights');
  const operations = await group(client, client.uid, 'operations');
  assert.equal(highlights.status, 200, 'Deleting owner must discover orphan highlights');
  assert.equal(operations.status, 200, 'Deleting owner must discover orphan receipts');
  assert.deepEqual(highlights.body.flatMap(row => row.document ? [row.document.name] : []), [highlight]);
  assert.deepEqual(operations.body.flatMap(row => row.document ? [row.document.name] : []), [operation]);
  assert.equal((await group(client, other.uid, 'highlights')).status, 403, 'An ancestor-scoped query may not cross to another owner');
  assert.equal((await group(other, client.uid, 'highlights')).status, 403, 'Another owner may not discover a deleting owner');
  assert.equal((await group(client, null, 'highlights')).status, 403, 'Project-root group queries may not enumerate other owners');
  assert.equal((await group(client, null, 'operations')).status, 403, 'Project-root receipt queries may not enumerate other owners');
  assert.equal((await group(client, client.uid, 'highlights', 101)).status, 403, 'Cleanup discovery must retain its bounded page limit');
});

test('scoped descendant discovery supports name-only bounded pages with an exclusive cursor', async () => {
  const client = await owner('scoped-pagination');
  const paths = [];
  for (const id of ['a', 'b', 'c']) paths.push(await seed(client, 'highlightWorks/missing-parent/highlights/' + id));
  await setDoc(doc(client.db, 'accountDeletions', client.uid), { schemaVersion: 1, status: 'deleting', startedAt: serverTimestamp() });
  const first = await group(client, client.uid, 'highlights', 2);
  assert.equal(first.status, 200);
  const firstRows = first.body.flatMap(row => row.document ? [row.document] : []);
  assert.deepEqual(firstRows.map(row => row.name), paths.slice(0, 2));
  assert.ok(firstRows.every(row => !row.fields || Object.keys(row.fields).length === 0), 'Discovery must not download quotation contents');
  const next = await group(client, client.uid, 'highlights', 2, paths[1]);
  assert.equal(next.status, 200);
  assert.deepEqual(next.body.flatMap(row => row.document ? [row.document.name] : []), [paths[2]]);
});
