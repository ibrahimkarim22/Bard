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
import { useIsFocused } from "@react-navigation/native";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faAward,
  faBars,
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
import { EDITORIAL_COLORS, EDITORIAL_SPACING as S } from "../shared/editorialTheme";
import { EditorialText } from "../shared/EditorialUI";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const defaultProfileImage =
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s";

const tabs = ["Overview", "Medals", "Certificate"];
const C = Object.freeze({
  ...EDITORIAL_COLORS,
  red: '#6f2638', onRed: '#fff8ed', button: '#c6a663', onButton: '#241c15',
});

const HomeScreen = ({ navigation, route }) => {
  const [activeTab, setActiveTab] = useState(() => route?.params?.tab === "Medals" ? "Medals" : "Overview");
  const [profileImage, setProfileImage] = useState(null);
  const [failedPicture, setFailedPicture] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const scrollRef = useRef(null);
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();

  const accountProgress = useAccountCourseProgress();
  const completedLevel = accountProgress.completedLevel;
  const currentUser = FIREBASE_AUTH.currentUser;
  const profileOwner = accountProgress.owner || currentUser;
  const liveProfileOwner = useRef(profileOwner);
  liveProfileOwner.current = profileOwner;
  const imageUrl = profileImage?.owner === profileOwner ? profileImage.uri
    : currentUser?.photoURL || defaultProfileImage;
  const pictureUnavailable = failedPicture?.owner === profileOwner && failedPicture?.uri === imageUrl;
  const displayName = currentUser?.displayName?.trim() || 'Reader';
  const initials = displayName.split(/\s+/).slice(0, 2)
    .map(part => Array.from(part)[0]).join('').toUpperCase();

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
  const avatarSize = isCompact ? 56 : 64;
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
    setImageModalVisible(false);
    setImageLoading(false);
  }, [profileOwner]);

  const processImage = async (imgUri) => {
    const user = currentUser;
    const owner = profileOwner;
    const isCurrent = () => FIREBASE_AUTH.currentUser === user && liveProfileOwner.current === owner;
    if (!user) return;
    try {
      setImageLoading(true);
      const processedImage = await ImageManipulator.manipulateAsync(
        imgUri,
        [{ resize: { width: 400 } }],
        { format: "png" }
      );

      if (!isCurrent()) return;
      setProfileImage({ owner, uri: processedImage.uri });
      await MediaLibrary.saveToLibraryAsync(processedImage.uri);

      if (isCurrent()) {
        await updateProfile(user, {
          photoURL: processedImage.uri,
        });
        if (!isCurrent()) return;

        const userRef = doc(
          FIRESTORE_DB,
          "users",
          user.uid
        );
        await updateDoc(userRef, {
          profileImage: processedImage.uri,
        });
      }
    } catch (error) {
      console.error("Error processing or saving image:", error);
    } finally {
      if (isCurrent()) {
        setImageLoading(false);
        setImageModalVisible(false);
      }
    }
  };

  const getImageFromCamera = async () => {
    const owner = profileOwner;
    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    if (cameraPermission.status !== "granted" || liveProfileOwner.current !== owner) return;

    const capturedImage = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (liveProfileOwner.current === owner && capturedImage.assets?.[0]?.uri) {
      await processImage(capturedImage.assets[0].uri);
    }
  };

  const getImageFromGallery = async () => {
    const owner = profileOwner;
    const mediaLibraryPermissions =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (mediaLibraryPermissions.status !== "granted" || liveProfileOwner.current !== owner) return;

    const capturedImage = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (liveProfileOwner.current === owner && capturedImage.assets?.[0]?.uri) {
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
      <EditorialText serif accessibilityRole="header" style={[styles.pageTitle, isCompact && styles.compactPageTitle]}>
        Continue your course
      </EditorialText>
      <View style={styles.coursePanel}>
        {nextPlay?.mainImage && <Image source={nextPlay.mainImage} resizeMode="cover"
          accessibilityLabel={`${nextPlay.name} artwork`} style={styles.courseArtwork} />}
        <View style={styles.courseCopy}>
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
          <FontAwesomeIcon icon={faChevronRight} size={14} color={C.onButton} />
        </Pressable>
        </View>
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

  const renderMedals = () => <MedalsCollection plays={plays} completedLevel={completedLevel} colors={C}
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

  if (accountProgress.status !== "ready") return <SafeAreaView edges={["top"]} style={styles.loadingScreen}>
    {focused && <StatusBar barStyle="dark-content" backgroundColor={C.background} />}
    <View style={[styles.fixedHeader, styles.noticeHeader]}>
      <EditorialText serif accessibilityRole="header" style={styles.userName}>Home</EditorialText>
      <Pressable accessibilityRole="button" accessibilityLabel="Open navigation menu"
        onPress={() => navigation.openDrawer()} style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}>
        <FontAwesomeIcon icon={faBars} size={20} color={C.text} />
      </Pressable>
    </View>
    <CourseProgressNotice status={accountProgress.status} onRetry={retryAccountProgress} />
  </SafeAreaView>;
  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.screen}>
      {focused && <StatusBar barStyle="dark-content" backgroundColor={C.background} />}
      <View testID="home-fixed-header" style={styles.fixedHeader}>
        <View style={styles.profileRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Update profile picture"
            onPress={() => setImageModalVisible(true)}
            style={[styles.avatarWrap, { minHeight: avatarSize, minWidth: avatarSize }]}>
            {pictureUnavailable ? <View style={[styles.avatar, styles.avatarFallback,
              { borderRadius: avatarSize / 2, height: avatarSize, width: avatarSize }]}>
              <EditorialText accessible={false} style={styles.avatarInitials}>{initials}</EditorialText>
            </View> : <Image key={currentUser?.uid} source={{ uri: imageUrl }} accessible={false}
              onError={() => setFailedPicture({ owner: profileOwner, uri: imageUrl })}
              style={[styles.avatar, { borderRadius: avatarSize / 2, height: avatarSize, width: avatarSize }]} />}
            <View pointerEvents="none" style={styles.cameraBadge}>
              {imageLoading ? <ActivityIndicator size="small" color={C.onRed} />
                : <FontAwesomeIcon icon={faCamera} size={10} color={C.onRed} />}
            </View>
          </Pressable>
          <View style={styles.profileCopy}>
            <EditorialText serif accessibilityRole="header" style={[styles.userName, isCompact && styles.compactUserName]}>
              {displayName}
            </EditorialText>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Open navigation menu"
            onPress={() => navigation.openDrawer()} style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}>
            <FontAwesomeIcon icon={faBars} size={20} color={C.text} />
          </Pressable>
        </View>
        <View accessibilityRole="tablist" accessibilityLabel="Home sections" style={styles.tabRow}>
          {tabs.map(tab => <Pressable key={tab} accessibilityRole="tab" accessibilityLabel={tab}
            accessibilityState={{ selected: activeTab === tab }} onPress={() => selectTab(tab)}
            style={[styles.tabButton, activeTab === tab && styles.activeTabButton]}>
            <EditorialText style={[styles.tabText, activeTab === tab && styles.activeTabText]}>{tab}</EditorialText>
          </Pressable>)}
        </View>
      </View>
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

        {activeTab === "Medals" && renderMedals()}
        {activeTab === "Certificate" && renderCertificate()}

        <View style={[styles.accountSection, { marginHorizontal: horizontalPadding }]}>
          <EditorialText style={styles.userEmail}>{currentUser?.email || "BARD member"}</EditorialText>
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
  loadingScreen: { flex: 1, backgroundColor: EDITORIAL_COLORS.background },
  fixedHeader: { paddingHorizontal: S.horizontal, paddingTop: 12, paddingBottom: 8,
    backgroundColor: C.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  noticeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  scroll: { flex: 1, backgroundColor: C.background },
  content: { backgroundColor: C.background },
  section: { paddingTop: 24, width: '100%', maxWidth: S.maxWidth, alignSelf: 'center' },
  pageTitle: { color: C.text, fontSize: 26, lineHeight: 35, marginBottom: 18 },
  compactPageTitle: { fontSize: 24, lineHeight: 33 },
  coursePanel: { backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border, borderRadius: 12, overflow: 'hidden' },
  courseArtwork: { width: "100%", height: 200, backgroundColor: C.soft },
  courseCopy: { padding: 18 },
  panelEyebrow: { color: C.gold, fontSize: 12, lineHeight: 19, letterSpacing: 1, textTransform: "uppercase", marginBottom: 7 },
  panelTitle: { color: C.text, fontSize: 25, lineHeight: 34 },
  supportingCopy: { color: C.muted, fontSize: 16, lineHeight: 25, marginTop: 10 },
  progressText: { color: C.muted, fontSize: 15, lineHeight: 23, marginTop: 18 },
  progressTrack: { alignSelf: "stretch", backgroundColor: C.soft, height: 4, marginTop: 12, overflow: "hidden" },
  progressFill: { backgroundColor: C.gold, height: "100%" },
  continueButton: { alignItems: "center", justifyContent: "space-between", flexDirection: "row", gap: 16,
    backgroundColor: C.button, borderRadius: 4, minHeight: 54, paddingVertical: 14, paddingHorizontal: 20, marginTop: 24 },
  continueText: { flex: 1, color: C.onButton, fontSize: 17, lineHeight: 25, fontWeight: "700" },
  discovery: { marginTop: 24, backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border, borderRadius: 12, paddingHorizontal: 16 },
  dashboardAction: { alignItems: "center", borderBottomColor: C.border, borderBottomWidth: 1, flexDirection: "row",
    gap: 14, minHeight: 72, paddingVertical: 16 },
  actionCopy: { flex: 1, minWidth: 0, gap: 3 },
  dashboardActionText: { color: C.text, fontSize: 17, lineHeight: 25 },
  actionDetail: { color: C.muted, fontSize: 14, lineHeight: 22 },
  pressed: { opacity: 0.75 },
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 18 },
  tabButton: { alignItems: "center", justifyContent: "center", borderBottomColor: "transparent", borderBottomWidth: 2,
    minHeight: 48, paddingVertical: 10, paddingHorizontal: 6, flexBasis: 80, flexGrow: 1 },
  activeTabButton: { backgroundColor: C.red, borderBottomColor: C.button, borderRadius: 5 },
  tabText: { color: C.muted, fontSize: 14, lineHeight: 22, textAlign: 'center', flexShrink: 1 },
  activeTabText: { color: C.onRed, fontWeight: "700" },
  certificatePanel: { alignItems: "center", backgroundColor: C.surface, borderColor: C.border, borderWidth: 1,
    padding: 22, gap: 12, borderRadius: 12 },
  certificateIcon: { alignItems: "center", justifyContent: "center", padding: 12 },
  certificateTitle: { color: C.text, fontSize: 28, lineHeight: 37, textAlign: "center" },
  certificateText: { color: C.muted, fontSize: 16, lineHeight: 26, textAlign: "center" },
  accountSection: { marginTop: S.section, paddingTop: 24, borderTopColor: C.border, borderTopWidth: 1 },
  profileRow: { alignItems: "center", flexDirection: "row", gap: 14 },
  avatarWrap: { flexShrink: 0 },
  avatar: { backgroundColor: C.soft, borderColor: C.gold, borderWidth: 1 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: C.gold, fontSize: 20, lineHeight: 28 },
  cameraBadge: { alignItems: "center", backgroundColor: C.red, borderColor: C.border, borderWidth: 1,
    borderRadius: 12, bottom: -2, height: 24, justifyContent: "center", position: "absolute", right: -2, width: 24 },
  profileCopy: { flex: 1, minWidth: 0, gap: 3 },
  userName: { color: C.text, fontSize: 25, lineHeight: 33 },
  compactUserName: { fontSize: 22, lineHeight: 30 },
  menuButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  userEmail: { color: C.muted, fontSize: 14, lineHeight: 22 },
  logoutButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 10,
    minHeight: 48, paddingVertical: 12, paddingRight: 18, marginTop: 14 },
  logoutText: { color: C.muted, fontSize: 15, lineHeight: 23 },
  modalBackdrop: { alignItems: "center", backgroundColor: "rgba(41, 39, 32, 0.48)", flex: 1,
    justifyContent: "center", padding: 24 },
  modalPanel: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 20, width: "100%", maxWidth: 520 },
  modalHeader: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 12 },
  modalTitle: { flex: 1, color: C.text, fontSize: 24, lineHeight: 32 },
  modalClose: { alignItems: "center", minHeight: 48, justifyContent: "center", width: 48 },
  modalAction: { alignItems: "center", borderTopColor: C.border, borderTopWidth: 1, flexDirection: "row", gap: 12,
    minHeight: 54, paddingVertical: 14 },
  modalActionText: { flex: 1, color: C.text, fontSize: 16, lineHeight: 24 },
});

export default HomeScreen;
