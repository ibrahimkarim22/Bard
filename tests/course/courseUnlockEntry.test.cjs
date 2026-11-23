const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');
const { createCourseUnlockHistory } = require('../../course/courseUnlockHistory');

const plays = [1, 2, 3].map(difficulty => ({ id: `play-${difficulty}`, name: `Play ${difficulty}`, difficulty }));
const owner = { uid: 'medal-reader', generation: 2 };
const confirmed = completedLevel => ({ status: 'ready', completedLevel, owner });
const tick = () => new Promise(resolve => setImmediate(resolve));

// Keep the production arrival hook, history store and unlock hook connected.
// The native list/animation boundary is controlled because Node cannot mount RN.
function courseEntry({ history, focused = false, progress = confirmed(0) }) {
  const slots = [], timers = new Map(), animations = [], scrolls = [], params = [], nativeScrolls = [];
  let cursor = 0, dirty = false, effects = [], serial = 0;
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) {
      slots[index] = { value: factory(), deps };
    }
    return slots[index].value;
  };
  const React = {
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useRef: initial => memo(() => ({ current: initial }), []),
    useState(initial) {
      const slot = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; dirty = true; }];
    },
    useEffect(setup, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) {
        effects.push({ index, setup, deps });
      }
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      React.useEffect(() => subscribe(() => { dirty = true; }), [subscribe]);
      return getSnapshot();
    },
  };
  const native = {
    Animated: {
      Value: class {
        constructor(value) { this.value = value; this.listeners = new Map(); }
        addListener(fn) { const id = this.listeners.size; this.listeners.set(id, fn); return id; }
        removeListener(id) { this.listeners.delete(id); }
        setValue(value) { this.value = value; this.listeners.forEach(fn => fn({ value })); }
      },
      timing(value, options) {
        const animation = {
          options, active: false,
          start(callback) { this.active = true; this.callback = callback; },
          stop() { this.active = false; },
          finish() { this.active = false; value.setValue(options.toValue); this.callback({ finished: true }); },
        };
        animations.push(animation); return animation;
      },
    },
    Easing: { cubic: x => x, inOut: x => x },
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      addEventListener: () => ({ remove() {} }), announceForAccessibility() {},
    },
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  };
  const load = name => {
    const file = path.resolve(__dirname, `../../course/${name}.js`);
    const code = babel.transformFileSync(file, { babelrc: false, configFile: false,
      plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
    const module = { exports: {} };
    vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
      setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; },
      clearTimeout: id => timers.delete(id),
    }, { filename: file })(dependency => {
      if (dependency === 'react') return React;
      if (dependency === 'react-native') return native;
      if (dependency === './normalCourseUnlockHistory') return { normalCourseUnlockHistory: history };
      throw Error(dependency);
    }, module, module.exports);
    return module.exports[name];
  };
  const useCourseArrival = load('useCourseArrival'), useCourseUnlock = load('useCourseUnlock');
  const acknowledgeScroll = offset => nativeScrolls.push(() => {
    entry.unlock.onScroll({ nativeEvent: { contentOffset: { y: offset } } });
  });
  const list = {
    scrollToIndex(options) {
      scrolls.push({ kind: 'index', ...options }); acknowledgeScroll(options.index * 520);
    },
    scrollToOffset(options) {
      scrolls.push({ kind: 'offset', ...options }); acknowledgeScroll(options.offset);
    },
  };
  const navigation = { setParams: value => params.push(value) };
  const entry = { animations, scrolls, params,
    render() {
      let passes = 0;
      do {
        assert.ok(++passes < 30, 'connected course hooks settle');
        cursor = 0; dirty = false; effects = [];
        entry.arrival = useCourseArrival({ progress, plays, history });
        entry.unlock = useCourseUnlock({ request: entry.arrival.request, arrivalReady: entry.arrival.ready,
          onConsume: entry.arrival.onConsume, progress, plays, navigation, focused });
        entry.unlock.listRef.current = list;
        // React tears down changed passive effects before setting up replacements.
        effects.forEach(({ index }) => slots[index]?.cleanup?.());
        effects.forEach(({ index, setup, deps }) => { slots[index] = { deps, cleanup: setup() }; });
        // Native scroll events arrive after refs and passive effects are installed.
        while (nativeScrolls.length) nativeScrolls.shift()();
      } while (dirty);
    },
    focus(value) { focused = value; entry.render(); },
    progress(value) { progress = value; entry.render(); },
    layout() { entry.unlock.onLayout(); entry.unlock.onStepLayout('play-1', 520); entry.render(); },
    visible(...ids) {
      entry.unlock.onViewableItemsChanged({ viewableItems: ids.map(id => ({ item: plays.find(play => play.id === id), isViewable: true })) });
      entry.render();
    },
    timer(ms) {
      const timer = [...timers].find(([, item]) => item.ms === ms);
      assert.ok(timer, `the ${ms} ms phase timer exists`);
      timers.delete(timer[0]); timer[1].fn(); entry.render();
    },
    finish() {
      const animation = animations.find(item => item.active);
      assert.ok(animation, 'an animation is running'); animation.finish(); entry.render();
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  entry.render(); return entry;
}

test('a medal remains pending across an unseen course handoff and celebrates on the visible drawer visit', async () => {
  const storage = new Map(), receipts = [];
  const store = createCourseUnlockHistory({ getItem: async key => storage.get(key) ?? null,
    setItem: async (key, value) => storage.set(key, value) });
  const history = { ...store, acknowledge(uid, level) { receipts.push({ uid, level }); return store.acknowledge(uid, level); } };
  const retained = courseEntry({ history });
  await tick(); retained.render();
  // The old Course stays mounted under Quiz; View medals opens another Main.
  retained.progress(confirmed(1));
  const handoff = courseEntry({ history, focused: true, progress: confirmed(1) });
  assert.equal(handoff.unlock.phase, 'waiting');
  assert.equal(handoff.animations.length, 0);
  assert.equal(handoff.scrolls.length, 0, 'the handoff list has never laid out');
  handoff.focus(false); handoff.unmount();
  await tick(); retained.render();
  assert.equal(history.getSnapshot(owner.uid).seenLevel, 0, 'an unseen mount cannot consume the medal');
  assert.equal(receipts.length, 0);

  // The hamburger Course entry must still perform every animation phase.
  retained.focus(true); retained.layout(); retained.visible('play-1');
  await tick(); retained.render();
  assert.equal(retained.unlock.phase, 'waiting', 'native positioning settles before the presentation starts');
  assert.equal(retained.animations.length, 0);
  retained.timer(120);
  assert.equal(retained.unlock.phase, 'hold');
  retained.timer(800);
  assert.equal(retained.unlock.phase, 'travel');
  retained.visible('play-2'); retained.finish();
  assert.equal(retained.unlock.phase, 'unlocking');
  retained.finish();
  assert.equal(retained.unlock.phase, 'sparkling');
  assert.equal(history.getSnapshot(owner.uid).seenLevel, 0, 'the medal remains pending until presentation finishes');
  retained.finish(); await tick(); retained.render();
  assert.equal(retained.unlock.session, null);
  assert.equal(history.getSnapshot(owner.uid).seenLevel, 1);
  assert.deepEqual(receipts, [{ uid: owner.uid, level: 1 }]);
  retained.focus(false); retained.focus(true);
  assert.equal(retained.animations.length, 3, 'later visits use ordinary landing without replay');
  retained.unmount();

  const restarted = createCourseUnlockHistory({ getItem: async key => storage.get(key) ?? null, setItem: async () => {} });
  await restarted.load(owner.uid);
  assert.equal(restarted.getSnapshot(owner.uid).seenLevel, 1, 'the completed presentation survives an app restart');
});
