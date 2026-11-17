const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { synopsisUIHost, nodes, text } = require('../fixtures/synopsisUIHost.cjs');

const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const frame = tree => nodes(tree, 'View').find(node => node.props.pointerEvents === 'none');
const image = tree => nodes(tree, 'Image')[0];
const loading = tree => nodes(tree, 'ActivityIndicator').length;
// Speculative renders share refs, but discard their memo/effect slots at cancellation.
function posterHost(initial = {}) {
  let props = { source: { uri: 'https://example.test/hamlet.jpg' }, style: { width: 86, height: 112 }, ...initial };
  let committed = [], work, cursor, effects, now = 0, nextTimerId = 1, stateUpdates = 0;
  const timers = new Map(), scheduled = [];
  const setTimeout = (callback, delay) => {
    const timer = { id: nextTimerId++, callback, delay, at: now + delay };
    timers.set(timer.id, timer); scheduled.push(timer); return timer.id;
  };
  const clearTimeout = id => { timers.delete(id); };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!work[index] || !same(work[index].deps, deps)) work[index] = { value: factory(), deps };
    return work[index].value;
  };
  const effect = (setup, deps) => {
    const index = cursor++, previous = work[index];
    if (!previous || !same(previous.deps, deps)) effects.push(() => {
      previous?.cleanup?.(); work[index] = { deps, cleanup: setup() };
    });
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useMemo: memo, useRef: value => memo(() => ({ current: value }), []), useEffect: effect, useLayoutEffect: effect,
    useState(initial) {
      const slot = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [slot.value, next => { stateUpdates++; slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
  };
  const native = Object.fromEntries(['View', 'Image', 'Text', 'ActivityIndicator'].map(name => [name, name]));
  native.StyleSheet = { create: value => value };
  const code = babel.transformFileSync(path.resolve(__dirname, '../../shared/PosterImage.js'), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,setTimeout,clearTimeout){' + code + '\n})')(name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === './editorialTheme') return require('../../shared/editorialTheme');
    throw Error('Unexpected poster dependency ' + name);
  }, module, module.exports, setTimeout, clearTimeout);
  function render(nextProps, commit = true) {
      work = committed.slice(); cursor = 0; effects = [];
      const tree = module.exports.default(nextProps);
      if (commit) { props = nextProps; committed = work; effects.forEach(run => run()); }
      return tree;
  }
  const h = {
    scheduled,
    get pendingTimers() { return timers.size; },
    get stateUpdates() { return stateUpdates; },
    render: () => render(props),
    update: next => render({ ...props, ...next }),
    speculate: next => render({ ...props, ...next }, false),
    unmount() { committed.forEach(slot => slot?.cleanup?.()); },
    advance(milliseconds) {
      const target = now + milliseconds;
      let timer;
      while ((timer = [...timers.values()].sort((a, b) => a.at - b.at)[0]) && timer.at <= target) {
        now = timer.at; timers.delete(timer.id); timer.callback(); h.render();
      }
      now = target;
      return h.render();
    },
  };
  return h;
}

test('shared play rows retain their poster dimensions and navigation state during loading', () => {
  const source = { uri: 'https://example.test/hamlet.jpg' };
  const h = synopsisUIHost({ screen: 'shared/EditorialUI.js', exportName: 'EditorialPlayRow', props: {
    play: { name: 'Hamlet', genre: 'Tragedy', mainImage: source }, disabled: true, onPress() {},
  } });
  const tree = h.render();
  assert.equal(loading(tree), 1, 'a pending row poster has a visible native loading indicator');
  assert.equal(image(tree).props.source, source);
  assert.equal(image(tree).props.resizeMode, 'cover');
  assert.equal(image(tree).props.resizeMethod, 'resize');
  assert.equal(flatten(frame(tree).props.style).width, 86);
  assert.equal(flatten(frame(tree).props.style).height, 112);
  const row = nodes(tree, 'Pressable')[0];
  assert.equal(row.props.disabled, true);
  assert.equal(row.props.onPress, undefined);
  assert.match(text(tree), /Hamlet/);
});

test('a pending poster keeps its image mounted inside a stable decorative frame', () => {
  const h = posterHost();
  const tree = h.render();
  assert.equal(loading(tree), 1);
  assert.equal(nodes(tree, 'ActivityIndicator')[0].props.size, 'small');
  assert.equal(nodes(tree, 'ActivityIndicator')[0].props.accessible, false);
  assert.equal(frame(tree).props.accessible, false);
  assert.equal(frame(tree).props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(flatten(frame(tree).props.style).overflow, 'hidden');
  assert.equal(image(tree).props.accessible, false);
  const imageStyle = flatten(image(tree).props.style);
  assert.equal(imageStyle.width, '100%');
  assert.equal(imageStyle.height, '100%');
  assert.equal(imageStyle.position, 'absolute');
});

test('a cached image can finish directly through onLoad without a preceding start event', () => {
  const loads = [];
  const h = posterHost({ onLoad: event => loads.push(event) });
  const initial = h.render();
  const pending = image(initial);
  const event = { nativeEvent: { source: { width: 600, height: 800 } } };
  pending.props.onLoad(event);
  const ready = h.render();
  assert.equal(loading(ready), 0);
  assert.equal(nodes(ready, 'Image').length, 1);
  assert.deepEqual(loads, [event]);
  assert.equal(nodes(ready, 'Text').length, 0);
  assert.deepEqual(flatten(frame(ready).props.style), flatten(frame(initial).props.style));
});

test('load end alone cannot reveal an image that has not reported success', () => {
  let ended = 0;
  const h = posterHost({ onLoadEnd() { ended++; } });
  image(h.render()).props.onLoadEnd();
  assert.equal(ended, 1);
  assert.equal(loading(h.render()), 1);
});

test('exhausted image retries stop the spinner and leave a readable static fallback in the same frame', () => {
  const failures = [];
  const h = posterHost({ onError: event => failures.push(event) });
  const pending = h.render();
  const event = { nativeEvent: { error: 'Artwork could not be decoded' } };
  image(pending).props.onError(event);
  image(h.advance(500)).props.onError(event);
  image(h.advance(1500)).props.onError(event);
  const failed = h.render();
  assert.equal(loading(failed), 0);
  assert.match(text(failed), /Artwork unavailable/);
  assert.equal(nodes(failed, 'Text')[0].props.allowFontScaling, true);
  assert.deepEqual(flatten(frame(failed).props.style), flatten(frame(pending).props.style));
  assert.equal(nodes(failed, 'Image').length, 1);
  assert.deepEqual(failures, [event, event, event]);
  assert.equal(frame(failed).props.accessible, false, 'decorative artwork adds no duplicate row announcement');
});

test('replacing a successful source immediately restores loading without changing the frame', () => {
  const h = posterHost();
  image(h.render()).props.onLoad({});
  const ready = h.render();
  assert.equal(loading(ready), 0);
  const replacement = { uri: 'https://example.test/lear.jpg' };
  const next = h.update({ source: replacement });
  assert.equal(loading(next), 1);
  assert.equal(image(next).props.source, replacement);
  assert.deepEqual(flatten(frame(next).props.style), flatten(frame(ready).props.style));
});

test('late success and error callbacks cannot settle a replacement or a later reuse of the same URI', () => {
  const calls = [];
  const a = { uri: 'https://example.test/hamlet.jpg' };
  const h = posterHost({ source: a, onLoad: () => calls.push('load'), onError: () => calls.push('error') });
  const first = image(h.render()).props;
  const second = image(h.update({ source: { uri: 'https://example.test/lear.jpg' } })).props;
  first.onLoad({}); first.onError({});
  assert.equal(loading(h.render()), 1);
  assert.deepEqual(calls, []);
  const third = image(h.update({ source: { ...a } })).props;
  first.onLoad({}); first.onError({}); second.onError({}); second.onLoad({});
  assert.equal(loading(h.render()), 1);
  assert.deepEqual(calls, []);
  third.onLoad({});
  assert.equal(loading(h.render()), 0);
  assert.deepEqual(calls, ['load']);
});

test('a new object for the unchanged source does not restart a completed load', () => {
  const h = posterHost();
  image(h.render()).props.onLoad({});
  assert.equal(loading(h.render()), 0);
  assert.equal(loading(h.update({ source: { uri: 'https://example.test/hamlet.jpg' } })), 0);
});

test('missing sources terminate in a fallback instead of an endless loading spinner', () => {
  for (const source of [null, undefined, false, { uri: '' }, []]) {
    const tree = posterHost({ source }).render();
    assert.equal(loading(tree), 0);
    assert.equal(nodes(tree, 'Image').length, 0);
    assert.match(text(tree), /Artwork unavailable/);
  }
});

test('opted-in image accessibility exposes loading and a concise error label', () => {
  const h = posterHost({ accessible: true, accessibilityLabel: 'Hamlet poster', fallbackLabel: 'Cover unavailable' });
  const pending = h.render();
  assert.equal(frame(pending).props.accessibilityRole, 'image');
  assert.equal(frame(pending).props.accessibilityLabel, 'Hamlet poster');
  assert.equal(frame(pending).props.accessibilityState.busy, true);
  image(pending).props.onError({});
  assert.equal(frame(h.render()).props.accessibilityState.busy, true, 'recovery remains busy');
  image(h.advance(500)).props.onError({});
  image(h.advance(1500)).props.onError({});
  const failed = h.render();
  assert.equal(frame(failed).props.accessibilityState.busy, false);
  assert.equal(frame(failed).props.accessibilityLabel, 'Cover unavailable');
  assert.match(text(failed), /Cover unavailable/);
});

test('an aspect-ratio frame preserves its caller layout and original image source', () => {
  const source = 42;
  const h = posterHost({ source, style: [{ width: '100%', aspectRatio: 0.75 }, { borderRadius: 9 }], resizeMode: 'contain' });
  const tree = h.render();
  const style = flatten(frame(tree).props.style);
  assert.equal(style.width, '100%');
  assert.equal(style.aspectRatio, 0.75);
  assert.equal(style.height, undefined);
  assert.equal(style.borderRadius, 9);
  assert.equal(image(tree).props.source, source);
  assert.equal(image(tree).props.resizeMode, 'contain');
});

test('unmounted posters ignore native callbacks that arrive after removal', () => {
  let settled = 0;
  const h = posterHost({ onLoad: () => settled++, onError: () => settled++ });
  const pending = image(h.render()).props;
  h.unmount();
  pending.onLoad({}); pending.onError({});
  assert.equal(settled, 0);
});

test('native failure retries twice with fresh request keys and keeps loading until final failure', () => {
  const h = posterHost();
  const original = h.render(), first = image(original).props;
  first.onError({ nativeEvent: { error: 'Connection interrupted' } });
  assert.equal(loading(h.render()), 1, 'a recoverable native failure retains the spinner');
  assert.equal(nodes(h.render(), 'Text').length, 0);
  assert.equal(h.pendingTimers, 1);
  assert.equal(image(h.advance(499)).props.key, first.key);
  const second = image(h.advance(1)).props;
  assert.notEqual(second.key, first.key, 'the first retry mounts a fresh native image');
  assert.equal(second.source, first.source);
  second.onError({});
  assert.equal(loading(h.render()), 1);
  assert.equal(image(h.advance(1499)).props.key, second.key);
  const third = image(h.advance(1)).props;
  assert.notEqual(third.key, second.key);
  third.onError({});
  const failed = h.render();
  assert.equal(loading(failed), 0);
  assert.match(text(failed), /Artwork unavailable/);
  assert.equal(h.pendingTimers, 0);
  assert.equal(image(h.advance(10000)).props.key, third.key, 'final failure starts no further request');
  assert.equal(h.scheduled.length, 2);
  assert.deepEqual(flatten(frame(failed).props.style), flatten(frame(original).props.style));
});

test('a successful retry reveals its image and rejects prior-attempt load, error and end callbacks', () => {
  const calls = [];
  const h = posterHost({ onLoad: () => calls.push('load'), onError: () => calls.push('error'), onLoadEnd: () => calls.push('end') });
  const first = image(h.render()).props;
  first.onError({}); first.onError({}); first.onLoad({}); first.onLoadEnd();
  assert.equal(h.pendingTimers, 1, 'duplicate failure events cannot schedule extra retries');
  assert.deepEqual(calls, ['error']);
  const retry = image(h.advance(500)).props;
  first.onLoad({}); first.onError({}); first.onLoadEnd();
  assert.equal(loading(h.render()), 1);
  assert.deepEqual(calls, ['error']);
  retry.onLoad({}); retry.onLoadEnd(); retry.onError({});
  assert.equal(loading(h.render()), 0);
  assert.deepEqual(calls, ['error', 'load', 'end']);
  assert.equal(h.pendingTimers, 0);
  assert.equal(image(h.advance(10000)).props.key, retry.key);
});

test('source replacement cancels pending retries and gives the replacement a fresh retry budget', () => {
  const h = posterHost();
  const first = image(h.render()).props;
  first.onError({});
  const canceled = h.scheduled[0];
  const replacement = image(h.update({ source: { uri: 'https://example.test/lear.jpg' } })).props;
  assert.equal(h.pendingTimers, 0);
  canceled.callback();
  assert.equal(image(h.advance(2000)).props.key, replacement.key);
  first.onLoad({}); first.onError({});
  assert.equal(loading(h.render()), 1);
  replacement.onError({});
  assert.notEqual(image(h.advance(500)).props.key, replacement.key, 'replacement starts at the first retry delay');
});

test('unmount cancels recovery and ignores even an already-queued timer callback', () => {
  const h = posterHost();
  const first = image(h.render()).props;
  first.onError({});
  const pending = h.scheduled[0];
  h.unmount();
  const updates = h.stateUpdates;
  assert.equal(h.pendingTimers, 0);
  pending.callback(); first.onLoad({}); first.onError({});
  assert.equal(h.stateUpdates, updates);
});

test('an abandoned source change does not cancel recovery for the committed poster', () => {
  const h = posterHost();
  const first = image(h.render()).props;
  first.onError({});
  h.render();
  h.speculate({ source: { uri: 'https://example.test/lear.jpg' } });
  assert.equal(h.pendingTimers, 1);
  const retry = image(h.advance(500)).props;
  assert.equal(retry.source, first.source);
  assert.notEqual(retry.key, first.key);
  retry.onLoad({});
  assert.equal(loading(h.render()), 0);
});

test('an abandoned source render cannot discard load events from the committed native image', () => {
  const source = { uri: 'https://example.test/hamlet.jpg' };
  for (const outcome of ['onLoad', 'onError']) {
    const h = posterHost({ source });
    const committedImage = image(h.render());
    h.speculate({ source: { uri: 'https://example.test/lear.jpg' } });
    committedImage.props[outcome]({});
    if (outcome === 'onError') {
      assert.equal(h.pendingTimers, 1, 'the committed image error starts recovery despite the canceled update');
      image(h.advance(500)).props.onLoad({});
    }
    assert.equal(loading(h.render()), 0, `${outcome} from the committed image survives a canceled update`);
  }
});
