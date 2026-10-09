/**
 * Pure domain logic for the freestyle Empty Workout screen (HG redesign).
 *
 * The screen keeps a small local draft state (exercises + typed sets); this
 * module owns everything derivable from it: the letter-tile initials and the
 * finish payload (template draft + completion summary) handed to App.tsx on
 * save. The add sheet's list is every picker's (lib/exercisePicker).
 */
import { parseNumberInput } from './format';
import { createId } from './ids';
import { REPS_DIAL } from './weightDial';
import { isLiftableWeight } from './weightLimits';
import { isExerciseDone } from './sessionTotals';
import { normalizeExerciseLog } from './exerciseLog';
import { beatsBest, heaviestOfSets } from './personalRecords';
import { exerciseImageKeyFrom } from './exerciseImageKey';
import {
  ExercisePrLookup,
  WorkoutCompletionExerciseCard,
  WorkoutCompletionPrCard,
  resolvePreviousExercisePr,
} from './workoutCompletionSummary';
import { buildPersistedSessionNames } from './workoutEditorNaming';
import { buildSupersetRuns, isSupersetLinked, normalizeSupersetGroups } from './supersetGrouping';
import { AppDatabase, ExerciseLog, ExerciseLogDraft, ExerciseLogSet, WorkoutTemplateDraft } from '../types/models';

// ── letter tiles ─────────────────────────────────────────────────────────

/**
 * Two-letter initials for the purpleLight exercise tile ("Barbell Squat" →
 * "BS", "Pull-Up" → "PU"). Words starting with a letter win over leading
 * numerals ("3/4 Sit-Up" → "SU"); single-word names use their first two
 * letters.
 */
export function exerciseInitials(name: string) {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const letterParts = parts.filter((part) => /^\p{L}/u.test(part));
  const source = letterParts.length > 0 ? letterParts : parts;

  if (source.length === 0) {
    return 'EX';
  }

  if (source.length === 1) {
    return source[0].slice(0, 2).toUpperCase();
  }

  return `${source[0][0]}${source[1][0]}`.toUpperCase();
}

// ── finish payload ───────────────────────────────────────────────────────

export interface FreestyleSetDraft {
  localKey: string;
  kg: string;
  reps: string;
  done: boolean;
}

export interface FreestyleExerciseDraft {
  localKey: string;
  name: string;
  libraryItemId: string | null;
  /**
   * The exercise's picture key (ExerciseLibraryItem.imageKey), not a URL: the
   * name stayed because it is stored. A draft saved before 2026-10-09 holds a
   * CDN URL here; the loader below turns it into the key.
   */
  imageUrl: string | null;
  repMin: number;
  repMax: number;
  restSeconds: number;
  trackedDefault: boolean;
  sets: FreestyleSetDraft[];
  /**
   * The superset this lift is part of — shared with the row below it when the
   * two are done back to back. Same field, same rule and same helpers as a
   * programme's day: see src/lib/supersetGrouping.ts.
   */
  supersetGroup?: string | null;
}

/** A lift as the screen holds it: the draft plus what it draws for it. */
export interface FreestyleExerciseSnapshot extends FreestyleExerciseDraft {
  displayName: string;
  initials: string;
  metaLabel: string;
  isBarbell: boolean;
}

/**
 * A freestyle session in flight, as the workout provider keeps it.
 *
 * The session used to live in the screen's React state alone: forty
 * minutes in, Android reclaiming the app for a camera or a call meant
 * reopening to an empty board with nothing to recover, while the guided
 * player had persisted every set (audit round 4, 2026-09-20). This is what
 * survives — the lifts with their rows, when the session started, and the
 * rest that was running.
 */
export interface FreestyleDraftSnapshot {
  exercises: FreestyleExerciseSnapshot[];
  startedAtMs: number | null;
  rest: { totalSeconds: number; endsAtMs: number; startedAtMs: number } | null;
  savedAtMs: number;
  /**
   * The id the session is saved under, made when the board starts and kept with
   * the draft. A save that landed while the write clearing the board did not
   * (a kill, a refused disk) brings the board back, and its second Finish used
   * to mint a second id and save the same workout twice; with the id kept, the
   * database's duplicate guard makes it the same session. Null on a draft an
   * older build wrote.
   */
  sessionId: string | null;
}

/** The session id of a board: its draft's, or a new one when it starts. */
export function resolveFreestyleSessionId(draft: { sessionId?: string | null } | null | undefined): string {
  return draft?.sessionId ? draft.sessionId : createId('session');
}

type CountedSet = { reps?: number; weight?: number; status?: string; outcome?: string | null; orderIndex?: number };
type CountedLog = { exerciseNameSnapshot: string; orderIndex?: number; sets?: ReadonlyArray<CountedSet> };
type SavedLift = { name: string; sets: string[] };
type SavedSessions = Pick<AppDatabase, 'workoutSessions' | 'exerciseLogs'>;

const isDoneSet = (set: CountedSet) => set.status === 'completed' || set.outcome === 'completed';

/**
 * What a workout did, lift by lift in order: the lift's name and the sets it kept as done, each
 * as "reps@weight" in set order. A lift with no done set did not happen and is not listed. Two
 * saves are compared by this and nothing coarser: the same sets pooled across lifts, or the same
 * lifts in another order, are not the same workout.
 */
function liftsOf(logs: ReadonlyArray<CountedLog>): SavedLift[] {
  const ordered = logs
    .map((log, position) => ({ log, position }))
    .sort((a, b) => (a.log.orderIndex ?? a.position) - (b.log.orderIndex ?? b.position) || a.position - b.position);
  return ordered
    .map(({ log }) => ({
      name: log.exerciseNameSnapshot.trim().toLowerCase(),
      sets: (log.sets ?? [])
        .map((set, position) => ({ set, position }))
        .filter(({ set }) => isDoneSet(set))
        .sort((a, b) => (a.set.orderIndex ?? a.position) - (b.set.orderIndex ?? b.position) || a.position - b.position)
        .map(({ set }) => `${set.reps}@${set.weight}`),
    }))
    .filter((lift) => lift.sets.length > 0);
}

const sameLifts = (a: SavedLift[], b: SavedLift[]) =>
  a.length === b.length &&
  a.every((lift, index) => lift.name === b[index].name && lift.sets.length === b[index].sets.length && lift.sets.every((key, at) => key === b[index].sets[at]));

/** Every set of `inner` is one `outer` also holds, lift by lift (by name, with multiplicity). */
function liftsContained(inner: SavedLift[], outer: SavedLift[]): boolean {
  const pool = new Map<string, number>();
  outer.forEach((lift) => lift.sets.forEach((key) => pool.set(`${lift.name}|${key}`, (pool.get(`${lift.name}|${key}`) ?? 0) + 1)));
  return inner.every((lift) =>
    lift.sets.every((key) => {
      const left = pool.get(`${lift.name}|${key}`) ?? 0;
      pool.set(`${lift.name}|${key}`, left - 1);
      return left > 0;
    }),
  );
}

/**
 * The first id, from `sessionId` on, that does not name another workout: free as it is, or taken
 * by a session `matches` says is this one. A taken id is walked on by a suffix, deterministically,
 * so the same board asks the same question every time it is asked.
 */
function walkTakenIds(
  database: SavedSessions,
  sessionId: string,
  saving: SavedLift[],
  matches: (stored: SavedLift[], saving: SavedLift[]) => boolean,
): { sessionId: string; stored: boolean } {
  let id = sessionId;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!database.workoutSessions.some((session) => session.id === id)) {
      return { sessionId: id, stored: false };
    }
    if (matches(liftsOf(database.exerciseLogs.filter((log) => log.sessionId === id)), saving)) {
      return { sessionId: id, stored: true };
    }
    id = `${id}_b`;
  }
  return { sessionId: createId('session'), stored: false };
}

/** The logs a board would be saved as: what its Finish compares and writes. */
export function freestyleLogsOf(exercises: FreestyleExerciseDraft[]): ExerciseLogDraft[] {
  return buildLogDrafts(
    exercises.filter((exercise) => exercise.name.trim().length > 0),
    '',
  );
}

/**
 * A restored draft whose workout is already saved is not a board to come back to.
 *
 * Finish saves first and clears the draft with a write nobody awaits; when that write is lost
 * (a kill, a refused disk) the board returns after launch under an id the database already
 * holds. It goes when everything it holds as done is in that saved session (a draft handed over
 * before the last tick is a subset of it), and when it was written before that save: the save is
 * the board as it stood at Finish, so a draft written earlier is that board less its last edits
 * (it is written 400 ms behind the board). It came back holding a weight changed just before
 * Finish, and its second Finish saved every set twice (bug hunt 2026-10-03).
 *
 * A draft written after the save is the board carried on after it: it stays, under its own id, and
 * its Finish merges into the saved workout (mergeStoredBoardLogs). Before and after are read off the
 * device clock; one stepped back between the save and later edits would drop those edits, which also
 * needs a lost clear and a board carried on past its save. A draft whose sets an older build's walk
 * saved under `<id>_b` is dropped too.
 */
export function discardSavedFreestyleDraft(
  draft: FreestyleDraftSnapshot | null,
  database: SavedSessions,
): FreestyleDraftSnapshot | null {
  if (!draft || !draft.sessionId) {
    return draft;
  }
  const saved = database.workoutSessions.find((session) => session.id === draft.sessionId);
  const writtenBeforeSave =
    saved !== undefined && draft.savedAtMs > 0 && draft.savedAtMs <= Date.parse(saved.performedAt);
  if (writtenBeforeSave) {
    return null;
  }
  const target = walkTakenIds(database, draft.sessionId, liftsOf(freestyleLogsOf(draft.exercises)), (stored, saving) =>
    liftsContained(saving, stored),
  );
  return target.stored ? null : draft;
}

/**
 * Which session a free workout's Finish saves, and whether there is anything to save.
 *
 * Under the board's own id, so a retry of the same finish is the same session - but only a
 * true retry. A session already stored under that id with exactly these sets, lift by lift, is
 * the finish that already landed: nothing to write. One stored with other sets is another
 * workout wearing a stale id, and claiming it saved would drop what was just logged: these sets
 * get an id of their own, which the caller hands back to the board.
 */
export function resolveFreestyleSaveTarget(
  database: SavedSessions,
  sessionId: string,
  logs: ReadonlyArray<CountedLog>,
): { sessionId: string; alreadySaved: boolean } {
  const target = walkTakenIds(database, sessionId, liftsOf(logs), sameLifts);
  return { sessionId: target.sessionId, alreadySaved: target.stored };
}

/**
 * Whether a guided Finish writes into a workout already stored under its id.
 *
 * The guided session's save lands before its clear, and the clear (a bundle write nobody awaits)
 * can be lost: the session then returns active under an id the database already holds, and the
 * reader can add sets, correct one, take one back, swap or skip a lift, and Finish again (bug hunt
 * 2026-10-03). It is the same workout, so it is saved under the same id, merged with what is stored
 * (mergeStoredWorkoutLogs): no stored set lost, none counted twice. The write decides whether the
 * merge changes anything, against the database it writes.
 *
 * It used to save a finish that lacked a stored set under an id of its own, the stored workout
 * beside it: no set was lost, but every set the two shared was counted twice in volume, records
 * and the week.
 */
export function resolveGuidedSaveTarget(database: SavedSessions, sessionId: string): { mergeStored: boolean } {
  return { mergeStored: database.workoutSessions.some((session) => session.id === sessionId) };
}

/**
 * Whether two sets of saved rows are the same rows: every field the reader can change, set by set,
 * read the way the loader reads them. A merge that comes out the same as what is stored has nothing
 * to write; anything else (a note, an inserted lift, a swap, an effort) is written, so a save is
 * never reported for a change that was dropped.
 */
export function sameSavedLogs(a: ReadonlyArray<ExerciseLog>, b: ReadonlyArray<ExerciseLog>): boolean {
  const rowsOf = (logs: ReadonlyArray<ExerciseLog>) =>
    logs
      .map((log) => normalizeExerciseLog(log))
      .filter((log): log is NonNullable<typeof log> => Boolean(log))
      .map((log) =>
        JSON.stringify([
          log.exerciseNameSnapshot,
          log.exerciseTemplateId ?? null,
          log.slotId ?? null,
          log.templateSlotId ?? null,
          log.templateExerciseId ?? null,
          log.tracked,
          log.orderIndex,
          log.skipped === true,
          log.sessionInserted === true,
          log.status ?? null,
          log.notes ?? null,
          log.swappedFrom ?? null,
          (log.sets ?? []).map((set) => [
            set.orderIndex,
            set.weight,
            set.reps,
            set.kind,
            set.outcome ?? null,
            set.status ?? null,
            set.effort ?? null,
            set.completedAt ?? null,
            set.skippedReason ?? null,
            set.planned ?? null,
          ]),
        ]),
      )
      .sort();
  const left = rowsOf(a);
  const right = rowsOf(b);
  return left.length === right.length && left.every((row, index) => row === right[index]);
}

/** Earlier first; a set with no moment after those with one. */
const byMoment = (a: string | null | undefined, b: string | null | undefined) =>
  a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0;

const sameLiftName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isSkippedLog = (log: Pick<ExerciseLogDraft, 'skipped' | 'status'>) => log.skipped === true || log.status === 'skipped';

/**
 * A guided Finish of a workout already stored under its id, merged with it (resolveGuidedSaveTarget).
 *
 * A done set is the moment it was logged: the player stamps one per set logged, a correction keeps
 * it (set/editLogged), and a set taken back and logged again gets a new one. Not its slot or its
 * place: a swap renumbers a slot's sets lift by lift (lib/liftSegments), and a slot's id can be
 * rewritten when a stored session is repaired on load. So:
 *  - a set the finish holds is saved as the finish holds it: a correction replaces its stored set,
 *    once;
 *  - a stored set the finish lacks was either taken back in the returned session (its moment is in
 *    `takenBackAt`, which set/undo keeps) and goes, or never known to it (the bundle it came back
 *    from was written before that set) and stays. It joins its own lift's row in set order, or
 *    keeps a row of its own when the finish has none for it, or only a skipped one (a skipped row
 *    counts nowhere, and these sets were done);
 *  - a stored set with no moment (an older save) is matched by its lift and value instead;
 *  - what a stored row says besides its sets stays when the finish says nothing of that slot: a lift
 *    note goes onto the slot's last row (the lift it ended on) when none of the finish's rows for it
 *    has one, and a lift added, skipped or swapped in the session, with no done set, keeps its row
 *    when the finish has no row for that slot (nor, failing its id, for that lift) at all. The player
 *    has no way to take an added lift out or a skip back, so a finish without the row is one whose
 *    session never knew it. A note the reader cleared in a session that
 *    came back knowing it comes back too: the finish cannot tell a note cleared from one never known,
 *    and a typed note is never lost on a guess.
 *
 * A stored set the session never knew of showed there as open, and a reader who logs it again has
 * two sets in that place, both kept: the place is not the set (a swap renumbers it), and dropping
 * either could lose one that was lifted. Rare: it needs the bundle to have missed that set too.
 */
export function mergeStoredWorkoutLogs(
  stored: ReadonlyArray<ExerciseLog>,
  logs: ReadonlyArray<ExerciseLogDraft>,
  takenBackAt: ReadonlyArray<string> = [],
): ExerciseLogDraft[] {
  const heldMoments = new Map<string, number>();
  const heldValues = new Map<string, number>();
  const valueKey = (name: string, set: ExerciseLogSet) => `${name.trim().toLowerCase()}|${set.reps}@${set.weight}`;
  logs.forEach((log) =>
    (log.sets ?? []).forEach((set) => {
      if (!isDoneSet(set)) {
        return;
      }
      if (set.completedAt) {
        heldMoments.set(set.completedAt, (heldMoments.get(set.completedAt) ?? 0) + 1);
      }
      const value = valueKey(log.exerciseNameSnapshot, set);
      heldValues.set(value, (heldValues.get(value) ?? 0) + 1);
    }),
  );
  const take = (pool: Map<string, number>, key: string) => {
    const left = pool.get(key) ?? 0;
    pool.set(key, left - 1);
    return left > 0;
  };
  const takenBack = new Set(takenBackAt);
  return joinKeptSets(
    stored,
    logs,
    (storedLog, set) =>
      set.completedAt
        ? !take(heldMoments, set.completedAt) && !takenBack.has(set.completedAt)
        : !take(heldValues, valueKey(storedLog.exerciseNameSnapshot, set)),
    true,
  );
}

/**
 * A free workout board finished again under the id its earlier save holds, merged with that save.
 *
 * The board's sets carry no moment of their own (each is stamped with its finish), but they have a
 * place that does not move: a lift's key on the board (the row's slotId) and the set's position in
 * it. A set is never taken off a board, only unticked, and a lift taken off goes with all its sets.
 * The board is the reader's latest word: a done set on it is saved as it stands, once. A stored set
 * whose place the board holds no done set at (unticked since, or a lift taken off, or a board that
 * came back from a draft written before it) stays, as in the guided merge (a set kept beats a set
 * lost); it joins its lift's row the same way (joinKeptSets).
 */
export function mergeStoredBoardLogs(
  stored: ReadonlyArray<ExerciseLog>,
  logs: ReadonlyArray<ExerciseLogDraft>,
): ExerciseLogDraft[] {
  const held = new Set<string>();
  logs.forEach((log) =>
    (log.sets ?? []).forEach((set) => {
      if (isDoneSet(set)) {
        held.add(`${log.slotId ?? ''}|${set.orderIndex}`);
      }
    }),
  );
  // Not the guided merge's notes and markers: every board row is an added lift, and one taken off the
  // board with nothing done on it is meant to go.
  return joinKeptSets(stored, logs, (storedLog, set) => !held.has(`${storedLog.slotId ?? ''}|${set.orderIndex}`), false);
}

/**
 * The finish's rows with the stored done sets `keeps` says it lacks put back: each into its own
 * lift's row, or a row of its own (see mergeStoredWorkoutLogs). With `keepsMarks`, also a stored
 * note, added lift or skip the finish says nothing of.
 */
function joinKeptSets(
  stored: ReadonlyArray<ExerciseLog>,
  logs: ReadonlyArray<ExerciseLogDraft>,
  keeps: (storedLog: ExerciseLog, set: ExerciseLogSet) => boolean,
  keepsMarks: boolean,
): ExerciseLogDraft[] {
  const merged: ExerciseLogDraft[] = logs.map((log) => ({ ...log, sets: [...(log.sets ?? [])] }));
  const extra: ExerciseLogDraft[] = [];
  [...stored]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .forEach((storedLog) => {
      const kept = (storedLog.sets ?? []).filter((set) => isDoneSet(set) && keeps(storedLog, set));
      const sameLift = (log: ExerciseLogDraft) =>
        (log.slotId ?? null) === (storedLog.slotId ?? null) && sameLiftName(log.exerciseNameSnapshot, storedLog.exerciseNameSnapshot);
      // The finish's rows for this stored row's slot. A swap names a slot's rows after their lifts, so a
      // slot is found by its id; a row from before slot ids, or one whose slot id was rewritten when the
      // session was repaired on load, is found by its lift instead (else it would stand twice).
      const byId = storedLog.slotId ? merged.filter((log) => log.slotId === storedLog.slotId) : [];
      const slotRows =
        byId.length > 0 ? byId : merged.filter((log) => sameLiftName(log.exerciseNameSnapshot, storedLog.exerciseNameSnapshot));
      const note = keepsMarks && storedLog.notes?.trim() && !slotRows.some((log) => log.notes?.trim()) ? storedLog.notes : null;
      if (kept.length === 0) {
        if (note && slotRows.length > 0) {
          // On the lift the slot ended on, where the player keeps an exercise's note (workoutAppAdapter).
          slotRows[slotRows.length - 1].notes = note;
          return;
        }
        const marked =
          note ||
          ((storedLog.sessionInserted === true || isSkippedLog(storedLog) || Boolean(storedLog.swappedFrom)) &&
            !(storedLog.sets ?? []).some((set) => isDoneSet(set)));
        if (keepsMarks && marked && slotRows.length === 0) {
          // Its sets as stored, less any done one the finish holds elsewhere (none, for a mark with nothing done).
          extra.push({ ...rowOfItsOwn(storedLog), sets: (storedLog.sets ?? []).filter((set) => !isDoneSet(set)) });
        }
        return;
      }
      // A row skipped with nothing done in it was skipped by a session that did not know these sets were
      // done: it is done after all, the way a lift skipped after a set is (exercise/skip). A skipped row
      // that held a done set is not one the player writes, and is left alone.
      const skippedHome = merged.find((log) => sameLift(log) && isSkippedLog(log) && !log.sets.some((set) => isDoneSet(set)));
      if (skippedHome) {
        skippedHome.skipped = false;
        skippedHome.status = 'completed';
      }
      const home = merged.find((log) => sameLift(log) && !isSkippedLog(log));
      if (home) {
        // A kept set takes its place back from a set the finish holds there undone: the returned session
        // showed it open because it never knew it was done.
        const places = new Set(kept.map((set) => set.orderIndex));
        home.sets = [...home.sets.filter((set) => isDoneSet(set) || !places.has(set.orderIndex)), ...kept].sort(
          (a, b) => a.orderIndex - b.orderIndex || byMoment(a.completedAt, b.completedAt),
        );
        // Open only for the sets it did not know were done: with none left open, it is done.
        if (home.status === 'active' && home.sets.every((set) => isDoneSet(set))) {
          home.status = 'completed';
        }
        if (note) {
          home.notes = note;
        }
        return;
      }
      extra.push({
        ...rowOfItsOwn(storedLog),
        sets: kept,
        skipped: false,
        status: storedLog.status === 'skipped' ? 'completed' : storedLog.status,
        // A slot's note once: not again beside the one the finish holds for it.
        notes: keepsMarks ? note : storedLog.notes ?? null,
      });
    });
  return [...merged, ...extra];
}

/** A stored row as a draft row of its own, as it was saved. */
function rowOfItsOwn(storedLog: ExerciseLog): ExerciseLogDraft {
  return {
    exerciseTemplateId: storedLog.exerciseTemplateId,
    exerciseNameSnapshot: storedLog.exerciseNameSnapshot,
    sets: storedLog.sets ?? [],
    tracked: storedLog.tracked,
    orderIndex: storedLog.orderIndex,
    skipped: storedLog.skipped === true,
    sessionInserted: storedLog.sessionInserted === true,
    status: storedLog.status,
    slotId: storedLog.slotId ?? null,
    templateSlotId: storedLog.templateSlotId ?? null,
    templateExerciseId: storedLog.templateExerciseId ?? null,
    notes: storedLog.notes ?? null,
    swappedFrom: storedLog.swappedFrom ?? null,
    // Its sets' unit with it: without it a stored "30 min" came back as 30
    // reps for any lift the minutes list does not name (review, 2026-10-07).
    ...(storedLog.repsUnit === 'minutes' ? { repsUnit: 'minutes' as const } : {}),
  };
}

/**
 * How long a stored draft's clock stays the session's clock.
 *
 * Long enough to cover the thing the draft exists for — a process killed
 * mid-session, a phone left face down through a long rest, a night's sleep
 * with the app in the background — and short enough that a board found days
 * later is not still counting.
 */
export const FREESTYLE_DRAFT_CLOCK_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * When a resumed freestyle session started.
 *
 * The draft's own start, while the draft is fresh: that is the session the
 * reader is coming back to, and its clock has been running the whole time.
 *
 * A draft older than that is the same lifts and a NEW session. `savedAtMs`
 * was written on every save and read nowhere, so a board left on Friday and
 * reopened on Monday resumed with a header reading 72:14:03 and saved a
 * session claiming 4 334 minutes, starting three days before the first set
 * of it was logged (CI review of #162). The rows are the reader's work and
 * they stay; the clock starts now.
 *
 * A `savedAtMs` in the future — the device clock moved back — is not fresh
 * either, for the same reason: nothing can be said about how long ago that
 * was.
 */
export function resolveFreestyleDraftStart(
  draft: { startedAtMs: number | null; savedAtMs: number } | null | undefined,
  now: number,
): number | null {
  if (!draft || draft.startedAtMs === null) {
    return null;
  }
  const age = now - draft.savedAtMs;
  return age >= 0 && age <= FREESTYLE_DRAFT_CLOCK_MAX_AGE_MS ? draft.startedAtMs : now;
}

const finiteOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * A stored snapshot, or null. Read from disk, so nothing in it is trusted:
 * a lift without a name or rows is dropped, a row without a key is
 * dropped, numbers that are not numbers become the defaults, and a
 * snapshot left with no lifts is no snapshot.
 */
export function normalizeFreestyleDraftSnapshot(input: unknown): FreestyleDraftSnapshot | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const raw = input as Record<string, unknown>;
  const exercises: FreestyleExerciseSnapshot[] = [];
  for (const item of Array.isArray(raw.exercises) ? raw.exercises : []) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const lift = item as Record<string, unknown>;
    if (typeof lift.localKey !== 'string' || !lift.localKey || typeof lift.name !== 'string' || !lift.name.trim()) {
      continue;
    }
    const sets: FreestyleSetDraft[] = [];
    for (const row of Array.isArray(lift.sets) ? lift.sets : []) {
      if (!row || typeof row !== 'object') {
        continue;
      }
      const set = row as Record<string, unknown>;
      if (typeof set.localKey !== 'string' || !set.localKey) {
        continue;
      }
      sets.push({
        localKey: set.localKey,
        kg: typeof set.kg === 'string' ? set.kg : '',
        reps: typeof set.reps === 'string' ? set.reps : '',
        done: set.done === true,
      });
    }
    if (sets.length === 0) {
      continue;
    }
    const displayName = typeof lift.displayName === 'string' && lift.displayName ? lift.displayName : lift.name;
    exercises.push({
      localKey: lift.localKey,
      name: lift.name,
      libraryItemId: typeof lift.libraryItemId === 'string' ? lift.libraryItemId : null,
      imageUrl: exerciseImageKeyFrom(typeof lift.imageUrl === 'string' ? lift.imageUrl : null),
      repMin: finiteOr(lift.repMin, 8),
      repMax: finiteOr(lift.repMax, 12),
      restSeconds: finiteOr(lift.restSeconds, 90),
      trackedDefault: lift.trackedDefault !== false,
      sets,
      supersetGroup: typeof lift.supersetGroup === 'string' ? lift.supersetGroup : null,
      displayName,
      initials: typeof lift.initials === 'string' ? lift.initials : displayName.slice(0, 2).toUpperCase(),
      metaLabel: typeof lift.metaLabel === 'string' ? lift.metaLabel : '',
      isBarbell: lift.isBarbell === true,
    });
  }
  if (exercises.length === 0) {
    return null;
  }
  const restRaw = raw.rest && typeof raw.rest === 'object' ? (raw.rest as Record<string, unknown>) : null;
  const rest =
    restRaw &&
    typeof restRaw.endsAtMs === 'number' &&
    Number.isFinite(restRaw.endsAtMs) &&
    typeof restRaw.startedAtMs === 'number' &&
    Number.isFinite(restRaw.startedAtMs)
      ? {
          totalSeconds: Math.max(1, Math.round(finiteOr(restRaw.totalSeconds, 60))),
          endsAtMs: restRaw.endsAtMs,
          startedAtMs: restRaw.startedAtMs,
        }
      : null;
  return {
    exercises,
    startedAtMs: typeof raw.startedAtMs === 'number' && Number.isFinite(raw.startedAtMs) ? raw.startedAtMs : null,
    rest,
    savedAtMs: finiteOr(raw.savedAtMs, 0),
    sessionId: typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : null,
  };
}

export interface FreestyleFinishInput {
  exercises: FreestyleExerciseDraft[];
  workoutName: string;
  startedAtIso: string;
  performedAtIso: string;
  elapsedSeconds: number;
  exercisePrLookup: ExercisePrLookup;
  /** The board's own session id (see FreestyleDraftSnapshot.sessionId); the save mints one when absent. */
  sessionId?: string;
}

/** What a finished freestyle session hands to the save. */
export interface FreestyleFinishSummary {
  workoutName: string;
  startedAt: string;
  performedAt: string;
  durationMinutes: number;
  setsCompleted: number;
  totalVolume: number;
  exercisesLogged: number;
  exerciseCards: WorkoutCompletionExerciseCard[];
  prCards: WorkoutCompletionPrCard[];
  logs: ExerciseLogDraft[];
  /** Carried from the board, so a second Finish of it is the same session. */
  sessionId?: string;
}

export interface FreestyleFinishResult {
  draft: WorkoutTemplateDraft;
  summary: FreestyleFinishSummary;
}

/**
 * Whether a typed set can be ticked done: it has reps, its weight is one a
 * person could lift and its reps fit the reps dial. The weight may be empty —
 * a bodyweight set has none.
 *
 * The reps may not. "Empty fields are allowed, the finish decides" let a
 * blank row be ticked, and the finish decided it was a set: "1 set, 0 kg" in
 * history, and — once a free workout needed one ticked set to be saved — the
 * one tick that saved a session nobody did (audit, 2026-09-26).
 *
 * The fields took anything. "825" for 82,5 was ticked, counted into volume and
 * shown on the summary, and then the loader dropped the set on the next launch
 * because nothing over the ceiling is a set.
 *
 * Reps are whole. "8,5" was ticked and stored as 8.5 reps — into volume, a PR
 * card and the history line (decimal audit, 2026-09-21); the guided dials round,
 * and a field cannot round without saying so, so it refuses like a typo.
 */
export function isLoggableFreestyleSet(set: Pick<FreestyleSetDraft, 'kg' | 'reps'>): boolean {
  const kg = set.kg.trim() ? parseNumberInput(set.kg) : null;
  const reps = set.reps.trim() ? parseNumberInput(set.reps) : null;
  if (set.kg.trim() && !isLiftableWeight(kg)) {
    return false;
  }
  if (reps === null || reps <= 0 || reps > REPS_DIAL.max || !Number.isInteger(reps)) {
    return false;
  }
  return true;
}

/**
 * A set the finish counts as done: ticked, and a set by the rule above. A
 * draft saved before that rule can still hold a ticked blank row; it is not
 * work, so it is neither counted, logged as completed, nor enough to save.
 */
function isDoneFreestyleSet(set: FreestyleSetDraft): boolean {
  return set.done && isLoggableFreestyleSet(set);
}

function setVolumeKg(set: FreestyleSetDraft) {
  if (!isDoneFreestyleSet(set)) {
    return 0;
  }

  const kg = parseNumberInput(set.kg) ?? 0;
  const reps = parseNumberInput(set.reps) ?? 0;
  return kg * reps;
}

/** Volume across done sets, for the live stat strip and the finish summary. */
export function freestyleVolumeKg(exercises: FreestyleExerciseDraft[]) {
  return exercises.reduce(
    (total, exercise) => total + exercise.sets.reduce((sum, set) => sum + setVolumeKg(set), 0),
    0,
  );
}

/**
 * The rest to start when a freestyle set is ticked, in seconds — or null when
 * no rest should run.
 *
 * This used to ask a different question: "is another set already waiting?",
 * and started no rest unless one was. The intent was to stop the last tick of
 * a session opening a 2:00 countdown to nothing.
 *
 * It withheld the timer from almost every rest instead. A freestyle session
 * has no plan: you tick the set you just did and THEN press "+ Lisää sarja"
 * for the next one, so at the moment of the tick there is normally nothing
 * waiting and the answer was no. Reported twice from the gym on 2026-08-28 —
 * "tätä lepoa ei tullut kun tein penkkiä" and "lepo sekosi, ei näy mitään" —
 * and reproduced on the emulator: log a set the ordinary way and no bar comes.
 *
 * So a tick always earns its rest. The end-of-session case the old rule was
 * written for costs one tap on Ohita, which is the right price for a guess the
 * app cannot make: nothing at tick time says whether the reader is finished.
 * The bar cannot cover "Lopeta treeni" while it does — the logging list has
 * reserved room for it since the screen was built.
 */
export function freestyleRestSecondsForTick(
  exercise: FreestyleExerciseDraft,
  set: FreestyleSetDraft,
  defaultRestSeconds: number,
  /**
   * The whole list, so this can see whether the lift runs into the next one.
   * Optional because the rule below it — un-ticking, and an uncountable rest —
   * needs nothing but the lift itself.
   */
  exercises: ReadonlyArray<FreestyleExerciseDraft> = [],
): number | null {
  // Un-ticking corrects a mistake; it is not the end of a set. The caller
  // hands over the PRE-toggle set, so this is the one rule about which way
  // the tick is going, and it lives here rather than at the call site.
  if (set.done) {
    return null;
  }

  const index = exercises.findIndex((entry) => entry.localKey === exercise.localKey);
  const group = index === -1 ? [] : supersetGroupMembers(exercises, index);

  // A superset's whole point: A1 runs straight into A2, so ticking A1 starts
  // nothing. The rest belongs after the last lift of the group.
  if (group.length > 1 && index < exercises.length - 1 && isSupersetLinked(exercises, index)) {
    return null;
  }

  // Nothing below a second is a rest. Both numbers can arrive unusable — a
  // stored preference reaches getExerciseTemplateDefaults unbounded, and NaN
  // survives every arithmetic step to produce a bar frozen at 0:00 that never
  // ends. A rest that cannot be counted is not started.
  //
  // A superset rests as long as its most demanding lift asks for: a squat
  // paired with a curl is still a squat.
  const own = Math.round(
    group.length > 1
      ? group.reduce((longest, member) => Math.max(longest, member.restSeconds), 0)
      : exercise.restSeconds,
  );
  const seconds = own > 0 ? own : Math.round(defaultRestSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** The lifts performed as one superset with the one at `index`, itself included. */
function supersetGroupMembers(
  exercises: ReadonlyArray<FreestyleExerciseDraft>,
  index: number,
): FreestyleExerciseDraft[] {
  const run = buildSupersetRuns(normalizeSupersetGroups(exercises)).find((candidate) =>
    candidate.indexes.includes(index),
  );
  return run ? run.indexes.map((member) => exercises[member]) : [];
}

/** Done-set count across the session, for the stat strip. */
/**
 * The set the reader is coming back to, for the rest bar's done state.
 *
 * The design puts a concrete set on that line — "Set 3 · 60 kg × 8" — not a
 * slogan. Empty fields carry the last logged set's numbers forward, which is
 * what the logger itself does when the reader taps in.
 */
export function freestyleNextSetTarget(
  exercises: FreestyleExerciseDraft[],
): { setNumber: number; kg: string; reps: string } | null {
  for (const exercise of exercises) {
    const index = exercise.sets.findIndex((set) => !set.done);
    if (index === -1) {
      continue;
    }
    const set = exercise.sets[index];
    // Carried forward from the nearest logged set above, the way the inputs do.
    const previous = [...exercise.sets.slice(0, index)].reverse().find((entry) => entry.done);
    return {
      setNumber: index + 1,
      kg: set.kg.trim() || previous?.kg.trim() || '',
      reps: set.reps.trim() || previous?.reps.trim() || '',
    };
  }
  return null;
}

export function freestyleDoneSetCount(exercises: FreestyleExerciseDraft[]) {
  return exercises.reduce(
    (total, exercise) => total + exercise.sets.filter(isDoneFreestyleSet).length,
    0,
  );
}

/**
 * Whether a freestyle session has anything to save (user decision,
 * 2026-09-26): at least one set ticked done.
 *
 * Finish used to ask only "is there a lift on the board?" — a board with rows
 * typed in and nothing ticked still saved, as a template with a session
 * nobody performed and a history entry of zero completed sets. A free
 * workout with nothing done is not a workout; it is the board the reader
 * meant to fill in and left.
 */
export function canFinishFreestyleSession(exercises: FreestyleExerciseDraft[]): boolean {
  return freestyleDoneSetCount(exercises) > 0;
}

/**
 * What leaving would throw away: sets done, and sets with a number in them
 * that are not done yet.
 *
 * The leave question counted only ticked sets, so four sets with their
 * weights and reps typed in and the tick still to come went on one tap of
 * back, with nothing asked. A new exercise starts with an empty set and a new
 * set carries only what the reader typed above it, so a number in a draft is
 * the reader's own.
 *
 * "Done" is the finish's rule (`isDoneFreestyleSet`), not the raw tick: a
 * ticked row whose reps were cleared to retype counted here as a set while
 * Finish refused it, so the stat strip read "1 set" beside "add a set to
 * finish", and removing that lift asked for a confirmation over nothing.
 */
export function freestyleUnsavedWork(exercises: FreestyleExerciseDraft[]): {
  doneSets: number;
  enteredSets: number;
} {
  let doneSets = 0;
  let enteredSets = 0;
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      if (isDoneFreestyleSet(set)) {
        doneSets += 1;
      } else if (set.kg.trim() !== '' || set.reps.trim() !== '') {
        enteredSets += 1;
      }
    }
  }
  return { doneSets, enteredSets };
}

function buildLogDrafts(exercises: FreestyleExerciseDraft[], performedAtIso: string): ExerciseLogDraft[] {
  return exercises.map((exercise, orderIndex) => {
    const sets = exercise.sets.map((set, setIndex) => ({
      orderIndex: setIndex,
      weight: parseNumberInput(set.kg) ?? 0,
      reps: parseNumberInput(set.reps) ?? 0,
      kind: 'working' as const,
      outcome: isDoneFreestyleSet(set) ? ('completed' as const) : null,
      status: isDoneFreestyleSet(set) ? ('completed' as const) : ('pending' as const),
      effort: null,
      completedAt: isDoneFreestyleSet(set) ? performedAtIso : null,
      skippedReason: null,
    }));

    return {
      exerciseTemplateId: null,
      exerciseNameSnapshot: exercise.name.trim(),
      sets,
      tracked: exercise.trackedDefault,
      orderIndex,
      skipped: false,
      sessionInserted: true,
      status: sets.some((set) => set.status === 'completed') ? ('completed' as const) : ('active' as const),
      slotId: exercise.localKey,
      templateSlotId: null,
      templateExerciseId: null,
      notes: null,
      swappedFrom: null,
    };
  });
}

function isPrCard(card: WorkoutCompletionPrCard | null): card is WorkoutCompletionPrCard {
  return card !== null;
}

/**
 * Builds the save payload for a finished freestyle session: the template
 * draft persisted through upsertWorkoutTemplate and the completion summary
 * for the Workout Complete screen. Mirrors the editor's finish math so both
 * paths produce identical history entries.
 */
export function buildFreestyleFinish({
  exercises,
  workoutName,
  startedAtIso,
  performedAtIso,
  elapsedSeconds,
  exercisePrLookup,
  sessionId,
}: FreestyleFinishInput): FreestyleFinishResult {
  const named = exercises.filter((exercise) => exercise.name.trim().length > 0);

  const exerciseCards: WorkoutCompletionExerciseCard[] = named.map((exercise) => ({
    id: exercise.localKey,
    name: exercise.name.trim(),
    imageUrl: exercise.imageUrl,
    completedSets: exercise.sets.filter(isDoneFreestyleSet).length,
    totalSets: Math.max(1, exercise.sets.length),
    totalVolumeKg: exercise.sets.reduce((sum, set) => sum + setVolumeKg(set), 0),
    notes: null,
  }));

  const prCards: WorkoutCompletionPrCard[] = named
    .map((exercise): WorkoutCompletionPrCard | null => {
      const doneSets = exercise.sets
        .filter(isDoneFreestyleSet)
        .map((set) => ({ weight: parseNumberInput(set.kg), reps: parseNumberInput(set.reps) }))
        .filter((set): set is { weight: number; reps: number } => set.weight !== null && set.reps !== null);
      const bestSet = heaviestOfSets(doneSets);

      if (!bestSet) {
        return null;
      }

      const previousBest = resolvePreviousExercisePr({
        libraryItemId: exercise.libraryItemId,
        exerciseName: exercise.name,
        lookup: exercisePrLookup,
      });

      // Beaten, not matched: heavier, or the same weight for more reps.
      if (!beatsBest(bestSet, previousBest)) {
        return null;
      }

      return {
        id: `pr:${exercise.localKey}`,
        exerciseName: exercise.name.trim(),
        imageUrl: exercise.imageUrl,
        previousBestWeightKg: previousBest?.weight ?? null,
        previousBestReps: previousBest?.reps ?? null,
        performedWeightKg: bestSet.weight,
        performedReps: bestSet.reps,
      };
    })
    .filter(isPrCard)
    // Strongest first, as the programme finish sorts them: the hero shows the
    // first card, and in exercise order it could lead with the smallest
    // record of the session (2026-09-26).
    .sort(
      (left, right) =>
        right.performedWeightKg - left.performedWeightKg || right.performedReps - left.performedReps,
    )
    .slice(0, 3);

  const persistedSessionName = buildPersistedSessionNames(
    [{ exerciseNames: named.map((exercise) => exercise.name) }],
    workoutName,
  )[0];
  const logs = buildLogDrafts(named, performedAtIso);

  return {
    draft: {
      name: workoutName,
      sessions: [
        {
          name: persistedSessionName,
          exercises: named.map((exercise) => ({
            name: exercise.name.trim(),
            targetSets: Math.max(1, exercise.sets.length),
            repMin: exercise.repMin,
            repMax: exercise.repMax,
            restSeconds: exercise.restSeconds > 0 ? Math.round(exercise.restSeconds) : null,
            trackedDefault: exercise.trackedDefault,
            libraryItemId: exercise.libraryItemId,
            // A free workout is saved as a template, and a superset performed
            // in it is part of how that workout was done — dropping it here
            // would make the saved copy a different session.
            supersetGroup: exercise.supersetGroup ?? null,
          })),
        },
      ],
    },
    summary: {
      workoutName,
      startedAt: startedAtIso,
      performedAt: performedAtIso,
      durationMinutes: Math.max(1, Math.round(elapsedSeconds / 60)),
      setsCompleted: freestyleDoneSetCount(named),
      totalVolume: freestyleVolumeKg(named),
      // The lifts done, off the logs this save writes and by the rule History
      // reads them with. Every named row used to count, so a lift typed in and
      // never ticked made "2 LIIKETTÄ" of a session that had one.
      exercisesLogged: logs.filter(isExerciseDone).length,
      exerciseCards,
      prCards,
      logs,
      ...(sessionId ? { sessionId } : {}),
    },
  };
}

/**
 * What a set you have just added starts at.
 *
 * Blank, until now. In a free workout the second and third sets of a lift are
 * almost always the first one again — same bar, same reps — so the reader
 * retyped "60" and "6" for every one of them ("painot ja toistot
 * automaattisesti eli ylempänä 60kg ja 6toistoo tulisi alempaan kanssa 60kg
 * 6toistoo", #bugs 2026-08-28).
 *
 * The two numbers are carried INDEPENDENTLY, from the last set that has each.
 * A reader who logs the weight first and the reps after the set is mid-entry
 * on the row above; taking both from the same row would hand them a weight and
 * a blank, or nothing at all, depending on which half they had reached.
 *
 * A carried number is a suggestion, not a claim about what was lifted: it goes
 * into the draft text the same way a typed one does, and the set counts as
 * done only when the reader says so.
 */
export function carryForwardFreestyleSet(
  sets: ReadonlyArray<Pick<FreestyleSetDraft, 'kg' | 'reps'>>,
): { kg: string; reps: string } {
  const lastFilled = (read: (set: Pick<FreestyleSetDraft, 'kg' | 'reps'>) => string) => {
    for (let index = sets.length - 1; index >= 0; index -= 1) {
      const value = read(sets[index]);
      if (value.trim() !== '') {
        return value;
      }
    }
    return '';
  };

  return { kg: lastFilled((set) => set.kg), reps: lastFilled((set) => set.reps) };
}
