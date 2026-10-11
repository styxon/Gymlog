/**
 * Progression hunt 12 (2026-10-11), the gate's half: loads within one dial
 * step are the same load (owner Q6), one Helsinki calendar date is one
 * session (owner Q7), a set added mid-session is never last time's reference,
 * a held bodyweight lift repeats the reps it proved, the ramp rule's edges,
 * and the break gap read to the session's start.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const L = '../../.test-dist/lib/';
const {
  evaluateProgression,
  resolveMissedRepsTarget,
  resolveProgressedLoadKg,
  resolveProgressedReps,
  resolveRampSetTarget,
} = require(L + 'progressionGate.js');
const { SAME_LOAD_TOLERANCE_KG, gatingSets, toWorkingHistoryEntry } = require(L + 'warmupSets.js');
const { workoutReducer } = require('../../.test-dist/features/workout/workoutState.js');

/** Runs `body` with the device clock in Helsinki, as the phone's is. */
function inHelsinki(body) {
  const original = process.env.TZ;
  process.env.TZ = 'Europe/Helsinki';
  try {
    body();
  } finally {
    if (original === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = original;
    }
  }
}

/** Local wall-clock time, read in whatever TZ is set when it is called. */
const at = (year, month, day, hour, minute = 0) => new Date(year, month - 1, day, hour, minute).toISOString();

/** A slot history entry; `load` is one load for every set or a list per set. */
function entry(iso, reps, load, extra = {}) {
  const loads = Array.isArray(load) ? load : reps.map(() => load);
  return {
    slotId: 's',
    templateId: 't',
    templateName: 'T',
    exerciseName: 'Bench Press',
    substitutionGroup: '',
    performedAt: iso,
    sessionId: `${iso}-${reps.join('.')}`,
    skipped: false,
    sets: reps.map((count, setIndex) => ({
      setIndex,
      loadKg: loads[setIndex],
      reps: count,
      completedAt: iso,
      effort: null,
    })),
    ...extra,
  };
}

const NOW_UTC = Date.parse('2026-07-28T09:00:00.000Z');
/** A UTC instant `daysAgo` before NOW_UTC, 3+ days apart: never one local date. */
const ago = (daysAgo) => new Date(NOW_UTC - daysAgo * 86400000).toISOString();

const loadsOf = (sets) => sets.map((set) => set.loadKg);

module.exports = [
  // ── A1-1 (owner Q6): confirmation accepts loads within one dial step ─────
  {
    name: 'hunt12 Q6: an intermediate confirms on a session one dial step off the newest',
    run() {
      assert.equal(SAME_LOAD_TOLERANCE_KG, 1.25);
      const gate = (loads) =>
        evaluateProgression({
          history: loads.map((load, index) => entry(ago(index * 3), [8, 8, 8], load)),
          repsMin: 6,
          repsMax: 8,
          targetSets: 3,
          level: 'advanced',
          nowMs: NOW_UTC,
        });

      const nudgedNewest = gate([61.25, 60, 60]);
      assert.equal(nudgedNewest.recommendation, 'increase');
      assert.equal(nudgedNewest.fromLoadKg, 61.25);
      assert.equal(nudgedNewest.loadKg, 63.75);

      const nudgedMiddle = gate([60, 61.25, 60]);
      assert.equal(nudgedMiddle.recommendation, 'increase');
      assert.equal(nudgedMiddle.fromLoadKg, 60);
      assert.equal(nudgedMiddle.loadKg, 62.5);

      // 58.75 is past one step of 61.25, but the two before it are enough.
      assert.equal(gate([61.25, 60, 58.75]).recommendation, 'increase');

      // A between-sessions step (2.5 kg) is a different load: no confirmation.
      const stepped = gate([62.5, 60, 60]);
      assert.equal(stepped.recommendation, 'hold');
      assert.equal(stepped.holdReason, 'awaiting_confirmation');

      // The boundary: one step counts, a hair past it does not.
      assert.equal(gate([61.25, 60, 50]).recommendation, 'increase');
      const pastStep = gate([61.3, 60, 60]);
      assert.equal(pastStep.recommendation, 'hold');
      assert.equal(pastStep.holdReason, 'awaiting_confirmation');
    },
  },

  // ── A1-5: a one-step nudge on set 1 does not make the rest a back-off ────
  {
    name: 'hunt12 A1-5: 61.25 x 10 then 60 x 7, 60 x 6 holds every set; a real drop is still exempt',
    run() {
      assert.deepEqual(
        loadsOf(gatingSets(entry(ago(0), [10, 7, 6], [61.25, 60, 60]).sets)),
        [61.25, 60, 60],
      );
      assert.deepEqual(loadsOf(gatingSets(entry(ago(0), [10, 7, 6], [62.5, 61.25, 60]).sets)), [62.5, 61.25]);
      assert.deepEqual(loadsOf(gatingSets(entry(ago(0), [10, 7, 6], [80, 75, 70]).sets)), [80]);
      assert.deepEqual(loadsOf(gatingSets(entry(ago(0), [10, 7], [62.5, 60]).sets)), [62.5]);

      const base = { repsMin: 6, repsMax: 10, targetSets: 3, level: 'beginner', nowMs: NOW_UTC };
      const nudged = [entry(ago(0), [10, 7, 6], [61.25, 60, 60]), entry(ago(3), [10, 10, 10], 60)];
      const decision = evaluateProgression({ ...base, history: nudged });
      assert.equal(decision.recommendation, 'hold');
      assert.equal(decision.holdReason, 'rep_ceiling_not_reached');
      const opens = nudged[0].sets.map((set) =>
        resolveProgressedLoadKg({
          ...base,
          history: nudged,
          automatedProgressionEnabled: true,
          fallbackLoadKg: set.loadKg,
          fallbackReps: set.reps,
        }),
      );
      assert.deepEqual(opens.map((open) => open.loadKg), [61.25, 60, 60]);
      assert.deepEqual(opens.map((open) => open.progressed), [false, false, false]);

      // Control: a real back-off after the top set stays exempt (rule 8).
      const dropped = [entry(ago(0), [10, 7, 6], [80, 60, 60]), entry(ago(3), [10, 10, 10], [80, 60, 60])];
      assert.equal(evaluateProgression({ ...base, history: dropped }).recommendation, 'increase');
      const droppedOpens = dropped[0].sets.map((set) =>
        resolveProgressedLoadKg({
          ...base,
          history: dropped,
          automatedProgressionEnabled: true,
          fallbackLoadKg: set.loadKg,
          fallbackReps: set.reps,
        }),
      );
      assert.deepEqual(droppedOpens.map((open) => open.loadKg), [82.5, 62.5, 62.5]);

      // The drop-below-the-floor exemption reads the same "same load": a set
      // one step under the top is the working load, not a drop that keeps its own.
      const earned = [entry(ago(0), [10, 10, 10], 61.25), entry(ago(3), [10, 10, 10], 61.25)];
      const oneStepUnder = resolveProgressedLoadKg({
        ...base,
        history: earned,
        automatedProgressionEnabled: true,
        fallbackLoadKg: 60,
        fallbackReps: 5,
      });
      assert.equal(oneStepUnder.loadKg, 62.5);
      assert.equal(oneStepUnder.progressed, true);
      const realDrop = resolveProgressedLoadKg({
        ...base,
        history: earned,
        automatedProgressionEnabled: true,
        fallbackLoadKg: 57.5,
        fallbackReps: 5,
      });
      assert.equal(realDrop.loadKg, 57.5);
      assert.equal(realDrop.progressed, false);
    },
  },
];
