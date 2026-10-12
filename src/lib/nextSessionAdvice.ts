import type { WorkoutSlotHistoryEntry } from '../features/workout/workoutTypes';
import { isUnloadedTrackingMode, readStoredTrackingMode } from '../features/workout/workoutTypes';
import { ExerciseLog, SetupLevel, WorkoutSession } from '../types/models';
import { SLOT_HISTORY_LIMIT } from './exerciseHistoryLookup';
import { getWorkedLogSets } from './exerciseLog';
import { isFixedDoseExercise } from './intervalScheme';
import { evaluateProgression, isProgressionReadySession, type ProgressionFatigueSignal } from './progressionGate';
import { LiftProgrammeRead, normalizedName, sessionTime } from './trainingHistory';
import { toWorkingHistoryEntry } from './warmupSets';

export type { LiftProgrammeRead };

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
  /** What the row can be swapped for; 'cardio_intervals' marks a fixed dose (isFixedDoseExercise). */
  substitutionGroup?: string;
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
  /**
   * The recovery signal the next start will hand the gate, when the session
   * advised on is the newest one. Left out, recovery reads as clear: right for
   * an older session, whose next start has already happened.
   */
  fatigueSignal?: ProgressionFatigueSignal;
  /**
   * The reader's automatic-progression switch (Settings). Off, the next start
   * repeats last time, so a raise is not advice to give. A Free reader's
   * switch is still on: the analysis and the completion lock sell the raise
   * Pro would make.
   */
  automatedProgressionEnabled: boolean;
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
      // A set the reader added mid-session, as the slot history files it
      // (addedMidSession): the warm-up rule reads the programme's sets alone
      // and the added ones follow as work, so the advice reads the session the
      // way the next start does.
      ...(set.planned?.basis === 'added' ? { addedMidSession: true } : {}),
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
      // A lighter session's count (Q3): the gate measures the entry against
      // it, so the advice agrees with the next start's raise.
      ...(typeof log.plannedSets === 'number' ? { plannedSets: log.plannedSets } : {}),
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

/**
 * The heaviest load among the sets a lighter session left out (it carries
 * plannedSets), each from the newest earlier session that did it; 0 when it
 * left none out.
 */
function leftOutTopKg(history: readonly WorkoutSlotHistoryEntry[], targetSets: number): number {
  const [latest, ...earlier] = history;
  if (!latest || typeof latest.plannedSets !== 'number') {
    return 0;
  }
  let top = 0;
  for (let setIndex = 0; setIndex < targetSets; setIndex += 1) {
    if (latest.sets.some((set) => set.setIndex === setIndex)) {
      continue;
    }
    const own = earlier.map((entry) => entry.sets.find((set) => set.setIndex === setIndex)).find((set) => set !== undefined);
    top = Math.max(top, own?.loadKg ?? 0);
  }
  return top;
}

/** The programme row a lift was logged under, and its history as the gate reads it. */
interface ProgrammeHistory {
  exercise: AdviceTemplateExercise;
  /** Newest first, up to the session asked about. */
  history: WorkoutSlotHistoryEntry[];
  asOfMs: number;
}

type ProgrammeHistoryInput = Pick<NextSessionAdviceInput, 'liftName' | 'sessionId' | 'sessions' | 'logs' | 'lookupTemplate'>;

/**
 * The history the gate reads for this lift at this session: the lift's
 * sessions of this programme day, filed under its row. NO_NEXT_SESSION_ADVICE
 * when there is no row to read it against.
 */
function readProgrammeHistory(input: ProgrammeHistoryInput): ProgrammeHistory | NextSessionAdvice {
  const { liftName, sessionId, sessions, logs, lookupTemplate } = input;
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
  return { exercise, history, asOfMs };
}

export function buildNextSessionAdvice(input: NextSessionAdviceInput): NextSessionAdvice {
  const read = readProgrammeHistory(input);
  if ('kind' in read) {
    return read;
  }
  const { exercise, history, asOfMs } = read;
  // A fixed dose (an interval's seconds, a sprint's metres) is repeated, never
  // raised: the logger opens it as it was, and so does the advice.
  if (isFixedDoseExercise(exercise)) {
    return NO_NEXT_SESSION_ADVICE;
  }

  const decision = evaluateProgression({
    history,
    repsMin: exercise.repsMin,
    repsMax: exercise.repsMax,
    targetSets: exercise.sets,
    level: input.level,
    // The start holds a raise while recovery is elevated or high
    // (programmeStarts passes the same signal): not a raise to promise.
    fatigueSignal: input.fatigueSignal,
    trackingMode: exercise.trackingMode,
    nowMs: asOfMs,
  });

  if (decision.recommendation === 'increase') {
    if (input.automatedProgressionEnabled === false) {
      return NO_NEXT_SESSION_ADVICE;
    }
    // The top set the next start opens: a set a lighter session left out
    // climbs from its own load in the newest earlier session that did it
    // (workoutState missingSetFallback), a pyramid's top among them.
    const fromKg = Math.max(decision.fromLoadKg, leftOutTopKg(history, exercise.sets));
    return { kind: 'raise', fromKg, toKg: fromKg + decision.incrementKg };
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

/**
 * Whether a session is the newest one logged: the only session whose next
 * start is still to come, so the only one the recovery signal of now is
 * about. Ties keep the first in the list.
 */
export function isNewestSession(sessions: readonly WorkoutSession[], sessionId: string | null | undefined): boolean {
  let newest: WorkoutSession | null = null;
  for (const session of sessions) {
    if (!newest || sessionTime(session) > sessionTime(newest)) {
      newest = session;
    }
  }
  return newest !== null && newest.id === sessionId;
}

/**
 * Where a lift stands against its programme row at a session: whether that
 * session reached the row's top reps on every set the row asks for — the
 * gate's own test of a session that earns a raise (isProgressionReadySession)
 * — and the load and reps of the row's working sets in it.
 *
 * A lifter on schedule is not stuck. At the ceiling, reps cannot rise (load
 * and reps lifts never step reps), so a run of sessions with no rep best is
 * what doing exactly what the gate asks looks like, and the gate raises on
 * the third of them at a first weight. The stall surfaces called that session
 * a plateau and asked for a ninth rep on an eight-rep programme (hunt,
 * 2026-10-11).
 *
 * Null when the row cannot be found (a freestyle workout, a deleted
 * programme) or the row is not loaded: there the question has no answer.
 *
 * With the reader's automatic progression off nothing raises on a schedule,
 * so a run at the ceiling is not on one: the coach is told the reps and the
 * weight that has not moved. The stall surfaces leave the switch out (on): a
 * lifter at the ceiling did every rep, which is not a stall either way.
 */
export function readLiftProgramme(
  input: ProgrammeHistoryInput & { automatedProgressionEnabled?: boolean },
): LiftProgrammeRead | null {
  const read = readProgrammeHistory(input);
  if ('kind' in read) {
    return null;
  }
  const { exercise, history } = read;
  const mode = readStoredTrackingMode(exercise.trackingMode);
  if (mode !== null && isUnloadedTrackingMode(mode)) {
    return null;
  }
  const latest = history[0];
  if (!latest || latest.sessionId !== input.sessionId || !(exercise.sets > 0) || !(exercise.repsMax > 0)) {
    return null;
  }
  // The row's own sets, in order: an added set past them is extra work, as
  // the gate reads it (programmedSets).
  const working = [...latest.sets].sort((left, right) => left.setIndex - right.setIndex).slice(0, exercise.sets);
  return {
    onSchedule:
      input.automatedProgressionEnabled !== false && isProgressionReadySession(latest, exercise.repsMax, exercise.sets),
    repsMax: exercise.repsMax,
    workingKg: topLoad(latest, exercise.sets),
    workingReps: working.map((set) => set.reps),
  };
}
