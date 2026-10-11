/**
 * An interval exercise's own rhythm, read from its name.
 *
 * "Treadmill HIIT (30s on / 30s off)" is not eight sets of thirty repetitions
 * with a rest in between — it is thirty seconds of running and thirty of
 * walking, over and over, and the walk IS the recovery (user, 2026-08-26:
 * "eikö se tarkoita että treeni pitää sisällään 30s kävelyä/30s juoksua").
 * The player has to run both halves on a clock, because a work phase with no
 * timer is a work phase the reader has to guess at while running.
 *
 * The name is the source. Every catalog interval states its scheme in
 * brackets, a saved programme carries the same name, and a name cannot drift
 * out of sync with itself the way a separate seconds field can.
 */

/** What the hard half asks for. */
export type IntervalWorkKind = 'run' | 'hard';

/**
 * What the easy half asks for. `walk` is literal, `easy` is a lighter pace on
 * whatever machine the name mentions, and `rest` is a stop — under fifteen
 * seconds there is no pace to hold, which is what a tabata's ten seconds is.
 */
export type IntervalRecoveryKind = 'walk' | 'easy' | 'rest';

export interface IntervalScheme {
  workSeconds: number;
  recoverySeconds: number;
  workKind: IntervalWorkKind;
  recoveryKind: IntervalRecoveryKind;
}

/** Below this a recovery is a stop, not a pace. */
const REST_RATHER_THAN_PACE_SECONDS = 15;

// "(30s on / 30s off)", "(45s sprint / 15s rest)", "(20s on / 10s off)".
const SCHEME = /\((\d+)\s*s\s*(?:on|sprint|hard|work)\s*\/\s*(\d+)\s*s\s*(?:off|rest|walk|easy)\)/i;

export function parseIntervalScheme(name: string): IntervalScheme | null {
  const match = SCHEME.exec(name);
  if (!match) {
    return null;
  }

  const workSeconds = Number(match[1]);
  const recoverySeconds = Number(match[2]);
  if (!Number.isFinite(workSeconds) || !Number.isFinite(recoverySeconds)) {
    return null;
  }
  if (workSeconds <= 0 || recoverySeconds <= 0) {
    return null;
  }

  // A treadmill is the one machine whose two halves have plain names the
  // reader already uses. Everywhere else the honest word is the effort, not
  // the movement: "hard" and "easy" are true on a bike, a rower and a burpee
  // alike, and inventing a movement for each would be inventing.
  const treadmill = /treadmill|run/i.test(name);

  return {
    workSeconds,
    recoverySeconds,
    workKind: treadmill ? 'run' : 'hard',
    recoveryKind: treadmill
      ? 'walk'
      : recoverySeconds <= REST_RATHER_THAN_PACE_SECONDS
        ? 'rest'
        : 'easy',
  };
}

/**
 * The recovery length an interval states in its own name, or null when the
 * exercise is not an interval. This is what the rest between two work bouts
 * must be — a catalog row that prescribed sixty seconds on top of a thirty
 * second walk was describing a different workout from the one it named.
 */
export function intervalOffSeconds(name: string): number | null {
  return parseIntervalScheme(name)?.recoverySeconds ?? null;
}

/**
 * A row whose numbers are a fixed dose (seconds of an interval, metres of a
 * sprint or a row) rather than repetitions and a load to climb.
 *
 * Their rows are written as reps_first, load_and_reps or bodyweight, so the
 * progression gate read 45 seconds as reps and 200 metres as reps: a Bike
 * HIIT's typed resistance stepped 20, 22.5, 25 with AUTO, a 200 m sprint
 * became 201, a tabata's 20 s became 21 (hunt, 2026-10-11). A named interval
 * scheme says so in the name (the name is the source, above); the scheme-less
 * rows, Sprint 40m and Rowing Machine (500m intervals), sit in the catalog's
 * own 'cardio_intervals' group. Loaded carries (Farmer's Walk, Sled Push) are
 * neither: a fixed distance with more load is how they progress.
 */
export function isFixedDoseExercise(exercise: { exerciseName: string; substitutionGroup?: string | null }): boolean {
  return parseIntervalScheme(exercise.exerciseName ?? '') !== null || exercise.substitutionGroup === 'cardio_intervals';
}
