import { resolveCatalogBodyPart, resolveCatalogSourceCategory } from './catalogExercisePools';
import { I18nKey } from './i18n';

/**
 * "Mihin viikko menee" (design: GAINER Hourglass Shape) — the programme's
 * weekly sets grouped into four body areas, as a share of the whole.
 *
 * Computed from the sessions the programme actually prescribes, never written
 * per programme by hand: a distribution card that could disagree with the
 * exercise list below it would be the seed-data lie again, one card up.
 */

export type EmphasisArea =
  | 'glutesLegs'
  | 'shouldersBack'
  | 'chestArms'
  | 'core'
  | 'conditioning'
  | 'mobility'
  | 'other';

export const EMPHASIS_AREA_KEYS: Record<EmphasisArea, I18nKey> = {
  glutesLegs: 'detail.emphasis.glutesLegs',
  shouldersBack: 'detail.emphasis.shouldersBack',
  chestArms: 'detail.emphasis.chestArms',
  core: 'detail.emphasis.core',
  conditioning: 'detail.emphasis.conditioning',
  mobility: 'detail.emphasis.mobility',
  other: 'detail.emphasis.other',
};

const AREA_BY_BODY_PART: Record<string, EmphasisArea> = {
  glutes: 'glutesLegs',
  legs: 'glutesLegs',
  shoulders: 'shouldersBack',
  back: 'shouldersBack',
  chest: 'chestArms',
  biceps: 'chestArms',
  triceps: 'chestArms',
  core: 'core',
  'full body': 'other',
};

/**
 * Name fallback for lifts the catalog pools do not know.
 *
 * Conditioning and mobility come FIRST, because they are the two the body-part
 * lookup cannot answer at all: the library files a stretch under the muscle it
 * stretches and a sprint under `legs`, so asking it first would file half a
 * mobility programme as leg training. Everything else keeps the old order.
 */
const NAME_HINTS: Array<[RegExp, EmphasisArea]> = [
  // The walk blocks by name, never a bare "walk": a walking lunge is legs, a
  // heel-to-toe walk balance (VITAL Walk and VITAL Home, 2026-10-12).
  [
    /hiit|interval|sprint|\brun\b|running|\bjog|treadmill|stair|rowing machine|\bbike\b|cycling|elliptical|burpee|mountain climber|high knees|jumping jack|jump rope|skater|battle rope|prowler|sled|shuttle|agility|cone drill|ladder drill|stride|walk blocks?|brisk walk|incline walk|kävelyblok|pogo|box jump|broad jump|juoksu|tempojuoksu|intervalli|hyppynaru|kestävyys/i,
    'conditioning',
  ],
  [
    /stretch|\bpose\b|mobility|\bflow\b|breath|\bfold\b|salutation|circles|foam roll|-smr\b|thread the needle|dislocation|wall slide|legs up the wall|heel-to-toe|standing marching|venytys|liikkuvuus|avaus|hengitys|asento/i,
    'mobility',
  ],
  [/squat|lunge|deadlift|hip thrust|glute|hamstring|calf|leg |step-up|pistol|shrimp|abduct|fire hydrant|frog pump|kyykky|maastaveto|lantionnosto|pakara|askel|pohje|reisi/i, 'glutesLegs'],
  [/row|pull|lat |shoulder|press.*overhead|overhead.*press|lateral raise|face pull|shrug|muscle-?up|front lever|handstand|planche|soutu|veto|ylätalja|pystypunnerrus|sivunosto|olkapä|kohautus/i, 'shouldersBack'],
  [/bench|push-?up|chest|dip|curl|extension|tricep|bicep|fly|penkki|punnerrus|rinta|hauis|ojentaja|dippi/i, 'chestArms'],
  [/plank|crunch|sit-?up|ab |core|dead bug|bird ?dog|twist|hollow body|l-sit|dragon flag|v-up|toes-to-bar|pelvic floor|vacuum|transverse abdominis|heel slide|side bend|lankku|rutistus|vatsa|keskivartalo|kierto|lantionpohja/i, 'core'],
];

export interface EmphasisSlice {
  area: EmphasisArea;
  sets: number;
  /** Whole percentages summing to exactly 100 (largest remainder). */
  percent: number;
}

export interface ProgramEmphasis {
  totalSets: number;
  /** Areas with at least one set, largest first. */
  slices: EmphasisSlice[];
}

/**
 * The two areas the body-part lookup cannot answer, so the name decides them
 * before it is asked. The library files a hamstring stretch under `legs` and a
 * sprint under `legs` too — trusting it first would report a mobility
 * programme's week as leg training.
 */
const NAME_WINS: ReadonlySet<EmphasisArea> = new Set(['conditioning', 'mobility']);

function areaForExercise(name: string): EmphasisArea {
  // The library's own `cardio` category is small and never wrong.
  if (resolveCatalogSourceCategory(name) === 'cardio') {
    return 'conditioning';
  }
  for (const [pattern, area] of NAME_HINTS) {
    if (NAME_WINS.has(area) && pattern.test(name)) {
      return area;
    }
  }

  const bodyPart = resolveCatalogBodyPart(name);
  if (bodyPart && AREA_BY_BODY_PART[bodyPart]) {
    return AREA_BY_BODY_PART[bodyPart];
  }
  for (const [pattern, area] of NAME_HINTS) {
    if (pattern.test(name)) {
      return area;
    }
  }
  return 'other';
}

/**
 * The share maths, split out because the editing sheet holds items that are
 * ALREADY classified — passing them back through the name classifier would
 * drop every one of them into `other`, and the sheet's preview bar would
 * disagree with the card that opened it.
 */
export function summariseEmphasis(
  items: ReadonlyArray<{ area: EmphasisArea; sets: number }>,
): ProgramEmphasis | null {
  const setsByArea = new Map<EmphasisArea, number>();
  let totalSets = 0;

  for (const item of items) {
    const sets = Math.max(0, item.sets);
    if (sets === 0) {
      continue;
    }
    setsByArea.set(item.area, (setsByArea.get(item.area) ?? 0) + sets);
    totalSets += sets;
  }

  if (totalSets === 0) {
    return null;
  }

  const raw = [...setsByArea.entries()]
    .map(([area, sets]) => ({ area, sets, exact: (sets / totalSets) * 100 }))
    .sort((left, right) => right.sets - left.sets);

  // Largest remainder, so the legend's whole numbers sum to exactly 100 —
  // "57 + 33 + 5 + 5" and never 99 or 101.
  const floors = raw.map((slice) => Math.floor(slice.exact));
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((slice, index) => ({ index, frac: slice.exact - floors[index] }))
    .sort((left, right) => right.frac - left.frac);
  for (const { index } of order) {
    if (remainder <= 0) {
      break;
    }
    floors[index] += 1;
    remainder -= 1;
  }

  return {
    totalSets,
    slices: raw.map((slice, index) => ({ area: slice.area, sets: slice.sets, percent: floors[index] })),
  };
}

export function resolveProgramEmphasis(
  sessions: ReadonlyArray<{ exercises: ReadonlyArray<{ name: string; sets: number }> }>,
): ProgramEmphasis | null {
  return summariseEmphasis(
    sessions.flatMap((session) =>
      session.exercises.map((exercise) => ({ area: areaForExercise(exercise.name), sets: exercise.sets })),
    ),
  );
}

/** The area an exercise's sets count towards — exposed for the editing sheet. */
export function emphasisAreaForExercise(name: string): EmphasisArea {
  return areaForExercise(name);
}
