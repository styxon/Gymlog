/**
 * Honest "where your week goes" split for a program: the share of the week's
 * estimated TRAINING TIME spent on each quality. This is a factual composition
 * of the plan's exercises — never a promised outcome.
 *
 * What is measured, per exercise: sets × (one set's work + its rest).
 *
 *   work  minutes rows (trackingMode 'duration_minutes'): the minutes written
 *         holds (trackingMode 'hold') and intervals the name times
 *         ("Treadmill HIIT (30s on / 30s off)"): the seconds written
 *         distances the name gives ("Sprint 40m"): metres at a sprint's pace
 *         everything else: reps × SECONDS_PER_REP + SET_SETUP_SECONDS, the
 *         per-set cost the session estimate uses (sessionDuration)
 *   rest  the low end of the prescribed rest (restSecondsMin), the end a ready
 *         programme is timed on (programmeMinutes)
 *
 * It weighed by set count until 2026-10-12. A set of bench press and a
 * 20-minute treadmill block both counted one, so a week with an hour of steady
 * cardio still read as almost all lifting, and FIT and FIT Lite showed
 * "Muscle 100 %" for a general-fitness answer (owner, on the device).
 */

import { I18nKey, t } from './i18n';
import { prescriptionUnitFromName, SECONDS_PER_METRE, SECONDS_PER_REP, SET_SETUP_SECONDS } from './sessionDuration';
import type { AppLanguage } from '../types/models';

/** Structural subset so both catalog sessions and composed weeks fit. */
interface ProgramFocusSessionInput {
  exercises: Array<{
    exerciseName: string;
    sets: number;
    repsMax?: number;
    trackingMode?: string;
    restSecondsMin?: number;
    restSecondsMax?: number;
  }>;
}

type ProgramFocusExerciseInput = ProgramFocusSessionInput['exercises'][number];

/** Reps assumed when a row writes none — the session estimate's own default. */
const DEFAULT_REPS = 8;
/** Rest assumed for a lifting row that writes none. */
const DEFAULT_LIFT_REST_SECONDS = 60;

function finitePositive(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** One set's work, in seconds. */
function workSecondsPerSet(exercise: ProgramFocusExerciseInput): number {
  const reps = finitePositive(exercise.repsMax) ?? DEFAULT_REPS;
  if (exercise.trackingMode === 'duration_minutes') {
    return reps * 60;
  }
  const unit = prescriptionUnitFromName(exercise.exerciseName);
  if (exercise.trackingMode === 'hold' || unit === 'seconds') {
    return reps;
  }
  if (unit === 'metres') {
    return reps * SECONDS_PER_METRE;
  }
  return reps * SECONDS_PER_REP + SET_SETUP_SECONDS;
}

/** The rest after one set, in seconds. */
function restSecondsPerSet(exercise: ProgramFocusExerciseInput): number {
  const low = exercise.restSecondsMin;
  if (typeof low === 'number' && Number.isFinite(low) && low >= 0) {
    return low;
  }
  const high = exercise.restSecondsMax;
  if (typeof high === 'number' && Number.isFinite(high) && high >= 0) {
    return high;
  }
  // A steady bout written without a rest has none; a lift still does.
  return exercise.trackingMode === 'duration_minutes' ? 0 : DEFAULT_LIFT_REST_SECONDS;
}

/** The time one exercise takes across its sets, in seconds. */
export function estimateFocusExerciseSeconds(exercise: ProgramFocusExerciseInput): number {
  const sets = Math.max(1, Number.isFinite(exercise.sets) ? exercise.sets : 1);
  return sets * (workSecondsPerSet(exercise) + restSecondsPerSet(exercise));
}

/**
 * Lifting splits by the reps written for it: Strength is heavy work at six reps
 * or fewer, Muscle is everything lifted at more. One "Weights" share told a
 * 5x5 and a pump programme apart by nothing (user, 2026-10-05).
 */
type ProgramFocusQuality = 'Strength' | 'Muscle' | 'Conditioning' | 'Mobility';

/** The most reps a set may ask for and still count as strength work. */
const STRENGTH_MAX_REPS = 6;

export interface ProgramFocusSegment {
  quality: ProgramFocusQuality;
  pct: number;
}

// Fixed color code: same color = same quality everywhere it is rendered.
export const PROGRAM_FOCUS_COLORS: Record<ProgramFocusQuality, string> = {
  Strength: '#F59E0B',
  Muscle: '#FB7185',
  Conditioning: '#38BDF8',
  Mobility: '#34D399',
};

// The quality is an identifier and stays English; only the label translates.
const PROGRAM_FOCUS_LABEL_KEYS: Record<ProgramFocusQuality, I18nKey> = {
  Strength: 'focus.quality.strength',
  Muscle: 'focus.quality.muscle',
  Conditioning: 'focus.quality.conditioning',
  Mobility: 'focus.quality.mobility',
};

export function getProgramFocusQualityLabel(
  quality: ProgramFocusQuality,
  language: AppLanguage = 'en',
): string {
  return t(language, PROGRAM_FOCUS_LABEL_KEYS[quality]);
}

const PROGRAM_FOCUS_ORDER: ProgramFocusQuality[] = ['Strength', 'Muscle', 'Conditioning', 'Mobility'];

// Matched at the start of a word in the lowercased exercise name. A bare
// 'walk' is deliberately absent (Walking Lunge is strength work, a Heel-to-Toe
// Walk balance work); farmer carries match via 'farmer' and 'carry'.
//
// The walk blocks are named whole: "Brisk Walk Blocks" and "Incline Walk
// Blocks" are minutes of walking, and with nothing here to match them they
// read as six-rep strength work. That was live before any programme
// prescribed them: a knee or ankle avoid flag swaps RUN's, FIT's and HOME
// Starter's run blocks for walk blocks, and the bar moved the swapped minutes
// from Conditioning to Strength (age-band analysis, 2026-10-12).
//
// At the start of a word, not anywhere: as a bare substring 'run' matched
// inside "Crunch", and every programme with a cable or bicycle crunch showed a
// conditioning share it does not have — STRONG Starter "Strength 92 /
// Conditioning 8" (catalog audit, 2026-10-05).
const CONDITIONING_TERMS = [
  'run',
  'sprint',
  'jog',
  'rowing',
  'rower',
  'erg',
  'bike',
  'cycling',
  'assault',
  'ski',
  'jump',
  'jacks',
  'burpee',
  'climber',
  'high knee',
  'skipping',
  'jump rope',
  'battle rope',
  'treadmill',
  'elliptical',
  'stair',
  'sled',
  'shuttle',
  'farmer',
  'carry',
  'swing',
  'interval',
  'cardio',
  'conditioning',
  // Drills and plyometrics, which read as strength until 2026-10-05.
  'drill',
  'pogo',
  'bound',
  'hop',
  'plank jack',
  'stride',
  'skater',
  'shadow box',
  'walk block',
  'brisk walk',
  'incline walk',
];

const MOBILITY_TERMS = [
  'stretch',
  'mobility',
  'foam',
  'yoga',
  'pigeon',
  'cat-cow',
  'cat cow',
  'cobra',
  "child's",
  'opener',
  'circle',
  "world's greatest",
  'downward',
  'thoracic',
  'couch',
  // Holds and poses filed as strength until 2026-10-05: Mobility Flow showed
  // "Strength 42" with 20 of those 24 sets forward folds and squat holds.
  'fold',
  'pose',
  'hip flexor',
  'squat hold',
  'wall slide',
  'thread the needle',
  // Spinal twists only: a Russian Twist is loaded core work (CI review).
  'spinal twist',
  'breathing',
  'legs up the wall',
  'pancake',
];

function startsAWord(name: string, term: string): boolean {
  let from = name.indexOf(term);
  while (from >= 0) {
    if (from === 0 || !/[a-z0-9]/.test(name[from - 1])) {
      return true;
    }
    from = name.indexOf(term, from + 1);
  }
  return false;
}

function classifyExercise(exercise: ProgramFocusSessionInput['exercises'][number]): ProgramFocusQuality {
  const normalized = exercise.exerciseName.trim().toLowerCase();
  if (MOBILITY_TERMS.some((term) => startsAWord(normalized, term))) {
    return 'Mobility';
  }
  if (CONDITIONING_TERMS.some((term) => startsAWord(normalized, term))) {
    return 'Conditioning';
  }
  // A hold's number is seconds, not reps: a 30-second plank is not heavy.
  const heavy =
    exercise.trackingMode !== 'hold' &&
    exercise.repsMax !== undefined &&
    exercise.repsMax > 0 &&
    exercise.repsMax <= STRENGTH_MAX_REPS;
  return heavy ? 'Strength' : 'Muscle';
}

/** The share of the week spent lifting, heavy or not. */
export function liftingFocusPct(split: ProgramFocusSegment[]): number {
  return split
    .filter((segment) => segment.quality === 'Strength' || segment.quality === 'Muscle')
    .reduce((sum, segment) => sum + segment.pct, 0);
}

/**
 * Percentages always sum to exactly 100 (largest-remainder rounding) and
 * qualities render in the fixed Strength → Conditioning → Mobility order.
 * Qualities the program does not train are omitted rather than shown as 0%.
 */
export function buildProgramFocusSplit(sessions: ProgramFocusSessionInput[]): ProgramFocusSegment[] {
  const weights: Record<ProgramFocusQuality, number> = { Strength: 0, Muscle: 0, Conditioning: 0, Mobility: 0 };

  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const quality = classifyExercise(exercise);
      weights[quality] += estimateFocusExerciseSeconds(exercise);
    }
  }

  const total = PROGRAM_FOCUS_ORDER.reduce((sum, quality) => sum + weights[quality], 0);
  if (total <= 0) {
    return [{ quality: 'Muscle', pct: 100 }];
  }

  const present = PROGRAM_FOCUS_ORDER.filter((quality) => weights[quality] > 0);
  const raw = present.map((quality) => (weights[quality] / total) * 100);
  const floored = raw.map((value) => Math.floor(value));
  let remainder = 100 - floored.reduce((sum, value) => sum + value, 0);

  const byFraction = raw
    .map((value, index) => ({ index, fraction: value - floored[index] }))
    .sort((left, right) => right.fraction - left.fraction);
  for (let step = 0; remainder > 0; step += 1, remainder -= 1) {
    floored[byFraction[step % byFraction.length].index] += 1;
  }

  return present
    .map((quality, index) => ({ quality, pct: floored[index] }))
    .filter((segment) => segment.pct > 0);
}
