import { PLAIN_EXERCISE_NAMES } from './exerciseNameLabel';
import { findFiledLibraryIndex, findGuidedLibraryIndex } from './guidedPlayer';
import { resolveImportedExerciseName } from './hevyExerciseName';
import { isSameLiftByGroup, liftGroupNames, liftGroupOf } from './liftIdentity';
import { StrengthGoal } from './strengthGoals';

/**
 * A goal always has a programme that trains its lift.
 *
 * "Bench 100 kg" used to be a number on the Programs tab with a bar under it,
 * and nothing in the app connected the number to what the reader was about to
 * do on Tuesday. The user's rule (feedback round 2, #1): a target must come
 * with a programme that goes towards it.
 *
 * What this module claims is deliberately small and checkable: whether a
 * programme CONTAINS the lift, and how central it is there. It never estimates
 * how fast a programme would get you to the number — the app measures a goal
 * against the reader's own best set and nothing else, and a "recommended for
 * your 100 kg" claim would be the projection that rule refuses.
 */

/** The narrowest shape every programme source (catalog, custom, plan) can offer. */
export interface GoalProgrammeExercise {
  exerciseName: string;
  role?: 'primary' | 'secondary' | 'accessory';
}

export interface GoalProgrammeSession {
  exercises: GoalProgrammeExercise[];
}

export interface GoalProgrammeCandidate {
  id: string;
  sessions: GoalProgrammeSession[];
  /** Catalog level, when known. Absent on a programme the reader wrote. */
  level?: 'beginner' | 'intermediate' | 'advanced';
  /** Sessions a week, when known. */
  daysPerWeek?: number;
}

/** Who the suggestion is for. Without it the ranking is level-blind. */
export interface GoalProgrammeReader {
  /** Setup level, which maps onto the catalog's three tiers. */
  level?: 'beginner' | 'advanced' | 'pro' | null;
  daysPerWeek?: number | null;
}

const CATALOG_LEVEL_FOR_SETUP: Record<string, GoalProgrammeCandidate['level']> = {
  beginner: 'beginner',
  advanced: 'intermediate',
  pro: 'advanced',
};

/**
 * Setup's three tiers in the catalog's vocabulary.
 *
 * The two do not share words — setup says beginner/advanced/pro, the catalog
 * says beginner/intermediate/advanced — so "advanced" means different things
 * on either side of this line. Anywhere that compares a reader's level with a
 * template's has to come through here, or `advanced === 'advanced'` quietly
 * matches a Pro plan to an Amateur.
 */
export function catalogLevelForSetup(
  level: string | null | undefined,
): GoalProgrammeCandidate['level'] | undefined {
  return level ? CATALOG_LEVEL_FOR_SETUP[level] : undefined;
}

/**
 * How badly a programme fits the reader's WEEK — lower is better, 0 is a match.
 *
 * A target answers "which programme gets me there", and the honest answer has
 * to be a programme they can actually run. Ranking on deadlift sessions alone
 * offered a six-day advanced split to someone training three days as a
 * beginner: more of the lift, in a week that is not theirs.
 *
 * This half is the hard one and stays ahead of everything except how central
 * the lift is. A week the reader does not have is not a programme.
 */
function weekPenalty(candidate: GoalProgrammeCandidate, reader: GoalProgrammeReader | undefined): number {
  if (!reader?.daysPerWeek || !candidate.daysPerWeek) {
    return 0;
  }
  return Math.abs(candidate.daysPerWeek - reader.daysPerWeek);
}

/**
 * How far the programme's level is from the reader's — the SOFT half.
 *
 * It used to be added to the week's distance and ranked ahead of how often the
 * programme trains the lift, which is backwards for a target: the reader is
 * choosing a programme in order to move one lift, and "a tier up" is a
 * description of the whole programme while "trains your lift three times a
 * week instead of once" is the thing they asked for (user, 2026-09-05).
 */
function levelPenalty(candidate: GoalProgrammeCandidate, reader: GoalProgrammeReader | undefined): number {
  const wanted = catalogLevelForSetup(reader?.level);
  if (!wanted || !candidate.level || candidate.level === wanted) {
    return 0;
  }
  // One tier away is a stretch; two is a different training life.
  const order: NonNullable<GoalProgrammeCandidate['level']>[] = ['beginner', 'intermediate', 'advanced'];
  return Math.abs(order.indexOf(candidate.level) - order.indexOf(wanted)) * 2;
}

export interface GoalProgrammeMatch {
  id: string;
  /** Sessions in the programme that train the lift. */
  sessionCount: number;
  /** True when the lift is a primary lift in at least one of those sessions. */
  primary: boolean;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Same lift, by name.
 *
 * Catalog programmes and the goal presets both use the canonical names ("Bench
 * Press"), so an exact match covers the ready catalog. Custom programmes may
 * carry library variants ("Barbell Bench Press - Medium Grip"); given the
 * library's names, both sides resolve through the alias matcher the guided
 * player already uses, so a variant of the lift still counts as the lift.
 */
/**
 * Per-library memo of the alias matcher.
 *
 * `findGuidedLibraryIndex` lower-cases every one of the ~870 library names on
 * every call. Ranking the catalog for one lift calls it twice per exercise per
 * programme — thousands of times — and the goal-programme memo in App ran that
 * for three lifts. Measured on a Galaxy A54: 4.8 seconds, on every preference
 * change, because the memo sat downstream of the setup selection. The
 * resolution of a name against a given library never changes, so it is looked
 * up once and kept for as long as that library array lives.
 */
const resolverCache = new WeakMap<
  readonly string[],
  {
    names: string[];
    byName: Map<string, number | null>;
    filedByName: Map<string, number | null>;
    rowsNamedByGroup: Map<number, number>;
  }
>();

function resolverEntry(libraryNames: readonly string[]) {
  let entry = resolverCache.get(libraryNames);
  if (!entry) {
    entry = { names: [...libraryNames], byName: new Map(), filedByName: new Map(), rowsNamedByGroup: new Map() };
    resolverCache.set(libraryNames, entry);
  }
  return entry;
}

function resolveLibraryIndex(name: string, libraryNames: readonly string[]): number | null {
  const entry = resolverEntry(libraryNames);
  const key = normalize(name);
  const cached = entry.byName.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const index = findGuidedLibraryIndex(name, entry.names);
  entry.byName.set(key, index);
  return index;
}

function resolveFiledLibraryIndex(name: string, libraryNames: readonly string[]): number | null {
  const entry = resolverEntry(libraryNames);
  const key = normalize(name);
  const cached = entry.filedByName.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const index = findFiledLibraryIndex(name, entry.names);
  entry.filedByName.set(key, index);
  return index;
}

/** Library name → the same lift said plainly, keyed lower-case. */
const PLAIN_NAME_BY_LOWER = new Map(
  Object.entries(PLAIN_EXERCISE_NAMES).map(([name, plain]) => [normalize(name), plain] as const),
);

/**
 * The spelling a name is grouped under: its own when a same-lift group has it,
 * otherwise — for a library row, when the library is given — the plain name
 * the row is read as.
 *
 * The groups are written in the catalogue's words, and the library's pedantic
 * rows are not in them: "Barbell Bench Press - Medium Grip" is in no group, so
 * the catalogue's "Barbell Bench Press" — which is — could only reach it by a
 * substring, and the substring found "Decline Barbell Bench Press" instead.
 * `PLAIN_EXERCISE_NAMES` is the hand-written "same lift, said plainly" table,
 * so a row joins the group its plain name is in. No alias is added by this.
 * Without a library the caller is not naming library rows, and only the
 * catalogue's own spellings count, as before.
 */
function groupSpelling(name: string, withLibrary: boolean): string {
  if (!withLibrary || liftGroupOf(name) !== null) {
    return name;
  }
  return PLAIN_NAME_BY_LOWER.get(normalize(name)) ?? name;
}

function liftGroupOfName(name: string, withLibrary: boolean): number | null {
  return liftGroupOf(groupSpelling(name, withLibrary));
}

/**
 * A logged name in the app's words before it is compared. A Hevy import keeps
 * Hevy's titles in the history: "Squat (Barbell)" matched no squat target,
 * while the library's bracket strip filed "Bench Press (Dumbbell)" and
 * "Deadlift (Smith Machine)" under the barbell lifts (hunt, 2026-10-09).
 * Read the way the import files "last time" (lib/hevyExerciseName), the
 * barbell lift is the bare name and any other implement stays its own lift.
 */
function liftSpelling(name: string): string {
  return resolveImportedExerciseName(name);
}

export function isSameLift(rawLeft: string, rawRight: string, libraryNames?: readonly string[]): boolean {
  const left = liftSpelling(rawLeft);
  const right = liftSpelling(rawRight);
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const withLibrary = Boolean(libraryNames && libraryNames.length > 0);
  // Spelled differently, same lift. Checked before the library because the
  // library resolves "Conventional Deadlift" and "Barbell Deadlift" to two
  // different entries — correctly, for a browser; wrongly, for a target.
  if (isSameLiftByGroup(groupSpelling(left, withLibrary), groupSpelling(right, withLibrary))) {
    return true;
  }
  const leftGroup = liftGroupOfName(left, withLibrary);
  const rightGroup = liftGroupOfName(right, withLibrary);
  // ...and the reverse: two names in DIFFERENT groups are different lifts, so
  // the library must not merge them. A Romanian deadlift resolving near a
  // deadlift would otherwise fill a deadlift target.
  if (leftGroup !== null && rightGroup !== null && leftGroup !== rightGroup) {
    return false;
  }
  if (!libraryNames || libraryNames.length === 0) {
    return false;
  }
  const leftIndex = resolveLibraryIndex(left, libraryNames);
  const rightIndex = resolveLibraryIndex(right, libraryNames);
  return leftIndex !== null && leftIndex === rightIndex;
}

/** How many rows of this library a group names by their exact library name. */
function libraryRowsNamedByGroup(group: number, libraryNames: readonly string[]): number {
  const entry = resolverEntry(libraryNames);
  const cached = entry.rowsNamedByGroup.get(group);
  if (cached !== undefined) {
    return cached;
  }
  const lowerNames = new Set(entry.names.map(normalize));
  const count = liftGroupNames(group).filter((name) => lowerNames.has(name)).length;
  entry.rowsNamedByGroup.set(group, count);
  return count;
}

/**
 * Whether a logged exercise is the history of one LIBRARY ROW.
 *
 * `isSameLift` answers for a target, and a target folds variations in on
 * purpose: a trap-bar pull fills a deadlift target. A library page is one row,
 * and "Sumo Deadlift", "Trap Bar Deadlift" and "Barbell Deadlift" are three of
 * them — so the sumo page must not list conventional pulls and quote their
 * best. Nothing here matches by substring either: "Pull Up" is inside
 * "Weighted Pull Ups", and that page is not a pull-up's.
 *
 * A log is this row's history when it is:
 * 1. the row's own name, or the plain name the page is titled with;
 * 2. filed on this row by name or by the alias table (`findFiledLibraryIndex`);
 * 3. or, for a row in a same-lift group, any other spelling of that lift that
 *    is not filed on a row outside the group — but only when the group names
 *    at most one library row. The deadlift group names four, so "Deadlift" is
 *    the Barbell Deadlift's only by its alias, and "Rack Pull" is none of
 *    theirs. The squat group names one, "Barbell Squat", so "Back Squat" —
 *    filed on "Barbell Full Squat", which is in the group by its plain name —
 *    is history on both.
 *
 * And never when `isSameLift` says it is a different lift: this only narrows.
 */
export function isSameLiftAsLibraryRow(
  rawLoggedName: string,
  libraryRowName: string,
  libraryNames: readonly string[],
): boolean {
  const loggedName = liftSpelling(rawLoggedName);
  const logged = normalize(loggedName);
  const row = normalize(libraryRowName);
  if (!logged || !row) {
    return false;
  }
  if (logged === row) {
    return true;
  }
  if (!isSameLift(loggedName, libraryRowName, libraryNames)) {
    return false;
  }
  if (logged === normalize(PLAIN_NAME_BY_LOWER.get(row) ?? '')) {
    return true;
  }
  const filedIndex = resolveFiledLibraryIndex(loggedName, libraryNames);
  const filed = filedIndex === null ? null : normalize(libraryNames[filedIndex]);
  if (filed === row) {
    return true;
  }
  const group = liftGroupOfName(libraryRowName, true);
  if (group === null || liftGroupOfName(loggedName, true) !== group) {
    return false;
  }
  if (filed !== null && liftGroupOfName(filed, true) !== group) {
    return false;
  }
  return libraryRowsNamedByGroup(group, libraryNames) <= 1;
}

/** How a programme relates to a lift, or null when it never trains it. */
export function matchProgrammeToLift(
  programme: GoalProgrammeCandidate,
  liftName: string,
  libraryNames?: readonly string[],
): GoalProgrammeMatch | null {
  let sessionCount = 0;
  let primary = false;
  for (const session of programme.sessions) {
    let inSession = false;
    for (const exercise of session.exercises) {
      if (isSameLift(exercise.exerciseName, liftName, libraryNames)) {
        inSession = true;
        if (exercise.role === 'primary') {
          primary = true;
        }
      }
    }
    if (inSession) {
      sessionCount += 1;
    }
  }
  return sessionCount > 0 ? { id: programme.id, sessionCount, primary } : null;
}

/**
 * The programmes that train the lift, best fit first.
 *
 * Order: the lift as a primary lift beats it as an accessory; then the week,
 * because a programme they cannot run is not an answer; then MORE SESSIONS of
 * the lift beat fewer; then level; ties fall back to `preferredOrder` — the
 * caller's own ranking — and then to catalog order, so the result is stable.
 *
 * Frequency used to sit behind level as well as the week, so a squat target
 * took a one-squat-a-week programme that matched the reader's tier over the
 * 5x5 that squats three times (user, 2026-09-05: the target lift has to be
 * trained more often). Measured against the catalog afterwards: this changes
 * the answer for the back squat and for nothing else, because for six of the
 * seven preset lifts every strength programme trains them exactly once. The
 * ordering is right either way; the catalog is the reason it is not enough.
 */
export function rankProgrammesForLift(
  programmes: readonly GoalProgrammeCandidate[],
  liftName: string,
  options: {
    preferredOrder?: readonly string[];
    libraryNames?: readonly string[];
    reader?: GoalProgrammeReader;
  } = {},
): GoalProgrammeMatch[] {
  const preference = new Map((options.preferredOrder ?? []).map((id, index) => [id, index]));
  const catalogIndex = new Map(programmes.map((programme, index) => [programme.id, index]));
  const week = new Map(programmes.map((programme) => [programme.id, weekPenalty(programme, options.reader)]));
  const level = new Map(programmes.map((programme) => [programme.id, levelPenalty(programme, options.reader)]));
  const matches: GoalProgrammeMatch[] = [];
  for (const programme of programmes) {
    const match = matchProgrammeToLift(programme, liftName, options.libraryNames);
    if (match) {
      matches.push(match);
    }
  }
  return matches.sort((left, right) => {
    if (left.primary !== right.primary) {
      return left.primary ? -1 : 1;
    }
    const leftWeek = week.get(left.id) ?? 0;
    const rightWeek = week.get(right.id) ?? 0;
    if (leftWeek !== rightWeek) {
      return leftWeek - rightWeek;
    }
    if (left.sessionCount !== right.sessionCount) {
      return right.sessionCount - left.sessionCount;
    }
    const leftLevel = level.get(left.id) ?? 0;
    const rightLevel = level.get(right.id) ?? 0;
    if (leftLevel !== rightLevel) {
      return leftLevel - rightLevel;
    }
    const leftPref = preference.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightPref = preference.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftPref !== rightPref) {
      return leftPref - rightPref;
    }
    return (catalogIndex.get(left.id) ?? 0) - (catalogIndex.get(right.id) ?? 0);
  });
}

/**
 * What the screens say next to a goal — resolved once in the shell from the
 * coverage and the ranking above, with titles already in the reader's language.
 *
 *  - `covered`: an active programme trains the lift; `programme` is it.
 *  - `suggest`: nothing active trains it (or nothing is active); `programme`
 *    is the best ready programme that does.
 *  - `none`: no ready programme trains the lift at all. The honest answer is
 *    "build your own", and the row says so rather than inventing a fit.
 */
export interface GoalProgrammeSuggestionView {
  status: 'covered' | 'suggest' | 'none';
  programme: {
    id: string;
    title: string;
    /** Sessions of the programme that train the lift, and its session count. */
    sessionCount: number;
    totalSessions: number;
  } | null;
}

export type GoalCoverageStatus =
  /** An active programme trains the lift. */
  | 'covered'
  /** There are active programmes and none of them trains the lift. */
  | 'uncovered'
  /** Nothing is active, so nothing can be said about it yet. */
  | 'noProgramme';

export interface GoalCoverage {
  goal: StrengthGoal;
  status: GoalCoverageStatus;
  /** The id of the active programme that covers the lift, when one does. */
  coveredBy: string | null;
}

/**
 * Whether the reader's ACTIVE programmes train the goal's lift.
 *
 * This is the sentence the goals row can say truthfully: "your current
 * programme trains this" or "your current programme does not train this".
 * The third state — no active programme — is not the same as "not covered",
 * and the row must not scold an empty account.
 */
export function describeGoalCoverage(
  goal: StrengthGoal,
  activeProgrammes: readonly GoalProgrammeCandidate[],
  libraryNames?: readonly string[],
): GoalCoverage {
  if (activeProgrammes.length === 0) {
    return { goal, status: 'noProgramme', coveredBy: null };
  }
  for (const programme of activeProgrammes) {
    if (matchProgrammeToLift(programme, goal.exerciseName, libraryNames)) {
      return { goal, status: 'covered', coveredBy: programme.id };
    }
  }
  return { goal, status: 'uncovered', coveredBy: null };
}
