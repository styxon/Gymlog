/**
 * Finding a lift's history by NAME, across every slot it has ever been done in.
 *
 * The workout history is keyed by slot — `<template>:<session>:<slot>` — which
 * is the right key for "what did you do here last time". It is the wrong key
 * for "have you ever done this lift". A back squat performed in another
 * program, on another day of the same program, or in an empty workout lives
 * under a different slot, so a new slot for the same lift opened at zero even
 * though the answer was sitting in the store. Every history entry already
 * records `exerciseName`, so nothing new has to be written to make this work —
 * only read differently.
 *
 * This is a lookup of something KNOWN, never an estimate. It answers "you have
 * lifted this before, here is what you lifted"; it does not answer "here is
 * what you could probably lift", which is a different question with a
 * different (and much weaker) basis.
 *
 * Which is exactly why the borrow is gated on the reps: a weight without the
 * reps it was lifted for is not the known thing, it is half of it. See
 * `entryMatchesRepWindow`.
 */

import { WorkoutSlotHistoryEntry, WorkoutSlotHistorySet } from '../features/workout/workoutTypes';

function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase();
}

function parseTime(iso: string): number {
  const value = Date.parse(iso);
  // An unparseable stamp sorts oldest rather than poisoning the comparison.
  return Number.isFinite(value) ? value : 0;
}

/**
 * Where an entry ranks for "the newest": its time, unless that time is still
 * ahead of now. A session saved while the phone's clock ran ahead was "last
 * time" until its date came round, over every real session after it — the
 * prefill and the card both opened on it for months (hunt, 2026-10-09). It
 * ranks below every session dated up to now instead, as the progression gate
 * already treats one (progressionGate, "Not in the future either"). Without a
 * now, the time alone.
 */
function rankTime(iso: string, nowMs: number | undefined): number {
  const time = parseTime(iso);
  return typeof nowMs === 'number' && Number.isFinite(nowMs) && time > nowMs ? -1 : time;
}

function heaviestLoadKg(entry: WorkoutSlotHistoryEntry): number {
  return entry.sets.reduce((max, set) => Math.max(max, set.loadKg), 0);
}

export interface NamedHistoryOptions {
  /**
   * Reject entries where every set was logged at 0 kg. For a loaded lift such
   * an entry is not a weight, it is the absence of one — and the app really
   * does produce them (the guided player used to hide the weight field
   * entirely, so sets went in at zero). Bodyweight work must NOT set this:
   * there, 0 kg is the honest answer.
   */
  requireLoaded?: boolean;
  /**
   * Only accept sessions run at reps close to this prescription. Null (the
   * default) accepts any, which is right for the slot's own history — this
   * gate is for weights borrowed from somewhere else. See
   * `entryMatchesRepWindow`.
   */
  repWindow?: RepWindow | null;
  /** The present, so an entry dated after it does not count as the newest. See rankTime. */
  nowMs?: number;
}

/**
 * The most recent non-skipped entry for this exercise name, from any slot.
 * Returns null when the lift has never been logged (or only emptily).
 */
export function findLatestEntryForExerciseName(
  slotHistory: Record<string, WorkoutSlotHistoryEntry[]>,
  exerciseName: string,
  options: NamedHistoryOptions = {},
): WorkoutSlotHistoryEntry | null {
  const target = normalizeExerciseName(exerciseName ?? '');
  if (!target) {
    return null;
  }

  let best: WorkoutSlotHistoryEntry | null = null;
  let bestTime = -Infinity;

  Object.values(slotHistory ?? {}).forEach((entries) => {
    (entries ?? []).forEach((entry) => {
      if (!entry || entry.skipped || entry.sets.length === 0) {
        return;
      }
      if (normalizeExerciseName(entry.exerciseName ?? '') !== target) {
        return;
      }
      if (options.requireLoaded && heaviestLoadKg(entry) <= 0) {
        return;
      }
      if (!entryMatchesRepWindow(entry, options.repWindow)) {
        return;
      }
      const time = rankTime(entry.performedAt, options.nowMs);
      if (time > bestTime) {
        best = entry;
        bestTime = time;
      }
    });
  });

  return best;
}

/**
 * The set to prefill from: the one that was logged at this index, else the
 * one that sat in this position. Shared so the slot-keyed and name-keyed
 * paths cannot disagree about which set of an entry answers for a set index.
 */
export function findHistoricalSetForIndex(
  entry: WorkoutSlotHistoryEntry | null | undefined,
  setIndex: number,
): WorkoutSlotHistorySet | null {
  if (!entry) {
    return null;
  }
  return entry.sets.find((item) => item.setIndex === setIndex) ?? entry.sets[setIndex] ?? null;
}

/**
 * The rep prescription a slot is asking for, used to decide whether a weight
 * lifted somewhere else answers for it.
 */
export interface RepWindow {
  min: number;
  max: number;
}

/**
 * How far outside the prescription a session may sit and still count as the
 * same kind of work.
 *
 * Two reps, because five reps is a heavy single-digit set and 6-8 is a heavy
 * range — the same load, differently written. Fifteen against 6-8 is not a
 * near miss, it is a different exercise for the same muscle, and that is the
 * gap this constant exists to refuse.
 */
const REP_WINDOW_TOLERANCE = 2;

/**
 * The reps this session was actually run at.
 *
 * Median, not the span: a heavy day with one long back-off set would otherwise
 * read as covering everything from 5 to 15 and answer for prescriptions it has
 * no business answering for.
 */
function typicalReps(entry: WorkoutSlotHistoryEntry): number | null {
  const reps = entry.sets
    .map((set) => set.reps)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (reps.length === 0) {
    return null;
  }
  const middle = Math.floor(reps.length / 2);
  return reps.length % 2 === 1 ? reps[middle] : (reps[middle - 1] + reps[middle]) / 2;
}

/**
 * Whether a session was run at reps close enough to this slot's prescription
 * that its load is a useful starting point here.
 *
 * The case this exists for, reported 2026-08-29: the same lift on two days of
 * one programme, 6-8 heavy on one and 15-20 on the other. The heavy day's
 * weight was carried onto the light day the first time it came round, because
 * the lookup matched on name alone. A weight is only an answer together with
 * the reps it was lifted for.
 */
export function entryMatchesRepWindow(
  entry: WorkoutSlotHistoryEntry,
  window: RepWindow | null | undefined,
): boolean {
  if (!window) {
    return true;
  }
  const low = Math.min(window.min, window.max);
  const high = Math.max(window.min, window.max);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= 0) {
    return true;
  }
  const reps = typicalReps(entry);
  // Nothing to compare against is not a mismatch — a session with no rep count
  // recorded is unusual, and refusing it would open the set at nothing.
  if (reps === null) {
    return true;
  }
  return reps >= low - REP_WINDOW_TOLERANCE && reps <= high + REP_WINDOW_TOLERANCE;
}

/**
 * A session that actually happened: not skipped, and with sets in it.
 *
 * Exported for the sheet's History tab, which lists a slot's entries: a
 * finished session writes one for every exercise in it, skipped ones
 * included, and those drew as dated rows with nothing in them (CI review
 * of #155).
 */
export function isUsableEntry(entry: WorkoutSlotHistoryEntry | null | undefined): boolean {
  return Boolean(entry) && !entry!.skipped && entry!.sets.length > 0;
}

/** How many sessions a slot keeps, newest first. */
export const SLOT_HISTORY_LIMIT = 10;

/**
 * A slot's entries, newest first, cut to the cap — without cutting away any
 * lift's last real session.
 *
 * The cap counted positions, and a skipped day takes a position like a real
 * one. A lift skipped ten times in a row on its day lost the session it was
 * last done in, and opened blank with no "Last time" although the database
 * still held it (hunt, 2026-10-09). So each lift's newest usable entry stays
 * past the cap until a newer one replaces it: the list holds at most one
 * extra entry per lift the slot has held.
 */
export function capSlotEntries(
  entries: readonly WorkoutSlotHistoryEntry[],
  limit: number = SLOT_HISTORY_LIMIT,
): WorkoutSlotHistoryEntry[] {
  const kept = entries.slice(0, limit);
  const answered = new Set(
    kept.filter(isUsableEntry).map((entry) => normalizeExerciseName(entry.exerciseName ?? '')),
  );
  entries.slice(limit).forEach((entry) => {
    const name = normalizeExerciseName(entry.exerciseName ?? '');
    if (isUsableEntry(entry) && !answered.has(name)) {
      kept.push(entry);
      answered.add(name);
    }
  });
  return kept;
}

/**
 * A slot's entries that were this lift.
 *
 * A slot keeps its id when the lift in it changes — swapped during a session,
 * swapped on Home before starting, or replaced in the programme — and every
 * entry is written under the slot. So trap bar deadlifts swapped for a leg
 * press at 200 kg opened the next trap bar session at 200 kg, and its "Last
 * time" card showed the leg press as its own. An entry names its lift; one
 * naming another lift is not this one's history. Entries with no name (very
 * old installs) cannot be told apart and are kept.
 */
export function entriesForLift(
  entries: readonly WorkoutSlotHistoryEntry[] | null | undefined,
  exerciseName: string | null | undefined,
): WorkoutSlotHistoryEntry[] {
  // The loader checks the store; this is also reached from state built in
  // memory, and a slot that is not a list must read as no history, not throw.
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const target = normalizeExerciseName(exerciseName ?? '');
  if (!target) {
    return [...list];
  }
  return list.filter((entry) => {
    const name = normalizeExerciseName(entry.exerciseName ?? '');
    return !name || name === target;
  });
}

/**
 * The newest session in a slot's own history that actually logged something.
 *
 * A skipped or empty entry is not a "last time" — it is a day this lift did
 * not happen.
 */
export function selectLatestUsableEntry(
  entries: readonly WorkoutSlotHistoryEntry[] | null | undefined,
  nowMs?: number,
): WorkoutSlotHistoryEntry | null {
  let best: WorkoutSlotHistoryEntry | null = null;
  let bestTime = -Infinity;
  (entries ?? []).forEach((entry) => {
    if (!isUsableEntry(entry)) {
      return;
    }
    const time = rankTime(entry.performedAt, nowMs);
    if (time > bestTime) {
      best = entry;
      bestTime = time;
    }
  });
  return best;
}

export interface LastTimeQuery {
  slotHistory: Record<string, WorkoutSlotHistoryEntry[]>;
  /** The scoped key this session writes under. */
  slotId: string;
  /** The unscoped key older installs wrote under. */
  templateSlotId?: string | null;
  exerciseName: string;
  /** See NamedHistoryOptions — loaded lifts reject all-zero sessions. */
  requireLoaded?: boolean;
  /** Null for lifts where the prescription does not gate the borrow. */
  repWindow?: RepWindow | null;
  /** The present: an entry dated after it is not the newest (rankTime). */
  nowMs?: number;
}

export interface ResolvedLastTime {
  entry: WorkoutSlotHistoryEntry;
  /**
   * True when it came from somewhere else — another day of this programme,
   * another programme, an empty workout — rather than from this slot's own
   * history. The screen has to be able to say so.
   */
  borrowed: boolean;
}

/**
 * ONE answer to "what did you do last time", for every part of the set screen
 * that asks it.
 *
 * The prefill and the "Last time" table used to resolve this separately: the
 * prefill fell back to the slot's unscoped key and then to a name lookup, the
 * table read the scoped key and stopped. On a lift's first outing in a new
 * slot that produced a screen saying both things at once — a table reading
 * "first time on this exercise" above a weight badged "LAST TIME · 27.8."
 * (#bugs 2026-08-29). Two readers of one fact is how they drift; there is one
 * reader now.
 */
export function resolveLastTimeEntry(query: LastTimeQuery): ResolvedLastTime | null {
  // The scoped key is this day's own history, and it is never gated: whatever
  // reps were done here last time, they were done HERE.
  // …as long as it was THIS lift. See entriesForLift.
  const scoped = selectLatestUsableEntry(
    entriesForLift(query.slotHistory?.[query.slotId], query.exerciseName),
    query.nowMs,
  );
  if (scoped) {
    return { entry: scoped, borrowed: false };
  }

  const legacy = selectLegacySlotEntry(
    query.slotHistory,
    query.templateSlotId,
    query.repWindow,
    query.exerciseName,
    query.nowMs,
  );
  if (legacy) {
    return { entry: legacy, borrowed: false };
  }

  const borrowed = findLatestEntryForExerciseName(query.slotHistory, query.exerciseName, {
    requireLoaded: query.requireLoaded,
    repWindow: query.repWindow,
    nowMs: query.nowMs,
  });
  return borrowed ? { entry: borrowed, borrowed: true } : null;
}

/**
 * The unscoped key an older install wrote under — and why it is gated.
 *
 * Before slot ids carried the day (`<template>:<session>:<slot>`), every day
 * that used a slot wrote to the same key. So a lift the reader does twice a
 * week, heavy on one day and light on the other, has BOTH days in there under
 * one id — which is the reported bug's own shape, sitting in the fallback that
 * was meant to rescue old installs. It is shared history, so it answers to the
 * prescription exactly like a borrow from another programme does.
 */
export function selectLegacySlotEntry(
  slotHistory: Record<string, WorkoutSlotHistoryEntry[]>,
  templateSlotId: string | null | undefined,
  repWindow: RepWindow | null | undefined,
  exerciseName?: string | null,
  nowMs?: number,
): WorkoutSlotHistoryEntry | null {
  if (!templateSlotId) {
    return null;
  }
  const latest = selectLatestUsableEntry(entriesForLift(slotHistory?.[templateSlotId], exerciseName), nowMs);
  if (!latest || !entryMatchesRepWindow(latest, repWindow)) {
    return null;
  }
  return latest;
}
