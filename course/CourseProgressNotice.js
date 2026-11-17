import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet } from "react-native";
import { COURSE_COLORS, CourseButton, CourseHeading, CoursePage, CourseText } from "./CourseUI";
import { EDITORIAL_SPACING as S } from "../shared/editorialTheme";

export function CourseProgressNotice({ status, onRetry, onBack, colors = COURSE_COLORS, embedded = false }) {
  const loading = status === "loading";
  const content = <>
    <CourseHeading title={loading ? "Loading course progress" : status === "signed-out" ? "Sign in to continue" : "Course progress unavailable"}
      titleStyle={{ color: colors.text }} />
    {loading ? <ActivityIndicator color={colors.gold} accessibilityLabel="Loading course progress" />
      : <CourseText tone="muted" style={{ color: colors.muted }}>{status === "signed-out"
        ? "Sign in with your account to restore your course progress."
        : "Your progress could not be verified. Try loading it again."}</CourseText>}
    {!loading && status !== "signed-out" && <CourseButton title="Retry loading progress" colors={colors}
      onPress={() => { onRetry().catch(() => {}); }} />}
    {!!onBack && <CourseButton title="Back to course" variant="quiet" colors={colors} onPress={onBack} />}
  </>;
  return embedded ? <ScrollView style={[styles.scroll, { backgroundColor: colors.background }]}
    contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{content}</ScrollView>
    : <CoursePage>{content}</CoursePage>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { width: "100%", maxWidth: S.maxWidth, alignSelf: "center", padding: S.horizontal, paddingBottom: 32, gap: S.section },
});
