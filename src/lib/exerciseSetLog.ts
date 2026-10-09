import { removeTrailingZeros } from './format';
import { isHoldExerciseName } from './holdExercises';
import { t } from './i18n';
import { PersonalRecord, RecordSource, resolveRecord } from './personalRecords';
import type { AppLanguage } from '../types/models';

/**
 * One lift, every set of it, session by session.
 *
 * The tracked view draws a curve: one point per session, the top set. That
 * answers "am I going up" and nothing else. It cannot show that the top set
 * came after two easy ones, or that a session everyone would call a bad day
 * was actually the heaviest total work you have done on the lift. Those facts
 * are already stored — nothing here derives anything the log did not record.
 *
 * The three bests come from `personalRecords` rather than a second reading of
 * the same sets, so the sheet and the records list can never disagree about
 * what the best bench is.
 */

export interface SetLogSet {
  weightKg: number;
  reps: number;
  /** True for the exact set that holds the weight record. */
  isRecord: boolean;
}

export interface SetLogSession {
  performedAt: string;
  volumeKg: number;
  sets: SetLogSet[];
}

export interface ExerciseSetLog {
  key: string;
  name: string;
  bodyPart: string | null;
  /** Newest first, capped by `limit`. */
  sessions: SetLogSession[];
  /** How many sessions exist in total, so "5 of 23" can be honest. */
  totalSessions: number;
  /**
   * Top set per session, oldest first — the line the sets sit behind.
   *
   * It covers every session, not only the ones the sheet lists, and it is
   * shown in both tiers: the free half of this feature is the curve, so it
   * cannot live behind the same lock as the sets.
   */
  curve: number[];
  /**
   * A hold: what a set stores as reps is seconds held. The sheet printed a
   * 60 s plank as "60 × 0" (hunt, 2026-10-09).
   */
  timed: boolean;
  bestWeight: PersonalRecord | null;
  bestReps: PersonalRecord | null;
  bestVolume: PersonalRecord | null;
}

/** How many sessions the sheet shows before it stops. */
export const SET_LOG_SESSIONS = 5;

export function buildExerciseSetLog(
  source: RecordSource,
  options: { limit?: number; now?: Date } = {},
): ExerciseSetLog {
  const { limit = SET_LOG_SESSIONS, now = new Date() } = options;

  const bestWeight = resolveRecord(source, 'weight', now);
  const bestReps = resolveRecord(source, 'reps', now);
  const bestVolume = resolveRecord(source, 'volume', now);

  const usable = source.entries
    .filter((entry) => Number.isFinite(Date.parse(entry.performedAt)))
    .sort((left, right) => Date.parse(right.performedAt) - Date.parse(left.performedAt));

  // The record set is marked once, on the session that set it. Marking every
  // set that merely equals the record would put a PR badge on a lift that has
  // matched its best three times and beaten it never.
  let recordMarked = false;

  const sessions = usable.slice(0, Math.max(limit, 0)).map((entry) => {
    const sets = entry.sets
      .filter((set) => Number.isFinite(set.weight) && Number.isFinite(set.reps))
      .map((set) => {
        const isRecord =
          !recordMarked &&
          bestWeight !== null &&
          entry.performedAt === bestWeight.performedAt &&
          set.weight === bestWeight.value &&
          set.reps === bestWeight.companion;
        if (isRecord) {
          recordMarked = true;
        }
        return { weightKg: set.weight, reps: set.reps, isRecord };
      });

    return {
      performedAt: entry.performedAt,
      volumeKg: sets.reduce((total, set) => total + set.weightKg * set.reps, 0),
      sets,
    };
  });

  // A lift that was never loaded has no weight to draw, so the line follows
  // reps instead — the same reason the records come in three kinds.
  // A lift that was loaded draws weight, and only through the sessions that
  // carried one: dips done weighted and then plain dropped to 0 kg on every
  // plain session, a fall in a line that measures kilos (hunt, 2026-10-09).
  const everLoaded = usable.some((entry) => entry.sets.some((set) => set.weight > 0));
  const curve = [...usable]
    .reverse()
    .filter((entry) => !everLoaded || entry.sets.some((set) => set.weight > 0))
    .map((entry) =>
      entry.sets.reduce(
        (best, set) => Math.max(best, everLoaded ? set.weight : set.reps),
        0,
      ),
    )
    .filter((value) => Number.isFinite(value));

  return {
    key: source.key,
    name: source.name,
    bodyPart: source.bodyPart ?? null,
    sessions,
    totalSessions: usable.length,
    curve,
    timed: isHoldExerciseName(source.name),
    bestWeight,
    bestReps,
    bestVolume,
  };
}

/**
 * One set as the sheet's chip says it: the reps — seconds for a hold — and the
 * weight when there was one. "15 × 0" read as fifteen reps of nothing; a set
 * with no load is its count alone, as the set screen's history pills show it.
 */
export function formatSetLogSet(set: Pick<SetLogSet, 'weightKg' | 'reps'>, timed: boolean, language: AppLanguage): string {
  const count = timed ? t(language, 'logger.secondsValue', { count: set.reps }) : `${set.reps}`;
  if (set.weightKg === 0) {
    return count;
  }
  return `${count} × ${removeTrailingZeros(Math.round(set.weightKg * 10) / 10)}`;
}
