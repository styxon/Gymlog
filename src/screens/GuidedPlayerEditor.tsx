import React, { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../components/AppText';
import { useKeyboardOpen } from '../hooks/useKeyboardOpen';
import { setFieldAccessibilityLabel } from '../lib/accessibilityLabels';
import { formatCardioDuration } from '../lib/cardio';
import { formatWeight, parseNumberInput, removeTrailingZeros } from '../lib/format';
import { t } from '../lib/i18n';
import type { LoggedSetRow } from '../lib/guidedPlayer';
import { MinutesStopwatch, stopwatchElapsedMs } from '../lib/minutesExercises';
import { unloadedSetRowLabel } from '../lib/repCountCopy';
import { isLiftableWeight } from '../lib/weightLimits';
import { isUnloadedTrackingMode } from '../features/workout/workoutTypes';
import { useTheme, useThemedStyles } from '../theming';
import { AppLanguage, UnitPreference } from '../types/models';
import { GPIcon, RING_CLOCK_FIT } from './GuidedPlayerMotion';
import { makeStyles } from './GuidedPlayerStyles';

/* ── strength set step v4 (owns the reps/kg steppers) ── */
/**
 * The two numbers of a logged set, and a way to change them.
 *
 * Deliberately not the set screen's dial cards: those are built for a set you
 * are about to do, with a progression badge and a target underneath. This is a
 * correction — two fields and a save — so it says nothing about what the app
 * would have picked.
 */
export function LoggedSetEditor({
  fieldsKey,
  language,
  unitPreference,
  unloaded,
  liftName,
  title,
  sets,
  selectedSetIndex,
  onSelectSet,
  setNumber,
  repsCeiling,
  reps,
  loadKg,
  bottomInset,
  onCancel,
  onSave,
}: {
  /** Which set the fields edit: a new one gets fresh drafts. */
  fieldsKey: string;
  language: AppLanguage;
  unitPreference: UnitPreference;
  unloaded: boolean;
  /**
   * Which lift, above the title. The sheet opens from any lift's pencil in the
   * contents sheet now, not only from the rest after it — "Korjaa sarja 3"
   * alone does not say whose (#bugs 2026-09-30).
   */
  liftName: string;
  /** Follows which set is selected — "Correct set N", or the just-logged
   * wording while that is still the one picked. Decided by the caller,
   * which is also the one that knows which set was "just logged". */
  title: string;
  /**
   * Every set already logged for this lift, oldest first — the rows the
   * reader can tap to correct a set other than the one the sheet opened on
   * (#bugs 2026-09-29, "näkyis kaikki tehdyt sarjat"). Not shown at all when
   * there is only the one: a list of one row taught nothing a title already
   * said.
   */
  sets: LoggedSetRow[];
  selectedSetIndex: number;
  onSelectSet: (setIndex: number) => void;
  /** The set being corrected, as the screen counts it (1-based). */
  setNumber: number;
  /** The most this set can count — the store's rule, see repsCeilingFor. */
  repsCeiling: number;
  reps: number;
  loadKg: number;
  /**
   * Safe-area inset, read on the screen — inside this Modal
   * `useSafeAreaInsets` itself always answers 0.
   */
  bottomInset: number;
  onCancel: () => void;
  onSave: (reps: number, loadKg: number | null) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  // Lifted onto the keyboard, the sheet no longer meets the home indicator.
  const keyboard = useKeyboardOpen();
  const onKeys = Platform.OS === 'ios' && keyboard.open;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      {/* iOS does not lift a Modal's content for the keyboard, and the number
          pad covered the fields and Save whole (iOS hunt 2026-10-17). Inside
          the Modal this view starts at the top of the screen, so it needs no
          offset. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.editVeil}
      >
        {/* A tap on the dimmed page with the keyboard up puts the keyboard
            away; it used to be the only way out of the number pad, and it
            threw the correction away. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => (Keyboard.isVisible() ? Keyboard.dismiss() : onCancel())}
          accessible={false}
        />
        <View style={[styles.editSheet, { paddingBottom: (onKeys ? 0 : bottomInset) + 20 }]}>
          <View style={{ gap: 2 }}>
            <Text style={styles.editLiftName} numberOfLines={1}>
              {liftName}
            </Text>
            <Text style={styles.editTitle}>{title}</Text>
          </View>
          {/* Every set already logged for this lift, so the reader is not
              limited to the one the sheet opened on. A single row would only
              repeat the title, so the list appears once there is a choice to
              make. */}
          {sets.length > 1 ? (
            <View style={{ gap: 6 }}>
              {sets.map((row) => {
                const selected = row.setIndex === selectedSetIndex;
                // Each row judges itself — `unloaded` above is the sheet's
                // currently SELECTED set, and after a mid-exercise swap
                // between a loaded and an unloaded lift that is not every
                // row's own answer. A 100 kg squat set shown as bare reps,
                // or a bodyweight set shown with a weight, is the bug this
                // guards (break round 2026-09-29).
                const rowUnloaded = isUnloadedTrackingMode(row.trackingMode);
                const detail = rowUnloaded
                  ? unloadedSetRowLabel(row.reps, language)
                  : t(language, 'guided.rest.setRow', {
                      weight: formatWeight(row.loadKg, unitPreference),
                      reps: row.reps,
                    });
                return (
                  <Pressable
                    key={row.setIndex}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onSelectSet(row.setIndex)}
                    style={[styles.editSetRow, selected && styles.editSetRowSelected]}
                  >
                    <Text
                      style={[styles.editSetRowText, selected && styles.editSetRowTextSelected]}
                      numberOfLines={1}
                    >
                      {t(language, 'guided.rest.setRowLabel', { index: row.setIndex + 1, detail })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {/* A fresh set of draft fields for the set the reader just picked:
              switching rows must not keep the previous set's typed text
              sitting over the newly selected one's numbers. Keyed here, inside
              the Modal, so the Modal itself stays. */}
          <LoggedSetEditorFields
            key={fieldsKey}
            language={language}
            unloaded={unloaded}
            setNumber={setNumber}
            repsCeiling={repsCeiling}
            reps={reps}
            loadKg={loadKg}
            onCancel={onCancel}
            onSave={onSave}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The correction's two fields and its buttons, with their drafts. */
function LoggedSetEditorFields({
  language,
  unloaded,
  setNumber,
  repsCeiling,
  reps,
  loadKg,
  onCancel,
  onSave,
}: {
  language: AppLanguage;
  unloaded: boolean;
  setNumber: number;
  repsCeiling: number;
  reps: number;
  loadKg: number;
  onCancel: () => void;
  onSave: (reps: number, loadKg: number | null) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [repsDraft, setRepsDraft] = useState(String(reps));
  const [loadDraft, setLoadDraft] = useState(removeTrailingZeros(loadKg));

  const typedReps = parseNumberInput(repsDraft);
  const typedLoad = unloaded ? null : parseNumberInput(loadDraft);
  const nextReps = Math.round(typedReps ?? reps);
  const nextLoad = unloaded ? null : typedLoad ?? loadKg;
  // The dials' own ceilings. Without them "825" for 82,5 saved, showed on the
  // summary, and was then dropped from the log on the next load — and opened
  // the next session at 825.
  // And a field that holds no number — emptied, or "82,,5" — is not the old
  // number: it saved the value from before the edit while the field showed
  // something else (decimal audit, 2026-09-21).
  const valid =
    typedReps !== null &&
    nextReps > 0 &&
    nextReps <= repsCeiling &&
    (unloaded || (typedLoad !== null && isLiftableWeight(nextLoad)));

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={styles.editField}>
          <Text style={styles.editLabel}>{t(language, 'guided.reps')}</Text>
          {/* Named with the set and the unit: the label above is a
              sibling Text, so the field alone was read as its number
              (accessibility audit, 2026-09-21). */}
          <TextInput
            value={repsDraft}
            onChangeText={setRepsDraft}
            accessibilityLabel={setFieldAccessibilityLabel(language, 'reps', setNumber)}
            keyboardType="number-pad"
            // The iPhone number pad has no return key: without these the
            // only way off it was the dimmed page, which cancelled.
            returnKeyType="done"
            inputAccessoryViewButtonLabel={t(language, 'common.done')}
            selectTextOnFocus
            style={styles.editInput}
          />
        </View>
        {unloaded ? null : (
          <View style={styles.editField}>
            <Text style={styles.editLabel}>{t(language, 'guided.weight')}</Text>
            <TextInput
              value={loadDraft}
              onChangeText={setLoadDraft}
              accessibilityLabel={setFieldAccessibilityLabel(language, 'kg', setNumber)}
              keyboardType="decimal-pad"
              returnKeyType="done"
              inputAccessoryViewButtonLabel={t(language, 'common.done')}
              selectTextOnFocus
              style={styles.editInput}
            />
          </View>
        )}
      </View>
      {/* Two buttons of one size. BigBtn is 60 tall and GhostBtn 48, which
          is right where one leads and the other follows — here they are a
          pair, and a pair that does not match reads as a mistake (user
          2026-09-04). */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={[styles.editBtn, styles.editBtnGhost]}
        >
          <Text style={styles.editBtnGhostText}>{t(language, 'common.cancel')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !valid }}
          onPress={() => {
            if (valid) {
              onSave(nextReps, nextLoad);
            }
          }}
          style={[styles.editBtn, { backgroundColor: valid ? theme.accent : theme.faint }]}
        >
          <GPIcon name="check" size={17} color={theme.onHighlight} sw={2.6} />
          <Text style={[styles.editBtnText, { color: theme.onHighlight }]}>
            {t(language, 'guided.rest.editSave')}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

/**
 * A minutes bout's running clock. It owns the one-second interval that moves
 * its digits, so the set step around it does not re-render for them: the step
 * only needs the whole minutes and "the minutes are in" (SetStepView sleeps
 * until lib/minutesExercises msUntilNextMinutesChange). The time is read off
 * the stopwatch's wall-clock start, so a tick that comes late shows the right
 * second, not a lost one.
 */
export function MinutesClockText({ watch, style }: { watch: MinutesStopwatch; style: React.ComponentProps<typeof Text>['style'] }) {
  const running = watch.runningSinceMs !== null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    if (!running) {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, watch]);
  return (
    <Text style={style} {...RING_CLOCK_FIT}>
      {formatCardioDuration(stopwatchElapsedMs(watch, nowMs) / 1000)}
    </Text>
  );
}
