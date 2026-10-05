const assert = require('node:assert/strict');

const { workoutReducer, workoutInitialState } = require('../../.test-dist/features/workout/workoutState.js');
const { toWorkingHistoryEntry, gatingSets } = require('../../.test-dist/lib/warmupSets.js');
const { isProgressionReadySession, resolveProgressedLoadKg } = require('../../.test-dist/lib/progressionGate.js');

/**
 * Automated progression, set by set (user, 2026-10-05, "D + A").
 *
 * It took the heaviest set and put it plus 2.5 kg on every set, so a 50/60/70
 * pyramid came back as 72.5 × 3 and the warm-up jumped 45 % (bug hunt,
 * 2026-10-05). Now each working set climbs from its own load, a warm-up never
 * climbs, and the lighter sets after the heaviest (a drop) do not hold the
 * session back. Cases from the spec review of the same day.
 */

const SLOT = 'primary_bench_1';
const DAY_MS = 86_400_000;
const NOW = Date.now();

function entry(daysAgo, sets) {
  const performedAt = new Date(NOW - daysAgo * DAY_MS).toISOString();
  return {
    slotId: SLOT,
    templateId: 'tpl',
    templateName: 'Push',
    exerciseName: 'Bench Press',
    substitutionGroup: 'horizontal_press',
    performedAt,
    sessionId: `s${daysAgo}`,
    sets: sets.map(([loadKg, reps], setIndex) => ({ setIndex, loadKg, reps, completedAt: performedAt })),
    skipped: false,
  };
}

/** The sets the next session opens on, for a history (newest first). */
function openWith(history, { sets = 3, repsMin = 8, repsMax = 8, level = 'beginner', progression = true } = {}) {
  const state = workoutReducer(
    { ...workoutInitialState, history: { sessions: [], lastSelectedTemplateId: null, slotHistory: { [SLOT]: history } } },
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
                  sets,
                  repsMin,
                  repsMax,
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
        progression: { automatedProgressionEnabled: progression, setupLevel: level },
      },
    },
  );
  return state.activeSession.exercises[0].sets;
}

const loads = (sets) => sets.map((set) => set.plannedLoadKg);
const froms = (sets) => sets.map((set) => set.autoProgressedFromKg);

module.exports = [
  {
    name: 'per-set progression: straight sets climb together, exactly as before',
    run() {
      const earned = openWith([entry(2, [[60, 8], [60, 8], [60, 8]]), entry(4, [[60, 8], [60, 8], [60, 8]])]);
      assert.deepEqual(loads(earned), [62.5, 62.5, 62.5]);
      assert.deepEqual(froms(earned), [60, 60, 60]);

      const short = openWith([entry(2, [[60, 8], [60, 7], [60, 6]]), entry(4, [[60, 8], [60, 8], [60, 8]])]);
      assert.deepEqual(loads(short), [60, 60, 60]);
      assert.deepEqual(froms(short), [undefined, undefined, undefined]);

      const off = openWith([entry(2, [[60, 8], [60, 8], [60, 8]]), entry(4, [[60, 8], [60, 8], [60, 8]])], { progression: false });
      assert.deepEqual(loads(off), [60, 60, 60]);
    },
  },
  {
    name: 'per-set progression: a pyramid keeps its shape — 50/60/70 opens 52.5/62.5/72.5, not 72.5 × 3',
    run() {
      const pyramid = [[50, 8], [60, 8], [70, 8]];
      const sets = openWith([entry(2, pyramid), entry(4, pyramid)]);
      assert.deepEqual(loads(sets), [52.5, 62.5, 72.5]);
      assert.deepEqual(froms(sets), [50, 60, 70]);

      // Every set of an ascending pyramid still has to reach the ceiling.
      const topShort = openWith([entry(2, [[50, 8], [60, 8], [70, 6]]), entry(4, pyramid)]);
      assert.deepEqual(loads(topShort), [50, 60, 70]);
      const lowShort = openWith([entry(2, [[50, 6], [60, 8], [70, 8]]), entry(4, pyramid)]);
      assert.deepEqual(loads(lowShort), [50, 60, 70]);
    },
  },
  {
    name: 'per-set progression: a light set before the work, past the programme’s count, is a warm-up — it neither climbs nor seeds set 1',
    run() {
      // 40 then 3 × 60 on a three-set programme: the 40 is a warm-up.
      const warm = [[40, 10], [60, 8], [60, 8], [60, 8]];
      const sets = openWith([entry(2, warm), entry(4, warm)]);
      assert.deepEqual(loads(sets), [62.5, 62.5, 62.5]);

      // Without progression it still reads the working sets: set 1 is not the warm-up.
      assert.deepEqual(loads(openWith([entry(2, warm)], { progression: false })), [60, 60, 60]);

      // The warm-up's reps do not count against the ceiling either.
      const warmShort = [[40, 5], [60, 8], [60, 8], [60, 8]];
      assert.deepEqual(loads(openWith([entry(2, warmShort), entry(4, warmShort)])), [62.5, 62.5, 62.5]);
    },
  },
  {
    name: 'per-set progression: exactly the programme’s count is all work, however light the first set',
    run() {
      // 60/80/100 on three sets: the 60 is under 70 % of 100, but the session
      // did what the programme asked — taking it as a warm-up would leave two
      // sets and hold the lift forever on "too few sets".
      const pyramid = [[60, 8], [80, 8], [100, 8]];
      assert.deepEqual(loads(openWith([entry(2, pyramid), entry(4, pyramid)])), [62.5, 82.5, 102.5]);
      assert.equal(toWorkingHistoryEntry(entry(2, pyramid), 3).sets.length, 3);
    },
  },
  {
    name: 'per-set progression: the 70 % line, and the lightest goes first when only some are warm-ups',
    run() {
      // 49 against 70 is work; 48.9 is a warm-up.
      assert.equal(toWorkingHistoryEntry(entry(1, [[49, 8], [70, 8], [70, 8], [70, 8]]), 3).sets.length, 4);
      const below = toWorkingHistoryEntry(entry(1, [[48.9, 8], [70, 8], [70, 8], [70, 8]]), 3);
      assert.deepEqual(below.sets.map((set) => [set.setIndex, set.loadKg]), [[0, 70], [1, 70], [2, 70]]);

      // Two light sets, one over the count: the lighter one is the warm-up.
      const two = toWorkingHistoryEntry(entry(1, [[30, 10], [40, 10], [70, 8], [70, 8]]), 3);
      assert.deepEqual(two.sets.map((set) => set.loadKg), [40, 70, 70]);

      // A light set AFTER the heaviest is never a warm-up.
      assert.equal(toWorkingHistoryEntry(entry(1, [[70, 8], [70, 8], [70, 8], [30, 15]]), 3).sets.length, 4);

      // Nothing inferred: the very same entry back, numbers untouched.
      const plain = entry(1, [[60, 8], [60, 8], [60, 8]]);
      assert.equal(toWorkingHistoryEntry(plain, 3), plain);
    },
  },
  {
    name: 'per-set progression: a drop after the heaviest set is exempt from the gate, and a short drop keeps its load',
    run() {
      // 80/75/70, only the 80 at the ceiling: the drops do not hold it back.
      const drop = [[80, 8], [75, 6], [70, 7]];
      assert.equal(isProgressionReadySession(entry(1, drop), 8, 3), true);
      // repsMin 6: the 75 × 6 and 70 × 7 met the floor and climb too.
      assert.deepEqual(loads(openWith([entry(2, drop), entry(4, drop)], { repsMin: 6 })), [82.5, 77.5, 72.5]);
      // A drop under the floor (70 × 5 against 6) keeps its load.
      const deep = [[80, 8], [75, 6], [70, 5]];
      assert.deepEqual(loads(openWith([entry(2, deep), entry(4, deep)], { repsMin: 6 })), [82.5, 77.5, 70]);

      // The heaviest short: no jump.
      assert.equal(isProgressionReadySession(entry(1, [[80, 7], [75, 8], [70, 8]]), 8, 3), false);
    },
  },
  {
    name: 'per-set progression: sets before the heaviest still gate — a 70 × 12 top does not carry 60 × 6',
    run() {
      const sets = entry(1, [[60, 6], [60, 6], [60, 6], [70, 12]]);
      assert.deepEqual(gatingSets(sets.sets).map((set) => set.loadKg), [60, 60, 60, 70]);
      assert.equal(isProgressionReadySession(sets, 12, 3), false);
    },
  },
  {
    name: 'per-set progression: the streak compares the heaviest working load, so changed back-offs still confirm',
    run() {
      // Advanced needs two ready sessions at the same load: the heaviest.
      const first = [[80, 8], [75, 8], [70, 8]];
      const second = [[80, 8], [72.5, 8], [65, 8]];
      const sets = openWith([entry(2, second), entry(4, first), entry(6, first)], { level: 'advanced' });
      assert.deepEqual(loads(sets), [82.5, 75, 67.5]);

      // Different heaviest loads: not confirmed.
      const held = openWith([entry(2, [[80, 8], [80, 8], [80, 8]]), entry(4, [[77.5, 8], [77.5, 8], [77.5, 8]]), entry(6, [[75, 8], [75, 8], [75, 8]])], { level: 'advanced' });
      assert.deepEqual(loads(held), [80, 80, 80]);
    },
  },
  {
    name: 'per-set progression: a set with no load of its own opens on the decision, as before',
    run() {
      const resolved = resolveProgressedLoadKg({
        history: [entry(2, [[60, 8], [60, 8], [60, 8]]), entry(4, [[60, 8], [60, 8], [60, 8]])],
        repsMin: 8,
        repsMax: 8,
        targetSets: 3,
        level: 'beginner',
        automatedProgressionEnabled: true,
        fallbackLoadKg: 0,
      });
      assert.deepEqual([resolved.loadKg, resolved.progressed, resolved.fromLoadKg], [62.5, true, 60]);
    },
  },
];
