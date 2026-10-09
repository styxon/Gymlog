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

import { customSlotId, WorkoutRuntimeTemplate, WorkoutTemplateExercise } from '../features/workout/workoutTypes';
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
 * pulldown under the programme's pull-up (swap audit, 2026-09-21). The same
 * rule as the player's own swap and "For ever" (doseAfterSwap), so a swap made
 * here and one made there are saved alike.
 */
function applySwap(exercise: WorkoutTemplateExercise, name: string): WorkoutTemplateExercise {
  if (isSameLiftName(name, exercise.exerciseName)) {
    return exercise;
  }
  const { trackingMode, repsMin, repsMax } = doseAfterSwap(
    {
      trackingMode: exercise.trackingMode,
      sets: exercise.sets,
      repsMin: exercise.repsMin,
      repsMax: exercise.repsMax,
    },
    name,
  );
  return {
    ...exercise,
    exerciseName: name,
    trackingMode,
    repsMin,
    repsMax,
    sourceExerciseName: exercise.sourceExerciseName ?? exercise.exerciseName,
    // The numbers above are the incoming lift's; the player restores these
    // if the programme's lift is picked back (exercise/swap).
    programmedDose: exercise.programmedDose ?? {
      trackingMode: exercise.trackingMode,
      repsMin: exercise.repsMin,
      repsMax: exercise.repsMax,
    },
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

/**
 * Whether the adapted session has nothing left to train. Every row can be left
 * out for today, and a session started like that opened an empty player.
 */
export function sessionHasNoExercises(template: WorkoutRuntimeTemplate): boolean {
  return template.sessions.every((session) => session.exercises.length === 0);
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



/**
 * Today's holds, carried from one programme's day to the same day of its copy.
 *
 * The first edit of a ready programme copies it into a programme of the
 * reader's own with new programme, day and row ids, and a held entry is keyed
 * by the old ones — the day under the catalogue programme's ids, each slot
 * under the catalogue's slot ids. Left where they were, the swaps and drops
 * the reader had chosen for today stayed on a programme Home no longer reads,
 * and the session started as the programme wrote it (hunt 9, 2026-10-09).
 */
export interface HeldSessionMove {
  from: AdaptedSessionRef;
  to: AdaptedSessionRef;
  /** Old slot id -> new slot id. A slot with no entry is gone from the copy. */
  slots: Record<string, string>;
}

function translateAdaptation(adaptation: SessionAdaptation, slots: Record<string, string>): SessionAdaptation {
  const swaps: Record<string, string> = {};
  for (const [slotId, name] of Object.entries(adaptation.swaps)) {
    if (slots[slotId]) {
      swaps[slots[slotId]] = name;
    }
  }
  const drops = (adaptation.drops ?? []).filter((slotId) => slots[slotId]).map((slotId) => slots[slotId]);
  return { swaps, drops };
}

/**
 * The held adaptations with each move applied: the entry filed under `from`
 * leaves it and is filed under `to`, its slot ids translated. A swap or drop on
 * a row the copy does not have is let go with the row. Returns the input
 * untouched when nothing was held for any `from`.
 */
export function moveHeldAdaptations(
  held: HeldSessionAdaptations,
  moves: readonly HeldSessionMove[],
): HeldSessionAdaptations {
  let bySession: Record<string, SessionAdaptation> | null = null;
  for (const move of moves) {
    const fromKey = heldKey(move.from);
    const current = (bySession ?? held.bySession)[fromKey];
    if (!current) {
      continue;
    }
    bySession = bySession ?? { ...held.bySession };
    delete bySession[fromKey];
    const moved = translateAdaptation(current, move.slots);
    if (hasSessionAdaptation(moved)) {
      bySession[heldKey(move.to)] = moved;
    }
  }
  return bySession ? { ...held, bySession } : held;
}

/** One day of a ready programme, as far as the move needs to know it. */
export interface CatalogueDayForMove {
  id: string;
  exercises: ReadonlyArray<{ id: string; slotId: string }>;
}

/** The same day in the copy: its stored id, and each stored row with the catalogue row it came from. */
export interface CopiedDayForMove {
  id: string;
  exercises: ReadonlyArray<{ id: string; fromExerciseId: string | null }>;
}

/**
 * The moves that carry today's holds from a ready programme to its copy. Days
 * pair by position (they are copied in order); rows pair by position too, the
 * copy having the catalogue's rows less one removed, reordered, or with one
 * added, which is why each copied row says which catalogue row it came from.
 */
export function planHeldMovesToCopy(input: {
  programId: string;
  copyId: string;
  days: readonly CatalogueDayForMove[];
  copiedDays: readonly CopiedDayForMove[];
}): { moves: HeldSessionMove[]; sessionIds: Record<string, string> } {
  const moves: HeldSessionMove[] = [];
  const sessionIds: Record<string, string> = {};
  input.days.forEach((day, index) => {
    const copied = input.copiedDays[index];
    if (!copied) {
      return;
    }
    const slotByExerciseId = new Map(day.exercises.map((exercise) => [exercise.id, exercise.slotId]));
    const slots: Record<string, string> = {};
    for (const row of copied.exercises) {
      const oldSlot = row.fromExerciseId ? slotByExerciseId.get(row.fromExerciseId) : undefined;
      if (oldSlot) {
        slots[oldSlot] = customSlotId(row.id);
      }
    }
    sessionIds[day.id] = copied.id;
    moves.push({
      from: { programId: input.programId, sessionId: day.id },
      to: { programId: input.copyId, sessionId: copied.id },
      slots,
    });
  });
  return { moves, sessionIds };
}
