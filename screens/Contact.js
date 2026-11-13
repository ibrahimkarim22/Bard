import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { getDrawerStatusFromState } from '@react-navigation/drawer';
import { CourseHeading, CoursePage, CourseText, COURSE_COLORS } from '../course/CourseUI';
import { SynopsisProse } from '../synopsis/SynopsisUI';
import { CONTACT_EMAIL, CONTACT_ACTIONS, buildContactMailto } from '../shared/contactSupport';

const LAUNCH_TIMEOUT_MS = 10000;
const LAUNCH_SETTLE_MS = 500;

export default function ContactScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const returnToWelcome = useRef(route.params?.fromPublicRoot === true);
  const pending = useRef(null);
  const copyRequest = useRef(0);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(null);
  const [copyStatus, setCopyStatus] = useState(null);

  useFocusEffect(useCallback(() => {
    if (!returnToWelcome.current) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!returnToWelcome.current || getDrawerStatusFromState(navigation.getState()) === 'open') return false;
      const parent = navigation.getParent();
      if (!parent?.canGoBack()) return false;
      parent.goBack();
      return true;
    });
    return () => { returnToWelcome.current = false; subscription.remove(); };
  }, [navigation]));

  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current.timeout);
    pending.current = null;
    copyRequest.current++;
  }, []);

  const finish = (request, failure = null) => {
    if (pending.current !== request) return;
    clearTimeout(request.timeout);
    if (!failure && !request.acknowledged) {
      request.acknowledged = true;
      request.timeout = setTimeout(() => finish(request), LAUNCH_SETTLE_MS);
      return;
    }
    pending.current = null;
    setOpening(false);
    setError(failure);
  };
  const openDraft = async id => {
    if (pending.current) return;
    const request = { timeout: null };
    pending.current = request;
    setError(null);
    setOpening(true);
    request.timeout = setTimeout(() => finish(request, 'timeout'), LAUNCH_TIMEOUT_MS);
    try {
      await Linking.openURL(buildContactMailto(id));
      finish(request);
    } catch {
      finish(request, 'unavailable');
    }
  };
  const copyEmail = async () => {
    const request = ++copyRequest.current;
    setCopyStatus(null);
    try {
      const clipboard = require('react-native').Clipboard;
      clipboard.setString(CONTACT_EMAIL);
      const verified = await clipboard.getString() === CONTACT_EMAIL;
      if (request === copyRequest.current) setCopyStatus(verified ? 'copied' : 'failed');
    } catch {
      if (request === copyRequest.current) setCopyStatus('failed');
    }
  };

  return <CoursePage contentContainerStyle={styles.content}>
    <View style={styles.introduction}>
      <View style={styles.rule} />
      <CourseHeading title="Contact & Feedback" />
      <SynopsisProse>Have a question, an idea, or a correction? Get in touch.</SynopsisProse>
    </View>

    <View style={styles.address}>
      <CourseText selectable accessibilityLabel={`Contact email: ${CONTACT_EMAIL}`} textBreakStrategy="simple" style={styles.email}>{CONTACT_EMAIL}</CourseText>
      {Platform.OS === 'android' && <Pressable accessibilityRole="button" accessibilityLabel="Copy email"
        onPress={copyEmail} style={({ pressed }) => [styles.copy, pressed && styles.pressed]}>
        <CourseText style={styles.copyLabel}>Copy email</CourseText>
      </Pressable>}
      {!!copyStatus && <CourseText accessibilityRole={copyStatus === 'failed' ? 'alert' : undefined}
        accessibilityLiveRegion="polite" tone={copyStatus === 'failed' ? 'danger' : 'muted'} style={styles.explanation}>
        {copyStatus === 'copied' ? 'Email address copied.' : 'Could not confirm the address was copied.'}
      </CourseText>}
      {!!error && <CourseText accessibilityRole="alert" accessibilityLiveRegion="polite" tone="danger" style={styles.explanation}>
        {error === 'timeout' ? 'Could not confirm the email app opened. Use the address above.' : 'Your email app could not be opened. Use the address above.'}
      </CourseText>}
    </View>

    <View style={styles.actions}>
      {CONTACT_ACTIONS.map(action => <Pressable key={action.id} accessibilityRole="button"
        accessibilityLabel={action.label} accessibilityHint="Opens an editable email draft."
        accessibilityState={{ disabled: opening, busy: opening }} disabled={opening}
        onPress={() => openDraft(action.id)}
        style={({ pressed }) => [styles.action, pressed && styles.pressed, opening && styles.disabled]}>
        <CourseText style={styles.actionLabel}>{action.label}</CourseText>
        <CourseText accessible={false} style={styles.arrow}>↗</CourseText>
      </Pressable>)}
    </View>
    <CourseText tone="muted" style={styles.explanation}>Opens an editable email draft. Review or edit it before sending. Nothing is sent automatically.</CourseText>
  </CoursePage>;
}

const styles = StyleSheet.create({
  content: { gap: 20 },
  introduction: { gap: 16, paddingTop: 8 },
  rule: { width: 44, height: 2, backgroundColor: COURSE_COLORS.gold, marginBottom: 4 },
  address: { gap: 12 },
  email: { color: COURSE_COLORS.gold, fontSize: 18, lineHeight: 28 },
  copy: { minHeight: 48, paddingVertical: 10, justifyContent: 'center', alignSelf: 'flex-start' },
  copyLabel: { color: COURSE_COLORS.gold, fontSize: 16, lineHeight: 25, textDecorationLine: 'underline' },
  actions: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COURSE_COLORS.border },
  action: { minHeight: 56, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COURSE_COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 16 },
  actionLabel: { flex: 1, color: COURSE_COLORS.text, fontSize: 17, lineHeight: 26, fontWeight: '600' },
  arrow: { color: COURSE_COLORS.gold, fontSize: 21, lineHeight: 29 },
  explanation: { fontSize: 15, lineHeight: 24 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.6 },
});
