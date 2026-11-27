const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { createHighlightSyncEmulatorEnvironment } = require('../../reader/highlightSyncEnvironment');
const { createFirestoreHighlightSyncTransport } = require('../../reader/highlightSyncFirestore');
const { buildCanonicalDocument, createSelection } = require('../../shared/contentText');
const { cloudKeyFor, planServerMutation } = require('../../reader/highlightSyncProtocol');

// A missing implementation produces the intended API assertion, not a loader error.
const recoveryPath = path.resolve(__dirname, '../../reader/highlightRecoveryFirestore.js');
let recovery = {};
if (fs.existsSync(recoveryPath)) recovery = require(recoveryPath);
test('recovery transport exposes the explicit guarded factory', () => {
  assert.equal(typeof recovery.createHighlightRecoveryTransport, 'function');
});

test('recovery transport rejects unbranded environments before inspecting their SDK', { skip: !recovery.createHighlightRecoveryTransport }, () => {
  let sdkReads = 0;
  for (const projectId of ['demo-bard-highlights-sync', 'shakespearenativeapp']) {
    assert.throws(() => recovery.createHighlightRecoveryTransport({ environment: {
      projectId, get sdk() { sdkReads++; throw new Error('SDK accessed before branding'); },
    } }), { code: 'SYNC_ENVIRONMENT_REQUIRED' });
  }
  assert.equal(sdkReads, 0);
});

function bundled(workId) {
  const base = path.resolve(__dirname, '../../data/plays', workId);
  const play = JSON.parse(fs.readFileSync(path.join(base, 'play.json'), 'utf8'));
  return buildCanonicalDocument({ play, sections: play.sections.map(section => JSON.parse(fs.readFileSync(path.resolve(base, section.path), 'utf8'))) });
}
const midsummer = bundled('a-midsummer-nights-dream'), muchAdo = bundled('much-ado-about-nothing');
const sourceRanges = [
  [midsummer, 7094, 'The course of true love never did run smooth', 'yellow'],
  [midsummer, 11587, 'Love looks not with the eyes', 'blue'],
  [midsummer, 49600, 'Lord, what fools these mortals be', 'sage'],
  [muchAdo, 42193, 'Sigh no more', 'blue'],
];
const omittedDeleted = createSelection(midsummer, 15000, 15030);
let sequence = 0, rulesEnvironment;
const run = Date.now().toString(36);
function instrument(control = {}) {
  const real = require('firebase/firestore');
  control.serverReads = []; control.transactionReads = []; control.sets = []; control.callbacks = 0;
  return { app: require('firebase/app'), auth: require('firebase/auth'), firestore: { ...real,
    async getDocFromServer(ref) {
      control.serverReads.push(ref.path);
      const result = await real.getDocFromServer(ref);
      if (control.afterServerRead) await control.afterServerRead(ref);
      return result;
    },
    runTransaction(db, callback, options) {
      return real.runTransaction(db, async transaction => {
        control.callbacks++;
        const result = await callback({
          async get(ref) {
            control.transactionReads.push(ref.path);
            const result = await transaction.get(ref);
            if (control.afterTransactionRead) await control.afterTransactionRead(ref, control.callbacks);
            return result;
          },
          set(ref, value) { control.sets.push(ref.path); return transaction.set(ref, value); },
        });
        if (control.afterTransactionCallback) await control.afterTransactionCallback(control.callbacks);
        return result;
      }, options);
    },
  } };
}
async function client(t, label, { email, control = {} } = {}) {
  const name = 'recovery_' + label + '_' + run + '_' + ++sequence;
  const environment = await createHighlightSyncEmulatorEnvironment({ appName: name, firebaseSdk: instrument(control),
    fetchImpl: async (...args) => {
      const response = await fetch(...args);
      if (control.afterReadyFetch) await control.afterReadyFetch();
      return response;
    } });
  t.after(() => environment.close());
  const credential = await environment.signInSynthetic({ email: email || name.toLowerCase() + '@bard-sync.test', password: 'synthetic-recovery-fixture' });
  return { environment, control, uid: credential.user.uid,
    transport: recovery.createHighlightRecoveryTransport({ environment }),
    ordinary: createFirestoreHighlightSyncTransport({ environment }) };
}
function operation(client, index = 0, changes = {}) {
  const [canonical, start, exact, colorId] = sourceRanges[index];
  assert.equal(canonical.text.slice(start, start + exact.length), exact, 'literal range is backed by the bundled document');
  const selectionRef = createSelection(canonical, start, start + exact.length);
  return { schemaVersion: 1, operationId: 'recovery_op_' + run + '_' + ++sequence, uid: client.uid,
    workId: canonical.workId, cloudKey: cloudKeyFor(selectionRef, canonical), kind: 'create', selectionRef, colorId, generation: 1, baseRevision: 0, ...changes };
}
function refs(client, op) {
  const { sdk, db } = client.environment, base = ['users', op.uid, 'highlightWorks', op.workId];
  return { cloud: sdk.doc(db, ...base, 'highlights', op.cloudKey), metadata: sdk.doc(db, ...base), receipt: sdk.doc(db, ...base, 'operations', op.operationId) };
}
async function serverState(client, op) {
  const result = {};
  for (const [key, ref] of Object.entries(refs(client, op))) {
    const value = await client.environment.sdk.getDocFromServer(ref);
    result[key] = value.exists() ? value.data() : null;
  }
  return result;
}
async function ownerDocuments(uid) {
  const result = {};
  await rulesEnvironment.withSecurityRulesDisabled(async context => {
    const sdk = require('firebase/firestore'), db = context.firestore();
    const works = await sdk.getDocs(sdk.collection(db, 'users', uid, 'highlightWorks'));
    for (const work of works.docs) {
      result[work.ref.path] = work.data();
      for (const name of ['highlights', 'operations']) {
        const docs = await sdk.getDocs(sdk.collection(db, work.ref.path, name));
        for (const document of docs.docs) result[document.ref.path] = document.data();
      }
    }
  });
  return result;
}
async function seed(client, op, state) {
  const references = refs(client, op);
  return rulesEnvironment.withSecurityRulesDisabled(async context => {
    const sdk = require('firebase/firestore'), db = context.firestore(), batch = sdk.writeBatch(db);
    for (const [key, value] of Object.entries(state)) if (value !== null) batch.set(sdk.doc(db, references[key].path), value);
    await batch.commit();
  });
}

test.describe('rule-enforced absent-only recovery', { skip: !recovery.createHighlightRecoveryTransport }, () => {
  test.before(async () => {
    assert.equal(process.env.GCLOUD_PROJECT, 'demo-bard-highlights-sync', 'Run through the existing fixed demo emulator runner');
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
    rulesEnvironment = await initializeTestEnvironment({ projectId: 'demo-bard-highlights-sync',
      firestore: { host: '127.0.0.1', port: 8180, rules: fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8') } });
  });
  test.after(async () => { await rulesEnvironment?.cleanup(); });

  test('inspect reads only all three exact owner paths from the server and returns validated state', async t => {
    const a = await client(t, 'inspect'), op = operation(a);
    assert.deepEqual(await a.transport.inspect(op), { cloud: null, metadata: null, receipt: null });
    assert.deepEqual(a.control.serverReads.sort(), Object.values(refs(a, op)).map(ref => ref.path).sort());
    assert.equal(a.control.callbacks, 0); assert.equal(a.control.sets.length, 0);
    await a.transport.commit(op);
    const result = await a.transport.inspect(op);
    assert.equal(result.cloud.serverRevision, 1); assert.equal(result.receipt.operationId, op.operationId);
    assert.equal(result.metadata.activeCount, 1);
  });

  test('four source-backed fresh creates preserve 3+1 work accounting and omit the deleted marker', async t => {
    const a = await client(t, 'four');
    for (let index = 0; index < 4; index++) {
      const op = operation(a, index), result = await a.transport.commit(op);
      assert.deepEqual(result.cloud.selectionRef, op.selectionRef); assert.equal(result.cloud.colorId, sourceRanges[index][3]);
      assert.equal(result.cloud.serverRevision, 1); assert.equal(result.cloud.generation, 1); assert.equal(result.cloud.deleted, false);
      assert.ok(result.cloud.createdAt.seconds > 1700000000, 'fresh server time, not a recovered local timestamp');
      assert.deepEqual(result.cloud.createdAt, result.receipt.createdAt); assert.deepEqual(result.cloud.updatedAt, result.receipt.createdAt);
      assert.equal(result.metadata.activeCount, index < 3 ? index + 1 : 1);
    }
    const documents = await ownerDocuments(a.uid), values = Object.values(documents);
    assert.equal(values.filter(value => value.selectionRef && value.serverRevision).length, 4);
    assert.equal(values.filter(value => value.operationId).length, 4);
    assert.equal(documents[`users/${a.uid}/highlightWorks/${midsummer.workId}`].activeCount, 3);
    assert.equal(documents[`users/${a.uid}/highlightWorks/${muchAdo.workId}`].activeCount, 1);
    assert.equal(documents[`users/${a.uid}/highlightWorks/${midsummer.workId}/highlights/${cloudKeyFor(omittedDeleted)}`], undefined);
  });

  test('matching operation retry returns one immutable receipt without another write', async t => {
    const a = await client(t, 'retry'), op = operation(a), first = await a.transport.commit(op);
    const before = await ownerDocuments(a.uid), writes = a.control.sets.length;
    const second = await a.transport.commit(op);
    assert.deepEqual(second.receipt, first.receipt); assert.equal(second.cloud.serverRevision, 1);
    assert.equal(a.control.sets.length, writes); assert.deepEqual(await ownerDocuments(a.uid), before);
    assert.equal(Object.values(before).filter(value => value.operationId).length, 1);
  });

  test('lost server receipt acknowledgement retries the same operation without another count increment', async t => {
    const control = {}, a = await client(t, 'lostack', { control }), op = operation(a);
    control.afterServerRead = ref => {
      if (ref.path === refs(a, op).receipt.path) {
        control.afterServerRead = null;
        throw Object.assign(new Error('Synthetic lost receipt response'), { code: 'unavailable' });
      }
    };
    await assert.rejects(a.transport.commit(op), { code: 'unavailable' });
    const before = await ownerDocuments(a.uid), writes = control.sets.length;
    const replay = await a.transport.commit(op);
    assert.equal(replay.receipt.resultRevision, 1); assert.equal(replay.metadata.activeCount, 1);
    assert.equal(control.sets.length, writes); assert.deepEqual(await ownerDocuments(a.uid), before);
    assert.equal(Object.values(before).filter(value => value.operationId).length, 1);
  });

  test('existing identical target and tombstone both fail with zero recovery writes and unchanged accounting', async t => {
    for (const deleted of [false, true]) {
      const a = await client(t, deleted ? 'tombstone' : 'identical'), existing = operation(a);
      await a.ordinary.commit(existing);
      if (deleted) await a.ordinary.commit({ ...existing, operationId: 'delete_' + ++sequence, kind: 'delete', baseRevision: 1 });
      const fresh = { ...existing, operationId: 'fresh_' + ++sequence }, before = await ownerDocuments(a.uid), writes = a.control.sets.length;
      const inspected = await a.transport.inspect(fresh);
      assert.equal(inspected.cloud.deleted, deleted); assert.equal(inspected.receipt, null);
      await assert.rejects(a.transport.commit(fresh), { code: 'SYNC_RECOVERY_TARGET_EXISTS' });
      assert.equal(a.control.sets.length, writes); assert.deepEqual(await ownerDocuments(a.uid), before);
    }
  });

  test('matching recovery receipt replays current recolored or deleted cloud without overwriting later edits', async t => {
    const a = await client(t, 'later'), op = operation(a); await a.transport.commit(op);
    for (const [kind, revision] of [['recolor', 1], ['delete', 2]]) {
      await a.ordinary.commit({ ...op, operationId: kind + '_' + ++sequence, kind, baseRevision: revision, colorId: 'rose' });
      const before = await ownerDocuments(a.uid), writes = a.control.sets.length, result = await a.transport.commit(op);
      assert.equal(result.cloud.serverRevision, revision + 1); assert.equal(result.cloud.colorId, 'rose');
      assert.equal(result.cloud.deleted, kind === 'delete'); assert.equal(result.receipt.resultRevision, 1);
      assert.equal(a.control.sets.length, writes); assert.deepEqual(await ownerDocuments(a.uid), before);
    }
  });

  test('different account and stale guards cannot inspect or commit owner operations', async t => {
    const a = await client(t, 'owner'), b = await client(t, 'stranger'), op = operation(a);
    await a.transport.commit(op);
    await assert.rejects(b.transport.inspect(op), { code: 'SYNC_CANCELLED' });
    await assert.rejects(b.transport.commit(op), { code: 'SYNC_CANCELLED' });
    await assert.rejects(a.transport.inspect(op, { isCurrent: () => false }), { code: 'SYNC_CANCELLED' });
    await assert.rejects(a.transport.commit(op, { isCurrent: () => false }), { code: 'SYNC_CANCELLED' });
    assert.equal(b.control.serverReads.length, 0); assert.equal(b.control.sets.length, 0);
    await assert.rejects(b.environment.sdk.getDocFromServer(b.environment.sdk.doc(b.environment.db, refs(a, op).cloud.path)), { code: 'permission-denied' });
  });

  test('ownership guard changes during server and transaction reads cancel before publishing or writing', async t => {
    const control = {}, a = await client(t, 'guards', { control }), op = operation(a);
    let active = true; control.afterServerRead = () => { active = false; };
    await assert.rejects(a.transport.inspect(op, { isCurrent: () => active }), { code: 'SYNC_CANCELLED' });
    control.afterServerRead = null; active = true; control.afterTransactionRead = () => { active = false; };
    await assert.rejects(a.transport.commit(op, { isCurrent: () => active }), { code: 'SYNC_CANCELLED' });
    assert.equal(control.sets.length, 0); assert.deepEqual(await ownerDocuments(a.uid), {});
  });

  test('readiness failures and changed owners after readiness or reads prevent recovery effects', async t => {
    const control = {}, a = await client(t, 'readiness', { control }), op = operation(a);
    await a.environment.setNetworkEnabled(false);
    for (const method of ['inspect', 'commit']) await assert.rejects(a.transport[method](op), { code: 'SYNC_EMULATOR_NETWORK_DISABLED' });
    assert.equal(control.serverReads.length, 0); assert.equal(control.callbacks, 0);
    await a.environment.setNetworkEnabled(true);
    let active = true; control.afterReadyFetch = () => { active = false; };
    await assert.rejects(a.transport.commit(op, { isCurrent: () => active }), { code: 'SYNC_CANCELLED' });
    assert.equal(control.callbacks, 0); control.afterReadyFetch = null;
    control.afterServerRead = async () => { control.afterServerRead = null; await a.environment.authSdk.signOut(a.environment.auth); };
    await assert.rejects(a.transport.inspect(op), { code: 'SYNC_CANCELLED' });
    assert.equal(control.sets.length, 0);
    const secondControl = {}, b = await client(t, 'authread', { control: secondControl }), other = operation(b);
    secondControl.afterTransactionRead = async () => {
      secondControl.afterTransactionRead = null; await b.environment.authSdk.signOut(b.environment.auth);
    };
    await assert.rejects(b.transport.commit(other), { code: 'SYNC_CANCELLED' });
    assert.equal(secondControl.sets.length, 0); assert.deepEqual(await ownerDocuments(b.uid), {});
  });

  test('only generation-one revision-zero create operations can enter recovery', async t => {
    const a = await client(t, 'shape'), op = operation(a);
    for (const changes of [{ kind: 'recolor' }, { kind: 'delete' }, { kind: 'recreate', generation: 2 }, { generation: 2 }, { baseRevision: 1 }]) {
      await assert.rejects(a.transport.inspect({ ...op, ...changes }), { code: 'SYNC_INVALID_OPERATION' });
      await assert.rejects(a.transport.commit({ ...op, ...changes }), { code: 'SYNC_INVALID_OPERATION' });
    }
    assert.equal(a.control.serverReads.length, 0); assert.equal(a.control.callbacks, 0);
  });

  test('malformed, orphaned and mismatched states fail closed without recovery writes', async t => {
    const stamp = { seconds: 1700000001, nanoseconds: 0 };
    for (const type of ['malformed-cloud', 'cloud-without-metadata', 'receipt-without-cloud', 'malformed-metadata', 'mismatched-receipt', 'created-time-mismatch', 'updated-time-mismatch']) {
      const a = await client(t, type), op = operation(a), planned = planServerMutation({ operation: op, serverTimestamp: stamp });
      const state = { cloud: planned.cloud, metadata: planned.metadata, receipt: null };
      if (type === 'malformed-cloud') state.cloud = { ...state.cloud, colorId: 'invalid' };
      if (type === 'cloud-without-metadata') state.metadata = null;
      if (type === 'receipt-without-cloud') { state.cloud = null; state.receipt = planned.receipt; }
      if (type === 'malformed-metadata') { state.cloud = null; state.metadata = { ...state.metadata, activeCount: -1 }; }
      if (type === 'mismatched-receipt') state.receipt = { ...planned.receipt, colorId: 'rose', resultColorId: 'rose' };
      if (type === 'created-time-mismatch' || type === 'updated-time-mismatch') {
        state.receipt = planned.receipt;
        state.cloud = { ...state.cloud, [type === 'created-time-mismatch' ? 'createdAt' : 'updatedAt']: { seconds: 1, nanoseconds: 0 } };
      }
      await seed(a, op, state);
      const before = await serverState(a, op);
      for (const method of ['inspect', 'commit']) await assert.rejects(a.transport[method](op), { code: type === 'mismatched-receipt' ? 'SYNC_RECEIPT_MISMATCH' : 'SYNC_INVALID_STATE' });
      assert.equal(a.control.sets.length, 0); assert.deepEqual(await serverState(a, op), before);
    }
  });

  test('existing valid work metadata is preserved and full work capacity fails without writes', async t => {
    const a = await client(t, 'metadata'), first = operation(a, 0); await a.ordinary.commit(first);
    const second = operation(a, 1), before = (await serverState(a, first)).metadata, result = await a.transport.commit(second);
    assert.equal(result.metadata.activeCount, before.activeCount + 1);
    assert.equal(result.metadata.activeBytes, before.activeBytes + result.cloud.payloadBytes);
    assert.equal(result.metadata.revision, before.revision + 1);
    const full = await client(t, 'full'), op = operation(full);
    await seed(full, op, { metadata: { schemaVersion: 1, activeCount: 200, activeBytes: 1000, revision: 200, lastOperationId: 'capacity_fixture' } });
    const state = await serverState(full, op);
    await assert.rejects(full.transport.commit(op), { code: 'SYNC_COUNT_LIMIT' });
    assert.equal(full.control.sets.length, 0); assert.deepEqual(await serverState(full, op), state);
  });

  test('a concurrent target creation cannot be overwritten by recovery', async t => {
    const control = {}, a = await client(t, 'race', { control });
    const b = await client(t, 'racer', { email: 'recovery_race_' + run + '@bard-sync.test' });
    // Sign both isolated clients into the same synthetic account.
    await a.environment.signInSynthetic({ email: 'recovery_race_' + run + '@bard-sync.test', password: 'synthetic-recovery-fixture' });
    a.uid = a.environment.auth.currentUser.uid; assert.equal(a.uid, b.uid);
    const op = operation(a), competing = { ...op, operationId: 'competing_' + ++sequence };
    let raced = false;
    control.afterTransactionRead = async (ref, attempt) => {
      if (!raced && attempt === 1 && ref.path === refs(a, op).metadata.path) {
        raced = true; await b.ordinary.commit(competing);
      }
    };
    await assert.rejects(a.transport.commit(op), error => error.code === 'SYNC_RECOVERY_TARGET_EXISTS' || error.code === 'permission-denied');
    assert.equal(raced, true);
    const state = await serverState(a, op);
    assert.equal(state.cloud.lastOperationId, competing.operationId); assert.equal(state.cloud.serverRevision, 1);
    assert.equal(state.receipt, null); assert.equal(state.metadata.activeCount, 1); assert.equal(state.metadata.revision, 1);
    assert.equal(Object.values(await ownerDocuments(a.uid)).filter(value => value.operationId).length, 1);
  });

  test('a real SDK transaction retry rechecks absence after a controlled abort and competing creation', async t => {
    const email = 'recovery_retry_race_' + run + '@bard-sync.test', control = {};
    const a = await client(t, 'retryrace', { email, control }), b = await client(t, 'retryracer', { email });
    const op = operation(a), competing = { ...op, operationId: 'retry_competing_' + ++sequence };
    control.afterTransactionCallback = async attempt => {
      if (attempt !== 1) return;
      await b.ordinary.commit(competing);
      // Abort before the SDK sends the first attempt's writes. The real SDK
      // reruns its callback, now against an actually committed competing row.
      throw Object.assign(new Error('Controlled retriable transaction conflict'), { name: 'FirebaseError', code: 'aborted' });
    };
    await assert.rejects(a.transport.commit(op), { code: 'SYNC_RECOVERY_TARGET_EXISTS' });
    assert.equal(control.callbacks, 2, 'the actual Firebase SDK reran the callback');
    const state = await serverState(a, op);
    assert.equal(state.cloud.lastOperationId, competing.operationId); assert.equal(state.cloud.serverRevision, 1);
    assert.equal(state.receipt, null); assert.equal(state.metadata.activeCount, 1); assert.equal(state.metadata.revision, 1);
    assert.equal(Object.values(await ownerDocuments(a.uid)).filter(value => value.operationId).length, 1);
  });

  test('approved recovery preserves retained originals and a fresh normal runtime can recolor and delete the new checkpoints', async t => {
    const { createHighlightRecovery } = require('../../reader/highlightRecovery');
    const { createNormalHighlightRuntime, ACCOUNT_NAMESPACE } = require('../../reader/normalHighlightRuntime');
    const { keyFor } = require('../../reader/readerHighlights');
    const a = await client(t, 'integration'), owner = Object.freeze({ uid: a.uid, generation: 1 });
    const documents = new Map([[midsummer.workId, midsummer], [muchAdo.workId, muchAdo]]);
    const data = new Map(), storage = {
      getAllKeys: async () => [...data.keys()], getItem: async key => data.get(key) ?? null,
      setItem: async (key, value) => { data.set(key, value); }, removeItem: async key => { data.delete(key); },
    };
    const retained = [];
    for (let index = 0; index < 5; index++) {
      const deleted = index === 4, original = operation(a, deleted ? 0 : index);
      const selectionRef = deleted ? omittedDeleted : original.selectionRef;
      const oldOperation = { ...original, operationId: 'retained_' + ++sequence, selectionRef, cloudKey: cloudKeyFor(selectionRef) };
      const old = planServerMutation({ operation: oldOperation, serverTimestamp: { seconds: 1000, nanoseconds: 0 } }).cloud;
      const record = { schemaVersion: 1, id: 'original_local_' + index, owner: { kind: 'account', uid: a.uid },
        workId: selectionRef.workId, selectionRef, colorId: original.colorId, revision: 5, createdAt: 123, updatedAt: 456 };
      const envelope = { schemaVersion: 2, cloudKey: oldOperation.cloudKey, localIds: [record.id, 'retained_alias_' + index], record,
        deleted, generation: 2, serverRevision: 9, serverRecord: { ...old, deleted, generation: 2, serverRevision: 9 },
        pending: [], syncError: null, conflict: null };
      const key = ACCOUNT_NAMESPACE + '/v2/' + encodeURIComponent(a.uid) + '/' + record.workId + '/' + envelope.cloudKey;
      const raw = JSON.stringify(envelope); data.set(key, raw); retained.push({ key, raw, envelope });
    }
    const originalKey = keyFor(a.uid, midsummer.workId, retained[0].envelope.record.id);
    const originalRaw = JSON.stringify(retained[0].envelope.record); data.set(originalKey, originalRaw);
    const catalogueKey = ACCOUNT_NAMESPACE + '/catalogue/' + encodeURIComponent(a.uid);
    const unrelated = { workId: 'unrelated-fixture', metadata: { schemaVersion: 1, activeCount: 0, activeBytes: 0, revision: 12, lastOperationId: 'unrelated_fixture' } };
    data.set(catalogueKey, JSON.stringify([midsummer, muchAdo].map((canonical, index) => ({ workId: canonical.workId,
      metadata: { schemaVersion: 1, activeCount: index ? 1 : 3, activeBytes: 4000, revision: 40, lastOperationId: 'old_catalogue_' + index } })).concat(unrelated)));
    const utility = () => createHighlightRecovery({ storage, transport: a.transport, getOwner: () => owner, isQuiescent: () => true,
      resolveCanonical: workId => documents.get(workId), makeId: () => 'integration_recovery_' + ++sequence });
    const before = [...data], recovery = utility();
    const plan = await recovery.plan({ targets: retained.slice(0, 4).map(row => ({ workId: row.envelope.record.workId, id: row.envelope.record.id })) });
    assert.deepEqual([...data], before, 'planning does not modify retained sources');
    assert.equal(a.control.sets.length, 0);
    const completed = await recovery.run(plan, { approved: true }); assert.equal(completed.recovered, 4);
    for (const row of retained.slice(0, 4)) {
      const next = JSON.parse(data.get(row.key));
      assert.deepEqual(next.record, row.envelope.record); assert.deepEqual(next.localIds, row.envelope.localIds);
      assert.equal(next.generation, 1); assert.equal(next.serverRevision, 1); assert.deepEqual(next.pending, []);
      assert.equal(next.deleted, false); assert.notEqual(next.serverRecord.lastOperationId, row.envelope.serverRecord.lastOperationId);
    }
    assert.equal(data.get(retained[4].key), retained[4].raw); assert.equal(data.get(originalKey), originalRaw);
    const catalogue = JSON.parse(data.get(catalogueKey));
    assert.equal(catalogue.find(row => row.workId === midsummer.workId).metadata.activeCount, 3);
    assert.equal(catalogue.find(row => row.workId === midsummer.workId).metadata.revision, 3);
    assert.equal(catalogue.find(row => row.workId === muchAdo.workId).metadata.activeCount, 1);
    assert.equal(catalogue.find(row => row.workId === muchAdo.workId).metadata.revision, 1);
    assert.deepEqual(catalogue.find(row => row.workId === unrelated.workId), unrelated);
    const recoveredCloud = await ownerDocuments(a.uid), writes = a.control.sets.length;
    assert.equal(Object.values(recoveredCloud).filter(value => value.serverRevision && !value.deleted).length, 4);
    assert.equal(Object.values(recoveredCloud).filter(value => value.operationId).length, 4);
    assert.equal((await utility().resume(plan.id, { approved: true })).alreadyCompleted, true);
    assert.equal(a.control.sets.length, writes); assert.deepEqual(await ownerDocuments(a.uid), recoveredCloud);

    const runtime = createNormalHighlightRuntime({ storage, configuration: { enabled: true, storageMode: 'durable-v2', migrationApproved: true },
      createBackend: () => a.ordinary, resolveCanonical: workId => documents.get(workId), storeOptions: { makeId: () => 'normal_after_recovery_' + ++sequence } });
    t.after(() => runtime.dispose());
    await runtime.setOwner(a.uid);
    const reader = await runtime.openWork(midsummer), other = await runtime.openWork(muchAdo);
    await runtime.flush();
    assert.equal(reader.getSnapshot().records.length, 3); assert.equal(other.getSnapshot().records.length, 1);
    assert.ok(reader.getSnapshot().records.some(record => record.id === retained[0].envelope.record.id));
    assert.equal(data.get(originalKey), originalRaw); assert.equal(data.get(retained[4].key), retained[4].raw);
    const firstId = retained[0].envelope.record.id, firstOperation = plan.items[0].operation;
    await reader.recolor(firstId, 'rose'); await runtime.flush();
    const recolored = await serverState(a, firstOperation);
    assert.equal(recolored.cloud.colorId, 'rose'); assert.equal(recolored.cloud.serverRevision, 2); assert.equal(recolored.metadata.activeCount, 3);
    await reader.remove(firstId); await runtime.flush();
    const deleted = await serverState(a, firstOperation);
    assert.equal(deleted.cloud.deleted, true); assert.equal(deleted.cloud.serverRevision, 3); assert.equal(deleted.metadata.activeCount, 2);
    assert.equal(other.getSnapshot().records.length, 1); assert.equal(data.get(originalKey), originalRaw);
    assert.equal(data.get(retained[4].key), retained[4].raw);
  });
});
