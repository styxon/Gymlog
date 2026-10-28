const assert = require('node:assert/strict');

const {
  workoutReducer,
  resolveInstanceBorrowRepWindow,
} = require('../../../src/features/workout/workoutState');
const { resolveLastTimeEntry } = require('../../../src/lib/exerciseHistoryLookup');
const { isUnloadedTrackingMode } = require('../../../src/features/workout/workoutTypes');
const { resolveGuidedSetTarget } = require('../../../src/lib/guidedPlayer');

/**
 * Two days of one programme doing the same lift, differently.
 *
 * #bugs 2026-08-29, two reports seven minutes apart that turned out to be one
 * bug seen from two sides:
 *
 *   "2 eri päivää tekee samaa liikettä, toinen avg 8 toistoo isot painot,
 *    toinen 15-20 toistoo pienet painot, nyt automaattisesti laitetaan 10 kg
 *    joka on se maksimivoimatreeni"
 *
 *   "Alla näkyy viimeksi tehty 27.8 mutta ei näy ylhäällä olevassa taulukossa
 *    mitään"
 *
 * The prefill borrowed the heavy day's weight by exercise name, ignoring the
 * prescription; the "Last time" table read the slot key only and so showed
 * nothing at all. One screen, two answers, both wrong in a different way.
 */

const EMPTY = {
  activeSession: null,
  completionSummary: null,
  history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
  nowMs: 0,
};

const HEAVY_DAY_AT = '2026-08-27T09:00:00.000Z';

function exercise(repsMin, repsMax) {
  return {
    id: 'e_lat',
    exerciseName: 'Dumbbell Lateral Raise',
    slotId: 'lat_raise',
    role: 'primary',
    progressionPriority: 'high',
    trackingMode: 'load_and_reps',
    sets: 3,
    repsMin,
    repsMax,
    restSecondsMin: 90,
    restSecondsMax: 120,
    substitutionGroup: 'lateral_raise',
  };
}

/** What App.tsx hands the reducer: one runtime template holding one day. */
function runtimeTemplate(sessionId, name, repsMin, repsMax) {
  return {
    id: 'tpl_split',
    name: 'Two days, one lift',
    defaultScheduleMode: 'weekly',
    sessions: [{ id: sessionId, name, orderIndex: 0, exercises: [exercise(repsMin, repsMax)] }],
  };
}

function startDay(state, sessionId, name, repsMin, repsMax, orderIndex) {
  return workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: {
      template: runtimeTemplate(sessionId, name, repsMin, repsMax),
      sessionOrderIndex: orderIndex,
      unitPreference: 'kg',
    },
  });
}

/** The heavy day, logged: 3 × 8 at 10 kg on 27.8. */
function afterHeavyDay() {
  let state = startDay(EMPTY, 'day_a', 'Heavy day', 6, 8, 0);
  const slotId = state.activeSession.exercises[0].slotId;
  for (let index = 0; index < 3; index += 1) {
    state = logSet(state, slotId, index, '10', '8', HEAVY_DAY_AT);
  }
  state = workoutReducer(state, {
    type: 'session/finishWorkout',
    payload: { performedAt: HEAVY_DAY_AT },
  });
  return workoutReducer(state, { type: 'session/clearCompletedSession' });
}

/** What `confirmSet` dispatches: the dial's numbers, then the completion. */
function logSet(state, slotId, setIndex, loadText, repsText, atIso) {
  const drafted = workoutReducer(state, {
    type: 'set/updateDraft',
    payload: { slotId, setIndex, patch: { loadText, repsText } },
  });
  return workoutReducer(drafted, {
    type: 'set/complete',
    payload: { slotId, setIndex, nowMs: Date.parse(atIso), unitPreference: 'kg' },
  });
}

/** Exactly what the set screen's dial opens on, same inputs. */
function openingTarget(state, setIndex) {
  const instance = state.activeSession.exercises[0];
  return resolveGuidedSetTarget(instance.sets, setIndex, instance.trackingMode, instance.swappedAfterSetIndex);
}

/** Exactly what the set screen's "Last time" panel resolves, same inputs. */
function panelLastTime(state, instance) {
  return resolveLastTimeEntry({
    slotHistory: state.history.slotHistory,
    slotId: instance.slotId,
    templateSlotId: instance.templateSlotId,
    exerciseName: instance.exerciseName,
    requireLoaded: !isUnloadedTrackingMode(instance.trackingMode),
    repWindow: resolveInstanceBorrowRepWindow(instance),
  });
}

module.exports = [
  {
    // #bugs 2026-10-01: "Viimeksi 60 kg 6·6·6", and the dial asked for 3 × 8
    // at the same 60. The last time came from another day of the programme,
    // and the missed-reps target read only this slot's own history.
    name: 'a borrowed short session lowers the reps target, and never the weight',
    run() {
      const SHORT_AT = '2026-09-27T09:00:00.000Z';
      let state = startDay(EMPTY, 'day_a', 'Chest 1', 8, 8, 0);
      const slotId = state.activeSession.exercises[0].slotId;
      for (let index = 0; index < 3; index += 1) {
        state = logSet(state, slotId, index, '60', '6', SHORT_AT);
      }
      state = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: SHORT_AT } });
      state = workoutReducer(state, { type: 'session/clearCompletedSession' });

      const start = (enabled) =>
        workoutReducer(state, {
          type: 'session/startFromRuntimeTemplate',
          payload: {
            template: runtimeTemplate('day_b', 'Chest 2', 8, 8),
            sessionOrderIndex: 1,
            unitPreference: 'kg',
            progression: {
              automatedProgressionEnabled: enabled,
              setupLevel: 'beginner',
              nowMs: Date.parse('2026-10-01T09:00:00.000Z'),
            },
          },
        }).activeSession.exercises[0];

      const pro = start(true);
      pro.sets.forEach((set) => {
        // Borrowed, dated, and at the weight that was lifted.
        assert.equal(set.prefilledFromPerformedAt, SHORT_AT);
        assert.equal(set.plannedLoadKg, 60);
        // The reps those sets showed, not the programme's 8.
        assert.equal(set.plannedTargetReps, 6);
        // And no load move off a session the gate never watched.
        assert.equal(set.autoProgressedFromKg, undefined);
      });

      // Off (or free): the programme's own reps, as before.
      start(false).sets.forEach((set) => {
        assert.equal(set.plannedLoadKg, 60);
        assert.equal(set.plannedTargetReps, undefined);
      });
    },
  },
  {
    name: 'the heavy day’s weight does not open the 15-20 rep day',
    run() {
      const state = startDay(afterHeavyDay(), 'day_b', 'Pump day', 15, 20, 1);
      const instance = state.activeSession.exercises[0];

      // A different slot, so nothing of its own to go on.
      assert.equal(instance.slotId, 'tpl_split:day_b:lat_raise');
      assert.equal(state.history.slotHistory[instance.slotId], undefined);

      // And the heavy day is not an answer to a 15-20 question, so the field
      // opens empty rather than at a max-strength weight.
      instance.sets.forEach((set) => {
        assert.equal(set.draftLoadText, '');
        assert.equal(set.plannedLoadKg, undefined);
        assert.equal(set.prefilledFromPerformedAt, undefined);
      });
    },
  },
  {
    name: 'the badge and the table agree when there is nothing to borrow',
    run() {
      const state = startDay(afterHeavyDay(), 'day_b', 'Pump day', 15, 20, 1);
      const instance = state.activeSession.exercises[0];

      // The badge is driven by prefilledFromPerformedAt, the table by this.
      // Neither has anything to say, which is the agreement that was missing.
      assert.equal(instance.sets[0].prefilledFromPerformedAt, undefined);
      assert.equal(panelLastTime(state, instance), null);
    },
  },
  {
    name: 'a day asking for the same reps still borrows — and the table shows it',
    run() {
      const state = startDay(afterHeavyDay(), 'day_c', 'Second heavy day', 6, 8, 1);
      const instance = state.activeSession.exercises[0];

      // Borrowing is not the bug; borrowing across prescriptions was.
      assert.equal(instance.sets[0].draftLoadText, '10');
      assert.equal(instance.sets[0].prefilledFromPerformedAt, HEAVY_DAY_AT);

      const shown = panelLastTime(state, instance);
      assert.ok(shown, 'the table must show the sets the badge is dated from');
      assert.equal(shown.entry.performedAt, HEAVY_DAY_AT);
      // Labelled, not passed off as this slot's own record.
      assert.equal(shown.borrowed, true);
      assert.equal(shown.entry.sets.length, 3);
    },
  },
  {
    /**
     * The unscoped key an older install wrote under is SHARED history: before
     * slot ids carried the day, both days of this programme wrote to
     * `lat_raise`. So it is subject to the same prescription gate — and both
     * readers have to agree about that, or the table shows a heavy session
     * above a dial that refused to prefill from it.
     */
    name: 'the legacy unscoped key answers to the prescription too, on both sides',
    run() {
      const legacy = {
        slotId: 'lat_raise',
        templateId: 'tpl_split',
        templateName: 'Old install',
        exerciseName: 'Dumbbell Lateral Raise',
        substitutionGroup: 'lateral_raise',
        performedAt: '2026-08-20T09:00:00.000Z',
        sessionId: 's_legacy',
        sets: [
          { setIndex: 0, loadKg: 10, reps: 8, completedAt: '2026-08-20T09:05:00.000Z' },
          { setIndex: 1, loadKg: 10, reps: 8, completedAt: '2026-08-20T09:10:00.000Z' },
        ],
        skipped: false,
      };
      const skippedScoped = {
        ...legacy,
        slotId: 'tpl_split:day_b:lat_raise',
        performedAt: '2026-08-25T09:00:00.000Z',
        skipped: true,
      };

      const open = (slotHistory, repsMin, repsMax) => {
        const seeded = {
          ...EMPTY,
          history: { ...EMPTY.history, slotHistory },
        };
        const state = startDay(seeded, 'day_b', 'Pump day', repsMin, repsMax, 1);
        const instance = state.activeSession.exercises[0];
        return { dial: instance.sets[0].draftLoadText, table: panelLastTime(state, instance) };
      };

      // 8 reps does not answer a 15-20 day, whichever key it sits under.
      const mismatch = open({ lat_raise: [legacy] }, 15, 20);
      assert.equal(mismatch.dial, '');
      assert.equal(mismatch.table, null);

      // The same prescription: prefilled, and the table shows the same sets.
      const match = open({ lat_raise: [legacy] }, 6, 8);
      assert.equal(match.dial, '10');
      assert.equal(match.table.entry.performedAt, legacy.performedAt);
      // Its own slot's history, just written before slots carried the day.
      assert.equal(match.table.borrowed, false);

      // A scoped key holding only a skipped day is not a "last time" — it
      // falls through to the legacy key rather than blocking it.
      const skipped = open(
        { 'tpl_split:day_b:lat_raise': [skippedScoped], lat_raise: [legacy] },
        6,
        8,
      );
      assert.equal(skipped.dial, '10');
      assert.equal(skipped.table.entry.performedAt, legacy.performedAt);
    },
  },
  {
    name: 'once the day has its own history it stops borrowing at all',
    run() {
      let state = startDay(afterHeavyDay(), 'day_b', 'Pump day', 15, 20, 1);
      const slotId = state.activeSession.exercises[0].slotId;
      const at = '2026-08-29T09:00:00.000Z';
      for (let index = 0; index < 3; index += 1) {
        state = workoutReducer(state, {
          type: 'set/updateDraft',
          payload: { slotId, setIndex: index, patch: { loadText: '4', repsText: '18' } },
        });
        state = workoutReducer(state, {
          type: 'set/complete',
          payload: { slotId, setIndex: index, nowMs: Date.parse(at), unitPreference: 'kg' },
        });
      }
      state = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: at } });
      state = workoutReducer(state, { type: 'session/clearCompletedSession' });

      const next = startDay(state, 'day_b', 'Pump day', 15, 20, 1);
      const instance = next.activeSession.exercises[0];
      assert.equal(instance.sets[0].draftLoadText, '4');
      // Its own slot: nothing to explain, so no borrowed badge.
      assert.equal(instance.sets[0].prefilledFromPerformedAt, undefined);

      const shown = panelLastTime(next, instance);
      assert.equal(shown.borrowed, false);
      assert.equal(shown.entry.performedAt, at);
    },
  },
  {
    /**
     * #bugs 2026-09-09, from the gym: "Paino ei päivity", "Tavoite paino osio
     * ei muutu ainoastaan toisto". The pump day borrowed the heavy day's 10 kg
     * for every set at once, the reader logged set 1 at 12.5, and set 2 still
     * opened on 10 — the set screen read the prefill first and the logged set
     * last. This is that day end to end: real materialisation, real borrow,
     * and the same resolver the dial reads.
     */
    name: 'a set logged off its borrowed prefill opens the next set on the weight just lifted',
    run() {
      let state = startDay(afterHeavyDay(), 'day_b', 'Pump day', 6, 8, 1);
      const slotId = state.activeSession.exercises[0].slotId;
      // Every set arrived prefilled from the heavy day, badge and all.
      const before = openingTarget(state, 1);
      assert.equal(before.loadKg, 10);
      assert.equal(before.prefilledFromPerformedAt, HEAVY_DAY_AT);

      state = logSet(state, slotId, 0, '12.5', '18', '2026-09-09T07:05:00.000Z');
      const after = openingTarget(state, 1);
      // The weight just lifted, and no badge claiming another day chose it.
      assert.equal(after.loadKg, 12.5);
      assert.equal(after.prefilledFromPerformedAt, null);
      // The set's own record was not rewritten to get there.
      const secondSet = state.activeSession.exercises[0].sets[1];
      assert.equal(secondSet.draftLoadText, '10');
      assert.equal(secondSet.plannedLoadKg, 10);

      // And it chains: set 2 logged at 12.5, off ITS plan of 10, carries on.
      state = logSet(state, slotId, 1, '12.5', '17', '2026-09-09T07:08:00.000Z');
      assert.equal(openingTarget(state, 2).loadKg, 12.5);
    },
  },
  {
    name: 'a set logged on its borrowed prefill leaves the next set on the prefill, badge intact',
    run() {
      let state = startDay(afterHeavyDay(), 'day_b', 'Pump day', 6, 8, 1);
      const slotId = state.activeSession.exercises[0].slotId;
      state = logSet(state, slotId, 0, '10', '8', '2026-09-09T07:05:00.000Z');
      const next = openingTarget(state, 1);
      assert.equal(next.loadKg, 10);
      assert.equal(next.prefilledFromPerformedAt, HEAVY_DAY_AT);
    },
  },
];
