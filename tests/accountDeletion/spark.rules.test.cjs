const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const {
  collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp,
  setDoc, updateDoc, writeBatch,
} = require('firebase/firestore');
const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
const { cloudKeyFor, planServerMutation } = require('../../reader/highlightSyncProtocol');

const projectId = 'demo-bard-spark-deletion';
const runId = Date.now().toString(36);
let environment;
let counter = 0;

test.before(async () => {
  assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Use the isolated Spark deletion runner');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8181');
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1', port: 8181,
      rules: fs.readFileSync(path.resolve(__dirname, '../../firebase/account-deletion/spark.rules'), 'utf8'),
    },
  });
});

test.after(async () => { if (environment) await environment.cleanup(); });

function owner(label, claims = { auth_time: Math.floor(Date.now() / 1000) }) {
  const uid = label + '-' + runId + '-' + ++counter;
  const db = environment.authenticatedContext(uid, claims).firestore();
  return { uid, db, root: 'users/' + uid, marker: doc(db, 'accountDeletions/' + uid) };
}

const markerData = () => ({ schemaVersion: 1, status: 'deleting', startedAt: serverTimestamp() });

async function seed(records) {
  await environment.withSecurityRulesDisabled(async context => {
    for (const [recordPath, value] of Object.entries(records)) {
      await setDoc(doc(context.firestore(), recordPath), value);
    }
  });
}

async function highlight(f, overrides = {}) {
  const canonical = buildCanonicalDocument({
    play: { id: 'hamlet', contentVersion: 'a'.repeat(64), canonicalTextVersion: '1', sections: [{ id: 'scene' }] },
    sections: [{ work: { id: 'hamlet' }, contentVersion: 'a'.repeat(64), canonicalTextVersion: '1',
      section: { id: 'scene' }, content: [{ id: 'paragraph', text: 'Alpha beta gamma delta', separatorAfter: '' }] }],
  });
  const selectionRef = createSelection(canonical, 0, 5);
  const operation = {
    schemaVersion: 1, operationId: 'operation-' + ++counter, uid: f.uid,
    workId: 'hamlet', cloudKey: cloudKeyFor(selectionRef), kind: 'create',
    selectionRef, colorId: 'yellow', generation: 1, baseRevision: 0, ...overrides,
  };
  const base = f.root + '/highlightWorks/hamlet';
  const paths = {
    cloud: base + '/highlights/' + operation.cloudKey,
    metadata: base,
    receipt: base + '/operations/' + operation.operationId,
  };
  const values = await Promise.all(Object.values(paths).map(p => getDoc(doc(f.db, p))));
  const plan = planServerMutation({
    operation,
    cloud: values[0].exists() ? values[0].data() : null,
    metadata: values[1].exists() ? values[1].data() : null,
    receipt: values[2].exists() ? values[2].data() : null,
    serverTimestamp: serverTimestamp(),
  });
  const batch = writeBatch(f.db);
  for (const key of ['cloud', 'metadata', 'receipt']) batch.set(doc(f.db, paths[key]), plan[key]);
  return { paths, batch, operation };
}

test('ordinary owner profile, quiz and atomic highlight operations retain their existing grants', async () => {
  const f = owner('normal');
  await assertSucceeds(setDoc(doc(f.db, f.root), { userId: f.uid, completedLevel: 0, profileImage: 'fixture' }));
  await assertSucceeds(updateDoc(doc(f.db, f.root), { completedLevel: 1 }));
  await assertSucceeds(setDoc(doc(f.db, f.root + '/quizzes/1'), { completed: true }));
  await assertSucceeds(getDocs(collection(f.db, f.root + '/quizzes')));
  const created = await highlight(f);
  await assertSucceeds(created.batch.commit());
  await assertSucceeds(getDocs(query(collection(f.db, f.root + '/highlightWorks'), limit(1001))));
  await assertSucceeds(getDocs(query(collection(f.db, f.root + '/highlightWorks/hamlet/highlights'), limit(1001))));
  await assertFails(getDocs(query(collection(f.db, f.root + '/highlightWorks/hamlet/operations'), limit(1))));
  await assertFails(deleteDoc(doc(f.db, created.paths.cloud)));
  await assertFails(deleteDoc(doc(f.db, created.paths.receipt)));
  await assertFails(deleteDoc(doc(f.db, created.paths.metadata)));
  const recolored = await highlight(f, { kind: 'recolor', colorId: 'blue', baseRevision: 1 });
  await assertSucceeds(recolored.batch.commit());
  assert.equal((await getDoc(doc(f.db, created.paths.cloud))).data().colorId, 'blue');
  const deleted = await highlight(f, { kind: 'delete', baseRevision: 2 });
  await assertSucceeds(deleted.batch.commit());
  assert.equal((await getDoc(doc(f.db, created.paths.cloud))).data().deleted, true);
  const recreated = await highlight(f, { kind: 'recreate', colorId: 'rose', baseRevision: 3, generation: 2 });
  await assertSucceeds(recreated.batch.commit());
  const restored = (await getDoc(doc(f.db, created.paths.cloud))).data();
  assert.equal(restored.deleted, false);
  assert.equal(restored.generation, 2);
  assert.equal(restored.serverRevision, 4);
  assert.equal(restored.colorId, 'rose');
  await assertSucceeds(deleteDoc(doc(f.db, f.root + '/quizzes/1')));
});

test('only a recently authenticated owner can create an exact immutable deletion marker', async () => {
  const f = owner('marker');
  await assertSucceeds(getDoc(f.marker));
  const stranger = environment.authenticatedContext('marker-stranger', { auth_time: Math.floor(Date.now() / 1000) }).firestore();
  await assertFails(setDoc(doc(stranger, f.marker.path), markerData()));
  await assertFails(setDoc(doc(environment.unauthenticatedContext().firestore(), f.marker.path), markerData()));
  await assertSucceeds(setDoc(f.marker, markerData()));
  const data = (await getDoc(f.marker)).data();
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.status, 'deleting');
  assert.ok(data.startedAt.toMillis() > Date.now() - 60_000);
  await assertFails(updateDoc(f.marker, { status: 'complete' }));
  await assertFails(setDoc(f.marker, markerData()));
  await assertFails(deleteDoc(f.marker));
  await assertFails(getDocs(query(collection(f.db, 'accountDeletions'), limit(1))));
});

test('stale, missing, malformed and future authentication times cannot initiate deletion', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [{ auth_time: now - 601 }, { auth_time: now + 60 }, { auth_time: 'recent' }, {}]) {
    const f = owner('authentication', claims);
    await assertFails(setDoc(f.marker, markerData()));
  }
});

test('malformed markers, supplied historical timestamps and extra fields are rejected', async () => {
  const invalid = [
    { schemaVersion: 2, status: 'deleting', startedAt: serverTimestamp() },
    { schemaVersion: 1, status: 'complete', startedAt: serverTimestamp() },
    { schemaVersion: 1, status: 'deleting', startedAt: new Date(0) },
    { schemaVersion: 1, status: 'deleting' },
    { ...markerData(), password: 'dummy-forbidden' },
    { ...markerData(), uid: 'other' },
  ];
  for (const value of invalid) {
    const f = owner('malformed');
    await assertFails(setDoc(f.marker, value));
  }
});

test('a marker fences profile, quiz and highlight writes including stale same-owner sessions', async () => {
  const f = owner('fenced');
  await setDoc(doc(f.db, f.root), { completedLevel: 1 });
  const created = await highlight(f);
  await created.batch.commit();
  const preparedRecolor = await highlight(f, { kind: 'recolor', colorId: 'rose', baseRevision: 1 });
  const stale = environment.authenticatedContext(f.uid, { auth_time: Math.floor(Date.now() / 1000) - 3600 }).firestore();
  await setDoc(f.marker, markerData());
  await assertFails(updateDoc(doc(f.db, f.root), { completedLevel: 2 }));
  await assertFails(setDoc(doc(f.db, f.root + '/quizzes/new'), { completed: true }));
  await assertFails(preparedRecolor.batch.commit());
  await assertFails(updateDoc(doc(stale, f.root), { completedLevel: 3 }));
  await assertFails(setDoc(doc(stale, f.root + '/quizzes/stale'), { completed: true }));
  await assertSucceeds(getDoc(doc(f.db, created.paths.cloud)));
});

test('marker creation cannot share a batch with an ordinary profile or quiz write', async () => {
  for (const suffix of ['', '/quizzes/new']) {
    const f = owner('atomic-fence');
    const batch = writeBatch(f.db);
    batch.set(f.marker, markerData());
    batch.set(doc(f.db, f.root + suffix), { completedLevel: 1 });
    await assertFails(batch.commit());
    assert.equal((await getDoc(f.marker)).exists(), false);
  }
});

test('marker creation cannot share a batch with a valid atomic highlight mutation', async () => {
  const f = owner('atomic-highlight-fence');
  const planned = await highlight(f);
  planned.batch.set(f.marker, markerData());
  await assertFails(planned.batch.commit());
  assert.equal((await getDoc(f.marker)).exists(), false);
});

test('cleanup can bounded-list and remove only the known owner schema including orphan descendants', async () => {
  const f = owner('cleanup');
  const records = {
    [f.root]: { completedLevel: 1 },
    [f.root + '/quizzes/1']: { completed: true },
    [f.root + '/highlightWorks/hamlet']: { revision: 1 },
    [f.root + '/highlightWorks/hamlet/highlights/active']: { exact: 'active' },
    [f.root + '/highlightWorks/hamlet/highlights/deleted']: { deleted: true },
    [f.root + '/highlightWorks/hamlet/operations/old-receipt']: { kind: 'create' },
    [f.root + '/highlightWorks/missing-parent/highlights/orphan']: { exact: 'orphan' },
    [f.root + '/highlightWorks/missing-parent/operations/orphan-receipt']: { kind: 'delete' },
  };
  await seed(records);
  await setDoc(f.marker, markerData());
  for (const collectionPath of [
    f.root + '/quizzes', f.root + '/highlightWorks',
    f.root + '/highlightWorks/hamlet/highlights', f.root + '/highlightWorks/hamlet/operations',
    f.root + '/highlightWorks/missing-parent/highlights', f.root + '/highlightWorks/missing-parent/operations',
  ]) {
    await assertSucceeds(getDocs(query(collection(f.db, collectionPath), limit(100))));
    await assertFails(getDocs(collection(f.db, collectionPath)));
    await assertFails(getDocs(query(collection(f.db, collectionPath), limit(101))));
  }
  for (const recordPath of Object.keys(records).reverse()) {
    await assertSucceeds(getDoc(doc(f.db, recordPath)));
    await assertSucceeds(deleteDoc(doc(f.db, recordPath)));
    assert.equal((await getDoc(doc(f.db, recordPath))).exists(), false);
  }
  assert.equal((await getDoc(f.marker)).exists(), true);
  await assertFails(setDoc(doc(f.db, f.root), { completedLevel: 0 }));
});

test('deletion discovery keeps individual operations on unsupported subcollection paths denied', async () => {
  const f = owner('unknown');
  const recordPath = f.root + '/unknown/missing/children/private';
  const unexpectedHighlight = f.root + '/unknown/missing/highlights/private';
  const unexpectedOperation = f.root + '/unknown/missing/operations/private';
  await seed({
    [recordPath]: { retained: true },
    [unexpectedHighlight]: { retained: true },
    [unexpectedOperation]: { retained: true },
  });
  await setDoc(f.marker, markerData());
  for (const nestedPath of [recordPath, unexpectedHighlight, unexpectedOperation]) {
    await assertFails(getDoc(doc(f.db, nestedPath)));
    await assertFails(deleteDoc(doc(f.db, nestedPath)));
    await assertFails(setDoc(doc(f.db, nestedPath), { overwrite: true }));
  }
  await assertFails(getDocs(query(collection(f.db, f.root + '/unknown'), limit(1))));
});

test('other accounts and unauthenticated clients cannot inspect or delete another account', async () => {
  const f = owner('private');
  const records = {
    [f.root]: { completedLevel: 1 },
    [f.root + '/quizzes/1']: { completed: true },
    [f.root + '/highlightWorks/hamlet']: { revision: 1 },
    [f.root + '/highlightWorks/hamlet/highlights/one']: { exact: 'private' },
    [f.root + '/highlightWorks/hamlet/operations/receipt']: { kind: 'create' },
  };
  await seed(records);
  await setDoc(f.marker, markerData());
  for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('different-owner')]) {
    const db = context.firestore();
    await assertFails(getDoc(doc(db, f.marker.path)));
    await assertFails(setDoc(doc(db, f.marker.path), markerData()));
    await assertFails(deleteDoc(doc(db, f.marker.path)));
    for (const recordPath of Object.keys(records)) {
      await assertFails(getDoc(doc(db, recordPath)));
      await assertFails(deleteDoc(doc(db, recordPath)));
      await assertFails(setDoc(doc(db, recordPath), { overwrite: true }));
    }
    await assertFails(getDocs(query(collection(db, f.root + '/highlightWorks'), limit(1))));
  }
});

test('normal highlight validation continues rejecting malformed and partial writes', async () => {
  const f = owner('validation');
  const planned = await highlight(f);
  await assertFails(setDoc(doc(f.db, planned.paths.cloud), { malformed: true }));
  await assertFails(setDoc(doc(f.db, planned.paths.receipt), { arbitrary: true }));
  await assertFails(setDoc(doc(f.db, planned.paths.metadata), { revision: 1 }));
  await assertSucceeds(planned.batch.commit());
});
