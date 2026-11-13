const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : !tree || typeof tree !== 'object'
  ? '' : (tree.props?.children || []).flat(Infinity).map(text).join(' ');

function host({ tab, level = 1, initialProgress, catalogue, dimensions = { width: 411, fontScale: 1 } } = {}) {
  const route = { key: 'home-fixture', params: { tab } }, calls = [], writes = [], scrolls = [], slots = [];
  let cursor = 0, effects = [], dirty = false;
  let progress = initialProgress || { status: 'ready', completedLevel: level };
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (factory, deps) => { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { deps, value: factory() }; return slots[i].value; };
  const React = {
    createElement(type, props, ...children) { const next = { ...props, children }; return typeof type === 'function' ? type(next) : { type, props: next }; },
    useMemo: memo,
    useRef: initial => memo(() => ({ current: initial }), []),
    useState: initial => { const slot = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []); return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (slot.value !== value) { slot.value = value; dirty = true; } }]; },
    useEffect: (factory, deps) => { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: factory() }; }); },
  };
  const plays = catalogue || [{ id: 'midsummer', name: 'Midsummer', difficulty: 1, mainImage: 21, medalImage: 11 }, { id: 'henry-viii', name: 'Henry VIII', difficulty: 39, mainImage: 22, medalImage: 12 }];
  const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'Image', 'Modal', 'StatusBar', 'ActivityIndicator'].map(s => [s, s]));
  native.ScrollView = props => { if (props.ref) props.ref.current = { scrollTo: options => scrolls.push(options) }; return { type: 'ScrollView', props }; };
  Object.assign(native, { useWindowDimensions: () => dimensions, StyleSheet: { create: value => value } });
  const deps = {
    react: React, 'react-native': native,
    '@fortawesome/react-native-fontawesome': { FontAwesomeIcon: 'Icon' }, '@fortawesome/free-solid-svg-icons': {},
    'firebase/auth': { updateProfile: () => writes.push('profile') }, 'firebase/firestore': { doc() {}, updateDoc: () => writes.push('document') },
    '../course/AccountCourseProgress': { useAccountCourseProgress: () => progress, retryAccountProgress() {} },
    '../course/CourseProgressNotice': { CourseProgressNotice: 'CourseProgressNotice' },
    '../course/MedalsCollection': { __esModule: true, default: 'MedalsCollection' },
    'expo-image-manipulator': {}, 'expo-image-picker': {}, 'expo-media-library': {},
    '../firebaseConfig': { FIREBASE_AUTH: { currentUser: { displayName: 'Synthetic reader' } }, FIRESTORE_DB: {} },
    '../shared/localPlayService': { PLAYS: plays },
    '../shared/EditorialUI': { EditorialText: props => ({ type: 'Text', props }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) },
  };
  const file = path.join(root, 'screens/HomeScreen.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,React){' + code + '\n})', { filename: file })(name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    return name.startsWith('.') ? require(path.resolve(path.dirname(file), name)) : require(name);
  }, module, module.exports, React);
  const navigation = { navigate: (...args) => calls.push(args), setParams: next => { route.params = { ...route.params, ...next }; dirty = true; } };
  const h = {
    calls, writes, scrolls, route, plays,
    render() { let tree, passes = 0; do { assert.ok(++passes < 20); cursor = 0; effects = []; dirty = false; tree = module.exports.default({ navigation, route }); effects.forEach(run => run()); } while (dirty); return tree; },
    selectTab(label) { const button = nodes(h.render(), 'Pressable').find(n => text(n) === label); assert.ok(button, label); button.props.onPress(); return h.render(); },
    setProgress(next) { progress = next; },
  };
  return h;
}

test('View medals route opens the existing Home tab and consumes its request so later manual tab selection persists', () => {
  const h = host({ tab: 'Medals' });
  let tree = h.render();
  assert.equal(nodes(tree, 'MedalsCollection').length, 1);
  assert.equal(h.route.params.tab, undefined, 'consume the one-time navigation request');
  tree = h.selectTab('Overview'); assert.equal(nodes(tree, 'MedalsCollection').length, 0);
  h.route.params = { tab: 'Medals' }; tree = h.render();
  assert.equal(nodes(tree, 'MedalsCollection').length, 1, 'a later View medals request is honored again');
  const tab = nodes(tree, 'Pressable').find(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === 'Medals');
  assert.equal(tab.props.accessibilityState.selected, true);
  assert.deepEqual(h.writes, []);
});

const editorialPlays = [
  { id: 'midsummer', name: 'Midsummer', genre: 'Comedy', difficulty: 1, mainImage: 21, medalImage: 11 },
  { id: 'romeo', name: 'Romeo and Juliet', genre: 'Tragedy', difficulty: 2, mainImage: 22, medalImage: 12 },
  { id: 'henry-viii', name: 'Henry VIII', genre: 'History', difficulty: 39, mainImage: 23, medalImage: 13 },
];
const buttonNamed = (tree, label) => nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === label || text(node) === label);
const flatStyle = style => Object.assign({}, ...[typeof style === 'function' ? style({ pressed: false }) : style].flat(Infinity).filter(Boolean));

test('Home leads with the confirmed next play and one Continue action before account details', () => {
  const h = host({ catalogue: editorialPlays, level: 1 });
  const tree = h.render(), copy = text(tree);
  assert.match(copy, /Continue your course/);
  assert.match(copy, /Romeo and Juliet/);
  assert.match(copy, /1 of 3 plays completed/);
  assert.ok(copy.indexOf('Continue your course') < copy.indexOf('Synthetic reader'), 'course content has priority over the profile');
  assert.ok(nodes(tree, 'Image').some(node => node.props.source === 22), 'the next play uses its original catalogue artwork');
  const continuation = nodes(tree, 'Pressable').filter(node => text(node).trim() === 'Continue');
  assert.equal(continuation.length, 1);
  continuation[0].props.onPress();
  assert.deepEqual(h.calls, [['Course']]);
  assert.deepEqual(h.writes, []);
});

test('quiet Home discovery actions open the existing browse, saved passage, and medal destinations', () => {
  const h = host({ catalogue: editorialPlays });
  let tree = h.render();
  assert.ok(buttonNamed(tree, 'Browse plays'), 'the browse destination is available from Home');
  assert.ok(buttonNamed(tree, 'Saved passages'), 'the saved passage destination is available from Home');
  buttonNamed(tree, 'Browse plays').props.onPress();
  buttonNamed(tree, 'Saved passages').props.onPress();
  buttonNamed(tree, 'Medals').props.onPress();
  tree = h.render();
  assert.equal(nodes(tree, 'MedalsCollection').length, 1);
  assert.deepEqual(h.scrolls, [{ y: 0, animated: false }], 'opening a collection starts at its heading rather than the old overview offset');
  assert.deepEqual(h.calls, [['FreeFolger'], ['MyHighlights']]);
  assert.deepEqual(h.writes, []);
});

test('Home bounds the bundled artwork explicitly so its intrinsic image height cannot bury Continue', () => {
  const h = host({ catalogue: editorialPlays });
  const artwork = nodes(h.render(), 'Image').find(node => node.props.source === 22);
  assert.ok(artwork);
  const style = flatStyle(artwork.props.style);
  assert.ok(Number.isFinite(style.height) && style.height > 0 && style.height <= 260,
    'a source image can have a multi-thousand-point intrinsic height; the Home frame must override it');
});

test('a missing next difficulty shows an honest course fallback without suggesting or unlocking a different play', () => {
  const h = host({ level: 33, catalogue: [
    editorialPlays[0],
    { id: 'troilus', name: 'Troilus and Cressida', difficulty: 33, mainImage: 31, medalImage: 14 },
    { id: 'kinsmen', name: 'Two Noble Kinsmen', difficulty: 35, mainImage: 32, medalImage: 15 },
  ] });
  const tree = h.render(), copy = text(tree);
  assert.match(copy, /2 of 3 plays completed/);
  assert.match(copy, /Course overview/);
  assert.ok(!nodes(tree, 'Image').some(node => node.props.source === 21 || node.props.source === 32), 'neither a first-play fallback nor a locked next play becomes the current artwork');
  buttonNamed(tree, 'View course').props.onPress();
  assert.deepEqual(h.calls, [['Course']]);
  assert.deepEqual(h.writes, []);
});

test('Home keeps certificate and profile controls accessible with flexible targets at enlarged text size', () => {
  const h = host({ catalogue: editorialPlays, dimensions: { width: 320, fontScale: 1.5 } });
  let tree = h.render();
  assert.ok(buttonNamed(tree, 'Update profile picture'));
  assert.ok(buttonNamed(tree, 'Log out'));
  for (const node of nodes(tree, 'Pressable')) {
    const style = flatStyle(node.props.style);
    assert.ok(style.minHeight >= 48, `${node.props.accessibilityLabel || text(node)} has a flexible touch target`);
    assert.equal(style.height, undefined, 'controls expand with their text');
  }
  for (const node of nodes(tree, 'Text')) {
    assert.notEqual(node.props.allowFontScaling, false);
    assert.equal(node.props.numberOfLines, undefined, 'Home titles and account text remain readable');
  }
  tree = h.selectTab('Certificate');
  assert.match(text(tree), /Certificate in progress/);
  assert.match(text(tree), /all\s+3\s+plays/);
  assert.deepEqual(h.writes, []);
});

test('Home collection receives raw confirmed level 39 and earned actions use the existing lesson route', () => {
  const h = host({ tab: 'Medals', level: 39 });
  const collection = nodes(h.render(), 'MedalsCollection')[0];
  assert.ok(collection);
  assert.equal(collection.props.completedLevel, 39);
  assert.equal(collection.props.plays.length, 2);
  collection.props.onOpenLesson(h.plays[1]);
  assert.deepEqual(h.calls, [['Lesson', { id: 'henry-viii' }]]);
  h.setProgress({ status: 'loading', completedLevel: 0 });
  assert.equal(nodes(h.render(), 'MedalsCollection').length, 0, 'unconfirmed or changed-account progress cannot expose earned state');
  assert.deepEqual(h.writes, []);
});

test('Home never renders medals from a non-ready account snapshot even when it contains a stale earned level', () => {
  for (const status of ['loading', 'error', 'signed-out']) {
    const h = host({ tab: 'Medals', initialProgress: { status, completedLevel: 39 } });
    const tree = h.render();
    assert.equal(nodes(tree, 'MedalsCollection').length, 0, `${status} cannot expose an earned collection`);
    const notice = nodes(tree, 'CourseProgressNotice')[0];
    assert.ok(notice, `${status} retains the existing account progress notice`);
    assert.equal(notice.props.status, status);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.writes, []);
  }
});

test('switching accounts hides the old earned collection until the new account is ready', () => {
  const h = host({ tab: 'Medals', level: 39 });
  assert.equal(nodes(h.render(), 'MedalsCollection')[0].props.completedLevel, 39);
  h.setProgress({ status: 'loading', completedLevel: 39 });
  let tree = h.render();
  assert.equal(nodes(tree, 'MedalsCollection').length, 0, 'a stale previous-account level cannot flash while loading');
  assert.equal(nodes(tree, 'CourseProgressNotice')[0].props.status, 'loading');
  h.setProgress({ status: 'ready', completedLevel: 0 });
  tree = h.render();
  assert.equal(nodes(tree, 'MedalsCollection').length, 1);
  assert.equal(nodes(tree, 'MedalsCollection')[0].props.completedLevel, 0, 'only the newly confirmed account level reaches the collection');
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.writes, []);
});
