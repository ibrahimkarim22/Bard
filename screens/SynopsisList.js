import React, { useMemo, useRef, useState } from 'react';
import { Keyboard, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { PLAYS, getLocalPlayEntry } from '../shared/localPlayService';
import { SYNOPSIS_GENRES, filterSynopsisPlays } from '../shared/synopsisCatalogue';
import { EDITORIAL_COLORS as colors, EDITORIAL_SPACING as spacing } from '../shared/editorialTheme';
import {
  EditorialButton,
  EditorialFilters,
  EditorialHeading,
  EditorialPlayRow,
  EditorialSearch,
  EditorialText,
} from '../shared/EditorialUI';

export default function SynopsisList() {
  const navigation = useNavigation();
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('All');
  const scroll = useRef(null);
  const plays = useMemo(() => PLAYS.map(play => {
    const entry = getLocalPlayEntry(play.id);
    return { ...play, aliases: [entry?.code, entry?.play?.title, entry?.play?.fullTitle].filter(Boolean) };
  }), []);
  const visible = useMemo(() => filterSynopsisPlays(plays, query, genre), [plays, query, genre]);
  const top = () => scroll.current?.scrollTo({ y: 0, animated: false });
  const search = value => { setQuery(value); top(); };
  const chooseGenre = value => { setGenre(value); top(); };
  const open = play => { Keyboard.dismiss(); navigation.navigate('Synopsis', { id: play.id }); };

  return <SafeAreaView style={styles.page} edges={['left', 'right']}>
    <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
    <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <EditorialHeading eyebrow="The stories" title="Synopses"
        subtitle="Find your way through the story, then return to the words." />
      <View style={styles.controls}>
        <EditorialSearch value={query} onChangeText={search} onClear={() => search('')} />
        <EditorialFilters values={SYNOPSIS_GENRES} value={genre} onChange={chooseGenre} />
      </View>
      <View>
        <EditorialText style={styles.count} accessibilityLiveRegion="polite">
          {visible.length + (visible.length === 1 ? ' play' : ' plays')}
        </EditorialText>
        {visible.map(play => <EditorialPlayRow key={play.id} play={play}
          accessibilityLabel={play.name + ' synopsis'} accessibilityHint={'Read the ' + play.genre.toLowerCase() + ' synopsis.'}
          onPress={() => open(play)} />)}
        {!visible.length && <View style={styles.empty}>
          <EditorialText serif accessibilityRole="header" style={styles.emptyTitle}>No plays found</EditorialText>
          <EditorialText style={styles.detail}>Try another title or genre.</EditorialText>
          <EditorialButton title="Clear search and filters" variant="quiet" onPress={() => { search(''); chooseGenre('All'); }} />
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
