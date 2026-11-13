import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faAward,
  faBookOpen,
  faBookmark,
  faCamera,
  faCertificate,
  faChevronRight,
  faImage,
  faRightFromBracket,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { updateProfile } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { useAccountCourseProgress, retryAccountProgress } from "../course/AccountCourseProgress";
import { CourseProgressNotice } from "../course/CourseProgressNotice";
import MedalsCollection from "../course/MedalsCollection";
import { getMedalCollection } from "../course/medalCollection";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { FIREBASE_AUTH, FIRESTORE_DB } from "../firebaseConfig";
import { PLAYS } from "../shared/localPlayService";
import { EDITORIAL_COLORS as C, EDITORIAL_SPACING as S } from "../shared/editorialTheme";
import { EditorialText } from "../shared/EditorialUI";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const defaultProfileImage =
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s";

const tabs = ["Overview", "Medals", "Certificate"];

const HomeScreen = ({ navigation, route }) => {
  const [activeTab, setActiveTab] = useState(() => route?.params?.tab === "Medals" ? "Medals" : "Overview");
  const [imageUrl, setImageUrl] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const scrollRef = useRef(null);
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const accountProgress = useAccountCourseProgress();
  const completedLevel = accountProgress.completedLevel;
  const currentUser = FIREBASE_AUTH.currentUser;

  const plays = useMemo(
    () => PLAYS.slice().sort((a, b) => a.difficulty - b.difficulty),
    []
  );

  const collection = getMedalCollection(plays, completedLevel);
  const totalPlays = collection.total;
  const completedPlays = collection.earnedCount;
  const confirmedLevel = Number.isSafeInteger(completedLevel) && completedLevel >= 0 ? completedLevel : 0;
  const medalCount = completedPlays;
  const progress = collection.completion;
  const courseComplete = totalPlays > 0 && progress >= 1;
  const nextPlay = courseComplete ? plays[plays.length - 1]
    : plays.find((play) => play.difficulty === confirmedLevel + 1);
  const isCompact = width < 360 || fontScale > 1.2;
  const horizontalPadding = S.horizontal;
  const avatarSize = 64;
  const selectTab = (tab) => {
    setActiveTab(tab);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  useEffect(() => {
    if (route?.params?.tab !== "Medals") return;
    setActiveTab("Medals");
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    navigation.setParams?.({ tab: undefined });
  }, [route?.key, route?.params?.tab, navigation]);

  useEffect(() => {
    const user = FIREBASE_AUTH.currentUser;
    setImageUrl(user?.photoURL || defaultProfileImage);
  }, []);

  const processImage = async (imgUri) => {
    try {
      setImageLoading(true);
      const processedImage = await ImageManipulator.manipulateAsync(
        imgUri,
        [{ resize: { width: 400 } }],
        { format: "png" }
      );

      setImageUrl(processedImage.uri);
      await MediaLibrary.saveToLibraryAsync(processedImage.uri);

      if (FIREBASE_AUTH.currentUser) {
        await updateProfile(FIREBASE_AUTH.currentUser, {
          photoURL: processedImage.uri,
        });

        const userRef = doc(
          FIRESTORE_DB,
          "users",
          FIREBASE_AUTH.currentUser.uid
        );
        await updateDoc(userRef, {
          profileImage: processedImage.uri,
        });
      }
    } catch (error) {
      console.error("Error processing or saving image:", error);
    } finally {
      setImageLoading(false);
      setImageModalVisible(false);
    }
  };

  const getImageFromCamera = async () => {
    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    if (cameraPermission.status !== "granted") return;

    const capturedImage = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (capturedImage.assets?.[0]?.uri) {
      await processImage(capturedImage.assets[0].uri);
    }
  };

  const getImageFromGallery = async () => {
    const mediaLibraryPermissions =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (mediaLibraryPermissions.status !== "granted") return;

    const capturedImage = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (capturedImage.assets?.[0]?.uri) {
      await processImage(capturedImage.assets[0].uri);
    }
  };

  const logout = () => {
    FIREBASE_AUTH.signOut()
      .then(() => navigation.navigate("Root"))
      .catch((error) => console.error("Error logging out: ", error));
  };

  const renderOverview = () => (
    <View style={[styles.section, { paddingHorizontal: horizontalPadding }]}>
      <EditorialText style={styles.eyebrow}>Your Shakespeare course</EditorialText>
      <EditorialText serif accessibilityRole="header" style={[styles.pageTitle, isCompact && styles.compactPageTitle]}>
        Continue your course
      </EditorialText>
      <View style={styles.coursePanel}>
        {nextPlay?.mainImage && <Image source={nextPlay.mainImage} resizeMode="cover"
          accessibilityLabel={`${nextPlay.name} artwork`} style={styles.courseArtwork} />}
        <EditorialText style={styles.panelEyebrow}>
          {courseComplete ? "Course complete" : nextPlay ? `Play ${nextPlay.difficulty} · ${nextPlay.genre || "Shakespeare"}` : "Your course"}
        </EditorialText>
        <EditorialText serif accessibilityRole="header" style={styles.panelTitle}>
          {courseComplete ? "All plays completed" : nextPlay?.name || "Course overview"}
        </EditorialText>
        {!nextPlay && <EditorialText style={styles.supportingCopy}>Open the course to see your available lessons.</EditorialText>}
        <EditorialText style={styles.progressText}>{`${completedPlays} of ${totalPlays} plays completed`}</EditorialText>
        <View accessibilityRole="progressbar" accessibilityLabel="Course progress"
          accessibilityValue={{ min: 0, max: totalPlays, now: completedPlays }} style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={courseComplete ? "Revisit course" : nextPlay ? "Continue" : "View course"}
          onPress={() => navigation.navigate("Course")}
          style={({ pressed }) => [styles.continueButton, pressed && styles.pressed]}>
          <EditorialText style={styles.continueText}>{courseComplete ? "Revisit course" : nextPlay ? "Continue" : "View course"}</EditorialText>
          <FontAwesomeIcon icon={faChevronRight} size={14} color={C.onGold} />
        </Pressable>
      </View>

      <View style={styles.discovery}>
        <DashboardAction
          icon={faBookOpen}
          label="Browse plays"
          detail="The complete library"
          onPress={() => navigation.navigate("FreeFolger")}
        />
        <DashboardAction icon={faBookmark} label="Saved passages" detail="Your highlighted lines"
          onPress={() => navigation.navigate("MyHighlights")} />
        <DashboardAction icon={faAward} label="Medals" detail={`${medalCount} earned`}
          onPress={() => selectTab("Medals")} />
      </View>
    </View>
  );

  const renderMedals = () => <MedalsCollection plays={plays} completedLevel={completedLevel}
    onOpenLesson={play => navigation.navigate("Lesson", { id: play.id })} />;

  const renderCertificate = () => (
    <View style={[styles.section, { paddingHorizontal: horizontalPadding }]}>
      <View style={styles.certificatePanel}>
        <View style={styles.certificateIcon}>
          <FontAwesomeIcon icon={faCertificate} size={28} color={C.gold} />
        </View>
        <EditorialText serif accessibilityRole="header" style={styles.certificateTitle}>
          {progress >= 1 ? "Certificate ready" : "Certificate in progress"}
        </EditorialText>
        <EditorialText style={styles.certificateText}>
          Complete all {totalPlays} plays to unlock the final course certificate.
        </EditorialText>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <EditorialText style={styles.progressText}>{Math.round(progress * 100)}% complete</EditorialText>
      </View>
    </View>
  );

  if (accountProgress.status !== "ready") return <CourseProgressNotice status={accountProgress.status} onRetry={retryAccountProgress} />;
  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.background} />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom + 28, 44) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "Overview" && renderOverview()}

        <View style={[styles.tabRow, { paddingHorizontal: horizontalPadding }]}>
          {tabs.map((tab) => (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityLabel={tab}
              accessibilityState={{ selected: activeTab === tab }}
              onPress={() => selectTab(tab)}
              style={[
                styles.tabButton,
                activeTab === tab && styles.activeTabButton,
              ]}
            >
              <EditorialText
                style={[
                  styles.tabText,
                  activeTab === tab && styles.activeTabText,
                ]}
              >
                {tab}
              </EditorialText>
            </Pressable>
          ))}
        </View>

        {activeTab === "Medals" && renderMedals()}
        {activeTab === "Certificate" && renderCertificate()}

        <View style={[styles.accountSection, { marginHorizontal: horizontalPadding }]}>
          <View style={[styles.profileRow, isCompact && styles.compactProfileRow]}>
            <View style={[styles.avatarWrap, { height: avatarSize, width: avatarSize }]}>
              <Image source={{ uri: imageUrl || defaultProfileImage }} style={[styles.avatar,
                { borderRadius: avatarSize / 2, height: avatarSize, width: avatarSize }]} />
              <Pressable accessibilityRole="button" accessibilityLabel="Update profile picture"
                onPress={() => setImageModalVisible(true)} style={styles.cameraButton}>
                {imageLoading ? <ActivityIndicator size="small" color={C.gold} />
                  : <FontAwesomeIcon icon={faCamera} size={15} color={C.gold} />}
              </Pressable>
            </View>
            <View style={[styles.profileCopy, isCompact && styles.compactProfileCopy]}>
              <EditorialText style={styles.welcome}>Your account</EditorialText>
              <EditorialText style={styles.userName}>{currentUser?.displayName || "Reader"}</EditorialText>
              <EditorialText style={styles.userEmail}>{currentUser?.email || "BARD member"}</EditorialText>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Log out" onPress={logout} style={styles.logoutButton}>
            <FontAwesomeIcon icon={faRightFromBracket} size={15} color={C.muted} />
            <EditorialText style={styles.logoutText}>Log out</EditorialText>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={imageModalVisible}
        onRequestClose={() => setImageModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeader}>
              <EditorialText serif style={styles.modalTitle}>Update profile picture</EditorialText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close profile picture options"
                onPress={() => setImageModalVisible(false)}
                style={styles.modalClose}
              >
                <FontAwesomeIcon icon={faXmark} size={16} color={C.text} />
              </Pressable>
            </View>
            <ModalAction
              icon={faCamera}
              label="Take Photo"
              onPress={getImageFromCamera}
            />
            <ModalAction
              icon={faImage}
              label="Choose from Library"
              onPress={getImageFromGallery}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const DashboardAction = ({ icon, label, detail, onPress }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    style={({ pressed }) => [
      styles.dashboardAction,
      pressed && styles.pressed,
    ]}
  >
    <FontAwesomeIcon icon={icon} size={17} color={C.gold} />
    <View style={styles.actionCopy}>
      <EditorialText style={styles.dashboardActionText}>{label}</EditorialText>
      <EditorialText style={styles.actionDetail}>{detail}</EditorialText>
    </View>
    <FontAwesomeIcon icon={faChevronRight} size={13} color={C.muted} />
  </Pressable>
);

const ModalAction = ({ icon, label, onPress }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.modalAction}>
    <FontAwesomeIcon icon={icon} size={16} color={C.gold} />
    <EditorialText style={styles.modalActionText}>{label}</EditorialText>
  </Pressable>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  scroll: { flex: 1 },
  content: { backgroundColor: C.background },
  section: { paddingTop: S.section },
  eyebrow: { color: C.gold, fontSize: 12, lineHeight: 18, letterSpacing: 1.5, textTransform: "uppercase" },
  pageTitle: { color: C.text, fontSize: 36, lineHeight: 44, marginTop: 8, marginBottom: 24 },
  compactPageTitle: { fontSize: 30, lineHeight: 39 },
  coursePanel: { gap: 0 },
  courseArtwork: { width: "100%", height: 240, backgroundColor: C.soft, marginBottom: 22 },
  panelEyebrow: { color: C.gold, fontSize: 12, lineHeight: 19, letterSpacing: 1, textTransform: "uppercase", marginBottom: 7 },
  panelTitle: { color: C.text, fontSize: 30, lineHeight: 39 },
  supportingCopy: { color: C.muted, fontSize: 16, lineHeight: 25, marginTop: 10 },
  progressText: { color: C.muted, fontSize: 15, lineHeight: 23, marginTop: 18 },
  progressTrack: { alignSelf: "stretch", backgroundColor: C.soft, height: 4, marginTop: 12, overflow: "hidden" },
  progressFill: { backgroundColor: C.gold, height: "100%" },
  continueButton: { alignItems: "center", justifyContent: "space-between", flexDirection: "row", gap: 16,
    backgroundColor: C.gold, borderRadius: 4, minHeight: 54, paddingVertical: 14, paddingHorizontal: 20, marginTop: 24 },
  continueText: { flex: 1, color: C.onGold, fontSize: 17, lineHeight: 25, fontWeight: "700" },
  discovery: { marginTop: S.section, borderTopWidth: 1, borderTopColor: C.border },
  dashboardAction: { alignItems: "center", borderBottomColor: C.border, borderBottomWidth: 1, flexDirection: "row",
    gap: 16, minHeight: 76, paddingVertical: 18 },
  actionCopy: { flex: 1, minWidth: 0, gap: 3 },
  dashboardActionText: { color: C.text, fontSize: 18, lineHeight: 26 },
  actionDetail: { color: C.muted, fontSize: 14, lineHeight: 22 },
  pressed: { opacity: 0.75 },
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: S.section },
  tabButton: { alignItems: "center", justifyContent: "center", borderBottomColor: "transparent", borderBottomWidth: 2,
    minHeight: 48, paddingVertical: 10, paddingHorizontal: 12, flexGrow: 1 },
  activeTabButton: { borderBottomColor: C.gold },
  tabText: { color: C.muted, fontSize: 14, lineHeight: 22 },
  activeTabText: { color: C.gold, fontWeight: "700" },
  certificatePanel: { alignItems: "center", backgroundColor: C.surface, borderColor: C.border, borderWidth: 1,
    padding: 22, gap: 12 },
  certificateIcon: { alignItems: "center", justifyContent: "center", padding: 12 },
  certificateTitle: { color: C.text, fontSize: 28, lineHeight: 37, textAlign: "center" },
  certificateText: { color: C.muted, fontSize: 16, lineHeight: 26, textAlign: "center" },
  accountSection: { marginTop: S.section, paddingTop: 24, borderTopColor: C.border, borderTopWidth: 1 },
  profileRow: { alignItems: "center", flexDirection: "row", gap: 20 },
  compactProfileRow: { alignItems: "flex-start", flexDirection: "column", gap: 18 },
  avatarWrap: { flexShrink: 0 },
  avatar: { backgroundColor: C.soft, borderColor: C.border, borderWidth: 1 },
  cameraButton: { alignItems: "center", backgroundColor: C.surface, borderColor: C.border, borderWidth: 1,
    borderRadius: 24, bottom: -4, minHeight: 48, justifyContent: "center", position: "absolute", right: -10, width: 48 },
  profileCopy: { flex: 1, minWidth: 0, gap: 3 },
  compactProfileCopy: { flex: 0, alignSelf: "stretch" },
  welcome: { color: C.muted, fontSize: 12, lineHeight: 18, letterSpacing: 1, textTransform: "uppercase" },
  userName: { color: C.text, fontSize: 18, lineHeight: 26 },
  userEmail: { color: C.muted, fontSize: 14, lineHeight: 22 },
  logoutButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 10,
    minHeight: 48, paddingVertical: 12, paddingRight: 18, marginTop: 14 },
  logoutText: { color: C.muted, fontSize: 15, lineHeight: 23 },
  modalBackdrop: { alignItems: "center", backgroundColor: "rgba(41, 39, 32, 0.48)", flex: 1,
    justifyContent: "center", padding: 24 },
  modalPanel: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, padding: 20, width: "100%", maxWidth: 520 },
  modalHeader: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 12 },
  modalTitle: { flex: 1, color: C.text, fontSize: 24, lineHeight: 32 },
  modalClose: { alignItems: "center", minHeight: 48, justifyContent: "center", width: 48 },
  modalAction: { alignItems: "center", borderTopColor: C.border, borderTopWidth: 1, flexDirection: "row", gap: 12,
    minHeight: 54, paddingVertical: 14 },
  modalActionText: { flex: 1, color: C.text, fontSize: 16, lineHeight: 24 },
});

export default HomeScreen;
