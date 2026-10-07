import { isMinutesTrackingMode, isTimedTrackingMode, WorkoutTemplateExercise } from '../features/workout/workoutTypes';
import { applyEquipmentToExercises } from './equipmentExerciseFilter';
import { estimateRoutineBlockSeconds } from './guidedPlayer';
import { classifySessionFocus, getDefaultCooldown, getDefaultWarmup, RoutineDrillOverrides } from './homeSessionHero';
import { estimateSessionMinutes } from './sessionDuration';

/**
 * "N min" for a programme card, from the programme's own sessions.
 *
 * The cards quoted the catalog's hand-written `estimatedSessionDuration` while
 * Home quoted the estimator over the very same sessions, and the two were 10+
 * minutes apart on 20 of 47 programmes (bug hunt, 2026-10-04). The user's call:
 * the card shows Home's number. So this is Home's arithmetic — the same inputs
 * per exercise, the same warm-up and cool-down for the session's focus — and
 * the card is the average session, rounded the way Home rounds.
 */
export interface ProgrammeMinutesOptions {
  /** The reader's gear, which decides the warm-up and cool-down drills. */
  availableEquipment?: string[] | null;
  overrides?: RoutineDrillOverrides | null;
  /**
   * Which end of the rest range to cost. A ready programme runs on the low
   * end; the copy onboarding saves keeps the high end (onboardingHandoff), so
   * the onboarding card has to quote that one or Home reads 5–20 minutes more
   * than the card promised (bug hunt, 2026-10-04).
   */
  rest?: 'min' | 'max';
}

export function estimateProgrammeSessionMinutesList(
  sessions: ReadonlyArray<{ exercises: ReadonlyArray<WorkoutTemplateExercise> }>,
  options: ProgrammeMinutesOptions = {},
): number[] {
  const equipment = options.availableEquipment ?? null;
  const overrides = options.overrides ?? null;
  return sessions.map((session) => {
    if (session.exercises.length === 0) {
      return 0;
    }
    const focus = classifySessionFocus(session.exercises.map((exercise) => exercise.exerciseName));
    return estimateSessionMinutes({
      exercises: session.exercises.map((exercise) => ({
        name: exercise.exerciseName,
        sets: exercise.sets,
        reps: exercise.repsMax,
        timed: isTimedTrackingMode(exercise.trackingMode),
        minutes: isMinutesTrackingMode(exercise.trackingMode),
        restSeconds: options.rest === 'max' ? exercise.restSecondsMax : exercise.restSecondsMin,
        supersetGroup: exercise.supersetGroup ?? null,
      })),
      // Drill durations do not depend on the language, only their labels do.
      warmupSeconds: estimateRoutineBlockSeconds(getDefaultWarmup(focus, 'en', equipment, overrides)),
      cooldownSeconds: estimateRoutineBlockSeconds(getDefaultCooldown(focus, 'en', equipment, overrides)),
    });
  });
}

/** The average session, to Home's five minutes; 0 when there is nothing to time. */
export function estimateProgrammeSessionMinutes(
  sessions: ReadonlyArray<{ exercises: ReadonlyArray<WorkoutTemplateExercise> }>,
  options: ProgrammeMinutesOptions = {},
): number {
  const minutes = estimateProgrammeSessionMinutesList(sessions, options).filter((value) => value > 0);
  if (minutes.length === 0) {
    return 0;
  }
  const average = minutes.reduce((sum, value) => sum + value, 0) / minutes.length;
  return Math.max(5, Math.round(average / 5) * 5);
}

/**
 * The card number for a ready programme, falling back to the catalog's own.
 *
 * With the reader's gear given, the sessions are costed as the week composes
 * for them: exercises their equipment cannot do are swapped or dropped first,
 * through the same filter the composer uses. The card used to cost the raw
 * template while the programme page and Home cost the composed week, and a
 * bands-only reader saw 35 min on the card and 20 on the page for the same
 * programme (bug hunt, 2026-10-04). No gear (null) means nothing to filter.
 */
export function readyTemplateCardMinutes(
  template: { sessions: ReadonlyArray<{ exercises: ReadonlyArray<WorkoutTemplateExercise> }>; estimatedSessionDuration: number },
  options: ProgrammeMinutesOptions = {},
): number {
  const gear = options.availableEquipment ?? null;
  const sessions = gear === null ? template.sessions : sessionsForGear(template, gear);
  return estimateProgrammeSessionMinutes(sessions, options) || template.estimatedSessionDuration;
}

type TemplateSessions = ReadonlyArray<{ exercises: ReadonlyArray<WorkoutTemplateExercise> }>;

/**
 * The equipment filter's answer per template and gear list. The Programs card
 * and the recommender's content-fit signal both cost every catalog programme
 * with the reader's gear on a cold start; without this the second pass redid
 * the filter for all 68 (review, 2026-10-07). Keyed by the template object,
 * so a template that is replaced is a new key.
 */
const equippedSessionsCache = new WeakMap<object, Map<string, TemplateSessions>>();

function sessionsForGear(template: { sessions: TemplateSessions }, gear: string[]): TemplateSessions {
  const key = gear.join('\u0000');
  let byGear = equippedSessionsCache.get(template);
  if (!byGear) {
    byGear = new Map();
    equippedSessionsCache.set(template, byGear);
  }
  let sessions = byGear.get(key);
  if (!sessions) {
    sessions = template.sessions.map((session) => ({
      exercises: applyEquipmentToExercises([...session.exercises], gear).exercises,
    }));
    byGear.set(key, sessions);
  }
  return sessions;
}
