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
];
