const assert = require('node:assert/strict');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

const DIST = path.join(__dirname, '..', '..', 'src');
const CORRUPT_KEY = '@vinha/workout/corrupt';

/**
 * One bad field in a live session costs the session, not the store.
 *
 * The session was the one part of the workout bundle nobody checked: three
 * string fields and a cast. A ready-programme session missing its lifts, its
 * rest timer or its screen state threw in the loader's slot remap, and the
 * catch around the whole bundle set aside the history, the run and the free
 * workout with it — every lift's "last time" gone over one field of a draft
 * (persistence audit, 2026-09-20; the database had the same hole, #157).
 * These run the real save and load against the in-memory AsyncStorage.
 */

function loadWorkoutStore() {
  const fake = createFakeAsyncStorage();
  const workout = loadAgainstFake(fake, (requireDist) => requireDist('features/workout/workoutPersistence.js'));
  return { fake, workout };
}

const history = {
  sessions: [
    {
      sessionId: 'h1',
      templateId: 'tpl_x',
      templateSessionId: null,
      templateName: 'Upper A',
      performedAt: '2026-09-20T10:00:00.000Z',
      durationMinutes: 50,
      setsCompleted: 12,
      exercisesCompleted: 4,
      exercisesSkipped: 0,
      exercisesSwapped: 0,
      totalVolumeKg: 4000,
    },
  ],
  slotHistory: {
    'tpl_x:upper_a:bench': [
      {
        slotId: 'tpl_x:upper_a:bench',
        templateId: 'tpl_x',
        templateName: 'Upper A',
        exerciseName: 'Bench Press',
        substitutionGroup: 'horizontal_press',
        performedAt: '2026-09-20T10:00:00.000Z',
        sessionId: 'h1',
        sets: [{ setIndex: 0, loadKg: 80, reps: 8, completedAt: '2026-09-20T09:10:00.000Z' }],
        skipped: false,
      },
    ],
  },
  lastSelectedTemplateId: 'tpl_x',
};

const freestyleDraft = {
  exercises: [
    {
      localKey: 'draft_1',
      name: 'Bench Press',
      libraryItemId: null,
      imageUrl: null,
      repMin: 6,
      repMax: 8,
      restSeconds: 120,
      trackedDefault: true,
      sets: [{ localKey: 'set_1', kg: '80', reps: '8', done: true }],
      supersetGroup: null,
      displayName: 'Bench Press',
      initials: 'BP',
      metaLabel: '',
      isBarbell: true,
    },
  ],
  startedAtMs: 1_758_000_000_000,
  rest: null,
  savedAtMs: 1_758_000_600_000,
};

function readySession() {
  const { WORKOUT_TEMPLATES_V1 } = require(path.join(DIST, 'features', 'workout', 'workoutCatalog.js'));
  const { materializeWorkoutSession } = require(path.join(DIST, 'features', 'workout', 'workoutState.js'));
  const session = materializeWorkoutSession(WORKOUT_TEMPLATES_V1[0].id, {
    unitPreference: 'kg',
    history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
    sessionOrderIndex: 0,
  });
  return JSON.parse(JSON.stringify(session));
}

function without(object, key) {
  const { [key]: _dropped, ...rest } = object;
  return rest;
}

/** What the disk holds: a round trip through JSON, which is how the store sees it. */
const onDisk = (value) => JSON.parse(JSON.stringify(value));

module.exports = [
  {
    // Break round, 2026-09-28: the map was checked and cast whole, and a slot
    // holding a string reached entriesForLift's .filter on every session start.
    name: 'workout loader: a "last time" slot that is not a list, or an entry without sets, is dropped and the rest kept',
    async run() {
      const { workout } = loadWorkoutStore();
      const good = history.slotHistory['tpl_x:upper_a:bench'][0];
      const junk = {
        ...history,
        slotHistory: {
          'tpl_x:upper_a:bench': [good, null, 'x', { ...good, sets: 'three' }],
          'tpl_x:upper_a:row': 'not a list',
          'tpl_x:upper_a:squat': { sets: [] },
          'tpl_x:upper_a:dip': 7,
        },
      };
      const back = workout.normalizeWorkoutBundle(onDisk({ activeSession: null, history: junk, activeCardio: null, freestyleDraft: null }));
      assert.deepEqual(Object.keys(back.history.slotHistory), ['tpl_x:upper_a:bench']);
      assert.deepEqual(onDisk(back.history.slotHistory['tpl_x:upper_a:bench']), [good]);

      const { entriesForLift } = require(path.join(DIST, 'lib', 'exerciseHistoryLookup.js'));
      assert.deepEqual(entriesForLift('not a list', 'Bench Press'), []);
      assert.deepEqual(entriesForLift({ sets: [] }, 'Bench Press'), []);

      // Recheck of #221: a sets list holding null, or a set without its
      // numbers, passed the entry check and crashed the lookup inside it.
      const goodSet = good.sets[0];
      const withJunkSets = workout.normalizeWorkoutBundle(
        onDisk({
          activeSession: null,
          history: {
            ...history,
            slotHistory: {
              'tpl_x:upper_a:bench': [{ ...good, sets: [null, goodSet, { setIndex: 1, reps: 'eight' }, { loadKg: 80 }, 5] }],
            },
          },
          activeCardio: null,
          freestyleDraft: null,
        }),
      );
      assert.deepEqual(onDisk(withJunkSets.history.slotHistory['tpl_x:upper_a:bench'][0].sets), [goodSet]);
    },
  },
  {
    name: 'workout loader: a live session missing a part is repaired or dropped, and the history survives it',
    async run() {
      const ready = readySession();
      assert.ok(ready.exercises.length > 0, 'the catalog template materialized no lifts');

      // A whole session is not touched by the repair.
      {
        const { workout } = loadWorkoutStore();
        await workout.saveWorkoutBundle({ activeSession: ready, history, activeCardio: null, freestyleDraft });
        const back = await workout.loadWorkoutBundle();
        assert.deepEqual(onDisk(back.activeSession), ready, 'a whole session came back changed');
      }

      const cases = [
        ['no lifts', without(ready, 'exercises'), 'dropped'],
        ['lifts that are not a list', { ...ready, exercises: 'bench' }, 'dropped'],
        ['a custom programme with no lifts', { ...without(ready, 'exercises'), templateId: 'workout_custom' }, 'dropped'],
        // A list with no lift left in it is no session: kept, Home offered to
        // resume an empty workout (CI review of #167).
        ['lifts that are all junk', { ...ready, exercises: [null, null] }, 'dropped'],
        ['lifts that all lost their sets', { ...ready, exercises: ready.exercises.map((exercise) => without(exercise, 'sets')) }, 'dropped'],
        ['an empty list of lifts', { ...ready, exercises: [] }, 'dropped'],
        ['no rest timer', without(ready, 'restTimer'), 'kept'],
        ['no screen state', without(ready, 'ui'), 'kept'],
        ['a screen state without its open slots', { ...ready, ui: { ...ready.ui, expandedSlotIds: null } }, 'kept'],
        ['a lift that is null', { ...ready, exercises: [null, ...ready.exercises] }, 'kept'],
        ['a lift without its sets', { ...ready, exercises: [{ slotId: 'x' }, ...ready.exercises] }, 'kept'],
      ];

      for (const [label, activeSession, expected] of cases) {
        const { fake, workout } = loadWorkoutStore();
        await workout.saveWorkoutBundle({ activeSession, history, activeCardio: null, freestyleDraft });
        let thrown = null;
        try {
          workout.normalizeWorkoutBundle(onDisk({ activeSession, history, freestyleDraft }));
        } catch (error) {
          thrown = error;
        }
        assert.equal(thrown, null, `${label}: the normalizer threw`);

        const back = await workout.loadWorkoutBundle();
        assert.equal(fake.rows.has(CORRUPT_KEY), false, `${label}: the whole store was set aside`);
        assert.deepEqual(back.history, history, `${label}: the history went with the session`);
        assert.equal(back.freestyleDraft?.exercises.length, 1, `${label}: the free workout went with the session`);

        if (expected === 'dropped') {
          assert.equal(back.activeSession, null, `${label}: a session with nothing to resume was kept`);
          continue;
        }
        const session = back.activeSession;
        assert.ok(session, `${label}: a repairable session was dropped`);
        assert.equal(session.sessionId, ready.sessionId);
        assert.deepEqual(
          session.exercises.map((exercise) => exercise.slotId),
          ready.exercises.map((exercise) => exercise.slotId),
          `${label}: the lifts changed`,
        );
        assert.equal(typeof session.restTimer, 'object');
        assert.ok(Array.isArray(session.ui.expandedSlotIds), `${label}: the open slots are not a list`);
      }

      // What a missing part is repaired to: where a new session starts.
      const { workout } = loadWorkoutStore();
      const repaired = workout.normalizeWorkoutBundle(onDisk({ activeSession: without(without(ready, 'restTimer'), 'ui'), history })).activeSession;
      assert.equal(repaired.restTimer.status, 'idle');
      assert.equal(repaired.restTimer.exerciseSlotId, null);
      assert.equal(repaired.ui.activeSlotId, ready.exercises[0].slotId, 'a fresh screen starts on the first lift, as a new session does');
      assert.deepEqual(repaired.ui.expandedSlotIds, []);
    },
  },
];
