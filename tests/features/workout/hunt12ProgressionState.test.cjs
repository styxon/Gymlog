const assert = require('node:assert/strict');
const { withHelsinkiClocks } = require('../../helpers/clockChange.cjs');

// workoutPersistence reaches storage/largeItem, which reads Platform from react-native.
require('../../helpers/reactNativeStub.cjs').installReactNativeStub();

const D = '../../../.test-dist/';
const { workoutReducer, workoutInitialState } = require(D + 'features/workout/workoutState.js');
const { normalizeWorkoutBundle } = require(D + 'features/workout/workoutPersistence.js');
const { resolveGuidedSetTarget } = require(D + 'lib/guidedPlayer.js');
const { lightenRuntimeTemplate } = require(D + 'lib/recoverySheet.js');

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
];

module.exports.helpers = { at, addDays, addMinutes, entry, template, keyOf, BENCH, stateWith, start, exerciseOf, planned, autos, logSet, act, finish, runSession, reload, W1, W2, W3, W4 };
