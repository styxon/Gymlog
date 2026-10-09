import React from 'react';

import { AppRoute, ROOT_ROUTES } from '../navigation/routes';
import { ProgressScreen } from '../screens/ProgressScreen';
import { AppPreferences, MeasurementKind, MeasurementUnit } from '../types/models';
import { t } from '../lib/i18n';
import { haptics } from '../utils/haptics';

type ProgressScreenProps = React.ComponentProps<typeof ProgressScreen>;

/**
 * The progress tab — one screen, three routes (list, detail, bodyweight),
 * moved verbatim from App.tsx's render chain in the phase-A split
 * (2026-08-26). A plain function, not a component: React sees the same
 * ProgressScreen element the chain produced, so the screen instance
 * survives route changes within the tab exactly as before.
 */
export interface ProgressTabDeps {
  route: AppRoute;
  navigate: (route: AppRoute) => void;
  resetToRoute: (route: AppRoute) => void;
  preferences: AppPreferences;
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<unknown>;
  personalRecords: NonNullable<ProgressScreenProps['records']>;
  /** The ten lifts a target can be set on — the same list the flow offers. */
  targetLifts: NonNullable<ProgressScreenProps['targetLifts']>;
  distinctRecordCount: number;
  recordSources: NonNullable<ProgressScreenProps['setLogSources']>;
  /** Each target lift under every name it was logged as — see getLiftProgress. */
  targetLiftProgress: ProgressScreenProps['summaries'];
  /** The set logs those rows open, built from the same merged summaries. */
  targetLiftSources: NonNullable<ProgressScreenProps['liftSetLogSources']>;
  bodyweightProgress: ProgressScreenProps['bodyweightProgress'];
  measurementEntries: ProgressScreenProps['measurementEntries'];
  /**
   * getCanonicalCompletedSessions, not every saved session: the streak and
   * the month figures sit on the same card as the calendar, and the calendar
   * counts only sessions in which an exercise was done.
   */
  completedWorkoutSessions: ProgressScreenProps['workoutSessions'];
  cardioSessions: ProgressScreenProps['cardioSessions'];
  activityCalendar: ProgressScreenProps['activityCalendar'];
  homeTrainingSchedule: ProgressScreenProps['trainingSchedule'];
  progressTrainingRhythm: ProgressScreenProps['rhythm'];
  progressWeeklyTarget: ProgressScreenProps['weeklyTargetSessions'];
  unitPreference: ProgressScreenProps['unitPreference'];
  proWeeklyRead: ProgressScreenProps['weeklyRead'];
  recoverySheet: ProgressScreenProps['recoverySheet'];
  onRecoveryAction: NonNullable<ProgressScreenProps['onRecoveryAction']>;
  onRecoveryUndo: NonNullable<ProgressScreenProps['onRecoveryUndo']>;
  proPlateauMoment: ProgressScreenProps['readMoment'];
  coachProUnlocked: boolean;
  addBodyweightEntry: (weightKg: number) => Promise<unknown>;
  addMeasurementEntry: (kind: MeasurementKind, value: number, unit: MeasurementUnit) => Promise<unknown>;
  deleteBodyweightEntry: (entryId: string) => Promise<unknown>;
  deleteMeasurementEntry: (entryId: string) => Promise<unknown>;
  showToast: (message: string) => void;
  homeRecentSessions: ProgressScreenProps['recentSessions'];
}

export function renderProgressTab(deps: ProgressTabDeps): React.ReactElement | null {
  const {
    route,
    navigate,
    resetToRoute,
    preferences,
    updatePreferences,
    personalRecords,
    targetLifts,
    distinctRecordCount,
    recordSources,
    targetLiftProgress,
    targetLiftSources,
    bodyweightProgress,
    measurementEntries,
    completedWorkoutSessions,
    cardioSessions,
    activityCalendar,
    homeTrainingSchedule,
    progressTrainingRhythm,
    progressWeeklyTarget,
    unitPreference,
    proWeeklyRead,
    recoverySheet,
    onRecoveryAction,
    onRecoveryUndo,
    proPlateauMoment,
    coachProUnlocked,
    addBodyweightEntry,
    addMeasurementEntry,
    deleteBodyweightEntry,
    deleteMeasurementEntry,
    showToast,
    homeRecentSessions,
  } = deps;

  if (route.tab !== 'progress') {
    return null;
  }

  return (
    <ProgressScreen
      topRecords={personalRecords.weight.slice(0, 3)}
      recordCount={distinctRecordCount}
      records={personalRecords}
      setLogSources={recordSources}
      liftSetLogSources={targetLiftSources}
      onStartWorkout={() => resetToRoute(ROOT_ROUTES.home)}
      summaries={targetLiftProgress}
      bodyweightProgress={bodyweightProgress}
      measurementEntries={measurementEntries}
      workoutSessions={completedWorkoutSessions}
      cardioSessions={cardioSessions}
      activityCalendar={activityCalendar}
      // The same resolved rhythm Home and the widget mark their calendars
      // from — cycle or weekdays — so a 2-on-1-off reader sees the same
      // training days on every calendar in the app.
      trainingSchedule={homeTrainingSchedule}
      rhythm={progressTrainingRhythm}
      weeklyTargetSessions={progressWeeklyTarget}
      unitPreference={unitPreference}
      weeklyRead={proWeeklyRead}
      recoverySheet={recoverySheet}
      onRecoveryAction={onRecoveryAction}
      onRecoveryUndo={onRecoveryUndo}
      readMoment={proPlateauMoment}
      proUnlocked={coachProUnlocked}
      targetLifts={targetLifts}
      onSetTarget={() => navigate({ tab: 'workout', screen: 'goalFlow' })}
      onOpenPremium={() => navigate({ tab: 'profile', screen: 'premium' })}
      language={preferences.appLanguage}
      selectedExerciseKey={route.screen === 'detail' ? route.exerciseKey : undefined}
      initialSection={route.screen === 'list' ? route.section : undefined}
      initialMeasure={route.screen === 'list' ? route.measure : undefined}
      scrollToTarget={route.screen === 'list' ? route.scrollTo : undefined}
      routeOpenedAt={route.screen === 'list' ? route.openedAt : undefined}
      showBodyweightDetail={route.screen === 'bodyweight'}
      /*
       * Removing a reading is silent the same way adding one is: the row
       * leaves the list and the curve redraws without it.
       *
       * Silent about SUCCESS, that is. A refused write rolls memory back
       * (`commit` puts the previous snapshot in and rethrows), so the row
       * reappears — and with the promise dropped on the floor and a success
       * buzz already fired before the write had resolved, that was the whole
       * of what the reader got: a delete they confirmed, felt, watched happen
       * and then watched undo itself (audit 3, 2026-09-19). The history list
       * one screen over has said so since 2026-09-16; this tab had no
       * `showToast` at all.
       */
      onDeleteBodyweight={(entryId) => {
        deleteBodyweightEntry(entryId)
          .then(() => haptics.success())
          .catch((error) => {
            console.error('Failed to delete bodyweight entry', error);
            void haptics.error();
            showToast(t(preferences.appLanguage, 'toast.entryDeleteFailed'));
          });
      }}
      onDeleteMeasurement={(entryId) => {
        deleteMeasurementEntry(entryId)
          .then(() => haptics.success())
          .catch((error) => {
            console.error('Failed to delete measurement entry', error);
            void haptics.error();
            showToast(t(preferences.appLanguage, 'toast.entryDeleteFailed'));
          });
      }}
      onAddBodyweight={async (weightKg) => {
        try {
          await addBodyweightEntry(weightKg);
        } catch (error) {
          // The sheet has already closed over a value that was not stored.
          console.error('Failed to save bodyweight entry', error);
          void haptics.error();
          showToast(t(preferences.appLanguage, 'toast.entrySaveFailed'));
          return;
        }
        // No "saved" toast (user 2026-08-25: "outo pilleri... ihan turha").
        // The save announces itself: the dot lands on the chart, and the
        // haptic says it landed.
        void haptics.success();
      }}
      // The same height the questionnaire asks for and the profile stores —
      // the BMI card edits that field rather than keeping a second copy.
      heightCm={preferences.setupHeightCm}
      onSaveHeight={(nextHeightCm) => void updatePreferences({ setupHeightCm: nextHeightCm })}
      onAddMeasurement={async (kind, value, unit) => {
        try {
          await addMeasurementEntry(kind, value, unit);
        } catch (error) {
          console.error('Failed to save measurement entry', error);
          void haptics.error();
          showToast(t(preferences.appLanguage, 'toast.entrySaveFailed'));
          return;
        }
        // No "saved" toast, same rule as bodyweight (user 2026-08-25:
        // "teksti mittaus tallennettu poistetaan ja kaikki tämmöiset").
        // The value lands on the card in front of the reader; the haptic
        // says it landed.
        void haptics.success();
      }}
      recentSessions={homeRecentSessions}
      onOpenSessionHistory={() => navigate({ tab: 'home', screen: 'history' })}
      onOpenRecentSession={(sessionId) => navigate({ tab: 'home', screen: 'session', sessionId })}
    />
  );
}
