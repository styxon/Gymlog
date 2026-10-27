/**
 * What the app remembers about warming up your own way.
 *
 * One number: how long the last one took. The free timer counts up because the
 * app does not know how long your warm-up takes, and that is the only figure
 * which makes an open-ended clock readable — 2:14 means nothing on its own and
 * quite a lot next to "last time you took 4:20".
 *
 * It also kept a count, which fed an offer to always skip the guided drills
 * after the third session run that way. The offer was removed on 2026-09-04
 * (user), and the count went with it: a stored number with no reader is the
 * next person's puzzle.
 */
import { t } from './i18n';
import { AppLanguage } from '../types/models';

export type OwnBlockPhase = 'warmup' | 'cooldown';

interface OwnBlockStat {
  /** Seconds the last self-run block took. */
  lastSeconds: number;
}

export type OwnBlockStats = Partial<Record<OwnBlockPhase, OwnBlockStat>>;

function normalizeStat(input: unknown): OwnBlockStat | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const record = input as Record<string, unknown>;
  const lastSeconds =
    typeof record.lastSeconds === 'number' && Number.isFinite(record.lastSeconds) && record.lastSeconds > 0
      ? Math.round(record.lastSeconds)
      : 0;
  // An install from before 2026-09-04 also stored a `count`; it is dropped
  // rather than carried, which is what removing the offer means.
  return lastSeconds === 0 ? null : { lastSeconds };
}

/**
 * Stored shape → a shape the screen can read.
 *
 * Every loader in this app normalizes, because the field it is reading was
 * written by a version of the app that no longer exists.
 */
export function normalizeOwnBlockStats(input: unknown): OwnBlockStats {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const record = input as Record<string, unknown>;
  const out: OwnBlockStats = {};
  (['warmup', 'cooldown'] as OwnBlockPhase[]).forEach((phase) => {
    const stat = normalizeStat(record[phase]);
    if (stat) {
      out[phase] = stat;
    }
  });
  return out;
}

/**
 * One finished self-run block, folded in.
 *
 * A block ended in under ten seconds is a mis-tap, not a warm-up, and must not
 * become the mark the next session is measured against.
 */
export function recordOwnBlock(stats: OwnBlockStats, phase: OwnBlockPhase, seconds: number): OwnBlockStats {
  if (!Number.isFinite(seconds) || seconds < 10) {
    return stats;
  }
  return { ...stats, [phase]: { lastSeconds: Math.round(seconds) } };
}

/** "Last time you took 4:20", or null the first time through. */
export function formatLastOwnBlock(
  stats: OwnBlockStats,
  phase: OwnBlockPhase,
  language: AppLanguage,
): string | null {
  const seconds = stats[phase]?.lastSeconds ?? 0;
  if (seconds <= 0) {
    return null;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return t(language, 'guided.own.lastTime', { clock: `${minutes}:${`${rest}`.padStart(2, '0')}` });
}
