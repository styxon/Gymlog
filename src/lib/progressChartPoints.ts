import { convertWeightFromKg, formatShortDate } from './format';
import type { ExerciseProgressSummary } from './progression';
import type { AppLanguage, UnitPreference } from '../types/models';

/**
 * A summary's logs as chart points, oldest first, each with its date label.
 * The label costs a date format per log, so only a chart that is on screen
 * should ask for these; a sparkline wants `getSummaryChartValues`.
 */
export function getSummaryChartPoints(
  summary: ExerciseProgressSummary,
  unitPreference: UnitPreference,
  language: AppLanguage,
) {
  return [...summary.logs].reverse().map((log) => ({
    label: formatShortDate(log.performedAt, language),
    value: convertWeightFromKg(log.weight, unitPreference),
  }));
}

/** The values of `getSummaryChartPoints`, without the date labels. */
export function getSummaryChartValues(summary: ExerciseProgressSummary, unitPreference: UnitPreference) {
  return [...summary.logs].reverse().map((log) => convertWeightFromKg(log.weight, unitPreference));
}

/** `getSummaryChartValues` per summary key, for the rows that have a summary. */
export function getTrackedSummaryValues(
  summaries: readonly (ExerciseProgressSummary | null)[],
  unitPreference: UnitPreference,
) {
  const values = new Map<string, number[]>();
  for (const summary of summaries) {
    if (summary) {
      values.set(summary.key, getSummaryChartValues(summary, unitPreference));
    }
  }
  return values;
}
