import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { IFC_CAPABILITY_MATRIX } from '@/ifc';

export default function CoverageScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();
  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentInset={insets}
      contentContainerStyle={styles.contentContainer}>
      <ThemedView style={styles.container}>
        <ThemedView style={styles.titleContainer}>
          <ThemedText type="subtitle">IFC Checklist Coverage</ThemedText>
          <ThemedText themeColor="textSecondary">
            Implementation status for the native IFC reader, viewer and builder scope.
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.sectionsWrapper}>
          {IFC_CAPABILITY_MATRIX.map((item) => (
            <ThemedView key={item.title} type="backgroundElement" style={styles.coverageItem}>
              <View style={styles.coverageHeader}>
                <ThemedText type="smallBold">{item.title}</ThemedText>
                <ThemedText type="code">{item.status}</ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {item.detail}
              </ThemedText>
            </ThemedView>
          ))}
        </ThemedView>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: Spacing.six,
    paddingBottom: Spacing.four,
  },
  container: {
    maxWidth: MaxContentWidth,
    flexGrow: 1,
  },
  titleContainer: {
    gap: Spacing.three,
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
  },
  sectionsWrapper: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  coverageItem: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  coverageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
});
