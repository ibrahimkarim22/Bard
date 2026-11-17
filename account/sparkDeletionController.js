const failure = code => Object.assign(new Error('Account deletion is not yet confirmed.'), { code });
const authErrors = new Set(['auth/requires-recent-login', 'auth/user-token-expired', 'auth/invalid-user-token', 'ACCOUNT_DELETION_REAUTH_REQUIRED']);

function createSparkDeletionController({ enabled = false, getUser, reauthenticate, generateTicket, storage, runtime, cloud, deleteAuth,
  schedule = setTimeout, unschedule = clearTimeout, now = Date.now }) {
  let initialized = false, initializing = null, loadFailed = false, intent = null, busy = false, foreground = true;
  let requiresPassword = false, authConfirmed = false, subjectUid = null, timer = null, attempts = 0;
  let watchedUser = null, unsubscribe = null, probePending = false;
  const listeners = new Set();
  let snapshot = Object.freeze({ initialized: false, available: enabled, status: 'idle', uid: null, phase: null, error: null, requiresPassword: false });
  function publish(status, error = null, phase = null) {
    snapshot = Object.freeze({ initialized, available: enabled, status, uid: intent?.uid || subjectUid, phase, error, requiresPassword });
    for (const listener of [...listeners]) { try { listener(); } catch {} }
  }
  function cancelTimer() { if (timer !== null) unschedule(timer); timer = null; }
  function later() {
    cancelTimer();
    if (foreground && !requiresPassword && (intent || probePending)) {
      timer = schedule(() => { timer = null; check().catch(() => {}); }, Math.min(60000, 5000 * (2 ** Math.min(attempts, 4))));
    }
  }
  function active(user) { return foreground && getUser() === user; }
  function assertActive(user) { if (!active(user)) throw failure(foreground ? 'ACCOUNT_DELETION_OTHER_ACCOUNT' : 'ACCOUNT_DELETION_PAUSED'); }
  async function save(phase) { const next = { ...intent, phase }; await storage.saveIntent(next); intent = next; }
  async function newIntent(user, phase) {
    const ticket = generateTicket();
    if (typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket)) throw failure('ACCOUNT_DELETION_RANDOM_UNAVAILABLE');
    const next = { version: 1, uid: user.uid, email: user.email, ticket, phase, createdAt: now() };
    await storage.saveIntent(next); intent = next; runtime.blockAccount(user.uid);
  }
  async function clean() {
    if (intent.phase !== 'cleanup') await save('cleanup');
    publish('cleaning', null, 'local-cleanup');
    await storage.clearAccountData(intent);
    const uid = intent.uid;
    await storage.removeIntent({ uid, ticket: intent.ticket });
    intent = null; authConfirmed = false; requiresPassword = false; attempts = 0; subjectUid = uid;
    cancelTimer(); unsubscribe?.(); unsubscribe = null; watchedUser = null;
    publish('complete', null, 'complete');
  }
  function report(error) {
    let code = error?.code;
    if (code === 'ACCOUNT_DELETION_PAUSED') { publish('paused', null, intent?.phase); return; }
    if (authErrors.has(code)) { code = 'ACCOUNT_DELETION_REAUTH_REQUIRED'; requiresPassword = true; }
    if (!code?.startsWith('ACCOUNT_DELETION_')) code = 'ACCOUNT_DELETION_UNAVAILABLE';
    if (authConfirmed || intent?.phase === 'cleanup') code = 'ACCOUNT_DELETION_LOCAL_CLEANUP_FAILED';
    publish('retry-needed', code, intent?.phase);
    attempts++;
    if (!['ACCOUNT_DELETION_OTHER_ACCOUNT', 'ACCOUNT_DELETION_SIGN_IN_REQUIRED', 'ACCOUNT_DELETION_AUTH_UNCONFIRMED',
      'ACCOUNT_DELETION_RULES_DENIED', 'ACCOUNT_DELETION_SCHEMA_UNSUPPORTED', 'ACCOUNT_DELETION_INVALID_MARKER',
      'ACCOUNT_DELETION_MARKER_MISSING', 'ACCOUNT_DELETION_QUOTA'].includes(code)) later();
  }
  async function perform(user) {
    if (authConfirmed || intent.phase === 'cleanup') { await clean(); return; }
    assertActive(user);
    if (!user || user.uid !== intent.uid) throw failure('ACCOUNT_DELETION_OTHER_ACCOUNT');
    if (!await cloud.getMarker(user)) throw failure('ACCOUNT_DELETION_MARKER_MISSING');
    assertActive(user);
    if (intent.phase === 'prepared') await save('accepted');
    requiresPassword = false;
    publish('deleting', null, 'deleting-data');
    const context = { isActive: () => active(user), onProgress: phase => {
      if (active(user)) publish('deleting', null, phase);
    } };
    await cloud.cleanup(user, context); assertActive(user);
    publish('deleting', null, 'verifying-data');
    if (await cloud.verifyEmpty(user, context) !== true) throw failure('ACCOUNT_DELETION_DATA_REMAINS');
    assertActive(user);
    if (intent.phase !== 'auth-pending') await save('auth-pending');
    assertActive(user); publish('deleting', null, 'deleting-auth');
    try { await deleteAuth(user, { isActive: () => active(user) }); }
    catch (error) {
      if (['ACCOUNT_DELETION_PAUSED', 'ACCOUNT_DELETION_OTHER_ACCOUNT'].includes(error?.code)) throw error;
      // A lost response, expired token, or sign-out is not proof that Auth was
      // deleted. Retain both the journal and local originals until confirmed.
      if (authErrors.has(error?.code) && getUser() === user) throw error;
      throw failure('ACCOUNT_DELETION_AUTH_UNCONFIRMED');
    }
    authConfirmed = true;
    await clean();
  }
  function watchOwner() {
    const user = foreground && enabled ? getUser() : null;
    if (user === watchedUser) return;
    unsubscribe?.(); unsubscribe = null; watchedUser = user;
    if (user && cloud.watchMarker) unsubscribe = cloud.watchMarker(user, value => {
      if (!value || getUser() !== user || intent) return;
      probePending = true;
      if (busy) later(); else check().catch(() => {});
    }, () => {});
  }
  async function check() {
    if (busy || !initialized || loadFailed || !foreground) return;
    if (!intent && !enabled) return;
    busy = true; cancelTimer();
    try {
      if (authConfirmed || intent?.phase === 'cleanup') { await clean(); return; }
      if (requiresPassword && intent?.phase === 'auth-pending') return;
      const user = getUser();
      if (!user?.uid || !user.email) {
        if (intent) throw failure(intent.phase === 'auth-pending' ? 'ACCOUNT_DELETION_AUTH_UNCONFIRMED' : 'ACCOUNT_DELETION_SIGN_IN_REQUIRED');
        return;
      }
      if (intent && intent.uid !== user.uid) throw failure('ACCOUNT_DELETION_OTHER_ACCOUNT');
      const marker = await cloud.getMarker(user); assertActive(user); probePending = false;
      if (!intent) {
        if (!marker) { subjectUid = null; publish('idle'); return; }
        await newIntent(user, 'accepted');
      } else if (!marker) {
        if (intent.phase !== 'prepared') throw failure('ACCOUNT_DELETION_MARKER_MISSING');
        requiresPassword = true; publish('retry-needed', 'ACCOUNT_DELETION_REAUTH_REQUIRED', 'prepared'); return;
      }
      await perform(user);
    } catch (error) { report(error); }
    finally { busy = false; if (probePending && foreground) later(); }
  }
  function initialize() {
    if (initializing) return initializing;
    if (initialized && !loadFailed) return Promise.resolve();
    initializing = (async () => {
      try {
        intent = await storage.loadIntent();
        if (intent) runtime.blockAccount(intent.uid);
        initialized = true; loadFailed = false; publish(intent ? 'paused' : 'idle', null, intent?.phase);
      } catch { initialized = true; loadFailed = true; publish('retry-needed', 'ACCOUNT_DELETION_STORAGE_FAILED'); return; }
      watchOwner(); await check();
    })().finally(() => { initializing = null; });
    return initializing;
  }
  async function confirm(password) {
    if (!enabled) throw failure('ACCOUNT_DELETION_NOT_ACTIVE');
    const user = getUser(); await initialize();
    if (loadFailed) throw failure('ACCOUNT_DELETION_STORAGE_FAILED');
    if (getUser() !== user) return;
    if (busy) throw failure('ACCOUNT_DELETION_BUSY');
    if (!user?.uid || !user.email) throw failure('ACCOUNT_DELETION_SIGN_IN_REQUIRED');
    if (intent && intent.uid !== user.uid) throw failure('ACCOUNT_DELETION_OTHER_ACCOUNT');
    if (intent?.phase === 'cleanup' || authConfirmed) return check();
    if (typeof password !== 'string' || !password) throw failure('ACCOUNT_DELETION_PASSWORD_REQUIRED');
    busy = true; subjectUid = user.uid; requiresPassword = false; cancelTimer(); publish('confirming');
    let authenticated = false;
    try {
      const result = await reauthenticate(user, password);
      authenticated = true; assertActive(user);
      if (result?.uid !== user.uid) throw failure('ACCOUNT_DELETION_OTHER_ACCOUNT');
      if (!intent) await newIntent(user, 'prepared');
      assertActive(user); publish('requesting', null, intent.phase);
      if (intent.phase === 'prepared') {
        try { await cloud.ensureMarker(user); }
        catch (error) {
          assertActive(user);
          if (!await cloud.getMarker(user)) throw error;
        }
        assertActive(user); await save('accepted');
      }
      await perform(user);
    } catch (error) {
      if (!authenticated) { requiresPassword = true; publish('retry-needed', 'ACCOUNT_DELETION_REAUTH_FAILED'); }
      else report(error);
    } finally { busy = false; if (probePending && foreground) later(); }
  }
  async function ownerChanged() { await initialize(); watchOwner(); await check(); }
  async function foregrounded() { foreground = true; await ownerChanged(); }
  function background() { foreground = false; cancelTimer(); watchOwner(); }
  async function retry() { await initialize(); watchOwner(); await check(); }
  return Object.freeze({ initialize, confirm, check, retry, ownerChanged, foreground: foregrounded, background,
    getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } });
}
module.exports = { createSparkDeletionController };
