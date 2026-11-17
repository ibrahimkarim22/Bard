import React from "react";
import { Provider } from "react-redux";
import { store, persistor } from "./redux/store";
import Stacks from "./Componenets/Navigation";
import { PersistGate } from "redux-persist/integration/react";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { EDITORIAL_COLORS } from "./shared/editorialTheme";

import { StatusBar } from "react-native";
// import { Text } from "react-native-elements";

import "./firebaseConfig";
import { CourseProgressBridge } from "./course/AccountCourseProgress";
import AuthCurtainProvider from "./screens/HomeArrivalCurtain";
import AccountDeletionBridge from './account/AccountDeletionBridge';

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: EDITORIAL_COLORS.gold,
    background: EDITORIAL_COLORS.background,
    card: EDITORIAL_COLORS.surface,
    text: EDITORIAL_COLORS.text,
    border: EDITORIAL_COLORS.border,
    notification: EDITORIAL_COLORS.gold,
  },
};

const App = () => {
  return (
    <Provider store={store}>
      {/* <PersistGate loading={<Text>Loading...</Text>} persistor={persistor}> */}
      <PersistGate loading={null} persistor={persistor}>
        <CourseProgressBridge>
        <SafeAreaProvider>
        <NavigationContainer theme={navigationTheme}>
          <AccountDeletionBridge>
          <AuthCurtainProvider>
          <StatusBar backgroundColor={EDITORIAL_COLORS.background} barStyle="light-content" />
          <Stacks />
          </AuthCurtainProvider>
          </AccountDeletionBridge>
        </NavigationContainer>
        </SafeAreaProvider>
        </CourseProgressBridge>
      </PersistGate>
    </Provider>
  );
};

export default App;
