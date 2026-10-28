import React, { useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '../components/AppText';
import { getExerciseInstructions } from '../lib/exerciseInstructions';
import { libraryLabel } from '../lib/libraryLabel';
import { t } from '../lib/i18n';
import { useTheme, useThemedStyles } from '../theming';
import { makeStyles } from './GuidedPlayerStyles';
import { StepIn } from './GuidedPlayerMotion';
import { GPSheet } from './GuidedPlayerSheet';
import { BigBtn } from './GuidedPlayerParts';
import { AppLanguage, ExerciseLibraryItem } from '../types/models';


export function FinishView({
  onFinish,
  saveFailed,
  language,
}: {
  onFinish: () => void;
  saveFailed: boolean;
  language: AppLanguage;
}) {
  const styles = useThemedStyles(makeStyles);
  const firedRef = useRef(false);

  // Fires once on arrival: the summary is the destination now, so there is
  // nothing here to read and nothing to press.
  useEffect(() => {
    if (firedRef.current) {
      return;
    }
    firedRef.current = true;
    onFinish();
  }, [onFinish]);

  // Nothing to read here, on purpose. "{title} — valmis" and a spinner
  // flashed between the last set and the summary, and a screen that exists for
  // the length of a save should not say anything (user 2026-09-09).
  //
  // Unless the save was refused: then this screen is where the reader is left,
  // and it has to say so and offer the save again.
  if (saveFailed) {
    return (
      <StepIn stepKey="finish-failed">
        <View style={styles.finishFailed}>
          <Text style={styles.finishFailedTitle}>{t(language, 'guided.finish.saveFailed.title')}</Text>
          <Text style={styles.finishFailedBody}>{t(language, 'guided.finish.saveFailed.body')}</Text>
          <BigBtn label={t(language, 'guided.finish.saveFailed.retry')} onPress={onFinish} />
        </View>
      </StepIn>
    );
  }
  return (
    <StepIn stepKey="finish">
      <View style={{ flex: 1 }} />
    </StepIn>
  );
}

export function HowToSheetView({
  libraryItem,
  fallbackName,
  language,
  bottomInset,
  onClose,
}: {
  libraryItem: ExerciseLibraryItem | null;
  /** The step's own label, already in the reader's language. */
  fallbackName: string;
  language: AppLanguage;
  /** Safe-area inset, read on the screen and passed through to GPSheet. */
  bottomInset: number;
  onClose: () => void;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  // The sheet is titled with the same name the step showed, not the library
  // row's English — the two read differently ("Takakyykky" over "Barbell Full
  // Squat") and the user tapped the former.
  return (
    <GPSheet title={fallbackName} language={language} onClose={onClose} bottomInset={bottomInset}>
      {libraryItem?.primaryMuscles?.[0] ? (
        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.purple, marginTop: -12 }}>
          {libraryLabel(libraryItem.primaryMuscles[0], language)}
        </Text>
      ) : null}
      <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 13, marginTop: 18, paddingBottom: 8 }}>
          {getExerciseInstructions(libraryItem?.name, libraryItem?.instructions, language).map((instruction, index) => (
            <View key={index} style={{ flexDirection: 'row', gap: 13, alignItems: 'flex-start' }}>
              <View style={styles.howToNumber}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: theme.purpleDark }}>{index + 1}</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: theme.ink, lineHeight: 22 }}>{instruction}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </GPSheet>
  );
}
