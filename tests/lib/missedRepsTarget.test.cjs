const assert = require('node:assert/strict');

const { resolveMissedRepsTarget } = require('../../.test-dist/lib/progressionGate.js');
const { workoutReducer } = require('../../.test-dist/features/workout/workoutState');
const { resolveGuidedSetTarget } = require('../../.test-dist/lib/guidedPlayer');

// At the gym, 2026-09-09: 7 · 6 · 4 · 4 last time, and the app asked for
// 4 × 12 at the same weight. The rule (user): "tee samalla painolla mutta yritä
// tehdä 6 6 6 6" — the average rounded up, then +1 (+2 when every set went
// past it) until the programme's reps are back. Pro, like the rest of
// automated progression (user, 2026-09-28).

function entry(reps, extra = {}) {
  return {
    slotId: 'slot',
    templateId: 'tpl',
    templateName: 'Upper',
    exerciseName: 'Bench Press',
    substitutionGroup: 'press',
    performedAt: '2026-09-20T09:00:00.000Z',
    sessionId: 's',
    sets: reps.map((count, setIndex) => ({ setIndex, loadKg: 60, reps: count, completedAt: '2026-09-20T09:00:00.000Z' })),
    skipped: false,
    ...extra,
  };
}

const rule = (history, extra = {}) =>
  resolveMissedRepsTarget({ history, repsMin: 12, targetSets: 4, trackingMode: 'load_and_reps', automatedProgressionEnabled: true, ...extra });

const EMPTY = {
  activeSession: null,
  completionSummary: null,
  history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
  nowMs: 0,
};

const TEMPLATE = {
  id: 'tpl_missed',
  name: 'Missed reps',
  defaultScheduleMode: 'weekly',
  sessions: [
    {
      id: 'day',
      name: 'Upper',
      orderIndex: 0,
      exercises: [
        {
          id: 'e_bench',
          exerciseName: 'Bench Press',
          slotId: 'bench',
          role: 'primary',
          progressionPriority: 'high',
          trackingMode: 'load_and_reps',
          sets: 4,
          repsMin: 12,
          repsMax: 12,
          restSecondsMin: 120,
          restSecondsMax: 180,
          substitutionGroup: 'bench_press',
        },
      ],
    },
  ],
};

function session(state, reps, day, pro = true, template = TEMPLATE, beforeSet = () => {}) {
  let next = workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: {
      template,
      sessionOrderIndex: 0,
      unitPreference: 'kg',
      // The clock pinned to the session's own day: the target ignores a
      // history older than 90 days, and these fixtures are dated.
      progression: { automatedProgressionEnabled: pro, setupLevel: 'beginner', nowMs: Date.UTC(2026, 8, day, 8) },
    },
  });
  const opened = next.activeSession.exercises[0];
  const openedOn = opened.sets.map((_, index) => resolveGuidedSetTarget(opened.sets, index, opened.trackingMode).reps);
  const at = new Date(Date.UTC(2026, 8, day, 9)).toISOString();
  reps.forEach((count, index) => {
    next = beforeSet(next, index) ?? next;
    next = workoutReducer(next, {
      type: 'set/updateDraft',
      payload: { slotId: opened.slotId, setIndex: index, patch: { loadText: '60', repsText: String(count) } },
    });
    next = workoutReducer(next, {
      type: 'set/complete',
      payload: { slotId: opened.slotId, setIndex: index, nowMs: Date.parse(at), unitPreference: 'kg' },
    });
  });
  next = workoutReducer(next, { type: 'session/finishWorkout', payload: { performedAt: at } });
  return { state: workoutReducer(next, { type: 'session/clearCompletedSession' }), openedOn };
}

module.exports = [
  {
    name: 'reps short of the programme: every set aims for the average, rounded up',
    run() {
      assert.deepEqual(rule([entry([7, 6, 4, 4])]), { targetReps: 6, fromAverage: 5.25 });
      // Within the programme's reps, the ordinary rules stand.
      assert.equal(rule([entry([12, 12, 11, 12])]), null);
      assert.equal(rule([entry([12, 12, 12, 12])]), null);
    },
  },
  {
    name: 'the target climbs one rep, two when every set beat it, back to the programme',
    run() {
      assert.equal(rule([entry([6, 6, 6, 6], { targetReps: 6 })]).targetReps, 7);
      assert.equal(rule([entry([6, 7, 8, 7], { targetReps: 6 })]).targetReps, 7);
      assert.equal(rule([entry([7, 7, 7, 7], { targetReps: 6 })]).targetReps, 8);
      // Never below what the sets just did, and never once the floor is met
      // (PR review, 2026-09-28): a stale 6 under 10s asks 10, under 12s nothing.
      assert.equal(rule([entry([10, 10, 10, 10], { targetReps: 6 })]).targetReps, 10);
      assert.equal(rule([entry([12, 12, 12, 12], { targetReps: 6 })]), null);
      // Past the programme's floor, the rule lets go.
      assert.equal(rule([entry([11, 11, 11, 11], { targetReps: 11 })]), null);
      assert.equal(rule([entry([11, 12, 12, 12], { targetReps: 10 })]), null);
    },
  },
  {
    name: 'a lowered target missed again goes back to the average; fewer sets than asked do not count as met',
    run() {
      assert.equal(rule([entry([6, 6, 5, 4], { targetReps: 6 })]).targetReps, 6);
      assert.equal(rule([entry([6, 6, 6], { targetReps: 6 })]).targetReps, 6);
    },
  },
  {
    name: 'a set added past the programme is extra work: it neither lowers the target nor holds one back',
    run() {
      // 4 × 12 asked; a fifth set added at the end (exercise/addSet appends).
      assert.equal(rule([entry([12, 12, 12, 12, 5])]), null);
      assert.equal(rule([entry([6, 6, 6, 6, 3], { targetReps: 6 })]).targetReps, 7);
      assert.equal(rule([entry([7, 7, 7, 7, 6], { targetReps: 6 })]).targetReps, 8);
      // Short of the programme, the average is the programmed sets' own.
      assert.deepEqual(rule([entry([7, 6, 4, 4, 2])]), { targetReps: 6, fromAverage: 5.25 });
    },
  },
  {
    name: 'a lift opened and left without a set does not hide the short session before it',
    run() {
      assert.equal(rule([entry([]), entry([7, 6, 4, 4])]).targetReps, 6);
    },
  },
  {
    name: 'the player\'s overview and plan list say the lowered target, and the walk-up card the programme\'s range',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const player = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'), 'utf8');
      // One number for one set across the player (review, 2026-09-28).
      assert.match(player, /if \(isLoweredTarget\(set\)\) \{\s*return `\$\{set\.plannedTargetReps\}`;/);
      assert.match(player, /isLoweredTarget\(planSet\) \? planSet\.plannedTargetReps! : planSet\.plannedRepsMin/);
      assert.match(player, /programme: formatProgrammeReps\(firstSet!\)/);
    },
  },
  {
    name: 'bodyweight, holds, a skipped lift, Pro off and a malformed stored target are left alone',
    run() {
      assert.equal(rule([entry([7, 6, 4, 4])], { trackingMode: 'bodyweight' }), null);
      assert.equal(rule([entry([7, 6, 4, 4])], { trackingMode: 'hold' }), null);
      assert.equal(rule([entry([7, 6, 4, 4], { skipped: true })]), null);
      assert.equal(rule([entry([7, 6, 4, 4])], { automatedProgressionEnabled: false }), null);
      assert.equal(rule([]), null);
      // A stored target that is not a whole number below the floor is not one.
      assert.equal(rule([entry([6, 6, 6, 6], { targetReps: '6' })]).targetReps, 6);
      assert.equal(rule([entry([6, 6, 6, 6], { targetReps: 13 })]).targetReps, 6);
    },
  },
  {
    name: 'end to end: the dial opens on 6, then 7, then the programme — at the same weight',
    run() {
      let { state } = session(EMPTY, [7, 6, 4, 4], 20);
      let result = session(state, [6, 6, 6, 6], 22);
      assert.deepEqual(result.openedOn, [6, 6, 6, 6]);
      const stored = result.state.history.slotHistory[Object.keys(result.state.history.slotHistory)[0]][0];
      assert.equal(stored.targetReps, 6, 'the lowered target is kept for the next session');
      const next = workoutReducer(result.state, {
        type: 'session/startFromRuntimeTemplate',
        payload: { template: TEMPLATE, sessionOrderIndex: 0, unitPreference: 'kg', progression: { automatedProgressionEnabled: true, setupLevel: 'beginner', nowMs: Date.UTC(2026, 8, 24, 8) } },
      });
      const bench = next.activeSession.exercises[0];
      assert.equal(resolveGuidedSetTarget(bench.sets, 0, bench.trackingMode).reps, 7);
      assert.equal(resolveGuidedSetTarget(bench.sets, 0, bench.trackingMode).loadKg, 60);

      // Up to 11 with every set met, then 12 is the programme's own.
      ({ state } = session(result.state, [7, 7, 7, 7], 24));
      for (let reps = 8, day = 26; reps <= 11; reps += 1, day += 2) {
        result = session(state, [reps, reps, reps, reps], day);
        assert.deepEqual(result.openedOn, [reps, reps, reps, reps], `day ${day}`);
        state = result.state;
      }
      assert.deepEqual(session(state, [12, 12, 12, 12], 40).openedOn, [12, 12, 12, 12]);
    },
  },
  {
    // The ramp rule withholds its +1 under a flagged area; so does the lowered
    // target's climb (2026-10-02). Recovery does not: the climb only returns
    // to the programme's reps at the same weight, and held, a "recovery low"
    // bench sat at 3 × 6 under a programme of 8 while Home's plateau card asked
    // for 3 × 7 (#bugs 2026-10-08).
    name: 'a lift held for a flagged area does not climb its lowered target; recovery does not hold it',
    run() {
      const met = [entry([6, 6, 6, 6], { targetReps: 6 })];
      const beat = [entry([7, 7, 7, 7], { targetReps: 6 })];
      assert.equal(rule(met).targetReps, 7);
      assert.equal(rule(met, { cautionArea: 'knees' }).targetReps, 6);
      assert.equal(rule(beat, { cautionArea: 'knees' }).targetReps, 7, 'what the sets just did is a repeat, not a climb');
      assert.equal(rule(met, { cautionArea: null }).targetReps, 7);
      assert.equal(rule(met, { fatigueSignal: 'high' }).targetReps, 7, 'recovery does not hold the climb');
      assert.equal(rule(met, { fatigueSignal: 'elevated' }).targetReps, 7);
      // The first lowering is a repeat of the average either way.
      assert.deepEqual(rule([entry([7, 6, 4, 4])], { cautionArea: 'knees' }), { targetReps: 6, fromAverage: 5.25 });
      // Held, a target the sets already beat to the floor still lets go.
      assert.equal(rule([entry([12, 12, 12, 12], { targetReps: 6 })], { cautionArea: 'knees' }), null);
    },
  },
  {
    // At the gym, 2026-10-08: 60 kg 6 · 6 · 6 under a programme of 8, again and
    // again, with recovery reading "Vähissä" — and the card said 3 × 6 every
    // time, while Home's plateau card asked for 3 × 7.
    name: 'end to end: with recovery low the lowered target still climbs back to the programme',
    run() {
      const open = (state, day, fatigueSignal) => {
        const next = workoutReducer(state, {
          type: 'session/startFromRuntimeTemplate',
          payload: {
            template: TEMPLATE,
            sessionOrderIndex: 0,
            unitPreference: 'kg',
            progression: { automatedProgressionEnabled: true, setupLevel: 'beginner', nowMs: Date.UTC(2026, 8, day, 8), fatigueSignal },
          },
        });
        const lift = next.activeSession.exercises[0];
        return {
          reps: lift.sets.map((_, index) => resolveGuidedSetTarget(lift.sets, index, lift.trackingMode).reps),
          loads: lift.sets.map((set) => set.plannedLoadKg),
        };
      };
      let { state } = session(EMPTY, [7, 6, 4, 4], 20);
      ({ state } = session(state, [6, 6, 6, 6], 22));
      for (const fatigueSignal of ['high', 'elevated', 'normal']) {
        const opened = open(state, 24, fatigueSignal);
        assert.deepEqual(opened.reps, [7, 7, 7, 7], fatigueSignal);
        assert.deepEqual(opened.loads, [60, 60, 60, 60], `${fatigueSignal}: the weight does not move`);
      }
    },
  },
  {
    name: 'end to end: a knees-careful Back Squat opens on its lowered target again and again; unflagged it climbs',
    run() {
      const squat = {
        ...TEMPLATE,
        sessions: [{ ...TEMPLATE.sessions[0], exercises: [{ ...TEMPLATE.sessions[0].exercises[0], exerciseName: 'Back Squat', slotId: 'squat' }] }],
      };
      const open = (state, day, cautionFlags) => {
        const next = workoutReducer(state, {
          type: 'session/startFromRuntimeTemplate',
          payload: {
            template: squat,
            sessionOrderIndex: 0,
            unitPreference: 'kg',
            progression: { automatedProgressionEnabled: true, setupLevel: 'beginner', nowMs: Date.UTC(2026, 8, day, 8), cautionFlags },
          },
        });
        const lift = next.activeSession.exercises[0];
        return lift.sets.map((_, index) => resolveGuidedSetTarget(lift.sets, index, lift.trackingMode).reps);
      };
      let { state } = session(EMPTY, [7, 6, 4, 4], 20, true, squat);
      ({ state } = session(state, [6, 6, 6, 6], 22, true, squat));
      const flags = [{ area: 'knees', level: 'careful', refinements: [] }];
      assert.deepEqual(open(state, 24, undefined), [7, 7, 7, 7]);
      assert.deepEqual(open(state, 24, flags), [6, 6, 6, 6]);
      assert.deepEqual(open(state, 24, [{ area: 'knees', level: 'info', refinements: [] }]), [7, 7, 7, 7]);
      assert.deepEqual(open(state, 24, [{ area: 'shoulders', level: 'careful', refinements: [] }]), [7, 7, 7, 7]);
    },
  },
  {
    name: 'the coach\'s example sees the lowered target: it previews the same start',
    run() {
      const { previewNextSession } = require('../../.test-dist/features/workout/workoutState');
      const { state } = session(EMPTY, [7, 6, 4, 4], 20);
      const preview = previewNextSession(TEMPLATE, {
        unitPreference: 'kg',
        history: state.history,
        sessionOrderIndex: 0,
        automatedProgressionEnabled: true,
        setupLevel: 'beginner',
      });
      assert.deepEqual(preview[0].sets, [
        { loadKg: 60, reps: 6 },
        { loadKg: 60, reps: 6 },
        { loadKg: 60, reps: 6 },
        { loadKg: 60, reps: 6 },
      ]);
    },
  },
  {
    name: 'without Pro the dial opens on the programme\'s reps, as before',
    run() {
      const { state } = session(EMPTY, [7, 6, 4, 4], 20, false);
      assert.deepEqual(session(state, [6, 6, 6, 6], 22, false).openedOn, [12, 12, 12, 12]);
    },
  },
  {
    name: 'a lift swapped in on Home keeps the lowered target it was given, and climbs back from it',
    run() {
      // Home's swap (lib/sessionAdaptation applySwap) hands the session a
      // template whose lift is the new one, marked with the lift it replaced.
      // The session is built from the new lift's own history, so a short run
      // of it is lowered like any other — and has to be remembered, or the
      // next session re-derives the average instead of asking one more rep
      // (review of #202, 2026-09-28).
      const swapped = {
        ...TEMPLATE,
        sessions: [{ ...TEMPLATE.sessions[0], exercises: [{ ...TEMPLATE.sessions[0].exercises[0], sourceExerciseName: 'Dumbbell Bench Press' }] }],
      };
      const { state } = session(EMPTY, [7, 6, 4, 4], 20, true, swapped);
      const result = session(state, [6, 6, 6, 6], 22, true, swapped);
      assert.deepEqual(result.openedOn, [6, 6, 6, 6]);
      const stored = Object.values(result.state.history.slotHistory)[0][0];
      assert.equal(stored.swappedFrom, 'Dumbbell Bench Press');
      assert.equal(stored.targetReps, 6);
      assert.deepEqual(session(result.state, [7, 7, 7, 7], 24, true, swapped).openedOn, [7, 7, 7, 7]);
    },
  },
  {
    name: 'a swap mid-session keeps the target on the lift that was given it, and gives the new lift none',
    run() {
      const { state } = session(EMPTY, [7, 6, 4, 4], 20);
      const swapAfterTwo = (current, index) =>
        index === 2
          ? workoutReducer(current, {
              type: 'exercise/swap',
              payload: { slotId: current.activeSession.exercises[0].slotId, exerciseName: 'Incline Bench Press', substitutionGroup: 'bench_press', unitPreference: 'kg' },
            })
          : undefined;
      const result = session(state, [6, 6, 12, 12], 22, true, TEMPLATE, swapAfterTwo);
      const [incline, bench] = Object.values(result.state.history.slotHistory)[0];
      assert.deepEqual([incline.exerciseName, bench.exerciseName], ['Incline Bench Press', 'Bench Press']);
      assert.equal(bench.targetReps, 6);
      assert.equal('targetReps' in incline, false, 'the incline sets were asked for the programme, not the bench target');
    },
  },
  {
    name: 'a short session over 90 days old lowers nothing today (break round 2026-09-28)',
    run() {
      const performed = Date.parse('2026-09-20T09:00:00.000Z');
      const day = 86_400_000;
      // A week later — a lift trained once a week — the target still stands:
      // the spec's 7-day gap is not this rule.
      assert.deepEqual(rule([entry([7, 6, 4, 4])], { nowMs: performed + 7 * day }), { targetReps: 6, fromAverage: 5.25 });
      assert.deepEqual(rule([entry([7, 6, 4, 4])], { nowMs: performed + 90 * day }), { targetReps: 6, fromAverage: 5.25 });
      // Past 90 days the programme's own reps are asked for again.
      assert.equal(rule([entry([7, 6, 4, 4])], { nowMs: performed + 91 * day }), null);
      assert.equal(rule([entry([7, 6, 4, 4])], { nowMs: performed + 210 * day }), null);
      // An entry whose date cannot be read is not trusted to be recent.
      assert.equal(rule([entry([7, 6, 4, 4], { performedAt: 'not a date' })], { nowMs: performed }), null);
      // Through the reducer: a session opened seven months later opens on the programme.
      const { state } = session(EMPTY, [7, 6, 4, 4], 20);
      const later = workoutReducer(state, {
        type: 'session/startFromRuntimeTemplate',
        payload: {
          template: TEMPLATE,
          sessionOrderIndex: 0,
          unitPreference: 'kg',
          progression: { automatedProgressionEnabled: true, setupLevel: 'beginner', nowMs: Date.UTC(2027, 3, 20, 8) },
        },
      });
      const bench = later.activeSession.exercises[0];
      assert.equal(bench.sets[0].plannedTargetReps, undefined);
    },
  },
  {
    // Hunt 2026-10-09: the 90 days were 90 × 24 hours, so the same 90 calendar
    // days read stale across the autumn clock change and fresh in summer.
    name: 'missed reps and the ramp: 90 calendar days is the same age across a clock change',
    run() {
      const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');
      const { resolveRampSetTarget } = require('../../.test-dist/lib/progressionGate.js');
      withHelsinkiClocks(() => {
        const at = (local, reps, loads) => {
          const iso = new Date(local).toISOString();
          return entry(reps, {
            performedAt: iso,
            sets: reps.map((count, setIndex) => ({ setIndex, loadKg: loads ? loads[setIndex] : 60, reps: count, completedAt: iso })),
          });
        };
        const spans = [
          ['2026-08-03T18:00:00', '2026-11-01T18:00:00'], // across the autumn change
          ['2026-06-03T18:00:00', '2026-09-01T18:00:00'], // no change
          ['2026-01-01T18:00:00', '2026-04-01T18:00:00'], // across the spring change
        ];
        for (const [performed, now] of spans) {
          const nowMs = new Date(now).getTime();
          const fresh = rule([at(performed, [6, 6, 6, 6])], { nowMs });
          assert.deepEqual(fresh, { targetReps: 6, fromAverage: 6 }, `${performed} -> ${now}`);
          const ramp = at(performed, [10, 8, 5], [40, 50, 60]);
          assert.equal(
            resolveRampSetTarget({ entry: ramp, setIndex: 2, repsMax: 12, trackingMode: 'load_and_reps', automatedProgressionEnabled: true, nowMs }),
            6,
            `ramp ${performed} -> ${now}`,
          );
          // A minute past the 90th day is stale either way.
          const later = nowMs + 60_000;
          assert.equal(rule([at(performed, [6, 6, 6, 6])], { nowMs: later }), null, `stale ${performed}`);
          assert.equal(
            resolveRampSetTarget({ entry: ramp, setIndex: 2, repsMax: 12, trackingMode: 'load_and_reps', automatedProgressionEnabled: true, nowMs: later }),
            null,
          );
        }
      });
    },
  },
];
