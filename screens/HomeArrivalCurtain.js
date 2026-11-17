import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { FIREBASE_AUTH } from '../firebaseConfig';
import { retryAccountProgress, useAccountCourseProgress } from '../course/AccountCourseProgress';
import WelcomeBackground from './WelcomeBackground';

const inactive = Object.freeze({
  active: false, phase: null, id: null,
  begin: () => null, cancel: () => {}, markHomeReady: () => {},
});
const AuthCurtainContext = createContext(inactive);

export const useAuthCurtainTransition = () => useContext(AuthCurtainContext) || inactive;

export default function AuthCurtainProvider({ children }) {
  const progress = useAccountCourseProgress();
  const liveUid = FIREBASE_AUTH.currentUser?.uid;
  const mounted = useRef(true);
  const current = useRef(null);
  const sequence = useRef(0);
  const [transition, setTransition] = useState({ flight: null, phase: null });
  const flight = transition.flight;

  const publish = useCallback(entry => {
    if (mounted.current && current.current === entry) setTransition({ flight: entry, phase: entry.phase });
  }, []);
  const owned = useCallback(entry => mounted.current && current.current === entry
    && FIREBASE_AUTH.currentUser?.uid === entry.uid, []);
  const retire = useCallback((entry, notify = false) => {
    if (!mounted.current || current.current !== entry) return;
    current.current = null;
    setTransition({ flight: null, phase: null });
    if (notify) {
      try { entry.onCancel?.(); } catch {}
    }
  }, []);
  const begin = useCallback(({ user, light = 'moon', commit, onCancel } = {}) => {
    const uid = user?.uid;
    if (!mounted.current || current.current || typeof uid !== 'string' || !uid.trim()
      || FIREBASE_AUTH.currentUser?.uid !== uid || typeof commit !== 'function') return null;
    const entry = {
      id: `auth-curtain-${++sequence.current}`, uid, light: light === 'sun' ? 'sun' : 'moon',
      commit, onCancel, phase: 'closing', committed: false, layoutStatus: null, retry: 'idle',
    };
    current.current = entry;
    publish(entry);
    return entry.id;
  }, [publish]);
  const cancel = useCallback(id => {
    const entry = current.current;
    if (entry?.id === id && entry.phase === 'closing' && !entry.committed) retire(entry, true);
  }, [retire]);
  const markHomeReady = useCallback(({ id, uid, status } = {}) => {
    const entry = current.current;
    if (!entry || entry.id !== id || entry.uid !== uid || entry.phase !== 'covered'
      || !owned(entry) || status !== 'ready' && status !== 'error') return;
    if (entry.layoutStatus === status) return;
    entry.layoutStatus = status;
    publish(entry);
  }, [owned, publish]);

  const onClosed = useCallback(() => {
    if (!flight || current.current !== flight || flight.phase !== 'closing' || !mounted.current) return;
    if (!owned(flight)) { retire(flight, true); return; }
    // Source cleanup can run synchronously inside the reset. From this point
    // cancel() must leave the same covered curtain in place for Home.
    flight.phase = 'covered';
    flight.committed = true;
    publish(flight);
    try {
      if (flight.commit() === false) retire(flight, true);
    } catch { retire(flight, true); }
  }, [flight, owned, publish, retire]);
  const onOpened = useCallback(() => {
    if (!flight || current.current !== flight || flight.phase !== 'opening' || !mounted.current) return;
    retire(flight);
  }, [flight, retire]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; current.current = null; };
  }, []);

  useEffect(() => {
    if (!flight || current.current !== flight) return;
    if (!owned(flight)) { retire(flight, !flight.committed); return; }
    if (flight.phase !== 'covered') return;
    if (progress.owner?.uid !== flight.uid) { flight.layoutStatus = null; return; }
    if (flight.layoutStatus !== progress.status) flight.layoutStatus = null;
    if (progress.status === 'error' && flight.retry === 'idle') {
      flight.retry = 'pending';
      const settled = () => {
        if (!owned(flight) || flight.phase !== 'covered') return;
        flight.retry = 'settled';
        publish(flight);
      };
      try { Promise.resolve(retryAccountProgress()).then(settled, settled); }
      catch { settled(); }
    }
    if (flight.layoutStatus === progress.status && flight.retry !== 'pending'
      && (progress.status === 'ready' || progress.status === 'error' && flight.retry === 'settled')) {
      flight.phase = 'opening';
      publish(flight);
    }
  }, [transition, flight, progress, liveUid, owned, publish, retire]);

  const value = useMemo(() => ({ active: !!flight, phase: transition.phase, id: flight?.id || null,
    begin, cancel, markHomeReady }), [flight, transition.phase, begin, cancel, markHomeReady]);

  return <AuthCurtainContext.Provider value={value}>
    <View style={styles.root}>
      {children}
      {flight && <View pointerEvents="box-only" accessible={false} accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants" style={styles.overlay}>
        <StatusBar barStyle="light-content" backgroundColor="#0e0c20" animated={false} />
        <WelcomeBackground initiallyOpen holdClosedOnPause light={flight.light}
          closing={transition.phase !== 'opening'} fullyOpen={transition.phase === 'opening'}
          onClosed={onClosed} onOpened={onOpened} />
      </View>}
    </View>
  </AuthCurtainContext.Provider>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
});
