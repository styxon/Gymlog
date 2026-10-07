/**
 * Today's changes to today's session, decided before it starts.
 *
 * The Home screen lets you shorten the session and swap a lift out while you
 * are still looking at the plan. Neither can be written into a workout session,
 * because there is no session yet — so an adaptation is held for this start
 * only and applied to the runtime template on the way in. Both start paths
 * (ready program and custom program) funnel through the same
 * `startCustomWorkout(runtimeTemplate, …)` call, so one function applied there
 * covers both.
 *
 * It deliberately does not persist. An adaptation is an answer to "how is today
 * going", and a stale one is worse than none — if the session is not started,
 * the change goes away with it. While it waits, it is held for the one session
 * it was made on and the day it was made on (see HeldSessionAdaptations).
 *
 * What is NOT here, on purpose:
 * - Equipment substitution. A taken rack is discovered in the gym, not at home
 *   on the sofa; that is what the player's own swap is for.
 * - A load multiplier. Whether you have the strength for a weight is answered
 *   set by set, and the player's weight control does it in one tap — deciding
 *   it in advance for the whole session would be a guess about how you will
 *   feel in forty minutes.
 */

import { WorkoutRuntimeTemplate, WorkoutTemplateExercise } from '../features/workout/workoutTypes';
import { estimateSessionMinutes } from './sessionDuration';
import { doseAfterSwap, isSameLiftName } from './swapDose';

export interface SessionAdaptation {
  /** Template slot id → the exercise name to do instead. */
  swaps: Record<string, string>;
  /**
   * Slot ids left out of today's session.
   *
   * Same scope as a swap: an answer about today, spent when the session
   * starts, and never a change to the programme — the programme is edited from
   * its own page. A reader who cannot use one machine today should not have to
   * rewrite their plan to get past it.
   */
  drops: string[];
}

export const EMPTY_SESSION_ADAPTATION: SessionAdaptation = { swaps: {}, drops: [] };

export function hasSessionAdaptation(adaptation: SessionAdaptation | null | undefined): boolean {
  return Boolean(
    adaptation &&
      (Object.keys(adaptation.swaps).length > 0 || (adaptation.drops?.length ?? 0) > 0),
  );
}

/**
 * The slot as the swapped-in lift: its own name, the way it is logged (and
 * numbers in that unit), and the programmed lift on record.
 *
 * The name alone was not the lift. The slot kept the programmed lift's
 * tracking mode — a pull-up swapped here for a lat pulldown started with no
 * weight dial — and nothing said a swap had happened, so the save filed the
 * pulldown under the programme's pull-up (swap audit, 2026-09-21). The mode
 * follows the player's own swap (trackingModeAfterSwap). The dose is
 * doseAfterSwap, the rule "For ever" writes into the programme and the row
 * prints before the start, so both scope buttons give one prescription.
 */
function applySwap(exercise: WorkoutTemplateExercise, name: string): WorkoutTemplateExercise {
  if (isSameLiftName(name, exercise.exerciseName)) {
    return exercise;
  }
  const { trackingMode, sets, repsMin, repsMax } = doseAfterSwap(
    {
      trackingMode: exercise.trackingMode,
      sets: exercise.sets,
      repsMin: exercise.repsMin,
      repsMax: exercise.repsMax,
      supersetGroup: exercise.supersetGroup,
    },
    name,
  );
  return {
    ...exercise,
    exerciseName: name,
    trackingMode,
    sets,
    repsMin,
    repsMax,
    sourceExerciseName: exercise.sourceExerciseName ?? exercise.exerciseName,
  };
}

/**
 * The adapted template to start from. Returns the input untouched when there is
 * nothing to apply, so the ordinary path allocates nothing.
 */
export function applySessionAdaptation(
  template: WorkoutRuntimeTemplate,
  adaptation: SessionAdaptation | null | undefined,
): WorkoutRuntimeTemplate {
  if (!hasSessionAdaptation(adaptation) || !adaptation) {
    return template;
  }

  const dropped = new Set(adaptation.drops ?? []);
  const withoutDropped = dropped.size
    ? template.sessions.map((session) => ({
        ...session,
        exercises: session.exercises.filter((exercise) => !dropped.has(exercise.slotId)),
      }))
    : template.sessions;

  return {
    ...template,
    sessions: withoutDropped.map((session) => ({
      ...session,
      exercises: session.exercises.map((exercise) => {
        const swapName = adaptation.swaps[exercise.slotId];
        return swapName ? applySwap(exercise, swapName) : exercise;
      }),
    })),
  };
}

/** The session an adaptation was made for: one day of one programme. */
export interface AdaptedSessionRef {
  programId: string;
  sessionId: string;
}

/**
 * Today's adaptations, each held for the session it was made on.
 *
 * They used to be one set of swaps and drops keyed by slot id alone, spent
 * only when a session started. A slot id is not unique to a day — 51 of the 57
 * ready programmes reuse them across days — so on a three-day full body, a
 * back squat swapped for goblet squats on day A's Home card turned day B's leg
 * press into goblet squats once B was picked for today instead, and the bench
 * left out of A took B's overhead press with it. Nothing let them go at
 * midnight or on "Reset all data" either (swap audit, 2026-09-21).
 *
 * So each is filed under the programme and day it was made on, the whole set
 * is dated, and it is read back only for that session on that date.
 */
export interface HeldSessionAdaptations {
  /** Local midnight of the day these were made on. */
  dayStart: number;
  bySession: Record<string, SessionAdaptation>;
}

export const NO_HELD_SESSION_ADAPTATIONS: HeldSessionAdaptations = { dayStart: 0, bySession: {} };

function heldKey(ref: AdaptedSessionRef) {
  // Both ids are free text as far as this module knows; an array cannot run
  // one into the other the way a joined string can.
  return JSON.stringify([ref.programId, ref.sessionId]);
}

/**
 * This session's adaptation today: none when the ones held were made for
 * another session, or on another day.
 */
export function heldAdaptationFor(
  held: HeldSessionAdaptations,
  ref: AdaptedSessionRef | null | undefined,
  todayStart: number,
): SessionAdaptation {
  if (!ref || held.dayStart !== todayStart) {
    return EMPTY_SESSION_ADAPTATION;
  }
  return held.bySession[heldKey(ref)] ?? EMPTY_SESSION_ADAPTATION;
}

/**
 * One session's adaptation, changed. Whatever is held from an earlier day is
 * let go on the way — it answered a day that is over.
 */
export function updateHeldAdaptation(
  held: HeldSessionAdaptations,
  ref: AdaptedSessionRef,
  todayStart: number,
  change: (current: SessionAdaptation) => SessionAdaptation,
): HeldSessionAdaptations {
  const bySession = held.dayStart === todayStart ? { ...held.bySession } : {};
  const key = heldKey(ref);
  const next = change(bySession[key] ?? EMPTY_SESSION_ADAPTATION);
  if (hasSessionAdaptation(next)) {
    bySession[key] = next;
  } else {
    delete bySession[key];
  }
  return { dayStart: todayStart, bySession };
}

/**
 * Spent: the session it was made for has started. The ones held for other
 * sessions stay — each still answers for its own day.
 */
export function spendHeldAdaptation(
  held: HeldSessionAdaptations,
  ref: AdaptedSessionRef,
): HeldSessionAdaptations {
  const key = heldKey(ref);
  if (!(key in held.bySession)) {
    return held;
  }
  const bySession = { ...held.bySession };
  delete bySession[key];
  return { ...held, bySession };
}

/**
 * Today's swap on one slot. Picking the programme's own lift back undoes the
 * swap rather than swapping to it: held, it kept the row marked as swapped
 * and offered "Keep in programme" for an edit that changed nothing — on a
 * ready programme a whole copy, and a free programme slot, for X → X (swap
 * hunt, 2026-10-07).
 */
export function withSessionSwap(
  adaptation: SessionAdaptation,
  slotId: string,
  exerciseName: string,
  programmeName?: string,
): SessionAdaptation {
  if (programmeName !== undefined && isSameLiftName(exerciseName, programmeName)) {
    const swaps = { ...adaptation.swaps };
    delete swaps[slotId];
    return { ...adaptation, swaps };
  }
  return { ...adaptation, swaps: { ...adaptation.swaps, [slotId]: exerciseName } };
}

/** Left out once: dropping a slot twice does not list it twice. */
export function withSessionDrop(adaptation: SessionAdaptation, slotId: string): SessionAdaptation {
  const drops = adaptation.drops ?? [];
  return drops.includes(slotId) ? adaptation : { ...adaptation, drops: [...drops, slotId] };
}

export function withoutSessionDrop(adaptation: SessionAdaptation, slotId: string): SessionAdaptation {
  return { ...adaptation, drops: (adaptation.drops ?? []).filter((id) => id !== slotId) };
}

/**
 * The programme took the swap: "Keep this swap in my programme" wrote the lift
 * into the day, and an override on a slot that already says it is nothing
 * but a stale mark on the row.
 */
export function withoutSessionSwapsTo(adaptation: SessionAdaptation, exerciseName: string): SessionAdaptation {
  const swaps = Object.fromEntries(Object.entries(adaptation.swaps).filter(([, name]) => name !== exerciseName));
  return { ...adaptation, swaps };
}


