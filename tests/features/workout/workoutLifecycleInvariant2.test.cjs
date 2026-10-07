const assert = require('node:assert/strict');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('../../storage/fakeAsyncStorage.cjs');

/**
 * The workout-lifecycle invariant, second part (2026-10-07): the actions added
 * since the first one was written.
 *
 * docs/never-list.md N1 ("a logged set is never lost") and N2 ("a workout can
 * always be started and saved"), driven through workoutReducer with random
 * sequences that use what #321, #326/#334 and #337/#339 brought in: warm-up
 * sets (logged, taken back, refused when impossible), a swap of a lift that
 * already holds warm-ups or logged sets, a lift added from the shared sheet
 * mid-session, a skip, the minutes clock (started, paused on its own button,
 * paused by the workout's pause, paused by leaving its step, carried through a
 * reload), a reload (the bundle serialised, normalised by workoutPersistence
 * and hydrated into a fresh reducer), the finish, and the next session started
 * from the history that finish wrote.
 *
 * After every step:
 *  W1  every logged working set is in the live session with the values it was
 *      logged / corrected to, and nothing is logged that nobody logged;
 *  W2  the warm-ups on each lift are exactly the ones logged and not taken back
 *      (a swap of a lift with nothing logged drops them, by design);
 *  W3  the minutes clock is the one the reader's actions leave (started, paused,
 *      dropped by logging / skipping / swapping its lift), and if there is one it
 *      names a pending set of the lift the slot holds now;
 *  W4  the session can reach a savable finish: on a copy, the adapter's output
 *      (what saveCompletedWorkoutSession receives) saves every working set under
 *      the lift it was logged as, every warm-up as kind 'warmup' and never as
 *      work (set counts, volume, comparable sets, sessionRecordedWork), and the
 *      reducer's finish writes the working sets, and only them, to the slot
 *      history (warm-ups apart, on `warmups`);
 *  W5  serialise -> normalise -> hydrate gives back the same session and history.
 *  W6  after a finish (also one finished again after its clear was lost, merged
 *      into the stored row) the stored workout holds exactly the reader's working
 *      sets, and no warm-up twice;
 *  W7  a bout timed on the minutes clock is workout time: logged, the workout's
 *      clock holds at least as much as the bout's.
 * After a real finish, the next session started from that history never opens a
 * set on a warm-up's load (warm-up loads carry a 0.1 kg marker no work load has).
 *
 * Generated as the player allows: a lift's sets are logged in order and taken
 * back from the last; "+ Warm-up set" only on a loaded lift whose first set is
 * open; the bout's clock only while the workout is not paused.
 *
 * A "soft" finding does not stop its sequence (so one defect cannot hide the
 * next), and still fails the suite, shrunk to its shortest sequence.
 *
 * Run alone, beside run-tests.cjs: INV2_SEED / INV2_SEQUENCES / INV2_REPLAY
 * (a JSON list of events, as a hard failure prints it) / INV2_STATS=1.
 */

const ROOT = path.join(__dirname, '..', '..', '..');
const DIST = path.join(ROOT, '.test-dist');
const dist = (relative) => require(path.join(DIST, relative));

const SEQUENCES = Number(process.env.INV2_SEQUENCES) || 3000;
const SEED = Number(process.env.INV2_SEED) || 20261007;

const persistence = loadAgainstFake(createFakeAsyncStorage(), (req) => req('features/workout/workoutPersistence.js'));
const { workoutReducer, workoutInitialState, workoutSecondsUntil } = dist('features/workout/workoutState.js');
const catalog = dist('features/workout/workoutCatalog.js');
const { buildReadySessionRuntimeTemplate, buildCustomSessionRuntimeTemplate } = dist('lib/programDetails.js');
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = dist('features/workout/customWorkoutAdapter.js');
const { adaptCompletedWorkoutSessionForAppDatabase } = dist('features/workout/workoutAppAdapter.js');
const { persistCompletedWorkoutSessionToDatabase } = dist('state/completedWorkoutPersistence.js');
const { createEmptyDatabase } = dist('data/seed.js');
const { isUnloadedTrackingMode, isMinutesTrackingMode } = dist('features/workout/workoutTypes.js');
const { parseIntervalScheme } = dist('lib/intervalScheme.js');
const { getCatalogTrackingMode } = dist('lib/catalogExercisePools.js');
const { sessionRecordedWork, getComparableLogSets } = dist('lib/exerciseLog.js');
const { liftOfSet } = dist('lib/liftSegments.js');
const mins = dist('lib/minutesExercises.js');

const LIBRARY = createEmptyDatabase('en').exerciseLibrary;
const TEMPLATES = catalog.WORKOUT_TEMPLATES_V1;
const GROUPS = new Map(catalog.WORKOUT_SUBSTITUTION_GROUPS.map((group) => [group.id, group.allowedExerciseNames]));
const MINUTES_TEMPLATES = TEMPLATES.filter((template) =>
  template.sessions.some((session) => session.exercises.some((exercise) => exercise.trackingMode === 'duration_minutes')),
);
const MINUTES_NAMES = ['Rowing, Stationary', 'Stairmaster', 'Bicycling, Stationary', 'Elliptical Trainer', 'Walking, Treadmill'];
const MINUTES_LIBRARY = LIBRARY.filter((item) => mins.isMinutesExerciseName(item.name));

// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (rnd, n) => Math.floor(rnd() * n);
const pick = (rnd, list) => list[int(rnd, list.length)];

class Violation extends Error {}
const fail = (tag, message) => {
  throw new Violation(`${tag}: ${message}`);
};

const START_MS = Date.UTC(2026, 9, 7, 15, 0, 0);
let world = null;

const lower = (name) => String(name ?? '').trim().toLowerCase();
const key = (slotId, setIndex) => `${slotId}|${setIndex}`;
const same = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;
/** A warm-up's load carries 0.1 kg; no work load in this suite is off a 0.25 kg step. */
const isWarmupMarked = (kg) => typeof kg === 'number' && Math.round(kg * 100) % 25 !== 0;

function stable(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined && value[k] !== null)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function multiset(list) {
  return [...list].sort();
}
function sameMultiset(a, b) {
  const x = multiset(a);
  const y = multiset(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

function freshWorld() {
  return {
    now: START_MS,
    state: { ...workoutInitialState, hydrated: true, isRestoring: false },
    db: createEmptyDatabase('en'),
    shadow: null,
    startedSessions: 0,
    stats: new Map(),
    soft: new Map(),
  };
}
const count = (name) => world.stats.set(name, (world.stats.get(name) ?? 0) + 1);
/** A finding that does not stop the sequence: kept with the step that showed it. */
const soft = (tag, message) => {
  if (!world.soft.has(tag)) world.soft.set(tag, message);
};

/** workoutAppAdapter's shouldPersistExercise, as written. */
function persistsExercise(exercise) {
  if (exercise.status === 'skipped' || exercise.sessionInserted === true) return true;
  if (exercise.notes?.trim() || (exercise.status === 'swapped' && exercise.sourceExerciseName?.trim())) return true;
  return exercise.sets.some((set) => set.status !== 'pending' || set.edited);
}

function newShadow(sessionId) {
  return { sessionId, work: new Map(), warm: new Map(), clock: null };
}

function dispatch(action) {
  world.state = workoutReducer(world.state, action);
  return world.state;
}

const session = () => world.state.activeSession;
const isOpen = () => Boolean(session()) && session().status !== 'completed';

function isLoaded(exercise) {
  return !isUnloadedTrackingMode(exercise.trackingMode) && parseIntervalScheme(exercise.exerciseName) === null;
}

function pendingSets(filter = () => true) {
  const found = [];
  for (const exercise of session()?.exercises ?? []) {
    if (exercise.status === 'skipped') continue;
    for (const set of exercise.sets) {
      if (set.status === 'pending' && filter(exercise, set)) found.push({ exercise, set });
    }
  }
  return found;
}
function completedSets() {
  const found = [];
  for (const exercise of session()?.exercises ?? []) {
    for (const set of exercise.sets) {
      if (set.status === 'completed') found.push({ exercise, set });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

function customDay(rnd) {
  const id = `custom_${int(rnd, 1e9).toString(36)}`;
  const sessionId = `${id}_s0`;
  const exercises = [];
  const n = 1 + int(rnd, 5);
  for (let index = 0; index < n; index += 1) {
    const item = rnd() < 0.25 && MINUTES_LIBRARY.length > 0 ? pick(rnd, MINUTES_LIBRARY) : pick(rnd, LIBRARY);
    const repMin = 1 + int(rnd, 12);
    exercises.push({
      id: `${sessionId}_e${index}`,
      workoutTemplateId: id,
      workoutTemplateSessionId: sessionId,
      name: item.name,
      targetSets: 1 + int(rnd, 4),
      repMin,
      repMax: repMin + int(rnd, 6),
      restSeconds: 90,
      trackedDefault: true,
      orderIndex: index,
      libraryItemId: item.id,
      supersetGroup: null,
    });
  }
  const template = {
    id,
    name: 'My programme',
    exerciseIds: exercises.map((exercise) => exercise.id),
    sessions: [{ id: sessionId, name: 'Day 1', orderIndex: 0, exerciseIds: exercises.map((exercise) => exercise.id) }],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    origin: 'authored',
  };
  const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(template, [{ ...template.sessions[0], exercises }], LIBRARY, 90);
  return buildCustomSessionRuntimeTemplate(runtime, sessionId);
}

/** The runtime template of the day a sequence keeps coming back to, so the next start reads the last one's history. */
function dayFor(ev) {
  const rnd = mulberry32(ev.r);
  if (ev.kind === 'custom') {
    return customDay(rnd);
  }
  const pool = ev.kind === 'minutes' && MINUTES_TEMPLATES.length > 0 ? MINUTES_TEMPLATES : TEMPLATES;
  const template = pick(rnd, pool);
  const day = ev.kind === 'minutes'
    ? template.sessions.find((s) => s.exercises.some((e) => e.trackingMode === 'duration_minutes')) ?? template.sessions[0]
    : pick(rnd, template.sessions);
  return buildReadySessionRuntimeTemplate(template, day.id);
}

function checkNoWarmupLeak(label) {
  // Progression and the prefill read the slot history the last finish wrote. A load that only a warm-up held
  // reaching a working set means the warm-up was read as work.
  const history = world.state.history.slotHistory;
  if (session().exercises.some((exercise) => (history[exercise.slotId] ?? []).some((entry) => (entry.warmups ?? []).length > 0))) {
    count('start: a lift whose last time had warm-ups');
  }
  for (const exercise of session().exercises) {
    for (const set of exercise.sets) {
      const draft = Number(String(set.draftLoadText ?? '').replace(',', '.'));
      for (const [field, value] of [['plannedLoadKg', set.plannedLoadKg], ['draftLoadText', set.draftLoadText ? draft : undefined], ['autoProgressedFromKg', set.autoProgressedFromKg]]) {
        if (isWarmupMarked(value)) {
          fail('W4-progression', `${label}: ${exercise.exerciseName} set ${set.setIndex} opens with ${field} ${value}, a warm-up's load`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkLive(label) {
  const s = session();
  const shadow = world.shadow;
  if (!shadow) {
    if (s && s.status !== 'completed') fail('W1', `${label}: a session is live that nobody started`);
    return;
  }
  if (!s || s.sessionId !== shadow.sessionId) {
    fail('W1', `${label}: the live session is ${s ? s.sessionId : 'gone'}, expected ${shadow.sessionId}`);
  }
  // W1
  const live = new Map(completedSets().map(({ exercise, set }) => [key(exercise.slotId, set.setIndex), { exercise, set }]));
  for (const [k, want] of shadow.work) {
    const got = live.get(k);
    if (!got) fail('W1', `${label}: logged set ${k} (${want.reps} at ${want.kg} kg, ${want.lift}) is gone`);
    if (got.set.actualReps !== want.reps || !same(got.set.actualLoadKg, want.kg)) {
      fail('W1', `${label}: logged set ${k} reads ${got.set.actualReps} at ${got.set.actualLoadKg} kg, was ${want.reps} at ${want.kg}`);
    }
    const lift = liftOfSet(got.exercise, got.set);
    if (lower(lift.exerciseName) !== lower(want.lift)) {
      fail('W1', `${label}: logged set ${k} now answers as ${lift.exerciseName}, was logged as ${want.lift}`);
    }
  }
  for (const [k, got] of live) {
    if (!shadow.work.has(k)) fail('W1', `${label}: set ${k} is logged (${got.set.actualReps} at ${got.set.actualLoadKg}) and nobody logged it`);
  }
  // W2
  for (const exercise of s.exercises) {
    const want = (shadow.warm.get(exercise.slotId) ?? []).map((w) => `${w.reps}@${w.loadKg}@${w.completedAt}`);
    const got = (exercise.warmups ?? []).map((w) => `${w.reps}@${w.loadKg}@${w.completedAt}`);
    if (want.join(' ') !== got.join(' ')) {
      fail('W2', `${label}: ${exercise.exerciseName} holds warm-ups [${got.join(' ')}], expected [${want.join(' ')}]`);
    }
  }
  for (const slotId of shadow.warm.keys()) {
    if (!s.exercises.some((exercise) => exercise.slotId === slotId) && shadow.warm.get(slotId).length > 0) {
      fail('W2', `${label}: the lift ${slotId} with warm-ups is gone`);
    }
  }
  // W3
  if (s.status !== 'completed') {
    const clock = s.minutesClock ?? null;
    if (stable(clock) !== stable(shadow.clock)) {
      fail('W3', `${label}: the minutes clock is ${stable(clock)}, expected ${stable(shadow.clock)}`);
    }
    if (clock) {
      const exercise = s.exercises.find((e) => e.slotId === clock.slotId);
      const set = exercise?.sets.find((x) => x.setIndex === clock.setIndex);
      const dangling = !exercise || !set || set.status !== 'pending' || exercise.exerciseName !== clock.exerciseName || exercise.status === 'skipped';
      if (dangling && shadow.clockSetRemoved) {
        soft('W3-removeSet', `${label}: the minutes clock names ${clock.slotId} set ${clock.setIndex}, a set Remove set took off`);
      } else if (dangling) {
        fail('W3-dangling', `${label}: the minutes clock (${clock.runningSinceMs === null ? 'stopped' : 'running'}, ${Math.round(mins.stopwatchElapsedMs(clock, world.now) / 1000)} s) names ${clock.slotId} set ${clock.setIndex} "${clock.exerciseName}", which is ${!exercise ? 'no lift' : !set ? 'no set' : `${set.status}, ${exercise.exerciseName}, ${exercise.status}`}`);
      }
      if (s.pausedAt && clock.runningSinceMs !== null) {
        fail('W3', `${label}: the workout is paused and the bout's clock runs on`);
      }
    }
  }
  // numbers
  for (const exercise of s.exercises) {
    for (const set of exercise.sets) {
      if (set.status === 'completed' && (!Number.isInteger(set.actualReps) || set.actualReps < 1 || !Number.isFinite(set.actualLoadKg))) {
        fail('W1', `${label}: logged set ${exercise.slotId}|${set.setIndex} holds ${set.actualReps} at ${set.actualLoadKg}`);
      }
    }
  }
}

/**
 * W4 on a session and what saving it gives. `expect` is the shadow (work + warm). Returns the finished state.
 */
function checkSave(state, shadow, label, nowMs) {
  const s = state.activeSession;
  const adapted = adaptCompletedWorkoutSessionForAppDatabase(s, nowMs);
  const workWant = [...shadow.work.values()].map((w) => `${lower(w.lift)}|${w.reps}@${w.kg}`);
  const warmWant = [...shadow.warm.values()].flat().map((w) => `${w.reps}@${w.loadKg}`);

  // What saveCompletedWorkoutSession receives.
  const workIn = [];
  const warmIn = [];
  for (const log of adapted.logs) {
    for (const set of log.sets) {
      if (set.kind === 'warmup') {
        warmIn.push(`${set.reps}@${set.weight}`);
        if (set.orderIndex >= 0) fail('W4', `${label}: a warm-up is numbered ${set.orderIndex}, among the working sets`);
      } else if (set.status === 'completed' || set.outcome === 'completed') {
        workIn.push(`${lower(log.exerciseNameSnapshot)}|${set.reps}@${set.weight}`);
        if (isWarmupMarked(set.weight)) fail('W4', `${label}: a warm-up's load ${set.weight} is saved as a working set of ${log.exerciseNameSnapshot}`);
      }
    }
  }
  if (!sameMultiset(workIn, workWant)) {
    fail('W4', `${label}: the save receives working sets [${multiset(workIn).join(' ')}], the reader logged [${multiset(workWant).join(' ')}]`);
  }
  if (!sameMultiset(warmIn, warmWant)) {
    // A lift the adapter leaves out of the save (nothing done on it, not skipped: shouldPersistExercise) takes its
    // warm-ups with it. Told apart, so it does not hide any other loss. Not a finding: the slot history's entry for
    // that lift has no working set, so "Last time" and the warm-up offer pass over it (exerciseHistoryLookup
    // isUsableEntry) and agree with History that the lift was not done (hunt verdict, 2026-10-07).
    const kept = [];
    for (const exercise of s.exercises) {
      if (persistsExercise(exercise)) kept.push(...(exercise.warmups ?? []).map((w) => `${w.reps}@${w.loadKg}`));
    }
    if (sameMultiset(warmIn, kept)) {
      count('save: warm-ups of a lift with no working set left out');
    } else {
      fail('W4-warmup', `${label}: the save receives warm-ups [${multiset(warmIn).join(' ')}], the reader logged [${multiset(warmWant).join(' ')}]`);
    }
  }
  // Each warm-up is saved under the lift it was a warm-up for (the lift the slot held when it was logged).
  const warmLiftIn = [];
  for (const log of adapted.logs) {
    for (const set of log.sets) {
      if (set.kind === 'warmup') warmLiftIn.push(`${lower(log.exerciseNameSnapshot)}|${set.reps}@${set.weight}`);
    }
  }
  const warmLiftWant = [...shadow.warm.values()].flat().filter((w) => w.lift).map((w) => `${lower(w.lift)}|${w.reps}@${w.loadKg}`);
  const misfiled = warmLiftIn.filter((entry) => !warmLiftWant.includes(entry));
  if (misfiled.length > 0) {
    soft('W4-warmupLift', `${label}: warm-ups saved as [${multiset(warmLiftIn).join(' ')}], logged for [${multiset(warmLiftWant).join(' ')}]`);
  }
  const worked = [...shadow.work.values()].some((w) => w.reps > 0);
  if (sessionRecordedWork(adapted.logs) !== worked) {
    fail('W4', `${label}: sessionRecordedWork says ${!worked} with ${shadow.work.size} working sets and ${warmWant.length} warm-ups`);
  }
  for (const log of adapted.logs) {
    if (getComparableLogSets({ ...log, weight: 0, repsPerSet: [] }).some((set) => set.kind === 'warmup')) {
      fail('W4', `${label}: a warm-up of ${log.exerciseNameSnapshot} counts as a comparable (working) set`);
    }
  }

  // The write.
  let finished = state;
  if (worked) {
    const result = persistCompletedWorkoutSessionToDatabase(createEmptyDatabase('en'), adapted);
    if (!result.didPersist) fail('W4', `${label}: a session with ${shadow.work.size} logged sets did not save`);
    if (result.summary.setsCompleted !== shadow.work.size) {
      fail('W4', `${label}: the saved session counts ${result.summary.setsCompleted} sets, the reader logged ${shadow.work.size} (and ${warmWant.length} warm-ups)`);
    }
    const workVolume = [...shadow.work.values()].reduce((sum, w) => sum + w.kg * w.reps, 0);
    if (result.summary.totalVolume > workVolume + 1e-6) {
      fail('W4', `${label}: the saved volume ${result.summary.totalVolume} is more than the working sets' ${workVolume}`);
    }
  }

  // The reducer's finish: the slot history the next session prefills from.
  finished = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: new Date(nowMs).toISOString() } });
  if (finished.activeSession?.status !== 'completed') fail('W4', `${label}: finishing left the session ${finished.activeSession?.status}`);
  const summary = finished.history.sessions[0];
  if (!summary || summary.sessionId !== s.sessionId || summary.setsCompleted !== shadow.work.size) {
    fail('W4', `${label}: the history summary holds ${summary?.setsCompleted} sets, the reader logged ${shadow.work.size}`);
  }
  const histWork = [];
  const histWarm = [];
  for (const [slotId, entries] of Object.entries(finished.history.slotHistory)) {
    for (const entry of entries) {
      if (entry.sessionId !== s.sessionId) continue;
      for (const set of entry.sets) {
        histWork.push(`${lower(entry.exerciseName)}|${set.reps}@${set.loadKg}`);
      }
      for (const w of entry.warmups ?? []) {
        histWarm.push(`${w.reps}@${w.loadKg}`);
        if (!warmLiftWant.includes(`${lower(entry.exerciseName)}|${w.reps}@${w.loadKg}`)) {
          soft('W4-warmupLiftHistory', `${label}: the slot history files the warm-up ${w.reps}@${w.loadKg} under ${entry.exerciseName}, logged for [${multiset(warmLiftWant).join(' ')}]`);
        }
      }
      void slotId;
    }
  }
  if (!sameMultiset(histWork, workWant)) {
    fail('W4', `${label}: the slot history holds working sets [${multiset(histWork).join(' ')}], the reader logged [${multiset(workWant).join(' ')}]`);
  }
  if (!sameMultiset(histWarm, warmWant)) {
    fail('W4-warmup', `${label}: the slot history holds warm-ups [${multiset(histWarm).join(' ')}], the reader logged [${multiset(warmWant).join(' ')}]`);
  }
  return finished;
}

/**
 * The stored row after a finish: exactly the working sets the reader has (a finish again merges, and the session
 * holds every set it stored, less what it took back), and each warm-up once.
 */
function checkStoredRow(sessionId, shadow, label) {
  const logs = world.db.exerciseLogs.filter((log) => log.sessionId === sessionId && log.skipped !== true && log.status !== 'skipped');
  const work = [];
  const warm = [];
  for (const log of logs) {
    for (const set of log.sets) {
      if (set.kind === 'warmup') warm.push(`${set.reps}@${set.weight}`);
      else if (set.status === 'completed' || set.outcome === 'completed') work.push(`${lower(log.exerciseNameSnapshot)}|${set.reps}@${set.weight}`);
    }
  }
  const allLogs = world.db.exerciseLogs.filter((log) => log.sessionId === sessionId);
  for (const log of allLogs) {
    if (log.skipped === true || log.status === 'skipped') {
      for (const set of log.sets) if (set.kind === 'warmup') warm.push(`${set.reps}@${set.weight}`);
    }
  }
  const workWant = [...shadow.work.values()].map((w) => `${lower(w.lift)}|${w.reps}@${w.kg}`);
  if (!sameMultiset(work, workWant)) {
    fail('W6', `${label}: the stored workout holds working sets [${multiset(work).join(' ')}], the reader has [${multiset(workWant).join(' ')}]`);
  }
  const warmWant = [...shadow.warm.values()].flat().map((w) => `${w.reps}@${w.loadKg}`);
  const dup = multiset(warm).filter((v, i, a) => i > 0 && a[i - 1] === v && multiset(warmWant).filter((x) => x === v).length < a.filter((x) => x === v).length);
  if (dup.length > 0) {
    fail('W6', `${label}: the stored workout holds warm-ups [${multiset(warm).join(' ')}], more than the reader has [${multiset(warmWant).join(' ')}]`);
  }
  const extra = warm.filter((v) => !warmWant.includes(v));
  if (extra.length > 0) {
    soft('W6-warmupBack', `${label}: the stored workout holds warm-ups [${multiset(warm).join(' ')}], the reader has [${multiset(warmWant).join(' ')}]`);
  }
}

/** W4: whatever the step left, a savable finish is reachable (on a copy). */
function probeSavable(label) {
  if (!isOpen()) return;
  let state = world.state;
  const shadow = { work: new Map(world.shadow.work), warm: new Map(world.shadow.warm) };
  if (shadow.work.size === 0) {
    const target = pendingSets()[0];
    if (!target) {
      count('probe: nothing left to log');
      return;
    }
    const { exercise, set } = target;
    const loaded = isLoaded(exercise);
    const reps = exercise.trackingMode === 'hold' || parseIntervalScheme(exercise.exerciseName) ? 30 : 8;
    state = workoutReducer(state, { type: 'set/updateDraft', payload: { slotId: exercise.slotId, setIndex: set.setIndex, patch: { repsText: String(reps), loadText: loaded ? '20' : undefined } } });
    state = workoutReducer(state, { type: 'set/complete', payload: { slotId: exercise.slotId, setIndex: set.setIndex, nowMs: world.now, unitPreference: 'kg' } });
    const done = state.activeSession.exercises.find((e) => e.slotId === exercise.slotId).sets.find((x) => x.setIndex === set.setIndex);
    if (done.status !== 'completed') {
      fail('W4', `${label}: the first pending set (${exercise.exerciseName}, ${exercise.trackingMode}) cannot be logged with ${reps}${loaded ? ' at 20 kg' : ''}`);
    }
    shadow.work.set(key(exercise.slotId, set.setIndex), { reps: done.actualReps, kg: done.actualLoadKg, lift: exercise.exerciseName });
  }
  checkSave(state, shadow, `${label} (probe)`, world.now);
}

/** W5: what a reload gives back. */
function roundTrip(label) {
  const before = world.state;
  const bundle = {
    activeSession: before.activeSession,
    history: before.history,
    activeCardio: before.activeCardio,
    freestyleDraft: before.freestyleDraft,
  };
  const loaded = persistence.normalizeWorkoutBundle(JSON.parse(JSON.stringify(bundle)));
  let state = workoutReducer(workoutInitialState, { type: 'session/markRestoring', payload: { value: true } });
  state = workoutReducer(state, { type: 'session/hydrate', payload: loaded });
  const a = stable(JSON.parse(JSON.stringify(before.activeSession)));
  const b = stable(JSON.parse(JSON.stringify(state.activeSession)));
  if (a !== b) {
    let at = 0;
    while (at < a.length && a[at] === b[at]) at += 1;
    fail('W5', `${label}: the session read back differs at …${a.slice(Math.max(0, at - 80), at + 60)}… vs …${b.slice(Math.max(0, at - 80), at + 60)}…`);
  }
  if (stable(JSON.parse(JSON.stringify(before.history))) !== stable(JSON.parse(JSON.stringify(state.history)))) {
    fail('W5', `${label}: the history read back differs`);
  }
  world.state = { ...state, completionSummary: before.completionSummary };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const KINDS = [
  ['log', 14], ['warmup', 7], ['warmupBad', 1], ['removeWarmup', 2], ['edit', 2], ['undo', 2], ['swap', 4], ['skip', 2],
  ['addSet', 2], ['removeSet', 2], ['insert', 2], ['clockStart', 6], ['clockPause', 2], ['leaveStep', 3], ['pause', 2],
  ['resume', 2], ['wait', 4], ['step', 2], ['reload', 4], ['finish', 2], ['discard', 1],
];
const TOTAL = KINDS.reduce((sum, [, w]) => sum + w, 0);

function generate(rnd) {
  const events = [{ t: 'start', kind: pick(rnd, ['ready', 'minutes', 'minutes', 'custom']), r: int(rnd, 1e9), dt: 1000 }];
  const length = 5 + int(rnd, 35);
  for (let i = 0; i < length; i += 1) {
    let roll = int(rnd, TOTAL);
    let t = KINDS[0][0];
    for (const [name, w] of KINDS) {
      if (roll < w) {
        t = name;
        break;
      }
      roll -= w;
    }
    const ev = { t, r: int(rnd, 1e9), dt: 250 + int(rnd, 60000) };
    if (t === 'wait') ev.dt = rnd() < 0.15 ? 2 * 3600 * 1000 + int(rnd, 3600 * 1000) : 1000 + int(rnd, 40 * 60 * 1000);
    if (t === 'finish' && rnd() < 0.35) ev.lost = true;
    events.push(ev);
    if ((t === 'finish' && !ev.lost) || t === 'discard') {
      events.push({ t: 'start', kind: pick(rnd, ['same', 'same', 'minutes', 'custom']), r: int(rnd, 1e9), dt: 1000 });
    }
  }
  return events;
}

const describe = (ev) => `${ev.t}${ev.kind ? `:${ev.kind}` : ''}${ev.lost ? ':clearLost' : ''}(r=${ev.r},dt=${ev.dt})`;

function clockOf() {
  return session()?.minutesClock ?? null;
}

function apply(ev, ctx) {
  const rnd = mulberry32(ev.r);
  world.now += ev.dt;
  const s = session();
  switch (ev.t) {
    case 'start': {
      if (isOpen()) {
        count('start refused: a session is running');
        return;
      }
      if (s && s.status === 'completed') {
        dispatch({ type: 'session/clearCompletedSession' });
      }
      const template = ev.kind === 'same' && ctx.lastTemplate ? ctx.lastTemplate : dayFor(ev);
      ctx.lastTemplate = template;
      dispatch({
        type: 'session/startFromRuntimeTemplate',
        payload: { template, sessionOrderIndex: 1, unitPreference: 'kg', progression: { automatedProgressionEnabled: rnd() < 0.5, nowMs: world.now } },
      });
      const started = session();
      if (!started || started.exercises.length === 0 || started.exercises.some((e) => e.sets.length === 0)) {
        fail('N2', `starting ${template.id} gave ${started ? `${started.exercises.length} lifts` : 'no session'}`);
      }
      world.shadow = newShadow(started.sessionId);
      checkNoWarmupLeak(`start ${template.id}`);
      dispatch({ type: 'session/setGuidedStep', payload: { stepIndex: 1, nowMs: world.now } });
      return;
    }
    case 'log': {
      if (!isOpen()) return;
      // The player walks a lift's sets in order: the next set of a lift is its first pending one.
      const options = pendingSets((exercise, set) => exercise.sets.find((x) => x.status === 'pending') === set);
      if (options.length === 0) return;
      const { exercise, set } = pick(rnd, options);
      const loaded = isLoaded(exercise);
      let reps;
      const clock = clockOf();
      const onClock = clock && clock.slotId === exercise.slotId && clock.setIndex === set.setIndex && clock.exerciseName === exercise.exerciseName;
      if (isMinutesTrackingMode(exercise.trackingMode)) {
        reps = onClock
          ? mins.minutesToLog({ plannedMinutes: set.plannedRepsMax, elapsedMs: mins.stopwatchElapsedMs(clock, world.now) })
          : 1 + int(rnd, 60);
        count(onClock ? 'log: a timed bout' : 'log: minutes');
      } else if (exercise.trackingMode === 'hold' || parseIntervalScheme(exercise.exerciseName)) {
        reps = 10 + int(rnd, 50);
      } else {
        reps = 1 + int(rnd, 15);
      }
      const boutMs = onClock ? mins.stopwatchElapsedMs(clock, world.now) : 0;
      const kg = loaded ? 2.5 * (1 + int(rnd, 60)) : undefined;
      dispatch({ type: 'set/updateDraft', payload: { slotId: exercise.slotId, setIndex: set.setIndex, patch: { repsText: String(reps), loadText: kg === undefined ? undefined : String(kg) } } });
      dispatch({ type: 'set/complete', payload: { slotId: exercise.slotId, setIndex: set.setIndex, nowMs: world.now, unitPreference: 'kg' } });
      const done = session().exercises.find((e) => e.slotId === exercise.slotId).sets.find((x) => x.setIndex === set.setIndex);
      if (done.status !== 'completed') {
        fail('N2', `a set of ${exercise.exerciseName} (${exercise.trackingMode}) with ${reps}${kg !== undefined ? ` at ${kg} kg` : ''} was refused`);
      }
      world.shadow.work.set(key(exercise.slotId, set.setIndex), { reps, kg: kg ?? done.actualLoadKg, lift: exercise.exerciseName });
      // W7: a bout timed on the clock was workout time: the workout's own clock holds at least that much of it.
      if (onClock && boutMs > 0) {
        const workoutMs = workoutSecondsUntil(session(), world.now) * 1000;
        if (workoutMs + 60000 < boutMs) {
          // A gap longer than SESSION_IDLE_MS with nothing dispatched is read as time away (lib/sessionClock), and a
          // running bout dispatches nothing: it has to count as in use (sessionLastActiveMs). Reported (soft) so it
          // does not hide what else a sequence finds.
          soft('W7', `a ${Math.round(boutMs / 60000)}-minute bout of ${exercise.exerciseName} timed on the clock and logged as ${reps} min leaves the workout at ${Math.round(workoutMs / 60000)} min`);
        }
        count('log: timed bout checked against the workout clock');
      }
      if (onClock || (clock && clock.slotId === exercise.slotId && clock.setIndex === set.setIndex)) {
        world.shadow.clock = null;
      }
      count('log');
      return;
    }
    case 'warmup':
    case 'warmupBad': {
      if (!isOpen()) return;
      // As the player offers it: "+ Warm-up set" on a loaded lift's first set while that set is still open.
      const loadedLifts = s.exercises.filter((e) => isLoaded(e) && e.status !== 'skipped' && e.sets[0]?.setIndex === 0 && e.sets[0].status !== 'completed');
      if (loadedLifts.length === 0) return;
      const exercise = pick(rnd, loadedLifts);
      const completedAt = new Date(world.now).toISOString();
      if (ev.t === 'warmupBad') {
        const [loadKg, reps] = pick(rnd, [[0, 5], [700, 5], [20.1, 0], [20.1, 101], [20.1, 2.5], [-5, 5], [Number.NaN, 5]]);
        const before = world.state;
        dispatch({ type: 'exercise/logWarmup', payload: { slotId: exercise.slotId, loadKg, reps, completedAt } });
        if (world.state !== before) fail('W2', `an impossible warm-up (${reps} at ${loadKg} kg) was taken`);
        return;
      }
      const loadKg = 2.5 * (1 + int(rnd, 40)) + 0.1;
      const reps = 1 + int(rnd, 12);
      dispatch({ type: 'exercise/logWarmup', payload: { slotId: exercise.slotId, loadKg, reps, completedAt } });
      const list = world.shadow.warm.get(exercise.slotId) ?? [];
      world.shadow.warm.set(exercise.slotId, [...list, { loadKg, reps, completedAt, lift: exercise.exerciseName }]);
      count('warm-up');
      return;
    }
    case 'removeWarmup': {
      if (!isOpen()) return;
      const withWarm = s.exercises.filter((e) => (e.warmups ?? []).length > 0);
      if (withWarm.length === 0) return;
      const exercise = pick(rnd, withWarm);
      const index = int(rnd, exercise.warmups.length);
      dispatch({ type: 'exercise/removeWarmup', payload: { slotId: exercise.slotId, index } });
      const list = [...world.shadow.warm.get(exercise.slotId)];
      list.splice(index, 1);
      world.shadow.warm.set(exercise.slotId, list);
      return;
    }
    case 'edit': {
      if (!isOpen()) return;
      const options = completedSets();
      if (options.length === 0) return;
      const { exercise, set } = pick(rnd, options);
      const lift = liftOfSet(exercise, set);
      const unloaded = isUnloadedTrackingMode(lift.trackingMode);
      const reps = 1 + int(rnd, isMinutesTrackingMode(lift.trackingMode) ? 60 : 15);
      const loadKg = 2.5 * (1 + int(rnd, 60));
      dispatch({ type: 'set/editLogged', payload: { slotId: exercise.slotId, setIndex: set.setIndex, reps, loadKg } });
      const k = key(exercise.slotId, set.setIndex);
      world.shadow.work.set(k, { ...world.shadow.work.get(k), reps, kg: unloaded ? 0 : loadKg });
      return;
    }
    case 'undo': {
      if (!isOpen()) return;
      // Back over a logged set takes back the last one logged on that lift.
      const options = completedSets().filter(({ exercise, set }) => {
        const done = exercise.sets.filter((x) => x.status === 'completed');
        return done[done.length - 1] === set;
      });
      if (options.length === 0) return;
      const { exercise, set } = pick(rnd, options);
      const undone = world.shadow.work.get(key(exercise.slotId, set.setIndex));
      dispatch({ type: 'set/undo', payload: { slotId: exercise.slotId, setIndex: set.setIndex } });
      world.shadow.work.delete(key(exercise.slotId, set.setIndex));
      // The last set of a lift swapped away taken back: its warm-ups go, as a swap with nothing logged drops them.
      const nothingLeft = ![...world.shadow.work.keys()].some((k) => k.startsWith(`${exercise.slotId}|`));
      if (nothingLeft && undone && lower(undone.lift) !== lower(exercise.exerciseName)) {
        world.shadow.warm.delete(exercise.slotId);
        count('undo: last set of a lift swapped away');
      }
      return;
    }
    case 'swap': {
      if (!isOpen()) return;
      const options = s.exercises.filter((e) => e.sets.some((x) => x.status === 'pending'));
      if (options.length === 0) return;
      const exercise = pick(rnd, options);
      const group = (GROUPS.get(exercise.substitutionGroup) ?? []).filter((name) => lower(name) !== lower(exercise.exerciseName));
      const roll = rnd();
      const name =
        roll < 0.45 && group.length > 0
          ? pick(rnd, group)
          : roll < 0.75
            ? pick(rnd, MINUTES_NAMES)
            : pick(rnd, LIBRARY).name;
      if (lower(name) === lower(exercise.exerciseName)) return;
      const hadLogged = exercise.sets.some((x) => x.status === 'completed');
      dispatch({ type: 'exercise/swap', payload: { slotId: exercise.slotId, exerciseName: name, substitutionGroup: exercise.substitutionGroup, unitPreference: 'kg' } });
      if (!hadLogged) world.shadow.warm.delete(exercise.slotId);
      if (world.shadow.clock?.slotId === exercise.slotId) world.shadow.clock = null;
      count(hadLogged ? 'swap: after logged sets' : 'swap: nothing logged');
      if ((exercise.warmups ?? []).length > 0) count('swap: lift with warm-ups');
      return;
    }
    case 'skip': {
      if (!isOpen()) return;
      const exercise = pick(rnd, s.exercises);
      dispatch({ type: 'exercise/skip', payload: { slotId: exercise.slotId } });
      if (world.shadow.clock?.slotId === exercise.slotId) world.shadow.clock = null;
      return;
    }
    case 'addSet': {
      if (!isOpen()) return;
      const exercise = pick(rnd, s.exercises);
      dispatch({ type: 'exercise/addSet', payload: { slotId: exercise.slotId } });
      return;
    }
    case 'removeSet': {
      if (!isOpen()) return;
      const exercise = pick(rnd, s.exercises);
      dispatch({ type: 'exercise/removeSet', payload: { slotId: exercise.slotId } });
      // A clock whose set came off goes with it, as it does with a lift skipped or swapped away (W3 fails a clock
      // kept; it was reported apart, W3-removeSet, until the reducer dropped it).
      const clock = world.shadow.clock;
      if (clock && !session().exercises.some((e) => e.slotId === clock.slotId && e.sets.some((x) => x.setIndex === clock.setIndex))) {
        world.shadow.clock = null;
        world.shadow.clockSetRemoved = true;
        count('removeSet: the clock set came off');
      }
      return;
    }
    case 'insert': {
      if (!isOpen()) return;
      const item = rnd() < 0.4 && MINUTES_LIBRARY.length > 0 ? pick(rnd, MINUTES_LIBRARY) : pick(rnd, LIBRARY);
      const anchor = pick(rnd, s.exercises);
      dispatch({
        type: 'exercise/insertAfter',
        payload: {
          afterSlotId: anchor.slotId,
          exercise: {
            exerciseName: item.name,
            trackingMode: getCatalogTrackingMode(item.name),
            sets: 1 + int(rnd, 3),
            repsMin: 8,
            repsMax: 12,
            restSecondsMin: 90,
            restSecondsMax: 90,
            substitutionGroup: item.id,
            libraryItemId: item.id,
          },
        },
      });
      return;
    }
    case 'clockStart': {
      if (!isOpen() || s.pausedAt) return;
      const options = pendingSets((exercise) => isMinutesTrackingMode(exercise.trackingMode));
      if (options.length === 0) return;
      const { exercise, set } = pick(rnd, options);
      const ref = { slotId: exercise.slotId, setIndex: set.setIndex, exerciseName: exercise.exerciseName };
      const current = clockOf();
      const watch = mins.startStopwatch(mins.stopwatchForSet(current, ref), world.now);
      const clock = { ...ref, plannedMinutes: set.plannedRepsMax, ...watch };
      dispatch({ type: 'session/setMinutesClock', payload: { clock } });
      world.shadow.clock = clock;
      world.shadow.clockSetRemoved = false;
      count('clock started');
      return;
    }
    case 'clockPause': {
      const clock = clockOf();
      if (!isOpen() || !clock || clock.runningSinceMs === null) return;
      const next = { ...clock, ...mins.pauseStopwatch(clock, world.now) };
      dispatch({ type: 'session/setMinutesClock', payload: { clock: next } });
      world.shadow.clock = next;
      return;
    }
    case 'leaveStep': {
      if (!isOpen()) return;
      const options = pendingSets();
      const shown = options.length > 0 && rnd() < 0.7 ? pick(rnd, options) : null;
      const clock = clockOf();
      const next = mins.minutesClockOnStep(
        clock,
        shown ? { slotId: shown.exercise.slotId, setIndex: shown.set.setIndex, exerciseName: shown.exercise.exerciseName } : null,
        world.now,
      );
      if (next !== clock) {
        dispatch({ type: 'session/setMinutesClock', payload: { clock: next } });
        world.shadow.clock = next;
        count('clock paused by leaving its step');
      }
      return;
    }
    case 'pause': {
      if (!isOpen() || s.pausedAt) return;
      dispatch({ type: 'session/pause' });
      const clock = world.shadow.clock;
      if (clock && clock.runningSinceMs !== null) {
        world.shadow.clock = { ...clock, ...mins.pauseStopwatch(clock, world.now) };
        count('clock paused by the workout pause');
      }
      return;
    }
    case 'resume': {
      if (!isOpen()) return;
      dispatch({ type: 'session/resume', payload: { nowMs: world.now } });
      return;
    }
    case 'wait':
      return;
    case 'step': {
      if (!isOpen()) return;
      dispatch({ type: 'session/setGuidedStep', payload: { stepIndex: int(rnd, 20), nowMs: world.now } });
      return;
    }
    case 'reload': {
      roundTrip(`reload`);
      count('reload');
      return;
    }
    case 'finish': {
      if (!isOpen()) return;
      // Finish from the player pauses nothing; a pause still open is closed by the finish.
      const worked = world.shadow.work.size > 0;
      if (!worked) {
        // The finish handler discards a session with nothing lifted (finishSaves: sessionRecordedWork).
        dispatch({ type: 'session/discardWorkout' });
        world.shadow = null;
        count('finish: nothing lifted, discarded');
        return;
      }
      const finished = checkSave(world.state, world.shadow, 'finish', world.now);
      const adapted = adaptCompletedWorkoutSessionForAppDatabase(world.state.activeSession, world.now);
      // finishSaves: a session already in the database (a finish whose clear was lost) is merged into its row.
      const mergeStored = world.db.workoutSessions.some((row) => row.id === adapted.sessionId);
      const result = persistCompletedWorkoutSessionToDatabase(world.db, { ...adapted, mergeStored });
      if (!result.didPersist && !result.wasStored) fail('N2', 'the finish did not save');
      world.db = result.database;
      checkStoredRow(adapted.sessionId, world.shadow, mergeStored ? 'finish again (merged)' : 'finish');
      if (ev.lost) {
        // The save landed and the bundle writes behind it (finished, cleared) did not: the next launch brings the
        // session back active, as it stood before Finish. The reader carries on in it and finishes again.
        count('finish: clear lost, session back');
        return;
      }
      world.state = finished;
      world.shadow = null;
      count('finish');
      return;
    }
    case 'discard': {
      if (!isOpen()) return;
      dispatch({ type: 'session/discardWorkout' });
      world.shadow = null;
      return;
    }
    default:
      throw new Error(`unknown event ${ev.t}`);
  }
}

function withClock(run) {
  const RealDate = Date;
  const savedTz = process.env.TZ;
  process.env.TZ = 'Europe/Helsinki';
  class TestDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(world ? world.now : START_MS);
      else super(...args);
    }
    static now() {
      return world ? world.now : START_MS;
    }
  }
  global.Date = TestDate;
  try {
    return run();
  } finally {
    global.Date = RealDate;
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  }
}

/** Runs a sequence; null, or the failure with the step it happened at. */
function runSequence(events) {
  world = freshWorld();
  const ctx = { lastTemplate: null };
  for (let step = 0; step < events.length; step += 1) {
    const label = `step ${step + 1} ${events[step].t}`;
    try {
      apply(events[step], ctx);
      checkLive(label);
      probeSavable(label);
    } catch (error) {
      return { step, message: error instanceof Violation ? error.message : `crash: ${error.stack}` };
    }
  }
  return null;
}

function shrink(events, failure) {
  const tag = failure.message.split(':')[0];
  let current = events.slice(0, failure.step + 1);
  let best = failure;
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < current.length; index += 1) {
      const candidate = current.filter((_, at) => at !== index);
      const result = runSequence(candidate);
      if (result && result.message.split(':')[0] === tag) {
        current = candidate.slice(0, result.step + 1);
        best = result;
        changed = true;
        break;
      }
    }
  }
  return { events: current, failure: best };
}

/** The shortest sequence that still shows a soft finding (and no hard one). */
function shrinkSoft(events, tag, message) {
  let current = events;
  let best = message;
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < current.length; index += 1) {
      const candidate = current.filter((_, at) => at !== index);
      const result = runSequence(candidate);
      if (!result && world.soft.has(tag)) {
        current = candidate;
        best = world.soft.get(tag);
        changed = true;
        break;
      }
    }
  }
  return { message: best, events: current };
}

/** Every distinct failure kind found in the run, each shrunk, so one defect does not hide the next. */
function hunt(sequences, seed, kindsToSkip = new Set()) {
  const random = mulberry32(seed);
  const found = new Map();
  const totals = new Map();
  const softFound = new Map();
  for (let index = 0; index < sequences; index += 1) {
    const events = generate(random);
    const failure = withClock(() => runSequence(events));
    for (const [k, v] of world.stats) totals.set(k, (totals.get(k) ?? 0) + v);
    for (const [tag, message] of world.soft) {
      if (!softFound.has(tag)) softFound.set(tag, { index, ...withClock(() => shrinkSoft(events, tag, message)) });
    }
    if (failure) {
      const tag = failure.message.split(':')[0];
      if (kindsToSkip.has(tag) || found.has(tag)) continue;
      const small = withClock(() => shrink(events, failure));
      found.set(tag, { index, ...small });
    }
  }
  return { found, totals, softFound };
}

function report(found) {
  return [...found.entries()]
    .map(([tag, { index, events, failure }]) =>
      [
        `[${tag}] sequence #${index}: ${failure.message}`,
        `  shortest sequence (${events.length} steps; INV2_REPLAY='${JSON.stringify(events)}'):`,
        ...events.map((event, at) => `    ${at + 1}. ${describe(event)}`),
      ].join('\n'),
    )
    .join('\n\n');
}

module.exports = [
  {
    name: `workout lifecycle 2: ${SEQUENCES} random sequences with warm-ups, swaps, skips, adds, the minutes clock, reloads and finishes keep N1/N2`,
    run() {
      if (process.env.INV2_REPLAY) {
        const events = JSON.parse(process.env.INV2_REPLAY);
        const failure = withClock(() => runSequence(events));
        assert.equal(failure, null, failure ? `${failure.message} (step ${failure.step + 1})` : '');
        assert.equal(world.soft.size, 0, [...world.soft.values()].join(' | '));
        return;
      }
      const { found, totals, softFound } = hunt(SEQUENCES, SEED);
      if (process.env.INV2_STATS) {
        console.log([...totals].sort().map(([k, n]) => `${n} ${k}`).join('\n'));
      }
      // A soft finding did not stop its sequence (so it could not hide another), but it is a broken invariant all the
      // same: the suite fails on it, with the first sequence that showed it.
      const softReport = [...softFound]
        .map(([tag, { index, message, events }]) => `[soft ${tag}] first in sequence #${index}: ${message}\n  sequence: ${events.map(describe).join(', ')}`)
        .join('\n\n');
      assert.equal(found.size + softFound.size, 0, `\n${report(found)}\n\n${softReport}`);
    },
  },
  {
    name: 'workout lifecycle 2: each check rejects a broken state (the checks are not vacuous)',
    run() {
      withClock(() => {
        const start = { t: 'start', kind: 'minutes', r: 4242, dt: 1000 };
        const base = () => {
          world = freshWorld();
          const ctx = { lastTemplate: null };
          apply(start, ctx);
          return ctx;
        };
        const firstLoaded = () => session().exercises.find((e) => isLoaded(e)) ?? null;
        const expectFail = (tag, mutate) => {
          base();
          // log one set and one warm-up so there is something to lose
          apply({ t: 'log', r: 1, dt: 1000 }, {});
          const loaded = firstLoaded();
          if (loaded) {
            dispatch({ type: 'exercise/logWarmup', payload: { slotId: loaded.slotId, loadKg: 20.1, reps: 5, completedAt: new Date(world.now).toISOString() } });
            world.shadow.warm.set(loaded.slotId, [{ loadKg: 20.1, reps: 5, completedAt: new Date(world.now).toISOString(), lift: loaded.exerciseName }]);
          }
          checkLive('fixture before');
          probeSavable('fixture before');
          let threw = null;
          try {
            mutate();
          } catch (error) {
            threw = error;
          }
          assert.ok(threw instanceof Violation, `${tag}: the broken state passed`);
          assert.ok(threw.message.startsWith(tag), `${tag}: failed with ${threw.message}`);
        };
        const firstDone = () => completedSets()[0];
        const editSession = (fn) => {
          const s = JSON.parse(JSON.stringify(session()));
          fn(s);
          world.state = { ...world.state, activeSession: s };
        };
        // W1: a logged set gone / changed value.
        expectFail('W1', () => {
          const { exercise, set } = firstDone();
          editSession((s) => {
            s.exercises.find((e) => e.slotId === exercise.slotId).sets.find((x) => x.setIndex === set.setIndex).status = 'pending';
          });
          checkLive('broken');
        });
        expectFail('W1', () => {
          const { exercise, set } = firstDone();
          editSession((s) => {
            s.exercises.find((e) => e.slotId === exercise.slotId).sets.find((x) => x.setIndex === set.setIndex).actualReps += 1;
          });
          checkLive('broken');
        });
        // W2: a warm-up lost.
        expectFail('W2', () => {
          editSession((s) => {
            s.exercises.forEach((e) => {
              e.warmups = undefined;
            });
          });
          checkLive('broken');
        });
        // W3: a clock left on a logged set.
        expectFail('W3', () => {
          const { exercise, set } = firstDone();
          const clock = { slotId: exercise.slotId, setIndex: set.setIndex, exerciseName: exercise.exerciseName, plannedMinutes: 20, accumulatedMs: 0, runningSinceMs: world.now };
          editSession((s) => {
            s.minutesClock = clock;
          });
          world.shadow.clock = clock;
          checkLive('broken');
        });
        // W4: a warm-up saved as a working set (the adapter's output as saveCompletedWorkoutSession would get it).
        expectFail('W4', () => {
          editSession((s) => {
            const e = s.exercises.find((x) => (x.warmups ?? []).length > 0);
            const pending = e.sets.find((x) => x.status === 'pending') ?? e.sets[0];
            pending.status = 'completed';
            pending.actualReps = 5;
            pending.actualLoadKg = 20.1;
          });
          // the shadow does not know it: what is saved is more than what was logged
          checkSave(world.state, world.shadow, 'broken', world.now);
        });
        // W4: a session whose logged set the save drops.
        expectFail('W4', () => {
          const shadow = { work: new Map(world.shadow.work), warm: new Map(world.shadow.warm) };
          shadow.work.set('ghost|0', { reps: 7, kg: 50, lift: 'Ghost Lift' });
          checkSave(world.state, shadow, 'broken', world.now);
        });
        // W5: a reload that loses a field.
        expectFail('W5', () => {
          const real = persistence.normalizeWorkoutBundle;
          persistence.normalizeWorkoutBundle = (input) => {
            const out = real(input);
            out.activeSession.exercises.forEach((e) => {
              e.warmups = undefined;
            });
            return out;
          };
          try {
            roundTrip('broken');
          } finally {
            persistence.normalizeWorkoutBundle = real;
          }
        });
        // W6: the stored row after a finish lacks a working set the reader has.
        expectFail('W6', () => {
          const adapted = adaptCompletedWorkoutSessionForAppDatabase(session(), world.now);
          world.db = persistCompletedWorkoutSessionToDatabase(world.db, adapted).database;
          world.db = {
            ...world.db,
            exerciseLogs: world.db.exerciseLogs.map((log) => ({ ...log, sets: log.sets.filter((set) => set.kind === 'warmup') })),
          };
          checkStoredRow(adapted.sessionId, world.shadow, 'broken');
        });
        // W4-progression: a working set opened on a warm-up's load.
        expectFail('W4-progression', () => {
          editSession((s) => {
            s.exercises[0].sets[0].plannedLoadKg = 40.1;
          });
          checkNoWarmupLeak('broken');
        });
      });
      world = null;
    },
  },
];

/** For a repro script: run one sequence and look at what it left (not iterated by the runner). */
module.exports.internals = {
  runSequence: (events) => withClock(() => runSequence(events)),
  world: () => world,
  describe,
};
