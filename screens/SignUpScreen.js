import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faEnvelope,
  faEye,
  faEyeSlash,
  faLock,
  faUser,
  faUserPlus,
} from "@fortawesome/free-solid-svg-icons";
import { FIREBASE_AUTH, FIRESTORE_DB } from "../firebaseConfig";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useNavigation } from "@react-navigation/native";
import AuthStage, { AUTH_COLORS as C } from './AuthStage';
import { EditorialText as Text } from "../shared/EditorialUI";

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

const SignUpScreen = () => {
  const navigation = useNavigation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const auth = FIREBASE_AUTH;

  const SignUp = async () => {
    setLoading(true);
    try {
      const response = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      await updateProfile(response.user, {
        displayName: `${firstName} ${lastName}`.trim(),
        photoURL:
          "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s",
      });

      const userRef = doc(FIRESTORE_DB, "users", response.user.uid);
      await setDoc(userRef, {
        userId: response.user.uid,
        completedLevel: 0,
        profileImage:
          "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s",
      });

      alert("Welcome to BARD. Enjoy the journey.");
      navigation.navigate("Main");
    } catch (error) {
      console.error(error);
      alert("Sign up failed " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthStage scene="sun" navigation={navigation}>
          <View style={styles.header}>
            <Text serif accessibilityRole="header" style={styles.title}>Create account</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.nameRow}>
              <View style={styles.nameField}>
                <AuthInput
                  icon={faUser}
                  placeholder="First"
                  value={firstName}
                  textContentType="givenName"
                  onChangeText={setFirstName}
                />
              </View>
              <View style={styles.nameField}>
                <AuthInput
                  icon={faUser}
                  placeholder="Last"
                  value={lastName}
                  textContentType="familyName"
                  onChangeText={setLastName}
                />
              </View>
            </View>
            <AuthInput
              icon={faEnvelope}
              placeholder="Email"
              value={email}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              onChangeText={setEmail}
            />
            <AuthInput
              icon={faLock}
              placeholder="Password"
              value={password}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              onChangeText={setPassword}
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

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create account"
              accessibilityState={{ disabled: loading, busy: loading }}
              onPress={SignUp}
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
                  <FontAwesomeIcon icon={faUserPlus} size={16} color={C.onGold} />
                  <Text style={styles.primaryButtonText}>Create account</Text>
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
  nameRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  nameField: {
    flexGrow: 1,
    flexBasis: 200,
    minWidth: 0,
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

export default SignUpScreen;
