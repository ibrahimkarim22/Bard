const EMPTY = Object.freeze({ status: 'ready', seenLevel: 0 });
const EMPTY_LOAD = Promise.resolve(EMPTY);
const validUid = uid => typeof uid === 'string' && uid.length > 0;
const validLevel = level => Number.isSafeInteger(level) && level >= 0;

function storedLevel(value) {
  try {
    const level = JSON.parse(value);
    return validLevel(level) ? level : 0;
  } catch (_) { return 0; }
}

// This checkpoint records a presentation already consumed on this device. It
// never grants course access or writes account progression.
function createCourseUnlockHistory(storage) {
  const accounts = new Map(), listeners = new Set();
  const account = uid => {
    if (!accounts.has(uid)) accounts.set(uid, {
      // v1 also recorded invisible/interrupted mounts. Only v2 represents an
      // actual displayed unlock; old markers must not suppress that reward.
      key: `@bard/course-unlock-seen/v2/${encodeURIComponent(uid)}`,
      snapshot: Object.freeze({ status: 'loading', seenLevel: 0 }),
      load: null, writes: Promise.resolve(), persistedLevel: 0,
    });
    return accounts.get(uid);
  };
  const publish = (entry, status, seenLevel) => {
    if (entry.snapshot.status === status && entry.snapshot.seenLevel === seenLevel) return;
    entry.snapshot = Object.freeze({ status, seenLevel });
    listeners.forEach(notify => notify());
  };
  const getSnapshot = uid => validUid(uid) ? account(uid).snapshot : EMPTY;
  const load = uid => {
    if (!validUid(uid)) return EMPTY_LOAD;
    const entry = account(uid);
    if (!entry.load) entry.load = Promise.resolve()
      .then(() => storage.getItem(entry.key))
      .then(value => {
        entry.persistedLevel = storedLevel(value);
        publish(entry, 'ready', Math.max(entry.snapshot.seenLevel, entry.persistedLevel));
        return entry.snapshot;
      }, () => {
        publish(entry, 'ready', entry.snapshot.seenLevel);
        return entry.snapshot;
      });
    return entry.load;
  };
  const acknowledge = (uid, completedLevel) => {
    if (!validUid(uid) || !validLevel(completedLevel)) return Promise.resolve(getSnapshot(uid));
    const entry = account(uid);
    publish(entry, entry.snapshot.status, Math.max(entry.snapshot.seenLevel, completedLevel));
    const hydrated = load(uid);
    // Wait for the cold read before writing, then serialize writes per account.
    // Both the read and an earlier acknowledgment may know a higher floor.
    entry.writes = entry.writes.then(() => hydrated).then(async () => {
      const level = entry.snapshot.seenLevel;
      if (level <= entry.persistedLevel) return;
      await storage.setItem(entry.key, JSON.stringify(level));
      entry.persistedLevel = level;
    }).catch(() => {});
    return entry.writes.then(() => entry.snapshot);
  };
  return Object.freeze({
    getSnapshot, load, acknowledge,
    subscribe(notify) { listeners.add(notify); return () => listeners.delete(notify); },
  });
}

module.exports = { createCourseUnlockHistory };
