import { ExerciseLog, ExerciseLogSet, WorkoutSession } from '../types/models';
import { getComparableLogSets } from './exerciseLog';
import { getCompletedSetCount, getSessionTotalVolume } from './progression';

/**
 * What a saved session counts as — its sets, its kilos and its exercises — read
 * off its own logs, one way, for every surface that shows them.
 *
 * The session row carries these three numbers, and they used to be written
 * once at save by whatever helper that build shipped, then trusted forever.
 * #159 stopped counting sets that were never ticked; every session saved
 * before it kept the old count. The same workout then read 4 sets and 1 960 kg
 * on Progress, Profile, the widget and the weekly notification, and 2 sets and
 * 960 kg in History, which recomputes (audit, 2026-09-20). The logs are the
 * record; these numbers are only ever a reading of them.
 */

/** A log as saved, or as it is about to be. Drafts leave the legacy pair out. */
type LoggedExercise = {
  sets?: ExerciseLogSet[];
  weight?: number;
  repsPerSet?: number[];
  skipped?: boolean;
};

/**
 * An exercise that was done: not skipped, and at least one of its sets
 * completed.
 *
 * The one rule. The completion screen's tile counted lifts with a completed
 * set and History counted every log that was not skipped — and a lift is
 * saved with nothing done in it whenever it was swapped, given a note or
 * added mid-session. Bench done beside a row swapped and never started read
 * "1 LIIKETTÄ" on the way out and "2 liikettä" in History (audit,
 * 2026-09-20).
 *
 * It is also what makes a session count at all: a session is a completed one
 * when an exercise in it was done (see getCanonicalCompletedSessions).
 */
export function isExerciseDone(log: LoggedExercise | null | undefined): boolean {
  if (!log || log.skipped) {
    return false;
  }

  return (
    getComparableLogSets({
      sets: log.sets,
      weight: log.weight ?? 0,
      repsPerSet: log.repsPerSet ?? [],
      skipped: false,
    }).length > 0
  );
}

export interface SessionTotals {
  setsCompleted: number;
  totalVolumeKg: number;
  exercisesCompleted: number;
}

/**
 * The three numbers, through the same helpers History has always used — so
 * whatever the next fix to "what counts as a set" is, it lands everywhere at
 * once instead of in the surfaces that happen to recompute.
 */
export function getSessionTotals(
  logs: readonly (Pick<ExerciseLog, 'sets' | 'weight' | 'repsPerSet' | 'skipped'> &
    Pick<Partial<ExerciseLog>, 'repsUnit' | 'exerciseNameSnapshot'>)[],
): SessionTotals {
  return {
    setsCompleted: getCompletedSetCount(logs),
    totalVolumeKg: getSessionTotalVolume(logs),
    exercisesCompleted: logs.filter(isExerciseDone).length,
  };
}

/**
 * Sessions with their totals read again from their logs. The loader runs every
 * stored session through this.
 *
 * On load rather than at each reader, because there are a dozen readers —
 * Progress, Profile, the widget, the milestones, the weekly notification, the
 * coach's context, the post-session insight — and each one that read the row
 * as stored was a surface where an older build's arithmetic survived. Fixing
 * them one by one would leave the next reader to be written the same way.
 *
 * The stored row is overwritten with the reading on the next save. Nothing is
 * lost by that: the logs are untouched, and they are what any later build
 * reads the numbers from again.
 *
 * A session with no logs at all has nothing to read them from, and gets no
 * numbers rather than zeros. Its stored figures are exactly the kind this
 * stops trusting, and a zero is a claim: the post-session insight compares
 * today against every known volume and leaves unknown ones out.
 */
export function withLoggedSessionTotals<T extends Pick<WorkoutSession, 'id'>>(
  sessions: readonly T[],
  logs: readonly (Pick<ExerciseLog, 'sessionId' | 'sets' | 'weight' | 'repsPerSet' | 'skipped'> &
    Pick<Partial<ExerciseLog>, 'repsUnit' | 'exerciseNameSnapshot'>)[],
): Array<T & Partial<SessionTotals>> {
  const logsBySession = new Map<
    string,
    (Pick<ExerciseLog, 'sets' | 'weight' | 'repsPerSet' | 'skipped'> &
      Pick<Partial<ExerciseLog>, 'repsUnit' | 'exerciseNameSnapshot'>)[]
  >();
  for (const log of logs) {
    const list = logsBySession.get(log.sessionId);
    if (list) {
      list.push(log);
    } else {
      logsBySession.set(log.sessionId, [log]);
    }
  }

  return sessions.map((session) => {
    const own = logsBySession.get(session.id);
    if (!own) {
      return { ...session, setsCompleted: undefined, totalVolumeKg: undefined, exercisesCompleted: undefined };
    }
    return { ...session, ...getSessionTotals(own) };
  });
}
