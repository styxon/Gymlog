const assert = require('node:assert/strict');
const { withHelsinkiClocks } = require('../../helpers/clockChange.cjs');

// workoutPersistence reaches storage/largeItem, which reads Platform from react-native.
require('../../helpers/reactNativeStub.cjs').installReactNativeStub();

const D = '../../../.test-dist/';
const { workoutReducer, workoutInitialState } = require(D + 'features/workout/workoutState.js');
const { normalizeWorkoutBundle } = require(D + 'features/workout/workoutPersistence.js');
const { resolveGuidedSetTarget } = require(D + 'lib/guidedPlayer.js');
const { lightenRuntimeTemplate } = require(D + 'lib/recoverySheet.js');
const { programmeSetCount, toWorkingHistoryEntry } = require(D + 'lib/warmupSets.js');
const { resolveLastTimeEntry } = require(D + 'lib/exerciseHistoryLookup.js');

/**
 * Automatic progression, the stored half (hunt 12, fixer F2): what a finished
 * session files for the next one to read, and what the next start makes of it.
 * Every case runs the real reducer from start to finish on a frozen clock.
 */

// ── a small harness over the reducer ─────────────────────────────────────────

const at = (y, m1, d, h = 18, min = 0) => new Date(y, m1 - 1, d, h, min).toISOString();
const addDays = (iso, n) => {
  const date = new Date(Date.parse(iso));
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, date.getHours(), date.getMinutes()).toISOString();
};
const addMinutes = (iso, n) => new Date(Date.parse(iso) + n * 60000).toISOString();

let entryCount = 0;
function entry(iso, reps, loadKg, extra = {}) {
  entryCount += 1;
  const loads = Array.isArray(loadKg) ? loadKg : reps.map(() => loadKg);
  return {
    slotId: 'unset',
    templateId: 'tpl_h12',
    templateName: 'Hunt programme',
    exerciseName: 'Bench Press',
    substitutionGroup: '',
    performedAt: iso,
    sessionId: `h12_${entryCount}`,
    skipped: false,
    sets: reps.map((r, i) => ({ setIndex: i, loadKg: loads[i], reps: r, completedAt: iso, effort: null })),
    ...extra,
  };
}

function template(exercises) {
  return {
    id: 'tpl_h12',
    name: 'Hunt programme',
    defaultScheduleMode: 'weekly',
    sessions: [
      {
        id: 'day_a',
        name: 'Day A',
        orderIndex: 0,
        exercises: exercises.map((e) => ({
          id: `ex_${e.slotId}`,
          exerciseName: e.name,
          slotId: e.slotId,
          role: 'primary',
          progressionPriority: 'high',
          trackingMode: e.trackingMode ?? 'load_and_reps',
          sets: e.sets ?? 3,
          repsMin: e.repsMin ?? 8,
          repsMax: e.repsMax ?? e.repsMin ?? 8,
          restSecondsMin: 90,
          restSecondsMax: 120,
          substitutionGroup: e.substitutionGroup ?? `grp_${e.slotId}`,
          ...(typeof e.programmeSets === 'number' ? { programmeSets: e.programmeSets } : {}),
        })),
      },
    ],
  };
}
const keyOf = (slotId) => `tpl_h12:day_a:${slotId}`;
const BENCH = template([{ slotId: 'bench', name: 'Bench Press', sets: 3, repsMin: 8, repsMax: 12 }]);

function stateWith(slotHistory) {
  return { ...workoutInitialState, hydrated: true, isRestoring: false, history: { sessions: [], slotHistory, lastSelectedTemplateId: null } };
}

function start(state, tpl, now, progression = {}) {
  const nowMs = Date.parse(now);
  let next = workoutReducer({ ...state, activeSession: null, completionSummary: null }, {
    type: 'session/startFromRuntimeTemplate',
    payload: {
      template: tpl,
      sessionOrderIndex: 0,
      unitPreference: 'kg',
      progression: { automatedProgressionEnabled: true, setupLevel: 'beginner', nowMs, cautionFlags: [], ...progression },
    },
  });
  next = { ...next, activeSession: { ...next.activeSession, startedAt: now, updatedAt: now } };
  return next;
}
const exerciseOf = (state, slot = 'bench') => state.activeSession.exercises.find((e) => e.templateSlotId === slot || e.slotId === slot);
const planned = (state, slot) => exerciseOf(state, slot).sets.map((set) => set.plannedLoadKg ?? null);
const autos = (state, slot) => exerciseOf(state, slot).sets.map((set) => set.autoProgressedFromKg ?? null);

function logSet(state, slot, setIndex, load, reps, now) {
  const slotId = exerciseOf(state, slot).slotId;
  let next = workoutReducer(state, {
    type: 'set/updateDraft',
    payload: { slotId, setIndex, patch: { ...(load === null ? {} : { loadText: String(load) }), repsText: String(reps) } },
  });
  next = workoutReducer(next, { type: 'set/complete', payload: { slotId, setIndex, nowMs: Date.parse(now), unitPreference: 'kg' } });
  return next;
}
function act(state, type, payload) {
  return workoutReducer(state, { type, payload });
}
function finish(state, now) {
  const finished = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: now } });
  return workoutReducer(finished, { type: 'session/clearCompletedSession' });
}
/** Starts `tpl`, logs each listed set (null load for bodyweight), finishes. */
function runSession(state, tpl, now, sets, progression = {}, slot = 'bench') {
  let s = start(state, tpl, now, progression);
  sets.forEach(([load, reps], index) => {
    s = logSet(s, slot, index, load, reps, addMinutes(now, 3 * (index + 1)));
  });
  return finish(s, addMinutes(now, 30));
}
const reload = (state) => {
  const bundle = normalizeWorkoutBundle(JSON.parse(JSON.stringify({ activeSession: state.activeSession, history: state.history })));
  return { ...state, history: bundle.history, activeSession: bundle.activeSession };
};

const W1 = at(2026, 10, 1);
const W2 = addDays(W1, 7);
const W3 = addDays(W1, 14);
const W4 = addDays(W1, 21);

/** Two ceiling sessions at `kg`, a lighter session (one set fewer, elevated), then returns the state. */
function afterLightened(level, setLoads, lightLoads, reps = 12) {
  let s = stateWith({});
  const full = setLoads.map((kg) => [kg, reps]);
  s = runSession(s, BENCH, W1, full, { setupLevel: level });
  s = runSession(s, BENCH, W2, full, { setupLevel: level, fatigueSignal: 'elevated' });
  s = runSession(s, lightenRuntimeTemplate(BENCH), W3, lightLoads.map((kg) => [kg, reps]), { setupLevel: level, fatigueSignal: 'elevated' });
  return s;
}

module.exports = [
  {
    name: 'hunt12 Q3: a lighter session files the set count the app asked for, and the next normal session raises off it',
    run() {
      withHelsinkiClocks(() => {
        ['beginner', 'intermediate'].forEach((level) => {
          const s = afterLightened(level, [60, 60, 60], [60, 60]);
          const filed = s.history.slotHistory[keyOf('bench')][0];
          assert.equal(filed.sets.length, 2);
          assert.equal(filed.plannedSets, 2, `${level}: the lighter entry says the app asked for 2`);
          const next = start(s, BENCH, W4, { setupLevel: level, fatigueSignal: 'normal' });
          assert.deepEqual(autos(next).slice(0, 2), [60, 60], `${level}: sets 1-2 raise (was held on insufficient_sets)`);
          assert.deepEqual(planned(next).slice(0, 2), [62.5, 62.5], `${level}: ${planned(next)}`);
        });
      });
    },
  },
  {
    name: 'hunt12 Q3: a bodyweight lift climbs one rep after a lighter session, as after a full one',
    run() {
      withHelsinkiClocks(() => {
        const tpl = template([{ slotId: 'pull', name: 'Pull-Up', trackingMode: 'bodyweight', sets: 3, repsMin: 12, repsMax: 12 }]);
        let s = stateWith({});
        s = runSession(s, tpl, W1, [[null, 12], [null, 12], [null, 12]], {}, 'pull');
        s = runSession(s, tpl, W2, [[null, 13], [null, 13], [null, 13]], { fatigueSignal: 'elevated' }, 'pull');
        s = runSession(s, lightenRuntimeTemplate(tpl), W3, [[null, 13], [null, 13]], { fatigueSignal: 'elevated' }, 'pull');
        const next = start(s, tpl, W4, { fatigueSignal: 'normal' });
        assert.equal(exerciseOf(next, 'pull').sets[0].plannedTargetReps, 14);
        assert.equal(exerciseOf(next, 'pull').sets[0].autoProgressedFromReps, 13);
      });
    },
  },
  {
    name: 'hunt12 Q3: the missed-reps climb resumes after a lighter session rather than repeating its target',
    run() {
      withHelsinkiClocks(() => {
        let s = stateWith({});
        s = runSession(s, BENCH, W1, [[60, 7], [60, 7], [60, 7]]);
        const lowered = start(s, lightenRuntimeTemplate(BENCH), W2, { fatigueSignal: 'elevated' });
        assert.equal(exerciseOf(lowered).sets[0].plannedTargetReps, 7);
        let l = logSet(lowered, 'bench', 0, 60, 7, addMinutes(W2, 3));
        l = logSet(l, 'bench', 1, 60, 7, addMinutes(W2, 6));
        s = finish(l, addMinutes(W2, 30));
        const next = start(s, BENCH, W3, { fatigueSignal: 'normal' });
        // Every set the app asked for met the target 7: one more is the programme's 8, so no lowered target.
        assert.equal(exerciseOf(next).sets[0].plannedTargetReps, undefined);
      });
    },
  },
  {
    name: 'hunt12 Q3 guards: a dropped set still holds; an old entry without the count reads as today',
    run() {
      withHelsinkiClocks(() => {
        // A normal session with 2 of 3 logged: held on the next start.
        let s = stateWith({});
        s = runSession(s, BENCH, W1, [[60, 12], [60, 12], [60, 12]]);
        s = runSession(s, BENCH, W2, [[60, 12], [60, 12]]);
        assert.equal(s.history.slotHistory[keyOf('bench')][0].plannedSets, undefined);
        assert.deepEqual(autos(start(s, BENCH, W3)), [null, null, null]);
        // A lighter session where the reader also took a set off: still a dropped set.
        let l = stateWith({});
        l = runSession(l, BENCH, W1, [[60, 12], [60, 12], [60, 12]]);
        l = runSession(l, BENCH, W2, [[60, 12], [60, 12], [60, 12]], { fatigueSignal: 'elevated' });
        let light = start(l, lightenRuntimeTemplate(BENCH), W3, { fatigueSignal: 'elevated' });
        light = act(light, 'exercise/removeSet', { slotId: exerciseOf(light).slotId });
        light = logSet(light, 'bench', 0, 60, 12, addMinutes(W3, 3));
        l = finish(light, addMinutes(W3, 30));
        assert.deepEqual(autos(start(l, BENCH, W4)), [null, null, null], 'one set of two asked is a dropped set');
      });
    },
  },
  {
    name: 'hunt12 Q3 loader: plannedSets survives a reload when it is a positive whole count, and is dropped otherwise',
    run() {
      const key = keyOf('bench');
      const base = entry(at(2026, 10, 1), [12, 12], 60, { slotId: key });
      [[2, 2], ['2', undefined], [-1, undefined], [0, undefined], [2.5, undefined], [null, undefined]].forEach(([stored, kept]) => {
        const bundle = normalizeWorkoutBundle({ history: { sessions: [], slotHistory: { [key]: [{ ...base, plannedSets: stored }] }, lastSelectedTemplateId: null } });
        assert.equal(bundle.history.slotHistory[key][0].plannedSets, kept, `stored ${JSON.stringify(stored)}`);
        assert.equal('plannedSets' in bundle.history.slotHistory[key][0], kept !== undefined);
      });
      // The shape every install has today: no field at all, loaded unchanged.
      const old = normalizeWorkoutBundle({ history: { sessions: [], slotHistory: { [key]: [base] }, lastSelectedTemplateId: null } });
      assert.deepEqual(old.history.slotHistory[key][0], base);
    },
  },
  {
    name: 'hunt12 A9-2/A1-4: the set a lighter session left out opens on its own last load and climbs with the rest',
    run() {
      withHelsinkiClocks(() => {
        // A pyramid: the lighter session drops the top set; it opened blank and the dial carried set 2's 55.
        const pyramid = afterLightened('beginner', [50, 55, 60], [50, 55]);
        const next = start(pyramid, BENCH, W4, { fatigueSignal: 'normal' });
        assert.deepEqual(planned(next), [52.5, 57.5, 62.5]);
        assert.deepEqual(autos(next), [50, 55, 60]);
        let played = logSet(next, 'bench', 0, 52.5, 12, addMinutes(W4, 3));
        played = logSet(played, 'bench', 1, 57.5, 12, addMinutes(W4, 6));
        const top = exerciseOf(played);
        assert.equal(resolveGuidedSetTarget(top.sets, 2, top.trackingMode, top.swappedAfterSetIndex).loadKg, 62.5);
        // Straight sets: the third set is no longer blank and carries the AUTO badge like the others.
        const flat = start(afterLightened('beginner', [60, 60, 60], [60, 60]), BENCH, W4, { fatigueSignal: 'normal' });
        assert.deepEqual(planned(flat), [62.5, 62.5, 62.5]);
        assert.deepEqual(autos(flat), [60, 60, 60]);
      });
    },
  },
  {
    name: 'hunt12 A6-3/A5-2/A8-3: a set last time did not reach opens on the set before it, repeated, with no badge',
    run() {
      withHelsinkiClocks(() => {
        // Ended after two sets (skip): set 3 repeats the 62.5 the session reached.
        let s = stateWith({});
        s = runSession(s, BENCH, W1, [[60, 12], [60, 12], [60, 12]]);
        s = runSession(s, BENCH, W2, [[60, 12], [60, 12], [60, 12]]);
        let w3 = start(s, BENCH, W3);
        assert.deepEqual(planned(w3), [62.5, 62.5, 62.5]);
        w3 = logSet(w3, 'bench', 0, 62.5, 12, addMinutes(W3, 3));
        w3 = logSet(w3, 'bench', 1, 62.5, 12, addMinutes(W3, 6));
        w3 = act(w3, 'exercise/skip', { slotId: exerciseOf(w3).slotId });
        const w4 = start(finish(w3, addMinutes(W3, 30)), BENCH, W4);
        assert.deepEqual(planned(w4), [62.5, 62.5, 62.5]);
        assert.deepEqual(autos(w4), [null, null, null]);
        assert.ok(exerciseOf(w4).sets.every((set) => !set.heldForFatigue && set.prefilledFromPerformedAt === undefined));
        // A fourth set added to the programme over a three-set history: it opens on the third's 60.
        const four = template([{ slotId: 'bench', name: 'Bench Press', sets: 4, repsMin: 8, repsMax: 12 }]);
        const h = stateWith({ [keyOf('bench')]: [entry(at(2026, 10, 2), [12, 12, 12], 60, { slotId: keyOf('bench') }), entry(at(2026, 9, 25), [12, 12, 12], 60, { slotId: keyOf('bench') })] });
        assert.deepEqual(planned(start(h, four, at(2026, 10, 9))), [60, 60, 60, 60]);
        // The newest session's last set dropped on load as impossible: set 3 carries set 2's load.
        const mk = (iso, top) => entry(iso, [12, 12, 12], [60, 62.5, top], { slotId: keyOf('bench') });
        const bundle = normalizeWorkoutBundle({ history: { sessions: [], slotHistory: { [keyOf('bench')]: [mk(at(2026, 10, 1), 6000), mk(at(2026, 9, 24), 65)] }, lastSelectedTemplateId: null } });
        const dropped = start({ ...stateWith({}), history: bundle.history }, BENCH, at(2026, 10, 8));
        assert.deepEqual(planned(dropped), [60, 62.5, 62.5]);
      });
    },
  },
  {
    name: 'hunt12 A4-1/A4-2: a set added mid-workout is filed as added, and the mark survives a reload',
    run() {
      withHelsinkiClocks(() => {
        let s = start(stateWith({}), BENCH, W1);
        [0, 1, 2].forEach((i) => { s = logSet(s, 'bench', i, 60, 8, addMinutes(W1, 3 * (i + 1))); });
        s = act(s, 'exercise/addSet', { slotId: exerciseOf(s).slotId });
        s = logSet(s, 'bench', 3, 90, 5, addMinutes(W1, 15));
        s = finish(s, addMinutes(W1, 30));
        const filed = s.history.slotHistory[keyOf('bench')][0];
        assert.deepEqual(filed.sets.map((set) => set.addedMidSession), [undefined, undefined, undefined, true]);
        assert.deepEqual(filed.sets.map((set) => 'addedMidSession' in set), [false, false, false, true]);
        const reloaded = reload(s).history.slotHistory[keyOf('bench')][0];
        assert.deepEqual(reloaded.sets.map((set) => set.addedMidSession), [undefined, undefined, undefined, true]);
        // Only `true` is a mark; anything else stored there is dropped, and an unmarked entry loads unchanged.
        const key = keyOf('bench');
        const old = entry(at(2026, 10, 1), [8, 8, 8, 5], [60, 60, 60, 90], { slotId: key });
        const junk = { ...old, sets: old.sets.map((set, i) => ({ ...set, addedMidSession: ['yes', false, 1, true][i] })) };
        const bundle = normalizeWorkoutBundle({ history: { sessions: [], slotHistory: { [key]: [junk, old] }, lastSelectedTemplateId: null } });
        assert.deepEqual(bundle.history.slotHistory[key][0].sets.map((set) => 'addedMidSession' in set), [false, false, false, true]);
        assert.deepEqual(bundle.history.slotHistory[key][1], old);
      });
    },
  },
  {
    name: 'hunt12 P0-3: each filed entry carries when its session started, and the loader keeps only a real date',
    run() {
      withHelsinkiClocks(() => {
        const s = runSession(stateWith({}), BENCH, W1, [[60, 8], [60, 8], [60, 8]]);
        const filed = s.history.slotHistory[keyOf('bench')][0];
        // The session's start: its clock begins at the first set (lib/sessionClock).
        assert.equal(filed.startedAt, addMinutes(W1, 3));
        assert.equal(filed.performedAt, addMinutes(W1, 30));
        assert.equal(reload(s).history.slotHistory[keyOf('bench')][0].startedAt, addMinutes(W1, 3));
        const key = keyOf('bench');
        [['nope', false], [5, false], [null, false], [W1, true]].forEach(([stored, kept]) => {
          const bundle = normalizeWorkoutBundle({ history: { sessions: [], slotHistory: { [key]: [{ ...filed, startedAt: stored }] }, lastSelectedTemplateId: null } });
          assert.equal('startedAt' in bundle.history.slotHistory[key][0], kept, `startedAt ${JSON.stringify(stored)}`);
        });
      });
    },
  },
  {
    name: 'hunt12 A4-3: removing a set keeps the programme count, so Last time and a swap still read last time as work',
    run() {
      withHelsinkiClocks(() => {
        const tpl = template([
          { slotId: 'sq', name: 'Back Squat', sets: 3, repsMin: 5, repsMax: 5 },
          { slotId: 'lp', name: 'Leg Press', sets: 3, repsMin: 5, repsMax: 5 },
        ]);
        const t0 = at(2026, 10, 1);
        const h = stateWith({
          [keyOf('sq')]: [entry(t0, [5, 5, 5], [60, 80, 100], { slotId: keyOf('sq'), exerciseName: 'Back Squat' })],
          [keyOf('lp')]: [entry(t0, [5, 5, 5], [60, 80, 100], { slotId: keyOf('lp'), exerciseName: 'Leg Press' })],
        });
        let s = start(h, tpl, addDays(t0, 7));
        assert.deepEqual(planned(s, 'sq'), [60, 80, 100]);
        s = act(s, 'exercise/removeSet', { slotId: exerciseOf(s, 'sq').slotId });
        const squat = exerciseOf(s, 'sq');
        assert.equal(programmeSetCount(squat.sets), 3);
        const panel = resolveLastTimeEntry({ slotHistory: s.history.slotHistory, slotId: squat.slotId, templateSlotId: 'sq', exerciseName: 'Back Squat', requireLoaded: true, nowMs: Date.parse(addDays(t0, 7)) });
        assert.deepEqual(toWorkingHistoryEntry(panel.entry, programmeSetCount(squat.sets)).sets.map((set) => set.loadKg), [60, 80, 100]);
        s = act(s, 'exercise/swap', { slotId: squat.slotId, exerciseName: 'Leg Press', substitutionGroup: 'grp_sq', unitPreference: 'kg' });
        assert.deepEqual(planned(s, 'sq'), [60, 80]);
      });
    },
  },
];

module.exports.helpers = { at, addDays, addMinutes, entry, template, keyOf, BENCH, stateWith, start, exerciseOf, planned, autos, logSet, act, finish, runSession, reload, W1, W2, W3, W4 };
