process.env.TZ = process.env.TZ || 'Europe/Helsinki';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIST = '../../.test-dist/';
const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').split('\r\n').join('\n');

const { evaluateProgression } = require(DIST + 'lib/progressionGate.js');
const { buildNextSessionAdvice } = require(DIST + 'lib/nextSessionAdvice.js');
const { workoutReducer } = require(DIST + 'features/workout/workoutState.js');
const { adaptCompletedWorkoutSessionForAppDatabase } = require(DIST + 'features/workout/workoutAppAdapter.js');
const { persistCompletedWorkoutSessionToDatabase } = require(DIST + 'state/completedWorkoutPersistence.js');
const { createEmptyDatabase } = require(DIST + 'data/seed.js');
const { applyEquipmentToExercises } = require(DIST + 'lib/equipmentExerciseFilter.js');
const { applySessionAdaptation } = require(DIST + 'lib/sessionAdaptation.js');
const { buildReadySessionRuntimeTemplate } = require(DIST + 'lib/programDetails.js');
const { WORKOUT_TEMPLATES_V1, getWorkoutTemplateById } = require(DIST + 'features/workout/workoutCatalog.js');

// ── a session played through the reducer, saved, and the next one opened ─────

const dayMs = (n) => new Date(2026, 8, 1 + n, 18).getTime();
const freshState = () => ({
  activeSession: null,
  completionSummary: null,
  history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
  nowMs: 0,
});
const progression = (nowMs) => ({ automatedProgressionEnabled: true, setupLevel: 'beginner', nowMs, fatigueSignal: 'normal' });
const startOf = (state, template, nowMs) =>
  workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: { template, sessionOrderIndex: 0, unitPreference: 'kg', progression: progression(nowMs) },
  });

/** One programme day done at the same weight and reps for every set of `slot`; returns the saved world. */
function playDay(world, template, slot, loadKg, reps, when) {
  let state = startOf(world.state, template, when);
  const exercise = state.activeSession.exercises.find((item) => item.templateSlotId === slot);
  for (let index = 0; index < exercise.sets.length; index += 1) {
    const slotId = exercise.slotId;
    state = workoutReducer(state, {
      type: 'set/updateDraft',
      payload: { slotId, setIndex: index, patch: { loadText: String(loadKg), repsText: String(reps) } },
    });
    state = workoutReducer(state, {
      type: 'set/complete',
      payload: { slotId, setIndex: index, nowMs: when, unitPreference: 'kg' },
    });
  }
  state = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: new Date(when).toISOString() } });
  const adapted = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession, when);
  const saved = persistCompletedWorkoutSessionToDatabase(world.db, {
    sessionId: adapted.sessionId,
    workoutTemplateId: adapted.workoutTemplateId,
    workoutTemplateSessionId: adapted.workoutTemplateSessionId,
    workoutNameSnapshot: adapted.workoutNameSnapshot,
    logs: adapted.logs,
    startedAt: adapted.startedAt,
    performedAt: adapted.performedAt,
    durationMinutes: adapted.durationMinutes,
  });
  return {
    state: workoutReducer(state, { type: 'session/clearCompletedSession' }),
    db: saved.database,
    lastSessionId: adapted.sessionId,
  };
}

/** What the logger opens the slot's sets at, the next time the day is started. */
function nextOpening(world, template, slot, when) {
  const state = startOf(world.state, template, when);
  const exercise = state.activeSession.exercises.find((item) => item.templateSlotId === slot);
  return exercise.sets.map((set) => ({ load: set.draftLoadText, from: set.autoProgressedFromKg }));
}

const adviceOf = (world, lookup, liftName) =>
  buildNextSessionAdvice({
    liftName,
    sessionId: world.lastSessionId,
    sessions: world.db.workoutSessions,
    logs: world.db.exerciseLogs,
    lookupTemplate: lookup,
    level: 'beginner',
  });

const loadOf = (text) => Number(String(text).replace(',', '.'));

module.exports = [
  // 1. advice equals what the next workout opens at
  {
    name: 'advice for a lift the equipment filter swapped in (a saved composed programme) equals what the logger opens next',
    run() {
      const bench = {
        id: 'e_bench',
        exerciseName: 'Bench Press',
        slotId: 'bench',
        role: 'primary',
        progressionPriority: 'high',
        trackingMode: 'load_and_reps',
        sets: 3,
        repsMin: 8,
        repsMax: 8,
        restSecondsMin: 90,
        restSecondsMax: 120,
        substitutionGroup: 'press',
      };
      const adjusted = applyEquipmentToExercises([bench], ['Dumbbells', 'Bench']);
      const swappedIn = adjusted.exercises[0];
      assert.notEqual(swappedIn.exerciseName, 'Bench Press', 'the filter swapped the lift');
      // Onboarding saves the composed week as the reader's own programme: the rows carry the swapped names.
      const template = {
        id: 'composed',
        name: 'Composed',
        defaultScheduleMode: 'rolling_sequence',
        sessions: [{ id: 'day', name: 'Push', orderIndex: 0, exercises: adjusted.exercises }],
      };
      let world = { state: freshState(), db: createEmptyDatabase('en') };
      for (const n of [0, 7, 14]) {
        world = playDay(world, template, 'bench', 30, swappedIn.repsMax, dayMs(n));
      }
      const advice = adviceOf(world, () => template, swappedIn.exerciseName);
      assert.equal(advice.kind, 'raise');
      const opening = nextOpening(world, template, 'bench', dayMs(21));
      assert.ok(opening.length > 0);
      for (const set of opening) {
        assert.equal(loadOf(set.load), advice.toKg);
        assert.equal(set.from, advice.fromKg);
      }
    },
  },
  {
    name: 'advice for a lift swapped into a ready programme slot for today is none, as the next ordinary opening of the slot is',
    run() {
      // A ready programme starts from the catalogue's rows; today's swap is the only way a lift other than the
      // catalogue's is in the slot (sessionAdaptation names equipment substitution as not its business), and it
      // is spent at the start. The swapped-in lift's history is not the programme lift's, so the next opening
      // of the slot raises nothing, and the advice must say the same.
      let picked = null;
      for (const candidate of WORKOUT_TEMPLATES_V1) {
        const day = candidate.sessions[0];
        const row = day.exercises.find((item) => item.trackingMode === 'load_and_reps' && item.sets >= 3 && item.repsMax <= 12);
        if (row) {
          picked = { template: candidate, day, row };
          break;
        }
      }
      assert.ok(picked, 'the catalogue has a loaded row to swap');
      const { template, day, row } = picked;
      const swapTo = row.exerciseName === 'Dumbbell Bench Press' ? 'Leg Press' : 'Dumbbell Bench Press';
      const adaptation = { swaps: { [row.slotId]: swapTo }, drops: [] };
      const runtime = (adapt) => applySessionAdaptation(buildReadySessionRuntimeTemplate(template, day.id), adapt);
      let world = { state: freshState(), db: createEmptyDatabase('en') };
      for (const n of [0, 7, 14]) {
        world = playDay(world, runtime(adaptation), row.slotId, 40, row.repsMax, dayMs(n));
      }
      const lookup = (id) => getWorkoutTemplateById(id);
      const logged = world.db.exerciseLogs.find((log) => log.sessionId === world.lastSessionId);
      assert.equal(logged.exerciseNameSnapshot, swapTo);
      assert.equal(logged.swappedFrom, row.exerciseName, 'the log records the swap');
      assert.equal(adviceOf(world, lookup, swapTo).kind, 'none');
      assert.equal(adviceOf(world, lookup, row.exerciseName).kind, 'none');
      const opening = nextOpening(world, runtime(null), row.slotId, dayMs(21));
      for (const set of opening) {
        assert.equal(set.from, undefined, 'the logger raises nothing off the swapped-in lift');
      }
    },
  },

  // 4. the advice's own history cut ranks an unparseable date last
  {
    name: 'advice keeps the newest sessions when a stored date does not parse, whatever order the logs are in',
    run() {
      // Twelve real sessions and one with a date that is not one, the logs in a scrambled order. A NaN in the
      // sort's comparison is no order, and the cut to ten dropped the newest session among the rest.
      const order = [6, 3, 1, 0, -1, 11, 2, 9, 5, 4, 10, 7, 8];
      const sessions = [];
      const logs = [];
      order.forEach((day, index) => {
        const id = `s${index}`;
        sessions.push({
          id,
          workoutTemplateId: 'tpl',
          workoutTemplateSessionId: 'day',
          workoutNameSnapshot: 'Push',
          performedAt: day < 0 ? 'not a date' : new Date(2026, 8, 1 + day, 18).toISOString(),
        });
        // The newest session fell short of last time's reps; every other one hit the ceiling.
        const reps = day === 11 ? [5, 5, 5] : [8, 8, 8];
        logs.push({
          id: `l${index}`,
          sessionId: id,
          exerciseTemplateId: null,
          exerciseNameSnapshot: 'Bench Press',
          weight: 60,
          repsPerSet: reps,
          tracked: true,
          orderIndex: 0,
          templateSlotId: 'bench',
        });
      });
      const template = {
        sessions: [
          {
            id: 'day',
            exercises: [{ exerciseName: 'Bench Press', slotId: 'bench', sets: 3, repsMin: 8, repsMax: 8, trackingMode: 'load_and_reps' }],
          },
        ],
      };
      const newest = sessions[order.indexOf(11)];
      const advice = buildNextSessionAdvice({
        liftName: 'Bench Press',
        sessionId: newest.id,
        sessions,
        logs,
        lookupTemplate: () => template,
        level: 'beginner',
      });
      assert.deepEqual(advice, { kind: 'rebuild_reps', kg: 60 });
    },
  },

  // 5. the gate ranks an unparseable date below a future one
  {
    name: 'the gate ranks an entry with an unreadable date below one dated in the future, and keeps the stored order among equals',
    run() {
      const entry = (iso, load, id) => ({
        slotId: 's',
        templateId: 't',
        templateName: 'T',
        exerciseName: 'Bench Press',
        substitutionGroup: '',
        performedAt: iso,
        sessionId: id,
        skipped: false,
        sets: [8, 8, 8].map((reps, setIndex) => ({ setIndex, loadKg: load, reps, completedAt: iso, effort: null })),
      });
      const nowMs = new Date(2026, 9, 12, 18).getTime();
      const args = { repsMin: 8, repsMax: 8, targetSets: 3, level: 'beginner' };
      const future = entry(new Date(2026, 10, 12, 18).toISOString(), 60, 'future');
      const unreadable = entry('not a date', 50, 'unreadable');
      // The newest entry is the one the load comes from: the future-dated one, in either stored order.
      for (const history of [[unreadable, future], [future, unreadable]]) {
        const decision = evaluateProgression({ ...args, nowMs, history });
        assert.equal(decision.fromLoadKg, 60);
      }
      // Two unreadable dates keep the order they are stored in.
      const other = entry('also not a date', 70, 'other');
      assert.equal(evaluateProgression({ ...args, nowMs, history: [unreadable, other] }).fromLoadKg, 50);
      assert.equal(evaluateProgression({ ...args, nowMs, history: [other, unreadable] }).fromLoadKg, 70);
      // And a real date still beats a future one, which beats an unreadable one.
      const real = entry(new Date(2026, 9, 5, 18).toISOString(), 55, 'real');
      assert.equal(evaluateProgression({ ...args, nowMs, history: [unreadable, future, real] }).fromLoadKg, 55);
    },
  },

  // 7. one answer to a refused programme write
  {
    name: 'a refused programme write is logged, felt and toasted in one helper, which every site uses',
    run() {
      const helperPath = require.resolve(DIST + 'app/planSaveFailure.js');
      const hapticsPath = require.resolve(DIST + 'utils/haptics.js');
      const calls = [];
      const realError = console.error;
      require.cache[hapticsPath] = {
        id: hapticsPath,
        filename: hapticsPath,
        loaded: true,
        exports: { haptics: { error: () => calls.push('haptics') } },
      };
      delete require.cache[helperPath];
      try {
        console.error = (...args) => calls.push(['log', ...args]);
        const { reportPlanSaveFailed } = require(helperPath);
        const boom = new Error('refused');
        reportPlanSaveFailed('Failed to save a thing', boom, 'en', (message) => calls.push(['toast', message]));
        assert.deepEqual(calls, [['log', 'Failed to save a thing', boom], 'haptics', ['toast', 'Could not save your programme']]);
        calls.length = 0;
        reportPlanSaveFailed('Failed to save a thing', boom, 'fi', (message) => calls.push(['toast', message]));
        assert.equal(calls[2][1], 'Ohjelmaasi ei voitu tallentaa');
      } finally {
        console.error = realError;
        delete require.cache[helperPath];
        delete require.cache[hapticsPath];
      }
      // No site writes the three lines out itself any more, and each of the fifteen that did calls the helper.
      const sites = [
        'App.tsx',
        'src/app/programmeDayEdits.tsx',
        'src/app/programmePlanEdits.tsx',
        'src/app/programmeSwitches.tsx',
        'src/app/renderWorkoutTab.tsx',
        'src/app/useProgramExerciseEdit.tsx',
      ];
      let calling = 0;
      for (const file of sites) {
        const source = read(...file.split('/'));
        assert.doesNotMatch(source, /console\.error\('[^']+', error\);\s*void haptics\.error\(\);\s*showToast\(t\(preferences\.appLanguage, 'toast\.planSaveFailed'\)\)/, file);
        calling += source.match(/reportPlanSaveFailed\('[^']+', error, preferences\.appLanguage, showToast\);/g)?.length ?? 0;
      }
      assert.equal(calling, 15);
    },
  },
];
