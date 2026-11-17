const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { createAccountDeletionController } = require('../../account/deletionController');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const text = tree => typeof tree === 'string' ? tree : !tree || typeof tree !== 'object' ? '' : (tree.props?.children || []).flat(Infinity).map(text).join(' ');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const owner = { uid: 'fixture-owner', email: 'owner@example.test' };
function host({ initialState, initialUser = owner, ready = true, controllerFactory, sharedAuth, initialAppState = 'active' } = {}) {
  const calls = [], slots = [], authListeners = new Set(), navigationListeners = new Set(), appListeners = new Set();
  const auth = sharedAuth || { currentUser: initialUser };
  let cursor = 0, effects = [], dirty = false, navigationReady = ready;
  let state = { initialized: true, available: true, status: 'idle', uid: null, phase: null, error: null, ...initialState };
  const updateUser = (user, notify = true) => { auth.currentUser = user; if (notify) for (const listener of authListeners) listener(user); };
  const accountDeletion = controllerFactory ? controllerFactory({ auth, calls, updateUser }) : {
    subscribe: () => () => {}, getSnapshot: () => state,
    async initialize() { calls.push(['initialize']); }, async foreground() { calls.push(['foreground']); },
    background() { calls.push(['background']); }, async check() { calls.push(['check']); },
  };
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const React = {
    Fragment: 'Fragment',
    createElement(type, props, ...children) { const next = { ...props, children }; return typeof type === 'function' ? type(next) : { type, props: next }; },
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { current: initial }; return slots[index]; },
    useEffect(run, deps) { const index = cursor++; if (!slots[index] || !equal(slots[index].deps, deps)) effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: run() }; }); },
    useSyncExternalStore(subscribe, get) { const index = cursor++; if (!slots[index]) slots[index] = { cleanup: subscribe(() => { dirty = true; }) }; return get(); },
  };
  const navigation = {
    isReady: () => navigationReady,
    resetRoot: destination => calls.push(['resetRoot', destination]),
    reset: destination => calls.push(['reset', destination]),
    addListener(event, run) { assert.equal(event, 'state'); navigationListeners.add(run); return () => navigationListeners.delete(run); },
  };
  const native = Object.fromEntries(['ActivityIndicator', 'Modal', 'Pressable', 'ScrollView', 'View'].map(name => [name, name]));
  Object.assign(native, { StyleSheet: { create: value => value }, AppState: { currentState: initialAppState, addEventListener(event, run) { assert.equal(event, 'change'); appListeners.add(run); return { remove() { appListeners.delete(run); } }; } } });
  const deps = {
    react: React, 'react-native': native, '@react-navigation/native': { useNavigation: () => navigation },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'firebase/auth': { onAuthStateChanged(actual, listener) { assert.equal(actual, auth); authListeners.add(listener); return () => authListeners.delete(listener); } },
    '../firebaseConfig': { FIREBASE_AUTH: auth }, './normalAccountDeletion': { accountDeletion },
    '../shared/EditorialUI': { EditorialText: props => ({ type: 'Text', props }) },
  };
  const file = path.resolve(__dirname, '../../account/AccountDeletionBridge.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,React){' + code + '\n})', { filename: file })(name => Object.hasOwn(deps, name) ? deps[name] : require(path.resolve(path.dirname(file), name)), module, module.exports, React);
  const h = {
    calls, auth, accountDeletion, authListeners, appListeners, navigationListeners,
    render() { let tree, passes = 0; do { assert.ok(++passes < 20); cursor = 0; effects = []; dirty = false; tree = module.exports.default({ children: { type: 'ProtectedChildren', props: { children: ['Protected app'] } } }); effects.forEach(run => run()); } while (dirty); h.tree = tree; return tree; },
    setState(next) { state = { ...state, ...next }; }, setUser: updateUser,
    appState(value) { for (const listener of appListeners) listener(value); },
    navigationReady(value) { navigationReady = value; for (const listener of navigationListeners) listener(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
  return h;
}

test('the startup barrier hides app children until saved deletion state has loaded and the UID is fenced', async () => {
  const gate = deferred();
  const h = host({ controllerFactory: ({ auth, calls }) => createAccountDeletionController({
    enabled: false, getUser: () => auth.currentUser,
    storage: { loadIntent: () => gate.promise }, runtime: { blockAccount(uid) { calls.push(['block', uid]); } },
    transport: { status: async () => ({ status: 'pending', phase: 'queued' }) }, schedule: () => 1, unschedule() {},
  }) });
  let tree = h.render();
  assert.equal(nodes(tree, 'ProtectedChildren').length, 0);
  assert.equal(nodes(tree, 'ActivityIndicator')[0].props.accessibilityLabel, 'Preparing account');
  gate.resolve({ version: 1, uid: owner.uid, email: owner.email, ticket: 'a'.repeat(64), phase: 'accepted', createdAt: 1000 });
  await h.accountDeletion.initialize(); tree = h.render();
  assert.deepEqual(h.calls, [['block', owner.uid]]);
  assert.equal(nodes(tree, 'ProtectedChildren').length, 1);
  assert.equal(nodes(tree, 'Modal')[0].props.visible, true); h.unmount();
});

test('app foreground resumes deletion, inactive/background pause polling, and unmount releases observers', async () => {
  const h = host(); h.render(); await tick();
  assert.deepEqual(h.calls, [['foreground'], ['initialize']]);
  h.appState('inactive'); h.appState('background'); h.appState('active'); await tick();
  assert.deepEqual(h.calls, [['foreground'], ['initialize'], ['background'], ['background'], ['foreground']]);
  h.unmount();
  assert.equal(h.authListeners.size, 0); assert.equal(h.appListeners.size, 0); assert.equal(h.navigationListeners.size, 0);
  h.appState('active'); assert.deepEqual(h.calls.at(-1), ['background']);
});

test('another signed-in account never receives the previous UID deletion modal or status copy, even before its auth observer runs', () => {
  const h = host({ initialState: { status: 'deleting', uid: owner.uid, phase: 'deleting-data', requiresPassword: false } });
  let tree = h.render(); assert.equal(nodes(tree, 'Modal')[0].props.visible, true);
  assert.match(text(tree), /Removing your account/);
  assert.doesNotMatch(text(tree), /continue if you leave/);
  const other = { uid: 'other-owner', email: 'other@example.test' };
  h.setUser(other, false); tree = h.render();
  assert.equal(nodes(tree, 'Modal')[0].props.visible, false); assert.doesNotMatch(text(tree), /Removing your account|Account deletion/);
  assert.equal(nodes(tree, 'ProtectedChildren').length, 1); assert.equal(h.auth.currentUser, other);
  h.setState({ status: 'complete', phase: 'complete' }); h.render();
  assert.equal(h.calls.some(([name]) => name === 'resetRoot' || name === 'reset'), false); h.unmount();
});

test('an Auth change asks the Spark controller to discover that owner’s pending deletion', async () => {
  const h = host(); h.accountDeletion.ownerChanged = async () => h.calls.push(['ownerChanged']);
  h.render(); h.setUser({ uid: 'another-owner', email: 'another@example.test' }); await tick();
  assert.deepEqual(h.calls.at(-1), ['ownerChanged']); h.unmount();
});

test('a prepared intent requiring a password leaves confirmation to Profile while accepted failures offer status-only retry', async () => {
  const h = host({ initialState: { status: 'retry-needed', uid: owner.uid, requiresPassword: true } });
  assert.equal(nodes(h.render(), 'Modal')[0].props.visible, false);
  h.setState({ requiresPassword: false, phase: 'deleting-data' }); const tree = h.render();
  assert.equal(nodes(tree, 'Modal')[0].props.visible, true);
  const retry = nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === 'Check deletion status');
  await retry.props.onPress(); assert.deepEqual(h.calls.at(-1), ['check']);
  nodes(tree, 'Modal')[0].props.onRequestClose();
  assert.equal(nodes(h.render(), 'Modal')[0].props.visible, false); h.unmount();
});

test('completed signed-out cleanup waits for navigation readiness and resets once without performing Auth actions', () => {
  const h = host({ ready: false, initialUser: null, initialState: { status: 'complete', uid: owner.uid, phase: 'complete' } });
  h.render(); assert.equal(h.calls.some(([name]) => name === 'resetRoot'), false);
  h.navigationReady(true);
  const resets = h.calls.filter(([name]) => name === 'resetRoot');
  assert.deepEqual(resets, [['resetRoot', { index: 0, routes: [{ name: 'Root' }] }]]);
  h.navigationReady(true); h.render(); assert.equal(h.calls.filter(([name]) => name === 'resetRoot').length, 1);
  assert.equal(h.auth.currentUser, null); h.unmount();
});

test('real controller cleanup finishing after an account switch does not sign out or navigate the new account', async () => {
  const cleaning = deferred(), entered = deferred(), other = { uid: 'other-owner', email: 'other@example.test' };
  const saved = { version: 1, uid: owner.uid, email: owner.email, ticket: 'a'.repeat(64), phase: 'cleanup', createdAt: 1000 };
  const h = host({ controllerFactory: ({ auth, calls, updateUser }) => createAccountDeletionController({
    enabled: false, getUser: () => auth.currentUser,
    runtime: { blockAccount(uid) { calls.push(['block', uid]); } },
    storage: { loadIntent: async () => saved,
      async clearAccountData(intent) { calls.push(['clear', intent.uid]); entered.resolve(); await cleaning.promise; },
      async removeIntent(expected) { assert.deepEqual(expected, { uid: owner.uid, ticket: saved.ticket }); calls.push(['remove', expected.uid]); },
    },
    transport: { async acknowledge(uid, ticket) { assert.equal(uid, owner.uid); assert.equal(ticket, saved.ticket); return { status: 'complete', phase: 'complete' }; } },
    async signOut(uid) { calls.push(['signOut', uid]); updateUser(null); },
  }) });
  h.render(); await entered.promise; h.setUser(other); h.render();
  cleaning.resolve(); await h.accountDeletion.initialize(); const tree = h.render();
  assert.equal(h.accountDeletion.getSnapshot().status, 'complete');
  assert.equal(h.auth.currentUser, other); assert.equal(nodes(tree, 'Modal')[0].props.visible, false);
  assert.equal(h.calls.some(([name]) => ['signOut', 'resetRoot', 'reset'].includes(name)), false);
  assert.deepEqual(h.calls, [['block', owner.uid], ['clear', owner.uid], ['remove', owner.uid]]); h.unmount();
});

test('real controller completion signs out only its current target and Bridge resets after verified cleanup', async () => {
  const saved = { version: 1, uid: owner.uid, email: owner.email, ticket: 'a'.repeat(64), phase: 'cleanup', createdAt: 1000 };
  const h = host({ controllerFactory: ({ auth, calls, updateUser }) => createAccountDeletionController({
    enabled: false, getUser: () => auth.currentUser, runtime: { blockAccount(uid) { calls.push(['block', uid]); } },
    storage: { loadIntent: async () => saved, async clearAccountData(intent) { calls.push(['clear', intent.uid]); }, async removeIntent() { calls.push(['remove']); } },
    transport: { async acknowledge(uid, ticket) { assert.equal(uid, owner.uid); assert.equal(ticket, saved.ticket); return { status: 'complete', phase: 'complete' }; } },
    async signOut(uid) { assert.equal(auth.currentUser.uid, uid); calls.push(['signOut', uid]); updateUser(null); },
  }) });
  h.render(); await h.accountDeletion.initialize(); h.render();
  assert.deepEqual(h.calls.map(([name]) => name), ['block', 'clear', 'signOut', 'remove', 'resetRoot']);
  assert.equal(h.auth.currentUser, null); assert.equal(nodes(h.tree, 'Modal')[0].props.visible, false); h.unmount();
});

test('completion navigation waits for the backend cleanup acknowledgment after local sign-out', async () => {
  const acknowledging = deferred(), entered = deferred();
  const saved = { version: 1, uid: owner.uid, email: owner.email, ticket: 'a'.repeat(64), phase: 'cleanup', createdAt: 1000 };
  const h = host({ controllerFactory: ({ auth, calls, updateUser }) => createAccountDeletionController({
    enabled: false, getUser: () => auth.currentUser, runtime: { blockAccount() {} },
    storage: { loadIntent: async () => saved, async clearAccountData() {}, async removeIntent() { calls.push(['remove']); } },
    async signOut(uid) { assert.equal(uid, owner.uid); updateUser(null); },
    transport: { async acknowledge() { entered.resolve(); return acknowledging.promise; } },
  }) });
  h.render(); await entered.promise; let tree = h.render();
  assert.equal(h.auth.currentUser, null); assert.equal(h.accountDeletion.getSnapshot().status, 'cleaning');
  assert.equal(nodes(tree, 'Modal')[0].props.visible, true); assert.match(text(tree), /Finishing cleanup/);
  h.navigationReady(true); assert.equal(h.calls.some(([name]) => name === 'resetRoot' || name === 'remove'), false);
  acknowledging.resolve({ status: 'complete', phase: 'complete' }); await h.accountDeletion.initialize(); tree = h.render();
  assert.deepEqual(h.calls.map(([name]) => name), ['remove', 'resetRoot']);
  assert.equal(nodes(tree, 'Modal')[0].props.visible, false); h.unmount();
});

test('mounting while already backgrounded pauses polling without waiting for a new native event', async () => {
  const h = host({ initialAppState: 'background' }); h.render(); await tick();
  assert.deepEqual(h.calls, [['background'], ['initialize']]); h.unmount();
});

test('remounting an active Bridge resumes the existing controller after cleanup paused its polling', async () => {
  const timers = new Set();
  const saved = { version: 1, uid: owner.uid, email: owner.email, ticket: 'a'.repeat(64), phase: 'accepted', createdAt: 1000 };
  const first = host({ controllerFactory: ({ auth }) => createAccountDeletionController({
    enabled: false, getUser: () => auth.currentUser, runtime: { blockAccount() {} }, storage: { loadIntent: async () => saved },
    transport: { status: async () => ({ status: 'pending', phase: 'queued' }) },
    schedule(run) { timers.add(run); return run; }, unschedule(run) { timers.delete(run); },
  }) });
  first.render(); await first.accountDeletion.initialize(); assert.equal(timers.size, 1);
  first.unmount(); assert.equal(timers.size, 0);
  const second = host({ sharedAuth: first.auth, controllerFactory: () => first.accountDeletion });
  second.render(); await tick(); assert.equal(timers.size, 1, 'active remount must restore periodic status checks');
  second.unmount(); assert.equal(timers.size, 0);
});
