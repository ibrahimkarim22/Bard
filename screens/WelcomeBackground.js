import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Image, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

const folds = [
  { width: '13%', color: '#4a0f19' }, { width: '10%', color: '#6b1824' },
  { width: '15%', color: '#360b12' }, { width: '12%', color: '#821e2b' },
  { width: '14%', color: '#54101c' }, { width: '11%', color: '#701825' },
  { width: '15%', color: '#3c0d16' }, { width: '10%', color: '#751a28' },
];

const foldShade = 'linear-gradient(90deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.08) 28%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.25) 100%)';
const hemLight = 'linear-gradient(to bottom, #d18c94 0%, #983345 30%, #46121d 100%)';
const gradientStyle = value => Platform.OS === 'web' ? { backgroundImage: value } : { experimental_backgroundImage: value };

// Fixed, low-amplitude grain dithers the dark blur gradients without another filter.
const grain = { uri: 'data:image/png;base64,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' };

export default function WelcomeBackground({ closing = false, onClosed, reopenOnFocus = false, light = 'moon' } = {}) {
  const state = useRef(null);
  if (!state.current) state.current = { open: new Animated.Value(0), soft: new Animated.Value(0), opened: false, covered: false };
  const curtain = state.current;
  const closedCallback = useRef(onClosed);
  closedCallback.current = onClosed;
  const preference = useRef({ known: false, reduced: true });
  const { width } = useWindowDimensions();
  const focused = useIsFocused();
  const modernNative = !!globalThis.nativeFabricUIManager && (Platform.OS === 'android' || Platform.OS === 'ios');
  const supportsGradients = Platform.OS === 'web' || modernNative;
  const supportsShadows = Platform.OS === 'web' || (modernNative && (Platform.OS !== 'android' || Number(Platform.Version) >= 28));
  const supportsBlur = Platform.OS === 'web' || (Platform.OS === 'android'
    && Number(Platform.Version) >= 31 && !!globalThis.nativeFabricUIManager);

  useEffect(() => {
    let active = true, preferenceChanged = false, loop = null, entrance = null;
    let { known, reduced } = preference.current;
    let foreground = AppState.currentState === 'active';
    const stop = settle => {
      const retiring = entrance; entrance = null; retiring?.stop();
      loop?.stop(); loop = null;
      curtain.open.stopAnimation(); curtain.soft.stopAnimation(); curtain.soft.setValue(0);
      if (settle) { curtain.open.setValue(1); curtain.opened = true; curtain.covered = false; }
    };
    const covered = () => {
      if (curtain.covered) return;
      curtain.covered = true;
      closedCallback.current?.();
    };
    const reconcile = () => {
      if (!active || !focused || !foreground) { stop(true); return; }
      if (!known) return;
      if (closing) {
        if (curtain.covered || entrance) return;
        loop?.stop(); loop = null; curtain.soft.stopAnimation(); curtain.soft.setValue(0);
        if (reduced) { curtain.open.setValue(0); covered(); return; }
        const shutting = Animated.timing(curtain.open, {
          toValue: 0, duration: 500, easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== 'web', isInteraction: false,
        });
        entrance = shutting;
        shutting.start(({ finished }) => {
          if (entrance !== shutting) return;
          entrance = null;
          if (finished && active && focused && foreground) covered();
        });
        return;
      }
      curtain.covered = false;
      if (reduced) { stop(true); return; }
      if (!curtain.opened) {
        if (entrance) return;
        const opening = Animated.timing(curtain.open, {
          toValue: 1, duration: 800, easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== 'web', isInteraction: false,
        });
        entrance = opening;
        opening.start(({ finished }) => {
          if (entrance !== opening) return;
          entrance = null;
          if (!finished || !active || !focused || !foreground || reduced) return;
          curtain.opened = true; reconcile();
        });
        return;
      }
      if (loop || !supportsBlur) return;
      const timing = (toValue, duration, delay = 0) => Animated.timing(curtain.soft, {
        // The native Animated driver cannot update filter in RN 0.79.
        toValue, duration, delay, easing: Easing.inOut(Easing.sin), useNativeDriver: false, isInteraction: false,
      });
      loop = Animated.loop(Animated.sequence([
        timing(1, 1500), timing(1, 0, 400), timing(0, 1500), timing(0, 0, 1400),
      ]));
      loop.start();
    };
    if (!focused) {
      stop(!reopenOnFocus);
      preference.current.known = false;
      if (reopenOnFocus) {
        curtain.open.setValue(0); curtain.opened = false; curtain.covered = false;
      }
      return () => { active = false; };
    }
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      if (!active) return;
      preferenceChanged = true; known = true; reduced = enabled !== false;
      preference.current = { known, reduced };
      if (reduced && closing) stop(false);
      reconcile();
    });
    const app = AppState.addEventListener('change', next => {
      if (!active) return;
      foreground = next === 'active'; reconcile();
    });
    const resolve = enabled => {
      if (!active || preferenceChanged) return;
      known = true; reduced = enabled !== false;
      preference.current = { known, reduced };
      reconcile();
    };
    if (!known) {
      try { Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(resolve, () => resolve(true)); }
      catch { resolve(true); }
    }
    reconcile();
    return () => { active = false; motion.remove(); app.remove(); stop(false); };
  }, [focused, curtain, supportsBlur, closing, reopenOnFocus]);

  const Field = supportsBlur ? Animated.View : View;

  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={styles.atmosphere}>
    <Field testID="welcome-curtain-focus" style={[styles.soft, supportsBlur && {
      filter: curtain.soft.interpolate({ inputRange: [0, 1], outputRange: ['blur(0px)', 'blur(6px)'], extrapolate: 'clamp' }),
    }]}>
      <View style={styles.inset}>
        {['left', 'right'].map(side => <Animated.View key={side} testID={`curtain-panel-${side}`}
          style={[styles.panel, supportsShadows && { boxShadow: [{
            offsetX: side === 'left' ? 8 : -8, offsetY: 8, blurRadius: 22, spreadDistance: 0, color: 'rgba(0,0,0,0.38)',
          }] }, { [side]: 0, transform: [{ translateX: curtain.open.interpolate({
            inputRange: [0, 1], outputRange: [0, width * (side === 'left' ? -0.31 : 0.31)], extrapolate: 'clamp',
          }) }] }]}>
          <View style={[styles.fabric, side === 'right' && styles.mirror]}>
            {folds.map((fold, index) => <View key={index} testID="curtain-fold"
              style={[styles.fold, { width: fold.width, backgroundColor: fold.color }, supportsGradients && gradientStyle(foldShade)]}>
              <View style={styles.sheen} />
            </View>)}
          </View>
          {supportsGradients && <View testID={`curtain-moonlight-${side}`} style={[styles.illumination,
            gradientStyle(`linear-gradient(${side === 'left' ? 225 : 135}deg, rgba(${light === 'sun' ? '245,211,143' : '221,213,235'},0.18) 0%, rgba(${light === 'sun' ? '245,211,143' : '221,213,235'},0.07) 25%, rgba(${light === 'sun' ? '245,211,143' : '221,213,235'},0) 68%)`),
          ]} />}
          <View style={[styles.hem, side === 'left' ? { right: 0 } : { left: 0 }, supportsGradients && gradientStyle(hemLight)]} />
        </Animated.View>)}
      </View>
    </Field>
    <Image source={grain} resizeMode="repeat" style={styles.grain} />
  </View>;
}

const styles = StyleSheet.create({
  atmosphere: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  panel: { position: 'absolute', top: 0, bottom: 0, width: '50%', backgroundColor: '#4a0f19' },
  fabric: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  mirror: { transform: [{ scaleX: -1 }] },
  fold: { height: '100%', borderLeftWidth: 1, borderLeftColor: '#28090f' },
  sheen: { position: 'absolute', top: 0, bottom: 0, right: '18%', width: 1, backgroundColor: '#be6370', opacity: 0.15 },
  hem: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#983345' },
  illumination: { ...StyleSheet.absoluteFillObject },
  grain: { ...StyleSheet.absoluteFillObject, opacity: 3 / 255 },
  // The transparent margin lets the blur spread without a rectangular crop.
  soft: { position: 'absolute', top: -24, left: -24, right: -24, bottom: -24 },
  inset: { position: 'absolute', top: 24, left: 24, right: 24, bottom: 24 },
});
