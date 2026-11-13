import React from 'react';
import { Platform, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EditorialText } from '../shared/EditorialUI';
import { EDITORIAL_SPACING as S } from '../shared/editorialTheme';
import WelcomeTitle from './WelcomeTitle';
import WelcomeBackground from './WelcomeBackground';
import WelcomeMoon from './WelcomeMoon';
import WelcomeActionPulse from './WelcomeActionPulse';

const colors = { background: '#0e0c20', text: '#f3eadb', muted: '#d3c7b8',
  primary: '#c6a663', primaryText: '#241c15', accent: '#d8c58e', secondary: '#26152f' };

const supportsGradients = Platform.OS === 'web' || !!globalThis.nativeFabricUIManager;
const gradientProperty = Platform.OS === 'web' ? 'backgroundImage' : 'experimental_backgroundImage';

function WelcomeAction({ title, onPress, secondary = false }) {
  const button = <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary ? styles.secondaryButton : styles.primaryButton, pressed && styles.pressed]}>
    <EditorialText serif style={[styles.buttonLabel, !secondary && styles.primaryButtonLabel]}>{title}</EditorialText>
  </Pressable>;
  return secondary ? button : <WelcomeActionPulse>{button}</WelcomeActionPulse>;
}

export const RootScreen = ({ navigation }) => {
  const focused = useIsFocused();
  const pendingRoute = useRef(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!focused) { pendingRoute.current = null; setClosing(false); }
  }, [focused]);
  const openAccount = route => {
    if (pendingRoute.current) return;
    pendingRoute.current = route;
    setClosing(true);
  };
  const revealAccount = useCallback(() => {
    const route = pendingRoute.current;
    if (!route) return;
    pendingRoute.current = null;
    navigation.navigate(route);
  }, [navigation]);

  return <SafeAreaView style={styles.page} edges={['top', 'left', 'right', 'bottom']}>
  <StatusBar barStyle="light-content" backgroundColor={colors.background} />
  <WelcomeMoon />
  <ScrollView style={styles.stageColumn} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.brand}>
      <View style={styles.titleSpace}><WelcomeTitle style={styles.wordmark} /></View>
      <View style={styles.accentRule} />
      <EditorialText serif style={styles.tagline}>Shakespeare’s complete plays, with quizzes.</EditorialText>
    </View>
    <View style={styles.body}>
      <EditorialText style={styles.introduction}>Read full plays or explore their synopses. Highlight and save your favorite passages, test your knowledge, and earn medals with perfect quiz scores.</EditorialText>
      <View style={styles.actions}>
        <WelcomeAction title="Create account" onPress={() => openAccount('SignUp')} />
        <WelcomeAction title="Log in" secondary onPress={() => openAccount('Login')} />
        <Pressable accessibilityRole="button" accessibilityLabel="Contact & Feedback"
          onPress={() => navigation.navigate('Main', { screen: 'Contact', params: { fromPublicRoot: true } })}
          style={({ pressed }) => [styles.contact, pressed && styles.pressed]}>
          <EditorialText style={styles.contactLabel}>Contact & Feedback</EditorialText>
        </Pressable>
      </View>
    </View>
  </ScrollView>
  <WelcomeBackground closing={closing} onClosed={revealAccount} reopenOnFocus />
</SafeAreaView>;
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  stageColumn: { flex: 1, width: '56%', alignSelf: 'center' },
  content: { flexGrow: 1, width: '100%', maxWidth: S.maxWidth, alignSelf: 'center', justifyContent: 'center', paddingTop: 56, paddingBottom: 32, gap: 28 },
  brand: { width: '100%', alignItems: 'center', gap: 14 },
  titleSpace: { width: '100%', paddingTop: 12, paddingBottom: 8 },
  wordmark: { color: colors.text, fontSize: 48, lineHeight: 64, letterSpacing: 5 },
  accentRule: { width: 42, height: 2, backgroundColor: colors.accent, opacity: 0.8 },
  tagline: { color: colors.text, fontSize: 20, lineHeight: 28, textAlign: 'center', alignSelf: 'stretch', flexShrink: 1 },
  body: { width: '100%', gap: 24 },
  introduction: { color: colors.muted, textAlign: 'center', fontSize: 16, lineHeight: 24, alignSelf: 'stretch', flexShrink: 1 },
  actions: { gap: 12 },
  button: { width: '100%', minHeight: 52, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { backgroundColor: colors.primary,
    ...(supportsGradients && { [gradientProperty]: 'linear-gradient(150deg, #d5b978 0%, #c6a663 55%, #af8a4b 100%)' }) },
  secondaryButton: { backgroundColor: colors.secondary,
    ...(supportsGradients && { [gradientProperty]: 'linear-gradient(150deg, #38203f 0%, #26152f 100%)' }) },
  buttonLabel: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  primaryButtonLabel: { color: colors.primaryText },
  contact: { width: '100%', minHeight: 48, paddingVertical: 12, paddingHorizontal: 4, justifyContent: 'center', alignItems: 'center' },
  contactLabel: { color: colors.accent, fontSize: 15, lineHeight: 22, textAlign: 'center', flexShrink: 1 },
  pressed: { opacity: 0.78 },
});
