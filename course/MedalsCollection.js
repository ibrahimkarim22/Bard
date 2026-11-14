import React from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { EditorialText as Text } from "../shared/EditorialUI";
import { EDITORIAL_COLORS as C, EDITORIAL_SPACING as S } from "../shared/editorialTheme";
import MedalArtwork from "./MedalArtwork";
import LockedMedal from "./LockedMedal";
import { getMedalCollection } from "./medalCollection";
import { getMedalAppearance } from "./medalAppearance";

export default function MedalsCollection({ plays, completedLevel, onOpenLesson, colors = C }) {
  const { width, fontScale } = useWindowDimensions();
  const collection = getMedalCollection(plays, completedLevel);
  const singleColumn = width < 360 || fontScale > 1.2;
  const artworkSize = singleColumn ? 140
    : Math.max(80, Math.min(140, Math.floor((width - S.horizontal * 2) * 0.48) - 32));
  return <View style={styles.collection}>
    <Text serif allowFontScaling accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Your medal collection</Text>
    <Text allowFontScaling style={[styles.count, { color: colors.muted }]}>{`${collection.earnedCount} of ${collection.total} medals earned`}</Text>
    <View style={styles.grid}>
      {collection.items.map(({ play, earned }) => <View key={play.id}
        style={[styles.cardFrame, { width: singleColumn ? "100%" : "48%",
          backgroundColor: colors.surface, borderColor: earned ? colors.gold : colors.border }]}>
        <Pressable
          accessibilityRole="button" accessibilityLabel={`${play.name} medal, ${earned ? `${getMedalAppearance(play.genre).genreLabel}, Earned` : "Locked"}`}
          accessibilityHint={earned ? "Open this play’s lesson." : "Complete this play to add its medal."}
          accessibilityState={{ disabled: !earned }} disabled={!earned}
          onPress={earned && onOpenLesson ? () => onOpenLesson(play) : undefined}
          style={[styles.card, earned ? styles.earnedCard : styles.lockedCard,
            { backgroundColor: earned ? colors.surface : colors.soft }]}>
          {earned ? <MedalArtwork play={play} size={artworkSize} /> : <LockedMedal source={play.medalImage} size={artworkSize} />}
          <Text allowFontScaling style={[styles.name, { color: colors.text }]}>{play.name}</Text>
          {earned && <Text allowFontScaling style={[styles.genre, { color: colors.muted }]}>{getMedalAppearance(play.genre).genreLabel}</Text>}
          <View style={[styles.stateBadge, earned && styles.earnedBadge]}>
            <Text allowFontScaling style={[styles.state, earned && styles.earnedState,
              { color: earned ? colors.gold : colors.muted }]}>{earned ? "Earned" : "Locked"}</Text>
          </View>
        </Pressable>
      </View>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  collection: { paddingHorizontal: S.horizontal, paddingTop: 24, gap: 10 },
  heading: { color: C.text, fontSize: 27, lineHeight: 36, fontWeight: "400" },
  count: { color: C.muted, fontSize: 16, lineHeight: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 10 },
  cardFrame: { borderRadius: 12, borderWidth: 2, overflow: "hidden" },
  card: { width: "100%", flex: 1, minHeight: 48, alignItems: "center",
    paddingHorizontal: 14, paddingTop: 20, paddingBottom: 16, gap: 14 },
  earnedCard: { backgroundColor: C.surface },
  lockedCard: { backgroundColor: C.soft, filter: "blur(10px)" },
  name: { alignSelf: "stretch", color: C.text, fontSize: 16, lineHeight: 24, fontWeight: "500", textAlign: "center" },
  genre: { color: C.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  stateBadge: { paddingHorizontal: 12, paddingVertical: 3 },
  earnedBadge: { backgroundColor: "transparent" },
  state: { color: C.muted, fontSize: 13, lineHeight: 21, textAlign: "center", letterSpacing: 1, textTransform: "uppercase" },
  earnedState: { color: C.gold },
});
