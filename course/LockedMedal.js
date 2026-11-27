import React from "react";
import { StyleSheet, View } from "react-native";

const folds = [
  { width: "15%", backgroundColor: "#4a0f19" },
  { width: "12%", backgroundColor: "#6b1824" },
  { width: "23%", backgroundColor: "#360b12" },
  { width: "17%", backgroundColor: "#821e2b" },
  { width: "25%", backgroundColor: "#54101c" },
  { width: "8%", backgroundColor: "#360b12" },
];

export default function LockedMedal({ size = 140 }) {
  const diameter = Number.isFinite(size) && size >= 64 ? size : 140;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={[styles.curtain, { width: diameter, height: diameter }]}>
    <View testID="locked-curtain-left" style={[styles.panel, styles.left]}>
      {folds.map((fold, index) => <View key={index} style={[styles.fold, fold]} />)}
    </View>
    <View testID="locked-curtain-right" style={[styles.panel, styles.right]}>
      {folds.slice().reverse().map((fold, index) => <View key={index} style={[styles.fold, fold]} />)}
    </View>
    <View style={styles.seam} />
    <View style={styles.rail} />
  </View>;
}

const styles = StyleSheet.create({
  curtain: { alignSelf: "center", overflow: "hidden", backgroundColor: "#4a0f19" },
  panel: { position: "absolute", top: 0, width: "50%", height: "100%", flexDirection: "row", backgroundColor: "#4a0f19" },
  left: { left: 0 },
  right: { right: 0 },
  fold: { height: "100%" },
  seam: { position: "absolute", left: "50%", marginLeft: -1, top: 0, bottom: 0, width: 2, backgroundColor: "#28090f" },
  rail: { position: "absolute", left: 0, right: 0, top: 0, height: 2, backgroundColor: "#c6a663" },
});
