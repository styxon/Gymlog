const assert = require('node:assert/strict');

const { workoutReducer, workoutInitialState } = require('../../.test-dist/features/workout/workoutState');
const { normalizeWorkoutBundle } = require('../../.test-dist/features/workout/workoutPersistence');
const {
  capSlotEntries,
  findLatestEntryForExerciseName,
  resolveLastTimeEntry,
  SLOT_HISTORY_LIMIT,
} = require('../../.test-dist/lib/exerciseHistoryLookup');

/**
 * "Last time" — the weight a set opens on and the card that names it — read
 * from the workout store's slot history, and that history lost its real
 * sessions three ways (hunt, 2026-10-09):
 *
 * - a lift still pending at Finish filed an entry with no sets, and ten such
 *   finishes pushed the lift's last real session out of the ten-entry cap;
 * - the loader kept loads nobody could lift, names that were not strings and
 *   dates that were not dates;
 * - a session dated ahead by a wrong phone clock stayed the newest until its
 *   date came round.
 */

const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const DAY = { tpl: 'tpl_hunt', day: 'day_a' };

function lift(slotId, exerciseName) {
  return {
    id: `e_${slotId}`,
    exerciseName,
    slotId,
    role: 'primary',
    progressionPriority: 'high',
    trackingMode: 'load_and_reps',
    sets: 2,
    repsMin: 8,
    repsMax: 12,
    restSecondsMin: 90,
    restSecondsMax: 120,
    substitutionGroup: slotId,
  };
}

const TEMPLATE = {
  id: DAY.tpl,
  name: 'Upper',
  defaultScheduleMode: 'weekly',
  sessions: [
    {
      id: DAY.day,
      name: 'Upper',
      orderIndex: 0,
      exercises: [lift('press', 'Bench Press'), lift('row', 'Barbell Row'), lift('incline', 'Incline Dumbbell Press')],
    },
  ],
};

function start(history, nowMs = NOW) {
  return workoutReducer(
    { ...workoutInitialState, hydrated: true, history },
    {
      type: 'session/startFromRuntimeTemplate',
      payload: {
        template: TEMPLATE,
        sessionOrderIndex: 0,
        unitPreference: 'kg',
        progression: { automatedProgressionEnabled: false, nowMs },
      },
    },
  );
}

function logAll(state, exerciseIndex, loadKg, reps) {
  const exercise = state.activeSession.exercises[exerciseIndex];
  let next = state;
  exercise.sets.forEach((set) => {
    next = workoutReducer(next, {
      type: 'set/updateDraft',
      payload: { slotId: exercise.slotId, setIndex: set.setIndex, patch: { loadText: String(loadKg), repsText: String(reps) } },
    });
    next = workoutReducer(next, {
      type: 'set/complete',
      payload: { slotId: exercise.slotId, setIndex: set.setIndex, nowMs: NOW, unitPreference: 'kg' },
    });
  });
  return next;
}

function finish(state, performedAt) {
  return workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt } }).history;
}

function weekIso(week) {
  return new Date(Date.parse('2026-06-01T10:00:00.000Z') + week * 7 * 86400000).toISOString();
}

function entry(performedAt, loadKg, extra = {}) {
  return {
    slotId: 'tpl_hunt:day_a:press',
    templateId: DAY.tpl,
    templateName: 'Upper',
    exerciseName: 'Bench Press',
    substitutionGroup: 'press',
    performedAt,
    sessionId: `s_${performedAt}`,
    sets: [
      { setIndex: 0, loadKg, reps: 8, completedAt: performedAt },
      { setIndex: 1, loadKg, reps: 8, completedAt: performedAt },
    ],
    skipped: false,
    ...extra,
  };
}

module.exports = [
  {
    name: 'slot history: a lift left pending at Finish files nothing, so ten such finishes keep its last time',
    run() {
      let state = start({ sessions: [], slotHistory: {}, lastSelectedTemplateId: null });
      const inclineSlot = state.activeSession.exercises[2].slotId;
      state = logAll(state, 0, 100, 8);
      state = logAll(state, 1, 80, 8);
      state = logAll(state, 2, 30, 10);
      let history = finish(state, weekIso(0));

      for (let week = 1; week <= SLOT_HISTORY_LIMIT; week += 1) {
        state = start(history);
        state = logAll(state, 0, 100, 8);
        state = logAll(state, 1, 80, 8);
        // The third lift is never reached.
        history = finish(state, weekIso(week));
      }

      const entries = history.slotHistory[inclineSlot];
      assert.equal(entries.length, 1, 'only the session it was done in');
      assert.equal(entries.some((item) => item.sets.length === 0 && !item.skipped), false, 'no empty pending entry');

      const next = start(history);
      const incline = next.activeSession.exercises[2];
      assert.deepEqual(incline.sets.map((set) => set.draftLoadText), ['30', '30'], 'it opens on what it was last done at');
      const lastTime = resolveLastTimeEntry({ slotHistory: history.slotHistory, slotId: inclineSlot, exerciseName: incline.exerciseName });
      assert.ok(lastTime, 'and the card still has a last time');
      assert.equal(lastTime.entry.performedAt, weekIso(0));
    },
  },
  {
    name: 'slot history: ten skips in a row do not cut away the lift\'s last real session',
    run() {
      let state = start({ sessions: [], slotHistory: {}, lastSelectedTemplateId: null });
      const inclineSlot = state.activeSession.exercises[2].slotId;
      state = logAll(state, 0, 100, 8);
      state = logAll(state, 2, 30, 10);
      let history = finish(state, weekIso(0));

      for (let week = 1; week <= SLOT_HISTORY_LIMIT; week += 1) {
        state = start(history);
        state = logAll(state, 0, 100, 8);
        state = workoutReducer(state, { type: 'exercise/skip', payload: { slotId: inclineSlot } });
        history = finish(state, weekIso(week));
      }

      const entries = history.slotHistory[inclineSlot];
      assert.equal(entries.filter((item) => item.skipped).length, SLOT_HISTORY_LIMIT, 'every skip is on record');
      assert.equal(entries.length, SLOT_HISTORY_LIMIT + 1, 'and the real session past the cap');
      const next = start(history);
      assert.deepEqual(next.activeSession.exercises[2].sets.map((set) => set.draftLoadText), ['30', '30']);
    },
  },
  {
    name: 'slot history: the cap keeps each lift\'s newest real session, and only that one past it',
    run() {
      const real = entry('2026-06-01T10:00:00.000Z', 60);
      const skips = Array.from({ length: 12 }, (_, index) =>
        entry(`2026-07-${String(index + 10).padStart(2, '0')}T10:00:00.000Z`, 60, { skipped: true, sets: [] }),
      ).reverse();
      const capped = capSlotEntries([...skips, real]);
      assert.equal(capped.length, SLOT_HISTORY_LIMIT + 1);
      assert.equal(capped[capped.length - 1], real);

      // With real sessions inside the cap, it is a plain cap.
      const reals = Array.from({ length: 12 }, (_, index) => entry(`2026-08-${String(index + 10).padStart(2, '0')}T10:00:00.000Z`, 60 + index)).reverse();
      assert.deepEqual(capSlotEntries(reals), reals.slice(0, SLOT_HISTORY_LIMIT));
    },
  },
  {
    name: 'slot history loader: a load nobody could lift is dropped, so the older real session answers',
    run() {
      const bundle = normalizeWorkoutBundle({
        activeSession: null,
        activeCardio: null,
        history: {
          sessions: [],
          lastSelectedTemplateId: null,
          slotHistory: {
            'tpl_hunt:day_a:press': [
              entry('2026-10-08T10:00:00.000Z', 5122.5),
              entry('2026-10-05T10:00:00.000Z', -40),
              entry('2026-10-01T10:00:00.000Z', 80),
            ],
          },
        },
      });
      const entries = bundle.history.slotHistory['tpl_hunt:day_a:press'];
      assert.deepEqual(entries.map((item) => item.sets.length), [0, 0, 2], 'the impossible sets are gone, the entries kept');
      const next = start(bundle.history);
      assert.deepEqual(next.activeSession.exercises[0].sets.map((set) => set.draftLoadText), ['80', '80']);
      const lastTime = resolveLastTimeEntry({ slotHistory: bundle.history.slotHistory, slotId: 'tpl_hunt:day_a:press', exerciseName: 'Bench Press' });
      assert.equal(lastTime.entry.sets[0].loadKg, 80);
    },
  },
  {
    name: 'slot history loader: an entry whose name is not a string or whose date is not a date is dropped',
    run() {
      const bundle = normalizeWorkoutBundle({
        activeSession: null,
        activeCardio: null,
        history: {
          sessions: [],
          lastSelectedTemplateId: null,
          slotHistory: {
            k: [
              entry('2026-10-08T10:00:00.000Z', 100, { exerciseName: 42 }),
              entry('garbage', 100),
              { ...entry('2026-10-07T10:00:00.000Z', 100), performedAt: undefined },
              entry(1759917600000, 100),
              entry('2026-10-01T10:00:00.000Z', 90),
              { ...entry('2026-09-20T10:00:00.000Z', 85), exerciseName: undefined },
            ],
          },
        },
      });
      const entries = bundle.history.slotHistory.k;
      assert.deepEqual(entries.map((item) => item.performedAt), ['2026-10-01T10:00:00.000Z', '2026-09-20T10:00:00.000Z'], 'a nameless entry is an older install\'s and stays');
      assert.doesNotThrow(() => resolveLastTimeEntry({ slotHistory: bundle.history.slotHistory, slotId: 'k', exerciseName: 'Bench Press' }));
    },
  },
  {
    name: 'last time: a session dated after now ranks below every real one, in the lookup and the prefill',
    run() {
      const slotHistory = {
        'tpl_hunt:day_a:press': [
          entry('2026-10-08T10:00:00.000Z', 100),
          entry('2027-03-01T10:00:00.000Z', 60),
          entry('2026-10-01T10:00:00.000Z', 95),
        ],
      };
      const resolved = resolveLastTimeEntry({ slotHistory, slotId: 'tpl_hunt:day_a:press', exerciseName: 'Bench Press', nowMs: NOW });
      assert.equal(resolved.entry.performedAt, '2026-10-08T10:00:00.000Z');
      const named = findLatestEntryForExerciseName(slotHistory, 'Bench Press', { nowMs: NOW });
      assert.equal(named.performedAt, '2026-10-08T10:00:00.000Z', 'the borrow ranks the same way');
      // Only ahead of NOW: once its date has come, it is the newest again.
      const later = resolveLastTimeEntry({ slotHistory, slotId: 'tpl_hunt:day_a:press', exerciseName: 'Bench Press', nowMs: Date.parse('2027-03-02T00:00:00.000Z') });
      assert.equal(later.entry.performedAt, '2027-03-01T10:00:00.000Z');
      // Nothing else dated: the future one is still an answer rather than none.
      const alone = resolveLastTimeEntry({ slotHistory: { k: [entry('2027-03-01T10:00:00.000Z', 60)] }, slotId: 'k', exerciseName: 'Bench Press', nowMs: NOW });
      assert.equal(alone.entry.sets[0].loadKg, 60);

      const next = start({ sessions: [], slotHistory, lastSelectedTemplateId: null });
      assert.deepEqual(next.activeSession.exercises[0].sets.map((set) => set.draftLoadText), ['100', '100'], 'the set opens on the real last session');
    },
  },
];
