const assert = require('node:assert/strict');

const {
  PROGRESSION_LEVEL_PARAMS,
  evaluateProgression,
  getProgressionTier,
  isProgressionReadySession,
  resolveProgressedLoadKg,
  toProgressionFatigueSignal,
} = require('../../.test-dist/lib/progressionGate.js');

const DAY_MS = 86400000;
const NOW = Date.parse('2026-07-28T09:00:00.000Z');

/** Newest first, spaced 3 days apart unless told otherwise. */
function entry(loadKg, reps, daysAgo, overrides = {}) {
  const repsList = Array.isArray(reps) ? reps : [reps, reps, reps];
  return {
    slotId: 'slot',
    templateId: 'tpl',
    templateName: 'Push',
    exerciseName: 'Bench Press',
    substitutionGroup: 'press',
    performedAt: new Date(NOW - daysAgo * DAY_MS).toISOString(),
    sessionId: `s-${daysAgo}`,
    sets: repsList.map((count, setIndex) => ({
      setIndex,
      loadKg,
      reps: count,
      completedAt: new Date(NOW - daysAgo * DAY_MS).toISOString(),
    })),
    skipped: false,
    ...overrides,
  };
}

function gate(overrides = {}) {
  return evaluateProgression({
    history: [],
    repsMin: 8,
    repsMax: 12,
    targetSets: 3,
    level: 'beginner',
    ...overrides,
  });
}

module.exports = [
  {
    name: 'progression: the rep ceiling means ALL sets, not one',
    run() {
      // The spec's own worked example (progression-gating-rules.md §Core Model).
      assert.equal(isProgressionReadySession(entry(60, [10, 9, 8], 0), 12, 3), false);
      assert.equal(isProgressionReadySession(entry(60, [12, 11, 9], 0), 12, 3), false);
      assert.equal(isProgressionReadySession(entry(60, [12, 12, 11], 0), 12, 3), false);
      assert.equal(isProgressionReadySession(entry(60, [12, 12, 12], 0), 12, 3), true);
    },
  },
  {
    name: 'progression: a beginner moves after one ceiling session, at 2.5 kg',
    run() {
      const decision = gate({
        history: [entry(60, 12, 0), entry(60, [12, 11, 10], 3)],
        level: 'beginner',
      });

      assert.equal(decision.recommendation, 'increase');
      assert.equal(decision.fromLoadKg, 60);
      assert.equal(decision.loadKg, 62.5);
      assert.equal(decision.incrementKg, 2.5);
    },
  },
  {
    name: 'progression: an intermediate needs a second confirming session',
    run() {
      const once = gate({
        history: [entry(60, 12, 0), entry(60, [12, 11, 10], 3), entry(60, 10, 6)],
        level: 'advanced',
      });
      assert.equal(once.recommendation, 'hold');
      assert.equal(once.holdReason, 'awaiting_confirmation');

      const twice = gate({
        history: [entry(60, 12, 0), entry(60, 12, 3), entry(60, 10, 6)],
        level: 'advanced',
      });
      assert.equal(twice.recommendation, 'increase');
      // Slower to move, but the same step: 1.25 kg is 0.625 kg a side, which
      // standard plates cannot build (user decision 2026-09-28).
      assert.equal(twice.incrementKg, 2.5);
      assert.equal(twice.loadKg, 62.5);
    },
  },
  {
    name: 'progression: confirmation only counts sessions at the same load',
    run() {
      // A lighter session that hit the ceiling proves nothing about 60 kg.
      const decision = gate({
        history: [entry(60, 12, 0), entry(50, 12, 3), entry(50, 12, 6)],
        level: 'advanced',
      });

      assert.equal(decision.recommendation, 'hold');
      assert.equal(decision.holdReason, 'awaiting_confirmation');
    },
  },
  {
    name: 'progression: fatigue is a hard block that outranks a clean ceiling',
    run() {
      const perfect = [entry(60, 12, 0), entry(60, 12, 3)];

      assert.equal(gate({ history: perfect, fatigueSignal: 'high' }).holdReason, 'fatigue_high');
      assert.equal(gate({ history: perfect, fatigueSignal: 'elevated' }).holdReason, 'fatigue_elevated');
      // Undefined counts as clear, exactly as the spec's T11 words it.
      assert.equal(gate({ history: perfect }).recommendation, 'increase');
      assert.equal(gate({ history: perfect, fatigueSignal: 'normal' }).recommendation, 'increase');
    },
  },
  {
    name: 'progression: a session after a break never adds load',
    run() {
      // A missed week of a weekly lift.
      const decision = gate({ history: [entry(60, 12, 0), entry(60, 12, 14)] });

      assert.equal(decision.recommendation, 'hold');
      assert.equal(decision.holdReason, 'gap_return');
      assert.equal(decision.loadKg, 60, 'the hold still tells the logger what to repeat');

      // The edge: ten calendar days is a break, nine is not.
      assert.equal(gate({ history: [entry(60, 12, 0), entry(60, 12, 10)] }).holdReason, 'gap_return');
      assert.equal(gate({ history: [entry(60, 12, 0), entry(60, 12, 9)] }).recommendation, 'increase');
    },
  },
  {
    // Bug hunt 2026-10-09: slot history is kept per programme day, so a weekly
    // programme's lift is 7 days from its last session every time. At a 7-day
    // break the jump was held whenever this week's finish came a few minutes
    // later in the day than last week's — about every other week.
    name: 'progression: a lift trained once a week is on its cadence, not back from a break',
    run() {
      const weekly = [entry(60, 12, 0), entry(60, 12, 7), entry(60, 12, 14)];
      const jitter = [entry(60, 12, 0), entry(60, 12, 7 + 3 / 24), entry(60, 12, 14 - 2 / 24)];
      for (const history of [weekly, jitter]) {
        for (const level of ['beginner', 'advanced']) {
          const decision = gate({ history, level });
          assert.equal(decision.recommendation, 'increase', `${level}: ${JSON.stringify(decision)}`);
          assert.equal(decision.loadKg, 62.5);
        }
      }

      // The bodyweight rep gate reads the same rule.
      const { resolveProgressedReps } = require('../../.test-dist/lib/progressionGate.js');
      const reps = resolveProgressedReps({
        history: [entry(0, 12, 0), entry(0, 12, 7)],
        templateTargetReps: 12,
        targetSets: 3,
        level: 'beginner',
        trackingMode: 'bodyweight',
        automatedProgressionEnabled: true,
      });
      assert.equal(reps.progressed, true);
      assert.equal(reps.targetReps, 13);
    },
  },
  {
    name: 'progression: skipped or short sessions hold rather than progress',
    run() {
      const skipped = gate({
        history: [entry(60, 12, 0, { skipped: true }), entry(60, 12, 3)],
      });
      assert.equal(skipped.holdReason, 'set_skipped');

      // Two sets logged where the template asked for three.
      const short = gate({ history: [entry(60, [12, 12], 0), entry(60, 12, 3)] });
      assert.equal(short.holdReason, 'insufficient_sets');
    },
  },
  {
    name: 'progression: silence until there is enough baseline',
    run() {
      assert.equal(gate({ history: [entry(60, 12, 0)], level: 'beginner' }).recommendation, 'silent');
      assert.equal(
        gate({ history: [entry(60, 12, 0), entry(60, 12, 3)], level: 'advanced' }).recommendation,
        'silent',
      );
      // No rep range means nothing to evaluate against.
      assert.equal(gate({ history: [entry(60, 12, 0), entry(60, 12, 3)], repsMax: 0 }).recommendation, 'silent');
      assert.equal(gate({ history: [entry(60, 12, 0), entry(60, 12, 3)], targetSets: 0 }).recommendation, 'silent');
    },
  },
  {
    name: 'progression: bodyweight work never gets a load bump',
    run() {
      const decision = gate({
        history: [entry(0, 12, 0), entry(0, 12, 3)],
        trackingMode: 'bodyweight',
      });
      assert.equal(decision.recommendation, 'silent');
    },
  },
  {
    name: 'progression: the toggle is what decides whether the prefill moves',
    run() {
      const history = [entry(60, 12, 0), entry(60, 12, 3)];
      const shared = { history, repsMin: 8, repsMax: 12, targetSets: 3, level: 'beginner', fallbackLoadKg: 60 };

      // `fromLoadKg` is what the loggers show as "AUTO +2.5 kg" — a progressed
      // load has to be able to say where it came from.
      const on = resolveProgressedLoadKg({ ...shared, automatedProgressionEnabled: true });
      assert.deepEqual(on, { loadKg: 62.5, progressed: true, fromLoadKg: 60, heldForFatigue: false, heldForCautionArea: null });

      // OFF is exactly the old behaviour: repeat what was logged.
      const off = resolveProgressedLoadKg({ ...shared, automatedProgressionEnabled: false });
      assert.deepEqual(off, { loadKg: 60, progressed: false, fromLoadKg: null, heldForFatigue: false, heldForCautionArea: null });

      // ON but not earned still repeats — the toggle promises a rule, not a
      // weekly increase.
      const notEarned = resolveProgressedLoadKg({
        ...shared,
        history: [entry(60, [12, 11, 10], 0), entry(60, 12, 3)],
        automatedProgressionEnabled: true,
      });
      assert.deepEqual(notEarned, { loadKg: 60, progressed: false, fromLoadKg: null, heldForFatigue: false, heldForCautionArea: null });
    },
  },
  {
    name: 'progression: level tiers map the way the spec describes',
    run() {
      assert.equal(getProgressionTier('beginner'), 'beginner');
      assert.equal(getProgressionTier('advanced'), 'intermediate');
      assert.equal(getProgressionTier('pro'), 'intermediate');
      assert.equal(getProgressionTier(null), 'beginner');

      assert.equal(PROGRESSION_LEVEL_PARAMS.beginner.loadIncrementKg, 2.5);
      assert.equal(PROGRESSION_LEVEL_PARAMS.intermediate.loadIncrementKg, 2.5);
      assert.equal(PROGRESSION_LEVEL_PARAMS.beginner.requiredConsecutive, 1);
      assert.equal(PROGRESSION_LEVEL_PARAMS.intermediate.requiredConsecutive, 2);
      // Two sessions for a beginner, as the code has always done and the doc
      // now says (user decision 2026-09-28); three for everyone else.
      assert.equal(PROGRESSION_LEVEL_PARAMS.beginner.minSessions, 2);
      assert.equal(PROGRESSION_LEVEL_PARAMS.intermediate.minSessions, 3);
    },
  },
  {
    // User decision 2026-09-28: a beginner who beats the reps straight away
    // is offered more without waiting for a second session.
    name: 'progression: a beginner whose first session cleared the ceiling by two reps on every set moves now',
    run() {
      // The gate's ceiling here is 12.
      const clear = gate({ history: [entry(40, [14, 14, 14], 0)], level: 'beginner', nowMs: NOW + DAY_MS });
      assert.equal(clear.recommendation, 'increase');
      assert.equal(clear.loadKg, 42.5);

      // Recheck of #223: only off a recent session. Months old, or a week
      // back as the break rule counts it, the first session moves nothing —
      // and without a clock the gate does not guess.
      assert.equal(gate({ history: [entry(40, [14, 14, 14], 90)], level: 'beginner', nowMs: NOW }).recommendation, 'silent');
      assert.equal(gate({ history: [entry(40, [14, 14, 14], 10)], level: 'beginner', nowMs: NOW }).recommendation, 'silent');
      assert.equal(gate({ history: [entry(40, [14, 14, 14], 9)], level: 'beginner', nowMs: NOW }).recommendation, 'increase');
      // A weekly lift's second visit is a week after its first: recent, not a
      // break (bug hunt, 2026-10-09).
      assert.equal(gate({ history: [entry(40, [14, 14, 14], 7)], level: 'beginner', nowMs: NOW }).recommendation, 'increase');
      assert.equal(gate({ history: [entry(40, [14, 14, 14], 0)], level: 'beginner' }).recommendation, 'silent');

      // At the ceiling, or past it on only some sets: the baseline still waits.
      assert.equal(gate({ history: [entry(40, [12, 12, 12], 0)], level: 'beginner' }).recommendation, 'silent');
      assert.equal(gate({ history: [entry(40, [14, 14, 13], 0)], level: 'beginner' }).recommendation, 'silent');
      // Fewer sets than the programme asks: not proof the weight is light.
      assert.equal(gate({ history: [entry(40, [15, 15], 0)], level: 'beginner' }).recommendation, 'silent');
      // Third break round: a session dated ahead of now (a wrong phone clock)
      // is not "recent", and an entry with no sets is not a session — one real
      // session plus an empty entry does not meet the two-session baseline.
      assert.equal(gate({ history: [entry(40, [14, 14, 14], -3)], level: 'beginner', nowMs: NOW }).recommendation, 'silent');
      const emptyEntry = { ...entry(40, 12, 3), sets: [] };
      assert.equal(gate({ history: [entry(40, [12, 12, 12], 0), emptyEntry], level: 'beginner' }).recommendation, 'silent');
      // Only beginners.
      assert.equal(gate({ history: [entry(40, [16, 16, 16], 0)], level: 'advanced' }).recommendation, 'silent');
      // And the holds still come first: a fatigue signal wins.
      const tired = gate({ history: [entry(40, [14, 14, 14], 0)], level: 'beginner', fatigueSignal: 'high', nowMs: NOW });
      assert.equal(tired.recommendation, 'hold');
    },
  },
  {
    // Break round, 2026-09-28: a break across the spring clock change is an
    // hour short in elapsed time and was not read as one. The break is ten
    // days since 2026-10-09 (a weekly lift's week is its cadence); the clock
    // change still must not shorten it.
    name: 'progression: a break across the spring clock change is a break',
    run() {
      const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');
      withHelsinkiClocks(() => {
        // At the ceiling both times, so the break is the only reason to hold.
        const at = (iso) => ({ ...entry(40, 12, 0), performedAt: new Date(iso).toISOString() });
        // Ten calendar days, 9.96 of elapsed time.
        const decision = gate({
          history: [at('2026-03-29T10:00:00'), at('2026-03-19T10:00:00')],
          level: 'beginner',
        });
        assert.equal(decision.recommendation, 'hold');
        assert.equal(decision.holdReason, 'gap_return');

        // CI review of #223: counting midnights made 23:00 to 01:00 a few days
        // later a full count of days. Ten midnights here, barely nine days,
        // and not a break.
        const late = gate({
          history: [at('2026-05-11T01:00:00'), at('2026-05-01T23:00:00')],
          level: 'beginner',
        });
        assert.notEqual(late.holdReason, 'gap_return');
        assert.equal(late.recommendation, 'increase');
      });
    },
  },
  {
    name: 'recovery holds an earned load, and never on a guess',
    run() {
      // The ACWR model's four-way signal, narrowed to what the gate acts on.
      // 'undertrained' is room to add, not a reason to ease off.
      assert.equal(toProgressionFatigueSignal({ signal: 'high', confident: true }), 'high');
      assert.equal(toProgressionFatigueSignal({ signal: 'elevated', confident: true }), 'elevated');
      assert.equal(toProgressionFatigueSignal({ signal: 'optimal', confident: true }), 'normal');
      assert.equal(toProgressionFatigueSignal({ signal: 'undertrained', confident: true }), 'normal');

      // Confidence is the whole safety story. Chronic load is a 28-day total
      // over four, so ONE logged session reads as ACWR 4 — a confident "you
      // are far above your safe zone" built from a single workout. Below the
      // bar the gate must not ease off at all.
      assert.equal(toProgressionFatigueSignal({ signal: 'high', confident: false }), 'normal');
      assert.equal(toProgressionFatigueSignal(null), 'normal');
      assert.equal(toProgressionFatigueSignal(undefined), 'normal');
    },
  },
  {
    name: 'a fatigue hold keeps the weight and says so, but only when a jump was earned',
    run() {
      // Two sessions at 60 kg with every set at the ceiling: this one earned it.
      const earned = [entry(60, 12, 0), entry(60, 12, 3)];
      const base = {
        history: earned,
        repsMin: 8,
        repsMax: 12,
        targetSets: 3,
        level: 'beginner',
        automatedProgressionEnabled: true,
        fallbackLoadKg: 60,
      };

      const rested = resolveProgressedLoadKg({ ...base, fatigueSignal: 'normal' });
      assert.equal(rested.loadKg, 62.5);
      assert.equal(rested.heldForFatigue, false);

      // Cooked: the load stays and the set carries the reason. Without the
      // flag the hold is invisible, which is indistinguishable from the
      // feature not existing — which is what it was until it was wired up.
      for (const signal of ['elevated', 'high']) {
        const held = resolveProgressedLoadKg({ ...base, fatigueSignal: signal });
        assert.equal(held.loadKg, 60, signal);
        assert.equal(held.progressed, false, signal);
        assert.equal(held.heldForFatigue, true, signal);
      }

      // Fatigue is checked FIRST in the gate order, so a session that never
      // earned a jump also reports a fatigue hold. The badge must not claim
      // it: a high ACWR lasts weeks, so this would sit on every set of every
      // session while the app took credit for holding back a jump that was
      // never coming.
      const notEarned = resolveProgressedLoadKg({
        ...base,
        history: [entry(60, 9, 0), entry(60, 9, 3)],
        fatigueSignal: 'high',
      });
      assert.equal(notEarned.loadKg, 60);
      assert.equal(notEarned.heldForFatigue, false);

      // With progression off there is nothing to hold, so nothing to say.
      const free = resolveProgressedLoadKg({ ...base, automatedProgressionEnabled: false, fatigueSignal: 'high' });
      assert.equal(free.heldForFatigue, false);
      assert.equal(free.loadKg, 60);
    },
  },
  {
    name: 'a flagged area holds the load, and names itself only when a jump was earned',
    run() {
      const earned = [entry(60, 12, 0), entry(60, 12, 3)];
      const base = {
        history: earned,
        repsMin: 8,
        repsMax: 12,
        targetSets: 3,
        level: 'beginner',
        automatedProgressionEnabled: true,
        fallbackLoadKg: 60,
      };

      // Earned, and the lift loads a flagged area: the load stays, the area
      // is the reason given.
      const held = resolveProgressedLoadKg({ ...base, cautionArea: 'shoulders' });
      assert.deepEqual(held, {
        loadKg: 60,
        progressed: false,
        fromLoadKg: null,
        heldForFatigue: false,
        heldForCautionArea: 'shoulders',
      });

      // The area outranks recovery: it is the lasting reason, so it is the
      // one said, and the two badges never stack.
      const both = resolveProgressedLoadKg({ ...base, cautionArea: 'shoulders', fatigueSignal: 'high' });
      assert.equal(both.loadKg, 60);
      assert.equal(both.heldForCautionArea, 'shoulders');
      assert.equal(both.heldForFatigue, false);

      // Not earned: the load stays anyway, and nothing claims a hold.
      const notEarned = resolveProgressedLoadKg({
        ...base,
        history: [entry(60, 9, 0), entry(60, 9, 3)],
        cautionArea: 'shoulders',
      });
      assert.equal(notEarned.loadKg, 60);
      assert.equal(notEarned.heldForCautionArea, null);

      // Progression off: the load never moves, so there is no hold to name.
      const free = resolveProgressedLoadKg({ ...base, automatedProgressionEnabled: false, cautionArea: 'shoulders' });
      assert.equal(free.loadKg, 60);
      assert.equal(free.heldForCautionArea, null);

      // No flagged area: the ordinary jump.
      assert.equal(resolveProgressedLoadKg({ ...base, cautionArea: null }).loadKg, 62.5);
    },
  },
  {
    name: 'rep progression: bodyweight moves the target by one when it is earned',
    run() {
      const { resolveProgressedReps } = require('../../.test-dist/lib/progressionGate.js');
      const base = {
        templateTargetReps: 12,
        targetSets: 3,
        level: 'beginner',
        trackingMode: 'bodyweight',
        automatedProgressionEnabled: true,
      };

      // Cleared on every set → one more than the floor the user proved.
      const earned = resolveProgressedReps({ ...base, history: [entry(0, 12, 0), entry(0, [12, 11, 10], 3)] });
      assert.equal(earned.progressed, true);
      assert.equal(earned.fromReps, 12);
      assert.equal(earned.targetReps, 13);

      // Overshooting raises from the proven floor, not from the template:
      // 15-14-13 on a 12 target suggests 14, not 13.
      const overshoot = resolveProgressedReps({ ...base, history: [entry(0, [15, 14, 13], 0), entry(0, 12, 3)] });
      assert.equal(overshoot.progressed, true);
      assert.equal(overshoot.fromReps, 13);
      assert.equal(overshoot.targetReps, 14);

      // One set short of the target → the template target stands.
      const missed = resolveProgressedReps({ ...base, history: [entry(0, [12, 12, 11], 0), entry(0, 12, 3)] });
      assert.equal(missed.progressed, false);
      assert.equal(missed.targetReps, 12);
      assert.equal(missed.fromReps, null);

      // The same Pro-gated switch as the load: off means the old behaviour.
      const off = resolveProgressedReps({
        ...base,
        automatedProgressionEnabled: false,
        history: [entry(0, 12, 0), entry(0, 12, 3)],
      });
      assert.equal(off.progressed, false);
      assert.equal(off.targetReps, 12);
    },
  },
  {
    name: 'rep progression: only bodyweight — loads have the load gate, holds are seconds',
    run() {
      const { resolveProgressedReps } = require('../../.test-dist/lib/progressionGate.js');
      const history = [entry(0, 12, 0), entry(0, 12, 3)];
      for (const trackingMode of ['load_and_reps', 'reps_first', 'hold']) {
        const result = resolveProgressedReps({
          history,
          templateTargetReps: 12,
          targetSets: 3,
          level: 'beginner',
          trackingMode,
          automatedProgressionEnabled: true,
        });
        assert.equal(result.progressed, false, trackingMode);
        assert.equal(result.targetReps, 12, trackingMode);
      }
    },
  },
  {
    name: 'rep progression: fatigue holds an earned jump and says so, like the load gate',
    run() {
      const { resolveProgressedReps } = require('../../.test-dist/lib/progressionGate.js');
      const base = {
        history: [entry(0, 12, 0), entry(0, 12, 3)],
        templateTargetReps: 12,
        targetSets: 3,
        level: 'beginner',
        trackingMode: 'bodyweight',
        automatedProgressionEnabled: true,
      };

      const held = resolveProgressedReps({ ...base, fatigueSignal: 'high' });
      assert.equal(held.progressed, false);
      assert.equal(held.targetReps, 12);
      assert.equal(held.heldForFatigue, true);

      // Not earned → the fatigue hold is not the reason, so no claim.
      const notEarned = resolveProgressedReps({
        ...base,
        history: [entry(0, 9, 0), entry(0, 9, 3)],
        fatigueSignal: 'high',
      });
      assert.equal(notEarned.heldForFatigue, false);

      // A flagged area holds reps like it holds load: earned, kept, named.
      const flagged = resolveProgressedReps({ ...base, cautionArea: 'knees' });
      assert.equal(flagged.progressed, false);
      assert.equal(flagged.targetReps, 12);
      assert.equal(flagged.heldForCautionArea, 'knees');
      assert.equal(flagged.heldForFatigue, false);
      const flaggedNotEarned = resolveProgressedReps({
        ...base,
        history: [entry(0, 9, 0), entry(0, 9, 3)],
        cautionArea: 'knees',
      });
      assert.equal(flaggedNotEarned.heldForCautionArea, null);
      assert.equal(resolveProgressedReps({ ...base, cautionArea: null }).targetReps, 13);

      // An intermediate needs the confirming session for reps too.
      const once = resolveProgressedReps({
        ...base,
        level: 'advanced',
        history: [entry(0, 12, 0), entry(0, [12, 11, 10], 3), entry(0, 10, 6)],
      });
      assert.equal(once.progressed, false);
      const confirmed = resolveProgressedReps({
        ...base,
        level: 'advanced',
        history: [entry(0, 12, 0), entry(0, 12, 3), entry(0, 10, 6)],
      });
      assert.equal(confirmed.progressed, true);
      assert.equal(confirmed.targetReps, 13);
    },
  },
  {
    // User 2026-10-01, option A: a ramp keeps each set's reps and asks one
    // more of the heaviest; a straight session is the missed-reps rule's.
    name: 'resolveRampSetTarget: a climbing session reads set by set, the heaviest one more',
    run() {
      const { resolveRampSetTarget } = require('../../.test-dist/lib/progressionGate.js');
      const NOW = Date.parse('2026-10-01T12:00:00.000Z');
      const entry = (sets, performedAt = '2026-09-27T09:00:00.000Z') => ({
        performedAt,
        exerciseName: 'Bench Press',
        skipped: false,
        sets: sets.map(([loadKg, reps], setIndex) => ({ setIndex, loadKg, reps })),
      });
      const ramp = entry([[40, 10], [50, 8], [60, 5]]);
      const at = (e, setIndex, extra = {}) =>
        resolveRampSetTarget({ entry: e, setIndex, repsMax: 12, automatedProgressionEnabled: true, nowMs: NOW, ...extra });

      assert.deepEqual([0, 1, 2].map((index) => at(ramp, index)), [10, 8, 6]);
      // Two sets at the top weight both ask one more.
      assert.deepEqual([0, 1, 2].map((index) => at(entry([[50, 8], [60, 5], [60, 4]]), index)), [8, 6, 5]);
      // The top set at the ceiling holds there: the next step is weight, the reader's.
      assert.equal(at(entry([[40, 10], [60, 12]]), 1), 12);
      // One weight throughout is not a ramp — the missed-reps rule answers it.
      assert.equal(at(entry([[60, 6], [60, 6], [60, 7]]), 2), null);
      // Not reached last time, off, bodyweight, stale: nothing to say.
      assert.equal(at(ramp, 3), null);
      assert.equal(at(ramp, 2, { automatedProgressionEnabled: false }), null);
      assert.equal(at(ramp, 2, { trackingMode: 'bodyweight' }), null);
      assert.equal(at(entry([[40, 10], [60, 5]], '2026-05-01T09:00:00.000Z'), 1), null);
      assert.equal(at({ ...ramp, skipped: true }, 2), null);
      // A flagged area or a recovery hold repeats the top set, never adds.
      assert.equal(at(ramp, 2, { cautionArea: 'lower_back' }), 5);
      assert.equal(at(ramp, 2, { fatigueSignal: 'elevated' }), 5);
      assert.equal(at(ramp, 2, { fatigueSignal: 'normal' }), 6);
    },
  },
  {
    // Bug hunt 2026-10-09: 40×10 | 50×8 | 60×7 … 60×12 and then the same
    // numbers for good — only the top set's target rose, and the load gate
    // waits for every set up to it at the ceiling.
    name: 'resolveRampSetTarget: once the top set is at the ceiling, the lighter sets climb, and the ramp earns its jump',
    run() {
      const { resolveRampSetTarget } = require('../../.test-dist/lib/progressionGate.js');
      const RAMP_NOW = Date.parse('2026-10-09T12:00:00.000Z');
      const at = (sets, setIndex, extra = {}) =>
        resolveRampSetTarget({
          entry: { performedAt: '2026-10-06T09:00:00.000Z', exerciseName: 'Bench Press', skipped: false,
            sets: sets.map(([loadKg, reps], index) => ({ setIndex: index, loadKg, reps })) },
          setIndex,
          repsMax: 12,
          automatedProgressionEnabled: true,
          nowMs: RAMP_NOW,
          ...extra,
        });

      // Top set short of the ceiling: unchanged, the top set climbs alone.
      assert.deepEqual([0, 1, 2].map((i) => at([[40, 10], [50, 8], [60, 7]], i)), [10, 8, 8]);
      // Top set at the ceiling: the lighter sets ask one more, the top holds.
      assert.deepEqual([0, 1, 2].map((i) => at([[40, 10], [50, 8], [60, 12]], i)), [11, 9, 12]);
      // Never past the ceiling.
      assert.deepEqual([0, 1, 2].map((i) => at([[40, 12], [50, 11], [60, 12]], i)), [12, 12, 12]);
      // Every set at the top weight has to be there first.
      assert.deepEqual([0, 1, 2].map((i) => at([[50, 8], [60, 12], [60, 10]], i)), [8, 12, 11]);
      // A back-off after the heaviest is exempt from the gate, and repeats.
      assert.deepEqual([0, 1, 2].map((i) => at([[50, 8], [60, 12], [40, 9]], i)), [9, 12, 9]);
      // A flagged area or a recovery hold adds nothing anywhere.
      assert.equal(at([[40, 10], [50, 8], [60, 12]], 0, { cautionArea: 'lower_back' }), 10);
      assert.equal(at([[40, 10], [50, 8], [60, 12]], 0, { fatigueSignal: 'high' }), 10);

      // Followed session after session, the dials reach the gate's ceiling and
      // the load moves.
      let sets = [[40, 10], [50, 8], [60, 6]];
      const history = [];
      let jumped = false;
      for (let session = 0; session < 20 && !jumped; session += 1) {
        const daysAgo = 40 - session * 2;
        history.unshift(entry(0, 0, daysAgo, {
          sets: sets.map(([loadKg, reps], setIndex) => ({ setIndex, loadKg, reps, completedAt: '' })),
        }));
        const opens = sets.map(([loadKg], setIndex) => {
          const reps = resolveRampSetTarget({
            entry: history[0], setIndex, repsMax: 12, automatedProgressionEnabled: true, nowMs: NOW - (daysAgo - 1) * DAY_MS,
          });
          return [loadKg, reps];
        });
        const load = resolveProgressedLoadKg({
          history, repsMin: 8, repsMax: 12, targetSets: 3, level: 'beginner',
          automatedProgressionEnabled: true, fallbackLoadKg: 60, fallbackReps: 12,
        });
        jumped = load.progressed;
        sets = opens;
      }
      assert.equal(jumped, true, `the ramp stalled at ${JSON.stringify(sets)}`);
    },
  },
  {
    // Bug hunt 2026-10-09: a finished session files an entry with no sets for
    // every lift left pending or skipped. As the newest entry it silenced the
    // gate and dropped a jump already earned; as the one before, it hid a
    // five-week break from the break rule.
    name: 'progression: a visit that logged nothing is not a session — it neither drops a jump nor hides a break',
    run() {
      const pending = (daysAgo) => ({ ...entry(60, 12, daysAgo), sets: [] });
      const skipped = (daysAgo) => ({ ...entry(60, 12, daysAgo), sets: [], skipped: true });

      for (const empty of [pending, skipped]) {
        // Earned, then one visit with nothing logged: still earned.
        const beginner = gate({ history: [empty(1), entry(60, 12, 4), entry(60, 12, 7)], level: 'beginner' });
        assert.equal(beginner.recommendation, 'increase', JSON.stringify(beginner));
        assert.equal(beginner.loadKg, 62.5);
        // The confirmation count looks through it too.
        const confirmed = gate({ history: [empty(1), entry(60, 12, 4), entry(60, 12, 7), entry(60, 12, 10)], level: 'advanced' });
        assert.equal(confirmed.recommendation, 'increase', JSON.stringify(confirmed));
        const interleaved = gate({ history: [entry(60, 12, 0), empty(2), entry(60, 12, 4), entry(60, 12, 6)], level: 'advanced' });
        assert.equal(interleaved.recommendation, 'increase', JSON.stringify(interleaved));

        // The break is measured against the lift's last real session.
        const back = gate({ history: [entry(60, 12, 1), empty(3), entry(60, 12, 38)], level: 'beginner' });
        assert.equal(back.recommendation, 'hold');
        assert.equal(back.holdReason, 'gap_return');
      }

      // A skipped entry that did log sets still holds, as it always has.
      assert.equal(gate({ history: [entry(60, 12, 0, { skipped: true }), entry(60, 12, 3)] }).holdReason, 'set_skipped');

      // The bodyweight rep gate reads the same sessions, and climbs from the
      // newest real one.
      const { resolveProgressedReps } = require('../../.test-dist/lib/progressionGate.js');
      const reps = resolveProgressedReps({
        history: [pending(1), entry(0, 14, 3), entry(0, 12, 6)],
        templateTargetReps: 12,
        targetSets: 3,
        level: 'beginner',
        trackingMode: 'bodyweight',
        automatedProgressionEnabled: true,
      });
      assert.equal(reps.progressed, true);
      assert.equal(reps.targetReps, 15);
    },
  },
  {
    // Bug hunt 2026-10-09: 3 × 8 as asked plus a tired fourth set at the same
    // weight held the jump; a lighter fourth did not. The missed-reps rule
    // already says a set past the programme must not hold back a target every
    // programmed set met (review of #202).
    name: 'progression: a set past the programme count neither blocks a jump nor sets the load',
    run() {
      const asked = entry(60, [8, 8, 8], 3);
      const bonus = (load, reps) => entry(60, [8, 8, 8], 0, {
        sets: [...entry(60, [8, 8, 8], 0).sets, { setIndex: 3, loadKg: load, reps, completedAt: '' }],
      });
      for (const extra of [bonus(60, 5), bonus(50, 5), bonus(70, 2)]) {
        const decision = gate({ history: [extra, asked], repsMin: 8, repsMax: 8, targetSets: 3 });
        assert.equal(decision.recommendation, 'increase', JSON.stringify(decision));
        assert.equal(decision.fromLoadKg, 60);
        assert.equal(decision.loadKg, 62.5);
      }
      // A programmed set short of the ceiling still holds.
      const short = gate({ history: [entry(60, [8, 8, 6], 0), asked], repsMin: 8, repsMax: 8, targetSets: 3 });
      assert.equal(short.holdReason, 'rep_ceiling_not_reached');

      // The bodyweight rep gate: a tired extra set is not the proven floor.
      const { resolveProgressedReps } = require('../../.test-dist/lib/progressionGate.js');
      const withExtra = entry(0, [12, 12, 12], 0, {
        sets: [...entry(0, [12, 12, 12], 0).sets, { setIndex: 3, loadKg: 0, reps: 5, completedAt: '' }],
      });
      const reps = resolveProgressedReps({
        history: [withExtra, entry(0, 12, 3)],
        templateTargetReps: 12,
        targetSets: 3,
        level: 'beginner',
        trackingMode: 'bodyweight',
        automatedProgressionEnabled: true,
      });
      assert.equal(reps.progressed, true);
      assert.equal(reps.targetReps, 13);
    },
  },
];
