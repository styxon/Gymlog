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
 * a weight, a rep target above last time's on some set and below it on none —
 * over at least as many sets as last time, or as the programme asks when last
 * time logged more than that.
 * Every set must be logged at its target — the reps, and the planned weight
 * where there is one. Holds and bouts of minutes are left out: their numbers
 * are seconds, and the rule is about reps.
 */

interface PraiseSet {
  status: string;
  plannedLoadKg?: number;
  plannedRepsMax: number;
  plannedTargetReps?: number;
  rampTargetReps?: number;
  actualLoadKg?: number;
  actualReps?: number;
}

interface PraiseLastSet {
  loadKg: number;
  reps: number;
}

interface LiftPraise {
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
  lastSession: readonly PraiseLastSet[] | null | undefined,
  trackingMode: string,
  /**
   * The programme's set count for today. Where last time logged more sets
   * than the programme asks, today's sets are compared with last time's up to
   * that count — the sets they stand for, as the gate read that session when
   * it raised the load (owner, 2026-10-11, hunt 12 A11-4). Without it, or
   * when today did fewer than the programme asks, last time is read whole.
   */
  programmeSets?: number,
): LiftPraise | null {
  if (trackingMode === 'hold' || trackingMode === 'duration_minutes') {
    return null;
  }
  const last =
    lastSession &&
    typeof programmeSets === 'number' &&
    programmeSets > 0 &&
    lastSession.length > programmeSets &&
    sets.length >= programmeSets
      ? lastSession.slice(0, Math.max(programmeSets, sets.length))
      : lastSession;
  // A first time has nothing to beat, and fewer sets than last time is not
  // more than last time, however the sets compare one by one.
  if (!last || last.length === 0 || sets.length < last.length) {
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

/**
 * Which lift the walk-up banner may praise: the one whose last set the reader
 * has just logged, never the one they are walking up to.
 *
 * The banner sits on the NEXT lift's card, so the step before the walk-up must
 * be a set, of a different slot than the walk-up's own (a lift's card never
 * praises itself). Null when there is no such lift.
 */
export function praisedSlotBeforeWalkUp(
  before: { type: string; slotId?: string } | null | undefined,
  current: { type: string; slotId?: string },
): string | null {
  if (current.type !== 'position' || !before || before.type !== 'set' || !before.slotId) {
    return null;
  }
  return before.slotId === current.slotId ? null : before.slotId;
}
