import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function WelcomeMoon({ phase = 'full' } = {}) {
  const value = useRef(null);
  if (!value.current) value.current = new Animated.Value(0);
  const soft = value.current;
  const focused = useIsFocused();
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 360 || height - insets.top - insets.bottom < 760 || fontScale > 1.2;
  const size = compact ? 38 : 68;
  const stringLength = compact ? 12 : 50;
  const ornamentHeight = stringLength + size;
  const supportsHalo = Platform.OS === 'web' || (!!globalThis.nativeFabricUIManager
    && (Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 28)));
  const supportsBlur = Platform.OS === 'web' || (Platform.OS === 'android'
    && Number(Platform.Version) >= 31 && !!globalThis.nativeFabricUIManager);

  useEffect(() => {
    let active = true, preferenceChanged = false, reduced = true, loop = null;
    let foreground = AppState.currentState === 'active';
    const stop = () => {
      loop?.stop(); loop = null;
      soft.stopAnimation(); soft.setValue(0);
    };
    const reconcile = () => {
      if (!active || !focused || !foreground || reduced) { stop(); return; }
      if (loop) return;
      const timing = (toValue, duration, delay = 0) => Animated.timing(soft, {
        toValue, duration, delay, easing: Easing.inOut(Easing.sin), useNativeDriver: false, isInteraction: false,
      });
      // A separate clock and phase: curtain opening and refocusing never drive the moon.
      loop = Animated.loop(Animated.sequence([
        timing(0, 0, 650), timing(1, 1500), timing(1, 0, 450),
        timing(0, 2250), timing(0, 0, 1800),
      ]));
      loop.start();
    };
    if (!focused || !supportsBlur) { stop(); return () => { active = false; }; }
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      if (!active) return;
      preferenceChanged = true; reduced = enabled !== false; reconcile();
    });
    const app = AppState.addEventListener('change', next => {
      if (!active) return;
      foreground = next === 'active'; reconcile();
    });
    const resolve = enabled => {
      if (!active || preferenceChanged) return;
      reduced = enabled !== false; reconcile();
    };
    try { Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(resolve, () => resolve(true)); }
    catch { resolve(true); }
    return () => { active = false; motion.remove(); app.remove(); stop(); };
  }, [focused, soft, supportsBlur]);

  const Field = supportsBlur ? Animated.View : View;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={[styles.anchor, {
      top: insets.top + (compact ? 4 : 8), left: 0, width, height: ornamentHeight,
    }]}>
    <Field style={[styles.field, supportsBlur && {
      filter: soft.interpolate({ inputRange: [0, 1], outputRange: ['blur(0px)', 'blur(5px)'], extrapolate: 'clamp' }),
    }]}>
      <View style={styles.inset}>
        <View testID="welcome-moon-hanger" style={[styles.hanger, { left: width / 2 - size / 2, width: size, height: stringLength + size }]}>
          <View testID="welcome-moon-string" style={[styles.string, { left: size / 2 - 0.5, height: stringLength + 1 }]} />
          {supportsHalo && <View testID="welcome-moon-halo" style={[styles.halo, phase === 'sun' && styles.sunHalo, { top: stringLength, width: size, height: size, borderRadius: size / 2 }]} />}
          <View testID={phase === 'sun' ? 'welcome-sun-disc' : 'welcome-moon-disc'} style={[styles.disc, phase === 'sun' && styles.sun, { top: stringLength, width: size, height: size, borderRadius: size / 2 }]}>
            {phase !== 'sun' && <>
              <View style={[styles.crater, { top: size * 0.23, left: size * 0.23, width: size * 0.18, height: size * 0.18, borderRadius: size * 0.09 }]} />
              <View style={[styles.crater, { top: size * 0.48, left: size * 0.57, width: size * 0.22, height: size * 0.22, borderRadius: size * 0.11 }]} />
              <View style={[styles.crater, { top: size * 0.66, left: size * 0.3, width: size * 0.12, height: size * 0.12, borderRadius: size * 0.06 }]} />
            </>}
            {phase === 'crescent' && <View testID="welcome-moon-crescent-cutout" style={{ position: 'absolute',
              backgroundColor: '#0e0c20', top: -size * 0.14, left: size * 0.28,
              width: size, height: size, borderRadius: size / 2 }} />}
          </View>
        </View>
      </View>
    </Field>
  </View>;
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute' },
  hanger: { position: 'absolute', top: 0 },
  field: { position: 'absolute', top: -72, left: -72, right: -72, bottom: -72 },
  inset: { position: 'absolute', top: 72, left: 72, right: 72, bottom: 72 },
  string: { position: 'absolute', top: 0, width: 1, backgroundColor: '#81758f' },
  disc: { position: 'absolute', left: 0, overflow: 'hidden', backgroundColor: '#ddd5eb' },
  halo: { position: 'absolute', left: 0, boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 32, spreadDistance: 6, color: 'rgba(221,213,235,0.17)' }] },
  sun: { backgroundColor: '#f1cf82' },
  sunHalo: { boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 32, spreadDistance: 6, color: 'rgba(245,211,143,0.2)' }] },
  crater: { position: 'absolute', backgroundColor: '#a89ab9', opacity: 0.26 },
});
