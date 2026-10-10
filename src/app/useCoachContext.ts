import { useMemo } from 'react';

import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { previewNextSession } from '../features/workout/workoutState';
import type {
  WorkoutHistoryStore,
  WorkoutProgressionOptions,
  WorkoutRuntimeTemplate,
} from '../features/workout/workoutTypes';
import { buildAiCoachProgramme } from '../lib/aiCoachProgramme';
import type { ProgrammeCardInput } from '../lib/aiCoachProgramme';
import { buildAiTrainingContext } from '../lib/aiTrainingContext';
import type { CoachAdviceMemoryEntry } from '../lib/coachAdviceMemory';
import { silencedSuggestionKinds } from '../lib/coachSuggestions';
import { sessionIsOnPlanToday } from '../lib/coachChat';
import type { getHomeSummary } from '../lib/dashboard';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import type { buildFatigueModel } from '../lib/fatigueModel';
import type { selectHomeCustomProgram } from '../lib/homeProgramSelection';
import type { resolveHomeStatCardKeys } from '../lib/homeStatCards';
import type { buildWeeklyRead } from '../lib/proInsights';
import { buildCustomSessionRuntimeTemplate, buildReadySessionRuntimeTemplate } from '../lib/programDetails';
import type { getTrackedExerciseProgress } from '../lib/progression';
import type { toProgressionFatigueSignal } from '../lib/progressionGate';
import { localizeSessionFocus } from '../lib/sessionNameLabel';
import { trainsOn } from '../lib/trainingSchedule';
import type { AppDatabase, AppPreferences, UnitPreference } from '../types/models';

/**
 * What the coach is handed about the reader: the targets the set screen will
 * open on next time, the training context every question carries, and the
 * chat's opening state.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-B split (2026-09-30),
 * docs, comments and deps arrays included — the eslint-disabled one that
 * leaves programmeStart out, and aiCoachTrainingContext's, which read
 * preferences.setupAgeRange without listing it (listed now). A hook, not a helper: it is
 * three memos, and VinhaApp calls it exactly where they stood — after the
 * recovery sheet's handlers, before the lead-plan repair effect — so React's
 * hook order is unchanged. coachNextSessionTargets stays in here; the context
 * and the intro go back to App.tsx's render.
 *
 * The comment that opens the coach's intro in App.tsx ("The AI tab's opening
 * state"), above the Home stat cards, was already apart from it and stays
 * there.
 */
export interface CoachContextDeps {
  workoutSessions: AppDatabase['workoutSessions'];
  cardioSessions: AppDatabase['cardioSessions'];
  database: AppDatabase;
  preferences: AppPreferences;
  /** The workout context: its history and the ready-programme count are read. */
  workout: { templates: { length: number }; history: WorkoutHistoryStore };
  unitPreference: UnitPreference;
  trackedProgress: ReturnType<typeof getTrackedExerciseProgress>;
  /** Local midnight of the day the reader is in: VinhaApp's day key. */
  todayStartMs: number;
  coachAdviceMemory: CoachAdviceMemoryEntry[];
  homeSummary: ReturnType<typeof getHomeSummary>;
  proFatigue: ReturnType<typeof buildFatigueModel>;
  progressionFatigueSignal: ReturnType<typeof toProgressionFatigueSignal>;
  proWeeklyRead: ReturnType<typeof buildWeeklyRead>;
  homeActiveWorkoutSummary: { title: string; nextExercise: string | null; meta: string } | null;
  /**
   * VinhaApp's programmeStart: a hoisted per-render function declaration,
   * passed by value, so the memo calls the one of the render that recomputes
   * it — as the inline closure did.
   */
  programmeStart: (
    runtimeTemplate: WorkoutRuntimeTemplate,
    now?: Date,
  ) => { template: WorkoutRuntimeTemplate; options: WorkoutProgressionOptions };
  customWorkoutRuntimeMap: Record<string, WorkoutRuntimeTemplate>;
  selectedCustomProgram: ReturnType<typeof selectHomeCustomProgram>;
  /** Home's composed programme card; only what these memos read is typed here. */
  homeActivePlanCard:
    | (ProgrammeCardInput & { nextSession: { title: string } | null; todayPickSessionId: string | null; sessionForecast?: { trainedToday: boolean } | null })
    | null;
  homePinnedStatCardKeys: ReturnType<typeof resolveHomeStatCardKeys>;
  homeTrainingSchedule: Parameters<typeof trainsOn>[0];
}

export function useCoachContext(deps: CoachContextDeps) {
  const {
    workoutSessions,
    cardioSessions,
    database,
    preferences,
    workout,
    unitPreference,
    trackedProgress,
    todayStartMs,
    coachAdviceMemory,
    homeSummary,
    proFatigue,
    progressionFatigueSignal,
    proWeeklyRead,
    homeActiveWorkoutSummary,
    programmeStart,
    customWorkoutRuntimeMap,
    selectedCustomProgram,
    homeActivePlanCard,
    homePinnedStatCardKeys,
    homeTrainingSchedule,
  } = deps;

  /**
   * What the set screen will open on the next time the last session's day is
   * started — the same materialisation and target resolver a real start uses,
   * so the coach's example quotes the app's own numbers (user, 2026-09-27).
   * Empty when the last session is not a programme day the app can start.
   */
  const coachNextSessionTargets = useMemo(() => {
    const nowMs = Date.now();
    const last = workoutSessions
      .filter((session) => {
        const at = new Date(session.performedAt).getTime();
        return Number.isFinite(at) && at <= nowMs;
      })
      .reduce<(typeof workoutSessions)[number] | null>(
        (newest, session) =>
          !newest || new Date(session.performedAt).getTime() > new Date(newest.performedAt).getTime() ? session : newest,
        null,
      );
    const sessionId = last?.workoutTemplateSessionId;
    if (!last || !sessionId) {
      return [];
    }
    try {
      const custom = customWorkoutRuntimeMap[last.workoutTemplateId];
      const ready = custom ? null : getWorkoutTemplateById(last.workoutTemplateId);
      const runtimeTemplate = custom
        ? buildCustomSessionRuntimeTemplate(custom, sessionId)
        : ready
          ? buildReadySessionRuntimeTemplate(ready, sessionId)
          : null;
      if (!runtimeTemplate) {
        return [];
      }
      const start = programmeStart(runtimeTemplate, new Date(nowMs));
      return previewNextSession(start.template, {
        unitPreference,
        history: workout.history,
        sessionOrderIndex: 0,
        ...start.options,
      });
    } catch (error) {
      // A preview that cannot be built leaves the example out; it must never
      // take the coach down with it.
      console.error('Failed to preview the next session for the coach', error);
      return [];
    }
    // programmeStart reads preferences and the recovery signal; todayStartMs
    // because "the last session" and a pending lighter session are both dated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customWorkoutRuntimeMap, preferences, progressionFatigueSignal, todayStartMs, unitPreference, workout.history, workoutSessions]);
  const aiCoachTrainingContext = useMemo(
    () =>
      buildAiTrainingContext({
        unitPreference,
        activeWorkoutSummary: homeActiveWorkoutSummary,
        homeSummary,
        workoutSessions,
        // homeSummary's counts include runs; without them here the context
        // said "3 sessions" and "no sessions logged" about the same reader.
        cardioSessions,
        exerciseLogs: database.exerciseLogs,
        trackedProgress,
        readyProgramCount: workout.templates.length,
        recommendedProgramId: preferences.recommendedProgramId,
        recommendedProgramTitle: preferences.recommendedProgramId
          ? formatWorkoutDisplayLabel(getWorkoutTemplateById(preferences.recommendedProgramId)?.name)
          : null,
        customProgramTitle: selectedCustomProgram.workoutId
          ? formatWorkoutDisplayLabel(selectedCustomProgram.title)
          : null,
        // The week itself, from Home's own composed card. A title alone made
        // the coach answer "I cannot see your programme's exercises in this
        // data" to a reader one tap away from the list (#bugs 2026-08-25).
        programme: buildAiCoachProgramme(homeActivePlanCard),
        // The plan's real rhythm — cycle or weekdays — so planned-versus-actual
        // and "next training day" cannot disagree with Home. Availability alone
        // told a 2-on-1-off reader their schedule was mon-wed-thu (2026-08-23).
        trainingDays: preferences.setupAvailableDays,
        schedule: homeTrainingSchedule,
        // The body record and goals: without these a chest-growth or nutrition
        // question got a training summary (transcript review, 23.8.).
        bodyweightEntries: database.bodyweightEntries,
        measurementEntries: database.measurementEntries,
        coachGoals: preferences.coachGoals,
        primaryGoalId: preferences.primaryGoalId,
        bodyweightGoalKg: preferences.bodyweightGoalKg,
        // What the coach already said, so it stops repeating itself across
        // conversations (lib/coachAdviceMemory).
        coachMemory: coachAdviceMemory,
        profile: {
          heightCm: preferences.setupHeightCm,
          // Both, because they are not the same claim: `setupAge` is a year an
          // older install actually recorded, `setupAgeRange` is the band this
          // one asks for. Whichever exists is true; neither is derived from the
          // other, so the coach is never told an age nobody gave.
          age: preferences.setupAge,
          ageRange: preferences.setupAgeRange,
          gender: preferences.setupGender,
        },
        // What Home already carries, and what the coach must not bring up:
        // an offer for something already on is the sign explaining a sign.
        nextSessionTargets: coachNextSessionTargets,
        homeState: {
          pinnedStatCardKeys: homePinnedStatCardKeys,
          weighInReminderEnabled: preferences.notificationPrefs.weighInReminder,
          silencedSuggestions: silencedSuggestionKinds(preferences.coachSuggestionState),
        },
        // The body areas flagged in setup. The privacy policy says the coach
        // hears the reader's limitations; plannerSetup below never reaches it
        // (nothing sets aiSetupCompleted), so this is where they travel.
        cautionFlags: preferences.setupCautionFlags,
        plannerSetup: preferences.aiSetupCompleted
          ? {
              goal: preferences.aiPlannerGoal,
              daysPerWeek: preferences.aiPlannerDaysPerWeek,
              experience: preferences.aiPlannerExperience,
              sessionMinutes: preferences.aiPlannerSessionMinutes,
              equipment: preferences.aiPlannerEquipment,
              recovery: preferences.aiPlannerRecovery,
              mustInclude: preferences.aiPlannerMustInclude
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
              avoid: preferences.aiPlannerAvoid
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
              limitations: preferences.aiPlannerLimitations
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            }
          : null,
      }),
    [
      homeActiveWorkoutSummary,
      homeActivePlanCard,
      homeSummary,
      cardioSessions,
      selectedCustomProgram.title,
      selectedCustomProgram.workoutId,
      trackedProgress,
      unitPreference,
      database.bodyweightEntries,
      database.measurementEntries,
      preferences.coachGoals,
      preferences.primaryGoalId,
      coachAdviceMemory,
      coachNextSessionTargets,
      homePinnedStatCardKeys,
      preferences.coachSuggestionState,
      preferences.notificationPrefs.weighInReminder,
      preferences.bodyweightGoalKg,
      preferences.setupHeightCm,
      preferences.setupAge,
      // Read above as the age band; missing here, a changed band only reached
      // the coach when something else rebuilt the context (#bugs 2026-10-01).
      preferences.setupAgeRange,
      preferences.setupGender,
      preferences.aiSetupCompleted,
      preferences.setupCautionFlags,
      preferences.aiPlannerGoal,
      preferences.aiPlannerDaysPerWeek,
      preferences.aiPlannerExperience,
      preferences.aiPlannerSessionMinutes,
      preferences.aiPlannerEquipment,
      preferences.aiPlannerRecovery,
      preferences.aiPlannerMustInclude,
      preferences.aiPlannerAvoid,
      preferences.aiPlannerLimitations,
      preferences.recommendedProgramId,
      preferences.setupAvailableDays,
      homeTrainingSchedule,
      workout.templates.length,
      workoutSessions,
      database.exerciseLogs,
    ],
  );
  // Only a session the schedule actually puts on TODAY is "on the plan
  // today". The next session in the rotation used to be named regardless, so
  // the coach opened a rest day with "Upper is on the plan today — walk
  // through it?" (#bugs, 2026-08-23). On a rest day the coach says so and
  // names what comes next.
  const coachChatIntro = useMemo(
    () => ({
      // Focus, not the ordinal: the coach's line has the day in it already
      // ("today", "next on the plan"), so "Päivä 1:" pushed the real name past
      // the edge and it arrived as "Koko keho + H..." (user, 2026-08-25).
      // Today from the day key, like the count below it — the clock read
      // here was only as fresh as whatever last changed this memo's inputs.
      todaySessionTitle:
        // Or the reader picked today's session on a rest day — Home's hero
        // then treats today as training, and so does the coach. Not once
        // today's workout is done: the next session is then the next one.
        homeActivePlanCard?.nextSession &&
        sessionIsOnPlanToday({
          hasNextSession: true,
          pickStands: Boolean(homeActivePlanCard.todayPickSessionId),
          trainedToday: homeActivePlanCard.sessionForecast?.trainedToday === true,
          scheduledToday: trainsOn(homeTrainingSchedule, new Date(todayStartMs)),
        })
          ? localizeSessionFocus(
              formatWorkoutDisplayLabel(homeActivePlanCard.nextSession.title),
              preferences.appLanguage,
            )
          : null,
      trainedToday:
        homeActivePlanCard?.sessionForecast?.trainedToday === true && !homeActivePlanCard.todayPickSessionId,
      nextSessionTitle: homeActivePlanCard?.nextSession
        ? localizeSessionFocus(
            formatWorkoutDisplayLabel(homeActivePlanCard.nextSession.title),
            preferences.appLanguage,
          )
        : null,
      sessionsThisWeek: homeSummary.streak.sessionsThisWeek,
      weeklyRead: proWeeklyRead,
      fatigue: proFatigue,
      // The one opening that had nothing to offer. The chat can build a week
      // from a sentence now, and this is the reader that needs to know.
      hasProgramme: Boolean(homeActivePlanCard),
    }),
    [homeActivePlanCard, homeSummary.streak.sessionsThisWeek, homeTrainingSchedule, preferences.appLanguage, proFatigue, proWeeklyRead, todayStartMs],
  );

  return { aiCoachTrainingContext, coachChatIntro };
}
