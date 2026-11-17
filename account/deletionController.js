const contract = require('../functions/deletion-contract.json');
const failure = code => Object.assign(new Error('Account deletion could not be completed.'), { code });
const ticketOK = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function createAccountDeletionController({ getUser, reauthenticate, generateTicket, storage, runtime, transport,
  signOut, onComplete = () => {}, enabled = false, now = Date.now, schedule = setTimeout, unschedule = clearTimeout }) {
  let intent = null, subjectUid = null, busy = false, initialized = false, initializing = null, initializationFailed = false, timer = null, foreground = true;
  let snapshot = Object.freeze({ initialized: false, available: enabled, status: 'idle', uid: null, phase: null, error: null });
  const listeners = new Set();
  function publish(status, error = null, phase = null) {
    snapshot = Object.freeze({ initialized, available: enabled, status, uid: intent?.uid || subjectUid, phase, error,
      requiresPassword: intent?.phase === 'prepared' });
    for (const listener of [...listeners]) { try { listener(); } catch {} }
  }
  const cancelTimer = () => { if (timer !== null) unschedule(timer); timer = null; };
  function later() {
    cancelTimer();
    if (foreground && intent) timer = schedule(() => { timer = null; check().catch(() => {}); }, 5000);
  }
  async function save(phase) {
    const next = { ...intent, phase };
    await storage.saveIntent(next);
    intent = next;
  }
  function response(value) {
    if (!value || Object.keys(value).length !== 2 || !contract.statuses.includes(value.status) || !contract.phases.includes(value.phase)
      || (value.status === 'complete') !== (value.phase === 'complete')) throw failure('ACCOUNT_DELETION_STATUS_FAILED');
    return value;
  }
  async function clean() {
    if (intent.phase !== 'cleanup') await save('cleanup');
    publish('cleaning', null, 'local-cleanup');
    const finishing = intent;
    await storage.clearAccountData(finishing);
    if (getUser()?.uid === finishing.uid) await signOut(finishing.uid);
    // Keep the proof journal until the backend has acknowledged device cleanup.
    // Unacknowledged server receipts do not expire while this device is offline.
    try {
      const acknowledged = response(await transport.acknowledge(finishing.uid, finishing.ticket));
      if (acknowledged.status !== 'complete') throw failure('ACCOUNT_DELETION_STATUS_FAILED');
    } catch (error) {
      // A lost acknowledgment can be followed by expiry while offline. The
      // durable cleanup phase already proves verified server completion; a
      // missing receipt alone never promotes a prepared/accepted intent.
      if (error?.code !== 'ACCOUNT_DELETION_RECEIPT_NOT_FOUND') throw error;
    }
    await storage.removeIntent({ uid: finishing.uid, ticket: finishing.ticket });
    cancelTimer();
    snapshot = Object.freeze({ initialized: true, available: enabled, status: 'complete', uid: finishing.uid, phase: 'complete', error: null });
    intent = null;
    for (const listener of [...listeners]) { try { listener(); } catch {} }
    try { onComplete(finishing.uid); } catch {}
  }
  async function accept(value) {
    const result = response(value);
    if (result.status === 'complete') { await clean(); return; }
    if (intent.phase === 'prepared') await save('accepted');
    publish(result.status === 'retry-needed' ? 'retry-needed' : 'deleting',
      result.status === 'retry-needed' ? 'ACCOUNT_DELETION_SERVER_RETRY' : null, result.phase);
    later();
  }
  function report(error) {
    const cleanup = intent?.phase === 'cleanup';
    publish('retry-needed', cleanup ? 'ACCOUNT_DELETION_LOCAL_CLEANUP_FAILED'
      : error?.code?.startsWith('ACCOUNT_DELETION_') ? error.code : 'ACCOUNT_DELETION_UNAVAILABLE', cleanup ? 'local-cleanup' : null);
    if (intent?.phase === 'accepted' || (intent?.phase === 'prepared' && error?.code !== 'ACCOUNT_DELETION_RECEIPT_NOT_FOUND')) later();
  }
  async function check() {
    if (busy || !intent) return;
    busy = true;
    cancelTimer();
    try {
      if (intent.phase === 'cleanup') await clean();
      else await accept(await transport.status(intent.uid, intent.ticket));
    } catch (error) { report(error); }
    finally { busy = false; }
  }
  function initialize() {
    if (initializing) return initializing;
    if (initialized && !initializationFailed) return Promise.resolve();
    initializing = (async () => {
      try {
        intent = await storage.loadIntent();
        if (intent) runtime.blockAccount(intent.uid);
        initialized = true; initializationFailed = false;
        publish(intent ? 'deleting' : 'idle');
        if (intent) await check();
      } catch { initialized = true; initializationFailed = true; publish('retry-needed', 'ACCOUNT_DELETION_STORAGE_FAILED'); }
    })().finally(() => { initializing = null; });
    return initializing;
  }
  async function confirm(password) {
    if (!enabled) throw failure('ACCOUNT_DELETION_NOT_ACTIVE');
    const requestedUser = getUser();
    await initialize();
    if (initializationFailed) throw failure('ACCOUNT_DELETION_STORAGE_FAILED');
    if (getUser() !== requestedUser) return;
    if (busy) throw failure('ACCOUNT_DELETION_BUSY');
    if (intent) {
      if (intent.phase !== 'prepared') return check();
      // The original response may have vanished after Auth was deleted. Resolve
      // its retained capability before attempting another password sign-in.
      await check();
      if (!intent || intent.phase !== 'prepared' || snapshot.error !== 'ACCOUNT_DELETION_RECEIPT_NOT_FOUND') return;
      if (getUser() !== requestedUser) return;
    }
    const user = getUser();
    if (!user?.uid || !user.email) throw failure('ACCOUNT_DELETION_SIGN_IN_REQUIRED');
    if (typeof password !== 'string' || password.length === 0) throw failure('ACCOUNT_DELETION_PASSWORD_REQUIRED');
    if (intent && intent.uid !== user.uid) throw failure('ACCOUNT_DELETION_OTHER_ACCOUNT');
    busy = true;
    subjectUid = user.uid;
    cancelTimer();
    const owns = () => getUser() === user;
    publish('confirming');
    let authenticated = false;
    try {
      const credentials = await reauthenticate(user, password);
      authenticated = true;
      if (!owns() || credentials?.uid !== user.uid || typeof credentials.idToken !== 'string' || !credentials.idToken) {
        throw failure('ACCOUNT_DELETION_ACCOUNT_CHANGED');
      }
      if (!intent) {
        const ticket = generateTicket();
        if (!ticketOK(ticket)) throw failure('ACCOUNT_DELETION_STORAGE_FAILED');
        const prepared = { version: 1, uid: user.uid, email: user.email, ticket, phase: 'prepared', createdAt: now() };
        await storage.saveIntent(prepared);
        intent = prepared;
      }
      if (!owns()) throw failure('ACCOUNT_DELETION_ACCOUNT_CHANGED');
      runtime.blockAccount(intent.uid);
      publish('requesting');
      let result;
      try { result = await transport.request({ ticket: intent.ticket, idToken: credentials.idToken }); }
      catch (requestError) {
        // The server may have committed before its response was lost. The
        // prewritten ticket resolves that ambiguity without issuing a new job.
        try { result = await transport.status(intent.uid, intent.ticket); }
        catch { throw requestError; }
      }
      await accept(result);
    } catch (error) {
      if (intent && !authenticated) publish('retry-needed', 'ACCOUNT_DELETION_REAUTH_FAILED');
      else if (intent) report(error);
      else publish('idle', ['ACCOUNT_DELETION_ACCOUNT_CHANGED', 'ACCOUNT_DELETION_RANDOM_UNAVAILABLE', 'ACCOUNT_DELETION_STORAGE_FAILED'].includes(error?.code)
        ? error.code : 'ACCOUNT_DELETION_REAUTH_FAILED');
    } finally { busy = false; }
  }
  return {
    initialize, confirm, check,
    retry(password) { return initializationFailed ? initialize() : intent?.phase === 'prepared' && typeof password === 'string' ? confirm(password) : check(); },
    foreground() { foreground = true; return initializationFailed ? initialize() : check(); },
    background() { foreground = false; cancelTimer(); },
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

module.exports = { createAccountDeletionController };
