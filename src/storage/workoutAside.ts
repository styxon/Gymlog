/**
 * Put the stored workout bundle aside, for the crash screen's second action.
 *
 * A render error that comes from the workout bundle (the workout in progress,
 * and beside it the numbers remembered from earlier workouts) remounts into
 * the same error forever: "Try again" re-reads the same bytes. This is the one
 * deliberate way out, and the reader asks for it (user 2026-10-03, after a
 * repeated failure).
 *
 * It never deletes. The bundle is copied to its own key first — the same
 * pattern as the database's and the bundle's corrupt-copy slots — and the live
 * rows are removed only after that write has resolved. A copy that fails
 * throws and leaves the live data exactly as it was, so the caller can say so.
 * Settings brings a copy back (Restore set-aside workout: WorkoutProvider
 * restoreSetAsideWorkout, user decision 2026-10-03); otherwise copies stay on
 * the phone until Reset all data (`removeWorkoutAsideCopies`) erases them.
 *
 * A copy is never written over another one that holds something. The remount
 * after a first use hydrates an empty bundle and the provider saves it, so the
 * live key is "there" again; a second use, after a crash from elsewhere, would
 * otherwise replace the only copy of the real workout with that empty one. An
 * empty bundle is not copied at all (and the action is not offered for one),
 * and a second non-empty bundle goes to the next numbered slot beside the
 * first. A pre-rename `@gymlog/workout/v1` that sits beside a live key is
 * copied the same way rather than deleted.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getLargeItem, MissingPartsError, removeLargeItem, setLargeItem } from './largeItem';
import {
  LEGACY_WORKOUT_STORAGE_KEY,
  WORKOUT_ASIDE_STORAGE_KEY,
  WORKOUT_STORAGE_KEY,
} from './workoutKeys';

/** A large item's text, or what is left of a damaged one; null when absent. */
async function readLarge(key: string): Promise<string | null> {
  try {
    return await getLargeItem(key);
  } catch (error) {
    if (error instanceof MissingPartsError) {
      return error.readable;
    }
    throw error;
  }
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return typeof value === 'object' && Object.keys(value as object).length === 0;
}

/**
 * Whether stored bundle text holds nothing: no active session, no active
 * cardio, no free-workout draft, no logged summaries, no slot history and no
 * remembered selection. Text that does not parse is not empty — it is kept.
 */
export function isEmptyBundleText(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  const bundle = parsed as Record<string, unknown>;
  const history = bundle.history ?? {};
  if (typeof history !== 'object' || history === null || Array.isArray(history)) {
    return false;
  }
  const kept = history as Record<string, unknown>;
  return (
    isEmptyValue(bundle.activeSession) &&
    isEmptyValue(bundle.activeCardio) &&
    isEmptyValue(bundle.freestyleDraft) &&
    isEmptyValue(kept.sessions) &&
    isEmptyValue(kept.slotHistory) &&
    isEmptyValue(kept.lastSelectedTemplateId)
  );
}

/** The bundle as the app would load it: the live key, else the pre-rename one. */
async function readStoredBundle(): Promise<{ text: string | null; legacy: string | null }> {
  const live = await readLarge(WORKOUT_STORAGE_KEY);
  const legacy = await AsyncStorage.getItem(LEGACY_WORKOUT_STORAGE_KEY);
  // The pre-rename row is a second copy only while a live key stands over it.
  return { text: live ?? legacy, legacy: live !== null ? legacy : null };
}

/** Whether the stored bundle holds something to put aside. False when it cannot be read. */
export async function hasWorkoutToPutAside(): Promise<boolean> {
  try {
    // The pre-rename row is read only when there is no live one: a failing
    // read of it must not hide the action over a live bundle that is fine.
    const text = (await readLarge(WORKOUT_STORAGE_KEY)) ?? (await AsyncStorage.getItem(LEGACY_WORKOUT_STORAGE_KEY));
    return text !== null && !isEmptyBundleText(text);
  } catch {
    return false;
  }
}

/**
 * The slot heads of every aside copy: the first slot and the numbered ones.
 * The parts of a split slot (`…/1#0`) are not heads; removeLargeItem sweeps
 * them with their head.
 */
async function asideKeys(): Promise<string[]> {
  const numbered = `${WORKOUT_ASIDE_STORAGE_KEY}/`;
  return (await AsyncStorage.getAllKeys()).filter(
    (key) =>
      key === WORKOUT_ASIDE_STORAGE_KEY || (key.startsWith(numbered) && /^\d+$/.test(key.slice(numbered.length))),
  );
}

/** Write `text` to a slot that holds nothing, never over another copy. Resolves once written. */
async function putCopy(text: string): Promise<void> {
  const taken = new Set(await asideKeys());
  for (const key of taken) {
    // A retry after a half-finished earlier try: this copy is already there.
    if ((await readLarge(key)) === text) {
      return;
    }
  }
  const first = taken.has(WORKOUT_ASIDE_STORAGE_KEY) ? await readLarge(WORKOUT_ASIDE_STORAGE_KEY) : null;
  if (first === null || isEmptyBundleText(first)) {
    await setLargeItem(WORKOUT_ASIDE_STORAGE_KEY, text);
    return;
  }
  let n = 1;
  while (taken.has(`${WORKOUT_ASIDE_STORAGE_KEY}/${n}`)) {
    n += 1;
  }
  await setLargeItem(`${WORKOUT_ASIDE_STORAGE_KEY}/${n}`, text);
}

/**
 * Copy the bundle aside, then remove it from where the app reads it.
 * Resolves true when something was moved, false when there was nothing; rejects
 * when a copy could not be written or read, with the live data untouched.
 */
export async function setWorkoutBundleAside(): Promise<boolean> {
  const { text, legacy } = await readStoredBundle();
  if (text === null) {
    return false;
  }
  const worth = (value: string | null): value is string => value !== null && !isEmptyBundleText(value);
  if (worth(text)) {
    await putCopy(text);
  }
  if (worth(legacy)) {
    await putCopy(legacy);
  }
  // Only now: every copy has resolved.
  await removeLargeItem(WORKOUT_STORAGE_KEY);
  await AsyncStorage.removeItem(LEGACY_WORKOUT_STORAGE_KEY);
  return worth(text) || worth(legacy);
}

/**
 * The copy to bring back: the highest numbered slot, else the first. Copies are
 * written to the first free slot, so that is the latest one put aside unless a
 * restore has freed a lower slot since; with more than one, each restore brings
 * back one. Null when no slot holds anything.
 */
async function readNewestWorkoutAsideCopy(): Promise<{ key: string; text: string } | null> {
  return (await asideCopiesNewestFirst())[0] ?? null;
}

/** Every slot that holds something, in the order a restore tries them (readNewestWorkoutAsideCopy). */
async function asideCopiesNewestFirst(): Promise<Array<{ key: string; text: string }>> {
  const numbered = `${WORKOUT_ASIDE_STORAGE_KEY}/`;
  const order = (key: string) => (key === WORKOUT_ASIDE_STORAGE_KEY ? 0 : Number(key.slice(numbered.length)));
  const copies: Array<{ key: string; text: string }> = [];
  for (const key of (await asideKeys()).sort((a, b) => order(b) - order(a))) {
    const text = await readLarge(key);
    if (text !== null && !isEmptyBundleText(text)) {
      copies.push({ key, text });
    }
  }
  return copies;
}

/** Whether Settings has a copy to bring back. False when the copies cannot be read. */
export async function hasWorkoutAsideCopy(): Promise<boolean> {
  try {
    return (await readNewestWorkoutAsideCopy()) !== null;
  } catch {
    return false;
  }
}

/**
 * Brings the newest set-aside copy back (Settings' Restore set-aside workout).
 *
 * Never deletes, in this order: `read` turns the copy into what the app shows
 * (it throws for a copy that does not parse, which stays where it is and is
 * passed over for the next one: 'unreadable' only when none can be read, and
 * then nothing moves);
 * `liveText`, the workout data the app holds now, is copied aside first (not
 * over another copy; an empty bundle is not copied); `show` stores and shows
 * the copy; only once that resolved does the copy's slot go, and only while it
 * still holds that copy. A step that rejects stops there and rejects, with
 * every copy where it was.
 */
export async function bringBackWorkoutAside<T>(
  liveText: string,
  read: (text: string) => T,
  show: (value: T) => Promise<void>,
): Promise<'restored' | 'none' | 'unreadable'> {
  const copies = await asideCopiesNewestFirst();
  if (copies.length === 0) {
    return 'none';
  }
  let found: { key: string; text: string; value: T } | null = null;
  for (const candidate of copies) {
    try {
      found = { ...candidate, value: read(candidate.text) };
      break;
    } catch {
      // Kept, and passed over: an older copy that reads still comes back.
    }
  }
  if (!found) {
    return 'unreadable';
  }
  const { key, text, value } = found;
  const copy = { key, text };
  if (!isEmptyBundleText(liveText)) {
    await putCopy(liveText);
  }
  await show(value);
  if ((await readLarge(copy.key)) === copy.text) {
    await removeLargeItem(copy.key);
  }
  return 'restored';
}

/** Reset all data: every aside copy goes, with the rest of the workout data. */
export async function removeWorkoutAsideCopies(): Promise<void> {
  for (const key of await asideKeys()) {
    await removeLargeItem(key);
  }
}
