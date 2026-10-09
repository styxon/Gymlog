import { WeightedSet, beatsBest, heaviestOfSets, recordSetsOfLog } from './personalRecords';
import { ExerciseLog, ExerciseTemplate, WorkoutSession } from '../types/models';

export interface WorkoutCompletionExerciseCard {
  id: string;
  name: string;
  imageUrl?: string | null;
  completedSets: number;
  totalSets: number;
  totalVolumeKg: number;
  notes?: string | null;
  /** Heaviest logged set, e.g. "60 × 8" (Workout Complete recap). */
  topSetLabel?: string | null;
  /** True when this exercise produced a PR in the finished session. */
  isPr?: boolean;
}

export interface WorkoutCompletionPrCard {
  id: string;
  exerciseName: string;
  imageUrl?: string | null;
  /** The heaviest weight this lift carried before today's session, or null on its first-ever log. */
  previousBestWeightKg: number | null;
  /** The reps of that best set: a record at the same weight beat it on reps. */
  previousBestReps: number | null;
  performedWeightKg: number;
  performedReps: number;
}

/** Each lift's best set so far — its weight, and the reps that break a tie at that weight. */
export interface ExercisePrLookup {
  byLibraryItemId: Record<string, WeightedSet>;
  byName: Record<string, WeightedSet>;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

/**
 * An estimated one-rep max (Epley), for the exercise sheet's "EST. 1RM"
 * figure — a number the sheet shows AS an estimate. Not used to declare a
 * record anywhere: a record is the heaviest weight actually lifted
 * (`heaviestOfSets`), decided 2026-09-26 after the completion screen and the
 * Records tab disagreed about whether 80 kg × 10 beat a 100 kg × 1 best.
 */
export function estimateOneRepMaxKg(weightKg: number, reps: number) {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || !Number.isFinite(reps) || reps <= 0) {
    return null;
  }

  if (reps <= 1) {
    return weightKg;
  }

  return weightKg * (1 + reps / 30);
}

/**
 * Every lift's heaviest weight ever logged, by name and by library item —
 * the same rule the Records tab uses (`heaviestOfSets`), so a "new PR" here
 * and a new row there can never disagree about what counts as one.
 */
export function buildExercisePrLookup({
  exerciseLogs,
  workoutSessions,
  exerciseTemplates,
}: {
  exerciseLogs: ExerciseLog[];
  workoutSessions: WorkoutSession[];
  exerciseTemplates: ExerciseTemplate[];
}): ExercisePrLookup {
  const sessionsById = new Map(workoutSessions.map((session) => [session.id, session] as const));
  const templatesById = new Map(exerciseTemplates.map((exercise) => [exercise.id, exercise] as const));

  const bestByLibraryItemId = new Map<string, WeightedSet>();
  const bestByName = new Map<string, WeightedSet>();

  exerciseLogs.forEach((log) => {
    const session = sessionsById.get(log.sessionId);
    if (!session) {
      return;
    }

    // The sets a record reads: none for minutes (a level in the kg dial is not
    // a load) or a hold, so the prior best here is the Records tab's.
    const topSet = heaviestOfSets(recordSetsOfLog(log));
    if (!topSet) {
      return;
    }
    const best: WeightedSet = { weight: topSet.weight, reps: topSet.reps };

    const normalizedName = normalize(log.exerciseNameSnapshot);
    if (beatsBest(best, bestByName.get(normalizedName) ?? null)) {
      bestByName.set(normalizedName, best);
    }

    const template = log.exerciseTemplateId ? templatesById.get(log.exerciseTemplateId) ?? null : null;
    if (template?.libraryItemId && beatsBest(best, bestByLibraryItemId.get(template.libraryItemId) ?? null)) {
      bestByLibraryItemId.set(template.libraryItemId, best);
    }
  });

  return {
    byLibraryItemId: Object.fromEntries(bestByLibraryItemId),
    byName: Object.fromEntries(bestByName),
  };
}

/**
 * The records as they stood before the workout stored under `sessionId`: a workout finished again
 * under its own id (a restored session, a board carried on after its save) has its earlier version
 * in the database, and against it the same sets were their own previous best — no record cards.
 * `full` is returned when the database holds no such workout, so the common finish rebuilds nothing.
 */
export function buildExercisePrLookupBefore(
  tables: { exerciseLogs: ExerciseLog[]; workoutSessions: WorkoutSession[]; exerciseTemplates: ExerciseTemplate[] },
  sessionId: string | null | undefined,
  full: ExercisePrLookup,
): ExercisePrLookup {
  if (!sessionId || !tables.workoutSessions.some((session) => session.id === sessionId)) {
    return full;
  }
  return buildExercisePrLookup({
    exerciseLogs: tables.exerciseLogs.filter((log) => log.sessionId !== sessionId),
    workoutSessions: tables.workoutSessions.filter((session) => session.id !== sessionId),
    exerciseTemplates: tables.exerciseTemplates,
  });
}

export interface LatestSessionPr {
  exerciseName: string;
  weightKg: number;
  reps: number;
  /** performedAt of the session the record was set in, epoch ms. */
  achievedAtMs: number;
}

/**
 * The strongest personal record in the most recently performed session, or null
 * when it produced none. Feeds the morning-after record notification.
 *
 * Unlike the completion screen this ignores first-ever entries: calling the
 * first log of an exercise a "record" is technically true and practically
 * hollow, so a previous best has to exist for it to count here.
 *
 * "Strongest" and "record" both mean heaviest weight lifted, the same rule
 * `buildExercisePrLookup` and the Records tab use — so the morning notification
 * can never name a lift the completion screen or the Records tab would not
 * also call a record.
 */
export function findLatestSessionPr({
  workoutSessions,
  exerciseLogs,
  exerciseTemplates,
}: {
  workoutSessions: WorkoutSession[];
  exerciseLogs: ExerciseLog[];
  exerciseTemplates: ExerciseTemplate[];
}): LatestSessionPr | null {
  let latestSession: WorkoutSession | null = null;
  let latestAtMs = Number.NEGATIVE_INFINITY;
  for (const session of workoutSessions) {
    const performedAt = new Date(session.performedAt).getTime();
    if (Number.isFinite(performedAt) && performedAt > latestAtMs) {
      latestSession = session;
      latestAtMs = performedAt;
    }
  }

  if (!latestSession) {
    return null;
  }
  const latest = latestSession;

  const priorLookup = buildExercisePrLookup({
    exerciseLogs: exerciseLogs.filter((log) => log.sessionId !== latest.id),
    workoutSessions: workoutSessions.filter((session) => session.id !== latest.id),
    exerciseTemplates,
  });

  const templatesById = new Map(exerciseTemplates.map((exercise) => [exercise.id, exercise] as const));
  const candidates: LatestSessionPr[] = [];

  exerciseLogs
    .filter((log) => log.sessionId === latest.id)
    .forEach((log) => {
      const template = log.exerciseTemplateId ? templatesById.get(log.exerciseTemplateId) ?? null : null;
      const previousBest = resolvePreviousExercisePr({
        libraryItemId: template?.libraryItemId ?? null,
        exerciseName: log.exerciseNameSnapshot,
        lookup: priorLookup,
      });

      if (previousBest === null) {
        return;
      }

      // The log's own best set is the only one that can beat the prior best
      // — any other set in the same log is, by the same rule, no better.
      const topSet = heaviestOfSets(recordSetsOfLog(log));
      if (!topSet || !beatsBest(topSet, previousBest)) {
        return;
      }
      candidates.push({
        exerciseName: log.exerciseNameSnapshot,
        weightKg: topSet.weight,
        reps: topSet.reps,
        achievedAtMs: latestAtMs,
      });
    });

  if (candidates.length === 0) {
    return null;
  }

  const best = candidates.reduce((strongest, candidate) =>
    beatsBest(
      { weight: candidate.weightKg, reps: candidate.reps },
      { weight: strongest.weightKg, reps: strongest.reps },
    )
      ? candidate
      : strongest,
  );

  return {
    exerciseName: best.exerciseName,
    weightKg: best.weightKg,
    reps: best.reps,
    achievedAtMs: best.achievedAtMs,
  };
}

export function resolvePreviousExercisePr({
  libraryItemId,
  exerciseName,
  lookup,
}: {
  libraryItemId?: string | null;
  exerciseName: string;
  lookup: ExercisePrLookup;
}): WeightedSet | null {
  // The better of the two, never the library row's alone. A free-workout set
  // is saved with no template, so it reaches only the name index: bench at
  // 100 kg there and 80 kg in a programme had the programme answer 93 and a
  // 90 kg set earn a "new record" card, every time, below the real best.
  const byLibrary = libraryItemId ? lookup.byLibraryItemId[libraryItemId] : undefined;
  const normalizedName = normalize(exerciseName);
  const byName = normalizedName ? lookup.byName[normalizedName] : undefined;
  let best: WeightedSet | null = null;
  for (const value of [byLibrary, byName]) {
    if (value && Number.isFinite(value.weight) && Number.isFinite(value.reps) && beatsBest(value, best)) {
      best = value;
    }
  }
  return best;
}
