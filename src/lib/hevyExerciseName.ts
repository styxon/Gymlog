import type { ExerciseNameBookEntry } from '../types/models';
import { lookupNameBook } from './exerciseNameBook';

/**
 * A Hevy exercise title in the app's words.
 *
 * Hevy names a lift with its equipment in brackets: "Bench Press (Barbell)",
 * "Squat (Barbell)", "Bench Press (Dumbbell)". The programmes say "Bench
 * Press", "Back Squat" and "Dumbbell Bench Press". An imported history kept
 * Hevy's titles, so the weight a set opens on and its "Last time" card found
 * nothing for the main lifts of a real export, and a squat target read "not
 * logged yet" over years of squats (hunt, 2026-10-09).
 *
 * The bracket is the lift, not a coaching cue. The barbell is the lift the
 * bare name means, so "(Barbell)" is dropped. Any other implement is written
 * in front, the way the catalogue writes it, so a dumbbell or Smith machine
 * bench stays its own lift and never fills the barbell bench's target
 * (project rule: a dumbbell bench is not the bench). A bracket that is not
 * an implement ("Pull Up (Assisted)", the catalogue's "(Wide)") is left alone.
 *
 * Pure, and cheap enough to call per comparison: one regular expression and
 * two small table lookups.
 */

/** Hevy's implement, lower-case, and the word the app writes in front of the lift. Null: the bare name. */
const HEVY_EQUIPMENT = new Map<string, string | null>([
  ['barbell', null],
  ['dumbbell', 'Dumbbell'],
  ['smith machine', 'Smith Machine'],
  ['cable', 'Cable'],
  ['machine', 'Machine'],
  ['kettlebell', 'Kettlebell'],
  ['trap bar', 'Trap Bar'],
  ['ez bar', 'EZ Bar'],
  ['band', 'Band'],
  ['resistance band', 'Band'],
]);

/**
 * Where the rule above does not give the catalogue's name: keyed
 * `<lift>|<implement>`, lower-case. Only lifts the ready programmes train,
 * each checked against their spelling.
 */
const HEVY_ALIASES = new Map<string, string>([
  ['squat|barbell', 'Back Squat'],
  ['bent over row|barbell', 'Barbell Row'],
  ['upright row|barbell', 'Upright Barbell Row'],
  ['bicep curl|barbell', 'Barbell Curl'],
  ['bicep curl|dumbbell', 'Dumbbell Curl'],
  ['bicep curl|cable', 'Cable Curl'],
  ['skullcrusher|barbell', 'Skull Crusher'],
  ['incline bench press|dumbbell', 'Incline Dumbbell Press'],
  ['overhead press|dumbbell', 'Dumbbell Shoulder Press'],
  ['shoulder press|dumbbell', 'Dumbbell Shoulder Press'],
  ['lateral raise|dumbbell', 'Lateral Raise'],
  ['hammer curl|dumbbell', 'Hammer Curl'],
  // A machine or a cable that is the lift itself: the catalogue's bare name.
  ['lat pulldown|cable', 'Lat Pulldown'],
  ['lat pulldown|machine', 'Lat Pulldown'],
  ['seated cable row - v grip|cable', 'Seated Cable Row'],
  ['triceps pushdown|cable', 'Triceps Pushdown'],
  ['triceps rope pushdown|cable', 'Rope Pushdown'],
  ['face pull|cable', 'Face Pull'],
  ['cable crunch|cable', 'Cable Crunch'],
  ['leg press|machine', 'Leg Press'],
  ['leg extension|machine', 'Leg Extension'],
  ['lying leg curl|machine', 'Lying Leg Curl'],
  ['seated leg curl|machine', 'Seated Leg Curl'],
  ['hack squat|machine', 'Hack Squat'],
  ['standing calf raise|machine', 'Standing Calf Raise'],
  ['seated calf raise|machine', 'Seated Calf Raise'],
]);

const TRAILING_BRACKET = /^(.*?)\s*\(([^()]*)\)\s*$/;

/** The title with its implement read, or the title itself when it names none. */
function resolveEquipmentTitle(title: string): string {
  const match = title.match(TRAILING_BRACKET);
  if (!match) {
    return title;
  }
  const lift = match[1].trim();
  const implement = match[2].trim().toLowerCase().replace(/\s+/g, ' ');
  if (!lift || !HEVY_EQUIPMENT.has(implement)) {
    return title;
  }
  const alias = HEVY_ALIASES.get(`${lift.toLowerCase().replace(/\s+/g, ' ')}|${implement}`);
  if (alias) {
    return alias;
  }
  const prefix = HEVY_EQUIPMENT.get(implement);
  return prefix ? `${prefix} ${lift}` : lift;
}

/**
 * The app's name for a lift another app titled.
 *
 * The reader's own name book answers first: a spelling they taught the app
 * means what they said it means. Then the implement in brackets, as above.
 * Anything else comes back trimmed and otherwise as written.
 */
export function resolveImportedExerciseName(
  title: string,
  nameBook: readonly ExerciseNameBookEntry[] = [],
): string {
  const trimmed = (title ?? '').trim();
  if (!trimmed) {
    return trimmed;
  }
  const taught = nameBook.length > 0 ? lookupNameBook(nameBook, trimmed) : null;
  if (taught && taught.exerciseName.trim()) {
    return taught.exerciseName.trim();
  }
  return resolveEquipmentTitle(trimmed);
}
