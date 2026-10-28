/**
 * A long training history, built from a seed, for measuring storage.
 *
 * Pure and deterministic: the same (sessionCount, seed) always gives the same
 * rows, byte for byte. Nothing here runs when the module loads. Shaped like
 * what the guided player writes (five to seven lifts of three or four sets, a
 * note on some sessions, a feel on all), newest session first, the order
 * workoutSessionRepository.append leaves them in.
 *
 * Used by scripts/measure-history-load.cjs and tests/lib/historyFixture.test.cjs
 * (SQLite plan, PR 0). The app does not import it.
 */
import type {
  AppDatabase,
  BodyweightEntry,
  CardioActivityType,
  CardioFeel,
  CardioSession,
  ExerciseLog,
  ExerciseLogSet,
  MeasurementEntry,
  MeasurementKind,
  MeasurementUnit,
  SessionFeel,
  WorkoutSession,
} from '../types/models';

export type HistoryCollections = Pick<
  AppDatabase,
  'workoutSessions' | 'exerciseLogs' | 'bodyweightEntries' | 'measurementEntries' | 'cardioSessions'
>;

/** Sessions are two days apart; the newest is this day. */
const NEWEST_SESSION_UTC = Date.UTC(2026, 9, 1, 9, 0, 0);

const TEMPLATE_ID = 'workout_fixture_history';

const LIFTS = [
  'Bench Press',
  'Back Squat',
  'Romanian Deadlift',
  'Pull-Up',
  'Overhead Press',
  'Barbell Row',
  'Leg Press',
  'Incline Dumbbell Press',
];

const SESSION_NAMES = ['Upper Body', 'Lower Body', 'Push', 'Pull'];
const FEELS: SessionFeel[] = ['easy', 'right', 'right', 'hard', 'too_hard'];
const MEASUREMENT_KINDS: Array<[MeasurementKind, MeasurementUnit, number]> = [
  ['waist', 'cm', 82],
  ['chest', 'cm', 102],
  ['arms', 'cm', 37],
  ['thighs', 'cm', 58],
  ['bodyfat', '%', 16],
];
const CARDIO_TYPES: CardioActivityType[] = ['run', 'tread-run', 'cycle-in', 'row'];
const CARDIO_FEELS: CardioFeel[] = ['easy', 'steady', 'hard'];

/** mulberry32: a small seeded generator, so no Math.random anywhere. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The ISO time `daysBack` calendar days before the newest session (UTC has no clock change). */
function isoDaysBack(daysBack: number, hour = 9): string {
  const base = new Date(NEWEST_SESSION_UTC);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - daysBack, hour, 0, 0)).toISOString();
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, '_');
}

/**
 * `sessionCount` completed sessions with their logs, plus bodyweight (every
 * third day), measurements (weekly, rotating kind) and cardio (every fifth
 * session) over the same span. Every id is unique; every log points at a
 * session in the list.
 */
export function buildHistoryFixture(sessionCount: number, seed = 1): HistoryCollections {
  const random = createRandom(seed);
  const pick = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));

  const workoutSessions: WorkoutSession[] = [];
  const exerciseLogs: ExerciseLog[] = [];
  const bodyweightEntries: BodyweightEntry[] = [];
  const measurementEntries: MeasurementEntry[] = [];
  const cardioSessions: CardioSession[] = [];

  for (let index = 0; index < sessionCount; index += 1) {
    const performedAt = isoDaysBack(index * 2);
    const sessionId = `workout_session_${index}`;
    const dayIndex = index % SESSION_NAMES.length;
    const liftCount = pick(5, 7);
    let sessionSets = 0;
    let sessionVolume = 0;

    for (let orderIndex = 0; orderIndex < liftCount; orderIndex += 1) {
      const name = LIFTS[(index + orderIndex) % LIFTS.length];
      const key = slug(name);
      const weight = pick(10, 40) * 2.5;
      const setCount = pick(3, 4);
      const sets: ExerciseLogSet[] = [];
      const repsPerSet: number[] = [];
      for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
        const reps = pick(6, 10);
        repsPerSet.push(reps);
        sessionVolume += weight * reps;
        sets.push({
          orderIndex: setIndex,
          weight,
          reps,
          kind: 'working',
          outcome: 'completed',
          status: 'completed',
          effort: setIndex === setCount - 1 ? 'hard' : 'good',
          completedAt: performedAt,
          skippedReason: null,
        });
      }
      sessionSets += setCount;
      exerciseLogs.push({
        id: `log_${index}_${orderIndex}`,
        sessionId,
        exerciseTemplateId: `fixture_day_${dayIndex}_${key}`,
        exerciseNameSnapshot: name,
        weight,
        repsPerSet,
        sets,
        tracked: true,
        orderIndex,
        skipped: false,
        sessionInserted: false,
        status: 'completed',
        slotId: `${TEMPLATE_ID}:fixture_day_${dayIndex}:slot_${key}`,
        templateSlotId: `slot_${key}`,
        templateExerciseId: `fixture_day_${dayIndex}_${key}`,
        notes: random() < 0.08 ? 'Felt a little tight today' : null,
        swappedFrom: null,
      });
    }

    workoutSessions.push({
      id: sessionId,
      workoutTemplateId: TEMPLATE_ID,
      workoutTemplateSessionId: `fixture_day_${dayIndex}`,
      workoutNameSnapshot: `Fixture programme - Day ${dayIndex + 1}: ${SESSION_NAMES[dayIndex]}`,
      sessionNotes: index % 10 === 0 ? 'Good session' : null,
      performedAt,
      startedAt: performedAt,
      durationMinutes: pick(40, 75),
      setsCompleted: sessionSets,
      exercisesCompleted: liftCount,
      totalVolumeKg: sessionVolume,
      feel: FEELS[pick(0, FEELS.length - 1)],
    });

    if (index % 5 === 0) {
      cardioSessions.push({
        id: `cardio_${index}`,
        activityType: CARDIO_TYPES[pick(0, CARDIO_TYPES.length - 1)],
        startedAt: isoDaysBack(index * 2 + 1, 7),
        performedAt: isoDaysBack(index * 2 + 1, 8),
        durationSec: pick(15, 50) * 60,
        distanceKm: pick(20, 100) / 10,
        feel: CARDIO_FEELS[pick(0, CARDIO_FEELS.length - 1)],
      });
    }
  }

  // Bodyweight every third day and a measurement each week, over the span of the sessions.
  const spanDays = Math.max(0, (sessionCount - 1) * 2);
  for (let day = 0, entry = 0; day <= spanDays; day += 3, entry += 1) {
    bodyweightEntries.push({
      id: `bodyweight_${entry}`,
      recordedAt: isoDaysBack(day, 6),
      weight: Math.round((80 + random() * 4) * 10) / 10,
    });
  }
  for (let day = 0, entry = 0; day <= spanDays; day += 7, entry += 1) {
    const [kind, unit, base] = MEASUREMENT_KINDS[entry % MEASUREMENT_KINDS.length];
    measurementEntries.push({
      id: `measurement_${entry}`,
      kind,
      recordedAt: isoDaysBack(day, 6),
      value: Math.round((base + random() * 2) * 10) / 10,
      unit,
    });
  }

  return { workoutSessions, exerciseLogs, bodyweightEntries, measurementEntries, cardioSessions };
}
