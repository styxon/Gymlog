const assert = require('node:assert/strict');

const { resolveGuidedSetPlan, resolveGuidedSetTarget } = require('../../.test-dist/lib/guidedPlayer.js');

// "Saadaanko näkyviin koko sarja mitä pitäisi tehdä eli esim tee 10 10 10 10
// 9" (#bugs 2026-10-08): the set card shows today's sets beside last time's.

function set(setIndex, extra = {}) {
  return {
    setIndex,
    status: 'pending',
    plannedLoadKg: 35,
    plannedRepsMin: 10,
    plannedRepsMax: 10,
    draftLoadText: '35',
    draftRepsText: '',
    ...extra,
  };
}

module.exports = [
  {
    name: 'set plan: every set still to do reads its target, the current one marked',
    run() {
      const sets = [0, 1, 2, 3, 4].map((index) => set(index));
      assert.deepEqual(
        resolveGuidedSetPlan(sets, 0, 'load_and_reps'),
        [
          { reps: 10, status: 'current' },
          { reps: 10, status: 'upcoming' },
          { reps: 10, status: 'upcoming' },
          { reps: 10, status: 'upcoming' },
          { reps: 10, status: 'upcoming' },
        ],
      );
      // A lowered target and a ramp read as the dial opens them.
      assert.deepEqual(resolveGuidedSetPlan([set(0, { plannedTargetReps: 7 }), set(1, { plannedTargetReps: 7 })], 0, 'load_and_reps').map((chip) => chip.reps), [7, 7]);
      const ramp = [set(0, { plannedLoadKg: 40, draftLoadText: '40', rampTargetReps: 10 }), set(1, { plannedLoadKg: 50, draftLoadText: '50', rampTargetReps: 8 }), set(2, { plannedLoadKg: 60, draftLoadText: '60', rampTargetReps: 6 })];
      assert.deepEqual(resolveGuidedSetPlan(ramp, 0, 'load_and_reps').map((chip) => chip.reps), [10, 8, 6]);
    },
  },
  {
    name: 'set plan: a logged set reads what was done, and the sets after it what their dial opens on',
    run() {
      const sets = [
        set(0, { status: 'completed', actualLoadKg: 35, actualReps: 12 }),
        set(1, { status: 'skipped' }),
        set(2),
        set(3),
      ];
      const plan = resolveGuidedSetPlan(sets, 2, 'load_and_reps');
      assert.deepEqual(plan.slice(0, 3), [
        { reps: 12, status: 'done' },
        { reps: null, status: 'skipped' },
        { reps: resolveGuidedSetTarget(sets, 2, 'load_and_reps').reps, status: 'current' },
      ]);
      assert.deepEqual(plan.map((chip) => chip.reps).slice(2), [2, 3].map((index) => resolveGuidedSetTarget(sets, index, 'load_and_reps').reps));
      // In set order, whatever order the sets are stored in.
      assert.deepEqual(resolveGuidedSetPlan([sets[2], sets[0]], 2, 'load_and_reps').map((chip) => chip.status), ['done', 'current']);
    },
  },
  {
    name: 'set plan: the set card draws it, and not for a bout of minutes',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const player = fs.readFileSync(path.join(__dirname, '../../src/screens/GuidedPlayerScreen.tsx'), 'utf8');
      assert.match(player, /exercise && !minutesMode\s*\?\s*resolveGuidedSetPlan\(liftSets, step\.setIndex, exercise\.trackingMode, exercise\.swappedAfterSetIndex\)/);
      assert.match(player, /t\(language, 'guided\.card\.today'\)/);
      const { t } = require('../../.test-dist/lib/i18n.js');
      assert.equal(t('fi', 'guided.card.today'), 'TÄNÄÄN');
    },
  },
];
