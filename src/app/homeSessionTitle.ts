import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { inferPatternFromExerciseName } from '../lib/homeSessionHero';
import { t } from '../lib/i18n';
import { AppLanguage } from '../types/models';

/**
 * The goal tag on a program cover.
 *
 * Returned hardcoded English until an emulator pass found "Muscle" and
 * "Strength" sitting on cards in a Finnish app, directly under category chips
 * reading "Lihaskasvu" and "Voima". It reuses those same keys now, so the tag
 * and the chip that filters for it cannot say different words.
 */
export function formatGoalLabel(goalType: string, language: AppLanguage = 'en') {
  if (goalType === 'hypertrophy') {
    return t(language, 'programs.cat.muscle');
  }
  if (goalType === 'strength') {
    return t(language, 'programs.cat.strength');
  }
  return t(language, 'programs.cat.balanced');
}

const FOCUS_BY_PATTERN = {
  lower: 'Lower Focus',
  push: 'Push Focus',
  pull: 'Pull Focus',
} as const;

/**
 * The title an auto-named day takes from its opening lift. Conditioning and
 * the posterior chain are this title's own words and are asked first; the
 * rest is the session hero's push/pull/lower reading of the name
 * (inferPatternFromExerciseName), so the two cannot call one lift two things.
 * The title's own regex filed a step-up, a swing and a pull-through as Full
 * Body and a rear-delt fly as Push (dup sweep 13, D4-5).
 *
 * Conditioning names the machine and the dose, not only "HIIT": the hero
 * reads a sprint or high knees as lower-body work, which is right for its
 * muscle split and wrong for a day title — a day opening on "Sprint 40m" or
 * "Air Bike (30s sprint)" read "Lower Focus", and "Rowing Machine (500m
 * intervals)" "Full Body Focus" (review R2).
 */
const CONDITIONING_NAME =
  /(run|mobility|stretch|yoga|conditioning|hiit|sprint|interval|\bbike\b|rowing machine|\browers?\b|high knees)/;

function getExerciseFocusName(name: string) {
  const normalized = name.toLowerCase();
  if (CONDITIONING_NAME.test(normalized)) {
    return 'Conditioning Focus';
  }
  if (/(deadlift|\brdl\b|hip thrust|glute|leg curl|hamstring|pull-through|swing|good morning)/.test(normalized)) {
    return 'Posterior Focus';
  }
  const pattern = inferPatternFromExerciseName(name);
  return pattern ? FOCUS_BY_PATTERN[pattern] : 'Full Body Focus';
}

export function formatHomeSessionTitle(name: string, exercises: Array<{ name?: string; exerciseName?: string }>) {
  const displayName = formatWorkoutDisplayLabel(name, 'Workout');
  // "Päivä N" is the same placeholder in Finnish: the builder names new days in
  // the reader's language, and an English-only pattern left a new Finnish
  // programme's week strip reading "PÄI", "PÄI", "PÄI".
  if (!/^(minimal\s+[abc]|workout\s+[abc]|(?:day|päivä)\s+\d+|session\s+\d+)$/i.test(displayName.trim())) {
    // The full name, never sliced. A 20-character cap with hand-appended dots
    // lived here and cut "Day 1: Full Body + H|IIT" at exactly the H — and
    // because every surface builds its titles from this one card, the cut
    // rode through translation onto Home, Profile and the plan screen alike,
    // surviving three rounds of display fixes and one data-repair built on
    // the wrong theory (2026-08-25). Screens own their own line counts now;
    // an assembly layer has no business abbreviating.
    return displayName;
  }

  const primaryName = exercises[0]?.name ?? exercises[0]?.exerciseName ?? '';
  return getExerciseFocusName(primaryName);
}
