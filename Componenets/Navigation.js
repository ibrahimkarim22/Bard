import { createStackNavigator } from "@react-navigation/stack";
import {
  createDrawerNavigator,
  DrawerContentScrollView,
} from "@react-navigation/drawer";
import { RootScreen } from "../screens/RootScreen";
import HomeScreen from "../screens/HomeScreen";
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
  faRightToBracket,
  faUmbrella,
  faUserPlus,
  faWalkieTalkie,
} from "@fortawesome/free-solid-svg-icons";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { FIREBASE_AUTH } from "../firebaseConfig";
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

const DrawerNavItem = ({ item, focused, navigation }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityState={focused ? { selected: true } : undefined}
    onPress={() => navigation.navigate(item.name)}
    style={({ pressed }) => [
      styles.drawerNavItem,
      focused && styles.drawerNavItemActive,
      pressed && styles.drawerNavItemPressed,
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
  const focusedRoute = props.state.routes[props.state.index]?.name;
  const routeNames = props.state.routeNames;
  const availableItems = drawerItems.filter((item) =>
    routeNames.includes(item.name)
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

      {accountItems.length > 0 && (
        <>
          <Text style={styles.drawerSectionLabel}>Account</Text>
          <View style={styles.drawerNavGroup}>
            {accountItems.map((item) => (
              <DrawerNavItem
                key={item.name}
                item={item}
                focused={focusedRoute === item.name}
                navigation={props.navigation}
              />
            ))}
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
        drawerContent={CustomDrawerContent}
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
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faHouseFlag}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
              />
            ),
          }}
        />
        <Drawer.Screen
          name="Course"
          component={CourseScreen}
          options={{
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faCrown}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
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
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faBarcode}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
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
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faFeather}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
              />
            ),
          }}
        />
        <Drawer.Screen
          name="MyHighlights"
          component={MyHighlightsScreen}
          options={{ title: "My Highlights", drawerLabelStyle: { color: "white" } }}
        />
        <Drawer.Screen
          name="About"
          component={AboutScreen}
          options={{
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faUmbrella}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
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
            drawerLabelStyle: { color: "white" },
            drawerIcon: ({ focused }) => (
              <FontAwesomeIcon
                icon={faWalkieTalkie}
                style={styles.drawerIcon}
                size={28}
                color={focused ? "peru" : "gray"}
              />
            ),
          }}
        />
        {!user && (
          <>
            <Drawer.Screen
              name="SignUp"
              component={SignUpScreen}
              options={{
                title: "Create account",
                headerShown: false,
                drawerLabelStyle: { color: "white" },
                drawerIcon: ({ focused }) => (
                  <FontAwesomeIcon
                    icon={faHouseFlag}
                    style={styles.drawerIcon}
                    size={28}
                    color={focused ? "peru" : "gray"}
                  />
                ),
              }}
            />
            <Drawer.Screen
              name="Login"
              component={LoginScreen}
              options={{
                headerShown: false,
                drawerLabelStyle: { color: "white" },
                drawerIcon: ({ focused }) => (
                  <FontAwesomeIcon
                    icon={faHouseFlag}
                    style={styles.drawerIcon}
                    size={28}
                    color={focused ? "peru" : "gray"}
                  />
                ),
              }}
            />
          </>
        )}
      </Drawer.Navigator>
    </View>
  );
};

const Stacks = () => {
  const headerStyle = useEditorialHeaderStyle();
  const screenOptions = {
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
          options={{ title: "Log in", headerShown: false, animation: 'none', cardStyle: { backgroundColor: '#0e0c20' } }}
        />
        <Stack.Screen
          name="SignUp"
          component={SignUpScreen}
          options={{ title: "Create account", headerShown: false, animation: 'none', cardStyle: { backgroundColor: '#0e0c20' } }}
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
  drawerNavIcon: { width: 24, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  drawerNavCopy: { flex: 1, minWidth: 0 },
  drawerNavLabel: { color: C.text, fontSize: 17, lineHeight: 25 },
  drawerNavLabelActive: { color: C.gold, fontWeight: '600' },
  drawerNavSignal: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent', marginLeft: 8 },
  drawerNavSignalActive: { backgroundColor: C.gold },
});

export default Stacks;
