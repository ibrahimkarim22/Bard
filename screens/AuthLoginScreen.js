import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useEffect, useRef, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faCheck,
  faEnvelope,
  faEye,
  faEyeSlash,
  faLock,
  faRightToBracket,
} from "@fortawesome/free-solid-svg-icons";
import { FIREBASE_AUTH } from "../firebaseConfig";
import { signInWithEmailAndPassword } from "firebase/auth";
import * as SecureStore from "expo-secure-store";
import { runCredentialMutation } from '../account/credentialGate';
import { runAuthMutation } from '../account/authMutationGate';
import { authenticationErrorMessage, requiredCredentialsMessage } from '../account/authMessages';
import AuthStage, { AUTH_COLORS as C } from './AuthStage';
import AuthFormError from './AuthFormError';
import { EditorialText as Text } from "../shared/EditorialUI";

const auth = FIREBASE_AUTH;

const AuthInput = ({ icon, rightElement, ...props }) => (
  <View style={styles.inputWrap}>
    <FontAwesomeIcon icon={icon} size={15} color={C.muted} />
    <TextInput
      {...props}
      accessibilityLabel={props.placeholder}
      placeholderTextColor={C.muted}
      allowFontScaling
      style={styles.input}
    />
    {rightElement}
  </View>
);

const AuthLoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authenticatedUser, setAuthenticatedUser] = useState(null);
  const [formError, setFormError] = useState(null);
  const focused = useIsFocused();
  const active = useRef(focused);
  const submission = useRef(null);
  const formRevision = useRef(0);
  active.current = focused;

  useEffect(() => {
    active.current = focused;
    if (!focused) { submission.current = null; setAuthenticatedUser(null); setLoading(false); setFormError(null); }
    return () => { active.current = false; submission.current = null; };
  }, [focused]);

  useEffect(() => {
    SecureStore.getItemAsync("userinfo").then((userdata) => {
      const userInfo = userdata ? JSON.parse(userdata) : null;
      if (userInfo) {
        setEmail(userInfo.email);
        setPassword(userInfo.password);
        setRemember(true);
      }
    });
  }, []);

  const changeField = (setField, value) => {
    formRevision.current += 1;
    setFormError(null);
    setField(value);
  };

  const Login = async () => {
    if (!active.current || submission.current) return;
    const requiredMessage = requiredCredentialsMessage(email, password);
    if (requiredMessage) { setFormError(requiredMessage); return; }
    const submittedEmail = email.trim();
    const request = { revision: formRevision.current };
    submission.current = request;
    const isCurrent = () => active.current && submission.current === request;
    let succeeded = false;
    setFormError(null);
    setLoading(true);
    try {
      const response = await runAuthMutation(() => isCurrent() ? signInWithEmailAndPassword(auth, submittedEmail, password) : null);
      if (!response || !isCurrent() || auth.currentUser !== response.user) return;
      // Serialize with confirmed-deletion cleanup; a newly signed-in account's
      // remembered credentials must not be erased by an older account's job.
      await runCredentialMutation(async () => {
        if (!isCurrent() || auth.currentUser !== response.user) return;
        if (remember) await SecureStore.setItemAsync('userinfo', JSON.stringify({ uid: response.user.uid, email: submittedEmail, password }));
        else await SecureStore.deleteItemAsync('userinfo');
      }).catch(() => {});
      if (!isCurrent() || auth.currentUser !== response.user) return;
      succeeded = true;
      setAuthenticatedUser(response.user);
    } catch (error) {
      if (!isCurrent() || request.revision !== formRevision.current) return;
      setFormError(authenticationErrorMessage(error, 'login'));
    } finally {
      if (isCurrent() && !succeeded) { submission.current = null; setLoading(false); }
    }
  };

  return (
    <AuthStage scene="crescent" navigation={navigation} authenticatedUser={authenticatedUser}
      onSuccessCancelled={() => { submission.current = null; setAuthenticatedUser(null); setLoading(false); }}>
          <View style={styles.header}>
            <Text serif accessibilityRole="header" style={styles.title}>Log in</Text>
          </View>

          <View style={styles.card}>
            <AuthInput
              icon={faEnvelope}
              placeholder="Email"
              value={email}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              onChangeText={value => changeField(setEmail, value)}
            />
            <AuthInput
              icon={faLock}
              placeholder="Password"
              value={password}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              onChangeText={value => changeField(setPassword, value)}
              secureTextEntry={!showPassword}
              rightElement={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    showPassword ? "Hide password" : "Show password"
                  }
                  onPress={() => setShowPassword((visible) => !visible)}
                  style={styles.visibilityButton}
                >
                  <FontAwesomeIcon
                    icon={showPassword ? faEyeSlash : faEye}
                    size={16}
                    color={C.muted}
                  />
                </Pressable>
              }
            />

            <AuthFormError message={formError} />

            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="Remember me"
              accessibilityState={{ checked: remember }}
              onPress={() => setRemember(!remember)}
              style={styles.rememberRow}
            >
              <View style={[styles.checkbox, remember && styles.checkboxOn]}>
                {remember && (
                  <FontAwesomeIcon icon={faCheck} size={11} color={C.onGold} />
                )}
              </View>
              <Text style={styles.rememberText}>Remember me</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Log in"
              accessibilityState={{ disabled: loading, busy: loading }}
              onPress={Login}
              disabled={loading}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
                loading && styles.disabledButton,
              ]}
            >
              {loading ? (
                <ActivityIndicator size="small" color={C.onGold} />
              ) : (
                <>
                  <FontAwesomeIcon
                    icon={faRightToBracket}
                    size={16}
                    color={C.onGold}
                  />
                  <Text style={styles.primaryButtonText}>Log in</Text>
                </>
              )}
            </Pressable>
          </View>
    </AuthStage>
  );
};

const styles = StyleSheet.create({
  header: {
    marginBottom: 28,
  },
  title: {
    color: C.text,
    fontSize: 26,
    fontWeight: "400",
    lineHeight: 34,
  },
  card: {
    gap: 16,
  },
  inputWrap: {
    alignItems: "center",
    backgroundColor: C.background,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 6,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: 12,
  },
  input: {
    color: C.text,
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    fontSize: 14,
    lineHeight: 22,
    paddingVertical: 14,
    marginLeft: 11,
  },
  visibilityButton: {
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
    marginLeft: 4,
    minWidth: 48,
  },
  rememberRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 48,
    paddingVertical: 10,
  },
  checkbox: {
    alignItems: "center",
    borderColor: C.muted,
    borderRadius: 5,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    marginRight: 10,
    width: 22,
  },
  checkboxOn: {
    backgroundColor: C.gold,
    borderColor: C.gold,
  },
  rememberText: {
    color: C.text,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    flexShrink: 1,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: C.gold,
    borderRadius: 8,
    flexDirection: "row",
    gap: 9,
    minHeight: 56,
    paddingVertical: 14,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  disabledButton: {
    opacity: 0.7,
  },
  buttonPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
  primaryButtonText: {
    color: C.onGold,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "center",
  },
});

export default AuthLoginScreen;
