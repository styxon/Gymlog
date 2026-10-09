/**
 * The history tab of the set screen's exercise sheet.
 *
 * The set screen already showed one previous session — "last time, 60 kg,
 * 8 8 7 7" — which answers "what do I put on the bar" and nothing else. The
 * question it does not answer is the one that keeps somebody training: is this
 * going anywhere. Eight sessions of top sets is the shortest honest answer.
 *
 * Today's session is part of the series rather than a separate claim, and it
 * grows as sets are logged: the bar is the top set SO FAR, and it is marked as
 * a record only once it actually beats every session before it.
 */
import { formatShortDate, removeTrailingZeros } from './format';
import { isRecordLocked, isSetLogLocked } from './historyWindow';
import { t } from './i18n';
import { beatsBest } from './personalRecords';
import { estimateOneRepMaxKg } from './workoutCompletionSummary';
import { getTopSetLabel } from './workoutCompleteView';
import { AppLanguage, UnitPreference } from '../types/models';
import type { WorkoutTrackingMode } from '../features/workout/workoutTypes';
import { isMinutesTrackingMode } from '../features/workout/workoutTypes';

/**
 * Last session's sets, as the set screen's card reads them.
 *
 * Lived in components/SetPanels.tsx until the card replaced the panels; the
 * shape outlived the component because the question did — "what did I lift
 * last time" is the first thing the card answers.
 */
export interface LastTimeSet {
  /** 1-based, as the reader counts them. */
  setIndex: number;
  loadKg: number;
  reps: number;
  /** The heaviest set of that session. */
  isRecord?: boolean;
}

export interface LastTimeView {
  performedAt: string;
  sets: LastTimeSet[];
  /**
   * Logged under a different slot — another day of the programme, another
   * programme, an empty workout. Shown, because the weight on the dial comes
   * from here too, but a different claim from "last time on this slot".
   */
  borrowed?: boolean;
  /** That session's warm-ups ("+ Warm-up set"), what the button offers again. */
  warmups?: { loadKg: number; reps: number }[];
}

/** How many sessions the chart shows, today included. */
export const SHEET_HISTORY_SESSIONS = 8;

export interface SheetHistorySet {
  loadKg: number;
  reps: number;
}

export interface SheetHistorySession {
  performedAt: string;
  sets: SheetHistorySet[];
}

export interface SheetHistoryBar {
  /** The session's top set, by load; reps when the lift carries none. */
  value: number;
  /** 0–1 against the tallest bar in the window, for the column's height. */
  ratio: number;
  isToday: boolean;
}

export interface SheetHistoryRow {
  key: string;
  dateLabel: string;
  /** "62,5 kg", or null on a lift that logs no load. */
  loadLabel: string | null;
  /** One per set, in the order they were logged. */
  pills: string[];
  isToday: boolean;
  /** Today beat every session before it. Only ever true on today's row. */
  isPr: boolean;
}

export interface ExerciseSheetHistory {
  /** "60 kg × 8", "14 reps", "45 s" — the heaviest set ever logged here. */
  bestSetLabel: string | null;
  estimatedOneRepMaxKg: number | null;
  /**
   * The session that set the best set: the first to reach it, which is the one
   * the Records list dates the record by. Null when nothing is logged.
   */
  bestSetPerformedAt: string | null;
  sessionCount: number;
  /** Oldest to newest, left to right, today last. Empty when nothing is logged. */
  bars: SheetHistoryBar[];
  /** Newest first, today at the top. */
  rows: SheetHistoryRow[];
}

/** A session's top set: heaviest load, and the most reps among equal loads. */
function topSetOf(sets: ReadonlyArray<SheetHistorySet>): SheetHistorySet | null {
  let best: SheetHistorySet | null = null;
  sets.forEach((set) => {
    if (!Number.isFinite(set.reps) || set.reps <= 0) {
      return;
    }
    if (
      best === null
      || set.loadKg > best.loadKg
      || (set.loadKg === best.loadKg && set.reps > best.reps)
    ) {
      best = set;
    }
  });
  return best;
}

/**
 * What the bars measure: the load, or the reps on a lift that never carried
 * one. One measure for the whole series — chosen set by set, a dip done for
 * 15 bodyweight reps stood taller than the 10 kg dip after it, the first
 * weighted session read as a drop, and +20 kg was a record only because 20 is
 * more than 15 (hunt, 2026-10-09).
 */
type BarMeasure = 'load' | 'reps';

function barValueOf(set: SheetHistorySet | null, measure: BarMeasure): number {
  if (!set) {
    return 0;
  }
  return measure === 'load' ? set.loadKg : set.reps;
}

export function buildExerciseSheetHistory(
  past: ReadonlyArray<SheetHistorySession>,
  today: SheetHistorySession | null,
  language: AppLanguage,
  trackingMode: WorkoutTrackingMode = 'load_and_reps',
  _unitPreference: UnitPreference = 'kg',
): ExerciseSheetHistory {
  const sorted = [...past].sort(
    (a, b) => new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime(),
  );
  const todayHasSets = (today?.sets.length ?? 0) > 0;
  const series: Array<{ session: SheetHistorySession; isToday: boolean }> = [
    ...sorted.map((session) => ({ session, isToday: false })),
    ...(todayHasSets && today ? [{ session: today, isToday: true }] : []),
  ];

  const measure: BarMeasure = series.some((item) => item.session.sets.some((set) => set.loadKg > 0)) ? 'load' : 'reps';
  const window = series.slice(-SHEET_HISTORY_SESSIONS);
  const values = window.map((item) => barValueOf(topSetOf(item.session.sets), measure));
  const tallest = values.reduce((max, value) => Math.max(max, value), 0);

  /*
   * One bar is not a chart.
   *
   * A lift trained once drew a single column under the heading "top set, last
   * 8 sessions" — which is a block of colour making a claim about a series
   * that does not exist yet (user 2026-09-04). The rows below still list that
   * one session, which is the honest way to show it.
   */
  const bars: SheetHistoryBar[] = window.length < 2 ? [] : window.map((item, index) => ({
    value: values[index],
    // A floor rather than a true zero: a bar with no height is a bar the
    // reader cannot see is there.
    ratio: tallest > 0 ? Math.max(0.08, values[index] / tallest) : 0,
    isToday: item.isToday,
  }));

  const priorBest = sorted.reduce((max, session) => Math.max(max, barValueOf(topSetOf(session.sets), measure)), 0);
  const todayTop = todayHasSets && today ? topSetOf(today.sets) : null;
  // A loaded lift's record is the records rule (`beatsBest`): heavier, or the
  // same load for more reps — the pill used to ask for a heavier bar only,
  // and 100 × 5 after 100 × 3 went unmarked here while the Records tab called
  // it new (2026-09-26). An unloaded lift's bar is its reps, as before.
  // On a loaded lift a session with no load beats nothing, and the first
  // loaded one has no loaded best to beat (priorBest is 0 kg).
  const priorTop = topSetOf(sorted.flatMap((session) => session.sets));
  // Minutes are a dose, not a record: a longer ride than last time is not a
  // personal best to badge (2026-10-06, same rule as the Records tab).
  const todayIsPr =
    !isMinutesTrackingMode(trackingMode) &&
    todayTop !== null &&
    priorBest > 0 &&
    (measure === 'load'
      ? todayTop.loadKg > 0 &&
        priorTop !== null &&
        beatsBest({ weight: todayTop.loadKg, reps: todayTop.reps }, { weight: priorTop.loadKg, reps: priorTop.reps })
      : barValueOf(todayTop, measure) > priorBest);

  const rows: SheetHistoryRow[] = [...series]
    .reverse()
    .map((item, index) => {
      const top = topSetOf(item.session.sets);
      return {
        key: `${item.session.performedAt}-${index}`,
        dateLabel: item.isToday
          ? t(language, 'guided.sheet.today')
          : formatShortDate(item.session.performedAt, language),
        loadLabel: top && top.loadKg > 0 ? `${removeTrailingZeros(top.loadKg)} kg` : null,
        pills: item.session.sets.map((set) =>
          isMinutesTrackingMode(trackingMode) ? t(language, 'logger.minutesValue', { count: set.reps }) : `${set.reps}`,
        ),
        isToday: item.isToday,
        isPr: item.isToday && todayIsPr,
      };
    });

  const allSets = series.flatMap((item) => item.session.sets);
  const best = topSetOf(allSets);
  // Oldest first, so a best that was matched later is dated by the session
  // that first reached it — the records rule (`beatsBest` is strict).
  const bestSession = best
    ? series.find((item) => item.session.sets.some((set) => set.loadKg === best.loadKg && set.reps === best.reps))
    : undefined;

  return {
    bestSetLabel: getTopSetLabel(
      allSets.map((set) => ({ status: 'completed', weightKg: set.loadKg, reps: set.reps })),
      language,
      trackingMode,
    ),
    estimatedOneRepMaxKg: best ? estimateOneRepMaxKg(best.loadKg, best.reps) : null,
    bestSetPerformedAt: bestSession ? bestSession.session.performedAt : null,
    sessionCount: series.length,
    bars,
    rows,
  };
}

/**
 * The sheet's history as the reader's tier may read it.
 *
 * Two of the Pro page's promises reach this tab, and it kept neither: it was
 * built from the lift's whole log with no entitlement in sight, so the set log
 * ("sessions side by side", sold on the Pro page and on the set-log lock) and
 * the records past three months were both free here (hunt, 2026-10-09).
 *
 *  - The sets behind each earlier session are the per-lift set log. Free reads
 *    the curve (the bars, the session count) and today's own sets, which the
 *    set screen shows anyway; the earlier sessions' rows are locked.
 *    `isSetLogLocked` decides, and `lockedSessionCount` says how many rows
 *    the lock covers.
 *  - The best set and the estimate drawn from it are a record's figure, so
 *    they follow `isRecordLocked` on the session that set it: older than the
 *    free window and Free sees the lock, not the number. A best from inside
 *    the window reads as it always did.
 *
 * Pro gets the view back untouched.
 */
export interface GatedExerciseSheetHistory extends ExerciseSheetHistory {
  /** The best set and the 1RM estimate are withheld (both null). */
  bestLocked: boolean;
  /** Earlier sessions' rows withheld by the set-log lock. */
  lockedSessionCount: number;
}

export function gateExerciseSheetHistory(
  history: ExerciseSheetHistory,
  proUnlocked: boolean,
  now: Date = new Date(),
): GatedExerciseSheetHistory {
  const bestLocked =
    history.bestSetPerformedAt !== null && isRecordLocked(history.bestSetPerformedAt, proUnlocked, now);
  const rows = isSetLogLocked(proUnlocked) ? history.rows.filter((row) => row.isToday) : history.rows;
  return {
    ...history,
    bestSetLabel: bestLocked ? null : history.bestSetLabel,
    estimatedOneRepMaxKg: bestLocked ? null : history.estimatedOneRepMaxKg,
    rows,
    bestLocked,
    lockedSessionCount: history.rows.length - rows.length,
  };
}
