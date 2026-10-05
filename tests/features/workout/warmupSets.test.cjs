const assert = require('node:assert/strict');

require('../../helpers/reactNativeStub.cjs').installReactNativeStub();

const { workoutReducer, workoutInitialState, completeWorkoutSession } = require('../../../.test-dist/features/workout/workoutState');
const { buildExerciseLogDraftsFromWorkoutSession } = require('../../../.test-dist/features/workout/workoutAppAdapter');
const { normalizeWorkoutBundle } = require('../../../.test-dist/features/workout/workoutPersistence');
const { normalizeExerciseLog, getComparableLogSets } = require('../../../.test-dist/lib/exerciseLog');
const { warmupOffer } = require('../../../.test-dist/lib/warmupSets');

/**
 * "+ Warm-up set" (user, 2026-10-05): a warm-up is logged apart from the
 * working sets — the programme's count, the guided steps and progression never
 * see it — saved as kind 'warmup', and offered again next time at its own load.
 */

const SLOT = 'primary_bench_1';
/** The live session scopes a slot by template and day; history is filed under it. */
const LIVE = 'tpl:push_a:primary_bench_1';

function started(history = { sessions: [], lastSelectedTemplateId: null, slotHistory: {} }) {
  return workoutReducer(
    { ...workoutInitialState, history },
    {
      type: 'session/startFromRuntimeTemplate',
      payload: {
        template: {
          id: 'tpl',
          name: 'Push',
          defaultScheduleMode: 'weekday',
          sessions: [
            {
              id: 'push_a',
              name: 'Push A',
              orderIndex: 1,
              exercises: [
                {
                  id: 'ex_bench',
                  exerciseName: 'Bench Press',
                  slotId: SLOT,
                  role: 'primary',
                  progressionPriority: 'high',
                  trackingMode: 'load_and_reps',
                  sets: 2,
                  repsMin: 8,
                  repsMax: 8,
                  restSecondsMin: 120,
                  restSecondsMax: 150,
                  substitutionGroup: 'horizontal_press',
                },
              ],
            },
          ],
        },
        sessionOrderIndex: 1,
        unitPreference: 'kg',
        progression: { automatedProgressionEnabled: true, setupLevel: 'beginner' },
      },
    },
  );
}

const warm = (state, loadKg, reps) =>
  workoutReducer(state, { type: 'exercise/logWarmup', payload: { slotId: LIVE, loadKg, reps, completedAt: '2026-10-05T10:00:00.000Z' } });

function logSet(state, setIndex, load, reps) {
  const drafted = workoutReducer(state, {
    type: 'set/updateDraft',
    payload: { slotId: LIVE, setIndex, patch: { loadText: String(load), repsText: String(reps) } },
  });
  return workoutReducer(drafted, { type: 'set/complete', payload: { slotId: LIVE, setIndex, nowMs: Date.now(), unitPreference: 'kg' } });
}

const bench = (state) => state.activeSession.exercises[0];

module.exports = [
  {
    name: 'warm-up: logged apart from the working sets — the count, the sets and their numbers are untouched',
    run() {
      let state = started();
      state = warm(state, 40, 10);
      state = warm(state, 50, 5);
      assert.deepEqual(bench(state).warmups.map((w) => [w.loadKg, w.reps]), [[40, 10], [50, 5]]);
      assert.equal(bench(state).sets.length, 2);
      assert.deepEqual(bench(state).sets.map((set) => [set.setIndex, set.status]), [[0, 'pending'], [1, 'pending']]);

      // Taken back by position; the last one gone leaves no list.
      state = workoutReducer(state, { type: 'exercise/removeWarmup', payload: { slotId: LIVE, index: 0 } });
      assert.deepEqual(bench(state).warmups.map((w) => w.loadKg), [50]);
      state = workoutReducer(state, { type: 'exercise/removeWarmup', payload: { slotId: LIVE, index: 0 } });
      assert.equal(bench(state).warmups, undefined);
    },
  },
  {
    name: 'warm-up: a weight nobody lifts, broken reps, an unknown lift or a closed session are refused',
    run() {
      const state = started();
      for (const [load, reps] of [[-5, 10], [601, 10], [Number.NaN, 10], [40, 0], [40, 2.5], [40, 101]]) {
        assert.equal(warm(state, load, reps), state, `${load} x ${reps}`);
      }
      assert.equal(
        workoutReducer(state, { type: 'exercise/logWarmup', payload: { slotId: 'nope', loadKg: 40, reps: 10, completedAt: 'x' } }),
        state,
      );
      assert.equal(workoutReducer(state, { type: 'exercise/removeWarmup', payload: { slotId: LIVE, index: 0 } }), state);
      const done = completeWorkoutSession(logSet(logSet(state, 0, 60, 8), 1, 60, 8), '2026-10-05T11:00:00.000Z');
      assert.equal(warm(done, 40, 10), done, 'a finished session takes no warm-up');
    },
  },
  {
    name: 'warm-up: the finish files it beside the work, never in it — and the log saves it as kind warmup, out of the totals',
    run() {
      let state = warm(started(), 40, 10);
      state = logSet(logSet(state, 0, 60, 8), 1, 60, 8);
      const session = state.activeSession;
      const done = completeWorkoutSession(state, '2026-10-05T11:00:00.000Z');
      const [entry] = done.history.slotHistory[LIVE];
      assert.deepEqual(entry.sets.map((set) => [set.setIndex, set.loadKg]), [[0, 60], [1, 60]]);
      assert.deepEqual(entry.warmups, [{ loadKg: 40, reps: 10 }]);

      const [draft] = buildExerciseLogDraftsFromWorkoutSession(session);
      assert.deepEqual(draft.sets.map((set) => [set.orderIndex, set.kind, set.weight]), [[-1, 'warmup', 40], [0, 'working', 60], [1, 'working', 60]]);
      const log = normalizeExerciseLog({ id: 'l', sessionId: 's', exerciseTemplateId: 'e', exerciseNameSnapshot: 'Bench Press', tracked: true, orderIndex: 0, ...draft });
      assert.deepEqual(getComparableLogSets(log).map((set) => set.weight), [60, 60], 'volume, counts and records read the work only');
      assert.equal(log.sets.find((set) => set.kind === 'warmup').weight, 40, 'the warm-up survives the loader');
    },
  },
  {
    name: 'warm-up: next time the working sets read the work, and the button offers last time’s warm-up as it was',
    run() {
      let state = warm(started(), 40, 10);
      state = logSet(logSet(state, 0, 60, 8), 1, 60, 8);
      const done = completeWorkoutSession(state, new Date(Date.now() - 86_400_000).toISOString());
      const next = started(done.history);
      assert.deepEqual(bench(next).sets.map((set) => set.plannedLoadKg), [60, 60], 'set 1 opens on the work, not on the 40');
      assert.equal(bench(next).warmups, undefined, 'a new session starts with none logged');

      const last = done.history.slotHistory[LIVE][0].warmups;
      assert.deepEqual(warmupOffer(last, 0, 62.5), { loadKg: 40, reps: 10 }, 'never progressed');
      assert.deepEqual(warmupOffer(last, 1, 60), { loadKg: 42.5, reps: 6 }, 'past last time’s: the ladder');
      assert.deepEqual(warmupOffer(undefined, 0, 100), { loadKg: 50, reps: 10 });
      assert.deepEqual(warmupOffer(undefined, 2, 100), { loadKg: 85, reps: 3 });
      assert.deepEqual(warmupOffer(undefined, 5, 100), { loadKg: 85, reps: 3 });
      assert.deepEqual(warmupOffer(undefined, 0, null), { loadKg: null, reps: 10 });
    },
  },
  {
    name: 'warm-up: the loader keeps a clean list and drops a broken one, live and in "last time"',
    run() {
      let state = warm(started(), 40, 10);
      const bundle = normalizeWorkoutBundle({
        activeSession: {
          ...state.activeSession,
          exercises: [{ ...bench(state), warmups: [{ loadKg: 40, reps: 10, completedAt: 'x' }, null, { loadKg: 'a', reps: 3 }, { loadKg: 30, reps: 1.5, completedAt: 'y' }] }],
        },
        history: {
          sessions: [],
          lastSelectedTemplateId: null,
          slotHistory: {
            [SLOT]: [
              { slotId: SLOT, sets: [{ setIndex: 0, loadKg: 60, reps: 8 }], warmups: [{ loadKg: 40, reps: 10 }, { loadKg: 9999, reps: 1 }] },
              { slotId: SLOT, sets: [{ setIndex: 0, loadKg: 60, reps: 8 }], warmups: 'junk' },
            ],
          },
        },
        activeCardio: null,
      });
      assert.deepEqual(bundle.activeSession.exercises[0].warmups, [{ loadKg: 40, reps: 10, completedAt: 'x' }]);
      assert.deepEqual(bundle.history.slotHistory[SLOT][0].warmups, [{ loadKg: 40, reps: 10 }]);
      assert.equal('warmups' in bundle.history.slotHistory[SLOT][1], false);
    },
  },
  {
    name: 'warm-up: the set screen offers it before the first working set of a loaded lift only, and logs it as a warm-up',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs
        .readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'), 'utf8')
        .replace(/\r\n/g, '\n');
      const view = screen.slice(screen.indexOf('function SetStepView('), screen.indexOf('const makeStyles'));
      // Offered: first set, not yet logged, a lift with a load.
      assert.match(view, /const firstSetOpen = step\.setIndex === 0 && exercise\?\.sets\[0\]\?\.status !== 'completed';/);
      assert.match(view, /const canWarmUp = !bodyweight && firstSetOpen;/);
      assert.match(view, /\{canWarmUp && \(warmups\.length > 0 \|\| !inWarmup\) \? \(/);
      // Opened on last time's warm-up or the ladder, never on the working set's numbers.
      assert.match(view, /warmupOffer\(panels\?\.history\?\.warmups, warmups\.length, target\?\.loadKg \?\? null\)/);
      // The blue button logs a warm-up, not the set, and goes back to the set.
      assert.match(view, /onLogWarmup\(kg, reps\);\s*leaveWarmup\(\);/);
      assert.doesNotMatch(view.slice(view.indexOf('{inWarmup ? (\n            <>'), view.indexOf(') : (\n          <Pressable')), /onConfirm\(/);
      // No progression badge speaks about a warm-up.
      assert.match(view, /\{inWarmup \? null : autoDeltaKg !== null && autoDeltaKg !== 0 \? \(/);
      // A new step leaves warm-up mode.
      assert.match(view, /setDial\(null\);\s*setWarmupMode\(false\);/);
      // The player hands both actions to the store.
      assert.match(screen, /onLogWarmup=\{\(loadKg, reps\) => \{\s*void haptics\.select\(\);\s*workout\.logWarmup\(step\.slotId, loadKg, reps\);/);
      assert.match(screen, /onRemoveWarmup=\{\(index\) => workout\.removeWarmup\(step\.slotId, index\)\}/);
    },
  },
];
