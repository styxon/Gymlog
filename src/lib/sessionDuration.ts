/**
 * How long a session takes — one formula, so every screen quotes the same
 * number.
 *
 * There were four answers to this question. The catalog carried a hand-written
 * `estimatedSessionDuration` per program; Home guessed `exercises × 10 min` for
 * custom programs; the guided entry added up its own steps at a flat 35 s per
 * set; and the Adapt sheet subtracted 5 min per dropped set from whichever of
 * those it had been handed. They disagreed in public — the Adapt sheet promised
 * "~35 min" and the very next screen said "~50 min" for the same session.
 *
 * The model, deliberately simple enough to be argued with:
 *
 *   set  = reps × SECONDS_PER_REP + SET_SETUP_SECONDS
 *   rest = the exercise's own prescribed rest, after every set but the last
 *   plus the warm-up and cool-down as prescribed, and a short setup per
 *   exercise for walking over and loading the bar
 *
 * At 10 reps a set works out at about a minute of work, which is the rule of
 * thumb this replaces — but it now scales with the prescription, so a set of 5
 * and a set of 15 stop costing the same.
 *
 * It is an estimate and says so with a "~". What it must not do is be a
 * different estimate on the next screen.
 */

import { buildSupersetRuns, normalizeSupersetGroups } from './supersetGrouping';

/** A controlled working rep, eccentric included. */
export const SECONDS_PER_REP = 3.5;
/** Unracking, breathing, getting set — per working set. */
export const SET_SETUP_SECONDS = 20;
/** Walking over, loading the bar, first setup — per exercise. */
export const EXERCISE_SETUP_SECONDS = 45;
/**
 * A 500 m row is about two minutes and a 40 m sprint a few seconds; a quarter
 * second a metre sits between them and is never off by an order of magnitude.
 */
export const SECONDS_PER_METRE = 0.25;

/**
 * What the rep numbers of a named exercise count, when the name says.
 *
 * The catalogs write a distance or an interval into the rep fields: "Rowing
 * Machine (500m intervals)" is 6 × 500 metres, and costed as 500 repetitions it
 * made one conditioning day 280 minutes long on Home and on the ready card
 * (bug hunt, 2026-10-04). Null means the numbers are repetitions.
 */
export function prescriptionUnitFromName(name: string): 'metres' | 'seconds' | null {
  const lower = name.toLowerCase();
  if (/\b\d+\s?m\b/.test(lower)) {
    return 'metres';
  }
  if (/\(\d+s\b|\b\d+s on\b|\bhiit\b/.test(lower)) {
    return 'seconds';
  }
  return null;
}

export interface DurationExerciseInput {
  sets: number;
  /** The top of the prescribed rep range — what the session is planned for. */
  reps: number;
  /**
   * `reps` is seconds under tension, not repetitions (trackingMode 'hold').
   *
   * Without this a 60-second plank costs 60 × 3.5 s = three and a half
   * minutes of "work", and a mobility session quoted twice the time it takes.
   */
  timed?: boolean;
  /** Prescribed rest between sets, in seconds. */
  restSeconds: number;
  /** Skipped exercises cost nothing. */
  skipped?: boolean;
  /**
   * The superset this lift is done as part of.
   *
   * It changes the arithmetic, not just the label: a pair of three-set lifts
   * with ninety seconds' rest rests twice, not four times, because the rest
   * belongs to the round rather than to each lift. Counting it per lift made
   * the estimate for a superset session roughly three minutes long per pair
   * that nobody would ever spend.
   */
  supersetGroup?: string | null;
  /**
   * The exercise's name, when the caller has it. Read only for what the rep
   * numbers count (prescriptionUnitFromName): metres and seconds cost what
   * they are, not 3.5 s apiece.
   */
  name?: string;
}

export interface SessionDurationInput {
  exercises: DurationExerciseInput[];
  /** Warm-up and cool-down as prescribed, in seconds. Zero when there is none. */
  warmupSeconds?: number;
  cooldownSeconds?: number;
}

export function estimateWorkingSetSeconds(reps: number, timed = false, metres = false): number {
  const safeReps = Number.isFinite(reps) && reps > 0 ? reps : 8;
  // A held position already IS its duration; only the getting-into-it costs
  // extra. A rep count has to be multiplied out, and so does a distance.
  const work = timed ? safeReps : metres ? safeReps * SECONDS_PER_METRE : safeReps * SECONDS_PER_REP;
  return Math.round(work + SET_SETUP_SECONDS);
}

function workingSetSecondsFor(exercise: DurationExerciseInput): number {
  const unit = exercise.name ? prescriptionUnitFromName(exercise.name) : null;
  return estimateWorkingSetSeconds(exercise.reps, Boolean(exercise.timed) || unit === 'seconds', unit === 'metres');
}

export function estimateSessionSeconds(input: SessionDurationInput): number {
  // Skipped lifts cost nothing, and a skipped half of a pair leaves the other
  // half resting on its own — so they come out before the runs are read, the
  // same way the player drops them before it builds its steps.
  const doing = input.exercises.filter((exercise) => !exercise.skipped && exercise.sets > 0);

  const working = buildSupersetRuns(normalizeSupersetGroups(doing)).reduce((total, run) => {
    const members = run.indexes.map((index) => doing[index]);
    const setSeconds = members.reduce(
      (sum, exercise) => sum + workingSetSecondsFor(exercise) * exercise.sets,
      0,
    );
    // Walking over and loading the bar is paid per lift even in a superset:
    // two stations is two walks, whatever order they are done in.
    const setupSeconds = EXERCISE_SETUP_SECONDS * members.length;
    // One rest per round but the last — the round being the whole group, and
    // as long as its most demanding lift asks for. No rest is counted after
    // the final round: what follows is the walk to the next block, which the
    // setup cost already pays for.
    const rounds = Math.max(...members.map((exercise) => exercise.sets));
    const restEach = Math.max(0, ...members.map((exercise) => Math.max(0, exercise.restSeconds)));
    const restSeconds = Math.max(0, rounds - 1) * restEach;
    return total + setupSeconds + setSeconds + restSeconds;
  }, 0);

  return working + Math.max(0, input.warmupSeconds ?? 0) + Math.max(0, input.cooldownSeconds ?? 0);
}

/**
 * Minutes, rounded to the nearest 5 — the precision the "~" is honest about.
 * A session with nothing in it is 0, not a rounded-up 5: an empty plan should
 * not claim to take time.
 */
export function estimateSessionMinutes(input: SessionDurationInput): number {
  const seconds = estimateSessionSeconds(input);
  if (seconds <= 0) {
    return 0;
  }
  return Math.max(5, Math.round(seconds / 60 / 5) * 5);
}
