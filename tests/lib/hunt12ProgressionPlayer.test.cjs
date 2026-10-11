const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guided = require('../../.test-dist/lib/guidedPlayer.js');
const row = require('../../.test-dist/lib/guidedSetRow.js');
const { t } = require('../../.test-dist/lib/i18n.js');

const { resolveGuidedSetPlan, resolveGuidedSetTarget } = guided;

const playerSource = fs
  .readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

/** The text between two markers, so a guard looks at one function and not the whole screen. */
function between(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `missing: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `missing end: ${to}`);
  return source.slice(start, end);
}

function set(setIndex, extra = {}) {
  return {
    setIndex,
    status: 'pending',
    plannedLoadKg: 60,
    plannedRepsMin: 8,
    plannedRepsMax: 8,
    draftLoadText: '60',
    draftRepsText: '',
    ...extra,
  };
}

/** A set last time never reached: no prefill of its own. */
function blank(setIndex, extra = {}) {
  const shaped = set(setIndex, { draftLoadText: '', ...extra });
  delete shaped.plannedLoadKg;
  return shaped;
}

const chipReps = (sets, trackingMode = 'load_and_reps') => resolveGuidedSetPlan(sets, sets[0].setIndex, trackingMode).map((chip) => chip.reps);

/**
 * Automatic progression hunt (run 12, 2026-10-11), the set screen's own
 * surfaces: the TODAY chips, the TODAY arrow, the overview's reps label and
 * the walk-up line must say what the dial will do.
 */
module.exports = [
  {
    name: 'hunt 12 P0-1: a set with no prefill of its own reads the set before on the TODAY chips (lowered 6/6/6, not 6/6/8)',
    run() {
      const sets = [set(0, { plannedTargetReps: 6 }), set(1, { plannedTargetReps: 6 }), blank(2)];
      assert.deepEqual(chipReps(sets), [6, 6, 6]);
      // The dial, set by set as planned, agrees.
      const dial = [];
      let walk = sets.map((item) => ({ ...item }));
      for (const item of walk) {
        const target = resolveGuidedSetTarget(walk, item.setIndex, 'load_and_reps');
        dial.push(target.reps);
        walk = walk.map((other) => (other.setIndex === item.setIndex ? { ...other, status: 'completed', actualReps: target.reps, actualLoadKg: target.loadKg } : other));
      }
      assert.deepEqual(dial, [6, 6, 6]);
    },
  },
  {
    name: 'hunt 12 A11-2: a set past last time\'s ramp carries the ramp\'s last set on the chips (10/8/6/6, not 10/8/6/10)',
    run() {
      const ramp = [
        set(0, { plannedLoadKg: 40, draftLoadText: '40', plannedRepsMin: 5, plannedRepsMax: 10, rampTargetReps: 10 }),
        set(1, { plannedLoadKg: 50, draftLoadText: '50', plannedRepsMin: 5, plannedRepsMax: 10, rampTargetReps: 8 }),
        set(2, { plannedLoadKg: 60, draftLoadText: '60', plannedRepsMin: 5, plannedRepsMax: 10, rampTargetReps: 6 }),
        blank(3, { plannedRepsMin: 5, plannedRepsMax: 10 }),
      ];
      assert.deepEqual(chipReps(ramp), [10, 8, 6, 6]);
      // From the middle of the ramp, too.
      const midway = ramp.map((item) => (item.setIndex === 0 ? { ...item, status: 'completed', actualReps: 10, actualLoadKg: 40 } : item));
      assert.deepEqual(resolveGuidedSetPlan(midway, 1, 'load_and_reps').map((chip) => chip.reps), [10, 8, 6, 6]);
    },
  },
  {
    name: 'hunt 12 P0-1: a set logged over a lowered target still moves the sets after it, and a skipped set does not break the chain',
    run() {
      const over = [
        set(0, { plannedTargetReps: 6, status: 'completed', actualReps: 8, actualLoadKg: 60 }),
        set(1, { plannedTargetReps: 6 }),
        blank(2),
      ];
      assert.deepEqual(resolveGuidedSetPlan(over, 1, 'load_and_reps').map((chip) => chip.reps), [8, 8, 8]);
      const skipped = [set(0, { plannedTargetReps: 6 }), set(1, { plannedTargetReps: 6, status: 'skipped' }), blank(2)];
      assert.deepEqual(chipReps(skipped), [6, null, 6]);
      // Bodyweight: the gate's raised target carries to a set with none of its own.
      const bodyweight = [
        set(0, { plannedRepsMin: 8, plannedRepsMax: 12, plannedTargetReps: 13, draftLoadText: '' }),
        set(1, { plannedRepsMin: 8, plannedRepsMax: 12, plannedTargetReps: 13, draftLoadText: '' }),
        blank(2, { plannedRepsMin: 8, plannedRepsMax: 12 }),
      ];
      assert.deepEqual(chipReps(bodyweight, 'bodyweight'), [13, 13, 13]);
    },
  },
  {
    name: 'hunt 12 A11-1: the TODAY arrow compares today\'s sets with the same sets last time',
    run() {
      const { guidedLastLoadKg, guidedLoadTrend } = row;
      assert.equal(typeof guidedLastLoadKg, 'function');
      const today = (count, extra = []) => Array.from({ length: count }, (_, index) => ({ status: extra[index] ?? 'pending' }));
      const trend = (lastLoads, todaySets, todayKg) =>
        guidedLoadTrend({ lastKg: guidedLastLoadKg(lastLoads.map((loadKg) => ({ loadKg, reps: 8 })), todaySets), todayKg, progressionOn: true });
      // Last time added a heavier 4th set; today's three are AUTO +2.5.
      assert.equal(trend([60, 60, 60, 70], today(3), 62.5), 'up');
      assert.equal(trend([60, 60, 60, 65], today(3), 60), null);
      // A programme of two against last time's four.
      assert.equal(trend([60, 60, 60, 70], today(2), 60), null);
      // A lightened pyramid drops its top set and holds the loads.
      assert.equal(trend([40, 50, 60], today(2), 50), null);
      // A set skipped today is not compared either.
      assert.equal(trend([40, 50, 60], today(3, ['pending', 'pending', 'skipped']), 50), null);
      // Unchanged where the sets were the same sets.
      assert.equal(trend([60, 60, 60], today(3), 62.5), 'up');
      assert.equal(trend([60, 60, 60], today(3), 57.5), 'down');
      // A set added today reaches last time's sets as far as they go.
      assert.equal(guidedLastLoadKg([{ loadKg: 60, reps: 8 }], today(3)), 60);
      assert.equal(guidedLastLoadKg([], today(3)), null);
      assert.equal(guidedLastLoadKg(null, today(3)), null);
    },
  },
  {
    name: 'hunt 12 A11-1: the screen reads last time\'s weight for the arrow through guidedLastLoadKg',
    run() {
      const block = between(playerSource, 'const todayTrend = guidedLoadTrend({', '});');
      assert.match(block, /lastKg: guidedLastLoadKg\(panels\?\.history\?\.sets, liftSets\)/);
      assert.doesNotMatch(block, /heaviestOf/);
    },
  },
  {
    name: 'hunt 12 A2-5/A3-2: the reps label shows a target only where it falls outside the programme range',
    run() {
      const { planRepsBounds, formatGuidedRepsLabel } = guided;
      assert.deepEqual(planRepsBounds({ plannedRepsMin: 8, plannedRepsMax: 12, plannedTargetReps: 13 }), { min: 13, max: 13 });
      assert.deepEqual(planRepsBounds({ plannedRepsMin: 8, plannedRepsMax: 12, plannedTargetReps: 6 }), { min: 6, max: 6 });
      assert.deepEqual(planRepsBounds({ plannedRepsMin: 8, plannedRepsMax: 12, plannedTargetReps: 11 }), { min: 8, max: 12 });
      assert.deepEqual(planRepsBounds({ plannedRepsMin: 8, plannedRepsMax: 12 }), { min: 8, max: 12 });
      assert.deepEqual(planRepsBounds({ plannedRepsMin: 8, plannedRepsMax: 8, plannedTargetReps: 9 }), { min: 9, max: 9 });
      assert.equal(formatGuidedRepsLabel({ plannedRepsMin: 8, plannedRepsMax: 12, plannedTargetReps: 13 }), '13');
      assert.equal(formatGuidedRepsLabel({ plannedRepsMin: 8, plannedRepsMax: 12 }), '8–12');
      assert.equal(formatGuidedRepsLabel({ plannedRepsMin: 8, plannedRepsMax: 8 }), '8');
    },
  },
  {
    name: 'hunt 12 A2-5/A3-2: the overview label and the contents line both read planRepsBounds',
    run() {
      const label = between(playerSource, 'function formatRepRangeLabel(', '\n}\n');
      assert.match(label, /formatGuidedRepsLabel\(set\)/);
      const runPlan = between(playerSource, 'const runPlanLine = (slotId: string | null): string => {', '\n  };\n');
      assert.match(runPlan, /planRepsBounds\(planSet\)/);
      assert.doesNotMatch(runPlan, /isLoweredTarget/);
    },
  },
  {
    name: 'hunt 12 A11-3: the walk-up plan is per set for a ramp and names the programme for a lowered target, superset or not',
    run() {
      const { resolveGuidedWalkPlan } = guided;
      assert.equal(typeof resolveGuidedWalkPlan, 'function');
      const ramp = [
        set(0, { plannedLoadKg: 40, draftLoadText: '40', plannedRepsMin: 5, plannedRepsMax: 10, rampTargetReps: 10 }),
        set(1, { plannedLoadKg: 50, draftLoadText: '50', plannedRepsMin: 5, plannedRepsMax: 10, rampTargetReps: 8 }),
        set(2, { plannedLoadKg: 60, draftLoadText: '60', plannedRepsMin: 5, plannedRepsMax: 10, rampTargetReps: 6 }),
      ];
      assert.deepEqual(resolveGuidedWalkPlan(ramp, 'load_and_reps'), { kind: 'ramp', reps: [10, 8, 6] });
      assert.deepEqual(resolveGuidedWalkPlan([...ramp, blank(3, { plannedRepsMin: 5, plannedRepsMax: 10 })], 'load_and_reps').reps, [10, 8, 6, 6]);
      const lowered = [0, 1, 2].map((index) => set(index, { plannedTargetReps: 6 }));
      assert.deepEqual(resolveGuidedWalkPlan(lowered, 'load_and_reps'), { kind: 'lowered', reps: [6], programme: '8' });
      assert.deepEqual(resolveGuidedWalkPlan([0, 1, 2].map((index) => set(index)), 'load_and_reps'), { kind: 'plain', reps: [8] });
      // A raised bodyweight target is not "lowered": the plain line carries 13.
      const raised = [0, 1].map((index) => set(index, { plannedRepsMin: 8, plannedRepsMax: 12, plannedTargetReps: 13, draftLoadText: '' }));
      assert.deepEqual(resolveGuidedWalkPlan(raised, 'bodyweight'), { kind: 'plain', reps: [13] });
      assert.equal(resolveGuidedWalkPlan([], 'load_and_reps'), null);
    },
  },
  {
    name: 'hunt 12 A11-3: the superset walk-up has a ramp and a lowered line in both languages, and the screen picks them from the walk plan',
    run() {
      for (const language of ['en', 'fi']) {
        const rampLine = t(language, 'guided.walk.planSupersetRamp', { reps: '10/8/6', name: 'X' });
        assert.ok(rampLine.includes('10/8/6') && rampLine.includes('X'), `${language}: ${rampLine}`);
        const loweredLine = t(language, 'guided.walk.planSupersetLowered', { sets: 3, reps: 6, programme: '8', name: 'X' });
        assert.ok(['3', '6', '8', 'X'].every((part) => loweredLine.includes(part)), `${language}: ${loweredLine}`);
        assert.ok(!/\{/.test(rampLine + loweredLine), `${language}: unfilled placeholder`);
      }
      const walk = between(playerSource, 'const walkNext = (() => {', '})();');
      assert.match(walk, /resolveGuidedWalkPlan\(/);
      assert.match(walk, /guided\.walk\.planSupersetRamp/);
      assert.match(walk, /guided\.walk\.planSupersetLowered/);
      // The reps are not worked out in the screen any more.
      assert.doesNotMatch(walk, /rampTargetReps/);
      assert.doesNotMatch(walk, /isLoweredTarget/);
    },
  },
  {
    name: 'hunt 12 A6-2: a set taken back below the swap line and logged again as the new lift carries to the next set',
    run() {
      const lift = { exerciseName: 'Incline Dumbbell Press', sourceExerciseName: 'Bench Press', swappedAfterSetIndex: 1, trackingMode: 'load_and_reps' };
      const incline = { exerciseName: 'Incline Dumbbell Press', trackingMode: 'load_and_reps' };
      const bench = { exerciseName: 'Bench Press', trackingMode: 'load_and_reps' };
      const sets = [
        set(0, { plannedRepsMin: 8, plannedRepsMax: 12, plannedLoadKg: 62.5, draftLoadText: '30', status: 'completed', actualLoadKg: 30, actualReps: 10, loggedAs: incline }),
        set(1, { plannedRepsMin: 8, plannedRepsMax: 12, plannedLoadKg: 62.5, draftLoadText: '62.5', status: 'completed', actualLoadKg: 62.5, actualReps: 12, loggedAs: bench }),
        blank(2, { plannedRepsMin: 8, plannedRepsMax: 12 }),
        blank(3, { plannedRepsMin: 8, plannedRepsMax: 12 }),
      ];
      const target = resolveGuidedSetTarget(sets, 2, 'load_and_reps', 1, lift);
      assert.equal(target.loadKg, 30);
      assert.equal(target.reps, 10);
      // The bench set above the new lift's set is still never its carry source.
      const onlyBench = sets.map((item) => (item.setIndex === 0 ? blank(0, { plannedRepsMin: 8, plannedRepsMax: 12, status: 'skipped' }) : item));
      const fromBench = resolveGuidedSetTarget(onlyBench, 2, 'load_and_reps', 1, lift);
      assert.equal(fromBench.loadKg, null);
      assert.equal(fromBench.reps, 12);
      // The chips and today's weight read the same carry.
      assert.deepEqual(resolveGuidedSetPlan(sets, 2, 'load_and_reps', 1, lift).map((chip) => chip.reps), [10, 12, 10, 10]);
      assert.match(playerSource, /resolveGuidedSetTarget\(\s*exercise\.sets,\s*setIndex,\s*exercise\.trackingMode,\s*exercise\.swappedAfterSetIndex,\s*exercise,\s*\)/);
    },
  },
];
