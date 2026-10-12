import { useMemo } from 'react';

import { resolveDueCoachDemoMoment } from '../lib/coachDemoMoments';
import { getCanonicalCompletedSessions } from '../lib/completedSessions';
import type { buildFatigueModel } from '../lib/fatigueModel';
import { t } from '../lib/i18n';
import type { LiftHistory } from '../lib/trainingHistory';
import type { AppDatabase, AppPreferences } from '../types/models';

/**
 * The coach demo moment that came due, and the question it puts to the coach
 * in the reader's language.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook because the moment is a memo; the question is read straight off it.
 * VinhaApp calls this exactly where the lines stood — after the Pro
 * entitlement is read, just ahead of useCoachAdviceMemory — so every hook
 * keeps its slot and the chat's demo props in App.tsx still read the values
 * from above.
 */
export interface CoachDemoMomentDeps {
  /** The reader's preferences: install date, the moments used, the language. */
  preferences: AppPreferences;
  /** Whether Pro is unlocked; Pro readers get no demo moment. */
  coachProUnlocked: boolean;
  /** The whole database: the session count is read (sessions and their logs). */
  database: AppDatabase;
  /** useProInsights' lift histories, for the moment's answer. */
  proLiftHistories: LiftHistory[];
  /** useProInsights' fatigue model; its signal is used only when confident. */
  proFatigue: ReturnType<typeof buildFatigueModel>;
}

export function useCoachDemoMoment(deps: CoachDemoMomentDeps) {
  const { preferences, coachProUnlocked, database, proLiftHistories, proFatigue } = deps;

  /**
   * The coach demo moment that came due with this session, if one has.
   *
   * Free readers get three real coach answers per install, at day 7, 30 and
   * 90 — offered after a completed session so the log behind the answer is
   * fresh. Null for Pro, and null until the day and the session count both
   * come good. See lib/coachDemoMoments. The sessions are counted as
   * Profile counts them: a workout saved twice, or a row with no set done,
   * does not bring the demo forward (duplicate sweep 13, 2026-10-12).
   */
  const coachDemoMoment = useMemo(
    () =>
      resolveDueCoachDemoMoment({
        firstLaunchAt: preferences.firstLaunchAt,
        usedMoments: preferences.coachDemoMomentsUsed,
        proUnlocked: coachProUnlocked,
        sessionCount: getCanonicalCompletedSessions(database).length,
        lifts: proLiftHistories,
        fatigueSignal: proFatigue?.confident ? proFatigue.signal : null,
        cautionFlags: preferences.setupCautionFlags,
        language: preferences.appLanguage,
      }),
    // Keyed on the two lists the count reads, not the whole database.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      coachProUnlocked,
      database.workoutSessions,
      database.exerciseLogs,
      preferences.appLanguage,
      preferences.coachDemoMomentsUsed,
      preferences.firstLaunchAt,
      preferences.setupCautionFlags,
      proFatigue,
      proLiftHistories,
    ],
  );
  const coachDemoQuestion = coachDemoMoment
    ? t(preferences.appLanguage, coachDemoMoment.questionKey, coachDemoMoment.vars)
    : null;

  return { coachDemoMoment, coachDemoQuestion };
}
