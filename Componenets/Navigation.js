import { createStackNavigator } from "@react-navigation/stack";
import {
  createDrawerNavigator,
  DrawerContentScrollView,
} from "@react-navigation/drawer";
import { RootScreen } from "../screens/RootScreen";
import HomeScreen from "../screens/HomeScreen";
import ProfileScreen from "../screens/ProfileScreen";
import SignUpScreen from "../screens/SignUpScreen";
import LoginScreen from "../screens/AuthLoginScreen";
import QuizScreen from "../screens/QuizScreen";
import Folger from "../screens/FolgerAPITest";
import FreeFolger from "../screens/Folger";
import ReadFolger from "../screens/Read";
import MyHighlightsScreen from "../screens/MyHighlightsScreen";
import PlayHighlightsScreen from "../screens/PlayHighlightsScreen";
import MITFullPlayScreen from "../screens/MITFullPlayScreen";
import CourseScreen from "../screens/CourseScreen";
import AboutScreen from "../screens/AboutScreen";
import ContactScreen from "../screens/Contact";
import Lesson from "../screens/LessonScreen";
import Synopsis from "../screens/JustSynopsis";
import SynopsisList from "../screens/SynopsisList";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faBarcode,
  faCrown,
  faFeather,
  faHouseFlag,
  faLightbulb,
  faRightFromBracket,
  faRightToBracket,
  faUmbrella,
  faUserPlus,
  faWalkieTalkie,
} from "@fortawesome/free-solid-svg-icons";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { FIREBASE_AUTH } from "../firebaseConfig";
import { runAuthMutation } from "../account/authMutationGate";
import { EditorialText as Text } from "../shared/EditorialUI";
import { EDITORIAL_COLORS as C } from "../shared/editorialTheme";

const Drawer = createDrawerNavigator();
const Stack = createStackNavigator();

function useEditorialHeaderStyle() {
  const { top } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  // Reserve two 26-point title lines at the user's text scale. Only the header
  // owns the status-bar inset; no surrounding screen adds it again.
  return { backgroundColor: C.background, height: top + Math.max(64, 52 * fontScale + 12) };
}

const drawerItems = [
  {
    name: "Home",
    label: "Home",
    icon: faHouseFlag,
  },
  {
    name: "Course",
    label: "Course",
    icon: faCrown,
  },
  {
    name: "SynopsisList",
    label: "Synopses",
    icon: faBarcode,
  },
  {
    name: "FreeFolger",
    label: "Library",
    icon: faFeather,
  },
  {
    name: "MyHighlights",
    label: "My Highlights",
    icon: faLightbulb,
  },
  {
    name: "About",
    label: "About",
    icon: faUmbrella,
  },
  {
    name: "Contact",
    label: "Contact & Feedback",
    icon: faWalkieTalkie,
  },
  {
    name: "SignUp",
    label: "Create account",
    icon: faUserPlus,
    account: true,
  },
  {
    name: "Login",
    label: "Log in",
    icon: faRightToBracket,
    account: true,
  },
];

const logoutItem = { name: "Logout", label: "Log out", icon: faRightFromBracket };

const DrawerNavItem = ({ item, focused, navigation, onPress, disabled = false, busy = false }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={item.label}
    accessibilityState={{ selected: !!focused, disabled, busy }}
    disabled={disabled}
    onPress={onPress || (() => navigation.navigate(item.name))}
    style={({ pressed }) => [
      styles.drawerNavItem,
      focused && styles.drawerNavItemActive,
      pressed && styles.drawerNavItemPressed,
      disabled && styles.drawerNavItemDisabled,
    ]}
  >
    <View
      style={[styles.drawerNavIcon, focused && styles.drawerNavIconActive]}
    >
      <FontAwesomeIcon
        icon={item.icon}
        size={16}
        color={focused ? C.gold : C.muted}
      />
    </View>
    <View style={styles.drawerNavCopy}>
      <Text style={[styles.drawerNavLabel, focused && styles.drawerNavLabelActive]}>
        {item.label}
      </Text>
    </View>
    <View
      style={[styles.drawerNavSignal, focused && styles.drawerNavSignalActive]}
    />
  </Pressable>
);

const CustomDrawerContent = (props) => {
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(null);
  const logoutPending = useRef(false);
  const mounted = useRef(true);
  const observedUser = useRef(props.user);
  observedUser.current = props.user;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { setLogoutError(null); }, [props.user]);
  const logout = () => {
    const owner = props.user;
    if (!owner || logoutPending.current) return;
    logoutPending.current = true;
    setLoggingOut(true);
    setLogoutError(null);
    return runAuthMutation(async () => {
      if (FIREBASE_AUTH.currentUser !== owner) return false;
      await FIREBASE_AUTH.signOut();
      return true;
    }).then(signedOut => {
      if (!mounted.current || !signedOut || FIREBASE_AUTH.currentUser) return;
      let stack = props.navigation;
      while (stack.getParent?.()) stack = stack.getParent();
      stack.reset({ index: 0, routes: [{ name: "Root" }] });
    }).catch(() => {
      if (mounted.current && observedUser.current === owner && FIREBASE_AUTH.currentUser === owner) {
        setLogoutError("We couldn't log you out. Please try again.");
      }
    }).finally(() => {
      logoutPending.current = false;
      if (mounted.current) setLoggingOut(false);
    });
  };
  const focusedRoute = props.state.routes[props.state.index]?.name;
  const routeNames = props.state.routeNames;
  const availableItems = drawerItems.filter((item) =>
    routeNames.includes(item.name) && !(item.account && props.user)
  );
  const primaryItems = availableItems.filter((item) => !item.account);
  const accountItems = availableItems.filter((item) => item.account);

  return (
    <DrawerContentScrollView
      {...props}
      style={styles.sideDrawer}
      contentContainerStyle={styles.drawerContent}
    >
      <View style={styles.drawerBrand}>
        <Text serif style={styles.drawerBrandTitle}>BARD</Text>
      </View>

      <Text style={styles.drawerSectionLabel}>Explore</Text>
      <View style={styles.drawerNavGroup}>
        {primaryItems.map((item) => (
          <DrawerNavItem
            key={item.name}
            item={item}
            focused={focusedRoute === item.name}
            navigation={props.navigation}
          />
        ))}
      </View>

      {(props.user || accountItems.length > 0) && (
        <>
          <Text style={styles.drawerSectionLabel}>Account</Text>
          <View style={styles.drawerNavGroup}>
            {props.user ? <DrawerNavItem
              item={logoutItem}
              onPress={logout}
              disabled={loggingOut}
              busy={loggingOut}
            /> : accountItems.map((item) => (
              <DrawerNavItem
                key={item.name}
                item={item}
                focused={focusedRoute === item.name}
                navigation={props.navigation}
              />
            ))}
            {logoutError && <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
              style={styles.drawerError}>{logoutError}</Text>}
          </View>
        </>
      )}


    </DrawerContentScrollView>
  );
};

const Main = () => {
  const headerStyle = useEditorialHeaderStyle();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(FIREBASE_AUTH, (user) => {
      if (user) {
        setUser(user);
      } else {
        setUser(null);
      }
    });
    return () => unsubscribe();
  }, []);
  return (
    <View style={styles.drawerContainer}>
      <Drawer.Navigator
        drawerContent={props => <CustomDrawerContent {...props} user={user} />}
        screenOptions={{
          drawerStyle: styles.drawerShell,
          sceneContainerStyle: styles.drawerScene,
          headerStyle: [styles.drawerHeader, headerStyle],
          headerTintColor: C.text,
          headerTitleStyle: styles.drawerHeaderTitle,
          headerTitle: ({ children, tintColor }) => <Text accessibilityRole="header" style={[styles.drawerHeaderTitle, { color: tintColor }]}>{children}</Text>,
        }}
      >
        <Drawer.Screen
          name="Home"
          component={HomeScreen}
          options={{
            headerShown: false,
            drawerLabelStyle: { color: C.text },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faHouseFlag}
                style={styles.drawerIcon}
                size={28}
                color={focused ? C.gold : C.muted}
              />
            ),
          }}
        />
        <Drawer.Screen
          name="Course"
          component={CourseScreen}
          options={{
            drawerLabelStyle: { color: C.text },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faCrown}
                style={styles.drawerIcon}
                size={28}
                color={focused ? C.gold : C.muted}
              />
            ),
          }}
        />
        <Drawer.Screen
          name="SynopsisList"
          component={SynopsisList}
          options={{
            title: "Synopses",
            headerTitle: () => null,
            drawerLabelStyle: { color: C.text },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faBarcode}
                style={styles.drawerIcon}
                size={28}
                color={focused ? C.gold : C.muted}
              />
            ),
          }}
        />
        <Drawer.Screen
          name="FreeFolger"
          component={FreeFolger}
          options={{
            title: "Library",
            headerTitle: () => null,
            drawerLabelStyle: { color: C.text },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faFeather}
                style={styles.drawerIcon}
                size={28}
                color={focused ? C.gold : C.muted}
              />
            ),
          }}
        />
        <Drawer.Screen
          name="MyHighlights"
          component={MyHighlightsScreen}
          options={{ title: "My Highlights", drawerLabelStyle: { color: C.text } }}
        />
        <Drawer.Screen
          name="About"
          component={AboutScreen}
          options={{
            drawerLabelStyle: { color: C.text },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faUmbrella}
                style={styles.drawerIcon}
                size={28}
                color={focused ? C.gold : C.muted}
              />
            ),
          }}
        />
        <Drawer.Screen
          name="Contact"
          component={ContactScreen}
          options={{
            title: "Contact & Feedback",
            headerTitle: () => null,
            drawerLabelStyle: { color: C.text },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faWalkieTalkie}
                style={styles.drawerIcon}
                size={28}
                color={focused ? C.gold : C.muted}
              />
            ),
          }}
        />
        {/* Keep account routes mounted while Firebase publishes sign-in and profile writes finish. */}
          <>
            <Drawer.Screen
              name="SignUp"
              component={SignUpScreen}
              options={{
                title: "Create account",
                headerShown: false,
                drawerLabelStyle: { color: C.text },
                drawerIcon: ({ focused }) => (
                  <FontAwesomeIcon
                    icon={faHouseFlag}
                    style={styles.drawerIcon}
                    size={28}
                    color={focused ? C.gold : C.muted}
                  />
                ),
              }}
            />
            <Drawer.Screen
              name="Login"
              component={LoginScreen}
              options={{
                headerShown: false,
                drawerLabelStyle: { color: C.text },
                drawerIcon: ({ focused }) => (
                  <FontAwesomeIcon
                    icon={faHouseFlag}
                    style={styles.drawerIcon}
                    size={28}
                    color={focused ? C.gold : C.muted}
                  />
                ),
              }}
            />
          </>
      </Drawer.Navigator>
    </View>
  );
};

const Stacks = () => {
  const headerStyle = useEditorialHeaderStyle();
  const screenOptions = {
    cardStyle: { backgroundColor: C.background },
    headerTintColor: C.text,
    headerStyle,
    headerTitle: ({ children, tintColor }) => <Text accessibilityRole="header" style={[styles.drawerHeaderTitle, { color: tintColor }]}>{children}</Text>,
    headerTitleStyle: {
      fontWeight: "800",
    },
  };

  return (
    <View style={styles.stackContainer}>
      <Stack.Navigator screenOptions={screenOptions} initialRouteName="Root">
        <Stack.Screen
          name="Main"
          component={Main}
          options={{ headerShown: false, animation: 'none' }}
        />
        <Stack.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Lesson"
          component={Lesson}
          options={{ headerShown: true }}
        />
        <Stack.Screen
          name="Quiz"
          component={QuizScreen}
          options={{ headerShown: true }}
        />

        <Stack.Screen
          name="Folger"
          component={Folger}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="MIT"
          component={MITFullPlayScreen}
          options={{
            title: "Play from MIT",
            headerShown: true,
          }}
        />
        <Stack.Screen
          name="Courses"
          component={CourseScreen}
          options={{ headerShown: true }}
        />
        <Stack.Screen
          name="Root"
          component={RootScreen}
          options={{ headerShown: false, animation: 'none' }}
        />
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ title: "Log in", headerShown: false, animation: 'none' }}
        />
        <Stack.Screen
          name="SignUp"
          component={SignUpScreen}
          options={{ title: "Create account", headerShown: false, animation: 'none' }}
        />
        <Stack.Screen
          name="ReadFolger"
          component={ReadFolger}
          options={{ headerShown: true }}
        />
        <Stack.Screen
          name="PlayHighlights"
          component={PlayHighlightsScreen}
          options={{ title: "Saved highlights", headerShown: true }}
        />
        <Stack.Screen
          name="Synopsis"
          component={Synopsis}
          options={{ headerShown: true }}
        />
      </Stack.Navigator>
    </View>
  );
};

const styles = StyleSheet.create({
  drawerContainer: { flex: 1, backgroundColor: C.background },
  stackContainer: { flex: 1, backgroundColor: C.background },
  drawerShell: { width: 318, backgroundColor: C.background },
  drawerScene: { backgroundColor: C.background },
  drawerHeader: { backgroundColor: C.background, elevation: 0, shadowOpacity: 0, borderBottomColor: C.border, borderBottomWidth: StyleSheet.hairlineWidth },
  drawerHeaderTitle: { color: C.text, fontSize: 19, fontWeight: '600' },
  sideDrawer: { backgroundColor: C.background },
  drawerContent: { paddingHorizontal: 18, paddingBottom: 28 },
  drawerBrand: { paddingHorizontal: 12, paddingVertical: 28, marginBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  drawerBrandTitle: { color: C.text, fontSize: 33, lineHeight: 44, letterSpacing: 4 },
  drawerSectionLabel: { color: C.muted, fontSize: 13, lineHeight: 20, marginBottom: 8, marginLeft: 12 },
  drawerNavGroup: { gap: 4, marginBottom: 24 },
  drawerNavItem: { minHeight: 52, borderRadius: 6, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  drawerNavItemActive: { backgroundColor: C.soft },
  drawerNavItemPressed: { opacity: 0.75 },
  drawerNavItemDisabled: { opacity: 0.5 },
  drawerError: { color: C.muted, fontSize: 14, lineHeight: 21, paddingHorizontal: 12, paddingTop: 4 },
  drawerNavIcon: { width: 24, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  drawerNavCopy: { flex: 1, minWidth: 0 },
  drawerNavLabel: { color: C.text, fontSize: 17, lineHeight: 25 },
  drawerNavLabelActive: { color: C.gold, fontWeight: '600' },
  drawerNavSignal: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent', marginLeft: 8 },
  drawerNavSignalActive: { backgroundColor: C.gold },
});

export default Stacks;
