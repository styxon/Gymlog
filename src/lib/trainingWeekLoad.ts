import { removeTrailingZeros } from './format';

/**
 * How much of a week a rhythm actually asks for.
 *
 * The programme screen used to answer this with `program.sessions.length` —
 * how many DIFFERENT sessions the programme holds, which is only the same
 * number as "days per week" when the rhythm happens to run one of each every
 * seven days. Set a five-session programme to "4 on · 1 off" and it trains six
 * days some weeks; the header went on saying five (user 2026-08-31).
 *
 * Three sources, in order of who knows better:
 *   1. a cycle, which states its own period and is not tied to weekdays;
 *   2. the days the plan names, which is the truth for a weekday rhythm;
 *   3. the programme's own stated days, for a programme nobody has adopted.
 *
 * The third used to be the SESSION count. It is the same number for every
 * ready programme today — a guard keeps it so — but it is the wrong question:
 * "how many days" is what the programme states, and the one time the two
 * drifted apart (Strength Foundations 5x5, daysPerWeek 3 on two sessions)
 * this page drew a two-day programme under a catalog row that said "3 ×"
 * (#bugs 2026-09-01).
 */
interface TrainingWeekLoad {
  /** Training days in an average week. 5.6 for "4 on · 1 off". */
  daysPerWeek: number;
  /** One session's minutes; 0 when the programme does not say. */
  minutesPerSession: number;
  /** Minutes across an average week; 0 while a session's length is unknown. */
  minutesPerWeek: number;
}

interface TrainingWeekLoadInput {
  /** The active cycle's on/off pattern, or null for a weekday rhythm. */
  cyclePattern: readonly boolean[] | null;
  /** How many weekdays the rhythm trains on, or null when nothing says. */
  weekdayCount: number | null;
  /** Training days the programme itself states — the last resort. */
  programDaysPerWeek: number;
  /** Estimated minutes of one session; 0 when unknown. */
  minutesPerSession: number;
}

/** One decimal is the resolution a reader can act on; 5.6 days, not 5.6428. */
function toOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildTrainingWeekLoad(input: TrainingWeekLoadInput): TrainingWeekLoad {
  const minutesPerSession = Number.isFinite(input.minutesPerSession)
    ? Math.max(0, Math.round(input.minutesPerSession))
    : 0;

  const daysPerWeek = (() => {
    const pattern = input.cyclePattern;
    // A period of zero is not a rhythm, and an all-rest pattern trains no days
    // — both would otherwise divide or multiply their way to a confident lie.
    if (pattern && pattern.length > 0) {
      const on = pattern.filter(Boolean).length;
      return toOneDecimal((7 * on) / pattern.length);
    }
    if (input.weekdayCount !== null && input.weekdayCount > 0) {
      return Math.min(7, Math.round(input.weekdayCount));
    }
    return Math.min(7, Math.max(0, Math.round(input.programDaysPerWeek)));
  })();

  return {
    daysPerWeek,
    minutesPerSession,
    minutesPerWeek: minutesPerSession > 0 ? Math.round(daysPerWeek * minutesPerSession) : 0,
  };
}

/** "5.6", "5" — never "5.0". */
export function formatTrainingDays(daysPerWeek: number): string {
  return removeTrailingZeros(daysPerWeek);
}

/** "~55", and an em dash when the programme never said how long a session is. */
export function formatTrainingMinutes(minutes: number): string {
  return minutes > 0 ? `~${minutes}` : '—';
}
