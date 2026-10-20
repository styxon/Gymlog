import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ExerciseLibraryBrowser } from '../components/ExerciseLibraryBrowser';
import type { LibraryCollectionState } from '../lib/exerciseCollections';
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
      <ExerciseLibraryBrowser
        onBack={onBack}
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
});
