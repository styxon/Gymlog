import { getComparableLogSets } from './exerciseLog';
import { formatRelativeDay } from './format';
import { ExerciseLogWithSession, ExerciseProgressSummary } from './progression';
import { AppLanguage } from '../types/models';

/**
 * Profile home data.
 *
 * The record LIST used to live here too. It moved to the Records tab, which
 * has three kinds, month groups and a Pro window — and keeping a second,
 * thinner copy meant two definitions of "a record" and two numbers that could
 * disagree. What is left is the shared top-set reader and the "when" label.
 */

export function getTopComparableSet(log: Pick<ExerciseLogWithSession, 'weight' | 'repsPerSet' | 'sets' | 'skipped'>) {
  const sets = getComparableLogSets(log);
  if (sets.length === 0) {
    return null;
  }

  return sets.reduce((best, set) => {
    if (set.weight > best.weight) {
      return set;
    }
    // Same load, more reps is the better set.
    if (set.weight === best.weight && set.reps > best.reps) {
      return set;
    }
    return best;
  });
}

/**
 * "Today" / "Yesterday" / "3 days ago" / "Jul 12" — calendar-day based, so a
 * session logged at 23:50 last night reads "Yesterday" rather than "0 days ago".
 * Finnish renders the same tiers as "Tänään" / "Eilen" / "3 pv sitten" / "12.7."
 * The app's one relative-day wording (formatRelativeDay), the Home cards' and
 * the exercise page's too.
 */
export function formatRecordWhenLabel(iso: string, now: Date = new Date(), language: AppLanguage = 'en'): string {
  return formatRelativeDay(iso, now, language);
}
