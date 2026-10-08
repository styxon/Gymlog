/**
 * Praise for a lift that met a target set higher than last time.
 *
 * Asked for at the gym (#bugs 2026-10-08): the walk-up card had said the bench
 * "has not moved in 3 sessions" and the next step was 3 × 7 — "jos käyttäjä
 * tekee tämän tulisi joku loistavaa teksti". The card that names a stall
 * should also name the step that ends it.
 *
 * Only for a step up, never for a repeat: praise on every lift met as planned
 * would be a label on the normal case, and the reader stops reading it. A step
 * up is a heavier planned weight than last time's heaviest, or, at no lighter
 * a weight, a rep target above last time's on some set and below it on none.
 * Every set must be logged at its target — the reps, and the planned weight
 * where there is one. Holds and bouts of minutes are left out: their numbers
 * are seconds, and the rule is about reps.
 */

export interface PraiseSet {
  status: string;
  plannedLoadKg?: number;
  plannedRepsMax: number;
  plannedTargetReps?: number;
  rampTargetReps?: number;
  actualLoadKg?: number;
  actualReps?: number;
}

export interface PraiseLastSet {
  loadKg: number;
  reps: number;
}

export interface LiftPraise {
  /** What was done, set by set. */
  reps: number[];
  /** The heaviest weight lifted, or null for an unloaded lift. */
  loadKg: number | null;
}

const EPSILON = 0.001;

/** The reps a set was asked for: a ramp's own, a lowered target, else the programme's. */
function targetRepsOf(set: PraiseSet): number {
  return set.rampTargetReps ?? set.plannedTargetReps ?? set.plannedRepsMax;
}

export function resolveLiftPraise(
  sets: readonly PraiseSet[],
  last: readonly PraiseLastSet[] | null | undefined,
  trackingMode: string,
): LiftPraise | null {
  if (trackingMode === 'hold' || trackingMode === 'duration_minutes') {
    return null;
  }
  // A first time has nothing to beat.
  if (!last || last.length === 0 || sets.length === 0) {
    return null;
  }
  if (!sets.every((set) => set.status === 'completed' && typeof set.actualReps === 'number')) {
    return null;
  }
  const loaded = trackingMode !== 'bodyweight';
  const met = sets.every(
    (set) =>
      (set.actualReps as number) >= targetRepsOf(set) &&
      (!loaded || set.plannedLoadKg === undefined || (set.actualLoadKg ?? 0) >= set.plannedLoadKg - EPSILON),
  );
  if (!met) {
    return null;
  }

  const plannedTop = loaded ? Math.max(0, ...sets.map((set) => set.plannedLoadKg ?? 0)) : 0;
  const lastTop = loaded ? Math.max(0, ...last.map((set) => set.loadKg)) : 0;
  const loadUp = loaded && plannedTop > lastTop + EPSILON;
  const compared = sets.map((set, index) => ({ target: targetRepsOf(set), was: last[index]?.reps }));
  const repsUp =
    plannedTop >= lastTop - EPSILON &&
    compared.every(({ target, was }) => was === undefined || target >= was) &&
    compared.some(({ target, was }) => was !== undefined && target > was);
  if (!loadUp && !repsUp) {
    return null;
  }

  const lifted = sets.map((set) => set.actualLoadKg ?? 0);
  return {
    reps: sets.map((set) => set.actualReps as number),
    loadKg: loaded && Math.max(...lifted) > 0 ? Math.max(...lifted) : null,
  };
}
