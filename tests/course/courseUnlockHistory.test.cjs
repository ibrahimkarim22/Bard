const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function storage() {
  const values = new Map(), reads = [], writes = [];
  return { values, reads, writes,
    async getItem(key) { reads.push(key); return values.get(key) ?? null; },
    async setItem(key, value) { writes.push({ key, value }); values.set(key, value); },
  };
}
function create(adapter = storage()) {
  const file = path.resolve(__dirname, '../../course/courseUnlockHistory.js');
  assert.ok(fs.existsSync(file), 'production durable unlock history exists');
  return require(file).createCourseUnlockHistory(adapter);
}

test('a checkpoint hydrates once and retains stable snapshots until its state changes', async () => {
  const adapter = storage(), history = create(adapter), notices = [];
  const before = history.getSnapshot('reader');
  assert.deepEqual(before, { status: 'loading', seenLevel: 0 });
  assert.equal(before, history.getSnapshot('reader'));
  const unsubscribe = history.subscribe(() => notices.push(history.getSnapshot('reader')));
  const first = history.load('reader');
  assert.equal(first, history.load('reader'));
  await first;
  const ready = history.getSnapshot('reader');
  assert.deepEqual(ready, { status: 'ready', seenLevel: 0 });
  assert.equal(ready, history.getSnapshot('reader'));
  assert.equal(adapter.reads.length, 1);
  assert.equal(notices.length, 1);
  unsubscribe();
  await history.acknowledge('reader', 2);
  assert.equal(notices.length, 1);
});

test('legacy checkpoints written before presentation cannot suppress an unseen unlock', async () => {
  const adapter = storage();
  adapter.values.set('@bard/course-unlock-seen/v1/reader', '8');
  const history = create(adapter); await history.load('reader');
  assert.equal(history.getSnapshot('reader').seenLevel, 0, 'legacy seen markers were also written for invisible mounts');
  await history.acknowledge('reader', 8);
  const reopened = create(adapter); await reopened.load('reader');
  assert.equal(reopened.getSnapshot('reader').seenLevel, 8, 'confirmed presentations still persist');
});

test('consumed checkpoints survive a new history instance and stay separate for every account', async () => {
  const adapter = storage(), first = create(adapter);
  await first.acknowledge('reader/a', 6);
  await first.acknowledge('reader%2Fa', 2);
  const restarted = create(adapter);
  await Promise.all([restarted.load('reader/a'), restarted.load('reader%2Fa'), restarted.load('other')]);
  assert.deepEqual(restarted.getSnapshot('reader/a'), { status: 'ready', seenLevel: 6 });
  assert.equal(restarted.getSnapshot('reader%2Fa').seenLevel, 2);
  assert.equal(restarted.getSnapshot('other').seenLevel, 0);
  assert.equal(adapter.values.size, 2);
});

test('acknowledgment advances immediately and late hydration cannot regress or overwrite a higher floor', async () => {
  const read = deferred(), values = new Map(), writes = [];
  const history = create({ getItem: () => read.promise,
    async setItem(key, value) { writes.push(value); values.set(key, value); } });
  const pending = history.acknowledge('reader', 3);
  assert.equal(history.getSnapshot('reader').seenLevel, 3);
  assert.equal(history.getSnapshot('reader').status, 'loading');
  read.resolve('8');
  await pending;
  assert.deepEqual(history.getSnapshot('reader'), { status: 'ready', seenLevel: 8 });
  assert.deepEqual(writes, [], 'older acknowledgment does not replace the durable higher floor');
});

test('a higher acknowledgment survives an older cold read and persists its level', async () => {
  const read = deferred(), adapter = storage();
  adapter.getItem = () => read.promise;
  const history = create(adapter), pending = history.acknowledge('reader', 7);
  read.resolve('2');
  await pending;
  assert.equal(history.getSnapshot('reader').seenLevel, 7);
  assert.equal(adapter.writes.at(-1).value, '7');
});

test('overlapping persistence is serialized so a slow earlier write cannot win', async () => {
  const firstWrite = deferred(), adapter = storage();
  let active = 0, concurrent = false;
  adapter.setItem = async (key, value) => {
    if (++active > 1) concurrent = true;
    adapter.writes.push({ key, value });
    if (value === '1') await firstWrite.promise;
    adapter.values.set(key, value); active--;
  };
  const history = create(adapter);
  await history.load('reader');
  const first = history.acknowledge('reader', 1);
  await tick();
  const second = history.acknowledge('reader', 4);
  assert.equal(history.getSnapshot('reader').seenLevel, 4);
  await tick();
  assert.equal(adapter.writes.length, 1);
  firstWrite.resolve();
  await Promise.all([first, second]);
  assert.equal(concurrent, false);
  const restarted = create(adapter); await restarted.load('reader');
  assert.equal(restarted.getSnapshot('reader').seenLevel, 4);
});

test('read and write failures resolve safely while retaining the in-memory seen floor', async () => {
  const history = create({ getItem() { throw Error('unavailable'); }, setItem() { throw Error('unavailable'); } });
  await history.load('reader');
  assert.deepEqual(history.getSnapshot('reader'), { status: 'ready', seenLevel: 0 });
  await history.acknowledge('reader', 3);
  assert.deepEqual(history.getSnapshot('reader'), { status: 'ready', seenLevel: 3 });
  await history.acknowledge('reader', 1);
  assert.equal(history.getSnapshot('reader').seenLevel, 3);
});

test('malformed storage and invalid acknowledgment values never create a seen checkpoint', async () => {
  for (const value of ['garbage', 'null', '"4"', '{}', '[]', '-1', '2.5', '1e100']) {
    const history = create({ getItem: async () => value, setItem: async () => {} });
    await history.load('reader');
    assert.deepEqual(history.getSnapshot('reader'), { status: 'ready', seenLevel: 0 });
  }
  const adapter = storage(), history = create(adapter);
  await history.load('reader');
  const before = history.getSnapshot('reader');
  for (const invalid of [-1, 0.5, '4', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await history.acknowledge('reader', invalid);
  assert.equal(history.getSnapshot('reader'), before);
  assert.equal(adapter.writes.length, 0);
  await history.load(null); await history.acknowledge(null, 4);
  assert.deepEqual(history.getSnapshot(null), { status: 'ready', seenLevel: 0 });
  assert.equal(adapter.reads.length, 1);
});
