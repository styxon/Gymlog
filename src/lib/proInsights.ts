import { cautionAreaLoadedBy } from './cautionExerciseFilter';
import { getRollingWindowStart } from './completedSessions';
import { FatigueResult } from './fatigueModel';
import { WorkoutSlotHistoryEntry } from '../features/workout/workoutTypes';
import { formatShortDate, formatWeight } from './format';
import { exerciseNameLabel } from './exerciseNameLabel';
import { t } from './i18n';
import { NO_NEXT_SESSION_ADVICE, type NextSessionAdvice } from './nextSessionAdvice';
import { PROGRESSION_LEVEL_PARAMS, getProgressionTier } from './progressionGate';
import {
  DEFAULT_HISTORY_WINDOW_DAYS,
  LiftHistory,
  normalizedName,
  sessionBestPoints,
  stalledRunPoints,
} from './trainingHistory';
import { AppLanguage, SetupCautionFlag, SetupLevel } from '../types/models';

/**
 * The paywall-moments layer (design: Vinha Paywall Moments).
 *
 * One rule at every touchpoint: THE FINDING IS FREE, THE CONCLUSION IS PRO.
 * Detections — a stalled lift, a traffic-light status — are computed here from
 * logged sets and shown to everyone. The conclusion (what to do about it) is
 * also computed here, deterministically, so the locked state can blur the REAL
 * text rather than a generic feature list, and a Pro user gets the same text
 * unblurred. Nothing in this file estimates, predicts long-term outcomes, or
 * states a number that is not in the log; the only forward-looking figure is
 * the next micro-progression step (latest + one increment), the same step the
 * progression gate itself would take.
 *
 * Everything is pure so tests can hold each sentence against the data.
 */

/** Same threshold the coach context uses: three sessions at one top set. */
export const PLATEAU_STALL_SESSIONS = 3;

export { sessionBestPoints };

/**
 * The lifts a finding about "now" may be made of: trained within the coach
 * context's window. A lift dropped with an old programme keeps its stall run
 * forever, and the longest run wins Home's card and a Weekly read slot over
 * the lift the reader is actually stuck on ("Your Leg Press hasn't moved in
 * 10 sessions", last trained nine months ago; bug hunt, 2026-10-09). The
 * histories themselves stay whole — the charts and records want all of them.
 */
export function recentLifts(lifts: LiftHistory[], now: number | Date): LiftHistory[] {
  const cutoff = getRollingWindowStart(now, DEFAULT_HISTORY_WINDOW_DAYS);
  return lifts.filter((lift) => lift.latest.time >= cutoff);
}

export interface PlateauDetection {
  liftKey: string;
  /** Localized display name of the lift. */
  liftLabel: string;
  /** e.g. "Your squat hasn't moved in 4 sessions." */
  headline: string;
  /** e.g. "82.5 kg × 5/5/5, 4 sessions running · 14 Jun – 26 Jul" */
  meta: string;
  stalledSessions: number;
  topSetKg: number;
}

export interface LockedConclusion {
  /** Short line on the lock, e.g. "One fix, from your own 4 sessions". */
  teaser: string;
  /**
   * The REAL conclusion, blurred for free users and readable for Pro.
   *
   * One sentence, not a list of visual lines. It used to be a string[] with
   * the line break authored into the copy, which meant every translation
   * inherited a break chosen for English width — and in Finnish two of the
   * four pairs split a genitive from its head noun.
   */
  body: string;
}

export interface ProMomentContent {
  /** Small caps eyebrow, e.g. the lift name. */
  eyebrow: string;
  title: string;
  lead: string;
  /** Real top sets, oldest first, at most 5. */
  bars: number[];
  /** The dashed next-step bar; null when no honest step exists. */
  nextValue: number | null;
  /**
   * The month-out bar. "Next session" alone shows one step; the pitch is the
   * direction, so the chart also carries where that pace lands in four weeks.
   * Null whenever nextValue is.
   */
  horizonValue: number | null;
  /** Sessions the horizon assumes, at this lift's own observed cadence. */
  horizonSessions: number;
  barLabel: string;
  bullets: string[];
}

export type ReadTone = 'green' | 'amber' | 'red';

export interface WeeklyReadRow {
  key: string;
  tone: ReadTone;
  name: string;
  status: string;
  meta: string;
  /** Normalized 0..1 series for the mini bars, oldest first, at most 5. */
  bars: number[];
  /** Present on the rows whose conclusion is worth paying for. */
  locked: LockedConclusion | null;
}

/** Whole weeks a lift's history spans, at least one: "in 1 week", never "in 0 weeks". */
function spanWeeks(lift: LiftHistory): number {
  return Math.max(1, Math.round(lift.spanDays / 7));
}

function lastBars(points: number[], count = 5): number[] {
  return points.slice(-count);
}

function normalizedBars(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) {
    return values.map(() => 0.82);
  }
  // Keep every bar visible: map the range onto 0.3..1.
  return values.map((value) => 0.3 + ((value - min) / (max - min)) * 0.7);
}

/**
 * The deterministic read of WHY a lift is stalled, from its own points.
 * "Your later sets fade every session" is a per-session claim, so it needs
 * per-session evidence: in most sessions of the stalled run (more than half,
 * sessions with at least two sets at the top weight) the last set got fewer
 * reps than the first. Session totals alone are not that — 6/6/7 then 6/6/6
 * is a lower total with no set fading (#bugs 2026-10-02). Otherwise the lift
 * is ready to earn the next step through reps. Both are statements about
 * logged sets only.
 */
function stallReason(lift: LiftHistory): 'recovery' | 'reps_hold' {
  const sessions = stalledRunPoints(lift).filter((point) => point.setReps.length >= 2);
  const fading = sessions.filter((point) => point.setReps[point.setReps.length - 1] < point.setReps[0]);
  return sessions.length >= 2 && fading.length * 2 > sessions.length ? 'recovery' : 'reps_hold';
}

/**
 * A lift that loads an area the reader flagged careful or avoid is held on
 * purpose: the progression gate never adds weight or reps there (onboarding's
 * promise). Its flat line is the plan working, so none of the stall surfaces —
 * the card, the in-workout reminder, the completion lock, the weekly stall row
 * — may call it stuck and tell the reader to move up.
 */
export function isLiftHeldForCaution(
  lift: LiftHistory,
  cautionFlags?: SetupCautionFlag[] | null,
): boolean {
  return cautionAreaLoadedBy(lift.name, cautionFlags) !== null;
}

/**
 * Is this lift, right now, the plateau the paywall moments would find?
 * Never one the plan holds on purpose, when the flags are given.
 */
export function isLiftPlateaued(lift: LiftHistory, cautionFlags?: SetupCautionFlag[] | null): boolean {
  return (
    lift.stalledSessions >= PLATEAU_STALL_SESSIONS &&
    lift.latest.topSetWeightKg > 0 &&
    !isLiftHeldForCaution(lift, cautionFlags)
  );
}

/**
 * Identifies one plateau RUN — this lift, stuck at this weight — rather than
 * the lift itself. A dismissal is keyed to this, so it stays put once the
 * lift moves to a new weight and stalls again there: that is a different
 * finding, not the one the reader already said "selvä" to (#bugs 2026-09-29).
 */
export function plateauEpisodeKey(lift: LiftHistory): string {
  return `${lift.key}::${lift.latest.topSetWeightKg}`;
}

/**
 * The single stalled lift Home leads with — the longest-running plateau,
 * ties broken by the heavier one — skipping any episode already dismissed.
 * Dismissing one lift's episode never hides another lift's: the set the
 * caller excludes is exactly the episodes it names, nothing wider.
 */
export function detectPlateau(
  lifts: LiftHistory[],
  dismissedEpisodeKeys?: ReadonlySet<string>,
  cautionFlags?: SetupCautionFlag[] | null,
): LiftHistory | null {
  let best: LiftHistory | null = null;
  for (const lift of lifts) {
    if (!isLiftPlateaued(lift, cautionFlags)) {
      continue;
    }
    if (dismissedEpisodeKeys?.has(plateauEpisodeKey(lift))) {
      continue;
    }
    if (
      !best ||
      lift.stalledSessions > best.stalledSessions ||
      (lift.stalledSessions === best.stalledSessions && lift.latest.topSetWeightKg > best.latest.topSetWeightKg)
    ) {
      best = lift;
    }
  }
  return best;
}

/**
 * The same detection, found by exercise name instead of picked as the single
 * best — for the in-workout reminder. Ignores any dismiss list on purpose:
 * putting Home's card away must not also silence the reminder the owner
 * asked for as the alternative (user 2026-09-29, "muistutus kun seuraavalla
 * kerralla on sumo"). Reuses buildPlateauDetection rather than a second rule.
 */
export function findPlateauDetection(
  lifts: LiftHistory[],
  exerciseName: string,
  language: AppLanguage,
  cautionFlags?: SetupCautionFlag[] | null,
): PlateauDetection | null {
  const key = normalizedName(exerciseName);
  const lift = lifts.find((candidate) => candidate.key === key && isLiftPlateaued(candidate, cautionFlags));
  return lift ? buildPlateauDetection(lift, language) : null;
}

/**
 * The latest session's reps set by set, "6/6/7" — not the best set alone.
 * "60 kg × 7" read as three sets of seven when the log said 6, 6, 7 (#bugs
 * 2026-10-01).
 */
function latestSetsLabel(lift: LiftHistory): string {
  const reps = lift.latest.setReps;
  return reps.length > 0 ? reps.join('/') : String(lift.latest.topSetReps);
}

/**
 * One rep more than the weakest set, on every set: from 6/6/7 the next step
 * is 7/7/7, not 8/8/8. Top set + 1 asked for two reps more on two of three
 * sets (#bugs 2026-10-01).
 */
function nextRepsTarget(lift: LiftHistory): number {
  const reps = lift.latest.setReps;
  return (reps.length > 0 ? Math.min(...reps) : lift.latest.topSetReps) + 1;
}

export function buildPlateauDetection(lift: LiftHistory, language: AppLanguage): PlateauDetection {
  const liftLabel = exerciseNameLabel(language, lift.name);
  const stalledPoints = stalledRunPoints(lift);
  const from = stalledPoints[0]?.performedAt ?? lift.first.performedAt;
  return {
    liftKey: lift.key,
    liftLabel,
    headline: t(language, 'pro.plateau.headline', { lift: liftLabel, count: lift.stalledSessions }),
    meta: t(language, 'pro.plateau.meta', {
      weight: formatWeight(lift.latest.topSetWeightKg, 'kg'),
      reps: latestSetsLabel(lift),
      count: lift.stalledSessions,
      from: formatShortDate(from, language),
      to: formatShortDate(lift.latest.performedAt, language),
    }),
    stalledSessions: lift.stalledSessions,
    topSetKg: lift.latest.topSetWeightKg,
  };
}

export function buildPlateauConclusion(
  lift: LiftHistory,
  language: AppLanguage,
  level: SetupLevel | null | undefined,
): LockedConclusion {
  const weight = formatWeight(lift.latest.topSetWeightKg, 'kg');
  // The reps path says what to do next time, in the reader's own numbers:
  // this weight for one rep more than the weakest set, on every set, then
  // the next step up — the
  // same number the progression gate itself would take. It opened on "Your
  // reps are holding at this weight", which the card above had already said
  // ("Toistosi pitävät tällä painolla on aika huono", #bugs 2026-09-30), and
  // before that it named the stuck weight as the one to raise to (#bugs
  // 2026-09-29).
  const body =
    stallReason(lift) === 'recovery'
      ? t(language, 'pro.fix.recovery', { weight })
      : t(language, 'pro.fix.reps', {
          weight,
          reps: nextRepsTarget(lift),
          next: formatWeight(nextStepKg(lift, level), 'kg'),
        });
  return {
    teaser: t(language, 'pro.fix.teaser', { count: lift.stalledSessions }),
    body,
  };
}

/** The honest next step: latest top set + the user's own progression increment. */
export function nextStepKg(lift: LiftHistory, level: SetupLevel | null | undefined): number {
  const tier = getProgressionTier(level ?? null);
  return lift.latest.topSetWeightKg + PROGRESSION_LEVEL_PARAMS[tier].loadIncrementKg;
}

/** The window the far bar looks ahead to. Four weeks reads as "a month". */
export const HORIZON_DAYS = 28;
/**
 * How often one lift can plausibly come round: twice a week at the fastest,
 * once a fortnight at the slowest. A single odd gap in the log — a holiday, a
 * double session — must not stretch or squash the whole projection.
 */
const MIN_GAP_DAYS = 3.5;
const MAX_GAP_DAYS = 14;
const DEFAULT_GAP_DAYS = 7;

/** The typical gap between this lift's sessions, in days. Median, not mean. */
export function liftCadenceDays(lift: LiftHistory): number {
  const times = lift.points.map((point) => point.time).filter((time) => Number.isFinite(time));
  if (times.length < 2) {
    return DEFAULT_GAP_DAYS;
  }
  const gaps = times
    .slice(1)
    .map((time, index) => (time - times[index]) / 86_400_000)
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b);
  if (gaps.length === 0) {
    return DEFAULT_GAP_DAYS;
  }
  const middle = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 1 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
  return Math.min(MAX_GAP_DAYS, Math.max(MIN_GAP_DAYS, median));
}

/**
 * Where the current pace lands in four weeks: the same per-session step the
 * app's own progression applies, repeated for as many sessions as this lift
 * actually gets in that window.
 *
 * It is an estimate and the sheet says so — the step lands when the reps are
 * hit, not automatically. Stating the assumption is what keeps it honest.
 */
export function horizonStepKg(lift: LiftHistory, level: SetupLevel | null | undefined): { kg: number; sessions: number } {
  const tier = getProgressionTier(level ?? null);
  const increment = PROGRESSION_LEVEL_PARAMS[tier].loadIncrementKg;
  // At least two, so the far bar is never the same height as the next one.
  const sessions = Math.max(2, Math.round(HORIZON_DAYS / liftCadenceDays(lift)));
  return { kg: lift.latest.topSetWeightKg + increment * sessions, sessions };
}

export function buildPlateauMoment(
  lift: LiftHistory,
  language: AppLanguage,
  level: SetupLevel | null | undefined,
): ProMomentContent {
  const liftLabel = exerciseNameLabel(language, lift.name);
  const bars = lastBars(sessionBestPoints(lift).map((point) => point.topSetWeightKg));
  const horizon = horizonStepKg(lift, level);
  return {
    eyebrow: t(language, 'pro.sheet.plateau.eyebrow', { lift: liftLabel.toUpperCase() }),
    title: t(language, 'pro.sheet.plateau.title'),
    lead: t(language, 'pro.sheet.plateau.lead', { count: lift.stalledSessions }),
    bars,
    nextValue: nextStepKg(lift, level),
    horizonValue: horizon.kg,
    horizonSessions: horizon.sessions,
    barLabel: t(language, 'pro.sheet.plateau.barLabel', {
      lift: liftLabel.toUpperCase(),
      count: bars.length,
    }),
    bullets: [t(language, 'pro.sheet.bullet.why'), t(language, 'pro.sheet.bullet.loads')],
  };
}

export function buildNextSessionMoment(
  lift: LiftHistory,
  language: AppLanguage,
  level: SetupLevel | null | undefined,
  advice: NextSessionAdvice = NO_NEXT_SESSION_ADVICE,
): ProMomentContent {
  const liftLabel = exerciseNameLabel(language, lift.name);
  const bars = lastBars(sessionBestPoints(lift).map((point) => point.topSetWeightKg));
  const climbed = lift.weightChangeKg > 0;
  const horizon = horizonStepKg(lift, level);
  const weeks = spanWeeks(lift);
  return {
    eyebrow: t(language, 'pro.sheet.next.eyebrow'),
    title: t(language, 'pro.sheet.next.title'),
    lead: climbed
      ? t(language, weeks === 1 ? 'pro.sheet.next.leadClimbOne' : 'pro.sheet.next.leadClimb', {
          lift: liftLabel,
          from: formatWeight(lift.first.topSetWeightKg, 'kg'),
          to: formatWeight(lift.latest.topSetWeightKg, 'kg'),
          weeks,
        })
      : t(language, 'pro.sheet.next.leadFlat', { lift: liftLabel, count: sessionBestPoints(lift).length }),
    bars,
    // What the gate says the next session opens on: the step up when it earned
    // one, this weight while the reps are rebuilt, and no bar when it says
    // neither (a break, a first session at a weight, a workout with no programme).
    nextValue: advice.kind === 'raise' ? advice.toKg : advice.kind === 'rebuild_reps' ? advice.kg : null,
    horizonValue: advice.kind === 'raise' ? horizon.kg : null,
    horizonSessions: horizon.sessions,
    barLabel: t(language, 'pro.sheet.next.barLabel', {
      lift: liftLabel.toUpperCase(),
      count: bars.length,
    }),
    bullets: [t(language, 'pro.sheet.bullet.adaptive'), t(language, 'pro.sheet.bullet.plateau')],
  };
}

/**
 * The post-session locked insight: the session's most-trained lift with enough
 * history to say something about the next session. Null when nothing honest
 * can be said (fresh users see no lock at all).
 *
 * Given a `sessionId` (null counts as one that matches nothing), only a lift
 * logged in THAT session qualifies: after a leg day with no bench the lock
 * named the bench, the all-time most-logged lift (bug hunt, 2026-10-09). A
 * session with no such lift gets no lock rather than one about a lift the
 * reader did not just train. Left out, any lift qualifies.
 */
export function pickCompletionLift(
  lifts: LiftHistory[],
  cautionFlags?: SetupCautionFlag[] | null,
  sessionId?: string | null,
): LiftHistory | null {
  // A held lift has no next weight to offer: the lock names the next
  // lift in line instead.
  const candidates = lifts.filter(
    (lift) =>
      sessionBestPoints(lift).length >= 2 &&
      lift.latest.topSetWeightKg > 0 &&
      !isLiftHeldForCaution(lift, cautionFlags) &&
      (sessionId === undefined || lift.points.some((point) => point.sessionId === sessionId)),
  );
  return candidates[0] ?? null;
}

export function buildCompletionConclusion(
  lift: LiftHistory,
  language: AppLanguage,
  level: SetupLevel | null | undefined,
  advice: NextSessionAdvice = NO_NEXT_SESSION_ADVICE,
): LockedConclusion | null {
  const liftLabel = exerciseNameLabel(language, lift.name);
  if (lift.stalledSessions >= PLATEAU_STALL_SESSIONS) {
    return buildPlateauConclusion(lift, language, level);
  }
  // The gate's answer for the next session (nextSessionAdvice), not a step added
  // to the top set: a raise only where the gate raises, the reps first where
  // they fell. Where the gate has no change for the next session there is no
  // lock at all: the teaser promises "one change for next time".
  if (advice.kind === 'none') {
    return null;
  }
  if (advice.kind === 'raise') {
    return {
      teaser: t(language, 'pro.completion.teaser'),
      body: t(language, 'pro.completion.body', { lift: liftLabel, weight: formatWeight(advice.toKg, 'kg') }),
    };
  }
  return {
    teaser: t(language, 'pro.completion.teaser'),
    body: t(language, 'analysis.next.recover', { lift: liftLabel }),
  };
}

/**
 * The Progress tab's traffic lights. Statuses are free — always. The locked
 * conclusion appears only where there is one worth paying for.
 */
export function buildWeeklyRead(
  lifts: LiftHistory[],
  fatigue: FatigueResult | null,
  language: AppLanguage,
  level: SetupLevel | null | undefined,
  cautionFlags?: SetupCautionFlag[] | null,
): WeeklyReadRow[] {
  const rows: WeeklyReadRow[] = [];

  for (const lift of lifts.slice(0, 2)) {
    if (sessionBestPoints(lift).length < 3) {
      continue;
    }
    const bars = normalizedBars(lastBars(sessionBestPoints(lift).map((point) => point.topSetWeightKg)));
    const name = exerciseNameLabel(language, lift.name);
    // A lift held for a flagged area is not "stalled" and gets no "move up"
    // fix; its status is still read from the weights, as for any other lift.
    const held = isLiftHeldForCaution(lift, cautionFlags);
    if (!held && lift.stalledSessions >= PLATEAU_STALL_SESSIONS) {
      rows.push({
        key: lift.key,
        tone: 'amber',
        name,
        status: t(language, 'pro.read.stalled'),
        meta: t(language, 'pro.read.stalledMeta', { count: lift.stalledSessions }),
        bars,
        locked: buildPlateauConclusion(lift, language, level),
      });
    } else if (lift.weightChangeKg > 0) {
      rows.push({
        key: lift.key,
        tone: 'green',
        name,
        status: t(language, 'pro.read.improving'),
        meta: t(language, spanWeeks(lift) === 1 ? 'pro.read.improvingMetaOne' : 'pro.read.improvingMeta', {
          change: formatWeight(lift.weightChangeKg, 'kg'),
          weeks: spanWeeks(lift),
        }),
        bars,
        locked: null,
      });
    } else if (lift.weightChangeKg < 0) {
      rows.push({
        key: lift.key,
        tone: 'red',
        name,
        status: t(language, 'pro.read.declining'),
        meta: t(language, 'pro.read.decliningMeta', {
          change: formatWeight(Math.abs(lift.weightChangeKg), 'kg'),
        }),
        bars,
        locked: held ? null : buildPlateauConclusion(lift, language, level),
      });
    } else {
      rows.push({
        key: lift.key,
        tone: 'green',
        name,
        status: t(language, 'pro.read.steady'),
        meta: t(language, 'pro.read.steadyMeta', { count: sessionBestPoints(lift).length }),
        bars,
        locked: null,
      });
    }
  }

  // The recovery row only exists when the fatigue model has enough history to
  // be confident — an invented recovery status would break the honesty rule.
  if (fatigue?.confident) {
    const tone: ReadTone = fatigue.signal === 'high' ? 'red' : fatigue.signal === 'elevated' ? 'amber' : 'green';
    rows.push({
      key: 'recovery',
      tone,
      name: t(language, 'pro.read.recovery'),
      status:
        tone === 'red'
          ? t(language, 'pro.read.recoveryLow')
          : tone === 'amber'
            ? t(language, 'pro.read.recoveryElevated')
            : t(language, 'pro.read.recoveryOk'),
      meta: t(language, fatigue.sessionCount7d === 1 ? 'pro.read.recoveryMetaOne' : 'pro.read.recoveryMeta', {
        count: fatigue.sessionCount7d,
      }),
      bars: normalizedBars([fatigue.recoveryScore]),
      locked:
        tone === 'green'
          ? null
          : {
              teaser: t(language, 'pro.read.recoveryTeaser'),
              body: t(
                language,
                fatigue.sessionCount7d === 1 ? 'pro.read.recoveryBodyOne' : 'pro.read.recoveryBody',
                { count: fatigue.sessionCount7d },
              ),
            },
    });
  }

  return rows;
}
