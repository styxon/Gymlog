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

  // ── A1-2 (owner Q7): one Helsinki calendar date is one session ───────────
  {
    name: 'hunt12 Q7: two sessions on one Helsinki date are one session for the gate',
    run() {
      inHelsinki(() => {
        const nowMs = Date.parse(at(2026, 10, 13, 12));
        const gate = (history, level) =>
          evaluateProgression({ history, repsMin: 6, repsMax: 10, targetSets: 3, level, nowMs });
        const ceiling = (iso) => entry(iso, [10, 10, 10], 60);

        // Beginner: morning and evening of 12.10. are one session, short of two.
        assert.equal(gate([ceiling(at(2026, 10, 12, 18)), ceiling(at(2026, 10, 12, 8))], 'beginner').recommendation, 'silent');
        // Stored the other way round, the same answer.
        assert.equal(gate([ceiling(at(2026, 10, 12, 8)), ceiling(at(2026, 10, 12, 18))], 'beginner').recommendation, 'silent');
        // A week before makes the second.
        assert.equal(
          gate([ceiling(at(2026, 10, 12, 18)), ceiling(at(2026, 10, 12, 8)), ceiling(at(2026, 10, 5, 18))], 'beginner')
            .recommendation,
          'increase',
        );

        // Advanced: three on one date, three on two dates — short of three sessions.
        assert.equal(
          gate([ceiling(at(2026, 10, 12, 20)), ceiling(at(2026, 10, 12, 14)), ceiling(at(2026, 10, 12, 8))], 'advanced')
            .recommendation,
          'silent',
        );
        assert.equal(
          gate([ceiling(at(2026, 10, 12, 18)), ceiling(at(2026, 10, 12, 8)), ceiling(at(2026, 10, 5, 18))], 'advanced')
            .recommendation,
          'silent',
        );
        assert.equal(
          gate([ceiling(at(2026, 10, 12, 18)), ceiling(at(2026, 10, 8, 18)), ceiling(at(2026, 10, 5, 18))], 'advanced')
            .recommendation,
          'increase',
        );

        // Either side of midnight is two dates: 12.10. 23:30 and 13.10. 00:30.
        assert.equal(gate([ceiling(at(2026, 10, 13, 0, 30)), ceiling(at(2026, 10, 12, 23, 30))], 'beginner').recommendation, 'increase');
      });
    },
  },
  {
    name: 'hunt12 Q7: the 25-hour day of 25.10.2026 is one date, and a session belongs to the date it finished on',
    run() {
      inHelsinki(() => {
        const nowMs = Date.parse(at(2026, 10, 26, 12));
        const gate = (history) =>
          evaluateProgression({ history, repsMin: 6, repsMax: 10, targetSets: 3, level: 'beginner', nowMs });
        const ceiling = (iso, extra) => entry(iso, [10, 10, 10], 60, extra);

        // 00:30 is still summer time (21:30Z the day before), 23:30 is winter
        // time: 23 hours on the wall clock, 24 elapsed, two UTC dates, one
        // Helsinki date.
        const early = at(2026, 10, 25, 0, 30);
        const late = at(2026, 10, 25, 23, 30);
        assert.equal(Date.parse(late) - Date.parse(early), 24 * 3600000);
        assert.notEqual(early.slice(0, 10), late.slice(0, 10));
        assert.equal(gate([ceiling(late), ceiling(early)]).recommendation, 'silent');
        // 24.10. 23:30 and 25.10. 00:30 are two dates across the change.
        assert.equal(gate([ceiling(early), ceiling(at(2026, 10, 24, 23, 30))]).recommendation, 'increase');

        // Started 24.10. 23:40, finished 25.10. 00:20: filed on 25.10.
        const pastMidnight = ceiling(at(2026, 10, 25, 0, 20), { startedAt: at(2026, 10, 24, 23, 40) });
        assert.equal(gate([ceiling(late), pastMidnight]).recommendation, 'silent');
        assert.equal(gate([pastMidnight, ceiling(at(2026, 10, 24, 18))]).recommendation, 'increase');
      });
    },
  },
  {
    name: 'hunt12 Q7: the newest session of the day represents it; the bodyweight reps gate counts days too',
    run() {
      inHelsinki(() => {
        const nowMs = Date.parse(at(2026, 10, 13, 12));
        const base = { repsMin: 6, repsMax: 10, targetSets: 3, level: 'beginner', nowMs };
        // Morning at the ceiling, evening short: the evening is the day.
        const decision = evaluateProgression({
          ...base,
          history: [
            entry(at(2026, 10, 12, 18), [10, 10, 7], 60),
            entry(at(2026, 10, 12, 8), [10, 10, 10], 60),
            entry(at(2026, 10, 5, 18), [10, 10, 10], 60),
          ],
        });
        assert.equal(decision.recommendation, 'hold');
        assert.equal(decision.holdReason, 'rep_ceiling_not_reached');

        // Bodyweight: two 13/13/13 on one date are one session for a beginner.
        const reps = resolveProgressedReps({
          history: [entry(at(2026, 10, 12, 18), [13, 13, 13], 0), entry(at(2026, 10, 12, 8), [13, 13, 13], 0)],
          templateTargetReps: 12,
          targetSets: 3,
          level: 'beginner',
          trackingMode: 'bodyweight',
          automatedProgressionEnabled: true,
          nowMs,
        });
        assert.equal(reps.progressed, false);
      });
    },
  },

  // ── A1-6: the completion-rate hold could never fire ──────────────────────
  {
    name: 'hunt12 A1-6: the gate holds only on reasons it can reach; no low_completion_rate left in src',
    run() {
      const reached = new Set();
      for (const level of ['beginner', 'advanced']) {
        for (let targetSets = 1; targetSets <= 12; targetSets += 1) {
          for (let logged = 1; logged <= 20; logged += 1) {
            const reps = Array.from({ length: logged }, () => 10);
            const decision = evaluateProgression({
              history: [entry(ago(0), reps, 60), entry(ago(3), reps, 60), entry(ago(6), reps, 60)],
              repsMin: 6,
              repsMax: 10,
              targetSets,
              level,
              nowMs: NOW_UTC,
            });
            reached.add(decision.recommendation === 'hold' ? decision.holdReason : decision.recommendation);
          }
        }
      }
      assert.deepEqual([...reached].sort(), ['increase', 'insufficient_sets']);

      const walk = (dir, out = []) => {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, item.name);
          if (item.isDirectory()) walk(full, out);
          else if (/\.tsx?$/.test(item.name)) out.push(full);
        }
        return out;
      };
      const root = path.join(__dirname, '..', '..');
      const offenders = [...walk(path.join(root, 'src')), path.join(root, 'App.tsx')].filter((file) =>
        /low_completion_rate|MIN_COMPLETION_RATE/.test(fs.readFileSync(file, 'utf8')),
      );
      assert.deepEqual(offenders.map((file) => path.relative(root, file)), []);
    },
  },

  // ── A4-1 + A4-2: a set added mid-session is not last time's reference ────
  {
    name: 'hunt12 A4: warm-ups are inferred among the programme sets only; added sets follow them',
    run() {
      const mark = (built, ...indices) => ({
        ...built,
        sets: built.sets.map((set) => (indices.includes(set.setIndex) ? { ...set, addedMidSession: true } : set)),
      });

      // 3 x 60 as asked, then a heavy 90 added: nothing is a warm-up.
      const heavyAdded = mark(entry(ago(0), [8, 8, 8, 5], [60, 60, 60, 90]), 3);
      const read = toWorkingHistoryEntry(heavyAdded, 3);
      assert.deepEqual(loadsOf(read.sets), [60, 60, 60, 90]);
      assert.deepEqual(read.sets.map((set) => set.setIndex), [0, 1, 2, 3]);

      // A ramp of four with a 100 added on top keeps its four rungs.
      const rampAdded = mark(entry(ago(0), [5, 5, 5, 5, 5], [60, 70, 80, 90, 100]), 4);
      assert.deepEqual(loadsOf(toWorkingHistoryEntry(rampAdded, 4).sets), [60, 70, 80, 90, 100]);

      // Unmarked (legacy, or nothing added): read exactly as before.
      const legacy = entry(ago(0), [8, 8, 8, 8], [40, 60, 100, 100]);
      assert.deepEqual(loadsOf(toWorkingHistoryEntry(legacy, 3).sets), [100, 100]);
      assert.equal(toWorkingHistoryEntry(entry(ago(0), [8, 8, 8], 60), 3).sets.length, 3);

      // Inference still runs over the programme sets when they ran over.
      const overAndAdded = mark(entry(ago(0), [8, 8, 8, 8, 5], [40, 100, 100, 100, 120]), 4);
      const overRead = toWorkingHistoryEntry(overAndAdded, 3);
      assert.deepEqual(loadsOf(overRead.sets), [100, 100, 100, 120]);
      assert.deepEqual(overRead.sets.map((set) => set.setIndex), [0, 1, 2, 3]);
      assert.equal(overRead.sets[3].addedMidSession, true);

      // The documented cost: a warm-up logged as set 1 and made up with an
      // added set is not inferred (exact programme count, as A4-5).
      const madeUp = mark(entry(ago(0), [10, 8, 8, 8], [30, 60, 60, 60]), 3);
      assert.deepEqual(loadsOf(toWorkingHistoryEntry(madeUp, 3).sets), [30, 60, 60, 60]);
    },
  },
  {
    name: 'hunt12 A4: last time with a heavy added set opens the programme sets on their own loads',
    run() {
      const exercise = {
        id: 'e_bp',
        exerciseName: 'Barbell Bench Press',
        slotId: 'bp',
        role: 'primary',
        progressionPriority: 'high',
        trackingMode: 'load_and_reps',
        sets: 3,
        repsMin: 8,
        repsMax: 8,
        restSecondsMin: 90,
        restSecondsMax: 120,
        substitutionGroup: 'press',
      };
      const template = {
        id: 'tpl',
        name: 'Push',
        defaultScheduleMode: 'weekly',
        sessions: [{ id: 'day_a', name: 'Push', orderIndex: 0, exercises: [exercise] }],
      };
      const nowMs = Date.parse('2026-10-10T09:00:00.000Z');
      const empty = {
        activeSession: null,
        completionSummary: null,
        history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
        nowMs: 0,
      };
      const start = (state, automatedProgressionEnabled) =>
        workoutReducer(state, {
          type: 'session/startFromRuntimeTemplate',
          payload: {
            template,
            sessionOrderIndex: 0,
            unitPreference: 'kg',
            progression: { automatedProgressionEnabled, setupLevel: 'beginner', nowMs },
          },
        });
      const slotId = start(empty, false).activeSession.exercises[0].slotId;
      const last = entry('2026-10-07T09:00:00.000Z', [8, 8, 8, 5], [60, 60, 60, 90], {
        slotId,
        exerciseName: 'Barbell Bench Press',
      });
      last.sets[3] = { ...last.sets[3], addedMidSession: true };
      const state = { ...empty, history: { ...empty.history, slotHistory: { [slotId]: [last] } } };
      for (const pro of [false, true]) {
        const sets = start(state, pro).activeSession.exercises[0].sets;
        assert.deepEqual(sets.map((set) => set.draftLoadText), ['60', '60', '60'], `pro ${pro}`);
      }
    },
  },
];
