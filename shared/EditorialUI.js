import React from 'react';
import { ActivityIndicator, Image, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFonts } from 'expo-font';
import { EDITORIAL_COLORS as C, getEditorialGenreTone } from './editorialTheme';

const fonts = {
  BardEditorialSerif: require('../assets/reader-fonts/source-serif-4/SourceSerif4-Regular.ttf'),
  BardEditorialSerifBold: require('../assets/reader-fonts/source-serif-4/SourceSerif4-Bold.ttf'),
  BardEditorialSans: require('../assets/reader-fonts/source-sans-3/SourceSans3-Regular.ttf'),
  BardEditorialSansBold: require('../assets/reader-fonts/source-sans-3/SourceSans3-Bold.ttf'),
};

export function EditorialText({ serif = false, style, children, ...props }) {
  const [ready] = useFonts(fonts);
  const flattened = StyleSheet.flatten(style);
  const weight = flattened?.fontWeight;
  const bold = weight === 'bold' || Number(weight) >= 600;
  const family = flattened?.fontFamily || (ready ? `BardEditorial${serif ? 'Serif' : 'Sans'}${bold ? 'Bold' : ''}`
    : serif ? (Platform.OS === 'android' ? 'serif' : 'Georgia') : undefined);
  return <Text allowFontScaling {...props} style={[styles.text, style, { fontFamily: family }]}>{children}</Text>;
}

export function EditorialHeading({ title, eyebrow, subtitle }) {
  return <View style={styles.heading}>
    {!!eyebrow && <EditorialText style={styles.eyebrow}>{eyebrow}</EditorialText>}
    <EditorialText serif accessibilityRole="header" style={styles.title}>{title}</EditorialText>
    {!!subtitle && <EditorialText style={styles.subtitle}>{subtitle}</EditorialText>}
  </View>;
}

export function EditorialButton({ title, onPress, variant = 'primary', disabled = false, busy = false, accessibilityLabel, ...props }) {
  const inactive = disabled || busy;
  return <Pressable {...props} accessibilityRole="button" accessibilityLabel={accessibilityLabel || title}
    accessibilityState={{ disabled: inactive, busy }} disabled={inactive} onPress={inactive ? undefined : onPress}
    style={({ pressed }) => [styles.button, variant === 'primary' ? styles.primary : styles.secondary, pressed && styles.pressed, inactive && styles.disabled]}>
    {busy && <ActivityIndicator color={variant === 'primary' ? C.onGold : C.gold} />}
    <EditorialText style={[styles.buttonLabel, variant === 'primary' && styles.primaryLabel]}>{title}</EditorialText>
  </Pressable>;
}

export function EditorialSearch({ value, onChangeText, onClear, placeholder = 'Search play titles', accessibilityLabel = 'Search plays' }) {
  return <View style={styles.search}>
    <TextInput accessibilityLabel={accessibilityLabel} placeholder={placeholder} placeholderTextColor={C.muted}
      value={value} onChangeText={onChangeText} onSubmitEditing={Keyboard.dismiss} returnKeyType="search" autoCorrect={false} autoCapitalize="none"
      allowFontScaling style={styles.input} />
    {!!value && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={onClear || (() => onChangeText(''))} style={styles.clear}>
      <EditorialText style={styles.clearLabel}>{'\u00d7'}</EditorialText>
    </Pressable>}
  </View>;
}

export function EditorialFilters({ values, value, onChange }) {
  return <View accessibilityRole="tablist" accessibilityLabel="Filter by genre" style={styles.filters}>
    {values.map(genre => <Pressable key={genre} accessibilityRole="tab" accessibilityLabel={genre}
      accessibilityState={{ selected: genre === value }} onPress={() => onChange(genre)}
      style={({ pressed }) => [styles.filter, genre === value && styles.selectedFilter, pressed && styles.pressed]}>
      <EditorialText style={[styles.filterText, genre === value && styles.selectedText]}>{genre}</EditorialText>
    </Pressable>)}
  </View>;
}

export function EditorialPlayRow({ play, onPress, subtitle, children, disabled = false, accessibilityLabel, accessibilityHint }) {
  const tone = getEditorialGenreTone(play.genre);
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || play.name} accessibilityHint={accessibilityHint}
    accessibilityState={{ disabled }} disabled={disabled} onPress={disabled ? undefined : onPress}
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
    {!!play.mainImage && <Image source={play.mainImage} accessible={false} style={styles.cover} resizeMode="cover" resizeMethod="resize" />}
    <View style={styles.rowCopy}>
      <EditorialText style={[styles.genre, { color: tone.color }]}>{play.genre || 'Play'}</EditorialText>
      <EditorialText serif style={styles.playTitle}>{play.name}</EditorialText>
      {!!subtitle && <EditorialText style={styles.subtitle}>{subtitle}</EditorialText>}
      {children}
    </View>
    <EditorialText accessible={false} style={styles.chevron}>{'\u203a'}</EditorialText>
  </Pressable>;
}

const styles = StyleSheet.create({
  text: { color: C.text, fontSize: 17, lineHeight: 26 },
  heading: { gap: 10 }, title: { fontSize: 32, lineHeight: 41 },
  eyebrow: { color: C.gold, fontSize: 13, lineHeight: 20, letterSpacing: 1, fontWeight: '600' },
  subtitle: { color: C.muted, fontSize: 16, lineHeight: 24 },
  button: { minHeight: 52, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  primary: { backgroundColor: C.gold }, secondary: { backgroundColor: C.soft },
  buttonLabel: { color: C.gold, fontSize: 17, lineHeight: 25, fontWeight: '600', textAlign: 'center', flexShrink: 1 }, primaryLabel: { color: C.onGold },
  pressed: { opacity: 0.75 }, disabled: { opacity: 0.5 },
  search: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 7, backgroundColor: C.surface },
  input: { flex: 1, minWidth: 0, minHeight: 50, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, lineHeight: 24, color: C.text },
  clear: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, clearLabel: { color: C.muted, fontSize: 24, lineHeight: 30 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filter: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, justifyContent: 'center' },
  selectedFilter: { backgroundColor: C.soft }, filterText: { color: C.muted, fontSize: 14, lineHeight: 22 }, selectedText: { color: C.gold, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, minHeight: 130 },
  rowPressed: { backgroundColor: C.soft }, cover: { width: 86, height: 112, borderRadius: 3, backgroundColor: C.soft },
  rowCopy: { flex: 1, minWidth: 0, gap: 6 }, playTitle: { fontSize: 21, lineHeight: 29 }, genre: { fontSize: 13, lineHeight: 20 },
  chevron: { color: C.gold, fontSize: 28, lineHeight: 34 },
});
