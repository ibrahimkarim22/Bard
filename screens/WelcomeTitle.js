import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';

export default function WelcomeTitle({ style }) {
  return <Text allowFontScaling accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
    style={[style, styles.title]}>BARD</Text>;
}

const styles = StyleSheet.create({
  title: { width: '100%', textAlign: 'center', fontWeight: '100', fontFamily: Platform.OS === 'android' ? 'sans-serif-thin' : Platform.OS === 'ios' ? 'System' : 'system-ui' },
});
