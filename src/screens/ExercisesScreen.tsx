import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BackButton } from '../components/BackButton';

import { ExerciseLibraryBrowser } from '../components/ExerciseLibraryBrowser';
import type { LibraryCollectionState } from '../lib/exerciseCollections';
import { t } from '../lib/i18n';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage, ExerciseLibraryItem } from '../types/models';

interface ExercisesScreenProps {
  items: ExerciseLibraryItem[];
  language?: AppLanguage;
  onBack?: () => void;
  onOpenExercise?: (item: ExerciseLibraryItem) => void;
  learnCollection?:
    | { id: string; title: string; done: number; total: number; percent: number; state: LibraryCollectionState }
    | null;
  onOpenCollection?: (collectionId: string) => void;
  onOpenLearnIndex?: () => void;
}

export function ExercisesScreen({
  items,
  language = 'en',
  onBack,
  onOpenExercise,
  learnCollection = null,
  onOpenCollection,
  onOpenLearnIndex,
}: ExercisesScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  return (
    <View style={styles.content}>
      {/* This screen declared an onBack prop and then never took it, so the
          library was a dead end: the only way out was noticing that tapping
          the Programs tab resets it. */}
      {onBack ? (
        <BackButton onPress={onBack} accessibilityLabel={t(language, 'common.back')} />
      ) : null}
      <ExerciseLibraryBrowser
        items={items}
        language={language}
        onOpenItem={onOpenExercise}
        learnCollection={learnCollection}
        onOpenCollection={onOpenCollection}
        onOpenLearnIndex={onOpenLearnIndex}
      />
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  content: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 4,
  },
  backText: {
    color: theme.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
});
