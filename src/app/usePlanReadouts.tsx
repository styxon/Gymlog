import { useMemo } from 'react';

import type { WorkoutFeatureState } from '../features/workout/workoutState';
import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { csvExportRowOfCatalogue, csvExportRowOfSaved } from '../lib/programCsvExport';
import { getCanonicalCompletedSessions } from '../lib/completedSessions';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { blockWeekOfSession, blockWeekTally } from '../lib/homePlanProgress';
import { t, type I18nKey } from '../lib/i18n';
import { buildSessionAnalysis } from '../lib/sessionAnalysis';
import { localizeSessionFocus } from '../lib/sessionNameLabel';
import type { ExportablePlan } from '../screens/ExportPlanScreen';
import type { AppDatabase, AppPreferences, WorkoutTemplateSessionWithExercises } from '../types/models';
import type { useHomeActivePlan } from './useHomeActivePlan';

/**
 * What the screens beside Home's hero read off the lead programme: the plans
 * the CSV export carries, the week Home's session analysis names, Profile's
 * plan summary, and the guided player's eyebrow, week pill and "next up" —
 * the week pill on both sides of the save.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook, not a helper: these are memos, and VinhaApp calls this exactly
 * where the lines stood — after useNotificationRoute, before the Home memos
 * nothing reads any more (which stay in App.tsx until dead code is cleared
 * separately) — so every hook keeps its slot. .tsx because ExportablePlan
 * comes from src/screens, as in phase A.
 *
 * WEEKDAY_LABEL_KEYS is App.tsx's module constant, passed in rather than
 * moved. weekProgressBase stays inside; VinhaApp reads only what this returns.
 */
export interface PlanReadoutsDeps {
  /** The app context's custom programmes, every one of which the export carries. */
  workoutTemplates: AppDatabase['workoutTemplates'];
  /** The app context's session reader for one custom programme. */
  getWorkoutTemplateSessions: (workoutTemplateId: string) => WorkoutTemplateSessionWithExercises[];
  /** Home's hero card, as useHomeActivePlan builds it. */
  homeActivePlanCard: ReturnType<typeof useHomeActivePlan>['homeActivePlanCard'];
  /** The session the analysis route has open, or null. */
  analysisSessionId: string | null;
  /** The app context's saved sessions. */
  workoutSessions: AppDatabase['workoutSessions'];
  /** The whole database: the logs, and the canonical sessions the block counts. */
  database: AppDatabase;
  /** The reader's preferences: the language. */
  preferences: AppPreferences;
  /** Local midnight of today: the guided player names today's weekday from it. */
  todayStartMs: number;
  /** The card's sessions per week as a number, or null. */
  progressWeeklyTarget: number | null;
  /** The workout context: the active session's day. */
  workout: Pick<WorkoutFeatureState, 'activeSession'>;
  /** The stored weekday codes (MON/TUE/…) and the copy each is shown as. */
  WEEKDAY_LABEL_KEYS: Record<string, I18nKey>;
}

export function usePlanReadouts(deps: PlanReadoutsDeps) {
  const {
    workoutTemplates,
    getWorkoutTemplateSessions,
    homeActivePlanCard,
    analysisSessionId,
    workoutSessions,
    database,
    preferences,
    todayStartMs,
    progressWeeklyTarget,
    workout,
    WEEKDAY_LABEL_KEYS,
  } = deps;

  // Settings → "Export plan (CSV)". The user's own plans, plus the ready
  // program they are actually running. The rest of the catalog is app content
  // that never leaves the app, so there is nothing to carry out for it.
  const exportablePlans = useMemo<ExportablePlan[]>(() => {
    // Not the holders a finished free workout hangs on: they are not plans, and
    // the Programs list and the free-programme cap leave them out too. The
    // workout log export already carries those sessions.
    const plans: ExportablePlan[] = workoutTemplates
      .filter((template) => template.origin !== 'freestyle')
      .map((template) => ({
        id: template.id,
        name: formatWorkoutDisplayLabel(template.name, 'Workout plan'),
        sessions: getWorkoutTemplateSessions(template.id).map((session) => ({
          name: session.name,
          exercises: session.exercises.map(csvExportRowOfSaved),
        })),
      }));

    if (homeActivePlanCard?.programType === 'ready') {
      const readyTemplate = getWorkoutTemplateById(homeActivePlanCard.programId);
      if (readyTemplate && !plans.some((plan) => plan.id === readyTemplate.id)) {
        plans.push({
          id: readyTemplate.id,
          // The card's title, not the raw catalog name: curated titles in
          // templatePresentation override it, and the export must not name the
          // plan differently from every other screen.
          name: homeActivePlanCard.title,
          sessions: readyTemplate.sessions.map((session) => ({
            name: session.name,
            exercises: session.exercises.map(csvExportRowOfCatalogue),
          })),
        });
      }
    }

    return plans;
  }, [workoutTemplates, getWorkoutTemplateSessions, homeActivePlanCard]);

  // Profile "TRAINING PLAN" card. Reuses the same composed plan Home renders so
  // the two screens can never disagree about what the user is running.
  // Built only while the analysis route is open; it reads the whole log table.
  const sessionAnalysis = useMemo(
    () =>
      analysisSessionId
        ? buildSessionAnalysis({
            sessionId: analysisSessionId,
            sessions: workoutSessions,
            logs: database.exerciseLogs,
            language: preferences.appLanguage,
            // The week the analysed session filled, not the week the reader
            // is in: right after a week's last session those are two weeks,
            // and the analysis read "WEEK 2" beside a summary that had just
            // said week 1. A session outside the block gets no week at all.
            weekNumber: homeActivePlanCard
              ? blockWeekOfSession({
                  sessionId: analysisSessionId,
                  sessions: getCanonicalCompletedSessions(database),
                  templateIds: new Set(homeActivePlanCard.planTemplateIds),
                  blockStartedAt: homeActivePlanCard.blockStartedAt,
                  sessionsTotal: homeActivePlanCard.sessionsTotal,
                  totalWeeks: homeActivePlanCard.planTotalWeeks,
                })
              : null,
          })
        : null,
    [analysisSessionId, database, homeActivePlanCard, preferences.appLanguage, workoutSessions],
  );

  const profilePlanSummary = useMemo(() => {
    if (!homeActivePlanCard) {
      return { name: null, daysPerWeek: null, exerciseCount: null, sessionNames: [] as string[] };
    }

    const exerciseNames = new Set<string>();
    for (const session of homeActivePlanCard.sessions) {
      for (const exercise of session.exercises) {
        exerciseNames.add(exercise.name.trim().toLowerCase());
      }
    }

    // One row per day, full names. This used to be a deduplicated one-liner
    // ("Koko keho + H... · Koko keho + C...") that truncated exactly where the
    // days stopped reading alike — the user asked for the days themselves
    // (#bugs 2026-08-25).
    const sessionNames = homeActivePlanCard.sessions.map((session) =>
      localizeSessionFocus(formatWorkoutDisplayLabel(session.title), preferences.appLanguage),
    );

    return {
      name: homeActivePlanCard.title,
      daysPerWeek: Number.parseInt(homeActivePlanCard.sessionsPerWeek, 10) || homeActivePlanCard.sessions.length || null,
      exerciseCount: exerciseNames.size,
      sessionNames,
    };
  }, [homeActivePlanCard, preferences.appLanguage]);
  // Guided-player context props (entry eyebrow + finish-screen cards).
  // The weekday from the day key, not the clock: keyed on the week alone, a
  // player opened after midnight in an app left open named yesterday.
  const guidedEntryEyebrow = useMemo(() => {
    const weekday = t(preferences.appLanguage, `guided.weekday.${new Date(todayStartMs).getDay()}` as I18nKey);
    const week = homeActivePlanCard?.currentWeek;
    return week ? t(preferences.appLanguage, 'guided.entry.eyebrow', { weekday, week }) : weekday;
  }, [homeActivePlanCard?.currentWeek, preferences.appLanguage, todayStartMs]);
  /**
   * The programme's week, and how much of it is done — "VIIKKO 2 · 1/3".
   *
   * Both numbers come from the block, the same count Home's hero reads. The
   * count used to be the plan's sessions Monday to Sunday under a week label
   * taken from the block, and the two only line up for a plan started on a
   * Monday — see blockWeekTally.
   *
   * The two screens that show it sit on opposite sides of the save. The
   * guided player's finish view renders before the session is written, so it
   * counts the one in hand; the summary renders after, where the log already
   * has it and the same +1 counted it twice ("2/1" beside a Home that said
   * 1/1). One count, two honest readings.
   */
  const weekProgressBase = useMemo(() => {
    if (!homeActivePlanCard || !progressWeeklyTarget) {
      return null;
    }
    const reading = (sessionsDone: number) => {
      const tally = blockWeekTally({
        sessionsDone,
        sessionsTotal: homeActivePlanCard.sessionsTotal,
        totalWeeks: homeActivePlanCard.planTotalWeeks,
      });
      return {
        weekLabel: t(preferences.appLanguage, 'guided.finish.week', { week: tally.week }),
        done: tally.done,
        target: tally.target,
      };
    };
    return {
      beforeSave: reading(homeActivePlanCard.sessionsDone + 1),
      afterSave: reading(homeActivePlanCard.sessionsDone),
    };
  }, [homeActivePlanCard, preferences.appLanguage, progressWeeklyTarget]);

  /** Before the save: the session in hand is not in the log yet. */
  const guidedWeekProgress = weekProgressBase?.beforeSave ?? null;

  /** After the save: the log already contains it. */
  const completionWeekProgress = weekProgressBase?.afterSave ?? null;
  const guidedNextUp = useMemo(() => {
    const card = homeActivePlanCard;
    const templateSessionId = workout.activeSession?.templateSessionId;
    if (!card || !templateSessionId || card.sessions.length < 2) {
      return null;
    }
    const index = card.sessions.findIndex((session) => session.id === templateSessionId);
    if (index < 0) {
      return null;
    }
    const next = card.sessions[(index + 1) % card.sessions.length];
    // dayLabel is a stored English code (MON/TUE/…) matched against saved
    // plans, so it has to be translated before it reaches a screen — it was
    // printing "WED" over a Finnish summary.
    const rawDay = 'dayLabel' in next ? next.dayLabel ?? '' : '';
    const dayKey = WEEKDAY_LABEL_KEYS[rawDay.trim().slice(0, 3).toUpperCase()];
    return {
      name: next.title,
      weekday: dayKey ? t(preferences.appLanguage, dayKey) : rawDay,
    };
  }, [homeActivePlanCard, preferences.appLanguage, workout.activeSession?.templateSessionId]);

  return {
    exportablePlans,
    sessionAnalysis,
    profilePlanSummary,
    guidedEntryEyebrow,
    guidedWeekProgress,
    completionWeekProgress,
    guidedNextUp,
  };
}
