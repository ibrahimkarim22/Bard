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

function GatheredPanel({ right = false }) {
  const fabric = right ? folds.slice().reverse() : folds;
  return <View style={[styles.panel, right ? styles.right : styles.left]}>
    <View style={[styles.fabric, styles.upper, right ? styles.upperRight : styles.upperLeft]}>
      {fabric.map((fold, index) => <View key={index} style={[styles.fold, fold]} />)}
    </View>
    <View style={[styles.fabric, styles.lower, right ? styles.lowerRight : styles.lowerLeft]}>
      {fabric.map((fold, index) => <View key={index} style={[styles.fold, fold]} />)}
    </View>
    <View style={[styles.tie, right ? styles.tieRight : styles.tieLeft]} />
  </View>;
}

// Collection decoration only: the open center leaves the original medal visible.
export default function OpenedMedalCurtain() {
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={styles.overlay}>
    <GatheredPanel />
    <GatheredPanel right />
  </View>;
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, overflow: "hidden" },
  panel: { position: "absolute", top: 0, bottom: 0, width: "9%" },
  left: { left: 0 },
  right: { right: 0 },
  fabric: { position: "absolute", flexDirection: "row", overflow: "hidden", backgroundColor: "#4a0f19" },
  upper: { top: 0, height: "60%", width: "100%" },
  upperLeft: { left: 0, borderBottomRightRadius: 12 },
  upperRight: { right: 0, borderBottomLeftRadius: 12 },
  lower: { bottom: 0, height: "42%", width: "82%" },
  lowerLeft: { left: 0, borderTopRightRadius: 9 },
  lowerRight: { right: 0, borderTopLeftRadius: 9 },
  fold: { height: "100%" },
  tie: { position: "absolute", top: "58%", height: 2, width: "65%", backgroundColor: "#c6a663" },
  tieLeft: { left: 0 },
  tieRight: { right: 0 },
});
