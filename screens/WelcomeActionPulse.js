import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

export default function WelcomeActionPulse({ children }) {
  const value = useRef(null);
  if (!value.current) value.current = new Animated.Value(0);
  const progress = value.current;
  const focused = useIsFocused();

  useEffect(() => {
    let active = true;
    let preferenceChanged = false;
    let reduced = true;
    let foreground = AppState.currentState === 'active';
    let loop = null;

    const stop = () => {
      loop?.stop();
      loop = null;
      progress.stopAnimation();
      progress.setValue(0);
    };
    const reconcile = () => {
      if (!active || !focused || !foreground || reduced) {
        stop();
        return;
      }
      if (loop) return;
      const timing = (toValue, duration, delay = 0) => Animated.timing(progress, {
        toValue, duration, delay,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: Platform.OS !== 'web',
        isInteraction: false,
      });
      loop = Animated.loop(Animated.sequence([
        timing(1, 1100), timing(0, 1100), timing(0, 0, 1400),
      ]));
      loop.start();
    };
    if (!focused) {
      stop();
      return () => { active = false; };
    }
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      if (!active) return;
      preferenceChanged = true;
      reduced = enabled !== false;
      reconcile();
    });
    const app = AppState.addEventListener('change', next => {
      if (!active) return;
      foreground = next === 'active';
      reconcile();
    });
    const resolve = enabled => {
      if (!active || preferenceChanged) return;
      reduced = enabled !== false;
      reconcile();
    };
    try {
      Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(resolve, () => resolve(true));
    } catch {
      resolve(true);
    }
    return () => {
      active = false;
      motion.remove();
      app.remove();
      stop();
    };
  }, [focused, progress]);

  return <Animated.View accessible={false} importantForAccessibility="no" style={[styles.wrapper, {
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97], extrapolate: 'clamp' }) }],
  }]}>
    {children}
  </Animated.View>;
}

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
});
