import { getRecommendationProgramDefinition } from './recommendationCatalog';
import { estimateProgrammeSessionMinutesList } from './programmeMinutes';
import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { READY_PROGRAM_MIN_BLOCK_WEEKS, getReadyProgramBlockWeeks } from './readyProgramDuration';
import { formatLiftDisplayLabel } from './displayLabel';
import { pickPoolVariant, SUPPLEMENTAL_DAY_POOL, SupplementalDayKind } from './catalogExercisePools';
import { projectTrainingWeekdays } from './programTrainingDays';
import { resolveAvailableEquipment } from './equipmentExerciseFilter';
import type { FirstRunSetupSelection } from './firstRunSetup';
import type {
  RecommendationProgrammeDurationModel,
  RecommendationProgrammeProfile,
  RecommendationSessionBlock,
  RecommendationSessionComposition,
  RecommendationTrainingBlock,
  TemplateFamilyId,
} from '../types/recommendation';
import type {
  RecommendationPlanReadyPayload,
  RecommendationPlanReadyScheduleDay,
  RecommendationPlanReadyWeekPhase,
} from '../types/recommendation';
import type { SetupFocusArea, SetupWeekday } from '../types/models';

const STARTER_PHASE_LABELS = ['Week 1 Baseline', 'Week 2 Build', 'Week 3 Build', 'Week 4 Review + easier week'];
const DEFAULT_RHYTHM_BY_DAYS: Record<number, SetupWeekday[]> = {
  2: ['mon', 'thu'],
  3: ['mon', 'wed', 'fri'],
  4: ['mon', 'tue', 'thu', 'sat'],
  5: ['mon', 'tue', 'thu', 'fri', 'sat'],
  6: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
};

/**
 * The block length onboarding promises: the catalog's answer for the
 * programme it is handing over.
 *
 * Falls back to the shortest block the catalog can produce rather than to a
 * number of its own. An unknown programme id means the recommendation is
 * already in trouble; inventing a different calendar on top of it would only
 * hide that.
 */
function resolveStarterBlockWeeks(programId: string): number {
  const template = getWorkoutTemplateById(programId);
  return template ? getReadyProgramBlockWeeks(template) : READY_PROGRAM_MIN_BLOCK_WEEKS;
}

function buildStarterDurationModel(blockLengthWeeks: number): RecommendationProgrammeDurationModel {
  return {
    status: 'starter',
    blockLengthWeeks,
    label: `${blockLengthWeeks}-week starter block`,
    description:
      `A concrete first block: a repeating four-week cycle — baseline, build, build, easier week — `
      + `run over ${blockLengthWeeks} weeks, and editable at any point.`,
    laterDurations: [],
  };
}

function block(type: RecommendationSessionBlock['type'], label: string, body: string): RecommendationSessionBlock {
  return { type, label, body };
}

function buildFamilySessionComposition(familyId: TemplateFamilyId): RecommendationSessionComposition {
  switch (familyId) {
    case 'strength_base':
    case 'powerbuilding':
      return {
        prepBlock: block('prep', 'Prep', 'Warm up with joint-specific mobility and 1-3 ramp sets before the first heavy anchor lift.'),
        mainBlock: block('main', 'Main work', 'Start with the key strength lift or heavy compound while focus and energy are highest.'),
        supportBlock: block('support', 'Support work', 'Use secondary compounds and accessories to build the muscles that support the main lifts.'),
        focusBlock: null,
        conditioningBlock: null,
        cooldownBlock: block('cooldown', 'Cooldown', 'Finish with easy breathing and short mobility for the joints used hardest in the session.'),
      };
    case 'mass_hypertrophy':
      return {
        prepBlock: block('prep', 'Prep', 'Use muscle-specific warmup sets and light activation before the first hard hypertrophy block.'),
        mainBlock: block('main', 'Main work', 'Open with the highest-value compound or machine movement for the target muscles.'),
        supportBlock: block('support', 'Support work', 'Add stable accessory work so volume builds without random exercise changes.'),
        focusBlock: block('focus', 'Focus work', 'Give selected focus areas extra quality work only after the main structure is covered.'),
        conditioningBlock: null,
        cooldownBlock: block('cooldown', 'Cooldown', 'Downshift with short recovery work so the next muscle-building session stays repeatable.'),
      };
    case 'glute_priority':
      return {
        prepBlock: block('prep', 'Prep', 'Start with hip mobility, glute activation, and light ramp sets before heavy lower-body work.'),
        mainBlock: block('main', 'Main work', 'Prioritize the main glute or lower-body lift while technique and output are fresh.'),
        supportBlock: block('support', 'Support work', 'Use hinge, lunge, squat, bridge, or curl patterns to support the focus area.'),
        focusBlock: block('focus', 'Focus work', 'Keep glute-focused accessories visible without replacing the full lower-body structure.'),
        conditioningBlock: null,
        cooldownBlock: block('cooldown', 'Cooldown', 'Use short hip, glute, hamstring, and breathing recovery after lower-body work.'),
      };
    case 'athletic_recomp':
      return {
        prepBlock: block('prep', 'Prep', 'Use dynamic full-body prep and gradually raise intensity before strength or conditioning work.'),
        mainBlock: block('main', 'Main work', 'Preserve the main resistance or athletic block before adding extra density.'),
        supportBlock: block('support', 'Support work', 'Keep support work efficient so the week stays athletic instead of exhausting.'),
        focusBlock: null,
        conditioningBlock: block('conditioning', 'Conditioning', 'Add conditioning or density only where recovery stays controlled.'),
        cooldownBlock: block('cooldown', 'Cooldown', 'Cool down with easy movement and breathing so conditioning does not bury recovery.'),
      };
    case 'low_equipment':
    case 'full_body_minimal':
      return {
        prepBlock: block('prep', 'Prep', 'Rehearse the first movements with bodyweight range, tempo, and easy variations before working sets.'),
        mainBlock: block('main', 'Main work', 'Cover the major movement patterns with simple, repeatable exercises.'),
        supportBlock: block('support', 'Support work', 'Use reps, tempo, range, unilateral work, and density when load options are limited.'),
        focusBlock: null,
        conditioningBlock: null,
        cooldownBlock: block('cooldown', 'Cooldown', 'Finish with a short mobility reset based on the hardest movement pattern of the day.'),
      };
    case 'joint_friendly':
      return {
        prepBlock: block('prep', 'Prep', 'Start with gentle range work and supported movement rehearsal before adding load.'),
        mainBlock: block('main', 'Main work', 'Use stable supported exercises that keep joints controlled and repeatable.'),
        supportBlock: block('support', 'Support work', 'Build strength with moderate effort, smooth execution, and conservative progression.'),
        focusBlock: null,
        conditioningBlock: null,
        cooldownBlock: block('cooldown', 'Cooldown', 'Use low-irritation mobility and breathing rather than aggressive stretching.'),
      };
    default:
      return {
        prepBlock: block('prep', 'Prep', 'Warm up with simple movement prep before the first hard block.'),
        mainBlock: block('main', 'Main work', 'Complete the highest-value training work first.'),
        supportBlock: block('support', 'Support work', 'Use supporting exercises to round out the session.'),
        focusBlock: null,
        conditioningBlock: null,
        cooldownBlock: block('cooldown', 'Cooldown', 'Finish with a short recovery reset.'),
      };
  }
}

function buildFamilyProgrammeProfile(programId: string, familyId: TemplateFamilyId): RecommendationProgrammeProfile {
  // The plan onboarding hands over IS a catalog programme, so its length is
  // the catalog's answer rather than a second constant kept beside it. The
  // two disagreed the moment the catalog moved to 8-12 weeks: the same
  // programme said four weeks on the way in and eight on its own page.
  const blockLengthWeeks = resolveStarterBlockWeeks(programId);
  const base = {
    programId,
    familyId,
    blockLengthWeeks,
    durationModel: buildStarterDurationModel(blockLengthWeeks),
    sessionComposition: buildFamilySessionComposition(familyId),
  };

  switch (familyId) {
    case 'strength_base':
      return {
        ...base,
        progressionStyle: 'strength_wave',
        phaseLabels: STARTER_PHASE_LABELS,
        volumeProgression: 'Use week 1 as the baseline volume, build in weeks 2-3, then pull fatigue back in week 4 before the cycle starts again.',
        intensityProgression: 'Add load conservatively only after clean sets land at the top of the range, then keep week 4 easier for review.',
        exerciseStability: 'Keep anchor lifts stable for the whole block and only rotate support lifts if recovery or equipment demands it.',
        easierWeek: {
          week: 4,
          reason: 'Cut top-set fatigue and total hard work before rebuilding heavier in the final stretch.',
        },
      };
    case 'powerbuilding':
      return {
        ...base,
        progressionStyle: 'powerbuilding_wave',
        phaseLabels: STARTER_PHASE_LABELS,
        volumeProgression: 'Open with enough bodybuilding volume to support the heavy lifts, build for two weeks, then reduce fatigue in week 4.',
        intensityProgression: 'Keep the first three weeks of each cycle strength-led, then use the fourth to review performance before the next one.',
        exerciseStability: 'Hold strength anchors steady and keep volume-day accessories mostly stable so performance and hypertrophy both stay trackable.',
        easierWeek: {
          week: 4,
          reason: 'Use a pivot week to drop fatigue before the final heavy plus volume push.',
        },
      };
    case 'mass_hypertrophy':
      return {
        ...base,
        progressionStyle: 'hypertrophy_accumulation',
        phaseLabels: STARTER_PHASE_LABELS,
        volumeProgression: 'Start with repeatable volume, add reps or quality in weeks 2-3, then use week 4 as an easier review week.',
        intensityProgression: 'Most progression comes from reps and set quality first, with load increases added once the target ranges are stable.',
        exerciseStability: 'Keep the main movement menu steady so muscle groups get repeated exposures instead of constant novelty.',
        easierWeek: {
          week: 4,
          reason: 'Trim fatigue after the first build stretch and decide whether to repeat, edit, or move to a harder block.',
        },
      };
    case 'full_body_minimal':
      return {
        ...base,
        progressionStyle: 'minimal_consistency',
        phaseLabels: STARTER_PHASE_LABELS,
        volumeProgression: 'Keep total work tight, add a little work in weeks 2-3 only if recovery stays easy, then review in week 4.',
        intensityProgression: 'Nudge load upward in small steps after repeatable clean sessions instead of chasing aggressive weekly jumps.',
        exerciseStability: 'Exercises stay very stable so busy weeks do not break the rhythm.',
        easierWeek: {
          week: 4,
          reason: 'Reset fatigue and keep consistency high before the final repeat of the block.',
        },
      };
    case 'joint_friendly':
      return {
        ...base,
        progressionStyle: 'recovery_rebuild',
        phaseLabels: STARTER_PHASE_LABELS,
        volumeProgression: 'Increase total work slowly in weeks 2-3 and only after the previous week feels repeatable.',
        intensityProgression: 'Keep intensity moderate and progress by smoother execution, range, or reps before adding load.',
        exerciseStability: 'Hold the movement menu steady to make recovery signals obvious and avoid irritation from constant swaps.',
        easierWeek: {
          week: 4,
          reason: 'Protect joints and connective tissue before deciding whether to repeat or move on.',
        },
      };
    case 'athletic_recomp':
      return {
        ...base,
        progressionStyle: 'hybrid_wave',
        phaseLabels: STARTER_PHASE_LABELS,
        volumeProgression: 'Progress by adding a little density or total work in weeks 2-3 while keeping the weekly rhythm sustainable.',
        intensityProgression: 'Increase speed, load, or interval quality gradually rather than chasing one hard metric only.',
        exerciseStability: 'Keep the weekly structure stable while allowing small swaps around conditioning or mobility emphasis.',
        easierWeek: {
          week: 4,
          reason: 'Drop density before the last push so the hybrid work stays recoverable.',
        },
      };
    case 'low_equipment':
      return {
        ...base,
        progressionStyle: 'resource_limited_progression',
        phaseLabels: STARTER_PHASE_LABELS,
        volumeProgression: 'Use reps, rounds, or shorter rest as the main volume lever in weeks 2-3 when load options are limited.',
        intensityProgression: 'Progress through tighter execution and harder variations before chasing more external load.',
        exerciseStability: 'Keep swaps minimal so low-equipment progression stays measurable.',
        easierWeek: {
          week: 4,
          reason: 'Lower the density briefly so the block stays repeatable with limited equipment.',
        },
      };
    case 'glute_priority':
      return {
        ...base,
        progressionStyle: 'focus_volume_wave',
        phaseLabels: STARTER_PHASE_LABELS,
        volumeProgression: 'Bias more total work toward the focus area in weeks 2-3, then review recovery in week 4.',
        intensityProgression: 'Let the focus lifts get slightly heavier in the second half while accessories keep the weekly volume high.',
        exerciseStability: 'Keep the focus lifts stable across the block and rotate only non-essential accessories.',
        easierWeek: {
          week: 4,
          reason: 'Make room for another focused wave without burying recovery.',
        },
      };
    default:
      return {
        ...base,
        progressionStyle: 'steady_progression',
        phaseLabels: STARTER_PHASE_LABELS,
        volumeProgression: 'Add work gradually in weeks 2-3, then reduce it briefly and review in week 4.',
        intensityProgression: 'Increase load only when quality stays stable across the prescribed ranges.',
        exerciseStability: 'Keep the core exercise menu steady for the whole block.',
        easierWeek: {
          week: 4,
          reason: 'Manage fatigue before the final push.',
        },
      };
  }
}

export function buildRecommendationProgrammeProfile(programId: string): RecommendationProgrammeProfile {
  const definition = getRecommendationProgramDefinition(programId);
  if (!definition) {
    throw new Error(`Unknown recommendation programme: ${programId}`);
  }

  return buildFamilyProgrammeProfile(programId, definition.familyId);
}

export function getRecommendationProgrammeSummary(programId: string) {
  let profile: RecommendationProgrammeProfile;
  try {
    profile = buildRecommendationProgrammeProfile(programId);
  } catch {
    return null;
  }
  const openingPhase = profile.phaseLabels[0]?.replace(/^Weeks?\s+/i, '') ?? 'base phase';

  return `${profile.blockLengthWeeks}-week block with ${openingPhase.toLowerCase()}, an easier week in week ${profile.easierWeek.week}, and a ${profile.progressionStyle.replace(/_/g, ' ')} finish. ${profile.volumeProgression}`;
}

export function buildRecommendationTrainingBlock(programId: string): RecommendationTrainingBlock {
  const profile = buildRecommendationProgrammeProfile(programId);

  return {
    blockLengthWeeks: profile.blockLengthWeeks,
    currentWeek: 1,
    currentWeekRole: 'baseline',
    weekRoles: ['baseline', 'build', 'build', 'review'],
    summary: `Start with week 1 as a baseline, build in weeks 2-3, then use week 4 as an easier review week.`,
    nextWeekAction: 'After week 1, repeat the same weekly structure in week 2 and add reps or load only when the previous sessions were clean.',
  };
}

function pluralize(count: number, label: string) {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function getWeekdayShortLabel(day: SetupWeekday) {
  switch (day) {
    case 'mon':
      return 'Mon';
    case 'tue':
      return 'Tue';
    case 'wed':
      return 'Wed';
    case 'thu':
      return 'Thu';
    case 'fri':
      return 'Fri';
    case 'sat':
      return 'Sat';
    case 'sun':
      return 'Sun';
    default:
      return 'Day';
  }
}

function resolveProjectedTrainingDays(selection: FirstRunSetupSelection, daysPerWeek: number) {
  const defaultRhythm = DEFAULT_RHYTHM_BY_DAYS[daysPerWeek] ?? DEFAULT_RHYTHM_BY_DAYS[3];
  return projectTrainingWeekdays(selection, defaultRhythm);
}

function roundToNearestTen(value: number) {
  return Math.round(value / 10) * 10;
}

function parseMinutes(meta: string) {
  return Number(meta.match(/^(\d+)/)?.[1] ?? 0);
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

function getGoalTitle(selection: Pick<FirstRunSetupSelection, 'goal' | 'currentWeightKg' | 'targetWeightKg'>) {
  const weightDirection = getWeightDirection(selection);

  switch (selection.goal) {
    case 'strength':
      return 'Get stronger';
    case 'muscle':
      return weightDirection === 'gain' ? 'Build muscle with gain support' : 'Build muscle';
    case 'lean_athletic':
      return weightDirection === 'loss' ? 'Lean & athletic fat-loss support' : 'Lean & athletic';
    case 'general_fitness':
    case 'general':
      return weightDirection === 'loss' ? 'Sustainable fat-loss support' : 'General fitness';
    case 'run_mobility':
      return 'Endurance / cardio';
    default:
      return 'Training';
  }
}

function getCompactGoalTitle(goal: FirstRunSetupSelection['goal']) {
  switch (goal) {
    case 'strength':
      return 'Get stronger';
    case 'muscle':
      return 'Build muscle';
    case 'lean_athletic':
      return 'Lean & athletic';
    case 'run_mobility':
      return 'Endurance';
    case 'general':
    case 'general_fitness':
      return 'General fitness';
    default:
      return 'Training';
  }
}

function getCompactLevelLine(level: FirstRunSetupSelection['level']) {
  switch (level) {
    case 'beginner':
      return 'Beginner base.';
    case 'advanced':
      return 'Advanced build.';
    case 'pro':
      return 'Pro base.';
    default:
      return 'Training base.';
  }
}

function getCompactEquipmentTitle(selection: Pick<FirstRunSetupSelection, 'equipment' | 'trainingEnvironment'>) {
  switch (selection.trainingEnvironment) {
    case 'full_gym':
      return 'Full gym access.';
    case 'home_gym':
      return 'Home gym access.';
    case 'minimal_equipment':
      return 'Minimal access.';
    case 'bodyweight_only':
      return 'Bodyweight access.';
    case 'running_hybrid':
      return 'Running access.';
    default:
      return selection.equipment === 'gym'
        ? 'Full gym access.'
        : selection.equipment === 'home'
          ? 'Home access.'
          : 'Minimal access.';
  }
}

function getFocusAreaTitle(area: SetupFocusArea) {
  switch (area) {
    case 'bodyweight':
      return 'Bodyweight';
    case 'arms':
      return 'Arms';
    case 'glutes':
      return 'Glutes';
    case 'quads':
      return 'Quads';
    case 'hamstrings':
      return 'Hamstrings';
    case 'calves':
      return 'Calves';
    case 'legs':
      return 'Legs';
    case 'chest':
      return 'Pecs';
    case 'shoulders':
      return 'Shoulders';
    case 'back':
      return 'Back';
    case 'core':
      return 'Abs';
    case 'mobility':
      return 'Mobility';
    case 'conditioning':
      return 'Conditioning';
    default:
      return 'Focus';
  }
}

function getWeightDirection(selection: Pick<FirstRunSetupSelection, 'currentWeightKg' | 'targetWeightKg'>) {
  if (typeof selection.currentWeightKg !== 'number' || typeof selection.targetWeightKg !== 'number') {
    return null;
  }

  const difference = selection.targetWeightKg - selection.currentWeightKg;
  if (difference > 0.5) {
    return 'gain';
  }

  if (difference < -0.5) {
    return 'loss';
  }

  return 'maintain';
}

function buildSelectionSessionComposition(
  selection: FirstRunSetupSelection,
  profile: RecommendationProgrammeProfile,
): RecommendationSessionComposition {
  if (selection.trainingEnvironment === 'running_hybrid' || selection.goal === 'run_mobility') {
    return {
      prepBlock: block('prep', 'Prep', 'Use dynamic ankle, calf, hip and glute prep, then ease into the first run or strength block.'),
      mainBlock: block('main', 'Main work', 'Keep the primary run, strength, or hybrid block clear before adding extra density.'),
      supportBlock: block('support', 'Support work', 'Use core, mobility, and lower-leg support so running and lifting recover together.'),
      focusBlock: profile.sessionComposition.focusBlock,
      conditioningBlock: block('conditioning', 'Conditioning', 'Progress one running or conditioning exposure at a time, not every session.'),
      cooldownBlock: block('cooldown', 'Cooldown', 'Cool down with calves, hips, easy breathing, and mobility after run or conditioning days.'),
    };
  }

  if (selection.trainingEnvironment === 'bodyweight_only') {
    return {
      prepBlock: block('prep', 'Prep', 'Warm up through bodyweight movement rehearsal, range, tempo, and easier variations.'),
      mainBlock: block('main', 'Main work', 'Train the main bodyweight movement patterns with repeatable effort and clean positions.'),
      supportBlock: block('support', 'Support work', 'Progress with reps, range, tempo, holds, density, and harder variations before load.'),
      focusBlock: profile.sessionComposition.focusBlock,
      conditioningBlock: selection.goal === 'lean_athletic'
        ? block('conditioning', 'Conditioning', 'Use short density blocks only when the main bodyweight work stays clean.')
        : null,
      cooldownBlock: block('cooldown', 'Cooldown', 'Finish with a short mobility and recovery reset for the hardest bodyweight pattern.'),
    };
  }

  if (selection.goal === 'muscle') {
    return {
      ...profile.sessionComposition,
      prepBlock: block('prep', 'Prep', 'Use muscle-specific prep, light activation, and warmup sets before the first hard set.'),
      cooldownBlock: block('cooldown', 'Cooldown', 'Finish with short recovery work and breathing so the next muscle session stays repeatable.'),
    };
  }

  if (selection.goal === 'strength') {
    return {
      ...profile.sessionComposition,
      prepBlock: block('prep', 'Prep', 'Use mobility plus ramp-up sets before heavy anchor lifts so working sets start clean.'),
      cooldownBlock: block('cooldown', 'Cooldown', 'Use easy breathing and joint-specific mobility after the heavy work.'),
    };
  }

  return profile.sessionComposition;
}

function getSessionBlocks(composition: RecommendationSessionComposition) {
  return [
    composition.prepBlock,
    composition.mainBlock,
    composition.supportBlock,
    composition.focusBlock,
    composition.conditioningBlock,
    composition.cooldownBlock,
  ].filter((entry): entry is RecommendationSessionBlock => Boolean(entry));
}

function getStructureLabel(familyId: TemplateFamilyId, daysPerWeek: number) {
  if (familyId === 'athletic_recomp') {
    return 'Hybrid rhythm';
  }

  if (familyId === 'strength_base') {
    return 'Strength base';
  }

  if (familyId === 'mass_hypertrophy') {
    return 'Hypertrophy split';
  }

  if (familyId === 'powerbuilding') {
    return 'Strength + volume split';
  }

  return daysPerWeek <= 3 ? 'Full body focus' : 'Split focus';
}

/**
 * `keyLifts` is not a summary — the composer turns each entry into a real
 * exercise on the saved plan. It used to hold category words ("Arms", "Core",
 * "Easy cardio"), which reached the logger as exercises that exist in no
 * catalog: no demo, no instructions, nothing to swap, and a weight field on a
 * day the user had no equipment for. They come from the verified pool now.
 */
function supplementalLifts(kind: SupplementalDayKind, selection: FirstRunSetupSelection) {
  return pickPoolVariant(SUPPLEMENTAL_DAY_POOL[kind], resolveAvailableEquipment(selection));
}

/**
 * The optional days, one per kind. The names are translated at display time
 * (sessionNameLabel), so a new kind needs its name there too.
 */
const SUPPLEMENTAL_DAYS: Record<SupplementalDayKind, { name: string; minutes: number; note: string }> = {
  accessoryStrength: {
    name: 'Accessory Strength Day',
    minutes: 30,
    note: 'Optional accessory work without replacing the strength base.',
  },
  recoveryStrength: {
    name: 'Recovery Strength Day',
    minutes: 25,
    note: 'Keep this easy so the main lifts recover.',
  },
  easyRun: { name: 'Easy Run Add-On', minutes: 30, note: 'Keep the pace conversational.' },
  longRun: {
    name: 'Long Run Add-On',
    minutes: 45,
    note: 'Build distance gradually and keep it easier than tempo day.',
  },
  bodyweightVolume: {
    name: 'Bodyweight Volume Day',
    minutes: 25,
    note: 'Adds muscle-friendly volume without full-gym equipment.',
  },
  conditioningMobility: {
    name: 'Conditioning + Mobility Day',
    minutes: 25,
    note: 'Keeps the week active without heavy fatigue.',
  },
  recoveryMobility: { name: 'Recovery + Mobility Day', minutes: 25, note: 'Optional day to fill the selected weekly rhythm.' },
  easyConditioning: { name: 'Easy Conditioning Day', minutes: 25, note: 'Optional day to fill the selected weekly rhythm.' },
};

/**
 * The kinds in the order a week takes them, one per optional day.
 *
 * Each goal had two, picked by `index === 0`, so every optional day after the
 * first was the second one again: a beginner asking for six days is capped to
 * a three-day programme, and two of its three added days were the same
 * "Recovery Strength Day" (bug hunt, 2026-10-07). Five each, more than the
 * four a two-day programme stretched to six days needs, and none twice.
 */
function supplementalDayKinds(selection: FirstRunSetupSelection, programId: string): SupplementalDayKind[] {
  if (selection.goal === 'strength') {
    return ['accessoryStrength', 'recoveryStrength', 'recoveryMobility', 'easyConditioning', 'conditioningMobility'];
  }
  if (selection.goal === 'run_mobility' || programId === 'tpl_3_day_run_mobility_v1') {
    return ['easyRun', 'longRun', 'recoveryMobility', 'conditioningMobility', 'easyConditioning'];
  }
  // Anyone without the full gym: "Bodyweight only" is equipment 'minimal', a
  // home setup 'home', and the note on the day reads "without full-gym
  // equipment". Testing 'home' alone gave the reader who picked bodyweight a
  // Cat Stretch day and the one with a pull-up bar and bands a push-up day.
  if (selection.equipment !== 'gym' && selection.goal === 'muscle') {
    return ['bodyweightVolume', 'conditioningMobility', 'recoveryMobility', 'easyConditioning', 'accessoryStrength'];
  }
  return ['recoveryMobility', 'easyConditioning', 'conditioningMobility', 'bodyweightVolume', 'accessoryStrength'];
}

function buildSupplementalDay(
  selection: FirstRunSetupSelection,
  programId: string,
  index: number,
): Omit<RecommendationPlanReadyScheduleDay, 'id' | 'weekday' | 'weekdayLabel'> {
  const kinds = supplementalDayKinds(selection, programId);
  const kind = kinds[index % kinds.length];
  const day = SUPPLEMENTAL_DAYS[kind];
  return {
    name: day.name,
    meta: `${day.minutes} min - optional`,
    keyLifts: supplementalLifts(kind, selection),
    source: 'suggested',
    note: day.note,
  };
}

function buildPlanReadyWeeklySchedule(selection: FirstRunSetupSelection, programId: string) {
  const template = getWorkoutTemplateById(programId);
  if (!template) {
    return [];
  }

  const plannedDaysPerWeek = selection.daysPerWeek;
  // The weekday itself travels beside its English label: the label is part of
  // the brief the coach reads, and the screen needs the day in the reader's
  // own language rather than a word it cannot translate back.
  const rhythmDays = resolveProjectedTrainingDays(selection, plannedDaysPerWeek);
  const rhythm = rhythmDays.map((day) => getWeekdayShortLabel(day));
  const orderedSessions = [...template.sessions].sort((left, right) => left.orderIndex - right.orderIndex);
  // Home's number for each day, not the catalog's one figure for every day
  // (bug hunt, 2026-10-04).
  const sessionMinutes = estimateProgrammeSessionMinutesList(orderedSessions, {
    availableEquipment: resolveAvailableEquipment(selection),
    cautionFlags: selection.cautionFlags,
  });
  const templateDays = orderedSessions
    .map((session, index): RecommendationPlanReadyScheduleDay => ({
      id: session.id,
      weekday: rhythmDays[index] ?? null,
      weekdayLabel: rhythm[index] ?? `Day ${index + 1}`,
      name: session.name,
      meta: `${sessionMinutes[index] || template.estimatedSessionDuration} min - ${pluralize(session.exercises.length, 'exercise')}`,
      keyLifts: session.exercises.slice(0, 2).map((exercise) => formatLiftDisplayLabel(exercise.exerciseName)),
      source: 'template',
      note: null,
    }));
  const supplementalCount = Math.max(0, plannedDaysPerWeek - templateDays.length);
  const supplementalDays = Array.from({ length: supplementalCount }, (_, index): RecommendationPlanReadyScheduleDay => {
    const supplemental = buildSupplementalDay(selection, programId, index);
    const dayIndex = templateDays.length + index;

    return {
      id: `${template.id}-suggested-${index + 1}`,
      weekday: rhythmDays[dayIndex] ?? null,
      weekdayLabel: rhythm[dayIndex] ?? `Day ${dayIndex + 1}`,
      ...supplemental,
    };
  });

  return [...templateDays, ...supplementalDays].slice(0, plannedDaysPerWeek);
}

function buildFourWeekProgression(selection: FirstRunSetupSelection, profile: RecommendationProgrammeProfile): RecommendationPlanReadyWeekPhase[] {
  const weightDirection = getWeightDirection(selection);
  const goalLabel = selection.goal === 'muscle' && weightDirection === 'gain' ? 'muscle-building' : getGoalTitle(selection).toLowerCase();

  return [
    {
      week: 1,
      role: 'baseline',
      label: 'Week 1: Find your baseline',
      body: `Learn the sessions and log repeatable starting data for ${goalLabel}.`,
    },
    {
      week: 2,
      role: 'build',
      label: 'Week 2: Build the rhythm',
      body: 'Repeat the same week and add small progress only where week 1 was clean.',
    },
    {
      week: 3,
      role: 'build',
      label: 'Week 3: Push the best work',
      body: profile.volumeProgression,
    },
    {
      week: 4,
      role: 'review',
      label: 'Week 4: Review and recover',
      body: profile.easierWeek.reason,
    },
  ];
}

function buildHowToProgress(selection: FirstRunSetupSelection, profile: RecommendationProgrammeProfile) {
  if (selection.goal === 'muscle') {
    return 'Add reps first, then add load or one quality set when the top of the range is stable.';
  }

  if (selection.goal === 'strength') {
    return 'Add load only after all prescribed reps are clean; keep the anchor lifts stable across the block.';
  }

  if (selection.goal === 'run_mobility') {
    return 'Add run time or blocks gradually while keeping mobility and easy days recoverable.';
  }

  if (selection.trainingEnvironment === 'bodyweight_only' || selection.trainingEnvironment === 'minimal_equipment') {
    return 'Progress through reps, tempo, range, density, and harder variations before chasing more load.';
  }

  return profile.intensityProgression;
}

function buildFocusAllocation(selection: FirstRunSetupSelection) {
  const focusSummary = formatList(selection.focusAreas.slice(0, 2).map((area) => getFocusAreaTitle(area)));
  if (!focusSummary) {
    return 'Balanced full-body focus stays ahead of narrow accessories.';
  }

  return `Focus areas: ${focusSummary}. The plan surfaces them where they fit without replacing the main goal.`;
}

function buildReadinessGuardrail(selection: FirstRunSetupSelection) {
  if (selection.level === 'beginner') {
    return 'Beginner guardrail: start conservative, limit complexity, and progress only after clean logged sessions.';
  }

  if (selection.level === 'pro') {
    return 'Advanced guardrail: use the strongest catalog match, but avoid inventing workload the template does not support.';
  }

  return 'Intermediate guardrail: build normally in weeks 2-3 while keeping recovery and execution stable.';
}

export function buildRecommendationPlanReadyPayload(
  selection: FirstRunSetupSelection,
  programId: string,
  options: { fallbackReason?: string | null } = {},
): RecommendationPlanReadyPayload {
  const template = getWorkoutTemplateById(programId);
  const definition = getRecommendationProgramDefinition(programId);
  const profile = buildRecommendationProgrammeProfile(programId);
  const sessionComposition = buildSelectionSessionComposition(selection, profile);
  const sessionBlocks = getSessionBlocks(sessionComposition);
  const weeklySchedule = buildPlanReadyWeeklySchedule(selection, programId);
  const programDaysPerWeek = template?.daysPerWeek ?? definition?.daysPerWeek ?? selection.daysPerWeek;
  const requestedDaysPerWeek = selection.daysPerWeek;
  const totalEstimatedMinutes = weeklySchedule.reduce((total, day) => total + parseMinutes(day.meta), 0);
  const fallbackReason =
    options.fallbackReason ??
    (programDaysPerWeek !== requestedDaysPerWeek
      ? `Closest ${programDaysPerWeek}-day base with optional add-ons for your ${requestedDaysPerWeek}-day target.`
      : null);
  const focusAllocation = buildFocusAllocation(selection);
  const whyThisPlan = [
    `Goal: ${getCompactGoalTitle(selection.goal)}.`,
    getCompactLevelLine(selection.level),
    `${requestedDaysPerWeek} days / week.`,
    getCompactEquipmentTitle(selection),
  ];
  const firstWorkout = weeklySchedule.find((day) => day.source === 'template') ?? weeklySchedule[0] ?? null;

  return {
    programId,
    title: template?.name ?? 'Starter plan',
    subtitle: `Built around your goals, schedule and recovery.`,
    blockLengthWeeks: profile.blockLengthWeeks,
    durationModel: profile.durationModel,
    requestedDaysPerWeek,
    programDaysPerWeek,
    whyThisPlan,
    planOverview: [
      `${requestedDaysPerWeek} workouts / week`,
      `~${totalEstimatedMinutes || roundToNearestTen(requestedDaysPerWeek * (template?.estimatedSessionDuration ?? 50))} min / week`,
      getStructureLabel(profile.familyId, programDaysPerWeek),
      `${profile.blockLengthWeeks}-week starter block`,
    ],
    weeklySchedule,
    fourWeekProgression: buildFourWeekProgression(selection, profile),
    sessionComposition,
    sessionBlocks,
    prepSummary: sessionComposition.prepBlock.body,
    cooldownSummary: sessionComposition.cooldownBlock.body,
    howToProgress: buildHowToProgress(selection, profile),
    focusAllocation,
    readinessGuardrail: buildReadinessGuardrail(selection),
    firstAction: firstWorkout ? `Start with ${firstWorkout.name} on ${firstWorkout.weekdayLabel}.` : 'Open the first planned workout.',
    fallbackReason,
  };
}
