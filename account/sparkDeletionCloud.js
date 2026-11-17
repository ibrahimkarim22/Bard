const PAGE_SIZE = 100;
const failure = code => Object.assign(new Error('Account data cleanup could not be completed.'), { code });
const codes = new Set(['PAUSED', 'OTHER_ACCOUNT', 'RULES_DENIED', 'QUOTA', 'UNAVAILABLE', 'SCHEMA_UNSUPPORTED', 'INVALID_MARKER', 'REAUTH_REQUIRED']
  .map(name => 'ACCOUNT_DELETION_' + name));
const pathPart = (value, maximum = 1500) => typeof value === 'string' && value.length > 0 && value.length <= maximum
  && !/[\/\\\u0000-\u001f\u007f]/.test(value) && value !== '.' && value !== '..';
function sanitized(error) {
  if (codes.has(error?.code)) return failure(error.code);
  const code = String(error?.code || '').split('/').at(-1);
  return failure(code === 'permission-denied' ? 'ACCOUNT_DELETION_RULES_DENIED'
    : code === 'resource-exhausted' ? 'ACCOUNT_DELETION_QUOTA'
      : ['unauthenticated', 'user-token-expired', 'invalid-user-token', 'requires-recent-login', 'user-disabled', 'user-not-found'].includes(code)
        ? 'ACCOUNT_DELETION_REAUTH_REQUIRED' : 'ACCOUNT_DELETION_UNAVAILABLE');
}
function markerValue(value) {
  let time;
  try { time = value?.startedAt?.toMillis(); } catch { throw failure('ACCOUNT_DELETION_INVALID_MARKER'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'schemaVersion,startedAt,status'
      || value.schemaVersion !== 1 || value.status !== 'deleting' || !Number.isFinite(time) || time < 0) throw failure('ACCOUNT_DELETION_INVALID_MARKER');
  return Object.freeze({ schemaVersion: 1, status: 'deleting', startedAt: value.startedAt });
}

function createSparkDeletionCloud({ db, sdk, projectId, getUser, fetchImpl = globalThis.fetch,
  baseUrl = 'https://firestore.googleapis.com/v1', timeoutMs = 30000 } = {}) {
  const production = projectId === 'shakespearenativeapp' && baseUrl === 'https://firestore.googleapis.com/v1';
  const isolated = projectId === 'demo-bard-spark-deletion' && baseUrl === 'http://127.0.0.1:8181/v1';
  if ((!production && !isolated) || db?.app?.options?.projectId !== projectId || typeof getUser !== 'function'
      || typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000
      || !sdk || ['doc', 'collection', 'query', 'limit', 'getDocFromServer', 'getDocsFromServer', 'runTransaction',
        'serverTimestamp', 'writeBatch', 'deleteDoc'].some(key => typeof sdk[key] !== 'function')) throw failure('ACCOUNT_DELETION_UNAVAILABLE');
  const resource = 'projects/' + projectId + '/databases/(default)/documents/';
  function guard(user, isActive) {
    let current;
    try { current = getUser(); } catch { throw failure('ACCOUNT_DELETION_OTHER_ACCOUNT'); }
    if (!user || current !== user || !pathPart(user.uid, 128)) throw failure('ACCOUNT_DELETION_OTHER_ACCOUNT');
    if (isActive && isActive() !== true) throw failure('ACCOUNT_DELETION_PAUSED');
  }
  async function step(user, action, isActive) {
    guard(user, isActive);
    let timer;
    try {
      const deadline = new Promise((resolve, reject) => { timer = setTimeout(() => reject(failure('ACCOUNT_DELETION_UNAVAILABLE')), timeoutMs); });
      const pending = Promise.resolve().then(() => { guard(user, isActive); return action(); });
      // SDK writes may stay queued offline. Timing out stops this workflow,
      // while any already-issued request remains bound to its original paths.
      const value = await Promise.race([pending, deadline]);
      guard(user, isActive); return value;
    }
    catch (error) { guard(user, isActive); throw sanitized(error); }
    finally { clearTimeout(timer); }
  }
  function confirmed(snapshot) {
    if (!snapshot || snapshot.metadata?.fromCache !== false || snapshot.metadata?.hasPendingWrites !== false) throw failure('ACCOUNT_DELETION_UNAVAILABLE');
    return snapshot;
  }
  const markerReference = user => sdk.doc(db, 'accountDeletions', user.uid);
  async function readMarker(user, isActive) {
    guard(user, isActive);
    const snapshot = confirmed(await step(user, () => sdk.getDocFromServer(markerReference(user)), isActive));
    if (typeof snapshot.exists !== 'function') throw failure('ACCOUNT_DELETION_INVALID_MARKER');
    return snapshot.exists() ? markerValue(snapshot.data()) : null;
  }
  async function getMarker(user) { return readMarker(user); }
  async function ensureMarker(user) {
    guard(user);
    await step(user, () => sdk.runTransaction(db, async transaction => {
      guard(user);
      const ref = markerReference(user), snapshot = await transaction.get(ref);
      guard(user);
      if (snapshot.exists()) markerValue(snapshot.data());
      else transaction.set(ref, { schemaVersion: 1, status: 'deleting', startedAt: sdk.serverTimestamp() });
    }));
    const marker = await getMarker(user);
    if (!marker) throw failure('ACCOUNT_DELETION_INVALID_MARKER');
    return marker;
  }
  async function requireMarker(user, isActive) {
    if (!await readMarker(user, isActive)) throw failure('ACCOUNT_DELETION_INVALID_MARKER');
  }
  function groupReference(user, collection, name) {
    if (typeof name !== 'string' || !name.startsWith(resource)) throw failure('ACCOUNT_DELETION_SCHEMA_UNSUPPORTED');
    const parts = name.slice(resource.length).split('/');
    if (parts.length !== 6 || parts[0] !== 'users' || parts[1] !== user.uid || parts[2] !== 'highlightWorks'
        || !pathPart(parts[3], 128) || parts[4] !== collection || !pathPart(parts[5])) throw failure('ACCOUNT_DELETION_SCHEMA_UNSUPPORTED');
    return sdk.doc(db, ...parts);
  }
  async function groupPage(user, collection, limit, isActive) {
    const token = await step(user, () => user.getIdToken(), isActive);
    if (typeof token !== 'string' || !token) throw failure('ACCOUNT_DELETION_REAUTH_REQUIRED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const payload = await step(user, async () => {
        const response = await fetchImpl(baseUrl + '/' + resource + 'users/' + encodeURIComponent(user.uid) + ':runQuery', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ structuredQuery: {
            select: { fields: [{ fieldPath: '__name__' }] }, from: [{ collectionId: collection, allDescendants: true }],
            orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit,
          } }),
        });
        if (response?.ok !== true) throw failure(response?.status === 429 ? 'ACCOUNT_DELETION_QUOTA'
          : response?.status === 403 ? 'ACCOUNT_DELETION_RULES_DENIED'
            : response?.status === 401 ? 'ACCOUNT_DELETION_REAUTH_REQUIRED' : 'ACCOUNT_DELETION_UNAVAILABLE');
        return response.json();
      }, isActive);
      if (!Array.isArray(payload) || !payload.length || payload.length > limit) throw failure('ACCOUNT_DELETION_SCHEMA_UNSUPPORTED');
      const refs = [], seen = new Set();
      for (const result of payload) {
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw failure('ACCOUNT_DELETION_SCHEMA_UNSUPPORTED');
        if (result.error !== undefined) throw failure('ACCOUNT_DELETION_SCHEMA_UNSUPPORTED');
        if (result.document === undefined) {
          if (typeof result.readTime !== 'string' || !result.readTime) throw failure('ACCOUNT_DELETION_SCHEMA_UNSUPPORTED');
          continue;
        }
        const ref = groupReference(user, collection, result.document?.name);
        if (seen.has(ref.path)) throw failure('ACCOUNT_DELETION_SCHEMA_UNSUPPORTED');
        seen.add(ref.path); refs.push(ref);
      }
      return refs;
    } catch (error) { throw sanitized(error); }
    finally { clearTimeout(timer); }
  }
  async function collectionPage(user, collection, limit, isActive) {
    const parent = ['users', user.uid, collection];
    const query = sdk.query(sdk.collection(db, ...parent), sdk.limit(limit));
    const snapshot = confirmed(await step(user, () => sdk.getDocsFromServer(query), isActive));
    if (!Array.isArray(snapshot.docs) || snapshot.docs.length > limit) throw failure('ACCOUNT_DELETION_SCHEMA_UNSUPPORTED');
    const seen = new Set();
    return snapshot.docs.map(document => {
      if (!pathPart(document.id, collection === 'highlightWorks' ? 128 : 1500) || seen.has(document.id)
          || document.ref?.path !== [...parent, document.id].join('/')) throw failure('ACCOUNT_DELETION_SCHEMA_UNSUPPORTED');
      seen.add(document.id); return sdk.doc(db, ...parent, document.id);
    });
  }
  async function erasePages(user, readPage, isActive) {
    for (;;) {
      const refs = await readPage();
      guard(user, isActive);
      if (!refs.length) return;
      const batch = sdk.writeBatch(db);
      for (const ref of refs) { guard(user, isActive); batch.delete(ref); }
      await step(user, () => batch.commit(), isActive);
    }
  }
  async function verifyEmpty(user, { isActive } = {}) {
    await requireMarker(user, isActive);
    const profile = confirmed(await step(user, () => sdk.getDocFromServer(sdk.doc(db, 'users', user.uid)), isActive));
    if (profile.exists()) return false;
    for (const collection of ['quizzes', 'highlightWorks']) if ((await collectionPage(user, collection, 1, isActive)).length) return false;
    for (const collection of ['highlights', 'operations']) if ((await groupPage(user, collection, 1, isActive)).length) return false;
    guard(user, isActive); return true;
  }
  async function cleanup(user, { isActive, onProgress } = {}) {
    await requireMarker(user, isActive);
    const progress = phase => { guard(user, isActive); try { onProgress?.(phase); } catch {} guard(user, isActive); };
    for (const collection of ['highlights', 'operations']) {
      progress('deleting-' + collection);
      await erasePages(user, () => groupPage(user, collection, PAGE_SIZE, isActive), isActive);
    }
    for (const collection of ['quizzes', 'highlightWorks']) {
      progress(collection === 'quizzes' ? 'deleting-quizzes' : 'deleting-work-metadata');
      await erasePages(user, () => collectionPage(user, collection, PAGE_SIZE, isActive), isActive);
    }
    progress('deleting-profile');
    const ref = sdk.doc(db, 'users', user.uid);
    const profile = confirmed(await step(user, () => sdk.getDocFromServer(ref), isActive));
    if (profile.exists()) await step(user, () => sdk.deleteDoc(ref), isActive);
    progress('verifying-data');
    if (!await verifyEmpty(user, { isActive })) throw failure('ACCOUNT_DELETION_UNAVAILABLE');
    return true;
  }
  function watchMarker(user, onMarker, onError = () => {}) {
    guard(user);
    if (typeof onMarker !== 'function') throw failure('ACCOUNT_DELETION_UNAVAILABLE');
    if (typeof sdk.onSnapshot !== 'function') return () => {};
    let stopped = false, unsubscribe = null;
    const stop = () => { if (stopped) return; stopped = true; unsubscribe?.(); };
    const active = () => {
      if (stopped) return false;
      try { guard(user); return true; } catch { stop(); return false; }
    };
    const fail = error => { if (active()) { try { onError(sanitized(error)); } catch {} } };
    try {
      unsubscribe = sdk.onSnapshot(markerReference(user), { includeMetadataChanges: true }, snapshot => {
        if (!active() || snapshot.metadata?.fromCache !== false || snapshot.metadata?.hasPendingWrites !== false) return;
        try { const value = snapshot.exists() ? markerValue(snapshot.data()) : null; if (active()) onMarker(value); }
        catch (error) { fail(error); }
      }, fail);
      if (stopped) unsubscribe?.();
    } catch (error) { fail(error); }
    return stop;
  }
  return Object.freeze({ getMarker, ensureMarker, cleanup, verifyEmpty, watchMarker });
}
module.exports = { createSparkDeletionCloud };
