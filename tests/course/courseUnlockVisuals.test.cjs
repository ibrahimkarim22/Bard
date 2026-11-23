const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

class Value {
  constructor(value) { this.value = value; }
  interpolate({ inputRange, outputRange }) {
    const value = Math.max(inputRange[0], Math.min(inputRange.at(-1), this.value));
    let index = inputRange.findIndex((stop, position) => position > 0 && value <= stop) - 1;
    if (index < 0) index = inputRange.length - 2;
    const fraction = (value - inputRange[index]) / (inputRange[index + 1] - inputRange[index]);
    const from = outputRange[index], to = outputRange[index + 1];
    return typeof from === 'number' ? from + (to - from) * fraction : fraction === 1 ? to : from;
  }
}
const session = (pathValue = 0, lock = 0, sparkle = 0) => ({
  sourceHeight: 380, path: new Value(pathValue), lock: new Value(lock), sparkle: new Value(sparkle),
});
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.props?.children || []).flat(Infinity).flatMap(nodes)];
const byId = (tree, id) => nodes(tree).find(node => node.props.testID === id);
const style = node => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
function load() {
  const React = { createElement(type, props, ...children) { return { type, props: { ...props, children } }; } };
  const native = { View: 'View', Animated: { View: 'AnimatedView' },
    StyleSheet: { create: value => value, absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } } };
  const file = path.resolve(__dirname, '../../course/CourseUnlockVisuals.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === '../shared/editorialTheme') return require('../../shared/editorialTheme');
    throw new Error('Unexpected dependency ' + name);
  }, module, module.exports);
  return module.exports;
}

test('the unlock path travels between adjacent measured rail-node centers', () => {
  const { CourseUnlockPath } = load();
  const start = CourseUnlockPath({ session: session(0) });
  const middle = CourseUnlockPath({ session: session(0.5) });
  const end = CourseUnlockPath({ session: session(1) });
  assert.equal(style(byId(start, 'course-unlock-path-fill')).top, 24);
  assert.equal(style(byId(start, 'course-unlock-path-fill')).height, 0);
  assert.equal(style(byId(middle, 'course-unlock-path-fill')).height, 190);
  assert.equal(style(byId(end, 'course-unlock-path-fill')).height, 356, 'the outgoing segment stops at its own row boundary');
  const dot = style(byId(end, 'course-unlock-path-dot'));
  assert.equal(dot.top + dot.height / 2 + dot.transform[0].translateY, 380);
  assert.equal(start.props.pointerEvents, 'none');
  assert.equal(start.props.importantForAccessibility, 'no-hide-descendants');
});

test('the gold connection grows continuously through the next row into its numbered circle', () => {
  const { CourseUnlockPath } = load();
  for (const [progress, outgoing, incoming] of [[0, 0, 0], [0.5, 190, 0], [0.95, 356, 5], [1, 356, 24]]) {
    const source = CourseUnlockPath({ session: session(progress), segment: 'outgoing' });
    const next = CourseUnlockPath({ session: session(progress), segment: 'incoming' });
    assert.ok(Math.abs(style(byId(source, 'course-unlock-path-fill')).height - outgoing) < 1e-8);
    const fill = style(byId(next, 'course-unlock-path-incoming-fill'));
    assert.equal(fill.top, 0); assert.ok(Math.abs(fill.height - incoming) < 1e-8);
    assert.ok(Math.abs(outgoing + incoming - progress * 380) < 1e-8, 'both visible row segments share one continuous progress value');
  }
});

test('the padlock holds shut during approach and physically opens at the destination', () => {
  const { CourseUnlockLock } = load();
  for (const phase of ['waiting', 'travel', 'hold']) {
    const tree = CourseUnlockLock({ session: session(1, 1), phase });
    assert.deepEqual(style(byId(tree, 'course-unlock-shackle')).transform,
      [{ translateY: 0 }, { translateX: 0 }, { rotate: '0deg' }]);
    assert.equal(byId(tree, 'course-unlock-sparkle'), undefined);
  }
  const opened = CourseUnlockLock({ session: session(1, 1), phase: 'unlocking' });
  const transform = style(byId(opened, 'course-unlock-shackle')).transform;
  assert.ok(transform[0].translateY < 0, 'the shackle lifts out of the body');
  assert.notEqual(transform[2].rotate, '0deg', 'the free end visibly pivots away');
  assert.equal(opened.props.pointerEvents, 'none');
  assert.equal(opened.props.accessibilityElementsHidden, true);
});

test('the gold burst spreads away from the opened lock and settles fully invisible', () => {
  const { CourseUnlockLock } = load();
  const burst = CourseUnlockLock({ session: session(1, 1, 0.3), phase: 'sparkling' });
  const rays = nodes(burst).filter(node => node.props.testID === 'course-unlock-sparkle');
  assert.ok(rays.length >= 8, 'the unlock has a radial burst');
  assert.ok(style(rays[0]).opacity > 0);
  assert.ok(style(rays[0]).transform[0].translateX > 12, 'the pieces travel outward');
  const settled = CourseUnlockLock({ session: session(1, 1, 1), phase: 'sparkling' });
  assert.equal(style(byId(settled, 'course-unlock-lock')).opacity, 0);
  assert.equal(style(byId(settled, 'course-unlock-halo')).opacity, 0);
  for (const ray of nodes(settled).filter(node => node.props.testID === 'course-unlock-sparkle')) assert.equal(style(ray).opacity, 0);
});
