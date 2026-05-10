import { Platform, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function IfcWorkspace() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">IFCnative</ThemedText>
      <ThemedText themeColor="textSecondary">
        The first implementation targets Expo Web because web-ifc runs through WebAssembly in the
        browser. Current platform: {Platform.OS}.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
