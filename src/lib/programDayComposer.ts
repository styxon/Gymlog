import { WorkoutTemplateExercise } from '../features/workout/workoutTypes';
import { getWorkoutTemplateById, WORKOUT_SUBSTITUTION_GROUPS } from '../features/workout/workoutCatalog';
import { buildRecommendationPlanReadyPayload } from './recommendationProgramme';
import { READY_PROGRAM_MIN_BLOCK_WEEKS } from './readyProgramDuration';
import { applyCautionFlagsToExercises, CautionExerciseSwap } from './cautionExerciseFilter';
import { applyEquipmentToExercises, isExerciseAllowedWithEquipment, resolveAvailableEquipment } from './equipmentExerciseFilter';
import { buildFocusEmphasisAdditions, FocusEmphasisAddition } from './focusEmphasis';
import { composedSlotDose, FOCUS_ACCESSORY_POOL, getCatalogTrackingMode, SUPPLEMENTAL_DAY_POOL } from './catalogExercisePools';
import { classifySessionFocus, SessionFocusKind } from './homeSessionHero';
import { estimateProgrammeSessionMinutes } from './programmeMinutes';
import type { FirstRunSetupSelection } from './firstRunSetup';
import type { SetupFocusArea, SetupWeekday } from '../types/models';

/**
 * Days-per-week truth (onboarding truth plan P1).
 *
 * The week the user is shown and the week that gets saved must be the SAME
 * composition: the catalog template trimmed or extended to the user's chosen
 * days per week. This module is the single source for that composed week —
 * `App.tsx` saves it and `OnboardingScreen` previews it, so the two can't
 * drift apart.
 */

export interface ComposedProgramSession {
  id: string;
  /** Raw schedule-day name; format with formatWorkoutDisplayLabel for UI. */
  name: string;
  /**
   * The weekday this session lands on, from the schedule the reader chose
   * (user 2026-08-24: "päivät ei päivämäärät vaan viikonpäivät").
   *
   * A weekday, deliberately, not a date. The plan has no start date yet on
   * this screen, so any date printed here would be one the app made up.
   */
  weekdayLabel: string;
  /**
   * The same day as a code the screen can translate. `weekdayLabel` is the
   * English one the brief carries; printing it is what put "Mon / Wed / Fri"
   * on a Finnish reader's finished week.
   */
  weekday: SetupWeekday | null;
  orderIndex: number;
  source: 'template' | 'suggested';
  exercises: WorkoutTemplateExercise[];
}

export interface ComposedProgramWeek {
  programId: string;
  sessions: ComposedProgramSession[];
  /** Actual training days in the composed week — always what the UI shows. */
  days: number;
  weeks: number;
  totalWorkouts: number;
  sessionMinutes: number;
  /**
   * The same week costed on the long end of each rest range — what the copy
   * onboarding saves keeps (onboardingHandoff), so the pick card quotes what
   * Home will show after saving. Every other screen quotes sessionMinutes,
   * the ready programme as it runs (review of #312).
   */
  savedCopySessionMinutes: number;
  /** True when the composed week differs from the template's own day count. */
  composed: boolean;
  /** Caution-flag effects applied to this week (P2 truth surface). */
  cautionRemoved: Array<{ name: string; area: string }>;
  cautionSwapped: CautionExerciseSwap[];
  /** Focus-area emphasis added to this week (P3 truth surface). */
  focusAdditions: FocusEmphasisAddition[];
  /** Equipment-driven changes to this week (P4 truth surface). */
  equipmentRemoved: string[];
  equipmentSwapped: Array<{ from: string; to: string }>;
}

function getFallbackTrackingMode(name: string): WorkoutTemplateExercise['trackingMode'] {
  // The catalog knows what each exercise needs; keyword guessing does not.
  return getCatalogTrackingMode(name);
}

export function buildComposedFallbackExercise(
  name: string,
  sessionId: string,
  exerciseIndex: number,
): WorkoutTemplateExercise {
  const role = exerciseIndex === 0 ? 'primary' : exerciseIndex < 3 ? 'secondary' : 'accessory';
  const trackingMode = getFallbackTrackingMode(name);
  // Dosed in the slot's own unit (composedSlotDose): a trail run or a
  // recumbent bike is one bout of minutes, not three sets of twelve "reps"
  // with a rest, and a stretch is held for seconds a stretch is held for.
  const dose = composedSlotDose(name, trackingMode, {
    sets: exerciseIndex === 0 ? 3 : 2,
    restSecondsMin: exerciseIndex === 0 ? 75 : 45,
    restSecondsMax: exerciseIndex === 0 ? 120 : 75,
  });

  return {
    id: `${sessionId}_exercise_${exerciseIndex + 1}`,
    exerciseName: name,
    slotId: `${role}_${exerciseIndex + 1}`,
    role,
    progressionPriority: exerciseIndex === 0 ? 'high' : exerciseIndex < 3 ? 'medium' : 'low',
    trackingMode,
    ...dose,
    substitutionGroup: resolveSubstitutionGroup(name, role, exerciseIndex),
  };
}

/**
 * The real swap group this exercise belongs to, by looking it up in the
 * catalog rather than inventing an id.
 *
 * This used to return `onboarding_primary_1` and friends — ids that exist in
 * no group — so getAllowedSwaps found nothing and NOTHING composed through
 * onboarding could be swapped. The list logger showed a Swap row that opened
 * an empty sheet; the guided player, which only offers the row when there is
 * something in it, showed no row at all. Either way the user could not
 * substitute a single exercise in the plan the app had just built for them.
 *
 * The synthetic id stays as the fallback: an exercise the catalog does not
 * group is genuinely unswappable, and a made-up group is more honest than
 * silently borrowing someone else's.
 */
function resolveSubstitutionGroup(name: string, role: string, exerciseIndex: number): string {
  const normalized = name.trim().toLowerCase();
  const group = WORKOUT_SUBSTITUTION_GROUPS.find((candidate) =>
    candidate.allowedExerciseNames.some((allowed) => allowed.trim().toLowerCase() === normalized),
  );
  return group?.id ?? `onboarding_${role}_${exerciseIndex + 1}`;
}

const REFILL_EXERCISE_COUNT = 3;

/** The accessory pools that train what a day was for. */
const REFILL_AREAS_BY_FOCUS: Record<SessionFocusKind, SetupFocusArea[]> = {
  push: ['chest', 'shoulders', 'arms', 'core'],
  pull: ['back', 'arms', 'shoulders', 'core'],
  upper: ['chest', 'back', 'shoulders', 'arms', 'core'],
  lower: ['legs', 'glutes', 'hamstrings', 'calves'],
  general: ['legs', 'chest', 'core', 'back'],
};

/**
 * Fills a day whose exercises were all removed, with lifts for what the day
 * was for: a chest day gets chest and shoulder work before anything generic
 * (review, 2026-10-04 — every refill was the same dips, rows and plank under
 * "Chest (Volume)" or "Arms (Heavy)"). Candidates go through the equipment
 * and caution filters, and the equipment check runs again after caution,
 * whose swaps are not gear-checked, so a refill never puts back what the
 * reader's gear or flags ruled out. The filters' removed/swapped bookkeeping
 * for the candidates is discarded: the reader never saw them.
 */
function refillEmptiedSession(
  session: ComposedProgramSession,
  originalNames: readonly string[],
  availableEquipment: string[] | null,
  cautionFlags: NonNullable<FirstRunSetupSelection['cautionFlags']>,
  selection: FirstRunSetupSelection,
): ComposedProgramSession {
  const focusPools = REFILL_AREAS_BY_FOCUS[classifySessionFocus([...originalNames])].map(
    (area) => FOCUS_ACCESSORY_POOL[area],
  );
  const pools = Object.values(SUPPLEMENTAL_DAY_POOL);
  const names = [
    ...new Set([
      ...focusPools.flatMap((pool) => pool.bodyweight),
      ...focusPools.flatMap((pool) => pool.loaded),
      ...pools.flatMap((pool) => pool.bodyweight),
      ...pools.flatMap((pool) => pool.loaded),
    ]),
  ];
  const candidates = names.map((name, index) => buildComposedFallbackExercise(name, session.id, index));
  const equipped = applyEquipmentToExercises(candidates, availableEquipment);
  const adjusted = applyCautionFlagsToExercises(equipped.exercises, cautionFlags, selection.focusAreas, availableEquipment);
  const seen = new Set<string>();
  const exercises = adjusted.exercises
    .filter((exercise) => isExerciseAllowedWithEquipment(exercise.exerciseName, availableEquipment))
    .filter((exercise) => {
      const key = exercise.exerciseName.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, REFILL_EXERCISE_COUNT)
    .map((exercise, index) => buildComposedFallbackExercise(exercise.exerciseName, session.id, index));
  return { ...session, source: 'suggested', exercises };
}

export function composeProgramWeekForSelection(
  selection: FirstRunSetupSelection,
  programId: string,
): ComposedProgramWeek | null {
  const template = getWorkoutTemplateById(programId);
  if (!template) {
    return null;
  }

  const payload = buildRecommendationPlanReadyPayload(selection, programId);
  const trainingDays = payload.weeklySchedule.filter(
    (day) => day.source === 'template' || day.keyLifts.length > 0,
  );

  const cautionFlags = selection.cautionFlags ?? [];
  const cautionRemoved: ComposedProgramWeek['cautionRemoved'] = [];
  const cautionSwapped: CautionExerciseSwap[] = [];

  const baseSessions = trainingDays.map((day, dayIndex): ComposedProgramSession => {
    const sourceSession =
      day.source === 'template' ? template.sessions.find((session) => session.id === day.id) ?? null : null;
    const sessionId = `onboarding_${programId}_${dayIndex + 1}`;
    const exercises = sourceSession
      ? sourceSession.exercises.map((exercise) => ({
          ...exercise,
          id: `${sessionId}_${exercise.id}`,
          slotId: `${exercise.slotId}_${dayIndex + 1}`,
        }))
      : day.keyLifts.map((lift, exerciseIndex) => buildComposedFallbackExercise(lift, sessionId, exerciseIndex));

    return {
      id: sessionId,
      name: day.name,
      weekdayLabel: day.weekdayLabel,
      weekday: day.weekday,
      orderIndex: dayIndex,
      source: sourceSession ? 'template' : 'suggested',
      exercises,
    };
  });

  // P4: the chosen equipment chips are the full truth about available gear.
  const availableEquipment = resolveAvailableEquipment(selection);

  // P3: focus areas add real weekly emphasis (+1 accessory small / +2 big),
  // added BEFORE the caution pass so flags can still veto or swap them. The
  // gear goes in first so a bodyweight setup gets a bodyweight accessory
  // rather than a barbell one the equipment pass would only have to strip.
  const emphasis = buildFocusEmphasisAdditions(baseSessions, selection.focusAreas, availableEquipment);
  const equipmentRemoved: string[] = [];
  const equipmentSwapped: Array<{ from: string; to: string }> = [];

  const filtered = baseSessions
    .map((session): ComposedProgramSession => {
      const withEmphasis = [...session.exercises, ...(emphasis.bySessionId.get(session.id) ?? [])];
      // Order matters: equipment first, caution LAST so bans always win —
      // an equipment fallback can never resurrect a flagged movement.
      const equipped = applyEquipmentToExercises(withEmphasis, availableEquipment);
      equipmentRemoved.push(...equipped.removed);
      equipmentSwapped.push(...equipped.swapped);

      // P2: caution flags change the actual movements — avoid removes,
      // careful swaps (bodyweight-first when the area is also a focus).
      const adjusted = applyCautionFlagsToExercises(equipped.exercises, cautionFlags, selection.focusAreas, availableEquipment);
      cautionRemoved.push(...adjusted.removed);
      cautionSwapped.push(...adjusted.swapped);

      return { ...session, exercises: adjusted.exercises };
    });

  // A day the filters emptied is refilled, not dropped: the chosen day count
  // is the reader's rhythm, and dropping the day saved a 6-day plan as 5 with
  // a "Day 6" naming gap and no notice (bug hunt, 2026-10-04). Only a day for
  // which nothing at all survives both filters leaves the week.
  const sessions = filtered
    .map((session) =>
      session.exercises.length > 0
        ? session
        : refillEmptiedSession(
            session,
            baseSessions.find((entry) => entry.id === session.id)?.exercises.map((exercise) => exercise.exerciseName) ?? [],
            availableEquipment,
            cautionFlags,
            selection,
          ),
    )
    .filter((session) => session.exercises.length > 0)
    .map((session, index) => ({ ...session, orderIndex: index }));

  // Report only emphasis that survived the caution pass (as-is or swapped) —
  // the truth surface must not claim additions the flags vetoed.
  const focusAdditions = emphasis.additions.filter((addition) => {
    const session = sessions.find((entry) => entry.id === addition.sessionId);
    if (!session) {
      return false;
    }
    return (
      session.exercises.some((exercise) => exercise.exerciseName === addition.exerciseName) ||
      cautionSwapped.some((swap) => swap.from === addition.exerciseName)
    );
  });

  const weeks = payload.blockLengthWeeks > 0 ? payload.blockLengthWeeks : READY_PROGRAM_MIN_BLOCK_WEEKS;
  const days = sessions.length;

  return {
    programId,
    sessions,
    days,
    weeks,
    totalWorkouts: weeks * days,
    // Home's arithmetic over the week as composed, swaps and all (bug hunt,
    // 2026-10-04).
    sessionMinutes: estimateProgrammeSessionMinutes(sessions, { availableEquipment }) || template.estimatedSessionDuration,
    savedCopySessionMinutes:
      estimateProgrammeSessionMinutes(sessions, { availableEquipment, rest: 'max' }) || template.estimatedSessionDuration,
    composed: days !== template.daysPerWeek,
    cautionRemoved,
    cautionSwapped,
    focusAdditions,
    equipmentRemoved,
    equipmentSwapped,
  };
}
