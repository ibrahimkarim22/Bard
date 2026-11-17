const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { initializeApp, deleteApp } = require('firebase/app');
const firebaseAuth = require('firebase/auth');
const { runAuthMutation } = require('../../account/authMutationGate');

function deletionAdapter(auth) {
  const file = path.resolve(__dirname, '../../account/normalAccountDeletion.js');
  const code = babel.transformFileSync(file, {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const dependencies = {
    '@react-native-async-storage/async-storage': {}, 'expo-secure-store': {},
    'react-native': { NativeModules: {}, Platform: { OS: 'web' } },
    'firebase/auth': firebaseAuth,
    'firebase/firestore': {},
    '../firebaseConfig': { FIREBASE_AUTH: auth, FIREBASE_APP: { options: { projectId: 'demo-auth-ownership' } } },
    '../reader/normalHighlightStore': { normalHighlightRuntime: {} },
    './deletionStorage': { createDeletionStorage: () => ({}) },
    './deletionTransport': { createDeletionTransport: () => ({}) },
    './deletionController': { createAccountDeletionController: options => options },
    './sparkDeletionCloud': { createSparkDeletionCloud: () => ({}) },
    './sparkDeletionController': { createSparkDeletionController: options => options },
    './deletionActivation': { ACCOUNT_DELETION: { enabled: false, projectId: 'shakespearenativeapp' } },
    './authMutationGate': { runAuthMutation },
    '../functions/deletion-contract.json': require('../../functions/deletion-contract.json'),
  };
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    assert.ok(Object.hasOwn(dependencies, name), 'unexpected dependency ' + name);
    return dependencies[name];
  }, module, module.exports);
  return module.exports.accountDeletion;
}

function fixtureUser(uid) {
  return { uid, tenantId: null, _stopProactiveRefresh() {}, _startProactiveRefresh() {},
    toJSON() { return { uid, tenantId: null }; } };
}

test('deletion waits for an already finishing other-account sign-in and rejects the retired owner', async () => {
  const app = initializeApp({ apiKey: 'fixture-only-key', projectId: 'demo-auth-ownership', appId: 'fixture-only-app' }, 'deletion-auth-ownership');
  try {
    const auth = firebaseAuth.initializeAuth(app, { persistence: firebaseAuth.inMemoryPersistence });
    await auth._initializationPromise;
    const original = fixtureUser('original-owner'), other = fixtureUser('other-owner');
    await auth._updateCurrentUser(original, true);
    const adapter = deletionAdapter(auth);
    let cleanup;
    await runAuthMutation(() => {
      // This is the installed SDK's final signInWithEmailAndPassword step.
      // Its middleware await leaves A current until B's queued update runs.
      const signingIn = auth._updateCurrentUser(other);
      assert.equal(auth.currentUser, original);
      cleanup = adapter.deleteAuth(original); cleanup.catch(() => {});
      return signingIn;
    });
    await assert.rejects(cleanup, { code: 'ACCOUNT_DELETION_OTHER_ACCOUNT' });
    assert.equal(auth.currentUser, other, 'cleanup for A must never clear the completing B sign-in');
  } finally { await deleteApp(app); }
});

test('a rejected authentication mutation releases the queue for the next account operation', async () => {
  const calls = [];
  const failed = runAuthMutation(async () => { calls.push('first'); throw Error('fixture authentication failure'); });
  const following = runAuthMutation(async () => { calls.push('second'); return 'other-owner'; });
  await assert.rejects(failed, /fixture authentication failure/);
  assert.equal(await following, 'other-owner');
  assert.deepEqual(calls, ['first', 'second']);
});
