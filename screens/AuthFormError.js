import { StyleSheet, View } from 'react-native';
import { EditorialText as Text } from '../shared/EditorialUI';
import { AUTH_COLORS } from './AuthStage';

export default function AuthFormError({ message }) {
  if (!message) return null;
  return <View style={styles.container}>
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" allowFontScaling style={styles.message}>
      {message}
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#2c202d',
    borderColor: '#685263',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  message: { color: AUTH_COLORS.text, fontSize: 14, lineHeight: 22 },
});
