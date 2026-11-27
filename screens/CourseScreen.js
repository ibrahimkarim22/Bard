import React, { useMemo } from 'react';
import { FlatList, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faLock } from '@fortawesome/free-solid-svg-icons';
import { useAccountCourseProgress, retryAccountProgress } from '../course/AccountCourseProgress';
import { CourseProgressNotice } from '../course/CourseProgressNotice';
import { PLAYS } from '../shared/localPlayService';
import { EDITORIAL_COLORS as colors, EDITORIAL_SPACING as spacing } from '../shared/editorialTheme';
import { EditorialText } from '../shared/EditorialUI';
import PosterImage from '../shared/PosterImage';
import { useCourseUnlock } from '../course/useCourseUnlock';
import { useCourseArrival } from '../course/useCourseArrival';
import { CourseUnlockLock, CourseUnlockPath } from '../course/CourseUnlockVisuals';

const getPlayStatus = (difficulty, completedCount) => {
  if (difficulty <= completedCount) return 'completed';
  if (difficulty === completedCount + 1) return 'active';
  return 'locked';
};

const getStatusCopy = status => {
  if (status === 'completed') return 'Completed';
  if (status === 'active') return 'You are here';
  return 'Locked';
};

const viewabilityConfig = { viewAreaCoveragePercentThreshold: 10 };

export default function CourseScreen() {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const accountProgress = useAccountCourseProgress();
  const completed = accountProgress.completedLevel;
  const plays = useMemo(() => PLAYS.slice().sort((a, b) => a.difficulty - b.difficulty), []);
  const totalPlays = plays.length;
  const completedCount = Math.max(0, Math.min(totalPlays, Number(completed) || 0));
  const arrival = useCourseArrival({ progress: accountProgress, plays });
  const unlock = useCourseUnlock({ request: arrival.request, arrivalReady: arrival.ready, onConsume: arrival.onConsume,
    progress: accountProgress, plays, navigation, focused });
  const presentationKey = `${completedCount}:${unlock.session?.id || ''}:${unlock.phase || ''}`;
  const handlePlayPress = play => {
    if (play.difficulty > completedCount + 1) return;
    navigation.navigate('Lesson', { id: play.id });
  };

  if (accountProgress.status !== 'ready') return <CourseProgressNotice status={accountProgress.status} onRetry={retryAccountProgress} />;

  return <SafeAreaView style={styles.page} edges={['left', 'right', 'bottom']}>
    <StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <FlatList ref={unlock.listRef} data={plays} extraData={presentationKey} keyExtractor={play => play.id}
      onLayout={unlock.onLayout} onScrollToIndexFailed={unlock.onScrollToIndexFailed}
      onViewableItemsChanged={unlock.onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
      onScrollBeginDrag={unlock.onScrollBeginDrag}
      onScroll={unlock.onScroll} scrollEventThrottle={16}
      initialNumToRender={2} maxToRenderPerBatch={2} windowSize={3} updateCellsBatchingPeriod={80}
      removeClippedSubviews={false} style={[styles.scroll, unlock.preparing && styles.preparing]} contentContainerStyle={styles.content}
      pointerEvents={unlock.preparing ? 'none' : 'auto'} accessibilityElementsHidden={unlock.preparing}
      importantForAccessibility={unlock.preparing ? 'no-hide-descendants' : 'auto'}
      showsVerticalScrollIndicator={false} renderItem={({ item: play, index }) => {
          const target = unlock.session?.to.id === play.id;
          const source = unlock.session?.from.id === play.id;
          const awaitingUnlock = target && unlock.phase !== 'sparkling';
          const status = awaitingUnlock ? 'locked' : getPlayStatus(play.difficulty, completedCount);
          const statusCopy = target && unlock.phase === 'unlocking' ? 'Unlocking…'
            : target && unlock.phase === 'sparkling' ? 'Play unlocked' : getStatusCopy(status);
          const active = status === 'active', done = status === 'completed', locked = status === 'locked';
          const illuminated = active || target && (unlock.phase === 'unlocking' || unlock.phase === 'sparkling');
          const priorDone = !awaitingUnlock && index > 0 && getPlayStatus(plays[index - 1].difficulty, completedCount) === 'completed';
          return <View key={play.id} testID={`course-step-${play.id}`} style={styles.step}
            onLayout={event => unlock.onStepLayout(play.id, event.nativeEvent.layout.height)}>
            <View testID={`course-rail-${play.id}`} style={styles.rail} accessible={false}
              accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {index > 0 && <View testID={`course-line-before-${play.id}`}
                style={[styles.line, styles.before, priorDone && styles.finishedLine]} />}
              {index < plays.length - 1 && <View testID={`course-line-after-${play.id}`}
                style={[styles.line, styles.after, done && !source && styles.finishedLine]} />}
              <View style={[styles.node, done && styles.finishedNode, illuminated && styles.currentNode]}>
                {done ? <FontAwesomeIcon icon={faCheck} size={14} color={colors.onGold} accessible={false} />
                  : locked && !target ? <FontAwesomeIcon icon={faLock} size={14} color={colors.muted} accessible={false} />
                  : <EditorialText accessible={false} style={[styles.number, illuminated && styles.currentNumber]}>
                    {String(play.difficulty).padStart(2, '0')}
                  </EditorialText>}
              </View>
              {source && <CourseUnlockPath session={unlock.session} />}
              {target && <CourseUnlockPath session={unlock.session} segment="incoming" />}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`${play.name}, ${statusCopy}`}
              accessibilityState={{ disabled: locked, selected: active }} disabled={locked}
              accessibilityHint={locked ? 'This lesson is further along your course path.' : 'Open this play’s lesson.'}
              onPress={locked ? undefined : () => handlePlayPress(play)}
              style={({ pressed }) => [styles.posterCard, active && styles.currentCard, pressed && styles.pressed]}>
              <View style={styles.artwork}>
                <PosterImage source={play.mainImage} style={styles.poster} resizeMode="cover" resizeMethod="resize" />
                {target && <CourseUnlockLock session={unlock.session} phase={unlock.phase} />}
              </View>
              <View style={styles.caption}>
                <EditorialText serif style={styles.title}>{play.name}</EditorialText>
                <View style={styles.statusRow}>
                  {locked && <FontAwesomeIcon icon={faLock} size={11} color={colors.muted} accessible={false} />}
                  <EditorialText style={[styles.status, done && styles.completed, active && styles.active]}>{statusCopy}</EditorialText>
                </View>
              </View>
            </Pressable>
          </View>;
        }} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  preparing: { opacity: 0 },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: spacing.horizontal,
    paddingTop: 20, paddingBottom: 36 },
  step: { flexDirection: 'row', gap: 16 },
  rail: { width: 40, alignItems: 'center' },
  artwork: { position: 'relative' },
  line: { position: 'absolute', width: 3, left: 18.5, backgroundColor: colors.border },
  before: { top: 0, height: 24 },
  after: { top: 24, bottom: 0 },
  finishedLine: { backgroundColor: colors.gold },
  node: { minWidth: 40, minHeight: 40, marginTop: 4, borderRadius: 20, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  finishedNode: { backgroundColor: colors.gold, borderColor: colors.gold },
  currentNode: { borderColor: colors.gold, borderWidth: 2, backgroundColor: colors.gold, zIndex: 4,
    shadowColor: colors.gold, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  number: { fontSize: 13, lineHeight: 20, color: colors.muted },
  currentNumber: { color: colors.onGold, fontWeight: '700' },
  posterCard: { flex: 1, minWidth: 0, marginBottom: 28, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden', backgroundColor: colors.surface },
  currentCard: { borderColor: colors.gold },
  poster: { width: '100%', aspectRatio: 0.85 },
  caption: { padding: 16, gap: 10 },
  title: { fontSize: 21, lineHeight: 29, color: colors.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  status: { color: colors.muted, fontSize: 14, lineHeight: 22, flexShrink: 1 },
  completed: { color: colors.success },
  active: { color: colors.gold, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
