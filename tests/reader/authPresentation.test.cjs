const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { welcomeMotionHost } = require('../fixtures/welcomeMotionHost.cjs');

const root = path.resolve(__dirname, '../..');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []),
  ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const text = tree => typeof tree === 'string' ? tree : !tree || typeof tree !== 'object' ? ''
  : (tree.props?.children || []).flat(Infinity).map(text).join(' ');
const plain = value => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function authHost(screen, options = {}) {
  const slots = [], cache = new Map(), listeners = new Map();
  const calls = { auth: [], secure: [], profile: [], firestore: [], navigation: [], dispatch: [], alerts: [], diagnostics: [] };
  const user = { uid: 'dummy-account' };
  const auth = { currentUser: user };
  const database = {};
  const navigation = {
    navigate: (...args) => calls.navigation.push(args),
    canGoBack: () => options.canGoBack !== false,
    goBack: () => calls.navigation.push(['goBack']),
    dispatch: action => { calls.dispatch.push(action); calls.navigation.push(['dispatch', action]); },
    addListener(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
      return () => listeners.get(event).delete(callback);
    },
  };
  let cursor = 0, effects = [], focused = true;
  const React = {
    createElement(type, props, ...children) {
      const next = { ...props, children };
      return typeof type === 'function' ? type(next) : { type, props: next };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect(setup, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) {
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: setup() };
        });
      }
    },
  };
  const native = Object.fromEntries(['ActivityIndicator', 'ImageBackground', 'KeyboardAvoidingView',
    'Pressable', 'ScrollView', 'StatusBar', 'Text', 'TextInput', 'View'].map(name => [name, name]));
  native.StyleSheet = { create: value => value, absoluteFillObject: {}, flatten: value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean)) };
  native.Platform = { OS: 'android' };
  native.useWindowDimensions = () => ({ width: options.width || 412, height: options.height || 852, fontScale: options.fontScale || 1 });
  native.Keyboard = { dismiss() {} };
  const secureStore = {
    async getItemAsync(key) {
      calls.secure.push(['read', key]);
      return options.remembered ? JSON.stringify(options.remembered) : null;
    },
    async setItemAsync(key, value) { calls.secure.push(['write', key, JSON.parse(value)]); },
    async deleteItemAsync(key) { calls.secure.push(['delete', key]); },
  };
  const authentication = {
    async signInWithEmailAndPassword(...args) {
      calls.auth.push(['signIn', ...args]);
      return options.signIn ? options.signIn(...args) : { user };
    },
    async createUserWithEmailAndPassword(...args) {
      calls.auth.push(['createUser', ...args]);
      return options.createUser ? options.createUser(...args) : { user };
    },
    async updateProfile(...args) { calls.profile.push(args); },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    if (/\.(?:jpg|png|ttf)$/.test(file)) return file;
    const code = babel.transformFileSync(path.join(root, file), {
      babelrc: false, configFile: false,
      plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'],
    }).code;
    const module = { exports: {} };
    vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
      React, alert: message => calls.alerts.push(message),
      console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, () => calls.diagnostics.push(level)])),
    })(name => {
      if (name === 'react') return React;
      if (name === 'react-native') return native;
      if (name === 'react-native-safe-area-context') return {
        SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
      };
      if (name === '@react-navigation/native') return { useNavigation: () => navigation, useIsFocused: () => focused };
      if (name === 'expo-secure-store') return secureStore;
      if (name === 'firebase/auth') return authentication;
      if (name === 'firebase/firestore') return {
        doc(db, collection, uid) { assert.equal(db, database); return { collection, uid }; },
        async setDoc(...args) { calls.firestore.push(args); },
      };
      if (name.endsWith('/firebaseConfig')) return { FIREBASE_AUTH: auth, FIRESTORE_DB: database };
      if (name.endsWith('/EditorialUI')) return { EditorialText: props => React.createElement('Text', { allowFontScaling: true, ...props }, ...props.children) };
      if (name === './AuthStage') return {
        ...load('screens/AuthStage.js'),
        __esModule: true,
        default: props => ({ type: 'AuthStage', props }),
      };
      if (name === './WelcomeBackground' || name === './WelcomeMoon') return {
        __esModule: true, default: props => ({ type: name.slice(2), props }),
      };
      if (name === '@fortawesome/react-native-fontawesome') return { FontAwesomeIcon: 'Icon' };
      if (name.startsWith('@fortawesome/')) return Object.fromEntries([
        'faCheck', 'faEnvelope', 'faEye', 'faEyeSlash', 'faLock', 'faRightToBracket', 'faUser', 'faUserPlus',
      ].map(name => [name, name]));
      if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name + (path.extname(name) ? '' : '.js'))));
      throw Error('Unexpected authentication dependency ' + name);
    }, module, module.exports);
    cache.set(file, module.exports);
    return module.exports;
  }
  const Screen = load(screen).default;
  const h = {
    auth, user, calls, navigation,
    render() {
      cursor = 0;
      effects = [];
      h.tree = Screen({ navigation, ...options.props });
      effects.forEach(run => run());
      return h.tree;
    },
    async flush() { await new Promise(resolve => setImmediate(resolve)); return h.render(); },
    field(placeholder) { return nodes(h.tree, 'TextInput').find(node => node.props.placeholder === placeholder); },
    fill(placeholder, value) { h.field(placeholder).props.onChangeText(value); h.render(); },
    button(label) { return nodes(h.tree, 'Pressable').find(node => node.props.accessibilityLabel === label || text(node).trim() === label); },
    focus(value) { focused = value; return h.render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    beforeRemove(action) {
      const event = { data: { action }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const callback of listeners.get('beforeRemove') || []) callback(event);
      h.render();
      return event;
    },
  };
  h.render();
  return h;
}

for (const [screen, scene] of [['screens/AuthLoginScreen.js', 'crescent'], ['screens/SignUpScreen.js', 'sun']]) {
  test(`${scene} account scene retains its form without starting authentication`, async () => {
    const h = authHost(screen);
    const stage = nodes(h.tree, 'AuthStage')[0];
    assert.ok(stage, 'the existing form participates in the shared curtain scene');
    assert.equal(stage.props.scene, scene);
    assert.equal(stage.props.navigation, h.navigation);
    for (const field of nodes(h.tree, 'TextInput')) {
      assert.equal(field.props.allowFontScaling, true);
      assert.equal(field.props.value, '');
      assert.ok(field.props.style.fontSize <= 14, 'account field text fits the curtain opening comfortably');
    }
    const headings = nodes(h.tree, 'Text').filter(node => node.props.accessibilityRole === 'header');
    assert.equal(headings.length, 1);
    assert.equal(text(headings[0]).trim(), scene === 'sun' ? 'Create account' : 'Log in');
    h.fill('Email', 'dummy@example.test');
    h.fill('Password', 'dummy-password');
    h.render();
    assert.equal(h.field('Email').props.value, 'dummy@example.test');
    assert.equal(h.field('Password').props.value, 'dummy-password');
    assert.equal(h.field('Password').props.secureTextEntry, true);
    h.button('Show password').props.onPress();
    h.render();
    assert.equal(h.field('Password').props.secureTextEntry, false);
    h.button('Hide password').props.onPress();
    h.render();
    assert.equal(h.field('Password').props.secureTextEntry, true);
    await h.flush();
    assert.equal(h.calls.auth.length, 0);
    assert.equal(h.calls.profile.length, 0);
    assert.equal(h.calls.firestore.length, 0);
    assert.equal(h.calls.navigation.length, 0);
    assert.equal(h.calls.secure.filter(call => call[0] !== 'read').length, 0);
  });
}

test('remembered login survives presentation rerenders and uses the original authentication flow', async () => {
  const remembered = { email: 'remembered@example.test', password: 'dummy-remembered-password' };
  const h = authHost('screens/AuthLoginScreen.js', { remembered });
  await h.flush();
  assert.equal(h.field('Email').props.value, remembered.email);
  assert.equal(h.field('Password').props.value, remembered.password);
  h.render();
  await h.button('Log in').props.onPress();
  h.render();
  assert.deepEqual(h.calls.secure, [['read', 'userinfo'], ['write', 'userinfo', remembered]]);
  assert.equal(h.calls.auth.length, 1);
  assert.equal(h.calls.auth[0][0], 'signIn');
  assert.equal(h.calls.auth[0][1], h.auth);
  assert.deepEqual(h.calls.auth[0].slice(2), [remembered.email, remembered.password]);
  assert.deepEqual(h.calls.navigation, [['Main']]);
  assert.equal(h.calls.firestore.length, 0);
});

test('pending login disables submission and retains the existing account-switch guard', async () => {
  const pending = deferred();
  const h = authHost('screens/AuthLoginScreen.js', { signIn: () => pending.promise });
  await h.flush();
  h.fill('Email', 'dummy@example.test');
  h.fill('Password', 'dummy-password');
  const completion = h.button('Log in').props.onPress();
  await h.flush();
  assert.equal(h.calls.auth.length, 1);
  assert.equal(nodes(h.tree, 'ActivityIndicator').length, 1);
  assert.ok(nodes(h.tree, 'Pressable').some(button => button.props.disabled === true));
  h.auth.currentUser = { uid: 'different-dummy-account' };
  pending.resolve({ user: h.user });
  await completion;
  h.render();
  assert.equal(h.calls.navigation.length, 0, 'a response for a previous account cannot enter Main');
  assert.equal(nodes(h.tree, 'ActivityIndicator').length, 0);
  assert.equal(h.button('Log in').props.disabled, false);
});

test('login failures restore the submit control and preserve failure feedback', async () => {
  const h = authHost('screens/AuthLoginScreen.js', { signIn: async () => { throw Error('dummy rejection'); } });
  await h.flush();
  await h.button('Log in').props.onPress();
  h.render();
  assert.equal(h.calls.navigation.length, 0);
  assert.deepEqual(h.calls.alerts, ['Login failed dummy rejection']);
  assert.equal(h.button('Log in').props.disabled, false);
});

test('signup keeps the original account and profile defaults after the curtain presentation', async () => {
  const pending = deferred();
  const h = authHost('screens/SignUpScreen.js', { createUser: () => pending.promise });
  for (const [placeholder, value] of [['First', 'Dummy'], ['Last', 'Reader'], ['Email', 'new@example.test'], ['Password', 'dummy-new-password']]) {
    h.fill(placeholder, value);
  }
  h.render();
  assert.equal(h.field('First').props.value, 'Dummy');
  assert.equal(h.field('Last').props.value, 'Reader');
  const completion = h.button('Create account').props.onPress();
  h.render();
  assert.equal(nodes(h.tree, 'ActivityIndicator').length, 1);
  assert.ok(nodes(h.tree, 'Pressable').some(button => button.props.disabled === true));
  assert.equal(h.calls.firestore.length, 0);
  pending.resolve({ user: h.user });
  await completion;
  h.render();
  assert.equal(h.calls.auth.length, 1);
  assert.equal(h.calls.auth[0][0], 'createUser');
  assert.equal(h.calls.auth[0][1], h.auth);
  assert.deepEqual(h.calls.auth[0].slice(2), ['new@example.test', 'dummy-new-password']);
  const profileImage = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s';
  assert.equal(h.calls.profile[0][0], h.user);
  assert.deepEqual(plain(h.calls.profile[0][1]), { displayName: 'Dummy Reader', photoURL: profileImage });
  assert.equal(h.calls.firestore.length, 1);
  assert.deepEqual(plain(h.calls.firestore[0]), [{ collection: 'users', uid: 'dummy-account' }, {
    userId: 'dummy-account', completedLevel: 0, profileImage,
  }]);
  assert.deepEqual(h.calls.navigation, [['Main']]);
  assert.equal(h.button('Create account').props.disabled, false);
});

test('failed signup does not create a profile or navigate away', async () => {
  const h = authHost('screens/SignUpScreen.js', { createUser: async () => { throw Error('dummy rejection'); } });
  await h.button('Create account').props.onPress();
  h.render();
  assert.equal(h.calls.profile.length, 0);
  assert.equal(h.calls.firestore.length, 0);
  assert.equal(h.calls.navigation.length, 0);
  assert.deepEqual(h.calls.alerts, ['Sign up failed dummy rejection']);
  assert.equal(h.button('Create account').props.disabled, false);
});

test('the account stage keeps the form scrollable and Back accessible above the curtain overlay', () => {
  for (const fontScale of [1, 1.5]) {
    const child = { type: 'TextInput', props: { accessibilityLabel: 'Dummy final field', children: [] } };
    const h = authHost('screens/AuthStage.js', { width: 320, height: 700, fontScale, props: { scene: 'sun', children: child } });
    assert.equal(h.tree.type, 'SafeAreaView');
    assert.equal(nodes(h.tree, 'WelcomeMoon')[0].props.phase, 'sun');
    const scroll = nodes(h.tree, 'ScrollView')[0];
    assert.ok(scroll, 'the form remains scrollable on a short or enlarged-text viewport');
    assert.equal(scroll.props.keyboardShouldPersistTaps, 'handled');
    assert.equal(nodes(scroll, 'TextInput')[0], child);
    assert.equal(scroll.props.style.width, '56%', 'the form uses the same central column as the welcome page');
    const curtain = nodes(h.tree, 'WelcomeBackground')[0];
    assert.equal(curtain.props.light, 'sun');
    assert.equal(curtain.props.reopenOnFocus, true);
    assert.equal(curtain.props.openDistance, undefined, 'the account scene inherits the same curtain opening as welcome');
    const background = welcomeMotionHost({ screen: 'screens/WelcomeBackground.js', width: 320, fontScale }).render(curtain.props);
    const leftPanel = nodes(background, 'AnimatedView').find(node => node.props.testID === 'curtain-panel-left');
    const panelStyle = Object.assign({}, ...leftPanel.props.style.flat(Infinity).filter(Boolean));
    const curtainEdge = parseFloat(panelStyle.width) / 100 * 320 - Math.abs(panelStyle.transform[0].translateX.config.outputRange[1]);
    const columnEdge = (320 - parseFloat(scroll.props.style.width) / 100 * 320) / 2;
    assert.ok(columnEdge >= curtainEdge + 8, 'the narrow form column remains clear of the opened curtains');
    const layers = h.tree.props.children.flat(Infinity).map(node => node?.type);
    assert.ok(layers.indexOf('WelcomeMoon') < layers.indexOf('KeyboardAvoidingView'));
    assert.ok(layers.indexOf('KeyboardAvoidingView') < layers.indexOf('WelcomeBackground'));
    assert.ok(layers.indexOf('WelcomeBackground') < layers.indexOf('Pressable'), 'Back stays reachable while the curtain moves');
    const back = h.button('Back');
    const style = back.props.style({ pressed: false });
    const flattened = Object.assign({}, ...style.flat(Infinity).filter(Boolean));
    assert.ok(flattened.minHeight >= 48);
    assert.ok(flattened.minWidth >= 48);
    back.props.onPress();
    h.render();
    assert.deepEqual(h.calls.navigation, [], 'Back waits for the curtain to cover the form');
    const closing = nodes(h.tree, 'WelcomeBackground')[0];
    assert.equal(closing.props.closing, true);
    back.props.onPress();
    closing.props.onClosed();
    closing.props.onClosed();
    assert.deepEqual(h.calls.navigation, [['goBack']]);
    assert.equal(h.calls.auth.length, 0);
  }
});

test('the crescent account stage has a Root fallback when opened without a preceding route', () => {
  const h = authHost('screens/AuthStage.js', { canGoBack: false, props: { scene: 'crescent', children: [] } });
  assert.equal(nodes(h.tree, 'WelcomeMoon')[0].props.phase, 'crescent');
  assert.equal(nodes(h.tree, 'WelcomeBackground')[0].props.light, 'moon');
  h.button('Back').props.onPress();
  h.render();
  assert.deepEqual(h.calls.navigation, []);
  const closing = nodes(h.tree, 'WelcomeBackground')[0];
  assert.equal(closing.props.closing, true);
  closing.props.onClosed();
  closing.props.onClosed();
  assert.deepEqual(h.calls.navigation, [['Root']]);
});

test('hardware Back preserves the first original navigation action until the curtain has covered the form', () => {
  const h = authHost('screens/AuthStage.js', { props: { scene: 'crescent', children: [] } });
  const action = { type: 'GO_BACK', source: 'dummy-auth-route', target: 'dummy-stack' };
  const event = h.beforeRemove(action);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.calls.navigation, []);
  const closing = nodes(h.tree, 'WelcomeBackground')[0];
  assert.equal(closing.props.closing, true);
  const repeated = h.beforeRemove({ type: 'GO_BACK', source: 'later-dummy-route' });
  assert.equal(repeated.defaultPrevented, true);
  h.button('Back').props.onPress();
  closing.props.onClosed();
  closing.props.onClosed();
  assert.equal(h.calls.dispatch.length, 1);
  assert.equal(h.calls.dispatch[0], action, 'redispatch the original action without rebuilding or substituting it');
  assert.deepEqual(h.calls.navigation, [['dispatch', action]]);
  assert.equal(h.beforeRemove(action).defaultPrevented, false, 'the committed removal can pass its own listener');
});

test('leaving the account scene cancels a pending Back and its late curtain callback', () => {
  for (const action of ['blur', 'unmount']) {
    const h = authHost('screens/AuthStage.js', { props: { scene: 'sun', children: [] } });
    h.button('Back').props.onPress();
    h.render();
    const closing = nodes(h.tree, 'WelcomeBackground')[0];
    assert.equal(closing.props.closing, true);
    if (action === 'blur') h.focus(false); else h.unmount();
    closing.props.onClosed();
    closing.props.onClosed();
    assert.deepEqual(h.calls.navigation, [], action);
    assert.deepEqual(h.calls.dispatch, [], action);
  }
});
