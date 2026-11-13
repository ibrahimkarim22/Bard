import React from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { EditorialText as Text } from "../shared/EditorialUI";
import { EDITORIAL_COLORS as C, EDITORIAL_SPACING as S } from "../shared/editorialTheme";
import MedalArtwork from "./MedalArtwork";
import LockedMedal from "./LockedMedal";
import { getMedalCollection } from "./medalCollection";
import { getMedalAppearance } from "./medalAppearance";

export default function MedalsCollection({ plays, completedLevel, onOpenLesson }) {
  const { width, fontScale } = useWindowDimensions();
  const collection = getMedalCollection(plays, completedLevel);
  const singleColumn = width < 360 || fontScale > 1.2;
  const artworkSize = singleColumn ? 140 : Math.max(80, Math.min(140, Math.floor((width - 48) / 2) - 32));
  return <View style={styles.collection}>
    <Text serif allowFontScaling accessibilityRole="header" style={styles.heading}>Your medal collection</Text>
    <Text allowFontScaling style={styles.count}>{`${collection.earnedCount} of ${collection.total} medals earned`}</Text>
    <View style={styles.grid}>
      {collection.items.map(({ play, earned }) => <Pressable key={play.id}
        accessibilityRole="button" accessibilityLabel={`${play.name} medal, ${earned ? `${getMedalAppearance(play.genre).genreLabel}, Earned` : "Locked"}`}
        accessibilityHint={earned ? "Open this play’s lesson." : "Complete this play to add its medal."}
        accessibilityState={{ disabled: !earned }} disabled={!earned}
        onPress={earned && onOpenLesson ? () => onOpenLesson(play) : undefined}
        style={[styles.card, { width: singleColumn ? "100%" : "48%" }, earned ? styles.earnedCard : styles.lockedCard]}>
        {earned ? <MedalArtwork play={play} size={artworkSize} /> : <LockedMedal source={play.medalImage} size={artworkSize} />}
        <Text allowFontScaling style={styles.name}>{play.name}</Text>
        {earned && <Text allowFontScaling style={styles.genre}>{getMedalAppearance(play.genre).genreLabel}</Text>}
        <View style={[styles.stateBadge, earned && styles.earnedBadge]}>
          <Text allowFontScaling style={[styles.state, earned && styles.earnedState]}>{earned ? "Earned" : "Locked"}</Text>
        </View>
      </Pressable>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  collection: { paddingHorizontal: S.horizontal, paddingTop: 24, gap: 10 },
  heading: { color: C.text, fontSize: 27, lineHeight: 36, fontWeight: "400" },
  count: { color: C.muted, fontSize: 16, lineHeight: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 10 },
  card: { minHeight: 48, alignItems: "center", borderRadius: 7, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14, paddingTop: 20, paddingBottom: 16, gap: 14 },
  earnedCard: { backgroundColor: C.surface, borderColor: C.border },
  lockedCard: { backgroundColor: C.soft, borderColor: C.border, filter: "blur(10px)" },
  name: { alignSelf: "stretch", color: C.text, fontSize: 16, lineHeight: 24, fontWeight: "500", textAlign: "center" },
  genre: { color: C.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  stateBadge: { paddingHorizontal: 12, paddingVertical: 3 },
  earnedBadge: { backgroundColor: "transparent" },
  state: { color: C.muted, fontSize: 13, lineHeight: 21, textAlign: "center", letterSpacing: 1, textTransform: "uppercase" },
  earnedState: { color: C.gold },
});
