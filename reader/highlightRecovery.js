const { validateHighlightRecord, validateSelectionRef, prefixFor, utf8Length } = require('./readerHighlights');
const protocol = require('./highlightSyncProtocol');

const NAMESPACE = '@bard/reader-highlights-sync:account-v2';
const MAX_JOB_BYTES = 4194304;
const ENVELOPE_FIELDS = ['schemaVersion', 'cloudKey', 'localIds', 'record', 'deleted', 'generation', 'serverRevision', 'serverRecord', 'pending', 'syncError', 'conflict'];
const fail = code => Object.assign(new Error(code), { code });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = value => JSON.parse(JSON.stringify(value));
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

// Operator-only recovery. Nothing imports this module in normal app startup.
// Callers must pause all affected clients; a deleted cloud lineage cannot be
// distinguished from stale writes by older clients using the existing rules.
function createHighlightRecovery({ storage, transport, getOwner, isQuiescent, resolveCanonical, makeId }) {
  if (!storage || !['getAllKeys', 'getItem', 'setItem'].every(key => typeof storage[key] === 'function')
      || !transport || !['inspect', 'commit'].every(key => typeof transport[key] === 'function')
      || [getOwner, isQuiescent, resolveCanonical, makeId].some(value => typeof value !== 'function')) throw fail('RECOVERY_CONFIGURATION');
  let running = null;
  const prefix = uid => NAMESPACE + '/v2/' + encodeURIComponent(uid) + '/';
  const journalKey = (uid, jobId) => NAMESPACE + '/recovery/' + encodeURIComponent(uid) + '/' + jobId;
  function context(uid, writing = false) {
    const token = getOwner();
    if (!token || !Object.isFrozen(token) || typeof token.uid !== 'string' || !token.uid
        || !Number.isSafeInteger(token.generation) || token.generation < 0 || token.ready === false
        || uid && uid !== token.uid) throw fail('CANCELLED');
    const capturedUid = token.uid, capturedGeneration = token.generation;
    if (!Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(token, 'uid') || {}, 'value')
        || !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(token, 'generation') || {}, 'value')) throw fail('CANCELLED');
    prefixFor(capturedUid, 'x');
    const check = () => {
      if (getOwner() !== token || token.uid !== capturedUid || token.generation !== capturedGeneration) throw fail('CANCELLED');
      if (writing && isQuiescent() !== true) throw fail('RECOVERY_NOT_QUIESCENT');
      return true;
    };
    check(); return { uid: capturedUid, check, isCurrent: () => { try { return check(); } catch (_) { return false; } } };
  }
  async function source(raw, uid) {
    let envelope;
    try { envelope = JSON.parse(raw); } catch (_) { throw fail('RECOVERY_INVALID_SOURCE'); }
    if (!exact(envelope, ENVELOPE_FIELDS) || envelope.schemaVersion !== 2 || typeof envelope.deleted !== 'boolean'
        || !Array.isArray(envelope.localIds) || !envelope.localIds.length || envelope.localIds.length > 32
        || new Set(envelope.localIds).size !== envelope.localIds.length || envelope.localIds.some(value => typeof value !== 'string' || !value || value.length > 128)
        || envelope.localIds[0] !== envelope.record?.id || !Array.isArray(envelope.pending) || envelope.pending.length
        || envelope.syncError !== null || envelope.conflict !== null || !Number.isSafeInteger(envelope.generation) || envelope.generation < 1
        || !Number.isSafeInteger(envelope.serverRevision) || envelope.serverRevision < 1) throw fail('RECOVERY_INVALID_SOURCE');
    const canonical = await resolveCanonical(envelope.record?.workId);
    const record = validateHighlightRecord(envelope.record, { uid, workId: canonical?.workId, canonical });
    validateSelectionRef(record.selectionRef, canonical);
    const cloud = protocol.validateCloudRecord(envelope.serverRecord, { workId: record.workId, cloudKey: envelope.cloudKey, canonical });
    if (envelope.cloudKey !== protocol.cloudKeyFor(record.selectionRef, canonical) || !equal(cloud.selectionRef, record.selectionRef)
        || cloud.generation !== envelope.generation || cloud.serverRevision !== envelope.serverRevision
        || cloud.deleted !== envelope.deleted || cloud.colorId !== record.colorId) throw fail('RECOVERY_INVALID_SOURCE');
    return envelope;
  }
  async function validateJob(input, uid) {
    const job = copy(input);
    if (!exact(job, ['schemaVersion', 'id', 'uid', 'items', 'previousOperationIds', 'done']) || job.schemaVersion !== 1 || !id(job.id) || job.uid !== uid
        || !Array.isArray(job.previousOperationIds) || job.previousOperationIds.some(value => !id(value))
        || new Set(job.previousOperationIds).size !== job.previousOperationIds.length || job.previousOperationIds.includes(job.id)
        || typeof job.done !== 'boolean' || !Array.isArray(job.items) || !job.items.length || job.items.length > 200) throw fail('RECOVERY_INVALID_JOB');
    const keys = new Set(), operations = new Set([job.id]);
    for (const item of job.items) {
      if (!exact(item, ['key', 'source', 'operation', 'after']) || typeof item.source !== 'string'
          || item.after !== null && typeof item.after !== 'string') throw fail('RECOVERY_INVALID_JOB');
      const envelope = await source(item.source, uid), operation = protocol.validateOperation(item.operation);
      if (envelope.deleted) throw fail('RECOVERY_DELETED');
      if (item.key !== prefix(uid) + encodeURIComponent(envelope.record.workId) + '/' + envelope.cloudKey || keys.has(item.key)
          || operations.has(operation.operationId) || job.previousOperationIds.includes(operation.operationId)
          || !job.previousOperationIds.includes(envelope.serverRecord.lastOperationId)
          || operation.uid !== uid || operation.workId !== envelope.record.workId || operation.cloudKey !== envelope.cloudKey
          || operation.kind !== 'create' || operation.generation !== 1 || operation.baseRevision !== 0
          || operation.colorId !== envelope.record.colorId || !equal(operation.selectionRef, envelope.record.selectionRef)) throw fail('RECOVERY_INVALID_JOB');
      if (item.after !== null) {
        let after;
        try { after = JSON.parse(item.after); } catch (_) { throw fail('RECOVERY_INVALID_JOB'); }
        const cloud = freshCloud(item, after.serverRecord);
        if (item.after !== JSON.stringify({ ...envelope, generation: 1, serverRevision: 1, serverRecord: cloud })) throw fail('RECOVERY_INVALID_JOB');
      }
      keys.add(item.key); operations.add(operation.operationId);
    }
    if (job.done && job.items.some(item => item.after === null)) throw fail('RECOVERY_INVALID_JOB');
    if (utf8Length(JSON.stringify(job)) > MAX_JOB_BYTES) throw fail('RECOVERY_CAPACITY');
    return job;
  }
  async function plan({ targets }) {
    const ctx = context();
    if (!Array.isArray(targets) || !targets.length || targets.length > 200) throw fail('RECOVERY_INVALID_TARGETS');
    const keys = await storage.getAllKeys(); ctx.check();
    const job = { schemaVersion: 1, id: makeId(), uid: ctx.uid, items: [], previousOperationIds: [], done: false };
    for (const target of targets) {
      if (!exact(target, ['workId', 'id'])) throw fail('RECOVERY_INVALID_TARGETS');
      const workPrefix = prefix(ctx.uid) + encodeURIComponent(target.workId) + '/';
      let found = null;
      for (const key of keys.filter(value => value.startsWith(workPrefix))) {
        const raw = await storage.getItem(key); ctx.check();
        const envelope = await source(raw, ctx.uid); ctx.check();
        if (!job.previousOperationIds.includes(envelope.serverRecord.lastOperationId)) job.previousOperationIds.push(envelope.serverRecord.lastOperationId);
        if (envelope.localIds.includes(target.id)) {
          if (found) throw fail('RECOVERY_INVALID_TARGETS');
          found = { key, raw, envelope };
        }
      }
      if (!found) throw fail('RECOVERY_TARGET_NOT_FOUND');
      if (found.envelope.deleted) throw fail('RECOVERY_DELETED');
      const record = found.envelope.record;
      const operation = protocol.validateOperation({ schemaVersion: 1, operationId: makeId(), uid: ctx.uid, workId: record.workId,
        cloudKey: found.envelope.cloudKey, kind: 'create', selectionRef: record.selectionRef, colorId: record.colorId, generation: 1, baseRevision: 0 });
      const state = await transport.inspect(operation, { isCurrent: ctx.isCurrent }); ctx.check();
      if (state.cloud || state.receipt) throw fail('SYNC_RECOVERY_TARGET_EXISTS');
      job.items.push({ key: found.key, source: found.raw, operation, after: null });
    }
    const validated = await validateJob(job, ctx.uid); ctx.check(); return validated;
  }
  async function durable(key, raw, ctx) {
    if (utf8Length(raw) > MAX_JOB_BYTES) throw fail('RECOVERY_CAPACITY');
    ctx.check(); await storage.setItem(key, raw); ctx.check();
    if (await storage.getItem(key) !== raw) throw fail('RECOVERY_LOCAL_WRITE_FAILED');
    ctx.check();
  }
  function freshCloud(item, value) {
    const operation = item.operation;
    const cloud = protocol.validateCloudRecord(value, { cloudKey: operation.cloudKey, workId: operation.workId });
    if (cloud.lastOperationId !== operation.operationId || cloud.deleted || cloud.generation !== 1 || cloud.serverRevision !== 1
        || cloud.colorId !== operation.colorId
        || !equal(cloud.selectionRef, operation.selectionRef)) throw fail('RECOVERY_SERVER_CHANGED');
    return cloud;
  }
  function confirmed(item, result, requireActiveAccounting = true) {
    const operation = item.operation, cloud = freshCloud(item, result?.cloud);
    const receipt = protocol.validateReceipt(result?.receipt, operation), metadata = protocol.validateMetadata(result?.metadata);
    const sameTime = value => value.seconds === receipt.createdAt.seconds && value.nanoseconds === receipt.createdAt.nanoseconds;
    if (receipt.resultGeneration !== 1 || receipt.resultRevision !== 1 || receipt.resultPayloadBytes !== cloud.payloadBytes
        || !sameTime(cloud.createdAt) || !sameTime(cloud.updatedAt) || metadata.revision < receipt.metadataRevision
        || requireActiveAccounting && (metadata.activeCount < 1 || metadata.activeBytes < cloud.payloadBytes)
        || metadata.revision === receipt.metadataRevision && metadata.lastOperationId !== operation.operationId) throw fail('RECOVERY_SERVER_CHANGED');
    return cloud;
  }
  async function perform(input, ctx) {
    let job = await validateJob(input, ctx.uid); ctx.check();
    const key = journalKey(ctx.uid, job.id), raw = await storage.getItem(key); ctx.check();
    if (raw !== null) {
      const stored = await validateJob(JSON.parse(raw), ctx.uid); ctx.check();
      const identity = value => value.items.map(item => [item.key, item.source, item.operation]);
      if (stored.id !== job.id || !equal(job.previousOperationIds, stored.previousOperationIds)
          || !equal(identity(job), identity(stored))) throw fail('RECOVERY_JOB_CHANGED');
      job = stored;
    }
    if (raw === null && (job.done || job.items.some(item => item.after !== null))) throw fail('RECOVERY_INVALID_JOB');
    if (job.done) {
      for (const item of job.items) {
        const state = await transport.inspect(item.operation, { isCurrent: ctx.isCurrent }); ctx.check();
        // A completed job proves its original creation, not the current color.
        // Subsequent legitimate edits must not be overwritten on resume.
        const archived = JSON.parse(item.after).serverRecord;
        const receipt = protocol.validateReceipt(state.receipt, item.operation);
        if (!state.cloud || !state.metadata || state.cloud.serverRevision < receipt.resultRevision) throw fail('RECOVERY_SERVER_CHANGED');
        confirmed(item, { ...state, cloud: archived }, false);
      }
      return { id: job.id, recovered: job.items.length, alreadyCompleted: true };
    }
    // All original records are checked before any recovery write is attempted.
    for (const item of job.items) {
      const current = await storage.getItem(item.key); ctx.check();
      if (current !== item.source && (item.after === null || current !== item.after)) throw fail('RECOVERY_SOURCE_CHANGED');
    }
    if (raw === null) await durable(key, JSON.stringify(job), ctx);
    for (const item of job.items) {
      const current = await storage.getItem(item.key); ctx.check();
      if (current !== item.source && (item.after === null || current !== item.after)) throw fail('RECOVERY_SOURCE_CHANGED');
      if (item.after !== null) {
        // A proved acknowledgement must never be silently recreated following
        // another server deletion or replaced by a different operation.
        const state = await transport.inspect(item.operation, { isCurrent: ctx.isCurrent }); ctx.check();
        confirmed(item, state);
      }
      const result = await transport.commit(item.operation, { isCurrent: ctx.isCurrent }); ctx.check();
      const cloud = confirmed(item, result), before = JSON.parse(item.source);
      const after = JSON.stringify({ ...before, generation: cloud.generation, serverRevision: cloud.serverRevision, serverRecord: cloud });
      if (item.after !== null && item.after !== after) throw fail('RECOVERY_SERVER_CHANGED');
      item.after = after;
      await durable(key, JSON.stringify(job), ctx);
      const latest = await storage.getItem(item.key); ctx.check();
      if (latest !== item.source && latest !== after) throw fail('RECOVERY_SOURCE_CHANGED');
      if (latest !== after) await durable(item.key, after, ctx);
    }
    const metadata = new Map();
    for (const item of job.items) {
      const state = await transport.inspect(item.operation, { isCurrent: ctx.isCurrent }); ctx.check();
      confirmed(item, state); metadata.set(item.operation.workId, protocol.validateMetadata(state.metadata));
    }
    const catalogueKey = NAMESPACE + '/catalogue/' + encodeURIComponent(ctx.uid);
    const oldCatalogue = await storage.getItem(catalogueKey); ctx.check();
    const rows = oldCatalogue === null ? [] : JSON.parse(oldCatalogue);
    if (!Array.isArray(rows) || rows.length > 128 || new Set(rows.map(row => row.workId)).size !== rows.length) throw fail('RECOVERY_INVALID_CATALOGUE');
    for (const row of rows) {
      if (!exact(row, ['workId', 'metadata']) || typeof row.workId !== 'string') throw fail('RECOVERY_INVALID_CATALOGUE');
      protocol.validateMetadata(row.metadata);
    }
    const next = rows.filter(row => !metadata.has(row.workId));
    next.push(...Array.from(metadata, ([workId, value]) => ({ workId, metadata: value })));
    if (next.length > 128) throw fail('RECOVERY_INVALID_CATALOGUE');
    next.sort((a, b) => a.workId.localeCompare(b.workId));
    if (await storage.getItem(catalogueKey) !== oldCatalogue) throw fail('RECOVERY_SOURCE_CHANGED');
    ctx.check(); await durable(catalogueKey, JSON.stringify(next), ctx);
    job.done = true; await durable(key, JSON.stringify(job), ctx);
    return { id: job.id, recovered: job.items.length, alreadyCompleted: false };
  }
  function run(job, { approved = false } = {}) {
    if (approved !== true) return Promise.reject(fail('RECOVERY_APPROVAL_REQUIRED'));
    if (running) return running.id === job?.id ? running.promise : Promise.reject(fail('RECOVERY_BUSY'));
    let ctx; try { ctx = context(job?.uid, true); } catch (error) { return Promise.reject(error); }
    const promise = perform(job, ctx).finally(() => { if (running?.promise === promise) running = null; });
    running = { id: job?.id, promise }; return promise;
  }
  async function resume(jobId, options) {
    if (options?.approved !== true) throw fail('RECOVERY_APPROVAL_REQUIRED');
    const ctx = context(undefined, true);
    if (!id(jobId)) throw fail('RECOVERY_INVALID_JOB');
    const raw = await storage.getItem(journalKey(ctx.uid, jobId)); ctx.check();
    if (raw === null) throw fail('RECOVERY_JOB_NOT_FOUND');
    const job = JSON.parse(raw);
    if (job.id !== jobId) throw fail('RECOVERY_JOB_CHANGED');
    return run(job, options);
  }
  return Object.freeze({ plan, run, resume });
}

module.exports = { createHighlightRecovery };
