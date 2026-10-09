import { buildTailoringRecommendationNote, TailoringPreferencesInput } from './tailoringFit';
import { resolveProgramTrainingDays } from './programTrainingDays';
import type { FirstRunSetupSelection } from './firstRunSetup';
import { getFocusAreaLabel } from './focusAreaPresentation';
import { I18nKey, t } from './i18n';
import type { ProgramRunWork } from './recommendationWeekFit';
import type {
  AppLanguage,
  SetupEquipment,
  SetupFocusArea,
  SetupSecondaryOutcome,
  SetupWeekday,
} from '../types/models';

export interface RecommendationReasonOptions {
  projectedDaysPerWeek: number;
  estimatedSessionDuration?: number | null;
  mismatchNote?: string | null;
  /** Bug hunt, 2026-10-04: these lines were English whatever the app language. */
  language?: AppLanguage;
  /**
   * What the programme's runs became for the reader's knee or ankle flag, if
   * anything: "Run work with mobility." sat over a week of brisk walks (bug
   * hunt, 2026-10-07, #35). And 'none' when it has no runs: the line sat over
   * Mobility Reset too (bug hunt, 2026-10-08). Null when unknown.
   */
  runWork?: ProgramRunWork | null;
  /**
   * Whether the programme's week holds conditioning (programHoldsConditioning).
   * False leaves "Balanced strength and conditioning" unsaid over a week with
   * none (review, 2026-10-09). Null when unknown.
   */
  conditioning?: boolean | null;
  /**
   * One plain line for what the reader's caution flags changed in the week
   * they were handed (buildCautionAdaptationLine), or null when nothing was.
   * It goes in ahead of the generic goal line, which is the one it displaces
   * when the list is full.
   */
  cautionLine?: string | null;
}

const WEEKDAY_ORDER: SetupWeekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const WEEKDAY_KEYS: Record<SetupWeekday, I18nKey> = {
  mon: 'setup.day.mon',
  tue: 'setup.day.tue',
  wed: 'setup.day.wed',
  thu: 'setup.day.thu',
  fri: 'setup.day.fri',
  sat: 'setup.day.sat',
  sun: 'setup.day.sun',
};

function formatList(items: string[], language: AppLanguage) {
  if (items.length === 0) {
    return '';
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return t(language, 'recExp.list.two', { first: items[0], second: items[1] });
  }

  return t(language, 'recExp.list.many', {
    head: items.slice(0, -1).join(', '),
    last: items[items.length - 1],
  });
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getGoalLabel(
  selection: Pick<FirstRunSetupSelection, 'goal' | 'currentWeightKg' | 'targetWeightKg'>,
  language: AppLanguage,
) {
  const label = (key: I18nKey) => t(language, key);
  switch (selection.goal) {
    case 'strength':
      return label('recExp.goal.strength');
    case 'muscle':
      if (isNumber(selection.currentWeightKg) && isNumber(selection.targetWeightKg) && selection.targetWeightKg > selection.currentWeightKg) {
        return label('recExp.goal.muscleGain');
      }
      return label('recExp.goal.muscleBuilding');
    case 'general':
      if (isNumber(selection.currentWeightKg) && isNumber(selection.targetWeightKg) && selection.targetWeightKg < selection.currentWeightKg) {
        return label('recExp.goal.fatLoss');
      }
      return label('recExp.goal.general');
    case 'lean_athletic':
      return label('recExp.goal.leanAthletic');
    case 'general_fitness':
      return label('recExp.goal.general');
    case 'run_mobility':
      return label('recExp.goal.runMobility');
    default:
      return label('recExp.goal.other');
  }
}

function getBuiltForLine(equipment: SetupEquipment, language: AppLanguage) {
  switch (equipment) {
    case 'minimal':
      return t(language, 'recExp.built.minimal');
    case 'home':
      return t(language, 'recExp.built.home');
    default:
      return t(language, 'recExp.built.other');
  }
}

function getSecondaryOutcomeLabel(outcome: SetupSecondaryOutcome, language: AppLanguage) {
  switch (outcome) {
    case 'mobility':
      return t(language, 'recExp.outcome.mobility');
    case 'conditioning':
      return t(language, 'recExp.outcome.conditioning');
    case 'muscle':
      return t(language, 'recExp.outcome.muscle');
    case 'strength':
      return t(language, 'recExp.outcome.strength');
    default:
      return t(language, 'recExp.outcome.other');
  }
}

function formatWeekdayList(days: SetupWeekday[], language: AppLanguage) {
  return formatList(days.map((day) => t(language, WEEKDAY_KEYS[day])), language);
}

function formatSecondaryOutcomeList(outcomes: SetupSecondaryOutcome[], language: AppLanguage) {
  return formatList(outcomes.map((outcome) => getSecondaryOutcomeLabel(outcome, language)), language);
}

function formatFocusAreaList(focusAreas: SetupFocusArea[], language: AppLanguage) {
  return formatList(focusAreas.map((area) => getFocusAreaLabel(area, language)), language);
}

function roundToNearestTen(value: number) {
  return Math.round(value / 10) * 10;
}

function formatWeightKg(value: number) {
  return `${Math.round(value)} kg`;
}

function buildWeightTargetReason(
  selection: Pick<FirstRunSetupSelection, 'goal' | 'currentWeightKg' | 'targetWeightKg'>,
  language: AppLanguage,
) {
  const currentWeight = selection.currentWeightKg;
  const targetWeight = selection.targetWeightKg;

  if (!isNumber(currentWeight) || !isNumber(targetWeight) || currentWeight === targetWeight) {
    return null;
  }

  const range = t(language, 'recExp.range', {
    from: formatWeightKg(currentWeight),
    to: formatWeightKg(targetWeight),
  });

  if ((selection.goal === 'general' || selection.goal === 'lean_athletic') && targetWeight < currentWeight) {
    return t(language, 'recExp.weight.fatLoss', { range });
  }

  if (selection.goal === 'muscle' && targetWeight > currentWeight) {
    return t(language, 'recExp.weight.gain', { range });
  }

  if (selection.goal === 'strength') {
    return t(language, 'recExp.weight.strength', { range });
  }

  return t(language, 'recExp.weight.other', { range });
}

/**
 * Whether the programme can have heavy barbell compounds in it for this reader.
 * "Heavy compounds first." sat over a bodyweight week (persona hunt, 2026-10-08).
 */
function hasHeavyLiftingGear(
  selection: Pick<FirstRunSetupSelection, 'equipment' | 'trainingEnvironment' | 'equipmentItems'>,
) {
  return (
    selection.equipment === 'gym' ||
    selection.trainingEnvironment === 'full_gym' ||
    (selection.equipmentItems ?? []).some((item) => item === 'Barbells' || item === 'Barbell & plates')
  );
}

function buildGoalSpecificReason(
  selection: Pick<
    FirstRunSetupSelection,
    'goal' | 'secondaryOutcomes' | 'equipment' | 'trainingEnvironment' | 'equipmentItems'
  >,
  language: AppLanguage,
  runWork: ProgramRunWork | null = null,
  conditioning: boolean | null = null,
) {
  const heavy = hasHeavyLiftingGear(selection);

  if (selection.goal === 'strength' && selection.secondaryOutcomes.includes('muscle')) {
    return heavy ? t(language, 'recExp.why.strengthMuscle') : null;
  }

  if (selection.goal === 'muscle' && selection.secondaryOutcomes.includes('strength')) {
    return t(language, 'recExp.why.muscleStrength');
  }

  if (selection.goal === 'strength') {
    return heavy ? t(language, 'recExp.why.strength') : null;
  }

  if (selection.goal === 'muscle') {
    return t(language, 'recExp.why.muscle');
  }

  if (selection.goal === 'general') {
    return t(language, 'recExp.why.general');
  }

  if (selection.goal === 'lean_athletic') {
    // Not over a week with no conditioning in it; the next line takes the place.
    return conditioning === false ? null : t(language, 'recExp.why.leanAthletic');
  }

  if (selection.goal === 'general_fitness') {
    return t(language, 'recExp.why.generalFitness');
  }

  if (selection.goal === 'run_mobility') {
    // No line over a week with no runs: the card already says so, and the
    // next reason takes the place.
    if (runWork === 'none') {
      return null;
    }
    return t(
      language,
      runWork === 'ride' ? 'recExp.why.rideMobility' : runWork === 'walk' ? 'recExp.why.walkMobility' : 'recExp.why.runMobility',
    );
  }

  return null;
}

function shouldPreferGoalSpecificReason(selection: Pick<FirstRunSetupSelection, 'goal' | 'secondaryOutcomes'>) {
  return (
    (selection.goal === 'strength' && selection.secondaryOutcomes.includes('muscle')) ||
    (selection.goal === 'muscle' && selection.secondaryOutcomes.includes('strength'))
  );
}

function getRecommendedWeeklyMinutes(daysPerWeek: number, estimatedSessionDuration?: number | null) {
  const fallbackSessionDuration = daysPerWeek >= 4 ? 55 : daysPerWeek === 2 ? 45 : 50;
  return roundToNearestTen(Math.max(60, daysPerWeek * (estimatedSessionDuration ?? fallbackSessionDuration)));
}

function getEffectiveWeeklyMinutes(
  selection: Pick<FirstRunSetupSelection, 'weeklyMinutes'>,
  daysPerWeek: number,
  estimatedSessionDuration?: number | null,
) {
  return typeof selection.weeklyMinutes === 'number' && selection.weeklyMinutes > 0
    ? selection.weeklyMinutes
    : getRecommendedWeeklyMinutes(daysPerWeek, estimatedSessionDuration);
}

function normalizeWeekdays(days: SetupWeekday[]) {
  return [...new Set(days)].sort((left, right) => WEEKDAY_ORDER.indexOf(left) - WEEKDAY_ORDER.indexOf(right));
}

/**
 * The days the programme will really use, drawn only from the days the reader
 * gave. Bug hunt, 2026-10-04: a private default rhythm used to fill in when the
 * reader had given fewer days than the programme needs, so Tue + Wed with a
 * 3-day programme read "Mon, Wed, Fri" - weekdays the reader never offered. When
 * the answer cannot be drawn from their days, say nothing about days (null).
 */
function resolveProjectedTrainingDays(
  availableDays: SetupWeekday[],
  daysPerWeek: number,
): SetupWeekday[] | null {
  const normalizedDays = normalizeWeekdays(availableDays);
  if (daysPerWeek < 1 || normalizedDays.length < daysPerWeek) {
    return null;
  }

  if (normalizedDays.length === daysPerWeek) {
    return normalizedDays;
  }

  // The one placement the strip, the saved plan and Home all use — a private
  // scorer here could name different days than the week it explains.
  return resolveProgramTrainingDays(
    normalizedDays.map((day) => WEEKDAY_ORDER.indexOf(day)),
    daysPerWeek,
  ).map((index) => WEEKDAY_ORDER[index]);
}

export function buildRecommendationReasonLines(
  selection: FirstRunSetupSelection,
  options: RecommendationReasonOptions,
  tailoringPreferences?: TailoringPreferencesInput | null,
) {
  const language = options.language ?? 'en';
  const reasons: string[] = [];
  const projectedDays = options.projectedDaysPerWeek;
  const weeklyMinutes = getEffectiveWeeklyMinutes(selection, projectedDays, options.estimatedSessionDuration ?? null);
  const projectedWeekdays =
    selection.scheduleMode === 'self_managed' && selection.availableDays.length > 0
      ? resolveProjectedTrainingDays(selection.availableDays, projectedDays)
      : null;
  const scheduleDays = projectedWeekdays ? formatWeekdayList(projectedWeekdays, language) : null;
  const outcomeSummary = formatSecondaryOutcomeList(
    selection.secondaryOutcomes.filter((outcome) => outcome !== 'consistency'),
    language,
  );
  const focusSummary = formatFocusAreaList(selection.focusAreas, language);
  const weightTargetReason = buildWeightTargetReason(selection, language);
  const goalSpecificReason = buildGoalSpecificReason(selection, language, options.runWork ?? null, options.conditioning ?? null);

  // "6 days for run + mobility" opened the lines over a bodyweight push-pull-legs
  // week with no runs at all (a pro reader at six days has no run programme to
  // be given). The opening line says what the week is instead of the goal it
  // is not serving.
  const noRuns = selection.goal === 'run_mobility' && options.runWork === 'none';
  const daysKey = noRuns
    ? projectedDays === 1 ? 'recExp.daysOneNoRun' : 'recExp.daysNoRun'
    : projectedDays === 1 ? 'recExp.daysOne' : 'recExp.days';
  reasons.push(t(language, daysKey, { days: projectedDays, goal: getGoalLabel(selection, language) }));

  if (selection.equipment !== 'gym') {
    reasons.push(getBuiltForLine(selection.equipment, language));
  } else if (scheduleDays) {
    reasons.push(t(language, 'recExp.minutesAcross', { minutes: weeklyMinutes, days: scheduleDays }));
  } else {
    reasons.push(t(language, 'recExp.minutesWeek', { minutes: weeklyMinutes }));
  }

  // What the flags changed comes before the line about the goal. The cap of
  // four below then drops the goal's slogan, never the one thing on this list
  // that is about this reader's own week.
  const cautionLine = options.cautionLine?.trim() || null;
  if (cautionLine) {
    reasons.push(cautionLine);
  }

  let goalLine: string;
  let goalLineIsAnswer = true;
  if (focusSummary) {
    goalLine = t(language, 'recExp.focus', { areas: focusSummary });
  } else if (weightTargetReason) {
    goalLine = weightTargetReason;
  } else if (goalSpecificReason && shouldPreferGoalSpecificReason(selection)) {
    goalLine = goalSpecificReason;
    goalLineIsAnswer = false;
  } else if (outcomeSummary) {
    goalLine = t(language, 'recExp.alsoKeeps', { outcomes: outcomeSummary });
  } else if (goalSpecificReason) {
    goalLine = goalSpecificReason;
    goalLineIsAnswer = false;
  } else if (selection.guidanceMode === 'self_directed') {
    goalLine = t(language, 'recExp.why.selfDirected');
    goalLineIsAnswer = false;
  } else if (selection.guidanceMode === 'done_for_me') {
    goalLine = t(language, 'recExp.why.doneForMe');
    goalLineIsAnswer = false;
  } else {
    goalLine = t(language, 'recExp.why.default');
    goalLineIsAnswer = false;
  }
  // Only the slogans give way to the caution line: a focus area or a weight
  // target is something the reader said.
  const goalLineYields = cautionLine !== null && !goalLineIsAnswer;
  reasons.push(goalLine);

  if (options.mismatchNote) {
    reasons.push(options.mismatchNote);
  }

  // The "Built for ..." line above already names the gear of a home or minimal
  // reader; the equipment half of this note would say it a second time.
  const tailoringNote = buildTailoringRecommendationNote(tailoringPreferences, language, {
    includeEquipment: selection.equipment === 'gym',
  });
  if (tailoringNote) {
    reasons.push(tailoringNote);
  }

  if (goalLineYields && reasons.length > 4) {
    reasons.splice(reasons.indexOf(goalLine), 1);
  }

  return reasons.slice(0, 4);
}
