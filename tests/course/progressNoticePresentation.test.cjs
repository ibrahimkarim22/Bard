const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../..');
const flattenStyle = value => Object.assign({}, ...[typeof value === 'function'
  ? value({ pressed: false }) : value].flat(Infinity).filter(Boolean));
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []),
  ...(tree.props.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const text = tree => typeof tree === 'string' ? tree : !tree || typeof tree !== 'object'
  ? '' : (tree.props.children || []).flat(Infinity).map(text).join(' ');

const native = Object.fromEntries([
  'ActivityIndicator', 'Image', 'Pressable', 'ScrollView', 'StatusBar', 'Text', 'TextInput', 'View',
].map(name => [name, name]));
native.StyleSheet = { create: value => value, flatten: flattenStyle, hairlineWidth: 1 };
native.Platform = { OS: 'android' };
const React = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
    const next = { ...props, children };
    return typeof type === 'function' ? type(next) : { type, props: next };
  },
};
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  if (file.endsWith('.ttf')) return file;
  const code = babel.transformFileSync(path.join(root, file), {
    babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === 'expo-font') return { useFonts: () => [true, null] };
    assert.ok(name.startsWith('.'), `unexpected notice dependency ${name}`);
    const target = path.posix.join(path.posix.dirname(file), name + (path.posix.extname(name) ? '' : '.js'));
    return load(target);
  }, module, module.exports);
  modules.set(file, module.exports);
  return module.exports;
}

const colors = {
  background: '#101014', surface: '#1c1c22', soft: '#292932', text: '#f5f0e6',
  muted: '#b4adb0', gold: '#c6a663', onGold: '#241c15', border: '#3b353b',
};

test('embedded progress notices leave insets and status bars to Home while using its palette', () => {
  const { CourseProgressNotice } = load('course/CourseProgressNotice.js');
  for (const status of ['loading', 'error', 'signed-out']) {
    const tree = CourseProgressNotice({ status, colors, embedded: true, onRetry: () => Promise.resolve() });
    assert.equal(tree.type, 'ScrollView');
    assert.equal(nodes(tree, 'SafeAreaView').length, 0, `${status} uses Home's insets`);
    assert.equal(nodes(tree, 'StatusBar').length, 0, `${status} leaves Home's status bar in control`);
    assert.equal(flattenStyle(tree.props.style).backgroundColor, '#101014');
    assert.equal(flattenStyle(tree.props.style).flex, 1);
    const layout = flattenStyle(tree.props.contentContainerStyle);
    assert.equal(layout.padding, 24);
    assert.equal(layout.gap, 28);
    const heading = nodes(tree, 'Text').find(node => node.props.accessibilityRole === 'header');
    assert.equal(flattenStyle(heading.props.style).color, '#f5f0e6');
    if (status === 'loading') {
      assert.equal(nodes(tree, 'ActivityIndicator')[0].props.color, '#c6a663');
      assert.equal(nodes(tree, 'Pressable').length, 0);
    } else {
      const message = nodes(tree, 'Text').find(node => node !== heading && !nodes(tree, 'Pressable').some(button => nodes(button, 'Text').includes(node)));
      assert.equal(flattenStyle(message.props.style).color, '#b4adb0');
      assert.equal(nodes(tree, 'Pressable').length, status === 'error' ? 1 : 0);
    }
  }
});

test('embedded retry and back actions retain their handlers and receive readable button colors', async () => {
  const { CourseProgressNotice } = load('course/CourseProgressNotice.js');
  for (const rejects of [false, true]) {
    let retries = 0, backs = 0;
    const tree = CourseProgressNotice({ status: 'error', colors, embedded: true,
      onRetry() { retries++; return rejects ? Promise.reject(Error('read unavailable')) : Promise.resolve(); },
      onBack() { backs++; },
    });
    const retry = nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === 'Retry loading progress');
    const back = nodes(tree, 'Pressable').find(node => node.props.accessibilityLabel === 'Back to course');
    assert.equal(flattenStyle(retry.props.style).backgroundColor, '#c6a663');
    assert.equal(flattenStyle(retry.props.style).borderColor, '#c6a663');
    assert.equal(flattenStyle(nodes(retry, 'Text')[0].props.style).color, '#241c15');
    assert.equal(flattenStyle(nodes(back, 'Text')[0].props.style).color, '#f5f0e6');
    retry.props.onPress();
    back.props.onPress();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(retries, 1);
    assert.equal(backs, 1);
  }
});

test('standalone notices use the shared dark page and readable status bar', () => {
  const { CourseProgressNotice } = load('course/CourseProgressNotice.js');
  for (const status of ['loading', 'error', 'signed-out']) {
    const tree = CourseProgressNotice({ status, onRetry: () => Promise.resolve() });
    assert.equal(tree.type, 'SafeAreaView');
    assert.equal(flattenStyle(tree.props.style).backgroundColor, '#121116');
    const statusBar = nodes(tree, 'StatusBar')[0];
    assert.equal(nodes(tree, 'StatusBar').length, 1);
    assert.equal(statusBar.props.barStyle, 'light-content');
    assert.equal(statusBar.props.backgroundColor, '#121116');
    const heading = nodes(tree, 'Text').find(node => node.props.accessibilityRole === 'header');
    assert.equal(flattenStyle(heading.props.style).color, '#f3eadb');
    assert.ok(text(tree).trim());
  }
});

test('optional course button colors cover primary, secondary, quiet and busy presentations', () => {
  const { CourseButton } = load('course/CourseUI.js');
  for (const variant of ['primary', 'secondary', 'quiet']) {
    const tree = CourseButton({ title: 'Action', variant, colors, busy: true });
    const style = flattenStyle(tree.props.style);
    assert.equal(style.backgroundColor, variant === 'primary' ? '#c6a663' : variant === 'secondary' ? '#292932' : 'transparent');
    assert.equal(style.borderColor, style.backgroundColor);
    assert.equal(flattenStyle(nodes(tree, 'Text')[0].props.style).color, variant === 'primary' ? '#241c15' : '#f5f0e6');
    assert.equal(nodes(tree, 'ActivityIndicator')[0].props.color, variant === 'primary' ? '#241c15' : '#c6a663');
  }
  const defaults = CourseButton({ title: 'Action' });
  assert.equal(flattenStyle(defaults.props.style).backgroundColor, '#c6a663');
  assert.equal(flattenStyle(nodes(defaults, 'Text')[0].props.style).color, '#241c15');
});
