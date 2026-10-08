import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { isMinutesRun, runStandInKind, type RunStandInKind } from './cautionExerciseFilter';
import { classifySessionFocus } from './homeSessionHero';
import { emphasisAreaForExercise, type EmphasisArea } from './programEmphasis';
import { applyReaderFiltersToDay } from './readerDayFilters';
import type { RecommendationInput } from '../types/recommendation';

/**
 * What the recommender has to know about a programme's week, as the reader
 * would run it, before it hands the programme over: that composing it for
 * their days and flags leaves it the programme its reason describes.
 */

/**
 * A reader who chose this many days is handed a programme that fits them
 * rather than a longer split cut down (owner, 2026-10-07, #34).
 */
export const SHORT_WEEK_DAYS = 2;

const shortWeekSplits = new Map<string, boolean>();

/**
 * Whether some `days` sessions in a row of this programme leave out a half of
 * the body that the programme trains.
 *
 * A split written for more days than the reader has loses whole days: the
 * three-day push/pull/legs cut to two kept Push and Pull and saved a muscle
 * plan with no lower body in it (bug hunt, 2026-10-07, #34). Every run of
 * `days` sessions is checked, wrapping round, because a week cut short now
 * rotates through the programme instead — and Chest (Volume) followed by
 * Chest (Heavy) is a week with no legs either way. A full-body day, or an
 * upper day beside a lower one, keeps both halves in every run.
 */
export function splitsShortWeek(programId: string, days: number): boolean {
  const key = `${programId}\u0000${days}`;
  const cached = shortWeekSplits.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const template = getWorkoutTemplateById(programId);
  let splits = false;
  if (template && template.sessions.length > days) {
    const week = template.sessions.map((session) => halfSets(session.exercises));
    const allSets = week.reduce((sum, day) => sum + day.all, 0);
    // A run or mobility programme is not a lifting split, whatever its one
    // calf raise or cossack squat says.
    const lifting = sumOf(week, 'upper') + sumOf(week, 'lower');
    const trains = (half: Half) => sumOf(week, half) >= MIN_HALF_SETS && hasShare(week, half);
    for (let start = 0; lifting * 2 >= allSets && start < week.length && !splits; start += 1) {
      const run = Array.from({ length: days }, (_, offset) => week[(start + offset) % week.length]);
      splits = HALVES.some((half) => trains(half) && !hasShare(run, half));
    }
  }
  shortWeekSplits.set(key, splits);
  return splits;
}

/**
 * Whether the reader's days would cut this programme into a week missing a
 * half of the body. Every chooser of the featured programme asks this: the
 * waterfall's lanes, and the score ranking that picks when the waterfall's
 * pick is not in the pool (review, 2026-10-08).
 */
export function splitsReaderWeek(
  program: { programId: string; daysPerWeek: number },
  input: Pick<RecommendationInput, 'daysPerWeek'>,
): boolean {
  return input.daysPerWeek <= SHORT_WEEK_DAYS
    && program.daysPerWeek > input.daysPerWeek
    && splitsShortWeek(program.programId, input.daysPerWeek);
}

type Half = 'upper' | 'lower';

const HALVES: Half[] = ['upper', 'lower'];

/**
 * The share of a stretch of days' lifting sets a half needs for those days to
 * train it, and the sets a programme needs to train it at all. A side plank
 * on a runner's core day is not an upper-body week; the five sets of legs in
 * the chest block are a lower-body day, and the week without it has none.
 */
const HALF_SHARE = 0.1;
const MIN_HALF_SETS = 4;

interface DaySets {
  upper: number;
  lower: number;
  all: number;
}

/**
 * A day's sets by half of the body, by the movement each lift is: the pattern
 * the warm-ups and the refill read (classifySessionFocus), so a deadlift is a
 * lower-body lift here too. Stretches, core and conditioning count for neither.
 */
function halfSets(exercises: ReadonlyArray<{ exerciseName: string; sets: number }>): DaySets {
  const sets = { upper: 0, lower: 0, all: 0 };
  for (const exercise of exercises) {
    const kind = classifySessionFocus([exercise.exerciseName]);
    if (kind === 'lower') {
      sets.lower += exercise.sets;
    } else if (kind !== 'general') {
      sets.upper += exercise.sets;
    }
    sets.all += exercise.sets;
  }
  return sets;
}

function sumOf(days: readonly DaySets[], half: Half): number {
  return days.reduce((sum, day) => sum + day[half], 0);
}

function hasShare(days: readonly DaySets[], half: Half): boolean {
  const lifting = sumOf(days, 'upper') + sumOf(days, 'lower');
  return lifting > 0 && sumOf(days, half) >= lifting * HALF_SHARE;
}

/** The body area each specialisation block is for, in the emphasis card's terms. */
const FOCUS_PROGRAMME_AREA: Record<string, EmphasisArea> = {
  tpl_focus_chest_program_v1: 'chestArms',
  tpl_focus_back_program_v1: 'shouldersBack',
  tpl_focus_arms_program_v1: 'chestArms',
  tpl_focus_legs_program_v1: 'glutesLegs',
  tpl_focus_glutes_program_v1: 'glutesLegs',
};

/**
 * Whether the reader's `avoid` flags take a specialisation block below its
 * point: some day it spends on its area keeps less than half of that area's
 * sets.
 *
 * The arms block with elbows avoided composed to "Arms (Heavy)" = one lateral
 * raise and "Arms (Volume)" = one rear delt fly, under "trains your focus area
 * twice a week" (bug hunt, 2026-10-07, #35). The waterfall then falls to its
 * next pick instead.
 *
 * The day is judged as the composer builds it, gear pass first. Asking the
 * flags alone, a chest block with no dumbbells or cables and elbows and
 * wrists avoided kept 10 of Chest (Heavy)'s 12 chest sets on paper and 4 in
 * the week, and every chooser featured it (bug hunt round 2, 2026-10-08).
 */
export function focusProgrammeLosesItsPoint(programId: string, input: RecommendationInput): boolean {
  const area = FOCUS_PROGRAMME_AREA[programId];
  const cautionFlags = input.cautionFlags ?? [];
  const template = getWorkoutTemplateById(programId);
  if (!area || !template || !cautionFlags.some((flag) => flag.level === 'avoid')) {
    return false;
  }
  const areaSets = (exercises: ReadonlyArray<{ exerciseName: string; sets: number }>) =>
    exercises
      .filter((exercise) => emphasisAreaForExercise(exercise.exerciseName) === area)
      .reduce((sum, exercise) => sum + exercise.sets, 0);
  const totalSets = (exercises: ReadonlyArray<{ sets: number }>) =>
    exercises.reduce((sum, exercise) => sum + exercise.sets, 0);

  return template.sessions.some((session) => {
    const before = areaSets(session.exercises);
    // A focus day is one spent mostly on the area; the other days are the
    // rest of the body and are not what the reason promises.
    if (before * 2 <= totalSets(session.exercises)) {
      return false;
    }
    const kept = applyReaderFiltersToDay(
      [...session.exercises],
      input.availableEquipment ?? null,
      cautionFlags,
      input.focusAreas,
    ).adjusted.exercises;
    return areaSets(kept) * 2 < before;
  });
}

/** What a programme's runs are for the reader, or 'none' when it holds no runs. */
export type ProgramRunWork = 'run' | RunStandInKind | 'none';

/**
 * Whether this programme's week runs, walks or rides for the reader, or holds
 * no runs at all; null for a programme the catalog does not know. The same
 * rule the composer swaps by, so a reason line can say "walks" exactly when
 * the week holds walks, and "run work" only when it holds runs: the line sat
 * over Mobility Reset, whose card says there is no running in it (bug hunt,
 * 2026-10-08).
 */
export function programRunWork(programId: string, input: RecommendationInput): ProgramRunWork | null {
  const template = getWorkoutTemplateById(programId);
  if (!template) {
    return null;
  }
  if (!template.sessions.some((session) => session.exercises.some(isMinutesRun))) {
    return 'none';
  }
  return runStandInKind(input.cautionFlags ?? [], input.availableEquipment ?? null) ?? 'run';
}

/**
 * What this programme's runs become for the reader, or null when they still
 * run (or it has none).
 */
export function programRunStandInKind(programId: string, input: RecommendationInput): RunStandInKind | null {
  const work = programRunWork(programId, input);
  return work === 'walk' || work === 'ride' ? work : null;
}
