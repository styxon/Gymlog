import { filterBrowsableExercises } from './exerciseBrowseFilter';
import { exerciseNameLabel } from './exerciseNameLabel';
import { prescriptionUnitOf } from '../features/workout/workoutTypes';
import { getCatalogTrackingMode } from './catalogExercisePools';
import { DEFAULT_HOLD_SECONDS } from './holdExercises';
import { createId } from './ids';
import { DEFAULT_MINUTES_PRESCRIPTION } from './minutesExercises';
import {
  ExerciseLibraryItem,
  ExerciseTemplate,
  WorkoutSession,
  ExerciseLog,
} from '../types/models';

interface RecentExercisesOptions {
  exerciseLibrary: ExerciseLibraryItem[];
  exerciseLogs: ExerciseLog[];
  workoutSessions: WorkoutSession[];
  exerciseTemplates: ExerciseTemplate[];
  limit?: number;
}

interface SuggestedExercisesOptions {
  exerciseLibrary: ExerciseLibraryItem[];
  currentItemIds: string[];
  recentItems?: ExerciseLibraryItem[];
  limit?: number;
}

interface PopularExerciseSeed {
  label: string;
  keywords: string[];
}

const POPULAR_EXERCISE_SEEDS: PopularExerciseSeed[] = [
  { label: 'Bench Press', keywords: ['barbell bench press', 'bench press'] },
  { label: 'Squat', keywords: ['barbell squat', 'squat'] },
  { label: 'Deadlift', keywords: ['barbell deadlift', 'deadlift'] },
  { label: 'Lat Pulldown', keywords: ['lat pulldown', 'pulldown'] },
  { label: 'Hip Thrust', keywords: ['hip thrust', 'glute bridge'] },
  { label: 'Dumbbell Bicep Curl', keywords: ['dumbbell bicep curl', 'dumbbell curl', 'biceps curl', 'barbell curl'] },
  { label: 'Overhead Press', keywords: ['overhead press', 'shoulder press'] },
  { label: 'Romanian Deadlift', keywords: ['romanian deadlift', 'stiff-leg deadlift'] },
];

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

/**
 * The row a popular seed stands for.
 *
 * The lift whose plain English label IS the seed — "Lat Pulldown" is what the
 * app calls Wide-Grip Lat Pulldown, "Overhead Press" what it calls Standing
 * Military Press — and only then the first keyword match, shortest name
 * first. Keyword-only picking took whatever came first in the library's
 * alphabet: Close-Grip Front Lat Pulldown as THE lat pulldown, Alternating
 * Cable Shoulder Press as THE overhead press — the "Suositut aloitukseen"
 * card in the picker ("haluisin vain ylätalja", #bugs 2026-08-28).
 */
function findFirstKeywordMatch(items: ExerciseLibraryItem[], label: string, keywords: string[], picked: Set<string>) {
  const wanted = normalizeName(label);
  const byLabel = items.find(
    (item) => !picked.has(item.id) && normalizeName(exerciseNameLabel('en', item.name)) === wanted,
  );
  if (byLabel) {
    return byLabel;
  }
  for (const keyword of keywords) {
    const candidates = items.filter((item) => !picked.has(item.id) && normalizeName(item.name).includes(keyword));
    if (candidates.length) {
      return candidates.reduce((best, item) => (item.name.length < best.name.length ? item : best));
    }
  }

  return undefined;
}

function shouldTrackByDefault(item?: ExerciseLibraryItem) {
  if (!item) {
    return true;
  }

  return item.category === 'compound';
}

/**
 * The rest a lift added mid-session starts from, before its kind trims it
 * (getExerciseTemplateDefaults): the rest of the lift it is added after, so it
 * keeps the session's rhythm, when that lift rests between sets at all. A bout
 * of minutes, a 1 × 20 finisher and the first half of a superset rest 0, and a
 * 3 × 6–8 bench added after one rested 0 — the player's 15 s floor (re-hunt
 * R4, 2026-10-07). Otherwise the reader's own default rest.
 */
export function restSecondsForAddedLift(anchorRestSeconds: number | null | undefined, defaultRestSeconds: number): number {
  return typeof anchorRestSeconds === 'number' && Number.isFinite(anchorRestSeconds) && anchorRestSeconds > 0
    ? anchorRestSeconds
    : defaultRestSeconds;
}

export function getExerciseTemplateDefaults(item: ExerciseLibraryItem | undefined, defaultRestSeconds: number) {
  if (!item) {
    return {
      targetSets: 3,
      repMin: 6,
      repMax: 8,
      restSeconds: defaultRestSeconds,
      trackedDefault: true,
    };
  }

  // Before the category, the unit the exercise is logged in — the same
  // getCatalogTrackingMode the player runs the row on. A plank is filed under
  // core, and core's 12–15 is a rep range; a hold reads its range as seconds,
  // so a plank picked in "Build it yourself" asked for 15 s (device walk,
  // 2026-10-05).
  const unit = prescriptionUnitOf(getCatalogTrackingMode(item.name));
  if (unit === 'seconds') {
    return {
      targetSets: 3,
      repMin: DEFAULT_HOLD_SECONDS.min,
      repMax: DEFAULT_HOLD_SECONDS.max,
      restSeconds: Math.min(defaultRestSeconds, 60),
      trackedDefault: false,
    };
  }

  // A treadmill or a rower is filed under cardio, whose 1 × 8–12 the player
  // ran as 8–12 minutes; every other place a bout is built from a name writes
  // one of twenty (bug hunt, 2026-10-07). One bout, so no rest after it.
  if (unit === 'minutes') {
    return {
      targetSets: DEFAULT_MINUTES_PRESCRIPTION.sets,
      repMin: DEFAULT_MINUTES_PRESCRIPTION.minutes,
      repMax: DEFAULT_MINUTES_PRESCRIPTION.minutes,
      restSeconds: 0,
      trackedDefault: false,
    };
  }

  if (item.category === 'isolation') {
    return {
      targetSets: 3,
      repMin: 10,
      repMax: 12,
      restSeconds: Math.min(defaultRestSeconds, 75),
      trackedDefault: shouldTrackByDefault(item),
    };
  }

  if (item.category === 'core') {
    return {
      targetSets: 3,
      repMin: 12,
      repMax: 15,
      restSeconds: Math.min(defaultRestSeconds, 60),
      trackedDefault: false,
    };
  }

  if (item.category === 'cardio') {
    return {
      targetSets: 1,
      repMin: 8,
      repMax: 12,
      restSeconds: Math.min(defaultRestSeconds, 45),
      trackedDefault: false,
    };
  }

  return {
    targetSets: 3,
    repMin: 6,
    repMax: 8,
    restSeconds: defaultRestSeconds,
    trackedDefault: shouldTrackByDefault(item),
  };
}

export function getRecentExerciseLibraryItems({
  exerciseLibrary,
  exerciseLogs,
  workoutSessions,
  exerciseTemplates,
  limit = 8,
}: RecentExercisesOptions) {
  const sessionsById = new Map(workoutSessions.map((session) => [session.id, session] as const));
  const templateById = new Map(exerciseTemplates.map((exercise) => [exercise.id, exercise] as const));
  const libraryById = new Map(exerciseLibrary.map((item) => [item.id, item] as const));
  const libraryByName = new Map(exerciseLibrary.map((item) => [normalizeName(item.name), item] as const));

  const ranked = exerciseLogs
    .map((log) => {
      const session = sessionsById.get(log.sessionId);
      const template = log.exerciseTemplateId ? templateById.get(log.exerciseTemplateId) : undefined;
      const libraryItem =
        (template?.libraryItemId ? libraryById.get(template.libraryItemId) : undefined) ??
        libraryByName.get(normalizeName(log.exerciseNameSnapshot));

      if (!session || !libraryItem) {
        return null;
      }

      return {
        libraryItem,
        performedAt: session.performedAt,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime());

  const seen = new Set<string>();
  const result: ExerciseLibraryItem[] = [];

  for (const entry of ranked) {
    if (seen.has(entry.libraryItem.id)) {
      continue;
    }

    seen.add(entry.libraryItem.id);
    result.push(entry.libraryItem);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

export function getPopularExerciseLibraryItems(exerciseLibrary: ExerciseLibraryItem[], limit = 8) {
  const picked = new Set<string>();
  const matches: ExerciseLibraryItem[] = [];

  for (const seed of POPULAR_EXERCISE_SEEDS) {
    const match = findFirstKeywordMatch(exerciseLibrary, seed.label, seed.keywords, picked);

    if (match) {
      picked.add(match.id);
      matches.push(match);
    }

    if (matches.length >= limit) {
      break;
    }
  }

  return matches;
}

export function getPopularExerciseLibraryOrder(exerciseLibrary: ExerciseLibraryItem[]) {
  return new Map(getPopularExerciseLibraryItems(exerciseLibrary).map((item, index) => [item.id, index]));
}

export function getSuggestedExerciseLibraryItems({
  exerciseLibrary,
  currentItemIds,
  recentItems = [],
  limit = 6,
}: SuggestedExercisesOptions) {
  const currentIds = new Set(currentItemIds);
  const currentItems = exerciseLibrary.filter((item) => currentIds.has(item.id));
  const preferredBodyParts = new Set(currentItems.map((item) => item.bodyPart));
  const preferredEquipment = new Set(currentItems.map((item) => item.equipment));

  // Offered unasked, so only what the picker offers unasked: no stretches or
  // field drills, and no strongman implements — a leg-machine day was
  // suggested the backward sled drag and the car deadlift (#bugs 2026-10-06).
  const scored = filterBrowsableExercises(exerciseLibrary)
    .filter((item) => !currentIds.has(item.id))
    .map((item) => {
      const recentBonus = recentItems.findIndex((recent) => recent.id === item.id);
      let score = 0;

      if (preferredBodyParts.has(item.bodyPart)) {
        score += 5;
      }
      if (preferredEquipment.has(item.equipment)) {
        score += 2;
      }
      if (item.category === 'compound') {
        score += 2;
      }
      if (recentBonus >= 0) {
        score += Math.max(1, 4 - recentBonus);
      }

      return { item, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.item.name.localeCompare(right.item.name);
    });

  return scored.slice(0, limit).map((entry) => entry.item);
}


