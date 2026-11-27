const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const babel = require('@babel/core');

const plays = Array.from({ length: 39 }, (_, index) => ({ id: `play-${index + 1}`, difficulty: index + 1 }));
const owner = { uid: 'reader', generation: 2 };
const confirmed = (level, account = owner) => ({ status: 'ready', completedLevel: level, owner: account });
const tick = () => new Promise(resolve => setImmediate(resolve));
function historyStore(values = new Map()) {
  const file = path.resolve(__dirname, '../../course/courseUnlockHistory.js');
  assert.ok(fs.existsSync(file), 'production durable unlock history exists');
  return require(file).createCourseUnlockHistory({ getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => values.set(key, value) });
}

function host({ progress = confirmed(3), history = historyStore(), list = plays } = {}) {
  const file = path.resolve(__dirname, '../../course/useCourseArrival.js');
  assert.ok(fs.existsSync(file), 'production progress-driven course arrival exists');
  const slots = [];
  let cursor = 0, dirty = false, effects = [];
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const React = {
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps), useRef: initial => memo(() => ({ current: initial }), []),
    useEffect(setup, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) effects.push(() => {
        slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() };
      });
    },
    useSyncExternalStore(subscribe, snapshot) {
      React.useEffect(() => subscribe(() => { dirty = true; }), [subscribe]);
      return snapshot();
    },
  };
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(name => {
    if (name === 'react') return React;
    if (name === './normalCourseUnlockHistory') return { normalCourseUnlockHistory: history };
    throw Error(name);
  }, module, module.exports);
  const h = { history,
    render() {
      let passes = 0;
      do {
        assert.ok(++passes < 20); cursor = 0; dirty = false; effects = [];
        h.value = module.exports.useCourseArrival({ progress, plays: list, history });
        effects.forEach(run => run());
      } while (dirty);
      return h.value;
    },
    progress(next) { progress = next; h.render(); },
    async loaded() { await tick(); h.render(); return h.value; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  h.render(); return h;
}

test('any Course arrival celebrates only the latest confirmed completion after checkpoint hydration', async () => {
  const h = host({ progress: confirmed(8) });
  assert.equal(h.value.ready, false); assert.equal(h.value.request, null);
  await h.loaded();
  assert.equal(h.value.ready, true);
  assert.equal(h.value.request.fromPlayId, 'play-8');
  assert.equal(h.value.request.toPlayId, 'play-9');
  assert.deepEqual(h.value.request.owner, owner);
  assert.equal(h.history.getSnapshot('reader').seenLevel, 0, 'rendering a request never consumes it');
  const pending = h.value.request; h.render();
  assert.equal(h.value.request, pending, 'rerenders retain the current presentation request');
  h.unmount();
});

test('consumption prevents repeats on revisit and restart while the next confirmed increase can celebrate', async () => {
  const values = new Map(), history = historyStore(values);
  const first = host({ progress: confirmed(3), history }); await first.loaded();
  first.value.onConsume(first.value.request); first.render();
  assert.equal(first.value.request, null);
  await tick(); first.unmount();
  const revisit = host({ progress: confirmed(3), history }); await revisit.loaded();
  assert.equal(revisit.value.ready, true); assert.equal(revisit.value.request, null); revisit.unmount();
  const restart = host({ progress: confirmed(3), history: historyStore(values) }); await restart.loaded();
  assert.equal(restart.value.request, null);
  restart.progress(confirmed(5));
  assert.equal(restart.value.request.fromPlayId, 'play-5');
  assert.equal(restart.value.request.toPlayId, 'play-6'); restart.unmount();
});

test('a matching unmount cleanup receipt persists the visit so reopening does not replay it', async () => {
  const values = new Map(), first = host({ progress: confirmed(4), history: historyStore(values) });
  await first.loaded();
  const request = first.value.request, consume = first.value.onConsume;
  first.unmount();
  consume(request);
  assert.equal(first.history.getSnapshot('reader').seenLevel, 4);
  await tick();
  const next = host({ progress: confirmed(4), history: historyStore(values) }); await next.loaded();
  assert.equal(next.value.request, null); next.unmount();
});

test('unconfirmed progress and signed-out arrivals cannot create an unlock request', async () => {
  const h = host({ progress: { ...confirmed(9), status: 'loading' } }); await h.loaded();
  assert.equal(h.value.ready, false); assert.equal(h.value.request, null);
  h.progress({ ...confirmed(9), status: 'error' });
  assert.equal(h.value.ready, false); assert.equal(h.value.request, null);
  h.progress({ status: 'signed-out', completedLevel: 0, owner: { uid: null, generation: 3 } });
  assert.equal(h.value.ready, true); assert.equal(h.value.request, null); h.unmount();
});

test('zero completion, final completion, and missing exact next difficulty never invent unlocks', async () => {
  for (const [level, list] of [[0, plays], [39, plays], [3, plays.filter(play => play.difficulty !== 4)]]) {
    const h = host({ progress: confirmed(level), list }); await h.loaded();
    assert.equal(h.value.ready, true); assert.equal(h.value.request, null); h.unmount();
  }
});

test('late consumption from another account or generation cannot acknowledge current progress', async () => {
  const h = host(); await h.loaded();
  const stale = h.value.request, consume = h.value.onConsume;
  h.progress(confirmed(3, { uid: 'other', generation: 3 })); await h.loaded();
  assert.equal(h.value.onConsume, consume);
  consume(stale);
  assert.equal(h.history.getSnapshot('reader').seenLevel, 0);
  assert.equal(h.history.getSnapshot('other').seenLevel, 0);
  h.progress(confirmed(3, { uid: 'reader', generation: 4 })); await h.loaded();
  assert.equal(h.value.request.id, stale.id, 'the checkpoint identity survives a fresh account generation');
  assert.equal(h.value.request.owner.generation, 4);
  consume(stale);
  assert.equal(h.history.getSnapshot('reader').seenLevel, 0);
  consume(h.value.request);
  assert.equal(h.history.getSnapshot('reader').seenLevel, 3); h.unmount();
});

test('a superseded completion request cannot consume a newly confirmed increase', async () => {
  const h = host({ progress: confirmed(2) }); await h.loaded();
  const stale = h.value.request;
  h.progress(confirmed(4)); h.value.onConsume(stale);
  assert.equal(h.history.getSnapshot('reader').seenLevel, 0);
  assert.equal(h.value.request.fromPlayId, 'play-4');
  h.value.onConsume({ ...h.value.request, toPlayId: 'play-9' });
  assert.equal(h.history.getSnapshot('reader').seenLevel, 0, 'a mismatched presentation cannot consume the checkpoint');
  h.unmount();
});
