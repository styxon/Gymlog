import { removeTrailingZeros } from './format';
import { UnitPreference } from '../types/models';

/**
 * The y-axis of every chart on the Progress tab.
 *
 * These lived inside ProgressScreen, which imports React Native and so cannot
 * be loaded by a test — which is how the duration ladder shipped capping at
 * 90 minutes and nothing noticed. Pure arithmetic belongs where it can be
 * executed.
 */

/**
 * Duration ticks that reach the tallest point.
 *
 * The old staircase stopped at 90 minutes — every max above an hour got the
 * same ceiling — so a session left running overnight drew its line straight
 * through the top of the chart and off the card. Photographed on the device:
 * a headline reading "33 h 52 min" over an axis whose highest label was
 * "1h 30m" (user, 2026-09-02).
 *
 * A ladder rather than a formula, so the common shapes keep the axis they had:
 * a 45-minute session still reads 0 / 15 / 30 / 45. Beyond that it doubles,
 * which is coarse on purpose — an axis is for reading the shape, and a day
 * that long is a session somebody forgot to finish.
 */
const DURATION_TICK_TOPS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440, 2880];

export function getOverviewDurationTicks(maxValue: number) {
  const top =
    DURATION_TICK_TOPS.find((candidate) => maxValue <= candidate)
    // Past the ladder, round up to whole days so the top is still a number a
    // reader can name.
    ?? Math.ceil(Math.max(maxValue, 1) / 1440) * 1440;
  // Quarters above an hour, except where a quarter is not a whole number of
  // minutes: 90 split in four printed "22.5m" and "1h 7.5m" on an ordinary
  // workout's axis (backfill review of #40, 2026-09-16), so it takes thirds.
  const intervals = top <= 60 ? Math.max(1, top / 15) : top % 4 === 0 ? 4 : 3;
  const step = top / intervals;
  return Array.from({ length: intervals + 1 }, (_, index) => index * step);
}

/**
 * Volume ticks on round numbers.
 *
 * Without these the chart interpolated its own axis and printed things like
 * "1730.8 kg" and "496.7 kg" — a decimal on a number nobody lifts to a tenth
 * of a kilo, under a headline that already reads "2,2 t". The axis steps in
 * halves and thousands instead, and the labels use the same compact unit as
 * the headline so the two agree.
 */
export function getOverviewVolumeTicks(maxValue: number) {
  if (maxValue <= 0) {
    return [0, 250, 500];
  }

  // Step from a 1 / 2.5 / 5 ladder so every tick lands on a readable number.
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxValue / 3)));
  const step = [1, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => maxValue / candidate <= 4)
    ?? 10 * magnitude;
  const top = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= top + step / 2; tick += step) {
    ticks.push(Number(tick.toFixed(2)));
  }
  return ticks;
}

export function formatOverviewVolumeTick(value: number, ticks: number[]) {
  const top = ticks.length ? ticks[ticks.length - 1] : 0;
  if (top >= 1000) {
    const tonnes = value / 1000;
    // A tenth of a tonne is a hundred kilos. A top of 1000 kg takes a 250 kg
    // step, and 250 / 750 on a one-decimal axis read "0,3 t" / "0,8 t" under
    // gridlines that were at a quarter and three quarters.
    const wholeHundreds = ticks.every((tick) => tick % 100 === 0);
    return `${removeTrailingZeros(Number(tonnes.toFixed(tonnes >= 10 ? 0 : wholeHundreds ? 1 : 2)))} t`;
  }
  return `${removeTrailingZeros(Math.round(value))} kg`;
}

export function getOverviewBodyweightTicks(values: number[], unitPreference: UnitPreference) {
  if (!values.length) {
    return unitPreference === 'lb' ? [100, 102, 104, 106] : [50, 50.5, 51, 51.5];
  }

  const spread = Math.max(...values) - Math.min(...values);
  const step =
    unitPreference === 'lb'
      ? spread <= 4
        ? 1
        : spread <= 10
          ? 2
          : spread <= 25
            ? 5
            : 10
      : spread <= 2
        ? 0.5
        : spread <= 5
          ? 1
          : spread <= 10
            ? 2
            : spread <= 25
              ? 5
              : 10;

  let minTick = Math.floor(Math.min(...values) / step) * step;
  let maxTick = Math.ceil(Math.max(...values) / step) * step;

  while (Math.round((maxTick - minTick) / step) + 1 < 4) {
    minTick -= step;
    maxTick += step;
  }

  const ticks: number[] = [];
  for (let tick = minTick; tick <= maxTick + step / 2; tick += step) {
    ticks.push(Number(tick.toFixed(2)));
  }

  return ticks;
}
