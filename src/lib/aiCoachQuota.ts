/**
 * Who may ask the coach, how often, and what happens when they may not.
 *
 * The shape changed on 2026-08-29, and the reason is arithmetic rather than
 * product taste. One coach question costs about $0.027 at the heaviest
 * measured context (scripts/simulate-coach-cost.cjs, Sonnet 5). The free tier
 * used to grant three a week — 13 a month, ~$0.35 per free user per month,
 * which is roughly what a typical PAYING user costs. At any real install count
 * that is not a conversion cost, it is the largest variable cost in the app,
 * and it is spent on the people who are not paying for it.
 *
 * Worse, the ceiling is shared: the Anthropic Console spend limit is one
 * number for the whole app, so free usage could exhaust the budget that
 * paying users depend on. A non-payer being able to break a payer's product
 * is the one failure this design will not accept.
 *
 * So:
 *
 * - FREE asks nothing of its own accord. What a free reader gets instead is
 *   three coach answers at moments the app chooses (lib/coachDemoMoments),
 *   each one costing a single question and landing when there is enough log
 *   behind it to answer well. Three per install, ever — an acquisition cost,
 *   not a running one.
 * - PRO gets 25 a month. Not unlimited: lifetime buyers pay once and consume
 *   forever, so the cap is what keeps that arithmetic from inverting.
 *
 * The window is a calendar month, compared rather than timed, so nothing here
 * needs a clock and a phone that sleeps through midnight still resets.
 */

/** What a Pro membership includes each calendar month. */
export const PRO_COACH_QUESTIONS_PER_MONTH = 25;

interface CoachQuotaState {
  /** First day of the counted month, YYYY-MM. */
  monthStart: string;
  used: number;
}

/** The month containing `now`, as YYYY-MM in local time. */
export function coachQuotaMonthStart(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}`;
}

/**
 * When the allowance comes back, and how far away that is.
 *
 * Days are counted between local midnights, so a question asked at 23:55 on
 * the last day of the month still reports one day rather than none.
 */
export function coachQuotaReset(now: Date = new Date()): { at: Date; inDays: number } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const inDays = Math.max(1, Math.round((at.getTime() - today.getTime()) / 86_400_000));
  return { at, inDays };
}

export function resolveCoachQuota(
  state: CoachQuotaState | null | undefined,
  now: Date = new Date(),
): { monthStart: string; used: number; remaining: number } {
  const monthStart = coachQuotaMonthStart(now);
  const used = state && state.monthStart === monthStart ? Math.max(0, state.used) : 0;
  return {
    monthStart,
    used,
    remaining: Math.max(0, PRO_COACH_QUESTIONS_PER_MONTH - used),
  };
}

export function recordCoachQuestion(
  state: CoachQuotaState | null | undefined,
  now: Date = new Date(),
): CoachQuotaState {
  const current = resolveCoachQuota(state, now);
  return { monthStart: current.monthStart, used: current.used + 1 };
}

/**
 * Questions that are in flight: promised to a request that has not been paid for yet.
 *
 * A build or a photo read checks the allowance, waits many seconds for the
 * model, and only then records the spend. Two of them started in that window
 * read the same stored count (a render-time snapshot, not even the latest
 * write), both passed, and the month ended on 26 of 25. The check and the
 * claim have to be one synchronous step: `reserve` counts what the stored
 * state says is left MINUS what other requests have already claimed, and
 * claims one before returning. The holder gives it back with `release` when it
 * is done — after the spend is recorded, or at once when nothing was spent
 * (a photo that failed to read costs nothing, #415).
 */
export interface CoachQuotaLedger {
  /** True and claims one when the stored allowance minus other claims leaves one. */
  reserve(state: CoachQuotaState | null | undefined, now?: Date): boolean;
  /** Gives one claim back. Never goes below zero. */
  release(): void;
  /**
   * The allowance a spend just wrote. A request started from a closure older
   * than that write still passes the count from before it; `reserve` reads
   * whichever of the two has used more in the same month.
   */
  note(written: CoachQuotaState): void;
  /** recordCoachQuestion, with the result noted: the updater every spend writes through. */
  record(state: CoachQuotaState | null | undefined, now?: Date): CoachQuotaState;
  /**
   * Takes back the last `record` when its write was refused. `record` notes
   * the spend inside the updater, before the disk has it, so a refused write
   * left the note one question ahead of what is stored: `reserve` read the
   * lower of the two and the reader was a question short until the app was
   * restarted (hunt build 6->7, C9). Only if nothing was noted since.
   */
  forget(): void;
  /** Claims held now. */
  held(): number;
}

/**
 * A build that was refused where the request is made, as opposed to one that
 * failed. `spent`: no question left (a photo read or a chat answer holds the
 * last one, or a stale screen still showed one). `not_pro`: Pro ended since
 * the screen was drawn. Nothing was built and nothing was charged, so the
 * chat says why and keeps the offer instead of reading "could not build".
 */
export interface ComposeRefusal {
  refused: 'spent' | 'not_pro';
}

export function isComposeRefusal(value: unknown): value is ComposeRefusal {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const refused = (value as { refused?: unknown }).refused;
  return refused === 'spent' || refused === 'not_pro';
}

export function createCoachQuotaLedger(): CoachQuotaLedger {
  let held = 0;
  let written: CoachQuotaState | null = null;
  // The last record and what was noted before it, for `forget`.
  let recorded: CoachQuotaState | null = null;
  let beforeRecorded: CoachQuotaState | null = null;
  return {
    reserve(state, now) {
      const passed = resolveCoachQuota(state, now);
      const latest = written ? resolveCoachQuota(written, now) : null;
      const remaining =
        latest && latest.monthStart === passed.monthStart ? Math.min(passed.remaining, latest.remaining) : passed.remaining;
      if (remaining - held <= 0) {
        return false;
      }
      held += 1;
      return true;
    },
    release() {
      held = Math.max(0, held - 1);
    },
    note(next) {
      written = next;
    },
    record(state, now) {
      const next = recordCoachQuestion(state, now);
      beforeRecorded = written;
      recorded = next;
      written = next;
      return next;
    },
    forget() {
      if (recorded !== null && written === recorded) {
        written = beforeRecorded;
      }
      recorded = null;
    },
    held: () => held,
  };
}
