const { runCredentialMutation } = require('./credentialGate');

const INTENT_KEY = 'bard.accountDeletion.intent.v1';
const SPARK_INTENT_KEY = 'bard.accountDeletion.spark.intent.v1';
const NAMESPACE = '@bard/reader-highlights-sync:account-v2';
const FIELDS = ['version', 'uid', 'email', 'ticket', 'phase', 'createdAt'];
const PHASES = Object.freeze({ prepared: 0, accepted: 1, cleanup: 2 });
const SPARK_PHASES = Object.freeze({ prepared: 0, accepted: 1, 'auth-pending': 2, cleanup: 3 });
const queues = new WeakMap();
const failure = (code, cause) => Object.assign(new Error('Account deletion storage could not be completed.'), { code, ...(cause ? { cause } : {}) });
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
function validateIntent(value, phases) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Reflect.ownKeys(value).length !== FIELDS.length || FIELDS.some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value');
      }) || value.version !== 1 || !text(value.uid, 128) || !text(value.email, 320) || !value.email.includes('@')
      || typeof value.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(value.ticket)
      || !Object.prototype.hasOwnProperty.call(phases, value.phase) || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    throw failure('ACCOUNT_DELETION_INVALID_INTENT');
  }
  return Object.freeze(Object.fromEntries(FIELDS.map(key => [key, value[key]])));
}
function accountKey(key, uid) {
  const encoded = encodeURIComponent(uid);
  return key.startsWith('@bard/reader-highlights:v1/' + encoded + '/')
    || ['v2', 'legacy', 'retired', 'recovery'].some(kind => key.startsWith(NAMESPACE + '/' + kind + '/' + encoded + '/'))
    || key === NAMESPACE + '/catalogue/' + encoded;
}
function createDeletionStorage({ storage, secureStore, runtime, mode = 'server' } = {}) {
  if (!['server', 'spark'].includes(mode)) throw failure('ACCOUNT_DELETION_INVALID_MODE');
  if (!secureStore || ['getItemAsync', 'setItemAsync', 'deleteItemAsync'].some(method => typeof secureStore[method] !== 'function')) throw failure('ACCOUNT_DELETION_STORAGE_FAILED');
  const key = mode === 'spark' ? SPARK_INTENT_KEY : INTENT_KEY;
  const phases = mode === 'spark' ? SPARK_PHASES : PHASES;
  const validate = value => validateIntent(value, phases);
  function enqueue(run) {
    const task = (queues.get(secureStore) || Promise.resolve()).then(run);
    queues.set(secureStore, task.catch(() => {}));
    return task;
  }
  async function secure(method, ...args) {
    try { return await secureStore[method](...args); }
    catch (error) { throw failure('ACCOUNT_DELETION_STORAGE_FAILED', error); }
  }
  async function checkLegacy() {
    if (mode === 'spark' && await secure('getItemAsync', INTENT_KEY) !== null) throw failure('ACCOUNT_DELETION_LEGACY_PENDING');
  }
  async function readIntent() {
    await checkLegacy();
    const raw = await secure('getItemAsync', key);
    if (raw === null) return null;
    if (typeof raw !== 'string') throw failure('ACCOUNT_DELETION_INVALID_INTENT');
    let value;
    try { value = JSON.parse(raw); } catch (_) { throw failure('ACCOUNT_DELETION_INVALID_INTENT'); }
    return validate(value);
  }
  const loadIntent = () => enqueue(readIntent);
  function saveIntent(value) {
    let intent;
    try { intent = validate(value); } catch (error) { return Promise.reject(error); }
    return enqueue(async () => {
      const previous = await readIntent();
      if (previous && (previous.uid !== intent.uid || previous.ticket !== intent.ticket)) throw failure('ACCOUNT_DELETION_BUSY');
      if (previous && (previous.email !== intent.email || previous.createdAt !== intent.createdAt || phases[intent.phase] < phases[previous.phase])) throw failure('ACCOUNT_DELETION_INVALID_TRANSITION');
      await secure('setItemAsync', key, JSON.stringify(intent));
      return intent;
    });
  }
  function removeIntent(expected) {
    if (!expected || !text(expected.uid, 128) || typeof expected.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(expected.ticket)) return Promise.reject(failure('ACCOUNT_DELETION_INVALID_INTENT'));
    const { uid, ticket } = expected;
    return enqueue(async () => {
      const previous = await readIntent();
      if (!previous) return false;
      if (previous.uid !== uid || previous.ticket !== ticket) throw failure('ACCOUNT_DELETION_BUSY');
      await secure('deleteItemAsync', key);
      return true;
    });
  }
  async function clearAccountData(value) {
    const intent = validate(value);
    if (intent.phase !== 'cleanup') throw failure('ACCOUNT_DELETION_INVALID_TRANSITION');
    await checkLegacy();
    if (!runtime || typeof runtime.purgeAccount !== 'function' || !storage || typeof storage.getAllKeys !== 'function') throw failure('ACCOUNT_DELETION_CLEANUP_FAILED');
    try {
      await runtime.purgeAccount(intent.uid);
      const keys = await storage.getAllKeys();
      if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string' || accountKey(key, intent.uid))) throw failure('ACCOUNT_DELETION_CLEANUP_FAILED');
      await runCredentialMutation(async () => {
        const raw = await secure('getItemAsync', 'userinfo');
        if (typeof raw !== 'string') return;
        let saved;
        try { saved = JSON.parse(raw); } catch (_) { return; }
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
        const matches = Object.prototype.hasOwnProperty.call(saved, 'uid') ? typeof saved.uid === 'string' && saved.uid === intent.uid
          : typeof saved.email === 'string' && saved.email.toLowerCase() === intent.email.toLowerCase();
        if (matches && await secure('getItemAsync', 'userinfo') === raw) await secure('deleteItemAsync', 'userinfo');
      });
      return true;
    } catch (error) {
      if (error.code === 'ACCOUNT_DELETION_CLEANUP_FAILED') throw error;
      throw failure('ACCOUNT_DELETION_CLEANUP_FAILED', error);
    }
  }
  return { loadIntent, saveIntent, removeIntent, clearAccountData };
}
module.exports = { createDeletionStorage };
