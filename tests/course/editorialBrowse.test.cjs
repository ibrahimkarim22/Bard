const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../..');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []),
  ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree)
  : !tree || typeof tree !== 'object' ? '' : (tree.props?.children || []).flat(Infinity).map(text).join(' ');
const plays = [
  { id: 'henry', name: 'Henry V', genre: 'History', difficulty: 4, mainImage: 'cover-henry', medalImage: 'medal-henry' },
  { id: 'hamlet', name: 'Hamlet', genre: 'Tragedy', difficulty: 2, mainImage: 'cover-hamlet', medalImage: 'medal-hamlet' },
  { id: 'dream', name: "A Midsummer Night's Dream", genre: 'Comedy', difficulty: 1, mainImage: 'cover-dream', medalImage: 'medal-dream' },
  { id: 'tempest', name: 'The Tempest', genre: 'Romance', difficulty: 39, mainImage: 'cover-tempest', medalImage: 'medal-tempest' },
];

function host(screen, progress = { status: 'ready', completedLevel: 0 }, dimensions = { width: 320, height: 640, fontScale: 1.5 }) {
  const calls = [], scrolls = [], frames = new Map(), cache = new Map();
  let frame, effects;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  function invoke(type, props) {
    const key = type.name + ':' + (props.key || '');
    if (!frames.has(key)) frames.set(key, { slots: [], cursor: 0 });
    const previous = frame; frame = frames.get(key); frame.cursor = 0;
    try { return type(props); } finally { frame = previous; }
  }
  const memo = (factory, deps) => {
    const index = frame.cursor++, slots = frame.slots;
    if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() };
    return slots[index].value;
  };
  const React = {
    createElement(type, props, ...children) {
      const next = { ...props, children };
      if (typeof type === 'function') return invoke(type, next);
      if (type === 'ScrollView' && next.ref) next.ref.current = { scrollTo: value => scrolls.push(value) };
      return { type, props: next };
    },
    useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useLayoutEffect(callback, deps) { return React.useEffect(callback, deps); },
    useRef: value => memo(() => ({ current: value }), []),
    useState(initial) {
      const slot = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [slot.value, value => { slot.value = typeof value === 'function' ? value(slot.value) : value; }];
    },
    useEffect(callback, deps) {
      const index = frame.cursor++, slots = frame.slots;
      if (!same(slots[index], deps)) effects.push(() => { slots[index] = deps; callback(); });
    },
  };
  const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'StatusBar', 'ActivityIndicator', 'TextInput', 'Image', 'ImageBackground'].map(name => [name, name]));
  native.FlatList = props => {
    if (props.ref) props.ref.current = { scrollToOffset: value => scrolls.push(value) };
    return { type: 'FlatList', props: { ...props, children: [props.ListHeaderComponent,
      ...props.data.map((item, index) => props.renderItem({ item, index })),
      !props.data.length && props.ListEmptyComponent] } };
  };
  Object.assign(native, {
    StyleSheet: { create: value => value, flatten: value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean)), hairlineWidth: 1, absoluteFillObject: {} },
    Platform: { OS: 'android', select: value => value.android || value.default },
    useWindowDimensions: () => dimensions,
    Keyboard: { dismiss: () => calls.push(['keyboard-dismiss']) },
  });
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    if (/\.(?:ttf|png|jpg)$/.test(file)) return file;
    const code = babel.transformFileSync(path.join(root, file), { babelrc: false, configFile: false,
      plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports,React,setTimeout,clearTimeout){' + code + '\n})', { filename: file })(name => {
      if (name === 'react') return React;
      if (name === 'react-native') return native;
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      if (name === '@react-navigation/native') return { useNavigation: () => ({ navigate: (...args) => calls.push(args) }) };
      if (name === 'expo-font') return { useFonts: () => [true, null] };
      if (name === '@fortawesome/react-native-fontawesome') return { FontAwesomeIcon: 'Icon' };
      if (name === '@fortawesome/free-solid-svg-icons') return {};
      if (name.endsWith('/Loader')) return { __esModule: true, default: 'Loader' };
      if (name.endsWith('/AccountCourseProgress')) return { useAccountCourseProgress: () => progress, retryAccountProgress: async () => {} };
      if (name.endsWith('/CourseProgressNotice')) return { CourseProgressNotice: props => ({ type: 'ProgressNotice', props: { ...props, children: [] } }) };
      if (name.endsWith('/localPlayService')) return { PLAYS: plays, getLocalPlayEntry: id => ({ code: id === 'hamlet' ? 'HAM' : id,
        play: { title: id === 'hamlet' ? 'The Tragedy of Hamlet' : id, fullTitle: id } }) };
      if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name + (path.extname(name) ? '' : '.js'))));
      throw new Error('Unexpected dependency ' + name);
    }, module, module.exports, React, () => 1, () => {});
    cache.set(file, module.exports); return module.exports;
  }
  const h = { calls, scrolls,
    render() { effects = []; const tree = invoke(load(screen).default, {}); effects.forEach(effect => effect()); return tree; },
    button(label) { return nodes(h.render(), 'Pressable').find(node => node.props.accessibilityLabel === label); },
    search(value) { nodes(h.render(), 'TextInput')[0].props.onChangeText(value); },
  };
  return h;
}

test('Library combines title search with genre and keeps the existing reader destination', () => {
  const h = host('screens/Folger.js');
  const first = h.button("A Midsummer Night's Dream, read play");
  assert.ok(first, 'each illustrated row exposes its reading action');
  assert.deepEqual(nodes(h.render(), 'Image').map(image => image.props.source), ['cover-dream', 'cover-hamlet', 'cover-henry', 'cover-tempest']);
  h.button('Tragedy').props.onPress(); h.search('  HAM  ');
  assert.ok(h.button('Hamlet, read play'));
  assert.equal(h.button('Henry V, read play'), undefined);
  h.button('Hamlet, read play').props.onPress();
  assert.deepEqual(h.calls, [['ReadFolger', { id: 'hamlet' }]]);
  h.search('henry'); assert.match(text(h.render()), /No plays found/);
  h.button('Clear search and filters').props.onPress();
  assert.ok(h.button('Henry V, read play'));
  const tree = h.render();
  assert.equal(nodes(tree, 'ScrollView').length, 0, 'the list has no eagerly rendered parent scroll view');
  assert.equal(nodes(tree, 'FlatList').length, 1);
  assert.equal(nodes(nodes(tree, 'FlatList')[0], 'TextInput').length, 1, 'controls remain in the scrolling list header');
});

test('Synopsis preserves alias matching, combined filters and its own destination', () => {
  const h = host('screens/SynopsisList.js');
  assert.equal(nodes(nodes(h.render(), 'FlatList')[0], 'TextInput').length, 1, 'controls scroll with the list at large text sizes');
  h.button('Tragedy').props.onPress(); h.search('HAM');
  assert.ok(h.button('Hamlet synopsis'));
  assert.equal(h.button('Henry V synopsis'), undefined);
  h.button('Hamlet synopsis').props.onPress();
  assert.deepEqual(h.calls, [['keyboard-dismiss'], ['Synopsis', { id: 'hamlet' }]]);
  h.search('absent'); assert.match(text(h.render()), /No plays found/);
  h.button('Clear search and filters').props.onPress();
  assert.ok(h.button('Henry V synopsis'));
  assert.ok(h.scrolls.length > 0, 'search and genre changes keep their existing scroll reset');
});

test('Course keeps completed, current and locked levels distinct and guards locked navigation', () => {
  const h = host('screens/CourseScreen.js', { status: 'ready', completedLevel: 1 });
  const completed = h.button("A Midsummer Night's Dream, Completed");
  const current = h.button('Hamlet, You are here');
  const locked = h.button('Henry V, Locked');
  assert.ok(completed); assert.ok(current); assert.ok(locked);
  assert.equal(locked.props.disabled, true);
  completed.props.onPress(); current.props.onPress(); locked.props.onPress?.();
  assert.deepEqual(h.calls, [['Lesson', { id: 'dream' }], ['Lesson', { id: 'hamlet' }]]);
  assert.equal(locked.props.onPress, undefined);
  assert.equal(current.props.accessibilityState.selected, true);
  assert.equal(completed.props.accessibilityState.selected, false);
  assert.equal(nodes(h.render(), 'FlatList').length, 1);
});

test('Course preserves raw difficulty gaps and does not reveal rows from unready account progress', () => {
  const progress = { status: 'ready', completedLevel: 2 };
  const h = host('screens/CourseScreen.js', progress);
  assert.ok(h.button('Henry V, Locked'), 'difficulty four stays locked when difficulty three is absent');
  progress.completedLevel = 39;
  assert.ok(h.button('The Tempest, Locked'), 'existing completed-count clamp does not renumber difficulty 39');
  for (const status of ['loading', 'error', 'signed-out']) {
    progress.status = status;
    const tree = h.render();
    assert.equal(nodes(tree, 'ProgressNotice')[0].props.status, status);
    assert.equal(nodes(tree, 'Image').length, 0);
  }
  assert.deepEqual(h.calls, []);
});

const flattenStyle = value => Object.assign({}, ...[typeof value === 'function' ? value({ pressed: false }) : value].flat(Infinity).filter(Boolean));
const byId = (tree, id) => nodes(tree, 'View').find(node => node.props.testID === id);

test('Course starts directly with posters on one connected path and removes the introductory and unlock paragraphs', () => {
  const h = host('screens/CourseScreen.js', { status: 'ready', completedLevel: 1 });
  const tree = h.render();
  assert.doesNotMatch(text(tree), /One play at a time|The Shakespeare course|Read closely|Next unlocked|plays completed|Unlocks after/);
  assert.equal(nodes(tree, 'Pressable').filter(node => node.props.accessibilityRole === 'tab').length, 0);
  assert.deepEqual(nodes(tree, 'Image').map(image => image.props.source), ['cover-dream', 'cover-hamlet', 'cover-henry', 'cover-tempest']);
  for (const id of ['dream', 'hamlet', 'henry', 'tempest']) {
    const step = byId(tree, `course-step-${id}`);
    assert.ok(step, 'each poster belongs to the same linear path');
    assert.ok(nodes(step, 'Image').length === 1);
    const rail = byId(step, `course-rail-${id}`);
    assert.equal(rail.props.importantForAccessibility, 'no-hide-descendants');
    assert.equal(flattenStyle(step.props.style).flexDirection, 'row');
  }
  assert.equal(byId(tree, 'course-line-before-dream'), undefined, 'the line starts at the first node');
  assert.equal(byId(tree, 'course-line-after-tempest'), undefined, 'the line ends at the last node');
  assert.equal(flattenStyle(byId(tree, 'course-line-after-dream').props.style).backgroundColor, '#c6a663');
  assert.equal(flattenStyle(byId(tree, 'course-line-before-hamlet').props.style).backgroundColor, '#c6a663');
  assert.equal(flattenStyle(byId(tree, 'course-line-after-hamlet').props.style).backgroundColor, '#423845');
  assert.equal(flattenStyle(byId(tree, 'course-line-before-henry').props.style).backgroundColor, '#423845');
});

test('Course gives the first current poster one location marker and keeps titles scalable in a narrow viewport', () => {
  for (const dimensions of [{ width: 411, height: 800, fontScale: 1 }, { width: 280, height: 600, fontScale: 1.5 }]) {
    const h = host('screens/CourseScreen.js', { status: 'ready', completedLevel: 0 }, dimensions);
    const tree = h.render();
    const current = h.button("A Midsummer Night's Dream, You are here");
    assert.ok(current);
    assert.equal(nodes(tree, 'Pressable').filter(node => node.props.accessibilityState.selected).length, 1);
    assert.equal((text(tree).match(/You are here/g) || []).length, 1);
    for (const button of nodes(tree, 'Pressable')) {
      assert.equal(flattenStyle(button.props.style).flex, 1, 'posters fit the available width');
      for (const label of nodes(button, 'Text')) {
        assert.notEqual(label.props.allowFontScaling, false);
        assert.equal(label.props.numberOfLines, undefined);
      }
    }
    assert.ok(tree.props.edges.includes('bottom'), 'the last poster clears Android navigation');
    current.props.onPress();
    assert.deepEqual(h.calls, [['Lesson', { id: 'dream' }]]);
  }
});

test('poster collections bound initial and offscreen rendering instead of requesting the whole catalogue at once', () => {
  for (const [screen, initial, batch] of [['screens/CourseScreen.js', 2, 2], ['screens/Folger.js', 6, 4], ['screens/SynopsisList.js', 6, 4]]) {
    const tree = host(screen).render(), list = nodes(tree, 'FlatList')[0];
    assert.ok(list, screen);
    assert.equal(list.props.initialNumToRender, initial);
    assert.equal(list.props.maxToRenderPerBatch, batch);
    assert.equal(list.props.windowSize, 3);
    assert.equal(list.props.removeClippedSubviews, false, 'native clipping must not hide still-mounted artwork');
    assert.equal(nodes(tree, 'ScrollView').length, 0, 'virtualization is never nested in a same-direction ScrollView');
    assert.equal(list.props.data.length, 4, 'all plays remain reachable through the virtual list');
    assert.equal(new Set(list.props.data.map(list.props.keyExtractor)).size, 4, 'items retain distinct stable identities');
  }
});
