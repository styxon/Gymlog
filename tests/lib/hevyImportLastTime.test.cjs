const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { workoutReducer, workoutInitialState } = require('../../.test-dist/features/workout/workoutState');
const { hevySessionId, hevyWorkoutsToLoggedSessions, parseHevyCsv } = require('../../.test-dist/lib/hevyImport');
const { persistCompletedWorkoutSessionsToDatabase } = require('../../.test-dist/state/completedWorkoutPersistence');
const { createEmptyDatabase } = require('../../.test-dist/data/seed');
const { resolveLastTimeEntry } = require('../../.test-dist/lib/exerciseHistoryLookup');

/**
 * An imported Hevy history is the lift's real last time.
 *
 * The import wrote the database only. The weight a set opens on and the
 * "Last time" card read the workout store's slot history, so a reader who
 * brought years of Hevy sessions in opened every lift at nothing, under a
 * Progress page showing that same history (hunt, 2026-10-09).
 */

const ROOT = path.join(__dirname, '..', '..');
const HEADER =
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';

function rows(day, sets) {
  return sets.map(
    ([type, weight, reps], index) =>
      `"Push","${day}, 08:15","${day}, 09:05",,"Bench Press",,,${index},${type},${weight},${reps},,,`,
  );
}

const CSV = [
  HEADER,
  ...rows('20 Sep 2024', [['warmup', 40, 10], ['normal', 100, 5], ['normal', 100, 5]]),
  ...rows('27 Sep 2024', [['warmup', 40, 10], ['normal', 102.5, 5], ['normal', 102.5, 5]]),
].join('\n');

/** The input AppProvider.importWorkoutHistory builds, enough of it to persist. */
function inputsOf(workouts) {
  return workouts.map((workout) => ({
    sessionId: hevySessionId(workout),
    workoutTemplateId: 'hevy_import',
    workoutTemplateSessionId: null,
    workoutNameSnapshot: workout.name,
    startedAt: workout.startedAt,
    performedAt: workout.endedAt ?? workout.startedAt,
    logs: workout.exercises.map((exercise, orderIndex) => ({
      exerciseTemplateId: null,
      exerciseNameSnapshot: exercise.name,
      weight: Math.max(0, ...exercise.sets.map((set) => set.weightKg)),
      repsPerSet: exercise.sets.map((set) => set.reps),
      sets: exercise.sets.map((set, setIndex) => ({
        orderIndex: setIndex,
        weight: set.weightKg,
        reps: set.reps,
        kind: set.kind,
        outcome: 'completed',
        status: 'completed',
      })),
      tracked: true,
      orderIndex,
    })),
  }));
}

const TEMPLATE = {
  id: 'tpl_push',
  name: 'Push',
  defaultScheduleMode: 'weekly',
  sessions: [
    {
      id: 'day',
      name: 'Push',
      orderIndex: 0,
      exercises: [
        {
          id: 'e1',
          exerciseName: 'Bench Press',
          slotId: 'press',
          role: 'primary',
          progressionPriority: 'high',
          trackingMode: 'load_and_reps',
          sets: 2,
          repsMin: 4,
          repsMax: 6,
          restSecondsMin: 90,
          restSecondsMax: 120,
          substitutionGroup: 'press',
        },
      ],
    },
  ],
};

function start(history) {
  return workoutReducer(
    { ...workoutInitialState, hydrated: true, history },
    {
      type: 'session/startFromRuntimeTemplate',
      payload: { template: TEMPLATE, sessionOrderIndex: 0, unitPreference: 'kg', progression: { automatedProgressionEnabled: false } },
    },
  );
}

function imported() {
  const { workouts } = parseHevyCsv(CSV);
  const result = persistCompletedWorkoutSessionsToDatabase(createEmptyDatabase('en'), inputsOf(workouts));
  return { workouts, result };
}

const EMPTY_HISTORY = { sessions: [], slotHistory: {}, lastSelectedTemplateId: null };

module.exports = [
  {
    name: 'hevy import: the database reports every session it holds, written now or already there',
    run() {
      const { workouts, result } = imported();
      assert.equal(result.imported, 2);
      assert.deepEqual(result.sessionIds, workouts.map(hevySessionId));
      const again = persistCompletedWorkoutSessionsToDatabase(result.database, inputsOf(workouts));
      assert.equal(again.imported, 0);
      assert.deepEqual(again.sessionIds, workouts.map(hevySessionId), 'a duplicate is still a session the database holds');
    },
  },
  {
    name: 'hevy import: the imported sessions become the lift\'s last time and its prefill, warm-ups left out',
    run() {
      const { workouts, result } = imported();
      const sessions = hevyWorkoutsToLoggedSessions(workouts, new Set(result.sessionIds));
      assert.deepEqual(
        sessions.map((session) => session.exercises[0].sets.map((set) => set.loadKg)),
        [[100, 100], [102.5, 102.5]],
        'the work only',
      );

      const state = workoutReducer(
        { ...workoutInitialState, hydrated: true, history: EMPTY_HISTORY },
        { type: 'history/recordLoggedMany', payload: { sessions } },
      );
      const next = start(state.history);
      const bench = next.activeSession.exercises[0];
      assert.deepEqual(bench.sets.map((set) => set.plannedLoadKg), [102.5, 102.5], 'it opens on the newest imported session');
      const lastTime = resolveLastTimeEntry({ slotHistory: state.history.slotHistory, slotId: bench.slotId, exerciseName: 'Bench Press' });
      assert.ok(lastTime, 'and the card has a last time');
      assert.equal(lastTime.entry.sessionId, hevySessionId(workouts[1]), 'under the id History deletes it by');

      // The same file again files nothing twice.
      const twice = workoutReducer(state, { type: 'history/recordLoggedMany', payload: { sessions } });
      assert.equal(twice.history.slotHistory['logged:bench press'].length, 2);
    },
  },
  {
    name: 'hevy import: an older history files behind what the reader has logged since, and only what the database holds',
    run() {
      const { workouts, result } = imported();
      let state = workoutReducer(
        { ...workoutInitialState, hydrated: true, history: EMPTY_HISTORY },
        {
          type: 'history/recordLogged',
          payload: {
            performedAt: '2026-10-01T10:00:00.000Z',
            sessionId: 'freestyle_1',
            templateName: 'Empty workout',
            exercises: [{ exerciseName: 'Bench Press', sets: [{ setIndex: 0, loadKg: 110, reps: 5 }, { setIndex: 1, loadKg: 110, reps: 5 }] }],
          },
        },
      );
      state = workoutReducer(state, {
        type: 'history/recordLoggedMany',
        payload: { sessions: hevyWorkoutsToLoggedSessions(workouts, new Set(result.sessionIds)) },
      });
      assert.deepEqual(
        state.history.slotHistory['logged:bench press'].map((item) => item.sessionId),
        ['freestyle_1', hevySessionId(workouts[1]), hevySessionId(workouts[0])],
        'newest first by date',
      );
      assert.deepEqual(start(state.history).activeSession.exercises[0].sets.map((set) => set.draftLoadText), ['110', '110']);

      assert.deepEqual(hevyWorkoutsToLoggedSessions(workouts, new Set([hevySessionId(workouts[0])])).map((item) => item.sessionId), [
        hevySessionId(workouts[0]),
      ]);
    },
  },
  {
    name: 'hevy import: the import files its sessions in the workout store once the database write resolved',
    run() {
      const shell = fs.readFileSync(path.join(ROOT, 'src', 'app', 'renderAppShell.tsx'), 'utf8');
      const awaited = shell.indexOf('result = await importWorkoutHistory(preview.workouts)');
      // Under the reader's own names too, where they taught the app one.
      const filed = shell.search(
        /recordLoggedWorkouts\(\s*hevyWorkoutsToLoggedSessions\(preview\.workouts, new Set\(result\.sessionIds\), exerciseNameBook\)/,
      );
      assert.ok(awaited > 0 && filed > awaited, 'filed after the awaited write');
      const app = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
      assert.match(app, /recordLoggedWorkouts: workout\.recordLoggedWorkouts/);
      const provider = fs.readFileSync(path.join(ROOT, 'src', 'state', 'AppProvider.tsx'), 'utf8');
      assert.match(provider, /sessionId: hevySessionId\(workout\)/, 'the database and the store key a workout the same way');
    },
  },
  {
    // Hunt 2026-10-09: the filing kept Hevy's titles, and "last time" is found
    // by name, so a real export's "Bench Press (Barbell)" opened the
    // programme's "Bench Press" at nothing. The repo's own Hevy fixtures use
    // these titles; the cases above use the plain name.
    name: 'hevy import: a lift titled with its implement files under the programme\'s name for it',
    run() {
      const csv = [
        HEADER,
        ...rows('20 Sep 2024', [['normal', 100, 5], ['normal', 100, 5]]).map((row) => row.replace('"Bench Press"', '"Bench Press (Barbell)"')),
        ...rows('20 Sep 2024', [['normal', 32, 8], ['normal', 32, 8]]).map((row) => row.replace('"Bench Press"', '"Bench Press (Dumbbell)"')),
      ].join('\n');
      const { workouts } = parseHevyCsv(csv);
      const result = persistCompletedWorkoutSessionsToDatabase(createEmptyDatabase('en'), inputsOf(workouts));
      const sessions = hevyWorkoutsToLoggedSessions(workouts, new Set(result.sessionIds));
      assert.deepEqual(
        sessions[0].exercises.map((exercise) => exercise.exerciseName),
        ['Bench Press', 'Dumbbell Bench Press'],
      );

      const state = workoutReducer(
        { ...workoutInitialState, hydrated: true, history: EMPTY_HISTORY },
        { type: 'history/recordLoggedMany', payload: { sessions } },
      );
      const bench = start(state.history).activeSession.exercises[0];
      assert.deepEqual(bench.sets.map((set) => set.plannedLoadKg), [100, 100], 'the barbell bench, never the dumbbells');
      assert.ok(resolveLastTimeEntry({ slotHistory: state.history.slotHistory, slotId: bench.slotId, exerciseName: 'Bench Press' }));
    },
  },
  {
    // Hunt 2026-10-09: each entry was filed by copying the lift's whole list,
    // quadratic in the sessions per lift. Counted, not timed: the copies are
    // array iterations, and a linear filing does a bounded number per entry.
    name: 'hevy import: filing years of one lift is linear work, and entries of one moment keep their order',
    run() {
      const session = (index, at = Date.UTC(2018, 0, 1) + index * 86400000) => ({
        performedAt: new Date(at).toISOString(),
        sessionId: `hevy_${index}`,
        templateName: 'Push',
        exercises: [{ exerciseName: 'Bench Press', sets: [{ setIndex: 0, loadKg: 60, reps: 5, completedAt: new Date(at).toISOString() }] }],
      });
      const original = Array.prototype[Symbol.iterator];
      const iterations = (count) => {
        const sessions = Array.from({ length: count }, (_, index) => session(index));
        let steps = 0;
        Array.prototype[Symbol.iterator] = function counted() {
          const inner = original.call(this);
          return {
            next() {
              steps += 1;
              return inner.next();
            },
            [Symbol.iterator]() {
              return this;
            },
          };
        };
        try {
          workoutReducer({ ...workoutInitialState, hydrated: true, history: EMPTY_HISTORY }, { type: 'history/recordLoggedMany', payload: { sessions } });
        } finally {
          Array.prototype[Symbol.iterator] = original;
        }
        return steps;
      };
      const small = iterations(500);
      const large = iterations(2000);
      // Four times the sessions: about four times the work when linear,
      // sixteen when every entry copies the list before it.
      assert.ok(large < small * 6, `500 sessions: ${small} steps, 2000: ${large}`);

      // As before: two sessions of the same moment, the one filed last first.
      const at = Date.UTC(2024, 0, 1);
      const state = workoutReducer(
        { ...workoutInitialState, hydrated: true, history: EMPTY_HISTORY },
        { type: 'history/recordLoggedMany', payload: { sessions: [session(1, at), session(2, at), session(3, at - 86400000)] } },
      );
      assert.deepEqual(state.history.slotHistory['logged:bench press'].map((entry) => entry.sessionId), ['hevy_2', 'hevy_1', 'hevy_3']);
    },
  },
];
