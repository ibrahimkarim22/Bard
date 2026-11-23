import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing } from 'react-native';

// This is a presentation of confirmed progress, never a source of permission to
// open a lesson. Keep the event tied to the account that earned it.
export function useCourseUnlock({ request, progress, plays, navigation, focused, onConsume, arrivalReady = true }) {
  const listRef = useRef(null), ready = useRef(false), live = useRef(null), consumed = useRef(new Set());
  const heights = useRef(new Map());
  const visibleIds = useRef(new Set());
  const scrollOffset = useRef(0), positionedVisit = useRef(null);
  const hasScrollOffset = useRef(false);
  const [, refresh] = useState(0);
  const [foregroundVisit, restartVisit] = useState(0);
  const fromIndex = plays.findIndex(play => play.id === request?.fromPlayId);
  const toIndex = plays.findIndex(play => play.id === request?.toPlayId);
  const valid = typeof request?.id === 'string' && !!request.owner?.uid
    && request.owner.uid === progress.owner?.uid && request.owner.generation === progress.owner?.generation
    && arrivalReady && progress.status === 'ready' && fromIndex >= 0 && toIndex === fromIndex + 1
    && plays[fromIndex].difficulty === progress.completedLevel
    && plays[toIndex]?.difficulty === progress.completedLevel + 1;
  const session = useMemo(() => valid && focused ? {
    id: request.id, key: `${request.id}:${request.owner.generation}`, request, from: plays[fromIndex], to: plays[toIndex], fromIndex, toIndex,
    path: new Animated.Value(0), lock: new Animated.Value(0), sparkle: new Animated.Value(0),
    phase: 'waiting', sourceHeight: 0, active: false, settled: false, timers: new Set(), retries: 0,
  } : null, [request?.id, request?.owner?.uid, request?.owner?.generation, valid, focused, foregroundVisit]);
  const current = useRef(null);
  current.current = { request, navigation, onConsume };
  const publish = () => refresh(value => value + 1);
  const clearTimers = target => {
    target.timers.forEach(clearTimeout); target.timers.clear(); target.retryTimers?.clear(); target.positionTimer = null;
  };
  const later = (target, fn, delay) => {
    const timer = setTimeout(() => { target.timers.delete(timer); if (target.active && !target.settled) fn(); }, delay);
    target.timers.add(timer); return timer;
  };
  const clearEvent = target => {
    if (!target.ordinary && target.presented && current.current.request?.id === target.id && !target.receipted
        && current.current.request.owner?.uid === target.request.owner.uid
        && current.current.request.owner?.generation === target.request.owner.generation) {
      target.receipted = true;
      current.current.onConsume?.(target.request);
      current.current.navigation.setParams?.({ courseUnlock: undefined });
    }
  };
  const scrollTo = (target, index, animated) => {
    if (target.destination?.index !== index) target.retries = 0;
    target.destination = { index, animated, viewPosition: 0.12 };
    listRef.current?.scrollToIndex?.(target.destination);
  };
  const clearPreparation = target => {
    if (target.positionTimer != null) {
      clearTimeout(target.positionTimer); target.timers.delete(target.positionTimer); target.positionTimer = null;
    }
  };
  const finishPositioning = target => {
    clearPreparation(target);
    target.retryTimers?.forEach(timer => { clearTimeout(timer); target.timers.delete(timer); });
    target.retryTimers?.clear(); target.destination = null;
  };
  const stopTravel = target => {
    if (target.pathListener != null) { target.path.removeListener(target.pathListener); target.pathListener = null; }
  };
  const settle = (target, { land = false, announce = false } = {}) => {
    if (!target) return;
    if (target.settled) {
      if (target.landing && !land) {
        target.landing = false; clearTimers(target); clearEvent(target); publish();
      }
      return;
    }
    target.settled = true;
    target.animation?.stop(); stopTravel(target); clearTimers(target);
    if (target.presented) consumed.current.add(target.key);
    // Reduced motion still gets a reliable distant-row landing, including the
    // FlatList measurement retries, without rendering the celebration.
    if (land && ready.current) {
      target.landing = !target.targetVisible;
      if (target.targetVisible && target.reduced && target.verifiedMotion) {
        target.presented = true; consumed.current.add(target.key);
      }
      scrollTo(target, target.toIndex, false);
    }
    if (announce) AccessibilityInfo.announceForAccessibility?.(`${target.to.name} unlocked. Ready to begin.`);
    if (target.landing) {
      const timer = setTimeout(() => { target.timers.delete(timer); if (target.active) clearEvent(target); }, 10000);
      target.timers.add(timer);
    } else clearEvent(target);
    publish();
  };
  const animate = (target, value, duration, native, next) => {
    target.animation = Animated.timing(value, { toValue: 1, duration,
      easing: Easing.inOut(Easing.cubic), useNativeDriver: native });
    target.animation.start(({ finished }) => {
      if (finished && target.active && !target.settled && live.current === target) next();
    });
  };
  const unlock = target => {
    if (!target.active || target.settled || !target.traveled || !target.targetVisible || target.phase !== 'travel') return;
    target.phase = 'unlocking'; publish();
    animate(target, target.lock, 1400, true, () => {
      target.presented = true;
      target.phase = 'sparkling'; publish();
      animate(target, target.sparkle, 1600, true, () => settle(target, { announce: true }));
    });
  };
  const start = target => {
    if (!target?.active || !target.began || target.settled || !ready.current || target.positioned) return;
    target.positioned = true;
    if (target.reduced) settle(target, { land: true, announce: true });
    else {
      target.sourceConfirmed = target.fromIndex === 0 && scrollOffset.current === 0
        || hasScrollOffset.current && target.sourceVisible;
      scrollTo(target, target.fromIndex, false);
      maybeTravel(target);
    }
  };
  const sourceReady = target => target?.active && target.began && ready.current && target.positioned
    && target.sourceConfirmed && !target.settled && target.motion === false && target.sourceVisible
    && target.sourceHeight > 0 && target.phase === 'waiting' && !target.retryTimers?.size;
  const maybeTravel = target => {
    if (!sourceReady(target) || target.positionTimer != null) return;
    // Visibility can arrive before the native list has finished correcting its
    // initial offset. Reveal the source only after that positioning is quiet.
    target.positionTimer = later(target, () => {
      target.positionTimer = null;
      if (!sourceReady(target)) return;
      finishPositioning(target);
      target.phase = 'hold'; publish();
      later(target, () => {
        target.phase = 'travel'; target.retries = 0; publish();
        finishPositioning(target);
        target.travelOrigin = scrollOffset.current;
        // Native smooth scrolling has a platform-controlled duration. Drive both
        // the viewport and the gold path from one slow, measured travel value.
        target.pathListener = target.path.addListener(({ value }) => {
          if (target.active && !target.settled) {
            target.travelFrame = true;
            listRef.current?.scrollToOffset?.({ offset: Math.max(0, target.travelOrigin + target.sourceHeight * value), animated: false });
          }
        });
        animate(target, target.path, 2400, false, () => {
          stopTravel(target); target.traveled = true;
          if (!target.targetVisible) scrollTo(target, target.toIndex, false);
          unlock(target);
        });
      }, 800);
    }, 120);
  };

  const visitKey = `${progress.owner?.uid || ''}:${progress.owner?.generation || 0}:${progress.completedLevel}`;

  useEffect(() => {
    if (!session || !focused || consumed.current.has(session.key)) return;
    positionedVisit.current = visitKey;
    live.current = session; session.active = true;
    session.sourceHeight = heights.current.get(session.from.id) || 0;
    session.sourceVisible = visibleIds.current.has(session.from.id);
    session.targetVisible = visibleIds.current.has(session.to.id);
    let changed = false, lastMotion = true;
    const applyMotion = (reduced, verified = true) => {
      if (!session.active || !session.began || session.settled) return;
      session.motion = reduced !== false; session.reduced = session.motion; session.verifiedMotion = verified;
      if (session.reduced && session.positioned) settle(session, { land: true, announce: true });
      else { start(session); maybeTravel(session); }
    };
    const begin = () => {
      if (!session.active || session.began || session.settled) return;
      session.began = true;
      // Position the source immediately, but do not start motion until the
      // accessibility preference and real list visibility have both resolved.
      start(session);
      try { Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(value => applyMotion(changed ? lastMotion : value), () => applyMotion(true, false)); }
      catch (_) { applyMotion(true, false); }
      later(session, () => settle(session, { land: true, announce: true }), 25000);
    };
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', reduced => {
      changed = true; lastMotion = reduced; applyMotion(reduced);
    });
    const app = AppState.addEventListener('change', state => {
      if (state === 'active') {
        if (session.settled && !session.presented) restartVisit(value => value + 1);
        else begin();
      }
      else if (session.began) settle(session);
    });
    if (AppState.currentState === 'active') begin();
    return () => {
      session.active = false; session.animation?.stop(); stopTravel(session); clearTimers(session);
      motion.remove(); app.remove();
      if (session.began && (!session.settled || session.landing)) {
        session.settled = true; session.landing = false;
        if (session.presented) consumed.current.add(session.key);
        clearEvent(session);
      }
      if (live.current === session) live.current = null;
    };
  }, [session, focused]);

  useEffect(() => {
    if (!focused) { positionedVisit.current = null; return; }
    if (!arrivalReady || progress.status !== 'ready') {
      positionedVisit.current = null;
      if (progress.status !== 'ready') ready.current = false;
      return;
    }
    if (session && !session.settled && !consumed.current.has(session.key)
        || positionedVisit.current === visitKey) return;
    let index = plays.findIndex(play => play.difficulty === progress.completedLevel + 1);
    if (index < 0) {
      for (let candidate = plays.length - 1; candidate >= 0; candidate--) {
        if (plays[candidate].difficulty <= progress.completedLevel) { index = candidate; break; }
      }
    }
    if (index < 0) return;
    positionedVisit.current = visitKey;
    const landing = { ordinary: true, active: true, settled: true, landing: true,
      toIndex: index, to: plays[index], retries: 0, timers: new Set() };
    live.current = landing;
    const position = () => {
      if (!ready.current || landing.positioned || AppState.currentState !== 'active') return;
      landing.positioned = true; scrollTo(landing, index, false);
    };
    landing.position = position; position();
    const app = AppState.addEventListener('change', state => {
      if (state === 'active') position();
      else if (landing.positioned) settle(landing);
    });
    return () => {
      landing.active = false; clearTimers(landing); app.remove();
      if (live.current === landing) live.current = null;
    };
  }, [session, focused, arrivalReady, progress.status, visitKey, plays]);

  // Stable FlatList callback: React Native does not allow replacing this prop
  // as stages change. Its live ref always points at the current account/event.
  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    const visible = new Set(viewableItems.filter(row => row.isViewable).map(row => row.item.id));
    visibleIds.current = visible;
    const target = live.current;
    if (!target?.active) return;
    target.sourceVisible = visible.has(target.from?.id); target.targetVisible = visible.has(target.to.id);
    if (target.settled) {
      if (target.landing && target.targetVisible) {
        target.landing = false; clearTimers(target);
        if (target.reduced && target.verifiedMotion) { target.presented = true; consumed.current.add(target.key); }
        clearEvent(target);
      }
      return;
    }
    maybeTravel(target); unlock(target);
  }, []);
  const onLayout = () => {
    ready.current = true;
    const target = live.current;
    if (target?.active) { if (target.ordinary) target.position(); else { start(target); maybeTravel(target); } }
  };
  const onStepLayout = (id, height) => {
    if (!Number.isFinite(height) || height <= 0) return;
    heights.current.set(id, height);
    const target = live.current;
    if (target?.from?.id === id && !target.settled) {
      if (target.sourceHeight !== height) clearPreparation(target);
      target.sourceHeight = height; maybeTravel(target);
    }
  };
  const onScrollToIndexFailed = ({ index, averageItemLength }) => {
    const target = live.current;
    if (!target?.active || target.settled && !target.landing || target.destination?.index !== index
        || target.retries++ >= Math.max(20, plays.length * 2)) return;
    const destination = target.destination;
    clearPreparation(target);
    const timer = setTimeout(() => {
      target.timers.delete(timer); target.retryTimers.delete(timer);
      if (target.active && live.current === target && target.destination === destination) {
        listRef.current?.scrollToIndex?.(destination); maybeTravel(target);
      }
    }, 100);
    if (!target.retryTimers) target.retryTimers = new Set();
    target.retryTimers.add(timer);
    target.timers.add(timer);
    listRef.current?.scrollToOffset({ offset: Math.max(0, averageItemLength * index), animated: false });
  };
  return { listRef, session: focused && session && !session.settled && !consumed.current.has(session.key) ? session : null,
    phase: session?.phase, onLayout, onStepLayout, onViewableItemsChanged, onScrollToIndexFailed,
    preparing: focused && progress.status === 'ready'
      && (!arrivalReady || !!session && !session.settled && !consumed.current.has(session.key) && session.phase === 'waiting'),
    onScroll: event => {
      const offset = event.nativeEvent.contentOffset.y;
      if (!Number.isFinite(offset)) return;
      scrollOffset.current = offset; hasScrollOffset.current = true;
      const target = live.current;
      if (target?.active && !target.settled && target.positioned && target.phase === 'waiting') {
        target.sourceConfirmed = true; clearPreparation(target); maybeTravel(target);
      }
      if (target?.phase === 'travel' && !target.travelFrame) target.travelOrigin = offset;
    },
    onScrollBeginDrag: () => settle(live.current) };
}
