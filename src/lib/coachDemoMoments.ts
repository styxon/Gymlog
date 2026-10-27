import { calendarDaysBetween } from './completedSessions';
import { FatigueSignal } from './fatigueModel';
import { I18nKey } from './i18n';
import { nameVars } from './coachChat';
import { exerciseNameLabel } from './exerciseNameLabel';
import { isLiftPlateaued, recentLifts } from './proInsights';
import { LiftHistory, sessionBestPoints } from './trainingHistory';
import type { AppLanguage, SetupCautionFlag } from '../types/models';

/**
 * The three coach answers a free reader gets, at moments the app chooses.
 *
 * Free stopped granting self-serve questions (see aiCoachQuota for the
 * arithmetic). What replaces them is not "nothing": it is three real answers,
 * from the real model, on this reader's own log — offered at day 7, day 30 and
 * day 90, each one shown as a question with a send button so the reader is the
 * one who asks.
 *
 * Two decisions are doing the work here, and both were wrong in the first
 * sketch of this feature:
 *
 * 1. The moment fires on the first COMPLETED SESSION after the day, not on the
 *    day. A timer can land on an empty week, and a coach with no recent log to
 *    read gives its most generic answer — which is the worst possible first
 *    impression of the thing being sold. Landing after a workout guarantees
 *    fresh data and catches the reader while they are already looking back.
 *
 * 2. The question is CHOSEN FROM THE DATA, not hardcoded. "Why has your squat
 *    stalled" is embarrassing when nothing has stalled, and each of these
 *    happens once per install ever. Every moment has an ordered list of
 *    candidates with checkable preconditions, and falls through to one that is
 *    always answerable.
 *
 * The questions themselves stay short and carry almost no interpolated data.
 * They do not need it: the endpoint already receives the full training context
 * (lib/aiTrainingContext) with the programme, the goal, the equipment and the
 * history. The question only has to be the RIGHT question.
 *
 * Pure, so every precondition can be tested against a fixture without a clock.
 */

type CoachDemoMomentKey = 'week1' | 'month1' | 'month3';

interface MomentSpec {
  key: CoachDemoMomentKey;
  /** Days since first launch before this moment may fire. */
  afterDays: number;
  /** Sessions the log must hold, so the answer has something to read. */
  minSessions: number;
}

/**
 * Day 7, day 21, day 90. The second moment was day 30 until 2026-10-13: the
 * three answers exist to sell Pro, and a reader who stops before a month saw
 * only one of them (owner). Day 21 at six sessions is two a week for three
 * weeks, enough log for a stall to show. The key stays 'month1': it is stored
 * as spent on installs, and renaming it would offer the moment again.
 *
 * The spacing is not arbitrary: each one lands with
 * more history than the last, so the answers get better as the reader gets
 * more invested — and the third one arrives around when a training block ends,
 * which is the moment "what next" is a real question rather than a prompt.
 */
export const COACH_DEMO_MOMENTS: MomentSpec[] = [
  { key: 'week1', afterDays: 7, minSessions: 2 },
  { key: 'month1', afterDays: 21, minSessions: 6 },
  { key: 'month3', afterDays: 90, minSessions: 20 },
];

export interface CoachDemoMoment {
  key: CoachDemoMomentKey;
  /** The question, ready to send. */
  questionKey: I18nKey;
  vars?: Record<string, string | number>;
}

interface CoachDemoMomentInput {
  /** When this install first ran. Null on an install that predates the field. */
  firstLaunchAt: string | null;
  /** Moment keys already spent. Three per install, ever — never reset. */
  usedMoments: readonly string[];
  proUnlocked: boolean;
  /** Sessions in the log right now. */
  sessionCount: number;
  /** Lift histories, most-trained first, as the Progress tab builds them. */
  lifts: readonly LiftHistory[];
  /** The fatigue read, when the model is confident enough to have one. */
  fatigueSignal: FatigueSignal | null;
  /** Flagged body areas: a lift held for one is not a stall to ask about. */
  cautionFlags?: SetupCautionFlag[] | null;
  /** The reader's language: a lift is named in it inside the question. */
  language: AppLanguage;
  now?: Date;
}

/**
 * Whole days between two instants, counted between LOCAL MIDNIGHTS.
 *
 * Helsinki changes clocks twice a year, so a fixed-millisecond division puts
 * the boundary an hour off twice a year and a moment can fire a day early or
 * late. Rounding after dividing local midnights absorbs the 23- and 25-hour
 * days, which is the same rule the rest of the app's date arithmetic follows.
 */
export function daysSince(fromIso: string, now: Date): number {
  const from = new Date(fromIso);
  // An install date that does not parse is day 0, not NaN: no moment is due.
  if (Number.isNaN(from.getTime())) {
    return 0;
  }
  // The app's one day count (duplicate sweep 13, 2026-10-12).
  return calendarDaysBetween(from, now);
}

/** The stalled lift worth asking about, or null when nothing has stalled. */
function stalledLift(
  lifts: readonly LiftHistory[],
  cautionFlags?: SetupCautionFlag[] | null,
): LiftHistory | null {
  let best: LiftHistory | null = null;
  for (const lift of lifts) {
    if (!isLiftPlateaued(lift, cautionFlags)) {
      continue;
    }
    if (!best || lift.stalledSessions > best.stalledSessions) {
      best = lift;
    }
  }
  return best;
}

function decliningLift(lifts: readonly LiftHistory[]): LiftHistory | null {
  // Sessions, not logs: one workout logging a lift twice is not a trend.
  return (
    lifts.find((lift) => {
      const points = sessionBestPoints(lift);
      return points.length >= 3 && points[points.length - 1].topSetWeightKg < points[0].topSetWeightKg;
    }) ?? null
  );
}

/**
 * The question this moment should ask, given what the log actually says.
 *
 * Ordered by how specific the answer can be. The last entry in each list needs
 * no data beyond "you have been training", so a moment that passes its session
 * precondition always has something to ask.
 */
export function pickDemoQuestion(
  key: CoachDemoMomentKey,
  input: Pick<CoachDemoMomentInput, 'lifts' | 'fatigueSignal' | 'cautionFlags' | 'language'>,
): CoachDemoMoment {
  if (key === 'week1') {
    // Nothing has a trend yet at a week. The question that pays off here is
    // the one that proves the coach knows THIS app: it answers with the
    // reader's own programme, goal and equipment, which is the single most
    // surprising thing about it.
    return { key, questionKey: 'coach.demo.week1.fit' };
  }

  if (key === 'month1') {
    const { language } = input;
    const stalled = stalledLift(input.lifts, input.cautionFlags);
    if (stalled) {
      // The strongest one available: this is the exact conclusion the reader
      // has been seeing blurred on Home and Progress for a month.
      return { key, questionKey: 'coach.demo.month1.stalled', vars: nameVars('lift', exerciseNameLabel(language, stalled.name)) };
    }
    const declining = decliningLift(input.lifts);
    if (declining) {
      return { key, questionKey: 'coach.demo.month1.declining', vars: nameVars('lift', exerciseNameLabel(language, declining.name)) };
    }
    return { key, questionKey: 'coach.demo.month1.pace' };
  }

  if (input.fatigueSignal === 'high' || input.fatigueSignal === 'elevated') {
    return { key, questionKey: 'coach.demo.month3.load' };
  }
  // A lift that has stopped is the question Home and Progress have shown a
  // free reader blurred for weeks; at three months it comes with what next
  // (owner, 2026-10-13: build more on the stall).
  const stalledAtThree = stalledLift(input.lifts, input.cautionFlags);
  if (stalledAtThree) {
    return {
      key,
      questionKey: 'coach.demo.month3.stalled',
      vars: nameVars('lift', exerciseNameLabel(input.language, stalledAtThree.name)),
    };
  }
  // Around three months a block is ending, so "what next" is a real question.
  // It also lands on the programme builder, which is Pro — the offer appears,
  // and tapping it is where the paywall legitimately opens.
  return { key, questionKey: 'coach.demo.month3.next' };
}

/**
 * The moment that should be offered right now, or null.
 *
 * Called after a session is saved. Returns the EARLIEST unspent moment whose
 * day and session preconditions are both met, so a reader who installs and
 * then trains hard for three months still gets them in order rather than
 * skipping the first two.
 */
export function resolveDueCoachDemoMoment(input: CoachDemoMomentInput): CoachDemoMoment | null {
  // A paying reader has the real thing and must never be shown a sample of it.
  if (input.proUnlocked) {
    return null;
  }
  if (!input.firstLaunchAt) {
    return null;
  }

  const now = input.now ?? new Date();
  const elapsed = daysSince(input.firstLaunchAt, now);
  const used = new Set(input.usedMoments);

  for (const spec of COACH_DEMO_MOMENTS) {
    if (used.has(spec.key)) {
      continue;
    }
    if (elapsed < spec.afterDays || input.sessionCount < spec.minSessions) {
      // Not "skip" but "stop": the moments are ordered, and offering the
      // third to someone who never qualified for the first would hand the
      // hardest question to the emptiest log.
      return null;
    }
    // The question is about now: a lift dropped months ago keeps its stall
    // run and would be asked about, as Home's plateau card once did.
    return pickDemoQuestion(spec.key, { ...input, lifts: recentLifts([...input.lifts], now) });
  }

  return null;
}

/** Spending a moment. Append-only: three per install, and nothing resets it. */
export function markCoachDemoMomentUsed(used: readonly string[], key: string): string[] {
  // Takes a plain string because the key travels through the route to reach
  // the screen that spends it, and a route is storage: whatever comes back out
  // of one is a string until something checks it. An unknown key is stored
  // rather than rejected — it can only ever cost the reader nothing, whereas
  // dropping a real one silently gives away an answer twice.
  return used.includes(key) ? [...used] : [...used, key];
}

/**
 * Which of the three free answers a spent moment was: 1, 2 or 3, in the
 * order the moments come. Null for a key that is not one of them.
 *
 * The card under a demo answer counts from this ("1/3"), and the count comes
 * from the moment, not from how many are stored as spent: the moments are
 * ordered and never skipped (resolveDueCoachDemoMoment), so the key alone
 * says how many came before it.
 */
export function coachDemoMomentOrdinal(key: string | null | undefined): number | null {
  const index = COACH_DEMO_MOMENTS.findIndex((spec) => spec.key === key);
  return index === -1 ? null : index + 1;
}
