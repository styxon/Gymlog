/**
 * One training week, two stores.
 *
 * `preferences.setupAvailableDays` is availability — the days the reader said
 * they COULD train. A plan's `entries[].label` is the rhythm — the days the
 * programme actually runs. Adoption writes the rhythm from availability once
 * and the two have drifted apart ever since: the rhythm strip on the programme
 * screen moved Home and the calendar, the weekday picker in Profile moved
 * notifications and the widget, and neither moved the other. Both editors show
 * seven identical weekday chips, so the reader has no way to know which half of
 * the app they just changed.
 *
 * These two functions are the bridge. They are deliberately the only place the
 * mapping lives, and they are pure so the rules are testable without a store.
 *
 * Placement reuses `resolveProgramTrainingDays`, the same even spread the week
 * strip already derives with — two sessions across five open days land apart
 * rather than back to back, and picking days by hand gives the same answer as
 * letting the app derive them.
 */

import { DEFAULT_RHYTHM_BY_DAYS } from './firstRunSetup';
import { SetupWeekday } from '../types/models';
import { WEEKDAY_INDEX, WEEKDAY_KEYS, resolveProgramTrainingDays } from './programTrainingDays';

/** The weekdays a plan's entries name, Monday-first. Empty = they name none. */
export function weekdaysFromPlanLabels(
  entries: ReadonlyArray<{ label?: string | null }>,
): SetupWeekday[] {
  const days: SetupWeekday[] = [];
  for (const entry of entries) {
    const key = (entry.label ?? '').trim().toLowerCase();
    const index = WEEKDAY_INDEX[key];
    if (index === undefined) {
      // One unlabelled entry and the plan is positional ("Day 1"), not weekly.
      // Half an answer would be worse than none.
      return [];
    }
    if (!days.includes(key as SetupWeekday)) {
      days.push(key as SetupWeekday);
    }
  }
  return days.sort((left, right) => WEEKDAY_INDEX[left] - WEEKDAY_INDEX[right]);
}

/**
 * The labels a plan's entries should carry for a chosen set of available days,
 * one per entry in order.
 *
 * `null` means do not write. Fewer chosen days than the plan has sessions is
 * the case that matters: the sessions cannot be placed, and repeating a day to
 * make the count fit would hand the reader a week they never chose. The caller
 * stores the availability and leaves the rhythm alone.
 */
export function planLabelsFromWeekdays(
  entryCount: number,
  days: readonly SetupWeekday[],
): SetupWeekday[] | null {
  if (!Number.isInteger(entryCount) || entryCount <= 0) {
    return null;
  }

  const indexes = days
    .map((day) => WEEKDAY_INDEX[day])
    .filter((index): index is number => index !== undefined);
  const placed = resolveProgramTrainingDays(indexes, entryCount);

  if (placed.length !== entryCount) {
    return null;
  }

  return placed.map((index) => WEEKDAY_KEYS[index]);
}

/**
 * Place the session that comes NEXT on the first training day not yet gone,
 * and let the rest follow it in the programme's own order.
 *
 * Adoption is the case with `nextIndex` 0 — nothing is finished, so session
 * one takes today or the next open day. Editing the week is the same question
 * asked later: a reader who has done two of three sessions and then moves a
 * day still expects session three next, on the next day they train. Writing
 * the labels back in Monday-first order instead put session one on the
 * earliest weekday, and Home then offered session three while stamping MON on
 * it — the same contradiction adoption used to have, restored by an edit.
 *
 * The cyclic order of the days is never disturbed; only which session sits on
 * which of them.
 *
 * Takes the days in any order. That is not politeness: "the first day that has
 * not gone" is only findable against the week's own order, and reading it off
 * whatever order the caller happened to hold is how this returns a confident
 * wrong answer instead of an error. Given days already rotated once —
 * sun, wed, fri — asked on a WEDNESDAY, a raw scan matches Sunday first
 * (6 >= 2) and the function concludes there is nothing to move, on a day that
 * is a training day. Every caller today passes ascending days, and one of them
 * only does so because a screen sorts them on its way here.
 */
export function rotateLabelsForNextSession(
  labels: readonly SetupWeekday[],
  nextIndex: number,
  from: Date,
  /**
   * Today's session is already done. Then today is gone like any earlier day:
   * counting it as open put the NEXT session on today's weekday while the
   * forecast (forecastSlotOn) already moves on to the next training day
   * (bug hunt, 2026-10-04: Mon/Wed/Fri, session 0 trained Monday, rhythm
   * edited Monday).
   */
  trainedToday = false,
): SetupWeekday[] {
  const count = labels.length;
  if (count < 2) {
    return [...labels];
  }
  const week = [...labels].sort((left, right) => WEEKDAY_INDEX[left] - WEEKDAY_INDEX[right]);
  // getDay() is Sunday-first; every weekday index in this app is Monday-first.
  const today = (from.getDay() + 6) % 7;
  const firstOpen = trainedToday ? today + 1 : today;
  const upcoming = week.findIndex((label) => WEEKDAY_INDEX[label] >= firstOpen);
  // No day left this week means the week wraps to its first day, which is
  // what a week does.
  const start = upcoming === -1 ? 0 : upcoming;
  const target = Number.isFinite(nextIndex)
    ? ((Math.round(nextIndex) % count) + count) % count
    : 0;
  return week.map((_, index) => week[(((start + index - target) % count) + count) % count]);
}

/**
 * The weekdays a programme should run on when it is taken into use.
 *
 * Adoption used to read the reader's availability and nothing else, falling
 * back to a hardcoded three-day rhythm when the setup had never asked. The
 * plan then dealt sessions round-robin across those labels, so a six-session
 * programme got Mon/Wed/Fri twice and ran as a three-day programme. Every
 * programme became a three-day programme, whatever its own week said.
 *
 * The session count leads now. Availability places the days when it can hold
 * them; when it cannot — too few days chosen, or none — the programme's own
 * count picks the rhythm, because halving a programme silently is a worse
 * answer than starting it on days the reader can still move.
 */
export function planLabelsForProgramme(
  sessionCount: number,
  availableDays: readonly SetupWeekday[],
  /** When the plan is being adopted. Omitted keeps the raw weekday order. */
  from?: Date,
): SetupWeekday[] {
  const sessions = Math.max(1, Math.min(7, Math.round(sessionCount) || 1));
  const placed = planLabelsFromWeekdays(sessions, availableDays);
  const labels = placed
    ? placed
    : sessions === 1
      ? // One session: the reader's first open day, or Monday.
        [availableDays[0] ?? 'mon']
      : sessions === 7
        ? (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as SetupWeekday[])
        : [...DEFAULT_RHYTHM_BY_DAYS[sessions as 2 | 3 | 4 | 5 | 6]];

  return from ? rotateLabelsForNextSession(labels, 0, from) : labels;
}
