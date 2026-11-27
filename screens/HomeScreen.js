import {
  Image,
  Platform,
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
  faCertificate,
  faChevronRight,
  faPen,
  faRightFromBracket,
} from "@fortawesome/free-solid-svg-icons";
import { useAccountCourseProgress, retryAccountProgress } from "../course/AccountCourseProgress";
import { CourseProgressNotice } from "../course/CourseProgressNotice";
import MedalsCollection from "../course/MedalsCollection";
import { getMedalCollection } from "../course/medalCollection";
import { FIREBASE_AUTH } from "../firebaseConfig";
import { PLAYS } from "../shared/localPlayService";
import { EDITORIAL_COLORS, EDITORIAL_SPACING as S } from "../shared/editorialTheme";
import { EditorialText } from "../shared/EditorialUI";
import PosterImage from "../shared/PosterImage";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthCurtainTransition } from './HomeArrivalCurtain';
import { runAuthMutation } from '../account/authMutationGate';

const defaultProfileImage =
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s";

const tabs = ["Overview", "Medals", "Certificate"];
const C = Object.freeze({
  ...EDITORIAL_COLORS,
  button: EDITORIAL_COLORS.gold, onButton: EDITORIAL_COLORS.onGold,
});
const supportsGradients = Platform.OS === 'web' || !!globalThis.nativeFabricUIManager;
const gradientProperty = Platform.OS === 'web' ? 'backgroundImage' : 'experimental_backgroundImage';
const posterFade = `linear-gradient(to bottom, rgba(27,24,32,0) 0%, rgba(27,24,32,0) 35%, rgba(27,24,32,0.38) 62%, rgba(27,24,32,0.92) 85%, ${C.surface} 100%)`;

const HomeScreen = ({ navigation, route }) => {
  const [activeTab, setActiveTab] = useState(() => route?.params?.tab === "Medals" ? "Medals" : "Overview");
  const [failedPicture, setFailedPicture] = useState(null);
  const scrollRef = useRef(null);
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const curtain = useAuthCurtainTransition();

  const accountProgress = useAccountCourseProgress();
  const reportHomeLayout = event => {
    const bounds = event.nativeEvent?.layout;
    if (!focused || !curtain.active || !curtain.id || !['ready', 'error'].includes(accountProgress.status)
      || !Number.isFinite(bounds?.width) || bounds.width <= 0 || !Number.isFinite(bounds?.height) || bounds.height <= 0) return;
    curtain.markHomeReady({ id: curtain.id, uid: accountProgress.owner?.uid, status: accountProgress.status });
  };
  const completedLevel = accountProgress.completedLevel;
  const currentUser = FIREBASE_AUTH.currentUser;
  const profileOwner = accountProgress.owner || currentUser;
  const liveProfileOwner = useRef(profileOwner);
  liveProfileOwner.current = profileOwner;
  const imageUrl = currentUser?.photoURL || defaultProfileImage;
  const pictureUnavailable = failedPicture?.owner === profileOwner && failedPicture?.uri === imageUrl;
  const displayName = currentUser?.displayName?.trim() || 'Reader';
  const initials = displayName.split(/\s+/).slice(0, 2)
    .map(part => Array.from(part)[0]).join('').toUpperCase();
  const renderAvatar = size => pictureUnavailable ? <View style={[styles.avatar, styles.avatarFallback,
    { borderRadius: size / 2, height: size, width: size }]}>
    <EditorialText accessible={false} style={styles.avatarInitials}>{initials}</EditorialText>
  </View> : <Image key={currentUser?.uid} source={{ uri: imageUrl }} accessible={false}
    onError={() => setFailedPicture({ owner: profileOwner, uri: imageUrl })}
    style={[styles.avatar, { borderRadius: size / 2, height: size, width: size }]} />;

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
  const posterHeight = Math.round(Math.min(420, Math.max(300, (Math.min(width, S.maxWidth) - horizontalPadding * 2) * 1.05)));
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

  const editProfile = () => {
    if (currentUser && FIREBASE_AUTH.currentUser === currentUser && liveProfileOwner.current === profileOwner) navigation.navigate('Profile');
  };

  const logout = () => {
    runAuthMutation(async () => {
      if (!currentUser || FIREBASE_AUTH.currentUser !== currentUser) return false;
      await FIREBASE_AUTH.signOut();
      return true;
    })
      .then(signedOut => { if (signedOut && !FIREBASE_AUTH.currentUser) navigation.navigate("Root"); })
      .catch((error) => console.error("Error logging out: ", error));
  };

  const renderOverview = () => (
    <View style={[styles.section, { paddingHorizontal: horizontalPadding }]}>
      <View testID="home-course-card" style={styles.coursePanel}>
        {nextPlay?.mainImage && <>
          <PosterImage source={nextPlay.mainImage} resizeMode="cover" accessible={false}
            style={[styles.courseArtwork, { height: posterHeight }]} />
          {supportsGradients && <View testID="home-course-fade" pointerEvents="none" accessible={false}
            accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={[styles.courseArtwork, { height: posterHeight, [gradientProperty]: posterFade }]} />}
        </>}
        <View testID="home-course-copy" style={[styles.courseCopy, nextPlay?.mainImage && {
          paddingTop: supportsGradients ? posterHeight - 108 : posterHeight + 18,
        }]}>
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

  if (accountProgress.status !== "ready") return <SafeAreaView key={accountProgress.status} onLayout={reportHomeLayout}
    edges={["top"]} style={styles.loadingScreen}>
    {focused && !curtain.active && <StatusBar barStyle="light-content" backgroundColor={C.background} />}
    <View style={[styles.fixedHeader, styles.noticeHeader]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open navigation menu"
        onPress={() => navigation.openDrawer()} style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}>
        <FontAwesomeIcon icon={faBars} size={20} color={C.text} />
      </Pressable>
      <View style={styles.profileCopy}>
        <EditorialText serif accessibilityRole="header" style={styles.userName}>Home</EditorialText>
        {currentUser && <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={editProfile} style={styles.editProfile}>
          <FontAwesomeIcon icon={faPen} size={16} color={C.gold} accessible={false} />
        </Pressable>}
      </View>
    </View>
    <CourseProgressNotice status={accountProgress.status} onRetry={retryAccountProgress} colors={C} embedded />
  </SafeAreaView>;
  return (
    <SafeAreaView key={accountProgress.status} onLayout={reportHomeLayout}
      edges={["top", "left", "right", "bottom"]} style={styles.screen}>
      {focused && !curtain.active && <StatusBar barStyle="light-content" backgroundColor={C.background} />}
      <View testID="home-fixed-header" style={styles.fixedHeader}>
        <View style={styles.profileRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open navigation menu"
            onPress={() => navigation.openDrawer()} style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}>
            <FontAwesomeIcon icon={faBars} size={20} color={C.text} />
          </Pressable>
          <View style={[styles.avatarWrap, { height: avatarSize, width: avatarSize }]}>{renderAvatar(avatarSize)}</View>
          <View style={styles.profileCopy}>
            <EditorialText serif accessibilityRole="header" style={[styles.userName, isCompact && styles.compactUserName]}>
              {displayName}
            </EditorialText>
            <Pressable accessibilityRole="button" accessibilityLabel="Edit profile"
              onPress={editProfile} style={({ pressed }) => [styles.editProfile, pressed && styles.pressed]}>
              <FontAwesomeIcon icon={faPen} size={16} color={C.gold} accessible={false} />
            </Pressable>
          </View>
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
          <Pressable accessibilityRole="button" accessibilityLabel="Log out" onPress={logout} style={styles.logoutButton}>
            <FontAwesomeIcon icon={faRightFromBracket} size={15} color={C.muted} />
            <EditorialText style={styles.logoutText}>Log out</EditorialText>
          </Pressable>
        </View>
      </ScrollView>


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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  loadingScreen: { flex: 1, backgroundColor: C.background },
  fixedHeader: { paddingHorizontal: S.horizontal, paddingTop: 12, paddingBottom: 8,
    backgroundColor: C.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  noticeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  scroll: { flex: 1, backgroundColor: C.background },
  content: { backgroundColor: C.background },
  section: { paddingTop: 24, width: '100%', maxWidth: S.maxWidth, alignSelf: 'center' },
  coursePanel: { backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border, borderRadius: 12, overflow: 'hidden' },
  courseArtwork: { position: 'absolute', top: 0, left: 0, width: '100%' },
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
  tabButton: { alignItems: "center", justifyContent: "center",
    minHeight: 48, paddingVertical: 10, paddingHorizontal: 6, flexBasis: 80, flexGrow: 1 },
  activeTabButton: { backgroundColor: C.red, borderRadius: 5 },
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
  profileCopy: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  userName: { color: C.text, fontSize: 25, lineHeight: 33, flexShrink: 1 },
  compactUserName: { fontSize: 22, lineHeight: 30 },
  menuButton: { minWidth: 48, minHeight: 48, flexShrink: 0,
    alignItems: 'center', justifyContent: 'center', marginLeft: -12 },
  editProfile: { minHeight: 48, minWidth: 48, flexShrink: 0, alignItems: 'center', justifyContent: 'center', padding: 8 },
  userEmail: { color: C.text, fontSize: 17, lineHeight: 26 },
  logoutButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 10,
    minHeight: 48, paddingVertical: 12, paddingRight: 18, marginTop: 14 },
  logoutText: { color: C.muted, fontSize: 15, lineHeight: 23 },

});

export default HomeScreen;
