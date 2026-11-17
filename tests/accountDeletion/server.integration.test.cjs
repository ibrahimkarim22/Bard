const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash, randomBytes } = require('node:crypto');

const projectId = 'demo-bard-account-deletion';
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Use the fixed account-deletion emulator runner');
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, projectId);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
assert.equal(process.env.FUNCTIONS_EMULATOR_HOST, '127.0.0.1:5001');

const requireFunctions = createRequire(path.resolve(__dirname, '../../functions/package.json'));
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = requireFunctions('firebase-admin/app');
const { getAuth: getAdminAuth } = requireFunctions('firebase-admin/auth');
const { getFirestore: getAdminFirestore } = requireFunctions('firebase-admin/firestore');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const {
  getFirestore, connectFirestoreEmulator, doc, collection, query, limit,
  getDocFromServer, getDocsFromServer, setDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp, terminate,
} = require('firebase/firestore');
const { cloudKeyFor, planServerMutation } = require('../../reader/highlightSyncProtocol');
const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
const contract = require('../../functions/deletion-contract.json');
const { createAccountDeletionService } = require('../../functions/accountDeletion');

const runId = Date.now().toString(36) + '-' + randomBytes(4).toString('hex');
const clients = [];
const createdUids = [];
const statusUrl = 'http://127.0.0.1:5001/' + projectId + '/us-central1/accountDeletionStatus';
const canonical = buildCanonicalDocument({
  play: { id: 'hamlet', contentVersion: 'a'.repeat(64), canonicalTextVersion: '1', sections: [{ id: 'scene' }] },
  sections: [{ work: { id: 'hamlet' }, contentVersion: 'a'.repeat(64), canonicalTextVersion: '1',
    section: { id: 'scene' }, content: [{ id: 'paragraph', text: 'Alpha beta gamma delta', separatorAfter: '' }] }],
});
let adminApp;
let adminAuth;
let adminDb;

test.before(() => {
  adminApp = initializeAdminApp({ projectId }, 'account-deletion-' + runId);
  adminAuth = getAdminAuth(adminApp);
  adminDb = getAdminFirestore(adminApp);
});

test.after(async () => {
  await Promise.all(clients.map(async client => {
    await terminate(client.db);
    await deleteApp(client.app);
  }));
  for (const uid of createdUids) {
    await adminDb.recursiveDelete(adminDb.doc('users/' + uid));
    await adminDb.doc('accountDeletionJobs/' + uid).delete();
    await adminAuth.deleteUser(uid).catch(error => {
      if (error.code !== 'auth/user-not-found') throw error;
    });
  }
  await adminDb.terminate();
  await deleteAdminApp(adminApp);
});

function makeClient(label) {
  const app = initializeApp({ projectId, apiKey: 'demo-account-deletion-key', authDomain: projectId + '.firebaseapp.com' }, label + '-' + runId);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8180);
  const functions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  const client = { app, auth, db, requestDeletion: httpsCallable(functions, 'requestAccountDeletion') };
  clients.push(client);
  return client;
}

async function makeOwner(label) {
  const uid = label + '-' + runId;
  const email = uid + '@example.test';
  const password = 'emulator-only-password-17';
  await adminAuth.createUser({ uid, email, password });
  createdUids.push(uid);
  const client = makeClient(label);
  await signInWithEmailAndPassword(client.auth, email, password);
  return { ...client, uid };
}

async function statusRequest(uid, ticket, additionalFields = {}) {
  const response = await fetch(statusUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uid, ticket, ...additionalFields }),
  });
  return { status: response.status, body: await response.json() };
}

function checkPublicStatus(value) {
  assert.deepEqual(Object.keys(value).sort(), ['phase', 'status']);
  assert.ok(contract.statuses.includes(value.status));
  assert.ok(contract.phases.includes(value.phase));
}

async function waitForComplete(uid, ticket) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await statusRequest(uid, ticket);
    assert.equal(result.status, 200);
    checkPublicStatus(result.body);
    if (result.body.status === 'complete') return result.body;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Deletion did not complete within the emulator test deadline');
}

async function assertDenied(promise) {
  await assert.rejects(promise, error => error.code === 'permission-denied');
}

function highlightPlan(owner, { kind = 'create', colorId = 'yellow', oldCloud = null, oldMetadata = null, operationId = 'initial' } = {}) {
  const selectionRef = createSelection(canonical, 0, 5);
  const cloudKey = cloudKeyFor(selectionRef);
  const operation = {
    schemaVersion: 1, operationId, uid: owner.uid, workId: canonical.workId,
    cloudKey, kind, selectionRef, colorId, generation: 1,
    baseRevision: oldCloud ? oldCloud.serverRevision : 0,
  };
  const plan = planServerMutation({ operation, cloud: oldCloud, metadata: oldMetadata, receipt: null, serverTimestamp: serverTimestamp() });
  const workPath = 'users/' + owner.uid + '/highlightWorks/' + canonical.workId;
  const refs = {
    work: doc(owner.db, workPath),
    highlight: doc(owner.db, workPath + '/highlights/' + cloudKey),
    receipt: doc(owner.db, workPath + '/operations/' + operationId),
  };
  return {
    refs,
    commit() {
      const batch = writeBatch(owner.db);
      batch.set(refs.work, plan.metadata);
      batch.set(refs.highlight, plan.cloud);
      batch.set(refs.receipt, plan.receipt);
      return batch.commit();
    },
  };
}

test('callable requires authentication and a valid ticket before creating a job', async () => {
  const guest = makeClient('guest');
  await assert.rejects(guest.requestDeletion({ ticket: '1'.repeat(64) }), error => error.code === 'functions/unauthenticated');
  const owner = await makeOwner('invalid-ticket');
  for (const ticket of ['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) {
    await assert.rejects(owner.requestDeletion({ ticket }), error => error.code === 'functions/invalid-argument');
  }
  assert.equal((await adminDb.doc('accountDeletionJobs/' + owner.uid).get()).exists, false);
  assert.equal((await adminAuth.getUser(owner.uid)).uid, owner.uid);
});

test('the server marker blocks cached-token profile, quiz and highlight grants while owner job get stays available', async () => {
  const owner = await makeOwner('marker-owner');
  const stranger = await makeOwner('marker-stranger');
  const guest = makeClient('marker-guest');
  const profile = doc(owner.db, 'users/' + owner.uid);
  const quiz = doc(owner.db, profile.path + '/quizzes/fixture');
  const job = doc(owner.db, 'accountDeletionJobs/' + owner.uid);
  await setDoc(profile, { fixture: true });
  await setDoc(quiz, { score: 1 });
  const initial = highlightPlan(owner);
  await initial.commit();
  const oldCloud = (await getDocFromServer(initial.refs.highlight)).data();
  const oldMetadata = (await getDocFromServer(initial.refs.work)).data();
  const recolor = highlightPlan(owner, { kind: 'recolor', colorId: 'blue', oldCloud, oldMetadata, operationId: 'after-marker' });
  assert.equal((await getDocsFromServer(query(collection(owner.db, profile.path + '/highlightWorks'), limit(1)))).size, 1);
  assert.equal((await getDocsFromServer(query(collection(owner.db, initial.refs.work.path + '/highlights'), limit(1)))).size, 1);
  assert.equal((await getDocsFromServer(collection(owner.db, profile.path + '/quizzes'))).size, 1);
  assert.equal((await getDocFromServer(job)).exists(), false);
  await assertDenied(setDoc(job, { status: 'complete' }));
  await assertDenied(getDocsFromServer(collection(owner.db, 'accountDeletionJobs')));

  const cachedToken = await owner.auth.currentUser.getIdToken();
  const createdAt = Date.now();
  const markerTicket = '3'.repeat(64);
  await adminDb.doc(job.path).set({
    status: 'pending', phase: 'queued', ticketHash: createHash('sha256').update(markerTicket).digest('hex'),
    createdAt, updatedAt: createdAt, attempts: 0, nextAttemptAt: createdAt + 86_400_000,
    leaseUntil: 0, leaseToken: null,
  });
  await adminAuth.deleteUser(owner.uid);
  assert.equal(await owner.auth.currentUser.getIdToken(), cachedToken);
  assert.equal((await getDocFromServer(job)).data().status, 'pending');
  assert.deepEqual(await statusRequest(owner.uid, markerTicket, { acknowledge: true }), { status: 404, body: { error: 'not-found' } });
  const pendingJob = (await adminDb.doc(job.path).get()).data();
  assert.equal(Object.hasOwn(pendingJob, 'acknowledgedAt'), false);
  assert.equal(Object.hasOwn(pendingJob, 'expiresAt'), false);

  for (const reference of [profile, quiz, initial.refs.work, initial.refs.highlight, initial.refs.receipt]) {
    await assertDenied(getDocFromServer(reference));
  }
  await assertDenied(getDocsFromServer(collection(owner.db, profile.path + '/quizzes')));
  await assertDenied(getDocsFromServer(query(collection(owner.db, profile.path + '/highlightWorks'), limit(1))));
  await assertDenied(getDocsFromServer(query(collection(owner.db, initial.refs.work.path + '/highlights'), limit(1))));
  await assertDenied(setDoc(profile, { recreated: true }));
  await assertDenied(updateDoc(profile, { recreated: true }));
  await assertDenied(deleteDoc(profile));
  await assertDenied(setDoc(quiz, { recreated: true }));
  await assertDenied(updateDoc(quiz, { score: 2 }));
  await assertDenied(deleteDoc(quiz));
  await assertDenied(recolor.commit());
  await assertDenied(updateDoc(job, { status: 'complete' }));
  await assertDenied(deleteDoc(job));
  await assertDenied(getDocFromServer(doc(stranger.db, job.path)));
  await assertDenied(getDocFromServer(doc(guest.db, job.path)));
  await assertDenied(getDocsFromServer(collection(stranger.db, 'accountDeletionJobs')));
  await assertDenied(setDoc(doc(stranger.db, job.path), { status: 'complete' }));
  await setDoc(doc(stranger.db, 'users/' + stranger.uid), { stillActive: true });
});

test('durable deletion removes nested orphans and Auth, preserves a second UID, and keeps the original ticket idempotent', async () => {
  const owner = await makeOwner('delete-owner');
  const preserved = await makeOwner('preserved-owner');
  const ownerRoot = adminDb.doc('users/' + owner.uid);
  const preservedRoot = adminDb.doc('users/' + preserved.uid);
  const ownerPaths = [
    ownerRoot.path,
    ownerRoot.path + '/quizzes/quiz',
    ownerRoot.path + '/highlightWorks/hamlet',
    ownerRoot.path + '/highlightWorks/hamlet/highlights/highlight',
    ownerRoot.path + '/highlightWorks/hamlet/operations/receipt',
    ownerRoot.path + '/unknownCollection/missing/descendants/orphan',
    ownerRoot.path + '/deep/missing/children/also-missing/leaves/orphan',
  ];
  const preservedPaths = [preservedRoot.path, preservedRoot.path + '/quizzes/quiz', preservedRoot.path + '/highlightWorks/hamlet/highlights/highlight'];
  await Promise.all([...ownerPaths, ...preservedPaths].map(documentPath => adminDb.doc(documentPath).set({ fixture: documentPath })));
  assert.equal((await adminDb.doc(ownerRoot.path + '/unknownCollection/missing').get()).exists, false);
  assert.equal((await adminDb.doc(ownerRoot.path + '/deep/missing/children/also-missing').get()).exists, false);

  const ticket = randomBytes(32).toString('hex');
  const wrongTicket = randomBytes(32).toString('hex');
  await assert.rejects(owner.requestDeletion({ ticket, uid: preserved.uid }), error => error.code === 'functions/invalid-argument');
  assert.equal((await adminDb.doc('accountDeletionJobs/' + owner.uid).get()).exists, false);
  const responses = await Promise.all([
    owner.requestDeletion({ ticket }),
    owner.requestDeletion({ ticket }),
  ]);
  for (const response of responses) checkPublicStatus(response.data);
  await waitForComplete(owner.uid, ticket);
  for (const documentPath of ownerPaths) assert.equal((await adminDb.doc(documentPath).get()).exists, false, documentPath);
  assert.deepEqual(await ownerRoot.listCollections(), []);
  await assert.rejects(adminAuth.getUser(owner.uid), error => error.code === 'auth/user-not-found');
  for (const documentPath of preservedPaths) assert.equal((await adminDb.doc(documentPath).get()).data().fixture, documentPath);
  assert.equal((await adminAuth.getUser(preserved.uid)).uid, preserved.uid);
  assert.equal((await adminDb.doc('accountDeletionJobs/' + preserved.uid).get()).exists, false);

  const jobRef = adminDb.doc('accountDeletionJobs/' + owner.uid);
  const before = (await jobRef.get()).data();
  assert.equal(before.ticketHash, createHash('sha256').update(ticket).digest('hex'));
  assert.equal(before.status, 'complete');
  assert.equal(Object.hasOwn(before, 'acknowledgedAt'), false);
  assert.equal(Object.hasOwn(before, 'expiresAt'), false);
  const repeated = await owner.requestDeletion({ ticket });
  assert.equal(repeated.data.status, 'complete');
  await assert.rejects(owner.requestDeletion({ ticket: wrongTicket }), error => error.code === 'functions/already-exists');
  const after = (await jobRef.get()).data();
  assert.equal(after.ticketHash, before.ticketHash);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.deepEqual(await statusRequest(owner.uid, wrongTicket), { status: 404, body: { error: 'not-found' } });
  assert.deepEqual(await statusRequest(owner.uid, ''), { status: 404, body: { error: 'not-found' } });
  assert.deepEqual(await statusRequest(preserved.uid, ticket), { status: 404, body: { error: 'not-found' } });
  assert.deepEqual(await statusRequest(owner.uid, wrongTicket, { acknowledge: true }), { status: 404, body: { error: 'not-found' } });
  assert.deepEqual(await statusRequest(owner.uid, ticket, { acknowledge: false }), { status: 404, body: { error: 'not-found' } });
  assert.equal(Object.hasOwn((await jobRef.get()).data(), 'acknowledgedAt'), false);
  assert.equal(Object.hasOwn((await jobRef.get()).data(), 'expiresAt'), false);
  const status = await statusRequest(owner.uid, ticket);
  assert.equal(status.status, 200);
  assert.equal(status.body.status, 'complete');
  checkPublicStatus(status.body);
  const acknowledged = await statusRequest(owner.uid, ticket, { acknowledge: true });
  assert.equal(acknowledged.status, 200);
  assert.deepEqual(acknowledged.body, status.body);
  const receipt = (await jobRef.get()).data();
  assert.ok(Number.isFinite(receipt.acknowledgedAt));
  assert.ok(receipt.acknowledgedAt >= before.completedAt);
  assert.equal(receipt.expiresAt.toMillis(), receipt.acknowledgedAt + contract.acknowledgedReceiptRetentionDays * 86_400_000);
  assert.deepEqual(await statusRequest(owner.uid, ticket, { acknowledge: true }), acknowledged);
  const repeatedReceipt = (await jobRef.get()).data();
  assert.equal(repeatedReceipt.acknowledgedAt, receipt.acknowledgedAt);
  assert.equal(repeatedReceipt.updatedAt, receipt.updatedAt);
  assert.equal(repeatedReceipt.expiresAt.toMillis(), receipt.expiresAt.toMillis());
  await assertDenied(setDoc(doc(owner.db, ownerRoot.path), { recreatedAfterCompletion: true }));
});

test('reconciliation prunes acknowledged expiry while retaining pending and old unacknowledged receipts', async () => {
  const completedUid = 'expired-complete-' + runId;
  const pendingUid = 'expired-pending-' + runId;
  const unacknowledgedUid = 'old-unacknowledged-' + runId;
  createdUids.push(completedUid, pendingUid, unacknowledgedUid);
  const now = Date.now();
  const expiresAt = new Date(now - 86_400_000);
  const createdAt = now - 9 * 86_400_000;
  const acknowledgedAt = now - 8 * 86_400_000;
  const completedRef = adminDb.doc('accountDeletionJobs/' + completedUid);
  const pendingRef = adminDb.doc('accountDeletionJobs/' + pendingUid);
  const unacknowledgedRef = adminDb.doc('accountDeletionJobs/' + unacknowledgedUid);
  const common = {
    ticketHash: createHash('sha256').update('1'.repeat(64)).digest('hex'),
    createdAt, updatedAt: createdAt, attempts: 1,
    nextAttemptAt: Number.MAX_SAFE_INTEGER,
    leaseToken: null, leaseUntil: 0,
  };
  await completedRef.set({ ...common, status: 'complete', phase: 'complete', completedAt: createdAt, acknowledgedAt, expiresAt });
  await pendingRef.set({ ...common, status: 'pending', phase: 'queued', expiresAt });
  await unacknowledgedRef.set({ ...common, status: 'complete', phase: 'complete', completedAt: createdAt });
  assert.equal((await completedRef.get()).data().expiresAt.toMillis(), expiresAt.getTime());
  await assert.rejects(adminAuth.getUser(completedUid), error => error.code === 'auth/user-not-found');
  assert.equal((await adminDb.doc('users/' + completedUid).get()).exists, false);

  const service = createAccountDeletionService({ db: adminDb, auth: adminAuth });
  await service.resume();

  assert.equal((await completedRef.get()).exists, false);
  const pending = (await pendingRef.get()).data();
  assert.equal(pending.status, 'pending');
  assert.equal(pending.phase, 'queued');
  assert.equal(pending.expiresAt.toMillis(), expiresAt.getTime());
  const unacknowledged = (await unacknowledgedRef.get()).data();
  assert.equal(unacknowledged.status, 'complete');
  assert.equal(unacknowledged.completedAt, createdAt);
  assert.equal(Object.hasOwn(unacknowledged, 'acknowledgedAt'), false);
  assert.equal(Object.hasOwn(unacknowledged, 'expiresAt'), false);
});
