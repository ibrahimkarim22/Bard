import React, { useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { EditorialText as Text } from "../shared/EditorialUI";
import { EDITORIAL_COLORS as C, EDITORIAL_SPACING as S } from "../shared/editorialTheme";
import MedalArtwork from "./MedalArtwork";
import LockedMedal from "./LockedMedal";
import OpenedMedalCurtain from "./OpenedMedalCurtain";
import { getMedalCollection } from "./medalCollection";
import { getMedalAppearance } from "./medalAppearance";

export default function MedalsCollection({ plays, completedLevel, onOpenLesson, colors = C }) {
  const { width, fontScale } = useWindowDimensions();
  const [galleryWidth, setGalleryWidth] = useState(null);
  const collection = getMedalCollection(plays, completedLevel);
  const singleColumn = width < 360 || fontScale > 1.2;
  const availableWidth = galleryWidth ?? Math.min(width, S.maxWidth) - S.horizontal * 2;
  const columnWidth = singleColumn ? availableWidth : availableWidth * 0.47;
  const artworkSize = Math.max(64, Math.min(228, Math.floor(columnWidth)));
  return <View style={styles.collection}>
    <Text allowFontScaling style={[styles.count, { color: colors.muted }]}>{`${collection.earnedCount} of ${collection.total} medals earned`}</Text>
    <View testID="medal-gallery" style={styles.gallery} onLayout={event => {
      const measuredWidth = event.nativeEvent?.layout?.width;
      if (Number.isFinite(measuredWidth) && measuredWidth > 0) setGalleryWidth(measuredWidth);
    }}>
      {collection.items.map(({ play, earned }) => <View key={play.id} testID={`medal-item-${play.id}`}
        style={[styles.galleryItem, { width: singleColumn ? "100%" : "47%" }]}>
        <Pressable
          accessibilityRole="button" accessibilityLabel={`${play.name} medal, ${earned ? `${getMedalAppearance(play.genre).genreLabel}, Earned` : "Locked"}`}
          accessibilityHint={earned ? "Open this play’s lesson." : "Complete this play to add its medal."}
          accessibilityState={{ disabled: !earned }} disabled={!earned}
          onPress={earned && onOpenLesson ? () => onOpenLesson(play) : undefined}
          style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
          {earned ? <View style={{ width: artworkSize, height: artworkSize }}>
            <MedalArtwork play={play} size={artworkSize} />
            <OpenedMedalCurtain />
          </View> : <LockedMedal size={artworkSize} />}
          <Text serif allowFontScaling style={[styles.name, { color: colors.text }]}>{play.name}</Text>
          {earned && <Text allowFontScaling style={[styles.genre, { color: colors.muted }]}>{getMedalAppearance(play.genre).genreLabel}</Text>}
          {!earned && <Text allowFontScaling style={[styles.state, { color: colors.muted }]}>Locked</Text>}
        </Pressable>
      </View>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  collection: { width: "100%", maxWidth: S.maxWidth, alignSelf: "center", paddingHorizontal: S.horizontal,
    paddingTop: 24, paddingBottom: 12, gap: 28 },
  count: { color: C.muted, fontSize: 15, lineHeight: 23 },
  gallery: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", rowGap: 32 },
  galleryItem: { minWidth: 0 },
  item: { width: "100%", minHeight: 48, alignItems: "center", paddingVertical: 8, gap: 10 },
  pressed: { opacity: 0.72 },
  name: { alignSelf: "stretch", color: C.text, fontSize: 17, lineHeight: 25, textAlign: "center" },
  genre: { color: C.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  state: { color: C.muted, fontSize: 13, lineHeight: 21, textAlign: "center", letterSpacing: 1, textTransform: "uppercase" },
});
