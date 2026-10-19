import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BackButton } from '../components/BackButton';

import { ExerciseLibraryBrowser } from '../components/ExerciseLibraryBrowser';
import type { LibraryCollectionState } from '../lib/exerciseCollections';
import { t } from '../lib/i18n';
import { Theme, useThemedStyles } from '../theming';
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
  return (
    <View style={styles.content}>
      {/* This screen declared an onBack prop and then never took it, so the
          library was a dead end: the only way out was noticing that tapping
          the Programs tab resets it. */}
      {onBack ? (
        <View style={styles.backRow}>
          <BackButton onPress={onBack} accessibilityLabel={t(language, 'common.back')} />
        </View>
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
  backRow: {
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
});
