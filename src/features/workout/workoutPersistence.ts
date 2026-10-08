import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeFreestyleDraftSnapshot } from '../../lib/emptyWorkoutSession';

import { normalizeActiveCardioSession } from '../../lib/cardio';
import { normalizeSessionMinutesClock } from '../../lib/minutesExercises';
import { scrubImpossibleSessionLoads } from '../../lib/impossibleLoads';
import { isLiftableWeight } from '../../lib/weightLimits';
import { getLargeItem, MissingPartsError, removeLargeItem, setLargeItem } from '../../storage/largeItem';
import { removeCorruptCopies, setAsideCorruptCopy } from '../../storage/corruptCopies';
import { removeWorkoutAsideCopies } from '../../storage/workoutAside';
import {
  LEGACY_WORKOUT_STORAGE_KEY,
  WORKOUT_CORRUPT_STORAGE_KEY,
  WORKOUT_STORAGE_KEY,
} from '../../storage/workoutKeys';
import { getWorkoutTemplateById } from './workoutCatalog';
import {
  WorkoutHistoryStore,
  WorkoutPersistenceBundle,
  WorkoutRestTimerState,
  WorkoutSessionRuntime,
  WorkoutSessionSummary,
  WorkoutUiState,
} from './workoutTypes';

const STORAGE_KEY = WORKOUT_STORAGE_KEY;
const LEGACY_STORAGE_KEY = LEGACY_WORKOUT_STORAGE_KEY;
const CORRUPT_STORAGE_KEY = WORKOUT_CORRUPT_STORAGE_KEY;

export function createEmptyWorkoutHistory(): WorkoutHistoryStore {
  return {
    sessions: [],
    slotHistory: {},
    lastSelectedTemplateId: null,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildScopedSlotId(templateId: string, templateSessionId: string, slotId: string) {
  return `${templateId}:${templateSessionId}:${slotId}`;
}

/**
 * Every slot's "last time" list, checked slot by slot. The map itself was
 * checked and then cast whole, so one slot holding a string or an object
 * reached entriesForLift's `.filter` and took the guided player down on
 * every session start (break round, 2026-09-28). A slot that is not a list
 * is dropped; an entry without its sets list is dropped too, since every
 * reader of an entry walks its sets.
 */
/** A logged set as every reader of "last time" uses it: the three numbers. */
function isHistorySet(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.setIndex === 'number' &&
    Number.isFinite(value.setIndex) &&
    typeof value.loadKg === 'number' &&
    Number.isFinite(value.loadKg) &&
    typeof value.reps === 'number' &&
    Number.isFinite(value.reps)
  );
}

/**
 * A warm-up list as stored (live session or "last time"): kept only as a list
 * of sets with a liftable load and whole reps; anything else is dropped, and
 * an empty list is no list. Added 2026-10-05 — older data has none.
 */
function normalizeWarmups<T extends { loadKg: number; reps: number }>(
  value: unknown,
  withMoment: boolean,
): T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const kept = value.filter(
    (warmup) =>
      isObject(warmup) &&
      isLiftableWeight(warmup.loadKg) &&
      typeof warmup.reps === 'number' &&
      Number.isInteger(warmup.reps) &&
      warmup.reps >= 1 &&
      (!withMoment || typeof warmup.completedAt === 'string'),
  ) as unknown as T[];
  return kept.length > 0 ? kept : undefined;
}

/** Sets a key to a value, or takes the key away when the value is undefined. */
function withOptional<T extends Record<string, unknown>>(target: T, key: string, value: unknown): T {
  const { [key]: _dropped, ...rest } = target;
  return (value === undefined ? rest : { ...rest, [key]: value }) as T;
}

function normalizeSlotHistory(input: unknown): WorkoutHistoryStore['slotHistory'] {
  if (!isObject(input)) {
    return {};
  }
  const slots: WorkoutHistoryStore['slotHistory'] = {};
  for (const [slotId, entries] of Object.entries(input)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    slots[slotId] = entries
      .filter((entry): entry is Record<string, unknown> & { sets: unknown[] } => isObject(entry) && Array.isArray(entry.sets))
      // And every set in it: a list holding `null`, or a set without its
      // numbers, reached `set.loadKg` in the "last time" lookup and took
      // down every lift of that name (recheck of #221, 2026-09-28).
      .map((entry) =>
        withOptional({ ...entry, sets: entry.sets.filter(isHistorySet) }, 'warmups', normalizeWarmups(entry.warmups, false)),
      ) as unknown as WorkoutHistoryStore['slotHistory'][string];
  }
  return slots;
}

function normalizeHistory(input: unknown): WorkoutHistoryStore {
  if (!isObject(input)) {
    return createEmptyWorkoutHistory();
  }

  const sessions = Array.isArray(input.sessions)
    ? input.sessions.filter(isObject).map((item) => item as unknown as WorkoutSessionSummary)
    : [];

  return {
    sessions,
    slotHistory: normalizeSlotHistory(input.slotHistory),
    lastSelectedTemplateId: typeof input.lastSelectedTemplateId === 'string' ? input.lastSelectedTemplateId : null,
  };
}

const IDLE_REST_TIMER: WorkoutRestTimerState = {
  status: 'idle',
  exerciseSlotId: null,
  setIndex: null,
  startedAtMs: null,
  endsAtMs: null,
  durationSeconds: 0,
};

const FRESH_UI: WorkoutUiState = {
  activeSlotId: null,
  activeSetIndex: 0,
  focusedField: null,
  noteEditorSlotId: null,
  swapSheetSlotId: null,
  expandedSlotIds: [],
  finishSummaryOpen: false,
};

/**
 * The parts of a stored session everything below and the player itself reach
 * into without asking, made safe to reach into.
 *
 * The session is the one part of the bundle nobody checked: three string
 * fields and a cast. A ready-programme session missing its lifts, its rest
 * timer or its screen state threw in the slot remap below, and the catch
 * around the whole bundle set aside the history, the run and the free workout
 * with it — every lift's "last time" gone over one field of a draft
 * (persistence audit, 2026-09-20; the database had the same hole, #157).
 *
 * The lifts are the session: without a list of them there is nothing to
 * resume, and a lift that is not an object with its sets is not one. A list
 * with none left in it is no session either — kept, Home offered to resume
 * an empty workout (CI review of #167). The timer and the screen state are
 * where the player was, not what was done, so a missing one starts fresh.
 */
function repairSessionShape(input: Record<string, unknown>): WorkoutSessionRuntime | null {
  if (!Array.isArray(input.exercises)) {
    return null;
  }
  const exercises = input.exercises
    .filter((exercise): exercise is Record<string, unknown> => isObject(exercise) && Array.isArray(exercise.sets))
    .map((exercise) => withOptional(exercise, 'warmups', normalizeWarmups(exercise.warmups, true)));
  if (exercises.length === 0) {
    return null;
  }
  const ui = isObject(input.ui) ? input.ui : {};
  const takenBackAt = Array.isArray(input.takenBackAt)
    ? input.takenBackAt.filter((moment): moment is string => typeof moment === 'string')
    : undefined;
  return {
    ...input,
    takenBackAt,
    // Absent rather than null when there is none, so a session stored before
    // the clock existed comes back exactly as it was written.
    minutesClock: normalizeSessionMinutesClock(input.minutesClock) ?? undefined,
    exercises,
    restTimer: { ...IDLE_REST_TIMER, ...(isObject(input.restTimer) ? input.restTimer : {}) },
    ui: {
      ...FRESH_UI,
      activeSlotId: typeof exercises[0]?.slotId === 'string' ? exercises[0].slotId : null,
      ...ui,
      expandedSlotIds: Array.isArray(ui.expandedSlotIds)
        ? ui.expandedSlotIds.filter((slotId): slotId is string => typeof slotId === 'string')
        : [],
    },
  } as unknown as WorkoutSessionRuntime;
}

function normalizeActiveSession(input: unknown): WorkoutSessionRuntime | null {
  if (!isObject(input)) {
    return null;
  }

  if (typeof input.sessionId !== 'string' || typeof input.templateId !== 'string' || typeof input.templateName !== 'string') {
    return null;
  }

  const repaired = repairSessionShape(input);
  if (!repaired) {
    return null;
  }

  const session = scrubImpossibleSessionLoads(repaired);
  const template = getWorkoutTemplateById(session.templateId);
  if (!template) {
    return session;
  }

  const templateExerciseMap = new Map(
    template.sessions.flatMap((templateSession) =>
      templateSession.exercises.map((exercise) => [
        exercise.id,
        {
          scopedSlotId: buildScopedSlotId(template.id, templateSession.id, exercise.slotId),
          templateSlotId: exercise.slotId,
        },
      ] as const),
    ),
  );

  const slotFallbackMap = new Map<string, string>();
  const exercises = session.exercises.map((exercise) => {
    const templateExercise = templateExerciseMap.get(exercise.templateExerciseId);
    const nextSlotId = templateExercise?.scopedSlotId ?? exercise.slotId;
    const templateSlotId = templateExercise?.templateSlotId ?? exercise.templateSlotId ?? exercise.slotId;

    if (!slotFallbackMap.has(exercise.slotId)) {
      slotFallbackMap.set(exercise.slotId, nextSlotId);
    }

    return {
      ...exercise,
      slotId: nextSlotId,
      templateSlotId,
    };
  });

  const remapSlotId = (value: string | null | undefined) => {
    if (!value) {
      return value ?? null;
    }

    return slotFallbackMap.get(value) ?? value;
  };

  return {
    ...session,
    templateSessionId: session.templateSessionId ?? null,
    exercises,
    restTimer: {
      ...session.restTimer,
      exerciseSlotId: remapSlotId(session.restTimer.exerciseSlotId),
    },
    // The bout's clock is found by its slot (stopwatchForSet); left on the old
    // id, the bout reopened at 0:00 with its minutes gone.
    ...(session.minutesClock
      ? {
          minutesClock: {
            ...session.minutesClock,
            slotId: remapSlotId(session.minutesClock.slotId) ?? session.minutesClock.slotId,
          },
        }
      : {}),
    ui: {
      ...session.ui,
      activeSlotId: remapSlotId(session.ui.activeSlotId),
      noteEditorSlotId: remapSlotId(session.ui.noteEditorSlotId),
      swapSheetSlotId: remapSlotId(session.ui.swapSheetSlotId),
      expandedSlotIds: session.ui.expandedSlotIds.map((slotId) => remapSlotId(slotId) ?? slotId),
      // The resume anchor names a slot too, and has to follow the same rename
      // as every other slot reference here or it points at nothing.
      guidedResumeAnchor:
        session.ui.guidedResumeAnchor?.slotId !== undefined
          ? {
              ...session.ui.guidedResumeAnchor,
              slotId: remapSlotId(session.ui.guidedResumeAnchor.slotId) ?? session.ui.guidedResumeAnchor.slotId,
            }
          : session.ui.guidedResumeAnchor,
    },
  };
}

export function normalizeWorkoutBundle(input: unknown): WorkoutPersistenceBundle {
  if (!isObject(input)) {
    return {
      activeSession: null,
      history: createEmptyWorkoutHistory(),
      activeCardio: null,
      freestyleDraft: null,
    };
  }

  return {
    activeSession: normalizeActiveSession(input.activeSession),
    history: normalizeHistory(input.history),
    activeCardio: normalizeActiveCardioSession(input.activeCardio),
    freestyleDraft: normalizeFreestyleDraftSnapshot(input.freestyleDraft),
  };
}

async function readStoredBundle(): Promise<string | null> {
  try {
    return (await getLargeItem(STORAGE_KEY)) ?? (await AsyncStorage.getItem(LEGACY_STORAGE_KEY));
  } catch (error) {
    // A split bundle with a part missing is as unreadable as one that will
    // not parse, and falls to the same empty bundle below. Thrown, it left
    // the provider restoring forever.
    if (error instanceof MissingPartsError) {
      return error.readable;
    }
    throw error;
  }
}

export async function loadWorkoutBundle() {
  const raw = await readStoredBundle();
  if (!raw) {
    return { activeSession: null, history: createEmptyWorkoutHistory(), activeCardio: null } satisfies WorkoutPersistenceBundle;
  }

  try {
    return normalizeWorkoutBundle(JSON.parse(raw));
  } catch {
    // Set aside before the empty bundle takes its place: the provider saves
    // what it loaded straight away, and this held every lift's "last time".
    // Same rule as the database's quarantine, including its failure: a copy
    // that could not be written fails the load, and the rows stay as they are,
    // because the save that follows an empty bundle would sweep them.
    await setAsideCorruptCopy(CORRUPT_STORAGE_KEY, raw);
    return { activeSession: null, history: createEmptyWorkoutHistory(), activeCardio: null } satisfies WorkoutPersistenceBundle;
  }
}

export async function saveWorkoutBundle(bundle: WorkoutPersistenceBundle) {
  // Slot history keeps ten entries per slot but gains slots with every
  // programme, so this value has no ceiling either (see lib/storageChunks).
  await setLargeItem(STORAGE_KEY, JSON.stringify(bundle));
}

export async function clearWorkoutBundle() {
  await removeLargeItem(STORAGE_KEY);
  await removeCorruptCopies(CORRUPT_STORAGE_KEY);
  // Before the sweep below, which lists keys and can reject: a failed reset
  // must not leave the pre-rename bundle to load again.
  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  // Reset means reset: the crash screen's set-aside copies are not a copy
  // somebody who asked for their data to be erased wanted to survive. A sweep
  // that fails fails the reset, which the UI reports.
  await removeWorkoutAsideCopies();
}
