import React from "react";
import { Provider } from "react-redux";
import { store, persistor } from "./redux/store";
import Stacks from "./Componenets/Navigation";
import { PersistGate } from "redux-persist/integration/react";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { EDITORIAL_COLORS } from "./shared/editorialTheme";

import { StatusBar } from "react-native";
// import { Text } from "react-native-elements";

import "./firebaseConfig";
import { CourseProgressBridge } from "./course/AccountCourseProgress";

const App = () => {
  return (
    <Provider store={store}>
      {/* <PersistGate loading={<Text>Loading...</Text>} persistor={persistor}> */}
      <PersistGate loading={null} persistor={persistor}>
        <CourseProgressBridge>
        <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar backgroundColor={EDITORIAL_COLORS.background} barStyle="dark-content" />
          <Stacks />
        </NavigationContainer>
        </SafeAreaProvider>
        </CourseProgressBridge>
      </PersistGate>
    </Provider>
  );
};

export default App;
