const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../..');
const appearance = genre => require('../../course/medalAppearance').getMedalAppearance(genre);
const palettes = [
  ['Comedy', { fill: '#275341', edge: '#4d7760', fold: '#3f6b53' }],
  ['Tragedy', { fill: '#642d3c', edge: '#8c5360', fold: '#854455' }],
  ['History', { fill: '#3e536a', edge: '#65798c', fold: '#536b82' }],
  ['Romance', { fill: '#644864', edge: '#896a89', fold: '#7b5c7b' }],
];
const neutral = { fill: '#3b3f43', edge: '#61666b', fold: '#51565b' };

test('the four catalogue genre labels select distinct fabric palettes', () => {
  for (const [genreLabel, strap] of palettes) {
    assert.deepEqual(appearance(genreLabel), { genreLabel, strap });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'));
  assert.equal(manifest.plays.length, 38);
  assert.deepEqual([...new Set(manifest.plays.map(play => play.genre))].sort(), ['Comedy', 'History', 'Problem Play', 'Romance', 'Tragedy']);
  for (const play of manifest.plays) {
    const metadata = JSON.parse(fs.readFileSync(path.resolve(root, 'data', play.play), 'utf8'));
    const expected = metadata.genre === 'Problem Play' ? ['Problem Play', neutral] : palettes.find(([genre]) => genre === metadata.genre);
    assert.ok(expected, `${play.id} retains its exact catalogue genre`);
    assert.deepEqual(appearance(metadata.genre), { genreLabel: expected[0], strap: expected[1] }, play.id);
  }
});

test('unknown genre labels remain visible while using neutral fabric', () => {
  for (const genreLabel of ['Problem Play', 'comedy', 'Tragicomedy', '__proto__', 'constructor', 'toString']) {
    assert.deepEqual(appearance(genreLabel), { genreLabel, strap: neutral });
  }
});

test('missing or invalid genre metadata uses an explicit Unclassified label and neutral fabric', () => {
  for (const genre of [undefined, null, '', '   ', 0, 7, false, true, [], {}, new String('Comedy')]) {
    assert.deepEqual(appearance(genre), { genreLabel: 'Unclassified', strap: neutral });
  }
});

test('shared appearance results and nested fabric colors cannot be mutated by a consumer', () => {
  for (const genre of ['Comedy', 'Tragedy', 'History', 'Romance', 'Problem Play', undefined]) {
    const result = appearance(genre);
    assert.equal(Object.isFrozen(result), true, String(genre));
    assert.equal(Object.isFrozen(result.strap), true, String(genre));
    const before = JSON.stringify(result);
    assert.equal(Reflect.set(result, 'genreLabel', 'Changed'), false);
    assert.equal(Reflect.set(result.strap, 'fill', '#ffffff'), false);
    assert.equal(JSON.stringify(appearance(genre)), before);
  }
});

function lockedComponent() {
  const React = { createElement(type, props, ...children) {
    const next = { ...props, children };
    return typeof type === 'function' ? type(next) : { type, props: next };
  } };
  const native = { View: 'View', Text: 'Text', Image: 'Image', StyleSheet: { create: value => value } };
  Object.defineProperty(native, 'Animated', { get() { throw new Error('locked medal curtains must stay closed and static'); } });
  const file = path.join(root, 'course/LockedMedal.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    throw new Error('locked medal curtains must use native Views only: ' + name);
  }, module, module.exports);
  return module.exports.default;
}

const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(value => value && typeof value === 'object'));

test('locked medals use an opaque closed two-panel curtain with no underlying artwork', () => {
  const LockedMedal = lockedComponent();
  for (const size of [64, 140, 169, 228]) {
    const locked = LockedMedal({ size });
    const frame = flatten(locked.props.style);
    assert.equal(frame.width, size);
    assert.equal(frame.height, size);
    assert.match(frame.backgroundColor, /^#[0-9a-f]{6}$/i, 'the entire reserved square has an opaque cloth background');
    assert.equal(nodes(locked, 'Image').length, 0, 'locked artwork is never requested or mounted beneath the curtain');
    assert.equal(nodes(locked, 'Text').length, 0, 'the generic curtain contains no play data or fallback label');
    const panels = nodes(locked, 'View').filter(node => node.props.testID === 'locked-curtain-left' || node.props.testID === 'locked-curtain-right');
    assert.equal(panels.length, 2);
    const left = flatten(panels.find(node => node.props.testID === 'locked-curtain-left').props.style);
    const right = flatten(panels.find(node => node.props.testID === 'locked-curtain-right').props.style);
    assert.equal(left.left, 0);
    assert.equal(right.right, 0);
    for (const panel of [left, right]) {
      assert.equal(panel.width, '50%', 'both closed panels meet at the center');
      assert.equal(panel.height, '100%');
      assert.equal(panel.top, 0);
    }
    for (const view of nodes(locked, 'View')) {
      const style = flatten(view.props.style);
      assert.match(style.backgroundColor, /^#[0-9a-f]{6}$/i, 'every curtain layer is opaque');
      assert.ok(style.opacity === undefined || style.opacity === 1);
      assert.equal(style.filter, undefined);
      assert.equal(view.props.source, undefined);
    }
    assert.equal(locked.props.pointerEvents, 'none');
    assert.equal(locked.props.accessible, false, 'the surrounding item announces its locked state');
    assert.equal(locked.props.accessibilityElementsHidden, true);
    assert.equal(locked.props.importantForAccessibility, 'no-hide-descendants');
  }
});

test('locked curtain invalid sizes use the same 140-point square footprint', () => {
  const LockedMedal = lockedComponent();
  for (const size of [undefined, null, NaN, Infinity, 0, -1, 63, '169', {}, true]) {
    const locked = LockedMedal({ size });
    assert.equal(flatten(locked.props.style).width, 140);
    assert.equal(flatten(locked.props.style).height, 140);
    assert.equal(nodes(locked, 'Image').length, 0);
  }
});
