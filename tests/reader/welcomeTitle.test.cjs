const assert = require('node:assert/strict');
const test = require('node:test');
const { welcomeMotionHost: host, nodes, text } = require('../fixtures/welcomeMotionHost.cjs');
const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

test('BARD is a stationary, accessible thin wordmark with system text scaling', () => {
  const h = host(), tree = h.render(), title = nodes(tree, 'Text')[0];
  assert.equal(text(tree), 'BARD');
  assert.equal(title.props.accessibilityRole, 'header');
  assert.equal(title.props.allowFontScaling, true);
  assert.equal(title.props.numberOfLines, 1);
  assert.equal(title.props.adjustsFontSizeToFit, true);
  assert.ok(title.props.minimumFontScale <= 0.6, 'title can fit narrow columns at enlarged system text');
  assert.equal(flatten(title.props.style).width, '100%');
  assert.equal(flatten(title.props.style).textAlign, 'center');
  assert.equal(flatten(title.props.style).fontWeight, '100');
  assert.equal(flatten(title.props.style).fontFamily, 'sans-serif-thin');
  assert.equal(flatten(title.props.style).transform, undefined);
  assert.equal(flatten(title.props.style).textShadowRadius, undefined);
  assert.equal(nodes(tree, 'AnimatedView').length, 0);
});

test('rerenders, focus and motion preferences cannot start title movement', () => {
  const h = host(); h.render(); h.render(); h.focus(false); h.focus(true);
  h.event('motion:reduceMotionChanged', false); h.event('motion:reduceMotionChanged', true);
  h.event('app:change', 'background'); h.event('app:change', 'active'); h.unmount();
  assert.equal(h.values.length, 0);
  assert.equal(h.loops.length, 0);
  assert.equal(h.queries.length, 0);
});

test('the thin title has platform font fallbacks without loading a new font asset', () => {
  for (const platform of ['ios', 'web']) {
    const h = host({ platform }), title = nodes(h.render(), 'Text')[0];
    assert.equal(flatten(title.props.style).fontWeight, '100');
    assert.equal(flatten(title.props.style).fontFamily, platform === 'ios' ? 'System' : 'system-ui');
    assert.equal(h.values.length, 0);
  }
});
