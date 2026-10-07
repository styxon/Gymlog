import { WorkoutTemplateExercise } from '../features/workout/workoutTypes';
import { SetupFocusArea } from '../types/models';
import {
  composedSlotDose,
  FOCUS_ACCESSORY_POOL,
  getCatalogTrackingMode,
  pickPoolVariant,
  sessionFocusAffinity,
} from './catalogExercisePools';

/**
 * Focus areas add real training emphasis (onboarding truth plan P3):
 * +1 weekly accessory for small areas, +2 for big muscle groups. Additions run
 * BEFORE the caution filter in the composer, so a flagged area can still veto
 * or swap what the emphasis added — safety wins over emphasis.
 *
 * Emphasis is spread across the week rather than stacked into a single "chest
 * day", but it lands on the day that already trains the area — a glute
 * accessory on leg day, not wherever the round-robin happened to reach.
 * The exercise names come from catalogExercisePools, which is checked against
 * the library; this file used to name exercises that did not exist.
 */

const BIG_FOCUS_AREAS: SetupFocusArea[] = ['chest', 'back', 'quads', 'glutes', 'hamstrings', 'legs'];

export function getFocusEmphasisCount(area: SetupFocusArea): number {
  return BIG_FOCUS_AREAS.includes(area) ? 2 : 1;
}

function buildEmphasisExercise(name: string, sessionId: string, index: number): WorkoutTemplateExercise {
  // Dosed in the accessory's own unit, as a suggested day doses the same name
  // (composedSlotDose): a plank is seconds and an elliptical one bout of
  // minutes. Writing "10–15" here once meant onboarding showed a range the
  // next launch read as 15 (emulator, 2026-09-13).
  const trackingMode = getCatalogTrackingMode(name);
  const dose = composedSlotDose(name, trackingMode, { sets: 2, restSecondsMin: 45, restSecondsMax: 75 });
  return {
    id: `${sessionId}_focus_${index + 1}`,
    exerciseName: name,
    slotId: `focus_accessory_${index + 1}`,
    role: 'accessory',
    progressionPriority: 'low',
    trackingMode,
    ...dose,
    substitutionGroup: `focus_${name.replace(/\W+/g, '_').toLowerCase()}`,
  };
}

export interface FocusEmphasisSessionInput {
  id: string;
  exercises: WorkoutTemplateExercise[];
}

export interface FocusEmphasisAddition {
  area: SetupFocusArea;
  exerciseName: string;
  sessionId: string;
}

/**
 * Spreads each focus area's accessories across the week and never duplicates a
 * movement a session already holds. Mutates nothing — returns per-session
 * additions.
 *
 * Placement is by affinity first: the day whose exercises already train the
 * area wins. The per-area round-robin offset only breaks ties, so two focus
 * areas still land on different days when nothing else separates them.
 */
export function buildFocusEmphasisAdditions(
  sessions: FocusEmphasisSessionInput[],
  focusAreas: SetupFocusArea[],
  availableEquipment: string[] | null = null,
): { bySessionId: Map<string, WorkoutTemplateExercise[]>; additions: FocusEmphasisAddition[] } {
  const bySessionId = new Map<string, WorkoutTemplateExercise[]>();
  const additions: FocusEmphasisAddition[] = [];
  if (sessions.length === 0) {
    return { bySessionId, additions };
  }

  focusAreas.forEach((area, areaIndex) => {
    const areaPool = FOCUS_ACCESSORY_POOL[area];
    const pool = areaPool ? pickPoolVariant(areaPool, availableEquipment) : [];
    const count = Math.min(getFocusEmphasisCount(area), pool.length);

    for (let step = 0; step < count; step += 1) {
      const name = pool[step % pool.length];
      // Offset per area so two focus areas don't stack on the same day.
      const startIndex = (areaIndex + step) % sessions.length;

      const ranked = sessions
        .map((session, index) => {
          const pending = bySessionId.get(session.id) ?? [];
          const names = [
            ...session.exercises.map((exercise) => exercise.exerciseName),
            ...pending.map((exercise) => exercise.exerciseName),
          ];
          return {
            session,
            names,
            pendingCount: pending.length,
            affinity: sessionFocusAffinity(names, area),
            rotation: (index - startIndex + sessions.length) % sessions.length,
          };
        })
        .sort((left, right) => right.affinity - left.affinity || left.rotation - right.rotation);

      for (const candidate of ranked) {
        // Session time budget: at most two added accessories per session.
        if (
          candidate.pendingCount >= 2 ||
          candidate.names.some((existing) => existing.toLowerCase() === name.toLowerCase())
        ) {
          continue;
        }

        const exercise = buildEmphasisExercise(name, candidate.session.id, candidate.pendingCount);
        bySessionId.set(candidate.session.id, [
          ...(bySessionId.get(candidate.session.id) ?? []),
          exercise,
        ]);
        additions.push({ area, exerciseName: name, sessionId: candidate.session.id });
        break;
      }
    }
  });

  return { bySessionId, additions };
}
