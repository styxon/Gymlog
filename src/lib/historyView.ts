import { ExerciseLog, SessionFeel, WorkoutSession } from '../types/models';
import { getComparableLogSets } from './exerciseLog';
import { heaviestOfSets } from './personalRecords';
import { getSessionTotals } from './sessionTotals';

type HistoryFilter = 'all' | 'needs_review' | 'tracked';

export interface HistorySessionViewModel {
  sessionId: string;
  workoutName: string;
  performedAt: string;
  durationMinutes: number | null;
  exerciseCount: number;
  skippedExercises: number;
  trackedExercises: number;
  setsCompleted: number;
  totalVolume: number;
  topLiftName: string | null;
  topLiftWeightKg: number | null;
  swappedExercises: number;
  noteCount: number;
  sessionInsertedExercises: number;
  partialExercises: number;
  legacyMismatchCount: number;
  /**
   * The reader's own one-word verdict, or null when they were never asked or
   * skipped the question. Null stays null all the way to the row: an
   * unanswered session gets no colour, because a neutral colour would read as
   * "this one was fine".
   */
  feel: SessionFeel | null;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

export function buildHistorySessionViewModel(
  session: WorkoutSession,
  logs: ExerciseLog[],
): HistorySessionViewModel {
  const skippedExercises = logs.filter((log) => log.skipped).length;
  const trackedExercises = logs.filter((log) => log.tracked && !log.skipped).length;
  const swappedExercises =
    typeof session.exercisesSwapped === 'number'
      ? session.exercisesSwapped
      : logs.filter((log) => Boolean(log.swappedFrom)).length;
  const noteCount =
    typeof session.noteCount === 'number' ? session.noteCount : logs.filter((log) => Boolean(log.notes)).length;
  const sessionInsertedExercises =
    typeof session.sessionInsertedCount === 'number'
      ? session.sessionInsertedCount
      : logs.filter((log) => log.sessionInserted === true).length;
  const partialExercises = logs.filter((log) => log.status === 'active').length;
  const legacyMismatchCount = Array.isArray(session.legacyShapeMismatches) ? session.legacyShapeMismatches.length : 0;
  const durationMinutes =
    typeof session.durationMinutes === 'number'
      ? session.durationMinutes
      : typeof session.startedAt === 'string'
        ? Math.max(
            1,
            Math.round((new Date(session.performedAt).getTime() - new Date(session.startedAt).getTime()) / 60000) || 1,
          )
        : null;

  // Each log's top set by the records rule (heaviestOfSets), read once: a
  // 100 kg row with no reps is no top weight here either, as on Records and
  // the lift curve (duplicate sweep, 2026-10-12).
  let topLog: ExerciseLog | null = null;
  let topLiftWeightKg: number | null = null;
  for (const log of logs) {
    const top = log.skipped ? null : heaviestOfSets(getComparableLogSets(log));
    if (top && (topLiftWeightKg === null || top.weight > topLiftWeightKg)) {
      topLog = log;
      topLiftWeightKg = top.weight;
    }
  }
  const totals = getSessionTotals(logs);

  return {
    sessionId: session.id,
    workoutName: session.workoutNameSnapshot,
    performedAt: session.performedAt,
    durationMinutes,
    // The lifts done, by the rule the completion screen counts them with; a
    // skipped one is listed as skipped beside it, not counted twice. This
    // said "every log not skipped", which counted a lift swapped and never
    // started as one done.
    exerciseCount: totals.exercisesCompleted,
    skippedExercises,
    trackedExercises,
    setsCompleted: totals.setsCompleted,
    totalVolume: totals.totalVolumeKg,
    topLiftName: topLog?.exerciseNameSnapshot ?? null,
    topLiftWeightKg,
    swappedExercises,
    noteCount,
    sessionInsertedExercises,
    partialExercises,
    legacyMismatchCount,
    feel: session.feel ?? null,
  };
}

export function filterHistorySessionViewModels(
  sessions: HistorySessionViewModel[],
  options: { query: string; filter: HistoryFilter },
) {
  const normalizedQuery = normalizeText(options.query);

  return sessions.filter((session) => {
    const skippedExercises = session.skippedExercises ?? 0;
    const partialExercises = session.partialExercises ?? 0;
    const legacyMismatchCount = session.legacyMismatchCount ?? 0;
    const trackedExercises = session.trackedExercises ?? 0;

    if (
      options.filter === 'needs_review' &&
      skippedExercises === 0 &&
      partialExercises === 0 &&
      legacyMismatchCount === 0
    ) {
      return false;
    }

    if (options.filter === 'tracked' && trackedExercises === 0) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return normalizeText(`${session.workoutName} ${session.topLiftName ?? ''}`).includes(normalizedQuery);
  });
}
