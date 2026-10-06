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
 * heaviest load and was under 70 % of it — and only in a session that ran past
 * the programme's set count. A session that did exactly what the programme
 * asked has no warm-ups in it to find: a 60/80/100 pyramid on a three-set
 * programme keeps its 60 as work, or it would hold forever on "too few sets"
 * (spec review, 2026-10-05). Once the session did run over, every such set is
 * a warm-up, not only as many as it ran over by: 40/60/100/100 on three sets
 * counted the 60 as set 1 and raised it with an AUTO badge (breaker, same day).
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
    .filter((set) => set.loadKg > 0 && set.loadKg * 10 < heaviest * WARMUP_SHARE_TENTHS - 1e-9);
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

/**
 * Without a warm-up of last time's to repeat, a ladder up to the first working
 * set: half of it for ten, 70 % for six, then 85 % for three, and the last rung
 * again for any past that. Rounded to the 2.5 kg a pair of plates can build.
 */
const WARMUP_LADDER: readonly { share: number; reps: number }[] = [
  { share: 0.5, reps: 10 },
  { share: 0.7, reps: 6 },
  { share: 0.85, reps: 3 },
];

const PLATE_STEP_KG = 2.5;

/**
 * The ladder off one working load, as a lifter would load it: every rung on a
 * plate step, above nothing and below the work, each heavier than the one
 * before.
 *
 * Rounded to the nearest plate step alone, a light load came out wrong: 5 kg
 * gave 2.5 / 2.5 / 5 — one rung twice, and a "warm-up" at the working weight —
 * and 2 kg gave 0 / 2.5 / 2.5, nothing and then more than the work (bug hunt
 * W10, 2026-10-05). So a rung
 * the rounding lifts to the work steps down a plate, a rung at nothing goes,
 * and a rung no heavier than the one below it goes too (the first of them
 * stays, with its higher reps). A light lift gets fewer rungs — 5 kg one,
 * 10 kg two — and a load of one plate step or less none: there is no warm-up
 * below it to load, and "+ Warm-up set" opens on an empty weight for the
 * reader to choose.
 */
export function warmupLadder(workingLoadKg: number | null | undefined): { loadKg: number; reps: number }[] {
  if (typeof workingLoadKg !== 'number' || !Number.isFinite(workingLoadKg) || !(workingLoadKg > 0)) {
    return [];
  }
  const rungs: { loadKg: number; reps: number }[] = [];
  WARMUP_LADDER.forEach((rung) => {
    let loadKg = Math.round((workingLoadKg * rung.share) / PLATE_STEP_KG) * PLATE_STEP_KG;
    while (loadKg > 0 && loadKg > workingLoadKg - SAME_LOAD_KG) {
      loadKg -= PLATE_STEP_KG;
    }
    const below = rungs[rungs.length - 1];
    if (loadKg > SAME_LOAD_KG && (!below || loadKg > below.loadKg + SAME_LOAD_KG)) {
      rungs.push({ loadKg, reps: rung.reps });
    }
  });
  return rungs;
}

/**
 * What "+ Warm-up set" opens on for the warm-up at `index` (0 for the first).
 *
 * Last time's warm-up at the same place, as it was done — a warm-up never
 * progresses (user, 2026-10-05) — unless it is no lighter than today's work
 * (a deload, or a slot now holding a lighter lift): a warm-up is below the
 * work. Otherwise the ladder off the first working set's load (warmupLadder),
 * its top rung again past its end; with no load to climb to, or one too light
 * to climb, the reps alone and an empty weight.
 */
export function warmupOffer(
  lastWarmups: readonly { loadKg: number; reps: number }[] | undefined,
  index: number,
  workingLoadKg: number | null | undefined,
): { loadKg: number | null; reps: number } {
  const working = typeof workingLoadKg === 'number' && workingLoadKg > 0 ? workingLoadKg : null;
  // A warm-up of no weight is not one to repeat: the ladder offers a load.
  const repeated = lastWarmups?.[index];
  if (repeated && repeated.loadKg > 0 && (working === null || repeated.loadKg < working - SAME_LOAD_KG)) {
    return { loadKg: repeated.loadKg, reps: repeated.reps };
  }
  const at = Math.max(0, index);
  const ladder = warmupLadder(working);
  if (ladder.length === 0) {
    return { loadKg: null, reps: WARMUP_LADDER[Math.min(at, WARMUP_LADDER.length - 1)].reps };
  }
  const rung = ladder[Math.min(at, ladder.length - 1)];
  return { loadKg: rung.loadKg, reps: rung.reps };
}
