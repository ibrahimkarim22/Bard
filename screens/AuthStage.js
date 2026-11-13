import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, useWindowDimensions } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { EditorialText } from '../shared/EditorialUI';
import WelcomeBackground from './WelcomeBackground';
import WelcomeMoon from './WelcomeMoon';

export const AUTH_COLORS = {
  background: '#0e0c20', text: '#f3eadb', muted: '#c4b8cb',
  border: '#554155', gold: '#c6a663', onGold: '#241c15',
};

export default function AuthStage({ scene, navigation, children }) {
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const active = useRef(focused);
  const pendingExit = useRef(null);
  const allowRemoval = useRef(false);
  const [closing, setClosing] = useState(false);
  const beginExit = useCallback(action => {
    if (!active.current || pendingExit.current) return;
    pendingExit.current = action;
    Keyboard.dismiss();
    setClosing(true);
  }, []);
  const finishExit = useCallback(() => {
    if (!active.current || !pendingExit.current) return;
    const action = pendingExit.current;
    pendingExit.current = null;
    allowRemoval.current = true;
    action();
  }, []);
  useEffect(() => {
    active.current = focused;
    if (!focused) {
      pendingExit.current = null;
      allowRemoval.current = false;
      setClosing(false);
      return;
    }
    const unsubscribe = navigation.addListener('beforeRemove', event => {
      if (allowRemoval.current) return;
      event.preventDefault();
      const action = event.data.action;
      beginExit(() => navigation.dispatch(action));
    });
    return () => {
      active.current = false;
      pendingExit.current = null;
      unsubscribe();
    };
  }, [focused, navigation, beginExit]);
  const compact = height < 760 || fontScale > 1.2;
  return <SafeAreaView style={styles.page} edges={['top', 'left', 'right', 'bottom']}>
    <StatusBar barStyle="light-content" backgroundColor={AUTH_COLORS.background} />
    <WelcomeMoon phase={scene} />
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}
      pointerEvents={closing ? 'none' : 'auto'} accessibilityElementsHidden={closing}
      importantForAccessibility={closing ? 'no-hide-descendants' : 'auto'}>
      <ScrollView style={styles.column} contentContainerStyle={[styles.content, { paddingTop: compact ? 76 : 148 }]}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
    <WelcomeBackground closing={closing} onClosed={finishExit} reopenOnFocus light={scene === 'sun' ? 'sun' : 'moon'} />
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => beginExit(() => navigation.canGoBack()
      ? navigation.goBack() : navigation.navigate('Root'))}
      style={({ pressed }) => [styles.back, { top: insets.top + 4 }, pressed && styles.pressed]}>
      <EditorialText style={styles.backLabel}>{'\u2039'} Back</EditorialText>
    </Pressable>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: AUTH_COLORS.background },
  keyboard: { flex: 1 },
  column: { flex: 1, width: '56%', maxWidth: 480, alignSelf: 'center' },
  content: { flexGrow: 1, justifyContent: 'center', paddingBottom: 32 },
  back: { position: 'absolute', left: 12, minHeight: 48, minWidth: 72,
    paddingHorizontal: 12, justifyContent: 'center' },
  backLabel: { color: AUTH_COLORS.text, fontSize: 17, lineHeight: 26 },
  pressed: { opacity: 0.75 },
});
