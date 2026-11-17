const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

function adapter({ platform = 'android', expoCrypto, crypto, nativeModules = {}, reauthenticate,
  projectId = 'demo-adapter', activation } = {}) {
  const user = { uid: 'owner-one', email: 'owner@example.test', async getIdToken(force) {
    assert.equal(force, true); return 'owner-bound-token';
  } };
  const auth = { currentUser: user };
  let storageMode;
  const transformed = babel.transformFileSync(path.resolve(__dirname, '../../account/normalAccountDeletion.js'), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  const globals = {
    Uint8Array, crypto, expo: expoCrypto ? { modules: { ExpoCrypto: expoCrypto } } : undefined,
    Math: Object.create(Math, { random: { value() { throw Error('Insecure random fallback'); } } }),
  };
  vm.runInNewContext('(function(require,module,exports){' + transformed + '\n})', globals)(name => {
    if (name === 'react-native') return { Platform: { OS: platform }, NativeModules: nativeModules };
    if (name === '@react-native-async-storage/async-storage') return {};
    if (name === 'expo-secure-store') return {};
    if (name === 'firebase/auth') return {
      EmailAuthProvider: { credential(email, password) { return { email, password }; } },
      reauthenticateWithCredential: reauthenticate || (async (original, credential) => {
        assert.equal(original, user); assert.equal(credential.email, user.email); return { user };
      }),
      signOut: async () => {},
      deleteUser: async captured => { assert.equal(captured, auth.currentUser); auth.currentUser = null; },
    };
    if (name === 'firebase/firestore') return {};
    if (name === '../firebaseConfig') return { FIREBASE_APP: { options: { projectId } }, FIREBASE_AUTH: auth };
    if (name === '../reader/normalHighlightStore') return { normalHighlightRuntime: {} };
    if (name === './deletionStorage') return { createDeletionStorage: options => { storageMode = options.mode; return {}; } };
    if (name === './sparkDeletionCloud') return { createSparkDeletionCloud: () => ({ fixtureCloud: true }) };
    if (name === './sparkDeletionController') return { createSparkDeletionController: options => options };
    if (name === './deletionTransport') return { createDeletionTransport: () => ({}) };
    if (name === './deletionController') return { createAccountDeletionController: options => options };
    if (name === './deletionActivation') return { ACCOUNT_DELETION: activation || { enabled: false, projectId: 'demo-adapter' } };
    if (name === './authMutationGate') return require('../../account/authMutationGate');
    if (name === '../functions/deletion-contract.json') return require('../../functions/deletion-contract.json');
    throw Error('Unexpected normal adapter dependency ' + name);
  }, module, module.exports);
  return { api: module.exports.accountDeletion, auth, user, storageMode };
}

test('the active release enables deletion only for its intended Firebase project', () => {
  const file = path.resolve(__dirname, '../../account/deletionActivation.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInNewContext('(function(module,exports){' + code + '\n})') (module, module.exports);
  const activation = module.exports.ACCOUNT_DELETION;
  assert.equal(adapter({ projectId: 'shakespearenativeapp', activation }).api.enabled, true);
  assert.equal(adapter({ projectId: 'demo-unrelated-project', activation }).api.enabled, false);
});

test('normal deletion uses the Spark cloud adapter and separate journal without a paid function transport', async () => {
  const h = adapter();
  assert.equal(h.storageMode, 'spark');
  assert.equal(h.api.cloud?.fixtureCloud, true);
  assert.equal(h.api.transport, undefined);
  await h.api.deleteAuth(h.user, { isActive: () => true }); assert.equal(h.auth.currentUser, null);
});

test('queued Auth deletion rechecks foreground state after the shared authentication gate opens', async () => {
  const { runAuthMutation } = require('../../account/authMutationGate');
  let release; const wait = new Promise(resolve => { release = resolve; });
  const occupying = runAuthMutation(() => wait);
  const h = adapter(); let active = true;
  const deleting = h.api.deleteAuth(h.user, { isActive: () => active }); deleting.catch(() => {});
  active = false; release(); await occupying;
  await assert.rejects(deleting, { code: 'ACCOUNT_DELETION_PAUSED' });
  assert.equal(h.auth.currentUser, h.user);
});

test('native ExpoCrypto fills the ticket buffer in place without returning the array', () => {
  let calls = 0;
  const h = adapter({ expoCrypto: { getRandomValues(bytes) {
    calls++; assert.ok(bytes instanceof Uint8Array); assert.equal(bytes.length, 32);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index;
  } } });
  assert.equal(h.api.generateTicket(), Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join(''));
  assert.equal(calls, 1);
});

test('web tickets use Web Crypto and native runtime rejects an untrusted global polyfill', () => {
  let calls = 0;
  const crypto = { getRandomValues(bytes) { calls++; bytes.fill(171); return bytes; } };
  assert.equal(adapter({ platform: 'web', crypto }).api.generateTicket(), 'ab'.repeat(32));
  assert.equal(calls, 1);
  assert.throws(() => adapter({ crypto }).api.generateTicket(), { code: 'ACCOUNT_DELETION_RANDOM_UNAVAILABLE' });
  assert.equal(calls, 1);
});

test('reauthentication obtains its fresh token from the returned owner object', async () => {
  const h = adapter();
  const result = await h.api.reauthenticate(h.user, 'password-in-memory');
  assert.equal(result.uid, h.user.uid);
  assert.equal(result.idToken, 'owner-bound-token');
  assert.equal(h.api.enabled, false);
});

test('native builds without ExpoCrypto use the installed secure RNGetRandomValues module', () => {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
  let calls = 0;
  const h = adapter({ nativeModules: { RNGetRandomValues: { getRandomBase64(length) {
    calls++; assert.equal(length, 32); return Buffer.from(bytes).toString('base64');
  } } } });
  assert.equal(h.api.generateTicket(), Buffer.from(bytes).toString('hex'));
  assert.equal(calls, 1);
});

test('native random failures and malformed or wrong-length base64 fail with one sanitized error', () => {
  const malformed = [undefined, '', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'),
    '!'.repeat(43) + '=', 'A'.repeat(42) + 'B='];
  for (const encoded of malformed) {
    const h = adapter({ nativeModules: { RNGetRandomValues: { getRandomBase64: () => encoded } } });
    assert.throws(() => h.api.generateTicket(), { code: 'ACCOUNT_DELETION_RANDOM_UNAVAILABLE', message: 'Secure randomness is unavailable.' });
  }
  for (const options of [
    { expoCrypto: { getRandomValues() { throw Error('private native diagnostic'); } } },
    { nativeModules: { RNGetRandomValues: { getRandomBase64() { throw Error('private native diagnostic'); } } } },
  ]) assert.throws(() => adapter(options).api.generateTicket(), { code: 'ACCOUNT_DELETION_RANDOM_UNAVAILABLE', message: 'Secure randomness is unavailable.' });
});
