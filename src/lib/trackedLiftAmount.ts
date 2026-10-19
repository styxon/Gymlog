import { formatWeight } from './format';
import { isHoldLogEntry } from './holdExercises';
import { t } from './i18n';
import { isMinutesLogEntry } from './minutesExercises';
import { AppLanguage, UnitPreference } from '../types/models';

/**
 * A tracked lift's latest amount on Progress: "60 kg × 5", or "7 reps" when
 * the latest session carried no weight.
 *
 * The row printed the weight whatever it was, so a lift logged at 0 kg read
 * "0 kg × 7" while its badge judged it by reps (owner's #9, iOS hunt
 * 2026-10-17). A weight that is not there is not printed as one. A hold's
 * number is seconds and a bout's is minutes, and they say so; a bout carries
 * no weight, as the saved workout already writes it ("20 min").
 */
export function trackedLiftAmount(
  latestWeight: number | null,
  latestReps: string,
  latestLog: Parameters<typeof isMinutesLogEntry>[0],
  unit: UnitPreference,
  language: AppLanguage,
): string {
  const firstReps = latestReps && latestReps !== '-' ? latestReps.split(',')[0] : '';
  const minutes = isMinutesLogEntry(latestLog);
  const dose = minutes ? 'logger.minutesValue' : isHoldLogEntry(latestLog) ? 'logger.secondsValue' : null;
  if (!minutes && latestWeight !== null && latestWeight > 0) {
    const weight = formatWeight(latestWeight, unit);
    if (!firstReps) {
      return weight;
    }
    return `${weight} × ${dose ? t(language, dose, { count: firstReps }) : firstReps}`;
  }
  return firstReps
    ? t(language, dose ?? (Number(firstReps) === 1 ? 'logger.repsValueOne' : 'logger.repsValue'), { count: firstReps })
    : '-';
}
