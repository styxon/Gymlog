const assert = require('node:assert/strict');

const { resolveLiftPraise } = require('../../.test-dist/lib/liftPraise.js');

// At the gym, 2026-10-08: the bench had sat at 60 kg 6 · 6 · 6, the card said
// it had not moved, and the next step was 3 × 7 — "jos käyttäjä tekee tämän
// tulisi joku loistavaa teksti". Praise for a step up met, never for a repeat.

function done(reps, extra = {}) {
  return reps.map((count) => ({
    status: 'completed',
    plannedLoadKg: 60,
    plannedRepsMax: 8,
    actualLoadKg: 60,
    actualReps: count,
    ...extra,
  }));
}

const last = (reps, loadKg = 60) => reps.map((count) => ({ loadKg, reps: count }));

module.exports = [
  {
    name: 'lift praise: a lowered target climbed and met is praised',
    run() {
      const sets = done([7, 7, 7], { plannedTargetReps: 7 });
      assert.deepEqual(resolveLiftPraise(sets, last([6, 6, 6]), 'load_and_reps'), { reps: [7, 7, 7], loadKg: 60 });
      // Beating the target counts as meeting it.
      assert.deepEqual(resolveLiftPraise(done([7, 8, 7], { plannedTargetReps: 7 }), last([6, 6, 6]), 'load_and_reps').reps, [7, 8, 7]);
    },
  },
  {
    name: 'lift praise: a target missed on any set, or a set not done, is not praised',
    run() {
      assert.equal(resolveLiftPraise(done([7, 7, 6], { plannedTargetReps: 7 }), last([6, 6, 6]), 'load_and_reps'), null);
      const skipped = done([7, 7, 7], { plannedTargetReps: 7 });
      skipped[2] = { ...skipped[2], status: 'skipped', actualReps: undefined };
      assert.equal(resolveLiftPraise(skipped, last([6, 6, 6]), 'load_and_reps'), null);
      // Met in reps, but lighter than planned.
      assert.equal(
        resolveLiftPraise(done([7, 7, 7], { plannedTargetReps: 7, actualLoadKg: 55 }), last([6, 6, 6]), 'load_and_reps'),
        null,
      );
    },
  },
  {
    name: 'lift praise: a repeat of last time is the normal case and is not praised',
    run() {
      assert.equal(resolveLiftPraise(done([6, 6, 6], { plannedTargetReps: 6 }), last([6, 6, 6]), 'load_and_reps'), null);
      assert.equal(resolveLiftPraise(done([8, 8, 8]), last([8, 8, 8]), 'load_and_reps'), null);
      // A set fewer than last time is not more than last time (review): 21 reps against 24.
      assert.equal(resolveLiftPraise(done([7, 7, 7], { plannedTargetReps: 7 }), last([6, 6, 6, 6]), 'load_and_reps'), null);
      // A target below last time's on one set is not a step up, whatever another set asks.
      assert.equal(
        resolveLiftPraise(done([9, 9, 7], { plannedRepsMax: 9 }).map((set, index) => (index === 2 ? { ...set, plannedRepsMax: 7 } : set)), last([8, 8, 8]), 'load_and_reps'),
        null,
      );
    },
  },
  {
    name: 'lift praise: a heavier planned weight met is praised; a lighter one is not',
    run() {
      const heavier = done([8, 8, 8], { plannedLoadKg: 62.5, actualLoadKg: 62.5 });
      assert.deepEqual(resolveLiftPraise(heavier, last([8, 8, 8]), 'load_and_reps'), { reps: [8, 8, 8], loadKg: 62.5 });
      const lighter = done([8, 8, 8], { plannedLoadKg: 55, actualLoadKg: 55 });
      assert.equal(resolveLiftPraise(lighter, last([7, 7, 7]), 'load_and_reps'), null);
    },
  },
  {
    name: 'lift praise: a ramp reads set by set',
    run() {
      const ramp = [
        { status: 'completed', plannedLoadKg: 40, plannedRepsMax: 10, rampTargetReps: 10, actualLoadKg: 40, actualReps: 10 },
        { status: 'completed', plannedLoadKg: 50, plannedRepsMax: 10, rampTargetReps: 8, actualLoadKg: 50, actualReps: 8 },
        { status: 'completed', plannedLoadKg: 60, plannedRepsMax: 10, rampTargetReps: 6, actualLoadKg: 60, actualReps: 6 },
      ];
      const before = [{ loadKg: 40, reps: 10 }, { loadKg: 50, reps: 8 }, { loadKg: 60, reps: 5 }];
      assert.deepEqual(resolveLiftPraise(ramp, before, 'load_and_reps'), { reps: [10, 8, 6], loadKg: 60 });
    },
  },
  {
    name: 'lift praise: bodyweight by reps; holds, minutes and a first time are left alone',
    run() {
      const bodyweight = [8, 8, 8].map((count) => ({ status: 'completed', plannedRepsMax: 12, plannedTargetReps: 8, actualReps: count }));
      assert.deepEqual(resolveLiftPraise(bodyweight, last([7, 7, 7], 0), 'bodyweight'), { reps: [8, 8, 8], loadKg: null });
      assert.equal(resolveLiftPraise(bodyweight, last([7, 7, 7], 0), 'hold'), null);
      assert.equal(resolveLiftPraise(bodyweight, last([7, 7, 7], 0), 'duration_minutes'), null);
      assert.equal(resolveLiftPraise(done([7, 7, 7], { plannedTargetReps: 7 }), null, 'load_and_reps'), null);
      assert.equal(resolveLiftPraise(done([7, 7, 7], { plannedTargetReps: 7 }), [], 'load_and_reps'), null);
    },
  },
  {
    name: 'lift praise: the walk-up card says it, in both languages',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs.readFileSync(path.join(__dirname, '../../src/screens/GuidedPlayerScreen.tsx'), 'utf8');
      assert.match(screen, /resolveLiftPraise\(/);
      assert.match(screen, /'guided\.walk\.praise'/);
      const { t } = require('../../.test-dist/lib/i18n.js');
      assert.equal(
        t('fi', 'guided.walk.praise', { name: 'Penkkipunnerrus', dose: '60 kg 3 × 7' }),
        'Loistavaa! Penkkipunnerrus 60 kg 3 × 7, enemmän kuin viimeksi.',
      );
      assert.notEqual(t('en', 'guided.walk.praise', { name: 'x', dose: 'y' }), 'guided.walk.praise');
    },
  },
];
