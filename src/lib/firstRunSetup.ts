import { projectTrainingWeekdays } from './programTrainingDays';
import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { buildRecommendationReasonLines } from './recommendationExplanation';
import { buildRecommendationInput } from './recommendationInput';
import { getRecommendationProgramDefinition } from './recommendationCatalog';
import { recommendPrograms } from './recommendationScoring';
import { runStandInKind } from './cautionExerciseFilter';
import { programRunWork } from './recommendationWeekFit';
import { resolveAvailableEquipment } from './equipmentExerciseFilter';
import { buildTailoringRecommendationNote, TailoringPreferencesInput } from './tailoringFit';
import { t } from './i18n';
import {
  AppLanguage,
  SetupCautionFlag,
  SetupDaysPerWeek,
  SetupEquipment,
  SetupAgeRange,
  SetupGender,
  SetupGuidanceMode,
  SetupScheduleMode,
  SetupWeekday,
  SetupGoal,
  SetupLevel,
  SetupFocusArea,
  SetupSecondaryOutcome,
  SetupTrainingEnvironment,
  UnitPreference,
} from '../types/models';
import type {
  RecommendationCandidate,
  RecommendationConfidence,
  RecommendationTrainingBlock,
  RecommendationWaterfallDecision,
  TemplateFamilyId,
} from '../types/recommendation';
import { AICoachTrainingContext } from '../types/aiCoach';
import { emptyAiCoachHistory } from './aiTrainingContext';
import { getFocusAreaLabel } from './focusAreaPresentation';

export interface FirstRunSetupSelection {
  profileName?: string | null;
  gender: SetupGender;
  age?: number | null;
  ageRange?: SetupAgeRange;
  heightCm?: number | null;
  goal: SetupGoal;
  goals?: SetupGoal[];
  level: SetupLevel;
  daysPerWeek: SetupDaysPerWeek;
  equipment: SetupEquipment;
  trainingEnvironment: SetupTrainingEnvironment;
  /** Equipment the user actually has, as toggled on the setup step (labels). */
  equipmentItems?: string[];
  secondaryOutcomes: SetupSecondaryOutcome[];
  focusAreas: SetupFocusArea[];
  /** Body parts the user flagged on the avoid step, with a caution level each. */
  cautionFlags?: SetupCautionFlag[];
  guidanceMode: SetupGuidanceMode;
  scheduleMode: SetupScheduleMode;
  /** Plan-review toggle: Vinha manages weekly progression automatically. */
  automatedProgression?: boolean;
  weeklyMinutes?: number | null;
  availableDays: SetupWeekday[];
  /**
   * A repeating on/off rhythm chosen on the days step (e.g. [true, true,
   * false] = two on, one off), when the reader trains in cycles rather than
   * on named weekdays. Null = weekdays are the whole answer. Persisted on
   * the plan the questions build (WorkoutPlan.trainingCycle), anchored at
   * apply time.
   */
  trainingCyclePattern?: boolean[] | null;
  currentWeightKg?: number | null;
  targetWeightKg?: number | null;
  unitPreference: UnitPreference;
}

export interface FirstRunRecommendation {
  featuredProgramId: string;
  secondaryProgramId: string | null;
  alternativeProgramIds: string[];
  confidence: RecommendationConfidence;
  recommendationConfidence: number;
  fallbackReason: string | null;
  trainingBlock: RecommendationTrainingBlock;
  primaryFamilyId: TemplateFamilyId;
  scoredCandidates: RecommendationCandidate[];
  waterfall: RecommendationWaterfallDecision | null;
  mismatchNote: string | null;
}

export type FirstRunStep =
  | 'location'
  | 'goal'
  | 'profile'
  | 'focus'
  | 'review'
  | 'gender'
  | 'planning'
  | 'about'
  | 'recommendation';

const PROGRAM_IDS = {
  minimal: 'tpl_2_day_minimal_full_body_v1',
  beginnerStrength: 'tpl_2_day_beginner_strength_v1',
  strengthBase: 'tpl_3_day_strength_base_v1',
  strengthSize: 'tpl_4_day_strength_size_v1',
  upperLowerLite: 'tpl_3_day_upper_lower_lite_v1',
  pushPullLegs: 'tpl_3_day_push_pull_legs_v1',
  muscleBuilder: 'tpl_4_day_muscle_builder_v1',
  powerbuilding: 'tpl_4_day_powerbuilding_v1',
  mobilityReset: 'tpl_2_day_mobility_reset_v1',
  yogaRecovery: 'tpl_2_day_yoga_recovery_v1',
  runMobility: 'tpl_3_day_run_mobility_v1',
} as const;

export const DEFAULT_RHYTHM_BY_DAYS: Record<SetupDaysPerWeek, SetupWeekday[]> = {
  2: ['mon', 'thu'],
  3: ['mon', 'wed', 'fri'],
  4: ['mon', 'tue', 'thu', 'sat'],
  5: ['mon', 'tue', 'thu', 'fri', 'sat'],
  6: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
};

/**
 * A catalog template's `daysPerWeek` is a plain number; the preference is the
 * five the questionnaire offers. Callers that carry one into the other need to
 * narrow, not cast — a template outside the range must store null rather than a
 * value nothing downstream has a branch for.
 */
export function isSetupDaysPerWeek(value: number): value is SetupDaysPerWeek {
  return Object.prototype.hasOwnProperty.call(DEFAULT_RHYTHM_BY_DAYS, value);
}

const WEEKDAY_ORDER: SetupWeekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * The week a days step goes back to when its rhythm is removed.
 *
 * A rhythm sets the day count from its own arithmetic (2 on, 1 off is five a
 * week) and leaves the weekday list alone, and removing it only cleared the
 * pattern. The count stayed at the rhythm's: chip 5 lit beside Mon/Wed/Fri,
 * and a five-day plan saved under a three-day week (2026-09-17). The lit
 * weekdays are what the step shows once the rhythm is gone, so they are the
 * answer, and the count is theirs.
 */
export function weekAfterCycleRemoved(
  availableDays: readonly SetupWeekday[],
  daysPerWeek: SetupDaysPerWeek,
): { availableDays: SetupWeekday[]; daysPerWeek: SetupDaysPerWeek } {
  const count = availableDays.length;
  // An empty list draws the count's own rhythm, and so does a stored list the
  // step could not have produced (it keeps two to six).
  if (!isSetupDaysPerWeek(count)) {
    return { availableDays: [...DEFAULT_RHYTHM_BY_DAYS[daysPerWeek]], daysPerWeek };
  }
  const days = [...availableDays].sort((left, right) => WEEKDAY_ORDER.indexOf(left) - WEEKDAY_ORDER.indexOf(right));
  return { availableDays: days, daysPerWeek: count };
}

export const DEFAULT_FIRST_RUN_SELECTION: FirstRunSetupSelection = {
  profileName: null,
  gender: 'unspecified',
  age: 25,
  ageRange: '19_25',
  heightCm: null,
  goal: 'strength',
  goals: ['strength'],
  level: 'beginner',
  daysPerWeek: 3,
  equipment: 'gym',
  trainingEnvironment: 'full_gym',
  equipmentItems: [],
  secondaryOutcomes: [],
  focusAreas: [],
  cautionFlags: [],
  guidanceMode: 'guided_editable',
  scheduleMode: 'app_managed',
  automatedProgression: true,
  weeklyMinutes: null,
  availableDays: [],
  trainingCyclePattern: null,
  currentWeightKg: null,
  targetWeightKg: null,
  unitPreference: 'kg',
};

function getGoalLabel(goal: SetupGoal) {
  switch (goal) {
    case 'strength':
      return 'strength';
    case 'muscle':
      return 'muscle-building';
    case 'lean_athletic':
      return 'lean athletic training';
    case 'general_fitness':
      return 'general fitness';
    case 'general':
      return 'general fitness';
    case 'run_mobility':
      return 'run + mobility';
    default:
      return 'training';
  }
}

// Callers that build AI-context prose leave `language` off on purpose: that
// text goes to the model, not to a screen, and it stays English.
export function getSetupGoalTitle(goal: SetupGoal, language: AppLanguage = 'en') {
  switch (goal) {
    case 'strength':
      return t(language, 'setup.goal.strength');
    case 'muscle':
      return t(language, 'setup.goal.muscle');
    case 'lean_athletic':
      return t(language, 'setup.goal.leanAthletic');
    case 'general_fitness':
      return t(language, 'setup.goal.generalFitness');
    case 'general':
      return t(language, 'setup.goal.loseWeight');
    case 'run_mobility':
      return t(language, 'setup.goal.endurance');
    default:
      return t(language, 'setup.goal.default');
  }
}


export function getSetupEquipmentTitle(equipment: SetupEquipment, language: AppLanguage = 'en') {
  switch (equipment) {
    case 'gym':
      return t(language, 'setup.equip.gym');
    case 'home':
      return t(language, 'setup.equip.home');
    case 'minimal':
      return t(language, 'setup.equip.minimal');
    default:
      return t(language, 'setup.equip.default');
  }
}

export function getSecondaryOutcomeLabel(outcome: SetupSecondaryOutcome) {
  switch (outcome) {
    case 'consistency':
      return 'consistency';
    case 'mobility':
      return 'mobility';
    case 'conditioning':
      return 'conditioning';
    case 'muscle':
      return 'muscle';
    case 'strength':
      return 'strength';
    default:
      return 'progress';
  }
}

export function getWeekdayShortLabel(day: SetupWeekday, language: AppLanguage = 'en') {
  switch (day) {
    case 'mon':
      return t(language, 'setup.day.mon');
    case 'tue':
      return t(language, 'setup.day.tue');
    case 'wed':
      return t(language, 'setup.day.wed');
    case 'thu':
      return t(language, 'setup.day.thu');
    case 'fri':
      return t(language, 'setup.day.fri');
    case 'sat':
      return t(language, 'setup.day.sat');
    case 'sun':
      return t(language, 'setup.day.sun');
    default:
      return t(language, 'setup.day.default');
  }
}

export function formatWeekdayList(days: SetupWeekday[], language: AppLanguage = 'en') {
  return formatList(days.map((day) => getWeekdayShortLabel(day, language)));
}

/**
 * Display label for a focus area.
 *
 * Defaults to English because two callers need the English word as data, not
 * as copy: the saved programme name (`buildFirstRunCustomProgramName`) and the
 * AI context prose. UI callers pass the user's language.
 */
export function getFocusAreaTitle(area: SetupFocusArea, language: AppLanguage = 'en') {
  return getFocusAreaLabel(area, language);
}

function formatList(items: string[]) {
  if (items.length === 0) {
    return '';
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function formatSecondaryOutcomeList(outcomes: SetupSecondaryOutcome[]) {
  return formatList(outcomes.map((outcome) => getSecondaryOutcomeLabel(outcome)));
}

export function formatFocusAreaList(focusAreas: SetupFocusArea[]) {
  return formatList(focusAreas.map((area) => getFocusAreaTitle(area)));
}

function roundToNearestTen(value: number) {
  return Math.round(value / 10) * 10;
}

function resolveDefaultRhythm(daysPerWeek: number) {
  if (daysPerWeek === 2 || daysPerWeek === 3 || daysPerWeek === 4 || daysPerWeek === 5 || daysPerWeek === 6) {
    return DEFAULT_RHYTHM_BY_DAYS[daysPerWeek];
  }

  return DEFAULT_RHYTHM_BY_DAYS[DEFAULT_FIRST_RUN_SELECTION.daysPerWeek];
}

export function getRecommendedWeeklyMinutes(daysPerWeek: number, estimatedSessionDuration?: number | null) {
  const fallbackSessionDuration = daysPerWeek >= 4 ? 55 : daysPerWeek === 2 ? 45 : 50;
  return roundToNearestTen(Math.max(60, daysPerWeek * (estimatedSessionDuration ?? fallbackSessionDuration)));
}

export function getEffectiveWeeklyMinutes(
  selection: Pick<FirstRunSetupSelection, 'weeklyMinutes'>,
  daysPerWeek: number,
  estimatedSessionDuration?: number | null,
) {
  return typeof selection.weeklyMinutes === 'number' && selection.weeklyMinutes > 0
    ? selection.weeklyMinutes
    : getRecommendedWeeklyMinutes(daysPerWeek, estimatedSessionDuration);
}

export function resolveProjectedTrainingDays(
  selection: Pick<FirstRunSetupSelection, 'scheduleMode' | 'availableDays'>,
  daysPerWeek: number,
) {
  const defaultRhythm = resolveDefaultRhythm(daysPerWeek);
  return projectTrainingWeekdays(selection, defaultRhythm);
}

export function buildFirstRunRecommendationReasons(
  selection: FirstRunSetupSelection,
  options: {
    projectedDaysPerWeek: number;
    estimatedSessionDuration?: number | null;
    mismatchNote?: string | null;
    language?: AppLanguage;
    /**
     * The programme the lines are about, so they can say its runs are walks,
     * or leave runs unsaid where it has none.
     */
    programId?: string | null;
    /** What the reader's caution flags changed in the week (buildCautionAdaptationLine). */
    cautionLine?: string | null;
  },
  tailoringPreferences?: TailoringPreferencesInput | null,
) {
  const runWork = options.programId
    ? programRunWork(options.programId, buildRecommendationInput(selection))
    : null;
  return buildRecommendationReasonLines(selection, { ...options, runWork }, tailoringPreferences);
}





function buildLowEquipmentMismatchNote(
  selection: FirstRunSetupSelection,
  featuredDays: number,
  language: AppLanguage,
  tailoringPreferences?: TailoringPreferencesInput | null,
) {
  const selfDirected =
    selection.guidanceMode === 'self_directed' ? t(language, 'mismatch.lowEquipment.selfDirected') : null;

  // "Lighter than your target" only when it is: the home programmes now run
  // four to six days, and the sentence used to follow any home pick
  // (bug hunt, 2026-10-04).
  if (featuredDays < selection.daysPerWeek) {
    const lighter = t(language, 'mismatch.lowEquipment.lighter');
    return selfDirected ? `${lighter} ${selfDirected}` : lighter;
  }

  // The week meets the days asked for, so the only thing this note had left to
  // say was "you picked lighter gear", under a line that already says the
  // programme is built for it. Nothing is said instead (persona hunt,
  // 2026-10-08).
  return selfDirected ?? buildTailoringRecommendationNote(tailoringPreferences, language);
}

/**
 * The note under the recommendation: why the pick is not an exact fit.
 *
 * `featuredDaysOverride` is the day count of the week the reader is shown, once
 * it is composed. The note is first built from the catalog definition, and the
 * composer fits the week to the days asked for, so a 4-day definition at 3 days
 * asked read "keeps this start at 4 days" over a 3-day week, and a 3-day one at
 * 4 days read "lighter than your target" over four days (persona hunt,
 * 2026-10-08).
 */
export function buildRecommendationMismatchNote(
  selection: FirstRunSetupSelection,
  featuredProgramId: string,
  secondaryProgramId: string | null,
  tailoringPreferences?: TailoringPreferencesInput | null,
  language: AppLanguage = 'en',
  featuredDaysOverride?: number | null,
) {
  const featuredDefinition = getRecommendationProgramDefinition(featuredProgramId);
  const definitionDays = featuredDefinition?.daysPerWeek ?? getWorkoutTemplateById(featuredProgramId)?.daysPerWeek ?? selection.daysPerWeek;
  const featuredDays =
    typeof featuredDaysOverride === 'number' && featuredDaysOverride > 0 ? featuredDaysOverride : definitionDays;

  // The run + mobility note is about the catalog programme's own three days
  // and the optional extra, not about the composed week, so it keeps the
  // definition's count.
  if (selection.goal === 'run_mobility' && featuredProgramId === PROGRAM_IDS.runMobility && selection.daysPerWeek > definitionDays) {
    const secondaryName = secondaryProgramId ? getWorkoutTemplateById(secondaryProgramId)?.name ?? null : null;
    // "A run + mobility split" is not what a reader whose runs are walks or
    // rides was handed (bug hunt, 2026-10-07, #35).
    const standIn = runStandInKind(selection.cautionFlags ?? [], resolveAvailableEquipment(selection));
    const keys = standIn === 'ride'
      ? (['mismatch.rideMobility', 'mismatch.rideMobility.withExtra'] as const)
      : standIn === 'walk'
        ? (['mismatch.walkMobility', 'mismatch.walkMobility.withExtra'] as const)
        : (['mismatch.runMobility', 'mismatch.runMobility.withExtra'] as const);
    return secondaryName
      ? t(language, keys[1], { name: secondaryName })
      : t(language, keys[0]);
  }

  if (selection.equipment !== 'gym' && featuredDefinition?.equipmentTier === 'low_equipment') {
    return buildLowEquipmentMismatchNote(selection, featuredDays, language, tailoringPreferences);
  }

  if (featuredDays !== selection.daysPerWeek) {
    return t(language, 'mismatch.closestDays', { count: featuredDays });
  }

  return buildTailoringRecommendationNote(tailoringPreferences, language);
}

/**
 * The recommendation's note, restated for the week the reader is shown.
 *
 * With no composed week there is nothing to restate and the stored note stands.
 */
export function resolveMismatchNoteForWeek(
  selection: FirstRunSetupSelection,
  recommendation: { featuredProgramId: string; secondaryProgramId?: string | null; mismatchNote?: string | null },
  composedDays: number | null | undefined,
  tailoringPreferences?: TailoringPreferencesInput | null,
  language: AppLanguage = 'en',
) {
  if (typeof composedDays !== 'number' || composedDays <= 0) {
    return recommendation.mismatchNote ?? null;
  }
  return buildRecommendationMismatchNote(
    selection,
    recommendation.featuredProgramId,
    recommendation.secondaryProgramId ?? null,
    tailoringPreferences,
    language,
    composedDays,
  );
}

export function resolveFirstRunRecommendationWithTailoring(
  selection: FirstRunSetupSelection,
  tailoringPreferences?: TailoringPreferencesInput | null,
  /** The language the mismatch note is written in (bug hunt, 2026-10-04). */
  language: AppLanguage = 'en',
): FirstRunRecommendation {
  const recommendation = recommendPrograms(buildRecommendationInput(selection), tailoringPreferences);

  return {
    ...recommendation,
    mismatchNote: buildRecommendationMismatchNote(selection, recommendation.featuredProgramId, recommendation.secondaryProgramId ?? null, tailoringPreferences, language),
  };
}

export function buildFirstRunPromptSuggestions(
  selection: FirstRunSetupSelection,
  recommendationProgramName?: string | null,
) {
  const goalLabel = getGoalLabel(selection.goal);
  const recommendationLabel = recommendationProgramName ?? 'this plan';
  return [
    `Best ${selection.daysPerWeek}-day ${goalLabel} start?`,
    `${recommendationLabel} or another plan?`,
    selection.guidanceMode === 'self_directed'
      ? 'Turn this into custom?'
      : `How should I start with ${selection.daysPerWeek} days?`,
  ];
}

export function buildFirstRunAiCoachContext(
  selection: FirstRunSetupSelection,
  readyProgramCount: number,
): AICoachTrainingContext {
  return {
    unitPreference: selection.unitPreference,
    activeSession: null,
    recentCompletedSessions: [],
    trackedLifts: [],
    latestTopSets: [],
    sessionsThisWeek: 0,
    sessionsLast30Days: 0,
    rhythm: [],
    readyProgramCount,
    recommendedProgramId: null,
    recommendedProgramTitle: null,
    customProgramTitle: null,
    plateaus: [],
    // A user who has not trained yet has no load history to read.
    fatigue: { acwr: 0, recoveryScore: 50, signal: 'undertrained', sessionCount7d: 0, confident: false },
    history: emptyAiCoachHistory(selection.availableDays),
    plannerSetup: null,
  };
}

// Short punchy plan names (user decision 2026-07-18): goal flavor + optional
// focus + level tier — "Massive Quads Pro", "Lean Athletic Amateur". No more
// "My 4-Day ... Split" mouthfuls; the day count lives in the stats, not the name.
const PROGRAM_NAME_TIERS: Record<SetupLevel, string> = {
  beginner: 'Amateur',
  advanced: 'Advanced',
  pro: 'Pro',
};

/**
 * The Finnish names keep the English tier word — 2026-08-11, user's call.
 *
 * "Konkari" reads as a claim about the person rather than a tag on a
 * programme, and a tester said the word was the confusing part. English keeps
 * it neutral, so this map deliberately mirrors PROGRAM_NAME_TIERS instead of
 * translating it. Do not "finish" the translation later: the Finnish words
 * were removed on purpose.
 */
const PROGRAM_NAME_TIERS_FI: Record<SetupLevel, string> = {
  beginner: 'Amateur',
  advanced: 'Advanced',
  pro: 'Pro',
};

/**
 * Finnish compounds instead of adjective + noun.
 *
 * "Strong Chest Amateur" translated word for word is "Vahva rinta", which
 * works — until the focus is plural (olkapäät, kädet, pakarat) and the
 * adjective has to agree: "Vahvat olkapäät". Finnish sidesteps the agreement
 * entirely by compounding the body part onto the goal noun, which is also how
 * a Finn would actually name the thing: rinta + voima → "Rintavoima".
 */
const PROGRAM_FOCUS_STEM_FI: Partial<Record<SetupFocusArea, string>> = {
  chest: 'Rinta',
  back: 'Selkä',
  shoulders: 'Olkapää',
  arms: 'Käsi',
  core: 'Keskivartalo',
  quads: 'Etureisi',
  glutes: 'Pakara',
  hamstrings: 'Takareisi',
  calves: 'Pohje',
  legs: 'Jalka',
  mobility: 'Liikkuvuus',
  conditioning: 'Kunto',
  bodyweight: 'Kehonpaino',
};

/** The goal as a Finnish noun, lower-case because it is the compound's tail. */
const PROGRAM_GOAL_NOUN_FI: Record<string, string> = {
  muscle: 'massa',
  strength: 'voima',
  lean_athletic: 'kunto',
  run_mobility: 'kestävyys',
};

function buildFinnishProgramName(selection: FirstRunSetupSelection) {
  const tier = PROGRAM_NAME_TIERS_FI[selection.level] ?? PROGRAM_NAME_TIERS_FI.beginner;
  const focus = selection.focusAreas.length > 0 ? selection.focusAreas[0] : null;
  const stem = focus ? PROGRAM_FOCUS_STEM_FI[focus] : null;
  const goalNoun = PROGRAM_GOAL_NOUN_FI[selection.goal] ?? 'kunto';

  if (stem) {
    return `${stem}${goalNoun} · ${tier}`;
  }

  const goalTitle =
    selection.goal === 'run_mobility'
      ? 'Juoksu ja liikkuvuus'
      : selection.goal === 'lean_athletic'
        ? // The one Finnish name for the goal, as the questionnaire card has it:
          // the saved plan, Home and the reasons each had their own wording
          // (persona hunt, 2026-10-08).
          t('fi', 'setup.goal.leanAthletic')
        : selection.goal === 'muscle'
          ? 'Massa'
          : selection.goal === 'strength'
            ? 'Voima'
            : 'Kunto';

  return `${goalTitle} · ${tier}`;
}

/**
 * The name is stored on the created template, not rendered from a key, so it
 * has to be written in the user's language at creation time. A plan named in
 * Finnish keeps its Finnish name if the app later switches to English — which
 * is right: by then it is the name of *their* program, and they can rename it.
 */
export function buildFirstRunCustomProgramName(
  selection: FirstRunSetupSelection,
  language: AppLanguage = 'en',
) {
  if (language === 'fi') {
    return buildFinnishProgramName(selection);
  }

  const tier = PROGRAM_NAME_TIERS[selection.level] ?? 'Amateur';
  const focusTitle = selection.focusAreas.length > 0 ? getFocusAreaTitle(selection.focusAreas[0]) : null;

  if (focusTitle) {
    const flavor =
      selection.goal === 'muscle'
        ? 'Massive'
        : selection.goal === 'strength'
          ? 'Strong'
          : selection.goal === 'lean_athletic'
            ? 'Lean'
            : selection.goal === 'run_mobility'
              ? 'Hybrid'
              : 'Fit';
    return `${flavor} ${focusTitle} ${tier}`;
  }

  const goalName =
    selection.goal === 'run_mobility'
      ? 'Run + Mobility'
      : selection.goal === 'lean_athletic'
        ? 'Lean Athletic'
        : selection.goal === 'general' || selection.goal === 'general_fitness'
          ? 'Fit'
          : selection.goal === 'muscle'
            ? 'Massive'
            : 'Strength';

  return `${goalName} ${tier}`;
}

export function getRecommendedProgramName(programId: string | null) {
  if (!programId) {
    return null;
  }

  return getWorkoutTemplateById(programId)?.name ?? null;
}
