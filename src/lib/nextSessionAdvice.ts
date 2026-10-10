import type { WorkoutSlotHistoryEntry } from '../features/workout/workoutTypes';
import { ExerciseLog, SetupLevel, WorkoutSession } from '../types/models';
import { SLOT_HISTORY_LIMIT } from './exerciseHistoryLookup';
import { getWorkedLogSets } from './exerciseLog';
import { evaluateProgression } from './progressionGate';
import { normalizedName, sessionTime } from './trainingHistory';
import { toWorkingHistoryEntry } from './warmupSets';

/**
 * What to say about a lift's weight after a session, from the progression
 * gate itself.
 *
 * The post-session analysis and the Pro next-session surfaces used to add the
 * level's step to the top set, or to guess from the reps seen at that weight.
 * Either disagreed with the gate in ordinary cases, both ways: a raise offered
 * where the gate held (reps climbing inside a range, a first session at a new
 * weight, the session after a break), and a hold where it raised. The gate is
 * given the inputs the logger gives it — the lift's sessions of this
 * programme day, and the day's own rep range and set count from the
 * programme — and its answer is the advice (hunt, 2026-10-10).
 *
 * Nothing about a weight when the programme cannot be found (a freestyle
 * workout, a deleted programme): guessing the range is how the old advice went
 * wrong.
 */
export type NextSessionAdvice =
  | { kind: 'raise'; fromKg: number; toKg: number }
  /** The gate holds because the reps fell from last time at this weight. */
  | { kind: 'rebuild_reps'; kg: number }
  | { kind: 'none' };

export const NO_NEXT_SESSION_ADVICE: NextSessionAdvice = { kind: 'none' };

/** The part of a programme's exercise the gate reads. */
export interface AdviceTemplateExercise {
  exerciseName: string;
  slotId: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  trackingMode?: string;
}

export interface AdviceTemplate {
  sessions: ReadonlyArray<{ id: string; exercises: ReadonlyArray<AdviceTemplateExercise> }>;
}

/** The programme a logged session was started from, or null when it is gone. */
export type AdviceTemplateLookup = (templateId: string) => AdviceTemplate | null;

export interface NextSessionAdviceInput {
  /** The lift, by the name it was logged under. */
  liftName: string;
  /** The session the advice follows; the gate reads the history up to it. */
  sessionId: string;
  sessions: readonly WorkoutSession[];
  logs: readonly ExerciseLog[];
  lookupTemplate: AdviceTemplateLookup | null | undefined;
  level: SetupLevel | null | undefined;
}

const SAME_LOAD_KG = 0.001;

/** The programme slot a log was filed under, or null on a log with none. */
function slotOf(log: ExerciseLog): string | null {
  return typeof log.templateSlotId === 'string' && log.templateSlotId.length > 0 ? log.templateSlotId : null;
}

function sameLift(log: ExerciseLog, liftKey: string) {
  return normalizedName(log.exerciseNameSnapshot) === liftKey;
}

/** The sets the gate reads: worked ones with reps, as a slot history entry. */
function entryOf(
  session: WorkoutSession,
  log: ExerciseLog,
  exercise: AdviceTemplateExercise,
): WorkoutSlotHistoryEntry | null {
  const sets = getWorkedLogSets(log)
    .filter((set) => set.reps > 0)
    .map((set, index) => ({
      setIndex: index,
      loadKg: set.weight,
      reps: set.reps,
      completedAt: set.completedAt ?? session.performedAt,
      effort: null,
    }));
  if (sets.length === 0) {
    return null;
  }
  // Read the way the logger reads a slot's history: warm-ups logged as
  // ordinary sets taken out against the programme's own set count.
  return toWorkingHistoryEntry(
    {
      slotId: exercise.slotId,
      templateId: session.workoutTemplateId,
      templateName: session.workoutNameSnapshot,
      exerciseName: log.exerciseNameSnapshot,
      substitutionGroup: '',
      performedAt: session.performedAt,
      sessionId: session.id,
      sets,
      skipped: false,
    },
    exercise.sets,
  );
}

function totalReps(entry: WorkoutSlotHistoryEntry, targetSets: number) {
  return [...entry.sets]
    .sort((left, right) => left.setIndex - right.setIndex)
    .slice(0, Math.max(0, targetSets))
    .reduce((sum, set) => sum + set.reps, 0);
}

function topLoad(entry: WorkoutSlotHistoryEntry, targetSets: number) {
  return [...entry.sets]
    .sort((left, right) => left.setIndex - right.setIndex)
    .slice(0, Math.max(0, targetSets))
    .reduce((max, set) => Math.max(max, set.loadKg), 0);
}

export function buildNextSessionAdvice(input: NextSessionAdviceInput): NextSessionAdvice {
  const { liftName, sessionId, sessions, logs, lookupTemplate, level } = input;
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session || !lookupTemplate || !session.workoutTemplateSessionId) {
    return NO_NEXT_SESSION_ADVICE;
  }
  const template = lookupTemplate(session.workoutTemplateId);
  const day = template?.sessions.find((candidate) => candidate.id === session.workoutTemplateSessionId);
  if (!day) {
    return NO_NEXT_SESSION_ADVICE;
  }

  // The programme's own row for this lift on this day. A log filed under a slot
  // belongs to that slot's row: a lift swapped into a slot has no row of its
  // own there, and the row the same lift has elsewhere that day is not its
  // range. A log with no slot (older ones) is told by the lift's name.
  const liftKey = normalizedName(liftName);
  const rows = day.exercises.filter((exercise) => normalizedName(exercise.exerciseName) === liftKey);
  const currentLog = logs.find((log) => log.sessionId === session.id && sameLift(log, liftKey) && !log.skipped);
  if (!currentLog) {
    return NO_NEXT_SESSION_ADVICE;
  }
  const currentSlot = slotOf(currentLog);
  const exercise = currentSlot ? rows.find((row) => row.slotId === currentSlot) ?? null : rows.length === 1 ? rows[0] : null;
  if (!exercise) {
    return NO_NEXT_SESSION_ADVICE;
  }

  const asOfMs = sessionTime(session);
  const sessionById = new Map(sessions.map((entry) => [entry.id, entry] as const));
  const seen = new Set<string>();
  const entries: WorkoutSlotHistoryEntry[] = [];
  for (const log of logs) {
    const owner = sessionById.get(log.sessionId);
    if (
      !owner ||
      log.skipped ||
      !sameLift(log, liftKey) ||
      // Filed under another slot of the day: that row's history, not this one's.
      (slotOf(log) !== null && slotOf(log) !== exercise.slotId) ||
      seen.has(owner.id) ||
      owner.workoutTemplateId !== session.workoutTemplateId ||
      (owner.workoutTemplateSessionId ?? null) !== session.workoutTemplateSessionId ||
      sessionTime(owner) > asOfMs
    ) {
      continue;
    }
    const entry = entryOf(owner, log, exercise);
    if (entry) {
      seen.add(owner.id);
      entries.push(entry);
    }
  }
  // Newest first; a date that does not parse goes last, and equal times keep
  // the order the logs came in. A NaN in the comparison is no order at all, and
  // the cut below could then drop a real session.
  const ranked = entries.map((entry, index) => {
    const time = Date.parse(entry.performedAt);
    return { entry, index, time, valid: Number.isFinite(time) };
  });
  ranked.sort(
    (left, right) =>
      Number(right.valid) - Number(left.valid) || (left.valid ? right.time - left.time : 0) || left.index - right.index,
  );
  const history = ranked.slice(0, SLOT_HISTORY_LIMIT).map(({ entry }) => entry);

  const decision = evaluateProgression({
    history,
    repsMin: exercise.repsMin,
    repsMax: exercise.repsMax,
    targetSets: exercise.sets,
    level,
    trackingMode: exercise.trackingMode,
    nowMs: asOfMs,
  });

  if (decision.recommendation === 'increase') {
    return { kind: 'raise', fromKg: decision.fromLoadKg, toKg: decision.loadKg };
  }
  if (decision.recommendation === 'hold' && decision.holdReason === 'rep_ceiling_not_reached') {
    // "Get the reps back" is only true of reps that fell: fewer than last time
    // at the same weight. Reps still climbing toward the top of the range, or
    // the same as last time, are not a reason to say so.
    const [latest, previous] = history;
    const fell =
      latest &&
      previous &&
      Math.abs(topLoad(latest, exercise.sets) - topLoad(previous, exercise.sets)) < SAME_LOAD_KG &&
      totalReps(latest, exercise.sets) < totalReps(previous, exercise.sets);
    if (fell) {
      return { kind: 'rebuild_reps', kg: decision.loadKg };
    }
  }
  return NO_NEXT_SESSION_ADVICE;
}
