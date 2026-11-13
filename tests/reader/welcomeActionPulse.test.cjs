const assert = require('node:assert/strict');
const test = require('node:test');
const { welcomeMotionHost, nodes } = require('../fixtures/welcomeMotionHost.cjs');
const host = options => welcomeMotionHost({ screen: 'screens/WelcomeActionPulse.js', ...options });
const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const tick = () => new Promise(setImmediate);

test('pulse preserves the actionable child without adding a border overlay', () => {
  const child = { type: 'Pressable', props: { accessibilityRole: 'button', children: ['Create account'] } };
  const h = host(), tree = h.render({ children: child });
  assert.equal(nodes(tree, 'Pressable')[0], child);
  assert.notEqual(tree.props.importantForAccessibility, 'no-hide-descendants');
  assert.notEqual(tree.props.accessibilityElementsHidden, true);
  assert.equal(nodes(tree, 'AnimatedView').length, 1, 'only the scale wrapper is rendered');
  assert.equal(flatten(tree.props.style).borderWidth, undefined);
  assert.equal(flatten(tree.props.style).borderColor, undefined);
  assert.equal(h.active().length, 0, 'motion preference is initially unknown');
  assert.equal(h.values[0].value, 0);
});

test('pulse gently changes scale without exceeding the existing column', async () => {
  const h = host(), tree = h.render(); h.queries[0].resolve(false); await tick();
  assert.equal(h.active().length, 1);
  const style = flatten(tree.props.style), scale = style.transform[0].scale;
  assert.equal(style.width, '100%');
  assert.equal(scale.value, h.values[0]);
  const range = Array.from(scale.config.outputRange);
  assert.equal(range[0], 1, 'rest and reduced-motion states use the full-size button');
  assert.ok(range.every(value => value >= 0.97 && value <= 1), 'animated paint stays inside the column and preserves a 48dp touch target');
  const steps = h.active()[0].animation.steps;
  assert.ok(steps.every(step => step.options.useNativeDriver && !step.options.isInteraction));
  assert.ok(steps.some(step => step.options.duration >= 1000));
  assert.ok(steps.some(step => step.options.duration === 0 && step.options.delay >= 1000));
  h.render(); h.render(); assert.equal(h.loops.length, 1);
});

test('reduced motion and failed preference lookup leave the button at its resting size', async () => {
  for (const outcome of ['reduced', 'reject', 'throws']) {
    const h = host({ queryThrows: outcome === 'throws' }); h.render();
    if (outcome === 'reduced') h.queries[0].resolve(true);
    if (outcome === 'reject') h.queries[0].reject(Error('Unavailable'));
    await tick(); assert.equal(h.active().length, 0); assert.equal(h.values[0].value, 0);
  }
});

test('newer motion preferences override delayed lookups and reset the pulse', async () => {
  const h = host(); h.render(); h.event('motion:reduceMotionChanged', true);
  h.queries[0].resolve(false); await tick(); assert.equal(h.active().length, 0);
  h.event('motion:reduceMotionChanged', false); assert.equal(h.active().length, 1);
  h.event('motion:reduceMotionChanged', true); assert.equal(h.active().length, 0);
  assert.equal(h.values[0].value, 0);
});

test('leaving the screen or backgrounding stops the pulse and retired callbacks cannot restart it', async () => {
  const h = host(); h.render(); h.queries[0].resolve(false); await tick();
  h.event('app:change', 'background'); assert.equal(h.active().length, 0);
  h.event('app:change', 'active'); assert.equal(h.active().length, 1);
  h.focus(false); assert.equal(h.active().length, 0);
  h.focus(true); h.queries.at(-1).resolve(false); await tick(); assert.equal(h.active().length, 1);
  h.unmount(); h.event('app:change', 'active'); assert.equal(h.active().length, 0);
  assert.equal(h.values[0].value, 0);
  assert.ok([...h.listeners.values()].every(set => set.size === 0));
  const pending = host(); pending.render(); pending.unmount(); pending.queries[0].resolve(false); await tick();
  assert.equal(pending.active().length, 0);
});
