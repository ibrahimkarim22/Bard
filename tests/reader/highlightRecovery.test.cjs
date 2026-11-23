const test = require('node:test');
const assert = require('node:assert/strict');
const { canonical, ref, legacyRecord, storageFixture, accepted } = require('./highlightSyncFixture.cjs');
const protocol = require('../../reader/highlightSyncProtocol');
let createHighlightRecovery;
try { ({ createHighlightRecovery } = require('../../reader/highlightRecovery')); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const namespace = '@bard/reader-highlights-sync:account-v2';
const prefix = namespace + '/v2/alice/hamlet/';
const catalogueKey = namespace + '/catalogue/alice';
test('an explicit recovery utility is available without changing normal app startup', () => {
  assert.equal(typeof createHighlightRecovery, 'function');
});
const recoveryTest = createHighlightRecovery ? test : test.skip;
function fixture() {
  let owner = Object.freeze({ uid: 'alice', generation: 1 }), quiet = true, sequence = 0, resolver = () => canonical;
  const rows = [ref(), ref(6, 10), ref(17, 22)].map((selectionRef, index) => {
    const record = legacyRecord({ id: 'original-' + index, selectionRef, colorId: ['yellow', 'blue', 'rose'][index], revision: 4, createdAt: 123, updatedAt: 456 });
    const operation = protocol.validateOperation({ schemaVersion: 1, operationId: 'old-' + index, uid: 'alice', workId: 'hamlet', cloudKey: protocol.cloudKeyFor(selectionRef), kind: index === 2 ? 'delete' : 'recolor', selectionRef, colorId: record.colorId, generation: 2, baseRevision: 8 });
    const cloud = accepted(operation).cloud;
    return { key: prefix + operation.cloudKey, envelope: { schemaVersion: 2, cloudKey: operation.cloudKey, localIds: [record.id, 'alias-' + index], record, deleted: index === 2, generation: 2, serverRevision: 9, serverRecord: cloud, pending: [], syncError: null, conflict: null } };
  });
  const initial = Object.fromEntries(rows.map(row => [row.key, JSON.stringify(row.envelope)]));
  initial[catalogueKey] = JSON.stringify([{ workId: 'hamlet', metadata: { schemaVersion: 1, activeCount: 2, activeBytes: 1000, revision: 40, lastOperationId: 'old-catalogue' } }, { workId: 'unrelated', metadata: { schemaVersion: 1, activeCount: 0, activeBytes: 0, revision: 3, lastOperationId: 'unrelated-op' } }]);
  initial['@bard/reader-highlights:v1/alice/hamlet/original-0'] = JSON.stringify(rows[0].envelope.record);
  const disk = storageFixture(initial), clouds = new Map(), receipts = new Map();
  let metadata = null, writes = 0;
  const transport = {
    async inspect(operation) { return { cloud: clouds.get(operation.cloudKey) || null, receipt: receipts.get(operation.operationId) || null, metadata }; },
    async commit(operation, options) {
      if (!options.isCurrent()) throw Object.assign(new Error(), { code: 'CANCELLED' });
      if (clouds.has(operation.cloudKey) && !receipts.has(operation.operationId)) throw Object.assign(new Error(), { code: 'SYNC_RECOVERY_TARGET_EXISTS' });
      const result = protocol.planServerMutation({ operation, cloud: clouds.get(operation.cloudKey), receipt: receipts.get(operation.operationId), metadata, serverTimestamp: { seconds: 1000, nanoseconds: 0 } });
      if (result.writes) { writes++; clouds.set(operation.cloudKey, result.cloud); receipts.set(operation.operationId, result.receipt); metadata = result.metadata; }
      return result;
    },
  };
  const build = (options = {}) => createHighlightRecovery({ storage: disk.storage, transport, getOwner: () => owner, isQuiescent: () => quiet, resolveCanonical: work => resolver(work), makeId: () => 'recovery-' + ++sequence, ...options });
  return { disk, rows, clouds, receipts, transport, build, targets: rows.slice(0, 2).map(row => ({ workId: 'hamlet', id: row.envelope.record.id })), writes: () => writes,
    setQuiet(value) { quiet = value; }, setResolver(value) { resolver = value; }, changeOwner() { owner = Object.freeze({ uid: 'alice', generation: owner.generation + 1 }); } };
}
recoveryTest('planning is read-only; approval and a quiescent owner are mandatory', async () => {
  const f = fixture(), utility = f.build(), before = [...f.disk.data];
  const plan = await utility.plan({ targets: f.targets });
  assert.deepEqual([...f.disk.data], before); assert.equal(f.writes(), 0);
  await assert.rejects(utility.run(plan), { code: 'RECOVERY_APPROVAL_REQUIRED' });
  f.setQuiet(false);
  await assert.rejects(utility.run(plan, { approved: true }), { code: 'RECOVERY_NOT_QUIESCENT' });
  assert.deepEqual([...f.disk.data], before);
});
recoveryTest('fresh receipts rebind only proven checkpoints, preserve IDs/colors/records and leave deletions/originals intact', async () => {
  const f = fixture(), utility = f.build(), before = new Map(f.disk.data), plan = await utility.plan({ targets: f.targets });
  const result = await utility.run(plan, { approved: true });
  assert.equal(result.recovered, 2); assert.equal(f.writes(), 2); assert.equal(f.receipts.size, 2);
  for (const row of f.rows.slice(0, 2)) {
    const next = JSON.parse(f.disk.data.get(row.key));
    assert.deepEqual(next.record, row.envelope.record); assert.deepEqual(next.localIds, row.envelope.localIds);
    assert.equal(next.generation, 1); assert.equal(next.serverRevision, 1); assert.deepEqual(next.pending, []);
    assert.notEqual(next.serverRecord.lastOperationId, row.envelope.serverRecord.lastOperationId);
  }
  assert.equal(f.disk.data.get(f.rows[2].key), before.get(f.rows[2].key));
  const original = '@bard/reader-highlights:v1/alice/hamlet/original-0'; assert.equal(f.disk.data.get(original), before.get(original));
  const catalogue = JSON.parse(f.disk.data.get(catalogueKey));
  assert.equal(catalogue.find(row => row.workId === 'hamlet').metadata.revision, 2);
  assert.deepEqual(catalogue.find(row => row.workId === 'unrelated'), JSON.parse(before.get(catalogueKey))[1]);
  await utility.resume(plan.id, { approved: true }); assert.equal(f.writes(), 2);
});
recoveryTest('deleted targets and an existing cloud target are never promoted or overwritten', async () => {
  const f = fixture(), utility = f.build();
  await assert.rejects(utility.plan({ targets: [{ workId: 'hamlet', id: f.rows[2].envelope.record.id }] }), { code: 'RECOVERY_DELETED' });
  const plan = await utility.plan({ targets: f.targets });
  f.clouds.set(plan.items[0].operation.cloudKey, f.rows[0].envelope.serverRecord);
  await assert.rejects(utility.run(plan, { approved: true }), { code: 'SYNC_RECOVERY_TARGET_EXISTS' });
  assert.equal(f.writes(), 0); assert.equal(f.disk.data.get(f.rows[0].key), JSON.stringify(f.rows[0].envelope));
});
recoveryTest('lost acknowledgements and a fresh utility reuse the same new operation identities', async () => {
  const f = fixture(), utility = f.build(), plan = await utility.plan({ targets: f.targets });
  const commit = f.transport.commit; let lost = true;
  f.transport.commit = async (...args) => { const result = await commit(...args); if (lost) { lost = false; throw Object.assign(new Error(), { code: 'unavailable' }); } return result; };
  await assert.rejects(utility.run(plan, { approved: true }), { code: 'unavailable' });
  assert.equal(f.writes(), 1);
  await f.build().resume(plan.id, { approved: true }); assert.equal(f.writes(), 2); assert.equal(f.receipts.size, 2);
  assert.equal(f.clouds.get(plan.items[0].operation.cloudKey).lastOperationId, plan.items[0].operation.operationId);
});
recoveryTest('failed local persistence resumes after the same receipt without creating another server operation', async () => {
  const f = fixture(), utility = f.build(), plan = await utility.plan({ targets: f.targets });
  const set = f.disk.storage.setItem; let fail = true;
  f.disk.storage.setItem = async (key, raw) => { if (key === plan.items[0].key && fail) { fail = false; throw new Error('synthetic local write failure'); } return set(key, raw); };
  await assert.rejects(utility.run(plan, { approved: true })); assert.equal(f.writes(), 1);
  await f.build().resume(plan.id, { approved: true }); assert.equal(f.writes(), 2);
});
recoveryTest('source changes, owner epochs and stale callbacks prevent reconciliation', async () => {
  const f = fixture(), utility = f.build(), plan = await utility.plan({ targets: f.targets });
  const changed = JSON.parse(f.disk.data.get(plan.items[0].key)); changed.record.colorId = 'sage'; f.disk.data.set(plan.items[0].key, JSON.stringify(changed));
  await assert.rejects(utility.run(plan, { approved: true }), { code: 'RECOVERY_SOURCE_CHANGED' }); assert.equal(f.writes(), 0);
  const g = fixture(), other = g.build(), second = await other.plan({ targets: g.targets }), commit = g.transport.commit;
  g.transport.commit = async (...args) => { const result = await commit(...args); g.changeOwner(); return result; };
  await assert.rejects(other.run(second, { approved: true }), { code: 'CANCELLED' });
  assert.equal(g.disk.data.get(g.rows[0].key), JSON.stringify(g.rows[0].envelope));
});
recoveryTest('a completed journal cannot fabricate success without real server receipts', async () => {
  const f = fixture(), utility = f.build(), plan = await utility.plan({ targets: f.targets });
  const forged = JSON.parse(JSON.stringify(plan)); forged.done = true;
  for (const item of forged.items) {
    const cloud = accepted(item.operation).cloud, original = JSON.parse(item.source);
    item.after = JSON.stringify({ ...original, generation: 1, serverRevision: 1, serverRecord: cloud });
  }
  await assert.rejects(utility.run(forged, { approved: true })); assert.equal(f.writes(), 0);
  for (const row of f.rows) assert.equal(f.disk.data.get(row.key), JSON.stringify(row.envelope));
});
recoveryTest('a mismatched creation timestamp cannot authorize a local checkpoint change', async () => {
  const f = fixture(), utility = f.build(), plan = await utility.plan({ targets: f.targets }), commit = f.transport.commit;
  f.transport.commit = async (...args) => { const result = await commit(...args); return { ...result, cloud: { ...result.cloud, createdAt: { seconds: 999, nanoseconds: 0 } } }; };
  await assert.rejects(utility.run(plan, { approved: true }), { code: 'RECOVERY_SERVER_CHANGED' });
  assert.equal(f.disk.data.get(f.rows[0].key), JSON.stringify(f.rows[0].envelope));
});
recoveryTest('an owner change during final plan validation cannot return another epoch’s records', async () => {
  const f = fixture(), utility = f.build(); let calls = 0;
  f.setResolver(async () => { if (++calls === 7) f.changeOwner(); return canonical; });
  await assert.rejects(utility.plan({ targets: f.targets }), { code: 'CANCELLED' });
  assert.equal(f.writes(), 0);
});
for (const boundary of ['initial-journal', 'acknowledgement-journal', 'target', 'catalogue', 'completion']) recoveryTest('write-then-throw at ' + boundary + ' resumes with original operation IDs', async () => {
  const f = fixture(), utility = f.build(), plan = await utility.plan({ targets: f.targets });
  const set = f.disk.storage.setItem; let failed = false;
  f.disk.storage.setItem = async (key, raw) => {
    await set(key, raw);
    const journal = key.includes('/recovery/'), value = journal ? JSON.parse(raw) : null;
    const match = boundary === 'initial-journal' ? journal && value.items.every(item => item.after === null)
      : boundary === 'acknowledgement-journal' ? journal && !value.done && value.items.some(item => item.after !== null)
        : boundary === 'target' ? key === plan.items[0].key
          : boundary === 'catalogue' ? key === catalogueKey : journal && value.done;
    if (match && !failed) { failed = true; throw new Error('synthetic ambiguous persistence'); }
  };
  await assert.rejects(utility.run(plan, { approved: true })); assert.equal(failed, true);
  await f.build().resume(plan.id, { approved: true }); assert.equal(f.writes(), 2); assert.equal(f.receipts.size, 2);
  assert.equal(f.disk.data.get(f.rows[2].key), JSON.stringify(f.rows[2].envelope));
});
recoveryTest('an acknowledged recovery deleted again is not silently recreated', async () => {
  const f = fixture(), utility = f.build(), plan = await utility.plan({ targets: f.targets }), set = f.disk.storage.setItem;
  f.disk.storage.setItem = async (key, raw) => { if (key === plan.items[0].key) throw new Error('synthetic interruption'); return set(key, raw); };
  await assert.rejects(utility.run(plan, { approved: true })); assert.equal(f.writes(), 1);
  f.clouds.clear(); f.receipts.clear(); f.disk.storage.setItem = set;
  await assert.rejects(f.build().resume(plan.id, { approved: true })); assert.equal(f.writes(), 1);
  assert.equal(f.disk.data.get(f.rows[0].key), JSON.stringify(f.rows[0].envelope));
});
recoveryTest('mutable owner identities and quiescence loss are rejected before local adoption', async () => {
  const f = fixture(), mutable = { uid: 'alice', generation: 1 };
  await assert.rejects(f.build({ getOwner: () => mutable }).plan({ targets: f.targets }), { code: 'CANCELLED' });
  const utility = f.build(), plan = await utility.plan({ targets: f.targets }), set = f.disk.storage.setItem;
  f.disk.storage.setItem = async (key, raw) => { await set(key, raw); if (key.includes('/recovery/') && JSON.parse(raw).items.some(item => item.after !== null)) f.setQuiet(false); };
  await assert.rejects(utility.run(plan, { approved: true }), { code: 'RECOVERY_NOT_QUIESCENT' });
  assert.equal(f.disk.data.get(f.rows[0].key), JSON.stringify(f.rows[0].envelope));
});
recoveryTest('journal identity and checkpoint after-images cannot be substituted', async () => {
  const f = fixture(), utility = f.build(), plan = await utility.plan({ targets: f.targets });
  const key = namespace + '/recovery/alice/' + plan.id, altered = JSON.parse(JSON.stringify(plan)); altered.id = 'different-job';
  f.disk.data.set(key, JSON.stringify(altered));
  await assert.rejects(utility.resume(plan.id, { approved: true }), { code: 'RECOVERY_JOB_CHANGED' }); assert.equal(f.writes(), 0);
  altered.id = plan.id; altered.items[0].after = 'garbage'; f.disk.data.set(key, JSON.stringify(altered));
  await assert.rejects(utility.resume(plan.id, { approved: true }), { code: 'RECOVERY_INVALID_JOB' }); assert.equal(f.writes(), 0);
});
recoveryTest('completed recovery resume does not overwrite a later legitimate cloud deletion', async () => {
  const f = fixture(), utility = f.build(), plan = await utility.plan({ targets: f.targets }); await utility.run(plan, { approved: true });
  const inspect = f.transport.inspect;
  f.transport.inspect = async (operation, options) => {
    const state = await inspect(operation, options);
    return { ...state, cloud: { ...state.cloud, deleted: true, serverRevision: 3, lastOperationId: 'later-delete' },
      metadata: { schemaVersion: 1, activeCount: 0, activeBytes: 0, revision: 4, lastOperationId: 'later-delete' } };
  };
  const before = [...f.disk.data]; const result = await utility.resume(plan.id, { approved: true });
  assert.equal(result.alreadyCompleted, true); assert.equal(f.writes(), 2); assert.deepEqual([...f.disk.data], before);
});
for (const oldId of ['old-1', 'old-2']) recoveryTest('fresh recovery IDs cannot reuse a known receipt from ' + oldId, async () => {
  const f = fixture(), ids = ['new-recovery-job', oldId, 'new-create'];
  await assert.rejects(f.build({ makeId: () => ids.shift() }).plan({ targets: f.targets }), { code: 'RECOVERY_INVALID_JOB' });
  assert.equal(f.writes(), 0);
});
