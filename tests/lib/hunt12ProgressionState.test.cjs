const assert = require('node:assert/strict');
const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

const { evaluateProgression, isProgressionReadySession } = require('../../.test-dist/lib/progressionGate.js');
const lookup = require('../../.test-dist/lib/exerciseHistoryLookup.js');

/**
 * Automatic progression, the pure half of the stored state (hunt 12, fixer F2):
 * what the gate and the history lookup make of a stored entry.
 */

const at = (y, m1, d, h = 18) => new Date(y, m1 - 1, d, h).toISOString();
let count = 0;
function entry(iso, reps, loadKg, extra = {}) {
  count += 1;
  const loads = Array.isArray(loadKg) ? loadKg : reps.map(() => loadKg);
  return {
    slotId: 'tpl:day:bench',
    templateId: 'tpl',
    templateName: 'T',
    exerciseName: 'Bench Press',
    substitutionGroup: '',
    performedAt: iso,
    sessionId: `lib_${count}`,
    skipped: false,
    sets: reps.map((r, i) => ({ setIndex: i, loadKg: loads[i], reps: r, completedAt: iso, effort: null })),
    ...extra,
  };
}

module.exports = [
  {
    name: 'hunt12 Q3 gate: an entry the app asked for two sets of is ready on two; without the count it is two short of three',
    run() {
      withHelsinkiClocks(() => {
        const lighter = entry(at(2026, 10, 15), [12, 12], 60, { plannedSets: 2 });
        const full = entry(at(2026, 10, 8), [12, 12, 12], 60);
        assert.equal(isProgressionReadySession(lighter, 12, 3), true);
        const input = { repsMin: 8, repsMax: 12, targetSets: 3, level: 'beginner', nowMs: Date.parse(at(2026, 10, 22)) };
        assert.equal(evaluateProgression({ ...input, history: [lighter, full] }).recommendation, 'increase');
        const { plannedSets, ...unmarked } = lighter;
        assert.equal(isProgressionReadySession(unmarked, 12, 3), false);
        assert.deepEqual(evaluateProgression({ ...input, history: [unmarked, full] }), { recommendation: 'hold', holdReason: 'insufficient_sets', loadKg: 60 });
        // A count that is not one the app writes is no count: the programme's stands.
        [3, 4, '2', 2.5, 0, -1].forEach((junk) => {
          assert.equal(isProgressionReadySession({ ...unmarked, plannedSets: junk }, 12, 3), false, `plannedSets ${JSON.stringify(junk)}`);
        });
      });
    },
  },
  {
    name: 'hunt12 A5-1/A2-8 lookup: an own entry under another dose is not the slot own history; Last time without a dose reads the same off its window',
    run() {
      const dose = (trackingMode, repsMin, repsMax) => ({ trackingMode, repsMin, repsMax });
      const filed = entry(at(2026, 10, 1), [12, 12, 12], 60, { dose: dose('load_and_reps', 8, 12) });
      assert.equal(lookup.entryMatchesDose(filed, dose('load_and_reps', 8, 12)), true);
      assert.equal(lookup.entryMatchesDose(filed, dose('load_and_reps', 6, 10)), true, 'two reps either end is the same dose');
      assert.equal(lookup.entryMatchesDose(filed, dose('load_and_reps', 4, 6)), false);
      assert.equal(lookup.entryMatchesDose(filed, dose('bodyweight', 8, 12)), false);
      assert.equal(lookup.entryMatchesDose({ ...filed, dose: undefined }, dose('hold', 30, 60)), true, 'an entry from before the dose');
      assert.equal(lookup.entryMatchesDose(filed, null), true);
      const slotHistory = { 'tpl:day:bench': [filed] };
      const query = { slotHistory, slotId: 'tpl:day:bench', templateSlotId: 'bench', exerciseName: 'Bench Press', nowMs: Date.parse(at(2026, 10, 8)) };
      // The set screen's query: requireLoaded and the rep window, no dose.
      assert.equal(lookup.resolveLastTimeEntry({ ...query, requireLoaded: true, repWindow: { min: 8, max: 12 } }).borrowed, false);
      assert.equal(lookup.resolveLastTimeEntry({ ...query, requireLoaded: true, repWindow: { min: 4, max: 6 } }), null);
      // Now bodyweight: 12 reps of a loaded lift are borrowed, not its own.
      const asBodyweight = lookup.resolveLastTimeEntry({ ...query, requireLoaded: false, repWindow: null });
      assert.equal(asBodyweight.borrowed, true);
      assert.equal(lookup.resolveLastTimeEntry({ ...query, dose: dose('load_and_reps', 4, 6), repWindow: { min: 4, max: 6 } }), null);
    },
  },
  {
    name: 'hunt12 A7-3/A4-4/A5-6 cap: newest first by date, set-less entries do not count and only the newest is kept per lift',
    run() {
      const day = (d) => new Date(Date.UTC(2026, 8, d, 10)).toISOString();
      // Two real sessions, then ten skipped days and ten warm-up-only days: both real ones stay.
      const reals = [entry(day(2), [12, 12, 12], 60), entry(day(1), [12, 12, 12], 60)];
      const skips = Array.from({ length: 10 }, (_, i) => entry(day(3 + i), [], 0, { skipped: true, sets: [] })).reverse();
      const warmOnly = Array.from({ length: 10 }, (_, i) => entry(day(14 + i), [], 0, { sets: [], warmups: [{ loadKg: 40, reps: 10 + i }] })).reverse();
      const capped = lookup.capSlotEntries([...warmOnly, ...skips, ...reals]);
      assert.deepEqual(capped.filter(lookup.isUsableEntry).map((item) => item.performedAt), [day(2), day(1)]);
      const setless = capped.filter((item) => !lookup.isUsableEntry(item));
      assert.equal(setless.length, 1, 'one set-less entry per lift');
      assert.deepEqual(setless[0].warmups, [{ loadKg: 40, reps: 19 }], 'the newest, whose warm-ups are offered');
      // A finish dated behind the list (a phone clock running late) lands in date order and is the one cut.
      const ten = Array.from({ length: 10 }, (_, i) => entry(day(1 + i), [12, 12, 12], 60 + i)).reverse();
      const backdated = entry(new Date(Date.UTC(2025, 9, 9, 10)).toISOString(), [12, 12, 12], 50);
      const cut = lookup.capSlotEntries([backdated, ...ten]);
      assert.deepEqual(cut.map((item) => item.performedAt), ten.map((item) => item.performedAt));
      const two = lookup.capSlotEntries([entry(day(3), [8], 60), entry(day(5), [8], 62.5)]);
      assert.deepEqual(two.map((item) => item.performedAt), [day(5), day(3)]);
      // Another lift's newest real session in the same slot (a swap) still stays past the cap.
      const swapped = entry(day(0), [10], 30, { exerciseName: 'Incline Dumbbell Press' });
      assert.ok(lookup.capSlotEntries([...ten, swapped]).includes(swapped));
    },
  },
  {
    name: 'hunt12 A8-1: an impossible load scrubbed from an open session takes the gate badges on that set with it',
    run() {
      const { scrubImpossibleSessionLoads } = require('../../.test-dist/lib/impossibleLoads.js');
      const { buildLoggedSetPlan } = require('../../.test-dist/lib/loggedSetPlan.js');
      const set = (i, extra) => ({ setIndex: i, plannedRepsMin: 8, plannedRepsMax: 12, draftLoadText: '60', draftRepsText: '', plannedLoadKg: 60, status: 'pending', edited: false, heldForFatigue: true, ...extra });
      const session = {
        exercises: [{ slotId: 's', sets: [
          set(0, { plannedLoadKg: 5122.5, draftLoadText: '5122,5', heldForCautionArea: 'knees', prefilledFromPerformedAt: '2026-10-01T10:00:00.000Z', plannedTargetReps: 13, autoProgressedFromReps: 12, rampTargetReps: 9 }),
          set(1),
          set(2, { autoProgressedFromKg: 9000 }),
        ] }],
      };
      const [first, second, third] = scrubImpossibleSessionLoads(session).exercises[0].sets;
      for (const key of ['plannedLoadKg', 'autoProgressedFromKg', 'heldForFatigue', 'heldForCautionArea', 'prefilledFromPerformedAt', 'plannedTargetReps', 'autoProgressedFromReps', 'rampTargetReps']) {
        assert.equal(key in first, false, `set 1 keeps ${key}`);
        assert.equal(key in third, false, `set 3 keeps ${key}`);
      }
      assert.equal(first.draftLoadText, '');
      assert.equal(buildLoggedSetPlan({ ...first, actualLoadKg: 60 }).basis, 'none');
      assert.equal(second.heldForFatigue, true, 'an untouched set keeps its hold');
      assert.equal(buildLoggedSetPlan(second).basis, 'held_recovery');
    },
  },
  {
    name: 'hunt12 A14-9: a stored custom exercise loads with whole set and rep counts the gate can meet',
    run() {
      const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');
      const { normalizeDatabase } = loadAgainstFake(createFakeAsyncStorage(), (requireDist) => requireDist('storage/database.js'));
      const row = (extra) => ({ id: 'e1', workoutTemplateId: 't1', workoutTemplateSessionId: 's1', name: 'Bench Press', targetSets: 3, repMin: 8, repMax: 12, restSeconds: 90, orderIndex: 0, trackingMode: 'load_and_reps', ...extra });
      const load = (extra) => {
        const [loaded] = normalizeDatabase({ exerciseTemplates: [row(extra)] }).exerciseTemplates;
        return [loaded.targetSets, loaded.repMin, loaded.repMax];
      };
      const fractional = load({ targetSets: 2.5, repMin: 6.5, repMax: 8.5 });
      assert.ok(fractional.every(Number.isInteger), JSON.stringify(fractional));
      assert.equal(fractional[0], 3);
      assert.equal(load({ targetSets: -2 })[0], 1);
      assert.equal(load({ targetSets: 0 })[0], 1);
      assert.equal(load({ targetSets: Number.NaN })[0], 3);
      assert.equal(load({ targetSets: 1e6 })[0] <= 20, true);
      const reps = load({ repMin: -4, repMax: 1e9 });
      assert.ok(reps[1] >= 1 && reps[2] <= 1000 && reps[1] <= reps[2], JSON.stringify(reps));
      // A row the app wrote loads as stored.
      assert.deepEqual(load({ targetSets: 4, repMin: 10, repMax: 10 }), [4, 10, 10]);
    },
  },
  {
    name: 'hunt12 A14-2/A2-1/A2-2 catalog: every interval or distance row is a fixed dose, and loaded carries are not',
    run() {
      const { isFixedDoseExercise } = require('../../.test-dist/lib/intervalScheme.js');
      const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
      const rows = WORKOUT_TEMPLATES_V1.flatMap((template) => template.sessions.flatMap((session) => session.exercises));
      const fixed = rows.filter((row) => /\(\s*\d+\s*s\s/i.test(row.exerciseName) || /\d+\s*m\b/i.test(row.exerciseName));
      assert.ok(fixed.length >= 10, `the catalog has its interval and distance rows (${fixed.length})`);
      fixed.forEach((row) => assert.equal(isFixedDoseExercise(row), true, `${row.exerciseName} (${row.trackingMode}, ${row.substitutionGroup})`));
      ['Rowing Machine HIIT', 'Air Bike (30s sprint)', 'Sprint 40m', 'Rowing Machine (500m intervals)'].forEach((name) => {
        const row = rows.find((item) => item.exerciseName === name);
        assert.ok(row && isFixedDoseExercise(row), name);
      });
      ["Farmer's Walk", 'Sled Push', 'Push-Up', 'Bench Press', 'Burpee'].forEach((name) => {
        const row = rows.find((item) => item.exerciseName === name);
        assert.ok(row, `catalog has ${name}`);
        assert.equal(isFixedDoseExercise(row), false, name);
      });
      assert.equal(isFixedDoseExercise({ exerciseName: 'Treadmill HIIT (30s on / 30s off)' }), true, 'the name alone, with no group');
      assert.equal(isFixedDoseExercise({ exerciseName: 'Row', substitutionGroup: undefined }), false);
    },
  },
  {
    name: 'hunt12 A14-2 advice: a fixed-dose row gets no next-session advice, a lift beside it still does',
    run() {
      const { buildNextSessionAdvice } = require('../../.test-dist/lib/nextSessionAdvice.js');
      const sessions = [];
      const logs = [];
      [0, 7].forEach((day, index) => {
        const id = `s${index}`;
        sessions.push({ id, workoutTemplateId: 'tpl', workoutTemplateSessionId: 'day', workoutNameSnapshot: 'Winter', performedAt: new Date(2026, 8, 1 + day, 18).toISOString() });
        logs.push({ id: `bike${index}`, sessionId: id, exerciseTemplateId: null, exerciseNameSnapshot: 'Bike HIIT (45s sprint / 15s rest)', weight: 20, repsPerSet: [45, 45, 45], tracked: true, orderIndex: 0, templateSlotId: 'bike' });
        logs.push({ id: `bench${index}`, sessionId: id, exerciseTemplateId: null, exerciseNameSnapshot: 'Bench Press', weight: 60, repsPerSet: [8, 8, 8], tracked: true, orderIndex: 1, templateSlotId: 'bench' });
      });
      const template = {
        sessions: [{
          id: 'day',
          exercises: [
            { exerciseName: 'Bike HIIT (45s sprint / 15s rest)', slotId: 'bike', sets: 3, repsMin: 45, repsMax: 45, trackingMode: 'reps_first', substitutionGroup: 'cardio_intervals' },
            { exerciseName: 'Bench Press', slotId: 'bench', sets: 3, repsMin: 8, repsMax: 8, trackingMode: 'load_and_reps', substitutionGroup: 'press' },
          ],
        }],
      };
      const advice = (liftName) => buildNextSessionAdvice({ liftName, sessionId: 's1', sessions, logs, lookupTemplate: () => template, level: 'beginner' });
      assert.deepEqual(advice('Bike HIIT (45s sprint / 15s rest)'), { kind: 'none' });
      assert.deepEqual(advice('Bench Press'), { kind: 'raise', fromKg: 60, toKg: 62.5 });
    },
  },
];
