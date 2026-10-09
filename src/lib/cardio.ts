/**
 * Cardio v1 domain logic (Home → Cardio list → player → finish).
 *
 * Offline-first and timer-based: no GPS, distance is optional manual entry at
 * the finish screen, and avg pace is always derived — never stored. The live
 * session itself is a pair of timestamps + accumulated milliseconds so the
 * clock survives backgrounding and app kills.
 */

import { CardioActivityType, CardioFeel, CardioSession } from '../types/models';
import { getCalendarWeekStartTimestamp } from './completedSessions';
import { removeTrailingZeros } from './format';

export type CardioIconKind = 'run' | 'walk' | 'treadmill' | 'cycle' | 'row';

export interface CardioActivity {
  id: CardioActivityType;
  name: string;
  /** Uppercase chip label; null hides the chip ("NO EQUIPMENT" is shown). */
  equipmentLabel: string;
  icon: CardioIconKind;
}

/**
 * Every one of these used to begin "Free" / "Vapaa" — a word that carried no
 * information, because all six were free. It cost four characters at the front
 * of every label, and the word that says WHICH activity arrived fourth: "Vapaa
 * kävely matolla" clipped to "Vapaa kävely ma…" in the player and the finish
 * line, so the reader watched the walking disappear (#bugs 2026-08-26).
 */
export const CARDIO_ACTIVITIES: CardioActivity[] = [
  { id: 'run', name: 'Run', equipmentLabel: 'No equipment', icon: 'run' },
  { id: 'tread-run', name: 'Treadmill run', equipmentLabel: 'Treadmill', icon: 'treadmill' },
  { id: 'tread-walk', name: 'Treadmill walk', equipmentLabel: 'Treadmill', icon: 'walk' },
  { id: 'cycle-in', name: 'Indoor cycle', equipmentLabel: 'Exercise bike', icon: 'cycle' },
  { id: 'cycle-out', name: 'Outdoor cycle', equipmentLabel: 'Outdoor bike', icon: 'cycle' },
  { id: 'row', name: 'Row', equipmentLabel: 'Rower', icon: 'row' },
];

export function getCardioActivity(activityType: string): CardioActivity {
  return CARDIO_ACTIVITIES.find((activity) => activity.id === activityType) ?? CARDIO_ACTIVITIES[0];
}

export const CARDIO_FEEL_OPTIONS: Array<{ key: CardioFeel; label: string }> = [
  { key: 'easy', label: 'Easy' },
  { key: 'steady', label: 'Steady' },
  { key: 'hard', label: 'Hard' },
  { key: 'max', label: 'Max effort' },
];

/** MM:SS under an hour, H:MM:SS past it. */
export function formatCardioDuration(durationSec: number): string {
  const total = Math.max(0, Math.floor(durationSec));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Parses the manual distance input ("4.2" or "4,2") into km. Returns null for
 * empty/invalid/nonpositive/absurd values so the caller can skip saving it.
 */
export function parseCardioDistanceKm(input: string): number | null {
  const normalized = input.replace(',', '.').trim();
  if (!normalized) {
    return null;
  }
  // Digits and one decimal point: Number() would also read "1e2", "0x10" and "0b11".
  if (!/^\d*\.?\d*$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  // Rounded before the range check, so what is tested is what is saved:
  // "0,004" is no distance (0) and "999,999" is the 1000 that is refused.
  const rounded = Math.round(parsed * 100) / 100;
  if (rounded <= 0 || rounded >= 1000) {
    return null;
  }
  return rounded;
}

/**
 * Whether the distance field can be saved as it stands: empty (no distance),
 * or a distance. Text that is neither — "4,2,", "4..2", "1000" — used to save
 * the run with no distance at all, and the only sign was the pace line going
 * away (decimal audit, 2026-09-21).
 */
export function isCardioDistanceTextSavable(input: string): boolean {
  return !input.trim() || parseCardioDistanceKm(input) !== null;
}

/** Derived avg pace in seconds per km; null without a usable distance. */
export function getCardioAvgPaceSecPerKm(durationSec: number, distanceKm: number | null | undefined): number | null {
  if (!distanceKm || distanceKm <= 0 || durationSec <= 0) {
    return null;
  }
  return durationSec / distanceKm;
}

/** "5:50 /km" from seconds-per-km. */
export function formatCardioPace(paceSecPerKm: number): string {
  const total = Math.max(1, Math.round(paceSecPerKm));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} /km`;
}

/**
 * "4,2 km" for a Finnish reader, "4.2 km" for an English one. A template
 * literal always prints a point, so Finnish History read "4.2 km" beside
 * weights that all had their comma; the app's own decimal mark decides now.
 */
function formatDistanceKm(distanceKm: number): string {
  return `${removeTrailingZeros(Math.round(distanceKm * 100) / 100)} km`;
}

/**
 * History stats line: `24:31 · 4.2 km · 5:50 /km` with distance entered,
 * plain `24:31` without.
 */
export function buildCardioStatsLine(durationSec: number, distanceKm?: number | null): string {
  const duration = formatCardioDuration(durationSec);
  const pace = getCardioAvgPaceSecPerKm(durationSec, distanceKm ?? null);
  if (!distanceKm || pace === null) {
    return duration;
  }
  return `${duration} · ${formatDistanceKm(distanceKm)} · ${formatCardioPace(pace)}`;
}

/** Total cardio minutes in the current calendar week (Monday start). */
export function getWeekCardioMinutes(
  sessions: Array<Pick<CardioSession, 'performedAt' | 'durationSec'>>,
  now = new Date(),
): number {
  const weekStart = getCalendarWeekStartTimestamp(now);
  return getCardioMinutes(
    sessions.filter((session) => getCalendarWeekStartTimestamp(session.performedAt) === weekStart),
  );
}

/**
 * Whole minutes of cardio, rounded once over the total rather than per run,
 * so ten 90-second strides are 15 minutes and not 20.
 */
export function getCardioMinutes(sessions: Array<Pick<CardioSession, 'durationSec'>>): number {
  const totalSec = sessions.reduce(
    (sum, session) => sum + (Number.isFinite(session.durationSec) ? Math.max(0, session.durationSec) : 0),
    0,
  );
  return Math.round(totalSec / 60);
}

/**
 * Strength minutes plus the runs' minutes, the runs rounded once over their
 * total. The Progress month card rounded each run, so ten 90-second strides
 * added 20 minutes to the month's total and average, not 15 (bug hunt,
 * 2026-10-04).
 */
export function getCombinedActivityMinutes(
  strengthMinutes: number,
  cardioSessions: Array<Pick<CardioSession, 'durationSec'>>,
): number {
  return strengthMinutes + getCardioMinutes(cardioSessions);
}

/**
 * The stored run this save is, when it is already stored.
 *
 * The finish saves first and clears the live run with a write nobody awaits; when that write is
 * lost (a kill, a refused disk) the run comes back on the next launch and Complete saved it a
 * second time under a fresh id: one run, two rows, in every total (bug hunt 2026-10-03). A run is
 * named by when it started and what it was: the start is the live run's own millisecond stamp,
 * so two different runs cannot share one. Pure: the caller decides what to do with it.
 */
export function findSavedCardioRun<T extends Pick<CardioSession, 'activityType' | 'startedAt'>>(
  sessions: readonly T[],
  run: Pick<CardioSession, 'activityType' | 'startedAt'>,
): T | null {
  return sessions.find((session) => session.startedAt === run.startedAt && session.activityType === run.activityType) ?? null;
}

/**
 * The stored run, carried on: a run that was saved, whose clear was lost, came back paused and was
 * run further. The stored row takes the longer finish under its own id (one run, one row): the new
 * duration, end, distance and feel. Never shortened: an incoming run that is not longer is the
 * save landing again, or an older reading, and the stored row stays as it is. A distance or feel the
 * new finish left empty stays what was stored.
 */
export function mergeContinuedCardioRun(stored: CardioSession, incoming: CardioSession): CardioSession {
  // The time and the end move together, and only forward: a longer reading that ended after the stored
  // one. A pause lost together with the clear brought a saved run back running, the time the app was
  // dead on its clock; settleSavedCardioRun stops it where it was saved before anyone sees it, so a
  // longer reading here is a run that was carried on.
  const longer =
    incoming.durationSec > stored.durationSec &&
    Date.parse(incoming.performedAt) > Date.parse(stored.performedAt);
  // What the reader entered on this finish is theirs whether or not the time moved: a re-Complete of the
  // same length that now has a distance or a feel must keep them.
  const next: CardioSession = {
    ...stored,
    ...(longer ? { performedAt: incoming.performedAt, durationSec: incoming.durationSec } : {}),
    distanceKm: incoming.distanceKm ?? stored.distanceKm ?? null,
    feel: incoming.feel ?? stored.feel ?? null,
  };
  const changed =
    next.performedAt !== stored.performedAt ||
    next.durationSec !== stored.durationSec ||
    next.distanceKm !== (stored.distanceKm ?? null) ||
    next.feel !== (stored.feel ?? null);
  return changed ? next : stored;
}

/**
 * A saved run that came back running, stopped where it was saved; null when there is nothing to settle.
 *
 * Complete pauses the run, saves it, and clears it, and the pause and the clear are writes nobody
 * awaits. With both lost (a kill) the run came back running, its clock counting the hours the app was
 * dead, and a Complete then took that time into the stored row (8 h for a 30 min run; bug hunt
 * 2026-10-03). A run is saved only once it is paused, so one still running from before its save ended
 * (its stretch resumed at or before the save's end) is the lost pause: it is put back paused at the
 * saved time and end. One resumed after its save is the reader carrying on, and runs.
 */
export function settleSavedCardioRun(
  active: ActiveCardioSession | null,
  sessions: readonly CardioSession[],
): ActiveCardioSession | null {
  if (!active || !active.resumedAt) {
    return null;
  }
  const stored = findSavedCardioRun(sessions, active);
  if (!stored || !(Date.parse(active.resumedAt) <= Date.parse(stored.performedAt))) {
    return null;
  }
  return {
    ...active,
    accumulatedMs: Math.max(0, stored.durationSec) * 1000,
    resumedAt: null,
    pausedAt: stored.performedAt,
  };
}

/**
 * Live cardio session state. Elapsed time is derived from timestamps so it
 * survives backgrounding and process death: accumulatedMs counts finished
 * running stretches, resumedAt marks the current one (null = paused).
 */
export interface ActiveCardioSession {
  activityType: CardioActivityType;
  startedAt: string;
  accumulatedMs: number;
  resumedAt: string | null;
  /**
   * When the clock last stopped; null while it runs. Finishing pauses first,
   * so for a finished run this is when it ended — and that is the date the
   * saved row gets. It used to be dated when "Complete" was pressed, so a
   * run finished at 23:50 and saved the next morning landed on the wrong day.
   */
  pausedAt: string | null;
}

export function startCardioSession(activityType: CardioActivityType, nowMs: number): ActiveCardioSession {
  const iso = new Date(nowMs).toISOString();
  return { activityType, startedAt: iso, accumulatedMs: 0, resumedAt: iso, pausedAt: null };
}

export function getCardioElapsedMs(session: ActiveCardioSession, nowMs: number): number {
  const runningMs = session.resumedAt ? Math.max(0, nowMs - new Date(session.resumedAt).getTime()) : 0;
  return Math.max(0, session.accumulatedMs + runningMs);
}

export function pauseCardioSession(session: ActiveCardioSession, nowMs: number): ActiveCardioSession {
  if (!session.resumedAt) {
    return session;
  }
  return {
    ...session,
    accumulatedMs: getCardioElapsedMs(session, nowMs),
    resumedAt: null,
    pausedAt: new Date(nowMs).toISOString(),
  };
}

export function resumeCardioSession(session: ActiveCardioSession, nowMs: number): ActiveCardioSession {
  if (session.resumedAt) {
    return session;
  }
  return { ...session, resumedAt: new Date(nowMs).toISOString(), pausedAt: null };
}

/**
 * The moment a run ended, which is what its saved row is dated by.
 *
 * A stopped clock stopped at `pausedAt`, however long the finish screen then
 * sat open — or the app sat killed — before "Complete". A clock still running
 * ends now. A stored time that cannot be right (before the start, or after
 * now on a phone whose clock moved) falls back to now rather than dating the
 * run somewhere it never happened.
 */
export function getCardioEndedAt(session: ActiveCardioSession, nowMs: number): string {
  if (!session.resumedAt && session.pausedAt) {
    const pausedMs = new Date(session.pausedAt).getTime();
    const startedMs = new Date(session.startedAt).getTime();
    if (Number.isFinite(pausedMs) && pausedMs >= startedMs && pausedMs <= nowMs) {
      return new Date(pausedMs).toISOString();
    }
  }
  return new Date(nowMs).toISOString();
}

/** Normalizes a persisted active-cardio blob; null when unusable. */
export function normalizeActiveCardioSession(input: unknown): ActiveCardioSession | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.activityType !== 'string' || typeof raw.startedAt !== 'string') {
    return null;
  }
  if (Number.isNaN(new Date(raw.startedAt).getTime())) {
    return null;
  }
  const resumedAt =
    typeof raw.resumedAt === 'string' && !Number.isNaN(new Date(raw.resumedAt).getTime()) ? raw.resumedAt : null;
  const accumulatedMs =
    typeof raw.accumulatedMs === 'number' && Number.isFinite(raw.accumulatedMs) ? Math.max(0, raw.accumulatedMs) : 0;
  const storedPausedAt =
    typeof raw.pausedAt === 'string' && !Number.isNaN(new Date(raw.pausedAt).getTime()) ? raw.pausedAt : null;
  // A paused run saved before pausedAt existed has no record of when it
  // stopped. The earliest it can have stopped is its start plus the time it
  // ran, which is exact for a run paused once — and much nearer the truth
  // than "whenever Complete is pressed", which is what a null would mean.
  const pausedAt = resumedAt
    ? null
    : storedPausedAt ?? new Date(new Date(raw.startedAt).getTime() + accumulatedMs).toISOString();
  return {
    activityType: getCardioActivity(raw.activityType).id,
    startedAt: raw.startedAt,
    accumulatedMs,
    resumedAt,
    pausedAt,
  };
}
