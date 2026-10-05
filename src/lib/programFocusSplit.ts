/**
 * Honest "where your week goes" split for a program: the share of programmed
 * training time (weighted by set count) spent on each quality. This is a
 * factual composition of the plan's exercises — never a promised outcome.
 */

import { I18nKey, t } from './i18n';
import type { AppLanguage } from '../types/models';

/** Structural subset so both catalog sessions and composed weeks fit. */
export interface ProgramFocusSessionInput {
  exercises: Array<{ exerciseName: string; sets: number }>;
}

export type ProgramFocusQuality = 'Strength' | 'Conditioning' | 'Mobility';

export interface ProgramFocusSegment {
  quality: ProgramFocusQuality;
  pct: number;
}

// Fixed color code: same color = same quality everywhere it is rendered.
export const PROGRAM_FOCUS_COLORS: Record<ProgramFocusQuality, string> = {
  Strength: '#F59E0B',
  Conditioning: '#38BDF8',
  Mobility: '#34D399',
};

// The quality is an identifier and stays English; only the label translates.
const PROGRAM_FOCUS_LABEL_KEYS: Record<ProgramFocusQuality, I18nKey> = {
  Strength: 'focus.quality.strength',
  Conditioning: 'focus.quality.conditioning',
  Mobility: 'focus.quality.mobility',
};

export function getProgramFocusQualityLabel(
  quality: ProgramFocusQuality,
  language: AppLanguage = 'en',
): string {
  return t(language, PROGRAM_FOCUS_LABEL_KEYS[quality]);
}

const PROGRAM_FOCUS_ORDER: ProgramFocusQuality[] = ['Strength', 'Conditioning', 'Mobility'];

// Matched at the start of a word in the lowercased exercise name. 'walk' is
// deliberately absent (Walking Lunge is strength work); farmer carries match
// via 'farmer' and 'carry'.
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
  'hop',
  'plank jack',
  'stride',
  'skater',
  'shadow box',
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
  'twist',
  'breathing',
  'legs up the wall',
  'butterfly',
  'frog',
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

function classifyExerciseName(name: string): ProgramFocusQuality {
  const normalized = name.trim().toLowerCase();
  if (MOBILITY_TERMS.some((term) => startsAWord(normalized, term))) {
    return 'Mobility';
  }
  if (CONDITIONING_TERMS.some((term) => startsAWord(normalized, term))) {
    return 'Conditioning';
  }
  return 'Strength';
}

/**
 * Percentages always sum to exactly 100 (largest-remainder rounding) and
 * qualities render in the fixed Strength → Conditioning → Mobility order.
 * Qualities the program does not train are omitted rather than shown as 0%.
 */
export function buildProgramFocusSplit(sessions: ProgramFocusSessionInput[]): ProgramFocusSegment[] {
  const weights: Record<ProgramFocusQuality, number> = { Strength: 0, Conditioning: 0, Mobility: 0 };

  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const quality = classifyExerciseName(exercise.exerciseName);
      weights[quality] += Math.max(1, exercise.sets);
    }
  }

  const total = PROGRAM_FOCUS_ORDER.reduce((sum, quality) => sum + weights[quality], 0);
  if (total <= 0) {
    return [{ quality: 'Strength', pct: 100 }];
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
