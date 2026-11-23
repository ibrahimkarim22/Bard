const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

const plays = Array.from({ length: 39 }, (_, index) => ({ id: `play-${index + 1}`, name: `Play ${index + 1}`, difficulty: index + 1 }));
const owner = { uid: 'reader', generation: 2 };
const event = (level = 1) => ({ id: `unlock-${level}`, fromPlayId: `play-${level}`, toPlayId: `play-${level + 1}`, owner });
const tick = () => new Promise(resolve => setImmediate(resolve));

function host({ request = event(), level = 1, motion = false, arrivalReady = true, appState = 'active', confirmScroll = true, autoPrepare = true } = {}) {
  const slots = [], timers = new Map(), animations = [], scrolls = [], clears = [], consumed = [], announcements = [], listeners = new Map();
  let cursor = 0, dirty = false, effects = [], serial = 0, focused = true;
  let progress = { status: 'ready', completedLevel: level, owner };
  let resolveMotion;
  const preference = new Promise(resolve => { resolveMotion = resolve; });
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const React = {
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps), useRef: initial => memo(() => ({ current: initial }), []),
    useState(initial) {
      const slot = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; dirty = true; }];
    },
    useEffect(setup, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) effects.push(() => {
        slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() };
      });
    },
  };
  const listen = prefix => (name, fn) => { const key = `${prefix}:${name}`; listeners.set(key, fn); return { remove: () => listeners.delete(key) }; };
  const native = {
    Animated: {
      Value: class {
        constructor(value) { this.value = value; this.listeners = new Map(); this.serial = 0; }
        setValue(value) { this.value = value; this.listeners.forEach(fn => fn({ value })); }
        addListener(fn) { const id = String(++this.serial); this.listeners.set(id, fn); return id; }
        removeListener(id) { this.listeners.delete(id); }
      },
      timing(value, options) {
        const animation = { value, options, active: false,
          start(callback) { this.active = true; this.callback = callback; },
          stop() { this.active = false; },
          finish() { assert.equal(this.active, true); this.active = false; value.setValue(options.toValue); this.callback?.({ finished: true }); },
        };
        animations.push(animation); return animation;
      },
    },
    Easing: { cubic: 'cubic', quad: 'quad', out: x => x, inOut: x => x },
    AccessibilityInfo: { isReduceMotionEnabled: () => preference, addEventListener: listen('motion'), announceForAccessibility: message => announcements.push(message) },
    AppState: { currentState: appState, addEventListener: listen('app') },
  };
  const filename = path.resolve(__dirname, '../../course/useCourseUnlock.js');
  const code = babel.transformFileSync(filename, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
  })(name => { if (name === 'react') return React; if (name === 'react-native') return native; throw Error(name); }, module, module.exports);
  const navigation = { setParams: params => clears.push(params) };
  const nativeEvents = [];
  const acknowledge = y => { if (confirmScroll) nativeEvents.push(() => h.value.onScroll({ nativeEvent: { contentOffset: { y } } })); };
  const list = { scrollToIndex: options => { scrolls.push({ kind: 'index', ...options }); acknowledge(options.index * 520); },
    scrollToOffset: options => { scrolls.push({ kind: 'offset', ...options }); acknowledge(options.offset); } };
  const onConsume = request => consumed.push(request);
  const h = { animations, scrolls, clears, consumed, announcements, timers,
    render() {
      let passes = 0;
      do {
        assert.ok(++passes < 20); cursor = 0; dirty = false; effects = [];
        h.value = module.exports.useCourseUnlock({ request, progress, plays, navigation, focused, onConsume, arrivalReady });
        h.value.listRef.current = list; effects.forEach(run => run()); nativeEvents.splice(0).forEach(run => run());
      } while (dirty);
      return h.value;
    },
    prepare() { if (autoPrepare && [...timers.values()].some(timer => timer.ms === 120)) h.timer(120); },
    layout() { h.value.onLayout(); h.value.onStepLayout(request?.fromPlayId || 'play-1', 520); h.render(); h.prepare(); },
    visible(...ids) { h.value.onViewableItemsChanged({ viewableItems: ids.map(id => ({ item: plays.find(play => play.id === id), isViewable: true })) }); h.render(); h.prepare(); },
    timer(ms) { const pair = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(pair, `timer ${ms} exists`); timers.delete(pair[0]); pair[1].fn(); h.render(); },
    finish() { animations.find(animation => animation.active).finish(); h.render(); },
    async motion(value = motion) { resolveMotion(value); await tick(); h.render(); h.prepare(); },
    event(key, value) { if (key === 'app:change') native.AppState.currentState = value; listeners.get(key)?.(value); h.render(); },
    progress(value) { progress = { ...progress, ...value }; h.render(); },
    generation(value) { progress = { ...progress, owner: { ...progress.owner, generation: value } }; request = { ...request, owner: progress.owner }; h.render(); },
    request(value) { request = value; h.render(); },
    ready(value) { arrivalReady = value; h.render(); },
    focus(value) { focused = value; h.render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  h.render(); return h;
}

test('course lands on the completed play, travels to the next lock, opens it, then sparkles once', async () => {
  const h = host(); h.layout(); await h.motion();
  assert.ok(h.scrolls.length > 0, 'the course positions the source play');
  assert.equal(h.scrolls[0].index, 0); assert.equal(h.scrolls[0].animated, false);
  h.visible('play-1'); h.timer(800);
  assert.equal(h.value.phase, 'travel');
  assert.equal(h.animations[0].options.duration, 2400);
  h.animations[0].value.setValue(0.5);
  assert.equal(h.scrolls.at(-1).offset, 260); assert.equal(h.scrolls.at(-1).animated, false, 'page travel follows the slow path rather than native scroll speed');
  h.finish(); assert.equal(h.value.phase, 'travel', 'opening waits for the target to be visible');
  h.visible('play-2'); assert.equal(h.value.phase, 'unlocking');
  assert.equal(h.animations[1].options.duration, 1400);
  h.finish(); assert.equal(h.value.phase, 'sparkling'); assert.equal(h.animations[2].options.duration, 1600);
  h.finish(); assert.equal(h.value.session, null);
  assert.equal(h.clears.length, 1); assert.match(h.announcements[0], /Play 2.*unlocked/i);
  assert.equal(h.consumed.length, 1);
  h.focus(false); h.focus(true); assert.equal(h.animations.length, 3, 'a retained route cannot replay the event');
  assert.equal(h.value.preparing, false, 'an already-presented route returns to its visible ordinary landing');
  h.unmount();
});

test('reduced motion or a late preference change lands directly on the usable next play', async () => {
  for (const late of [false, true]) {
    const h = host(); h.layout();
    if (late) { await h.motion(); h.visible('play-1'); h.timer(800); h.event('motion:reduceMotionChanged', true); }
    else await h.motion(true);
    assert.equal(h.value.session, null); assert.equal(h.scrolls.at(-1).index, 1);
    assert.equal(h.scrolls.at(-1).animated, false); assert.equal(h.animations.some(animation => animation.active), false);
    h.unmount();
  }
});

test('far-away virtualized plays retry positioning before opening their lock', async () => {
  const h = host({ request: event(32), level: 32 }); h.layout(); await h.motion();
  assert.equal(h.scrolls[0].index, 31);
  h.value.onScrollToIndexFailed({ index: 31, averageItemLength: 500 });
  assert.equal(h.scrolls.at(-1).offset, 15500);
  h.timer(100); assert.equal(h.scrolls.at(-1).index, 31);
  h.visible('play-32'); h.timer(800); h.visible('play-33'); h.finish();
  assert.equal(h.value.phase, 'unlocking'); h.unmount();
});

test('a retained course list can start from rows already visible before the quiz return', async () => {
  const h = host({ request: null });
  h.visible('play-1', 'play-2'); h.layout(); h.request(event()); await h.motion();
  assert.equal(h.value.phase, 'hold');
  h.timer(800); h.finish(); assert.equal(h.value.phase, 'unlocking'); h.unmount();
});

test('reduced-motion distant landings retain measurement retries until the target is visible', async () => {
  const h = host({ request: event(32), level: 32 }); h.layout(); await h.motion(true);
  assert.equal(h.value.session, null); assert.equal(h.clears.length, 0, 'the pending landing is not disposed before measurement');
  h.value.onScrollToIndexFailed({ index: 32, averageItemLength: 510 }); h.timer(100);
  assert.equal(h.scrolls.at(-1).index, 32); assert.equal(h.scrolls.at(-1).animated, false);
  h.visible('play-33'); assert.equal(h.clears.length, 1); h.unmount();
});

test('manual scrolling, backgrounding or blur cancels pending reduced-motion landing retries', async () => {
  for (const interrupt of [h => h.value.onScrollBeginDrag(), h => h.event('app:change', 'background'), h => h.focus(false)]) {
    const h = host({ request: event(32), level: 32 }); h.layout(); await h.motion(true);
    h.value.onScrollToIndexFailed({ index: 32, averageItemLength: 510 });
    interrupt(h); h.render();
    assert.equal(h.timers.size, 0, 'no delayed positioning may pull the reader back');
    assert.equal(h.consumed.length, 0, 'an interrupted landing is still unseen'); h.unmount();
  }
});

test('interruptions retire old animations and a replacement account positions its own current play', async () => {
  const interruptions = [h => h.value.onScrollBeginDrag(), h => h.event('app:change', 'background'), h => h.focus(false), h => h.progress({ owner: { uid: 'other', generation: 3 } })];
  for (const [index, interrupt] of interruptions.entries()) {
    const h = host(); h.layout(); await h.motion(); h.visible('play-1'); h.timer(800);
    const count = h.scrolls.length; interrupt(h); h.render();
    assert.equal(h.value.session, null); assert.equal(h.animations.some(animation => animation.active), false);
    assert.equal(h.scrolls.length, count + (index === 3 ? 1 : 0)); h.unmount();
  }
});

test('normal visits, invalid owners, nonadjacent plays and already-completed targets never stage an unlock', async () => {
  for (const request of [null, { ...event(), owner: { uid: 'other', generation: 2 } }, { ...event(), toPlayId: 'play-4' }, event(39)]) {
    const h = host({ request }); await h.motion(); assert.equal(h.value.session, null); assert.equal(h.scrolls.length, 0); h.unmount();
  }
  const h = host({ level: 2 }); await h.motion(); assert.equal(h.value.session, null); h.unmount();
});

test('every ordinary course visit positions the current unlocked play without replaying an animation', () => {
  const h = host({ request: null, level: 7 }); h.layout();
  assert.equal(h.scrolls.at(-1)?.index, 7); assert.equal(h.scrolls.at(-1).animated, false);
  const count = h.scrolls.length;
  h.value.onScrollBeginDrag(); h.render(); h.render(); assert.equal(h.scrolls.length, count, 'manual exploration remains free');
  h.focus(false); h.focus(true);
  assert.equal(h.scrolls.length, count + 1); assert.equal(h.scrolls.at(-1).index, 7);
  assert.equal(h.animations.length, 0); h.unmount();
});

test('ordinary distant landings retry measurement and cancel retries on a manual scroll', () => {
  const h = host({ request: null, level: 32 }); h.layout();
  assert.equal(h.scrolls.at(-1)?.index, 32);
  h.value.onScrollToIndexFailed({ index: 32, averageItemLength: 510 }); h.timer(100);
  assert.equal(h.scrolls.at(-1).index, 32);
  h.value.onScrollToIndexFailed({ index: 32, averageItemLength: 510 }); h.value.onScrollBeginDrag();
  assert.equal(h.timers.size, 0); assert.equal(h.consumed.length, 0); h.unmount();
});

test('a delayed native measurement failure cannot revive canceled positioning', () => {
  const h = host({ request: null, level: 32 }); h.layout(); h.value.onScrollBeginDrag();
  const count = h.scrolls.length;
  h.value.onScrollToIndexFailed({ index: 32, averageItemLength: 510 });
  assert.equal(h.timers.size, 0); assert.equal(h.scrolls.length, count); h.unmount();
});

test('history hydration and unconfirmed progress cannot position a visit prematurely', () => {
  const h = host({ request: null, level: 5, arrivalReady: false }); h.layout();
  assert.equal(h.scrolls.length, 0); h.ready(true); assert.equal(h.scrolls.at(-1)?.index, 5);
  h.focus(false); h.progress({ status: 'loading' }); h.focus(true);
  const count = h.scrolls.length; assert.equal(h.scrolls.length, count);
  h.progress({ status: 'ready' }); h.value.onLayout(); assert.equal(h.scrolls.length, count + 1); h.unmount();
});

test('a completed course positions the final completed poster', () => {
  const h = host({ request: null, level: 39 }); h.layout();
  assert.equal(h.scrolls.at(-1)?.index, 38); assert.equal(h.animations.length, 0); h.unmount();
});

test('a fresh account generation cannot reuse a retired animation with the same durable event id', async () => {
  const h = host(); h.layout(); await h.motion(); h.visible('play-1');
  const previous = h.value.session; h.generation(3); await h.motion();
  assert.notEqual(h.value.session, previous); assert.equal(h.value.session.request.owner.generation, 3);
  assert.equal(h.consumed.length, 0, 'retiring an older owner does not consume the new owner request');
  h.timer(800); h.visible('play-2'); h.finish(); h.finish(); h.finish();
  assert.equal(h.consumed.length, 1); assert.equal(h.consumed[0].owner.generation, 3); h.unmount();
});

test('retrying progress in place repositions the remounted list at the same unlocked play', () => {
  const h = host({ request: null, level: 7 }); h.layout(); const count = h.scrolls.length;
  h.progress({ status: 'error' }); h.progress({ status: 'ready' });
  h.value.onLayout(); h.render();
  assert.equal(h.scrolls.length, count + 1); assert.equal(h.scrolls.at(-1).index, 7); h.unmount();
});

test('a pending unlock waits for foreground instead of being consumed without being seen', async () => {
  const h = host({ appState: 'background' }); h.layout(); h.visible('play-1'); await h.motion();
  assert.equal(h.consumed.length, 0); assert.equal(h.scrolls.length, 0); assert.equal(h.timers.size, 0);
  h.focus(false); h.focus(true); assert.equal(h.consumed.length, 0, 'an unseen background mount does not consume the pending reward');
  h.event('app:change', 'active'); await h.motion(); assert.equal(h.value.phase, 'hold');
  h.timer(800); h.visible('play-2'); h.finish(); h.finish(); h.finish();
  assert.equal(h.consumed.length, 1); h.unmount();
});

test('late-course positioning tolerates enough progressive measurements for a cold virtual list', () => {
  const h = host({ request: null, level: 37 }); h.layout();
  for (let batch = 0; batch < 20; batch++) {
    h.value.onScrollToIndexFailed({ index: 37, averageItemLength: 510 }); h.timer(100);
  }
  assert.equal(h.scrolls.at(-1).index, 37); h.visible('play-38');
  assert.equal(h.timers.size, 0); h.unmount();
});

test('a source positioning timeout still gives the destination its own retry budget', async () => {
  const h = host({ request: event(32), level: 32 }); h.layout(); await h.motion();
  for (let failure = 0; failure < 100; failure++) {
    h.value.onScrollToIndexFailed({ index: 31, averageItemLength: 510 });
    if ([...h.timers.values()].some(timer => timer.ms === 100)) h.timer(100);
  }
  h.timer(25000); assert.equal(h.scrolls.at(-1).index, 32);
  h.value.onScrollToIndexFailed({ index: 32, averageItemLength: 510 }); h.timer(100);
  assert.equal(h.scrolls.at(-1).index, 32); h.unmount();
});

test('a transient course focus before layout cannot consume the first visible course visit', async () => {
  const h = host();
  assert.equal(h.animations.length, 0); h.focus(false);
  assert.equal(h.consumed.length, 0, 'focus alone is not evidence that the unlock was shown');
  h.focus(true); h.layout(); h.visible('play-1'); await h.motion(); h.timer(800);
  assert.equal(h.value.phase, 'travel'); h.visible('play-2'); h.finish(); h.finish(); h.finish();
  assert.equal(h.consumed.length, 1); h.unmount();
});

test('backgrounding or unmounting before the lock opens leaves its checkpoint pending', async () => {
  for (const interrupt of [h => h.event('app:change', 'background'), h => h.unmount()]) {
    const h = host(); h.layout(); h.visible('play-1'); await h.motion(); h.timer(800);
    interrupt(h); assert.equal(h.consumed.length, 0); h.unmount();
  }
});

test('an interrupted travel restarts on the next course visit and persists only after presentation', async () => {
  const h = host(); h.layout(); h.visible('play-1'); await h.motion(); h.timer(800);
  h.focus(false); h.focus(true); await h.motion();
  assert.equal(h.consumed.length, 0); h.timer(800); h.visible('play-2'); h.finish(); h.finish(); h.finish();
  assert.equal(h.consumed.length, 1); h.unmount();
});

test('a layout watchdog cannot acknowledge an animation that never ran', async () => {
  const h = host(); h.layout(); await h.motion(); h.timer(25000); h.visible('play-2');
  assert.equal(h.animations.length, 0); assert.equal(h.consumed.length, 0); h.unmount();
});

test('foregrounding the same course retries an unseen unlock without requiring another route visit', async () => {
  const h = host(); h.event('app:change', 'inactive'); h.event('app:change', 'active');
  h.layout(); h.visible('play-1'); await h.motion(); h.timer(800);
  assert.equal(h.consumed.length, 0); h.visible('play-2'); h.finish(); h.finish(); h.finish();
  assert.equal(h.consumed.length, 1); h.unmount();
});

test('cold entry waits for native source positioning and a quiet layout before revealing the animation', async () => {
  const h = host({ request: event(4), level: 4, confirmScroll: false, autoPrepare: false });
  h.layout(); h.visible('play-4'); await h.motion();
  assert.equal(h.value.phase, 'waiting'); assert.equal(h.value.preparing, true);
  assert.equal([...h.timers.values()].some(timer => timer.ms === 800), false, 'cached visibility cannot start travel from an unconfirmed offset');
  h.value.onScroll({ nativeEvent: { contentOffset: { y: 1560 } } }); h.render();
  assert.equal(h.value.phase, 'waiting'); h.timer(120);
  assert.equal(h.value.phase, 'hold'); assert.equal(h.value.preparing, false);
  h.timer(800); h.animations[0].value.setValue(0.01);
  assert.equal(h.scrolls.at(-1).offset, 1565.2); h.unmount();
});

test('source retries cannot pull the page back once travel takes control', async () => {
  const h = host({ request: event(3), level: 3 }); h.layout(); await h.motion(); h.visible('play-3');
  h.value.onScrollToIndexFailed({ index: 2, averageItemLength: 520 });
  h.timer(800); const count = h.scrolls.length;
  assert.equal([...h.timers.values()].some(timer => timer.ms === 100), false, 'starting travel cancels old positioning retries');
  h.value.onScrollToIndexFailed({ index: 2, averageItemLength: 520 });
  assert.equal(h.scrolls.length, count, 'late native failures for the source are obsolete');
  assert.equal([...h.timers.values()].some(timer => timer.ms === 100), false); h.unmount();
});

test('a native source confirmation delivered before the first frame updates the travel origin', async () => {
  const h = host(); h.layout(); await h.motion(); h.visible('play-1'); h.timer(800);
  h.value.onScroll({ nativeEvent: { contentOffset: { y: 1000 } } });
  h.animations[0].value.setValue(0.001);
  assert.equal(h.scrolls.at(-1).offset, 1000.52); h.unmount();
});

test('cached source visibility cannot animate a replacement list before its layout', async () => {
  const h = host(); h.layout(); h.visible('play-1');
  h.progress({ status: 'error' }); h.progress({ status: 'ready' }); await h.motion();
  assert.equal(h.value.phase, 'waiting'); assert.equal(h.animations.length, 0);
  h.layout(); h.timer(800); assert.equal(h.value.phase, 'travel'); h.unmount();
});
