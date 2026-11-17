import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, TextInput, View } from 'react-native';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { onAuthStateChanged, updateProfile } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCamera, faImage, faXmark } from '@fortawesome/free-solid-svg-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { FIREBASE_AUTH, FIRESTORE_DB } from '../firebaseConfig';
import { accountDeletion } from '../account/normalAccountDeletion';
import { deletionMessage } from '../account/deletionMessages';
import { EditorialText as Text } from '../shared/EditorialUI';
import { EDITORIAL_COLORS as C } from '../shared/editorialTheme';

const defaultPhoto = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s';
const busyStates = new Set(['confirming', 'requesting', 'deleting', 'cleaning']);

export default function ProfileScreen({ navigation }) {
  const [owner, setOwner] = useState(() => FIREBASE_AUTH.currentUser);
  const [picture, setPicture] = useState(null);
  const [pictureFailed, setPictureFailed] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [password, setPassword] = useState('');
  const [actionError, setActionError] = useState(null);
  const focused = useIsFocused();
  const active = useRef(focused), photoRequest = useRef(null), deleting = useRef(false);
  active.current = focused;
  const deletion = useSyncExternalStore(accountDeletion.subscribe, accountDeletion.getSnapshot);
  const user = owner === FIREBASE_AUTH.currentUser ? owner : null;
  const pending = !!user && deletion.uid === user.uid && !['idle', 'complete'].includes(deletion.status);
  const confirmationVisible = !!user && focused && confirmation === user;
  const busy = busyStates.has(deletion.status) && (!deletion.uid || deletion.uid === user?.uid);
  const current = captured => active.current && captured && FIREBASE_AUTH.currentUser === captured;
  const editable = !!user && !pending && !busy && !photoBusy;
  useEffect(() => onAuthStateChanged(FIREBASE_AUTH, next => {
    photoRequest.current = null;
    setOwner(next); setPicture(null); setPictureFailed(null); setPhotoBusy(false);
    setPhotoError(null); setConfirmation(null); setPassword(''); setActionError(null);
  }), []);
  useEffect(() => {
    active.current = focused;
    if (!focused) { setConfirmation(null); setPassword(''); setPhotoBusy(false); }
    return () => { active.current = false; photoRequest.current = null; };
  }, [focused]);

  const choosePhoto = async camera => {
    const captured = user;
    if (!editable || !current(captured) || photoRequest.current) return;
    const request = {}; photoRequest.current = request; setPhotoBusy(true); setPhotoError(null);
    const owns = () => current(captured) && photoRequest.current === request
      && !(accountDeletion.getSnapshot().uid === captured.uid && !['idle', 'complete'].includes(accountDeletion.getSnapshot().status));
    try {
      const permission = await (camera ? ImagePicker.requestCameraPermissionsAsync() : ImagePicker.requestMediaLibraryPermissionsAsync());
      if (!owns()) return;
      if (permission.status !== 'granted') { setPhotoError('Allow photo access to change your picture.'); return; }
      const result = await (camera ? ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1] })
        : ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1] }));
      if (!owns() || result.canceled || !result.assets?.[0]?.uri) return;
      const processed = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 400 } }], { format: 'png' });
      if (!owns()) return;
      // Preserve the existing photo storage convention; no new upload service.
      await MediaLibrary.saveToLibraryAsync(processed.uri);
      if (!owns()) return;
      await updateProfile(captured, { photoURL: processed.uri });
      if (!owns()) return;
      await updateDoc(doc(FIRESTORE_DB, 'users', captured.uid), { profileImage: processed.uri });
      if (owns()) { setPicture({ owner: captured, uri: processed.uri }); setPictureFailed(null); }
    } catch { if (owns()) setPhotoError('Your picture could not be updated. Please try again.'); }
    finally { if (photoRequest.current === request) { photoRequest.current = null; setPhotoBusy(false); } }
  };
  const cancel = () => { if (!deleting.current) { setConfirmation(null); setPassword(''); setActionError(null); } };
  const confirm = async () => {
    if (!current(user) || confirmation !== user || deleting.current || !password || !deletion.available || photoBusy) return;
    deleting.current = true;
    const secret = password; setPassword(''); setConfirmation(null); setActionError(null);
    try { await accountDeletion.confirm(secret); }
    catch { if (current(user)) setActionError('Account deletion could not be started. Please try again.'); }
    finally { deleting.current = false; }
  };
  const message = actionError || (deletion.uid === user?.uid || !deletion.uid ? deletionMessage(deletion.error) : null);
  const photo = picture?.owner === user ? picture.uri : user?.photoURL || defaultPhoto;
  const name = user?.displayName?.trim() || 'Reader';
  const initials = name.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase();

  return <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.screen}>
    {focused && <StatusBar barStyle="light-content" backgroundColor={C.background} />}
    <View style={styles.header}>
      <Text serif accessibilityRole="header" style={styles.title}>Edit profile</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close profile" onPress={() => navigation.goBack()} style={styles.close}>
        <FontAwesomeIcon icon={faXmark} size={18} color={C.text} />
      </Pressable>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {!user ? <Text style={styles.copy}>Sign in to view your profile.</Text> : <>
        <View style={styles.identity}>
          {pictureFailed?.owner === user && pictureFailed.uri === photo ? <View style={[styles.avatar, styles.initials]}>
            <Text style={styles.initialText}>{initials}</Text>
          </View> : <Image accessible={false} source={{ uri: photo }} style={styles.avatar}
            onError={() => { if (current(user)) setPictureFailed({ owner: user, uri: photo }); }} />}
          <Text serif style={styles.name}>{name}</Text>
        </View>
        <View style={styles.email}>
          <Text style={styles.label}>Email</Text>
          <Text selectable style={styles.copy}>{user.email || 'Email unavailable'}</Text>
        </View>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Profile picture</Text>
          {photoBusy && <ActivityIndicator color={C.gold} accessibilityLabel="Updating profile picture" />}
          <PhotoAction icon={faCamera} label="Take Photo" disabled={!editable} onPress={() => choosePhoto(true)} />
          <PhotoAction icon={faImage} label="Choose from Library" disabled={!editable} onPress={() => choosePhoto(false)} />
          {photoError && <Text accessibilityRole="alert" style={styles.error}>{photoError}</Text>}
        </View>
        <View style={styles.deleteSection}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Account</Text>
          {pending && <Text accessibilityLiveRegion="polite" style={styles.copy}>{deletion.status === 'cleaning'
            ? 'Online deletion confirmed. Finishing cleanup on this device.'
            : deletion.status === 'retry-needed' ? 'Deletion is not yet confirmed. Please retry.'
              : deletion.requiresPassword ? 'Your deletion request needs confirmation.' : 'Account deletion is in progress.'}</Text>}
          {message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
          {busy && <ActivityIndicator color={C.gold} accessibilityLabel="Deleting account" />}
          {pending && <Pressable accessibilityRole="button" accessibilityLabel="Check deletion status"
            disabled={busy} accessibilityState={{ disabled: busy, busy }} style={styles.action}
            onPress={() => { if (current(user)) accountDeletion.retry().catch(() => {}); }}>
            <Text style={styles.actionText}>Check deletion status</Text>
          </Pressable>}
          {(!pending || deletion.requiresPassword) && <Pressable accessibilityRole="button" accessibilityLabel="Delete account"
            disabled={!deletion.available || busy || photoBusy} accessibilityState={{ disabled: !deletion.available || busy || photoBusy }}
            style={styles.action} onPress={() => { if (current(user) && deletion.available && !photoRequest.current) { setPassword(''); setConfirmation(user); } }}>
            <Text style={styles.deleteText}>Delete account</Text>
          </Pressable>}
          {!deletion.available && !pending && <Text style={styles.note}>Account deletion will be available after the security update is activated.</Text>}
        </View>
      </>}
    </ScrollView>
    <Modal visible={confirmationVisible} transparent animationType="fade" onRequestClose={cancel}>
      {confirmationVisible &&
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.confirmSafe} edges={['top', 'bottom']}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.confirmScroll}>
            <View accessibilityViewIsModal style={styles.confirmCard}>
              <Text serif accessibilityRole="header" style={styles.title}>Delete your account?</Text>
              <Text style={styles.copy}>This permanently deletes your sign-in, profile, course progress, medals, and saved highlights. It cannot be undone.</Text>
              <Text style={styles.copy}>Enter your password to confirm. Keep Bard open until deletion finishes. If interrupted, reopen Bard and sign in to the same account to resume.</Text>
              <Text style={styles.note}>A minimal security record is retained to prevent old sessions from restoring deleted data.</Text>
              <TextInput accessibilityLabel="Confirm your password" placeholder="Password" placeholderTextColor={C.muted}
                value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
                textContentType="password" allowFontScaling style={styles.input} />
              <Pressable accessibilityRole="button" accessibilityLabel="Permanently delete account" onPress={confirm}
                disabled={!password || busy} accessibilityState={{ disabled: !password || busy }} style={styles.destructive}>
                <Text style={styles.destructiveText}>Permanently delete account</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel deletion" onPress={cancel} style={styles.action}>
                <Text style={styles.actionText}>Cancel</Text>
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>}
    </Modal>
  </SafeAreaView>;
}

const PhotoAction = ({ icon, label, disabled, onPress }) => <Pressable accessibilityRole="button" accessibilityLabel={label}
  disabled={disabled} accessibilityState={{ disabled }} onPress={onPress} style={[styles.photoAction, disabled && styles.disabled]}>
  <FontAwesomeIcon icon={icon} size={17} color={C.gold} /><Text style={styles.photoText}>{label}</Text>
</Pressable>;
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 8, gap: 12,
    backgroundColor: C.surface, borderBottomColor: C.border, borderBottomWidth: 1 },
  title: { flexShrink: 1, color: C.text, fontSize: 24, lineHeight: 33 },
  close: { minHeight: 48, minWidth: 48, marginLeft: 'auto', alignItems: 'center', justifyContent: 'center' },
  content: { padding: 24, paddingBottom: 48, gap: 28, width: '100%', maxWidth: 560, alignSelf: 'center' },
  identity: { alignItems: 'center', gap: 16 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: C.soft, borderColor: C.gold, borderWidth: 1 },
  initials: { alignItems: 'center', justifyContent: 'center' }, initialText: { color: C.gold, fontSize: 24 },
  name: { color: C.text, fontSize: 25, lineHeight: 34, textAlign: 'center' },
  email: { padding: 18, borderColor: C.border, borderWidth: 1, borderRadius: 8, backgroundColor: C.surface, gap: 6 },
  label: { color: C.muted, fontSize: 14, lineHeight: 22 }, copy: { color: C.text, fontSize: 16, lineHeight: 25 },
  section: { gap: 8 }, sectionTitle: { color: C.text, fontSize: 18, lineHeight: 27, fontWeight: '600' },
  photoAction: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingVertical: 14, borderTopColor: C.border, borderTopWidth: 1 },
  photoText: { flex: 1, color: C.text, fontSize: 16, lineHeight: 25 }, disabled: { opacity: 0.6 },
  deleteSection: { borderTopColor: C.border, borderTopWidth: 1, paddingTop: 24, gap: 12 },
  action: { minHeight: 48, paddingVertical: 12, justifyContent: 'center' }, actionText: { color: C.gold, fontSize: 16, lineHeight: 25, fontWeight: '600' },
  deleteText: { color: C.danger, fontSize: 17, lineHeight: 26, fontWeight: '600' }, note: { color: C.muted, fontSize: 14, lineHeight: 22 },
  error: { color: C.danger, fontSize: 15, lineHeight: 24 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 20 }, confirmSafe: { flex: 1 },
  confirmScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
  confirmCard: { backgroundColor: C.background, borderRadius: 12, padding: 24, gap: 18, maxWidth: 520, width: '100%', alignSelf: 'center' },
  input: { color: C.text, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 6,
    minHeight: 56, fontSize: 16, lineHeight: 25, paddingHorizontal: 14, paddingVertical: 14 },
  destructive: { minHeight: 54, padding: 14, backgroundColor: '#6f2638', borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  destructiveText: { color: '#fff8ed', fontSize: 16, lineHeight: 25, textAlign: 'center', fontWeight: '600' },
});
