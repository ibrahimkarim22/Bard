import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { EDITORIAL_COLORS as C } from './editorialTheme';

const retryDelays = [500, 1500];

function hasImageSource(source) {
  if (Array.isArray(source)) return source.some(hasImageSource);
  if (typeof source === 'number') return true;
  if (typeof source === 'string') return source.length > 0;
  return typeof source?.uri === 'string' && source.uri.length > 0;
}

export default function PosterImage({
  source, style, resizeMode = 'cover', accessible = false, accessibilityLabel,
  fallbackLabel = 'Artwork unavailable', pointerEvents = 'none', onLoad, onError, onLoadEnd, ...imageProps
}) {
  const sourceKey = JSON.stringify(source);
  const request = useMemo(() => ({}), [sourceKey]);
  const hasSource = hasImageSource(source);
  const [result, setResult] = useState(null);
  const currentResult = result?.request === request ? result : null;
  const retryIndex = currentResult?.retryIndex || 0;
  const attempt = useMemo(() => ({ outcome: null, timer: null }), [request, retryIndex]);
  const activeAttempt = useRef(attempt);
  const status = !hasSource ? 'error' : currentResult?.status || 'loading';

  // Speculative source renders must leave the committed image's callbacks active.
  useLayoutEffect(() => {
    activeAttempt.current = attempt;
    return () => {
      if (attempt.timer !== null) clearTimeout(attempt.timer);
      if (activeAttempt.current === attempt) activeAttempt.current = null;
    };
  }, [attempt]);

  const isCurrent = () => activeAttempt.current === attempt;
  const handleLoad = event => {
    if (!isCurrent() || attempt.outcome) return;
    attempt.outcome = 'loaded';
    setResult({ request, retryIndex, status: 'loaded' });
    onLoad?.(event);
  };
  const handleError = event => {
    if (!isCurrent() || attempt.outcome) return;
    attempt.outcome = 'error';
    if (retryIndex < retryDelays.length) {
      setResult({ request, retryIndex, status: 'loading' });
      attempt.timer = setTimeout(() => {
        attempt.timer = null;
        if (isCurrent()) setResult({ request, retryIndex: retryIndex + 1, status: 'loading' });
      }, retryDelays[retryIndex]);
    } else {
      setResult({ request, retryIndex, status: 'error' });
    }
    onError?.(event);
  };

  return <View style={[styles.frame, style]} pointerEvents={pointerEvents} accessible={accessible}
    accessibilityRole={accessible ? 'image' : undefined}
    accessibilityLabel={accessible ? (status === 'error' ? fallbackLabel : accessibilityLabel) : undefined}
    accessibilityState={accessible ? { busy: status === 'loading' } : undefined}
    accessibilityElementsHidden={!accessible} importantForAccessibility={accessible ? 'yes' : 'no-hide-descendants'}>
    {hasSource && <Image {...imageProps} key={JSON.stringify([sourceKey, retryIndex])} source={source} resizeMode={resizeMode} style={styles.fill}
      accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      onLoad={handleLoad} onError={handleError}
      onLoadEnd={onLoadEnd ? event => { if (isCurrent() && attempt.outcome !== 'error') onLoadEnd(event); } : undefined} />}
    {status !== 'loaded' && <View pointerEvents="none" accessible={false} accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants" style={[styles.fill, styles.placeholder]}>
      {status === 'loading'
        ? <ActivityIndicator size="small" color={C.gold} accessible={false} />
        : <Text accessible={false} allowFontScaling style={styles.fallback}>{fallbackLabel}</Text>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { backgroundColor: C.soft, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  placeholder: { backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' },
  fallback: { color: C.muted, fontSize: 13, lineHeight: 18, textAlign: 'center', paddingHorizontal: 6 },
});
