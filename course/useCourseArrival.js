import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { normalCourseUnlockHistory } from './normalCourseUnlockHistory';

// A Course visit derives its presentation from confirmed account progress,
// regardless of which page or navigation action brought the reader here.
export function useCourseArrival({ progress, plays, history = normalCourseUnlockHistory }) {
  const uid = progress.owner?.uid || null;
  const generation = progress.owner?.generation;
  const completedLevel = progress.completedLevel;
  const snapshot = useCallback(() => history.getSnapshot(uid), [history, uid]);
  const checkpoint = useSyncExternalStore(history.subscribe, snapshot, snapshot);
  useEffect(() => { if (uid) history.load(uid); }, [history, uid]);

  const ready = progress.status === 'signed-out'
    || progress.status === 'ready' && !!uid && checkpoint.status === 'ready';
  const request = useMemo(() => {
    if (!ready || progress.status !== 'ready' || !uid || !Number.isSafeInteger(completedLevel)
        || completedLevel <= 0 || completedLevel <= checkpoint.seenLevel) return null;
    const from = plays.find(play => play.difficulty === completedLevel);
    const to = plays.find(play => play.difficulty === completedLevel + 1);
    if (!from || !to) return null;
    return Object.freeze({
      id: `course-unlock:${encodeURIComponent(uid)}:${completedLevel}`,
      fromPlayId: from.id, toPlayId: to.id,
      owner: Object.freeze({ uid, generation }),
    });
  }, [ready, progress.status, uid, generation, completedLevel, checkpoint.seenLevel, plays]);

  const current = useRef(null);
  current.current = { request, history, completedLevel };
  const onConsume = useCallback(consumed => {
    const live = current.current, pending = live?.request;
    // The animation also consumes an interrupted visit during unmount cleanup.
    // Accept that receipt while still rejecting superseded/account-stale ones.
    if (!pending || consumed?.id !== pending.id
        || consumed.owner?.uid !== pending.owner.uid || consumed.owner?.generation !== pending.owner.generation
        || consumed.fromPlayId !== pending.fromPlayId || consumed.toPlayId !== pending.toPlayId) return;
    live.history.acknowledge(pending.owner.uid, live.completedLevel);
  }, []);

  return { request, ready, onConsume };
}
