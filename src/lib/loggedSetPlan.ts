import { ExerciseLogSetPlan, ExerciseLogSetPlanBasis, SetupCautionArea } from '../types/models';

/**
 * What the app opened a set at, kept next to what was actually done.
 *
 * The saved log used to carry only the reader's own numbers: the prefill the
 * progression gate chose — and why — was dropped at save. So the one question
 * a log should be able to answer about a heavy set ("did the app put that
 * weight there, or did I?") had no answer after the session ended (liability
 * review, 2026-09-30). This is the answer, written once at save and never
 * changed afterwards.
 *
 * The plan is the session-start prefill. Mid-session the guided player may
 * open a later set on what the previous set actually lifted; that is the
 * reader's own number carried forward, not the app's plan, and the logged
 * weight already records it. A set the reader adds opens on the set before
 * it and is saved as `added`, never as a suggestion; a swap re-resolves the
 * set from the new lift's own history (`borrowed`, or `none`).
 */

/** The live set's prefill fields, as workoutTypes.WorkoutSetInstance holds them. */
export interface PlannedSetSource {
  plannedLoadKg?: number;
  plannedRepsMin: number;
  plannedRepsMax: number;
  plannedTargetReps?: number;
  rampTargetReps?: number;
  autoProgressedFromKg?: number;
  autoProgressedFromReps?: number;
  heldForFatigue?: boolean;
  heldForCautionArea?: SetupCautionArea;
  prefilledFromPerformedAt?: string;
  addedMidSession?: boolean;
  /** An added set a swap re-resolved: its number is the app's again. */
  plannedBySwap?: boolean;
}

const BASES: readonly ExerciseLogSetPlanBasis[] = [
  'added',
  'progressed',
  'held_caution',
  'held_recovery',
  'borrowed',
  'repeat',
  'none',
];

const AREAS: readonly SetupCautionArea[] = [
  'neck',
  'shoulders',
  'elbows',
  'wrists',
  'lower_back',
  'hips',
  'knees',
  'ankles',
];

/** The dial's own ceilings: nothing the app could have planned lies past them. */
const MAX_PLAN_LOAD_KG = 1000;
const MAX_PLAN_REPS = 1000;

function finite(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

/**
 * Why the opening number is what it is, from the fields the gate set.
 *
 * Order matters only where two could be set at once: a progression and a hold
 * never are (the gate returns one or the other), and a borrowed weight never
 * went through the gate at all.
 */
function basisOf(set: PlannedSetSource): ExerciseLogSetPlanBasis {
  // First: an added set copies the previous set's weight, which is usually
  // the reader's own — whatever else that set carried, this one is theirs.
  // Unless a swap has since re-resolved it from the new lift's history: then
  // the fields below say what the app put there.
  if (set.addedMidSession && !set.plannedBySwap) return 'added';
  if (set.autoProgressedFromKg !== undefined || set.autoProgressedFromReps !== undefined) return 'progressed';
  if (set.heldForCautionArea) return 'held_caution';
  if (set.heldForFatigue) return 'held_recovery';
  if (set.prefilledFromPerformedAt) return 'borrowed';
  if (set.plannedLoadKg !== undefined || set.plannedTargetReps !== undefined || set.rampTargetReps !== undefined) return 'repeat';
  return 'none';
}

export function buildLoggedSetPlan(set: PlannedSetSource): ExerciseLogSetPlan {
  const basis = basisOf(set);
  return {
    loadKg: finite(set.plannedLoadKg, MAX_PLAN_LOAD_KG),
    repsMin: finite(set.plannedRepsMin, MAX_PLAN_REPS) ?? 0,
    repsMax: finite(set.plannedRepsMax, MAX_PLAN_REPS) ?? 0,
    // The set's own ramp target when it had one: that is what the dial asked.
    targetReps: finite(set.rampTargetReps ?? set.plannedTargetReps, MAX_PLAN_REPS),
    basis,
    fromKg: basis === 'progressed' ? finite(set.autoProgressedFromKg, MAX_PLAN_LOAD_KG) : null,
    fromReps: basis === 'progressed' ? finite(set.autoProgressedFromReps, MAX_PLAN_REPS) : null,
    cautionArea: basis === 'held_caution' ? set.heldForCautionArea ?? null : null,
  };
}

/**
 * A stored plan, re-read on load. Anything malformed is dropped whole rather
 * than repaired: a plan the app cannot vouch for is worse than none, because
 * its only use is to be believed later.
 */
export function normalizeLoggedSetPlan(value: unknown): ExerciseLogSetPlan | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const basis = row.basis as ExerciseLogSetPlanBasis;
  if (!BASES.includes(basis)) return null;
  const repsMin = finite(row.repsMin, MAX_PLAN_REPS);
  const repsMax = finite(row.repsMax, MAX_PLAN_REPS);
  if (repsMin === null || repsMax === null) return null;
  const nullable = (key: string, max: number): number | null | undefined =>
    row[key] === null || row[key] === undefined ? null : finite(row[key], max) ?? undefined;
  const loadKg = nullable('loadKg', MAX_PLAN_LOAD_KG);
  const targetReps = nullable('targetReps', MAX_PLAN_REPS);
  const fromKg = nullable('fromKg', MAX_PLAN_LOAD_KG);
  const fromReps = nullable('fromReps', MAX_PLAN_REPS);
  if (loadKg === undefined || targetReps === undefined || fromKg === undefined || fromReps === undefined) {
    return null;
  }
  const cautionArea = row.cautionArea === null || row.cautionArea === undefined ? null : row.cautionArea;
  if (cautionArea !== null && !AREAS.includes(cautionArea as SetupCautionArea)) return null;
  return {
    loadKg,
    repsMin,
    repsMax,
    targetReps,
    basis,
    fromKg,
    fromReps,
    cautionArea: cautionArea as SetupCautionArea | null,
  };
}
