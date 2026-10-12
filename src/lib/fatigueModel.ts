import { calendarDaysBetween, getRollingWindowStart } from './completedSessions';
import { ExerciseLog, WorkoutSession } from '../types/models';
import { getSessionTotalVolume } from './progression';

export interface FatigueModelInput {
  workoutSessions: WorkoutSession[];
  exerciseLogs: ExerciseLog[];
}

export type FatigueSignal = 'undertrained' | 'optimal' | 'elevated' | 'high';

export interface FatigueResult {
  acuteLoadKg: number;
  chronicLoadKg: number;
  acwr: number;
  recoveryScore: number;
  signal: FatigueSignal;
  sessionCount7d: number;
  sessionCount28d: number;
  /**
   * False until there is enough history for the ratio to mean anything.
   *
   * The chronic load is a weekly average, and a week or two of history makes
   * a thin one: callers must not give load advice while this is false.
   */
  confident: boolean;
}

/** Sessions spread over enough of the window for a 4-week average to hold up. */
const MIN_SESSIONS_FOR_CONFIDENCE = 4;
const MIN_SPAN_DAYS_FOR_CONFIDENCE = 14;

function resolveSessionVolume(
  session: WorkoutSession,
  logsBySession: Record<string, ExerciseLog[]>,
): number {
  if (typeof session.totalVolumeKg === 'number' && session.totalVolumeKg > 0) {
    return session.totalVolumeKg;
  }
  return getSessionTotalVolume(logsBySession[session.id] ?? []);
}

function computeRecoveryScore(acwr: number): number {
  // peak at ACWR ~1.05, falls off on both sides
  if (acwr <= 0) return 50;
  if (acwr < 0.8) {
    return Math.round((acwr / 0.8) * 65);
  }
  if (acwr <= 1.3) {
    const deviation = Math.abs(acwr - 1.05) / 0.25;
    return Math.round(100 - deviation * 25);
  }
  if (acwr <= 1.5) {
    return Math.round(74 - ((acwr - 1.3) / 0.2) * 24);
  }
  return Math.max(0, Math.round(50 - (acwr - 1.5) * 50));
}

function resolveSignal(acwr: number): FatigueSignal {
  if (acwr < 0.8) return 'undertrained';
  if (acwr <= 1.3) return 'optimal';
  if (acwr <= 1.5) return 'elevated';
  return 'high';
}

export function buildFatigueModel(input: FatigueModelInput, referenceDate?: Date): FatigueResult {
  const now = referenceDate ?? new Date();
  // Whole local days: the week is today and the six days before it, the four
  // weeks today and the 27 before, each opening at local midnight — the same
  // seven days the recovery sheet draws as its week and sessionCount7d counts.
  // The windows used to keep now's time of day, so a session dropped out of
  // the acute load at the clock time it was logged: the sheet (memoised when
  // the app opened) and the start (read at the start) disagreed the same day,
  // and the acute load counted a session from an eighth date that the strip
  // and the count left out (bug hunt 12, 2026-10-11). Built by calendar date,
  // never by stepping DAY_MS, so a 23- or 25-hour day still opens at midnight.
  const cutoff7d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const cutoff28d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 27);

  const logsBySession: Record<string, ExerciseLog[]> = {};
  for (const log of input.exerciseLogs) {
    if (!logsBySession[log.sessionId]) {
      logsBySession[log.sessionId] = [];
    }
    logsBySession[log.sessionId].push(log);
  }

  const sessions28d = input.workoutSessions.filter((s) => {
    const d = new Date(s.performedAt);
    return d >= cutoff28d && d <= now;
  });

  const sessions7d = sessions28d.filter((s) => new Date(s.performedAt) >= cutoff7d);

  const acuteLoadKg = sessions7d.reduce(
    (sum, s) => sum + resolveSessionVolume(s, logsBySession),
    0,
  );
  const total28dLoadKg = sessions28d.reduce(
    (sum, s) => sum + resolveSessionVolume(s, logsBySession),
    0,
  );
  // A weekly average over the weeks the reader has actually been training, up
  // to the window's four. Dividing by four from the first week made a new
  // reader training three identical sessions a week read "recovery low" on day
  // fifteen: two weeks of load averaged over four is half a week's worth, and
  // this week looked like double it (ACWR 1.71).
  const firstEverMs = input.workoutSessions.reduce((earliest, session) => {
    const time = new Date(session.performedAt).getTime();
    return Number.isFinite(time) && time <= now.getTime() && time < earliest ? time : earliest;
  }, Infinity);
  const coveredDays = Number.isFinite(firstEverMs) ? calendarDaysBetween(firstEverMs, now) + 1 : 28;
  const chronicWeeks = Math.min(4, Math.max(1, coveredDays / 7));
  const chronicLoadKg = total28dLoadKg / chronicWeeks;

  // Rounded once, and the rounded ratio is the one the zone, the score and
  // the label all read: 1.3004 was printed "1.30" and classed above the
  // optimal zone's 1.3 edge, amber and holding a raise (bug hunt 12).
  const acwr = chronicLoadKg > 0 ? Math.round((acuteLoadKg / chronicLoadKg) * 100) / 100 : 0;

  const times = sessions28d
    .map((session) => new Date(session.performedAt).getTime())
    .filter((time) => Number.isFinite(time));
  // A threshold rather than a measured span, for the same reason as the gap
  // gate in postSessionInsight: fourteen calendar days across a clock change
  // are 335 hours and must clear it, while thirteen days and an hour must not.
  // Dividing the raw span fails the first; rounding a day count passes the
  // second, and `confident` is what lets the app give load advice at all.
  const earliest = times.length > 1 ? Math.min(...times) : null;
  const latest = times.length > 1 ? Math.max(...times) : null;
  const spanIsWideEnough =
    earliest !== null &&
    latest !== null &&
    earliest <= getRollingWindowStart(new Date(latest), MIN_SPAN_DAYS_FOR_CONFIDENCE);
  // And some load to compare: the load is kilograms lifted, so a bodyweight,
  // hold, mobility or cardio month adds none. Four such sessions counted as
  // confidence, and the recovery sheet read "about 100% lighter than your usual
  // week, you are rested" of a reader who had trained three times (bug hunt,
  // 2026-10-09). With nothing to measure against there is no ratio to read.
  const confident =
    sessions28d.length >= MIN_SESSIONS_FOR_CONFIDENCE && spanIsWideEnough && chronicLoadKg > 0;

  return {
    acuteLoadKg: Math.round(acuteLoadKg),
    chronicLoadKg: Math.round(chronicLoadKg),
    acwr,
    recoveryScore: computeRecoveryScore(acwr),
    signal: resolveSignal(acwr),
    // The sessions in the acute load: the seven calendar days the recovery
    // sheet draws as its week. A count off a rolling window reached into an
    // eighth date, and the row read "2 sessions" over a week strip with one
    // lit day (audit 9, 2026-09-26).
    sessionCount7d: sessions7d.length,
    sessionCount28d: sessions28d.length,
    confident,
  };
}
