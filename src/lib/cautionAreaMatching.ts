import { SetupCautionArea, SetupCautionFlag } from '../types/models';

/**
 * Which exercise names load a flagged body area.
 *
 * Kept apart from cautionExerciseFilter (which swaps and removes exercises and
 * so needs the exercise catalog) so that anything that only has to ASK "does
 * this lift load the area" -- the progression hold, the plateau card, the
 * coach context built on the server -- does not pull the catalog in.
 *
 * Everything is exercise-NAME based. A name is split into words (hyphens,
 * spaces and punctuation all separate them, so "Step-Up" and "Step Ups" read
 * alike) and a pattern matches when its words appear in a row, each allowing
 * the plain English endings s, es and ing ("run" matches "Running", "dip"
 * matches "Dipping"). It never matches inside a word: "run" is not in
 * "Crunch". Per-area EXCLUSION phrases mask words that appear in a name
 * without loading the joint ("curl" in "Leg Curl" is not an elbow lift) before
 * the patterns are tried, and VETO phrases take a whole area out ("head on
 * bench" is not a hinge). A few words a reader's own Finnish names compound on
 * (Penkkidippi, Hauiscurl) also match at the end of a longer word, which is
 * what the old substring rule caught.
 */

// Broad per-area stress patterns. `avoid` removes every match.
const AREA_AVOID_PATTERNS: Record<SetupCautionArea, string[]> = {
  shoulders: [
    'overhead press',
    'shoulder press',
    'push press',
    'arnold press',
    // The focus pool's spelling of the same press.
    'arnold dumbbell press',
    // Presses overhead whose names do not say "shoulder" or "overhead": the
    // seated dumbbell press sits in vertical_press in five ready programmes,
    // and a thruster ends overhead (programmeBrief already lists all three).
    'seated dumbbell press',
    'kettlebell seated press',
    'thruster',
    'upright row',
    'upright barbell row',
    'lateral raise',
    'rear delt',
    'handstand',
    'dip',
    'dippi',
  ],
  lower_back: [
    'deadlift',
    'romanian',
    'good morning',
    'bent-over',
    'barbell row',
    'pendlay',
    'back extension',
    'lower back curl',
    'kettlebell swing',
    'clean',
    'snatch',
    // The same hinges under other names: Single-Leg RDL stayed in a week
    // that avoided the lower back while its long name, Single-Leg Romanian
    // Deadlift, was removed (persona hunt, 2026-10-08). A pull-through and a
    // stiff-legged lift are loaded hinges; the reverse hyperextension is the
    // back-friendly one and is excluded below.
    'rdl',
    'pull-through',
    'stiff-legged',
    'stiff legs',
    'hyperextension',
  ],
  knees: [
    'squat',
    'lunge',
    'leg press',
    'leg extension',
    'step-up',
    'pistol',
    'box jump',
    'wall sit',
    // The front squat inside a press: "Dumbbell Thruster" survived a knee
    // "avoid" in three ready programmes because no pattern named it.
    'thruster',
    // Landings load the knee too: a knee "avoid" still left Burpee, Jumping
    // Jack and Mountain Climber in the week (recommendation matrix, 2026-10-05).
    'jump',
    'jumping',
    'burpee',
    'mountain climber',
    'skater',
    'pogo',
    'high knee',
    // And so do running and the other landings: a knee "avoid" still kept
    // Sprint 40m, Tempo Run Blocks, Stride Finishers and Lateral Bound
    // (bug hunt, 2026-10-05, B8). Whole words, so "run" is not in "Crunch"
    // and not in "Runner's Stretch".
    'run',
    'jog',
    'sprint',
    'stride',
    'treadmill hiit',
    'bound',
    'hop',
    'leap',
    'skip',
    'shuffle',
    'carioca',
    'agility',
    'cone drill',
    'ladder drill',
  ],
  elbows: [
    'curl',
    'skull crusher',
    'triceps',
    // The singular is the library's own spelling for half its triceps work
    // (Lying Dumbbell Tricep Extension, Tricep Dumbbell Kickback), and a
    // whole-word match on "triceps" does not match the word "tricep" (hunt,
    // 2026-10-09).
    'tricep',
    'jm press',
    'close-grip',
    'diamond',
    'pushdown',
    'dip',
    'dippi',
  ],
  // A dip holds the wrist in loaded extension: a wrists "avoid" week dropped
  // every push-up and kept Bench Dips (persona hunt, 2026-10-08). Elbows and
  // shoulders already list it, with the Finnish compounds the rule catches.
  wrists: [
    'barbell curl',
    'push-up',
    'front squat',
    'handstand',
    'wrist',
    'dip',
    'dippi',
    // Weight carried on the palms in wrist extension: a wrists "avoid" week
    // kept Tuck Planche Hold, L-Sit Hold and the plank variants done on the
    // hands while every push-up was gone (hunt, 2026-10-09). A plain Plank and
    // Side Plank are forearm work and stay.
    'planche',
    'l-sit',
    'plank jack',
    'plank shoulder tap',
    'plank to pike',
    'plank-up',
    'inchworm',
    'crawl',
  ],
  hips: [
    'hip thrust',
    'sumo',
    'adductor',
    'abductor',
    'bulgarian',
    'pistol',
    // The hip mobility and activation work: hips "avoid" left the whole Hip
    // Opening Flow day, Hip Circles and Kneeling Hip Flexor in the week while
    // saying the area was out (hunt, 2026-10-09). Any name with the word "hip"
    // is a hip drill (Hip Flexor Stretch, 90/90 Hip Stretch, Hip Extension with
    // Bands). "Butterfly" alone is the chest fly machine, so it takes "stretch".
    'hip',
    'pigeon',
    'couch stretch',
    'frog',
    'cossack',
    'butterfly stretch',
    'deep squat hold',
    'fire hydrant',
  ],
  neck: [
    'shrug',
    'neck',
    'behind-the-neck',
    // A neck stretch that does not say "neck", and the head-loaded inversions.
    'chin to chest',
    'handstand',
  ],
  ankles: [
    'calf raise',
    'calf press',
    'jump',
    'skipping',
    'sprint',
    'run',
    'jog',
    'treadmill',
    'stride',
    // The landings and cuts the knees list took in on 2026-10-05 (B8) load the
    // ankle as much: ankles "avoid" kept Lateral Bound, Cone Drill, Ladder
    // Drill, High Knees, Burpee and Pogo Hops (hunt, 2026-10-09).
    'bound',
    'hop',
    'leap',
    'skip',
    'pogo',
    'skater',
    'burpee',
    'mountain climber',
    'high knee',
    'shuffle',
    'carioca',
    'agility',
    'cone drill',
    'ladder drill',
  ],
};

// Phrases that contain a pattern word but do not load the area. Their words are
// masked out of the name before the patterns above are tried, so the rest of
// the name still counts ("Leg Curl and Triceps Pushdown" is still a triceps
// lift). Add one only for a name that is a real false positive.
const AREA_EXCLUDE_PATTERNS: Record<SetupCautionArea, string[]> = {
  shoulders: [],
  // A grip, rows done upright or supported on a bench, and the reverse
  // hyperextension (hips swung over a bench, a back-friendly lift) are not a hinge.
  lower_back: ['clean grip', 'upright barbell row', 'lying cambered barbell row', 'reverse hyperextension'],
  // The leg press of a calf press is done with straight legs.
  knees: ['calf press on the leg press'],
  // "curl" is also the hamstring curl and the prone back raise, and the
  // Finnish leg curls ("jalkacurl") that the compound rule below would catch.
  elbows: [
    'leg curl',
    'hamstring curl',
    'lower back curl',
    'jalkacurl',
    'reisicurl',
    'takareisicurl',
    'jalka curl',
    'reisi curl',
    'takareisi curl',
  ],
  wrists: [],
  hips: [],
  neck: [],
  ankles: [],
};

export function normalize(name: string) {
  return name.trim().toLowerCase();
}

/** Lowercase words; every run of non-letters/digits is one boundary (a-umlaut and o-umlaut are letters). */
export function words(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

// Phrases that take the area out altogether: the bench or the chest carries the
// back, so a bent-over word in the name does not make it a hinge. Unlike an
// exclusion, nothing else in the name is tried.
const AREA_VETO_PHRASES: Partial<Record<SetupCautionArea, string[]>> = {
  lower_back: ['head on bench', 'chest supported'],
  // A sprint on a bike is seated, with nothing to land on: "Bike HIIT (45s
  // sprint / 15s rest)" is what the ankle swap hands a runner, and is the
  // knee-friendly conditioning, not a run.
  knees: ['bike'],
};

const phraseCache = new Map<string, string[]>();
export function phraseWords(phrase: string): string[] {
  let cached = phraseCache.get(phrase);
  if (!cached) {
    cached = words(phrase);
    phraseCache.set(phrase, cached);
  }
  return cached;
}

/**
 * Words a reader's own Finnish names build compounds on (Penkkidippi,
 * Hauiscurl, Vasaracurl). The old substring rule caught these inside the longer
 * word, so for just these a name word may END in the base. Not for any other
 * pattern: "run" must stay out of "crunch".
 */
const COMPOUND_FINAL_BASES = new Set([
  'dip',
  'dippi',
  'curl',
  // The Finnish leg curls the elbow exclusions name: Reisicurlit, Jalkacurlit.
  'jalkacurl',
  'reisicurl',
  'takareisicurl',
]);

/** `word` is `base` or `base` with a plain ending: s, es, ing (run -> running, lunge -> lunging). */
function wordMatches(word: string | null, base: string): boolean {
  if (word === null) {
    return false;
  }
  if (COMPOUND_FINAL_BASES.has(base) && word.length > base.length) {
    if (word.endsWith(base) || word.endsWith(`${base}s`) || word.endsWith(`${base}it`) || word.endsWith(`${base}es`)) {
      return true;
    }
  }
  if (word === base || word === `${base}s` || word === `${base}es` || word === `${base}ing`) {
    return true;
  }
  if (word === `${base}${base.slice(-1)}ing`) {
    return true;
  }
  return base.endsWith('e') && word === `${base.slice(0, -1)}ing`;
}

/** Index of the first place `phrase`'s words appear in a row in `nameWords`, or -1. */
export function findPhrase(nameWords: Array<string | null>, phrase: string[]): number {
  if (phrase.length === 0) {
    return -1;
  }
  for (let start = 0; start + phrase.length <= nameWords.length; start += 1) {
    if (phrase.every((base, offset) => wordMatches(nameWords[start + offset], base))) {
      return start;
    }
  }
  return -1;
}

export function exerciseHitsCautionArea(exerciseName: string, area: SetupCautionArea): boolean {
  const nameWords: Array<string | null> = words(exerciseName);
  for (const veto of AREA_VETO_PHRASES[area] ?? []) {
    if (findPhrase(nameWords, phraseWords(veto)) !== -1) {
      return false;
    }
  }
  for (const exclusion of AREA_EXCLUDE_PATTERNS[area]) {
    const phrase = phraseWords(exclusion);
    for (let at = findPhrase(nameWords, phrase); at !== -1; at = findPhrase(nameWords, phrase)) {
      for (let offset = 0; offset < phrase.length; offset += 1) {
        nameWords[at + offset] = null;
      }
    }
  }
  return AREA_AVOID_PATTERNS[area].some((pattern) => findPhrase(nameWords, phraseWords(pattern)) !== -1);
}

/**
 * The flagged area a lift loads, for the progression hold, or null.
 *
 * Only `careful` and `avoid` count — `info` promises nothing about training.
 * An `avoid` match normally never reaches a session (the filter removes it),
 * but a lift the reader added by hand can, and it is held the same way. The
 * same name patterns as the filter decide "loads this area", so a swap the
 * filter picked because it spares the area (Leg Press -> Hip Thrust for knees)
 * progresses normally, and one that still loads it (Box Squat) is held.
 */
export function cautionAreaLoadedBy(
  exerciseName: string,
  flags: SetupCautionFlag[] | null | undefined,
): SetupCautionArea | null {
  for (const flag of flags ?? []) {
    if (flag.level !== 'info' && exerciseHitsCautionArea(exerciseName, flag.area)) {
      return flag.area;
    }
  }
  return null;
}

/**
 * The areas the reader said to leave out ENTIRELY (`avoid`), for the blocks the
 * exercise filter never sees: the warm-up and cool-down drills. `careful` is not
 * here on purpose -- it swaps heavier lifts for gentler ones and promises no
 * absence, so a light warm-up squat for a careful knee is consistent with it.
 */
export function avoidedCautionAreas(flags: readonly SetupCautionFlag[] | null | undefined): SetupCautionArea[] {
  const areas: SetupCautionArea[] = [];
  for (const flag of flags ?? []) {
    if (flag.level === 'avoid' && !areas.includes(flag.area)) {
      areas.push(flag.area);
    }
  }
  return areas;
}
