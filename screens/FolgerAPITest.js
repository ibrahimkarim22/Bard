import { View, Text, StyleSheet } from "react-native";
import { useEffect } from "react";
import HTMLView from "react-native-htmlview";
import { useDispatch, useSelector } from "react-redux";
import { fetchFolger } from "../folgerLibrary/folgerSlice";
import { ScrollView } from "react-native-gesture-handler";
import Loader from "../Componenets/Loader";
import { EDITORIAL_COLORS as C } from "../shared/editorialTheme";

const Folger = () => {
  const dispatch = useDispatch();
  const folger = useSelector((state) => state.folger);

  useEffect(() => {
    dispatch(fetchFolger());
  }, [dispatch]);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.headerText}>Home Screen</Text>
      {folger.isLoading ? (
        <Loader label="Loading BARD" detail="Preparing the library" />
      ) : folger.errMess ? (
        <Text style={styles.error}>Error: {folger.errMess}</Text>
      ) : (
        <HTMLView value={folger.htmlContent} stylesheet={htmlStyles} />
      )}
    </ScrollView>
  );
};

const htmlStyles = StyleSheet.create({
  a: {
    fontWeight: "bold",
    color: C.gold,
  },
  b: {
    fontWeight: "bold",
    color: C.text,
  },
  p: {
    color: C.text,
  },
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: C.background,
    flex: 1,
    padding: 20,
  },
  headerText: {
    color: C.text,
    fontSize: 24,
    marginBottom: 10,
  },
  error: { color: C.danger },
});

export default Folger;
