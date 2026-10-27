import { calendarDaysBetween, getRollingWindowStart } from './completedSessions';
import { logRecordsSwap } from './exerciseLog';
import { formatWeight } from './format';
import { WeightedSet, beatsBest, heaviestOfSets, recordSetsOfLog } from './personalRecords';
import { PLATEAU_STALL_SESSIONS } from './proInsights';
import { buildLiftHistories } from './trainingHistory';
import { ExerciseLog, PostSessionInsightType, UnitPreference, WorkoutSession } from '../types/models';

type InsightType = PostSessionInsightType;

export interface PostSessionInsight {
  type: InsightType;
  message: string;
  confidence: number;
  exerciseKey?: string;
}

interface PostSessionInsightInput {
  completedSession: Pick<WorkoutSession, 'id' | 'performedAt' | 'totalVolumeKg' | 'setsCompleted'>;
  sessionExerciseLogs: ExerciseLog[];
  allPriorSessions: Pick<WorkoutSession, 'id' | 'performedAt' | 'totalVolumeKg' | 'setsCompleted'>[];
  allPriorExerciseLogs: ExerciseLog[];
  lastInsightSessionId: string | null;
  lastInsightType: InsightType | null;
  unitPreference: UnitPreference;
}

interface TopSet {
  exerciseKey: string;
  exerciseName: string;
  sessionId: string;
  weight: number;
  reps: number;
}

interface Candidate extends PostSessionInsight {
  priority: number;
}

const CONFIDENCE_THRESHOLD = 0.75;

function getExerciseKey(log: ExerciseLog) {
  return log.exerciseTemplateId || log.templateExerciseId || null;
}

/** Whether a log is this slot's lift, done: not skipped, and not a swap read under the slot's key. */
function isOwnLiftLog(log: ExerciseLog) {
  // A swapped-in lift is keyed by the slot's template exercise below, which
  // is the programmed lift's key: a leg press would be read as that squat's
  // session. The player's swap was already kept out by its status; a swap
  // made on Home before the start finishes as `completed`, and says it was a
  // swap only here.
  return !(log.skipped || log.status === 'skipped' || log.status === 'swapped' || logRecordsSwap(log));
}

/**
 * The sets that stand for the lift, as the records read them
 * (personalRecords.recordSetsOfLog): done ones only, warm-ups out, no minutes
 * or holds. This read the set rows itself and took a pending row — a
 * prefilled target never ticked — as work done.
 */
function getCompletedWorkingSets(log: ExerciseLog): WeightedSet[] {
  if (!isOwnLiftLog(log)) {
    return [];
  }
  return recordSetsOfLog(log).filter((set) => set.weight > 0 && set.reps > 0);
}

/**
 * Each log's top set by the records rule (heaviestOfSets): heaviest, then more
 * reps. It scored weight × reps, so 80 × 12 after 100 × 5 was "a new high" the
 * Records tab and the PR cards on the same screen did not see (duplicate
 * sweep, 2026-10-12).
 */
function getTopSets(logs: ExerciseLog[]): TopSet[] {
  return logs
    .map((log) => {
      const exerciseKey = getExerciseKey(log);
      if (!exerciseKey) {
        return null;
      }

      const best = heaviestOfSets(getCompletedWorkingSets(log));
      if (!best) {
        return null;
      }

      return {
        exerciseKey,
        exerciseName: log.exerciseNameSnapshot,
        sessionId: log.sessionId,
        weight: best.weight,
        reps: best.reps,
      };
    })
    .filter((set): set is TopSet => Boolean(set));
}

function getTrackedTopSets(logs: ExerciseLog[]): TopSet[] {
  return getTopSets(logs.filter((log) => log.tracked));
}

function getSessionCompletionRate(logs: ExerciseLog[]) {
  let total = 0;
  let completed = 0;

  for (const log of logs) {
    if (!log.tracked) {
      continue;
    }

    const sets =
      Array.isArray(log.sets) && log.sets.length > 0
        ? log.sets.filter((set) => set.kind === 'working')
        : (log.repsPerSet ?? []).map((reps, orderIndex) => ({
            orderIndex,
            weight: log.weight,
            reps,
            kind: 'working' as const,
            outcome: 'completed' as const,
          }));

    total += sets.length;
    completed += sets.filter((set) => {
      const status = 'status' in set ? set.status : undefined;
      return (
        set.outcome !== 'failed' &&
        set.outcome !== 'skipped' &&
        status !== 'skipped' &&
        set.weight > 0 &&
        set.reps > 0
      );
    }).length;
  }

  return total > 0 ? completed / total : 0;
}

function getPriorSessionsBefore(input: PostSessionInsightInput) {
  const completedAt = new Date(input.completedSession.performedAt).getTime();
  return input.allPriorSessions
    .filter((session) => new Date(session.performedAt).getTime() < completedAt)
    .sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime());
}

/**
 * Today's best against the best before it, by the rule the Records tab and the
 * finish screen's PR cards use (heaviestOfSets + beatsBest): heavier, or the
 * same weight for more reps. Every earlier log of the lift counts, tracked or
 * not, as it does on Records.
 */
function evaluatePersonalRecord(input: PostSessionInsightInput): Candidate | null {
  const currentTopSets = getTrackedTopSets(input.sessionExerciseLogs);
  const priorTopSets = getTopSets(input.allPriorExerciseLogs);
  const seen = new Set<string>();

  for (const first of currentTopSets) {
    if (seen.has(first.exerciseKey)) {
      continue;
    }
    seen.add(first.exerciseKey);
    // A lift logged twice today is one session: its best of the day.
    const current = heaviestOfSets(currentTopSets.filter((set) => set.exerciseKey === first.exerciseKey));
    const prior = priorTopSets.filter((set) => set.exerciseKey === first.exerciseKey);
    if (!current || prior.length < 2) {
      continue;
    }

    const priorBest = heaviestOfSets(prior);
    if (!priorBest || !beatsBest(current, priorBest)) {
      continue;
    }

    if (current.weight === priorBest.weight) {
      return {
        type: 'personal_record',
        message: `New best on ${current.exerciseName}: ${formatWeight(current.weight, input.unitPreference)} for ${current.reps} reps.`,
        confidence: 0.85,
        exerciseKey: current.exerciseKey,
        priority: 1,
      };
    }

    return {
      type: 'personal_record',
      message: `${current.exerciseName} hit a new high today: ${formatWeight(current.weight, input.unitPreference)} for ${current.reps} reps.`,
      confidence: 1,
      exerciseKey: current.exerciseKey,
      priority: 1,
    };
  }

  return null;
}

/**
 * The stall count Home's plateau card and the coach read (trainingHistory
 * stalledSessions): sessions at the latest top weight since the last one that
 * gained a rep, on the top set or per set. This walked its own run of equal
 * top weights with no rep check, and called a lift whose weakest set climbed
 * 8/8/6 -> 8/8/7 -> 8/8/8 "at 60 kg for three sessions" (duplicate sweep,
 * 2026-10-12).
 */
function evaluatePlateauDetected(input: PostSessionInsightInput, priorSessions: ReturnType<typeof getPriorSessionsBefore>): Candidate | null {
  const currentTopSets = getTrackedTopSets(input.sessionExerciseLogs);
  const sessions = [...priorSessions, input.completedSession];
  const sessionIds = new Set(sessions.map((session) => session.id));
  const candidateLogs = [...input.allPriorExerciseLogs, ...input.sessionExerciseLogs].filter(
    (log) => sessionIds.has(log.sessionId) && isOwnLiftLog(log),
  );
  const seen = new Set<string>();

  for (const current of currentTopSets) {
    if (seen.has(current.exerciseKey)) {
      continue;
    }
    seen.add(current.exerciseKey);
    // One lift under one name: the logs of this slot's key, whatever each was
    // called that day, so a renamed row is still one history.
    const lift = buildLiftHistories(
      sessions,
      candidateLogs
        .filter((log) => getExerciseKey(log) === current.exerciseKey)
        .map((log) => ({ ...log, exerciseNameSnapshot: current.exerciseName })),
    )[0];
    if (!lift || lift.latest.sessionId !== input.completedSession.id || lift.stalledSessions < PLATEAU_STALL_SESSIONS) {
      continue;
    }

    return {
      type: 'plateau_detected',
      message: `${current.exerciseName} has been at ${formatWeight(lift.latest.topSetWeightKg, input.unitPreference)} for three sessions.`,
      confidence: lift.stalledSessions === PLATEAU_STALL_SESSIONS ? 0.9 : 0.8,
      exerciseKey: current.exerciseKey,
      priority: 2,
    };
  }

  return null;
}

function evaluateSessionVolumePeak(input: PostSessionInsightInput, priorSessions: ReturnType<typeof getPriorSessionsBefore>): Candidate | null {
  const completedAt = new Date(input.completedSession.performedAt).getTime();
  // Calendar stepping, not 42 fixed days: the peak claim needs four prior
  // sessions inside the window, and an hour of drift at the edge is enough to
  // drop the fourth and withhold a true insight, or admit a fifth from outside
  // it and make a false one.
  const windowStart = getRollingWindowStart(completedAt, 42);
  const priorInWindow = priorSessions.filter((session) => {
    const performedAt = new Date(session.performedAt).getTime();
    return performedAt >= windowStart && performedAt < completedAt;
  });

  // Only sessions whose volume is actually known can be compared against.
  // src/storage/database.ts reads totalVolumeKg off each session's logs and
  // leaves it undefined for a session with no logs to read — and reading those
  // as zero made any positive number today "the highest in six weeks". Five
  // kilos is not a peak; it is the only session we can measure.
  const comparablePriors = priorInWindow.filter(
    (session): session is typeof session & { totalVolumeKg: number } =>
      typeof session.totalVolumeKg === 'number',
  );

  if (comparablePriors.length < 4 || typeof input.completedSession.totalVolumeKg !== 'number') {
    return null;
  }

  const highestPrior = Math.max(...comparablePriors.map((session) => session.totalVolumeKg));
  if (input.completedSession.totalVolumeKg <= highestPrior) {
    return null;
  }

  return {
    type: 'session_volume_peak',
    message: `Highest session volume in six weeks: ${formatWeight(input.completedSession.totalVolumeKg, input.unitPreference)}.`,
    confidence: 0.85,
    priority: 3,
  };
}

function evaluateReturnAfterGap(input: PostSessionInsightInput, priorSessions: ReturnType<typeof getPriorSessionsBefore>): Candidate | null {
  const latestPrior = priorSessions[0];
  if (!latestPrior) {
    return null;
  }

  // The gate is a threshold, not a day count. "At least seven days" means the
  // previous session is at or before the same time of day seven calendar days
  // back — which is DST-proof (167 real hours still clears it) without
  // loosening anything else. Counting days and comparing the count instead
  // would let a Sunday-night to Sunday-morning gap of 145 hours through as
  // "seven days", which the old arithmetic correctly withheld.
  const sevenDaysBack = getRollingWindowStart(input.completedSession.performedAt, 7);
  if (new Date(latestPrior.performedAt).getTime() > sevenDaysBack) {
    return null;
  }

  // Reported in calendar days, so the sentence agrees with the gate that let
  // it through rather than quoting a week-long gap as six days.
  const gapDays = calendarDaysBetween(latestPrior.performedAt, input.completedSession.performedAt);

  return {
    type: 'return_after_gap',
    message: `First session back in ${gapDays} days. Good start.`,
    confidence: 0.95,
    priority: 4,
  };
}

export function computePostSessionInsight(input: PostSessionInsightInput, now: Date): PostSessionInsight | null {
  void now;

  const priorSessions = getPriorSessionsBefore(input);
  if (priorSessions.length < 3) {
    return null;
  }

  if (input.lastInsightSessionId && priorSessions[0]?.id === input.lastInsightSessionId) {
    return null;
  }

  if (getSessionCompletionRate(input.sessionExerciseLogs) < 0.7) {
    return null;
  }

  if (getTrackedTopSets(input.sessionExerciseLogs).length === 0) {
    return null;
  }

  const candidates = [
    evaluatePersonalRecord(input),
    evaluatePlateauDetected(input, priorSessions),
    evaluateSessionVolumePeak(input, priorSessions),
    evaluateReturnAfterGap(input, priorSessions),
  ]
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .filter((candidate) => candidate.confidence >= CONFIDENCE_THRESHOLD)
    .sort((left, right) => left.priority - right.priority);

  const selected = candidates[0];
  if (!selected || selected.type === input.lastInsightType) {
    return null;
  }

  const { priority, ...insight } = selected;
  return insight;
}
