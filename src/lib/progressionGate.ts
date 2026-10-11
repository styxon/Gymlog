import type { WorkoutSlotHistoryEntry } from '../features/workout/workoutTypes';
import { isUnloadedTrackingMode, readStoredTrackingMode } from '../features/workout/workoutTypes';
import { SetupCautionArea, SetupLevel } from '../types/models';
import { getRollingWindowStart, localDateKey } from './completedSessions';
import { buildFatigueModel, type FatigueModelInput } from './fatigueModel';
import { gatingSets, isWithinOneDialStep } from './warmupSets';

/**
 * Double progression, as specified (ADR-004 + progression-gating-rules.md).
 *
 * This is the decision that used to exist only on paper. The rule was written
 * down, `buildProgressionSuggestion` implemented a rough version of it, and
 * that function was wired into WorkoutExerciseCard — a component no screen
 * renders. So the live logger simply repeated last session's weight forever
 * and the "Automated progression" toggle changed nothing a free user could
 * see. This is the gate the logger actually calls.
 *
 * The load increases only when the rep ceiling is reached on ALL target
 * working sets. One set at the ceiling is not enough — that is the whole
 * point of the model, and the thing a naive "did they hit the top rep?"
 * implementation gets wrong.
 */

export type ProgressionLevelTier = 'beginner' | 'intermediate';

export interface ProgressionLevelParams {
  /** Sessions of history needed before the gate says anything at all. */
  minSessions: number;
  /** Consecutive progression-ready sessions required before load moves. */
  requiredConsecutive: number;
  /**
   * Between sessions. The weight dial inside a session still steps 1.25 kg;
   * this is only what the next session opens on.
   */
  loadIncrementKg: number;
  /**
   * Reps past the ceiling, on every target set, that let a single session
   * move the load before `minSessions` is reached — the weight was plainly
   * too light. Null: no early move.
   */
  earlyJumpRepsOver: number | null;
}

/**
 * Values owned by progression-gating-rules.md §7.
 *
 * 2.5 kg for every level (user decision 2026-09-28): 1.25 kg on a barbell is
 * 0.625 kg a side, which standard plates cannot build (break round). A
 * beginner moves after two sessions, and after one when every set cleared the
 * ceiling by two reps or more (same decision: "if they beat their own reps
 * straight away, why not offer more?").
 */
export const PROGRESSION_LEVEL_PARAMS: Record<ProgressionLevelTier, ProgressionLevelParams> = {
  beginner: { minSessions: 2, requiredConsecutive: 1, loadIncrementKg: 2.5, earlyJumpRepsOver: 2 },
  intermediate: { minSessions: 3, requiredConsecutive: 2, loadIncrementKg: 2.5, earlyJumpRepsOver: null },
};

export function getProgressionTier(level: SetupLevel | null | undefined): ProgressionLevelTier {
  // 'advanced' and 'pro' both want the confirmation session; only a true
  // beginner progresses off a single ceiling session.
  return level === 'beginner' || level == null ? 'beginner' : 'intermediate';
}

/** What the gate acts on, narrower than the fatigue model's own signal. */
export type ProgressionFatigueSignal = 'normal' | 'elevated' | 'high';

export type ProgressionHoldReason =
  | 'fatigue_high'
  | 'fatigue_elevated'
  | 'insufficient_sets'
  | 'rep_ceiling_not_reached'
  | 'gap_return'
  | 'awaiting_confirmation';

/**
 * The fatigue model's four-way signal, narrowed to what the gate acts on.
 *
 * The holds below were written with the gate and then never fired: nothing
 * passed a signal in, so `fatigueSignal` was undefined on every call for
 * months while the paywall sold "Pro reads your load and eases off before
 * fatigue costs you a week". This is the missing half.
 *
 * `confident` is not optional. The chronic load is a 28-day total over four,
 * so one logged session gives acute 500 against chronic 125 — an ACWR of 4,
 * and a hold on the strength of a single workout. Below the confidence bar
 * the answer is 'normal': the gate must not ease off on a guess.
 */
export function toProgressionFatigueSignal(
  fatigue: { signal: 'undertrained' | 'optimal' | 'elevated' | 'high'; confident: boolean } | null | undefined,
): ProgressionFatigueSignal {
  if (!fatigue || !fatigue.confident) {
    return 'normal';
  }
  if (fatigue.signal === 'high') {
    return 'high';
  }
  if (fatigue.signal === 'elevated') {
    return 'elevated';
  }
  // 'undertrained' is not a reason to hold — it is room to add.
  return 'normal';
}

/**
 * The recovery signal for the moment a workout starts.
 *
 * A signal kept in memory was built when the last session was saved, and a
 * window built then still counted a heavy week as "this week" on the Wednesday
 * after: ACWR 1.39 held the loads, where the same logs read 1.07 on the day
 * (bug hunt, 2026-10-10). A start asks the clock it is started on.
 */
export function progressionFatigueSignalAt(input: FatigueModelInput, now: Date): ProgressionFatigueSignal {
  return toProgressionFatigueSignal(buildFatigueModel(input, now));
}

export type ProgressionDecision =
  | { recommendation: 'silent' }
  | { recommendation: 'hold'; holdReason: ProgressionHoldReason; loadKg: number }
  | { recommendation: 'increase'; loadKg: number; fromLoadKg: number; incrementKg: number };

export interface ProgressionGateInput {
  /** Newest first, as the slot history stores it. */
  history: WorkoutSlotHistoryEntry[];
  repsMin: number;
  repsMax: number;
  targetSets: number;
  level?: SetupLevel | null;
  /** Caller-computed. Undefined counts as clear, per the spec's T11. */
  fatigueSignal?: ProgressionFatigueSignal;
  /** Bodyweight exercises accumulate reps; load never moves. */
  trackingMode?: string;
  /**
   * The caller's clock. The early jump reads it: a single session is its
   * whole case, so there is no session before it for the break rule to see.
   * The break rule reads it too, for the break that is still going on: the
   * time between the newest session and today. And a session dated after it
   * ranks below every real one (sessionsOf). Absent, no early jump and only
   * the gap between sessions counts as a break.
   */
  nowMs?: number;
}

/**
 * A break: this many calendar days or more between two sessions of the lift.
 *
 * Not the spec's 7. Slot history is kept per programme day, so a lift on a
 * weekly programme is 7 days from its last session every time — and at 7 the
 * rule held the earned jump whenever this week's finish came a few minutes
 * later in the day than last week's: about every other week (bug hunt,
 * 2026-10-09). Ten lets a weekly session move a day or two and still counts
 * a missed week, 14 days, as the break it is.
 */
const BREAK_DAYS = 10;

/**
 * The sets the programme asked for: the first `targetSets`, in set order.
 *
 * A set past them is extra work. A tired fourth set of 60 × 5 after 3 × 8 as
 * asked held the jump the three had earned, while a lighter one did not — the
 * missed-reps rule already reads only these (review of #202; bug hunt,
 * 2026-10-09).
 */
function programmedSets(entry: WorkoutSlotHistoryEntry, targetSets: number) {
  return [...entry.sets].sort((left, right) => left.setIndex - right.setIndex).slice(0, Math.max(0, targetSets));
}

/**
 * The sets this entry had to log: the programme's count, or fewer when the
 * app itself asked for fewer — a lighter session files `plannedSets`. One held
 * session is enough: the next normal one progresses as if the lighter one had
 * been a full one at its sets (owner, Q3 2026-10-11). Read defensively, like
 * givenTarget: slot history is stored as written.
 */
function setsNeeded(entry: WorkoutSlotHistoryEntry, targetSets: number): number {
  const planned = (entry as { plannedSets?: unknown }).plannedSets;
  return typeof planned === 'number' && Number.isInteger(planned) && planned > 0 && planned < targetSets
    ? planned
    : targetSets;
}

/** The heaviest load the programmed sets used, which is what we progress from. */
function entryLoadKg(entry: WorkoutSlotHistoryEntry, targetSets: number): number {
  return programmedSets(entry, targetSets).reduce((max, set) => Math.max(max, set.loadKg), 0);
}

/**
 * A session is progression-ready when every working set up to its heaviest
 * reached the rep ceiling, enough sets were completed, and nothing was skipped.
 *
 * "Up to its heaviest": the lighter sets after the last heaviest one — a drop
 * or a back-off — are exempt (lib/warmupSets gatingSets). Straight sets and an
 * ascending pyramid are gated on every set, as they always were. Warm-ups are
 * not in `entry.sets` here: the caller reads working entries.
 */
export function isProgressionReadySession(
  entry: WorkoutSlotHistoryEntry,
  repsMax: number,
  targetSets: number,
): boolean {
  if (entry.skipped || entry.sets.length === 0) {
    return false;
  }
  if (entry.sets.length < setsNeeded(entry, targetSets)) {
    return false;
  }
  return gatingSets(programmedSets(entry, targetSets)).every((set) => set.reps >= repsMax);
}

/**
 * Whether `earlierIso` is at least `days` calendar days before `laterIso`,
 * at the same time of day.
 *
 * Elapsed milliseconds read a week off across the spring clock change as 6.96
 * days — no break — and added load on the first session back (break round,
 * 2026-09-28). A count of calendar days would fix that and break the other
 * edge: 23:00 one day to 01:00 six days later is seven midnights and barely
 * six days (CI review of #223). The window start keeps the time of day, so
 * both hold; completedSessions says to gate this way.
 */
function isAtLeastDaysBefore(earlierIso: string, laterIso: string, days: number): boolean {
  const later = Date.parse(laterIso);
  const earlier = Date.parse(earlierIso);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) {
    return false;
  }
  return earlier <= getRollingWindowStart(later, days);
}

/** Every target set past the ceiling by `margin` reps: the load was too light. */
function clearsCeilingBy(entry: WorkoutSlotHistoryEntry, repsMax: number, targetSets: number, margin: number): boolean {
  return (
    !entry.skipped &&
    entry.sets.length >= setsNeeded(entry, targetSets) &&
    entry.sets.length > 0 &&
    gatingSets(programmedSets(entry, targetSets)).every((set) => set.reps >= repsMax + margin)
  );
}

/**
 * The sessions the gate reads: entries with a logged set, newest first, one
 * per local calendar date.
 *
 * An entry with no sets is a day this lift did not happen — skipped, left
 * pending when the workout ended, or junk dropped on load — and a finished
 * session filed one for every such lift. Counted, one real session and one
 * empty entry met a beginner's two-session baseline (third break round,
 * 2026-09-28). As the newest entry it silenced the gate and dropped a jump
 * already earned; as the one before, it hid a five-week break from the break
 * rule (bug hunt, 2026-10-09). The prefill and the "Last time" card look past
 * them too (selectLatestUsableEntry), and so does the missed-reps target.
 */
function sessionsOf(history: readonly WorkoutSlotHistoryEntry[], nowMs?: number): WorkoutSlotHistoryEntry[] {
  const logged = history.filter((entry) => entry.sets.length > 0);
  // Newest by the time on the entry, not by where it sits in the array. A
  // session is stored at the front when it is saved, so one saved while the
  // phone's clock ran behind stayed history[0] over every real session: the
  // gate read the months to it as a break and held a jump two clean sessions
  // had earned, while "Last time" showed the real last one (hunt, 2026-10-10).
  // One saved while the clock ran ahead ranks below every session dated up to
  // now (hunt, 2026-10-09), as rankTime in exerciseHistoryLookup ranks it.
  // A date that does not parse ranks below all of those: it says nothing about
  // when the session was. Equal times keep the array order (a stable sort).
  const hasNow = typeof nowMs === 'number' && Number.isFinite(nowMs);
  const rank = (entry: WorkoutSlotHistoryEntry) => {
    const time = Date.parse(entry.performedAt);
    if (!Number.isFinite(time)) {
      return { tier: 0, time: 0 };
    }
    return hasNow && time > (nowMs as number) ? { tier: 1, time: 0 } : { tier: 2, time };
  };
  // One local calendar date is one session (owner, 2026-10-11, Q7): a morning
  // and an evening of the same day met a beginner's two-session baseline in an
  // afternoon. The day's newest stands for it — the session the prefill and
  // "Last time" read — and the earlier ones of that date drop out. The device's
  // own date, never a UTC slice or a division by DAY_MS: 00:30 in Helsinki is
  // the previous day in UTC, and 25.10.2026 has 25 hours. A session is dated
  // by its finish, so one that ran past midnight belongs to the day it ended.
  // Only dated, past entries collapse; the rest say nothing about the day.
  const seenDates = new Set<string>();
  return logged
    .map((entry, index) => ({ entry, index, ...rank(entry) }))
    .sort((left, right) => right.tier - left.tier || right.time - left.time || left.index - right.index)
    .filter(({ tier, time }) => {
      if (tier !== 2) {
        return true;
      }
      const date = localDateKey(time);
      if (seenDates.has(date)) {
        return false;
      }
      seenDates.add(date);
      return true;
    })
    .map(({ entry }) => entry);
}

/**
 * Whether today is a break from the newest session: BREAK_DAYS or more since
 * it, by the caller's clock.
 *
 * The gap between the last two sessions only sees a break once the session
 * after it is logged, so the first session back opened on a raised weight
 * and the hold landed on the second (hunt, 2026-10-09). A newest session
 * dated after now is a wrong clock, not a break.
 */
function isBreakSince(latest: WorkoutSlotHistoryEntry, nowMs: number | undefined): boolean {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || !(Date.parse(latest.performedAt) <= nowMs)) {
    return false;
  }
  return isAtLeastDaysBefore(latest.performedAt, new Date(nowMs).toISOString(), BREAK_DAYS);
}

/**
 * When a session started, which is where the gap before it ends.
 *
 * The start reads the gap from the last finish to the moment it is started
 * (isBreakSince), and the filed session was read to its finish: started 9 d
 * 23 h 45 min after the last one, it opened raised and then, filed, counted as
 * the return from a break and held the session after (hunt, 2026-10-11). The
 * filed start; before it was filed, the first set's time; else the finish.
 * A time after the finish is not a start.
 */
function sessionStartIso(entry: WorkoutSlotHistoryEntry): string {
  const finishedMs = Date.parse(entry.performedAt);
  const startedMs = typeof entry.startedAt === 'string' ? Date.parse(entry.startedAt) : Number.NaN;
  const before = (ms: number) => Number.isFinite(ms) && (!Number.isFinite(finishedMs) || ms <= finishedMs);
  if (before(startedMs)) {
    return entry.startedAt as string;
  }
  const firstSet = entry.sets
    .map((set) => ({ iso: set.completedAt, ms: typeof set.completedAt === 'string' ? Date.parse(set.completedAt) : Number.NaN }))
    .filter((set) => before(set.ms))
    .sort((left, right) => left.ms - right.ms)[0];
  return firstSet ? firstSet.iso : entry.performedAt;
}

/** No load to gate: bodyweight, a hold, a bout of minutes (workoutTypes). */
function isUnloadedMode(trackingMode: string | undefined): boolean {
  const mode = readStoredTrackingMode(trackingMode);
  return mode !== null && isUnloadedTrackingMode(mode);
}

export function evaluateProgression(input: ProgressionGateInput): ProgressionDecision {
  const { repsMin, repsMax, targetSets, fatigueSignal, trackingMode } = input;
  const history = sessionsOf(input.history, input.nowMs);
  const params = PROGRESSION_LEVEL_PARAMS[getProgressionTier(input.level)];

  // ── Silence: no target to evaluate against, or not enough baseline ────────
  if (!(repsMin > 0) || !(repsMax > 0) || !(targetSets > 0)) {
    return { recommendation: 'silent' };
  }
  // Bodyweight progresses by reps and variation, never by load (ADR-004 §What
  // This Model Does Not Cover).
  // A hold progresses in seconds, and there is no load to add either way.
  // Nor does a bout of minutes, which the app never moves on its own: the
  // programme's minutes are the dose, and the reader logs what they did
  // (2026-10-06 — the conservative choice; see lib/minutesExercises).
  if (isUnloadedMode(trackingMode)) {
    return { recommendation: 'silent' };
  }
  if (history.length < params.minSessions) {
    // Short of the baseline, one exception: a weight so light that every
    // set went well past the ceiling. The holds below still apply to it.
    // And only off a recent session. The break rule needs a session before
    // this one, which a single session never has, so a first session months
    // old moved the load as if it were last week (recheck of #223,
    // 2026-09-28). Short of a break, as the break rule counts one: at 7 days
    // a weekly lift's second visit was never recent.
    const recent =
      typeof input.nowMs === 'number' &&
      Number.isFinite(input.nowMs) &&
      history.length >= 1 &&
      !isAtLeastDaysBefore(history[0].performedAt, new Date(input.nowMs).toISOString(), BREAK_DAYS) &&
      // Not in the future either: a session dated ahead by a wrong phone
      // clock stayed "recent" for good (third break round, 2026-09-28).
      Date.parse(history[0].performedAt) <= input.nowMs;
    const early =
      recent &&
      params.earlyJumpRepsOver !== null &&
      clearsCeilingBy(history[0], repsMax, targetSets, params.earlyJumpRepsOver);
    if (!early) {
      return { recommendation: 'silent' };
    }
  }

  const latest = history[0];
  if (!latest) {
    return { recommendation: 'silent' };
  }

  const currentLoadKg = entryLoadKg(latest, targetSets);
  if (!(currentLoadKg > 0)) {
    return { recommendation: 'silent' };
  }

  // ── Hold, in the spec's order: fatigue first, it is a hard block ──────────
  if (fatigueSignal === 'high') {
    return { recommendation: 'hold', holdReason: 'fatigue_high', loadKg: currentLoadKg };
  }
  if (fatigueSignal === 'elevated') {
    return { recommendation: 'hold', holdReason: 'fatigue_elevated', loadKg: currentLoadKg };
  }

  // No hold for a skip: a skipped lift is filed with no sets, which
  // sessionsOf looks past (owner, Q8 2026-10-11). A skipped entry with sets is
  // no shape the app writes; it is not a ready session, and holds below.
  if (latest.sets.length < setsNeeded(latest, targetSets)) {
    return { recommendation: 'hold', holdReason: 'insufficient_sets', loadKg: currentLoadKg };
  }

  // A session that follows a long break is not the moment to add load, and
  // neither is the first one back from it.
  const previous = history[1];
  if (
    (previous && isAtLeastDaysBefore(previous.performedAt, sessionStartIso(latest), BREAK_DAYS)) ||
    isBreakSince(latest, input.nowMs)
  ) {
    return { recommendation: 'hold', holdReason: 'gap_return', loadKg: currentLoadKg };
  }

  if (!isProgressionReadySession(latest, repsMax, targetSets)) {
    return { recommendation: 'hold', holdReason: 'rep_ceiling_not_reached', loadKg: currentLoadKg };
  }

  // ── Consecutive-session gate ─────────────────────────────────────────────
  let consecutive = 0;
  for (const entry of history) {
    if (!isProgressionReadySession(entry, repsMax, targetSets)) {
      break;
    }
    // Only sessions at the same load count toward confirmation; a lighter
    // session that happened to hit the ceiling proves nothing about this load.
    // The same load is within one dial step of the newest session's (owner,
    // 2026-10-11, Q6), always compared with the newest, never chained.
    // Over the set positions both logged: a lighter session (plannedSets)
    // drops the last set, a pyramid's top, so its 50/55 is the same work as
    // the full session's 50/55/60, not a lighter load (owner, Q3).
    const positions = Math.min(programmedSets(entry, targetSets).length, programmedSets(latest, targetSets).length);
    if (!isWithinOneDialStep(entryLoadKg(entry, positions), entryLoadKg(latest, positions))) {
      break;
    }
    consecutive += 1;
  }

  if (consecutive < params.requiredConsecutive) {
    return { recommendation: 'hold', holdReason: 'awaiting_confirmation', loadKg: currentLoadKg };
  }

  return {
    recommendation: 'increase',
    loadKg: currentLoadKg + params.loadIncrementKg,
    fromLoadKg: currentLoadKg,
    incrementKg: params.loadIncrementKg,
  };
}

/**
 * What the logger should prefill for a set.
 *
 * With automated progression off, this is exactly the old behaviour: repeat
 * what was logged last time. With it on, an earned progression moves the load
 * and every other outcome still repeats — so the toggle changes something the
 * user can actually see, which it previously did not.
 */
export function resolveProgressedLoadKg(
  input: ProgressionGateInput & {
    automatedProgressionEnabled: boolean;
    /** This set's own load last time: what it repeats, and what it climbs from. */
    fallbackLoadKg: number;
    /**
     * This set's own reps last time, when known. A lighter set after the
     * heaviest (a drop) that fell short of the programme's floor keeps its
     * load when the rest climb: the gate exempted it, and it did not earn more.
     */
    fallbackReps?: number;
    /**
     * The body area this lift loads, when the reader flagged it in setup
     * (careful or avoid). Null or absent for every other lift.
     */
    cautionArea?: SetupCautionArea | null;
  },
): {
  loadKg: number;
  progressed: boolean;
  fromLoadKg: number | null;
  /**
   * True when the load would have moved but recovery said not today.
   *
   * A hold is the absence of a change, which is invisible — and an invisible
   * feature is one the user cannot know they are paying for. The logger says
   * so on the set, the same way it says where a raised load came from.
   */
  heldForFatigue: boolean;
  /**
   * The flagged area that held an earned jump, or null.
   *
   * Onboarding tells a reader with flagged areas that the app will not raise
   * the weight on lifts that load them. This is that promise: the gate never
   * moves such a load, and — like the recovery hold — it only says so when a
   * jump had actually been earned.
   */
  heldForCautionArea: SetupCautionArea | null;
} {
  if (!input.automatedProgressionEnabled) {
    return {
      loadKg: input.fallbackLoadKg,
      progressed: false,
      fromLoadKg: null,
      heldForFatigue: false,
      heldForCautionArea: null,
    };
  }

  if (input.cautionArea) {
    // A flagged area outranks recovery: the hold is permanent, not a bad week,
    // so it is the reason worth naming. Checked with recovery out of the way
    // for the same reason as below — only a jump that was earned was held.
    const earned = evaluateProgression({ ...input, fatigueSignal: 'normal' }).recommendation === 'increase';
    return {
      loadKg: input.fallbackLoadKg,
      progressed: false,
      fromLoadKg: null,
      heldForFatigue: false,
      heldForCautionArea: earned ? input.cautionArea : null,
    };
  }

  const decision = evaluateProgression(input);
  if (decision.recommendation === 'increase') {
    // Each set climbs from its own load (user, 2026-10-05, "A"): the decision
    // is about the session, the step is per set. It used to put the heaviest
    // load plus the step on every set, and a 50/60/70 pyramid came back as
    // 72.5 × 3. A set with no load of its own opens on the decision's load,
    // as every set did before.
    const own = input.fallbackLoadKg;
    if (own > 0) {
      // "Heaviest" as the gate read it: within one dial step of the top
      // (lib/warmupSets gatingSets), so the drop exemption covers the sets
      // the gate exempted and no others.
      const isHeaviest = own >= decision.fromLoadKg || isWithinOneDialStep(decision.fromLoadKg, own);
      if (!isHeaviest && typeof input.fallbackReps === 'number' && input.fallbackReps < input.repsMin) {
        return { loadKg: own, progressed: false, fromLoadKg: null, heldForFatigue: false, heldForCautionArea: null };
      }
      // `fromLoadKg` is what the set was carrying before the gate moved it —
      // the logger shows the difference, so a load the user did not choose can
      // say where it came from.
      return {
        loadKg: own + decision.incrementKg,
        progressed: true,
        fromLoadKg: own,
        heldForFatigue: false,
        heldForCautionArea: null,
      };
    }
    return {
      loadKg: decision.loadKg,
      progressed: true,
      fromLoadKg: decision.fromLoadKg,
      heldForFatigue: false,
      heldForCautionArea: null,
    };
  }

  // The badge may only claim a decision the app actually made.
  //
  // Fatigue is checked FIRST in the gate order, so a hold reports
  // 'fatigue_high' even when the load was never going to move — the user had
  // not cleared the rep ceiling, or skipped a set. Reporting that as "held for
  // recovery" would be a false claim, and a loud one: a high ACWR persists for
  // weeks, so the badge would sit on every set of every session while the app
  // took credit for holding back a jump that was never earned.
  //
  // So: re-run the gate with recovery out of the way. It is only a recovery
  // hold if the load would otherwise have moved.
  const heldForFatigue =
    decision.recommendation === 'hold'
    && (decision.holdReason === 'fatigue_high' || decision.holdReason === 'fatigue_elevated')
    && evaluateProgression({ ...input, fatigueSignal: 'normal' }).recommendation === 'increase';

  return { loadKg: input.fallbackLoadKg, progressed: false, fromLoadKg: null, heldForFatigue, heldForCautionArea: null };
}

/** One more rep, both tiers — a rep is already the smallest step there is. */
export const REP_INCREMENT = 1;

/**
 * Named, not inlined at the call site: `heldForFatigue` on the load resolver
 * shipped computed-but-dropped because the receiving object listed its fields
 * by hand. A named type keeps the field list in one place for both resolvers.
 */
export interface ProgressedRepsResolution {
  /** What the reps dial should open at. */
  targetReps: number;
  progressed: boolean;
  /** The floor the user actually proved last time, when the target moved. */
  fromReps: number | null;
  /** Same contract as the load resolver: earned, and recovery said not today. */
  heldForFatigue: boolean;
  /** Same contract as the load resolver: earned, and a flagged area held it. */
  heldForCautionArea: SetupCautionArea | null;
}

/** The weakest programmed set is the level the session proved, so it is what we raise. */
function entryMinReps(entry: WorkoutSlotHistoryEntry, targetSets: number): number {
  return programmedSets(entry, targetSets).reduce((min, set) => Math.min(min, set.reps), Number.POSITIVE_INFINITY);
}

export interface ProgressedRepsInput {
  /** Newest first, as the slot history stores it. */
  history: WorkoutSlotHistoryEntry[];
  /** The template's single rep target (repsMax; min equals it in the catalog). */
  templateTargetReps: number;
  targetSets: number;
  level?: SetupLevel | null;
  fatigueSignal?: ProgressionFatigueSignal;
  trackingMode?: string;
  automatedProgressionEnabled: boolean;
  /** The flagged area this exercise loads, if any — see resolveProgressedLoadKg. */
  cautionArea?: SetupCautionArea | null;
  /** The caller's clock, read as the load gate reads it (ProgressionGateInput). */
  nowMs?: number;
}

type RepsRecommendation = 'silent' | 'hold' | 'increase';

function evaluateRepsProgression(input: ProgressedRepsInput): RepsRecommendation {
  const { templateTargetReps, targetSets, fatigueSignal } = input;
  const history = sessionsOf(input.history, input.nowMs);
  const params = PROGRESSION_LEVEL_PARAMS[getProgressionTier(input.level)];

  if (!(templateTargetReps > 0) || !(targetSets > 0)) {
    return 'silent';
  }
  if (history.length < params.minSessions) {
    return 'silent';
  }

  const latest = history[0];
  if (!latest) {
    return 'silent';
  }

  // Same order as the load gate: fatigue is a hard block and comes first.
  if (fatigueSignal === 'high' || fatigueSignal === 'elevated') {
    return 'hold';
  }
  if (latest.sets.length < setsNeeded(latest, targetSets)) {
    return 'hold';
  }

  const previous = history[1];
  if (
    (previous && isAtLeastDaysBefore(previous.performedAt, sessionStartIso(latest), BREAK_DAYS)) ||
    isBreakSince(latest, input.nowMs)
  ) {
    return 'hold';
  }

  // Ready = every working set reached the target — the load gate's own rule,
  // with the target playing the ceiling. No same-level requirement across
  // sessions: reps drift upward naturally, and 13-13-13 after 12-12-12 is
  // confirmation, not a different lift.
  let consecutive = 0;
  for (const entry of history) {
    if (!isProgressionReadySession(entry, templateTargetReps, targetSets)) {
      break;
    }
    consecutive += 1;
  }
  if (consecutive < params.requiredConsecutive) {
    return 'hold';
  }

  return 'increase';
}

/**
 * The reps the newest session the gate reads proved on every programmed set,
 * never below the template's target; the template with no session to read.
 */
function provenFloorReps(input: ProgressedRepsInput): number {
  const newest = sessionsOf(input.history, input.nowMs)[0];
  // A session short of the programme's sets proved no floor: 1 × 20 and quit
  // asked for 3 × 20 next time (review, 2026-10-11). A lighter session that
  // logged every set it asked for (plannedSets) did prove it (owner, Q3).
  const floor =
    newest && newest.sets.length >= setsNeeded(newest, input.targetSets)
      ? entryMinReps(newest, input.targetSets)
      : Number.NaN;
  return Number.isFinite(floor) ? Math.max(input.templateTargetReps, floor) : input.templateTargetReps;
}

/**
 * What the reps dial should open at, for exercises that progress by reps.
 *
 * The load resolver's counterpart for bodyweight work, where ADR-004 keeps the
 * load gate silent: an earned session moves the target one rep past the floor
 * the user proved, and every other outcome repeats that floor — never below
 * the template's target. Holds are excluded: their "reps" are seconds, and a
 * seconds dose is not dialled by one.
 *
 * A hold used to open on the template: 13/13/13 earned, then held for recovery
 * or a flagged area, asked for 12 under a badge that said the dose was held
 * (hunt, 2026-10-11). A hold repeats, as the load gate's does.
 */
export function resolveProgressedReps(input: ProgressedRepsInput): ProgressedRepsResolution {
  const base: ProgressedRepsResolution = {
    targetReps: input.templateTargetReps,
    progressed: false,
    fromReps: null,
    heldForFatigue: false,
    heldForCautionArea: null,
  };

  if (!input.automatedProgressionEnabled || input.trackingMode !== 'bodyweight') {
    return base;
  }

  // A flagged area holds reps the way it holds load: the dose on that area
  // does not climb on its own, and the hold is named only when it was earned.
  const floorReps = provenFloorReps(input);
  if (input.cautionArea) {
    const earned = evaluateRepsProgression({ ...input, fatigueSignal: 'normal' }) === 'increase';
    return { ...base, targetReps: floorReps, heldForCautionArea: earned ? input.cautionArea : null };
  }

  const recommendation = evaluateRepsProgression(input);
  if (recommendation === 'increase') {
    // The floor can sit above the template target when the user has been
    // overshooting it; raising from the proven floor is what keeps +1 honest.
    // The session the gate just read: the newest that logged sets.
    const fromReps = floorReps;
    return {
      targetReps: fromReps + REP_INCREMENT,
      progressed: true,
      fromReps,
      heldForFatigue: false,
      heldForCautionArea: null,
    };
  }

  // Same rule as the load resolver: it is only a recovery hold if the reps
  // would otherwise have moved.
  const heldForFatigue =
    recommendation === 'hold'
    && (input.fatigueSignal === 'high' || input.fatigueSignal === 'elevated')
    && evaluateRepsProgression({ ...input, fatigueSignal: 'normal' }) === 'increase';

  return { ...base, targetReps: floorReps, heldForFatigue };
}

export interface MissedRepsInput {
  /** Newest first, this slot's own scoped history — never a borrowed one. */
  history: WorkoutSlotHistoryEntry[];
  repsMin: number;
  targetSets: number;
  trackingMode?: string;
  automatedProgressionEnabled: boolean;
  /**
   * The moment the target is for. Without it the history's age is not asked,
   * which is how the pure tests read a history with no clock.
   */
  nowMs?: number;
  /** A flagged area this lift loads: its target is repeated, never climbed. */
  cautionArea?: SetupCautionArea | null;
}

/**
 * Older than this, a short session says nothing about today (the gating
 * spec's S8: "all sessions for this exercise are older than 90 days").
 *
 * Not the spec's 7-day gap (S7): that is measured between the last two
 * sessions, and a lift trained once a week is 7 days apart every time — the
 * rule would have silenced this target on exactly the weekly programmes it was
 * written for (break round 2026-09-28).
 */
export const MISSED_REPS_STALE_DAYS = 90;

/**
 * Older than MISSED_REPS_STALE_DAYS calendar days, at the same time of day.
 * Ninety fixed 24-hour days ran an hour short or long over a clock change, so
 * the same 90 days read stale in autumn and fresh in summer (hunt, 2026-10-09).
 */
function isStale(performedMs: number, nowMs: number): boolean {
  return performedMs < getRollingWindowStart(nowMs, MISSED_REPS_STALE_DAYS);
}

export interface MissedRepsResolution {
  /** What every set's reps dial opens on, below the programme's floor. */
  targetReps: number;
  /** Last time's average over its sets, when that is where the target came from. */
  fromAverage: number | null;
}

/** A target the app gave last time, read defensively: slot history is stored as written. */
function givenTarget(entry: WorkoutSlotHistoryEntry, repsMin: number): number | null {
  const target = (entry as { targetReps?: unknown }).targetReps;
  return typeof target === 'number' && Number.isInteger(target) && target > 0 && target < repsMin ? target : null;
}

/**
 * When the reps fell short of the programme, a target the reader can meet.
 *
 * Seen at the gym (2026-09-09): 7 · 6 · 4 · 4 last time and the app asked for
 * 4 × 12 at the same weight — not possible. The user's rule: "tee samalla
 * painolla mutta yritä tehdä 6 6 6 6". So when last time's average falls
 * below the programme's floor, the weight stays (the load gate already holds
 * it — the ceiling was not reached) and every set aims for the average,
 * rounded up. Once every set reaches that target, the next session asks one
 * rep more — two when every set went past it — until the programme's own
 * reps are back and the ordinary progression takes over.
 *
 * The target the app gave is read back from the history entry, because "one
 * more than last time's target" cannot be worked out from the reps alone.
 * A hold is seconds and a bout is minutes: both are left alone. Bodyweight
 * work gets the target too (owner, 2026-10-11): 6/5/4 pull-ups on 8-12 asked
 * for 12, the same impossible ask the rule was written for. Its reps still
 * only rise through the reps gate; this asks for no more than the programme
 * did. Pro, like the rest of automated progression (user, 2026-09-28).
 *
 * On a lift that loads a flagged area the climb is withheld, as the ramp
 * rule's +1 is: the target repeats what the sets last did rather than asking
 * one more. Recovery does not withhold it. The climb only returns towards the
 * programme's own reps, at a weight that does not move, so it adds nothing
 * the programme did not already ask for — and held, a "recovery low" reading
 * kept a bench at 3 × 6 for three sessions under a programme of 8 while Home's
 * plateau card asked for 3 × 7 (#bugs 2026-10-08).
 */
export function resolveMissedRepsTarget(input: MissedRepsInput): MissedRepsResolution | null {
  const { history, repsMin, targetSets, trackingMode } = input;
  if (!input.automatedProgressionEnabled || !(repsMin > 0) || !(targetSets > 0)) {
    return null;
  }
  if (isUnloadedMode(trackingMode) && readStoredTrackingMode(trackingMode) !== 'bodyweight') {
    return null;
  }
  // The newest entry that logged something — the same reading the set
  // screen's prefill takes (selectLatestUsableEntry); an opened-and-abandoned
  // lift must not hide the short session before it.
  // One dated ahead of now by a wrong clock ranks below the real ones.
  const latest = sessionsOf(history, input.nowMs)[0];
  if (!latest || latest.skipped) {
    return null;
  }
  // Seven months after one short session the reader is not the one who did
  // 7/6/4/4, and lowering today's target on it is a guess dressed as a plan.
  if (typeof input.nowMs === 'number' && Number.isFinite(input.nowMs)) {
    const performedMs = Date.parse(latest.performedAt);
    if (!Number.isFinite(performedMs) || isStale(performedMs, input.nowMs)) {
      return null;
    }
  }
  // The sets the programme asks for — the first ones, as the entry is written
  // in the order they were done. A set added past them is extra work: a tired
  // fifth set at 3 reps is not a reason to lower a 12/12/12/12 session, nor to
  // hold back a target every programmed set met (review of #202).
  const reps = latest.sets
    .map((set) => set.reps)
    .filter((count) => Number.isFinite(count) && count > 0)
    .slice(0, targetSets);
  if (reps.length === 0) {
    return null;
  }
  const average = reps.reduce((sum, count) => sum + count, 0) / reps.length;
  const given = givenTarget(latest, repsMin);

  // The floor met — whatever target was given — and the ordinary progression
  // takes over. Checked first: a stored 6 under a 12/12/12/12 session asked
  // for 8 (PR review, 2026-09-28).
  if (average >= repsMin) {
    return null;
  }
  const averageTarget = Math.max(1, Math.ceil(average - 1e-9));

  // A target was given last time and every set reached it: one rep more, two
  // when every set went past it — never below what the sets just averaged, so
  // 10/10/10/10 on a target of 6 does not come back as 8.
  // "Every set" means every set the programme asks for, and fewer than that
  // did not meet it.
  if (given !== null && reps.length >= setsNeeded(latest, targetSets) && reps.every((count) => count >= given)) {
    const mayClimb = !input.cautionArea;
    const climbed = given + (reps.every((count) => count > given) ? 2 : 1);
    const next = Math.max(mayClimb ? climbed : given, averageTarget);
    return next >= repsMin ? null : { targetReps: next, fromAverage: null };
  }

  const target = averageTarget;
  return target >= repsMin ? null : { targetReps: target, fromAverage: Math.round(average * 100) / 100 };
}

export interface RampSetTargetInput {
  /** The session the set reads from: the slot's own latest, or a borrowed one. */
  entry: WorkoutSlotHistoryEntry | null | undefined;
  setIndex: number;
  /** The programme's rep ceiling: the top set's +1 stops there. */
  repsMax: number;
  /**
   * The programme's rep floor, which a lowered target is read against. Absent,
   * any target filed on the entry counts: one is filed only below the floor.
   */
  repsMin?: number;
  trackingMode?: string;
  automatedProgressionEnabled: boolean;
  /** As for the missed-reps target: a session older than 90 days says nothing about today. */
  nowMs?: number;
  /** A flagged area this lift loads: its dose does not climb on its own. */
  cautionArea?: SetupCautionArea | null;
  /** Recovery says not today: the top set repeats rather than adds. */
  fatigueSignal?: ProgressionFatigueSignal;
}

/**
 * A rep target set by set, for a session that climbed in weight.
 *
 * The missed-reps rule averages a session's sets, which reads a straight
 * 60×6/6/6 well and a ramp badly: 40×10, 50×8, 60×5 averaged to about 7.7
 * and set every set's target off warm-ups. A ramp is common enough to have its
 * own rule (user 2026-10-01, option A): each set repeats its own reps from
 * last time, and the heaviest — the one that is the work — asks for one more,
 * up to the programme's ceiling. 40×10, 50×8, 60×5 opens as 10, 8, 6. Once
 * the heaviest is at the ceiling, the lighter sets below it ask one more, so
 * the session can reach what the load gate waits for. The weights are not
 * touched; each set keeps the load it already prefills.
 *
 * Null when the session did not climb (one weight throughout: the
 * missed-reps rule answers that), or when there is nothing to read.
 */
export function resolveRampSetTarget(input: RampSetTargetInput): number | null {
  const { entry, setIndex, repsMax, trackingMode } = input;
  if (!input.automatedProgressionEnabled || !entry || entry.skipped) {
    return null;
  }
  if (isUnloadedMode(trackingMode)) {
    return null;
  }
  if (typeof input.nowMs === 'number' && Number.isFinite(input.nowMs)) {
    const performedMs = Date.parse(entry.performedAt);
    if (!Number.isFinite(performedMs) || isStale(performedMs, input.nowMs)) {
      return null;
    }
  }
  // A session given a lowered target was prescribed flat: one weight, a
  // target under the floor. A set the reader moved off that weight is their
  // adjustment, not a ramp, and the missed-reps rule — the one that reads the
  // target given — answers: 60/60/62.5 at a given 6 opened 6/6/7 rather than
  // 7/7/7 (hunt, 2026-10-11).
  const floorForGiven = typeof input.repsMin === 'number' && input.repsMin > 0 ? input.repsMin : Number.POSITIVE_INFINITY;
  if (givenTarget(entry, floorForGiven) !== null) {
    return null;
  }
  const done = entry.sets.filter((set) => set.reps > 0 && Number.isFinite(set.loadKg) && set.loadKg > 0);
  if (done.length < 2) {
    return null;
  }
  const top = Math.max(...done.map((set) => set.loadKg));
  const bottom = Math.min(...done.map((set) => set.loadKg));
  if (top - bottom < 0.001) {
    return null;
  }
  // The set that sat in this position last time — the same lookup the weight
  // prefill uses, so the reps and the load describe one set.
  const own = entry.sets.find((set) => set.setIndex === setIndex) ?? entry.sets[setIndex] ?? null;
  if (!own || !(own.reps > 0)) {
    return null;
  }
  // The +1 is a progression like any other: never on a lift that loads a
  // flagged area (onboarding's promise), and not on a day recovery holds.
  const mayAdd =
    !input.cautionArea && input.fatigueSignal !== 'high' && input.fatigueSignal !== 'elevated';
  if (!mayAdd || own.reps >= repsMax) {
    // Never past the ceiling: 14/14/14 on 8-12 asked for 14 again at the
    // raised load, where the same reps on straight sets open on 12 (hunt,
    // 2026-10-11).
    return repsMax > 0 ? Math.min(own.reps, repsMax) : own.reps;
  }
  const atTop = (set: { loadKg: number }) => Math.abs(set.loadKg - top) < 0.001;
  if (atTop(own)) {
    return own.reps + REP_INCREMENT;
  }
  // The top set at the ceiling, the lighter sets the load gate reads (every
  // one before the last heaviest, lib/warmupSets gatingSets) climb next. They
  // repeated their own reps for good, and the gate wants every one of them at
  // the ceiling before the weight moves: 40 × 10, 50 × 8, 60 × 12 opened on
  // the same numbers session after session and the load never went up (bug
  // hunt, 2026-10-09). A back-off after the heaviest is exempt, and repeats.
  const topDone = done.filter(atTop).every((set) => set.reps >= repsMax);
  if (topDone && gatingSets(entry.sets).includes(own)) {
    return own.reps + REP_INCREMENT;
  }
  return own.reps;
}
