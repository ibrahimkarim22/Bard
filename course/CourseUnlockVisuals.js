import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { EDITORIAL_COLORS as colors } from '../shared/editorialTheme';

const hidden = { pointerEvents: 'none', accessible: false, accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' };
const interpolate = (value, outputRange, inputRange = [0, 1]) => value.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });

export function CourseUnlockPath({ session, segment = 'outgoing' }) {
  if (!session || !Number.isFinite(session.sourceHeight) || session.sourceHeight <= 0) return null;
  // Draw inside each FlatList cell: the next cell otherwise paints over the
  // final part of a line extending beyond the previous row's bounds.
  const incoming = segment === 'incoming';
  const tail = Math.min(24, session.sourceHeight / 2);
  const split = (session.sourceHeight - tail) / session.sourceHeight;
  const distance = incoming ? interpolate(session.path, [0, tail], [split, 1])
    : interpolate(session.path, [0, session.sourceHeight - tail], [0, split]);
  const prefix = incoming ? 'course-unlock-path-incoming' : 'course-unlock-path';
  const opacity = session.phase === 'unlocking' || session.phase === 'sparkling' ? 0
    : interpolate(session.path, incoming ? [0, 0, 1] : [1, 1, 0], [0, split, 1]);
  return <View testID={prefix} {...hidden} style={styles.path}>
    <Animated.View testID={`${prefix}-fill`} style={[styles.pathFill, incoming && styles.incomingFill, { height: distance }]} />
    <Animated.View testID={`${prefix}-dot`} style={[styles.pathDot, incoming && styles.incomingDot,
      { opacity, transform: [{ translateY: distance }] }]} />
  </View>;
}

export function CourseUnlockLock({ session, phase }) {
  if (!session) return null;
  const opening = phase === 'unlocking' || phase === 'sparkling';
  const sparkling = phase === 'sparkling';
  const shackle = opening ? [
    { translateY: interpolate(session.lock, [0, -12]) },
    { translateX: interpolate(session.lock, [0, 5]) },
    { rotate: interpolate(session.lock, ['0deg', '-34deg']) },
  ] : [{ translateY: 0 }, { translateX: 0 }, { rotate: '0deg' }];
  const lockOpacity = sparkling ? interpolate(session.sparkle, [1, 0.9, 0], [0, 0.25, 1]) : 1;
  return <View testID="course-unlock-lock-overlay" {...hidden} style={styles.overlay}>
    <View style={styles.anchor}>
      {sparkling && <Animated.View testID="course-unlock-halo" style={[styles.halo, {
        opacity: interpolate(session.sparkle, [0.5, 0.35, 0], [0, 0.25, 1]),
        transform: [{ scale: interpolate(session.sparkle, [1, 1.9]) }],
      }]} />}
      <Animated.View testID="course-unlock-lock" style={[styles.lock, { opacity: lockOpacity }]}>
        <View style={styles.disc} />
        <Animated.View testID="course-unlock-shackle" style={[styles.shackle, { transform: shackle }]} />
        <View style={styles.body}>
          <View style={styles.bodyHighlight} />
          <View style={styles.keyhole} />
          <View style={styles.keyStem} />
        </View>
      </Animated.View>
      {sparkling && Array.from({ length: 10 }, (_, index) => {
        const angle = index * Math.PI / 5;
        const radius = 48 + index % 3 * 7;
        return <Animated.View key={index} testID="course-unlock-sparkle" style={[styles.sparkle,
          index % 3 === 0 ? styles.ray : styles.diamond, {
            backgroundColor: index % 3 === 1 ? colors.text : colors.gold,
            opacity: interpolate(session.sparkle, [0, 1, 0.75, 0], [0, 0.12, 0.65, 1]),
            transform: [
              { translateX: interpolate(session.sparkle, [Math.cos(angle) * 12, Math.cos(angle) * radius]) },
              { translateY: interpolate(session.sparkle, [Math.sin(angle) * 12, Math.sin(angle) * radius]) },
              { rotate: `${index * 36 + 45}deg` },
              { scale: interpolate(session.sparkle, [0.35, 1, 0.4], [0, 0.25, 1]) },
            ],
          }]} />;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  path: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 40, zIndex: 3, overflow: 'visible' },
  pathFill: { position: 'absolute', left: 18.5, top: 24, width: 3, borderRadius: 2, backgroundColor: colors.gold },
  incomingFill: { top: 0 },
  incomingDot: { top: -5 },
  pathDot: { position: 'absolute', left: 15, top: 19, width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.text, borderWidth: 2, borderColor: colors.gold,
    shadowColor: colors.gold, shadowOpacity: 0.7, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 4 },
  anchor: { width: 80, height: 88, overflow: 'visible' },
  lock: { ...StyleSheet.absoluteFillObject },
  disc: { position: 'absolute', left: 4, top: 8, width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.background, opacity: 0.92, borderWidth: 1, borderColor: colors.gold },
  shackle: { position: 'absolute', left: 25, top: 19, width: 30, height: 29,
    borderWidth: 4, borderBottomWidth: 0, borderColor: colors.gold, borderTopLeftRadius: 15, borderTopRightRadius: 15 },
  body: { position: 'absolute', left: 21, top: 39, width: 38, height: 29, borderRadius: 6,
    backgroundColor: colors.gold, borderWidth: 1, borderColor: colors.gold, overflow: 'hidden' },
  bodyHighlight: { position: 'absolute', top: 1, left: 2, right: 2, height: 1, backgroundColor: colors.text, opacity: 0.6 },
  keyhole: { position: 'absolute', top: 8, left: 15, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onGold },
  keyStem: { position: 'absolute', top: 12, left: 16.5, width: 3, height: 7, borderRadius: 1, backgroundColor: colors.onGold },
  halo: { position: 'absolute', left: 4, top: 8, width: 72, height: 72, borderRadius: 36,
    borderWidth: 2, borderColor: colors.gold, backgroundColor: colors.gold },
  sparkle: { position: 'absolute', left: 38, top: 42 },
  ray: { width: 2, height: 9, borderRadius: 1 },
  diamond: { width: 5, height: 5, borderRadius: 0.5 },
});
