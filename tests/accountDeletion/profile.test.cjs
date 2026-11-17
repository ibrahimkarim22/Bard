const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(c => nodes(c, type)),
];
const text = tree => typeof tree === 'string' ? tree : !tree || typeof tree !== 'object' ? '' : (tree.props?.children || []).flat(Infinity).map(text).join(' ');
function host({ available = true, photo, picker } = {}) {
  const calls = [], slots = [];
  const user = { uid: 'fixture-owner', displayName: 'Fixture reader', email: 'reader@example.test', photoURL: 'https://example.test/avatar.png' };
  const auth = { currentUser: user };
  let cursor = 0, effects = [], focused = true, authCallback, state = { available, initialized: true, status: 'idle', uid: null };
  const React = {
    createElement(type, props, ...children) { const next = { ...props, children }; return typeof type === 'function' ? type(next) : { type, props: next }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(value) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
    useEffect(run, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => v !== slots[i].deps[j])) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
    useSyncExternalStore(subscribe, get) { return get(); },
  };
  const native = Object.fromEntries(['View', 'Text', 'Image', 'TextInput', 'Pressable', 'ScrollView', 'Modal', 'StatusBar', 'ActivityIndicator', 'KeyboardAvoidingView'].map(k => [k, k]));
  Object.assign(native, { Platform: { OS: 'android' }, StyleSheet: { create: x => x }, Keyboard: { dismiss() {} } });
  const dependency = {
    react: React, 'react-native': native,
    '@react-navigation/native': { useIsFocused: () => focused },
    '@fortawesome/react-native-fontawesome': { FontAwesomeIcon: 'Icon' }, '@fortawesome/free-solid-svg-icons': {},
    '../firebaseConfig': { FIREBASE_AUTH: auth, FIRESTORE_DB: {} },
    'firebase/auth': { onAuthStateChanged: (a, callback) => { authCallback = callback; return () => {}; }, updateProfile: async (owner, change) => { calls.push(['photo-auth', owner.uid]); Object.assign(owner, change); } },
    'firebase/firestore': { doc: (...args) => args, updateDoc: async () => calls.push(['photo-document']) },
    'expo-image-picker': {
      async requestCameraPermissionsAsync() { calls.push(['camera-permission']); return { status: 'granted' }; },
      async requestMediaLibraryPermissionsAsync() { calls.push(['library-permission']); return { status: 'granted' }; },
      async launchCameraAsync() { calls.push(['camera']); return photo ? { assets: [{ uri: photo }] } : { canceled: true, assets: [] }; },
      async launchImageLibraryAsync() { calls.push(['library']); return picker ? picker() : photo ? { assets: [{ uri: photo }] } : { canceled: true, assets: [] }; },
    },
    'expo-image-manipulator': { manipulateAsync: async () => ({ uri: 'file:///fixture-processed.png' }) },
    'expo-media-library': { saveToLibraryAsync: async () => calls.push(['photo-library-save']) },
    '../account/normalAccountDeletion': { accountDeletion: { subscribe: () => () => {}, getSnapshot: () => state,
      async confirm(password) { calls.push(['confirm', password]); }, async retry(password) { calls.push(['retry', password]); } } },
    '../shared/EditorialUI': { EditorialText: p => ({ type: 'Text', props: p }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const file = path.resolve(__dirname, '../../screens/ProfileScreen.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,React){' + code + '\n})')(name => dependency[name] || (name.startsWith('.') ? require(path.resolve(path.dirname(file), name)) : require(name)), module, module.exports, React);
  const h = { calls, auth, user, setState: next => { state = { ...state, ...next }; }, setFocused: value => { focused = value; },
    changeAccount(value) { auth.currentUser = value; authCallback(value); },
    render() { cursor = 0; effects = []; h.tree = module.exports.default({ navigation: { goBack: () => calls.push(['back']), navigate: (...a) => calls.push(a) } }); effects.forEach(f => f()); return h.tree; },
    button(label) { return nodes(h.tree, 'Pressable').find(n => n.props.accessibilityLabel === label || text(n).trim() === label); },
  };
  h.render(); return h;
}
test('profile exposes email/photo editing, and cancellation uses existing non-mutating pickers', async () => {
  const h = host();
  assert.match(text(h.tree), /reader@example\.test/);
  assert.ok(nodes(h.tree, 'ScrollView').length);
  await h.button('Take Photo').props.onPress(); await h.button('Choose from Library').props.onPress();
  assert.deepEqual(h.calls, [['camera-permission'], ['camera'], ['library-permission'], ['library']]);
  h.button('Close profile').props.onPress(); assert.deepEqual(h.calls.at(-1), ['back']);
});
test('disabled live activation never opens password confirmation or invokes deletion', () => {
  const h = host({ available: false });
  assert.equal(h.button('Delete account').props.disabled, true);
  assert.equal(nodes(h.tree, 'TextInput').length, 0);
  assert.deepEqual(h.calls, []);
});
test('account deletion requires an explicit destructive confirmation and password; Cancel changes nothing', async () => {
  const h = host(); h.button('Delete account').props.onPress(); h.render();
  assert.match(text(h.tree), /Keep Bard open/);
  assert.doesNotMatch(text(h.tree), /continues if you leave|secure service/);
  assert.equal(nodes(h.tree, 'TextInput')[0].props.secureTextEntry, true);
  assert.equal(h.button('Permanently delete account').props.disabled, true);
  h.button('Cancel deletion').props.onPress(); h.render();
  assert.equal(nodes(h.tree, 'Modal')[0].props.visible, false);
  assert.deepEqual(h.calls, []);
});

test('quota and uncertain Auth deletion give honest recovery guidance without claiming success', () => {
  const h = host();
  h.setState({ uid: h.user.uid, status: 'retry-needed', error: 'ACCOUNT_DELETION_QUOTA', requiresPassword: false }); h.render();
  assert.match(text(h.tree), /limit|later/i);
  h.setState({ error: 'ACCOUNT_DELETION_AUTH_UNCONFIRMED' }); h.render();
  assert.match(text(h.tree), /not yet confirmed/i);
  assert.doesNotMatch(text(h.tree), /account is deleted|successfully deleted/i);
});
test('intentional confirmation passes password once and clears it from the view', async () => {
  const h = host(); h.button('Delete account').props.onPress(); h.render();
  nodes(h.tree, 'TextInput')[0].props.onChangeText('dummy-password'); h.render();
  await h.button('Permanently delete account').props.onPress(); h.render();
  assert.deepEqual(h.calls, [['confirm', 'dummy-password']]);
  assert.ok(nodes(h.tree, 'TextInput').every(n => !n.props.value));
});
test('stale profile confirmation cannot delete a different signed-in account or expose old email', async () => {
  const h = host(); h.button('Delete account').props.onPress(); h.render();
  nodes(h.tree, 'TextInput')[0].props.onChangeText('dummy-password'); h.render();
  const oldConfirm = h.button('Permanently delete account');
  h.auth.currentUser = { uid: 'other-owner', email: 'other@example.test' };
  await oldConfirm.props.onPress(); const first = h.render();
  assert.doesNotMatch(text(first), /reader@example\.test/);
  assert.deepEqual(h.calls, []);
});
test('accepted deletion has status-only retry, disables photo edits, and never reports premature success', async () => {
  const h = host(); h.setState({ uid: h.user.uid, status: 'retry-needed', requiresPassword: false }); h.render();
  assert.equal(h.button('Take Photo').props.disabled, true);
  assert.match(text(h.tree), /not yet confirmed|could not be confirmed/i);
  await h.button('Check deletion status').props.onPress();
  assert.deepEqual(h.calls, [['retry', undefined]]);
});

test('an ambiguous prepared request offers status-only recovery even if the original sign-in was removed', async () => {
  const h = host(); h.setState({ uid: h.user.uid, status: 'retry-needed', requiresPassword: true }); h.render();
  assert.ok(h.button('Delete account'));
  await h.button('Check deletion status').props.onPress();
  assert.deepEqual(h.calls, [['retry', undefined]]);
  assert.equal(nodes(h.tree, 'TextInput').length, 0);
});

test('returning to the profile restores live actions after focus cleanup', async () => {
  const h = host(); h.setFocused(false); h.render(); h.setFocused(true); h.render();
  await h.button('Choose from Library').props.onPress();
  assert.deepEqual(h.calls, [['library-permission'], ['library']]);
});

test('an old account confirmation state is not displayed for the new profile owner', () => {
  const h = host(); h.setState({ uid: h.user.uid, status: 'confirming', error: 'ACCOUNT_DELETION_REAUTH_FAILED' });
  h.changeAccount({ uid: 'other-owner', email: 'other@example.test' }); h.render();
  assert.match(text(h.tree), /other@example.test/);
  assert.doesNotMatch(text(h.tree), /reader@example.test|Password could not|in progress/);
  assert.equal(h.button('Take Photo').props.disabled, false);
});

test('profile picture editing keeps the existing processed-image Auth and profile field conventions', async () => {
  const h = host({ photo: 'file:///fixture-source.png' });
  await h.button('Choose from Library').props.onPress(); h.render();
  assert.deepEqual(h.calls, [['library-permission'], ['library'], ['photo-library-save'], ['photo-auth', h.user.uid], ['photo-document']]);
  assert.ok(nodes(h.tree, 'Image').some(n => n.props.source.uri === 'file:///fixture-processed.png'));
});

test('an old pending image picker cannot save a photo after an account change', async () => {
  let release;
  const h = host({ picker: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.button('Choose from Library').props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  h.changeAccount({ uid: 'other-owner', email: 'other@example.test' }); h.render();
  release({ assets: [{ uri: 'file:///old-owner-picture.png' }] }); await pending; h.render();
  assert.deepEqual(h.calls, [['library-permission'], ['library']]);
  assert.equal(h.button('Choose from Library').props.disabled, false);
  assert.ok(nodes(h.tree, 'Image').every(n => n.props.source.uri !== 'file:///old-owner-picture.png'));
});

test('a cancelled-by-blur photo request cannot strand controls or write on return', async () => {
  let release;
  const h = host({ picker: () => new Promise(resolve => { release = resolve; }) });
  const pending = h.button('Choose from Library').props.onPress();
  await new Promise(resolve => setImmediate(resolve)); h.render();
  assert.equal(h.button('Choose from Library').props.disabled, true);
  h.setFocused(false); h.render(); h.setFocused(true); h.render(); h.render();
  assert.equal(h.button('Choose from Library').props.disabled, false);
  release({ assets: [{ uri: 'file:///late.png' }] }); await pending;
  assert.deepEqual(h.calls, [['library-permission'], ['library']]);
});
