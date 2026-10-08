import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { mapSetupEquipment } from './aiCoachPlan';
import { programFitsEquipment } from './programEquipmentFit';
import { applyBriefToPreferences } from './programmeBrief';
import { RECOMMENDATION_PROGRAMS } from './recommendationCatalog';
import type { ProgrammeBriefSignals } from './programmeBrief';
import type { AiPlannerEquipment, AiPlannerExperience, AiPlannerGoal, AppPreferences, SetupGoal, SetupLevel } from '../types/models';
import type { RecommendationProgramDefinition } from '../types/recommendation';

/**
 * The catalog programme that best answers what the reader actually said.
 *
 * The composer builds a week from blueprints, and it only has splits for one
 * to four days — so "5 päivää, rinta ja pakarat" came back as a four-day week
 * with a note explaining the trim. Meanwhile the catalog already holds fourteen
 * designed programmes of five and six days, one of them a five-day glute
 * programme, each with its own progression rules and block length.
 *
 * The reader's question was the right one: why invent a worse answer when a
 * better one is sitting there (user 2026-08-26, "eikö aichat voi vain ottaa
 * lähimpää ohjelmaa mikä vastaa käyttäjän puheita?").
 *
 * This is deterministic on purpose. The coach could be asked to name a
 * programme and would name ones that do not exist; a scorer over the real
 * catalog cannot.
 */

export interface BriefProgrammeMatch {
  programId: string;
  /** Days the programme actually runs, so the caller can say it out loud. */
  daysPerWeek: number;
  /** Which parts of the brief this programme answered. */
  matched: { days: boolean; focus: string[]; goal: boolean };
  score: number;
}

/** The reader's own words about their body, in the catalog's vocabulary. */
const FOCUS_ALIASES: Record<string, string[]> = {
  chest: ['chest'],
  back: ['back'],
  shoulders: ['shoulders'],
  arms: ['arms', 'biceps', 'triceps'],
  legs: ['legs', 'quads', 'hamstrings', 'calves'],
  glutes: ['glutes'],
  core: ['core', 'abs'],
};

function focusOverlap(signals: ProgrammeBriefSignals, definition: RecommendationProgramDefinition): string[] {
  const tags = new Set<string>(definition.focusAreaTags as unknown as string[]);
  const hits: string[] = [];
  for (const area of signals.focusBodyParts) {
    const candidates = FOCUS_ALIASES[area] ?? [area];
    if (candidates.some((candidate) => tags.has(candidate))) {
      hits.push(area);
    }
  }
  return hits;
}

/**
 * Weights, in the order the reader would rank them.
 *
 * Days lead because that is the part the composer had to refuse: a programme
 * that trains the right muscles on the wrong number of days is not the answer
 * to "five days". Focus is next, and the goal is a tie-breaker — most
 * programmes support the common ones, so it separates little on its own.
 */
const DAYS_WEIGHT = 100;
const FOCUS_WEIGHT = 30;
const GOAL_WEIGHT = 12;

export function matchProgrammeToBrief(
  signals: ProgrammeBriefSignals,
  preferences: AppPreferences,
  programs: readonly RecommendationProgramDefinition[] = RECOMMENDATION_PROGRAMS,
): BriefProgrammeMatch | null {
  // The ASK, not the capped number: matching on the cap would find a four-day
  // programme for someone who said five, which is the failure being fixed.
  const wantedDays = signals.requestedDaysPerWeek ?? signals.daysPerWeek;
  if (wantedDays === null && signals.focusBodyParts.length === 0 && !signals.goal) {
    // Nothing was said that a catalog programme could answer.
    return null;
  }

  const reader = readerOf(signals, preferences);
  let best: BriefProgrammeMatch | null = null;
  for (const definition of programs) {
    if (!fitsReader(signals, reader, definition)) {
      continue;
    }
    const days = wantedDays !== null && definition.daysPerWeek === wantedDays;
    const focus = focusOverlap(signals, definition);
    const catalogGoals = [...(definition.supportedGoals as unknown as string[]), ...(definition.backupGoals as unknown as string[])];
    const goal = Boolean(reader.goals && reader.goals.some((name) => catalogGoals.includes(name)));

    // A programme opened in place of the build has to be the week that was
    // asked for: the days and the goal said, not a two-day base or a
    // mobility flow that only won because nothing else fit the reader
    // (review, 2026-10-07). Nothing left is an answer too — the composer
    // builds the trimmed week and says so.
    if ((wantedDays !== null && !days) || (reader.goals && !goal)) {
      continue;
    }
    const score = (days ? DAYS_WEIGHT : 0) + focus.length * FOCUS_WEIGHT + (goal ? GOAL_WEIGHT : 0);
    if (score === 0) {
      continue;
    }
    // Ties go to the first in catalog order, which is stable across runs — a
    // programme that changes every time the reader asks the same thing reads
    // as guessing.
    if (!best || score > best.score) {
      best = { programId: definition.programId, daysPerWeek: definition.daysPerWeek, matched: { days, focus, goal }, score };
    }
  }

  return best;
}

/**
 * The brief's goal in the catalog's words. Compared as they were, "fat_loss"
 * and "fitness" matched no programme's goal at all.
 */
const CATALOG_GOALS: Record<AiPlannerGoal, readonly string[]> = {
  strength: ['strength'],
  muscle: ['muscle'],
  fat_loss: ['lean_athletic'],
  fitness: ['general_fitness', 'general'],
};

/** The intake's experience answer on the catalog's level scale (aiCoachPlan maps the other way). */
const CATALOG_LEVEL: Record<AiPlannerExperience, SetupLevel> = {
  beginner: 'beginner',
  intermediate: 'advanced',
  advanced: 'pro',
};

/**
 * The gear the intake's "Koti (käsipainot)" means, as the onboarding chips
 * spell it. A band comes with any equipment at all, as the composer reads
 * 'minimal' (aiCoachPlan).
 */
const DUMBBELL_HOME_ITEMS: readonly string[] = ['Dumbbells', 'Resistance bands'];

/**
 * The stored onboarding goal in the catalog's words. The catalog keeps the
 * goals onboarding asks, so a lean or mobility reader is matched as one, not
 * as the composer's broader "fitness".
 */
const STORED_GOALS: Record<SetupGoal, readonly string[]> = {
  strength: ['strength'],
  muscle: ['muscle'],
  general: ['general', 'general_fitness'],
  general_fitness: ['general_fitness', 'general'],
  lean_athletic: ['lean_athletic'],
  run_mobility: ['run_mobility'],
};

/** The reader a programme has to fit: their gear, their level and their goal when one is known. */
interface BriefReader {
  equipment: AiPlannerEquipment;
  level: SetupLevel | null;
  /** The catalog goals that answer the reader, or null when nothing names one. */
  goals: readonly string[] | null;
}

/**
 * The brief laid on the stored profile, by the same merge the composers use
 * (programmeBrief.applyBriefToPreferences): what the brief says wins, and
 * where it is silent the profile answers (owner, 2026-10-07). A typed "5
 * päivää viikossa" from a beginner training at home was matched as if
 * nothing were known about them. The gear is read as the composer reads it,
 * a gym when nothing is stored; a level nothing names does not filter.
 *
 * The goal too: a coach's "5 päivää viikossa, painotus rinta" names none,
 * and a stored muscle reader was opened into the mobility flow or a strength
 * split, where the composer it stands in for built for muscle (re-hunt,
 * 2026-10-08).
 */
function readerOf(signals: ProgrammeBriefSignals, preferences: AppPreferences): BriefReader {
  const merged = applyBriefToPreferences(preferences, signals, []);
  return {
    equipment: mapSetupEquipment(merged),
    level: merged.aiPlannerExperience ? CATALOG_LEVEL[merged.aiPlannerExperience] : merged.setupLevel,
    goals: merged.aiPlannerGoal
      ? CATALOG_GOALS[merged.aiPlannerGoal]
      : merged.setupGoal
        ? STORED_GOALS[merged.setupGoal] ?? null
        : null,
  };
}

/**
 * Whether the reader could run this programme at all: their gear, their
 * level. The score only weighed days, focus and goal, so a beginner at home
 * with no equipment who tapped five days was opened straight into an
 * advanced full-gym programme (review, 2026-10-07).
 *
 * A gym reader is matched to gym programmes only. Every gear tier used to
 * pass for them, which showed once an avoided lift emptied the five- and
 * six-day gym programmes: "6 days a week at the gym, no deadlifts" opened a
 * home bodyweight week, and a sore shoulder at five days the mobility flow
 * (re-hunt, 2026-10-07). No gym programme left is an answer — the composer
 * builds the trimmed week.
 */
function fitsReader(signals: ProgrammeBriefSignals, reader: BriefReader, definition: RecommendationProgramDefinition): boolean {
  if (reader.level && !definition.supportedLevels.includes(reader.level)) {
    return false;
  }
  if (holdsAvoidedLift(signals, definition.programId)) {
    return false;
  }
  if (signals.legsSpread && holdsLegOnlyDay(definition.programId)) {
    return false;
  }
  switch (reader.equipment) {
    case 'home_gym':
      return definition.equipmentTier === 'low_equipment';
    case 'minimal':
      return definition.equipmentTier === 'low_equipment' && programFitsEquipment(definition.programId, [...DUMBBELL_HOME_ITEMS]);
    case 'bodyweight':
      return definition.equipmentTier === 'low_equipment' && programFitsEquipment(definition.programId, []);
    case 'full_gym':
      return definition.equipmentTier === 'full_gym';
  }
}

/**
 * Whether the programme holds a lift the brief keeps out: one it refused
 * ("ei maastavetoa") or one a caution rules out ("olkapää kipeä" → overhead
 * press). The composer drops those through its avoid list; the ready
 * programme opened in its place kept them, so "6 päivää, ei maastavetoa"
 * opened a week with Romanian deadlifts in it (bug hunt, 2026-10-07). Such a
 * programme is no answer, and the composer builds the week instead.
 */
function holdsAvoidedLift(signals: ProgrammeBriefSignals, programId: string): boolean {
  if (signals.avoidTerms.length === 0) {
    return false;
  }
  const template = getWorkoutTemplateById(programId);
  if (!template) {
    return true;
  }
  return template.sessions.some((session) =>
    session.exercises.some((exercise) => {
      const name = exercise.exerciseName.toLowerCase();
      return signals.avoidTerms.some((term) => name.includes(term));
    }),
  );
}

/**
 * A day of legs alone, by its name: "Day 3: Legs", "Lower (Heavy)", "Glutes &
 * Hamstrings", "Squat Day". Not "Back & Legs" or "Legs & Pull", which mix the
 * legs in.
 */
const LEG_ONLY_SESSION =
  /^(?:day \d+:\s*)?(?:legs|lower|quads?|glutes?|hamstrings?|heavy glutes|explosive lower|squat day|deadlift day)\b(?![^(]*\b(?:upper|push|pull|chest|back|arms|shoulders|core|full)\b)/i;

/**
 * Whether the programme has a leg day of its own, which "no separate leg
 * day" turns down: the legs belong in the other days (owner, 2026-10-08).
 */
function holdsLegOnlyDay(programId: string): boolean {
  const template = getWorkoutTemplateById(programId);
  return !template || template.sessions.some((session) => LEG_ONLY_SESSION.test(session.name));
}

/**
 * Whether the catalog is the better answer than composing.
 *
 * Only when the composer would have to trim the ask. Within its range the
 * composer builds exactly what was described, and steering that to a
 * ready-made programme would be answering a different question.
 */
export function shouldOfferCatalogInstead(signals: ProgrammeBriefSignals): boolean {
  return signals.requestedDaysPerWeek !== null;
}
