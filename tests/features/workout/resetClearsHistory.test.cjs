const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { workoutReducer, workoutInitialState } = require('../../../.test-dist/features/workout/workoutState.js');

const root = path.join(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * "Reset all data" promises that workouts and sessions are cleared. It cleared
 * the database and then only the completed session of the workout provider,
 * which keeps `history`: every set's weight and reps stayed on the phone, the
 * next session opened on pre-reset loads and "last time" still showed them
 * (found 2026-09-14).
 */
module.exports = [
  {
    name: 'resetClearsHistory: the reset leaves no session, cardio or per-slot history behind',
    run() {
      const lived = {
        ...workoutInitialState,
        hydrated: true,
        isRestoring: false,
        history: {
          sessions: [{ sessionId: 's1', templateId: 't', templateName: 'Upper', performedAt: '2026-09-12T08:00:00.000Z' }],
          slotHistory: {
            't:d1:bench': [{ slotId: 't:d1:bench', exerciseName: 'Bench Press', sets: [{ setIndex: 0, loadKg: 80, reps: 8 }] }],
          },
          lastSelectedTemplateId: 't',
        },
        activeSession: { sessionId: 'live' },
        activeCardio: { activityType: 'run' },
        completionSummary: { sessionId: 's1' },
      };

      const reset = workoutReducer(lived, { type: 'session/resetAll', payload: { nowMs: 1 } });
      assert.deepEqual(reset.history, { sessions: [], slotHistory: {}, lastSelectedTemplateId: null });
      assert.equal(reset.activeSession, null);
      assert.equal(reset.activeCardio, null);
      assert.equal(reset.completionSummary, null);
      // Still hydrated, so the persistence effect writes the empty bundle over the old one.
      assert.equal(reset.hydrated, true);
      assert.equal(reset.isRestoring, false);

      // The old ending kept the history; this is the difference the reset exists for.
      const cleared = workoutReducer(lived, { type: 'session/clearCompletedSession' });
      assert.notDeepEqual(cleared.history, reset.history);
    },
  },
  {
    name: 'resetClearsHistory: Settings resets the workout record, and the provider erases its stored bundle first',
    run() {
      const profile = read('src', 'app', 'renderProfileTab.tsx');
      const at = profile.indexOf('onResetAllData={async () => {');
      assert.ok(at > 0, 'Settings has no reset handler');
      const handler = profile.slice(at, profile.indexOf('}}', at));
      assert.ok(handler.indexOf('await resetAllData()') >= 0, 'the database reset is awaited');
      assert.ok(
        handler.indexOf('await workout.resetWorkoutData()') < handler.indexOf('await resetAllData()'),
        'the workout record is reset, awaited, before the database write that makes the app look reset',
      );
      assert.doesNotMatch(handler, /clearCompletedWorkout\(\)/, 'clearing only the completed session keeps the history');

      const provider = read('src', 'features', 'workout', 'WorkoutProvider.tsx');
      const method = provider.slice(provider.indexOf('async resetWorkoutData() {'));
      assert.ok(method.length > 0 && provider.includes('async resetWorkoutData() {'));
      assert.ok(
        method.indexOf('await clearWorkoutBundle();') >= 0 &&
          method.indexOf('await clearWorkoutBundle();') < method.indexOf("type: 'session/resetAll'"),
        'the stored bundle (and its legacy key) goes before the state resets',
      );
    },
  },
];
