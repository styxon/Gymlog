import { formatDurationMinutes } from './format';
import { AppLanguage } from '../types/models';

/**
 * A family of programmes, read as a ladder rather than a list.
 *
 * Twenty-one rows that differ by one day and one lift each are not a list you
 * scan — they are steps, and the reader's question is "which step am I on".
 * Everything here serves that: an order they can change, a line saying what
 * each row costs per week, and a group that fits the week they said they have.
 */

export type ProgramLadderSort = 'recommended' | 'days' | 'length';

export interface ProgramLadderRow {
  id: string;
  days: number;
  minutes: number;
  weeks: number;
  level: string;
}

/**
 * What a week of this programme costs: "4 × 55 min ≈ 3 h 40 min / wk".
 *
 * The sheet used to print days, minutes and weeks as three separate facts,
 * two of which every row in a family shares. What differs between steps is the
 * total — and nobody multiplies in their head while browsing.
 *
 * The total goes through `formatDurationMinutes`, the same helper History,
 * Progress, the celebration screen and the widget use, so a duration reads the
 * same everywhere in the app. And it is "≈", not "=": the per-session number
 * is an estimate, and the old row said as much with a tilde. Multiplying an
 * estimate does not turn it into a measurement.
 */
export function formatWeeklyLoad(days: number, minutes: number, language: AppLanguage = 'en'): string {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.round(days) : 0;
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
  const perWeek = language === 'fi' ? '/ vk' : '/ wk';
  return `${safeDays} × ${safeMinutes} min ≈ ${formatDurationMinutes(safeDays * safeMinutes)} ${perWeek}`;
}

interface ProgramLadderGroups<T> {
  /** Rows whose week is the reader's week, theirs-level first. */
  fits: T[];
  /** Everything else, in catalog order. */
  rest: T[];
}

/**
 * The rows that fit the week the reader said they have — all of them.
 *
 * This started as `pickRecommendedProgram`, one row with a border and the word
 * "recommended". Measuring the catalog killed that: in 17 of the sheet's
 * category × day-count combinations two or more rows match the reader's week
 * equally, up to twelve of them in Beginner at three days. Adding the reader's
 * level does not rescue it — that leaves 47 of 87 reader situations with no
 * recommendation at all, and still twelve with three or more tied. There is no
 * best row in that data, so a highlight naming one is a claim the code cannot
 * make.
 *
 * What the data does support is "these fit your week", which is true of every
 * row it marks. The reader's level orders them rather than filtering them: a
 * beginner sees the beginner four-day plan above the advanced one, and still
 * sees the advanced one.
 */
export function partitionByReaderWeek<T extends ProgramLadderRow>(
  rows: readonly T[],
  daysPerWeek: number | null | undefined,
  readerLevel?: string | null,
): ProgramLadderGroups<T> {
  if (!daysPerWeek || !Number.isFinite(daysPerWeek)) {
    return { fits: [], rest: [...rows] };
  }

  const fits: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    (row.days === daysPerWeek ? fits : rest).push(row);
  }

  if (readerLevel) {
    // Stable: catalog order holds inside each half, so the group is the ladder
    // with the reader's own rung first.
    const mine = fits.filter((row) => row.level === readerLevel);
    if (mine.length > 0 && mine.length < fits.length) {
      return { fits: [...mine, ...fits.filter((row) => row.level !== readerLevel)], rest };
    }
  }
  return { fits, rest };
}

/**
 * The sorts that can actually reorder what is on screen.
 *
 * Block length is 8 or 12 weeks and nothing else, so in half the sheet's
 * views — measured: 14 of 28 category × level combinations, including all
 * eleven rows of Focus — every row is the same length and a "Length" chip is
 * a control that visibly does nothing when tapped. Days goes flat in five.
 *
 * 'recommended' is always offered: it is the default and the way back from
 * either of the others, so it stays even when it moves nothing.
 */
export function availableLadderSorts<T extends ProgramLadderRow>(
  rows: readonly T[],
): ProgramLadderSort[] {
  const distinct = (pick: (row: T) => number) =>
    new Set(rows.map(pick).filter((value) => Number.isFinite(value) && value > 0)).size > 1;

  const sorts: ProgramLadderSort[] = ['recommended'];
  if (distinct((row) => row.days)) {
    sorts.push('days');
  }
  if (distinct((row) => row.weeks)) {
    sorts.push('length');
  }
  return sorts;
}

/**
 * The ladder, in the order the reader asked for.
 *
 * 'recommended' is the catalog's own order — that order IS the family's
 * ladder, and the fitting rows are lifted out of it by the caller as a group
 * rather than re-sorted. Never mutates the input.
 */
export function sortProgramLadder<T extends ProgramLadderRow>(
  rows: readonly T[],
  sort: ProgramLadderSort,
): T[] {
  if (sort === 'days') {
    return [...rows].sort((left, right) => left.days - right.days || left.id.localeCompare(right.id));
  }
  if (sort === 'length') {
    return [...rows].sort((left, right) => left.weeks - right.weeks || left.id.localeCompare(right.id));
  }
  return [...rows];
}

/**
 * Whether a row's level badge says anything the filter has not.
 *
 * With "Advanced" selected, an ADVANCED badge on all eleven rows is eleven
 * repetitions of the reader's own choice. The badge is for the rows that
 * differ from what was asked for — which, with no filter on, is all of them.
 */
export function shouldShowLevelBadge(
  rowLevel: string,
  activeFilter: string | null | undefined,
): boolean {
  if (!activeFilter) {
    return true;
  }
  return rowLevel !== activeFilter;
}
