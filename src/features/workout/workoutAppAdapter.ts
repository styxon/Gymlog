import { ExerciseLogDraft, ExerciseLogSet } from '../../types/models';
import {
  isMinutesTrackingMode,
  WorkoutExerciseInstance,
  WorkoutSessionRuntime,
  WorkoutSetStatus,
  WorkoutTrackingMode,
} from './workoutTypes';
import { sessionLastActiveMs, workoutSecondsUntil } from '../../lib/sessionClock';
import { LiftSegment, splitExerciseByLift } from '../../lib/liftSegments';
import { buildLoggedSetPlan } from '../../lib/loggedSetPlan';

export type LegacyWorkoutDataMismatch =
  | 'template_exercise_id_not_mapped';

export interface AdaptedCompletedWorkoutSet {
  orderIndex: number;
  status: WorkoutSetStatus;
  weightKg: number | null;
  reps: number | null;
  kind: ExerciseLogSet['kind'];
  outcome: ExerciseLogSet['outcome'] | null;
  effort: ExerciseLogSet['effort'];
  performedAt: string | null;
  skippedReason?: string | null;
}

export interface AdaptedCompletedWorkoutExercise {
  /**
   * The row's id on the finish screen: the live slot's id, except for a
   * further lift the same slot held, which is `<slot id>#<position>` — one
   * slot swapped mid-exercise is two rows. See bridgeRowId.
   */
  slotId: string;
  templateSlotId: string;
  templateExerciseId: string;
  persistedExerciseTemplateId: string | null;
  exerciseName: string;
  tracked: boolean;
  /** Carried so the finish screen can say "45 s" instead of "45 reps". */
  trackingMode: WorkoutTrackingMode;
  orderIndex: number;
  skipped: boolean;
  sessionInserted: boolean;
  notes: string | null;
  swappedFrom: string | null;
  sets: AdaptedCompletedWorkoutSet[];
}

export interface AdaptedCompletedWorkoutSession {
  sessionId: string;
  workoutTemplateId: string;
  workoutTemplateSessionId: string | null;
  workoutNameSnapshot: string;
  startedAt: string;
  performedAt: string;
  /** Start to finish less every pause: the number the player's clock showed. */
  durationMinutes: number;
  exercises: AdaptedCompletedWorkoutExercise[];
  logs: ExerciseLogDraft[];
  legacyShapeMismatches: LegacyWorkoutDataMismatch[];
  /** The moments of the sets taken back in the session (WorkoutSessionRuntime.takenBackAt). */
  takenBackAt: string[];
}

/**
 * How long after the last logged set a finish still belongs to that workout.
 * A cooldown or a slow walk to the phone fits well inside it; a session left
 * open overnight does not.
 */
const STALE_FINISH_MS = 2 * 60 * 60 * 1000;

/**
 * When the workout ended.
 *
 * It was `updatedAt`, which the clock moved to now on every tick while a rest
 * timer ran. A phone that closed the app mid-rest and was reopened days later
 * saved the workout on the day it was reopened, with a duration of thousands
 * of minutes. Past a couple of hours since the last logged set, the last set is
 * when the workout ended.
 *
 * The clock no longer moves `updatedAt` during a rest (2026-09-16); the rest
 * is read at `nowMs` instead, so finishing mid-rest still ends the workout now.
 */
function resolveFinishedAt(session: WorkoutSessionRuntime, nowMs: number): string {
  if (session.completedAt) {
    return session.completedAt;
  }
  let lastSet: string | null = null;
  let lastSetMs = -Infinity;
  session.exercises.forEach((exercise) => {
    exercise.sets.forEach((set) => {
      const time = set.status === 'completed' && set.completedAt ? Date.parse(set.completedAt) : Number.NaN;
      if (Number.isFinite(time) && time > lastSetMs) {
        lastSet = set.completedAt ?? null;
        lastSetMs = time;
      }
    });
  });
  const activeMs = sessionLastActiveMs(session, nowMs);
  if (lastSet && Number.isFinite(activeMs) && activeMs - lastSetMs > STALE_FINISH_MS) {
    return lastSet;
  }
  if (!Number.isFinite(activeMs) || activeMs === Date.parse(session.updatedAt)) {
    return session.updatedAt;
  }
  return new Date(activeMs).toISOString();
}

function sortByOrderIndex<T extends { orderIndex: number }>(items: T[]) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.orderIndex - right.item.orderIndex || left.index - right.index)
    .map(({ item }) => item);
}

function isTrackedExercise(exercise: WorkoutExerciseInstance) {
  return exercise.progressionPriority !== 'low';
}

function adaptExerciseStatus(
  status: WorkoutExerciseInstance['status'],
): ExerciseLogDraft['status'] {
  if (status === 'completed' || status === 'skipped' || status === 'swapped') {
    return status;
  }

  return 'active';
}

function adaptSetForBridge(
  set: WorkoutExerciseInstance['sets'][number],
): AdaptedCompletedWorkoutSet {
  return {
    orderIndex: set.setIndex,
    status: set.status,
    weightKg: typeof set.actualLoadKg === 'number' ? set.actualLoadKg : null,
    reps: typeof set.actualReps === 'number' ? set.actualReps : null,
    kind: 'working',
    outcome: set.status === 'completed' ? 'completed' : set.status === 'skipped' ? 'skipped' : null,
    effort: set.effort ?? null,
    performedAt: set.completedAt ?? null,
    skippedReason: set.skippedReason ?? null,
  };
}

/**
 * What a finished slot is saved as: one row per lift it held (lib/liftSegments).
 *
 * The lift the programme wrote here keeps its claim on the programme's
 * exercise template. Any other lift has none: the template is the programmed
 * lift, and naming a leg press log after it put 200 kg on "back squat" in
 * Progress (swap audit, 2026-09-21). What belongs to the exercise as a whole —
 * its status, its notes — stays with the lift it ended on; a lift it held
 * before a swap was done as far as it went.
 */
interface SavedLift {
  segment: LiftSegment;
  exerciseTemplateId: string | null;
  exerciseName: string;
  skipped: boolean;
  notes: string | null;
  status: ExerciseLogDraft['status'];
  /** The row that stands for the exercise: the lift it ended on, else the last one done. */
  holdsExercise: boolean;
}

function savedLifts(exercise: WorkoutExerciseInstance): SavedLift[] {
  const notes = exercise.notes?.trim() ? exercise.notes.trim() : null;
  const segments = splitExerciseByLift(exercise);
  // Swapped after its last set, the exercise ended on a lift with no row of
  // its own; the last lift that was done stands for it instead.
  const holder = segments.find((segment) => segment.current) ?? segments[segments.length - 1];
  return segments.map((segment) => ({
    segment,
    exerciseTemplateId:
      exercise.sessionInserted || segment.swappedFrom !== null ? null : exercise.persistedExerciseTemplateId ?? null,
    exerciseName: segment.exerciseName,
    skipped: segment.current && exercise.status === 'skipped',
    notes: segment === holder ? notes : null,
    holdsExercise: segment === holder,
    status: segment.current ? adaptExerciseStatus(exercise.status) : 'completed',
  }));
}

/**
 * A row of a split slot needs an id of its own: the finish screen keys its
 * cards, its PR badges and its "what moved" lines by this. The row standing
 * for the exercise keeps the slot's id; any other lift the slot held is told
 * apart by its position.
 */
function bridgeRowId(exercise: WorkoutExerciseInstance, lift: SavedLift, index: number) {
  return lift.holdsExercise ? exercise.slotId : `${exercise.slotId}#${index}`;
}

function adaptExerciseForBridge(exercise: WorkoutExerciseInstance): AdaptedCompletedWorkoutExercise[] {
  return savedLifts(exercise).map((lift, index) => ({
    slotId: bridgeRowId(exercise, lift, index),
    templateSlotId: exercise.templateSlotId,
    templateExerciseId: exercise.templateExerciseId,
    persistedExerciseTemplateId: lift.exerciseTemplateId,
    exerciseName: lift.exerciseName,
    tracked: isTrackedExercise(exercise),
    trackingMode: lift.segment.trackingMode,
    orderIndex: exercise.orderIndex,
    skipped: lift.skipped,
    sessionInserted: exercise.sessionInserted === true,
    notes: lift.notes,
    swappedFrom: lift.segment.swappedFrom,
    sets: sortByOrderIndex(lift.segment.sets.map(adaptSetForBridge)),
  }));
}

function adaptSetToLogSet(set: WorkoutExerciseInstance['sets'][number]): ExerciseLogDraft['sets'][number] {
  return {
    orderIndex: set.setIndex,
    weight: set.actualLoadKg ?? 0,
    reps: set.actualReps ?? 0,
    kind: 'working' as const,
    outcome: set.status === 'completed' ? ('completed' as const) : set.status === 'skipped' ? ('skipped' as const) : null,
    status: set.status,
    effort: set.effort ?? null,
    completedAt: set.completedAt ?? null,
    skippedReason: set.skippedReason ?? null,
    // What the app opened this set at, and why — the gate's own fields, which
    // were dropped here until 2026-09-30.
    planned: buildLoggedSetPlan(set),
  };
}

/**
 * The warm-ups, as log sets of kind 'warmup' ahead of the work.
 *
 * Numbered below zero (-n … -1): the working sets keep the numbers they were
 * logged under, which the merge of a finish done twice and the plan of each
 * set are keyed by. Kind 'warmup' keeps them out of volume, set counts and
 * records (lib/exerciseLog getComparableLogSets) without a reader having to
 * know they exist.
 */
function adaptWarmupsToLogSets(exercise: WorkoutExerciseInstance): ExerciseLogDraft['sets'] {
  const warmups = exercise.warmups ?? [];
  return warmups.map((warmup, index) => ({
    orderIndex: index - warmups.length,
    weight: warmup.loadKg,
    reps: warmup.reps,
    kind: 'warmup' as const,
    outcome: 'completed' as const,
    status: 'completed' as const,
    effort: null,
    completedAt: warmup.completedAt,
    skippedReason: null,
  }));
}

function adaptExerciseToLogDrafts(exercise: WorkoutExerciseInstance): ExerciseLogDraft[] {
  return savedLifts(exercise).map(
    (lift, liftIndex) =>
      ({
        exerciseTemplateId: lift.exerciseTemplateId,
        exerciseNameSnapshot: lift.exerciseName,
        // Warm-ups come before the first working set: they belong to the lift
        // the slot started as.
        sets: [
          ...(liftIndex === 0 ? adaptWarmupsToLogSets(exercise) : []),
          ...sortByOrderIndex(lift.segment.sets.map(adaptSetToLogSet)),
        ],
        tracked: isTrackedExercise(exercise),
        orderIndex: exercise.orderIndex,
        skipped: lift.skipped,
        sessionInserted: exercise.sessionInserted === true,
        status: lift.status,
        slotId: exercise.slotId,
        templateSlotId: exercise.templateSlotId,
        templateExerciseId: exercise.templateExerciseId,
        notes: lift.notes,
        swappedFrom: lift.segment.swappedFrom,
        // The unit is the lift's own, set by set: a slot swapped from a bike
        // to a lift mid-way saves two logs, and only the bike's is minutes.
        ...(isMinutesTrackingMode(lift.segment.trackingMode) ? { repsUnit: 'minutes' as const } : {}),
      }) satisfies ExerciseLogDraft,
  );
}

function shouldPersistExercise(exercise: WorkoutExerciseInstance) {
  if (exercise.status === 'skipped' || exercise.sessionInserted === true) {
    return true;
  }

  // A swap made in the player is on record even with nothing logged after it.
  // One made on Home before the start is only the plan until a set is done:
  // kept regardless, an untouched session with one swapped row was saved as a
  // finished workout instead of being discarded (review of this change).
  if (exercise.notes?.trim() || (exercise.status === 'swapped' && exercise.sourceExerciseName?.trim())) {
    return true;
  }

  return exercise.sets.some((set) => set.status !== 'pending' || set.edited);
}

function collectLegacyShapeMismatches(
  exercises: AdaptedCompletedWorkoutExercise[],
): LegacyWorkoutDataMismatch[] {
  const mismatches = new Set<LegacyWorkoutDataMismatch>();

  exercises.forEach((exercise) => {
    // A swapped-in lift has no template on purpose (see savedLifts); that is
    // not the legacy shape this counts.
    if (exercise.templateExerciseId && !exercise.persistedExerciseTemplateId && exercise.swappedFrom === null) {
      mismatches.add('template_exercise_id_not_mapped');
    }
  });

  return Array.from(mismatches.values()).sort();
}

export function buildAdaptedCompletedWorkoutExercises(
  session: WorkoutSessionRuntime,
): AdaptedCompletedWorkoutExercise[] {
  return sortByOrderIndex(session.exercises.flatMap(adaptExerciseForBridge));
}

export function buildExerciseLogDraftsFromWorkoutSession(session: WorkoutSessionRuntime): ExerciseLogDraft[] {
  return sortByOrderIndex(session.exercises.filter(shouldPersistExercise).flatMap(adaptExerciseToLogDrafts));
}

export function adaptCompletedWorkoutSessionForAppDatabase(
  session: WorkoutSessionRuntime,
  nowMs: number = Date.now(),
): AdaptedCompletedWorkoutSession {
  const exercises = buildAdaptedCompletedWorkoutExercises(session);
  const performedAt = resolveFinishedAt(session, nowMs);

  return {
    sessionId: session.sessionId,
    workoutTemplateId: session.templateId,
    workoutTemplateSessionId: session.templateSessionId,
    workoutNameSnapshot: session.templateName,
    startedAt: session.startedAt,
    performedAt,
    // Less the pauses. The save used finish minus start, so an hour with a
    // twenty-minute pause went into history as sixty minutes while the player
    // had shown forty.
    durationMinutes: Math.max(1, Math.round(workoutSecondsUntil(session, Date.parse(performedAt)) / 60) || 1),
    exercises,
    logs: buildExerciseLogDraftsFromWorkoutSession(session),
    legacyShapeMismatches: collectLegacyShapeMismatches(exercises),
    takenBackAt: session.takenBackAt ?? [],
  };
}

