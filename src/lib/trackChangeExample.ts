import { AppLanguage, MeasurementEntry, MeasurementKind, MeasurementUnit } from '../types/models';
import { buildHomeStatCards, HomeStatCard } from './homeStatCards';

/**
 * The example behind the preview in the first-run "Track your measurements?"
 * dialog: one measurement logged once a week for six weeks, run through the
 * same builder Home uses so the card looks the way it does after real use.
 *
 * One series per site (user 2026-10-17): tapping Waist turns the example into
 * a waist card, so the reader sees the card they are choosing rather than a
 * shoulder card whatever they pick. Waist and body fat go down, the way the
 * people who track them hope they will; the rest go up.
 *
 * Built on demand and never stored: nothing here reaches AppProvider or a
 * repository.
 */
const EXAMPLE_SERIES: Record<MeasurementKind, { values: number[]; unit: MeasurementUnit }> = {
  shoulders: { values: [112, 112.5, 113, 113.4, 114, 114.5], unit: 'cm' },
  chest: { values: [98, 98.4, 98.9, 99.2, 99.8, 100.3], unit: 'cm' },
  back: { values: [104, 104.5, 104.9, 105.5, 105.8, 106.4], unit: 'cm' },
  arms: { values: [34.5, 34.7, 35, 35.1, 35.4, 35.6], unit: 'cm' },
  waist: { values: [86, 85.6, 85.1, 84.9, 84.3, 83.8], unit: 'cm' },
  hips: { values: [96, 96.3, 96.8, 97, 97.5, 97.9], unit: 'cm' },
  thighs: { values: [56, 56.3, 56.7, 56.9, 57.4, 57.7], unit: 'cm' },
  calves: { values: [37, 37.1, 37.3, 37.4, 37.6, 37.8], unit: 'cm' },
  bodyfat: { values: [21, 20.7, 20.3, 20, 19.6, 19.2], unit: '%' },
};
const DAY_STEPS_BACK = [37, 30, 23, 16, 9, 2];

export function buildTrackChangeExampleCard(
  language: AppLanguage,
  now: Date = new Date(),
  kind: MeasurementKind = 'shoulders',
): HomeStatCard {
  const series = EXAMPLE_SERIES[kind] ?? EXAMPLE_SERIES.shoulders;
  const entries: MeasurementEntry[] = series.values.map((value, index) => {
    // Calendar date arithmetic, not DAY_MS stepping (DST).
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAY_STEPS_BACK[index], 12);
    return { id: `example-${index}`, kind, recordedAt: at.toISOString(), value, unit: series.unit };
  });

  return buildHomeStatCards(
    [kind],
    { bodyweightEntries: [], measurementEntries: entries, trackedProgress: [] },
    language,
  )[0];
}

/**
 * Which site the example shows: the first one the reader picked, in the
 * order they picked them, so a second tap does not swap the card out from
 * under the first. With nothing picked, the first tile's site.
 */
export function resolveTrackChangeExampleKind(
  selected: MeasurementKind[],
  offered: MeasurementKind[],
): MeasurementKind {
  return selected[0] ?? offered[0] ?? 'shoulders';
}
