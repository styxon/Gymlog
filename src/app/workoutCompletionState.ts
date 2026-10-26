import { AdaptedCompletedWorkoutExercise } from '../features/workout/workoutAppAdapter';
import { PostSessionInsight } from '../lib/postSessionInsight';
import {
  buildPreviousTopSets,
  buildWhatMoved,
  Movement,
  MovementRow,
  resolveMovement,
  WhatMovedRow,
} from '../lib/sessionMovement';
import { getTopSetLabel, MuscleFocusRow } from '../lib/workoutCompleteView';
import { isDoseLog } from '../lib/holdExercises';
import { beatsBest, heaviestOfSets, WeightedSet } from '../lib/personalRecords';
import { isMinutesTrackingMode } from '../features/workout/workoutTypes';
import {
  announcesRecord,
  buildExercisePrLookup,
  resolvePreviousExercisePr,
  WorkoutCompletionExerciseCard,
  WorkoutCompletionPrCard,
} from '../lib/workoutCompletionSummary';
import {
  AppLanguage,
  ExerciseLibraryItem,
  ExerciseLog,
  ExerciseLogDraft,
  ExerciseTemplate,
  UnitPreference,
} from '../types/models';

/**
 * What the finish flow hands the summary and celebration screens.
 *
 * Assembly only — the judgement calls (what counts as a PR, what a top set
 * reads as) live in src/lib. Moved out of App.tsx in the phase-A split
 * (2026-08-26): this is the completion domain's shape, not wiring.
 */
export interface CompletionSummaryState {
  sessionId: string;
  workoutName: string;
  performedAt: string;
  durationMinutes: number;
  setsCompleted: number;
  totalVolume: number;
  exercisesLogged: number;
  volumeDeltaKg: number | null;
  muscles: MuscleFocusRow[];
  exerciseCards: WorkoutCompletionExerciseCard[];
  prCards: WorkoutCompletionPrCard[];
  /** The lifts that went up, heaviest jump first (lib/sessionMovement). */
  whatMoved: WhatMovedRow[];
  /** Card id → how that lift compares with its last session. */
  movementById: Record<string, Movement>;
  insight: PostSessionInsight | null;
}

function isWorkoutCompletionPrCard(
  card: WorkoutCompletionPrCard | null,
): card is WorkoutCompletionPrCard {
  return card !== null;
}

/**
 * The sets this lift offers the records, as the Records tab reads them
 * (recordSetsOfLog): none for a dose, minutes of a bout or seconds of a hold.
 * heaviestOfSets alone ignores the tracking mode, so a weighted plank or
 * twenty minutes on a bike was a "new record" every session and the movement
 * rows compared seconds as kilos.
 */
export function recordSetsOfExercise(exercise: AdaptedCompletedWorkoutExercise): WeightedSet[] {
  const done = exercise.sets.filter(
    (set): set is typeof set & { weightKg: number; reps: number } =>
      set.status === 'completed' && typeof set.weightKg === 'number' && typeof set.reps === 'number',
  );
  if (
    exercise.trackingMode === 'hold' ||
    isDoseLog({
      exerciseNameSnapshot: exercise.exerciseName,
      repsUnit: isMinutesTrackingMode(exercise.trackingMode) ? 'minutes' : undefined,
      sets: done.map((set) => ({ reps: set.reps })),
    })
  ) {
    return [];
  }
  return done.map((set) => ({ weight: set.weightKg, reps: set.reps }));
}

/**
 * How each lift compares with the last session it was trained in.
 *
 * Built from the persisted logs rather than from the live session, because
 * "last time" has to mean the last time this lift happened — which may have
 * been in another programme, or in an empty workout, and is never in the
 * session that just ended.
 */
export function buildSessionMovement({
  exercises,
  exerciseLogs,
  workoutSessions,
  sessionId,
  language,
  unitPreference,
}: {
  exercises: AdaptedCompletedWorkoutExercise[];
  exerciseLogs: ReadonlyArray<ExerciseLog>;
  workoutSessions: ReadonlyArray<{ id: string; performedAt: string }>;
  sessionId: string;
  language: AppLanguage;
  unitPreference: UnitPreference;
}): { whatMoved: WhatMovedRow[]; movementById: Record<string, Movement> } {
  const previousTops = buildPreviousTopSets({
    logs: exerciseLogs,
    performedAtBySessionId: Object.fromEntries(
      workoutSessions.map((session) => [session.id, session.performedAt] as const),
    ),
    excludeSessionId: sessionId,
  });

  const rows: Array<{ id: string; row: MovementRow }> = exercises
    .map((exercise): { id: string; row: MovementRow } | null => {
      // The records rule (heaviestOfSets), as the PR cards below read it.
      const top = heaviestOfSets(recordSetsOfExercise(exercise));
      const best = top ? { kg: top.weight, reps: top.reps } : null;
      if (!best) {
        return null;
      }
      return {
        id: exercise.slotId,
        row: {
          exerciseName: exercise.exerciseName,
          todayTopKg: best.kg,
          todayTopReps: best.reps,
          previousTopKg: previousTops[exercise.exerciseName.trim().toLowerCase()] ?? null,
          repsMax: exercise.repsMax ?? null,
        },
      };
    })
    .filter((entry): entry is { id: string; row: MovementRow } => entry !== null);

  return {
    whatMoved: buildWhatMoved(rows.map((entry) => entry.row), language, unitPreference),
    movementById: Object.fromEntries(
      rows.map((entry) => [entry.id, resolveMovement(entry.row, language, unitPreference)] as const),
    ),
  };
}

export function buildCompletionCardsFromAdaptedSession({
  exercises,
  exerciseTemplates,
  exerciseLibrary,
  exercisePrLookup,
  language,
}: {
  exercises: AdaptedCompletedWorkoutExercise[];
  exerciseTemplates: ExerciseTemplate[];
  exerciseLibrary: ExerciseLibraryItem[];
  exercisePrLookup: ReturnType<typeof buildExercisePrLookup>;
  language: AppLanguage;
}) {
  const templatesById = new Map(exerciseTemplates.map((item) => [item.id, item] as const));
  const libraryById = new Map(exerciseLibrary.map((item) => [item.id, item] as const));

  const exerciseCards: WorkoutCompletionExerciseCard[] = exercises.map((exercise) => {
    const template = exercise.persistedExerciseTemplateId
      ? templatesById.get(exercise.persistedExerciseTemplateId) ?? null
      : null;
    const libraryItem = template?.libraryItemId ? libraryById.get(template.libraryItemId) ?? null : null;
    const completedSets = exercise.sets.filter((set) => set.status === 'completed').length;
    const totalVolumeKg = exercise.sets.reduce((total, set) => {
      if (set.status !== 'completed') {
        return total;
      }
      const weightKg = typeof set.weightKg === 'number' ? set.weightKg : 0;
      const reps = typeof set.reps === 'number' ? set.reps : 0;
      return total + weightKg * reps;
    }, 0);

    return {
      id: exercise.slotId,
      name: exercise.exerciseName,
      imageUrl: libraryItem?.imageKey ?? null,
      completedSets,
      totalSets: Math.max(1, exercise.sets.length),
      totalVolumeKg,
      notes: exercise.notes,
      topSetLabel: getTopSetLabel(exercise.sets, language, exercise.trackingMode),
    };
  });

  const trackedHere = new Set(
    exercises.filter((exercise) => exercise.tracked).map((exercise) => exercise.exerciseName.trim().toLowerCase()),
  );
  const prCards: WorkoutCompletionPrCard[] = exercises
    .map((exercise): WorkoutCompletionPrCard | null => {
      const template = exercise.persistedExerciseTemplateId
        ? templatesById.get(exercise.persistedExerciseTemplateId) ?? null
        : null;
      const libraryItem = template?.libraryItemId ? libraryById.get(template.libraryItemId) ?? null : null;
      const bestSet = heaviestOfSets(recordSetsOfExercise(exercise));

      // A record Records will show, or none: an untracked accessory has no row there.
      if (!bestSet || !announcesRecord(exercisePrLookup, exercise.exerciseName, trackedHere.has(exercise.exerciseName.trim().toLowerCase()))) {
        return null;
      }

      const previousBest = resolvePreviousExercisePr({
        libraryItemId: template?.libraryItemId ?? null,
        exerciseName: exercise.exerciseName,
        lookup: exercisePrLookup,
      });

      // Beaten, not matched: heavier, or the same weight for more reps.
      if (!beatsBest(bestSet, previousBest)) {
        return null;
      }

      return {
        id: `pr:${exercise.slotId}`,
        exerciseName: exercise.exerciseName,
        imageUrl: libraryItem?.imageKey ?? null,
        previousBestWeightKg: previousBest?.weight ?? null,
        previousBestReps: previousBest?.reps ?? null,
        performedWeightKg: bestSet.weight,
        performedReps: bestSet.reps,
      };
    })
    .filter(isWorkoutCompletionPrCard)
    // Strongest first: the hero shows the first card, and the morning-after
    // notification names the strongest by the same rule (findLatestSessionPr)
    // — in exercise order the two could name different lifts for one session
    // (audit round 4, 2026-09-20).
    .sort(
      (left, right) =>
        right.performedWeightKg - left.performedWeightKg || right.performedReps - left.performedReps,
    );

  // Mark the recap rows whose exercise earned a PR this session — every
  // one, not only the three the hero strip has room for.
  const prSlotIds = new Set(prCards.map((card) => card.id.replace(/^pr:/, '')));
  const exerciseCardsWithPr = exerciseCards.map((card) =>
    prSlotIds.has(card.id) ? { ...card, isPr: true } : card,
  );

  return {
    exerciseCards: exerciseCardsWithPr,
    prCards: prCards.slice(0, 3),
  };
}

export function buildExerciseLogsForCompletedSession(sessionId: string, drafts: ExerciseLogDraft[]): ExerciseLog[] {
  return drafts.map((draft, index) => ({
    id: `draft:${sessionId}:${index}`,
    sessionId,
    exerciseTemplateId: draft.exerciseTemplateId,
    exerciseNameSnapshot: draft.exerciseNameSnapshot,
    weight: draft.skipped ? 0 : draft.weight ?? 0,
    repsPerSet: draft.skipped ? [] : draft.repsPerSet ?? [],
    sets: draft.sets,
    tracked: draft.tracked,
    orderIndex: draft.orderIndex,
    skipped: draft.skipped,
    sessionInserted: draft.sessionInserted,
    status: draft.status,
    slotId: draft.slotId,
    templateSlotId: draft.templateSlotId,
    templateExerciseId: draft.templateExerciseId,
    notes: draft.notes,
    swappedFrom: draft.swappedFrom,
    ...(draft.repsUnit === 'minutes' ? { repsUnit: 'minutes' as const } : {}),
    ...(typeof draft.plannedSets === 'number' ? { plannedSets: draft.plannedSets } : {}),
  }));
}
