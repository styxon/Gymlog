import { buildTailoringRecommendationNote, TailoringPreferencesInput } from './tailoringFit';
import type { FirstRunSetupSelection } from './firstRunSetup';
import { getFocusAreaLabel } from './focusAreaPresentation';
import { I18nKey, t } from './i18n';
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

function buildGoalSpecificReason(
  selection: Pick<FirstRunSetupSelection, 'goal' | 'secondaryOutcomes'>,
  language: AppLanguage,
) {
  if (selection.goal === 'strength' && selection.secondaryOutcomes.includes('muscle')) {
    return t(language, 'recExp.why.strengthMuscle');
  }

  if (selection.goal === 'muscle' && selection.secondaryOutcomes.includes('strength')) {
    return t(language, 'recExp.why.muscleStrength');
  }

  if (selection.goal === 'strength') {
    return t(language, 'recExp.why.strength');
  }

  if (selection.goal === 'muscle') {
    return t(language, 'recExp.why.muscle');
  }

  if (selection.goal === 'general') {
    return t(language, 'recExp.why.general');
  }

  if (selection.goal === 'lean_athletic') {
    return t(language, 'recExp.why.leanAthletic');
  }

  if (selection.goal === 'general_fitness') {
    return t(language, 'recExp.why.generalFitness');
  }

  if (selection.goal === 'run_mobility') {
    return t(language, 'recExp.why.runMobility');
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

function buildCombinationList(days: SetupWeekday[], targetSize: number): SetupWeekday[][] {
  if (targetSize <= 0) {
    return [[]];
  }

  if (days.length < targetSize) {
    return [];
  }

  if (targetSize === 1) {
    return days.map((day) => [day]);
  }

  const combinations: SetupWeekday[][] = [];
  days.forEach((day, index) => {
    const tail = buildCombinationList(days.slice(index + 1), targetSize - 1);
    tail.forEach((combination) => {
      combinations.push([day, ...combination]);
    });
  });

  return combinations;
}

function scoreWeekdayCombination(days: SetupWeekday[]) {
  const indexes = normalizeWeekdays(days).map((day) => WEEKDAY_ORDER.indexOf(day));
  const gaps = indexes.map((current, index) => {
    const next = indexes[(index + 1) % indexes.length];
    return index === indexes.length - 1 ? next + 7 - current : next - current;
  });
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  const gapSpread = maxGap - minGap;
  const weekdayBias = indexes.reduce((sum, value) => sum + value, 0);

  return minGap * 100 - gapSpread * 10 - weekdayBias;
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

  const combinations = buildCombinationList(normalizedDays, daysPerWeek);
  if (combinations.length === 0) {
    return null;
  }

  return combinations.reduce((best, current) =>
    scoreWeekdayCombination(current) > scoreWeekdayCombination(best) ? current : best,
  );
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
  const goalSpecificReason = buildGoalSpecificReason(selection, language);

  reasons.push(
    t(language, projectedDays === 1 ? 'recExp.daysOne' : 'recExp.days', {
      days: projectedDays,
      goal: getGoalLabel(selection, language),
    }),
  );

  if (selection.equipment !== 'gym') {
    reasons.push(getBuiltForLine(selection.equipment, language));
  } else if (scheduleDays) {
    reasons.push(t(language, 'recExp.minutesAcross', { minutes: weeklyMinutes, days: scheduleDays }));
  } else {
    reasons.push(t(language, 'recExp.minutesWeek', { minutes: weeklyMinutes }));
  }

  if (focusSummary) {
    reasons.push(t(language, 'recExp.focus', { areas: focusSummary }));
  } else if (weightTargetReason) {
    reasons.push(weightTargetReason);
  } else if (goalSpecificReason && shouldPreferGoalSpecificReason(selection)) {
    reasons.push(goalSpecificReason);
  } else if (outcomeSummary) {
    reasons.push(t(language, 'recExp.alsoKeeps', { outcomes: outcomeSummary }));
  } else if (goalSpecificReason) {
    reasons.push(goalSpecificReason);
  } else if (selection.guidanceMode === 'self_directed') {
    reasons.push(t(language, 'recExp.why.selfDirected'));
  } else if (selection.guidanceMode === 'done_for_me') {
    reasons.push(t(language, 'recExp.why.doneForMe'));
  } else {
    reasons.push(t(language, 'recExp.why.default'));
  }

  if (options.mismatchNote) {
    reasons.push(options.mismatchNote.replace('This is the closest match right now.', 'Closest match.'));
  }

  const tailoringNote = buildTailoringRecommendationNote(tailoringPreferences);
  if (tailoringNote) {
    reasons.push(tailoringNote);
  }

  return reasons.slice(0, 4);
}
