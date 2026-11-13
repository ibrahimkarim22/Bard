import React, { useMemo, useState } from 'react';
import { ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { PLAYS } from '../shared/localPlayService';
import { EDITORIAL_COLORS as colors, EDITORIAL_SPACING as spacing } from '../shared/editorialTheme';
import {
  EditorialButton,
  EditorialFilters,
  EditorialHeading,
  EditorialPlayRow,
  EditorialSearch,
  EditorialText,
} from '../shared/EditorialUI';

const genres = ['All', 'Comedy', 'Tragedy', 'History', 'Romance'];

export default function FreeFolger() {
  const navigation = useNavigation();
  const [query, setQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('All');
  const plays = useMemo(() => PLAYS.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))), []);
  const filteredPlays = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return plays.filter(play => (selectedGenre === 'All' || play.genre === selectedGenre)
      && (!normalizedQuery || String(play.name).toLowerCase().includes(normalizedQuery)
        || String(play.genre).toLowerCase().includes(normalizedQuery)));
  }, [plays, query, selectedGenre]);
  const clear = () => { setQuery(''); setSelectedGenre('All'); };

  return <SafeAreaView style={styles.page} edges={['left', 'right']}>
    <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
      <EditorialHeading eyebrow="The collected works" title="The Library"
        subtitle={`${plays.length} complete plays. A lifetime of stories to return to.`} />
      <View style={styles.controls}>
        <EditorialSearch value={query} onChangeText={setQuery} onClear={() => setQuery('')}
          placeholder="Search plays" accessibilityLabel="Search plays" />
        <EditorialFilters values={genres} value={selectedGenre} onChange={setSelectedGenre} />
      </View>
      <View>
        <EditorialText accessibilityLiveRegion="polite" style={styles.count}>
          {filteredPlays.length} {filteredPlays.length === 1 ? 'play' : 'plays'}
        </EditorialText>
        {filteredPlays.map(play => <EditorialPlayRow key={play.id} play={play}
          accessibilityLabel={`${play.name}, read play`} accessibilityHint="Open the complete play in the reader."
          onPress={() => navigation.navigate('ReadFolger', { id: play.id })} />)}
        {!filteredPlays.length && <View style={styles.empty}>
          <EditorialText serif accessibilityRole="header" style={styles.emptyTitle}>No plays found</EditorialText>
          <EditorialText style={styles.detail}>Try another title or switch genre.</EditorialText>
          <EditorialButton title="Clear search and filters" variant="quiet" onPress={clear} />
        </View>}
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: spacing.horizontal,
    paddingTop: spacing.section, paddingBottom: 36, gap: spacing.section },
  controls: { gap: 16 },
  count: { fontSize: 13, lineHeight: 20, color: colors.muted, paddingBottom: 8 },
  empty: { paddingTop: 24, paddingBottom: 20, gap: 12 },
  emptyTitle: { fontSize: 26, lineHeight: 34 },
  detail: { color: colors.muted },
});
