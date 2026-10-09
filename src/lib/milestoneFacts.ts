import {
  getActiveWeekRuns,
  getCalendarWeekStartTimestamp,
  getCanonicalCardioSessions,
  getCanonicalCompletedSessions,
} from './completedSessions';
import { getSessionDurationMinutes } from './dashboard';
import { getWorkedLogSets } from './exerciseLog';
import { isHoldLogEntry } from './holdExercises';
import { isMinutesLogEntry } from './minutesExercises';
import { LifetimeTrainingSummary } from './lifetimeSummary';
import {
  MILESTONE_FAMILIES,
  MilestoneFamily,
  MilestoneTier,
  MilestoneTotals,
  ProfileMilestone,
  buildUpcomingMilestones,
  countAllMilestones,
  ladderFor,
  tierFor,
  volumeInUnit,
} from './profileMilestones';
import { AppDatabase, ExerciseLog, UnitPreference } from '../types/models';

/**
 * Everything the milestone ladder needs, read once from the log.
 *
 * `current` is where each family stands today. `timelines` is how it got
 * there: the family's running figure after each event that moved it, oldest
 * first, so the page can say WHEN a rung fell rather than only that it did.
 * The card only needs `current`; the reached page walks the timelines.
 *
 * Volume is kept in kilograms here and converted at the ladder, the same way
 * the card converts it — one place decides what a pound is.
 */
export interface MilestonePoint {
  /** ISO timestamp of the event that moved the figure. */
  at: string;
  /** The family's figure after it. */
  total: number;
}

export interface MilestoneFacts {
  current: Record<MilestoneFamily, number>;
  timelines: Record<MilestoneFamily, MilestonePoint[]>;
}

export interface ReachedMilestone {
  family: MilestoneFamily;
  target: number;
  tier: MilestoneTier;
  /** ISO timestamp of the event that carried the figure past the rung. */
  reachedAt: string;
}

export interface MilestoneLedger {
  /** Newest first. */
  reached: ReachedMilestone[];
  /** One per family that still has a rung ahead, nearest first. */
  upcoming: ProfileMilestone[];
  reachedCount: number;
  totalCount: number;
}

function timestamp(iso: string): number {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
}

function emptyTimelines(): Record<MilestoneFamily, MilestonePoint[]> {
  return MILESTONE_FAMILIES.reduce(
    (timelines, family) => {
      timelines[family] = [];
      return timelines;
    },
    {} as Record<MilestoneFamily, MilestonePoint[]>,
  );
}

function lastTotal(points: MilestonePoint[]): number {
  return points.length > 0 ? points[points.length - 1].total : 0;
}

/** One point per event, the figure accumulating by `step`. */
function accumulate(dates: readonly string[], step: (index: number) => number): MilestonePoint[] {
  let total = 0;
  return dates.map((at, index) => {
    total += step(index);
    return { at, total };
  });
}

/**
 * Reads the log. `recordDates` is the day each lift first held a record —
 * the records themselves are resolved in the app from the tracked lifts, and
 * this takes their dates rather than re-deriving them, so the count here is
 * the count the Records tab shows.
 */
export function getMilestoneFacts(
  database: AppDatabase,
  lifetime: Pick<LifetimeTrainingSummary, 'currentWeekStreak'>,
  recordDates: readonly string[],
): MilestoneFacts {
  const timelines = emptyTimelines();

  // Strength sessions, oldest first, with their logs.
  const sessions = [...getCanonicalCompletedSessions(database)].reverse();
  const logsBySession = new Map<string, ExerciseLog[]>();
  for (const log of database.exerciseLogs ?? []) {
    const list = logsBySession.get(log.sessionId);
    if (list) {
      list.push(log);
    } else {
      logsBySession.set(log.sessionId, [log]);
    }
  }

  const seenExercises = new Set<string>();
  let volume = 0;
  let reps = 0;
  let sets = 0;
  let minutes = 0;
  sessions.forEach((session, index) => {
    const at = session.performedAt;
    timelines.sessions.push({ at, total: index + 1 });

    volume += typeof session.totalVolumeKg === 'number' && Number.isFinite(session.totalVolumeKg) ? Math.max(0, session.totalVolumeKg) : 0;
    timelines.volume.push({ at, total: volume });

    for (const log of logsBySession.get(session.id) ?? []) {
      // Every set lifted, drop sets with the working ones: a count, not a top set.
      const comparable = getWorkedLogSets(log).filter((set) => set.reps > 0);
      if (comparable.length === 0) {
        continue;
      }
      sets += comparable.length;
      // A log of minutes counts its sets, not its minutes as repetitions; a
      // hold likewise, its seconds are not repetitions.
      reps += isMinutesLogEntry(log) || isHoldLogEntry(log) ? 0 : comparable.reduce((sum, set) => sum + set.reps, 0);
      seenExercises.add(log.exerciseNameSnapshot.trim().toLowerCase());
    }
    timelines.reps.push({ at, total: reps });
    timelines.sets.push({ at, total: sets });
    timelines.exercises.push({ at, total: seenExercises.size });

    minutes += Math.max(0, getSessionDurationMinutes(session));
    timelines.hours.push({ at, total: minutes / 60 });
  });

  // Weeks with a session, and the run of consecutive ones — the same weeks
  // the lifetime summary counts, so the card and the page agree. A week's
  // rung is dated by the first session in it, the workout that made the week
  // count, not by its Monday. A session whose date does not parse has no
  // week (the summary drops it the same way) and is left out here.
  // Runs make a week count too, as in the lifetime summary and Home's streak
  // (bug hunt, 2026-10-04); oldest first so the week is dated by whichever
  // activity came first.
  const firstSessionByWeek = new Map<number, string>();
  const activities = [...sessions, ...[...getCanonicalCardioSessions(database)].reverse()].sort(
    (left, right) => timestamp(left.performedAt) - timestamp(right.performedAt),
  );
  for (const session of activities) {
    const weekStart = getCalendarWeekStartTimestamp(session.performedAt);
    if (Number.isFinite(weekStart) && !firstSessionByWeek.has(weekStart)) {
      firstSessionByWeek.set(weekStart, session.performedAt);
    }
  }
  const weekStarts = [...firstSessionByWeek.keys()].sort((left, right) => left - right);
  const runs = getActiveWeekRuns(weekStarts);
  weekStarts.forEach((weekStart, index) => {
    const at = firstSessionByWeek.get(weekStart) as string;
    timelines.weeks.push({ at, total: index + 1 });
    timelines.streak.push({ at, total: runs[index] });
  });

  timelines.records = accumulate(
    [...recordDates].sort((left, right) => timestamp(left) - timestamp(right)),
    () => 1,
  );

  // Weigh-ins are stored as written (the loader does not normalize them), so
  // an entry without a readable date is not a point — the page would hand it
  // to a date formatter that throws.
  timelines.bodyweight = accumulate(
    (database.bodyweightEntries ?? [])
      .map((entry) => entry.recordedAt)
      .filter((at): at is string => typeof at === 'string' && Number.isFinite(Date.parse(at)))
      .sort((left, right) => timestamp(left) - timestamp(right)),
    () => 1,
  );

  const cardio = [...getCanonicalCardioSessions(database)].reverse();
  timelines.cardio = accumulate(
    cardio.map((session) => session.performedAt),
    () => 1,
  );
  timelines.distance = accumulate(
    cardio.map((session) => session.performedAt),
    (index) => {
      const km = cardio[index].distanceKm;
      return typeof km === 'number' && Number.isFinite(km) ? Math.max(0, km) : 0;
    },
  );

  const current = MILESTONE_FAMILIES.reduce(
    (figures, family) => {
      figures[family] = lastTotal(timelines[family]);
      return figures;
    },
    {} as Record<MilestoneFamily, number>,
  );
  // The streak that is alive is not the longest run the timeline saw — a
  // broken run stays reached on the page but the card counts from now.
  current.streak = Math.max(0, lifetime.currentWeekStreak);

  return { current, timelines };
}

/** The extra totals the card takes, lifted from the facts. */
export function totalsFromFacts(facts: MilestoneFacts): MilestoneTotals {
  return {
    reps: facts.current.reps,
    sets: facts.current.sets,
    exercises: facts.current.exercises,
    hours: facts.current.hours,
    bodyweight: facts.current.bodyweight,
    cardio: facts.current.cardio,
    distance: facts.current.distance,
  };
}

/**
 * Every rung that has fallen, with the day it fell, and every family's next
 * one. A rung is reached at the first point whose figure meets it — the
 * timeline is a running total, so that is the session (or week, or entry)
 * that carried the reader past it.
 */
export function buildMilestoneLedger(facts: MilestoneFacts, unitPreference: UnitPreference): MilestoneLedger {
  const reached: ReachedMilestone[] = [];
  for (const family of MILESTONE_FAMILIES) {
    const ladder = ladderFor(family, unitPreference);
    const points = facts.timelines[family].map((point) => ({
      at: point.at,
      total: family === 'volume' ? volumeInUnit(point.total, unitPreference) : point.total,
    }));
    for (const target of ladder.rungs) {
      const hit = points.find((point) => point.total >= target);
      if (!hit) {
        break;
      }
      reached.push({ family, target, tier: tierFor(family, target, unitPreference), reachedAt: hit.at });
    }
  }
  reached.sort((left, right) => timestamp(right.reachedAt) - timestamp(left.reachedAt));

  const upcoming = buildUpcomingMilestones({
    lifetime: {
      sessionCount: facts.current.sessions,
      totalVolumeKg: facts.current.volume,
      currentWeekStreak: facts.current.streak,
      // The longest run the timeline saw: its rungs are reached, so the next
      // streak rung is the first above it, not above the run alive today.
      bestWeekStreak: facts.timelines.streak.reduce((best, point) => Math.max(best, point.total), 0),
      weeksActive: facts.current.weeks,
    },
    recordCount: facts.current.records,
    unitPreference,
    totals: totalsFromFacts(facts),
  });

  return {
    reached,
    upcoming,
    reachedCount: reached.length,
    totalCount: countAllMilestones(unitPreference),
  };
}
