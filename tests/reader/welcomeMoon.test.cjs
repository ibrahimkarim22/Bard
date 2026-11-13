const assert = require('node:assert/strict');
const test = require('node:test');
const { welcomeMotionHost, nodes } = require('../fixtures/welcomeMotionHost.cjs');
const host = options => welcomeMotionHost({ screen: 'screens/WelcomeMoon.js', ...options });
const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const tick = () => new Promise(setImmediate);

test('a full moon hangs from its center without a crescent cutout or touch/accessibility interception', () => {
  const h = host(), tree = h.render();
  assert.equal(tree.props.pointerEvents, 'none');
  assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(nodes(tree, 'Image').length, 0);
  assert.equal(nodes(tree, 'Text').length, 0);
  const discNode = nodes(tree, 'View').find(node => node.props.testID === 'welcome-moon-disc');
  const disc = flatten(discNode.props.style);
  const string = flatten(nodes(tree, 'View').find(node => node.props.testID === 'welcome-moon-string').props.style);
  assert.equal(disc.width, disc.height);
  assert.equal(disc.borderRadius, disc.width / 2);
  assert.equal(disc.overflow, 'hidden');
  assert.equal(string.left + string.width / 2, disc.width / 2, 'the full moon hangs from its center');
  assert.ok(string.height >= disc.top && string.height <= disc.top + disc.width * 0.2);
  for (const child of nodes(discNode, 'View').filter(node => node !== discNode)) {
    const patch = flatten(child.props.style);
    assert.notEqual(patch.backgroundColor, '#0e0c20', 'no background-colored crescent mask');
    assert.ok(patch.width <= disc.width * 0.3, 'surface detail does not remove the full disc');
  }
});

test('stars and their hanging strings are removed from the welcome background', () => {
  const h = host(), tree = h.render();
  const stars = nodes(tree, 'Icon').filter(node => node.props.testID === 'welcome-hanging-star');
  const hangers = nodes(tree, 'View').filter(node => node.props.testID?.startsWith('welcome-star-hanger-'));
  assert.equal(stars.length, 0);
  assert.equal(hangers.length, 0);
  assert.equal(nodes(tree, 'View').filter(node => node.props.testID?.startsWith('welcome-star-string-')).length, 0);
});

test('moon is larger at normal and enlarged text sizes without touching the curtain edge', () => {
  for (const options of [{}, { width: 300, height: 600, fontScale: 1.5 }]) {
    const h = host(options), tree = h.render(), width = options.width ?? 412;
    const disc = flatten(nodes(tree, 'View').find(node => node.props.testID === 'welcome-moon-disc').props.style);
    const hanger = flatten(nodes(tree, 'View').find(node => node.props.testID === 'welcome-moon-hanger').props.style);
    assert.equal(hanger.left + hanger.width / 2, width / 2, 'moon is horizontally centered');
    assert.ok(disc.width >= (options.fontScale ? 36 : 64), 'enlarged from the previous 30/44dp moon');
    assert.ok(hanger.left >= width * 0.19 + 5);
    assert.ok(hanger.left + hanger.width + 5 <= width * 0.81, 'moon and blur remain within the open curtains');
  }
});

test('moon has a soft halo with room for its falloff rather than a second solid disc', () => {
  const h = host(), tree = h.render();
  const halo = nodes(tree, 'View').find(node => node.props.testID === 'welcome-moon-halo');
  assert.ok(halo);
  const style = flatten(halo.props.style);
  assert.equal(style.backgroundColor, undefined);
  assert.ok(style.boxShadow.some(shadow => shadow.blurRadius >= 24 && shadow.spreadDistance <= 8));
  const field = flatten(nodes(tree, 'AnimatedView')[0].props.style);
  assert.ok(field.top <= -64 && field.left <= -64 && field.right <= -64 && field.bottom <= -64, 'halo and blur are not cropped by their local layer');
});

test('moon blur starts independently before the curtain entrance completes, on a different cycle', async () => {
  const moon = host(), curtain = welcomeMotionHost({ screen: 'screens/WelcomeBackground.js' });
  moon.render(); curtain.render();
  moon.queries[0].resolve(false); curtain.queries[0].resolve(false); await tick();
  assert.equal(moon.active().length, 1);
  assert.equal(curtain.active().length, 0, 'curtain is still opening');
  const moonLoop = moon.active()[0];
  curtain.timings.find(timing => timing.active).finish();
  const curtainLoop = curtain.active()[0];
  const period = loop => loop.animation.steps.reduce((sum, step) => sum + step.options.duration + (step.options.delay || 0), 0);
  assert.notEqual(period(moonLoop), period(curtainLoop));
  assert.equal(moon.values.length, 1);
  assert.ok(moonLoop.animation.steps.every(step => step.value === moon.values[0] && !step.options.useNativeDriver && !step.options.isInteraction));
  assert.ok(moonLoop.animation.steps[0].options.delay > 0, 'moon has its own entry offset');
  moon.render(); moon.render();
  assert.equal(moon.loops.length, 1, 'rerenders preserve the independent loop');
});

test('moon animates only its padded blur, leaving its position and opacity stable', () => {
  const h = host(), tree = h.render();
  const style = flatten(nodes(tree, 'AnimatedView')[0].props.style);
  assert.equal(style.filter.value, h.values[0]);
  assert.deepEqual(Array.from(style.filter.config.outputRange), ['blur(0px)', 'blur(5px)']);
  assert.equal(style.opacity, undefined);
  assert.equal(style.transform, undefined);
  assert.ok(style.top <= -15 && style.left <= -15 && style.right <= -15 && style.bottom <= -15);
});

test('compact screens, enlarged text and large safe insets keep the moon above the title', () => {
  for (const options of [{ width: 300, height: 600 }, { fontScale: 1.5 }, { width: 343, height: 610, fontScale: 1.5, safeTop: 32 }, { width: 412, height: 820, safeTop: 80, fontScale: 1.2 }]) {
    const h = host(options), tree = h.render(), anchor = flatten(tree.props.style), safeTop = options.safeTop ?? 24;
    assert.ok(anchor.top >= safeTop);
    assert.ok(anchor.top + anchor.height <= safeTop + 56, 'ornament stays in the top padding region');
    const width = options.width ?? 412;
    const hangers = nodes(tree, 'View').filter(node => node.props.testID === 'welcome-moon-hanger' || node.props.testID?.startsWith('welcome-star-hanger-'));
    assert.equal(hangers.length, 1);
    for (const hanger of hangers) {
      const bounds = flatten(hanger.props.style);
      assert.ok(bounds.left >= width * 0.19 && bounds.left + bounds.width <= width * 0.81, 'ornament is within the curtain opening');
      assert.ok(bounds.top + bounds.height <= anchor.height, 'padded blur contains the full ornament');
    }
  }
});

test('reduced motion and failed preference lookup leave a clear static moon', async () => {
  for (const outcome of ['reduced', 'reject', 'throws']) {
    const h = host({ queryThrows: outcome === 'throws' }); h.render();
    if (outcome === 'reduced') h.queries[0].resolve(true);
    if (outcome === 'reject') h.queries[0].reject(Error('Unavailable'));
    await tick();
    assert.equal(h.active().length, 0);
    assert.equal(h.values[0].value, 0);
  }
});

test('moon work stops on background, blur and unmount, and ignores retired callbacks', async () => {
  const h = host(); h.render(); h.queries[0].resolve(false); await tick();
  h.event('app:change', 'background'); assert.equal(h.active().length, 0);
  h.event('app:change', 'active'); assert.equal(h.active().length, 1);
  h.focus(false); assert.equal(h.active().length, 0);
  h.focus(true); h.event('motion:reduceMotionChanged', true);
  h.queries.at(-1).resolve(false); await tick(); assert.equal(h.active().length, 0);
  h.event('motion:reduceMotionChanged', false); assert.equal(h.active().length, 1);
  h.unmount(); h.event('app:change', 'active'); assert.equal(h.active().length, 0);
  assert.ok([...h.listeners.values()].every(set => set.size === 0));
});

test('unsupported blur targets still show the full moon without stars or animation', () => {
  for (const options of [{ platform: 'ios' }, { api: 30 }, { fabric: false }]) {
    const h = host(options), tree = h.render();
    assert.equal(nodes(tree, 'AnimatedView').length, 0);
    assert.ok(nodes(tree, 'View').some(node => node.props.testID === 'welcome-moon-disc'));
    assert.equal(nodes(tree, 'Icon').length, 0);
    assert.equal(h.queries.length, 0);
    assert.equal(h.active().length, 0);
  }
});

test('account scenes show a crescent at login and a warm sun at signup', () => {
  const crescent = host().render({ phase: 'crescent' });
  assert.equal(nodes(crescent, 'View').filter(node => node.props.testID === 'welcome-moon-crescent-cutout').length, 1);
  const sun = host().render({ phase: 'sun' });
  const disc = nodes(sun, 'View').find(node => node.props.testID === 'welcome-sun-disc');
  assert.ok(disc);
  assert.equal(flatten(disc.props.style).backgroundColor, '#f1cf82');
  assert.equal(nodes(sun, 'View').filter(node => node.props.testID === 'welcome-moon-disc').length, 0);
  assert.equal(nodes(sun, 'View').filter(node => node.props.testID === 'welcome-moon-crescent-cutout').length, 0);
  assert.equal(nodes(disc, 'View').length, 1, 'the sun has no lunar craters');
});
