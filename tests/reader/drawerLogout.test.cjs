const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { runAuthMutation } = require('../../account/authMutationGate');

const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []),
  ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const text = tree => typeof tree === 'string' ? tree : !tree || typeof tree !== 'object' ? ''
  : (tree.props?.children || []).flat(Infinity).map(text).join(' ');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Execute the production navigator and drawer. Only device views, navigation,
// unrelated screens and Firebase IO are replaced; the authentication queue is real.
function drawerHost({ user = null, signOut } = {}) {
  const scopes = new Map(), observers = new Set();
  const calls = { signOut: [], navigate: [], rootReset: [], drawerReset: [] };
  const auth = { currentUser: user, async signOut() {
    calls.signOut.push(auth.currentUser);
    if (signOut) return signOut(auth);
    auth.currentUser = null;
  } };
  let active, cursor = 0, effects = [], dirty = false;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const scope = active, index = cursor++;
      if (!(index in scope)) scope[index] = typeof initial === 'function' ? initial() : initial;
      return [scope[index], value => {
        const next = typeof value === 'function' ? value(scope[index]) : value;
        if (!Object.is(scope[index], next)) { scope[index] = next; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in active)) active[index] = { current: initial };
      return active[index];
    },
    useEffect(setup, deps) {
      const scope = active, index = cursor++;
      if (!scope[index] || deps.some((value, i) => !Object.is(value, scope[index].deps[i]))) {
        effects.push(() => {
          scope[index]?.cleanup?.();
          scope[index] = { deps, cleanup: setup() };
        });
      }
    },
  };
  const native = {
    Pressable: 'Pressable', View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width: 412, height: 852, fontScale: 1 }),
  };
  const rootStack = { getParent: () => undefined, reset: state => calls.rootReset.push(plain(state)) };
  const navigation = {
    navigate: (...args) => calls.navigate.push(args), getParent: () => rootStack,
    reset: state => calls.drawerReset.push(plain(state)),
  };
  const file = path.resolve(__dirname, '../../Componenets/Navigation.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { React })(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === '@react-navigation/stack') return { createStackNavigator: () => ({ Navigator: 'Stack', Screen: 'StackScreen' }) };
    if (name === '@react-navigation/drawer') return {
      createDrawerNavigator: () => ({ Navigator: 'Drawer', Screen: 'DrawerScreen' }), DrawerContentScrollView: 'DrawerScroll',
    };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) };
    if (name === 'firebase/auth') return { onAuthStateChanged(authentication, observer) {
      assert.equal(authentication, auth);
      observers.add(observer); observer(auth.currentUser);
      return () => observers.delete(observer);
    } };
    if (name === '../firebaseConfig') return { FIREBASE_AUTH: auth };
    if (name === '../account/authMutationGate') return { runAuthMutation };
    if (name === '../shared/editorialTheme') return require('../../shared/editorialTheme');
    if (name === '../shared/EditorialUI') return { EditorialText: props => React.createElement('Text', props, ...props.children) };
    if (name === '@fortawesome/react-native-fontawesome') return { FontAwesomeIcon: 'Icon' };
    if (name.startsWith('@fortawesome/')) return new Proxy({}, { get: (_, key) => key });
    if (name.startsWith('../screens/')) return { __esModule: true, default: name, RootScreen: name };
    throw Error('Unexpected drawer dependency ' + name);
  }, module, module.exports);
  function invoke(Component, props) {
    if (!scopes.has(Component)) scopes.set(Component, []);
    active = scopes.get(Component); cursor = 0;
    return Component(props);
  }
  const expand = tree => typeof tree?.type === 'function' ? expand(invoke(tree.type, tree.props))
    : !tree || typeof tree !== 'object' ? tree
    : { ...tree, props: { ...tree.props, children: (tree.props?.children || []).flat(Infinity).map(expand) } };
  const stack = invoke(module.exports.default, {});
  const Main = nodes(stack, 'StackScreen').find(node => node.props.name === 'Main').props.component;
  const h = {
    auth, user, calls,
    render() {
      do {
        dirty = false; effects = [];
        const main = invoke(Main, {});
        const drawer = nodes(main, 'Drawer')[0];
        const routeNames = nodes(main, 'DrawerScreen').map(node => node.props.name);
        h.tree = expand(drawer.props.drawerContent({
          state: { routes: routeNames.map(name => ({ name })), routeNames, index: 0 }, navigation,
        }));
        effects.forEach(run => run());
      } while (dirty);
      return h.tree;
    },
    button(label) { return nodes(h.tree, 'Pressable').find(node => node.props.accessibilityLabel === label || text(node).trim() === label); },
    publish(next) { auth.currentUser = next; observers.forEach(observer => observer(next)); return h.render(); },
    async flush() { await new Promise(resolve => setImmediate(resolve)); return h.render(); },
    unmount() { for (const scope of scopes.values()) for (const slot of scope) slot?.cleanup?.(); },
  };
  h.render();
  return h;
}

test('the signed-out drawer exposes account entry points without a logout action', () => {
  const h = drawerHost();
  assert.ok(h.button('Create account'));
  assert.ok(h.button('Log in'));
  assert.equal(h.button('Log out'), undefined);
  assert.deepEqual(h.calls.signOut, []);
});

test('the signed-in drawer exposes logout in place of account entry points', () => {
  const h = drawerHost({ user: { uid: 'drawer-owner' } });
  assert.ok(h.button('Log out'));
  assert.equal(h.button('Create account'), undefined);
  assert.equal(h.button('Log in'), undefined);
  assert.match(text(h.tree), /Account/);
  assert.deepEqual(h.calls.signOut, []);
});

test('logout waits for account mutations, ignores repeat taps and resets the owning stack after success', async () => {
  const blocker = deferred(), pending = deferred();
  const existingMutation = runAuthMutation(() => blocker.promise);
  const h = drawerHost({ user: { uid: 'drawer-owner' }, signOut: async auth => {
    await pending.promise;
    auth.currentUser = null;
  } });
  const button = h.button('Log out');
  assert.ok(button);
  const completion = button.props.onPress();
  button.props.onPress();
  await h.flush();
  assert.equal(h.button('Log out').props.disabled, true);
  assert.equal(h.button('Log out').props.accessibilityState.busy, true);
  assert.deepEqual(h.calls.signOut, [], 'sign-out waits behind the shared authentication boundary');
  blocker.resolve(); await existingMutation; await h.flush();
  assert.deepEqual(h.calls.signOut, [h.user]);
  h.button('Log out').props.onPress();
  assert.deepEqual(h.calls.rootReset, [], 'the signed-in drawer stays in place until sign-out finishes');
  pending.resolve(); await completion; await h.flush();
  assert.deepEqual(h.calls.signOut, [h.user]);
  assert.deepEqual(h.calls.rootReset, [{ index: 0, routes: [{ name: 'Root' }] }]);
  assert.deepEqual(h.calls.drawerReset, []);
  assert.deepEqual(h.calls.navigate, []);
});

test('failed sign-out keeps the account available, displays feedback and permits a successful retry', async () => {
  let attempts = 0;
  const h = drawerHost({ user: { uid: 'drawer-owner' }, signOut: async auth => {
    if (++attempts === 1) throw Error('fixture sign-out failure');
    auth.currentUser = null;
  } });
  assert.ok(h.button('Log out'));
  await h.button('Log out').props.onPress(); h.render();
  assert.equal(h.auth.currentUser, h.user);
  assert.equal(h.button('Log out').props.disabled, false);
  assert.equal(h.button('Log out').props.accessibilityState?.busy, false);
  assert.match(text(h.tree), /couldn.t log you out.*try again/i);
  assert.equal(nodes(h.tree, 'Text').filter(node => node.props.accessibilityRole === 'alert').length, 1);
  assert.deepEqual(h.calls.rootReset, []);
  await h.button('Log out').props.onPress(); h.render();
  assert.equal(h.auth.currentUser, null);
  assert.deepEqual(h.calls.signOut, [h.user, h.user]);
  assert.deepEqual(h.calls.rootReset, [{ index: 0, routes: [{ name: 'Root' }] }]);
});

test('queued logout cannot sign out a replacement account, including a new session with the same uid', async () => {
  for (const uid of ['other-owner', 'drawer-owner']) {
    const blocker = deferred();
    const existingMutation = runAuthMutation(() => blocker.promise);
    const h = drawerHost({ user: { uid: 'drawer-owner' } });
    const replacement = { uid };
    assert.ok(h.button('Log out'));
    const completion = h.button('Log out').props.onPress();
    h.publish(replacement);
    blocker.resolve(); await existingMutation; await completion; h.render();
    assert.equal(h.auth.currentUser, replacement);
    assert.deepEqual(h.calls.signOut, []);
    assert.deepEqual(h.calls.rootReset, []);
    assert.equal(h.button('Log out').props.disabled, false);
  }
});

test('a replacement account present when sign-out finishes cannot be redirected to welcome', async () => {
  const pending = deferred();
  const h = drawerHost({ user: { uid: 'drawer-owner' }, signOut: () => pending.promise });
  assert.ok(h.button('Log out'));
  const completion = h.button('Log out').props.onPress();
  await h.flush();
  const replacement = { uid: 'other-owner' };
  h.publish(replacement);
  pending.resolve(); await completion; h.render();
  assert.equal(h.auth.currentUser, replacement);
  assert.deepEqual(h.calls.rootReset, []);
  assert.equal(h.button('Log out').props.disabled, false);
});

test('a failed retired-account logout does not leave failure feedback on the replacement account', async () => {
  const pending = deferred();
  const h = drawerHost({ user: { uid: 'drawer-owner' }, signOut: () => pending.promise });
  assert.ok(h.button('Log out'));
  const completion = h.button('Log out').props.onPress();
  await h.flush();
  h.publish({ uid: 'other-owner' });
  pending.reject(Error('retired fixture failure')); await completion; h.render();
  assert.equal(nodes(h.tree, 'Text').filter(node => node.props.accessibilityRole === 'alert').length, 0);
  assert.equal(h.button('Log out').props.disabled, false);
  assert.deepEqual(h.calls.rootReset, []);
});

test('a drawer removed while logout is pending cannot later reset navigation', async () => {
  const pending = deferred();
  const h = drawerHost({ user: { uid: 'drawer-owner' }, signOut: async auth => {
    await pending.promise; auth.currentUser = null;
  } });
  assert.ok(h.button('Log out'));
  const completion = h.button('Log out').props.onPress();
  await h.flush(); h.unmount();
  pending.resolve(); await completion;
  assert.deepEqual(h.calls.rootReset, []);
});
