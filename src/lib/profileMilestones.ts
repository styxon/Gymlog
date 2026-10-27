import { LifetimeTrainingSummary } from './lifetimeSummary';
import { UnitPreference } from '../types/models';

/**
 * The Profile's NEXT MILESTONE rows (design: "Vinha Profile — Training
 * planin tilalle", frame A; user 2026-09-02) and, behind them, the whole
 * ladder every row is one rung of (user 2026-09-03: "tarpeeksi monta että
 * riittää pitkälle, helppo, keskivaikea, vaikea").
 *
 * Twelve families, each a ladder of round numbers the reader climbs by
 * training. Every rung is derived from what is already in the log — no new
 * storage, no new query. A rung is reached the moment the figure passes it,
 * and the family's next rung takes its place on the card; the reached ones
 * are kept on their own page with the day they fell. The copy is
 * descriptive, never promissory: the numbers are what the reader did,
 * phrased as a distance.
 *
 * Tiers are a coarse read of how far into a family a rung sits. They are
 * labels for the page, not a mechanic: nothing unlocks, nothing is hidden.
 */
export type MilestoneFamily =
  | 'volume'
  | 'sessions'
  | 'streak'
  | 'records'
  | 'weeks'
  | 'reps'
  | 'sets'
  | 'exercises'
  | 'hours'
  | 'bodyweight'
  | 'cardio'
  | 'distance';

export type MilestoneTier = 'easy' | 'medium' | 'hard';

export const MILESTONE_FAMILIES: readonly MilestoneFamily[] = [
  'volume',
  'sessions',
  'streak',
  'records',
  'weeks',
  'reps',
  'sets',
  'exercises',
  'hours',
  'bodyweight',
  'cardio',
  'distance',
];

export interface ProfileMilestone {
  family: MilestoneFamily;
  /** The rung being approached, in the family's own unit. */
  target: number;
  /** What the reader has, in the same unit. */
  current: number;
  /** 0–1, never above 1. */
  progress: number;
  /** Rounded up, at least 1 — a hit rung has already advanced to the next. */
  remaining: number;
  tier: MilestoneTier;
}

/**
 * Totals the lifetime summary does not carry. Every one is optional so the
 * card can be built from the summary alone; a family with no figure sits at
 * zero and never outranks one with data.
 */
export interface MilestoneTotals {
  reps: number;
  sets: number;
  exercises: number;
  /** Training time in hours, from the sessions' stored durations. */
  hours: number;
  bodyweight: number;
  cardio: number;
  /** Cardio distance in kilometres. */
  distance: number;
}

interface ProfileMilestoneInput {
  lifetime: Pick<LifetimeTrainingSummary, 'sessionCount' | 'totalVolumeKg' | 'currentWeekStreak' | 'weeksActive'> &
    Partial<Pick<LifetimeTrainingSummary, 'bestWeekStreak'>>;
  recordCount: number;
  unitPreference: UnitPreference;
  totals?: Partial<MilestoneTotals>;
}

/**
 * The ladders. Dense at the bottom so the first weeks keep producing rungs,
 * sparse at the top so the last ones take years. `easyUpTo` and `mediumUpTo`
 * split each ladder into its three tiers.
 */
interface Ladder {
  rungs: readonly number[];
  easyUpTo: number;
  mediumUpTo: number;
}

const VOLUME_RUNGS_KG = [
  1000, 2500, 5000, 10000, 15000, 20000, 25000, 50000, 75000, 100000, 150000, 250000, 500000, 750000, 1000000,
] as const;
export const VOLUME_RUNGS_LB = [
  2500, 5000, 10000, 25000, 40000, 50000, 60000, 100000, 150000, 250000, 300000, 500000, 1000000, 1500000, 2000000,
] as const;
export const SESSION_RUNGS = [1, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 365, 500, 750, 1000] as const;
const STREAK_RUNGS = [2, 3, 4, 6, 8, 10, 12, 16, 20, 26, 39, 52, 78, 104] as const;
const RECORD_RUNGS = [1, 3, 5, 10, 15, 20, 25, 40, 50, 75, 100, 150, 200] as const;
const WEEK_RUNGS = [4, 8, 12, 20, 26, 40, 52, 78, 104, 156, 208] as const;
const REP_RUNGS = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000] as const;
const SET_RUNGS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000] as const;
const EXERCISE_RUNGS = [5, 10, 15, 20, 30, 40, 50, 75, 100] as const;
const HOUR_RUNGS = [1, 5, 10, 25, 50, 100, 250, 500, 1000] as const;
const BODYWEIGHT_RUNGS = [1, 5, 10, 25, 50, 100, 200, 365] as const;
const CARDIO_RUNGS = [1, 5, 10, 25, 50, 100, 200, 365] as const;
const DISTANCE_RUNGS = [5, 10, 25, 50, 100, 250, 500, 1000, 2000] as const;

const LADDERS: Record<Exclude<MilestoneFamily, 'volume'>, Ladder> = {
  sessions: { rungs: SESSION_RUNGS, easyUpTo: 10, mediumUpTo: 100 },
  streak: { rungs: STREAK_RUNGS, easyUpTo: 4, mediumUpTo: 12 },
  records: { rungs: RECORD_RUNGS, easyUpTo: 5, mediumUpTo: 25 },
  weeks: { rungs: WEEK_RUNGS, easyUpTo: 8, mediumUpTo: 26 },
  reps: { rungs: REP_RUNGS, easyUpTo: 2500, mediumUpTo: 25000 },
  sets: { rungs: SET_RUNGS, easyUpTo: 250, mediumUpTo: 2500 },
  exercises: { rungs: EXERCISE_RUNGS, easyUpTo: 15, mediumUpTo: 40 },
  hours: { rungs: HOUR_RUNGS, easyUpTo: 5, mediumUpTo: 50 },
  bodyweight: { rungs: BODYWEIGHT_RUNGS, easyUpTo: 5, mediumUpTo: 25 },
  cardio: { rungs: CARDIO_RUNGS, easyUpTo: 5, mediumUpTo: 50 },
  distance: { rungs: DISTANCE_RUNGS, easyUpTo: 10, mediumUpTo: 100 },
};

const VOLUME_LADDER: Record<UnitPreference, Ladder> = {
  kg: { rungs: VOLUME_RUNGS_KG, easyUpTo: 5000, mediumUpTo: 50000 },
  lb: { rungs: VOLUME_RUNGS_LB, easyUpTo: 10000, mediumUpTo: 100000 },
};

export function ladderFor(family: MilestoneFamily, unitPreference: UnitPreference): Ladder {
  return family === 'volume' ? VOLUME_LADDER[unitPreference] : LADDERS[family];
}

export function tierFor(family: MilestoneFamily, target: number, unitPreference: UnitPreference): MilestoneTier {
  const ladder = ladderFor(family, unitPreference);
  if (target <= ladder.easyUpTo) {
    return 'easy';
  }
  return target <= ladder.mediumUpTo ? 'medium' : 'hard';
}

/** Every rung of every family, in the reader's unit — the size of the whole ladder. */
export function countAllMilestones(unitPreference: UnitPreference): number {
  return MILESTONE_FAMILIES.reduce((total, family) => total + ladderFor(family, unitPreference).rungs.length, 0);
}

export const MAX_PROFILE_MILESTONES = 3;

const KG_PER_LB = 0.45359237;

/** The first rung the value has not reached; null once every rung is passed. */
function nextRung(value: number, rungs: readonly number[]): number | null {
  return rungs.find((rung) => value < rung) ?? null;
}

function safeNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * `reachedUpTo` is the figure the rungs are measured against when it differs
 * from `current`: a streak is counted from now, but a rung the reader's best
 * run already passed is not ahead of them — the next one is the first above
 * the best, and the distance is from the run that is alive.
 */
function milestone(
  family: MilestoneFamily,
  current: number,
  unitPreference: UnitPreference,
  reachedUpTo: number = current,
): ProfileMilestone | null {
  const safe = safeNumber(current);
  const ladder = ladderFor(family, unitPreference);
  const target = nextRung(Math.max(safe, safeNumber(reachedUpTo)), ladder.rungs);
  if (target === null) {
    return null;
  }
  return {
    family,
    target,
    current: safe,
    progress: Math.min(1, safe / target),
    // Integer families count down in whole steps; hours and kilometres are
    // read to a tenth, so their distance is not rounded up to a whole unit.
    remaining: hasFraction(family) ? Math.max(0.1, ceilTenths(target - safe)) : Math.max(1, Math.ceil(target - safe)),
    tier: tierFor(family, target, unitPreference),
  };
}

/**
 * Round up to a tenth without the float noise: (5 - 4.8) * 10 is
 * 2.0000000000000018, and a bare ceil of that says 0.3 h to go. Rounding to
 * thousandths first settles the noise before the ceil reads it.
 */
function ceilTenths(value: number): number {
  return Math.ceil(Math.round(value * 1000) / 100) / 10;
}

/** Families whose figure is read to one decimal. */
function hasFraction(family: MilestoneFamily): boolean {
  return family === 'hours' || family === 'distance';
}

/**
 * Volume is measured in the reader's unit: the rungs are the round numbers
 * of that unit, and the current figure is converted to it, so "994 kg of
 * 1 000 kg" and "2 190 lb of 2 500 lb" are both a distance in the unit the
 * reader lifts in.
 */
export function volumeInUnit(totalVolumeKg: number, unitPreference: UnitPreference): number {
  const kg = safeNumber(totalVolumeKg);
  return unitPreference === 'lb' ? kg / KG_PER_LB : kg;
}

/** The current figure of every family, from the summary and the extra totals. */
function currentFigures(input: ProfileMilestoneInput): Record<MilestoneFamily, number> {
  const totals = input.totals ?? {};
  return {
    volume: volumeInUnit(input.lifetime.totalVolumeKg, input.unitPreference),
    sessions: safeNumber(input.lifetime.sessionCount),
    streak: safeNumber(input.lifetime.currentWeekStreak),
    records: safeNumber(input.recordCount),
    weeks: safeNumber(input.lifetime.weeksActive),
    reps: safeNumber(totals.reps),
    sets: safeNumber(totals.sets),
    exercises: safeNumber(totals.exercises),
    hours: safeNumber(totals.hours),
    bodyweight: safeNumber(totals.bodyweight),
    cardio: safeNumber(totals.cardio),
    distance: safeNumber(totals.distance),
  };
}

/** Each family's next rung, nearest first — the whole ladder's front row. */
export function buildUpcomingMilestones(input: ProfileMilestoneInput): ProfileMilestone[] {
  const figures = currentFigures(input);
  const bestStreak = safeNumber(input.lifetime.bestWeekStreak);
  return MILESTONE_FAMILIES.map((family) =>
    milestone(family, figures[family], input.unitPreference, family === 'streak' ? bestStreak : undefined),
  )
    .filter((item): item is ProfileMilestone => item !== null)
    // Nearest first; a tie keeps the family order above, which is the order
    // a reader is likeliest to care about them.
    .map((item, index) => ({ item, index }))
    .sort((left, right) => right.item.progress - left.item.progress || left.index - right.index)
    .map(({ item }) => item);
}

// buildProfileMilestones and hasMilestoneData lived here until the card
// started reading the ladder's own front row (2026-09-03). Both existed to
// serve a second path through the same log; the slice is now
// milestoneCardRows and the "has anything happened" question is the ledger's.
