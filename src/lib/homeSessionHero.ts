/**
 * Pure helpers for the Home v4 session hero (design_handoff_home_v4).
 * Focus title, body-focus label, week phase, equipment line, default
 * warmup/cooldown blocks, and the Adapt-sheet trim estimate.
 */
import { avoidedCautionAreas, exerciseHitsCautionArea } from './cautionAreaMatching';
import { resolveCatalogBodyPart, resolveCatalogSourceCategory } from './catalogExercisePools';
import { estimateRoutineBlockSeconds } from './guidedPlayer';
import { I18nKey, t } from './i18n';
import { AppLanguage, SetupCautionArea, SetupCautionFlag } from '../types/models';

export interface SessionDrill {
  /**
   * The drill's own i18n key — its identity across languages and equipment.
   *
   * A swap has to name what it picked, and the NAME is a translation: a
   * Finnish reader who swaps in "Kissa–kamelivenytys" must still get the
   * cat-camel after switching the app to English.
   */
  key: I18nKey;
  name: string;
  schemeLabel: string;
}

export interface SessionRoutineBlock {
  drills: SessionDrill[];
  minutes: number;
}

/**
 * "Day 2: Back & Biceps" -> "Back & Biceps", "Push A: Chest Focus" -> "Push",
 * "Strength A" -> "Strength".
 * Falls back to the plan title's focus word when the session has no name.
 */
export function getSessionFocusTitle(sessionTitle?: string | null, planTitle?: string | null): string {
  const base = sessionTitle?.trim() || planTitle?.trim() || 'Workout';
  const [head, ...rest] = base.split(':');
  const afterColon = rest.join(':').trim();
  const beforeColon = head.trim();
  // Both spellings of the ordinal. A duplicated or composed custom programme
  // SAVES its session names in Finnish by design (customProgramDuplication),
  // so "Päivä 4: Ylävartalo + HIIT" arrives here — and an English-only test
  // let it fall through to the suffix strip below, which removed the "4" and
  // put the bare word "Päivä" on the Home hero (user 2026-08-26). Same shape
  // as the truncation saga: an assembly helper that only knew English.
  if (/^(?:day|päivä)\s*\d+$/i.test(beforeColon)) {
    // The focus when there is one; otherwise the ordinal itself, which is all
    // the session has to show — and is still better than half of it.
    return afterColon || beforeColon;
  }
  const stripped = beforeColon.replace(/\s+(?:[A-Ca-c]|\d+)$/, '').trim();
  return stripped || beforeColon || 'Workout';
}

/** 'full_body' -> 'Full body', 'push_pull_legs' -> 'Push / pull / legs'. */
export function getSessionBodyFocusLabel(splitType?: string | null): string {
  if (!splitType) {
    return 'Full body';
  }
  const parts = splitType.split('_').filter(Boolean);
  if (!parts.length) {
    return 'Full body';
  }
  if (parts.join(' ') === 'full body') {
    return 'Full body';
  }
  const label = parts.join(' / ');
  return label[0].toUpperCase() + label.slice(1);
}

/** Early third of the plan is "building", middle "progressing", final "peaking". */
export function getPlanWeekPhase(currentWeek: number, totalWeeks: number): string {
  const safeTotal = Math.max(1, totalWeeks);
  const week = Math.min(Math.max(1, currentWeek), safeTotal);
  const ratio = week / safeTotal;
  if (ratio <= 1 / 3) {
    return 'building';
  }
  if (ratio <= 2 / 3) {
    return 'progressing';
  }
  return 'peaking';
}

const EQUIPMENT_LABELS: Record<string, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbells',
  machine: 'Machines',
  cable: 'Cables',
};

/**
 * Infers equipment from an exercise name when the library has no exact match
 * (plan names like "Back Squat" vs library names like "Barbell Squat").
 * Explicit equipment words win; classic barbell lifts and bodyweight moves
 * are recognized by pattern; anything else stays unknown (null).
 */
export function inferEquipmentFromExerciseName(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  if (/\bdumbbell\b|\bdb\b/.test(normalized)) {
    return 'dumbbell';
  }
  if (/\bcable\b|pulldown|pushdown|face pull/.test(normalized)) {
    return 'cable';
  }
  if (/\bmachine\b|leg press|leg extension|leg curl|pec deck|\bsmith\b/.test(normalized)) {
    return 'machine';
  }
  if (/\bbarbell\b|back squat|front squat|bench press|deadlift|overhead press|military press|power clean|hip thrust/.test(normalized)) {
    return 'barbell';
  }
  if (/\bplank\b|push-?up|pull-?up|chin-?up|\bdip\b|crunch|sit-?up|bodyweight|air squat|\bhang\b/.test(normalized)) {
    return 'bodyweight';
  }
  return null;
}

/**
 * Builds the bold equipment list ("Barbell, Dumbbells & Cables") from the
 * session's exercises via the exercise library, falling back to name-based
 * inference for names the library doesn't know verbatim. Returns null when
 * the session is bodyweight-only (or nothing resolves) so the row can hide.
 */
export function buildSessionEquipmentLabel(
  exerciseNames: string[],
  library: Array<{ name: string; equipment: string }>,
): string | null {
  const equipmentByName = new Map(library.map((item) => [item.name.trim().toLowerCase(), item.equipment]));
  const found: string[] = [];
  for (const name of exerciseNames) {
    const equipment = equipmentByName.get(name.trim().toLowerCase()) ?? inferEquipmentFromExerciseName(name);
    if (equipment && equipment !== 'bodyweight' && !found.includes(equipment)) {
      found.push(equipment);
    }
  }
  if (!found.length) {
    return null;
  }
  const labels = found.map((equipment) => EQUIPMENT_LABELS[equipment] ?? equipment);
  if (labels.length === 1) {
    return labels[0];
  }
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
}

/**
 * `easy` is a day with nothing to lift: only stretches, mobility flows and
 * runs. It used to read as `general`, whose block is written for a mixed
 * strength day -- so a yoga flow warmed up with push-ups and ended on a chest
 * stretch, and the minutes of that block were counted into the day.
 */
export type SessionFocusKind = 'lower' | 'push' | 'pull' | 'upper' | 'general' | 'easy';

/**
 * Catalog body part → the movement pattern whose prep and stretches it wants.
 * `core` and `full body` are deliberately absent: they appear on every kind of
 * day, so counting them would only blur the majority.
 */
const PATTERN_BY_BODY_PART: Record<string, 'push' | 'pull' | 'lower'> = {
  chest: 'push',
  shoulders: 'push',
  triceps: 'push',
  back: 'pull',
  biceps: 'pull',
  legs: 'lower',
  glutes: 'lower',
};

/**
 * Movement pattern from the exercise name, for the names the library cannot
 * match. Two thirds of the ready catalogs' exercise names miss the library —
 * "Chest-Supported Row" appears 24 times and resolves to nothing — and without
 * this the classifier is blind on exactly the sessions it most needs to read.
 *
 * Matches on the MOVEMENT word, not the muscle: "Chest-Supported Row" is a row.
 * Lower goes first so "Cable Pull-Through" lands as a hinge, not as a pull.
 * Anything unmatched returns null and gets no vote — core, mobility flows and
 * conditioning appear on every kind of day, so a guess there would only blur
 * the majority. Same approach, and same reason, as
 * `inferEquipmentFromExerciseName` above.
 */
function inferPatternFromExerciseName(name: string): 'push' | 'pull' | 'lower' | null {
  const normalized = name.trim().toLowerCase();
  // Same abstention the library category gives, for names it cannot place:
  // "Lying Quad Stretch" and "Standing Forward Fold" are not quad and hinge
  // training, and counting them made a stretching session read as a leg day.
  if (/stretch|\bpose\b|mobility|\bflow\b|breath|\bfold\b|salutation|circles/.test(normalized)) {
    return null;
  }
  if (
    // "kickback" is qualified: a glute kickback is lower, a triceps kickback
    // is not. "sled" beats the push regex below for the same reason.
    /squat|lunge|deadlift|\brdl\b|hip thrust|glute|bridge|calf|hamstring|quad|step-?up|leg press|leg curl|leg extension|leg raise|good morning|pull-through|glute kickback|nordic|box jump|skater|high knees|sprint|\bsled\b/.test(
      normalized,
    )
  ) {
    return 'lower';
  }
  if (/\brow\b|rows|pulldown|pull-?up|chin-?up|curl|\blat\b|lats|face pull|shrug|rear delt|pullover|reverse pec/.test(normalized)) {
    return 'pull';
  }
  if (/press|push|\bdip\b|dips|\bfly\b|flyes|lateral raise|front raise|overhead|tricep|pushdown|skullcrusher|thruster/.test(normalized)) {
    return 'push';
  }
  return null;
}

/** A pattern owns the session at 70%; below that the day is genuinely mixed. */
const MAJORITY = 0.7;

/**
 * Whether an exercise is a stretch, a mobility flow or a run: the work of a day
 * that has no lift in it. Stricter than "no pattern voted" on purpose -- core
 * and skill work (a handstand wall walk, a hollow hold) also casts no vote, and
 * those days still want a strength day's push-ups to warm the wrists.
 */
const GENTLE_NAME =
  /stretch|\bpose\b|mobility|\bflow\b|breath|\bfold\b|salutation|circles|cat-?cow|spinal twist|\broller\b|legs up the wall|\bruns?\b|\bjog|\bstrides?\b|\b(?:brisk|incline|easy)\s+walk\b|\bbike\b/;

function isGentleExercise(name: string): boolean {
  return GENTLE_NAME.test(name.trim().toLowerCase()) || resolveCatalogSourceCategory(name) === 'stretching';
}

/**
 * What the session actually trains, read from its exercises.
 *
 * This used to be read from the session's title against English keywords
 * ("squat|leg|lower|glute"). The title is display text: the moment the app
 * spoke Finnish — and the moment a user's own program stored "Pakarat &
 * Jalat" as its name — every session fell through to `general` and got the
 * same warmup and the same stretches no matter what it trained. Nothing threw,
 * because `general` is a valid answer.
 *
 * Exercise names are the stable id in this codebase (see exerciseNameLabel:
 * stored, matched and filtered as English, translated only for display), so
 * counting body parts is the one signal a rename or a translation cannot
 * silently break.
 *
 * Pass the WHOLE session. A truncated list is a different session, and this
 * will happily classify it as one.
 */
export function classifySessionFocus(exerciseNames: string[]): SessionFocusKind {
  const counts = { push: 0, pull: 0, lower: 0 };
  // The pattern of the first lift that voted: the day's opening lift, which the
  // warm-up has to prepare whatever the rest of the list is made of.
  let openingPattern: 'push' | 'pull' | 'lower' | null = null;
  for (const name of exerciseNames) {
    const inferred = inferPatternFromExerciseName(name);

    // A stretch is not the stimulus, so it does not get a vote. Its body part
    // is real — "Kneeling Hip Flexor" is legs — and counting it turned a
    // mobility day into a leg day that opened with empty-bar squats.
    //
    // The name has a veto, because the library's category is not always right:
    // it files "Split Squats" and "Crossover Reverse Lunge" as stretching, and
    // those are what "Bulgarian Split Squat" and "Curtsy Lunge" resolve to. A
    // category alone would have silently excluded 18 leg prescriptions.
    if (!inferred && resolveCatalogSourceCategory(name) === 'stretching') {
      continue;
    }

    // The name wins where the two disagree, because the library's body part
    // answers a different question: it files "Deadlift" under back and
    // "Curtsy Lunge" under back, which are true of the muscles worked and
    // wrong about which day it is. Across the catalog they disagree 11 times
    // and the name is right in 8; the three the library won are handled by
    // the qualifiers above rather than by ranking.
    const bodyPart = resolveCatalogBodyPart(name);
    const pattern = inferred ?? (bodyPart ? PATTERN_BY_BODY_PART[bodyPart] : undefined);
    if (pattern) {
      counts[pattern] += 1;
      openingPattern = openingPattern ?? pattern;
    }
  }

  const total = counts.push + counts.pull + counts.lower;
  if (total === 0) {
    // Nothing recognisable. A day made only of stretches, flows and runs is
    // `easy`; core and skill work, or names the catalog has never heard of,
    // stay `general` -- that is the honest answer there, not a fallback.
    return exerciseNames.length > 0 && exerciseNames.every(isGentleExercise) ? 'easy' : 'general';
  }

  if (counts.lower / total >= MAJORITY) {
    return 'lower';
  }

  const upper = counts.push + counts.pull;
  if (upper / total >= MAJORITY) {
    if (counts.push / upper >= MAJORITY) {
      return 'push';
    }
    if (counts.pull / upper >= MAJORITY) {
      return 'pull';
    }
    // A day that opens on a squat or a hinge and then presses and rows is not
    // an upper day: the heavy leg lift is the first thing the warm-up has to
    // prepare, and a lone lift is outvoted. Push-only and pull-only days stay
    // as they are (a deadlift before five pulls is still a pull day).
    return openingPattern === 'lower' ? 'general' : 'upper';
  }

  return 'general';
}

/**
 * A warmup/cooldown drill with its gear requirement. `requires` uses the same
 * equipment-chip vocabulary as equipmentExerciseFilter: every group must be
 * satisfied by at least one available item. Drills with no `requires` are
 * bodyweight and always allowed; every gated drill carries a bodyweight
 * fallback so the block never shrinks — a user with no rower warms up with
 * jumping jacks, not with a machine they told us they don't have.
 */
interface DrillSpec {
  key: Parameters<typeof t>[1];
  scheme: string;
  requires?: string[][];
  fallbackKey?: Parameters<typeof t>[1];
  fallbackScheme?: string;
}

const CARDIO_OPENER: DrillSpec = {
  key: 'home.drill.rowingMachine',
  scheme: '3 min',
  requires: [['Cardio machines']],
  fallbackKey: 'home.drill.jumpingJacks',
  fallbackScheme: '2 min',
};

const WARMUP_DRILLS: Record<SessionFocusKind, DrillSpec[]> = {
  lower: [
    CARDIO_OPENER,
    { key: 'home.drill.hipOpeners', scheme: '2 × 8' },
    {
      key: 'home.drill.emptyBarSquats',
      scheme: '2 × 10',
      requires: [['Barbells', 'Barbell & plates']],
      fallbackKey: 'home.drill.bodyweightSquats',
    },
  ],
  push: [
    CARDIO_OPENER,
    {
      key: 'home.drill.bandPullAparts',
      scheme: '2 × 12',
      requires: [['Resistance bands']],
      fallbackKey: 'home.drill.armCircles',
    },
    { key: 'home.drill.pushUps', scheme: '2 × 8' },
  ],
  pull: [
    CARDIO_OPENER,
    {
      key: 'home.drill.scapularPullUps',
      scheme: '2 × 6',
      requires: [['Pull-up bar']],
      fallbackKey: 'home.drill.wallSlides',
      fallbackScheme: '2 × 8',
    },
    {
      key: 'home.drill.bandFacePulls',
      scheme: '2 × 12',
      requires: [['Resistance bands']],
      fallbackKey: 'home.drill.wallSlides',
    },
  ],
  // Both halves of the body get prepped, because both are about to work.
  upper: [
    CARDIO_OPENER,
    {
      key: 'home.drill.bandPullAparts',
      scheme: '2 × 12',
      requires: [['Resistance bands']],
      fallbackKey: 'home.drill.armCircles',
    },
    { key: 'home.drill.pushUps', scheme: '2 × 8' },
  ],
  // A mixed day, so the block is mixed too — hips and shoulders, not the
  // lower-body block wearing a different name.
  general: [
    CARDIO_OPENER,
    { key: 'home.drill.hipOpeners', scheme: '2 × 8' },
    { key: 'home.drill.pushUps', scheme: '2 × 8' },
  ],
  // Nothing to lift, so nothing to brace for: a short walk-up and the hips.
  easy: [
    { key: 'home.drill.marchInPlace', scheme: '2 min' },
    { key: 'home.drill.hipOpeners', scheme: '2 × 8' },
  ],
};

const COOLDOWN_DRILLS: Record<SessionFocusKind, DrillSpec[]> = {
  push: [
    { key: 'home.drill.chestDoorwayStretch', scheme: '2 × 45s' },
    { key: 'home.drill.tricepsOverheadStretch', scheme: '2 × 30s' },
  ],
  pull: [
    {
      key: 'home.drill.latStretchOnRack',
      scheme: '2 × 45s',
      requires: [['Squat rack', 'Pull-up bar']],
      fallbackKey: 'home.drill.standingLatStretch',
    },
    {
      key: 'home.drill.deadHang',
      scheme: '2 × 30s',
      requires: [['Pull-up bar']],
      fallbackKey: 'home.drill.childsPose',
    },
  ],
  // Front of the thigh and back of it. The chest doorway stretch used to sit
  // here, which is how a leg day ended by stretching the chest — the drill was
  // never wrong, it was in the wrong block.
  lower: [
    { key: 'home.drill.couchStretch', scheme: '2 × 60s' },
    { key: 'home.drill.seatedHamstringStretch', scheme: '2 × 45s' },
  ],
  upper: [
    { key: 'home.drill.chestDoorwayStretch', scheme: '2 × 45s' },
    {
      key: 'home.drill.latStretchOnRack',
      scheme: '2 × 45s',
      requires: [['Squat rack', 'Pull-up bar']],
      fallbackKey: 'home.drill.standingLatStretch',
    },
  ],
  general: [
    { key: 'home.drill.couchStretch', scheme: '2 × 60s' },
    { key: 'home.drill.chestDoorwayStretch', scheme: '2 × 45s' },
  ],
  easy: [
    { key: 'home.drill.childsPose', scheme: '2 × 45s' },
    { key: 'home.drill.seatedHamstringStretch', scheme: '2 × 45s' },
  ],
};

type DrillKey = Parameters<typeof t>[1];

/**
 * What stands in for a drill that loads an area the reader said to leave out
 * entirely, best first. The exercise filter never sees these blocks, so a knee
 * "avoid" removed Jumping Jack and Bodyweight Squat from the week and then
 * opened every day with both. The stand-in keeps the drill's scheme, so the
 * block costs the same seconds and every minutes estimate stays in step.
 */
const AVOID_SUBSTITUTES: Partial<Record<DrillKey, DrillKey[]>> = {
  'home.drill.jumpingJacks': ['home.drill.marchInPlace', 'home.drill.armCircles'],
  'home.drill.emptyBarSquats': ['home.drill.gluteBridges', 'home.drill.hipOpeners'],
  'home.drill.bodyweightSquats': ['home.drill.gluteBridges', 'home.drill.hipOpeners'],
  'home.drill.pushUps': ['home.drill.wallSlides', 'home.drill.armCircles'],
  'home.drill.tricepsOverheadStretch': ['home.drill.childsPose', 'home.drill.seatedHamstringStretch'],
};

/** Neutral drills for a slot whose own stand-ins are taken or hit the area too. */
const NEUTRAL_DRILLS: Record<'warmup' | 'cooldown', DrillKey[]> = {
  warmup: ['home.drill.hipOpeners', 'home.drill.armCircles', 'home.drill.wallSlides', 'home.drill.marchInPlace'],
  cooldown: [
    'home.drill.seatedHamstringStretch',
    'home.drill.childsPose',
    'home.drill.standingLatStretch',
    'home.drill.chestDoorwayStretch',
  ],
};

function drillHitsAvoidedArea(key: DrillKey, avoided: readonly SetupCautionArea[]): boolean {
  // The matcher reads English exercise names, whatever language the drill is shown in.
  const name = t('en', key);
  return avoided.some((area) => exerciseHitsCautionArea(name, area));
}

function drillAllowed(spec: DrillSpec, available: string[] | null) {
  // null = the setup never said what gear exists, so nothing is assumed missing.
  if (available === null || !spec.requires) {
    return true;
  }
  return spec.requires.every((group) => group.some((item) => available.includes(item)));
}

function resolveDrill(spec: DrillSpec, language: AppLanguage, available: string[] | null): SessionDrill {
  if (drillAllowed(spec, available)) {
    return { key: spec.key, name: t(language, spec.key), schemeLabel: spec.scheme };
  }
  const key = spec.fallbackKey ?? spec.key;
  return { key, name: t(language, key), schemeLabel: spec.fallbackScheme ?? spec.scheme };
}

/** Which of the two blocks a drill belongs to. */
export type RoutineBlockKind = 'warmup' | 'cooldown';

function resolveDrills(
  kind: RoutineBlockKind,
  specs: DrillSpec[],
  language: AppLanguage,
  available: string[] | null,
  avoided: readonly SetupCautionArea[],
): SessionRoutineBlock['drills'] {
  const drills = specs.map((spec) => resolveDrill(spec, language, available));
  if (avoided.length === 0) {
    return drills;
  }
  const taken = new Set<string>(drills.map((drill) => drill.key));
  return drills.map((drill) => {
    if (!drillHitsAvoidedArea(drill.key, avoided)) {
      return drill;
    }
    const standIn = [...(AVOID_SUBSTITUTES[drill.key] ?? []), ...NEUTRAL_DRILLS[kind]].find(
      (key) => !taken.has(key) && !drillHitsAvoidedArea(key, avoided),
    );
    if (!standIn) {
      return drill;
    }
    taken.add(standIn);
    return { key: standIn, name: t(language, standIn), schemeLabel: drill.schemeLabel };
  });
}

/**
 * Which drill a reader put in which slot.
 *
 * Keyed by block, focus and position rather than by programme: the drills are
 * generated from the session's FOCUS, so the same warm-up already stood in
 * front of every upper-heavy day the reader owns. An override keyed any
 * narrower would claim to remember a choice for one programme and then quietly
 * not apply it to the identical day next door.
 */
export type RoutineDrillOverrides = Record<string, string>;

export function routineDrillSlotKey(
  kind: RoutineBlockKind,
  focus: SessionFocusKind,
  index: number,
): string {
  return `${kind}:${focus}:${index}`;
}

function specsFor(kind: RoutineBlockKind): Record<SessionFocusKind, DrillSpec[]> {
  return kind === 'warmup' ? WARMUP_DRILLS : COOLDOWN_DRILLS;
}

/**
 * Everything a reader may put in a warm-up (or cool-down) slot: every drill
 * the app knows for that block, whatever focus it was written for, deduped and
 * resolved against the gear they said they have.
 */
export function listRoutineDrillOptions(
  kind: RoutineBlockKind,
  language: AppLanguage = 'en',
  availableEquipment: string[] | null = null,
  cautionFlags: readonly SetupCautionFlag[] | null = null,
): SessionDrill[] {
  const avoided = avoidedCautionAreas(cautionFlags);
  const seen = new Set<string>();
  const options: SessionDrill[] = [];
  for (const specs of Object.values(specsFor(kind))) {
    for (const spec of specs) {
      const drill = resolveDrill(spec, language, availableEquipment);
      // A drill on a flagged area is not offered, so the picker cannot hand
      // back what the flag left out.
      if (seen.has(drill.key) || drillHitsAvoidedArea(drill.key, avoided)) {
        continue;
      }
      seen.add(drill.key);
      options.push(drill);
    }
  }
  return options;
}

/**
 * The reader's choice, or the default when they never made one.
 *
 * An override naming a drill this build no longer ships is dropped rather than
 * rendered as a raw key — the same rule the stored-data loaders follow.
 *
 * A drill the reader picked themselves stays theirs even if an avoid flag later
 * names it: the flag swaps the app's defaults and keeps the picker from offering
 * the drill, but it does not undo a choice the reader made. The pool is
 * therefore the unfiltered one.
 */
function applyOverrides(
  kind: RoutineBlockKind,
  focus: SessionFocusKind,
  drills: SessionDrill[],
  overrides: RoutineDrillOverrides | null,
  language: AppLanguage,
  available: string[] | null,
): SessionDrill[] {
  if (!overrides) {
    return drills;
  }
  const pool = new Map(
    listRoutineDrillOptions(kind, language, available).map((drill) => [drill.key as string, drill]),
  );
  return drills.map((drill, index) => {
    const chosen = overrides[routineDrillSlotKey(kind, focus, index)];
    if (!chosen) {
      return drill;
    }
    return pool.get(chosen) ?? drill;
  });
}

/**
 * A block's minutes, from the drills it actually holds — the same arithmetic
 * the guided player runs on the same drills. These used to be the literals 6
 * and 4, so Home said "Palautuminen · 4 min" over two stretches that take
 * two and a half, while the player's entry screen said ~3 for the same block.
 */
function routineBlockMinutes(drills: SessionRoutineBlock['drills']): number {
  return Math.max(1, Math.round(estimateRoutineBlockSeconds({ minutes: 0, drills }) / 60));
}

/**
 * Deterministic default warmup for a session focus (no warmup data model yet).
 *
 * Takes the classified focus rather than a title, so no caller can pass display
 * text again — a session name is now a type error here, not a silent `general`.
 */
export function getDefaultWarmup(
  focus: SessionFocusKind,
  language: AppLanguage = 'en',
  availableEquipment: string[] | null = null,
  overrides: RoutineDrillOverrides | null = null,
  cautionFlags: readonly SetupCautionFlag[] | null = null,
): SessionRoutineBlock {
  const drills = applyOverrides(
    'warmup',
    focus,
    resolveDrills('warmup', WARMUP_DRILLS[focus], language, availableEquipment, avoidedCautionAreas(cautionFlags)),
    overrides,
    language,
    availableEquipment,
  );
  // Minutes follow the drills that are actually there, not the ones that were
  // there before the swap.
  return { minutes: routineBlockMinutes(drills), drills };
}

/** Deterministic default cooldown for a session focus. */
export function getDefaultCooldown(
  focus: SessionFocusKind,
  language: AppLanguage = 'en',
  availableEquipment: string[] | null = null,
  overrides: RoutineDrillOverrides | null = null,
  cautionFlags: readonly SetupCautionFlag[] | null = null,
): SessionRoutineBlock {
  const drills = applyOverrides(
    'cooldown',
    focus,
    resolveDrills('cooldown', COOLDOWN_DRILLS[focus], language, availableEquipment, avoidedCautionAreas(cautionFlags)),
    overrides,
    language,
    availableEquipment,
  );
  return { minutes: routineBlockMinutes(drills), drills };
}
