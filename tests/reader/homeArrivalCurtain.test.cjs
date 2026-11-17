const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { welcomeMotionHost } = require('../fixtures/welcomeMotionHost.cjs');

const source = path.resolve(__dirname, '../../screens/HomeArrivalCurtain.js');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []),
  ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const flatten = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const progressFor = (status, error = null, uid = 'reader-one') => ({ owner: { uid, generation: 2 }, status, completedLevel: 3, error });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function curtainHost({ progress = progressFor('ready'), retry = () => Promise.resolve(false) } = {}) {
  const slots = [], retries = [];
  let cursor = 0, effects = [], dirty = false, mounted = true, stateUpdates = 0;
  const auth = { currentUser: { uid: 'reader-one' } };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const React = {
    createElement(type, props, ...children) {
      return typeof type === 'function' ? type({ ...props, children }) : { type, props: { ...props, children } };
    },
    createContext(initial) {
      const context = { current: initial };
      context.Provider = props => { context.current = props.value; return { type: 'CurtainContext', props }; };
      return context;
    },
    useContext: context => context.current,
    useRef: initial => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => {
        stateUpdates++;
        const next = typeof value === 'function' ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useEffect(setup, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: setup() };
      });
    },
  };
  const code = babel.transformFileSync(source, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { React })(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return {
      View: 'View', StatusBar: 'StatusBar', StyleSheet: { create: value => value,
        absoluteFillObject: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } },
    };
    if (name === '@react-navigation/native') return { useIsFocused: () => true };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 28, bottom: 16, left: 4, right: 8 }) };
    if (name === '../firebaseConfig') return { FIREBASE_AUTH: auth };
    if (name === '../course/AccountCourseProgress') return {
      useAccountCourseProgress: () => progress,
      retryAccountProgress: () => { retries.push(auth.currentUser?.uid); return retry(); },
    };
    if (name === './WelcomeBackground') return { __esModule: true, default: props => ({ type: 'WelcomeBackground', props }) };
    throw Error('Unexpected transition dependency: ' + name);
  }, module, module.exports);
  assert.equal(typeof module.exports.useAuthCurtainTransition, 'function', 'the persistent provider exposes its transition context');
  const Provider = module.exports.default;
  const h = {
    auth, retries, children: { type: 'SourceScene', props: { children: [] } },
    get api() { return module.exports.useAuthCurtainTransition(); },
    get stateUpdates() { return stateUpdates; },
    render() {
      let passes = 0;
      do {
        assert.ok(++passes < 20, 'transition settles without a render loop');
        cursor = 0; effects = []; dirty = false;
        h.tree = Provider({ children: h.children });
        effects.forEach(run => run());
      } while (dirty);
      return h.tree;
    },
    begin(options = {}) {
      const token = h.api.begin({ user: auth.currentUser, light: 'moon', commit: () => true, ...options });
      h.render();
      return token;
    },
    curtain() { return nodes(h.tree, 'WelcomeBackground')[0]; },
    overlay() { return nodes(h.tree, 'View').find(node => node.props.pointerEvents === 'box-only'); },
    closed() { h.curtain().props.onClosed(); return h.render(); },
    opened() { h.curtain().props.onOpened(); return h.render(); },
    ready(status = progress.status, id = h.api.id, uid = auth.currentUser?.uid) { h.api.markHomeReady({ id, uid, status }); return h.render(); },
    setProgress(next) { progress = next; return h.render(); },
    async flush() { await new Promise(resolve => setImmediate(resolve)); if (mounted) return h.render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); mounted = false; },
  };
  h.fallback = h.api;
  h.render();
  return h;
}

test('isolated scenes receive a stable inactive context without mounting an overlay', () => {
  const h = curtainHost();
  assert.equal(h.fallback.active, false);
  assert.equal(h.fallback.phase, null);
  assert.equal(h.fallback.id, null);
  assert.equal(h.fallback.begin({}), null);
  h.fallback.cancel('old');
  h.fallback.markHomeReady({ id: 'old', uid: 'reader-one', status: 'ready' });
  assert.equal(h.curtain(), undefined);
  assert.equal(h.api.active, false);
});

test('normal navigation keeps the curtain provider above the replaceable stack and outside screen safe areas', () => {
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
  const dependencies = {
    react: React,
    'react-redux': { Provider: 'ReduxProvider' },
    './redux/store': { store: {}, persistor: {} },
    './Componenets/Navigation': { __esModule: true, default: 'Stacks' },
    'redux-persist/integration/react': { PersistGate: 'PersistGate' },
    '@react-navigation/native': { NavigationContainer: 'NavigationContainer', DarkTheme: { colors: {} } },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider' },
    './shared/editorialTheme': { EDITORIAL_COLORS: { background: '#faf4e9' } },
    'react-native': { StatusBar: 'StatusBar' },
    './firebaseConfig': {},
    './course/AccountCourseProgress': { CourseProgressBridge: 'CourseProgressBridge' },
    './screens/HomeArrivalCurtain': { __esModule: true, default: 'AuthCurtainProvider' },
    './account/AccountDeletionBridge': { __esModule: true, default: 'AccountDeletionBridge' },
  };
  const code = babel.transformFileSync(path.resolve(__dirname, '../../NormalApp.js'), {
    babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { React })(name => {
    assert.ok(Object.hasOwn(dependencies, name), 'normal navigation dependency is explicitly isolated');
    return dependencies[name];
  }, module, module.exports);
  const tree = module.exports.default();
  const navigation = nodes(tree, 'NavigationContainer')[0];
  const provider = nodes(navigation, 'AuthCurtainProvider')[0];
  assert.ok(provider, 'the provider stays mounted when its stack replaces account routes with Home');
  assert.equal(nodes(tree, 'AuthCurtainProvider').length, 1);
  assert.equal(nodes(provider, 'Stacks').length, 1);
  assert.equal(nodes(provider, 'SafeAreaProvider').length, 0);
});

test('begin validates the successful account and accepts only one flight with stable actions', () => {
  const h = curtainHost();
  const actions = [h.api.begin, h.api.cancel, h.api.markHomeReady];
  assert.equal(h.begin({ user: { uid: 'reader-two' } }), null);
  assert.equal(h.begin({ user: null }), null);
  assert.equal(h.begin({ commit: null }), null);
  const id = h.begin();
  assert.ok(id);
  assert.equal(h.api.id, id);
  assert.equal(h.api.phase, 'closing');
  assert.equal(h.api.active, true);
  assert.equal(h.begin(), null);
  assert.deepEqual([h.api.begin, h.api.cancel, h.api.markHomeReady], actions);
});

test('the persistent root owns a full-bleed decorative curtain above all navigation children', () => {
  const h = curtainHost();
  h.begin({ light: 'sun' });
  const root = nodes(h.tree, 'View')[0];
  assert.equal(flatten(root.props.style).flex, 1);
  assert.equal(root.props.children.flat(Infinity)[0], h.children);
  const overlay = h.overlay();
  const style = flatten(overlay.props.style);
  for (const side of ['top', 'bottom', 'left', 'right']) assert.equal(style[side], 0, 'safe area does not leave a visible gap');
  assert.equal(style.position, 'absolute');
  assert.equal(overlay.props.accessible, false);
  assert.equal(overlay.props.accessibilityElementsHidden, true);
  assert.equal(overlay.props.importantForAccessibility, 'no-hide-descendants');
  const curtain = h.curtain();
  assert.equal(curtain.props.initiallyOpen, true);
  assert.equal(curtain.props.holdClosedOnPause, true);
  assert.equal(curtain.props.closing, true);
  assert.equal(curtain.props.fullyOpen, false);
  assert.equal(curtain.props.light, 'sun');
  assert.equal(curtain.props.key, undefined, 'phase changes retain the native curtain instance');
  assert.equal(nodes(h.tree, 'StatusBar')[0].props.backgroundColor, '#0e0c20');
});

test('covering commits once and source cleanup after the planned reset cannot kill the reveal', () => {
  const h = curtainHost({ progress: progressFor('loading') });
  let commits = 0, cancellations = 0, id;
  id = h.begin({ commit() {
    commits++;
    h.children = { type: 'HomeScene', props: { children: [] } };
    h.api.cancel(id);
    return true;
  }, onCancel() { cancellations++; } });
  const closed = h.curtain().props.onClosed;
  const initial = h.curtain();
  closed(); closed(); h.render();
  assert.equal(commits, 1);
  assert.equal(cancellations, 0);
  assert.equal(h.api.phase, 'covered');
  assert.equal(h.curtain().type, initial.type);
  assert.equal(h.curtain().props.key, undefined);
  assert.equal(h.curtain().props.initiallyOpen, true);
  assert.equal(h.curtain().props.closing, true);
  h.api.cancel(id); h.render();
  assert.equal(h.api.phase, 'covered');
  assert.equal(nodes(h.tree, 'HomeScene').length, 1);
});

test('a ready layout reported inside commit is accepted after the covered phase was recorded', () => {
  const h = curtainHost();
  let id;
  id = h.begin({ commit() { h.api.markHomeReady({ id, uid: 'reader-one', status: 'ready' }); return true; } });
  h.closed();
  assert.equal(h.api.phase, 'opening');
});

test('cancelling only the precommit close restores its source once and ignores stale completions', () => {
  const h = curtainHost();
  let cancelled = 0, committed = 0;
  const id = h.begin({ commit: () => { committed++; }, onCancel: () => { cancelled++; } });
  const old = h.curtain().props;
  h.api.cancel('wrong'); h.render();
  assert.equal(h.api.active, true);
  h.api.cancel(id); h.api.cancel(id); h.render();
  assert.equal(h.api.active, false);
  assert.equal(cancelled, 1);
  const next = h.begin();
  old.onClosed(); old.onOpened(); h.render();
  assert.equal(h.api.id, next);
  assert.equal(h.api.phase, 'closing');
  assert.equal(committed, 0);
});

test('a rejected or throwing commit removes the cover and allows another transition', () => {
  for (const commit of [() => false, () => { throw Error('navigation unavailable'); }]) {
    const h = curtainHost();
    let cancelled = 0;
    h.begin({ commit, onCancel: () => { cancelled++; } });
    h.closed();
    assert.equal(h.api.active, false);
    assert.equal(cancelled, 1);
    assert.ok(h.begin());
  }
});

test('only the matching settled Home branch layout and account progress can open the cover', () => {
  const h = curtainHost({ progress: progressFor('loading') });
  const id = h.begin();
  h.ready('ready');
  h.closed();
  h.ready('ready', 'old-id'); h.ready('ready', id, 'reader-two');
  h.setProgress(progressFor('ready', null, 'reader-two'));
  assert.equal(h.api.phase, 'covered');
  h.setProgress(progressFor('ready'));
  assert.equal(h.api.phase, 'covered', 'the precommit layout did not qualify');
  h.ready('loading');
  assert.equal(h.api.phase, 'covered');
  h.ready();
  assert.equal(h.api.phase, 'opening');
  assert.equal(h.curtain().props.closing, false);
  assert.equal(h.curtain().props.fullyOpen, true);
});

test('initial errors retry once under cover and an error layout cannot release a ready dashboard', async () => {
  for (const error of ['UNVERIFIED_PROGRESS', 'PROFILE_MISSING', 'PROGRESS_READ_FAILED']) {
    const read = deferred();
    const h = curtainHost({ progress: progressFor('error', error), retry: () => read.promise });
    h.begin();
    assert.equal(h.retries.length, 0);
    h.closed(); h.ready('error');
    assert.equal(h.retries.length, 1);
    h.setProgress(progressFor('ready'));
    assert.equal(h.api.phase, 'covered');
    read.resolve(true); await h.flush();
    assert.equal(h.api.phase, 'covered', 'ready Home must report its own native layout');
    h.ready('ready');
    assert.equal(h.api.phase, 'opening');
    assert.equal(h.retries.length, 1);
  }
});

test('persistent read failures reveal the honest error branch after one settled retry', async () => {
  for (const rejects of [false, true]) {
    const read = deferred();
    const h = curtainHost({ progress: progressFor('error', 'PROFILE_MISSING'), retry: () => read.promise });
    h.begin(); h.closed(); h.ready('error');
    assert.equal(h.api.phase, 'covered');
    if (rejects) read.reject(Error('read unavailable')); else read.resolve(false);
    await h.flush();
    assert.equal(h.api.phase, 'opening');
    h.render(); h.ready('error');
    assert.equal(h.retries.length, 1);
  }
});

test('opening never recloses during background refresh and completion removes the overlay once', () => {
  const h = curtainHost();
  h.begin();
  const earlyOpened = h.curtain().props.onOpened;
  earlyOpened(); h.render();
  assert.equal(h.api.phase, 'closing');
  h.closed(); h.ready();
  const opened = h.curtain().props.onOpened;
  h.setProgress(progressFor('loading'));
  assert.equal(h.api.phase, 'opening');
  h.setProgress(progressFor('error', 'PROGRESS_READ_FAILED'));
  assert.equal(h.api.phase, 'opening');
  assert.equal(h.retries.length, 0);
  opened(); opened(); h.render();
  assert.equal(h.api.active, false);
  assert.equal(h.api.phase, null);
  assert.equal(h.api.id, null);
  assert.equal(h.curtain(), undefined);
  assert.equal(nodes(h.tree, 'StatusBar').length, 0);
});

test('account changes retire a flight and its late refresh or layout cannot affect a new one', async () => {
  const first = deferred(), second = deferred(), reads = [first, second];
  const h = curtainHost({ progress: progressFor('error', 'PROFILE_MISSING'), retry: () => reads.shift().promise });
  const oldId = h.begin(); h.closed(); h.ready('error');
  const old = h.curtain().props;
  h.auth.currentUser = { uid: 'reader-two' }; h.render();
  assert.equal(h.api.active, false);
  h.auth.currentUser = { uid: 'reader-one' }; h.render();
  const id = h.begin(); h.closed();
  h.ready('error', oldId);
  old.onClosed(); old.onOpened();
  first.resolve(false); await h.flush();
  assert.equal(h.api.id, id);
  assert.equal(h.api.phase, 'covered');
  h.ready('error'); second.resolve(false); await h.flush();
  assert.equal(h.api.phase, 'opening');
});

test('unmount invalidates pending refresh, cover and open callbacks without further state updates', async () => {
  const read = deferred();
  const h = curtainHost({ progress: progressFor('error', 'PROFILE_MISSING'), retry: () => read.promise });
  h.begin(); h.closed(); h.ready('error');
  const callbacks = h.curtain().props;
  h.unmount();
  const updates = h.stateUpdates;
  callbacks.onClosed(); callbacks.onOpened();
  read.resolve(false); await h.flush();
  assert.equal(h.stateUpdates, updates);
});

test('one real curtain value survives source replacement, closing, cover and opening', async () => {
  const h = curtainHost({ progress: progressFor('loading') });
  const motion = welcomeMotionHost({ screen: 'screens/WelcomeBackground.js' });
  h.begin({ commit() { h.children = { type: 'HomeScene', props: { children: [] } }; return true; } });
  motion.render(h.curtain().props);
  const open = motion.values[0];
  assert.equal(open.value, 1);
  motion.queries[0].resolve(false); await new Promise(resolve => setImmediate(resolve));
  motion.timings.find(timing => timing.active && timing.options.toValue === 0).finish();
  h.render(); motion.render(h.curtain().props);
  assert.equal(h.api.phase, 'covered');
  assert.equal(motion.values[0], open);
  assert.equal(open.value, 0);
  h.setProgress(progressFor('ready')); h.ready();
  motion.render(h.curtain().props);
  assert.equal(motion.values[0], open);
  motion.timings.find(timing => timing.active && timing.options.toValue === 1).finish();
  h.render();
  assert.equal(open.value, 1);
  assert.equal(h.api.active, false);
  motion.unmount();
});

test('reduced motion hands off while covered through the same curtain callback chain', async () => {
  const h = curtainHost();
  const motion = welcomeMotionHost({ screen: 'screens/WelcomeBackground.js' });
  let commits = 0;
  h.begin({ commit() { commits++; return true; } });
  motion.render(h.curtain().props);
  motion.queries[0].resolve(true); await new Promise(resolve => setImmediate(resolve));
  h.render();
  assert.equal(commits, 1);
  assert.equal(h.api.phase, 'covered');
  assert.equal(motion.values[0].value, 0);
  h.ready(); motion.render(h.curtain().props); h.render();
  assert.equal(h.api.active, false);
  assert.equal(motion.values[0].value, 1);
  motion.unmount();
});
