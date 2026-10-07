import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { programFitsEquipment } from './programEquipmentFit';
import { RECOMMENDATION_PROGRAMS } from './recommendationCatalog';
import type { ProgrammeBriefSignals } from './programmeBrief';
import type { AiPlannerExperience, AiPlannerGoal, SetupLevel } from '../types/models';
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
  programs: readonly RecommendationProgramDefinition[] = RECOMMENDATION_PROGRAMS,
): BriefProgrammeMatch | null {
  // The ASK, not the capped number: matching on the cap would find a four-day
  // programme for someone who said five, which is the failure being fixed.
  const wantedDays = signals.requestedDaysPerWeek ?? signals.daysPerWeek;
  if (wantedDays === null && signals.focusBodyParts.length === 0 && !signals.goal) {
    // Nothing was said that a catalog programme could answer.
    return null;
  }

  let best: BriefProgrammeMatch | null = null;
  for (const definition of programs) {
    if (!fitsReader(signals, definition)) {
      continue;
    }
    const days = wantedDays !== null && definition.daysPerWeek === wantedDays;
    const focus = focusOverlap(signals, definition);
    const catalogGoals = [...(definition.supportedGoals as unknown as string[]), ...(definition.backupGoals as unknown as string[])];
    const goal = Boolean(signals.goal && CATALOG_GOALS[signals.goal].some((name) => catalogGoals.includes(name)));

    // A programme opened in place of the build has to be the week that was
    // asked for: the days and the goal said, not a two-day base or a
    // mobility flow that only won because nothing else fit the reader
    // (review, 2026-10-07). Nothing left is an answer too — the composer
    // builds the trimmed week and says so.
    if ((wantedDays !== null && !days) || (signals.goal && !goal)) {
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
 * Whether the reader could run this programme at all: their gear, their
 * level. The score only weighed days, focus and goal, so a beginner at home
 * with no equipment who tapped five days was opened straight into an
 * advanced full-gym programme (review, 2026-10-07). What the brief does not
 * say does not filter.
 */
function fitsReader(signals: ProgrammeBriefSignals, definition: RecommendationProgramDefinition): boolean {
  if (signals.experience && !definition.supportedLevels.includes(CATALOG_LEVEL[signals.experience])) {
    return false;
  }
  if (holdsAvoidedLift(signals, definition.programId)) {
    return false;
  }
  if (signals.equipment === 'home_gym') {
    return definition.equipmentTier === 'low_equipment';
  }
  if (signals.equipment === 'minimal') {
    return definition.equipmentTier === 'low_equipment' && programFitsEquipment(definition.programId, [...DUMBBELL_HOME_ITEMS]);
  }
  if (signals.equipment === 'bodyweight') {
    return definition.equipmentTier === 'low_equipment' && programFitsEquipment(definition.programId, []);
  }
  return true;
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
 * Whether the catalog is the better answer than composing.
 *
 * Only when the composer would have to trim the ask. Within its range the
 * composer builds exactly what was described, and steering that to a
 * ready-made programme would be answering a different question.
 */
export function shouldOfferCatalogInstead(signals: ProgrammeBriefSignals): boolean {
  return signals.requestedDaysPerWeek !== null;
}
