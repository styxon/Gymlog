import { createId } from '../lib/ids';
import { normalizeExerciseLogDraft } from '../lib/exerciseLog';
import { mergeStoredBoardLogs, mergeStoredWorkoutLogs, resolveFreestyleSaveTarget, sameSavedLogs } from '../lib/emptyWorkoutSession';
import { getSessionTotals } from '../lib/sessionTotals';
import { exerciseLogRepository, workoutSessionRepository } from '../storage/repositories';
import { AppDatabase, ExerciseLog, ExerciseLogDraft, WorkoutSession } from '../types/models';

export interface SessionSaveSummary {
  sessionId: string | null;
  performedAt: string | null;
  exercisesLogged: number;
  trackedExercisesUpdated: number;
  exercisesSwapped: number;
  notesSaved: number;
  sessionInsertedExercises: number;
  entriesSaved: number;
  setsCompleted: number;
  totalVolume: number;
  /**
   * Exercises done, by lib/sessionTotals' rule — what History will say about
   * this session, so the completion screen can say the same.
   */
  exercisesCompleted: number;
  durationMinutes: number;
  /**
   * Set by the save provider from the result's wasStored: the workout was already stored when this
   * save ran, so the caller does not count it again (see PersistCompletedWorkoutResult).
   */
  wasStored?: boolean;
}

export interface PersistCompletedWorkoutInput {
  sessionId: string;
  workoutTemplateId: string;
  workoutTemplateSessionId?: string | null;
  workoutNameSnapshot: string;
  logs: ExerciseLogDraft[];
  startedAt?: string;
  performedAt?: string;
  /**
   * The session's own count, pauses taken off, when the caller has one. Absent
   * falls back to finish minus start, which is right only for a workout that
   * was never paused.
   */
  durationMinutes?: number;
  legacyShapeMismatches?: string[];
  /**
   * The stored workout under this id is this one, finished again (resolveGuidedSaveTarget): these
   * logs are merged with its rows (mergeStoredWorkoutLogs) and the merge replaces them, instead of
   * the save being dropped as a duplicate or filed beside it. What the reader added to the stored
   * row afterwards (a note, a rename, the feel) stays.
   */
  mergeStored?: boolean;
  /**
   * How the merge tells a set: by the moment it was logged (a guided session, the default), or by
   * its place on a free workout board, whose sets carry no moment of their own (mergeStoredBoardLogs).
   */
  mergeBy?: 'moment' | 'place';
  /** The moments of the sets taken back in the session, for the merge (WorkoutSessionRuntime.takenBackAt). */
  takenBackAt?: string[];
}

export interface PersistCompletedWorkoutResult {
  database: AppDatabase;
  didPersist: boolean;
  summary: SessionSaveSummary;
  /**
   * The workout was already stored when this save ran: the same finish again, a stored workout
   * finished again and merged with it, or the same sets found under the id the write walked to. It
   * was counted (analytics) when it first landed, so the caller does not count it again. Absent:
   * this save wrote a workout of its own.
   */
  wasStored?: boolean;
}

/** The pure result of building one completed workout: no database involved. */
export interface CompletedWorkoutRecord {
  session: WorkoutSession;
  logs: ExerciseLog[];
  summary: SessionSaveSummary;
}

export interface BatchImportResult {
  database: AppDatabase;
  imported: number;
  /** Workouts whose id is already in the history. */
  duplicates: number;
  /**
   * The inputs' session ids the returned database holds — written now or
   * already there — so what is filed elsewhere (the workout store's "last
   * time") names only sessions History has.
   */
  sessionIds: string[];
  /** Workouts with nothing loggable left in them: never in the history, so not "already there". */
  skipped: number;
}

function createEmptySummary(): SessionSaveSummary {
  return {
    sessionId: null,
    performedAt: null,
    exercisesLogged: 0,
    trackedExercisesUpdated: 0,
    exercisesSwapped: 0,
    notesSaved: 0,
    sessionInsertedExercises: 0,
    entriesSaved: 0,
    setsCompleted: 0,
    totalVolume: 0,
    exercisesCompleted: 0,
    durationMinutes: 0,
  };
}

function sortLogDrafts(logs: ExerciseLogDraft[]) {
  return logs
    .map((log, index) => ({ log, index }))
    .sort((left, right) => left.log.orderIndex - right.log.orderIndex || left.index - right.index)
    .map(({ log }) => log);
}

function buildPersistedLogs(
  sessionId: string,
  logs: ExerciseLogDraft[],
  createIdFn: (prefix: string) => string,
): ExerciseLog[] {
  return sortLogDrafts(logs)
    .map((log) => normalizeExerciseLogDraft(log))
    .filter(
      (log) =>
        log.skipped ||
        log.sets.length > 0 ||
        Boolean(log.notes) ||
        Boolean(log.swappedFrom) ||
        log.sessionInserted === true,
    )
    .map((log) => ({
      id: createIdFn('log'),
      sessionId,
      exerciseTemplateId: log.exerciseTemplateId,
      exerciseNameSnapshot: log.exerciseNameSnapshot,
      weight: log.skipped ? 0 : log.weight ?? 0,
      repsPerSet: log.skipped ? [] : log.repsPerSet ?? [],
      sets: log.sets,
      tracked: log.tracked,
      orderIndex: log.orderIndex,
      skipped: log.skipped,
      sessionInserted: log.sessionInserted === true,
      status: log.status ?? (log.skipped ? 'skipped' : 'completed'),
      slotId: log.slotId ?? null,
      templateSlotId: log.templateSlotId ?? null,
      templateExerciseId: log.templateExerciseId ?? null,
      notes: log.notes ?? null,
      swappedFrom: log.swappedFrom ?? null,
      ...(log.repsUnit === 'minutes' ? { repsUnit: 'minutes' as const } : {}),
    }));
}

function buildSummary(
  input: PersistCompletedWorkoutInput,
  logsToPersist: ExerciseLog[],
  performedAt: string,
): SessionSaveSummary {
  const startTime = input.startedAt ? new Date(input.startedAt).getTime() : new Date(performedAt).getTime();
  const durationMinutes =
    typeof input.durationMinutes === 'number' && Number.isFinite(input.durationMinutes) && input.durationMinutes > 0
      ? Math.max(1, Math.round(input.durationMinutes))
      : Math.max(1, Math.round((new Date(performedAt).getTime() - startTime) / 60000) || 1);
  // The same reading the loader takes of every stored session, so the row
  // written now and the row read back on the next launch cannot differ.
  const totals = getSessionTotals(logsToPersist);

  return {
    sessionId: input.sessionId,
    performedAt,
    exercisesLogged: logsToPersist.length,
    trackedExercisesUpdated: logsToPersist.filter((log) => log.tracked && !log.skipped).length,
    exercisesSwapped: logsToPersist.filter((log) => Boolean(log.swappedFrom)).length,
    notesSaved: logsToPersist.filter((log) => Boolean(log.notes)).length,
    sessionInsertedExercises: logsToPersist.filter((log) => log.sessionInserted === true).length,
    entriesSaved: logsToPersist.length,
    setsCompleted: totals.setsCompleted,
    totalVolume: totals.totalVolumeKg,
    exercisesCompleted: totals.exercisesCompleted,
    durationMinutes,
  };
}

/**
 * The pure half of persisting a completed workout: the session row and its
 * logs, built from the input alone. No database in, none out — so a caller
 * writing many of these does not have to hand back a growing database just to
 * get the next one built.
 *
 * Null when there is nothing worth a row: `persistCompletedWorkoutSessionToDatabase`
 * reads this as "didn't persist", same as it always has.
 */
export function buildCompletedWorkoutRecord(
  input: PersistCompletedWorkoutInput,
  createIdFn: (prefix: string) => string = createId,
): CompletedWorkoutRecord | null {
  const performedAt = input.performedAt ?? new Date().toISOString();
  const logsToPersist = buildPersistedLogs(input.sessionId, input.logs, createIdFn);

  if (logsToPersist.length === 0) {
    return null;
  }

  const summary = buildSummary(input, logsToPersist, performedAt);
  const session = {
    id: input.sessionId,
    workoutTemplateId: input.workoutTemplateId,
    workoutTemplateSessionId: input.workoutTemplateSessionId ?? null,
    workoutNameSnapshot: input.workoutNameSnapshot,
    sessionNotes: null,
    performedAt,
    startedAt: input.startedAt ?? performedAt,
    completedAt: performedAt,
    durationMinutes: summary.durationMinutes,
    setsCompleted: summary.setsCompleted,
    // Not `status === 'completed'`: a lift swapped and then done keeps its
    // swapped status, and one left with a set still pending stays active.
    // Both were done.
    exercisesCompleted: summary.exercisesCompleted,
    exercisesSkipped: logsToPersist.filter((log) => log.skipped === true || log.status === 'skipped').length,
    exercisesSwapped: summary.exercisesSwapped,
    totalVolumeKg: summary.totalVolume,
    trackedExercisesUpdated: summary.trackedExercisesUpdated,
    noteCount: summary.notesSaved,
    sessionInsertedCount: summary.sessionInsertedExercises,
    legacyShapeMismatches: Array.isArray(input.legacyShapeMismatches) ? input.legacyShapeMismatches : [],
  };

  return { session, logs: logsToPersist, summary };
}

export function persistCompletedWorkoutSessionToDatabase(
  database: AppDatabase,
  input: PersistCompletedWorkoutInput,
  createIdFn: (prefix: string) => string = createId,
): PersistCompletedWorkoutResult {
  const record = buildCompletedWorkoutRecord(input, createIdFn);
  if (!record) {
    return {
      database,
      didPersist: false,
      summary: createEmptySummary(),
    };
  }

  const stored = workoutSessionRepository.findById(database, input.sessionId);
  if (stored && input.mergeStored) {
    // Merged with the database this write writes, not the one the caller decided on: a set stored
    // in between is kept all the same.
    const storedLogs = database.exerciseLogs.filter((log) => log.sessionId === input.sessionId);
    const merged = buildCompletedWorkoutRecord(
      {
        ...input,
        logs:
          input.mergeBy === 'place'
            ? mergeStoredBoardLogs(storedLogs, input.logs)
            : mergeStoredWorkoutLogs(storedLogs, input.logs, input.takenBackAt ?? []),
      },
      createIdFn,
    );
    if (!merged) {
      return { database, didPersist: false, summary: createEmptySummary() };
    }
    // Nothing to write only when the merge is the stored rows field for field: a note, an effort or
    // an inserted lift is written, not reported as saved and dropped.
    if (sameSavedLogs(storedLogs, merged.logs)) {
      return { database, didPersist: false, summary: merged.summary, wasStored: true };
    }
    const replaced: WorkoutSession = {
      ...merged.session,
      workoutNameSnapshot: stored.workoutNameSnapshot,
      sessionNotes: stored.sessionNotes ?? null,
      ...(stored.feel !== undefined ? { feel: stored.feel } : {}),
    };
    const without: AppDatabase = {
      ...database,
      workoutSessions: database.workoutSessions.map((session) => (session.id === input.sessionId ? replaced : session)),
      exerciseLogs: database.exerciseLogs.filter((log) => log.sessionId !== input.sessionId),
    };
    return {
      database: exerciseLogRepository.appendMany(without, merged.logs),
      didPersist: true,
      summary: merged.summary,
      wasStored: true,
    };
  }
  if (stored) {
    // The id names a stored workout and the caller did not say it is this one. The same finish again
    // is already saved, and any other is a workout of its own under the id resolveFreestyleSaveTarget
    // walks to. Dropping it as a duplicate (what a taken id used to mean) reported a save that did
    // not happen once the stored sets and these differed. The summary names the id they landed under,
    // which the caller takes over.
    const target = resolveFreestyleSaveTarget(database, input.sessionId, input.logs);
    const own =
      target.sessionId === input.sessionId
        ? record
        : buildCompletedWorkoutRecord({ ...input, sessionId: target.sessionId, mergeStored: false }, createIdFn);
    if (!own) {
      return { database, didPersist: false, summary: createEmptySummary() };
    }
    if (target.alreadySaved) {
      return { database, didPersist: false, summary: own.summary, wasStored: true };
    }
    return {
      database: exerciseLogRepository.appendMany(workoutSessionRepository.append(database, own.session), own.logs),
      didPersist: true,
      summary: own.summary,
    };
  }

  let nextDatabase = workoutSessionRepository.append(database, record.session);
  nextDatabase = exerciseLogRepository.appendMany(nextDatabase, record.logs);

  return {
    database: nextDatabase,
    didPersist: true,
    summary: record.summary,
  };
}

/**
 * Many completed workouts, applied to the database in one pass and one write.
 *
 * Calling `persistCompletedWorkoutSessionToDatabase` once per workout, each
 * time handing back the just-grown database for the next call, re-copies the
 * session and log arrays and linear-scans them for a duplicate on every
 * workout — fine for one, quadratic for a multi-year history import (Hevy,
 * 1000+ workouts) that froze the app (#bugs). This builds every new session
 * and its logs against a Set of ids instead of a growing database, then
 * writes once. Same duplicate counting, same per-workout shape, one commit —
 * so a caller's success message still follows one resolved write, not the
 * last of many. A workout with nothing loggable is counted as skipped: it
 * used to be counted as a duplicate, and the toast then said it "already
 * existed" about a workout that was never in the app.
 */
export function persistCompletedWorkoutSessionsToDatabase(
  database: AppDatabase,
  inputs: readonly PersistCompletedWorkoutInput[],
  createIdFn: (prefix: string) => string = createId,
): BatchImportResult {
  const seenSessionIds = new Set(database.workoutSessions.map((session) => session.id));
  const newSessions: WorkoutSession[] = [];
  const newLogs: ExerciseLog[] = [];
  const sessionIds: string[] = [];
  let imported = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const input of inputs) {
    if (seenSessionIds.has(input.sessionId)) {
      duplicates += 1;
      sessionIds.push(input.sessionId);
      continue;
    }
    const record = buildCompletedWorkoutRecord(input, createIdFn);
    if (!record) {
      skipped += 1;
      continue;
    }
    seenSessionIds.add(input.sessionId);
    sessionIds.push(input.sessionId);
    newSessions.push(record.session);
    newLogs.push(...record.logs);
    imported += 1;
  }

  if (newSessions.length === 0) {
    return { database, imported, duplicates, sessionIds, skipped };
  }

  let nextDatabase = workoutSessionRepository.appendMany(database, newSessions);
  nextDatabase = exerciseLogRepository.appendMany(nextDatabase, newLogs);

  return { database: nextDatabase, imported, duplicates, sessionIds, skipped };
}
