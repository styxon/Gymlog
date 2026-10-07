import { useMemo } from 'react';

import { leadPlanTrainingCycle } from '../lib/planTrainingCycle';
import { programmeHistoryIds } from '../lib/programLineage';
import { livePlanEntries } from '../lib/planResolvableEntries';
import { planWeekdayIndexes, resolveDerivedTrainingDays } from '../lib/programTrainingDays';
import { cycleSchedule, weekdaySchedule, withRestDays } from '../lib/trainingSchedule';
import type { AppDatabase, AppPreferences } from '../types/models';
import type { useHomeActivePlan } from './useHomeActivePlan';
import { templateSessionsReader } from './planTemplateSessions';
import { getEndOfWeek, getStartOfWeek } from './workoutCompletionState';

/**
 * The reader's training rhythm, which every calendar in the app draws: the
 * weekdays the lead programme trains on, the rhythm as chosen (a saved cycle,
 * or those weekdays), the same with the recovery sheet's rest days taken off,
 * and which of the programme's days are already done this week.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook, not a helper: these are memos that build on one another, and
 * VinhaApp calls this exactly where the lines stood — after useHomeStatCards,
 * before useRecoverySheet — so every hook keeps its slot. The done-this-week
 * memo's deps are keyed on what its helpers read, with the eslint note that
 * says so, as they stood. The hero card they read the lead programme from is
 * useHomeActivePlan's.
 */
export interface HomeTrainingScheduleDeps {
  /** The whole database: the plan records, and what the done-this-week memo is keyed on. */
  database: AppDatabase;
  /** The reader's preferences: the lead plan, the available days and the rest days. */
  preferences: AppPreferences;
  /** Home's hero card, as useHomeActivePlan builds it. */
  homeActivePlanCard: ReturnType<typeof useHomeActivePlan>['homeActivePlanCard'];
  /** The app context's custom programmes, for the programme's lineage. */
  workoutTemplates: AppDatabase['workoutTemplates'];
  /** Local midnight of today: the week is read from the day key. */
  todayStartMs: number;
  /** VinhaApp's lineage-aware reader of one programme's completed sessions. */
  completedSessionsForTemplate: (
    workoutTemplateId: string | null | undefined,
  ) => readonly { workoutTemplateId?: string | null; workoutTemplateSessionId?: string | null; performedAt: string }[];
  /** The programmes some other plan is running. */
  templatesRunByOtherPlans: (workoutTemplateId: string | null | undefined) => string[];
}

export function useHomeTrainingSchedule(deps: HomeTrainingScheduleDeps) {
  const {
    database,
    preferences,
    homeActivePlanCard,
    workoutTemplates,
    todayStartMs,
    completedSessionsForTemplate,
    templatesRunByOtherPlans,
  } = deps;

  // Week-strip training dots from the days the user actually picked
  // (Monday-first indexes). Empty = unknown → no dots, no invented rhythm.
  const homeTrainingDayIndexes = useMemo(() => {
    const order: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
    const open = preferences.setupAvailableDays
      .map((day) => order[day])
      .filter((index) => index !== undefined);
    // Availability is not a plan. This marked every day the reader said they
    // COULD train, so a one-session-a-week programme lit three dots and the
    // strip claimed three workouts where the plan prescribes one.
    // A plan that names its own weekdays is the answer; deriving over the top
    // of it would silently undo a rhythm the reader set by hand.
    const activePlan = database.workoutPlans.find((plan) => plan.id === preferences.activePlanId) ?? null;
    const named = planWeekdayIndexes(
      livePlanEntries(activePlan?.entries ?? [], templateSessionsReader(database)),
    );
    if (named.length > 0) {
      return named;
    }
    const sessionsPerWeek = homeActivePlanCard
      ? Number.parseInt(homeActivePlanCard.sessionsPerWeek, 10) || open.length
      : open.length;
    return resolveDerivedTrainingDays(open, sessionsPerWeek);
  }, [
    database.workoutPlans,
    database.workoutTemplates,
    database.exerciseTemplates,
    homeActivePlanCard,
    preferences.activePlanId,
    preferences.setupAvailableDays,
  ]);
  /**
   * The rhythm every calendar in the app reads.
   *
   * A saved cycle wins outright over the weekday list. The two cannot be merged
   * — one repeats every seven days and the other need not — and the plan's own
   * entry labels are still weekdays after a switch, so anything deriving from
   * them would quietly put the old week back.
   */
  /**
   * Which of the programme's sessions have been trained since Monday.
   *
   * The week list used to carry two chips that predicted — TÄNÄÄN from the
   * calendar, SEURAAVAKSI from the rotation — and on any day those two differ
   * the reader has to work out which one the row's outline meant. A week list
   * is for what happened, so it reports that instead.
   */
  const homeDoneThisWeekSessionIds = useMemo(() => {
    // The programme's own history, read the way the hero counter and the
    // rotation read it: sessions of the lead programme and of what it was
    // copied from, with the original's day ids read as the copy's. This
    // used to match every session's day id against the plan's, unaligned
    // and unfiltered — so a swap that copied the programme greyed Monday's
    // chip while the hero kept counting it, and a day trained in ANOTHER
    // programme lit a chip here, because the catalog reuses day ids across
    // programmes (audit round 4, 2026-09-20).
    const programId = homeActivePlanCard?.programId ?? null;
    if (!programId) {
      return [];
    }
    const lineage = new Set([
      programId,
      ...programmeHistoryIds(programId, workoutTemplates, templatesRunByOtherPlans(programId)),
    ]);
    // The week is read from the day key too: an app open over Sunday night
    // kept last week's dots until it was closed.
    const now = new Date(todayStartMs);
    const weekStart = getStartOfWeek(now).getTime();
    const weekEnd = getEndOfWeek(now).getTime();
    const ids = new Set<string>();
    for (const session of completedSessionsForTemplate(programId)) {
      if (!session.workoutTemplateId || !lineage.has(session.workoutTemplateId)) {
        continue;
      }
      const stamp = Date.parse(session.performedAt);
      if (!Number.isFinite(stamp) || stamp < weekStart || stamp >= weekEnd) {
        continue;
      }
      if (session.workoutTemplateSessionId) {
        ids.add(session.workoutTemplateSessionId);
      }
    }
    return [...ids];
    // Keyed on what completedSessionsForTemplate and the lineage read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    homeActivePlanCard?.programId,
    todayStartMs,
    database.workoutSessions,
    database.exerciseLogs,
    database.workoutTemplates,
    database.workoutPlans,
  ]);

  /**
   * The rhythm as chosen, before any day taken off: the lead programme's own
   * cycle when it has one. Another programme's cycle is that programme's, and
   * the reader's calendar never follows it (user 2026-10-07).
   */
  const leadCycle = leadPlanTrainingCycle(database.workoutPlans, preferences.activePlanId);
  const baseTrainingSchedule = useMemo(
    () =>
      leadCycle ? cycleSchedule(leadCycle.pattern, leadCycle.anchorDayStart) : weekdaySchedule(homeTrainingDayIndexes),
    [homeTrainingDayIndexes, leadCycle],
  );
  /**
   * The rhythm every calendar draws: the chosen one, with the days the reader
   * took off from the recovery sheet (2026-09-26). One place, so Home, the
   * widget, Progress and the coach all agree that tomorrow is rest.
   */
  const homeTrainingSchedule = useMemo(
    () => withRestDays(baseTrainingSchedule, preferences.restDayStarts),
    [baseTrainingSchedule, preferences.restDayStarts],
  );

  return {
    homeTrainingDayIndexes,
    homeDoneThisWeekSessionIds,
    baseTrainingSchedule,
    homeTrainingSchedule,
  };
}
