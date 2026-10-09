import { AppLanguage, BodyweightEntry } from '../types/models';
import { formatDayMonthNumeric } from './format';
import { I18nKey } from './i18n';

/**
 * The weight card and the BMI gauge (design reference: Home Workout's Report
 * tab, adopted 2026-08-13).
 *
 * Everything here is arithmetic on the reader's own entries plus their stated
 * height. Nothing is estimated: the competitor's Report tab leads with a
 * calorie counter, and a kcal number the app cannot measure is exactly the kind
 * of invented figure the rest of this codebase refuses to print.
 */

export interface BodyweightCardStats {
  /** Most recent entry by date. Null when nothing is logged. */
  currentKg: number | null;
  heaviestKg: number | null;
  lightestKg: number | null;
  /** Entries ever logged — the card shows its empty state at 0. */
  count: number;
}

/** Local midnight for an ISO timestamp — the day the reader stood on the scale. */
function dayStartOf(recordedAt: string): number {
  const date = new Date(recordedAt);
  if (Number.isNaN(date.getTime())) {
    return Number.NaN;
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * One weigh-in per day — the last one entered wins.
 *
 * A day has one weight. Logging 75 in the morning and 71 in the evening is a
 * correction, not two data points, and treating it as two made the earlier
 * number a permanent record: 75 stayed "heaviest" forever even though the
 * reader had already replaced it. After collapsing, that day is 71 and 71 is
 * both the heaviest and the lightest, which is what the reader meant.
 *
 * Ties on the exact same timestamp keep the later ARRAY position, because that
 * is the one that was written second.
 */
export function collapseToLatestPerDay(entries: readonly BodyweightEntry[]): BodyweightEntry[] {
  const byDay = new Map<number, BodyweightEntry>();
  for (const entry of entries) {
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) {
      continue;
    }
    const day = dayStartOf(entry.recordedAt);
    if (Number.isNaN(day)) {
      continue;
    }
    const held = byDay.get(day);
    if (!held || Date.parse(entry.recordedAt) >= Date.parse(held.recordedAt)) {
      byDay.set(day, entry);
    }
  }
  return [...byDay.entries()].sort(([left], [right]) => left - right).map(([, entry]) => entry);
}

export function buildBodyweightCardStats(
  entries: readonly BodyweightEntry[],
  now: Date = new Date(),
): BodyweightCardStats {
  // Nothing after `now`: a weigh-in with a future date (a mistyped year, a
  // device clock that was ahead) would otherwise be "current" for good.
  // buildWeightWindow and the AI context already stop at now (bug hunt,
  // 2026-10-04).
  const nowMs = now.getTime();
  const usable = collapseToLatestPerDay(entries.filter((entry) => Date.parse(entry.recordedAt) <= nowMs));
  if (usable.length === 0) {
    return { currentKg: null, heaviestKg: null, lightestKg: null, count: 0 };
  }

  // "Current" is the latest by DATE, not the last in the array. Entries arrive
  // from storage in whatever order they were written, and a back-dated weigh-in
  // added after today's would otherwise become "current".
  let latest = usable[0];
  let heaviest = usable[0].weight;
  let lightest = usable[0].weight;
  for (const entry of usable) {
    if (Date.parse(entry.recordedAt) > Date.parse(latest.recordedAt)) {
      latest = entry;
    }
    heaviest = Math.max(heaviest, entry.weight);
    lightest = Math.min(lightest, entry.weight);
  }

  return { currentKg: latest.weight, heaviestKg: heaviest, lightestKg: lightest, count: usable.length };
}

/** WHO bands, in the order the gauge paints them left to right. */
export type BmiBandKey = 'severe' | 'moderate' | 'mild' | 'healthy' | 'over' | 'obese1' | 'obese2';

export interface BmiBand {
  key: BmiBandKey;
  /** Inclusive lower bound; the first band has none. */
  from: number | null;
  /** Exclusive upper bound; the last band has none. */
  to: number | null;
  labelKey: I18nKey;
  color: string;
}

/**
 * The gauge's stops are the WHO cut-offs the reference prints under the bar:
 * 15, 16, 18.5, 25, 30, 35, 40. The bar is drawn in EQUAL segments rather than
 * to scale — 18.5–25 is six and a half points wide and 15–16 is one, and a
 * true-to-scale bar makes the two underweight bands invisible slivers.
 */
export const BMI_BANDS: BmiBand[] = [
  { key: 'severe', from: null, to: 15, labelKey: 'bmi.band.severe', color: '#1E40AF' },
  { key: 'moderate', from: 15, to: 16, labelKey: 'bmi.band.moderate', color: '#3B82F6' },
  { key: 'mild', from: 16, to: 18.5, labelKey: 'bmi.band.mild', color: '#60A5FA' },
  { key: 'healthy', from: 18.5, to: 25, labelKey: 'bmi.band.healthy', color: '#2DD4BF' },
  { key: 'over', from: 25, to: 30, labelKey: 'bmi.band.over', color: '#FBBF24' },
  { key: 'obese1', from: 30, to: 35, labelKey: 'bmi.band.obese1', color: '#F59E0B' },
  { key: 'obese2', from: 35, to: null, labelKey: 'bmi.band.obese2', color: '#EF4444' },
];

/**
 * The INTERNAL boundaries only — the value where one band ends and the next
 * begins, so tick i belongs at x = (i + 1) * segment.
 *
 * The first version listed 40 here too and drew every tick at i * segment. That
 * put 15 under the left edge of the "below 15" band instead of under its right
 * edge, shifting the whole scale one band left: a BMI of 24.7 landed correctly
 * at the top of the healthy band while the number printed under the marker read
 * 30. And 40 came out twice, once shifted and once at the end.
 */
export const BMI_SCALE_TICKS = [15, 16, 18.5, 25, 30, 35];
/** Printed at the far right end of the bar, past the last boundary. */
export const BMI_SCALE_MAX_TICK = 40;

/**
 * Evenly spaced y-axis ticks for the weight curve.
 *
 * The chart's own default is four ticks over a range padded by 18 %, which on
 * body weight reads as a coarse ruler: the reference prints seven, 0.2 kg
 * apart, and that resolution is the point — the thing being watched moves by
 * tenths, and an axis that steps by whole kilos hides it.
 *
 * A flat series (one entry, or a week at the same weight) has no range to
 * divide, so it gets a fixed window around the value instead of collapsing to
 * a single line.
 */
/** Steps a person reads without thinking. No 0.1333 kg gridlines. */
const NICE_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];

export function buildWeightAxisTicks(values: readonly number[], tickCount = 7): number[] {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0 || tickCount < 2) {
    return [];
  }

  const rawMin = Math.min(...usable);
  const rawMax = Math.max(...usable);
  const span = rawMax - rawMin;
  // 0.6 kg around a single weigh-in, a third tighter than the first version's
  // 1.2 — that one spread one entry over an axis wide enough to hide the next
  // week's change inside a single gridline gap.
  // Snap the STEP, not the endpoints. Dividing a padded range into six equal
  // parts and rounding each label to one decimal is what produced 75.9, 75.8,
  // 75.6, 75.5, 75.4, 75.2, 75.1 — evenly spaced lines under labels that read
  // as though they were not.
  //
  // Divided by tickCount - 2 rather than - 1, which buys half a step of clear
  // air above the highest value and below the lowest: a dot welded to the top
  // gridline reads as clipped.
  const rawStep = Math.max(span / (tickCount - 2), 0.6 / (tickCount - 1));
  const centre = (rawMax + rawMin) / 2;
  const half = (tickCount - 1) / 2;

  /**
   * Snap the step AND the origin.
   *
   * Snapping only the step is what this used to do, and it left the grid
   * hanging off the middle of the data: evenly spaced lines reading 68,35 —
   * 68,85 — 69,35, two decimals on a number the reader enters with one, under
   * a headline saying 70,7 kg (#bugs 2026-08-26). A gridline is a number you
   * read, and 70,85 kg is not a weight anybody thinks in.
   *
   * Rounding the centre to a multiple of the step can move it by half a step,
   * which could push the highest weigh-in onto the outermost line — so the
   * step widens until the whole series fits inside the grid it is centred on.
   */
  const step =
    NICE_STEPS.filter((candidate) => candidate >= rawStep).find((candidate) => {
      const snapped = Math.round(centre / candidate) * candidate;
      // Strictly inside, not merely within: a dot welded to the outermost
      // gridline reads as clipped, which is the clear air the step size was
      // buying before the origin was snapped too.
      // Against the gridlines as they are printed (two decimals), with a
      // margin: 187.6 + 0.6000000000000001 is above 188.2 in floating point
      // where on the axis the two are the same line.
      const hi = Number((snapped + candidate * half).toFixed(2));
      const lo = Number((snapped - candidate * half).toFixed(2));
      return rawMax < hi - 1e-9 && rawMin > lo + 1e-9;
    }) ??
    NICE_STEPS[NICE_STEPS.length - 1];

  // Centred on the data, so a flat series sits on the middle gridline — and on
  // the step's own grid, so every label is a round number.
  const top = Math.round(centre / step) * step + step * half;

  return Array.from({ length: tickCount }, (_, index) => Number((top - step * index).toFixed(2)));
}

/**
 * The marker is 13 dp wide — r 5 plus a 3 dp ring. Two of them need about that
 * again between their centres to read as two dots rather than one blob.
 */
const MARKER_PITCH = 16;

/**
 * Whether the plotted points are far enough apart to wear their own markers.
 *
 * The chart drew a ring per weigh-in whatever the range, so a week of data and
 * a year of data got the same mark at wildly different spacing: at 3 months
 * thirteen dots sit comfortably, at a year fifty-three overlap into a caterpillar
 * and the line disappears underneath them (user 2026-08-27, "3m asti hyvä,
 * sen jälkeen liian tiheää").
 *
 * Nothing is dropped when this returns false — the line still passes through
 * every point, and the newest one keeps its marker because it is the reader's
 * current weight. Only the rings go.
 */
export function weightMarkersFit(pointCount: number, plotWidth: number): boolean {
  if (pointCount <= 1) {
    return true;
  }
  if (!Number.isFinite(plotWidth) || plotWidth <= 0) {
    return true;
  }
  return plotWidth / pointCount >= MARKER_PITCH;
}

/** Width of one x-axis label's box in the weight chart ("26.7." needs the room). */
export const WEIGHT_LABEL_WIDTH = 40;
/**
 * How close two labels' centres may come before one is dropped: the ink of
 * "14.9." is about 30 px wide inside its 40 px box, and the box's own padding
 * is not overlap — "3.9." and "14.9." eleven slots apart read fine.
 */
export const WEIGHT_LABEL_CLEARANCE = 30;

/**
 * Which days of a window get an x-axis label.
 *
 * A week labels EVERY day; a three-month window cannot, so the stride is the
 * count that fits — and at least a week long, or a seven-day window starts
 * skipping days ("22 24 25 26 28", user 2026-08-25). Today is always labelled.
 *
 * A stride label that would sit under today's is dropped: when the window is
 * anchored at the first weigh-in, day 0 and today are two slots apart on a
 * three-month axis, and "1.9." was drawn straight over "3.9." (user
 * 2026-09-03, "mahdotonta lukea"). The clearance is the label's own width in
 * slots, so a wider window drops fewer neighbours.
 */
export function weightLabelIndexes(dayCount: number, todayIndex: number, plotWidth: number): number[] {
  if (dayCount <= 0) {
    return [];
  }
  const stride = Math.max(1, Math.ceil(dayCount / 7));
  const slot = Number.isFinite(plotWidth) && plotWidth > 0 ? plotWidth / dayCount : Number.POSITIVE_INFINITY;
  const clearance = Number.isFinite(slot) ? Math.ceil(WEIGHT_LABEL_CLEARANCE / slot) : 0;
  const indexes: number[] = [];
  for (let index = 0; index < dayCount; index += 1) {
    if (index === todayIndex) {
      indexes.push(index);
      continue;
    }
    if (index % stride !== 0) {
      continue;
    }
    if (todayIndex >= 0 && Math.abs(index - todayIndex) < clearance) {
      continue;
    }
    indexes.push(index);
  }
  return indexes;
}

export interface WeightWindowDay {
  /** Local midnight. */
  dayStart: number;
  /** Day of month, the axis label. */
  label: string;
  /** The day's weight, or null when nothing was logged. */
  value: number | null;
  isToday: boolean;
}

/**
 * The chart's x-axis: a fixed run of CALENDAR days ending today.
 *
 * The axis is dates, not entries. Plotting entry-by-entry spaced them evenly
 * however far apart they actually were, so a weigh-in on Monday and the next
 * one three weeks later sat side by side as if they were consecutive. Here a
 * day with no entry is a gap in the line and keeps its slot, which is the only
 * way the slope means anything.
 *
 * It used to be CENTRED on today, so that the first weigh-in a reader ever
 * logs landed in the middle of the card rather than pinned to one end. That
 * cosmetic nicety cost more than it bought: a window centred on today reaches
 * only three days back, so a chip labelled "7 PV" hid a weigh-in from four
 * days ago and drew an empty chart for a reader with months of history
 * (#bugs 2026-09-05). The label is a promise about the past, and every other
 * range on the tab already keeps it by trailing. A brand-new reader's single
 * entry now sits at the right edge, which is where today is on every other
 * chart they will look at.
 */
export function buildWeightWindow(
  entries: readonly BodyweightEntry[],
  nowMs: number,
  days = 7,
): WeightWindowDay[] {
  const now = new Date(nowMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const byDay = new Map(collapseToLatestPerDay(entries).map((entry) => [dayStartOf(entry.recordedAt), entry]));

  return Array.from({ length: days }, (_, index) => {
    // Built by calendar arithmetic, not by adding 86 400 000 ms: a DST change
    // inside the window would otherwise slide every later day by an hour and
    // drop one of them onto the wrong slot.
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1) + index);
    const dayStart = date.getTime();
    return {
      dayStart,
      label: String(date.getDate()),
      value: byDay.get(dayStart)?.weight ?? null,
      isToday: dayStart === today,
    };
  });
}

/**
 * The same calendar-days window, for any dated value — a tape measurement, a
 * body-fat reading, or the weight itself on the trends tab. The other charts
 * spaced entries evenly, and the user's verdict was blunt: every grid should
 * look identical to the weight one (2026-08-25). Identical starts at the
 * axis: calendar days, where a gap keeps its slot.
 *
 * Backward-looking (ends today) rather than centred like the weight card's
 * week: a history over months is read as "how did I get here".
 */
/**
 * The shortest axis any range chip may collapse to.
 *
 * A single entry still needs days either side of it or the chart is one dot
 * against a blank card; a fortnight is the width "All" already used for the
 * same reason.
 */
export const MIN_RANGE_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * How many calendar days a range chip asks for.
 *
 * Lived inline in ProgressScreen and answered only for the measure charts.
 * The body-weight card grew the same chips (Progress v2, piece 06) and has to
 * agree with them exactly, so the rule is one function rather than two copies
 * that drift.
 *
 * Every range is bounded at both ends the way "All" always was: the chip's own
 * length is a CEILING, and the history is what actually sets the width. Asking
 * for three months five days after the first weigh-in used to hand the axis
 * 91 days and let the window slide forward to fill them — an axis running to
 * 19.11. on the 7th of September (user 2026-09-07), where nothing can ever be
 * plotted because the days have not happened. The chip is a request for "up to
 * this much", not a promise that the card will draw empty time to reach it.
 */
/**
 * Calendar days from one instant to another, both ends counted.
 *
 * NOT `(to - from) / DAY_MS`. That divides raw timestamps, so it counts the
 * time of day as well as the dates — a first weigh-in at 07:00 and a `now` of
 * 21:00 thirty-one days later came back as thirty-two — and it miscounts any
 * span crossing a Helsinki clock change, where a 23- or 25-hour day makes the
 * quotient land off a whole number (CLAUDE.md's own rule; caught in review
 * 2026-09-07).
 *
 * Both ends collapse to LOCAL midnight first. What is left between two local
 * midnights is a whole number of days give or take the hour a DST change adds
 * or removes, and rounding lands on the calendar count.
 */
function calendarDaysInclusive(fromMs: number, toMs: number): number {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((toMidnight - fromMidnight) / DAY_MS) + 1;
}

export function capRangeDays(
  ceilingDays: number,
  firstEntryMs: number | null,
  nowMs: number,
): number {
  const first = firstEntryMs ?? nowMs;
  // The floor never exceeds the ceiling, so "7D" stays exactly a week.
  const floor = Math.min(ceilingDays, MIN_RANGE_DAYS);
  const history = calendarDaysInclusive(first, nowMs);
  return Math.min(ceilingDays, Math.max(floor, history));
}

/** The measure tab's four chips, in days. */
const MEASURE_CEILING: Record<'7d' | '3m' | '1y' | 'all', number> = {
  '7d': 7,
  '3m': 91,
  '1y': 365,
  all: 730,
};

export function measureRangeDays(
  range: '7d' | '3m' | '1y' | 'all',
  firstEntryMs: number | null,
  nowMs: number,
): number {
  return capRangeDays(MEASURE_CEILING[range], firstEntryMs, nowMs);
}

/**
 * The earliest entry's time, whatever order the entries arrive in.
 *
 * `entries[0]` was taken as the first weigh-in, but the progress summary
 * sorts newest first, so the weight card anchored its window at the LATEST
 * entry and the Trend grid at the earliest — the same weight, two different
 * axes (user 2026-09-03). Null when there is nothing to anchor on.
 */
export function earliestEntryMs(recordedAts: ReadonlyArray<string>): number | null {
  let earliest: number | null = null;
  for (const recordedAt of recordedAts) {
    const ms = new Date(recordedAt).getTime();
    if (Number.isFinite(ms) && (earliest === null || ms < earliest)) {
      earliest = ms;
    }
  }
  return earliest;
}

/**
 * The change across a window: the last day's value minus the first day's that
 * has one. Null with fewer than two days of readings, where there is no change
 * to speak of.
 */
export function windowValueDelta(days: ReadonlyArray<Pick<WeightWindowDay, 'value'>>): number | null {
  const values = days.map((day) => day.value).filter((value): value is number => value !== null);
  return values.length >= 2 ? values[values.length - 1] - values[0] : null;
}

export function buildValueWindow(
  entries: ReadonlyArray<{ recordedAt: string; value: number }>,
  nowMs: number,
  days: number,
  language: AppLanguage,
): WeightWindowDay[] {
  const now = new Date(nowMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // The window always ends today. It briefly ended later — anchored at the
  // first entry and running forward when the history was shorter than the
  // range — which drew days that have not happened yet.
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Latest reading of each day wins, same rule as the weigh-ins.
  const byDay = new Map<number, number>();
  const byDayAt = new Map<number, number>();
  for (const entry of entries) {
    const day = dayStartOf(entry.recordedAt);
    const at = new Date(entry.recordedAt).getTime();
    if (!byDayAt.has(day) || at >= (byDayAt.get(day) ?? 0)) {
      byDay.set(day, entry.value);
      byDayAt.set(day, at);
    }
  }
  const span = Math.max(2, Math.round(days));
  /**
   * Bare day inside a fortnight, day.month beyond it.
   *
   * Both halves of this are a user verdict from the same day (2026-08-25). A
   * bare day-of-month axis over three months read "26 30 3 7 11" — a number
   * sequence rather than a calendar. But dates over a WEEK read as clutter
   * next to the weight card's "22 23 24 25 26 27 28", which is the axis the
   * user pointed at and asked every other chart to copy. Inside two weeks the
   * month cannot change more than once, so the day alone is unambiguous.
   */
  const withMonth = span > 14;
  return Array.from({ length: span }, (_, index) => {
    // Calendar arithmetic, not +86 400 000 ms — DST would slide the slots.
    const date = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (span - 1) + index);
    const dayStart = date.getTime();
    return {
      dayStart,
      label: withMonth ? formatDayMonthNumeric(date, language) : String(date.getDate()),
      value: byDay.get(dayStart) ?? null,
      isToday: dayStart === today,
    };
  });
}

export function calculateBmi(weightKg: number, heightCm: number): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || weightKg <= 0 || heightCm <= 0) {
    return null;
  }
  const metres = heightCm / 100;
  const bmi = weightKg / (metres * metres);
  return Number.isFinite(bmi) ? Math.round(bmi * 10) / 10 : null;
}

export function bmiBand(bmi: number): BmiBand {
  return (
    BMI_BANDS.find((band) => (band.from === null || bmi >= band.from) && (band.to === null || bmi < band.to)) ??
    BMI_BANDS[BMI_BANDS.length - 1]
  );
}

/**
 * Where the marker sits, 0..1 across the whole bar.
 *
 * Within a band the position is interpolated, so 19 and 24 do not both point at
 * the middle of "healthy". The open-ended end bands are given the width of
 * their neighbour so the marker still has somewhere to travel: a BMI of 12 and
 * a BMI of 14.9 must not stack on the same pixel.
 */
export function bmiMarkerPosition(bmi: number): number {
  const segment = 1 / BMI_BANDS.length;
  const index = BMI_BANDS.findIndex((band) => band.key === bmiBand(bmi).key);
  const band = BMI_BANDS[index];

  const from = band.from ?? (band.to !== null ? band.to - 3 : 0);
  const to = band.to ?? (band.from !== null ? band.from + 5 : 1);
  const within = to === from ? 0.5 : (bmi - from) / (to - from);

  return Math.min(1, Math.max(0, (index + Math.min(1, Math.max(0, within))) * segment));
}
