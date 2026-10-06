/**
 * What moved this session (design: session flow, screen 10).
 *
 * The finish screen counted the session — minutes, sets, kilos — and listed
 * what was done. None of that is the reason somebody trains: the reason is
 * that a number went up, and the screen that should have said so said "4 sets
 * · 62,5 kg" and left the reader to remember last week themselves.
 *
 * Comparison is against the LAST session of that lift, not against its best
 * ever. "+2,5 kg" is a fact about this week; the all-time best is what the PR
 * pill is for, and the two answer different questions.
 */
import { formatWeight, removeTrailingZeros } from './format';
import { t } from './i18n';
import { AppLanguage, UnitPreference } from '../types/models';

export interface MovementLogLike {
  sessionId: string;
  exerciseNameSnapshot: string;
  weight: number;
  repsPerSet: number[];
  /** A skipped exercise did no work, whatever its rows say. */
  skipped?: boolean;
  sets?: Array<{ weight: number; reps: number; status?: string | null; kind?: string | null }>;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A log's heaviest DONE working set, from the per-set rows when it has them. A
 * pending or skipped row is a number typed, not a bar lifted: a 120 left
 * unticked beside a done 100 made the next 105 read "−15 kg" (audit
 * round 4, 2026-09-20).
 *
 * A warm-up is not the lift's top set either, and a skipped exercise has none
 * at all. A lift skipped after its warm-ups saved a log whose only done rows
 * were the 20 kg warm-ups; read as last time's top, the next session's 80 kg
 * said "+60 kg" and went up WHAT MOVED (bug hunt W4, 2026-10-05). Such a log
 * is no session of the lift, and the one before it is compared instead.
 *
 * A log with rows is read by its rows only: the flat `weight` is the legacy
 * pair, for a log saved before rows existed.
 */
function topOf(log: MovementLogLike): number {
  if (log.skipped) {
    return 0;
  }
  const sets = log.sets ?? [];
  if (sets.length > 0) {
    return sets
      .filter((set) => set.status !== 'pending' && set.status !== 'skipped' && set.kind !== 'warmup')
      .reduce((max, set) => Math.max(max, Number.isFinite(set.weight) ? set.weight : 0), 0);
  }
  return Number.isFinite(log.weight) ? log.weight : 0;
}

/**
 * Each lift's top set in the most recent session before this one.
 *
 * Keyed by the lift's name, lowercased: a lift the reader met in another
 * programme is still the same lift, and the comparison the finish screen makes
 * is about the movement, not about the slot it sat in.
 */
export function buildPreviousTopSets(input: {
  logs: ReadonlyArray<MovementLogLike>;
  /** sessionId → ISO performedAt, for ordering. */
  performedAtBySessionId: Record<string, string>;
  /** The session that just finished — its own logs are not its own history. */
  excludeSessionId: string;
}): Record<string, number> {
  const best: Record<string, { at: number; topKg: number }> = {};

  input.logs.forEach((log) => {
    if (log.sessionId === input.excludeSessionId) {
      return;
    }
    const performedAt = input.performedAtBySessionId[log.sessionId];
    if (!performedAt) {
      return;
    }
    const at = new Date(performedAt).getTime();
    if (!Number.isFinite(at)) {
      return;
    }
    const topKg = topOf(log);
    if (topKg <= 0) {
      return;
    }
    const key = normalizeName(log.exerciseNameSnapshot);
    const current = best[key];
    // The most recent session wins, and within one session the heaviest set.
    if (!current || at > current.at || (at === current.at && topKg > current.topKg)) {
      best[key] = { at, topKg };
    }
  });

  return Object.fromEntries(Object.entries(best).map(([key, value]) => [key, value.topKg]));
}

export type MovementKind = 'up' | 'down' | 'same' | 'new';

export interface MovementRow {
  exerciseName: string;
  /** Today's heaviest completed set. */
  todayTopKg: number;
  todayTopReps: number;
  /** Last session's top set for this lift; null the first time. */
  previousTopKg: number | null;
}

export interface Movement {
  exerciseName: string;
  kind: MovementKind;
  deltaKg: number;
  /** "+2,5 kg", "sama", or null when there is nothing to compare against. */
  label: string | null;
}

export function resolveMovement(
  row: MovementRow,
  language: AppLanguage,
  unitPreference: UnitPreference = 'kg',
): Movement {
  if (row.previousTopKg === null || row.previousTopKg <= 0 || row.todayTopKg <= 0) {
    return { exerciseName: row.exerciseName, kind: 'new', deltaKg: 0, label: null };
  }

  const deltaKg = Number((row.todayTopKg - row.previousTopKg).toFixed(2));
  if (Math.abs(deltaKg) < 0.001) {
    return {
      exerciseName: row.exerciseName,
      kind: 'same',
      deltaKg: 0,
      label: t(language, 'complete.moved.same'),
    };
  }

  return {
    exerciseName: row.exerciseName,
    kind: deltaKg > 0 ? 'up' : 'down',
    deltaKg,
    label: t(language, deltaKg > 0 ? 'complete.moved.up' : 'complete.moved.down', {
      weight: formatWeight(Math.abs(deltaKg), unitPreference),
    }),
  };
}

export interface WhatMovedRow {
  exerciseName: string;
  /** "+2,5 kg". */
  deltaLabel: string;
  /** "62,5 × 7 — next time aim for 8." */
  nudge: string;
}

/**
 * The lifts that went up, heaviest jump first.
 *
 * Only the ones that moved: a card headed WHAT MOVED listing a lift that did
 * not is the screen answering a question nobody asked. An empty list hides the
 * card, which is the honest state of a session that held everything steady.
 */
export function buildWhatMoved(
  rows: ReadonlyArray<MovementRow>,
  language: AppLanguage,
  unitPreference: UnitPreference = 'kg',
): WhatMovedRow[] {
  return rows
    .map((row) => ({ row, movement: resolveMovement(row, language, unitPreference) }))
    .filter((entry) => entry.movement.kind === 'up' && entry.movement.label !== null)
    .sort((a, b) => b.movement.deltaKg - a.movement.deltaKg)
    .map((entry) => ({
      exerciseName: entry.row.exerciseName,
      deltaLabel: entry.movement.label as string,
      nudge: t(language, 'complete.moved.nudge', {
        weight: removeTrailingZeros(entry.row.todayTopKg),
        reps: entry.row.todayTopReps,
        next: entry.row.todayTopReps + 1,
      }),
    }));
}
