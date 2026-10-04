import { useMemo } from 'react';
import { type FatigueResult } from '../lib/fatigueModel';
import { t } from '../lib/i18n';
import {
  buildRecoverySheet,
  dayStartPlus,
  isLightenPending,
  withoutRestDay,
  withRestDay,
  type RecoveryActionKind,
} from '../lib/recoverySheet';
import { localizeSessionName } from '../lib/sessionNameLabel';
import { nearestDayStart, trainsOn, type TrainingSchedule } from '../lib/trainingSchedule';
import type { PreferencesPatch } from '../state/AppProvider';
import { AppDatabase, AppPreferences } from '../types/models';
import { haptics } from '../utils/haptics';

/**
 * The recovery row's sheet, and what its two actions and their undo write.
 *
 * Moved out of App.tsx in the phase-B split (2026-09-30), verbatim and in the
 * order it stood there: the sheet's memo, then handleRecoveryAction and
 * handleRecoveryUndo. A hook because the sheet is a memo; the two handlers
 * are still plain functions made on every render, as they were in VinhaApp.
 * The schedules it asks (baseTrainingSchedule, and homeTrainingSchedule
 * beside it) stay in App.tsx, where every calendar reads them.
 */
export interface RecoverySheetDeps {
  proFatigue: FatigueResult;
  database: AppDatabase;
  /** Only the next session's title is read. */
  homeActivePlanCard: { nextSession?: { title: string } | null } | null;
  preferences: AppPreferences;
  coachProUnlocked: boolean;
  /** The rhythm before any rest day is taken off: would tomorrow have trained. */
  baseTrainingSchedule: TrainingSchedule;
  /** A dependency only: the sheet reads the clock, so it is keyed on the day. */
  todayStartMs: number;
  /** Functional patches too: the rest-day list is written from the stored one. */
  updatePreferences: (patch: PreferencesPatch) => Promise<unknown>;
  showToast: (message: string) => void;
}

export function useRecoverySheet(deps: RecoverySheetDeps) {
  const {
    proFatigue,
    database,
    homeActivePlanCard,
    preferences,
    coachProUnlocked,
    baseTrainingSchedule,
    todayStartMs,
    updatePreferences,
    showToast,
  } = deps;

  /**
   * What the recovery row opens (design: GAINER Palautuminen Sheet). Null
   * when the fatigue model is not confident — the row is not there either.
   * Keyed on the day: "tomorrow" and the seven-day strip read the clock.
   */
  const recoverySheet = useMemo(() => {
    const now = new Date();
    const tomorrow = new Date(dayStartPlus(now, 1));
    return buildRecoverySheet({
      fatigue: proFatigue,
      sessionDates: database.workoutSessions.map((session) => session.performedAt),
      now,
      nextSessionTitle: homeActivePlanCard?.nextSession
        ? localizeSessionName(homeActivePlanCard.nextSession.title, preferences.appLanguage)
        : null,
      automatedProgression: preferences.automatedProgressionEnabled,
      proUnlocked: coachProUnlocked,
      // Asked of the rhythm before any rest day, so a day already taken off
      // still reads as one the reader would have trained.
      tomorrowTrains: trainsOn(baseTrainingSchedule, tomorrow),
      restTomorrowMarked: preferences.restDayStarts.some((rest) => nearestDayStart(rest) === tomorrow.getTime()),
      lightenQueued: isLightenPending(preferences.lightNextSession, now),
      language: preferences.appLanguage,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    proFatigue,
    database.workoutSessions,
    homeActivePlanCard?.nextSession,
    preferences.appLanguage,
    preferences.automatedProgressionEnabled,
    preferences.restDayStarts,
    preferences.lightNextSession,
    coachProUnlocked,
    baseTrainingSchedule,
    todayStartMs,
  ]);

  /**
   * The recovery sheet's two actions, and taking them back. Each says it is
   * done only after the write has landed; a refused write says so instead.
   */
  async function handleRecoveryAction(kind: RecoveryActionKind) {
    if (kind === 'close') {
      return;
    }
    const now = new Date();
    try {
      if (kind === 'lighten') {
        await updatePreferences({ lightNextSession: { requestedAt: now.toISOString() } });
        void haptics.success();
        showToast(t(preferences.appLanguage, 'recovery.toast.lighten'));
        return;
      }
      // From the stored list, not this render's: two quick taps (rest, then
      // undo, then rest) each read the same snapshot, and the later write
      // dropped what the earlier one had just stored (#bugs 2026-10-01).
      await updatePreferences((current) => ({
        restDayStarts: withRestDay(current.restDayStarts, dayStartPlus(now, 1), now),
      }));
      void haptics.success();
      showToast(t(preferences.appLanguage, 'recovery.toast.rest'));
    } catch (error) {
      console.error('Failed to save the recovery action', error);
      void haptics.error();
      showToast(t(preferences.appLanguage, 'recovery.toast.failed'));
    }
  }

  async function handleRecoveryUndo(kind: 'lighten' | 'restTomorrow') {
    const now = new Date();
    try {
      await updatePreferences(
        kind === 'lighten'
          ? { lightNextSession: null }
          : (current) => ({ restDayStarts: withoutRestDay(current.restDayStarts, dayStartPlus(now, 1), now) }),
      );
    } catch (error) {
      console.error('Failed to undo the recovery action', error);
      void haptics.error();
      showToast(t(preferences.appLanguage, 'recovery.toast.failed'));
    }
  }

  return { recoverySheet, handleRecoveryAction, handleRecoveryUndo };
}
