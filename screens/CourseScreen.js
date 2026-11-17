import React, { useMemo } from 'react';
import { FlatList, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faLock } from '@fortawesome/free-solid-svg-icons';
import { useAccountCourseProgress, retryAccountProgress } from '../course/AccountCourseProgress';
import { CourseProgressNotice } from '../course/CourseProgressNotice';
import { PLAYS } from '../shared/localPlayService';
import { EDITORIAL_COLORS as colors, EDITORIAL_SPACING as spacing } from '../shared/editorialTheme';
import { EditorialText } from '../shared/EditorialUI';
import PosterImage from '../shared/PosterImage';

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

export default function CourseScreen() {
  const navigation = useNavigation();
  const accountProgress = useAccountCourseProgress();
  const completed = accountProgress.completedLevel;
  const plays = useMemo(() => PLAYS.slice().sort((a, b) => a.difficulty - b.difficulty), []);
  const totalPlays = plays.length;
  const completedCount = Math.max(0, Math.min(totalPlays, Number(completed) || 0));
  const handlePlayPress = play => {
    if (play.difficulty > completedCount + 1) return;
    navigation.navigate('Lesson', { id: play.id });
  };

  if (accountProgress.status !== 'ready') return <CourseProgressNotice status={accountProgress.status} onRetry={retryAccountProgress} />;

  return <SafeAreaView style={styles.page} edges={['left', 'right', 'bottom']}>
    <StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <FlatList data={plays} extraData={completedCount} keyExtractor={play => play.id}
      initialNumToRender={2} maxToRenderPerBatch={2} windowSize={3} updateCellsBatchingPeriod={80}
      removeClippedSubviews={false} style={styles.scroll} contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false} renderItem={({ item: play, index }) => {
          const status = getPlayStatus(play.difficulty, completedCount);
          const statusCopy = getStatusCopy(status);
          const active = status === 'active', done = status === 'completed', locked = status === 'locked';
          const priorDone = index > 0 && getPlayStatus(plays[index - 1].difficulty, completedCount) === 'completed';
          return <View key={play.id} testID={`course-step-${play.id}`} style={styles.step}>
            <View testID={`course-rail-${play.id}`} style={styles.rail} accessible={false}
              accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {index > 0 && <View testID={`course-line-before-${play.id}`}
                style={[styles.line, styles.before, priorDone && styles.finishedLine]} />}
              {index < plays.length - 1 && <View testID={`course-line-after-${play.id}`}
                style={[styles.line, styles.after, done && styles.finishedLine]} />}
              <View style={[styles.node, done && styles.finishedNode, active && styles.currentNode]}>
                {done ? <FontAwesomeIcon icon={faCheck} size={14} color={colors.onGold} accessible={false} />
                  : <EditorialText accessible={false} style={[styles.number, active && styles.currentNumber]}>
                    {String(play.difficulty).padStart(2, '0')}
                  </EditorialText>}
              </View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`${play.name}, ${statusCopy}`}
              accessibilityState={{ disabled: locked, selected: active }} disabled={locked}
              accessibilityHint={locked ? 'This lesson is further along your course path.' : 'Open this play’s lesson.'}
              onPress={locked ? undefined : () => handlePlayPress(play)}
              style={({ pressed }) => [styles.posterCard, active && styles.currentCard, pressed && styles.pressed]}>
              <PosterImage source={play.mainImage} style={styles.poster} resizeMode="cover" resizeMethod="resize" />
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
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: spacing.horizontal,
    paddingTop: 20, paddingBottom: 36 },
  step: { flexDirection: 'row', gap: 16 },
  rail: { width: 40, alignItems: 'center' },
  line: { position: 'absolute', width: 2, left: 19, backgroundColor: colors.border },
  before: { top: 0, height: 24 },
  after: { top: 24, bottom: 0 },
  finishedLine: { backgroundColor: colors.gold },
  node: { minWidth: 40, minHeight: 40, marginTop: 4, borderRadius: 20, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  finishedNode: { backgroundColor: colors.gold, borderColor: colors.gold },
  currentNode: { borderColor: colors.gold, borderWidth: 2, backgroundColor: colors.surface },
  number: { fontSize: 13, lineHeight: 20, color: colors.muted },
  currentNumber: { color: colors.gold, fontWeight: '700' },
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
