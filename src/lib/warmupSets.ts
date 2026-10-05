import type { WorkoutSlotHistoryEntry, WorkoutSlotHistorySet } from '../features/workout/workoutTypes';

/**
 * Warm-up sets and working sets, told apart for automated progression.
 *
 * Progression used to read every logged set as work: it took the heaviest
 * load and put it, plus the increment, on every set. A pyramid of 50/60/70
 * came back as 72.5/72.5/72.5, so the warm-up jumped 45 % (bug hunt,
 * 2026-10-05). The agreed rule (user, 2026-10-05, "D + A"): a warm-up never
 * progresses, and each working set progresses from its own last load.
 *
 * A warm-up the reader adds with "+ Warm-up set" is stored apart from the
 * working sets (the entry's `warmups`), so it never reaches `sets` at all.
 * What this module infers is the other case: a warm-up logged as an ordinary
 * set, by a reader who did not use the button or by a build before it.
 */

/**
 * Below this share of the heaviest set, a light set before it reads as a
 * warm-up (user, 2026-10-05). Compared as `load * 10 < heaviest * 7`, so 49
 * against 70 is work and 48.9 is a warm-up.
 */
export const WARMUP_SHARE_TENTHS = 7;

const SAME_LOAD_KG = 0.001;

function byOrder(sets: readonly WorkoutSlotHistorySet[]): WorkoutSlotHistorySet[] {
  return [...sets].sort((left, right) => left.setIndex - right.setIndex);
}

/**
 * The entry as progression should read it: its working sets only, numbered
 * 0, 1, 2 … in the order they were done.
 *
 * A set is inferred to be a warm-up when it came before the first set at the
 * heaviest load and was under 70 % of it — and only as many of them as the
 * session ran past the programme's set count, lightest first. Without that
 * cap a 60/80/100 pyramid on a three-set programme lost its 60 to the rule and
 * held forever on "too few sets" (spec review, 2026-10-05): a session that did
 * exactly what the programme asked has no warm-ups in it to find.
 *
 * Nothing inferred: the entry comes back as it was, set numbers untouched, so
 * every session without a warm-up reads exactly as it did before.
 */
export function toWorkingHistoryEntry(
  entry: WorkoutSlotHistoryEntry,
  targetSets: number,
): WorkoutSlotHistoryEntry {
  const cap = Math.max(0, entry.sets.length - Math.max(0, Math.floor(targetSets)));
  if (cap === 0) {
    return entry;
  }
  const ordered = byOrder(entry.sets);
  const heaviest = ordered.reduce((max, set) => Math.max(max, set.loadKg), 0);
  if (!(heaviest > 0)) {
    return entry;
  }
  const firstHeavy = ordered.findIndex((set) => Math.abs(set.loadKg - heaviest) < SAME_LOAD_KG);
  const candidates = ordered
    .slice(0, firstHeavy)
    .filter((set) => set.loadKg > 0 && set.loadKg * 10 < heaviest * WARMUP_SHARE_TENTHS - 1e-9)
    .sort((left, right) => left.loadKg - right.loadKg || left.setIndex - right.setIndex)
    .slice(0, cap);
  if (candidates.length === 0) {
    return entry;
  }
  const warmups = new Set(candidates);
  const working = ordered
    .filter((set) => !warmups.has(set))
    .map((set, ordinal) => ({ ...set, setIndex: ordinal }));
  return { ...entry, sets: working };
}

/**
 * The sets that decide whether a session earned more load: every set up to and
 * including the last one at the session's heaviest load. The lighter sets after
 * it — a drop or a back-off, 80/75/70 — are exempt, or a descending pattern
 * would never progress; the sets before it are not, so 60×6, 60×6, 60×6 with a
 * 70×12 on top does not earn a jump on the strength of the top set (spec
 * review, 2026-10-05). Straight sets and an ascending pyramid: every set, as
 * before.
 */
export function gatingSets(sets: readonly WorkoutSlotHistorySet[]): WorkoutSlotHistorySet[] {
  const ordered = byOrder(sets);
  if (ordered.length === 0) {
    return ordered;
  }
  const heaviest = ordered.reduce((max, set) => Math.max(max, set.loadKg), Number.NEGATIVE_INFINITY);
  let lastHeavy = ordered.length - 1;
  while (lastHeavy > 0 && Math.abs(ordered[lastHeavy].loadKg - heaviest) >= SAME_LOAD_KG) {
    lastHeavy -= 1;
  }
  return ordered.slice(0, lastHeavy + 1);
}
