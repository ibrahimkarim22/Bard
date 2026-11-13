const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const test = require('node:test');
const { nodes, text } = require('../fixtures/synopsisUIHost.cjs');
const { welcomeMotionHost } = require('../fixtures/welcomeMotionHost.cjs');

test('welcome opens the existing Contact destination without requiring authentication', () => {
  let cursor = 0;
  const slots = [];
  const React = {
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: { ...props, children } }),
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }]; },
    useEffect() {}, useCallback: fn => fn,
  };
  const native = Object.fromEntries(['Image', 'ImageBackground', 'Pressable', 'SafeAreaView', 'ScrollView', 'StatusBar', 'Text', 'View'].map(name => [name, name]));
  native.StyleSheet = { create: styles => styles, flatten: value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean)) };
  native.Platform = { OS: 'android' };
  const calls = [], dependencies = [];
  function load(file) {
  if (/\.(jpg|ttf)$/.test(file)) return file;
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { React })(name => {
    dependencies.push(name);
    if (name === 'react-native') return native;
    if (name === 'react') return React;
    if (name === '@react-navigation/native') return { useIsFocused: () => true };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === 'expo-font') return { useFonts: () => [true] };
    if (name === './WelcomeTitle') return { __esModule: true, default: props => React.createElement('WelcomeTitle', props, 'BARD') };
    if (name === './WelcomeBackground') return { __esModule: true, default: props => React.createElement('WelcomeBackground', props) };
    if (name === './WelcomeMoon') return { __esModule: true, default: props => React.createElement('WelcomeMoon', props) };
    if (name === './WelcomeActionPulse') return { __esModule: true, default: props => React.createElement('WelcomeActionPulse', props, ...props.children) };
    if (name.includes('fortawesome')) return { FontAwesomeIcon: 'Icon' };
    if (name.endsWith('/localPlayService')) return { PLAYS: new Array(38) };
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + (path.extname(name) ? '' : '.js')));
    throw Error('Unexpected dependency ' + name);
  }, module, module.exports);
  return module.exports;
  }
  const Root = load(path.resolve(__dirname, '../../screens/RootScreen.js')).RootScreen;
  const render = () => { cursor = 0; return Root({ navigation: { navigate: (...args) => calls.push(args) } }); };
  const root = render();
  assert.equal(nodes(root, 'Image').length, 0, 'the welcome page no longer displays an illustration');
  assert.equal(nodes(root, 'WelcomeTitle').length, 1, 'the thin wordmark stays separate from decorative curtain motion');
  assert.equal(native.StyleSheet.flatten(nodes(root, 'WelcomeTitle')[0].props.style).textShadowRadius, undefined, 'no thick glow around the thin title');
  assert.equal(nodes(root, 'WelcomeBackground').length, 1, 'decorative motion stays separate from the actions');
  assert.equal(nodes(root, 'WelcomeMoon').length, 1);
  const pulses = nodes(root, 'WelcomeActionPulse');
  assert.equal(pulses.length, 1);
  assert.deepEqual(nodes(pulses[0], 'Pressable').map(button => button.props.accessibilityLabel), ['Create account'], 'only the primary action pulses');
  const layers = root.props.children.flat(Infinity).map(node => node?.type);
  assert.ok(layers.indexOf('WelcomeMoon') < layers.indexOf('WelcomeBackground'), 'opening curtains reveal the moon behind them');
  assert.ok(layers.indexOf('WelcomeBackground') > layers.indexOf('ScrollView'), 'closing curtains cover the current controls before the account scene changes');
  const scroll = nodes(root, 'ScrollView')[0];
  const viewport = native.StyleSheet.flatten(scroll.props.style);
  const content = native.StyleSheet.flatten(scroll.props.contentContainerStyle);
  assert.equal(viewport.alignSelf, 'center');
  assert.ok(content.paddingHorizontal === undefined || content.paddingHorizontal === 0);
  for (const width of [300, 343, 412, 768]) {
    const curtain = welcomeMotionHost({ screen: 'screens/WelcomeBackground.js', width }).render();
    const panel = nodes(curtain, 'AnimatedView').find(node => node.props.testID === 'curtain-panel-left');
    const panelStyle = native.StyleSheet.flatten(panel.props.style);
    const curtainEdge = parseFloat(panelStyle.width) / 100 * width - Math.abs(panelStyle.transform[0].translateX.config.outputRange[1]);
    assert.equal(typeof viewport.width, 'string');
    assert.ok(viewport.width.endsWith('%'));
    const columnWidth = parseFloat(viewport.width) / 100 * width;
    assert.ok((width - columnWidth) / 2 >= curtainEdge + 8, 'whole scrolling column stays inside the opened curtains');
  }
  for (const button of nodes(root, 'Pressable')) {
    const style = native.StyleSheet.flatten(typeof button.props.style === 'function' ? button.props.style({ pressed: false }) : button.props.style);
    assert.equal(style.width, '100%');
    assert.ok(style.minHeight >= 48, 'touch targets stay comfortable');
    assert.ok(!style.borderWidth, 'welcome actions have no visible border');
    assert.ok(!Object.keys(style).some(key => /^border(?:Top|Right|Bottom|Left)?Color$/.test(key)), 'colored button outlines are removed');
    assert.ok(nodes(button, 'Text').every(label => label.props.allowFontScaling && !label.props.numberOfLines), 'button labels can scale and wrap');
  }
  assert.match(text(root), /Shakespeare’s complete plays, with quizzes\./);
  assert.match(text(root), /Read full plays or explore their synopses\. Highlight and save your favorite passages, test your knowledge, and earn medals with perfect quiz scores\./);
  assert.doesNotMatch(text(root), /at your pace|complete works|sonnets/);
  assert.doesNotMatch(text(root), /earned medals|final certificate|100%|rebuilt for mobile/);
  const control = nodes(root, 'Pressable').find(node => node.props.accessibilityLabel === 'Contact & Feedback');
  assert.ok(control, 'public Contact link exists beside the existing account actions');
  assert.equal(text(control), 'Contact & Feedback');
  control.props.onPress();
  assert.equal(calls[0][0], 'Main');
  assert.equal(calls[0][1].screen, 'Contact');
  assert.equal(calls[0][1].params.fromPublicRoot, true);
  for (const [label, route] of [['Create account', 'SignUp'], ['Log in', 'Login']]) {
    const before = calls.length;
    nodes(root, 'Pressable').find(node => node.props.accessibilityLabel === label).props.onPress();
    nodes(root, 'Pressable').find(node => node.props.accessibilityLabel !== label && /Create account|Log in/.test(node.props.accessibilityLabel)).props.onPress();
    assert.equal(calls.length, before, 'navigation waits for the curtains');
    const curtain = nodes(render(), 'WelcomeBackground')[0];
    assert.equal(curtain.props.closing, true);
    curtain.props.onClosed();
    assert.equal(calls.at(-1)[0], route);
    assert.equal(nodes(render(), 'WelcomeBackground')[0].props.closing, true, 'the old scene stays covered during navigation');
    assert.equal(curtain.props.reopenOnFocus, true, 'Back reveals welcome from the closed position');
    curtain.props.onClosed();
    assert.equal(calls.length, before + 1, 'a second press or callback cannot replace or repeat the destination');
  }
  assert.ok(!dependencies.some(name => /firebase|auth/i.test(name)));
});
