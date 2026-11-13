import React, { useMemo, useState } from 'react';
import { ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAccountCourseProgress, retryAccountProgress } from '../course/AccountCourseProgress';
import { CourseProgressNotice } from '../course/CourseProgressNotice';
import { PLAYS } from '../shared/localPlayService';
import { EDITORIAL_COLORS as colors, EDITORIAL_SPACING as spacing } from '../shared/editorialTheme';
import { EditorialFilters, EditorialHeading, EditorialPlayRow, EditorialText } from '../shared/EditorialUI';

const genres = ['All', 'Comedy', 'Tragedy', 'History', 'Romance'];

const getPlayStatus = (difficulty, completedCount) => {
  if (difficulty <= completedCount) return 'completed';
  if (difficulty === completedCount + 1) return 'active';
  return 'locked';
};

const getStatusCopy = (status, play) => {
  if (status === 'completed') return 'Completed';
  if (status === 'active') return play.difficulty === 1 ? 'Start' : 'Continue';
  return `Unlocks after ${play.difficulty - 1}`;
};

export default function CourseScreen() {
  const navigation = useNavigation();
  const [selectedGenre, setSelectedGenre] = useState('All');
  const accountProgress = useAccountCourseProgress();
  const completed = accountProgress.completedLevel;
  const plays = useMemo(() => PLAYS.slice().sort((a, b) => a.difficulty - b.difficulty), []);
  const totalPlays = plays.length;
  const completedCount = Math.max(0, Math.min(totalPlays, Number(completed) || 0));
  const nextUnlockedLevel = Math.min(totalPlays, completedCount + 1);
  const progress = totalPlays ? completedCount / totalPlays : 0;
  const activePlay = plays.find(play => play.difficulty === nextUnlockedLevel) || plays[plays.length - 1];
  const visiblePlays = plays.filter(play => selectedGenre === 'All' || play.genre === selectedGenre);
  const handlePlayPress = play => {
    if (play.difficulty > completedCount + 1) return;
    navigation.navigate('Lesson', { id: play.id });
  };

  if (accountProgress.status !== 'ready') return <CourseProgressNotice status={accountProgress.status} onRetry={retryAccountProgress} />;

  return <SafeAreaView style={styles.page} edges={['left', 'right']}>
    <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <EditorialHeading eyebrow="The Shakespeare course" title="One play at a time."
        subtitle={progress >= 1 ? 'The full path is complete.' : 'Read closely. Follow the story. Make each play your own.'} />
      <View style={styles.progress}>
        <EditorialText style={styles.progressLabel}>{completedCount} of {totalPlays} plays completed</EditorialText>
        <View accessibilityRole="progressbar" accessibilityLabel="Course progress"
          accessibilityValue={{ min: 0, max: totalPlays, now: completedCount }} style={styles.track}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
        {progress < 1 && !!activePlay && <EditorialText style={styles.next}>Next unlocked play: {activePlay.name}</EditorialText>}
      </View>
      <EditorialFilters values={genres} value={selectedGenre} onChange={setSelectedGenre} />
      <View>
        <EditorialText accessibilityLiveRegion="polite" style={styles.count}>
          {visiblePlays.length} {visiblePlays.length === 1 ? 'play' : 'plays'}
        </EditorialText>
        {visiblePlays.map(play => {
          const status = getPlayStatus(play.difficulty, completedCount);
          const statusCopy = getStatusCopy(status, play);
          return <EditorialPlayRow key={play.id} play={play} disabled={status === 'locked'}
            subtitle={`Play ${String(play.difficulty).padStart(2, '0')}`}
            accessibilityLabel={`${play.name}, ${statusCopy}`}
            accessibilityHint={status === 'locked' ? `Complete play ${play.difficulty - 1} to unlock this lesson.` : 'Open this play’s lesson.'}
            onPress={() => handlePlayPress(play)}>
            <EditorialText style={[styles.status, status === 'completed' && styles.completed, status === 'active' && styles.active]}>
              {statusCopy}
            </EditorialText>
          </EditorialPlayRow>;
        })}
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: spacing.horizontal,
    paddingTop: spacing.section, paddingBottom: 36, gap: spacing.section },
  progress: { gap: 12 },
  progressLabel: { color: colors.text, fontSize: 15, lineHeight: 23 },
  track: { height: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.gold },
  next: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  count: { fontSize: 13, lineHeight: 20, color: colors.muted, paddingBottom: 8 },
  status: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  completed: { color: colors.success },
  active: { color: colors.gold, fontWeight: '600' },
});
