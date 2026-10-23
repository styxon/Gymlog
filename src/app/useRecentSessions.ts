import { useMemo } from 'react';

import { getCanonicalCompletedSessions } from '../lib/completedSessions';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { formatDurationMinutes, formatShortDate, formatVolume } from '../lib/format';
import { t } from '../lib/i18n';
import { setCountLabel } from '../lib/repCountCopy';
import { localizeSessionName } from '../lib/sessionNameLabel';
import type { AppDatabase, AppPreferences, UnitPreference } from '../types/models';

/**
 * The sessions Progress counts, and the three most recent ones as Progress's
 * History card lists them.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook, not a helper: both are memos, and VinhaApp calls this exactly where
 * the lines stood — after the Home memos nothing reads any more, before
 * useProgramsCatalog — so every hook keeps its slot.
 */
export interface RecentSessionsDeps {
  /** The whole database: the canonical list is built from its sessions and logs. */
  database: AppDatabase;
  /** The app context's saved sessions, every one of them. */
  workoutSessions: AppDatabase['workoutSessions'];
  /** The app context's log reader for one session. */
  getSessionLogs: (sessionId: string) => AppDatabase['exerciseLogs'];
  /** The reader's preferences: the language. */
  preferences: AppPreferences;
  /** The reader's kg/lb setting, for the volume. */
  unitPreference: UnitPreference;
}

export function useRecentSessions(deps: RecentSessionsDeps) {
  const { database, workoutSessions, getSessionLogs, preferences, unitPreference } = deps;

  /**
   * The sessions Progress counts: the canonical list — an exercise done in
   * it, one row per workout — that the calendar on the same card, the widget
   * and Profile already count. Handed every saved session, the activity card
   * counted a free workout with weights typed and nothing ticked, and read
   * "3 viikkoa putkeen · 3 treeniä" over a calendar that marked two (audit,
   * 2026-09-20). The History card at the foot of the tab keeps every saved
   * session, as History itself does.
   */
  const completedWorkoutSessions = useMemo(
    () =>
      getCanonicalCompletedSessions({
        workoutSessions: database.workoutSessions,
        exerciseLogs: database.exerciseLogs,
      }),
    [database.exerciseLogs, database.workoutSessions],
  );
  const homeRecentSessions = useMemo(
    () =>
      [...workoutSessions]
        .sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime())
        .slice(0, 3)
        .map((session) => {
          const sessionLogs = [...getSessionLogs(session.id)].sort((left, right) => left.orderIndex - right.orderIndex);
          const exercisePreview = sessionLogs
            .filter((log) => !log.skipped)
            .map((log) => log.exerciseNameSnapshot)
            .slice(0, 3)
            .join(', ');
          const notePreview =
            sessionLogs.find((log) => typeof log.notes === 'string' && log.notes.trim().length > 0)?.notes?.trim() ?? null;
          const completedSets = typeof session.setsCompleted === 'number' ? session.setsCompleted : null;
          const completedExercises =
            typeof session.exercisesCompleted === 'number'
              ? session.exercisesCompleted
              : sessionLogs.filter((log) => !log.skipped).length;

          return {
            id: session.id,
            title: localizeSessionName(
              formatWorkoutDisplayLabel(session.workoutNameSnapshot, t(preferences.appLanguage, 'ai.signal.workout')),
              preferences.appLanguage,
            ),
            dateLabel: formatShortDate(session.performedAt, preferences.appLanguage),
            durationLabel:
              typeof session.durationMinutes === 'number' && session.durationMinutes > 0
                ? formatDurationMinutes(session.durationMinutes)
                : '0 min',
            volumeLabel: formatVolume(session.totalVolumeKg ?? 0, unitPreference),
            detailLabel:
              completedSets !== null
                ? setCountLabel(completedSets, preferences.appLanguage)
                : t(preferences.appLanguage, 'recent.exerciseCount', { count: completedExercises }),
            exercisePreview: exercisePreview || t(preferences.appLanguage, 'recent.completed'),
            notePreview,
          };
        }),
    [getSessionLogs, preferences.appLanguage, unitPreference, workoutSessions],
  );

  return {
    completedWorkoutSessions,
    homeRecentSessions,
  };
}
