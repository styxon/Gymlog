/**
 * The lifts a quick layout puts into each day it names.
 *
 * "Push / Pull / Legs" used to arrive as three named, empty days — a layout in
 * name only, and the reader still had to find every exercise. A day named for
 * a focus now opens with the two to four lifts almost any programme for that
 * focus starts from, and the reader edits from there.
 *
 * Names are the catalog's canonical ones — the same "Back Squat" the ready
 * programmes use — so they translate (exerciseNameLabel) and resolve to a
 * library item (findGuidedLibraryIndex) the way every other exercise in the
 * app does. Nothing here is invented: a test proves every name below resolves
 * against the real library, because a composer that once made up exercise
 * names is exactly how the sweep guard came to exist.
 */
import { findGuidedLibraryIndex } from './guidedPlayer';

/** Focus tokens a day name can carry, in the order they are checked. */
type QuickLayoutFocus =
  | 'push'
  | 'pull'
  | 'legs'
  | 'upper'
  | 'lower'
  | 'full_body'
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'arms'
  | 'triceps'
  | 'biceps'
  | 'glutes';

const FOCUS_LIFTS: Record<QuickLayoutFocus, string[]> = {
  push: ['Bench Press', 'Overhead Press', 'Incline Dumbbell Press', 'Triceps Pushdown'],
  pull: ['Barbell Row', 'Lat Pulldown', 'Seated Cable Row', 'Dumbbell Curl'],
  // Not the lower day's list: a week that holds both (Push / Pull / Legs /
  // Upper / Lower) squatted, hinged and pressed the same four lifts twice.
  legs: ['Back Squat', 'Romanian Deadlift', 'Leg Extension', 'Standing Calf Raise'],
  upper: ['Bench Press', 'Barbell Row', 'Overhead Press', 'Lat Pulldown'],
  lower: ['Back Squat', 'Romanian Deadlift', 'Leg Press', 'Lying Leg Curls'],
  full_body: ['Back Squat', 'Bench Press', 'Barbell Row'],
  chest: ['Bench Press', 'Incline Dumbbell Press', 'Cable Fly'],
  back: ['Barbell Row', 'Lat Pulldown', 'Seated Cable Row'],
  shoulders: ['Overhead Press', 'Lateral Raise', 'Face Pull'],
  arms: ['Barbell Curl', 'Triceps Pushdown', 'Hammer Curl', 'Skull Crusher'],
  triceps: ['Triceps Pushdown', 'Skull Crusher'],
  biceps: ['Dumbbell Curl', 'Hammer Curl'],
  glutes: ['Hip Thrust', 'Bulgarian Split Squat'],
};

/**
 * A day name can also say how it is trained: "Upper Heavy", "Push Volume",
 * "Lower Pump". The cards for those layouts promise a rotation of intensities,
 * and every focus used to read only its first word, so Heavy and Pump days came
 * out as the same four lifts (hunt 2026-10-09). A name with no qualifier, and
 * "Strength", which is the focus's usual day, takes the usual lifts above. Only
 * a day that names a single focus is asked.
 */
type QuickLayoutIntensity = 'heavy' | 'pump';

const INTENSITY_LIFTS: Partial<Record<QuickLayoutFocus, Partial<Record<QuickLayoutIntensity, string[]>>>> = {
  push: { pump: ['Incline Dumbbell Press', 'Cable Fly', 'Lateral Raise', 'Triceps Pushdown'] },
  pull: { pump: ['Lat Pulldown', 'Seated Cable Row', 'Face Pull', 'Hammer Curl'] },
  legs: { pump: ['Leg Press', 'Bulgarian Split Squat', 'Lying Leg Curls', 'Standing Calf Raise'] },
  upper: {
    heavy: ['Incline Bench Press', 'T-Bar Row', 'Dumbbell Shoulder Press', 'Lat Pulldown'],
    pump: ['Incline Dumbbell Press', 'Seated Cable Row', 'Lateral Raise', 'Dumbbell Curl'],
  },
  lower: {
    heavy: ['Deadlift', 'Front Squat', 'Hip Thrust', 'Seated Leg Curl'],
    pump: ['Leg Press', 'Bulgarian Split Squat', 'Lying Leg Curls', 'Standing Calf Raise'],
  },
};

const INTENSITY_PATTERNS: Array<[QuickLayoutIntensity, RegExp]> = [
  ['heavy', /\bheavy\b/i],
  ['pump', /\b(?:pump|volume)\b/i],
];

function parseQuickLayoutIntensity(dayName: string): QuickLayoutIntensity | null {
  return INTENSITY_PATTERNS.find(([, pattern]) => pattern.test(dayName))?.[0] ?? null;
}

/**
 * "Full Body A / B / C" are three different days, not one day three times:
 * the letter picks a rotation so a three-day full-body week does not squat,
 * bench and row on all three.
 */
const FULL_BODY_ROTATION: Record<string, string[]> = {
  A: ['Back Squat', 'Bench Press', 'Barbell Row'],
  B: ['Deadlift', 'Overhead Press', 'Lat Pulldown'],
  C: ['Front Squat', 'Incline Dumbbell Press', 'Seated Cable Row'],
};

const FOCUS_PATTERNS: Array<[QuickLayoutFocus, RegExp]> = [
  ['full_body', /full\s*body/i],
  ['push', /\bpush\b/i],
  ['pull', /\bpull\b/i],
  ['legs', /\blegs?\b/i],
  ['upper', /\bupper\b/i],
  ['lower', /\blower\b/i],
  ['chest', /\bchest\b/i],
  ['back', /\bback\b/i],
  ['shoulders', /\bshoulders?\b/i],
  ['arms', /\barms?\b/i],
  ['triceps', /\btriceps\b/i],
  ['biceps', /\bbiceps\b/i],
  ['glutes', /\bglutes?\b/i],
];

/** Which focuses a day name names, in the order it names them. */
export function parseQuickLayoutFocuses(dayName: string): QuickLayoutFocus[] {
  const found: Array<[QuickLayoutFocus, number]> = [];
  for (const [focus, pattern] of FOCUS_PATTERNS) {
    const match = pattern.exec(dayName);
    if (match) {
      found.push([focus, match.index]);
    }
  }
  return found.sort((left, right) => left[1] - right[1]).map(([focus]) => focus);
}

/**
 * The canonical lift names for a day, two to four of them, most-important
 * first. A day naming two focuses ("Chest / Triceps") takes the first two of
 * each; a day naming one takes up to four; an unrecognised name gets nothing,
 * which the editor shows as the empty day it always was.
 */
export function quickLayoutLiftNames(dayName: string): string[] {
  const rotation = /full\s*body\s+([abc])\b/i.exec(dayName);
  if (rotation) {
    return FULL_BODY_ROTATION[rotation[1].toUpperCase()] ?? FOCUS_LIFTS.full_body;
  }

  const focuses = parseQuickLayoutFocuses(dayName);
  if (focuses.length === 0) {
    return [];
  }

  const perFocus = focuses.length === 1 ? 4 : 2;
  const intensity = focuses.length === 1 ? parseQuickLayoutIntensity(dayName) : null;
  const names: string[] = [];
  for (const focus of focuses.slice(0, 2)) {
    const lifts = (intensity && INTENSITY_LIFTS[focus]?.[intensity]) || FOCUS_LIFTS[focus];
    for (const name of lifts.slice(0, perFocus)) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names.slice(0, 4);
}

/**
 * The lifts for a day with their library items, resolved by the same matcher
 * the player uses. The canonical name stays the exercise's name — it is what
 * translates cleanly and what the ready programmes use — and the library item
 * supplies media, defaults and history. A name the library cannot place is
 * dropped rather than shipped as text.
 */
export function resolveQuickLayoutExercises<T extends { name: string }>(
  dayName: string,
  library: T[],
): Array<{ name: string; item: T }> {
  const libraryNames = library.map((item) => item.name);
  const resolved: Array<{ name: string; item: T }> = [];
  for (const name of quickLayoutLiftNames(dayName)) {
    const index = findGuidedLibraryIndex(name, libraryNames);
    if (index !== null && !resolved.some((entry) => entry.item === library[index])) {
      resolved.push({ name, item: library[index] });
    }
  }
  return resolved;
}
