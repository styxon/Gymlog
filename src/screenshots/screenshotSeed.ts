/**
 * The store screenshots' reader: six weeks of a ready programme, a body that
 * moves the way a muscle-gain block does, and today's workout half done.
 *
 * Only the screenshot build reaches this (index.ts, behind
 * EXPO_PUBLIC_SCREENSHOT_SEED; tests/lib/screenshotSeedGate.test.cjs keeps it
 * that way). Every session goes through the app's own doors — the workout
 * reducer logs the sets, the finish adapter turns them into the save's input,
 * persistCompletedWorkoutSessionToDatabase writes the row and the reducer's
 * finish files the slot history — so what is stored is what a phone that
 * trained those weeks would hold, not a hand-built copy of its shape.
 *
 * Pure: the clock and the language come in, nothing is read or written here.
 * Not in src/lib/ although it is pure: it drives the workout reducer and the
 * save in features/ and state/, which lib must not depend on.
 * Dates step by calendar day (Helsinki moves its clocks; a fixed DAY_MS would
 * drift off the training hours twice a year).
 *
 * Three things the Android shots taught (memory: ref-website-screenshots), each
 * of which showed on screen and in no test:
 * - A lift whose top set repeats three times in a row reads as a plateau
 *   (by NAME, across days) — every load here rises at every occurrence.
 * - Seven days far above the 28-day average reads as "recovery low" — the
 *   sessions sit four to every seven days, evenly.
 * - A calendar week holding four sessions plus today's reads "5/4" — the
 *   offsets below never put more than three before today in one week.
 */
import { createEmptyDatabase } from '../data/seed';
import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { adaptCompletedWorkoutSessionForAppDatabase } from '../features/workout/workoutAppAdapter';
import { workoutInitialState, workoutReducer } from '../features/workout/workoutState';
import type { WorkoutFeatureState } from '../features/workout/workoutState';
import type { WorkoutPersistenceBundle, WorkoutTemplateV1 } from '../features/workout/workoutTypes';
import { acceptLegal } from '../lib/legalAcceptance';
import { LEGAL_VERSION } from '../lib/legalDocuments';
import { buildReadySessionRuntimeTemplate } from '../lib/programDetails';
import { buildProgramWorkoutPlan, buildReadyProgramPlanId } from '../lib/programAdoption';
import { getReadyTemplatePresentation } from '../lib/templatePresentation';
import { persistCompletedWorkoutSessionToDatabase } from '../state/completedWorkoutPersistence';
import type { AppDatabase, AppLanguage, MeasurementEntry, SessionFeel, SetupWeekday } from '../types/models';

/** HUGE Pro: four days, upper/lower — the shape the Android shots used. */
export const SCREENSHOT_PROGRAM_ID = 'tpl_4_day_upper_lower_v1';
/** Weeks of history before today. */
export const SCREENSHOT_WEEKS = 6;
/**
 * Days before today a session fell on, within one week; repeated a week
 * further back each time. Four in any seven days, and at most three of them in
 * the calendar week that holds today (day 7 back is always last week).
 */
const WEEK_OFFSETS = [7, 5, 4, 2];
const START_TIMES: Array<[number, number]> = [
  [17, 20],
  [17, 45],
  [11, 10],
  [18, 5],
];
const WEEKDAYS: SetupWeekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FEELS: SessionFeel[] = ['right', 'right', 'hard', 'right', 'easy', 'right', 'right', 'hard'];

/**
 * Load at the n-th time the lift is done (counted across every day it is on,
 * so a lift shared by two days still climbs at each of them): start + n·step.
 * Reps for the lifts the catalogue ranges by reps first.
 */
const LIFTS: Record<string, { start: number; step: number }> = {
  'Bench Press': { start: 70, step: 1.25 },
  'Chest-Supported Row': { start: 57.5, step: 1.25 },
  'Incline Dumbbell Press': { start: 22, step: 1 },
  'Lat Pulldown': { start: 55, step: 1.25 },
  'Lateral Raise': { start: 8, step: 0.5 },
  'Triceps Pushdown': { start: 27.5, step: 1.25 },
  'Back Squat': { start: 95, step: 2.5 },
  'Romanian Deadlift': { start: 95, step: 2.5 },
  'Leg Press': { start: 160, step: 5 },
  'Leg Curl': { start: 37.5, step: 1.25 },
  'Calf Raise': { start: 70, step: 2.5 },
  'Cable Crunch': { start: 35, step: 1.25 },
  'Overhead Press': { start: 45, step: 1.25 },
  'Seated Cable Row': { start: 62.5, step: 1.25 },
  'Machine Chest Press': { start: 65, step: 2.5 },
  'Rear Delt Fly': { start: 7, step: 0.5 },
  'Dumbbell Curl': { start: 11, step: 0.5 },
  'Trap Bar Deadlift': { start: 135, step: 2.5 },
  'Bulgarian Split Squat': { start: 18, step: 1 },
  'Hanging Knee Raise': { start: 0, step: 0 },
};

/** Weekly weigh-ins, oldest first: a slow gain. */
const WEIGHTS = [74.4, 74.9, 75.1, 75.0, 75.6, 75.9, 76.2, 76.6];
const TAPE: Record<'chest' | 'arms' | 'waist', number[]> = {
  chest: [101.0, 102.0, 103.0],
  arms: [37.0, 37.4, 37.8],
  waist: [81.5, 81.0, 80.5],
};

/**
 * Today's session as the seed leaves it: running since this many minutes ago,
 * with every set of the first exercises done and the last set of this one
 * still to log. The screenshots start there — the set screen, the next lift,
 * then Finish, whose summary then reads a real duration instead of the three
 * minutes a scripted run would take.
 */
const TODAY_STARTED_MINUTES_AGO = 52;
const TODAY_DONE_EXERCISES = 3;

export interface ScreenshotSeed {
  database: AppDatabase;
  workout: WorkoutPersistenceBundle;
}

function roundLoad(value: number) {
  return Math.round(value * 4) / 4;
}

/** Local wall-clock time on the calendar day `daysAgo` before `now`. */
function localAt(now: Date, daysAgo: number, hours: number, minutes: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hours, minutes, 0, 0);
}

function sessionsInOrder(template: WorkoutTemplateV1) {
  return template.sessions.slice().sort((left, right) => left.orderIndex - right.orderIndex);
}

/** The calendar days that held a session, oldest first. */
export function screenshotTrainingDays(now: Date): Date[] {
  const days: Date[] = [];
  for (let week = SCREENSHOT_WEEKS - 1; week >= 0; week -= 1) {
    WEEK_OFFSETS.forEach((offset, index) => {
      const [hours, minutes] = START_TIMES[index];
      days.push(localAt(now, offset + week * 7, hours, minutes));
    });
  }
  return days;
}

/**
 * One session through the reducer: start, every set logged at its own moment,
 * and — when `finish` — the save and the finish the app makes on "Finish".
 */
function trainSession(input: {
  state: WorkoutFeatureState;
  database: AppDatabase;
  template: WorkoutTemplateV1;
  sessionId: string;
  startMs: number;
  occurrence: Record<string, number>;
  stopAfterExercises: number | null;
  makeId: (prefix: string) => string;
}): { state: WorkoutFeatureState; database: AppDatabase; storedSessionId: string | null } {
  let state = workoutReducer(input.state, {
    type: 'session/startFromRuntimeTemplate',
    payload: {
      template: buildReadySessionRuntimeTemplate(input.template, input.sessionId),
      sessionOrderIndex: input.state.history.sessions.length + 1,
      unitPreference: 'kg',
    },
  });
  const started = state.activeSession;
  if (!started) {
    throw new Error(`screenshot seed: ${input.sessionId} did not start`);
  }
  const startedAt = new Date(input.startMs).toISOString();
  state = { ...state, activeSession: { ...started, startedAt, updatedAt: startedAt } };

  let clock = input.startMs + 6 * 60_000; // the warm-up
  const exercises = started.exercises;
  exercises.forEach((exercise, exerciseIndex) => {
    if (input.stopAfterExercises !== null && exerciseIndex > input.stopAfterExercises) {
      return;
    }
    const lift = LIFTS[exercise.exerciseName];
    if (!lift) {
      throw new Error(`screenshot seed: no load for ${exercise.exerciseName}`);
    }
    const n = input.occurrence[exercise.exerciseName] ?? 0;
    input.occurrence[exercise.exerciseName] = n + 1;
    const load = roundLoad(lift.start + n * lift.step);
    // The last exercise of an unfinished session stops one set short: that
    // set is the one the screenshot logs.
    const lastSet =
      input.stopAfterExercises !== null && exerciseIndex === input.stopAfterExercises
        ? exercise.sets.length - 1
        : exercise.sets.length;
    exercise.sets.slice(0, lastSet).forEach((set) => {
      const reps = set.plannedRepsMax ?? set.plannedRepsMin ?? 8;
      clock += 50_000;
      // The typed numbers, written into the draft directly. Sent as
      // set/updateDraft the reducer stamps the real clock, and the session
      // clock reads the gap back to this past moment as hours of time away.
      const loadText = load > 0 ? String(load) : '';
      state = {
        ...state,
        activeSession: {
          ...state.activeSession!,
          exercises: state.activeSession!.exercises.map((item) =>
            item.slotId !== exercise.slotId
              ? item
              : {
                  ...item,
                  sets: item.sets.map((draft) =>
                    draft.setIndex === set.setIndex
                      ? { ...draft, draftLoadText: loadText, draftRepsText: String(reps), edited: true }
                      : draft,
                  ),
                },
          ),
        },
      };
      state = workoutReducer(state, {
        type: 'set/complete',
        payload: { slotId: exercise.slotId, setIndex: set.setIndex, nowMs: clock, unitPreference: 'kg' },
      });
      clock += ((exercise.restSecondsMax || 60) + 30) * 1000;
    });
  });

  if (input.stopAfterExercises !== null) {
    const session = state.activeSession!;
    return {
      state: { ...state, activeSession: { ...session, updatedAt: new Date(clock).toISOString() } },
      database: input.database,
      storedSessionId: null,
    };
  }

  const performedMs = clock + 4 * 60_000; // the cool-down
  const adapted = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession!, performedMs);
  const result = persistCompletedWorkoutSessionToDatabase(input.database, adapted, input.makeId);
  if (!result.didPersist || !result.summary.sessionId) {
    throw new Error(`screenshot seed: ${input.sessionId} was not stored`);
  }
  state = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: adapted.performedAt } });
  state = workoutReducer(state, { type: 'session/clearCompletedSession' });
  return { state, database: result.database, storedSessionId: result.summary.sessionId };
}

export function buildScreenshotSeed(input: { language: AppLanguage; dark: boolean; now: Date }): ScreenshotSeed {
  const { language, dark, now } = input;
  const template = getWorkoutTemplateById(SCREENSHOT_PROGRAM_ID);
  if (!template) {
    throw new Error(`screenshot seed: ${SCREENSHOT_PROGRAM_ID} is not in the catalogue`);
  }
  const sessions = sessionsInOrder(template);
  let idSeq = 0;
  const makeId = (prefix: string) => `${prefix}_shot${(++idSeq).toString(36).padStart(4, '0')}`;
  const iso = (date: Date) => date.toISOString();

  const days = screenshotTrainingDays(now);
  const programmeStart = localAt(now, WEEK_OFFSETS[0] + (SCREENSHOT_WEEKS - 1) * 7 + 1, 19, 0);
  const plan = buildProgramWorkoutPlan({
    planId: buildReadyProgramPlanId(template.id),
    workoutTemplateId: template.id,
    programName: getReadyTemplatePresentation(template, language).title,
    sessionIds: sessions.map((session) => session.id),
    // The weekdays the history was trained on, in rotation order: the first
    // session of each week fell on today's weekday, and today is day 1 again.
    dayLabels: WEEK_OFFSETS.map((offset) => WEEKDAYS[localAt(now, offset, 12, 0).getDay()]),
    now: iso(programmeStart),
  });

  const blank = createEmptyDatabase(language);
  let database: AppDatabase = {
    ...blank,
    workoutPlans: [plan],
    preferences: {
      ...blank.preferences,
      appLanguage: language,
      unitPreference: 'kg',
      darkThemeEnabled: dark,
      // Pro, as the purchase a store sync would write (the Android shots'
      // way): this build has no store key, so nothing syncs over it.
      mockSubscriptionTerm: 'lifetime',
      mockSubscriptionPurchasedAt: iso(programmeStart),
      automatedProgressionEnabled: true,
      firstLaunchAt: iso(localAt(now, WEEK_OFFSETS[0] + (SCREENSHOT_WEEKS - 1) * 7 + 1, 18, 40)),
      hasOpenedAppBefore: true,
      legalAcceptance: acceptLegal(LEGAL_VERSION, programmeStart),
      entryFlowCompleted: true,
      onboardingCompleted: true,
      setupCompleted: true,
      setupHandoffCompleted: true,
      setupHandoffProSeen: true,
      trainingFirstRunDismissed: true,
      firstRunToursSeen: ['home', 'workoutSet', 'workoutRest'],
      accountBackupPromptDismissed: true,
      homeWidgetPromptDismissed: true,
      aiOnlineNoticeAcknowledged: true,
      // Asked once already, so the finish in the shots does not ask again.
      ratingPrompt: { lastAskedAt: iso(localAt(now, 3, 12, 0)), askCount: 1, rated: false },
      profileName: language === 'fi' ? 'Aleksi' : 'Alex',
      setupGender: 'male',
      setupAgeRange: '26_30',
      setupHeightCm: 180,
      setupCurrentWeightKg: WEIGHTS[WEIGHTS.length - 1],
      setupGoal: 'muscle',
      setupGoals: ['muscle'],
      setupLevel: 'advanced',
      setupDaysPerWeek: 4,
      setupEquipment: 'gym',
      setupTrainingEnvironment: 'full_gym',
      recommendedProgramId: template.id,
      activePlanId: plan.id,
      activePlanIds: [plan.id],
    },
  };

  let state: WorkoutFeatureState = { ...workoutInitialState, hydrated: true };
  const occurrence: Record<string, number> = {};
  days.forEach((day, index) => {
    const session = sessions[index % sessions.length];
    const trained = trainSession({
      state,
      database,
      template,
      sessionId: session.id,
      startMs: day.getTime(),
      occurrence,
      stopAfterExercises: null,
      makeId,
    });
    state = trained.state;
    database = {
      ...trained.database,
      workoutSessions: trained.database.workoutSessions.map((row) =>
        row.id === trained.storedSessionId ? { ...row, feel: FEELS[index % FEELS.length] } : row,
      ),
    };
  });

  // Today: the rotation's next session, under way.
  const todayStart = new Date(now.getTime() - TODAY_STARTED_MINUTES_AGO * 60_000);
  const today = trainSession({
    state,
    database,
    template,
    sessionId: sessions[days.length % sessions.length].id,
    startMs: todayStart.getTime(),
    occurrence,
    stopAfterExercises: TODAY_DONE_EXERCISES,
    makeId,
  });
  state = today.state;

  database = {
    ...database,
    bodyweightEntries: WEIGHTS.map((weight, index) => ({
      id: `bodyweight_shot${index}`,
      recordedAt: iso(localAt(now, (WEIGHTS.length - 1 - index) * 7 + 1, 8, 5)),
      weight,
    })),
    measurementEntries: [0, 1, 2].flatMap((index): MeasurementEntry[] =>
      (Object.keys(TAPE) as Array<keyof typeof TAPE>).map((kind) => ({
        id: `measure_shot_${kind}_${index}`,
        kind,
        recordedAt: iso(localAt(now, (2 - index) * 21 + 1, 8, 10)),
        value: TAPE[kind][index],
        unit: 'cm',
      })),
    ),
  };

  return {
    // Stored as built: the loader normalizes on the way in, and the suite
    // checks that normalizing it drops nothing.
    database,
    workout: { activeSession: state.activeSession, history: state.history },
  };
}
