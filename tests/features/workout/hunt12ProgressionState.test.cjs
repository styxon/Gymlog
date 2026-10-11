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
const { buildLoggedSetPlan } = require(D + 'lib/loggedSetPlan.js');
const { WORKOUT_TEMPLATES_V1 } = require(D + 'features/workout/workoutCatalog.js');
const { canCompleteSet } = require(D + 'features/workout/workoutState.js');

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
    name: 'hunt12 Q3 intermediate pyramid: after a lighter session the next normal one climbs, every set from its own load',
    run() {
      withHelsinkiClocks(() => {
        // 50/55/60 twice at the ceiling, then a lighter 50/55. The lighter
        // session's top (55) was measured against the full session's (60) and
        // the confirmation broke: held awaiting_confirmation a second session.
        const pyramid = afterLightened('intermediate', [50, 55, 60], [50, 55]);
        const next = start(pyramid, BENCH, W4, { setupLevel: 'intermediate', fatigueSignal: 'normal' });
        assert.deepEqual(planned(next), [52.5, 57.5, 62.5]);
        assert.deepEqual(autos(next), [50, 55, 60]);
        // A lighter session at other loads than the full one confirmed nothing.
        const moved = start(afterLightened('intermediate', [50, 55, 60], [50, 57.5]), BENCH, W4, { setupLevel: 'intermediate', fatigueSignal: 'normal' });
        assert.deepEqual(autos(moved), [null, null, null]);
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
  {
    name: 'hunt12 A2-3: a held bodyweight lift opens on the floor the gate returns, with the hold badge and no AUTO arrow',
    run() {
      withHelsinkiClocks(() => {
        // The gate branch (F1) returns the proven floor for a held bodyweight lift; stubbed
        // here so this half — carrying it onto the set — is tested on its own.
        const gate = require(D + 'lib/progressionGate.js');
        const real = gate.resolveProgressedReps;
        gate.resolveProgressedReps = (input) =>
          input.trackingMode === 'bodyweight' && input.automatedProgressionEnabled
            ? { targetReps: 13, progressed: false, fromReps: null, heldForFatigue: true, heldForCautionArea: null }
            : real(input);
        try {
          const tpl = template([{ slotId: 'pull', name: 'Pull-Up', trackingMode: 'bodyweight', sets: 3, repsMin: 12, repsMax: 12 }]);
          const key = keyOf('pull');
          const h = stateWith({ [key]: [entry(W2, [13, 13, 13], 0, { slotId: key, exerciseName: 'Pull-Up' }), entry(W1, [13, 13, 13], 0, { slotId: key, exerciseName: 'Pull-Up' })] });
          const s = start(h, tpl, W3, { fatigueSignal: 'high' });
          const set = exerciseOf(s, 'pull').sets[0];
          assert.equal(set.plannedTargetReps, 13);
          assert.equal(set.autoProgressedFromReps, undefined);
          assert.equal(set.heldForFatigue, true);
          const dial = resolveGuidedSetTarget(exerciseOf(s, 'pull').sets, 0, 'bodyweight');
          assert.equal(dial.reps, 13);
          assert.equal(dial.autoProgressedFromReps, null);
          // The template's own number is no target to record.
          gate.resolveProgressedReps = () => ({ targetReps: 12, progressed: false, fromReps: null, heldForFatigue: false, heldForCautionArea: null });
          assert.equal(exerciseOf(start(h, tpl, W3), 'pull').sets[0].plannedTargetReps, undefined);
        } finally {
          gate.resolveProgressedReps = real;
        }
      });
    },
  },
  {
    name: 'hunt12 A2-7: a hold opens on the seconds it held last time, inside the programme range, and never climbs',
    run() {
      withHelsinkiClocks(() => {
        const tpl = template([{ slotId: 'pl', name: 'Plank', trackingMode: 'hold', sets: 3, repsMin: 30, repsMax: 60 }]);
        const key = keyOf('pl');
        const held = (seconds) =>
          stateWith({ [key]: [entry(W2, seconds, 0, { slotId: key, exerciseName: 'Plank' }), entry(W1, seconds, 0, { slotId: key, exerciseName: 'Plank' })] });
        const targets = (state, progression) => exerciseOf(start(state, tpl, W3, progression), 'pl').sets.map((set) => set.plannedTargetReps);
        assert.deepEqual(targets(held([40, 40, 45])), [40, 40, 45]);
        const opened = exerciseOf(start(held([40, 40, 40]), tpl, W3), 'pl').sets[0];
        assert.equal(opened.autoProgressedFromReps, undefined);
        assert.equal(buildLoggedSetPlan(opened).basis, 'repeat');
        assert.equal(buildLoggedSetPlan(opened).targetReps, 40);
        // Clamped to the range; the top of it is the template's own number, so no target.
        assert.deepEqual(targets(held([20, 70, 60])), [30, undefined, undefined]);
        // Free repeats the programme's numbers.
        assert.deepEqual(targets(held([40, 40, 40]), { automatedProgressionEnabled: false }), [undefined, undefined, undefined]);
      });
    },
  },
  {
    name: 'hunt12 R1: both ramp-target readings are told the programme floor, so only a lowered target filed below it wins over a ramp',
    run() {
      withHelsinkiClocks(() => {
        const gate = require(D + 'lib/progressionGate.js');
        const real = gate.resolveRampSetTarget;
        const seen = [];
        gate.resolveRampSetTarget = (input) => {
          seen.push(input.repsMin);
          return real(input);
        };
        try {
          // The slot's own history, and a lift borrowed by name from a free workout.
          const own = stateWith({ [keyOf('bench')]: [entry(W1, [10, 8, 6], [40, 50, 60], { slotId: keyOf('bench') })] });
          start(own, BENCH, W2);
          const borrowed = stateWith({ 'logged:bench press': [entry(W1, [10, 8, 6], [40, 50, 60], { slotId: 'logged:bench press', templateId: '' })] });
          start(borrowed, BENCH, W2);
        } finally {
          gate.resolveRampSetTarget = real;
        }
        assert.ok(seen.length >= 6, `ramp read ${seen.length} times`);
        assert.deepEqual([...new Set(seen)], [8]);
      });
    },
  },
  {
    name: 'hunt12 A5-1: after a rep-range edit the slot reads its old sessions as borrowed: no AUTO, no lowered target off another range',
    run() {
      withHelsinkiClocks(() => {
        const key = keyOf('bench');
        const dosed = (reps, kg, min, max, iso) => entry(iso, reps, kg, { slotId: key, dose: { trackingMode: 'load_and_reps', repsMin: min, repsMax: max } });
        const slot = (min, max) => template([{ slotId: 'bench', name: 'Bench Press', sets: 3, repsMin: min, repsMax: max }]);
        const panel = (state, tpl) => {
          const ex = exerciseOf(state);
          return resolveLastTimeEntry({
            slotHistory: state.history.slotHistory, slotId: ex.slotId, templateSlotId: 'bench', exerciseName: 'Bench Press',
            requireLoaded: true, repWindow: { min: tpl.sessions[0].exercises[0].repsMin, max: tpl.sessions[0].exercises[0].repsMax }, nowMs: Date.parse(W3),
          });
        };
        // 4-6 history, the slot now 12-15: it opened 120 kg with a lowered target of 5.
        const heavy = stateWith({ [key]: [dosed([5, 5, 5], 120, 4, 6, W2), dosed([5, 5, 5], 120, 4, 6, W1)] });
        const up = start(heavy, slot(12, 15), W3, { setupLevel: 'intermediate' });
        assert.deepEqual(exerciseOf(up).sets.map((set) => [set.plannedLoadKg, set.autoProgressedFromKg, set.plannedTargetReps]), [[undefined, undefined, undefined], [undefined, undefined, undefined], [undefined, undefined, undefined]]);
        assert.equal(panel(up, slot(12, 15)), null);
        // 8-12 history, the slot now 4-6: no AUTO off a ceiling of another range.
        const light = stateWith({ [key]: [dosed([12, 12, 12], 60, 8, 12, W2), dosed([12, 12, 12], 60, 8, 12, W1)] });
        const down = start(light, slot(4, 6), W3);
        assert.deepEqual(autos(down), [null, null, null]);
        // 5-6 history in a 4-6 slot moved to 6-8: within two reps, still its own and still gated.
        const near = stateWith({ [key]: [dosed([8, 8, 8], 60, 4, 6, W2), dosed([8, 8, 8], 60, 4, 6, W1)] });
        assert.deepEqual(autos(start(near, slot(6, 8), W3)), [60, 60, 60]);
        // Controls: an unchanged range still lowers a short session's target and still raises.
        const short = stateWith({ [key]: [dosed([5, 5, 5], 60, 8, 12, W2)] });
        assert.equal(exerciseOf(start(short, BENCH, W3)).sets[0].plannedTargetReps, 5);
        assert.deepEqual(autos(start(light, BENCH, W3)), [60, 60, 60]);
        // An entry from before the dose was filed reads as it always did.
        const old = stateWith({ [key]: [entry(W2, [12, 12, 12], 60, { slotId: key }), entry(W1, [12, 12, 12], 60, { slotId: key })] });
        assert.deepEqual(autos(start(old, slot(4, 6), W3)), [60, 60, 60]);
      });
    },
  },
  {
    name: 'hunt12 A5-1 filing: each entry records the dose its sets were asked for, a swapped lift its own; the loader checks it',
    run() {
      withHelsinkiClocks(() => {
        const s = runSession(stateWith({}), BENCH, W1, [[60, 12], [60, 12], [60, 12]]);
        assert.deepEqual(s.history.slotHistory[keyOf('bench')][0].dose, { trackingMode: 'load_and_reps', repsMin: 8, repsMax: 12 });
        const plank = template([{ slotId: 'core', name: 'Plank', trackingMode: 'hold', sets: 2, repsMin: 30, repsMax: 60 }]);
        let p = start(stateWith({}), plank, W1);
        p = logSet(p, 'core', 0, null, 45, addMinutes(W1, 3));
        p = act(p, 'exercise/swap', { slotId: exerciseOf(p, 'core').slotId, exerciseName: 'Hanging Leg Raise', substitutionGroup: 'grp_core', unitPreference: 'kg' });
        const swappedMode = exerciseOf(p, 'core').trackingMode;
        const swappedReps = [exerciseOf(p, 'core').sets[1].plannedRepsMin, exerciseOf(p, 'core').sets[1].plannedRepsMax];
        p = logSet(p, 'core', 1, swappedMode === 'load_and_reps' ? 10 : null, swappedReps[1], addMinutes(W1, 6));
        p = finish(p, addMinutes(W1, 30));
        const filed = p.history.slotHistory[keyOf('core')];
        const byName = Object.fromEntries(filed.map((item) => [item.exerciseName, item.dose]));
        assert.deepEqual(byName.Plank, { trackingMode: 'hold', repsMin: 30, repsMax: 60 });
        assert.deepEqual(byName['Hanging Leg Raise'], { trackingMode: swappedMode, repsMin: swappedReps[0], repsMax: swappedReps[1] });
        const key = keyOf('bench');
        const base = entry(W1, [12], 60, { slotId: key });
        [[{ trackingMode: 'load_and_reps', repsMin: 8, repsMax: 12 }, true], [{ trackingMode: 'lifting', repsMin: 8, repsMax: 12 }, false], [{ trackingMode: 'hold', repsMin: 'x', repsMax: 9 }, false], ['8-12', false], [{ trackingMode: 'hold', repsMin: 9, repsMax: 8 }, false]].forEach(([stored, kept]) => {
          const bundle = normalizeWorkoutBundle({ history: { sessions: [], slotHistory: { [key]: [{ ...base, dose: stored }] }, lastSelectedTemplateId: null } });
          assert.equal('dose' in bundle.history.slotHistory[key][0], kept, JSON.stringify(stored));
        });
      });
    },
  },
  {
    name: 'hunt12 P0-2: a bodyweight set borrowed from a free workout opens on no borrowed number and is not saved as borrowed',
    run() {
      withHelsinkiClocks(() => {
        const tpl = template([{ slotId: 'pull', name: 'Pull-Up', trackingMode: 'bodyweight', sets: 3, repsMin: 8, repsMax: 8 }]);
        const free = stateWith({ 'logged:pull-up': [entry(W1, [9, 9, 9], 0, { slotId: 'logged:pull-up', templateId: '', exerciseName: 'Pull-Up' })] });
        const set = exerciseOf(start(free, tpl, W2), 'pull').sets[0];
        assert.equal(set.prefilledFromPerformedAt, undefined);
        assert.equal(set.plannedLoadKg, undefined);
        assert.equal(buildLoggedSetPlan(set).basis, 'none');
        // A loaded borrow still says where its weight came from.
        const bench = stateWith({ 'logged:bench press': [entry(W1, [10, 10, 10], 55, { slotId: 'logged:bench press', templateId: '' })] });
        const borrowed = exerciseOf(start(bench, BENCH, W2)).sets[0];
        assert.equal(borrowed.plannedLoadKg, 55);
        assert.equal(buildLoggedSetPlan(borrowed).basis, 'borrowed');
      });
    },
  },
  {
    name: 'hunt12 A2-8: a slot whose mode changed reads no number in the old unit',
    run() {
      withHelsinkiClocks(() => {
        const key = keyOf('pull');
        const tpl = template([{ slotId: 'pull', name: 'Pull-Up', trackingMode: 'bodyweight', sets: 3, repsMin: 8, repsMax: 12 }]);
        const dosed = (reps, kg, mode, min, max, iso) => entry(iso, reps, kg, { slotId: key, exerciseName: 'Pull-Up', dose: { trackingMode: mode, repsMin: min, repsMax: max } });
        // Held seconds are not repetitions: no target of 61.
        const holds = stateWith({ [key]: [dosed([60, 60, 60], 0, 'hold', 30, 60, W2), dosed([60, 60, 60], 0, 'hold', 30, 60, W1)] });
        assert.deepEqual(exerciseOf(start(holds, tpl, W3), 'pull').sets.map((set) => [set.plannedTargetReps, set.autoProgressedFromReps]), [[undefined, undefined], [undefined, undefined], [undefined, undefined]]);
        // A loaded history is no load for a bodyweight slot, nor a +1 rep.
        const loaded = stateWith({ [key]: [dosed([12, 12, 12], 50, 'load_and_reps', 8, 12, W2), dosed([12, 12, 12], 50, 'load_and_reps', 8, 12, W1)] });
        const opened = exerciseOf(start(loaded, tpl, W3), 'pull').sets[0];
        assert.equal(opened.plannedLoadKg, undefined);
        assert.equal(opened.plannedTargetReps, undefined);
        assert.equal(opened.draftLoadText, '');
      });
    },
  },
  {
    name: 'hunt12 P7: the Last time panel reads the session the prefill read when the slot mode changed (hold vs bodyweight)',
    run() {
      withHelsinkiClocks(() => {
        const { resolveInstanceDose, resolveInstanceBorrowRepWindow } = require(D + 'features/workout/workoutState.js');
        const key = keyOf('pull');
        const tpl = template([{ slotId: 'pull', name: 'Pull-Up', trackingMode: 'bodyweight', sets: 3, repsMin: 8, repsMax: 12 }]);
        const dosed = (reps, mode, min, max, iso) => entry(iso, reps, 0, { slotId: key, exerciseName: 'Pull-Up', dose: { trackingMode: mode, repsMin: min, repsMax: max } });
        // Newest: the slot was a 30-60 s hold. Before it: the bodyweight reps the slot asks for now.
        const held = dosed([60, 60, 60], 'hold', 30, 60, W2);
        const reps = dosed([10, 10, 10], 'bodyweight', 8, 12, W1);
        const s = start(stateWith({ [key]: [held, reps] }), tpl, W3);
        const instance = exerciseOf(s, 'pull');
        // The prefill reads the bodyweight session: 10 reps proved, never 61 off the seconds.
        assert.equal(instance.sets[0].plannedTargetReps, undefined);
        const panel = resolveLastTimeEntry({
          slotHistory: s.history.slotHistory,
          slotId: instance.slotId,
          templateSlotId: instance.templateSlotId ?? null,
          exerciseName: instance.exerciseName,
          requireLoaded: false,
          repWindow: resolveInstanceBorrowRepWindow(instance),
          nowMs: Date.parse(W3),
          dose: resolveInstanceDose(instance),
        });
        assert.equal(panel.borrowed, false);
        assert.equal(panel.entry.sessionId, reps.sessionId, 'the panel listed the 60 s hold above a dial opened on reps');
        // A loaded slot whose history is in its own dose reads it as before.
        const bench = start(stateWith({ [keyOf('bench')]: [entry(W2, [10, 10, 10], 60, { slotId: keyOf('bench'), dose: { trackingMode: 'load_and_reps', repsMin: 8, repsMax: 12 } })] }), BENCH, W3);
        assert.deepEqual(resolveInstanceDose(exerciseOf(bench)), { trackingMode: 'load_and_reps', repsMin: 8, repsMax: 12 });
      });
    },
  },
  {
    name: 'hunt12 A6-1: swapping away and back to the programme lift restores what the gate decided for the sets still ahead',
    run() {
      withHelsinkiClocks(() => {
        const swap = (state, slot, name) => act(state, 'exercise/swap', { slotId: exerciseOf(state, slot).slotId, exerciseName: name, substitutionGroup: exerciseOf(state, slot).substitutionGroup, unitPreference: 'kg' });
        let s = stateWith({});
        s = runSession(s, BENCH, W1, [[60, 12], [60, 12], [60, 12]]);
        s = runSession(s, BENCH, W2, [[60, 12], [60, 12], [60, 12]]);
        const opened = start(s, BENCH, W3);
        assert.deepEqual(autos(opened), [60, 60, 60]);
        const away = swap(opened, 'bench', 'Incline Dumbbell Press');
        assert.deepEqual(autos(away), [null, null, null], 'a swap to another lift still clears the decision');
        const back = swap(away, 'bench', 'Bench Press');
        assert.deepEqual(planned(back), [62.5, 62.5, 62.5]);
        assert.deepEqual(autos(back), [60, 60, 60]);
        assert.ok(exerciseOf(back).sets.every((set) => set.prefilledFromPerformedAt === undefined));
        assert.equal(buildLoggedSetPlan(exerciseOf(back).sets[0]).basis, 'progressed');
        // Set 1 logged before the round trip: only the sets still ahead are restored.
        let partly = logSet(opened, 'bench', 0, 62.5, 12, addMinutes(W3, 3));
        partly = swap(swap(partly, 'bench', 'Incline Dumbbell Press'), 'bench', 'Bench Press');
        assert.deepEqual(autos(partly).slice(1), [60, 60]);
        // The snapshot survives a reload, and a malformed one is dropped.
        const reloaded = reload(away);
        assert.deepEqual(autos(swap(reloaded, 'bench', 'Bench Press')), [60, 60, 60]);
        const junk = JSON.parse(JSON.stringify(away));
        exerciseOf(junk).programmedSetPlans = [{ setIndex: 'x' }, 'nope', { setIndex: 1, plannedLoadKg: 5122.5, draftLoadText: '5122,5' }];
        const cleaned = reload(junk);
        assert.equal(exerciseOf(cleaned).programmedSetPlans, undefined);
        exerciseOf(junk).programmedSetPlans = 'nope';
        assert.equal(exerciseOf(reload(junk)).programmedSetPlans, undefined);
        // Bodyweight: the earned +1 comes back.
        const pullTpl = template([{ slotId: 'pu', name: 'Pull-Up', trackingMode: 'bodyweight', sets: 3, repsMin: 6, repsMax: 10 }]);
        const pk = keyOf('pu');
        const pulls = stateWith({ [pk]: [entry(W2, [10, 10, 10], 0, { slotId: pk, exerciseName: 'Pull-Up' }), entry(W1, [10, 10, 10], 0, { slotId: pk, exerciseName: 'Pull-Up' })] });
        const pull = swap(swap(start(pulls, pullTpl, W3), 'pu', 'Chin-Up'), 'pu', 'Pull-Up');
        assert.deepEqual(exerciseOf(pull, 'pu').sets.map((set) => [set.plannedTargetReps, set.autoProgressedFromReps]), [[11, 10], [11, 10], [11, 10]]);
      });
    },
  },
  {
    name: 'hunt12 A10-2: the session records whether progression was on at its start, and the TODAY arrow reads that',
    run() {
      withHelsinkiClocks(() => {
        const on = start(stateWith({}), BENCH, W1);
        assert.equal(on.activeSession.progressionOn, true);
        const off = start(stateWith({}), BENCH, W1, { automatedProgressionEnabled: false });
        assert.equal(off.activeSession.progressionOn, false);
        assert.equal(reload(on).activeSession.progressionOn, true);
        assert.equal(reload(off).activeSession.progressionOn, false);
        // An older session has none, and junk is none: the live entitlement then decides.
        const junk = JSON.parse(JSON.stringify(on));
        junk.activeSession.progressionOn = 'yes';
        assert.equal('progressionOn' in reload(junk).activeSession, false);
        delete junk.activeSession.progressionOn;
        assert.equal('progressionOn' in reload(junk).activeSession, false);
      });
      const fs = require('node:fs');
      const path = require('node:path');
      const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'app', 'renderWorkoutTab.tsx'), 'utf8');
      assert.match(source, /progressionOn=\{workout\.activeSession\?\.progressionOn \?\? \(proUnlocked && preferences\.automatedProgressionEnabled\)\}/);
    },
  },
  {
    name: 'hunt12 A7-3: ten finishes with the lift skipped keep the sessions an intermediate lifter needs to progress',
    run() {
      withHelsinkiClocks(() => {
        let s = stateWith({});
        [W1, W2, W3].forEach((when) => { s = runSession(s, BENCH, when, [[60, 12], [60, 12], [60, 12]], { setupLevel: 'intermediate' }); });
        for (let i = 0; i < 10; i += 1) {
          const when = addMinutes(addDays(W3, 1), 60 * i);
          const skipping = start(s, BENCH, when, { setupLevel: 'intermediate' });
          s = finish(act(skipping, 'exercise/skip', { slotId: exerciseOf(skipping).slotId }), addMinutes(when, 5));
        }
        const entries = s.history.slotHistory[keyOf('bench')];
        assert.equal(entries.filter((item) => item.sets.length > 0).length, 3);
        assert.deepEqual(autos(start(s, BENCH, addDays(W3, 7), { setupLevel: 'intermediate' })), [60, 60, 60]);
      });
    },
  },
  {
    name: 'hunt12 A5-5: an all-zero session in the slot is no weight for a loaded lift, in the prefill and in Last time',
    run() {
      withHelsinkiClocks(() => {
        const key = keyOf('bench');
        const h = stateWith({ [key]: [entry(at(2026, 10, 5), [12, 12, 12], 0, { slotId: key }), entry(at(2026, 9, 28), [12, 12, 12], 60, { slotId: key }), entry(at(2026, 9, 21), [12, 12, 12], 60, { slotId: key })] });
        const now = at(2026, 10, 6);
        const opened = start(h, BENCH, now, { automatedProgressionEnabled: false });
        assert.deepEqual(planned(opened), [60, 60, 60]);
        const panel = resolveLastTimeEntry({ slotHistory: h.history.slotHistory, slotId: key, templateSlotId: 'bench', exerciseName: 'Bench Press', requireLoaded: true, repWindow: { min: 8, max: 12 }, nowMs: Date.parse(now) });
        assert.equal(panel.entry.performedAt, at(2026, 9, 28));
        assert.equal(panel.borrowed, false);
        // Bodyweight work: 0 kg is the honest answer, and still the newest.
        const pk = keyOf('pull');
        const pullTpl = template([{ slotId: 'pull', name: 'Pull-Up', trackingMode: 'bodyweight', sets: 3, repsMin: 8, repsMax: 12 }]);
        const bw = stateWith({ [pk]: [entry(at(2026, 10, 5), [9, 9, 9], 0, { slotId: pk, exerciseName: 'Pull-Up' }), entry(at(2026, 9, 28), [8, 8, 8], 0, { slotId: pk, exerciseName: 'Pull-Up' })] });
        assert.deepEqual(planned(start(bw, pullTpl, now, { automatedProgressionEnabled: false }), 'pull'), [0, 0, 0]);
        const bwPanel = resolveLastTimeEntry({ slotHistory: bw.history.slotHistory, slotId: pk, templateSlotId: 'pull', exerciseName: 'Pull-Up', requireLoaded: false, repWindow: null, nowMs: Date.parse(now) });
        assert.equal(bwPanel.entry.performedAt, at(2026, 10, 5));
      });
    },
  },
  {
    name: 'hunt12 A3-5: a middle set taken back and not redone is filed without a gap, numbered as done',
    run() {
      withHelsinkiClocks(() => {
        let s = start(stateWith({}), BENCH, W1);
        s = logSet(s, 'bench', 0, 40, 10, addMinutes(W1, 3));
        s = logSet(s, 'bench', 1, 50, 8, addMinutes(W1, 6));
        s = logSet(s, 'bench', 2, 60, 6, addMinutes(W1, 9));
        s = act(s, 'set/undo', { slotId: exerciseOf(s).slotId, setIndex: 1, unitPreference: 'kg' });
        s = finish(s, addMinutes(W1, 30));
        const filed = s.history.slotHistory[keyOf('bench')][0];
        assert.deepEqual(filed.sets.map((set) => [set.setIndex, set.loadKg]), [[0, 40], [1, 60]]);
        const next = start(s, BENCH, W2);
        assert.deepEqual(planned(next).slice(0, 2), [40, 60]);
        assert.deepEqual(exerciseOf(next).sets.slice(0, 2).map((set) => set.rampTargetReps), [10, 7]);
      });
    },
  },
  {
    name: 'hunt12 A8-2: the loader checks every field of a stored last-time entry, so junk cannot hold a lift',
    run() {
      withHelsinkiClocks(() => {
        const key = keyOf('bench');
        const load = (entries) => normalizeWorkoutBundle({ history: { sessions: [], slotHistory: { [key]: entries }, lastSelectedTemplateId: null } }).history;
        const real = (iso, extra = {}) => entry(iso, [12, 12, 12], 60, { slotId: key, ...extra });
        // skipped "yes" read as a skip and held the newest real session.
        const history = load([real(W2, { skipped: 'yes' }), real(W1)]);
        assert.equal(history.slotHistory[key][0].skipped, false);
        assert.deepEqual(autos(start({ ...stateWith({}), history }, BENCH, W3)), [60, 60, 60]);
        assert.equal(load([real(W2, { skipped: true, sets: [] })]).slotHistory[key][0].skipped, true);
        const one = (extra) => load([real(W2, extra)]).slotHistory[key][0];
        ['6', -3, 0, 6.5, 1e9, null].forEach((junk) => assert.equal('targetReps' in one({ targetReps: junk }), false, `targetReps ${junk}`));
        assert.equal(one({ targetReps: 6 }).targetReps, 6);
        [5, {}, null].forEach((junk) => assert.equal('swappedFrom' in one({ swappedFrom: junk }), false, `swappedFrom ${JSON.stringify(junk)}`));
        assert.equal(one({ swappedFrom: 'Bench Press' }).swappedFrom, 'Bench Press');
        assert.equal(one({ sessionId: 5 }).sessionId, '5');
        assert.equal(one({ sessionId: {} }).sessionId, '');
        assert.equal(one({ slotId: null }).slotId, '');
        // A well-formed entry loads exactly as stored.
        const clean = real(W2, { targetReps: 6, swappedFrom: 'Bench Press' });
        assert.deepEqual(one(clean), clean);
      });
    },
  },
  {
    name: 'hunt12 A14-2/A2-1/A2-2: interval and distance rows repeat their dose; loaded carries and counted reps still progress',
    run() {
      withHelsinkiClocks(() => {
        const allRows = WORKOUT_TEMPLATES_V1.flatMap((t) => t.sessions.flatMap((d) => d.exercises));
        const catalogRow = (templateId, name) => {
          const row = WORKOUT_TEMPLATES_V1.find((item) => item.id === templateId).sessions.flatMap((day) => day.exercises).find((item) => item.exerciseName === name);
          assert.ok(row, `${templateId} has ${name}`);
          return row;
        };
        // Three weeks on plan, logged at the dial's own numbers; the fourth start is read.
        const weeks = (row, loadKg) => {
          const tpl = { id: 'tpl_h12', name: 'Hunt programme', defaultScheduleMode: 'weekly', sessions: [{ id: 'day_a', name: 'Day A', orderIndex: 0, exercises: [{ ...row, slotId: 'row', supersetGroup: null }] }] };
          let s = stateWith({});
          [W1, W2, W3].forEach((when) => {
            let live = start(s, tpl, when);
            const ex = exerciseOf(live, 'row');
            ex.sets.forEach((set) => {
              const shown = resolveGuidedSetTarget(exerciseOf(live, 'row').sets, set.setIndex, ex.trackingMode);
              live = logSet(live, 'row', set.setIndex, loadKg, shown.reps, addMinutes(when, 2 + set.setIndex));
            });
            assert.ok(exerciseOf(live, 'row').sets.every((item) => item.status === 'completed'), `${row.exerciseName} logs every set`);
            s = finish(live, addMinutes(when, 40));
          });
          const next = exerciseOf(start(s, tpl, W4), 'row');
          return next.sets.map((set) => [set.plannedLoadKg ?? null, set.autoProgressedFromKg ?? null, set.plannedTargetReps ?? null, set.autoProgressedFromReps ?? null, set.rampTargetReps ?? null]);
        };
        const repeat = (kg) => [kg, null, null, null, null];
        assert.deepEqual(weeks(catalogRow('tpl_gainer_athlete_conditioning_v1', 'Sprint 40m'), null)[0], repeat(0), 'Sprint 40m stays 40 m');
        assert.deepEqual(weeks(catalogRow('tpl_gainer_lean_shred_v1', 'Sprint Interval (200m)'), null)[0], repeat(0));
        assert.deepEqual(weeks(catalogRow('tpl_gainer_fat_burn_hiit_v1', 'Burpee (20s on / 10s off)'), null)[0], repeat(0));
        const winter = allRows.find((item) => item.id === 'season_winter_lower_a_bike');
        assert.deepEqual(weeks(winter, 20)[0], repeat(20), 'Bike HIIT keeps the resistance typed');
        // The 500 m rowing interval is logged with no load.
        const rowing = allRows.find((item) => item.exerciseName === 'Rowing Machine (500m intervals)');
        assert.equal(canCompleteSet(rowing, { setIndex: 0, plannedRepsMin: 500, plannedRepsMax: 500, draftLoadText: '', draftRepsText: '500', status: 'pending', edited: false }, 'kg'), true);
        // Controls: a loaded carry still steps load, counted reps still step reps.
        const walk = weeks(allRows.find((item) => item.exerciseName === "Farmer's Walk"), 24);
        assert.deepEqual(walk[0].slice(0, 2), [26.5, 24]);
        const pushUp = template([{ slotId: 'row', name: 'Push-Up', trackingMode: 'bodyweight', sets: 3, repsMin: 12, repsMax: 12 }]).sessions[0].exercises[0];
        assert.deepEqual(weeks(pushUp, null)[0].slice(2, 4), [14, 13], '12, then 13, then 14');
      });
    },
  },
  {
    name: 'hunt12 P0-2 swap: a bodyweight lift swapped in takes no borrowed stamp from its history',
    run() {
      withHelsinkiClocks(() => {
        const tpl = template([{ slotId: 'pull', name: 'Pull-Up', trackingMode: 'bodyweight', sets: 3, repsMin: 8, repsMax: 8 }]);
        const chins = stateWith({ 'logged:chin-up': [entry(W1, [9, 9, 9], 0, { slotId: 'logged:chin-up', templateId: '', exerciseName: 'Chin-Up' })] });
        let s = start(chins, tpl, W2);
        s = act(s, 'exercise/swap', { slotId: exerciseOf(s, 'pull').slotId, exerciseName: 'Chin-Up', substitutionGroup: 'grp_pull', unitPreference: 'kg' });
        const set = exerciseOf(s, 'pull').sets[0];
        assert.equal(exerciseOf(s, 'pull').exerciseName, 'Chin-Up');
        assert.equal(set.prefilledFromPerformedAt, undefined);
        assert.notEqual(buildLoggedSetPlan(set).basis, 'borrowed');
        // A loaded lift swapped in still says where its weight came from.
        const bench = stateWith({ 'logged:incline dumbbell press': [entry(W1, [10, 10, 10], 24, { slotId: 'logged:incline dumbbell press', templateId: '', exerciseName: 'Incline Dumbbell Press' })] });
        let b = start(bench, BENCH, W2);
        b = act(b, 'exercise/swap', { slotId: exerciseOf(b).slotId, exerciseName: 'Incline Dumbbell Press', substitutionGroup: 'grp_bench', unitPreference: 'kg' });
        assert.equal(buildLoggedSetPlan(exerciseOf(b).sets[0]).basis, 'borrowed');
      });
    },
  },
];

module.exports.helpers = { at, addDays, addMinutes, entry, template, keyOf, BENCH, stateWith, start, exerciseOf, planned, autos, logSet, act, finish, runSession, reload, W1, W2, W3, W4 };
