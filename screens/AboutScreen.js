import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { CourseHeading, CoursePage, CourseText, COURSE_COLORS } from '../course/CourseUI';
import { SynopsisProse } from '../synopsis/SynopsisUI';
import fontManifest from '../assets/reader-fonts/manifest.json';

const fontNames = { literata: 'Literata', 'source-serif-4': 'Source Serif 4', 'source-sans-3': 'Source Sans 3' };
const fontNotices = fontManifest.assets.filter(asset => asset.kind === 'license');
const artworkRecords = [
  ['As You Like It cover — Rijksmuseum', 'https://www.rijksmuseum.nl/en/collection/RP-P-2004-1176'],
  ['A Midsummer Night’s Dream cover — Wikimedia Commons', 'https://commons.wikimedia.org/wiki/File:Simmons-Hermia_and_Lysander._A_Midsummer_Night%27s_Dream.jpg'],
  ['Richard III cover — Rawpixel source record', 'https://www.rawpixel.com/image/8846003'],
  ['Romeo and Juliet cover — Yale Center for British Art', 'https://collections.britishart.yale.edu/catalog/tms:237'],
  ['The Tempest cover — Yale Center for British Art', 'https://collections.britishart.yale.edu/catalog/tms:11065'],
  ['Twelfth Night cover — Yale Center for British Art', 'https://collections.britishart.yale.edu/catalog/tms:813'],
];

function CreditLink({ label, url, onOpen, error }) {
  return <View><Pressable accessibilityRole="link" accessibilityLabel={label}
    accessibilityHint="Opens in your browser." onPress={() => onOpen(url)}
    style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
    <CourseText style={styles.linkLabel}>{label}</CourseText>
  </Pressable>
    {error && <CourseText accessibilityRole="alert" accessibilityLiveRegion="polite" tone="danger">Could not open this link. Please try again.</CourseText>}
  </View>;
}

function CreditGroup({ title, children }) {
  return <View style={styles.creditGroup}>
    <CourseText accessibilityRole="header" style={styles.creditTitle}>{title}</CourseText>
    {children}
  </View>;
}

export default function AboutScreen() {
  const [expanded, setExpanded] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const linkRequest = useRef(0);
  useEffect(() => () => { linkRequest.current++; }, []);
  const version = Constants.expoConfig?.version;
  const openLink = async url => {
    const request = ++linkRequest.current;
    setLinkError(null);
    try {
      await Linking.openURL(url);
    } catch {
      if (request === linkRequest.current) setLinkError(url);
    }
  };
  const link = (label, url) => <CreditLink key={url} label={label} url={url} onOpen={openLink} error={linkError === url} />;

  return <CoursePage>
    <View style={styles.introduction}>
      <View style={styles.rule} />
      <CourseHeading title="Shakespeare, understood." />
      <SynopsisProse>
        Explore 38 plays through complete texts, original synopses, and source-backed quizzes. Save the passages that speak to you, follow each story at your own pace, and earn each play’s medal with a perfect quiz result.
      </SynopsisProse>
      <CourseText tone="muted" style={styles.creator}>Created by Ibrahim Karim.</CourseText>
    </View>

    <View style={styles.credits}>
      <Pressable accessibilityRole="button" accessibilityLabel="Sources & credits"
        accessibilityState={{ expanded }} accessibilityHint={expanded ? 'Hide sources and credits.' : 'Show sources and credits.'}
        onPress={() => { linkRequest.current++; setExpanded(value => !value); setLinkError(null); }}
        style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}>
        <CourseText style={styles.disclosureLabel}>Sources & credits</CourseText>
        <CourseText accessible={false} style={styles.indicator}>{expanded ? '−' : '+'}</CourseText>
      </Pressable>

      {expanded && <View style={styles.creditContent}>
        <CreditGroup title="Play texts">
          <CourseText>William Shakespeare’s The Complete Works of William Shakespeare, Project Gutenberg eBook 100. Bard uses a bundled copy with the visible update date August 24, 2025.</CourseText>
          <CourseText tone="muted">The source identifies the text as public domain in the USA. Use elsewhere is subject to local law.</CourseText>
          {link('Project Gutenberg source edition', 'https://www.gutenberg.org/ebooks/100')}
          {link('Project Gutenberg full license', 'https://www.gutenberg.org/policy/license.html')}
        </CreditGroup>

        <CreditGroup title="Synopses & quizzes">
          <CourseText>Bard’s original synopses and quiz material are bundled with the app. Supporting quotations and references point to the bundled play text.</CourseText>
        </CreditGroup>

        <CreditGroup title="Artwork">
          <CourseText>Artwork acknowledgments include Folger Shakespeare Library and Rawpixel. Cover-image metadata also identifies Rijksmuseum, Wikimedia Commons, Smithsonian, and Yale Center for British Art.</CourseText>
          <CourseText tone="muted">The links below identify known collection sources. Item-level provenance is incomplete for some bundled artwork; rights vary by item.</CourseText>
          {link('Folger Shakespeare Library digital collections', 'https://digitalcollections.folger.edu/')}
          {link('Folger image permissions', 'https://www.folger.edu/research/images-and-permissions/')}
          {artworkRecords.map(([label, url]) => link(label, url))}
        </CreditGroup>

        <CreditGroup title="Bundled fonts">
          <CourseText>Literata — The Literata Project Authors. Source Serif 4 and Source Sans 3 — Adobe. All three use the SIL Open Font License 1.1.</CourseText>
          <CourseText tone="muted">Original copyright and license notices are included with the fonts. Full notices for the bundled releases:</CourseText>
          {fontNotices.map(notice => link(`${fontNames[notice.family]} copyright & license`, notice.url))}
        </CreditGroup>

        <CreditGroup title="Interface icons">
          <CourseText>Font Awesome Free by Fonticons, Inc. The SVG icons use CC BY 4.0.</CourseText>
          {link('Font Awesome Free full notices', 'https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.7.2/LICENSE.txt')}
          {link('Creative Commons Attribution 4.0 license', 'https://creativecommons.org/licenses/by/4.0/')}
        </CreditGroup>
      </View>}
    </View>

    {typeof version === 'string' && !!version.trim() && <CourseText tone="muted" style={styles.version}>{`Version ${version}`}</CourseText>}
  </CoursePage>;
}

const styles = StyleSheet.create({
  introduction: { gap: 20, paddingTop: 8 },
  rule: { width: 44, height: 2, backgroundColor: COURSE_COLORS.gold, marginBottom: 4 },
  creator: { fontSize: 16, lineHeight: 25, marginTop: 4 },
  credits: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COURSE_COLORS.border },
  disclosure: { minHeight: 56, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
  disclosureLabel: { flex: 1, fontSize: 18, lineHeight: 27, fontWeight: '600' },
  indicator: { color: COURSE_COLORS.gold, fontSize: 24, lineHeight: 30 },
  creditContent: { gap: 28, paddingTop: 12 },
  creditGroup: { gap: 10 },
  creditTitle: { fontSize: 19, lineHeight: 28, fontWeight: '600' },
  link: { minHeight: 48, justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 2 },
  linkLabel: { color: COURSE_COLORS.gold, textDecorationLine: 'underline', fontSize: 16, lineHeight: 25 },
  pressed: { opacity: 0.75 },
  version: { fontSize: 14, lineHeight: 22 },
});
