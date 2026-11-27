const { assertIsolatedHighlightEnvironment } = require('./highlightSyncEnvironment');
const { validateOperation, validateCloudRecord, validateMetadata, validateReceipt, planServerMutation, syncError } = require('./highlightSyncProtocol');

// This module neither initializes Firebase nor imports the application's singleton.
// Recovery is an explicit caller action using an already approved environment.
function createHighlightRecoveryTransport({ environment } = {}) {
  let env;
  try { env = assertIsolatedHighlightEnvironment(environment); }
  catch (_) {
    try { env = require('./highlightProductionEnvironment').assertProductionHighlightEnvironment(environment); }
    catch (_) { throw syncError('SYNC_ENVIRONMENT_REQUIRED'); }
  }
  const sdk = env.sdk;
  const sameTimestamp = (left, right) => left.seconds === right.seconds && left.nanoseconds === right.nanoseconds;
  function current(uid, isCurrent) {
    if (env.auth.currentUser?.uid !== uid || (isCurrent && isCurrent() !== true)) throw syncError('SYNC_CANCELLED');
  }
  function fresh(input) {
    const operation = validateOperation(input);
    if (operation.kind !== 'create' || operation.generation !== 1 || operation.baseRevision !== 0) throw syncError('SYNC_INVALID_OPERATION');
    return operation;
  }
  function references(operation) {
    const base = ['users', operation.uid, 'highlightWorks', operation.workId];
    return { cloud: sdk.doc(env.db, ...base, 'highlights', operation.cloudKey),
      metadata: sdk.doc(env.db, ...base), receipt: sdk.doc(env.db, ...base, 'operations', operation.operationId) };
  }
  async function guarded(operation, isCurrent, action) {
    current(operation.uid, isCurrent);
    try { return await action(); }
    finally { current(operation.uid, isCurrent); }
  }
  function validated(operation, snapshots) {
    const cloud = snapshots.cloud.exists()
      ? validateCloudRecord(snapshots.cloud.data(), { cloudKey: operation.cloudKey, workId: operation.workId }) : null;
    const metadata = snapshots.metadata.exists() ? validateMetadata(snapshots.metadata.data()) : null;
    const receipt = snapshots.receipt.exists() ? validateReceipt(snapshots.receipt.data(), operation) : null;
    if ((cloud && !metadata) || (receipt && (!cloud || !metadata))) throw syncError('SYNC_INVALID_STATE');
    if (cloud && (JSON.stringify(cloud.selectionRef) !== JSON.stringify(operation.selectionRef)
        || metadata.revision < cloud.serverRevision
        || (!cloud.deleted && (metadata.activeCount < 1 || metadata.activeBytes < cloud.payloadBytes)))) throw syncError('SYNC_INVALID_STATE');
    if (receipt && (cloud.serverRevision < receipt.resultRevision || cloud.generation < receipt.resultGeneration
        || metadata.revision < receipt.metadataRevision)) throw syncError('SYNC_INVALID_STATE');
    if (receipt && cloud.serverRevision === receipt.resultRevision
        && (cloud.lastOperationId !== operation.operationId || cloud.generation !== receipt.resultGeneration
          || cloud.deleted !== receipt.resultDeleted || cloud.colorId !== receipt.resultColorId
          || cloud.payloadBytes !== receipt.resultPayloadBytes || !sameTimestamp(cloud.createdAt, receipt.createdAt)
          || !sameTimestamp(cloud.updatedAt, receipt.createdAt))) throw syncError('SYNC_INVALID_STATE');
    return Object.freeze({ cloud, metadata, receipt });
  }
  async function read(operation, isCurrent, refs, get) {
    const entries = await Promise.all(Object.entries(refs).map(async ([key, ref]) =>
      [key, await guarded(operation, isCurrent, () => get(ref))]));
    current(operation.uid, isCurrent);
    return validated(operation, Object.fromEntries(entries));
  }
  async function inspect(input, { isCurrent } = {}) {
    const operation = fresh(input);
    await guarded(operation, isCurrent, () => env.assertReady());
    const refs = references(operation);
    return read(operation, isCurrent, refs, ref => sdk.getDocFromServer(ref));
  }
  async function commit(input, { isCurrent } = {}) {
    const operation = fresh(input);
    await guarded(operation, isCurrent, () => env.assertReady());
    const refs = references(operation), serverTimestamp = sdk.serverTimestamp();
    const planned = await guarded(operation, isCurrent, () => sdk.runTransaction(env.db, async transaction => {
      await guarded(operation, isCurrent, () => env.assertReady());
      const state = await read(operation, isCurrent, refs, ref => transaction.get(ref));
      // The normal planner intentionally permits matching creates to merge.
      // Recovery must first prove absence on every transaction attempt.
      if (state.cloud && !state.receipt) throw syncError('SYNC_RECOVERY_TARGET_EXISTS');
      const result = planServerMutation({ operation, ...state, serverTimestamp });
      current(operation.uid, isCurrent);
      if (result.writes) {
        for (const [key, value] of [['cloud', result.cloud], ['receipt', result.receipt], ['metadata', result.metadata]]) {
          current(operation.uid, isCurrent);
          transaction.set(refs[key], value);
        }
      }
      return result;
    }));
    if (planned.replayed) return Object.freeze({ cloud: planned.cloud, metadata: planned.metadata, receipt: planned.receipt });
    // A lost acknowledgement leaves the same immutable receipt available for a
    // retry. Only server time from that receipt confirms the newly created row.
    const confirmed = await guarded(operation, isCurrent, () => sdk.getDocFromServer(refs.receipt));
    if (!confirmed.exists()) throw syncError('SYNC_RECEIPT_MISMATCH');
    const receipt = validateReceipt(confirmed.data(), operation);
    if (receipt.resultRevision !== planned.cloud.serverRevision || receipt.metadataRevision !== planned.metadata.revision) throw syncError('SYNC_RECEIPT_MISMATCH');
    const cloud = validateCloudRecord({ ...planned.cloud, createdAt: receipt.createdAt, updatedAt: receipt.createdAt },
      { cloudKey: operation.cloudKey, workId: operation.workId });
    return Object.freeze({ cloud, metadata: validateMetadata(planned.metadata), receipt });
  }
  return Object.freeze({ inspect, commit });
}

module.exports = { createHighlightRecoveryTransport };
