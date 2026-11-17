import React from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { EditorialText as Text } from "../shared/EditorialUI";
import { EDITORIAL_COLORS as C, EDITORIAL_SPACING as S } from "../shared/editorialTheme";
import MedalArtwork from "./MedalArtwork";
import LockedMedal from "./LockedMedal";
import { getMedalCollection } from "./medalCollection";
import { getMedalAppearance } from "./medalAppearance";

function TrailLink({ id, reverse, compact, color }) {
  return <View testID={`medal-link-${id}`} pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.link}>
    {compact ? <View testID="medal-curve" style={styles.compactCurve}>
      <View style={[styles.bow, { borderColor: color, left: reverse ? 0 : 32,
        transform: [{ scaleX: reverse ? -1 : 1 }] }]} />
    </View> : <View testID="medal-curve" style={[styles.curve, { transform: [{ scaleX: reverse ? -1 : 1 }] }]}>
      <View style={[styles.curveStart, { borderColor: color }]} />
      <View style={[styles.curveEnd, { borderColor: color }]} />
    </View>}
  </View>;
}

export default function MedalsCollection({ plays, completedLevel, onOpenLesson, colors = C }) {
  const { width, fontScale } = useWindowDimensions();
  const collection = getMedalCollection(plays, completedLevel);
  const singleColumn = width < 360 || fontScale > 1.2;
  const artworkSize = singleColumn ? 140
    : Math.max(80, Math.min(140, Math.floor((width - S.horizontal * 2) * 0.48) - 32));
  return <View style={styles.collection}>
    <Text serif allowFontScaling accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Your medal collection</Text>
    <Text allowFontScaling style={[styles.count, { color: colors.muted }]}>{`${collection.earnedCount} of ${collection.total} medals earned`}</Text>
    <View style={styles.trail}>
      {collection.items.map(({ play, earned }, index) => <View key={play.id} style={styles.trailRow}>
        <View testID={`medal-stop-${play.id}`}
        style={[styles.cardFrame, { width: singleColumn ? "100%" : "68%",
          alignSelf: singleColumn ? "center" : index % 2 ? "flex-end" : "flex-start",
          backgroundColor: colors.surface, borderColor: earned ? colors.gold : colors.border }]}>
        <Pressable
          accessibilityRole="button" accessibilityLabel={`${play.name} medal, ${earned ? `${getMedalAppearance(play.genre).genreLabel}, Earned` : "Locked"}`}
          accessibilityHint={earned ? "Open this play’s lesson." : "Complete this play to add its medal."}
          accessibilityState={{ disabled: !earned }} disabled={!earned}
          onPress={earned && onOpenLesson ? () => onOpenLesson(play) : undefined}
          style={[styles.card, earned ? styles.earnedCard : styles.lockedCard,
            { backgroundColor: earned ? colors.surface : colors.soft }]}>
          {earned ? <MedalArtwork play={play} size={artworkSize} />
            : <View style={styles.lockedArtwork}><LockedMedal source={play.medalImage} size={artworkSize} /></View>}
          <Text allowFontScaling style={[styles.name, { color: colors.text }]}>{play.name}</Text>
          {earned && <Text allowFontScaling style={[styles.genre, { color: colors.muted }]}>{getMedalAppearance(play.genre).genreLabel}</Text>}
          {!earned && <View style={styles.stateBadge}>
            <Text allowFontScaling style={[styles.state, { color: colors.muted }]}>Locked</Text>
          </View>}
        </Pressable>
        </View>
        {index < collection.items.length - 1 && <TrailLink id={play.id} reverse={index % 2 === 1}
          compact={singleColumn} color={earned ? colors.gold : colors.border} />}
      </View>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  collection: { width: "100%", maxWidth: 520, alignSelf: "center", paddingHorizontal: S.horizontal, paddingTop: 24, gap: 10 },
  heading: { color: C.text, fontSize: 27, lineHeight: 36, fontWeight: "400" },
  count: { color: C.muted, fontSize: 16, lineHeight: 24 },
  trail: { paddingTop: 10 },
  trailRow: { width: "100%" },
  link: { height: 64 },
  curve: { flex: 1, marginHorizontal: "34%" },
  curveStart: { position: "absolute", left: 0, top: 0, width: "50%", height: "50%",
    borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderBottomLeftRadius: 24 },
  curveEnd: { position: "absolute", left: "50%", top: "50%", width: "50%", height: "50%",
    borderTopWidth: 1.5, borderRightWidth: 1.5, borderTopRightRadius: 24 },
  compactCurve: { width: 64, height: "100%", alignSelf: "center" },
  bow: { position: "absolute", top: 0, width: 32, height: "100%", borderTopWidth: 1.5,
    borderRightWidth: 1.5, borderBottomWidth: 1.5, borderTopRightRadius: 32, borderBottomRightRadius: 32 },
  cardFrame: { borderRadius: 12, borderWidth: 2, overflow: "hidden" },
  card: { width: "100%", flex: 1, minHeight: 48, alignItems: "center",
    paddingHorizontal: 14, paddingTop: 20, paddingBottom: 16, gap: 14 },
  earnedCard: { backgroundColor: C.surface },
  lockedCard: { backgroundColor: C.soft },
  lockedArtwork: { filter: "blur(10px)" },
  name: { alignSelf: "stretch", color: C.text, fontSize: 16, lineHeight: 24, fontWeight: "500", textAlign: "center" },
  genre: { color: C.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  stateBadge: { paddingHorizontal: 12, paddingVertical: 3 },
  state: { color: C.muted, fontSize: 13, lineHeight: 21, textAlign: "center", letterSpacing: 1, textTransform: "uppercase" },
});
