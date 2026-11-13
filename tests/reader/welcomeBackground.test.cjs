const assert = require('node:assert/strict');
const test = require('node:test');
const { welcomeMotionHost, nodes } = require('../fixtures/welcomeMotionHost.cjs');
const host = options => welcomeMotionHost({ screen: 'screens/WelcomeBackground.js', ...options });
const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const tick = () => new Promise(setImmediate);
const entrance = h => h.timings.find(timing => timing.active && timing.options.useNativeDriver);
async function allow(h) { h.queries.at(-1).resolve(false); await tick(); }

test('curtain stays behind the controls and outside accessibility, with no motion before the preference resolves', () => {
  const h = host(), tree = h.render();
  assert.equal(tree.props.pointerEvents, 'none');
  assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(nodes(tree, 'Text').length, 0);
  assert.equal(h.values.length, 2, 'opening and focus use independent values');
  assert.equal(h.active().length, 0);
  assert.ok(h.timings.every(timing => !timing.active));
  const panels = nodes(tree, 'AnimatedView').filter(node => /curtain-panel-/.test(node.props.testID));
  assert.equal(panels.length, 2);
  assert.ok(panels.every(panel => nodes(panel, 'View').length >= 6), 'folded fabric replaces the floating shapes');
});

test('curtain opens once before gentle focus changes, without moving page layout', async () => {
  const h = host(); h.render(); await allow(h);
  const opening = entrance(h);
  assert.ok(opening);
  assert.equal(opening.value, h.values[0]);
  assert.equal(opening.options.toValue, 1);
  assert.equal(opening.options.isInteraction, false);
  assert.equal(h.active().length, 0, 'blur waits for the opening to settle');
  opening.finish();
  assert.equal(h.active().length, 1);
  const loop = h.active()[0];
  assert.ok(loop.animation.steps.every(step => step.value === h.values[1]));
  assert.ok(loop.animation.steps.every(step => !step.options.useNativeDriver && !step.options.isInteraction));
  assert.ok(loop.animation.steps.some(step => step.options.duration === 0 && step.options.delay > 0));
  h.render(); h.render();
  assert.equal(h.loops.length, 1);
  assert.equal(h.timings.filter(timing => timing.options.useNativeDriver).length, 1);
});

test('opening is symmetric and responsive, while resizing does not replay it', async () => {
  const h = host({ width: 300 }); h.render(); await allow(h); entrance(h).finish();
  for (const width of [300, 480]) {
    const tree = h.resize(width);
    const panels = nodes(tree, 'AnimatedView').filter(node => /curtain-panel-/.test(node.props.testID));
    const offsets = panels.map(panel => flatten(panel.props.style).transform[0].translateX);
    for (let index = 0; index < panels.length; index++) {
      const panelWidth = parseFloat(flatten(panels[index].props.style).width) / 100 * width;
      const visibleWidth = panelWidth - Math.abs(offsets[index].config.outputRange[1]);
      assert.ok(visibleWidth >= width * 0.18 && visibleWidth <= width * 0.21, 'open curtains retain wider side panels');
    }
    assert.ok(offsets.every(offset => offset.value === h.values[0]));
    assert.equal(offsets[0].config.outputRange[0], 0);
    assert.equal(offsets[1].config.outputRange[0], 0);
    assert.equal(offsets[0].config.outputRange[1], -offsets[1].config.outputRange[1]);
    assert.ok(offsets[1].config.outputRange[1] > width * 0.3 && offsets[1].config.outputRange[1] < width * 0.5);
    assert.equal(h.values[0].value, 1);
  }
  assert.equal(h.timings.filter(timing => timing.options.useNativeDriver).length, 1);
});

test('the closed curtain panels meet exactly at the center without overlap', () => {
  for (const width of [300, 343, 412, 768]) {
    const tree = host({ width }).render();
    const panels = nodes(tree, 'AnimatedView').filter(node => /curtain-panel-/.test(node.props.testID));
    const sizes = panels.map(panel => parseFloat(flatten(panel.props.style).width) / 100 * width);
    assert.equal(sizes[0], width / 2);
    assert.equal(sizes[1], width / 2);
    assert.equal(sizes[0], width - sizes[1]);
  }
});

test('returning to a retained account scene opens from covered without an already-open frame', async () => {
  const h = host(); h.render({ reopenOnFocus: true }); await allow(h); entrance(h).finish();
  h.focus(false);
  assert.equal(h.values[0].value, 0, 'the hidden route waits covered');
  h.focus(true);
  assert.equal(h.values[0].value, 0);
  await allow(h);
  assert.equal(entrance(h).options.toValue, 1);
  entrance(h).finish();
  assert.equal(h.values[0].value, 1);
});

test('the curtain softens directly in a padded layer without overlapping opacity fades', () => {
  const h = host(), tree = h.render();
  const field = nodes(tree, 'AnimatedView').find(node => node.props.testID === 'welcome-curtain-focus');
  assert.ok(field);
  const style = flatten(field.props.style);
  assert.equal(style.filter.value, h.values[1]);
  assert.deepEqual(Array.from(style.filter.config.outputRange), ['blur(0px)', 'blur(6px)']);
  assert.equal(style.opacity, undefined);
  assert.ok(style.top <= -18 && style.left <= -18 && style.right <= -18 && style.bottom <= -18);
});

test('reduced motion and preference lookup failure show a settled open curtain', async () => {
  for (const outcome of ['reduced', 'rejected', 'throws']) {
    const h = host({ queryThrows: outcome === 'throws' }); h.render();
    if (outcome === 'reduced') h.queries[0].resolve(true);
    if (outcome === 'rejected') h.queries[0].reject(Error('Unavailable'));
    await tick();
    assert.equal(h.values[0].value, 1);
    assert.equal(h.values[1].value, 0);
    assert.equal(h.active().length, 0);
    assert.equal(entrance(h), undefined);
  }
});

test('a cancelled entrance and delayed preference cannot restart or close the curtain', async () => {
  const h = host(); h.render(); h.event('motion:reduceMotionChanged', false);
  const opening = entrance(h); assert.ok(opening);
  h.event('motion:reduceMotionChanged', true);
  opening.callback({ finished: true });
  h.queries[0].resolve(false); await tick();
  assert.equal(h.active().length, 0);
  assert.equal(h.values[0].value, 1);
  h.event('motion:reduceMotionChanged', false);
  assert.equal(h.active().length, 1);
  assert.equal(entrance(h), undefined, 'opening is not replayed after a preference change');
});

test('backgrounding, blur and unmount cancel work; returning resumes only focus changes', async () => {
  const h = host(); h.render(); await allow(h); const opening = entrance(h);
  h.event('app:change', 'background'); opening.callback({ finished: true });
  assert.equal(h.active().length, 0);
  assert.equal(h.values[0].value, 1);
  h.event('app:change', 'active'); assert.equal(h.active().length, 1);
  h.focus(false); assert.equal(h.active().length, 0);
  h.focus(true); await allow(h); assert.equal(h.active().length, 1);
  assert.equal(h.timings.filter(timing => timing.options.useNativeDriver).length, 1);
  h.unmount(); h.event('app:change', 'active');
  assert.equal(h.active().length, 0);
  assert.ok([...h.listeners.values()].every(set => set.size === 0));
});

test('unsupported blur platforms retain the curtain opening with a clear static fallback', async () => {
  for (const options of [{ platform: 'ios' }, { api: 30 }, { fabric: false }]) {
    const h = host(options), tree = h.render(); await allow(h); entrance(h).finish();
    assert.equal(nodes(tree, 'AnimatedView').filter(node => flatten(node.props.style).filter).length, 0);
    assert.equal(h.active().length, 0);
    assert.equal(h.values[0].value, 1);
  }
});

test('dark-gradient dithering remains a fixed, faint local texture', () => {
  const h = host(), image = nodes(h.render(), 'Image')[0];
  assert.ok(image.props.source.uri.startsWith('data:image/png;base64,'));
  assert.equal(image.props.resizeMode, 'repeat');
  assert.equal(flatten(image.props.style).opacity, 3 / 255);
});

test('curtain fabric, folds and hems use red tones', () => {
  const tree = host().render();
  const colors = nodes(tree, 'View').map(node => flatten(node.props.style).backgroundColor).filter(Boolean);
  assert.ok(colors.length >= 10, 'fabric retains its folds and edge details');
  for (const color of colors) {
    assert.match(color, /^#[0-9a-f]{6}$/i);
    const [red, green, blue] = color.slice(1).match(/../g).map(channel => parseInt(channel, 16));
    assert.ok(red > green * 1.4 && red > blue * 1.4, 'curtain color is visibly red');
  }
});

test('curtains have soft cast shadows and shaded folds without changing their opening geometry', () => {
  const tree = host().render();
  const panels = nodes(tree, 'AnimatedView').filter(node => /curtain-panel-/.test(node.props.testID));
  const shadows = panels.map(panel => flatten(panel.props.style).boxShadow);
  assert.ok(shadows.every(value => value?.some(shadow => shadow.blurRadius >= 16 && shadow.color.includes('0,0,0'))));
  assert.equal(shadows[0][0].offsetX, -shadows[1][0].offsetX, 'shadows mirror across the stage');
  const folds = nodes(tree, 'View').filter(node => node.props.testID === 'curtain-fold');
  assert.equal(folds.length, 16);
  assert.ok(folds.every(fold => flatten(fold.props.style).experimental_backgroundImage?.includes('rgba(0,0,0,')), 'each fold has soft shadow falloff');
});

test('moonlight is strongest at both upper inner curtain edges and fades to transparent', () => {
  const tree = host().render();
  const lights = nodes(tree, 'View').filter(node => node.props.testID?.startsWith('curtain-moonlight-'));
  assert.equal(lights.length, 2);
  for (const light of lights) {
    const style = flatten(light.props.style);
    assert.equal(style.backgroundColor, undefined, 'no opaque spotlight shape');
    assert.equal(style.top, 0); assert.equal(style.bottom, 0);
    assert.equal(style.left, 0); assert.equal(style.right, 0);
    assert.ok(style.experimental_backgroundImage.startsWith('linear-gradient('));
    assert.ok(style.experimental_backgroundImage.includes('rgba(221,213,235,0)'));
    assert.ok(style.experimental_backgroundImage.includes(light.props.testID.endsWith('left') ? '225deg' : '135deg'));
  }
});

test('web uses CSS gradients while legacy native targets retain the red fabric fallback', () => {
  const web = host({ platform: 'web' }).render();
  const webLights = nodes(web, 'View').filter(node => node.props.testID?.startsWith('curtain-moonlight-'));
  assert.equal(webLights.length, 2);
  assert.ok(webLights.every(light => flatten(light.props.style).backgroundImage?.startsWith('linear-gradient(')));
  assert.ok(nodes(web, 'View').every(node => !flatten(node.props.style).experimental_backgroundImage));
  const legacy = host({ fabric: false }).render();
  assert.ok(nodes(legacy, 'View').every(node => !flatten(node.props.style).experimental_backgroundImage));
  assert.equal(nodes(legacy, 'View').filter(node => node.props.testID?.startsWith('curtain-moonlight-')).length, 0);
});

test('account navigation waits until both curtains cover the scene and fires once', async () => {
  const h = host(), calls = [];
  h.render(); await allow(h); entrance(h).finish();
  h.render({ closing: true, onClosed: () => calls.push('covered') });
  await allow(h);
  const closing = entrance(h);
  assert.ok(closing);
  assert.equal(closing.options.toValue, 0);
  assert.equal(h.active().length, 0, 'blur pauses while covering the scene');
  assert.deepEqual(calls, []);
  closing.finish();
  assert.equal(h.values[0].value, 0);
  assert.deepEqual(calls, ['covered']);
  closing.callback({ finished: true });
  h.render();
  assert.deepEqual(calls, ['covered']);
});

test('leaving during a curtain close cancels account navigation and ignores its late callback', async () => {
  for (const action of ['blur', 'unmount']) {
    const h = host(), calls = [];
    h.render({ closing: true, onClosed: () => calls.push('covered') }); await allow(h);
    const closing = entrance(h);
    if (action === 'blur') h.focus(false); else h.unmount();
    closing.callback({ finished: true });
    assert.deepEqual(calls, []);
    assert.equal(closing.active, false);
  }
});

test('reduced motion completes account navigation without a closing animation', async () => {
  const h = host(), calls = [];
  h.render({ closing: true, onClosed: () => calls.push('covered') });
  h.queries[0].resolve(true); await tick();
  assert.deepEqual(calls, ['covered']);
  assert.equal(entrance(h), undefined);
  assert.equal(h.values[0].value, 0);
});

test('account curtains keep the welcome geometry and can use warm sunlight', () => {
  const h = host(), tree = h.render({ light: 'sun' });
  const panels = nodes(tree, 'AnimatedView').filter(node => /curtain-panel-/.test(node.props.testID));
  const panel = flatten(panels[1].props.style);
  const openWidth = parseFloat(panel.width) / 100 * 412 - panel.transform[0].translateX.config.outputRange[1];
  assert.ok(Math.abs(openWidth - 412 * 0.19) < 0.001, 'the opened curtain keeps its approved width');
  const lights = nodes(tree, 'View').filter(node => node.props.testID?.startsWith('curtain-moonlight-'));
  assert.ok(lights.every(node => flatten(node.props.style).experimental_backgroundImage.includes('245,211,143')));
});
