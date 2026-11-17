import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { onAuthStateChanged } from 'firebase/auth';
import { FIREBASE_AUTH } from '../firebaseConfig';
import { accountDeletion } from './normalAccountDeletion';
import { deletionMessage } from './deletionMessages';
import { EditorialText as Text } from '../shared/EditorialUI';
import { EDITORIAL_COLORS as C } from '../shared/editorialTheme';

// Keep resumable deletion independent of profile/course routes. Cloud cleanup
// runs only while the app is active and its original owner is authenticated.
export default function AccountDeletionBridge({ children }) {
  const state = useSyncExternalStore(accountDeletion.subscribe, accountDeletion.getSnapshot);
  const navigation = useNavigation();
  const [owner, setOwner] = useState(() => FIREBASE_AUTH.currentUser);
  const [dismissed, setDismissed] = useState(null);
  const handled = useRef(null);
  useEffect(() => {
    if (AppState.currentState === 'active') accountDeletion.foreground().catch(() => {});
    else accountDeletion.background();
    accountDeletion.initialize().catch(() => {});
    const subscription = AppState.addEventListener('change', value => {
      if (value === 'active') accountDeletion.foreground().catch(() => {});
      else accountDeletion.background();
    });
    const unsubscribe = onAuthStateChanged(FIREBASE_AUTH, next => {
      setOwner(next); accountDeletion.ownerChanged?.().catch(() => {});
    });
    return () => { subscription.remove(); unsubscribe(); accountDeletion.background(); };
  }, []);
  useEffect(() => {
    const finish = () => {
      if (state.status !== 'complete' || !state.uid || handled.current === state.uid || FIREBASE_AUTH.currentUser) return;
      if (navigation.isReady && !navigation.isReady()) return;
      handled.current = state.uid;
      const destination = { index: 0, routes: [{ name: 'Root' }] };
      if (navigation.resetRoot) navigation.resetRoot(destination);
      else navigation.reset(destination);
    };
    finish();
    return navigation.addListener?.('state', finish);
  }, [state.status, state.uid, owner, navigation]);
  if (!state.initialized) return <View style={styles.startup}><ActivityIndicator accessibilityLabel="Preparing account" color={C.gold} /></View>;
  const target = state.uid && (!FIREBASE_AUTH.currentUser || FIREBASE_AUTH.currentUser.uid === state.uid);
  const visible = !!target && !['idle', 'complete', 'confirming'].includes(state.status) && !state.requiresPassword && dismissed !== state.uid;
  const failed = state.status === 'retry-needed';
  return <>
    {children}
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setDismissed(state.uid)}>
      {visible && <SafeAreaView style={styles.backdrop} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View accessibilityViewIsModal style={styles.card}>
            <Text serif accessibilityRole="header" style={styles.title}>Account deletion</Text>
            <Text accessibilityLiveRegion="polite" style={styles.copy}>{state.phase === 'local-cleanup'
              ? 'Online deletion is confirmed. Finishing cleanup on this device.'
              : failed ? deletionMessage(state.error) || 'Deletion is not yet confirmed. Check your connection and retry.'
                : state.status === 'paused' ? 'Deletion is paused. Keep Bard open and stay connected to continue.'
                  : 'Removing your account and saved data. Keep Bard open until deletion finishes.'}</Text>
            {!failed && <ActivityIndicator accessibilityLabel="Deleting account" color={C.gold} />}
            {failed && <Pressable accessibilityRole="button" accessibilityLabel="Check deletion status" style={styles.action}
              onPress={() => accountDeletion.check().catch(() => {})}><Text style={styles.actionText}>Check deletion status</Text></Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel="Close deletion status" style={styles.action}
              onPress={() => setDismissed(state.uid)}><Text style={styles.actionText}>Close</Text></Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>}
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  startup: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.background },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 20 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
  card: { backgroundColor: C.background, borderRadius: 12, padding: 24, gap: 20, width: '100%', maxWidth: 520, alignSelf: 'center' },
  title: { color: C.text, fontSize: 24, lineHeight: 33 }, copy: { color: C.text, fontSize: 16, lineHeight: 25 },
  action: { minHeight: 48, paddingVertical: 12, justifyContent: 'center' },
  actionText: { color: C.gold, fontSize: 16, lineHeight: 25, fontWeight: '600' },
});
