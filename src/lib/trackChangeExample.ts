import { AppLanguage, MeasurementEntry } from '../types/models';
import { buildHomeStatCards, HomeStatCard } from './homeStatCards';

/**
 * The example behind the preview in the first-run "Track your measurements?"
 * dialog: a shoulder measurement logged once a week for six weeks, run through
 * the same builder Home uses so the card looks the way it does after real use.
 *
 * Built on demand and never stored: nothing here reaches AppProvider or a
 * repository.
 */
const EXAMPLE_SHOULDERS_CM = [112, 112.5, 113, 113.4, 114, 114.5];
const DAY_STEPS_BACK = [37, 30, 23, 16, 9, 2];

export function buildTrackChangeExampleCard(language: AppLanguage, now: Date = new Date()): HomeStatCard {
  const entries: MeasurementEntry[] = EXAMPLE_SHOULDERS_CM.map((value, index) => {
    // Calendar date arithmetic, not DAY_MS stepping (DST).
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAY_STEPS_BACK[index], 12);
    return { id: `example-${index}`, kind: 'shoulders', recordedAt: at.toISOString(), value, unit: 'cm' };
  });

  return buildHomeStatCards(
    ['shoulders'],
    { bodyweightEntries: [], measurementEntries: entries, trackedProgress: [] },
    language,
  )[0];
}
