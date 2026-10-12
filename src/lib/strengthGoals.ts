/**
 * "Bench 100 kg" — a number to aim at, and how far along you are.
 *
 * The browse design had a goals row with progress bars, and the app could not
 * draw them: it stores a goal CATEGORY from onboarding ('strength', 'muscle')
 * and no target anywhere. A bar with nothing behind it sits at 0% on day one
 * and stays there, which is a worse row than no row.
 *
 * So the target is stored, and the progress is measured against the user's own
 * best set for that lift — never against an estimate, a formula or a
 * projection. If they have not lifted it, the goal shows as not started rather
 * than as zero progress: those are different states and a bar cannot tell them
 * apart on its own.
 */

import { bestForLift } from './liftIdentity';

export interface StrengthGoal {
  /** Matches ExerciseProgressSummary.name — the stored English name. */
  exerciseName: string;
  targetKg: number;
  createdAt: string;
}

export interface StrengthGoalProgress {
  goal: StrengthGoal;
  /** Best working weight logged for this lift, or null if never lifted. */
  currentKg: number | null;
  /** 0..1, or null when there is nothing to measure. */
  ratio: number | null;
  reached: boolean;
}

/** Guards the one number a user types. */
export function isValidTarget(targetKg: number): boolean {
  return Number.isFinite(targetKg) && targetKg > 0 && targetKg <= 1000;
}

export function normalizeStrengthGoals(value: unknown): StrengthGoal[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const goals: StrengthGoal[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const candidate = entry as Partial<StrengthGoal>;
    const name = typeof candidate.exerciseName === 'string' ? candidate.exerciseName.trim() : '';
    const target = typeof candidate.targetKg === 'number' ? candidate.targetKg : NaN;
    // One target per spelling, whatever its case: progression keys goal rows
    // by the lower-cased name, so "Bench Press" and "bench press" kept here as
    // two goals were one row there (dup sweep 13, D4-2). The first one stays.
    const key = name.toLowerCase();
    if (!name || !isValidTarget(target) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    goals.push({
      exerciseName: name,
      targetKg: target,
      createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date(0).toISOString(),
    });
  }
  return goals;
}

/**
 * Progress per goal, from the user's own logged bests.
 *
 * `currentKg` null means the lift has never been logged — the row says "not
 * started" rather than drawing an empty bar, because an empty bar reads as
 * "you have made no progress" when the truth is "you have not begun".
 */
/**
 * @param matches decides whether a logged exercise is the goal's lift. Passed
 *   in rather than imported so this module stays free of the programme layer;
 *   without it the lookup is by exact name, which is what it used to be and
 *   what left a deadlift target reading "not logged yet" for someone who had
 *   been pulling the catalog's "Conventional Deadlift" all along.
 */
export function resolveGoalProgress(
  goals: readonly StrengthGoal[],
  bests: ReadonlyMap<string, number | null>,
  matches?: (loggedName: string, liftName: string) => boolean,
): StrengthGoalProgress[] {
  return goals.map((goal) => {
    const currentKg = matches
      ? bestForLift(goal.exerciseName, bests, matches)
      : bests.get(goal.exerciseName) ?? null;
    if (currentKg === null || !(currentKg > 0)) {
      return { goal, currentKg: null, ratio: null, reached: false };
    }
    const ratio = Math.max(0, Math.min(1, currentKg / goal.targetKg));
    return { goal, currentKg, ratio, reached: currentKg >= goal.targetKg };
  });
}

/** Whether two goal names are one lift. The default compares the names exactly. */
export type GoalLiftMatcher = (left: string, right: string) => boolean;

const sameName: GoalLiftMatcher = (left, right) => left === right;

/**
 * Sets a target, replacing every target `matches` calls the same lift.
 *
 * @param matches passed in, as resolveGoalProgress takes it, so this module
 *   stays below the programme layer. The goal flow passes `isSameTargetLift`
 *   — the rule it uses to tell the reader a target is already set and saving
 *   replaces it; narrower than `isSameLift`, which folds in a lift's family. Comparing names here instead kept a target stored under an
 *   older spelling ("Back Squat", the presets' name until 2026-09-02) beside
 *   the new "Barbell Squat" one: two squat rows, one stuck at the old number
 *   (dup sweep 13, D4-2).
 */
export function upsertStrengthGoal(
  goals: readonly StrengthGoal[],
  next: StrengthGoal,
  matches: GoalLiftMatcher = sameName,
): StrengthGoal[] {
  const withoutDuplicate = goals.filter(
    (goal) => goal.exerciseName !== next.exerciseName && !matches(goal.exerciseName, next.exerciseName),
  );
  return [...withoutDuplicate, next];
}

/** Removes the target, and every other `matches` calls the same lift. */
export function removeStrengthGoal(
  goals: readonly StrengthGoal[],
  exerciseName: string,
  matches: GoalLiftMatcher = sameName,
): StrengthGoal[] {
  return goals.filter((goal) => goal.exerciseName !== exerciseName && !matches(goal.exerciseName, exerciseName));
}
