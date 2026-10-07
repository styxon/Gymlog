import { EQUIPMENT_RULES_FOR_DISPLAY, equipmentRuleMatches, libraryEquipmentRequirement } from './equipmentExerciseFilter';
import { I18nKey } from './i18n';

/**
 * What a program actually needs, as chips.
 *
 * The catalog stores one sentence per program — "Vaatii täyden salin: tangot,
 * käsipainot, ylätalja…" — which is prose a reader has to parse and which
 * nothing can check against their own gym. The equipment is already derivable:
 * `equipmentExerciseFilter` matches exercise names to required gear in order to
 * SWAP exercises the reader cannot do, and the same table answers "what does
 * this program need" if you read it forwards instead of backwards.
 *
 * The chip names are the ones onboarding already stores, so the two lists can
 * be compared directly rather than through a mapping that would drift.
 */

/** Canonical chips, in the order a gym is usually described. */
const CHIP_ORDER = [
  'Barbells',
  'Barbell & plates',
  'Squat rack',
  'Bench',
  'Dumbbells',
  'Kettlebells',
  'Machines',
  'Cables',
  'Pull-up bar',
  'Resistance bands',
  'Cardio machines',
  'Yoga mat',
] as const;

export type EquipmentChip = (typeof CHIP_ORDER)[number];

export const EQUIPMENT_CHIP_KEYS: Record<string, I18nKey> = {
  Barbells: 'equip.barbell',
  'Barbell & plates': 'equip.barbellPlates',
  'Squat rack': 'equip.rack',
  Bench: 'equip.bench',
  Dumbbells: 'equip.dumbbells',
  Kettlebells: 'equip.kettlebells',
  Machines: 'equip.machines',
  Cables: 'equip.cables',
  'Pull-up bar': 'equip.pullupBar',
  'Resistance bands': 'equip.bands',
  'Cardio machines': 'equip.cardio',
  'Yoga mat': 'equip.mat',
};

const FURNITURE = new Set(['Bench', 'Squat rack', 'Pull-up bar']);

/** The chip a name says it is done with, when it names one. */
const NAMED_CHIPS: Array<[string, string]> = [
  ['dumbbell', 'Dumbbells'],
  ['kettlebell', 'Kettlebells'],
  ['band', 'Resistance bands'],
  ['barbell', 'Barbells'],
  ['cable', 'Cables'],
  ['machine', 'Machines'],
];

/**
 * One chip per requirement group for one exercise.
 *
 * Each group is a list of alternatives, and the first used to be taken
 * whatever the name said: a dumbbell curl matched the generic curl rule
 * (barbell, dumbbells or band) and listed a barbell, so a dumbbells-only
 * programme was filed as needing a gym (2026-10-04). An alternative the name
 * itself names wins; then one another group of the same exercise already
 * needs; only then the first.
 */
function chipsForExercise(normalized: string): string[] {
  const groups: string[][] = [];
  for (const rule of EQUIPMENT_RULES_FOR_DISPLAY) {
    if (equipmentRuleMatches(normalized, rule)) {
      groups.push(...rule.requires.filter((group) => group.length > 0));
    }
  }
  // The band or ball a library row needs without naming it — the same
  // requirement the swap filter reads, so the two directions agree.
  const fromLibrary = libraryEquipmentRequirement(normalized);
  if (fromLibrary) {
    groups.push(fromLibrary);
  }
  const named = NAMED_CHIPS.filter(([word]) => normalized.includes(word)).map(([, chip]) => chip);
  const chosen = new Set<string>();
  // Groups with a single way to satisfy them decide first, so the others can
  // lean on what is already required.
  const ordered = [...groups].sort((left, right) => left.length - right.length);
  for (const group of ordered) {
    // Furniture leads its group on purpose: a hip thrust needs the bench
    // whichever weight is on the hips, so a bench-first group keeps its bench.
    const pick = FURNITURE.has(group[0])
      ? group[0]
      : group.find((item) => named.includes(item)) ?? group.find((item) => chosen.has(item)) ?? group[0];
    chosen.add(pick);
  }
  return [...chosen];
}

/**
 * The gear a list of exercises requires, deduplicated and ordered.
 *
 * Each rule states its requirement as alternatives — a bench press needs a
 * barbell OR barbell-and-plates — and the FIRST alternative is taken as the
 * chip to show. Listing every alternative would turn a six-chip program into
 * fifteen chips that mostly mean the same thing.
 */
export function resolveProgramEquipment(exerciseNames: readonly string[]): EquipmentChip[] {
  const needed = new Set<string>();

  for (const name of exerciseNames) {
    const normalized = name.trim().toLowerCase();
    // "Hip Thrust (Bodyweight)" matched the hip-thrust rule and claimed a
    // bench, so a postpartum program that needs a floor was listed as needing
    // gym furniture. When the name says bodyweight, it means it.
    if (normalized.includes('bodyweight')) {
      continue;
    }
    for (const chip of chipsForExercise(normalized)) {
      needed.add(chip);
    }
  }

  return CHIP_ORDER.filter((chip) => needed.has(chip));
}

/** Whether a program can be run outside a gym. */
export type ProgramEquipmentBucket = 'full_gym' | 'low_equipment';

/**
 * The chips a reader can own without a gym membership. A doorway pull-up bar,
 * a pair of dumbbells and a band are a corner of a room; a squat rack, a cable
 * station and a leg press are a building.
 */
const HOME_EQUIPMENT_CHIPS = new Set<EquipmentChip>([
  'Dumbbells',
  'Kettlebells',
  'Resistance bands',
  'Yoga mat',
  'Pull-up bar',
]);

/**
 * Which bucket a program falls in, from the gear its exercises need.
 *
 * This used to be read out of the English equipment sentence: a program was
 * low-equipment if that prose contained "bodyweight", "minimal setup" or
 * "no heavy equipment", with four template ids hardcoded beside it (twice —
 * `tailoringFit` and `workoutDiscovery` each kept their own copy of the list).
 *
 * So the recommendation score and the catalog's equipment filter turned on a
 * marketing sentence, and rewriting that sentence silently moved programs
 * between buckets. Mobility Flow needs a band and a mat and said so in words
 * the rule did not know, so it was scored as a full-gym program and lost
 * points for readers who train at home. The exercises are the fact; the
 * sentence is a description of it.
 */
export function resolveProgramEquipmentBucket(
  exerciseNames: readonly string[],
): ProgramEquipmentBucket {
  const needed = resolveProgramEquipment(exerciseNames);
  return needed.every((chip) => HOME_EQUIPMENT_CHIPS.has(chip)) ? 'low_equipment' : 'full_gym';
}

/**
 * Chips the program needs that the reader's gym does not have.
 *
 * `available === null` means the setup never said, and an unknown gym cannot
 * be missing anything — the screen shows the chips without a verdict rather
 * than claiming everything fits.
 */
export function missingEquipment(
  needed: readonly EquipmentChip[],
  available: readonly string[] | null,
): EquipmentChip[] {
  if (available === null) {
    return [];
  }
  const have = new Set(available);
  // A barbell rack counts as a barbell: the two chips describe the same corner
  // of a gym, and demanding both would report a missing item nobody is missing.
  const satisfied = (chip: EquipmentChip) =>
    have.has(chip) ||
    (chip === 'Barbells' && have.has('Barbell & plates')) ||
    (chip === 'Barbell & plates' && have.has('Barbells'));
  return needed.filter((chip) => !satisfied(chip));
}
