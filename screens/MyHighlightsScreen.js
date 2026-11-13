import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMyHighlightsCatalogue } from '../reader/useMyHighlights';
import HighlightStorageStatus from '../reader/HighlightStorageStatus';
import { getLocalPlayEntry } from '../shared/localPlayService';
import { EditorialPlayRow, EditorialText } from '../shared/EditorialUI';
import { EDITORIAL_COLORS as C, EDITORIAL_SPACING as S, EDITORIAL_HIGHLIGHT_THEME as H } from '../shared/editorialTheme';

export default function MyHighlightsScreen() {
  const navigation = useNavigation();
  const { owner, rows, loading, error, refreshReadOnly, storageStatus } = useMyHighlightsCatalogue();
  if (!owner.ready) return <View style={styles.state}><ActivityIndicator color={H.highlightAction} /><EditorialText style={styles.detail}>Loading sign-in…</EditorialText></View>;
  if (!owner.uid) return <View style={styles.state}><EditorialText serif style={styles.title}>Sign in to see your highlights</EditorialText></View>;
  const empty = <View style={styles.state}>
    {loading ? <><ActivityIndicator color={H.highlightAction} /><EditorialText style={styles.detail}>Loading saved highlights…</EditorialText></> :
      error ? <EditorialText accessibilityRole="alert" style={styles.detail}>Highlights could not be loaded.</EditorialText> :
        <><EditorialText serif style={styles.title}>Your passages, together</EditorialText><EditorialText style={styles.detail}>Select a passage in a play, then choose Highlight. Saved passages will appear here.</EditorialText></>}
  </View>;
  return <View style={styles.screen}>
    <FlatList key={owner.generation} data={rows} keyExtractor={item => item.workKey} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
      contentContainerStyle={styles.content} ListEmptyComponent={empty}
      ListHeaderComponent={<View style={styles.header}>
        <HighlightStorageStatus theme={H} {...storageStatus} />
        {!!error && <View><EditorialText accessibilityRole="alert" style={styles.detail}>Highlights could not be loaded.</EditorialText><Pressable accessibilityRole="button" accessibilityLabel="Retry reading highlights" onPress={refreshReadOnly} style={({pressed})=>[styles.button,pressed&&styles.pressed]}><EditorialText style={styles.buttonLabel}>Try again</EditorialText></Pressable></View>}
      </View>}
      renderItem={({ item }) => {
        const entry = item.workKey ? getLocalPlayEntry(item.workKey) : null;
        return <EditorialPlayRow play={{ name: item.title, mainImage: entry?.mainImage, genre: entry?.play?.genre || entry?.genre }}
          subtitle={item.countLabel} accessibilityLabel={`${item.title}, ${item.countLabel}${item.available ? '' : ', unavailable play'}`}
          accessibilityHint="Open saved passages for this play"
          onPress={() => navigation.push('PlayHighlights', { workKey: item.workKey, ownerGeneration: owner.generation })}>
          {!item.available && <EditorialText style={styles.rowDetail}>This play is unavailable.</EditorialText>}
          {!!(item.readError || item.error) && <EditorialText style={styles.rowDetail}>Some highlights could not be loaded. Open this play for details.</EditorialText>}
        </EditorialPlayRow>;
      }} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  content: { width: '100%', maxWidth: S.maxWidth, alignSelf: 'center', paddingHorizontal: S.horizontal, paddingBottom: 40 },
  header: { paddingTop: S.small },
  title: { color: C.text, fontSize: 28, lineHeight: 36, marginBottom: S.small },
  detail: { color: C.muted, fontSize: 17, lineHeight: 26, marginBottom: S.small },
  rowDetail: { color: C.muted, fontSize: 15, lineHeight: 23 },
  state: { flex: 1, backgroundColor: C.background, justifyContent: 'center', padding: S.horizontal, gap: S.small },
  pressed: { backgroundColor: C.soft },
  button: { backgroundColor: C.soft, borderRadius: 6, minHeight: 52, justifyContent: 'center', padding: 14, marginBottom: S.small },
  buttonLabel: { color: C.gold, fontSize: 17, lineHeight: 26, fontWeight: '600' },
});
